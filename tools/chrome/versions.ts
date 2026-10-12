/**
 * Pinned browser builds (strategy §7.4). Bump CFT_BUILD when the owner's branded Chrome
 * changes major, then run `pnpm run test:smoke155` (renamed for the new major) and redo L11.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Browser, computeExecutablePath } from '@puppeteer/browsers';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Chrome for Testing Stable on 2026-10-11 (research §8.2); the owner's branded build is 155.0.8059.40. */
export const CFT_BUILD = '155.0.8059.39';
export const CFT_CACHE = '.cache/cft';
export const CFT_CACHE_DIR = resolve(ROOT, CFT_CACHE);
/** Mirrors manifest `minimum_chrome_version`. */
export const MIN_CHROME_MAJOR = 155;

export const cftInstallOptions = () => ({ browser: Browser.CHROME, buildId: CFT_BUILD, cacheDir: CFT_CACHE_DIR });

/** Absolute path of the pinned CfT binary (whether or not it is installed yet). */
export function cftExecutable(): string {
  return computeExecutablePath(cftInstallOptions());
}
