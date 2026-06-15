from django.contrib.gis.db import models
from django.contrib.gis.measure import D


class FuelType(models.TextChoices):
    """Dominant vegetation/fuel around a tower — a coarse flammability proxy."""

    SPARSE = "sparse", "Sparse / rock"
    GRASS = "grass", "Grass"
    MIXED = "mixed", "Mixed forest"
    SHRUB = "shrub", "Shrub / chaparral"
    CONIFER = "conifer", "Conifer / timber"


# Multiplier applied to the FWI before risk scoring (see fire_weather.to_risk):
# 1.0 is neutral; sparse fuels damp risk, flammable conifer/chaparral amplify it.
_FUEL_FACTORS = {
    FuelType.SPARSE: 0.6,
    FuelType.GRASS: 0.9,
    FuelType.MIXED: 1.0,
    FuelType.SHRUB: 1.15,
    FuelType.CONIFER: 1.25,
}


class RiskLevel(models.TextChoices):
    LOW = "low", "Low"
    MODERATE = "moderate", "Moderate"
    HIGH = "high", "High"
    VERY_HIGH = "very_high", "Very high"
    EXTREME = "extreme", "Extreme"


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
    fuel_type = models.CharField(
        max_length=20,
        choices=FuelType.choices,
        default=FuelType.MIXED,
        help_text="Dominant fuel; scales the fire-weather risk for this tower.",
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

    @property
    def fuel_factor(self):
        """Vegetation multiplier for risk scoring (see fire_weather.to_risk)."""
        return _FUEL_FACTORS.get(self.fuel_type, 1.0)

    @property
    def latest_risk(self):
        """Most recent FireRiskAssessment for this tower, or None if none yet."""
        return self.risk_assessments.order_by("-date").first()

    @property
    def latest_prediction(self):
        """Most recent ML IgnitionPrediction for this tower, or None if none yet."""
        return self.predictions.order_by("-date", "-created_at").first()

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


class WeatherObservation(models.Model):
    """One tower-day of the noon weather inputs the FWI system consumes.

    Stored as a daily time series per tower so the recursive moisture codes can be
    walked forward. Deduped on a stable ``external_uid`` (tower/date/source) so
    re-ingesting is idempotent — same pattern as FireDetection.
    """

    tower = models.ForeignKey(
        WatchtowerSite, on_delete=models.CASCADE, related_name="weather"
    )
    date = models.DateField(help_text="Local calendar day of the observation.")
    temp_c = models.FloatField(help_text="Daily max temperature (°C), noon proxy.")
    rh_pct = models.FloatField(help_text="Daily min relative humidity (%).")
    wind_kph = models.FloatField(help_text="Daily max wind speed (km/h).")
    precip_24h_mm = models.FloatField(help_text="24h precipitation total (mm).")
    snow_depth_cm = models.FloatField(help_text="Snow on the ground (cm).")
    source = models.CharField(max_length=50, default="open-meteo")
    external_uid = models.CharField(max_length=255, unique=True)

    class Meta:
        ordering = ["tower", "date"]

    def __str__(self):
        return f"{self.tower.name} weather {self.date}"


class FireRiskAssessment(models.Model):
    """One tower-day of computed FWI-system indices + the derived risk rating."""

    tower = models.ForeignKey(
        WatchtowerSite, on_delete=models.CASCADE, related_name="risk_assessments"
    )
    date = models.DateField()
    ffmc = models.FloatField(help_text="Fine Fuel Moisture Code.")
    dmc = models.FloatField(help_text="Duff Moisture Code.")
    dc = models.FloatField(help_text="Drought Code.")
    isi = models.FloatField(help_text="Initial Spread Index.")
    bui = models.FloatField(help_text="Buildup Index.")
    fwi = models.FloatField(help_text="Fire Weather Index.")
    risk_score = models.FloatField(help_text="FWI scaled to 0–100 for display.")
    risk_level = models.CharField(max_length=20, choices=RiskLevel.choices)
    snow_covered = models.BooleanField(
        default=False, help_text="Ground snow-covered → fire risk suppressed."
    )

    class Meta:
        ordering = ["tower", "date"]
        unique_together = ("tower", "date")

    def __str__(self):
        return f"{self.tower.name} risk {self.date}: {self.risk_level}"


class IgnitionPrediction(models.Model):
    """One ML-predicted ignition probability for a tower-day (Phase 5).

    Kept in its own table — decoupled from the deterministic FireRiskAssessment,
    independently re-runnable, and explicit about provenance via ``model_version``.
    The probability answers: given conditions known on ``date``, how likely is at
    least one FIRMS detection inside this tower's coverage within ``horizon_days``?
    """

    tower = models.ForeignKey(
        WatchtowerSite, on_delete=models.CASCADE, related_name="predictions"
    )
    date = models.DateField(help_text="Day the prediction was made for (its 'as of').")
    probability = models.FloatField(help_text="Calibrated P(ignition) in [0, 1].")
    horizon_days = models.IntegerField(
        help_text="Forecast window: a fire within (date, date + horizon_days]."
    )
    model_version = models.CharField(
        max_length=64, help_text="Identifies the trained artifact behind this value."
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["tower", "-date"]
        unique_together = ("tower", "date", "model_version")

    def __str__(self):
        return (
            f"{self.tower.name} P(ignition)={self.probability:.2f} "
            f"@ {self.date} ({self.horizon_days}d, {self.model_version})"
        )
