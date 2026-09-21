# pi-ultra-scout: Sequential Web Nudges for Small Local Coding Agents

> **The ultrawork mechanism**: A deterministic trust-shape detector + a blocking `research_dispatch` tool that spawns a fresh same-weight librarian subprocess to browse live docs and return a machine-checkable evidence artifact. **Protects weak local models from confidently hallucinating API defaults.**

[![pi extension](https://img.shields.io/badge/pi-extension-blue?logo=npm)](https://www.npmjs.com/package/pi-ultra-scout)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![paper](https://img.shields.io/badge/paper-3%20pages-orange)](paper/paper.pdf)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22869953.svg)](https://doi.org/10.5281/zenodo.22869953)

---

## TL;DR (15-second skim)

| Model | WITHOUT ulw | WITH ulw |
|-------|-------------|----------|
| **4B local** (qwen3.5-4b) | **Fails** — timeout, no artifact (DQ 0.00) | **Perfect** — all 5 defaults correct, green test (DQ 1.00) |
| **3B active** (nemotron-3.5) | Variable — 1.7 wrong defaults (range 0–3), 67% tests (DQ 0.73, n=3) | Lifted — 100% tests pass, 1.0 wrong (range 0–2) (DQ 0.89, n=2) |
| **27B** (qwen3.8-27b) | Robust — 0 wrong, 100% tests (DQ 0.97) | Robust — 0 wrong, 100% tests, evidence artifact (DQ 0.97) |

**The mechanism's value is strongest on the weakest model.** A 4B local model *cannot complete the task* without ulw but *succeeds perfectly* with it. This is not about raw doc access — the control reads local READMEs — it's about **auditable verification before code** and **guaranteed completion** for weak weights.

---

## What is this?

A **pi extension** that adds a single atomic research action to any pi coding agent:

```typescript
// When the agent makes a claim matching a "trust shape" (numeric default, exact identifier,
// version drift, universal negative, niche entity), it gets nudged to call:
await research_dispatch({
  statement: "p-retry default retries is 10",
  hints: ["https://github.com/sindresorhus/p-retry"]
});

// The tool BLOCKS the agent's turn and:
// 1. Spawns a FRESH headless `pi -p` subprocess (same model, lean prompt, browser tools)
// 2. That "librarian" opens live official sources (npmjs, GitHub, raw READMEs)
// 3. Writes a machine-checkable artifact: `.pi/evidence/<claim_id>.json`
// 4. Returns ONLY: { status: "verified", confidence: 0.97, summary: "...", sources: [...] }
// 5. Parent context gains ONE tool call + ONE compact summary — never the browsing trace
```

**Key properties:**
- **Sequential by design** — one model in VRAM, no concurrent requests
- **Same-weights researcher** — no stronger-model confound; the librarian is the same model
- **Shape-based trigger** — deterministic regex, not introspective confidence
- **KV-cache efficient** — child subprocess has its own cold prefill; parent context stays lean
- **Artifact contract** — `.pi/evidence/<claim_id>.json` with status, confidence, sources, summary

---

## Quick Start (5 minutes)

### Prerequisites (one-time)

```bash
# 1. Install Bun (fast JS runtime, includes Node.js API)
curl -fsSL https://bun.sh/install | bash
exec $SHELL  # reload PATH

# 2. Install pi coding agent
bun add -g @earendil-works/pi-coding-agent

# 3. Install llama.cpp router (for local models)
# Windows: download from https://github.com/ggerganov/llama.cpp/releases
# Or via scoop: scoop install llama.cpp
# Ensure `llama-server.exe` is in PATH

# 4. Install Chrome (for Playwright browser bridge)
# Download from https://www.google.com/chrome/
```

### Install the extension

```bash
# Option A: From npm (recommended)
pi install npm:pi-ultra-scout

# Option B: From local source (this repo)
git clone https://github.com/BrutchsamaJeanLouis/pi-ultra-scout.git
cd pi-ultra-scout
pi install .
```

### Configure Playwright MCP Bridge (required for `research_dispatch`)

The `research_dispatch` tool uses a **real Chrome browser** via Playwright MCP Bridge extension.

1. **Install the Chrome extension**:
   - Open Chrome and go to: https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm
   - Click "Add to Chrome" → "Add extension"
   - The extension icon (🎭) appears in your toolbar

2. **Get your MCP Bridge token**:
   - Click the Playwright extension icon in Chrome toolbar
   - Click "Copy Token" (or "Show Token" → copy the long string)
   - This token authenticates the bridge to your Chrome profile

3. **Add to pi config** — edit `~/.pi/settings.json` directly (there is no `pi config set` subcommand; `pi config` is a TUI):
   ```json
   {
     "playwright": {
       "mcpToken": "YOUR_TOKEN_HERE",
       "userDataDir": "/tmp/chrome-pdf-prof"
     }
   }
   ```

### Start the local router (load your models)

```bash
# Terminal 1: Start llama.cpp router with your models
# Example: load 27B + 4B models (adjust paths to your .gguf files)
llama-server.exe \
  --host 127.0.0.1 --port 1234 \
  --model C:/path/to/qwen3.8-27b.gguf --alias qwen3.8-27b \
  --model C:/path/to/qwen3.5-4b.gguf --alias qwen3.5-4b \
  --ctx-size 126976 --flash-attn on --n-gpu-layers 999 \
  --sleep-idle-seconds -1 --load-mode none  # pin models in VRAM
```

Wait for "HTTP server listening on 127.0.0.1:1234".

### Run your first ultrawork task

```bash
# The extension loads automatically after `pi install` (no per-run flag needed).
cd /path/to/your/project

# Interactive: start pi, type /ulw to activate, then give your task
pi
#   > /ulw
#   > <your task>

# Headless: activate via env var
PI_ULW_AUTOACTIVE=1 pi -p "Your task here..."
```

### Activate the mechanism (headless/auto mode)

For experiments/CI, use environment variables (no `/ulw` command needed):

```bash
# Full mechanism (C2): trust-shapes prompt + research_dispatch tool + auto-nudge
PI_ULW_AUTOACTIVE=1 pi -p --provider llamacpp --model qwen3.8-27b "Task..."

# Prompt only (C1): trust-shapes prompt + completion contract, NO dispatch tool
PI_ULW_AUTOACTIVE=1 PI_ULW_NO_DISPATCH=1 pi -p --provider llamacpp --model qwen3.8-27b "Task..."

# Inert control (C0): extension completely disabled
PI_ULW_OFF=1 pi -p --provider llamacpp --model qwen3.8-27b "Task..."
```

---

## The Experiment (Reproducible Ablation)

This repo includes the full controlled experiment from the paper. The paper is archived and citable on Zenodo — **DOI [10.5281/zenodo.22869953](https://doi.org/10.5281/zenodo.22869953)** (v2, corrected aggregate). Run it yourself:

```bash
cd experiments

# 1. Start the router (see "Start the local router" above)
# 2. Run the full grid (sequential, ~4-6 hours total)
bash scripts/run_grid.sh

# Or run the replication grid (n=3-4 per cell, ~15-18 hours)
bash scripts/reps_grid.sh

# 3. Grade all results
python ../grading/grade.py runs

# 4. Aggregate & charts
python ../grading/aggregate.py
python ../charts/make_charts.py

# 5. Render paper PDF
cd ../paper && chrome --headless --print-to-pdf=paper.pdf --user-data-dir=/tmp/chrome-pdf-prof paper.html
```

**Payloads included:**
- `experiments/payload-a/` — p-retry 8.0.1 trap (weights say `retries=2`, docs say `10`)
- `experiments/payload-b/` — undici 8.x timeout defaults + universal-negative "fetch() has no timeout"

**Ground truth was LIVE-verified** from official sources before any run (see `experiments/EXPERIMENT.md`).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MAIN AGENT (pi -p)                           │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │ User prompt │───▶│ Trust-shape  │───▶│ research_dispatch()   │  │
│  │ + code task │    │ detector     │    │ (blocks turn)         │  │
│  └─────────────┘    └──────────────┘    └───────────┬───────────┘  │
└──────────────────────────────────────────────────────┼──────────────┘
                                                       │ spawns
                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  LIBRARIAN SUBPROCESS (headless pi -p)             │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │ Lean system │───▶│ Playwright   │───▶│ Evidence artifact     │  │
│  │ prompt      │    │ browser      │    │ .pi/evidence/claim.json│  │
│  │ (same model)│    │ (live docs)  │    │ status=verified       │  │
│  └─────────────┘    └──────────────┘    │ conf=0.97, sources[]  │  │
└─────────────────────────────────────────────────────────────────────┘
                                                       │ returns compact summary
                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MAIN AGENT RESUMES                               │
│  • Receives: { status, confidence, summary, sources }              │
│  • Codes to the VERIFIED fact (not memory)                         │
│  • Artifact is machine-checkable for audit                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Configuration Reference

### Environment Variables (mechanism control)

| Variable | Values | Effect |
|----------|--------|--------|
| `PI_ULW_OFF` | `1` | Extension completely inert (no tools, no prompt, no hooks) |
| `PI_ULW_AUTOACTIVE` | `1` | Enable trust-shapes prompt + completion contract without `/ulw` |
| `PI_ULW_NO_DISPATCH` | `1` | Prompt active but `research_dispatch` tool hidden (C1) |
| `PI_RESEARCH_CMD` | string | Override researcher spawn command (default: `pi -p`) |
| `PI_RESEARCH_TIMEOUT_MS` | int | Librarian timeout (default: 660000 = 11 min) |
| `PI_RESEARCH_CHILD` | `1` | Internal recursion guard (set automatically in child) |

### Pi Settings (`~/.pi/settings.json`)

```json
{
  "playwright": {
    "mcpToken": "YOUR_CHROME_EXTENSION_TOKEN",
    "userDataDir": "/tmp/chrome-pdf-prof"
  },
  "extensions": {
    "pi-ultra-scout": {
      "enabled": true,
      "contextTriggerTokens": 80000,
      "reTriggerDeltaTokens": 20000,
      "librarianCooldownMs": 60000
    }
  }
}
```

### Trust Shapes (what triggers the nudge)

The detector scans assistant text for 5 claim shapes (deterministic regex):

| Shape | Example | Regex (simplified) |
|-------|---------|-------------------|
| Exact identifier/flag | `--model qwen3.8-27b` | `\b--\w+\s+\S+` |
| Version/temporal | `v8.0.1`, `Node 20` | `\bv?\d+\.\d+\.\d+\b` |
| **Numeric default** | `retries=10`, `timeout=30000` | `\b\w+\s*[:=]\s*\d+(\.\d+)?(ms|s)?\b` |
| Universal negative | `fetch has no timeout` | `\b(no|without|doesn't have)\b.*\b(option|param|flag)\b` |
| Niche entity | `sindresorhus/p-retry` | `github\.com/[\w-]+/[\w-]+` |

---

## Project Structure

```
pi-ultra-scout/
├── package.json                 # npm package for pi extension install
├── extension/
│   ├── ultrawork.ts             # Main entry point (tools, gates, hooks)
│   ├── ultrawork/
│   │   ├── claim_shapes.ts      # Deterministic trust-shape detector
│   │   ├── research_dispatch.ts # Sequential librarian spawner
│   │   ├── evidence_state.ts    # Evidence ledger (authority-weighted)
│   │   ├── research_loop.ts     # Memory nudge (zero-weight recall)
│   │   ├── claim_audit.ts       # Prompt builders
│   │   ├── logger.ts            # Structured logging
│   │   └── epistemic_protocol.ts# Prompt sections
│   └── ulw-analysis/            # Probe tests (all green)
│       ├── probe_shapes.ts      # 13/13 shape detection cases
│       ├── smoke_dispatch.ts    # 19/19 fake_pi dispatch tests
│       ├── smoke_wiring.ts      # Full chain integration test
│       ├── probe_evidence.ts    # 12/12 evidence grading
│       └── fake_pi.mjs          # Minimal pi mock for tests
├── experiments/
│   ├── payload-a/               # p-retry trap task
│   ├── payload-b/               # undici timeout trap task
│   ├── EXPERIMENT.md            # Full protocol
│   ├── run_cell.sh              # Single cell runner (hardened)
│   ├── run_grid.sh              # 6-cell 27B grid
│   ├── dummy_test.sh            # 4-cell weak-model grid
│   ├── reps_grid.sh             # Full replication (n=3-4)
│   └── INCIDENT-20260918.md     # Incident log (router maintenance)
├── grading/
│   ├── grade.py                 # Deterministic grader (fact, behavior, VBC, DQ)
│   └── aggregate.py             # Per model×condition stats
├── charts/
│   ├── make_charts.py           # Matplotlib figures
│   └── out/                     # Generated PNGs
├── paper/
│   ├── paper.html               # Source HTML (3-page budget)
│   └── paper.pdf                # Rendered PDF
├── docs/
│   ├── SETUP.md                 # Complete from-scratch Windows setup
│   ├── TROUBLESHOOTING.md       # Common issues
│   └── CHANGELOG.md             # History
└── scripts/
    ├── install_deps.sh          # One-shot dependency installer
    └── docker_test.sh           # Docker validation script
```

---

## Docker Validation (CI-ready)

Test the setup instructions in a clean container:

```bash
# From repo root
docker build -t pi-ultra-scout-test -f Dockerfile.test .
docker run --rm -it \
  --add-host=host.docker.internal:host-gateway \
  -v /var/run/docker.sock:/var/run/docker.sock \
  pi-ultra-scout-test
```

The Dockerfile installs Bun, pi, llama.cpp, Chrome, clones this repo, installs the extension, and runs the smoke tests. See `scripts/docker_test.sh` for the full validation script.

> **Critical for Docker → Windows host router**: Use `host.docker.internal` (not `localhost`) inside the container to reach the llama.cpp router on your Windows host. The router must bind to `0.0.0.0` (not `127.0.0.1`).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `research_dispatch` times out | Librarian cold-load + router contention | Increase `PI_RESEARCH_TIMEOUT_MS` to 660000+ |
| "Connection error" in 4B cells | llama.cpp router down / model not loaded | Ensure router running, model pinned (`--sleep-idle-seconds -1 --load-mode none`) |
| Playwright "browser not connected" | Chrome extension token missing/expired | Re-copy token from Chrome extension → set `playwright.mcpToken` in `~/.pi/settings.json` |
| Chrome profile lock | Desktop Chrome open with same profile | Use `--user-data-dir=/tmp/chrome-pdf-prof` |
| `PI_ULW_AUTOACTIVE=1` not working | Extension not loaded | Check `pi list` shows `pi-ultra-scout` installed |
| Tests pass but defaults wrong | Weak model confabulated from memory | This is the bug ulw fixes — enable C2 and re-run |

Full troubleshooting: `docs/TROUBLESHOOTING.md`

---

## Publishing (for maintainers)

### Prerequisites

1. npm account with 2FA enabled
2. GitHub repository with `NPM_TOKEN` secret
3. Tagged release: `git tag v1.0.0 && git push origin v1.0.0`

### Publish Flow

```bash
# 1. Ensure all tests pass locally
cd extension && npm run test:all && npm run build

# 2. Update version in package.json
npm version patch|minor|major

# 3. Push tags (triggers GitHub Actions publish)
git push origin main --tags
```

### GitHub Actions

- `.github/workflows/ci.yml` — Runs tests on push/PR
- Auto-publishes to npm on version tags (`v*`)
- Creates GitHub Release with paper PDF + charts

### npm Package

```bash
# Install from npm (recommended)
pi install npm:pi-ultra-scout

# Or with a specific version
pi install npm:pi-ultra-scout@1.0.1
```

### Package Manifest

The `pi` key in `package.json` declares the extension entry point:

```json
{
  "pi": {
    "extensions": ["extension/ultrawork.ts"]
  }
}
```

The `pi-package` keyword enables gallery discoverability.

---

## License

MIT — see `LICENSE` file.

---

## Acknowledgments

- pi coding agent team for the extensible architecture
- llama.cpp for local inference
- Playwright for browser automation
- sindresorhus/p-retry & nodejs/undici for the trap payloads