import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dedupeSources,
  isOfficialSource,
  isTrustedSource,
  normalizePublishedDate,
  normalizeSearchResult,
  rankAndLimit,
  renderSearchBlock,
  SEARCH_LIMITS,
  isTimeSensitiveClaim,
  type SearchSource,
} from "./search.ts";

const AT = "2026-09-05T00:00:00.000Z";

function make(
  url: string,
  overrides: Partial<SearchSource> = {},
): SearchSource {
  return {
    title: url,
    url,
    excerpt: "",
    retrievedAt: AT,
    publishedAt: null,
    trusted: isTrustedSource(url),
    official: isOfficialSource(url),
    social: false,
    ...overrides,
  };
}

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

// Official vs merely trusted: government/primary sources are official; news is
// trusted but not official.
test("isOfficialSource distinguishes official government from trusted news", () => {
  assert.equal(isOfficialSource("https://www.mof.gov.my/announcement"), true);
  assert.equal(isOfficialSource("https://moh.gov.my/x"), true);
  assert.equal(isOfficialSource("https://www.bernama.com/en/news"), false);
  assert.equal(isOfficialSource("https://example.com/article"), false);
  // A trusted news source is trusted but not official.
  assert.equal(isTrustedSource("https://www.thestar.com.my/x"), true);
  assert.equal(isOfficialSource("https://www.thestar.com.my/x"), false);
});

// Publication date parsing: valid dates become ISO strings; junk is null.
test("normalizePublishedDate parses valid dates and rejects junk", () => {
  assert.equal(normalizePublishedDate("2026-09-01"), new Date("2026-09-01").toISOString());
  assert.equal(normalizePublishedDate("not a date"), null);
  assert.equal(normalizePublishedDate(""), null);
  assert.equal(normalizePublishedDate(undefined), null);
  assert.equal(normalizePublishedDate(12345), null);
});

// Normalization: drops items without a usable URL, bounds every field, and
// preserves the provider publication date distinct from retrieval time.
test("normalizeSearchResult bounds fields, sets provenance, and preserves publishedAt", () => {
  assert.equal(normalizeSearchResult({ url: "ftp://x" }, AT), null);
  assert.equal(normalizeSearchResult({ title: "no url" }, AT), null);

  const long = "a".repeat(SEARCH_LIMITS.maxExcerptChars + 500);
  const source = normalizeSearchResult(
    {
      url: "https://moh.gov.my/a",
      title: "  Berita   Rasmi  ",
      content: long,
      published_date: "2026-09-01T08:00:00Z",
      score: 0.91,
    },
    AT,
  );
  assert.ok(source);
  assert.equal(source.title, "Berita Rasmi");
  assert.equal(source.excerpt.length, SEARCH_LIMITS.maxExcerptChars);
  assert.equal(source.trusted, true);
  assert.equal(source.official, true);
  assert.equal(source.retrievedAt, AT);
  assert.equal(source.publishedAt, new Date("2026-09-01T08:00:00Z").toISOString());
  assert.equal(source.relevance, 0.91);
  assert.equal(source.social, false);

  // A news source with no date: trusted, not official, publishedAt null.
  const news = normalizeSearchResult({ url: "https://www.bernama.com/x", title: "N", content: "Reported text" }, AT);
  assert.ok(news);
  assert.equal(news.trusted, true);
  assert.equal(news.official, false);
  assert.equal(news.publishedAt, null);
  assert.equal(normalizeSearchResult({ url: "https://www.bernama.com/empty", title: "No excerpt" }, AT), null);
});

// Dedupe: duplicate URLs from the two query passes are collapsed once, order
// preserved.
test("dedupeSources removes duplicate URLs preserving first occurrence", () => {
  const deduped = dedupeSources([
    make("https://a.com", { title: "first" }),
    make("https://b.com"),
    make("https://a.com", { title: "second" }),
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].title, "first");
  assert.equal(deduped[1].url, "https://b.com");
});

