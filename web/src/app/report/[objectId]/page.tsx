import type { CanonicalReport } from "@/lib/canonical-report";
import { sha256HexBytes } from "@/lib/canonical-report";
import { fetchV2Report } from "@/lib/report";
import { readBlob, WalrusError } from "@/lib/walrus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VerifiedReport =
  | { kind: "verified"; report: CanonicalReport; blobId: string; digest: string; objectId: string }
  | { kind: "integrity"; reason: string }
  | { kind: "not-found"; reason: string };

async function loadReport(objectId: string): Promise<VerifiedReport> {
  const packageId = process.env.NEXT_PUBLIC_BUKTI_PACKAGE_ID;
  const chain = await fetchV2Report(objectId, packageId);
  if (chain.kind === "error") {
    return { kind: "not-found", reason: chain.reason };
  }

  // Fetch the referenced Walrus blob server-side.
  let bytes: Uint8Array;
  try {
    bytes = await readBlob(chain.report.walrusBlobId);
  } catch (error) {
    const reason = error instanceof WalrusError ? error.message : "Walrus blob could not be read";
    return { kind: "integrity", reason };
  }

  // SHA-256 verify the blob against the on-chain digest. Render only on a match.
  const digest = await sha256HexBytes(bytes);
  if (digest !== chain.report.resultDigestHex) {
    return {
      kind: "integrity",
      reason: "The Walrus snapshot does not match the immutable on-chain digest.",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { kind: "integrity", reason: "The verified snapshot is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== 1) {
    return { kind: "integrity", reason: "The verified snapshot has an unrecognized shape." };
  }

  return {
    kind: "verified",
    report: parsed as CanonicalReport,
    blobId: chain.report.walrusBlobId,
    digest,
    objectId,
  };
}

export default async function ReportPage({ params }: { params: Promise<{ objectId: string }> }) {
  const { objectId } = await params;
  const state = await loadReport(objectId);

  if (state.kind === "not-found") {
    return (
      <main className="shell">
        <p className="eyebrow">BUKTI · PUBLIC REPORT</p>
        <h1>Report unavailable</h1>
        <p className="error" role="alert">{state.reason}</p>
        <p className="muted">
          This page resolves immutable Bukti V2 and V3 receipts. V1 receipts committed only a digest, so their
          full snapshot was not stored and cannot be reconstructed here.
        </p>
        <p className="health-link"><a href="/">← Back to Bukti</a></p>
      </main>
    );
  }

  if (state.kind === "integrity") {
    return (
      <main className="shell">
        <p className="eyebrow">BUKTI · PUBLIC REPORT</p>
        <h1>Integrity check failed</h1>
        <p className="error" role="alert">{state.reason}</p>
        <p className="muted">
          The snapshot was not rendered because it did not match the immutable digest frozen on Sui.
          A mismatch means the off-chain data was altered, moved, or is unavailable.
        </p>
        <p className="health-link"><a href="/">← Back to Bukti</a></p>
      </main>
    );
  }

  const { report } = state;

  return (
    <main className="shell">
      <p className="eyebrow">BUKTI · PUBLIC REPORT</p>
      <h1>Verified evidence receipt</h1>
      <p className="success">
        Integrity verified: the Walrus snapshot matches the immutable Sui digest.
      </p>

      <section className="result" aria-live="polite">
        <div className="score-row">
          <div>
            <p className="eyebrow">BUKTI SCORE</p>
            <strong>{report.aggregateScore}%</strong>
          </div>
          <div className="verdict">{report.aggregateVerdict}</div>
        </div>
        <p className="claim">“{report.claim}”</p>
        <p className="muted"><span className="tooltip" title="The point difference between the highest and lowest model scores; higher means less consensus." tabIndex={0}>Model disagreement</span>: {report.disagreement} points</p>

        {report.warnings.length > 0 && (
          <p className="warning">Partial result: {report.warnings.join("; ")}</p>
        )}

        {report.evidence && (
          <section className="evidence" aria-label="Retrieved source">
            <p className="eyebrow">RETRIEVED SOURCE</p>
            <p className="source-title">{report.evidence.title || report.evidence.url}</p>
            <p className="muted">
              <a href={report.evidence.url} target="_blank" rel="noreferrer noopener">
                {report.evidence.url}
              </a>
            </p>
            <p className="muted">Retrieved: {report.evidence.retrievedAt}</p>
            <p className="excerpt">{report.evidence.excerpt}</p>
          </section>
        )}

        {report.sources.length > 0 && (
          <section className="sources" aria-label="Retrieved sources">
            <p className="eyebrow">RETRIEVED SOURCES</p>
            <ul className="source-list">
              {report.sources.map((source) => (
                <li className="source-item" key={source.url}>
                  <p className="source-title">
                    {source.title || source.url}
                    {source.official ? (
                      <span className="official-tag"> · <span className="tooltip" title="The source is the organisation's own official website or publication." tabIndex={0}>official</span></span>
                    ) : source.trusted ? (
                      <span className="trusted-tag"> · <span className="tooltip" title="The source has been identified as a generally reliable publisher for this topic." tabIndex={0}>trusted</span></span>
                    ) : null}
                  </p>
                  <p className="muted">
                    <a href={source.url} target="_blank" rel="noreferrer noopener">
                      {source.url}
                    </a>
                  </p>
                  {source.publishedAt && <p className="muted"><span className="tooltip" title="The date the source says this item was originally published." tabIndex={0}>Published</span>: {source.publishedAt}</p>}
                  <p className="muted"><span className="tooltip" title="The date Bukti fetched this source for this check." tabIndex={0}>Retrieved</span>: {source.retrievedAt}</p>
                  <p className="excerpt">{source.excerpt}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="model-grid">
          {report.models.map((item) => (
            <section className="model-result" key={`${item.model}-${item.requestId}`}>
              <p className="model-name">{item.model}</p>
              <p><strong>{item.score}%</strong> · {item.verdict}</p>
              <p className="muted">{item.reasoning}</p>
              {item.citations.length > 0 && (
                <div className="model-citations">
                  <p className="eyebrow">CITED SOURCES</p>
                  <ul>
                    {item.citations.map((citation) => (
                      <li key={citation.url}>
                        <span
                          className={
                            citation.stance === "supports"
                              ? "stance-tag stance-supports"
                              : "stance-tag stance-contradicts"
                          }
                        >
                          {citation.stance === "supports" ? "Supports" : "Contradicts"}
                        </span>{" "}
                        <a href={citation.url} target="_blank" rel="noreferrer noopener">
                          {citation.url}
                        </a>
                        {citation.quote && <p className="citation-quote">“{citation.quote}”</p>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="request-id">Gonka Request ID: {item.requestId || "unavailable"}</p>
            </section>
          ))}
        </div>
      </section>

      <section className="provenance" aria-label="Provenance">
        <p className="eyebrow">PROVENANCE</p>
        <p className="request-id">Sui object: {state.objectId}</p>
        <p className="request-id">Walrus blob: {state.blobId}</p>
        <p className="request-id">SHA-256 digest: {state.digest}</p>
      </section>

      <p className="health-link">
        <a href={`/?claim=${encodeURIComponent(report.claim)}`}>Re-check latest evidence →</a>
      </p>
      <p className="health-link"><a href="/">← Back to Bukti</a></p>
    </main>
  );
}
