// ── Evidence State Management ──────────────────────────────────────
// Core data structures for tracking claims, evidence, and confidence.
// Implements the evidence state pattern from the ultrawork roadmap:
//   CLAIM → statement, confidence, evidence[], source_urls[], source_type, last_verified, status

export type EvidenceSource = "official_docs" | "official_repo" | "specification" | "reputable_source" | "community" | "webpage" | "model_memory";

export type ClaimStatus = "unverified" | "verified" | "conflicted" | "refuted" | "pending_research";

export type SourceAuthority = {
  type: EvidenceSource;
  weight: number; // 0.0 to 1.0
};

export const SOURCE_AUTHORITY: Record<EvidenceSource, number> = {
  official_docs: 1.0,
  official_repo: 0.95,
  specification: 0.95,
  reputable_source: 0.75,
  community: 0.45,
  webpage: 0.2,
  model_memory: 0.0,
};

export interface EvidenceEntry {
  source: EvidenceSource;
  url?: string;
  excerpt: string;
  authority: number;
  timestamp: number;
  /** Where this evidence came from. "memory" = recalled by the local model with
   *  no tools → carries ZERO confidence weight (a nudge, not proof).
   *  "external" (default) = the agent opened a real source. */
  origin?: "external" | "memory";
  /** Self-reported source label, kept for display when addEvidence's URL
   *  reconciliation downgraded it (reported something the URL doesn't back). */
  reportedSource?: EvidenceSource;
}

export interface Claim {
  id: string;
  statement: string;
  confidence: number; // 0.0 to 1.0
  evidence: EvidenceEntry[];
  source_urls: string[];
  last_verified: number;
  status: ClaimStatus;
  research_rounds: number;
  maxResearchRounds: number;
  missing_info?: string[];
}

export interface EvidenceState {
  claims: Map<string, Claim>;
  nextId: number;
  maxResearchRounds: number;
  /** Load-bearing answer gate: a claim only becomes "verified" (and is
   *  answerable) once it reaches this confidence WITH strong/corroborated
   *  evidence. This is what the config's minConfidenceForAnswer actually drives. */
  minConfidenceForAnswer: number;
}

// Confidence floor below which a claim is always queued for (re)research
// regardless of status. Deliberately distinct from minConfidenceForAnswer:
// this one means "keep trying", the other means "good enough to answer".
export const RESEARCH_BELOW = 0.5;

// ── Factory ────────────────────────────────────────────────────────

export function createEvidenceState(maxResearchRounds: number = 3, minConfidenceForAnswer: number = 0.7): EvidenceState {
  return {
    claims: new Map(),
    nextId: 1,
    maxResearchRounds,
    minConfidenceForAnswer,
  };
}

// ── Claim Operations ───────────────────────────────────────────────

export function addClaim(state: EvidenceState, statement: string, options?: {
  confidence?: number;
  status?: ClaimStatus;
  evidence?: EvidenceEntry[];
  source_urls?: string[];
  missing_info?: string[];
  threshold?: ResearchThreshold;
}): Claim {
  const id = `claim_${state.nextId++}`;
  const threshold = options?.threshold ?? classifyThreshold(statement);
  let status: ClaimStatus | undefined = options?.status;
  if (status === undefined) {
    if (threshold >= 2) status = "pending_research";
    else status = "unverified";
  }
  const claim: Claim = {
    id,
    statement,
    confidence: options?.confidence ?? 0.0,
    evidence: options?.evidence ?? [],
    source_urls: options?.source_urls ?? [],
    last_verified: Date.now(),
    status,
    research_rounds: 0,
    maxResearchRounds: state.maxResearchRounds,
    missing_info: options?.missing_info,
  };
  state.claims.set(id, claim);
  return claim;
}

