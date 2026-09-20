// ── Research Loop (memory re-score) ────────────────────────────────
// The loop asks the local model (no tools) to RECALL evidence for claims and
// re-scores them. That recall is tagged origin:"memory" and weighs 0 in
// confidence, so the loop is a NUDGE — it tells the agent what to go verify,
// it does not verify it. Verification only happens when the agent opens a real
// source (playwright) and calls evidence_add with a URL; that external evidence
// is what can push a claim to "verified".
//
// Confidence/status math lives in evidence_state.ts (single source of truth),
// so evidence_add and this loop can't diverge on the same claim.

import type { EvidenceState, Claim, EvidenceEntry, EvidenceSource } from "./evidence_state";
import {
  createEvidenceState,
  addClaim,
  addEvidence,
  classifyThreshold,
  requiresResearch,
  getClaimsNeedingResearch,
  recalculateConfidence,
  resolveStatus,
  RESEARCH_BELOW,
  SOURCE_AUTHORITY,
} from "./evidence_state";

// ── Config ─────────────────────────────────────────────────────────

export interface ResearchLoopConfig {
  maxRounds: number;
  minConfidenceForAnswer: number;
  routerBaseUrl: string;
  model: string;
  timeoutMs: number;
}

export function createResearchLoop(config: ResearchLoopConfig): ResearchLoopEngine {
  return new ResearchLoopEngine(config);
}

export class ResearchLoopEngine {
  private _state: EvidenceState;
  private config: ResearchLoopConfig;

  constructor(config: ResearchLoopConfig) {
    this.config = config;
    this._state = createEvidenceState(config.maxRounds, config.minConfidenceForAnswer);
  }

  get state(): EvidenceState {
    return this._state;
  }

  // ── Claim Registration ─────────────────────────────────────────

  registerClaim(statement: string, options?: {
    confidence?: number;
    status?: Claim["status"];
    missing_info?: string[];
  }): Claim {
    const threshold = classifyThreshold(statement);
    return addClaim(this._state, statement, {
      ...options,
      status: options?.status ?? (requiresResearch(threshold) ? "pending_research" : "unverified"),
    });
  }

  // ── Evidence Addition ──────────────────────────────────────────
  // addEvidence recomputes authority (and reconciles the source label against
  // the URL), so there is nothing to set here.

  addEvidenceToClaim(claimId: string, entry: Omit<EvidenceEntry, "authority">): Claim | null {
    return addEvidence(this._state, claimId, entry);
  }

  // ── Build Research Prompt ──────────────────────────────────────
  // Constructs the prompt for the librarian to RECALL evidence for a claim.

  buildResearchPrompt(claim: Claim): { system: string; user: string } {
    const system = `You are a memory-recall process for an autonomous coding agent. You have NO tools and cannot open any URL — you are only recalling what you already know from your own weights. Do not invent details; recall only what you are confident about.

For each relevant fact you recall, output:
EVIDENCE:
  source: <best-effort label: official_docs|official_repo|specification|reputable_source|community|webpage>
  url: <url you believe is correct, or "none">
  excerpt: <what you recall, clearly framed as a recollection>

A URL you recall is a POINTER TO CHECK, not proof. If you cannot confidently recall a supporting or refuting fact, output exactly:
NO_EVIDENCE: <reason why>`;

    const externalCount = claim.evidence.filter((e) => e.origin !== "memory").length;
    const user = `RESEARCH QUESTION (recall only):
${claim.statement}

Current confidence: ${claim.confidence.toFixed(2)}
Current external (opened) evidence: ${externalCount} sources
Research round: ${claim.research_rounds}/${this.config.maxRounds}

Recalled so far:
${claim.evidence.length > 0
  ? claim.evidence.map((e, i) => `  [${i + 1}] (${e.source}) ${e.excerpt.slice(0, 100)}`).join("\n")
  : "  (none)"}

Recall any supporting or refuting fact you have about this.`;

    return { system, user };
  }

  // ── Research (one recall pass) ─────────────────────────────────

  async researchClaim(claimId: string, librarianCall: (prompt: { system: string; user: string }) => Promise<string>): Promise<Claim | null> {
    const claim = this._state.claims.get(claimId);
    if (!claim) return null;

    claim.research_rounds++;
    const { system, user } = this.buildResearchPrompt(claim);
    const rawResult = await librarianCall({ system, user });
    const parsed = this.parseResearchResponse(rawResult);

    // Everything recalled here is memory (no tools were used), so tag it
    // origin:"memory" — zero confidence weight. It survives as a hint for the
    // agent, not as proof.
    for (const entry of parsed) {
      addEvidence(this._state, claimId, { ...entry, origin: "memory" });
    }

    claim.last_verified = Date.now();
    claim.confidence = recalculateConfidence(claim);
    claim.status = resolveStatus(this._state, claim);
    return claim;
  }

