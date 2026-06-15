from unittest import mock

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command

from towers.models import FireDetection, WatchtowerSite

# Two detections; the second row has a blank FRP to exercise null handling.
SAMPLE_CSV = (
    "latitude,longitude,bright_ti4,acq_date,acq_time,confidence,frp\n"
    "38.10,-120.10,300.5,2026-06-13,118,n,12.5\n"
    "38.20,-120.20,310.0,2026-06-13,124,h,\n"
)

# The three VIIRS NRT sensors the job pulls by default.
THREE_SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT", "VIIRS_NOAA21_NRT"]


def _csv(lat, lon):
    """A one-detection CSV at the given coords (distinct → distinct external_uid)."""
    return (
        "latitude,longitude,bright_ti4,acq_date,acq_time,confidence,frp\n"
        f"{lat},{lon},305.0,2026-06-13,118,n,9.0\n"
    )


def _mock_response(text):
    response = mock.Mock(status_code=200, text=text)
    response.raise_for_status = mock.Mock()
    return response


@pytest.fixture
def seeded_tower(db):
    return WatchtowerSite.objects.create(
        name="Ingest Test",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1000,
    )


@pytest.mark.django_db
def test_ingest_requires_map_key(settings, seeded_tower):
    settings.FIRMS_MAP_KEY = ""
    with pytest.raises(Exception) as exc:
        call_command("ingest_fires")
    assert "FIRMS_MAP_KEY" in str(exc.value)


@pytest.mark.django_db
def test_ingest_is_idempotent(settings, seeded_tower):
    settings.FIRMS_MAP_KEY = "test-key"
    with mock.patch(
        "towers.management.commands.ingest_fires.requests.get",
        return_value=_mock_response(SAMPLE_CSV),
    ):
        # Pin to a single source so the count reflects the CSV, not the fan-out.
        call_command("ingest_fires", source=["VIIRS_NOAA20_NRT"])
        assert FireDetection.objects.count() == 2

        # Re-running must not create duplicates (update_or_create on external_uid).
        call_command("ingest_fires", source=["VIIRS_NOAA20_NRT"])
        assert FireDetection.objects.count() == 2

    # Null FRP from the blank cell was handled.
    assert FireDetection.objects.filter(frp__isnull=True).count() == 1


@pytest.mark.django_db
def test_ingest_handles_empty_result(settings, seeded_tower):
    """A header-only CSV (a calm day) is not an error."""
    settings.FIRMS_MAP_KEY = "test-key"
    header_only = "latitude,longitude,bright_ti4,acq_date,acq_time,confidence,frp\n"
    with mock.patch(
        "towers.management.commands.ingest_fires.requests.get",
        return_value=_mock_response(header_only),
    ):
        call_command("ingest_fires", source=["VIIRS_NOAA20_NRT"])
    assert FireDetection.objects.count() == 0


@pytest.mark.django_db
def test_ingest_fans_out_across_sources(settings, seeded_tower):
    """The default job pulls every source — one request each, all land."""
    settings.FIRMS_MAP_KEY = "test-key"
    responses = [
        _mock_response(_csv(38.1, -120.1)),
        _mock_response(_csv(38.2, -120.2)),
        _mock_response(_csv(38.3, -120.3)),
    ]
    with mock.patch(
        "towers.management.commands.ingest_fires.requests.get",
        side_effect=responses,
    ) as get:
        call_command("ingest_fires", source=THREE_SOURCES)

    assert get.call_count == 3
    assert FireDetection.objects.count() == 3
    assert set(FireDetection.objects.values_list("source", flat=True)) == set(
        THREE_SOURCES
    )


