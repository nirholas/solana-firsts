# Firsts artifact protocol

Status: version 1, implemented by the Firsts web client.

Firsts stores artifact bytes directly in Solana Memo Program instructions. It does not place a storage URL in the memo. The protocol is deliberately small enough for independent clients to encode and recover without an SDK or hosted indexer.

## Content identity

The artifact ID is the first 16 lowercase hexadecimal characters of the SHA-256 digest of the original byte sequence. The full lowercase hexadecimal digest is carried in chunk zero and is authoritative.

Two files with identical bytes have the same ID regardless of filename, MIME type, transaction format, cluster, or chunk count.

## Envelope

Every chunk is one JSON object used as the Memo instruction data. Writers must emit ASCII-only JSON: every character from U+007F upward is written as a `\uXXXX` escape (surrogate pairs as two escapes). `JSON.parse` restores the identical string, so readers need no special handling. This matters for cost: the SPL Memo program measures about 351 compute units per ASCII byte on mainnet, but 3,700 to 4,300 per byte of 3- and 4-byte UTF-8, so a short emoji filename could otherwise exhaust a transaction's compute cap.

```json
{
  "p": "firsts/1",
  "id": "7f83b1657ff1fc53",
  "i": 0,
  "n": 2,
  "name": "artifact.webp",
  "mime": "image/webp",
  "hash": "7f83b1657ff1fc53b92dc18148a1d65dfa13514dcfd4f1f47ab49f22bbecda11",
  "data": "UklGR..."
}
```

Fields:

- `p`: protocol identifier, exactly `firsts/1`.
- `id`: 16-character abbreviated content digest.
- `i`: zero-based chunk index.
- `n`: total chunks in the artifact.
- `name`: original filename, present only on chunk zero.
- `mime`: media type, present only on chunk zero.
- `hash`: full SHA-256 content digest, present only on chunk zero.
- `data`: unpadded base64url encoding of this chunk's raw bytes.

Unknown fields must be ignored so compatible additions can be made without changing the protocol identifier.

## Transaction formats

The reference client dynamically sizes raw chunks against conservative encoded Memo budgets of 1,010 bytes for legacy transactions and 3,890 bytes for v1 transactions. This accounts for base64url expansion and variable filename, MIME, digest, and chunk-index metadata. The client also measures the compiled transaction before asking the wallet to sign and rejects anything above 1,232 bytes for legacy or 4,096 bytes for v1.

Every chunk requests a compute unit limit sized to its memo: `min(1,400,000, ceil((1,400 + 352 * memoBytes) * 1.05))`. A memo whose estimate exceeds 1,400,000 units is refused before signing. A full 3,890-byte v1 chunk consumes about 1,366,000 units.

A v1 message sets these resource limits explicitly:

- compute unit limit: sized per memo as above
- loaded accounts data size: 256 KiB
- priority fee: 5,000 lamports total

A legacy message carries a Compute Budget `SetComputeUnitLimit` instruction with the same sized limit ahead of the Memo instruction. Without it, the 200,000-unit default only covers about 560 memo bytes.

Wallet clients must advertise transaction version `1` through Wallet Standard before the reference client sends v1. Otherwise it replans with legacy chunks.

## Recovery algorithm

1. Fetch every supplied transaction with `maxSupportedTransactionVersion: 1`.
2. Select the Memo Program instruction and base58-decode its instruction data. Ignore Compute Budget and any other instructions.
3. Parse the JSON (ASCII is valid UTF-8) and require `p` to equal `firsts/1`.
4. Require every envelope to have the same `id` and `n`.
5. Require exactly one chunk for every integer from `0` through `n - 1`.
6. Sort by `i`, base64url-decode each `data`, and concatenate the bytes.
7. Compute SHA-256 and require it to equal chunk zero's `hash`.

The reference implementation is in `src/lib/reader.ts` and has offline tests in `src/lib/reader.test.ts`.

## Token metadata (`firsts/token/2`)

A Firsts coin is a Token-2022 mint that carries its own metadata. There is no
Metaplex account, no off-chain JSON of record, and no pinning service: the name,
ticker, and every extra field live in the mint account through the
`MetadataPointer` and `TokenMetadata` extensions, with the pointer aimed at the
mint itself.

The mint is created with these extensions, and the creating transaction also
carries one memo so the launch is findable by memo scan:

```json
{ "p": "firsts/token/2", "mint": "...", "cluster": "mainnet" }
```

`TokenMetadata.additionalMetadata` holds the rest as string pairs:

| Key | Meaning |
| --- | --- |
| `firsts` | Protocol marker, exactly `token/2` |
| `description` | Up to 280 characters of plain text |
| `website`, `x`, `telegram` | Absolute `https://` URLs, at most 200 characters each |
| `image_sha256` | Lowercase SHA-256 of the artwork bytes |
| `image_tx` | Space-separated `firsts/1` transaction signatures holding those bytes |

`TokenMetadata.uri` points at a resolver that renders the same state as
Metaplex-style JSON for wallets that only understand a URI. The URI is a
convenience; the mint account is the source of truth. A reader that distrusts
the resolver can rebuild every field, including the image, from chain data
alone.

### Reading a coin

1. `getAccountInfo` with `jsonParsed` encoding and require the Token-2022 program
   as the account owner.
2. Require the `metadataPointer` extension to point at the mint itself, and the
   `tokenMetadata` extension to name the same mint. Either mismatch means the
   metadata belongs to another account and must be rejected.
3. Read `additionalMetadata` pairs.
4. If `image_sha256` and `image_tx` are both present and well formed, recover the
   artwork with the `firsts/1` algorithm above and require the digest to match
   before rendering a single byte.

### Authorities

A launch may revoke the mint authority (fixed supply) and the metadata update
authority (frozen metadata) in the same atomic sequence that created them. Both
revocations come last, after the supply is minted and every field is written.
A reader reports `mintAuthority: null` as a fixed supply and
`updateAuthority: null` as permanent metadata.

### Transactions

The launch is an ordered list of instruction groups that must not be split:
create and initialize the mint, write each metadata field, create the owner's
associated token account and mint the supply, then the optional revocations. The
client packs those groups into the fewest transactions that fit the format's
wire limit, never reordering them. On v1 a complete launch, artwork pointer and
both revocations included, fits in a single 4,096-byte transaction; on legacy it
takes two or more. Because the mint account is reallocated as metadata is
written, rent is funded for the final size up front, and the transactions
request a compute limit above the 200,000-unit default.

This is a token with metadata. It is not a market, liquidity, a bonding curve,
or a claim of financial value.

## Availability

Solana consensus makes confirmed transaction data immutable. RPC services can have retention and access policies. Applications that require guaranteed long-term reads should use an archival RPC provider or index the relevant Memo transactions themselves.
