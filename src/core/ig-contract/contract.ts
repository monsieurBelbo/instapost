/**
 * The versioned msite composer contract C1–C9 (strategy §3.9) and the structures that
 * carry it: the agent's ProbeReport and baseline.json.
 *
 * No probe matches visible text or ARIA labels: the owner may use a Spanish UI and the
 * fake runs `en` and `es`. docs/contract.md gives each item's evidence and last-verified date.
 */
import type { ChMode } from './device-profile.ts';
import { type ComposerRoute, classifyComposerUrl } from './urls.ts';

export const CONTRACT_VERSION = 1;

export type ContractId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9';

export interface ContractItem {
  id: ContractId;
  item: string;
  probe: string;
  /** Who evaluates it. */
  by: 'agent' | 'background';
  /** false = diagnostics only, never drives a decision (C7). */
  decides: boolean;
  /** Stored on every Handoff record by the preflight (C1–C5, C8). */
  preflight: boolean;
}

export const CONTRACT: readonly ContractItem[] = [
  {
    id: 'C1',
    item: 'InstagramUserAgent.is_mobile === true',
    probe:
      'First script[type="application/json"] containing "InstagramUserAgent", then "is_mobile"\\s*:\\s*(true|false); missing = unknown (ua-json.ts)',
    by: 'agent',
    decides: true,
    preflight: true,
  },
  {
    id: 'C2',
    item: 'Logged in',
    probe: 'Final URL is not a login pattern (urls.ts)',
    by: 'background',
    decides: true,
    preflight: true,
  },
  { id: 'C3', item: 'Portrait', probe: 'innerHeight >= innerWidth', by: 'agent', decides: true, preflight: true },
  {
    id: 'C4',
    item: 'Story input',
    probe: 'An input[type=file] whose accept list, split on commas and trimmed, set-equals STORY_ACCEPT',
    by: 'agent',
    decides: true,
    preflight: true,
  },
  {
    id: 'C5',
    item: '/create/story/ reachable directly',
    probe: 'Final URL',
    by: 'background',
    decides: true,
    preflight: true,
  },
  {
    id: 'C6',
    item: 'Composer ready',
    probe: 'A visible <canvas> with CSS area >= 50% of the viewport and backing size > 0',
    by: 'agent',
    decides: true,
    preflight: false,
  },
  {
    id: 'C7',
    item: 'Error toasts',
    probe: 'Diagnostics only (text-dependent)',
    by: 'agent',
    decides: false,
    preflight: false,
  },
  {
    id: 'C8',
    item: 'Canvas geometry',
    probe: 'Backing size, CSS rect, DPR, inner size',
    by: 'agent',
    decides: true,
    preflight: true,
  },
  {
    id: 'C9',
    item: 'Composer left',
    probe: 'URL leaves /create/story, or the C6 canvas is gone for more than 2 s',
    by: 'agent',
    decides: true,
    preflight: false,
  },
];

/** C4: the story input's accept set (research §2 fn 5). */
export const STORY_ACCEPT = ['image/avif', 'image/jpeg', 'image/png'] as const;
/** C6: minimum share of the viewport's CSS area covered by the composer canvas. */
export const C6_MIN_VIEWPORT_AREA = 0.5;
/** C9: how long the C6 canvas may be gone before the composer counts as left. */
export const C9_CANVAS_GONE_MS = 2000;

/** SG4: guarded builds hand off only when the agent sees `<meta name=FAKE_MARKER_META>`. A DOM read, never a network probe. */
export const FAKE_MARKER_META = 'instapost-fake-instagram';

/** C4 set equality: split on commas, trim, ignore empties and order; case-sensitive. */
export function acceptSetEquals(accept: string, expected: readonly string[] = STORY_ACCEPT): boolean {
  const seen = new Set(
    accept
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  );
  return seen.size === new Set(expected).size && expected.every((e) => seen.has(e));
}

