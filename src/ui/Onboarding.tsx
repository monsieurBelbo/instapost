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
import { ACTION_LABEL, at, howItWorks } from './copy.ts';
import { busy } from './editor-state.ts';
import { t, tParts } from './i18n.ts';
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
      <h1>{t('onboarding.title')}</h1>
      <p>{tParts('onboarding.intro', { post: <strong key="post">{t('post.label.post')}</strong> })}</p>
      {GUARDED && <p class="chip amber">{t('onboarding.guarded')}</p>}
      <ol class="onboarding-steps">
        <li class={notLoggedIn ? 'is-highlighted' : ''}>
          <strong>{t('onboarding.step1')}</strong>
          <p class="hint">{t('onboarding.step1Hint')}</p>
          {notLoggedIn && <p class="notice error">{t('onboarding.notLoggedIn')}</p>}
          <button
            type="button"
            class="button"
            data-testid="onboarding-open-instagram"
            onClick={() => openInstagram('home')}
          >
            {ACTION_LABEL.openInstagram}
          </button>
        </li>
        <li>
          <strong>{t('onboarding.step2')}</strong>
          {passed ? (
            <p data-testid="onboarding-ready">
              {t('onboarding.ready', {
                account: st.expectedAccount ? at(st.expectedAccount.handle) : t('onboarding.yourAccount'),
              })}
            </p>
          ) : (
            <p class="hint">{t('onboarding.step2Hint')}</p>
          )}
          {passed ? (
            <button type="button" class="button primary" data-testid="onboarding-start" onClick={finish}>
              {t('onboarding.start')}
            </button>
          ) : (
            <button
              type="button"
              class="button primary"
              data-testid="onboarding-setup-test"
              disabled={busy.value !== null || runActive.value}
              onClick={() => void testRun()}
            >
              {t('onboarding.runSetupTest')}
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
          {t('onboarding.how')} {how.value ? '▾' : '▸'}
        </button>
        <button type="button" class="link" data-testid="onboarding-skip" onClick={finish}>
          {t('onboarding.skip')}
        </button>
      </div>
      {how.value && <p class="hint how">{howItWorks()}</p>}
      <p class="hint">{t('onboarding.tip')}</p>
    </div>
  );
}
