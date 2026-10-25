/**
 * Editor state (strategy §7.10, ux.md §4.3): one StoryDoc with one photo frame, holding at most one image
 * layer (bottom) and one text layer (top). Signals at module scope. Drafts autosave (drafts.ts); a photo
 * replaced under existing text keeps the text.
 *
 * docs/repost.md RP-24, RP-30 (AM59): a repost puts a painted card bitmap on the stage as the image layer
 * (`fit: 'free'`) and keeps its source photo as a second in-memory asset (`backdrop`, for the Blur
 * background); the doc is `transient` then: no autosave, nothing stored. Loading a photo, a draft or a new
 * story ends it.
 */
import { batch, computed, signal } from '@preact/signals';
import type { Size } from '../core/geometry/fit.ts';
import { initialXf } from '../core/geometry/fit.ts';
import { newId } from '../core/model/ids.ts';
import {
  createDoc,
  type Fill,
  type Frame,
  type ImageLayer,
  type StoryDoc,
  type TextLayer,
  type Xf,
} from '../core/model/story.ts';
import type { TextMeasurer } from '../core/text/layout.ts';
import { DEFAULT_FONT_ID } from '../raster/fonts.ts';
import { canvasMeasurer } from '../raster/measurer-canvas.ts';
import { importImage, type LoadedImage, releaseImage } from './assets.ts';
import { ERROR_COPY } from './copy.ts';
import { t } from './i18n.ts';
import {
  moveTextXf,
  panImageXf,
  rotateImageToXf,
  rotateSliderGesture,
  setImageScaleXf,
  zoomImageXf,
} from './interaction.ts';

const uuid = () => crypto.randomUUID();

/** Text defaults: inside the 65 px side margins with room to spare. */
export const TEXT_DEFAULTS = {
  sizePx: 72,
  color: '#ffffff',
  lineHeight: 1.2,
  letterSpacingPx: 0,
  maxWidthPx: 880,
} as const;
export const TEXT_SIZE_RANGE = { min: 24, max: 200 } as const;

function freshDoc(): StoryDoc {
  const doc = createDoc({ docId: newId('doc', uuid), frameId: newId('frame', uuid) }, Date.now());
  const text: TextLayer = {
    kind: 'text',
    id: newId('layer', uuid),
    text: '',
    fontId: DEFAULT_FONT_ID,
    align: 'center',
    style: 'plain',
    ...TEXT_DEFAULTS,
    xf: { cx: 540, cy: 960, scale: 1, rotDeg: 0 },
  };
  const [frame] = doc.frames;
  return frame ? { ...doc, frames: [{ ...frame, layers: [text] }] } : doc;
}

export const doc = signal<StoryDoc>(freshDoc());
/** The decoded image behind the image layer, if any. */
export const image = signal<LoadedImage | null>(null);
/** RP-24: a second in-memory asset (a repost's source photo, behind its Blur background), or null. */
export const backdrop = signal<LoadedImage | null>(null);
/** AM59: the doc on the stage is not kept (a repost): no autosave (drafts.ts), nothing stored. */
export const transient = signal(false);
export const showSafeZones = signal(true);
/** Instrument Sans is loaded (text cannot be measured or drawn before). */
export const fontsReady = signal(false);

export type Busy = 'import' | 'download' | 'share' | 'post';
export const busy = signal<Busy | null>(null);
/** The import in progress is a HEIC being converted (docs/inpage.md §13.7: "Converting HEIC…"). */
export const converting = signal(false);

export interface Notice {
  kind: 'info' | 'error';
  text: string;
  /** Error code (ErrorCode or RasterError code) for tests and styling. */
  code?: string;
  /** RL-16: a DECODE_FAILED that came from the HEIC conversion (heic.ts), not from any other format. */
  heic?: boolean;
}
export const notice = signal<Notice | null>(null);

let canvasM: TextMeasurer | null = null;
const lazyMeasurer = (): TextMeasurer => {
  if (!canvasM) canvasM = canvasMeasurer();
  return canvasM;
};
/** One measurer for preview, hit tests and export (throws FONT_NOT_LOADED until fonts load). Created on first use. */
export const measurer: TextMeasurer = {
  measureWidth: (text, font) => lazyMeasurer().measureWidth(text, font),
  fontMetrics: (font) => lazyMeasurer().fontMetrics(font),
};

