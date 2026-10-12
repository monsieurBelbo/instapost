/**
 * Editor controls (strategy §7.10): load, zoom and rotate the photo, one text layer, the safe-zone
 * overlay, and the three exits. Test ids follow §7.10.
 */

import { ACCEPT_ATTR } from '../raster/decode.ts';
import { DEFAULT_FONT_ID, FONTS } from '../raster/fonts.ts';
import { desktopLaneBlock, downloadJpeg, lastExport, postFromDesktop, shareStory, shareSupported } from './actions.ts';
import {
  busy,
  endRotateGesture,
  image,
  imageLayer,
  loadImageFile,
  notice,
  refitImage,
  setImageRotation,
  setImageScale,
  setText,
  setTextColor,
  setTextSize,
  setTextStyle,
  showSafeZones,
  startRotateGesture,
  TEXT_SIZE_RANGE,
  textLayer,
} from './editor-state.ts';
import { isActive } from './handoff-state.ts';
import { MAX_ZOOM, minZoom } from './interaction.ts';

const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);

export function EditorPanel() {
  const il = imageLayer.value;
  const img = image.value;
  const tl = textLayer.value;
  const working = busy.value;
  const laneBlock = desktopLaneBlock();
  const n = notice.value;

  const onFile = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) void loadImageFile(file);
    input.value = '';
  };

  return (
    <div class="panel" data-export-id={lastExport.value?.exportId ?? ''}>
      <section aria-labelledby="sec-photo">
        <h2 id="sec-photo">Photo</h2>
        <label class={`button file-button${working === 'import' ? ' is-busy' : ''}`}>
          {working === 'import' ? 'Opening…' : il ? 'Replace image…' : 'Open image…'}
          <input
            type="file"
            accept={ACCEPT_ATTR}
            class="visually-hidden"
            data-testid="editor-file-input"
            disabled={working !== null}
            onChange={onFile}
          />
        </label>
        <p class="hint">
          JPEG, PNG, WebP or AVIF, or drop a file on the canvas. Cover fit; drag to pan, scroll or pinch to zoom.
        </p>
        <label class="field">
          <span>Zoom</span>
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
          <span>Rotate</span>
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
        <button type="button" class="button ghost" disabled={!il} onClick={refitImage}>
          Re-fit
        </button>
      </section>

      <section aria-labelledby="sec-text">
        <h2 id="sec-text">Text</h2>
        <textarea
          data-testid="editor-text"
          rows={3}
          placeholder="Add text"
          aria-label="Story text"
          value={tl?.text ?? ''}
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        />
        <div class="row">
          <label class="field compact">
            <span>Style</span>
            <select
              data-testid="editor-text-style"
              value={tl?.style ?? 'plain'}
              onChange={(e) =>
                setTextStyle((e.currentTarget as HTMLSelectElement).value === 'highlight' ? 'highlight' : 'plain')
              }
            >
              <option value="plain">Plain</option>
              <option value="highlight">Highlight</option>
            </select>
          </label>
          <label class="field compact">
            <span>Colour</span>
            <input
              type="color"
              value={tl?.color ?? '#ffffff'}
              onInput={(e) => setTextColor((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
        </div>
        <label class="field">
          <span>Size</span>
          <input
            type="range"
            min={TEXT_SIZE_RANGE.min}
            max={TEXT_SIZE_RANGE.max}
            step={1}
            value={tl?.sizePx ?? 72}
            onInput={(e) => setTextSize(num(e))}
          />
          <output>{tl?.sizePx ?? 72} px</output>
        </label>
        <p class="hint">
          {FONTS[DEFAULT_FONT_ID]?.label}, centred. Drag the text on the canvas to place it. Burned into the image, not
          editable on Instagram.
        </p>
      </section>

      <section aria-labelledby="sec-overlays">
        <h2 id="sec-overlays">Overlays</h2>
        <label class="check">
          <input
            type="checkbox"
            data-testid="editor-safe-zones"
            checked={showSafeZones.value}
            onChange={(e) => {
              showSafeZones.value = (e.currentTarget as HTMLInputElement).checked;
            }}
          />
          Safe zones (top 270, bottom 384, sides 65 px)
        </label>
      </section>

      <section aria-labelledby="sec-export">
        <h2 id="sec-export">Export</h2>
        <div class="buttons">
          <button
            type="button"
            class="button"
            data-testid="editor-download"
            disabled={working !== null}
            onClick={() => void downloadJpeg()}
          >
            {working === 'download' ? 'Saving…' : 'Download JPEG'}
          </button>
          <button
            type="button"
            class="button"
            data-testid="editor-share"
            disabled={working !== null || !shareSupported.value}
            title={
              shareSupported.value
                ? 'Share to the phone (AirDrop)'
                : 'This browser cannot share files; use Download JPEG'
            }
            onClick={() => void shareStory()}
          >
            {working === 'share' ? 'Preparing…' : 'Share…'}
          </button>
        </div>
        <button
          type="button"
          class="button primary wide"
          data-testid="editor-post-desktop"
          disabled={working !== null || isActive.value || laneBlock !== null}
          onClick={() => void postFromDesktop()}
        >
          {working === 'post' ? 'Exporting…' : 'Post from desktop'}
        </button>
        {laneBlock && <p class="hint">{laneBlock} Use Share… or Download.</p>}
        {n && (
          <p
            class={`notice ${n.kind}`}
            role={n.kind === 'error' ? 'alert' : 'status'}
            data-testid="editor-notice"
            data-code={n.code ?? ''}
          >
            {n.text}
          </p>
        )}
      </section>
    </div>
  );
}
