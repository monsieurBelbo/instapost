/**
 * Fake Instagram knobs (strategy §6.1, ux.md IF1–IF10): every unverified Instagram behaviour is switchable.
 *
 * DEFAULT_KNOBS is what the fake starts and resets with. It must equal deriveKnobs(baseline.json)
 * (U16), so updating the baseline after L4/L5 (and L18–L20 for the autopilot) forces an update of the
 * fake. deriveKnobs() throws for baseline facts the fake cannot model yet: extend the fake, then the
 * mapping.
 *
 * Pure module (no Node APIs): imported by core.ts and bundled into the client.
 */

import { isValidHandle } from '../../src/core/ig-contract/account.ts';
import baselineJson from '../../src/core/ig-contract/baseline.json' with { type: 'json' };
import { acceptSetEquals, type Baseline, MSITE_MAX_CSS_WIDTH } from '../../src/core/ig-contract/contract.ts';

export type GeometryModel = Baseline['geometry']['model'];

/** How i.instagram.com answers the photo upload (`slow:<ms>` answers ok after that delay). */
export type RuploadKnob = 'ok' | '500' | 'cors' | 'reset' | 'hang' | `slow:${number}`;
/** How www answers the publish request (`slow:<ms>` answers ok after that delay). */
export type ConfigureKnob =
  | 'ok'
  | '400'
  | 'feedback'
  | 'login401'
  | 'checkpoint'
  | '500'
  | 'reset'
  | 'redirectLogin'
  | 'html200'
  | 'hang'
  | `slow:${number}`;

