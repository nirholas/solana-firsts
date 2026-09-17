import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Coins, Download, Fingerprint, KeyRound, ShieldAlert } from 'lucide-react';
import {
  MAX_VANITY_CHARACTERS, expectedAttempts, formatDuration, grindVanity, validateVanity,
  type VanityKeypair, type VanityProgress,
} from '../lib/vanity';
import { CopyButton, downloadBlob, errorMessage, type Notify } from './ui';

const IDLE: VanityProgress = { attempts: 0, elapsed: 0, rate: 0, workers: 0 };

export function VanityPanel({ notify, onUseAsMint }: { notify: Notify; onUseAsMint: (keypair: VanityKeypair) => void }) {
  const [prefix, setPrefix] = useState('art');
  const [suffix, setSuffix] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<VanityProgress>(IDLE);
  const [keypair, setKeypair] = useState<VanityKeypair>();
  const [exported, setExported] = useState(false);
  const controller = useRef<AbortController>(undefined);

  useEffect(() => () => controller.current?.abort(), []);

  const request = useMemo(() => ({ prefix, suffix, caseSensitive }), [caseSensitive, prefix, suffix]);
  const inputError = useMemo(() => {
    if (!prefix && !suffix) return undefined;
    try { validateVanity(request); return undefined; } catch (error) { return errorMessage(error, 'Invalid pattern.'); }
  }, [prefix, request, suffix]);
  const expected = useMemo(() => (prefix || suffix) && !inputError ? expectedAttempts(request) : 0, [inputError, prefix, request, suffix]);
  // Before the first measurement, estimate from a conservative single-core rate.
  const rate = progress.rate || 1_200;
  const remaining = expected ? Math.max(0, expected - progress.attempts) / rate : 0;

  const start = async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setRunning(true);
    setKeypair(undefined);
    setExported(false);
    setProgress(IDLE);
    try {
      const found = await grindVanity(request, { signal: next.signal, onProgress: setProgress });
      setKeypair(found);
      notify({ tone: 'success', message: `${found.address} found on this device.` });
    } catch (error) {
      if (!next.signal.aborted) notify({ tone: 'error', message: errorMessage(error, 'The key search failed.') });
    } finally {
      setRunning(false);
    }
  };

  const stop = () => controller.current?.abort();

  const download = () => {
    if (!keypair) return;
    downloadBlob(new Blob([JSON.stringify(keypair.secretKey)], { type: 'application/json' }), `${keypair.address}.json`);
    setExported(true);
  };

  return <div className="panel-grid">
    <div className="composer">
      <div className="section-title">
        <div><span className="eyebrow">03 · Identity</span><h2>Grind a memorable address</h2></div>
        <span className="status-pill"><span /> {progress.workers || navigator.hardwareConcurrency || 1} cores</span>
      </div>
      <p className="lead-small">Every candidate key is generated and thrown away inside your browser. Nothing is sent anywhere, and a match can be used as the mint address of your next coin.</p>
      <div className="two-fields">
        <div className="field"><label htmlFor="prefix">Starts with</label><input id="prefix" value={prefix} maxLength={MAX_VANITY_CHARACTERS} disabled={running} aria-invalid={!!inputError} onChange={event => setPrefix(event.target.value.trim())} placeholder="art" /></div>
        <div className="field"><label htmlFor="suffix">Ends with</label><input id="suffix" value={suffix} maxLength={MAX_VANITY_CHARACTERS} disabled={running} aria-invalid={!!inputError} onChange={event => setSuffix(event.target.value.trim())} placeholder="fun" /></div>
      </div>
      {inputError && <p className="field-error" role="alert">{inputError}</p>}
      <label className="toggle-row">
        <input type="checkbox" checked={caseSensitive} disabled={running} onChange={event => setCaseSensitive(event.target.checked)} />
        <span className="toggle-icon"><KeyRound size={15} /></span>
        <span><b>Match capitals exactly</b><small>Off is far faster: <code>Art</code> and <code>aRT</code> both count as a hit.</small></span>
      </label>
      <div className="difficulty">
        <span>Expected search</span>
        <strong>{expected ? `~${Math.round(expected).toLocaleString()} keys` : 'Enter a pattern'}</strong>
        <small>{expected ? `About ${formatDuration(remaining)} left at ${Math.round(rate).toLocaleString()} keys/second.` : 'Base58 has no 0, O, I, or l. Each extra character multiplies the work.'}</small>
      </div>
      <div className="button-row">
        <button type="button" className="primary" disabled={running || !!inputError || (!prefix && !suffix)} onClick={() => void start()}><KeyRound size={17} />Start grinding</button>
        {running && <button type="button" className="secondary" onClick={stop}>Stop</button>}
      </div>
    </div>
    <aside className="receipt">
      <div className="receipt-head"><span>Local generator</span><Fingerprint size={19} /></div>
      <div className={running ? 'key-visual searching' : 'key-visual'}><KeyRound size={36} /><span className="scanline" /></div>
      <dl className="metrics">
        <div><dt>Keys tried</dt><dd>{progress.attempts.toLocaleString()}</dd></div>
        <div><dt>Rate</dt><dd>{progress.rate ? `${Math.round(progress.rate).toLocaleString()}/s` : '—'}</dd></div>
        <div><dt>Elapsed</dt><dd>{(progress.elapsed / 1_000).toFixed(1)}s</dd></div>
        <div><dt>Custody</dt><dd>This device only</dd></div>
      </dl>
      {keypair ? <div className="result-card">
        <div className="result-title"><Check size={17} /> Address found</div>
        <div className="address-row"><code>{keypair.address}</code><CopyButton value={keypair.address} label="Copy address" /></div>
        <button type="button" className="primary full" onClick={download}><Download size={16} />{exported ? 'Download again' : 'Download the secret key'}</button>
        <button type="button" className="secondary full" onClick={() => onUseAsMint(keypair)}><Coins size={16} />Use as my coin address</button>
        <p className="danger-text"><ShieldAlert size={14} /> Anyone holding this file controls the address. Keep it offline. Closing this tab erases it, and nothing here can recover it.</p>
      </div> : <p className="fineprint centered">{running ? 'Keep this tab open and in the foreground while the workers search.' : 'Nothing found yet. Short patterns take seconds, six characters can take hours.'}</p>}
    </aside>
  </div>;
}
