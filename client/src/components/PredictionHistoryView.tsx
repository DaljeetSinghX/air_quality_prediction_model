import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Database,
  RefreshCw,
  Download,
  Search,
  Filter,
  Calendar,
  Clock,
  Sparkles,
  ArrowUpDown,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
} from "lucide-react";
import { ApiService } from "../services/api";
import { formatNumber, formatDateTime, getAqiCategory } from "../utils/formatters";

interface StoredPrediction {
  id?: number;
  prediction_id?: string;
  predictionId?: string;
  origin_time?: string;
  forecastOriginTimestamp?: string;
  target_time?: string;
  targetTimestamp?: string;
  horizon_hours?: number;
  horizonHours?: number;
  horizon_minutes?: number;
  horizonMinutes?: number;
  predicted_pm25?: number | string;
  predictedPM25?: number | string;
  current_pm25?: number | string | null;
  sourcePM25Observed?: number | string | null;
  aqi_category?: string;
  model_name?: string;
  modelIdentifier?: string;
  forecast_mode?: string;
  forecastMode?: string;
  created_at?: string;
  createdAt?: string;
}

interface PredictionHistoryViewProps {
  onGoToPredict?: () => void;
}

export const PredictionHistoryView: React.FC<PredictionHistoryViewProps> = ({ onGoToPredict }) => {
  const [predictions, setPredictions] = useState<StoredPrediction[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHorizon, setSelectedHorizon] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [dataSource, setDataSource] = useState<string>("mysql");

  const fetchHistory = useCallback(async (horizon?: number | null) => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { limit: 100 };
      if (horizon !== null && horizon !== undefined) {
        params.horizon = horizon;
      }
      const resp = await ApiService.getPredictions(params);
      if (resp && resp.data) {
        setPredictions(resp.data);
        if (resp.source) setDataSource(resp.source);
      }
    } catch (err: any) {
      console.warn("Failed to fetch predictions from API:", err);
      setError("Unable to connect to database API. Make sure the server is running on port 5000.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory(selectedHorizon);
  }, [selectedHorizon, fetchHistory]);

  // Client-side search filtering
  const filteredPredictions = useMemo(() => {
    if (!searchQuery.trim()) return predictions;
    const q = searchQuery.toLowerCase().trim();
    return predictions.filter((p) => {
      const id = (p.prediction_id || p.predictionId || "").toLowerCase();
      const cat = (p.aqi_category || "").toLowerCase();
      const model = (p.model_name || p.modelIdentifier || "").toLowerCase();
      const origin = (p.origin_time || p.forecastOriginTimestamp || "").toLowerCase();
      const target = (p.target_time || p.targetTimestamp || "").toLowerCase();
      return (
        id.includes(q) ||
        cat.includes(q) ||
        model.includes(q) ||
        origin.includes(q) ||
        target.includes(q)
      );
    });
  }, [predictions, searchQuery]);

  // Summary statistics computed from fetched predictions
  const stats = useMemo(() => {
    if (predictions.length === 0) {
      return { total: 0, avgPM25: 0, maxPM25: 0, minPM25: 0 };
    }
    const values = predictions
      .map((p) => Number(p.predicted_pm25 ?? p.predictedPM25))
      .filter((v) => !isNaN(v));

    if (values.length === 0) {
      return { total: predictions.length, avgPM25: 0, maxPM25: 0, minPM25: 0 };
    }

    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = Math.round((sum / values.length) * 10) / 10;
    const max = Math.round(Math.max(...values) * 10) / 10;
    const min = Math.round(Math.min(...values) * 10) / 10;

    return { total: predictions.length, avgPM25: avg, maxPM25: max, minPM25: min };
  }, [predictions]);

  const handleExportCSV = () => {
    const url = ApiService.getPredictionExportUrl();
    window.open(url, "_blank");
  };

  return (
    <div className="space-y-6">
      {/* Top Controls Bar */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <Database className="w-5 h-5 text-teal-400" />
              <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Stored Predictions Archive
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                MySQL Database ({dataSource.toUpperCase()})
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Historical record of ML predictions generated and saved in <code className="text-cyan-300 font-mono">air_prediction_db.predictions</code>
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => fetchHistory(selectedHorizon)}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-navy-900 border border-slate-700/80 text-slate-300 hover:text-white hover:border-slate-600 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-teal-400" : ""}`} />
              Refresh
            </button>

            <button
              onClick={handleExportCSV}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-teal-500/20 to-cyan-500/20 border border-teal-500/40 text-teal-300 hover:bg-teal-500/30 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Filter Pills & Search */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          {/* Horizon Filters */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-mono mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3 text-slate-500" /> Horizon:
            </span>
            {[
              { label: "All", value: null },
              { label: "1h", value: 1 },
              { label: "2h", value: 2 },
              { label: "6h", value: 6 },
              { label: "12h", value: 12 },
              { label: "24h", value: 24 },
            ].map((btn) => {
              const isActive = selectedHorizon === btn.value;
              return (
                <button
                  key={btn.label}
                  onClick={() => setSelectedHorizon(btn.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all ${
                    isActive
                      ? "bg-teal-500 text-navy-950 font-bold shadow-sm"
                      : "bg-navy-900 text-slate-400 hover:text-slate-200 border border-slate-800"
                  }`}
                >
                  {btn.label}
                </button>
              );
            })}
          </div>

          {/* Search Bar */}
          <div className="relative min-w-[240px]">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ID, category, model..."
              className="w-full bg-navy-950 border border-slate-700/80 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-teal-500"
            />
          </div>
        </div>
      </div>

      {/* Quick Summary Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="glass-panel p-3.5 rounded-xl border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-mono text-slate-500">Total Saved</span>
          <div className="text-xl font-bold font-mono text-white">{stats.total}</div>
          <span className="text-[10px] text-slate-500">records in database</span>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-mono text-slate-500">Average Predicted</span>
          <div className="text-xl font-bold font-mono text-cyan-300">
            {formatNumber(stats.avgPM25, 1)} <span className="text-xs text-slate-500">µg/m³</span>
          </div>
          <span className="text-[10px] text-slate-500">across saved forecasts</span>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-mono text-slate-500">Highest Forecast</span>
          <div className="text-xl font-bold font-mono text-rose-400">
            {formatNumber(stats.maxPM25, 1)} <span className="text-xs text-slate-500">µg/m³</span>
          </div>
          <span className="text-[10px] text-slate-500">maximum expected PM2.5</span>
        </div>

        <div className="glass-panel p-3.5 rounded-xl border border-slate-800 space-y-1">
          <span className="text-[10px] uppercase font-mono text-slate-500">Lowest Forecast</span>
          <div className="text-xl font-bold font-mono text-emerald-400">
            {formatNumber(stats.minPM25, 1)} <span className="text-xs text-slate-500">µg/m³</span>
          </div>
          <span className="text-[10px] text-slate-500">cleanest air forecast</span>
        </div>
      </div>

      {/* Main Predictions Data Table */}
      <div className="glass-panel rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
        {loading && (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin text-teal-400" />
            <p className="text-xs font-mono">Fetching stored predictions from MySQL...</p>
          </div>
        )}

        {!loading && error && (
          <div className="p-8 text-center space-y-3">
            <div className="inline-flex p-3 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30">
              <AlertCircle className="w-6 h-6" />
            </div>
            <p className="text-sm text-slate-300">{error}</p>
            <button
              onClick={() => fetchHistory(selectedHorizon)}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-teal-500 text-navy-950 hover:bg-teal-400"
            >
              Retry Connection
            </button>
          </div>
        )}

        {!loading && !error && filteredPredictions.length === 0 && (
          <div className="py-20 px-4 text-center space-y-3">
            <div className="inline-flex p-3 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700">
              <Database className="w-6 h-6" />
            </div>
            <p className="text-sm font-semibold text-slate-300">No predictions found</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {searchQuery
                ? `No records matching "${searchQuery}". Try clearing the search query.`
                : "No forecasts have been recorded in MySQL yet. Make a prediction in the Live Forecast tab to store one."}
            </p>
            {onGoToPredict && (
              <button
                onClick={onGoToPredict}
                className="mt-2 px-4 py-2 rounded-xl text-xs font-bold bg-teal-500 text-navy-950 hover:bg-teal-400"
              >
                Go to Live Forecast
              </button>
            )}
          </div>
        )}

        {!loading && !error && filteredPredictions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-navy-900/90 text-slate-400 font-mono text-[11px] border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4 font-semibold">Prediction ID</th>
                  <th className="py-3.5 px-4 font-semibold">Horizon</th>
                  <th className="py-3.5 px-4 font-semibold">Forecast Origin Time</th>
                  <th className="py-3.5 px-4 font-semibold">Target Arrival Time</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Predicted PM2.5</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Origin (Current)</th>
                  <th className="py-3.5 px-4 font-semibold">AQI Risk Category</th>
                  <th className="py-3.5 px-4 font-semibold">Model Engine</th>
                  <th className="py-3.5 px-4 font-semibold text-right">Saved At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                {filteredPredictions.map((row, idx) => {
                  const predId = row.prediction_id || row.predictionId || `pred_${idx}`;
                  const hh = row.horizon_hours ?? row.horizonHours ?? 1;
                  const originTs = row.origin_time || row.forecastOriginTimestamp;
                  const targetTs = row.target_time || row.targetTimestamp;
                  const predVal = Number(row.predicted_pm25 ?? row.predictedPM25 ?? 0);
                  const currVal = row.current_pm25 ?? row.sourcePM25Observed;
                  const aqi = getAqiCategory(predVal);
                  const model = row.model_name || row.modelIdentifier || "HistGradientBoosting";
                  const createdAt = row.created_at || row.createdAt;

                  return (
                    <tr
                      key={predId}
                      className="hover:bg-slate-800/30 transition-colors group"
                    >
                      {/* Prediction ID */}
                      <td className="py-3 px-4 font-semibold text-cyan-300">
                        {predId}
                      </td>

                      {/* Horizon Badge */}
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-500/15 text-teal-300 border border-teal-500/30">
                          {hh}h Ahead
                        </span>
                      </td>

                      {/* Origin Time */}
                      <td className="py-3 px-4 text-slate-300">
                        {formatDateTime(originTs)}
                      </td>

                      {/* Target Time */}
                      <td className="py-3 px-4 text-white font-medium">
                        {formatDateTime(targetTs)}
                      </td>

                      {/* Predicted PM2.5 */}
                      <td className="py-3 px-4 text-right font-bold text-white text-sm">
                        {formatNumber(predVal, 1)} <span className="text-[10px] text-slate-500 font-normal">µg/m³</span>
                      </td>

                      {/* Current (Origin) */}
                      <td className="py-3 px-4 text-right text-slate-400">
                        {currVal != null ? `${formatNumber(Number(currVal), 1)} µg/m³` : "—"}
                      </td>

                      {/* AQI Category Badge */}
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${aqi.badgeClass}`}>
                          {aqi.label}
                        </span>
                      </td>

                      {/* Model */}
                      <td className="py-3 px-4 text-slate-400 text-[11px]">
                        {model}
                      </td>

                      {/* Saved At */}
                      <td className="py-3 px-4 text-right text-slate-500 text-[11px]">
                        {createdAt ? formatDateTime(createdAt) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
