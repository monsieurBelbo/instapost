/**
 * U31 (strategy §11 AM45, AM46, live checklist L21; docs/contract.md § "Instagram in Spanish"): the autopilot
 * works whatever language Instagram's UI is in, because nothing that decides reads Instagram's visible text,
 * an ARIA label, an alt text, a title or the page's language. This scans the agent's sources and the
 * background's decision code (since AM46 the in-page lane's too: its driver, frame watch, entry anchor)
 * for the DOM APIs that would read them; the known reads are listed with why they are language-free. A new
 * text read fails here and needs an entry in contract.md first.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url).pathname;

/** The DOM reads that would make a finder depend on Instagram's language. */
const TEXT_READS: readonly { label: string; re: RegExp }[] = [
  { label: 'textContent', re: /\.textContent\b/ },
  { label: 'innerText', re: /\.innerText\b/ },
  { label: 'innerHTML/outerHTML', re: /\.(?:inner|outer)HTML\b/ },
  { label: 'aria-* attribute', re: /aria-(?!hidden)[a-z]+/ },
  { label: 'aria* property', re: /\.aria[A-Z]\w*/ },
  { label: 'alt', re: /\.alt\b|\[alt[\]=~^$*|]|getAttribute\(\s*['"`]alt['"`]/ },
  { label: 'title', re: /\.title\b|\[title[\]=~^$*|]|getAttribute\(\s*['"`]title['"`]/ },
  { label: 'lang', re: /\.lang\b|\[lang[\]=~^$*|]|getAttribute\(\s*['"`]lang['"`]/ },
  { label: 'placeholder/label', re: /\.placeholder\b|\.labels\b|getAttribute\(\s*['"`](?:placeholder|label)['"`]/ },
  { label: 'text selector', re: /:has-text|:contains\(|innerText|XPath|evaluate\(/ },
];

/** The known reads, each language-free (file, the line's code, why). */
const ALLOWED: readonly { file: string; line: RegExp; why: string }[] = [
  {
    file: 'src/agent/probes.ts',
    line: /const text = script\.textContent \?\? '';/,
    why: 'C1: the JSON of a script[type=application/json] holding InstagramUserAgent (a data blob, not UI text)',
  },
  {
    file: 'src/agent/probes.ts',
    line: /lang: \(doc\.documentElement\.lang \|\| ''\)\.slice/,
    why: 'diagnostics: the probe records <html lang> (en, es) on the record; nothing reads it to decide',
  },
  {
    file: 'src/handoff/local-state.ts',
    line: /lang: UI_LANG_SETTINGS\.includes\(s\.lang as UiLangSetting\)/,
    why: 'the extension’s own language setting (storage.local settings.lang, AM44), not Instagram’s page',
  },
  {
    file: 'src/inpage/background.ts',
    line: /lang: resolveLang\(settings\?\.lang \?\? 'auto', browserLanguage\(\)\)/,
    why: 'the in-page entry’s language: the extension’s own setting for the content script (AM48), not Instagram’s page',
  },
];

/** Source files (no tests, no browser-test helpers) under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('.browser-helper'))
    .map((f) => `${dir}/${f}`);
}

/** Code lines only: comment lines and JSDoc are prose about the rule, not reads. */
function codeLines(file: string): { n: number; code: string }[] {
  return readFileSync(join(ROOT, file), 'utf8')
    .split('\n')
    .map((code, i) => ({ n: i + 1, code }))
    .filter(({ code }) => !/^\s*(?:\/\/|\/\*|\*)/.test(code));
}

describe('U31 the autopilot reads no text (Instagram in any language, L21)', () => {
  const files = [
    ...sources('src/agent'),
    ...sources('src/core/handoff'),
    ...sources('src/core/ig-contract'),
    ...sources('src/handoff'),
    // AM46: the in-page lane decides the same way (its driver, the frame's kill switch, the entry's anchor).
    ...sources('src/core/inpage'),
    'src/inpage/driver.ts',
    'src/inpage/frame-watch.ts',
    'src/inpage/anchor.ts',
    'src/inpage/background.ts',
  ];

  it('scans the agent and the decision code', () => {
    for (const f of ['src/agent/locators.ts', 'src/agent/tap.ts', 'src/agent/drive.ts', 'src/agent/net.ts']) {
      expect(files).toContain(f);
    }
    expect(files).toContain('src/core/handoff/reducer.ts');
    expect(files).toContain('src/core/ig-contract/account.ts');
    expect(files).toContain('src/core/inpage/frame-verdict.ts');
  });

  it('no visible text, ARIA label, alt, title or language is read, except the listed language-free reads', () => {
    const hits: string[] = [];
    const used = new Set<(typeof ALLOWED)[number]>();
    for (const file of files) {
      for (const { n, code } of codeLines(file)) {
        for (const p of TEXT_READS) {
          if (!p.re.test(code)) continue;
          const ok = ALLOWED.find((a) => a.file === file && a.line.test(code));
          if (ok) used.add(ok);
          else hits.push(`${file}:${n} ${p.label}: ${code.trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
    // Every allowance is still needed (a stale one would hide a new read on the same line).
    expect([...used].map((a) => a.why).sort()).toEqual(ALLOWED.map((a) => a.why).sort());
  });

  it('the scan catches what it is meant to', () => {
    const caught = (code: string) => TEXT_READS.filter((p) => p.re.test(code)).map((p) => p.label);
    expect(caught("el.getAttribute('aria-label')")).toContain('aria-* attribute');
    expect(caught('btn.textContent === "Share"')).toContain('textContent');
    expect(caught('a.ariaLabel')).toContain('aria* property');
    expect(caught("img.getAttribute('alt')")).toContain('alt');
    expect(caught('document.documentElement.lang')).toContain('lang');
    expect(caught("querySelector('[title=Share]')")).toContain('title');
    expect(caught('el.innerText')).toContain('innerText');
    expect(caught("svg.querySelector('[aria-hidden]')")).toEqual([]);
    expect(caught('el.matches(\'button, [role="button"]\')')).toEqual([]);
  });
});
