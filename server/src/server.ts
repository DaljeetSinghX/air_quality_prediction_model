import express from "express";
import cors from "cors";
import { config } from "./config/env.js";
import { connectDB, isDbConnected, disconnectDB } from "./config/db.js";
import { initMySQL, isMySQLConnected, closeMySQL } from "./config/mysql.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler } from "./middleware/errorHandler.js";

import { dashboardRoutes } from "./routes/dashboardRoutes.js";
import { predictionRoutes } from "./routes/predictionRoutes.js";
import { observationRoutes } from "./routes/observationRoutes.js";
import { modelRoutes } from "./routes/modelRoutes.js";
import { datasetRoutes } from "./routes/datasetRoutes.js";
import { MLClient } from "./services/mlClient.js";

const app = express();

// Security and middleware
app.use(cors({
  origin: ["http://localhost:5173", "http://127.0.0.1:5173", config.corsOrigin],
  credentials: true,
}));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(requestLogger);

// Health check endpoint
app.get("/api/health", async (req, res) => {
  const mlStatus = await MLClient.checkHealth();
  const dbConnected = isDbConnected();
  const mysqlConnected = isMySQLConnected();

  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      backend: "healthy",
      mysql: mysqlConnected ? "connected" : "disconnected",
      database: mysqlConnected ? "connected (mysql)" : (dbConnected ? "connected (mongodb)" : "fallback_mode"),
      mlService: mlStatus.status === "healthy" ? "ready" : "unavailable",
    },
    version: "1.0.0",
  });
});

// Mount modular API routes
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/predictions", predictionRoutes);
app.use("/api/observations", observationRoutes);
app.use("/api/model", modelRoutes);
app.use("/api/datasets", datasetRoutes);

// Centralized error handler
app.use(errorHandler);

// Start server
async function startServer() {
  // Initialize databases (MySQL primary, MongoDB secondary/fallback)
  await initMySQL();
  await connectDB();

  const server = app.listen(config.port, () => {
    console.log(`[Express] Server running on http://localhost:${config.port}`);
    console.log(`[Express] ML Service configured at: ${config.mlServiceUrl}`);
    console.log(`[Express] Health endpoint available at: http://localhost:${config.port}/api/health`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await closeMySQL();
      await disconnectDB();
      console.log("[Server] Closed HTTP server and resources.");
      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
