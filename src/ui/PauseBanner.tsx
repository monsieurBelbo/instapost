/**
 * The pause banner (ux.md §4.10, IU11): after KILLED_CHALLENGE, KILLED_OFFHOST or TEST_LEAK, desktop
 * posting is paused for 7 days; the text names each stored reason (AP-12). Resume… expands inline: a checkbox confirm (DL12: no typed word), then the
 * background lifts the lock it showed (AM25's message, unchanged).
 *
 * Test ids: `pause-banner`, `pause-resume-open`, `pause-resume-check`, `pause-resume`.
 */
import { useSignal } from '@preact/signals';
import { sendToPhone } from './actions.ts';
import { ACTION_LABEL, clock, dateTime, pauseReasonText, shortDate } from './copy.ts';
import { image } from './editor-state.ts';
import { t } from './i18n.ts';
import { resumeOpen } from './result-actions.ts';
import { isMsiteLocked, msiteLockReasons, resumeMsite, settings } from './settings-state.ts';
import { now } from './ui-state.ts';

export function PauseBanner() {
  const st = settings.value;
  const checked = useSignal(false);
  if (!isMsiteLocked(st, now.value) || st.msiteLockedUntil === null) return null;
  const until = st.msiteLockedUntil;
  const since = until - 7 * 24 * 60 * 60 * 1000;
  return (
    <div class="pause-banner" data-testid="pause-banner" role="status">
      <p class="pause-title">{t('pause.title', { until: dateTime(until) })}</p>
      <p class="pause-text">
        {t('pause.since', {
          date: shortDate(since),
          time: clock(since),
          reason: pauseReasonText(msiteLockReasons.value),
        })}
      </p>
      <p class="row-actions">
        <button type="button" class="button" disabled={image.value === null} onClick={() => void sendToPhone()}>
          {ACTION_LABEL.sendToPhone}
        </button>
        <button
          type="button"
          class="link"
          data-testid="pause-resume-open"
          aria-expanded={resumeOpen.value}
          onClick={() => {
            resumeOpen.value = !resumeOpen.value;
          }}
        >
          {ACTION_LABEL.resume}
        </button>
      </p>
      {resumeOpen.value && (
        <div class="resume">
          <p class="pause-text">{t('pause.confirm')}</p>
          <label class="check">
            <input
              type="checkbox"
              data-testid="pause-resume-check"
              checked={checked.value}
              onChange={(e) => {
                checked.value = (e.currentTarget as HTMLInputElement).checked;
              }}
            />
            {t('pause.check')}
          </label>
          <button
            type="button"
            class="button primary"
            data-testid="pause-resume"
            disabled={!checked.value}
            onClick={() => {
              if (resumeMsite(checked.value)) {
                checked.value = false;
                resumeOpen.value = false;
              }
            }}
          >
            {t('pause.resume')}
          </button>
        </div>
      )}
    </div>
  );
}
