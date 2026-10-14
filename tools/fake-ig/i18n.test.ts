/**
 * AM45 (L21): the fake's `locale=es` renders every visible string in Spanish, so a locale=es run proves the
 * autopilot reads no text. Every es string is (unverified): see client/i18n.ts.
 */
import { describe, expect, it } from 'vitest';
import { STRINGS } from './client/i18n.ts';

describe('the fake in Spanish', () => {
  it('has every English string, and translates all but Instagram’s own product names', () => {
    const keys = Object.keys(STRINGS.en).sort();
    expect(Object.keys(STRINGS.es).sort()).toEqual(keys);
    const same = keys.filter(
      (k) => STRINGS.es[k as keyof typeof STRINGS.es] === STRINGS.en[k as keyof typeof STRINGS.en],
    );
    expect(same).toEqual(['menuReel', 'navReels']);
    for (const k of keys) expect(STRINGS.es[k as keyof typeof STRINGS.es].trim(), k).not.toBe('');
  });

  it('the controls the autopilot touches and the texts it sees around them differ from English', () => {
    // The + link's aria-label (Instagram's Home string), the menu, the Share footer, the toasts, the snackbar.
    for (const k of [
      'navHome',
      'menuStory',
      'menuPost',
      'share',
      'shareStory',
      'toastUploadFailed',
      'retry',
      'toastAdded',
      'toastAddedFacebook',
      'toastRotate',
      'uploading',
      'fbBadge',
    ] as const) {
      expect(STRINGS.es[k], k).not.toBe(STRINGS.en[k]);
    }
  });
});
