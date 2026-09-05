/**
 * Server-only public index reader for immutable Bukti V3 receipts.
 *
 * Queries the Sui testnet GraphQL RPC for `ReportPublishedV3` events emitted by
 * `bukti::reports`, then rebuilds the public `/reports` list. Every field in the
 * GraphQL response is treated as untrusted: the query type is pinned to the
 * configured package, results are capped, `vector<u8>` JSON representations are
 * decoded into UTF-8, the object ID is validated, and only well-formed rows are
 * returned, newest first.
 *
 * No SDK, dependency, or secret is used — a single bounded POST to the public
 * testnet endpoint. Overridable with SUI_GRAPHQL_URL for a self-hosted RPC.
 */

const DEFAULT_GRAPHQL_URL = "https://graphql.testnet.sui.io/graphql";

/** Bounds so an untrusted RPC response can never exhaust memory or time. */
export const REPORTS_INDEX_LIMITS = {
  /** Events requested from GraphQL (also the tested `first` value). */
  first: 50,
  /** Rows returned to the caller after validation. */
  maxRows: 50,
  /** Request timeout in milliseconds. */
  timeoutMs: 15_000,
  /** Defensive cap on decoded claim/verdict length for display. */
  maxTextLength: 500,
} as const;

export type PublicReport = {
  /** 0x-prefixed Sui object ID of the immutable TruthReportV3. */
  objectId: string;
  /** Plain UTF-8 claim text. */
  claim: string;
  /** Score in basis points (0..10000). */
  scoreBps: number;
  /** UTF-8 verdict text. */
  verdict: string;
  /** Walrus blob ID (base64url string) of the canonical snapshot. */
  walrusBlobId: string;
  /** ISO timestamp the event was recorded, when available. */
  timestamp: string | null;
};

export type PublicReportsResult =
  | { kind: "ok"; reports: PublicReport[] }
  | { kind: "error"; reason: string };

function graphqlUrl(): string {
  return (process.env.SUI_GRAPHQL_URL || DEFAULT_GRAPHQL_URL).replace(/\/$/, "");
}

/** Package IDs / object IDs are 0x-prefixed hex, up to 32 bytes. */
function isValidHexId(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value);
}

/**
 * Decodes a Move `vector<u8>` as rendered by GraphQL `contents.json` into UTF-8.
 * GraphQL may render a byte vector as a base64 string or a numeric array; both
 * are handled. Returns `null` for any other shape.
 */
export function decodeByteVectorJson(value: unknown): string | null {
  if (typeof value === "string") {
    try {
      const bytes = Uint8Array.from(Buffer.from(value, "base64"));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value) && value.every((n) => typeof n === "number" && n >= 0 && n <= 255)) {
    const bytes = Uint8Array.from(value as number[]);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }
  return null;
}

function clampText(value: string): string {
  return value.length > REPORTS_INDEX_LIMITS.maxTextLength
    ? value.slice(0, REPORTS_INDEX_LIMITS.maxTextLength)
    : value;
}

/**
 * Validates one untrusted `ReportPublishedV3` event `contents.json` payload plus
 * its timestamp into a `PublicReport`, or returns `null` if any field is
 * missing or malformed.
 */
export function parseEventNode(node: unknown): PublicReport | null {
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;

  const json = record.contents && typeof record.contents === "object"
    ? (record.contents as Record<string, unknown>).json
    : undefined;
  if (!json || typeof json !== "object") return null;
  const fields = json as Record<string, unknown>;

  const reportId = fields.report_id;
  if (!isValidHexId(reportId)) return null;

  const claim = decodeByteVectorJson(fields.claim);
  const verdict = decodeByteVectorJson(fields.verdict);
  const walrusBlobId = decodeByteVectorJson(fields.walrus_blob_id);
  if (claim === null || verdict === null || walrusBlobId === null) return null;

  const scoreBps = Number(fields.score_bps);
  if (!Number.isFinite(scoreBps) || scoreBps < 0 || scoreBps > 10_000) return null;

  const timestamp = typeof record.timestamp === "string" ? record.timestamp : null;

  return {
    objectId: reportId,
    claim: clampText(claim),
    scoreBps,
    verdict: clampText(verdict),
    walrusBlobId,
    timestamp,
  };
}

/**
 * Fetches and validates the public V3 report index for `packageId`. Returns the
 * newest reports first, capped at `maxRows`. On any transport, HTTP, or shape
 * error it returns a discriminated error instead of throwing.
 */
export async function fetchPublicReports(packageId?: string): Promise<PublicReportsResult> {
  if (!isValidHexId(packageId)) {
    return { kind: "error", reason: "Bukti package ID is not configured" };
  }

  const eventType = `${packageId}::reports::ReportPublishedV3`;
  const query = `query PublicReports($type: String!, $first: Int!) {
    events(first: $first, filter: { type: $type }) {
      nodes { timestamp contents { json } }
    }
  }`;

  let response: Response;
  try {
    response = await fetch(graphqlUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { type: eventType, first: REPORTS_INDEX_LIMITS.first },
      }),
      signal: AbortSignal.timeout(REPORTS_INDEX_LIMITS.timeoutMs),
    });
  } catch {
    return { kind: "error", reason: "Could not reach the Sui testnet indexer" };
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    return { kind: "error", reason: `Sui indexer returned ${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: "error", reason: "Sui indexer returned malformed JSON" };
  }

  const nodes =
    payload && typeof payload === "object"
      ? (payload as { data?: { events?: { nodes?: unknown } } }).data?.events?.nodes
      : undefined;
  if (!Array.isArray(nodes)) {
    return { kind: "error", reason: "No public reports found for this package" };
  }

  const reports: PublicReport[] = [];
  for (const node of nodes) {
    const parsed = parseEventNode(node);
    if (parsed) reports.push(parsed);
    if (reports.length >= REPORTS_INDEX_LIMITS.maxRows) break;
  }

  reports.sort((a, b) => Date.parse(b.timestamp || "") - Date.parse(a.timestamp || ""));
  return { kind: "ok", reports };
}