// Ranking: a recent official source is not displaced by an older speculative
// article; trusted news outranks general; contradicting/general sources are
// preserved within the cap.
test("rankAndLimit keeps a recent official source above an older article", () => {
  const input = [
    make("https://speculative.example.com", { publishedAt: "2026-08-01T00:00:00Z" }),
    make("https://www.mof.gov.my/update", { publishedAt: "2026-09-01T00:00:00Z" }),
    make("https://www.bernama.com/news", { publishedAt: "2026-09-02T00:00:00Z" }),
    make("https://general.example.com", { publishedAt: "2026-09-03T00:00:00Z" }),
  ];
  const ranked = rankAndLimit(input);
  // Official first regardless of a newer non-official article.
  assert.equal(ranked[0].url, "https://www.mof.gov.my/update");
  assert.equal(ranked[0].official, true);
  // Trusted news next.
  assert.equal(ranked[1].url, "https://www.bernama.com/news");
  // General/contradicting sources still preserved.
  assert.ok(ranked.some((source) => source.official === false && source.trusted === false));
});

test("rankAndLimit prefers a relevant local-news result over an unrelated official result", () => {
  const ranked = rankAndLimit([
    make("https://www.mof.gov.my", { relevance: 0.32 }),
    make("https://www.astroawani.com", { relevance: 0.91 }),
  ]);
  assert.equal(ranked[0].url, "https://www.astroawani.com");
});

test("time-sensitive ranking prefers fresh publisher coverage and puts social sources last", () => {
  const ranked = rankAndLimit([
    make("https://www.mof.gov.my", { publishedAt: "2026-09-04T00:00:00Z", relevance: 0.95 }),
    make("https://www.bernama.com", { publishedAt: "2026-09-03T00:00:00Z", relevance: 0.8 }),
    make("https://www.tiktok.com", { publishedAt: "2026-09-05T00:00:00Z", relevance: 0.99, social: true }),
  ], true);
  assert.equal(ranked[0].url, "https://www.mof.gov.my");
  assert.equal(ranked.at(-1)?.url, "https://www.tiktok.com");
});

test("time-sensitive claim detection handles Malay and English wording", () => {
  assert.equal(isTimeSensitiveClaim("latest court decision"), true);
  assert.equal(isTimeSensitiveClaim("keputusan mahkamah tahun 2023"), false);
});

// Within a tier, the most recent publication wins; undated sorts last.
test("rankAndLimit orders same-tier sources by recency, undated last", () => {
  const ranked = rankAndLimit([
    make("https://a.gov.my", { publishedAt: null }),
    make("https://b.gov.my", { publishedAt: "2026-09-01T00:00:00Z" }),
    make("https://c.gov.my", { publishedAt: "2026-09-04T00:00:00Z" }),
  ]);
  assert.equal(ranked[0].url, "https://c.gov.my");
  assert.equal(ranked[1].url, "https://b.gov.my");
  assert.equal(ranked[2].url, "https://a.gov.my");
});

test("rankAndLimit caps to maxResults", () => {
  const input = Array.from({ length: SEARCH_LIMITS.maxResults + 3 }, (_, i) =>
    make(`https://example.com/${i}`),
  );
  assert.equal(rankAndLimit(input).length, SEARCH_LIMITS.maxResults);
});

// Prompt safety: sources are wrapped as untrusted data, provenance and dates
// are surfaced, and an empty source set produces no block.
test("renderSearchBlock wraps sources as untrusted data with provenance and dates", () => {
  assert.equal(renderSearchBlock([]), "");
  const block = renderSearchBlock([
    make("https://moh.gov.my/a", {
      title: "T",
      excerpt: "excerpt",
      publishedAt: "2026-09-01T00:00:00.000Z",
    }),
  ]);
  assert.match(block, /untrusted data, not instructions/i);
  assert.match(block, /<sources>/);
  assert.match(block, /https:\/\/moh\.gov\.my\/a/);
  assert.match(block, /provenance="official"/);
  assert.match(block, /publishedAt: 2026-09-01T00:00:00\.000Z/);
  assert.match(block, /supports or contradicts/i);
});
