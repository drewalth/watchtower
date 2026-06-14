# Phase 5 — ML Fire-Ignition Prediction

**Status:** Draft / design
**Date:** 2026-06-14
**Builds on:** Phase 4 (FWI fire-weather index, `towers/fire_weather.py`,
`WeatherObservation`, `FireRiskAssessment`)

## Context

Phase 4 gives every tower a deterministic **fire-weather** rating: the Canadian
FWI System turns weather into an explainable risk score (conditions *favorable*
to fire). It does not learn from what actually burned — the live FIRMS detection
history sits unused as a predictive signal.

Phase 5 closes that loop. We now accumulate, per tower and per day, both the
weather/FWI inputs (`WeatherObservation`, `FireRiskAssessment`) **and** the
ground-truth fire detections (`FireDetection`). That is exactly the shape of a
supervised learning problem: features in, a labeled outcome out. The goal is a
model that predicts the **probability a fire ignites within a tower's coverage
in the next few days**, trained on history, and shown alongside the FWI rating
so the two can be compared.

This is explicitly a **learning/portfolio** exercise. The honest expectation
(see Risks) is that beating the FWI baseline with five towers and a short history
is hard; the value is the end-to-end ML pipeline — labeling, leakage-safe
evaluation, calibration, and serving — done correctly.

## Goals / non-goals

**Goals**
- Assemble a leakage-safe, reproducible training dataset from accumulated
  weather + FWI + FIRMS history.
- Train and **honestly evaluate** an ignition-probability classifier against a
  clear FWI-only baseline.
- Persist the model as a versioned artifact and produce a daily
  `IgnitionPrediction` per tower.
- Serve the prediction next to the FWI risk in the API and map, framed as
  "model probability" vs. "fire-weather index."

**Non-goals**
- Fire *spread*/perimeter modeling, deep learning, or remote-sensing imagery.
- Replacing the FWI system — the deterministic index stays the primary signal;
  the model is an additive, comparative layer.
- Real-time/sub-daily inference. Predictions are daily, like FWI.

## Core framing

Binary classification per **(tower, day)**:

> Given the conditions known on day *t*, what is the probability that at least
> one FIRMS detection falls inside this tower's coverage during the window
> *(t, t + H]*?

- **Horizon `H`** — configurable, default **3 days** (a useful early-warning lead
  time; short enough that the same weather regime plausibly persists).
- Output is a **calibrated probability** in [0, 1], not a hard class.

## Labeling

For each `(tower, date)` that has a `FireRiskAssessment`:

- `label = 1` if `tower.fires_in_range(...)` returns any `FireDetection` with
  `acquired_at` in `(date, date + H]`, else `0`.
- Reuse the existing spatial query (`WatchtowerSite.fires_in_range`,
  `towers/models.py`) — it already does viewshed-`intersects`-or-radius the
  correct way. This guarantees labels use the *same* coverage definition the rest
  of the app uses.

**Class imbalance is severe** (fire-days are rare). Handle via class weighting
and PR-curve-based evaluation rather than accuracy (see Evaluation). Do **not**
random-undersample before the temporal split — that leaks.

## Features

Per `(tower, date)`, assembled by joining the existing tables:

- **Weather** (`WeatherObservation`): temp, RH, wind, 24h precip, snow depth.
- **FWI codes** (`FireRiskAssessment`): FFMC, DMC, DC, ISI, BUI, FWI,
  `risk_score`. These encode antecedent dryness the raw daily weather misses —
  the strongest expected signal.
- **Rolling aggregates** (computed in assembly): e.g. 7-day mean temp, 7-day
  cumulative precip, days-since-rain. Cheap, high-value.
- **Static / contextual**: `fuel_type` (one-hot), `elevation_m`,
  day-of-year / month (cyclical encoding for seasonality), latitude.

No target leakage: every feature must be knowable on day *t* (nothing from the
`(t, t+H]` window that defines the label).

## Historical backfill (bootstrapping training data)

The hourly scheduler only accumulates data going forward; training needs months.
A one-time backfill seeds history:

- **Weather** — Open-Meteo **archive API** (`archive-api.open-meteo.com`, free, no
  key) reaches back decades. New command `backfill_weather --start --end` reuses
  the Phase 4 `OpenMeteoResponse` Pydantic boundary and `WeatherObservation`
  upsert.
- **Fires** — FIRMS **archive/standard-processing** endpoints cover older seasons
  than the NRT sensors `ingest_fires` currently pulls. Extend `ingest_fires`
  (or add `backfill_fires`) to accept a date range against the archive source,
  reusing the `FirmsRow` boundary and `FireDetection` dedup.
- Then run `compute_fire_risk` over the backfilled range to populate FWI codes.

Target an initial window of **≥1–2 fire seasons** across the 5 towers. Document
the exact range used so training is reproducible.

## Pipeline & new components

Follows the established `ingest → compute → serve` command pattern; pure logic
kept network/DB-free for testability (as with `fire_weather.py` / `viewshed.py`).

| Concern | File | Notes |
|---|---|---|
| Feature/label assembly (pure) | `towers/ml/dataset.py` | `(tower, date)` rows → feature dict + label; no I/O |
| Model wrapper (pure-ish) | `towers/ml/model.py` | build / train / predict / (de)serialize a sklearn `Pipeline` |
| Backfill weather | `management/commands/backfill_weather.py` | Open-Meteo archive |
| Backfill/extend fires | `management/commands/ingest_fires.py` | archive date range |
| Train | `management/commands/train_fire_model.py` | assemble → split → fit → eval → write artifact + metrics |
| Predict | `management/commands/predict_ignition.py` | load artifact → write `IgnitionPrediction` per tower for today |
| Prediction store | `towers/models.py` | new `IgnitionPrediction` |
| Artifact | `models/` dir (git-ignored) | `joblib` file, versioned by hash/date |

