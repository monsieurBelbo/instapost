/**
 * B13 (ux.md §10, C12, IA3): the compose watch and Share against a DOM fixture of Instagram's story
 * composer (canvas._aa3c, header._aa3d, the trash footer._aa3k, the Share footer v1 or v2). The watch
 * reports once the photo is drawn and the Share footer has been quiet for 1.5 s (capped at 8 s from the
 * first footer; here scaled down), at once for the rotate snackbar, and what it has at its deadline. Share
 * re-checks the composer and taps the one control, once.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { COMPOSE_MS, share, watchCompose } from './drive.ts';
import {
  agentWindow,
  type ComposerOpts,
  type ComposerParts,
  driveDeps,
  type FakeLocation,
  mountComposer,
  wait,
} from './ig-fixture.browser-helper.ts';
import { composerState } from './locators.ts';
import type { ShareToken } from './tap.ts';

const SCALE = 0.05;
const TOKEN: ShareToken = { share: true, handoffId: 'hof_b13' };

let host: HTMLElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

function composer(opts: ComposerOpts = {}): { parts: ComposerParts; location: FakeLocation } {
  host = document.createElement('div');
  host.setAttribute('style', 'position:fixed;inset:0');
  document.body.append(host);
  const location: FakeLocation = { pathname: '/create/story/' };
  return { parts: mountComposer(host, location, opts), location };
}

describe('B13 C12: the composer as it is now', () => {
  it('v1: one Share button; the trash footer never counts', async () => {
    const { location } = composer({ footer: 'v1' });
    await wait(30);
    const st = composerState(agentWindow(location));
    expect(st).toMatchObject({ onComposer: true, drawn: true, header: true, landscape: false, footers: 1 });
    expect(st.controls).toHaveLength(1);
    expect(st.variant).toBe('v1');
    expect(st.fbAuto).toBe(false);
  });

  it('v2: the avatar control; the badge glyph means Instagram also shares to Facebook', async () => {
    const { location } = composer({ footer: 'v2' });
    await wait(30);
    expect(composerState(agentWindow(location))).toMatchObject({ variant: 'v2', fbAuto: true });
    host?.remove();
    const plain = composer({ footer: 'v2plain' });
    await wait(30);
    expect(composerState(agentWindow(plain.location))).toMatchObject({ variant: 'v2', fbAuto: false });
  });

  it('before the photo is drawn the canvas has no backing store', () => {
    const { location } = composer({ drawAfterMs: null });
    expect(composerState(agentWindow(location))).toMatchObject({ drawn: false });
  });

  it('two Share footers: no footer, two controls (ambiguous)', async () => {
    const { location } = composer({ footer: 'two' });
    await wait(30);
    const st = composerState(agentWindow(location));
    expect(st.footer).toBeNull();
    expect(st.controls).toHaveLength(2);
    expect(st.variant).toBeNull();
  });
});

describe('B13 the compose watch', () => {
  it('reports once the footer has been quiet: v1, drawn, settled, with the canvas size', async () => {
    const { location } = composer({ footer: 'v1' });
    const f = await watchCompose(driveDeps(agentWindow(location), SCALE), null);
    expect(f).toMatchObject({
      kind: 'compose',
      onComposer: true,
      drawn: true,
      landscape: false,
      controls: 1,
      variant: 'v1',
      fbAuto: false,
      settled: true,
      canvas: { w: 1080, h: 1920 },
      imageScore: null,
    });
    expect(f.settleMs).toBeGreaterThanOrEqual(COMPOSE_MS.quiet * SCALE);
  });

  it('v1 that switches to v2 after a GraphQL answer: the watch reports v2 (the quiet period restarts)', async () => {
    const { location } = composer({ footer: 'v1-then-v2', switchAfterMs: 40 });
    const f = await watchCompose(driveDeps(agentWindow(location), SCALE), null);
    expect(f).toMatchObject({ variant: 'v2', fbAuto: true, controls: 1, settled: true });
  });

  it('a footer that keeps changing is reported at the cap', async () => {
    const { location } = composer({ footer: 'flapping' });
    const f = await watchCompose(driveDeps(agentWindow(location), SCALE), null);
    expect(f.settled).toBe(true);
    expect(f.settleMs).toBeGreaterThanOrEqual(COMPOSE_MS.cap * SCALE);
    expect(f.settleMs).toBeLessThan(COMPOSE_MS.deadline * SCALE);
  });

  it('the rotate snackbar is reported at once (landscape, no Share)', async () => {
    const { location } = composer({ landscape: true });
    const f = await watchCompose(driveDeps(agentWindow(location), SCALE), null);
    expect(f).toMatchObject({ landscape: true, controls: 0 });
    expect(f.settleMs).toBeLessThan(COMPOSE_MS.quiet * SCALE);
  });

  it('nothing drawn by the deadline: reported as it is, not settled', async () => {
    const { location } = composer({ drawAfterMs: null });
    const f = await watchCompose(driveDeps(agentWindow(location), SCALE), null);
    expect(f).toMatchObject({ drawn: false, settled: false, canvas: null });
  });

  it('the image check scores the drawn canvas (IA7, diagnostics)', async () => {
    const { location } = composer({ footer: 'v1' });
    const f = await watchCompose(driveDeps(agentWindow(location), SCALE), async (c) => (c.width === 1080 ? 0.9 : 0));
    expect(f.imageScore).toBe(0.9);
  });
});

describe('B13 Share, once', () => {
  it('taps the one Share control inside its footer; the request clock starts right before the tap', async () => {
    const { parts, location } = composer({ footer: 'v1' });
    await wait(30);
    const d = driveDeps(agentWindow(location), SCALE);
    const starts: number[] = [];
    const r = await share(d, TOKEN, (t0) => starts.push(t0));
    expect(r.ok).toBe(true);
    expect(starts).toHaveLength(1);
    expect(parts.shareClicks).toEqual([false]);
    // Never a second Share in this hand-off.
    await wait(10);
    location.pathname = '/create/story/';
    expect(await share(d, TOKEN, () => undefined)).toEqual({ ok: false, why: 'refused' });
    expect(parts.shareClicks).toHaveLength(1);
  });

  it('refuses, pressing nothing, when the composer is not as the compose facts said', async () => {
    const cases: [ComposerOpts, string][] = [
      [{ footer: 'two' }, 'controls'],
      [{ footer: 'none' }, 'controls'],
      [{ landscape: true }, 'landscape'],
      [{ drawAfterMs: null }, 'not-drawn'],
    ];
    for (const [opts, why] of cases) {
      const { parts, location } = composer(opts);
      await wait(30);
      expect(await share(driveDeps(agentWindow(location), SCALE), TOKEN, () => undefined)).toEqual({ ok: false, why });
      expect(parts.shareClicks).toEqual([]);
      host?.remove();
    }
    const { location } = composer({ footer: 'v1' });
    location.pathname = '/';
    expect(await share(driveDeps(agentWindow(location), SCALE), TOKEN, () => undefined)).toEqual({
      ok: false,
      why: 'not-composer',
    });
  });

  it('a hidden page is never tapped', async () => {
    const { parts, location } = composer({ footer: 'v1' });
    await wait(30);
    const hidden = agentWindow(location, { visibility: () => 'hidden' });
    expect(await share(driveDeps(hidden, 0.001), TOKEN, () => undefined)).toEqual({ ok: false, why: 'hidden' });
    expect(parts.shareClicks).toEqual([]);
  });
});
