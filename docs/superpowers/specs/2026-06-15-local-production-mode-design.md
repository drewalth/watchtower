# Local one-command production mode — design

**Date:** 2026-06-15
**Status:** Approved (design); pending spec review → implementation plan
**Scope:** Lower the barrier to entry. A contributor clones the repo and runs a
**single command in a single terminal tab** to bring up the whole stack in
**production mode** — gunicorn-served Django, a pre-built React bundle served by
WhiteNoise (`DEBUG=0`, no host Vite server), a migrated + seeded database, a
demo admin superuser, and the hourly data scheduler.

**Explicitly out of scope:** deploying to a real remote host. No HTTPS/HSTS/
secure-cookie hardening, no enforced production `SECRET_KEY`, no nginx, no
multi-host concerns. This is production *mode*, run *locally*, for demo and
onboarding.

## Goals

1. `make prod` → full production stack at <http://localhost:8000>, one tab.
2. No Node required on the host — the React bundle is built **inside** the image.
3. First boot is non-blocking: the app serves within seconds; the slow
   (~25 min) viewshed computation fills in behind it.
4. A demo admin login (`admin` / `admin`) exists at `/admin/` automatically.
5. Dev workflow is unchanged except for a one-time image rebuild.

## Key decisions (verified)

The static-serving mechanics were adversarially verified against django-vite
3.1.0 source, the WhiteNoise docs, and Django ticket #33353. Confirmed repo
facts: **Django 5.2.15**, django-vite **3.1.0**, **no `STATIC_ROOT`** today,
`DJANGO_VITE.manifest_path` already overridden to the source
`static/.vite/manifest.json`, `/static/` gitignored, **no `.dockerignore`**,
`gunicorn`/`whitenoise` not yet dependencies, `django_browser_reload` middleware
unconditional.

- **WSGI server:** gunicorn, sync workers. GeoDjango's GDAL/GEOS/PROJ are
  stateless C libs loaded via `ctypes` at import — fork-safe, no special gotcha.
  Do **not** use `--preload` (would require post-fork DB-connection recreation).
- **Static serving:** WhiteNoise, **`whitenoise.storage.CompressedStaticFilesStorage`**.
  *Not* the `Manifest` variant — its `collectstatic` post-processing rewrites
  `sourceMappingURL`/chunk references and raises `ValueError` on a
  referenced-but-missing `.map`, and `WHITENOISE_MANIFEST_STRICT=False` does not
  prevent it. Vite already content-hashes filenames, so the manifest layer adds
  risk and no value.
- **`STORAGES` dict** (Django 5.2), not the legacy `STATICFILES_STORAGE`
  (setting both raises `ImproperlyConfigured`).
- **django-vite stays as-is:** `dev_mode=DEBUG`; `manifest_path` keeps pointing
  at the *source* `static/.vite/manifest.json` (valid because the built `static/`
  is copied into the image). django-vite emits the tags but delegates byte
  serving to `staticfiles_storage.url()` → WhiteNoise.
- **`collectstatic` runs at image BUILD time**, not container start: `STATIC_ROOT`
  is baked into the immutable image (no runtime volume), so build-time gives
  fail-fast behavior and zero startup latency.
- **Frontend build:** multi-stage `Dockerfile.prod` (`node:24-slim` build stage →
  `python:3.12-slim` runtime). No Node in the final image.
- **Compose:** `docker-compose.prod.yml` is **self-contained** (not an override),
  run under its own project name `watchtower-prod`. Rationale: a compose override
  cannot *remove* the base `web` service's `.:/app` bind-mount, which would shadow
  the baked-in bundle; and a separate project name gives prod an isolated DB
  volume with no container-name collision against a running dev stack.
- **Entry point:** a `Makefile` is the discoverable home for every onboarding
  command.
- **Superuser:** Django's built-in `createsuperuser --noinput` reading
  `DJANGO_SUPERUSER_*` env vars, wrapped `|| true` for idempotency. No custom
  command. Insecure demo defaults (`admin`/`admin`) — acceptable, this is a
  single-user demo project (`AUTH_PASSWORD_VALIDATORS = []` already permits it).

## Service topology & boot sequence

```
db ──healthy──▶ init (one-shot, exits 0)
                  │  migrate → seed_towers → createsuperuser --noinput || true
                  │ completed_successfully
                  ├──▶ web        gunicorn, DEBUG=0, WhiteNoise (no bind-mount)
                  └──▶ scheduler  compute_viewsheds --only-missing (once)
                                  → loop: run_ingest_cycle; sleep 3600
```

