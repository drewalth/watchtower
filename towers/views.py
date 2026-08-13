"""The read-only HTTP API — hand-rolled GeoJSON/JSON, no DRF.

Every endpoint serializes models by hand into plain dicts and returns a
``JsonResponse``; there is no serializer layer because the payloads are small,
stable, and map-shaped. Two conventions hold throughout:

* **Coordinates are always ``[lon, lat]``** (GeoJSON order), the opposite of the
  ``lat, lon`` most humans say.
* **Aggregate endpoints stay query-bounded.** The towers feed and per-tower
  stats deliberately avoid the "one spatial query per tower" N+1: latest risk
  and ML prediction come from correlated subqueries (``_annotated_towers``) and
  in-range fire counts from a constant number of aggregate queries
  (``_fire_count_map``), regardless of how many towers exist.

The surface splits into three groups: the map feeds (``towers``/``fires``
GeoJSON), the dashboard aggregates (``fires``/``risk`` time series + stats), and
the ingest ``status`` endpoint the scheduler/UI poll.
"""

from __future__ import annotations

import json
from datetime import date

from django.contrib.gis.measure import D
from django.db.models import (
    Avg,
    Count,
    IntegerField,
    Max,
    Min,
    OuterRef,
    QuerySet,
    Subquery,
    Value,
)
from django.db.models.functions import Coalesce, TruncDate
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, render

from .models import (
    FireDetection,
    FireRiskAssessment,
    IgnitionPrediction,
    IngestionRun,
    WatchtowerSite,
)

# FRP (fire radiative power, MW) magnitude bins for the intensity histogram.
# Open upper bound (None) catches the long tail of very hot detections.
FRP_BUCKETS: list[tuple[int, int | None]] = [(0, 10), (10, 50), (50, 100), (100, 500), (500, None)]


def map_view(request: HttpRequest) -> HttpResponse:
    """Render the map page; the React app fetches its data from the API."""
    return render(request, "towers/map.html")


def _annotated_towers() -> QuerySet[WatchtowerSite]:
    """All towers, each annotated with its latest risk + ML prediction fields.

    Replaces the per-tower ``latest_risk`` / ``latest_prediction`` property
    lookups (two queries per tower) with correlated subqueries, so the towers
    feed reads every tower's newest assessment and prediction in a single query.
    The ``[:1]`` slice on an ordered subquery is the standard "latest related
    row" pattern. Fields are read back off the instances by ``_annotated_*``.
    """
    latest_risk = FireRiskAssessment.objects.filter(tower=OuterRef("pk")).order_by("-date")
    latest_prediction = IgnitionPrediction.objects.filter(tower=OuterRef("pk")).order_by(
        "-date", "-created_at"
    )
    return WatchtowerSite.objects.annotate(
        latest_risk_level=Subquery(latest_risk.values("risk_level")[:1]),
        latest_risk_score=Subquery(latest_risk.values("risk_score")[:1]),
        latest_risk_date=Subquery(latest_risk.values("date")[:1]),
        latest_ignition_probability=Subquery(latest_prediction.values("probability")[:1]),
        latest_ignition_horizon=Subquery(latest_prediction.values("horizon_days")[:1]),
        latest_ignition_version=Subquery(latest_prediction.values("model_version")[:1]),
    )


def _fire_count_map(start: date | None = None, end: date | None = None) -> dict[int, int]:
    """Map of tower id → in-range fire-detection count, in a constant number of
    queries rather than one spatial query per tower.

    Mirrors ``WatchtowerSite.fires_in_range`` exactly: viewshed towers match by
    ``ST_Intersects`` against the stored polygon, radius towers by spheroid
    ground distance. Radius towers are grouped by their coverage radius (in
    practice a single value), so each *distinct radius* is one aggregate query —
    never a per-tower round trip. ``start``/``end`` scope the detections by their
    UTC calendar day, matching the other filtered endpoints.

    The ``.values(g=Value(1)).annotate(c=Count(...))`` shape collapses each
    correlated subquery to a single grouped count; ``Coalesce(..., 0)`` turns the
    "no matching fires" empty result into a real zero.
    """
    base = FireDetection.objects.all()
    if start is not None:
        base = base.filter(acquired_at__date__gte=start)
    if end is not None:
        base = base.filter(acquired_at__date__lte=end)

    counts: dict[int, int] = {}

    # Viewshed towers: one aggregate query, ST_Intersects against each viewshed.
    intersects_count = (
        base.filter(location__intersects=OuterRef("viewshed"))
        .order_by()
        .values(g=Value(1))
        .annotate(c=Count("pk"))
        .values("c")
    )
    viewshed_towers = WatchtowerSite.objects.filter(viewshed__isnull=False).annotate(
        fire_count=Coalesce(Subquery(intersects_count, output_field=IntegerField()), Value(0))
    )
    for row in viewshed_towers.values("id", "fire_count"):
        counts[row["id"]] = row["fire_count"]

    # Radius towers: one aggregate query per distinct radius (usually just one),
    # reusing the same spheroid distance_lte predicate as fires_in_range.
    radius_towers = WatchtowerSite.objects.filter(viewshed__isnull=True)
    for radius in radius_towers.values_list("coverage_radius_km", flat=True).distinct():
        within_count = (
            base.filter(location__distance_lte=(OuterRef("location"), D(km=radius), "spheroid"))
            .order_by()
            .values(g=Value(1))
            .annotate(c=Count("pk"))
            .values("c")
        )
        sized = radius_towers.filter(coverage_radius_km=radius).annotate(
            fire_count=Coalesce(Subquery(within_count, output_field=IntegerField()), Value(0))
        )
        for row in sized.values("id", "fire_count"):
            counts[row["id"]] = row["fire_count"]

    return counts


