/** Thin wrapper over the downloads API (strategy §7.10 download.ts). */
import { browser } from 'wxt/browser';

export interface DownloadsPort {
  /** saveAs:false, conflictAction:'uniquify'. `filename` is relative to ~/Downloads, e.g. `instapost/…`. */
  download(url: string, filename: string): Promise<number>;
  /** Resolves when the download completes or rejects when it is interrupted. */
  whenComplete(downloadId: number): Promise<void>;
  /** The absolute path Chrome chose (after `uniquify`), or undefined if the item is gone. */
  filename(downloadId: number): Promise<string | undefined>;
  show(downloadId: number): void;
}

type DownloadState = 'in_progress' | 'interrupted' | 'complete';

export const downloads: DownloadsPort = {
  async download(url, filename) {
    return await browser.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  },
  whenComplete(downloadId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (state: DownloadState | undefined): void => {
        if (settled || (state !== 'complete' && state !== 'interrupted')) return;
        settled = true;
        browser.downloads.onChanged.removeListener(l);
        if (state === 'complete') resolve();
        else reject(new Error(`download ${downloadId} interrupted`));
      };
      const l = (d: { id: number; state?: { current?: string } }) => {
        if (d.id === downloadId) settle(d.state?.current as DownloadState | undefined);
      };
      browser.downloads.onChanged.addListener(l);
      // A small blob can finish before the listener exists: read the current state once.
      browser.downloads.search({ id: downloadId }).then(
        ([item]) => settle(item?.state as DownloadState | undefined),
        () => undefined,
      );
    });
  },
  async filename(downloadId) {
    const [item] = await browser.downloads.search({ id: downloadId });
    return item?.filename || undefined;
  },
  show(downloadId) {
    browser.downloads.show(downloadId);
  },
};
