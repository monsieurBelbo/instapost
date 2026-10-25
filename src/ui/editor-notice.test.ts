/**
 * FX14 (RL-2): the editor shows the background's "reload your Instagram tab" notice once, then removes it.
 */
import { describe, expect, it, vi } from 'vitest';
import { session } from '../platform/storage.ts';
import { followEditorNotice } from './editor-notice.ts';
import { notice, setNotice } from './editor-state.ts';

describe('FX14 the editor’s reload notice', () => {
  it('shown once from storage.session, at start or when the background leaves it later', async () => {
    setNotice(null);
    await session.set('editorNotice', 'reloadInstagram');
    const stop = followEditorNotice();
    await vi.waitFor(() =>
      expect(notice.value).toMatchObject({
        kind: 'info',
        text: 'instapost was updated. Reload your Instagram tab to post from it.',
      }),
    );
    expect(await session.get('editorNotice')).toBeUndefined();
    setNotice(null);
    await session.set('editorNotice', 'reloadInstagram');
    await vi.waitFor(() => expect(notice.value?.code).toBe('RELOAD_INSTAGRAM'));
    await vi.waitFor(async () => expect(await session.get('editorNotice')).toBeUndefined());
    stop();
  });
});