export interface Knobs {
  /** How `is_mobile` is decided: the User-Agent header (real Instagram, §5.1) or `sec-ch-ua-mobile`. */
  classifier: 'ua' | 'client-hints';
  /**
   * `homeOnly` (production, F3 and the live runs): /create/story/ without media 302s to `/`, where the
   * story starts from the header's + → Story; `direct`: /create/story/ renders the composer route itself
   * (no media: the header with + and the story input stays, and the autopilot's + tap is refused there,
   * because instapost taps + and Story on home only); `elsewhere`: it 302s to an interstitial www page
   * that is neither home nor a security flow (`/consent/`, AM17).
   */
  route: 'homeOnly' | 'direct' | 'elsewhere';
  /**
   * Where msite's hidden story input (`PolarisStoryCreationFileForm`, C10) is. `present` (production):
   * beside the header's + entry, in the DOM whenever that entry is rendered (viewport at most
   * MSITE_MAX_CSS_WIDTH CSS px wide, after `hydrateMs`); `afterTap`: only once + → Story was tapped.
   */
  input: 'present' | 'afterTap';
  /** The story input's accept list: STORY_ACCEPT_LISTS[accept]. */
  accept: 'default' | 'changed';
  /** Which event the story input reads files from. `drop`: a `change` (the autopilot's insert) is ignored. */
  listen: 'change' | 'drop';
  /**
   * AM37: what the composer page's landscape gate reads (PolarisStoryCreationPage `isLandscape`, at
   * mount and on every resize; landscape: the rotate snackbar `._aa3b`, no header and no Share footer).
   * `screen` (production): `screen.orientation.type` (else `window.orientation`, else the viewport);
   * `viewport`: `innerWidth > innerHeight` only. The + → Story session start checks the viewport either way.
   */
  landscapeCheck: 'screen' | 'viewport';
  /**
   * `require`: clicks and file events with isTrusted=false are ignored: the + (no menu), the menu items
   * (nothing happens), the story input's file events. React itself never filters (S7); this models an
   * Instagram that started to. `ignore` (default): Instagram's handlers never read isTrusted (spike).
   */
  trusted: 'ignore' | 'require';
  geometry: GeometryModel;
  /** CSS px reserved at the top and bottom of the viewport before fitting the canvas. */
  insets: [number, number];
  /** Shows the composer header's Save button (`._aa3g`). */
  save: 'on' | 'off';
  /**
   * `claimOnRegister` (production, F2): every load registers
   * `/fake-sw/claim-on-register.js?enableAddToHomeScreen=<is_mobile>&zenon_device_id=<per-load id>`;
   * the new worker has no fetch handler, calls skipWaiting() and clients.claim(), so the page is
   * controlled within about a second but its requests stay tab-attributed (workerStart 0).
   * `desktopShell` (hypothetical, drives SW_INTERCEPTS): a worker WITH a fetch handler, at a stable
   * URL, that answers navigations with its own desktop-UA fetch (tabId -1) and passes every other
   * request through itself, and claims every page that registers it. `claimLate`: a worker without a
   * fetch handler that claims the composer 2 s after it is ready (counted, P2). `none`: no worker.
   */
  sw: 'claimOnRegister' | 'none' | 'desktopShell' | 'claimLate';
  /** `codeentry`: 302 to /auth_platform/codeentry/ (AM17), another security flow. */
  auth: 'in' | 'out' | 'challenge' | 'codeentry';
  /** `firstLoad` (AM20): /create/story/ itself 302s off-host, before the kill switch is armed. */
  offhost: 'none' | 'afterReady' | 'firstLoad';
  /**
   * A security challenge in the middle of a session (FID-6): once the composer drew the photo
   * (`afterReady…`), or once the Share flow settled (`afterShare…`: after Instagram went home, or after
   * its "Upload failed." toast), by a full navigation to /challenge/ or (`…Spa`) an in-page pushState.
   * `afterReadyTop` (F8, docs/inpage.md): 0.8 s after the photo was drawn, a background POST of the page
   * answers with a `checkpoint_url` and msite's instajax error path sets `window.top.location.href` to it, so
   * in a frame the challenge takes over the top-level (desktop) page, as Instagram's would.
   */
  challenge: 'none' | 'afterReady' | 'afterReadySpa' | 'afterReadyTop' | 'afterShare' | 'afterShareSpa';
  /**
   * What a desktop UA gets for /create/story/ (unverified, L4): a 302 to `/` (desktop has no story
   * entry), or the desktop shell rendered at that URL.
   */
  desktopComposer: '302' | 'desktopShell';
  /** `afterReady`: the composer document reloads itself once it drew the photo (a later full-document load, AM2). */
  reload: 'none' | 'afterReady';
  locale: 'en' | 'es';
  /**
   * `renamed`: randomised class names and ids, Instagram's own composer classes (`_aa3c`, `_aa3d`, `_aa3b`,
   * `_a6hd`, `_aswp`) included, so only the agent's structural fallbacks are left.
   */
  drift: 'none' | 'renamed';
  /** `<meta name="instapost-fake-instagram">` (SG4). */
  marker: 'on' | 'off';
  /** Composer readiness delay after a file is accepted. */
  slowMs: number;
  /**
   * P5: msite's header (+ entry, story input) and its navigation (the account link) mount this long
   * after the shell renders, as after hydration. 0: at once.
   */
  hydrateMs: number;
  /**
   * C14 (IF10): the account the page is logged in as, named by the one profile link in its navigation:
   * a handle; `none` (no profile link: unreadable); `ambiguous` (two profile links with different
   * handles). `other:<h>` is accepted as an alias of `<h>` (a different account than expected).
   */
  account: string;
  /** C10 (IF2): the + menu's items in order (Instagram's is unknown logged out, L18). */
  menuOrder: 'postStory' | 'storyPost';
  /** C10: `3` adds a third item the autopilot must never tap (MENU_DRIFT). */
  menuItems: '2' | '3';
  /** The lazy menu (a popover loaded on demand) appears this long after the + tap. */
  menuDelayMs: number;
  /**
   * C12 (IF4): Instagram's Facebook crossposting for this account. `none`: the ShareFooter (a button)
   * stays; `linked`: after `fbDelayMs` (its GraphQL answer) the footer becomes ShareFooterV2 (a
   * role=button with the avatar); `auto`: the same with the "Auto crosspost to Facebook" badge, and
   * publishing sends `share_to_facebook=true`.
   */
  fb: 'none' | 'linked' | 'auto';
  fbDelayMs: number;
  /**
   * C12: the Share control. `v1` (default): ShareFooter, then as `fb` says; `v2`: ShareFooterV2 from the
   * start; `missing`: no Share footer; `two`: two Share footers (ambiguous, SHARE_MISSING).
   */
  shareControl: 'v1' | 'v2' | 'missing' | 'two';
  /** C13 (IF5): the photo upload's answer: ok, 500, no CORS headers, a reset socket, no answer, or late. */
  rupload: RuploadKnob;
  /** C13 (IF5): the publish request's answer (see ConfigureKnob; the README lists what each does). */
  configure: ConfigureKnob;
  /**
   * IF6: Instagram's tray refresh after a published story (POST /graphql/query, then home). `fail`: it
   * answers 500 and the page still goes home; `throw`: the page's refresh throws: the success toast,
   * no navigation, the progress modal stays.
   */
  tray: 'ok' | 'fail' | 'throw';
  /** IF7: `on` (default): the page calls performance.clearResourceTimings() every 2 s and on image loads. */
  rtClear: 'on' | 'off';
  /**
   * docs/inpage.md F4, §9.1: the `X-Frame-Options` header on every www and i HTML document. `deny`
   * (Instagram's, logged-out header check 2026-10-14): Chromium refuses to render the page in any frame;
   * `sameorigin`: only www frames of www pages; `none`: no header.
   */
  xfo: 'deny' | 'sameorigin' | 'none';
  /**
   * F5: the HTML documents' CSP (`frame-src` and `child-src https://*.instagram.com`) has no
   * `frame-ancestors` (`absent`, Instagram's). `none` / `self` add `frame-ancestors 'none'` / `'self'`
   * (R27: a day Instagram adds one; dNR's XFO removal does not touch CSP).
   */
  frameAncestors: 'absent' | 'none' | 'self';
  /**
   * How a document request the server sees as framed (`sec-fetch-dest: iframe`, the browser's own value for
   * the in-page engine frame, §3.7) is answered. `unavailable` (production; live, Arc, 2026-10-14, C15): the
   * shell with Instagram's "Sorry, this page isn't available" and nothing else (no header, no +, no story
   * input, no navigation, so no account link), HTTP 200 (the live status is unverified); `serve` (as any other
   * document); `refuse` (a 403 page); `desktop` (the desktop shell whatever the UA); `login` (a 302 to
   * /accounts/login/); `offhost` (a 302 off Instagram). With rule 1021 the engine frame's request says
   * `sec-fetch-dest: document` and gets the normal shell, as on Instagram (live 2026-10-14/15), so these apply
   * in-page only when a test leaves 1021 out (the guarded `fetchDest: iframe` toggle).
   */
  framed: 'unavailable' | 'serve' | 'refuse' | 'desktop' | 'login' | 'offhost';
  /**
   * The desktop shell's navigation (docs/inpage.md §3.2, §9.1; contract.md "Desktop Instagram's page").
   * `auto` (production): Instagram's responsive left navigation, wide with labels (244 px) from 1264 CSS px,
   * collapsed to icons (72 px) from 768 px, a bottom bar below; the collapsed one **widens to 244 px while
   * hovered**, over the page, and collapses when the pointer leaves it (live, Arc, 2026-10-14/15; the
   * breakpoints are approximate). `hover`: that collapsed, hover-expanding navigation at any width. `wide`
   * (labels), `collapsed` (icons only, never expands), `bottomBar` (a bar along the bottom), `absent` (no
   * navigation) or `renamed` (the wide navigation with randomised classes): fixed shapes for the entry's
   * placement cases.
   */
  desktopNav: 'auto' | 'wide' | 'collapsed' | 'hover' | 'bottomBar' | 'absent' | 'renamed';
  /**
   * The desktop shell's appearance (inpage-ui-spec.md FT1, FX13), as Instagram signals it: `__fb-light-mode` /
   * `__fb-dark-mode` on `<html>`, its `--ig-*` colour variables (bare `r, g, b` triplets) and the page's
   * background. `auto` (production, Instagram's "Automatic" appearance; unverified): follows
   * `prefers-color-scheme` and switches live when it changes; `light`; `dark`.
   */
  theme: 'auto' | 'light' | 'dark';
}

