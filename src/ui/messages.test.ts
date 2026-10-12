/** Hand-off panel texts (strategy §3.10, §11 AM28): what the owner is told, and what is not pre-answered. */
import { describe, expect, test } from 'vitest';
import { ERROR_CODES } from '../core/handoff/state.ts';
import { errorDetail, errorText, fallbackText, PHASE_LABEL, postedPrompt } from './messages.ts';

describe('AM28 hand-off panel texts', () => {
  test('"Posted?" has a primary answer only when detection gave one', () => {
    expect(postedPrompt({ detected: true, unknown: false, answer: null })).toEqual({
      hint: 'It looks like you tapped Share.',
      primary: true,
    });
    expect(postedPrompt({ detected: false, unknown: false, answer: null })).toEqual({
      hint: 'No Share was detected.',
      primary: false,
    });
    // An unknown page after Share, or an unconfirmed insert: neither button primary, no "not detected".
    const unknown = postedPrompt({ detected: false, unknown: true, answer: null });
    expect(unknown.primary).toBeNull();
    expect(unknown.hint).not.toMatch(/No Share was detected/);
    expect(unknown.hint).toMatch(/Share may have been tapped/);
    // The owner's answer always wins.
    expect(postedPrompt({ detected: false, unknown: true, answer: true })).toEqual({
      hint: 'Recorded as posted.',
      primary: true,
    });
  });

  test('after a possible Share the fallback never invites a second post from the phone blindly', () => {
    expect(fallbackText('UNEXPECTED_PAGE', 'a.png')).toMatch(/post it from the phone/);
    const after = fallbackText('UNEXPECTED_PAGE', 'a.png', true);
    expect(after).toMatch(/^Check the story on the phone before posting it again/);
    expect(after).not.toMatch(/post it from the phone/);
  });

  test('an unexpected page is named', () => {
    expect(errorDetail('UNEXPECTED_PAGE', 'page /consent/')).toBe('It went to /consent/.');
    expect(errorDetail('UNEXPECTED_PAGE', undefined)).toBeNull();
    expect(errorDetail('AGENT_UNREACHABLE', 'installRules: quota')).toBeNull();
  });

  test('the branded-browser refusal says what happened, not that a page was opened', () => {
    const text = errorText('BRANDED_BROWSER');
    expect(text).toMatch(/Google Chrome or Microsoft Edge/);
    expect(text).toMatch(/no composer window was opened/);
    expect(text).not.toMatch(/not the fake/);
    expect(errorText('GUARD_NOT_FAKE')).toMatch(/not the fake/);
  });

  test('the 30 s navigation deadline is not reported as 15 minutes of inactivity', () => {
    expect(errorText('NAVIGATION_TIMEOUT')).toMatch(/30 seconds/);
    expect(errorText('NAVIGATION_TIMEOUT')).not.toMatch(/15 minutes/);
    expect(errorText('TIMEOUT')).toMatch(/15 minutes/);
  });

  test('every error code has a text, and finished does not claim the window closed', () => {
    for (const code of ERROR_CODES) expect(errorText(code).length).toBeGreaterThan(10);
    expect(PHASE_LABEL.finished).toBe('Composer left');
  });
});
