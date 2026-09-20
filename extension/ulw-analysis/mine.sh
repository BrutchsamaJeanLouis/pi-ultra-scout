#!/bin/bash
# Deep log mining for ultrawork base rates
set -uo pipefail
LOG=/c/Users/brutc/.pi/agent/extensions/ultrawork.log
OUT=/c/Users/brutc/.pi/agent/extensions/ulw-analysis
{
echo "=== A. ACTIVATION BASE RATES ==="
echo "sessions (SESSION_START): $(grep -c 'SESSION_START' "$LOG")"
echo "CMD lines:"; grep '\[CMD\]' "$LOG" | grep -oE '/ulw[a-z-]*' | sort | uniq -c
echo "prompt injections: $(grep -c 'injecting completion contract' "$LOG")"
echo "inactive sessions (no /ulw): $(grep -c 'inactive' "$LOG")"
echo
echo "=== B. LIBRARIAN (LIB) OUTCOMES ==="
echo "LIB total: $(grep -c '\[LIB\]' "$LOG")"
echo "callLibrarian START: $(grep -c 'callLibrarian START' "$LOG")"
echo "NUDGE delivered: $(grep -c 'NUDGE delivered' "$LOG")"
echo "SKIPPED (already running): $(grep -c 'SKIPPED: already running' "$LOG")"
echo "SKIPPED (nothing to audit): $(grep -c 'SKIPPED: nothing to audit' "$LOG")"
echo "EMPTY response: $(grep -c 'EMPTY response from router' "$LOG")"
echo "LIB ERROR: $(grep -c '\[LIB\] ERROR' "$LOG")"
echo "reasons:"; grep -oE 'reason="[^"]*"' "$LOG" | sort | uniq -c | sort -rn | head
echo "--- latency samples (ms) ---"
grep -oE 'router response \([0-9]+ms\)' "$LOG" | grep -oE '[0-9]+' | sort -n | awk '{a[NR]=$1} END {print "n="NR" min="a[1]" p50="a[int(NR*0.5)]" p90="a[int(NR*0.9)]" max="a[NR]}'
echo "--- 'nothing to reground' rate among delivered nudges ---"
N=$(grep -c 'NUDGE delivered' "$LOG"); NR=$(grep 'NUDGE delivered' "$LOG" | grep -c 'nothing to reground'); echo "delivered=$N, nothing-to-reground=$NR"
echo
echo "=== C. TRIGGER MECHANICS ==="
echo "autoTrigger=true: $(grep -c 'autoTrigger=true' "$LOG")"
echo "autoTrigger=false: $(grep -c 'autoTrigger=false' "$LOG")"
echo "prune flush baseline resets: $(grep -c 'context drop' "$LOG")"
echo "compacts: $(grep -c 'COMPACT.*session_compact fired' "$LOG")"
echo "max token count seen: $(grep -oE 'tokens=[0-9]+' "$LOG" | grep -oE '[0-9]+' | sort -n | tail -1)"
echo "sessions where tokens ever >= 80000: $(awk '/tokens=/ {match($0, /tokens=([0-9]+)/, m); if (m[1]+0 >= 80000) {print NR; exit}}' "$LOG" | head -1 | wc -l)"
echo "last 5 lines with tokens=:"; grep 'tokens=' "$LOG" | tail -5 | cut -c1-160
echo
echo "=== D. LOOP GUARD ==="
echo "agent_end fired: $(grep -c 'agent_end fired' "$LOG")"
echo "loop guard tripped: $(grep -c 'LOOP GUARD TRIPPED' "$LOG")"
echo "loop guard skipped (no TODO.md): $(grep -c 'no TODO.md found' "$LOG")"
echo
echo "=== E. EVIDENCE / RESEARCH USAGE ==="
echo "TOOL lines: $(grep -c '\[TOOL\]' "$LOG")"
grep '\[TOOL\]' "$LOG" | grep -oE 'evidence_register|evidence_add|evidence_check|research_loop|reground_check' | sort | uniq -c
echo "RESEARCH lines:"; grep '\[RESEARCH\]' "$LOG" | cut -c1-200
echo
echo "=== F. ERRORS / ABORTS / RETRIES ==="
grep -cE 'AbortError|abort' "$LOG" || true
grep -iE '\[LIB\] ERROR' "$LOG" | cut -c1-180 | sort | uniq -c | sort -rn | head -15
echo
echo "=== G. SESSION SPAN / RECENCY ==="
head -1 "$LOG" | cut -c1-24
tail -1 "$LOG" | cut -c1-24
grep '\[SESSION_START\]' "$LOG" | cut -c1-10 | sort | uniq -c | tail -8
echo
echo "=== H. NUDGE CONTENT SAMPLE (delivered, non-trivial) ==="
grep 'NUDGE delivered' "$LOG" | grep -v 'nothing to reground' | tail -12 | cut -c1-250
echo
echo "DONE $(date)"
} > "$OUT/logmining.txt" 2>&1
echo exit=$?
