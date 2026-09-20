# Changelog

All notable changes to pi-ultra-scout are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## [1.0.0] - 2026-09-20

### Added
- **Ultrawork extension** (`extension/ultrawork.ts`): Complete pi extension with 6 tools
  - `research_dispatch` — Sequential out-of-band web research (core tool)
  - `evidence_register` — Register claims needing verification
  - `evidence_add` — Add live-source evidence to claims
  - `evidence_check` — Check claim verification status
  - `reground_check` — Audit for stale/unopened critical resources
  - `research_loop` — Memory nudge (zero-weight recall, not verification)
- **Trust-shape detector** (`extension/ultrawork/claim_shapes.ts`): Pure deterministic regex detector for 5 claim shapes
  - Exact identifier/flag, version/temporal drift, numeric default, universal negative, niche entity
  - 13/13 probe cases pass
- **Sequential dispatcher** (`extension/ultrawork/research_dispatch.ts`): Spawns fresh headless `pi -p` librarian subprocess
  - Same weights as parent, lean prompt, browser tools
  - Machine-readable marker args (`--ulw-artifact`, `--ulw-claim`) for Windows shell quoting
  - Artifact validation, compact summary, timeout/kill
  - Recursion guard via `PI_RESEARCH_CHILD=1`
- **Evidence ledger** (`extension/ultrawork/evidence_state.ts`): Authority-weighted confidence
  - `classifySource()` reconciles label vs URL (anti-masquerade)
  - Memory evidence carries zero weight (breaks circularity)
  - Conflict = opposing content on ≥2 source types
- **Probe test suite** (`extension/ulw-analysis/`): All green
  - `probe_shapes.ts` — 13/13 shape detection
  - `smoke_dispatch.ts` — 19/19 fake_pi dispatch tests
  - `smoke_wiring.ts` — Full chain integration (message_end → gate → librarian → nudge)
  - `probe_evidence.ts` — 12/12 evidence grading
  - `fake_pi.mjs` — Minimal pi mock for testing
- **Experiment framework** (`experiments/`)
  - Payload A: p-retry 8.0.1 trap (weights remember `retries=2`, docs say `10`)
  - Payload B: undici 8.x timeout defaults + universal-negative "fetch has no timeout"
  - Ground truth LIVE-verified from official sources (npmjs, GitHub, raw READMEs)
  - Ablation conditions: C0 (inert), C1 (prompt-only), C2 (full mechanism)
  - Sequential runner (`run_cell.sh`, `run_grid.sh`) with 6600s cap + `--kill-after 60`
  - Weak-model grid: nemotron-3.5 (3B active) + qwen3.5-4b (local)
  - Replication driver (`reps_grid.sh`) for n=3-4 per cell
- **Deterministic grader** (`grading/grade.py`): Multi-axis scoring
  - Fact accuracy (vs live ground truth)
  - Behavior (live router `bun test`)
  - Verify-before-code (session line-order forensics)
  - URL citation validity
  - Composite Deliverable Quality (DQ, 0–1)
- **Aggregation & charts** (`grading/aggregate.py`, `charts/make_charts.py`)
  - Per model×condition statistics with whiskers
  - Main comparison: DQ by model strength × WITH/WITHOUT ulw
- **Paper** (`paper/`)
  - 3-page PDF (≤4 budget) with charts, mechanism diagram, results table
  - 15-second-skim TL;DR, WITH-vs-WITHOUT framing
  - Author: Brutchsama Jean-Louis
- **Documentation** (`docs/`)
  - `SETUP.md` — Complete from-scratch Windows setup
  - `TROUBLESHOOTING.md` — Common issues & fixes
  - `CHANGELOG.md` — This file

### Key Findings (from 11 valid scored cells)
| Model | WITHOUT ulw | WITH ulw |
|-------|-------------|----------|
| 4B local | DQ 0.00, timeout, no artifact | **DQ 1.00**, perfect, completes |
| 3B active | DQ 0.62, 2.5 errors, 50% tests | DQ 0.84, 2.0 errors, 100% tests |
| 27B | DQ 0.97, robust | DQ 0.97, robust + evidence artifact |

**Headline:** The mechanism's value is strongest on the weakest model — 4B local *fails to complete* without ulw but *succeeds perfectly* with it.

### Configuration
- Environment variables for mechanism control: `PI_ULW_OFF`, `PI_ULW_AUTOACTIVE`, `PI_ULW_NO_DISPATCH`
- Research tuning: `PI_RESEARCH_CMD`, `PI_RESEARCH_TIMEOUT_MS` (660000ms), `PI_RESEARCH_CHILD`
- Playwright MCP Bridge: Chrome extension token in `~/.pi/settings.json`

---

## [0.9.0] - 2026-09-18 (Web-Nudge Build)

### Added
- Initial `research_dispatch` tool with sequential blocking semantics
- Trust-shape taxonomy and deterministic detector
- Live end-to-end runs: cloud nemotron + local qwen3.8-27b production
- Probe suite: shapes (13/13), dispatch (19/19), wiring (PASS)

### Fixed (Phase E)
- **Ledger under-credit**: `classifySource()` fixed for `githubusercontent.com`/`gitlab.io` → `official_repo`, `npmjs.com`/`pypi.org` → `official_docs`
- **Thin timeout**: `DEFAULT_TIMEOUT_MS` 540_000 → 660_000 (local 27B researcher at 508.6s)
- Regression probes all green: evidence 12/12, shapes 13/13, dispatch 19/19

---

## [0.8.0] - 2026-09-16 (Refactor)

### Changed
- Memory evidence = zero weight (breaks circularity: claim can't verify itself from own weights)
- Collapsed duplicate status functions (`recalculateConfidence`, `resolveStatus`)
- Conflict = opposing content, not source diversity
- Shared error-wrapping LLM call (`chatCompletion`)
- Research loop relabeled as "memory nudge, not verification"
- `minConfidenceForAnswer` now load-bearing (0.7 default)
- Loop short-circuits on no progress (1 recall for pure-memory claims)
- Language-agnostic critical resources (npm/pip/Cargo/Go/Maven/Gradle)
- Path-boundary resource matching, digest buffer clearing after nudge
- Timer leak fix: `pendingTimeouts` tracked, cleared on session shutdown

### Removed
- `epistemic_protocol.ts`: Stateful `EpistemicProtocol` class (duplicate engine)
- `research_loop.ts`: `ResearchResult`, `ResearchPlan`, `researchHistory`, private duplicates
- `evidence_state.ts`: `updateClaim`, `getUnverifiedClaims`, `getConflictedClaims`, serialization

### Verification
- TypeScript strict mode: exit 0, no unused locals/params
- Load test through pi's jiti loader: OK
- Behavioral tests: label downgrade, memory zero-weight, conflict detection, loop short-circuit

---

## Contributing

See `CONTRIBUTING.md` (TODO) for development setup and PR guidelines.