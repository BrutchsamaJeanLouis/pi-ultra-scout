import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { EpistemicProtocol } from "./ultrawork/epistemic_protocol";
import { createResearchLoop, type ResearchLoopEngine } from "./ultrawork/research_loop";
import {
  AssertionBuffer,
  buildLibrarianPrompts,
  extractAssistantText,
} from "./ultrawork/claim_audit";
import {
  classifyThreshold,
  detectUnknownSignals,
  getClaimsNeedingResearch,
  canAnswer,
  type EvidenceSource,
} from "./ultrawork/evidence_state";
import { dispatchResearch } from "./ultrawork/research_dispatch";
import { detectRiskyShapes, renderShapeHits, TRUST_SHAPES_SECTION } from "./ultrawork/claim_shapes";
import { ulwLog, ulwLogSessionStart, ULW_LOG_FILE } from "./ultrawork/logger";
import { Box, Text } from "@earendil-works/pi-tui";

// ── Types ──────────────────────────────────────────────────────────

type ResourceType = "file" | "url";

interface CriticalResource {
  path: string;
  label: string;
  type: ResourceType;
  touched: boolean;
  staleSinceCompaction: boolean;
  lastTouchedAtTokens?: number;
}

interface UltraworkConfig {
  routerBaseUrl: string;
  librarianModel: string;
  contextTriggerTokens: number;
  reTriggerDeltaTokens: number;
  maxResearchRounds: number;
  minConfidenceForAnswer: number;
  timeoutMs: number;
}