export type KnobName = keyof Knobs;
/** Knobs that take a whole number of milliseconds (0..60000). */
export const MS_KNOBS = ['slowMs', 'hydrateMs', 'menuDelayMs', 'fbDelayMs'] as const;
/** Knobs with a validated free-form string value. */
export const STRING_KNOBS = ['account', 'rupload', 'configure'] as const;
type EnumKnob = Exclude<KnobName, 'geometry' | 'insets' | (typeof MS_KNOBS)[number] | (typeof STRING_KNOBS)[number]>;

/** Allowed values of every enum knob, in display order (first = the usual default). */
export const KNOB_CHOICES: { readonly [K in EnumKnob]: readonly Knobs[K][] } = {
  classifier: ['ua', 'client-hints'],
  route: ['homeOnly', 'direct', 'elsewhere'],
  input: ['present', 'afterTap'],
  accept: ['default', 'changed'],
  listen: ['change', 'drop'],
  landscapeCheck: ['screen', 'viewport'],
  trusted: ['ignore', 'require'],
  save: ['on', 'off'],
  sw: ['claimOnRegister', 'none', 'desktopShell', 'claimLate'],
  auth: ['in', 'out', 'challenge', 'codeentry'],
  offhost: ['none', 'afterReady', 'firstLoad'],
  challenge: ['none', 'afterReady', 'afterReadySpa', 'afterReadyTop', 'afterShare', 'afterShareSpa'],
  desktopComposer: ['302', 'desktopShell'],
  reload: ['none', 'afterReady'],
  locale: ['en', 'es'],
  drift: ['none', 'renamed'],
  marker: ['on', 'off'],
  menuOrder: ['postStory', 'storyPost'],
  menuItems: ['2', '3'],
  fb: ['none', 'linked', 'auto'],
  shareControl: ['v1', 'v2', 'missing', 'two'],
  tray: ['ok', 'fail', 'throw'],
  rtClear: ['on', 'off'],
  xfo: ['deny', 'sameorigin', 'none'],
  frameAncestors: ['absent', 'none', 'self'],
  framed: ['unavailable', 'serve', 'refuse', 'desktop', 'login', 'offhost'],
  desktopNav: ['auto', 'wide', 'collapsed', 'hover', 'bottomBar', 'absent', 'renamed'],
  theme: ['auto', 'light', 'dark'],
};

