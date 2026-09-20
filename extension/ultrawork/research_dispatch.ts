// research_dispatch.ts — the out-of-band, SEQUENTIAL web researcher.
//
// The action gap: the main agent was told "verify in playwright" but had no
// atomic action for it — a browser detour is ~10 tool calls of messy DOM trace
// that pollutes the main context (and the KV cache via compaction). The fix:
// ONE tool call that spawns a fresh headless `pi -p` researcher subprocess with
// a lean system prompt, waits for it to finish (the main agent's turn is
// blocked — correctness before code, per design decision 2026-09-18), reads the
// structured evidence artifact, and returns ONLY the compact summary.
//
// KV/prefill properties (stress-tested in the session plan):
//   - researcher = fresh session, small system prompt → cheap cold prefill,
//     no dependency on the parent's cache;
//   - parent context gains exactly: one tool-call line + one compact result —
//     its prefix/KV is untouched;
//   - the messy browsing trace (snapshots, search pages) never crosses the
//     process boundary except as the artifact JSON.
//
// Pure-ish: no pi imports. Spawn is injected-friendly via input.piCmd so the
// dry-run smoke test can fake the whole researcher.

import { spawn, type ChildProcess } from "child_process";
import { mkdirSync, readFileSync, existsSync, rmSync } from "fs";
import { join } from "path";

// ── Artifact contract ──────────────────────────────────────────────

export interface ArtifactSource {
  url: string;
  quote: string;
  label: string;
}

export interface ResearchArtifact {
  claim_id: string;
  statement?: string;
  status: "verified" | "refuted" | "inconclusive";
  confidence: number;
  sources: ArtifactSource[];
  summary: string;
  timestamp?: string;
}

export interface DispatchInput {
  provider: string;
  modelId: string;
  cwd: string;
  claimId: string;
  statement: string;
  hints?: string[];
  maxSteps?: number; // tool-call budget communicated to the researcher
  timeoutMs?: number;
  /** Injectable for tests (default: env PI_RESEARCH_CMD or "pi"). */
  piCmd?: string;
  /** Extra env for the child (default includes PI_RESEARCH_CHILD=1 marker). */
  env?: Record<string, string>;
  onEvent?: (line: string) => void;
}

export interface DispatchResult {
  status: "verified" | "refuted" | "inconclusive" | "timeout" | "fail";
  claimId: string;
  artifactPath: string;
  artifact?: ResearchArtifact;
  /** The COMPACT text the main agent sees (the only trace that crosses over). */
  summary: string;
  elapsedMs: number;
  stdoutTail: string;
  stderrTail: string;
}

export const RESEARCH_DIR = (cwd: string) => join(cwd, ".pi", "evidence");
export const artifactPathFor = (cwd: string, claimId: string) => join(RESEARCH_DIR(cwd), `${claimId}.json`);

const DEFAULT_TIMEOUT_MS = Number(process.env.PI_RESEARCH_TIMEOUT_MS ?? 660_000); // was 540s; local 27B researcher observed at 508.6s (09-18 Run 2)
const TAIL_CHARS = 1_200;

// ── Researcher prompts ─────────────────────────────────────────────

export function buildResearcherSystem(artifactPath: string, maxSteps: number): string {
  return (
    `You are a RESEARCH LIBRARIAN — a sub-agent dispatched to verify exactly ONE claim from a LIVE source.\n` +
    `You do not write project code, edit project files, or run project tests.\n` +
    `Rules:\n` +
    `1. Use the pw_browser_* tools to open and READ live pages. Source preference: official docs > official repo (github) > specification/standard > reputable secondary > community (stackoverflow/reddit, pointers only).\n` +
    `2. To search, navigate a browser to a search engine or open the hint URLs directly, then read pages with pw_browser_snapshot / pw_browser_find.\n` +
    `3. Budget: at most ${maxSteps} tool calls total. If you cannot verify, STOP and report inconclusive — do not spin.\n` +
    `4. Deliverable (the ONLY thing that matters): use the write tool to save this exact JSON shape to ${artifactPath}:\n` +
    `{\n` +
    `  "claim_id": "<claim id given below>",\n` +
    `  "statement": "<the claim>",\n` +
    `  "status": "verified" | "refuted" | "inconclusive",\n` +
    `  "confidence": 0.0,\n` +
    `  "sources": [ { "url": "<url you actually opened>", "quote": "<short near-verbatim quote, <300 chars>", "label": "official_docs|official_repo|specification|reputable_source|community|webpage" } ],\n` +
    `  "summary": "1-3 sentences: what the source ACTUALLY says — include the exact value/flag/default if that is the claim"\n` +
    `}\n` +
    `5. "verified" ONLY if a page you opened directly supports the claim. "refuted" if a source contradicts it. Otherwise "inconclusive" (confidence <= 0.4; list the pages you checked in sources).\n` +
    `6. Ignore the evidence_* and reground_check tools — the artifact FILE is your deliverable.\n` +
    `7. After the file is written, reply with exactly one line: RESEARCH_DONE <status>`
  );
}

