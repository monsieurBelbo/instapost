/**
 * WXT config (strategy §7.3, §5). Three build modes; anything else fails closed.
 *
 * Deviations from §7.3, all fail-closed (see the S1 report):
 * - `wxt prepare` (the postinstall) has no --mode flag and always resolves the config as
 *   `production`, so the manifest callback tolerates `production` for type generation only;
 *   `build:before` rejects it, so a plain `wxt build` still fails before writing anything.
 * - Builds compile JSX with the production runtime (`vite.oxc.jsx.development`), because WXT
 *   sets NODE_ENV to the mode name and Vite would otherwise embed jsxDEV calls with absolute paths.
 * - The final web-ext config is merged by WXT from several sources (web-ext.config.*,
 *   .webextrc, ~/.webextrc, …) with this file's `webExt` as the lowest-priority defaults.
 *   `config:resolved` therefore re-checks the merged result before any browser can start.
 */
import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';
import { blockRuleset, STATIC_RULESET_ID, STATIC_RULESET_PATH } from './src/core/ig-contract/rules.ts';
import { assertDevRunnerSealed } from './tools/chrome/dev-seal.ts';
import { assertSealed, DEV_PROFILE_DIR, readSpki, sealedWebExtArgs } from './tools/chrome/flags.ts';
import { cftExecutable } from './tools/chrome/versions.ts';

const MODES = {
  development: { name: 'instapost DEV', icon: 'dev', key: 'dev', guarded: true },
  mock: { name: 'instapost MOCK', icon: 'mock', key: 'mock', guarded: true },
  live: { name: 'instapost', icon: 'live', key: 'live', guarded: false },
} as const;
type Mode = keyof typeof MODES;
const modeOf = (m: string): Mode => {
  if (!Object.hasOwn(MODES, m)) throw new Error(`instapost: unknown mode "${m}" (development | mock | live)`);
  return m as Mode;
};
const assertLiveAllowed = (m: Mode, command: string) => {
  if (m === 'live' && command === 'serve') throw new Error('live never runs under wxt dev');
  if (m === 'live' && process.env.INSTAPOST_LIVE !== '1') throw new Error('build live with INSTAPOST_LIVE=1');
};

const spki = readSpki(); // null when .fake-ig/spki.txt is missing, mismatched or the cert expires within 3 days
// HEADLESS=1 (chrome-launcher adds --headless): emulate the owner's screen too, or every popup
// is clamped to the 800x600 headless screen and the hand-off fails with SCREEN_TOO_SMALL (AM26).
const webExtArgs = spki ? sealedWebExtArgs(spki, { headless: Boolean(process.env.HEADLESS) }) : null;
if (webExtArgs) assertSealed(webExtArgs);

export default defineConfig({
  manifestVersion: 3,
  // WXT sets NODE_ENV to the mode name, so Vite would compile JSX with the dev runtime (and
  // absolute source paths) into mock and live artifacts. Builds use the production JSX runtime.
  vite: (env) => ({ oxc: { jsx: { development: env.command === 'serve' } } }),
  manifest: ({ mode, command }) => {
    // `wxt prepare` only: it cannot pass --mode. build:before rejects `production` for real builds.
    if (mode === 'production' && command === 'build') return { name: 'instapost (wxt prepare only, not a build mode)' };
    const m = modeOf(mode);
    assertLiveAllowed(m, command);
    const { name, icon, key, guarded } = MODES[m];
    const icons = Object.fromEntries([16, 32, 48, 128].map((s) => [s, `icons/${icon}/${s}.png`]));
    return {
      name,
      description: 'Prepare Instagram stories on desktop.',
      key: readFileSync(`keys/${key}.pub.b64`, 'utf8').trim(),
      minimum_chrome_version: '155',
      permissions: [
        'storage',
        'unlimitedStorage',
        'scripting',
        'downloads',
        'declarativeNetRequestWithHostAccess',
        ...(guarded ? ['declarativeNetRequest', 'declarativeNetRequestFeedback'] : []),
      ],
      host_permissions: ['https://www.instagram.com/*', 'https://i.instagram.com/*'],
      content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
      action: { default_title: name, default_icon: icons },
      // ux.md §4.1 (IB4): the toolbar action's shortcut, ⌥⇧S, changeable at chrome://extensions/shortcuts.
      commands: { _execute_action: { suggested_key: { default: 'Alt+Shift+S' } } },
      icons,
      ...(guarded
        ? {
            declarative_net_request: {
              rule_resources: [{ id: STATIC_RULESET_ID, enabled: true, path: STATIC_RULESET_PATH }],
            },
          }
        : {}),
    };
  },
  hooks: {
    'config:resolved': (wxt) => {
      if (wxt.config.command !== 'serve') return;
      const m = modeOf(wxt.config.mode);
      assertLiveAllowed(m, 'serve');
      // Re-check the merged web-ext config: other config sources can override or append to ours,
      // and the target browser decides which of its options the runner reads (AM26).
      assertDevRunnerSealed(wxt.config.browser, wxt.config.webExt.config ?? {}, {
        webExtArgs,
        binary: cftExecutable(),
        profileDir: DEV_PROFILE_DIR,
      });
    },
    'build:before': (wxt) => {
      assertLiveAllowed(modeOf(wxt.config.mode), wxt.config.command);
    },
    'build:publicAssets': (wxt, files) => {
      const { icon, guarded } = MODES[modeOf(wxt.config.mode)];
      // Ship only this mode's icon set (public/icons holds all three).
      for (let i = files.length - 1; i >= 0; i--) {
        const dest = files[i]?.relativeDest ?? '';
        if (dest.startsWith('icons/') && !dest.startsWith(`icons/${icon}/`)) files.splice(i, 1);
      }
      if (guarded) files.push({ relativeDest: STATIC_RULESET_PATH, contents: JSON.stringify(blockRuleset(), null, 2) });
    },
  },
  // Fail closed: without the fake's certificate, `wxt` dev opens no browser at all.
  webExt: webExtArgs
    ? {
        binaries: { chrome: cftExecutable() },
        chromiumArgs: webExtArgs,
        startUrls: ['https://www.instagram.com/__fake__/'],
      }
    : { disabled: true },
});
