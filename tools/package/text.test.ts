/**
 * RS-4, RL-2, RL-3, RL-10, RL-20, RS-9, RS-10: what a shared build's INSTALL.txt and BUILD.txt say, that neither
 * names a path on the owner's Mac, and when a build is too old to package.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LICENSE_FILES } from '../bundle/licenses.ts';
import { buildText, installText, localPathLeaks, sourceLabel, staleInputs, stampOf } from './text.ts';

const REPO = '/Users/someone/Projects/instapost';

describe('RS-4 BUILD.txt names no local path', () => {
  it('the build’s name, else its folder relative to the repo, else only its folder name', () => {
    expect(sourceLabel('live', `${REPO}/.output/chrome-mv3-live`, REPO, true)).toBe('live');
    expect(sourceLabel('x', `${REPO}/.spikes/inpage-build/chrome-mv3-live-spike`, REPO, false)).toBe(
      '.spikes/inpage-build/chrome-mv3-live-spike',
    );
    expect(sourceLabel('x', '/Users/someone/Desktop/build', REPO, false)).toBe('build');
    const text = buildText({
      versionName: '0.1.1 (20261016-1200)',
      describe: 'abc1234-dirty',
      branch: 'feat/inpage',
      label: sourceLabel('live', `${REPO}/.output/x`, REPO, true),
      builtAt: '2026-10-16T12:00:00.000Z',
      packagedAt: '2026-10-16T12:30:00.000Z',
      checked: true,
    });
    expect(text).toBe(
      [
        '0.1.1 (20261016-1200)',
        'commit abc1234-dirty on feat/inpage',
        'source live',
        'built 2026-10-16T12:00:00.000Z',
        'packaged 2026-10-16T12:30:00.000Z',
        'check-bundle passed',
        '',
      ].join('\n'),
    );
    expect(localPathLeaks(text, [REPO, '/Users/someone'])).toEqual([]);
    expect(localPathLeaks(`source ${REPO}/.output`, [REPO, '/Users/someone'])).toEqual([REPO, '/Users/someone']);
  });
});

describe('RS-9 a build older than its sources is not packaged', () => {
  it('a build input newer than the manifest is stale; tests, docs and older files are not', () => {
    const built = 1_000;
    const files = [
      { path: 'src/inpage/driver.ts', mtimeMs: 2_000 },
      { path: 'src/inpage/driver.test.ts', mtimeMs: 2_000 },
      { path: 'src/inpage/page-script.browser.test.ts', mtimeMs: 2_000 },
      { path: 'entrypoints/composer/App.tsx', mtimeMs: 500 },
      { path: 'wxt.config.ts', mtimeMs: 1_500 },
      { path: 'package.json', mtimeMs: 1_200 },
      { path: 'docs/inpage.md', mtimeMs: 9_000 },
      { path: 'tools/package/text.ts', mtimeMs: 9_000 },
    ];
    expect(staleInputs(files, built)).toEqual(['package.json', 'src/inpage/driver.ts', 'wxt.config.ts']);
    expect(staleInputs(files.slice(3, 4), built)).toEqual([]);
  });

  it('the stamp is the given time, local, YYYYMMDD-HHMM', () => {
    expect(stampOf(new Date(2026, 9, 16, 9, 5))).toBe('20261016-0905');
  });
});

describe('INSTALL.txt', () => {
  const text = installText('instapost', '0.1.1 (20261016-1200)', '155');

  it('RL-2: says to reload an Instagram tab that was already open; RL-10: where to set the shortcut', () => {
    expect(text).toContain('reload any Instagram tab\n   that was already open');
    expect(text).toContain('chrome://extensions/shortcuts');
    expect(text).toContain('arc://extensions/shortcuts');
  });

  it('RL-3: names libheif and libde265, their licence (LGPL-3.0, with the GPL text) and their source', () => {
    expect(text).toContain('libheif and libde265 (GNU LGPL version 3)');
    expect(text).toContain(LICENSE_FILES.notice);
    expect(text).toContain(LICENSE_FILES.libheif);
    expect(text).toContain('https://github.com/strukturag/libheif');
    expect(text).toContain('https://github.com/strukturag/libde265');
  });
});

describe('RL-20 / RS-10 INSTALL.txt', () => {
  const text = installText('instapost', '0.1.1 (20261016-1200)', '155');

  it('RL-20: names the browser version the manifest requires and where to update', () => {
    expect(text).toContain('Needs Chrome or Arc 155 or later');
    expect(text).toContain('chrome://settings/help');
    expect(text).toContain('Check for Updates');
    // The number comes from the manifest (wxt.config.ts minimum_chrome_version), so the two cannot drift.
    const wxt = readFileSync(new URL('../../wxt.config.ts', import.meta.url), 'utf8');
    const min = /minimum_chrome_version:\s*'(\d+)'/.exec(wxt)?.[1];
    expect(min).toBe('155');
    expect(installText('instapost', 'x', null)).not.toContain('Needs Chrome');
  });

  it('RS-10: Instagram can detect it; the shared folder is written only by whoever shares it; reload after a sync', () => {
    expect(text).toContain('Instagram can tell that instapost is installed and running');
    expect(text).toContain('view-only');
    expect(text).toContain('anyone who can\n  change its files can run code inside your logged-in Instagram');
    expect(text).toContain('Wait until it has finished syncing');
    expect(text).toContain('Don’t post while an update is still syncing'.replace('’', "'"));
  });

  it('RS-10: Details include the Instagram username; send them only to whoever gave you the build', () => {
    expect(text).toContain('they include your\n  Instagram username');
    expect(text).toContain('and to no one else');
  });
});
