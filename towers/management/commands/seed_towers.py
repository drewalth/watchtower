"""Seed the database with 27 real western-US fire lookout towers.

This is a one-time bootstrap (idempotent via ``update_or_create`` on the tower
name) that populates ``WatchtowerSite`` with hand-verified lookout coordinates
across California, Colorado, Washington, and Oregon. These specific sites were
chosen because they are geographically spread enough to exercise the FIRMS
clustering logic while staying within regions that regularly see wildfire
activity.

``fuel_type`` is a coarse assignment based on each site's dominant surrounding
vegetation, used by ``fire_weather.to_risk`` to scale the FWI index. The 50 km
``coverage_radius_km`` is a generous real-world smoke-spotting radius; Phase 3's
``compute_viewsheds`` replaces it with actual terrain line-of-sight.
"""

from django.contrib.gis.geos import Point
from django.core.management.base import BaseCommand

from towers.models import FuelType, WatchtowerSite

# Naive coverage radius for the seeded lookouts. A staffed lookout on a high
# peak can realistically spot a smoke column tens of km out, so 50 km is a more
# representative "what can this tower see" radius than the 20 km model default.
# (Phase 3's viewshed replaces this circle with real terrain line-of-sight.)
DEFAULT_COVERAGE_KM = 50.0

# Real western-US fire lookouts across California, Colorado, Washington, and
# Oregon. Coordinates and elevations are approximate (sourced from public lookout
# listings, cross-checked against 2+ sources) — good enough for a demo map.
# lon/lat order matters: PostGIS/GeoJSON are (x=lon, y=lat). fuel_type is a coarse
# take on the dominant surrounding vegetation; it scales each tower's fire-weather
# risk. The towers cluster naturally by region, which the FIRMS ingest relies on
# to keep each satellite query's bounding box small.
SEED_TOWERS = [
    # California lookouts
    {
        "name": "Sierra Buttes Lookout",
        "lon": -120.6417,
        "lat": 39.5953,
        "elevation_m": 2616,
        "fuel_type": FuelType.CONIFER,
        "state": "CA",
    },
    {
        "name": "Banner Mountain Lookout",
        "lon": -120.9840,
        "lat": 39.2360,
        "elevation_m": 824,
        "fuel_type": FuelType.MIXED,
        "state": "CA",
    },
    {
        "name": "Mount Harkness Lookout",
        "lon": -121.2336,
        "lat": 40.4097,
        "elevation_m": 2553,
        "fuel_type": FuelType.CONIFER,
        "state": "CA",
    },
    {
        "name": "Boucher Hill Lookout",
        "lon": -116.9014,
        "lat": 33.3491,
        "elevation_m": 1660,
        "fuel_type": FuelType.SHRUB,
        "state": "CA",
    },
    {
        "name": "High Point Lookout",
        "lon": -116.8290,
        "lat": 33.3262,
        "elevation_m": 1853,
        "fuel_type": FuelType.SHRUB,
        "state": "CA",
    },
    # Colorado lookouts
    {
        "name": "Devils Head Lookout",
        "lon": -105.1018,
        "lat": 39.2604,
        "elevation_m": 2971,
        "fuel_type": FuelType.CONIFER,
        "state": "CO",
    },
    {
        "name": "Mestaa'ehehe Mountain Lookout",
        "lon": -105.4930,
        "lat": 39.6789,
        "elevation_m": 3505,
        "fuel_type": FuelType.CONIFER,
        "state": "CO",
    },
    {
        "name": "Jersey Jim Lookout",
        "lon": -108.1840,
        "lat": 37.4975,
        "elevation_m": 2992,
        "fuel_type": FuelType.CONIFER,
        "state": "CO",
    },
    {
        "name": "Shadow Mountain Lookout",
        "lon": -105.8144,
        "lat": 40.2306,
        "elevation_m": 3024,
        "fuel_type": FuelType.CONIFER,
        "state": "CO",
    },
    {
        "name": "Fairview Peak Lookout",
        "lon": -106.5368,
        "lat": 38.6833,
        "elevation_m": 4028,
        "fuel_type": FuelType.SPARSE,
        "state": "CO",
    },
    {
        "name": "Hahns Peak Lookout",
        "lon": -106.9297,
        "lat": 40.8431,
        "elevation_m": 3304,
        "fuel_type": FuelType.CONIFER,
        "state": "CO",
    },
    # Washington lookouts
    {
        "name": "Mount Pilchuck Lookout",
        "lon": -121.7978,
        "lat": 48.0580,
        "elevation_m": 1629,
        "fuel_type": FuelType.CONIFER,
        "state": "WA",
    },
    {
        "name": "Heybrook Lookout",
        "lon": -121.5254,
        "lat": 47.8108,
        "elevation_m": 556,
        "fuel_type": FuelType.CONIFER,
        "state": "WA",
    },
    {
        "name": "Winchester Mountain Lookout",
        "lon": -121.6431,
        "lat": 48.9566,
        "elevation_m": 1988,
        "fuel_type": FuelType.CONIFER,
        "state": "WA",
    },
    {
        "name": "Evergreen Mountain Lookout",
        "lon": -121.2662,
        "lat": 47.8364,
        "elevation_m": 1703,
        "fuel_type": FuelType.CONIFER,
        "state": "WA",
    },
    {
        "name": "Park Butte Lookout",
        "lon": -121.8563,
        "lat": 48.7165,
        "elevation_m": 1663,
        "fuel_type": FuelType.CONIFER,
        "state": "WA",
    },
    {
        "name": "Desolation Peak Lookout",
        "lon": -121.0162,
        "lat": 48.9112,
        "elevation_m": 1860,
        "fuel_type": FuelType.CONIFER,
        "state": "WA",
    },
    {
        "name": "Three Fingers Lookout",
        "lon": -121.6864,
        "lat": 48.1700,
        "elevation_m": 2088,
        "fuel_type": FuelType.SPARSE,
        "state": "WA",
    },
    {
        "name": "Hidden Lake Lookout",
        "lon": -121.2046,
        "lat": 48.4954,
        "elevation_m": 2087,
        "fuel_type": FuelType.SPARSE,
        "state": "WA",
    },
    # Oregon lookouts
    {
        "name": "Hager Mountain Lookout",
        "lon": -121.0317,
        "lat": 43.0094,
        "elevation_m": 2191,
        "fuel_type": FuelType.CONIFER,
        "state": "OR",
    },
    {
        "name": "Pickett Butte Lookout",
        "lon": -122.8547,
        "lat": 42.9437,
        "elevation_m": 975,
        "fuel_type": FuelType.CONIFER,
        "state": "OR",
    },
    {
        "name": "Fivemile Butte Lookout",
        "lon": -121.4711,
        "lat": 45.4103,
        "elevation_m": 1416,
        "fuel_type": FuelType.CONIFER,
        "state": "OR",
    },
    {
        "name": "Indian Ridge Lookout",
        "lon": -122.2536,
        "lat": 44.0056,
        "elevation_m": 1647,
        "fuel_type": FuelType.CONIFER,
        "state": "OR",
    },
    {
        "name": "Warner Mountain Lookout",
        "lon": -122.3664,
        "lat": 43.5434,
        "elevation_m": 1615,
        "fuel_type": FuelType.CONIFER,
        "state": "OR",
    },
    {
        "name": "Green Ridge Lookout",
        "lon": -121.6087,
        "lat": 44.5337,
        "elevation_m": 1429,
        "fuel_type": FuelType.CONIFER,
        "state": "OR",
    },
    {
        "name": "Clear Lake Butte Lookout",
        "lon": -121.7192,
        "lat": 45.1568,
        "elevation_m": 1358,
        "fuel_type": FuelType.CONIFER,
        "state": "OR",
    },
    {
        "name": "Gold Butte Lookout",
        "lon": -122.0832,
        "lat": 44.8052,
        "elevation_m": 1408,
        "fuel_type": FuelType.CONIFER,
        "state": "OR",
    },
]


class Command(BaseCommand):
    help = (
        "Seed the database with real western-US fire lookouts "
        "(California, Colorado, Washington, Oregon)."
    )

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
                    "state": tower["state"],
                    "fuel_type": tower["fuel_type"],
                },
            )
            created += was_created
            updated += not was_created

        self.stdout.write(
            self.style.SUCCESS(f"Seeded towers — created {created}, updated {updated}.")
        )
