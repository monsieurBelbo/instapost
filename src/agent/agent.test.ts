/**
 * Composer agent controller, in node against a hand-rolled window (not B6: B6 mounts the fake's
 * real React components in a browser). Covers the messaging contract the background relies on:
 * every command acked, the hand-off pinned, one insert per handoffId, the 10 s ready deadline,
 * the watch re-reporting on restart, C9 and controllerchange; AM24 (a canvas ready before the
 * watch, or before an H1 insert, never counts) and AM18 (the watch survives composer-left).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STORY_ACCEPT } from '../core/ig-contract/contract.ts';
import { bytesToB64 } from '../shared/b64.ts';
import type { AgentAck, AgentToBackground } from '../shared/protocol.ts';
import { type AgentRuntime, startAgent } from './agent.ts';
import type { AgentWindow } from './probes.ts';
import { WATCH_TICK_MS } from './watch.ts';

interface FakeInput {
  type: string;
  accept: string;
  files: unknown;
  events: string[];
  dispatchEvent(e: Event): boolean;
}

interface FakeCanvas {
  width: number;
  height: number;
  css: { x: number; y: number; w: number; h: number };
  getBoundingClientRect(): object;
  checkVisibility(): boolean;
}

const input = (accept: string): FakeInput => ({
  type: 'file',
  accept,
  files: null,
  events: [],
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

function fakeWindow() {
  let t = 0;
  let seq = 0;
  const intervals = new Map<number, { fn: () => void; ms: number; next: number }>();
  const swListeners: (() => void)[] = [];
  const page = {
    inputs: [] as FakeInput[],
    canvases: [] as FakeCanvas[],
    scripts: [] as { textContent: string }[],
    marker: true,
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
    location: { pathname: '/create/story/' },
    navigator: {
      serviceWorker: { controller: null, addEventListener: (_: string, l: () => void) => void swListeners.push(l) },
    },
    performance: { now: () => t },
    setInterval: (fn: () => void, ms: number) => {
      intervals.set(++seq, { fn, ms, next: t + ms });
      return seq;
    },
    clearInterval: (id: number) => void intervals.delete(id),
    File,
    Event,
    DataTransfer: FakeDataTransfer,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: {
      documentElement: { lang: 'es' },
      querySelectorAll(sel: string) {
        if (sel === 'input') return page.inputs;
        if (sel === 'canvas') return page.canvases;
        if (sel.startsWith('script')) return page.scripts;
        return [];
      },
      querySelector: (sel: string) =>
        sel.startsWith('meta[name="instapost-fake-instagram"]') && page.marker ? {} : null,
    },
  };
  return {
    win: win as unknown as AgentWindow,
    raw: win,
    page,
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...intervals.values()].filter((i) => i.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        t = due.next;
        due.next += due.ms;
        due.fn();
      }
      t = end;
    },
    controllerChange: () => {
      for (const l of swListeners) l();
    },
  };
}

const EXT = 'jehchapoghccaofddgdkakdkjijmknhk';
const ADDR = { handoffId: 'hof_1', nonce: 'n-1' };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const flush = () => new Promise((r) => setTimeout(r, 0));

function harness() {
  const w = fakeWindow();
  const sent: AgentToBackground[] = [];
  let fileReply: unknown = { ok: true, name: 'story.png', mime: 'image/png', b64: bytesToB64(PNG) };
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
  startAgent(w.win, runtime);
  const command = (msg: Record<string, unknown>, senderId = EXT): AgentAck | undefined => {
    let ack: AgentAck | undefined;
    listener?.({ v: 1, ...ADDR, ...msg }, { id: senderId }, (a) => {
      ack = a;
    });
    return ack;
  };
  const events = () => sent.filter((m) => m.type === 'agent/event').map((m) => (m as { event: string }).event);
  return {
    ...w,
    sent,
    command,
    events,
    setFileReply: (r: unknown) => {
      fileReply = r;
    },
  };
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

describe('agent commands', () => {
  it('acks every valid command and reports the probe with the pinned address', () => {
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
          storyInput: 'present',
          acceptOk: true,
          acceptSeen: ['image/jpeg,image/png,video/mp4,video/quicktime', 'image/avif,image/jpeg,image/png'],
          lang: 'es',
        },
      },
    ]);
  });

  it('refuses commands for another hand-off, malformed ones, and ignores other senders', () => {
    h.command({ type: 'agent/probe' });
    expect(h.command({ type: 'agent/probe', nonce: 'other' })).toEqual({ ok: false });
    expect(h.command({ type: 'agent/probe', handoffId: 'hof_2' })).toEqual({ ok: false });
    expect(h.command({ type: 'agent/watch' })).toEqual({ ok: false });
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
});

describe('H1 insert', () => {
  it('assigns the file once per handoffId and dispatches input, then change (AM3)', async () => {
    h.command({ type: 'agent/probe' });
    h.command({ type: 'agent/watch', readyTimeoutMs: 10_000 });
    h.command({ type: 'agent/inject' });
    h.command({ type: 'agent/inject' });
    await flush();
    expect(h.sent.filter((m) => m.type === 'agent/get-file')).toHaveLength(1);
    const story = h.page.inputs[1];
    expect(story?.events).toEqual(['input:bubbling', 'change:bubbling']);
    const files = story?.files as File[];
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('story.png');
    expect(files[0]?.type).toBe('image/png');
    expect(new Uint8Array(await (files[0] as File).arrayBuffer())).toEqual(PNG);
    expect(h.page.inputs[0]?.events).toEqual([]); // never the post input
  });

  it('reports composer-ready when C6 holds within the deadline', async () => {
    h.command({ type: 'agent/watch', readyTimeoutMs: 10_000 });
    h.command({ type: 'agent/inject' });
    await flush();
    h.advance(3000);
    h.page.canvases.push(composerCanvas());
    h.advance(20_000);
    expect(h.events()).toEqual(['input-appeared', 'composer-ready']);
  });

  it('AM28: reports inject-unconfirmed once when C6 does not hold within 10 s of a dispatched insert', async () => {
    h.command({ type: 'agent/watch', readyTimeoutMs: 10_000 });
    h.command({ type: 'agent/inject' });
    await flush();
    h.advance(10_000 - WATCH_TICK_MS);
    expect(h.events()).toEqual(['input-appeared']);
    h.advance(WATCH_TICK_MS);
    h.advance(60_000);
    // The insert was dispatched: the file may be in the composer, so this is not inject-ignored.
    expect(h.events()).toEqual(['input-appeared', 'inject-unconfirmed']);
  });

  it('a refused file is inject-ignored at once, with no insert', async () => {
    h.setFileReply({ ok: false });
    h.command({ type: 'agent/watch', readyTimeoutMs: 10_000 });
    h.command({ type: 'agent/inject' });
    await flush();
    expect(h.events()).toEqual(['input-appeared', 'inject-ignored']);
    expect(h.page.inputs[1]?.events).toEqual([]);
  });

  it('a C6 canvas below half the viewport is not ready', async () => {
    h.page.canvases.push(canvas(720, 1280, { x: 75, y: 134, w: 360, h: 640 })); // 49.6 % of 511x909
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    h.advance(5000);
    expect(h.events()).toEqual(['input-appeared']);
  });
});

describe('watch', () => {
  it('a restart re-reports the current state at once', () => {
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    h.page.canvases.push(composerCanvas());
    h.advance(WATCH_TICK_MS);
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    expect(h.events()).toEqual(['input-appeared', 'composer-ready', 'composer-ready', 'input-appeared']);
  });

  it('AM24: a canvas already ready when the watch first starts never counts; a new one does', () => {
    const preview = composerCanvas(); // e.g. a camera preview drawn before any file was chosen
    h.page.canvases.push(preview);
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    h.advance(5000);
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 }); // a later restart keeps the document's baseline
    h.advance(5000);
    expect(h.events()).not.toContain('composer-ready');
    h.page.canvases.push(composerCanvas()); // the owner's picked photo
    h.advance(WATCH_TICK_MS);
    expect(h.events()).toContain('composer-ready');
  });

  it('AM24: a pre-existing canvas that goes away and comes back counts', () => {
    const c = composerCanvas();
    h.page.canvases.push(c);
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    h.page.canvases.length = 0;
    h.advance(WATCH_TICK_MS);
    h.page.canvases.push(c);
    h.advance(WATCH_TICK_MS);
    expect(h.events()).toContain('composer-ready');
  });

  it('AM24: in an H1 run, composer-ready waits for the insert', async () => {
    h.page.inputs.splice(1, 1); // no story input: the insert fails
    h.command({ type: 'agent/watch', readyTimeoutMs: 10_000 });
    h.page.canvases.push(composerCanvas()); // a canvas shows up on its own before the insert
    h.advance(1000);
    expect(h.events()).not.toContain('composer-ready');
    h.command({ type: 'agent/inject' });
    await flush();
    h.advance(1000);
    expect(h.events()).toEqual(['inject-ignored']);
    // H0 afterwards (a new run without a deadline) reports it.
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    expect(h.events()).toEqual(['inject-ignored', 'composer-ready']);
  });

  it('AM18: after composer-left the watch keeps running; a pick back on the composer is reported', () => {
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    h.raw.location.pathname = '/'; // a client-side redirect home before anything was picked
    h.advance(WATCH_TICK_MS);
    expect(h.events().filter((e) => e === 'composer-left')).toHaveLength(1);
    h.advance(5000);
    expect(h.events().filter((e) => e === 'composer-left')).toHaveLength(1); // no repeats while home
    h.raw.location.pathname = '/create/story/'; // + → Story
    h.page.canvases.push(composerCanvas());
    h.advance(WATCH_TICK_MS);
    expect(h.events()).toContain('composer-ready');
    h.raw.location.pathname = '/'; // Share
    h.advance(WATCH_TICK_MS);
    expect(h.events().filter((e) => e === 'composer-left')).toHaveLength(2);
  });

  it('C9: the path leaving /create/story after being on it', () => {
    h.raw.location.pathname = '/';
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    h.advance(1000);
    expect(h.events()).not.toContain('composer-left'); // homeOnly: never on the composer yet
    h.raw.location.pathname = '/create/story/';
    h.advance(1000);
    h.raw.location.pathname = '/';
    h.advance(WATCH_TICK_MS);
    expect(h.events().filter((e) => e === 'composer-left')).toHaveLength(1);
  });

  it('C9: the ready canvas gone for more than 2 s', () => {
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    h.page.canvases.push(composerCanvas());
    h.advance(WATCH_TICK_MS);
    h.page.canvases.length = 0;
    h.advance(2000);
    expect(h.events()).not.toContain('composer-left');
    h.advance(2 * WATCH_TICK_MS);
    expect(h.events()).toContain('composer-left');
  });

  it('reports a service worker taking control', () => {
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    h.controllerChange();
    expect(h.events()).toContain('sw-controller-change');
  });

  it('remembers a controller change before the watch and reports it on start', () => {
    h.command({ type: 'agent/probe' });
    h.controllerChange();
    expect(h.events()).toEqual([]);
    h.command({ type: 'agent/watch', readyTimeoutMs: 0 });
    expect(h.events()).toContain('sw-controller-change');
  });
});
