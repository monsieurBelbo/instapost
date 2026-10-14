/**
 * Composer agent controller, in node against a hand-rolled window (the browser tests mount real DOM: B6 the
 * fake's StoryComposer, B11 to B14 the autopilot's fixtures). Covers the messaging contract the background
 * relies on (ux.md §10, IA6): every command acked, the hand-off pinned, one open-entry, insert and Share per
 * handoffId, nothing driven once Finish by hand began; the probe's IA5 fields (account, entry, activation,
 * visibility); the watch (input-appeared, account-appeared, controllerchange, restart re-reports); P3, the
 * service-worker interception tripwire, in the probe and in the watch.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STORY_ACCEPT } from '../core/ig-contract/contract.ts';
import { bytesToB64 } from '../shared/b64.ts';
import type { AgentAck, AgentToBackground } from '../shared/protocol.ts';
import { type AgentRuntime, startAgent } from './agent.ts';
import { type AgentWindow, navigationIntercepted, resourceIntercepted, swInterception } from './probes.ts';
import { WATCH_TICK_MS } from './watch.ts';

interface FakeInput {
  type: string;
  accept: string;
  files: unknown;
  events: string[];
  isConnected: boolean;
  parentElement: null;
  closest(sel: string): null;
  dispatchEvent(e: Event): boolean;
}

interface FakeCanvas {
  width: number;
  height: number;
  css: { x: number; y: number; w: number; h: number };
  getBoundingClientRect(): object;
  checkVisibility(): boolean;
}

/** An account link as readAccount reads it (closest, getAttribute, querySelector). */
interface FakeLink {
  href: string;
  nav: boolean;
  article: boolean;
  avatar: boolean;
}

const input = (accept: string): FakeInput => ({
  type: 'file',
  accept,
  files: null,
  events: [],
  isConnected: true,
  parentElement: null,
  closest: () => null,
  dispatchEvent(e) {
    this.events.push(`${e.type}:${e.bubbles && e.composed ? 'bubbling' : 'flat'}`);
    return true;
  },
});

const canvas = (w: number, h: number, css: FakeCanvas['css']): FakeCanvas => ({
  width: w,
  height: h,
  css,
  getBoundingClientRect() {
    const { x, y, w: cw, h: ch } = this.css;
    return { x, y, width: cw, height: ch, left: x, top: y, right: x + cw, bottom: y + ch };
  },
  checkVisibility: () => true,
});

const linkEl = (l: FakeLink) => ({
  getAttribute: (name: string) => (name === 'href' ? l.href : null),
  querySelector: (sel: string) => (sel === 'img, svg' && l.avatar ? {} : null),
  closest: (sel: string) => {
    if (sel === 'article') return l.article ? {} : null;
    if (sel.startsWith('nav')) return l.nav ? {} : null;
    return null;
  },
});

/** P3: a PerformanceObserver the test can feed entries to (null: the window has none). */
type ObserverCallback = (list: { getEntries(): unknown[] }) => void;

