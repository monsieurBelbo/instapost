/**
 * The one audited synthetic-action helper (ux.md P2, §10, IA2; strategy §11 AM39).
 *
 * instapost taps Instagram's own controls and nothing else: + (Create), the Story menu item and Share, in
 * the composer tab only, from the isolated agent only. Instagram's own client builds and sends every
 * request. `tap()` holds the only `.click()` in the agent bundle, and `observeClick()` the only `click`
 * listener (capture phase, once); check-bundle T3 fails the build on a second click site, a click outside
 * this helper, a listener without capture, a string-keyed click or any constructed mouse, pointer,
 * keyboard, touch or drag event.
 *
 * Before every tap, in this order: the kind's budget (+ at most 3 per document, Story at most 2 per
 * hand-off, Share once per hand-off and only with the Share command's token); the element is connected,
 * visible and inside the viewport; it is inside the expected container (the entry box, the new menu
 * dialog, the composer's Share footer); the page is where that control lives (`/` for + and Story,
 * /create/story for Share); the page has no user activation (R22: within about 5 s of a real click in that
 * window, the Story item's input.click() would open the OS file chooser); the page is visible (Instagram
 * throttles hidden pages). Every handler on the path is a React onClick, and no module in the saved bundles
 * reads `isTrusted` or `userActivation` (the autopilot spike, 2026-10-13).
 */
import { type AgentWindow, isComposerPath, isShown } from './probes.ts';

export type TapKind = 'plus' | 'storyItem' | 'share';

/** + per document; Story and Share per hand-off (the agent is one per document, the background sends one Share). */
export const TAP_LIMITS: Readonly<Record<TapKind, number>> = { plus: 3, storyItem: 2, share: 1 };

export type TapRefusal =
  | 'budget'
  | 'token'
  | 'detached'
  | 'not-visible'
  | 'outside-viewport'
  | 'container'
  | 'path'
  | 'activation'
  | 'page-hidden';

export interface TapBudget {
  plus: number;
  storyItem: number;
  share: number;
}

export const newBudget = (): TapBudget => ({ plus: 0, storyItem: 0, share: 0 });

/** The Share command's token: share() alone holds one, made when the background's command arrives. */
export interface ShareToken {
  readonly share: true;
  readonly handoffId: string;
}

export interface TapGuard {
  win: AgentWindow;
  /** The element must be inside this (the entry box, the menu dialog, the Share footer). */
  container: Element;
  budget: TapBudget;
  token?: ShareToken | null;
}

export type TapResult = { ok: true; kind: TapKind; via: string } | { ok: false; kind: TapKind; why: TapRefusal };

/** navigator.userActivation.isActive as the page has it (the owner clicked or typed in the window just now). */
export function activationActive(win: AgentWindow): boolean {
  const ua = (win.navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua?.isActive === true;
}

export function pageVisible(win: AgentWindow): boolean {
  return win.document.visibilityState === 'visible';
}

function inViewport(win: AgentWindow, el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  return r.right > 0 && r.bottom > 0 && r.left < win.innerWidth && r.top < win.innerHeight;
}

/** The only synthetic action instapost takes in Instagram's page. */
export function tap(kind: TapKind, el: Element, g: TapGuard): TapResult {
  const no = (why: TapRefusal): TapResult => ({ ok: false, kind, why });
  if (g.budget[kind] >= TAP_LIMITS[kind]) return no('budget');
  if (kind === 'share' && g.token?.share !== true) return no('token');
  if (!el.isConnected) return no('detached');
  if (!isShown(g.win, el)) return no('not-visible');
  if (!inViewport(g.win, el)) return no('outside-viewport');
  if (!g.container.contains(el)) return no('container');
  const path = g.win.location.pathname;
  if (kind === 'share' ? !isComposerPath(path) : path !== '/') return no('path');
  if (activationActive(g.win)) return no('activation');
  if (!pageVisible(g.win)) return no('page-hidden');
  g.budget[kind] += 1;
  (el as HTMLElement).click();
  return { ok: true, kind, via: 'instapost:tap' };
}

export interface SeenClick {
  target: EventTarget | null;
  trusted: boolean;
  /** performance.now() of the click. */
  at: number;
}

/**
 * The only click listener: capture phase, once, removed after `ms` (an AbortSignal, so the event type is
 * named once). It serves the arming check (the story input receives Story's click) and Finish by hand (the
 * owner's own Share click). Observation only: it never prevents or changes anything.
 */
export function observeClick(win: AgentWindow, target: EventTarget, ms: number): Promise<SeenClick | null> {
  return new Promise((resolve) => {
    const ac = new win.AbortController();
    const timer = win.setTimeout(() => {
      ac.abort();
      resolve(null);
    }, ms);
    target.addEventListener(
      'click',
      (e: Event) => {
        win.clearTimeout(timer);
        ac.abort();
        resolve({ target: e.target, trusted: e.isTrusted, at: win.performance.now() });
      },
      { capture: true, once: true, signal: ac.signal },
    );
  });
}
