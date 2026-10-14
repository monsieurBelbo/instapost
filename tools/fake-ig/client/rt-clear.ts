/**
 * IF7: Instagram clears its own resource-timing buffer (`performance.clearResourceTimings()`), so the
 * agent's outcome observer can never poll the timeline; it must observe entries as they come
 * (PerformanceObserver). `rtClear=on` (default) clears every RT_CLEAR_MS and whenever an image loads.
 */
import { RT_CLEAR_MS } from '../protocol.ts';

export function clearTimings(): void {
  try {
    performance.clearResourceTimings();
  } catch {
    // Not available: nothing to clear.
  }
}

/** Starts the periodic clearing; returns the stop function. */
export function startClearing(): () => void {
  const id = window.setInterval(clearTimings, RT_CLEAR_MS);
  return () => window.clearInterval(id);
}
