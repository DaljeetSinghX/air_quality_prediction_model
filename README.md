# AeroCast — Air Quality Prediction Platform

Real-time PM2.5 air quality prediction for **CPCB Anand Vihar (Station 301), New Delhi**, powered by Machine Learning.

---

## 🚀 How to Start the Project

### Option 1: One-Click Start (Recommended)

Run this single command in **PowerShell** from the project root:

```powershell
.\start-all.ps1
```

> **Note:** If PowerShell blocks script execution, run this first:  
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

This automatically starts all 3 services in separate windows:
* 🌐 **Frontend UI:** [http://localhost:5173](http://localhost:5173)
* ⚙️ **Backend API:** [http://localhost:5000/api/health](http://localhost:5000/api/health)
* 🧠 **ML Service:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

---

### Option 2: Manual Start (3 Terminals)

If you prefer running services individually:

#### Terminal 1 — Python ML Service:
```powershell
python -m uvicorn app:app --app-dir ml-service --host 127.0.0.1 --port 8000 --reload
```

#### Terminal 2 — Node.js Backend:
```powershell
cd server
npm run dev
```

#### Terminal 3 — React Frontend:
```powershell
cd client
npm run dev
```

Open **[http://localhost:5173](http://localhost:5173)** in your browser.

---

## 🛠️ First-Time Installation

If you are setting up the project for the first time:

1. **Python Dependencies:**
   ```powershell
   python -m pip install -r ml-service/requirements.txt
   ```

2. **Backend Dependencies:**
   ```powershell
   cd server
   npm install
   cd ..
   ```

3. **Frontend Dependencies:**
   ```powershell
   cd client
   npm install
   cd ..
   ```

4. **Environment File:**
   ```powershell
   Copy-Item .env.example .env
   Copy-Item .env.example server\.env
   ```

---

## 📊 Interface Tabs

* **Tab 1 — Live Forecast:**
  * **Left Side:** Select forecast horizon (**1hr, 2hr, 6hr, 12hr, or 24hr**) and update button.
  * **Center:** Real-time trajectory graph extending from current time to the predicted time.
  * **Right Side:** Prediction summary card (Current PM2.5, Target PM2.5, Expected Change $\pm\mu\text{g/m}^3$, Target Time, and MySQL Synced indicator).

* **Tab 2 — Saved Predictions (MySQL):**
  * Fetches previously stored predictions directly from the MySQL database (`air_prediction_db.predictions`).
  * Shows Prediction ID, Horizon, Forecast Origin Time, Target Arrival Time, Predicted PM2.5, AQI Category, Model, and Saved timestamp.
  * Features live horizon filtering (All, 1h, 2h, 6h, 12h, 24h), search box, and one-click **CSV export**.

---

## 🧩 Tech Stack

* **Frontend:** React, TypeScript, Vite, Tailwind CSS, Recharts
* **Backend:** Node.js, Express, MySQL (`air_prediction_db`)
* **Database:** MySQL 8.0 (Host: `localhost:3306`, User: `root`, DB: `air_prediction_db`)
* **ML Service:** Python, FastAPI, Scikit-learn (HistGradientBoosting & ExtraTrees)
* **Dataset:** CPCB Anand Vihar CAAQMS Hourly Air Quality Archive
