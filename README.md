# Watchtower

A GeoDjango + PostGIS web map of wildfire lookout cameras that answers:
**"which active fires can each tower currently see?"** using live NASA FIRMS
satellite data.

This is a learning/portfolio project for geospatial data engineering. It is
built in phases — see [`watchtower-plan.md`](watchtower-plan.md).

> **Status:** Phase 3 (viewshed) — terrain line-of-sight coverage.

## Tech stack

- Python 3.12, Django 5.x with GeoDjango (`django.contrib.gis`)
- PostgreSQL 16 + PostGIS 3.4
- Docker + docker-compose (so you never install GDAL/GEOS/PROJ on the host)
- [uv](https://docs.astral.sh/uv/) for Python dependency management
- NASA FIRMS (VIIRS) as the live fire-detection data source
- Copernicus GLO-30 DEM (AWS Open Data) + GDAL `gdal_viewshed` for terrain viewsheds
- `requests` + `pandas` for the ETL; `rasterio` + `shapely` for the viewshed
- Leaflet (CDN) for the map

## Prerequisites

- **Docker Desktop** installed and running.
- A free **NASA FIRMS `MAP_KEY`** (needed for the Phase 2 ingest, not for the
  map itself). Request one at
  <https://firms.modaps.eosdis.nasa.gov/api/map_key/> and put it in `.env` as
  `FIRMS_MAP_KEY=...`.

## Quick start

```bash
# 1. (Optional) create your local env file. Defaults work out of the box;
#    you'll need this in Phase 2 to set FIRMS_MAP_KEY.
cp .env.example .env

# 2. Build and start the database + web services.
docker compose up --build

# 3. In another terminal, run migrations (enables PostGIS + applies schema).
docker compose exec web python manage.py migrate

# 4. Seed ~5 real California fire lookouts.
docker compose exec web python manage.py seed_towers

# 5. Ingest live fire detections from NASA FIRMS (needs FIRMS_MAP_KEY in .env).
docker compose exec web python manage.py ingest_fires            # last 1 day
docker compose exec web python manage.py ingest_fires --day-range 3

# 6. (Optional, Phase 3) Compute terrain viewsheds — replaces the coverage
#    circles with real line-of-sight. Downloads DEM windows; ~1 min per tower.
docker compose exec web python manage.py compute_viewsheds
```

The web service runs the Django dev server at <http://localhost:8000>:

- `/` — Leaflet map: tower markers, coverage circles, and live fire points
  (red). Click a tower to see how many fires are currently in its range.
- `/api/towers.geojson` — towers (with coverage polygons + in-range counts).
- `/api/fires.geojson` — all fire detections.
- `/api/towers/<id>/fires.geojson` — fires within one tower's coverage.
- `/admin/` — Django admin (with map widgets).

Both `seed_towers` and `ingest_fires` are idempotent — re-running refreshes data
rather than duplicating it (the ingest dedups on a stable `external_uid`).

### Notes on the FIRMS ingest

- `--day-range` accepts 1–10, but a large bounding box over many days can exceed
  FIRMS' per-request limits (HTTP 400); use a smaller range if so.
- On a calm day FIRMS may return **zero** detections in the area — that's normal
  and handled gracefully (no crash, empty map layer).
- Coverage uses a naive `coverage_radius_km`, reprojected to the local UTM zone
  for accurate metre buffering. Whether any live fire currently falls within a
  given lookout's radius is down to real-world fire activity.

### Phase 3 — terrain viewsheds

`compute_viewsheds` replaces each lookout's coverage *circle* with a real
line-of-sight **viewshed**: the ground the observer can actually see once ridges
block the view. Pipeline (`towers/viewshed.py`):

1. Read the relevant 1°×1° Copernicus GLO-30 DEM tiles straight from AWS over
   HTTP (`/vsicurl/`, no download, no credentials).
2. Mosaic + reproject the window to the tower's UTM zone (metres) with `gdalwarp`.
3. Run `gdal_viewshed` from the observer (DEM ground + mast height).
4. Polygonize the visible cells (`rasterio` + `shapely`) and reproject to 4326.

When a tower has a stored viewshed, both the map coverage (drawn green vs. the
blue circle) and `fires_in_range()` use it instead of the radius — so the
"fires I can see" count reflects terrain. In the seeded data this drops Boucher
Hill from 6 in-radius fires to **1 actually visible**.

### Verify the spatial stack

```bash
# GeoDjango's geometry bindings load:
docker compose exec web python manage.py shell -c \
  "from django.contrib.gis.geos import Point; print(Point(-121.5, 38.5, srid=4326))"
```

### Running tests

```bash
docker compose exec web pytest
```

## Configuration

All configuration comes from environment variables (see `.env.example`).
`.env` is gitignored — never commit secrets. `docker compose up` works without
a `.env` thanks to the defaults baked into `docker-compose.yml`.

| Variable | Purpose | Default |
|---|---|---|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Database credentials | `watchtower` |
| `DJANGO_SECRET_KEY` | Django secret key | dev placeholder |
| `DJANGO_DEBUG` | `1` to enable debug mode | `1` |
| `FIRMS_MAP_KEY` | NASA FIRMS API key (Phase 2) | empty |

## Working with dependencies (uv)

Dependencies live in `pyproject.toml` and are pinned in `uv.lock`. The Docker
image installs them with `uv sync --frozen`. To change dependencies:

```bash
uv add <package>          # add a runtime dependency
uv add --dev <package>    # add a dev/test dependency
docker compose build web  # rebuild the image to pick up the change
```
