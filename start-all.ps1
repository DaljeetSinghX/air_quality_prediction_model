# ====================================================================
# AeroCast ML — Windows PowerShell Multi-Service Launcher
# Launches Python ML API, Node/Express Backend, and Vite React Frontend
# ====================================================================

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " Starting AeroCast ML Full-Stack Application...     " -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan

$ROOT_DIR = Get-Location

# 1. Start Python FastAPI ML Service
Write-Host "`n[1/3] Starting Python ML Inference Service (Port 8000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT_DIR'; Write-Host 'Starting ML API...' -ForegroundColor Cyan; python -m uvicorn app:app --app-dir ml-service --host 127.0.0.1 --port 8000 --reload"

Start-Sleep -Seconds 3

# 2. Start Express Backend
Write-Host "[2/3] Starting Node/Express Backend API (Port 5000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT_DIR\server'; Write-Host 'Starting Express Server...' -ForegroundColor Cyan; npm run dev"

Start-Sleep -Seconds 2

# 3. Start Vite React Frontend
Write-Host "[3/3] Starting Vite React Dashboard (Port 5173)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT_DIR\client'; Write-Host 'Starting Vite Frontend...' -ForegroundColor Cyan; npm run dev"

Write-Host "`n=====================================================" -ForegroundColor Green
Write-Host " All services have been launched in separate shells: " -ForegroundColor Green
Write-Host "  • ML Service: http://127.0.0.1:8000/docs           " -ForegroundColor Green
Write-Host "  • Backend API: http://localhost:5000/api/health     " -ForegroundColor Green
Write-Host "  • Frontend UI: http://localhost:5173                " -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
