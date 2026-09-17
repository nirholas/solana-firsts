import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export type Notice = { tone: 'success' | 'error' | 'info'; message: string };
export type Notify = (notice: Notice) => void;

export function useObjectUrl(source?: Blob): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!source) { setUrl(undefined); return; }
    const next = URL.createObjectURL(source);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [source]);
  return url;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const safeName = [...filename]
    .map(character => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character)
    .join('')
    .slice(0, 180) || 'artifact.bin';
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = safeName;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(href), 0);
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_400);
  };
  return <button type="button" className="icon-button" onClick={copy} title={label} aria-label={label}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Stopped.';
  if (error instanceof Error && /reject|denied|cancel/iu.test(error.message)) return 'The wallet request was declined. Nothing was sent.';
  return error instanceof Error ? error.message : fallback;
}

export function formatTokenAmount(raw: string, decimals: number): string {
  const value = BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const whole = (value / scale).toLocaleString('en-US');
  const fraction = decimals ? (value % scale).toString().padStart(decimals, '0').replace(/0+$/u, '') : '';
  return fraction ? `${whole}.${fraction}` : whole;
}

export function formatSol(lamports: bigint | number): string {
  const sol = Number(lamports) / 1e9;
  return sol < 0.001 ? sol.toFixed(6) : sol.toFixed(4);
}
