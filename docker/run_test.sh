#!/bin/bash
# run_test.sh — the "normal pi extension install + use it" test.
# Runs inside the clean container. Mirrors what a real user does:
#   1. configure the model (NVIDIA nemotron)
#   2. `pi install pi-ultra-scout`  (NORMAL npm install, not local source)
#   3. run pi headless on a task with a TRUST-SHAPE claim -> triggers research_dispatch
#   4. research_dispatch spawns a fresh `pi -p` librarian that browses LIVE docs
#      (headless Chromium via @playwright/mcp) and writes an evidence artifact
# Then dumps all the evidence so we can find bugs.
#
# Output artifacts land in /art (a mounted volume) so the host can inspect them.
set -uo pipefail

NV_KEY="${NVIDIA_API_KEY:-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}"
MODEL_ID="nvidia/nemotron-3.5-lightning-30b-a3b"
PI_EXT_DIR="$HOME/.pi/agent/extensions"
ART="/art"
LOG="$PI_EXT_DIR/ultrawork.log"

hr(){ echo ""; echo "=================================================="; echo "  $1"; echo "=================================================="; }

hr "STEP 0: toolchain"
echo "bun:  $(bun --version 2>&1)"
echo "node: $(node --version 2>&1)"
echo "pi:   $(pi --version 2>&1)"
echo "npm:  $(npm --version 2>&1)"
mkdir -p "$ART"

hr "STEP 1: configure NVIDIA model"
mkdir -p "$PI_EXT_DIR"
cat > "$HOME/.pi/agent/models.json" <<EOF
{
  "providers": {
    "nvidia": {
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "api": "openai-completions",
      "apiKey": "$NV_KEY",
      "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false },
      "models": [
        {
          "id": "$MODEL_ID",
          "name": "nemotron-3.5-lightning-30b-a3b",
          "reasoning": false,
          "input": ["text"],
          "contextWindow": 128000,
          "maxTokens": 8192,
          "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }
        }
      ]
    }
  }
}
EOF
cat > "$HOME/.pi/settings.json" <<EOF
{
  "defaultProvider": "nvidia",
  "defaultModel": "$MODEL_ID",
  "defaultProjectTrust": "always"
}
EOF
echo "models.json + settings.json written"
cat "$HOME/.pi/settings.json"

hr "STEP 2: install headless playwright-bridge (browser backend for the child)"
cp /workspace/docker/playwright-bridge-headless.ts "$PI_EXT_DIR/playwright-bridge.ts"
echo "installed playwright-bridge (headless) into $PI_EXT_DIR"

hr "STEP 3: pi install npm:pi-ultra-scout  (NORMAL npm install)"
pi install npm:pi-ultra-scout 2>&1 | tee "$ART/install.log"
echo "--- install exit: $? ---"
echo "--- where did pi install put it? ---"
find "$HOME/.pi" -maxdepth 4 -iname "*ultrawork*" -o -maxdepth 4 -iname "*pi-ultra-scout*" 2>/dev/null | head
ls -la "$PI_EXT_DIR" 2>/dev/null | head
npm root -g 2>/dev/null && ls "$(npm root -g)" 2>/dev/null | grep -i "ultra\|scout" | head

hr "STEP 4: verify extension loads + tools register (headless probe)"
: > "$LOG"
pi -p --provider nvidia --model "$MODEL_ID" "List the exact names of all tools you can call, one per line. No other text." 2>&1 | tee "$ART/tools_probe.log" | tail -30
echo "--- extension LOAD lines from log ---"
grep -E "LOAD|tool|SKIPPED|active=" "$LOG" 2>/dev/null | head -30

hr "STEP 5: create test project"
cd "$ART"
cat > package.json <<'EOF'
{ "name": "clean-env-test", "version": "0.0.0", "private": true }
EOF
cat > TODO.md <<'EOF'
# clean env test
- [ ] verify p-retry default
EOF
echo "test project at $ART"

hr "STEP 6: RUN the real task (trust-shape claim -> research_dispatch)"
: > "$LOG"
PI_ULW_AUTOACTIVE=1 pi -p --provider nvidia --model "$MODEL_ID" \
"TASK: Verify this claim against LIVE sources before answering (this is a numeric default, a trust shape).
CLAIM: In the npm package p-retry version 8, the default value of the retries option is 10.
Use the research_dispatch tool so a librarian browses the live p-retry docs/source and returns evidence.
Then, on the LAST line, answer exactly in this format:
RESULT: VERIFIED or REFUTED — actual default: <number>" \
  2>&1 | tee "$ART/pi_run.log" | tail -40

hr "STEP 7: evidence artifacts"
echo "--- ultrawork.log ---"
cat "$LOG" 2>/dev/null | tail -80
echo ""
echo "--- .pi/evidence artifacts ---"
find "$ART" -path "*/.pi/evidence/*" -type f 2>/dev/null
for f in $(find "$ART" -path "*/.pi/evidence/*" -type f 2>/dev/null); do
  echo "### $f"
  cat "$f" 2>/dev/null
  echo ""
done

hr "DONE"
echo "Artifacts in $ART (mounted to host docker/artifacts/):"
ls -la "$ART"
echo "exit 0"
