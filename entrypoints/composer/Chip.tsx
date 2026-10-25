/**
 * The chip (inpage-ui-spec.md FS8): the composer iframe resized to the entry's slot, drawing a 36×64
 * thumbnail (the live phone shows through it while a run shows it: the engine frame sits above this iframe
 * at that rect), two lines and a progress bar. A click opens the dialog in its run or result view; it never
 * reaches the engine frame. The badge (✓ ! ?) is drawn by the page, above the phone.
 */
import { composerStrings as S } from '../../src/inpage/strings.ts';
import { currentResult } from './Rail.tsx';
import {
  compact,
  elapsed,
  mmss,
  now,
  ownRun,
  prefs,
  progress,
  queued,
  queuedAt,
  requestOpen,
  running,
  thumbUrl,
} from './state.ts';

export function Chip() {
  const rec = ownRun.value;
  const p = progress.value;
  const c = S.chip;
  let t1 = '';
  let t2 = '';
  let k = '';
  let bar = 0;
  if (running.value && rec && p) {
    const t = elapsed(now.value - rec.startedAt);
    t1 = rec.mode === 'post' ? c.posting(t) : rec.mode === 'check' ? c.checking(t) : c.testing(t);
    t2 = p.shared ? c.uploading : c.handsOff;
    bar = p.progress;
  } else if (queuedAt.value !== null) {
    t1 = c.queued(mmss(queuedAt.value - now.value));
    t2 = c.queuedNote;
  } else {
    const res = currentResult();
    if (res) {
      [t1, t2] = res.rv.chip;
      k = res.rv.icon === 'bad' ? 'bad' : res.rv.icon === 'unk' ? 'unk' : res.rv.icon === 'ok' ? 'ok' : '';
      bar = 1;
    }
  }
  const live = running.value && p?.frameLoaded === true && prefs.value.preview !== 'hidden';
  // RS-5: a queued run shows the photo it will post (frozen at the press).
  const url = queued.value?.thumb ?? thumbUrl.value;
  return (
    <button
      type="button"
      class={`chip chip-in${compact.value ? ' compact' : ''}`}
      data-testid="inpage-chip"
      data-k={k}
      aria-haspopup="dialog"
      aria-label={c.name(t1, t2)}
      title={compact.value ? `${t1} · ${t2}` : undefined}
      onClick={requestOpen}
    >
      <span
        class={`chip-thumb${live ? ' live' : ''}`}
        style={!live && url ? { backgroundImage: `url("${url}")` } : undefined}
      />
      <span class="chip-txt">
        <span class="chip-t1">{t1}</span>
        <span class="chip-t2">{t2}</span>
      </span>
      <span class="chip-bar" aria-hidden="true">
        <i style={{ scale: `${bar} 1` }} />
      </span>
    </button>
  );
}
