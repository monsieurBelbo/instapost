/**
 * The `wxt` dev seal (strategy §7.3, §11 AM9, AM26): what wxt.config.ts's `config:resolved` hook
 * checks on the merged web-ext runner config before any browser starts. Pure, so U17 tests it.
 *
 * - The target browser must be `chrome` (SAFE-5): WXT's runner picks per-browser options, so with
 *   `-b firefox` it would read `firefoxArgs`/`binaries.firefox` (unset: an unsealed Firefox whose
 *   start URL is the real Instagram), and with `-b edge`/`-b chromium` `binaries[browser]` (unset:
 *   chrome-launcher picks an installed branded Chrome).
 * - The binary for that browser is the pinned CfT, the profile is exactly the sealed dev profile,
 *   and the args pass assertSealed().
 */
import { assertSealed } from './flags.ts';

/** The parts of WXT's resolved web-ext runner config the seal reads. */
export interface DevRunnerConfig {
  disabled?: boolean;
  chromiumArgs?: string[];
  chromiumProfile?: string;
  binaries?: Record<string, string | undefined>;
}

export interface DevSealExpectations {
  /** Sealed web-ext args for this run, or null when there is no valid fake certificate. */
  webExtArgs: readonly string[] | null;
  /** cftExecutable(). */
  binary: string;
  /** DEV_PROFILE_DIR. */
  profileDir: string;
}

/** Throws unless `wxt` dev may open a browser with this config for `browser`. */
export function assertDevRunnerSealed(browser: string, runner: DevRunnerConfig, want: DevSealExpectations): void {
  if (runner.disabled === true) return;
  if (browser !== 'chrome') {
    throw new Error(`instapost: wxt dev runs only the sealed CfT build of chrome, not "${browser}" (drop -b)`);
  }
  if (!want.webExtArgs) {
    throw new Error('instapost: no valid fake certificate, so wxt dev must not open a browser (pnpm run fake:cert)');
  }
  const args = runner.chromiumArgs ?? [];
  assertSealed(args);
  const dataDirs = args.filter((a) => a.startsWith('--user-data-dir='));
  if (dataDirs.length !== 1 || dataDirs[0] !== `--user-data-dir=${want.profileDir}`) {
    throw new Error(`instapost: wxt dev must use exactly the sealed profile ${want.profileDir}`);
  }
  if (runner.chromiumProfile !== undefined) throw new Error('instapost: chromiumProfile must not be set for wxt dev');
  if (runner.binaries?.[browser] !== want.binary) {
    throw new Error('instapost: wxt dev must launch the pinned CfT binary');
  }
}
