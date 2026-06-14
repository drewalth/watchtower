from django.contrib.gis.db import models
from django.contrib.gis.measure import D


class WatchtowerSite(models.Model):
    """A fire-lookout site: a camera/observer on a high vantage point.

    Geometry is stored in SRID 4326 (WGS84 lat/lon) because that's what our data
    sources and Leaflet use. Distance/area math that needs metres reprojects to a
    metric CRS on the fly (see ``coverage_area``) — we never store projected
    coordinates.
    """

    name = models.CharField(max_length=200)
    # spatial_index=True (the PointField default) creates a GiST index on the
    # geometry, which is what makes spatial lookups (distance/within) fast.
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
        """The UTM zone SRID for this tower's longitude (northern hemisphere).

        UTM gives accurate distances in metres for a local area — far better
        than buffering in Web Mercator (EPSG:3857), whose scale error grows with
        latitude (~28% at California's ~38°N). We pick the zone per tower.
        """
        zone = int((self.location.x + 180) // 6) + 1
        return 32600 + zone  # 326NN = WGS84 / UTM zone NN North

    def coverage_area(self):
        """Coverage polygon in EPSG:4326.

        Returns the computed terrain viewshed when available; otherwise the
        naive radius circle. CRS lesson for the circle: you can't buffer in
        degrees and get metres — reproject the point to a metric CRS (the local
        UTM zone), buffer by the radius in metres, then reproject back to 4326.
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
        """FireDetections this tower can see.

        With a computed viewshed, "can see" means inside the terrain
        line-of-sight polygon. Without one, it falls back to the naive radius:
        the 'spheroid' option makes ``distance_lte`` measure true ground metres
        on the WGS84 spheroid rather than degrees on the 4326 geometry column.
        ``since`` optionally restricts to recent detections.
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
