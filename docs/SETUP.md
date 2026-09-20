# Detailed Setup Guide (from scratch)

This guide walks through setting up the entire ultrawork reproducible environment on a **fresh Windows machine** with no prior dependencies.

---

## 1. System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Windows 10/11 (64-bit) | Windows 11 Pro |
| RAM | 16 GB | 32+ GB (for 27B in VRAM) |
| GPU VRAM | 8 GB | 12+ GB (27B Q3/XS fits in 8GB; 4B trivial) |
| Disk | 20 GB free | 50+ GB (models + cache) |
| CPU | 4 cores | 8+ cores |

---

## 2. Install Core Dependencies

### 2.1 Bun (JavaScript runtime + package manager)

```powershell
# Run in PowerShell as Administrator
irm bun.sh/install.ps1 | iex
# Or via scoop:
scoop install bun

# Verify
bun --version  # should be >= 1.0.0
```

### 2.2 pi Coding Agent

```powershell
bun add -g @earendil-works/pi-coding-agent

# Verify
pi --version
pi doctor  # checks for common issues
```

### 2.3 llama.cpp Router (local model server)

```powershell
# Option A: Scoop (easiest on Windows)
scoop install llama.cpp

# Option B: Manual download
# 1. Go to https://github.com/ggerganov/llama.cpp/releases
# 2. Download `llama-bin-win64.zip` (or cuda variant if you have NVIDIA GPU)
# 3. Extract to `C:\llama.cpp\`
# 4. Add `C:\llama.cpp\` to your PATH

# Verify
llama-server.exe --version
```

### 2.4 Chrome Browser (for Playwright)

```powershell
# Download from https://www.google.com/chrome/
# Install normally (per-user or system-wide)
# Verify: chrome.exe --version
```

### 2.5 Python 3.11+ (for grading/charts)

```powershell
# Via scoop:
scoop install python

# Or from python.org
# Verify
python --version  # 3.11+
pip install matplotlib pymupdf
```

### 2.6 Git

```powershell
scoop install git
# Or from git-scm.com
```

### 2.7 Docker Desktop (optional, for validation)

```powershell
# Download from https://www.docker.com/products/docker-desktop/
# Enable "Use WSL 2 based engine" in Settings > General
# Restart Docker Desktop after enabling
```

---

## 3. Get Models (GGUF format)

You need at least one model. For the full experiment:

| Model | Size | Use Case | Suggested Quant |
|-------|------|----------|-----------------|
| qwen3.8-27b | 27B | Strong agent + researcher | Q3_K_XL / Q4_K_M (~14-16 GB) |
| qwen3.5-4b | 4B | Weak local model test | Q4_K_M / IQ3_XXS (~2-3 GB) |

**Download sources:**
- Hugging Face: `Huihui-Qwen3.8-27B-abliterated-UD-Q3_K_XL.gguf` etc.
- Or your preferred quant source

**Place models in a known directory**, e.g.:
```
C:\models\
  qwen3.8-27b\
    Huihui-Qwen3.8-27B-abliterated-UD-Q3_K_XL.gguf
  qwen3.5-4b\
    NeoHorse-1-4B.i1-IQ3_XXS.gguf
```

---

## 4. Start the llama.cpp Router

Open **Terminal 1** (keep this running):

```powershell
# Adjust paths to your models
llama-server.exe `
  --host 127.0.0.1 --port 1234 `
  --model C:\models\qwen3.8-27b\Huihui-Qwen3.8-27B-abliterated-UD-Q3_K_XL.gguf `
  --alias qwen3.8-27b `
  --model C:\models\qwen3.5-4b\NeoHorse-1-4B.i1-IQ3_XXS.gguf `
  --alias qwen3.5-4b `
  --ctx-size 126976 `
  --flash-attn on `
  --n-gpu-layers 999 `
  --batch-size 64 `
  --ubatch-size 64 `
  --sleep-idle-seconds -1 `
  --load-mode none `
  --parallel 1 `
  --threads 8 `
  --threads-batch 4
