/**
 * How a run's result is decided (ux.md §6, strategy §11 AM40). Pure.
 *
 * After Share, Instagram's own client uploads the photo (`i.instagram.com/rupload_igphoto/fb_uploader_<id>`)
 * and then publishes it (`/api/v1/media/configure_to_story/`); its client treats any 2xx publish answer as
 * success. The agent reports every XHR/fetch resource timing entry that ends after the Share click
 * (host, pathname, responseStatus, contentType, redirect, offsets); this module classifies them here, in
 * the background, because the agent bundle may not contain write-endpoint strings (check-bundle T3).
 *
 * | Rule | Evidence after the Share click                                                  | Result            |
 * |------|---------------------------------------------------------------------------------|-------------------|
 * | O1   | publish 2xx, JSON content type, not redirected                                  | posted            |
 * | O2   | publish 4xx, not redirected                                                     | not posted        |
 * | O3   | publish 5xx, status 0, HTML or another type, or redirected (a login page is 200) | couldn't confirm  |
 * | O4   | no publish; the last upload ended non-2xx more than UPLOAD_SETTLE_MS ago        | not posted        |
 * | O5   | no publish PUBLISH_AFTER_UPLOAD_MS after a 2xx upload                           | couldn't confirm  |
 * | O6   | no upload entry UPLOAD_ENTRY_BUDGET_MS after Share                              | couldn't confirm  |
 * | O7   | more than one upload or publish                                                 | alarm, first wins |
 * | O9   | writes blocked: an upload with status 0 (blocked), no publish within the settle | share test passed |
 * | O9b  | writes blocked: an upload that reached a server (non-zero, non-2xx status)      | couldn't confirm  |
 * | O10  | writes blocked: any publish request, or a 2xx upload                            | TEST_LEAK         |
 * O8 (the window closed, the agent went silent, an unknown page, no answer to Share) is the reducer's.
 *
 * "Posted" is never returned for a redirect, HTML, status 0 or a 5xx. Going home is corroboration only:
 * Instagram goes home on any 2xx, so requiring it would add nothing and would turn real posts whose tray
 * refresh failed into Couldn't confirm.
 */
import { PUBLISH_PATHS, UPLOAD_PATH } from '../ig-contract/write-endpoints.ts';
import {
  type Alarm,
  type NetEntry,
  PUBLISH_AFTER_UPLOAD_MS,
  type UnknownWhy,
  UPLOAD_ENTRY_BUDGET_MS,
  UPLOAD_SETTLE_MS,
  type WindowedSession,
} from './state.ts';

export type NetClass = 'upload' | 'publish' | 'other';

/** Which of Instagram's two write requests an entry is, if any. */
export function classifyEntry(e: Pick<NetEntry, 'host' | 'path'>): NetClass {
  if (e.host === 'i' && UPLOAD_PATH.test(e.path)) return 'upload';
  if (e.host === 'www' && PUBLISH_PATHS.includes(e.path)) return 'publish';
  return 'other';
}

/** A pathname for records and Details: query already dropped by the agent; every digit run becomes `<n>`. */
export function normalizePath(path: string): string {
  return path.replace(/\d+/g, '<n>').slice(0, 200);
}

export const isOk = (status: number): boolean => status >= 200 && status <= 299;
const isJson = (type: string): boolean => /^application\/(?:[\w.+-]*\+)?json\b/i.test(type.trim());

export interface OutcomeBudgets {
  uploadEntryMs: number;
  publishAfterUploadMs: number;
  settleMs: number;
}

export const DEFAULT_BUDGETS: OutcomeBudgets = {
  uploadEntryMs: UPLOAD_ENTRY_BUDGET_MS,
  publishAfterUploadMs: PUBLISH_AFTER_UPLOAD_MS,
  settleMs: UPLOAD_SETTLE_MS,
};

/** The budgets shrunk by a guarded E2E scale (0 < scale < 1); anything else keeps the defaults. */
export function scaledBudgets(scale: number | undefined): OutcomeBudgets {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale >= 1) return DEFAULT_BUDGETS;
  return {
    uploadEntryMs: Math.round(UPLOAD_ENTRY_BUDGET_MS * scale),
    publishAfterUploadMs: Math.round(PUBLISH_AFTER_UPLOAD_MS * scale),
    settleMs: UPLOAD_SETTLE_MS,
  };
}

export type Decision =
  | { kind: 'pending'; alarms: Alarm[] }
  | { kind: 'posted'; alarms: Alarm[]; detail: string }
  | { kind: 'notPosted'; alarms: Alarm[]; detail: string }
  /** `mayRun`: an upload may still be running (O5, O6): hold the window (§6.4). */
  | { kind: 'unknown'; alarms: Alarm[]; why: UnknownWhy; detail: string; mayRun: boolean }
  | { kind: 'shareTested'; alarms: Alarm[]; detail: string }
  | { kind: 'testLeak'; alarms: Alarm[]; detail: string };

const byEnd = (a: NetEntry, b: NetEntry): number => a.end - b.end;

/**
 * Decides from the entries seen after the Share click, `elapsedMs` after it. `writeBlocked`: a test (or
 * a guarded build) whose write-block rules should have stopped the upload (O9, O10).
 */