/** The fixed answers of `rupload` and `configure` (besides `slow:<ms>`), for validation and the dashboard. */
export const RUPLOAD_CHOICES = ['ok', '500', 'cors', 'reset', 'hang'] as const;
export const CONFIGURE_CHOICES = [
  'ok',
  '400',
  'feedback',
  'login401',
  'checkpoint',
  '500',
  'reset',
  'redirectLogin',
  'html200',
  'hang',
] as const;

/** Every knob, in the order the dashboard shows them. */
export const KNOB_NAMES: readonly KnobName[] = [
  'classifier',
  'route',
  'input',
  'accept',
  'listen',
  'landscapeCheck',
  'trusted',
  'account',
  'menuOrder',
  'menuItems',
  'menuDelayMs',
  'fb',
  'fbDelayMs',
  'shareControl',
  'rupload',
  'configure',
  'tray',
  'rtClear',
  'geometry',
  'insets',
  'save',
  'sw',
  'auth',
  'offhost',
  'challenge',
  'desktopComposer',
  'reload',
  'locale',
  'drift',
  'marker',
  'slowMs',
  'hydrateMs',
  'xfo',
  'frameAncestors',
  'framed',
  'desktopNav',
  'theme',
];

/** Story input accept lists. `changed` adds HEIC (still images only), so C4 reports ACCEPT_DRIFT. */
export const STORY_ACCEPT_LISTS: { readonly [K in Knobs['accept']]: string } = {
  default: 'image/avif,image/jpeg,image/png',
  changed: 'image/avif,image/heic,image/jpeg,image/png',
};

