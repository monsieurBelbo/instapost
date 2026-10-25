/** @jsxImportSource react */
/**
 * The msite story composer (strategy §6.1, §7.6; ux.md IF4–IF6), mountable on its own (B6).
 *
 * - **DOM** (PolarisStoryImageCreationContainer, C12): `canvas._aa3c` (0×0 until the photo is drawn), the
 *   header `header._aa3d` (Close `._aa3e`; `._aa3f` with Save `._aa3g`, text `._aa3i`, draw `._aa3j` and the AI
 *   label), the landscape snackbar `._aa3b` instead of header and footer, and the Share footer: ShareFooter
 *   (`footer` → one `button`) or ShareFooterV2 (`footer` → one `[role=button]` with the avatar and, for
 *   automatic Facebook crossposting, a badge svg). Knobs: `shareControl` (v1, v2, missing, two) and `fb`
 *   (none; linked or auto switch v1 → v2 after `fbDelayMs`, as Instagram does after a GraphQL answer).
 *   Instagram renders its trash footer (`footer._aa3k`) only while a sticker moves, so the fake never does.
 * - **Files.** In the msite shell the story session starts in the shell's header (+ → Story, the story
 *   input) and the file arrives here as `sessionFile` after the shell's SPA navigation to /create/story/.
 *   Standalone (B6) the composer renders its own hidden story input when `inputMounted`, reading `change`
 *   (or, with `listen=drop`, only a drop); `trusted=require` ignores untrusted events.
 * - **The landscape gate** (AM37, client/orientation.ts): read once a photo is in play and on every
 *   `resize`; landscape hides the header and the Share footer and shows the snackbar. Each verdict goes to
 *   /__fake__/composer-view.
 * - **Ready** = the canvas is drawn, `slowMs` after the file was accepted; the geometry ground truth goes
 *   in `document.documentElement.dataset.fakeGeometry`. Then `offhost=afterReady`, `challenge=afterReady…`,
 *   `reload=afterReady` and `sw=claimLate` act.
 * - **Share** (IF5, client/upload.ts): no in-flight guard, as on Instagram: every click uploads again, and
 *   a second click in one session is reported as DOUBLE_SHARE. The JPEG → the progress modal
 *   (`[role=dialog] [role=progressbar]`) → the upload → the publish request. Success: the toast ("…added to
 *   your story", or "…and Facebook"), the tray refresh, home (`tray=throw`: no navigation, the modal
 *   stays). Failure: the modal goes and the "Upload failed." toast offers Retry (a new upload). A
 *   `checkpoint_url` navigates to it, `require_login` to the login page, `feedback_required` shows a dialog
 *   that never settles. The telemetry (`compose_stage_attempt`, `compose_finalize_attempt`, `compose`,
 *   `compose_failure`) carries the session's waterfall_id.
 * - Every control reports its click's isTrusted (IF9).
 */
import {
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type Knobs, STORY_ACCEPT_LISTS } from '../knobs.ts';
import {
  CHALLENGE_DELAY_MS,
  FAKE_PATHS,
  type FakeControl,
  type FakeGeometry,
  type FakeShareMeta,
  OFFHOST_URL,
} from '../protocol.ts';
import { logStep, reportControl } from './control.ts';
import { computeGeometry, coverCrop } from './geometry.ts';
import type { Strings } from './i18n.ts';
import {
  type LandscapeGate,
  readLandscapeGate,
  reportComposerView,
  sameGate,
  screenOrientationType,
} from './orientation.ts';
import { clearTimings } from './rt-clear.ts';
import { useCx } from './styles.ts';
import { CLAIM_LATE_DELAY_MS, registerClaimLate } from './sw.ts';
import { AVATAR_SRC, GLYPH, Glyph, Snackbar, useToasts } from './ui.tsx';
import { refreshTray, uploadStory } from './upload.ts';

/**
 * F8 (docs/inpage.md): msite's instajax error path on a failed non-GET request with a `checkpoint_url` or a
 * login redirect sets `window.top.location.href`. In a popup that is the page itself; in a frame it is the
 * desktop page of the tab.
 */
export function instajaxRedirect(url: string): void {
  (window.top ?? window).location.href = url;
}

