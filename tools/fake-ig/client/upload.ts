/**
 * Share, as Instagram's `PolarisStoryCreationActions.uploadStory` does it (ux.md §6.1, IF5; the saved msite
 * bundles, 2026-10-13):
 *
 * 1. the canvas as a JPEG (the caller), then the photo upload: an XHR `POST
 *    https://i.instagram.com/rupload_igphoto/fb_uploader_<upload id>` with credentials, Instagram's rupload
 *    headers and no timeout (`PolarisAPIFbUploaderPhoto`); only a 2xx continues;
 * 2. the publish request: an XHR `POST /api/v1/media/configure_to_story/` on the page's own host, a form
 *    body (`caption`, `configure_mode=1`, `share_to_facebook`, `upload_id`, …) and a 60 s timeout
 *    (`PolarisAPICreationFinalizeStory`); Instagram's client treats any 2xx JSON as success;
 * 3. on success, the tray refresh (`POST /graphql/query`, then home: the caller).
 *
 * The answers that never settle into "Upload failed." are modelled too: a `checkpoint_url` (a full
 * navigation, the kill switch's case), `require_login` (to the login page) and `feedback_required` (a
 * dialog). The fake's own metadata (FakeShareMeta) rides on the upload as `x-fake-meta`.
 */
import { FAKE_META_HEADER, FAKE_PATHS, type FakeShareMeta, realWriteTargets } from '../protocol.ts';

export interface XhrResult {
  /** 0: a network error, a blocked or cut-off request, a CORS failure, a timeout. */
  status: number;
  contentType: string;
  body: string;
}

function xhr(
  method: 'POST',
  url: string,
  o: { headers: Record<string, string>; body: XMLHttpRequestBodyInit; credentials: boolean; timeoutMs: number },
): Promise<XhrResult> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.withCredentials = o.credentials;
    if (o.timeoutMs > 0) x.timeout = o.timeoutMs;
    for (const [k, v] of Object.entries(o.headers)) x.setRequestHeader(k, v);
    const fail = () => resolve({ status: 0, contentType: '', body: '' });
    x.onload = () =>
      resolve({ status: x.status, contentType: x.getResponseHeader('content-type') ?? '', body: x.responseText });
    x.onerror = fail;
    x.ontimeout = fail;
    x.onabort = fail;
    x.send(o.body);
  });
}

const isJson = (type: string) => /^application\/(?:[\w.+-]*\+)?json\b/i.test(type.trim());

function parse(body: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(body);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type UploadOutcome =
  | { kind: 'published'; mediaId: string }
  /** The "Upload failed." toast with Retry. `stage`: which request did not answer with success. */
  | { kind: 'failed'; stage: 'upload' | 'publish'; status: number }
  | { kind: 'checkpoint'; url: string }
  | { kind: 'login' }
  | { kind: 'feedback' };

export interface UploadInput {
  jpeg: Blob;
  uploadId: string;
  size: { w: number; h: number };
  meta: FakeShareMeta;
  /** `share_to_facebook=true` (automatic crossposting). */
  shareToFacebook: boolean;
  /** Called between the two requests (Instagram logs compose_finalize_attempt there). */
  onStaged?: () => void;
}

/** Runs the upload and the publish request; resolves with what Instagram's client would do next. */
export async function uploadStory(i: UploadInput): Promise<UploadOutcome> {
  const target = realWriteTargets(i.uploadId);
  const entityName = `fb_uploader_${i.uploadId}`;
  const up = await xhr('POST', target.rupload, {
    credentials: true,
    timeoutMs: 0,
    body: i.jpeg,
    headers: {
      Offset: '0',
      'X-Entity-Length': String(i.jpeg.size),
      'X-Entity-Name': entityName,
      'X-Entity-Type': 'image/jpeg',
      'X-Instagram-Rupload-Params': JSON.stringify({
        media_type: 1,
        upload_id: i.uploadId,
        upload_media_height: i.size.h,
        upload_media_width: i.size.w,
      }),
      'X-IG-App-ID': '1217981644879628',
      [FAKE_META_HEADER]: JSON.stringify(i.meta),
    },
  });
  if (up.status < 200 || up.status > 299) return { kind: 'failed', stage: 'upload', status: up.status };
  i.onStaged?.();
  const form = new URLSearchParams({
    caption: '',
    configure_mode: '1',
    share_to_facebook: i.shareToFacebook ? 'true' : '',
    share_to_fb_destination_id: i.shareToFacebook ? 'fake_fb_destination' : '',
    share_to_fb_destination_type: 'USER',
    upload_id: i.uploadId,
  });
  const pub = await xhr('POST', target.configure, {
    credentials: true,
    timeoutMs: 60_000,
    body: form.toString(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'X-CSRFToken': 'fake-csrf',
      'X-IG-App-ID': '1217981644879628',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  const json = isJson(pub.contentType) ? parse(pub.body) : null;
  if (pub.status >= 200 && pub.status <= 299 && json) {
    const media = json.media as { pk?: unknown } | undefined;
    return { kind: 'published', mediaId: String(media?.pk ?? '') };
  }
  if (json && typeof json.checkpoint_url === 'string') return { kind: 'checkpoint', url: json.checkpoint_url };
  if (json && json.require_login === true) return { kind: 'login' };
  if (json && json.message === 'feedback_required') return { kind: 'feedback' };
  return { kind: 'failed', stage: 'publish', status: pub.status };
}

/** IF6: Instagram's tray refresh after a published story; resolves whether or not it succeeded. */
export async function refreshTray(): Promise<number> {
  const r = await xhr('POST', FAKE_PATHS.graphql, {
    credentials: true,
    timeoutMs: 10_000,
    body: new URLSearchParams({ doc_id: 'fake_reels_tray' }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-CSRFToken': 'fake-csrf' },
  });
  return r.status;
}
