import { beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { setLangSetting } from '../../src/ui/i18n.ts';

beforeEach(() => {
  fakeBrowser.reset();
  // AM44: the editor's copy in English whatever the machine's language (Auto would follow it); i18n.test.ts
  // and the `es` cases switch explicitly.
  setLangSetting('en');
});
