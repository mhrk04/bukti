/**
 * Shared canonical-report serialization for Bukti V2 receipts.
 *
 * A `ClaimCheck` is turned into *deterministic* JSON bytes. The exact same bytes
 * are produced in the browser (before publishing) and on the server (when
 * uploading to Walrus and when re-verifying a report page), so a SHA-256 of
 * these bytes is stable across environments.
 *
 * Determinism requirements:
 * - Object keys are always emitted in a fixed order (never rely on insertion
 *   order or `Object.keys` locale).
 * - Only fields that define the receipt's meaning are included; volatile or
 *   client-derived display fields are excluded.
 * - No whitespace, no locale-dependent number formatting.
 *
 * This module has no Next.js or path-alias runtime dependency beyond the
 * `ClaimCheck` type, so it can run under a plain Node self check and in the
 * browser. It never trusts its input to be well-ordered.
 */

import type { ClaimCheck } from "@/lib/gonka";

/** Version tag frozen into every canonical report, so future shape changes are detectable. */
export const CANONICAL_REPORT_VERSION = 1 as const;

/** Hard bound on the canonical JSON payload accepted by the publish route (bytes). */
export const MAX_CANONICAL_REPORT_BYTES = 200_000;

/**
 * The stable, minimal shape stored on Walrus and rendered by the report page.
 * Keys here are emitted in declaration order by `canonicalStringify` below.
 */
export type CanonicalReport = {
  version: typeof CANONICAL_REPORT_VERSION;
  claim: string;
  aggregateScore: number;
  aggregateVerdict: string;
  disagreement: number;
  models: CanonicalModel[];
  evidence: CanonicalEvidence | null;
  sources: CanonicalSource[];
  warnings: string[];
};

export type CanonicalModel = {
  model: string;
  requestId: string;
  score: number;
  verdict: string;
  reasoning: string;
  citations: CanonicalCitation[];
};

export type CanonicalCitation = {
  url: string;
  quote: string;
  stance: string;
};

export type CanonicalEvidence = {
  url: string;
  requestedUrl: string;
  title: string;
  excerpt: string;
  retrievedAt: string;
  digest: string;
};

export type CanonicalSource = {
  title: string;
  url: string;
  excerpt: string;
  retrievedAt: string;
  publishedAt: string | null;
  trusted: boolean;
  official: boolean;
};

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

/** Validates the exact data shape accepted by the server-side Walrus publisher. */
export function isCanonicalReport(value: unknown): value is CanonicalReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Record<string, unknown>;
  if (
    report.version !== CANONICAL_REPORT_VERSION ||
    !boundedString(report.claim, 4_000) ||
    typeof report.aggregateScore !== "number" ||
    !Number.isInteger(report.aggregateScore) ||
    report.aggregateScore < 0 ||
    report.aggregateScore > 100 ||
    !boundedString(report.aggregateVerdict, 100) ||
    typeof report.disagreement !== "number" ||
    !Number.isInteger(report.disagreement) ||
    report.disagreement < 0 ||
    report.disagreement > 100 ||
    !Array.isArray(report.models) ||
    report.models.length > 10 ||
    !Array.isArray(report.sources) ||
    report.sources.length > 4 ||
    !Array.isArray(report.warnings) ||
    report.warnings.length > 20
  ) return false;

  const modelsValid = report.models.every((value) => {
    if (!value || typeof value !== "object") return false;
    const model = value as Record<string, unknown>;
    return (
      boundedString(model.model, 200) &&
      boundedString(model.requestId, 200) &&
      typeof model.score === "number" &&
      Number.isInteger(model.score) &&
      model.score >= 0 &&
      model.score <= 100 &&
      boundedString(model.verdict, 100) &&
      boundedString(model.reasoning, 4_000) &&
      Array.isArray(model.citations) &&
      model.citations.length <= 10 &&
      model.citations.every((citation) => {
        if (!citation || typeof citation !== "object") return false;
        const item = citation as Record<string, unknown>;
        return boundedString(item.url, 2_000) && boundedString(item.quote, 500) && boundedString(item.stance, 20);
      })
    );
  });

  const evidenceValid = report.evidence === null || (
    typeof report.evidence === "object" &&
    boundedString((report.evidence as Record<string, unknown>).url, 2_000) &&
    boundedString((report.evidence as Record<string, unknown>).requestedUrl, 2_000) &&
    boundedString((report.evidence as Record<string, unknown>).title, 300) &&
    boundedString((report.evidence as Record<string, unknown>).excerpt, 4_000) &&
    boundedString((report.evidence as Record<string, unknown>).retrievedAt, 100) &&
    boundedString((report.evidence as Record<string, unknown>).digest, 128)
  );

  const sourcesValid = report.sources.every((value) => {
    if (!value || typeof value !== "object") return false;
    const source = value as Record<string, unknown>;
    return (
      boundedString(source.title, 300) &&
      boundedString(source.url, 2_000) &&
      boundedString(source.excerpt, 1_200) &&
      boundedString(source.retrievedAt, 100) &&
      (source.publishedAt === null || boundedString(source.publishedAt, 100)) &&
      typeof source.trusted === "boolean" &&
      typeof source.official === "boolean"
    );
  });

  return modelsValid && evidenceValid && sourcesValid && report.warnings.every((warning) => boundedString(warning, 500));
}

/**
 * Deterministic JSON serializer. Emits object keys in sorted order recursively,
 * with no extra whitespace, so the same value always yields identical bytes.
 * Rejects non-finite numbers so a receipt can never encode NaN/Infinity.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error("Canonical report cannot contain a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (kind === "boolean" || kind === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  if (kind === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`,
    );
    return `{${entries.join(",")}}`;
  }
  // undefined, function, symbol, bigint: not representable in a canonical report.
  throw new Error(`Canonical report cannot contain a ${kind} value`);
}

/** Projects a full `ClaimCheck` onto the stable canonical report shape. */
export function toCanonicalReport(result: ClaimCheck): CanonicalReport {
  return {
    version: CANONICAL_REPORT_VERSION,
    claim: result.claim,
    aggregateScore: result.aggregateScore,
    aggregateVerdict: result.aggregateVerdict,
    disagreement: result.disagreement,
    models: result.results.map((item) => ({
      model: item.model,
      requestId: item.requestId ?? "",
      score: item.score,
      verdict: item.verdict,
      reasoning: item.reasoning,
      citations: item.evidence.map((citation) => ({
        url: citation.url,
        quote: citation.quote,
        stance: citation.stance,
      })),
    })),
    evidence: result.evidence
      ? {
          url: result.evidence.url,
          requestedUrl: result.evidence.requestedUrl,
          title: result.evidence.title,
          excerpt: result.evidence.excerpt,
          retrievedAt: result.evidence.retrievedAt,
          digest: result.evidence.digest,
        }
      : null,
    sources: result.sources.map((source) => ({
      title: source.title,
      url: source.url,
      excerpt: source.excerpt,
      retrievedAt: source.retrievedAt,
      publishedAt: source.publishedAt,
      trusted: source.trusted,
      official: source.official,
    })),
    warnings: result.warnings,
  };
}

/**
 * Produces the exact canonical bytes for a `ClaimCheck`. Both the browser and
 * the server call this so the SHA-256 of the returned bytes is identical.
 */
export function canonicalReportBytes(result: ClaimCheck): Uint8Array {
  return new TextEncoder().encode(canonicalStringify(toCanonicalReport(result)));
}

/** Lowercase hex SHA-256 of arbitrary bytes, via Web Crypto (Node + browser). */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
