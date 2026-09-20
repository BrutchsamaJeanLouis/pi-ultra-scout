# Ultrawork — Web-Nudge Build (research_dispatch + trust shapes)

**Date:** 2026-09-18
**Scope:** new `ultrawork/claim_shapes.ts`, `ultrawork/research_dispatch.ts`; edits to
`ultrawork.ts` (tool registration, librarian shape-scan, system-prompt section),
`ultrawork/claim_audit.ts` (prompt builders). Probes in `ulw-analysis/`.
**Status:** All probes green; two live end-to-end runs green (cloud nemotron + local
qwen3.8-27b production). Backups: none needed (additive build; prior changelog intact).

---

## Summary

The agent now has an atomic RESEARCH ACTION. When a claim matches a risky
"trust shape" (exact flag/identifier, version/temporal drift, numeric default,
universal negative, niche entity), the workflow nudges the agent to call
`research_dispatch(statement)`. That tool **blocks the agent's turn** (sequential,
operator decision) while a fresh headless `pi -p` subprocess — same model as the
agent, lean system prompt, browser tools — browses the live web and writes an
evidence artifact to `.pi/evidence/<claim_id>.json`. The main agent's context
gains exactly one tool-call line and one compact summary: the messy DOM/browser
trace never enters the main KV context.

### Files

| File | Role |
|---|---|
| `ultrawork/claim_shapes.ts` | Pure deterministic shape detector (`detectRiskyShapes`, `renderShapeHits`, `TRUST_SHAPES_SECTION`). No model in the trigger path. |
| `ultrawork/research_dispatch.ts` | Sequential dispatcher: spawns `pi -p` researcher, brief + `--ulw-artifact`/`--ulw-claim` markers after `--`, artifact validation, compact summary, timeout/kill. Env: `PI_RESEARCH_CMD`, `PI_RESEARCH_TIMEOUT_MS` (default 540s), `PI_RESEARCH_CHILD=1` recursion guard. |
| `ultrawork.ts` | `research_dispatch` tool (guarded by `!PI_RESEARCH_CHILD`), shape hits fed into librarian audit prompt, `TRUST_SHAPES_SECTION` in `before_agent_start`, completion-contract External-claims bullet → research_dispatch. |
| `ulw-analysis/` | `probe_shapes.ts` (13/13), `smoke_dispatch.ts` (19/19, fake `pi`), `smoke_wiring.ts` (PASS: message_end → gate → live 4B librarian → nudge), `fake_pi.mjs`. |

### The Windows `shell:true` quoting war (empirically mapped)

cmd/CommandLineToArgvW eats characters: newlines truncate quoted args, a
backslash before a closing quote is consumed, `"` needs `""`. Solution: `q()`
helper (backslash-escape, double-quote, newline→space) plus **machine-readable
marker args after the `--` separator** (`--ulw-artifact <path>`, `--ulw-claim <id>`)
so paths never depend on prose parsing.

## Live runs (Phase C)

Scratch payload: `C:/Users/brutc/ulw-webnudge` — bun TS TODO-cli; TODO.md forces
a p-retry claim (option names + default retry count) to be registered and
research_dispatch-verified **before** coding. Ground truth (verified live in
browser, github.com/sindresorhus/p-retry README): `retries` default **10**
(model weights say 2 — shape-(c) trap), `minTimeout` 1000, `maxTimeout` Infinity,
`factor` 2, `randomize` false.

| | Run 1 — nemotron (cloud) | Run 2 — qwen3.8-27b (local, production) |
|---|---|---|
| Claim → dispatch | claim_1 registered, dispatch invoked | claim_1 registered (names the repo), dispatch invoked |
| Researcher | nemotron child, 248s | 27B child, **508s** (under 540s timeout) |
| Artifact | verified 0.95, npmjs source | verified 0.95, raw main-branch README source |
| Code | probe.ts to verified options, URL cited | probe.ts to verified options, URL cited; **also re-checked installed index.d.ts (v8.0.1) and caught the v8 `input(attemptNumber)` signature bug** |
| Test | bun test 1 pass / 0 fail | bun test 1 pass / 0 fail (re-verified locally) |
| TODO | all [x] | all [x] |

Both runs: recursion guard active in child (its own `research_dispatch` skipped),
artifact folded into the ledger, compact summary (no trace dump) returned.

## Emergent behaviors worth keeping

- **The researcher is not a yes-man.** Run 2's claim included "inherited from the
  `retry` package"; the artifact's summary explicitly flagged that current p-retry
  "implements the backoff itself rather than literally inheriting" while confirming
  the load-bearing names/defaults. The agent coded to the confirmed facts and
  dropped the nuance.
- **Sequential = enforced grounding.** In both runs the agent literally could not
  write `probe.ts` before the artifact existed — the tool blocked the turn.

## Phase E — resolved (09-18 16:05, operator-approved)

