import json

from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render

from .models import FireDetection, WatchtowerSite


def map_view(request):
    """Render the Leaflet dashboard. The map fetches its data from the API."""
    return render(request, "towers/map.html")


def towers_geojson(request):
    """All towers as a GeoJSON FeatureCollection.

    Each feature carries its coverage polygon (the reprojected buffer) and a
    live count of fires currently in range, so the map can draw coverage and
    show counts in popups. Coordinates are [lon, lat] per the GeoJSON spec.
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
                "fire_count": site.fires_in_range().count(),
                # "viewshed" (terrain line-of-sight) or "circle" (naive radius).
                "coverage_kind": site.coverage_kind,
                # GEOSGeometry.geojson is a string; parse so it nests as JSON.
                "coverage": json.loads(site.coverage_area().geojson),
            },
        }
        for site in WatchtowerSite.objects.all()
    ]
    return JsonResponse({"type": "FeatureCollection", "features": features})


def fires_geojson(request):
    """All fire detections as a GeoJSON FeatureCollection."""
    return _fire_collection(FireDetection.objects.all())


def tower_fires_geojson(request, tower_id):
    """Fire detections within a single tower's coverage radius."""
    tower = get_object_or_404(WatchtowerSite, pk=tower_id)
    return _fire_collection(tower.fires_in_range())


def _fire_collection(fires):
    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [fire.location.x, fire.location.y],
            },
            "properties": {
                "id": fire.id,
                "source": fire.source,
                "frp": fire.frp,
                "confidence": fire.confidence,
                "brightness": fire.brightness,
                "acquired_at": fire.acquired_at.isoformat(),
            },
        }
        for fire in fires
    ]
    return JsonResponse({"type": "FeatureCollection", "features": features})
