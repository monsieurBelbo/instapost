/**
 * The in-page messages (docs/inpage.md §10.4): background ⇄ the content script in Instagram's top frame,
 * and background ⇄ the panel (an extension page framed in the same tab). JSON with `v: 1`, shape-checked on
 * arrival; the content script's own messages are accepted only from frame 0 of the run's tab, on www
 * (acceptPageMessage). The content script's messages never carry a photo, a cookie or page content: only
 * sizes, pathnames and booleans. The panel's start carries the edited export (the panel is an extension page;
 * the bytes never pass through Instagram's page).
 */

import { IG_ORIGIN } from '../core/ig-contract/urls.ts';
import type { Box, FrameToggle } from '../core/inpage/frame-box.ts';
import { FRAME_TOGGLES } from '../core/inpage/frame-box.ts';
import { FRAME_UA_VARIANTS, type FrameUaVariant } from '../core/inpage/variants.ts';
import type { SenderLike } from '../shared/protocol.ts';
import type { Lang } from '../ui/i18n-core.ts';
import type { PreviewMode } from './geometry.ts';
import type { ResultKind } from './run-view.ts';

/** The port the content script holds while a run has a frame in its page (its disconnect = PAGE_LEFT). */
export const PAGE_PORT = 'inpage-page';
/** The composer's port (an extension page framed in an Instagram tab). */
export const PANEL_PORT = 'inpage-composer';

export const ENGINE_VIEWS = ['phone', 'covered'] as const;
export type EngineView = (typeof ENGINE_VIEWS)[number];

/**
 * The Developer toggles (docs/inpage.md §10.3; inpage-ui-spec.md FS14), guarded builds only: storage.local
 * DEV_TOGGLES_KEY, read by the background and set in Settings → Advanced → Developer. Live runs always use
 * DEFAULT_TOGGLES; the key is an `__e2e…` name, so check-bundle T3's E2E-hook scan proves it is not in live.
 */
export interface DevToggles {
  ua: FrameUaVariant;
  frame: FrameToggle;
  view: EngineView;
  /** `off` leaves rule 1020 out, so Chromium refuses the frame (FRAME_REFUSED, E58). */
  xfoRule: 'on' | 'off';
  /** `document` adds rule 1021 (forged `Sec-Fetch-Dest: document` on the frame's page loads). */
  fetchDest: 'document' | 'iframe';
}

export const DEFAULT_TOGGLES: DevToggles = {
  ua: 'tabwide',
  frame: 'auto',
  view: 'phone',
  xfoRule: 'on',
  fetchDest: 'document',
};
export const DEV_TOGGLES_KEY = '__e2eInpageToggles';

export function toToggles(x: unknown): DevToggles {
  const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
  return {
    ua: (FRAME_UA_VARIANTS as readonly string[]).includes(o.ua as string)
      ? (o.ua as FrameUaVariant)
      : DEFAULT_TOGGLES.ua,
    frame: FRAME_TOGGLES.includes(o.frame as FrameToggle) ? (o.frame as FrameToggle) : DEFAULT_TOGGLES.frame,
    view: ENGINE_VIEWS.includes(o.view as EngineView) ? (o.view as EngineView) : DEFAULT_TOGGLES.view,
    xfoRule: o.xfoRule === 'off' ? 'off' : 'on',
    fetchDest: o.fetchDest === 'iframe' ? 'iframe' : 'document',
  };
}

// ---- the in-page UI (inpage-ui-spec.md FI4) ---------------------------------------------------------------

/** The owner's in-page preferences (storage.local `inpageUi`), written by the composer and the coach. */
export interface InpageUiPrefs {
  /** FE5: `none` = the toolbar and its keyboard shortcut only. */
  entry: 'sidebar' | 'none';
  /** FS7: how the live phone shows while posting. */
  preview: PreviewMode;
  /** FE8: the coach mark was dismissed. */
  coachSeen: boolean;
}
export const UI_PREFS_KEY = 'inpageUi';
export const PREVIEW_MODES: readonly PreviewMode[] = ['small', 'large', 'hidden'];
export const DEFAULT_UI_PREFS: InpageUiPrefs = { entry: 'sidebar', preview: 'small', coachSeen: false };

export function toUiPrefs(x: unknown): InpageUiPrefs {
  const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
  return {
    entry: o.entry === 'none' ? 'none' : 'sidebar',
    preview: PREVIEW_MODES.includes(o.preview as PreviewMode) ? (o.preview as PreviewMode) : 'small',
    coachSeen: o.coachSeen === true,
  };
}

/** The composer iframe's mode, owned by the content script (FC1, FS8). */
export type ComposerMode = 'closed' | 'open' | 'chip';
export const COMPOSER_MODES: readonly ComposerMode[] = ['closed', 'open', 'chip'];

