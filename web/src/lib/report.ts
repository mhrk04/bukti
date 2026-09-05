/**
 * Server-only reader for immutable Bukti V2/V3 receipts.
 *
 * Fetches a `TruthReportV2` or `TruthReportV3` object from Sui testnet via the installed SDK,
 * decodes its `vector<u8>` fields (the gRPC JSON view of a byte vector may be a
 * base64 string or a numeric array — both are handled), and exposes the fields
 * a report page needs to verify a Walrus snapshot against the on-chain digest.
 *
 * This module never trusts the object's shape; it validates the Move type and
 * each field, and returns a discriminated result instead of throwing.
 */

import { SuiGrpcClient } from "@mysten/sui/grpc";

const TESTNET_FULLNODE = "https://fullnode.testnet.sui.io:443";

export type V2Report = {
  objectId: string;
  /** Lowercase hex SHA-256 committed on-chain for the canonical snapshot. */
  resultDigestHex: string;
  /** Walrus blob ID (base64url string) of the canonical snapshot. */
  walrusBlobId: string;
  scoreBps: number;
  verdict: string;
  gonkaRequestIds: string;
  models: string;
};

export type V2ReportResult =
  | { kind: "ok"; report: V2Report }
  | { kind: "error"; reason: string };

/** Object IDs are 0x-prefixed 32-byte hex. Reject anything else early. */
export function isValidObjectId(objectId: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(objectId);
}

/** Decodes a gRPC JSON `vector<u8>` value into raw bytes. */
function decodeByteVector(value: unknown): Uint8Array | null {
  if (typeof value === "string") {
    // gRPC renders byte vectors as base64.
    try {
      return Uint8Array.from(Buffer.from(value, "base64"));
    } catch {
      return null;
    }
  }
  if (Array.isArray(value) && value.every((n) => typeof n === "number")) {
    return Uint8Array.from(value as number[]);
  }
  return null;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Fetches and validates an immutable V2/V3 report by object ID. `packageId` is
 * the published Bukti package used to confirm the object is a real receipt.
 */
export async function fetchV2Report(objectId: string, packageId?: string): Promise<V2ReportResult> {
  if (!isValidObjectId(objectId)) {
    return { kind: "error", reason: "Invalid Sui object ID" };
  }

  const client = new SuiGrpcClient({ network: "testnet", baseUrl: TESTNET_FULLNODE });

  let object;
  try {
    const response = await client.getObject({ objectId, include: { json: true } });
    object = response.object;
  } catch {
    return { kind: "error", reason: "Object not found on Sui testnet" };
  }

  if (
    !object ||
    (!object.type.endsWith("::reports::TruthReportV2") &&
      !object.type.endsWith("::reports::TruthReportV3"))
  ) {
    return { kind: "error", reason: "Object is not a Bukti V2 or V3 report" };
  }
  if (packageId && !object.type.startsWith(`${packageId}::`)) {
    return { kind: "error", reason: "Report was published by a different package" };
  }

  const fields = object.json;
  if (!fields || typeof fields !== "object") {
    return { kind: "error", reason: "Report object has no readable fields" };
  }

  const record = fields as Record<string, unknown>;
  const digestBytes = decodeByteVector(record.result_digest);
  const blobBytes = decodeByteVector(record.walrus_blob_id);
  const verdictBytes = decodeByteVector(record.verdict);
  const requestIdsBytes = decodeByteVector(record.gonka_request_ids);
  const modelsBytes = decodeByteVector(record.models);
  const scoreBps = Number(record.score_bps);

  if (!digestBytes || !blobBytes || !verdictBytes || !Number.isFinite(scoreBps)) {
    return { kind: "error", reason: "Report object is missing required fields" };
  }

  return {
    kind: "ok",
    report: {
      objectId,
      resultDigestHex: bytesToHex(digestBytes),
      walrusBlobId: bytesToUtf8(blobBytes),
      scoreBps,
      verdict: bytesToUtf8(verdictBytes),
      gonkaRequestIds: requestIdsBytes ? bytesToUtf8(requestIdsBytes) : "",
      models: modelsBytes ? bytesToUtf8(modelsBytes) : "",
    },
  };
}
