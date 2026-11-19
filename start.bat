@echo off
cd /d "%~dp0"
if not exist "models\kmeans.pkl" (
  echo Training models, first run...
  python pipeline\run_pipeline.py
)
if not exist "frontend\dist\index.html" (
  echo Building dashboard...
  pushd frontend
  call npm install
  call npm run build
  popd
)
echo FleetSense running at http://127.0.0.1:8000
python run.py
