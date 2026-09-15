# Contributing

Use Node.js 22 or newer. Install with `npm ci`, create a focused branch, and run `npm run check` before opening a pull request.

Changes to the envelope require an update to `PROTOCOL.md`, recovery tests, and compatibility reasoning. Changes that initiate a transaction must preserve the preview-and-wallet-review boundary, default to mainnet with an explicit irreversible-action acknowledgement, and must never accept or transmit a secret key.

Do not add sample mainnet token addresses, financial promises, analytics trackers, or fallback fake data.