`make prod` →
1. Build images (frontend compiled in `Dockerfile.prod` stage 1).
2. `db` starts → healthy.
3. `init` migrates, seeds the 27 towers, creates the demo superuser, **exits 0**.
4. `web` (gunicorn) + `scheduler` start. **App live at `:8000` in seconds**, on
   radius coverage, with a working `/admin/`.
5. `scheduler` computes viewsheds (~25 min, `--only-missing` → idempotent &
   restart-safe); coverage upgrades to terrain line-of-sight as each lands. Then
   it enters the hourly ingest loop (fires need `FIRMS_MAP_KEY`; absent key just
   means no fire points, the rest still works).

Because `init` runs to completion before `web`/`scheduler` start, there is no
seed-vs-viewshed race.

## Files

### New: `Dockerfile.prod`

```dockerfile
# Multi-stage production image. Stage 1 builds the React bundle with Node so the
# final image never ships Node. Stage 2 is the GeoDjango runtime (GDAL/GEOS/PROJ)
# that copies the built assets in and runs gunicorn. Dev keeps using ./Dockerfile.

# ---- Stage 1: build the Vite/React bundle ----
FROM node:24-slim AS assets
WORKDIR /app
# Lockfile first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.ts tsconfig.json components.json ./
COPY assets/ ./assets/
# vite.config sets outDir=./static (emptyOutDir:false), manifest:true
#   -> static/<hashed bundle> + static/.vite/manifest.json
RUN npm run build

# ---- Stage 2: GeoDjango runtime ----
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH" \
    DJANGO_SETTINGS_MODULE=config.settings \
    DJANGO_DEBUG=0

# GDAL/GEOS/PROJ for GeoDjango; gdal-bin is REQUIRED at runtime because
# towers/viewshed.py shells out to gdalbuildvrt/gdalwarp/gdal_viewshed.
RUN apt-get update && apt-get install -y --no-install-recommends \
        binutils \
        libproj-dev \
        gdal-bin \
        libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app
# Runtime deps only (no pytest/ruff). gunicorn + whitenoise must be in the lock.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .
# Built bundle + manifest from stage 1 overwrite the (gitignored) source static/.
COPY --from=assets /app/static/ ./static/

# Collect into STATIC_ROOT at build time (immutable image, fail-fast).
RUN python manage.py collectstatic --noinput

EXPOSE 8000
# Default CMD for `docker run`; compose overrides --workers via env.
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", "--workers", "3", \
     "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-"]
```

### New: `docker-compose.prod.yml`

Self-contained; run with `-p watchtower-prod`. Defaults make it work with no
`.env` (compose still auto-loads `.env` if present).

```yaml
# Self-contained PRODUCTION-MODE stack (local). Run via `make prod`, which uses
# project name `watchtower-prod` so it gets an isolated DB volume and never
# collides with the dev stack. NOT a `-f` override of docker-compose.yml — an
# override can't drop the dev bind-mount, which would shadow the baked bundle.

x-prod-env: &prod-env
  POSTGRES_DB: ${POSTGRES_DB:-watchtower}
  POSTGRES_USER: ${POSTGRES_USER:-watchtower}
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-watchtower}
  POSTGRES_HOST: db
  POSTGRES_PORT: 5432
  DJANGO_SECRET_KEY: ${DJANGO_SECRET_KEY:-dev-insecure-key-change-me}
  DJANGO_DEBUG: 0
  FIRMS_MAP_KEY: ${FIRMS_MAP_KEY:-}

x-app: &app
  build:
    context: .
    dockerfile: Dockerfile.prod
  image: watchtower-prod:latest

services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-watchtower}
      POSTGRES_USER: ${POSTGRES_USER:-watchtower}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-watchtower}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-watchtower} -d ${POSTGRES_DB:-watchtower}"]
      interval: 5s
      timeout: 5s
      retries: 5

  # One-shot bootstrap: schema, seed data, demo admin. Exits 0; web/scheduler
  # wait on it via service_completed_successfully (so there is no seed/viewshed race).
  init:
    <<: *app
    command: >
      sh -c 'python manage.py migrate --noinput &&
             python manage.py seed_towers &&
             (python manage.py createsuperuser --noinput || true)'
    environment:
      <<: *prod-env
      # Demo superuser (insecure on purpose — single-user demo). createsuperuser
      # --noinput reads these; `|| true` makes re-runs idempotent.
      DJANGO_SUPERUSER_USERNAME: ${DJANGO_SUPERUSER_USERNAME:-admin}
      DJANGO_SUPERUSER_PASSWORD: ${DJANGO_SUPERUSER_PASSWORD:-admin}
      DJANGO_SUPERUSER_EMAIL: ${DJANGO_SUPERUSER_EMAIL:-admin@example.com}
    depends_on:
      db:
        condition: service_healthy
    restart: "no"

  web:
    <<: *app
    command: >
      gunicorn config.wsgi:application --bind 0.0.0.0:8000
      --workers ${GUNICORN_WORKERS:-3} --timeout 120
      --access-logfile - --error-logfile -
    environment:
      <<: *prod-env
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy
      init:
        condition: service_completed_successfully
    restart: unless-stopped

  scheduler:
    <<: *app
    command: >
      sh -c 'python manage.py compute_viewsheds --only-missing || true;
             while true; do
               python manage.py run_ingest_cycle || true;
               sleep 3600;
             done'
    environment:
      <<: *prod-env
    depends_on:
      db:
        condition: service_healthy
      init:
        condition: service_completed_successfully
    restart: unless-stopped

volumes:
  pgdata:
```

