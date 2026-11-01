import { Request, Response, NextFunction } from "express";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const statusCode = err.statusCode || 500;
  const message = err.message || "An unexpected internal server error occurred.";

  console.error(`[Error] ${req.method} ${req.url} - ${statusCode}:`, err);

  res.status(statusCode).json({
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
  });
}
