/**
 * The insert (strategy §3.8, §11 AM3; ux.md §10): the export becomes a File, is assigned to the story
 * input that Instagram's Story item armed through DataTransfer, and the input gets bubbling, composed
 * `input` then `change` events. `change` comes last: it is what fires React's onChange (spike S7). These
 * are the only events the agent dispatches; its only taps are tap.ts's.
 */
import { b64ToBytes } from '../shared/b64.ts';
import type { AgentWindow } from './probes.ts';

export interface FilePayload {
  name: string;
  mime: string;
  b64: string;
}

/** The File the composer receives, built in the agent window's realm. Throws on bad base64. */
export function fileFromPayload(win: AgentWindow, p: FilePayload): File {
  return new win.File([b64ToBytes(p.b64)], p.name, { type: p.mime });
}

/** Assigns `file` to `input` and dispatches `input`, then `change` (bubbling, composed). */
export function setInputFile(win: AgentWindow, input: HTMLInputElement, file: File): void {
  const dt = new win.DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new win.Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new win.Event('change', { bubbles: true, composed: true }));
}
