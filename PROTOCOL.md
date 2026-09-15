# Firsts artifact protocol

Status: version 1, implemented by the Firsts web client.

Firsts stores artifact bytes directly in Solana Memo Program instructions. It does not place a storage URL in the memo. The protocol is deliberately small enough for independent clients to encode and recover without an SDK or hosted indexer.

## Content identity

The artifact ID is the first 16 lowercase hexadecimal characters of the SHA-256 digest of the original byte sequence. The full lowercase hexadecimal digest is carried in chunk zero and is authoritative.

Two files with identical bytes have the same ID regardless of filename, MIME type, transaction format, cluster, or chunk count.

## Envelope

Every chunk is one UTF-8 JSON object used as the Memo instruction data:

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

The reference client uses conservative raw-content budgets of 700 bytes for legacy transactions and 2,700 bytes for v1 transactions. Base64url expands the data, and the JSON envelope, Memo instruction, payer address, blockhash, and signature also consume transaction space. The client measures the compiled transaction before asking the wallet to sign and rejects anything above 1,232 bytes for legacy or 4,096 bytes for v1.

A v1 message sets these resource limits explicitly:

- compute unit limit: 20,000
- loaded accounts data size: 32 KiB
- priority fee: 5,000 lamports total

Wallet clients must advertise transaction version `1` through Wallet Standard before the reference client sends v1. Otherwise it replans with legacy chunks.

## Recovery algorithm

1. Fetch every supplied transaction with `maxSupportedTransactionVersion: 1`.
2. Select the Memo Program instruction and base58-decode its instruction data.
3. Parse the UTF-8 JSON and require `p` to equal `firsts/1`.
4. Require every envelope to have the same `id` and `n`.
5. Require exactly one chunk for every integer from `0` through `n - 1`.
6. Sort by `i`, base64url-decode each `data`, and concatenate the bytes.
7. Compute SHA-256 and require it to equal chunk zero's `hash`.

The reference implementation is in `src/lib/reader.ts` and has offline tests in `src/lib/reader.test.ts`.

## Token link envelope

The token creator adds a second memo in the atomic mint transaction:

```json
{
  "p": "firsts/token/1",
  "name": "First Artifact",
  "symbol": "FIRST",
  "mint": "...",
  "artifact": {
    "id": "7f83b1657ff1fc53",
    "hash": "7f83...da11"
  }
}
```

This is a content link, not Metaplex metadata, a market, liquidity, or a claim of financial value.

## Availability

Solana consensus makes confirmed transaction data immutable. RPC services can have retention and access policies. Applications that require guaranteed long-term reads should use an archival RPC provider or index the relevant Memo transactions themselves.
