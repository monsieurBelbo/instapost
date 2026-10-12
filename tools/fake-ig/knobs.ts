/**
 * Fake Instagram knobs (strategy §6.1): every unverified Instagram behaviour is switchable.
 *
 * DEFAULT_KNOBS is what the fake starts and resets with. It must equal deriveKnobs(baseline.json)
 * (U16), so updating the baseline after L4/L5 forces an update of the fake. deriveKnobs() throws
 * for baseline facts the fake cannot model yet: extend the fake, then the mapping.
 *
 * Pure module (no Node APIs): imported by core.ts and bundled into the client.
 */
import baselineJson from '../../src/core/ig-contract/baseline.json' with { type: 'json' };
import { acceptSetEquals, type Baseline } from '../../src/core/ig-contract/contract.ts';

export type GeometryModel = Baseline['geometry']['model'];

export interface Knobs {
  /** How `is_mobile` is decided: the User-Agent header (real Instagram, §5.1) or `sec-ch-ua-mobile`. */
  classifier: 'ua' | 'client-hints';
  /**
   * `direct`: /create/story/ renders the composer; `homeOnly`: it 302s to `/`; `elsewhere`: it 302s
   * to an interstitial www page that is neither home nor a security flow (`/consent/`, AM17).
   */
  route: 'direct' | 'homeOnly' | 'elsewhere';
  /** The story input is in the DOM on mount, or only after tapping + → Story. */
  input: 'present' | 'afterTap';
  /** The story input's accept list: STORY_ACCEPT_LISTS[accept]. */
  accept: 'default' | 'changed';
  /** Which event the composer reads files from. */
  listen: 'change' | 'drop';
  /** `require`: file events with isTrusted=false are ignored (React itself never filters, S7). */
  trusted: 'ignore' | 'require';
  geometry: GeometryModel;
  /** CSS px reserved at the top and bottom of the viewport before fitting the canvas. */
  insets: [number, number];
  /** Shows the Save button (SAVE_STORY). */
  save: 'on' | 'off';
  /**
   * `real-paths` also fires no-cors subresource POSTs to real-shaped write paths (AM6).
   * `background` (AM19): Share goes home first and uploads afterwards, as a page that keeps posting
   * behind its feed would; the story is recorded only if the window is still open then.
   */
  share: 'fake' | 'real-paths' | 'background';
  sw: 'none' | 'desktopShell' | 'claimLate';
  /** `codeentry`: 302 to /auth_platform/codeentry/ (AM17), another security flow. */
  auth: 'in' | 'out' | 'challenge' | 'codeentry';
  /** `firstLoad` (AM20): /create/story/ itself 302s off-host, before the kill switch is armed. */
  offhost: 'none' | 'afterReady' | 'firstLoad';
  /**
   * A security challenge in the middle of a session (FID-6): after the composer is ready or after
   * Share, by a full navigation to /challenge/ or (`…Spa`) an in-page pushState to it.
   */
  challenge: 'none' | 'afterReady' | 'afterReadySpa' | 'afterShare' | 'afterShareSpa';
  /**
   * What a desktop UA gets for /create/story/ (unverified, L4): a 302 to `/` (desktop has no story
   * entry), or the desktop shell rendered at that URL.
   */
  desktopComposer: '302' | 'desktopShell';
  /** `afterReady`: the composer document reloads itself once it is ready (a later full-document load, AM2). */
  reload: 'none' | 'afterReady';
  locale: 'en' | 'es';
  /** `renamed`: randomised class names and ids. */
  drift: 'none' | 'renamed';
  /** `<meta name="instapost-fake-instagram">` (SG4). */
  marker: 'on' | 'off';
  /** Composer readiness delay after a file is accepted. */
  slowMs: number;
}

export type KnobName = keyof Knobs;
type EnumKnob = Exclude<KnobName, 'geometry' | 'insets' | 'slowMs'>;

