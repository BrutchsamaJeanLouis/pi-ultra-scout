#!/usr/bin/env bash
# One ablation cell: reset payload -> headless pi -p run under the condition's env -> snapshot artifacts.
# Usage: run_cell.sh <A|B> <C0|C1|C2> [tag]
# Env overrides: PI_PROV (default llamacpp), PI_MODEL (default qwen3.8-27b), ROOT_DIR (default: repo root)
set -euo pipefail

P="$1"; COND="$2"; TAG="${3:-}"
[ -n "$P" ] && [ -n "$COND" ] || { echo "usage: run_cell.sh <A|B> <C0|C1|C2> [tag]"; exit 2; }

PROV="${PI_PROV:-llamacpp}"; MODEL="${PI_MODEL:-qwen3.8-27b}"

# Resolve root directory (default to repo root if not set)
ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
case "$P" in
  A) PAYLOAD_DIR="${ROOT}/experiments/payload-a";;
  B) PAYLOAD_DIR="${ROOT}/experiments/payload-b";;
  *) echo "bad payload $P"; exit 2;;
esac

TS=$(date +%Y%m%d-%H%M%S)
ID="${P}-${COND}${TAG:+-$TAG}-${TS}"
SNAP="${ROOT}/experiments/runs/${ID}"
mkdir -p "${SNAP}"

cd "${PAYLOAD_DIR}"
bash reset.sh

# Determine session directory based on pi's session naming convention
SESSDIR_A="${HOME}/.pi/agent/sessions/--C--Users-${USER:-brutc}-ulw-paper-payload--"
SESSDIR_B="${HOME}/.pi/agent/sessions/--C--Users-${USER:-brutc}-ulw-paper-payload-b--"
LOGF="${HOME}/.pi/agent/extensions/ultrawork.log"
LOGSTART=$(wc -l < "${LOGF}" 2>/dev/null || echo 0)

case "$P" in
  A) SESSDIR="${SESSDIR_A}";;
  B) SESSDIR="${SESSDIR_B}";;
esac

PROMPT='Read TODO.md in the current directory and complete every task in it. When every box is checked and tests pass, finish with a short final summary.'

case "$COND" in
  C0) export PI_ULW_OFF=1; unset PI_ULW_AUTOACTIVE PI_ULW_NO_DISPATCH;;
  C1) export PI_ULW_AUTOACTIVE=1 PI_ULW_NO_DISPATCH=1; unset PI_ULW_OFF;;
  C2) export PI_ULW_AUTOACTIVE=1; unset PI_ULW_OFF PI_ULW_NO_DISPATCH;;
esac

START=$(date +%s)
RC=0
timeout --kill-after 60 6600 pi -p --provider "${PROV}" --model "${MODEL}" "$PROMPT" > "${SNAP}/run.log" 2>&1 || RC=$?
END=$(date +%s)

# Snapshot core artifacts IMMEDIATELY after pi exits (before bun test can fail/hang)
SNAP_DIR="${SNAP}"
snapshot_payload() {
  cp -r src "${SNAP_DIR}/" 2>/dev/null || true
  cp -r test "${SNAP_DIR}/" 2>/dev/null || true
  cp TODO.md "${SNAP_DIR}/" 2>/dev/null || true
  cp package.json "${SNAP_DIR}/" 2>/dev/null || true
  if [ -d .pi ]; then cp -r .pi "${SNAP_DIR}/dot-pi" 2>/dev/null || true; fi
  if [ -d "${SESSDIR}" ]; then
    NEWEST=$(ls -t "${SESSDIR}"/*.jsonl 2>/dev/null | head -1 || true)
    if [ -n "${NEWEST}" ]; then cp "${NEWEST}" "${SNAP_DIR}/session.jsonl" 2>/dev/null && echo "session: ${NEWEST}"; fi
  fi
}
snapshot_payload

RC_BT=0
timeout 180 bun test > "${SNAP_DIR}/bun-test.txt" 2>&1 || RC_BT=$?
snapshot_payload

tail -n +$((LOGSTART+1)) "${LOGF}" > "${SNAP_DIR}/ulw.log" 2>/dev/null || true

printf "rc=%s bun_test_rc=%s start=%s end=%s dur=%ss provider=%s model=%s\n" "${RC}" "${RC_BT}" "${START}" "${END}" "$((END-START))" "${PROV}" "${MODEL}" | tee "${SNAP_DIR}/timing.txt"
echo "DONE ${ID}"