def towers_geojson(request: HttpRequest) -> JsonResponse:
    """All towers as a GeoJSON FeatureCollection.

    Each feature carries its coverage polygon and a live in-range fire count.
    Coordinates are [lon, lat] per the GeoJSON spec. Built from a single
    annotated towers query plus a constant-query fire-count map — see
    ``_annotated_towers`` / ``_fire_count_map`` — so it never N+1s over towers.
    """
    fire_counts = _fire_count_map()
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
                "state": site.state,
                "elevation_m": site.elevation_m,
                "coverage_radius_km": site.coverage_radius_km,
                "fire_count": fire_counts.get(site.id, 0),
                # "viewshed" (terrain line-of-sight) or "circle" (naive radius).
                "coverage_kind": site.coverage_kind,
                # Latest fire-risk rating (None until compute_fire_risk has run).
                **_annotated_risk_summary(site),
                # Latest ML ignition probability (None until a model is trained).
                **_annotated_prediction_summary(site),
                # GEOSGeometry.geojson is a string; parse so it nests as JSON.
                "coverage": json.loads(site.coverage_area().geojson),
            },
        }
        for site in _annotated_towers()
    ]
    return JsonResponse({"type": "FeatureCollection", "features": features})


def _annotated_risk_summary(site: WatchtowerSite) -> dict:
    """Compact latest-risk fields read off an ``_annotated_towers`` instance.

    Equivalent output to ``_risk_summary`` but sourced from the correlated
    subquery annotations instead of a fresh per-tower query. ``latest_risk_date``
    is None exactly when the tower has no assessment yet.
    """
    if site.latest_risk_date is None:
        return {"risk_level": None, "risk_score": None, "risk_date": None}
    return {
        "risk_level": site.latest_risk_level,
        "risk_score": site.latest_risk_score,
        "risk_date": site.latest_risk_date.isoformat(),
    }


def _annotated_prediction_summary(site: WatchtowerSite) -> dict:
    """Compact latest ML-prediction fields read off an ``_annotated_towers``
    instance (null-safe). ``latest_ignition_probability`` is None exactly when
    no prediction exists for the tower."""
    if site.latest_ignition_probability is None:
        return {
            "ignition_probability": None,
            "horizon_days": None,
            "model_version": None,
        }
    return {
        "ignition_probability": site.latest_ignition_probability,
        "horizon_days": site.latest_ignition_horizon,
        "model_version": site.latest_ignition_version,
    }


def _risk_summary(assessment: FireRiskAssessment | None) -> dict:
    """Compact latest-risk fields for a single fetched assessment (or None)."""
    if assessment is None:
        return {"risk_level": None, "risk_score": None, "risk_date": None}
    return {
        "risk_level": assessment.risk_level,
        "risk_score": assessment.risk_score,
        "risk_date": assessment.date.isoformat(),
    }


def _prediction_summary(prediction: IgnitionPrediction | None) -> dict:
    """Compact latest ML-prediction fields for a single prediction (null-safe)."""
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


def fires_geojson(request: HttpRequest) -> JsonResponse:
    """Fire detections as GeoJSON, optionally filtered by date window + source.

    Query params (all optional): ``start``/``end`` (ISO dates, inclusive, matched
    on the detection's UTC calendar day) and ``source``. With no params it
    returns every detection (back-compat); the dashboard always passes a window
    so the map isn't asked to draw the whole archive at once. Malformed dates are
    ignored rather than rejected — a typo'd filter shouldn't 500 the map.
    """
    return _fire_collection(_filter_fires(FireDetection.objects.all(), request))


def _parse_date(value: str | None) -> date | None:
    """An ISO date string → ``date``; None for missing *or* malformed input.

    Deliberately lenient: these are optional display filters, so a bad value is
    silently dropped (the filter just isn't applied) rather than surfaced as a
    400. See ``test_fires_geojson_ignores_malformed_date``.
    """
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _filter_fires(qs: QuerySet[FireDetection], request: HttpRequest) -> QuerySet[FireDetection]:
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


