# Changelog

All notable changes are documented here. The project follows semantic versioning once the protocol client reaches 1.0.

## 0.2.0 (2026-09-17)

- Added coin launches that keep everything onchain: a Token-2022 mint carries its own name, ticker, story, links, and artwork digest, with no IPFS, pinning service, or database anywhere in the path.
- Artwork is inscribed as a `firsts/1` artifact and re-encoded in the browser to fit the transaction budget you choose, then linked to the mint by SHA-256 so any reader can verify the image really is the one the creator published.
- On a v1 wallet an entire launch, including revoking the mint and metadata authorities, lands in one atomic 4,096-byte transaction. Legacy wallets get the same result across two or more.
- Added optional fixed supply and frozen metadata, both revoked in the same sequence that mints the supply.
- Added a shareable token page at `/t/<cluster>/<mint>` that rebuilds the coin from chain state, verifies the artwork digest, and renders a social card.
- Added a resolver that serves Metaplex-style JSON and the inscribed artwork for wallets and explorers that only read a metadata URI.
- Vanity grinding now uses every spare core, reports its rate and an estimate, and a found address can be used as the mint address of the next launch.
- A launch interrupted partway can be resumed with the same mint and artwork instead of paying for them twice.

## 0.1.1 (2026-09-17)

- Fixed mainnet publishing: full v1 and legacy chunks exhausted their compute budget. Each chunk now requests compute units sized to its memo, and legacy transactions add a Compute Budget instruction.
- Envelopes are now ASCII-only JSON so non-ASCII filenames cannot exhaust the compute cap. Existing readers decode them unchanged.
- Legacy memo budget is now 1,010 bytes to fit the Compute Budget instruction.

## 0.1.0 — 2026-09-15

- Added direct `firsts/1` text, JSON, image, agent, HTML, and file publication up to 256 KB.
- Added Solana transaction v1 support with exact Wallet Standard capability checks and measured 4,096-byte wire limits.
- Added dynamically sized legacy fallback chunks under the 1,232-byte wire limit.
- Added RPC-only artifact recovery with strict envelope, signature, size, ordering, and SHA-256 verification.
- Added standard SPL mint creation with optional onchain artwork references.
- Added browser-worker vanity key generation and one-time local secret export.
- Added mainnet acknowledgement gates, transaction confirmation polling, RPC timeouts, and partial-manifest preservation.
- Added responsive Three.js UI, reduced-motion handling, accessibility metadata, security headers, CI, deployment configuration, tests, and operator documentation.
