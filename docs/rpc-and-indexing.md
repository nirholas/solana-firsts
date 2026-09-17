# RPC and indexing

Firsts writes artifact bytes to Solana Memo Program instructions and reads them through standard JSON-RPC. There is no Firsts API or database.

## Browser endpoints

The defaults live in `src/lib/config.ts`. Override them with `VITE_SOLANA_RPC_DEVNET` and `VITE_SOLANA_RPC_MAINNET`; only HTTPS URLs without embedded credentials are accepted. Because Vite substitutes these values into a public JavaScript bundle, they must never contain secrets.

Update `public/_headers` whenever an endpoint origin changes. Its Content Security Policy intentionally allows connections only to the configured default RPC origins.

## Reading v1 transactions

Call `getTransaction` with JSON encoding and `maxSupportedTransactionVersion: 1`. A reader must inspect every Memo Program instruction because another application memo may coexist with the Firsts envelope. Treat RPC data as untrusted: validate field shapes and bounds, require a complete contiguous chunk set, cap decoded bytes, then verify SHA-256.

## Reading a coin

A launched coin is read with `getAccountInfo` using `jsonParsed` encoding. Require
the Token-2022 program as the owner, require the `metadataPointer` extension to
aim at the mint itself, and require the `tokenMetadata` extension to name the same
mint. Those two checks are what stop a mint from claiming another account's
metadata. Artwork is recovered from the signatures in `image_tx` and must hash to
`image_sha256` before it is rendered. The shared implementation is
`src/lib/chain-read.ts`, used unchanged by both the browser and the resolver.

An indexer that wants a feed of launches can scan the Memo Program for
`{"p":"firsts/token/2"}` payloads, then read each named mint for its current
state. The memo records that a launch happened; the mint account is the truth
about what it says now.

## Retention and production traffic

Consensus confirmation does not guarantee that a particular public RPC retains transaction history forever. A production indexer should record transaction signatures and validated `firsts/1` envelopes, while continuing to use the transaction and its digest as the source of truth. Sustained browser traffic needs a CORS-enabled, rate-limited endpoint or a same-origin proxy that keeps provider credentials server-side.

## Health checks

Operators should monitor an HTTP 200 response and a valid result for `getLatestBlockhash` on each cluster. Alert separately on transport errors, rate limits, JSON-RPC errors, and missing historical transactions; they have different remedies. Never retry a timed-out write blindly—check its signature first to avoid duplicate or partial publication.
