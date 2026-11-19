#!/usr/bin/env bash
# FleetSense launcher: builds the UI if needed, trains if needed, then serves both.
set -e
cd "$(dirname "$0")"

if [ ! -f models/kmeans.pkl ]; then
  echo "Training models (first run)…"
  python pipeline/run_pipeline.py
fi

if [ ! -f frontend/dist/index.html ]; then
  echo "Building dashboard…"
  (cd frontend && npm install && npm run build)
fi

echo "FleetSense running at http://127.0.0.1:${PORT:-8000}"
python run.py
