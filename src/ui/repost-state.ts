/**
 * The composer's repost (docs/repost.md RP-20–RP-30): the intake (`intake`: loading, permission, denied,
 * expired, failed) and, once the picture is decoded, the repost being edited (`repost`): its source, look,
 * palette and the card on the stage. In memory only (AM59): the card is painted into a bitmap (raster/card.ts)
 * and placed as the frame's `free` image layer, the source photo is the editor's `backdrop` (for Blur), the
 * doc is transient (no autosave), nothing is stored and no URL is kept beyond the intake.
 *
 * Restyling repaints the card (about 50 ms) and swaps the layer's asset, keeping its placement. Loading a
 * photo, a draft or a new story ends the repost (editor-state's onTransientEnd).
 */
import { batch, computed, signal } from '@preact/signals';
import type { Fill } from '../core/model/story.ts';
import type { CardStyle } from '../core/repost/card-layout.ts';
import {
  CARD_CENTRE,
  type CardSpec,
  cardSpec,
  cardXf,
  clampCardCentre,
  clampCardXf,
  clampUserScale,
  creditBox,
  onCard,
  userScaleOf,
} from '../core/repost/card-layout.ts';
import {
  cycleLook,
  defaultLook,
  isOwnPost,
  type RepostBg,
  type RepostLook,
  withBg,
  withCredit,
  withLook,
  withScale,
} from '../core/repost/edit.ts';
import { type Palette, palette } from '../core/repost/palette.ts';
import { isRepostSource, type RepostMeta, type RepostSource, repostMeta } from '../core/repost/source.ts';
import { onCdnGranted, requestCdn } from '../platform/permissions.ts';
import { paintCard } from '../raster/card.ts';
import { makeProxy } from '../raster/decode.ts';
import type { LoadedImage } from './assets.ts';
import { keepCurrentDraft } from './drafts.ts';
import {
  image,
  imageLayer,
  onTransientEnd,
  placeTransient,
  setBackground,
  setFreeLimit,
  setImageXf,
} from './editor-state.ts';
import { appendRepostDiag } from './repost/diag.ts';
import { defaultIntakeDeps, type IntakeDeps, loadRepostMedia } from './repost/intake.ts';

export type IntakeState = 'loading' | 'permission' | 'denied' | 'expired' | 'failed';

export interface Intake {
  src: RepostSource;
  state: IntakeState;
  /** RP-20: permissions.request threw (no gesture in a framed page, or the browser refused): use Settings. */
  settingsRoute: boolean;
  seq: number;
}

export interface RepostEdit {
  src: RepostSource;
  /** RP-25: the owner's own post (the credit may be hidden). */
  own: boolean;
  look: RepostLook;
  spec: CardSpec;
  palette: Palette;
  cardAssetId: string;
  /** The credit's drawn width (the painter's), for the clamp that keeps it in the frame (AM56). */
  creditW: number | null;
  backdrop: LoadedImage;
  avatar: ImageBitmap | null;
  mediaW: number;
  lowRes: boolean;
}

export const intake = signal<Intake | null>(null);
export const repost = signal<RepostEdit | null>(null);
/** The repost is what the stage shows (its card is the image layer). */
export const repostActive = computed(() => {
  const r = repost.value;
  return r !== null && image.value?.assetId === r.cardAssetId;
});
/** The current user scale, from the layer (the wheel and pinch change it through the limiter). */
export const repostScale = computed(() => {
  const r = repost.value;
  const l = imageLayer.value;
  return r && l && repostActive.value ? userScaleOf(r.spec, l.xf.scale) : 1;
});

let seq = 0;
let paintSeq = 0;
let deps: IntakeDeps = defaultIntakeDeps;
/** Tests only: the intake's network, permission and decode. */
export function setIntakeDeps(d: IntakeDeps): void {
  deps = d;
}

type Ready = (info: { kept: boolean; lowRes: boolean; kind: RepostSource['kind'] }) => void;
const readyListeners = new Set<Ready>();
/** The repost is on the stage (the composer shows the hint and the kept-draft toast). */
export function onRepostReady(f: Ready): () => void {
  readyListeners.add(f);
  return () => readyListeners.delete(f);
}

const uuid = () => crypto.randomUUID();
const diag = (where: 'intake' | 'fetch', why: string) => void appendRepostDiag(where, why.slice(0, 48));

onTransientEnd(() => {
  const r = repost.value;
  r?.avatar?.close();
  repost.value = null;
});

/** The 16×16 cover sample the palette is taken from. */
function sampleOf(src: ImageBitmap): Uint8ClampedArray {
  const c = new OffscreenCanvas(16, 16);
  const ctx = c.getContext('2d');
  if (!ctx) return new Uint8ClampedArray(16 * 16 * 4);
  const side = Math.min(src.width, src.height);
  ctx.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, 16, 16);
  return ctx.getImageData(0, 0, 16, 16).data;
}

