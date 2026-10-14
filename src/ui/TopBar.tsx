/**
 * The top bar (ux.md §8, IU11): brand, the build badge (non-live), the account chip, the last result, and
 * the History, Settings and shortcut buttons. No connection indicator (DL9): a lost port shows only in the
 * run view.
 *
 * Test ids: `account-chip`, `last-result` (`data-kind`), `history-open`, `settings-open`, `shortcuts-open`.
 */
import { MODE } from '../shared/env.ts';
import { at, clock } from './copy.ts';
import { t } from './i18n.ts';
import { lastResult, settings } from './settings-state.ts';
import { openOverlay } from './ui-state.ts';

const ICON: Record<string, string> = {
  posted: '✓',
  notPosted: '✕',
  unknown: '?',
  tested: '✓',
  shareTested: '✓',
  checked: '✓',
  stopped: '■',
};

export function TopBar() {
  const st = settings.value;
  const last = lastResult.value;
  const handle = st.expectedAccount?.handle ?? null;
  return (
    <header class="topbar">
      <span class="brand">instapost</span>
      {MODE !== 'live' && <span class={`mode-badge mode-${MODE}`}>{MODE}</span>}
      <span class="account-chip" data-testid="account-chip" title={handle ? t('top.postsGoHere') : t('top.noAccount')}>
        <span class="monogram" aria-hidden="true">
          {handle ? handle.slice(0, 1).toUpperCase() : '?'}
        </span>
        {handle ? at(handle) : t('top.noAccount')}
      </span>
      {last && (
        <span class="last-result" data-testid="last-result" data-kind={last.result.kind}>
          {t('top.last')} {ICON[last.result.kind] ?? ''} {clock(last.result.at)}
        </span>
      )}
      <nav class="topbar-actions" aria-label={t('top.panels')}>
        <button type="button" class="link" data-testid="history-open" onClick={() => openOverlay('history')}>
          {t('top.history')} <kbd>H</kbd>
        </button>
        <button type="button" class="link" data-testid="settings-open" onClick={() => openOverlay('settings')}>
          {t('top.settings')} <kbd>,</kbd>
        </button>
        <button
          type="button"
          class="link"
          data-testid="shortcuts-open"
          aria-label={t('top.shortcuts')}
          onClick={() => openOverlay('shortcuts')}
        >
          <kbd>?</kbd>
        </button>
      </nav>
    </header>
  );
}