export interface StoryComposerProps {
  knobs: Knobs;
  t: Strings;
  /** Standalone (B6): the composer renders its own hidden story input. The msite shell passes false. */
  inputMounted: boolean;
  /** The file that started this story session in the shell's header input (already checked there). */
  sessionFile?: File | null;
  /**
   * AM37: the story session id + → Story issued before that file was picked (also the telemetry's
   * waterfall_id); null when the file came without the tap, as Instagram's sessionId then stays null.
   */
  sessionId?: string | null;
  /** Date.now() at the session start (the telemetry's waterfall_duration); null without a session. */
  sessionStart?: number | null;
  /** After a published story (home), or on Close. The msite shell SPA-navigates to `/`. */
  onExit?: (reason: 'shared' | 'closed') => void;
  /** The Share flow settled: published (before going home) or failed (the toast is up). */
  onShareSettled?: (kind: 'published' | 'failed') => void;
}

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; bitmap: ImageBitmap };

/** Last input outcome, for debugging only (`data-fake-input` on <html>). */
type InputOutcome = 'accepted' | 'ignored-listen' | 'ignored-untrusted' | 'rejected-type';

const JPEG_QUALITY = 0.92;
/** How long the composer stays ready before `offhost=afterReady` navigates away. */
const OFFHOST_DELAY_MS = 500;

const html = () => document.documentElement.dataset;
/** Records the verdict on the last file event, for the specs (`data-fake-input` on <html>). */
export const markInput = (o: InputOutcome) => {
  html().fakeInput = o;
};
const delay = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, fail) =>
    canvas.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob returned null'))), 'image/jpeg', JPEG_QUALITY),
  );
}

interface Viewport {
  w: number;
  h: number;
  dpr: number;
}

const readViewport = (): Viewport => ({
  w: window.innerWidth,
  h: window.innerHeight,
  dpr: window.devicePixelRatio || 1,
});

