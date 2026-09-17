import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Check, ChevronDown, Coins, ExternalLink, Image, KeyRound, Lock, RotateCcw, Share2, ShieldCheck, Unlock } from 'lucide-react';
import { createKeyPairSignerFromBytes, generateKeyPairSigner, type KeyPairSigner } from '@solana/kit';
import { formatBytes } from '../lib/artifacts';
import { ARTWORK_TIERS, fitArtwork, type ArtworkTier, type FittedArtwork } from '../lib/artwork';
import { METADATA_ORIGIN, tokenPagePath, type Cluster } from '../lib/config';
import { MAX_DESCRIPTION_CHARACTERS, MAX_IMAGE_TRANSACTIONS, tokenMetadataUri, type LaunchPlan } from '../lib/launch';
import {
  LaunchInterruptedError, PublishInterruptedError, executeLaunch, explorerAddressUrl, explorerUrl,
  parseTokenAmount, prepareLaunch, publishMemos,
} from '../lib/transactions';
import { shortAddress, supportsV1, type ConnectedWallet } from '../lib/wallets';
import type { VanityKeypair } from '../lib/vanity';
import { CopyButton, errorMessage, formatSol, useObjectUrl, type Notify } from './ui';

type Stage = 'idle' | 'artwork' | 'planning' | 'launching' | 'paused' | 'done';

// Everything a resumed launch needs. Kept in a ref as well as state so a step
// that fails mid-flight still records the signatures it already paid for.
interface LaunchState {
  mint: KeyPairSigner;
  artwork?: FittedArtwork;
  artSignatures: string[];
  plan?: LaunchPlan;
  launchSignatures: string[];
  nextStep: number;
}

