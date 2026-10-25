/**
 * The HEIC worker (docs/inpage.md §13.7): a packaged module worker (MV3 allows no blob: workers), started
 * only when a HEIC arrives (heic.ts). libheif's wasm ships as an extension asset (`assets/libheif-*.wasm`)
 * and compiles here under the extension pages' `'wasm-unsafe-eval'`, off the composer's thread.
 *
 * One request at a time: decode the primary image upright (heic-core.ts), tag it with its colour space
 * (heic-colour.ts) and convert to sRGB on an OffscreenCanvas, post the full-size ImageBitmap (transferred,
 * no copy), then encode the same canvas as a JPEG (the stand-in original: browsers can't show a HEIC in
 * Recent photos, and drafts reopen fast) and post that.
 */
import libheifFactory from 'libheif-js/libheif-wasm/libheif.js';
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url';
import { heicColourSpace } from './heic-colour.ts';
import { decodePrimaryRgba, HeicError, type LibHeif } from './heic-core.ts';

export interface HeicRequest {
  id: number;
  bytes: ArrayBuffer;
}

export type HeicReply =
  | { id: number; type: 'bitmap'; bitmap: ImageBitmap; width: number; height: number; colour: string; ms: number }
  | { id: number; type: 'jpeg'; blob: Blob | null }
  | { id: number; type: 'error'; message: string };

/** The stand-in original's quality (Instagram re-encodes anyway; 0.92 keeps it visually lossless). */
const JPEG_QUALITY = 0.92;

/** The worker's global, typed by hand (the project's TS lib is DOM, not webworker). */
const scope = self as unknown as {
  postMessage(message: HeicReply, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<HeicRequest>) => void) | null;
};
let lib: LibHeif | null = null;

async function libheif(): Promise<LibHeif> {
  if (lib) return lib;
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new HeicError(`the decoder could not load (${res.status})`);
  const wasmBinary = await res.arrayBuffer();
  // With wasmBinary given, Emscripten compiles synchronously (fine in a worker) and fetches nothing.
  lib = (libheifFactory as unknown as (o: { wasmBinary: ArrayBuffer }) => LibHeif)({ wasmBinary });
  return lib;
}

async function handle(req: HeicRequest): Promise<void> {
  const t0 = performance.now();
  const bytes = new Uint8Array(req.bytes);
  const colour = heicColourSpace(bytes);
  const { width, height, rgba } = decodePrimaryRgba(await libheif(), bytes);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
  if (!ctx) throw new HeicError('no 2D canvas in the worker');
  // putImageData converts the ImageData's colour space (Display P3 for iPhones) to the canvas's sRGB.
  ctx.putImageData(new ImageData(rgba, width, height, { colorSpace: colour }), 0, 0);
  const bitmap = await createImageBitmap(canvas);
  const reply: HeicReply = {
    id: req.id,
    type: 'bitmap',
    bitmap,
    width,
    height,
    colour,
    ms: Math.round(performance.now() - t0),
  };
  scope.postMessage(reply, [bitmap]);
  let blob: Blob | null = null;
  try {
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  } catch {
    blob = null;
  }
  // Release the canvas's backing store before the next request.
  canvas.width = 0;
  canvas.height = 0;
  scope.postMessage({ id: req.id, type: 'jpeg', blob });
}

let queue: Promise<void> = Promise.resolve();
scope.onmessage = (e: MessageEvent<HeicRequest>) => {
  const req = e.data;
  queue = queue.then(() =>
    handle(req).catch((err: unknown) => {
      const message =
        err instanceof HeicError
          ? err.message
          : err instanceof RangeError || /memory/i.test(String(err))
            ? 'the photo is too large to convert here'
            : `the decoder failed (${err instanceof Error ? err.message : String(err)})`;
      scope.postMessage({ id: req.id, type: 'error', message });
      // A wasm abort leaves the module unusable: start over with a fresh one next time.
      lib = null;
    }),
  );
};
