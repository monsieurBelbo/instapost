/**
 * Download exit (strategy §2.1 rank 3, §7.10): every export lands in `~/Downloads/instapost/`
 * via `downloads.download({url: objectURL, filename: 'instapost/…', saveAs: false,
 * conflictAction: 'uniquify'})`. The object URL is revoked once the download completes or fails.
 */
import { type DownloadsPort, downloads } from '../platform/downloads.ts';

export const DOWNLOAD_DIR = 'instapost';

const pad = (n: number): string => String(n).padStart(2, '0');

/** `instapost/<yyyy-mm-dd_HHMMss>_story.<ext>`, in local time. */
export function storyFilename(at: Date, ext: 'jpg' | 'png'): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${DOWNLOAD_DIR}/${date}_${time}_story.${ext}`;
}

/** The last path segment, for messages ("pick `instapost/<file>`"). Handles / and \. */
export const baseName = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

export interface ObjectUrls {
  create(blob: Blob): string;
  revoke(url: string): void;
}

const browserUrls: ObjectUrls = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
};

export interface StartedDownload {
  downloadId: number;
  /** Resolves on `complete`, rejects on `interrupted`. The object URL is revoked either way. */
  done: Promise<void>;
}

/**
 * Starts a download of `blob` to `filename` (relative to ~/Downloads). Rejects, after revoking the
 * URL, when the download cannot start. `done` never causes an unhandled rejection by itself.
 */
export async function downloadBlob(
  blob: Blob,
  filename: string,
  port: DownloadsPort = downloads,
  urls: ObjectUrls = browserUrls,
): Promise<StartedDownload> {
  const url = urls.create(blob);
  let downloadId: number;
  try {
    downloadId = await port.download(url, filename);
  } catch (err) {
    urls.revoke(url);
    throw err;
  }
  const done = port.whenComplete(downloadId).finally(() => urls.revoke(url));
  done.catch(() => undefined);
  return { downloadId, done };
}
