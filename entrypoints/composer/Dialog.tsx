/**
 * The composer dialog (inpage-ui-spec.md FC1–FC5, FS10, FS14): the instapost-owned scrim (no click reaches
 * Instagram while it is open), the centred dialog shaped like Instagram's Create dialog (header, stage left,
 * rail right), the ⋯ menu, the sheets, and the close button outside the dialog that turns into Hide during
 * a run.
 */
import { useEffect, useRef } from 'preact/hooks';
import { dialogLayout } from '../../src/inpage/geometry.ts';
import { combo } from '../../src/inpage/keys.ts';
import { MARK, composerStrings as S } from '../../src/inpage/strings.ts';
import { GUARDED } from '../../src/shared/env.ts';
import { image } from '../../src/ui/editor-state.ts';
import { firstImage, takePhoto } from './actions.ts';
import { Icon, Mark } from './icons.tsx';
import { currentResult, Rail } from './Rail.tsx';
import { Sheets } from './Sheets.tsx';
import { StagePane } from './StagePane.tsx';
import {
  dragging,
  elapsed,
  forceImport,
  leave,
  menu,
  now,
  ownRun,
  saveCopy,
  sendToPhone,
  sheet,
  shown,
  start,
  view,
  viewport,
  zoomPop,
} from './state.ts';

function title(): string {
  const v = view.value;
  const rec = ownRun.value;
  if (v === 'run' && rec) {
    if (rec.mode === 'post') return S.dialog.titlePosting;
    if (rec.mode === 'check') return S.dialog.titleCheck;
    return S.dialog.titleTest;
  }
  if (v === 'result') return currentResult()?.rv.head ?? S.dialog.titleNew;
  return S.dialog.titleNew;
}

