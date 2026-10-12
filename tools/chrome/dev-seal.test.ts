/**
 * U17 (strategy §7.11, §11 AM9, AM26): the `wxt` dev seal refuses every target browser but chrome,
 * a binary other than the pinned CfT for it, and anything assertSealed() refuses.
 */
import { describe, expect, it } from 'vitest';
import { assertDevRunnerSealed, type DevRunnerConfig } from './dev-seal.ts';
import { DEV_PROFILE_DIR, HEADLESS_SCREEN_ARGS, sealedWebExtArgs } from './flags.ts';

const SPKI = 'XkaYKe8PH05Phbfpk5bkd3MoKvR+rP39ZG8ssIhF/s8=';
const CFT =
  '/repo/.cache/cft/chrome/mac_arm-155/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const want = { webExtArgs: sealedWebExtArgs(SPKI), binary: CFT, profileDir: DEV_PROFILE_DIR };
const runner = (over: Partial<DevRunnerConfig> = {}): DevRunnerConfig => ({
  chromiumArgs: sealedWebExtArgs(SPKI),
  binaries: { chrome: CFT },
  ...over,
});

describe('U17 wxt dev seal (config:resolved)', () => {
  it('accepts the sealed chrome runner, headless or not', () => {
    expect(() => assertDevRunnerSealed('chrome', runner(), want)).not.toThrow();
    const headless = sealedWebExtArgs(SPKI, { headless: true });
    expect(() => assertDevRunnerSealed('chrome', runner({ chromiumArgs: headless }), want)).not.toThrow();
  });

  it.each(['firefox', 'edge', 'chromium', 'safari'])('refuses -b %s, whatever the chrome options say', (browser) => {
    expect(() => assertDevRunnerSealed(browser, runner(), want)).toThrow(/only the sealed CfT build of chrome/);
    // Even with a binary for that browser.
    const binaries = { chrome: CFT, [browser]: CFT };
    expect(() => assertDevRunnerSealed(browser, runner({ binaries }), want)).toThrow(/chrome/);
  });

  it('refuses another binary, another profile, a chromiumProfile, unsealed args, or no certificate', () => {
    expect(() => assertDevRunnerSealed('chrome', runner({ binaries: {} }), want)).toThrow(/pinned CfT/);
    expect(() =>
      assertDevRunnerSealed('chrome', runner({ binaries: { chrome: '/Applications/Google Chrome' } }), want),
    ).toThrow(/pinned CfT/);
    const otherProfile = [
      ...sealedWebExtArgs(SPKI).filter((a) => !a.startsWith('--user-data-dir=')),
      '--user-data-dir=/tmp/x',
    ];
    expect(() => assertDevRunnerSealed('chrome', runner({ chromiumArgs: otherProfile }), want)).toThrow(
      /sealed profile/,
    );
    expect(() => assertDevRunnerSealed('chrome', runner({ chromiumProfile: '/tmp/p' }), want)).toThrow(
      /chromiumProfile/,
    );
    expect(() =>
      assertDevRunnerSealed('chrome', runner({ chromiumArgs: [...sealedWebExtArgs(SPKI), '--proxy-server=x'] }), want),
    ).toThrow(/forbidden flag/);
    expect(() => assertDevRunnerSealed('chrome', runner(), { ...want, webExtArgs: null })).toThrow(/certificate/);
  });

  it('a disabled runner opens no browser, so there is nothing to check', () => {
    expect(() => assertDevRunnerSealed('firefox', { disabled: true }, want)).not.toThrow();
  });

  it('HEADLESS=1 dev gets the emulated owner screen (FID-8)', () => {
    expect(sealedWebExtArgs(SPKI, { headless: true })).toEqual(expect.arrayContaining([...HEADLESS_SCREEN_ARGS]));
    for (const a of HEADLESS_SCREEN_ARGS) expect(sealedWebExtArgs(SPKI)).not.toContain(a);
  });
});
