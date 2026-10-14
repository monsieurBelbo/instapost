/**
 * IF8/IF9: the page's reports to the fake's server. Every fake control reports whether its click was
 * trusted (/__fake__/control), so a tap outside the autopilot's allow-list, a Retry from script or a second
 * Share shows up as a violation in the per-test invariants; and the page's story-creation telemetry goes
 * to /__fake__/log, as Instagram's PolarisStoryCreationLogger sends its steps (`enter`, `image_process_*`,
 * `compose_*`, with `waterfall_id` and `waterfall_duration`). Both carry a per-document id.
 *
 * AM45 (L21): a control report also carries what a person reads on the control (its text, else its
 * aria-label) and the page's language, and every toast and the rotate snackbar log their text (`toast`,
 * `snackbar`), so E45 can prove the fake rendered every control the autopilot touches in Spanish. The
 * agent never reads any of it.
 */
import { FAKE_PATHS, type FakeControl, type FakeLogInput } from '../protocol.ts';

/** This document's id, so the log can be read per page load. */
export const DOC_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const post = (path: string, body: unknown): void =>
  void fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);

/** What a person reads on a control: its own aria-label, its text, else the first aria-label inside it. */
export function labelOf(target: EventTarget | null | undefined): string {
  if (!target || !(target instanceof Element)) return '';
  const own = target.getAttribute('aria-label') ?? '';
  const text = (target.textContent ?? '').replace(/\s+/g, ' ').trim();
  const inner = target.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '';
  return (own || text || inner).slice(0, 80);
}

/** The page's language (`<html lang>`, the `locale` knob). */
export const pageLang = (): string => document.documentElement.lang.slice(0, 16);

export function reportControl(
  control: FakeControl,
  isTrusted: boolean,
  repeat = false,
  target?: EventTarget | null,
): void {
  post(FAKE_PATHS.control, { control, isTrusted, repeat, doc: DOC_ID, label: labelOf(target), lang: pageLang() });
}

export function logStep(step: string, fields: FakeLogInput['fields'] = {}): void {
  post(FAKE_PATHS.log, { step, doc: DOC_ID, fields });
}
