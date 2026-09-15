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

## Token creation fails after artwork succeeds

Artwork publication and token creation are separate because large artwork cannot fit atomically with mint creation. The artwork remains a valid standalone artifact. Retry only the token creation and retain the artwork manifest.

## Rollback

Roll back the static deployment to the last known build artifact. Chain writes cannot be rolled back by deploying older client code. Publish a clear incident notice if a released client constructed misleading transactions, and never claim that redeployment reverses prior writes.
