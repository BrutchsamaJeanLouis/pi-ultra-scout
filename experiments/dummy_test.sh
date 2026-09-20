#!/usr/bin/env bash
# Dummy-proof test: weak models WITH (C2) vs WITHOUT (C0) the ulw mechanism.
# Payload A (p-retry trap). Sequential. Each cell fully reset + snapshotted by run_cell.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
R="${ROOT}/experiments"
L="${R}/grid.log"

run() { # prov model tag cond
  local prov="$1" model="$2" tag="$3" cond="$4"
  echo "=== $(date '+%Y-%m-%d %H:%M') DUMMY $tag-$cond START ($model) ===" | tee -a "$L"
  PI_PROV="$prov" PI_MODEL="$model" bash "$R/run_cell.sh" A "$cond" "$tag" >> "$L" 2>&1
  echo "=== $(date '+%Y-%m-%d %H:%M') DUMMY $tag-$cond DONE rc=$? ===" | tee -a "$L"
}

# nemotron-3.5-lightning-30b-a3b (3B active, nvidia provider)
run nvidia nvidia/nemotron-3.5-lightning-30b-a3b nemo C0
run nvidia nvidia/nemotron-3.5-lightning-30b-a3b nemo C2
# local qwen3.5-4b
run llamacpp qwen3.5-4b 4b C0
run llamacpp qwen3.5-4b 4b C2

echo "=== $(date '+%Y-%m-%d %H:%M') DUMMY GRID COMPLETE ===" | tee -a "$L"