# Watchtower — Build Plan & Handoff Spec

> A GeoDjango + PostGIS web map of wildfire lookout cameras that answers: **"which active fires can each tower currently see?"** using live NASA satellite data.

This document is written to be handed to **Claude Code**. It is organized into phases with explicit acceptance criteria. Build one phase at a time, commit at the end of each, and don't start a later phase until the current phase's "Definition of done" passes.

---

## 1. Context & goals

The author is learning **geospatial data/technologies** and the **Django** framework, and wants a portfolio project aimed at a geospatial data engineering role (wildfire detection domain). The project deliberately mirrors a real industry problem: cameras on high vantage points monitoring for new fire ignitions.

**Learning goals this project must exercise (do not optimize them away):**
- GeoDjango as a spatial ORM over PostGIS (spatial model fields + spatial lookups).
- Coordinate reference systems (CRS) — storing in EPSG:4326 and reasoning in meters.
- A real ETL pipeline ingesting an external geospatial dataset.
- A spatial join (point-in-polygon / distance) as the core query.
- Serving GeoJSON to a web map.

**Non-goals:** auth/users, multi-tenancy, production hardening, mobile apps. Keep it a focused single-project app.

---

## 2. Tech stack (use these exact choices unless a phase says otherwise)

- **Python** 3.12
- **Django** 5.x with **GeoDjango** (`django.contrib.gis`)
- **PostgreSQL** 16 + **PostGIS** 3.4 (Docker image `postgis/postgis:16-3.4`)
- **Database driver:** `psycopg[binary]`
- **Geospatial Python libs:** `geopandas`, `shapely`, `requests` (Phase 2); `rasterio` + system GDAL (Phase 3)
- **Frontend:** Leaflet (via CDN) rendered from a Django template; no SPA, no build step
- **Containerization:** Docker + docker-compose (this is how we avoid GDAL/GEOS/PROJ install pain — do NOT install GDAL on the host)
- **Config:** environment variables via a `.env` file (never commit secrets)
- **Testing:** `pytest` + `pytest-django`

> **Why Docker is non-negotiable here:** GeoDjango needs the GDAL, GEOS, and PROJ C libraries. Installing them natively (especially on macOS/Windows) is the #1 source of lost hours. Run Django *inside* a container that has them.

---

## 3. Prerequisites the human must provide

1. **Docker Desktop** installed and running.
2. **A free NASA FIRMS MAP_KEY.** The human requests one at `https://firms.modaps.eosdis.nasa.gov/api/map_key/` and pastes it into `.env` as `FIRMS_MAP_KEY=...`. (Claude Code: if the key is missing, the ingest command should fail with a clear, friendly message telling the user where to get one — do not hardcode or invent a key.)

---

## 4. Repository structure (target)

```
watchtower/
├── docker-compose.yml
├── Dockerfile
├── .env.example            # documents required env vars; .env is gitignored
├── .gitignore
├── README.md               # setup + run instructions, kept current each phase
├── requirements.txt
├── manage.py
├── config/                 # Django project package
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
└── towers/                 # the single app
    ├── models.py
    ├── admin.py
    ├── views.py
    ├── urls.py
    ├── management/commands/
    │   ├── seed_towers.py      # Phase 1
    │   └── ingest_fires.py     # Phase 2
    ├── templates/towers/
    │   └── map.html            # Leaflet dashboard
    ├── fixtures/
    │   └── towers.json         # ~5 seed lookout sites
    └── tests/
        ├── test_models.py
        ├── test_ingest.py
        └── test_views.py
```

---

## 5. Data models

Define in `towers/models.py`. Store all geometry in **SRID 4326** (WGS84 lat/lon), because that's what the data sources are in and what Leaflet expects.

### `WatchtowerSite`
| field | type | notes |
|---|---|---|
| `name` | `CharField` | e.g. "Diablo Peak Lookout" |
| `location` | `PointField(srid=4326)` | the tower's position |
| `elevation_m` | `FloatField` | metres above sea level |
| `coverage_radius_km` | `FloatField` | default 20.0; used for the simple coverage model in Phase 2 |
| `created_at` | `DateTimeField(auto_now_add=True)` | |

### `FireDetection`
| field | type | notes |
|---|---|---|
| `location` | `PointField(srid=4326)` | from FIRMS lat/lon |
| `acquired_at` | `DateTimeField` | combine FIRMS `acq_date` + `acq_time` (UTC) |
| `source` | `CharField` | e.g. "VIIRS_NOAA20_NRT" |
| `frp` | `FloatField(null=True)` | fire radiative power |
| `confidence` | `CharField` | FIRMS confidence (l/n/h or numeric, store raw) |
| `brightness` | `FloatField(null=True)` | `bright_ti4` |
| `external_uid` | `CharField(unique=True)` | dedup key, see Phase 2 |