export function addEvidence(state: EvidenceState, claimId: string, evidence: Omit<EvidenceEntry, "authority">): Claim | null {
  const claim = state.claims.get(claimId);
  if (!claim) return null;

  const isMemory = evidence.origin === "memory";
  let source: EvidenceSource = evidence.source;
  let reportedSource: EvidenceSource | undefined;

  // B4: when a URL is present, the effective source is the LESSER of the
  // self-reported label and what the URL domain actually indicates. A
  // reddit.com URL can no longer masquerade as official_docs (authority 1.0),
  // which is what made the self-assigned label the load-bearing (and circular)
  // signal. Memory evidence is never reconciled from its (recalled) URL — a
  // remembered pointer is not proof of what the page says.
  if (!isMemory && evidence.url) {
    const classified = classifySource(evidence.url);
    if (SOURCE_AUTHORITY[classified] < SOURCE_AUTHORITY[evidence.source]) {
      source = classified;
      reportedSource = evidence.source;
    }
  }

  const authority = isMemory ? 0.0 : (SOURCE_AUTHORITY[source] ?? 0.2);
  claim.evidence.push({ ...evidence, source, reportedSource, authority });
  if (evidence.url && !claim.source_urls.includes(evidence.url)) {
    claim.source_urls.push(evidence.url);
  }
  claim.last_verified = Date.now();
  // Recalculate confidence and status via the single shared implementation.
  claim.confidence = recalculateConfidence(claim);
  claim.status = resolveStatus(state, claim);
  return claim;
}

export function getClaimsNeedingResearch(state: EvidenceState): Claim[] {
  return Array.from(state.claims.values()).filter(
    (c) => c.research_rounds < state.maxResearchRounds && c.confidence < RESEARCH_BELOW
  );
}

// ── Confidence & Status Logic ──────────────────────────────────────

// Single shared confidence implementation. research_loop no longer keeps its
// own copy, so evidence_add and research can't diverge on the same claim (B2).
// Squares authority for a stronger high-authority signal, and guards the
// all-zero case (memory-only evidence) so it returns 0 instead of NaN.
export function recalculateConfidence(claim: Claim): number {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const e of claim.evidence) {
    totalWeight += e.authority;
    weightedSum += e.authority * e.authority;
  }
  if (totalWeight === 0) return 0.0;
  return Math.min(1.0, weightedSum / totalWeight);
}

// Sources that count as "strong" on their own for verification.
const STRONG_SOURCES: ReadonlySet<EvidenceSource> = new Set([
  "official_docs", "official_repo", "specification",
]);

// B3: conflict is OPPOSING CONTENT, not source-type diversity. Three different
// source types usually corroborate; a real conflict is one source affirming
// while another denies. Heuristic on excerpt text (good enough for a nudge).
const NEG_RE = /\b(does not|do not|doesn't|don't|no such|not supported|not available|not present|not included|removed|deprecated|no longer|replaced|contradicts|in contrast)\b/i;
const AFF_RE = /\b(supports?|available|present|included|shipped|provided|confirmed|official)\b/i;

function hasOpposingEvidence(entries: EvidenceEntry[]): boolean {
  const negSrc = new Set(entries.filter((e) => NEG_RE.test(e.excerpt)).map((e) => e.source));
  const affSrc = new Set(entries.filter((e) => AFF_RE.test(e.excerpt)).map((e) => e.source));
  if (negSrc.size === 0 || affSrc.size === 0) return false;
  // A genuine conflict needs at least two distinct source types involved.
  return new Set([...negSrc, ...affSrc]).size > 1;
}

// Single shared status resolver. Memory evidence never counts toward
// "strong"/"corroborated" — a claim can only be verified by evidence the agent
// actually opened. The "verified" gate uses the state's
// minConfidenceForAnswer (B1: the config knob is now load-bearing).
export function resolveStatus(state: EvidenceState, claim: Claim): ClaimStatus {
  if (claim.evidence.length === 0) return "unverified";
  const conf = claim.confidence;
  const ext = claim.evidence.filter((e) => e.origin !== "memory");
  const hasStrong = ext.some((e) => STRONG_SOURCES.has(e.source));
  const corroborated = new Set(ext.map((e) => e.source)).size >= 2;

  // A detected CONTENT conflict is a conflict regardless of aggregate
  // confidence. The authority-weighted conf is precisely what would mask a
  // live dispute (official docs say "yes", another source says "no"), so a
  // high conf here is a reason to go resolve which authority is right, not to
  // declare it settled. (Opposing detection already requires two distinct
  // source types, which is the precision bar.)
  if (hasOpposingEvidence(claim.evidence)) return "conflicted";
  if (conf < 0.3) return "pending_research";
  if ((hasStrong || corroborated) && conf >= state.minConfidenceForAnswer) return "verified";
  return "unverified";
}

// ── Source Classification ──────────────────────────────────────────