function useViewport(): Viewport {
  const [vp, setVp] = useState(readViewport);
  useEffect(() => {
    const onResize = () =>
      setVp((prev) => {
        const next = readViewport();
        return prev.w === next.w && prev.h === next.h && prev.dpr === next.dpr ? prev : next;
      });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

/**
 * AM37: the composer page's landscape gate, read when a photo comes into play (`active`: the page
 * "mounts" with media, as PolarisStoryCreationPage does) and again on every `resize`; null while no
 * photo is in play. A layout effect, so the first painted frame already has the verdict.
 */
function useLandscapeGate(active: boolean, check: Knobs['landscapeCheck']): LandscapeGate | null {
  const [gate, setGate] = useState<LandscapeGate | null>(null);
  useLayoutEffect(() => {
    if (!active) {
      setGate(null);
      return;
    }
    const read = () =>
      setGate((prev) => {
        const next = readLandscapeGate(check);
        return prev && sameGate(prev, next) ? prev : next;
      });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, [active, check]);
  return gate;
}

/** C12: the Share control Instagram renders now (v1 until the Facebook config arrives, then v2). */
function useShareVariant(active: boolean, knobs: Knobs): 'v1' | 'v2' {
  const start = knobs.shareControl === 'v2' ? 'v2' : 'v1';
  const [variant, setVariant] = useState<'v1' | 'v2'>(start);
  useEffect(() => {
    setVariant(start);
    if (!active || start === 'v2' || knobs.fb === 'none') return;
    const id = window.setTimeout(() => setVariant('v2'), knobs.fbDelayMs);
    return () => window.clearTimeout(id);
  }, [active, start, knobs.fb, knobs.fbDelayMs]);
  return variant;
}

export function StoryComposer(props: StoryComposerProps) {
  const { knobs, t, inputMounted, sessionFile, onExit, onShareSettled } = props;
  const sessionId = props.sessionId ?? null;
  const sessionStart = props.sessionStart ?? null;
  const c = useCx();
  const toasts = useToasts();
  const vp = useViewport();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [uploading, setUploading] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const truthRef = useRef<FakeGeometry | null>(null);
  const mounted = useRef(true);
  const shares = useRef(0);

  const bitmap = phase.kind === 'ready' ? phase.bitmap : null;
  // AM37: the gate applies once a photo is in play (the session's file, or one accepted here).
  const inPlay = Boolean(sessionFile) || phase.kind !== 'idle';
  const gate = useLandscapeGate(inPlay, knobs.landscapeCheck);
  const landscape = gate?.landscape === true;
  const variant = useShareVariant(bitmap !== null, knobs);
  const fbBadge = variant === 'v2' && knobs.fb === 'auto';

  const telemetry = useCallback(
    (step: string) =>
      logStep(step, {
        waterfall_id: sessionId ?? '',
        waterfall_duration: (Date.now() - (sessionStart ?? 0)) / 1000,
      }),
    [sessionId, sessionStart],
  );

  // Every verdict (on mount with the photo, then on each flip) is recorded, before the page can go away.
  useLayoutEffect(() => {
    if (!gate) return;
    reportComposerView({
      landscape: gate.landscape,
      share: !gate.landscape,
      via: gate.via,
      screenOrientation: gate.screenOrientation,
      inner: gate.inner,
      sessionStarted: sessionId !== null,
      path: window.location.pathname,
    });
  }, [gate, sessionId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      delete html().fakeGeometry;
      delete html().fakeReady;
    };
  }, []);

  useEffect(() => (bitmap ? () => bitmap.close() : undefined), [bitmap]);

  /** Decodes an accepted file into the composer (ready after `slowMs`). */
  const load = useCallback(
    async (file: File) => {
      setPhase({ kind: 'loading' });
      let decoded: ImageBitmap;
      try {
        decoded = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        toasts.show({ text: t.toastDecodeFailed });
        setPhase({ kind: 'idle' });
        return;
      }
      if (knobs.rtClear === 'on') clearTimings();
      if (knobs.slowMs > 0) await delay(knobs.slowMs);
      if (!mounted.current) return decoded.close();
      setPhase({ kind: 'ready', bitmap: decoded });
    },
    [knobs.slowMs, knobs.rtClear, toasts, t],
  );

  // The shell's header input started the story session with this file (AM35).
  useEffect(() => {
    if (sessionFile) void load(sessionFile);
  }, [sessionFile, load]);

  const acceptFiles = useCallback(
    async (files: FileList | null, isTrusted: boolean, via: Knobs['listen']) => {
      if (knobs.listen !== via) return markInput('ignored-listen');
      if (knobs.trusted === 'require' && !isTrusted) return markInput('ignored-untrusted');
      const file = files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toasts.show({ text: t.toastPhotoOnly, persist: true });
        return markInput('rejected-type');
      }
      markInput('accepted');
      await load(file);
    },
    [knobs.listen, knobs.trusted, load, toasts, t],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) =>
    void acceptFiles(e.currentTarget.files, e.nativeEvent.isTrusted, 'change');
  const onDragOver = (e: DragEvent<HTMLElement>) => e.preventDefault();
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    void acceptFiles(e.dataTransfer.files, e.nativeEvent.isTrusted, 'drop');
  };

  const geometry = useMemo(
    () =>
      bitmap
        ? computeGeometry({
            model: knobs.geometry,
            insets: knobs.insets,
            inner: { w: vp.w, h: vp.h },
            dpr: vp.dpr,
            source: { w: bitmap.width, h: bitmap.height },
          })
        : null,
    [bitmap, vp, knobs.geometry, knobs.insets],
  );

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !bitmap || !geometry) return;
    const source = { w: bitmap.width, h: bitmap.height };
    const crop = coverCrop(source, geometry.canvas);
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, geometry.canvas.w, geometry.canvas.h);
    ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, geometry.canvas.w, geometry.canvas.h);
    const truth: FakeGeometry = {
      model: knobs.geometry,
      insets: [knobs.insets[0], knobs.insets[1]],
      inner: { w: vp.w, h: vp.h },
      dpr: vp.dpr,
      source,
      canvas: geometry.canvas,
      css: geometry.css,
      crop,
    };
    truthRef.current = truth;
    html().fakeGeometry = JSON.stringify(truth);
    html().fakeReady = '1';
  }, [bitmap, geometry, vp, knobs.geometry, knobs.insets]);

  // Side effects of readiness: off-host redirect, a challenge, a reload, and the late service-worker claim.
  useEffect(() => {
    if (!bitmap) return;
    const timers: number[] = [];
    if (knobs.offhost === 'afterReady') {
      timers.push(window.setTimeout(() => window.location.assign(OFFHOST_URL), OFFHOST_DELAY_MS));
    }
    if (knobs.sw === 'claimLate') timers.push(window.setTimeout(registerClaimLate, CLAIM_LATE_DELAY_MS));
    const challenge = `${FAKE_PATHS.challenge}?next=${encodeURIComponent(window.location.pathname)}`;
    if (knobs.challenge === 'afterReady') {
      timers.push(window.setTimeout(() => window.location.assign(challenge), CHALLENGE_DELAY_MS));
    }
    if (knobs.challenge === 'afterReadyTop') {
      // F8: a background POST answered with a checkpoint_url; msite's instajax error path moves window.top.
      timers.push(window.setTimeout(() => instajaxRedirect(challenge), CHALLENGE_DELAY_MS));
    }
    if (knobs.challenge === 'afterReadySpa') {
      // In-page, as the msite router would: pushState, then let the shell follow (popstate).
      const spa = () => {
        window.history.pushState(null, '', challenge);
        window.dispatchEvent(new PopStateEvent('popstate'));
      };
      timers.push(window.setTimeout(spa, CHALLENGE_DELAY_MS));
    }
    if (knobs.reload === 'afterReady') timers.push(window.setTimeout(() => window.location.reload(), OFFHOST_DELAY_MS));
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [bitmap, knobs.offhost, knobs.sw, knobs.challenge, knobs.reload]);

  /** One Share (or Retry): the whole of Instagram's uploadStory, once. */
  const upload = async (isTrusted: boolean) => {
    const canvas = canvasRef.current;
    const truth = truthRef.current;
    if (!canvas || !truth) return;
    setUploading(true);
    telemetry('compose_stage_attempt');
    const jpeg = await toJpeg(canvas);
    const meta: FakeShareMeta = {
      isTrusted,
      canvas: truth.canvas,
      css: { w: truth.css.w, h: truth.css.h },
      dpr: truth.dpr,
      source: truth.source,
      inner: truth.inner,
      lang: document.documentElement.lang,
      knobs,
      geometry: truth,
      path: window.location.pathname,
      navigatorUa: navigator.userAgent,
      sessionStarted: sessionId !== null,
      sessionId,
      screenOrientation: screenOrientationType(),
      variant,
      fbAuto: fbBadge,
    };
    const outcome = await uploadStory({
      jpeg,
      uploadId: String(Date.now()),
      size: truth.canvas,
      meta,
      shareToFacebook: knobs.fb === 'auto',
      onStaged: () => telemetry('compose_finalize_attempt'),
    });
    switch (outcome.kind) {
      case 'published': {
        telemetry('compose');
        toasts.show({ text: knobs.fb === 'auto' ? t.toastAddedFacebook : t.toastAdded, persist: true });
        onShareSettled?.('published');
        await refreshTray();
        logStep('tray_refresh', { tray: knobs.tray });
        // `tray=throw`: Instagram's refreshStoryReels rejected; no navigation, the modal stays.
        if (knobs.tray === 'throw') return;
        if (mounted.current) setUploading(false);
        onExit?.('shared');
        return;
      }
      case 'checkpoint':
        // F8: PolarisInstajax sets window.top.location.href (in a frame: the desktop page).
        instajaxRedirect(outcome.url);
        return;
      case 'login':
        instajaxRedirect(`${FAKE_PATHS.login}?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      case 'feedback':
        telemetry('compose_failure');
        if (mounted.current) {
          setUploading(false);
          setFeedback(true);
        }
        return;
      case 'failed':
        telemetry('compose_failure');
        if (!mounted.current) return;
        setUploading(false);
        toasts.show({
          text: t.toastUploadFailed,
          persist: true,
          action: {
            label: t.retry,
            onAction: (e) => {
              reportControl('retry', e.nativeEvent.isTrusted, false, e.currentTarget);
              void upload(e.nativeEvent.isTrusted);
            },
          },
        });
        onShareSettled?.('failed');
        return;
    }
  };

  const share = (e: MouseEvent<HTMLElement>) => {
    const isTrusted = e.nativeEvent.isTrusted;
    if (phase.kind !== 'ready') return;
    // No in-flight guard, as on Instagram: a second click is a second upload (DOUBLE_SHARE).
    reportControl('share', isTrusted, shares.current > 0, e.currentTarget);
    shares.current += 1;
    void upload(isTrusted);
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = URL.createObjectURL(await toJpeg(canvas));
    const a = document.createElement('a');
    a.href = url;
    a.download = `story-${Date.now()}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const tap = (control: FakeControl, then?: () => void) => (e: MouseEvent) => {
    reportControl(control, e.nativeEvent.isTrusted, false, e.currentTarget);
    then?.();
  };

  const shareFooter = (key: string) => (
    <footer key={key} className={c('footer')} data-testid="fake-share-footer" data-variant={variant}>
      <div>
        <div>
          {variant === 'v1' ? (
            <button type="button" data-testid="fake-share" className={c('_aswp')} onClick={share}>
              <Glyph d={GLYPH.newStory} />
              <span>{t.share}</span>
            </button>
          ) : (
            <div>
              {/* biome-ignore lint/a11y/useSemanticElements: ShareFooterV2 is a role=button div on Instagram (C12) */}
              <div
                role="button"
                tabIndex={0}
                data-testid="fake-share"
                className={c('_aswp')}
                onClick={share}
                onKeyDown={() => undefined}
              >
                <span className={c('avatar')}>
                  <img src={AVATAR_SRC} alt="" width={24} height={24} />
                  {fbBadge ? (
                    <span className={c('badge')} data-testid="fake-fb-badge">
                      <Glyph d={GLYPH.facebook} label={t.fbBadge} />
                    </span>
                  ) : null}
                </span>
                <span style={{ marginLeft: 8 }}>{t.shareStory}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </footer>
  );

  const drawn = bitmap !== null && geometry !== null;
  const showCanvas = Boolean(sessionFile) || drawn;
  // Instagram renders the Share footer only once the photo is in (and never in landscape).
  const footers =
    !drawn || landscape || knobs.shareControl === 'missing' ? [] : knobs.shareControl === 'two' ? ['a', 'b'] : ['a'];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for listen=drop; the file input is the accessible path
    <section data-testid="fake-composer" onDragOver={onDragOver} onDrop={onDrop}>
      {inputMounted ? (
        <input
          ref={inputRef}
          type="file"
          accept={STORY_ACCEPT_LISTS[knobs.accept]}
          hidden
          data-testid="fake-story-input"
          onChange={onChange}
        />
      ) : null}
      {drawn ? <div className={c('backdrop')} /> : null}
      {showCanvas ? (
        <canvas
          ref={canvasRef}
          data-testid="fake-composer-canvas"
          className={c('_aa3c')}
          width={drawn ? geometry.canvas.w : 0}
          height={drawn ? geometry.canvas.h : 0}
          style={
            drawn
              ? {
                  position: 'fixed',
                  left: geometry.css.x,
                  top: geometry.css.y,
                  width: geometry.css.w,
                  height: geometry.css.h,
                  display: 'block',
                  zIndex: 11,
                }
              : { display: 'block', width: 0, height: 0 }
          }
        />
      ) : null}
      {/* AM37: in landscape the composer renders no header and no Share footer, only the snackbar. */}
      {drawn && !landscape ? (
        <header className={c('_aa3d')}>
          <button
            type="button"
            data-testid="fake-close"
            className={c('_aa3e')}
            onClick={tap('close', () => onExit?.('closed'))}
          >
            {t.close}
          </button>
          <div className={c('_aa3f')}>
            {knobs.save === 'on' ? (
              <button
                type="button"
                data-testid="fake-save"
                className={c('_aa3g')}
                onClick={tap('save', () => void save())}
              >
                {t.save}
              </button>
            ) : null}
            <button type="button" data-testid="fake-text" className={c('_aa3i')} onClick={tap('text')}>
              {t.text}
            </button>
            <button type="button" data-testid="fake-draw" className={c('_aa3j')} onClick={tap('draw')}>
              {t.draw}
            </button>
            <button type="button" data-testid="fake-ai-label" className={c('_aa3j')} onClick={tap('aiLabel')}>
              {t.aiLabel}
            </button>
          </div>
        </header>
      ) : null}
      {footers.map(shareFooter)}
      {!drawn ? (
        <div className={c('start')}>
          {phase.kind === 'loading' || sessionFile ? (
            <p>{t.composerLoading}</p>
          ) : (
            <>
              <p>{t.composerPick}</p>
              <p>{t.composerDrop}</p>
            </>
          )}
        </div>
      ) : null}
      {uploading ? (
        <div role="dialog" aria-modal="true" className={c('modal')} data-testid="fake-upload-modal">
          <div className={c('dialogBox')}>
            <p>{t.uploading}</p>
            <div role="progressbar" className={c('progress')} />
          </div>
        </div>
      ) : null}
      {feedback ? (
        <div role="dialog" aria-modal="true" className={c('modal')} data-testid="fake-feedback">
          <div className={c('dialogBox')}>
            <p>
              <b>{t.feedbackTitle}</b>
            </p>
            <p>{t.feedbackBody}</p>
            <button type="button" className={c('_aswp')} onClick={tap('dialog')}>
              {t.ok}
            </button>
          </div>
        </div>
      ) : null}
      {landscape ? (
        <div className={c('toasts')}>
          <Snackbar text={t.toastRotate} />
        </div>
      ) : null}
    </section>
  );
}
