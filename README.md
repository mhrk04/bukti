# Bukti

Malaysia-first public-claim evidence receipts powered by Gonka Router and immutable Sui objects.

## Stack

- Next.js 16 + React 19 + TypeScript
- Sui Move package with immutable `TruthReport` objects
- Gonka Router server integration through the Anthropic Messages API
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

Copy `web/.env.example` to `web/.env.local` before adding the server-only Gonka key. Never prefix the key with `NEXT_PUBLIC_`.

After publishing the Move package to Sui testnet, add its package ID as
`NEXT_PUBLIC_BUKTI_PACKAGE_ID` in `web/.env.local` to enable immutable report publishing.

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
