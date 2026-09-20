# Ultrawork — Refactor Changelog

**Date:** 2026-09-10
**Scope:** `ultrawork.ts` + the `ultrawork/` submodules
**Status:** Typechecked (strict, noUnusedLocals/Parameters), loaded through pi's own
jiti loader, and behaviorally smoke-tested. Backups preserved (see *Rollback*).

---

## Summary

A single architectural fix — **memory evidence carries zero confidence weight** — plus
four bug fixes (B4, B2/B3, B5, B7) and a set of cleanups (B1, B6–B10) and dead-code
removal. The core problem was a **circularity**: the research loop asked the local
model to "verify" a claim, the model recalled from memory (no tools), that recall was
stored as high-authority evidence, and the confidence math marked the claim
`verified` — so a claim could confirm itself from its own weights with no live source
ever opened.

Net result: **1596 → 1464 lines** (−132) *while* adding the shared LLM helper, the
language-agnostic resource list, per-claim nudge output, and the load-bearing answer
gate.

| File | Before | After | Δ |
|---|---|---|---|
| `ultrawork.ts` | 623 | 710 | +87 |
| `ultrawork/evidence_state.ts` | 317 | 330 | +13 |
| `ultrawork/research_loop.ts` | 396 | 245 | **−151** |
| `ultrawork/epistemic_protocol.ts` | 260 | 179 | **−81** |

---

## The four priority fixes

### P1 — B4: source label reconciled against the URL in `addEvidence`
*File: `evidence_state.ts`*

**Before:** the agent (or the loop) reported `source: "official_docs"` with
`url: "https://reddit.com/..."` and the label was trusted at authority 1.0. The
self-assigned label was the load-bearing — and circular — signal.

**After:** `addEvidence` calls `classifySource(url)` and takes the **lesser** of
(reported label, URL-classified label) as the effective source. A `reddit.com` URL can
no longer masquerade as `official_docs`. When the label is downgraded, the original
label is preserved on `reportedSource` for display. Memory evidence (`origin:
"memory"`) is never reconciled from its *recalled* URL — a remembered pointer is not
proof of what the page says.

```
official_docs + reddit.com  →  community  (0.45), reportedSource = "official_docs"
official_docs + docs.python.org  →  official_docs (1.0)   [label honest, kept]
```

### P2 — B2/B3: collapse duplicate status functions
*Files: `evidence_state.ts`, `research_loop.ts`*

**Before:** `research_loop.ts` had its *own* private `recalculateConfidence` and
`determineStatus`, which could diverge from `evidence_state.ts` on the *same* claim —
so `evidence_add` and the research loop could disagree about a claim's confidence and
status.

**After:** one shared implementation each, exported from `evidence_state.ts` and
imported by `research_loop.ts`:
- `recalculateConfidence(claim)` — squares authority for a strong high-authority
  signal; guards the all-zero (memory-only) case so it returns `0`, not `NaN`.
- `resolveStatus(state, claim)` — shared status resolver (see B1 for the
  `state`-dependency and B3 for the conflict fix).

`research_loop.ts` no longer keeps copies; it delegates.

### B3 (part of P2): conflict = opposing *content*, not source-type diversity
*File: `evidence_state.ts`*

**Before:** a claim was "conflicted" when it had *diverse source types* — so three
different sources all **agreeing** could be flagged as a conflict (a false positive),
while two sources of the *same* type genuinely **disagreeing** were not (a false
negative).

**After:** conflict is detected on the *excerpt text*. `NEG_RE`/`AFF_RE` look for a
negation and an affirmation; a genuine conflict requires both, on **≥ 2 distinct
source types** (`hasOpposingEvidence`). And — decided during behavioral testing — a
detected content conflict is conflicted **regardless of aggregate confidence**: the
authority-weighted confidence is exactly what would mask a live dispute (official docs
say "yes", another source says "no"). Verified test:
`official_docs "supports"` + `community "does not support"` → **conflicted** (conf
0.83). Three agreeing diverse sources → **verified**, not conflicted.

### P3 — B5: shared, error-wrapping LLM call
*File: `ultrawork.ts`*

**Before:** `callLibrarian` and `rawLLMCall` each had their *own* inline `fetch` with
**no** error handling. A non-2xx with an HTML body would `res.json()` → parse error →
`research_loop` rejected outright, while `callLibrarian` survived by luck. Asymmetric,
duplicated.

