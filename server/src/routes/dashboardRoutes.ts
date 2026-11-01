import { Router } from "express";
import { getDashboardSummary } from "../controllers/dashboardController.js";

export const dashboardRoutes = Router();

dashboardRoutes.get("/summary", getDashboardSummary);
