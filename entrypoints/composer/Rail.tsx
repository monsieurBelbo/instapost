/**
 * The dialog's right column (inpage-ui-spec.md FS3–FS6, FS9–FS12): the account row, then per view the
 * editor's tools (Photo | Text), the run's steps and note, or the result; and the sticky footer: the Post
 * card, Stop / Hide, or the result's actions. A repost's first tab is Post (or Story) instead of Photo
 * (docs/repost.md RP-29, PostTab.tsx).
 */
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { InpageRecord } from '../../src/inpage/driver.ts';
import { combo } from '../../src/inpage/keys.ts';
import type { RunMode } from '../../src/inpage/messages.ts';
import {
  type InpagePostAction,
  type InpagePostCard,
  inpagePostCard,
  isRunAction,
  resultRunButton,
  resultRunMode,
} from '../../src/inpage/post-card.ts';
import { detailRows, type ResultAction, type ResultView, resultView, runSteps } from '../../src/inpage/run-view.ts';
import { composerStrings as S } from '../../src/inpage/strings.ts';
import {
  fontsReady,
  image,
  imageLayer,
  newStory,
  rotateImageBy,
  setFit,
  setImageScale,
  setText,
  setTextColor,
  setTextSize,
  setTextStyle,
  TEXT_SIZE_RANGE,
  textLayer,
} from '../../src/ui/editor-state.ts';
import { exportStale } from '../../src/ui/export-cache.ts';
import { minZoom } from '../../src/ui/interaction.ts';
import { repost, repostActive } from '../../src/ui/repost-state.ts';
import { textFocus } from '../../src/ui/ui-state.ts';
import { pickPhoto } from './actions.ts';
import { Icon } from './icons.tsx';
import { PostTab } from './PostTab.tsx';
import {
  autoClose,
  cancelQueue,
  clock,
  connected,
  copyDiagnostics,
  dateTime,
  dismissResult,
  elsewhere,
  forceImport,
  guard,
  handle,
  leave,
  loggedIn,
  ls,
  markRun,
  now,
  ownRun,
  paused,
  postRate,
  preparing,
  progress,
  queued,
  queuedAt,
  queueRun,
  rateInfo,
  refresh,
  resumeOpen,
  savedCopy,
  send,
  sendToPhone,
  settings,
  sheet,
  showCopy,
  start,
  stop,
  tab,
  testRate,
  textWarning,
  thumbUrl,
  view,
  viewStory,
} from './state.ts';

const pct = (v: number, min: number, max: number) => `${Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100))}%`;

// ---- account row ------------------------------------------------------------------------------------

function Account({ sub }: { sub: string }) {
  const h = handle.value;
  return (
    <div class="acct">
      <span class="mono" aria-hidden="true">
        {(h ?? '?').slice(0, 1)}
      </span>
      <div>
        <div class="acct-h">{h ? `@${h}` : S.account.unknown}</div>
        <div class="acct-s">{sub}</div>
      </div>
    </div>
  );
}

// ---- the pause banner (FX9) -------------------------------------------------------------------------

