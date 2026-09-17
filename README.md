# Firsts

Firsts is a non-custodial studio for putting things on Solana itself. Files, images, agents, and text are published as bytes inside transactions, and coins are launched as Token-2022 mints that carry their own name, artwork, story, and links in the mint account. Nothing is uploaded to a server, IPFS, or a pinning service, and there is no Firsts backend to read any of it back.

> **Status:** production release `0.2.0`. Mainnet is the default. Mainnet writes are real, public, and generally irreversible; use devnet for rehearsals.

## What works

- Text, JSON, images, HTML, agent manifests, and arbitrary files up to 256 KB
- Content-addressed `firsts/1` envelopes with SHA-256 integrity
- Coin launches whose metadata and artwork live onchain, with optional fixed supply and frozen metadata
- A complete v1 launch in one atomic 4,096-byte transaction, or two or more on a legacy wallet
- Artwork re-encoded in the browser to fit the transaction budget you pick
- A shareable token page at `/t/<cluster>/<mint>`, rebuilt from chain state with a verified artwork digest
- A resolver serving Metaplex-style JSON and the artwork for wallets that only read a metadata URI
- Wallet Standard discovery and capability-aware v1 signing, with legacy fallback
- Multi-core vanity address grinding in the browser, usable as the mint address of the next launch
- Resuming a launch that was interrupted partway, with the same mint and artwork
- RPC-only recovery, ordering, and digest verification

Firsts does **not** create a bonding curve, liquidity pool, or market, and makes no promise of value. Read [PROTOCOL.md](./PROTOCOL.md) for the wire format and [SECURITY.md](./SECURITY.md) before operating it. The release verification and resolved findings are in [AUDIT.md](./AUDIT.md).

Detailed guides cover the [user workflow](./docs/user-guide.md), [architecture](./docs/architecture.md), [resolver API](./docs/resolver.md), [RPC and indexing](./docs/rpc-and-indexing.md), [deployment](./docs/deployment.md), [operations](./docs/operations.md), and [testing](./docs/testing.md). Release history is in [CHANGELOG.md](./CHANGELOG.md).

## Quick start

Requirements: Node.js 22+ and a modern browser with WebCrypto.

```bash
npm ci
npm run dev
```

Open `http://localhost:4173`. The default cluster is mainnet. No API keys or server are required.

## Quality gates

```bash
npm run check          # lint, unit tests, TypeScript, production build
npm run smoke:simulate # simulate every real transaction on devnet, no funds needed
npm run smoke:devnet   # full funded devnet round trip: inscribe, launch, read back
```

`smoke:simulate` borrows a live validator address as the fee payer, because simulation never verifies signatures. It writes nothing and needs no key. `smoke:devnet` does spend devnet SOL, from a throwaway key it generates and funds from the faucet, or from `SMOKE_KEYPAIR` when the faucet is rate-limited.

## Architecture

Firsts is deliberately static and non-custodial:

1. The browser hashes and chunks the selected bytes.
2. Each chunk becomes a self-describing Memo Program payload.
3. The connected Wallet Standard wallet signs and sends each transaction.
4. A recovery manifest is the ordered list of transaction signatures.
5. Any client can fetch those transactions, reconstruct the bytes, and verify SHA-256.

A launch adds one step: the artwork is inscribed first, then its digest and transaction list are written into the mint's own metadata, so the coin and its image stay verifiable against each other forever.

Transaction v1 is used only when the wallet advertises version `1` through `supportedTransactionVersions`. V1 messages set compute-unit and loaded-account-data limits as message properties; the network defaults both to zero when omitted. Each memo requests a compute limit sized to its own bytes, because the Memo program charges per byte. See the [official Solana upgrade guide](https://solana.com/upgrades/larger-transaction-sizes).

## Deploy

The output is a static `dist/` directory plus the Cloudflare Pages Functions in `functions/`, which serve the token resolver and share cards.

```bash
npm run build
npx wrangler pages deploy dist --project-name solana-firsts
```

Cloudflare Pages is the supported production target. The reference client uses PublicNode for mainnet and Solana's public endpoint for devnet. For sustained traffic, configure browser-safe RPC endpoints using [.env.example](./.env.example); public endpoints are rate-limited. Never place a secret in a `VITE_*` variable. See [docs/deployment.md](./docs/deployment.md) for CSP, resolver configuration, and private proxy guidance.

## Operational boundaries

- Do not publish secrets, personal information, or content you do not have rights to.
- Do not treat fee estimates as quotes; the wallet is authoritative.
- Back up vanity keypairs immediately. Firsts cannot recover them.
- A launched coin is a token with metadata, not liquidity, a market, or a promise of value.
- Large artifacts require several transactions and are not atomic as a group.
- Onchain content is untrusted. The resolver serves it sandboxed and never renders it inline as HTML.

## License

Apache-2.0. See [LICENSE](./LICENSE).
