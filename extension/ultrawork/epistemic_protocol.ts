// ── Epistemic Protocol ─────────────────────────────────────────────
// Enforces evidence-based claims at the architecture level, not just as a
// personality instruction in the system prompt.
//
//   "Evidence required" is a property of claims, not a personality trait.
//
// Only buildSystemPromptSection() is consumed today (injected on
// before_agent_start). The rest of this module is small, self-contained
// building blocks for the claim-classification / firewall vocabulary — they
// are pure utilities with no hidden state, and the (previously) stateful
// EpistemicProtocol engine that wrapped a second ResearchLoopEngine has been
// removed: it was a duplicate of research_loop with no callers.

import type { Claim } from "./evidence_state";
import {
  classifyThreshold,
  requiresResearch,
  requiresEvidence,
  detectUnknownSignals,
} from "./evidence_state";

// ── Claim Classification ───────────────────────────────────────────

export type ClaimLevel = 0 | 1 | 2 | 3 | 4;

export interface ClassifiedClaim {
  statement: string;
  level: ClaimLevel;
  requiresResearch: boolean;
  requiresEvidence: boolean;
  reason: string;
}

export function classifyClaim(text: string): ClassifiedClaim {
  const threshold = classifyThreshold(text);
  const level = threshold as ClaimLevel;

  let reason = "";
  if (threshold === 3) {
    reason = "Explicitly requested research or verification";
  } else if (threshold === 4) {
    reason = "High uncertainty indicators present";
  } else if (threshold === 2) {
    reason = "Potentially changing information (version, price, current state)";
  } else if (threshold === 1) {
    reason = "Stable knowledge claim";
  } else {
    reason = "Internal reasoning — no external evidence needed";
  }

  return {
    statement: text,
    level,
    requiresResearch: requiresResearch(threshold),
    requiresEvidence: requiresEvidence(threshold),
    reason,
  };
}

export function getLevelDescription(level: ClaimLevel): string {
  const descriptions: Record<ClaimLevel, string> = {
    0: "Internal reasoning — no research required",
    1: "Stable knowledge — usually no research required",
    2: "Potentially changing — research required",
    3: "Explicitly requested research — research absolutely required",
    4: "High uncertainty — research required",
  };
  return descriptions[level];
}

// ── Epistemic Firewall (prompt building blocks) ────────────────────
// The firewall idea: the final generation should get the question + VERIFIED
// EVIDENCE + RESEARCH CONSTRAINTS, not just the question fed to raw weights.
// These helpers render that structure; wiring them into a separate answering
// pass is the intended next step (currently the prompt section below carries
// the same policy inline).

export function buildEpistemicFirewall(
  question: string,
  verifiedEvidence: string,
  researchConstraints: string
): string {
  return [
    `USER QUESTION`,
    `─────────────`,
    question,
    ``,
    `VERIFIED EVIDENCE`,
    `─────────────────`,
    verifiedEvidence,
    ``,
    `RESEARCH CONSTRAINTS`,
    `────────────────────`,
    researchConstraints,
  ].join("\n\n");
}

export function buildResearchConstraints(
  claim: Claim,
  signals: ReturnType<typeof detectUnknownSignals>
): string {
  const lines = [
    `Claim: ${claim.statement}`,
    `Current confidence: ${claim.confidence.toFixed(2)}`,
    `Evidence sources: ${claim.evidence.length}`,
    `Research rounds: ${claim.research_rounds}`,
  ];

  if (signals.length > 0) {
    lines.push(``);
    lines.push(`DETECTED SIGNALS:`);
    for (const s of signals) {
      lines.push(`  - [${s.severity.toUpperCase()}] ${s.type}: ${s.details}`);
    }
  }

  if (claim.missing_info && claim.missing_info.length > 0) {
    lines.push(``);
    lines.push(`MISSING INFORMATION:`);
    for (const info of claim.missing_info) {
      lines.push(`  - ${info}`);
    }
  }

  return lines.join("\n");
}

// ── System Prompt Section ──────────────────────────────────────────
// The one piece actually consumed by ultrawork.ts.

export class EpistemicProtocol {
  static buildSystemPromptSection(): string {
    return [
      `## EPISTEMIC PROTOCOL`,
      ``,
      `Your internal model knowledge is NOT considered authoritative.`,
      ``,
      `For claims involving:`,
      `- current information`,
      `- software versions`,
      `- APIs`,
      `- documentation`,
      `- specifications`,
      `- prices`,
      `- people or organizations`,
      `- recent events`,
      `- anything the user explicitly asks you to research`,
      ``,
      `you MUST obtain external evidence before answering.`,
      ``,
      `Prefer primary sources:`,
      `1. official documentation`,
      `2. official websites`,
      `3. source repositories`,
      `4. standards/specifications`,
      `5. reputable secondary sources`,
      ``,
      `Verification method (required, not optional):`,
      `- Use your browser tools (playwright) to open the source and read it live.`,
      `- Prioritize online primary sources: official docs, API references, research papers.`,
      `- A claim is verified only after you have opened the page and read the relevant part.`,
      `- Cite the URL you actually opened. Recall of a URL or its content is not verification.`,
      `- If a page cannot be opened, say so and keep the claim unverified.`,
      ``,
      `Your internal knowledge may be used to:`,
      `- formulate hypotheses`,
      `- understand terminology`,
      `- decide what to search for`,
      `- reason about retrieved evidence`,
      ``,
      `It may NOT be used as evidence when external verification is required.`,
      ``,
      `If evidence is insufficient, continue researching.`,
      ``,
      `If you cannot obtain sufficient evidence after reasonable research,`,
      `explicitly state that the information could not be verified.`,
    ].join("\n");
  }
}