Add a `GistIndex` (or `models.Index` on the geometry) for `location` on both models.

---

## 6. Phases

### Phase 0 — Scaffold & spatial database
**Build:**
- `docker-compose.yml` with two services: `db` (`postgis/postgis:16-3.4`, with a named volume and healthcheck) and `web` (built from `Dockerfile`, depends_on db healthy, runs the dev server, mounts the source).
- `Dockerfile` based on `python:3.12-slim` that installs GDAL/GEOS/PROJ system packages (`binutils libproj-dev gdal-bin libgdal-dev`) and pip requirements.
- A Django project `config` + app `towers`.
- `settings.py`: add `django.contrib.gis` to `INSTALLED_APPS`, set `ENGINE` to `django.contrib.gis.db.backends.postgis`, read DB + `FIRMS_MAP_KEY` from env.
- `.env.example`, `.gitignore` (ignore `.env`, `__pycache__`, etc.), `requirements.txt`, a `README.md` with run instructions.

**Definition of done:**
- [ ] `docker compose up` brings up both services with no errors.
- [ ] `docker compose exec web python manage.py migrate` succeeds (PostGIS extension enabled — add a migration that runs `CREATE EXTENSION IF NOT EXISTS postgis;` or use Django's `PostGISExtension` operation).
- [ ] `docker compose exec web python manage.py shell` can `from django.contrib.gis.geos import Point` without error.
- [ ] Committed to git with a sensible initial commit.

---

### Phase 1 — Watchtower model + map (the "hello world")
**Build:**
- The `WatchtowerSite` model + migration.
- Register it in `admin.py` using `GISModelAdmin` so it gets a map widget.
- A `seed_towers` management command (or `towers.json` fixture) with ~5 **real** California fire-lookout locations (use approximate real coordinates; a quick web lookup of named lookouts is fine).
- A `map.html` template with Leaflet (OpenStreetMap tiles) and a `/` view that renders all towers as markers.
- A `/api/towers.geojson` view that returns the towers as a GeoJSON `FeatureCollection` (you may hand-build the GeoJSON or use `djangorestframework-gis`; hand-building is fine and more instructive). The map should fetch this endpoint.

**Definition of done:**
- [ ] Visiting `http://localhost:8000/` shows 5 tower markers on a Leaflet map.
- [ ] `/api/towers.geojson` returns valid GeoJSON (validate the structure in a test).
- [ ] In the Django shell, this spatial lookup runs and returns results:
      ```python
      from django.contrib.gis.geos import Point
      from django.contrib.gis.measure import D
      from towers.models import WatchtowerSite
      WatchtowerSite.objects.filter(location__distance_lte=(Point(-121.5, 38.5, srid=4326), D(km=100)))
      ```
- [ ] A model test asserts a tower can be created and found via a distance query.

---

### Phase 2 — FIRMS ETL + the core spatial join (the portfolio core)
**Build:**

1. **`ingest_fires` management command** that:
   - Reads `FIRMS_MAP_KEY` from env (fail clearly if absent).
   - Computes a bounding box covering the seeded towers (union their coverage areas, then take the envelope) so we only pull relevant data.
   - Calls FIRMS:
     ```
     https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_NOAA20_NRT/{west},{south},{east},{north}/{day_range}
     ```
     where `day_range` is 1–10 (default 1). Source default `VIIRS_NOAA20_NRT`.
   - Parses the CSV (pandas/GeoPandas), builds `FireDetection` rows, parses `acq_date`+`acq_time` into a UTC `acquired_at`.
   - **Idempotency:** construct `external_uid` from a stable combination (e.g. `f"{lat:.5f}_{lon:.5f}_{acq_date}_{acq_time}_{source}"`) and upsert (`update_or_create`) so re-running doesn't duplicate rows. This is the "production-minded ETL" detail that makes the project resume-worthy.
   - Logs a summary: rows fetched, created, updated, skipped.

2. **Coverage geometry.** Add a method/property on `WatchtowerSite` that returns the coverage polygon. **This is the central CRS lesson — do it correctly:**
   - You cannot buffer in degrees. Reproject the point from EPSG:4326 to a metric CRS, buffer by `coverage_radius_km * 1000` metres, then reproject back to 4326 for storage/serving.
   - Acceptable approach: transform to an appropriate UTM zone (or EPSG:3857 as a simpler-but-less-accurate stand-in — note the tradeoff in a code comment) using GeoDjango's `.transform()`.

3. **The core query — "fires this tower can see."** Implement as a method on `WatchtowerSite`, e.g. `fires_in_range(since=None)`, returning `FireDetection` objects within the tower's radius. Prefer a distance lookup in metres:
   ```python
   FireDetection.objects.filter(
       location__distance_lte=(self.location, D(km=self.coverage_radius_km))
   )
   ```
   (Note for the implementer: GeoDjango distance lookups on geometry columns may need the geography cast for metre accuracy — either use `PointField(geography=True)` semantics or `dwithin`/`distance_lte` with care, and add a test asserting a fire just inside vs. just outside the radius is correctly included/excluded.)

4. **Frontend upgrade.** On the map: draw each tower's coverage circle, plot live fire detections as a separate (red) layer from `/api/fires.geojson`, and when a tower marker is clicked, show a popup with the count of fires currently in its range.

5. **API endpoints:** `/api/fires.geojson` and `/api/towers/<id>/fires.geojson`.

**Definition of done:**
- [ ] `docker compose exec web python manage.py ingest_fires` populates `FireDetection` rows from live FIRMS data (or reports zero cleanly if there are genuinely no detections in-bbox today).
- [ ] Re-running `ingest_fires` does **not** create duplicates (test this).
- [ ] The map shows coverage circles + live fire points, and tower popups show an accurate in-range count.
- [ ] A test seeds one tower and two fires (one inside radius, one outside) and asserts `fires_in_range()` returns exactly one.
- [ ] README documents how to get a FIRMS key and run the ingest.

---

### Phase 3 — Stretch goals (what turns it from "nice" into "standout")
Pick any; **viewshed is the highest-value one** for the target role. Each should land on its own branch + PR.

1. **Real viewshed (recommended).** Replace the naive coverage *circle* with terrain line-of-sight:
   - Download an elevation model (USGS 3DEP or SRTM) for each tower's area with `rasterio`.
   - Compute a viewshed from the tower (observer height = `elevation_m` + a mast height) using GDAL's viewshed (`gdal_viewshed` / `gdal.ViewshedGenerate`).
   - Store/serve the resulting visible-area polygon and use *it* (not the circle) for the "fires I can see" query.
   - This directly demonstrates "viewshed computations and site selection."

2. **Site-selection optimizer.** Given existing towers and a candidate region, suggest where a new tower would add the most *currently uncovered* area (greedy max-coverage over a candidate grid).

3. **Scheduled ingestion.** Run `ingest_fires` on a schedule (Celery + beat, or a simple cron container) so the map stays fresh. Demonstrates orchestration thinking.

4. **Deploy** the read-only map publicly (e.g. Fly.io / Railway with a managed Postgres+PostGIS) and link it from the README.

---

## 7. Cross-cutting constraints & gotchas (read before coding)

- **CRS discipline.** Store everything in 4326. Only project to a metric CRS for distance/buffer/area math, then come back. Leave a comment at every reprojection explaining *why*.
- **Secrets.** `FIRMS_MAP_KEY` and DB creds come from env only. Commit `.env.example`, never `.env`.
- **FIRMS limits.** The API is transaction-limited; keep the bbox tight (towers' envelope, not "world") and default `day_range=1`. Don't hammer it in tests — tests must **mock** the HTTP call, never hit the live API.
- **Empty data is normal.** On a calm day the bbox may return zero detections. The app and tests must handle an empty result gracefully (don't crash, don't show a broken map).
- **Idempotent ETL.** Re-running ingest is expected; dedup via `external_uid`.
- **Determinism in tests.** Use a fixed set of fixture geometries; don't depend on live data for assertions.

---

## 8. Working agreement for Claude Code

- Build phase-by-phase; do not jump ahead. After each phase, run its checklist and the test suite, then make a single descriptive commit (e.g. `feat: phase 1 — watchtower model + leaflet map`).
- Keep the `README.md` runnable at every phase — a fresh clone + `docker compose up` + the documented commands should work.
- Prefer clarity over cleverness; this is a learning project, so favor readable code and short explanatory comments on the geospatial bits (CRS transforms, spatial lookups, the FIRMS parse).
- Write tests as you go (models, ingest with a mocked HTTP response, GeoJSON endpoints). Don't leave testing for the end.
- If a decision is genuinely ambiguous, state the assumption in the PR/commit message and proceed; don't block.

---

## 9. Definition of done (whole project, minimum portfolio bar)

Phases 0–2 complete, plus at least one Phase 3 stretch (ideally the viewshed). A visitor can clone the repo, add a FIRMS key, run `docker compose up`, and see live wildfire detections lit up inside camera coverage areas — with a clean README explaining the geospatial concepts the project demonstrates.
