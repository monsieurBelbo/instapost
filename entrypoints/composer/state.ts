/**
 * The composer's state (inpage-ui-spec.md FC, FS): its mode as the content script sets it (open, chip,
 * closed), the page's look, the run (the driver's status over PANEL_PORT), the owner's settings and pace,
 * and the dialog's own UI state (menus, sheets, toasts, the queued post, the auto-close). The editor's
 * document and photo are src/ui/editor-state.ts's signals, unchanged.
 *
 * Everything the composer asks of its page goes over the port (the background relays it): never
 * `window.postMessage`, which Instagram would see (R25).
 */
import { batch, computed, signal } from '@preact/signals';
import { type Browser, browser } from 'wxt/browser';
import type { RateDecision } from '../../src/core/handoff/rate-guard.ts';
import type { Settings } from '../../src/core/handoff/state.ts';
import { layoutText } from '../../src/core/text/layout.ts';
import { localState, type RateInfo } from '../../src/handoff/local-state.ts';
import type { InpageRecord, InpageStatus } from '../../src/inpage/driver.ts';
import type { PreviewMode } from '../../src/inpage/geometry.ts';
import {
  type ComposerMode,
  DEFAULT_UI_PREFS,
  type InpageUiPrefs,
  PANEL_PORT,
  type PanelToBackground,
  type RunMode,
  type RunPhoto,
  toUiPrefs,
  UI_PREFS_KEY,
  type UiAction,
} from '../../src/inpage/messages.ts';
import { QUEUE_MARGIN_MS } from '../../src/inpage/post-card.ts';
import { runProgress } from '../../src/inpage/run-view.ts';
import { applyMark, type OwnerMark, type StoryId, storyStatus, withRecord } from '../../src/inpage/story-guard.ts';
import { composerStrings as S } from '../../src/inpage/strings.ts';
import type { Scheme } from '../../src/inpage/theme.ts';
import { actionShortcut } from '../../src/platform/commands.ts';
import { local } from '../../src/platform/storage.ts';
import { bytesToB64 } from '../../src/shared/b64.ts';
import { GUARDED } from '../../src/shared/env.ts';
import { clock, dateTime } from '../../src/ui/copy.ts';
import { fontsReady, image, measurer, textLayer } from '../../src/ui/editor-state.ts';
import { type CachedExport, exportCache, freshExport } from '../../src/ui/export-cache.ts';
import { setLangSetting } from '../../src/ui/i18n.ts';

export const ls = localState(GUARDED);

// ---- the page and the port --------------------------------------------------------------------------

