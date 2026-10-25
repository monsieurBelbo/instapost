/**
 * Settings (ux.md §4.12, IU8): a sheet over the editor (`,`, `#settings`). Account (the detected handle,
 * "Only post as", Check again, Forget), Copies, Language (AM44: Auto (browser) / English / Español),
 * Pace and safety, and Advanced (Check connection, Share test, Diagnostics, the build). While a run is
 * active, settings that change a run apply to the next one (AM21); the language applies at once.
 * docs/repost.md RP-20: Photos from Instagram's image server, Allow (the composer sends the owner here when
 * the browser would not ask from the framed composer); the composer resumes by itself once it is granted.
 *
 * Test ids: `settings-sheet`, `settings-close`, `settings-account`, `settings-check-again`,
 * `settings-account-lock`, `settings-forget-account`, `settings-keep-copies`, `settings-language`,
 * `settings-pace`, `settings-advanced`, `settings-check-connection`, `settings-share-test`,
 * `settings-copy-diagnostics`.
 */
import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { UI_LANG_SETTINGS, type UiLangSetting } from '../core/handoff/state.ts';
import { cdnGranted, onCdnGranted, requestCdn } from '../platform/permissions.ts';
import { MODE } from '../shared/env.ts';
import { checkConnection, shareTest } from './actions.ts';
import { at, dateTime, folder } from './copy.ts';
import { busy } from './editor-state.ts';
import { historyRows } from './history.ts';
import { t } from './i18n.ts';
import { forgetAccount, lane, runActive } from './run-state.ts';
import { isMsiteLocked, settings, updateSettings } from './settings-state.ts';
import { now, openOverlay } from './ui-state.ts';

/** A language is named in itself (English, Español) whatever the UI language; Auto in the current one. */
const LANG_NAME: Readonly<Record<UiLangSetting, () => string>> = {
  auto: () => t('settings.lang.auto'),
  en: () => 'English',
  es: () => 'Español',
};

