#!/bin/bash
# Mechanical forensics for ultrawork deep analysis
set -uo pipefail
OUT=/c/Users/brutc/.pi/agent/extensions/ulw-analysis
EXT=/c/Users/brutc/.pi/agent/extensions
mkdir -p "$OUT"
{
echo "=== 1. FILE INVENTORY ==="
ls -la "$EXT" | grep -i ultra
echo
echo "=== 2. LINE COUNTS / SIZES ==="
wc -l "$EXT/ultrawork.ts" "$EXT/ultrawork.ts.bak" "$EXT/ultrawork.ts.bak-0.73" \
      "$EXT"/ultrawork/*.ts "$EXT"/ultrawork.bak/*.ts 2>/dev/null
echo
echo "=== 3. DIFF: ultrawork.ts.bak-0.73 -> ultrawork.ts.bak ==="
diff -u "$EXT/ultrawork.ts.bak-0.73" "$EXT/ultrawork.ts.bak" | head -400
echo
echo "=== 4. DIFF: ultrawork.ts.bak -> ultrawork.ts (current) ==="
diff -u "$EXT/ultrawork.ts.bak" "$EXT/ultrawork.ts" | head -600
echo
echo "=== 5. MODULE DIFFS: ultrawork.bak -> ultrawork ==="
for f in epistemic_protocol evidence_state logger research_loop; do
  echo "----- $f.ts -----"
  diff -u "$EXT/ultrawork.bak/$f.ts" "$EXT/ultrawork/$f.ts" | head -200
  echo
done
echo "=== 6. LOG FORENSICS: ultrawork.log ==="
if [ -f "$EXT/ultrawork.log" ]; then
  wc -l "$EXT/ultrawork.log"
  echo "--- first 40 lines ---"
  head -40 "$EXT/ultrawork.log"
  echo "--- last 120 lines ---"
  tail -120 "$EXT/ultrawork.log"
  echo "--- event-type histogram (2nd field) ---"
  awk '{print $2}' "$EXT/ultrawork.log" | sort | uniq -c | sort -rn | head -40
  echo "--- distinct phases/tags ---"
  grep -oE '\[(LOAD|TRIGGER|RESEARCH|CLAIM|ANSWER|COMPACT|REGROUND|RETRIGGER|ABORT|ERROR|TIMEOUT|SKIP)[A-Z_]*\]' "$EXT/ultrawork.log" | sort | uniq -c | sort -rn | head -40
fi
echo
echo "=== 7. SMOKE TEST ==="
wc -l /c/Users/brutc/.pi/agent/smoke_test.ts
grep -n -i "ultra" /c/Users/brutc/.pi/agent/smoke_test.ts | head -40
echo
echo "=== 8. CHANGELOG HEAD ==="
head -80 "$EXT/ultrawork-changelog.md"
echo
echo "=== 9. OLD LAST WORKING STATE ==="
cat "$EXT/ultrawork-OldLastWorkingState.txt"
echo
echo "=== 10. ROADMAP HEAD ==="
head -100 "$EXT/ultrawork-roadmap.txt"
echo
echo "=== 11. IMPORT/DEP MAP of current ultrawork.ts ==="
grep -n "^import\|require(" "$EXT/ultrawork.ts"
echo
echo "=== 12. SESSIONS USING ultrawork (counts per project) ==="
ls -d /c/Users/brutc/.pi/agent/sessions/*/ | head -20
echo
echo "DONE $(date)"
} > "$OUT/forensics.txt" 2>&1
echo "exit=$?"