/** The run as one Instagram tab sees it (FI4 `inpage/state`; replaces the boolean run-state). */
export interface PageRunState {
  phase: 'idle' | 'running' | 'result';
  /** The run belongs to this tab. */
  here: boolean;
  runId: string | null;
  mode: RunMode | null;
  /** The owner-facing step in progress, 0..4. */
  step: number;
  /** 0..1. */
  progress: number;
  shared: boolean;
  frameLoaded: boolean;
  startedAt: number | null;
  endedAt: number | null;
  result: ResultKind | null;
  /** The handle the result names (Posted to @handle's story). */
  handle: string | null;
}

export interface PageState {
  run: PageRunState;
  /** The msite lock (FX9), epoch ms, or null. */
  pausedUntil: number | null;
  prefs: InpageUiPrefs;
  /**
   * AM48: the language of what the content script writes on the page (the entry, its tooltip, the coach):
   * Settings → Language, with Auto resolved by the background from the browser's UI language. The content
   * script reads no storage of its own.
   */
  lang: Lang;
  /**
   * RL-10: the toolbar shortcut as the browser shows it (`⌥⇧S` on a Mac, `Alt+Shift+S` elsewhere), or null when
   * none is set: the entry, its tooltip and the coach then show no key.
   */
  shortcut: string | null;
}

export const IDLE_RUN: PageRunState = {
  phase: 'idle',
  here: false,
  runId: null,
  mode: null,
  step: 0,
  progress: 0,
  shared: false,
  frameLoaded: false,
  startedAt: null,
  endedAt: null,
  result: null,
  handle: null,
};

/** What the composer asks of its page (relayed by the background). */
export type UiAction = 'open' | 'close' | 'hide';

// ---- background → content script (tabs.sendMessage(tab, msg, {frameId: 0})) ----------------------------

export type BackgroundToPage =
  | { v: 1; type: 'inpage/toggle-panel'; open?: boolean }
  | { v: 1; type: 'inpage/open-frame'; runId: string; frame: FrameToggle; view: EngineView }
  | { v: 1; type: 'inpage/remove-frame'; runId: string }
  | { v: 1; type: 'inpage/unload-guard'; runId: string; on: boolean }
  /** Kept for the driver (it still says so at teardown); the page reads `inpage/state` instead. */
  | { v: 1; type: 'inpage/run-state'; running: boolean }
  | { v: 1; type: 'inpage/state'; state: PageState }
  | { v: 1; type: 'inpage/ui'; action: UiAction; auto?: boolean }
  | { v: 1; type: 'inpage/preview'; preview: PreviewMode };

/** The content script's answer to open-frame: the box it gave the frame, the page's DPR and the scale. */
export type OpenFrameReply = { ok: true; box: Box; dpr: number; scale: number } | { ok: false; why: string };

// ---- content script → background (runtime.sendMessage) -----------------------------------------------

export type PageToBackground =
  /** The engine iframe's `load`: whether its location was readable (same origin) and its pathname. */
  | { v: 1; type: 'inpage/frame-loaded'; runId: string; readable: boolean; path: string | null }
  /** The frame's pathname changed (a pushState) or became unreadable (it left www). */
  | { v: 1; type: 'inpage/frame-path'; runId: string; readable: boolean; path: string | null };

/** The content script's UI messages (not run-addressed): its hello, the composer's mode, the page's look. */
export type PageUiToBackground =
  /** Before anything else: whether this page may host the lane (not the window lane's composer window). */
  | { v: 1; type: 'inpage/attach' }
  | { v: 1; type: 'inpage/hello' }
  | { v: 1; type: 'inpage/composer'; mode: ComposerMode; compact: boolean; closing: boolean }
  | { v: 1; type: 'inpage/page'; scheme: 'light' | 'dark'; loggedIn: boolean | null; handle: string | null }
  | { v: 1; type: 'inpage/coach-seen' };

// ---- panel ⇄ background (PANEL_PORT) --------------------------------------------------------------------

export const RUN_MODES = ['check', 'test', 'shareTest', 'post'] as const;
export type RunMode = (typeof RUN_MODES)[number];

/** The edited export's base64 can be at most this long (a 1080×1920 PNG is about 3–7 MB). */
export const MAX_PHOTO_B64 = 24_000_000;

/** The photo the insert gives the agent: the panel's export (PNG for msite, export policy), as base64. */
export interface RunPhoto {
  mime: 'image/png' | 'image/jpeg';
  b64: string;
  /** IA7: the export's 16×16 RGBA sample, base64 (diagnostic image check in the composer). */
  sample: string | null;
  /** RL-13: the export's SHA-256 and its doc's hash (hex), for the duplicate guard (story-guard.ts). */
  sha256?: string;
  docHash?: string;
}

