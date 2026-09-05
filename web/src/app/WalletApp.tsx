"use client";

import { useEffect, useState } from "react";
import { createDAppKit, DAppKitProvider, useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import type { ClaimCheck } from "@/lib/gonka";
import { CheckForm } from "./CheckForm";

const dAppKit = createDAppKit({
  networks: ["testnet"],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: "https://fullnode.testnet.sui.io:443" }),
  storageKey: "bukti-dapp-kit",
  slushWalletConfig: null,
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

function PublishReceipt({ result }: { result: ClaimCheck }) {
  const account = useCurrentAccount();
  const kit = useDAppKit();
  const [status, setStatus] = useState("");
  const [published, setPublished] = useState<{ digest: string; objectId?: string } | null>(null);
  const packageId = process.env.NEXT_PUBLIC_BUKTI_PACKAGE_ID;

  async function publish() {
    if (!packageId || !account) return;
    setStatus("Waiting for wallet…");
    setPublished(null);

    try {
      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::reports::publish_report`,
        arguments: [
          tx.pure.vector("u8", await sha256(result.claim)),
          tx.pure.u16(result.aggregateScore * 100),
          tx.pure.vector("u8", toBytes(result.aggregateVerdict)),
          tx.pure.vector("u8", await sha256(JSON.stringify(result.results.flatMap((item) => item.evidence)))),
          tx.pure.vector("u8", toBytes(result.results.map((item) => item.requestId).join(","))),
          tx.pure.vector("u8", toBytes(result.results.map((item) => item.model).join(","))),
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
      setStatus(error instanceof Error ? error.message : "Unable to publish report");
    }
  }

  return (
    <div className="publish-card">
      <div>
        <p className="eyebrow">SUI PROVENANCE</p>
        <p className="muted">Freeze this model comparison as an immutable Bukti report.</p>
      </div>
      <button type="button" onClick={publish} disabled={!account || !packageId || status === "Waiting for wallet…"}>
        {!account ? "Connect wallet to publish" : !packageId ? "Set package ID to publish" : "Publish immutable report →"}
      </button>
      {status && <p className="error" role="alert">{status}</p>}
      {published && (
        <p className="success">
          Published: {published.objectId ? `report ${published.objectId}` : "immutable report"}.{" "}
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
