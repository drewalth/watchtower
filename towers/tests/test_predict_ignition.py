"""predict_ignition: score today's probability per tower from the artifact."""

from datetime import date
from unittest import mock

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command

from towers.models import (
    FireRiskAssessment,
    IgnitionPrediction,
    WatchtowerSite,
)


class _StubModel:
    """Stands in for a loaded IgnitionModel so the test needs no real artifact."""

    model_version = "test-model"
    horizon_days = 3

    def predict_one(self, features):
        return 0.42


@pytest.fixture
def tower_with_history(db):
    tower = WatchtowerSite.objects.create(
        name="Predict Test",
        location=Point(-120.0, 38.0, srid=4326),
        elevation_m=1500,
        fuel_type="conifer",
    )
    # latest_feature_row needs a day with both weather and a risk assessment.
    for day in (date(2025, 7, 1), date(2025, 7, 2)):
        tower.weather.create(
            date=day,
            temp_c=28.0,
            rh_pct=18.0,
            wind_kph=20.0,
            precip_24h_mm=0.0,
            snow_depth_cm=0.0,
            external_uid=f"{tower.id}_{day}_open-meteo",
        )
        FireRiskAssessment.objects.create(
            tower=tower,
            date=day,
            ffmc=90.0,
            dmc=30.0,
            dc=200.0,
            isi=10.0,
            bui=35.0,
            fwi=22.0,
            risk_score=60.0,
            risk_level="high",
        )
    return tower


@pytest.mark.django_db
def test_writes_one_prediction_per_tower(tower_with_history, monkeypatch):
    path = mock.Mock()
    path.exists.return_value = True
    monkeypatch.setattr("towers.management.commands.predict_ignition.ARTIFACT_PATH", path)
    monkeypatch.setattr(
        "towers.management.commands.predict_ignition.IgnitionModel.load",
        lambda _p: _StubModel(),
    )

    call_command("predict_ignition")

    preds = IgnitionPrediction.objects.filter(tower=tower_with_history)
    assert preds.count() == 1
    pred = preds.first()
    assert pred.probability == pytest.approx(0.42)
    assert pred.horizon_days == 3
    assert pred.model_version == "test-model"
    assert pred.date == date(2025, 7, 2)  # the most recent populated day


@pytest.mark.django_db
def test_idempotent_on_rerun(tower_with_history, monkeypatch):
    path = mock.Mock()
    path.exists.return_value = True
    monkeypatch.setattr("towers.management.commands.predict_ignition.ARTIFACT_PATH", path)
    monkeypatch.setattr(
        "towers.management.commands.predict_ignition.IgnitionModel.load",
        lambda _p: _StubModel(),
    )

    call_command("predict_ignition")
    call_command("predict_ignition")
    assert IgnitionPrediction.objects.count() == 1  # update_or_create, no dupes


@pytest.mark.django_db
def test_graceful_noop_without_artifact(tower_with_history, monkeypatch, tmp_path):
    missing = tmp_path / "no_model.joblib"
    monkeypatch.setattr("towers.management.commands.predict_ignition.ARTIFACT_PATH", missing)
    load = mock.Mock()
    monkeypatch.setattr("towers.management.commands.predict_ignition.IgnitionModel.load", load)

    call_command("predict_ignition")  # must not raise

    assert IgnitionPrediction.objects.count() == 0
    load.assert_not_called()
