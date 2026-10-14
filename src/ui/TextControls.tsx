/**
 * Text controls (ux.md §4.4, IU3; from the editor panel): one text layer, burned into the image. Test ids
 * `editor-text`, `editor-text-style`.
 */
import { DEFAULT_FONT_ID, FONTS } from '../raster/fonts.ts';
import { setText, setTextColor, setTextSize, setTextStyle, TEXT_SIZE_RANGE, textLayer } from './editor-state.ts';
import { t } from './i18n.ts';
import { textFocus } from './ui-state.ts';

const num = (e: Event): number => Number((e.currentTarget as HTMLInputElement).value);

export function TextControls() {
  const tl = textLayer.value;
  return (
    <section class="rail-section" aria-labelledby="sec-text">
      <h2 id="sec-text">{t('text.title')}</h2>
      <textarea
        data-testid="editor-text"
        id="editor-text"
        rows={2}
        placeholder={t('text.placeholder')}
        aria-label={t('text.aria')}
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
          <span>{t('text.style')}</span>
          <select
            data-testid="editor-text-style"
            value={tl?.style ?? 'plain'}
            onChange={(e) =>
              setTextStyle((e.currentTarget as HTMLSelectElement).value === 'highlight' ? 'highlight' : 'plain')
            }
          >
            <option value="plain">{t('text.plain')}</option>
            <option value="highlight">{t('text.highlight')}</option>
          </select>
        </label>
        <label class="field compact">
          <span>{t('text.colour')}</span>
          <input
            type="color"
            value={tl?.color ?? '#ffffff'}
            onInput={(e) => setTextColor((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>
      <label class="field">
        <span>{t('text.size')}</span>
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
      <p class="hint">{t('text.hint', { font: FONTS[DEFAULT_FONT_ID]?.label ?? '' })}</p>
    </section>
  );
}
