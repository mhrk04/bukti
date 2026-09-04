export default function Home() {
  return (
    <main className="shell">
      <p className="eyebrow">BUKTI · SEMAK · BANDING · SIMPAN</p>
      <h1>Make the evidence inspectable.</h1>
      <p className="lede">
        Bukti turns a public claim into a Gonka-verified, immutable Sui evidence receipt.
      </p>
      <section className="card" aria-labelledby="status-title">
        <div>
          <p className="eyebrow">STATUS</p>
          <h2 id="status-title">Scaffold ready</h2>
          <p>The verification flow is the next build slice.</p>
        </div>
        <a href="/api/health">API health check →</a>
      </section>
    </main>
  );
}
