import { fetchPublicReports, type PublicReport } from "@/lib/reports-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Formats a score in basis points as a whole-percent string. */
function formatScore(scoreBps: number): string {
  return `${Math.round(scoreBps / 100)}%`;
}

/** Formats an ISO/RFC timestamp for display, falling back to the raw value. */
function formatTimestamp(timestamp: string | null): string {
  if (!timestamp) return "time unavailable";
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function ReportRow({ report }: { report: PublicReport }) {
  return (
    <li className="source-item">
      <p className="claim">“{report.claim}”</p>
      <p className="muted">
        <strong>{formatScore(report.scoreBps)}</strong> · {report.verdict}
      </p>
      <p className="muted">{formatTimestamp(report.timestamp)}</p>
      <p className="health-link">
        <a href={`/report/${report.objectId}`}>View public report →</a>
      </p>
    </li>
  );
}

export default async function ReportsPage() {
  const packageId = process.env.NEXT_PUBLIC_BUKTI_PACKAGE_ID;
  const result = await fetchPublicReports(packageId);

  return (
    <main className="shell">
      <p className="eyebrow">BUKTI · PUBLIC REPORTS</p>
      <h1>Published evidence receipts</h1>
      <p className="lede">
        Every entry is an immutable Bukti V3 receipt indexed from a permanent public Sui event.
      </p>

      {result.kind === "error" ? (
        <p className="error" role="alert">{result.reason}</p>
      ) : result.reports.length === 0 ? (
        <section className="result" aria-live="polite">
          <p className="muted">
            No public reports yet. Verify a claim on the home page and publish it to appear here.
          </p>
        </section>
      ) : (
        <section className="sources" aria-label="Public reports">
          <ul className="source-list">
            {result.reports.map((report) => (
              <ReportRow key={report.objectId} report={report} />
            ))}
          </ul>
        </section>
      )}

      <p className="health-link"><a href="/">← Back to Bukti</a></p>
    </main>
  );
}
