#!/usr/bin/env bash
# Re-run cells that were voided by the 2400s cap / router maintenance window.
# Uses the current run_cell.sh (3600s cap). Appends to grid.log.
set -u
cd "$(dirname "$0")"
CELLS=("$@")   # e.g. A-C1 A-C2 B-C0
for CELL in "${CELLS[@]}"; do
  P="${CELL%-*}"; C="${CELL#*-}"
  echo "=== $(date -I) RERUN ${CELL} START ===" | tee -a grid.log
  bash run_cell.sh "$P" "$C" >> grid.log 2>&1
  echo "=== $(date -I) RERUN ${CELL} DONE rc=$? ===" | tee -a grid.log
done
