/**
 * What the fake's server and its React client share: paths, header names, the boot data the
 * server embeds in each shell, the composer's geometry ground truth, the Share metadata, the log
 * (Instagram's story-creation telemetry, as the fake models it) and the controls it reports.
 *
 * Pure types and constants (no Node APIs): imported by core.ts and bundled into the client.
 * Nothing here is Instagram markup; the agent relies only on the structural contract (§7.6, C10–C14).
 */
import type { Knobs } from './knobs.ts';

export const WWW_HOST = 'www.instagram.com';
export const I_HOST = 'i.instagram.com';
export const IG_HOSTS: readonly string[] = [WWW_HOST, I_HOST];
export const WWW_ORIGIN = `https://${WWW_HOST}`;

export const FAKE_PATHS = {
  clientJs: '/fake-static/client.js',
  /**
   * GET, 204: the request a page makes when a service worker takes control of it, as Instagram's
   * pages keep sending requests. The P3 tripwire reads its timing (workerStart > 0 only when a worker
   * with a fetch handler handled it).
   */
  beacon: '/fake-static/beacon',
  /** `sw=claimOnRegister` (F2), registered with `?enableAddToHomeScreen=<is_mobile>&zenon_device_id=<id>`. */
  swClaimOnRegister: '/fake-sw/claim-on-register.js',
  swDesktopShell: '/fake-sw/desktop-shell.js',
  swClaimLate: '/fake-sw/claim-late.js',
  health: '/__fake__/health',
  dashboard: '/__fake__/',
  /** GET /__fake__/stories/<id>.jpg: a published story's JPEG. */
  stories: '/__fake__/stories',
  siteReset: '/__fake__/reset',
  api: '/__fake__/api/',
  home: '/',
  composer: '/create/story/',
  login: '/accounts/login/',
  challenge: '/challenge/',
  /** `auth=codeentry`: a security flow under /auth_platform (AM17). */
  codeEntry: '/auth_platform/codeentry/',
  /** `route=elsewhere`: an interstitial that is neither home nor a security flow (AM17). */
  elsewhere: '/consent/',
  /** POST {control, isTrusted, repeat?} for every fake control clicked (IF9). */
  control: '/__fake__/control',
  /** POST FakeComposerView whenever the composer page mounts with a photo or its landscape gate flips (AM37). */
  composerView: '/__fake__/composer-view',
  /** POST FakeLogInput: the page's story-creation telemetry (IF8). GET it at /__fake__/api/log. */
  log: '/__fake__/log',
  /** POST on www: Instagram's tray refresh after a published story (IF6). */
  graphql: '/graphql/query',
  /** POST on i.instagram.com: the photo upload (C13), `fb_uploader_<upload id>`. */
  ruploadPrefix: '/rupload_igphoto/',
  /** POST on www: the publish request (C13). */
  configure: '/api/v1/media/configure_to_story/',
} as const;

/** The upload's path (C13): `/rupload_igphoto/fb_uploader_<digits>`. */
export const RUPLOAD_PATH_RE = /^\/rupload_igphoto\/fb_uploader_(\d{1,20})$/;

/**
 * The fake's clickable controls, each reporting its click's isTrusted to /__fake__/control (IF9).
 * Untrusted clicks are allowed on the autopilot's three controls only (+ `create`, the menu's `story`,
 * and `share`, once); `post` is the menu's other item, which the autopilot may tap once by trial. Every
 * other untrusted click is TAP_OUTSIDE_ALLOWLIST; an untrusted Retry is RETRY_CLICKED; a second Share in
 * one composer session is DOUBLE_SHARE, whoever clicked.
 */
export type FakeControl =
  | 'create'
  | 'story'
  | 'post'
  | 'menuExtra'
  | 'share'
  | 'retry'
  | 'close'
  | 'save'
  | 'text'
  | 'draw'
  | 'aiLabel'
  | 'toastAction'
  | 'dialog'
  | 'home'
  | 'profile';

export const FAKE_CONTROLS: readonly FakeControl[] = [
  'create',
  'story',
  'post',
  'menuExtra',
  'share',
  'retry',
  'close',
  'save',
  'text',
  'draw',
  'aiLabel',
  'toastAction',
  'dialog',
  'home',
  'profile',
];

/** Controls the autopilot may tap with an untrusted click (ux.md P2; `post`: the one trial, E33). */
export const UNTRUSTED_ALLOWED: readonly FakeControl[] = ['create', 'story', 'post', 'share'];

export interface FakeControlReport {
  control: FakeControl;
  isTrusted: boolean;
  /** Share only: a Share in a composer session that already shared (Instagram has no in-flight guard). */
  repeat?: boolean;
}

/** `challenge=…`: how long after ready or after the Share flow settled the challenge comes. */
export const CHALLENGE_DELAY_MS = 800;
/** IF6: Instagram's toasts stay this long (and survive one navigation, persistOnNavigate). */
export const TOAST_MS = 5000;
/** IF7: `rtClear=on` clears the page's resource timing buffer this often. */
export const RT_CLEAR_MS = 2000;

