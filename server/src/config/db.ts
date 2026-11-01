import mongoose from "mongoose";
import { config } from "./env.js";

let isConnected = false;

export async function connectDB(): Promise<boolean> {
  if (isConnected) return true;

  try {
    mongoose.set("strictQuery", false);
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log(`[Database] MongoDB connected successfully to: ${config.mongoUri.replace(/\/\/.*@/, "//***:***@")}`);
    return true;
  } catch (error: any) {
    console.warn(`[Database] Warning: Could not connect to MongoDB (${error.message}). Running with in-memory / CSV fallback support.`);
    isConnected = false;
    return false;
  }
}

export function isDbConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}

export async function disconnectDB(): Promise<void> {
  if (isConnected) {
    await mongoose.disconnect();
    isConnected = false;
    console.log("[Database] MongoDB disconnected cleanly.");
  }
}
