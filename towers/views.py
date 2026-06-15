import json
from datetime import date

from django.db.models import Avg, Count, Max, Min
from django.db.models.functions import TruncDate
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, render

from .models import (
    FireDetection,
    FireRiskAssessment,
    IgnitionPrediction,
    WatchtowerSite,
)

# FRP (fire radiative power, MW) magnitude bins for the intensity histogram.
# Open upper bound (None) catches the long tail of very hot detections.
FRP_BUCKETS = [(0, 10), (10, 50), (50, 100), (100, 500), (500, None)]


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
                # Latest ML ignition probability (None until a model is trained).
                **_prediction_summary(site.latest_prediction),
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


def _prediction_summary(prediction):
    """Compact latest ML-prediction fields for the towers feed (null-safe)."""
    if prediction is None:
        return {
            "ignition_probability": None,
            "horizon_days": None,
            "model_version": None,
        }
    return {
        "ignition_probability": prediction.probability,
        "horizon_days": prediction.horizon_days,
        "model_version": prediction.model_version,
    }


def fires_geojson(request):
    """Fire detections as GeoJSON, optionally filtered by date window + source.

    Query params (all optional): ``start``/``end`` (ISO dates, inclusive, matched
    on the detection's UTC calendar day) and ``source``. With no params it
    returns every detection (back-compat); the dashboard always passes a window
    so the map isn't asked to draw the whole archive at once.
    """
    return _fire_collection(_filter_fires(FireDetection.objects.all(), request))


def _parse_date(value):
    """An ISO date string → ``date``; None for missing or malformed input."""
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _filter_fires(qs, request):
    """Apply the shared ``start``/``end``/``source`` query filters to a fire qs."""
    start = _parse_date(request.GET.get("start"))
    end = _parse_date(request.GET.get("end"))
    source = request.GET.get("source")
    if start:
        qs = qs.filter(acquired_at__date__gte=start)
    if end:
        qs = qs.filter(acquired_at__date__lte=end)
    if source:
        qs = qs.filter(source=source)
    return qs


def fires_timeseries(request):
    """Daily fire-detection counts over the whole dataset, broken down by source.

    One lightweight call powers the brush histogram, the fires-over-time chart,
    and the source-breakdown card (the frontend slices it to the selected
    window). ``min_date``/``max_date`` let the UI anchor presets to the most
    recent detection rather than wall-clock now.
    """
    rows = (
        FireDetection.objects.annotate(day=TruncDate("acquired_at"))
        .values("day", "source")
        .annotate(count=Count("id"))
        .order_by("day")
    )
    series = [
        {"date": r["day"].isoformat(), "source": r["source"], "count": r["count"]}
        for r in rows
    ]
    bounds = FireDetection.objects.aggregate(
        min_at=Min("acquired_at"), max_at=Max("acquired_at")
    )
    return JsonResponse(
        {
            "series": series,
            "min_date": bounds["min_at"].date().isoformat() if bounds["min_at"] else None,
            "max_date": bounds["max_at"].date().isoformat() if bounds["max_at"] else None,
        }
    )


def fires_stats(request):
    """Window-scoped aggregates that need per-tower or raw-row data.

    Per-tower in-range counts (using each tower's *same* coverage definition as
    the map) plus an FRP-intensity histogram, all within the ``start``/``end``
    window. Kept separate from ``fires_timeseries`` because these can't be summed
    from per-day rows.
    """
    start = _parse_date(request.GET.get("start"))
    end = _parse_date(request.GET.get("end"))

    per_tower = []
    for tower in WatchtowerSite.objects.all():
        fires = tower.fires_in_range()
        if start:
            fires = fires.filter(acquired_at__date__gte=start)
        if end:
            fires = fires.filter(acquired_at__date__lte=end)
        per_tower.append({"id": tower.id, "name": tower.name, "count": fires.count()})

    window = _filter_fires(FireDetection.objects.all(), request).exclude(frp__isnull=True)
    frp_buckets = []
    for low, high in FRP_BUCKETS:
        bucket = window.filter(frp__gte=low)
        if high is not None:
            bucket = bucket.filter(frp__lt=high)
        frp_buckets.append(
            {
                "label": f"{low}+" if high is None else f"{low}–{high}",
                "min": low,
                "max": high,
                "count": bucket.count(),
            }
        )

    return JsonResponse({"per_tower": per_tower, "frp_buckets": frp_buckets})


def risk_timeseries(request):
    """Per-day mean fire-risk score and mean ML ignition probability across towers.

    The dashboard-level aggregate behind the risk-trend card; the per-tower
    ``tower_risk`` endpoint keeps the detailed FWI breakdown. ``mean_ignition``
    is null on days without a prediction.
    """
    risk_rows = (
        FireRiskAssessment.objects.values("date")
        .annotate(mean_risk=Avg("risk_score"))
        .order_by("date")
    )
    prob_by_date = {
        r["date"]: r["mean_prob"]
        for r in IgnitionPrediction.objects.values("date").annotate(
            mean_prob=Avg("probability")
        )
    }
    series = [
        {
            "date": r["date"].isoformat(),
            "mean_risk": r["mean_risk"],
            "mean_ignition": prob_by_date.get(r["date"]),
        }
        for r in risk_rows
    ]
    return JsonResponse({"series": series})


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
            # Latest ML ignition probability beside the FWI series (null-safe).
            "prediction": _prediction_summary(tower.latest_prediction),
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
