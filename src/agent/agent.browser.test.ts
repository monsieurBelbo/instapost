/**
 * B6 (strategy §7.11, §3.8, §3.9): the composer agent against the fake's real React 19
 * StoryComposer, in Chromium, without the extension. The agent controller runs over an in-memory
 * runtime; the composer is mounted with the post input beside it, as the msite shell does.
 *
 * - The probe finds the story input by its accept set and ignores the post input.
 * - The insert fires React's onChange and the canvas mounts (C6, `composer-ready`).
 * - `trusted=require` ignores the untrusted insert: no C6 within the deadline, `inject-unconfirmed` (AM28).
 * - `locale=es` and `drift=renamed` give identical results (no text, no class names).
 * - The agent's C8 read equals the fake's ground truth (`dataset.fakeGeometry`).
 *
 * Elements are found structurally only; this file never names the fake's test hooks (T3).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { strings } from '../../tools/fake-ig/client/i18n.ts';
import { StoryComposer } from '../../tools/fake-ig/client/StoryComposer.tsx';
import { CxContext, plainCx, renamedCx } from '../../tools/fake-ig/client/styles.ts';
import { DEFAULT_KNOBS, type Knobs, mergeKnobs, POST_ACCEPT, STORY_ACCEPT_LISTS } from '../../tools/fake-ig/knobs.ts';
import type { FakeGeometry } from '../../tools/fake-ig/protocol.ts';
import { FAKE_MARKER_META } from '../core/ig-contract/contract.ts';
import { bytesToB64 } from '../shared/b64.ts';
import type { AgentAck, AgentToBackground, ProbeReport } from '../shared/protocol.ts';
import { type AgentHandle, type AgentRuntime, startAgent } from './agent.ts';
import { type AgentWindow, findStoryInput } from './probes.ts';

const EXT = 'b6-extension-id';
const ADDR = { handoffId: 'hof_b6', nonce: 'nonce-b6' };

interface Mounted {
  root: Root;
  nodes: Element[];
}

let mounted: Mounted | null = null;
let agent: AgentHandle | null = null;

/** Renders the composer like the msite shell's composer route: head marker + UA JSON, post input, composer. */
function mount(patch: Partial<Knobs>): void {
  const knobs = mergeKnobs(DEFAULT_KNOBS, patch);
  const renamed = knobs.drift === 'renamed';
  const token = () => Math.random().toString(36).slice(2, 9);
  document.documentElement.lang = knobs.locale;
  const marker = document.createElement('meta');
  marker.name = FAKE_MARKER_META;
  marker.content = '1';
  const ua = document.createElement('script');
  ua.type = 'application/json';
  ua.setAttribute(renamed ? `data-${token()}` : 'data-ua', '');
  ua.textContent = JSON.stringify({
    InstagramUserAgent: { is_mobile: true, is_ios: false, is_android: true, is_ipad: false, is_android_tablet: false },
  });
  document.head.append(marker, ua);
  const host = document.createElement('div');
  host.id = renamed ? `r${token()}` : 'root';
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    createElement(
      CxContext.Provider,
      { value: renamed ? renamedCx() : plainCx },
      createElement('input', { type: 'file', accept: POST_ACCEPT, hidden: true }),
      createElement(StoryComposer, { knobs, t: strings(knobs.locale), inputMounted: true }),
    ),
  );
  mounted = { root, nodes: [marker, ua, host] };
}

/** The agent over an in-memory runtime that serves `png` to agent/get-file. */
function harness(png: Uint8Array) {
  const sent: AgentToBackground[] = [];
  let listener: Parameters<AgentRuntime['listen']>[0] | null = null;
  const runtime: AgentRuntime = {
    id: EXT,
    send: async (msg) => {
      sent.push(msg);
      return msg.type === 'agent/get-file'
        ? { ok: true, name: 'story.png', mime: 'image/png', b64: bytesToB64(png) }
        : { ok: true };
    },
    listen: (l) => {
      listener = l;
    },
  };
  agent = startAgent(window as unknown as AgentWindow, runtime);
  const command = (msg: Record<string, unknown>): AgentAck | undefined => {
    let ack: AgentAck | undefined;
    listener?.({ v: 1, ...ADDR, ...msg }, { id: EXT }, (a) => {
      ack = a;
    });
    return ack;
  };
  const reports = () => sent.flatMap((m) => (m.type === 'agent/report' ? [m.probe] : []));
  const events = () => sent.flatMap((m) => (m.type === 'agent/event' ? [m.event] : []));
  const probe = (): ProbeReport => {
    expect(command({ type: 'agent/probe' })).toEqual({ ok: true });
    const last = reports().at(-1);
    if (!last) throw new Error('no probe report');
    return last;
  };
  return { sent, command, events, probe };
}

