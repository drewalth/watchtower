from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import (
    FireDetection,
    FireRiskAssessment,
    WatchtowerSite,
    WeatherObservation,
)


@admin.register(WatchtowerSite)
class WatchtowerSiteAdmin(GISModelAdmin):
    # GISModelAdmin renders an interactive map widget for the PointField.
    list_display = ("name", "elevation_m", "coverage_radius_km", "fuel_type", "created_at")
    list_filter = ("fuel_type",)
    search_fields = ("name",)


@admin.register(FireDetection)
class FireDetectionAdmin(GISModelAdmin):
    list_display = ("source", "acquired_at", "confidence", "frp", "brightness")
    list_filter = ("source", "confidence")
    date_hierarchy = "acquired_at"


@admin.register(WeatherObservation)
class WeatherObservationAdmin(admin.ModelAdmin):
    list_display = ("tower", "date", "temp_c", "rh_pct", "wind_kph", "precip_24h_mm", "snow_depth_cm")
    list_filter = ("tower", "source")
    date_hierarchy = "date"


@admin.register(FireRiskAssessment)
class FireRiskAssessmentAdmin(admin.ModelAdmin):
    list_display = ("tower", "date", "risk_level", "risk_score", "fwi", "snow_covered")
    list_filter = ("risk_level", "tower", "snow_covered")
    date_hierarchy = "date"