@pytest.mark.django_db
def test_ingest_is_fail_soft(settings, seeded_tower):
    """One bad source is skipped; the others still ingest, and no error is raised."""
    settings.FIRMS_MAP_KEY = "test-key"
    responses = [
        _mock_response(_csv(38.1, -120.1)),
        _mock_response("Invalid MAP_KEY or rate limit exceeded."),  # not CSV
        _mock_response(_csv(38.3, -120.3)),
    ]
    with mock.patch(
        "towers.management.commands.ingest_fires.requests.get",
        side_effect=responses,
    ):
        call_command("ingest_fires", source=THREE_SOURCES)

    # Two good sources landed; the erroring middle source contributed nothing.
    assert FireDetection.objects.count() == 2


@pytest.mark.django_db
def test_ingest_errors_when_all_sources_fail(settings, seeded_tower):
    """If every source fails the run errors out (non-zero exit) — and writes nothing."""
    settings.FIRMS_MAP_KEY = "test-key"
    bad = _mock_response("Invalid MAP_KEY or rate limit exceeded.")
    with mock.patch(
        "towers.management.commands.ingest_fires.requests.get",
        side_effect=[bad, bad, bad],
    ):
        with pytest.raises(Exception) as exc:
            call_command("ingest_fires", source=THREE_SOURCES)
    assert "failed" in str(exc.value).lower()
    assert FireDetection.objects.count() == 0


@pytest.fixture
def two_distant_towers(db):
    """Two towers far enough apart to land in separate FIRMS clusters."""
    WatchtowerSite.objects.create(
        name="California Tower",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1000,
    )
    WatchtowerSite.objects.create(
        name="Colorado Tower",
        location=Point(-106.0, 39.0, srid=4326),
        elevation_m=1000,
    )


@pytest.mark.django_db
def test_ingest_splits_into_cluster_bboxes(settings, two_distant_towers):
    """Dispersed towers fan the query out into one request per cluster bbox."""
    settings.FIRMS_MAP_KEY = "test-key"
    responses = [
        _mock_response(_csv(38.0, -120.0)),
        _mock_response(_csv(39.0, -106.0)),
    ]
    with mock.patch(
        "towers.management.commands.ingest_fires.requests.get",
        side_effect=responses,
    ) as get:
        # One source, two clusters → two requests.
        call_command("ingest_fires", source=["VIIRS_NOAA20_NRT"])

    assert get.call_count == 2
    assert FireDetection.objects.count() == 2


@pytest.mark.django_db
def test_ingest_cluster_failure_is_isolated(settings, two_distant_towers):
    """One cluster erroring doesn't lose the other cluster, and doesn't raise."""
    settings.FIRMS_MAP_KEY = "test-key"
    responses = [
        _mock_response(_csv(38.0, -120.0)),
        _mock_response("Invalid MAP_KEY or rate limit exceeded."),  # not CSV
    ]
    with mock.patch(
        "towers.management.commands.ingest_fires.requests.get",
        side_effect=responses,
    ):
        call_command("ingest_fires", source=["VIIRS_NOAA20_NRT"])

    # The healthy cluster's detection still landed.
    assert FireDetection.objects.count() == 1


@pytest.mark.django_db
def test_source_fails_only_when_all_clusters_fail(settings, two_distant_towers):
    """A source counts as failed only if every one of its clusters fails."""
    settings.FIRMS_MAP_KEY = "test-key"
    bad = "Invalid MAP_KEY or rate limit exceeded."
    # Source A: both clusters fail. Source B: both clusters succeed. Requests are
    # ordered source-outer, cluster-inner → [A/c1, A/c2, B/c1, B/c2].
    responses = [
        _mock_response(bad),
        _mock_response(bad),
        _mock_response(_csv(38.0, -120.0)),
        _mock_response(_csv(39.0, -106.0)),
    ]
    with mock.patch(
        "towers.management.commands.ingest_fires.requests.get",
        side_effect=responses,
    ):
        # Does not raise: source B carried the run.
        call_command("ingest_fires", source=["VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT"])

    # Only source B's two detections persisted.
    assert FireDetection.objects.count() == 2
    assert set(FireDetection.objects.values_list("source", flat=True)) == {
        "VIIRS_SNPP_NRT"
    }
