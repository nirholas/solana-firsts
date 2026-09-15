# Architecture

Firsts is a static, non-custodial React application. There is no API server, database, upload service, session store, or custody layer.

## Components

| Component | Responsibility | Trust boundary |
| --- | --- | --- |
| `src/App.tsx` | Creation workflows, previews, confirmations, results | Treats files, wallet state, and RPC results as untrusted |
| `src/lib/artifacts.ts` | SHA-256 identity, chunk planning, envelope encoding | Pure client-side bytes |
| `src/lib/transactions.ts` | Legacy/v1 message construction and SPL mint creation | Wallet signs; RPC submits and confirms |
| `src/lib/reader.ts` | RPC retrieval, envelope parsing, ordering, hash verification | Rejects malformed or incomplete artifacts |
| `src/lib/wallets.ts` | Wallet Standard discovery and capability checks | Never accesses secret material |
| `src/workers/vanity.worker.ts` | Ed25519 vanity search and exportable keypair construction | Isolated browser worker; secret is returned only to its page |

## Artifact write sequence

1. The browser reads the source into a `Uint8Array`.
2. SHA-256 produces a stable identity independent of transaction format.
3. The planner selects a conservative payload budget and emits `firsts/1` envelopes.
4. The wallet's advertised versions determine whether v1 is allowed. Unsupported v1 requests are replanned as legacy chunks.
5. Each fully compiled message is measured against its protocol limit before wallet review.
6. The wallet signs and sends each transaction. No signature or secret passes through a Firsts service.
7. The UI returns the transaction signatures as the recovery manifest.

Multiple chunks are ordered and hash-linked, but are not atomic as a group. A user can stop signing partway through and leave an incomplete artifact; the verifier detects and rejects it.

## Token creation sequence

One legacy transaction creates the mint account, initializes the SPL mint, creates the owner's associated token account, mints the fixed starting supply, and adds a `firsts/token/1` memo. The temporary mint signer signs locally before the wallet receives the partially signed transaction. The wallet remains mint authority; freeze authority is disabled.

Optional artwork is published first as a normal Firsts artifact. Only its ID and digest enter the token memo, keeping the mint transaction bounded. This is not Metaplex metadata and is intentionally labeled as such.

## Transaction v1

V1 is opt-in and requires a wallet advertising version `1`. Resource limits are properties of the v1 message rather than Compute Budget instructions. Firsts explicitly sets compute units, loaded-account data size, and a total priority fee. All RPC transaction reads pass `maxSupportedTransactionVersion: 1`.

## Availability model

Consensus immutability and RPC availability are different guarantees. Firsts does not promise that every public RPC endpoint retains all historical transactions. Production operators should use an archival RPC or index the Memo Program activity needed by their application.
