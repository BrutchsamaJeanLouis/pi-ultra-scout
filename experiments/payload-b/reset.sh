#!/usr/bin/env bash
# Reset payload-B (undici) to pristine TODO state before each run.
set -e
cd "$(dirname "$0")"
rm -rf src test node_modules bun.lock .pi
cat > TODO.md << 'TODO'
# ulw-paper-payload-b — TODO-driven build

## Task: timeout-aware model-probe (bun + TypeScript)
- [ ] Write `src/probe.ts`: export `async function probeLoadedModels(baseUrl: string): Promise<string[]>` — fetch `${baseUrl}/v1/models` and return the `id` of every model entry whose `status.value === "loaded"`. Use EXPLICIT timeout handling (connection + headers + body) appropriate for a flaky internal service — do not rely on silent defaults.
- [ ] The comment block at the top of `src/probe.ts` must include: (a) the official undici documentation URL(s) you relied on, and (b) a table of EVERY timeout-related option exposed by undici (e.g. headersTimeout, bodyTimeout, connectTimeout, and any others you find in the official docs): option name, and the default value as documented.
- [ ] Set explicit timeouts in the code where our flaky-service case differs from the documented defaults.
- [ ] Write `test/smoke.test.ts`: `probeLoadedModels("http://127.0.0.1:1234")` resolves to an array containing at least one string id (a local llama router is running on that port). Run `bun test` until green.
- [ ] When done: check every box in this file and leave a final summary.
TODO
echo "reset done"
