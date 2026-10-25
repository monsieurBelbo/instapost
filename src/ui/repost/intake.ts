/**
 * The repost's intake (docs/repost.md RP-20–RP-23): the permission, then at most 3 GETs per owner click
 * (cdn-fetch.ts): the widest media candidate, the next candidate once only after a 403/404/410, and the post's
 * avatar once, in parallel (a failure there is silent). Nothing is retried automatically. The bytes are
 * decoded in memory (never stored: no Recent photo, no draft, AM59).
 *
 * Outcomes: `permission` (not granted), `expired` (every media GET 403/404/410), `failed` (network, timeout,
 * not an image, too large, decode failed, narrower than 320), or the decoded photo and avatar.
 */
import type { RepostSource } from '../../core/repost/source.ts';
import { cdnGranted } from '../../platform/permissions.ts';
import { type DecodedImage, decodeImage } from '../../raster/decode.ts';
import { AVATAR_MAX_BYTES, type CdnResult, cdnFetch, isGone, MEDIA_MAX_BYTES } from './cdn-fetch.ts';

/** RP-23: narrower than this is a failure; narrower than LOW_RES shows the low-resolution notice. */
export const MIN_MEDIA_W = 320;
export const LOW_RES: Readonly<Record<RepostSource['kind'], number>> = { post: 640, mention: 720 };
export const MAX_GETS = 3;

export interface IntakeDeps {
  granted(): Promise<boolean>;
  /** One audited GET (cdn-fetch.ts). */
  get(url: string, maxBytes: number): Promise<CdnResult>;
  decode(blob: Blob): Promise<DecodedImage>;
  bitmap(blob: Blob): Promise<ImageBitmap>;
}

export const defaultIntakeDeps: IntakeDeps = {
  granted: cdnGranted,
  get: cdnFetch,
  decode: (blob) => decodeImage(blob),
  bitmap: (blob) => createImageBitmap(blob),
};

export type IntakeOutcome =
  | { ok: true; photo: DecodedImage; avatar: ImageBitmap | null; gets: number; lowRes: boolean }
  | { ok: false; state: 'permission' | 'expired' | 'failed'; why: string; gets: number };

const reason = (r: Extract<CdnResult, { ok: false }>): string => (r.status !== null ? `${r.why}-${r.status}` : r.why);

export async function loadRepostMedia(src: RepostSource, deps: IntakeDeps = defaultIntakeDeps): Promise<IntakeOutcome> {
  if (!(await deps.granted().catch(() => false)))
    return { ok: false, state: 'permission', why: 'not-granted', gets: 0 };
  let gets = 0;
  const avatarUrl = src.kind === 'post' ? src.avatar : null;
  let avatar: Promise<ImageBitmap | null> = Promise.resolve(null);
  if (avatarUrl) {
    gets++;
    avatar = deps
      .get(avatarUrl, AVATAR_MAX_BYTES)
      .then((r) => (r.ok ? deps.bitmap(r.blob) : null))
      .catch(() => null);
  }
  const [first, second] = src.media;
  if (!first) return { ok: false, state: 'failed', why: 'no-media', gets };
  gets++;
  let r = await deps.get(first.url, MEDIA_MAX_BYTES);
  if (!r.ok && isGone(r.status) && second) {
    gets++;
    r = await deps.get(second.url, MEDIA_MAX_BYTES);
  }
  if (!r.ok) {
    (await avatar)?.close();
    return { ok: false, state: r.why === 'gone' ? 'expired' : 'failed', why: reason(r), gets };
  }
  let photo: DecodedImage;
  try {
    photo = await deps.decode(r.blob);
  } catch {
    (await avatar)?.close();
    return { ok: false, state: 'failed', why: 'decode', gets };
  }
  if (photo.size.w < MIN_MEDIA_W) {
    photo.bitmap.close();
    (await avatar)?.close();
    return { ok: false, state: 'failed', why: 'too-small', gets };
  }
  return { ok: true, photo, avatar: await avatar, gets, lowRes: photo.size.w < LOW_RES[src.kind] };
}