// ── Extension ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  ulwLog("LOAD", `ultrawork extension loaded (log=${ULW_LOG_FILE})`);

  // ── Follow-up message renderer ─────────────────────────────────────────
  // The loop-guard resume + post-compaction continue messages are delivered as
  // ulw_followup CUSTOM messages (see the two sendMessage(triggerTurn) sites).
  // They convert to role:"user" for the LLM but would otherwise render as bare
  // custom messages. This renderer gives them a compact, stable form:
  //   ⏸ <label>            (default — one dim line, doesn't eat the view)
  //   ⏸ <label> + full text (expanded)
  // This replaces the old "Follow-up:" pending-overlay lines that stacked up.
  pi.registerMessageRenderer("ulw_followup", (message, { expanded, outputPad }, theme) => {
    const c: unknown = (message as any).content;
    const text =
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n")
          : "";
    const rawLabel = (message as any).display;
    const label = typeof rawLabel === "string" && rawLabel ? rawLabel : "ulw follow-up";
    let out = theme.fg("dim", `⏸ ${label}`);
    if (expanded) out += `\n  ${text}`;
    const box = new Box(outputPad, 1, (t: any) => theme.bg("customMessageBg", t));
    box.addChild(new Text(out, 0, 0));
    return box;
  });

  const MAX_RETRIES = 4;
  // The librarian uses a 27B model served by a LOCAL, SLOW llama.cpp that
  // cold-loads into VRAM AND contends with the agent's own router calls on the
  // same backend. A 60s cap made the first trigger after an idle almost always
  // AbortError. Go generously (400s) so calls actually COMPLETE instead of
  // aborting while the backend is still mid-generation — an aborted-but-still-
  // processing request can leave the local router slot wedged and block the
  // agent's own calls until the llama.cpp process is killed.
  const LIBRARIAN_TIMEOUT_MS = 400_000;
  // After a librarian call FINISHES (success OR timeout), don't start another for
  // this long. Without it, a call that times out leaves lastLibrarianTokens
  // un-advanced, so the 20k delta gate stays true and EVERY subsequent tool call
  // re-fires the librarian — a continuous storm of timeouts (observed post-compact).
  const LIBRARIAN_COOLDOWN_MS = 60_000;
  let retries = 0;
  let ultraworkActive = false;

  // ── Experiment env gates (paper ablation: C0/C1/C2 — see prj-ultrawork-paper-publish) ──
  const ULW_OFF = process.env.PI_ULW_OFF === "1"; // C0: extension inert (ulw tools hidden from tool list)
  const ULW_NO_DISPATCH = process.env.PI_ULW_NO_DISPATCH === "1"; // C1: prompt+nudge on, research_dispatch tool absent
  if (process.env.PI_ULW_AUTOACTIVE === "1" && !ULW_OFF) ultraworkActive = true; // headless runs: activate without /ulw
  ulwLog("LOAD", `env gates: ULW_OFF=${ULW_OFF} ULW_NO_DISPATCH=${ULW_NO_DISPATCH} AUTOACTIVE=${process.env.PI_ULW_AUTOACTIVE === "1"} active=${ultraworkActive}`);

  let config: UltraworkConfig = {
    routerBaseUrl: process.env.PI_LLAMA_ROUTER_URL ?? "http://127.0.0.1:1234",
    librarianModel: process.env.PI_LIBRARIAN_MODEL ?? "qwen3.8-27b",
    contextTriggerTokens: 80_000,
    reTriggerDeltaTokens: 20_000,
    maxResearchRounds: 3,
    minConfidenceForAnswer: 0.7,
    timeoutMs: 60_000,
  };

  let resources: CriticalResource[] = [];
  let lastLibrarianTokens = 0;
  let lastLibrarianFinishedAt = 0;
  let librarianRunning = false;
  let digestBuffer: string[] = [];
  // The agent's OWN generated text (its claims), captured on message_end.
  // This is what the librarian audits for risky claim shapes (§9.4).
  let assertionBuffer = new AssertionBuffer();
  const DIGEST_CAP = 40;
  const pendingArgs = new Map<string, unknown>();
  // Deferred follow-up messages (compact / loop-guard) are tracked so they can
  // be cancelled at shutdown instead of firing into a brand-new session.
  const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();
  function schedule(fn: () => void, ms: number) {
    const t = setTimeout(() => { pendingTimeouts.delete(t); fn(); }, ms);
    pendingTimeouts.add(t);
  }

  let engine: ResearchLoopEngine = createResearchLoop({
    maxRounds: config.maxResearchRounds,
    minConfidenceForAnswer: config.minConfidenceForAnswer,
    routerBaseUrl: config.routerBaseUrl,
    model: config.librarianModel,
    timeoutMs: config.timeoutMs,
  });

  ulwLog("LOAD", `config: router=${config.routerBaseUrl} librarian=${process.env.PI_LIBRARIAN_MODEL ? "override:" + config.librarianModel : "follows ctx.model (current, same weights)"} trigger=${config.contextTriggerTokens} reTriggerDelta=${config.reTriggerDeltaTokens} maxRounds=${config.maxResearchRounds} timeoutMs=${config.timeoutMs}`);

  // Serializes every router call (regrounding + research) so the workflow
  // never issues two LLM requests in parallel.
  let llmTail: Promise<void> = Promise.resolve();
  function enqueueLLM<T>(fn: () => Promise<T>): Promise<T> {
    const result = llmTail.then(() => fn());
    llmTail = result.then(() => undefined, () => undefined);
    return result;
  }

  // B5: one shared router call for BOTH the regrounding nudge and the research
  // recall. Each site previously had its own fetch with no error handling, so a
  // non-2xx with an HTML body would reject research_loop while callLibrarian
  // survived by luck. Now both go through here: checked status + safe JSON parse.
  async function chatCompletion(system: string, user: string, opts: { maxTokens: number; temperature?: number; timeoutMs?: number }): Promise<string> {
    return enqueueLLM(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? config.timeoutMs);
      try {
        const res = await fetch(`${config.routerBaseUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.librarianModel,
            temperature: opts.temperature ?? 0.2,
            max_tokens: opts.maxTokens,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: controller.signal,
        });
        let data: any;
        try {
          data = await res.json();
        } catch {
          throw new Error(`router returned a non-JSON body (HTTP ${res.status})`);
        }
        if (!res.ok) {
          const detail = data?.error?.message || JSON.stringify(data).slice(0, 140) || `HTTP ${res.status}`;
          throw new Error(`router HTTP ${res.status}: ${detail}`);
        }
        const msg = data?.choices?.[0]?.message;
        return (msg?.content?.trim() || msg?.reasoning_content?.trim() || "");
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  // ── "Same model" librarian transport ──────────────────────────────
  // The librarian audits the agent with the agent's OWN current model
  // (ctx.model): the audit carries the same weights / knowledge / blind
  // spots as the code it reviews. Self-observation is the design property,
  // not a bug (§9). Because the call is AWAITED inside an event handler
  // (pi dispatches turn_end/tool_execution_end via `await emit(...)`, and
  // emit() awaits each handler), it runs SEQUENTIALLY with the agent's own
  // generation — the same model never contends with itself.
  //
  // PI_LIBRARIAN_MODEL, when set, OVERRIDES this (for probes that want to
  // force a cheap local model regardless of the agent's model). Otherwise
  // we follow the live current model (ctx.model), which tracks /model and
  // the initial --model flag.
  function resolveLibrarianModel(ctx: any): any {
    const override = process.env.PI_LIBRARIAN_MODEL;
    if (override) {
      const all: any[] = ctx.modelRegistry?.getAll?.() ?? [];
      const hit = all.find((m: any) => m?.id === override || String(m?.id).endsWith("/" + override));
      if (hit) return hit;
      ulwLog("LIB", `PI_LIBRARIAN_MODEL=${override} not in registry; falling back to current model`);
    }
    return ctx.model; // current model (default)
  }

  // One-shot completion via the current model (or override), serialized with
  // the rest of the workflow's LLM traffic by enqueueLLM. Reads the answer
  // text block; the thinking block is only a fallback (mirrors the router's
  // content || reasoning_content behavior, but from structured blocks).
  async function chatCompletionViaModel(ctx: any, system: string, user: string, opts: { maxTokens: number; temperature?: number; timeoutMs?: number }): Promise<string> {
    return enqueueLLM(async () => {
      const model = resolveLibrarianModel(ctx);
      if (!model) throw new Error("no model available (ctx.model undefined and no PI_LIBRARIAN_MODEL override)");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? config.timeoutMs);
      try {
        const msg: any = await ctx.modelRegistry.complete(
          model,
          { systemPrompt: system, messages: [{ role: "user" as const, content: user, timestamp: Date.now() }] },
          { maxTokens: opts.maxTokens, temperature: opts.temperature ?? 0.2, signal: controller.signal },
        );
        const blocks: any[] = Array.isArray(msg?.content) ? msg.content : [];
        const text = blocks.filter((b) => b?.type === "text").map((b) => b.text).join("\n").trim();
        const thinking = blocks.find((b) => b?.type === "thinking")?.thinking?.trim();
        return text || thinking || "";
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  // Research recall path. On error return "" (not throw) so a flaky router
  // degrades to "no evidence recalled" → confidence 0 → pending_research
  // instead of rejecting the whole research_loop tool.
  async function rawLLMCall(prompt: { system: string; user: string }): Promise<string> {
    try {
      return await chatCompletion(prompt.system, prompt.user, { maxTokens: 800 });
    } catch (e: any) {
      ulwLog("LLM", `rawLLMCall (research recall) failed: ${String(e).slice(0, 140)}`);
      return "";
    }
  }

  function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  }

  // If the model added any preamble, keep only from the first "- " bullet on.
  function trimToBullets(text: string): string {
    const t = text.trim();
    const lines = t.split("\n");
    const first = lines.findIndex((l) => l.trim().startsWith("-"));
    if (first > 0) return lines.slice(first).join("\n").trim();
    return t;
  }

  // ── Config Loading ─────────────────────────────────────────────

  // B8: the "critical resources" list is language-agnostic. It is only a
  // secondary hint — the tool-activity digest is the real signal. We probe a
  // broad set of well-known filenames and keep the ones that exist, so a
  // Python/Go/Rust project isn't left with just TODO.md to audit.
  const RESOURCE_CANDIDATES: [string, string][] = [
    ["README.md", "Project README"],
    ["README.rst", "Project README"],
    ["TODO.md", "Task list"],
    ["package.json", "Dependencies (npm)"],
    ["pyproject.toml", "Dependencies (Python)"],
    ["requirements.txt", "Dependencies (pip)"],
    ["Cargo.toml", "Dependencies (Rust)"],
    ["go.mod", "Dependencies (Go)"],
    ["pom.xml", "Dependencies (Maven)"],
    ["build.gradle", "Dependencies (Gradle)"],
    ["setup.py", "Setup (Python)"],
    ["main.ts", "Entry point"],
    ["src/main.ts", "Entry point"],
    ["index.ts", "Entry point"],
    ["src/index.ts", "Entry point"],
    ["main.py", "Entry point"],
    ["app.py", "Entry point"],
    ["src/main.rs", "Entry point"],
    ["cmd/main.go", "Entry point"],
  ];
  const MAX_TRACKED_RESOURCES = 10;

  function loadProjectConfig(ctx: any) {
    const cwd = ctx.cwd;
    resources = RESOURCE_CANDIDATES
      .map(([path, label]) => ({ path, label, type: "file" as const, touched: false, staleSinceCompaction: false }))
      .filter((r) => existsSync(join(cwd, r.path)))
      .slice(0, MAX_TRACKED_RESOURCES) as CriticalResource[];

    ulwLog("CONFIG", `cwd=${cwd} resources=[${resources.map((r) => r.path).join(", ") || "(none)"}]`);
    ctx.ui.setStatus("ultrawork-config", `inline config loaded — ${resources.length} resources tracked`);
    ctx.ui.notify(`Ultrawork config: ${resources.length} resources tracked`, "info");
  }

  // ── Digest / Touch Tracking ────────────────────────────────────

  function summarizeArgs(args: unknown): string {
    if (!args || typeof args !== "object") return "";
    const a = args as Record<string, unknown>;
    const v = a.path ?? a.url ?? a.command ?? JSON.stringify(a);
    return String(v).slice(0, 120);
  }

  function noteToolTouch(toolName: string, args: unknown, ctx: any) {
    digestBuffer.push(`${toolName}: ${summarizeArgs(args)}`);
    if (digestBuffer.length > DIGEST_CAP) digestBuffer.shift();

    const blob = JSON.stringify(args ?? {});
    const usage = ctx.getContextUsage();
    for (const r of resources) {
      if (resourceTouched(blob, r.path)) {
        r.touched = true;
        r.staleSinceCompaction = false;
        r.lastTouchedAtTokens = usage?.tokens;
      }
    }
    if (resourceTouched(blob, "TODO.md")) ensureTodoTracked(ctx);
  }

  // B9: touch-tracking stays approximate by design (a reminder, not a ledger),
  // but require a path-like boundary before the match so "package.json" doesn't
  // get marked touched inside "my-package.json".
  function resourceTouched(blob: string, path: string): boolean {
    const idx = blob.indexOf(path);
    if (idx === -1) return false;
    const before = idx > 0 ? blob[idx - 1] : "";
    return !/[A-Za-z0-9_-]/.test(before);
  }

  // Tracks TODO.md even if it did not exist at session_start (agent created it).
  // Without this, a late-created TODO.md is invisible to stale-marking and the
  // librarian audit scope after compaction.
  function ensureTodoTracked(ctx: any) {
    if (resources.some((r) => r.path === "TODO.md")) return;
    if (!existsSync(join(ctx.cwd, "TODO.md"))) return;
    resources.push({ path: "TODO.md", label: "Task list", type: "file", touched: true, staleSinceCompaction: false });
    ulwLog("CONFIG", "TODO.md appeared after session start — added to tracked resources");
  }

  // ── Librarian Call ─────────────────────────────────────────────

  async function callLibrarian(ctx: any, reason: string): Promise<string | null> {
    const t0 = Date.now();
    ulwLog("LIB", `callLibrarian START reason="${reason}" active=${ultraworkActive}`);

    if (librarianRunning) {
      ctx.ui.setStatus("ultrawork-librarian", "skipped: already running");
      ulwLog("LIB", `SKIPPED: already running (elapsed ${Date.now() - t0}ms)`);
      return null;
    }
    librarianRunning = true;

    const untouched = resources.filter((r) => !r.touched);
    const stale = resources.filter((r) => r.touched && r.staleSinceCompaction);

    ulwLog("LIB", `audit scope: untouched=[${untouched.map((r) => r.path).join(", ") || "none"}] stale=[${stale.map((r) => r.path).join(", ") || "none"}] digestBuf=${digestBuffer.length} claimsBuf=${assertionBuffer.size}`);

    if (untouched.length === 0 && stale.length === 0 && digestBuffer.length === 0 && assertionBuffer.size === 0) {
      ctx.ui.setStatus("ultrawork-librarian", "skipped: nothing to audit");
      ulwLog("LIB", "SKIPPED: nothing to audit");
      librarianRunning = false;
      return null;
    }

    const libModel = resolveLibrarianModel(ctx);
    ctx.ui.setStatus("ultrawork-librarian", `calling ${libModel?.id ?? "no model"}...`);
    ulwLog("LIB", `librarian model: ${libModel?.id ?? "NONE"} (override=${process.env.PI_LIBRARIAN_MODEL || "none"})`);

    try {
      // Single source of truth shared with the probe (ulw-analysis/probe_claims.ts):
      // base system prompt + claim-shape addendum, resources, tool digest, AND
      // the agent's recent claims (the new channel — see claim_audit.ts).
      // The deterministic shape-scan of the agent's recent claims rides along
      // with the model's own judgment: regex hits are structural, not vibes.
      const claimsRecent = assertionBuffer.recent(6);
      const shapeHits = detectRiskyShapes(claimsRecent.join("\n"));
      const { system, user } = buildLibrarianPrompts({
        triggerReason: reason,
        untouched: untouched.map((r) => ({ label: r.label, path: r.path })),
        stale: stale.map((r) => ({ label: r.label, path: r.path })),
        digest: digestBuffer,
        claims: claimsRecent,
        shapes: shapeHits.length > 0 ? renderShapeHits(shapeHits) : undefined,
      });
      if (shapeHits.length > 0) {
        ulwLog("LIB", `shape scan: ${shapeHits.length} hit(s) [${shapeHits.map((h) => h.kind).join(",")}]`);
      }

      // maxTokens 220 -> 500: probe_claims.ts showed a thinking model spends
      // ~680 tokens of reasoning before the bullets once claims are in the
      // prompt; at 220 the budget is eaten by reasoning and content comes back
      // empty (the reasoning_content fallback then injects raw thinking as the
      // nudge). 500 covers the bullets with margin on the 4B; revisit if the
      // production 27B is less verbose.
      let bullets = await chatCompletionViaModel(ctx, system, user, { maxTokens: 500, timeoutMs: LIBRARIAN_TIMEOUT_MS });
      bullets = trimToBullets(bullets);

      ulwLog("LIB", `model response (${Date.now() - t0}ms): ${JSON.stringify(bullets).slice(0, 500)}`);

      if (!bullets) {
        ctx.ui.setStatus("ultrawork-librarian", "empty response from model");
        ulwLog("LIB", "EMPTY response from model — no nudge sent");
        return null;
      }

      lastLibrarianTokens = ctx.getContextUsage()?.tokens ?? lastLibrarianTokens;
      await pi.appendEntry("librarian-report", { reason, bullets, tokens: lastLibrarianTokens });

      pi.sendMessage(
        { customType: "librarian-nudge", content: `Context check:\n${bullets}`, display: true },
        { deliverAs: "steer", triggerTurn: true },
      );

      // B10: the digest is "activity since the last nudge". Clear it now that
      // we've reminded the agent about these lines, so the next trigger shows
      // fresh activity instead of re-sending the same 15 tool calls.
      digestBuffer.length = 0;
      // Same lifecycle as the digest: claims already audited are re-audited
      // only if they're still in the buffer's recent window on the next nudge.
      assertionBuffer.clear();

      ctx.ui.setStatus("ultrawork-librarian", "nudge delivered");
      ulwLog("LIB", `NUDGE delivered as steer (${Date.now() - t0}ms): ${bullets.replace(/\n/g, " | ").slice(0, 300)}`);
      return bullets;
    } catch (e: any) {
      const msg = String(e).slice(0, 60);
      ulwLog("LIB", `ERROR: ${msg} (elapsed ${Date.now() - t0}ms)`);
      ctx.ui.setStatus("ultrawork-librarian", `librarian check failed: ${msg}`);
      ctx.ui.notify(`Librarian failed: ${msg}`, "error");
      return null;
    } finally {
      librarianRunning = false;
      lastLibrarianFinishedAt = Date.now();
      ulwLog("LIB", `callLibrarian END total=${Date.now() - t0}ms`);
    }
  }

  // ── Research Loop Integration ──────────────────────────────────

  async function runResearchLoop(ctx: any): Promise<string> {
    const pendingClaims = getClaimsNeedingResearch(engine.state);
    ulwLog("RESEARCH", `runResearchLoop START pending=${pendingClaims.length} ids=[${pendingClaims.map((c) => c.id).join(", ") || "none"}]`);
    if (pendingClaims.length === 0) {
      ctx.ui.setStatus("ultrawork-research", "no claims need research");
      return "No claims need research (each is already >= 0.5 confidence or has hit its round cap).";
    }

    ctx.ui.setStatus("ultrawork-research", `re-scoring ${pendingClaims.length} claim(s) from memory...`);
    await engine.runFullLoop(rawLLMCall);
    ctx.ui.setStatus("ultrawork-research", "re-score complete");
    const after = Array.from(engine.state.claims.values()).map((c) => `${c.id}:${c.status}:${c.confidence.toFixed(2)}`).join(", ");
    ulwLog("RESEARCH", `runResearchLoop END claims=[${after}]`);

    // Priority-4: surface the recall as a NUDGE. Memory carries zero confidence
    // weight, so a claim only reaches "verified" once the agent opens its source
    // (playwright) and calls evidence_add with the real URL. Show each claim's
    // latest memory recall so the agent knows exactly what to go check.
    const lines = pendingClaims.map((c) => {
      const mem = c.evidence.filter((e) => e.origin === "memory");
      const recall = mem.length > 0 ? mem[mem.length - 1].excerpt.slice(0, 160) : "(nothing recalled from memory)";
      return `${c.id} [${c.status} conf=${c.confidence.toFixed(2)}] -> ${recall}`;
    });
    return [
      "Memory re-score complete (local model, no web access — a NUDGE, not live verification).",
      "Memory carries zero confidence weight, so these claims stay pending until you OPEN the source (playwright) and call evidence_add with the URL you actually opened:",
      ...lines,
    ].join("\n");
  }

  // ── Hooks ──────────────────────────────────────────────────────

  pi.on("session_start", (_event, ctx) => {
    ulwLogSessionStart();
    loadProjectConfig(ctx);
    engine = createResearchLoop({
      maxRounds: config.maxResearchRounds,
      minConfidenceForAnswer: config.minConfidenceForAnswer,
      routerBaseUrl: config.routerBaseUrl,
      model: config.librarianModel,
      timeoutMs: config.timeoutMs,
    });
    lastLibrarianTokens = 0;
    digestBuffer = [];
    assertionBuffer = new AssertionBuffer();
    pendingArgs.clear();
    ulwLog("SESSION_START", `session_start fired (ultraworkActive=${ultraworkActive})`);
  });

  pi.on("tool_execution_start", (event) => {
    pendingArgs.set(event.toolCallId, event.args);
    ulwLog("TOOL_START", `${event.toolName} args=${JSON.stringify(event.args ?? {}).slice(0, 200)}`);
  });

  // Capture the agent's OWN text (its claims) at the end of every ASSISTANT
  // MESSAGE. We used to hook `turn_end`, but a pi "turn" is the WHOLE agentic
  // episode for one user message — turn_end fires once at the very end, so
  // long tool loops captured ~0 claims (observed: 1 claim across 152 tool
  // calls). `message_end` fires at the end of every message, so each
  // assistant text block is captured. It fires BEFORE the tool call that
  // follows the message reaches tool_execution_end (where the token gate reads
  // the buffer), so ordering is preserved. We filter role==="assistant" so we
  // don't capture user or tool-result messages. Thinking + toolCall blocks are
  // filtered out by extractAssistantText — only generated text is kept.
  pi.on("message_end", (event) => {
    const msg = (event as any).message;
    if (msg?.role !== "assistant") return;
    const text = extractAssistantText(msg);
    if (text) {
      assertionBuffer.push(text);
      ulwLog("CLAIM", `captured assertion (${text.length}ch, buf=${assertionBuffer.size}): ${text.replace(/\n/g, " ").slice(0, 150)}`);
    }
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    const args = pendingArgs.get(event.toolCallId);
    pendingArgs.delete(event.toolCallId);
    if (!ultraworkActive) {
      ulwLog("TOOL_END", `${event.toolName} (inactive — ultrawork not enabled via /ulw)`);
      return;
    }
    if (event.isError) {
      ulwLog("TOOL_END", `${event.toolName} isError=true`);
      return;
    }

    noteToolTouch(event.toolName, args, ctx);

    const usage = ctx.getContextUsage();
    if (!usage || usage.tokens == null) {
      ulwLog("TOOL_END", `${event.toolName} ok, no token usage reported`);
      return;
    }

    // context-prune coexistence: a prune flush replaces pruned tool results with
    // summaries, dropping the live token count sharply (e.g. 119k -> 45k).
    // lastLibrarianTokens is pinned at the pre-flush peak, so the delta
    // (tokens - lastLibrarianTokens) stays negative and the librarian can never
    // re-trigger until a compaction resets it to 0. When context drops by at
    // least reTriggerDelta, treat it as a fresh baseline so the librarian can
    // fire again on the next growth. (Normal growth is monotonic; a >=delta drop
    // is a prune flush or a resume, not noise.)
    if (lastLibrarianTokens > 0 && usage.tokens < lastLibrarianTokens - config.reTriggerDeltaTokens) {
      ulwLog("TOOL_END", `${event.toolName} context drop ${lastLibrarianTokens}->${usage.tokens} (prune flush / resume); resetting librarian baseline to ${usage.tokens}`);
      lastLibrarianTokens = usage.tokens;
    }

    const cooldownOk = Date.now() - lastLibrarianFinishedAt >= LIBRARIAN_COOLDOWN_MS;
    const triggerHit =
      usage.tokens >= config.contextTriggerTokens &&
      usage.tokens - lastLibrarianTokens >= config.reTriggerDeltaTokens &&
      cooldownOk;
    ulwLog("TOOL_END", `${event.toolName} ok tokens=${usage.tokens} lastLibrarian=${lastLibrarianTokens} cooldown=${cooldownOk} autoTrigger=${triggerHit}`);

    if (triggerHit) {
      await callLibrarian(ctx, `context at ~${usage.tokens} tokens`);
    }
  });

  pi.on("session_compact", (_event, ctx) => {
    if (!ultraworkActive) return;
    ulwLog("COMPACT", `session_compact fired — marking touched resources stale, resetting lastLibrarianTokens`);
    for (const r of resources) if (r.touched) r.staleSinceCompaction = true;
    lastLibrarianTokens = 0;
    ensureTodoTracked(ctx);
    // No callLibrarian here: during compaction the router is busy generating
    // the summary, so the fetch hangs to the 60s timeout (AbortError) and
    // holds librarianRunning, blocking auto-trigger checks for a minute.
    // Stale flags are picked up by the next auto-trigger or /ulw-check.
    ulwLog("COMPACT", `stale now=[${resources.filter((r) => r.staleSinceCompaction).map((r) => r.path).join(", ") || "none"}]`);

    schedule(() => {
      // sendMessage(triggerTurn) instead of sendUserMessage(followUp): followUp piles up in the
      // pending-messages overlay ("Follow-up: …") and every compaction stacks another one. While
      // idle, triggerTurn calls _runAgentPrompt directly → the model still gets the instruction and
      // a turn is triggered, but nothing is added to the overlay queue.
      pi.sendMessage(
        {
          customType: "ulw_followup",
          content: [{ type: "text", text: "Context was compacted. Continue the SAME task. " +
            "Do not assume completion. " +
            "Re-read TODO.md and determine whether work remains. " +
            "If unfinished, continue using tools. " +
            "Only finish once every TODO is [x] and all verification passes." }],
          display: "ulw: post-compaction continuation",
        },
        { triggerTurn: true },
      );
    }, 3000);
  });

  // Cancel any deferred follow-up messages and drop in-flight tool args so a
  // late setTimeout can't land a nudge into a brand-new session.
  pi.on("session_shutdown", () => {
    for (const t of pendingTimeouts) clearTimeout(t);
    pendingTimeouts.clear();
    pendingArgs.clear();
    ulwLog("SHUTDOWN", `session_shutdown — cleared ${pendingTimeouts.size} timer(s) and pendingArgs`);
  });

  // ── Agent-Callable Tools ───────────────────────────────────────

  // reground_check — manual librarian trigger
  if (!ULW_OFF) pi.registerTool({
    name: "reground_check",
    label: "Reground Check",
    description: "Run an out-of-band audit for stale or unopened critical resources",
    promptSnippet: "Manually request a context-grounding audit",
    promptGuidelines: [
      "Call reground_check when uncertain whether a claim about docs, an API, or a paper should be verified against a live source instead of trusting recall.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      ulwLog("TOOL", "reground_check invoked by agent");
      const bullets = await callLibrarian(ctx, "agent-requested check");
      // B7: report what actually happened, not a fixed "dispatched".
      const text = bullets
        ? "Reground check complete — context nudge delivered."
        : "Reground check ran but delivered no nudge: either nothing needed flagging (no unopened/stale resources and no new activity) or another check was already in flight.";
      return { content: [{ type: "text", text }], details: { delivered: bullets != null } };
    },
  });

  // evidence_register — register a claim for tracking
  if (!ULW_OFF) pi.registerTool({
    name: "evidence_register",
    label: "Evidence Register",
    description: "Register a claim/fact that needs evidence tracking. The system will monitor confidence and trigger research if needed.",
    promptSnippet: "Register a claim that needs evidence verification",
    promptGuidelines: [
      "Call evidence_register when the agent makes a factual claim that should be verified against external sources.",
    ],
    parameters: Type.Object({
      statement: Type.String({ description: "The claim or fact to track" }),
      confidence: Type.Optional(Type.Number({ description: "Initial confidence 0-1 (default 0)" })),
      missing_info: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ulwLog("TOOL", `evidence_register statement="${params.statement.slice(0, 80)}" confidence=${params.confidence ?? 0}`);
      const threshold = classifyThreshold(params.statement);
      const claim = engine.registerClaim(params.statement, {
        confidence: params.confidence ?? 0,
        missing_info: params.missing_info,
      });

      await pi.appendEntry("evidence-claim", { claimId: claim.id, statement: claim.statement, threshold });
      ctx.ui.notify(`Claim registered: ${claim.id} (threshold: ${threshold})`, "info");

      return {
        content: [{ type: "text", text: `Claim registered as ${claim.id}. Status: ${claim.status}. Threshold: ${threshold}.` }],
        details: { claimId: claim.id, threshold },
      };
    },
  });

  // evidence_add — add evidence to a claim
  if (!ULW_OFF) pi.registerTool({
    name: "evidence_add",
    label: "Evidence Add",
    description: "Add evidence to a tracked claim. Source types: official_docs, official_repo, specification, reputable_source, community, webpage",
    promptSnippet: "Add evidence to a previously registered claim",
    promptGuidelines: [
      "Call evidence_add after finding evidence from documentation (open it live in a browser with playwright), source code, or other sources.",
      "Include the url you actually opened — the source label is cross-checked against the URL, so a high-authority label on a community URL is downgraded automatically. This is the path that makes a claim verified.",
    ],
    parameters: Type.Object({
      claim_id: Type.String({ description: "Claim ID (e.g. claim_1)" }),
      source: Type.Unsafe({ type: "string", enum: ["official_docs", "official_repo", "specification", "reputable_source", "community", "webpage"] }),
      url: Type.Optional(Type.String()),
      excerpt: Type.String({ description: "Direct quote or paraphrase with attribution" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ulwLog("TOOL", `evidence_add claim=${params.claim_id} source=${params.source}`);
      const claim = engine.addEvidenceToClaim(params.claim_id, {
        source: params.source as EvidenceSource,
        url: params.url,
        excerpt: params.excerpt,
        timestamp: Date.now(),
      });

      if (!claim) {
        return { content: [{ type: "text", text: `Claim ${params.claim_id} not found.` }], details: {} };
      }

      await pi.appendEntry("evidence-update", { claimId: params.claim_id, status: claim.status, confidence: claim.confidence });
      ctx.ui.notify(`Evidence added to ${params.claim_id}: status=${claim.status}, confidence=${claim.confidence.toFixed(2)}`, "info");

      return {
        content: [{ type: "text", text: `Claim ${params.claim_id} updated: status=${claim.status}, confidence=${claim.confidence.toFixed(2)}` }],
        details: { status: claim.status, confidence: claim.confidence },
      };
    },
  });

  // evidence_check — check status of all claims
  if (!ULW_OFF) pi.registerTool({
    name: "evidence_check",
    label: "Evidence Check",
    description: "Check the status of all tracked claims. Shows confidence, evidence count, and research needs.",
    promptSnippet: "Check status of all evidence-tracked claims",
    promptGuidelines: [
      "Call evidence_check to see which claims need more research or are ready to be answered.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
      const claims = Array.from(engine.state.claims.values());
      ulwLog("TOOL", `evidence_check claims=${claims.length}`);
      if (claims.length === 0) {
        return { content: [{ type: "text", text: "No claims registered." }], details: {} };
      }

      const lines = claims.map((c) => {
        const signals = detectUnknownSignals(c);
        const signalStr = signals.length > 0 ? ` [${signals.map((s) => s.type).join(", ")}]` : "";
        return `  ${c.id}: ${c.statement.slice(0, 60)}... | status=${c.status} | confidence=${c.confidence.toFixed(2)} | evidence=${c.evidence.length} | rounds=${c.research_rounds}${signalStr}`;
      });

      const summary = [
        `Evidence State (${claims.length} claims)`,
        `─────────────────────────────────────`,
        ...lines,
        ``,
        `Ready to answer (verified, conf >= ${config.minConfidenceForAnswer}): ${claims.filter((c) => canAnswer(c, config.minConfidenceForAnswer)).length}`,
        `Verified: ${claims.filter((c) => c.status === "verified").length}`,
        `Conflicted: ${claims.filter((c) => c.status === "conflicted").length}`,
        `Unverified: ${claims.filter((c) => c.status === "unverified").length}`,
        `Claims needing research: ${getClaimsNeedingResearch(engine.state).length}`,
      ].join("\n");

      return { content: [{ type: "text", text: summary }], details: {} };
    },
  });

  // research_loop — run the full research loop
  if (!ULW_OFF) pi.registerTool({
    name: "research_loop",
    label: "Research Loop",
    description: "Re-score registered claims from the local model's MEMORY (no web access) — a nudge, not live verification. Memory evidence carries zero confidence weight, so a claim only reaches 'verified' after you open its source in a browser (playwright) and call evidence_add with the real URL.",
    promptSnippet: "Re-score claims from model memory (a nudge, not verification); open sources live to truly verify",
    promptGuidelines: [
      "Call research_loop to see what the local model recalls about low-confidence claims (it tells you what to go verify).",
      "It is NOT verification. To verify a claim, open the source in a browser (playwright) and call evidence_add with the URL you actually opened.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const summary = await runResearchLoop(ctx);
      return { content: [{ type: "text", text: summary }], details: {} };
    },
  });

  // research_dispatch — SEQUENTIAL live-web research (the web-nudge's core tool).
  // Spawned researcher: fresh headless `pi -p` session, SAME model as the agent,
  // lean system prompt, owns the playwright bridge for the duration. Blocks
  // this tool call (and the agent's turn) until the artifact exists; the only
  // trace that crosses back is buildCompactSummary's text.
  // Recursion guard: the researcher child loads this extension too (for the
  // pw_* bridge), but PI_RESEARCH_CHILD=1 (set on the child's env) keeps it
  // from registering research_dispatch → no infinite dispatch.
  if (!ULW_OFF && !ULW_NO_DISPATCH && !process.env.PI_RESEARCH_CHILD) {
    pi.registerTool({
      name: "research_dispatch",
      label: "Research Dispatch",
      description: "SEQUENTIAL live-web research: dispatches a librarian sub-agent (fresh headless pi session, same model) that opens live sources with the browser and writes an evidence artifact. Blocks until the evidence exists; returns ONLY the compact result (sources actually opened + what they say). Use for any TRUST-SHAPE claim — exact flag/API/identifier, version/temporal, numeric default, universal negative, niche entity — before writing code on top of it.",
      promptSnippet: "Dispatch a librarian sub-agent to verify a claim against LIVE web sources (blocks until evidence exists; returns the compact summary)",
      promptGuidelines: [
        "Call research_dispatch when a claim has a TRUST SHAPE (exact identifier/flag, version/temporal, numeric default, universal negative, niche entity) and you are about to write code or a final answer on top of it.",
        "It BLOCKS until the researcher writes its artifact — the returned summary is the ground truth for that claim (with the sources actually opened). Prefer it over your memory.",
        "Pass hints (URLs or search phrases) when you know where to look. If the result is INCONCLUSIVE, code to a hedge or re-dispatch with sharper hints — do not code to memory.",
      ],
      parameters: Type.Object({
        statement: Type.String({ description: "The claim to verify (specific and checkable, not a question)" }),
        claim_id: Type.Optional(Type.String({ description: "Reuse an existing claim id from evidence_register (a new claim is registered automatically if omitted)" })),
        hints: Type.Optional(Type.Array(Type.String(), { description: "URLs or search phrases to start from" })),
        max_steps: Type.Optional(Type.Number({ description: "Researcher tool-call budget (default 14, cap 24)" })),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        ulwLog("DISPATCH", `research_dispatch invoked claim_id=${params.claim_id ?? "auto"} statement="${params.statement.slice(0, 80)}"`);

        // 1) Resolve or register the claim in the evidence ledger.
        const existing = params.claim_id ? engine.state.claims.get(params.claim_id) : undefined;
        if (params.claim_id && !existing) {
          return {
            content: [{ type: "text", text: `claim_id ${params.claim_id} not found — omit claim_id to auto-register a new claim, or evidence_register it first.` }],
            details: {},
          };
        }
        const claim = existing ?? engine.registerClaim(params.statement);

        // 2) Same-weights researcher: the child runs the agent's CURRENT model.
        const model: any = (ctx as any).model;
        const provider = model?.provider ?? "llamacpp";
        const modelId = model?.id ?? "qwen3.8-27b";
        ctx.ui.setStatus?.("ultrawork-research", `dispatching researcher (${modelId}) for ${claim.id}…`);

        const r = await dispatchResearch({
          provider,
          modelId,
          cwd: ctx.cwd,
          claimId: claim.id,
          statement: params.statement,
          hints: params.hints,
          maxSteps: Math.max(4, Math.min(params.max_steps ?? 14, 24)),
          onEvent: (line) => ulwLog("DISPATCH", line.slice(0, 200)),
        });
        ctx.ui.notify?.(`research_dispatch ${claim.id}: ${r.status} (${Math.round(r.elapsedMs / 1000)}s)`, r.status === "verified" ? "info" : "error");

        // 3) Fold the artifact into the evidence ledger: each source the
        //    researcher ACTUALLY opened becomes one external evidence entry
        //    (addEvidence re-reconciles the label against the URL — the same
        //    anti-masquerade rule as evidence_add).
        if (r.artifact) {
          const labels: EvidenceSource[] = ["official_docs", "official_repo", "specification", "reputable_source", "community", "webpage"];
          const sources = r.artifact.sources.slice(0, 5);
          if (sources.length === 0) {
            engine.addEvidenceToClaim(claim.id, { source: "webpage", excerpt: r.artifact.summary, timestamp: Date.now() });
          } else {
            for (const s of sources) {
              engine.addEvidenceToClaim(claim.id, {
                source: (labels.includes(s.label as EvidenceSource) ? s.label : "webpage") as EvidenceSource,
                url: s.url,
                excerpt: (s.quote ? s.quote + " — " : "") + r.artifact.summary,
                timestamp: Date.now(),
              });
            }
          }
        }
        const after = engine.state.claims.get(claim.id);
        await pi.appendEntry("research-dispatch", {
          claimId: claim.id,
          status: r.status,
          elapsedMs: r.elapsedMs,
          artifactPath: r.artifactPath,
          summary: r.summary.slice(0, 800),
        });
        const ledgerLine = after ? `\n(evidence ledger: ${claim.id} status=${after.status} conf=${after.confidence.toFixed(2)})` : "";
        ulwLog("DISPATCH", `tool done claim=${claim.id} status=${r.status} elapsed=${r.elapsedMs}ms ledger=${after ? `${after.status}/${after.confidence.toFixed(2)}` : "n/a"}`);
        return { content: [{ type: "text", text: r.summary + ledgerLine }], details: { claimId: claim.id, status: r.status, elapsedMs: r.elapsedMs } };
      },
    });
  } else {
    ulwLog("LOAD", `research_dispatch tool SKIPPED (ULW_OFF=${ULW_OFF} NO_DISPATCH=${ULW_NO_DISPATCH} CHILD=${process.env.PI_RESEARCH_CHILD ?? 0})`);
  }

  // ── Loop Guard ─────────────────────────────────────────────────

  pi.on("agent_end", async (_event, ctx) => {
    if (!ultraworkActive) {
      ulwLog("AGENT_END", "agent_end fired (inactive — ultrawork not enabled)");
      return;
    }

    let incomplete = false;
    try {
      ensureTodoTracked(ctx);
      const todoPath = join(ctx.cwd, "TODO.md");
      const todo = stripBom(readFileSync(todoPath, "utf-8"));
      incomplete = /^- \[ \]/m.test(todo);
    } catch {
      ulwLog("AGENT_END", "agent_end: no TODO.md found — loop guard skipped");
      return;
    }

    ulwLog("AGENT_END", `agent_end fired incomplete=${incomplete} retries=${retries}/${MAX_RETRIES}`);

    if (incomplete && retries < MAX_RETRIES) {
      retries++;
      ulwLog("AGENT_END", `LOOP GUARD TRIPPED — sending resume message (retry ${retries}/${MAX_RETRIES})`);
      ctx.ui.notify(`Ultrawork: incomplete TODOs detected (retry ${retries}/${MAX_RETRIES})`, "info");
      schedule(() => {
        // sendMessage(triggerTurn): model gets the resume instruction and a turn is triggered, but
        // the pending-overlay ("Follow-up: …") no longer piles up the view on every loop-guard trip.
        pi.sendMessage(
          {
            customType: "ulw_followup",
            content: [{ type: "text", text: "You stopped but TODO.md still has unchecked items. " +
              "Resume. Use tools. Do NOT summarize progress — act on the next item.\n" +
              "Review completed work: (1) syntax errors or failed tests?, (2) full smoketest including UI?, (3) all TODO.md items [x]. Report ONLY failures. If none, say Verification PASS." }],
            display: "ulw: incomplete-TODO resume",
          },
          { triggerTurn: true },
        );
      }, 500);
      return;
    }
  });

  // ── System Prompt Injection ────────────────────────────────────

  pi.on("before_agent_start", (event, _ctx) => {
    if (!ultraworkActive) {
      ulwLog("PROMPT", "before_agent_start: inactive — no prompt injection");
      return {};
    }
    ulwLog("PROMPT", "before_agent_start: injecting completion contract + epistemic protocol");
    const epistemicSection = EpistemicProtocol.buildSystemPromptSection();

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n## Completion contract (ENFORCED BY HARNESS)\n" +
        "- Maintain TODO.md. Mark items [x] only when fully verified and append Todos necessary before proceeding.\n" +
        "- Never produce a final text response without a preceding tool call unless ALL items are [x].\n" +
        "- Update scrapbook.md (max 500 words) before stopping.\n" +
        "- Write files in chunks <=500 lines. Split logic across files if needed.\n" +
        "- ALWAYS SmokeTest any tiny code change before moving on. No matter how small, ALWAYS SmokeTest, including the UI/frontend if the project has a UI.\n" +
        "- Always check if a command will be a foreground blocking process — if so, run it with bg_run.\n" +
        "- When exploring code wiring, create lossless-compression ASCII-art representations in conversation context.\n" +
        "- Never hastily declare completion. Check your own work by smokeTest. Use sleep timers to periodically babysit long processes.\n" +
        "- If a context note appears prefixed 'Context check:', treat it as a verification reminder. Do not assume claims are true without checking.\n" +
        "- External claims (APIs, library behavior, docs, research papers): verify them with research_dispatch — a librarian sub-agent opens the live source and returns clean evidence (you never have to browse yourself). If it comes back INCONCLUSIVE, browse yourself with the pw_* tools. Recall is not verification.\n" +
        "\n" + TRUST_SHAPES_SECTION + "\n\n" + epistemicSection,
    };
  });

  // ── Commands ───────────────────────────────────────────────────

  pi.registerCommand("ulw", {
    description: "Activate loop-guard + verification + librarian regrounding for next task",
    handler: async (_args, _ctx) => {
      ultraworkActive = true;
      retries = 0;
      ulwLog("CMD", "/ulw — ultrawork activated (retries reset)");
      _ctx.ui.notify("ultrawork enabled. follow up with prompt", "info");
      await pi.appendEntry("ultrawork-activated", {
        content: "Ultrawork active: loop guard + verification + librarian + evidence tracking enabled.",
      });
    },
  });

  pi.registerCommand("ulw-check", {
    description: "Force an immediate librarian regrounding check (debug, ignores thresholds)",
    handler: async (_args, ctx) => {
      ulwLog("CMD", "/ulw-check — manual librarian check requested");
      ctx.ui.notify("Running manual librarian check...", "info");
      await callLibrarian(ctx, "manual /ulw-check");
    },
  });

  pi.registerCommand("ulw-evidence", {
    description: "Show evidence state summary",
    handler: async (_args, ctx) => {
      const claims = Array.from(engine.state.claims.values());
      const summary = [
        `Ultrawork Evidence State`,
        `────────────────────────`,
        `Total claims: ${claims.length}`,
        `Ready to answer (verified, conf >= ${config.minConfidenceForAnswer}): ${claims.filter((c) => canAnswer(c, config.minConfidenceForAnswer)).length}`,
        `Verified: ${claims.filter((c) => c.status === "verified").length}`,
        `Conflicted: ${claims.filter((c) => c.status === "conflicted").length}`,
        `Pending research: ${claims.filter((c) => c.status === "pending_research").length}`,
        `Unverified: ${claims.filter((c) => c.status === "unverified").length}`,
        `Claims needing research: ${getClaimsNeedingResearch(engine.state).length}`,
      ].join("\n");
      ulwLog("CMD", `/ulw-evidence — claims=${claims.length} verified=${claims.filter((c) => c.status === "verified").length} unverified=${claims.filter((c) => c.status === "unverified").length}`);
      ctx.ui.notify(summary, "info");
    },
  });
}

// ── Epistemic Protocol (delegated to epistemic_protocol.ts module) ──
// The EpistemicProtocol class is defined in epistemic_protocol.ts
// and imported here for system prompt injection.
// See epistemic_protocol.ts for the full implementation.
