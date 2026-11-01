"""
Preprocesses all 12 years (2015-2026) of hourly CPCB Anand Vihar raw data,
cleans, verifies, and updates data/processed/cpcb_anand_vihar_hourly.csv.
"""

import os
import glob
import shutil
from pathlib import Path
import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW_1HR_DIR = ROOT / "data" / "raw" / "1hr_Data"
PROCESSED_DIR = ROOT / "data" / "processed"
TARGET_FILE = PROCESSED_DIR / "cpcb_anand_vihar_hourly.csv"
BACKUP_FILE = PROCESSED_DIR / "cpcb_anand_vihar_hourly_backup_2022_2026.csv"
MODEL_DATA_FILE = PROCESSED_DIR / "cpcb_pm25_model_data.csv"

# Columns to drop if present (sparse or zero measurement)
DROP_COLS = [
    'Xylene (µg/m³)', 'O Xylene (µg/m³)', 'Eth-Benzene (µg/m³)',
    'MP-Xylene (µg/m³)', 'RF (mm)', 'VWS (m/s)',
]

def main():
    print("=== Step 1: Locating and reading all 12 raw 1hr CSV files ===")
    files = sorted(glob.glob(str(RAW_1HR_DIR / "Raw_Data_*_1Hr.csv")))
    print(f"Found {len(files)} files in {RAW_1HR_DIR}")
    assert len(files) == 12, f"Expected 12 files, found {len(files)}"

    dfs = []
    for fpath in files:
        fname = os.path.basename(fpath)
        print(f"Reading {fname}...")
        df_part = pd.read_csv(fpath, low_memory=False)
        df_part["source_file"] = fname
        dfs.append(df_part)

    df_all = pd.concat(dfs, ignore_index=True)
    print(f"Total raw concatenated rows: {len(df_all):,}")

    # Standardize Timestamp
    print("Standardizing Timestamps...")
    df_all["Timestamp"] = pd.to_datetime(df_all["Timestamp"], errors="coerce")
    invalid_dates = df_all["Timestamp"].isna().sum()
    if invalid_dates > 0:
        print(f"Dropping {invalid_dates} rows with invalid dates")
        df_all = df_all.dropna(subset=["Timestamp"])

    # Sort and remove duplicates
    df_all = df_all.sort_values("Timestamp").drop_duplicates(subset=["Timestamp"], keep="last").reset_index(drop=True)
    print(f"Rows after de-duplication: {len(df_all):,}")
    print(f"Date range: {df_all['Timestamp'].min()} to {df_all['Timestamp'].max()}")

    # Drop sparse / unneeded sensor columns
    for c in DROP_COLS:
        if c in df_all.columns:
            df_all = df_all.drop(columns=[c])

    # Find PM2.5 column
    pm_cols = [c for c in df_all.columns if "PM2.5" in str(c) or "PM25" in str(c)]
    if not pm_cols:
        raise ValueError("Could not find PM2.5 column!")
    pm_col = pm_cols[0]
    print(f"PM2.5 column identified as: {pm_col}")

    # Coerce numeric values
    measurement_cols = [c for c in df_all.columns if c not in ["Timestamp", "source_file"]]
    for col in measurement_cols:
        df_all[col] = pd.to_numeric(df_all[col], errors="coerce")

    # Generate calendar columns
    ts = df_all["Timestamp"]
    df_all["hour"] = ts.dt.hour
    df_all["day_of_week"] = ts.dt.dayofweek
    df_all["day_of_month"] = ts.dt.day
    df_all["month"] = ts.dt.month
    df_all["day_of_year"] = ts.dt.dayofyear
    df_all["is_weekend"] = (ts.dt.dayofweek >= 5).astype(int)

    # Generate PM2.5 quality flags
    pm_vals = df_all[pm_col]
    df_all["pm25_negative_flag"] = (pm_vals < 0).fillna(False)
    df_all["pm25_over_500_flag"] = (pm_vals > 500).fillna(False)
    df_all["pm25_over_1000_flag"] = (pm_vals > 1000).fillna(False)

    # Reorder columns to exactly match previous format
    expected_col_order = [
        'Timestamp', pm_col, 'PM10 (µg/m³)', 'NO (µg/m³)', 'NO2 (µg/m³)',
        'NOx (ppb)', 'NH3 (µg/m³)', 'SO2 (µg/m³)', 'CO (mg/m³)', 'Ozone (µg/m³)',
        'Benzene (µg/m³)', 'Toluene (µg/m³)', 'AT (°C)', 'RH (%)', 'WS (m/s)',
        'WD (deg)', 'TOT-RF (mm)', 'SR (W/mt2)', 'BP (mmHg)', 'source_file',
        'hour', 'day_of_week', 'day_of_month', 'month', 'day_of_year',
        'is_weekend', 'pm25_negative_flag', 'pm25_over_500_flag', 'pm25_over_1000_flag'
    ]

    # Include any existing cols not in list if any, but maintain order
    final_cols = [c for c in expected_col_order if c in df_all.columns]
    for c in df_all.columns:
        if c not in final_cols:
            final_cols.append(c)
    df_all = df_all[final_cols]

    print("\n=== Dataset Statistics ===")
    print(f"Total rows: {len(df_all):,}")
    print(f"Total valid PM2.5 readings: {df_all[pm_col].notna().sum():,}")
    print(f"Missing PM2.5 readings: {df_all[pm_col].isna().sum():,}")
    print(f"Negative PM2.5 flags: {df_all['pm25_negative_flag'].sum():,}")
    print(f"PM2.5 > 500 flags: {df_all['pm25_over_500_flag'].sum():,}")
    print(f"PM2.5 > 1000 flags: {df_all['pm25_over_1000_flag'].sum():,}")

    # Backup old file if not backed up
    if TARGET_FILE.exists() and not BACKUP_FILE.exists():
        print(f"Creating backup of existing dataset: {BACKUP_FILE}")
        shutil.copy2(TARGET_FILE, BACKUP_FILE)

    # Save processed files
    print(f"Saving merged dataset to {TARGET_FILE}...")
    df_all.to_csv(TARGET_FILE, index=False)
    print(f"Saving copy to {MODEL_DATA_FILE}...")
    df_all.to_csv(MODEL_DATA_FILE, index=False)

    print("\nData preprocessing complete successfully!")

if __name__ == "__main__":
    main()
