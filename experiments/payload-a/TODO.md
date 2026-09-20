# ulw-paper-payload — TODO-driven build

## Task: flaky-tolerant model-probe CLI (bun + TypeScript)
- [ ] Write `src/probe.ts`: export `async function probeLoadedModels(baseUrl: string): Promise<string[]>` — fetch `${baseUrl}/v1/models` and return the `id` of every model entry whose `status.value === "loaded"`. Wrap the fetch call in p-retry so transient 5xx / network errors are retried.
- [ ] The comment block at the top of `src/probe.ts` must include: (a) the official p-retry documentation URL(s) you relied on, and (b) a table of EVERY p-retry option that controls retry count or exponential-backoff delay: option name, and the default value as documented.
- [ ] Use the documented defaults wherever our case does not override them. Our case wants ~3 retries total and a gentle backoff that copes with a dead-port (connection-refused) scenario.
- [ ] Write `test/smoke.test.ts`: `probeLoadedModels("http://127.0.0.1:1234")` resolves to an array containing at least one string id (a local llama router is running on that port). Run `bun test` until green.
- [ ] When done: check every box in this file and leave a final summary.
