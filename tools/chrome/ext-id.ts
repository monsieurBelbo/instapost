/**
 * Extension IDs from the committed public keys (strategy §7.5): sha256(SPKI DER), first
 * 16 bytes as hex, each hex digit 0-f mapped to a-p. E2 compares it with the loaded ID.
 *
 * CLI: `node tools/chrome/ext-id.ts` prints the dev, mock and live IDs and exits non-zero
 * if any key is missing or two IDs collide.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const KEY_MODES = ['dev', 'mock', 'live'] as const;
export type KeyMode = (typeof KEY_MODES)[number];

export const keyPath = (mode: KeyMode): string => resolve(ROOT, 'keys', `${mode}.pub.b64`);

export function extIdFromDer(der: Uint8Array): string {
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + Number.parseInt(c, 16))).join('');
}

/** `b64` is the manifest `key` value: base64 SPKI DER of the public key. */
export function extIdFromKey(b64: string): string {
  return extIdFromDer(Buffer.from(b64.trim(), 'base64'));
}

export function extIdForMode(mode: KeyMode): string {
  return extIdFromKey(readFileSync(keyPath(mode), 'utf8'));
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ids = Object.fromEntries(KEY_MODES.map((m) => [m, extIdForMode(m)]));
  console.log(JSON.stringify(ids, null, 2));
  if (new Set(Object.values(ids)).size !== KEY_MODES.length) {
    console.error('extension IDs are not distinct');
    process.exit(1);
  }
}
