# Firsts

<!-- three.ws:badges -->
[![GitHub stars](https://img.shields.io/github/stars/nirholas/solana-firsts?style=flat&logo=github)](https://github.com/nirholas/solana-firsts/stargazers) [![License](https://img.shields.io/github/license/nirholas/solana-firsts?style=flat)](https://github.com/nirholas/solana-firsts/blob/HEAD/LICENSE) [![Last commit](https://img.shields.io/github/last-commit/nirholas/solana-firsts?style=flat)](https://github.com/nirholas/solana-firsts/commits) [![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat)](https://github.com/nirholas/solana-firsts/pulls) [![AI agent friendly](https://img.shields.io/badge/AI%20agents-AGENTS.md%20%2B%20llms.txt-6d5dfc?style=flat)](https://github.com/nirholas/solana-firsts/blob/HEAD/AGENTS.md)
<!-- /three.ws:badges -->


Firsts is a non-custodial studio for publishing verifiable artifacts directly in Solana transactions. It supports Solana's 4,096-byte v1 transaction format, falls back to legacy transactions when a wallet does not advertise v1 support, creates standard SPL mints, generates vanity keypairs locally, and recovers artifacts without a Firsts backend.

> **Status:** early production release. Mainnet is the default. Mainnet writes are real, public, and generally irreversible; use devnet for rehearsals.

## What works

- Text, JSON, images, HTML, agent manifests, and arbitrary files up to 256 KB
- Content-addressed `firsts/1` envelopes with SHA-256 integrity
- Wallet Standard discovery and capability-aware v1 signing
- Legacy chunk fallback for wallets that do not support transaction v1
- Standard SPL token mint creation with optional onchain artwork reference
- Browser-only vanity address grinding and one-time secret export
- RPC-only artifact recovery, ordering, and digest verification
- Responsive Three.js interface with reduced-motion support

Firsts does **not** create a bonding curve, liquidity pool, market, or guaranteed token metadata integration. The token studio creates a standard SPL mint and associated token account. Read [PROTOCOL.md](./PROTOCOL.md) for the wire format and [SECURITY.md](./SECURITY.md) before operating it.

The latest release verification and resolved findings are recorded in [AUDIT.md](./AUDIT.md).

Detailed guides cover the [user workflow](./docs/user-guide.md), [architecture](./docs/architecture.md), [RPC and indexing](./docs/rpc-and-indexing.md), [deployment](./docs/deployment.md), [operations](./docs/operations.md), and [testing](./docs/testing.md). Release history is in [CHANGELOG.md](./CHANGELOG.md).

## Quick start

Requirements: Node.js 22+ and a modern browser with WebCrypto.

```bash
npm ci
npm run dev
```

Open `http://localhost:4173`. The default cluster is mainnet. No API keys or server are required.

## Quality gates

```bash
npm run check
```

This runs ESLint, unit tests, TypeScript, and the production Vite build.

## Architecture

Firsts is deliberately static and non-custodial:

1. The browser hashes and chunks the selected bytes.
2. Each chunk becomes a self-describing Memo Program payload.
3. The connected Wallet Standard wallet signs and sends each transaction.
4. A recovery manifest is the ordered list of transaction signatures.
5. Any client can fetch those transactions, reconstruct the bytes, and verify SHA-256.

Transaction v1 is used only when the wallet advertises version `1` through `supportedTransactionVersions`. V1 messages explicitly set compute-unit and loaded-account-data limits; the network defaults both to zero when omitted. See the [official Solana upgrade guide](https://solana.com/upgrades/larger-transaction-sizes).

## Deploy

The output is a static `dist/` directory.

```bash
npm run build
npx wrangler pages deploy dist --project-name solana-firsts
```

Cloudflare Pages is the supported production target. The reference client uses PublicNode for mainnet and Solana's public endpoint for devnet. For sustained traffic, configure browser-safe RPC endpoints using [.env.example](./.env.example); public endpoints are rate-limited. Never place a secret in a `VITE_*` variable. See [docs/deployment.md](./docs/deployment.md) for CSP and private proxy guidance.

## Operational boundaries

- Do not publish secrets, personal information, or content you do not have rights to.
- Do not treat fee estimates as quotes; the wallet is authoritative.
- Back up vanity keypairs immediately. Firsts cannot recover them.
- Mainnet token creation spends SOL and is not a promise of liquidity or value.
- Large artifacts require several transactions and are not atomic as a group.

## License

Apache-2.0. See [LICENSE](./LICENSE).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=nirholas/solana-firsts&type=Date)](https://www.star-history.com/#nirholas/solana-firsts&Date)

<!-- three.ws:growth -->
## Support the project

If solana-firsts saves you time, **[star it on GitHub](https://github.com/nirholas/solana-firsts)**. Stars are how other developers and AI agents find the repositories worth trusting, and they cost you one click.

Know someone who would use it? [Post on X](https://twitter.com/intent/tweet?text=solana-firsts%3A%20Publish%20verifiable%20artifacts%20and%20create%20SPL%20tokens%20directly%20on%20Solana%20transaction%20v1&url=https%3A%2F%2Fgithub.com%2Fnirholas%2Fsolana-firsts) · [Share on Bluesky](https://bsky.app/intent/compose?text=solana-firsts%3A%20Publish%20verifiable%20artifacts%20and%20create%20SPL%20tokens%20directly%20on%20Solana%20transaction%20v1%20https%3A%2F%2Fgithub.com%2Fnirholas%2Fsolana-firsts) · [Share on LinkedIn](https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fgithub.com%2Fnirholas%2Fsolana-firsts) · [Submit to Hacker News](https://news.ycombinator.com/submitlink?u=https%3A%2F%2Fgithub.com%2Fnirholas%2Fsolana-firsts&t=solana-firsts%3A%20Publish%20verifiable%20artifacts%20and%20create%20SPL%20tokens%20directly%20on%20Solana%20transaction%20v1) · [Share on Reddit](https://www.reddit.com/submit?url=https%3A%2F%2Fgithub.com%2Fnirholas%2Fsolana-firsts&title=solana-firsts%3A%20Publish%20verifiable%20artifacts%20and%20create%20SPL%20tokens%20directly%20on%20Solana%20transaction%20v1)

## Built for AI agents too

Coding agents and LLM tooling can read this repo directly: [AGENTS.md](./AGENTS.md), [llms.txt](./llms.txt), [llms-full.txt](./llms-full.txt). Point an agent at `https://github.com/nirholas/solana-firsts` and it has the context it needs.

## More from the same author

- [All repositories by nirholas](https://github.com/nirholas/nirholas#readme): the full catalog, grouped by topic
- [three.ws](https://three.ws): the platform for 3D AI agents with Solana wallets, a skill marketplace and x402 payments
- Questions or ideas: [open an issue](https://github.com/nirholas/solana-firsts/issues) or [start a discussion](https://github.com/nirholas/solana-firsts/discussions)

## Contributors

[![Contributors](https://contrib.rocks/image?repo=nirholas/solana-firsts)](https://github.com/nirholas/solana-firsts/graphs/contributors)

<!-- /three.ws:growth -->
