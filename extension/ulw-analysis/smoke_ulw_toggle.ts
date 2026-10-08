// smoke_ulw_toggle.ts — unit smoke test for the /ulw on|off argument parsing.
//
// Drives the REAL extension factory with a mocked pi API (NO live model
// needed) and asserts the /ulw command handler toggles behavior correctly:
//   - default at load: inactive
//   - `/ulw` (no arg) activates   (backward compat)
//   - `/ulw on` activates
//   - `/ulw off` deactivates
//   - `/ulw on` re-activates
// Activation is observed via before_agent_start: it injects the completion
// contract + trust-shapes section ONLY when ultraworkActive is true.
//
// Run: bun run ulw-analysis/smoke_ulw_toggle.ts   (also runs under `bun test`)

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

// The extension reads env gates at import time — clear them so the test is
// deterministic regardless of the ambient environment.
delete process.env.PI_ULW_AUTOACTIVE;
delete process.env.PI_ULW_OFF;
delete process.env.PI_ULW_NO_DISPATCH;
delete process.env.PI_RESEARCH_CHILD;

const ext = (await import("../ultrawork")).default;

const handlers: Record<string, any> = {};
const commands: Record<string, any> = {};
const tools: any[] = [];
const entries: any[] = [];
const notified: string[] = [];

const ui = {
  setStatus: () => {},
  notify: (msg: string) => notified.push(msg),
  setWorkingIndicator: () => {},
};
const ctx: any = {
  cwd: process.cwd(),
  ui,
  getContextUsage: () => ({ tokens: 0 }),
  model: { id: "stub", provider: "llamacpp" },
};

const pi: any = {
  on: (name: string, fn: any) => {
    handlers[name] = fn;
  },
  registerTool: (def: any) => {
    tools.push(def.name ?? def);
  },
  registerCommand: (name: string, def: any) => {
    commands[name] = def;
  },
  sendMessage: () => {},
  appendEntry: async (type: string, data: any) => {
    entries.push({ type, data });
  },
  sendUserMessage: () => {},
  registerMessageRenderer: () => {},
};

ext(pi);

// Observe behavior activation through the real hook: before_agent_start
// returns {} when inactive, { systemPrompt: BASE + injection } when active.
async function isActive(): Promise<boolean> {
  const r = await handlers.before_agent_start({ systemPrompt: "BASE" }, ctx);
  return !!r && typeof r.systemPrompt === "string" && r.systemPrompt.length > "BASE".length;
}

console.log("smoke_ulw_toggle — /ulw on|off handler");

check("default at load: ultrawork inactive", !(await isActive()));

await commands.ulw.handler("", { ui });
check("/ulw (no arg) activates — backward compat", await isActive());

await commands.ulw.handler("on", { ui });
check("/ulw on activates", await isActive());

await commands.ulw.handler("off", { ui });
check("/ulw off deactivates", !(await isActive()));

await commands.ulw.handler("on", { ui });
check("/ulw on re-activates after off", await isActive());

check(
  "user-facing notify messages",
  notified.filter((n) => n.includes("ultrawork enabled")).length === 3 &&
    notified.filter((n) => n.includes("ultrawork disabled")).length === 1,
  `enabled=${notified.filter((n) => n.includes("ultrawork enabled")).length} disabled=${notified.filter((n) => n.includes("ultrawork disabled")).length}`,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
