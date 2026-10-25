/**
 * The engine frame as webRequest sees it (docs/inpage.md §3.14 source 1), for one run's tab. No chrome
 * APIs: the background feeds it the events of src/platform/web-request.ts.
 *
 * Once armed for a tab, the first www `sub_frame` request whose parent is the top frame (parentFrameId 0)
 * names the engine frame (its frameId). Every later event of that frame is tracked: its document URLs
 * (redirect targets included, even off-host ones), the status, the `X-Frame-Options` it arrived with, and
 * network errors. Other www sub_frames of the top frame in that tab are counted (N9: desktop Instagram is
 * not known to embed any); events of other tabs are dropped.
 */
import type { FrameRequestEvent } from '../platform/web-request.ts';

export interface FrameWatchSnapshot {
  tabId: number | null;
  frameId: number | null;
  /** Every document URL of the engine frame, redirect targets included, in order (at most 20). */
  urls: string[];
  /** The last document's HTTP status. */
  status: number | null;
  /** `X-Frame-Options` as webRequest saw it on the first document's response (before or after dNR: N2). */
  xfoSeen: string | null;
  error: string | null;
  /** The first document's request completed (or failed). */
  settled: boolean;
  /** www sub_frames of the top frame in this tab that were not the engine frame (N9). */
  otherSubFrames: number;
}

export type FrameWatchUpdate =
  | { kind: 'frame-id'; frameId: number }
  /** A later navigation of the engine frame, or a redirect target: the URL to classify. */
  | { kind: 'navigated'; url: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'settled' };

const MAX_URLS = 20;

export interface FrameWatch {
  arm(tabId: number): void;
  disarm(): void;
  /** Feeds one event; returns what changed for the run, if anything. */
  onEvent(e: FrameRequestEvent): FrameWatchUpdate | null;
  snapshot(): FrameWatchSnapshot;
}

export function createFrameWatch(): FrameWatch {
  let s: FrameWatchSnapshot = blank(null);
  let armed = false;

  function blank(tabId: number | null): FrameWatchSnapshot {
    return {
      tabId,
      frameId: null,
      urls: [],
      status: null,
      xfoSeen: null,
      error: null,
      settled: false,
      otherSubFrames: 0,
    };
  }
  const push = (url: string) => {
    if (s.urls.length < MAX_URLS) s.urls.push(url);
  };

  return {
    arm(tabId) {
      s = blank(tabId);
      armed = true;
    },
    disarm() {
      armed = false;
    },
    snapshot: () => ({ ...s, urls: [...s.urls] }),
    onEvent(e) {
      if (!armed || e.tabId !== s.tabId || e.parentFrameId !== 0) return null;
      if (s.frameId === null) {
        if (e.kind !== 'before') return null;
        s.frameId = e.frameId;
        push(e.url);
        return { kind: 'frame-id', frameId: e.frameId };
      }
      if (e.frameId !== s.frameId) {
        if (e.kind === 'before') s.otherSubFrames++;
        return null;
      }
      switch (e.kind) {
        case 'before':
          // A new document request of the engine frame after its first one settled (a full navigation).
          if (s.urls.at(-1) === e.url && !s.settled) return null;
          push(e.url);
          return s.settled ? { kind: 'navigated', url: e.url } : null;
        case 'redirect':
          push(e.redirectUrl);
          s.status = e.status;
          return { kind: 'redirect', url: e.redirectUrl };
        case 'headers':
          s.status = e.status;
          if (!s.settled && s.xfoSeen === null) s.xfoSeen = e.xfo;
          return null;
        case 'completed':
          s.status = e.status;
          if (s.settled) return null;
          s.settled = true;
          return { kind: 'settled' };
        case 'error':
          s.error = e.error;
          if (s.settled) return null;
          s.settled = true;
          return { kind: 'settled' };
      }
    },
  };
}
