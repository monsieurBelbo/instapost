/**
 * FID-2: every fake control reports whether its click was trusted, so an extension that clicked
 * anything in the page (+, Story, Post, Close, Save, Home) shows up as an UNTRUSTED_CONTROL violation
 * in the per-test invariants, as an untrusted Share already does (SG6).
 */
import { FAKE_PATHS, type FakeControl } from '../protocol.ts';

export function reportControl(control: FakeControl, isTrusted: boolean): void {
  void fetch(FAKE_PATHS.control, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ control, isTrusted }),
    keepalive: true,
  }).catch(() => undefined);
}