export const frame = computed<Frame>(() => {
  const f = doc.value.frames[0];
  if (!f) throw new Error('editor: the document has no frame');
  return f;
});
export const imageLayer = computed(() => frame.value.layers.find((l): l is ImageLayer => l.kind === 'image') ?? null);
export const textLayer = computed(() => frame.value.layers.find((l): l is TextLayer => l.kind === 'text') ?? null);

/** Natural size of an asset the editor holds, for compose(). */
export function assetSize(assetId: string): Size | undefined {
  const img = image.value;
  if (img && img.assetId === assetId) return img.size;
  const b = backdrop.value;
  return b && b.assetId === assetId ? b.size : undefined;
}

/** The bitmap of an asset the editor holds: `full` for the export, `proxy` for the stage. */
export function assetBitmap(assetId: string, which: 'full' | 'proxy'): ImageBitmap | undefined {
  for (const a of [image.value, backdrop.value]) if (a && a.assetId === assetId) return a[which];
  return undefined;
}

/** RP-28: the limits of a `free` image layer (the repost card's scale range and centre clamp), or none. */
let freeLimit: ((xf: Xf, src: Size) => Xf) | null = null;
export function setFreeLimit(f: ((xf: Xf, src: Size) => Xf) | null): void {
  freeLimit = f;
}

function updateFrame(fn: (f: Frame) => Frame): void {
  const d = doc.value;
  doc.value = { ...d, frames: [fn(frame.value), ...d.frames.slice(1)], updatedAt: Date.now() };
}

function updateImage(fn: (l: ImageLayer, src: Size) => Partial<ImageLayer>): void {
  const l = imageLayer.value;
  const img = image.value;
  if (!l || !img) return;
  const patch = fn(l, img.size);
  if (l.fit === 'free' && freeLimit && patch.xf) patch.xf = freeLimit(patch.xf, img.size);
  updateFrame((f) => ({ ...f, layers: f.layers.map((x) => (x.id === l.id ? { ...l, ...patch } : x)) }));
}

function updateText(patch: Partial<TextLayer> | ((l: TextLayer) => Partial<TextLayer>)): void {
  const l = textLayer.value;
  if (!l) return;
  const p = typeof patch === 'function' ? patch(l) : patch;
  updateFrame((f) => ({ ...f, layers: f.layers.map((x) => (x.id === l.id ? { ...l, ...p } : x)) }));
}

export function setNotice(n: Notice | null): void {
  notice.value = n;
}

/** The editor's own error codes (strategy §3.10) have their copy; other errors show their message. */
const EDITOR_CODES = ['FONT_NOT_LOADED', 'DECODE_FAILED', 'EXPORT_TOO_LARGE'] as const;
const isEditorCode = (c: unknown): c is (typeof EDITOR_CODES)[number] =>
  (EDITOR_CODES as readonly unknown[]).includes(c);

/** The message for a thrown error, with its code when it has one (codes stay out of the text, ux.md §5). */
export function errorNotice(err: unknown): Notice {
  const code = (err as { code?: unknown } | null)?.code;
  if (isEditorCode(code)) {
    const c = ERROR_COPY[code];
    // RL-16: the localized copy mentions HEIC for every decode failure; the raw message says which it was.
    const heic = code === 'DECODE_FAILED' && err instanceof Error && /^DECODE_FAILED: HEIC\b/.test(err.message);
    return {
      kind: 'error',
      text: t('notice.errorCopy', { title: c.title, body: c.body({ nothingPosted: true }) }),
      code,
      ...(heic ? { heic: true } : {}),
    };
  }
  const text = err instanceof Error ? err.message : String(err);
  return typeof code === 'string' ? { kind: 'error', text, code } : { kind: 'error', text };
}

// ---- transient docs (docs/repost.md RP-24, RP-30) --------------------------------------------

const transientEnds = new Set<() => void>();
/** Called whenever a transient doc ends (a photo, a draft or a new story replaced it). */
export function onTransientEnd(f: () => void): () => void {
  transientEnds.add(f);
  return () => transientEnds.delete(f);
}

/** Ends a transient doc: the backdrop is released, autosave resumes. */
export function endTransient(): void {
  if (!transient.value && !backdrop.value) return;
  const b = backdrop.value;
  batch(() => {
    transient.value = false;
    backdrop.value = null;
  });
  if (b) releaseImage(b);
  freeLimit = null;
  for (const f of transientEnds) f();
}

