/** @jsxImportSource react */
/**
 * The msite story composer (strategy §6.1, §7.6), mountable on its own (B6).
 *
 * - The hidden story input (`accept` per knob) is rendered when `inputMounted`.
 * - Files are read from `change` (React onChange; a synthetic `change` fires it, AM3) or, with
 *   `listen=drop`, only from a drop. `trusted=require` ignores events with isTrusted=false.
 * - Portrait guard and photo-only toasts as research §1 item 2 describes.
 * - Ready (C6) = the canvas is mounted and drawn, `slowMs` after the file was accepted. The
 *   source is cover-cropped to the canvas aspect and drawn centred; the geometry ground truth
 *   goes in `document.documentElement.dataset.fakeGeometry`.
 * - Share POSTs the canvas JPEG (q0.92) to /__fake__/stories with x-fake-meta, including the
 *   click's isTrusted; `share=real-paths` then also fires no-cors subresource POSTs to
 *   real-shaped write paths (AM6). `share=background` goes home first and uploads 4.5 s later
 *   (AM19): the story is recorded only if the window is still open by then.
 * - Once ready: `offhost=afterReady` leaves Instagram, `challenge=afterReady…` goes to /challenge/
 *   (full navigation or pushState), `reload=afterReady` reloads the document (AM2).
 * - Close and Save report their click's isTrusted (FID-2).
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
  BACKGROUND_UPLOAD_DELAY_MS,
  CHALLENGE_DELAY_MS,
  FAKE_META_HEADER,
  FAKE_PATHS,
  type FakeGeometry,
  type FakeShareMeta,
  OFFHOST_URL,
  realWriteTargets,
} from '../protocol.ts';
import { reportControl } from './control.ts';
import { computeGeometry, coverCrop } from './geometry.ts';
import type { Strings } from './i18n.ts';
import { useCx } from './styles.ts';
import { CLAIM_LATE_DELAY_MS, registerClaimLate } from './sw.ts';
import { Toast, useToast } from './ui.tsx';

export interface StoryComposerProps {
  knobs: Knobs;
  t: Strings;
  /** The story input is in the DOM: `input=present`, or the human tapped + → Story. */
  inputMounted: boolean;
  /** The human just tapped + → Story: open the file picker once, then call onPickHandled. */
  pickPending?: boolean;
  onPickHandled?: () => void;
  /** After a recorded Share, or on Close. The msite shell SPA-navigates to `/`. */
  onExit?: (reason: 'shared' | 'closed') => void;
  /** Where Share posts (default /__fake__/stories). */
  shareUrl?: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; bitmap: ImageBitmap }
  | { kind: 'sharing'; bitmap: ImageBitmap };

/** Last input outcome, for debugging only (`data-fake-input` on <html>). */
type InputOutcome = 'accepted' | 'ignored-listen' | 'ignored-untrusted' | 'rejected-landscape' | 'rejected-type';

const JPEG_QUALITY = 0.92;
/** How long the composer stays ready before `offhost=afterReady` navigates away. */
const OFFHOST_DELAY_MS = 500;

const html = () => document.documentElement.dataset;
const markInput = (o: InputOutcome) => {
  html().fakeInput = o;
};
const isLandscape = () => window.innerHeight < window.innerWidth;
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

/** Instagram's finalize step would follow the upload; both are subresource POSTs, never navigations. */
async function fireRealPaths(jpeg: Blob): Promise<void> {
  const uploadId = String(Date.now());
  const target = realWriteTargets(uploadId);
  const attempt = (url: string, body: BodyInit) =>
    fetch(url, { method: 'POST', mode: 'no-cors', credentials: 'include', body }).catch(() => undefined);
  await attempt(target.rupload, await jpeg.arrayBuffer());
  await attempt(target.configure, new URLSearchParams({ upload_id: uploadId, configure_mode: '1', caption: '' }));
}

