import { Request, Response } from "express";
import { observationService } from "../services/observationService.js";

export async function getObservations(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    const result = observationService.getObservations({
      page,
      limit,
      startDate,
      endDate,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function getObservationRange(req: Request, res: Response) {
  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const intervalMinutes = req.query.interval ? parseInt(req.query.interval as string, 10) : 60;
    const enableInterpolation = req.query.interpolate === "true";
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 500;

    const points = observationService.getRange({
      startDate,
      endDate,
      intervalMinutes,
      enableInterpolation,
      limit,
    });

    return res.json({
      success: true,
      intervalMinutes,
      isInterpolatedVisualization: intervalMinutes < 60 && enableInterpolation,
      dataPointsCount: points.length,
      data: points,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
