/**
 * StoryDoc, schema 1 (strategy §3.3). Units: story pixels, x in 0..1080, y in 0..1920,
 * origin top-left, y down. Rotation is in degrees, positive = clockwise on screen.
 * Colours are CSS hex strings (`#rrggbb` or `#rrggbbaa`).
 *
 * This file is the persisted format (IndexedDB `docs`). Any change to it needs a schema
 * bump plus a step in migrate.ts.
 */

export const STORY_W = 1080;
export const STORY_H = 1920;
export const STORY_SCHEMA = 1;

export interface StoryDoc {
  id: string;
  schema: 1;
  size: { w: 1080; h: 1920 };
  frames: Frame[];
  createdAt: number;
  updatedAt: number;
}

export interface Frame {
  id: string;
  /** null = photo. Video and audio frames set it (v2). */
  durationMs: number | null;
  background: Fill;
  /** Bottom to top. */
  layers: Layer[];
  /** closeFriends forces the phone lane. */
  audience: 'all' | 'closeFriends';
  /** Forces the phone lane. */
  musicPlan?: MusicPlan;
}

export type Fill =
  | { kind: 'solid'; color: string }
  /** Colours sampled from the image (P3). */
  | { kind: 'gradient'; from: string; to: string; angleDeg: number }
  /** A cover-fitted, blurred copy of an asset; `dim` 0..1 darkens it. */
  | { kind: 'blur'; assetId: string; radiusPx: number; dim: number };

/**
 * Layer placement, centre-based: (cx, cy) is where the layer's centre sits, in story px.
 * `scale` 1 = the fit's base scale (image layers) or the natural size (text layers).
 */
export interface Xf {
  cx: number;
  cy: number;
  scale: number;
  rotDeg: number;
}

/** Ignored for photos. */
export interface Timed {
  startMs?: number;
  endMs?: number;
}

export type Layer = ImageLayer | TextLayer | PlaceholderLayer | VideoLayer;

export interface ImageLayer extends Timed {
  kind: 'image';
  id: string;
  assetId: string;
  fit: 'cover' | 'contain' | 'free';
  /** 0..1 in source space; used for the initial placement and "re-fit". `xf` is the source of truth. */
  focal: { x: number; y: number };
  xf: Xf;
}

export interface TextLayer extends Timed {
  kind: 'text';
  id: string;
  text: string;
  fontId: string;
  sizePx: number;
  color: string;
  align: 'left' | 'center' | 'right';
  style: 'plain' | 'highlight' | 'inverse' | 'outline' | 'glow';
  boxColor?: string;
  letterSpacingPx: number;
  /** Multiple of sizePx. */
  lineHeight: number;
  maxWidthPx: number;
  xf: Xf;
}

/** Preview only, never exported. Reserves space for a sticker added later in the app. */
export interface PlaceholderLayer {
  kind: 'placeholder';
  id: string;
  purpose: 'music' | 'mention' | 'link' | 'poll' | 'location' | 'other';
  rect: { x: number; y: number; w: number; h: number };
  label: string;
}

/** Reserved: compose() throws NOT_IMPLEMENTED until V1. */
export interface VideoLayer extends Timed {
  kind: 'video';
  id: string;
  assetId: string;
  trim: { inMs: number; outMs: number };
  fit: 'cover' | 'contain';
  xf: Xf;
}

export interface MusicPlan {
  title: string;
  artist?: string;
  startSec?: number;
  note?: string;
}

export type LayerKind = Layer['kind'];
export type FitMode = ImageLayer['fit'];
export type TextAlign = TextLayer['align'];
export type TextStyle = TextLayer['style'];
export type PlaceholderPurpose = PlaceholderLayer['purpose'];
export type Audience = Frame['audience'];

export const isPhotoFrame = (frame: Frame): boolean => frame.durationMs === null;

export const findFrame = (doc: StoryDoc, frameId: string): Frame | undefined =>
  doc.frames.find((f) => f.id === frameId);

/** A new document with one empty photo frame on a black background. */
export function createDoc(ids: { docId: string; frameId: string }, now: number): StoryDoc {
  return {
    id: ids.docId,
    schema: 1,
    size: { w: 1080, h: 1920 },
    frames: [
      {
        id: ids.frameId,
        durationMs: null,
        background: { kind: 'solid', color: '#000000' },
        layers: [],
        audience: 'all',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}
