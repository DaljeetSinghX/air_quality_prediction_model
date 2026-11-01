import { Request, Response } from "express";
import { datasetService } from "../services/datasetService.js";

export async function listDatasets(req: Request, res: Response) {
  try {
    const list = datasetService.listDatasets();
    return res.json({ success: true, count: list.length, data: list });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function getDatasetSummary(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const summary = datasetService.getDatasetSummary(id);
    return res.json({ success: true, data: summary });
  } catch (error: any) {
    return res.status(404).json({ success: false, error: error.message });
  }
}

export async function getDatasetData(req: Request, res: Response) {
  try {
    const id = req.params.id as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const search = (req.query.search as string) || "";

    const data = datasetService.getDatasetData(id, page, limit, search);
    return res.json({ success: true, ...data });
  } catch (error: any) {
    return res.status(404).json({ success: false, error: error.message });
  }
}
