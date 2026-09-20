// Direct test of the "same model" completion transport: call the openai-completions
// streamSimple (the low-level fn behind Models.complete) against the LOCAL router
// 4B, with a hand-built Model object (mirrors what ctx.model looks like for llamacpp).
// Proves: baseUrl routing, message conversion, auth-less local call, text extraction.
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

const model: any = {
  id: "qwen3.5-4b",
  api: "openai-completions",
  provider: "llamacpp",
  baseUrl: "http://localhost:1234/v1",
  reasoning: true,
  maxTokens: 500,
  contextWindow: 126976,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const context: any = {
  systemPrompt: "You are a terse auditor. Reply with one '- ' bullet.",
  messages: [{ role: "user" as const, content: 'Classify this claim as (a) checkable-or-verify or (b) needs-research: "The llama.cpp router halves memory with --cache-type q8_0." Just the bullet.', timestamp: Date.now() }],
};

const t0 = Date.now();
const stream: any = streamSimple(model, context, { maxTokens: 500, temperature: 0.2, apiKey: "local" });
let text = "";
let thinking = "";
for await (const ev of stream) {
  if (ev.type === "text_delta") text += ev.delta;
  else if (ev.type === "thinking_delta") thinking += ev.delta;
  else if (ev.type === "done") { console.log("[done] reason=", ev.reason); break; }
  else if (ev.type === "error") { console.log("[ERROR]", ev.error?.errorMessage || ev.error); break; }
}
console.log("elapsed=", Date.now() - t0, "ms");
console.log("TEXT:", JSON.stringify(text.trim()));
console.log("THINKING(len):", thinking.trim().length);