export function buildResearcherBrief(input: { claimId: string; statement: string; hints?: string[]; artifactPath: string }): string {
  const hints =
    input.hints && input.hints.length > 0
      ? input.hints.map((h) => `- ${h}`).join("\n")
      : "- (no hints — choose the most authoritative source for this claim)";
  return (
    `CLAIM TO VERIFY:\n${input.statement}\n\n` +
    `CLAIM ID: ${input.claimId}\n\n` +
    `HINTS (starting points, optional):\n${hints}\n\n` +
    `ARTIFACT PATH (absolute — write the JSON here with the write tool):\n${input.artifactPath}\n\n` +
    `Begin now: open sources, verify, write the artifact, then reply RESEARCH_DONE <status>.`
  );
}

// ── Artifact IO ────────────────────────────────────────────────────

export function validateArtifact(raw: string, claimId: string): ResearchArtifact | null {
  try {
    const a = JSON.parse(raw);
    if (!a || typeof a !== "object") return null;
    const status = a.status;
    if (status !== "verified" && status !== "refuted" && status !== "inconclusive") return null;
    if (typeof a.summary !== "string" || !a.summary.trim()) return null;
    const sources: ArtifactSource[] = Array.isArray(a.sources)
      ? a.sources
          .filter((s: any) => s && typeof s.url === "string")
          .map((s: any) => ({
            url: String(s.url).slice(0, 500),
            quote: String(s.quote ?? "").slice(0, 600),
            label: String(s.label ?? "webpage").slice(0, 40),
          }))
      : [];
    const conf = typeof a.confidence === "number" ? Math.max(0, Math.min(1, a.confidence)) : 0;
    return {
      claim_id: typeof a.claim_id === "string" && a.claim_id ? a.claim_id : claimId,
      statement: typeof a.statement === "string" ? a.statement : undefined,
      status,
      confidence: conf,
      sources,
      summary: a.summary.trim().slice(0, 1000),
      timestamp: typeof a.timestamp === "string" ? a.timestamp : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Compact text the MAIN agent receives — the only trace that crosses over. */
export function buildCompactSummary(r: Omit<DispatchResult, "summary">): string {
  const a = r.artifact;
  const lines: string[] = [];
  if (!a) {
    lines.push(`[Research: ${r.claimId}] STATUS=${r.status.toUpperCase()} (${r.elapsedMs / 1000}s)`);
    lines.push("The researcher finished but no valid artifact was written.");
    if (r.stderrTail) lines.push(`stderr tail: ${r.stderrTail}`);
    lines.push(`stdout tail: ${r.stdoutTail}`);
    lines.push("Do NOT code to memory on this claim — either hedge it, retry research_dispatch with better hints, or verify in a browser yourself.");
    return lines.join("\n");
  }
  lines.push(`[Research: ${r.claimId}] STATUS=${a.status.toUpperCase()} conf=${a.confidence.toFixed(2)} (${r.elapsedMs / 1000}s)`);
  lines.push(`Q: ${a.statement ?? ""}`);
  lines.push(`A: ${a.summary}`);
  if (a.sources.length > 0) {
    lines.push("Sources (actually opened by the researcher):");
    for (const s of a.sources.slice(0, 5)) {
      lines.push(`- [${s.label}] ${s.url}`);
      if (s.quote) lines.push(`  "${s.quote}"`);
    }
  }
  if (a.status === "inconclusive") {
    lines.push("No live source settled this claim. Code to a hedge (or to the sources checked above), not to memory — or dispatch again with sharper hints.");
  }
  return lines.join("\n");
}

// ── The dispatcher ─────────────────────────────────────────────────

export async function dispatchResearch(input: DispatchInput): Promise<DispatchResult> {
  const t0 = Date.now();
  const emit = input.onEvent ?? (() => {});
  const piCmd = input.piCmd ?? process.env.PI_RESEARCH_CMD ?? "pi";
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxSteps = input.maxSteps ?? 14;

  const dir = RESEARCH_DIR(input.cwd);
  mkdirSync(dir, { recursive: true });
  const artifactPath = artifactPathFor(input.cwd, input.claimId);
  if (existsSync(artifactPath)) rmSync(artifactPath); // fresh run — never read a stale artifact

  const system = buildResearcherSystem(artifactPath, maxSteps);
  const brief = buildResearcherBrief({ claimId: input.claimId, statement: input.statement, hints: input.hints, artifactPath });

  // Machine-readable markers AFTER the "--" separator: they land in the
  // researcher's prompt text (harmless — the brief states the same facts)
  // and let tooling/tests address the artifact without newline-fragile
  // prompt scraping.
  //
  // Windows shell:true quoting (empirically verified against dbg_pi.mjs):
  //  - unquoted multi-line args get SPLIT into ~10 argv tokens;
  //  - newlines TRUNCATE a quoted arg at the first \n;
  //  - backslashes before the closing quote get EATEN (C:\path → C:path).
  // So: newlines → space, then cmd-escape (\\ → \\\\, " → ""), then quote.
  const q = (s: string) =>
    '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '""').replace(/[\r\n]+/g, " ") + '"';
  const args = [
    "-p",
    "--no-session",
    "--provider", input.provider,
    "--model", input.modelId,
    "--system-prompt", q(system),
    "--",
    q(brief),
    "--ulw-artifact",
    q(artifactPath),
    "--ulw-claim",
    input.claimId,
  ];

  emit(`dispatch START cmd="${piCmd}" provider=${input.provider} model=${input.modelId} claim=${input.claimId} artifact=${artifactPath}`);
  const proc: ChildProcess = spawn(piCmd, args, {
    cwd: input.cwd,
    shell: true,
    env: { ...process.env, PI_RESEARCH_CHILD: "1", ...input.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (d) => { stdout += String(d); emit(`child stdout: ${String(d).trim().slice(0, 160)}`); });
  proc.stderr?.on("data", (d) => { stderr += String(d); });

  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    emit(`TIMEOUT after ${timeoutMs}ms — killing researcher`);
    try { proc.kill(); } catch {}
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 5_000).unref?.();
  }, timeoutMs);

  const code = await new Promise<number | "killed">((resolve) => {
    proc.on("error", (e) => { emit(`spawn error: ${e.message}`); resolve("killed"); });
    proc.on("exit", (c) => resolve(c ?? "killed"));
  });
  clearTimeout(killer);

  const elapsedMs = Date.now() - t0;
  const stdoutTail = stdout.slice(-TAIL_CHARS).trim();
  const stderrTail = stderr.slice(-TAIL_CHARS).trim();

  // Read + validate the artifact (the ONLY structured channel back).
  let artifact: ResearchArtifact | undefined;
  if (existsSync(artifactPath)) {
    try {
      artifact = validateArtifact(readFileSync(artifactPath, "utf-8"), input.claimId);
      if (!artifact) emit(`artifact exists but FAILED validation`);
    } catch (e: any) {
      emit(`artifact read error: ${String(e).slice(0, 120)}`);
    }
  }

  let status: DispatchResult["status"];
  if (timedOut) status = "timeout";
  else if (!artifact) status = code === "killed" || code !== 0 ? "fail" : "fail";
  else status = artifact.status;

  const partial: Omit<DispatchResult, "summary"> = {
    status,
    claimId: input.claimId,
    artifactPath,
    artifact,
    elapsedMs,
    stdoutTail,
    stderrTail,
  };
  emit(`dispatch END status=${status} elapsed=${elapsedMs}ms exit=${code} artifact=${artifact ? "yes" : "no"}`);
  return { ...partial, summary: buildCompactSummary(partial) };
}
