import fs from "fs";
import path from "path";
import { connectDB, disconnectDB } from "../config/db.js";
import { Observation } from "../models/Observation.js";
import { Prediction } from "../models/Prediction.js";
import { config } from "../config/env.js";

async function seed() {
  console.log("[Seed] Connecting to MongoDB...");
  const connected = await connectDB();
  if (!connected) {
    console.error("[Seed] Could not connect to MongoDB. Aborting seed.");
    process.exit(1);
  }

  try {
    const csvPath = path.resolve(config.dataPath, "processed", "cpcb_anand_vihar_hourly.csv");
    if (!fs.existsSync(csvPath)) {
      console.error(`[Seed] CSV not found at: ${csvPath}`);
      return;
    }

    console.log("[Seed] Reading processed observations CSV...");
    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    const header = lines[0].split(",").map(c => c.trim().replace(/^"|"$/g, ""));

    const findIdx = (keywords: string[]) => {
      return header.findIndex(col => keywords.some(k => col.toLowerCase().includes(k.toLowerCase())));
    };

    const timeIdx = findIdx(["timestamp"]);
    const pm25Idx = findIdx(["pm2.5", "pm25"]);
    const pm10Idx = findIdx(["pm10"]);
    const noIdx = header.findIndex(c => c.startsWith("NO (") || c === "NO");
    const no2Idx = findIdx(["no2"]);
    const noxIdx = findIdx(["nox"]);
    const nh3Idx = findIdx(["nh3"]);
    const so2Idx = findIdx(["so2"]);
    const coIdx = findIdx(["co (", "co"]);
    const ozoneIdx = findIdx(["ozone"]);
    const tempIdx = findIdx(["at (", "at "]);
    const rhIdx = findIdx(["rh (", "rh"]);
    const wsIdx = findIdx(["ws (", "ws"]);

    console.log(`[Seed] Processing ${lines.length - 1} records. Seeding recent 2026 data...`);

    const parseNum = (cols: string[], idx: number) => {
      if (idx === -1 || idx >= cols.length) return null;
      const v = parseFloat(cols[idx]);
      return isNaN(v) ? null : v;
    };

    // Filter to year 2026 or last 5000 records for fast import
    const batch = [];
    for (let i = Math.max(1, lines.length - 5000); i < lines.length; i++) {
      const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
      if (!cols[timeIdx]) continue;
      const ts = new Date(cols[timeIdx]);
      if (isNaN(ts.getTime())) continue;

      batch.push({
        timestamp: ts,
        stationId: "site_301_anand_vihar",
        stationName: "CPCB Anand Vihar, Delhi",
        pm25: parseNum(cols, pm25Idx),
        pm10: parseNum(cols, pm10Idx),
        no: parseNum(cols, noIdx),
        no2: parseNum(cols, no2Idx),
        nox: parseNum(cols, noxIdx),
        nh3: parseNum(cols, nh3Idx),
        so2: parseNum(cols, so2Idx),
        co: parseNum(cols, coIdx),
        ozone: parseNum(cols, ozoneIdx),
        temp: parseNum(cols, tempIdx),
        rh: parseNum(cols, rhIdx),
        ws: parseNum(cols, wsIdx),
        sourceFile: "cpcb_anand_vihar_hourly.csv",
      });
    }

    console.log(`[Seed] Upserting ${batch.length} observations into MongoDB...`);
    for (const doc of batch) {
      await Observation.updateOne(
        { timestamp: doc.timestamp },
        { $set: doc },
        { upsert: true }
      );
    }
    console.log(`[Seed] Successfully seeded ${batch.length} observations!`);

    // Also seed a few initial test predictions from the 2026 test predictions CSV if Prediction collection is empty
    const predCount = await Prediction.countDocuments();
    if (predCount === 0) {
      const testPredCsv = path.resolve(config.researchPath, "final_test_predictions.csv");
      if (fs.existsSync(testPredCsv)) {
        console.log("[Seed] Seeding sample predictions from test dataset...");
        const predLines = fs.readFileSync(testPredCsv, "utf-8").split(/\r?\n/).filter(l => l.trim().length > 0);
        const predBatch = [];
        for (let i = 1; i <= Math.min(25, predLines.length - 1); i++) {
          const cols = predLines[i].split(",").map(c => c.trim());
          const actual = parseFloat(cols[2]);
          const predicted = parseFloat(cols[3]);
          const error = parseFloat(cols[4]);
          const absError = parseFloat(cols[5]);

          predBatch.push({
            predictionId: `seed_2026_${i.toString().padStart(3, "0")}`,
            forecastOriginTimestamp: new Date(cols[0]),
            targetTimestamp: new Date(cols[1]),
            horizonMinutes: 60,
            predictedPM25: Math.round(predicted * 10) / 10,
            actualPM25: Math.round(actual * 10) / 10,
            predictionError: Math.round(error * 10) / 10,
            absoluteError: Math.round(absError * 10) / 10,
            modelIdentifier: "HistGradientBoosting-config3",
            modelVersion: "1.0.0",
            status: "success",
            isInterpolated: false,
            sourcePM25Observed: null,
            featuresSummary: { note: "Historical 2026 verified test prediction" },
            featureCount: 55,
          });
        }
        await Prediction.insertMany(predBatch);
        console.log(`[Seed] Seeded ${predBatch.length} verified historical test predictions into database.`);
      }
    }
  } catch (err: any) {
    console.error("[Seed] Error during seeding:", err.message);
  } finally {
    await disconnectDB();
    console.log("[Seed] Completed.");
  }
}

seed();
