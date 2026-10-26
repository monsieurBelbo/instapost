/**
 * Drafts and recent photos (ux.md §4.3, IU2): the doc autosaves to IndexedDB `docs` 500 ms after a change
 * (its id in storage.local `lastDocId`), so a closed tab never loses an edit; Recent photos lists the last
 * 8 originals (IndexedDB `assets`, kept 30 days or 50 items).
 */
import { signal } from '@preact/signals';
import type { StoryDoc } from '../core/model/story.ts';
import { type AssetRecord, getAsset, getDoc, pruneAssets, putDoc, recentAssets } from '../platform/idb.ts';
import { local } from '../platform/storage.ts';
import { doc, image, imageLayer, loadImageFile, restoreDraft, transient } from './editor-state.ts';

export const AUTOSAVE_MS = 500;
export const RECENT_COUNT = 8;
const ASSET_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const ASSET_KEEP = 50;

export interface RecentPhoto {
  id: string;
  url: string;
  createdAt: number;
}

export const recentPhotos = signal<RecentPhoto[]>([]);
/** The saved draft, when it is not the doc on screen. */
export const savedDraft = signal<{ doc: StoryDoc; savedAt: number } | null>(null);

let timer: ReturnType<typeof setTimeout> | null = null;

/** Called on every doc change: saves 500 ms after the last one (only a doc with a photo; never a repost, AM59). */
export function scheduleAutosave(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const d = doc.value;
    if (!imageLayer.value || transient.value) return;
    void putDoc(d)
      .then(() => local.set('lastDocId', d.id))
      .catch((err: unknown) => console.warn('[instapost] draft not saved', err));
  }, AUTOSAVE_MS);
}

function toRecent(a: AssetRecord): RecentPhoto {
  return { id: a.id, url: URL.createObjectURL(a.blob), createdAt: a.createdAt };
}

/** Loads Recent photos and the saved draft (once, at start). */
export async function loadDrafts(): Promise<void> {
  try {
    await pruneAssets(Date.now(), ASSET_KEEP_MS, ASSET_KEEP);
  } catch {
    // Pruning is housekeeping only.
  }
  try {
    const assets = await recentAssets(RECENT_COUNT);
    for (const old of recentPhotos.value) URL.revokeObjectURL(old.url);
    recentPhotos.value = assets.map(toRecent);
  } catch (err) {
    console.warn('[instapost] recent photos unavailable', err);
  }
  try {
    const id = await local.get('lastDocId');
    if (typeof id !== 'string') return;
    const d = await getDoc(id);
    if (d && d.id !== doc.value.id) savedDraft.value = { doc: d, savedAt: d.updatedAt };
  } catch (err) {
    console.warn('[instapost] draft unavailable', err);
  }
}

/**
 * docs/repost.md RP-30: the story on the stage is saved now (a repost is about to replace it), and offered
 * as Continue draft. Resolves true when there was one to keep.
 */
export async function keepCurrentDraft(): Promise<boolean> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const d = doc.value;
  if (!imageLayer.value || transient.value) return false;
  try {
    await putDoc(d);
    await local.set('lastDocId', d.id);
    savedDraft.value = { doc: d, savedAt: d.updatedAt };
    return true;
  } catch (err) {
    console.warn('[instapost] draft not saved', err);
    return false;
  }
}

/**
 * Discard story: the doc `id` stops being the autosaved draft (a pending autosave is dropped; a different
 * draft offered as Continue draft, e.g. the one a repost replaced, is kept).
 */
export async function forgetDraft(id: string): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    if ((await local.get('lastDocId')) === id) await local.remove('lastDocId');
  } catch (err) {
    console.warn('[instapost] draft not forgotten', err);
  }
}

/** Recent photos: loads one as the story's photo. */
export async function pickRecent(id: string): Promise<void> {
  const a = await getAsset(id);
  if (a) await loadImageFile(a.blob, { assetId: a.id });
}

/** Continue draft: the saved doc with its original. */
export async function continueDraft(): Promise<void> {
  const draft = savedDraft.value;
  if (!draft) return;
  const layer = draft.doc.frames[0]?.layers.find((l) => l.kind === 'image');
  const asset = layer && layer.kind === 'image' ? await getAsset(layer.assetId) : undefined;
  await restoreDraft(draft.doc, asset?.blob ?? null);
  savedDraft.value = null;
}

/** Whether the import surface should show (no photo on the stage). */
export const needsPhoto = (): boolean => image.value === null;