/**
 * The post input's accept list: `["image/jpeg"]` in PolarisMobileCreationNavItem (logged-out reading,
 * 2026-10-13). It names an image type only, so the agent's C4 rule must tell it from the story input by
 * the whole set (src/core/ig-contract/contract.ts POST_ACCEPT).
 */
export const POST_ACCEPT = 'image/jpeg';

/** The account the fake is logged in as by default (a valid handle, C14). */
export const FAKE_ACCOUNT = 'fake_owner';
/** The second handle `account=ambiguous` shows. */
export const FAKE_OTHER_ACCOUNT = 'fake_other';

/** The defaults the fake is written for. U16: must equal deriveKnobs(baseline.json). */
export const DEFAULT_KNOBS: Readonly<Knobs> = Object.freeze<Knobs>({
  classifier: 'ua',
  route: 'homeOnly',
  input: 'present',
  accept: 'default',
  listen: 'change',
  landscapeCheck: 'screen',
  trusted: 'ignore',
  geometry: 'viewportDpr',
  insets: [0, 0],
  save: 'on',
  sw: 'claimOnRegister',
  auth: 'in',
  offhost: 'none',
  challenge: 'none',
  desktopComposer: '302',
  reload: 'none',
  locale: 'en',
  drift: 'none',
  marker: 'on',
  slowMs: 0,
  hydrateMs: 0,
  account: FAKE_ACCOUNT,
  menuOrder: 'postStory',
  menuItems: '2',
  menuDelayMs: 300,
  fb: 'none',
  fbDelayMs: 800,
  shareControl: 'v1',
  rupload: 'ok',
  configure: 'ok',
  tray: 'ok',
  rtClear: 'on',
  xfo: 'deny',
  frameAncestors: 'absent',
  framed: 'unavailable',
  desktopNav: 'auto',
  theme: 'auto',
});

/** baseline.json as committed (structural facts only, strategy §7.7). */
export const BASELINE: Baseline = baselineJson as unknown as Baseline;

/**
 * Knob defaults implied by a baseline (strategy §3.9 item 3, §7.6, §11 AM26, AM35; ux.md IF11). Knobs the
 * baseline says nothing about (classifier, auth, offhost, challenge, desktopComposer, reload, locale,
 * drift, marker, slowMs, hydrateMs, account, menuDelayMs, fbDelayMs, rupload, configure, tray, rtClear)
 * take the behaviour research describes, and so does every fact the baseline marks `unknown`. L6's facts
 * map too: an untrusted insert that Instagram ignores makes `trusted=require`, a composer that reads only
 * drops makes `listen=drop`. The 2026-10-12 facts make the production shape the default: `route=homeOnly`,
 * the story input in the header (`input=present`), `sw=claimOnRegister`. AM37: `composerLandscapeCheck:
 * screen` makes the composer read the screen orientation. The autopilot facts (L18–L20): the menu's order
 * and size, the Share footer (`v2` = a linked Facebook destination) and the publish answer's content
 * type. The in-page facts (docs/inpage.md F4, F5; live 2026-10-14/15): `xFrameOptions`, `frameAncestors`,
 * `framedDocument` (`unavailable` → `framed=unavailable`) and `desktopNav` (`hoverExpand` → `desktopNav=auto`).
 * Throws for facts the fake cannot model.
 */