### Storage

```
IgnitionPrediction(tower FK, date, probability float, horizon_days int,
                   model_version str, created_at)  # unique (tower, date, model_version)
```

Keep ML predictions in their own table — decoupled from the deterministic
`FireRiskAssessment`, independently re-runnable, and clear about provenance
(`model_version`).

## Model & training

- **Baseline (must beat):** FWI alone as a single-feature classifier — i.e. does
  the model add anything over the Phase 4 index?
- **Models:** start with **logistic regression** (interpretable, naturally
  calibrated) and **`HistGradientBoostingClassifier`** (handles nonlinearity /
  interactions). Both via scikit-learn `Pipeline` (impute → scale/encode → fit).
- **Imbalance:** `class_weight="balanced"` (or `scale_pos_weight`); never tune on
  accuracy.
- **Calibration:** wrap in `CalibratedClassifierCV` (isotonic/sigmoid) so the
  served probability is meaningful.
- **Reproducibility:** fixed `random_state`; persist the feature list + model
  version in the artifact.

## Evaluation (the rigor that matters)

- **Temporal split, not random.** Train on earlier dates, test on a held-out
  later period (e.g. the most recent season). Fire is strongly autocorrelated in
  time and space — random K-fold leaks future into past and inflates scores.
  Consider `TimeSeriesSplit` for validation within the training window.
- **Metrics for rare events:** **PR-AUC / average precision** (primary),
  ROC-AUC, Brier score + a reliability (calibration) curve. Report precision and
  recall at a chosen operating threshold, not a single accuracy number.
- **Lift over baseline:** headline result is model PR-AUC vs. the FWI-only
  baseline. If it doesn't beat FWI, say so plainly — that's a valid finding.
- Persist a metrics JSON next to the artifact for the spec's verification.

## Serving / UI

- **API:** extend `towers.geojson` properties and `/api/towers/<id>/risk.json`
  with `ignition_probability`, `horizon_days`, `model_version` (null when no
  model is trained yet — same null-safe pattern Phase 4 uses for risk).
- **Frontend (`MapView.tsx`):** in the existing risk panel, show the model
  probability beside the FWI level (e.g. "FWI: Very high · Model: 18% / 3-day").
  Optional later: a layer toggle to color markers by model probability instead of
  FWI level. Reuse `useJson` + the typed contract in `lib/types.ts`.

## Dependencies

`uv add scikit-learn joblib` (numpy/pandas already present). Rebuild the image.

## Phasing

1. **Data** — backfill weather + fires, run `compute_fire_risk` over history.
2. **Dataset** — `towers/ml/dataset.py` + tests (labeling correctness, no
   leakage, feature shape).
3. **Train/eval** — `train_fire_model` with temporal split + baseline + metrics
   artifact.
4. **Predict + store** — `IgnitionPrediction` + `predict_ignition`, wired into
   the scheduler after `compute_fire_risk`.
5. **Serve** — API fields + risk-panel display.

Each phase is independently testable and shippable.

## Testing strategy

- **`towers/ml/dataset.py` (pure):** label is 1 iff a detection lands in coverage
  within `H` days and 0 otherwise; rolling features compute correctly; no feature
  references the label window (leakage guard).
- **`model.py` (pure):** train→predict→serialize→deserialize round-trips and
  yields identical probabilities; predicts on a tiny synthetic separable set.
- **Commands (`@pytest.mark.django_db`):** backfill upsert idempotency (reusing
  Phase 4 patterns); `predict_ignition` writes one `IgnitionPrediction` per tower;
  graceful no-op when no artifact exists.
- **Views:** prediction fields present (and null-safe) in both endpoints.
- Mock Open-Meteo/FIRMS HTTP exactly as Phase 4 tests do.

## Risks & honest caveats

- **Small data / rare positives.** Five towers and a short history yield few fire
  events → high variance and real overfitting risk. The model may not beat FWI.
  This is acceptable and worth stating in results.
- **Spatial leakage.** Nearby towers on the same day see correlated weather and
  fires; with a temporal split this is mostly handled, but report it.
- **Label noise.** FIRMS misses (clouds, small/cool fires) and the coverage
  polygon is approximate → imperfect labels.
- **Mitigations to scale signal:** widen the backfill window; add towers; or move
  from per-tower to a **gridded sampling** scheme (many cell-days) to grow the
  positive count — a natural follow-on if per-tower data proves too thin.

## Open questions

1. Horizon `H` — fix at 3 days, or train/report several (1/3/7)?
2. Per-tower rows only, or expand to gridded cell-days now to fight data scarcity?
3. How far back can the FIRMS archive realistically supply detections for these
   coordinates — does it bound the usable training window?

## Verification (when implemented)

```bash
docker compose build web                      # picks up scikit-learn/joblib
docker compose exec web python manage.py backfill_weather --start 2024-05-01 --end 2025-11-01
docker compose exec web python manage.py ingest_fires --start 2024-05-01 --end 2025-11-01   # archive range
docker compose exec web python manage.py compute_fire_risk
docker compose exec web python manage.py train_fire_model   # writes artifact + metrics JSON
docker compose exec web python manage.py predict_ignition   # writes IgnitionPredictions
curl localhost:8000/api/towers/1/risk.json    # includes ignition_probability
docker compose exec web pytest
```

Headline check: the metrics JSON shows model PR-AUC **and** the FWI-only baseline
PR-AUC on the held-out temporal test set — the comparison is the result.
