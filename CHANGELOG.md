# Changelog

All notable changes are documented here. The project follows semantic versioning once the protocol client reaches 1.0.

## 0.1.0 — 2026-09-15

- Added direct `firsts/1` text, JSON, image, agent, HTML, and file publication up to 256 KB.
- Added Solana transaction v1 support with exact Wallet Standard capability checks and measured 4,096-byte wire limits.
- Added dynamically sized legacy fallback chunks under the 1,232-byte wire limit.
- Added RPC-only artifact recovery with strict envelope, signature, size, ordering, and SHA-256 verification.
- Added standard SPL mint creation with optional onchain artwork references.
- Added browser-worker vanity key generation and one-time local secret export.
- Added mainnet acknowledgement gates, transaction confirmation polling, RPC timeouts, and partial-manifest preservation.
- Added responsive Three.js UI, reduced-motion handling, accessibility metadata, security headers, CI, deployment configuration, tests, and operator documentation.
