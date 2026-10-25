/**
 * Sheets over the dialog's body (inpage-ui-spec.md FS14): Settings (On Instagram, Account, Copies, Pace and
 * safety, Advanced with Check, Share test, Diagnostics and the build; Developer toggles in guarded builds
 * only), Keyboard shortcuts and History. Each fades in with a 6-px rise and closes with Esc.
 */
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { UI_LANG_SETTINGS, type UiLangSetting } from '../../src/core/handoff/state.ts';
import { FRAME_TOGGLES } from '../../src/core/inpage/frame-box.ts';
import type { InpageRecord } from '../../src/inpage/driver.ts';
import {
  DEFAULT_TOGGLES,
  DEV_TOGGLES_KEY,
  type DevToggles,
  ENGINE_VIEWS,
  toToggles,
} from '../../src/inpage/messages.ts';
import { markedKind } from '../../src/inpage/story-guard.ts';
import { composerStrings as S } from '../../src/inpage/strings.ts';
import { GUARDED, MODE } from '../../src/shared/env.ts';
import { shortDate } from '../../src/ui/copy.ts';
import { Icon } from './icons.tsx';
import {
  clock,
  copyDiagnostics,
  dateTime,
  ls,
  prefs,
  preparing,
  rateInfo,
  records,
  refresh,
  running,
  setPrefs,
  setPreview,
  settings,
  shareConfirm,
  sheet,
  shortcut,
  start,
  updateSettings,
} from './state.ts';