/** Share metadata header on the upload (JSON, ASCII). */
export const FAKE_META_HEADER = 'x-fake-meta';
/** Set by the desktopShell service worker on the navigations it answers with its own fetch. */
export const FAKE_VIA_SW_HEADER = 'x-fake-via-sw';

/** Where Instagram itself would go after `offhost=afterReady` (unmapped, so NOTFOUND in a sealed browser). */
export const OFFHOST_URL = 'https://accountscenter.instagram.com/';

/** The real-shaped write targets (research §5.3, C13). */
export const realWriteTargets = (uploadId: string) => ({
  rupload: `https://${I_HOST}${FAKE_PATHS.ruploadPrefix}fb_uploader_${uploadId}`,
  configure: `${WWW_ORIGIN}${FAKE_PATHS.configure}`,
});

/** Embedded by the server as `<script type="application/json" data-fake-boot>` in every shell. */
export interface FakeBoot {
  v: 1;
  shell: 'msite' | 'desktop';
  /** The server-side route that rendered this document. */
  route: 'home' | 'composer';
  knobs: Knobs;
  /** id of the React root element (randomised with `drift=renamed`). */
  rootId: string;
}

export interface Size {
  w: number;
  h: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** Cover crop of the source, in source pixels (drawImage sx, sy, sw, sh). */
export interface Crop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Composer ground truth, JSON in `document.documentElement.dataset.fakeGeometry` while the
 * canvas is drawn. `canvas`, `css`, `dpr` and `inner` use the agent's C8 field names
 * (ProbeReport.canvas / inner / dpr), so E13 can compare them directly.
 */
export interface FakeGeometry {
  model: Knobs['geometry'];
  insets: [number, number];
  inner: Size;
  dpr: number;
  source: Size;
  /** Backing store size. */
  canvas: Size;
  /** CSS box in viewport coordinates (integers, so getBoundingClientRect() matches exactly). */
  css: Rect;
  crop: Crop;
}

/** JSON in the x-fake-meta header of the upload: what the composer looked like at the Share click. */
export interface FakeShareMeta {
  /** `event.isTrusted` of the Share click (the autopilot's is false, the owner's in Finish by hand true). */
  isTrusted: boolean;
  canvas: Size;
  css: Size;
  dpr: number;
  source: Size;
  inner: Size;
  lang: string;
  knobs: Knobs;
  geometry: FakeGeometry;
  /** location.pathname at Share time. */
  path: string;
  /** The page's own navigator.userAgent (the JS realm still says desktop under dNR, §2.3). */
  navigatorUa: string;
  /**
   * AM37: msite's story session was started by + → Story (startStoryCreationSession: the viewport check
   * passed, a session id was issued) before the file arrived. false when the file came without it (a
   * spec that set the input's files directly; Instagram's sessionId stays null).
   */
  sessionStarted: boolean;
  /** The session id + → Story issued (a uuid, also the telemetry's waterfall_id), or null. */
  sessionId: string | null;
  /** `screen.orientation.type` as the page read it at Share (after the extension's portrait shim). */
  screenOrientation: string | null;
  /** Which Share control was clicked (C12). */
  variant: 'v1' | 'v2';
  /** The Facebook badge was on the control (automatic crossposting). */
  fbAuto: boolean;
}

/**
 * AM37: what the composer page showed, as its landscape gate decided it (PolarisStoryCreationPage
 * `isLandscape`): reported when it mounts with a photo and whenever the gate flips on a resize.
 */
export interface FakeComposerView {
  /** The gate's verdict: the rotate snackbar is shown and the header and Share footer are hidden. */
  landscape: boolean;
  /** Share is rendered (the inverse of `landscape`, recorded so a spec reads what the page did). */
  share: boolean;
  /** Which reading decided it (knob `landscapeCheck`; `screen` falls back to the viewport without a type). */
  via: 'screen' | 'viewport';
  /** `screen.orientation.type` as the page read it (after the portrait shim), or null. */
  screenOrientation: string | null;
  inner: Size;
  /** + → Story started the story session that brought the photo (see FakeShareMeta.sessionStarted). */
  sessionStarted: boolean;
  /** location.pathname. */
  path: string;
}

/**
 * IF8: one step of the page's story-creation telemetry, as Instagram's PolarisStoryCreationLogger would
 * send it (`enter`, `image_process_*`, `compose_*`), plus the fake's own: `post_session_started` (the menu's
 * Post item started a post session) and `menu_opened`. `doc` is a per-document id, so a spec can count per
 * page load. Values are primitives only.
 */
export interface FakeLogInput {
  step: string;
  doc: string;
  fields: Record<string, string | number | boolean | null>;
}

/** The Pigeon-like steps the fake logs (IF8). */
export const LOG_STEPS = [
  'enter',
  'menu_opened',
  'post_session_started',
  'image_process_attempt',
  'image_process_success',
  'image_process_failure',
  'compose_stage_attempt',
  'compose_finalize_attempt',
  'compose',
  'compose_failure',
  'tray_refresh',
] as const;
