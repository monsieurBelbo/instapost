/**
 * The export cache (ux.md §4.5, IU3): "the thumbnail is the upload". 600 ms after the last edit the editor
 * renders `exportFrame(doc, 'msite')` (the 1080×1920 PNG Instagram receives) and keeps the blob in memory;
 * it is written to IndexedDB `exports` only on Post. While stale the thumbnail dims; Post waits up to 1 s for
 * a fresh render, else renders at once. A stale render is never posted.
 */
import { signal } from '@preact/signals';
import { newId } from '../core/model/ids.ts';
import { type ExportRecord, putDoc, putExport } from '../platform/idb.ts';
import { exportFrame } from '../raster/export.ts';
import { bytesToB64 } from '../shared/b64.ts';
import { assetSize, doc, fontsReady, frame, image, measurer } from './editor-state.ts';
import { sha256Hex } from './hash.ts';

export const RENDER_DELAY_MS = 600;
export const FRESH_WAIT_MS = 1000;

export interface CachedExport {
  blob: Blob;
  /** An object URL for the thumbnail (revoked when replaced). */
  url: string;
  sha256: string;
  docHash: string;
  bytes: number;
  w: number;
  h: number;
  /** IA7: the 16×16 RGBA sample, base64. */
  sample: string | null;
  docId: string;
  frameId: string;
  /** The doc version it was rendered from. */
  docUpdatedAt: number;
}

export const exportCache = signal<CachedExport | null>(null);
/** The cache is behind the doc (an edit is pending or rendering). */
export const exportStale = signal(true);
export const exportError = signal<string | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;
let rendering: Promise<CachedExport | null> | null = null;

/** IA7: a 16×16 RGBA sample of the export, base64 (diagnostic image check in the composer). */
async function sampleOf(blob: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const c = new OffscreenCanvas(16, 16);
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, 16, 16);
      return bytesToB64(new Uint8Array(ctx.getImageData(0, 0, 16, 16).data.buffer));
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

/** Renders the current doc now (the export the run would upload). */
async function render(): Promise<CachedExport | null> {
  const img = image.value;
  if (!img || !fontsReady.value) return null;
  const d = doc.value;
  const f = frame.value;
  const rendered = await exportFrame(d, f.id, 'msite', {
    sources: { image: (id) => (id === img.assetId ? img.full : undefined) },
    assetSize,
    measurer,
  });
  const [sha256, docHash, sample] = await Promise.all([
    sha256Hex(await rendered.blob.arrayBuffer()),
    sha256Hex(JSON.stringify(d)),
    sampleOf(rendered.blob),
  ]);
  return {
    blob: rendered.blob,
    url: URL.createObjectURL(rendered.blob),
    sha256,
    docHash,
    bytes: rendered.blob.size,
    w: rendered.w,
    h: rendered.h,
    sample,
    docId: d.id,
    frameId: f.id,
    docUpdatedAt: d.updatedAt,
  };
}

function settle(p: Promise<CachedExport | null>): Promise<CachedExport | null> {
  rendering = p;
  return p.then(
    (c) => {
      if (rendering === p) rendering = null;
      if (c) {
        const old = exportCache.value;
        exportCache.value = c;
        if (old && old.url !== c.url) URL.revokeObjectURL(old.url);
        exportStale.value = c.docUpdatedAt !== doc.value.updatedAt;
        exportError.value = null;
      }
      return c;
    },
    (err: unknown) => {
      if (rendering === p) rendering = null;
      exportError.value = err instanceof Error ? err.message : String(err);
      return null;
    },
  );
}

/** Called on every doc, image or font change: marks the cache stale and renders 600 ms later. */
export function scheduleExport(): void {
  exportStale.value = true;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void settle(render());
  }, RENDER_DELAY_MS);
}

const isFresh = (c: CachedExport | null): c is CachedExport =>
  c !== null && c.docUpdatedAt === doc.value.updatedAt && c.docId === doc.value.id && image.value !== null;

/**
 * The export of the doc as it is now: the cache when fresh, the render in flight if it lands within
 * FRESH_WAIT_MS, else a render now. Never a stale one.
 */
export async function freshExport(): Promise<CachedExport | null> {
  if (isFresh(exportCache.value)) return exportCache.value;
  if (rendering) {
    const waited = await Promise.race([
      rendering,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), FRESH_WAIT_MS)),
    ]);
    if (isFresh(waited)) return waited;
  }
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const c = await settle(render());
  return isFresh(c) ? c : null;
}

/** Writes the export (and its doc) to IndexedDB for the run; returns the record. */
export async function storeExport(c: CachedExport): Promise<ExportRecord> {
  const record: ExportRecord = {
    id: newId('export', () => crypto.randomUUID()),
    docId: c.docId,
    frameId: c.frameId,
    docHash: c.docHash,
    purpose: 'msite',
    mime: 'image/png',
    w: c.w,
    h: c.h,
    bytes: c.bytes,
    sha256: c.sha256,
    blob: c.blob,
    createdAt: Date.now(),
  };
  await putDoc(doc.value);
  await putExport(record);
  return record;
}
