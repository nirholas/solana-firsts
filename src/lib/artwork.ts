import { planArtifact, type ArtifactPlan, type TransactionMode } from './artifacts';

export type ArtworkTier = 'compact' | 'standard' | 'detailed';

// Transaction counts per tier assume a v1 wallet. Legacy wallets reach the same
// visual quality with roughly four times as many transactions, capped below.
export const ARTWORK_TIERS: Record<ArtworkTier, { label: string; transactions: number; hint: string }> = {
  compact: { label: 'Compact', transactions: 1, hint: 'One transaction' },
  standard: { label: 'Standard', transactions: 2, hint: 'Sharper detail' },
  detailed: { label: 'Detailed', transactions: 4, hint: 'Highest fidelity' },
};

const PASSTHROUGH_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml']);
const DIMENSIONS = [512, 448, 384, 320, 256, 224, 192, 160, 128, 96, 72, 48];
const QUALITIES = [0.92, 0.82, 0.72, 0.62, 0.52, 0.42, 0.32];

export interface FittedArtwork {
  plan: ArtifactPlan;
  mime: string;
  width?: number;
  height?: number;
  resized: boolean;
  sourceBytes: number;
}

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (file.type !== 'image/svg+xml' && 'createImageBitmap' in globalThis) {
    try {
      return await createImageBitmap(file);
    } catch {
      // Some formats only decode through an <img> element; fall through.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return Object.assign(image, { width: image.naturalWidth || 512, height: image.naturalHeight || 512 });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

async function encoderFor(canvas: HTMLCanvasElement): Promise<string> {
  const probe = await encode(canvas, 'image/webp', 0.8);
  return probe?.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/u, '') || 'artwork';
}

// Produces the highest-fidelity rendition whose firsts/1 plan fits within the
// tier's transaction budget: the original file when it already fits, otherwise
// the largest square-bounded re-encode that does.
export async function fitArtwork(file: File, tier: ArtworkTier, mode: TransactionMode, maxTransactions: number): Promise<FittedArtwork> {
  if (!file.type.startsWith('image/')) throw new Error('Token artwork must be an image.');
  const budget = Math.min(maxTransactions, mode === 'v1' ? ARTWORK_TIERS[tier].transactions : ARTWORK_TIERS[tier].transactions * 4);
  const original = new Uint8Array(await file.arrayBuffer());
  if (PASSTHROUGH_TYPES.has(file.type) && original.length <= 256_000) {
    const plan = await planArtifact({ bytes: original, kind: 'image', name: file.name, mime: file.type, mode });
    if (plan.chunks.length <= budget) return { plan, mime: file.type, resized: false, sourceBytes: file.size };
  }
  const source = await decode(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot re-encode images.');
  canvas.width = 8;
  canvas.height = 8;
  const type = await encoderFor(canvas);
  const extension = type === 'image/webp' ? 'webp' : 'jpg';
  for (const dimension of DIMENSIONS) {
    const scale = Math.min(1, dimension / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (type === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const quality of QUALITIES) {
      // Smaller canvases tolerate less compression; stop early to prefer resolution.
      if (dimension > 128 && quality < 0.5) break;
      const blob = await encode(canvas, type, quality);
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const plan = await planArtifact({ bytes, kind: 'image', name: `${baseName(file.name)}.${extension}`, mime: type, mode });
      if (plan.chunks.length <= budget) {
        return { plan, mime: type, width: canvas.width, height: canvas.height, resized: true, sourceBytes: file.size };
      }
    }
  }
  throw new Error('This image cannot be compressed into the selected size. Choose a larger tier or a simpler image.');
}
