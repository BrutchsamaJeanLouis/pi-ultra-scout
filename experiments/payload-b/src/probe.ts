/**
 * probeLoadedModels — timeout-aware probe of an internal llama router.
 *
 * We hit `${baseUrl}/v1/models` on a flaky internal service. The router is
 * known to accept TCP and then hang (no headers, or a slow/truncated body)
 * under load, so we must NOT rely on undici's silent defaults — undici would
 * otherwise wait 300s for headers/body before giving up. We therefore use an
 * explicit undici `Agent` with short, deliberate timeouts for every phase of
 * the request: connect -> headers -> body.
 *
 * Official undici documentation relied on (official_docs):
 *   - https://undici.nodejs.org/docs/latest/api/Client.html
 *   - https://undici.nodejs.org/docs/latest/api/Dispatcher.html
 *   - source: https://raw.githubusercontent.com/nodejs/undici/main/docs/docs/api/Client.md
 *   - source: https://raw.githubusercontent.com/nodejs/undici/main/docs/docs/api/Dispatcher.md
 *   (Verified live 2026-09-19; matches local .undici-docs/{client,dispatcher}.md.)
 *
 * EVERY timeout-related option undici exposes, and its documented default:
 *
 *   Option (constructor: Client/Pool/Agent)      Default (ms)
 *   -----------------------------------------------------------
 *   bodyTimeout                                  300e3 (300000)
 *   headersTimeout                               300e3 (300000)
 *   connectTimeout                               10e3 (10000)
 *   keepAliveTimeout                             4e3 (4000)
 *   keepAliveMaxTimeout                          600e3 (600000)
 *   keepAliveTimeoutThreshold                    2e3 (2000)
 *   autoSelectFamilyAttemptTimeout               250
 *
 *   Option (connect / ConnectOptions / buildConnector)   Default (ms)
 *   -----------------------------------------------------------
 *   connect.timeout                               10e3 (10000)
 *   connect.keepAliveInitialDelay                 60000
 *   connect.keepAlive                             true (boolean; TCP keep-alive)
 *
 *   Option (per-request, dispatcher.dispatch / client.dispatch)   Default
 *   -----------------------------------------------------------
 *   headersTimeout                                300 seconds (300000 ms)
 *   bodyTimeout                                  300 seconds (300000 ms)
 *
 *   Note: `autoSelectFamily` (boolean, default false) toggles the RFC-8305
 *   address auto-detect whose per-attempt budget is `autoSelectFamilyAttemptTimeout`.
 */
import { Agent, fetch } from "undici";

/**
 * Flaky-service budget. Each phase of the request (connect / headers / body)
 * gets 5s — deliberately far below undici's 10s/300s/300s defaults so a hung
 * router fails fast instead of stalling a caller for five minutes.
 */
const FLAKY_SERVICE_TIMEOUT_MS = 5_000;

/**
 * Shared dispatcher. Module-level so every probe reuses pooled connections,
 * but with our EXPLICIT timeouts where they differ from the documented defaults:
 *   - connectTimeout 5000   (default 10e3)
 *   - connect.timeout 5000  (default 10e3)
 *   - headersTimeout 5000   (default 300e3)  <-- the key one for "accepts TCP, no headers"
 *   - bodyTimeout 5000      (default 300e3)  <-- the key one for "slow/truncated body"
 * keepAlive* options are intentionally left at their documented defaults
 * (4e3 / 600e3 / 2e3) — a hung router is a per-request problem, not a
 * keep-alive one, and over-aggressive keepAlive timeouts would churn connections.
 */
const agent = new Agent({
  connectTimeout: FLAKY_SERVICE_TIMEOUT_MS,
  headersTimeout: FLAKY_SERVICE_TIMEOUT_MS,
  bodyTimeout: FLAKY_SERVICE_TIMEOUT_MS,
  connect: {
    timeout: FLAKY_SERVICE_TIMEOUT_MS,
  },
});

export async function probeLoadedModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${baseUrl}/v1/models`, {
    dispatcher: agent,
    // Belt-and-braces whole-request watchdog: undici's Agent timeouts cover
    // connect/headers/body precisely, but bun's fetch has been observed flaky
    // on client-side parser timeouts, so cap the entire call at ~5s as well.
    signal: AbortSignal.timeout(FLAKY_SERVICE_TIMEOUT_MS),
  });
  if (!res.ok) {
    // Drain so the socket can return to the pool, then surface a clear error.
    await res.arrayBuffer().catch(() => {});
    throw new Error(`probeLoadedModels: HTTP ${res.status} from ${baseUrl}/v1/models`);
  }

  const data: unknown = await res.json();
  // The router is OpenAI-compatible: { data: [ { id, status: { value }, ... } ] }.
  // Be defensive about the container (array vs. { data: [] }).
  const entries: unknown[] = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { data?: unknown[] }).data)
      ? ((data as { data: unknown[] }).data as unknown[])
      : [];

  return entries
    .map((m): string | undefined => {
      const entry = m as { id?: unknown; status?: { value?: unknown } };
      return entry?.status?.value === "loaded" && typeof entry?.id === "string"
        ? entry.id
        : undefined;
    })
    .filter((id): id is string => typeof id === "string");
}