export function TokenPanel({ connected, cluster, notify, vanity, onClearVanity, onOpenToken, onRequestWallet }: {
  connected?: ConnectedWallet;
  cluster: Cluster;
  notify: Notify;
  vanity?: VanityKeypair;
  onClearVanity: () => void;
  onOpenToken: (path: string) => void;
  onRequestWallet: () => void;
}) {
  const [name, setName] = useState('First Artifact');
  const [symbol, setSymbol] = useState('FIRST');
  const [description, setDescription] = useState('');
  const [supply, setSupply] = useState('1000000000');
  const [decimals, setDecimals] = useState(6);
  const [website, setWebsite] = useState('');
  const [x, setX] = useState('');
  const [telegram, setTelegram] = useState('');
  const [imageFile, setImageFile] = useState<File>();
  const [tier, setTier] = useState<ArtworkTier>('standard');
  const [lockSupply, setLockSupply] = useState(true);
  const [lockMetadata, setLockMetadata] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [artwork, setArtwork] = useState<FittedArtwork>();
  const [fitting, setFitting] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState('');
  const [state, setState] = useState<LaunchState>();
  const launchRef = useRef<LaunchState>(undefined);
  const mode = connected && !supportsV1(connected.wallet) ? 'legacy' : 'v1';
  const busy = stage === 'artwork' || stage === 'planning' || stage === 'launching';
  const inscribed = useMemo(() => artwork && new Blob(artwork.plan.chunks as BlobPart[], { type: artwork.mime }), [artwork]);
  const artworkUrl = useObjectUrl(inscribed);

  useEffect(() => setAccepted(false), [cluster]);

  // Refit whenever the source, tier, or wallet transaction format changes, so the
  // preview always shows the exact bytes that would be inscribed.
  useEffect(() => {
    if (!imageFile) { setArtwork(undefined); return; }
    let alive = true;
    setFitting(true);
    fitArtwork(imageFile, tier, mode, MAX_IMAGE_TRANSACTIONS)
      .then(result => { if (alive) setArtwork(result); })
      .catch((error: unknown) => {
        if (!alive) return;
        setArtwork(undefined);
        notify({ tone: 'error', message: errorMessage(error, 'Could not prepare the artwork.') });
      })
      .finally(() => { if (alive) setFitting(false); });
    return () => { alive = false; };
  }, [imageFile, mode, notify, tier]);

  const amountError = useMemo(() => {
    try { parseTokenAmount(supply, decimals); return undefined; } catch (error) { return errorMessage(error, 'Enter a valid supply.'); }
  }, [decimals, supply]);

  const update = (next: LaunchState) => { launchRef.current = next; setState({ ...next }); };
  const reset = () => { launchRef.current = undefined; setState(undefined); setStage('idle'); setProgress(''); };

  const inscribeArtwork = async (current: LaunchState, wallet: ConnectedWallet, art: FittedArtwork): Promise<void> => {
    const done = current.artSignatures.length;
    const total = art.plan.encodedChunks.length;
    if (done >= total) return;
    setStage('artwork');
    setProgress(`Inscribing artwork ${done} / ${total}`);
    const signatures = await publishMemos({
      connected: wallet,
      cluster,
      mode: art.plan.mode,
      memos: art.plan.encodedChunks.slice(done),
      onProgress: (complete, _total, signature) => {
        current.artSignatures = [...current.artSignatures, signature];
        update(current);
        setProgress(`Inscribing artwork ${done + complete} / ${total}`);
      },
    });
    current.artSignatures = [...current.artSignatures.slice(0, done), ...signatures];
    update(current);
  };

  const run = async () => {
    if (!connected) { onRequestWallet(); return; }
    if (cluster === 'mainnet' && !accepted) { notify({ tone: 'error', message: 'Confirm the irreversible mainnet warning first.' }); return; }
    if (amountError) { notify({ tone: 'error', message: amountError }); return; }
    let current = launchRef.current;
    try {
      const amount = parseTokenAmount(supply, decimals);
      if (!current) {
        const mint = vanity ? await createKeyPairSignerFromBytes(Uint8Array.from(vanity.secretKey)) : await generateKeyPairSigner();
        current = { mint, artwork, artSignatures: [], launchSignatures: [], nextStep: 0 };
        update(current);
      }
      const launch = current;
      const art = launch.artwork;
      if (art) await inscribeArtwork(launch, connected, art);
      let plan = launch.plan;
      if (!plan) {
        setStage('planning');
        setProgress('Sizing launch transactions');
        plan = await prepareLaunch({
          connected,
          cluster,
          mode,
          spec: {
            mint: launch.mint,
            name,
            symbol,
            decimals,
            amount,
            uri: tokenMetadataUri(METADATA_ORIGIN, cluster, launch.mint.address),
            description,
            links: { website, x, telegram },
            image: art ? { hash: art.plan.hash, signatures: launch.artSignatures } : undefined,
            lockSupply,
            lockMetadata,
          },
        });
        launch.plan = plan;
        update(launch);
      }
      setStage('launching');
      setProgress(`Launching ${launch.nextStep} / ${plan.transactions.length}`);
      await executeLaunch({
        connected,
        cluster,
        plan,
        startAt: launch.nextStep,
        onStep: (complete, total, signature) => {
          launch.launchSignatures = [...launch.launchSignatures, signature];
          launch.nextStep = complete;
          update(launch);
          setProgress(`Launching ${complete} / ${total}`);
        },
      });
      setStage('done');
      if (vanity) onClearVanity();
      notify({ tone: 'success', message: `$${symbol} is live on ${cluster}.` });
    } catch (error) {
      if (current && error instanceof PublishInterruptedError) {
        current.artSignatures = [...new Set([...current.artSignatures, ...error.signatures])];
        update(current);
      }
      if (current && error instanceof LaunchInterruptedError) {
        current.nextStep = error.failedStep;
        update(current);
      }
      const paid = !!current && (current.artSignatures.length > 0 || current.launchSignatures.length > 0);
      if (paid) setStage('paused');
      else reset();
      notify({ tone: 'error', message: errorMessage(error, 'The launch did not complete.') });
    }
  };

  const submit = (event: FormEvent) => { event.preventDefault(); void run(); };
  const editable = stage === 'idle';
  const mintAddress = state?.mint.address ?? vanity?.address;
  const pagePath = stage === 'done' && state ? tokenPagePath(cluster, state.mint.address) : undefined;
  const shareUrl = pagePath ? `${METADATA_ORIGIN}${pagePath}` : undefined;
  const artTransactions = artwork?.plan.chunks.length ?? 0;
  const steps = (state?.plan?.transactions.length ?? 0) + artTransactions;

  return <div className="panel-grid token-layout">
    <form className="composer" onSubmit={submit}>
      <div className="section-title">
        <div><span className="eyebrow">02 · Launch</span><h2>Launch a coin, art and all</h2></div>
        <span className="status-pill"><span /> Token-2022</span>
      </div>
      <fieldset className="plain-fieldset" disabled={!editable}>
        <div className="two-fields">
          <div className="field"><label htmlFor="token-name">Name</label><input id="token-name" value={name} maxLength={32} required onChange={event => setName(event.target.value)} /></div>
          <div className="field"><label htmlFor="token-symbol">Ticker</label><input id="token-symbol" value={symbol} maxLength={10} required onChange={event => setSymbol(event.target.value.replace(/[^a-z0-9]/giu, '').toUpperCase())} /></div>
        </div>
        <div className="field">
          <label htmlFor="token-description">Story <small className="counter">{[...description].length} / {MAX_DESCRIPTION_CHARACTERS}</small></label>
          <textarea id="token-description" rows={3} value={description} maxLength={MAX_DESCRIPTION_CHARACTERS} placeholder="Why this one is a first." onChange={event => setDescription(event.target.value)} />
        </div>
        <label className="dropzone compact">
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml" onChange={event => setImageFile(event.target.files?.[0])} />
          <span className="drop-icon">{artworkUrl ? <img src={artworkUrl} alt="" /> : <Image size={19} />}</span>
          <strong>{imageFile?.name ?? 'Add artwork, stored onchain'}</strong>
          <small>{fitting
            ? 'Fitting the image to the transaction budget'
            : artwork
              ? `${formatBytes(artwork.plan.bytes)}${artwork.resized ? ` · re-encoded to ${artwork.width}×${artwork.height}` : ' · original file'} · ${artTransactions} transaction${artTransactions === 1 ? '' : 's'}`
              : 'Optional · compressed in this browser, never uploaded to a server'}</small>
        </label>
        {imageFile && <div className="segmented" role="radiogroup" aria-label="Artwork quality">
          {(Object.keys(ARTWORK_TIERS) as ArtworkTier[]).map(id => <button type="button" role="radio" aria-checked={tier === id} key={id} className={tier === id ? 'active' : ''} onClick={() => setTier(id)}>
            <b>{ARTWORK_TIERS[id].label}</b><small>{ARTWORK_TIERS[id].hint}</small>
          </button>)}
        </div>}
        <div className="two-fields">
          <div className="field"><label htmlFor="token-supply">Supply</label><input id="token-supply" inputMode="decimal" value={supply} required aria-invalid={!!amountError} onChange={event => setSupply(event.target.value.replace(/[^\d.]/gu, ''))} /></div>
          <div className="field"><label htmlFor="token-decimals">Decimals</label><input id="token-decimals" type="number" min="0" max="9" value={decimals} required onChange={event => setDecimals(Math.max(0, Math.min(9, Number(event.target.value) || 0)))} /></div>
        </div>
        {amountError && <p className="field-error" role="alert">{amountError}</p>}
        <details className="disclosure">
          <summary>Links <ChevronDown size={14} /></summary>
          <div className="field"><label htmlFor="token-website">Website</label><input id="token-website" type="url" inputMode="url" placeholder="https://" value={website} onChange={event => setWebsite(event.target.value)} /></div>
          <div className="two-fields">
            <div className="field"><label htmlFor="token-x">X</label><input id="token-x" type="url" inputMode="url" placeholder="https://x.com/…" value={x} onChange={event => setX(event.target.value)} /></div>
            <div className="field"><label htmlFor="token-telegram">Telegram</label><input id="token-telegram" type="url" inputMode="url" placeholder="https://t.me/…" value={telegram} onChange={event => setTelegram(event.target.value)} /></div>
          </div>
        </details>
        <div className="toggle-list">
          <label className="toggle-row">
            <input type="checkbox" checked={lockSupply} onChange={event => setLockSupply(event.target.checked)} />
            <span className="toggle-icon">{lockSupply ? <Lock size={15} /> : <Unlock size={15} />}</span>
            <span><b>Fixed supply</b><small>Revoke mint authority once the supply is minted. Nobody can print more, including you.</small></span>
          </label>
          <label className="toggle-row">
            <input type="checkbox" checked={lockMetadata} onChange={event => setLockMetadata(event.target.checked)} />
            <span className="toggle-icon">{lockMetadata ? <Lock size={15} /> : <Unlock size={15} />}</span>
            <span><b>Frozen metadata</b><small>Revoke update authority. Name, artwork, and links become permanent.</small></span>
          </label>
        </div>
        <p className="mint-choice"><KeyRound size={15} />{vanity
          ? <span>Minting at <code>{shortAddress(vanity.address)}</code> from your vanity key. <button type="button" className="text-button" onClick={onClearVanity}>Use a random address</button></span>
          : <span>A fresh random mint address. Grind a memorable one under <b>Vanity keys</b> and it is used here automatically.</span>}</p>
      </fieldset>
      {cluster === 'mainnet' && editable && <label className="check-row">
        <input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />
        <span><b>I understand this is irreversible</b><small>A mainnet launch spends real SOL. It creates a token, not a market, liquidity, or any promise of value.</small></span>
      </label>}
      {stage === 'done'
        ? <button type="button" className="secondary" onClick={reset}><RotateCcw size={16} />Launch another</button>
        : <button className="primary" disabled={busy || fitting || !name || !symbol || !!amountError || (cluster === 'mainnet' && editable && !accepted)}>
          {busy
            ? <><span className="spinner" />{progress}</>
            : stage === 'paused'
              ? <><RotateCcw size={17} />Resume launch</>
              : connected ? <><Coins size={17} />Launch ${symbol || 'TOKEN'} on {cluster}</> : <><Coins size={17} />Connect a wallet to launch</>}
        </button>}
      {stage === 'paused' && <button type="button" className="text-button danger" onClick={reset}>Abandon this launch and start over</button>}
    </form>
    <aside className="receipt token-card">
      <div className="receipt-head"><span>{stage === 'done' ? 'Launched' : 'Launch plan'}</span><ShieldCheck size={19} /></div>
      <div className="coin-preview">
        <div className="coin-art">{artworkUrl ? <img src={artworkUrl} alt={`${name} artwork`} /> : <span>{symbol.slice(0, 2) || '??'}</span>}</div>
        <div><strong>{name || 'Unnamed'}</strong><small>${symbol || 'TICKER'}</small></div>
      </div>
      <dl className="metrics">
        <div><dt>Transaction format</dt><dd>{mode === 'v1' ? 'v1 · 4 KB' : 'legacy · 1.2 KB'}</dd></div>
        <div><dt>Artwork</dt><dd>{artwork ? `${artTransactions} transaction${artTransactions === 1 ? '' : 's'}` : 'None'}</dd></div>
        <div><dt>Wallet approvals</dt><dd>{steps || (mode === 'v1' ? '1 to 2' : '3 to 6')}</dd></div>
        {state?.plan && <div><dt>Mint rent</dt><dd>{formatSol(state.plan.rentLamports)} SOL</dd></div>}
        <div><dt>Supply</dt><dd>{lockSupply ? 'Fixed forever' : 'You can mint more'}</dd></div>
        <div><dt>Metadata</dt><dd>{lockMetadata ? 'Frozen forever' : 'You can edit it'}</dd></div>
        <div><dt>Freeze authority</dt><dd>None</dd></div>
      </dl>
      {mintAddress && <div className="address-row"><code>{mintAddress}</code><CopyButton value={mintAddress} label="Copy mint address" /></div>}
      {state && !!(state.artSignatures.length + state.launchSignatures.length) && <ol className="step-list">
        {state.artSignatures.map((signature, index) => <li key={signature}>
          <Check size={14} /><a href={explorerUrl(signature, cluster)} target="_blank" rel="noreferrer">Artwork {index + 1}<code>{shortAddress(signature)}</code><ExternalLink size={12} /></a>
        </li>)}
        {state.launchSignatures.map((signature, index) => <li key={signature}>
          <Check size={14} /><a href={explorerUrl(signature, cluster)} target="_blank" rel="noreferrer">Launch {index + 1}<code>{shortAddress(signature)}</code><ExternalLink size={12} /></a>
        </li>)}
      </ol>}
      {stage === 'paused' && <p className="inline-warning"><RotateCcw size={16} /> Everything confirmed so far is kept. Resuming finishes the same mint with the same artwork instead of paying for it twice.</p>}
      {stage === 'done' && state && pagePath && shareUrl && <div className="result-card">
        <div className="result-title"><Check size={17} /> ${symbol} is live</div>
        <button type="button" className="primary full" onClick={() => onOpenToken(pagePath)}>Open the token page</button>
        <div className="button-row">
          <a className="secondary link-button" href={`https://x.com/intent/post?text=${encodeURIComponent(`$${symbol} is onchain. Artwork and metadata live in the mint itself, no IPFS.`)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noreferrer"><Share2 size={15} />Post it</a>
          <a className="secondary link-button" href={explorerAddressUrl(state.mint.address, cluster)} target="_blank" rel="noreferrer"><ExternalLink size={15} />Explorer</a>
          <CopyButton value={shareUrl} label="Copy the share link" />
        </div>
      </div>}
      {editable && <p className="fineprint">Artwork, name, links, and story are written into the mint account itself. No IPFS, no pinning service, no database. Your wallet shows the exact cost before every signature.</p>}
    </aside>
  </div>;
}