**After:** one `chatCompletion(system, user, opts)` helper (enqueue → fetch →
`res.ok` check → safe `res.json()` with a descriptive throw). Both call sites go
through it. `rawLLMCall` wraps it in try/catch and returns `""` on error, so a flaky
router degrades to "no evidence recalled" → confidence 0 → `pending_research`, instead
of rejecting the whole tool. Error handling is now **symmetric**.

### P4 — relabel the research loop as a *memory nudge*, not verification
*Files: `ultrawork.ts`, `research_loop.ts`*

The loop is reframed end-to-end as **recall**, so the agent isn't tricked into
treating it as a green light:
- `buildResearchPrompt`'s system prompt now says: *you are a memory-recall process,
  NO tools, a URL you recall is a POINTER TO CHECK not proof.*
- `researchClaim` tags every parsed entry `origin: "memory"` (zero weight — see below).
- `research_loop` tool description/promptGuidelines now say: *a nudge, not live
  verification; to verify, open the source in a browser and call `evidence_add` with
  the URL you actually opened.*
- `runResearchLoop` now **returns** a per-claim summary the tool surfaces:
  `claim_N [status conf=0.00] -> <latest memory recall>`, so the agent sees *what to
  go check* for each claim rather than "Research loop complete."

---

## The memory = zero-weight fix (the circularity breaker)

*File: `evidence_state.ts` (data + math); `research_loop.ts` (tags the evidence)*

Every piece of evidence from the tool-less librarian is stored with
`origin: "memory"`, `authority: 0`. Consequences, all verified by test:
- memory-only claim → confidence exactly **0** (not `NaN`), status **not** verified;
- memory never counts toward "strong"/"corroborated" in `resolveStatus`;
- only `evidence_add` with a real URL the agent opened can push a claim to
  `verified`.

This is what makes the whole thing non-circular: a claim's confidence now reflects
*evidence the agent actually opened*, not the model's self-assigned label.

`EvidenceEntry` gained two optional fields: `origin?: "external" | "memory"` and
`reportedSource?: EvidenceSource`.

---

## Cleanup items

### B1 — `minConfidenceForAnswer` is now load-bearing
*File: `evidence_state.ts`, `ultrawork.ts`*

**Before:** the config knob existed but nothing read it — every claim verified at the
same hard-coded floor.

**After:** `minConfidenceForAnswer` is stored on `EvidenceState`, and
`resolveStatus(state, claim)` uses it as the "verified" threshold. `canAnswer(claim,
minConf)` takes the threshold explicitly. It's threaded from `createResearchLoop`
config → engine → `createEvidenceState`. `evidence_check` and `/ulw-evidence` now
report **`Ready to answer (verified, conf >= 0.7): N`**.

