# Troubleshooting Guide

Common issues and solutions for pi-ultra-scout.

---

## Installation Issues

### `pi: command not found` after `bun add -g`
**Cause:** Bun's global bin not in PATH.
**Fix:**
```bash
# Add to ~/.bashrc / ~/.zshrc / PowerShell profile
export PATH="$HOME/.bun/bin:$PATH"
# Or on Windows:
$env:PATH += ";$env:USERPROFILE\.bun\bin"
# Restart terminal
```

### `pi install` fails with "not a valid package"
**Cause:** The package manifest (the `pi` key in the root package.json) or the extension file is missing.
**Fix:**
```bash
# Verify the package manifest at the repo root
ls extension/ultrawork.ts
grep -A 4 '"pi"' package.json
# Ensure the root package.json has: "pi": { "extensions": ["extension/ultrawork.ts"] }
```

### TypeScript errors on load
**Cause:** Missing types or version mismatch.
**Fix:**
```bash
# Install types
bun add -D typescript @types/node
# Type-check
tsc --noEmit --strict --moduleResolution bundler extension/ultrawork.ts
```

---

## Router / Model Issues

### "Connection refused" / "Connection error" on 127.0.0.1:1234
**Cause:** llama.cpp router not running, wrong port, or firewall.
**Fix:**
```bash
# 1. Check router is running
curl http://127.0.0.1:1234/v1/models

# 2. If not running, start it (see SETUP.md Step 4)
# 3. Check Windows Firewall: Allow inbound on port 1234
# 4. Ensure router binds to 0.0.0.0 if accessing from Docker:
#    --host 0.0.0.0  (not 127.0.0.1)
```

### Model shows "unloaded" in /v1/models
**Cause:** Model not pinned, idle timeout expired.
**Fix:** Use these flags when starting llama-server:
```bash
--sleep-idle-seconds -1 --load-mode none
```
This prevents unloading. Or load on-demand by hitting the endpoint first.

### "Out of memory" / CUDA OOM
**Cause:** Model too large for VRAM.
**Fix:**
```bash
# Reduce GPU layers
--n-gpu-layers 30  # instead of 999

# Or use smaller quant (Q3 instead of Q4)
# Or offload to CPU: --n-gpu-layers 0
```

### Router very slow / "creepingly slow"
**Cause:** Multiple concurrent requests to llama.cpp.
**Fix:** Run sequentially (one model at a time). The experiment scripts enforce this.
```bash
# Don't run multiple pi -p simultaneously
# Use the provided scripts: run_grid.sh, reps_grid.sh (sequential)
```

---

## Playwright / Browser Issues

### "Playwright browser not connected" / "MCP bridge error"
**Cause:** Chrome extension token missing, expired, or Chrome not running.
**Fix:**
```bash
# 1. Ensure Chrome is OPEN (desktop)
# 2. Re-copy token from the 🎭 extension icon
# 3. Set playwright.mcpToken in ~/.pi/settings.json (no `pi config set` subcommand exists):
#    { "playwright": { "mcpToken": "NEW_TOKEN", "userDataDir": "/tmp/chrome-pdf-prof" } }
# 4. If profile lock: close all Chrome windows, use temp profile
#    (userDataDir above)
```

