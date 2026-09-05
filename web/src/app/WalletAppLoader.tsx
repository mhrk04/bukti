"use client";

import dynamic from "next/dynamic";

const WalletApp = dynamic(() => import("./WalletApp").then((module) => module.WalletApp), {
  ssr: false,
  loading: () => <p className="muted">Loading Sui wallet…</p>,
});

export function WalletAppLoader() {
  return <WalletApp />;
}
