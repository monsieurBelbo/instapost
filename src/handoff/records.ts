/**
 * Hand-off log records in IndexedDB `handoffs` (strategy §3.6, §3.9 item 1; ux.md §4.11) and the export
 * lookup for `serveFile`. History reads the last 50 records straight from IndexedDB (src/ui/history.ts).
 */
import type { HandoffOutcome, HandoffRecord, RunResult } from '../core/handoff/state.ts';
import type { ExportId, HandoffId } from '../core/model/ids.ts';
import { db, getExport } from '../platform/idb.ts';

export interface RecordStore {
  put(record: HandoffRecord): Promise<void>;
  /** A later result for a written record (Finish by hand, a late answer, a kill); a missing record is left alone. */
  patchOutcome(
    id: HandoffId,
    outcome: HandoffOutcome,
    result: RunResult,
    patch?: Partial<HandoffRecord>,
  ): Promise<void>;
  /**
   * History's "It posted / It didn't post" (ux.md §4.7): applied only to a Couldn't confirm record (outcome
   * `unknown`, or a pre-v7 `abandoned`/`not-posted`/`posted-confirmed` one). Returns whether it applied.
   */
  mark(id: HandoffId, posted: boolean, at: number): Promise<boolean>;
}

const MARKABLE: readonly HandoffOutcome[] = ['unknown', 'posted-confirmed', 'not-posted', 'abandoned'];

export const idbRecords: RecordStore = {
  async put(record) {
    await (await db()).put('handoffs', record);
  },
  async patchOutcome(id, outcome, result, patch = {}) {
    const tx = (await db()).transaction('handoffs', 'readwrite');
    const found = await tx.store.get(id);
    if (found) await tx.store.put({ ...found, ...patch, outcome, result });
    await tx.done;
  },
  async mark(id, posted, at) {
    const tx = (await db()).transaction('handoffs', 'readwrite');
    const found = await tx.store.get(id);
    const markable = found !== undefined && (found.result?.kind === 'unknown' || MARKABLE.includes(found.outcome));
    if (found && markable && !found.result?.killed) {
      const outcome: HandoffOutcome = posted ? 'posted' : 'not-posted';
      // AP-3: the result says it is the owner's mark, so nothing renders it as Instagram's confirmation.
      const result: RunResult = found.result
        ? { ...found.result, kind: posted ? 'posted' : 'notPosted', at, markedBy: 'owner' }
        : { kind: posted ? 'posted' : 'notPosted', alarms: [], at, markedBy: 'owner' };
      await tx.store.put({ ...found, outcome, result, markedBy: 'owner' });
    }
    await tx.done;
    return markable && found !== undefined && !found.result?.killed;
  },
};

/** The most recent records, newest first. */
export async function recentHandoffs(limit = 50): Promise<HandoffRecord[]> {
  const out: HandoffRecord[] = [];
  const tx = (await db()).transaction('handoffs');
  let cursor = await tx.store.index('byStartedAt').openCursor(null, 'prev');
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return out;
}

/** The file served to the agent's `agent/get-file`. */
export interface ExportFile {
  bytes: Uint8Array;
  mime: string;
}

export type ExportSource = (id: ExportId) => Promise<ExportFile | undefined>;

export const idbExports: ExportSource = async (id) => {
  const record = await getExport(id);
  if (!record) return undefined;
  return { bytes: new Uint8Array(await record.blob.arrayBuffer()), mime: record.mime || record.blob.type };
};

/** ux.md IB5: exports older than this are pruned at startup (History shows a grey placeholder). */
export const EXPORT_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** Deletes exports created before `now - EXPORT_KEEP_MS`. Returns how many went. */
export async function pruneExports(now: number): Promise<number> {
  const tx = (await db()).transaction('exports', 'readwrite');
  let n = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.createdAt < now - EXPORT_KEEP_MS) {
      await cursor.delete();
      n++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return n;
}