const initialScheme = (): Scheme => {
  if (location.hash === '#dark') return 'dark';
  if (location.hash === '#light') return 'light';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const scheme = signal<Scheme>(initialScheme());
export const mode = signal<ComposerMode>('closed');
/** The chip is the thumbnail only (collapsed nav). */
export const compact = signal(false);
/** The dialog is fading out (Esc, ✕, Hide, or the page closing it). */
export const closing = signal(false);
/** The dialog is visible (one frame after the iframe opened, so it can fade and scale in). */
export const shown = signal(false);
export const loggedIn = signal<boolean | null>(null);
export const pageHandle = signal<string | null>(null);
export const tabId = signal<number | null>(null);
export const connected = signal(false);
export const status = signal<InpageStatus | null>(null);
/** Runs this composer saw start in its tab (only those show a run or a result view). */
export const seen = signal<ReadonlySet<string>>(new Set());
/** Results the owner dismissed (New story, Done, Try again). */
export const dismissed = signal<ReadonlySet<string>>(new Set());
export const prefs = signal<InpageUiPrefs>(DEFAULT_UI_PREFS);
/** RL-10: the toolbar shortcut as the browser has it (chrome://extensions/shortcuts), or null: none set. */
export const shortcut = signal<string | null>(null);
export const settings = signal<Settings | null>(null);
export const rateInfo = signal<RateInfo | null>(null);
export const postRate = signal<RateDecision | null>(null);
/** RL-14: the pace for a test or a check (spacing only), for a result's Try again. */
export const testRate = signal<RateDecision | null>(null);
/** RL-13: the stored run records (storage.local `inpageRecords`, oldest first): History and the duplicate guard. */
export const records = signal<InpageRecord[]>([]);
/** The composer iframe's size: the page's viewport while open (FC3), the chip's rect as a chip. */
export const viewport = signal({ w: innerWidth, h: innerHeight });

/**
 * Reads the iframe's size again. The page sizes the iframe before it tells the composer its mode, and a resize
 * that happened before the composer listened for it (a first open right after the preload, 2026-10-16 E2E) would
 * otherwise leave the dialog laid out for the 0×0 preload: off screen.
 */
export function syncViewport(): void {
  const v = viewport.value;
  if (v.w !== innerWidth || v.h !== innerHeight) viewport.value = { w: innerWidth, h: innerHeight };
}
/** Ticks every 250 ms while something counts (the run clock, a queue, the auto-close). */
export const now = signal(Date.now());

// ---- the dialog's own state -------------------------------------------------------------------------

export type Sheet = 'settings' | 'keys' | 'history';
export const forceImport = signal(false);
export const tab = signal<'photo' | 'text'>('photo');
export const menu = signal(false);
export const sheet = signal<Sheet | null>(null);
export const zoomPop = signal(false);
/** FS2: Instagram's buttons (ghost outlines), on by default (G). */
export const ghost = signal(true);
export const hint = signal(false);
export const toastMsg = signal<{ text: string; small?: string; id: number } | null>(null);
export const preparing = signal<RunMode | null>(null);
/**
 * K11: a run queued until the spacing allows it. RS-5: the export is taken at the press and that exact photo is
 * what starts (with its frozen thumbnail), whatever the stage shows by then.
 */
export interface QueuedRun {
  at: number;
  mode: RunMode;
  photo: RunPhoto | null;
  /** An object URL of the queued export (revoked when the queue goes). */
  thumb: string | null;
}
export const queued = signal<QueuedRun | null>(null);
/** K11: when the queued run starts (epoch ms). */
export const queuedAt = computed<number | null>(() => queued.value?.at ?? null);
/** FS12: the Posted auto-close started at (epoch ms). */
export const autoClose = signal<number | null>(null);
export const seal = signal(false);
/** The copy saved for a run (Downloads/instapost/…). */
export const savedCopy = signal<{ runId: string; file: string; id: number } | null>(null);
/** Two Share-test confirmations: the Advanced row asks once more inline. */
export const shareConfirm = signal(false);
export const resumeOpen = signal(false);
export const dragging = signal(false);

// ---- the run ----------------------------------------------------------------------------------------

export const record = computed<InpageRecord | null>(() => status.value?.record ?? null);
/** The run of this tab that this composer saw start. */
export const ownRun = computed<InpageRecord | null>(() => {
  const r = record.value;
  return r && r.tabId === tabId.value && seen.value.has(r.runId) ? r : null;
});
export const progress = computed(() => (ownRun.value ? runProgress(ownRun.value) : null));
export const running = computed(
  () => status.value?.running === true && ownRun.value !== null && progress.value?.result === null,
);
/** K7: a run in another Instagram tab. */
export const elsewhere = computed<InpageRecord | null>(() => {
  const st = status.value;
  return st?.running && st.record && st.record.tabId !== tabId.value ? st.record : null;
});

export type View = 'import' | 'edit' | 'run' | 'result';
export const view = computed<View>(() => {
  const r = ownRun.value;
  const p = progress.value;
  if (r && p) {
    if (p.result === null && status.value?.running) return 'run';
    if (p.result !== null && !dismissed.value.has(r.runId)) return 'result';
  }
  return image.value && !forceImport.value ? 'edit' : 'import';
});

/** The account instapost posts to (detected, else the one the page shows). */
export const handle = computed<string | null>(
  () => settings.value?.expectedAccount?.handle ?? ownRun.value?.account.detected ?? pageHandle.value ?? null,
);

export const keepCopiesOn = (): boolean => settings.value?.keepCopies === true;

export const paused = computed<number | null>(() => {
  const u = settings.value?.msiteLockedUntil ?? null;
  return u !== null && u > now.value ? u : null;
});

/** FS4's amber note: the text sits under Instagram's top bar or reply bar. */
export const textWarning = computed<string | null>(() => {
  const t = textLayer.value;
  if (!t || t.text.trim() === '' || !fontsReady.value) return null;
  try {
    const l = layoutText(t, measurer);
    const h = l.height * t.xf.scale;
    if (t.xf.cy - h / 2 < 1920 * 0.125) return S.post.underTop;
    if (t.xf.cy + h / 2 > 1920 * 0.89) return S.post.underReply;
  } catch {
    return null;
  }
  return null;
});

// ---- the port ---------------------------------------------------------------------------------------

let port: Browser.runtime.Port | null = null;
let reconnect: ReturnType<typeof setTimeout> | null = null;

export function send(msg: PanelToBackground): void {
  try {
    port?.postMessage(msg);
  } catch {
    port = null;
  }
}

type FromBackground =
  | { v: 1; type: 'run/status'; status: InpageStatus }
  | { v: 1; type: 'run/refused'; why: string; freeAt?: number }
  | { v: 1; type: 'ui/hello'; tabId: number }
  | { v: 1; type: 'ui/mode'; mode: ComposerMode; compact: boolean; closing: boolean }
  | { v: 1; type: 'ui/page'; scheme: Scheme; loggedIn: boolean | null; handle: string | null };

const listeners = {
  opened: [] as (() => void)[],
  result: [] as ((r: InpageRecord) => void)[],
};
export const onOpened = (f: () => void) => listeners.opened.push(f);
export const onResult = (f: (r: InpageRecord) => void) => listeners.result.push(f);

/** Runs whose result was announced (once each). */
const announced = new Set<string>();

function onStatus(st: InpageStatus): void {
  batch(() => {
    const r = st.record;
    if (st.running && r && r.tabId === tabId.value && !seen.value.has(r.runId)) {
      // RL-14: the previous result goes away only now that the new run has started (a refused start leaves it).
      dismissed.value = new Set([...dismissed.value, ...seen.value]);
      seen.value = new Set([...seen.value, r.runId]);
      preparing.value = null;
      dropQueue();
    }
    // RS-3: a run of this tab that a restarted worker could only report afterwards (this composer may be new,
    // and never saw it start): its result shows, so a story that may be live is not posted again blindly.
    if (!st.running && r?.restarted && r.tabId === tabId.value && !seen.value.has(r.runId)) {
      seen.value = new Set([...seen.value, r.runId]);
      preparing.value = null;
    }
    status.value = st;
  });
  const r = ownRun.value;
  if (r && progress.value?.result && !announced.has(r.runId)) {
    announced.add(r.runId);
    // RL-13: the guard knows this result at once (the stored copy follows through storage.onChanged).
    records.value = withRecord(records.value, r);
    for (const f of listeners.result) f(r);
    void refresh();
  }
}

function applyMode(m: { mode: ComposerMode; compact: boolean; closing: boolean }): void {
  syncViewport();
  if (m.mode === 'open' && m.closing) {
    beginClose();
    return;
  }
  compact.value = m.compact;
  if (m.mode === 'open') {
    if (mode.value === 'open' && !closing.value) return;
    batch(() => {
      mode.value = 'open';
      closing.value = false;
      shown.value = false;
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (mode.value === 'open' && !closing.value) shown.value = true;
      }),
    );
    void refresh();
    for (const f of listeners.opened) f();
    return;
  }
  batch(() => {
    mode.value = m.mode;
    shown.value = false;
    closing.value = false;
    menu.value = false;
    sheet.value = null;
    zoomPop.value = false;
    autoClose.value = null;
  });
}

