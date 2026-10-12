/**
 * Manual dev (strategy §5 `development`, §6.3 "Manual dev", §11 AM11): `pnpm run dev`.
 *
 * 1. Fails closed unless the fake's certificate is valid (`readSpki()`), the sealed web-ext
 *    arguments pass `assertSealed()` and the pinned CfT binary is installed. wxt.config.ts
 *    re-checks the merged web-ext config in `config:resolved` before any browser starts.
 * 2. Reuses a running fake (its health check must answer `fake: true` over the fake's own
 *    certificate), or starts `node tools/fake-ig/server.ts` and stops it again on exit.
 * 3. Runs `wxt` (mode `development`) with the dev server on a pinned port: 3000 belongs to Docker
 *    on the owner's Mac (AM11). The port must be free, otherwise this exits before starting wxt.
 *    WXT opens sealed CfT 155 with the persistent profile `.profiles/dev-fake` and the fake's
 *    dashboard as start page (wxt.config.ts `webExt`).
 *
 * Ctrl+C stops wxt (which closes the browser), then the fake if this script started it.
 * `INSTAPOST_DEV_PORT` overrides the port; `HEADLESS=1` runs Chrome headless (chrome-launcher), with
 * the owner's screen emulated (wxt.config.ts adds HEADLESS_SCREEN_ARGS) so popups fit.
 * wxt runs with `-b chrome`; the config refuses any other target browser.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { request } from 'node:https';
import { connect, createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSealed, DEV_PROFILE_DIR, FAKE_PORT, readSpki, sealedWebExtArgs } from '../tools/chrome/flags.ts';
import { cftExecutable } from '../tools/chrome/versions.ts';
import { CERT_PATHS } from '../tools/fake-ig/cert.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Pinned WXT dev-server port (AM11): not 3000 (Docker), not the fake's 8443. */
export const DEV_SERVER_PORT = 5317;
const FAKE_HOST = '127.0.0.1';
const FAKE_START_TIMEOUT_MS = 30_000;

const log = (line: string) => console.log(`[dev] ${line}`);
const die = (why: string): never => {
  console.error(`[dev] refusing to start: ${why}`);
  process.exit(1);
};

type FakeHealth = 'fake' | 'down' | 'foreign';

/** GET /__fake__/health over the fake's own certificate (it verifies the server is our fake). */
function fakeHealth(ca: string): Promise<FakeHealth> {
  return new Promise((done) => {
    const req = request(
      {
        host: FAKE_HOST,
        port: FAKE_PORT,
        path: '/__fake__/health',
        servername: 'www.instagram.com',
        ca,
        headers: { host: 'www.instagram.com' },
        timeout: 3000,
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => {
          body += c.toString('utf8');
        });
        res.on('end', () => {
          try {
            done((JSON.parse(body) as { fake?: unknown }).fake === true ? 'fake' : 'foreign');
          } catch {
            done('foreign');
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err: NodeJS.ErrnoException) => done(err.code === 'ECONNREFUSED' ? 'down' : 'foreign'));
    req.end();
  });
}

/** Something accepts connections on host:port. */
function listening(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host, port, timeout: 1000 });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(false));
  });
}

/** We can bind host:port right now. */
function bindable(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => done(true)));
  });
}

/** Free on both loopback families (WXT binds `localhost`, which may resolve to either). */
async function portFree(port: number): Promise<boolean> {
  for (const host of ['127.0.0.1', '::1']) {
    if (await listening(host, port)) return false;
    if (!(await bindable(host, port))) return false;
  }
  return true;
}

async function ensureFake(ca: string): Promise<ChildProcess | null> {
  const health = await fakeHealth(ca);
  if (health === 'fake') {
    log(`reusing the fake already running on ${FAKE_HOST}:${FAKE_PORT}`);
    return null;
  }
  if (health === 'foreign') die(`${FAKE_HOST}:${FAKE_PORT} is taken by something that is not the fake`);
  log('starting the fake (node tools/fake-ig/server.ts)');
  const child = spawn(process.execPath, [resolve(ROOT, 'tools/fake-ig/server.ts')], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const deadline = Date.now() + FAKE_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) die(`the fake exited with code ${child.exitCode}`);
    if ((await fakeHealth(ca)) === 'fake') return child;
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill('SIGTERM');
  return die(`the fake did not answer its health check within ${FAKE_START_TIMEOUT_MS / 1000} s`);
}

async function main(): Promise<void> {
  const spki = readSpki();
  if (!spki) die('no valid fake certificate (missing, mismatched or expiring within 3 days): pnpm run fake:cert');
  assertSealed(sealedWebExtArgs(spki as string, { headless: Boolean(process.env.HEADLESS) }));
  if (!existsSync(cftExecutable())) die(`CfT is not installed at ${cftExecutable()}: node tools/chrome/install-cft.ts`);
  if (process.env.INSTAPOST_LIVE) die('INSTAPOST_LIVE is set: the live build never runs under wxt dev');

  const port = Number(process.env.INSTAPOST_DEV_PORT ?? DEV_SERVER_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === FAKE_PORT) die(`invalid dev port ${port}`);
  if (!(await portFree(port))) die(`dev-server port ${port} is in use (set INSTAPOST_DEV_PORT to another free port)`);

  const fake = await ensureFake(readFileSync(CERT_PATHS.cert, 'utf8'));
  const stopFake = () => {
    if (fake && fake.exitCode === null) fake.kill('SIGTERM');
  };

  log(`wxt dev on http://localhost:${port}; sealed CfT profile ${DEV_PROFILE_DIR}`);
  // `-b chrome` explicitly: the seal (wxt.config.ts config:resolved) refuses any other browser (AM26).
  const wxtArgs = [resolve(ROOT, 'node_modules/wxt/bin/wxt.mjs'), '-b', 'chrome', '--port', String(port)];
  const wxt = spawn(process.execPath, wxtArgs, {
    cwd: ROOT,
    stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (wxt.exitCode === null) wxt.kill(signal);
      else stopFake();
    });
  }
  wxt.once('exit', (code, signal) => {
    stopFake();
    log(`wxt exited (${signal ?? code})`);
    process.exit(code ?? 0);
  });
  wxt.once('error', (err) => {
    stopFake();
    die(`cannot start wxt: ${err.message}`);
  });
  // Pinned means pinned: wxt picks another port on its own when ours is taken in the meantime.
  setTimeout(() => {
    void listening('localhost', port).then((ok) => {
      if (!ok && wxt.exitCode === null) log(`WARNING: nothing listens on localhost:${port} yet; check the wxt output`);
    });
  }, 15_000).unref();
}

await main();
