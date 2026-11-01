import dotenv from "dotenv";
import path from "path";

// Load .env from server or root
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

export const config = {
  port: parseInt(process.env.PORT || "5000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/air_prediction",
  mlServiceUrl: process.env.ML_SERVICE_URL || "http://127.0.0.1:8000",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  dataPath: path.resolve(process.cwd(), "../data"),
  researchPath: path.resolve(process.cwd(), "../final_experiments"),

  mysql: {
    host: process.env.MYSQL_HOST || "localhost",
    port: parseInt(process.env.MYSQL_PORT || "3306", 10),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "daljeet",
    database: process.env.MYSQL_DATABASE || "air_prediction_db",
  },
};
