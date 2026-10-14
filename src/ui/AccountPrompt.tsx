/**
 * The account prompt (ux.md §4.8): the one interactive moment that can remain. Shown only when "Only post
 * as" is on and the account differs, cannot be read, or none is expected yet; the run waits on Instagram's
 * home before any tap and cancels itself after 60 s (ACCOUNT_UNCONFIRMED).
 */
import type { HandoffMode } from '../core/handoff/state.ts';
import { accountPromptFoot, accountPromptText, mmss } from './copy.ts';
import { t } from './i18n.ts';
import { chooseAccount } from './run-state.ts';
import { now } from './ui-state.ts';

export function AccountPrompt({
  kind,
  detected,
  expected,
  until,
  mode,
}: {
  kind: 'mismatch' | 'unreadable' | 'first';
  detected: string | null;
  expected: string | null;
  until: number;
  mode?: HandoffMode;
}) {
  const text = accountPromptText(kind, detected, expected, mode);
  return (
    <div class="account-prompt" data-testid="account-prompt" data-kind={kind} role="alertdialog" aria-live="assertive">
      {text.lines.map((l) => (
        <p class="prompt-line" key={l}>
          {l}
        </p>
      ))}
      <div class="row-actions">
        <button type="button" class="button primary" data-testid="account-proceed" onClick={() => chooseAccount(true)}>
          {text.proceed}
        </button>
        <button type="button" class="button ghost" data-testid="account-cancel" onClick={() => chooseAccount(false)}>
          {t('common.cancel')}
        </button>
        <span class="hint countdown">{t('prompt.countdown', { left: mmss(until - now.value) })}</span>
      </div>
      <p class="hint">{accountPromptFoot()}</p>
    </div>
  );
}
