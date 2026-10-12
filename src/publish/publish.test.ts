/**
 * Publishers (strategy §7.10): download naming and URL lifetime, share outcomes, the minimal
 * lane picker, and the hand-off port client (message shapes, validation, reconnects).
 */
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { Frame } from '../core/model/story.ts';
import type { DownloadsPort } from '../platform/downloads.ts';
import type { BackgroundToEditor, HandoffStatusMsg } from '../shared/protocol.ts';
import { baseName, downloadBlob, type ObjectUrls, storyFilename } from './download.ts';
import { laneFor } from './lane.ts';
import { createHandoffClient, type PortLike } from './msite.ts';
import { canShareFiles, type ShareNavigator, shareFiles } from './share.ts';

// ---- download ----------------------------------------------------------------------------

function fakeDownloads(opts: { failStart?: boolean } = {}) {
  let finish: ((ok: boolean) => void) | null = null;
  const calls: { url: string; filename: string }[] = [];
  const port: DownloadsPort = {
    async download(url, filename) {
      if (opts.failStart) throw new Error('downloads disabled');
      calls.push({ url, filename });
      return 17;
    },
    whenComplete: () =>
      new Promise<void>((resolve, reject) => {
        finish = (ok) => (ok ? resolve() : reject(new Error('interrupted')));
      }),
    filename: async () => '/Users/x/Downloads/instapost/a.jpg',
    show: () => undefined,
  };
  const urls = { created: 0, revoked: [] as string[] };
  const objectUrls: ObjectUrls = {
    create: () => `blob:fake/${++urls.created}`,
    revoke: (u) => urls.revoked.push(u),
  };
  return { port, calls, urls, objectUrls, finish: (ok: boolean) => finish?.(ok) };
}

describe('download', () => {
  test('storyFilename is instapost/<yyyy-mm-dd_HHMMss>_story.<ext> in local time', () => {
    expect(storyFilename(new Date(2026, 9, 11, 9, 5, 7), 'jpg')).toBe('instapost/2026-10-11_090507_story.jpg');
    expect(storyFilename(new Date(2026, 0, 2, 23, 59, 0), 'png')).toBe('instapost/2026-01-02_235900_story.png');
  });

  test('baseName handles both separators', () => {
    expect(baseName('/Users/me/Downloads/instapost/x (1).png')).toBe('x (1).png');
    expect(baseName('C:\\Users\\me\\Downloads\\instapost\\x.png')).toBe('x.png');
    expect(baseName('x.png')).toBe('x.png');
  });

  test('revokes the object URL only after completion', async () => {
    const f = fakeDownloads();
    const started = await downloadBlob(new Blob(['x']), 'instapost/a.jpg', f.port, f.objectUrls);
    expect(started.downloadId).toBe(17);
    expect(f.calls).toEqual([{ url: 'blob:fake/1', filename: 'instapost/a.jpg' }]);
    expect(f.urls.revoked).toEqual([]);
    f.finish(true);
    await started.done;
    expect(f.urls.revoked).toEqual(['blob:fake/1']);
  });

  test('revokes on interruption and rejects done', async () => {
    const f = fakeDownloads();
    const started = await downloadBlob(new Blob(['x']), 'instapost/a.jpg', f.port, f.objectUrls);
    f.finish(false);
    await expect(started.done).rejects.toThrow('interrupted');
    expect(f.urls.revoked).toEqual(['blob:fake/1']);
  });

  test('revokes immediately when the download cannot start', async () => {
    const f = fakeDownloads({ failStart: true });
    await expect(downloadBlob(new Blob(['x']), 'instapost/a.jpg', f.port, f.objectUrls)).rejects.toThrow('disabled');
    expect(f.urls.revoked).toEqual(['blob:fake/1']);
  });
});

// ---- share -------------------------------------------------------------------------------

