import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertUrlPolicy,
  canonicalizeEvidence,
  capScoreWithoutEvidence,
  EvidenceError,
  extractReadableText,
  extractTitle,
  isPrivateAddress,
  isSocialPostUrl,
  looksLikeUrl,
  sha256Hex,
  type EvidenceSource,
} from "./evidence.ts";

// URL classification: preserve text-claim behavior, detect URLs.
test("looksLikeUrl distinguishes URLs from text claims", () => {
  assert.equal(looksLikeUrl("https://example.com/article"), true);
  assert.equal(looksLikeUrl("http://example.com"), true);
  assert.equal(looksLikeUrl("Malaysia will introduce a four-day work week."), false);
  assert.equal(looksLikeUrl("check https://example.com now"), false);
  assert.equal(looksLikeUrl("ftp://example.com"), false);
});

test("isSocialPostUrl recognizes public X/Twitter status URLs", () => {
  assert.equal(isSocialPostUrl("https://x.com/user/status/123456"), true);
  assert.equal(isSocialPostUrl("https://twitter.com/user/status/123456"), true);
  assert.equal(isSocialPostUrl("https://x.com/user/photo/123456"), false);
  assert.equal(isSocialPostUrl("https://example.com/status/123456"), false);
});

// URL policy: reject non-http(s) schemes and embedded credentials.
test("assertUrlPolicy rejects unsafe URLs", () => {
  assert.throws(() => assertUrlPolicy("file:///etc/passwd"), EvidenceError);
  assert.throws(() => assertUrlPolicy("javascript:alert(1)"), EvidenceError);
  assert.throws(() => assertUrlPolicy("https://user:pass@example.com"), EvidenceError);
  assert.doesNotThrow(() => assertUrlPolicy("https://example.com/path?q=1"));
});

// SSRF: private/loopback/link-local addresses are rejected.
test("isPrivateAddress blocks non-public ranges", () => {
  for (const addr of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.16.0.1", "169.254.1.1", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateAddress(addr), true, `${addr} should be private`);
  }
  for (const addr of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateAddress(addr), false, `${addr} should be public`);
  }
});

// Extraction: strips scripts/tags, does not execute markup.
test("extraction produces bounded readable text and title", () => {
  const html = `<html><head><title>Berita &amp; Fakta</title></head>
    <body><script>steal()</script><p>Kerajaan Malaysia mengumumkan dasar baharu.</p>
    <style>.x{}</style></body></html>`;
  assert.equal(extractTitle(html), "Berita & Fakta");
  const text = extractReadableText(html);
  assert.ok(text.includes("Kerajaan Malaysia mengumumkan dasar baharu."));
  assert.ok(!text.includes("steal()"));
  assert.ok(!text.includes(".x{}"));
});

// Canonical hashing: stable, deterministic digest.
test("canonicalizeEvidence and sha256Hex are deterministic", async () => {
  const source: EvidenceSource = {
    url: "https://example.com/a",
    requestedUrl: "https://example.com/a",
    title: "Title",
    excerpt: "Some excerpt text.",
    retrievedAt: "2026-09-05T00:00:00.000Z",
    byteLength: 42,
  };
  const canonical = canonicalizeEvidence(source);
  const first = await sha256Hex(canonical);
  const second = await sha256Hex(canonicalizeEvidence(source));
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
  // Changing any identity field changes the digest.
  const mutated = await sha256Hex(canonicalizeEvidence({ ...source, excerpt: "different" }));
  assert.notEqual(first, mutated);
});

// Evidence-required score cap: no source caps the score; a source does not.
test("capScoreWithoutEvidence caps only when evidence is absent", () => {
  assert.equal(capScoreWithoutEvidence(95, false), 60);
  assert.equal(capScoreWithoutEvidence(40, false), 40);
  assert.equal(capScoreWithoutEvidence(95, true), 95);
});
