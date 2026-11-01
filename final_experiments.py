"""
Controlled experiments for one-hour-ahead PM2.5 forecasting at CPCB Anand Vihar.

Run from the project root:
    python -m pip install pandas numpy scikit-learn joblib
    python final_experiments.py

Protocol:
- Source-hour features predict PM2.5 exactly one hour later.
- Chronological target-time split: train 2022-2024, validation 2025, test 2026.
- Compare a compact baseline feature set with an expanded lag/rolling/time feature set.
- Test a small number of high-pollution sample-weighting strategies.
- Select by 2025 overall validation MAE only.
- Evaluate the selected configuration once on 2026.
- Write all outputs under final_experiments/ and never overwrite existing project outputs.
- Extreme source readings are exported for manual review, not automatically discarded.
"""

from pathlib import Path
import json
import warnings

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline

warnings.filterwarnings("ignore", category=UserWarning)

BASE_DIR = Path(__file__).resolve().parent
DATA_CANDIDATES = [
    BASE_DIR / "data" / "processed" / "cpcb_anand_vihar_hourly.csv",
    BASE_DIR / "processed" / "cpcb_anand_vihar_hourly.csv",
    BASE_DIR / "cpcb_anand_vihar_hourly.csv",
]
DATA_PATH = next((p for p in DATA_CANDIDATES if p.exists()), DATA_CANDIDATES[0])
OUT_DIR = BASE_DIR / "final_experiments"
MODEL_DIR = OUT_DIR / "models"
OUT_DIR.mkdir(parents=True, exist_ok=True)
MODEL_DIR.mkdir(parents=True, exist_ok=True)

TIME_COL = "Timestamp"
TARGET = "PM2.5 (µg/m³)"
CUTOFF = 500.0
RANDOM_STATE = 42

DROP_EXACT = {
    TIME_COL, "date", "source_file", TARGET,
    "pm25_negative_flag", "pm25_over_500_flag", "pm25_over_1000_flag",
}
DROP_PREFIXES = ("pm25_", "target_", "future_")

HGB_CONFIGS = [
    {"max_iter": 150, "learning_rate": 0.05, "max_leaf_nodes": 31,
     "l2_regularization": 1.0, "min_samples_leaf": 20},
    {"max_iter": 200, "learning_rate": 0.04, "max_leaf_nodes": 31,
     "l2_regularization": 2.0, "min_samples_leaf": 30},
    {"max_iter": 250, "learning_rate": 0.03, "max_leaf_nodes": 31,
     "l2_regularization": 3.0, "min_samples_leaf": 40},
]
ET_CONFIGS = [
    {"n_estimators": 100, "min_samples_leaf": 3, "max_features": 0.7,
     "max_depth": None},
    {"n_estimators": 120, "min_samples_leaf": 5, "max_features": 0.7,
     "max_depth": None},
]
WEIGHT_POLICIES = {
    "unweighted": (None, 1.0),
    "high_120_1.5x": (120.0, 1.5),
    "high_120_2x": (120.0, 2.0),
    "high_250_2x": (250.0, 2.0),
}


def metrics(y_true, y_pred):
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.maximum(0.0, np.asarray(y_pred, dtype=float))
    err = y_pred - y_true
    return {
        "MAE": float(mean_absolute_error(y_true, y_pred)),
        "RMSE": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "R2": float(r2_score(y_true, y_pred)) if len(y_true) > 1 else None,
        "mean_bias": float(np.mean(err)),
        "p90_absolute_error": float(np.quantile(np.abs(err), 0.90)),
        "n": int(len(y_true)),
    }


def make_pipeline(family, params):
    if family == "HistGradientBoosting":
        model = HistGradientBoostingRegressor(
            random_state=RANDOM_STATE, early_stopping=False, **params
        )
    elif family == "Extra Trees":
        model = ExtraTreesRegressor(
            random_state=RANDOM_STATE, n_jobs=-1, **params
        )
    else:
        raise ValueError(f"Unknown model family: {family}")
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", model),
    ])