def fires_timeseries(request: HttpRequest) -> JsonResponse:
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
        {"date": r["day"].isoformat(), "source": r["source"], "count": r["count"]} for r in rows
    ]
    bounds = FireDetection.objects.aggregate(min_at=Min("acquired_at"), max_at=Max("acquired_at"))
    return JsonResponse(
        {
            "series": series,
            "min_date": bounds["min_at"].date().isoformat() if bounds["min_at"] else None,
            "max_date": bounds["max_at"].date().isoformat() if bounds["max_at"] else None,
        }
    )


def fires_stats(request: HttpRequest) -> JsonResponse:
    """Window-scoped aggregates that need per-tower or raw-row data.

    Per-tower in-range counts (using each tower's *same* coverage definition as
    the map) plus an FRP-intensity histogram, all within the ``start``/``end``
    window. Kept separate from ``fires_timeseries`` because these can't be summed
    from per-day rows. Counts come from ``_fire_count_map`` so this stays
    query-bounded rather than running one spatial query per tower.
    """
    start = _parse_date(request.GET.get("start"))
    end = _parse_date(request.GET.get("end"))

    fire_counts = _fire_count_map(start, end)
    per_tower = [
        {"id": t["id"], "name": t["name"], "count": fire_counts.get(t["id"], 0)}
        for t in WatchtowerSite.objects.values("id", "name")
    ]

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


def risk_timeseries(request: HttpRequest) -> JsonResponse:
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
        for r in IgnitionPrediction.objects.values("date").annotate(mean_prob=Avg("probability"))
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


def tower_fires_geojson(request: HttpRequest, tower_id: int) -> JsonResponse:
    """Fire detections within a single tower's coverage radius."""
    tower = get_object_or_404(WatchtowerSite, pk=tower_id)
    return _fire_collection(tower.fires_in_range())


def tower_risk(request: HttpRequest, tower_id: int) -> JsonResponse:
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


def ingestion_status(request: HttpRequest) -> JsonResponse:
    """Per-stage checklist + ingest-cycle run, for the UI's status panel.

    Returns the latest ingest_cycle run (back-compat ``"run"`` key), a
    ``"stages"`` list with one entry per processing stage, and ``"all_done"``
    signalling that every stage has completed.

    Stage statuses are one of ``pending|running|completed|failed`` to match the
    IngestionRun.Status values (lowercase).  The viewsheds stage also carries
    ``done`` and ``total`` int counts.
    """
    ingest_run = IngestionRun.objects.filter(kind=IngestionRun.Kind.INGEST_CYCLE).first()
    viewshed_run = IngestionRun.objects.filter(kind=IngestionRun.Kind.VIEWSHEDS).first()

    run_payload = None
    if ingest_run is not None:
        run_payload = {
            "id": ingest_run.id,
            "status": ingest_run.status,
            "started_at": ingest_run.started_at.isoformat(),
            "finished_at": (ingest_run.finished_at.isoformat() if ingest_run.finished_at else None),
        }

    stages = _build_stages(ingest_run, viewshed_run)
    all_done = _all_done(ingest_run, stages)

    return JsonResponse({"run": run_payload, "stages": stages, "all_done": all_done})


# Maps (stage key, human label, steps-dict key) for the four ingest stages.
_INGEST_STAGE_MAP = [
    ("fires", "Active fires", "ingest_fires"),
    ("weather", "Fire weather", "ingest_weather"),
    ("risk", "Risk ratings", "compute_fire_risk"),
    ("predictions", "ML predictions", "predict_ignition"),
]


def _build_stages(ingest_run: IngestionRun | None, viewshed_run: IngestionRun | None) -> list[dict]:
    """Assemble the stages list from the latest ingest and viewshed runs."""
    steps = ingest_run.steps if ingest_run is not None else {}

    stages = [
        {
            "key": key,
            "label": label,
            "status": steps.get(step_key, "pending"),
        }
        for key, label, step_key in _INGEST_STAGE_MAP
    ]

    # Viewshed stage: include done/total counts regardless of run state.
    done = WatchtowerSite.objects.filter(viewshed__isnull=False).count()
    total = WatchtowerSite.objects.count()

    if viewshed_run is not None:
        vs_status = viewshed_run.status  # running / completed / failed
    elif total > 0 and done == total:
        vs_status = "completed"
    else:
        vs_status = "pending"

    stages.append(
        {
            "key": "viewsheds",
            "label": "Viewsheds",
            "status": vs_status,
            "done": done,
            "total": total,
        }
    )
    return stages


def _all_done(ingest_run: IngestionRun | None, stages: list[dict]) -> bool:
    """True when the ingest cycle is complete and viewsheds are complete."""
    if ingest_run is None:
        return False

    ingest_stages_done = all(s["status"] == "completed" for s in stages if s["key"] != "viewsheds")
    viewshed_stage = next(s for s in stages if s["key"] == "viewsheds")

    ingest_complete = ingest_run.status == IngestionRun.Status.COMPLETED or ingest_stages_done
    return ingest_complete and viewshed_stage["status"] == "completed"


def _fire_collection(fires: QuerySet[FireDetection]) -> JsonResponse:
    """Serialize a fire QuerySet to a GeoJSON FeatureCollection ([lon, lat])."""
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
