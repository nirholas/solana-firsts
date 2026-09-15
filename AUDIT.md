# Firsts release audit

Audit date: 2026-09-15
Release: `0.1.0`

## Scope

- Artifact planning, V1 and legacy transaction construction
- Wallet Standard connection and network selection
- SPL mint creation
- RPC reads, artifact reconstruction, and integrity validation
- Browser security headers and third-party dependency health
- Clean install, lint, unit tests, typecheck, production build, and headless-browser smoke test

## Resolved findings

### High — deployed mainnet RPC requests returned HTTP 403

`https://api.mainnet-beta.solana.com` rejects browser requests carrying the deployed Cloudflare Pages origin. The Solana Kit error surfaced as `8100002`, wrapping HTTP status 403. Mainnet now uses the CORS-compatible PublicNode endpoint, recovery and writes share one endpoint map, and the CSP permits only that mainnet RPC plus Solana devnet.

### High — advertised legacy fallback exceeded Solana's wire limit

The former 700-byte raw payload produced a 1,295-byte transaction even with an ordinary filename, exceeding the 1,232-byte legacy cap. Long filenames could also push V1 chunks above 4,096 bytes. Planning now sizes each chunk against the encoded JSON Memo budget, includes variable metadata overhead, and still checks the final transaction size before wallet signing.

### High — clean installs had incompatible Solana client peers

`@solana-program/system@0.13.0` requires Solana Kit 7 while the project installs Kit 8. The System client is upgraded to `0.14.1`; `npm ci` now succeeds without `--legacy-peer-deps`.

### Medium — submitted transactions were reported as confirmed

Wallet Standard's send result supplies a signature but does not prove the transaction reached confirmed commitment. Artifact and token paths now poll signature status, reject on-chain errors and expired blockhashes, and only report success after confirmed or finalized status.

### Medium — partial multi-transaction manifests could be hidden

If a later chunk failed, earlier successful signatures were not retained in the UI. Each confirmed signature is now added to the visible recovery manifest immediately.

### Medium — recovery trusted unvalidated RPC envelope fields

Recovery now validates protocol IDs, indexes, totals, digest formats, metadata placement, base64url data, signature length, and the 256 KB protocol limit before allocation or download. It also checks that the short artifact ID matches the full SHA-256 digest and can locate a Firsts envelope when unrelated Memo instructions coexist in the transaction.

### Low — test tooling had a known path-traversal advisory

Vitest is upgraded to 5.0.0. `npm audit` reports zero known vulnerabilities.

## Mainnet-default behavior

- New sessions start on mainnet.
- The network selector lists mainnet first.
- Changing networks disconnects the current account so a wallet cannot be reused on an unsupported chain by accident.
- Both artifact and token writes require an explicit irreversible-action acknowledgement on mainnet.
- Wallet connection selects an account that advertises the chosen chain.

## Verification completed

- `npm ci`: pass without peer-dependency bypasses
- `npm audit --audit-level=moderate`: zero vulnerabilities
- `npm run check`: pass
- Unit tests: 12 pass, including maximum-size legacy and V1 wire envelopes
- Production TypeScript and Vite build: pass
- Headless Chrome smoke: mainnet selected, publish gated before acknowledgement, gate opens after acknowledgement, mainnet RPC returns HTTP 200 with a blockhash, zero console errors
- PublicNode V1 read: successfully decoded a finalized 4,096-byte-era V1 transaction

## Accepted design boundaries

- Public RPC services remain rate-limited; sustained production traffic should use a dedicated endpoint.
- A multi-transaction artifact is not atomic as a group. Confirmed partial signatures must be retained.
- Token name, symbol, and artifact link are stored in a Firsts Memo; this is not Metaplex metadata and does not create a market or liquidity.
- Mainnet bytes and mints are generally permanent. The wallet remains the final signing boundary.

## Manual funded smoke test

A deliberately funded mainnet round trip remains an operator-controlled release check: one v1 artifact, one legacy fallback artifact, recovery of both, and one standard SPL mint. Automated verification does not spend funds or request signatures. Use only a dedicated throwaway test key—never a production or user key.
