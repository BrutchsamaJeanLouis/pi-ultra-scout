// fake_pi.mjs — stands in for `pi` in the dispatch dry-run (smoke_dispatch.ts).
// Parses the brief (everything after "--"), finds the ARTIFACT PATH line, writes
// a valid research artifact there, and prints the done marker.
// FAKE_PI_MODE: "verify" (default) | "none" (write nothing → fail path) | "badjson"
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const briefIdx = args.indexOf("--");
const brief = args.slice(briefIdx + 1).join(" ");
const mode = process.env.FAKE_PI_MODE ?? "verify";

// Machine-readable markers the dispatcher appends after "--" (newline-proof).
let artifactPath = null;
const ai = args.indexOf("--ulw-artifact");
if (ai >= 0 && args[ai + 1]) artifactPath = args[ai + 1];
if (!artifactPath) {
  const m = brief.match(/ARTIFACT PATH[^\n]*\n\s*(\S+)/);
  if (m) artifactPath = m[1];
}
console.log(`fake pi: mode=${mode} artifact=${artifactPath}`);

if (artifactPath && mode === "verify") {
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(
    artifactPath,
    JSON.stringify(
      {
        claim_id: "claim_9",
        statement: "fake statement: the default is 42",
        status: "verified",
        confidence: 0.95,
        sources: [{ url: "https://example.com/docs", quote: "the default is 42", label: "official_docs" }],
        summary: "The fake official docs say the default is 42.",
        timestamp: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log("fake pi: artifact written");
  console.log("RESEARCH_DONE verified");
} else if (artifactPath && mode === "badjson") {
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, "{not json");
  console.log("RESEARCH_DONE verified");
} else {
  console.log("fake pi: nothing written");
}
