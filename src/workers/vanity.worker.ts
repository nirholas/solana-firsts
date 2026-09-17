/// <reference lib="webworker" />
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';

type Request = { prefix: string; suffix: string; caseSensitive: boolean };
let running = false;

self.onmessage = (event: MessageEvent<Request | { stop: true }>) => {
  if ('stop' in event.data) { running = false; return; }
  running = true;
  const { prefix, suffix, caseSensitive } = event.data;
  const started = performance.now();
  let attempts = 0;
  const normalize = (value: string) => caseSensitive ? value : value.toLowerCase();
  const wantedPrefix = normalize(prefix);
  const wantedSuffix = normalize(suffix);
  const seed = new Uint8Array(32);

  const batch = () => {
    const deadline = performance.now() + 120;
    while (running && performance.now() < deadline) {
      crypto.getRandomValues(seed);
      const publicKey = ed25519.getPublicKey(seed);
      const address = normalize(bs58.encode(publicKey));
      attempts += 1;
      if (address.startsWith(wantedPrefix) && address.endsWith(wantedSuffix)) {
        const secretKey = new Uint8Array(64);
        secretKey.set(seed);
        secretKey.set(publicKey, 32);
        running = false;
        self.postMessage({ type: 'found', address: bs58.encode(publicKey), secretKey: Array.from(secretKey), attempts, elapsed: performance.now() - started });
        return;
      }
    }
    self.postMessage({ type: 'progress', attempts, elapsed: performance.now() - started });
    if (running) setTimeout(batch, 0);
  };
  batch();
};

export {};
