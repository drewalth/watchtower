"""compute_fire_risk: walk weather per tower, carry codes forward, upsert risk."""

from datetime import date, timedelta

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command

from towers.models import FireRiskAssessment, WatchtowerSite, WeatherObservation


@pytest.fixture
def tower(db):
    return WatchtowerSite.objects.create(
        name="Risk Compute",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1500,
        fuel_type="mixed",
    )


def _weather(tower, day, **overrides):
    fields = dict(
        temp_c=25.0,
        rh_pct=20.0,
        wind_kph=15.0,
        precip_24h_mm=0.0,
        snow_depth_cm=0.0,
    )
    fields.update(overrides)
    return WeatherObservation.objects.create(
        tower=tower,
        date=day,
        source="open-meteo",
        external_uid=f"{tower.id}_{day.isoformat()}_open-meteo",
        **fields,
    )


@pytest.mark.django_db
def test_computes_one_assessment_per_weather_day(tower):
    start = date(2026, 6, 10)
    for i in range(3):
        _weather(tower, start + timedelta(days=i))

    call_command("compute_fire_risk")

    assessments = FireRiskAssessment.objects.filter(tower=tower).order_by("date")
    assert assessments.count() == 3
    # Hot, dry, rain-free days in sequence → drought codes build up over time.
    assert assessments.last().dc > assessments.first().dc


@pytest.mark.django_db
def test_codes_carry_forward_across_days(tower):
    # A single warm dry day vs. the same day preceded by a week of drying should
    # yield a higher DMC on the later day (recursive accumulation).
    isolated = date(2026, 7, 1)
    _weather(tower, isolated)
    call_command("compute_fire_risk")
    solo_dmc = FireRiskAssessment.objects.get(tower=tower, date=isolated).dmc

    FireRiskAssessment.objects.all().delete()
    WeatherObservation.objects.all().delete()
    run = date(2026, 8, 1)
    for i in range(7):
        _weather(tower, run + timedelta(days=i))
    call_command("compute_fire_risk")
    accumulated_dmc = FireRiskAssessment.objects.filter(tower=tower).order_by("-date").first().dmc
    assert accumulated_dmc > solo_dmc


@pytest.mark.django_db
def test_snow_cover_suppresses_risk(tower):
    snowy = date(2026, 1, 15)
    _weather(tower, snowy, temp_c=-2.0, rh_pct=80.0, snow_depth_cm=40.0)
    call_command("compute_fire_risk")

    assessment = FireRiskAssessment.objects.get(tower=tower, date=snowy)
    assert assessment.snow_covered is True
    assert assessment.risk_level == "low"
    assert assessment.risk_score == 0.0


@pytest.mark.django_db
def test_idempotent_upsert(tower):
    day = date(2026, 6, 10)
    _weather(tower, day)
    call_command("compute_fire_risk")
    call_command("compute_fire_risk")
    assert FireRiskAssessment.objects.filter(tower=tower, date=day).count() == 1


@pytest.mark.django_db
def test_requires_towers(db):
    with pytest.raises(Exception) as exc:
        call_command("compute_fire_risk")
    assert "seed_towers" in str(exc.value)
