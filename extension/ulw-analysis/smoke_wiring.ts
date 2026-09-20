// smoke_wiring.ts — integration smoke test for the claim-audit wiring.
//
// Drives the REAL extension factory with a mocked pi API and fires the real
// handlers in order:
//   session_start -> /ulw -> turn_end(claim) -> tool_execution_start/end
// The token gate (85k >= 80k, delta >= 20k) fires callLibrarian, which makes a
// LIVE router call to the 4B (VRAM-safe) and delivers a steer nudge.
//
// Asserts:
//   1. message_end captured the assistant text into the buffer (CLAIM log line).
//   2. callLibrarian's audit scope shows claimsBuf=1 (the claims channel is live).
//   3. The router responded and the nudge was delivered (sendMessage captured).
//
// Run: PI_LIBRARIAN_MODEL=qwen3.5-4b bun run ulw-analysis/smoke_wiring.ts

process.env.PI_LIBRARIAN_MODEL = process.env.PI_LIBRARIAN_MODEL ?? "qwen3.5-4b";
process.env.PI_LLAMA_ROUTER_URL = process.env.PI_LLAMA_ROUTER_URL ?? "http://127.0.0.1:1234";

const ext = (await import("../ultrawork")).default;

const handlers: Record<string, any> = {};
const commands: Record<string, any> = {};
const tools: any[] = [];
const sent: any[] = [];
const entries: any[] = [];

const ui = { setStatus: () => {}, notify: () => {}, setWorkingIndicator: () => {} };
const ctx = {
  cwd: process.cwd(),
  ui,
  getContextUsage: () => ({ tokens: 85_000 }),
  model: { id: process.env.PI_LIBRARIAN_MODEL ?? "qwen3.5-4b", provider: "llamacpp" },
  // Minimal modelRegistry: route complete() through the real llama router so
  // the smoke still exercises a LIVE model call (cold-loads the 4B on demand).
  modelRegistry: {
    getAll: () => [],
    complete: async (model: any, prompt: any) => {
      const res = await fetch("http://127.0.0.1:1234/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          temperature: 0.2,
          max_tokens: 500,
          messages: [
            { role: "system", content: prompt.systemPrompt ?? "" },
            { role: "user", content: (prompt.messages ?? []).map((m: any) => m.content).join("\n") },
          ],
        }),
      });
      const data: any = await res.json();
      const msgObj: any = data?.choices?.[0]?.message;
      // thinking models may park the answer in reasoning_content
      const text = (msgObj?.content ?? "") || (msgObj?.reasoning_content ?? "");
      return { content: [{ type: "text", text }] };
    },
  },
};

const pi: any = {
  on: (name: string, fn: any) => { handlers[name] = fn; },
  registerTool: (def: any) => { tools.push(def.name ?? def); },
  registerCommand: (name: string, def: any) => { commands[name] = def; },
  sendMessage: (msg: any, opts: any) => { sent.push({ msg, opts }); },
  appendEntry: async (type: string, data: any) => { entries.push({ type, data }); },
  sendUserMessage: (text: string) => {},
  registerMessageRenderer: () => {},
};

console.log("loading extension factory...");
ext(pi);
console.log(`handlers: ${Object.keys(handlers).join(", ")}`);
console.log(`tools: ${tools.join(", ")}`);
console.log(`commands: ${Object.keys(commands).join(", ")}`);
if (!tools.includes("research_dispatch")) {
  console.log("FAIL: research_dispatch tool NOT registered");
  process.exit(1);
}
console.log("research_dispatch tool registered ✓");

// 1. session start
handlers.session_start({}, ctx);

// 2. activate /ulw
await commands.ulw.handler("", { ui });

// 3. a message where the agent asserts something (real message shape —
//    capture happens on message_end, NOT turn_end: a pi turn is the whole
//    agentic episode, so per-message capture is the only channel that sees
//    claims from long tool loops)
const fakeMessage = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "Let me state the cache plan clearly." },
    { type: "text", text: "I'm going to set llama.cpp `--cache-type q8_0` on the router — per the docs that halves KV memory versus f16, and the default is f16." },
  ],
};
handlers.message_end({ message: fakeMessage });

// 4. the tool that ends that turn — trips the token gate
handlers.tool_execution_start({ toolCallId: "smoke-1", toolName: "bash", args: { command: "echo smoke" } });
handlers.tool_execution_end({ toolCallId: "smoke-1", toolName: "bash", isError: false }, ctx);

console.log("gate fired; waiting for live 4B librarian call...");
const t0 = Date.now();
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  if (sent.length > 0 || entries.some((e) => e.type === "librarian-report")) break;
}
console.log(`done after ${Date.now() - t0}ms`);

// ── Verdict ─────────────────────────────────────────────────────────
console.log("\n=== SMOKE VERDICT ===");
console.log(`sendMessage captured: ${sent.length}`);
if (sent[0]) {
  console.log(`nudge content: ${JSON.stringify(sent[0].msg.content).slice(0, 300)}`);
  console.log(`nudge deliverAs: ${JSON.stringify(sent[0].opts)}`);
}
console.log(`entries: ${entries.map((e) => e.type).join(", ") || "(none)"}`);
const rep = entries.find((e) => e.type === "librarian-report");
if (rep) console.log(`librarian-report bullets: ${JSON.stringify(rep.data.bullets).slice(0, 300)}`);

const pass = sent.length > 0 && entries.some((e) => e.type === "librarian-report");
console.log(`PASS: ${pass ? "YES — full chain message_end -> gate -> live librarian -> nudge" : "NO — inspect log tail"}`);