function refusalText(why: string, freeAt?: number): string {
  const r = S.refusal;
  switch (why) {
    case 'RATE_LIMITED':
      return r.RATE_LIMITED(freeAt ? clock(freeAt) : null);
    case 'BUSY':
    case 'PAUSED':
    case 'SHARE_NOT_CONFIRMED':
    case 'NO_TAB':
    case 'NO_PHOTO':
    case 'NOT_LOGGED_IN':
    case 'BRANDED_BROWSER':
      return r[why];
    default:
      return why;
  }
}

export function connect(): void {
  if (reconnect !== null) {
    clearTimeout(reconnect);
    reconnect = null;
  }
  const p = browser.runtime.connect({ name: PANEL_PORT });
  p.onMessage.addListener((raw: unknown) => {
    const m = raw as FromBackground;
    if (m?.v !== 1) return;
    switch (m.type) {
      case 'run/status':
        onStatus(m.status);
        return;
      case 'run/refused':
        preparing.value = null;
        toast(S.refusal.title, refusalText(m.why, m.freeAt));
        void refresh();
        return;
      case 'ui/hello':
        tabId.value = m.tabId;
        return;
      case 'ui/mode':
        applyMode(m);
        return;
      case 'ui/page':
        batch(() => {
          scheme.value = m.scheme;
          loggedIn.value = m.loggedIn;
          pageHandle.value = m.handle;
        });
        return;
    }
  });
  p.onDisconnect.addListener(() => {
    if (port === p) port = null;
    connected.value = false;
    // The service worker restarted (or the extension is reloading): try again.
    reconnect = setTimeout(() => {
      try {
        if (browser.runtime?.id) connect();
      } catch {
        // The extension went away.
      }
    }, 1000);
  });
  port = p;
  connected.value = true;
}

