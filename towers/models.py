from django.contrib.gis.db import models
from django.contrib.gis.measure import D


class WatchtowerSite(models.Model):
    """A fire-lookout site: a camera/observer on a high vantage point.

    Geometry is stored in SRID 4326 (WGS84); math needing metres reprojects to a
    metric CRS on the fly (see ``coverage_area``). We never store projected coords.
    """

    name = models.CharField(max_length=200)
    # PointField defaults to spatial_index=True → a GiST index for fast lookups.
    location = models.PointField(srid=4326, spatial_index=True)
    elevation_m = models.FloatField(help_text="Metres above sea level.")
    coverage_radius_km = models.FloatField(
        default=20.0,
        help_text="Naive line-of-sight radius; used for the coverage model.",
    )
    # Terrain line-of-sight polygon (Phase 3). Populated by compute_viewsheds;
    # when present it supersedes the naive radius circle for coverage + queries.
    viewshed = models.MultiPolygonField(
        srid=4326, null=True, blank=True, spatial_index=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

    def _metric_srid(self):
        """WGS84/UTM SRID for this tower's longitude (northern hemisphere).

        Per-tower UTM gives accurate metre distances locally, unlike Web Mercator
        whose scale error grows with latitude.
        """
        zone = int((self.location.x + 180) // 6) + 1
        return 32600 + zone  # 326NN = WGS84 / UTM zone NN North

    def coverage_area(self):
        """Coverage polygon in EPSG:4326: the terrain viewshed if computed, else
        the radius circle (buffered in UTM metres, then reprojected back to 4326).
        """
        if self.viewshed is not None:
            return self.viewshed
        point = self.location.clone()
        point.transform(self._metric_srid())  # to metres
        circle = point.buffer(self.coverage_radius_km * 1000)
        circle.transform(4326)  # back to lat/lon for the web map
        return circle

    @property
    def coverage_kind(self):
        return "viewshed" if self.viewshed is not None else "circle"

    def fires_in_range(self, since=None):
        """FireDetections this tower can see: inside the viewshed polygon if one
        is computed, else within the radius. ``distance_lte`` uses 'spheroid' to
        measure true ground metres rather than degrees. ``since`` filters by recency.
        """
        if self.viewshed is not None:
            fires = FireDetection.objects.filter(location__intersects=self.viewshed)
        else:
            fires = FireDetection.objects.filter(
                location__distance_lte=(
                    self.location,
                    D(km=self.coverage_radius_km),
                    "spheroid",
                )
            )
        if since is not None:
            fires = fires.filter(acquired_at__gte=since)
        return fires


class FireDetection(models.Model):
    """A single satellite fire detection from NASA FIRMS (VIIRS)."""

    location = models.PointField(srid=4326, spatial_index=True)
    acquired_at = models.DateTimeField(help_text="UTC time of the satellite pass.")
    source = models.CharField(max_length=50, help_text="e.g. VIIRS_NOAA20_NRT")
    frp = models.FloatField(null=True, blank=True, help_text="Fire radiative power (MW).")
    confidence = models.CharField(max_length=20, help_text="FIRMS confidence, stored raw.")
    brightness = models.FloatField(null=True, blank=True, help_text="bright_ti4 (Kelvin).")
    # Stable dedup key built from lat/lon/time/source so re-ingesting is idempotent.
    external_uid = models.CharField(max_length=255, unique=True)

    def __str__(self):
        return f"{self.source} @ {self.acquired_at:%Y-%m-%d %H:%M} UTC"