export function SettingsSheet() {
  const st = settings.value;
  const advanced = useSignal(false);
  const copied = useSignal(false);
  const cdn = useSignal(false);
  useEffect(() => {
    void cdnGranted().then((v) => {
      cdn.value = v;
    });
    return onCdnGranted(() => {
      cdn.value = true;
    });
  }, [cdn]);
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
      <button
        type="button"
        class="sheet-backdrop"
        aria-label={t('common.close')}
        tabIndex={-1}
        onClick={() => openOverlay(null)}
      />
      <aside class="sheet" data-testid="settings-sheet" aria-labelledby="settings-title" role="dialog">
        <header class="sheet-head">
          <h1 id="settings-title">{t('settings.title')}</h1>
          <button
            type="button"
            class="link"
            data-testid="settings-close"
            aria-label={t('common.close')}
            onClick={() => openOverlay(null)}
          >
            ✕
          </button>
        </header>
        {running && <p class="hint">{t('settings.running')}</p>}

        <section aria-labelledby="set-account">
          <h2 id="set-account">{t('settings.account')}</h2>
          <p class="account-row" data-testid="settings-account">
            {t('settings.postsGoTo')}{' '}
            <span class="monogram" aria-hidden="true">
              {account ? account.handle.slice(0, 1).toUpperCase() : '?'}
            </span>{' '}
            {account ? (
              <>
                <strong>{at(account.handle)}</strong>{' '}
                <span class="hint">{t('settings.detected', { date: dateTime(account.detectedAt) })}</span>
              </>
            ) : (
              <span class="hint">{t('settings.noAccount')}</span>
            )}
            <button
              type="button"
              class="button ghost"
              data-testid="settings-check-again"
              disabled={disabled}
              onClick={checkConnection}
            >
              {t('settings.checkAgain')}
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
            {t('settings.lock', { handle: account ? at(account.handle) : t('settings.detectedAccount') })}
          </label>
          {account && (
            <button
              type="button"
              class="link"
              data-testid="settings-forget-account"
              disabled={running}
              onClick={forgetAccount}
            >
              {t('settings.forget')}
            </button>
          )}
        </section>

        <section aria-labelledby="set-copies">
          <h2 id="set-copies">{t('settings.copies')}</h2>
          <label class="check">
            <input
              type="checkbox"
              data-testid="settings-keep-copies"
              checked={st.keepCopies}
              onChange={(e) => void updateSettings({ keepCopies: (e.currentTarget as HTMLInputElement).checked })}
            />
            {t('settings.keepCopies', { folder: folder() })}
          </label>
          <p class="hint">{t('settings.keepHint')}</p>
        </section>

        <section aria-labelledby="set-language">
          <h2 id="set-language">{t('settings.language')}</h2>
          <select
            data-testid="settings-language"
            aria-labelledby="set-language"
            value={st.lang}
            onChange={(e) => {
              const next = (e.currentTarget as HTMLSelectElement).value as UiLangSetting;
              if (UI_LANG_SETTINGS.includes(next)) void updateSettings({ lang: next });
            }}
          >
            {UI_LANG_SETTINGS.map((l) => (
              <option key={l} value={l}>
                {LANG_NAME[l]()}
              </option>
            ))}
          </select>
          <p class="hint">{t('settings.langHint')}</p>
        </section>

        <section aria-labelledby="set-cdn">
          <h2 id="set-cdn">{t('settings.cdn')}</h2>
          <p class="hint">{t('settings.cdnHint')}</p>
          <button
            type="button"
            class="button"
            data-testid="settings-cdn"
            disabled={cdn.value}
            onClick={() => {
              requestCdn().then(
                (v) => {
                  cdn.value = v;
                },
                () => undefined,
              );
            }}
          >
            {cdn.value ? t('settings.cdnAllowed') : t('settings.cdnAllow')}
          </button>
        </section>

        <section aria-labelledby="set-pace">
          <h2 id="set-pace">{t('settings.pace')}</h2>
          <p class="hint">{t('settings.paceHint')}</p>
          <p data-testid="settings-pace" data-locked={locked ? 'true' : 'false'}>
            {t('settings.desktop', {
              state:
                locked && st.msiteLockedUntil !== null
                  ? t('settings.pausedUntil', { date: dateTime(st.msiteLockedUntil) })
                  : (l?.today ?? 0) === 1
                    ? t('settings.activeOne')
                    : t('settings.active', { n: l?.today ?? 0 }),
            })}
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
            <h2 id="set-advanced">
              {t('settings.advanced')} {advanced.value ? '▾' : '▸'}
            </h2>
          </button>
          {advanced.value && (
            <dl class="advanced">
              <dt>{t('settings.checkConnection')}</dt>
              <dd>
                {t('settings.checkConnectionHint')}{' '}
                <button
                  type="button"
                  class="button"
                  data-testid="settings-check-connection"
                  disabled={disabled}
                  onClick={checkConnection}
                >
                  {t('settings.run')}
                </button>
              </dd>
              <dt>{t('settings.shareTest')}</dt>
              <dd>
                {t('settings.shareTestHint')}{' '}
                <button
                  type="button"
                  class="button"
                  data-testid="settings-share-test"
                  disabled={disabled}
                  onClick={() => void shareTest()}
                >
                  {t('settings.run')}
                </button>
              </dd>
              <dt>{t('settings.diagnostics')}</dt>
              <dd>
                {t('settings.diagnosticsHint')}{' '}
                <button type="button" class="button" data-testid="settings-copy-diagnostics" onClick={copyDiagnostics}>
                  {copied.value ? t('common.copied') : t('settings.copy')}
                </button>
              </dd>
              <dt>{t('settings.build')}</dt>
              <dd>{MODE}</dd>
            </dl>
          )}
        </section>
      </aside>
    </div>
  );
}
