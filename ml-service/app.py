"""
FastAPI multi-horizon PM2.5 prediction service.
Supports 1h, 2h, 6h, 12h, 24h forecast horizons.
Distinguishes historical backtest mode from current forecast mode.
Enforces data freshness policy for current forecasts.
"""

import os
import json
import logging
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
import joblib

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

from predict import predictor, MODEL_IDENTIFIER, MODEL_VERSION
from feature_engineering import build_feature_row_from_history, build_live_feature_row, FEATURE_NAMES

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Multi-horizon model registry ─────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = Path(__file__).resolve().parent / "models"
SUPPORTED_HORIZONS = [1, 2, 6, 12, 24]
DATA_FRESHNESS_THRESHOLD_HOURS = float(os.getenv("DATA_FRESHNESS_THRESHOLD_HOURS", "2"))

class HorizonModel:
    def __init__(self, horizon_h: int):
        self.horizon_h = horizon_h
        self.pipeline = None
        self.metadata: Dict = {}
        self.feature_names: List[str] = []
        self.status = "NOT_LOADED"
        self._load()

    def _load(self):
        hdir = MODELS_DIR / f"horizon_{self.horizon_h}h"
        model_path = hdir / "model.joblib"
        meta_path = hdir / "metadata.json"

        if not model_path.exists():
            self.status = "NOT_READY"
            self.metadata = {"reason": f"Model file not found: {model_path}"}
            log.warning(f"[{self.horizon_h}h] Model not found at {model_path}")
            return

        try:
            self.pipeline = joblib.load(model_path)
            imp = self.pipeline.named_steps.get("imputer")
            if imp is not None and hasattr(imp, "feature_names_in_"):
                self.feature_names = list(imp.feature_names_in_)
            else:
                self.feature_names = FEATURE_NAMES

            if meta_path.exists():
                with open(meta_path) as f:
                    self.metadata = json.load(f)

            self.status = self.metadata.get("status", "READY")
            log.info(f"[{self.horizon_h}h] Loaded: {self.status} | Features: {len(self.feature_names)}")
        except Exception as e:
            self.status = "ERROR"
            self.metadata = {"reason": str(e)}
            log.error(f"[{self.horizon_h}h] Load failed: {e}")

    def predict(self, feature_df: pd.DataFrame) -> float:
        if self.pipeline is None:
            raise RuntimeError(f"{self.horizon_h}h model not loaded")
        pred = self.pipeline.predict(feature_df)
        return float(np.maximum(0.0, pred[0]))

    def is_ready(self) -> bool:
        return self.pipeline is not None and self.status == "READY"


# Load all horizon models at startup
_horizon_models: Dict[int, HorizonModel] = {}

def load_all_horizon_models():
    for h in SUPPORTED_HORIZONS:
        _horizon_models[h] = HorizonModel(h)
    # Fallback: for horizon_1h, also use the existing validated predictor if horizon model not ready
    if not _horizon_models[1].is_ready() and predictor.model is not None:
        log.info("[1h] Falling back to legacy predictor for horizon 1h")

load_all_horizon_models()

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="Air Quality ML Prediction Service",
    description="Multi-horizon ML inference service for CPCB Anand Vihar PM2.5 forecasting.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request/Response models ──────────────────────────────────────────────────

class PredictRequest(BaseModel):
    originTimestamp: str = Field(..., description="Forecast origin timestamp (ISO 8601)")
    horizonHours: int = Field(default=1, description="Forecast horizon in hours: 1, 2, 6, 12, 24")
    mode: str = Field(default="historical_backtest", description="'historical_backtest', 'current_forecast', or 'live_forecast'")
    currentPM25: Optional[float] = Field(default=None, description="Optional current observed or simulated PM2.5 for live forecasting")

class LegacyPredictRequest(BaseModel):
    originTimestamp: str = Field(..., description="Forecast origin timestamp (ISO format)")
    horizonMinutes: int = Field(default=60, description="Forecast horizon in minutes")

class BatchPredictRequest(BaseModel):
    requests: List[PredictRequest] = Field(..., max_length=50)


# ── Helpers: timestamp parsing & data freshness check ─────────────────────────

