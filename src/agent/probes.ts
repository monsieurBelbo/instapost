/**
 * Composer probes (strategy §3.5 ProbeReport, §3.9 C1, C3, C4, C6, C8). DOM reads only, and
 * structural only: element types, attributes, geometry. Never visible text or ARIA labels (the
 * owner may use a Spanish UI) and never test hooks. Every function takes the window it reads,
 * so B6 can run them against the fake's components.
 */
import {
  acceptSetEquals,
  C6_MIN_VIEWPORT_AREA,
  FAKE_MARKER_META,
  type ProbeReport,
  STORY_ACCEPT,
} from '../core/ig-contract/contract.ts';
import { parseIsMobile, UA_JSON_KEY } from '../core/ig-contract/ua-json.ts';
import { COMPOSER_PATH_PREFIX } from '../core/ig-contract/urls.ts';
import { PROBE_LIMITS } from '../shared/protocol.ts';

/** The window the agent reads; its constructors (File, DataTransfer, Event) belong to the same realm. */
export type AgentWindow = Window & typeof globalThis;

const tokens = (accept: string): string[] =>
  accept
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

/** Every `input[type=file]` in the document, in document order. */
export function fileInputs(doc: Document): HTMLInputElement[] {
  return Array.from(doc.querySelectorAll('input')).filter((el) => el.type === 'file');
}

/**
 * C4 candidate: a file input whose accept list names image types only. The post input also
 * accepts video, so it never counts; an input without an accept list never counts either.
 */
export function isStoryCandidate(input: HTMLInputElement): boolean {
  const list = tokens(input.accept);
  return list.length > 0 && list.every((t) => /^image\//i.test(t));
}

/** C4: the first candidate whose accept list set-equals STORY_ACCEPT, or null. H1 inserts into it. */
export function findStoryInput(doc: Document): HTMLInputElement | null {
  return fileInputs(doc).find((el) => isStoryCandidate(el) && acceptSetEquals(el.accept, STORY_ACCEPT)) ?? null;
}

export function hasStoryCandidate(doc: Document): boolean {
  return fileInputs(doc).some(isStoryCandidate);
}

/** C1: the first `script[type="application/json"]` whose text contains the UA key. */
export function readIsMobile(doc: Document): ProbeReport['isMobile'] {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/json" i]'))) {
    const text = script.textContent ?? '';
    if (text.includes(UA_JSON_KEY)) return parseIsMobile(text);
  }
  return 'unknown';
}

/** The composer route: `/create/story` itself or below it. */
export function isComposerPath(path: string): boolean {
  return path === COMPOSER_PATH_PREFIX || path.startsWith(`${COMPOSER_PATH_PREFIX}/`);
}

export interface CanvasSeen {
  el: HTMLCanvasElement;
  /** Full CSS rect (C8). */
  rect: { x: number; y: number; w: number; h: number };
  /** CSS area inside the viewport (C6). */
  visibleArea: number;
}

function shown(win: AgentWindow, el: Element): boolean {
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  }
  const cs = win.getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse' && cs.opacity !== '0';
}

/** Canvases that are rendered, not hidden and at least partly inside the viewport. */
export function visibleCanvases(win: AgentWindow): CanvasSeen[] {
  const out: CanvasSeen[] = [];
  for (const el of Array.from(win.document.querySelectorAll('canvas'))) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || !shown(win, el)) continue;
    const w = Math.min(r.right, win.innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0);
    if (w <= 0 || h <= 0) continue;
    out.push({ el, rect: { x: r.x, y: r.y, w: r.width, h: r.height }, visibleArea: w * h });
  }
  return out;
}

/** C8: the largest visible canvas (by area inside the viewport), or null. */
export function largestCanvas(win: AgentWindow): CanvasSeen | null {
  let best: CanvasSeen | null = null;
  for (const c of visibleCanvases(win)) if (!best || c.visibleArea > best.visibleArea) best = c;
  return best;
}

/** The canvases that satisfy C6: visible, a backing store, at least half of the viewport's CSS area. */
export function readyCanvases(win: AgentWindow): HTMLCanvasElement[] {
  const viewport = win.innerWidth * win.innerHeight;
  if (viewport <= 0) return [];
  return visibleCanvases(win)
    .filter((c) => c.el.width > 0 && c.el.height > 0 && c.visibleArea >= C6_MIN_VIEWPORT_AREA * viewport)
    .map((c) => c.el);
}

/** C6: a visible canvas covering at least half of the viewport's CSS area, with a backing store. */
export function isComposerReady(win: AgentWindow): boolean {
  return readyCanvases(win).length > 0;
}

/** The service worker controlling this document, as the isolated world sees it. */
export function swControlled(win: AgentWindow): ProbeReport['swControlled'] {
  const sw = win.navigator.serviceWorker;
  return sw ? sw.controller !== null : 'unknown';
}

/** The full report for `agent/probe` (strategy §3.5). */
export function probeComposer(win: AgentWindow): ProbeReport {
  const doc = win.document;
  const inputs = fileInputs(doc);
  const canvas = largestCanvas(win);
  return {
    marker: doc.querySelector(`meta[name="${FAKE_MARKER_META}"]`) !== null,
    isMobile: readIsMobile(doc),
    inner: { w: win.innerWidth, h: win.innerHeight },
    dpr: win.devicePixelRatio || 1,
    portrait: win.innerHeight >= win.innerWidth,
    swControlled: swControlled(win),
    storyInput: inputs.some(isStoryCandidate) ? 'present' : 'absent',
    acceptOk: findStoryInput(doc) !== null,
    acceptSeen: inputs.slice(0, PROBE_LIMITS.acceptEntries).map((el) => el.accept.slice(0, PROBE_LIMITS.acceptLength)),
    ...(canvas ? { canvas: { w: canvas.el.width, h: canvas.el.height, css: canvas.rect } } : {}),
    lang: (doc.documentElement.lang || '').slice(0, PROBE_LIMITS.lang),
  };
}