function SheetHead({ title, close }: { title: string; close: string }) {
  return (
    <div class="sheet-h">
      <h2>{title}</h2>
      <button
        type="button"
        class="icon-btn"
        aria-label={close}
        onClick={() => {
          sheet.value = null;
          document.querySelector<HTMLElement>('.dialog')?.focus();
        }}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

/** A language is named in itself (English, Español) whatever the UI language; Auto in the current one. */
const LANG_NAME: Readonly<Record<UiLangSetting, () => string>> = {
  auto: () => S.settings.langAuto,
  en: () => 'English',
  es: () => 'Español',
};

function chromeMajor(): string {
  return /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '?';
}

function Developer() {
  const [t, setT] = useState<DevToggles>(DEFAULT_TOGGLES);
  useEffect(() => {
    void browser.storage.local
      .get(DEV_TOGGLES_KEY)
      .then((got) => setT(toToggles(got[DEV_TOGGLES_KEY])))
      .catch(() => undefined);
  }, []);
  const set = <K extends keyof DevToggles>(k: K, v: DevToggles[K]) => {
    const next = { ...t, [k]: v };
    setT(next);
    void browser.storage.local.set({ [DEV_TOGGLES_KEY]: next }).catch(() => undefined);
  };
  const radios = <K extends keyof DevToggles>(k: K, values: readonly DevToggles[K][]) => (
    <fieldset disabled={running.value}>
      <legend>{k}</legend>
      {values.map((v) => (
        <label key={String(v)}>
          <input type="radio" name={k} checked={t[k] === v} onChange={() => set(k, v)} /> {String(v)}
        </label>
      ))}
    </fieldset>
  );
  return (
    <div class="dev">
      <h3>{S.settings.developer}</h3>
      {radios('ua', ['tabwide', 'document'] as const)}
      {radios('frame', FRAME_TOGGLES)}
      {radios('view', ENGINE_VIEWS)}
      {radios('xfoRule', ['on', 'off'] as const)}
      {radios('fetchDest', ['document', 'iframe'] as const)}
    </div>
  );
}

function SettingsSheet() {
  const s = settings.value;
  const p = prefs.value;
  const h = s?.expectedAccount?.handle ?? null;
  const counts = rateInfo.value?.counts;
  const busy = running.value || preparing.value !== null;
  return (
    <>
      <SheetHead title={S.settings.title} close={S.settings.close} />
      {running.value && <p class="sheet-note">{S.settings.running}</p>}
      <h3>{S.settings.onInstagram}</h3>
      <div class="field">
        <span class="field-l">{S.settings.entry}</span>
        <fieldset class="seg" aria-label={S.settings.entry}>
          <button type="button" aria-pressed={p.entry === 'sidebar'} onClick={() => setPrefs({ entry: 'sidebar' })}>
            {S.settings.entrySidebar}
          </button>
          <button type="button" aria-pressed={p.entry === 'none'} onClick={() => setPrefs({ entry: 'none' })}>
            {S.settings.entryNone}
          </button>
        </fieldset>
      </div>
      <div class="field">
        <span class="field-l">{S.settings.preview}</span>
        <fieldset class="seg" aria-label={S.settings.preview}>
          {(['small', 'large', 'hidden'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={p.preview === v} onClick={() => setPreview(v)}>
              {S.settings[v]}
            </button>
          ))}
        </fieldset>
        <span class="acct-s">{S.settings.previewHelp}</span>
      </div>
      <h3>{S.settings.account}</h3>
      <div class="opt">
        <span class="mono" aria-hidden="true">
          {(h ?? '?').slice(0, 1)}
        </span>
        <span>
          {h ? S.settings.postsGoTo(h) : S.settings.noAccount}
          <small>
            {s?.expectedAccount
              ? S.settings.detected(dateTime(s.expectedAccount.detectedAt))
              : S.settings.noAccountHelp}
          </small>
        </span>
        <button
          type="button"
          class="btn secondary"
          style={{ marginLeft: 'auto' }}
          disabled={busy}
          onClick={() => {
            sheet.value = null;
            void start('check');
          }}
        >
          {S.settings.checkAgain}
        </button>
      </div>
      <label class="opt">
        <input
          type="checkbox"
          checked={s?.accountLock ?? true}
          disabled={running.value}
          onChange={(e) => void updateSettings({ accountLock: (e.currentTarget as HTMLInputElement).checked })}
        />
        <span>
          {S.settings.lock(h)}
          <small>{S.settings.lockHelp}</small>
        </span>
      </label>
      {h && (
        <button
          type="button"
          class="tlink sm"
          disabled={running.value}
          onClick={() => void ls.forgetAccount().then(() => refresh())}
        >
          {S.settings.forget}
        </button>
      )}
      <h3>{S.settings.copies}</h3>
      <label class="opt">
        <input
          type="checkbox"
          checked={s?.keepCopies ?? false}
          onChange={(e) => void updateSettings({ keepCopies: (e.currentTarget as HTMLInputElement).checked })}
        />
        <span>
          {S.settings.keepCopies}
          <small>{S.settings.keepCopiesHelp}</small>
        </span>
      </label>
      <h3>{S.settings.language}</h3>
      <div class="field">
        <fieldset class="seg" aria-label={S.settings.language} data-testid="inpage-language">
          {UI_LANG_SETTINGS.map((l) => (
            <button
              key={l}
              type="button"
              lang={l === 'auto' ? undefined : l}
              aria-pressed={(s?.lang ?? 'auto') === l}
              onClick={() => void updateSettings({ lang: l })}
            >
              {LANG_NAME[l]()}
            </button>
          ))}
        </fieldset>
        <span class="acct-s">{S.settings.langHelp}</span>
      </div>
      <h3>{S.settings.pace}</h3>
      <p class="res-body" style={{ margin: 0 }}>
        {S.settings.paceBody(counts?.today ?? 0, counts?.hour ?? 0)}
      </p>
      <details class="adv" data-testid="inpage-advanced">
        <summary>{S.settings.advanced}</summary>
        <div class="adv-row">
          <span>
            {S.settings.check}
            <small>{S.settings.checkHelp}</small>
          </span>
          <button
            type="button"
            class="btn secondary"
            data-testid="inpage-check"
            disabled={busy}
            onClick={() => {
              sheet.value = null;
              void start('check');
            }}
          >
            {S.settings.run}
          </button>
        </div>
        <div class="adv-row">
          <span>
            {S.settings.shareTest}
            <small>{S.settings.shareTestHelp}</small>
          </span>
          <button
            type="button"
            class="btn secondary"
            data-testid="inpage-share-confirm"
            disabled={busy}
            onClick={() => {
              shareConfirm.value = !shareConfirm.value;
            }}
          >
            {S.settings.shareTestRun}
          </button>
          {shareConfirm.value && (
            <div class="adv-confirm">
              <span>{S.settings.shareTestConfirm}</span>
              <button
                type="button"
                class="btn primary"
                data-testid="inpage-share"
                disabled={busy}
                onClick={() => {
                  shareConfirm.value = false;
                  sheet.value = null;
                  void start('shareTest', { confirmShare: true });
                }}
              >
                {S.settings.shareTestGo}
              </button>
            </div>
          )}
        </div>
        <div class="adv-row">
          <span>
            {S.settings.diagnostics}
            <small>{S.settings.diagnosticsHelp}</small>
          </span>
          <button type="button" class="btn secondary" onClick={() => void copyDiagnostics()}>
            {S.settings.copy}
          </button>
        </div>
        <div class="adv-row">
          <span>
            <small>{S.settings.build(`${MODE} · in-page · Chrome ${chromeMajor()}`)}</small>
          </span>
          <span />
        </div>
        {GUARDED && <Developer />}
      </details>
    </>
  );
}

function KeysSheet() {
  return (
    <>
      <SheetHead title={S.keys.title} close={S.keys.close} />
      <div class="keys">
        {S.keys.list(shortcut.value).map(([k, v]) => (
          <>
            <kbd>{k}</kbd>
            <span>{v}</span>
          </>
        ))}
      </div>
    </>
  );
}

function HistorySheet() {
  // RL-13: the stored records as the composer follows them (an owner's mark shows at once), newest first.
  const list = records.value.slice().reverse();
  const counts = rateInfo.value?.counts;
  const label = (r: InpageRecord): string => {
    const k = markedKind(r);
    const c = S.chip;
    if (k === 'posted') return c.posted;
    if (k === 'tested' || k === 'shareTested') return c.testPassed;
    if (k === 'checked') return c.checked;
    if (k === 'stopped') return c.stopped;
    if (k === 'unknown') return c.unknown;
    return c.notPosted;
  };
  return (
    <>
      <SheetHead title={S.history.title} close={S.history.close} />
      <p class="sheet-note">{S.history.counts(counts?.today ?? 0, counts?.hour ?? 0)}</p>
      {list.length === 0 ? (
        <p class="sheet-note">{S.history.empty}</p>
      ) : (
        <ul class="hist">
          {list.map((r) => {
            const k = markedKind(r);
            const cls =
              k === 'posted' || k === 'tested' || k === 'shareTested' || k === 'checked'
                ? 'ok'
                : k === 'unknown'
                  ? 'unk'
                  : k === 'stopped'
                    ? ''
                    : 'bad';
            return (
              <li key={r.runId}>
                <span class={`dot ${cls}`} aria-hidden="true">
                  <Icon name={cls === 'ok' ? 'check' : cls === 'unk' ? 'q' : cls === 'bad' ? 'alert' : 'x'} size={12} />
                </span>
                <span>
                  {label(r)}
                  <small>
                    {S.history.mode(r.mode)}
                    {r.account.detected ? ` · @${r.account.detected}` : ''}
                    {r.code ? ` · ${r.code}` : ''}
                    {r.mark ? ` · ${S.history.marked}` : ''}
                  </small>
                </span>
                <time>{`${shortDate(r.startedAt)} ${clock(r.startedAt)}`}</time>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export function Sheets() {
  const s = sheet.value;
  return (
    <>
      <section class={`sheet${s === 'settings' ? ' open' : ''}`} aria-label={S.settings.title}>
        {s === 'settings' && <SettingsSheet />}
      </section>
      <section class={`sheet${s === 'keys' ? ' open' : ''}`} aria-label={S.keys.title}>
        {s === 'keys' && <KeysSheet />}
      </section>
      <section class={`sheet${s === 'history' ? ' open' : ''}`} aria-label={S.history.title}>
        {s === 'history' && <HistorySheet />}
      </section>
    </>
  );
}