export function decide(
  entries: readonly NetEntry[],
  elapsedMs: number,
  writeBlocked: boolean,
  budgets: OutcomeBudgets = DEFAULT_BUDGETS,
): Decision {
  const uploads = entries.filter((e) => classifyEntry(e) === 'upload').sort(byEnd);
  const publishes = entries.filter((e) => classifyEntry(e) === 'publish').sort(byEnd);
  const alarms: Alarm[] = uploads.length > 1 || publishes.length > 1 ? ['DUPLICATE_UPLOAD'] : [];

  if (writeBlocked) {
    const pub = publishes[0];
    if (pub) return { kind: 'testLeak', alarms, detail: `publish ${pub.status}` };
    const ok = uploads.find((u) => isOk(u.status));
    if (ok) return { kind: 'testLeak', alarms, detail: `upload ${ok.status}` };
    const last = uploads.at(-1);
    if (last && elapsedMs - last.end >= budgets.settleMs) {
      // O9 only for a request the rules stopped (status 0). Any other status means it reached a server: the
      // block failed, and nothing proves the test (AP-8).
      const reached = uploads.find((u) => u.status !== 0);
      return reached
        ? { kind: 'unknown', alarms, why: 'not-blocked', detail: `upload ${reached.status}`, mayRun: false }
        : { kind: 'shareTested', alarms, detail: `upload ${last.status}` };
    }
    if (!last && elapsedMs >= budgets.uploadEntryMs) {
      return { kind: 'unknown', alarms, why: 'no-upload-seen', detail: 'no upload', mayRun: false };
    }
    return { kind: 'pending', alarms };
  }

  // O7: decide on the first publish request.
  const pub = publishes[0];
  if (pub) {
    const detail = `publish ${pub.status}${pub.type ? ` ${pub.type}` : ''}${pub.redirected ? ' redirected' : ''}`;
    if (pub.redirected) return { kind: 'unknown', alarms, why: 'redirected', detail, mayRun: false };
    if (isOk(pub.status)) {
      return isJson(pub.type)
        ? { kind: 'posted', alarms, detail }
        : { kind: 'unknown', alarms, why: 'configure-html', detail, mayRun: false };
    }
    if (pub.status >= 400 && pub.status <= 499) return { kind: 'notPosted', alarms, detail };
    if (pub.status >= 500) return { kind: 'unknown', alarms, why: 'configure-5xx', detail, mayRun: false };
    if (pub.status === 0) return { kind: 'unknown', alarms, why: 'configure-0', detail, mayRun: false };
    // 1xx/3xx without a redirect mark: not an answer instapost can read.
    return { kind: 'unknown', alarms, why: 'redirected', detail, mayRun: false };
  }

  const last = uploads.at(-1);
  if (last) {
    if (!isOk(last.status)) {
      // O4: Instagram's client publishes only after a 2xx upload and never retries it by itself.
      return elapsedMs - last.end > budgets.settleMs
        ? { kind: 'notPosted', alarms, detail: `upload ${last.status}` }
        : { kind: 'pending', alarms };
    }
    if (elapsedMs - last.end >= budgets.publishAfterUploadMs) {
      return {
        kind: 'unknown',
        alarms,
        why: 'no-finalize-after-upload',
        detail: `upload ${last.status}`,
        mayRun: true,
      };
    }
    return { kind: 'pending', alarms };
  }
  if (elapsedMs >= budgets.uploadEntryMs) {
    return { kind: 'unknown', alarms, why: 'no-upload-seen', detail: 'no upload', mayRun: true };
  }
  return { kind: 'pending', alarms };
}

/**
 * §6.4: a later entry while a Couldn't confirm is held: only a publish answer that decides O1 or O2 (or a
 * failed upload, O4) upgrades it; anything else leaves it as it is. Only for runs whose writes are not
 * blocked: the reducer decides a blocked run's late answer with `decide(…, true)` (O9, O10).
 */
export function decideLate(
  entries: readonly NetEntry[],
  budgets: OutcomeBudgets = DEFAULT_BUDGETS,
): Extract<Decision, { kind: 'posted' | 'notPosted' }> | null {
  const d = decide(entries, Number.MAX_SAFE_INTEGER / 2, false, budgets);
  return d.kind === 'posted' || d.kind === 'notPosted' ? d : null;
}

/** Any upload or publish request in these entries. */
export function sawWrite(entries: readonly NetEntry[]): boolean {
  return entries.some((e) => classifyEntry(e) !== 'other');
}

/**
 * ux.md §5: "Nothing was posted" may be said only when the Share command was never sent (or the agent
 * answered that it did not tap Share), the owner's own Share was not seen, and no upload or publish request
 * was seen.
 */
export function nothingPosted(
  s: Pick<WindowedSession, 'shareSent' | 'shareRefused' | 'sharedBy' | 'net'> | { shareSent?: undefined },
): boolean {
  if (s.shareSent === undefined) return true;
  const w = s as Pick<WindowedSession, 'shareSent' | 'shareRefused' | 'sharedBy' | 'net'>;
  return (!w.shareSent || w.shareRefused !== null) && w.sharedBy === null && !sawWrite(w.net);
}
