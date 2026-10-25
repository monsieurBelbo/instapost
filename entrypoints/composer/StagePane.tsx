/**
 * The dialog's left column (inpage-ui-spec.md FS1, FS2, FS7): the import view (drop, paste, choose, Recent
 * photos, Continue draft), or the stage: the export itself (src/ui/Stage.tsx, the same compose() as the
 * upload) with Instagram's buttons as ghost outlines and the round tools; during a run, the live phone's
 * slot (the engine frame is drawn above this iframe by the content script, at the same rect), its
 * placeholder, caption and size tool; on a result, the ✓ seal.
 */
import { previewSlot, type Rect } from '../../src/inpage/geometry.ts';
import { combo } from '../../src/inpage/keys.ts';
import { runSteps } from '../../src/inpage/run-view.ts';
import { FORMATS, importErrorText, composerStrings as S } from '../../src/inpage/strings.ts';
import { clock as draftClock } from '../../src/ui/copy.ts';
import { continueDraft, recentPhotos, savedDraft } from '../../src/ui/drafts.ts';
import {
  busy,
  converting,
  image,
  imageLayer,
  notice,
  placementChanged,
  refitImage,
  setFit,
  setImageScale,
} from '../../src/ui/editor-state.ts';
import { minZoom } from '../../src/ui/interaction.ts';
import { Stage } from '../../src/ui/Stage.tsx';
import { pickPhoto, takeRecent } from './actions.ts';
import { DropGlyph, Icon } from './icons.tsx';
import { forceImport, ghost, hint, ownRun, prefs, progress, seal, setPreview, tab, view, zoomPop } from './state.ts';

