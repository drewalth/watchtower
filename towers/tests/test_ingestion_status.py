"""Tests for the ingestion_status endpoint and run_ingest_cycle/compute_viewsheds commands."""
from unittest.mock import patch

import pytest
from django.contrib.gis.geos import MultiPolygon, Point, Polygon
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone

from towers.models import IngestionRun, WatchtowerSite

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_tower(name="T1", viewshed=False):
    """Create a WatchtowerSite, optionally with a dummy viewshed polygon."""
    tower = WatchtowerSite.objects.create(
        name=name,
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1000,
    )
    if viewshed:
        patch_poly = Polygon(
            ((-120.05, 38.05), (-120.03, 38.05),
             (-120.03, 38.07), (-120.05, 38.07), (-120.05, 38.05)),
            srid=4326,
        )
        tower.viewshed = MultiPolygon(patch_poly, srid=4326)
        tower.save(update_fields=["viewshed"])
    return tower


def _make_ingest_run(**kwargs):
    defaults = dict(kind=IngestionRun.Kind.INGEST_CYCLE, status=IngestionRun.Status.RUNNING)
    defaults.update(kwargs)
    return IngestionRun.objects.create(**defaults)


def _make_viewshed_run(**kwargs):
    defaults = dict(kind=IngestionRun.Kind.VIEWSHEDS, status=IngestionRun.Status.RUNNING)
    defaults.update(kwargs)
    return IngestionRun.objects.create(**defaults)


def _status(client):
    return client.get(reverse("ingestion-status")).json()


# ---------------------------------------------------------------------------
# Back-compat: the "run" key still exists
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_ingestion_status_null_before_any_run(client):
    data = _status(client)
    assert data["run"] is None
    assert "stages" in data
    assert "all_done" in data


@pytest.mark.django_db
def test_ingestion_status_returns_latest_ingest_cycle_run(client):
    """The "run" key returns the most recent ingest_cycle run, not a viewshed run."""
    _make_viewshed_run(status=IngestionRun.Status.COMPLETED, finished_at=timezone.now())
    older = _make_ingest_run(status=IngestionRun.Status.COMPLETED, finished_at=timezone.now())
    latest = _make_ingest_run(status=IngestionRun.Status.RUNNING)

    run = _status(client)["run"]
    assert run["id"] == latest.id
    assert run["status"] == "running"
    assert run["finished_at"] is None

    # A pure viewshed run must not surface in "run"
    _ = older  # referenced to show it was created


# ---------------------------------------------------------------------------
# No runs at all: all stages pending
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_no_runs_all_stages_pending(client):
    _make_tower("T1")  # exists but no viewshed
    data = _status(client)
    stages = {s["key"]: s for s in data["stages"]}

    assert stages["fires"]["status"] == "pending"
    assert stages["weather"]["status"] == "pending"
    assert stages["risk"]["status"] == "pending"
    assert stages["predictions"]["status"] == "pending"
    assert stages["viewsheds"]["status"] == "pending"
    assert data["all_done"] is False


@pytest.mark.django_db
def test_no_towers_viewsheds_pending(client):
    # No towers at all: done==total==0, so NOT completed; should be pending.
    data = _status(client)
    vs = next(s for s in data["stages"] if s["key"] == "viewsheds")
    assert vs["status"] == "pending"
    assert vs["done"] == 0
    assert vs["total"] == 0


# ---------------------------------------------------------------------------
# Mid-cycle: steps reflect in-progress state
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_mid_cycle_steps_surface_in_stages(client):
    _make_ingest_run(steps={
        "ingest_fires": "completed",
        "ingest_weather": "running",
    })
    stages = {s["key"]: s for s in _status(client)["stages"]}

    assert stages["fires"]["status"] == "completed"
    assert stages["weather"]["status"] == "running"
    # Keys missing from steps dict default to pending
    assert stages["risk"]["status"] == "pending"
    assert stages["predictions"]["status"] == "pending"


# ---------------------------------------------------------------------------
# Viewshed done/total counts
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_viewshed_done_and_total_counts(client):
    _make_tower("A", viewshed=True)
    _make_tower("B", viewshed=True)
    _make_tower("C", viewshed=False)  # no viewshed

    vs = next(s for s in _status(client)["stages"] if s["key"] == "viewsheds")
    assert vs["done"] == 2
    assert vs["total"] == 3


@pytest.mark.django_db
def test_viewshed_status_completed_when_all_done_no_run(client):
    """If no viewshed IngestionRun exists but all towers have a viewshed, status=completed."""
    _make_tower("A", viewshed=True)
    _make_tower("B", viewshed=True)

    vs = next(s for s in _status(client)["stages"] if s["key"] == "viewsheds")
    assert vs["status"] == "completed"
    assert vs["done"] == 2
    assert vs["total"] == 2


