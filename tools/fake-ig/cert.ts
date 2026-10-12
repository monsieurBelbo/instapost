/**
 * Self-signed leaf certificate for the fake Instagram (strategy §7.5).
 *
 * Never touches the Keychain, NSS, /etc/hosts or mkcert. The sealed browsers accept the
 * certificate by its SPKI hash (`--ignore-certificate-errors-spki-list`), nothing else does.
 *
 * Run: `pnpm run fake:cert` (also part of `pnpm run bootstrap`). Always writes a fresh
 * 30-day certificate; the server and `readSpki()` refuse a certificate that expires
 * within 3 days.
 */
import { execFileSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const FAKE_DIR = resolve(ROOT, '.fake-ig');
export const CERT_PATHS = {
  dir: FAKE_DIR,
  cnf: resolve(FAKE_DIR, 'openssl.cnf'),
  key: resolve(FAKE_DIR, 'key.pem'),
  cert: resolve(FAKE_DIR, 'cert.pem'),
  spki: resolve(FAKE_DIR, 'spki.txt'),
} as const;

/** Hosts in the certificate's SANs; the same two hosts the resolver rules map. */
export const FAKE_CERT_HOSTS = ['www.instagram.com', 'i.instagram.com'] as const;
export const CERT_DAYS = 30;
/** A certificate that expires within this window is treated as missing. */
export const CERT_RENEW_MS = 3 * 24 * 60 * 60 * 1000;

export const OPENSSL_CNF = `[req]
distinguished_name=dn
x509_extensions=ext
prompt=no

[dn]
CN=instapost fake instagram

[ext]
subjectAltName=${FAKE_CERT_HOSTS.map((h) => `DNS:${h}`).join(',')}
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
`;

/** base64(sha256(SubjectPublicKeyInfo DER)), the value Chrome's SPKI allow-list expects. */
export function spkiOfCert(pem: string): string {
  const der = new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('base64');
}

export type CertStatus =
  | { ok: true; spki: string; validTo: Date; certPath: string; keyPath: string }
  | { ok: false; reason: 'missing' | 'expiring' | 'spki-mismatch' | 'unreadable'; detail: string };

/**
 * Reads `.fake-ig/{cert.pem,key.pem,spki.txt}` and checks them against each other.
 * `ok:false` when a file is missing, the certificate expires within 3 days, or spki.txt
 * does not match the certificate (fail closed: a stale hash would seal nothing useful).
 */
export function certStatus(now: number = Date.now()): CertStatus {
  for (const p of [CERT_PATHS.cert, CERT_PATHS.key, CERT_PATHS.spki]) {
    if (!existsSync(p)) return { ok: false, reason: 'missing', detail: p };
  }
  try {
    const pem = readFileSync(CERT_PATHS.cert, 'utf8');
    const validTo = new Date(new X509Certificate(pem).validTo);
    if (!(validTo.getTime() - now > CERT_RENEW_MS)) {
      return { ok: false, reason: 'expiring', detail: `certificate valid to ${validTo.toISOString()}` };
    }
    const spki = readFileSync(CERT_PATHS.spki, 'utf8').trim();
    const actual = spkiOfCert(pem);
    if (spki !== actual) return { ok: false, reason: 'spki-mismatch', detail: `${spki} != ${actual}` };
    return { ok: true, spki, validTo, certPath: CERT_PATHS.cert, keyPath: CERT_PATHS.key };
  } catch (err) {
    return { ok: false, reason: 'unreadable', detail: String(err) };
  }
}

/** Writes openssl.cnf, a fresh key and certificate, and spki.txt. Returns the new status. */
export function generateCert(): CertStatus {
  mkdirSync(CERT_PATHS.dir, { recursive: true });
  writeFileSync(CERT_PATHS.cnf, OPENSSL_CNF);
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      String(CERT_DAYS),
      '-config',
      CERT_PATHS.cnf,
      '-keyout',
      CERT_PATHS.key,
      '-out',
      CERT_PATHS.cert,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  chmodSync(CERT_PATHS.key, 0o600);
  const pem = readFileSync(CERT_PATHS.cert, 'utf8');
  const san = new X509Certificate(pem).subjectAltName ?? '';
  for (const host of FAKE_CERT_HOSTS) {
    if (!san.includes(`DNS:${host}`)) throw new Error(`fake cert: SAN ${host} missing (got "${san}")`);
  }
  writeFileSync(CERT_PATHS.spki, `${spkiOfCert(pem)}\n`);
  return certStatus();
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const status = generateCert();
  if (!status.ok) {
    console.error(`fake cert: generated but not usable: ${status.reason} (${status.detail})`);
    process.exit(1);
  }
  console.log(`fake cert: ${status.certPath}`);
  console.log(`  valid to ${status.validTo.toISOString()}`);
  console.log(`  SPKI ${status.spki}`);
}