Note the deliberate split: `RESEARCH_BELOW = 0.5` ("keep trying / still queue for
recall") is distinct from `minConfidenceForAnswer = 0.7` ("good enough to answer").
Both are meaningful but different gates.

### B6 — research loop no longer burns 3 identical memory calls
*File: `research_loop.ts`*

**Before:** a fixed 3-round loop re-asked the local model 3× for the same claim,
getting the same memory recall each time.

**After:** the inner loop breaks when a pass makes no confidence progress
(`if (c.confidence <= confBefore) break;`). Since a recall pass adds only memory
(0-weight) evidence, a pure-memory claim resolves in **exactly 1 recall**. Verified:
1 call per invocation; across 5 invocations a claim is recalled exactly
`maxRounds=3` times total, then drops out of the queue (`research_rounds` caps, and
`getClaimsNeedingResearch` stops queuing it).

### B7 — `reground_check` reports honestly
*File: `ultrawork.ts`*

**Before:** always returned `"Reground check dispatched."` even when it skipped
(nothing to flag, or another check in flight).

**After:** returns a truthful message distinguishing *"nudge delivered"* from *"ran
but delivered no nudge (nothing to flag, or already in flight)"*; the result `details`
carries `delivered: boolean`.

### B8 — language-agnostic critical resources
*File: `ultrawork.ts`*

**Before:** a hard-coded list of 4 paths (`README.md`, `TODO.md`, `package.json`,
`src/main.ts`). A Python/Go/Rust project was left with basically just `TODO.md` to
audit.

**After:** probes a **language-agnostic** candidate list (npm/pip/Cargo/Go/Maven/
Gradle/Python setup + TS/Py/RS/Go entry points), keeps only files that exist, caps at
10. `TODO.md` still gets auto-tracked if it appears late (`ensureTodoTracked`). This
list is only a *secondary hint* — the tool-activity digest is the real signal.

### B9 — resource "touched" matching uses a path boundary
*File: `ultrawork.ts`*

**Before:** `blob.includes(r.path)` — so `package.json` inside `my-package.json`
falsely marked `package.json` as touched.

**After:** `resourceTouched(blob, path)` requires the character before the match to
*not* be `[A-Za-z0-9_-]`, i.e. a path-like boundary. Still intentionally approximate
(a reminder, not a ledger).

### B10 — digest buffer cleared after a delivered nudge
*File: `ultrawork.ts`*

**Before:** the same last-15 tool calls were re-sent to the librarian on every trigger
because `digestBuffer` was never drained.

**After:** `digestBuffer.length = 0` after a successful nudge, so each trigger shows
fresh activity.

### Minor — timer leak
*File: `ultrawork.ts`*

The two deferred follow-up `setTimeout`s (compact message, loop-guard message) are now
routed through a `schedule()` helper that tracks them in `pendingTimeouts`. A new
`session_shutdown` handler clears pending timers + `pendingArgs` so a late timer can't
land a nudge into a brand-new session.

### Minor — dead imports
`writeFileSync`, `mkdirSync` (unused `fs` imports) and an unused `ctx` param in
`evidence_check` removed.

---

## Dead code removed

**`epistemic_protocol.ts`** (260 → 179): removed the *stateful* `EpistemicProtocol`
engine class (constructor + `registerClaim`/`addEvidence`/`processClaim`/`canAnswer`/
`getEvidence`/`getSummary`) and its `EpistemicConfig`/`EpistemicResult` types — it
instantiated a *second* `ResearchLoopEngine` internally, a full duplicate of
`research_loop` with **zero callers**. Kept: the one consumed piece
(`static buildSystemPromptSection()`) plus the small pure utilities
(`classifyClaim`, `getLevelDescription`, `buildEpistemicFirewall`,
`buildResearchConstraints`).

**`research_loop.ts`** (396 → 245): removed `ResearchResult`, `ResearchPlan`,
`researchHistory`, `shouldResearch`, `canAnswerClaim`, `getResearchSummary`,
`getVerifiedEvidenceForClaim`, `serialize`, `deserialize`, and the private duplicate
`recalculateConfidence`/`determineStatus` (→ shared, see P2). `registerClaim` and
`addEvidenceToClaim` reduced to thin delegations.

**`evidence_state.ts`** (net +13, so removal was offset by the new load-bearing
logic): removed `updateClaim`, `getUnverifiedClaims`, `getConflictedClaims`,
`getClaimsByConfidence`, `serializeState`, `deserializeState`,
`shouldResearchAgainWithMax`.

---

## Public API preserved (consumed by `ultrawork.ts`)

- `EpistemicProtocol.buildSystemPromptSection()` — unchanged call site.
- `createResearchLoop(config)` → `ResearchLoopEngine` with: `state` (getter; has
  `.claims: Map` and `.minConfidenceForAnswer`), `registerClaim`, `addEvidenceToClaim`,
  `runFullLoop(librarianCall)`. (Public `buildResearchPrompt`, `researchClaim`,
  `parseResearchResponse` retained.)
- From `evidence_state.ts`: `classifyThreshold`, `detectUnknownSignals`,
  `getClaimsNeedingResearch` (used before) **+** new `canAnswer` and type
  `EvidenceSource` imported by the tool layer.

No symbol referenced by `ultrawork.ts` was renamed or removed; no other file imports
these modules (verified by grep).

---

## Verification performed

1. **Typecheck** — `tsc --noEmit --strict --noUnusedLocals --noUnusedParameters
   --moduleResolution bundler` over `ultrawork.ts` (pulls in all submodules):
   **exit 0**, no errors, no unused locals/params. (Two real errors found and fixed:
   an `unknown → EvidenceSource` cast in `evidence_add`, and a missing `| undefined`
   in `addClaim`.)
2. **Load test** — all four modules imported through **pi's actual jiti loader**
   (`@mariozechner/jiti`): load without error; export lists match expectations.
3. **Behavioral tests** (all passing): B4 label downgrade + honest-URL retention;
   memory authority=0 / conf=0-not-NaN / not-verified; `canAnswer` at the 0.7 and 0.99
   gates; B3 diverse-same-content NOT conflicted vs. B3b opposing-content → conflicted
   even at conf 0.83; loop short-circuit (exactly 1 recall for a pure-memory claim,
   `maxRounds` caps total recalls across invocations).

---

## Rollback

Backups taken before any edit:
- `ultrawork.ts.bak` (original `ultrawork.ts`, 623 lines)
- `ultrawork.bak/` — `evidence_state.ts`, `research_loop.ts`,
  `epistemic_protocol.ts`, `logger.ts` (originals)

To revert: copy `ultrawork.ts.bak` → `ultrawork.ts` and the contents of
`ultrawork.bak/` → `ultrawork/`. `logger.ts` was not modified.

---

## Live supervision run (qwen3.5-4b agent, qwen3.8-27b librarian)

To exercise the extension under real load, pi was launched in a throwaway folder
(`~/downloads/throwaway`) with the 4B model as the agent and the 27B as the
librarian, `/ulw` enabled, and given a long multi-module Python build (8 modules +
60+ tests + iterative `pytest` runs) sized to force repeated compactions.

Everything the design promises fired correctly:
- `/ulw` activation → completion-contract + epistemic-protocol injection.
- `TODO.md` auto-tracked when it appeared; digest buffer populated + cleared on nudge.
- **2 compactions** observed (context hit the 126976 peak each time): `session_compact`
  marked touched resources stale, reset the trigger, and the 3s follow-up message was
  delivered into the agent's context.
- Loop guard (`agent_end`) read the live `TODO.md` each turn and reported honestly.
- Agent made steady, real progress (32 → 28 failing tests) — it was not stuck.

### Issue L1 — librarian 60s timeout too short for the 27B model

The very first trigger after idle **AbortError'd at exactly 60s** every time. The 27B
librarian cold-loads into VRAM *and* its router call contends with the agent's own
generation on the same llama router, so 60s is frequently not enough. When the model
was warm the same call took ~37s and succeeded. Net effect: the first nudge after any
idle period was usually lost.

### Issue L2 — post-compact librarian storm

`session_compact` resets `lastLibrarianTokens` to 0. The post-compact context is
already ≥ the 80k trigger, so the `tokens − lastLibrarianTokens ≥ 20k` gate became
*always true*. Worse, a call that **times out never advances `lastLibrarianTokens`**
(it only updates on success), so every subsequent tool call re-fired the librarian.
Result, measured in the running session: **54 librarian calls, 34 timeouts (63%),
2 nudges actually delivered (4%)** — a continuous storm of 60s aborts burning router
capacity the agent needs, while delivering almost no ground.

### Fixes applied (this session)

- **L1:** the librarian now calls `chatCompletion` with a dedicated
  `LIBRARIAN_TIMEOUT_MS = 150_000` (new optional `timeoutMs` on `chatCompletion`,
  defaulting to the shared `config.timeoutMs` for the research path). 150s covers the
cold-load + contention window; warm calls still finish in ~37s.
- **L2:** added a time-based cooldown — `lastLibrarianFinishedAt` is set in the
  `finally` block, and the auto-trigger now also requires
  `Date.now() − lastLibrarianFinishedAt ≥ LIBRARIAN_COOLDOWN_MS (60s)`. A call that
  times out can no longer immediately re-fire; at most ~1 call per cooldown window,
  and the 150s budget lets it actually complete. The token-delta gate and the
  `librarianRunning` debounce are unchanged.

Both edits are type-checked (`tsc --strict --noUnusedLocals` exit 0) and load through
pi's jiti loader. They take effect on the **next** pi launch (the supervised session
had the pre-fix code loaded).

### Minor (not bugs)
- `ctx.ui.notify("Librarian failed: …")` on error is a **TUI toast only** — it is
  *not* delivered into the model's context, so a failed librarian doesn't pollute the
  transcript. (Confirmed in code: only `sendMessage`/`steer`/`sendUserMessage` enter
  context.)
- The loop guard trusts the agent to mark `TODO.md` `[x]` honestly. A small model can
  mark an item `[x]` prematurely; the guard then correctly reports `incomplete=false`.
  That's a task/prompt concern, not an extension defect, but a stricter guard could
  cross-check the agent's final message against the open items.
