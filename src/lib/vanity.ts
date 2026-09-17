export const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]*$/u;
export const MAX_VANITY_CHARACTERS = 6;

export interface VanityRequest {
  prefix: string;
  suffix: string;
  caseSensitive: boolean;
}

export interface VanityProgress {
  attempts: number;
  elapsed: number;
  rate: number;
  workers: number;
}

export interface VanityKeypair {
  address: string;
  secretKey: number[];
}

export function validateVanity(request: VanityRequest): void {
  const pattern = request.prefix + request.suffix;
  if (!pattern) throw new Error('Enter a prefix, a suffix, or both.');
  if (!BASE58_PATTERN.test(pattern)) throw new Error('Base58 excludes 0, O, I, and l. Remove those characters.');
  if (pattern.length > MAX_VANITY_CHARACTERS) throw new Error(`Use at most ${MAX_VANITY_CHARACTERS} characters in total.`);
}

// Expected attempts before a match. Case-insensitive letters match roughly two
// of 58 symbols; digits and case-sensitive characters match exactly one.
export function expectedAttempts(request: VanityRequest): number {
  let odds = 1;
  for (const character of request.prefix + request.suffix) {
    const hasCaseTwin = /[a-z]/iu.test(character) && BASE58_PATTERN.test(character.toLowerCase()) && BASE58_PATTERN.test(character.toUpperCase());
    odds *= !request.caseSensitive && hasCaseTwin ? 29 : 58;
  }
  return odds;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

export function grindVanity(request: VanityRequest, options: { signal: AbortSignal; onProgress: (progress: VanityProgress) => void }): Promise<VanityKeypair> {
  validateVanity(request);
  const count = Math.max(1, Math.min(8, (globalThis.navigator?.hardwareConcurrency ?? 2) - 1));
  const workers: Worker[] = [];
  const attempts = new Array<number>(count).fill(0);
  const started = performance.now();
  const stopAll = () => workers.forEach(worker => worker.terminate());
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) { reject(new DOMException('Search stopped.', 'AbortError')); return; }
    options.signal.addEventListener('abort', () => { stopAll(); reject(new DOMException('Search stopped.', 'AbortError')); }, { once: true });
    for (let index = 0; index < count; index += 1) {
      const worker = new Worker(new URL('../workers/vanity.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ type: 'progress' | 'found'; attempts: number; address?: string; secretKey?: number[] }>) => {
        attempts[index] = event.data.attempts;
        const total = attempts.reduce((sum, value) => sum + value, 0);
        const elapsed = performance.now() - started;
        options.onProgress({ attempts: total, elapsed, rate: total / Math.max(elapsed / 1_000, 0.001), workers: count });
        if (event.data.type === 'found' && event.data.address && event.data.secretKey) {
          stopAll();
          resolve({ address: event.data.address, secretKey: event.data.secretKey });
        }
      };
      worker.onerror = event => { stopAll(); reject(new Error(event.message || 'The key search worker crashed.')); };
      worker.postMessage(request);
      workers.push(worker);
    }
  });
}
