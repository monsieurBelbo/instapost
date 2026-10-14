/**
 * IndexedDB schema and opener (strategy §3.3), via `idb`.
 * Stores: assets (original blobs by SHA-256), docs (StoryDoc), exports, handoffs (records).
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { ExportPurpose } from '../core/export/policy.ts';
import type { HandoffRecord } from '../core/handoff/state.ts';
import type { AssetId, DocId, ExportId, FrameId } from '../core/model/ids.ts';
import type { StoryDoc } from '../core/model/story.ts';

export const DB_NAME = 'instapost';
export const DB_VERSION = 1;

export interface AssetRecord {
  id: AssetId;
  blob: Blob;
  w: number;
  h: number;
  mime: string;
  createdAt: number;
}

export interface ExportRecord {
  id: ExportId;
  docId: DocId;
  frameId: FrameId;
  /** Hash of the StoryDoc state that produced this export. */
  docHash: string;
  purpose: ExportPurpose;
  mime: string;
  w: number;
  h: number;
  bytes: number;
  sha256: string;
  blob: Blob;
  createdAt: number;
}

export interface InstapostDB extends DBSchema {
  assets: { key: AssetId; value: AssetRecord };
  docs: { key: DocId; value: StoryDoc };
  exports: { key: ExportId; value: ExportRecord; indexes: { byDoc: DocId } };
  handoffs: { key: string; value: HandoffRecord; indexes: { byStartedAt: number } };
}

export type Db = IDBPDatabase<InstapostDB>;

type OpenHooks = Pick<NonNullable<Parameters<typeof openDB<InstapostDB>>[2]>, 'blocking' | 'terminated'>;

export function openInstapostDb(hooks: OpenHooks = {}): Promise<Db> {
  return openDB<InstapostDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('assets', { keyPath: 'id' });
        db.createObjectStore('docs', { keyPath: 'id' });
        db.createObjectStore('exports', { keyPath: 'id' }).createIndex('byDoc', 'docId');
        db.createObjectStore('handoffs', { keyPath: 'id' }).createIndex('byStartedAt', 'startedAt');
      }
    },
    ...hooks,
  });
}

let shared: Promise<Db> | null = null;

/**
 * One shared connection per realm, opened on first use. If a newer schema version is opened
 * elsewhere (another tab, an updated service worker), it closes itself so the upgrade can run,
 * and the next call reopens.
 */
export function db(): Promise<Db> {
  if (!shared) {
    const p = openInstapostDb({
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase | null)?.close();
        if (shared === p) shared = null;
      },
      terminated() {
        if (shared === p) shared = null;
      },
    });
    shared = p;
    p.catch(() => {
      if (shared === p) shared = null;
    });
  }
  return shared;
}

/** Stores an asset unless one with the same SHA-256 id exists (same bytes, so nothing to update). */
export async function putAssetIfAbsent(record: AssetRecord): Promise<void> {
  const tx = (await db()).transaction('assets', 'readwrite');
  if ((await tx.store.getKey(record.id)) === undefined) await tx.store.put(record);
  await tx.done;
}

export async function getAsset(id: AssetId): Promise<AssetRecord | undefined> {
  return await (await db()).get('assets', id);
}

export async function putDoc(doc: StoryDoc): Promise<void> {
  await (await db()).put('docs', doc);
}

export async function putExport(record: ExportRecord): Promise<void> {
  await (await db()).put('exports', record);
}

export async function getExport(id: ExportId): Promise<ExportRecord | undefined> {
  return await (await db()).get('exports', id);
}

export async function getDoc(id: string): Promise<StoryDoc | undefined> {
  return await (await db()).get('docs', id);
}

/** ux.md §4.3 Recent photos: the newest originals first (at most `limit`). */
export async function recentAssets(limit: number): Promise<AssetRecord[]> {
  const all = await (await db()).getAll('assets');
  return all.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

/** ux.md §4.3: originals are kept 30 days or 50 items, whichever is fewer. */
export async function pruneAssets(now: number, keepMs: number, keep: number): Promise<void> {
  const tx = (await db()).transaction('assets', 'readwrite');
  const all = (await tx.store.getAll()).sort((a, b) => b.createdAt - a.createdAt);
  for (const [i, a] of all.entries()) if (i >= keep || a.createdAt < now - keepMs) await tx.store.delete(a.id);
  await tx.done;
}
