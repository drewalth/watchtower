"""backfill_weather: fetch the Open-Meteo archive over a range, upsert per tower."""

from unittest import mock

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command

from towers.models import WatchtowerSite, WeatherObservation


def _payload(lat, lon, days):
    """A well-formed Open-Meteo archive payload for the given coords/dates."""
    n = len(days)
    return {
        "latitude": lat,
        "longitude": lon,
        "daily": {
            "time": list(days),
            "temperature_2m_max": [22.0] * n,
            "relative_humidity_2m_min": [25.0] * n,
            "wind_speed_10m_max": [12.0] * n,
            "precipitation_sum": [0.0] * n,
            "snow_depth_max": [0.0] * n,
        },
    }


def _mock_json_response(payload):
    response = mock.Mock(status_code=200)
    response.raise_for_status = mock.Mock()
    response.json = mock.Mock(return_value=payload)
    return response


@pytest.fixture
def tower(db):
    return WatchtowerSite.objects.create(
        name="Backfill Test",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1500,
    )


@pytest.mark.django_db
def test_backfill_creates_then_is_idempotent(tower):
    days = ["2024-05-01", "2024-05-02", "2024-05-03"]
    response = _mock_json_response(_payload(38.0, -120.0, days))
    with mock.patch(
        "towers.management.commands.backfill_weather.requests.get",
        return_value=response,
    ):
        call_command("backfill_weather", "--start", "2024-05-01", "--end", "2024-05-03")
        call_command("backfill_weather", "--start", "2024-05-01", "--end", "2024-05-03")

    obs = WeatherObservation.objects.filter(tower=tower)
    assert obs.count() == 3  # re-run did not duplicate
    assert obs.filter(source="open-meteo").count() == 3


@pytest.mark.django_db
def test_backfill_requires_start_before_end(tower):
    with pytest.raises(Exception) as exc:
        call_command("backfill_weather", "--start", "2024-06-01", "--end", "2024-05-01")
    assert "on or before" in str(exc.value)


@pytest.mark.django_db
def test_one_bad_tower_does_not_lose_the_others(db):
    good = WatchtowerSite.objects.create(
        name="Good", location=Point(-120.0, 38.0, srid=4326), elevation_m=1000
    )
    bad = WatchtowerSite.objects.create(
        name="Bad", location=Point(-121.0, 39.0, srid=4326), elevation_m=1000
    )
    days = ["2024-05-01", "2024-05-02"]

    def by_tower(url, **kwargs):
        if kwargs["params"]["latitude"] == 39.0:
            broken = _payload(39.0, -121.0, days)
            del broken["daily"]["wind_speed_10m_max"]  # missing required field
            return _mock_json_response(broken)
        return _mock_json_response(_payload(38.0, -120.0, days))

    with mock.patch(
        "towers.management.commands.backfill_weather.requests.get", side_effect=by_tower
    ):
        call_command("backfill_weather", "--start", "2024-05-01", "--end", "2024-05-02")

    assert WeatherObservation.objects.filter(tower=good).count() == 2
    assert WeatherObservation.objects.filter(tower=bad).count() == 0


@pytest.mark.django_db
def test_requires_towers(db):
    with pytest.raises(Exception) as exc:
        call_command("backfill_weather", "--start", "2024-05-01", "--end", "2024-05-02")
    assert "seed_towers" in str(exc.value)
