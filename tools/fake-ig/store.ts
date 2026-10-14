/**
 * The fake's recordings (strategy §6.2, ux.md IF5–IF9): stories, uploads, requests, writes to the
 * real-shaped paths, violations, what the composer page showed (AM37: its landscape gate), the page's
 * story-creation telemetry (the log), and the server-global knobs. A story exists only once the publish
 * request (configure) succeeded for an upload id that has an upload: server truth, whatever the page
 * then shows. In memory; stories are also written to
 * `.fake-ig/stories/` (`<id>.jpg` + `<id>.json`) when a directory is given, and reloaded from
 * there on start, so the dashboard survives a server restart. reset() clears all of it,
 * the files included, and puts the knobs back to DEFAULT_KNOBS.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_KNOBS, type Knobs, mergeKnobs } from './knobs.ts';
import type { FakeComposerView, FakeShareMeta, Size } from './protocol.ts';
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
  /** From the upload's x-fake-meta: the Share click's isTrusted; null when the header was missing or invalid. */
  isTrusted: boolean | null;
  meta: FakeShareMeta | null;
  metaError: string | null;
  /** The upload id the publish request named (C13). */
  uploadId: string;
  /** The publish request's `share_to_facebook` was "true" (automatic crossposting, OD12). */
  shareToFacebook: boolean;
  /** Headers of the publish request (the story's own headers above are the upload's). */
  configure: SeenHeaders;
}

/** A photo upload the server received (i.instagram.com/rupload_igphoto/fb_uploader_<id>), answered or not. */
export interface UploadRecord extends SeenHeaders {
  uploadId: string;
  t: number;
  bytes: number;
  contentType: string | null;
  meta: FakeShareMeta | null;
  metaError: string | null;
  /** What the server answered (knob `rupload` at the time). */
  answer: string;
}

export interface UploadInput extends SeenHeaders {
  uploadId: string;
  body: Uint8Array;
  contentType: string | null;
  meta: FakeShareMeta | null;
  metaError: string | null;
  answer: string;
}

/** IF8: one step of the page's telemetry, with the server's time and order. */
export interface LogRecord {
  seq: number;
  t: number;
  step: string;
  /** Per-document id the page chose (count steps per page load). */
  doc: string;
  fields: Record<string, string | number | boolean | null>;
}

export const VIOLATION_KINDS = [
  /** A second Share in one composer session (Instagram's uploadStory has no in-flight guard: a second story). */
  'DOUBLE_SHARE',
  /** An untrusted click on the "Upload failed." toast's Retry: instapost never retries. */
  'RETRY_CLICKED',
  /** An untrusted click on a control outside the autopilot's allow-list (+, Story, Share; Post once by trial). */
  'TAP_OUTSIDE_ALLOWLIST',
  /** The upload carried no (or an invalid) x-fake-meta: the fake's own client is broken. */
  'SHARE_META_INVALID',
] as const;
export type ViolationKind = (typeof VIOLATION_KINDS)[number];

export interface ViolationRecord {
  t: number;
  kind: ViolationKind;
  /** The story or upload a violation belongs to, when one; null for a control. */
  storyId: string | null;
  detail: string;
}

/** AM37: one report of what the composer page showed (its landscape gate), as the page sent it. */
export interface ComposerViewRecord extends FakeComposerView {
  seq: number;
  t: number;
}

export interface StoryInput {
  upload: UploadRecord;
  body: Uint8Array;
  shareToFacebook: boolean;
  configure: SeenHeaders;
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
  addUpload(input: UploadInput): UploadRecord;
  /** The upload with this id and its bytes, or null. */
  upload(uploadId: string): { record: UploadRecord; body: Uint8Array } | null;
  /** Oldest first. */
  uploads(): UploadRecord[];
  addLog(rec: Omit<LogRecord, 'seq' | 't'>): LogRecord;
  /** Oldest first; only records with seq > sinceSeq. */
  log(sinceSeq?: number): LogRecord[];
  addViolation(rec: Omit<ViolationRecord, 't'>): ViolationRecord;
  violations(): ViolationRecord[];
  /** AM37: what the composer page showed (landscape gate), oldest first. */
  addComposerView(view: FakeComposerView): ComposerViewRecord;
  composerViews(): ComposerViewRecord[];
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
/** Composer views kept in memory (a test produces a handful). */
const MAX_COMPOSER_VIEWS = 200;
/** Uploads kept in memory (their bytes too; a test makes a few). */
const MAX_UPLOADS = 50;
/** Log steps kept in memory. */
const MAX_LOG = 2000;

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
  let composerViews: ComposerViewRecord[] = [];
  let uploads: UploadRecord[] = [];
  let logs: LogRecord[] = [];
  const bytes = new Map<string, Uint8Array>();
  const uploadBytes = new Map<string, Uint8Array>();

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
    addStory({ upload, body, shareToFacebook, configure }) {
      const t = now();
      const id = `s${t.toString(36)}-${randomBytes(3).toString('hex')}`;
      const rec: StoryRecord = {
        ua: upload.ua,
        ch: upload.ch,
        fetch: upload.fetch,
        origin: upload.origin,
        viaSw: upload.viaSw,
        id,
        t,
        bytes: body.length,
        contentType: upload.contentType,
        size: jpegSize(body),
        isTrusted: upload.meta ? upload.meta.isTrusted : null,
        meta: upload.meta,
        metaError: upload.metaError,
        uploadId: upload.uploadId,
        shareToFacebook,
        configure,
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
    addUpload({ body, ...rest }) {
      const rec: UploadRecord = { ...rest, t: now(), bytes: body.length };
      uploads.push(rec);
      uploadBytes.set(rec.uploadId, body);
      if (uploads.length > MAX_UPLOADS) {
        const old = uploads.shift();
        if (old && !uploads.some((u) => u.uploadId === old.uploadId)) uploadBytes.delete(old.uploadId);
      }
      return rec;
    },
    upload(uploadId) {
      const record = [...uploads].reverse().find((u) => u.uploadId === uploadId);
      const body = uploadBytes.get(uploadId);
      return record && body ? { record, body } : null;
    },
    uploads: () => [...uploads],
    addLog(rec) {
      const full: LogRecord = { ...rec, seq: ++seq, t: now() };
      logs.push(full);
      if (logs.length > MAX_LOG) logs = logs.slice(-MAX_LOG);
      return full;
    },
    log: (sinceSeq = 0) => logs.filter((l) => l.seq > sinceSeq),
    addViolation(rec) {
      const full: ViolationRecord = { ...rec, t: now() };
      violations.push(full);
      return full;
    },
    violations: () => [...violations],
    addComposerView(view) {
      const full: ComposerViewRecord = { ...view, seq: ++seq, t: now() };
      composerViews.push(full);
      if (composerViews.length > MAX_COMPOSER_VIEWS) composerViews = composerViews.slice(-MAX_COMPOSER_VIEWS);
      return full;
    },
    composerViews: () => [...composerViews],
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
      composerViews = [];
      uploads = [];
      logs = [];
      bytes.clear();
      uploadBytes.clear();
    },
  };
}
