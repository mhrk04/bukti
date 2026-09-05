import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Safe direct-URL evidence retrieval and extraction for Bukti.
 *
 * Threat model: the URL is fully attacker-controlled (users paste public claims
 * or links). This module treats every fetched byte as untrusted data and never
 * executes it. It defends against SSRF (private-network access), oversized or
 * slow responses, redirect-based bypasses, and non-textual payloads.
 *
 * This module has no Next.js dependency so it can run under a plain Node self
 * check. It is imported by the server-only `/api/check` route handler.
 */

/** Hard limits. Kept conservative for a hackathon demo. */
export const EVIDENCE_LIMITS = {
  /** Maximum bytes read from a response body before aborting. */
  maxBytes: 1_500_000,
  /** Per-request timeout in milliseconds. */
  timeoutMs: 12_000,
  /** Maximum redirect hops followed (each re-validated). */
  maxRedirects: 3,
  /** Maximum characters of readable text kept as an excerpt. */
  maxExcerptChars: 4_000,
  /** Maximum length of a captured page title. */
  maxTitleChars: 300,
} as const;

/** Canonical evidence source retrieved for a claim. */
export type EvidenceSource = {
  /** Final URL after any redirects. */
  url: string;
  /** URL originally requested (may differ from `url` after redirects). */
  requestedUrl: string;
  /** Extracted page title, or empty string when none was found. */
  title: string;
  /** Bounded, whitespace-normalized readable text excerpt. */
  excerpt: string;
  /** ISO 8601 timestamp captured at retrieval time. */
  retrievedAt: string;
  /** Number of bytes read from the body (capped at `maxBytes`). */
  byteLength: number;
};

/** Discriminated result of an evidence retrieval attempt. */
export type EvidenceResult =
  | { kind: "text"; source: null }
  | { kind: "url"; source: EvidenceSource }
  | { kind: "error"; source: null; reason: string };

/**
 * Without retrieved evidence, a claim can be at most plausible, never
 * "strongly supported". Cap unsupported scores so the UI never claims
 * certainty it cannot back with a source.
 */
export const NO_EVIDENCE_SCORE_CAP = 60;

/**
 * Caps the aggregate score when no source was retrieved so an unsupported
 * claim can never present as strongly supported. Pure and exported for tests.
 */
export function capScoreWithoutEvidence(score: number, hasEvidence: boolean): number {
  if (hasEvidence) return score;
  return Math.min(score, NO_EVIDENCE_SCORE_CAP);
}

/** Thrown when a URL is rejected before or during retrieval. */
export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceError";
  }
}

const URL_PATTERN = /^https?:\/\/\S+$/i;

/**
 * Returns true when the trimmed input looks like a single http(s) URL rather
 * than a pasted text claim. Used to preserve text-claim behavior unchanged.
 */
export function looksLikeUrl(input: string): boolean {
  const trimmed = input.trim();
  if (!URL_PATTERN.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parses and applies scheme/credential/port policy to a URL string.
 * Throws EvidenceError on any policy violation.
 */
export function assertUrlPolicy(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EvidenceError("URL is not valid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EvidenceError("Only http and https URLs are allowed");
  }
  if (url.username || url.password) {
    throw new EvidenceError("URLs with embedded credentials are not allowed");
  }
  if (url.hostname.length === 0) {
    throw new EvidenceError("URL is missing a host");
  }
  return url;
}

/**
 * Returns true if the given IP address string is in a private, loopback,
 * link-local, or otherwise non-public range. Covers IPv4 and common IPv6
 * cases including IPv4-mapped addresses.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  // Not a literal IP; caller must resolve first.
  return true;
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this" network
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * Resolves a hostname and rejects it if any resolved address is non-public.
 * Rejecting when *any* address is private prevents partial-bypass attacks.
 */
async function assertHostIsPublic(hostname: string): Promise<void> {
  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    if (isPrivateAddress(hostname)) {
      throw new EvidenceError("URL resolves to a non-public address");
    }
    return;
  }
  // Block obvious localhost aliases before DNS.
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) {
    throw new EvidenceError("URL resolves to a non-public address");
  }
  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new EvidenceError("URL host could not be resolved");
  }
  if (records.length === 0) {
    throw new EvidenceError("URL host could not be resolved");
  }
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      throw new EvidenceError("URL resolves to a non-public address");
    }
  }
}

