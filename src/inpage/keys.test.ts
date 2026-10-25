/**
 * RL-10: the composer's own shortcuts are labelled for the owner's platform (the handler reads ⌘ or Ctrl).
 */
import { describe, expect, it } from 'vitest';
import { combo, keyOs } from './keys.ts';

describe('RL-10 platform key labels', () => {
  it('macOS by userAgentData, else navigator.platform; anything else is not a Mac', () => {
    expect(keyOs({ userAgentData: { platform: 'macOS' } })).toBe('mac');
    expect(keyOs({ platform: 'MacIntel' })).toBe('mac');
    expect(keyOs({ userAgentData: { platform: 'Windows' }, platform: 'Win32' })).toBe('other');
    expect(keyOs({ platform: 'Linux x86_64' })).toBe('other');
    expect(keyOs({})).toBe('other');
  });

  it('Mac glyphs on a Mac, Ctrl+… elsewhere', () => {
    expect(['post', 'test', 'choose', 'paste'].map((c) => combo(c as 'post', 'mac'))).toEqual([
      '⌘↵',
      '⌥⌘↵',
      '⌘O',
      '⌘V',
    ]);
    expect(['post', 'test', 'choose', 'paste'].map((c) => combo(c as 'post', 'other'))).toEqual([
      'Ctrl+Enter',
      'Ctrl+Alt+Enter',
      'Ctrl+O',
      'Ctrl+V',
    ]);
  });
});
