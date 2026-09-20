#!/usr/bin/env bash
# Sequential ablation grid: 2 payloads x 3 conditions. ONE 27B in VRAM -> strictly sequential.
set -u
ROOT="C:/Users/brutc/.pi/agent/prj-ultrawork-paper-publish"
MASTER="$ROOT/experiments/grid.log"
: > "$MASTER"
for P in A B; do
  for C in C0 C1 C2; do
    echo "=== $(date -I) CELL ${P}-${C} START ===" >> "$MASTER"
    bash "$ROOT/experiments/run_cell.sh" "$P" "$C" >> "$MASTER" 2>&1
    echo "=== $(date -I) CELL ${P}-${C} DONE rc=$? ===" >> "$MASTER"
  done
done
echo "GRID COMPLETE $(date -I)" >> "$MASTER"
