import mysql from "mysql2/promise";
import { config } from "./env.js";

let pool: mysql.Pool | null = null;
let isConnected = false;

export interface MySQLPredictionRecord {
  predictionId: string;
  originTime: Date;
  targetTime: Date;
  horizonHours: number;
  predictedPM25: number;
  currentPM25?: number | null;
  aqiCategory?: string | null;
  modelName?: string | null;
  forecastMode?: string;
  status?: string;
}

/**
 * Initializes MySQL connection and ensures database & table exist.
 */
export async function initMySQL(): Promise<boolean> {
  try {
    // 1. Connect without database first to ensure air_prediction_db exists
    const initConnection = await mysql.createConnection({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
    });

    await initConnection.query(`CREATE DATABASE IF NOT EXISTS \`${config.mysql.database}\`;`);
    await initConnection.end();

    // 2. Create the connection pool with the database
    pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      dateStrings: false,
    });

    // 3. Ensure the predictions table exists
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS predictions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        prediction_id VARCHAR(64) UNIQUE,
        origin_time DATETIME NOT NULL,
        target_time DATETIME NOT NULL,
        horizon_hours INT NOT NULL,
        predicted_pm25 DECIMAL(8, 2) NOT NULL,
        current_pm25 DECIMAL(8, 2) NULL,
        aqi_category VARCHAR(32) NULL,
        model_name VARCHAR(64) NULL,
        forecast_mode VARCHAR(32) DEFAULT 'live_forecast',
        status VARCHAR(32) DEFAULT 'success',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_origin (origin_time),
        INDEX idx_target (target_time),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await pool.query(createTableQuery);

    isConnected = true;
    console.log(
      `[MySQL] Connected successfully to database: '${config.mysql.database}' at ${config.mysql.host}:${config.mysql.port} as user '${config.mysql.user}'`
    );
    return true;
  } catch (err: any) {
    isConnected = false;
    console.warn(`[MySQL] Warning: Could not connect to MySQL (${err.message}). Database operations will fallback gracefully.`);
    return false;
  }
}

export function isMySQLConnected(): boolean {
  return isConnected && pool !== null;
}

/**
 * Inserts a new prediction record into MySQL.
 */
export async function savePredictionToMySQL(data: MySQLPredictionRecord): Promise<boolean> {
  if (!pool || !isConnected) {
    console.warn("[MySQL] Not connected. Skipping MySQL insert.");
    return false;
  }

  const query = `
    INSERT INTO predictions 
      (prediction_id, origin_time, target_time, horizon_hours, predicted_pm25, current_pm25, aqi_category, model_name, forecast_mode, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      predicted_pm25 = VALUES(predicted_pm25),
      current_pm25 = VALUES(current_pm25),
      aqi_category = VALUES(aqi_category),
      status = VALUES(status);
  `;

  // Format Date objects for MySQL DATETIME ('YYYY-MM-DD HH:MM:SS')
  const formatDate = (d: Date): string => {
    return d.toISOString().slice(0, 19).replace("T", " ");
  };

  const values = [
    data.predictionId,
    formatDate(data.originTime),
    formatDate(data.targetTime),
    data.horizonHours,
    data.predictedPM25,
    data.currentPM25 ?? null,
    data.aqiCategory ?? null,
    data.modelName ?? "HistGradientBoosting",
    data.forecastMode ?? "live_forecast",
    data.status ?? "success",
  ];

  try {
    await pool.query(query, values);
    console.log(`[MySQL] Prediction '${data.predictionId}' stored successfully (${data.horizonHours}h ahead: ${data.predictedPM25} µg/m³)`);
    return true;
  } catch (err: any) {
    console.error(`[MySQL] Failed to insert prediction: ${err.message}`);
    return false;
  }
}

/**
 * Fetches latest predictions from MySQL.
 */
export async function getPredictionsFromMySQL(limit: number = 100, horizonHours?: number): Promise<any[]> {
  if (!pool || !isConnected) return [];

  try {
    let query = `SELECT * FROM predictions`;
    const params: any[] = [];

    if (horizonHours !== undefined && !isNaN(horizonHours)) {
      query += ` WHERE horizon_hours = ?`;
      params.push(horizonHours);
    }

    query += ` ORDER BY created_at DESC LIMIT ?;`;
    params.push(limit);

    const [rows] = await pool.query(query, params);
    return rows as any[];
  } catch (err: any) {
    console.error(`[MySQL] Failed to query predictions: ${err.message}`);
    return [];
  }
}

export async function closeMySQL(): Promise<void> {
  if (pool) {
    await pool.end();
    isConnected = false;
    console.log("[MySQL] Connection pool closed.");
  }
}
