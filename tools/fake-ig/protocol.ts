/**
 * What the fake's server and its React client share: paths, header names, the boot data the
 * server embeds in each shell, the composer's geometry ground truth and the Share metadata.
 *
 * Pure types and constants (no Node APIs): imported by core.ts and bundled into the client.
 * Nothing here is Instagram markup; the agent relies only on the structural contract (§7.6).
 */
import type { Knobs } from './knobs.ts';

export const WWW_HOST = 'www.instagram.com';
export const I_HOST = 'i.instagram.com';
export const IG_HOSTS: readonly string[] = [WWW_HOST, I_HOST];

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
  /** POST {control, isTrusted} for every fake control the human clicks (FID-2). */
  control: '/__fake__/control',
  /** POST FakeComposerView whenever the composer page mounts with a photo or its landscape gate flips (AM37). */
  composerView: '/__fake__/composer-view',
} as const;

/** The fake's clickable controls that report their click's isTrusted to /__fake__/control. */
export type FakeControl = 'create' | 'story' | 'post' | 'close' | 'save' | 'home';

/** Share in `share=background`: how long after going home the upload starts (longer than the 3 s close). */
export const BACKGROUND_UPLOAD_DELAY_MS = 4500;
/** `challenge=…`: how long after ready or after Share the challenge comes. */
export const CHALLENGE_DELAY_MS = 800;

/** Share metadata header on POST /__fake__/stories (JSON, ASCII). */
export const FAKE_META_HEADER = 'x-fake-meta';
/** Set by the desktopShell service worker on the navigations it answers with its own fetch. */
export const FAKE_VIA_SW_HEADER = 'x-fake-via-sw';

/** Where Instagram itself would go after `offhost=afterReady` (unmapped, so NOTFOUND in a sealed browser). */
export const OFFHOST_URL = 'https://accountscenter.instagram.com/';

/** Real-shaped write targets for `share=real-paths` (research §5.3). Subresource POSTs only (AM6). */
export const realWriteTargets = (uploadId: string) => ({
  rupload: `https://${I_HOST}/rupload_igphoto/fb_uploader_${uploadId}`,
  configure: `https://${WWW_HOST}/api/v1/media/configure_to_story/`,
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
 * canvas is mounted. `canvas`, `css`, `dpr` and `inner` use the agent's C8 field names
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

/** JSON in the x-fake-meta header of a Share. */
export interface FakeShareMeta {
  /** `event.isTrusted` of the Share click. false is recorded as a violation (SG6). */
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
   * passed, a session id was issued) before the file arrived. false when the file came without it: the
   * H1 insert, or a spec that set the input's files directly (Instagram's sessionId stays null).
   */
  sessionStarted: boolean;
  /** The session id + → Story issued (a uuid), or null. */
  sessionId: string | null;
  /** `screen.orientation.type` as the page read it at Share (after the extension's portrait shim). */
  screenOrientation: string | null;
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
