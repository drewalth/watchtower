from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand

from towers.models import WatchtowerSite

# Naive coverage radius for the seeded lookouts. A staffed lookout on a high
# peak can realistically spot a smoke column tens of km out, so 50 km is a more
# representative "what can this tower see" radius than the 20 km model default.
# (Phase 3's viewshed replaces this circle with real terrain line-of-sight.)
DEFAULT_COVERAGE_KM = 50.0

# Five real California fire lookouts. Coordinates and elevations are approximate
# (sourced from public lookout listings) — good enough for a demo map. lon/lat
# order matters: PostGIS/GeoJSON are (x=lon, y=lat).
SEED_TOWERS = [
    {"name": "Sierra Buttes Lookout", "lon": -120.6417, "lat": 39.5953, "elevation_m": 2616},
    {"name": "Banner Mountain Lookout", "lon": -120.9840, "lat": 39.2360, "elevation_m": 824},
    {"name": "Mount Harkness Lookout", "lon": -121.2336, "lat": 40.4097, "elevation_m": 2553},
    {"name": "Boucher Hill Lookout", "lon": -116.9014, "lat": 33.3491, "elevation_m": 1660},
    {"name": "High Point Lookout", "lon": -116.8290, "lat": 33.3262, "elevation_m": 1853},
]


class Command(BaseCommand):
    help = "Seed the database with a handful of real California fire lookouts."

    def handle(self, *args, **options):
        created = updated = 0
        for tower in SEED_TOWERS:
            # update_or_create keyed on name makes this idempotent — re-running
            # refreshes the seed data instead of duplicating it.
            _, was_created = WatchtowerSite.objects.update_or_create(
                name=tower["name"],
                defaults={
                    "location": Point(tower["lon"], tower["lat"], srid=4326),
                    "elevation_m": tower["elevation_m"],
                    "coverage_radius_km": DEFAULT_COVERAGE_KM,
                },
            )
            created += was_created
            updated += not was_created

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded towers — created {created}, updated {updated}."
            )
        )