export type PanelToBackground =
  | { v: 1; type: 'run/start'; mode: RunMode; confirmShare: boolean; photo?: RunPhoto | null }
  | { v: 1; type: 'run/stop' }
  | { v: 1; type: 'ui/close-panel' }
  /** Close, hide or open the composer (the content script decides closed vs chip). */
  | { v: 1; type: 'ui/request'; action: UiAction; auto?: boolean }
  | { v: 1; type: 'ui/preview'; preview: PreviewMode }
  /** View story / Check my story: this tab goes to /stories/<handle>/. */
  | { v: 1; type: 'ui/view-story'; handle: string }
  /** K7 Show it: the tab that is posting comes to the front (only on this click, P7). */
  | { v: 1; type: 'ui/show-tab'; tabId: number }
  /** RL-13: the owner's It posted · It didn't post on a Couldn't confirm: written onto the stored record. */
  | { v: 1; type: 'ui/mark'; runId: string; mark: 'posted' | 'notPosted' };

/** Background → the composer (PANEL_PORT). */
export type BackgroundToPanel =
  | { v: 1; type: 'ui/hello'; tabId: number }
  | { v: 1; type: 'ui/mode'; mode: ComposerMode; compact: boolean; closing: boolean }
  | { v: 1; type: 'ui/page'; scheme: 'light' | 'dark'; loggedIn: boolean | null; handle: string | null };

// ---- guards ---------------------------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const v1 = (x: unknown): x is Obj => isObj(x) && x.v === 1 && typeof x.type === 'string';
const isRunId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(x);
const isPath = (x: unknown): x is string | null =>
  x === null || (typeof x === 'string' && x.startsWith('/') && x.length <= 512);

export function isBackgroundToPage(x: unknown): x is BackgroundToPage {
  if (!v1(x)) return false;
  switch (x.type) {
    case 'inpage/toggle-panel':
      return x.open === undefined || typeof x.open === 'boolean';
    case 'inpage/open-frame':
      return (
        isRunId(x.runId) &&
        FRAME_TOGGLES.includes(x.frame as FrameToggle) &&
        ENGINE_VIEWS.includes(x.view as EngineView)
      );
    case 'inpage/remove-frame':
      return isRunId(x.runId);
    case 'inpage/unload-guard':
      return isRunId(x.runId) && typeof x.on === 'boolean';
    case 'inpage/run-state':
      return typeof x.running === 'boolean';
    case 'inpage/state':
      return isObj(x.state) && isObj(x.state.run) && isObj(x.state.prefs);
    case 'inpage/ui':
      return (
        (x.action === 'open' || x.action === 'close' || x.action === 'hide') &&
        (x.auto === undefined || typeof x.auto === 'boolean')
      );
    case 'inpage/preview':
      return PREVIEW_MODES.includes(x.preview as PreviewMode);
    default:
      return false;
  }
}

export function isPageUiToBackground(x: unknown): x is PageUiToBackground {
  if (!v1(x)) return false;
  switch (x.type) {
    case 'inpage/attach':
    case 'inpage/hello':
    case 'inpage/coach-seen':
      return true;
    case 'inpage/composer':
      return (
        COMPOSER_MODES.includes(x.mode as ComposerMode) &&
        typeof x.compact === 'boolean' &&
        typeof x.closing === 'boolean'
      );
    case 'inpage/page':
      return (
        (x.scheme === 'light' || x.scheme === 'dark') &&
        (x.loggedIn === null || typeof x.loggedIn === 'boolean') &&
        (x.handle === null || (typeof x.handle === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(x.handle)))
      );
    default:
      return false;
  }
}

/** A content-script UI message counts only from this extension, frame 0 of a tab on www. */
export function acceptPageUiMessage(
  raw: unknown,
  sender: SenderLike,
  runtimeId: string,
): { ok: true; msg: PageUiToBackground; tabId: number } | { ok: false; reason: string } {
  if (!isPageUiToBackground(raw)) return { ok: false, reason: 'shape' };
  if (sender.id !== runtimeId) return { ok: false, reason: 'sender-id' };
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { ok: false, reason: 'tab' };
  if (sender.frameId !== 0) return { ok: false, reason: 'frame' };
  if (originOf(sender.url) !== IG_ORIGIN) return { ok: false, reason: 'origin' };
  return { ok: true, msg: raw, tabId };
}

export function isPageToBackground(x: unknown): x is PageToBackground {
  if (!v1(x)) return false;
  switch (x.type) {
    case 'inpage/frame-loaded':
    case 'inpage/frame-path':
      return isRunId(x.runId) && typeof x.readable === 'boolean' && isPath(x.path);
    default:
      return false;
  }
}

