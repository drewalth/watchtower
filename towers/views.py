import json

from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render

from .models import FireDetection, WatchtowerSite


def map_view(request):
    """Render the map page; the React app fetches its data from the API."""
    return render(request, "towers/map.html")


def towers_geojson(request):
    """All towers as a GeoJSON FeatureCollection.

    Each feature carries its coverage polygon and a live in-range fire count.
    Coordinates are [lon, lat] per the GeoJSON spec.
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
                # Latest fire-risk rating (None until compute_fire_risk has run).
                **_risk_summary(site.latest_risk),
                # GEOSGeometry.geojson is a string; parse so it nests as JSON.
                "coverage": json.loads(site.coverage_area().geojson),
            },
        }
        for site in WatchtowerSite.objects.all()
    ]
    return JsonResponse({"type": "FeatureCollection", "features": features})


def _risk_summary(assessment):
    """Compact latest-risk fields for the towers feed (markers + legend)."""
    if assessment is None:
        return {"risk_level": None, "risk_score": None, "risk_date": None}
    return {
        "risk_level": assessment.risk_level,
        "risk_score": assessment.risk_score,
        "risk_date": assessment.date.isoformat(),
    }


def fires_geojson(request):
    """All fire detections as a GeoJSON FeatureCollection."""
    return _fire_collection(FireDetection.objects.all())


def tower_fires_geojson(request, tower_id):
    """Fire detections within a single tower's coverage radius."""
    tower = get_object_or_404(WatchtowerSite, pk=tower_id)
    return _fire_collection(tower.fires_in_range())


def tower_risk(request, tower_id):
    """A single tower's recent fire-risk series + contributing FWI factors.

    Powers the risk panel: latest-first assessments, each with the moisture
    codes and indices behind the score so the user can see *why* risk is what
    it is.
    """
    tower = get_object_or_404(WatchtowerSite, pk=tower_id)
    series = [
        {
            "date": a.date.isoformat(),
            "risk_level": a.risk_level,
            "risk_score": a.risk_score,
            "fwi": a.fwi,
            "ffmc": a.ffmc,
            "dmc": a.dmc,
            "dc": a.dc,
            "isi": a.isi,
            "bui": a.bui,
            "snow_covered": a.snow_covered,
        }
        for a in tower.risk_assessments.order_by("-date")
    ]
    return JsonResponse(
        {
            "tower": {
                "id": tower.id,
                "name": tower.name,
                "fuel_type": tower.fuel_type,
            },
            "series": series,
        }
    )


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
