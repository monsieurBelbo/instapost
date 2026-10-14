/**
 * Photo controls (ux.md §4.4, IU3; from the editor panel): replace the photo, zoom, rotate, re-fit, and the
 * safe-zone guides. Test ids follow strategy §7.10 (`editor-file-input`, `editor-zoom`, `editor-rotate`,
 * `editor-safe-zones`).
 */
import { useSignalEffect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { ACCEPT_ATTR } from '../raster/decode.ts';
import {
  busy,
  endRotateGesture,
  image,
  imageLayer,
  loadImageFile,
  refitImage,
  setImageRotation,
  setImageScale,
  showSafeZones,
  startRotateGesture,
} from './editor-state.ts';
import { t } from './i18n.ts';
import { MAX_ZOOM, minZoom } from './interaction.ts';
import { choosePhotoRequest } from './result-actions.ts';

const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);

export function PhotoControls() {
  const il = imageLayer.value;
  const img = image.value;
  const working = busy.value;
  const input = useRef<HTMLInputElement>(null);
  const seen = useRef(choosePhotoRequest.peek());

  // ⌘O and "Choose photo…" from a result ask for the picker.
  useSignalEffect(() => {
    const n = choosePhotoRequest.value;
    if (n > seen.current) input.current?.click();
    seen.current = n;
  });

  const onFile = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    const file = el.files?.[0];
    if (file) void loadImageFile(file);
    el.value = '';
  };

  return (
    <section class="rail-section" aria-labelledby="sec-photo">
      <h2 id="sec-photo">{t('photo.title')}</h2>
      <label class={`button file-button${working === 'import' ? ' is-busy' : ''}`}>
        {working === 'import' ? t('photo.opening') : il ? t('photo.replace') : t('photo.choose')}
        <input
          ref={input}
          type="file"
          accept={ACCEPT_ATTR}
          class="visually-hidden"
          data-testid="editor-file-input"
          disabled={working !== null}
          onChange={onFile}
        />
      </label>
      <label class="field">
        <span>{t('photo.zoom')}</span>
        <input
          type="range"
          data-testid="editor-zoom"
          min={il && img ? minZoom(il, img.size) : 1}
          max={MAX_ZOOM}
          step={0.01}
          value={il?.xf.scale ?? 1}
          disabled={!il}
          onInput={(e) => setImageScale(num(e))}
        />
        <output>{(il?.xf.scale ?? 1).toFixed(2)}×</output>
      </label>
      <label class="field">
        <span>{t('photo.rotate')}</span>
        <input
          type="range"
          data-testid="editor-rotate"
          min={-180}
          max={180}
          step={0.5}
          value={il?.xf.rotDeg ?? 0}
          disabled={!il}
          onPointerDown={startRotateGesture}
          onKeyDown={startRotateGesture}
          onInput={(e) => setImageRotation(num(e))}
          onChange={endRotateGesture}
        />
        <output>{(il?.xf.rotDeg ?? 0).toFixed(1)}°</output>
      </label>
      <div class="row">
        <button type="button" class="button ghost" disabled={!il} onClick={refitImage}>
          {t('photo.reset')} <kbd>0</kbd>
        </button>
        <label class="check">
          <input
            type="checkbox"
            data-testid="editor-safe-zones"
            checked={showSafeZones.value}
            onChange={(e) => {
              showSafeZones.value = (e.currentTarget as HTMLInputElement).checked;
            }}
          />
          {t('photo.safeZones')}
        </label>
      </div>
    </section>
  );
}
