/**
 * The autopilot's steps in Instagram's page (ux.md §10, IA3): + → Story (arming the story input), the
 * insert into the armed input, the compose watch, and Share. Every tap goes through tap.ts; everything
 * else is a DOM read, the File assignment (inject.ts) and waiting.
 *
 * Why the insert needs no file chooser: Instagram's Story item runs startStoryCreationSession (its portrait
 * check and a uuid session id) and then the story input's click(). Without user activation in the page
 * Chrome refuses the chooser (a console warning only); the capture listener sees that click, so the session
 * is armed, and after a human dwell the agent sets the file on that input: Instagram's own onChange reads
 * it, processes the image and navigates to /create/story/, as for a picked file.
 */

import {
  type ComposeFact,
  type EntryFact,
  type InsertFailure,
  type MenuFingerprint,
  SHARE_ACTIVATION_WAIT_MS,
  type ShareRefusal,
} from '../core/handoff/state.ts';
import { acceptSetEquals, STORY_ACCEPT } from '../core/ig-contract/contract.ts';
import { isGetFileReply } from '../shared/protocol.ts';
import { fileFromPayload, setInputFile } from './inject.ts';
import {
  composerState,
  dialogsNow,
  type EntryParts,
  findEntry,
  glyphHash,
  newDialogs,
  pressables,
} from './locators.ts';
import type { AgentWindow } from './probes.ts';
import {
  activationActive,
  observeClick,
  pageVisible,
  type SeenClick,
  type ShareToken,
  type TapBudget,
  type TapRefusal,
  tap,
} from './tap.ts';

/** ux.md §10 budgets, agent side. */
export const DRIVE_MS = {
  /** A page hidden before a tap must become visible within this (the background raises the window once). */
  visible: 10_000,
  /** The owner's own activation must lapse within this (R22). */
  activation: 6000,
  /** The + menu dialog must appear within this (one re-tap of + if it did not). */
  menu: 6000,
  /** The story input must receive Story's click within this (armed). */
  armed: 3000,
  /** The agent's own jitter between + and the Story item. */
  jitter: [400, 900] as const,
  poll: 100,
} as const;

export interface DriveDeps {
  win: AgentWindow;
  budget: TapBudget;
  /** performance.now() */
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  /** Test seam: shrinks every wait (0 < scale ≤ 1). */
  scale?: number;
}

const ms = (d: DriveDeps, n: number): number => Math.max(0, Math.round(n * (d.scale ?? 1)));

/** Polls `test` every DRIVE_MS.poll until it holds (true) or `limit` ms pass (false). */
export async function waitFor(d: DriveDeps, test: () => boolean, limit: number): Promise<boolean> {
  const end = d.now() + ms(d, limit);
  for (;;) {
    if (test()) return true;
    if (d.now() >= end) return false;
    await d.sleep(Math.min(DRIVE_MS.poll, Math.max(1, end - d.now())));
  }
}

async function waitValue<T>(d: DriveDeps, get: () => T | null, limit: number): Promise<T | null> {
  let found: T | null = null;
  await waitFor(
    d,
    () => {
      found = get();
      return found !== null;
    },
    limit,
  );
  return found;
}

/** The first of two click observations that saw a click, or null when both ran out. */
function firstClick(a: Promise<SeenClick | null>, b: Promise<SeenClick | null>): Promise<'a' | 'b' | null> {
  return new Promise((resolve) => {
    let left = 2;
    const done = (which: 'a' | 'b') => (c: SeenClick | null) => {
      if (c) resolve(which);
      else if (--left === 0) resolve(null);
    };
    a.then(done('a'), () => done('a')(null));
    b.then(done('b'), () => done('b')(null));
  });
}

type EntryOut = Omit<EntryFact, 'kind'>;

function refusalResult(why: TapRefusal): EntryFact['result'] {
  if (why === 'activation') return 'ACTIVATION_ACTIVE';
  if (why === 'page-hidden') return 'HIDDEN';
  return 'REFUSED';
}

/** Taps + until a new menu dialog shows (one re-tap if none did), or reuses one still open. */
async function openMenu(
  d: DriveDeps,
  parts: EntryParts,
  open: Element | null,
): Promise<{ dialog: Element } | { result: EntryFact['result'] }> {
  if (open?.isConnected) return { dialog: open };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await waitFor(d, () => !activationActive(d.win), DRIVE_MS.activation)))
      return { result: 'ACTIVATION_ACTIVE' };
    const before = dialogsNow(d.win);
    const t = tap('plus', parts.plus, { win: d.win, container: parts.box, budget: d.budget });
    if (!t.ok) return { result: refusalResult(t.why) };
    const dialog = await waitValue(d, () => newDialogs(d.win, before).at(-1) ?? null, DRIVE_MS.menu);
    if (dialog) return { dialog };
  }
  return { result: 'MENU_MISSING' };
}

