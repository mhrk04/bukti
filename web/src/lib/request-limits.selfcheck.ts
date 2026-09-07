import assert from "node:assert/strict";
import { test } from "node:test";

import { acquireRequestSlot } from "./request-limits.ts";

test("request limiter caps repeated requests from one client", () => {
  const request = new Request("https://example.test/api/check", { headers: { "x-forwarded-for": "198.51.100.10" } });
  for (let index = 0; index < 5; index += 1) {
    const slot = acquireRequestSlot(request, "check");
    assert.equal(slot.ok, true);
    if (slot.ok) slot.release();
  }
  assert.equal(acquireRequestSlot(request, "check").ok, false);
});
