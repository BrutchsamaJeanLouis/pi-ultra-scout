#!/usr/bin/env bash
# Reps for the dummy-proof test: 2 full loops on top of the first grid (n=3 per model x cond).
# Payload A. Sequential (shared payload dir).
set -u
R=/c/Users/brutc/.pi/agent/prj-ultrawork-paper-publish/experiments
L=/c/Users/brutc/.pi/agent/prj-ultrawork-paper-publish/experiments/grid.log

for REP in 2 3; do
  PI_PROV=nvidia PI_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b bash "$R/run_cell.sh" A C0 nemo >> "$L" 2>&1
  PI_PROV=nvidia PI_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b bash "$R/run_cell.sh" A C2 nemo >> "$L" 2>&1
  PI_PROV=llamacpp PI_MODEL=qwen3.5-4b bash "$R/run_cell.sh" A C0 4b >> "$L" 2>&1
  PI_PROV=llamacpp PI_MODEL=qwen3.5-4b bash "$R/run_cell.sh" A C2 4b >> "$L" 2>&1
done

echo "=== $(date '+%Y-%m-%d %H:%M') DUMMY REPS COMPLETE (n=3 per cell) ===" | tee -a "$L"
