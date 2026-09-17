# Resolver API

Wallets and explorers expect a token's metadata at an HTTPS URI, and social
platforms expect an image they can fetch. A Firsts coin keeps all of that in the
mint account instead, so the resolver exists to translate: it reads chain state
on request and renders it in the shapes those clients already understand. It
stores nothing. Delete the deployment and every coin keeps working for any client
that reads the mint directly.

The resolver is a set of Cloudflare Pages Functions in `functions/`, deployed
with the site. It shares its reading code with the browser (`src/lib/chain-read.ts`),
so the site and the resolver can never disagree about what a coin says.

`:cluster` is `mainnet` or `devnet` in every route below.

## `GET /api/token/:cluster/:mint`

Metaplex-style JSON generated from the mint account. This is the URI written into
`TokenMetadata.uri` at launch.

```bash
curl https://solana-firsts.pages.dev/api/token/mainnet/<mint>
```

```json
{
  "name": "First Artifact",
  "symbol": "FIRST",
  "description": "A first.",
  "image": "https://solana-firsts.pages.dev/api/token/mainnet/<mint>/image",
  "external_url": "https://solana-firsts.pages.dev/t/mainnet/<mint>",
  "extensions": { "website": "https://example.com" },
  "properties": { "category": "image", "files": [{ "uri": "...", "type": "image" }] },
  "attributes": [
    { "trait_type": "Supply locked", "value": "yes" },
    { "trait_type": "Metadata locked", "value": "yes" },
    { "trait_type": "Artwork", "value": "Inscribed onchain" }
  ],
  "firsts": {
    "protocol": "token/2",
    "cluster": "mainnet",
    "mint": "<mint>",
    "decimals": 6,
    "supply": "1000000000000000",
    "mint_authority": null,
    "freeze_authority": null,
    "update_authority": null,
    "image_sha256": "7f83…da11",
    "image_transactions": ["…"]
  }
}
```

The `firsts` block is the part a careful client should use: it names the exact
transactions holding the artwork and the digest they must produce, so the image
can be verified without trusting this endpoint at all.

A trailing `.json` is accepted, because some clients append one.

## `GET /api/token/:cluster/:mint/image`

The inscribed artwork, rebuilt from its transactions. The bytes are served only
after their SHA-256 matches the digest stored in the mint, so a compromised RPC
cannot swap the image. Types outside the known-safe image set are sent as
`application/octet-stream`. Responses carry `ETag` and `X-Firsts-Sha256`.

Returns 404 when the coin has no inscribed artwork, and 422 when the recovered
bytes do not match the digest in the mint.

## `GET /api/artifact/:cluster?tx=<sig>,<sig>`

Any `firsts/1` artifact, not just token artwork, rebuilt from a recovery
manifest. Up to 100 signatures per request. Because a manifest names exact
transactions, a successful response is immutable and is cached for a year.

```bash
curl -o recovered.webp "https://solana-firsts.pages.dev/api/artifact/mainnet?tx=5KtP…,3QsA…"
```

Images, plain text, JSON, audio, and video are served inline; everything else,
including HTML, downloads as an attachment. Every response is sandboxed by
`Content-Security-Policy: default-src 'none'; sandbox`, because inscribed bytes
are attacker-controlled and are served from this site's own origin.

## `GET /t/:cluster/:mint`

The human-facing token page. The function serves the normal site shell with the
social card tags rewritten from chain state, so a posted link previews the coin's
real name, story, and artwork. The page itself is rendered in the browser from
the same chain reads.

## Caching

Responses are cached by what can still change. Once a coin's update authority is
revoked its metadata is permanent, so JSON and artwork are served
`immutable` for a year. While an update authority still exists, JSON is cached
for five minutes with `stale-while-revalidate`, because the owner can rewrite a
field at any time.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | The cluster is not `mainnet` or `devnet`, or a manifest was not supplied |
| 404 | No such account, not a Token-2022 mint, no embedded metadata, or no inscribed artwork |
| 413 | More than 100 signatures in one artifact request |
| 422 | Chain data is inconsistent: a digest mismatch, an incomplete manifest, or metadata naming a different mint |
| 502 | The upstream RPC failed or timed out |

Errors are JSON (`{"error": "..."}`) and are never cached.

## Configuration

Set `SOLANA_RPC_MAINNET` and `SOLANA_RPC_DEVNET` as Pages environment variables
to use dedicated endpoints. Without them the resolver uses the same public
endpoints as the browser, which are rate-limited. These are server-side values
and are never shipped to the browser, so unlike `VITE_*` variables they may point
at an authenticated provider URL.
