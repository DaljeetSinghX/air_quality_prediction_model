import mongoose, { Document, Schema } from "mongoose";

export interface IPrediction extends Document {
  predictionId: string;
  forecastOriginTimestamp: Date;
  targetTimestamp: Date;
  horizonMinutes: number;
  horizonHours?: number;
  predictedPM25: number;
  actualPM25?: number | null;
  predictionError?: number | null;
  absoluteError?: number | null;
  modelIdentifier: string;
  modelVersion: string;
  status: string;
  forecastMode?: string;
  isInterpolated: boolean;
  sourcePM25Observed?: number | null;
  featuresSummary?: Record<string, any>;
  featureCount: number;
  dataFreshnessStatus?: string;
  createdAt: Date;
}

const PredictionSchema = new Schema<IPrediction>(
  {
    predictionId: { type: String, required: true, unique: true, index: true },
    forecastOriginTimestamp: { type: Date, required: true, index: true },
    targetTimestamp: { type: Date, required: true, index: true },
    horizonMinutes: { type: Number, required: true, default: 60 },
    horizonHours: { type: Number, default: 1 },
    predictedPM25: { type: Number, required: true },
    actualPM25: { type: Number, default: null },
    predictionError: { type: Number, default: null },
    absoluteError: { type: Number, default: null },
    modelIdentifier: {
      type: String,
      required: true,
      default: "HistGradientBoosting-config3",
    },
    modelVersion: { type: String, required: true, default: "1.0.0" },
    status: { type: String, required: true, default: "success" },
    forecastMode: { type: String, default: "historical_backtest" },
    isInterpolated: { type: Boolean, default: false },
    sourcePM25Observed: { type: Number, default: null },
    featuresSummary: { type: Schema.Types.Mixed, default: {} },
    featureCount: { type: Number, default: 55 },
    dataFreshnessStatus: { type: String, default: null },
  },
  { timestamps: true }
);

PredictionSchema.index({ forecastOriginTimestamp: -1, horizonMinutes: 1 });
PredictionSchema.index({ forecastOriginTimestamp: -1, horizonHours: 1 });
PredictionSchema.index({ createdAt: -1 });

export const Prediction = mongoose.model<IPrediction>(
  "Prediction",
  PredictionSchema
);
