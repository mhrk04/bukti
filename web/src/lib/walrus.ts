/**
 * Server-only Walrus testnet HTTP publisher/aggregator for Bukti.
 *
 * Uploads a canonical report JSON as a public, non-deletable 30-epoch blob (no
 * encryption, because fact-check reports are intentionally public), then reads
 * it back and hash-verifies it. Uses the raw HTTP API — no SDK, dependency, or
 * secret.
 *
 * Every response is treated as untrusted: reads are bounded in size and time,
 * and the aggregator response is re-hashed against the digest we uploaded.
 *
 * Endpoints are testnet-only. Override via WALRUS_PUBLISHER_URL /
 * WALRUS_AGGREGATOR_URL if a self-hosted endpoint is used.
 */

/** Default public Walrus testnet endpoints (see walrus-quickstart reference). */
const DEFAULT_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const DEFAULT_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

export const WALRUS_LIMITS = {
  /** Upload/read timeout in milliseconds. */
  timeoutMs: 30_000,
  /** Maximum bytes accepted from an aggregator read (defensive). */
  maxReadBytes: 1_000_000,
  /** Storage lifetime in Walrus epochs (~1 day each on testnet). */
  epochs: 30,
} as const;

export class WalrusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalrusError";
  }
}

function publisherUrl(): string {
  return (process.env.WALRUS_PUBLISHER_URL || DEFAULT_PUBLISHER).replace(/\/$/, "");
}

function aggregatorUrl(): string {
  return (process.env.WALRUS_AGGREGATOR_URL || DEFAULT_AGGREGATOR).replace(/\/$/, "");
}

/**
 * Walrus blob IDs are base64url strings. Constrain the character set so an
 * untrusted blob ID can never be used to reach a different aggregator path.
 */
export function isValidBlobId(blobId: string): boolean {
  return /^[A-Za-z0-9_-]{1,120}$/.test(blobId);
}

/**
 * Stores bytes as a public, non-deletable blob and returns its content-addressed
 * blob ID. Handles both the `newlyCreated` and `alreadyCertified` response
 * shapes. Its 30-epoch lifetime is intentional for the testnet demo.
 */
export async function storePermanentBlob(data: Uint8Array): Promise<string> {
  const response = await fetch(`${publisherUrl()}/v1/blobs?epochs=${WALRUS_LIMITS.epochs}&permanent=true`, {
    method: "PUT",
    body: data as unknown as BodyInit,
    signal: AbortSignal.timeout(WALRUS_LIMITS.timeoutMs),
  });
  if (!response.ok) {
    throw new WalrusError(`Walrus upload failed (${response.status})`);
  }
  const json = (await response.json()) as {
    newlyCreated?: { blobObject?: { blobId?: string } };
    alreadyCertified?: { blobId?: string };
  };
  const blobId = json.newlyCreated?.blobObject?.blobId ?? json.alreadyCertified?.blobId;
  if (typeof blobId !== "string" || !isValidBlobId(blobId)) {
    throw new WalrusError("Walrus upload returned no usable blob ID");
  }
  return blobId;
}

/** Reads response bytes up to `maxBytes`, aborting if the cap is exceeded. */
async function readBoundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const body = response.body;
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new WalrusError("Walrus blob exceeds the maximum readable size");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Reads a public blob by ID from the aggregator, bounded in size and time. */
export async function readBlob(blobId: string): Promise<Uint8Array> {
  if (!isValidBlobId(blobId)) {
    throw new WalrusError("Invalid Walrus blob ID");
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${aggregatorUrl()}/v1/blobs/${blobId}`, {
      method: "GET",
      signal: AbortSignal.timeout(WALRUS_LIMITS.timeoutMs),
    });
    if (response.ok) return readBoundedBytes(response, WALRUS_LIMITS.maxReadBytes);
    await response.body?.cancel().catch(() => {});
    if (response.status !== 404 || attempt === 2) {
      throw new WalrusError(`Walrus read failed (${response.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new WalrusError("Walrus read failed");
}
