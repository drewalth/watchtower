from django.urls import path

from . import views

urlpatterns = [
    path("", views.map_view, name="map"),
    path("api/towers.geojson", views.towers_geojson, name="towers-geojson"),
]
