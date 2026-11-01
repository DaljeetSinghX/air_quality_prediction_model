"""
Multi-horizon PM2.5 model training for 1h, 2h, 6h, 12h, 24h forecast horizons.
Chronological split: Train 2022-2024, Validation 2025, Test 2026.
Target at T+H matched by exact timestamp only (no row-offset substitution).
"""
import sys
import json
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional, Any

import numpy as np
import pandas as pd
import joblib

from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.ensemble import HistGradientBoostingRegressor, ExtraTreesRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "data" / "processed" / "cpcb_anand_vihar_hourly.csv"
MODELS_DIR = ROOT / "ml-service" / "models"
RESEARCH_DIR = ROOT / "research"
HORIZONS = [1, 2, 6, 12, 24]
EXISTING_1H_MODEL = MODELS_DIR / "pm25_model_final_experiment.joblib"
EXISTING_1H_METRICS = ROOT / "final_experiments" / "final_model_metrics.json"

LAG_STEPS = (1, 2, 3, 6, 12, 24, 48, 168)
ROLLING_WINDOWS = (3, 6, 12, 24, 48, 168)
CHANGE_STEPS = (1, 2, 3, 6, 12, 24)
RAW_COLS = [
    "PM10 (µg/m³)", "NO (µg/m³)", "NO2 (µg/m³)", "NOx (ppb)", "NH3 (µg/m³)",
    "SO2 (µg/m³)", "CO (mg/m³)", "Ozone (µg/m³)", "Benzene (µg/m³)",
    "Toluene (µg/m³)", "AT (°C)", "RH (%)", "WS (m/s)", "WD (deg)",
    "SR (W/mt2)", "BP (mmHg)",
]
PM25_BANDS = [(0,30,"0-30"),(30,60,"30-60"),(60,90,"60-90"),(90,120,"90-120"),(120,250,"120-250"),(250,500,"250-500")]


def find_pm25_col(df):
    candidates = [c for c in df.columns if "PM2.5" in str(c) or "PM25" in str(c)]
    if not candidates:
        raise ValueError("Cannot find PM2.5 column")
    return candidates[0]


def load_data():
    log.info(f"Loading {DATA_PATH}")
    df = pd.read_csv(DATA_PATH, low_memory=False)
    df["Timestamp"] = pd.to_datetime(df["Timestamp"])
    df = df.sort_values("Timestamp").drop_duplicates("Timestamp", keep="last").reset_index(drop=True)
    pm_col = find_pm25_col(df)
    log.info(f"Rows: {len(df):,}, Range: {df.Timestamp.min()} to {df.Timestamp.max()}")
    log.info(f"PM2.5 col: '{pm_col}', Missing: {df[pm_col].isna().sum():,}")
    return df


