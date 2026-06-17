#!/bin/sh
# One-shot bootstrap, shared by the dev (docker-compose.yml) and prod
# (docker-compose.prod.yml) `init` services so the startup lifecycle is defined
# in exactly ONE place and the two stacks can't drift (a drift bug is what left
# viewsheds stuck at 0/27 in dev). Both web and scheduler wait on this via
# `service_completed_successfully`, so nothing touches the DB before the schema
# and seed data exist.
#
# Every step is idempotent:
#   - migrate skips already-applied migrations
#   - seed_towers uses update_or_create
#   - the demo admin only runs when DJANGO_SUPERUSER_USERNAME is set (prod sets
#     it, dev doesn't), so dev boots cleanly instead of logging a scary
#     CommandError; `|| true` keeps re-runs idempotent when the user exists.
set -e

python manage.py migrate --noinput
python manage.py seed_towers

if [ -n "$DJANGO_SUPERUSER_USERNAME" ]; then
  python manage.py createsuperuser --noinput || true
fi
