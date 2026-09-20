// smoke_dispatch.ts — DRY-RUN smoke test for research_dispatch (no real model).
//
// Spawns the REAL dispatcher with a FAKE `pi` (fake_pi.mjs) and asserts the whole
// contract: spawn → researcher writes artifact → artifact validated → compact
// summary format. Plus the fail path (no artifact) and validateArtifact edge
// cases. Run: bun run ulw-analysis/smoke_dispatch.ts
import { dispatchResearch, validateArtifact, artifactPathFor } from "../ultrawork/research_dispatch";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`); }
}

const here = new URL(".", import.meta.url).pathname.slice(1).replace(/\\/g, "/");
const fakePi = join(here, "fake_pi.mjs");

// ── 1. validateArtifact unit edges ────────────────────────────────
{
  const bad = validateArtifact("{nope", "claim_1");
  check("bad JSON → null", bad === null);
  const badStatus = validateArtifact(JSON.stringify({ claim_id: "c", status: "maybe", summary: "x" }), "claim_1");
  check("bad status → null", badStatus === null);
  const noSummary = validateArtifact(JSON.stringify({ claim_id: "c", status: "verified" }), "claim_1");
  check("missing summary → null", noSummary === null);
  const good = validateArtifact(
    JSON.stringify({ claim_id: "c1", status: "refuted", confidence: 1.7, sources: [{ url: "https://x.dev/docs", quote: "no such flag", label: "official_docs" }, { url: 42 }], summary: "refuted by docs" }),
    "claim_1"
  );
  check("valid artifact parsed", good !== null && good.status === "refuted", JSON.stringify(good));
  check("confidence clamped to 1", good?.confidence === 1);
  check("non-url source filtered", good?.sources.length === 1 && good?.sources[0].url === "https://x.dev/docs");
  check("claim_id fallback honored", good?.claim_id === "c1");
}

// ── 2. Happy path with fake pi ────────────────────────────────────
{
  const cwd = mkdtempSync(join(tmpdir(), "ulw-dispatch-"));
  const r = await dispatchResearch({
    piCmd: `node ${fakePi}`,
    provider: "test",
    modelId: "test/model",
    cwd,
    claimId: "claim_9",
    statement: "fake statement: the default is 42",
    hints: [],
    env: { FAKE_PI_MODE: "verify" },
  });
  check("happy: status verified", r.status === "verified", `status=${r.status} stderr=${r.stderrTail}`);
  check("happy: artifact at .pi/evidence/claim_9.json", r.artifactPath === artifactPathFor(cwd, "claim_9"), r.artifactPath);
  check("happy: artifact parsed", r.artifact?.summary.includes("42"), JSON.stringify(r.artifact));
  check("summary: STATUS=VERIFIED conf=0.95", r.summary.includes("STATUS=VERIFIED conf=0.95"), r.summary);
  check("summary: Q line present", r.summary.includes("Q: fake statement: the default is 42"), r.summary);
  check("summary: source line + label", r.summary.includes("[official_docs]") && r.summary.includes("https://example.com/docs"), r.summary);
  check("summary: quote included", r.summary.includes('"the default is 42"'), r.summary);
  console.log("\n--- compact summary the MAIN agent would see ---\n" + r.summary + "\n----------------------------------------------");
}

// ── 3. Fail path: researcher writes nothing ───────────────────────
{
  const cwd = mkdtempSync(join(tmpdir(), "ulw-dispatch-fail-"));
  const r = await dispatchResearch({
    piCmd: `node ${fakePi}`,
    provider: "test",
    modelId: "test/model",
    cwd,
    claimId: "claim_10",
    statement: "unverifiable claim",
    env: { FAKE_PI_MODE: "none" },
  });
  check("fail: status=fail", r.status === "fail", `status=${r.status}`);
  check("fail: summary tells agent not to code to memory", r.summary.includes("Do NOT code to memory"), r.summary);
  check("fail: stdout tail captured", r.stdoutTail.includes("nothing written"), r.stdoutTail);
}

// ── 4. Bad-JSON artifact → fail, not crash ────────────────────────
{
  const cwd = mkdtempSync(join(tmpdir(), "ulw-dispatch-badjson-"));
  const r = await dispatchResearch({
    piCmd: `node ${fakePi}`,
    provider: "test",
    modelId: "test/model",
    cwd,
    claimId: "claim_11",
    statement: "claim with corrupt artifact",
    env: { FAKE_PI_MODE: "badjson" },
  });
  check("badjson: status=fail (artifact invalid)", r.status === "fail", `status=${r.status}`);
  check("badjson: no crash, summary built", r.summary.length > 0);
}

console.log(`\nsmoke_dispatch: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
