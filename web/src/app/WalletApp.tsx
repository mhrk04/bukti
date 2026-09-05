"use client";

import { useEffect, useState } from "react";
import { createDAppKit, DAppKitProvider, useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { canonicalReportBytes, sha256HexBytes } from "@/lib/canonical-report";
import type { ClaimCheck } from "@/lib/gonka";
import { CheckForm } from "./CheckForm";

const dAppKit = createDAppKit({
  networks: ["testnet"],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: "https://fullnode.testnet.sui.io:443" }),
  storageKey: "bukti-dapp-kit",
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}

function toBytes(value: string) {
  return Array.from(new TextEncoder().encode(value));
}

async function sha256(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

/** Converts a lowercase hex digest into a byte array for a Move `vector<u8>` arg. */
function hexToBytes(hex: string) {
  const out: number[] = [];
  for (let index = 0; index < hex.length; index += 2) {
    out.push(parseInt(hex.slice(index, index + 2), 16));
  }
  return out;
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Unable to publish report";
}

function PublishReceipt({ result }: { result: ClaimCheck }) {
  const account = useCurrentAccount();
  const kit = useDAppKit();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<{ digest: string; objectId?: string } | null>(null);
  const packageId = process.env.NEXT_PUBLIC_BUKTI_PACKAGE_ID;

  async function publish() {
    if (!packageId || !account) return;
    setBusy(true);
    setStatus("Preparing canonical snapshot…");
    setPublished(null);

    try {
      const { balance } = await kit.getClient().getBalance({ owner: account.address });
      if (balance.balance === "0") {
        setStatus("This wallet has no testnet SUI for gas. Fund it from the Sui testnet faucet, then retry.");
        return;
      }

      // 1. Build the exact canonical bytes and hash them locally.
      const canonicalBytes = canonicalReportBytes(result);
      const localDigest = await sha256HexBytes(canonicalBytes);

      // 2. Upload to Walrus via the server route, which reads the blob back and
      //    hash-verifies it before returning the blob ID and digest.
      setStatus("Uploading public snapshot to Walrus…");
      const canonicalText = new TextDecoder().decode(canonicalBytes);
      const walrusResponse = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: canonicalText,
      });
      const walrusBody = (await walrusResponse.json()) as {
        blobId?: string;
        digest?: string;
        error?: string;
      };
      if (!walrusResponse.ok || !walrusBody.blobId || !walrusBody.digest) {
        throw new Error(walrusBody.error || "Walrus publish failed");
      }

      // 3. The server's digest must match our local canonical digest, or the
      //    on-chain commitment would not describe the bytes we hashed.
      if (walrusBody.digest !== localDigest) {
        throw new Error("Walrus digest did not match the local canonical snapshot");
      }

      // 4. Freeze the immutable V2 receipt committing the digest + blob ID.
      setStatus("Waiting for wallet…");
      const requestIds = result.results.map((item) => item.requestId ?? "").join(",");
      const models = result.results.map((item) => item.model).join(",");

      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::reports::publish_report_v3`,
        arguments: [
          // Plain UTF-8 claim first: it is intentionally public and indexed by
          // the ReportPublishedV3 event so /reports can list it.
          tx.pure.vector("u8", toBytes(result.claim)),
          tx.pure.vector("u8", await sha256(result.claim)),
          tx.pure.u16(result.aggregateScore * 100),
          tx.pure.vector("u8", toBytes(result.aggregateVerdict)),
          tx.pure.vector("u8", hexToBytes(localDigest)),
          tx.pure.vector("u8", toBytes(walrusBody.blobId)),
          tx.pure.vector("u8", toBytes(requestIds)),
          tx.pure.vector("u8", toBytes(models)),
        ],
      });
      const response = await kit.signAndExecuteTransaction({ transaction: tx });
      if (response.FailedTransaction) {
        throw new Error(response.FailedTransaction.status.error?.message || "Sui transaction failed");
      }

      const created = response.Transaction.effects?.changedObjects.find((item) => item.idOperation === "Created");
      setPublished({ digest: response.Transaction.digest, objectId: created?.objectId });
      setStatus("");
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="publish-card">
      <div>
        <p className="eyebrow">SUI PROVENANCE</p>
        <p className="muted">
          Store this comparison as a public Walrus snapshot and freeze its digest as an immutable Bukti report.
        </p>
      </div>
      <button type="button" onClick={publish} disabled={!account || !packageId || busy}>
        {!account
          ? "Connect wallet to publish"
          : !packageId
            ? "Set package ID to publish"
            : busy
              ? "Publishing…"
              : "Publish immutable report →"}
      </button>
      {status && <p className="error" role="alert">{status}</p>}
      {busy && <div className="publish-skeleton" role="status" aria-label="Publishing report"><span /><span /><span /></div>}
      {published && (
        <p className="success">
          Published: {published.objectId ? `report ${published.objectId}` : "immutable report"}.{" "}
          {published.objectId && (
            <>
              <a href={`/report/${published.objectId}`}>View public report →</a>{" "}
            </>
          )}
          <a href="/reports">Browse public reports →</a>{" "}
          <a href={`https://suiexplorer.com/txblock/${published.digest}?network=testnet`} target="_blank" rel="noreferrer">
            View transaction →
          </a>
        </p>
      )}
    </div>
  );
}

export function WalletApp() {
  const [result, setResult] = useState<ClaimCheck | null>(null);

  useEffect(() => {
    const ignoreWalletCancellation = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof Error && event.reason.message === "User closed the wallet window") {
        event.preventDefault();
      }
    };

    window.addEventListener("unhandledrejection", ignoreWalletCancellation);
    return () => window.removeEventListener("unhandledrejection", ignoreWalletCancellation);
  }, []);

  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <div className="wallet-row"><ConnectButton /></div>
      <CheckForm onResult={setResult} />
      {result && <PublishReceipt result={result} />}
    </DAppKitProvider>
  );
}
