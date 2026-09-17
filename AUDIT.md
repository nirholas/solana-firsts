# Firsts release audit

Audit date: 2026-09-17
Release: `0.2.0`

## Scope

- Artifact planning, V1 and legacy transaction construction
- Wallet Standard connection and network selection
- Token-2022 launches: metadata written onchain, artwork linked by digest, authority revocation
- The token resolver and share page served from Cloudflare Pages Functions
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

### Critical: full-size chunks exhausted their compute budget on mainnet (found 2026-09-16)

Mainnet simulation of the published client showed every full v1 chunk failing with `exceeded CUs meter`. Each v1 message requested a fixed 20,000 compute units, but the SPL Memo program measures about 351 units per ASCII byte, so a 3,890-byte chunk needs about 1,366,000. Legacy chunks carried no Compute Budget instruction, so the 200,000-unit default covered only about 560 of their 1,050 memo bytes. Multi-byte filenames made it worse: 3- and 4-byte UTF-8 costs 3,700 to 4,300 units per byte, so 300 emoji exceed the 1,400,000-unit transaction cap on their own.

Fix: envelopes and token-link memos are now ASCII-only JSON (non-ASCII escaped as `\uXXXX`, decoded identically by any JSON parser), each chunk requests a compute limit sized to its memo with 5% headroom, legacy transactions add a `SetComputeUnitLimit` instruction, and the legacy memo budget drops from 1,050 to 1,010 bytes to make room for it. Mainnet simulation now succeeds for a full v1 chunk (1,365,563 units), a v1 chunk zero carrying a 63-emoji filename (1,368,669), a full legacy chunk (356,608), and the token transaction.

### Launch path verification (2026-09-17)

The launch path was verified by simulating the real transactions on devnet
(`npm run smoke:simulate`), which needs no funded key because simulation does not
verify signatures. Results with a 280-character description, three links, an
artwork pointer, a fixed supply, and frozen metadata:

| Transaction | Bytes | Compute units |
| --- | --- | --- |
| v1 full inscription chunk | 4,009 / 4,096 | 1,340,724 |
| v1 complete launch (one transaction) | 1,415 / 4,096 | 121,272 |
| legacy full inscription chunk | 1,220 / 1,232 | 356,758 |
| legacy launch, first of two | 1,161 / 1,232 | 83,002 |

The whole v1 launch, including both authority revocations, is one atomic
transaction. Legacy needs two or more, so a legacy launch can be interrupted
between them; the client detects that and resumes with the same mint rather than
creating a second one.

Rent is funded for the mint's final size (840 bytes with the metadata above)
before any field is written, so a metadata write can never fail for rent partway
through a launch.

### Untrusted content served from a Firsts origin

Inscribed bytes are attacker-controlled, and the resolver serves them from the
site's own origin. Artwork and artifact responses carry
`default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`, and a
cross-origin resource policy; anything that is not a known-safe image type is
sent as `application/octet-stream` with an attachment disposition, and HTML is
never rendered inline. Token names and descriptions are escaped before they enter
a social card tag.

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
- Unit tests: 35 pass, including maximum-size legacy and V1 wire envelopes, ASCII-only encoding, per-memo compute limits, launch packing against both wire limits, metadata validation, chain-read rejection cases, and vanity difficulty
- Mainnet `simulateTransaction`: full v1, full legacy, worst-case multi-byte filename, and token creation all succeed
- Devnet `simulateTransaction` (`npm run smoke:simulate`): every inscription and launch transaction succeeds in both formats, with the sizes and compute figures recorded above
- Production TypeScript and Vite build: pass
- Headless Chrome smoke: mainnet selected, publish gated before acknowledgement, gate opens after acknowledgement, mainnet RPC returns HTTP 200 with a blockhash, zero console errors
- PublicNode V1 read: successfully decoded a finalized 4,096-byte-era V1 transaction

## Accepted design boundaries

- Public RPC services remain rate-limited; sustained production traffic should use a dedicated endpoint.
- A multi-transaction artifact is not atomic as a group. Confirmed partial signatures must be retained.
- Token metadata is stored in the Token-2022 mint itself. It is read by wallets that support the extension directly, and by everything else through the resolver URI. It does not create a market, liquidity, or value.
- The resolver reads chain state on every miss and caches by authority state: permanently once metadata is frozen, briefly while it can still change.
- Mainnet bytes and mints are generally permanent. The wallet remains the final signing boundary.

## Manual funded smoke test

A deliberately funded mainnet round trip remains an operator-controlled release check: one v1 artifact, one legacy fallback artifact, recovery of both, and one standard SPL mint. Automated verification does not spend funds or request signatures. Use only a dedicated throwaway test key—never a production or user key.
