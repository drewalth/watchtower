from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin

from .models import WatchtowerSite


@admin.register(WatchtowerSite)
class WatchtowerSiteAdmin(GISModelAdmin):
    # GISModelAdmin renders an interactive map widget for the PointField.
    list_display = ("name", "elevation_m", "coverage_radius_km", "created_at")
    search_fields = ("name",)
