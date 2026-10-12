/**
 * U17 (strategy §7.11, §7.4, SG1, SG10): the one flags builder for every sealed browser.
 */
import { describe, expect, it } from 'vitest';
import {
  assertSealed,
  DEV_PROFILE_DIR,
  HEADLESS_SCREEN_ARGS,
  RESOLVER_RULES,
  sealedArgs,
  sealedPlaywrightArgs,
  sealedWebExtArgs,
} from './flags.ts';

/** A syntactically valid SHA-256 SPKI hash (base64, 44 chars). */
const SPKI = 'XkaYKe8PH05Phbfpk5bkd3MoKvR+rP39ZG8ssIhF/s8=';
const EXT = '/tmp/instapost/.output/chrome-mv3-mock';

const builders: Record<string, string[]> = {
  sealedArgs: sealedArgs(SPKI),
  sealedWebExtArgs: sealedWebExtArgs(SPKI),
  sealedPlaywrightArgs: sealedPlaywrightArgs(SPKI, EXT),
  'sealedPlaywrightArgs headless': sealedPlaywrightArgs(SPKI, EXT, { headless: true }),
  'sealedWebExtArgs headless': sealedWebExtArgs(SPKI, { headless: true }),
};

const without = (args: string[], flag: string) => args.filter((a) => a !== flag && !a.startsWith(`${flag}=`));

describe('U17 sealed browser arguments', () => {
  for (const [name, args] of Object.entries(builders)) {
    it(`${name}: no argument contains a quote, and the args pass assertSealed`, () => {
      for (const a of args) expect(a, a).not.toMatch(/["'`]/);
      expect(() => assertSealed(args)).not.toThrow();
    });
  }

  it('maps only the two fake hosts, then everything else to NOTFOUND, with loopback excluded', () => {
    expect(RESOLVER_RULES.split(',')).toEqual([
      'MAP www.instagram.com 127.0.0.1:8443',
      'MAP i.instagram.com 127.0.0.1:8443',
      'MAP * ~NOTFOUND',
      'EXCLUDE localhost',
      'EXCLUDE 127.0.0.1',
    ]);
  });

  it('Playwright args never carry --user-data-dir; web-ext args carry exactly the dev profile', () => {
    for (const args of [sealedPlaywrightArgs(SPKI, EXT), sealedPlaywrightArgs(SPKI, EXT, { headless: true })]) {
      expect(args.some((a) => a.startsWith('--user-data-dir'))).toBe(false);
      expect(args).toContain(`--load-extension=${EXT}`);
      expect(args).toContain(`--disable-extensions-except=${EXT}`);
    }
    expect(sealedWebExtArgs(SPKI).filter((a) => a.startsWith('--user-data-dir='))).toEqual([
      `--user-data-dir=${DEV_PROFILE_DIR}`,
    ]);
  });

  it('adds the emulated owner screen only for headless Playwright runs (S8)', () => {
    expect(sealedPlaywrightArgs(SPKI, EXT, { headless: true })).toEqual(
      expect.arrayContaining([...HEADLESS_SCREEN_ARGS]),
    );
    for (const a of HEADLESS_SCREEN_ARGS) expect(sealedPlaywrightArgs(SPKI, EXT)).not.toContain(a);
  });

  it('rejects a missing --no-proxy-server or --disable-quic', () => {
    expect(() => assertSealed(without(sealedArgs(SPKI), '--no-proxy-server'))).toThrow(/--no-proxy-server/);
    expect(() => assertSealed(without(sealedArgs(SPKI), '--disable-quic'))).toThrow(/--disable-quic/);
  });

  it('rejects a different, missing or repeated resolver rule string', () => {
    const base = without(sealedArgs(SPKI), '--host-resolver-rules');
    expect(() => assertSealed(base)).toThrow(/exactly one --host-resolver-rules/);
    expect(() => assertSealed([...base, '--host-resolver-rules=MAP * 127.0.0.1'])).toThrow(/resolver rules/);
    const dropped = RESOLVER_RULES.replace(',MAP * ~NOTFOUND', '');
    expect(() => assertSealed([...base, `--host-resolver-rules=${dropped}`])).toThrow(/resolver rules/);
    expect(() => assertSealed([...sealedArgs(SPKI), `--host-resolver-rules=${RESOLVER_RULES}`])).toThrow(/exactly one/);
  });

  it('rejects added proxy, host-rules and blanket certificate flags', () => {
    for (const flag of [
      '--proxy-server=http://127.0.0.1:8080',
      '--proxy-pac-url=http://127.0.0.1/p.pac',
      '--proxy-auto-detect',
      '--proxy-bypass-list=*',
      '--host-rules=MAP * 127.0.0.1',
      '--ignore-certificate-errors',
    ]) {
      expect(() => assertSealed([...sealedArgs(SPKI), flag]), flag).toThrow(/forbidden flag/);
    }
  });

  it('rejects a quoted argument and an SPKI list that is not exactly one hash', () => {
    expect(() => assertSealed([...sealedArgs(SPKI), '--lang="en"'])).toThrow(/quote/);
    const base = without(sealedArgs(SPKI), '--ignore-certificate-errors-spki-list');
    expect(() => assertSealed(base)).toThrow(/spki-list/);
    expect(() => assertSealed([...base, `--ignore-certificate-errors-spki-list=${SPKI},${SPKI}`])).toThrow(/SPKI/);
    expect(() => assertSealed([...base, '--ignore-certificate-errors-spki-list=not-a-hash'])).toThrow(/SPKI/);
  });
});