function MoreMenu() {
  const ref = useRef<HTMLDivElement>(null);
  const open = menu.value;
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus moves when the menu opens, nothing else
  useEffect(() => {
    if (open)
      requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
  }, [open]);
  const pick = (f: () => void) => () => {
    menu.value = false;
    f();
  };
  const onKey = (e: KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (e.key === 'ArrowDown') next = items[(i + 1) % items.length];
    else if (e.key === 'ArrowUp') next = items[(i - 1 + items.length) % items.length];
    else if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items.at(-1);
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  const photo = image.value !== null;
  return (
    <div class={`pop-menu${open ? ' open' : ''}`} role="menu" aria-label={S.dialog.more} ref={ref} onKeyDown={onKey}>
      <button
        type="button"
        role="menuitem"
        data-testid="inpage-test"
        disabled={!photo}
        onClick={pick(() => void start('test'))}
      >
        <Icon name="flask" size={20} />
        <span>{S.menu.test}</span>
        <kbd>{combo('test')}</kbd>
      </button>
      <button type="button" role="menuitem" disabled={!photo} onClick={pick(() => void saveCopy())}>
        <Icon name="download" size={20} />
        <span>{S.menu.save}</span>
      </button>
      <button type="button" role="menuitem" disabled={!photo} onClick={pick(() => void sendToPhone())}>
        <Icon name="phone" size={20} />
        <span>{S.menu.phone}</span>
      </button>
      <hr />
      <button
        type="button"
        role="menuitem"
        data-testid="inpage-menu-history"
        onClick={pick(() => {
          sheet.value = 'history';
        })}
      >
        <Icon name="history" size={20} />
        <span>{S.menu.history}</span>
        <kbd>H</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        data-testid="inpage-menu-settings"
        onClick={pick(() => {
          sheet.value = 'settings';
        })}
      >
        <Icon name="sliders" size={20} />
        <span>{S.menu.settings}</span>
        <kbd>,</kbd>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={pick(() => {
          sheet.value = 'keys';
        })}
      >
        <Icon name="kbd" size={20} />
        <span>{S.menu.keys}</span>
        <kbd>?</kbd>
      </button>
    </div>
  );
}

function Header() {
  const v = view.value;
  const rec = ownRun.value;
  return (
    <header class="head">
      <div class="head-l">
        {v === 'edit' && (
          <button
            type="button"
            class="icon-btn"
            aria-label={S.dialog.back}
            data-tip={S.dialog.back}
            onClick={() => {
              forceImport.value = true;
            }}
          >
            <Icon name="back" />
          </button>
        )}
        <span class="d-mark" data-tip={MARK}>
          <Mark />
        </span>
      </div>
      <h1 class="title" id="dlg-title">
        {title()}
      </h1>
      <div class="head-r">
        {GUARDED && <span class="test-build">{S.dialog.testBuild}</span>}
        {v === 'run' && rec ? (
          <span class="clock" aria-hidden="true">
            {elapsed(now.value - rec.startedAt)}
          </span>
        ) : (
          <button
            type="button"
            class="icon-btn"
            id="more-btn"
            aria-label={S.dialog.more}
            aria-haspopup="menu"
            aria-expanded={menu.value}
            onClick={(e) => {
              e.stopPropagation();
              menu.value = !menu.value;
            }}
          >
            <Icon name="more" />
          </button>
        )}
      </div>
      <MoreMenu />
    </header>
  );
}

export function Modal() {
  const v = view.value;
  const vp = viewport.value;
  const L = dialogLayout(vp.w, vp.h, v === 'import');
  const run = v === 'run';
  const depth = useRef(0);
  const droppable = v === 'import' || v === 'edit';
  return (
    <div
      class={`modal view-${v}${shown.value ? ' shown' : ''}${dragging.value ? ' dragging' : ''}`}
      data-testid="inpage-dialog"
      data-view={v}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer target only; Esc and the ✕ are the keyboard paths (FC4) */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: as above */}
      <div
        class="scrim"
        data-testid="inpage-scrim"
        onClick={() => leave(run ? 'hide' : 'close')}
        onWheel={(e) => e.preventDefault()}
      />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click only closes the ⋯ menu and the zoom popover (Esc does too) */}
      <section
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        tabIndex={-1}
        style={{ left: `${L.left}px`, top: `${L.top}px`, width: `${L.dlgW}px`, height: `${L.dlgH}px` }}
        onClick={(e) => {
          const t = e.target as Element;
          if (!t.closest('.pop-menu, #more-btn')) menu.value = false;
          if (!t.closest('.zoom-pop, .tools')) zoomPop.value = false;
        }}
        onDragEnter={(e) => {
          if (!droppable || !e.dataTransfer?.types.includes('Files')) return;
          e.preventDefault();
          depth.current += 1;
          dragging.value = true;
        }}
        onDragOver={(e) => {
          if (droppable && e.dataTransfer?.types.includes('Files')) e.preventDefault();
        }}
        onDragLeave={() => {
          depth.current -= 1;
          if (depth.current <= 0) {
            depth.current = 0;
            dragging.value = false;
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          dragging.value = false;
          if (!droppable) return;
          void firstImage(e.dataTransfer?.files).then((f) => (f ? takePhoto(f) : undefined));
        }}
      >
        <Header />
        <div class="body">
          <div class="stage-col" style={{ width: v === 'import' ? '100%' : `${L.stageW}px` }}>
            <StagePane stage={{ x: 0, y: 0, w: L.stageW, h: L.bodyH }} />
            <div class="drop-over">{S.import.drop}</div>
          </div>
          {v !== 'import' && <Rail width={L.railW} />}
        </div>
        <Sheets />
      </section>
      <button
        type="button"
        class="ox"
        data-testid="inpage-close"
        data-hide={run ? 'true' : 'false'}
        aria-label={run ? S.dialog.hide : S.dialog.close}
        onClick={() => leave(run ? 'hide' : 'close')}
      >
        <Icon name="x" class="x-close" />
        <Icon name="min" class="x-hide" />
      </button>
    </div>
  );
}
