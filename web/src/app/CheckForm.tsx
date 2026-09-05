"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ClaimCheck } from "@/lib/gonka";
import { formatPercent } from "@/lib/format";

const progressMessages = [
  "Retrieving live evidence…",
  "Asking the first Gonka model…",
  "Asking the second Gonka model…",
  "Comparing both model assessments…",
];

function Tip({ label, children }: { label: string; children: string }) {
  return <span className="tooltip" title={children} tabIndex={0} aria-label={label + ": " + children}>{label}</span>;
}

export function CheckForm({ onResult }: { onResult?: (result: ClaimCheck) => void }) {
  const [claim, setClaim] = useState(() => {
    const value = new URLSearchParams(window.location.search).get("claim") ?? "";
    return value.slice(0, 4_000);
  });
  const [result, setResult] = useState<ClaimCheck | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      setProgressIndex((index) => Math.min(index + 1, progressMessages.length - 1));
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [loading]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setProgressIndex(0);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim }),
        signal: AbortSignal.timeout(55_000),
      });
      const body = (await response.json()) as ClaimCheck & { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to check claim");
      setResult(body);
      onResult?.(body);
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "TimeoutError"
          ? "Verification timed out. Please retry with a shorter claim."
          : caught instanceof Error
            ? caught.message
            : "Unable to check claim",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="checker" aria-labelledby="checker-title">
      <p className="eyebrow">CHECK A CLAIM</p>
      <h2 id="checker-title">What should we inspect?</h2>
      <form onSubmit={submit}>
        <label htmlFor="claim">Paste a public claim or URL</label>
        <textarea
          id="claim"
          value={claim}
          onChange={(event) => setClaim(event.target.value)}
          placeholder="Example: Malaysia will introduce a four-day work week next month."
          minLength={10}
          maxLength={4_000}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Checking with Gonka…" : "Check with Gonka →"}
        </button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && (
        <div className="result skeleton" role="status" aria-label="Checking claim">
          <span className="skeleton-line skeleton-score" />
          <span className="skeleton-line" />
          <span className="skeleton-line skeleton-short" />
          <p className="muted">{progressMessages[progressIndex]}</p>
        </div>
      )}
      {result && (
        <article className="result" aria-live="polite">
          <div className="score-row">
            <div>
              <p className="eyebrow">BUKTI SCORE</p>
              <strong className="tabular-nums">{formatPercent(result.aggregateScore)}</strong>
            </div>
            <div className="verdict">{result.aggregateVerdict}</div>
          </div>
          <p className="claim">“{result.claim}”</p>
          {result.evidence && (
            <section className="evidence" aria-label="Retrieved source">
              <p className="eyebrow">RETRIEVED SOURCE</p>
              <p className="source-title">{result.evidence.title || result.evidence.url}</p>
              <p className="muted">
                <a href={result.evidence.url} target="_blank" rel="noreferrer noopener">
                  {result.evidence.url}
                </a>
              </p>
              <p className="muted">Retrieved: {new Date(result.evidence.retrievedAt).toLocaleString()}</p>
              <p className="excerpt">{result.evidence.excerpt.slice(0, 500)}{result.evidence.excerpt.length > 500 ? "…" : ""}</p>
              <p className="request-id">Evidence digest: {result.evidence.digest.slice(0, 16)}…</p>
            </section>
          )}
          {result.sources && result.sources.length > 0 && (
            <section className="sources" aria-label="Retrieved sources">
              <p className="eyebrow">RETRIEVED SOURCES</p>
              <ul className="source-list">
                {result.sources.map((source) => (
                  <li className="source-item" key={source.url}>
                    <p className="source-title">
                      {source.title || source.url}
                      {source.official ? (
                        <span className="official-tag"> · <Tip label="official" children="The source is the organisation's own official website or publication." /></span>
                      ) : source.trusted ? (
                        <span className="trusted-tag"> · <Tip label="trusted" children="The source has been identified as a generally reliable publisher for this topic." /></span>
                      ) : null}
                    </p>
                    <p className="muted">
                      <a href={source.url} target="_blank" rel="noreferrer noopener">
                        {source.url}
                      </a>
                    </p>
                    {source.publishedAt && (
                      <p className="muted"><Tip label="Published" children="The date the source says this item was originally published." />: {new Date(source.publishedAt).toLocaleString()}</p>
                    )}
                    <p className="muted"><Tip label="Retrieved" children="The date Bukti fetched this source for this check." />: {new Date(source.retrievedAt).toLocaleString()}</p>
                    <p className="excerpt">
                      {source.excerpt.slice(0, 300)}
                      {source.excerpt.length > 300 ? "…" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="muted"><Tip label="Model disagreement" children="The point difference between the highest and lowest model scores; higher means less consensus." />: {result.disagreement} points</p>
          {result.warnings.length > 0 && <p className="warning">Partial result: {result.warnings.join("; ")}</p>}
          <div className="model-grid">
            {result.results.map((item) => (
              <section className="model-result" key={`${item.model}-${item.requestId}`}>
                <p className="model-name">{item.model}</p>
                <p><strong className="tabular-nums">{formatPercent(item.score)}</strong> · {item.verdict}</p>
                <p className="muted">{item.reasoning}</p>
                {item.evidence.length > 0 && (
                  <div className="model-citations">
                    <p className="eyebrow">CITED SOURCES</p>
                    <ul>
                      {item.evidence.map((citation) => (
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
        </article>
      )}
    </section>
  );
}
