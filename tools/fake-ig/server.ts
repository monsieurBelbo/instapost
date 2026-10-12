/**
 * Fake Instagram over HTTPS (strategy §6.2, §7.6): node:https on 127.0.0.1:8443 with the
 * `.fake-ig` certificate, a thin adapter around core.handle().
 *
 * Run: `pnpm run fake` (Playwright's webServer runs the same command and polls
 * https://127.0.0.1:8443/__fake__/health). Sealed browsers reach it as https://www.instagram.com/
 * and https://i.instagram.com/; the dashboard is https://www.instagram.com/__fake__/.
 *
 * Refuses to start when the certificate is missing, does not match spki.txt or expires within
 * 3 days (`pnpm run fake:cert` renews it), or when the client bundle fails to build.
 */
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAKE_PORT } from '../chrome/flags.ts';
import { loadAssets } from './bundle.ts';
import { certStatus, FAKE_DIR } from './cert.ts';
import { type CoreEvent, createCore, type FakeCore } from './core.ts';
import { BASELINE, DEFAULT_KNOBS, deriveKnobs, knobsEqual } from './knobs.ts';
import { fakeSourceHash } from './source-hash.ts';
import { createStore } from './store.ts';

export const FAKE_LISTEN_HOST = '127.0.0.1';
export const STORIES_DIR = resolve(FAKE_DIR, 'stories');
const MAX_BODY_BYTES = 40 * 1024 * 1024;

export interface FakeServerOptions {
  port?: number;
  /** Write stories to .fake-ig/stories (default true). */
  persist?: boolean;
  log?: (line: string) => void;
}

export interface RunningFake {
  /** https://127.0.0.1:<port> */
  url: string;
  core: FakeCore;
  close(): Promise<void>;
}

function describe(e: CoreEvent): string {
  switch (e.kind) {
    case 'write':
      return `fake-ig: WRITE_PATH_REACHED ${e.write.method} ${e.write.host}${e.write.path} (${e.write.filter})`;
    case 'story': {
      const size = e.story.size ? `${e.story.size.w}x${e.story.size.h}` : 'not-jpeg';
      return `fake-ig: story ${e.story.id} ${size} ${e.story.bytes} B isTrusted=${e.story.isTrusted}`;
    }
    case 'violation':
      return `fake-ig: VIOLATION ${e.violation.kind} story=${e.violation.storyId}: ${e.violation.detail}`;
  }
}

async function serve(core: FakeCore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'content-type': 'text/plain' }).end('payload too large');
        req.destroy();
        return;
      }
      chunks.push(chunk);
    }
  } catch {
    return; // client went away
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  const out = core.handle({
    method: req.method ?? 'GET',
    host: req.headers.host ?? '',
    path: req.url ?? '/',
    headers,
    body: Buffer.concat(chunks),
  });
  res.writeHead(out.status, out.headers);
  res.end(req.method === 'HEAD' ? undefined : out.body);
}

export async function startFakeServer(opts: FakeServerOptions = {}): Promise<RunningFake> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const port = opts.port ?? FAKE_PORT;
  const cert = certStatus();
  if (!cert.ok) {
    throw new Error(`fake-ig: refusing to start, certificate ${cert.reason} (${cert.detail}); run pnpm run fake:cert`);
  }
  try {
    if (!knobsEqual(deriveKnobs(BASELINE), DEFAULT_KNOBS)) {
      log('fake-ig: WARNING DEFAULT_KNOBS differ from deriveKnobs(baseline.json): update knobs.ts (U16 fails)');
    }
  } catch (err) {
    log(`fake-ig: WARNING ${(err as Error).message}`);
  }
  // Hashed before bundling, so an edit during the bundle makes the fake look stale, never fresh.
  const sourceHash = fakeSourceHash();
  const assets = await loadAssets();
  const core = createCore({
    sourceHash,
    store: createStore({ dir: opts.persist === false ? null : STORIES_DIR }),
    assets,
    certValidTo: cert.validTo.toISOString(),
    onEvent: (e) => log(describe(e)),
  });
  const server = createServer({ key: readFileSync(cert.keyPath), cert: readFileSync(cert.certPath) }, (req, res) => {
    void serve(core, req, res);
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', (err: NodeJS.ErrnoException) =>
      fail(
        err.code === 'EADDRINUSE'
          ? new Error(`fake-ig: ${FAKE_LISTEN_HOST}:${port} is in use (is another fake running?)`)
          : err,
      ),
    );
    server.listen(port, FAKE_LISTEN_HOST, ok);
  });
  return {
    url: `https://${FAKE_LISTEN_HOST}:${port}`,
    core,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections();
        server.close(() => ok());
      }),
  };
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const fake = await startFakeServer();
    const cert = certStatus();
    console.log(`fake-ig: listening on ${fake.url} (sealed browsers: https://www.instagram.com/)`);
    console.log('  dashboard https://www.instagram.com/__fake__/');
    console.log(`  health    ${fake.url}/__fake__/health`);
    console.log(`  stories   ${STORIES_DIR}`);
    if (cert.ok) console.log(`  cert valid to ${cert.validTo.toISOString()}`);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => void fake.close().then(() => process.exit(0)));
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
