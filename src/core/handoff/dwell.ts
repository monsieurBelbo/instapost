/**
 * The human-pace dwell (ux.md §2 "Human pace", OD14): after readiness, a jittered pause before each of
 * the background's commands, so the run keeps a person's rhythm and the owner can follow it. Pure; the
 * randomness is the reducer context's (`ctx.random`). The agent adds its own 0.4–0.9 s between + and the
 * Story item (src/agent/drive.ts).
 */

export const DWELL_MS = {
  /** Before + → Story. */
  entry: [700, 1500],
  /** Before the photo goes into the armed story input. */
  insert: [1500, 3000],
  /** Before Share (at least 2 s). */
  share: [2000, 3000],
} as const satisfies Record<string, readonly [number, number]>;

export type DwellKind = keyof typeof DWELL_MS;

/**
 * A dwell in [min, max] ms from `random()` in [0, 1). `scale` is a guarded build's E2E hook
 * (`__e2eDwellScale`, 0 = no dwell); a live build passes undefined.
 */
export function dwellMs(kind: DwellKind, random: () => number, scale?: number): number {
  const [min, max] = DWELL_MS[kind];
  const r = random();
  const unit = Number.isFinite(r) ? Math.min(Math.max(r, 0), 1) : 0.5;
  const ms = Math.round(min + (max - min) * unit);
  if (typeof scale === 'number' && Number.isFinite(scale) && scale >= 0 && scale < 1) return Math.round(ms * scale);
  return ms;
}
