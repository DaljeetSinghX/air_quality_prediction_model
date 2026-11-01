import fs from "fs";
import path from "path";
import { config } from "../config/env.js";

export interface DatasetMeta {
  id: string;
  name: string;
  type: "processed" | "raw";
  filePath: string;
  sizeBytes: number;
  sizeFormatted: string;
  rowCount?: number;
  columnCount?: number;
  columns?: string[];
  dateRange?: { start: string; end: string } | null;
  missingValuesSummary?: Record<string, number>;
  description: string;
}

class DatasetService {
  private cache: Map<string, DatasetMeta> = new Map();

  private getDatasetsList(): { id: string; relativePath: string; type: "processed" | "raw"; description: string }[] {
    return [
      {
        id: "cpcb_hourly_processed",
        relativePath: path.join("processed", "cpcb_anand_vihar_hourly.csv"),
        type: "processed",
        description: "Primary cleaned and hourly regularized dataset for CPCB Anand Vihar (2022-2026)."
      },
      {
        id: "cpcb_model_features",
        relativePath: path.join("processed", "cpcb_pm25_model_data.csv"),
        type: "processed",
        description: "Processed feature table used for model training and validation."
      },
      {
        id: "raw_2022",
        relativePath: path.join("raw", "Raw_Data_2022_site_301_anand_vihar_delhi_dpcc_1Hr.csv"),
        type: "raw",
        description: "Raw CPCB DPCC Station 301 readings for year 2022."
      },
      {
        id: "raw_2023",
        relativePath: path.join("raw", "Raw_Data_2023_site_301_anand_vihar_delhi_dpcc_1Hr.csv"),
        type: "raw",
        description: "Raw CPCB DPCC Station 301 readings for year 2023."
      },
      {
        id: "raw_2024",
        relativePath: path.join("raw", "Raw_Data_2024_site_301_anand_vihar_delhi_dpcc_1Hr.csv"),
        type: "raw",
        description: "Raw CPCB DPCC Station 301 readings for year 2024."
      },
      {
        id: "raw_2025",
        relativePath: path.join("raw", "Raw_Data_2025_site_301_anand_vihar_delhi_dpcc_1Hr.csv"),
        type: "raw",
        description: "Raw CPCB DPCC Station 301 readings for year 2025."
      },
      {
        id: "raw_2026",
        relativePath: path.join("raw", "Raw_Data_2026_site_301_anand_vihar_delhi_dpcc_1Hr.csv"),
        type: "raw",
        description: "Raw CPCB DPCC Station 301 readings for year 2026."
      },
    ];
  }

  public listDatasets(): DatasetMeta[] {
    const list = this.getDatasetsList();
    const result: DatasetMeta[] = [];

    for (const item of list) {
      const fullPath = path.resolve(config.dataPath, item.relativePath);
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        result.push({
          id: item.id,
          name: path.basename(fullPath),
          type: item.type,
          filePath: item.relativePath,
          sizeBytes: stats.size,
          sizeFormatted: `${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
          description: item.description,
        });
      }
    }

    return result;
  }

  public getDatasetSummary(id: string): DatasetMeta {
    const item = this.getDatasetsList().find(d => d.id === id);
    if (!item) {
      throw new Error(`Dataset with id '${id}' not found.`);
    }

    const fullPath = path.resolve(config.dataPath, item.relativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found for dataset '${id}'.`);
    }

    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    const stats = fs.statSync(fullPath);
    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    const header = lines[0].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const rowCount = lines.length - 1;

    // Analyze missing values on first 5000 lines for responsiveness
    const sampleLimit = Math.min(lines.length, 5000);
    const missingCounts: Record<string, number> = {};
    for (const col of header) missingCounts[col] = 0;

    let startTime = "";
    let endTime = "";
    const timeIdx = header.findIndex(c => c.toLowerCase().includes("timestamp") || c.toLowerCase().includes("date"));

    for (let i = 1; i < sampleLimit; i++) {
      const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      if (timeIdx !== -1 && cols[timeIdx]) {
        if (!startTime) startTime = cols[timeIdx];
        endTime = cols[timeIdx];
      }
      for (let j = 0; j < header.length; j++) {
        const val = cols[j];
        if (val === undefined || val === "" || val === "NA" || val === "NaN") {
          missingCounts[header[j]] = (missingCounts[header[j]] || 0) + 1;
        }
      }
    }

    const meta: DatasetMeta = {
      id: item.id,
      name: path.basename(fullPath),
      type: item.type,
      filePath: item.relativePath,
      sizeBytes: stats.size,
      sizeFormatted: `${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
      rowCount,
      columnCount: header.length,
      columns: header,
      dateRange: startTime ? { start: startTime, end: endTime } : null,
      missingValuesSummary: missingCounts,
      description: item.description,
    };

    this.cache.set(id, meta);
    return meta;
  }

  public getDatasetData(id: string, page = 1, limit = 50, search = "") {
    const item = this.getDatasetsList().find(d => d.id === id);
    if (!item) throw new Error(`Dataset '${id}' not found.`);

    const fullPath = path.resolve(config.dataPath, item.relativePath);
    if (!fs.existsSync(fullPath)) throw new Error("Dataset file does not exist.");

    const content = fs.readFileSync(fullPath, "utf-8");
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return { columns: [], rows: [], total: 0, page, limit };

    const columns = lines[0].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    let rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const rowLine = lines[i];
      if (search && !rowLine.toLowerCase().includes(search.toLowerCase())) continue;
      
      const cols = rowLine.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      const obj: Record<string, string> = {};
      for (let j = 0; j < columns.length; j++) {
        obj[columns[j]] = cols[j] || "";
      }
      rows.push(obj);
    }

    const total = rows.length;
    const startIndex = (page - 1) * limit;
    const paginated = rows.slice(startIndex, startIndex + limit);

    return {
      columns,
      rows: paginated,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}

export const datasetService = new DatasetService();