### New: `.dockerignore`

Speeds up **both** image builds and prevents host artifacts from leaking into
the build context. (Today's `COPY . .` with no ignore bakes `node_modules` and
`.venv` into the image.)

```
.git
.venv
node_modules
static
staticfiles
models
.pytest_cache
.ruff_cache
__pycache__
*.pyc
.env
.DS_Store
docs
```

> Note: `static/` is ignored so the host's built bundle is never copied in — the
> Node stage regenerates it. In `Dockerfile.prod` the bundle reaches the runtime
> stage via `COPY --from=assets`, not the build context, so this is correct.
> The existing `Dockerfile` (dev) relies on the runtime Vite dev server, so it
> doesn't need host `static/` either.

### New: `Makefile`

`make help` is the default target.

```make
.DEFAULT_GOAL := help
COMPOSE      := docker compose
PROD         := docker compose -p watchtower-prod -f docker-compose.prod.yml

.PHONY: help setup prod prod-down prod-logs prod-rebuild superuser \
        dev dev-down seed migrate viewsheds ingest test lint typecheck build

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup:  ## First-time: create .env from .env.example if missing
	@test -f .env || (cp .env.example .env && echo "Created .env")

## ---- Production mode (local) ----
prod: setup  ## Build + run the full production stack at :8000 (one tab; Ctrl-C stops)
	$(PROD) up --build
prod-down:  ## Stop and remove the production stack
	$(PROD) down
prod-logs:  ## Follow production logs
	$(PROD) logs -f
prod-rebuild:  ## Rebuild prod images from scratch
	$(PROD) build --no-cache
superuser:  ## Create the demo admin superuser in the running prod stack
	$(PROD) exec web python manage.py createsuperuser

## ---- Development ----
dev: setup  ## Start dev backend (Docker) + Vite (host) — open :8000
	$(COMPOSE) up -d --build
	npm install && npm run dev
dev-down:  ## Stop the dev backend
	$(COMPOSE) down

## ---- Data / db (operate on the dev stack) ----
seed:  ## Seed the 27 lookout towers
	$(COMPOSE) exec web python manage.py seed_towers
migrate:  ## Apply migrations
	$(COMPOSE) exec web python manage.py migrate
viewsheds:  ## Compute viewsheds for towers missing one
	$(COMPOSE) exec web python manage.py compute_viewsheds --only-missing
ingest:  ## Run one ingest cycle (fires/weather/risk/predict)
	$(COMPOSE) exec web python manage.py run_ingest_cycle

## ---- Quality ----
test:  ## Run the pytest suite (in the container)
	$(COMPOSE) exec web pytest
lint:  ## Ruff lint
	$(COMPOSE) exec web ruff check .
typecheck:  ## TypeScript typecheck (host)
	npm run typecheck
build:  ## Build the frontend bundle (host)
	npm run build
```

### Changed: `config/settings.py`