/** What the agent reports for `agent/probe` (strategy §3.5). Structural facts only. */
export interface ProbeReport {
  /** SG4 fake marker present. */
  marker: boolean;
  /** C1. */
  isMobile: true | false | 'unknown';
  /** C3/C8: window.innerWidth/innerHeight. */
  inner: { w: number; h: number };
  dpr: number;
  /** C3. */
  portrait: boolean;
  /** navigator.serviceWorker.controller !== null, as seen from the isolated world. */
  swControlled: boolean | 'unknown';
  /**
   * C4: a candidate story input exists, i.e. an input[type=file] whose accept list names only
   * image types (the post input also accepts video, so it never counts). `absent` → INPUT_MISSING.
   * src/agent/probes.ts owns the exact rule (B6).
   */
  storyInput: 'present' | 'absent';
  /** C4: the candidate's accept list set-equals STORY_ACCEPT. `false` with `present` → ACCEPT_DRIFT. */
  acceptOk: boolean;
  /** The accept lists seen, for drift diagnostics. */
  acceptSeen?: string[];
  /** C8: the largest visible canvas, if any. */
  canvas?: { w: number; h: number; css: { x: number; y: number; w: number; h: number } };
  /** document language (html[lang]). */
  lang: string;
}

export type CheckResult = 'pass' | 'fail' | 'unknown';

/**
 * The preflight stored on every Handoff record (§3.9 item 1): C1–C5, C8 and the service-worker
 * state, judged from one probe. The settings page shows the last 20. Structural facts only.
 */
export interface Preflight {
  contractVersion: number;
  /** is_mobile: true → pass, false → fail, missing → unknown. */
  C1: CheckResult;
  /** Logged in: the tab URL is not a login URL (unknown without a URL). */
  C2: CheckResult;
  C3: CheckResult;
  /** A story input whose accept list set-equals STORY_ACCEPT. */
  C4: CheckResult;
  /** /create/story/ was the final URL after the hard reload (route 'direct'). */
  C5: CheckResult;
  C8: { inner: { w: number; h: number }; dpr: number; canvas: ProbeReport['canvas'] | null };
  swControlled: boolean | 'unknown';
}

/**
 * Summarises a probe as C1–C5 and C8 (pure). `route` is C5's final-URL verdict, null if not known.
 * `ready` is the report taken once the composer was ready (C6, §11 AM13): when given, C8 comes
 * from it, because only then does a canvas exist; C1–C5 always come from the deciding `probe`.
 */
export function preflightOf(
  probe: ProbeReport,
  url: string | undefined,
  route: ComposerRoute | null,
  ready: ProbeReport | null = null,
): Preflight {
  const pass = (b: boolean): CheckResult => (b ? 'pass' : 'fail');
  const geo = ready ?? probe;
  return {
    contractVersion: CONTRACT_VERSION,
    C1: probe.isMobile === 'unknown' ? 'unknown' : pass(probe.isMobile),
    C2: url === undefined ? 'unknown' : pass(classifyComposerUrl(url).kind !== 'stop'),
    C3: pass(probe.portrait),
    C4: pass(probe.storyInput === 'present' && probe.acceptOk),
    C5: route === null ? 'unknown' : pass(route === 'direct'),
    C8: {
      inner: { ...geo.inner },
      dpr: geo.dpr,
      canvas: geo.canvas ? { w: geo.canvas.w, h: geo.canvas.h, css: { ...geo.canvas.css } } : null,
    },
    swControlled: probe.swControlled,
  };
}

/**
 * baseline.json (strategy §7.7): structural facts from L4/L5, or the pre-L4 assumptions.
 * Never HTML, cookies, tokens, user IDs or usernames. The fake derives its default knobs
 * from it (U16).
 */
export interface Baseline {
  /** ISO date of the live capture, or "pre-L4" while the values are assumptions. */
  capturedAt: string;
  chromeVersion: string;
  uaProfile: 'android-reduced';
  chMode: ChMode;
  /** C1's key (research §5.1 curl); `unknown` until L2/L4 confirm it logged in. */
  isMobileKeyFound: boolean | 'unknown';
  /** C5 (A8): `unknown` until L4. */
  route: 'direct' | 'homeOnly' | 'unknown';
  /** C4 before + → Story: `unknown` until L4. */
  storyInputBeforeTap: boolean | 'unknown';
  accept: string[];
  /** L6 (A5/R7, AM26): whether the composer accepts an `isTrusted:false` insert. */
  untrustedInsertAccepted: boolean | 'unknown';
  /** L6 (AM26): the event the composer reads the file from. */
  fileEvent: 'change' | 'drop' | 'unknown';
  swControlledAfterHardReload: boolean | 'unknown';
  firstLoadServedBySw: boolean | 'unknown';
  geometry: {
    model: 'viewportDpr' | 'source' | `fixed:${number}x${number}` | `cssFixed:${number}x${number}`;
    insets: [number, number];
    saveExposed: boolean | 'unknown';
  };
}
