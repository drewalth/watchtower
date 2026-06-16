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
