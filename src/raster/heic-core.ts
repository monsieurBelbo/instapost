/**
 * HEIC/HEIF → RGBA with libheif (libheif-js's Emscripten build, LGPL-3.0; docs/inpage.md §13.7). Runs in
 * the HEIC worker (heic.worker.ts); kept free of DOM types so it is unit-tested in node with the same wasm.
 *
 * The primary image is decoded with libheif's default options, which apply the item's transformations
 * (`irot` rotation, `imir` mirror, `clap` crop): the pixels come out upright and the size is the displayed
 * one. EXIF orientation is not applied on top (libheif's irot is authoritative; iPhones write both).
 */

/** The slice of libheif-js's module this file uses (its generated .d.ts lacks the JS helpers' shapes). */
export interface LibHeif {
  heif_context_alloc(): unknown;
  heif_context_free(ctx: unknown): void;
  heif_context_read_from_memory(ctx: unknown, data: Uint8Array): { code: unknown; message?: string };
  heif_js_context_get_primary_image_handle(ctx: unknown): unknown;
  heif_js_decode_image2(handle: unknown, colorspace: unknown, chroma: unknown): unknown;
  heif_image_handle_release(handle: unknown): void;
  heif_image_release(image: unknown): void;
  heif_colorspace: { heif_colorspace_RGB: unknown };
  heif_chroma: { heif_chroma_interleaved_RGBA: unknown };
  heif_channel: { heif_channel_interleaved: unknown };
}

export interface HeicRgba {
  width: number;
  height: number;
  /** width × height × 4, straight alpha, owned by the caller (not a view of the wasm heap). */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export class HeicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeicError';
  }
}

interface Channel {
  id: unknown;
  width: number;
  height: number;
  stride: number;
  data: Uint8Array;
}

/** A heif_error's code: embind hands enums over as objects with a numeric `value`. */
const codeOf = (x: unknown): number | null => {
  const c = (x as { code?: unknown } | null)?.code;
  if (typeof c === 'number') return c;
  const v = (c as { value?: unknown } | null | undefined)?.value;
  return typeof v === 'number' ? v : null;
};

/** The error carried by a libheif result (an error object instead of a handle or an image), or null. */
const errorOf = (x: unknown): string | null => {
  if (x === null || x === undefined) return 'no result';
  const code = codeOf(x);
  if (code !== null && code !== 0) return String((x as { message?: unknown }).message ?? `code ${code}`);
  return null;
};

/** Decodes the primary image of `bytes` to upright RGBA. Throws HeicError for anything libheif refuses. */
export function decodePrimaryRgba(lib: LibHeif, bytes: Uint8Array): HeicRgba {
  const ctx = lib.heif_context_alloc();
  if (!ctx) throw new HeicError('libheif could not allocate a context');
  let handle: unknown = null;
  try {
    const readErr = errorOf(lib.heif_context_read_from_memory(ctx, bytes));
    if (readErr) throw new HeicError(`not a readable HEIF file (${readErr})`);
    handle = lib.heif_js_context_get_primary_image_handle(ctx);
    const handleErr = errorOf(handle);
    if (handleErr) {
      handle = null;
      throw new HeicError(`no primary image (${handleErr})`);
    }
    const decoded = lib.heif_js_decode_image2(
      handle,
      lib.heif_colorspace.heif_colorspace_RGB,
      lib.heif_chroma.heif_chroma_interleaved_RGBA,
    ) as { image: unknown; channels?: Channel[] } | null;
    const decodeErr = errorOf(decoded);
    if (decodeErr || !decoded) throw new HeicError(`the image could not be decoded (${decodeErr ?? 'empty'})`);
    try {
      const ch = decoded.channels?.find((c) => c.id === lib.heif_channel.heif_channel_interleaved);
      if (!ch || ch.width <= 0 || ch.height <= 0) throw new HeicError('the decoded image has no pixels');
      const { width, height, stride } = ch;
      const row = width * 4;
      // `ch.data` is a view of the wasm heap: copy it out, row by row when libheif pads its rows.
      const rgba = new Uint8ClampedArray(row * height);
      if (stride === row) rgba.set(ch.data.subarray(0, row * height));
      else for (let y = 0; y < height; y++) rgba.set(ch.data.subarray(y * stride, y * stride + row), y * row);
      return { width, height, rgba };
    } finally {
      lib.heif_image_release(decoded.image);
    }
  } finally {
    if (handle) lib.heif_image_handle_release(handle);
    lib.heif_context_free(ctx);
  }
}