def build_feature_matrix(df):
    log.info("Building feature matrix...")
    pm_col = find_pm25_col(df)
    df2 = df.set_index("Timestamp").sort_index()
    hr = df2.asfreq("1h")
    pm = hr[pm_col]
    feat = pd.DataFrame(index=hr.index)
    for col in RAW_COLS:
        if col in hr.columns:
            feat[col] = hr[col]
    feat["hour"] = hr.index.hour
    feat["day_of_week"] = hr.index.dayofweek
    feat["day_of_month"] = hr.index.day
    feat["month"] = hr.index.month
    feat["day_of_year"] = hr.index.dayofyear
    feat["is_weekend"] = (hr.index.dayofweek >= 5).astype(int)
    feat["pm25_current"] = pm.values
    for lag in LAG_STEPS:
        feat[f"pm25_lag_{lag}h"] = pm.shift(lag)
    pm_s = pm.shift(1)
    for w in ROLLING_WINDOWS:
        r = pm_s.rolling(w, min_periods=max(2, w//3))
        feat[f"pm25_rolling_mean_{w}h"] = r.mean()
        feat[f"pm25_rolling_std_{w}h"] = r.std()
    for lag in CHANGE_STEPS:
        feat[f"pm25_change_{lag}h"] = pm - pm.shift(lag)
    h = hr.index.hour
    dw = hr.index.dayofweek
    dy = hr.index.dayofyear
    feat["hour_sin"] = np.sin(2*np.pi*h/24)
    feat["hour_cos"] = np.cos(2*np.pi*h/24)
    feat["dow_sin"] = np.sin(2*np.pi*dw/7)
    feat["dow_cos"] = np.cos(2*np.pi*dw/7)
    feat["doy_sin"] = np.sin(2*np.pi*dy/365.25)
    feat["doy_cos"] = np.cos(2*np.pi*dy/365.25)
    log.info(f"Feature matrix: {feat.shape}")
    return feat


def build_training_set(df, feat_matrix, horizon_h):
    pm_col = find_pm25_col(df)
    dfi = df.set_index("Timestamp").sort_index()
    src_idx = feat_matrix.index
    tgt_idx = src_idx + pd.Timedelta(hours=horizon_h)
    tgt_in_df = tgt_idx.isin(dfi.index)
    tgt_pm = dfi[pm_col].reindex(tgt_idx)
    valid = tgt_in_df & tgt_pm.notna().values & feat_matrix["pm25_current"].notna().values
    X = feat_matrix[valid].copy()
    y = dfi.loc[tgt_idx[valid], pm_col].values
    y = pd.Series(y, index=X.index)
    log.info(f"Horizon {horizon_h}h: {len(X):,} pairs (excluded {(~valid).sum():,})")
    return X, y


def get_existing_1h_features():
    if EXISTING_1H_MODEL.exists():
        try:
            p = joblib.load(EXISTING_1H_MODEL)
            imp = p.named_steps.get("imputer")
            if imp is not None and hasattr(imp, "feature_names_in_"):
                return list(imp.feature_names_in_)
        except Exception as e:
            log.warning(f"Cannot read 1h features: {e}")
    return None


def compute_metrics(y_true, y_pred):
    yt, yp = np.asarray(y_true), np.asarray(y_pred)
    err = yp - yt
    return {
        "MAE": float(mean_absolute_error(yt, yp)),
        "RMSE": float(np.sqrt(mean_squared_error(yt, yp))),
        "R2": float(r2_score(yt, yp)),
        "mean_bias": float(np.mean(err)),
        "p90_absolute_error": float(np.percentile(np.abs(err), 90)),
        "n": int(len(yt)),
    }


def range_metrics(y_true, y_pred):
    yt, yp = np.asarray(y_true), np.asarray(y_pred)
    results = []
    for lo, hi, label in PM25_BANDS:
        mask = (yt >= lo) & (yt < hi)
        if mask.sum() < 5:
            results.append({"band": label, "n": int(mask.sum()), "skipped": True})
            continue
        err = yp[mask] - yt[mask]
        results.append({
            "band": label,
            "MAE": float(mean_absolute_error(yt[mask], yp[mask])),
            "RMSE": float(np.sqrt(mean_squared_error(yt[mask], yp[mask]))),
            "R2": float(r2_score(yt[mask], yp[mask])) if mask.sum() > 2 else None,
            "mean_bias": float(np.mean(err)),
            "n": int(mask.sum()),
        })
    return results


def make_pipeline(estimator):
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
        ("model", estimator),
    ])


