import axios from "axios";
import {
  DashboardSummary,
  Observation,
  PredictionRecord,
  ModelMetricsResponse,
  DatasetMeta,
  MultiHorizonResult,
  HorizonModelStatus,
  DataFreshnessStatus,
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

export const ApiService = {
  // Health
  async getHealth() {
    const res = await api.get("/health");
    return res.data;
  },

  // Dashboard summary
  async getDashboardSummary(): Promise<DashboardSummary> {
    const res = await api.get("/dashboard/summary");
    return res.data.data;
  },

  // Observations
  async getObservations(params?: {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }) {
    const res = await api.get("/observations", { params });
    return res.data;
  },

  async getObservationRange(params: {
    startDate?: string;
    endDate?: string;
    interval?: number;
    interpolate?: boolean;
    limit?: number;
  }): Promise<{
    intervalMinutes: number;
    isInterpolatedVisualization: boolean;
    dataPointsCount: number;
    data: Observation[];
  }> {
    const res = await api.get("/observations/range", { params });
    return res.data;
  },

  // Predictions
  async createMultiHorizonPrediction(payload: {
    originTimestamp: string;
    horizonHours: number;
    mode?: string;
    predictedPM25?: number;
    currentPM25?: number;
    modelName?: string;
  }): Promise<{ success: boolean; staleData?: boolean; storedInMySQL?: boolean; data: any }> {
    const res = await api.post("/predictions", payload);
    return res.data;
  },

  async createPrediction(payload: {
    originTimestamp: string;
    horizonMinutes?: number;
  }): Promise<PredictionRecord> {
    const res = await api.post("/predictions", payload);
    return res.data.data;
  },

  async getPredictions(params?: {
    page?: number;
    limit?: number;
    status?: string;
    horizon?: number;
  }) {
    const res = await api.get("/predictions", { params });
    return res.data;
  },

  async getPredictionById(id: string): Promise<PredictionRecord> {
    const res = await api.get(`/predictions/${id}`);
    return res.data.data;
  },

  getPredictionExportUrl() {
    return `${API_BASE_URL}/predictions/export`;
  },

  // Model, Metrics, Horizons
  async getModelInfo() {
    const res = await api.get("/model/info");
    return res.data.data;
  },

  async getModelMetrics(): Promise<ModelMetricsResponse> {
    const res = await api.get("/model/metrics");
    return res.data.data;
  },

  async getModelEvaluationSamples(samples = 400) {
    const res = await api.get("/model/evaluation-samples", { params: { samples } });
    return res.data.data;
  },

  async getHorizonModels(): Promise<{ supported_horizons: number[]; models: Record<string, HorizonModelStatus> }> {
    const res = await api.get("/model/horizons");
    return res.data.data;
  },

  async getDataStatus(): Promise<DataFreshnessStatus> {
    const res = await api.get("/model/data-status");
    return res.data.data;
  },

  // Datasets
  async listDatasets(): Promise<DatasetMeta[]> {
    const res = await api.get("/datasets");
    return res.data.data;
  },

  async getDatasetSummary(id: string): Promise<DatasetMeta> {
    const res = await api.get(`/datasets/${id}/summary`);
    return res.data.data;
  },

  async getDatasetData(id: string, params?: { page?: number; limit?: number; search?: string }) {
    const res = await api.get(`/datasets/${id}/data`, { params });
    return res.data;
  },
};
