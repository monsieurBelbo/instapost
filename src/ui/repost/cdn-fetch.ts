/**
 * The audited image-CDN GET (docs/repost.md RP-21, strategy AM55): the one network call of the editor pages
 * besides Vite's modulepreload and the HEIC worker's packaged wasm. Composer only, on the owner's click, for a
 * picture Instagram's page already shows. check-bundle T3 (cdnFetchProblems) pins exactly one such `fetch(`
 * across the editor-side chunks, in the same block as the `instapost:cdn-fetch` marker, with these options:
 *
 * - `credentials: 'omit'` (no cookies), `referrerPolicy: 'no-referrer'`, `redirect: 'error'` (never follows a
 *   redirect elsewhere), `mode: 'cors'`, a 15 s timeout;
 * - the URL is checked again (isCdnImageUrl) before the call;
 * - the answer must be 2xx and an image (`image/*`, or sniffed as JPEG, PNG, WebP or AVIF), at most
 *   `maxBytes`.
 *
 * It never retries: intake.ts decides the next candidate (only after 403, 404 or 410) and Try again is the
 * owner's click. URLs are never stored or logged.
 */
import { isCdnImageUrl } from '../../core/repost/cdn-url.ts';
import { sniffImageMime } from '../../raster/decode.ts';

export const MEDIA_MAX_BYTES = 20_000_000;
export const AVATAR_MAX_BYTES = 2_000_000;
export const CDN_TIMEOUT_MS = 15_000;

export type CdnFailure = 'not-cdn' | 'gone' | 'http' | 'network' | 'timeout' | 'not-image' | 'too-large';

export type CdnResult =
  | { ok: true; via: 'instapost:cdn-fetch'; blob: Blob; status: number }
  | { ok: false; why: CdnFailure; status: number | null };

/** 403, 404 and 410: the signed URL expired or churned (R34); the next candidate may still work. */
export const isGone = (status: number | null): boolean => status === 403 || status === 404 || status === 410;

const isImage = async (blob: Blob): Promise<boolean> => {
  if (blob.type.toLowerCase().startsWith('image/')) return true;
  const mime = sniffImageMime(new Uint8Array(await blob.slice(0, 64).arrayBuffer()));
  return mime !== null && mime !== 'image/heic';
};

export async function cdnFetch(url: string, maxBytes: number): Promise<CdnResult> {
  if (!isCdnImageUrl(url)) return { ok: false, why: 'not-cdn', status: null };
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    mode: 'cors',
    cache: 'default',
    signal: AbortSignal.timeout(CDN_TIMEOUT_MS),
  }).catch((err: unknown) => err);
  if (!(res instanceof Response)) {
    const name = (res as { name?: unknown } | null)?.name;
    return { ok: false, why: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', status: null };
  }
  if (!res.ok) return { ok: false, why: isGone(res.status) ? 'gone' : 'http', status: res.status };
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return { ok: false, why: 'too-large', status: res.status };
  const blob = await res.blob().catch(() => null);
  if (!blob) return { ok: false, why: 'network', status: res.status };
  if (blob.size > maxBytes) return { ok: false, why: 'too-large', status: res.status };
  if (!(await isImage(blob))) return { ok: false, why: 'not-image', status: res.status };
  return { ok: true, via: 'instapost:cdn-fetch', blob, status: res.status };
}