/** A smooth 1080x1920 PNG, like an msite export. */
async function exportPng(): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(1080, 1920);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const g = ctx.createLinearGradient(0, 0, 1080, 1920);
  g.addColorStop(0, '#264653');
  g.addColorStop(1, '#e9c46a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1080, 1920);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

const truth = (): FakeGeometry | null => {
  const raw = document.documentElement.dataset.fakeGeometry;
  return raw ? (JSON.parse(raw) as FakeGeometry) : null;
};

const fileInputs = () => Array.from(document.querySelectorAll('input')).filter((i) => i.type === 'file');

const waitFor = <T>(fn: () => T) => vi.waitFor(fn, { timeout: 8000, interval: 50 });

afterEach(() => {
  agent?.watch.stop();
  agent = null;
  mounted?.root.unmount();
  for (const n of mounted?.nodes ?? []) n.remove();
  mounted = null;
  delete document.documentElement.dataset.fakeInput;
  delete document.documentElement.dataset.fakeGeometry;
  delete document.documentElement.dataset.fakeReady;
});

/** Probe, H1 insert, ready, probe again: what the background would see in one hand-off. */
async function h1Run(patch: Partial<Knobs>) {
  mount(patch);
  await waitFor(() => expect(fileInputs()).toHaveLength(2));
  const h = harness(await exportPng());
  const before = h.probe();
  h.command({ type: 'agent/watch', readyTimeoutMs: 10_000 });
  h.command({ type: 'agent/inject' });
  await waitFor(() => expect(h.events()).toContain('composer-ready'));
  const after = h.probe();
  return { h, before, after, events: h.events() };
}

describe('B6 composer agent against the fake StoryComposer', () => {
  test('the probe finds the story input by accept set and ignores the post input', async () => {
    mount({});
    await waitFor(() => expect(fileInputs()).toHaveLength(2));
    const story = findStoryInput(document);
    expect(story?.accept).toBe(STORY_ACCEPT_LISTS.default);
    expect(story).not.toBe(fileInputs()[0]);
    const report = harness(await exportPng()).probe();
    expect(report).toMatchObject({
      marker: true,
      isMobile: true,
      portrait: true,
      storyInput: 'present',
      acceptOk: true,
      acceptSeen: [POST_ACCEPT, STORY_ACCEPT_LISTS.default],
      lang: 'en',
    });
    expect(report.canvas).toBeUndefined();
  });

  test('accept=changed: a story candidate is present but the set differs (ACCEPT_DRIFT)', async () => {
    mount({ accept: 'changed' });
    await waitFor(() => expect(fileInputs()).toHaveLength(2));
    expect(findStoryInput(document)).toBeNull();
    expect(harness(await exportPng()).probe()).toMatchObject({ storyInput: 'present', acceptOk: false });
  });

  test('the insert fires React onChange, the canvas mounts, C8 equals dataset.fakeGeometry', async () => {
    const { h, after, events } = await h1Run({});
    expect(document.documentElement.dataset.fakeInput).toBe('accepted');
    expect(events).toEqual(['input-appeared', 'composer-ready']);
    expect(h.sent.filter((m) => m.type === 'agent/get-file')).toHaveLength(1);
    // One insert per handoffId: a repeated command does nothing.
    h.command({ type: 'agent/inject' });
    await new Promise((r) => setTimeout(r, 300));
    expect(h.sent.filter((m) => m.type === 'agent/get-file')).toHaveLength(1);

    const g = truth();
    if (!g) throw new Error('no fakeGeometry');
    expect(g.source).toEqual({ w: 1080, h: 1920 });
    expect(after.canvas).toEqual({ w: g.canvas.w, h: g.canvas.h, css: g.css });
    expect(after.inner).toEqual(g.inner);
    expect(after.dpr).toBe(g.dpr);
  });

  test('trusted=require: the untrusted insert is ignored; no C6 by the deadline → inject-unconfirmed', async () => {
    mount({ trusted: 'require' });
    await waitFor(() => expect(fileInputs()).toHaveLength(2));
    const h = harness(await exportPng());
    h.command({ type: 'agent/watch', readyTimeoutMs: 1500 });
    h.command({ type: 'agent/inject' });
    await waitFor(() => expect(h.events()).toContain('inject-unconfirmed'));
    expect(h.events()).not.toContain('inject-ignored');
    expect(document.documentElement.dataset.fakeInput).toBe('ignored-untrusted');
    expect(h.events()).not.toContain('composer-ready');
    expect(document.querySelector('canvas')).toBeNull();
    expect(h.probe().canvas).toBeUndefined();
  });

  test('locale=es and drift=renamed give identical results', async () => {
    const plain = await h1Run({});
    const sameEvents = plain.events;
    const plainBefore = plain.before;
    const plainAfter = plain.after;
    agent?.watch.stop();
    mounted?.root.unmount();
    for (const n of mounted?.nodes ?? []) n.remove();
    delete document.documentElement.dataset.fakeGeometry;

    const drifted = await h1Run({ locale: 'es', drift: 'renamed' });
    expect(drifted.events).toEqual(sameEvents);
    expect(drifted.before).toEqual({ ...plainBefore, lang: 'es' });
    expect(drifted.after).toEqual({ ...plainAfter, lang: 'es' });
  });
});
