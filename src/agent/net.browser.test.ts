/**
 * B12 (ux.md §6.2, IA4): the evidence after Share, in Chromium. A PerformanceObserver (`buffered`) runs from
 * the agent's start; once Share is clicked, every XHR/fetch entry that starts after the click is reported in
 * batches every 250 ms, with a heartbeat (`elapsedMs`) every 2 s, plus Instagram's progress, a new toast and
 * going home. Entries carry the host class, the path without its query, the status, the content type,
 * whether they were redirected and their offsets from the click. The agent classifies nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { NetEntry } from '../core/handoff/state.ts';
import { agentWindow, type FakeLocation, wait } from './ig-fixture.browser-helper.ts';
import { createNetReporter, NET_HEARTBEAT_MS, NET_TICK_MS, toNet } from './net.ts';

type Ui = { progressSeen: boolean; toast: 'none' | 'plain' | 'action'; wentHome: boolean };

const added: Element[] = [];
afterEach(() => {
  for (const el of added.splice(0)) el.remove();
});

function reporter(location: FakeLocation = { pathname: '/create/story/' }) {
  const batches: { entries: NetEntry[]; elapsedMs: number }[] = [];
  const ui: Ui[] = [];
  const r = createNetReporter(
    agentWindow(location),
    { net: (entries, elapsedMs) => batches.push({ entries, elapsedMs }), ui: (u) => ui.push({ ...u }) },
    () => performance.now(),
  );
  return { r, batches, ui, location, entries: () => batches.flatMap((b) => b.entries) };
}

const ownUrl = (q: string) => `${new URL(import.meta.url).pathname}?${q}`;

describe('B12 toNet: one entry as the background gets it', () => {
  it('host class, path without query, status, type, redirect, offsets', () => {
    const e = toNet(
      {
        name: 'https://i.instagram.com/rupload_igphoto/fb_uploader_17603?x=1#y',
        initiatorType: 'xmlhttprequest',
        startTime: 1100.4,
        responseEnd: 2500.6,
        responseStatus: 200,
        contentType: 'application/json',
        redirectStart: 0,
        redirectEnd: 0,
      },
      1000,
    );
    expect(e).toEqual({
      host: 'i',
      path: '/rupload_igphoto/fb_uploader_17603',
      status: 200,
      type: 'application/json',
      redirected: false,
      start: 100,
      end: 1501,
    });
    expect(
      toNet({ name: 'https://www.instagram.com/api/v1/media/configure_to_story/', startTime: 0, responseEnd: 0 }, 0),
    ).toMatchObject({ host: 'www', status: 0, type: '', redirected: false });
    expect(
      toNet({ name: 'https://www.instagram.com/x', startTime: 0, responseEnd: 0, redirectEnd: 5 }, 0).redirected,
    ).toBe(true);
    expect(toNet({ name: 'https://evil.test/www.instagram.com/', startTime: 0, responseEnd: 0 }, 0).host).toBe('other');
    expect(toNet({ name: 'https://x.test/', startTime: 0, responseEnd: 0, responseStatus: 999 }, 0).status).toBe(0);
  });
});

describe('B12 the reporter', () => {
  it('reports the requests that start after the click, never earlier ones, with their real status', async () => {
    const n = reporter();
    await fetch(ownUrl('before=1'));
    await wait(50);
    const t0 = performance.now();
    n.r.start(t0);
    await fetch(location.href);
    await fetch('/__b12_missing__?q=1', { method: 'POST' }).catch(() => undefined);
    await wait(NET_TICK_MS * 3);
    n.r.stop();
    const seen = n.entries();
    expect(seen).toHaveLength(2);
    for (const e of seen) {
      expect(e.host).toBe('other');
      expect(e.start).toBeGreaterThanOrEqual(0);
      expect(e.end).toBeGreaterThanOrEqual(e.start);
      expect(e.redirected).toBe(false);
    }
    // In the order they ended (an entry is added when its response is complete).
    const page = seen.find((e) => e.path === location.pathname);
    const missing = seen.find((e) => e.path === '/__b12_missing__');
    expect(page).toMatchObject({ status: 200, type: expect.stringContaining('text/html') });
    expect(missing).toMatchObject({ status: 404 });
  });

  it('sends a heartbeat with the elapsed time even when nothing new ended', async () => {
    const n = reporter();
    n.r.start(performance.now());
    await wait(NET_HEARTBEAT_MS + NET_TICK_MS * 2);
    n.r.stop();
    const beats = n.batches.filter((b) => b.entries.length === 0);
    expect(beats.length).toBeGreaterThanOrEqual(1);
    expect(beats.at(-1)?.elapsedMs).toBeGreaterThanOrEqual(NET_HEARTBEAT_MS);
  });

  it('corroboration: Instagram’s progress, a toast with an action, going home', async () => {
    const n = reporter();
    const old = document.createElement('div');
    old.setAttribute('role', 'alert');
    document.body.append(old);
    added.push(old);
    n.r.start(performance.now());
    await wait(NET_TICK_MS * 2);
    expect(n.ui).toEqual([]); // a toast from before the click never counts
    const progress = document.createElement('div');
    progress.setAttribute('role', 'progressbar');
    document.body.append(progress);
    added.push(progress);
    await wait(NET_TICK_MS * 2);
    const toast = document.createElement('div');
    toast.setAttribute('role', 'alert');
    toast.append(document.createElement('button'));
    document.body.append(toast);
    added.push(toast);
    n.location.pathname = '/';
    await wait(NET_TICK_MS * 2);
    n.r.stop();
    expect(n.ui.at(-1)).toEqual({ progressSeen: true, toast: 'action', wentHome: true });
    expect(n.ui[0]).toMatchObject({ progressSeen: true });
  });

  it('a re-based start (the owner’s own Share click) drops what came before it', async () => {
    const n = reporter();
    n.r.start(performance.now());
    await fetch(ownUrl('early=1'));
    await wait(NET_TICK_MS * 2);
    const early = n.entries().length;
    n.r.start(performance.now());
    await fetch(ownUrl('late=1'));
    await wait(NET_TICK_MS * 2);
    n.r.stop();
    expect(early).toBeGreaterThanOrEqual(1);
    expect(n.entries().length).toBe(early + 1);
  });
});
