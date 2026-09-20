// claim_shapes.ts — deterministic risky-shape detection for the ultrawork librarian.
//
// Pure module (no pi imports, no side effects): the extension, the probe, and any
// future auditor share this exact detector.
//
// WHY THIS EXISTS (epistemic calibration problem, see deep-analysis §9 + session
// 2026-09-18): a model cannot reliably introspect "do I actually know this?" —
// self-reported confidence is uncalibrated. But it CAN be audited structurally:
// certain claim SHAPES are untrustworthy-from-weights by construction, regardless
// of how fluent the claim reads:
//   (a) exact identifiers — flags (--x), dotted API paths (a.b.c()), backticked code
//   (b) temporal/version drift — versions, "currently/latest/by default"
//   (c) numeric defaults — "default is N", "limit of N ms"
//   (d) universal negatives — "X does not support Y", "there is no way to Z"
//   (e) niche/long-tail entities — third-party names we can't know are stable
// Policy: a claim matching a shape is P(needs external grounding) = 1.0 UNTIL a
// source is opened. The detector is deliberately simple and regex-based: it is a
// TRIGGER, not a verifier. False positives cost one cheap research dispatch;
// false negatives are the expensive direction (silent parametric hallucination).

export type ShapeKind =
  | "exact_identifier"
  | "version_drift"
  | "temporal_claim"
  | "numeric_default"
  | "universal_negative";

export interface ShapeHit {
  kind: ShapeKind;
  /** The offending token/phrase (short). */
  token: string;
  /** ~120-char window around the hit, for the auditor prompt. */
  snippet: string;
}

export const MAX_HITS = 8;

// ── Patterns ───────────────────────────────────────────────────────
// Order matters only for dedupe (first-match wins per token).

const RE_FLAG = /--?[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g; // --kebab-case or -x flags (len>2, kebab required to skip -n etc.)
const RE_DOTTED_API = /\b[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_$]*)+\s*\(/g; // pkg.mod.func( — 2+ dots
const RE_BACKTICK = /`[^`\n]{2,60}`/g;
const RE_VERSION = /\b(?:v|version|release)\s?\d+(?:\.\d+){1,3}\b|\b\d+\.\d+\.\d+\b|\b[A-Za-z][A-Za-z0-9_-]*\s+\d+\.\d+(?:\.\d+)?\b/gi; // v1.2 / version 3.4 / bare x.y.z / "Bun 1.3.10"
const RE_TEMPORAL = /\b(?:currently|latest|newest|up to date|as of \d{4}|as of now|since (?:v\d|the release)|recently added|just released|now supports|deprecat\w*)\b/gi;
const RE_NUMERIC_DEFAULT = /\b(?:default(?:ly)?|limit|cap|maximum|maximum|threshold|timeout|retries?|batch size)\b[^0-9\n]{0,40}(\d[\d.,_]*\s?(?:ms|kb|mb|gb|tokens?|secon?ds?|requests?|items?)?)|\b(\d[\d.,_]*\s?(?:ms|kb|mb|gb|tokens?|secon?ds?|requests?|items?))\b/gi;
const RE_NEGATIVE = /\b(?:does not|do not|doesn't|don't|no such|not supported|unsupported|no way|cannot be|impossible|only way|no longer|has been removed|replaced by)\b/gi;

// Words that make a version/temporal hit a REAL signal rather than prose noise.
// A bare "1.2.3" is version-shaped; a flag like --kv-cache is identifier-shaped.
// We keep all of them — the auditor (LLM librarian) sees shape+snippet and the
// dispatch decision still needs the claim to matter (stake), so cheap precision
// here is enough.

function windowAround(text: string, idx: number, len: number, radius = 120): string {
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + len + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function pushUnique(hits: ShapeHit[], kind: ShapeKind, token: string, snippet: string): void {
  const key = `${kind}:${token.toLowerCase()}`;
  if (hits.some((h) => `${h.kind}:${h.token.toLowerCase()}` === key)) return;
  if (hits.length >= MAX_HITS) return;
  hits.push({ kind, token: token.slice(0, 80), snippet });
}

/**
 * Scan a chunk of the agent's generated text for risky claim shapes.
 * Returns up to MAX_HITS hits, deduped by (kind, token).
 */
export function detectRiskyShapes(text: string): ShapeHit[] {
  const out: ShapeHit[] = [];
  const t = text ?? "";
  if (!t.trim()) return out;

  const scan = (re: RegExp, kind: ShapeKind, tokenAt?: (m: RegExpExecArray) => string) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) {
      const token = tokenAt ? tokenAt(m) : m[0];
      if (!token || token.length < 2) continue;
      pushUnique(out, kind, token, windowAround(t, m.index, m[0].length));
    }
    if (re.lastIndex === 0 && m === null) re.lastIndex = 0; // guard zero-width
  };

  scan(RE_FLAG, "exact_identifier");
  scan(RE_DOTTED_API, "exact_identifier", (m) => m[0].replace(/\s*\($/, ""));
  scan(RE_BACKTICK, "exact_identifier");
  scan(RE_VERSION, "version_drift");
  scan(RE_TEMPORAL, "temporal_claim");
  scan(RE_NUMERIC_DEFAULT, "numeric_default", (m) => m[0]);
  scan(RE_NEGATIVE, "universal_negative");

  return out;
}

/**
 * Compact renderer for the librarian audit prompt (and the nudge):
 * one line per hit, shape + token + snippet.
 */
export function renderShapeHits(hits: ShapeHit[]): string {
  if (hits.length === 0) return "";
  return hits
    .map((h) => `- [${h.kind}] "${h.token}" — …${h.snippet}…`)
    .join("\n");
}

/**
 * The TRUST SHAPES section injected into the MAIN AGENT's system prompt.
 * This is the nudge-prompt answer to "how does it know its own weights can't be
 * trusted?": introspection is not the mechanism — SHAPE IS THE TRIGGER.
 */
export const TRUST_SHAPES_SECTION = `## TRUST SHAPES — when your own weights may be wrong
Your parametric memory is a lossy compression. You cannot audit it by asking
"how confident am I?" (self-confidence is uncalibrated). Instead use SHAPES:
if any claim you are about to rely on has one of these shapes, treat it as
UNVERIFIED until external evidence is in — no matter how fluent it reads:
  (a) exact identifier — a flag, option, parameter, method or error string you
      will type into code (e.g. \`--cache-type q8_0\`, \`os.fs.rm({recursive})\`)
  (b) version / temporal drift — a version number, "currently", "latest",
      "by default", deprecation state
  (c) numeric default — "the default is N", "limit of N ms/MB/retries"
  (d) universal negative — "X does not support Y", "there is no way to Z"
  (e) niche / long-tail entity — a third-party package, plugin or recent release
      you have only thin memory of
When you catch a shape in your own plan or prose:
  1. Call evidence_register(statement) — register the claim.
  2. Call research_dispatch(statement) — a librarian sub-agent opens the live
     source (official docs / repo / spec) and returns clean evidence. It blocks
     until the evidence artifact exists; you get ONLY the compact result, not
     the browsing trace.
  3. Only then write code on top of the claim. If dispatch returns refuted or
     inconclusive, code to the EVIDENCE, not to your memory.
The shape is the trigger. Never argue a shape away because the fact "feels
obvious" — obviousness is exactly what weight-hallucinations read as.`;
