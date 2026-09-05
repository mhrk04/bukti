import { NextResponse } from "next/server";
import { MAX_CANONICAL_REPORT_BYTES, sha256HexBytes } from "@/lib/canonical-report";
import { readBlob, storePermanentBlob, WalrusError } from "@/lib/walrus";

export const runtime = "nodejs";

async function readFreshBlob(blobId: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (const delay of [0, 1_000, 2_000, 4_000, 8_000, 16_000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await readBlob(blobId);
    } catch (error) {
      lastError = error;
      if (!(error instanceof WalrusError) || !/\((404|5\d\d)\)/.test(error.message)) throw error;
    }
  }
  throw lastError;
}

/**
 * Publishes a canonical report snapshot to Walrus and proves round-trip
 * integrity before the client anchors it on Sui.
 *
 * The request body must be exactly the canonical JSON bytes the browser hashed
 * (see `canonical-report.ts`). We do not re-serialize it: the client sends raw
 * text, we upload those exact bytes, read them back, and confirm the SHA-256
 * matches. Only then do we return the blob ID and digest for the on-chain call.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json/i.test(contentType)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  // Bound the payload before reading it into memory.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CANONICAL_REPORT_BYTES) {
    return NextResponse.json({ error: "Canonical report is too large" }, { status: 413 });
  }

  const raw = await request.text();
  const bytes = new TextEncoder().encode(raw);
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "Canonical report body is empty" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_CANONICAL_REPORT_BYTES) {
    return NextResponse.json({ error: "Canonical report is too large" }, { status: 413 });
  }

  // Accept only well-formed JSON with the expected version marker, so we never
  // upload arbitrary bytes as a "report".
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Canonical report must be valid JSON" }, { status: 400 });
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== 1
  ) {
    return NextResponse.json({ error: "Unrecognized canonical report shape" }, { status: 400 });
  }

  const digest = await sha256HexBytes(bytes);

  try {
    const blobId = await storePermanentBlob(bytes);

    // Read it back and hash-verify the exact bytes we stored. If Walrus returns
    // anything else, refuse to hand the client a blob ID that would not verify.
    const readBack = await readFreshBlob(blobId);
    const readBackDigest = await sha256HexBytes(readBack);
    if (readBackDigest !== digest) {
      return NextResponse.json(
        { error: "Walrus round-trip integrity check failed" },
        { status: 502 },
      );
    }

    return NextResponse.json({ blobId, digest });
  } catch (error) {
    const message = error instanceof WalrusError ? error.message : "Walrus publish failed";
    console.error("walrus publish failed", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
