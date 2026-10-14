/**
 * The editor's actions (ux.md §4.5, §4.7, §7, IU12): Post story (queued behind the 60 s spacing), Test run
 * (and the setup test, with the calibration card when there is no photo), Share test, Check connection,
 * Stop, Send to phone…, Save copy, and the safety copy every failure after the export leaves in
 * Downloads/instapost.
 *
 * Every run uploads the export cache's PNG, never a stale render (export-cache.ts); it is written to
 * IndexedDB `exports` only when the run starts. The background decides the lock, the pace and a busy lane;
 * the editor renders them.
 */
import { signal } from '@preact/signals';
import type { HandoffMode } from '../core/handoff/state.ts';
import { newId } from '../core/model/ids.ts';
import { downloads } from '../platform/downloads.ts';
import { type ExportRecord, getExport, putExport } from '../platform/idb.ts';
import { baseName, downloadBlob, storyFilename } from '../publish/download.ts';
import { LANE_REASON_TEXT, laneFor } from '../publish/lane.ts';
import { canShareStory, shareFiles } from '../publish/share.ts';
import { calibrationCanvas, cornerMarkers } from '../raster/calibration.ts';
import { exportFrame } from '../raster/export.ts';
import { assetSize, busy, doc, errorNotice, frame, image, measurer, setNotice } from './editor-state.ts';
import { freshExport, storeExport } from './export-cache.ts';
import { sha256Hex } from './hash.ts';
import { lane, onResult, setResultCopy, startRun, stopRun } from './run-state.ts';
import { settings } from './settings-state.ts';

/** Whether this browser can share a story file (decided once). */
export const shareSupported = signal<boolean>(canShareStory());

/** Why the desktop lane is unavailable for the current frame (K3), or null. */
export function desktopLaneBlock(): string | null {
  const l = laneFor(frame.value);
  return l.desktop ? null : l.reasons.map((r) => LANE_REASON_TEXT[r]).join(' ');
}

async function guard<T>(what: 'post' | 'share' | 'download', fn: () => Promise<T>): Promise<T | undefined> {
  if (busy.value) return undefined;
  busy.value = what;
  setNotice(null);
  try {
    return await fn();
  } catch (err) {
    setNotice(errorNotice(err));
    return undefined;
  } finally {
    busy.value = null;
  }
}

/** The calibration card (§4.2): a 1080×1920 PNG for the setup test when there is no photo yet. */
async function calibrationExport(): Promise<ExportRecord> {
  const canvas = calibrationCanvas(1080, 1920, cornerMarkers(1080, 1920, 160, 80), '#3d4a63');
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const record: ExportRecord = {
    id: newId('export', () => crypto.randomUUID()),
    docId: 'calibration',
    frameId: 'calibration',
    docHash: await sha256Hex('calibration-card-v1'),
    purpose: 'msite',
    mime: 'image/png',
    w: 1080,
    h: 1920,
    bytes: blob.size,
    sha256: await sha256Hex(await blob.arrayBuffer()),
    blob,
    createdAt: Date.now(),
  };
  await putExport(record);
  return record;
}

/** Starts a run of `mode` with the fresh export (or the calibration card for a test without a photo). */
async function run(mode: Exclude<HandoffMode, 'check'>, queue: boolean): Promise<void> {
  await guard('post', async () => {
    const block = desktopLaneBlock();
    if (block && mode === 'post') {
      setNotice({ kind: 'error', text: `${block} Use Send to phone… instead.`, code: 'LANE_PHONE' });
      return;
    }
    let record: ExportRecord;
    let sample: string | null = null;
    let thumb: string | null = null;
    if (image.value) {
      const fresh = await freshExport();
      if (!fresh) throw new Error('The story could not be rendered; try again.');
      record = await storeExport(fresh);
      sample = fresh.sample;
      thumb = URL.createObjectURL(fresh.blob);
    } else if (mode !== 'post') {
      record = await calibrationExport();
      thumb = URL.createObjectURL(record.blob);
    } else {
      setNotice({ kind: 'error', text: 'Add a photo to post.' });
      return;
    }
    startRun(
      {
        exportId: record.id,
        mode,
        queue,
        ...(sample ? { exportSample: sample } : {}),
        exportSha256: record.sha256,
        docHash: record.docHash,
      },
      thumb,
    );
  });
}