/**
 * Puts a transient image (a repost's card) on the stage as a `free` layer at `xf`, with `back` as the
 * backdrop asset and `background` as the frame's fill. `fresh` starts a new doc (an empty text layer).
 */
export function placeTransient(
  card: LoadedImage,
  back: LoadedImage | null,
  xf: Xf,
  background: Fill,
  fresh: boolean,
): void {
  const previous = image.value;
  const prevBack = backdrop.value;
  const base = fresh ? freshDoc() : doc.value;
  const f0 = base.frames[0];
  if (!f0) return;
  const old = f0.layers.find((l): l is ImageLayer => l.kind === 'image');
  const layer: ImageLayer = {
    kind: 'image',
    id: old?.id ?? newId('layer', uuid),
    assetId: card.assetId,
    fit: 'free',
    focal: { x: 0.5, y: 0.5 },
    xf,
  };
  batch(() => {
    image.value = card;
    backdrop.value = back;
    transient.value = true;
    doc.value = {
      ...base,
      frames: [
        { ...f0, background, layers: [layer, ...f0.layers.filter((l) => l.kind !== 'image')] },
        ...base.frames.slice(1),
      ],
      updatedAt: Date.now(),
    };
  });
  if (previous && previous !== card) releaseImage(previous);
  if (prevBack && prevBack !== back) releaseImage(prevBack);
}

/** The frame's background (the repost's Colours, Blur or Black). */
export function setBackground(background: Fill): void {
  updateFrame((f) => ({ ...f, background }));
}

/** The image layer's placement as given (the repost computes its own clamps). */
export function setImageXf(xf: Xf): void {
  const l = imageLayer.value;
  if (!l) return;
  updateFrame((f) => ({ ...f, layers: f.layers.map((x) => (x.id === l.id ? { ...l, xf } : x)) }));
}

/** New story (§4.7 New story): a fresh doc with an empty text layer; the image is released. */
export function newStory(): void {
  endTransient();
  const previous = image.value;
  batch(() => {
    image.value = null;
    doc.value = freshDoc();
  });
  if (previous) releaseImage(previous);
  setNotice(null);
}

/** Continue draft (§4.3): the saved doc with its original, decoded again. */
export async function restoreDraft(saved: StoryDoc, original: Blob | null): Promise<void> {
  if (busy.value) return;
  busy.value = 'import';
  setNotice(null);
  endTransient();
  try {
    // The saved doc points at its asset id; keep it (a HEIC's stored original is its JPEG, another hash).
    const layer = saved.frames[0]?.layers.find((l): l is ImageLayer => l.kind === 'image');
    const loaded = original
      ? await importImage(original, async () => undefined, {
          ...(layer ? { assetId: layer.assetId } : {}),
          onConvert: () => {
            converting.value = true;
          },
        })
      : null;
    const previous = image.value;
    batch(() => {
      image.value = loaded;
      doc.value = { ...saved, updatedAt: Date.now() };
    });
    if (previous) releaseImage(previous);
  } catch (err) {
    setNotice(errorNotice(err));
  } finally {
    busy.value = null;
    converting.value = false;
  }
}

// ---- image ------------------------------------------------------------------------------

/**
 * Loads a file as the frame's image (replacing the previous one), cover-fitted and centred. `assetId` when
 * the file is a stored asset (Recent photos). Resolves true when the photo is on the stage.
 */
export async function loadImageFile(file: Blob, opts: { assetId?: string } = {}): Promise<boolean> {
  if (busy.value) return false;
  busy.value = 'import';
  setNotice(null);
  try {
    const loaded = await importImage(file, undefined, {
      ...(opts.assetId ? { assetId: opts.assetId as LoadedImage['assetId'] } : {}),
      onConvert: () => {
        converting.value = true;
      },
    });
    endTransient();
    const previous = image.value;
    const layer: ImageLayer = {
      kind: 'image',
      id: imageLayer.value?.id ?? newId('layer', uuid),
      assetId: loaded.assetId,
      fit: 'cover',
      focal: { x: 0.5, y: 0.5 },
      xf: initialXf('cover', loaded.size, { x: 0.5, y: 0.5 }),
    };
    batch(() => {
      image.value = loaded;
      updateFrame((f) => ({
        ...f,
        // A new photo starts filled (a blurred backdrop of the previous photo would point at its asset).
        background: { kind: 'solid', color: '#000000' },
        layers: [layer, ...f.layers.filter((l) => l.kind !== 'image')],
      }));
    });
    if (previous) releaseImage(previous);
    const hasText = (textLayer.value?.text.trim() ?? '') !== '';
    if (!loaded.stored) setNotice({ kind: 'info', text: t('notice.notStored') });
    else if (previous && hasText) setNotice({ kind: 'info', text: t('notice.replaced') });
    return true;
  } catch (err) {
    setNotice(errorNotice(err));
    return false;
  } finally {
    busy.value = null;
    converting.value = false;
  }
}