// ---- settings, pace, prefs --------------------------------------------------------------------------

export async function refresh(): Promise<void> {
  try {
    const s = await ls.settings();
    // AM48: the composer speaks the language of Settings → Language (Auto follows the browser), as the editor.
    setLangSetting(s.lang);
    const t = Date.now();
    const [info, decision, testDecision, got, key] = await Promise.all([
      ls.rateInfo(t, s),
      ls.rate(t, s, 'post'),
      ls.rate(t, s, 'test'),
      browser.storage.local.get([UI_PREFS_KEY, RECORDS_KEY]),
      actionShortcut(),
    ]);
    batch(() => {
      settings.value = s;
      rateInfo.value = info;
      postRate.value = decision;
      testRate.value = testDecision;
      prefs.value = toUiPrefs(got[UI_PREFS_KEY]);
      shortcut.value = key;
      setRecords(got[RECORDS_KEY]);
    });
  } catch {
    // Storage is unavailable while the extension reloads.
  }
}

const RECORDS_KEY = 'inpageRecords';

/** The stored records, plus any result this composer saw that the store does not have yet. */
function setRecords(stored: unknown): void {
  const list = Array.isArray(stored) ? (stored as InpageRecord[]) : [];
  const known = new Set(list.map((r) => r.runId));
  const pending = records.value.filter((r) => !known.has(r.runId) && announced.has(r.runId));
  records.value = [...list, ...pending];
}

export function setPrefs(patch: Partial<InpageUiPrefs>): void {
  const next = { ...prefs.value, ...patch };
  prefs.value = next;
  void browser.storage.local.set({ [UI_PREFS_KEY]: next }).catch(() => undefined);
}

export function setPreview(p: PreviewMode): void {
  setPrefs({ preview: p });
  send({ v: 1, type: 'ui/preview', preview: p });
}

let following = false;
/**
 * Follows the stored settings while the composer is loaded (it stays loaded at 0×0 between uses): a change
 * made in the editor tab, in another Instagram tab's composer or by the background (the account, the lock)
 * shows at once, the language included.
 */
export function followSettings(): void {
  if (following) return;
  following = true;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (RECORDS_KEY in changes) setRecords(changes[RECORDS_KEY]?.newValue);
    // The pace too: a run in another tab counts toward it.
    if (
      'settings' in changes ||
      'msiteLock' in changes ||
      'expectedAccount' in changes ||
      'rateLog' in changes ||
      'lastTestOpen' in changes
    )
      void refresh();
  });
}

/** The keys the composer may write in `settings` (the others belong to the background). */
export async function updateSettings(
  patch: Partial<Pick<Settings, 'accountLock' | 'keepCopies' | 'lang'>>,
): Promise<void> {
  if (settings.value) settings.value = { ...settings.value, ...patch };
  if (patch.lang !== undefined) setLangSetting(patch.lang);
  const stored = ((await local.get('settings')) ?? {}) as Partial<Settings>;
  await local.set('settings', { ...stored, ...patch } as Settings);
}

// ---- toasts, clock ----------------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastId = 0;
export function toast(text: string, small?: string): void {
  toastId += 1;
  toastMsg.value = small ? { text, small, id: toastId } : { text, id: toastId };
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMsg.value = null;
  }, 3200);
}

/** Times and dates in the chosen language (copy.ts: `14:05`; `Tue 20 Oct, 14:05` / `martes 20 de octubre a las 14:05`). */
export { clock, dateTime };
export const mmss = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const elapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