```

**Wait for:** `HTTP server listening on 127.0.0.1:1234`

**Verify models loaded:**
```powershell
# In another terminal
curl http://127.0.0.1:1234/v1/models | python -m json.tool
# Should show both models with "status": {"value": "loaded"}
```

---

## 5. Install Playwright MCP Bridge Chrome Extension

**This is REQUIRED for `research_dispatch` to browse live docs.**

1. Open Chrome
2. Go to: https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm
3. Click **"Add to Chrome"** → **"Add extension"**
4. The 🎭 icon appears in toolbar

### Get Your Token

1. Click the 🎭 Playwright extension icon in Chrome toolbar
2. Click **"Copy Token"** (or "Show Token" → copy the long string)
3. Save this token — you'll need it in the next step

---

## 6. Configure pi Settings

Create or edit `~/.pi/settings.json`:

```json
{
  "playwright": {
    "mcpToken": "PASTE_YOUR_CHROME_EXTENSION_TOKEN_HERE",
    "userDataDir": "/tmp/chrome-pdf-prof"
  },
  "extensions": {
    "pi-ultra-scout": {
      "enabled": true,
      "contextTriggerTokens": 80000,
      "reTriggerDeltaTokens": 20000,
      "librarianCooldownMs": 60000
    }
  },
  "model": {
    "defaultProvider": "llamacpp",
    "defaultModel": "qwen3.8-27b"
  }
}
```

**Alternative (via CLI):**
```bash
pi config set playwright.mcpToken "YOUR_TOKEN"
pi config set playwright.userDataDir "/tmp/chrome-pdf-prof"
pi config set extensions.pi-ultra-scout.enabled true
```

---

## 7. Install the pi-ultra-scout Extension

### Option A: From this repository (local development)

```bash
git clone https://github.com/brutc/pi-ultra-scout.git
cd pi-ultra-scout
pi extension add ./extension
```

### Option B: From npm (once published)

```bash
pi extension add pi-ultra-scout
```

### Verify Installation

```bash
pi config get extensions
# Should show "pi-ultra-scout" in the list

pi extensions list
# Should show ultrawork tools: research_dispatch, evidence_register, etc.
```

---

## 8. Quick Sanity Check

### Test the extension loads

```bash
pi -p --provider llamacpp --model qwen3.8-27b "Say 'ultrawork loaded' and list available tools"
```

You should see `research_dispatch`, `evidence_register`, `evidence_add`, `evidence_check`, `reground_check`, `research_loop` in the tool list.

### Test the mechanism (C2: full mechanism)

```bash
# Create a test task
mkdir -p /tmp/ulw-test && cd /tmp/ulw-test
cat > TODO.md << 'EOF'
- [ ] Write a TypeScript function that uses p-retry to fetch a URL with retries
- [ ] Document the p-retry default options table (retries, factor, minTimeout, maxTimeout, randomize)
- [ ] Cite the official p-retry documentation URL
- [ ] Run bun test to verify it works against http://127.0.0.1:1234/v1/models
EOF

# Run with FULL mechanism (C2)
PI_ULW_AUTOACTIVE=1 pi -p --provider llamacpp --model qwen3.8-27b "
Read TODO.md and complete all tasks. 
Use p-retry (already in node_modules). 
The router is at http://127.0.0.1:1234.
"
```

**Expected behavior:**
1. Agent reads TODO
2. Makes a claim about p-retry defaults → trust-shape detected
3. `research_dispatch` fires → librarian browses live npmjs/GitHub
4. Evidence artifact written to `.pi/evidence/claim_1.json`
5. Agent writes correct code with verified defaults
6. Test passes

### Check the artifact

```bash
cat .pi/evidence/claim_1.json
# Should show: status=verified, confidence≈0.95, sources=[npmjs.com, github.com], summary with correct defaults
```

---

## 9. Run the Full Experiment

### 9.1 Prepare payloads (already in repo)

```bash
cd pi-ultra-scout/experiments
ls payload-a/ payload-b/
# Each has: package.json, reset.sh, TODO.md, src/, test/
```

### 9.2 Run the 6-cell 27B grid (C0, C1, C2 × payload A, B)

```bash
# This runs sequentially, one cell at a time (~30-75 min each)
# Total: ~4-6 hours
bash run_grid.sh
```

### 9.3 Run the weak-model dummy grid (nemo + 4B)

```bash
# Requires NVIDIA API key for nemotron (or skip nemo cells)
# For 4B local only:
bash dummy_test.sh
```

### 9.4 Run replication grid (n=3-4 per cell)

```bash
# Full replication: ~15-18 hours
bash reps_grid.sh
```

### 9.5 Grade and aggregate

```bash
python ../grading/grade.py runs
python ../grading/aggregate.py
python ../charts/make_charts.py
```

### 9.6 Render paper PDF

```bash
cd ../paper
# Use Chrome with temp profile to avoid lock
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --disable-gpu --print-to-pdf=paper.pdf --user-data-dir="/tmp/chrome-pdf-prof" --no-sandbox paper.html
```

---

## 10. Environment Variables Cheatsheet

```bash
# Mechanism control
PI_ULW_OFF=1                    # C0: inert (no tools, no prompt)
PI_ULW_AUTOACTIVE=1             # Enable prompt section without /ulw command
PI_ULW_NO_DISPATCH=1            # C1: prompt only, no research_dispatch tool

