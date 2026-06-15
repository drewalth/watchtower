# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A GeoDjango + PostGIS web map of wildfire lookout towers that answers **"which
active fires can each tower currently see?"** using live NASA FIRMS satellite
data. A learning/portfolio project built in phases — see `README.md` for the
full setup narrative.

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
  - `WeatherObservation` (Phase 4) is one tower-day of the FWI noon inputs;
    `FireRiskAssessment` is the computed FWI-system codes + a 0–100 risk
    rating per tower-day; `IgnitionPrediction` (Phase 5) is one ML
    ignition-probability per tower-day, tagged with its `model_version`.
    `WatchtowerSite.latest_risk` / `latest_prediction` fetch the newest of each.
- **`towers/fire_weather.py`** (Phase 4) — pure Canadian FWI System math
  (FFMC/DMC/DC/ISI/BUI/FWI, snow over-wintering, `to_risk`), no Django/DB —
  validated against the van Wagner & Pickett (1985) reference vector.
- **`towers/schemas.py`** — Pydantic boundary validating third-party payloads
  (`OpenMeteoResponse`, `FirmsRow`) *before* anything reaches the DB.
- **`towers/ml/`** (Phase 5) — ignition-probability model. `dataset.py` (pure
  feature/label assembly, leakage-safe: features use only days ≤ t, label is a
  fire in `(t, t+H]`) and `model.py` (pure sklearn `Pipeline` wrapper) stay
  framework-free and unit-tested; `django_data.py` is the one DB-aware bridge
  joining `WeatherObservation` + `FireRiskAssessment` and deriving the fire
  calendar from `fires_in_range`.
- **`towers/viewshed.py`** — Phase 3 terrain line-of-sight. Reads Copernicus
  GLO-30 DEM tiles straight from AWS over HTTP (`/vsicurl/`, no download/creds),
  mosaics + reprojects to UTM with `gdalwarp`, runs `gdal_viewshed`, then
  polygonizes visible cells with rasterio/shapely back to 4326. **Shells out to
  the GDAL CLI** (`gdalbuildvrt`/`gdalwarp`/`gdal_viewshed`) — only available
  inside the Docker image.
- **`towers/views.py` + `towers/urls.py`** — thin GeoJSON/JSON API
  (`/api/towers.geojson`, `/api/fires.geojson`, `/api/towers/<id>/fires.geojson`,
  `/api/towers/<id>/risk.json`) plus `/` which renders
  `templates/towers/map.html`. Tower features carry the latest risk rating + ML
  ignition probability (both null-safe). `fires.geojson` accepts
  `?start=&end=&source=` (no params → all, for back-compat). Phase 6 adds three
  read-only aggregate endpoints behind the dashboard: `fires/timeseries.json`
  (daily counts by source over the full dataset + `min_date`/`max_date`),
  `fires/stats.json?start=&end=` (per-tower in-range counts + an FRP histogram,
  window-scoped), and `risk/timeseries.json` (per-day mean FWI risk + mean ML
  ignition). Views serialize models by hand; coordinates are always `[lon, lat]`.
- **Frontend (`assets/`)** — React + TypeScript + Vite app (MapLibre via
  [mapcn](https://www.mapcn.dev)) wired into Django by **django-vite**. Entry is
  `assets/main.tsx`; map logic in `assets/components/MapView.tsx`; vendored mapcn
  UI in `assets/components/ui/map.tsx`. Phase 6 makes it a **map-first analytics
  dashboard**: `assets/components/analytics/` holds a collapsible overlay
  (`AnalyticsPanel`) of recharts cards + a bottom `TimeRangeControl` (preset
  buttons + a brushable fires/day histogram). A single time window — anchored to
  the latest detection via `lib/time.ts`, *not* wall-clock now — drives both the
  filtered fires fetch and the cards. Fires render through `MapClusterLayer` to
  stay fast. Data via the shared `lib/useJson.ts` hook; charts use the shadcn
  `card`/`chart` primitives in `components/ui/`.
- **Management commands** (`towers/management/commands/`) — the ETL.
  `seed_towers` (27 real western-US lookouts across CA/CO/WA/OR), `ingest_fires`
  (FIRMS CSV → DB; pulls all three VIIRS NRT sensors — NOAA-20/SNPP/NOAA-21 — by
  default, isolating each so one failing sensor doesn't lose the others. Towers
  are clustered into tight per-region bboxes (`towers/clustering.py`) and queried
  one bbox at a time — a per-cluster failure is isolated like a per-sensor one,
  and a sensor only counts as failed if *every* cluster fails; `--start/--end`
  switches to the standard-processing **archive** sources, chunked into 5-day
  windows),
  `compute_viewsheds` (DEM → stored polygons; `--only-missing` skips towers that already have a viewshed, useful after adding new towers so existing ones aren't recomputed). Phase 4: `ingest_weather`
  (Open-Meteo forecast → `WeatherObservation`), `compute_fire_risk`
  (`WeatherObservation` → FWI codes → `FireRiskAssessment`, walked forward since
  the moisture codes are recursive). Phase 5: `backfill_weather` (Open-Meteo
  **archive** for history), `train_fire_model` (assemble → temporal split → fit
  + FWI-only baseline → joblib artifact + metrics JSON in git-ignored `models/`),
  `predict_ignition` (artifact → `IgnitionPrediction` per tower; no-op until a
  model is trained). All idempotent via `update_or_create`.

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
docker compose up --build                          # start db + web + scheduler
docker compose exec web python manage.py migrate   # PostGIS + schema
docker compose exec web python manage.py seed_towers
docker compose exec web python manage.py ingest_fires --day-range 3   # needs FIRMS_MAP_KEY in .env
docker compose exec web python manage.py compute_viewsheds            # ~1 min/tower
docker compose exec web python manage.py ingest_weather --day-range 7 # Phase 4: weather (no key)
docker compose exec web python manage.py compute_fire_risk            # Phase 4: FWI risk per tower

# Phase 5 — ML ignition prediction (one-time backfill, then train + predict)
docker compose exec web python manage.py backfill_weather --start 2024-05-01 --end 2025-11-01
docker compose exec web python manage.py ingest_fires --start 2024-05-01 --end 2025-11-01  # archive
docker compose exec web python manage.py compute_fire_risk           # FWI codes over the backfill
docker compose exec web python manage.py train_fire_model            # artifact + metrics JSON
docker compose exec web python manage.py predict_ignition            # IgnitionPrediction per tower

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

`docker compose up` also starts a **`scheduler`** sidecar (reuses the `web`
image) that **hourly** runs `ingest_fires --day-range 2` → `ingest_weather` →
`compute_fire_risk` → `predict_ignition` (each `|| true` so one failure never
kills the loop) to keep fire, weather, risk, and ML prediction data fresh — it
does one pass immediately on start, then loops every hour. `train_fire_model` is
**not** in the loop (a manual/occasional step); `predict_ignition` no-ops until
an artifact exists. Manual runs are still fine (idempotent). Watch it with
`docker compose logs -f scheduler`; it needs `FIRMS_MAP_KEY` set and the towers
seeded, and logs-and-retries if either is missing.

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
  each bbox tight by clustering towers into per-region groups
  (`towers/clustering.py`, single-linkage on coverage envelopes) and querying one
  small bbox per cluster, rather than a single continent-spanning envelope.
  `--day-range` is 1–10.
- This is a single-user project — auth machinery is intentionally minimal
  (`AUTH_PASSWORD_VALIDATORS = []`); don't add account infrastructure.