let ticker: ReturnType<typeof setInterval> | null = null;
/** Keeps `now` ticking while `want()` holds. */
export function tick(want: boolean): void {
  if (want && ticker === null) {
    now.value = Date.now();
    ticker = setInterval(() => {
      now.value = Date.now();
    }, 250);
  } else if (!want && ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

// ---- open, close, hide (FC4) ------------------------------------------------------------------------

export function beginClose(): void {
  batch(() => {
    closing.value = true;
    shown.value = false;
    menu.value = false;
    zoomPop.value = false;
    autoClose.value = null;
  });
}

/** Close (idle, result) or hide (run): the dialog fades here, the page shrinks the iframe after. */
export function leave(action: UiAction, auto = false): void {
  if (mode.value !== 'open' || closing.value) return;
  beginClose();
  send({ v: 1, type: 'ui/request', action, ...(auto ? { auto: true } : {}) });
}

export function requestOpen(): void {
  send({ v: 1, type: 'ui/request', action: 'open' });
}

// ---- runs -------------------------------------------------------------------------------------------

/** The export as the run's photo (the 1080×1920 PNG Instagram receives, never a stale one). */
async function runPhoto(): Promise<{ photo: RunPhoto; cache: CachedExport } | null> {
  const c = await freshExport();
  if (!c) return null;
  const bytes = new Uint8Array(await c.blob.arrayBuffer());
  return {
    photo: {
      mime: c.blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png',
      b64: bytesToB64(bytes),
      sample: c.sample,
      // RL-13: the duplicate guard tells this story again by these.
      sha256: c.sha256,
      docHash: c.docHash,
    },
    cache: c,
  };
}

/**
 * The photo a run of mode `m` takes: the export of the stage now (none for a check, nor for a test without a
 * photo: the calibration card then). `null` with a toast when a post's export cannot be rendered.
 */
async function photoFor(m: RunMode): Promise<{ photo: RunPhoto | null; cache: CachedExport | null } | null> {
  if (m === 'check' || !image.value) {
    if (m === 'post') {
      toast(S.refusal.title, S.refusal.NO_PHOTO);
      return null;
    }
    return { photo: null, cache: null };
  }
  const got = await runPhoto().catch(() => null);
  if (got === null && m === 'post') {
    toast(S.refusal.title, S.refusal.RENDER);
    return null;
  }
  return { photo: got?.photo ?? null, cache: got?.cache ?? null };
}

/**
 * Starts a run. `photo`: the photo taken earlier (RS-5, a queued run: exactly what the owner pressed Post on),
 * else the stage's export now. The current result stays until the run is seen starting (RL-14).
 */
export async function start(m: RunMode, opts: { confirmShare?: boolean; photo?: RunPhoto | null } = {}): Promise<void> {
  if (preparing.value !== null || running.value) return;
  autoClose.value = null;
  let photo: RunPhoto | null;
  if (opts.photo !== undefined) {
    photo = opts.photo;
  } else {
    preparing.value = m;
    const got = await photoFor(m);
    if (got === null) {
      preparing.value = null;
      return;
    }
    photo = got.photo;
  }
  if (m === 'post' && photo === null) {
    preparing.value = null;
    toast(S.refusal.title, S.refusal.NO_PHOTO);
    return;
  }
  preparing.value = m;
  send({ v: 1, type: 'run/start', mode: m, confirmShare: m === 'shareTest' && opts.confirmShare === true, photo });
  // A refusal clears `preparing`; a start clears it with the first status.
  setTimeout(() => {
    if (preparing.value === m && !running.value) preparing.value = null;
  }, 8000);
}

export function stop(): void {
  send({ v: 1, type: 'run/stop' });
}

// ---- the queue (K11; RS-5) --------------------------------------------------------------------------

/** The queue goes (fired, cancelled, or a run started); its frozen thumbnail is released a moment later. */
function dropQueue(): void {
  const q = queued.value;
  if (!q) return;
  queued.value = null;
  if (q.thumb) {
    const url = q.thumb;
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export function cancelQueue(): void {
  dropQueue();
}

/**
 * K10 / K12 / a paced result button: queues a run of mode `m` for `freeAt` (plus the margin). RS-5: the export
 * is taken now, so the run posts what the owner pressed Post on, even if they paste the next photo meanwhile.
 */
export async function queueRun(m: RunMode, freeAt: number): Promise<boolean> {
  if (preparing.value !== null || running.value || queued.value !== null) return false;
  preparing.value = m;
  const got = await photoFor(m);
  preparing.value = null;
  if (got === null) return false;
  queued.value = {
    at: freeAt + QUEUE_MARGIN_MS,
    mode: m,
    photo: got.photo,
    thumb: got.cache ? URL.createObjectURL(got.cache.blob) : null,
  };
  return true;
}

/** K11: the queue's time came: its run starts with the photo taken at the press. */
export function fireQueue(): void {
  const q = queued.value;
  if (!q || running.value || preparing.value !== null) return;
  dropQueue();
  void start(q.mode, { photo: q.photo });
}

export function dismissResult(): void {
  const r = ownRun.value;
  if (r) dismissed.value = new Set([...dismissed.value, r.runId]);
  seal.value = false;
  autoClose.value = null;
}

/**
 * RL-13: the story on the stage, as its export identifies it (the last render: an edit makes it a new story
 * once it renders, 600 ms later).
 */
export const currentStory = computed<StoryId | null>(() => {
  const c = exportCache.value;
  return image.value && c ? { sha256: c.sha256, docHash: c.docHash } : null;
});

/** K8 / K12: this story's last post within 24 h (Couldn't confirm, or posted), from the stored records. */
export const guard = computed(() => storyStatus(currentStory.value, now.value, records.value));

/**
 * RL-13: It posted · It didn't post on a Couldn't confirm: the mark goes onto the stored record (History and
 * the guard read it), and the result is dismissed.
 */
export function markRun(rec: InpageRecord, mark: OwnerMark): void {
  send({ v: 1, type: 'ui/mark', runId: rec.runId, mark });
  records.value = applyMark(withRecord(records.value, rec), rec.runId, mark, Date.now());
  dismissResult();
  toast(mark === 'posted' ? S.toast.markedPosted : S.toast.markedNotPosted, S.toast.markedNote);
}

/** The export's thumbnail (the exact upload), when rendered. */
export const thumbUrl = computed(() => (image.value ? (exportCache.value?.url ?? null) : null));

// ---- copies, phone, diagnostics ---------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');
function copyName(t: number): string {
  const d = new Date(t);
  return `instapost/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}_story.png`;
}

/** Save copy (FS14, FS11): the export to Downloads/instapost. */
export async function saveCopy(runId: string | null = null, quiet = false): Promise<void> {
  try {
    const c = await freshExport();
    if (!c) return;
    const file = copyName(Date.now());
    const id = await browser.downloads.download({
      url: c.url,
      filename: file,
      conflictAction: 'uniquify',
      saveAs: false,
    });
    if (runId) savedCopy.value = { runId, file, id };
    if (!quiet) toast(S.toast.saved, file.replace('instapost/', ''));
  } catch {
    if (!quiet) toast(S.toast.savedFailed);
  }
}

export function showCopy(): void {
  const s = savedCopy.value;
  if (s) void browser.downloads.show(s.id);
}

/** Send to phone… (§9): the system share sheet with the export. */
export async function sendToPhone(): Promise<void> {
  try {
    const c = await freshExport();
    if (!c) return;
    const file = new File([c.blob], 'instapost-story.png', { type: c.blob.type || 'image/png' });
    if (!navigator.canShare?.({ files: [file] })) throw new Error('share unavailable');
    await navigator.share({ files: [file] });
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') return;
    toast(S.toast.phoneFailed, S.toast.phoneFailedNote);
  }
}

export async function copyDiagnostics(): Promise<void> {
  try {
    const got = await browser.storage.local.get('inpageRecords');
    const list = Array.isArray(got.inpageRecords) ? got.inpageRecords : [];
    await navigator.clipboard.writeText(JSON.stringify(list, null, 2));
    toast(S.toast.diagnostics, S.toast.diagnosticsNote);
  } catch {
    toast(S.toast.savedFailed);
  }
}

export async function copyRecord(r: InpageRecord): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(r, null, 2));
    toast(S.toast.copied, S.toast.diagnosticsNote);
  } catch {
    // Clipboard refused (no activation).
  }
}

export function viewStory(): void {
  const h = handle.value;
  if (h) send({ v: 1, type: 'ui/view-story', handle: h });
}
