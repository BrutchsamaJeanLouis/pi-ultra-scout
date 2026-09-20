import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "@sinclair/typebox";
import { spawn, type ChildProcess } from "child_process";
import { createInterface, type Interface as RLInterface } from "readline";

// ─── State ───────────────────────────────────────────────────────────
let mcpProc: ChildProcess | null = null;
let mcpRL: RLInterface | null = null;
let callId = 0;
let initialized = false;

const pending = new Map<number, {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}>();

// ─── Schema conversion (JSON Schema → TypeBox) ──────────────────────

function convertJsonSchema(schema: unknown): TSchema {
  try {
    if (!schema || typeof schema !== "object") return Type.Any();
    const s = schema as Record<string, unknown>;

    const opts: Record<string, unknown> = {};
    if (typeof s.description === "string") opts.description = s.description;
    if (s.default !== undefined) opts.default = s.default;

    // Enums: pass through as-is using Type.Unsafe so the LLM sees a clean
    // { "type": "string", "enum": [...] } instead of anyOf/const which LLMs choke on
    if (Array.isArray(s.enum) && s.enum.length > 0) {
      return Type.Unsafe({ ...opts, type: typeof s.enum[0] === "number" ? "number" : "string", enum: s.enum });
    }
    // anyOf/oneOf where every variant is a {const: value} — flatten to enum
    if (Array.isArray(s.anyOf) && s.anyOf.length > 0) {
      const allConst = (s.anyOf as Record<string, unknown>[]).every(v => v.const !== undefined);
      if (allConst) {
        const values = (s.anyOf as Record<string, unknown>[]).map(v => v.const);
        return Type.Unsafe({ ...opts, type: typeof values[0] === "number" ? "number" : "string", enum: values });
      }
      const variants = (s.anyOf as unknown[]).map(v => convertJsonSchema(v));
      return variants.length >= 2 ? Type.Union(variants, opts) : variants[0];
    }
    if (Array.isArray(s.oneOf) && s.oneOf.length > 0) {
      const allConst = (s.oneOf as Record<string, unknown>[]).every(v => v.const !== undefined);
      if (allConst) {
        const values = (s.oneOf as Record<string, unknown>[]).map(v => v.const);
        return Type.Unsafe({ ...opts, type: typeof values[0] === "number" ? "number" : "string", enum: values });
      }
      const variants = (s.oneOf as unknown[]).map(v => convertJsonSchema(v));
      return variants.length >= 2 ? Type.Union(variants, opts) : variants[0];
    }
    if (s.type === "object" || s.properties) {
      const props = (s.properties as Record<string, unknown>) ?? {};
      const req = new Set((s.required as string[]) ?? []);
      const converted: Record<string, TSchema> = {};
      for (const [key, val] of Object.entries(props)) {
        const field = convertJsonSchema(val);
        converted[key] = req.has(key) ? field : Type.Optional(field);
      }
      return Type.Object(converted, opts);
    }
    if (s.type === "array") {
      return Type.Array(s.items ? convertJsonSchema(s.items) : Type.Any(), opts);
    }
    switch (s.type) {
      case "string":  return Type.String(opts);
      case "number":  return Type.Number(opts);
      case "integer": return Type.Integer(opts);
      case "boolean": return Type.Boolean(opts);
    }
    return Type.Any();
  } catch {
    return Type.Any();
  }
}

function convertSchema(schema: unknown): TSchema {
  const result = convertJsonSchema(schema);
  if (!result || (result as Record<string, unknown>).type !== "object") return Type.Object({});
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: undefined };
}

const SNAPSHOT_MAX = 12000;

function truncate(text: string): string {
  if (text.length <= SNAPSHOT_MAX) return text;
  return text.slice(0, SNAPSHOT_MAX) + `\n\n[truncated — ${text.length - SNAPSHOT_MAX} chars omitted]`;
}

// ─── Stdio MCP transport ────────────────────────────────────────────

