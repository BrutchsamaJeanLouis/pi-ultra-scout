#!/usr/bin/env bash
# Full replication grid, strictly sequential (1 model at a time), pruner off.
# Phase 1: 3 rounds x {nemo-C0, nemo-C2, 4b-C0, 4b-C2}  (dummy-proof test)
# Phase 2: 2 rounds x {A-C0,C1,C2 + B-C0,C1,C2} on qwen3.8-27b (main grid)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
R="${ROOT}/experiments"
L="${R}/grid.log"
NEMO="nvidia/nemotron-3.5-lightning-30b-a3b"

cell() { # prov model payload cond [tag]
  PI_PROV="$1" PI_MODEL="$2" bash "${R}/run_cell.sh" "$3" "$4" "${5:-}" >> "${L}" 2>&1
  echo "=== $(date '+%H:%M') CELL $3-$4${5:+-$5} done rc=$? ===" | tee -a "${L}"
}

echo "=== $(date '+%F %H:%M') REPS START ===" | tee -a "${L}"

for REP in 2 3 4; do
  echo "=== $(date '+%F %H:%M') REPS round $REP (dummy) ===" | tee -a "${L}"
  cell nvidia "$NEMO" A C0 nemo
  cell nvidia "$NEMO" A C2 nemo
  cell llamacpp qwen3.5-4b A C0 4b
  cell llamacpp qwen3.5-4b A C2 4b
done

for REP in 2 3; do
  echo "=== $(date '+%F %H:%M') REPS round $REP (27b grid) ===" | tee -a "${L}"
  cell llamacpp qwen3.8-27b A C0
  cell llamacpp qwen3.8-27b A C1
  cell llamacpp qwen3.8-27b A C2
  cell llamacpp qwen3.8-27b B C0
  cell llamacpp qwen3.8-27b B C1
  cell llamacpp qwen3.8-27b B C2
done

echo "=== $(date '+%F %H:%M') REPS COMPLETE ===" | tee -a "${L}"