/** Allowed values of every enum knob, in display order (first = the usual default). */
export const KNOB_CHOICES: { readonly [K in EnumKnob]: readonly Knobs[K][] } = {
  classifier: ['ua', 'client-hints'],
  route: ['direct', 'homeOnly', 'elsewhere'],
  input: ['present', 'afterTap'],
  accept: ['default', 'changed'],
  listen: ['change', 'drop'],
  trusted: ['ignore', 'require'],
  save: ['on', 'off'],
  share: ['fake', 'real-paths', 'background'],
  sw: ['none', 'desktopShell', 'claimLate'],
  auth: ['in', 'out', 'challenge', 'codeentry'],
  offhost: ['none', 'afterReady', 'firstLoad'],
  challenge: ['none', 'afterReady', 'afterReadySpa', 'afterShare', 'afterShareSpa'],
  desktopComposer: ['302', 'desktopShell'],
  reload: ['none', 'afterReady'],
  locale: ['en', 'es'],
  drift: ['none', 'renamed'],
  marker: ['on', 'off'],
};

/** Every knob, in the order the dashboard shows them. */
export const KNOB_NAMES: readonly KnobName[] = [
  'classifier',
  'route',
  'input',
  'accept',
  'listen',
  'trusted',
  'geometry',
  'insets',
  'save',
  'share',
  'sw',
  'auth',
  'offhost',
  'challenge',
  'desktopComposer',
  'reload',
  'locale',
  'drift',
  'marker',
  'slowMs',
];

/** Story input accept lists. `changed` adds HEIC (still images only), so C4 reports ACCEPT_DRIFT. */
export const STORY_ACCEPT_LISTS: { readonly [K in Knobs['accept']]: string } = {
  default: 'image/avif,image/jpeg,image/png',
  changed: 'image/avif,image/heic,image/jpeg,image/png',
};

/** The post input also accepts video, so it never counts as the story input. */
export const POST_ACCEPT = 'image/jpeg,image/png,video/mp4,video/quicktime';

/** The defaults the fake is written for. U16: must equal deriveKnobs(baseline.json). */
export const DEFAULT_KNOBS: Readonly<Knobs> = Object.freeze<Knobs>({
  classifier: 'ua',
  route: 'direct',
  input: 'present',
  accept: 'default',
  listen: 'change',
  trusted: 'ignore',
  geometry: 'viewportDpr',
  insets: [0, 0],
  save: 'on',
  share: 'fake',
  sw: 'none',
  auth: 'in',
  offhost: 'none',
  challenge: 'none',
  desktopComposer: '302',
  reload: 'none',
  locale: 'en',
  drift: 'none',
  marker: 'on',
  slowMs: 0,
});

/** baseline.json as committed (structural facts only, strategy §7.7). */
export const BASELINE: Baseline = baselineJson as Baseline;

/**
 * Knob defaults implied by a baseline (strategy §3.9 item 3, §7.6, §11 AM26). Knobs the baseline
 * says nothing about (classifier, share, auth, offhost, challenge, desktopComposer, reload, locale,
 * drift, marker, slowMs) take the behaviour research describes, and so does every fact the
 * baseline marks `unknown`. L6's facts map too: an untrusted insert that Instagram ignores makes
 * `trusted=require`, a composer that reads only drops makes `listen=drop`. Throws for facts the
 * fake cannot model.
 */
export function deriveKnobs(b: Baseline): Knobs {
  const unmodelled = (fact: string): never => {
    throw new Error(`fake-ig: baseline ${fact} is not modelled by the fake; extend tools/fake-ig first`);
  };
  if (b.uaProfile !== 'android-reduced') unmodelled(`uaProfile=${String(b.uaProfile)}`);
  if (b.isMobileKeyFound === false) unmodelled('isMobileKeyFound=false');
  if (b.swControlledAfterHardReload === true) unmodelled('swControlledAfterHardReload=true');
  const accept = (Object.keys(STORY_ACCEPT_LISTS) as Knobs['accept'][]).find((k) =>
    acceptSetEquals(STORY_ACCEPT_LISTS[k], b.accept),
  );
  if (accept === undefined) unmodelled(`accept=${b.accept.join(',')}`);
  const geometry = parseGeometryModel(b.geometry.model);
  if (geometry === null) unmodelled(`geometry.model=${b.geometry.model}`);
  return {
    classifier: 'ua',
    route: b.route === 'homeOnly' ? 'homeOnly' : 'direct',
    input: b.storyInputBeforeTap === false ? 'afterTap' : 'present',
    accept: accept as Knobs['accept'],
    listen: b.fileEvent === 'drop' ? 'drop' : 'change',
    trusted: b.untrustedInsertAccepted === false ? 'require' : 'ignore',
    geometry: b.geometry.model,
    insets: [b.geometry.insets[0], b.geometry.insets[1]],
    save: b.geometry.saveExposed === false ? 'off' : 'on',
    share: 'fake',
    sw: b.firstLoadServedBySw === true ? 'desktopShell' : 'none',
    auth: 'in',
    offhost: 'none',
    challenge: 'none',
    desktopComposer: '302',
    reload: 'none',
    locale: 'en',
    drift: 'none',
    marker: 'on',
    slowMs: 0,
  };
}