function PauseBanner() {
  const until = paused.value;
  const confirm = useRef<HTMLInputElement>(null);
  if (until === null) return null;
  return (
    <div class="pause" role="status">
      <Icon name="pause" size={20} />
      <div>
        <div class="pause-t">{S.pause.title(dateTime(until))}</div>
        <p class="pause-b">{S.pause.body}</p>
        {resumeOpen.value ? (
          <>
            <p class="pause-b">{S.pause.resumeAsk}</p>
            <label class="opt">
              <input type="checkbox" ref={confirm} />
              <span>{S.pause.resumeCheck}</span>
            </label>
            <div class="pause-a">
              <button
                type="button"
                class="btn secondary"
                onClick={() => {
                  if (!confirm.current?.checked) return;
                  void ls
                    .clearMsiteLock(until)
                    .then(() => refresh())
                    .finally(() => {
                      resumeOpen.value = false;
                    });
                }}
              >
                {S.pause.resumeButton}
              </button>
            </div>
          </>
        ) : (
          <div class="pause-a">
            <button type="button" class="btn secondary" onClick={() => void sendToPhone()}>
              {S.actions.sendToPhone}
            </button>
            <button
              type="button"
              class="tlink"
              onClick={() => {
                resumeOpen.value = true;
              }}
            >
              {S.pause.resume}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- edit: Photo | Text (FS3) -----------------------------------------------------------------------

const SWATCHES: [string, keyof typeof S.edit.swatches][] = [
  ['#ffffff', 'white'],
  ['#000000', 'black'],
  ['#ffd84d', 'yellow'],
  ['#ff7a59', 'coral'],
  ['#7cc8ff', 'sky'],
  ['#b6f09c', 'lime'],
];

function PhotoTab() {
  const l = imageLayer.value;
  const img = image.value;
  const fit = l?.fit === 'contain' ? 'contain' : 'cover';
  const min = l && img ? minZoom(l, img.size) : 1;
  const scale = l?.xf.scale ?? 1;
  const rot = Math.round((((l?.xf.rotDeg ?? 0) % 360) + 360) % 360);
  return (
    <div role="tabpanel" id="pan-photo" aria-labelledby="tab-photo">
      <div class="field">
        <span class="field-l">{S.edit.framing}</span>
        <fieldset class="seg" aria-label={S.edit.framing}>
          <button type="button" aria-pressed={fit === 'cover'} onClick={() => setFit('cover')}>
            {S.edit.fill}
          </button>
          <button type="button" aria-pressed={fit === 'contain'} onClick={() => setFit('contain')}>
            {S.edit.fit}
          </button>
        </fieldset>
      </div>
      <label class="field">
        <span class="field-l">
          {S.edit.zoom} <span class="v">{Math.round(scale * 100)}%</span>
        </span>
        <input
          class="range"
          type="range"
          min={Math.round(min * 100)}
          max={400}
          step={1}
          value={Math.round(scale * 100)}
          style={{ '--p': pct(scale * 100, min * 100, 400) }}
          disabled={!l}
          onInput={(e) => setImageScale(Number((e.currentTarget as HTMLInputElement).value) / 100)}
        />
      </label>
      <div class="field">
        <span class="field-l">
          {S.edit.rotate} <span class="v">{rot}°</span>
        </span>
        <div class="row-btns">
          <button type="button" class="btn secondary" disabled={!l} onClick={() => rotateImageBy(-90)}>
            <Icon name="reset" size={16} />
            {S.edit.left}
          </button>
          <button type="button" class="btn secondary" disabled={!l} onClick={() => rotateImageBy(90)}>
            <Icon name="rotate" size={16} />
            {S.edit.right}
          </button>
        </div>
      </div>
      <p class="hint-line">{S.edit.photoHint}</p>
      <button type="button" class="tlink" onClick={pickPhoto}>
        {S.edit.replace}
      </button>
    </div>
  );
}

function TextTab() {
  const t = textLayer.value;
  const text = t?.text ?? '';
  const size = t?.sizePx ?? 72;
  const color = (t?.color ?? '#ffffff').toLowerCase();
  const style = t?.style === 'highlight' ? 'highlight' : 'plain';
  return (
    <div role="tabpanel" id="pan-text" aria-labelledby="tab-text">
      <div class="field">
        <textarea
          id="story-text"
          class="ta"
          maxLength={200}
          placeholder={S.edit.textPlaceholder}
          aria-label={S.edit.textName}
          value={text}
          disabled={!fontsReady.value}
          onFocus={() => {
            textFocus.value = true;
          }}
          onBlur={() => {
            textFocus.value = false;
          }}
          onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        />
        <span class="ta-count">{text.length}/200</span>
      </div>
      <div class="field">
        <span class="field-l">{S.edit.style}</span>
        <fieldset class="seg" aria-label={S.edit.style}>
          <button type="button" aria-pressed={style === 'plain'} onClick={() => setTextStyle('plain')}>
            {S.edit.plain}
          </button>
          <button type="button" aria-pressed={style === 'highlight'} onClick={() => setTextStyle('highlight')}>
            {S.edit.highlight}
          </button>
        </fieldset>
      </div>
      <div class="field">
        <span class="field-l" id="col-lbl">
          {S.edit.colour}
        </span>
        <fieldset class="swatches" aria-labelledby="col-lbl">
          {SWATCHES.map(([c, name]) => (
            <button
              key={c}
              type="button"
              class="sw"
              style={{ '--c': c }}
              aria-label={S.edit.swatches[name]}
              aria-pressed={color === c}
              onClick={() => setTextColor(c)}
            />
          ))}
          <label
            class="sw custom"
            aria-label={S.edit.custom}
            data-on={!SWATCHES.some(([c]) => c === color) ? 'true' : 'false'}
          >
            <input
              type="color"
              value={color}
              onInput={(e) => setTextColor((e.currentTarget as HTMLInputElement).value)}
            />
          </label>
        </fieldset>
      </div>
      <label class="field">
        <span class="field-l">
          {S.edit.size} <span class="v">{size}</span>
        </span>
        <input
          class="range"
          type="range"
          min={TEXT_SIZE_RANGE.min}
          max={TEXT_SIZE_RANGE.max}
          step={1}
          value={size}
          style={{ '--p': pct(size, TEXT_SIZE_RANGE.min, TEXT_SIZE_RANGE.max) }}
          onInput={(e) => setTextSize(Number((e.currentTarget as HTMLInputElement).value))}
        />
      </label>
      <p class="hint-line">{S.edit.textHint}</p>
    </div>
  );
}

function EditTools() {
  const t = tab.value;
  const rp = repostActive.value;
  const first = rp ? (repost.value?.src.kind === 'mention' ? S.repost.tabStory : S.repost.tabPost) : S.edit.photo;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    tab.value = t === 'photo' ? 'text' : 'photo';
    requestAnimationFrame(() => document.getElementById(`tab-${tab.value}`)?.focus());
  };
  return (
    <>
      <div class="tabs" role="tablist" aria-label={S.edit.tabs} onKeyDown={onKey}>
        <button
          type="button"
          class="tab"
          role="tab"
          id="tab-photo"
          aria-selected={t === 'photo'}
          aria-controls="pan-photo"
          tabIndex={t === 'photo' ? 0 : -1}
          onClick={() => {
            tab.value = 'photo';
          }}
        >
          {first}
        </button>
        <button
          type="button"
          class="tab"
          role="tab"
          id="tab-text"
          aria-selected={t === 'text'}
          aria-controls="pan-text"
          tabIndex={t === 'text' ? 0 : -1}
          onClick={() => {
            tab.value = 'text';
          }}
        >
          {S.edit.text}
        </button>
      </div>
      {t === 'photo' ? rp ? <PostTab /> : <PhotoTab /> : <TextTab />}
    </>
  );
}

// ---- the Post card (FS4) ----------------------------------------------------------------------------

interface Card {
  title: string;
  icon: 'check' | 'q' | null;
  note: JSX.Element | string;
  warn: boolean;
  /** The card's state (src/inpage/post-card.ts), for tests and styling. */
  id: InpagePostCard['id'];
  action: InpagePostAction | null;
  button: { label: string; kbd: boolean; secondary: boolean; disabled: boolean; run: () => void };
}

/** What a Post-card action does here. */
function cardAction(a: InpagePostAction | null, freeAt: number | undefined): () => void {
  switch (a) {
    case 'post':
      return () => void start('post');
    case 'setupTest':
      return () => void start('test');
    case 'queuePost':
      return () => void queueRun('post', freeAt ?? now.value);
    case 'cancelQueue':
      return cancelQueue;
    case 'checkStory':
      return viewStory;
    case 'showTab':
      return () => {
        const other = elsewhere.value;
        if (other) send({ v: 1, type: 'ui/show-tab', tabId: other.tabId });
      };
    case null:
      return () => undefined;
  }
}

/** The first matching K-state wins (src/inpage/post-card.ts). */
export function postCard(): Card {
  const s = settings.value;
  const c = inpagePostCard({
    now: now.value,
    pausedUntil: paused.value,
    loggedIn: loggedIn.value,
    otherTab: elsewhere.value !== null,
    queuedAt: queuedAt.value,
    rate: postRate.value,
    counts: rateInfo.value?.counts ?? null,
    firstRun: s !== null && s.expectedAccount === null,
    story: guard.value,
    hasPhoto: image.value !== null,
    fontsReady: fontsReady.value,
    busy: preparing.value !== null || !connected.value,
    preparing: preparing.value,
    textWarning: textWarning.value,
    handle: handle.value,
  });
  const link = c.link;
  return {
    id: c.id,
    action: c.action,
    title: c.title,
    icon: c.icon,
    note: link ? (
      <>
        {c.note}{' '}
        <button
          type="button"
          class="tlink sm"
          data-testid="inpage-post-link"
          onClick={cardAction(link.action, c.freeAt)}
        >
          {link.label}
        </button>
      </>
    ) : (
      c.note
    ),
    warn: c.warn,
    button: {
      label: c.label,
      kbd: c.kbd,
      secondary: c.quiet,
      disabled: c.disabled,
      run: cardAction(c.action, c.freeAt),
    },
  };
}

function PostFooter() {
  const c = postCard();
  // RS-5 (K11): a queued run shows the photo it will post, frozen at the press.
  const q = queued.value;
  const url = q ? q.thumb : thumbUrl.value;
  const stale = q ? false : exportStale.value;
  return (
    <>
      <div class="ready">
        {url ? (
          <img
            class={`ready-img${stale ? ' stale' : ''}`}
            data-testid="inpage-thumb"
            data-stale={stale ? 'true' : 'false'}
            data-queued={q ? 'true' : 'false'}
            src={url}
            alt={S.post.thumb}
          />
        ) : (
          <span class="ready-img" />
        )}
        <div data-testid="inpage-card" data-k={c.id}>
          <div class="ready-t">
            {c.icon && <Icon name={c.icon} size={16} />}
            <span>{c.title}</span>
          </div>
          <div class={`ready-s${c.warn ? ' warn' : ''}`}>{c.note}</div>
        </div>
      </div>
      <button
        type="button"
        class={`btn ${c.button.secondary ? 'secondary' : 'primary'} lg`}
        data-primary="true"
        data-testid="inpage-post"
        disabled={c.button.disabled}
        onClick={c.button.run}
      >
        {c.button.label}
        {c.button.kbd && <kbd>{combo('post')}</kbd>}
      </button>
    </>
  );
}

// ---- run (FS5, FS6) ---------------------------------------------------------------------------------

function Steps({ rec, compact }: { rec: InpageRecord; compact: boolean }) {
  const steps = runSteps(rec);
  return (
    <ol class={`steps${compact ? ' compact' : ''}`}>
      {steps.map((s, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: always the same five steps, in order
        <li class="step" data-s={s.state} key={i}>
          <span class="ico" aria-hidden="true">
            <span class="i-pend" />
            <span class="i-act" />
            <span class="i-done">
              <Icon name="check" size={12} />
            </span>
            <span class="i-fail">
              <Icon name="alert" size={12} />
            </span>
            <span class="i-unk">
              <Icon name="q" size={12} />
            </span>
            <span class="i-skip" />
          </span>
          <span class="st">{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Progress({ rec }: { rec: InpageRecord }) {
  const steps = runSteps(rec);
  return (
    <div class="prog" aria-hidden="true">
      {steps.map((s, i) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: always the same five segments, in order
          key={i}
          class={
            s.state === 'done' || s.state === 'skip'
              ? 'done'
              : s.state === 'active'
                ? 'active'
                : s.state === 'fail'
                  ? 'fail'
                  : s.state === 'unk'
                    ? 'unk'
                    : ''
          }
        />
      ))}
    </div>
  );
}

function runNote(rec: InpageRecord): { text: string; warn: boolean } {
  const r = S.run;
  if (!connected.value) return { text: r.noteReconnect, warn: true };
  if (rec.mode === 'check') return { text: r.noteCheck, warn: false };
  const p = progress.value;
  if (p?.holding) return { text: r.noteHolding, warn: false };
  const shared = rec.steps.find((s) => s.step === 'share sent');
  if (shared && p?.shared) {
    const since = now.value - (rec.startedAt + shared.t);
    if (since > 60_000) return { text: r.noteSlow60, warn: false };
    if (since > 20_000) return { text: r.noteSlow20, warn: false };
    return { text: r.noteAfter, warn: false };
  }
  return { text: r.noteBefore, warn: false };
}

function RunBody({ rec }: { rec: InpageRecord }) {
  const note = runNote(rec);
  const test = rec.mode === 'test' || rec.mode === 'shareTest';
  return (
    <>
      {test && (
        <div class="test-chip">
          <Icon name="flask" size={16} />
          {S.run.testChip}
        </div>
      )}
      <Progress rec={rec} />
      <Steps rec={rec} compact={false} />
      <div class={`note${note.warn ? ' warn' : ''}`}>
        <Icon name={note.warn ? 'clock' : 'info'} size={20} />
        <span>{note.text}</span>
      </div>
    </>
  );
}

function RunFooter({ rec }: { rec: InpageRecord }) {
  const shared = progress.value?.shared === true;
  const hide = (
    <button type="button" class={`btn secondary${shared ? ' lg' : ''}`} onClick={() => leave('hide')}>
      {S.run.hide} <kbd>Esc</kbd>
    </button>
  );
  if (shared) {
    return (
      <>
        <div class="run-foot-line">{S.run.uploading}</div>
        {hide}
      </>
    );
  }
  return (
    <div class="row-btns">
      <button type="button" class="btn secondary" data-primary="true" data-testid="inpage-stop" onClick={stop}>
        {S.run.stop}
      </button>
      {hide}
      <span class="vh">{rec.runId}</span>
    </div>
  );
}

// ---- results (FS11, FS12) ---------------------------------------------------------------------------

export function currentResult(): { rec: InpageRecord; rv: ResultView } | null {
  const rec = ownRun.value;
  if (!rec || view.value !== 'result') return null;
  const ended = rec.endedAt ?? now.value;
  const rv = resultView(rec, {
    handle: handle.value,
    setup: rec.mode === 'test' && rec.account.decision === 'learn',
    time: clock(ended),
    seconds: rec.endedAt ? Math.round((rec.endedAt - rec.startedAt) / 1000) : null,
  });
  return rv ? { rec, rv } : null;
}

export function runAction(a: ResultAction, rec: InpageRecord): void {
  switch (a) {
    case 'viewStory':
    case 'checkStory':
      viewStory();
      return;
    case 'newStory':
      dismissResult();
      newStory();
      forceImport.value = false;
      return;
    case 'post':
    case 'tryAgain': {
      // RL-14: paced like the Post card. During the spacing the run is queued (with the photo taken now) and the
      // queue shows in the Post card; otherwise it starts, and the result stays until the run is seen starting.
      const m = resultRunMode(a, rec);
      const b = resultRunButton(a, rateFor(m), now.value, preparing.value !== null);
      if (b.disabled) return;
      if (b.queueAt !== null) {
        void queueRun(m, b.queueAt).then((ok) => {
          if (ok) dismissResult();
        });
        return;
      }
      void start(m);
      return;
    }
    case 'done':
      dismissResult();
      leave('close');
      return;
    case 'sendToPhone':
      void sendToPhone();
      return;
    case 'settings':
      sheet.value = 'settings';
      return;
    case 'marks':
      return;
  }
}

/** RL-14: the pace a run of mode `m` waits for (posts count toward the caps; tests and checks only need spacing). */
const rateFor = (m: RunMode) => (m === 'post' ? postRate.value : testRate.value);

/** A result action's label, in the current language (read at render, never kept in a constant). */
function actionLabel(a: ResultAction): string {
  return a === 'marks' ? '' : S.actions[a];
}

function ResultBody({ rec, rv }: { rec: InpageRecord; rv: ResultView }) {
  const saved = savedCopy.value;
  return (
    <>
      <Steps rec={rec} compact={true} />
      <div class="result" data-testid="inpage-outcome" data-outcome={rec.outcome ?? ''} data-code={rec.code ?? ''}>
        <div class={`res-ico ${rv.icon}`}>
          <Icon name={rv.icon === 'ok' ? 'check' : rv.icon === 'bad' ? 'alert' : rv.icon === 'unk' ? 'q' : 'x'} />
        </div>
        {rv.kicker && <div class="res-kick">{S.result.kicker}</div>}
        <h2 class="res-title">{rv.title}</h2>
        {rv.body && <p class="res-body">{rv.body}</p>}
        {rv.sub && <p class="res-copy">{rv.sub}</p>}
        {saved && saved.runId === rec.runId && (
          <p class="res-copy">
            {S.result.saved(saved.file)} ·{' '}
            <button type="button" onClick={showCopy}>
              {S.result.show}
            </button>
          </p>
        )}
        <details class="det">
          <summary>{S.result.details}</summary>
          <dl>
            {detailRows(rec).map(([k, v]) => (
              <>
                <dt>{k}</dt>
                <dd>{k === S.result.detailRows.code || k === S.result.detailRows.run ? <code>{v}</code> : v}</dd>
              </>
            ))}
          </dl>
          <button type="button" class="tlink sm" onClick={() => void copyDiagnostics()}>
            {S.result.copyDiagnostics}
          </button>
        </details>
      </div>
    </>
  );
}

function AutoClose() {
  const t0 = autoClose.value;
  if (t0 === null) return null;
  const left = Math.max(0, 4000 - (now.value - t0));
  return (
    <div class="auto">
      <div class="auto-bar">
        <i style={{ scale: `${left / 4000} 1` }} />
      </div>
      <div class="res-auto">
        <span>{S.result.closesIn(Math.max(1, Math.ceil(left / 1000)))}</span>
        <button
          type="button"
          onClick={() => {
            autoClose.value = null;
          }}
        >
          {S.result.keepOpen}
        </button>
      </div>
    </div>
  );
}

function ResultFooter({ rec, rv }: { rec: InpageRecord; rv: ResultView }) {
  const btn = (a: ResultAction, primary: boolean) => {
    // RL-14: Post story · in 0:41 / Try again · 0:41 during the spacing, Available at … under a cap.
    const paced = isRunAction(a)
      ? resultRunButton(a, rateFor(resultRunMode(a, rec)), now.value, preparing.value !== null)
      : null;
    return (
      <button
        type="button"
        class={`btn ${primary ? 'primary' : 'secondary'}${rv.kind === 'posted' ? '' : ' lg'}`}
        data-primary={primary ? 'true' : undefined}
        data-action={a}
        disabled={paced?.disabled === true}
        onClick={() => runAction(a, rec)}
      >
        {paced ? paced.label : actionLabel(a)}
        {a === 'newStory' && <kbd>N</kbd>}
        {(a === 'post' || (a === 'tryAgain' && rec.mode === 'post')) &&
          primary &&
          paced?.queueAt === null &&
          !paced.disabled && <kbd>⌘↵</kbd>}
      </button>
    );
  };
  return (
    <>
      {rv.kind === 'posted' ? (
        <div class="row-btns">
          {btn(rv.primary, true)}
          {rv.secondary && btn(rv.secondary, false)}
        </div>
      ) : (
        <>
          {btn(rv.primary, true)}
          {rv.secondary === 'marks' ? (
            <div class="links">
              <button type="button" data-testid="inpage-mark-posted" onClick={() => markRun(rec, 'posted')}>
                {S.result.itPosted}
              </button>
              <span aria-hidden="true">·</span>
              <button type="button" data-testid="inpage-mark-not-posted" onClick={() => markRun(rec, 'notPosted')}>
                {S.result.itDidntPost}
              </button>
            </div>
          ) : (
            rv.secondary && btn(rv.secondary, false)
          )}
        </>
      )}
      <AutoClose />
    </>
  );
}

// ---- the rail ---------------------------------------------------------------------------------------

export function Rail({ width }: { width: number }) {
  const v = view.value;
  const rec = ownRun.value;
  const res = currentResult();
  const scroll = useRef<HTMLDivElement>(null);
  // A new view starts at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the top when the view changes
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [v]);
  const sub =
    v === 'run' && rec
      ? rec.mode === 'post'
        ? S.account.posting
        : rec.mode === 'check'
          ? S.account.checking
          : S.account.testing
      : S.account.yourStory;
  return (
    <aside class="rail" style={{ width: `${width}px` }}>
      <div class="rail-scroll" ref={scroll}>
        <Account sub={sub} />
        {v !== 'run' && <PauseBanner />}
        {v === 'edit' && <EditTools />}
        {v === 'run' && rec && <RunBody rec={rec} />}
        {res && <ResultBody rec={res.rec} rv={res.rv} />}
      </div>
      <footer class="rail-foot">
        {v === 'edit' && <PostFooter />}
        {v === 'run' && rec && <RunFooter rec={rec} />}
        {res && <ResultFooter rec={res.rec} rv={res.rv} />}
      </footer>
    </aside>
  );
}

/** The Post card's primary action (⌘↵ in the edit view); never K8's Check my story, which leaves the page. */
export function primaryPost(): void {
  const c = postCard();
  if (!c.button.disabled && c.action !== 'checkStory') c.button.run();
}
