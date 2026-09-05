# Bukti

Bukti verifies public claims with Gonka Router and anchors inspectable evidence receipts on Sui and Walrus.

## The problem it solves

Public claims are easy to share but difficult to verify later. Context changes, sources disappear, and an AI answer by itself does not provide a durable audit trail.

Bukti makes this workflow safer and easier by:

- Accepting either a text claim or a public URL for checking.
- Retrieving bounded evidence from public pages and social posts while defending against unsafe URLs and oversized responses.
- Searching for supporting and contradicting sources, with Malaysian official and established news domains ranked first when relevant.
- Asking multiple Gonka models to assess the claim and surfacing their scores, verdicts, reasoning, citations, request IDs, and disagreement.
- Limiting unsupported claims to a cautious score ceiling when no evidence can be retrieved.
- Storing the canonical result as a public Walrus snapshot and committing its SHA-256 digest to an immutable Sui `TruthReportV3` object.
- Providing public report pages and a Sui event-backed report index so anyone can inspect the receipt without trusting Bukti's database.

## Challenges we ran into

- **Keeping the receipt reproducible:** Browser and server serialization can differ if object ordering or formatting is left implicit. We solved this with a deterministic canonical JSON serializer and hash the exact bytes before and after the Walrus round trip.
- **Handling unreliable storage propagation:** A Walrus blob may not be immediately readable after upload. The publisher retries short-lived 404/5xx responses, then refuses to continue if the downloaded bytes do not hash to the original digest.
- **Making user-supplied URLs safe:** Claims can point to attacker-controlled URLs, including private-network targets or redirect chains. Direct retrieval validates schemes, credentials, DNS results, redirects, response size, content type, and timeouts before returning a bounded text excerpt.
- **Preventing unsupported certainty:** Models can produce a confident answer even when no source is available. Bukti caps scores without retrieved evidence and validates every model citation against the sources actually supplied to it.
- **Building a public report list from immutable objects:** Frozen Sui objects are not edited in place and are not convenient to enumerate directly. The Move package emits a permanent `ReportPublishedV3` event, which powers the public reports index while preserving the immutable receipt invariant.

## Tracks Applied

### Sui x AI

Bukti uses Sui as the trust and provenance layer for AI-generated claim analysis. Each completed verification can be published as a frozen `TruthReportV3` object containing the claim commitment, aggregate score, verdict, model/request metadata, Walrus blob ID, and digest of the canonical report. Because reports are immutable, a re-check creates a new receipt instead of silently changing the original result.

Walrus stores the full public evidence snapshot, while Sui provides the durable on-chain commitment that lets anyone verify the snapshot has not been altered. This makes AI output inspectable rather than a transient answer in a chat interface.

### Gonka Router AI for Society

Bukti applies Gonka Router to a practical public-interest problem: helping people assess claims that affect civic information, public policy, health, prices, and everyday decision-making. The server can query multiple configured Gonka models through the Anthropic Messages API, capture each `X-Request-Id`, compare their assessments, and expose disagreement instead of hiding uncertainty behind one answer.

The project is designed for cautious use: it prefers recent official Malaysian sources, preserves contradicting evidence, validates model citations, and lowers confidence when no live evidence is available. The result is a transparent verification workflow that communities, journalists, researchers, and ordinary users can inspect and share.

## Technologies used

- JavaScript / TypeScript
- Move
- React
- Node.js
- HTML
- Walrus
- Next.js
- Sui
- Gonka Router

## Platforms

- [Mubahack challenge tracks](https://www.mubahack.xyz/challenge_tracks/code.html)
- Sui Testnet
- Walrus Testnet
- Gonka Router

## Repository layout

```text
move/bukti/   Move package and tests
web/          Next.js app and route handlers
```

## Requirements

- Node.js 20.9+
- pnpm 11+
- Sui CLI 1.79+

## Local development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm build
pnpm move:build
pnpm move:test
```

Copy `web/.env.example` to `web/.env.local` before adding the server-only Gonka key. Never prefix the key with `NEXT_PUBLIC_`.

After publishing the Move package to Sui testnet, add its package ID as `NEXT_PUBLIC_BUKTI_PACKAGE_ID` in `web/.env.local` to enable immutable report publishing.

## Testnet demo

The BUDI95 demo is published and immutable:

- Sui package: `0xb414425d559cd963c693a3afabae0ad48e4dcd458c1c4cab97aece3fe0157631`
- Report object: `0xb931f7ae5fc61ba7f10bea5104f2963c9e069d8754e3a9119d08693deef5f7b7`
- Transaction: `3QnwMuNqUcVxyqRke4qL3vEEwwmqzcFtoAwUsScx4Gjc`
- Walrus blob: `YIagqBooveVw2ifLbAoUzVetl4DiWizEvGXP4sy_G7E`
- Canonical snapshot SHA-256: `f1c22bc74a461c61939ef66cfa6672ce1be0d7cd00202a955656eb6fb66b299b`

## Gonka integration

`POST /api/check` calls `https://api.gonkarouter.io/v1/messages` from the server, aggregates the configured models, captures each `X-Request-Id`, and exposes the IDs in the result. Configure one or more comma-separated models with `GONKA_MODELS`; model IDs are account-specific, so use the IDs available in your Gonka dashboard. See the [Gonka Router documentation](https://gonkarouter.io/docs).

## Product invariant

One verification produces one immutable `TruthReport`. A re-check produces a new report; reports are never edited in place.
