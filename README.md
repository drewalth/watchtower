# Watchtower

A GeoDjango + PostGIS web map of wildfire lookout towers that answers one
question: **which active fires can each tower currently see?** Fire data is live
from NASA FIRMS (VIIRS); "can see" is modelled either as a flat coverage radius
or, with terrain factored in, a real line-of-sight viewshed.

A learning/portfolio project for geospatial data engineering, built in phases.
**Status:** Phase 5 — FWI fire-weather risk plus an ML ignition-probability
prediction layer.

## How it works

The system reduces to one spatial join — for each `WatchtowerSite`, which
`FireDetection`s intersect its coverage geometry — wrapped in an ETL that keeps
both sides current.

```
FIRMS VIIRS CSV ──ingest_fires──▶ FireDetection (PointField, 4326)
                                          │
Copernicus GLO-30 DEM ─compute_viewsheds─▶ WatchtowerSite.viewshed (MultiPolygon)
                                          │
                                          ▼
                              fires_in_range()  ──▶  /api/*.geojson  ──▶  React/MapLibre
```

- **`towers/models.py`** — `WatchtowerSite` and `FireDetection`. Coverage is a
  computed viewshed when present, otherwise a reprojected radius buffer;
  `fires_in_range()` queries with `intersects` or `distance_lte` accordingly.
  Detections dedup on a stable `external_uid`, so ingest is idempotent. The
  ingest pulls all three VIIRS NRT sensors (NOAA-20, SNPP, NOAA-21) by default,
  fetching each independently so a single failing sensor never sinks the run.
- **`towers/viewshed.py`** — reads Copernicus GLO-30 DEM COGs from AWS Open Data
  over HTTP (`/vsicurl/`, no download or credentials), warps to UTM, runs
  `gdal_viewshed`, and polygonizes the visible cells back to 4326.
- **`towers/views.py`** — hand-rolled GeoJSON endpoints; `/` serves a React app.
- **`assets/`** — React + TS + Vite frontend (MapLibre via
  [mapcn](https://www.mapcn.dev)), wired into Django by django-vite.

### Spatial conventions

Geometry is stored exclusively in **SRID 4326 (WGS84)** — what the data sources
and the web map speak. Anything needing metres (buffers, viewsheds) reprojects
on the fly to the tower's local **UTM zone**; buffering in degrees or Web
Mercator is wrong (~28% scale error at California's latitude). Distance lookups
pass `"spheroid"` for true ground metres.

## Stack

| Layer       | Choice                                                             |
| ----------- | ------------------------------------------------------------------ |
| Backend     | Python 3.12, Django 5.x + GeoDjango (`django.contrib.gis`)         |
| Database    | PostgreSQL 16 + PostGIS 3.4                                        |
| Geo compute | GDAL CLI (`gdal_viewshed`/`gdalwarp`), `rasterio`, `shapely`       |
| ETL         | `requests` + `pandas`                                              |
| Frontend    | React + TypeScript + Vite, MapLibre GL (mapcn), Tailwind           |
| Tooling     | Docker Compose, [uv](https://docs.astral.sh/uv/) (Python), Node 24 |

GeoDjango needs GDAL/GEOS/PROJ and `gdal_viewshed` shells out to the GDAL CLI,
so **Django runs in Docker**. Node/Vite runs on the host — it's intentionally
out of the image.

## Quick start

```bash
cp .env.example .env                # optional; defaults work. Set FIRMS_MAP_KEY for ingest.
docker compose up --build           # db + web + scheduler

docker compose exec web python manage.py migrate        # enables PostGIS + schema
docker compose exec web python manage.py seed_towers    # 5 real CA lookouts
docker compose exec web python manage.py ingest_fires --day-range 3   # needs FIRMS_MAP_KEY
docker compose exec web python manage.py compute_viewsheds            # ~1 min/tower
```

Once the towers are seeded and `FIRMS_MAP_KEY` is set, the **`scheduler`**
service re-runs `ingest_fires` **hourly** on its own, so fire data stays fresh
without manual re-ingest (`docker compose logs -f scheduler` to watch it). The
one-off `ingest_fires` above just primes the data immediately.

Django serves at <http://localhost:8000>. For the map you also need Vite on the
host (django-vite loads from the dev server in `DEBUG`):

```bash
nvm use && npm install && npm run dev   # HMR on :5173, app still at :8000
```

A free FIRMS `MAP_KEY` (for ingest only) comes from
<https://firms.modaps.eosdis.nasa.gov/api/map_key/> → `.env` as `FIRMS_MAP_KEY`.

### Endpoints

| Path                             | Returns                                                |
| -------------------------------- | ------------------------------------------------------ |
| `/`                              | React map: towers, coverage polygons, live fire points |
| `/api/towers.geojson`            | Towers with coverage polygon + in-range fire count     |
| `/api/fires.geojson`             | All fire detections                                    |
| `/api/towers/<id>/fires.geojson` | Fires within one tower's coverage                      |
| `/admin/`                        | Django admin with map widgets                          |

## Development

```bash
docker compose exec web pytest                          # pytest-django; needs the PostGIS DB
docker compose exec web pytest path::test_name          # single test
docker compose exec web ruff check .                    # lint
npm run build                                            # hashed bundle + manifest for DEBUG=0
```

Add Python deps with `uv add [--dev] <pkg>` then `docker compose build web`. Add
mapcn/shadcn components with `npx shadcn@latest add <name>` (`@/` → `assets/`).

## Operational notes

- **Never log the FIRMS request URL** — it embeds the secret `MAP_KEY`; ingest
  redacts it from any surfaced exception.
- `--day-range` is 1–10. A large bbox over many days can exceed FIRMS limits
  (HTTP 400) — shrink the range. Zero detections on a calm day is normal and
  handled.
- All management commands are idempotent (`update_or_create`); re-running
  refreshes rather than duplicates.
- Viewsheds reflect terrain: in the seed data, terrain drops Boucher Hill from
  6 in-radius fires to **1 actually visible**.
- Config is entirely env-driven (see `.env.example`); `.env` is gitignored and
  Compose bakes working defaults, so `docker compose up` runs without one.
