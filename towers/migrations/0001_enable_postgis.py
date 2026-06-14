from django.contrib.postgres.operations import CreateExtension
from django.db import migrations


class Migration(migrations.Migration):
    """Enable the PostGIS extension before any spatial tables are created.

    CreateExtension emits ``CREATE EXTENSION IF NOT EXISTS postgis`` and is
    reversible. The postgis Docker image usually enables it on the default
    database already, but keeping it in a migration means a fresh database
    (or a different Postgres) is set up correctly too.
    """

    initial = True

    dependencies = []

    operations = [
        CreateExtension("postgis"),
    ]
