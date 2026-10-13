/**
 * msite's two orientation checks (strategy §11 AM37; Instagram's public bundles read 2026-10-12, and
 * the second live run in Arc the same day). The fake models both exactly:
 *
 * 1. **Session start** (`PolarisStoryCreationActions.startStoryCreationSession`, called by + → Story
 *    before the file chooser opens): `innerHeight < innerWidth` → the "Rotate your device" toast and
 *    no chooser; otherwise the story session starts with a uuid session id. A file that reaches the
 *    story input without that tap (H1's insert) skips it, so the session id stays null.
 * 2. **The composer page's landscape gate** (`usePolarisDisplayProperties` +
 *    `PolarisStoryCreationPage`): `isLandscape` from `screen.orientation.type` (else
 *    `window.orientation` ±90, else nothing), falling back to the viewport (`width > height`) when
 *    there is no type; read when the page mounts with the photo and again on every `resize`. Landscape
 *    shows the same text as a snackbar and hides the header and the Share footer.
 *
 * Knob `landscapeCheck=viewport` replaces 2 with the viewport alone (the assumption before 2026-10-12).
 */
import type { Knobs } from '../knobs.ts';
import { FAKE_PATHS, type FakeComposerView } from '../protocol.ts';

/** 1: the session start's test, at + → Story. */
export const sessionStartRejected = (): boolean => window.innerHeight < window.innerWidth;

/**
 * The orientation type as Instagram's `usePolarisDisplayProperties` reads it: `screen.orientation.type`,
 * else `window.orientation` (±90 → landscape), else null. The page's own read, so a MAIN-world shim
 * (the extension's portrait shim) changes it.
 */
export function screenOrientationType(): string | null {
  const type: unknown = (screen as Partial<Screen>).orientation?.type;
  if (typeof type === 'string' && type.length > 0) return type;
  const legacy = (window as Window & { orientation?: unknown }).orientation;
  if (typeof legacy === 'number') return Math.abs(legacy) === 90 ? 'landscape-primary' : 'portrait-primary';
  return null;
}

export interface LandscapeGate {
  landscape: boolean;
  via: FakeComposerView['via'];
  screenOrientation: string | null;
  inner: { w: number; h: number };
}

/** 2: the composer page's gate, as `landscapeCheck` says it reads. */
export function readLandscapeGate(check: Knobs['landscapeCheck']): LandscapeGate {
  const inner = { w: window.innerWidth, h: window.innerHeight };
  const type = screenOrientationType();
  const byViewport = inner.w > inner.h;
  if (check === 'viewport' || type === null) {
    return { landscape: byViewport, via: 'viewport', screenOrientation: type, inner };
  }
  return { landscape: type.startsWith('landscape'), via: 'screen', screenOrientation: type, inner };
}

export const sameGate = (a: LandscapeGate, b: LandscapeGate): boolean =>
  a.landscape === b.landscape && a.via === b.via && a.screenOrientation === b.screenOrientation;

/** Records what the composer page showed (`/__fake__/composer-view`), so specs can read it after the popup closed. */
export function reportComposerView(view: FakeComposerView): void {
  void fetch(FAKE_PATHS.composerView, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(view),
    keepalive: true,
  }).catch(() => undefined);
}
