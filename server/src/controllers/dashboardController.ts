import { Request, Response } from "express";
import { observationService } from "../services/observationService.js";
import { MLClient } from "../services/mlClient.js";
import { Prediction } from "../models/Prediction.js";
import { isDbConnected } from "../config/db.js";
import { MetricsService } from "../services/metricsService.js";

export async function getDashboardSummary(req: Request, res: Response) {
  try {
    const obsSummary = observationService.getSummary();
    const mlHealth = await MLClient.checkHealth();
    const metricsData = MetricsService.getModelMetrics();

    // Latest saved prediction
    let latestPrediction: any = null;
    if (isDbConnected()) {
      latestPrediction = await Prediction.findOne({ status: "success" })
        .sort({ createdAt: -1 })
        .lean();
    }

    return res.json({
      success: true,
      data: {
        station: obsSummary.station,
        stationType: obsSummary.stationType,
        latitude: obsSummary.latitude,
        longitude: obsSummary.longitude,
        dataFreshness: obsSummary.dataFreshness,
        isLiveFeed: obsSummary.isLiveFeed,
        latestObservation: {
          timestamp: obsSummary.timestamp,
          pm25: obsSummary.pm25_current,
          pm25_24h_avg: obsSummary.pm25_24h_avg,
          aqiCategory: obsSummary.aqiCategory,
          details: obsSummary.latestObservation,
        },
        latestPrediction: latestPrediction ? {
          predictionId: latestPrediction.predictionId,
          forecastOriginTimestamp: latestPrediction.forecastOriginTimestamp,
          targetTimestamp: latestPrediction.targetTimestamp,
          horizonMinutes: latestPrediction.horizonMinutes,
          predictedPM25: latestPrediction.predictedPM25,
          actualPM25: latestPrediction.actualPM25,
          predictionError: latestPrediction.predictionError,
          status: latestPrediction.status,
          modelIdentifier: latestPrediction.modelIdentifier,
          modelVersion: latestPrediction.modelVersion,
        } : null,
        modelStatus: {
          status: mlHealth.status,
          modelLoaded: mlHealth.model_loaded,
          modelFamily: "HistGradientBoosting",
          configuration: "Config 3",
          supportedHorizonMinutes: [60],
          unsupportedHorizons: [1, 5, 10, 15, 30],
        },
        offlineMetrics: metricsData.metrics.test_2026_metrics,
        totalDatasetRecords: obsSummary.totalRecords,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
