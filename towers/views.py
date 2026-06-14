from django.http import JsonResponse
from django.shortcuts import render

from .models import WatchtowerSite


def map_view(request):
    """Render the Leaflet dashboard. The map fetches its data from the API."""
    return render(request, "towers/map.html")


def towers_geojson(request):
    """Return all towers as a GeoJSON FeatureCollection.

    Hand-built rather than using a library — it's more instructive and the
    structure is simple. Coordinates are [lon, lat] per the GeoJSON spec.
    """
    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [site.location.x, site.location.y],
            },
            "properties": {
                "id": site.id,
                "name": site.name,
                "elevation_m": site.elevation_m,
                "coverage_radius_km": site.coverage_radius_km,
            },
        }
        for site in WatchtowerSite.objects.all()
    ]
    return JsonResponse({"type": "FeatureCollection", "features": features})
