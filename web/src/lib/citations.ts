/**
 * Bounded, structured model citations for Bukti.
 *
 * A model returns an `evidence` array of citation objects. This module parses
 * that untrusted output and strictly validates it against the set of source
 * URLs Bukti actually supplied, so a model can never introduce unverifiable
 * links or unbounded text into a receipt.
 *
 * Pure and free of Next.js/path-alias imports so it can run under a plain Node
 * self check. Imported by the server-only Gonka path.
 */

/** Whether a citation supports or contradicts the claim, per the model. */
export type CitationStance = "supports" | "contradicts";

/**
 * A bounded, structured citation a model made against a supplied source. The
 * URL is validated against the supplied sources; the quote is a bounded
 * verbatim passage; the stance says whether the source supports or contradicts
 * the claim.
 */
export type Citation = {
  url: string;
  quote: string;
  stance: CitationStance;
};

/** Maximum characters kept from a model-supplied citation quote. */
export const MAX_CITATION_QUOTE_CHARS = 500;
/** Maximum number of citations kept per model, to keep receipts bounded. */
export const MAX_CITATIONS_PER_MODEL = 6;

/** A citation as parsed from model output, before source validation. */
export type RawCitation = { url: string; quote: string; stance: CitationStance };

/** Normalizes a model-supplied stance into "supports" or "contradicts". */
export function parseStance(value: unknown): CitationStance {
  if (typeof value === "boolean") return value ? "supports" : "contradicts";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (/^(contradict|contradicts|refute|refutes|against|no|false)/.test(normalized)) {
      return "contradicts";
    }
  }
  // Default to "supports" when unspecified; the caller strictly validates the
  // URL against supplied sources before keeping the citation.
  return "supports";
}

/**
 * Parses a model's `evidence` array into loosely-typed raw citations. Skips
 * malformed entries. Accepts a `stance`/`supports`/`support` field so a model
 * that phrases the field differently still yields a usable stance.
 */
export function parseRawCitations(input: unknown): RawCitation[] {
  if (!Array.isArray(input)) return [];
  const out: RawCitation[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === "string" ? record.url.trim() : "";
    const quote = typeof record.quote === "string" ? record.quote.trim() : "";
    if (!url) continue;
    const stance = parseStance(record.stance ?? record.supports ?? record.support);
    out.push({ url, quote, stance });
  }
  return out;
}

/**
 * Strictly validates raw citations against the set of source URLs Bukti
 * actually supplied. A citation survives only when its URL is one of the
 * supplied sources; its quote is bounded; duplicates are dropped; and the list
 * is capped. Pure.
 */
export function validateCitations(
  raw: RawCitation[],
  suppliedExcerpts: ReadonlyMap<string, string>,
): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const citation of raw) {
    const suppliedExcerpt = suppliedExcerpts.get(citation.url);
    if (!suppliedExcerpt || !citation.quote) continue;
    const normalizedQuote = citation.quote.replace(/\s+/g, " ").trim();
    const normalizedExcerpt = suppliedExcerpt.replace(/\s+/g, " ").trim();
    // Models must cite an actual passage supplied by Bukti, not a paraphrase
    // or invented quotation. This keeps the receipt independently auditable.
    if (!normalizedExcerpt.includes(normalizedQuote)) continue;
    if (seen.has(citation.url)) continue;
    seen.add(citation.url);
    out.push({
      url: citation.url,
      quote: normalizedQuote.slice(0, MAX_CITATION_QUOTE_CHARS),
      stance: citation.stance,
    });
    if (out.length >= MAX_CITATIONS_PER_MODEL) break;
  }
  return out;
}
