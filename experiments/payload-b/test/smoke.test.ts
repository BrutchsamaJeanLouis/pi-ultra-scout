import { describe, expect, it } from "bun:test";
import { probeLoadedModels } from "../src/probe.ts";

const ROUTER = "http://127.0.0.1:1234";

describe("probeLoadedModels", () => {
  it("resolves to an array containing at least one string id", async () => {
    const ids = await probeLoadedModels(ROUTER);

    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(ids[0]).toBeTypeOf("string");
  }, 15_000);
});
