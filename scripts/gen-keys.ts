/**
 * One RSA key pair per mode, public half only (strategy §7.5). Runs per mode and only if
 * keys/<mode>.pub.b64 is missing, so committed keys (and therefore extension IDs) are stable.
 * The private key is discarded: unpacked builds do not need it.
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { extIdForMode, KEY_MODES, keyPath } from '../tools/chrome/ext-id.ts';

for (const mode of KEY_MODES) {
  const path = keyPath(mode);
  if (existsSync(path)) {
    console.log(`keys/${mode}.pub.b64 exists (id ${extIdForMode(mode)})`);
    continue;
  }
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${der.toString('base64')}\n`);
  console.log(`keys/${mode}.pub.b64 written (id ${extIdForMode(mode)})`);
}
