import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, FileJson, Globe, Link2, Lock, MessageCircle, Search, Share2, ShieldCheck, Unlock } from 'lucide-react';
import { METADATA_KEYS } from '../lib/chain-read';
import { METADATA_ORIGIN } from '../lib/config';
import { explorerAddressUrl, explorerUrl, type Cluster } from '../lib/transactions';
import { readImageForToken, readToken, type LaunchedToken, type RecoveredArtifact } from '../lib/reader';
import { shortAddress } from '../lib/wallets';
import { CopyButton, errorMessage, formatTokenAmount, useObjectUrl, type Notify } from './ui';

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; token: LaunchedToken; artwork?: RecoveredArtifact; artworkError?: string };

export function TokenPage({ cluster, mint, notify, onBack }: { cluster: Cluster; mint: string; notify: Notify; onBack: () => void }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setLoad({ status: 'loading' });
    const read = async () => {
      try {
        const token = await readToken(mint, cluster);
        if (!alive) return;
        setLoad({ status: 'ready', token });
        if (!token.image) return;
        try {
          const artwork = await readImageForToken(token, cluster);
          if (alive) setLoad({ status: 'ready', token, artwork });
        } catch (error) {
          if (alive) setLoad({ status: 'ready', token, artworkError: errorMessage(error, 'The inscribed artwork could not be verified.') });
        }
      } catch (error) {
        if (alive) setLoad({ status: 'error', message: errorMessage(error, 'This token could not be read.') });
      }
    };
    void read();
    return () => { alive = false; };
  }, [cluster, mint]);

  const artworkBlob = useMemo(
    () => load.status === 'ready' && load.artwork ? new Blob([load.artwork.bytes as BlobPart], { type: load.artwork.mime }) : undefined,
    [load],
  );
  const artworkUrl = useObjectUrl(artworkBlob);
  const shareUrl = `${METADATA_ORIGIN}/t/${cluster}/${mint}`;

  if (load.status === 'loading') {
    return <section className="token-page">
      <button type="button" className="text-button" onClick={onBack}><ArrowLeft size={15} />Back to the studio</button>
      <div className="token-hero">
        <div className="coin-art skeleton" />
        <div className="token-headline"><span className="skeleton line wide" /><span className="skeleton line" /><span className="skeleton line short" /></div>
      </div>
      <p className="fineprint centered">Reading {shortAddress(mint)} from {cluster}.</p>
    </section>;
  }

  if (load.status === 'error') {
    return <section className="token-page">
      <button type="button" className="text-button" onClick={onBack}><ArrowLeft size={15} />Back to the studio</button>
      <div className="empty-state tall">
        <Search size={28} />
        <strong>Nothing to show for this mint</strong>
        <p>{load.message}</p>
        <div className="button-row">
          <a className="secondary link-button" href={explorerAddressUrl(mint, cluster)} target="_blank" rel="noreferrer"><ExternalLink size={15} />Open in an explorer</a>
          <button type="button" className="secondary" onClick={onBack}>Launch one instead</button>
        </div>
      </div>
    </section>;
  }

  const { token, artwork, artworkError } = load;
  const description = token.metadata[METADATA_KEYS.description];
  const links = [
    { key: METADATA_KEYS.website, label: 'Website', icon: Globe },
    { key: METADATA_KEYS.x, label: 'X', icon: Share2 },
    { key: METADATA_KEYS.telegram, label: 'Telegram', icon: MessageCircle },
  ].map(item => ({ ...item, href: token.metadata[item.key] })).filter(item => !!item.href);

  return <section className="token-page">
    <button type="button" className="text-button" onClick={onBack}><ArrowLeft size={15} />Back to the studio</button>
    <div className="token-hero">
      <div className="coin-art large">
        {artworkUrl ? <img src={artworkUrl} alt={`${token.name} artwork`} /> : <span>{token.symbol.slice(0, 2) || '??'}</span>}
      </div>
      <div className="token-headline">
        <span className="eyebrow">{cluster}</span>
        <h1>{token.name}</h1>
        <p className="ticker-line">${token.symbol}</p>
        {description && <p className="lead-small">{description}</p>}
        <div className="badge-row">
          <span className={token.mintAuthority === null ? 'badge good' : 'badge'}>{token.mintAuthority === null ? <Lock size={13} /> : <Unlock size={13} />}{token.mintAuthority === null ? 'Fixed supply' : 'Mintable'}</span>
          <span className={token.updateAuthority === null ? 'badge good' : 'badge'}>{token.updateAuthority === null ? <Lock size={13} /> : <Unlock size={13} />}{token.updateAuthority === null ? 'Frozen metadata' : 'Editable metadata'}</span>
          {artwork && <span className="badge good"><ShieldCheck size={13} />Artwork verified onchain</span>}
        </div>
        <div className="address-row"><code>{token.mint}</code><CopyButton value={token.mint} label="Copy mint address" /></div>
      </div>
    </div>
    {artworkError && <p className="inline-warning"><ShieldCheck size={16} /> {artworkError}</p>}
    <div className="token-grid">
      <dl className="metrics panel">
        <div><dt>Supply</dt><dd>{formatTokenAmount(token.supply, token.decimals)}</dd></div>
        <div><dt>Decimals</dt><dd>{token.decimals}</dd></div>
        <div><dt>Token program</dt><dd>Token-2022</dd></div>
        <div><dt>Freeze authority</dt><dd>{token.freezeAuthority ? shortAddress(token.freezeAuthority) : 'None'}</dd></div>
        <div><dt>Mint authority</dt><dd>{token.mintAuthority ? shortAddress(token.mintAuthority) : 'Revoked'}</dd></div>
        <div><dt>Update authority</dt><dd>{token.updateAuthority ? shortAddress(token.updateAuthority) : 'Revoked'}</dd></div>
        {artwork && <div><dt>Artwork digest</dt><dd className="digest">{artwork.hash.slice(0, 12)}<CopyButton value={artwork.hash} label="Copy SHA-256" /></dd></div>}
      </dl>
      <div className="panel">
        <h2 className="panel-title">Where this lives</h2>
        <p className="lead-small">Name, ticker, story, links{token.image ? ', and every byte of the artwork' : ''} are stored in Solana accounts and transactions. This page only reads them back and checks the hash.</p>
        <div className="link-column">
          {links.map(item => <a key={item.key} className="row-link" href={item.href} target="_blank" rel="noreferrer noopener"><item.icon size={15} />{item.label}<ExternalLink size={13} /></a>)}
          <a className="row-link" href={explorerAddressUrl(token.mint, cluster)} target="_blank" rel="noreferrer"><Link2 size={15} />Mint account<ExternalLink size={13} /></a>
          <a className="row-link" href={token.uri} target="_blank" rel="noreferrer"><FileJson size={15} />Metadata JSON<ExternalLink size={13} /></a>
          {token.image?.signatures.map((signature, index) => <a key={signature} className="row-link" href={explorerUrl(signature, cluster)} target="_blank" rel="noreferrer">
            <ShieldCheck size={15} />Artwork transaction {index + 1}<code>{shortAddress(signature)}</code><ExternalLink size={13} />
          </a>)}
        </div>
        <div className="button-row">
          <a className="secondary link-button" href={`https://x.com/intent/post?text=${encodeURIComponent(`$${token.symbol} lives entirely onchain.`)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer"><Share2 size={15} />Post it</a>
          <button type="button" className="secondary" onClick={() => { void navigator.clipboard.writeText(shareUrl); notify({ tone: 'success', message: 'Share link copied.' }); }}>Copy link</button>
        </div>
      </div>
    </div>
  </section>;
}
