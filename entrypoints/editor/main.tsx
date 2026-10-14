import { render } from 'preact';
import '../../src/ui/editor.css';
import { loadImageFile, setNotice } from '../../src/ui/editor-state.ts';
import { t } from '../../src/ui/i18n.ts';
import { isTyping } from '../../src/ui/shortcuts.ts';
import { dropping } from '../../src/ui/ui-state.ts';
import { App } from './App.tsx';

const root = document.getElementById('app');
if (!root) throw new Error('editor: #app missing');

const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;

// ux.md §4.3: dropping a photo works anywhere in the window (and never navigates the tab away).
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  dropping.value = true;
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropping.value = false;
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dropping.value = false;
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/') || f.type === '');
  const first = files[0] ?? e.dataTransfer?.files[0];
  if (!first) return;
  void loadImageFile(first).then(() => {
    if ((e.dataTransfer?.files.length ?? 0) > 1) setNotice({ kind: 'info', text: t('notice.onePhoto') });
  });
});

// ⌘V outside a text field takes the first image on the clipboard.
window.addEventListener('paste', (e) => {
  if (isTyping(e.target)) return;
  const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (!file) return;
  e.preventDefault();
  void loadImageFile(file);
});

render(<App />, root);
