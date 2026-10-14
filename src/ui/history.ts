/**
 * History (ux.md §4.11, IU9): the last 50 hand-off records from IndexedDB `handoffs`, joined with their
 * exports for thumbnails (exports are pruned after 30 days: a grey placeholder then), grouped by day; and
 * the duplicate guard (K8/K12) `storyStatus`: the same story (export SHA-256 or doc version) posted, or
 * Couldn't confirm, in the last 24 h.
 */
import { signal } from '@preact/signals';
import type { HandoffMode, HandoffRecord, RunResult } from '../core/handoff/state.ts';
import { recentHandoffs } from '../handoff/records.ts';
import { getExport } from '../platform/idb.ts';
import { intlLocale, t } from './i18n.ts';

export const HISTORY_LIMIT = 50;
export const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type RowKind = 'posted' | 'notPosted' | 'unknown' | 'tested' | 'shareTested' | 'checked' | 'stopped';

export interface HistoryRow {
  id: string;
  mode: HandoffMode | 'probe';
  kind: RowKind;
  at: number;
  durationMs: number | null;
  account: string | null;
  code: string | null;
  exportId: string | null;
  exportSha256: string | null;
  docHash: string | null;
  marked: boolean;
  result: RunResult | null;
}

/** A record's result kind, for records of earlier builds too. */
export function rowKind(r: HandoffRecord): RowKind {
  if (r.result) return r.result.kind;
  switch (r.outcome) {
    case 'posted':
    case 'posted-confirmed':
      return 'posted';
    case 'unknown':
      return 'unknown';
    case 'tested':
      return 'tested';
    case 'share-tested':
      return 'shareTested';
    case 'checked':
      return 'checked';
    case 'cancelled':
    case 'abandoned':
      return 'stopped';
    default:
      return 'notPosted';
  }
}

export function toRow(r: HandoffRecord): HistoryRow {
  const code = r.result?.code ?? (r.outcome.includes(':') ? r.outcome.slice(r.outcome.indexOf(':') + 1) : null);
  return {
    id: r.id,
    mode: r.mode,
    kind: rowKind(r),
    at: r.result?.at ?? r.endedAt,
    durationMs: r.durationMs ?? (r.endedAt > r.startedAt ? r.endedAt - r.startedAt : null),
    account: r.result?.account ?? r.account?.detected ?? null,
    code,
    exportId: r.exportId,
    exportSha256: r.exportSha256 ?? null,
    docHash: r.docHash ?? null,
    marked: r.markedBy === 'owner' || r.result?.markedBy === 'owner',
    result: r.result ?? null,
  };
}

/**
 * K8/K12: this story's latest post-mode run in the last 24 h, by the export's SHA-256 or the doc version:
 * Couldn't confirm (`unknown`, not marked) or Posted. Tests and checks never count.
 */
export function storyStatus(
  sha256: string | null,
  docHash: string | null,
  now: number,
  rows: readonly HistoryRow[],
): { kind: 'unknown' | 'posted'; at: number } | null {
  if (!sha256 && !docHash) return null;
  const match = rows
    .filter(
      (r) =>
        r.mode === 'post' &&
        now - r.at < DUPLICATE_WINDOW_MS &&
        ((sha256 !== null && r.exportSha256 === sha256) || (docHash !== null && r.docHash === docHash)),
    )
    .sort((a, b) => b.at - a.at)[0];
  if (!match) return null;
  if (match.kind === 'unknown') return { kind: 'unknown', at: match.at };
  if (match.kind === 'posted') return { kind: 'posted', at: match.at };
  return null;
}

export const historyRows = signal<HistoryRow[]>([]);
/** Thumbnail object URLs by export id (null: the export was pruned). */
export const thumbs = signal<Record<string, string | null>>({});

/** Reads History from IndexedDB (the editor reads it directly, IB5). */
export async function refreshHistory(): Promise<void> {
  try {
    const records = await recentHandoffs(HISTORY_LIMIT);
    historyRows.value = records.map(toRow);
    const known = thumbs.value;
    const next: Record<string, string | null> = { ...known };
    for (const r of records) {
      if (!r.exportId || r.exportId in next) continue;
      const e = await getExport(r.exportId).catch(() => undefined);
      next[r.exportId] = e ? URL.createObjectURL(e.blob) : null;
    }
    thumbs.value = next;
  } catch (err) {
    console.warn('[instapost] history unavailable', err);
  }
}

/** Groups rows by local day: Today, Yesterday, or a date. */
export function dayLabel(time: number, now: number): string {
  const day = (x: number) => new Date(x).setHours(0, 0, 0, 0);
  const d = day(time);
  const today = day(now);
  if (d === today) return t('date.today');
  if (d === day(today - 12 * 60 * 60 * 1000)) return t('date.yesterday');
  return new Date(time).toLocaleDateString(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
}
