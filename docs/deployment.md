# Deployment

The production artifact is a static `dist/` directory. It can run on Cloudflare Pages or another static host without application secrets.

## Build

```bash
npm ci
npm run check
```

`npm run check` runs lint, offline protocol tests, TypeScript, and the optimized build. The Vite base is absolute (`/`) because the token page lives at a nested path, `/t/:cluster/:mint`, where relative asset URLs would resolve against the wrong directory. Deploy at a domain root, not a repository subpath.

Before promoting a build, run `npm run smoke:simulate`. It asks devnet to simulate the real inscription and launch transactions, which catches a size or compute-budget regression without spending anything.

## Cloudflare Pages

The repository includes `wrangler.toml`, security headers, and the Pages Functions in `functions/` that serve the token resolver and share cards. Wrangler deploys those functions alongside the static build; no separate step is needed. See [resolver.md](./resolver.md) for the routes.

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

The resolver reads chain state server-side and takes its endpoints from the Pages environment variables `SOLANA_RPC_MAINNET` and `SOLANA_RPC_DEVNET`. Those are not shipped to browsers, so unlike `VITE_*` values they may hold an authenticated provider URL. Without them the resolver falls back to the same public endpoints as the client.

Set `VITE_METADATA_ORIGIN` to the canonical production origin. It is baked into every launched coin's metadata URI, so a launch made from a preview deployment or localhost still points at production. Changing it later does not rewrite coins that already exist.

## Release checklist

1. Run `npm ci` from a clean checkout.
2. Run `npm audit` and require zero high or critical findings.
3. Run `npm run check`.
4. Run `npm run smoke:simulate` against devnet and confirm every transaction passes.
5. Exercise all four studio tabs at desktop and mobile widths.
6. Test devnet publishing and a devnet launch with a compatible wallet, then open the resulting `/t/devnet/<mint>` page and confirm the artwork, authorities, and metadata JSON.
7. Verify recovery from the returned signature manifest.
8. Review the mainnet warning and disabled-button states.
9. Deploy the immutable build output.
10. Confirm security headers, resolver routes, and RPC connectivity on the deployed origin.
11. Promote the tested deployment; do not rebuild between test and promotion.

Mainnet smoke transactions are deliberate external writes and are not part of automated CI.
