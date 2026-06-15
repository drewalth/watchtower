"""Train the ignition-probability model on accumulated weather + FWI + FIRMS.

Assembles labeled samples across all towers, splits them **temporally** (train on
earlier dates, test on the most recent held-out span — fire is autocorrelated, so
a random split leaks the future into the past), fits a model plus an FWI-only
baseline, and reports the comparison that *is* the result: does the model beat the
Phase 4 index? Writes a joblib artifact + a metrics JSON for predict_ignition and
for the spec's verification.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    roc_auc_score,
)

from towers.ml.dataset import BASELINE_FEATURE, DEFAULT_HORIZON_DAYS
from towers.ml.django_data import assemble_all
from towers.ml.model import IgnitionModel, build_baseline
from towers.models import WatchtowerSite

ARTIFACT_DIR = Path(settings.BASE_DIR) / "models"
ARTIFACT_PATH = ARTIFACT_DIR / "ignition_model.joblib"
METRICS_PATH = ARTIFACT_DIR / "ignition_metrics.json"
# Fraction of the timeline (most recent) held out as the temporal test set.
TEST_FRACTION = 0.25
MODEL_KINDS = ("logreg", "hgb")


class Command(BaseCommand):
    help = (
        "Train the ignition-probability classifier on accumulated history, "
        "evaluate it against an FWI-only baseline on a temporally held-out test "
        "set, and write the artifact + metrics JSON."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--horizon", type=int, default=DEFAULT_HORIZON_DAYS,
            help=f"Prediction window in days. Default {DEFAULT_HORIZON_DAYS}.",
        )

    def handle(self, *args, **options):
        horizon = options["horizon"]
        towers = list(WatchtowerSite.objects.all())
        if not towers:
            raise CommandError(
                "No towers — run 'python manage.py seed_towers' first."
            )

        rows = assemble_all(towers, horizon_days=horizon)
        if not rows.records:
            raise CommandError(
                "No training rows — backfill weather/fires and run "
                "compute_fire_risk first (need days with both weather + FWI)."
            )

        train, test = self._temporal_split(rows)
        self.stdout.write(
            f"Assembled {len(rows.records)} rows "
            f"({sum(rows.labels)} positive). "
            f"Train {len(train['labels'])} / test {len(test['labels'])} "
            f"(temporal, cutoff {test['cutoff']})."
        )
        if len(set(train["labels"])) < 2:
            raise CommandError(
                "Training set has a single class (too few fire events in the "
                "early period). Widen the backfill window or add towers."
            )

        baseline_ap = self._baseline_ap(train, test)
        best = self._train_and_eval(train, test, horizon, baseline_ap)

        ARTIFACT_DIR.mkdir(exist_ok=True)
        best["model"].save(ARTIFACT_PATH)
        metrics = {
            "model_version": best["model"].model_version,
            "horizon_days": horizon,
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "n_train": len(train["labels"]),
            "n_test": len(test["labels"]),
            "n_positive": sum(rows.labels),
            "test_cutoff": test["cutoff"].isoformat(),
            "baseline_pr_auc": baseline_ap,
            "candidates": best["all_metrics"],
            "selected": best["model"].model_version,
        }
        METRICS_PATH.write_text(json.dumps(metrics, indent=2))

        self._report(best, baseline_ap)

    def _temporal_split(self, rows):
        """Split rows by date: earliest (1-TEST_FRACTION) train, latest test.

        The cutoff falls on a date boundary so no single day straddles the split
        (which would leak same-day correlated signal across train/test).
        """
        order = sorted(range(len(rows.dates)), key=lambda i: rows.dates[i])
        cut_index = int(len(order) * (1.0 - TEST_FRACTION))
        cutoff = rows.dates[order[min(cut_index, len(order) - 1)]]

        train = {"records": [], "labels": []}
        test = {"records": [], "labels": [], "cutoff": cutoff}
        for i in order:
            bucket = test if rows.dates[i] >= cutoff else train
            bucket["records"].append(rows.records[i])
            bucket["labels"].append(rows.labels[i])
        return train, test

    def _baseline_ap(self, train, test):
        """FWI-only PR-AUC on the test set (None if the test set is one-class)."""
        if len(set(test["labels"])) < 2:
            return None
        baseline = build_baseline(train["records"], train["labels"])
        import pandas as pd

        X = pd.DataFrame([{BASELINE_FEATURE: r[BASELINE_FEATURE]} for r in test["records"]])
        proba = baseline.predict_proba(X)[:, 1]
        return float(average_precision_score(test["labels"], proba))

    def _train_and_eval(self, train, test, horizon, baseline_ap):
        """Fit each model kind, score on the test set, keep the best PR-AUC."""
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        candidates = []
        for kind in MODEL_KINDS:
            model = self._fit(train, kind, horizon, f"{kind}-{stamp}")
            metrics = self._evaluate(model, test)
            candidates.append({"kind": kind, "model": model, "metrics": metrics})
            self.stdout.write(
                f"  {kind}: PR-AUC={_fmt(metrics['pr_auc'])} "
                f"ROC-AUC={_fmt(metrics['roc_auc'])} "
                f"Brier={_fmt(metrics['brier'])}"
            )

        # Rank by PR-AUC (the rare-event metric); None sorts last.
        best = max(candidates, key=lambda c: (c["metrics"]["pr_auc"] or -1.0))
        return {
            "model": best["model"],
            "metrics": best["metrics"],
            "all_metrics": [
                {"kind": c["kind"], "version": c["model"].model_version, **c["metrics"]}
                for c in candidates
            ],
        }

    def _fit(self, train, kind, horizon, version):
        """Fit one model; fall back to uncalibrated if calibration CV can't run."""
        try:
            return IgnitionModel.train(
                train["records"], train["labels"], horizon_days=horizon,
                model_version=version, kind=kind, calibrate=True,
            )
        except ValueError:
            # CalibratedClassifierCV needs ≥cv samples of each class; on thin data
            # it can't fold. Uncalibrated still produces ranked probabilities.
            self.stderr.write(self.style.WARNING(
                f"  {kind}: calibration skipped (too few samples per fold)."
            ))
            return IgnitionModel.train(
                train["records"], train["labels"], horizon_days=horizon,
                model_version=f"{version}-uncal", kind=kind, calibrate=False,
            )

    @staticmethod
    def _evaluate(model, test):
        if len(set(test["labels"])) < 2:
            return {"pr_auc": None, "roc_auc": None, "brier": None}
        proba = model.predict_proba(test["records"])
        return {
            "pr_auc": float(average_precision_score(test["labels"], proba)),
            "roc_auc": float(roc_auc_score(test["labels"], proba)),
            "brier": float(brier_score_loss(test["labels"], proba)),
        }

    def _report(self, best, baseline_ap):
        model_ap = best["metrics"]["pr_auc"]
        self.stdout.write(self.style.SUCCESS(
            f"Saved {best['model'].model_version} → {ARTIFACT_PATH}"
        ))
        if model_ap is None or baseline_ap is None:
            self.stdout.write(self.style.WARNING(
                "Test set is single-class — PR-AUC undefined. Accumulate more "
                "history (more fire-days in the held-out period) to evaluate."
            ))
            return
        verdict = "beats" if model_ap > baseline_ap else "does NOT beat"
        style = self.style.SUCCESS if model_ap > baseline_ap else self.style.WARNING
        self.stdout.write(style(
            f"Headline: model PR-AUC {model_ap:.3f} {verdict} "
            f"FWI-only baseline {baseline_ap:.3f}."
        ))


def _fmt(value):
    return "n/a" if value is None else f"{value:.3f}"
