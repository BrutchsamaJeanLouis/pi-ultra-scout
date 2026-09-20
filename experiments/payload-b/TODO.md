# ulw-paper-payload-b — TODO-driven build

## Task: timeout-aware model-probe (bun + TypeScript)
- [x] Write `src/probe.ts`: export `async function probeLoadedModels(baseUrl: string): Promise<string[]>` — fetch `${baseUrl}/v1/models` and return the `id` of every model entry whose `status.value === "loaded"`. Use EXPLICIT timeout handling (connection + headers + body) appropriate for a flaky internal service — do not rely on silent defaults.
- [x] The comment block at the top of `src/probe.ts` must include: (a) the official undici documentation URL(s) you relied on, and (b) a table of EVERY timeout-related option exposed by undici (e.g. headersTimeout, bodyTimeout, connectTimeout, and any others you find in the official docs): option name, and the default value as documented.
- [x] Set explicit timeouts in the code where our flaky-service case differs from the documented defaults.
- [x] Write `test/smoke.test.ts`: `probeLoadedModels("http://127.0.0.1:1234")` resolves to an array containing at least one string id (a local llama router is running on that port). Run `bun test` until green.
- [x] When done: check every box in this file and leave a final summary.

## Final summary
`src/probe.ts` exports `probeLoadedModels(baseUrl)` using a shared undici `Agent`
with explicit 5000 ms `connectTimeout` / `headersTimeout` / `bodyTimeout` /
`connect.timeout` (all differ from documented defaults 10e3 / 300e3 / 300e3 /
10e3) plus a 5 s `AbortSignal.timeout` hard cap; keepAlive* left at defaults
(4e3 / 600e3 / 2e3). Header comment carries the official doc URLs and the full
11-row table of every documented timeout option with its default. Verified:
`bunx tsc --noEmit` clean; `bun test` 1 pass / 0 fail (live router, returns
["qwen3.8-27b"]); `verify_timeouts.mjs` PASS twice (fails at ~5 s with
TimeoutError, not the 300 s default). All boxes checked.