def build_feature_sets(df):
    times = df[TIME_COL]
    pm = df[TARGET]

    raw_cols = [
        c for c in df.columns
        if c not in DROP_EXACT
        and not c.startswith(DROP_PREFIXES)
        and pd.api.types.is_numeric_dtype(df[c])
    ]
    base = df[raw_cols].copy()
    base["pm25_current"] = pm
    for lag in (1, 2, 3, 6, 12, 24, 48, 168):
        base[f"pm25_lag_{lag}h"] = pm.shift(lag)

    # Extended features are derived only from data available at source hour t.
    extended = base.copy()
    for window in (3, 6, 12, 24, 48, 168):
        prior = pm.shift(1).rolling(
            window, min_periods=max(2, window // 3)
        )
        extended[f"pm25_rolling_mean_{window}h"] = prior.mean()
        extended[f"pm25_rolling_std_{window}h"] = prior.std()

    for lag in (1, 2, 3, 6, 12, 24):
        extended[f"pm25_change_{lag}h"] = pm - pm.shift(lag)

    hour = times.dt.hour
    dow = times.dt.dayofweek
    doy = times.dt.dayofyear
    extended["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    extended["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    extended["dow_sin"] = np.sin(2 * np.pi * dow / 7)
    extended["dow_cos"] = np.cos(2 * np.pi * dow / 7)
    extended["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    extended["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)

    feature_sets = {}
    for name, frame in (("baseline_features", base), ("expanded_features", extended)):
        frame = frame.replace([np.inf, -np.inf], np.nan)
        frame = frame.loc[:, frame.nunique(dropna=True) > 1]
        feature_sets[name] = frame
    return feature_sets


def main():
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            "Could not find processed CPCB dataset. Checked:\n"
            + "\n".join(str(p) for p in DATA_CANDIDATES)
        )

    df = pd.read_csv(DATA_PATH)
    if TIME_COL not in df.columns or TARGET not in df.columns:
        raise ValueError(
            f"Expected columns {TIME_COL!r} and {TARGET!r}; "
            f"found: {df.columns.tolist()}"
        )
    df[TIME_COL] = pd.to_datetime(df[TIME_COL], errors="coerce")
    df[TARGET] = pd.to_numeric(df[TARGET], errors="coerce")
    df = (df.dropna(subset=[TIME_COL]).sort_values(TIME_COL)
            .drop_duplicates(subset=[TIME_COL], keep="last").reset_index(drop=True))

    # Export suspicious readings; source authenticity requires manual checking.
    review_mask = df[TARGET].notna() & ((df[TARGET] < 0) | (df[TARGET] > CUTOFF))
    review_cols = [c for c in [
        TIME_COL, TARGET, "PM10 (µg/m³)", "NO (µg/m³)", "NO2 (µg/m³)",
        "NOx (ppb)", "CO (mg/m³)", "AT (°C)", "RH (%)", "WS (m/s)",
        "WD (deg)", "source_file", "pm25_negative_flag",
        "pm25_over_500_flag", "pm25_over_1000_flag",
    ] if c in df.columns]
    df.loc[review_mask, review_cols].sort_values(TARGET, ascending=False).to_csv(
        OUT_DIR / "cpcb_extreme_readings_review.csv", index=False
    )

    feature_sets = build_feature_sets(df)
    times = df[TIME_COL]
    pm = df[TARGET]
    y = pm.shift(-1)
    target_time = times.shift(-1)
    source_time = times
    exact_pair = (target_time - source_time) == pd.Timedelta(hours=1)
    valid = y.notna() & exact_pair & (y >= 0) & (y <= CUTOFF)

    y = y.loc[valid].astype(float)
    target_time = target_time.loc[valid]
    source_time = source_time.loc[valid]
    target_year = target_time.dt.year
    train_mask = target_year.between(2022, 2024)
    val_mask = target_year.eq(2025)
    test_mask = target_year.eq(2026)
    if not train_mask.any() or not val_mask.any() or not test_mask.any():
        raise ValueError("Missing usable train (2022-24), validation (2025), or test (2026) targets.")

    # Align each feature set to the same valid target rows and timestamps.
    feature_sets = {k: v.loc[valid].copy() for k, v in feature_sets.items()}
    X_train_y, y_train = None, y.loc[train_mask]
    y_val, y_test = y.loc[val_mask], y.loc[test_mask]
    tuning_rows = []
    best = None

    print(f"Dataset: {DATA_PATH}")
    print(f"Exact one-hour pairs, target 0-{CUTOFF:g}: {len(y):,}")
    print(f"Train: {int(train_mask.sum()):,} | Validation: {int(val_mask.sum()):,} | Test: {int(test_mask.sum()):,}")
    print("Selection uses 2025 validation overall MAE only; 2026 is held out.")
    print("Features: " + ", ".join(f"{k}={v.shape[1]}" for k, v in feature_sets.items()))

    for feature_name, X in feature_sets.items():
        X_train, X_val = X.loc[train_mask], X.loc[val_mask]
        for family, configs in (("HistGradientBoosting", HGB_CONFIGS), ("Extra Trees", ET_CONFIGS)):
            for config_id, params in enumerate(configs, 1):
                # Extra Trees gets unweighted and 1.5x high-pollution runs to keep runtime practical.
                policies = WEIGHT_POLICIES.items()
                if family == "Extra Trees":
                    policies = [(k, v) for k, v in WEIGHT_POLICIES.items()
                                if k in ("unweighted", "high_120_1.5x")]
                for policy_name, (threshold, multiplier) in policies:
                    model = make_pipeline(family, params)
                    sample_weight = np.ones(len(y_train), dtype=float)
                    if threshold is not None:
                        sample_weight[y_train.to_numpy() >= threshold] = multiplier
                    model.fit(X_train, y_train, model__sample_weight=sample_weight)
                    pred = np.maximum(0, model.predict(X_val))
                    m = metrics(y_val, pred)
                    row = {
                        "feature_set": feature_name,
                        "model_family": family,
                        "config_id": config_id,
                        "weight_policy": policy_name,
                        "validation_MAE": m["MAE"],
                        "validation_RMSE": m["RMSE"],
                        "validation_R2": m["R2"],
                        "validation_mean_bias": m["mean_bias"],
                        "validation_p90_absolute_error": m["p90_absolute_error"],
                        "validation_n": m["n"],
                        "feature_count": X.shape[1],
                        "parameters": json.dumps(params, sort_keys=True),
                    }
                    tuning_rows.append(row)
                    print(f"{feature_name} | {family} {config_id} | {policy_name}: "
                          f"MAE={m['MAE']:.3f}, RMSE={m['RMSE']:.3f}, R2={m['R2']:.4f}")
                    if best is None or m["MAE"] < best["validation_MAE"]:
                        best = {
                            **row, "params": params, "threshold": threshold,
                            "multiplier": multiplier, "model_family": family,
                            "feature_set": feature_name,
                        }

    tuning_df = pd.DataFrame(tuning_rows).sort_values("validation_MAE")
    tuning_df.to_csv(OUT_DIR / "experiment_tuning_results.csv", index=False)

    # Fit selected configuration on 2022-2025, then evaluate 2026 once.
    X = feature_sets[best["feature_set"]]
    pretest = train_mask | val_mask
    final_model = make_pipeline(best["model_family"], best["params"])
    y_pretest = y.loc[pretest]
    weights = np.ones(len(y_pretest), dtype=float)
    if best["threshold"] is not None:
        weights[y_pretest.to_numpy() >= best["threshold"]] = best["multiplier"]
    final_model.fit(X.loc[pretest], y_pretest, model__sample_weight=weights)
    test_pred = np.maximum(0, final_model.predict(X.loc[test_mask]))
    test_metrics = metrics(y_test, test_pred)

    pred_df = pd.DataFrame({
        "source_timestamp": source_time.loc[test_mask].values,
        "target_timestamp": target_time.loc[test_mask].values,
        "actual_PM2.5": y_test.values,
        "predicted_PM2.5": test_pred,
        "error_predicted_minus_actual": test_pred - y_test.values,
        "absolute_error": np.abs(test_pred - y_test.values),
    })
    pred_df.to_csv(OUT_DIR / "final_test_predictions.csv", index=False)
    pred_df[pred_df["actual_PM2.5"] >= 120].to_csv(
        OUT_DIR / "final_high_pollution_errors.csv", index=False
    )

    bands = [-np.inf, 30, 60, 90, 120, 250, 500, np.inf]
    labels = ["0–30", "30–60", "60–90", "90–120", "120–250", "250–500", "500+"]
    band_series = pd.cut(y_test, bins=bands, labels=labels, right=False)
    range_rows = []
    for label in labels:
        mask = np.asarray(band_series == label)
        if mask.any():
            m = metrics(y_test.to_numpy()[mask], test_pred[mask])
            range_rows.append({"actual_PM2.5_band_ug_m3": label, **m})
    pd.DataFrame(range_rows).to_csv(OUT_DIR / "final_error_by_pm25_range.csv", index=False)

    # Persistence baseline on the same test timestamps.
    baseline_pred = pm.loc[source_time.loc[test_mask].index].to_numpy(dtype=float)
    baseline_valid = np.isfinite(baseline_pred)
    baseline_metrics = metrics(y_test.to_numpy()[baseline_valid], baseline_pred[baseline_valid])

    model_path = MODEL_DIR / "pm25_model_final_experiment.joblib"
    joblib.dump(final_model, model_path)
    summary = {
        "selected_feature_set": best["feature_set"],
        "selected_model_family": best["model_family"],
        "selected_config_id": best["config_id"],
        "selected_weight_policy": best["weight_policy"],
        "selected_parameters": best["params"],
        "selection_metric": "2025 validation overall MAE",
        "validation_metrics": {
            "MAE": best["validation_MAE"],
            "RMSE": best["validation_RMSE"],
            "R2": best["validation_R2"],
        },
        "test_2026_metrics": test_metrics,
        "persistence_baseline_2026": baseline_metrics,
        "feature_count": int(X.shape[1]),
        "train_observations": int(train_mask.sum()),
        "validation_observations": int(val_mask.sum()),
        "test_observations": int(test_mask.sum()),
        "forecast_horizon": "1 hour",
        "target_cutoff_ug_m3": CUTOFF,
        "model_file": str(model_path),
        "leakage_controls": [
            "only source-hour features used to predict next-hour target",
            "only exact consecutive one-hour timestamp pairs",
            "target-derived flags excluded from predictors",
            "2025 validation MAE used for configuration selection",
            "2026 used only for the final selected configuration",
        ],
    }
    (OUT_DIR / "final_model_metrics.json").write_text(
        json.dumps(summary, indent=2, default=str), encoding="utf-8"
    )

    print("\nSELECTED ON 2025 VALIDATION")
    print(f"Feature set: {best['feature_set']} ({X.shape[1]} features)")
    print(f"Model: {best['model_family']} config {best['config_id']}")
    print(f"Weight policy: {best['weight_policy']}")
    print(f"Validation MAE: {best['validation_MAE']:.3f} µg/m³")
    print("\nFINAL 2026 TEST")
    print(f"MAE={test_metrics['MAE']:.3f} | RMSE={test_metrics['RMSE']:.3f} | "
          f"R2={test_metrics['R2']:.4f} | bias={test_metrics['mean_bias']:.3f}")
    print(f"Persistence baseline MAE={baseline_metrics['MAE']:.3f}")
    print(f"\nAll new outputs saved in: {OUT_DIR}")
    print("Manually verify extreme readings against original CPCB source records.")


if __name__ == "__main__":
    main()
