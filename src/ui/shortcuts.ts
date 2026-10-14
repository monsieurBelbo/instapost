/**
 * Keyboard shortcuts (ux.md §4.14, IU11). One window keydown handler. Single-key shortcuts are inactive
 * while a text field has focus; ⌘↵ and Esc work everywhere. Slice-2 keys (undo, Fill/Fit, rotate 90°, the
 * Instagram view, peek) are not wired yet.
 */
export const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: '⌥⇧S', action: 'Open or focus instapost (from anywhere)' },
  { keys: '⌘↵', action: 'The Post card’s primary button' },
  { keys: '⌥⌘↵', action: 'Test run' },
  { keys: 'Esc', action: 'Stop (before Share); else close a sheet or text editing' },
  { keys: '⌘O · ⌘V', action: 'Choose photo · paste photo' },
  { keys: 'T', action: 'Edit text' },
  { keys: '0', action: 'Reset placement' },
  { keys: '= · −', action: 'Zoom in · out about the centre' },
  { keys: 'Arrows (⇧: 10 px)', action: 'Nudge (with the photo focused)' },
  { keys: 'N', action: 'New story (after a result)' },
  { keys: 'H · ,', action: 'History · Settings' },
  { keys: '?', action: 'This sheet' },
];

export interface ShortcutHandlers {
  primary(): void;
  testRun(): void;
  escape(): boolean;
  choosePhoto(): void;
  editText(): void;
  reset(): void;
  zoom(factor: number): void;
  newStory(): boolean;
  history(): void;
  settings(): void;
  help(): void;
}

/** Whether a key event comes from a field where typing goes (single keys are off there). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color'].includes(type);
  }
  return el.isContentEditable === true;
}

/** Maps a keydown to a handler; returns whether it was handled (the caller then prevents the default). */
export function handleKey(e: KeyboardEvent, h: ShortcutHandlers): boolean {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 'Enter') {
    if (e.altKey) h.testRun();
    else h.primary();
    return true;
  }
  if (e.key === 'Escape') return h.escape();
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') {
    h.choosePhoto();
    return true;
  }
  if (mod || e.altKey || isTyping(e.target)) return false;
  switch (e.key) {
    case 't':
    case 'T':
      h.editText();
      return true;
    case '0':
      h.reset();
      return true;
    case '=':
    case '+':
      h.zoom(1.1);
      return true;
    case '-':
    case '−':
      h.zoom(1 / 1.1);
      return true;
    case 'n':
    case 'N':
      return h.newStory();
    case 'h':
    case 'H':
      h.history();
      return true;
    case ',':
      h.settings();
      return true;
    case '?':
      h.help();
      return true;
    default:
      return false;
  }
}
