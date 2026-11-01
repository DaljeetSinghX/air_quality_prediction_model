import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { Prediction } from "../models/Prediction.js";
import { MLClient, SUPPORTED_HORIZONS_HOURS } from "../services/mlClient.js";
import { isDbConnected } from "../config/db.js";
import {
  savePredictionToMySQL,
  isMySQLConnected,
  getPredictionsFromMySQL,
} from "../config/mysql.js";

const inMemoryPredictions: any[] = [];

function getAqiCategoryName(pm25?: number | null): string {
  if (pm25 === null || pm25 === undefined) return "Unknown";
  if (pm25 <= 30) return "Good";
  if (pm25 <= 60) return "Satisfactory";
  if (pm25 <= 90) return "Moderate";
  if (pm25 <= 120) return "Poor";
  if (pm25 <= 250) return "Very Poor";
  return "Severe";
}

export async function createPrediction(req: Request, res: Response) {
  try {
    const {
      originTimestamp,
      horizonMinutes,
      horizonHours,
      mode,
      predictedPM25,
      currentPM25,
      modelName,
    } = req.body;

    if (!originTimestamp) {
      return res
        .status(400)
        .json({ error: "originTimestamp is required (ISO 8601 string)." });
    }

    // Resolve horizon in hours
    let hh: number;
    if (horizonHours !== undefined) {
      hh = parseInt(horizonHours, 10);
    } else if (horizonMinutes !== undefined) {
      hh = Math.round(parseInt(horizonMinutes, 10) / 60);
    } else {
      hh = 1;
    }

    if (!SUPPORTED_HORIZONS_HOURS.includes(hh)) {
      return res.status(400).json({
        error: `Unsupported horizon: ${hh}h. Supported horizons: ${SUPPORTED_HORIZONS_HOURS.join(", ")}h.`,
      });
    }

    const forecastMode = mode ?? "live_forecast";
    const originDate = new Date(originTimestamp);
    const targetDate = new Date(originDate.getTime() + hh * 3600000);
    const predictionId = `pred_${uuidv4().slice(0, 8)}`;

    let finalPredictedPM25: number;
    let finalCurrentPM25: number | null = null;
    let finalModelName = modelName ?? `MultiHorizon-${hh}h`;
    let finalStatus = "success";

    // If caller provided predictedPM25 directly (e.g. live client forecast save)
    if (predictedPM25 !== undefined && predictedPM25 !== null) {
      finalPredictedPM25 = parseFloat(predictedPM25);
      finalCurrentPM25 = currentPM25 !== undefined ? parseFloat(currentPM25) : null;
    } else {
      // Query Python ML inference service
      const mlResult = await MLClient.predictMultiHorizon({
        originTimestamp,
        horizonHours: hh,
        mode: forecastMode,
        currentPM25: currentPM25 !== undefined ? parseFloat(currentPM25) : undefined,
      });

      // Handle stale data response from ML service
      if (mlResult.status === "STALE_DATA") {
        return res.status(200).json({
          success: false,
          staleData: true,
          data: mlResult,
        });
      }

      finalPredictedPM25 = mlResult.predictedPM25 ?? 0;
      finalCurrentPM25 = mlResult.sourcePM25Observed ?? null;
      finalModelName = mlResult.modelName ?? finalModelName;
      finalStatus = mlResult.status ?? "success";
    }

    const aqiCat = getAqiCategoryName(finalPredictedPM25);

    const record = {
      predictionId,
      forecastOriginTimestamp: originDate,
      targetTimestamp: targetDate,
      horizonMinutes: hh * 60,
      horizonHours: hh,
      predictedPM25: finalPredictedPM25,
      actualPM25: null,
      predictionError: null,
      absoluteError: null,
      modelIdentifier: finalModelName,
      modelVersion: "1.0.0",
      status: finalStatus,
      forecastMode,
      isInterpolated: false,
      sourcePM25Observed: finalCurrentPM25,
      featuresSummary: {},
      featureCount: 55,
      dataFreshnessStatus: "FRESH",
      createdAt: new Date(),
    };

    // 1. Store in MySQL database
    if (isMySQLConnected()) {
      try {
        await savePredictionToMySQL({
          predictionId,
          originTime: originDate,
          targetTime: targetDate,
          horizonHours: hh,
          predictedPM25: finalPredictedPM25,
          currentPM25: finalCurrentPM25,
          aqiCategory: aqiCat,
          modelName: finalModelName,
          forecastMode,
          status: finalStatus,
        });
      } catch (sqlErr: any) {
        console.warn("[PredictionController] MySQL store failed:", sqlErr.message);
      }
    }

    // 2. Secondary MongoDB persist (if active)
    if (isDbConnected()) {
      try {
        await Prediction.create(record);
      } catch (dbErr: any) {
        console.warn("[PredictionController] Mongo persist failed:", dbErr.message);
      }
    }

    // 3. In-memory buffer
    inMemoryPredictions.unshift(record);

    return res.status(201).json({
      success: true,
      storedInMySQL: isMySQLConnected(),
      data: record,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to generate prediction.",
    });
  }
}