/**
 * + → Story (ux.md §10 `armStory`). The Story item is chosen by the stored fingerprint (index and glyph)
 * when it matches, else by trial: a wrong item only clicks the post input (no chooser without activation,
 * a post session in Instagram's state only), then the other item. At most one wrong item per post; never an
 * unknown third item (`MENU_DRIFT`).
 */
export async function openEntry(d: DriveDeps, fp: MenuFingerprint | null): Promise<EntryOut> {
  const out: EntryOut = {
    result: 'armed',
    fpUsed: false,
    storyIndex: null,
    glyph: null,
    menuCount: null,
    trials: 0,
    plusTaps: d.budget.plus,
    armedMs: null,
  };
  const end = (result: EntryFact['result']): EntryOut => ({ ...out, result, plusTaps: d.budget.plus });
  if (!(await waitFor(d, () => pageVisible(d.win), DRIVE_MS.visible))) return end('HIDDEN');
  if (!(await waitFor(d, () => !activationActive(d.win), DRIVE_MS.activation))) return end('ACTIVATION_ACTIVE');
  const lookup = findEntry(d.win);
  if (!lookup.ok) return end('ENTRY_MISSING');
  const parts = lookup.parts;

  let dialog: Element | null = null;
  let tried: number | null = null;
  for (let round = 0; round < 2; round++) {
    const menu = await openMenu(d, parts, dialog);
    if ('result' in menu) return end(menu.result);
    dialog = menu.dialog;
    const items = pressables(dialog);
    out.menuCount = items.length;
    if (items.length !== 2) return end('MENU_DRIFT');
    let index: number;
    if (tried !== null) index = 1 - tried;
    else if (
      fp &&
      fp.count === items.length &&
      items[fp.storyIndex] &&
      glyphHash(items[fp.storyIndex] as Element) === fp.glyph
    ) {
      index = fp.storyIndex;
      out.fpUsed = true;
    } else index = 0;
    const item = items[index] as Element;
    const [lo, hi] = DRIVE_MS.jitter;
    await d.sleep(ms(d, lo + (hi - lo) * Math.min(1, Math.max(0, d.random()))));
    if (!(await waitFor(d, () => !activationActive(d.win), DRIVE_MS.activation))) return end('ACTIVATION_ACTIVE');
    const armedSeen = observeClick(d.win, parts.storyInput, ms(d, DRIVE_MS.armed));
    const wrongSeen = parts.postInput
      ? observeClick(d.win, parts.postInput, ms(d, DRIVE_MS.armed))
      : Promise.resolve<SeenClick | null>(null);
    const at = d.now();
    const t = tap('storyItem', item, { win: d.win, container: dialog, budget: d.budget });
    if (!t.ok) return end(refusalResult(t.why));
    const which = await firstClick(armedSeen, wrongSeen);
    if (which === 'a') {
      return {
        ...out,
        result: 'armed',
        storyIndex: index,
        glyph: glyphHash(item),
        armedMs: Math.max(0, Math.round(d.now() - at)),
        plusTaps: d.budget.plus,
      };
    }
    if (which === null) {
      // Instagram refuses to start a story in a landscape viewport (C3a): a toast, no input click.
      return end(d.win.innerHeight < d.win.innerWidth ? 'SESSION_NOT_STARTED' : 'NOT_ARMED');
    }
    // The wrong item: the post input received the click. Try the other one, once.
    if (tried !== null) return end('WRONG_ITEM');
    out.trials += 1;
    tried = index;
    if (!dialog.isConnected) dialog = null;
  }
  return end('WRONG_ITEM');
}

/** The insert into the story input that Story armed in this document (ux.md §10, AM3's DataTransfer insert). */
export async function insert(
  d: DriveDeps,
  armed: HTMLInputElement | null,
  getFile: () => Promise<unknown>,
): Promise<{ ok: true } | { ok: false; why: InsertFailure }> {
  if (!armed?.isConnected) return { ok: false, why: 'not-armed' };
  if (!acceptSetEquals(armed.accept, STORY_ACCEPT)) return { ok: false, why: 'accept-drift' };
  let reply: unknown;
  try {
    reply = await getFile();
  } catch {
    return { ok: false, why: 'no-file' };
  }
  if (!isGetFileReply(reply) || !reply.ok || !reply.mime.startsWith('image/')) return { ok: false, why: 'no-file' };
  try {
    setInputFile(d.win, armed, fileFromPayload(d.win, reply));
  } catch {
    return { ok: false, why: 'threw' };
  }
  return { ok: true };
}

/** ux.md §10 compose watch budgets. */
export const COMPOSE_MS = { quiet: 1500, cap: 8000, deadline: 20_000, tick: 250 } as const;

