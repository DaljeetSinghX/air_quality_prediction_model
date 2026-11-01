import fs from "fs";
import path from "path";
import { config } from "../config/env.js";
import { Observation, IObservation } from "../models/Observation.js";
import { isDbConnected } from "../config/db.js";

export interface ParsedObservation {
  timestamp: string;
  pm25: number | null;
  pm10: number | null;
  no: number | null;
  no2: number | null;
  nox: number | null;
  nh3: number | null;
  so2: number | null;
  co: number | null;
  ozone: number | null;
  temp: number | null;
  rh: number | null;
  ws: number | null;
  isInterpolated?: boolean;
}

class ObservationService {
  private memoryCache: ParsedObservation[] = [];
  private isLoaded = false;
  private csvPath = path.resolve(config.dataPath, "processed", "cpcb_anand_vihar_hourly.csv");

  constructor() {
    this.loadFromCSV();
  }

  private loadFromCSV() {
    if (this.isLoaded) return;
    if (!fs.existsSync(this.csvPath)) {
      console.warn(`[ObservationService] Processed CSV not found at ${this.csvPath}`);
      return;
    }

    try {
      console.log(`[ObservationService] Loading dataset from CSV: ${this.csvPath}`);
      const content = fs.readFileSync(this.csvPath, "utf-8");
      const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length < 2) return;

      const header = lines[0].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      
      const findIdx = (keywords: string[]) => {
        return header.findIndex(col => keywords.some(k => col.toLowerCase().includes(k.toLowerCase())));
      };

      const timeIdx = findIdx(["timestamp"]);
      const pm25Idx = findIdx(["pm2.5", "pm25"]);
      const pm10Idx = findIdx(["pm10"]);
      const noIdx = header.findIndex(c => c.startsWith("NO (") || c === "NO");
      const no2Idx = findIdx(["no2"]);
      const noxIdx = findIdx(["nox"]);
      const nh3Idx = findIdx(["nh3"]);
      const so2Idx = findIdx(["so2"]);
      const coIdx = findIdx(["co (", "co"]);
      const ozoneIdx = findIdx(["ozone"]);
      const tempIdx = findIdx(["at (", "at "]);
      const rhIdx = findIdx(["rh (", "rh"]);
      const wsIdx = findIdx(["ws (", "ws"]);

      const records: ParsedObservation[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
        if (!cols[timeIdx]) continue;

        const parseNum = (idx: number) => {
          if (idx === -1 || idx >= cols.length) return null;
          const val = parseFloat(cols[idx]);
          return isNaN(val) ? null : val;
        };

        const ts = new Date(cols[timeIdx]).toISOString();
        if (isNaN(new Date(ts).getTime())) continue;

        records.push({
          timestamp: ts,
          pm25: parseNum(pm25Idx),
          pm10: parseNum(pm10Idx),
          no: parseNum(noIdx),
          no2: parseNum(no2Idx),
          nox: parseNum(noxIdx),
          nh3: parseNum(nh3Idx),
          so2: parseNum(so2Idx),
          co: parseNum(coIdx),
          ozone: parseNum(ozoneIdx),
          temp: parseNum(tempIdx),
          rh: parseNum(rhIdx),
          ws: parseNum(wsIdx),
          isInterpolated: false,
        });
      }

      records.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      this.memoryCache = records;
      this.isLoaded = true;
      console.log(`[ObservationService] Successfully loaded ${this.memoryCache.length} records into memory.`);
    } catch (err: any) {
      console.error(`[ObservationService] Failed loading CSV: ${err.message}`);
    }
  }

  public getLatestObservation(): ParsedObservation | null {
    if (this.memoryCache.length === 0) return null;
    // Find the latest non-null PM2.5 observation
    for (let i = this.memoryCache.length - 1; i >= 0; i--) {
      if (this.memoryCache[i].pm25 !== null) {
        return this.memoryCache[i];
      }
    }
    return this.memoryCache[this.memoryCache.length - 1];
  }

  public getSummary() {
    const latest = this.getLatestObservation();
    if (!latest) {
      return {
        latestObservation: null,
        dataFreshness: "unavailable",
        station: "CPCB Anand Vihar, Delhi",
        recordCount: 0,
      };
    }

    // 24h rolling average from the latest observation
    const latestTime = new Date(latest.timestamp).getTime();
    const dayAgoTime = latestTime - 24 * 60 * 60 * 1000;
    const last24h = this.memoryCache.filter(r => {
      const t = new Date(r.timestamp).getTime();
      return t >= dayAgoTime && t <= latestTime && r.pm25 !== null;
    });

    const avg24h = last24h.length > 0
      ? last24h.reduce((acc, curr) => acc + (curr.pm25 || 0), 0) / last24h.length
      : latest.pm25;

    let aqiCategory = "Good";
    const pm = latest.pm25 ?? 0;
    if (pm > 250) aqiCategory = "Severe";
    else if (pm > 120) aqiCategory = "Very Poor";
    else if (pm > 90) aqiCategory = "Poor";
    else if (pm > 60) aqiCategory = "Moderate";
    else if (pm > 30) aqiCategory = "Satisfactory";

    return {
      latestObservation: latest,
      pm25_current: latest.pm25,
      pm25_24h_avg: avg24h ? Math.round(avg24h * 10) / 10 : null,
      aqiCategory,
      timestamp: latest.timestamp,
      station: "CPCB Anand Vihar, Delhi (DPCC Station 301)",
      stationType: "Continuous Ambient Air Quality Monitoring Station (CAAQMS)",
      latitude: 28.6508,
      longitude: 77.3152,
      dataFreshness: "Historical Archive (Latest: 2026-09-30)",
      isLiveFeed: false,
      totalRecords: this.memoryCache.length,
      availablePollutants: ["PM2.5", "PM10", "NO", "NO2", "NOx", "NH3", "SO2", "CO", "Ozone"],
      meteorologicalParameters: ["Temperature (AT)", "Relative Humidity (RH)", "Wind Speed (WS)"]
    };
  }

  public getObservations(options: {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
  }) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));

    let filtered = this.memoryCache;

    if (options.startDate) {
      const start = new Date(options.startDate).getTime();
      filtered = filtered.filter(r => new Date(r.timestamp).getTime() >= start);
    }
    if (options.endDate) {
      const end = new Date(options.endDate).getTime();
      filtered = filtered.filter(r => new Date(r.timestamp).getTime() <= end);
    }

    const total = filtered.length;
    // Return newest first for data tables
    const reversed = [...filtered].reverse();
    const startIndex = (page - 1) * limit;
    const paginated = reversed.slice(startIndex, startIndex + limit);

    return {
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  public getRange(options: {
    startDate?: string;
    endDate?: string;
    intervalMinutes?: number;
    enableInterpolation?: boolean;
    limit?: number;
  }): ParsedObservation[] {
    const interval = options.intervalMinutes || 60;
    const maxLimit = options.limit || 500;

    let filtered = this.memoryCache;

    if (options.startDate) {
      const start = new Date(options.startDate).getTime();
      filtered = filtered.filter(r => new Date(r.timestamp).getTime() >= start);
    }
    if (options.endDate) {
      const end = new Date(options.endDate).getTime();
      filtered = filtered.filter(r => new Date(r.timestamp).getTime() <= end);
    }

    // Default to the last N records if no range specified
    if (!options.startDate && !options.endDate) {
      filtered = filtered.slice(-Math.min(filtered.length, 168)); // Last 7 days by default
    }

    if (interval >= 60 || !options.enableInterpolation) {
      // Return hourly observations directly
      if (filtered.length > maxLimit) {
        const step = Math.ceil(filtered.length / maxLimit);
        return filtered.filter((_, idx) => idx % step === 0);
      }
      return filtered;
    }

    // Interval is < 60 min and interpolation for visualization is requested
    // We linearly interpolate display points between consecutive hourly readings
    // BUT every point is explicitly marked: isInterpolated = true (except original hours)
    const points: ParsedObservation[] = [];
    const stepMs = interval * 60 * 1000;

    for (let i = 0; i < filtered.length - 1; i++) {
      const curr = filtered[i];
      const next = filtered[i + 1];
      const currTime = new Date(curr.timestamp).getTime();
      const nextTime = new Date(next.timestamp).getTime();

      // Original observation point
      points.push({ ...curr, isInterpolated: false });

      // Only interpolate if consecutive points are exactly 1 hour apart (3600000 ms)
      if (nextTime - currTime === 3600000 && curr.pm25 !== null && next.pm25 !== null) {
        for (let t = currTime + stepMs; t < nextTime; t += stepMs) {
          const ratio = (t - currTime) / (nextTime - currTime);
          const interpPM25 = curr.pm25 + ratio * (next.pm25 - curr.pm25);
          points.push({
            timestamp: new Date(t).toISOString(),
            pm25: Math.round(interpPM25 * 100) / 100,
            pm10: curr.pm10 !== null && next.pm10 !== null ? Math.round((curr.pm10 + ratio * (next.pm10 - curr.pm10)) * 100) / 100 : null,
            no: null,
            no2: null,
            nox: null,
            nh3: null,
            so2: null,
            co: null,
            ozone: null,
            temp: curr.temp !== null && next.temp !== null ? Math.round((curr.temp + ratio * (next.temp - curr.temp)) * 10) / 10 : null,
            rh: curr.rh !== null && next.rh !== null ? Math.round((curr.rh + ratio * (next.rh - curr.rh)) * 10) / 10 : null,
            ws: curr.ws !== null && next.ws !== null ? Math.round((curr.ws + ratio * (next.ws - curr.ws)) * 10) / 10 : null,
            isInterpolated: true,
          });
        }
      }
    }

    if (filtered.length > 0) {
      points.push({ ...filtered[filtered.length - 1], isInterpolated: false });
    }

    if (points.length > maxLimit) {
      return points.slice(-maxLimit);
    }

    return points;
  }
}

export const observationService = new ObservationService();
