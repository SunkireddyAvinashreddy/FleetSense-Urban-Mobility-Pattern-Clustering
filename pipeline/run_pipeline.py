"""Run the full FleetSense pipeline: generate -> preprocess -> train."""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

for step in ["generate_data.py", "preprocess.py", "train.py"]:
    print(f"\n=== {step} ===")
    r = subprocess.run([sys.executable, os.path.join(HERE, step)])
    if r.returncode != 0:
        raise SystemExit(f"{step} failed")

print("\nPipeline complete. Models in models/, artifacts in data/artifacts/.")