function composeFact(d: DriveDeps, settled: boolean, settleMs: number, imageScore: number | null): ComposeFact {
  const st = composerState(d.win);
  return {
    kind: 'compose',
    onComposer: st.onComposer,
    drawn: st.drawn,
    landscape: st.landscape,
    controls: st.controls.length,
    variant: st.variant,
    fbAuto: st.fbAuto,
    settled,
    settleMs: Math.round(settleMs),
    canvas: st.canvas && st.drawn ? { w: st.canvas.width, h: st.canvas.height } : null,
    imageScore,
  };
}

/** A signature of the Share footer, to tell when it stopped changing (v1 can switch to v2 after a GraphQL answer). */
function footerSignature(d: DriveDeps): string {
  const st = composerState(d.win);
  return `${st.footers}:${st.controls.length}:${st.variant ?? '-'}:${st.fbAuto ? 1 : 0}`;
}

/**
 * C12: waits for the composer to draw the photo and for its Share footer to be quiet for 1.5 s (cap 8 s
 * from the first footer), then reports once. The landscape snackbar is reported at once. Without a drawn
 * composer within COMPOSE_MS.deadline it reports what it has (the background decides).
 */
export async function watchCompose(
  d: DriveDeps,
  score: ((canvas: HTMLCanvasElement) => Promise<number | null>) | null,
): Promise<ComposeFact> {
  const start = d.now();
  let firstFooter: number | null = null;
  let lastChange = start;
  let sig = '';
  for (;;) {
    const now = d.now();
    const st = composerState(d.win);
    if (st.onComposer && st.landscape) return composeFact(d, true, now - start, null);
    if (st.onComposer && st.drawn && st.footers > 0) {
      const next = footerSignature(d);
      if (firstFooter === null) firstFooter = now;
      if (next !== sig) {
        sig = next;
        lastChange = now;
      }
      if (now - lastChange >= ms(d, COMPOSE_MS.quiet) || now - firstFooter >= ms(d, COMPOSE_MS.cap)) {
        const canvas = composerState(d.win).canvas;
        let imageScore: number | null = null;
        if (score && canvas) imageScore = await score(canvas).catch(() => null);
        return composeFact(d, true, d.now() - start, imageScore);
      }
    }
    if (now - start >= ms(d, COMPOSE_MS.deadline)) return composeFact(d, false, now - start, null);
    await d.sleep(ms(d, COMPOSE_MS.tick) || 1);
  }
}

/**
 * Share, once (IR11): re-checks the composer and the page, then taps. `onClick(t0)` runs right before the
 * tap so the request observer starts at the click. Returns share-refused (nothing was clicked) or done.
 */
export async function share(
  d: DriveDeps,
  token: ShareToken,
  onClick: (t0: number) => void,
): Promise<{ ok: true; t0Wall: number } | { ok: false; why: ShareRefusal }> {
  if (!(await waitFor(d, () => pageVisible(d.win), SHARE_ACTIVATION_WAIT_MS))) return { ok: false, why: 'hidden' };
  if (!(await waitFor(d, () => !activationActive(d.win), SHARE_ACTIVATION_WAIT_MS))) {
    return { ok: false, why: 'activation' };
  }
  const st = composerState(d.win);
  if (!st.onComposer) return { ok: false, why: 'not-composer' };
  if (st.landscape) return { ok: false, why: 'landscape' };
  if (!st.drawn) return { ok: false, why: 'not-drawn' };
  const control = st.controls.length === 1 ? st.controls[0] : undefined;
  const footer = st.footer;
  if (!control || !footer) return { ok: false, why: 'controls' };
  const t0 = d.now();
  const t0Wall = Date.now();
  onClick(t0);
  const t = tap('share', control, { win: d.win, container: footer, budget: d.budget, token });
  if (!t.ok) {
    if (t.why === 'activation') return { ok: false, why: 'activation' };
    if (t.why === 'page-hidden') return { ok: false, why: 'hidden' };
    return { ok: false, why: 'refused' };
  }
  return { ok: true, t0Wall };
}

/** IA7 (diagnostic): a 16×16 RGBA sample of an image source, as numbers 0..255. */
export async function sampleOf(win: AgentWindow, source: CanvasImageSource): Promise<Uint8ClampedArray | null> {
  const Offscreen = (win as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;
  if (typeof Offscreen !== 'function' || typeof win.createImageBitmap !== 'function') return null;
  const bitmap = await win.createImageBitmap(source as ImageBitmapSource);
  try {
    const c = new Offscreen(16, 16);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, 16, 16);
    return ctx.getImageData(0, 0, 16, 16).data;
  } finally {
    bitmap.close();
  }
}

/** IA7: similarity of two 16×16 RGBA samples, 1 − mean absolute difference (0..1). */
export function sampleScore(a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array): number | null {
  if (a.length !== b.length || a.length === 0) return null;
  let diff = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue;
    diff += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    n++;
  }
  return n === 0 ? null : 1 - diff / (n * 255);
}
