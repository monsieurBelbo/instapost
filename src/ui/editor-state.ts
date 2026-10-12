/**
 * Editor state (strategy §7.10): one StoryDoc with one photo frame, holding at most one image
 * layer (bottom) and one text layer (top). Signals at module scope, so the state survives the
 * switch between `#/` and `#/settings`. Drafts and undo arrive in P8.
 */
import { batch, computed, signal } from '@preact/signals';
import type { Size } from '../core/geometry/fit.ts';
import { initialXf } from '../core/geometry/fit.ts';
import { newId } from '../core/model/ids.ts';
import { createDoc, type Frame, type ImageLayer, type StoryDoc, type TextLayer } from '../core/model/story.ts';
import type { TextMeasurer } from '../core/text/layout.ts';
import { DEFAULT_FONT_ID } from '../raster/fonts.ts';
import { canvasMeasurer } from '../raster/measurer-canvas.ts';
import { importImage, type LoadedImage, releaseImage } from './assets.ts';
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
export const showSafeZones = signal(true);
/** Instrument Sans is loaded (text cannot be measured or drawn before). */
export const fontsReady = signal(false);

export type Busy = 'import' | 'download' | 'share' | 'post';
export const busy = signal<Busy | null>(null);

export interface Notice {
  kind: 'info' | 'error';
  text: string;
  /** Error code (ErrorCode or RasterError code) for tests and styling. */
  code?: string;
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
  return img && img.assetId === assetId ? img.size : undefined;
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

/** The message for a thrown error, with its code when it has one. */
export function errorNotice(err: unknown): Notice {
  const code = (err as { code?: unknown } | null)?.code;
  const text = err instanceof Error ? err.message : String(err);
  return typeof code === 'string' ? { kind: 'error', text, code } : { kind: 'error', text };
}

// ---- image ------------------------------------------------------------------------------

/** Loads a file as the frame's image (replacing the previous one), cover-fitted and centred. */
export async function loadImageFile(file: Blob): Promise<void> {
  if (busy.value) return;
  busy.value = 'import';
  setNotice(null);
  try {
    const loaded = await importImage(file);
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
      updateFrame((f) => ({ ...f, layers: [layer, ...f.layers.filter((l) => l.kind !== 'image')] }));
    });
    if (previous) releaseImage(previous);
    if (!loaded.stored)
      setNotice({ kind: 'info', text: 'The original could not be saved locally; editing still works.' });
  } catch (err) {
    setNotice(errorNotice(err));
  } finally {
    busy.value = null;
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

// ---- text -------------------------------------------------------------------------------

export const setText = (text: string): void => updateText({ text });
export const setTextStyle = (style: 'plain' | 'highlight'): void => updateText({ style });
export const setTextSize = (sizePx: number): void =>
  updateText({ sizePx: Math.min(TEXT_SIZE_RANGE.max, Math.max(TEXT_SIZE_RANGE.min, Math.round(sizePx))) });
export const setTextColor = (color: string): void => updateText({ color });
export const moveText = (dx: number, dy: number): void => updateText((l) => ({ xf: moveTextXf(l.xf, dx, dy) }));
