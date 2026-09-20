# Ultrawork — Deep Analysis

Date: 2026-09-15 · Scope: `ultrawork.ts` + `ultrawork/` modules + 26 days of telemetry
(212 sessions, 45k log lines, 2026-08-20 → 2026-09-15) · Method: the seam/scramble/null-model
principles from the brief, applied to the extension's own claims about itself.

---

## Revision — 2026-09-16: production model is 27B; the 4B was a probe

Operator correction, verified against pi's own session files (event-time
ownership join of `ultrawork.log` to per-session JSONL; full-log cross-check
agrees within 1–2 points): **the production agent is qwen3.8-27b — the same
weights that serve as the librarian.** qwen3.5-4b was a 7-day probe (active
08-22→09-14; 2 /ulw activations, 21 agent_ends). Re-sliced by owning
session/model:

| Agent model | agent_end | trips | trip % | nudges | /ulw | claim-tool calls |
|---|---|---|---|---|---|---|
| **qwen3.8-27b (production)** | 484 | 131 | **27.1%** | 360 | 55 | 26 |
| qwen3.5-4b (probe) | 21 | 0 | 0% | 2 | 2 | 11 |
| other probes (1b/2b/tiny/GLM/Kimi/35b) | 25 | 0 | 0% | 0 | 0 | 0 |

≈99% of all ultrawork events are production-model events, so the mixed numbers
in §1 *are* the production numbers — but three attributions flip:

1. **The loop guard is not a metronome for a weak model.** The 4B probe never
   tripped (0/21); the 27B trips 27.1%. The trip rate is a model/task
   interaction, not a system constant — the 27B does long TODO-driven work and
   stops with items unchecked; the 4B probe had little TODO structure to trip
   on. §2.1's question is reframed, not answered: *why does the production
   model stop with unchecked items 27% of the time* (TODO discipline / task
   shape / retry budget) — not "does a small model stop too often".
2. **The epistemic layer's low usage is not a model-capacity effect.** The 27B,
   a model fully able to follow the protocol, used it ~1.1×/day; the 4B probe
   ~1.6×/day. The layer has no forcing function and *both* models treat it as
   optional. §2.3's "too small to register" reading is retired; §8.3-C
   (dormant) is strengthened — the fix has to be a gate or implicit
   registration, not a bigger model.
3. **The librarian and the production agent are the same weights.** New seam:
   *self-observation* (shared priors and shared blind spots — the 27B cannot
   flag what it itself cannot see) and *self-contention* (the librarian's 15s
   p90 call queues on the same router/VRAM as the agent's own turns). The P0
   compliance audit now measures a *self-correction rate*: does the 27B follow
   the 27B's advice? And 8.2-C (signature gating) now doubles as a
   queue-contention fix.

The "biggest confound" paragraph in §6 is retired and replaced by the
residual confounds listed there (27B-variant drift — second-order, since ≈99%
of events attribute to 3.8-27b — and the same-weights seam).

---

## 0. What this system actually is (seam map)

The extension is a **4-layer stack**, and the analysis below turns on which layer is
credited for what:

| Layer | Component | Role |
|---|---|---|
| L1 substrate | qwen3.8-27b via local llama.cpp router | librarian: bullet nudges + memory recall |
| L2 harness | `ultrawork.ts` state machine | token-threshold triggers, stale-marking, loop guard, timer hygiene |
| L3 interpreter | injected system prompt (completion contract + epistemic protocol) | tells the agent what to believe about itself |
| L4 controller | the agent model itself (qwen3.5-4b in the supervised run) | does the actual work, decides whether to obey nudges |

**Attribution risk at the seams:** every visible output (finished task, re-read
README, opened source) is the product of L4 executing under L3's instructions,
nudged by L1 content that L2 chose to deliver at a chosen time. The extension's own
narrative (changelog, prompt text, tool descriptions) almost entirely credits **L2**
("ENFORCED BY HARNESS") and **L1** ("the librarian audits"). The telemetry shows a
different center of gravity, detailed in §2.

One structural fact worth stating plainly: **the 27B model is the smallest
load-bearing part of the system.** Its outputs are ≤220 tokens of bullets at
temperature 0.2, fed a fixed template + a file list + a 15-line activity digest. The
production agent (qwen3.8-27b — the **same weights as the librarian**) is the
one integrating 504 nudges, 132 resume messages, and an epistemic protocol into
behaviour. When any of that works, it is the L3→L4 handoff working — and it is
a handoff in which both sides are the same model.

---

## 1. Base rates — what the logs actually show

| Behaviour | Count | Rate | Read |
|---|---|---|---|
| Sessions started | 212 | — | span 26 days, ~8/day |
| `/ulw` activated | 57 | **27% of sessions** | the rest of the time the extension is a logging harness only |
| Prompt injected | 226 | ~4/session | (re)injected every agent turn while active |
| Librarian calls started | 504 | — | only fires in sessions that pass 80k tokens |
| → nudges delivered | 362 (72%) | — | warm latency p50 14.8s, p90 15.8s |
| → skipped (already running) | 90 (18%) | — | debounce doing real work |
| → errors | 52 (10%) | — | all pre-fix (60s AbortError ×8 on 09-11; 305s `fetch failed` ×7 on 09-12; remainder earlier) |
| → "nothing to reground" | **3 / 362 (0.8%)** | — | see §2.3 |
| Loop guard tripped | 132 / 566 agent_end (23%); **27.1% on the 27B (131/484), 0% on the 4B probe (0/21)** | — | 16 skipped (no TODO.md) |
| Compactions | 130 | ~1/2 sessions | the system is constantly at the context wall |
| `evidence_register` / `evidence_add` | 18 / 15 | over **26 days** | the entire epistemic layer |
| `research_loop` calls | 12, **all one afternoon (08-28), all `pending=0`** | — | the agent invoked it and was told "no claims need research" every time — on a probe-era model-hopping afternoon; treat as tool exploration, not workflow |
| `reground_check` (agent-called) | 0 | — | |
| `/ulw-check` | 0 | — | exists only for debug |

Two things the base rates say that the code's narrative doesn't:

1. **The epistemic layer is the least-used part of a system that exists mostly to
   be epistemic.** 37 tool invocations vs 504 librarian calls vs 132 loop-guard
   resumes, over 26 days, on an agent model chosen specifically for its
   confident-hallucination failure mode. The protocol is ~30 lines (~240 tokens) of
   the system
   prompt and 830 lines of code carrying a base rate of ~1.4 tool calls per day.
2. **The 12 `research_loop` calls all landed on `pending=0`.** The agent called the
   tool, got back "no claims need research", presumably without noticing that no
   claims had ever been registered. Tool and loop work, but the *handoff from the
   agent's behaviour to the tool* (registering claims) is where the machinery
   starved.

---

## 2. Component by component: claim vs what the evidence earns it

### 2.1 Loop guard (agent_end → resume message)

**Claim:** prevents premature stopping by re-checking TODO.md.
**Status: the most load-bearing component, and its effect is still unattributed.**

- 23% of agent_end events trip it. That's not an edge case; it's a standing
  feature — and the Revision block shows the mix doing work here: **the
  production 27B trips at 27.1% (131/484), the 4B probe at 0% (0/21)**. The
  trip rate is not a system constant; it is a model/task interaction. So the
  null question is *which of the 27% on the production model were real
  premature stops versus the 27B's work style — long TODO-driven tasks where it
  stops with items unchecked.* The guard can't tell "done but forgot to tick the
  box" from "done and the box is a lie" — the changelog concedes the guard
  *trusts the agent to mark [x] honestly*. The metronome reading (keep a small
  model moving) is now the *minority* explanation: the small model never
  tripped. The live question is TODO discipline and task shape on the
  production model. Both
  readings produce the same 132 log lines. That ambiguity is currently
  unbroken: no A/B of guard-on vs guard-off on the same task exists.
- Cost is cheap (a file read + a 500ms-deferred message), so even if the
  attribution is "metronome", the component is worth keeping. **Held as finding,
  not just candidate.**

### 2.2 Librarian auto-trigger (the 80k/20k token gate)

**Claim:** re-grounds the agent before compaction buries context.
**Status: the trigger mechanics are sound; the delivered value is partly template.**

- The trigger design survived a real failure (the post-compact storm: 54 calls,
  34 timeouts, 4% delivery, per the changelog) and the fix set (400s timeout, 60s
  cooldown, baseline-reset on prune flush) is exactly the right shape. The
  cooldown measurably works: 18% skip rate, 0 storms since 09-14.
- **Scramble test on the nudge content** (this is the move that matters): take a
  delivered nudge and ask what a *structureless* generator would emit given the
  same inputs (resource list + 15-line digest + fixed system prompt). From the
  12 most recent samples: nearly all open with *"README.md never opened — but is
  it relevant?"* and *"TODO.md may be stale after compaction at 101k tokens"*.
  That first bullet is **the resource list parroted back by the template**, not an
  audit finding — a `for r in untouched: print(f"- {r.path} never opened")` loop
  reproduces it with the 27B removed entirely. The model even narrates its own
  uncertainty in the bullet ("probably not critical, but worth noting"), which is
  a fingerprint of the prompt's "if nothing is worth flagging…" clause doing the
  shaping, not the model's judgment.
- **But** the same samples contain a second bullet type that a dumb reminder
  *cannot* produce: *"multiple navigations to the same URL suggest the agent is
  stuck in a loop"*, *"repeatedly clicking the Applied radio button… this looks
  like a job application form the agent is cycling on"*. That is genuine
  pattern-detection over the digest — a meta-observer catching loop behaviour the
  agent, inside the loop, is structurally bad at seeing. (Since the librarian
  and the production agent are the *same weights*, this is self-observation:
  the 27B recognises its own loop patterns — and shares its own blind spots, so
  it cannot flag what it itself cannot see.) **That second bullet
  type is the librarian's real delta over the null.** Its frequency and its
  hit-rate (did the agent break the loop after the nudge?) are both unmeasured.
  The 0.8% "nothing to reground" rate confirms the call almost always returns
  *something*, but says nothing about whether the something changed behaviour.

**Perturbation signature:** the librarian's output degrades gracefully (a bad
response costs one nudge, errors degrade to "no nudge"), consistent with a
structure-driven (template+model) generator rather than a brittle controller.
That's fine — but it means the librarian is a *sensor*, and sensors are only worth
their latency (p90 15.8s of a shared local router slot, every ≥20k token growth
above 80k) if someone reads them. See §3.

