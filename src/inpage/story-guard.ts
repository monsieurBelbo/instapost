/**
 * RL-13: the in-page duplicate guard (K8, K12; strategy R19), over the stored run records (storage.local
 * `inpageRecords`), so it survives the page load that View story and Check my story cause. Pure.
 *
 * A post's record carries its export's SHA-256 and doc hash (`photo.sha256`, `photo.docHash`, from the
 * composer). The story on the stage matches a record by either. Within 24 h, its latest post-mode run decides:
 * Couldn't confirm (not marked) → `unknown` (K8); Posted, or marked "It posted" by the owner → `posted` (K12);
 * marked "It didn't post", or anything else → no guard. Tests and checks never count.
 */
import type { InpageRecord } from './driver.ts';
import { type ResultKind, resultKind } from './run-view.ts';

export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The owner's correction of a Couldn't confirm (the result's It posted · It didn't post links). */
export type OwnerMark = 'posted' | 'notPosted';
export const OWNER_MARKS: readonly OwnerMark[] = ['posted', 'notPosted'];

/** The story on the stage, as its export identifies it. */
export interface StoryId {
  sha256: string | null;
  docHash: string | null;
}

export interface StoryStatus {
  kind: 'unknown' | 'posted';
  at: number;
  runId: string;
}

const endOf = (r: Pick<InpageRecord, 'endedAt' | 'startedAt'>): number => r.endedAt ?? r.startedAt;

/** A record's kind as History and the guard read it: the owner's mark wins over what the run reported. */
export function markedKind(r: InpageRecord): ResultKind | null {
  if (r.mark === 'posted') return 'posted';
  if (r.mark === 'notPosted') return 'failed';
  return resultKind(r);
}

export function storyStatus(story: StoryId | null, now: number, records: readonly InpageRecord[]): StoryStatus | null {
  if (!story || (!story.sha256 && !story.docHash)) return null;
  const match = records
    .filter(
      (r) =>
        r.mode === 'post' &&
        r.photo !== null &&
        now - endOf(r) < DUPLICATE_WINDOW_MS &&
        ((story.sha256 !== null && r.photo.sha256 === story.sha256) ||
          (story.docHash !== null && r.photo.docHash === story.docHash)),
    )
    .sort((a, b) => endOf(b) - endOf(a))[0];
  if (!match) return null;
  const kind = markedKind(match);
  if (kind === 'unknown' || kind === 'posted') return { kind, at: endOf(match), runId: match.runId };
  return null;
}

/** The records with the owner's mark on `runId` (a post's Couldn't confirm only; others are left as they are). */
export function applyMark<R extends InpageRecord>(
  records: readonly R[],
  runId: string,
  mark: OwnerMark,
  at: number,
): R[] {
  return records.map((r) =>
    r.runId === runId && r.mode === 'post' && resultKind(r) === 'unknown' ? { ...r, mark, markedAt: at } : r,
  );
}

/** Adds (or replaces, by runId) a record in a list kept oldest first. */
export function withRecord<R extends InpageRecord>(records: readonly R[], rec: R): R[] {
  return [...records.filter((r) => r.runId !== rec.runId), rec];
}
