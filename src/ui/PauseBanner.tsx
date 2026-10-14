/**
 * The pause banner (ux.md §4.10, IU11): after KILLED_CHALLENGE, KILLED_OFFHOST or TEST_LEAK, desktop
 * posting is paused for 7 days; the text names each stored reason (AP-12). Resume… expands inline: a checkbox confirm (DL12: no typed word), then the
 * background lifts the lock it showed (AM25's message, unchanged).
 *
 * Test ids: `pause-banner`, `pause-resume-open`, `pause-resume-check`, `pause-resume`.
 */
import { useSignal } from '@preact/signals';
import { sendToPhone } from './actions.ts';
import { dateTime, pauseReasonText } from './copy.ts';
import { image } from './editor-state.ts';
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
      <p class="pause-title">⏸ Desktop posting is paused until {dateTime(until)}</p>
      <p class="pause-text">
        On {new Date(since).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at{' '}
        {new Date(since).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}:{' '}
        {pauseReasonText(msiteLockReasons.value)}
      </p>
      <p class="row-actions">
        <button type="button" class="button" disabled={image.value === null} onClick={() => void sendToPhone()}>
          Send to phone…
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
          Resume…
        </button>
      </p>
      {resumeOpen.value && (
        <div class="resume">
          <p class="pause-text">
            Resume desktop posting? Only resume once you’ve opened Instagram on your phone and the account works
            normally there.
          </p>
          <label class="check">
            <input
              type="checkbox"
              data-testid="pause-resume-check"
              checked={checked.value}
              onChange={(e) => {
                checked.value = (e.currentTarget as HTMLInputElement).checked;
              }}
            />
            The account works normally on my phone
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
            Resume
          </button>
        </div>
      )}
    </div>
  );
}