### 2.3 The epistemic layer (evidence state, research loop, claim thresholds)

**Claim (the strongest language in the whole codebase):** "enforces
evidence-based claims at the architecture level, not just as a personality
instruction."
**Status: architecturally the cleanest code, empirically the thinnest usage.
Currently a candidate, not a finding.**

- The refactor that made it honest is genuinely good: memory=zero-weight breaks
  the self-confirmation circularity; URL-vs-label reconciliation (B4) removes the
  one load-bearing lie; shared confidence/status functions (B2) remove the
  divergence risk. The B3 fix (conflict = opposing *content*, not source
  diversity) is exactly right and the 0.83-confidence-conflicted test case proves
  the aggregate-masking failure mode was real.
- **But the base rate is the whole story:** 18 claims ever registered. 37 tool
  calls. 12 research-loop invocations, all `pending=0`, all within ~7 seconds of
  each other on a single afternoon — the shape of someone (an agent) exploring a
  tool, not a workflow running. The threshold classifier that decides whether a
  claim *needs* research (`classifyThreshold`) is a 4-tier regex on the claim
  text; it's never exercised by the agent, only inside the 18 registrations.
- **Shape-of-silence read:** the roadmap (the design doc this is built from)
  spends its whole length on exactly this layer — the Qwen-does-not-know state
  machine, the evidence store, the firewall. The implemented system's telemetry
  says the layer the roadmap cares about is the layer the system doesn't use. The
  most likely reading — **revised per the Revision block**: this is *not* a
  model-capacity problem. The production 27B, a model fully able to follow the
  protocol, used it ~1.1×/day; the 4B probe ~1.6×/day. The layer has no
  forcing function and the agent — strong or weak — treats it as optional. This
  is an L3→L4 seam failure (the prompt asks; the controller complies when it
  feels like it), not a code defect and not a model-size effect.
  The evidence machinery is *decorative until the agent is forced through it* —
  e.g. by making `evidence_check` a gate in the completion contract ("no final
  answer while claims < 0.7"), which is precisely the wiring the changelog marks
  as "intended next step".

### 2.4 The prompt injection itself

The completion contract is the highest-leverage ~20 lines in the system and the
one place the extension most honestly calls itself "ENFORCED BY HARNESS" — though
only the loop guard and the follow-up messages are actually enforced; the rest is
impressiveness. Two observations:

- The contract's items have wildly different enforcement statuses (loop guard =
  enforced; TODO.md [x] honesty = trusted; scrapbook.md update = hoped; bg_run for
  blocking commands = hoped) and the prompt doesn't tell the model which is which.
  Even a 27B can't be expected to calibrate what the prompt doesn't label. Making the enforcement asymmetry
  explicit in the prompt ("these are checked after you stop: X, Y; these are your
  discipline: Z") would cost 3 lines and would fix the most likely source of the
  23% trip rate (model stops, doesn't know it will be pinged).
- The completion contract + epistemic section (~42 lines, ~500 tokens,
  measured from source) is injected **every agent turn (226 injections)** for a
  workflow used 37 times total. That's ~500 tokens of per-turn tax on 27% of
  sessions, buying the *expectation* of live-source verification that the agent then does
  or doesn't do untracked. The tax is real; the yield is unmeasured.

---

## 3. The load-bearing uncertainty (the seam nobody has perturbed)

Everything above rests on one untested handoff:

> **After a nudge lands, what fraction of the time does the agent actually do
> the thing the bullet asked for?**

Production framing (Revision): the production agent is qwen3.8-27b — the same
weights as the librarian — so this question is now a *self-correction rate*:
does the 27B follow the 27B's advice?

The extension logs that the bullet was delivered (`NUDGE delivered as steer`) and
stops. There is no closure metric: no "after this nudge, the agent re-read
README.md within N tool calls", no "loop-nudge → navigation count dropped", no
"source-verification bullet → playwright opened the URL". The 72% delivery rate
is a plumbing stat; the 0.8% nothing-rate is a content stat; **the one stat that
determines whether this extension does its job is unmeasured.** Everything that
would currently be credited to the librarian is, strictly, credited to
"L1→L3→L4 delivery + L4 compliance", with the compliance factor free.

This is also where the strongest available discriminating test lives, and it is
cheap:

1. **Nudge-completion audit (retroactive, on existing logs):** for each of the 362
   delivered nudges, scan the following ~20 `TOOL_START` lines for the named
   action (read of the named file, navigation to the named URL, TODO.md re-read).
   Report completion rate per bullet type. This directly splits the librarian
   credit into "sensor that worked" vs "toast nobody heard".
2. **Template-scrubbed A/B (scramble test, live):** swap the 27B for a dumb
   generator — `untouched files as bullets + digest verbatim` — for one day of
   real use. If nudge-completion and task outcomes are indistinguishable from the
   27B's, the 27B's marginal value over the template is ~0 and the system should
   ship the template (and the latency/VRAM/queue contentions with it). If the
   loop-detection bullets are what drive the difference, the report tells you
   *which* bullet type to keep.
3. **Guard A/B:** same 3–4 representative tasks, guard off. If completion quality
   is identical and only time-to-stop changes, the 23% is metronome, not rescue —
   and the retry budget (4) is the only thing keeping it bounded.

None of these requires new machinery. They are the perturbation signatures the
system is currently missing for itself: it measures its own heart rate (delivery)
but not the blood pressure (behaviour change).

---

## 4. What survives (verified reads)

- **The trigger/timeout/cooldown state machine is correct and battle-tested.**
  The changelog's L1/L2 post-mortems match the log exactly (AbortError cluster at
  60.0s on 09-11 pre-fix, none after; the storm pattern is visible in the
  call/skip counts). This part of the code has been through its scramble test
  already — by failure, and the fixes are the right shape.
- **The evidence math is honest.** Memory=zero, URL-reconciled labels,
  content-based conflict, single shared confidence/status path, an explicit
  research-floor vs answer-gate split. It does what its comments claim and the
  18 claims processed through it are consistent with the math (no claim verified
  from memory-only evidence anywhere in the logs).
- **Logging discipline is above the base rate for tools of this kind.** A 6MB
  append-only, never-throws, per-session-marked log is what made this analysis
  possible at all. That's meta: the extension's observability is currently doing
  more epistemic work than the epistemic layer.
- **Loop guard: kept** (§2.1), cheap, bounded, monotone.

## 5. What is decorative until perturbed

- **The research loop's "loop"**: with memory=zero-weight, a pass can never raise
  confidence, so `runFullLoop` runs exactly one recall per claim per invocation
  (the B6 short-circuit makes this explicit). It's a *recall queue*, and the code
  now says so — good — but the name and the `maxRounds` knob still sell the
  multi-round idea the math no longer permits. `maxRounds=3` today means "recall
  up to 3 times across *invocations*", which is a subtle semantics nobody
  documents for the agent.
- **`classifyThreshold`'s 4-level regex**: never the bottleneck, never wrong
  visibly, never the thing the agent is asking for. Fine to keep; don't credit
  it.
- **`detectUnknownSignals`** (displayed in `evidence_check`): built, wired to
  output, never the input of any decision. Pure readout.
- **The 58th command, `/ulw-evidence`**: invoked once, in 26 days.

## 6. Shape of silence — what the artefact omits

- **No off-switch.** `/ulw` activates; nothing deactivates mid-session. The
  active flag persists until process reload (436 LOADs across 212 sessions — the
  TUI was being restarted constantly, which is itself a hint the extension was
  being managed by restart rather than by control). The missing `/ulw-off` is
  small but it means the 27% activation base rate is partly "session happened to
  have /ulw typed before the agent turn", not "operator chose enforcement for
  this task".
- **No metrics beyond logs.** Every "how well is this working" question requires
  exactly the mining script I wrote for this analysis. The extension measures its
  own delivery but not its outcomes (§3).
- **One project family dominates the nudge content** (job-application automation,
  09-14/15). The 27B-as-meta-observer reading in §2.2 rests mostly on that family.
  On coding tasks (qwm-core era, 08-20→28) the librarian logs are thinner; the
  loop-detection behaviour hasn't been observed there. Held as provisional.
- **The model confound is resolved by the Revision block** (production =
  qwen3.8-27b; the 4B was a 7-day probe). The residual confounds are (a)
  *27B-variant drift* — 3.5/3.6/3.8-27b all appear in the session files, but
  the join attributes ≈99% of events to 3.8-27b, so variant effects are
  second-order — and (b) the **same-weights seam**: librarian and agent are the
  same model, so every "meta-observer" measurement is a self-measurement, and
  the librarian's 15s p90 call contends with the agent's own turns on the same
  router/VRAM. The extension's value proposition ("keep the 27B honest") and
  its measured failure profile ("the 27B doesn't use the honesty machinery")
  remain the same sentence — now about the production model, which is the point.

## 7. Cost-of-rigor summary — where the effort should go next

Sorted by how much of the working frame rests on each claim:

1. **Nudge-completion audit** (§3.1) — retroactive, free, breaks the one
   load-bearing uncertainty. Do this before anything else.
2. **Template A/B** (§3.2) — decides whether L1's 27B is load-bearing or a
   15-second tax. Only matters if #1 shows the nudges are being heard.
3. **Force the epistemic layer through the completion contract** (evidence_check
   as a stop-gate) *or* accept it as a dormant subsystem and stop paying the
   ~500-token per-turn tax for it. The 37-call base rate says the current
   middle path (prompt-only encouragement) is the worst of both.
4. **Guard A/B** (§3.3) — cheap, and it converts the 23% from anecdote to
   measurement.
5. Everything else (threshold regex, unknown-signal readouts, rename the loop)
   is cosmetic; let it prove itself through use.

---

### One-paragraph version

The ultrawork extension is a well-logged, well-refactored **context-accounting
harness** wearing an **epistemic system's** clothing. Its best-tested part (the
token-gated librarian trigger with cooldown) is a *sensor*; its best-used part
(loop guard) is a *metronome whose rescue-rate is unmeasured*; its most-claimed
part (the evidence/verification layer) is the *least-used* — 37 tool calls in 26
days on the model it was built to police. The single unbroken seam is nudge→
compliance: the system measures that its reminders were delivered, never that
they changed anything. The two tests that would convert most of the current
candidates into findings — a retroactive completion audit over the 362 existing
nudges, and a one-day template-for-27B scramble — cost almost nothing and neither
requires new machinery.

