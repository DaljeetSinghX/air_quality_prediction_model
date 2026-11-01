import { Router } from "express";
import { getModelInfo, getModelMetrics, getModelScatterAndResiduals, getHorizonModels, getDataStatus } from "../controllers/modelController.js";

export const modelRoutes = Router();

modelRoutes.get("/info", getModelInfo);
modelRoutes.get("/metrics", getModelMetrics);
modelRoutes.get("/evaluation-samples", getModelScatterAndResiduals);
modelRoutes.get("/horizons", getHorizonModels);
modelRoutes.get("/data-status", getDataStatus);
