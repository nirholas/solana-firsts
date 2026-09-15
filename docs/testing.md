# Testing

## Automated checks

```bash
npm run check
```

- ESLint checks React hooks and TypeScript source.
- Vitest verifies canonical SHA-256, format-independent content identity, chunk planning, out-of-order reconstruction, and incomplete artifact rejection.
- TypeScript checks wallet, transaction, RPC, worker, and UI contracts.
- Vite proves the deployable static bundle can be produced.

## Browser smoke test

Test at 390, 768, and 1440 CSS pixels. Verify no horizontal overflow, keyboard-visible controls, reduced-motion behavior, wallet empty state, every studio tab, file limits, disabled transaction buttons, and mainnet confirmations.

## Devnet integration test

Use a dedicated disposable wallet:

1. Publish a one-chunk text artifact using legacy format.
2. Recover and verify it from its signature.
3. If the wallet advertises v1, publish content larger than the legacy budget using v1.
4. Recover it and compare the downloaded bytes byte-for-byte.
5. Create a small fixed-supply token.
6. Confirm the mint account, associated token account, initial supply, disabled freeze authority, and `firsts/token/1` memo in Explorer.

Automated tests never perform mainnet writes or use funded credentials.
