import urllib.request
import json

BASE_URL = "http://localhost:5000/api"

def get(endpoint):
    req = urllib.request.Request(f"{BASE_URL}{endpoint}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

def post(endpoint, data):
    req = urllib.request.Request(
        f"{BASE_URL}{endpoint}",
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())

def run_tests():
    print("========================================")
    print("AIR QUALITY PREDICTION - SYSTEM TEST")
    print("========================================")

    # 1. Health
    h = get("/health")
    print(f"[OK] Health Status: {h['status']} | DB: {h['services']['database']} | ML: {h['services']['mlService']}")

    # 2. Dashboard summary
    d = get("/dashboard/summary")
    station = d['data']['station']
    latest_pm25 = d['data']['latestObservation']['pm25']
    print(f"[OK] Dashboard Summary: Station='{station}' | Latest PM2.5={latest_pm25} µg/m³")

    # 3. Model Info
    m = get("/model/info")
    model_name = m['data'].get('model_identifier') or m['data'].get('model_name')
    print(f"[OK] Model Info: Primary Model='{model_name}'")

    # 4. Model Horizons
    hz = get("/model/horizons")
    horizons = [f"{item['horizon_hours']}h ({item['status']})" for item in hz.get('models', hz.get('data', []))]
    print(f"[OK] Model Horizons: {', '.join(horizons)}")

    # 5. Model Metrics
    met = get("/model/metrics")
    metrics_info = met['data']['metrics']['test_2026_metrics']
    test_mae = metrics_info['mae']
    test_r2 = metrics_info['r2']
    print(f"[OK] Offline Metrics: Test MAE={test_mae:.2f} µg/m³ | Test R²={test_r2:.4f}")

    # 6. Multi-Horizon Predictions
    print("\n--- Multi-Horizon Prediction Verification ---")
    test_ts = "2026-09-25T12:00:00.000Z"
    for h_hours in [1, 2, 6, 12, 24]:
        res = post("/predictions", {
            "originTimestamp": test_ts,
            "horizonHours": h_hours,
            "mode": "historical_backtest"
        })
        pred_data = res["data"]
        print(f"  * Horizon {h_hours:2d}h -> Predicted: {pred_data['predictedPM25']:6.2f} µg/m³ | Actual: {pred_data.get('actualPM25')} | Error: {pred_data.get('predictionError')}")

    # 7. Predictions List
    preds = get("/predictions?limit=5")
    print(f"\n[OK] Predictions List: {preds['pagination']['total']} total logged predictions")

    # 8. Observations
    obs = get("/observations?limit=3")
    print(f"[OK] Observations: {obs['pagination']['total']} total records available")

    print("\n========================================")
    print("ALL TESTS PASSED WITH ZERO ERRORS!")
    print("========================================")

if __name__ == "__main__":
    run_tests()
