import assert from "node:assert/strict";
import { test } from "node:test";

import { decodeByteVectorJson, parseEventNode, REPORTS_INDEX_LIMITS } from "./reports-index.ts";

// vector<u8> may arrive as base64 or a numeric array; both decode to UTF-8.
test("decodeByteVectorJson decodes base64 and numeric arrays, rejects other shapes", () => {
  const base64 = Buffer.from("hello", "utf-8").toString("base64");
  assert.equal(decodeByteVectorJson(base64), "hello");
  assert.equal(decodeByteVectorJson([104, 105]), "hi");
  assert.equal(decodeByteVectorJson([256]), null);
  assert.equal(decodeByteVectorJson({}), null);
  assert.equal(decodeByteVectorJson(null), null);
  assert.equal(decodeByteVectorJson(42), null);
});

function nodeFor(overrides: Record<string, unknown> = {}, timestamp: string | null = "2026-09-05T09:00:00Z") {
  return {
    timestamp,
    contents: {
      json: {
        report_id: "0xabc123",
        claim: [104, 105],
        score_bps: 8500,
        verdict: Buffer.from("likely supported", "utf-8").toString("base64"),
        walrus_blob_id: Buffer.from("blob-id", "utf-8").toString("base64"),
        ...overrides,
      },
    },
  };
}

// A well-formed untrusted event node parses into a PublicReport.
test("parseEventNode accepts a well-formed node", () => {
  const parsed = parseEventNode(nodeFor());
  assert.ok(parsed);
  assert.equal(parsed.objectId, "0xabc123");
  assert.equal(parsed.claim, "hi");
  assert.equal(parsed.scoreBps, 8500);
  assert.equal(parsed.verdict, "likely supported");
  assert.equal(parsed.walrusBlobId, "blob-id");
  assert.equal(parsed.timestamp, "2026-09-05T09:00:00Z");
});

// Untrusted fields that are missing or malformed reject the whole node.
test("parseEventNode rejects malformed nodes", () => {
  assert.equal(parseEventNode(null), null);
  assert.equal(parseEventNode({}), null);
  assert.equal(parseEventNode(nodeFor({ report_id: "not-an-id" })), null);
  assert.equal(parseEventNode(nodeFor({ report_id: "0xGGGG" })), null);
  assert.equal(parseEventNode(nodeFor({ score_bps: 10_001 })), null);
  assert.equal(parseEventNode(nodeFor({ score_bps: -1 })), null);
  assert.equal(parseEventNode(nodeFor({ score_bps: "abc" })), null);
  assert.equal(parseEventNode(nodeFor({ claim: {} })), null);
  assert.equal(parseEventNode(nodeFor({ walrus_blob_id: 5 })), null);
});

// A missing timestamp is tolerated (null), not a rejection.
test("parseEventNode tolerates a missing timestamp", () => {
  const parsed = parseEventNode(nodeFor({}, null));
  assert.ok(parsed);
  assert.equal(parsed.timestamp, null);
});

// Decoded text is clamped defensively so an oversized claim cannot bloat the UI.
test("parseEventNode clamps oversized text", () => {
  const long = "x".repeat(REPORTS_INDEX_LIMITS.maxTextLength + 50);
  const parsed = parseEventNode(nodeFor({ claim: Array.from(Buffer.from(long, "utf-8")) }));
  assert.ok(parsed);
  assert.equal(parsed.claim.length, REPORTS_INDEX_LIMITS.maxTextLength);
});
