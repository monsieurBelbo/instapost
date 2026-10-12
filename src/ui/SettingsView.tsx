/**
 * Settings at `#/settings` (strategy §7.10): the account label, rehearsal (default ON), assisted
 * insert (default ON in guarded builds, OFF in live until OD3), the kill-switch lock with its
 * ENABLE field, and the Probe composer button (`mode: 'probe'`, no file).
 *
 * AM21: rehearsal and assisted insert are fixed per hand-off when it starts, so both switches are
 * disabled while one runs; an edit then could only apply to the next hand-off anyway.
 */
import { useSignal, useSignalEffect } from '@preact/signals';
import { GUARDED, MODE } from '../shared/env.ts';
import { probeComposer } from './actions.ts';
import { isActive } from './handoff-state.ts';
import { ENABLE_WORD, isMsiteLocked, reEnableMsite, settings, updateSettings } from './settings-state.ts';

const report = (p: Promise<unknown>): void => {
  p.catch((err: unknown) => console.error('[instapost] settings write failed', err));
};

export function SettingsView() {
  const s = settings.value;
  const locked = isMsiteLocked(s, Date.now());
  // The label is edited as a local draft so storage round trips never rewrite what is being typed.
  const label = useSignal(s.accountLabel);
  const labelTouched = useSignal(false);
  const enable = useSignal('');
  const enableMsg = useSignal<string | null>(null);

  // Follow the stored label until the owner starts typing in this view.
  useSignalEffect(() => {
    const stored = settings.value.accountLabel;
    if (!labelTouched.peek()) label.value = stored;
  });

  const tryEnable = (typed: string, submitted: boolean) => {
    try {
      if (reEnableMsite(typed)) {
        enable.value = '';
        enableMsg.value = 'Desktop lane re-enabled.';
      } else if (submitted) {
        enableMsg.value = `Type ${ENABLE_WORD} exactly to lift the lock.`;
      }
    } catch (err) {
      console.error('[instapost] re-enable failed', err);
      enableMsg.value = 'The background could not be reached; try again.';
    }
  };
  const running = isActive.value;

  return (
    <div class="settings">
      <h1>Settings</h1>
      <p class="hint">
        Build <strong>{MODE}</strong>
        {GUARDED ? ': guarded (Instagram writes are blocked and only the fake Instagram is accepted).' : '.'}
      </p>

      <section aria-labelledby="set-account">
        <h2 id="set-account">Account</h2>
        <label class="field stacked">
          <span>Posts as</span>
          <input
            type="text"
            data-testid="setting-account-label"
            placeholder="@your.account (display only)"
            value={label.value}
            onInput={(e) => {
              labelTouched.value = true;
              label.value = (e.currentTarget as HTMLInputElement).value;
              report(updateSettings({ accountLabel: label.value }));
            }}
          />
        </label>
        <p class="hint">Typed by you and shown next to the Post button. instapost never reads it from Instagram.</p>
      </section>

      <section aria-labelledby="set-safety">
        <h2 id="set-safety">Safety</h2>
        <label class="check">
          <input
            type="checkbox"
            data-testid="setting-rehearsal"
            checked={s.rehearsal}
            disabled={running}
            onChange={(e) => report(updateSettings({ rehearsal: (e.currentTarget as HTMLInputElement).checked }))}
          />
          Rehearsal: block Instagram’s upload and publish requests in the composer window
        </label>
        <p class="hint">
          Keep it on until the first real post (L8). With it on when a hand-off starts, tapping Share in that hand-off
          cannot publish. Both switches apply to the next hand-off, never to one already open.
        </p>
        <label class="check">
          <input
            type="checkbox"
            data-testid="setting-assisted"
            checked={s.assistedInsert}
            disabled={running}
            onChange={(e) => report(updateSettings({ assistedInsert: (e.currentTarget as HTMLInputElement).checked }))}
          />
          Assisted insert: place the image in the composer for you (otherwise you pick the file)
        </label>
        {running && (
          <p class="hint" data-testid="setting-switches-locked">
            A hand-off is open: its switches are fixed. The hand-off panel shows the ones it runs with.
          </p>
        )}
      </section>

      <section aria-labelledby="set-lock">
        <h2 id="set-lock">Desktop lane</h2>
        <p class={`lock-status${locked ? ' locked' : ''}`} data-locked={locked ? 'true' : 'false'}>
          {locked && s.msiteLockedUntil !== null
            ? `Locked until ${new Date(s.msiteLockedUntil).toLocaleString()} after a safety stop.`
            : 'Unlocked.'}
        </p>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            tryEnable(enable.value, true);
          }}
        >
          <label class="field stacked">
            <span>Type {ENABLE_WORD} to re-enable</span>
            <input
              type="text"
              data-testid="setting-enable"
              autocomplete="off"
              spellcheck={false}
              value={enable.value}
              onInput={(e) => {
                enable.value = (e.currentTarget as HTMLInputElement).value;
                enableMsg.value = null;
                if (enable.value === ENABLE_WORD) tryEnable(enable.value, false);
              }}
            />
          </label>
        </form>
        {enableMsg.value && (
          <p class="hint" role="status">
            {enableMsg.value}
          </p>
        )}
      </section>

      <section aria-labelledby="set-probe">
        <h2 id="set-probe">Composer check</h2>
        <p class="hint">
          Opens the composer window, records what it finds (mobile page, viewport, story input, canvas size) and closes
          it. No file is sent. Counts towards the pacing limits.
        </p>
        <button
          type="button"
          class="button"
          data-testid="setting-probe"
          disabled={isActive.value}
          onClick={probeComposer}
        >
          Probe composer
        </button>
      </section>
    </div>
  );
}
