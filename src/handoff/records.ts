/**
 * Hand-off log records in IndexedDB `handoffs` (strategy §3.6 "Handoff record", §3.9 item 1)
 * and the export lookup for `serveFile`. The settings page shows the last 20 records.
 */
import type { HandoffOutcome, HandoffRecord } from '../core/handoff/state.ts';
import type { ExportId, HandoffId } from '../core/model/ids.ts';
import { db, getExport } from '../platform/idb.ts';

export interface RecordStore {
  put(record: HandoffRecord): Promise<void>;
  /** A late "Posted?" answer; a missing record is left alone. */
  patchOutcome(id: HandoffId, outcome: HandoffOutcome): Promise<void>;
}

export const idbRecords: RecordStore = {
  async put(record) {
    await (await db()).put('handoffs', record);
  },
  async patchOutcome(id, outcome) {
    const tx = (await db()).transaction('handoffs', 'readwrite');
    const found = await tx.store.get(id);
    if (found) await tx.store.put({ ...found, outcome });
    await tx.done;
  },
};

/** The most recent records, newest first. */
export async function recentHandoffs(limit = 20): Promise<HandoffRecord[]> {
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
