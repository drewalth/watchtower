# Contributing

This is a solo portfolio project, not a community-maintained library. That said,
if you're reading this because you forked it or want to adapt it, here's how the
development environment works.

## Why Docker for the backend?

Django, GeoDjango, PostGIS, GDAL, GEOS, and PROJ are tightly coupled at the
native-library level. Those native libs live only inside the Docker image. If
you run `manage.py` directly on your host you'll hit import errors for `gdal`
or `geos` unless you've built them yourself. **Always run Python/Django commands
through `docker compose exec web`** (or `docker compose run --rm web`).

Node and Vite have no such constraint and run fine on the host.

## Stack requirements

- Docker + Docker Compose v2 (the `docker compose` plugin, not `docker-compose`)
- Node 24 (`.nvmrc` is present — `nvm use` picks it up)
- A `FIRMS_MAP_KEY` in `.env` for live fire ingest (not needed to run tests)

## Running the stack

```bash
# First time: copy env defaults
cp .env.example .env

# Dev mode: Django in Docker, Vite on the host
docker compose up --build   # starts db + init (migrate + seed) + web
npm install && npm run dev  # Vite HMR on :5173 — open Django at :8000

# Or use make (wraps the above):
make dev

# Production mode (gunicorn + whitenoise, pre-built bundle):
make prod
```

The `init` service runs migrations and tower seeding exactly once, before `web`
starts — you don't need to run `migrate` or `seed_towers` manually on a fresh
stack.

## Tests, lint, and type checks

```bash
# Python tests (pytest-django; needs PostGIS → runs in the container)
docker compose exec web pytest
# or: make test

# Python lint (ruff)
docker compose exec web ruff check .
# or: make lint

# TypeScript type-check (strict; host)
npm run typecheck
# or: make typecheck

# Frontend unit tests (vitest)
npm run test

# Production bundle (host)
npm run build
# or: make build
```

## Adding Python dependencies

Use `uv`, not pip:

```bash
uv add <package>          # runtime dependency
uv add --dev <package>    # dev/test only
docker compose build web  # rebuild the image to pick it up
```

## Commit style

This repo follows [Conventional Commits](https://www.conventionalcommits.org/):
`feat`, `fix`, `docs`, `chore`, `refactor`, `test`. One subject line, imperative
mood, under 72 characters.

## More detail

See `README.md` for the full setup narrative and phase-by-phase feature
overview, and `ARCHITECTURE.md` for the spatial data model, ETL pipeline, and
design decisions.