function fakeWindow(opts: { observer?: boolean } = {}) {
  let t = 0;
  const observers: { cb: ObserverCallback; options: unknown; connected: boolean }[] = [];
  class FakePerformanceObserver {
    readonly slot: { cb: ObserverCallback; options: unknown; connected: boolean };
    constructor(cb: ObserverCallback) {
      this.slot = { cb, options: null, connected: false };
      observers.push(this.slot);
    }
    observe(options: unknown) {
      this.slot.options = options;
      this.slot.connected = true;
    }
    disconnect() {
      this.slot.connected = false;
    }
  }
  let seq = 0;
  /** Intervals and timeouts on one fake clock (`every: 0` is a timeout). */
  const timers = new Map<number, { fn: () => void; every: number; next: number }>();
  const swListeners: (() => void)[] = [];
  const docListeners: { type: string; fn: (e: unknown) => void }[] = [];
  const page = {
    inputs: [] as FakeInput[],
    canvases: [] as FakeCanvas[],
    scripts: [] as { textContent: string }[],
    links: [] as FakeLink[],
    marker: true,
    visibility: 'visible' as 'visible' | 'hidden',
    activation: { isActive: false, hasBeenActive: false },
    /** P3: the performance timeline (the navigation entry, then resources); null = not readable. */
    navigation: [{ name: 'https://www.instagram.com/', type: 'reload', workerStart: 0 }] as
      | { name: string; type: string; workerStart: number }[]
      | null,
    resources: [] as { name: string; workerStart: number }[],
  };
  class FakeDataTransfer {
    readonly list: unknown[] = [];
    readonly items = { add: (f: unknown) => void this.list.push(f) };
    get files() {
      return this.list;
    }
  }
  const win = {
    innerWidth: 511,
    innerHeight: 909,
    devicePixelRatio: 2,
    location: { pathname: '/' },
    navigator: {
      serviceWorker: { controller: null, addEventListener: (_: string, l: () => void) => void swListeners.push(l) },
      get userActivation() {
        return page.activation;
      },
    },
    performance: {
      now: () => t,
      getEntriesByType(type: string) {
        if (page.navigation === null) throw new Error('no timeline');
        return type === 'navigation' ? page.navigation : type === 'resource' ? page.resources : [];
      },
    },
    setInterval: (fn: () => void, ms: number) => {
      timers.set(++seq, { fn, every: ms, next: t + ms });
      return seq;
    },
    clearInterval: (id: number) => void timers.delete(id),
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(++seq, { fn, every: 0, next: t + Math.max(0, ms) });
      return seq;
    },
    clearTimeout: (id: number) => void timers.delete(id),
    AbortController,
    File,
    Event,
    DataTransfer: FakeDataTransfer,
    ...(opts.observer ? { PerformanceObserver: FakePerformanceObserver } : {}),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: {
      documentElement: { lang: 'es' },
      get visibilityState() {
        return page.visibility;
      },
      querySelectorAll(sel: string) {
        if (sel === 'input') return page.inputs;
        if (sel === 'canvas') return page.canvases;
        if (sel.startsWith('script')) return page.scripts;
        if (sel === 'a[href]') return page.links.map(linkEl);
        return [];
      },
      querySelector: (sel: string) =>
        sel.startsWith('meta[name="instapost-fake-instagram"]') && page.marker ? {} : null,
      addEventListener(type: string, fn: (e: unknown) => void, o?: { signal?: AbortSignal }) {
        const entry = { type, fn };
        docListeners.push(entry);
        o?.signal?.addEventListener('abort', () => {
          const i = docListeners.indexOf(entry);
          if (i >= 0) docListeners.splice(i, 1);
        });
      },
      removeEventListener() {},
    },
  };
  return {
    win: win as unknown as AgentWindow,
    raw: win,
    page,
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, x]) => x.next <= end).sort((a, b) => a[1].next - b[1].next)[0];
        if (!due) break;
        const [id, x] = due;
        t = x.next;
        if (x.every > 0) x.next += x.every;
        else timers.delete(id);
        x.fn();
      }
      t = end;
    },
    controllerChange: () => {
      for (const l of swListeners) l();
    },
    /** Fires a document event at the listeners registered for it. */
    fire: (type: string, e: unknown = {}) => {
      for (const l of docListeners.filter((x) => x.type === type)) l.fn(e);
    },
    docListeners,
    /** Delivers resource entries to the connected observers (entries past a full timeline buffer). */
    observe: (entries: { name: string; workerStart: number }[]) => {
      for (const o of observers) if (o.connected) o.cb({ getEntries: () => entries });
    },
    observers,
  };
}

