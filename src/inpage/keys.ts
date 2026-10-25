/**
 * RL-10: the composer's own keyboard shortcuts as the owner's platform spells them. The composer reads either
 * modifier (⌘ or Ctrl, App.tsx), so only the label changes: Mac glyphs on macOS, `Ctrl+…` elsewhere. The
 * toolbar shortcut is the browser's own (chrome.commands, src/platform/commands.ts), not one of these.
 */

export type KeyOs = 'mac' | 'other';

/** macOS by the browser's own platform report (userAgentData, else navigator.platform). */
export function keyOs(
  nav: { userAgentData?: { platform?: string }; platform?: string } | undefined = globalThis.navigator as
    | { userAgentData?: { platform?: string }; platform?: string }
    | undefined,
): KeyOs {
  const p = nav?.userAgentData?.platform ?? nav?.platform ?? '';
  return /mac/i.test(p) ? 'mac' : 'other';
}

const COMBOS = {
  post: { mac: '⌘↵', other: 'Ctrl+Enter' },
  test: { mac: '⌥⌘↵', other: 'Ctrl+Alt+Enter' },
  choose: { mac: '⌘O', other: 'Ctrl+O' },
  paste: { mac: '⌘V', other: 'Ctrl+V' },
} as const;
export type Combo = keyof typeof COMBOS;

/** A composer shortcut's label for the platform. */
export function combo(name: Combo, os: KeyOs = keyOs()): string {
  return COMBOS[name][os];
}
