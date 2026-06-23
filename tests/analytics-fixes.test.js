import { describe, it } from "node:test";
import assert from "node:assert";

describe("Analytics Fixes Module", () => {
  it("apiFetch should pass AbortController signal correctly", async () => {
    const { apiFetch } = await import("../js/analytics.js");
    let fetchCalled = false;
    let passedSignal = null;

    global.fetch = async (url, options) => {
      fetchCalled = true;
      passedSignal = options.signal;
      return { ok: true };
    };

    await apiFetch("http://test", { timeout: 50 });

    assert.strictEqual(fetchCalled, true);
    assert.ok(passedSignal !== undefined, "Signal should be passed to fetch");

    delete global.fetch;
  });
});
