"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import type { ClaimCheck } from "@/lib/gonka";

export function CheckForm({ onResult }: { onResult?: (result: ClaimCheck) => void }) {
  const [claim, setClaim] = useState("");
  const [result, setResult] = useState<ClaimCheck | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim }),
      });
      const body = (await response.json()) as ClaimCheck & { error?: string };
      if (!response.ok) throw new Error(body.error || "Unable to check claim");
      setResult(body);
      onResult?.(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to check claim");
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
      {result && (
        <article className="result" aria-live="polite">
          <div className="score-row">
            <div>
              <p className="eyebrow">BUKTI SCORE</p>
              <strong>{result.aggregateScore}%</strong>
            </div>
            <div className="verdict">{result.aggregateVerdict}</div>
          </div>
          <p className="claim">“{result.claim}”</p>
          <p className="muted">Model disagreement: {result.disagreement} points</p>
          {result.warnings.length > 0 && <p className="warning">Partial result: {result.warnings.join("; ")}</p>}
          <div className="model-grid">
            {result.results.map((item) => (
              <section className="model-result" key={`${item.model}-${item.requestId}`}>
                <p className="model-name">{item.model}</p>
                <p><strong>{item.score}%</strong> · {item.verdict}</p>
                <p className="muted">{item.reasoning}</p>
                <p className="request-id">Gonka Request ID: {item.requestId || "unavailable"}</p>
              </section>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}
