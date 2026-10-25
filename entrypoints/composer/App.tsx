/**
 * The composer's root (inpage-ui-spec.md FC, FA): the dialog when open, the chip as a chip, nothing when
 * closed (the page keeps it loaded at 0×0, so its state, a queued post and the draft survive). Also the
 * editor's plumbing (fonts, drafts, the export cache, autosave), the theme, the keyboard (FA4), the focus
 * trap and focus moves (FC5, FA1), tooltips (§9), toasts and the live region (FA3). A repost (docs/repost.md
 * RP-28) adds S (cycle the look); F does nothing on its card, 0 and = − reset and size it.
 */
import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dialogLayout } from '../../src/inpage/geometry.ts';
import { autoCopy, runSteps } from '../../src/inpage/run-view.ts';
import { composerStrings as S } from '../../src/inpage/strings.ts';
import { DEFAULT_FONT_ID, loadFont } from '../../src/raster/fonts.ts';
import { loadDrafts, scheduleAutosave } from '../../src/ui/drafts.ts';
import {
  doc,
  errorNotice,
  fontsReady,
  image,
  imageLayer,
  refitImage,
  setFit,
  setImageScale,
  setNotice,
  showSafeZones,
} from '../../src/ui/editor-state.ts';
import { scheduleExport } from '../../src/ui/export-cache.ts';
import { lang } from '../../src/ui/i18n.ts';
import {
  cycleRepostLook,
  onRepostReady,
  repostActive,
  repostScale,
  resetRepost,
  setRepostScale,
} from '../../src/ui/repost-state.ts';
import { isTyping } from '../../src/ui/shortcuts.ts';
import { firstImage, pickPhoto, takePhoto } from './actions.ts';
import { Chip } from './Chip.tsx';
import { Modal } from './Dialog.tsx';
import { currentResult, primaryPost, runAction } from './Rail.tsx';
import {
  autoClose,
  cancelQueue,
  closing,
  connect,
  fireQueue,
  followSettings,
  ghost,
  hint,
  keepCopiesOn,
  leave,
  loggedIn,
  menu,
  mode,
  now,
  onOpened,
  onResult,
  ownRun,
  postRate,
  queuedAt,
  refresh,
  running,
  saveCopy,
  scheme,
  seal,
  sheet,
  shown,
  start,
  tab,
  testRate,
  tick,
  toast,
  toastMsg,
  view,
  viewport,
  zoomPop,
} from './state.ts';

// ---- the editor's plumbing (once) -------------------------------------------------------------------

function setupEditor(): void {
  loadFont(DEFAULT_FONT_ID).then(
    () => {
      fontsReady.value = true;
    },
    (err: unknown) => setNotice(errorNotice(err)),
  );
  void loadDrafts().catch(() => undefined);
  effect(() => {
    void doc.value;
    void image.value;
    void fontsReady.value;
    scheduleExport();
    scheduleAutosave();
  });
  // Instagram's buttons are drawn as ghost outlines over the stage (G); the canvas's margin bands stay off.
  showSafeZones.value = false;
  ghost.value = true;
  // RP-28, RP-30: a repost on the stage: "Click the post to change its look" for 1.8 s, and the story it
  // replaced is kept as a draft.
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  onRepostReady(({ kept, kind }) => {
    if (kind === 'post') {
      hint.value = true;
      if (hintTimer !== null) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => {
        hint.value = false;
      }, 1800);
    }
    if (kept) toast(S.repost.keptDraft);
    if (mode.value === 'open') focusForView();
  });
}

// ---- results: seal, auto-close, copies, K12 ---------------------------------------------------------

function setupResults(): void {
  onResult((rec) => {
    const kind = currentResult()?.rv.kind ?? null;
    if (kind === 'posted' || kind === 'tested' || kind === 'shareTested') {
      seal.value = true;
      setTimeout(() => {
        seal.value = false;
      }, 1600);
    }
    if (kind === 'posted') {
      // K12 now reads the stored records (state.ts guard, RL-13), so it survives View story's page load.
      // FD9: zero interaction after Post: it closes itself after 4 s (only if it is open to see it).
      if (mode.value === 'open' && !closing.value) autoClose.value = Date.now();
    }
    // "Stories that are not posted are always saved there", and posted ones with Keep copies; never a repost
    // (AM59: Save copy stays the owner's choice).
    if (autoCopy(rec, kind, keepCopiesOn())) void saveCopy(rec.runId, true);
    announce(currentResult()?.rv.title ?? '');
    if (mode.value === 'open') focusPrimary();
  });
}

