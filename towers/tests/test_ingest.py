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
        call_command("ingest_fires")
        assert FireDetection.objects.count() == 2

        # Re-running must not create duplicates (update_or_create on external_uid).
        call_command("ingest_fires")
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
        call_command("ingest_fires")
    assert FireDetection.objects.count() == 0
