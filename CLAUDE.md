# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GeoDjango + PostGIS web map of wildfire lookout towers that answers **"which
active fires can each tower currently see?"** using live NASA FIRMS satellite
data. A learning/portfolio project built in phases — see `watchtower-plan.md`
for the roadmap and `README.md` for the full setup narrative.

## Architecture

The whole pipeline turns on one **spatial join**: for each `WatchtowerSite`,
which `FireDetection`s fall inside its coverage area. Both models live in the
single `towers` app.

- **`towers/models.py`** — the domain core.
  - `WatchtowerSite` stores `location` (PointField) and an optional `viewshed`
    (MultiPolygonField). `coverage_area()` returns the viewshed if computed,
    else a naive radius circle. `fires_in_range()` does the spatial query the
    same way (viewshed `intersects` vs. radius `distance_lte`). `coverage_kind`
    reports which is active.
  - `FireDetection` is one VIIRS satellite hit, deduped on a stable
    `external_uid` (lat/lon/time/source) so re-ingesting is idempotent.
- **`towers/viewshed.py`** — Phase 3 terrain line-of-sight. Reads Copernicus
  GLO-30 DEM tiles straight from AWS over HTTP (`/vsicurl/`, no download/creds),
  mosaics + reprojects to UTM with `gdalwarp`, runs `gdal_viewshed`, then
  polygonizes visible cells with rasterio/shapely back to 4326. **Shells out to
  the GDAL CLI** (`gdalbuildvrt`/`gdalwarp`/`gdal_viewshed`) — only available
  inside the Docker image.
- **`towers/views.py` + `towers/urls.py`** — thin GeoJSON API
  (`/api/towers.geojson`, `/api/fires.geojson`, `/api/towers/<id>/fires.geojson`)
  plus `/` which renders `templates/towers/map.html`. Views serialize models to
  GeoJSON by hand; coordinates are always `[lon, lat]`.
- **Frontend (`assets/`)** — React + TypeScript + Vite app (MapLibre via
  [mapcn](https://www.mapcn.dev)) wired into Django by **django-vite**. Entry is
  `assets/main.tsx`; map logic in `assets/components/MapView.tsx`; vendored mapcn
  UI in `assets/components/ui/map.tsx`. It fetches the GeoJSON endpoints above.
- **Management commands** (`towers/management/commands/`) — the ETL.
  `seed_towers` (5 real CA lookouts), `ingest_fires` (FIRMS CSV → DB),
  `compute_viewsheds` (DEM → stored polygons). All idempotent via
  `update_or_create`.

### Critical spatial convention

**Geometry is always stored in SRID 4326 (WGS84 lat/lon).** Never store
projected coordinates. Any math needing metres (buffers, viewsheds) reprojects
on the fly to the tower's local **UTM zone** (`_metric_srid()` /
`_utm_srid()`) — buffering in degrees or Web Mercator gives wrong distances
(~28% error at California's latitude). Distance lookups pass `"spheroid"` to
measure true ground metres.

## Commands

Django + Postgres run in **Docker**; Node/Vite runs on the **host** (Node 24,
see `.nvmrc`). The GDAL/GEOS/PROJ native libs only exist in the image, so run
all Python/Django commands through `docker compose exec web`.

```bash
docker compose up --build                          # start db + web
docker compose exec web python manage.py migrate   # PostGIS + schema
docker compose exec web python manage.py seed_towers
docker compose exec web python manage.py ingest_fires --day-range 3   # needs FIRMS_MAP_KEY in .env
docker compose exec web python manage.py compute_viewsheds            # ~1 min/tower

# Tests (pytest-django; spatial tests need the PostGIS DB → run in the container)
docker compose exec web pytest
docker compose exec web pytest towers/tests/test_models.py::test_tower_found_by_distance_query

# Lint
docker compose exec web ruff check .

# Frontend (host, with Docker already up)
nvm use && npm install        # first time
npm run dev                   # Vite HMR on :5173; open Django at :8000
npm run build                 # hashed bundle + manifest into static/ (for DEBUG=0)
```

In `DEBUG` mode django-vite loads assets from the Vite dev server, so you need
**both** `npm run dev` (host) and the Django server (Docker) running, then open
<http://localhost:8000>. `scripts/dev.sh` runs Django + Vite together but uses
`uv run` directly (host Python), which lacks GDAL — prefer Docker for Django.

## Dependencies (uv)

Python deps live in `pyproject.toml`, pinned in `uv.lock`; the image installs
with `uv sync --frozen`. Use **uv, not pip/requirements.txt**.

```bash
uv add <package>            # runtime dep
uv add --dev <package>      # dev/test dep
docker compose build web    # rebuild image to pick it up
```

## Conventions worth keeping

- **Never log the FIRMS URL** — it embeds the secret `MAP_KEY`. `ingest_fires`
  deliberately redacts the key from request exceptions before surfacing them.
- Management commands handle FIRMS edge cases gracefully (zero detections,
  non-CSV error responses, missing key) — keep that resilience.
- FIRMS limits: a large bbox over many days returns HTTP 400; the ingest keeps
  the bbox tight (union of tower coverage envelopes) and `--day-range` is 1–10.
- This is a single-user project — auth machinery is intentionally minimal
  (`AUTH_PASSWORD_VALIDATORS = []`); don't add account infrastructure.
