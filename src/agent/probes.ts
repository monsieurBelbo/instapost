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
  isStoryCandidateAccept,
  NAV_TYPES,
  type NavType,
  type ProbeReport,
  STORY_ACCEPT,
} from '../core/ig-contract/contract.ts';
import { parseIsMobile, UA_JSON_KEY } from '../core/ig-contract/ua-json.ts';
import { COMPOSER_PATH_PREFIX, UA_RULE_HOSTS } from '../core/ig-contract/urls.ts';
import { PROBE_LIMITS } from '../shared/protocol.ts';

/** The window the agent reads; its constructors (File, DataTransfer, Event) belong to the same realm. */
export type AgentWindow = Window & typeof globalThis;

/** Every `input[type=file]` in the document, in document order. */
export function fileInputs(doc: Document): HTMLInputElement[] {
  return Array.from(doc.querySelectorAll('input')).filter((el) => el.type === 'file');
}

/**
 * C4 candidate: a file input whose accept list names image types only and is not the post input's
 * (`image/jpeg` alone, POST_ACCEPT); an input without an accept list never counts.
 */
export function isStoryCandidate(input: HTMLInputElement): boolean {
  return isStoryCandidateAccept(input.accept);
}

/** C4: the first candidate whose accept list set-equals STORY_ACCEPT, or null. The autopilot arms and fills it. */
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

/** Rendered and not hidden by CSS (display, visibility, opacity). */
export function isShown(win: AgentWindow, el: Element): boolean {
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
    if (r.width <= 0 || r.height <= 0 || !isShown(win, el)) continue;
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

/** The service worker controlling this document, as the isolated world sees it. Diagnostics only (P1). */
export function swControlled(win: AgentWindow): ProbeReport['swControlled'] {
  const sw = win.navigator.serviceWorker;
  return sw ? sw.controller !== null : 'unknown';
}

/** The hosts rule 1001 covers: a request to one of them that a worker handled went out without it. */
const RULE_HOSTS: readonly string[] = UA_RULE_HOSTS;

/** The host of an absolute http(s) URL, lower-cased; null otherwise (no URL global needed). */
function hostOf(url: string): string | null {
  const m = /^https?:\/\/([^/?#]*)/i.exec(url);
  if (!m) return null;
  const authority = m[1] ?? '';
  const host = authority.slice(authority.lastIndexOf('@') + 1).replace(/:\d+$/, '');
  return host.toLowerCase();
}

/** The fields of a PerformanceEntry the tripwire reads. */
export interface TimingLike {
  name: string;
  workerStart?: number;
  type?: string;
}

/**
 * P3 tripwire, one entry: a www/i.instagram.com resource that a service worker handled
 * (`workerStart > 0`). Resource entries only; the navigation entry has its own rule.
 */
export function resourceIntercepted(entry: TimingLike): boolean {
  const host = hostOf(entry.name);
  return host !== null && RULE_HOSTS.includes(host) && (entry.workerStart ?? 0) > 0;
}

/** P3, the navigation entry: handled by a worker (`workerStart > 0`) on a load that was not a reload. */
export function navigationIntercepted(entry: TimingLike): boolean {
  return (entry.workerStart ?? 0) > 0 && entry.type !== 'reload';
}

function entries(win: AgentWindow, type: 'navigation' | 'resource'): TimingLike[] | null {
  const perf = win.performance as Partial<Performance> | undefined;
  if (!perf || typeof perf.getEntriesByType !== 'function') return null;
  try {
    return perf.getEntriesByType(type) as unknown as TimingLike[];
  } catch {
    return null;
  }
}

/**
 * P3: whether a service worker handled this document's requests (SW_INTERCEPTS), from the
 * performance timeline the isolated world shares with the page, and the navigation type.
 * F2: Instagram's worker has no fetch handler, so on a healthy page every `workerStart` is 0.
 */
export function swInterception(win: AgentWindow): { swIntercepted: ProbeReport['swIntercepted']; navType: NavType } {
  const nav = entries(win, 'navigation');
  const res = entries(win, 'resource');
  const first = nav?.[0];
  const navType: NavType =
    first && (NAV_TYPES as readonly string[]).includes(first.type ?? '') ? (first.type as NavType) : 'unknown';
  if (nav === null || res === null) return { swIntercepted: 'unknown', navType };
  const intercepted = (first !== undefined && navigationIntercepted(first)) || res.some(resourceIntercepted);
  return { swIntercepted: intercepted, navType };
}

/** IA5: navigator.userActivation as the page has it (the isolated world shares the window's state). */
export function activationOf(win: AgentWindow): { isActive: boolean; hasBeenActive: boolean } {
  const ua = (win.navigator as Navigator & { userActivation?: { isActive: boolean; hasBeenActive: boolean } })
    .userActivation;
  return { isActive: ua?.isActive === true, hasBeenActive: ua?.hasBeenActive === true };
}

/** The full report for `agent/probe` (strategy §3.5, ux.md IA5). */
export function probeComposer(win: AgentWindow, extra: Partial<ProbeReport> = {}): ProbeReport {
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
    ...swInterception(win),
    storyInput: inputs.some(isStoryCandidate) ? 'present' : 'absent',
    acceptOk: findStoryInput(doc) !== null,
    acceptSeen: inputs.slice(0, PROBE_LIMITS.acceptEntries).map((el) => el.accept.slice(0, PROBE_LIMITS.acceptLength)),
    ...(canvas ? { canvas: { w: canvas.el.width, h: canvas.el.height, css: canvas.rect } } : {}),
    lang: (doc.documentElement.lang || '').slice(0, PROBE_LIMITS.lang),
    activation: activationOf(win),
    visibility: doc.visibilityState === 'hidden' ? 'hidden' : 'visible',
    ...extra,
  };
}
