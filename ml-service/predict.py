"""
Prediction engine for one-hour-ahead PM2.5 forecasting.
Encapsulates model loading, feature validation, and inference logic.
"""

from pathlib import Path
from typing import Dict, Any, Optional, List
import json
import numpy as np
import pandas as pd
import joblib

from feature_engineering import build_feature_row_from_history, FEATURE_NAMES

MODEL_PATH = Path(__file__).resolve().parent / "models" / "pm25_model_final_experiment.joblib"
METRICS_PATH = Path(__file__).resolve().parent.parent / "final_experiments" / "final_model_metrics.json"

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "processed" / "cpcb_anand_vihar_hourly.csv"

MODEL_IDENTIFIER = "HistGradientBoosting-config3"
MODEL_VERSION = "1.0.0"
FORECAST_HORIZON_MINUTES = 60


class PM25Predictor:
    def __init__(self, model_path: Path = MODEL_PATH):
        self.model_path = model_path
        self.model = None
        self.metrics = None
        self.feature_names = FEATURE_NAMES
        self.data_cache = None
        self.load_model()
        self.load_metrics()

    def load_model(self):
        if not self.model_path.exists():
            raise FileNotFoundError(f"Model file not found at: {self.model_path}")
        self.model = joblib.load(self.model_path)
        imputer = self.model.named_steps.get("imputer")
        if imputer is not None and hasattr(imputer, "feature_names_in_"):
            self.feature_names = list(imputer.feature_names_in_)

    def load_metrics(self):
        if METRICS_PATH.exists():
            try:
                with open(METRICS_PATH, "r", encoding="utf-8") as f:
                    self.metrics = json.load(f)
            except Exception:
                self.metrics = None

    def get_data(self) -> pd.DataFrame:
        if self.data_cache is None:
            if not DATA_PATH.exists():
                raise FileNotFoundError(f"Processed dataset not found at: {DATA_PATH}")
            df = pd.read_csv(DATA_PATH)
            df["Timestamp"] = pd.to_datetime(df["Timestamp"])
            self.data_cache = df.sort_values("Timestamp").drop_duplicates(subset=["Timestamp"], keep="last").reset_index(drop=True)
        return self.data_cache

    def predict_from_features(self, feature_df: pd.DataFrame) -> float:
        """Runs the scikit-learn pipeline on aligned feature dataframe."""
        if self.model is None:
            raise RuntimeError("Model is not loaded.")
        pred = self.model.predict(feature_df)
        return float(np.maximum(0.0, pred[0]))

    def predict_for_timestamp(
        self,
        origin_timestamp_str: str,
        horizon_minutes: int = 60
    ) -> Dict[str, Any]:
        """
        Generates forecast for origin_timestamp_str.
        Validates forecast horizon: 60 minutes is the validated ML model horizon.
        """
        origin_ts = pd.to_datetime(origin_timestamp_str)
        if origin_ts.tzinfo is not None:
            origin_ts = origin_ts.tz_convert("Asia/Kolkata").tz_localize(None)
        target_ts = origin_ts + pd.Timedelta(minutes=horizon_minutes)

        # Handle unsupported horizons cleanly per instructions
        if horizon_minutes != 60:
            return {
                "forecast_origin_timestamp": origin_ts.isoformat(),
                "target_timestamp": target_ts.isoformat(),
                "horizon_minutes": horizon_minutes,
                "predicted_pm25": None,
                "units": "µg/m³",
                "model_identifier": MODEL_IDENTIFIER,
                "model_version": MODEL_VERSION,
                "status": "unsupported_horizon",
                "is_interpolated": False,
                "message": (
                    f"ML model is trained and validated specifically for a 60-minute horizon. "
                    f"A dedicated model for {horizon_minutes}-minute horizon is not currently available."
                ),
            }

        df = self.get_data()
        feature_df = build_feature_row_from_history(df, origin_ts)
        predicted_value = self.predict_from_features(feature_df)

        # Check if actual target PM2.5 exists in dataset for validation
        actual_val = None
        error = None
        target_rows = df[df["Timestamp"] == target_ts]
        pm_col = [c for c in df.columns if "PM2.5" in str(c)][0]
        if not target_rows.empty:
            raw_target = target_rows.iloc[0][pm_col]
            if pd.notna(raw_target):
                actual_val = float(raw_target)
                error = float(predicted_value - actual_val)

        # Check source reading at origin
        origin_rows = df[df["Timestamp"] == origin_ts]
        source_pm25 = None
        if not origin_rows.empty:
            raw_origin = origin_rows.iloc[0][pm_col]
            if pd.notna(raw_origin):
                source_pm25 = float(raw_origin)

        # Extract summary of key input features for transparency
        summary_keys = ["pm25_current", "pm25_lag_1h", "pm25_lag_24h", "pm25_rolling_mean_24h", "hour", "day_of_week"]
        features_summary = {}
        for k in summary_keys:
            if k in feature_df.columns and pd.notna(feature_df[k].values[0]):
                features_summary[k] = round(float(feature_df[k].values[0]), 3)

        return {
            "forecast_origin_timestamp": origin_ts.isoformat(),
            "target_timestamp": target_ts.isoformat(),
            "horizon_minutes": horizon_minutes,
            "predicted_pm25": round(predicted_value, 2),
            "units": "µg/m³",
            "model_identifier": MODEL_IDENTIFIER,
            "model_version": MODEL_VERSION,
            "status": "success",
            "is_interpolated": False,
            "source_pm25_observed": round(source_pm25, 2) if source_pm25 is not None else None,
            "actual_pm25_observed": round(actual_val, 2) if actual_val is not None else None,
            "prediction_error": round(error, 2) if error is not None else None,
            "absolute_error": round(abs(error), 2) if error is not None else None,
            "features_summary": features_summary,
            "feature_count": len(self.feature_names),
        }


predictor = PM25Predictor()
