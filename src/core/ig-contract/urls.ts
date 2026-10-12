/**
 * Composer-tab URL classification for the kill switch and probe evaluation (strategy §3.6).
 *
 * src/core has no `URL` global (lib ES2023 only), so URLs are split by hand. The input is
 * Chrome's `tab.url`, which is already normalised (lower-case host, default port dropped,
 * dot segments resolved); anything that does not parse as `https://www.instagram.com/…`
 * counts as off-host.
 */

export const IG_HOST = 'www.instagram.com';
export const IG_ORIGIN = 'https://www.instagram.com';
export const COMPOSER_URL = 'https://www.instagram.com/create/story/';
export const COMPOSER_PATH_PREFIX = '/create/story';

/** /accounts/login… : stop (close, no lock). Compared case-insensitively, which errs towards stopping. */
export const LOGIN_PATH_PREFIX = '/accounts/login';
/**
 * Security flows: kill (close, lock 7 days). Compared case-insensitively. AM17: besides /challenge
 * and /checkpoint, Instagram's code-entry and integrity flows live under /auth_platform, and
 * suspension, disabled-account and other account interstitials under /accounts (every /accounts
 * path except login, which stops instead).
 */
export const CHALLENGE_PATH_PREFIXES = ['/challenge', '/checkpoint', '/auth_platform', '/accounts'] as const;
/**
 * AM17: the only www paths outside the composer that count as "composer left" (C9). `/` is where the
 * composer goes after Share (the fake; to confirm in L8). Any other www path is `unknown-left`.
 */
export const COMPOSER_LEFT_PATHS: readonly string[] = ['/'];

/** C5: where the composer tab landed after the hard reload. `homeOnly`: the H0 text says "tap + → Story". */
export type ComposerRoute = 'direct' | 'homeOnly';

export type UrlVerdict =
  /** www.instagram.com under /create/story. */
  | { kind: 'ok' }
  /** /accounts/login…: close at once, remove rules, no lockout. */
  | { kind: 'stop'; code: 'NOT_LOGGED_IN' }
  /** Close, remove rules, lock the msite lane for 7 days. */
  | { kind: 'kill'; code: 'KILLED_CHALLENGE' | 'KILLED_OFFHOST' }
  /** www.instagram.com home (COMPOSER_LEFT_PATHS): C9, composer left, once the composer was in use. */
  | { kind: 'composer-left' }
  /** AM17: any other www.instagram.com path. Fails closed: never probed, injected or pre-answered "posted". */
  | { kind: 'unknown-left' };

const OK: UrlVerdict = { kind: 'ok' };
const STOP: UrlVerdict = { kind: 'stop', code: 'NOT_LOGGED_IN' };
const CHALLENGE: UrlVerdict = { kind: 'kill', code: 'KILLED_CHALLENGE' };
const OFFHOST: UrlVerdict = { kind: 'kill', code: 'KILLED_OFFHOST' };
const LEFT: UrlVerdict = { kind: 'composer-left' };
const UNKNOWN: UrlVerdict = { kind: 'unknown-left' };

/** scheme, authority, path (query and fragment dropped). */
const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;

/** The path of an `https://www.instagram.com/…` URL ('/' when empty), or null for anything else. */
export function igPath(url: string): string | null {
  const m = URL_PARTS.exec(url);
  if (!m) return null;
  const [, scheme = '', authority = '', path = ''] = m;
  // Userinfo or a port means a different origin than the one we hold permissions for.
  if (scheme.toLowerCase() !== 'https' || authority.toLowerCase() !== IG_HOST) return null;
  return path === '' ? '/' : path;
}

/** `path` is `prefix` itself or below it (`/create/story` matches `/create/story/x`, not `/create/storyx`). */
function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** www.instagram.com under COMPOSER_PATH_PREFIX. */
export function isComposerUrl(url: string | undefined): boolean {
  const path = url === undefined ? null : igPath(url);
  return path !== null && under(path, COMPOSER_PATH_PREFIX);
}

/**
 * Classifies the composer tab's URL after the kill switch is armed:
 * - `https://www.instagram.com/accounts/login…` → stop NOT_LOGGED_IN;
 * - `/challenge`, `/checkpoint`, `/auth_platform` or any other `/accounts` path on www → kill
 *   KILLED_CHALLENGE (AM17);
 * - any other scheme or host (including about:blank and error pages) → kill KILLED_OFFHOST;
 * - `undefined` (a host without permission, e.g. accountscenter or facebook.com) → kill KILLED_OFFHOST;
 * - www under COMPOSER_PATH_PREFIX → ok; `/` → composer-left; any other www path → unknown-left (AM17).
 * Tested by U14.
 */
export function classifyComposerUrl(url: string | undefined): UrlVerdict {
  if (url === undefined) return OFFHOST;
  const path = igPath(url);
  if (path === null) return OFFHOST;
  const lower = path.toLowerCase();
  if (under(lower, LOGIN_PATH_PREFIX)) return STOP;
  if (CHALLENGE_PATH_PREFIXES.some((p) => under(lower, p))) return CHALLENGE;
  if (under(path, COMPOSER_PATH_PREFIX)) return OK;
  return COMPOSER_LEFT_PATHS.includes(path) ? LEFT : UNKNOWN;
}
