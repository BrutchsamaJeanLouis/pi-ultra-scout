// claim_audit.ts — claim-shape auditing for the ultrawork librarian.
//
// Pure module: no side effects, no pi imports, so BOTH the extension and a
// standalone probe (ulw-analysis/probe_claims.ts) can import the exact same
// prompt builders. This guarantees the probe tests what actually ships.
//
// Why this exists (see ulw-analysis/ultrawork-deep-analysis.md §9.4):
// the librarian's input was file-list + tool-call digest only — it saw what
// the agent CLICKED, not what it SAID. But the design's purpose is to flag
// untrustworthy CLAIMS, and claims live in the agent's generated text. This
// module feeds the agent's own assertions to the librarian and instructs it to
// flag risky CLAIM SHAPES (exact strings / recency / long-tail / negatives),
// not just unopened resources.

/**
 * Extract the assistant's generated TEXT from an AgentMessage.
 * Handles both a plain-string content and an array of content blocks
 * ({type:"text"}, {type:"thinking"}, {type:"toolCall"}, ...).
 * Thinking blocks are internal reasoning, not claims to the world — skip them.
 */
export function extractAssistantText(message: any): string {
  const c = message?.content;
  if (!c) return "";
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c
      .filter((b: any) => b && b.type === "text")
      .map((b: any) => (typeof b.text === "string" ? b.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

/**
 * Rolling buffer of the agent's recent claims (its own generated text).
 * Bounded by item count AND total characters so the librarian prompt stays small.
 * Mirrors the existing digestBuffer lifecycle (cleared on nudge delivery).
 */
export class AssertionBuffer {
  private items: string[] = [];
  constructor(
    private readonly maxItems = 30,
    private readonly maxChars = 4000,
    private readonly minLen = 40,
    private readonly perItemCap = 600,
  ) {}
  push(text: string) {
    const t = (text ?? "").trim();
    if (t.length < this.minLen) return;
    this.items.push(t.slice(0, this.perItemCap));
    while (this.items.length > this.maxItems) this.items.shift();
    let total = this.items.reduce((a, b) => a + b.length, 0);
    while (total > this.maxChars && this.items.length > 1) {
      this.items.shift();
      total = this.items.reduce((a, b) => a + b.length, 0);
    }
  }
  recent(n: number): string[] {
    return this.items.slice(-n);
  }
  clear() {
    this.items.length = 0;
  }
  get size(): number {
    return this.items.length;
  }
}

/**
 * The base librarian system prompt — moved here VERBATIM from ultrawork.ts so
 * the probe and production share one source of truth. Do not edit semantics.
 */
export const CLAIM_BASE_SYSTEM =
  "You are a silent context-audit process for an autonomous coding agent. " +
  "You never solve tasks and never explain yourself. Output ONLY a bullet list, " +
  "max 6 bullets, each under 20 words, no preamble, no headers, no markdown fences. " +
  "Each bullet is a direct reminder addressed to the agent, naming an exact file path " +
  "or URL when relevant. If any claim depends on external documentation, an API, or a paper, " +
  "include a bullet telling the agent to call research_dispatch with that exact claim — a " +
  "librarian sub-agent opens the live source and returns clean evidence (the agent never has " +
  "to browse itself). If nothing is worth flagging, output a single bullet: '- nothing to reground.'";

/**
 * The claim-shape addendum. This is the core of the change: it points the
 * librarian at the AGENT'S OWN CLAIMS and tells it to flag risky claim shapes.
 */
export const CLAIM_SYSTEM_ADDENDUM =
  "\nAlso audit the agent's OWN recent claims (its generated text, listed under " +
  "'Agent's recent claims' below). A claim is RISKY BY SHAPE if it is: " +
  "(a) an exact API/flag/parameter/argument name, (b) a version number or " +
  "'latest/current/best practice', (c) a specific numeric value (limit, threshold, " +
  "default), (d) a negative/absence ('X does not support/do Y', 'there is no Z'), " +
  "or (e) a long-tail niche entity — AND the agent will act on it (non-trivial stakes). " +
  "For each risky claim emit ONE bullet telling the agent to call research_dispatch(statement) " +
  "for that specific claim (the sub-agent opens the live source; the agent only sees the clean " +
  "result), or to restate it hedged with the shape labelled. Do NOT flag general concepts or " +
  "stable, timeless knowledge. Emit at most 2 claim-shape bullets so the nudge stays actionable.";

/**
 * Format the claims section of the user prompt. Returns "" when empty so the
 * caller can skip the whole section.
 */
export function buildClaimsSection(claims: string[]): string {
  if (!claims || claims.length === 0) return "";
  return (
    "Agent's recent claims (its own generated text, most recent last) — audit these for risky shapes:\n" +
    claims
      .map((c, i) => `[${i + 1}] ${c.replace(/\s+/g, " ").trim()}`)
      .join("\n")
  );
}

export interface LibrarianPromptInput {
  triggerReason: string;
  untouched: { label: string; path: string }[];
  stale: { label: string; path: string }[];
  digest: string[]; // tool activity since last nudge
  claims: string[]; // agent's recent generated text (NEW)
  shapes?: string; // deterministic regex shape-scan of the claims (NEW — trust-shapes)
}

/**
 * Build the EXACT system + user prompt the librarian receives. Single source of
 * truth shared by ultrawork.ts (production) and probe_claims.ts (probe).
 */
export function buildLibrarianPrompts(input: LibrarianPromptInput): {
  system: string;
  user: string;
} {
  const system = CLAIM_BASE_SYSTEM + CLAIM_SYSTEM_ADDENDUM;
  const parts: string[] = [];
  parts.push(`Trigger reason: ${input.triggerReason}`);
  parts.push(
    `Resources never opened this session:\n${
      input.untouched.length
        ? input.untouched.map((r) => `- ${r.label}: ${r.path}`).join("\n")
        : "(none)"
    }`,
  );
  parts.push(
    `Resources opened earlier but possibly stale after compaction:\n${
      input.stale.length
        ? input.stale.map((r) => `- ${r.label}: ${r.path}`).join("\n")
        : "(none)"
    }`,
  );
  parts.push(
    `Recent tool activity (most recent last):\n${
      input.digest.slice(-15).join("\n") || "(none)"
    }`,
  );
  const claims = buildClaimsSection(input.claims);
  if (claims) parts.push(claims);
  if (input.shapes) {
    parts.push(
      "Deterministic shape scan of the claims above (regex, independent of your judgment — " +
        "these tokens are UNTRUSTED-FROM-WEIGHTS by shape until a live source is opened):\n" +
        input.shapes
    );
  }
  return { system, user: parts.join("\n\n") };
}
