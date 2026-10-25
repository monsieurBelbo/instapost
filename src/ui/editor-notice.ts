/**
 * FX14 (RL-2): the notice the background leaves for the editor tab when the toolbar was pressed on an Instagram
 * tab that has no content script (the extension was updated and re-injecting failed): "instapost was updated.
 * Reload your Instagram tab to post from it." Shown once, from storage.session, whether the editor tab is new
 * or was already open; then removed.
 */
import { browser } from 'wxt/browser';
import { session } from '../platform/storage.ts';
import { setNotice } from './editor-state.ts';
import { t } from './i18n.ts';

async function take(): Promise<void> {
  const n = await session.get('editorNotice');
  if (n !== 'reloadInstagram') return;
  await session.remove('editorNotice');
  setNotice({ kind: 'info', text: t('notice.reloadInstagram'), code: 'RELOAD_INSTAGRAM' });
}

/** Shows the notice if there is one now, and whenever the background leaves one; returns the unsubscribe. */
export function followEditorNotice(): () => void {
  void take().catch(() => undefined);
  const onChanged = (changes: Record<string, unknown>, area: string) => {
    if (area === 'session' && 'editorNotice' in changes) void take().catch(() => undefined);
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
