# Security policy

## Supported version

Security fixes are applied to the latest revision on `main`.

## Reporting

Do not open a public issue for a vulnerability that could expose secret keys, alter transaction intent, or mislead wallet review. Use GitHub's private vulnerability reporting for this repository.

Include the affected commit, browser and wallet versions, reproduction steps, and impact. Never include an active private key, recovery phrase, production credential, or funded test account.

## Trust boundaries

- Files and vanity keys remain in the browser.
- Wallet Standard is the only signing boundary.
- RPC responses and all onchain content are untrusted input.
- The verifier checks chunk structure and SHA-256 before offering recovered bytes for download.
- Mainnet is opt-in and token creation requires an additional irreversible-action acknowledgement.