### "Playwright extension not found" in Chrome
**Cause:** Extension not installed or disabled.
**Fix:**
1. Open `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Find "Playwright MCP Bridge" - ensure it's ON
4. If missing: reinstall from Chrome Web Store

### Browser actions timeout
**Cause:** Page load slow, or extension not injecting.
**Fix:**
- Increase `PI_RESEARCH_TIMEOUT_MS` (default 660000ms = 11 min)
- Check Chrome DevTools console for errors

---

## Experiment / Grading Issues

### "scoreboard.json not found"
**Cause:** Grading run from wrong directory.
**Fix:**
```bash
cd experiments
python ../grading/grade.py runs
# NOT from repo root
```

### Grader reports "wrong" defaults that look correct
**Cause:** Markdown table column order varies (option|default|desc vs option|desc|default).
**Fix:** The grader uses row-level containment — it checks ALL non-name columns. This is correct behavior. Verify by looking at the raw probe.ts table.

### bun test fails but code looks correct
**Cause:** Test hits live router; router has 0 loaded models at that moment.
**Fix:** Ensure models are pinned (`--sleep-idle-seconds -1 --load-mode none`) and router is stable. Check `/v1/models` before running.

### "No such file: paper.pdf" from Chrome headless
**Cause:** Output directory permissions or path format.
**Fix:**
```bash
# Use absolute Windows path
"C:\Program Files\Google\Chrome\Application\chrome.exe" --headless --print-to-pdf="C:\full\path\paper.pdf" ...
# Or run from the paper directory with relative path
cd paper && chrome --headless --print-to-pdf=paper.pdf ...
```

### Charts not generating / matplotlib errors
**Cause:** Missing display backend (headless).
**Fix:**
```bash
# Ensure Agg backend (already in make_charts.py)
matplotlib.use("Agg")
# Install: pip install matplotlib
```

---

## Docker Issues

### Container can't reach host router (localhost)
**Cause:** `localhost` inside container = container itself.
**Fix:** Use `host.docker.internal`:
```bash
# In container, connect to:
http://host.docker.internal:1234
# NOT http://localhost:1234
```
And ensure router binds to `0.0.0.0`:
```bash
llama-server.exe --host 0.0.0.0 --port 1234 ...
```

### Windows Firewall blocks Docker → host
**Cause:** Docker network adapter traffic blocked.
**Fix:**
```powershell
# PowerShell as Admin
New-NetFirewallRule -DisplayName "Allow Docker to llama.cpp" -Direction Inbound -LocalPort 1234 -Protocol TCP -Action Allow
```

### Docker build fails on `pi install`
**Cause:** The package (root package.json + `extension/`) not available where `pi install` runs.
**Fix:** Ensure the Dockerfile has the package present before running `pi install npm:pi-ultra-scout` (or `pi install .` from the repo root).

---

## Mechanism / Ultrawork Issues

### `PI_ULW_AUTOACTIVE=1` but tools not showing
**Cause:** Extension not loaded, or env var not passed to pi process.
**Fix:**
```bash
# Check extension loaded
pi list | grep -i ultra

# Pass env correctly (Windows cmd):
set PI_ULW_AUTOACTIVE=1 && pi -p ...

# PowerShell:
$env:PI_ULW_AUTOACTIVE=1; pi -p ...

# Bash/Git Bash:
PI_ULW_AUTOACTIVE=1 pi -p ...
```

### research_dispatch never fires (C2)
**Cause:** Model didn't make a trust-shaped claim, or cooldown active.
**Fix:**
- Check task forces a trust shape (numeric default, exact identifier, etc.)
- Check ultrawork.log for `[CLAIM] captured assertion` and `[DISPATCH]` entries
- Cooldown: `LIBRARIAN_COOLDOWN_MS` default 60s between dispatches

### Evidence artifact shows `status=pending_research`
**Cause:** Sources not authoritative enough (classifier downgraded).
**Fix:**
- Ensure hints include official URLs (npmjs.com, github.com, raw.githubusercontent.com)
- Check `evidence_state.ts classifySource()` logic

### Agent writes wrong defaults even with C2
**Cause:** Model didn't call research_dispatch (stochastic on weak models).
**Fix:** This is the expected behavior — weak models may not use the tool. That's what the replication measures. Increase n (replicates).

---

## Performance Tuning

### Reduce wall time
- Use smaller models for development (4B instead of 27B)
- Reduce `PI_RESEARCH_TIMEOUT_MS` for faster failure (but may miss slow librarians)
- Disable context pruner for experiments (already OFF in scripts)

### Increase reliability
- Pin models in VRAM (`--sleep-idle-seconds -1 --load-mode none`)
- Use `--kill-after 60` in timeout wrapper (prevents zombie processes)
- Run sequentially (one cell at a time)

---

## Getting Help

1. Check `docs/CHANGELOG.md` for known issues
2. Check `experiments/INCIDENT-20260918.md` for historical incidents
3. Enable debug logging: `DEBUG=ultrawork:* pi -p ...`
4. Check `.pi/agent/sessions/` for session JSONL traces
5. Open issue at https://github.com/brutc/pi-ultra-scout/issues

---

## Log Files to Check

| File | What it shows |
|------|---------------|
| `~/.pi/agent/extensions/ultrawork.log` | Mechanism events: claims, dispatches, librarian calls |
| `.pi/agent/sessions/*.jsonl` | Full agent turn-by-turn trace |
| `.pi/evidence/*.json` | Evidence artifacts (status, confidence, sources) |
| `experiments/grid.log` | Cell-by-cell experiment log |
| `experiments/runs/<cell>/run.log` | Per-cell stdout/stderr |
| `experiments/runs/<cell>/bun-test.txt` | Test output |