// Regression probe for the 09-18 "ledger under-credit" fix.
// Root cause: classifySource() matched .includes("github.com") — and
// "raw.githubusercontent.com" does NOT contain that substring (it contains
// "githubusercontent.com"), so researcher artifacts citing raw README URLs got
// B4-reconciled down to webpage/0.2 → conf 0.20 → pending_research, while the
// researcher had verified 0.95. Same for npmjs.com (SPA; renders the package's
// own README — verified live in browser 09-18).
//
// bun run probe_evidence.ts
import { classifySource, addClaim, addEvidence, createEvidenceState, SOURCE_AUTHORITY } from "../ultrawork/evidence_state.ts";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  const ok = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`  [${ok}] ${name}${detail ? " — " + detail : ""}`);
}

console.log("classifySource — domain coverage");
const cases: Array<[string, string]> = [
  ["https://raw.githubusercontent.com/sindresorhus/p-retry/main/readme.md", "official_repo"],
  ["https://github.com/sindresorhus/p-retry", "official_repo"],
  ["https://www.npmjs.com/package/p-retry", "official_docs"],
  ["https://pypi.org/project/requests/", "official_docs"],
  // regressions must NOT change:
  ["https://en.wikipedia.org/wiki/Retry", "webpage"],
  ["https://stackoverflow.com/questions/1", "community"],
  ["https://example.com/docs.something", "official_docs"], // "docs." prefix rule
];
for (const [url, want] of cases) {
  const got = classifySource(url);
  check(`${url} → ${want}`, got === want, `got ${got}`);
}

console.log("\nfull ledger chain — the exact shape of the 09-18 runs");
const state = createEvidenceState(3, 0.7);
// Run 2 shape: researcher artifact cites the raw README, labels it official_repo.
const c = addClaim(state, "p-retry option names and default retry count (sindresorhus/p-retry)");
const claim = addEvidence(state, c.id, {
  source: "official_repo",
  url: "https://raw.githubusercontent.com/sindresorhus/p-retry/main/readme.md",
  excerpt: "retries Default: 10; minTimeout Default: 1000; factor Default: 2",
  timestamp: Date.now(),
})!;
check("conf = 0.95 (was 0.20 before fix)", Math.abs(claim.confidence - 0.95) < 0.001, `got ${claim.confidence}`);
check("status = verified (was pending_research)", claim.status === "verified", `got ${claim.status}`);
check("authority stored = official_repo 0.95", claim.evidence[0].authority === SOURCE_AUTHORITY.official_repo, `got ${claim.evidence[0].authority}`);
check("reportedSource not clobbered (label matched URL)", claim.evidence[0].reportedSource === undefined, `got ${claim.evidence[0].reportedSource}`);

// Run 1 shape: npmjs URL labeled official_repo by the researcher.
const state2 = createEvidenceState(3, 0.7);
const c2 = addClaim(state2, "p-retry defaults (run 1 shape)");
const claim2 = addEvidence(state2, c2.id, {
  source: "official_repo",
  url: "https://www.npmjs.com/package/p-retry",
  excerpt: "factor Default: 2",
  timestamp: Date.now(),
})!;
check("npmjs evidence credited (conf 0.95, lesser of label 0.95 / classified docs 1.0)", Math.abs(claim2.confidence - 0.95) < 0.001, `got ${claim2.confidence} status=${claim2.status}`);
check("status = verified", claim2.status === "verified", `got ${claim2.status}`);

// memory-zero rule must SURVIVE the classifier changes:
const state3 = createEvidenceState(3, 0.7);
const c3 = addClaim(state3, "memory claim");
addEvidence(state3, c3.id, { source: "official_docs", url: "https://github.com/x/y", excerpt: "recalled", origin: "memory", timestamp: Date.now() });
check("memory evidence still carries zero weight", state3.claims.get(c3.id)!.confidence === 0, `got ${state3.claims.get(c3.id)!.confidence}`);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