export const panImage = (dx: number, dy: number): void => updateImage((l, src) => ({ xf: panImageXf(l, src, dx, dy) }));

export const zoomImageAt = (pointer: { x: number; y: number }, factor: number): void =>
  updateImage((l, src) => ({ xf: zoomImageXf(l, src, pointer, factor) }));

export const setImageScale = (scale: number): void => updateImage((l, src) => ({ xf: setImageScaleXf(l, src, scale) }));

/** The rotate slider's gesture (AM28): its snap direction follows the slider, not the stored angle. */
const rotateGesture = rotateSliderGesture();
export const startRotateGesture = (): void => rotateGesture.start(imageLayer.value?.xf.rotDeg ?? 0);
export const endRotateGesture = (): void => rotateGesture.end();
/** The slider's raw value → the snapped angle, within the current gesture. */
export const setImageRotation = (raw: number): void =>
  updateImage((l, src) => ({ xf: rotateImageToXf(l, src, rotateGesture.input(l.xf.rotDeg, raw)) }));

/** Back to the initial cover placement. */
export const refitImage = (): void => updateImage((l, src) => ({ xf: initialXf(l.fit, src, l.focal) }));

/** The blurred backdrop behind a fitted (contain) photo. */
const FIT_BACKDROP = { radiusPx: 48, dim: 0.2 } as const;

/**
 * Framing (inpage-ui-spec.md FS3): Fill covers the frame (black behind), Fit shows the whole photo over a
 * blurred, dimmed copy of itself. The placement starts over, keeping the rotation.
 */
export function setFit(fit: 'cover' | 'contain'): void {
  const l = imageLayer.value;
  const img = image.value;
  if (!l || !img || l.fit === fit) return;
  const start = initialXf(fit, img.size, l.focal);
  const xf = rotateImageToXf({ fit, xf: start }, img.size, l.xf.rotDeg);
  const background =
    fit === 'contain'
      ? { kind: 'blur' as const, assetId: l.assetId, ...FIT_BACKDROP }
      : { kind: 'solid' as const, color: '#000000' };
  updateFrame((f) => ({
    ...f,
    background,
    layers: f.layers.map((x) => (x.id === l.id ? { ...l, fit, xf } : x)),
  }));
}

/** Rotate by a quarter turn (Left −90°, Right +90°), within ±180°. */
export function rotateImageBy(deg: number): void {
  updateImage((l, src) => {
    let next = l.xf.rotDeg + deg;
    while (next > 180) next -= 360;
    while (next <= -180) next += 360;
    return { xf: rotateImageToXf(l, src, Math.round(next * 2) / 2) };
  });
}

/** Whether the photo moved from its initial placement (Reset shows only then). */
export const placementChanged = computed(() => {
  const l = imageLayer.value;
  const img = image.value;
  if (!l || !img) return false;
  const start = initialXf(l.fit, img.size, l.focal);
  const d = (a: number, b: number) => Math.abs(a - b) > 0.5;
  return (
    d(l.xf.cx, start.cx) || d(l.xf.cy, start.cy) || Math.abs(l.xf.scale - start.scale) > 0.001 || l.xf.rotDeg !== 0
  );
});

// ---- text -------------------------------------------------------------------------------

export const setText = (text: string): void => updateText({ text });
export const setTextStyle = (style: 'plain' | 'highlight'): void => updateText({ style });
export const setTextSize = (sizePx: number): void =>
  updateText({ sizePx: Math.min(TEXT_SIZE_RANGE.max, Math.max(TEXT_SIZE_RANGE.min, Math.round(sizePx))) });
export const setTextColor = (color: string): void => updateText({ color });
export const moveText = (dx: number, dy: number): void => updateText((l) => ({ xf: moveTextXf(l.xf, dx, dy) }));