// ---- focus (FC5) ------------------------------------------------------------------------------------

function focusPrimary(): void {
  setTimeout(() => {
    const btn = document.querySelector<HTMLElement>('.rail-foot [data-primary="true"]');
    (btn ?? document.querySelector<HTMLElement>('.dialog'))?.focus({ preventScroll: true });
  }, 60);
}

function focusForView(): void {
  setTimeout(() => {
    try {
      window.focus();
    } catch {
      // Focus belongs to the page until the owner clicks in the dialog.
    }
    const v = view.value;
    const target =
      v === 'import'
        ? document.getElementById('choose')
        : v === 'run' || v === 'result'
          ? document.querySelector<HTMLElement>('.rail-foot [data-primary="true"]')
          : document.querySelector<HTMLElement>('.dialog');
    (target ?? document.querySelector<HTMLElement>('.dialog'))?.focus({ preventScroll: true });
  }, 40);
}

// ---- live region (FA3) ------------------------------------------------------------------------------

let announcer: ((s: string) => void) | null = null;
function announce(s: string): void {
  announcer?.(s);
}

// ---- keyboard (FA4) ---------------------------------------------------------------------------------

function trap(e: KeyboardEvent): void {
  const root = document.querySelector('.modal');
  if (!root) return;
  const els = Array.from(
    root.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, summary, [tabindex]'),
  ).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      el.offsetParent !== null &&
      getComputedStyle(el).visibility !== 'hidden',
  );
  if (els.length === 0) return;
  const i = els.indexOf(document.activeElement as HTMLElement);
  if (e.shiftKey && i <= 0) {
    e.preventDefault();
    els.at(-1)?.focus();
  } else if (!e.shiftKey && (i === -1 || i === els.length - 1)) {
    e.preventDefault();
    els[0]?.focus();
  }
}

function onKey(e: KeyboardEvent): void {
  if (mode.value !== 'open' || closing.value) return;
  autoClose.value = null;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;
  const v = view.value;
  if (k === 'Escape') {
    e.preventDefault();
    // Esc leaves the text box first (ux.md §4.14), then closes what is open, innermost first.
    if (isTyping(e.target)) {
      (e.target as HTMLElement).blur();
      document.querySelector<HTMLElement>('.dialog')?.focus({ preventScroll: true });
      return;
    }
    if (menu.value) {
      menu.value = false;
      document.getElementById('more-btn')?.focus();
      return;
    }
    if (sheet.value) {
      sheet.value = null;
      document.querySelector<HTMLElement>('.dialog')?.focus();
      return;
    }
    if (zoomPop.value) {
      zoomPop.value = false;
      return;
    }
    // FD7: during a run Esc hides; Stop always needs a click.
    leave(v === 'run' ? 'hide' : 'close');
    return;
  }
  if (k === 'Tab') {
    trap(e);
    return;
  }
  if (mod && k === 'Enter') {
    e.preventDefault();
    if (e.altKey) {
      if (image.value && !running.value) void start('test');
      return;
    }
    if (v === 'edit') primaryPost();
    else if (v === 'result') {
      const res = currentResult();
      if (res && (res.rv.primary === 'post' || res.rv.primary === 'tryAgain')) runAction(res.rv.primary, res.rec);
    }
    return;
  }
  if (mod && !e.shiftKey && !e.altKey && k.toLowerCase() === 'o' && (v === 'import' || v === 'edit')) {
    e.preventDefault();
    pickPhoto();
    return;
  }
  if (mod || e.altKey || isTyping(e.target)) return;
  const lk = k.toLowerCase();
  if (v === 'result' && lk === 'n') {
    const res = currentResult();
    if (res) runAction('newStory', res.rec);
    return;
  }
  if (k === '?') {
    sheet.value = 'keys';
    return;
  }
  if (k === ',') {
    sheet.value = 'settings';
    return;
  }
  if (lk === 'h' && v !== 'run') {
    sheet.value = 'history';
    return;
  }
  if (v !== 'edit' || sheet.value) return;
  if (lk === 't') {
    e.preventDefault();
    tab.value = 'text';
    requestAnimationFrame(() => document.getElementById('story-text')?.focus());
  } else if (lk === 'g') {
    ghost.value = !ghost.value;
  } else if (lk === 's') {
    if (repostActive.value) cycleRepostLook();
  } else if (lk === 'f') {
    if (!repostActive.value) setFit(imageLayer.value?.fit === 'contain' ? 'cover' : 'contain');
  } else if (k === '0') {
    if (repostActive.value) resetRepost();
    else refitImage();
  } else if (k === '=' || k === '+') {
    if (repostActive.value) setRepostScale(repostScale.value * 1.1);
    else setImageScale((imageLayer.value?.xf.scale ?? 1) * 1.1);
  } else if (k === '-' || k === '−') {
    if (repostActive.value) setRepostScale(repostScale.value / 1.1);
    else setImageScale((imageLayer.value?.xf.scale ?? 1) / 1.1);
  }
}

