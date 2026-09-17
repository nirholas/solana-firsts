import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowRight, Box, Check, ChevronDown, CircleHelp, Coins, Copy, Download,
  ExternalLink, FileCode2, Fingerprint, Github, Image, KeyRound, Layers3,
  Menu, Orbit, Rocket, Search, ShieldCheck, Sparkles, Upload, Wallet, X,
} from 'lucide-react';
import * as THREE from 'three';
import { formatBytes, planArtifact, type ArtifactKind, type ArtifactPlan, type TransactionMode } from './lib/artifacts';
import { isAddress } from './lib/chain-read';
import { CLUSTERS, tokenPagePath } from './lib/config';
import { readArtifact, type RecoveredArtifact } from './lib/reader';
import { DEFAULT_CLUSTER, explorerUrl, PublishInterruptedError, publishMemos, type Cluster } from './lib/transactions';
import type { VanityKeypair } from './lib/vanity';
import { canSignAndSend, connectWallet, disconnectWallet, getSolanaWallets, shortAddress, subscribeWallets, supportsV1, type ConnectedWallet } from './lib/wallets';
import { CopyButton, downloadBlob, errorMessage, useObjectUrl, type Notice, type Notify } from './components/ui';
import { TokenPage } from './components/TokenPage';
import { TokenPanel } from './components/TokenPanel';
import { VanityPanel } from './components/VanityPanel';

type StudioTab = 'inscribe' | 'token' | 'vanity' | 'verify';
type Route = { name: 'studio' } | { name: 'token'; cluster: Cluster; mint: string };

// Token pages are real URLs so a launch can be shared. Everything else is the
// single studio route, which keeps the whole app one static bundle.
function parseRoute(pathname: string): Route {
  const [, root, cluster, mint] = pathname.split('/');
  if (root === 't' && CLUSTERS.includes(cluster as Cluster) && mint && isAddress(mint)) {
    return { name: 'token', cluster: cluster as Cluster, mint };
  }
  return { name: 'studio' };
}