function sendRpc(msg: Record<string, unknown>): void {
  if (!mcpProc?.stdin?.writable) throw new Error("MCP process not running");
  mcpProc.stdin.write(JSON.stringify(msg) + "\n");
}

function rpcRequest(method: string, params: unknown = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++callId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out: ${method}`));
    }, 30_000);

    pending.set(id, {
      resolve: (val) => { clearTimeout(timer); resolve(val); },
      reject: (err) => { clearTimeout(timer); reject(err); },
    });

    sendRpc({ jsonrpc: "2.0", id, method, params });
  });
}

function rpcNotify(method: string, params: unknown = {}): void {
  sendRpc({ jsonrpc: "2.0", method, params });
}

async function startMcpProcess(notify: (msg: string) => void): Promise<void> {
  notify("playwright-bridge: Starting Playwright MCP (extension mode)...");

  // HEADLESS VARIANT (clean-env test): launch own Chromium instead of
  // connecting to a host Chrome via --extension.
  mcpProc = spawn("npx", [
    "@playwright/mcp@latest",
    "--headless",
    "--browser", "chromium",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
  });

  mcpProc.on("error", (e) => {
    notify(`playwright-bridge: MCP process error — ${e.message}`);
    mcpProc = null;
  });
  mcpProc.on("exit", (code) => {
    if (code !== null && code !== 0) {
      notify(`playwright-bridge: MCP process exited with code ${code}`);
    }
    mcpProc = null;
    initialized = false;
  });

  mcpProc.stderr?.on("data", () => {}); // drain

  mcpRL = createInterface({ input: mcpProc.stdout!, crlfDelay: Infinity });
  mcpRL.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed);
      if (msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(JSON.stringify(msg.error)));
        } else {
          p.resolve(msg.result);
        }
      }
    } catch {
      // Non-JSON line, ignore
    }
  });

  await sleep(2000);

  await rpcRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "pi-bridge", version: "3.0" },
  });
  rpcNotify("notifications/initialized");
  initialized = true;

  notify("playwright-bridge: MCP ready");
}

async function toolCall(name: string, args: Record<string, unknown>): Promise<string> {
  if (!initialized || !mcpProc) throw new Error("MCP not initialized — is Chrome open?");

  const result = await rpcRequest("tools/call", { name, arguments: args }) as {
    content?: { type: string; text?: string }[];
  };

  return (result?.content ?? [])
    .map((c: { text?: string }) => c.text ?? "")
    .join("\n");
}

// ─── Extension entry point ───────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    initialized = false;
    callId = 0;
    pending.clear();

    const notify = (msg: string) => ctx.ui.notify(msg, "info");

    // Kill any old MCP process and start fresh
    if (mcpProc) {
      try { mcpProc.kill(); } catch {}
      mcpProc = null;
    }

    try {
      await startMcpProcess(notify);
    } catch (e) {
      ctx.ui.notify(`playwright-bridge: MCP startup failed — ${e}`, "error");
      return;
    }

    // Fetch tools and register them
    let tools: { name: string; description: string; inputSchema: unknown }[];
    try {
      const result = await rpcRequest("tools/list") as { tools: typeof tools };
      tools = result.tools;
    } catch (e) {
      ctx.ui.notify(`playwright-bridge: tools/list failed — ${e}`, "error");
      return;
    }

    const refTools = new Set([
      "browser_click", "browser_drag", "browser_hover",
      "browser_type", "browser_fill_form", "browser_select_option",
    ]);

    const toolGuidelines: Record<string, string> = {
      browser_navigate: "Returns a snapshot — do NOT call pw_browser_snapshot after this. Use the returned refs immediately.",
      browser_snapshot: "Takes a fresh accessibility snapshot. Only needed if the page changed since your last action.",
      browser_click: "If a dialog/overlay/cookie-banner blocks the target, dismiss it first.",
      browser_fill_form: "PREFERRED for text input. Clears existing content. If a dialog/overlay blocks the target, dismiss it first.",
      browser_type: "Prefer pw_browser_fill_form for inputs. Use this only for special keys (Enter, Tab, etc.).",
    };

    const globalGuideline = [
      "\n## Ref rules",
      "- Refs (e.g. 'e39') are valid from the MOST RECENT tool response only.",
      "- After navigate/click/fill, the response includes a fresh snapshot — use those refs.",
      "- If a dialog or overlay covers the page, dismiss it BEFORE interacting with elements behind it.",
      "- NEVER retry the same failed ref. Read the latest snapshot and pick the correct new ref.",
    ].join("\n");

    for (const tool of tools) {
      const toolName = tool.name;
      const extra = toolGuidelines[toolName] ?? "";
      const desc = `[Playwright/browser] ${tool.description}${extra ? `\n\n${extra}` : ""}${globalGuideline}`;

      pi.registerTool({
        name: `pw_${toolName}`,
        label: `Playwright: ${toolName}`,
        description: desc,
        parameters: convertSchema(tool.inputSchema),
        async execute(_id, params, _signal, _onUpdate, _ctx) {
          try {
            const output = await toolCall(toolName, params as Record<string, unknown>);

            if (refTools.has(toolName) && output.includes("not found")) {
              try {
                const snap = await toolCall("browser_snapshot", {});
                return textResult(
                  `### Error\n${output}\n\n` +
                  `### Auto-recovered snapshot (use these refs)\n${truncate(snap)}`
                );
              } catch {
                return textResult(`${output}\n\n(Auto-snapshot failed — call pw_browser_snapshot manually)`);
              }
            }

            let text = truncate(output);
            if (toolName === "browser_take_screenshot") {
              text +=
                "\n\n\ud83d\udca1 Screenshot tip: you can prioritize `computer_screenshot` for full-desktop ground truth " +
                "(2560x1080, 1:1 PHYSICAL px = the exact space computer_click/computer_hit_test use). " +
                "This Playwright shot is the browser VIEWPORT only, in CSS px — a different coordinate space. " +
                "For page element refs, keep using browser_snapshot instead of a screenshot.";
            }
            return textResult(text);
          } catch (e) {
            const err = String(e);
            if (err.includes("not initialized") || err.includes("not running")) {
              return textResult(
                "Chrome is not connected. Please ask the user to:\n" +
                "1. Open Chrome (with the Playwright MCP Bridge extension enabled)\n" +
                "2. Then retry the browser action"
              );
            }
            return textResult(`Playwright error: ${e}`);
          }
        },
      });
    }

    ctx.ui.notify(`playwright-bridge: ${tools.length} browser tools loaded`, "info");
  });

  pi.on("before_agent_start", (event, _ctx) => {
    return {
      systemPrompt: event.systemPrompt + `

## Browser tools (playwright-bridge)
You have pw_* tools for browser automation via the user's real Chrome profile (MCP Bridge extension).
Chrome must be open for browser tools to work. If a browser tool returns a connection error, tell the user to open Chrome and retry.

**Workflow:**
1. pw_browser_navigate → returns a snapshot. Read it. Do NOT snapshot again.
2. If you see a dialog/overlay/cookie-banner → dismiss it first (click accept/close).
3. Use refs from the MOST RECENT tool response to interact (click, fill, type).
4. Each action response includes an updated snapshot — use those new refs for the next action.

**If a ref fails:**
- The tool auto-recovers with a fresh snapshot in the response.
- Read the new snapshot and use the updated refs. NEVER retry a failed ref.

**Prefer pw_browser_fill_form** for text input over pw_browser_type.
`,
    };
  });

  pi.on("session_shutdown", () => {
    if (mcpProc) {
      try { mcpProc.kill(); } catch {}
      mcpProc = null;
    }
    initialized = false;
    pending.clear();
  });
}
