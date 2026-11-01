import { Router } from "express";
import { getObservations, getObservationRange } from "../controllers/observationController.js";

export const observationRoutes = Router();

observationRoutes.get("/", getObservations);
observationRoutes.get("/range", getObservationRange);