@pytest.mark.django_db
def test_viewshed_status_from_run_when_run_exists(client):
    """A viewshed IngestionRun in 'running' state overrides the done==total heuristic."""
    _make_tower("A", viewshed=True)
    _make_viewshed_run(status=IngestionRun.Status.RUNNING)

    vs = next(s for s in _status(client)["stages"] if s["key"] == "viewsheds")
    assert vs["status"] == "running"


# ---------------------------------------------------------------------------
# all_done flag
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_all_done_false_without_ingest_run(client):
    _make_tower("A", viewshed=True)
    assert _status(client)["all_done"] is False


@pytest.mark.django_db
def test_all_done_true_when_everything_complete(client):
    _make_tower("A", viewshed=True)
    all_steps = {
        "ingest_fires": "completed",
        "ingest_weather": "completed",
        "compute_fire_risk": "completed",
        "predict_ignition": "completed",
    }
    _make_ingest_run(
        status=IngestionRun.Status.COMPLETED,
        finished_at=timezone.now(),
        steps=all_steps,
    )
    _make_viewshed_run(
        status=IngestionRun.Status.COMPLETED,
        finished_at=timezone.now(),
    )
    assert _status(client)["all_done"] is True


@pytest.mark.django_db
def test_all_done_false_when_viewsheds_not_complete(client):
    _make_tower("A", viewshed=False)  # viewshed incomplete
    all_steps = {
        "ingest_fires": "completed",
        "ingest_weather": "completed",
        "compute_fire_risk": "completed",
        "predict_ignition": "completed",
    }
    _make_ingest_run(
        status=IngestionRun.Status.COMPLETED,
        finished_at=timezone.now(),
        steps=all_steps,
    )
    assert _status(client)["all_done"] is False


# ---------------------------------------------------------------------------
# run_ingest_cycle command: structured steps
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_run_ingest_cycle_sets_kind_and_steps():
    """run_ingest_cycle creates an ingest_cycle run with all four step keys."""
    with patch("towers.management.commands.run_ingest_cycle.call_command"):
        call_command("run_ingest_cycle")

    run = IngestionRun.objects.filter(kind=IngestionRun.Kind.INGEST_CYCLE).first()
    assert run is not None
    assert set(run.steps.keys()) == {
        "ingest_fires", "ingest_weather", "compute_fire_risk", "predict_ignition"
    }
    # All steps should have completed (mocked, no exceptions raised)
    assert all(v == "completed" for v in run.steps.values())
    assert run.status == IngestionRun.Status.COMPLETED


@pytest.mark.django_db
def test_run_ingest_cycle_marks_failed_step():
    """A step that raises marks that step failed; cycle still completes."""
    def _raise_on_weather(cmd, **kwargs):
        if cmd == "ingest_weather":
            raise RuntimeError("network error")

    with patch("towers.management.commands.run_ingest_cycle.call_command", side_effect=_raise_on_weather):
        call_command("run_ingest_cycle")

    run = IngestionRun.objects.filter(kind=IngestionRun.Kind.INGEST_CYCLE).first()
    assert run.steps["ingest_fires"] == "completed"
    assert run.steps["ingest_weather"] == "failed"
    assert run.steps["compute_fire_risk"] == "completed"
    assert run.steps["predict_ignition"] == "completed"
    # Not all steps failed, so overall status is still completed
    assert run.status == IngestionRun.Status.COMPLETED


# ---------------------------------------------------------------------------
# compute_viewsheds --track command
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_compute_viewsheds_track_creates_viewshed_run():
    """--track creates a kind=viewsheds IngestionRun that ends completed."""
    _make_tower("Mock Tower")

    with patch("towers.management.commands.compute_viewsheds.compute_viewshed", return_value=None):
        call_command("compute_viewsheds", track=True)

    viewshed_run = IngestionRun.objects.filter(kind=IngestionRun.Kind.VIEWSHEDS).first()
    assert viewshed_run is not None
    assert viewshed_run.status == IngestionRun.Status.COMPLETED
    assert viewshed_run.finished_at is not None


@pytest.mark.django_db
def test_compute_viewsheds_track_only_missing_noop_when_all_done():
    """--only-missing --track with all viewsheds present is a clean no-op → completed."""
    _make_tower("Done Tower", viewshed=True)

    # No mock needed: --only-missing sees no towers, returns early without calling compute_viewshed.
    call_command("compute_viewsheds", only_missing=True, track=True)

    viewshed_run = IngestionRun.objects.filter(kind=IngestionRun.Kind.VIEWSHEDS).first()
    assert viewshed_run is not None
    assert viewshed_run.status == IngestionRun.Status.COMPLETED


@pytest.mark.django_db
def test_compute_viewsheds_without_track_creates_no_run():
    """Without --track, no IngestionRun is created."""
    _make_tower("Mock Tower")

    with patch("towers.management.commands.compute_viewsheds.compute_viewshed", return_value=None):
        call_command("compute_viewsheds")

    assert IngestionRun.objects.count() == 0
