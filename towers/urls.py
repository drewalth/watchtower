from django.urls import path

from . import views

urlpatterns = [
    path("", views.map_view, name="map"),
    path("api/towers.geojson", views.towers_geojson, name="towers-geojson"),
    path("api/fires.geojson", views.fires_geojson, name="fires-geojson"),
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
