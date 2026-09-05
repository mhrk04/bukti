import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_CITATION_QUOTE_CHARS,
  MAX_CITATIONS_PER_MODEL,
  parseRawCitations,
  parseStance,
  validateCitations,
} from "./citations.ts";

// Stance parsing: booleans, explicit strings, and defaults.
test("parseStance normalizes model-supplied stance", () => {
  assert.equal(parseStance(true), "supports");
  assert.equal(parseStance(false), "contradicts");
  assert.equal(parseStance("contradicts"), "contradicts");
  assert.equal(parseStance("refutes the claim"), "contradicts");
  assert.equal(parseStance("supports"), "supports");
  assert.equal(parseStance(undefined), "supports");
  assert.equal(parseStance("unclear"), "supports");
});

// Raw parsing: objects with url/quote/stance; malformed entries skipped.
test("parseRawCitations parses objects and skips malformed entries", () => {
  const raw = parseRawCitations([
    { url: "https://moh.gov.my/a", quote: "official statement", stance: "supports" },
    { url: "https://x.com/b", quote: "rumor", supports: false },
    { quote: "no url" },
    "not an object",
    { url: "  https://y.com/c  ", quote: "  spaced  " },
  ]);
  assert.equal(raw.length, 3);
  assert.equal(raw[0].stance, "supports");
  assert.equal(raw[1].stance, "contradicts");
  assert.equal(raw[2].url, "https://y.com/c");
  assert.equal(raw[2].quote, "spaced");
  // Non-array input yields no citations.
  assert.deepEqual(parseRawCitations("nope"), []);
  assert.deepEqual(parseRawCitations(null), []);
});

// Strict validation: only supplied URLs survive; quotes are bounded; duplicates
// dropped; list capped.
test("validateCitations keeps only supplied quotes and bounds them", () => {
  const allowed = new Map([
    ["https://moh.gov.my/a", "official statement confirms the quota"],
    ["https://www.bernama.com/b", "news reports no final decision"],
  ]);
  const citations = validateCitations(
    [
      { url: "https://moh.gov.my/a", quote: "official statement", stance: "supports" },
      { url: "https://evil.example.com/x", quote: "injected", stance: "supports" },
      { url: "https://www.bernama.com/b", quote: "news reports", stance: "contradicts" },
      { url: "https://moh.gov.my/a", quote: "dup", stance: "supports" },
      { url: "https://moh.gov.my/a", quote: "invented quote", stance: "supports" },
    ],
    allowed,
  );
  assert.equal(citations.length, 2);
  // Unverifiable URL is dropped.
  assert.ok(!citations.some((c) => c.url === "https://evil.example.com/x"));
  // Only passages from supplied excerpts survive.
  assert.equal(citations[0].quote, "official statement");
  // Stance preserved.
  assert.equal(citations[1].stance, "contradicts");
});

test("validateCitations caps citations per model", () => {
  const urls = Array.from({ length: MAX_CITATIONS_PER_MODEL + 3 }, (_, i) => `https://example.com/${i}`);
  const allowed = new Map(urls.map((url) => [url, "q"]));
  const raw = urls.map((url) => ({ url, quote: "q", stance: "supports" as const }));
  assert.equal(validateCitations(raw, allowed).length, MAX_CITATIONS_PER_MODEL);
});
