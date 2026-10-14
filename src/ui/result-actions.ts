/**
 * What the result and refusal buttons do (ux.md §4.7, §5). Kept apart from the components so the Post card,
 * the result card and History share one mapping.
 */
import { signal } from '@preact/signals';
import type { HandoffMode } from '../core/handoff/state.ts';
import { checkConnection, postStory, saveCopy, sendToPhone, shareTest, testRun } from './actions.ts';
import type { ActionId } from './copy.ts';
import { dismissResult, finishByHand, markOutcome, openInstagram } from './run-state.ts';
import { openOverlay } from './ui-state.ts';

/** The pause banner's Resume… is expanded (a result's "Resume…" opens it). */
export const resumeOpen = signal(false);
/** A request to open the file picker (the import surface owns the input). */
export const choosePhotoRequest = signal(0);

export interface ActionContext {
  mode: HandoffMode;
  handoffId: string | null;
  handle: string | null;
  diagnostics?: () => string;
}

/** Runs a result or refusal action. */
export function runAction(id: ActionId, c: ActionContext): void {
  switch (id) {
    case 'sendToPhone':
      void sendToPhone();
      return;
    case 'saveCopy':
      void saveCopy();
      return;
    case 'tryAgain':
      dismissResult();
      if (c.mode === 'test') void testRun();
      else if (c.mode === 'shareTest') void shareTest();
      else if (c.mode === 'check') checkConnection();
      else void postStory();
      return;
    case 'finishByHand':
    case 'shareItMyself':
      finishByHand();
      return;
    case 'openInstagram':
      openInstagram('home');
      return;
    case 'checkStory':
      if (c.handle) openInstagram('story', c.handle);
      else openInstagram('home');
      return;
    case 'copyDiagnostics':
      if (c.diagnostics) void navigator.clipboard.writeText(c.diagnostics()).catch(() => undefined);
      return;
    case 'showRun':
      document.querySelector('[data-testid="run-view"]')?.scrollIntoView({ block: 'start' });
      return;
    case 'resume':
      resumeOpen.value = true;
      return;
    case 'settings':
      openOverlay('settings');
      return;
    case 'choosePhoto':
      choosePhotoRequest.value++;
      return;
    case 'reload':
      location.reload();
      return;
    case 'markPosted':
      if (c.handoffId) markOutcome(c.handoffId, true);
      return;
    case 'markNotPosted':
      if (c.handoffId) markOutcome(c.handoffId, false);
      return;
  }
}
