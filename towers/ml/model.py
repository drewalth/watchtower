"""The ignition-probability classifier: build / train / predict / persist.

A thin wrapper over a scikit-learn ``Pipeline`` (impute → scale numeric +
one-hot encode ``fuel_type`` → classifier), optionally wrapped in
``CalibratedClassifierCV`` so the served probability is meaningful. Kept free of
Django so it round-trips and predicts in plain tests; the command layer feeds it
the assembled feature dicts from ``dataset.py`` and handles I/O.
"""

from __future__ import annotations

from dataclasses import dataclass

import joblib
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from .dataset import (
    BASELINE_FEATURE,
    CATEGORICAL_FEATURES,
    NUMERIC_FEATURES,
)

RANDOM_STATE = 42
# All feature columns the full model consumes, in a stable order.
ALL_FEATURES = list(NUMERIC_FEATURES) + list(CATEGORICAL_FEATURES)


def _frame(records: list[dict], columns: list[str]) -> pd.DataFrame:
    """List-of-feature-dicts → a DataFrame with exactly ``columns`` (ordered).

    Named columns are what the ColumnTransformer selects on, so we pin them
    explicitly rather than relying on dict ordering.
    """
    return pd.DataFrame.from_records(records)[columns]


def _classifier(kind: str):
    """The base estimator for ``kind`` (imbalance handled via class weighting)."""
    if kind == "logreg":
        return LogisticRegression(class_weight="balanced", max_iter=1000, random_state=RANDOM_STATE)
    if kind == "hgb":
        # HistGradientBoosting has no class_weight. We don't reweight here; the
        # rare-event handling lives downstream (probability calibration + PR-AUC
        # evaluation + the served threshold) rather than in the loss.
        return HistGradientBoostingClassifier(random_state=RANDOM_STATE)
    raise ValueError(f"unknown model kind: {kind!r}")


def build_pipeline(
    kind: str = "hgb",
    *,
    numeric: list[str] | None = None,
    categorical: list[str] | None = None,
    calibrate: bool = True,
) -> Pipeline:
    """A preprocessing + classifier pipeline over the named feature columns."""
    numeric = list(NUMERIC_FEATURES) if numeric is None else numeric
    categorical = list(CATEGORICAL_FEATURES) if categorical is None else categorical

    transformers = [
        (
            "num",
            Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]),
            numeric,
        )
    ]
    if categorical:
        transformers.append(("cat", OneHotEncoder(handle_unknown="ignore"), categorical))
    pre = ColumnTransformer(transformers, remainder="drop")

    estimator = _classifier(kind)
    if calibrate:
        # Calibrate so predict_proba is well-grounded. cv=3 keeps it feasible on
        # the thin per-tower data; the command catches a failure and falls back.
        estimator = CalibratedClassifierCV(estimator, method="sigmoid", cv=3)

    return Pipeline([("pre", pre), ("clf", estimator)])


@dataclass
class IgnitionModel:
    """A fitted pipeline plus the metadata needed to serve + reproduce it."""

    pipeline: Pipeline
    feature_columns: list[str]
    horizon_days: int
    model_version: str

    @classmethod
    def train(
        cls,
        records: list[dict],
        labels: list[int],
        *,
        horizon_days: int,
        model_version: str,
        kind: str = "hgb",
        calibrate: bool = True,
    ) -> IgnitionModel:
        """Fit a full-feature model on the assembled samples."""
        pipeline = build_pipeline(kind, calibrate=calibrate)
        X = _frame(records, ALL_FEATURES)
        pipeline.fit(X, labels)
        return cls(
            pipeline=pipeline,
            feature_columns=ALL_FEATURES,
            horizon_days=horizon_days,
            model_version=model_version,
        )

    def predict_proba(self, records: list[dict]) -> list[float]:
        """P(ignition) for each feature dict, in order."""
        X = _frame(records, self.feature_columns)
        return [float(p) for p in self.pipeline.predict_proba(X)[:, 1]]

    def predict_one(self, features: dict) -> float:
        return self.predict_proba([features])[0]

    def save(self, path) -> None:
        joblib.dump(self, path)

    @classmethod
    def load(cls, path) -> IgnitionModel:
        return joblib.load(path)


def build_baseline(records: list[dict], labels: list[int]) -> Pipeline:
    """FWI-only single-feature logistic baseline the full model must beat.

    If the model can't out-predict ``fwi`` alone, the Phase 4 index already
    captured the signal — and that is a valid finding to report.
    """
    pipeline = build_pipeline("logreg", numeric=[BASELINE_FEATURE], categorical=[], calibrate=False)
    pipeline.fit(_frame(records, [BASELINE_FEATURE]), labels)
    return pipeline
