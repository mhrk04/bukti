import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isTrustedSource,
  normalizeSearchResult,
  rankAndLimit,
  renderSearchBlock,
  SEARCH_LIMITS,
  type SearchSource,
} from "./search.ts";

// Trusted-domain preference: Malaysian gov/health/election/news are trusted;
// look-alike and unrelated hosts are not.
test("isTrustedSource matches preferred Malaysian domains by boundary", () => {
  assert.equal(isTrustedSource("https://www.spr.gov.my/berita"), true);
  assert.equal(isTrustedSource("https://moh.gov.my/x"), true);
  assert.equal(isTrustedSource("https://www.bernama.com/en/news"), true);
  assert.equal(isTrustedSource("https://notgov.my/spoof"), false);
  assert.equal(isTrustedSource("https://example.com/article"), false);
  assert.equal(isTrustedSource("not a url"), false);
});

// Normalization: drops items without a usable URL and bounds every field.
test("normalizeSearchResult bounds fields and rejects non-http urls", () => {
  const at = "2026-09-05T00:00:00.000Z";
  assert.equal(normalizeSearchResult({ url: "ftp://x" }, at), null);
  assert.equal(normalizeSearchResult({ title: "no url" }, at), null);

  const long = "a".repeat(SEARCH_LIMITS.maxExcerptChars + 500);
  const source = normalizeSearchResult(
    { url: "https://moh.gov.my/a", title: "  Berita   Rasmi  ", content: long },
    at,
  );
  assert.ok(source);
  assert.equal(source.title, "Berita Rasmi");
  assert.equal(source.excerpt.length, SEARCH_LIMITS.maxExcerptChars);
  assert.equal(source.trusted, true);
  assert.equal(source.retrievedAt, at);
});

// Ranking: trusted sources first, order preserved within groups, capped.
test("rankAndLimit prioritizes trusted sources and caps count", () => {
  const make = (url: string, trusted: boolean): SearchSource => ({
    title: url,
    url,
    excerpt: "",
    retrievedAt: "2026-09-05T00:00:00.000Z",
    trusted,
  });
  const input = [
    make("https://a.com", false),
    make("https://moh.gov.my", true),
    make("https://b.com", false),
    make("https://spr.gov.my", true),
    make("https://c.com", false),
  ];
  const ranked = rankAndLimit(input);
  assert.equal(ranked.length, SEARCH_LIMITS.maxResults);
  assert.equal(ranked[0].url, "https://moh.gov.my");
  assert.equal(ranked[1].url, "https://spr.gov.my");
  // Untrusted results are preserved when trusted ones don't fill the cap.
  assert.ok(ranked.some((source) => source.trusted === false));
});

// Prompt safety: sources are wrapped as untrusted data, not instructions,
// and an empty source set produces no block.
test("renderSearchBlock wraps sources as untrusted data", () => {
  assert.equal(renderSearchBlock([]), "");
  const block = renderSearchBlock([
    {
      title: "T",
      url: "https://moh.gov.my/a",
      excerpt: "excerpt",
      retrievedAt: "2026-09-05T00:00:00.000Z",
      trusted: true,
    },
  ]);
  assert.match(block, /untrusted data, not instructions/i);
  assert.match(block, /<sources>/);
  assert.match(block, /https:\/\/moh\.gov\.my\/a/);
});