def train_horizon(df, feat_matrix, h, canonical_features, retrain_1h=True):
    log.info(f"\n{'='*60}\n Horizon: {h}h\n{'='*60}")
    hdir = MODELS_DIR / f"horizon_{h}h"
    hdir.mkdir(parents=True, exist_ok=True)

    # Reuse existing 1h model only if retrain_1h is explicitly False
    if h == 1 and not retrain_1h and EXISTING_1H_MODEL.exists() and EXISTING_1H_METRICS.exists():
        log.info("1h: Reusing existing validated artifact")
        try:
            pipe = joblib.load(EXISTING_1H_MODEL)
            with open(EXISTING_1H_METRICS) as f:
                em = json.load(f)
            joblib.dump(pipe, hdir / "model.joblib")
            meta = {
                "horizon_hours": 1, "model_name": "HistGradientBoosting-config3",
                "model_version": "1.0.0", "status": "READY",
                "reused_from_existing": True,
                "feature_names": canonical_features or [],
                "feature_count": len(canonical_features or []),
                "training_period": "2015-01-01 to 2024-12-31",
                "validation_period": "2025-01-01 to 2025-12-31",
                "test_period": "2026-01-01 to 2026-09-30",
                "validation_metrics": em.get("validation_metrics", {}),
                "test_metrics": em.get("test_2026_metrics", {}),
                "persistence_baseline": em.get("persistence_baseline_2026", {}),
                "hyperparameters": em.get("selected_parameters", {}),
                "trained_at": datetime.utcnow().isoformat(),
                "notes": "Reused from validated final_experiments artifact.",
                "leakage_controls": em.get("leakage_controls", []),
            }
            with open(hdir / "metadata.json", "w") as f:
                json.dump(meta, f, indent=2)
            return meta
        except Exception as e:
            log.warning(f"Cannot reuse 1h model: {e}. Will retrain.")

    X_all, y_all = build_training_set(df, feat_matrix, h)

    if canonical_features:
        for mf in [f for f in canonical_features if f not in X_all.columns]:
            X_all[mf] = np.nan
        X_all = X_all[canonical_features]

    train_mask = X_all.index.year <= 2024
    val_mask = X_all.index.year == 2025
    test_mask = X_all.index.year == 2026
    X_tr, y_tr = X_all[train_mask], y_all[train_mask]
    X_v, y_v = X_all[val_mask], y_all[val_mask]
    X_te, y_te = X_all[test_mask], y_all[test_mask]
    log.info(f"Train:{len(X_tr):,} Val:{len(X_v):,} Test:{len(X_te):,}")

    if len(X_tr) < 100 or len(X_v) < 10:
        msg = f"Insufficient samples: train={len(X_tr)}, val={len(X_v)}"
        log.error(msg)
        return {"horizon_hours": h, "status": "NOT_READY", "reason": msg, "trained_at": datetime.utcnow().isoformat()}

    candidates = {
        "HistGB_config3": make_pipeline(HistGradientBoostingRegressor(
            max_iter=250, learning_rate=0.03, max_leaf_nodes=31,
            l2_regularization=3.0, min_samples_leaf=40, random_state=42)),
        "HistGB_config2": make_pipeline(HistGradientBoostingRegressor(
            max_iter=200, learning_rate=0.05, max_leaf_nodes=31,
            l2_regularization=2.0, min_samples_leaf=50, random_state=42)),
        "ExtraTrees": make_pipeline(ExtraTreesRegressor(
            n_estimators=100, max_features=0.7, min_samples_leaf=20, random_state=42, n_jobs=-1)),
    }

    val_scores = {}
    for name, pipe in candidates.items():
        log.info(f"  Fitting {name}...")
        pipe.fit(X_tr, y_tr)
        vp = pipe.predict(X_v)
        val_scores[name] = mean_absolute_error(y_v, vp)
        log.info(f"    Val MAE: {val_scores[name]:.3f}")

    best = min(val_scores, key=val_scores.get)
    log.info(f"Selected: {best} (Val MAE={val_scores[best]:.3f})")
    best_pipe = candidates[best]

    val_m = compute_metrics(y_v.values, best_pipe.predict(X_v))
    test_m, rm, pb = None, None, None
    if len(X_te) >= 20:
        tp = best_pipe.predict(X_te)
        test_m = compute_metrics(y_te.values, tp)
        rm = range_metrics(y_te.values, tp)
        pp = X_te["pm25_current"].values if "pm25_current" in X_te.columns else np.zeros(len(y_te))
        pb = compute_metrics(y_te.values, pp)
        log.info(f"Test: {test_m}")
        log.info(f"Persistence: {pb}")
        pd.DataFrame({
            "source_timestamp": X_te.index,
            "target_timestamp": X_te.index + pd.Timedelta(hours=h),
            "actual_pm25": y_te.values,
            "predicted_pm25": np.maximum(0.0, tp),
            "error": tp - y_te.values,
            "abs_error": np.abs(tp - y_te.values),
        }).to_csv(hdir / "test_predictions.csv", index=False)

    joblib.dump(best_pipe, hdir / "model.joblib")
    if h == 1:
        backup_1h = MODELS_DIR / "pm25_model_final_experiment_pre10yr.joblib"
        if EXISTING_1H_MODEL.exists() and not backup_1h.exists():
            import shutil
            shutil.copy2(EXISTING_1H_MODEL, backup_1h)
        joblib.dump(best_pipe, EXISTING_1H_MODEL)
        log.info(f"Updated primary 1h model artifact at {EXISTING_1H_MODEL}")

    feat_names = canonical_features or list(X_all.columns)
    tr_start = X_tr.index.min().strftime('%Y-%m-%d') if len(X_tr) > 0 else "N/A"
    tr_end = X_tr.index.max().strftime('%Y-%m-%d') if len(X_tr) > 0 else "N/A"
    val_start = X_v.index.min().strftime('%Y-%m-%d') if len(X_v) > 0 else "N/A"
    val_end = X_v.index.max().strftime('%Y-%m-%d') if len(X_v) > 0 else "N/A"
    te_start = X_te.index.min().strftime('%Y-%m-%d') if len(X_te) > 0 else "N/A"
    te_end = X_te.index.max().strftime('%Y-%m-%d') if len(X_te) > 0 else "N/A"

    meta = {
        "horizon_hours": h, "model_name": best, "model_version": "1.1.0", "status": "READY",
        "feature_names": feat_names, "feature_count": len(feat_names),
        "training_period": f"{tr_start} to {tr_end}",
        "validation_period": f"{val_start} to {val_end}",
        "test_period": f"{te_start} to {te_end}",
        "train_samples": int(len(X_tr)), "val_samples": int(len(X_v)), "test_samples": int(len(X_te)),
        "validation_metrics": val_m, "test_metrics": test_m,
        "persistence_baseline_test": pb, "range_metrics_test": rm,
        "all_candidate_val_mae": val_scores,
        "target_definition": f"PM2.5 at source_timestamp + {h}h (exact timestamp match)",
        "leakage_controls": [
            "Rolling features computed on shift(1) of PM2.5 - no current-hour leakage",
            "Target matched by exact ISO timestamp, not row offset",
            "Val set used for model selection; test set evaluated only after selection",
            "No future pollutant readings in feature set",
        ],
        "trained_at": datetime.utcnow().isoformat(),
    }
    with open(hdir / "metadata.json", "w") as f:
        json.dump(meta, f, indent=2, default=str)
    log.info(f"Saved model and metadata to {hdir}")
    return meta