function ImportView() {
  const draft = savedDraft.value;
  const recent = recentPhotos.value.slice(0, 4);
  const n = notice.value;
  const failed = n?.kind === 'error';
  const back = forceImport.value && image.value !== null;
  const importing = busy.value === 'import';
  return (
    <div class="import">
      <div class="drop">
        <DropGlyph />
        <p class="drop-title">{S.import.title}</p>
        <p class="drop-sub">
          {S.import.paste} <kbd>{combo('paste')}</kbd>
        </p>
        <button
          type="button"
          class="btn primary"
          id="choose"
          data-testid="import-choose"
          disabled={busy.value !== null}
          aria-busy={importing}
          onClick={pickPhoto}
        >
          {importing ? (
            <>
              <i class="spinner" />
              {converting.value ? S.import.converting : S.import.opening}
            </>
          ) : (
            <>
              {S.import.choose} <kbd>{combo('choose')}</kbd>
            </>
          )}
        </button>
        <p class="drop-fmt">{FORMATS}</p>
        {failed && n && (
          <p class="drop-err" role="alert" data-code={n.code ?? ''}>
            {importErrorText(n)}
          </p>
        )}
      </div>
      {(recent.length > 0 || draft || back) && (
        <div class="recent">
          <div class="recent-head">
            <span id="recent-lbl">{recent.length > 0 ? S.import.recent : ''}</span>
            {back ? (
              <button
                type="button"
                class="tlink sm"
                onClick={() => {
                  forceImport.value = false;
                }}
              >
                {S.import.draft(draftClock(Date.now()))}
              </button>
            ) : (
              draft && (
                <button
                  type="button"
                  class="tlink sm"
                  data-testid="continue-draft"
                  onClick={() => void continueDraft()}
                >
                  {S.import.draft(draftClock(draft.savedAt))}
                </button>
              )
            )}
          </div>
          {recent.length > 0 && (
            <div class="recent-grid">
              {recent.map((p) => (
                <button type="button" key={p.id} data-testid="recent-photo" onClick={() => void takeRecent(p.id)}>
                  <img src={p.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Ghost() {
  return (
    <div class={`ghost${ghost.value && view.value === 'edit' ? ' on' : ''}`} aria-hidden="true">
      <div class="ghost-top">
        <div class="ghost-bars">
          <i />
          <i />
          <i />
        </div>
        <div class="ghost-row">
          <i class="a" />
          <i class="h" />
          <i class="sp" />
          <i class="x" />
        </div>
      </div>
      <div class="ghost-bot">
        <i class="pill" />
        <i class="ic" />
        <i class="ic" />
      </div>
    </div>
  );
}

function Tools() {
  const l = imageLayer.value;
  const fit = l?.fit === 'contain';
  return (
    <>
      <div class="tools">
        <button
          type="button"
          class="tool"
          aria-label={S.stage.zoom}
          aria-expanded={zoomPop.value}
          data-tip={S.stage.zoom}
          data-tip-kbd="= −"
          onClick={(e) => {
            e.stopPropagation();
            zoomPop.value = !zoomPop.value;
            if (zoomPop.value) requestAnimationFrame(() => document.getElementById('zoom-pop-r')?.focus());
          }}
        >
          <Icon name="zoom" size={18} />
        </button>
        <button
          type="button"
          class="tool"
          aria-label={fit ? S.stage.fill : S.stage.fit}
          aria-pressed={fit}
          data-tip={S.stage.fit}
          data-tip-kbd="F"
          onClick={() => setFit(fit ? 'cover' : 'contain')}
        >
          <Icon name="fit" size={18} />
        </button>
        <button
          type="button"
          class="tool"
          aria-label={S.stage.ghost}
          aria-pressed={ghost.value}
          data-tip={S.stage.ghost}
          data-tip-kbd="G"
          onClick={() => {
            ghost.value = !ghost.value;
          }}
        >
          <Icon name="safe" size={18} />
        </button>
      </div>
      <div class="tools r">
        <button
          type="button"
          class={`tool${placementChanged.value ? '' : ' dim'}`}
          aria-label={S.stage.reset}
          data-tip={S.stage.reset}
          data-tip-kbd="0"
          onClick={refitImage}
        >
          <Icon name="reset" size={18} />
        </button>
      </div>
      <ZoomPop />
    </>
  );
}

function ZoomPop() {
  const l = imageLayer.value;
  const img = image.value;
  const min = l && img ? minZoom(l, img.size) : 1;
  const v = Math.round((l?.xf.scale ?? 1) * 100);
  const p = `${Math.max(0, Math.min(100, ((v - min * 100) / (400 - min * 100)) * 100))}%`;
  return (
    <div class={`zoom-pop${zoomPop.value ? ' open' : ''}`}>
      <input
        id="zoom-pop-r"
        class="range"
        type="range"
        min={Math.round(min * 100)}
        max={400}
        value={v}
        style={{ '--p': p }}
        aria-label={S.stage.zoom}
        onInput={(e) => setImageScale(Number((e.currentTarget as HTMLInputElement).value) / 100)}
      />
    </div>
  );
}

/** FS7: the live phone's slot, its placeholder, caption and size tool (the frame itself is the page's). */
function LiveSlot({ stage }: { stage: Rect }) {
  const rec = ownRun.value;
  const p = progress.value;
  if (!rec || !p || view.value !== 'run') return null;
  const pv = prefs.value.preview;
  if (pv === 'hidden') {
    const active = runSteps(rec).find((s) => s.state === 'active');
    return (
      <>
        <div class="run-dim" />
        <div class="run-pill" aria-hidden="true">
          <i class="spinner" />
          <span>{active?.text ?? S.stage.opening}</span>
        </div>
      </>
    );
  }
  const slot = previewSlot(stage, pv);
  const large = pv === 'large';
  const box = {
    left: `${slot.x}px`,
    top: `${slot.y}px`,
    width: `${slot.w}px`,
    height: `${slot.h}px`,
    borderRadius: `${slot.r}px`,
  };
  const toggle = () => setPreview(large ? 'small' : 'large');
  const name = large ? S.stage.shrinkName : S.stage.enlargeName;
  return (
    <>
      {large && p.frameLoaded && <div class="large-bg" />}
      {!p.frameLoaded ? (
        <div class="pip-ph" style={box} aria-hidden="true">
          <span>
            <i class="spinner" />
            {S.stage.opening}
          </span>
        </div>
      ) : (
        <button
          type="button"
          class={`pip-hit${large ? ' large' : ''}`}
          style={box}
          aria-label={name}
          data-tip={large ? S.stage.shrink : S.stage.enlarge}
          onClick={toggle}
        />
      )}
      <div class={`live-cap${p.holding ? ' held' : ''}`} aria-hidden="true">
        <i />
        <span>{p.holding ? S.stage.liveHeld : S.stage.live}</span>
      </div>
      {p.frameLoaded && (
        <button
          type="button"
          class="tool pv-size"
          aria-label={name}
          data-tip={large ? S.stage.shrink : S.stage.enlarge}
          onClick={toggle}
        >
          <Icon name={large ? 'shrink' : 'grow'} size={18} />
        </button>
      )}
    </>
  );
}

export function StagePane({ stage }: { stage: Rect }) {
  const v = view.value;
  if (v === 'import') return <ImportView />;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: double-click is a shortcut to the Text tab (T does the same)
    <div
      class="stg"
      onDblClick={() => {
        // FS2: double-click edits the text.
        if (v !== 'edit') return;
        tab.value = 'text';
        requestAnimationFrame(() => document.getElementById('story-text')?.focus());
      }}
    >
      <Stage />
      <Ghost />
      {v === 'edit' && <Tools />}
      {v === 'edit' && <div class={`pill-hint${hint.value ? ' on' : ''}`}>{S.stage.hint}</div>}
      {v === 'edit' && converting.value && (
        <div class="run-pill conv" role="status">
          <i class="spinner" />
          <span>{S.stage.converting}</span>
        </div>
      )}
      <div class="veil" aria-hidden="true" />
      <LiveSlot stage={stage} />
      <div class={`seal${seal.value ? ' on' : ''}`} aria-hidden="true">
        <Icon name="check" />
      </div>
    </div>
  );
}
