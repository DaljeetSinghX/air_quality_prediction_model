import { Router } from "express";
import { listDatasets, getDatasetSummary, getDatasetData } from "../controllers/datasetController.js";

export const datasetRoutes = Router();

datasetRoutes.get("/", listDatasets);
datasetRoutes.get("/:id/summary", getDatasetSummary);
datasetRoutes.get("/:id/data", getDatasetData);