export function deriveKnobs(b: Baseline): Knobs {
  const unmodelled = (fact: string): never => {
    throw new Error(`fake-ig: baseline ${fact} is not modelled by the fake; extend tools/fake-ig first`);
  };
  if (b.uaProfile !== 'android-reduced') unmodelled(`uaProfile=${String(b.uaProfile)}`);
  if (b.isMobileKeyFound === false) unmodelled('isMobileKeyFound=false');
  // The page is controlled after the hard reload only by a worker that claims it on registration.
  if (b.swControlledAfterHardReload === true && b.swClaimsOnLoad !== true) {
    unmodelled('swControlledAfterHardReload=true without swClaimsOnLoad=true');
  }
  if (b.msiteMaxCssWidth !== MSITE_MAX_CSS_WIDTH) unmodelled(`msiteMaxCssWidth=${String(b.msiteMaxCssWidth)}`);
  const accept = (Object.keys(STORY_ACCEPT_LISTS) as Knobs['accept'][]).find((k) =>
    acceptSetEquals(STORY_ACCEPT_LISTS[k], b.accept),
  );
  if (accept === undefined) unmodelled(`accept=${b.accept.join(',')}`);
  const geometry = parseGeometryModel(b.geometry.model);
  if (geometry === null) unmodelled(`geometry.model=${b.geometry.model}`);
  const count = b.menuItemCount ?? 'unknown';
  if (count !== 'unknown' && count !== 2 && count !== 3) unmodelled(`menuItemCount=${String(count)}`);
  const type = b.configureContentType ?? 'unknown';
  if (type !== 'unknown' && !/^application\/json\b/i.test(type)) unmodelled(`configureContentType=${type}`);
  const xfo = xfoKnob(b.xFrameOptions);
  if (xfo === null) unmodelled(`xFrameOptions=${String(b.xFrameOptions)}`);
  const frameAncestors = frameAncestorsKnob(b.frameAncestors);
  if (frameAncestors === null) unmodelled(`frameAncestors=${String(b.frameAncestors)}`);
  const framed = b.framedDocument ?? 'unknown';
  if (framed !== 'unavailable' && framed !== 'msite' && framed !== 'unknown') unmodelled(`framedDocument=${framed}`);
  const nav = b.desktopNav ?? 'unknown';
  if (nav !== 'hoverExpand' && nav !== 'static' && nav !== 'unknown') unmodelled(`desktopNav=${nav}`);
  return {
    classifier: 'ua',
    route: b.route === 'direct' ? 'direct' : 'homeOnly',
    input: b.storyInputBeforeTap === false ? 'afterTap' : 'present',
    accept: accept as Knobs['accept'],
    listen: b.fileEvent === 'drop' ? 'drop' : 'change',
    landscapeCheck: b.composerLandscapeCheck === 'screen' ? 'screen' : 'viewport',
    trusted: b.untrustedInsertAccepted === false ? 'require' : 'ignore',
    geometry: b.geometry.model,
    insets: [b.geometry.insets[0], b.geometry.insets[1]],
    save: b.geometry.saveExposed === false ? 'off' : 'on',
    sw: swKnob(b),
    auth: 'in',
    offhost: 'none',
    challenge: 'none',
    desktopComposer: '302',
    reload: 'none',
    locale: 'en',
    drift: 'none',
    marker: 'on',
    slowMs: 0,
    hydrateMs: 0,
    account: FAKE_ACCOUNT,
    menuOrder: b.menuOrder === 'storyPost' ? 'storyPost' : 'postStory',
    menuItems: count === 3 ? '3' : '2',
    menuDelayMs: 300,
    fb: b.shareFooter === 'v2' ? 'linked' : 'none',
    fbDelayMs: 800,
    shareControl: b.shareFooter === 'v2' ? 'v2' : 'v1',
    rupload: 'ok',
    configure: 'ok',
    tray: 'ok',
    rtClear: 'on',
    xfo: xfo as Knobs['xfo'],
    frameAncestors: frameAncestors as Knobs['frameAncestors'],
    // C15 (live 2026-10-14): a framed document gets "page isn't available"; unknown keeps the S12 assumption.
    framed: framed === 'unavailable' ? 'unavailable' : 'serve',
    // The hover-expanding responsive navigation (live 2026-10-14/15); unknown or static: the wide one.
    desktopNav: nav === 'hoverExpand' ? 'auto' : 'wide',
    theme: 'auto',
  };
}

