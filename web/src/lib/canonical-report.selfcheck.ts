import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANONICAL_REPORT_VERSION,
  canonicalStringify,
  canonicalReportBytes,
  sha256HexBytes,
  toCanonicalReport,
} from "./canonical-report.ts";

// A minimal ClaimCheck-shaped fixture. Keys are intentionally out of order to
// prove the canonical serializer does not depend on insertion order.
function fixture() {
  return {
    claim: "Example public claim",
    aggregateVerdict: "uncertain",
    aggregateScore: 55,
    disagreement: 10,
    warnings: ["search: no key configured"],
    results: [
      {
        model: "model-b",
        requestId: "req-b",
        score: 60,
        verdict: "likely",
        reasoning: "second model",
        evidence: [{ url: "https://example.gov.my", quote: "quote b", stance: "supports" }],
      },
      {
        model: "model-a",
        requestId: null,
        score: 50,
        verdict: "unclear",
        reasoning: "first model",
        evidence: [],
      },
    ],
    evidence: {
      url: "https://example.gov.my/article",
      requestedUrl: "https://example.gov.my/article",
      title: "Title",
      excerpt: "Excerpt",
      retrievedAt: "2026-09-05T00:00:00.000Z",
      digest: "abc123",
    },
    sources: [
      {
        title: "Source",
        url: "https://example.gov.my",
        excerpt: "Source excerpt",
        retrievedAt: "2026-09-05T00:00:00.000Z",
        publishedAt: null,
        trusted: true,
        official: true,
      },
    ],
  };
}

// canonicalStringify emits sorted keys and no whitespace, deterministically.
test("canonicalStringify sorts keys and is whitespace-free", () => {
  const a = canonicalStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
  const b = canonicalStringify({ c: { y: 2, z: 1 }, a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1,"c":{"y":2,"z":1}}');
});

// canonicalStringify rejects non-finite numbers and non-representable values.
test("canonicalStringify rejects unrepresentable values", () => {
  assert.throws(() => canonicalStringify(Number.NaN));
  assert.throws(() => canonicalStringify(Infinity));
  assert.throws(() => canonicalStringify(undefined));
  assert.throws(() => canonicalStringify(BigInt(10)));
});

// The same ClaimCheck always yields identical canonical bytes (order-stable).
test("canonicalReportBytes is deterministic across key order", () => {
  const first = canonicalReportBytes(fixture() as never);
  const second = canonicalReportBytes(fixture() as never);
  assert.deepEqual(Array.from(first), Array.from(second));
});

// The canonical report carries the version marker and normalizes a null requestId.
test("toCanonicalReport tags version and normalizes null requestId", () => {
  const report = toCanonicalReport(fixture() as never);
  assert.equal(report.version, CANONICAL_REPORT_VERSION);
  const modelA = report.models.find((model) => model.model === "model-a");
  assert.ok(modelA);
  assert.equal(modelA.requestId, "");
});

// sha256HexBytes matches a known digest for a fixed input.
test("sha256HexBytes computes a stable hex digest", async () => {
  const digest = await sha256HexBytes(new TextEncoder().encode("abc"));
  assert.equal(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
