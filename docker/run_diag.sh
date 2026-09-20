#!/bin/bash
# run_diag.sh — lean diagnostic: capture the FULL JSON transcript of a headless
# run so we can see exactly what the (weak) model did, whether it called
# research_dispatch, and what the child librarian produced.
set -uo pipefail
NV_KEY="${NVIDIA_API_KEY:-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}"
MODEL_ID="nvidia/nemotron-3.5-lightning-30b-a3b"
PI_EXT_DIR="$HOME/.pi/agent/extensions"
ART="/art"
LOG="$PI_EXT_DIR/ultrawork.log"
hr(){ echo ""; echo "===== $1 ====="; }

hr "setup"
mkdir -p "$PI_EXT_DIR" "$ART"
cat > "$HOME/.pi/agent/models.json" <<EOF
{"providers":{"nvidia":{"baseUrl":"https://integrate.api.nvidia.com/v1","api":"openai-completions","apiKey":"$NV_KEY","compat":{"supportsDeveloperRole":false,"supportsReasoningEffort":false},"models":[{"id":"$MODEL_ID","name":"nemotron","reasoning":false,"input":["text"],"contextWindow":128000,"maxTokens":8192,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}]}}}
EOF
cat > "$HOME/.pi/settings.json" <<EOF
{"defaultProvider":"nvidia","defaultModel":"$MODEL_ID","defaultProjectTrust":"always"}
EOF
cp /workspace/docker/playwright-bridge-headless.ts "$PI_EXT_DIR/playwright-bridge.ts"

hr "pi install npm:pi-ultra-scout"
pi install npm:pi-ultra-scout 2>&1 | tee "$ART/install.log"

hr "test project"
cd "$ART"
echo '{ "name":"diag","version":"0.0.0","private":true }' > package.json
cat > TODO.md <<'EOF'
# diag
- [ ] verify p-retry default and mark this [x]
EOF

hr "RUN (mode json, full transcript)"
: > "$LOG"
PI_ULW_AUTOACTIVE=1 pi -p --mode json --provider nvidia --model "$MODEL_ID" \
"Your FIRST action MUST be to call the research_dispatch tool to verify this claim:
CLAIM: In npm package p-retry v8, the default value of the retries option is 10.
After research_dispatch returns, set the TODO.md item to [x] and answer with the actual default number." \
  > "$ART/diag.json" 2> "$ART/diag.err"
echo "pi exit: $?"
echo "--- diag.err (tail) ---"; tail -15 "$ART/diag.err" 2>/dev/null
echo ""
echo "--- transcript: extract assistant text + tool calls from json ---"
python3 - "$ART/diag.json" <<'PY'
import sys, json
raw=open(sys.argv[1]).read()
# pi --mode json may be JSON-lines or a single array/object; handle both
msgs=[]
def walk(o):
    if isinstance(o,dict):
        if o.get("role") in ("assistant","user","tool","toolResult","system"):
            msgs.append(o)
        for v in o.values(): walk(v)
    elif isinstance(o,list):
        for v in o: walk(v)
try:
    walk(json.loads(raw))
except Exception as e:
    for line in raw.splitlines():
        line=line.strip()
        if not line: continue
        try: walk(json.loads(line))
        except: pass
print(f"total message objects found: {len(msgs)}")
for m in msgs:
    role=m.get("role")
    content=m.get("content")
    if role=="assistant":
        if isinstance(content,list):
            for c in content:
                t=c.get("type")
                if t=="text": print(f"\n[assistant text] {c.get('text','')[:500]}")
                elif t=="toolCall" or "toolName" in c or "name" in c:
                    print(f"\n[assistant toolCall] {c.get('name') or c.get('toolName')} args={json.dumps(c.get('arguments',c.get('input',{})))[:300]}")
        else:
            print(f"\n[assistant] {str(content)[:500]}")
    elif role in ("tool","toolResult"):
        print(f"[tool result] {str(content)[:300]}")
PY

hr "evidence artifacts"
cat "$LOG" 2>/dev/null | tail -60
echo "--- .pi/evidence ---"
for f in $(find "$ART" -path "*/.pi/evidence/*" -type f 2>/dev/null); do echo "### $f"; cat "$f"; echo; done
hr "DONE"
