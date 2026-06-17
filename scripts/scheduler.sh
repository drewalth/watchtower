#!/bin/sh
# Scheduler lifecycle, shared by the dev (docker-compose.yml) and prod
# (docker-compose.prod.yml) `scheduler` services so the step sequence lives in
# exactly ONE place (keeping it duplicated is what let dev silently skip
# viewsheds). Reuses the web image (GDAL et al. already baked in).
#
# On start, compute any missing viewsheds once (~30–60s/tower); `--track`
# records a kind=viewsheds IngestionRun so the status pill can show 0/27 → 27/27.
# `--only-missing` makes it idempotent across restarts. Then loop the hourly
# ingest cycle (ingest_fires → ingest_weather → compute_fire_risk →
# predict_ignition). Each line is `|| true` so one failure never kills the loop.

python manage.py compute_viewsheds --only-missing --track || true

while true; do
  python manage.py run_ingest_cycle || true
  sleep 3600
done
