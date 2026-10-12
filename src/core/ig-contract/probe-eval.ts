/**
 * Probe → decision (strategy §3.6 step 7, §11 AM2). Pure. The rows are evaluated in the
 * table's order and no row retries; the single landscape refit is granted by the caller
 * through `refitUsed`. The hand-off reducer adds what depends on session history (one inject
 * per hand-off, re-probes never upgrading H0 to H1).
 *
 * | Row | Condition                                                | Decision                  |
 * |-----|----------------------------------------------------------|---------------------------|
 * | 1   | guarded build and !marker                                | fail GUARD_NOT_FAKE       |
 * | 2   | live build and marker                                    | banner, continue          |
 * | 3   | URL matches login                                        | fail NOT_LOGGED_IN        |
 * | 4   | isMobile === false (re-probe: !== true), or swControlled | fail DESKTOP_SHELL        |
 * | 5   | not portrait                                             | refit once, else LANDSCAPE|
 * | 6   | mode 'probe'                                             | probe-done (never injects)|
 * | 7   | H1 disabled / input absent / accept drift                | H0 (reason null / code)   |
 * | 8   | otherwise                                                | H1                        |
 */
import type { ProbeReport } from './contract.ts';
import { classifyComposerUrl } from './urls.ts';

export type ProbeFailCode = 'GUARD_NOT_FAKE' | 'NOT_LOGGED_IN' | 'DESKTOP_SHELL' | 'LANDSCAPE';
/** Why H0 replaced H1 (§3.10 "degrade to H0"). null: H1 is simply disabled. */
export type H0Reason = 'INPUT_MISSING' | 'ACCEPT_DRIFT';

export type ProbeDecision =
  | { kind: 'fail'; code: ProbeFailCode }
  /** Not portrait and the refit is still unused: refit the window once and probe again. */
  | { kind: 'refit' }
  /** mode 'probe': store the report, close, done. */
  | { kind: 'probe-done' }
  | { kind: 'h0'; reason: H0Reason | null }
  | { kind: 'h1' };

export interface ProbeEvalInput {
  probe: ProbeReport;
  /** MODE !== 'live'. */
  guarded: boolean;
  mode: 'post' | 'probe';
  /** H1 is enabled for this hand-off (settings snapshot, and a file exists to insert). */
  assistedInsert: boolean;
  /** The composer tab's current URL (tab.url); undefined skips row 3. */
  url: string | undefined;
  /** The single landscape refit was already used. */
  refitUsed: boolean;
  /** AM2: a re-probe after a later document load. isMobile must then be exactly true. */
  strict: boolean;
}

export interface ProbeEvaluation {
  decision: ProbeDecision;
  /** Row 2: live build on the fake. Show "FAKE INSTAGRAM" and carry on. */
  banner: boolean;
}

/**
 * Row 4. The first probe after the hard reload fails only on an explicit `is_mobile:false`
 * (§3.6); a re-probe after any later document load (AM2) also fails on 'unknown'.
 * `swControlled: 'unknown'` never fails.
 */
export function isDesktopShell(probe: ProbeReport, strict: boolean): boolean {
  const notMobile = strict ? probe.isMobile !== true : probe.isMobile === false;
  return notMobile || probe.swControlled === true;
}

export function evaluateProbe(input: ProbeEvalInput): ProbeEvaluation {
  const { probe } = input;
  if (input.guarded && !probe.marker) return { decision: { kind: 'fail', code: 'GUARD_NOT_FAKE' }, banner: false };
  const banner = !input.guarded && probe.marker;
  const out = (decision: ProbeDecision): ProbeEvaluation => ({ decision, banner });

  if (input.url !== undefined && classifyComposerUrl(input.url).kind === 'stop') {
    return out({ kind: 'fail', code: 'NOT_LOGGED_IN' });
  }
  if (isDesktopShell(probe, input.strict)) return out({ kind: 'fail', code: 'DESKTOP_SHELL' });
  if (!probe.portrait) return out(input.refitUsed ? { kind: 'fail', code: 'LANDSCAPE' } : { kind: 'refit' });
  if (input.mode === 'probe') return out({ kind: 'probe-done' });
  if (!input.assistedInsert) return out({ kind: 'h0', reason: null });
  if (probe.storyInput === 'absent') return out({ kind: 'h0', reason: 'INPUT_MISSING' });
  if (!probe.acceptOk) return out({ kind: 'h0', reason: 'ACCEPT_DRIFT' });
  return out({ kind: 'h1' });
}
