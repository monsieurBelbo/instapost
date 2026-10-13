/**
 * The test side of the fake's JSON API (strategy §7.6, §7.9): Node https straight to
 * 127.0.0.1:8443 with the fake's own certificate as the only CA and SNI `www.instagram.com`, so
 * the client verifies the certificate and never resolves a real Instagram host. Reads only the
 * recordings and knobs; it never touches the extension or the browser.
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { FAKE_PORT } from '../../../tools/chrome/flags.ts';
import { CERT_PATHS } from '../../../tools/fake-ig/cert.ts';
import type { Knobs } from '../../../tools/fake-ig/knobs.ts';
import type {
  ComposerViewRecord,
  RequestRecord,
  StoryRecord,
  ViolationRecord,
  WriteRecord,
} from '../../../tools/fake-ig/store.ts';

/** server.ts listens here (not imported: it would pull esbuild into the test runner). */
const FAKE_LISTEN_HOST = '127.0.0.1';

export type { ComposerViewRecord, Knobs, RequestRecord, StoryRecord, ViolationRecord, WriteRecord };

/** A knob patch as the API accepts it (`insets` also as "top,bottom"). */
export type KnobPatch = Partial<Omit<Knobs, 'insets'>> & { insets?: Knobs['insets'] | string };

export interface FakeClient {
  knobs(): Promise<Knobs>;
  setKnobs(patch: KnobPatch): Promise<Knobs>;
  reset(): Promise<void>;
  stories(): Promise<StoryRecord[]>;
  /** The JPEG a story recorded. */
  storyBytes(id: string): Promise<Buffer>;
  /** Logged site requests with seq > since (oldest first). */
  requests(since?: number): Promise<RequestRecord[]>;
  writes(): Promise<WriteRecord[]>;
  violations(): Promise<ViolationRecord[]>;
  /** AM37: what the composer page showed (its landscape gate), oldest first. */
  composerViews(): Promise<ComposerViewRecord[]>;
  /** `sourceHash`: fakeSourceHash() when the server started (FID-7). */
  health(): Promise<{ ok: boolean; fake: boolean; certValidTo: string | null; sourceHash?: string | null }>;
}

interface Raw {
  status: number;
  body: Buffer;
}

function call(method: 'GET' | 'POST', path: string, ca: string, body?: unknown): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request(
      {
        host: FAKE_LISTEN_HOST,
        port: FAKE_PORT,
        method,
        path,
        servername: 'www.instagram.com',
        ca,
        headers: {
          host: 'www.instagram.com',
          ...(payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {}),
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`fake ${method} ${path}: timeout`)));
    req.on('error', reject);
    req.end(payload);
  });
}

export function createFakeClient(caPem: string = readFileSync(CERT_PATHS.cert, 'utf8')): FakeClient {
  async function json<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await call(method, path, caPem, body);
    const text = res.body.toString('utf8');
    if (res.status !== 200) throw new Error(`fake ${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }
  return {
    knobs: () => json<Knobs>('GET', '/__fake__/api/knobs'),
    setKnobs: (patch) => json<Knobs>('POST', '/__fake__/api/knobs', patch),
    reset: async () => {
      await json('POST', '/__fake__/api/reset');
    },
    stories: () => json<StoryRecord[]>('GET', '/__fake__/api/stories'),
    async storyBytes(id) {
      const res = await call('GET', `/__fake__/stories/${encodeURIComponent(id)}.jpg`, caPem);
      if (res.status !== 200) throw new Error(`fake story ${id}: HTTP ${res.status}`);
      return res.body;
    },
    requests: (since = 0) => json<RequestRecord[]>('GET', `/__fake__/api/requests?since=${since}`),
    writes: () => json<WriteRecord[]>('GET', '/__fake__/api/writes'),
    violations: () => json<ViolationRecord[]>('GET', '/__fake__/api/violations'),
    composerViews: () => json<ComposerViewRecord[]>('GET', '/__fake__/api/composer-views'),
    health: () => json('GET', '/__fake__/health'),
  };
}
