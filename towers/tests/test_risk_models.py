"""WatchtowerSite fuel mapping + risk model relationships."""

from datetime import date

import pytest
from django.contrib.gis.geos import Point

from towers.models import FireRiskAssessment, WatchtowerSite, WeatherObservation


def test_fuel_factor_maps_from_fuel_type():
    sparse = WatchtowerSite(fuel_type="sparse")
    conifer = WatchtowerSite(fuel_type="conifer")
    # Denser, more flammable fuel carries a higher multiplier.
    assert conifer.fuel_factor > sparse.fuel_factor


@pytest.fixture
def tower(db):
    return WatchtowerSite.objects.create(
        name="Risk Test",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1500,
        fuel_type="mixed",
    )


@pytest.mark.django_db
def test_latest_risk_returns_most_recent_assessment(tower):
    assert tower.latest_risk is None
    FireRiskAssessment.objects.create(
        tower=tower,
        date=date(2026, 6, 10),
        ffmc=80,
        dmc=10,
        dc=100,
        isi=5,
        bui=12,
        fwi=6,
        risk_score=12,
        risk_level="moderate",
        snow_covered=False,
    )
    newest = FireRiskAssessment.objects.create(
        tower=tower,
        date=date(2026, 6, 12),
        ffmc=90,
        dmc=30,
        dc=200,
        isi=12,
        bui=30,
        fwi=20,
        risk_score=40,
        risk_level="high",
        snow_covered=False,
    )
    assert tower.latest_risk == newest


@pytest.mark.django_db
def test_weather_observation_dedup_on_external_uid(tower):
    fields = dict(
        tower=tower,
        date=date(2026, 6, 12),
        temp_c=25,
        rh_pct=20,
        wind_kph=15,
        precip_24h_mm=0,
        snow_depth_cm=0,
        source="open-meteo",
    )
    uid = f"{tower.id}_2026-06-12_open-meteo"
    WeatherObservation.objects.update_or_create(external_uid=uid, defaults=fields)
    WeatherObservation.objects.update_or_create(external_uid=uid, defaults={**fields, "temp_c": 30})
    assert WeatherObservation.objects.filter(external_uid=uid).count() == 1
    assert WeatherObservation.objects.get(external_uid=uid).temp_c == 30