function fillOf(bg: RepostBg, pal: Palette, backdropId: string): Fill {
  if (bg === 'blur') return { kind: 'blur', assetId: backdropId, radiusPx: 48, dim: 0.35 };
  if (bg === 'black') return { kind: 'solid', color: '#000000' };
  return { kind: 'gradient', from: pal.from, to: pal.to, angleDeg: 180 };
}

async function paint(
  r: Pick<RepostEdit, 'src' | 'palette' | 'backdrop' | 'avatar'>,
  spec: CardSpec,
): Promise<{ card: LoadedImage; creditW: number | null }> {
  const { bitmap, creditW } = await paintCard({
    spec,
    photo: r.backdrop.full,
    avatar: r.avatar,
    author: r.src.author,
    avatarFill: r.palette.to,
  });
  return {
    card: {
      assetId: `repost_card_${uuid()}`,
      mime: 'image/png',
      size: { w: bitmap.width, h: bitmap.height },
      full: bitmap,
      proxy: bitmap,
      stored: false,
    },
    creditW,
  };
}

const specOf = (src: RepostSource, look: RepostLook): CardSpec =>
  cardSpec(look.style, src.aspect, look.credit, src.kind);

/** RP-26: the card's scale range and centre clamp, the credit kept whole in the frame (AM56). */
function limiterFor(spec: CardSpec, creditW: number | null): void {
  const credit = creditBox(spec, creditW);
  setFreeLimit((xf) => clampCardXf(xf, spec, credit));
}

// ---- intake -------------------------------------------------------------------------------------------

let account: () => string | null = () => null;
/** RP-25: the account the composer knows (settings' expected account, else the page's handle). */
export function setRepostAccount(f: () => string | null): void {
  account = f;
}

/** `ui/repost`: the owner's Add to story arrived (checked again here). */
export function receiveRepost(src: unknown): boolean {
  if (!isRepostSource(src)) {
    diag('intake', 'invalid-source');
    return false;
  }
  seq += 1;
  intake.value = { src, state: 'loading', settingsRoute: false, seq };
  void runIntake();
  return true;
}

/** The intake whose GETs are in flight (one run per owner click: Allow and onAdded can both ask). */
let inflight = -1;

export async function runIntake(): Promise<void> {
  const it = intake.value;
  if (!it || inflight === it.seq) return;
  inflight = it.seq;
  try {
    await intakeOnce(it);
  } finally {
    if (inflight === it.seq) inflight = -1;
  }
}

async function intakeOnce(it: Intake): Promise<void> {
  if (it.state !== 'loading') intake.value = { ...it, state: 'loading' };
  const out = await loadRepostMedia(it.src, deps);
  const now = intake.value;
  if (now?.seq !== it.seq) {
    if (out.ok) {
      out.photo.bitmap.close();
      out.avatar?.close();
    }
    return;
  }
  if (!out.ok) {
    if (out.state !== 'permission') diag('fetch', out.why);
    intake.value = { ...now, state: out.state };
    return;
  }
  try {
    await present(it.src, out.photo.bitmap, out.photo.mime, out.avatar, out.lowRes);
    if (intake.value?.seq === it.seq) intake.value = null;
  } catch (err) {
    diag('intake', err instanceof Error && /FONT/.test(err.message) ? 'font' : 'paint');
    intake.value = { ...it, state: 'failed' };
  }
}

async function present(
  src: RepostSource,
  photo: ImageBitmap,
  mime: LoadedImage['mime'],
  avatar: ImageBitmap | null,
  lowRes: boolean,
): Promise<void> {
  const kept = await keepCurrentDraft();
  const own = isOwnPost(src, account());
  const look = defaultLook(src.kind);
  const pal = palette(sampleOf(photo));
  const backdrop: LoadedImage = {
    assetId: `repost_src_${uuid()}`,
    mime,
    size: { w: photo.width, h: photo.height },
    full: photo,
    proxy: await makeProxy(photo),
    stored: false,
  };
  const spec = specOf(src, look);
  const base = { src, palette: pal, backdrop, avatar };
  const { card, creditW } = await paint(base, spec);
  const centre = clampCardCentre(CARD_CENTRE[src.kind], spec, look.userScale, creditBox(spec, creditW));
  const prev = repost.value;
  // A repost replacing another: its avatar goes (its card and backdrop are released by placeTransient).
  if (prev && prev.avatar !== avatar) prev.avatar?.close();
  batch(() => {
    placeTransient(card, backdrop, cardXf(spec, look.userScale, centre), fillOf(look.bg, pal, backdrop.assetId), true);
    repost.value = { ...base, own, look, spec, cardAssetId: card.assetId, creditW, mediaW: photo.width, lowRes };
  });
  limiterFor(spec, creditW);
  for (const f of readyListeners) f({ kept, lowRes, kind: src.kind });
}