const EXT = 'jehchapoghccaofddgdkakdkjijmknhk';
const ADDR = { handoffId: 'hof_1', nonce: 'n-1' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function harness(opts: { observer?: boolean } = {}) {
  const w = fakeWindow(opts);
  const sent: AgentToBackground[] = [];
  const fileReply: unknown = { ok: true, name: 'story.png', mime: 'image/png', b64: bytesToB64(PNG) };
  let listener: Parameters<AgentRuntime['listen']>[0] | null = null;
  const runtime: AgentRuntime = {
    id: EXT,
    send: async (msg) => {
      sent.push(msg);
      return msg.type === 'agent/get-file' ? fileReply : { ok: true };
    },
    listen: (l) => {
      listener = l;
    },
  };
  const agent = startAgent(w.win, runtime);
  const command = (msg: Record<string, unknown>, senderId = EXT): AgentAck | undefined => {
    let ack: AgentAck | undefined;
    listener?.({ v: 1, ...ADDR, ...msg }, { id: senderId }, (a) => {
      ack = a;
    });
    return ack;
  };
  const events = () => sent.filter((m) => m.type === 'agent/event').map((m) => (m as { event: string }).event);
  const facts = () => sent.flatMap((m) => (m.type === 'agent/fact' ? [m.fact] : []));
  return { ...w, agent, sent, command, events, facts };
}

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
  h.page.scripts.push({ textContent: 'not this one' });
  h.page.scripts.push({ textContent: '{"InstagramUserAgent":{"is_ios":false,"is_mobile":true}}' });
  h.page.inputs.push(input('image/jpeg,image/png,video/mp4,video/quicktime')); // the post input
  h.page.inputs.push(input(STORY_ACCEPT.join(',')));
});

/** The composer canvas: 9:16 filling the viewport. */
const composerCanvas = () => canvas(1022, 1818, { x: 0, y: 0, w: 511, h: 909 });
const profile = (over: Partial<FakeLink> = {}): FakeLink => ({
  href: '/testuser/',
  nav: true,
  article: false,
  avatar: true,
  ...over,
});

describe('agent commands', () => {
  it('acks every valid command and reports the probe with the pinned address (IA5 fields included)', () => {
    expect(h.command({ type: 'agent/probe' })).toEqual({ ok: true });
    expect(h.sent).toEqual([
      {
        v: 1,
        type: 'agent/report',
        ...ADDR,
        probe: {
          marker: true,
          isMobile: true,
          inner: { w: 511, h: 909 },
          dpr: 2,
          portrait: true,
          swControlled: false,
          swIntercepted: false,
          navType: 'reload',
          storyInput: 'present',
          acceptOk: true,
          acceptSeen: ['image/jpeg,image/png,video/mp4,video/quicktime', 'image/avif,image/jpeg,image/png'],
          lang: 'es',
          activation: { isActive: false, hasBeenActive: false },
          visibility: 'visible',
          account: { handle: null, candidates: 0 },
          entryFound: false,
        },
      },
    ]);
  });

  it('refuses commands for another hand-off, malformed ones, and ignores other senders', () => {
    h.command({ type: 'agent/probe' });
    expect(h.command({ type: 'agent/probe', nonce: 'other' })).toEqual({ ok: false });
    expect(h.command({ type: 'agent/probe', handoffId: 'hof_2' })).toEqual({ ok: false });
    expect(h.command({ type: 'agent/inject' })).toEqual({ ok: false });
    expect(h.command({ type: 'agent/drive', step: 'tap-anything' })).toEqual({ ok: false });
    expect(h.command({ type: 'agent/observe', from: 'page' })).toEqual({ ok: false });
    expect(h.command({ type: 'agent/probe' }, 'another-extension')).toBeUndefined();
    expect(h.sent).toHaveLength(1);
  });

  it('reports accept drift and a missing input structurally', () => {
    h.page.inputs[1] = input('image/avif,image/heic,image/jpeg,image/png');
    h.command({ type: 'agent/probe' });
    expect(h.sent.at(-1)).toMatchObject({ probe: { storyInput: 'present', acceptOk: false } });
    h.page.inputs.splice(1, 1);
    h.command({ type: 'agent/probe' });
    expect(h.sent.at(-1)).toMatchObject({ probe: { storyInput: 'absent', acceptOk: false } });
  });

  it('reports C8 for the largest visible canvas', () => {
    h.page.canvases.push(canvas(10, 10, { x: 0, y: 0, w: 10, h: 10 }), composerCanvas());
    h.command({ type: 'agent/probe' });
    expect(h.sent.at(-1)).toMatchObject({
      probe: { canvas: { w: 1022, h: 1818, css: { x: 0, y: 0, w: 511, h: 909 } } },
    });
  });

  it('IA5: reports the account link, the owner’s activation and a hidden page', () => {
    h.page.links.push(profile(), profile({ href: '/explore/' }), profile({ href: '/other/', article: true }));
    h.page.activation = { isActive: true, hasBeenActive: true };
    h.page.visibility = 'hidden';
    h.command({ type: 'agent/probe' });
    expect(h.sent.at(-1)).toMatchObject({
      probe: {
        account: { handle: 'testuser', candidates: 1 },
        activation: { isActive: true, hasBeenActive: true },
        visibility: 'hidden',
      },
    });
  });

  it('C14: two different handles in the navigation are unreadable, never a guess', () => {
    h.page.links.push(profile(), profile({ href: '/someone_else/' }));
    h.command({ type: 'agent/probe' });
    expect(h.sent.at(-1)).toMatchObject({ probe: { account: { handle: null, candidates: 2 } } });
  });
});