/** F4: the baseline's `X-Frame-Options` (absent or `unknown`: no header, the fake's earlier shape). */
function xfoKnob(v: Baseline['xFrameOptions']): Knobs['xfo'] | null {
  if (v === undefined || v === null || v === 'unknown') return 'none';
  if (v.toUpperCase() === 'DENY') return 'deny';
  if (v.toUpperCase() === 'SAMEORIGIN') return 'sameorigin';
  return null;
}

/** F5: the baseline's CSP `frame-ancestors` source list, null when the CSP has none. */
function frameAncestorsKnob(v: Baseline['frameAncestors']): Knobs['frameAncestors'] | null {
  if (v === undefined || v === null || v === 'unknown') return 'absent';
  const t = v.trim().toLowerCase();
  if (t === "'none'") return 'none';
  if (t === "'self'") return 'self';
  return null;
}

/**
 * F2: a worker with a fetch handler (hypothetical) is the intercepting `desktopShell`; Instagram's
 * real one has none and claims every page on registration (`claimOnRegister`); with neither fact, a
 * worker that serves the first load is again `desktopShell`.
 */
function swKnob(b: Baseline): Knobs['sw'] {
  if (b.swFetchHandler === true) return 'desktopShell';
  if (b.swClaimsOnLoad === true) return 'claimOnRegister';
  if (b.firstLoadServedBySw === true) return 'desktopShell';
  return 'none';
}

export type ParsedGeometry =
  | { kind: 'viewportDpr' }
  | { kind: 'source' }
  | { kind: 'fixed' | 'cssFixed'; w: number; h: number };

const GEOMETRY_RE = /^(fixed|cssFixed):([1-9]\d{0,4})x([1-9]\d{0,4})$/;

/** `viewportDpr | source | fixed:WxH | cssFixed:WxH` with 1 <= W, H <= 20000; null otherwise. */
export function parseGeometryModel(model: string): ParsedGeometry | null {
  if (model === 'viewportDpr' || model === 'source') return { kind: model };
  const m = GEOMETRY_RE.exec(model);
  if (!m) return null;
  const w = Number(m[2]);
  const h = Number(m[3]);
  if (w > 20000 || h > 20000) return null;
  return { kind: m[1] as 'fixed' | 'cssFixed', w, h };
}

const SLOW_RE = /^slow:(\d{1,5})$/;

/** `slow:<ms>` → ms (0..60000); null for any other value. */
export function slowMs(value: string): number | null {
  const m = SLOW_RE.exec(value);
  const n = m ? Number(m[1]) : Number.NaN;
  return Number.isInteger(n) && n <= 60_000 ? n : null;
}

/** The account knob as the page renders it: one handle, none, or two handles. */
export type AccountShape =
  | { kind: 'one'; handle: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; handles: string[] };

export function accountShape(value: string): AccountShape {
  if (value === 'none') return { kind: 'none' };
  if (value === 'ambiguous') return { kind: 'ambiguous', handles: [FAKE_ACCOUNT, FAKE_OTHER_ACCOUNT] };
  const handle = value.startsWith('other:') ? value.slice('other:'.length) : value;
  return isValidHandle(handle) ? { kind: 'one', handle } : { kind: 'none' };
}

