# Operations runbook

## Client does not detect a wallet

Confirm that the extension is unlocked, implements Wallet Standard, and exposes a Solana account. Reload after installing a new extension. Firsts does not inject or emulate a wallet.

## Wallet rejects transaction v1

The installed wallet version may not advertise version `1`. Firsts automatically replans the artifact using legacy chunks. Updating the wallet can reduce the number of signing prompts.

## RPC returns `-32015`

Readers must opt into v1 responses. Firsts passes `maxSupportedTransactionVersion: 1`; custom indexers and debugging calls must do the same.

## RPC rate limits or CORS failures

Public endpoints are for development and light traffic. Configure a browser-safe dedicated endpoint, update CSP `connect-src`, and verify that the provider permits requests from the production origin. Never expose an RPC secret in a `VITE_*` variable.

## Artifact recovery reports missing chunks

Compare the recovery signature list with the publish result. Each planned chunk requires a confirmed transaction. Signing only part of the sequence produces an intentionally invalid, incomplete artifact.

## SHA-256 verification fails

Do not download or render the result. Confirm that every signature belongs to the same artifact and cluster. A mismatch means the supplied manifest is wrong or an RPC decoder returned unexpected instruction data.

## A launch stopped partway

Artwork is inscribed before the mint exists, and a legacy launch spans several
transactions, so a launch can stop with real work already paid for. The studio
keeps every confirmed signature and the mint key for that session: **Resume
launch** continues from the next unfinished step with the same mint and artwork.
Starting over instead creates a second mint and pays for the artwork twice.

Resume state lives in the page. Reloading the tab loses it, and the partial mint
is then an abandoned account: an initialized mint with no supply, or one whose
metadata is incomplete. Nothing else is at risk, but the rent is spent.

## A coin's artwork will not render

The resolver returns 422 when the bytes recovered from `image_tx` do not hash to
the `image_sha256` recorded in the mint. That means the manifest in the metadata
is wrong or incomplete, not that the image is corrupt in transit. Check each
listed signature on the cluster the coin was launched on. The coin itself is
unaffected; only the artwork pointer is broken, and it can be rewritten while an
update authority still exists.

## A wallet shows the coin without its metadata

Wallets that do not read the Token-2022 metadata extension fall back to the
metadata URI. Confirm `/api/token/<cluster>/<mint>` returns JSON, that the
resolver's RPC endpoints are configured, and that the URI baked into the coin
points at the production origin rather than a preview deployment. A coin launched
with the wrong `VITE_METADATA_ORIGIN` keeps that URI forever unless its update
authority is still live.

## Rollback

Roll back the static deployment to the last known build artifact. Chain writes cannot be rolled back by deploying older client code. Publish a clear incident notice if a released client constructed misleading transactions, and never claim that redeployment reverses prior writes.
