/**
 * IF8/IF9: the page's reports to the fake's server. Every fake control reports whether its click was
 * trusted (/__fake__/control), so a tap outside the autopilot's allow-list, a Retry from script or a second
 * Share shows up as a violation in the per-test invariants; and the page's story-creation telemetry goes
 * to /__fake__/log, as Instagram's PolarisStoryCreationLogger sends its steps (`enter`, `image_process_*`,
 * `compose_*`, with `waterfall_id` and `waterfall_duration`). Both carry a per-document id.
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

export function reportControl(control: FakeControl, isTrusted: boolean, repeat = false): void {
  post(FAKE_PATHS.control, { control, isTrusted, repeat, doc: DOC_ID });
}

export function logStep(step: string, fields: FakeLogInput['fields'] = {}): void {
  post(FAKE_PATHS.log, { step, doc: DOC_ID, fields });
}
