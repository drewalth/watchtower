"""URL conf for the watchtower API surface and the single-page map view.

Every route here is a thin read-only endpoint — no authentication, no writes.
The GeoJSON endpoints (``/api/towers.geojson``, ``/api/fires.geojson``,
``/api/towers/<id>/fires.geojson``) are consumed by the MapLibre frontend.
The JSON aggregate endpoints (``fires/timeseries``, ``fires/stats``,
``risk/timeseries``) back the Phase 6 analytics dashboard cards.
``/api/ingestion/status.json`` lets the frontend poll whether an ETL cycle is
in progress, driving the status pill. All serialization is done by hand in
``views.py``; coordinates are always ``[lon, lat]`` (GeoJSON / XY convention).
"""
from django.urls import path

from . import views

urlpatterns = [
    path("", views.map_view, name="map"),
    path("api/towers.geojson", views.towers_geojson, name="towers-geojson"),
    path("api/fires.geojson", views.fires_geojson, name="fires-geojson"),
    path("api/fires/timeseries.json", views.fires_timeseries, name="fires-timeseries"),
    path("api/fires/stats.json", views.fires_stats, name="fires-stats"),
    path("api/risk/timeseries.json", views.risk_timeseries, name="risk-timeseries"),
    path("api/ingestion/status.json", views.ingestion_status, name="ingestion-status"),
    path(
        "api/towers/<int:tower_id>/fires.geojson",
        views.tower_fires_geojson,
        name="tower-fires-geojson",
    ),
    path(
        "api/towers/<int:tower_id>/risk.json",
        views.tower_risk,
        name="tower-risk",
    ),
]