export function classifySource(url: string): EvidenceSource {
  if (!url) return "webpage";
  const lower = url.toLowerCase();
  if (lower.includes("docs.") || lower.includes("documentation") || lower.includes("readthedocs")) return "official_docs";
  if (lower.includes("github.com") || lower.includes("gitlab.com")) return "official_repo";
  // raw.githubusercontent.com is GitHub's raw-file CDN for the SAME repos
  // (it does NOT contain the substring "github.com" — the 09-18 web-nudge
  // runs showed researcher artifacts citing it getting demoted to webpage/0.2).
  if (lower.includes("githubusercontent.com") || lower.includes("gitlab.io")) return "official_repo";
  // Official package-registry pages render the project's own README +
  // maintainers: the canonical doc surface for that package.
  if (lower.includes("npmjs.com") || lower.includes("pypi.org")) return "official_docs";
  if (lower.includes("rfc") || lower.includes("ietf") || lower.includes("ecma-international")) return "specification";
  if (lower.includes("stackoverflow") || lower.includes("reddit") || lower.includes("hacker")) return "community";
  if (lower.includes("medium") || lower.includes("dev.to") || lower.includes("blog")) return "reputable_source";
  return "webpage";
}

// ── Research Threshold Classification ──────────────────────────────
// Maps to the roadmap's 5-level threshold system

export type ResearchThreshold = 0 | 1 | 2 | 3 | 4;

export function classifyThreshold(text: string): ResearchThreshold {
  const lower = text.toLowerCase();

  // Level 3: Explicitly requested research
  if (/check|verify|research|look up|find out|search for|tell me about|documentation|specification|supports/.test(lower)) {
    return 3;
  }

  // Level 4: High uncertainty indicators
  if (/probably|might|maybe|i think|i believe|possibly|perhaps|guess|assume/.test(lower)) {
    return 4;
  }

  // Level 2: Potentially changing information
  if (/\bcurrent\b|version|latest|recent|now|today|currently|newest|up to date|price|pricing/.test(lower)) {
    return 2;
  }

  // Level 1: Stable knowledge (common facts)
  if (/\bis\b|\bare\b|\bdoes\b|\bdo\b|\bhas\b|\bhave\b|\bwas\b|\bwere\b|python is|javascript is|typescript is|react is|node is/.test(lower)) {
    return 1;
  }

  // Level 0: Internal reasoning
  return 0;
}

export function requiresResearch(threshold: ResearchThreshold): boolean {
  return threshold >= 2;
}

export function requiresEvidence(threshold: ResearchThreshold): boolean {
  return threshold >= 3;
}

// ── "I Don't Know" Detection ───────────────────────────────────────
// Combines multiple signals from the roadmap

export interface UnknownSignal {
  type: "explicit_uncertainty" | "evidence_gap" | "contradiction" | "low_confidence";
  severity: "low" | "medium" | "high";
  details: string;
}

export function detectUnknownSignals(claim: Claim): UnknownSignal[] {
  const signals: UnknownSignal[] = [];

  // Signal 1: Explicit uncertainty
  const uncertaintyPatterns = [
    /i don't know/i, /i'm not sure/i, /uncertain/i, /unsure/i,
    /cannot verify/i, /could not confirm/i, /no evidence/i,
  ];
  for (const pattern of uncertaintyPatterns) {
    if (pattern.test(claim.statement)) {
      signals.push({
        type: "explicit_uncertainty",
        severity: "high",
        details: `Statement contains explicit uncertainty marker: "${pattern.source}"`,
      });
      break;
    }
  }

  // Signal 2: Evidence gap
  if (claim.evidence.length === 0 && claim.confidence < 0.5) {
    signals.push({
      type: "evidence_gap",
      severity: "high",
      details: `No evidence for claim (confidence: ${claim.confidence.toFixed(2)})`,
    });
  }

  // Signal 3: Contradiction
  if (claim.status === "conflicted") {
    signals.push({
      type: "contradiction",
      severity: "medium",
      details: `Conflicting evidence sources for claim`,
    });
  }

  // Signal 4: Low confidence
  if (claim.confidence < 0.3 && claim.research_rounds >= 2) {
    signals.push({
      type: "low_confidence",
      severity: "high",
      details: `Low confidence (${claim.confidence.toFixed(2)}) after ${claim.research_rounds} research rounds`,
    });
  }

  return signals;
}

export function shouldResearchAgain(claim: Claim): boolean {
  const signals = detectUnknownSignals(claim);
  const highSeverity = signals.filter((s) => s.severity === "high").length;
  return highSeverity > 0 && claim.research_rounds < claim.maxResearchRounds;
}

export function canAnswer(claim: Claim, minConfidenceForAnswer: number = 0.7): boolean {
  return claim.status === "verified" && claim.confidence >= minConfidenceForAnswer;
}
