/** The kill switch's log lines (strategy §3.6, §11 AM20, AM28): what the background's console says. */
import { describe, expect, it } from 'vitest';
import { type HandoffState, IDLE } from '../core/handoff/state.ts';
import { COMPOSER_URL } from '../core/ig-contract/urls.ts';
import { describeVerdict, killSwitchVerdict } from './kill-switch.ts';

const at = (phase: 'navigating' | 'awaitingPick'): HandoffState => ({ phase }) as unknown as HandoffState;
const CONSENT = 'https://www.instagram.com/consent/?flow=x#y';

describe('kill switch log lines', () => {
  it('names the path of an unexpected page (query and fragment dropped), armed or not yet armed', () => {
    for (const phase of ['awaitingPick', 'navigating'] as const) {
      expect(describeVerdict(killSwitchVerdict(at(phase), CONSENT), CONSENT)).toBe(
        'kill switch: unexpected Instagram page /consent/ (UNEXPECTED_PAGE), no lock',
      );
    }
  });

  it('says nothing for the composer, for hidden URLs before arming, and when idle', () => {
    expect(describeVerdict(killSwitchVerdict(at('navigating'), COMPOSER_URL), COMPOSER_URL)).toBeNull();
    expect(killSwitchVerdict(at('navigating'), undefined)).toBeNull();
    expect(killSwitchVerdict(at('navigating'), 'about:blank')).toBeNull();
    expect(killSwitchVerdict(IDLE, CONSENT)).toBeNull();
    expect(describeVerdict(killSwitchVerdict(at('awaitingPick'), undefined))).toBe(
      'kill switch: kill (KILLED_OFFHOST), msite lane locked',
    );
  });
});