1. **Ledger under-credit — ROOT CAUSE FOUND & FIXED.** Not the fold, not the
   recalc: `classifySource()` matched `.includes("github.com")`, and
   **`raw.githubusercontent.com` does not contain that substring** (it contains
   `githubusercontent.com`) — so researcher artifacts citing raw-README URLs were
   B4-reconciled down to `webpage` (authority 0.2) → single entry conf 0.2²/0.2 =
   0.20 → `pending_research`, while the researcher had verified 0.95. Run 1's
   `npmjs.com` URL fell through to `webpage` the same way. Fix in
   `evidence_state.ts classifySource`: `githubusercontent.com`/`gitlab.io` →
   `official_repo` (0.95); `npmjs.com`/`pypi.org` → `official_docs` (1.0 —
   registry pages render the project's own README, verified live in browser both
   URLs this session: raw CDN serves the README verbatim; npmjs page shows the
   Readme tab with the options table). The B4 label-vs-URL reconciliation and the
   memory-zero rule are UNCHANGED (still the load-bearing anti-masquerade path).
   Regression probe: `ulw-analysis/probe_evidence.ts` 12/12 — the exact 09-18 run
   shapes (raw-README labeled official_repo; npmjs labeled official_repo) now
   settle at conf 0.95 / `verified`; memory evidence still carries zero weight.
2. **Thin research timeout.** `DEFAULT_TIMEOUT_MS` in `research_dispatch.ts`
   bumped 540_000 → **660_000** (local 27B researcher observed at 508.6s; new
   headroom 151s; `PI_RESEARCH_TIMEOUT_MS` override unchanged).
3. Probe suite after fixes: `probe_evidence` 12/12 (new), `probe_shapes` 13/13,
   `smoke_dispatch` 19/19, `smoke_wiring` PASS (live 4B librarian).
4. Scratch payload `C:/Users/brutc/ulw-webnudge` reset (TODO unchecked, generated
   files removed) for the next stress test.

## Rough edges (superseded by Phase E above; kept for the record)

1. ~~Ledger under-credit~~ — resolved, root cause was the classifier domain list, see Phase E #1.
2. ~~540s timeout vs 508.6s local researcher~~ — resolved, bumped to 660s, see Phase E #2.
3. `probe.ts` (Run 1) imports `node-fetch` though bun has global `fetch` (works;
   auto-installed) — payload-side nit, not mechanism.

---

## Phase P — Paper Publication (09-19, this session)

**Scope:** `agent/prj-ultrawork-paper-publish/` — experiment, charts, PDF paper. **Deliverable: ≤4-page PDF with charts/proofs.**

### Key Design Decisions (operator-directed)
- **Narrative reframe:** Lead with **WITH-ulw vs WITHOUT-ulw workflow behavior** (not timing). Timing = cost column only.
- **Weak-model extension:** Test with `nvidia/nemotron-3.5-lightning-30b-a3b` (3B active) and local `qwen3.5-4b` — demonstrate mechanism protects weaker weights.
- **Replication:** 3–4 replicates per cell for stochasticity (n=3–4 dummy, n=3 27B).
- **Metric:** Deliverable Quality (DQ, 0–1) = composite of fact accuracy, behavior (live test), citation, code quality — answers "how much better/worse is the artifact."

### Paper Findings (as of 09-19 19:30, 11 valid cells scored)

| Model | Condition | n | DQ | fact_err | Tests | Completes |
|---|---|---|---|---|---|---|
| **4b local** | WITHOUT | 1 | **0.00** | — | False | **No (cap hit)** |
| **4b local** | WITH | 1 | **1.00** | **0** | **True** | **Yes (perfect)** |
| **3B active** | WITHOUT | 2 | 0.62 | 2.5 | 50% | Yes (variable) |
| **3B active** | WITH | 1 | 0.84 | 2.0 | 100% | Yes (lift) |
| **27B** | C0/C1/C2 | 2 each | 0.97 | 0.0 | 100% | Yes |

**Headline:** The weakest model (4B local) **fails to complete** without ulw but **succeeds perfectly** with ulw (DQ 1.0, all 5 defaults correct, green test). The 3B-active cloud model lifts DQ from 0.62 → 0.84. 27B is robust regardless.

### Paper Assets
- `experiments/EXPERIMENT.md` — full protocol, dummy-proof design, DQ metric, replication protocol
- `charts/make_charts.py` — fig_main_comparison (DQ by model×WITH/WITHOUT with whiskers), fig2_fact_errors, fig3_vbc_time
- `paper/paper.html` — WITH-vs-WITHOUT framing, TL;DR for 15-sec skim, mechanism diagram (Fig 1), results table, charts
- `paper/paper.pdf` — **3 pages** (≤4 budget), Chrome headless with temp profile
- `grading/grade.py` + `aggregate.py` — deterministic grader with DQ composite, per-model×cond stats

### Replication Grid Running
- `reps_grid.sh` active: 3 rounds dummy (nemo-C0/C2, 4b-C0/C2) + 2 rounds 27B (A-C0/C1/C2, B-C0/C1/C2)
- Sequential, pruner OFF, one model at a time (llama.cpp constraint)
- Target: n=3–4 weak, n=3 27B

### Artifacts
- All ground truth LIVE-verified 2026-09-18 (browser + on-disk): p-retry retries=10, undici timeouts
- Scoreboard: `experiments/runs/scoreboard.json` (11 valid rows)
- Voided cells documented (conn error, degenerate) — never averaged