function validString(name: (typeof STRING_KNOBS)[number], value: unknown): string | null {
  if (typeof value !== 'string') return null;
  switch (name) {
    case 'account': {
      if (value === 'none' || value === 'ambiguous') return value;
      const handle = value.startsWith('other:') ? value.slice('other:'.length) : value;
      return isValidHandle(handle) ? value : null;
    }
    case 'rupload':
      return (RUPLOAD_CHOICES as readonly string[]).includes(value) || slowMs(value) !== null ? value : null;
    case 'configure':
      return (CONFIGURE_CHOICES as readonly string[]).includes(value) || slowMs(value) !== null ? value : null;
  }
}

const STRING_HINT: Record<(typeof STRING_KNOBS)[number], string> = {
  account: '<handle>|none|ambiguous|other:<handle>',
  rupload: `${RUPLOAD_CHOICES.join('|')}|slow:<ms>`,
  configure: `${CONFIGURE_CHOICES.join('|')}|slow:<ms>`,
};

export type KnobPatchResult = { ok: true; patch: Partial<Knobs> } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseInt0(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/**
 * Validates a partial knob update from the API (JSON) or the dashboard form (strings).
 * Unknown names and invalid values are errors; nothing is applied unless all are valid.
 * `insets` accepts `"top,bottom"` or `[top, bottom]`; the ms knobs a number or a digit string;
 * `menuItems` a string or a number.
 */
export function parseKnobPatch(input: unknown): KnobPatchResult {
  if (!isRecord(input)) return { ok: false, errors: ['knobs: expected an object'] };
  const patch: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [name, raw] of Object.entries(input)) {
    if (!(KNOB_NAMES as readonly string[]).includes(name)) {
      errors.push(`unknown knob ${name}`);
      continue;
    }
    const value = name === 'menuItems' && typeof raw === 'number' ? String(raw) : raw;
    if (name === 'geometry') {
      if (typeof value === 'string' && parseGeometryModel(value)) patch.geometry = value;
      else errors.push(`geometry: expected viewportDpr|source|fixed:WxH|cssFixed:WxH, got ${JSON.stringify(value)}`);
    } else if (name === 'insets') {
      const parts = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
      const nums = parts.map((p) => parseInt0(p, 2000));
      if (nums.length === 2 && nums[0] != null && nums[1] != null) patch.insets = [nums[0], nums[1]];
      else errors.push(`insets: expected "top,bottom" (0..2000), got ${JSON.stringify(value)}`);
    } else if ((MS_KNOBS as readonly string[]).includes(name)) {
      const n = parseInt0(value, 60_000);
      if (n !== null) patch[name] = n;
      else errors.push(`${name}: expected an integer 0..60000, got ${JSON.stringify(value)}`);
    } else if ((STRING_KNOBS as readonly string[]).includes(name)) {
      const s = validString(name as (typeof STRING_KNOBS)[number], value);
      if (s !== null) patch[name] = s;
      else
        errors.push(
          `${name}: expected ${STRING_HINT[name as (typeof STRING_KNOBS)[number]]}, got ${JSON.stringify(value)}`,
        );
    } else {
      const choices = KNOB_CHOICES[name as EnumKnob] as readonly string[];
      if (typeof value === 'string' && choices.includes(value)) patch[name] = value;
      else errors.push(`${name}: expected ${choices.join('|')}, got ${JSON.stringify(value)}`);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, patch: patch as Partial<Knobs> };
}

export function mergeKnobs(base: Readonly<Knobs>, patch: Partial<Knobs>): Knobs {
  const next = { ...base, ...patch };
  return { ...next, insets: [next.insets[0], next.insets[1]] };
}

export function knobsEqual(a: Readonly<Knobs>, b: Readonly<Knobs>): boolean {
  return KNOB_NAMES.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}
