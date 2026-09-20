#!/usr/bin/env bash
# One ablation cell: reset payload -> headless pi -p run under the condition's env -> snapshot artifacts.
# Usage: run_cell.sh <A|B> <C0|C1|C2> [tag]
# Env overrides: PI_PROV (default llamacpp), PI_MODEL (default qwen3.8-27b)
set -e
P="$1"; COND="$2"; TAG="${3:-}"
[ -n "$P" ] && [ -n "$COND" ] || { echo "usage: run_cell.sh <A|B> <C0|C1|C2> [tag]"; exit 2; }
PROV="${PI_PROV:-llamacpp}"; MODEL="${PI_MODEL:-qwen3.8-27b}"
ROOT="C:/Users/brutc/.pi/agent/prj-ultrawork-paper-publish"
case "$P" in
  A) DIR="C:/Users/brutc/ulw-paper-payload";;
  B) DIR="C:/Users/brutc/ulw-paper-payload-b";;
  *) echo "bad payload $P"; exit 2;;
esac
TS=$(date +%Y%m%d-%H%M%S)
ID="${P}-${COND}${TAG:+-$TAG}-${TS}"
SNAP="$ROOT/experiments/runs/$ID"
mkdir -p "$SNAP"
cd "$DIR"
bash reset.sh
LOGF="C:/Users/brutc/.pi/agent/extensions/ultrawork.log"
LOGSTART=$(wc -l < "$LOGF" 2>/dev/null || echo 0)
case "$P" in
  A) SESSDIR="/c/Users/brutc/.pi/agent/sessions/--C--Users-brutc-ulw-paper-payload--";;
  B) SESSDIR="/c/Users/brutc/.pi/agent/sessions/--C--Users-brutc-ulw-paper-payload-b--";;
esac
PROMPT='Read TODO.md in the current directory and complete every task in it. When every box is checked and tests pass, finish with a short final summary.'
case "$COND" in
  C0) export PI_ULW_OFF=1; unset PI_ULW_AUTOACTIVE PI_ULW_NO_DISPATCH;;
  C1) export PI_ULW_AUTOACTIVE=1 PI_ULW_NO_DISPATCH=1; unset PI_ULW_OFF;;
  C2) export PI_ULW_AUTOACTIVE=1; unset PI_ULW_OFF PI_ULW_NO_DISPATCH;;
esac
START=$(date +%s)
RC=0
timeout --kill-after 60 6600 pi -p --provider "$PROV" --model "$MODEL" "$PROMPT" > "$SNAP/run.log" 2>&1 || RC=$?
END=$(date +%s)
# snapshot core artifacts IMMEDIATELY after pi exits (before bun test can fail/hang)
snapshot_payload() {
  { cp -r src "$SNAP/" 2>/dev/null || true; cp -r test "$SNAP/" 2>/dev/null || true; cp TODO.md "$SNAP/" 2>/dev/null || true; cp package.json "$SNAP/" 2>/dev/null || true; }
  if [ -d .pi ]; then cp -r .pi "$SNAP/dot-pi" 2>/dev/null || true; fi
  if [ -d "$SESSDIR" ]; then
    NEWEST=$(ls -t "$SESSDIR"/*.jsonl 2>/dev/null | head -1 || true)
    if [ -n "$NEWEST" ]; then cp "$NEWEST" "$SNAP/session.jsonl" 2>/dev/null && echo "session: $NEWEST"; fi
  fi
}
snapshot_payload
RC_BT=0
timeout 180 bun test > "$SNAP/bun-test.txt" 2>&1 || RC_BT=$?
snapshot_payload
tail -n +$((LOGSTART+1)) "$LOGF" > "$SNAP/ulw.log" 2>/dev/null || true
printf "rc=%s bun_test_rc=%s start=%s end=%s dur=%ss provider=%s model=%s\n" "$RC" "$RC_BT" "$START" "$END" "$((END-START))" "$PROV" "$MODEL" | tee "$SNAP/timing.txt"
echo "DONE $ID"
