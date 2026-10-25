/**
 * Photo intake for the composer (inpage-ui-spec.md FS1): the picker (⌘O, Choose photo…, Replace photo…),
 * paste (⌘V) and drop. HEIC/HEIF converts in a worker (docs/inpage.md §13.7).
 * Loading a photo returns to the editor (a Back to import ends).
 */
import { composerStrings as S } from '../../src/inpage/strings.ts';
import { getAsset } from '../../src/platform/idb.ts';
import { acceptAttr, isPhotoFile } from '../../src/raster/decode.ts';
import { image, loadImageFile, textLayer } from '../../src/ui/editor-state.ts';
import { forceImport, hint, toast } from './state.ts';

let input: HTMLInputElement | null = null;
let hintTimer: ReturnType<typeof setTimeout> | null = null;

/** Loads `file` as the story's photo, then shows the drag hint (1.8 s). Resolves true when it loaded. */
export async function takePhoto(file: Blob, opts: { assetId?: string } = {}): Promise<boolean> {
  const replacing = image.value !== null && (textLayer.value?.text.trim() ?? '') !== '';
  const ok = await loadImageFile(file, opts);
  if (!ok || !image.value) return false;
  forceImport.value = false;
  hint.value = true;
  if (hintTimer !== null) clearTimeout(hintTimer);
  hintTimer = setTimeout(() => {
    hint.value = false;
  }, 1800);
  if (replacing) toast(S.toast.replaced);
  return true;
}

/** Recent photos: one of the last originals as the story's photo. */
export async function takeRecent(id: string): Promise<void> {
  const a = await getAsset(id).catch(() => undefined);
  if (a) await takePhoto(a.blob, { assetId: a.id });
}

export function pickPhoto(): void {
  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.accept = acceptAttr();
    input.hidden = true;
    input.addEventListener('change', () => {
      const f = input?.files?.[0];
      if (f) void takePhoto(f);
      if (input) input.value = '';
    });
    document.body.append(input);
  }
  input.click();
}

/**
 * The first photo of a drop or a paste (one photo per story). A HEIC/HEIF counts by its type, its name or
 * its ftyp brand: Finder hands a dragged HEIC over as image/heic, '' or application/octet-stream.
 * `files` is copied at once (a DataTransfer's list is only readable during its event).
 */
export async function firstImage(files: FileList | null | undefined): Promise<File | null> {
  const all = Array.from(files ?? []);
  const ok = await Promise.all(all.map((f) => isPhotoFile(f)));
  const list = all.filter((_, i) => ok[i]);
  if (list.length > 1) toast(S.toast.onePhoto);
  return list[0] ?? null;
}
