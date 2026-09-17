# Architecture

Firsts is a static, non-custodial React application. There is no API server, database, upload service, session store, or custody layer.

## Components

| Component | Responsibility | Trust boundary |
| --- | --- | --- |
| `src/App.tsx` | Shell, routing, wallet state, the inscribe and verify workflows | Treats files, wallet state, and RPC results as untrusted |
| `src/components/TokenPanel.tsx` | Launch form, artwork fitting, progress, resume | Never holds a secret other than the optional mint key |
| `src/components/TokenPage.tsx` | `/t/:cluster/:mint`, rendered from chain state | Renders artwork only after its digest verifies |
| `src/components/VanityPanel.tsx` | Multi-core address grinding and one-time export | The found secret stays in the page and is never sent |
| `src/lib/artifacts.ts` | SHA-256 identity, chunk planning, ASCII envelope encoding, per-memo compute limits | Pure client-side bytes |
| `src/lib/artwork.ts` | Re-encodes an image to the largest rendition that fits the chosen budget | Canvas only; the original file never leaves the browser |
| `src/lib/messages.ts` | Legacy and v1 memo message construction | Wallet signs; RPC submits and confirms |
| `src/lib/launch.ts` | Token-2022 instruction groups, wire-limit packing, rent sizing | Validates every field before a wallet sees it |
| `src/lib/transactions.ts` | Sending, confirming, and resuming interrupted work | Wallet signs; RPC submits and confirms |
| `src/lib/chain-read.ts` | Environment-free chain reads shared by the browser and the resolver | Rejects malformed, incomplete, or mismatched state |
| `src/lib/reader.ts` | Browser-side binding of chain reads to the selected cluster | Rejects malformed or incomplete artifacts |
| `src/lib/wallets.ts` | Wallet Standard discovery and capability checks | Never accesses secret material |
| `src/workers/vanity.worker.ts` | Ed25519 vanity search and exportable keypair construction | Isolated browser worker; secret is returned only to its page |
| `functions/` | Token resolver, artwork, artifact, and share-card routes | Serves untrusted onchain bytes sandboxed, from chain state only |

## Artifact write sequence

1. The browser reads the source into a `Uint8Array`.
2. SHA-256 produces a stable identity independent of transaction format.
3. The planner selects a conservative payload budget and emits `firsts/1` envelopes.
4. The wallet's advertised versions determine whether v1 is allowed. Unsupported v1 requests are replanned as legacy chunks.
5. Each fully compiled message is measured against its protocol limit before wallet review.
6. The wallet signs and sends each transaction. No signature or secret passes through a Firsts service.
7. The UI returns the transaction signatures as the recovery manifest.

Multiple chunks are ordered and hash-linked, but are not atomic as a group. A user can stop signing partway through and leave an incomplete artifact; the verifier detects and rejects it.

## Launch sequence

1. Optional artwork is fitted in the browser to the transaction budget the creator
   picked, then inscribed as an ordinary `firsts/1` artifact. Its signatures are
   kept even if the rest of the launch fails.
2. The planner builds ordered instruction groups that must not be split: create
   and initialize the mint with the metadata extensions, write each metadata
   field, create the owner's associated token account and mint the supply, then
   the optional authority revocations.
3. Rent is funded for the mint's final size, because writing metadata reallocates
   the account. A launch can never stall for rent partway through.
4. Groups are packed greedily into the fewest transactions that fit the wire
   limit, never reordered. A v1 launch is normally one atomic transaction; legacy
   takes two or more.
5. The temporary mint signer signs locally, then the wallet signs and sends.
6. Progress is recorded per transaction, so an interrupted launch resumes with the
   same mint and artwork rather than creating a second one.

The mint carries `MetadataPointer` and `TokenMetadata` extensions aimed at itself,
so name, ticker, story, links, and the artwork digest are chain state, not a
hosted file. See [PROTOCOL.md](../PROTOCOL.md) for the exact keys and
[resolver.md](./resolver.md) for how other clients read them.

## Transaction v1

V1 is opt-in and requires a wallet advertising version `1`. Resource limits are properties of the v1 message rather than Compute Budget instructions. Firsts explicitly sets compute units, loaded-account data size, and a total priority fee, and requests the same budget with a Compute Budget instruction on the legacy path. The compute limit is sized from the memo's own length, because the Memo program charges about 351 units per byte: a fixed limit either starves a full chunk or overpays for a short one. All RPC transaction reads pass `maxSupportedTransactionVersion: 1`.

## Availability model

Consensus immutability and RPC availability are different guarantees. Firsts does not promise that every public RPC endpoint retains all historical transactions. Production operators should use an archival RPC or index the Memo Program activity needed by their application.
