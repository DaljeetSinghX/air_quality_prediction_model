import axios from "axios";
import { config } from "../config/env.js";

const client = axios.create({
  baseURL: config.mlServiceUrl,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

export const SUPPORTED_HORIZONS_HOURS = [1, 2, 6, 12, 24];

export interface PredictionPayload {
  originTimestamp: string;
  horizonHours?: number;
  horizonMinutes?: number;
  mode?: "historical_backtest" | "current_forecast" | "live_forecast";
  currentPM25?: number;
}

export interface MultiHorizonPredictionResult {
  status: string;
  forecastMode: string;
  horizonHours: number;
  originTimestamp: string;
  targetTimestamp: string;
  predictedPM25: number | null;
  unit: string;
  modelName: string;
  modelVersion: string;
  actualPM25?: number | null;
  predictionError?: number | null;
  absoluteError?: number | null;
  sourcePM25Observed?: number | null;
  lastDataTimestamp?: string | null;
  dataAgeHours?: number | null;
  dataAgeMinutes?: number | null;
  dataFreshnessStatus?: string;
  generatedAt?: string;
  message?: string;
  latestObservationTimestamp?: string;
  freshnessThresholdHours?: number;
}

export interface PredictionResult {
  forecast_origin_timestamp: string;
  target_timestamp: string;
  horizon_minutes: number;
  predicted_pm25: number | null;
  units: string;
  model_identifier: string;
  model_version: string;
  status: string;
  is_interpolated: boolean;
  source_pm25_observed?: number | null;
  actual_pm25_observed?: number | null;
  prediction_error?: number | null;
  absolute_error?: number | null;
  features_summary?: Record<string, any>;
  feature_count?: number;
  message?: string;
}

export class MLClient {
  static async checkHealth() {
    try {
      const res = await client.get("/health");
      return res.data;
    } catch (err: any) {
      return { status: "down", model_loaded: false, error: err.message };
    }
  }

  static async getModelInfo() {
    try {
      const res = await client.get("/model/info");
      return res.data;
    } catch (err: any) {
      throw new Error(`Failed to fetch model info: ${err.message}`);
    }
  }

  static async getMetrics() {
    try {
      const res = await client.get("/metrics");
      return res.data;
    } catch (err: any) {
      throw new Error(`Failed to fetch metrics: ${err.message}`);
    }
  }

  static async getHorizonModels() {
    try {
      const res = await client.get("/models");
      return res.data;
    } catch (err: any) {
      throw new Error(`Failed to fetch horizon models: ${err.message}`);
    }
  }

  static async getDataStatus() {
    try {
      const res = await client.get("/data/status");
      return res.data;
    } catch (err: any) {
      throw new Error(`Failed to fetch data status: ${err.message}`);
    }
  }

  static async predictMultiHorizon(
    payload: PredictionPayload
  ): Promise<MultiHorizonPredictionResult> {
    const horizonHours =
      payload.horizonHours ?? Math.round((payload.horizonMinutes ?? 60) / 60);
    try {
      const res = await client.post("/predict", {
        originTimestamp: payload.originTimestamp,
        horizonHours,
        mode: payload.mode ?? "historical_backtest",
        currentPM25: payload.currentPM25,
      });
      return res.data;
    } catch (err: any) {
      if (err.response?.data?.detail) {
        throw new Error(err.response.data.detail);
      }
      throw new Error(`ML Service prediction failed: ${err.message}`);
    }
  }

  static async predict(payload: PredictionPayload): Promise<PredictionResult> {
    try {
      const res = await client.post("/predict/legacy", {
        originTimestamp: payload.originTimestamp,
        horizonMinutes: payload.horizonMinutes ?? 60,
      });
      return res.data;
    } catch (err: any) {
      if (err.response?.data?.detail) {
        throw new Error(err.response.data.detail);
      }
      throw new Error(`ML Service prediction request failed: ${err.message}`);
    }
  }
}
