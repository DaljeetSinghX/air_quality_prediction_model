export interface Observation {
  timestamp: string;
  pm25: number | null;
  pm10: number | null;
  no: number | null;
  no2: number | null;
  nox?: number | null;
  nh3?: number | null;
  so2: number | null;
  co: number | null;
  ozone: number | null;
  temp: number | null;
  rh: number | null;
  ws: number | null;
  isInterpolated?: boolean;
}

export interface PredictionRecord {
  predictionId: string;
  forecastOriginTimestamp: string;
  targetTimestamp: string;
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
  createdAt: string;
  message?: string;
  dataFreshnessStatus?: string;
}

export interface MultiHorizonResult {
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
  staleData?: boolean;
}

export interface HorizonModelStatus {
  horizon_hours: number;
  status: string;
  ready: boolean;
  feature_count: number;
  metadata?: Record<string, any>;
}

export interface DataFreshnessStatus {
  total_records: number;
  latest_observation_timestamp: string;
  data_coverage: { start: string; end: string };
  freshness: {
    is_fresh: boolean;
    status: string;
    data_age_hours: number | null;
    data_age_minutes?: number | null;
    freshness_threshold_hours?: number;
    note?: string;
  };
  live_feed_available: boolean;
  note: string;
}


export interface DashboardSummary {
  station: string;
  stationType: string;
  latitude: number;
  longitude: number;
  dataFreshness: string;
  isLiveFeed: boolean;
  latestObservation: {
    timestamp: string;
    pm25: number | null;
    pm25_24h_avg: number | null;
    aqiCategory: string;
    details?: Observation;
  };
  latestPrediction: PredictionRecord | null;
  modelStatus: {
    status: string;
    modelLoaded: boolean;
    modelFamily: string;
    configuration: string;
    supportedHorizonMinutes: number[];
    unsupportedHorizons: number[];
  };
  offlineMetrics: {
    MAE: number;
    RMSE: number;
    R2: number;
    mean_bias: number;
    p90_absolute_error: number;
    n: number;
  };
  totalDatasetRecords: number;
}

export interface ModelMetricsResponse {
  metrics: {
    selected_feature_set: string;
    selected_model_family: string;
    selected_config_id: number;
    selected_parameters: Record<string, any>;
    validation_metrics: {
      MAE: number;
      RMSE: number;
      R2: number;
    };
    test_2026_metrics: {
      MAE: number;
      RMSE: number;
      R2: number;
      mean_bias: number;
      p90_absolute_error: number;
      n: number;
    };
    persistence_baseline_2026: {
      MAE: number;
      RMSE: number;
      R2: number;
      mean_bias: number;
      p90_absolute_error: number;
      n: number;
    };
    feature_count: number;
    forecast_horizon: string;
  };
  rangeErrors: Array<{
    actual_PM25_band_ug_m3: string;
    MAE: number;
    RMSE: number;
    R2: number;
    mean_bias: number;
    n: number;
  }>;
  station: string;
  evaluationPeriod: string;
  horizon: string;
}

export interface DatasetMeta {
  id: string;
  name: string;
  type: "processed" | "raw";
  filePath: string;
  sizeFormatted: string;
  rowCount?: number;
  columnCount?: number;
  columns?: string[];
  dateRange?: { start: string; end: string } | null;
  missingValuesSummary?: Record<string, number>;
  description: string;
}