*(Revision 2026-09-16: the production agent is the 27B — the same weights as
the librarian; the 4B was a probe. This flips the loop guard from "metronome
for a weak model" to "TODO-discipline problem on the production model"
(27.1% vs 0%), retires the "model too small" reading of the epistemic layer's
low usage, and turns the compliance question into a self-correction rate. Full
re-slice: Revision block above.)*

---

## 8. Resolution Options & Tradeoffs

One subsection per tension identified in §1–§7. Each option states what it costs
(tokens, latency, code, model-cognition budget on the 27B agent) and what it gives up.
No option is neutral: every one of these trades one attribution or cost for another.

### 8.1 Loop guard: rescue vs metronome (23% trip rate, unbroken)

| Option | Cost | Gives you | Gives up |
|---|---|---|---|
| **A. Status quo** (guard, 4 retries) | Up to 4 extra full-context agent turns per session worst case — real token/latency burn on the local router when tripping | Bounded, working, zero code | The 23% stays anecdote; you pay worst-case turns without knowing how many were rescues |
| **B. Instrument trips first** — at trip time, log: TODO.md [x] ratio, whether the final message repeated the previous one, whether any new `TOOL_START` followed the resume | ~15 lines; one extra log line per trip | Converts the metronome-vs-rescue question into a derivable stat on existing+future data; A/B later is then optional | One more log field to mine |
| **C. Cheaper trigger** — trip only if TODO.md has unchecked items **and** the agent's last turn made no tool call; cap retries at 2 | ~10 lines | Cuts worst-case burn ~half | May miss rescues where the agent stopped *after* a tool call (the "forgot to tick the box" case the guard exists for) |
| **D. Explicit stop-marker protocol** — completion contract requires a `STOP:` line; guard = no marker. Enforced cleanly. | Prompt change + prompt-trust on the agent | Airtight, no TODO parsing ambiguity | Puts the burden on the weakest layer's compliance — the exact seam that is currently unmeasured; marker-protocol compliance on the 27B is unproven, and its 27.1% trip rate says its [x]-discipline is already soft |

