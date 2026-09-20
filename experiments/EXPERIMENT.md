# EXPERIMENT — Ablation of the ultrawork web-nudge mechanism (paper: prj-ultrawork-paper-publish)

**Hypothesis.** On a task that forces exact documented defaults of a small-API dependency into the artifact, a small local model (qwen3.8-27b, 127k ctx, llama.cpp router) that is given (a) a trust-shape system prompt + completion contract, and (b) a SEQUENTIAL research_dispatch action (fresh same-weight librarian that opens live docs), produces more frequently correct documented facts, more frequently BEFORE writing code, than the same model with (a) only or neither — at bounded wall-time cost.

## Conditions (env-gated, identical launch otherwise)
| Cond | Env | Tools visible | Prompt section | Nudge/loop-guard hooks | research_dispatch |
|---|---|---|---|---|---|
| C0 | PI_ULW_OFF=1 | none | no | no | no |
| C1 | PI_ULW_AUTOACTIVE=1 PI_ULW_NO_DISPATCH=1 | evidence_* + reground | YES | yes | **no** |
| C2 | PI_ULW_AUTOACTIVE=1 | all | YES | yes | yes |

Launch (identical all cells): headless `pi -p --provider llamacpp --model qwen3.8-27b "<fixed prompt>"` from a pristine payload dir; wall cap 2400s; strictly sequential (single 27B in VRAM).

## Payloads (both force: docs-URL citation + option→default table + working smoke test)
- **A — p-retry 8.0.1** (retry utility; trap shape: numeric defaults; weight-trap `retries`=2 vs documented 10).
  Ground truth (live-verified 2026-09-18 from sindresorhus/p-retry README via npm page + raw README, on-disk node_modules): `retries` 10, `factor` 2, `minTimeout` 1000 ms, `maxTimeout` Infinity, `randomize` false. Valid URL families: npmjs.com/package/p-retry, github.com/sindresorhus/p-retry, raw.githubusercontent.com/sindresorhus/p-retry.
- **B — undici 8.x** (HTTP client timeout options; trap shape: numeric defaults + the universal-negative "fetch() has no `timeout` option").
  Ground truth (live-verified 2026-09-18 from nodejs/undici main docs/docs/api/Client.md): `headersTimeout` 300e3 ms, `bodyTimeout` 300e3 ms, `connectTimeout` 10e3 ms, `keepAliveTimeout` 4e3, `keepAliveMaxTimeout` 600e3, `keepAliveTimeoutThreshold` 2e3. Valid URL families: github.com/nodejs/undici, raw.githubusercontent.com/nodejs/undici, undici.nodejs.org, npmjs.com/package/undici.

## Metrics (deterministic grader: grading/grade.py)
1. `fact_correct` / `fact_errors` — per required option in the comment table (correct/wrong/missing vs ground truth; wrong value = 1 error).
2. `url_ok` — a cited official docs URL present in the comment block.
3. `tests_green` — `bun test` on the snapshot (router live at 127.0.0.1:1234).
4. `verify_before_code` — session-JSONL forensics: first official-source touch (browser nav / bash curl / read of node_modules readme) precedes first src/probe.ts write.
5. `evidence_artifacts` — count/status of .pi/evidence/*.json (mechanism telemetry; >0 only possible C1/C2).
6. `dur_s`, `rc` — wall time, exit status.

## Metric 7 — deliverable quality (composite, added 2026-09-19)
`deliverable_quality` (DQ, 0..1) = mean of the available normalized axes:
- `fact` = fact_correct / #required options (accuracy of the documented-defaults table — the actual claim, not just "compiles")
- `behavior` = tests_green (the smoke test hits the LIVE router and asserts ≥1 loaded id)
- `citation` = url_ok (an official docs URL is cited)
- `code` = objective code-quality sub-score (0..1 over 4 checks: p-retry actually wraps the fetch; correct `probeLoadedModels`/`Promise<string[]>` signature; typed; error handling) — `hallucinated_options` reported separately (a misspelled retry key like `maxRetries`/`retryCount` flags confabulation).
This is the "how much better/worse the artifact is" number, per condition. Fact is the trap axis; code/behavior keep it from being "just compiles."

## Extension — dummy-proof test (weak model, WITH vs WITHOUT ulw; added 2026-09-19)
Same payload A (p-retry trap) and identical launch, but the model is a WEAK one, to isolate the mechanism from strong weights:
| Cell | Model | Cond | Env | purpose |
|---|---|---|---|---|
| A-C0-nemo | nvidia/nemotron-3.5-lightning-30b-a3b (3B active) | C0 | PI_ULW_OFF=1 | weak weights, no ulw (control) |
| A-C2-nemo | same | C2 | PI_ULW_AUTOACTIVE=1 | weak weights + full mechanism |
| A-C0-4b | llamacpp/qwen3.5-4b (local) | C0 | PI_ULW_OFF=1 | local weak, no ulw |
| A-C2-4b | same | C2 | PI_ULW_AUTOACTIVE=1 | local weak + mechanism |
Truthfulness: in C0 the extension is fully inert (all 5 tools unregistered, no prompt section, no hooks — verified by code gate at ultrawork.ts:95/612-767 and an earlier INERT smoke), so no ulw triggers unless /ulw or AUTOACTIVE is set. The C2 librarian runs the SAME weak model (ctx.model), so the test is same-weights end to end.
Prediction (the claim): WITHOUT ulw, the weak model's confabulated defaults leak into the artifact (fact_errors>0); WITH ulw, the out-of-band librarian re-verifies against live docs and the artifact's defaults become correct — i.e. the mechanism lifts weak-model DQ toward strong-model DQ.

## Replication protocol (stochasticity; added 2026-09-19)
Every condition is run n=3–4 times (reps_grid.sh): 3 rounds × {nemo-C0,nemo-C2,4b-C0,4b-C2} + 2 rounds × the 6-cell 27B grid. Strictly sequential, one model at a time (llama.cpp degrades under concurrent requests). Per-condition stats (mean/range of fact_errors and DQ, n, wall-time) come from grading/aggregate.py → aggregate.json. Cells that die on infra (router down → "Connection error.", or a model degenerate-run that never wrote src) are voided (dir renamed *.VOID-*) and excluded, never silently averaged.

## Known design risks (disclosed in paper limitations)
- C0 can self-verify from node_modules (observed A-C0) — the mechanism's claimed edge is *before-code ordering + consistency + the no-local-docs case*, not raw doc access.
- n=1/cell per payload initially (budget: single 27B in VRAM, ~20–30 min/cell). Replicates if time allows.
- Same-weights researcher (by design; the paper's premise) — not a stronger-model confound.
- Router state (27B+4B loaded) identical across cells; runs strictly sequential.

## Artifacts
- `runs/<P-COND-TS>/` — src/, test/, TODO.md (final), session.jsonl, ulw.log slice, run.log, bun-test.txt, timing.txt, dot-pi/evidence/
- `scoreboard.json` — merged grader output
- `grid.log` — cell chronology
