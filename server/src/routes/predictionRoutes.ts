import { Router } from "express";
import {
  createPrediction,
  getPredictions,
  getPredictionById,
  exportPredictionsCSV,
} from "../controllers/predictionController.js";

export const predictionRoutes = Router();

predictionRoutes.post("/", createPrediction);
predictionRoutes.get("/", getPredictions);
predictionRoutes.get("/export", exportPredictionsCSV);
predictionRoutes.get("/:id", getPredictionById);
