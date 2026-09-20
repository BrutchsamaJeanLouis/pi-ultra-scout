// probe_claims.ts — perturbation probe for the claim-shape librarian change.
//
// Design (null model + perturbation, per the analysis brief):
//   A. CONTROL   — librarian prompt with NO claims section (old behaviour).
//   B. TREATMENT — same prompt + the agent's recent claims (new behaviour).
//   PASS iff B's bullets reference claim-specific content that A's don't,
//   i.e. the claims section is actually driving the output (not the model
//   hallucinating "verify things" either way).
//
// Also unit-tests extractAssistantText() against the real message shape
// (thinking + text + toolCall blocks) from the session JSONL.
//
// Run: bun run ulw-analysis/probe_claims.ts [model]   (default qwen3.5-4b)

import {
  buildLibrarianPrompts,
  extractAssistantText,
  AssertionBuffer,
} from "../ultrawork/claim_audit";

const ROUTER = process.env.PI_LLAMA_ROUTER_URL ?? "http://127.0.0.1:1234";
const MODEL = process.argv[2] ?? process.env.PI_LIBRARIAN_MODEL ?? "qwen3.5-4b";

// ── 1. Unit test: extraction on the REAL message shape ─────────────
console.log("=== 1. extractAssistantText unit test ===");
const fakeMsg = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "I should check whether the cache flushes on compaction..." },
    { type: "text", text: "The prune flush resets the librarian baseline, so the 20k delta gate re-arms." },
    { type: "toolCall", name: "bash", arguments: { command: "ls" } },
    { type: "text", text: "Also, llama.cpp `--cache-type q8_0` halves KV memory vs f16 — I'll set that flag in server.sh." },
  ],
};
const extracted = extractAssistantText(fakeMsg);
console.log("extracted:", JSON.stringify(extracted));
console.assert(!extracted.includes("I should check"), "thinking leaked into claims");
console.assert(extracted.includes("--cache-type q8_0"), "text block missing");
console.assert(!extracted.includes("bash"), "toolCall leaked into claims");
console.log("unit test:", extracted.includes("--cache-type q8_0") && !extracted.includes("I should check") ? "PASS" : "FAIL");

// ── 2. Perturbation probe: control vs treatment ────────────────────
const claims = [
  "I'll add `--cache-type q8_0` to the llama.cpp server args to halve KV memory — that flag caps the cache at 8 bits.",
  "With the 20k-token re-trigger delta and the 60s cooldown, the librarian fires roughly once per long tool burst.",
  "Qwen3.8's `max_tokens` default is 2048 unless the router overrides it.",
  "The router does not support parallel sampling, so two librarian calls would queue anyway.",
  "It's good to keep the code clean and the functions small with clear names.",
];

const scenario = {
  triggerReason: "context at ~52000 tokens",
  untouched: [{ label: "Task list", path: "TODO.md" }],
  stale: [] as { label: string; path: string }[],
  digest: [
    "read: extensions/ultrawork.ts",
    "bash: grep -n librarian ultrawork.log | tail",
    "edit: extensions/ultrawork.ts",
  ],
};

async function callLibrarian(claimsArr: string[]): Promise<string> {
  const { system, user } = buildLibrarianPrompts({ ...scenario, claims: claimsArr });
  const t0 = Date.now();
  const res = await fetch(`${ROUTER}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      // Probe uses 1000 (vs production 220) so a verbose thinking model
      // finishes its reasoning AND emits the bullet list. At 220 the reasoning
      // eats the budget and content comes back empty (production finding).
      max_tokens: 1000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const data: any = await res.json();
  const msg = data?.choices?.[0]?.message ?? {};
  // Mirror the extension EXACTLY: content, else reasoning_content, else "".
  const out = (msg?.content?.trim() || msg?.reasoning_content?.trim() || "");
  console.log(`  [${Date.now() - t0}ms] HTTP ${res.status} contentLen=${(msg.content ?? "").length} reasoningLen=${(msg.reasoning_content ?? "").length}`);
  if (!out) console.log("  RAW:", JSON.stringify(data).slice(0, 400));
  return out;
}

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9_.-]{3,}/g) ?? []);
}

console.log(`\n=== 2. Perturbation probe (model=${MODEL}) ===`);
console.log("claims under test:");
claims.forEach((c, i) => console.log(`  [${i + 1}] ${c}`));

console.log("\n--- A. CONTROL (no claims section) ---");
const a = await callLibrarian([]);
console.log(a);

console.log("\n--- B. TREATMENT (with claims section) ---");
const b = await callLibrarian(claims);
console.log(b);

// ── 3. Verdict: did the claims section change the output? ─────────
console.log("\n=== 3. Verdict ===");
const aW = words(a);
const bW = words(b);
// claim-specific tokens that should only appear if the librarian actually read the claims
const signalTokens = ["q8_0", "cache-type", "2048", "max_tokens", "parallel", "sampling", "cooldown", "re-trigger"];
const aSignal = signalTokens.filter((t) => aW.has(t));
const bSignal = signalTokens.filter((t) => bW.has(t));
console.log(`control  claim-specific tokens: [${aSignal.join(", ") || "none"}]`);
console.log(`treatment claim-specific tokens: [${bSignal.join(", ") || "none"}]`);
const identical = a === b;
console.log(`outputs identical: ${identical}`);
const pass = !identical && bSignal.length > aSignal.length;
console.log(`PASS: ${pass ? "YES — claims section drives the output" : "NO — see outputs above"}`);

// ── 4. Buffer sanity ────────────────────────────────────────────────
console.log("\n=== 4. AssertionBuffer sanity ===");
const buf = new AssertionBuffer();
for (let i = 0; i < 50; i++) buf.push(`claim number ${i} with enough characters to pass the minimum length filter`);
console.log(`after 50 pushes: size=${buf.size} (cap 30) chars~=${buf.recent(30).join("").length}`);
console.log(`recent(3) last: ${JSON.stringify(buf.recent(1)[0])}`);
buf.clear();
console.log(`after clear: size=${buf.size}`);
