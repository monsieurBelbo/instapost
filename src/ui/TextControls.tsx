/**
 * Text controls (ux.md §4.4, IU3; from the editor panel): one text layer, burned into the image. Test ids
 * `editor-text`, `editor-text-style`.
 */
import { DEFAULT_FONT_ID, FONTS } from '../raster/fonts.ts';
import { setText, setTextColor, setTextSize, setTextStyle, TEXT_SIZE_RANGE, textLayer } from './editor-state.ts';
import { textFocus } from './ui-state.ts';

const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);

export function TextControls() {
  const tl = textLayer.value;
  return (
    <section class="rail-section" aria-labelledby="sec-text">
      <h2 id="sec-text">Text</h2>
      <textarea
        data-testid="editor-text"
        id="editor-text"
        rows={2}
        placeholder="Add text"
        aria-label="Story text"
        value={tl?.text ?? ''}
        onFocus={() => {
          textFocus.value = true;
        }}
        onBlur={() => {
          textFocus.value = false;
        }}
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
        {FONTS[DEFAULT_FONT_ID]?.label}, centred. Drag the text on the photo to place it. It becomes part of the image.
      </p>
    </section>
  );
}
