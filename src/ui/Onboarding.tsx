/**
 * First run (ux.md §4.2, IU10): a card over the empty stage while `onboardedAt` is null. Two steps: log in
 * to Instagram in a normal tab (instapost never sees the password), then the one setup test (Share not
 * pressed; it also learns the account). Loading the extension in Arc stays a README step (L13).
 *
 * Test ids: `onboarding`, `onboarding-open-instagram`, `onboarding-setup-test`, `onboarding-start`,
 * `onboarding-skip`, `onboarding-how`.
 */
import { useSignal } from '@preact/signals';
import { GUARDED } from '../shared/env.ts';
import { testRun } from './actions.ts';
import { at, HOW_IT_WORKS } from './copy.ts';
import { busy } from './editor-state.ts';
import { openInstagram, runActive } from './run-state.ts';
import { lastResult, lastRunNotLoggedIn, settings, updateSettings } from './settings-state.ts';

export function Onboarding() {
  const how = useSignal(false);
  const st = settings.value;
  const passed = st.lastTestPassAt !== null;
  // AP-11: onboarding shows only once the result card is gone, so the last result is read from storage.
  const notLoggedIn = lastRunNotLoggedIn(lastResult.value, st.lastTestPassAt);
  const finish = () => void updateSettings({ onboardedAt: Date.now() });
  return (
    <div class="onboarding card" data-testid="onboarding" data-passed={passed ? 'true' : 'false'}>
      <h1>Post stories from Arc in one click</h1>
      <p>
        When you press <strong>Post story</strong>, instapost opens Instagram’s own mobile site in a narrow window at
        the right of your screen and does the taps for you: + → Story, your photo, Share.
      </p>
      {GUARDED && <p class="chip amber">Test build: posts go to the fake Instagram only.</p>}
      <ol class="onboarding-steps">
        <li class={notLoggedIn ? 'is-highlighted' : ''}>
          <strong>Log in to Instagram in a normal tab</strong>
          <p class="hint">instapost never sees your password and never logs in.</p>
          {notLoggedIn && (
            <p class="notice error">Not logged in yet. Log in at instagram.com, then run the test again.</p>
          )}
          <button
            type="button"
            class="button"
            data-testid="onboarding-open-instagram"
            onClick={() => openInstagram('home')}
          >
            Open instagram.com ↗
          </button>
        </li>
        <li>
          <strong>Run the setup test</strong>
          {passed ? (
            <p data-testid="onboarding-ready">
              Ready. You’re posting as {st.expectedAccount ? at(st.expectedAccount.handle) : 'your account'}.
            </p>
          ) : (
            <p class="hint">
              About 20 seconds. Everything runs up to Instagram’s Share button, which is not pressed. Nothing is posted.
              It also finds which account you use.
            </p>
          )}
          {passed ? (
            <button type="button" class="button primary" data-testid="onboarding-start" onClick={finish}>
              Start
            </button>
          ) : (
            <button
              type="button"
              class="button primary"
              data-testid="onboarding-setup-test"
              disabled={busy.value !== null || runActive.value}
              onClick={() => void testRun()}
            >
              Run setup test
            </button>
          )}
        </li>
      </ol>
      <div class="onboarding-foot">
        <button
          type="button"
          class="link"
          data-testid="onboarding-how"
          aria-expanded={how.value}
          onClick={() => {
            how.value = !how.value;
          }}
        >
          How it works {how.value ? '▾' : '▸'}
        </button>
        <button type="button" class="link" data-testid="onboarding-skip" onClick={finish}>
          Skip for now
        </button>
      </div>
      {how.value && <p class="hint how">{HOW_IT_WORKS}</p>}
      <p class="hint">
        Tip: pin instapost to the toolbar. Keep the Instagram window in view while it works; you don’t need to click it.
      </p>
    </div>
  );
}
