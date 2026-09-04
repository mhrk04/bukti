# Bukti

Malaysia-first public-claim evidence receipts powered by Gonka Router and immutable Sui objects.

## Stack

- Next.js 16 + React 19 + TypeScript
- Sui Move package with immutable `TruthReport` objects
- Gonka Router server integration planned through the Anthropic Messages API
- Testnet-first deployment

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

Copy `.env.example` to `.env.local` before adding the server-only Gonka key. Never prefix the key with `NEXT_PUBLIC_`.

## Gonka integration

The next slice will call `https://api.gonkarouter.io/v1/messages` from a server route, capture the `X-Request-Id` response header, and expose the receipt ID in the report. See the [Gonka Router documentation](https://gonkarouter.io/docs).

## Product invariant

One verification produces one immutable `TruthReport`. A re-check produces a new report; reports are never edited in place.
