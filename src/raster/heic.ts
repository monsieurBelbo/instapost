/**
 * HEIC/HEIF import (docs/inpage.md §13.7): the main-thread side of the HEIC worker. Loaded lazily by
 * decode.ts (a dynamic import), so the worker, libheif's glue and its wasm cost nothing until the first HEIC
 * arrives. The worker stays up 30 s after its last job (a burst of photos reuses the compiled wasm), then
 * goes, which also hands its wasm heap (hundreds of MB after a 48 MP photo) back to the system.
 */
import type { Size } from '../core/geometry/fit.ts';
import { RasterError } from './errors.ts';
import type { HeicReply, HeicRequest } from './heic.worker.ts';

export interface HeicDecoded {
  /** Full size, upright, sRGB. */
  bitmap: ImageBitmap;
  size: Size;
  /** A JPEG of the same pixels, to store as the original (null when the worker could not encode one). */
  jpeg: Promise<Blob | null>;
  /** Decode time in the worker. */
  ms: number;
}

/** 48 MP takes ~4 s on an M-series Mac; anything past this is stuck. */
const TIMEOUT_MS = 60_000;
const IDLE_MS = 30_000;

interface Pending {
  resolve: (d: Omit<HeicDecoded, 'jpeg'>) => void;
  reject: (e: unknown) => void;
  jpeg: (b: Blob | null) => void;
  gotBitmap: boolean;
  timer: ReturnType<typeof setTimeout>;
}

let worker: Worker | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

const failed = (detail: string, cause?: unknown) =>
  new RasterError('DECODE_FAILED', `HEIC: ${detail}`, cause === undefined ? undefined : { cause });

function stopWorker(reason: string): void {
  worker?.terminate();
  worker = null;
  for (const [id, p] of pending) {
    clearTimeout(p.timer);
    if (!p.gotBitmap) p.reject(failed(reason));
    p.jpeg(null);
    pending.delete(id);
  }
}

function scheduleIdle(): void {
  if (idle !== null) clearTimeout(idle);
  idle = setTimeout(() => {
    idle = null;
    if (pending.size === 0) stopWorker('stopped');
  }, IDLE_MS);
}

function onReply(m: HeicReply): void {
  const p = pending.get(m.id);
  if (!p) {
    if (m.type === 'bitmap') m.bitmap.close();
    return;
  }
  if (m.type === 'bitmap') {
    p.gotBitmap = true;
    clearTimeout(p.timer);
    // The JPEG follows; if it never does, the photo is simply not stored.
    p.timer = setTimeout(() => {
      pending.delete(m.id);
      p.jpeg(null);
      if (pending.size === 0) scheduleIdle();
    }, TIMEOUT_MS);
    p.resolve({ bitmap: m.bitmap, size: { w: m.width, h: m.height }, ms: m.ms });
    return;
  }
  pending.delete(m.id);
  clearTimeout(p.timer);
  if (m.type === 'jpeg') p.jpeg(m.blob);
  else {
    p.reject(failed(m.message));
    p.jpeg(null);
  }
  if (pending.size === 0) scheduleIdle();
}

function getWorker(): Worker {
  if (worker) return worker;
  // A packaged module worker: Vite emits heic.worker.ts as its own file next to the extension's chunks.
  const w = new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module', name: 'instapost-heic' });
  w.onmessage = (e: MessageEvent<HeicReply>) => onReply(e.data);
  w.onerror = (e) => {
    e.preventDefault();
    if (worker === w) stopWorker(`the converter crashed (${e.message || 'no detail'})`);
  };
  worker = w;
  return w;
}

/** Decodes a HEIC/HEIF blob in the worker. DECODE_FAILED ("HEIC: …") on any failure. */
export async function decodeHeic(blob: Blob): Promise<HeicDecoded> {
  const bytes = await blob.arrayBuffer();
  if (idle !== null) {
    clearTimeout(idle);
    idle = null;
  }
  let w: Worker;
  try {
    w = getWorker();
  } catch (err) {
    throw failed('the converter could not start', err);
  }
  const id = ++seq;
  let jpegResolve: (b: Blob | null) => void = () => undefined;
  const jpeg = new Promise<Blob | null>((r) => {
    jpegResolve = r;
  });
  const decoded = new Promise<Omit<HeicDecoded, 'jpeg'>>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (worker === w) stopWorker('converting took too long');
    }, TIMEOUT_MS);
    pending.set(id, { resolve, reject, jpeg: jpegResolve, gotBitmap: false, timer });
  });
  w.postMessage({ id, bytes } satisfies HeicRequest, [bytes]);
  const d = await decoded;
  return { ...d, jpeg };
}