// ---- tooltips (§9: 350 ms, above the control) -------------------------------------------------------

function Tooltip() {
  const [tip, setTip] = useState<{ text: string; kbd: string | null; x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = (t: HTMLElement) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const r = t.getBoundingClientRect();
        setTip({ text: t.dataset.tip ?? '', kbd: t.dataset.tipKbd ?? null, x: r.left + r.width / 2, y: r.top });
      }, 350);
    };
    const hide = () => {
      if (timer.current) clearTimeout(timer.current);
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest<HTMLElement>('[data-tip]');
      if (t) show(t);
    };
    const out = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest('[data-tip]')) hide();
    };
    const focus = (e: FocusEvent) => {
      const t = (e.target as Element | null)?.closest<HTMLElement>('[data-tip]');
      if (t?.matches(':focus-visible')) show(t);
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
    };
  }, []);
  // Measure, then clamp into the viewport above the control.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!tip || !el.current) {
      setPos(null);
      return;
    }
    const r = el.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(innerWidth - r.width - 8, tip.x - r.width / 2));
    const top = Math.max(8, tip.y - r.height - 8);
    setPos({ left, top });
  }, [tip]);
  if (mode.value !== 'open') return null;
  return (
    <div
      ref={el}
      class={`tip${tip && pos ? ' on' : ''}`}
      role="tooltip"
      style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : undefined}
    >
      {tip?.text}
      {tip?.kbd && <kbd>{tip.kbd}</kbd>}
    </div>
  );
}

function Toast() {
  const t = toastMsg.value;
  const [last, setLast] = useState(t);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keeps the last toast while it fades out
  useEffect(() => {
    if (t) setLast(t);
  }, [t]);
  if (mode.value !== 'open') return null;
  const vp = viewport.value;
  const L = dialogLayout(vp.w, vp.h, view.value === 'import');
  const imp = view.value === 'import';
  const w = imp ? L.dlgW : L.stageW;
  const style = {
    left: `${L.left + w / 2}px`,
    bottom: `${vp.h - (L.top + L.dlgH) + (imp ? 16 : Math.round(L.bodyH * 0.11) + 12)}px`,
    maxWidth: `${w - 24}px`,
  };
  const shownT = t ?? last;
  return (
    <div class={`toast${t ? ' on' : ''}`} role="status" style={style}>
      {shownT?.text}
      {shownT?.small && <small>{shownT.small}</small>}
    </div>
  );
}

function Live() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    announcer = (s) => {
      setMsg('');
      setTimeout(() => setMsg(s), 30);
    };
    return () => {
      announcer = null;
    };
  }, []);
  // Step changes (not the clock).
  const rec = ownRun.value;
  const active = rec && view.value === 'run' ? (runSteps(rec).find((s) => s.state === 'active')?.text ?? '') : '';
  useEffect(() => {
    if (active) announce(active);
  }, [active]);
  return (
    <div class="vh" aria-live="polite" aria-atomic="true">
      {msg}
    </div>
  );
}

// ---- root -------------------------------------------------------------------------------------------

let started = false;
let refreshing = false;

