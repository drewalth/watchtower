from django.contrib.gis.db import models


class WatchtowerSite(models.Model):
    """A fire-lookout site: a camera/observer on a high vantage point.

    Geometry is stored in SRID 4326 (WGS84 lat/lon) because that's what our data
    sources and Leaflet use. Distance/area math that needs metres reprojects to a
    metric CRS on the fly (see Phase 2) — we never store projected coordinates.
    """

    name = models.CharField(max_length=200)
    # spatial_index=True (the PointField default) creates a GiST index on the
    # geometry, which is what makes spatial lookups (distance/within) fast.
    location = models.PointField(srid=4326, spatial_index=True)
    elevation_m = models.FloatField(help_text="Metres above sea level.")
    coverage_radius_km = models.FloatField(
        default=20.0,
        help_text="Naive line-of-sight radius; used for coverage in Phase 2.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