describe('share', () => {
  const file = new File(['x'], 'story.jpg', { type: 'image/jpeg' });

  test('unsupported without the API or when canShare refuses', async () => {
    expect(canShareFiles([file], undefined)).toBe(false);
    expect(canShareFiles([file], {})).toBe(false);
    const refuses: ShareNavigator = { canShare: () => false, share: async () => undefined };
    expect(await shareFiles([file], {}, refuses)).toBe('unsupported');
  });

  test('shares the files with the metadata', async () => {
    const share = vi.fn(async (_d?: ShareData) => undefined);
    const n: ShareNavigator = { canShare: () => true, share };
    expect(await shareFiles([file], { title: 'Story' }, n)).toBe('shared');
    expect(share).toHaveBeenCalledWith({ files: [file], title: 'Story' });
  });

  test('maps AbortError and NotAllowedError, rethrows the rest', async () => {
    const failing = (name: string): ShareNavigator => ({
      canShare: () => true,
      share: async () => {
        throw Object.assign(new Error(name), { name });
      },
    });
    expect(await shareFiles([file], {}, failing('AbortError'))).toBe('cancelled');
    expect(await shareFiles([file], {}, failing('NotAllowedError'))).toBe('not-allowed');
    await expect(shareFiles([file], {}, failing('DataError'))).rejects.toThrow('DataError');
  });
});

// ---- lane --------------------------------------------------------------------------------

describe('lane', () => {
  const photo: Frame = {
    id: 'frm_1',
    durationMs: null,
    background: { kind: 'solid', color: '#000000' },
    layers: [],
    audience: 'all',
  };

  test('a plain photo frame may go to the desktop lane', () => {
    expect(laneFor(photo)).toEqual({ desktop: true, reasons: [] });
  });

  test('music, stickers, Close Friends and video force the phone lane', () => {
    const music = { ...photo, musicPlan: { title: 'Song' } };
    expect(laneFor(music)).toEqual({ desktop: false, reasons: ['music'] });
    const placeholder = (purpose: 'music' | 'poll' | 'other') => ({
      kind: 'placeholder' as const,
      id: `lyr_${purpose}`,
      purpose,
      rect: { x: 0, y: 0, w: 10, h: 10 },
      label: purpose,
    });
    expect(laneFor({ ...photo, layers: [placeholder('music')] }).reasons).toEqual(['music']);
    expect(laneFor({ ...photo, layers: [placeholder('poll')] }).reasons).toEqual(['stickers']);
    expect(laneFor({ ...photo, layers: [placeholder('other')] }).desktop).toBe(true);
    expect(laneFor({ ...photo, audience: 'closeFriends' }).reasons).toEqual(['closeFriends']);
    expect(laneFor({ ...photo, durationMs: 5000 }).reasons).toEqual(['video']);
    expect(laneFor({ ...music, audience: 'closeFriends', durationMs: 1000 }).reasons).toEqual([
      'video',
      'music',
      'closeFriends',
    ]);
  });
});

// ---- msite hand-off port client ------------------------------------------------------------

class FakePort implements PortLike {
  sent: unknown[] = [];
  disconnected = false;
  throwOnPost = false;
  private msgL: ((m: unknown) => void)[] = [];
  private discL: (() => void)[] = [];
  postMessage(m: unknown) {
    if (this.throwOnPost) throw new Error('Attempting to use a disconnected port object');
    this.sent.push(m);
  }
  disconnect() {
    this.disconnected = true;
  }
  onMessage = { addListener: (cb: (m: unknown) => void) => void this.msgL.push(cb) };
  onDisconnect = { addListener: (cb: () => void) => void this.discL.push(cb) };
  emit(m: unknown) {
    for (const l of this.msgL) l(m);
  }
  drop() {
    for (const l of this.discL) l();
  }
}

/** Structural stand-in for the protocol guard (src/shared/protocol.ts is another stream's). */
const isStatus = (x: unknown): x is BackgroundToEditor =>
  typeof x === 'object' &&
  x !== null &&
  (x as { v?: unknown }).v === 1 &&
  (x as { type?: unknown }).type === 'handoff/status';

const status = (phase: HandoffStatusMsg['phase'], extra: Partial<HandoffStatusMsg> = {}): HandoffStatusMsg => ({
  v: 1,
  type: 'handoff/status',
  handoffId: 'hof_1',
  phase,
  level: null,
  ...extra,
});

function harness(isMessage: (x: unknown) => x is BackgroundToEditor = isStatus) {
  const ports: FakePort[] = [];
  const logs: string[] = [];
  const client = createHandoffClient({
    connect: () => {
      const p = new FakePort();
      ports.push(p);
      return p;
    },
    isMessage,
    reconnectMs: 100,
    maxReconnectMs: 400,
    log: (m) => logs.push(m),
  });
  return { client, ports, logs };
}

const screen = { availLeft: 0, availTop: 33, availWidth: 1512, availHeight: 949 };

