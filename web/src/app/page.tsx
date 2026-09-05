import { WalletAppLoader } from "./WalletAppLoader";

export default function Home() {
  return (
    <main className="shell">
      <p className="eyebrow">BUKTI · SEMAK · BANDING · SIMPAN</p>
      <h1>Make the evidence inspectable.</h1>
      <p className="lede">
        Bukti turns a public claim into a Gonka-verified, immutable Sui evidence receipt.
      </p>
      <WalletAppLoader />
      <p className="health-link"><a href="/reports">Browse public reports →</a></p>
      <p className="health-link"><a href="/api/health">API health check →</a></p>
    </main>
  );
}