export function App() {
  if (!started) {
    started = true;
    setupEditor();
    setupResults();
    onOpened(() => {
      focusForView();
    });
    connect();
    followSettings();
    // The language and the pace before the first open (the chip can show first, FD8).
    void refresh();
  }

  // AM48: the document's language follows Settings → Language (screen readers, hyphenation).
  useEffect(
    () =>
      effect(() => {
        document.documentElement.lang = lang.value;
      }),
    [],
  );

  // Theme (FT1): the page's scheme; colours snap for one frame (FX13).
  useEffect(
    () =>
      effect(() => {
        const s = scheme.value;
        const root = document.documentElement;
        root.classList.add('no-tx');
        root.dataset.theme = s;
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-tx')));
      }),
    [],
  );

  // Window size, paste, keys, auto-close cancel.
  useEffect(() => {
    const onResize = () => {
      viewport.value = { w: innerWidth, h: innerHeight };
    };
    const onPaste = (e: ClipboardEvent) => {
      if (mode.value !== 'open' || isTyping(e.target)) return;
      const v = view.value;
      if (v !== 'import' && v !== 'edit') return;
      const files = e.clipboardData?.files;
      if (!files?.length) return;
      e.preventDefault();
      void firstImage(files).then((f) => (f ? takePhoto(f) : undefined));
    };
    // A file dropped outside the dialog (or while it can't take one) does nothing: unhandled, the browser
    // would open it in place of Instagram. The dialog's own drop handler takes the photo.
    const onDragOver = (e: DragEvent) => {
      const dt = e.dataTransfer;
      if (!dt?.types.includes('Files')) return;
      e.preventDefault();
      const v = view.value;
      const inDialog = (e.target as Element | null)?.closest?.('.dialog') != null;
      if (mode.value !== 'open' || (v !== 'import' && v !== 'edit') || !inDialog) dt.dropEffect = 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const cancelAuto = () => {
      autoClose.value = null;
    };
    window.addEventListener('resize', onResize);
    // A resize before this listener existed (the page opened the preloaded iframe at once) counts too.
    onResize();
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', cancelAuto, { capture: true });
    window.addEventListener('wheel', cancelAuto, { passive: true, capture: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', cancelAuto, { capture: true });
      window.removeEventListener('wheel', cancelAuto, { capture: true });
    };
  }, []);

  // The clock ticks while a run, a queue or the auto-close counts.
  useEffect(
    () =>
      effect(() => {
        const waiting = [postRate.value, testRate.value].some((r) => r !== null && !r.ok);
        // RL-14: the result's paced buttons count down too.
        const v = view.value;
        tick(
          running.value ||
            queuedAt.value !== null ||
            autoClose.value !== null ||
            ((v === 'edit' || v === 'result') && waiting),
        );
      }),
    [],
  );

  // FS12: Posted closes itself after 4 s; K11: a queued post starts by itself.
  useEffect(
    () =>
      effect(() => {
        const t = now.value;
        const a = autoClose.value;
        if (a !== null && t - a >= 4000) {
          autoClose.value = null;
          leave('close', true);
        }
        // RS-5: the queued run starts with the photo taken at the press, not what the stage shows now.
        const q = queuedAt.value;
        if (q !== null && t >= q && !running.value) fireQueue();
        // The spacing ran out: the Post card (and a result's paced button) reads the pace again.
        const r = [postRate.value, testRate.value].find((x) => x !== null && !x.ok && t >= x.freeAt);
        if (r && !refreshing) {
          refreshing = true;
          void refresh().finally(() => {
            refreshing = false;
          });
        }
      }),
    [],
  );

  // A queue never fires on a logged-out page (the driver would refuse it anyway).
  useEffect(
    () =>
      effect(() => {
        if (loggedIn.value === false && queuedAt.peek() !== null) cancelQueue();
      }),
    [],
  );

  // A new view takes focus where FC5 says (run → Stop, result → its primary).
  const v = view.value;
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus moves when the view changes, nothing else
  useEffect(() => {
    if (mode.value === 'open' && shown.value && (v === 'run' || v === 'import')) focusForView();
  }, [v]);

  const m = mode.value;
  return (
    <>
      {m === 'open' && <Modal />}
      {m === 'chip' && <Chip />}
      <Tooltip />
      <Toast />
      <Live />
    </>
  );
}
