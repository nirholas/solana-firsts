import { METADATA_KEYS } from '../../../src/lib/chain-read';
import { loadToken, parseCluster, type Env } from '../../_lib/http';

type Context = { request: Request; env: Env; params: Record<string, string | string[]>; next(): Promise<Response> };

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/gu, character => `&#${character.charCodeAt(0)};`);
}

// Shareable token page. The SPA renders the token; this handler only rewrites
// the social card tags so a posted link previews the inscribed artwork.
export async function onRequestGet(context: Context): Promise<Response> {
  const url = new URL(context.request.url);
  const shell = await context.env.ASSETS.fetch(new URL('/', url.origin).toString());
  const headers = new Headers(shell.headers);
  headers.set('cache-control', 'public, max-age=60');
  let html = await shell.text();
  try {
    const cluster = parseCluster(context.params.cluster);
    const token = await loadToken(context.env, cluster, String(context.params.mint));
    const title = `${token.name} ($${token.symbol}) · inscribed on Solana`;
    const description = token.metadata[METADATA_KEYS.description]
      || `${token.symbol} is a Token-2022 coin whose metadata${token.image ? ' and artwork are' : ' is'} stored fully onchain.`;
    // Only inscribed artwork can back a card image; there is no house fallback
    // image to serve, and an og:image pointing at nothing renders as a broken card.
    const image = token.image ? `${url.origin}/api/token/${cluster}/${token.mint}/image` : undefined;
    const tags = [
      `<meta property="og:title" content="${escapeAttribute(title)}" />`,
      `<meta property="og:description" content="${escapeAttribute(description)}" />`,
      `<meta property="og:url" content="${escapeAttribute(url.toString())}" />`,
      '<meta property="og:type" content="website" />',
      `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
      `<meta name="twitter:title" content="${escapeAttribute(title)}" />`,
      `<meta name="twitter:description" content="${escapeAttribute(description)}" />`,
      ...(image ? [
        `<meta property="og:image" content="${escapeAttribute(image)}" />`,
        `<meta name="twitter:image" content="${escapeAttribute(image)}" />`,
      ] : []),
    ].join('\n    ');
    html = html
      .replace(/<meta (property="og:|name="twitter:)[^>]*>\s*/gu, '')
      .replace(/<title>[^<]*<\/title>/u, `<title>${escapeAttribute(title)}</title>`)
      .replace('</head>', `    ${tags}\n  </head>`);
  } catch {
    // Unknown or malformed mints still get the studio shell, which explains the error in-page.
  }
  return new Response(html, { status: 200, headers });
}
