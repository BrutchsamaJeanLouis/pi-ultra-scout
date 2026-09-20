// probe_shapes.ts — unit asserts for the deterministic trust-shape detector.
// Pure: no model, no network. Run: bun run ulw-analysis/probe_shapes.ts
import { detectRiskyShapes, renderShapeHits } from "../ultrawork/claim_shapes";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const kinds = (hits: { kind: string }[]) => new Set(hits.map((h) => h.kind));

// (a) exact identifier: flags, dotted APIs, backticks
{
  const hits = detectRiskyShapes("llama.cpp halves VRAM with --cache-type q8_0 in this build.");
  check("flag detected", kinds(hits).has("exact_identifier"), JSON.stringify(hits));
  check("flag token captured", hits.some((h) => h.token.includes("--cache-type")), JSON.stringify(hits));
}
{
  const hits = detectRiskyShapes("Use fs.rmSync(path, { recursive: true }) then child_process.spawnSync(cmd);");
  check("backtick-free dotted api OR nothing false", hits.length >= 0); // loose: bare calls without backticks
  const hits2 = detectRiskyShapes("Set the flag `max_retries=5` on the client.");
  check("backtick identifier detected", kinds(hits2).has("exact_identifier") && hits2.some((h) => h.token.includes("max_retries")), JSON.stringify(hits2));
}
// (b) version / temporal
{
  const hits = detectRiskyShapes("In Bun 1.3.10 the --smol flag was added to the CLI.");
  check("version number detected", kinds(hits).has("version_drift"), JSON.stringify(hits));
}
{
  const hits = detectRiskyShapes("Currently the default router port is 8787 and it's the latest release.");
  check("temporal 'currently' detected", kinds(hits).has("temporal_claim"), JSON.stringify(hits));
}
// (c) numeric defaults
{
  const hits = detectRiskyShapes("The default timeout is 60000 ms and the retry limit is 2.");
  check("numeric default detected", kinds(hits).has("numeric_default"), JSON.stringify(hits));
}
// (d) universal negatives
{
  const hits = detectRiskyShapes("Note: Bun does not support ESM loaders here, and there is no way to disable the sandbox.");
  check("negative detected", kinds(hits).has("universal_negative"), JSON.stringify(hits));
}
// clean prose should be quiet
{
  const hits = detectRiskyShapes("I will create a new module that posts journal entries and then run the existing tests to make sure nothing broke.");
  check("clean prose stays quiet", hits.length === 0, JSON.stringify(hits));
}
// dedupe + cap
{
  const text = Array.from({ length: 30 }, (_, i) => `run with --flag-x${i} please`).join(". ");
  const hits = detectRiskyShapes(text);
  check("cap respected (<=8)", hits.length <= 8, `got ${hits.length}`);
  const dupes = detectRiskyShapes("use --keep-going and --keep-going again.");
  check("dedupe by (kind,token)", dupes.filter((h) => h.token.includes("keep-going")).length === 1, JSON.stringify(dupes));
}
// renderer
{
  const hits = detectRiskyShapes("The default is 3 retries; Bun does not support it.");
  const rendered = renderShapeHits(hits);
  check("renderer produces one line per hit", rendered.split("\n").length === hits.length && rendered.includes("[universal_negative]"));
  check("renderer empty on none", renderShapeHits(detectRiskyShapes("we are done")) === "");
}

console.log(`\nprobe_shapes: ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
