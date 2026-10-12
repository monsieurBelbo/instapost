/**
 * The editor's exits (strategy §7.10 "Buttons"): Download JPEG, Share…, Post from desktop and
 * Probe composer. Every export is rendered from the full-size bitmap at 1080x1920, saved as an
 * ExportRecord in IndexedDB (with the doc it came from) and, for Download and Post, saved to
 * ~/Downloads/instapost/.
 */
import { signal } from '@preact/signals';
import type { ExportPurpose } from '../core/export/policy.ts';
import { newId } from '../core/model/ids.ts';
import { downloads } from '../platform/downloads.ts';
import { type ExportRecord, putDoc, putExport } from '../platform/idb.ts';
import { baseName, downloadBlob, storyFilename } from '../publish/download.ts';
import { LANE_REASON_TEXT, laneFor } from '../publish/lane.ts';
import { canShareStory, shareFiles } from '../publish/share.ts';
import { type ExportDeps, exportFrame, type RenderedExport } from '../raster/export.ts';
import { assetSize, type Busy, busy, doc, errorNotice, frame, image, measurer, setNotice } from './editor-state.ts';
import { startHandoff } from './handoff-state.ts';
import { sha256Hex } from './hash.ts';
import { settings } from './settings-state.ts';

const uuid = () => crypto.randomUUID();

export interface ExportReport {
  exportId: string;
  purpose: ExportPurpose;
  mime: string;
  bytes: number;
  quality: number | null;
  /** Final name in ~/Downloads/instapost/, when downloaded. */
  file: string | null;
}
/** The last export, for the report line and for tests (`data-export-id`). */
export const lastExport = signal<ExportReport | null>(null);

/** Whether this browser can share a story file (decided once). */
export const shareSupported = signal<boolean>(canShareStory());

function exportDeps(): ExportDeps {
  const img = image.value;
  return {
    sources: { image: (id) => (img && id === img.assetId ? img.full : undefined) },
    assetSize,
    measurer,
  };
}

async function renderAndStore(purpose: ExportPurpose): Promise<{ record: ExportRecord; rendered: RenderedExport }> {
  const d = doc.value;
  const frameId = frame.value.id;
  const rendered = await exportFrame(d, frameId, purpose, exportDeps());
  const record: ExportRecord = {
    id: newId('export', uuid),
    docId: d.id,
    frameId,
    docHash: await sha256Hex(JSON.stringify(d)),
    purpose,
    mime: rendered.mime,
    w: rendered.w,
    h: rendered.h,
    bytes: rendered.blob.size,
    sha256: await sha256Hex(await rendered.blob.arrayBuffer()),
    blob: rendered.blob,
    createdAt: Date.now(),
  };
  await putDoc(d);
  await putExport(record);
  return { record, rendered };
}

/** Downloads to instapost/<stamp>_story.<ext>, waits for completion, returns the final file name. */
async function saveToDownloads(blob: Blob, ext: 'jpg' | 'png'): Promise<string> {
  const requested = storyFilename(new Date(), ext);
  const started = await downloadBlob(blob, requested);
  await started.done;
  const final = await downloads.filename(started.downloadId).catch(() => undefined);
  return baseName(final ?? requested);
}

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

function reportText(r: ExportReport): string {
  const kind = r.mime === 'image/png' ? 'PNG' : `JPEG q${r.quality?.toFixed(2) ?? '?'}`;
  const where = r.file ? `Saved Downloads/instapost/${r.file}. ` : '';
  return `${where}1080×1920 ${kind}, ${mb(r.bytes)}. Location and EXIF data removed.`;
}

async function run<T>(what: Busy, fn: () => Promise<T>): Promise<T | undefined> {
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

export function downloadJpeg(): Promise<void> {
  return run('download', async () => {
    const { record, rendered } = await renderAndStore('download');
    const file = await saveToDownloads(rendered.blob, 'jpg');
    const report = {
      exportId: record.id,
      purpose: record.purpose,
      mime: rendered.mime,
      bytes: rendered.blob.size,
      quality: rendered.quality,
      file,
    };
    lastExport.value = report;
    setNotice({ kind: 'info', text: reportText(report) });
  }).then(() => undefined);
}

/**
 * Share needs transient user activation, which an export can outlast. When the browser refuses
 * for that reason, the prepared file is kept and the next click shares it at once.
 */
let prepared: { updatedAt: number; docId: string; file: File; report: ExportReport } | null = null;

export function shareStory(): Promise<void> {
  return run('share', async () => {
    const d = doc.value;
    if (!prepared || prepared.updatedAt !== d.updatedAt || prepared.docId !== d.id) {
      const { record, rendered } = await renderAndStore('phone');
      const name = baseName(storyFilename(new Date(), 'jpg'));
      prepared = {
        updatedAt: d.updatedAt,
        docId: d.id,
        file: new File([rendered.blob], name, { type: rendered.mime }),
        report: {
          exportId: record.id,
          purpose: 'phone',
          mime: rendered.mime,
          bytes: rendered.blob.size,
          quality: rendered.quality,
          file: null,
        },
      };
    }
    const { file, report } = prepared;
    lastExport.value = report;
    const outcome = await shareFiles([file], { title: 'instapost story' });
    if (outcome === 'shared') {
      prepared = null;
      setNotice({ kind: 'info', text: `Shared. ${reportText(report)}` });
    } else if (outcome === 'not-allowed') {
      setNotice({ kind: 'info', text: 'The story is ready: click Share… again to open the share sheet.' });
    } else if (outcome === 'unsupported') {
      shareSupported.value = false;
      setNotice({
        kind: 'error',
        text: 'This browser cannot share files. Use Download JPEG, then Finder’s Share menu.',
      });
    }
  }).then(() => undefined);
}

/** Why the desktop lane is unavailable for the current frame, or null. */
export function desktopLaneBlock(): string | null {
  const lane = laneFor(frame.value);
  return lane.desktop ? null : lane.reasons.map((r) => LANE_REASON_TEXT[r]).join(' ');
}

/**
 * Post from desktop (§3.6 preconditions): export the PNG, save the ExportRecord, download it so
 * H0 needs nothing more, then send handoff/start. The background decides lock, rate and busy.
 */
export function postFromDesktop(): Promise<void> {
  return run('post', async () => {
    const block = desktopLaneBlock();
    if (block) {
      setNotice({ kind: 'error', text: `${block} Use Share… or Download instead.`, code: 'LANE_PHONE' });
      return;
    }
    const { record, rendered } = await renderAndStore('msite');
    const file = await saveToDownloads(rendered.blob, 'png');
    lastExport.value = {
      exportId: record.id,
      purpose: 'msite',
      mime: rendered.mime,
      bytes: rendered.blob.size,
      quality: null,
      file,
    };
    const st = settings.value;
    startHandoff({
      exportId: record.id,
      mode: 'post',
      rehearsal: st.rehearsal,
      assistedInsert: st.assistedInsert,
      file,
    });
  }).then(() => undefined);
}

/** Probe composer (settings): opens the composer, reports C1–C8, closes; no file. */
export function probeComposer(): void {
  try {
    const st = settings.value;
    startHandoff({
      exportId: null,
      mode: 'probe',
      rehearsal: st.rehearsal,
      assistedInsert: st.assistedInsert,
      file: null,
    });
  } catch (err) {
    setNotice(errorNotice(err));
  }
}