**Pick B.** It is the asymmetry-of-evidence move: the trip log is where the
discriminating data already is. Run C only if B shows ≥half of trips are
repeats-of-completed-TODOs (pure metronome). D only if the agent ever grows.

### 8.2 27B librarian vs the template null

| Option | Cost | Gives you | Gives up |
|---|---|---|---|
| **A. 27B always-on** (status quo) | p90 15.8s router slot per ≥20k-token growth above 80k; 23GB VRAM; queue contention with the agent's own calls | The only bullet type that survived the scramble test (loop/URL pattern detection) | Latency tax even in windows where nothing is wrong |
| **B. Dumb generator** (template: untouched-files + digest verbatim) | ~0 latency, 0 VRAM, no router contention | Deterministic, debuggable, the 0.8%-nothing problem vanishes (it either has bullets or doesn't) | Loop detection — precisely the delta the test isolated |
| **C. Signature-gated 27B** — cheap detector over the digest (≥3 identical tool+target repeats, same-URL re-navigations) decides when to pay the 15s; template bullets otherwise | ~40 lines of digest parsing | Keeps the delta, drops the tax in quiescent windows (which the log suggests are most of them) | Adds a detector whose own false-negative rate is now load-bearing; one more code path to keep honest |
| **D. Lower cadence** — fire at ≥40k growth or only when a compact is imminent | 1 line (constants) | Halves calls, halves the tax | Loses early warning — the nudge arrives *with* the compact instead of before it, which is the original failure mode |

**Pick C, with D as the fallback if C's detector misbehaves.** The scramble test
already told you what the 27B is *for* (loop detection); paying for it only when
the digest shows a loop is the configuration the evidence points to. B is the
right answer if the §3.1 audit finds loop-nudges were rarely acted on anyway —
in which case the delta was decoration.

### 8.3 Epistemic layer: 37 calls vs a per-turn tax

| Option | Cost | Gives you | Gives up |
|---|---|---|---|
| **A. Stop-gate** — completion contract: "no final answer while registered claims < 0.7", enforced by the loop guard reading the EvidenceStore | Prompt + guard-wiring (~30 lines); the store is in-memory per session, so the gate works within a session | Real enforcement; claims become load-bearing for stopping | If the agent never registers claims, **0 claims = gate open** — the starvation mode reappears as a trivially-passing gate. Only worth it paired with 8.3-B |
| **B. Implicit registration** — harness auto-registers claims from strong-assertion patterns in final-answer text; agent never calls the tool | ~60 lines; regex over answer text | Kills the "agent won't call the tool" seam | Over-registers trivia → the 27B researches "I think the file is 300 lines" → noise in the store; precision tuning is slow |
| **C. Dormant** — strip the epistemic section from the per-turn prompt; tools stay; roadmap parked | ~240 tokens/turn saved × 226 turns; 10 minutes of code | Honest accounting: the layer stops pretending to run; zero tax while unused | The "expectation" of verification disappears — if you were getting *any* behaviour from it, C removes it unmeasured |
| **D. Status quo** | ~240 tokens/turn on 27% of sessions | The protocol is present when the model feels like it | The middle path the base rate says is worst-of-both |

**Pick C now, revisit with A+B when you decide verification is a goal rather
than an aspiration.** The 37-call base rate is the argument: prompt-only
encouragement produced 1.4 tool calls/day on the model it exists for. A gate
(8.3-A) without implicit registration is a door with no handle.

### 8.4 The unmeasured seam: nudge → compliance

| Option | Cost | Gives you | Gives up |
|---|---|---|---|
| **A. Retroactive audit** (next ~20 `TOOL_START` lines after each of the 362 nudges: did the named file get read / URL get visited / TODO re-opened?) | A script; free; past-only | Completion rate per bullet type — the stat that splits "sensor" from "toast" | Says nothing about future nudges |
| **B. Forward instrumentation** — nudge records its requested action; harness logs `NUDGE_FOLLOWED`/`NUDGE_IGNORED` when (or when it fails to) observe the action within N calls | ~40 lines; **reuses the existing per-resource opened/stale tracking** — the machinery is already there | The compliance rate becomes a permanent log-derived metric; §8.2's detector gets its feedback signal | The "action" is fuzzy (a nudge says "worth checking"; following = reading the file *or* acting on the finding) — the metric will overcount weak compliance |
| **C. Escalation** — a nudge ignored twice changes form (steer → system-prompt line next turn) | Small, but adds a state variable per nudge | Gives the system a way to force attention | More controller pressure on an already-pressured 27B; risk of nudge-storm feeling; hard to tell "ignored" from "already handled" |

**Pick A once, then B.** B is the cheapest permanent fix because the tracking
half of it already exists (`openedResources`/`staleResources` mark exactly the
events a compliance check needs). C only if B shows a persistent ignore-rate above
~50% *and* the ignored nudges were the loop-type ones.

### 8.5 Enforcement asymmetry in the prompt

The completion contract presents enforced items (loop guard, follow-ups), trusted
items (TODO [x] honesty), and hoped items (scrapbook, `bg_run` for blockers) at
equal rhetorical weight. Even a 27B cannot be expected to calibrate what isn't told to it is enforced.

| Option | Cost | Gives you | Gives up |
|---|---|---|---|
| **A. Annotate** — 3 lines in the prompt: "checked after you stop: X, Y · your discipline: Z" | 3 lines | The model knows what will ping it; likely *reduces* the 23% trip rate (stops that would have tripped now include the [x] tick pre-emptively) | Slightly longer prompt; honesty depends on the model reading the annotation |
| **B. Enforce TODO honesty** — guard compares [x] items newly checked this turn against that turn's `TOOL_START` history; mismatch = nudge | ~50 lines; the turn-to-tool mapping is the fiddly part | The guard gets its missing teeth; "stale TODO" bullets (currently the 27B's boilerplate job) become facts | False positives where work happened out-of-band (bg processes) → needs the bg_run log it already writes |
| **C. Status quo** | 0 | — | The 27B keeps explaining what the harness could have checked |