/** RP-20: Allow (inside the owner's click). */
export async function allowCdn(): Promise<void> {
  const it = intake.value;
  if (!it) return;
  let granted: boolean;
  try {
    granted = await requestCdn();
  } catch {
    diag('intake', 'perm-request-threw');
    intake.value = { ...it, state: 'permission', settingsRoute: true };
    return;
  }
  if (intake.value?.seq !== it.seq) return;
  if (!granted) {
    diag('intake', 'perm-denied');
    intake.value = { ...it, state: 'denied' };
    return;
  }
  await runIntake();
}

// The permission granted elsewhere (the editor's Settings row): the intake resumes by itself.
onCdnGranted(() => {
  const it = intake.value;
  if (it && (it.state === 'permission' || it.state === 'denied')) void runIntake();
});

/** ✕, or a photo chosen instead. */
export function cancelIntake(): void {
  intake.value = null;
}

/** Try again (failed): the same plan once more. */
export function retryIntake(): void {
  if (intake.value) void runIntake();
}

// ---- editing (RP-26–RP-29) ---------------------------------------------------------------------------

async function restyle(next: RepostLook): Promise<void> {
  const r = repost.value;
  if (!r || !repostActive.value) return;
  const mine = ++paintSeq;
  const spec = specOf(r.src, next);
  const l = imageLayer.value;
  const u = clampUserScale(r.src.kind, l ? userScaleOf(r.spec, l.xf.scale) : next.userScale);
  const { card, creditW } = await paint(r, spec);
  const cur = repost.value;
  if (mine !== paintSeq || !cur || cur.cardAssetId !== r.cardAssetId || !repostActive.value) {
    card.full.close();
    return;
  }
  const at = imageLayer.value?.xf ?? { cx: CARD_CENTRE[r.src.kind].x, cy: CARD_CENTRE[r.src.kind].y };
  const centre = clampCardCentre({ x: at.cx, y: at.cy }, spec, u, creditBox(spec, creditW));
  batch(() => {
    placeTransient(
      card,
      cur.backdrop,
      cardXf(spec, u, centre),
      fillOf(next.bg, cur.palette, cur.backdrop.assetId),
      false,
    );
    repost.value = { ...cur, look: { ...next, userScale: u }, spec, cardAssetId: card.assetId, creditW };
  });
  limiterFor(spec, creditW);
}

export function cycleRepostLook(): void {
  const r = repost.value;
  if (r && r.src.kind === 'post') void restyle(cycleLook(r.look, r.src.kind));
}

export function setRepostLook(style: CardStyle): void {
  const r = repost.value;
  if (r && r.look.style !== style) void restyle(withLook(r.look, style, r.src.kind));
}

export function setRepostCredit(on: boolean): void {
  const r = repost.value;
  if (r?.own && r.look.credit !== on) void restyle(withCredit(r.look, on, r.own));
}

export function setRepostBg(bg: RepostBg): void {
  const r = repost.value;
  if (!r || !repostActive.value) return;
  const look = withBg(r.look, bg);
  repost.value = { ...r, look };
  setBackground(fillOf(look.bg, r.palette, r.backdrop.assetId));
}

export function setRepostScale(s: number): void {
  const r = repost.value;
  const l = imageLayer.value;
  if (!r || !l || !repostActive.value) return;
  const look = withScale(r.look, s, r.src.kind);
  const centre = clampCardCentre({ x: l.xf.cx, y: l.xf.cy }, r.spec, look.userScale, creditBox(r.spec, r.creditW));
  repost.value = { ...r, look };
  setImageXf(cardXf(r.spec, look.userScale, centre));
}

export function resetRepost(): void {
  const r = repost.value;
  if (!r || !repostActive.value) return;
  const look = defaultLook(r.src.kind);
  void restyle(look).then(() => {
    const cur = repost.value;
    if (!cur) return;
    const centre = clampCardCentre(
      CARD_CENTRE[cur.src.kind],
      cur.spec,
      look.userScale,
      creditBox(cur.spec, cur.creditW),
    );
    setImageXf(cardXf(cur.spec, look.userScale, centre));
  });
}

/** RP-28: a tap on the card cycles the look (posts). */
export function tapsCard(p: { x: number; y: number }): boolean {
  const r = repost.value;
  const l = imageLayer.value;
  return !!r && !!l && repostActive.value && r.src.kind === 'post' && onCard(r.spec, l.xf, p);
}

/** RP-31: the run record's repost facts, while a repost is on the stage. */
export function currentRepostMeta(): RepostMeta | null {
  const r = repost.value;
  return r && repostActive.value ? repostMeta(r.src, r.mediaW) : null;
}