```python
# --- Static files: ADD STATIC_ROOT (currently missing) ---
STATIC_URL = "static/"                      # must equal vite.config base "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"      # NEW: collectstatic target, served in prod
STATICFILES_DIRS = [BASE_DIR / "static"]    # unchanged: Vite outDir + manifest source

# --- WhiteNoise static storage (Django 5.2 STORAGES dict; do NOT also set
#     STATICFILES_STORAGE). CompressedStaticFilesStorage, NOT the Manifest
#     variant: Vite already content-hashes, and the Manifest backend's
#     reference-rewriting crashes collectstatic on Vite source-map refs. ---
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
```

`MIDDLEWARE`: insert WhiteNoise directly after `SecurityMiddleware`, and move the
DEBUG-only browser-reload middleware behind a `DEBUG` guard:

```python
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",   # NEW: right after Security
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
if DEBUG:
    # Reloads the browser when templates/static/Python change (dev only).
    MIDDLEWARE.append("django_browser_reload.middleware.BrowserReloadMiddleware")
```

`DJANGO_VITE` is unchanged (verified correct). No security/HTTPS block (out of
scope for local-only prod mode). `config/urls.py` needs **no** change — its
`__reload__/` endpoint is already a no-op outside DEBUG once the middleware is
gated.

### Changed: `pyproject.toml` / `uv.lock`

`uv add gunicorn whitenoise brotli` (runtime deps, so they install under
`uv sync --frozen --no-dev`). `whitenoise` becomes an import in `settings.py`, so
the **dev** image also needs it → one-time `docker compose build web`.

### Changed: `.env.example`

Append a documented demo-admin block:

```
# --- Django admin (demo superuser, auto-created by `make prod`) ---
# Insecure on purpose — this is a single-user demo project. Log in at /admin/.
DJANGO_SUPERUSER_USERNAME=admin
DJANGO_SUPERUSER_PASSWORD=admin
DJANGO_SUPERUSER_EMAIL=admin@example.com

# Optional: gunicorn worker count for `make prod` (default 3; ~(2*CPU)+1).
# GUNICORN_WORKERS=3
```

### Changed: `README.md`

Add a "Run in production mode (one command)" section:

```
make prod        # builds the bundle in-image, migrates, seeds, creates admin,
                 # then serves via gunicorn at http://localhost:8000

# Admin: http://localhost:8000/admin/  (admin / admin)
# make help lists every command.
```

Note that viewsheds compute in the background after first boot and that fire
ingest needs `FIRMS_MAP_KEY`.

## Dev is unchanged

`DEBUG=1` keeps django-vite in dev_mode (host Vite at `:5173`), keeps
browser-reload active, and keeps the existing `Dockerfile` + `docker-compose.yml`
bind-mount + `runserver` flow. The only dev-visible change is rebuilding the
image once to pick up WhiteNoise.

## Verification plan

After `make prod`:

1. **App serves prod bundle without Vite:** `curl -s localhost:8000/` returns 200
   and references hashed `/static/assets/*.js` (no `localhost:5173`); confirm no
   Vite dev server is running.
2. **Static assets load:** `curl -sI` a hashed asset URL → 200 from WhiteNoise
   (gzip/brotli `Content-Encoding`), not 404.
3. **Data present:** `/api/towers.geojson` returns the 27 seeded towers.
4. **Admin works:** `/admin/` login with `admin` / `admin` succeeds.
5. **Prod posture:** gunicorn (not runserver) serving; `DEBUG=0` (no
   browser-reload script injected).
6. **Background fill:** scheduler logs show `compute_viewsheds` then the hourly
   cycle; coverage upgrades to viewsheds over time.
7. **Dev still green:** `make test` passes in the dev image; `make dev` boots the
   map.

## Pitfalls (from verification — encode in implementation)

- Add `STATIC_ROOT`; without it `collectstatic` no-ops/fails.
- Use `CompressedStaticFilesStorage`, **never** `CompressedManifestStaticFilesStorage`.
- Use only the `STORAGES` dict (not `STATICFILES_STORAGE`) on Django 5.2.
- WhiteNoise middleware directly after `SecurityMiddleware`.
- `DEBUG=0` serves nothing at `STATIC_URL` without WhiteNoise — collectstatic
  alone yields 404s.
- Keep `gdal-bin` in the runtime stage (viewshed shells out to the CLI).
- Keep `emptyOutDir: false` and `manifest_path` on the source `static/.vite/`.
- `/static/` is gitignored — the Node stage must regenerate it; never rely on a
  host copy.
- `npm run build` does not type-check — `make typecheck` is separate.
- Don't use gunicorn `--preload`.
```
