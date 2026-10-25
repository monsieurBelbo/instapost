/**
 * Observational webRequest listeners for the in-page engine frame (docs/inpage.md §3.14 source 1, OD19).
 * The `webRequest` permission is for this alone (check-bundle T1 documents the allowance).
 *
 * Filter: `sub_frame` requests to www and i. Nothing is blocked, no body is read, and no request header is
 * looked at: only the frame's id, its URLs, redirect targets, the status, whether the response carried
 * `X-Frame-Options`, and network errors. The listeners must be registered in the worker's first turn (MV3),
 * so they also wake the worker for www sub_frames in other tabs; the frame watch drops those.
 */
import { browser } from 'wxt/browser';

export type FrameRequestEvent =
  | { kind: 'before'; tabId: number; frameId: number; parentFrameId: number; url: string; documentId?: string }
  | {
      kind: 'redirect';
      tabId: number;
      frameId: number;
      parentFrameId: number;
      url: string;
      redirectUrl: string;
      status: number;
    }
  | {
      kind: 'headers';
      tabId: number;
      frameId: number;
      parentFrameId: number;
      url: string;
      status: number;
      xfo: string | null;
    }
  | { kind: 'completed'; tabId: number; frameId: number; parentFrameId: number; url: string; status: number }
  | { kind: 'error'; tabId: number; frameId: number; parentFrameId: number; url: string; error: string };

const FILTER = {
  urls: ['https://www.instagram.com/*', 'https://i.instagram.com/*'],
  types: ['sub_frame'],
};

interface Details {
  tabId: number;
  frameId: number;
  parentFrameId: number;
  url: string;
  documentId?: string;
  statusCode?: number;
  redirectUrl?: string;
  error?: string;
  responseHeaders?: { name: string; value?: string }[];
}

/** Registers the five listeners; `listener` gets every sub_frame event for www and i, in any tab. */
export function listenFrameRequests(listener: (e: FrameRequestEvent) => void): void {
  const wr = browser.webRequest as unknown as {
    onBeforeRequest: { addListener(cb: (d: Details) => void, filter: unknown): void };
    onBeforeRedirect: { addListener(cb: (d: Details) => void, filter: unknown): void };
    onHeadersReceived: { addListener(cb: (d: Details) => void, filter: unknown, spec?: string[]): void };
    onCompleted: { addListener(cb: (d: Details) => void, filter: unknown): void };
    onErrorOccurred: { addListener(cb: (d: Details) => void, filter: unknown): void };
  };
  const base = (d: Details) => ({ tabId: d.tabId, frameId: d.frameId, parentFrameId: d.parentFrameId, url: d.url });
  const safe = (e: FrameRequestEvent) => {
    try {
      listener(e);
    } catch {
      // The frame watch never throws; a bug there must not break the other listeners.
    }
  };
  wr.onBeforeRequest.addListener(
    (d) => safe({ kind: 'before', ...base(d), ...(d.documentId ? { documentId: d.documentId } : {}) }),
    FILTER,
  );
  wr.onBeforeRedirect.addListener(
    (d) => safe({ kind: 'redirect', ...base(d), redirectUrl: d.redirectUrl ?? '', status: d.statusCode ?? 0 }),
    FILTER,
  );
  wr.onHeadersReceived.addListener(
    (d) => {
      const xfo = d.responseHeaders?.find((h) => h.name.toLowerCase() === 'x-frame-options')?.value ?? null;
      safe({ kind: 'headers', ...base(d), status: d.statusCode ?? 0, xfo });
    },
    FILTER,
    ['responseHeaders'],
  );
  wr.onCompleted.addListener((d) => safe({ kind: 'completed', ...base(d), status: d.statusCode ?? 0 }), FILTER);
  wr.onErrorOccurred.addListener((d) => safe({ kind: 'error', ...base(d), error: d.error ?? 'unknown' }), FILTER);
}
