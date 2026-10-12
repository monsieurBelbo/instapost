/**
 * The stage (strategy §7.10): the 1080x1920 frame scaled to fit its container at 9:16, drawn by
 * the same compose() + rasterize() as the export (with the proxy bitmap, placeholders and guides).
 *
 * Gestures, all in story px: drag pans the image, or moves the text when the pointer starts on
 * the text block; the wheel and trackpad pinch (wheel + ctrlKey) zoom about the pointer; two
 * touch pointers pinch-zoom; arrow keys nudge the image 1 px (10 with Shift).
 */
import { useSignal, useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { FRAME, type Point, type Size } from '../core/geometry/fit.ts';
import { compose } from '../core/render/compose.ts';
import { layoutText } from '../core/text/layout.ts';
import { rasterize } from '../raster/rasterize.ts';
import {
  assetSize,
  doc,
  fontsReady,
  frame,
  image,
  imageLayer,
  measurer,
  moveText,
  panImage,
  showSafeZones,
  textLayer,
  zoomImageAt,
} from './editor-state.ts';
import { clientToStory, fitStage, hitTextBlock, storyPerClientPx, wheelZoomFactor } from './interaction.ts';

type DragKind = 'image' | 'text';

const round = (n: number): number => Math.round(n * 100) / 100;

/** The text block under story point `p`, if the text layer has visible text. */
function onText(p: Point): boolean {
  const t = textLayer.value;
  if (!t || t.text.trim() === '' || !fontsReady.value) return false;
  try {
    const layout = layoutText(t, measurer);
    return hitTextBlock(t.xf, { w: layout.width, h: layout.height }, p);
  } catch {
    return false;
  }
}

export function Stage() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cssSize = useSignal<Size>({ w: 0, h: 0 });
  const dpr = useSignal(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  const renderError = useSignal<string | null>(null);
  const hoverText = useSignal(false);
  const dragging = useSignal<DragKind | null>(null);

  // Size: the largest 9:16 box in the wrapper; DPR changes when the window moves between screens.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) cssSize.value = fitStage({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const onResize = () => {
      dpr.value = devicePixelRatio || 1;
    };
    window.addEventListener('resize', onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [cssSize, dpr]);

  // Render on any state change, coalesced to one draw per animation frame.
  useSignalEffect(() => {
    const d = doc.value;
    const frameId = frame.value.id;
    const img = image.value;
    const safe = showSafeZones.value;
    const size = cssSize.value;
    const ratio = dpr.value;
    void fontsReady.value; // redraw once text can be measured
    const handle = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas || size.w === 0) return;
      const bw = Math.round(size.w * ratio);
      const bh = Math.round(size.h * ratio);
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
      if (!ctx) return;
      try {
        const ops = compose(d, frameId, 0, 'preview', { assetSize, measurer, guides: { safe, adSafe: false } });
        rasterize(ops, ctx, bw / FRAME.w, { image: (id) => (img && id === img.assetId ? img.proxy : undefined) });
        renderError.value = null;
      } catch (err) {
        renderError.value = err instanceof Error ? err.message : String(err);
      }
    });
    return () => cancelAnimationFrame(handle);
  });

  // Pointer gestures. Positions are client px; deltas are converted with the stage's scale.
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; mid: Point } | null>(null);

  const rect = () => canvasRef.current?.getBoundingClientRect() ?? null;

  const pinchState = (): { dist: number; mid: Point } | null => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = rect();
    if (!r) return;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      pinch.current = pinchState();
      dragging.value = null;
      return;
    }
    const p = clientToStory({ x: e.clientX, y: e.clientY }, r);
    dragging.value = onText(p) ? 'text' : imageLayer.value ? 'image' : null;
  };

  const onPointerMove = (e: PointerEvent) => {
    const r = rect();
    if (!r) return;
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      hoverText.value = onText(clientToStory({ x: e.clientX, y: e.clientY }, r));
      return;
    }
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    const k = storyPerClientPx(r.width);
    if (pinch.current) {
      const next = pinchState();
      if (!next || pinch.current.dist === 0) return;
      panImage((next.mid.x - pinch.current.mid.x) * k, (next.mid.y - pinch.current.mid.y) * k);
      zoomImageAt(clientToStory(next.mid, r), next.dist / pinch.current.dist);
      pinch.current = next;
      return;
    }
    const dx = (cur.x - prev.x) * k;
    const dy = (cur.y - prev.y) * k;
    if (dragging.value === 'text') moveText(dx, dy);
    else if (dragging.value === 'image') panImage(dx, dy);
  };

  const onPointerEnd = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) dragging.value = null;
  };

  // Wheel must be non-passive to keep the page from scrolling or zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      if (!imageLayer.value) return;
      zoomImageAt(clientToStory({ x: e.clientX, y: e.clientY }, r), wheelZoomFactor(e));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = d[e.key];
    if (!move || !imageLayer.value) return;
    e.preventDefault();
    panImage(move[0], move[1]);
  };

  const il = imageLayer.value;
  const tl = textLayer.value;
  const size = cssSize.value;
  const cursor = dragging.value ? 'grabbing' : hoverText.value ? 'move' : il ? 'grab' : 'default';

  return (
    <div class="stage-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        class="stage"
        data-testid="editor-stage"
        tabIndex={0}
        role="img"
        aria-label="Story preview, 1080 by 1920"
        style={{ width: `${size.w}px`, height: `${size.h}px`, cursor }}
        data-asset-id={image.value?.assetId ?? ''}
        data-xf={
          il
            ? JSON.stringify({
                cx: round(il.xf.cx),
                cy: round(il.xf.cy),
                scale: round(il.xf.scale),
                rotDeg: round(il.xf.rotDeg),
              })
            : ''
        }
        data-text-xf={tl ? JSON.stringify({ cx: round(tl.xf.cx), cy: round(tl.xf.cy) }) : ''}
        data-render-error={renderError.value ?? ''}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      />
      {!image.value && size.w > 0 && (
        <p class="stage-hint" style={{ width: `${size.w}px` }}>
          Drop a photo here, or use <strong>Open image…</strong>
        </p>
      )}
      {renderError.value && (
        <p class="stage-error" role="alert">
          {renderError.value}
        </p>
      )}
    </div>
  );
}
