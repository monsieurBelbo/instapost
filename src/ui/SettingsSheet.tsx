/**
 * Settings (ux.md §4.12, IU8): a sheet over the editor (`,`, `#settings`). Account (the detected handle,
 * "Only post as", Check again, Forget), Copies, Pace and safety, and Advanced (Check connection, Share test,
 * Diagnostics, the build). While a run is active, settings that change a run apply to the next one (AM21).
 *
 * Test ids: `settings-sheet`, `settings-close`, `settings-account`, `settings-check-again`,
 * `settings-account-lock`, `settings-forget-account`, `settings-keep-copies`, `settings-pace`,
 * `settings-advanced`, `settings-check-connection`, `settings-share-test`, `settings-copy-diagnostics`.
 */
import { useSignal } from '@preact/signals';
import { MODE } from '../shared/env.ts';
import { checkConnection, shareTest } from './actions.ts';
import { at, dateTime } from './copy.ts';
import { busy } from './editor-state.ts';
import { historyRows } from './history.ts';
import { forgetAccount, lane, runActive } from './run-state.ts';
import { isMsiteLocked, settings, updateSettings } from './settings-state.ts';
import { now, openOverlay } from './ui-state.ts';

export function SettingsSheet() {
  const st = settings.value;
  const advanced = useSignal(false);
  const copied = useSignal(false);
  const running = runActive.value;
  const l = lane.value;
  const locked = isMsiteLocked(st, now.value);
  const account = st.expectedAccount;
  const disabled = running || busy.value !== null;

  const copyDiagnostics = () => {
    const runs = historyRows.value.slice(0, 20).map((r) => ({
      id: r.id,
      mode: r.mode,
      kind: r.kind,
      at: r.at,
      code: r.code,
      account: r.account,
      result: r.result,
    }));
    void navigator.clipboard
      .writeText(JSON.stringify(runs, null, 2))
      .then(() => {
        copied.value = true;
      })
      .catch(() => undefined);
  };

  return (
    <div class="overlay">
      <button type="button" class="sheet-backdrop" aria-label="Close" tabIndex={-1} onClick={() => openOverlay(null)} />
      <aside class="sheet" data-testid="settings-sheet" aria-labelledby="settings-title" role="dialog">
        <header class="sheet-head">
          <h1 id="settings-title">Settings</h1>
          <button
            type="button"
            class="link"
            data-testid="settings-close"
            aria-label="Close"
            onClick={() => openOverlay(null)}
          >
            ✕
          </button>
        </header>
        {running && <p class="hint">A post is running; this applies to the next one.</p>}

        <section aria-labelledby="set-account">
          <h2 id="set-account">Account</h2>
          <p class="account-row" data-testid="settings-account">
            Posts go to{' '}
            <span class="monogram" aria-hidden="true">
              {account ? account.handle.slice(0, 1).toUpperCase() : '?'}
            </span>{' '}
            {account ? (
              <>
                <strong>{at(account.handle)}</strong> <span class="hint">detected {dateTime(account.detectedAt)}</span>
              </>
            ) : (
              <span class="hint">no account yet (a test run or a check finds it)</span>
            )}
            <button
              type="button"
              class="button ghost"
              data-testid="settings-check-again"
              disabled={disabled}
              onClick={checkConnection}
            >
              Check again
            </button>
          </p>
          <label class="check">
            <input
              type="checkbox"
              data-testid="settings-account-lock"
              checked={st.accountLock}
              disabled={running}
              onChange={(e) => void updateSettings({ accountLock: (e.currentTarget as HTMLInputElement).checked })}
            />
            Only post as {account ? at(account.handle) : 'the detected account'} — ask before posting if Instagram is
            logged in as someone else
          </label>
          {account && (
            <button
              type="button"
              class="link"
              data-testid="settings-forget-account"
              disabled={running}
              onClick={forgetAccount}
            >
              Forget this account
            </button>
          )}
        </section>

        <section aria-labelledby="set-copies">
          <h2 id="set-copies">Copies</h2>
          <label class="check">
            <input
              type="checkbox"
              data-testid="settings-keep-copies"
              checked={st.keepCopies}
              onChange={(e) => void updateSettings({ keepCopies: (e.currentTarget as HTMLInputElement).checked })}
            />
            Also keep every posted story in Downloads/instapost
          </label>
          <p class="hint">Stories that are not posted are always saved there.</p>
        </section>

        <section aria-labelledby="set-pace">
          <h2 id="set-pace">Pace and safety</h2>
          <p class="hint">At most 1 post a minute, 6 an hour and 15 a day. Tests and checks count too.</p>
          <p data-testid="settings-pace" data-locked={locked ? 'true' : 'false'}>
            Desktop posting:{' '}
            {locked && st.msiteLockedUntil !== null
              ? `paused until ${dateTime(st.msiteLockedUntil)}`
              : `Active · ${l?.today ?? 0} posts today`}
          </p>
        </section>

        <section aria-labelledby="set-advanced">
          <button
            type="button"
            class="link section-toggle"
            data-testid="settings-advanced"
            aria-expanded={advanced.value}
            onClick={() => {
              advanced.value = !advanced.value;
            }}
          >
            <h2 id="set-advanced">Advanced {advanced.value ? '▾' : '▸'}</h2>
          </button>
          {advanced.value && (
            <dl class="advanced">
              <dt>Check connection</dt>
              <dd>
                Opens the Instagram window, reads the account and closes it. Posts nothing. Counts towards pacing.{' '}
                <button
                  type="button"
                  class="button"
                  data-testid="settings-check-connection"
                  disabled={disabled}
                  onClick={checkConnection}
                >
                  Run
                </button>
              </dd>
              <dt>Share test</dt>
              <dd>
                Presses Share with publishing blocked, to prove instapost can read Instagram’s upload. Instagram shows
                its own “upload failed” message. Use it once (live checklist L19).{' '}
                <button
                  type="button"
                  class="button"
                  data-testid="settings-share-test"
                  disabled={disabled}
                  onClick={() => void shareTest()}
                >
                  Run
                </button>
              </dd>
              <dt>Diagnostics</dt>
              <dd>
                The last 20 runs, structural facts only (includes your username).{' '}
                <button type="button" class="button" data-testid="settings-copy-diagnostics" onClick={copyDiagnostics}>
                  {copied.value ? 'Copied' : 'Copy'}
                </button>
              </dd>
              <dt>Build</dt>
              <dd>{MODE}</dd>
            </dl>
          )}
        </section>
      </aside>
    </div>
  );
}
