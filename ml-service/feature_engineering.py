"""
Feature engineering pipeline for one-hour-ahead PM2.5 forecasting.
Preserves the exact 55 features and transformations from the final experiment.
"""

from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import pandas as pd
import joblib

# Locate model to read exact trained feature names
MODEL_PATH = Path(__file__).resolve().parent / "models" / "pm25_model_final_experiment.joblib"
if not MODEL_PATH.exists():
    ALT_MODEL = Path(__file__).resolve().parent.parent / "models" / "pm25_model_final_experiment.joblib"
    if ALT_MODEL.exists():
        MODEL_PATH = ALT_MODEL

try:
    _loaded_pipeline = joblib.load(MODEL_PATH)
    FEATURE_NAMES: List[str] = list(_loaded_pipeline.named_steps["imputer"].feature_names_in_)
except Exception:
    FEATURE_NAMES: List[str] = []

LAG_STEPS = (1, 2, 3, 6, 12, 24, 48, 168)
ROLLING_WINDOWS = (3, 6, 12, 24, 48, 168)
CHANGE_STEPS = (1, 2, 3, 6, 12, 24)

RAW_POLLUTANT_COLS = [
    'PM10 (µg/m³)', 'NO (µg/m³)', 'NO2 (µg/m³)', 'NOx (ppb)', 'NH3 (µg/m³)',
    'SO2 (µg/m³)', 'CO (mg/m³)', 'Ozone (µg/m³)', 'Benzene (µg/m³)',
    'Toluene (µg/m³)', 'AT (°C)', 'RH (%)', 'WS (m/s)', 'WD (deg)',
    'SR (W/mt2)', 'BP (mmHg)'
]


def normalize_target_column(df: pd.DataFrame) -> Tuple[str, pd.DataFrame]:
    """Finds the PM2.5 column regardless of unicode character variations."""
    target_candidates = [c for c in df.columns if "PM2.5" in str(c) or "PM25" in str(c)]
    if not target_candidates:
        raise ValueError("Could not find PM2.5 column in dataframe.")
    return target_candidates[0], df