# Research dispatch tuning
PI_RESEARCH_CMD="pi -p"         # Override researcher spawn command
PI_RESEARCH_TIMEOUT_MS=660000   # Librarian timeout (ms) - default 660000
PI_RESEARCH_CHILD=1             # Internal: set in child process (recursion guard)

# Model selection (for pi -p)
PI_PROV=llamacpp                # Provider: llamacpp, nvidia, etc.
PI_MODEL=qwen3.8-27b            # Model pattern

# Example: C2 with custom timeout
PI_ULW_AUTOACTIVE=1 PI_RESEARCH_TIMEOUT_MS=900000 pi -p --provider llamacpp --model qwen3.8-27b "Task..."
```

---

## 11. Common Issues & Fixes

### "Cannot find module '@earendil-works/pi-coding-agent'"
```bash
bun add -g @earendil-works/pi-coding-agent
```

### "llama-server.exe not found"
- Add llama.cpp to PATH, or use full path: `C:\llama.cpp\llama-server.exe`
- Restart terminal after PATH changes

### "Playwright browser not connected"
- Chrome extension token missing → re-copy from extension → `pi config set playwright.mcpToken`
- Desktop Chrome holding profile lock → close Chrome, use `--user-data-dir=/tmp/chrome-pdf-prof`

### "Connection error" in experiment cells
- Router not running → start llama-server.exe (Step 4)
- Model not loaded → check `--sleep-idle-seconds -1 --load-mode none` pins models
- VRAM OOM → reduce `--n-gpu-layers` or use smaller quant

### Research dispatch timeout (60s default too short)
- Increase `PI_RESEARCH_TIMEOUT_MS=660000` (11 min) or more
- First cold-load after idle takes ~50-60s on 27B

### Windows Defender blocking Docker → host.docker.internal
- Allow inbound on port 1234 in Windows Firewall
- Or run llama.cpp on `0.0.0.0` not `127.0.0.1`

### "No such file: scoreboard.json"
- Run `python ../grading/grade.py runs` from `experiments/` directory first

---

## 12. Verification Checklist

After setup, verify each component:

- [ ] `bun --version` → >= 1.0
- [ ] `pi --version` → shows version
- [ ] `llama-server.exe --version` → shows version
- [ ] `curl http://127.0.0.1:1234/v1/models` → shows loaded models
- [ ] `pi config get extensions` → includes pi-ultra-scout
- [ ] `pi -p "list tools"` → shows research_dispatch, evidence_*
- [ ] Test task (Step 8) → produces `.pi/evidence/claim_1.json` with `status=verified`
- [ ] `python ../grading/grade.py runs` → produces scoreboard.json
- [ ] `python ../charts/make_charts.py` → produces 3 PNGs in charts/out/
- [ ] Chrome headless → produces paper.pdf (3 pages)

---

## 13. Next Steps

- Read `experiments/EXPERIMENT.md` for the full experimental protocol
- Read `paper/paper.html` for the 3-page paper
- Modify `experiments/payload-a/TODO.md` to create your own trap tasks
- Share results: the replication grid (`reps_grid.sh`) produces publishable data