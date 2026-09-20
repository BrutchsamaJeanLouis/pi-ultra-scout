// score_claim_audit.ts — one-command measurer for the claim-audit change.
//
// Reads ultrawork.log and, for every "NUDGE delivered" line, asks the
// success question from analysis §9.8:
//   "Does the nudge reference something the agent ACTUALLY SAID this window,
//    not just what it touched?"
//
// Method (trace-based, no model): for each nudge, collect the [CLAIM]
// assertion texts logged in the same gate window (since the previous nudge),
// and report the distinctive tokens the nudge reuses from those claims
// (flags, identifiers, versions, numerics). Also flags the two 27B risks:
//   - EMPTY-NUDGE: bullet list is just "nothing to reground" or trivially short
//     (the token-budget signature — content eaten by reasoning).
//   - URL: any URL in the nudge, so the operator can eyeball librarian-hallucinated links.
//
// The pre-change era (digest-only librarian) is scored too, so the baseline
// (README-boilerplate nudges, ~0 claim-token reuse) sits next to the change.
//
// Run: bun run ulw-analysis/score_claim_audit.ts [logfile]

import { readFileSync } from "fs";
import { join } from "path";

const logPath = process.argv[2] ?? join(import.meta.dir, "..", "ultrawork.log");
const lines = readFileSync(logPath, "utf8").split("\n");

// ── parse ────────────────────────────────────────────────────────────
type Claim = { ts: string; text: string };
type Nudge = { ts: string; bullets: string; url?: string };
const claims: Claim[] = [];
const nudges: Nudge[] = [];

for (const ln of lines) {
  let m = ln.match(/^\[([\d\-T:Z.]+)\] \[CLAIM\] captured assertion \((\d+)ch, buf=(\d+)\): (.*)$/);
  if (m) { claims.push({ ts: m[1], text: m[4] }); continue; }
  m = ln.match(/^\[([\d\-T:Z.]+)\] \[LIB\] NUDGE delivered as steer \(\d+ms\): (.*)$/);
  if (m) {
    const url = m[2].match(/https?:\/\/[^\s)"]+/)?.[0];
    nudges.push({ ts: m[1], bullets: m[2], url });
  }
}

// ── tokenise (distinctive tokens only) ───────────────────────────────
const STOP = new Set([
  "the","and","for","with","that","this","from","into","open","opened","verify","docs","doc",
  "readme","todo","stale","never","critical","context","playwright","agent","task","using",
  "file","path","check","actual","behavior","instead","trusting","claim","claims","live",
  "section","form","button","click","clicking","upload","drag","dropping","dropzone",
]);
function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of s.toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}|--?[a-z][a-z0-9-]+/gi) ?? []) {
    if (STOP.has(t)) continue;
    // keep: flags (start with --), identifiers (has camelCase-ish or dots/underscores/=/.),
    //       version/numeric tokens, and anything long enough to be distinctive.
    if (t.startsWith("--") || /\d/.test(t) || /[a-z0-9]_[a-z0-9]/.test(t) || /[a-z]\.[a-z]/.test(t) || t.length >= 6) out.add(t);
  }
  return out;
}

// ── score each nudge against claims in its window ────────────────────
console.log(`log: ${logPath}`);
console.log(`claims logged: ${claims.length}   nudges logged: ${nudges.length}\n`);
console.log("Per-nudge claim-reference score (distinctive tokens the nudge reuses from a claim in the same window):");
console.log("─".repeat(100));

let claimReferenced = 0, emptyNudges = 0, urls = 0;
for (let i = 0; i < nudges.length; i++) {
  const n = nudges[i];
  const prevNudgeTs = i > 0 ? nudges[i - 1].ts : "0000";
  const windowClaims = claims.filter((c) => c.ts > prevNudgeTs && c.ts <= n.ts);
  const claimTokens = new Set<string>();
  windowClaims.forEach((c) => tokens(c.text).forEach((t) => claimTokens.add(t)));
  const nudgeTokens = tokens(n.bullets);
  const reuse = [...nudgeTokens].filter((t) => claimTokens.has(t));

  const isTrivial = /nothing to reground/i.test(n.bullets) && n.bullets.replace(/nothing to reground/i, "").trim().length < 20;
  if (isTrivial) emptyNudges++;
  if (n.url) urls++;
  if (reuse.length > 0) claimReferenced++;

  const era = windowClaims.length > 0 ? "CLAIMS-ERA" : "digest-only (pre-change)";
  console.log(`[${n.ts}] ${era}`);
  console.log(`  window-claims: ${windowClaims.length}   token-reuse: [${reuse.slice(0, 8).join(", ") || "—"}]${reuse.length > 8 ? " …" : ""}`);
  if (n.url) console.log(`  url: ${n.url}   ${isTrivial ? "  [EMPTY-NUDGE]" : ""}`);
}

console.log("\n" + "─".repeat(100));
console.log(`SUMMARY`);
console.log(`  nudges referencing a same-window claim : ${claimReferenced} / ${nudges.length}`);
console.log(`  empty/trivial nudges (token-budget sig): ${emptyNudges} / ${nudges.length}`);
console.log(`  nudges carrying a URL (eyeball for hallucination): ${urls}`);
console.log(`\nRead: pre-change nudges should show ~0 token-reuse (README-boilerplate baseline);`);
console.log(`claim-era nudges should show reuse of the agent's OWN flags/versions/numbers.`);