/** Post story (⌘↵). Within the 60 s spacing the post queues and starts by itself (K10/K11). */
export function postStory(): Promise<void> {
  const l = lane.value;
  return run('post', l?.kind === 'spacing' || l?.kind === 'ready' || l === null);
}

/** Test run (⌥⌘↵) and the setup test: everything up to Share, Share not pressed. */
export function testRun(): Promise<void> {
  return run('test', false);
}

/** Settings → Advanced → Share test: presses Share with publishing blocked (L19). */
export function shareTest(): Promise<void> {
  return run('shareTest', false);
}

/** Settings → Advanced → Check connection: window, probe and account; no file. */
export function checkConnection(): void {
  try {
    startRun({ exportId: null, mode: 'check', queue: false });
  } catch (err) {
    setNotice(errorNotice(err));
  }
}

export { stopRun };

/** Downloads to instapost/<stamp>_story.<ext>, waits for completion; returns the file name and download id. */
async function saveToDownloads(blob: Blob, ext: 'jpg' | 'png'): Promise<{ file: string; downloadId: number }> {
  const requested = storyFilename(new Date(), ext);
  const started = await downloadBlob(blob, requested);
  await started.done;
  const final = await downloads.filename(started.downloadId).catch(() => undefined);
  return { file: baseName(final ?? requested), downloadId: started.downloadId };
}

/** The phone JPEG of the current doc. */
async function phoneJpeg(): Promise<File> {
  const img = image.value;
  if (!img) throw new Error('Add a photo first.');
  const rendered = await exportFrame(doc.value, frame.value.id, 'phone', {
    sources: { image: (id) => (id === img.assetId ? img.full : undefined) },
    assetSize,
    measurer,
  });
  return new File([rendered.blob], baseName(storyFilename(new Date(), 'jpg')), { type: rendered.mime });
}

/**
 * Send to phone… (§4.5): the share sheet with the JPEG (it needs the click's user activation, so it stays in
 * the editor). Without file sharing, Save copy with "AirDrop it from Finder".
 */
export function sendToPhone(): Promise<void> {
  return guard('share', async () => {
    if (!shareSupported.value) {
      const file = await phoneJpeg();
      const saved = await saveToDownloads(file, 'jpg');
      setNotice({ kind: 'info', text: `Saved Downloads/instapost/${saved.file}. AirDrop it from Finder.` });
      return;
    }
    const file = await phoneJpeg();
    const outcome = await shareFiles([file], { title: 'instapost story' });
    if (outcome === 'not-allowed') {
      setNotice({ kind: 'info', text: 'The story is ready: click Send to phone… again to open the share sheet.' });
    } else if (outcome === 'unsupported') {
      shareSupported.value = false;
      const saved = await saveToDownloads(file, 'jpg');
      setNotice({ kind: 'info', text: `Saved Downloads/instapost/${saved.file}. AirDrop it from Finder.` });
    }
  }).then(() => undefined);
}

/** Save copy (§4.5): the PNG that would be uploaded, in Downloads/instapost. */
export function saveCopy(): Promise<void> {
  return guard('download', async () => {
    const fresh = await freshExport();
    if (!fresh) throw new Error('Add a photo first.');
    const saved = await saveToDownloads(fresh.blob, 'png');
    setNotice({ kind: 'info', text: `Saved Downloads/instapost/${saved.file}.` });
  }).then(() => undefined);
}

/** Show (§4.7): Finder with the saved copy selected. */
export function showDownload(downloadId: number): void {
  try {
    downloads.show(downloadId);
  } catch (err) {
    console.warn('[instapost] cannot show the download', err);
  }
}

/**
 * §5: every failure after the export saves the PNG to Downloads/instapost (and, with "Also keep every
 * posted story", every post). Only for runs this editor started (it knows their export).
 */
export function installSafetyCopies(): () => void {
  return onResult((shown, own) => {
    if (!own || !shown.exportId || shown.mode !== 'post') return;
    const k = shown.result.kind;
    const failed = k === 'notPosted' || k === 'unknown';
    const keep = k === 'posted' && settings.value.keepCopies;
    if (!failed && !keep) return;
    void (async () => {
      const e = await getExport(shown.exportId as string);
      if (!e) return;
      const saved = await saveToDownloads(e.blob, 'png');
      setResultCopy(shown.handoffId, saved);
    })().catch((err: unknown) => console.warn('[instapost] safety copy failed', err));
  });
}
