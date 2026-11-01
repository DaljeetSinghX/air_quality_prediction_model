import mongoose, { Document, Schema } from "mongoose";

export interface IObservation extends Document {
  timestamp: Date;
  stationId: string;
  stationName: string;
  pm25?: number | null;
  pm10?: number | null;
  no?: number | null;
  no2?: number | null;
  nox?: number | null;
  nh3?: number | null;
  so2?: number | null;
  co?: number | null;
  ozone?: number | null;
  benzene?: number | null;
  toluene?: number | null;
  temp?: number | null;
  rh?: number | null;
  ws?: number | null;
  wd?: number | null;
  sr?: number | null;
  bp?: number | null;
  sourceFile?: string;
}

const ObservationSchema = new Schema<IObservation>(
  {
    timestamp: { type: Date, required: true, unique: true, index: true },
    stationId: { type: String, required: true, default: "site_301_anand_vihar", index: true },
    stationName: { type: String, required: true, default: "CPCB Anand Vihar, Delhi" },
    pm25: { type: Number, default: null },
    pm10: { type: Number, default: null },
    no: { type: Number, default: null },
    no2: { type: Number, default: null },
    nox: { type: Number, default: null },
    nh3: { type: Number, default: null },
    so2: { type: Number, default: null },
    co: { type: Number, default: null },
    ozone: { type: Number, default: null },
    benzene: { type: Number, default: null },
    toluene: { type: Number, default: null },
    temp: { type: Number, default: null },
    rh: { type: Number, default: null },
    ws: { type: Number, default: null },
    wd: { type: Number, default: null },
    sr: { type: Number, default: null },
    bp: { type: Number, default: null },
    sourceFile: { type: String, default: "cpcb_anand_vihar_hourly.csv" },
  },
  { timestamps: true }
);

ObservationSchema.index({ timestamp: -1 });

export const Observation = mongoose.model<IObservation>("Observation", ObservationSchema);