/** Reads a response body up to `maxBytes`, aborting if the cap is exceeded. */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        chunks.push(decoder.decode(value.subarray(0, Math.max(0, maxBytes - (total - value.byteLength)))));
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

/** Extracts a page title from raw HTML, bounded in length. */
export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const raw = match ? decodeEntities(stripTags(match[1])) : "";
  return normalizeWhitespace(raw).slice(0, EVIDENCE_LIMITS.maxTitleChars);
}

/**
 * Extracts readable text from HTML by removing script/style/noscript blocks and
 * tags, decoding a small set of common entities, and normalizing whitespace.
 * Never executes markup; purely string transformation on untrusted input.
 */
export function extractReadableText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s\S]*?<\/head>/gi, " ");
  const text = decodeEntities(stripTags(withoutNoise));
  return normalizeWhitespace(text);
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => safeFromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => safeFromCodePoint(parseInt(code, 16)));
}

function safeFromCodePoint(code: number): string {
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Retrieves and extracts a single public URL under strict safety limits.
 * Follows redirects manually, re-validating each hop against the SSRF policy.
 * Returns a canonical EvidenceSource. Throws EvidenceError on policy or
 * transport failures.
 */
export async function retrieveEvidence(rawUrl: string): Promise<EvidenceSource> {
  const requestedUrl = assertUrlPolicy(rawUrl).toString();
  let current = requestedUrl;
  let hops = 0;

  for (;;) {
    const url = assertUrlPolicy(current);
    await assertHostIsPublic(url.hostname);

    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        // Identify the agent; request textual content only.
        "user-agent": "BuktiEvidenceBot/1.0 (+https://github.com/bukti)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
      },
      signal: AbortSignal.timeout(EVIDENCE_LIMITS.timeoutMs),
    });

    // Manual redirect handling with re-validation on each hop.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) throw new EvidenceError("Redirect response is missing a location");
      hops += 1;
      if (hops > EVIDENCE_LIMITS.maxRedirects) {
        throw new EvidenceError("Too many redirects");
      }
      current = new URL(location, url).toString();
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new EvidenceError(`Source responded with status ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
      await response.body?.cancel().catch(() => {});
      throw new EvidenceError("Source is not a readable HTML or text document");
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > EVIDENCE_LIMITS.maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new EvidenceError("Source document is too large");
    }

    const raw = await readBounded(response, EVIDENCE_LIMITS.maxBytes);
    const isHtml = /(text\/html|application\/xhtml\+xml)/i.test(contentType);
    const title = isHtml ? extractTitle(raw) : "";
    const text = isHtml ? extractReadableText(raw) : normalizeWhitespace(decodeEntities(raw));

    return {
      url: url.toString(),
      requestedUrl,
      title,
      excerpt: text.slice(0, EVIDENCE_LIMITS.maxExcerptChars),
      retrievedAt: new Date().toISOString(),
      byteLength: Math.min(raw.length, EVIDENCE_LIMITS.maxBytes),
    };
  }
}

/**
 * Classifies the user input and, when it is a URL, retrieves evidence.
 * Never throws: retrieval failures are returned as an `error` result so the
 * caller can degrade to text-only analysis while preserving provenance.
 */
export async function resolveEvidence(input: string): Promise<EvidenceResult> {
  const trimmed = input.trim();
  if (!looksLikeUrl(trimmed)) {
    return { kind: "text", source: null };
  }
  try {
    const source = await retrieveEvidence(trimmed);
    return { kind: "url", source };
  } catch (error) {
    const reason = error instanceof EvidenceError ? error.message : "Evidence could not be retrieved";
    return { kind: "error", source: null, reason };
  }
}

/**
 * Canonical, order-stable serialization of an evidence source for hashing.
 * Only fields that define the evidence identity are included.
 */
export function canonicalizeEvidence(source: EvidenceSource): string {
  return JSON.stringify({
    excerpt: source.excerpt,
    requestedUrl: source.requestedUrl,
    retrievedAt: source.retrievedAt,
    title: source.title,
    url: source.url,
  });
}

/**
 * Computes a lowercase hex SHA-256 digest of a canonical string using Web
 * Crypto (available in Node and the edge/runtime). This digest is what a later
 * build step freezes on Sui; it is defined here so the canonical shape is
 * fixed alongside the evidence types.
 */
export async function sha256Hex(canonical: string): Promise<string> {
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