export type ParsedGeometry =
  | { kind: 'viewportDpr' }
  | { kind: 'source' }
  | { kind: 'fixed' | 'cssFixed'; w: number; h: number };

const GEOMETRY_RE = /^(fixed|cssFixed):([1-9]\d{0,4})x([1-9]\d{0,4})$/;

/** `viewportDpr | source | fixed:WxH | cssFixed:WxH` with 1 <= W, H <= 20000; null otherwise. */
export function parseGeometryModel(model: string): ParsedGeometry | null {
  if (model === 'viewportDpr' || model === 'source') return { kind: model };
  const m = GEOMETRY_RE.exec(model);
  if (!m) return null;
  const w = Number(m[2]);
  const h = Number(m[3]);
  if (w > 20000 || h > 20000) return null;
  return { kind: m[1] as 'fixed' | 'cssFixed', w, h };
}

export type KnobPatchResult = { ok: true; patch: Partial<Knobs> } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseInt0(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/**
 * Validates a partial knob update from the API (JSON) or the dashboard form (strings).
 * Unknown names and invalid values are errors; nothing is applied unless all are valid.
 * `insets` accepts `"top,bottom"` or `[top, bottom]`; `slowMs` a number or digit string.
 */
export function parseKnobPatch(input: unknown): KnobPatchResult {
  if (!isRecord(input)) return { ok: false, errors: ['knobs: expected an object'] };
  const patch: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [name, value] of Object.entries(input)) {
    if (!(KNOB_NAMES as readonly string[]).includes(name)) {
      errors.push(`unknown knob ${name}`);
      continue;
    }
    if (name === 'geometry') {
      if (typeof value === 'string' && parseGeometryModel(value)) patch.geometry = value;
      else errors.push(`geometry: expected viewportDpr|source|fixed:WxH|cssFixed:WxH, got ${JSON.stringify(value)}`);
    } else if (name === 'insets') {
      const parts = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [];
      const nums = parts.map((p) => parseInt0(p, 2000));
      if (nums.length === 2 && nums[0] != null && nums[1] != null) patch.insets = [nums[0], nums[1]];
      else errors.push(`insets: expected "top,bottom" (0..2000), got ${JSON.stringify(value)}`);
    } else if (name === 'slowMs') {
      const n = parseInt0(value, 60_000);
      if (n !== null) patch.slowMs = n;
      else errors.push(`slowMs: expected an integer 0..60000, got ${JSON.stringify(value)}`);
    } else {
      const choices = KNOB_CHOICES[name as EnumKnob] as readonly string[];
      if (typeof value === 'string' && choices.includes(value)) patch[name] = value;
      else errors.push(`${name}: expected ${choices.join('|')}, got ${JSON.stringify(value)}`);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, patch: patch as Partial<Knobs> };
}

export function mergeKnobs(base: Readonly<Knobs>, patch: Partial<Knobs>): Knobs {
  const next = { ...base, ...patch };
  return { ...next, insets: [next.insets[0], next.insets[1]] };
}

export function knobsEqual(a: Readonly<Knobs>, b: Readonly<Knobs>): boolean {
  return KNOB_NAMES.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}