export function StoryComposer(props: StoryComposerProps) {
  const { knobs, t, inputMounted, pickPending, onPickHandled, onExit } = props;
  const shareUrl = props.shareUrl ?? FAKE_PATHS.stories;
  const c = useCx();
  const vp = useViewport();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [toast, showToast] = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const truthRef = useRef<FakeGeometry | null>(null);
  const mounted = useRef(true);

  const bitmap = phase.kind === 'ready' || phase.kind === 'sharing' ? phase.bitmap : null;
  const landscape = vp.h < vp.w;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      delete html().fakeGeometry;
      delete html().fakeReady;
    };
  }, []);

  useEffect(() => (bitmap ? () => bitmap.close() : undefined), [bitmap]);

  useEffect(() => {
    if (!pickPending || !inputMounted) return;
    inputRef.current?.click();
    onPickHandled?.();
  }, [pickPending, inputMounted, onPickHandled]);

  const acceptFiles = useCallback(
    async (files: FileList | null, isTrusted: boolean, via: Knobs['listen']) => {
      if (knobs.listen !== via) return markInput('ignored-listen');
      if (knobs.trusted === 'require' && !isTrusted) return markInput('ignored-untrusted');
      const file = files?.[0];
      if (!file) return;
      // The rotate toast is already showing; the file is dropped, as on Instagram.
      if (isLandscape()) return markInput('rejected-landscape');
      if (!file.type.startsWith('image/')) {
        showToast(t.toastPhotoOnly);
        return markInput('rejected-type');
      }
      markInput('accepted');
      setPhase({ kind: 'loading' });
      let decoded: ImageBitmap;
      try {
        decoded = await createImageBitmap(file, { imageOrientation: 'from-image' });
      } catch {
        showToast(t.toastDecodeFailed);
        setPhase({ kind: 'idle' });
        return;
      }
      if (knobs.slowMs > 0) await delay(knobs.slowMs);
      if (!mounted.current) return decoded.close();
      setPhase({ kind: 'ready', bitmap: decoded });
    },
    [knobs.listen, knobs.trusted, knobs.slowMs, showToast, t],
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

  // Side effects of readiness: off-host redirect and the late service-worker claim.
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

  const share = async (e: MouseEvent<HTMLButtonElement>) => {
    const isTrusted = e.nativeEvent.isTrusted;
    const canvas = canvasRef.current;
    const truth = truthRef.current;
    if (phase.kind !== 'ready' || !canvas || !truth) return;
    const ready = phase;
    setPhase({ kind: 'sharing', bitmap: ready.bitmap });
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
    };
    const upload = () =>
      fetch(shareUrl, {
        method: 'POST',
        headers: { 'content-type': 'image/jpeg', [FAKE_META_HEADER]: JSON.stringify(meta) },
        body: jpeg,
      });
    if (knobs.share === 'background') {
      // Home first; the upload keeps running behind the feed, as long as the document lives.
      onExit?.('shared');
      await delay(BACKGROUND_UPLOAD_DELAY_MS);
      await upload().catch(() => undefined);
      return;
    }
    try {
      const res = await upload();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      if (!mounted.current) return;
      showToast(t.toastShareFailed);
      setPhase(ready);
      return;
    }
    if (knobs.share === 'real-paths') await fireRealPaths(jpeg);
    onExit?.('shared');
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
      {bitmap && geometry ? (
        <>
          <div className={c('backdrop')} />
          <canvas
            ref={canvasRef}
            data-testid="fake-composer-canvas"
            width={geometry.canvas.w}
            height={geometry.canvas.h}
            style={{
              position: 'fixed',
              left: geometry.css.x,
              top: geometry.css.y,
              width: geometry.css.w,
              height: geometry.css.h,
              display: 'block',
              zIndex: 11,
            }}
          />
          <div className={c('bar')} style={{ top: 0 }}>
            <button
              type="button"
              data-testid="fake-close"
              className={c('barBtn')}
              onClick={(e) => {
                reportControl('close', e.nativeEvent.isTrusted);
                onExit?.('closed');
              }}
            >
              {t.close}
            </button>
            {knobs.save === 'on' ? (
              <button
                type="button"
                data-testid="fake-save"
                className={c('barBtn')}
                onClick={(e) => {
                  reportControl('save', e.nativeEvent.isTrusted);
                  void save();
                }}
              >
                {t.save}
              </button>
            ) : null}
          </div>
          <div className={c('bar')} style={{ bottom: 0, justifyContent: 'flex-end' }}>
            <button
              type="button"
              data-testid="fake-share"
              className={c('share')}
              disabled={phase.kind === 'sharing'}
              onClick={(e) => void share(e)}
            >
              {t.share}
            </button>
          </div>
        </>
      ) : (
        <div className={c('start')}>
          {phase.kind === 'loading' ? (
            <p>{t.composerLoading}</p>
          ) : (
            <>
              <p>{t.composerPick}</p>
              <p>{t.composerDrop}</p>
            </>
          )}
        </div>
      )}
      <div className={c('toasts')}>
        {landscape ? <Toast rotate text={t.toastRotate} /> : null}
        {toast ? <Toast text={toast} /> : null}
      </div>
    </section>
  );
}
