/**
 * RS-11: what a release tag means, which CHANGELOG section becomes its notes, the INSTALL.txt of a public download,
 * and that release-info can run before install.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LICENSE_FILES } from '../bundle/licenses.ts';
import {
  changelogSection,
  installText,
  PAGE_URL,
  releaseInstallText,
  releaseNotes,
  releaseOfTag,
  sectionSummary,
  summaryProblem,
} from './text.ts';

describe('releaseOfTag', () => {
  it('takes v<version> and v<version>-rc.N, and labels them without the v', () => {
    expect(releaseOfTag('v0.2.0', '0.2.0')).toEqual({ label: '0.2.0', prerelease: false });
    expect(releaseOfTag('v0.2.0-rc.1', '0.2.0')).toEqual({ label: '0.2.0-rc.1', prerelease: true });
    expect(releaseOfTag('v0.2.0-rc.12', '0.2.0')).toEqual({ label: '0.2.0-rc.12', prerelease: true });
  });
  it.each([
    'v0.1.1',
    '0.2.0',
    'v0.2',
    'v0.2.0-rc',
    'v0.2.0-rc.0',
    'v0.2.0-rc.01',
    'v0.2.0-beta.1',
    'v0.2.0-rc.1x',
    'v0.2.0.1',
    'v0.2.0\n',
    '',
  ])('refuses %j for package.json 0.2.0', (tag) => {
    expect(releaseOfTag(tag, '0.2.0')).toBeNull();
  });
});

describe('changelogSection', () => {
  const log =
    '# Changelog\n\n## [Unreleased]\n\nNext.\n\n## [0.2.0] - 2026-11-05\n\n### Added\n\n- A.\n\n## [0.1.1] - 2026-10-15\n\n- B.\n';
  it('cuts one section, trimmed', () => {
    expect(changelogSection(log, '0.2.0')).toBe('### Added\n\n- A.');
    expect(changelogSection(log, 'Unreleased')).toBe('Next.');
    expect(changelogSection(log, '0.1.1')).toBe('- B.');
  });
  it('is null when missing or empty', () => {
    expect(changelogSection(log, '9.9.9')).toBeNull();
    expect(changelogSection('## [1.0.0]\n\n## [0.9.0]\n- x\n', '1.0.0')).toBeNull();
  });
});

describe('the changelog contract: a section opens with one plain summary paragraph', () => {
  it('takes the first paragraph, before an optional ES comment', () => {
    expect(sectionSummary('Repost a post.\n\n<!-- es: Algo. -->\n\n### Added\n\n- A.')).toBe('Repost a post.');
    expect(sectionSummary('Two\nlines.\n\n- A.')).toBe('Two\nlines.');
    expect(sectionSummary('It rounds 3 * 2 - 1 to 5.')).toBe('It rounds 3 * 2 - 1 to 5.');
  });
  it.each([
    '### Added\n\n- A.',
    '- A.',
    '<!-- es: Algo. -->\n\nText.',
    '1. A.',
    '> A.',
    '',
    '   ',
    'Repost a post.\n- A.',
    'Repost a post.\n<!-- es: Algo. -->',
    '**Repost** a post.',
    'Repost a post, [see docs](https://x.test).',
    'Run `pnpm` first.',
    '• Videos come later • AM50',
    'Release title\n=====',
    'Release title\n-----',
  ])('finds none in %j', (section) => {
    expect(sectionSummary(section)).toBeNull();
  });
  it('refuses no section, no summary, and the "not released" placeholder', () => {
    expect(summaryProblem(null)).toBe('is empty');
    expect(summaryProblem('### Added\n\n- A.')).toBe('does not open with a summary paragraph');
    expect(summaryProblem('Version 0.2.0 (not released).\n\n### Added')).toBe('still says "not released"');
    expect(summaryProblem('Version 0.2.0 (Not Released yet).')).toBe('still says "not released"');
    expect(summaryProblem('Version 0.2.0 (not\nreleased).')).toBe('still says "not released"');
    expect(summaryProblem('Version 0.2.0 (unreleased).')).toBe('still says "not released"');
    expect(summaryProblem('Repost a post.\n\n### Added\n\n- This is not released yet.')).toBeNull();
  });
  it('refuses a bare @name anywhere in the section: GitHub would link it as a mention of that account', () => {
    for (const bare of [
      '(@handle)',
      '**@handle**',
      '_@handle_',
      '-@handle',
      '.@handle',
      '@Handle',
      'a/@handle',
      '@preact/signals',
    ]) {
      expect(summaryProblem(`Repost a post.\n\n### Added\n\n- With ${bare}.`), bare).toContain('has a bare @');
    }
    expect(summaryProblem('Thanks to @handle.')).toContain('has a bare @handle');
    for (const fine of ['`@handle`', '`@preact/signals`', 'foo@handle.com']) {
      expect(summaryProblem(`Repost a post.\n\n### Added\n\n- With ${fine}.`), fine).toBeNull();
    }
  });
});

describe('releaseNotes', () => {
  const unreleased =
    '# C\n\n## [Unreleased]\n\nRepost.\n\n<!-- es: R. -->\n\n- A.\n\n## [0.1.1] - 2026-10-15\n\nOld.\n';
  const dated =
    '# C\n\n## [Unreleased]\n\n## [0.2.0] - 2026-11-06\n\nRepost.\n\n- A.\n\n## [0.1.1] - 2026-10-15\n\nOld.\n';

  it('a candidate uses [Unreleased], or the version’s own section once there is one', () => {
    expect(releaseNotes(unreleased, '0.2.0', true)).toEqual({ notes: 'Repost.\n\n<!-- es: R. -->\n\n- A.' });
    expect(releaseNotes(dated, '0.2.0', true)).toEqual({ notes: 'Repost.\n\n- A.' });
  });
  it('a stable tag needs its own dated section', () => {
    expect(releaseNotes(dated, '0.2.0', false)).toEqual({ notes: 'Repost.\n\n- A.' });
    const none = { problem: 'CHANGELOG.md has no dated [0.2.0] section (## [0.2.0] - YYYY-MM-DD)' };
    expect(releaseNotes(unreleased, '0.2.0', false)).toEqual(none);
    expect(releaseNotes('## [0.2.0]\n\nRepost.\n', '0.2.0', false)).toEqual(none);
    expect(releaseNotes('## [0.2.0] - soon\n\nRepost.\n', '0.2.0', false)).toEqual(none);
  });
  it('refuses a section without a usable summary, whichever tag', () => {
    expect(releaseNotes('## [Unreleased]\n\n### Added\n\n- A.\n', '0.2.0', true)).toEqual({
      problem: "CHANGELOG.md's [Unreleased] section does not open with a summary paragraph",
    });
    expect(releaseNotes('## [Unreleased]\n\nVersion 0.2.0 (not released).\n', '0.2.0', true)).toEqual({
      problem: 'CHANGELOG.md\'s [Unreleased] section still says "not released"',
    });
    expect(releaseNotes('## [Unreleased]\n\n## [0.1.1] - 2026-10-15\n\nOld.\n', '0.2.0', true)).toEqual({
      problem: "CHANGELOG.md's [Unreleased] section is empty",
    });
    expect(releaseNotes('## [0.2.0] - 2026-11-06\n\n- A.\n', '0.2.0', false)).toEqual({
      problem: "CHANGELOG.md's [0.2.0] section does not open with a summary paragraph",
    });
  });
  it('the repo’s CHANGELOG passes for a candidate of its version', () => {
    const root = new URL('../../', import.meta.url).pathname;
    const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8')) as { version: string };
    const notes = releaseNotes(readFileSync(`${root}CHANGELOG.md`, 'utf8'), version, true);
    expect(notes).toHaveProperty('notes');
  });
});

describe('INSTALL.txt of a release', () => {
  const text = releaseInstallText('instapost', '0.2.0-rc.1', '155');

  it('is written for one person: no shared folder, no one who gave it to you', () => {
    for (const shared of ['iCloud', 'Dropbox', 'whoever', 'shared', 'sync', 'view-only', 'friend']) {
      expect(text).not.toContain(shared);
    }
  });
  it('never sends anyone to a phone or the app', () => {
    expect(text).not.toMatch(/on your phone|to phone|Instagram app/i);
  });
  it('points to the page, the version, and the licence in the folder', () => {
    expect(text.split('\n')[0]).toBe('instapost 0.2.0-rc.1');
    expect(text).toContain(PAGE_URL);
    expect(PAGE_URL).toBe('https://monsieurbelbo.github.io/instapost/');
    expect(text).toContain('see LICENSE in\n  this folder');
  });
  it('keeps the steps, the browser version and the warnings', () => {
    expect(text).toContain('Needs Chrome 155 or later, or Arc on Chromium 155 or later');
    expect(text).toContain('reload any Instagram tab that was\n   already open');
    expect(text).toContain('Load unpacked');
    expect(text).toContain('arc://extensions/shortcuts');
    expect(text).toContain("That is outside\n  Instagram's terms of use");
    expect(text).toContain('Instagram can tell that instapost is installed and running');
    expect(text).toContain('can run code inside your\n  logged-in Instagram');
    expect(text).toContain('Instagram username, the @handle of\n  anyone you reposted');
  });
  it('says Remove wipes what instapost stored, and that nothing updates by itself', () => {
    expect(text).toContain('wipes your settings, drafts, recent photos and history');
    expect(text).toContain('Nothing updates by itself');
  });
  it('says copies saved to Downloads stay after Remove', () => {
    expect(text).toContain('Copies saved to\nDownloads/instapost stay');
    expect(text).not.toContain('deletes everything');
  });
  it('says the phone frame shows during a test too, and how little has been tried', () => {
    expect(text).toContain('during a post or test');
    expect(text).toContain('Tried on real Instagram only in Arc on a Mac');
  });
  it('comes after the steps, so its warnings aren’t called the first thing to read', () => {
    expect(text).toContain('BEFORE YOU USE IT');
    expect(text).not.toContain('READ THIS FIRST');
    expect(text).toContain('Option (Alt)+Shift+S');
  });
  it('says the page’s install steps the page’s way', () => {
    expect(text).toContain('in a normal window, not Incognito, logged in to a\n   secondary account');
    expect(text).toContain("click instapost's icon in the extensions menu");
    expect(text).toContain('If you\n   move it, repeat step 4.');
    expect(text).toContain('"Developer mode" (top right). Leave it on.');
    expect(text).toContain('press "Run setup test" and stay on that tab.');
    expect(text).toContain('After that, "Post story" posts.');
    expect(text).toContain('keep it where only you\n  can change it.');
  });
  it('both variants name the bundled libraries and where their licences are', () => {
    for (const t of [text, installText('instapost', 'x', null)]) {
      expect(t).toContain('Preact');
      expect(t).toContain('idb (ISC)');
      expect(t).toContain(LICENSE_FILES.notice);
      expect(t).toContain('libheif and libde265 (GNU LGPL version 3)');
    }
  });
});

describe('scripts/release-info.ts runs before install', () => {
  it('imports only node built-ins and .ts files, all the way down', () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const m of readFileSync(file, 'utf8').matchAll(/^(?:import|export)\b[^;'"]*from '([^']+)'/gm)) {
        const spec = m[1] ?? '';
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('.') && spec.endsWith('.ts')) walk(resolve(dirname(file), spec));
        else bad.push(`${file}: ${spec}`);
      }
    };
    walk(new URL('../../scripts/release-info.ts', import.meta.url).pathname);
    expect(seen.size).toBeGreaterThan(3);
    expect(bad).toEqual([]);
  });
});
