# Watchtower

A GeoDjango + PostGIS web map of wildfire lookout cameras that answers:
**"which active fires can each tower currently see?"** using live NASA FIRMS
satellite data.

This is a learning/portfolio project for geospatial data engineering. It is
built in phases — see [`watchtower-plan.md`](watchtower-plan.md).

> **Status:** Phase 1 complete — watchtower model + Leaflet map.

## Tech stack

- Python 3.12, Django 5.x with GeoDjango (`django.contrib.gis`)
- PostgreSQL 16 + PostGIS 3.4
- Docker + docker-compose (so you never install GDAL/GEOS/PROJ on the host)
- [uv](https://docs.astral.sh/uv/) for Python dependency management
- Leaflet (CDN) for the map (Phase 1+)

## Prerequisites

- **Docker Desktop** installed and running.
- *(Phase 2+)* A free **NASA FIRMS `MAP_KEY`**. Request one at
  <https://firms.modaps.eosdis.nasa.gov/api/map_key/> and put it in `.env` as
  `FIRMS_MAP_KEY=...`. Not needed for Phase 0/1.

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
```

The web service runs the Django dev server at <http://localhost:8000>:

- `/` — Leaflet map showing the lookout towers as markers.
- `/api/towers.geojson` — towers as a GeoJSON `FeatureCollection`.
- `/admin/` — Django admin (with a map widget for tower locations).

`seed_towers` is idempotent — re-running it refreshes the seed data rather than
duplicating it.

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