const kinds: Array<{ id: ArtifactKind; label: string; icon: typeof Image; accept?: string }> = [
  { id: 'text', label: 'Text', icon: FileCode2 },
  { id: 'json', label: 'JSON', icon: Layers3 },
  { id: 'image', label: 'Image', icon: Image, accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' },
  { id: 'agent', label: 'Agent', icon: Orbit },
  { id: 'html', label: 'HTML', icon: Box },
  { id: 'file', label: 'File', icon: Upload },
];

function ThreeField() {
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mount.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const host = mount.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.1, 100);
    camera.position.z = 8;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);
    const group = new THREE.Group();
    scene.add(group);
    const geometry = new THREE.IcosahedronGeometry(1, 2);
    for (let index = 0; index < 14; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 4 === 0 ? 0x91ffb5 : 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: index % 4 === 0 ? 0.17 : 0.07,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const angle = index * 2.399;
      const radius = 2.2 + (index % 5) * 0.82;
      mesh.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.55, (index % 3) - 1);
      mesh.scale.setScalar(0.25 + (index % 4) * 0.13);
      group.add(mesh);
    }
    let pointerX = 0;
    let pointerY = 0;
    const onPointer = (event: PointerEvent) => {
      pointerX = event.clientX / window.innerWidth - 0.5;
      pointerY = event.clientY / window.innerHeight - 0.5;
    };
    const onResize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', onResize);
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      group.rotation.y += 0.0012;
      group.rotation.x += (pointerY * 0.08 - group.rotation.x) * 0.018;
      group.position.x += (pointerX * 0.7 - group.position.x) * 0.015;
      for (const [index, object] of group.children.entries()) object.rotation.x += 0.001 + index * 0.00008;
      renderer.render(scene, camera);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      geometry.dispose();
      group.children.forEach(child => {
        const material = (child as THREE.Mesh).material;
        if (Array.isArray(material)) material.forEach(item => item.dispose());
        else if (material instanceof THREE.Material) material.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return <div className="three-field" ref={mount} aria-hidden="true" />;
}

function Logo({ onHome }: { onHome?: () => void }) {
  return <a className="logo" href="/" aria-label="Firsts home" onClick={event => { if (!onHome) return; event.preventDefault(); onHome(); }}><span className="logo-mark"><span /></span><span>firsts</span><b>.fun</b></a>;
}

function WalletModal({ onClose, onConnect }: { onClose: () => void; onConnect: (wallet: ReturnType<typeof getSolanaWallets>[number]) => void }) {
  const [wallets, setWallets] = useState(() => [...getSolanaWallets()]);
  useEffect(() => {
    const unsubscribe = subscribeWallets(() => setWallets([...getSolanaWallets()]));
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', closeOnEscape);
    return () => { unsubscribe(); window.removeEventListener('keydown', closeOnEscape); };
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
      <div className="modal-head"><div><span className="eyebrow">Identity layer</span><h2 id="wallet-title">Connect a Solana wallet</h2></div><button className="icon-button" aria-label="Close wallet dialog" onClick={onClose}><X size={18} /></button></div>
      <p className="muted">Firsts uses Wallet Standard. Keys never touch our servers and every write is previewed before your wallet signs it.</p>
      <div className="wallet-list">
        {wallets.map(wallet => <button key={wallet.name} className="wallet-option" disabled={!canSignAndSend(wallet)} onClick={() => onConnect(wallet)}>
          {wallet.icon ? <img src={wallet.icon} alt="" /> : <span className="wallet-fallback"><Wallet size={20} /></span>}
          <span><strong>{wallet.name}</strong><small>{!canSignAndSend(wallet) ? 'Read-only · signing unavailable' : supportsV1(wallet) ? 'v1 ready · up to 4 KB' : 'legacy transactions'}</small></span><ArrowRight size={18} />
        </button>)}
        {!wallets.length && <div className="empty-state"><Wallet size={26} /><strong>No compatible wallet detected</strong><p>Install or unlock a Solana Wallet Standard extension, then reopen this dialog.</p></div>}
      </div>
      <div className="trust-row"><ShieldCheck size={16} /> Non-custodial · no tracking · open protocol</div>
    </section>
  </div>;
}

function InscribePanel({ connected, cluster, notify }: { connected?: ConnectedWallet; cluster: Cluster; notify: (notice: Notice) => void }) {
  const [kind, setKind] = useState<ArtifactKind>('text');
  const [text, setText] = useState('The first permanent idea of its kind.');
  const [file, setFile] = useState<File>();
  const [mode, setMode] = useState<TransactionMode>('v1');
  const [plan, setPlan] = useState<ArtifactPlan>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [signatures, setSignatures] = useState<string[]>([]);
  const [accepted, setAccepted] = useState(false);
  const previewUrl = useObjectUrl(kind === 'image' ? file : undefined);
  const v1Ready = connected ? supportsV1(connected.wallet) : true;
  const effectiveMode = mode === 'v1' && connected && !v1Ready ? 'legacy' : mode;

  useEffect(() => setAccepted(false), [cluster]);

  useEffect(() => {
    let alive = true;
    const produce = async () => {
      const source = file ? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode(text);
      const inferredMime = file?.type || ({ text: 'text/plain', json: 'application/json', agent: 'application/json', html: 'text/html' } as Partial<Record<ArtifactKind, string>>)[kind] || 'application/octet-stream';
      const name = file?.name || ({ text: 'thought.txt', json: 'data.json', agent: 'agent.json', html: 'index.html', image: 'image.bin', file: 'artifact.bin' } as Record<ArtifactKind, string>)[kind];
      try {
        const next = await planArtifact({ bytes: source, kind, name, mime: inferredMime, mode: effectiveMode });
        if (alive) setPlan(next);
      } catch (error) {
        if (alive) { setPlan(undefined); notify({ tone: 'error', message: error instanceof Error ? error.message : 'Could not prepare artifact.' }); }
      }
    };
    void produce();
    return () => { alive = false; };
  }, [effectiveMode, file, kind, notify, text]);

  const publish = async () => {
    if (!connected) { notify({ tone: 'info', message: 'Connect a wallet before publishing.' }); return; }
    if (!plan) return;
    if ((kind === 'json' || kind === 'agent') && !file) {
      try { JSON.parse(text); } catch { notify({ tone: 'error', message: `${kind === 'agent' ? 'Agent' : 'JSON'} content must be valid JSON.` }); return; }
    }
    if (cluster === 'mainnet' && !accepted) { notify({ tone: 'error', message: 'Confirm the permanent mainnet warning first.' }); return; }
    if (mode === 'v1' && !v1Ready) { notify({ tone: 'info', message: `${connected.wallet.name} does not advertise v1 support. Switched to legacy chunks.` }); }
    setBusy(true); setSignatures([]); setProgress(`Preparing 0 / ${plan.encodedChunks.length}`);
    try {
      const result = await publishMemos({ connected, cluster, mode: effectiveMode, memos: plan.encodedChunks, onProgress: (done, total, signature) => { setProgress(`Confirmed ${done} / ${total}`); setSignatures(current => [...current, signature]); } });
      setSignatures(result);
      notify({ tone: 'success', message: `Artifact ${plan.id} is confirmed on ${cluster}.` });
    } catch (error) {
      if (error instanceof PublishInterruptedError) setSignatures([...error.signatures]);
      notify({ tone: 'error', message: error instanceof Error ? error.message : 'Publishing failed.' });
    } finally { setBusy(false); }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0]);
  return <div className="panel-grid">
    <div className="composer">
      <div className="section-title"><div><span className="eyebrow">01 · Compose</span><h2>Put an artifact onchain</h2></div><span className="status-pill"><span /> Client-side only</span></div>
      <div className="kind-grid">{kinds.map(item => <button type="button" key={item.id} className={kind === item.id ? 'kind active' : 'kind'} onClick={() => { setKind(item.id); setFile(undefined); }}><item.icon size={17} />{item.label}</button>)}</div>
      {(kind === 'text' || kind === 'json' || kind === 'agent' || kind === 'html') ? <div className="field"><label htmlFor="artifact-body">Content</label><textarea id="artifact-body" rows={9} value={text} onChange={event => setText(event.target.value)} spellCheck={kind === 'text'} /></div> : <label className="dropzone"><input type="file" accept={kinds.find(item => item.id === kind)?.accept} onChange={chooseFile} /><span className="drop-icon"><Upload size={20} /></span><strong>{file ? file.name : `Drop a ${kind} or browse`}</strong><small>{file ? formatBytes(file.size) : 'Maximum 256 KB · bytes stay in this browser'}</small></label>}
      <div className="mode-row">
        <button type="button" className={mode === 'v1' ? 'mode active' : 'mode'} onClick={() => setMode('v1')}><span><b>Transaction v1</b><small>4,096-byte envelope</small></span><em>NEW</em></button>
        <button type="button" className={mode === 'legacy' ? 'mode active' : 'mode'} onClick={() => setMode('legacy')}><span><b>Legacy</b><small>Maximum compatibility</small></span></button>
      </div>
      {connected && mode === 'v1' && !v1Ready && <div className="inline-warning"><CircleHelp size={17} /> Your wallet does not advertise v1 signing. This publish will safely use legacy chunks.</div>}
    </div>
    <aside className="receipt">
      <div className="receipt-head"><span>Publish preview</span><Fingerprint size={19} /></div>
      <div className="artifact-preview">{previewUrl ? <img src={previewUrl} alt="Artifact preview" /> : <div className="preview-glyph"><span>{kind.slice(0, 2).toUpperCase()}</span></div>}<div><strong>{plan?.name ?? 'Waiting for content'}</strong><small>{kind} · {plan ? formatBytes(plan.bytes) : '—'}</small></div></div>
      <dl className="metrics"><div><dt>Protocol</dt><dd>firsts/1</dd></div><div><dt>Transaction format</dt><dd>{effectiveMode === 'v1' ? 'v1 · 4 KB' : 'legacy · 1.2 KB'}</dd></div><div><dt>Transactions</dt><dd>{plan?.chunks.length ?? 0}</dd></div><div><dt>Content digest</dt><dd className="digest">{plan?.hash.slice(0, 12) ?? '—'}{plan && <CopyButton value={plan.hash} label="Copy SHA-256" />}</dd></div></dl>
      <div className="cost-callout"><span>Estimated network fee</span><strong>≈ {((plan?.chunks.length ?? 1) * 0.00001).toFixed(5)} SOL</strong><small>Estimate only. Your wallet shows the authoritative fee.</small></div>
      {cluster === 'mainnet' && <label className="check-row"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span><b>I understand this is permanent</b><small>Mainnet publishing spends real SOL and the content cannot be removed.</small></span></label>}
      <button type="button" className="primary full" disabled={busy || !plan || !plan.bytes || (cluster === 'mainnet' && !accepted)} onClick={publish}>{busy ? <><span className="spinner" />{progress}</> : <><Rocket size={17} />Publish to {cluster}</>}</button>
      <p className="fineprint">By publishing, you acknowledge public-chain data may be permanent and globally visible.</p>
      {!!signatures.length && <div className="result-card"><div className="result-title"><Check size={17} /> Confirmed</div>{signatures.map((signature, index) => <a key={signature} href={explorerUrl(signature, cluster)} target="_blank" rel="noreferrer"><span>Chunk {index + 1}</span><code>{shortAddress(signature)}</code><ExternalLink size={14} /></a>)}<button className="secondary full" onClick={() => navigator.clipboard.writeText(signatures.join('\n'))}><Copy size={15} />Copy recovery manifest</button></div>}
    </aside>
  </div>;
}

function VerifyPanel({ cluster, notify, onOpenToken }: { cluster: Cluster; notify: Notify; onOpenToken: (path: string) => void }) {
  const [manifest, setManifest] = useState('');
  const [busy, setBusy] = useState(false);
  const [artifact, setArtifact] = useState<RecoveredArtifact>();
  // One box takes either input a person is likely to have: a recovery manifest,
  // or a single mint address, which opens that coin's page instead.
  const recover = async () => {
    const entries = manifest.split(/[\s,]+/u).filter(Boolean);
    if (!entries.length) return;
    if (entries.length === 1 && isAddress(entries[0])) { onOpenToken(tokenPagePath(cluster, entries[0])); return; }
    setBusy(true);
    setArtifact(undefined);
    try {
      const result = await readArtifact(entries, cluster);
      setArtifact(result);
      notify({ tone: 'success', message: 'Every chunk and the SHA-256 digest verified.' });
    } catch (error) {
      notify({ tone: 'error', message: errorMessage(error, 'Verification failed.') });
    } finally { setBusy(false); }
  };
  const download = () => { if (!artifact) return; downloadBlob(new Blob([artifact.bytes as BlobPart], { type: artifact.mime }), artifact.name); };
  return <div className="panel-grid"><div className="composer"><div className="section-title"><div><span className="eyebrow">04 · Recover</span><h2>Verify an artifact</h2></div><span className="status-pill"><span /> Trustless read</span></div><p className="lead-small">Paste the transaction signatures from a Firsts recovery manifest, or a single mint address to open that coin. The browser fetches, reassembles, and hashes the bytes directly from Solana.</p><div className="field"><label htmlFor="manifest">Signatures or a mint address</label><textarea id="manifest" rows={9} value={manifest} onChange={event => setManifest(event.target.value)} placeholder={'One signature per line\n5KtP…\n3QsA…'} /></div><button className="primary" disabled={busy || !manifest.trim()} onClick={() => void recover()}>{busy ? <><span className="spinner" />Reading {cluster}</> : <><Search size={17} />Fetch and verify</>}</button></div><aside className="receipt"><div className="receipt-head"><span>Integrity report</span><ShieldCheck size={19} /></div>{artifact ? <><div className="verified-seal"><ShieldCheck size={38} /><strong>Bytes verified</strong><small>SHA-256 matches the onchain manifest</small></div><dl className="metrics"><div><dt>Name</dt><dd>{artifact.name}</dd></div><div><dt>Type</dt><dd>{artifact.mime}</dd></div><div><dt>Size</dt><dd>{formatBytes(artifact.bytes.length)}</dd></div><div><dt>Artifact ID</dt><dd>{artifact.id}</dd></div></dl><button className="primary full" onClick={download}><Download size={16} />Download recovered file</button></> : <div className="empty-state tall"><Search size={28} /><strong>Nothing loaded yet</strong><p>Recovery needs no Firsts backend, only a Solana RPC endpoint.</p></div>}</aside></div>;
}

export function App() {
  const [tab, setTab] = useState<StudioTab>('inscribe');
  const [cluster, setCluster] = useState<Cluster>(DEFAULT_CLUSTER);
  const [connected, setConnected] = useState<ConnectedWallet>();
  const [walletOpen, setWalletOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<Notice>();
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [vanity, setVanity] = useState<VanityKeypair>();
  const notify = useCallback((next: Notice) => { setNotice(next); window.setTimeout(() => setNotice(current => current === next ? undefined : current), 5_500); }, []);
  const navigate = useCallback((path: string) => { window.history.pushState({}, '', path); setRoute(parseRoute(path)); window.scrollTo({ top: 0 }); }, []);
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const useVanityAsMint = useCallback((keypair: VanityKeypair) => {
    setVanity(keypair);
    setTab('token');
    notify({ tone: 'success', message: `${shortAddress(keypair.address)} will be the mint address of your next launch.` });
  }, [notify]);
  const connect = async (wallet: ReturnType<typeof getSolanaWallets>[number]) => { try { const next = await connectWallet(wallet, cluster); setConnected(next); setWalletOpen(false); notify({ tone: 'success', message: `${wallet.name} connected to ${cluster}.` }); } catch (error) { notify({ tone: 'error', message: error instanceof Error ? error.message : 'Wallet connection failed.' }); } };
  const disconnect = async () => { if (!connected) return; const wallet = connected.wallet; setConnected(undefined); try { await disconnectWallet(wallet); } catch { notify({ tone: 'error', message: 'The wallet did not confirm disconnection.' }); } };
  const navTabs = useMemo<Array<{ id: StudioTab; label: string; icon: typeof Image }>>(() => [{ id: 'inscribe', label: 'Inscribe', icon: Sparkles }, { id: 'token', label: 'Launch coin', icon: Coins }, { id: 'vanity', label: 'Vanity keys', icon: KeyRound }, { id: 'verify', label: 'Verify', icon: ShieldCheck }], []);
  const selectTab = (next: StudioTab) => { setTab(next); document.getElementById('studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return <div className="app" id="top"><ThreeField /><header className="site-header"><Logo onHome={() => navigate('/')} /><nav className={menuOpen ? 'main-nav open' : 'main-nav'}><a href="#protocol">Protocol</a><a href="#developers">Developers</a><a href="#faq">FAQ</a><a href="https://github.com/nirholas/solana-firsts" target="_blank" rel="noreferrer">GitHub <ExternalLink size={12} /></a></nav><div className="header-actions"><label className="cluster-select"><span className={cluster} /> <select aria-label="Solana network" value={cluster} onChange={event => { void disconnect(); setCluster(event.target.value as Cluster); }}><option value="mainnet">Mainnet</option><option value="devnet">Devnet</option></select><ChevronDown size={14} /></label><button className="wallet-button" title={connected ? `Disconnect ${connected.wallet.name}` : undefined} onClick={() => connected ? void disconnect() : setWalletOpen(true)}><Wallet size={16} />{connected ? shortAddress(connected.account.address) : 'Connect wallet'}</button><button className="menu-button" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><Menu size={20} /></button></div></header>
    <main>{route.name === 'token'
      ? <TokenPage cluster={route.cluster} mint={route.mint} notify={notify} onBack={() => navigate('/')} />
      : <><section className="hero"><div className="hero-copy"><div className="live-badge"><span /> Transaction v1 is live on mainnet</div><h1>Make the first.<br /><span>Keep it forever.</span></h1><p>Publish images, agents, code, and culture directly to Solana, then launch a coin whose artwork and metadata live in the mint itself. No storage gateway. No backend custody. Just signed bytes and a verifiable open protocol.</p><div className="hero-actions"><button className="primary large" onClick={() => selectTab('inscribe')}>Create an artifact <ArrowRight size={17} /></button><button className="secondary large" onClick={() => selectTab('token')}>Launch a coin</button><a className="text-link" href="#protocol">Read the protocol <ArrowRight size={14} /></a></div><div className="hero-proof"><div><strong>4,096</strong><span>bytes / v1 transaction</span></div><div><strong>SHA-256</strong><span>content addressed</span></div><div><strong>0%</strong><span>platform custody</span></div></div></div><div className="hero-object" aria-hidden="true"><div className="artifact-cube"><div className="cube-face face-front"><span>FIRST</span><code>7f83b165…</code></div><div className="cube-face face-right"/><div className="cube-face face-top"/></div><div className="pulse-ring r1"/><div className="pulse-ring r2"/><div className="floating-tag tag-one">firsts/1</div><div className="floating-tag tag-two">onchain</div></div></section>
      <section className="ticker" aria-label="Platform capabilities"><span>TEXT</span><i /> <span>IMAGES</span><i /> <span>AGENTS</span><i /> <span>HTML</span><i /> <span>COINS</span><i /> <span>ANY FILE</span></section>
      <section className="studio" id="studio"><div className="studio-shell"><div className="studio-top"><div><span className="eyebrow">Creation studio</span><h2>Ship a first in minutes.</h2></div><div className="studio-tabs" role="tablist" aria-label="Creation tools">{navTabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={16} />{item.label}</button>)}</div></div>{tab === 'inscribe' && <InscribePanel connected={connected} cluster={cluster} notify={notify} />}{tab === 'token' && <TokenPanel connected={connected} cluster={cluster} notify={notify} vanity={vanity} onClearVanity={() => setVanity(undefined)} onOpenToken={navigate} onRequestWallet={() => setWalletOpen(true)} />}{tab === 'vanity' && <VanityPanel notify={notify} onUseAsMint={useVanityAsMint} />}{tab === 'verify' && <VerifyPanel cluster={cluster} notify={notify} onOpenToken={navigate} />}</div></section>
      <section className="protocol" id="protocol"><div className="section-kicker">THE OPEN FORMAT</div><div className="protocol-heading"><h2>The chain is the database.</h2><p>Firsts splits content into self-describing Memo Program envelopes. Every chunk carries order and identity; the first carries the full digest and metadata. Anyone can rebuild the original bytes without this site.</p></div><div className="flow"><div className="flow-card"><span>01</span><Fingerprint size={22} /><h3>Hash</h3><p>SHA-256 gives the artifact one stable content identity.</p></div><ArrowRight /><div className="flow-card"><span>02</span><Layers3 size={22} /><h3>Chunk</h3><p>Safe payload budgets for legacy or 4 KB v1 transactions.</p></div><ArrowRight /><div className="flow-card"><span>03</span><Wallet size={22} /><h3>Sign</h3><p>Your Wallet Standard signer reviews every chain write.</p></div><ArrowRight /><div className="flow-card"><span>04</span><ShieldCheck size={22} /><h3>Verify</h3><p>Fetch, reassemble, and check the digest in any client.</p></div></div></section>
      <section className="developers" id="developers"><div><span className="eyebrow">For builders</span><h2>Fork the protocol,<br />not the permission.</h2><p>Open Apache-2.0 primitives, typed transaction builders, a browser recovery path, and no required service account. Mainnet is the default; use devnet for rehearsals and bring your own RPC when traffic arrives.</p><a className="secondary link-button" href="https://github.com/nirholas/solana-firsts" target="_blank" rel="noreferrer"><Github size={17} />View source</a></div><pre><code><span>{'{'}</span>{'\n  '}<b>"p"</b>: <em>"firsts/1"</em>,{'\n  '}<b>"id"</b>: <em>"7f83b1657ff1fc53"</em>,{'\n  '}<b>"i"</b>: <strong>0</strong>,{'\n  '}<b>"n"</b>: <strong>1</strong>,{'\n  '}<b>"mime"</b>: <em>"image/webp"</em>,{'\n  '}<b>"hash"</b>: <em>"7f83…d9069"</em>,{'\n  '}<b>"data"</b>: <em>"UklGR…"</em>{'\n'}<span>{'}'}</span></code></pre></section>
      <section className="faq" id="faq"><div><span className="eyebrow">Good questions</span><h2>Built for permanence.<br />Designed with restraint.</h2></div><div className="faq-list"><details open><summary>Is the file really onchain?<span>+</span></summary><p>Yes. Artifact bytes are encoded in Solana Memo Program instructions, not uploaded to IPFS, Arweave, R2, or a Firsts server. The recovery tool reads them from transaction history.</p></details><details><summary>Is this a launchpad with a bonding curve?<span>+</span></summary><p>No. Firsts creates a Token-2022 mint that carries its own name, ticker, story, links, and artwork digest onchain, then mints the supply to you. It never creates a market, liquidity pool, bonding curve, or any promise of value.</p></details><details><summary>What happens when a wallet does not support v1?<span>+</span></summary><p>The studio detects the Wallet Standard capability and uses smaller legacy transactions. Content identity stays the same; only the chunk count changes.</p></details><details><summary>Can I remove something after publishing?<span>+</span></summary><p>No. Treat chain writes as public and permanent. Never publish secrets, private data, copyrighted material you do not control, or illegal content.</p></details></div></section>
      </>}
    </main><footer><Logo onHome={() => navigate('/')} /><p>Open infrastructure for permanent Solana artifacts.</p><div><a href="https://github.com/nirholas/solana-firsts">Source</a><a href="https://github.com/nirholas/solana-firsts/blob/main/PROTOCOL.md">Protocol</a><a href="https://solana.com/upgrades/larger-transaction-sizes">Solana v1</a></div><small>© 2026 Firsts. No token endorsement. No investment advice.</small></footer>
    {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} onConnect={connect} />}{notice && <div className={`toast ${notice.tone}`} role="status" aria-live="polite"><span>{notice.tone === 'success' ? <Check size={16} /> : notice.tone === 'error' ? <X size={16} /> : <CircleHelp size={16} />}</span>{notice.message}<button aria-label="Dismiss notification" onClick={() => setNotice(undefined)}><X size={14} /></button></div>}
  </div>;
}
