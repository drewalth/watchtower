"""Pure model wrapper: train → predict → (de)serialize (no DB / no network)."""

from towers.ml.dataset import CATEGORICAL_FEATURES, NUMERIC_FEATURES
from towers.ml.model import IgnitionModel, build_baseline


def _record(*, fwi: float, fuel: str = "conifer") -> dict:
    """A full feature dict; only ``fwi`` varies for the separability checks."""
    rec = {name: 0.0 for name in NUMERIC_FEATURES}
    rec["fwi"] = fwi
    for name in CATEGORICAL_FEATURES:
        rec[name] = fuel
    return rec


def _separable_dataset():
    """High-FWI days burn, low-FWI days don't — a trivially separable set."""
    hot = [_record(fwi=v) for v in (40.0, 45.0, 50.0, 55.0, 60.0)]
    cold = [_record(fwi=v) for v in (0.0, 1.0, 2.0, 3.0, 4.0)]
    records = hot + cold
    labels = [1] * len(hot) + [0] * len(cold)
    return records, labels


def test_model_separates_a_trivially_separable_set():
    records, labels = _separable_dataset()
    model = IgnitionModel.train(
        records,
        labels,
        horizon_days=3,
        model_version="test",
        kind="logreg",
        calibrate=False,
    )
    hot_p = model.predict_one(_record(fwi=58.0))
    cold_p = model.predict_one(_record(fwi=0.5))
    assert hot_p > cold_p
    assert hot_p > 0.5 > cold_p


def test_train_predict_serialize_roundtrips_identically(tmp_path):
    records, labels = _separable_dataset()
    model = IgnitionModel.train(
        records,
        labels,
        horizon_days=3,
        model_version="v1",
        kind="hgb",
        calibrate=False,
    )
    before = model.predict_proba(records)

    path = tmp_path / "model.joblib"
    model.save(path)
    reloaded = IgnitionModel.load(path)

    assert reloaded.model_version == "v1"
    assert reloaded.horizon_days == 3
    assert reloaded.predict_proba(records) == before  # bit-identical round-trip


def test_baseline_uses_only_fwi():
    records, labels = _separable_dataset()
    baseline = build_baseline(records, labels)
    # The baseline must still discriminate on FWI alone.
    import pandas as pd

    hot = baseline.predict_proba(pd.DataFrame([{"fwi": 58.0}]))[0, 1]
    cold = baseline.predict_proba(pd.DataFrame([{"fwi": 0.5}]))[0, 1]
    assert hot > cold