def build_feature_row_from_history(
    df: pd.DataFrame,
    origin_timestamp: pd.Timestamp
) -> pd.DataFrame:
    """
    Extracts the exact 55-feature vector for an origin timestamp t,
    using only data observed at or before t (no future data leakage).
    """
    if "Timestamp" not in df.columns:
        raise ValueError("Dataframe must have a 'Timestamp' column.")

    pm_col, _ = normalize_target_column(df)
    
    # Ensure datetime sort and clean index
    df_sorted = df.copy()
    df_sorted["Timestamp"] = pd.to_datetime(df_sorted["Timestamp"])
    if df_sorted["Timestamp"].dt.tz is not None:
        df_sorted["Timestamp"] = df_sorted["Timestamp"].dt.tz_localize(None)

    if origin_timestamp.tzinfo is not None:
        origin_timestamp = origin_timestamp.tz_convert("Asia/Kolkata").tz_localize(None)

    df_sorted = df_sorted.sort_values("Timestamp").drop_duplicates(subset=["Timestamp"], keep="last")
    
    # Filter up to origin_timestamp
    df_history = df_sorted[df_sorted["Timestamp"] <= origin_timestamp].copy()
    if df_history.empty:
        raise ValueError(f"No historical records found at or before {origin_timestamp}")

    origin_row = df_history[df_history["Timestamp"] == origin_timestamp]
    if origin_row.empty:
        # If exact timestamp not found, check if rounding to nearest hour matches
        rounded = origin_timestamp.round("h")
        if not df_history[df_history["Timestamp"] == rounded].empty:
            origin_timestamp = rounded
            origin_row = df_history[df_history["Timestamp"] == origin_timestamp]
        else:
            # Fall back to latest available historical observation
            latest_avail = df_history["Timestamp"].max()
            if pd.notna(latest_avail):
                origin_timestamp = latest_avail
                origin_row = df_history[df_history["Timestamp"] == origin_timestamp]
            else:
                raise ValueError(f"Origin timestamp {origin_timestamp} not found in historical records.")

    # We need sufficient history (up to 168 hours = 7 days)
    # Reindex on hourly frequency up to origin_timestamp to handle any missing hours safely
    min_needed = origin_timestamp - pd.Timedelta(hours=200)
    recent = df_history[df_history["Timestamp"] >= min_needed].copy()
    recent = recent.set_index("Timestamp").asfreq("1h")

    times = recent.index
    pm = recent[pm_col]

    # Calendar features at origin
    hour = origin_timestamp.hour
    dow = origin_timestamp.dayofweek
    dom = origin_timestamp.day
    month = origin_timestamp.month
    doy = origin_timestamp.dayofyear
    is_weekend = 1 if dow >= 5 else 0

    # Build features dictionary
    features: Dict[str, Any] = {}

    # 1. Raw pollutant & meteorological measurements at origin
    for col in FEATURE_NAMES:
        if col in recent.columns:
            val = recent.loc[origin_timestamp, col]
            features[col] = float(val) if pd.notna(val) else np.nan

    # 2. Calendar features
    features["hour"] = float(hour)
    features["day_of_week"] = float(dow)
    features["day_of_month"] = float(dom)
    features["month"] = float(month)
    features["day_of_year"] = float(doy)
    features["is_weekend"] = float(is_weekend)

    # 3. Current PM2.5
    curr_pm = recent.loc[origin_timestamp, pm_col]
    features["pm25_current"] = float(curr_pm) if pd.notna(curr_pm) else np.nan

    # 4. Lag features (pm shifted by lag hours)
    for lag in LAG_STEPS:
        lag_time = origin_timestamp - pd.Timedelta(hours=lag)
        if lag_time in recent.index:
            val = recent.loc[lag_time, pm_col]
            features[f"pm25_lag_{lag}h"] = float(val) if pd.notna(val) else np.nan
        else:
            features[f"pm25_lag_{lag}h"] = np.nan

    # 5. Rolling features (calculated on prior shifted series: pm.shift(1))
    # For a rolling window at origin_timestamp, prior series ends at origin_timestamp - 1h
    prior_series = pm[pm.index < origin_timestamp]
    for window in ROLLING_WINDOWS:
        sub = prior_series.iloc[-window:] if len(prior_series) >= 1 else pd.Series(dtype=float)
        min_p = max(2, window // 3)
        valid_cnt = sub.count()
        if valid_cnt >= min_p:
            features[f"pm25_rolling_mean_{window}h"] = float(sub.mean())
            features[f"pm25_rolling_std_{window}h"] = float(sub.std())
        else:
            features[f"pm25_rolling_mean_{window}h"] = np.nan
            features[f"pm25_rolling_std_{window}h"] = np.nan

    # 6. Change features: pm - pm.shift(lag)
    for lag in CHANGE_STEPS:
        lag_time = origin_timestamp - pd.Timedelta(hours=lag)
        if pd.notna(curr_pm) and lag_time in recent.index and pd.notna(recent.loc[lag_time, pm_col]):
            features[f"pm25_change_{lag}h"] = float(curr_pm - recent.loc[lag_time, pm_col])
        else:
            features[f"pm25_change_{lag}h"] = np.nan

    # 7. Cyclical features
    features["hour_sin"] = float(np.sin(2 * np.pi * hour / 24))
    features["hour_cos"] = float(np.cos(2 * np.pi * hour / 24))
    features["dow_sin"] = float(np.sin(2 * np.pi * dow / 7))
    features["dow_cos"] = float(np.cos(2 * np.pi * dow / 7))
    features["doy_sin"] = float(np.sin(2 * np.pi * doy / 365.25))
    features["doy_cos"] = float(np.cos(2 * np.pi * doy / 365.25))

    # Construct single-row DataFrame aligned with FEATURE_NAMES
    feature_df = pd.DataFrame([features])
    
    # Ensure exact column presence and ordering
    if FEATURE_NAMES:
        # Match any column name encoding variations
        ordered_data = {}
        for target_name in FEATURE_NAMES:
            if target_name in feature_df.columns:
                ordered_data[target_name] = feature_df[target_name].values[0]
            else:
                # Attempt to find by stripped ASCII prefix/suffix
                matched = False
                for c in feature_df.columns:
                    if c.split("(")[0].strip() == target_name.split("(")[0].strip():
                        ordered_data[target_name] = feature_df[c].values[0]
                        matched = True
                        break
                if not matched:
                    ordered_data[target_name] = np.nan
        feature_df = pd.DataFrame([ordered_data])

    return feature_df


def build_live_feature_row(
    origin_timestamp: pd.Timestamp,
    current_pm: Optional[float] = None
) -> Tuple[pd.DataFrame, float]:
    """
    Constructs a valid 55-feature vector for live/real-time forecasting when
    origin_timestamp is at present time or beyond historical data.
    Uses current_pm if provided, or calculates an Anand Vihar seasonal/diurnal baseline.
    Returns (feature_df, pm_used).
    """
    if origin_timestamp.tzinfo is not None:
        origin_timestamp = origin_timestamp.tz_convert("Asia/Kolkata").tz_localize(None)

    hour = int(origin_timestamp.hour)
    dow = int(origin_timestamp.dayofweek)
    dom = int(origin_timestamp.day)
    month = int(origin_timestamp.month)
    doy = int(origin_timestamp.dayofyear)
    is_weekend = 1.0 if dow >= 5 else 0.0

    if current_pm is not None and not np.isnan(current_pm) and current_pm > 0:
        base_pm = float(current_pm)
    else:
        # Anand Vihar seasonal factor (Delhi winter peaks, monsoon dips)
        seasonal_mult = 1.0
        if month in (11, 12, 1):
            seasonal_mult = 1.65
        elif month in (10, 2):
            seasonal_mult = 1.25
        elif month in (3, 4, 5):
            seasonal_mult = 1.10
        elif month in (7, 8, 9):
            seasonal_mult = 0.55

        # Diurnal factor
        if hour >= 20 or hour <= 2:
            diurnal_mult = 1.35
        elif 3 <= hour <= 6:
            diurnal_mult = 1.20
        elif 7 <= hour <= 10:
            diurnal_mult = 1.15
        elif 12 <= hour <= 16:
            diurnal_mult = 0.85
        else:
            diurnal_mult = 1.05

        base_pm = round(max(25.0, 105.0 * seasonal_mult * diurnal_mult), 1)

    features: Dict[str, Any] = {}
    for col in FEATURE_NAMES:
        features[col] = np.nan

    # Calendar features
    features["hour"] = float(hour)
    features["day_of_week"] = float(dow)
    features["day_of_month"] = float(dom)
    features["month"] = float(month)
    features["day_of_year"] = float(doy)
    features["is_weekend"] = is_weekend

    # Current PM2.5
    features["pm25_current"] = float(base_pm)

    # Lags (realistic persistence with slight diurnal modulation)
    curr_hour_factor = 0.85 if 12 <= hour <= 16 else (1.3 if hour >= 20 or hour <= 2 else 1.05)
    for lag in LAG_STEPS:
        lag_hour = (hour - lag) % 24
        hour_factor = 0.85 if 12 <= lag_hour <= 16 else (1.3 if lag_hour >= 20 or lag_hour <= 2 else 1.05)
        ratio = hour_factor / max(0.5, curr_hour_factor)
        features[f"pm25_lag_{lag}h"] = round(float(base_pm * ratio), 2)

    # Rolling statistics
    for w in ROLLING_WINDOWS:
        features[f"pm25_rolling_mean_{w}h"] = round(float(base_pm * 1.02), 2)
        features[f"pm25_rolling_std_{w}h"] = round(float(max(6.0, base_pm * 0.12)), 2)

    # Change features
    for ch in CHANGE_STEPS:
        lag_val = features.get(f"pm25_lag_{ch}h", base_pm)
        features[f"pm25_change_{ch}h"] = round(float(base_pm - lag_val), 2)

    # Cyclical features
    features["hour_sin"] = float(np.sin(2 * np.pi * hour / 24.0))
    features["hour_cos"] = float(np.cos(2 * np.pi * hour / 24.0))
    features["dow_sin"] = float(np.sin(2 * np.pi * dow / 7.0))
    features["dow_cos"] = float(np.cos(2 * np.pi * dow / 7.0))
    features["doy_sin"] = float(np.sin(2 * np.pi * doy / 365.25))
    features["doy_cos"] = float(np.cos(2 * np.pi * doy / 365.25))

    feature_df = pd.DataFrame([features])
    if FEATURE_NAMES:
        for col in FEATURE_NAMES:
            if col not in feature_df.columns:
                feature_df[col] = np.nan
        feature_df = feature_df[FEATURE_NAMES]

    return feature_df, base_pm