export async function getPredictions(req: Request, res: Response) {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit as string) || 20)
    );
    const status = req.query.status as string;
    const horizon = req.query.horizon
      ? parseInt(req.query.horizon as string)
      : undefined;

    // Prefer MySQL if connected
    if (isMySQLConnected()) {
      const mysqlRecords = await getPredictionsFromMySQL(limit, horizon);
      return res.json({
        source: "mysql",
        data: mysqlRecords,
        pagination: {
          page,
          limit,
          total: mysqlRecords.length,
          totalPages: Math.ceil(mysqlRecords.length / limit) || 1,
        },
      });
    }

    let items: any[] = [];
    let total = 0;

    if (isDbConnected()) {
      const filter: any = {};
      if (status) filter.status = status;
      if (horizon) filter.horizonHours = horizon;

      total = await Prediction.countDocuments(filter);
      items = await Prediction.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
    } else {
      let filtered = inMemoryPredictions;
      if (status) filtered = filtered.filter((p) => p.status === status);
      if (horizon) filtered = filtered.filter((p) => p.horizonHours === horizon);
      total = filtered.length;
      items = filtered.slice((page - 1) * limit, page * limit);
    }

    return res.json({
      source: isDbConnected() ? "mongodb" : "memory",
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

export async function getPredictionById(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    let record: any = null;
    if (isDbConnected()) {
      record = await Prediction.findOne({ predictionId: id }).lean();
    }
    if (!record) {
      record = inMemoryPredictions.find((p) => p.predictionId === id);
    }
    if (!record) {
      return res
        .status(404)
        .json({ error: `Prediction '${id}' not found.` });
    }
    return res.json({ data: record });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

export async function exportPredictionsCSV(req: Request, res: Response) {
  try {
    let items: any[] = [];
    if (isMySQLConnected()) {
      items = await getPredictionsFromMySQL(1000);
    } else if (isDbConnected()) {
      items = await Prediction.find()
        .sort({ createdAt: -1 })
        .limit(1000)
        .lean();
    } else {
      items = inMemoryPredictions.slice(0, 1000);
    }

    const headers = [
      "Prediction ID",
      "Origin Time",
      "Target Time",
      "Horizon (Hours)",
      "Predicted PM2.5",
      "Current PM2.5",
      "AQI Category",
      "Model",
      "Created At",
    ];

    const rows = items.map((p) => [
      p.prediction_id || p.predictionId,
      new Date(p.origin_time || p.forecastOriginTimestamp).toISOString(),
      new Date(p.target_time || p.targetTimestamp).toISOString(),
      p.horizon_hours ?? p.horizonHours,
      p.predicted_pm25 ?? p.predictedPM25,
      p.current_pm25 ?? p.sourcePM25Observed ?? "N/A",
      p.aqi_category || "N/A",
      p.model_name || p.modelIdentifier,
      new Date(p.created_at || p.createdAt).toISOString(),
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="predictions_export.csv"'
    );
    return res.send(csvContent);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
