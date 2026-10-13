/**
 * P3 (2026-10-12) in a real Chromium: the tripwire's signal. A page controlled by a service worker
 * WITHOUT a fetch handler (Instagram's root worker, F2) keeps `workerStart` at 0 on its requests; a
 * worker WITH one makes it > 0. Each fixture worker lives in its own directory (its scope), and a
 * same-origin iframe there is the controlled client. Localhost only (the sealed browser allows it).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import { navigationIntercepted } from './probes.ts';

const BASE = '/src/agent/__fixtures__';
const frames: HTMLIFrameElement[] = [];
const registrations: ServiceWorkerRegistration[] = [];

afterEach(async () => {
  for (const f of frames.splice(0)) f.remove();
  for (const r of registrations.splice(0)) await r.unregister();
});

async function activeWorker(dir: string): Promise<void> {
  const reg = await navigator.serviceWorker.register(`${BASE}/${dir}/sw.js`, { scope: `${BASE}/${dir}/` });
  registrations.push(reg);
  await vi.waitFor(() => expect(reg.active?.state).toBe('activated'), { timeout: 8000, interval: 50 });
}

async function controlledFrame(dir: string): Promise<Window> {
  const f = document.createElement('iframe');
  frames.push(f);
  const loaded = new Promise((r) => f.addEventListener('load', r, { once: true }));
  f.src = `${BASE}/${dir}/page.html`;
  document.body.append(f);
  await loaded;
  const w = f.contentWindow;
  if (!w) throw new Error('no frame window');
  await vi.waitFor(() => expect(w.navigator.serviceWorker.controller).not.toBeNull(), { timeout: 8000 });
  return w;
}

/** workerStart of a fresh same-origin request made by the controlled page. */
async function requestWorkerStart(w: Window, dir: string): Promise<number> {
  const url = new URL(`${BASE}/${dir}/page.html?r=${Math.random().toString(36).slice(2)}`, location.href).href;
  await (w as Window & typeof globalThis).fetch(url);
  let entry: PerformanceResourceTiming | undefined;
  await vi.waitFor(() => {
    entry = (w.performance.getEntriesByType('resource') as PerformanceResourceTiming[]).find((e) => e.name === url);
    expect(entry).toBeDefined();
  });
  return entry?.workerStart ?? -1;
}

describe('P3: workerStart as the interception tripwire, in Chromium', () => {
  test('a worker without a fetch handler controls the page but never handles its requests', async () => {
    await activeWorker('sw-nofetch');
    const w = await controlledFrame('sw-nofetch');
    expect(w.navigator.serviceWorker.controller).not.toBeNull();
    expect(await requestWorkerStart(w, 'sw-nofetch')).toBe(0);
    const nav = w.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    expect(nav?.workerStart).toBe(0);
    expect(nav && navigationIntercepted(nav)).toBe(false);
  });

  test('a worker with a fetch handler handles them: workerStart > 0', async () => {
    await activeWorker('sw-fetch');
    const w = await controlledFrame('sw-fetch');
    expect(await requestWorkerStart(w, 'sw-fetch')).toBeGreaterThan(0);
    // The iframe's own navigation went through the worker too (not a reload).
    const nav = w.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    expect(nav?.type).toBe('navigate');
    expect(nav && navigationIntercepted(nav)).toBe(true);
  });

  test('a full timeline buffer hides a later entry from getEntriesByType, not from a PerformanceObserver', async () => {
    // Why the watch observes (watch.ts): Instagram can fill the page's 250-entry buffer, after which
    // the scan of getEntriesByType('resource') goes blind. The agent never resizes the page's buffer;
    // this test does, only to make the buffer full.
    await activeWorker('sw-fetch');
    const w = (await controlledFrame('sw-fetch')) as Window & typeof globalThis;
    const seen: { name: string; workerStart: number }[] = [];
    new w.PerformanceObserver((list: PerformanceObserverEntryList) => {
      for (const e of list.getEntries())
        seen.push({ name: e.name, workerStart: (e as PerformanceResourceTiming).workerStart });
    }).observe({ type: 'resource', buffered: true });
    w.performance.setResourceTimingBufferSize(w.performance.getEntriesByType('resource').length);
    const url = new URL(`${BASE}/sw-fetch/page.html?late=${Math.random().toString(36).slice(2)}`, location.href).href;
    await (await w.fetch(url)).text();
    await vi.waitFor(() => expect(seen.find((e) => e.name === url)?.workerStart).toBeGreaterThan(0), { timeout: 4000 });
    expect(w.performance.getEntriesByName(url)).toHaveLength(0);
  });
});
