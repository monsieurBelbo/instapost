/**
 * Base64 for the agent file transfer (strategy §3.5). A 1080x1920 PNG is about 3–7 MB, far
 * below the 64 MB message limit. Must round-trip 12 MB (U12) without call-stack overflows
 * (no spreading a whole array into String.fromCharCode).
 *
 * Both directions work in chunks: encode chunks are a multiple of 3 bytes and decode chunks a
 * multiple of 4 characters, so the per-chunk btoa/atob results concatenate exactly.
 */

/** Bytes per encode chunk: a multiple of 3, and few enough arguments for fromCharCode.apply. */
const ENCODE_CHUNK = 3 * 8192;
/** Characters per decode chunk: a multiple of 4. */
const DECODE_CHUNK = 4 * 8192;
/** Standard alphabet, padded; no whitespace, no URL-safe variant. */
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function bytesToB64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += ENCODE_CHUNK) {
    const chunk = bytes.subarray(i, i + ENCODE_CHUNK);
    parts.push(btoa(String.fromCharCode.apply(null, chunk as unknown as number[])));
  }
  return parts.join('');
}

/** Throws on malformed input. The result owns a plain ArrayBuffer, so it is a valid BlobPart. */
export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (b64.length % 4 !== 0 || !B64.test(b64)) throw new TypeError('b64ToBytes: malformed base64');
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((b64.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < b64.length; i += DECODE_CHUNK) {
    const bin = atob(b64.slice(i, i + DECODE_CHUNK));
    for (let j = 0; j < bin.length; j++) out[o++] = bin.charCodeAt(j);
  }
  return out;
}