def run():
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    RESEARCH_DIR.mkdir(parents=True, exist_ok=True)
    df = load_data()
    feat_matrix = build_feature_matrix(df)
    canonical = get_existing_1h_features()
    if canonical:
        log.info(f"Canonical features from 1h model: {len(canonical)}")
    else:
        log.warning("No canonical features from 1h model; will derive from data.")

    summary = {}
    for h in HORIZONS:
        summary[h] = train_horizon(df, feat_matrix, h, canonical)

    mhm = {
        "generated_at": datetime.utcnow().isoformat(),
        "dataset": {
            "total_rows": len(df),
            "date_range": {"start": str(df.Timestamp.min()), "end": str(df.Timestamp.max())},
        },
        "horizons": {
            str(h): {
                "status": summary[h].get("status", "UNKNOWN"),
                "model_name": summary[h].get("model_name"),
                "validation_metrics": summary[h].get("validation_metrics"),
                "test_metrics": summary[h].get("test_metrics"),
                "persistence_baseline_test": summary[h].get("persistence_baseline_test"),
            } for h in HORIZONS
        },
    }
    with open(RESEARCH_DIR / "multi_horizon_metrics.json", "w") as f:
        json.dump(mhm, f, indent=2, default=str)

    log.info("\n" + "="*60 + "\nSUMMARY\n" + "="*60)
    for h in HORIZONS:
        s = summary[h]
        val_mae = str(s.get('validation_metrics', {}).get('MAE', 'N/A'))
        test_mae = str(s.get('test_metrics', {}).get('MAE', 'N/A')) if s.get('test_metrics') else 'N/A'
        log.info(f"  {h:>2}h | {s.get('status','?'):<10} | {s.get('model_name','N/A'):<25} | Val MAE: {val_mae:<10} | Test MAE: {test_mae}")
    return summary


if __name__ == "__main__":
    run()