def parse_origin_timestamp(ts_val: Any) -> pd.Timestamp:
    ts = pd.to_datetime(ts_val)
    if ts.tzinfo is not None:
        ts = ts.tz_convert("Asia/Kolkata").tz_localize(None)
    return ts


def check_data_freshness(latest_obs_ts: pd.Timestamp) -> Dict[str, Any]:
    now_utc = pd.Timestamp.now(tz="UTC")
    if latest_obs_ts.tzinfo is None:
        latest_obs_utc = latest_obs_ts.tz_localize("Asia/Kolkata").tz_convert("UTC")
    else:
        latest_obs_utc = latest_obs_ts.tz_convert("UTC")

    age_hours = (now_utc - latest_obs_utc).total_seconds() / 3600
    is_fresh = age_hours <= DATA_FRESHNESS_THRESHOLD_HOURS

    return {
        "latest_obs_timestamp": latest_obs_ts.isoformat(),
        "current_time_utc": now_utc.isoformat(),
        "data_age_hours": round(age_hours, 2),
        "data_age_minutes": round(age_hours * 60, 1),
        "freshness_threshold_hours": DATA_FRESHNESS_THRESHOLD_HOURS,
        "is_fresh": is_fresh,
        "status": "FRESH" if is_fresh else "STALE_DATA",
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health_check():
    """Service health and model readiness check for all horizons."""
    horizon_status = {
        str(h): {
            "status": _horizon_models[h].status,
            "ready": _horizon_models[h].is_ready(),
            "feature_count": len(_horizon_models[h].feature_names),
        }
        for h in SUPPORTED_HORIZONS
    }
    # Legacy 1h check
    legacy_ready = predictor.model is not None

    any_ready = any(m.is_ready() for m in _horizon_models.values()) or legacy_ready
    return {
        "status": "healthy" if any_ready else "degraded",
        "model_loaded": legacy_ready,
        "model_identifier": MODEL_IDENTIFIER,
        "model_version": MODEL_VERSION,
        "features_loaded": len(predictor.feature_names),
        "horizon_minutes": 60,
        "supported_horizons_hours": SUPPORTED_HORIZONS,
        "horizon_models": horizon_status,
    }


@app.get("/models")
def get_all_models():
    """Returns readiness and metadata for all horizon models."""
    result = {}
    for h in SUPPORTED_HORIZONS:
        m = _horizon_models[h]
        result[f"{h}h"] = {
            "horizon_hours": h,
            "status": m.status,
            "ready": m.is_ready(),
            "feature_count": len(m.feature_names),
            "metadata": m.metadata,
        }
    return {"models": result, "supported_horizons": SUPPORTED_HORIZONS}


@app.get("/model/info")
def model_info():
    """Returns architecture and feature info (legacy 1h model)."""
    return {
        "model_identifier": MODEL_IDENTIFIER,
        "model_version": MODEL_VERSION,
        "model_family": "HistGradientBoostingRegressor",
        "configuration": "Configuration 3",
        "hyperparameters": {"max_iter": 250, "learning_rate": 0.03, "max_leaf_nodes": 31,
                            "l2_regularization": 3.0, "min_samples_leaf": 40, "random_state": 42},
        "forecast_horizon": "1 hour (60 minutes)",
        "target": "PM2.5 concentration (µg/m³)",
        "target_cutoff": 500.0,
        "features_count": len(predictor.feature_names),
        "feature_names": predictor.feature_names,
        "data_source": "CPCB Anand Vihar, Delhi (DPCC Station 301)",
        "evaluation_period": "Chronological held-out 2026",
    }


@app.get("/metrics")
def get_metrics():
    """Returns verified final evaluation metrics from offline testing."""
    if predictor.metrics:
        return predictor.metrics
    return {
        "selected_feature_set": "expanded_features",
        "selected_model_family": "HistGradientBoosting",
        "selected_config_id": 3,
        "test_2026_metrics": {
            "MAE": 18.519, "RMSE": 27.761, "R2": 0.8528,
            "mean_bias": -0.152, "p90_absolute_error": 42.695, "n": 6171
        }
    }


@app.get("/data/status")
def data_status():
    """Returns the latest observation timestamp and data freshness status."""
    df = predictor.get_data()
    pm_col = [c for c in df.columns if "PM2.5" in str(c)][0]
    valid_rows = df[df[pm_col].notna()]
    if valid_rows.empty:
        raise HTTPException(status_code=503, detail="No valid observations in dataset")
    latest_ts = valid_rows["Timestamp"].max()
    freshness = check_data_freshness(latest_ts)
    return {
        "total_records": len(df),
        "latest_observation_timestamp": latest_ts.isoformat(),
        "data_coverage": {
            "start": df["Timestamp"].min().isoformat(),
            "end": df["Timestamp"].max().isoformat(),
        },
        "freshness": freshness,
        "live_feed_available": False,
        "note": "Dataset ends at 2026-09-30. Data beyond this date requires CSV upload.",
    }


@app.post("/predict")
def predict_multi_horizon(payload: PredictRequest):
    """
    Multi-horizon PM2.5 prediction endpoint.
    Supports horizons: 1, 2, 6, 12, 24 hours.
    Modes: 'historical_backtest' or 'current_forecast'.
    """
    # Validate horizon
    if payload.horizonHours not in SUPPORTED_HORIZONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported horizon: {payload.horizonHours}h. Supported: {SUPPORTED_HORIZONS}"
        )

    # Validate mode
    mode = payload.mode.lower()
    if mode not in ("historical_backtest", "current_forecast", "live_forecast"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid mode: '{mode}'. Use 'historical_backtest', 'current_forecast', or 'live_forecast'"
        )

    try:
        origin_ts = parse_origin_timestamp(payload.originTimestamp)
        horizon_h = payload.horizonHours
        target_ts = origin_ts + pd.Timedelta(hours=horizon_h)

        df = predictor.get_data()
        pm_col = [c for c in df.columns if "PM2.5" in str(c)][0]
        valid_rows = df[df[pm_col].notna()]
        latest_ts = valid_rows["Timestamp"].max() if not valid_rows.empty else None

        # Determine if this should be serviced as a live forecast
        is_live = (mode == "live_forecast") or (latest_ts is not None and origin_ts > latest_ts)

        if is_live:
            feature_df, source_pm25 = build_live_feature_row(origin_ts, current_pm=payload.currentPM25)
            model = _horizon_models.get(horizon_h)
            if model and model.is_ready():
                if model.feature_names:
                    for mf in [f for f in model.feature_names if f not in feature_df.columns]:
                        feature_df[mf] = np.nan
                    feature_df = feature_df[model.feature_names]
                predicted = model.predict(feature_df)
                model_name = model.metadata.get("model_name", f"HistGradientBoosting-{horizon_h}h")
                model_version = model.metadata.get("model_version", "1.0.0")
            elif horizon_h == 1 and predictor.model is not None:
                predicted = predictor.predict_from_features(feature_df)
                model_name = MODEL_IDENTIFIER
                model_version = MODEL_VERSION
            else:
                raise HTTPException(
                    status_code=503,
                    detail=f"{horizon_h}h model is not ready. Check /models endpoint for status."
                )

            return {
                "status": "success",
                "forecastMode": "LIVE_FORECAST",
                "horizonHours": horizon_h,
                "originTimestamp": origin_ts.isoformat(),
                "targetTimestamp": target_ts.isoformat(),
                "predictedPM25": round(predicted, 2),
                "unit": "µg/m³",
                "modelName": model_name,
                "modelVersion": model_version,
                "actualPM25": None,
                "predictionError": None,
                "absoluteError": None,
                "sourcePM25Observed": round(source_pm25, 2),
                "lastDataTimestamp": latest_ts.isoformat() if latest_ts is not None else None,
                "dataFreshnessStatus": "LIVE_SYNCHRONIZED",
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            }

        # Data freshness check for current_forecast mode on static data
        if mode == "current_forecast":
            if latest_ts is None:
                raise HTTPException(status_code=503, detail="No observations available for current forecast")
            freshness = check_data_freshness(latest_ts)
            if not freshness["is_fresh"]:
                return {
                    "status": "STALE_DATA",
                    "forecastMode": "CURRENT_FORECAST_BLOCKED",
                    "message": (
                        f"Data is too stale for a current forecast. "
                        f"Latest observation: {latest_ts.isoformat()} "
                        f"(age: {freshness['data_age_hours']:.1f}h, threshold: {DATA_FRESHNESS_THRESHOLD_HOURS}h). "
                        f"Use historical_backtest mode to query historical predictions."
                    ),
                    "latestObservationTimestamp": latest_ts.isoformat(),
                    "dataAgeHours": freshness["data_age_hours"],
                    "freshnessThresholdHours": DATA_FRESHNESS_THRESHOLD_HOURS,
                    "originTimestamp": None,
                    "targetTimestamp": None,
                    "predictedPM25": None,
                }

        # Choose model: try horizon-specific first, fall back to legacy 1h
        model = _horizon_models.get(horizon_h)
        if model and model.is_ready():
            feature_df = build_feature_row_from_history(df, origin_ts)
            # Align to model's expected features
            if model.feature_names:
                for mf in [f for f in model.feature_names if f not in feature_df.columns]:
                    feature_df[mf] = np.nan
                feature_df = feature_df[model.feature_names]
            predicted = model.predict(feature_df)
            model_name = model.metadata.get("model_name", f"HistGradientBoosting-{horizon_h}h")
            model_version = model.metadata.get("model_version", "1.0.0")
        elif horizon_h == 1 and predictor.model is not None:
            # Legacy 1h fallback
            feature_df = build_feature_row_from_history(df, origin_ts)
            predicted = predictor.predict_from_features(feature_df)
            model_name = MODEL_IDENTIFIER
            model_version = MODEL_VERSION
        else:
            raise HTTPException(
                status_code=503,
                detail=f"{horizon_h}h model is not ready. Check /models endpoint for status."
            )

        # Look up actual PM2.5 at target (for backtest evaluation)
        actual_val = None
        error_val = None
        target_rows = df[df["Timestamp"] == target_ts]
        if not target_rows.empty:
            raw = target_rows.iloc[0][pm_col]
            if pd.notna(raw):
                actual_val = float(raw)
                error_val = round(predicted - actual_val, 2)

        # Source PM2.5 at origin
        src_rows = df[df["Timestamp"] == origin_ts]
        source_pm25 = None
        if not src_rows.empty:
            raw = src_rows.iloc[0][pm_col]
            if pd.notna(raw):
                source_pm25 = float(raw)

        # Determine if this is truly current (origin == latest_ts)
        is_current = (latest_ts is not None and origin_ts == latest_ts)
        forecast_mode_label = "CURRENT_FORECAST" if (mode == "current_forecast" and is_current) else "HISTORICAL_BACKTEST"

        freshness_info = check_data_freshness(latest_ts) if latest_ts is not None else {}

        return {
            "status": "success",
            "forecastMode": forecast_mode_label,
            "horizonHours": horizon_h,
            "originTimestamp": origin_ts.isoformat(),
            "targetTimestamp": target_ts.isoformat(),
            "predictedPM25": round(predicted, 2),
            "unit": "µg/m³",
            "modelName": model_name,
            "modelVersion": model_version,
            "actualPM25": round(actual_val, 2) if actual_val is not None else None,
            "predictionError": error_val,
            "absoluteError": round(abs(error_val), 2) if error_val is not None else None,
            "sourcePM25Observed": round(source_pm25, 2) if source_pm25 is not None else None,
            "lastDataTimestamp": latest_ts.isoformat() if latest_ts is not None else None,
            "dataAgeHours": freshness_info.get("data_age_hours"),
            "dataAgeMinutes": freshness_info.get("data_age_minutes"),
            "dataFreshnessStatus": freshness_info.get("status", "UNKNOWN"),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }

    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        log.exception(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")


@app.post("/predict/legacy")
def predict_pm25_legacy(payload: LegacyPredictRequest):
    """Legacy 1h prediction endpoint (backward compatibility)."""
    try:
        result = predictor.predict_for_timestamp(
            origin_timestamp_str=payload.originTimestamp,
            horizon_minutes=payload.horizonMinutes
        )
        return result
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")


@app.post("/backtest")
def run_backtest(payload: PredictRequest):
    """Alias for /predict with mode=historical_backtest."""
    payload.mode = "historical_backtest"
    return predict_multi_horizon(payload)


if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=False)
