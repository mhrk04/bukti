"use client";

import dynamic from "next/dynamic";

const WalletApp = dynamic(() => import("./WalletApp").then((module) => module.WalletApp), {
  ssr: false,
  loading: () => <p className="muted">Loading Sui wallet…</p>,
});

export default function Home() {
  return (
    <main className="shell">
      <p className="eyebrow">BUKTI · SEMAK · BANDING · SIMPAN</p>
      <h1>Make the evidence inspectable.</h1>
      <p className="lede">
        Bukti turns a public claim into a Gonka-verified, immutable Sui evidence receipt.
      </p>
      <WalletApp />
      <p className="health-link"><a href="/api/health">API health check →</a></p>
    </main>
  );
}