describe('IA6: one step per hand-off, and none after Finish by hand', () => {
  it('open-entry without a + beside the input reports ENTRY_MISSING once, whatever the background sends', async () => {
    h.command({ type: 'agent/drive', step: 'open-entry', fingerprint: null });
    h.command({ type: 'agent/drive', step: 'open-entry', fingerprint: null });
    await flush();
    const entries = h.facts().filter((f) => f.kind === 'entry');
    expect(entries).toEqual([expect.objectContaining({ kind: 'entry', result: 'ENTRY_MISSING', plusTaps: 0 })]);
  });

  it('insert without an armed input fails at once and never asks for the file', async () => {
    h.command({ type: 'agent/drive', step: 'insert' });
    h.command({ type: 'agent/drive', step: 'insert' });
    await flush();
    expect(h.facts()).toEqual([{ kind: 'insert-failed', why: 'not-armed' }]);
    expect(h.sent.filter((m) => m.type === 'agent/get-file')).toHaveLength(0);
    expect(h.page.inputs[1]?.events).toEqual([]);
  });

  it('Share on a composer without one Share control is refused, once, and nothing is tapped', async () => {
    h.raw.location.pathname = '/create/story/';
    h.page.canvases.push(composerCanvas());
    h.command({ type: 'agent/drive', step: 'share' });
    h.command({ type: 'agent/drive', step: 'share' });
    await flush();
    expect(h.facts()).toEqual([{ kind: 'share-refused', why: 'controls' }]);
  });

  it('Share away from the composer is refused as not-composer', async () => {
    h.command({ type: 'agent/drive', step: 'share' });
    await flush();
    expect(h.facts()).toEqual([{ kind: 'share-refused', why: 'not-composer' }]);
  });

  it('after agent/observe the agent only observes: drive commands are acked and ignored', async () => {
    expect(h.command({ type: 'agent/observe', from: 'manual' })).toEqual({ ok: true });
    expect(h.command({ type: 'agent/drive', step: 'insert' })).toEqual({ ok: true });
    expect(h.command({ type: 'agent/drive', step: 'share' })).toEqual({ ok: true });
    await flush();
    expect(h.facts()).toEqual([]);
    // It watches for the owner's own click (capture, once) and runs the watch.
    expect(h.docListeners.filter((l) => l.type === 'click')).toHaveLength(1);
    expect(h.agent.watch.running()).toBe(true);
  });

  it('an untrusted click, or one outside a Share control, is not the owner’s Share', async () => {
    h.command({ type: 'agent/observe', from: 'manual' });
    h.fire('click', { target: {}, isTrusted: false });
    await flush();
    h.fire('click', { target: {}, isTrusted: true });
    await flush();
    expect(h.facts().filter((f) => f.kind === 'owner-share')).toEqual([]);
    // It keeps watching after each one.
    expect(h.docListeners.filter((l) => l.type === 'click')).toHaveLength(1);
  });

  it('a visibility change is reported as a fact once a hand-off is pinned', () => {
    h.page.visibility = 'hidden';
    h.fire('visibilitychange');
    expect(h.facts()).toEqual([]);
    h.command({ type: 'agent/probe' });
    h.fire('visibilitychange');
    h.page.visibility = 'visible';
    h.fire('visibilitychange');
    expect(h.facts()).toEqual([
      { kind: 'visibility', hidden: true },
      { kind: 'visibility', hidden: false },
    ]);
  });
});

