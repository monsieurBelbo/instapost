/**
 * AM37: the two executeScript calls the background makes, as Chrome receives them. The portrait shim
 * goes into the MAIN world of the named tab's top frame only (`frameIds: [0]`), at once
 * (`injectImmediately`), as a self-contained `func` with `install` as its only argument, and its
 * page-world result is validated. The agent stays in the isolated world (no `world`), from its file.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { portraitShim } from '../agent/portrait-shim.ts';
import { injectPageScript, scripting } from './scripting.ts';

type Injection = Parameters<typeof fakeBrowser.scripting.executeScript>[0];

let calls: Injection[] = [];
let result: unknown;

beforeEach(() => {
  calls = [];
  result = undefined;
  vi.spyOn(fakeBrowser.scripting, 'executeScript').mockImplementation((async (injection: Injection) => {
    calls.push(injection);
    return [{ frameId: 0, documentId: 'd', result }];
  }) as unknown as typeof fakeBrowser.scripting.executeScript);
});

describe('AM37 scripting: the portrait shim and the agent', () => {
  it('the shim: MAIN world, the named tab’s top frame only, immediately, the shim function with `install`', async () => {
    result = { type: 'portrait-primary', shim: 'installed' };
    await expect(scripting.injectPortraitShim(42, true)).resolves.toEqual({
      type: 'portrait-primary',
      shim: 'installed',
    });
    expect(calls).toEqual([
      {
        target: { tabId: 42, frameIds: [0] },
        world: 'MAIN',
        injectImmediately: true,
        func: portraitShim,
        args: [true],
      },
    ]);
    await scripting.injectPortraitShim(42, false);
    expect((calls[1] as { args?: unknown[] } | undefined)?.args).toEqual([false]);
    // Never every frame, never another tab than the one named.
    for (const c of calls) {
      expect(c.target).toEqual({ tabId: 42, frameIds: [0] });
      expect((c.target as { allFrames?: boolean }).allFrames).toBeUndefined();
    }
  });

  it('the page-world result is untrusted: anything malformed reads `failed` with no type', async () => {
    for (const bad of [
      undefined,
      null,
      'portrait-primary',
      { type: 'portrait-primary' },
      { type: 'portrait-primary', shim: 'yes' },
      { type: 'Portrait<b>', shim: 'installed' },
      { type: 'x'.repeat(33), shim: 'installed' },
      { type: 7, shim: 'present' },
    ]) {
      result = bad;
      await expect(scripting.injectPortraitShim(42, true)).resolves.toEqual({ type: null, shim: 'failed' });
    }
    result = { type: null, shim: 'absent', extra: 'dropped' };
    await expect(scripting.injectPortraitShim(42, true)).resolves.toEqual({ type: null, shim: 'absent' });
  });

  it('the agent: the isolated world (no `world`), from its packaged file, top frame only', async () => {
    result = true;
    await expect(scripting.injectComposerAgent(42)).resolves.toEqual({ fresh: true, documentId: 'd' });
    result = false;
    await expect(scripting.injectComposerAgent(42)).resolves.toEqual({ fresh: false, documentId: 'd' });
    expect(calls[0]).toEqual({ target: { tabId: 42, frameIds: [0] }, files: ['/composer-agent.js'] });
    for (const c of calls) expect('world' in c).toBe(false);
  });

  it('docs/inpage.md §3.11: both go into one named frame (the engine frame) and nowhere else', async () => {
    result = { type: 'portrait-primary', shim: 'installed' };
    await scripting.injectPortraitShim(42, true, 9);
    result = true;
    await scripting.injectComposerAgent(42, 9);
    expect(calls.map((c) => c.target)).toEqual([
      { tabId: 42, frameIds: [9] },
      { tabId: 42, frameIds: [9] },
    ]);
    expect((calls[0] as { world?: string }).world).toBe('MAIN');
    expect('world' in (calls[1] as object)).toBe(false);
  });
});

describe('FX14 the in-page content script, re-injected after an install or update', () => {
  it('its packaged file, the isolated world, the named tab’s top frame only', async () => {
    await injectPageScript(42);
    expect(calls).toEqual([{ target: { tabId: 42, frameIds: [0] }, files: ['/instagram-page.js'] }]);
    expect('world' in (calls[0] as object)).toBe(false);
  });
});
