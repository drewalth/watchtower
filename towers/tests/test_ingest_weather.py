"""ingest_weather: fetch Open-Meteo, validate at the boundary, upsert per tower."""
from unittest import mock

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command

from towers.models import WatchtowerSite, WeatherObservation


def _payload(lat, lon, days=("2026-06-12", "2026-06-13")):
    """A well-formed Open-Meteo daily payload for the given coords/dates."""
    n = len(days)
    return {
        "latitude": lat,
        "longitude": lon,
        "daily": {
            "time": list(days),
            "temperature_2m_max": [25.0] * n,
            "relative_humidity_2m_min": [20.0] * n,
            "wind_speed_10m_max": [15.0] * n,
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
        name="Weather Test",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1500,
    )


@pytest.mark.django_db
def test_ingest_creates_then_is_idempotent(tower):
    response = _mock_json_response(_payload(38.0, -120.0))
    with mock.patch("towers.management.commands.ingest_weather.requests.get", return_value=response):
        call_command("ingest_weather", "--day-range", "2")
        call_command("ingest_weather", "--day-range", "2")

    obs = WeatherObservation.objects.filter(tower=tower)
    assert obs.count() == 2  # re-run did not duplicate
    assert obs.filter(source="open-meteo").count() == 2


@pytest.mark.django_db
def test_one_bad_tower_does_not_lose_the_others(db):
    good = WatchtowerSite.objects.create(
        name="Good", location=Point(-120.0, 38.0, srid=4326), elevation_m=1000
    )
    bad = WatchtowerSite.objects.create(
        name="Bad", location=Point(-121.0, 39.0, srid=4326), elevation_m=1000
    )

    def by_tower(url, **kwargs):
        # The bad tower's response is missing a required daily field.
        if kwargs["params"]["latitude"] == 39.0:
            broken = _payload(39.0, -121.0)
            del broken["daily"]["wind_speed_10m_max"]
            return _mock_json_response(broken)
        return _mock_json_response(_payload(38.0, -120.0))

    with mock.patch("towers.management.commands.ingest_weather.requests.get", side_effect=by_tower):
        call_command("ingest_weather", "--day-range", "2")

    assert WeatherObservation.objects.filter(tower=good).count() == 2
    assert WeatherObservation.objects.filter(tower=bad).count() == 0


@pytest.mark.django_db
def test_malformed_payload_writes_nothing(tower):
    broken = _payload(38.0, -120.0)
    broken["daily"]["temperature_2m_max"] = [None, None]  # null where number expected
    response = _mock_json_response(broken)
    with mock.patch("towers.management.commands.ingest_weather.requests.get", return_value=response):
        # The only tower's payload is invalid → nothing written, and (as with
        # ingest_fires when every source fails) the command signals total failure.
        with pytest.raises(Exception):
            call_command("ingest_weather", "--day-range", "2")

    assert WeatherObservation.objects.count() == 0


@pytest.mark.django_db
def test_requires_towers(db):
    with pytest.raises(Exception) as exc:
        call_command("ingest_weather")
    assert "seed_towers" in str(exc.value)