describe('watch', () => {
  it('reports the story input and the account once per run; a restart re-reports the current state', () => {
    h.command({ type: 'agent/watch' });
    expect(h.events()).toEqual(['input-appeared']);
    h.page.links.push(profile());
    h.advance(WATCH_TICK_MS);
    h.advance(5000);
    expect(h.events()).toEqual(['input-appeared', 'account-appeared']);
    h.command({ type: 'agent/watch' });
    expect(h.events()).toEqual(['input-appeared', 'account-appeared', 'input-appeared', 'account-appeared']);
  });

  it('msite mounts its header after hydration: the input is reported when it appears', () => {
    const story = h.page.inputs.splice(1, 1);
    h.command({ type: 'agent/watch' });
    h.advance(1000);
    expect(h.events()).toEqual([]);
    h.page.inputs.push(...story);
    h.advance(WATCH_TICK_MS);
    expect(h.events()).toEqual(['input-appeared']);
  });

  it('a post input alone never counts as the story input', () => {
    h.page.inputs.splice(1, 1);
    h.command({ type: 'agent/watch' });
    h.advance(2000);
    expect(h.events()).not.toContain('input-appeared');
  });

  it('a drive command starts the watch when it is not running', () => {
    expect(h.agent.watch.running()).toBe(false);
    h.command({ type: 'agent/drive', step: 'insert' });
    expect(h.agent.watch.running()).toBe(true);
  });

  it('reports a service worker taking control', () => {
    h.command({ type: 'agent/watch' });
    h.controllerChange();
    expect(h.events()).toContain('sw-controller-change');
  });

  it('remembers a controller change before the watch and reports it on start', () => {
    h.command({ type: 'agent/probe' });
    h.controllerChange();
    expect(h.events()).toEqual([]);
    h.command({ type: 'agent/watch' });
    expect(h.events()).toContain('sw-controller-change');
  });

  it('P2: each controllerchange is reported once, never again on a restart (the record counts them)', () => {
    h.command({ type: 'agent/watch' });
    h.controllerChange();
    h.command({ type: 'agent/watch' });
    h.controllerChange();
    h.advance(1000);
    expect(h.events().filter((e) => e === 'sw-controller-change')).toHaveLength(2);
  });
});

