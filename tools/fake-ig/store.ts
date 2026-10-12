/**
 * The fake's recordings (strategy §6.2): stories, requests, writes to real-shaped paths,
 * violations, and the server-global knobs. In memory; stories are also written to
 * `.fake-ig/stories/` (`<id>.jpg` + `<id>.json`) when a directory is given, and reloaded from
 * there on start, so the dashboard survives a server restart. reset() clears all of it,
 * the files included, and puts the knobs back to DEFAULT_KNOBS.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_KNOBS, type Knobs, mergeKnobs } from './knobs.ts';
import type { FakeShareMeta, Size } from './protocol.ts';
import type { UaClassification } from './ua.ts';

/** Request headers the log keeps: user-agent, sec-ch-ua*, sec-fetch-*, origin (§6.2). */
export interface SeenHeaders {
  ua: string | null;
  /** Every `sec-ch-ua*` header received. */
  ch: Record<string, string>;
  /** Every `sec-fetch-*` header received. */
  fetch: Record<string, string>;
  origin: string | null;
  /** Answered from the desktopShell service worker's own context. */
  viaSw: boolean;
}

export interface RequestRecord extends SeenHeaders {
  seq: number;
  t: number;
  host: string;
  method: string;
  /** Path and query. */
  path: string;
  status: number;
  classification: UaClassification;
  tag: 'WRITE_PATH_REACHED' | null;
}

export interface WriteRecord extends SeenHeaders {
  seq: number;
  t: number;
  tag: 'WRITE_PATH_REACHED';
  host: string;
  method: string;
  path: string;
  /** The WRITE_URL_FILTERS entry that matched. */
  filter: string;
  bytes: number;
  contentType: string | null;
}

export interface StoryRecord extends SeenHeaders {
  id: string;
  t: number;
  bytes: number;
  contentType: string | null;
  /** Dimensions read from the JPEG itself (SOF marker); null if the body is not a JPEG. */
  size: Size | null;
  /** From x-fake-meta; null when the header was missing or invalid. */
  isTrusted: boolean | null;
  meta: FakeShareMeta | null;
  metaError: string | null;
}

export interface ViolationRecord {
  t: number;
  /** UNTRUSTED_CONTROL (FID-2): a click on any other fake control had isTrusted=false. */
  kind: 'UNTRUSTED_SHARE' | 'SHARE_META_INVALID' | 'UNTRUSTED_CONTROL';
  /** The story a Share violation belongs to; null for a control. */
  storyId: string | null;
  detail: string;
}

export interface StoryInput extends SeenHeaders {
  body: Uint8Array;
  contentType: string | null;
  meta: FakeShareMeta | null;
  metaError: string | null;
}

export interface Store {
  knobs(): Knobs;
  setKnobs(patch: Partial<Knobs>): Knobs;
  addRequest(rec: Omit<RequestRecord, 'seq' | 't'>): RequestRecord;
  /** Oldest first; only records with seq > sinceSeq. */
  requests(sinceSeq?: number): RequestRecord[];
  addWrite(rec: Omit<WriteRecord, 'seq' | 't' | 'tag'>): WriteRecord;
  writes(): WriteRecord[];
  addStory(input: StoryInput): StoryRecord;
  /** Oldest first. */
  stories(): StoryRecord[];
  storyBytes(id: string): Uint8Array | null;
  addViolation(rec: Omit<ViolationRecord, 't'>): ViolationRecord;
  violations(): ViolationRecord[];
  reset(): void;
}

export interface StoreOptions {
  /** Persist stories here (`.fake-ig/stories`); null keeps everything in memory (tests). */
  dir?: string | null;
  /** Requests kept in memory (the dashboard shows the last 200). */
  maxRequests?: number;
  now?: () => number;
}

const ID_RE = /^s[0-9a-z]+-[0-9a-f]{6}$/;

/** Width and height from a baseline or progressive JPEG's SOFn segment; null if not a JPEG. */
export function jpegSize(b: Uint8Array): Size | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    const len = ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const h = ((b[i + 5] ?? 0) << 8) | (b[i + 6] ?? 0);
      const w = ((b[i + 7] ?? 0) << 8) | (b[i + 8] ?? 0);
      return { w, h };
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    i += 2 + len;
  }
  return null;
}

export function createStore(opts: StoreOptions = {}): Store {
  const dir = opts.dir ?? null;
  const maxRequests = opts.maxRequests ?? 1000;
  const now = opts.now ?? Date.now;
  let knobs: Knobs = mergeKnobs(DEFAULT_KNOBS, {});
  let seq = 0;
  let requests: RequestRecord[] = [];
  let writes: WriteRecord[] = [];
  let stories: StoryRecord[] = [];
  let violations: ViolationRecord[] = [];
  const bytes = new Map<string, Uint8Array>();

  const fileOf = (id: string, ext: 'jpg' | 'json') => resolve(dir ?? '.', `${id}.${ext}`);

  if (dir && existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!ID_RE.test(id)) continue;
      try {
        stories.push(JSON.parse(readFileSync(fileOf(id, 'json'), 'utf8')) as StoryRecord);
      } catch {
        // A half-written or foreign file: skip it, the dashboard shows the rest.
      }
    }
    stories.sort((a, b) => a.t - b.t);
  }

  return {
    knobs: () => knobs,
    setKnobs(patch) {
      knobs = mergeKnobs(knobs, patch);
      return knobs;
    },
    addRequest(rec) {
      const full: RequestRecord = { ...rec, seq: ++seq, t: now() };
      requests.push(full);
      if (requests.length > maxRequests) requests = requests.slice(-maxRequests);
      return full;
    },
    requests: (sinceSeq = 0) => requests.filter((r) => r.seq > sinceSeq),
    addWrite(rec) {
      const full: WriteRecord = { ...rec, seq: ++seq, t: now(), tag: 'WRITE_PATH_REACHED' };
      writes.push(full);
      return full;
    },
    writes: () => [...writes],
    addStory({ body, ...rest }) {
      const t = now();
      const id = `s${t.toString(36)}-${randomBytes(3).toString('hex')}`;
      const rec: StoryRecord = {
        ...rest,
        id,
        t,
        bytes: body.length,
        size: jpegSize(body),
        isTrusted: rest.meta ? rest.meta.isTrusted : null,
      };
      stories.push(rec);
      bytes.set(id, body);
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(fileOf(id, 'jpg'), body);
        writeFileSync(fileOf(id, 'json'), `${JSON.stringify(rec, null, 2)}\n`);
      }
      return rec;
    },
    stories: () => [...stories],
    storyBytes(id) {
      if (!ID_RE.test(id) || !stories.some((s) => s.id === id)) return null;
      const mem = bytes.get(id);
      if (mem) return mem;
      if (!dir || !existsSync(fileOf(id, 'jpg'))) return null;
      return readFileSync(fileOf(id, 'jpg'));
    },
    addViolation(rec) {
      const full: ViolationRecord = { ...rec, t: now() };
      violations.push(full);
      return full;
    },
    violations: () => [...violations],
    reset() {
      if (dir && existsSync(dir)) {
        for (const name of readdirSync(dir)) {
          const id = name.replace(/\.(jpg|json)$/, '');
          if (ID_RE.test(id)) rmSync(resolve(dir, name), { force: true });
        }
      }
      knobs = mergeKnobs(DEFAULT_KNOBS, {});
      requests = [];
      writes = [];
      stories = [];
      violations = [];
      bytes.clear();
    },
  };
}