**Pick A now, B when B's data (from 8.4) shows [x]-mismatches are common.** B
also dissolves the template's most parroted bullet, which is a nice side effect:
it removes boilerplate from the 27B's job, letting the model focus on what it's
actually good at.

### 8.6 Model stratification (the 4B confound, resolved)

*Revised per the Revision block: production = qwen3.8-27b (same weights as the
librarian); the 4B was a 7-day probe. The pre-revision options are kept as a
status table — the data they were meant to produce now partially exists.*

| Option | Status after revision |
|---|---|
| A. Own the weak-model design | **Retired** — the production model is the 27B; "weak-model scaffolding" was the probe's design, not the system's |
| B. Re-baseline on a bigger agent | **Half-achieved for free** — the 4B probe era *is* the second column, and it delivered the key datum: trip rate 0% (4B) vs 27.1% (27B). The trip rate is not model-invariant. The trigger machinery (cooldown, debounce, baseline reset) appears to *be* model-invariant — both eras share its log signatures (same storm shape, same skip rates) |
| C. Capability-scaled config | Still the right shape if you run mixed sizes routinely. The probe data says the one knob that matters is the **guard** (model-dependent), not the trigger (model-invariant) |

**The live question the revision opens:** the librarian and the production
agent are the same weights. Two consequences to manage, neither resolvable by
config: (1) *shared blind spots* — the 27B cannot flag failure modes it itself
has; the P0 compliance audit should check whether loop-nudges cluster on loop
types the 27B recognises vs ones it produces; (2) *self-contention* — the
librarian's 15s p90 call queues on the same router/VRAM as the agent's own
turns, so the agent waits behind its own shadow. If the P0 audit shows nudges
rarely change behaviour, the contention cost is the first thing to cut — and
8.2-C (signature gating) now doubles as a queue-contention fix, not just a
cost fix.

### 8.7 No off-switch (managed by restart; 436 LOADs vs 212 sessions)

| Option | Cost | Gives you | Gives up |
|---|---|---|---|
| **A. `/ulw-off`** — flip `active=false`, log it, next `/ulw` re-activates | ~10 lines | The 27% activation rate becomes a real operator choice; restart-count starts falling | — |
| **B. Auto-expire** — deactivate after N quiet hours | 5 lines + a timer (the one place a *second* timer would be needed; the changelog fought hard to get to one) | No command to remember | A timer the architecture deliberately eliminated; expiry mid-task is the worst moment |
| **C. Status quo** (restart-to-manage) | 0 | — | The base rate of activation stays contaminated by "session happened to have /ulw typed once" |

**Pick A.** One command, no timer, reverses the asymmetry (activation has a
command, deactivation has a process restart).

### 8.8 Logs vs metrics

| Option | Cost | Gives you | Gives up |
|---|---|---|---|
| **A. Per-session summary line at shutdown** — nudges delivered/followed, guard trips, claims, latency p50, appended as one greppable line | ~30 lines; reuses counters already in scope | Every "how is this working" question answers with `grep SUMMARY log` | The summary's field set is a design decision you'll revise as §8.4's metric proves itself |
| **B. Separate JSONL metrics file** | More parsing surface; a second file to keep in sync with the log | Machine-friendly aggregation | Duplicates state that's already derivable from the log; the log is currently the single source of truth and that's a virtue |
| **C. Status quo** (raw log + human mining) | 0; this analysis proves it works | — | Every question costs a bespoke script; the knowledge of what to mine is in the log's shape, not in the system |

**Pick A.** It keeps the single-source-of-truth property (the summary is derived
from the same in-scope counters, appended, never the input to anything) and
makes the §8.4/§8.1 metrics permanent.

### 8.9 Sequencing (cost-of-rigor order)

Ranked by how much of the working frame rests on each:

| Priority | Item | Effort | Why this order |
|---|---|---|---|
| P0 | **8.4-A** retroactive compliance audit (script over existing log) | 1 script | Breaks the single load-bearing uncertainty before any config decision |
| P0 | **8.7-A** `/ulw-off` | 10 min | Uncontaminates the activation base rate for everything else |
| P1 | **8.1-B** trip instrumentation | 15 lines | Turns the 23% from anecdote into a stat; nearly free |
| P1 | **8.4-B** forward compliance logging | 40 lines, reuses existing tracking | Makes P0's answer a permanent metric |
| P1 | **8.3-C** dormant epistemic section | 10 min | Stops the unmeasured tax before deciding the layer's fate |
| P2 | **8.2-C** signature-gated 27B (after P0's audit says loop-nudges were acted on) | 40 lines | Only build the detector once the audit proves the delta was worth paying for |
| P2 | **8.5-A** prompt annotation | 3 lines | Do it whenever; it's free and likely cuts the 23% |
| P3 | **8.6** 27B-variant re-baseline (3.5/3.6/3.8) + shared-blind-spot check on loop-nudges | time, not code | Production rates are 3.8-27b-adjacent; variant drift and the librarian's blind-spot structure are the residual model questions |
| P3 | **8.8-A** shutdown summary | 30 lines | After the P1 metrics exist, so the summary fields are decided by what actually got measured |
| Deferred | 8.1-C/D, 8.3-A/B, 8.5-B, 8.6-C, 8.2-B, 8.8-B | — | Each is gated on data that doesn't exist yet; building them now is the rigor-paralysis mode the principles warn against |

The pattern to notice: **every P0/P1 item is either a script over data you
already have or ≤40 lines reusing machinery that already exists.** Nothing in
the first two priority tiers introduces a new timer, a new file format, or a new
dependency on the agent's compliance with a new protocol. The deferred items are
exactly the ones that would.

---

## 9. Design-philosophy stress test (2026-09-16, from operator's loose thoughts)

The operator stated the design intent: the 27B has frontier-class execution
coherence but weak world knowledge; the librarian nudge buys "epistemic
retrospection" — flag key areas, go out (playwright) to research, return a
**clean summary** to the main agent without exposing it to the researcher's
messy trace. Loose ideas stress-tested below. Verdicts: **HOLDS / HOLDS-WITH-CORRECTION /
INVERTED** per claim. Ideas are tested, not ratified.

### 9.1 "27B = frontier execution coherence, lacks world knowledge" — HOLDS, wrong axis

The split is real, but "world knowledge" is the wrong axis to build the nudge
on. The failure axis is **recency × specificity**:

| Claim shape | 27B reliability | Why |
|---|---|---|
| Stable concepts (algorithms, architecture, language) | good | weights are fine |
| **Exact strings** (flag names, param names, error text, paths, signatures) | bad | weights store prototypes, not exact strings → confident hallucination |
| **Time-varying facts** (versions, defaults, "current best practice") | bad | weights frozen at training cutoff → confidently stale |
| **Long-tail entities** (niche libraries, specific packages) | bad | low training density |
| **Negatives/absences** ("X does not support Y") | bad | absence is hard to learn |

Consequence: the nudge should classify **claim shape**, not importance. The
existing 0–4 threshold classifier in `epistemic_protocol.ts` is *already* a
claim-shape→evidence-demand mapping — it just only fires at registration time
(~1.1×/day). Move it to generation time: classify the agent's own assertions
(see 9.4).

Qualifier on "frontier execution coherence": it decays with context length —
long-run discipline failure is the measured 27.1% guard-trip rate (the 27B
loses TODO discipline in long runs). The system compensates knowledge one way
(librarian) while coherence degrades the other (guard). Both are load-bearing;
the librarian idea should not swallow the guard.

### 9.2 "Clean summary only, no messy trace" — HOLDS-WITH-CORRECTION

The prefill argument is right, but **a clean summary without citations is a new
single point of failure**: the main agent receives positive evidence with no
cheap falsification path (the trace lives in another session, and the
summarizer is the same 27B that did the research — self-confirming bias).
Correction: researcher output must be **evidence-shaped** — claim + URL + short
quote — not prose. Then the main agent can verify by re-opening the cited URL
(playwright is one tool call away). A clean summary *with* citations is
verifiable; without, it's a trust channel that bypasses the exact epistemic
discipline the system exists to add.

### 9.3 "New pi-interactive-shell per research task" — HOLDS, two upgrades

The operator's prefill math is correct and matches llama.cpp prefix-cache
semantics (verified against the pruner's own README: it rewrites the request
context by replacing toolResults → "recompute from the point of change
onward"): small pi system prompt → cheap TTFT; compaction = full history
rewrite = total cold re-prompt; new shell per task avoids carrying stale KV.
Two upgrades:

1. **Async, not sync.** Local 27B research is minutes (playwright × N + model
   turns). If the nudge→research→summarize chain blocks the main agent, the
   agent learns to ignore nudges (it already ignores ~85% of the epistemic
   layer). `pi-interactive-shell` dispatch/monitor mode exists for exactly
   this: launch researcher, keep working, get notified.
2. **File artifact, not session message.** The "clean summary" should be a
   **file the main agent reads with `read`** — durable across compaction,
   re-readable, never re-prefilled from a foreign session. Deep research in
   one shell hits the compaction trap (the full cold re-prompt); the session
   is a scratchpad, the file is the artifact.

Hidden cost the TTFT math misses: tool schemas count in prefill too, and the
playwright-bridge toolset is large — fine for bounded lookups, another reason
the artifact must be a file (schemas re-prefill every turn of the researcher's
own session).

### 9.4 The internal-weights trust question (the hard one) — answer: shape the claim, not the confidence

> "How will the nudge prompt let the agent realise what it cannot trust within
> itself? Context window is easy; internal weights are trickier. Human hint:
> minimal-loss compression for the next 3M tokens + ritualistic refresh online."

The hint is right on compression, and it's exactly what the pruner already does
for *context*. For **weights** the compression is fixed (training is done), so
the ritual must be **refresh-on-use keyed to claim shape**, not a calendar —
humans look up the number *when dialing*, not every Tuesday.

The deeper answer: **the agent does not need to introspect its weights — it
needs a proxy it *can* evaluate, and the proxy is claim shape, not felt
confidence.** Introspective confidence ("how sure do I feel?") is poorly
calibrated in small models (the 27.1% trip rate shows it doesn't even track
its own TODOs reliably). But claim shape is a *local property of the sentence*
— externally checkable, promptable, auditable:

> If a claim in your final answer matches a risky shape (exact string /
> recency / long-tail / negative — see 9.1) AND stakes > trivial, then either
> (a) open the source now, or (b) say it hedged *with the shape labelled*
> ("per 2026-08 docs…"). **Unlabelled strong claims on shape-matched topics
> are the failure.**

This is why the 0–4 threshold classifier works at all: it's a regex over claim
text, not model introspection. Caution without shape is either paralysis (hedge
everything) or ritual (declare uncertainty, commit anyway); shape turns caution
into a **checkable rule — and a checkable rule is what the librarian can
audit**.

The refresh ritual needs a **durable home that survives compaction**: a belief
ledger (JSON/MD per project) — claim → shape → best source URL → last-verified
→ status. The agent refreshes **on read** (before relying on a stale
shape-matched entry). This is the human "go back online to refresh what I can
afford to forget" — and it's the natural evolution of the underused
`evidence_state.ts`. The lossy part may be lossy; the **provenance (URL +
quote) must be lossless** — that's the minimal lossless handle on a lossy
belief, and it's already the evidence-entry atom.

**The sharpest stress-test finding:** the librarian's input is file-list +
last-15 **tool-call digest** — it sees what the agent *clicked*, not what it
*said*. But the design's stated purpose is to flag untrustworthy **claims**,
and claims live in the agent's *generated text* (answers, code, doc claims),
not its tool calls. **The sensor is watching the wrong channel.** This is the
twin of the "80k/20k gate can't detect loop patterns" finding: trigger is
model-invariant and content-blind. Fix: add the agent's recent **assertions**
to the librarian digest. Then a nudge can say "you asserted an exact API name
~20k tokens ago — precise-string shape — verify or hedge." That one change turns
the librarian from a metronome/TODO-cop into the epistemic-retrospection
device the design intends. (The user can smell an unverified claim because they
read the agent's prose; the librarian currently reads the agent's clicks. Give
it the prose.) Cheap (~hundreds of tokens/call) and directly testable: after
adding, do claim-shape nudges appear in the log?

### 9.5 The 4B's better role — independent falsifier, not just probe agent

The 4B probe is kept for VRAM reasons; that's also the *right* reason
epistemically. A weak, **stake-free** reader of the researcher's trace flags
what the 27B researcher normalised away — the 4B doesn't know enough to agree
with everything, which is exactly what a falsifier needs. Asymmetric evidence in
practice: the 4B's ignorance is a feature. Cheap experiment, reuses the
existing probe.

### 9.6 Pruner cold-prefill — VERIFIED: config/mechanism, model-independent

Operator observation: the pruner behaves "cold" even with the **same model** as
the summarizer — so model-difference is not in the causal chain. Confirmed
against `pi-context-prune@1.4.0` code + README:

- It **rewrites the future request context** (replaces old `toolResult`
  messages with summaries). Prefix cache is **content-addressed**: any
  earlier-context rewrite invalidates the cache *from the point of change
  onward*, for *any* model. Cold re-prefill is by design, not a model bug.
- Its README states this explicitly ("recompute from the point of change
  onward… pruning too often can save tokens in-context while still hurting
  overall performance by repeatedly busting the provider cache").
- The hold-off + batch-after-compaction the operator noticed is **designed**:
  a `session_compact` handler + steer-deferred delivery (summaries queued,
  injected at the next turn boundary). Post-compaction the prefix is *already*
  cold-rewritten, so pruning that rides on top costs ~zero extra invalidation.
- Current config (`pruneOn: agent-message`, `batchingMode: turn`,
  `summarizerModel: qwen3.5-4b`) is near the cost-optimum for llama.cpp prefix
  caching: one invalidation per work batch, free invalidations after
  compaction, and the cheap 4B does the summarisation prefill. **Nothing to
  fix now** — parked per operator, but verified rather than left vague.

### 9.7 Net — what the philosophy implies, in priority order

1. **Feed the librarian the agent's claims** (9.4) — the single change that
   aligns the mechanism with the stated intent. Cheap, log-testable.
2. **Async researcher + file artifact** (9.3) — unblocks research from the
   agent's critical path; the file survives compaction.
3. **Belief ledger, refresh-on-use, keyed to claim shape** (9.4) — evolves
   `evidence_state.ts` from optional tool call into the durable memory the
   design describes; provenance lossless, belief lossy.
4. **4B as independent falsifier** (9.5) — cheap, reuses the probe, asymmetric
   evidence.
5. **Keep the guard separate from the librarian** (9.1) — coherence decay
   (27.1% trips) is a different axis from knowledge compensation; don't merge.

The one-sentence read: *the design wants to shape the agent's claims, not its
confidence, and the librarian must be pointed at the claims to do it.*

### 9.8 Implementation + probe results (2026-09-16) — priority #1 shipped

**What landed** (probe-tested as built, per operator instruction):

- `ultrawork/claim_audit.ts` (new, pure — no pi imports): `extractAssistantText`
  (text blocks only, thinking/toolCalls filtered), `AssertionBuffer` (cap 30 /
  4000ch/600ch per item), `CLAIM_BASE_SYSTEM` + `CLAIM_SYSTEM_ADDENDUM` (the
  9.4 shape taxonomy as claim-shape instructions), `buildLibrarianPrompts` —
  single source of truth shared by extension and probe, so the probe tests the
  exact production prompt.
- `ultrawork.ts` wired: `turn_end` → `AssertionBuffer` (fires before the
  token-gated `tool_execution_end` reads it — order verified); librarian prompt
  now includes `claims: assertionBuffer.recent(6)`; "nothing to audit" guard
  extended to the buffer; buffer cleared on nudge delivery (same lifecycle as
  `digestBuffer`); `session_start` resets it; `[CLAIM]`/`claimsBuf=` telemetry
  in the log.
- `maxTokens` for the librarian call 220 → 500 (see finding below).

**Perturbation probe** (`ulw-analysis/probe_claims.ts`, live 4B, temp 0.2):
control (no claims) vs treatment (5 claims, 4 risky shapes) — **PASS**.
Control: `- nothing to reground.` Treatment: the 4B explicitly applied the
(a)–(e) shape taxonomy to each claim, classified all four risky shapes
(exact flag, numeric, version+numeric, negative/absence) as RISKY and the one
safe general-concept claim as not, and emitted bullets naming the specific
claims (``--cache-type q8_0``, `max_tokens` 2048) to verify via playwright.
Claim-specific tokens appear in treatment only. The claims section demonstrably
drives the output — it's not the model hallucinating "verify things" either way.

**Integration smoke** (`ulw-analysis/smoke_wiring.ts`): mocked pi API, real
factory, real handlers — `turn_end` capture → gate (85k≥80k) → **live 4B
router call** → steer nudge delivered → `librarian-report` entry. Full chain
PASS, 5.6s end-to-end. Nudge produced:
`"Verify --cache-type q8_0 memory claim live: open llama.cpp docs and check the
actual cache-type defaults instead of trusting the 'halves' claim."` — i.e. the
librarian (same weights as the agent) is now contesting the agent's specific
claim, which is the 9.4 mechanism working, not merely present.

**Findings the probes surfaced (not in the original design):**
1. **Thinking-model token budget.** The 4B spent ~680 tokens of reasoning
   before its bullets once claims were in the prompt; at the old maxTokens=220
   the budget was eaten by reasoning and `content` came back empty — the
   extension's `reasoning_content` fallback would then inject the model's raw
   *thinking* as the nudge (worse than none). Bumped to 500; verify the
   production 27B's verbosity before the next trip (watch
   `contentLen=0`-style empty nudges in the log as the signature).
2. **Nudge URLs are librarian-generated and can be wrong.** The smoke nudge
   pointed at `tenstorrent/llama.cpp` (real: `ggml-org/llama.cpp`). Pre-existing
   property of the "name an exact URL" instruction, now more load-bearing since
   claims push the librarian toward specific docs. Mitigation lives in the agent
   (it opens the link and sees the 404) — cheap. Track it; if it recurs it's a
   perturbation signature for "URLs in nudges" specifically.

**Next test (when next live session runs with /ulw):** after a gate trip, grep
`ultrawork.log` for `[CLAIM]` capture + `claimsBuf=` in audit scope + claim-
naming bullets in the nudge. Success = the nudge references something the agent
actually said this session, not just what it touched.

### 9.9 Observation-run findings (2026-09-16 → 09-17) — the claim-audit in a real harness

Ran the double-entry-bookkeeping task (TDD, multi-phase) in a live interactive
harness with the claim-audit wired in, across three agent models. All findings
below are **traced from `ultrawork.log` + session JSONL**, not recalled.

**`message_end` fix — VALIDATED (3 models).** The original capture fired on
`turn_end` with `claimsBuf=0-1` across 152 tool calls (claims were written after
the buffer was read). Switching the capture to `message_end` (assistant text
lands in the buffer *before* the next handler runs) yields `claimsBuf=1` with a
real claim (e.g. 8184ch design claim on Kimi; "create src/reconcile.ts" 1956ch on
DeepSeek) on **all three** models. The fix is model-independent and confirmed.

**Finding 2 — RESOLVED: model capacity, not the prompt.** Nemotron-120B (12B
active, low thinking) echoed the audit prompt back (garbled nudge). Kimi K3 and
DeepSeek V4 Flash both produced clean, well-formed, *actionable* audits (Kimi
caught a real "phase-numbering conflict"; DeepSeek: "README.md, TODO.md,
package.json, src/index.ts were never opened this session — open them before
proceeding"). The prompt was fine; the 12B-active model simply couldn't hold the
format. → **nudge quality = model capacity.**

**Librarian latency is model-dependent, and it blocks the agent (sequential).**
| model (thinking) | librarian latency | nudge | agent behavior |
|---|---|---|---|
| Nemotron-120B (low) | 6-8s | garbled/echoed | looping |
| Kimi K3 (high) | **240s** | clean, caught real bug | slow, NIM timeouts |
| DeepSeek V4 Flash (high) | **10.7s** | clean, correct | fast, completing |

Root cause: `callLibrarian` → `modelRegistry.complete(model, …, {maxTokens,
temperature, signal})` — **no thinking/reasoning override**. The audit is an
extraction task, not deep reasoning, so a high-thinking model spends its budget
deliberating (Kimi 240s). For a *sequential* (awaited) librarian this latency is
fully on the agent's critical path. → follow-up: cap librarian thinking to
low/medium (check `ModelsApiStreamOptions` for a `reasoningEffort`/thinkingLevel
field).

**Compaction:** 1M window (Kimi + DeepSeek); threshold = `contextWindow - 16384`
≈ 1.03M. Context was ~234k at last check → far off. Assumed handled (per
operator); watch if it grows.

**Base rate / cost-of-rigor read:** the claim-audit mechanism works end-to-end
(capture → audit → nudge) and its output quality tracks the model doing the
auditing. The cheap, high-leverage fix (message_end) already shipped. The
remaining cost is latency (thinking cap) — a refinement, not a correctness bug.

---

## §9.10 Phase C/D — the observation run, end to end

The production-like run (DeepSeek V4 Flash, 1M window, same-model librarian,
prune OFF, `/ulw` active) was driven to completion and scored. What it adds to
the §9.8–9.9 picture, stated by what it changes about the read:

**Perturbation is the load-bearing result, and it held.** The full loop fired
in a real multi-hour run: claim captured (`claimsBuf=1`, post-`message_end`) →
librarian audited (243k fire) → nudge delivered → **the agent changed
behavior because of it**. The agent's next turn read "Let me open the key files
*as flagged* before proceeding further" and opened exactly the files the nudge
named (the four never-opened files, the partial `sed -n '70,130p'` read of
types.ts, the `report.ts` claim). This is not "the nudge appeared"; it is the
perturbation signature — the audit moved the agent. A nudge that does not move
the agent is decoration; this one did.

**The retrigger is delta-gated and worked as designed.** Across the run the
deepseek context grew 252k→262k; `lastLibrarian=243085`, so the delta climbed
12,930→18,194 and stayed under the 20,000 retrigger band, so it did **not**
re-fire until 263k. It ended at 262k — just short. The near-miss is the point:
a mis-sized threshold would have either spammed (delta un-gated) or starved
(never firing). It fired exactly once at 243k and was one ~2k turn from a
second fire. That is the correct shape for a context-gated, delta-gated trigger.

**The shape of competence showed up in the debugging, not just the pass count.**
The balanceSheet came back `balanced` but with `asset = −2,180,035`. The agent
did **not** flip the `asset > 0` assertion to make the test pass. It wrote a
diagnostic, traced the *actual* fixture numbers (negative `Assets/Cash`
−2,431,871 from an owner-capital credit entry), confirmed the accounting
equation still held, and then fixed both the logic (net income → equity) **and**
the test's wrong assumption. Tracing the data before touching the oracle is the
perturbation a good harness should reward; the run produced it unprompted.

**The mechanism audits the operator, too — the "shape of silence" check.** The
outer (operator) session's own librarian fired (103,572) and its "Context
check" described *the babysitting*: "a lot of `sleep` commands (75, 90, 90, 90,
120…)", the session-file path, the drained interactive shell, the TOOL_END bash
probe. The audit does not special-case the human driver; it reads clicks and
flags the pattern it sees. That is the mechanism being honest about its own
null model (it sees wait-loops as the thing to flag) — and it's why the
operator's session and the agent's session share one log and one truth.

**Cost-of-rigor: the 216s is the price of same-model safety.** The same
DeepSeek model that answered in 10.7s earlier took **216s** on the 243k fire.
The awaited-sequential design (so the same model never contends with itself)
puts the *full* cloud API duration on the agent's critical path; with a
variable-latency cloud endpoint that cost is real and non-deterministic. This
is not a correctness bug — it is the explicit trade we accepted to make
same-model self-observation safe. The lever is a thinking cap on the audit call
(and, for cloud specifically, async since a cloud model is multi-instance and
self-contention is a non-issue there).

**Base rate after the run.** Score over the full log: **27/397 nudges (6.8%)
reference a same-window claim**, **3/397 (0.76%) empty** — the empty rate
never moved off its ~0.8% floor. Claim-era nudges carry the agent's own
tokens/flags (`report.ts`, `60-70k`, `london`, …); the 362 pre-change nudges
carry ~0 (README-boilerplate baseline). The claim-audit layer did not add
noise (empty rate flat) and added signal (claim-ref nudges present only in the
claim era).

**What it does NOT yet show.** Two honest gaps: (1) the ⏸ renderer's compact
line is validated by wiring (bundle + theme keys + the pi example it mirrors) but
not eyeballed in a live TUI frame this run — secondary, and the follow-up it
would render was delivered as a `steer` turn long since scrolled past. (2) The
belief-ledger (Build #3) and async researcher (Build #2) are still unbuilt;
this run exercised claim-capture + audit + nudge only, not a persistent
cross-turn belief store. Both remain Phase E.
