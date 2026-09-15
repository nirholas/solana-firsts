# Deployment

The production artifact is a static `dist/` directory. It can run on Cloudflare Pages or another static host without application secrets.

## Build

```bash
npm ci
npm run check
```

`npm run check` runs lint, offline protocol tests, TypeScript, and the optimized build. The Vite base is relative so hashed assets work on a custom domain or repository subpath.

## Cloudflare Pages

The repository includes `wrangler.toml` and security headers.

```bash
npx wrangler login
npm run build
npx wrangler pages deploy dist --project-name solana-firsts
```

Use an interactive login or a deployment secret stored by CI. Never commit or paste an API token into a command, `.env`, Wrangler configuration, issue, or build log.

## RPC configuration

Copy `.env.example` to `.env.local` and set public browser-safe endpoints if the Solana public endpoints are not sufficient:

```bash
VITE_SOLANA_RPC_DEVNET=https://devnet.example-rpc.com
VITE_SOLANA_RPC_MAINNET=https://mainnet.example-rpc.com
```

Every `VITE_*` value is shipped to browsers. Do not place credentials or paid provider keys there. For a private authenticated RPC, deploy a rate-limited same-origin proxy and add only its public URL to the client.

When changing RPC origins, update the `connect-src` directive in `public/_headers`. Otherwise the production Content Security Policy will correctly block the new origin.

## Release checklist

1. Run `npm ci` from a clean checkout.
2. Run `npm audit` and require zero high or critical findings.
3. Run `npm run check`.
4. Exercise all four studio tabs at desktop and mobile widths.
5. Test devnet publishing with a compatible wallet.
6. Verify recovery from the returned signature manifest.
7. Review the mainnet warning and disabled-button states.
8. Deploy the immutable build output.
9. Confirm security headers and RPC connectivity on the deployed origin.
10. Promote the tested deployment; do not rebuild between test and promotion.

Mainnet smoke transactions are deliberate external writes and are not part of automated CI.
