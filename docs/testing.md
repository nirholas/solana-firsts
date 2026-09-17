# Testing

## Automated checks

```bash
npm run check
```

- ESLint checks React hooks and TypeScript source.
- Vitest verifies canonical SHA-256, format-independent content identity, chunk planning, ASCII-only encoding, per-memo compute limits, out-of-order reconstruction, incomplete artifact rejection, launch packing against both wire limits, metadata and link validation, chain-read rejection cases, and vanity difficulty.
- TypeScript checks wallet, transaction, RPC, worker, and UI contracts.
- Vite proves the deployable static bundle can be produced.

## Transaction simulation

```bash
npm run smoke:simulate
```

This builds the real inscription and launch transactions and asks devnet to
simulate them, reporting bytes and compute units for each. It needs no key and
writes nothing: simulation does not verify signatures, so it borrows a live
validator address as the fee payer. Run it before every deploy. It is what
catches a transaction that fits the wire limit but exhausts its compute budget,
which is exactly how the 0.1.0 client shipped broken.

Set `SIMULATE_RPC` to use another cluster or provider, and `SIMULATE_MODES` to
check one format only.

## Browser smoke test

Test at 390, 768, and 1440 CSS pixels. Verify no horizontal overflow, keyboard-visible controls, reduced-motion behavior, wallet empty state, every studio tab, file limits, disabled transaction buttons, and mainnet confirmations.

## Devnet integration test

Use a dedicated disposable wallet:

1. Publish a one-chunk text artifact using legacy format.
2. Recover and verify it from its signature.
3. If the wallet advertises v1, publish content larger than the legacy budget using v1.
4. Recover it and compare the downloaded bytes byte-for-byte.
5. Launch a small fixed-supply coin with artwork and a frozen metadata switch.
6. Confirm in Explorer: the mint account, its associated token account, the
   initial supply, a disabled freeze authority, revoked mint and update
   authorities, and the `firsts/token/2` memo.
7. Open `/t/devnet/<mint>` and confirm the artwork renders, the badges match the
   revoked authorities, and `/api/token/devnet/<mint>` returns the same state.
8. Interrupt a legacy launch by rejecting the second wallet prompt, then resume it
   and confirm the same mint address finishes rather than a new one appearing.

`npm run smoke:devnet` automates steps 1 through 7 end to end with a funded
throwaway key. It generates and funds one from the faucet, or uses `SMOKE_KEYPAIR`
when the faucet is rate-limited, which it often is.

Automated tests never perform mainnet writes or use funded credentials.