describe('msite hand-off client', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('start, cancel and outcome post v:1 messages on one port', () => {
    const { client, ports } = harness();
    client.start({ exportId: 'exp_1', mode: 'post', rehearsal: true, screen });
    client.cancel();
    client.outcome('hof_1', true);
    expect(ports).toHaveLength(1);
    expect(ports[0]?.sent).toEqual([
      { v: 1, type: 'handoff/start', exportId: 'exp_1', mode: 'post', rehearsal: true, screen },
      { v: 1, type: 'handoff/cancel' },
      { v: 1, type: 'handoff/outcome', handoffId: 'hof_1', posted: true },
    ]);
  });

  test('probe mode sends exportId null', () => {
    const { client, ports } = harness();
    client.start({ exportId: null, mode: 'probe', rehearsal: true, screen });
    expect(ports[0]?.sent[0]).toMatchObject({ type: 'handoff/start', exportId: null, mode: 'probe' });
  });

  test('statuses reach listeners only after validation', () => {
    const { client, ports, logs } = harness();
    const seen: string[] = [];
    client.onStatus((s) => seen.push(s.phase));
    ports[0]?.emit(status('opening'));
    ports[0]?.emit({ v: 2, type: 'handoff/status', phase: 'probing' });
    ports[0]?.emit('nonsense');
    ports[0]?.emit(status('probing'));
    expect(seen).toEqual(['opening', 'probing']);
    expect(logs.filter((l) => l.includes('malformed'))).toHaveLength(2);
  });

  test('a throwing guard drops the message instead of crashing', () => {
    const throwing = (_x: unknown): _x is BackgroundToEditor => {
      throw new Error('NOT_IMPLEMENTED: isBackgroundToEditor');
    };
    const { client, ports, logs } = harness(throwing);
    const seen: unknown[] = [];
    client.onStatus((s) => seen.push(s));
    expect(() => ports[0]?.emit(status('opening'))).not.toThrow();
    expect(seen).toEqual([]);
    expect(logs[0]).toContain('guard failed');
  });

  test('reconnects with backoff while a hand-off is active', () => {
    vi.useFakeTimers();
    const { client, ports } = harness();
    const conn: boolean[] = [];
    client.onConnection((c) => conn.push(c));
    const seen: string[] = [];
    client.onStatus((s) => seen.push(s.phase));
    client.start({ exportId: 'exp_1', mode: 'post', rehearsal: true, screen });
    ports[0]?.emit(status('probing'));
    ports[0]?.drop();
    expect(ports).toHaveLength(1);
    vi.advanceTimersByTime(99);
    expect(ports).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(ports).toHaveLength(2);
    // A drop before the new port delivered anything: the delay doubled.
    ports[1]?.drop();
    vi.advanceTimersByTime(199);
    expect(ports).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(ports).toHaveLength(3);
    // The live port delivers; dead ones are ignored. A delivered status resets the backoff.
    ports[0]?.emit(status('awaitingShare'));
    ports[2]?.emit(status('awaitingPick'));
    expect(seen).toEqual(['probing', 'awaitingPick']);
    ports[2]?.drop();
    vi.advanceTimersByTime(100);
    expect(ports).toHaveLength(4);
    expect(conn).toEqual([true, false, true, false, true, false, true]);
  });

  test('stays disconnected while idle and reconnects lazily on the next send', () => {
    vi.useFakeTimers();
    const { client, ports } = harness();
    client.onStatus(() => undefined);
    ports[0]?.emit(status('idle'));
    ports[0]?.drop();
    vi.advanceTimersByTime(10_000);
    expect(ports).toHaveLength(1);
    client.start({ exportId: null, mode: 'probe', rehearsal: true, screen });
    expect(ports).toHaveLength(2);
    expect(ports[1]?.sent).toHaveLength(1);
  });

  test('a silently dead port is replaced and the message sent once', () => {
    const { client, ports } = harness();
    client.cancel();
    if (ports[0]) ports[0].throwOnPost = true;
    client.outcome('hof_1', false);
    expect(ports).toHaveLength(2);
    expect(ports[1]?.sent).toEqual([{ v: 1, type: 'handoff/outcome', handoffId: 'hof_1', posted: false }]);
  });

  test('close disconnects and stops reconnecting', () => {
    vi.useFakeTimers();
    const { client, ports } = harness();
    client.start({ exportId: 'exp_1', mode: 'post', rehearsal: false, screen });
    client.close();
    expect(ports[0]?.disconnected).toBe(true);
    ports[0]?.drop();
    vi.advanceTimersByTime(10_000);
    expect(ports).toHaveLength(1);
    expect(() => client.cancel()).toThrow('closed');
  });
});
