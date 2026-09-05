import { WalletAppLoader } from "./WalletAppLoader";

export default function Home() {
  return (
    <main className="shell">
      <p className="eyebrow">PUBLIC CLAIMS, MADE TRACEABLE</p>
      <h1>Make evidence<br /><em>inspectable.</em></h1>
      <p className="lede">
        Bukti turns a public claim into a Gonka-verified evidence receipt—then anchors the exact snapshot on Sui.
      </p>
      <WalletAppLoader />
      <p className="health-link"><a href="/reports">Browse public reports →</a></p>
      <p className="health-link"><a href="/api/health">API health check →</a></p>
    </main>
  );
}
