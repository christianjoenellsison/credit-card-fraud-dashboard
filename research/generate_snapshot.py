"""Generate a public dashboard snapshot from the notebook's synthetic experiment."""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.datasets import make_classification
from sklearn.frozen import FrozenEstimator
from sklearn.metrics import average_precision_score, brier_score_loss, roc_curve
from sklearn.model_selection import train_test_split
from xgboost import DMatrix, XGBClassifier


SEED = 42
OUTPUT = Path(__file__).resolve().parents[1] / "site" / "data" / "snapshot.json"


def synthetic_data():
    values, labels = make_classification(
        n_samples=45_000,
        n_features=28,
        n_informative=10,
        n_redundant=8,
        n_clusters_per_class=2,
        weights=[0.994, 0.006],
        flip_y=0.0005,
        class_sep=1.15,
        random_state=SEED,
    )
    rng = np.random.default_rng(SEED)
    features = pd.DataFrame(values, columns=[f"V{i}" for i in range(1, 29)])
    features.insert(0, "Time", rng.uniform(0, 172_800, size=len(features)))
    features["Amount"] = rng.lognormal(mean=3, sigma=1.2, size=len(features))
    return features, labels


def split(features, labels, train_size):
    return train_test_split(
        features, labels, train_size=train_size, stratify=labels, random_state=SEED
    )


def train_model(features, labels, positive_weight):
    return XGBClassifier(
        n_estimators=160,
        max_depth=4,
        learning_rate=0.075,
        subsample=0.85,
        colsample_bytree=0.85,
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        random_state=SEED,
        n_jobs=2,
        scale_pos_weight=positive_weight,
    ).fit(features, labels)


def choose_threshold(labels, scores, budget):
    false_positive_rate, recall, thresholds = roc_curve(labels, scores)
    eligible = np.flatnonzero((false_positive_rate <= budget) & np.isfinite(thresholds))
    if not eligible.size:
        return float(np.nextafter(scores.max(), np.inf))
    best = min(eligible, key=lambda i: (-recall[i], false_positive_rate[i], -thresholds[i]))
    return float(thresholds[best])


def summarize_model(labels, scores):
    return {
        "averagePrecision": float(average_precision_score(labels, scores)),
        "brierScore": float(brier_score_loss(labels, scores)),
    }


def build_snapshot():
    features, labels = synthetic_data()
    train, remaining, y_train, y_remaining = split(features, labels, 0.60)
    calibration, remaining, y_calibration, y_remaining = split(remaining, y_remaining, 0.375)
    tuning, test, y_tuning, y_test = split(remaining, y_remaining, 0.40)

    baseline = train_model(train, y_train, 1)
    weighted = train_model(train, y_train, (len(y_train) - y_train.sum()) / y_train.sum())
    calibrated = CalibratedClassifierCV(FrozenEstimator(weighted), method="sigmoid")
    calibrated.fit(calibration, y_calibration)
    tuning_scores = calibrated.predict_proba(tuning)[:, 1]
    test_scores = calibrated.predict_proba(test)[:, 1]

    review_budget, block_budget = 0.01, 0.001
    review_threshold = choose_threshold(y_tuning, tuning_scores, review_budget)
    block_threshold = max(review_threshold, choose_threshold(y_tuning, tuning_scores, block_budget))
    actions = np.where(test_scores >= block_threshold, "block", np.where(test_scores >= review_threshold, "review", "allow"))

    # XGBoost's exact TreeSHAP implementation returns one bias column after the features.
    test_matrix = DMatrix(test)
    booster = weighted.get_booster()
    contributions = booster.predict(test_matrix, pred_contribs=True)
    margins = booster.predict(test_matrix, output_margin=True)
    np.testing.assert_allclose(contributions.sum(axis=1), margins, rtol=1e-5, atol=2e-5)
    values = contributions[:, :-1]

    rank_sample = test.sample(n=220, random_state=SEED)
    baseline_values = baseline.get_booster().predict(DMatrix(rank_sample), pred_contribs=True)[:, :-1]
    weighted_values = values[test.index.get_indexer(rank_sample.index)]
    baseline_means = np.abs(baseline_values).mean(axis=0)
    weighted_means = np.abs(weighted_values).mean(axis=0)
    global_importance = [
        {
            "feature": test.columns[i],
            "baseline": float(baseline_means[i]),
            "weighted": float(weighted_means[i]),
        }
        for i in np.argsort(-weighted_means)
    ]

    highest_first = np.argsort(-test_scores, kind="stable")
    strongest = np.argsort(-np.abs(values), axis=1, kind="stable")[:, :6]
    cases = [
        {
            "id": f"TX-{i + 1:05d}",
            "score": float(test_scores[i]),
            "action": str(actions[i]),
            "label": int(y_test[i]),
            "drivers": [[test.columns[j], round(float(values[i, j]), 5)] for j in strongest[i]],
        }
        for i in highest_first
    ]

    return {
        "schemaVersion": 1,
        "dataMode": "synthetic",
        "seed": SEED,
        "partitions": {
            "training": len(train),
            "calibration": len(calibration),
            "tuning": len(tuning),
            "test": len(test),
        },
        "thresholds": {"review": review_threshold, "block": block_threshold},
        "budgets": {"review": review_budget, "block": block_budget},
        "models": {
            "baseline": summarize_model(y_test, baseline.predict_proba(test)[:, 1]),
            "weighted": summarize_model(y_test, weighted.predict_proba(test)[:, 1]),
            "calibrated": summarize_model(y_test, test_scores),
        },
        "importanceSampleSize": len(rank_sample),
        "globalImportance": global_importance,
        "cases": cases,
    }


if __name__ == "__main__":
    snapshot = build_snapshot()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.partial")
    temporary.write_text(
        json.dumps(snapshot, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    temporary.replace(OUTPUT)
    print(f"Saved {len(snapshot['cases']):,} synthetic held-out cases to {OUTPUT}")