/** The background's answer to `inpage/attach`. */
export interface AttachReply {
  attach: boolean;
}
export const isAttachReply = (x: unknown): x is AttachReply => isObj(x) && typeof x.attach === 'boolean';

export const isPageShaped = (x: unknown): boolean => v1(x) && String(x.type).startsWith('inpage/');

export function isOpenFrameReply(x: unknown): x is OpenFrameReply {
  if (!isObj(x)) return false;
  if (x.ok === false) return typeof x.why === 'string';
  const box = x.box as Obj | undefined;
  return (
    x.ok === true &&
    isObj(box) &&
    typeof box.w === 'number' &&
    typeof box.h === 'number' &&
    typeof x.dpr === 'number' &&
    typeof x.scale === 'number'
  );
}

export function isPanelToBackground(x: unknown): x is PanelToBackground {
  if (!v1(x)) return false;
  switch (x.type) {
    case 'run/start':
      return (
        RUN_MODES.includes(x.mode as RunMode) &&
        typeof x.confirmShare === 'boolean' &&
        (x.photo === undefined || x.photo === null || isRunPhoto(x.photo))
      );
    case 'run/stop':
    case 'ui/close-panel':
      return true;
    case 'ui/request':
      return (
        (x.action === 'open' || x.action === 'close' || x.action === 'hide') &&
        (x.auto === undefined || typeof x.auto === 'boolean')
      );
    case 'ui/preview':
      return PREVIEW_MODES.includes(x.preview as PreviewMode);
    case 'ui/view-story':
      return typeof x.handle === 'string' && /^[A-Za-z0-9._]{1,30}$/.test(x.handle);
    case 'ui/show-tab':
      return typeof x.tabId === 'number' && Number.isInteger(x.tabId) && x.tabId >= 0;
    case 'ui/mark':
      return (
        typeof x.runId === 'string' &&
        /^inp_[\w-]{1,80}$/.test(x.runId) &&
        (x.mark === 'posted' || x.mark === 'notPosted')
      );
    default:
      return false;
  }
}

const isHex64 = (x: unknown): boolean => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);

/** A photo from the panel: PNG or JPEG base64 within MAX_PHOTO_B64, an optional short sample and its hashes. */
export function isRunPhoto(x: unknown): x is RunPhoto {
  if (!isObj(x)) return false;
  return (
    (x.mime === 'image/png' || x.mime === 'image/jpeg') &&
    typeof x.b64 === 'string' &&
    x.b64.length > 0 &&
    x.b64.length <= MAX_PHOTO_B64 &&
    x.b64.length % 4 === 0 &&
    (x.sample === null || (typeof x.sample === 'string' && x.sample.length <= 4096)) &&
    (x.sha256 === undefined || isHex64(x.sha256)) &&
    (x.docHash === undefined || isHex64(x.docHash))
  );
}

function originOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * A content-script message is the run's only when: valid shape; `sender.id` is this extension; it comes from
 * frame 0 of a tab on www (the content script runs in Instagram's top frame only); for run-addressed
 * messages, the run's tab and runId.
 */
export function acceptPageMessage(
  raw: unknown,
  sender: SenderLike,
  runtimeId: string,
  run: { tabId: number; runId: string } | null,
): { ok: true; msg: PageToBackground; tabId: number } | { ok: false; reason: string } {
  if (!isPageToBackground(raw)) return { ok: false, reason: 'shape' };
  if (sender.id !== runtimeId) return { ok: false, reason: 'sender-id' };
  const tabId = sender.tab?.id;
  if (tabId === undefined) return { ok: false, reason: 'tab' };
  if (sender.frameId !== 0) return { ok: false, reason: 'frame' };
  if (originOf(sender.url) !== IG_ORIGIN) return { ok: false, reason: 'origin' };
  if (run === null || run.tabId !== tabId) return { ok: false, reason: 'no-run' };
  if (raw.runId !== run.runId) return { ok: false, reason: 'run' };
  return { ok: true, msg: raw, tabId };
}

/**
 * The composer is one of this extension's pages framed in an Instagram tab: `sender.id` is ours and its URL
 * is a chrome-extension: URL (with `use_dynamic_url`, the host is a per-session id, not the extension id), in
 * a tab (docs/inpage.md §3.3 "The editor port check").
 */
export function isOwnFramedPage(sender: SenderLike, runtimeId: string): boolean {
  if (sender.id !== runtimeId || sender.tab?.id === undefined) return false;
  try {
    return new URL(sender.url ?? '').protocol === 'chrome-extension:';
  } catch {
    return false;
  }
}