describe('P3: the service-worker interception tripwire', () => {
  it('a controlled page whose worker has no fetch handler (workerStart 0 everywhere) is not intercepted', () => {
    h.page.resources.push(
      { name: 'https://www.instagram.com/api/graphql', workerStart: 0 },
      { name: 'https://scontent.cdninstagram.com/x.jpg', workerStart: 0 },
    );
    h.command({ type: 'agent/probe' });
    expect(h.sent.at(-1)).toMatchObject({ probe: { swIntercepted: false, navType: 'reload' } });
  });

  it('a www or i.instagram.com resource a worker handled is intercepted; CDN hosts are not rule hosts', () => {
    expect(resourceIntercepted({ name: 'https://www.instagram.com/api/graphql', workerStart: 12.5 })).toBe(true);
    expect(resourceIntercepted({ name: 'https://i.instagram.com/api/v1/x', workerStart: 1 })).toBe(true);
    expect(resourceIntercepted({ name: 'https://WWW.Instagram.com:443/x', workerStart: 1 })).toBe(true);
    expect(resourceIntercepted({ name: 'https://scontent.cdninstagram.com/x.jpg', workerStart: 3 })).toBe(false);
    expect(resourceIntercepted({ name: 'https://www.instagram.com.evil.test/x', workerStart: 3 })).toBe(false);
    expect(resourceIntercepted({ name: 'https://www.instagram.com/x', workerStart: 0 })).toBe(false);
    h.page.resources.push({ name: 'https://www.instagram.com/api/graphql', workerStart: 40 });
    h.command({ type: 'agent/probe' });
    expect(h.sent.at(-1)).toMatchObject({ probe: { swIntercepted: true } });
  });

  it('the navigation entry counts only when it was not a reload', () => {
    expect(navigationIntercepted({ name: 'x', type: 'navigate', workerStart: 5 })).toBe(true);
    expect(navigationIntercepted({ name: 'x', type: 'reload', workerStart: 5 })).toBe(false);
    expect(navigationIntercepted({ name: 'x', type: 'navigate', workerStart: 0 })).toBe(false);
    h.page.navigation = [{ name: 'https://www.instagram.com/', type: 'navigate', workerStart: 7 }];
    expect(swInterception(h.win)).toEqual({ swIntercepted: true, navType: 'navigate' });
  });

  it('an unreadable timeline is unknown, never a pass', () => {
    h.page.navigation = null;
    h.command({ type: 'agent/probe' });
    expect(h.sent.at(-1)).toMatchObject({ probe: { swIntercepted: 'unknown', navType: 'unknown' } });
  });

  it('the watch reports a request a worker handled after the probe (a late claim), once per run', () => {
    h.command({ type: 'agent/watch' });
    h.page.resources.push({ name: 'https://www.instagram.com/api/graphql', workerStart: 0 });
    h.advance(1000);
    expect(h.events()).not.toContain('sw-intercepted');
    h.page.resources.push({ name: 'https://www.instagram.com/ajax/bz', workerStart: 22 });
    h.advance(WATCH_TICK_MS);
    h.advance(1000);
    expect(h.events().filter((e) => e === 'sw-intercepted')).toHaveLength(1);
  });

  it('past the 250-entry timeline buffer: the observer (from the agent’s start, buffered) still catches it', () => {
    const o = harness({ observer: true });
    // The watch's tripwire observer first, then the request observer (net.ts), both buffered.
    expect(o.observers).toHaveLength(2);
    expect(o.observers.map((x) => x.options)).toEqual([
      { type: 'resource', buffered: true },
      { type: 'resource', buffered: true },
    ]);
    // The page's buffer is full: getEntriesByType never shows the late request; the observer does.
    for (let i = 0; i < 250; i++) o.page.resources.push({ name: `https://www.instagram.com/r${i}`, workerStart: 0 });
    o.command({ type: 'agent/probe' });
    expect(o.sent.at(-1)).toMatchObject({ probe: { swIntercepted: false } });
    o.observe([
      { name: 'https://scontent.cdninstagram.com/x.jpg', workerStart: 4 },
      { name: 'https://www.instagram.com/ajax/bz', workerStart: 18 },
    ]);
    // The probe reports what the observer saw ...
    o.command({ type: 'agent/probe' });
    expect(o.sent.at(-1)).toMatchObject({ probe: { swIntercepted: true } });
    // ... and so does the watch, once per run; the tripwire's observer is done.
    o.command({ type: 'agent/watch' });
    o.advance(WATCH_TICK_MS);
    expect(o.events().filter((e) => e === 'sw-intercepted')).toHaveLength(1);
    expect(o.observers[0]?.connected).toBe(false);
  });

  it('CDN entries and workerStart 0 seen by the observer are not interception', () => {
    const o = harness({ observer: true });
    o.observe([
      { name: 'https://scontent.cdninstagram.com/x.jpg', workerStart: 4 },
      { name: 'https://www.instagram.com/api/graphql', workerStart: 0 },
    ]);
    o.command({ type: 'agent/watch' });
    o.advance(1000);
    expect(o.events()).not.toContain('sw-intercepted');
    o.command({ type: 'agent/probe' });
    expect(o.sent.at(-1)).toMatchObject({ probe: { swIntercepted: false } });
  });

  it('a page that clears its resource timings is scanned again from the start', () => {
    h.command({ type: 'agent/watch' });
    h.page.resources.push(
      { name: 'https://www.instagram.com/a', workerStart: 0 },
      { name: 'https://www.instagram.com/b', workerStart: 0 },
    );
    h.advance(WATCH_TICK_MS);
    h.page.resources.length = 0;
    h.page.resources.push({ name: 'https://www.instagram.com/c', workerStart: 9 });
    h.advance(WATCH_TICK_MS);
    expect(h.events()).toContain('sw-intercepted');
  });
});
