from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import FireDetection, WatchtowerSite


@admin.register(WatchtowerSite)
class WatchtowerSiteAdmin(GISModelAdmin):
    # GISModelAdmin renders an interactive map widget for the PointField.
    list_display = ("name", "elevation_m", "coverage_radius_km", "created_at")
    search_fields = ("name",)


@admin.register(FireDetection)
class FireDetectionAdmin(GISModelAdmin):
    list_display = ("source", "acquired_at", "confidence", "frp", "brightness")
    list_filter = ("source", "confidence")
    date_hierarchy = "acquired_at"