  // Parses librarian output (format defined in buildResearchPrompt) into
  // EvidenceEntry[]. "NO_EVIDENCE:" or absent blocks yield []. Tolerates prose,
  // quoted fields, and the single-line degenerate form
  // "EVIDENCE: source: X url: Y excerpt: Z". authority is a placeholder —
  // addEvidence recomputes it (0 for memory).
  parseResearchResponse(raw: string): EvidenceEntry[] {
    const entries: EvidenceEntry[] = [];
    const lines = raw.split("\n");

    let current: { source?: EvidenceSource; url?: string; excerpt?: string } | null = null;

    const flush = () => {
      if (current && current.source && current.excerpt) {
        entries.push({
          source: current.source,
          url: current.url && current.url !== "none" ? current.url : undefined,
          excerpt: current.excerpt,
          authority: SOURCE_AUTHORITY[current.source] ?? 0.2,
          timestamp: Date.now(),
        });
      }
      current = null;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (/^NO_EVIDENCE:/i.test(trimmed)) {
        flush();
        continue;
      }

      if (/^EVIDENCE:/i.test(trimmed)) {
        flush();
        current = {};
        // Rest of the line may carry inline fields (degenerate single-line form).
        const rest = trimmed.replace(/^EVIDENCE:/i, "");
        if (rest) this.applyInlineFields(current, rest);
        continue;
      }

      if (current) {
        // Multi-line form: one field per line, anchored at line start so that
        // excerpt content containing "url:" / "source:" is not mis-parsed.
        if (/^source:/i.test(trimmed)) {
          const m = trimmed.match(/^source:\s*([A-Za-z_]+)/i);
          if (m) current.source = m[1].toLowerCase() as EvidenceSource;
        } else if (/^url:/i.test(trimmed)) {
          const m = trimmed.match(/^url:\s*(.+?)\s*$/i);
          if (m) {
            const u = m[1].replace(/^"|"$/g, "").trim();
            if (u && u !== "none") current.url = u;
          }
        } else if (/^excerpt:/i.test(trimmed)) {
          const m = trimmed.match(/^excerpt:\s*(.+?)\s*$/i);
          if (m) current.excerpt = this.stripQuotes(m[1]);
        }
      }
    }

    flush();
    return entries;
  }

  private applyInlineFields(
    entry: { source?: EvidenceSource; url?: string; excerpt?: string },
    text: string
  ): void {
    // Excerpt is last and may contain anything — split it off first, then read
    // source/url only from the head so excerpt content can't false-positive.
    const excerptIdx = text.search(/\bexcerpt:/i);
    let head = text;
    if (excerptIdx >= 0) {
      head = text.slice(0, excerptIdx);
      const excerptVal = text.slice(excerptIdx).replace(/^excerpt:\s*/i, "");
      entry.excerpt = this.stripQuotes(excerptVal);
    }
    const sourceMatch = head.match(/\bsource:\s*([A-Za-z_]+)/i);
    if (sourceMatch) entry.source = sourceMatch[1].toLowerCase() as EvidenceSource;
    const urlMatch = head.match(/\burl:\s*(\S+)/i);
    if (urlMatch) {
      const u = urlMatch[1].replace(/^"|"$/g, "").trim();
      if (u && u !== "none") entry.url = u;
    }
  }

  private stripQuotes(s: string): string {
    const t = s.trim();
    if (
      t.length >= 2 &&
      ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))
    ) {
      return t.slice(1, -1).trim();
    }
    return t;
  }

  // ── Full Research Loop ─────────────────────────────────────────
  // research → re-evaluate → (only if a pass made progress) research again.
  // Pure-memory claims resolve in a single pass (memory can't raise confidence);
  // claims with real evidence to build on can iterate up to maxRounds.
  async runFullLoop(librarianCall: (prompt: { system: string; user: string }) => Promise<string>): Promise<void> {
    const pending = getClaimsNeedingResearch(this._state);
    for (const claim of pending) {
      let c = claim;
      while (c.research_rounds < this.config.maxRounds && c.confidence < RESEARCH_BELOW) {
        const confBefore = c.confidence;
        c = (await this.researchClaim(c.id, librarianCall)) ?? c;
        if (c.confidence <= confBefore) break; // no progress — a further recall pass is identical
      }
    }
  }
}
