/**
 * Background service worker: the hand-off orchestrator (strategy §3.1). The pure reducer
 * (src/core/handoff/reducer.ts) decides; the runner (src/handoff/runner.ts) executes its
 * effects and keeps the state in storage.session, so a stopped worker resumes mid-flow.
 *
 * Every listener is registered synchronously in this first turn (src/handoff/background-main.ts).
 */
import { defineBackground } from 'wxt/utils/define-background';
import { startBackground } from '../src/handoff/background-main.ts';
import { GUARDED, MODE } from '../src/shared/env.ts';

export default defineBackground(() => {
  console.info(`[instapost] background: mode=${MODE} guarded=${GUARDED}`);
  startBackground();
});
