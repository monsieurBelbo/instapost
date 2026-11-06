/**
 * The pages: what a release puts on them, what they must never carry, how much they say, and the whole build as the Site
 * job runs it. The looks are checked by hand on a real build (widths, dark, no JS), not here.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterAll, describe, expect, it } from 'vitest';
import { EN as UI_EN } from '../../src/ui/catalog.en.ts';
import { ES as UI_ES } from '../../src/ui/catalog.es.ts';
import { EN } from './copy.en.ts';
import { ES } from './copy.es.ts';
import { esc, formatSize, type Release, renderDetails, renderNotFound, renderPage, type Site } from './page.ts';
import {
  baseUrlOf,
  checkSha256Line,
  labelOfTag,
  latestJson,
  outDirOf,
  parseRelease,
  sha256File,
  sha256Sums,
  summaryOf,
} from './release.ts';

const REPO = resolve(import.meta.dirname, '../..');
const CSP =
  "default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'";
const SITE: Site = {
  baseUrl: 'https://monsieurbelbo.github.io/instapost/',
  repo: 'https://github.com/monsieurBelbo/instapost',
};
const SHA = 'ab12'.repeat(16);
const RELEASE: Release = {
  label: '0.2.0',
  prerelease: false,
  date: '2026-11-05T12:00:00.000Z',
  sizeBytes: 865_121,
  sha256: SHA,
  summary: { en: 'Repost a photo post.', es: 'Añade una publicación.' },
};
const RC: Release = { ...RELEASE, label: '0.2.0-rc.1', prerelease: true };
/** The first release's own summaries, the longest so far: the word limits have to hold with these on the page. */
const REAL_SUMMARY: Release = {
  ...RC,
  summary: {
    en: 'Repost a photo post, or a story that mentions you, as a picture in your story. Discard story clears the story so you can start again.',
    es: 'Añade a tu historia, como imagen, una publicación con foto o una historia que te menciona. Descartar historia quita la historia para que empieces de nuevo.',
  },
};

/** Every page, in every state a build can leave it. */
const STATES: readonly [string, Release | null][] = [
  ['stable', RELEASE],
  ['prerelease', RC],
  ['no summary', { ...RELEASE, summary: null }],
  ['no release', null],
];
const everyPage = (): [string, string][] => [
  ...STATES.flatMap(([state, r]): [string, string][] => [
    [`en, ${state}`, renderPage(EN, r, SITE)],
    [`es, ${state}`, renderPage(ES, r, SITE)],
    [`en details, ${state}`, renderDetails(EN, r, SITE)],
    [`es details, ${state}`, renderDetails(ES, r, SITE)],
  ]),
  ['404', renderNotFound(EN, ES, SITE)],
];

/** What fetches something as the page loads: link, script, img, source. Links to go to and head metadata don't. */
function loadedRefs(html: string): string[] {
  const refs: string[] = [];
  for (const [tag = ''] of html.matchAll(/<(?:link|script|img|source|iframe|embed|object|audio|video)\b[^>]*>/g)) {
    if (/\brel="(?:canonical|alternate)"/.test(tag)) continue;
    for (const m of tag.matchAll(/\b(?:src|href|srcset)="([^"]*)"/g)) refs.push(m[1] ?? '');
  }
  return refs;
}

const anchors = (html: string): string[] => [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1] ?? '');

/** A page's body as read: tags gone, the dot that draws a full stop still a full stop. */
const bodyText = (html: string): string =>
  html
    .slice(html.indexOf('<body'), html.indexOf('</body>'))
    .replace(/<b class="stop">\.<\/b>/g, '.')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The words anyone can read: all of the body, so the footer, the wells, the Copy buttons and the touch-only note count,
 * though no one screen shows all of them. A word has a letter or a digit, so ↻ and © aren't words. The big step numbers
 * come from CSS and aren't in the HTML. So this is innerText on a touch phone, plus what a width hides: instagram.com.
 */
const visibleWords = (html: string): string[] =>
  bodyText(html)
    .split(' ')
    .filter((w) => /[\p{L}\p{N}]/u.test(w));

/** Calls `visit` on every string of a copy, with its path. */
function strings(value: unknown, visit: (text: string, path: string) => void, path = ''): void {
  if (typeof value === 'string') visit(value, path);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, visit, `${path}.${k}`);
  }
}

/** The same keys, array lengths and types, as paths. */
function shape(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return [`${path}[${value.length}]`, ...value.flatMap((v, i) => shape(v, `${path}[${i}]`))];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => shape(v, `${path}.${k}`));
  }
  return [`${path}: ${typeof value}`];
}

const said = (s: { items: readonly string[] }): string => s.items.join(' ');

describe('a release on the page', () => {
  it('shows its version and size, and links the stable name under the versioned one', () => {
    const html = renderPage(EN, RELEASE, SITE);
    expect(html).toContain('<span class="dl-what">Download 0.2.0</span>');
    expect(html).toContain('href="downloads/instapost-latest.zip" download="instapost-0.2.0.zip"');
    expect(html).toContain('<span class="dl-meta">0.9 MB. Photos only.</span>');
    expect(html).toContain('<code>instapost-0.2.0.zip</code>');
    expect(html).not.toContain(SHA);
  });

  it('the details page has what’s new, the SHA and the line that checks it', () => {
    const html = renderDetails(EN, RELEASE, SITE);
    expect(html).toContain(`<code class="sha">${SHA}</code>`);
    expect(html).toContain('<code>shasum -a 256 instapost-0.2.0.zip</code>');
    expect(html).toContain('<strong>New in 0.2.0.</strong> <span>Repost a photo post.</span>');
    expect(html).toContain(`href="${SITE.repo}/releases/tag/v0.2.0"`);
    expect(html).not.toContain('download=');
  });

  it('in Spanish it reads the same from one folder down', () => {
    const html = renderPage(ES, RELEASE, SITE);
    expect(html).toContain('<span class="dl-what">Descargar 0.2.0</span>');
    expect(html).toContain('href="../downloads/instapost-latest.zip" download="instapost-0.2.0.zip"');
    expect(html).toContain('<span class="dl-meta">0.9 MB. Solo fotos.</span>');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<nav class="lang"><a href="../"');
    for (const ref of loadedRefs(html)) expect(ref).toMatch(/^\.\.\//);
    expect(renderDetails(ES, RELEASE, SITE)).toContain('<span>Añade una publicación.</span>');
  });

  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)('%s gives where it has run as a real list of its four tiers', (_, c) => {
    const html = renderDetails(c, RELEASE, SITE);
    const list = html.split(`<h2>${c.details.tried.title}</h2>`)[1]?.split('</ul>')[0] ?? '';
    expect(list.match(/<li><b>/g)).toHaveLength(4);
    expect(list).not.toContain('<br>');
  });

  it('links stay inside the site’s folder, however deep the page', () => {
    const html = renderPage(EN, RELEASE, SITE);
    expect(html).toContain('<nav class="lang"><a href="es/"');
    for (const ref of loadedRefs(html)) expect(ref).toMatch(/^(?:assets\/|style\.css|copy\.js)/);
    for (const ref of loadedRefs(renderDetails(EN, RELEASE, SITE))) expect(ref).toMatch(/^\.\.\/(?!\.\.)/);
    for (const ref of loadedRefs(renderDetails(ES, RELEASE, SITE))) expect(ref).toMatch(/^\.\.\/\.\.\/(?!\.\.)/);
  });

  it('escapes everything a release carries', () => {
    const nasty = '<img src=x onerror=alert(1)>&"';
    const escaped = '&lt;img src=x onerror=alert(1)&gt;&amp;&quot;';
    const r: Release = { ...RELEASE, label: nasty, sha256: nasty, summary: { en: nasty, es: nasty } };
    for (const html of [renderPage(EN, r, SITE), renderPage(ES, r, SITE)]) {
      expect(html).not.toContain('<img src=x');
      expect(html).toContain(`download="instapost-${escaped}.zip"`);
    }
    for (const html of [renderDetails(EN, r, SITE), renderDetails(ES, r, SITE)]) {
      expect(html).not.toContain('<img src=x');
      expect(html).toContain(`<code class="sha">${escaped}</code>`);
      expect(html).toContain(`<code>shasum -a 256 instapost-${escaped}.zip</code>`);
    }
    const dollars = renderPage(EN, { ...RELEASE, label: "$&$'$`" }, SITE);
    expect(dollars).toContain("Download $&amp;$'$`<");
  });

  it('a Spanish page with no Spanish summary shows the English one, marked as English', () => {
    const html = renderDetails(ES, { ...RELEASE, summary: { en: 'Repost a photo post.', es: null } }, SITE);
    expect(html).toContain('<span lang="en">Repost a photo post.</span>');
  });

  it('a prerelease says so, and only a prerelease', () => {
    expect(renderPage(EN, RC, SITE)).toContain('0.9 MB. Photos only. Preview release.');
    expect(renderPage(ES, RC, SITE)).toContain('0.9 MB. Solo fotos. Versión preliminar.');
    expect(renderPage(EN, RC, SITE)).toContain('Download 0.2.0-rc.1');
    expect(renderPage(EN, RELEASE, SITE)).not.toContain(EN.prerelease);
    expect(renderPage(ES, RELEASE, SITE)).not.toContain(ES.prerelease);
  });

  it('a release with no usable summary keeps its download and SHA and has no What’s new', () => {
    for (const c of [EN, ES]) {
      const r = { ...RELEASE, summary: null };
      expect(renderPage(c, r, SITE)).toContain('download="instapost-0.2.0.zip"');
      const html = renderDetails(c, r, SITE);
      expect(html).toContain(`<code class="sha">${SHA}</code>`);
      expect(html).toContain(`>${c.details.allChanges}</a>`);
      expect(html).not.toContain(c.details.newIn.replace('{v}', '0.2.0'));
    }
    expect(renderDetails(EN, RELEASE, SITE)).toContain('New in 0.2.0.');
  });

  it('formats sizes in decimal MB', () => {
    expect(formatSize(865_121)).toBe('0.9 MB');
    expect(formatSize(12_340_000)).toBe('12.3 MB');
  });

  it('esc covers text and double-quoted attributes', () => {
    expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

describe('with no release', () => {
  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)('%s is both whole pages, with no download, version, What’s new or SHA', (_, c) => {
    const main = renderPage(c, null, SITE);
    const details = renderDetails(c, null, SITE);
    expect(main).toContain(`<p class="dl is-off">${c.noRelease}</p>`);
    for (const html of [main, details]) {
      for (const gone of ['<a class="dl"', 'downloads/', 'download=', 'class="sha"', 'SHA-256', 'shasum']) {
        expect(html).not.toContain(gone);
      }
      expect(html).not.toMatch(/\d+\.\d+\.\d+/);
      expect(html).toContain('<footer class="foot');
    }
    expect(details).not.toContain(c.details.versionHead);
    expect(details).toContain(`<a href="${SITE.repo}">${c.source}</a>`);
    for (const part of ['class="hero', 'class="reel"', 'class="install"', 'class="limits"']) {
      expect(main).toContain(part);
    }
    for (const section of [c.details.limits, c.details.risk, c.details.data, c.details.pictures]) {
      expect(details).toContain(`<h2>${section.title}</h2>`);
    }
  });
});

describe('every page, in every state', () => {
  it.each(everyPage())('%s has no leftover token', (_, html) => {
    expect(html).not.toMatch(/\{[a-z]+\}/);
  });

  it.each(everyPage())('%s loads nothing from outside, and has no inline style or script', (_, html) => {
    const refs = loadedRefs(html);
    expect(refs.length).toBeGreaterThan(1);
    for (const ref of refs) expect(ref).not.toMatch(/^(?:[a-z]+:|\/\/)/i);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/<style\b/);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(html).not.toMatch(/<[^>]+\son[a-z]+=/);
  });

  it.each(everyPage())('%s has the one CSP, the no-referrer policy and no live link to chrome:', (_, html) => {
    const csp = [...html.matchAll(/http-equiv="Content-Security-Policy" content="([^"]*)"/g)].map((m) => m[1]);
    expect(csp).toEqual([CSP]);
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).not.toMatch(/href="(?:chrome|arc):/);
  });

  it.each(everyPage())('%s says nothing it must not', (_, html) => {
    expect(banned(html)).toEqual([]);
  });

  it.each(everyPage())('%s has one h1, and every picture has its alt', (_, html) => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    for (const [img = ''] of html.matchAll(/<img\b[^>]*>/g)) expect(img).toMatch(/\salt="[^"]+"/);
  });

  it('links out only to the repo; absolute URLs are for head metadata', () => {
    for (const [, html] of everyPage()) {
      const body = html.slice(html.indexOf('<body'));
      for (const href of anchors(body)) if (/^[a-z]+:/i.test(href)) expect(href.startsWith(SITE.repo)).toBe(true);
      expect(body.replace(/https:\/\/github\.com\/monsieurBelbo\/instapost[^"]*/g, '')).not.toMatch(/https?:\/\//);
    }
  });
});

describe('how much it says', () => {
  it.each([
    ['en', 180, EN],
    ['es', 200, ES],
  ] as const)('the %s main page is at most %i words: a brand, not a document', (_, most, c) => {
    for (const r of [RELEASE, RC, REAL_SUMMARY, null]) {
      expect(visibleWords(renderPage(c, r, SITE)).length).toBeLessThanOrEqual(most);
    }
  });

  it.each([
    ['en', 500, EN],
    ['es', 560, ES],
  ] as const)('the %s details page is at most %i words, with the longest summary so far', (_, most, c) => {
    for (const r of [RELEASE, RC, REAL_SUMMARY, null]) {
      expect(visibleWords(renderDetails(c, r, SITE)).length).toBeLessThanOrEqual(most);
    }
  });

  it('the count counts what a person reads', () => {
    const html = '<body><p>Phone down<b class="stop">.</b></p><p><a href="x">Story</a> ↻ © 2026&nbsp;up</p></body>';
    expect(visibleWords(html)).toEqual(['Phone', 'down.', 'Story', '2026', 'up']);
    expect(visibleWords(renderPage(EN, RC, SITE))).toEqual(expect.arrayContaining(['manifest.json', 'Copy']));
    expect(visibleWords(renderPage(EN, RC, SITE))).toContain(EN.phone.split(' ')[0]);
  });

  it.each([
    ['en', EN, ['Phone down. Story up.', 'Post the photo. Skip the doomscroll.', 'Install it by hand.']],
    ['es', ES, ['Deja el teléfono. Sube tu historia.', 'Publica la foto. Sin doomscroll.', 'Instálala a mano.']],
  ] as const)('%s keeps its lines, and the owner’s word, whole when read', (_, c, wanted) => {
    const text = bodyText(renderPage(c, RC, SITE)).replace(/ \./g, '.');
    for (const line of wanted) expect(text).toContain(line);
    for (const line of [c.sub, c.kind, c.phone, c.risk, c.caption, c.posting, c.repost, c.line, c.detailsLink]) {
      expect(text).toContain(line);
    }
    expect(text).not.toContain('Drawn, except');
  });
});

describe('what a screen reader meets', () => {
  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)('%s: every step has its text before its well, so Copy never comes before the instruction', (_, c) => {
    const steps = renderPage(c, RELEASE, SITE).split('<li class="step">').slice(1);
    expect(steps).toHaveLength(5);
    for (const step of steps) {
      expect(step.indexOf('<p>')).toBeGreaterThanOrEqual(0);
      expect(step.indexOf('<p>')).toBeLessThan(step.indexOf('class="well'));
    }
  });

  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)('%s: the folder to pick is read out with manifest.json; only the button’s label stays hidden', (_, c) => {
    const step4 = renderPage(c, RELEASE, SITE).split('<li class="step">')[4];
    expect(step4).toContain('<div class="well load"><span class="chip" aria-hidden="true">');
    expect(step4).toContain('<code>manifest.json</code>');
  });

  it('a big full stop drawn as a dot is still a real full stop', () => {
    expect(renderPage(EN, RC, SITE)).toContain('<span class="l">up<b class="stop">.</b></span>');
    expect(renderPage(ES, RC, SITE)).toContain('<span lang="en">doomscroll</span><b class="stop">.</b>');
    expect(renderDetails(EN, RC, SITE)).toContain('<h1>Details<b class="stop">.</b></h1>');
    expect(renderNotFound(EN, ES, SITE)).toContain('<h1>Page not found<b class="stop">.</b></h1>');
  });
});

describe('the four pages', () => {
  const PAGES = [
    { render: renderPage, c: EN, path: '', other: 'es/', root: '' },
    { render: renderPage, c: ES, path: 'es/', other: '../', root: '../' },
    { render: renderDetails, c: EN, path: 'details/', other: '../es/details/', root: '../' },
    { render: renderDetails, c: ES, path: 'es/details/', other: '../../details/', root: '../../' },
  ] as const;

  it.each(PAGES)('$path has its canonical, hreflang for its pair, and a language link to the same page', (p) => {
    const html = p.render(p.c, RC, SITE);
    const en = `${SITE.baseUrl}${p.path.replace('es/', '')}`;
    const es = `${SITE.baseUrl}es/${p.path.replace('es/', '')}`;
    expect(html).toContain(`<html lang="${p.c.lang}">`);
    expect(html).toContain(`<link rel="canonical" href="${SITE.baseUrl}${p.path}">`);
    expect(html).toContain(`<meta property="og:url" content="${SITE.baseUrl}${p.path}">`);
    expect(html).toContain(`<link rel="alternate" hreflang="en" href="${en}">`);
    expect(html).toContain(`<link rel="alternate" hreflang="es" href="${es}">`);
    expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${en}">`);
    expect(html).toContain(`<nav class="lang"><a href="${p.other}"`);
    expect(new URL(p.other, SITE.baseUrl + p.path).href).toBe(p.c.lang === 'en' ? es : en);
  });

  it('the main pages link to their details, and the details back', () => {
    for (const c of [EN, ES]) {
      expect(renderPage(c, RC, SITE)).toContain(`<a class="more" href="details/">${c.detailsLink}</a>`);
      expect(renderDetails(c, RC, SITE)).toContain('<a class="foot-brand" href="../">');
    }
  });

  it('only the main pages load copy.js: the details page has nothing to copy', () => {
    for (const c of [EN, ES]) {
      expect(renderPage(c, RC, SITE)).toContain('copy.js');
      expect(renderDetails(c, RC, SITE)).not.toContain('copy.js');
      expect(renderDetails(c, RC, SITE)).not.toContain('<button');
    }
  });

  it('the pictures are one stage for both themes, and the Golden hour one per language', () => {
    expect(renderPage(EN, RC, SITE)).toContain('src="assets/stage-posted-en.webp"');
    expect(renderPage(ES, RC, SITE)).toContain('src="../assets/stage-posted-es.webp"');
    for (const c of [EN, ES]) expect(renderPage(c, RC, SITE)).toContain('assets/stage-repost.webp');
    expect(renderPage(EN, RC, SITE)).not.toMatch(/stage-[a-z-]*dark/);
  });

  it('the details page’s footer has every link and notice; the main one says only who', () => {
    for (const c of [EN, ES]) {
      const html = renderDetails(c, RC, SITE);
      for (const href of ['', '/blob/main/CHANGELOG.md', '/releases', '/issues', '/blob/main/LICENSE']) {
        expect(html).toContain(`<a href="${SITE.repo}${href}">`);
      }
      const f = c.details.foot;
      for (const words of [f.asIs, f.affiliation, f.hosting]) expect(html).toContain(words);
      expect(html).toMatch(/<a href="(?:\.\.\/)+assets\/OFL\.txt">/);
      expect(renderPage(c, RC, SITE)).toContain(`<p class="legal">${c.legal}</p>`);
    }
  });
});

describe('the head', () => {
  const head = (c: typeof EN, r: Release | null): string => renderPage(c, r, SITE).split('</head>')[0] ?? '';

  it('says who it is, in both languages, with absolute URLs', () => {
    const en = head(EN, RELEASE);
    expect(en).toContain(`<title>${EN.title}</title>`);
    expect(en).toContain('<meta property="og:locale" content="en_US">');
    expect(en).toContain(`<meta property="og:image" content="${SITE.baseUrl}assets/og-en.png">`);
    const es = head(ES, RELEASE);
    expect(es).toContain('<meta property="og:locale" content="es_LA">');
    expect(es).toContain(`<meta property="og:image" content="${SITE.baseUrl}assets/og-es.png">`);
    for (const h of [en, es]) {
      expect(h).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(h).toContain('<meta name="color-scheme" content="light dark">');
      expect(h).toContain('media="(prefers-color-scheme: light)" content="#efefef"');
      expect(h).toContain('media="(prefers-color-scheme: dark)" content="#161616"');
      expect(h).toContain('as="font" type="font/woff2" crossorigin');
      expect(h).toContain('<meta property="og:image:width" content="1200">');
    }
    expect(renderDetails(EN, RELEASE, SITE)).toContain(`<title>${EN.details.title}</title>`);
    expect(renderDetails(ES, RELEASE, SITE)).toContain(`<title>${ES.details.title}</title>`);
  });

  it('never carries a version, so a stale share card can’t lie', () => {
    expect(head(EN, RELEASE)).not.toContain('0.2.0');
    expect(head(ES, RC)).not.toContain('0.2.0');
    expect(renderDetails(EN, RC, SITE).split('</head>')[0]).not.toContain('0.2.0');
  });
});

describe('the 404', () => {
  const paths = (html: string): string[] => [...loadedRefs(html), ...anchors(html)];

  it('links absolutely from BASE_URL’s path, since Pages serves it at any depth', () => {
    const list = paths(renderNotFound(EN, ES, SITE));
    expect(list).toContain('/instapost/');
    expect(list).toContain('/instapost/es/');
    expect(list).toContain('/instapost/style.css');
    for (const p of list) expect(p).toMatch(/^\/instapost\//);
  });

  it('follows the site to a domain’s root', () => {
    for (const p of paths(renderNotFound(EN, ES, { ...SITE, baseUrl: 'https://example.test/' }))) {
      expect(p).toMatch(/^\/(?!instapost)/);
    }
  });

  it('is one bilingual page, out of the index', () => {
    const html = renderNotFound(EN, ES, SITE);
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).toContain(EN.notFound.head);
    expect(html).toContain(EN.notFound.body);
    expect(html).toContain(`<p lang="es">${ES.notFound.head} ${ES.notFound.body}`);
  });
});

describe('the copy', () => {
  it('English and Spanish have the same shape', () => {
    expect(shape(ES)).toEqual(shape(EN));
  });

  it('every string has the same inline tags and tokens in both languages', () => {
    const marks = (s: string): string[] =>
      s.replace(/<span lang="en">|<\/span>/g, '').match(/<[^>]+>|\{[a-z]+\}/g) ?? [];
    const es = new Map<string, string>();
    strings(ES, (text, path) => es.set(path, text));
    let compared = 0;
    strings(EN, (text, path) => {
      expect(marks(es.get(path) ?? ''), path).toEqual(marks(text));
      compared += 1;
    });
    expect(compared).toBeGreaterThan(80);
  });

  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)('%s keeps the card’s risk sentence as the first thing under Risk', (_, c) => {
    expect(c.details.risk.items[0]).toBe(c.risk);
  });

  it.each([
    ['en', EN, 'button (every page)'],
    ['es', ES, 'botón (cada página)'],
  ] as const)('%s says Instagram’s code can see the button on every page, not only during a post', (_, c, seen) => {
    expect(c.details.risk.items[1]).toContain(seen);
  });

  it.each([
    ['en', EN, 'Only during a post or test'],
    ['es', ES, 'Solo durante una publicación o prueba'],
  ] as const)(
    '%s says the forged requests and phone frame apply to a test as well as a post, then end',
    (_, c, both) => {
      expect(c.details.risk.items[2]).toContain(both);
      expect(c.details.risk.items[2]).toMatch(/Android/);
    },
  );

  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)('%s names every header it changes, on one line', (_, c) => {
    for (const header of [
      'X-Frame-Options',
      'Sec-Fetch-Dest',
      'User-Agent',
      'Sec-CH-UA-Mobile',
      'Sec-CH-UA-Platform',
    ]) {
      expect(c.details.risk.items[3]).toContain(`<code>${header}</code>`);
    }
    expect(c.details.risk.items[3]).toContain('client hints');
  });

  it.each([
    ['en', EN, 'secondary'],
    ['es', ES, 'secundaria'],
  ] as const)('%s says secondary wherever it gives the live record, and on the card', (_, c, account) => {
    expect(c.line).toContain(account);
    expect(c.risk).toContain(account);
    expect(c.details.tried.items[0]).toContain(account);
  });

  it.each([
    ['en', EN, 'not Incognito', 'in the left sidebar'],
    ['es', ES, 'no incógnito', 'en la barra lateral izquierda'],
  ] as const)('%s says where New story appears, and that it never does in Incognito', (_, c, normal, sidebar) => {
    expect(said(c.details.limits)).toContain(normal);
    expect(c.steps[4]).toContain(sidebar);
  });

  it.each([
    ['en', EN, 'Downloads/instapost'],
    ['es', ES, 'Descargas/instapost'],
  ] as const)('%s says saved copies outlive Remove', (_, c, folder) => {
    expect(said(c.details.updating)).toContain(folder);
    expect(said(c.details.data)).toContain(folder);
  });

  it.each([
    ['en', EN, 'except reposts'],
    ['es', ES, 'salvo republicaciones'],
  ] as const)('%s doesn’t say a failed repost saves itself', (_, c, except) => {
    expect(said(c.details.data)).toContain(except);
  });

  it.each([
    ['en', EN, 'No server, no analytics'],
    ['es', ES, 'Sin servidor ni analíticas'],
  ] as const)('%s says it has no server of its own', (_, c, words) => {
    expect(said(c.details.data)).toContain(words);
  });

  it('Spanish marks the English button word it quotes', () => {
    expect(ES.steps[3]).toContain('<span lang="en">Load</span>');
  });

  it.each([
    ['en', EN, UI_EN, 'While the page stays open'],
    ['es', ES, UI_ES, 'Mientras la página siga abierta'],
  ] as const)('%s says a copy is saved only while the page stays open, as Settings does', (_, c, ui, open) => {
    expect(said(c.details.data)).toContain(open);
    expect(ui['inpage.settings.keepCopiesHelp']).toContain(open);
  });

  it.each([
    ['en', EN, '@handles', 'Read before pasting', 'clipboard only'],
    ['es', ES, '@usuarios', 'Léelo antes de pegarlo', 'solo portapapeles'],
  ] as const)('%s says what Copy diagnostics holds, since the page links to public issues', (_, c, ...words) => {
    for (const word of words) expect(said(c.details.data)).toContain(word);
  });

  it.each([
    [
      'en',
      EN,
      'Read and change your data',
      'Manage your downloads',
      'Block content on any page',
      'request watching',
      'DM text',
    ],
    [
      'es',
      ES,
      'Leer y modificar tus datos',
      'Administrar tus descargas',
      'Bloquear contenido en cualquier página',
      'observar solicitudes',
      'mensajes directos',
    ],
  ] as const)('%s owns up to what the browser calls it and what it reads, DMs included', (_, c, ...words) => {
    for (const word of words) expect(said(c.details.permissions)).toContain(word);
  });

  it.each([
    ['en', EN, 'Add to story', 'Photo', 'English/Spanish', 'Extensions menu'],
    ['es', ES, 'Añadir a tu historia', 'foto', 'inglés/español', 'Menú de extensiones'],
  ] as const)(
    '%s says where a repost starts, which mentions qualify, and where New story’s stand-in is',
    (_, c, add, photo, langs, menu) => {
      expect(said(c.details.reposts)).toContain(add);
      for (const word of [photo, langs]) expect(c.details.reposts.items[1]).toContain(word);
      expect(said(c.details.limits)).toContain(menu);
    },
  );

  it('the line on where to get the folder links to the page that has it', () => {
    for (const c of [EN, ES]) expect(c.details.risk.items[6]).toContain('<a href="../">');
  });

  it('Spanish doesn’t read as tried on Spanish Instagram: “other languages” there means other than Spanish', () => {
    expect(ES.details.tried.items[2]).toContain('español, otros idiomas');
  });

  it('the image hosts are the browser’s words, untranslated', () => {
    for (const c of [EN, ES]) expect(said(c.details.permissions)).toContain('*.cdninstagram.com, *.fna.fbcdn.net');
  });

  it.each([
    ['en', EN, UI_EN, '7 days', 'on your phone'],
    ['es', ES, UI_ES, '7 días', 'en tu teléfono'],
  ] as const)('%s says what the pause asks of you, as the extension does', (_, c, ui, days, phone) => {
    for (const words of [days, phone]) {
      expect(said(c.details.risk)).toContain(words);
      expect(ui['inpage.pause.body']).toContain(words);
    }
  });

  it.each([
    ['en', EN, UI_EN, '60 seconds', '6 an hour', '15 a day', 'failures count', 'No retries'],
    ['es', ES, UI_ES, '60 segundos', '6 por hora', '15 al día', 'las fallidas cuentan', 'Sin reintentos'],
  ] as const)('%s gives the pace and uses the product’s own labels', (_, c, ui, ...words) => {
    const limits = said(c.details.limits);
    for (const word of words) expect(limits).toContain(word);
    expect(limits).toContain(ui['inpage.post.firstButton']);
    expect(limits).toContain(ui['step.couldntConfirm']);
  });

  it.each([
    ['en', EN, 'stand-in', 'made-up accounts', 'drawn'],
    ['es', ES, 'réplica local', 'cuentas inventadas', 'dibujado'],
  ] as const)('%s owns up to how the pictures were made', (_, c, ...words) => {
    for (const word of words) expect(said(c.details.pictures)).toContain(word);
  });

  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)('%s avoids every claim it must not make', (_, c) => {
    const found: string[] = [];
    strings(c, (text, path) => {
      for (const word of banned(text)) found.push(`${path}: ${word}`);
    });
    expect(found).toEqual([]);
  });

  it('the banned list itself bites', () => {
    for (const text of [
      'perfectly safe',
      'Safe to use',
      'undetectable',
      'Instagram-approved',
      'any Chromium browser',
      'One-click install',
      'Send to phone',
      'finish on phone',
      'finish it on your phone',
      'video coming soon',
      'Videos coming',
      'a—b',
      'nice 🎉',
      'totalmente seguro',
      'Enviar al teléfono',
      'Chrome or Arc 155',
      'solo Arc 155',
      'Remove deletes everything instapost stored',
      'Quitar borra todo lo que instapost guardó',
      'Reloading it ends the post as Couldn’t confirm',
      'Si la cierras, termina en No se pudo confirmar',
      'I made this',
      'sends nothing to me',
      'Nada de esto me llega',
    ]) {
      expect(banned(text), text).not.toEqual([]);
    }
    expect(banned('© 2026 ↻ 1080 × 1920 «Instagram» a security check')).toEqual([]);
    expect(banned('Chrome 155, or Arc on Chromium 155; only Arc (Chromium 155)')).toEqual([]);
  });
});

function banned(text: string): string[] {
  const rules: [string, RegExp][] = [
    ['safe', /\bsafe\b/i],
    ['undetectable', /undetectable|indetectable/i],
    ['approved', /\bapproved\b|\baprobad[oa]\b/i],
    ['any Chromium', /any chromium|cualquier chromium/i],
    ['one-click', /one[- ]click|un solo clic/i],
    ['to phone', /send to (?:your )?phone|enviar al? (?:tu )?tel[eé]fono/i],
    ['on phone', /finish (?:it )?on (?:your )?phone|termina[r]? en (?:el|tu) tel[eé]fono/i],
    ['video coming', /videos? (?:is |are )?coming|videos? come later|video próximamente/i],
    ['em dash', /—/],
    ['emoji', /(?![©®])\p{Extended_Pictographic}|️/u],
    ['seguro', /\bsegur[oa]\b/i],
    // Arc numbers itself 1.x; 155 is its Chromium.
    ['Arc version', /\bArc \d/],
    // Copies in Downloads/instapost stay.
    ['removes everything', /deletes everything|borra todo lo/i],
    // After Share nothing cancels: the story can still go live with the tab closed.
    ['closing cancels', /ends the post|termina en no se pudo/i],
    // The page speaks for the product, not as a person.
    ['first person', /\bI\b|\b(?:me|my|mine)\b/],
  ];
  return rules.filter(([, re]) => re.test(text)).map(([name]) => name);
}

describe('summaryOf: the changelog contract', () => {
  const BODY =
    'Repost a photo post, as a picture.\n\n<!-- es: Añade una publicación, como imagen. -->\n\n### Added\n\n- Videos come later (AM50).\n';

  it('takes the opening paragraph in English and the comment right after it in Spanish', () => {
    expect(summaryOf(BODY, 'en')).toBe('Repost a photo post, as a picture.');
    expect(summaryOf(BODY, 'es')).toBe('Añade una publicación, como imagen.');
  });

  it('joins wrapped lines and takes CRLF, as a body edited on GitHub has', () => {
    const body = 'Two\nlines.\n\n<!-- es: Dos\n  líneas. -->\n\n- A.';
    expect(summaryOf(body, 'en')).toBe('Two lines.');
    expect(summaryOf(body, 'es')).toBe('Dos líneas.');
    expect(summaryOf(body.replaceAll('\n', '\r\n'), 'en')).toBe('Two lines.');
    expect(summaryOf(body.replaceAll('\n', '\r\n'), 'es')).toBe('Dos líneas.');
  });

  it('with no Spanish it is null, so the page shows the English', () => {
    expect(summaryOf('Repost a post.\n\n### Added\n\n- A.', 'en')).toBe('Repost a post.');
    expect(summaryOf('Repost a post.\n\n### Added\n\n- A.', 'es')).toBeNull();
    expect(summaryOf('Repost a post.', 'es')).toBeNull();
    expect(summaryOf('Repost a post.\n\n<!-- es: -->\n\n- A.', 'es')).toBeNull();
    expect(summaryOf('Repost a post.\n\n<!-- es: never closed\n\n- A.', 'es')).toBeNull();
    expect(summaryOf('Repost a post.\n\n<!-- fr: Non. -->', 'es')).toBeNull();
    expect(summaryOf('Repost a post.\n\n- A.\n\n<!-- es: Too late. -->', 'es')).toBeNull();
  });

  it.each([
    ['nothing', ''],
    ['bullets', '- Videos come later.\n- AM50.'],
    ['a heading', '### Added\n\n- A.'],
    ['a comment', '<!-- es: Algo. -->\n\nText.'],
    ['a summary running into bullets', 'Repost a post.\n- Videos come later.'],
    ['a summary running into its comment', 'Repost a post.\n<!-- es: Algo. -->'],
    ['the placeholder', 'Version 0.2.0 (not released).\n\n<!-- es: Algo. -->\n\n- A.'],
    ['the placeholder, wrapped', 'Version 0.2.0 (not\nreleased).\n\n- A.'],
    ['another placeholder', 'Version 0.2.0 (unreleased).\n\n- A.'],
    ['bold', '**Repost** a post.'],
    ['a link', 'Repost a post, [see docs](https://x.test).'],
    ['code', 'Run `pnpm` first.'],
    ['typed bullets', '• Videos come later • AM50'],
    ['a heading in underlines', 'Release title\n====='],
  ])('refuses %s, in both languages', (_, body) => {
    expect(summaryOf(body, 'en')).toBeNull();
    expect(summaryOf(body, 'es')).toBeNull();
  });
});

describe('summaryOf: Spanish with marks', () => {
  it('falls back to the English, as the page would print the marks', () => {
    const body = 'Repost a post.\n\n<!-- es: **Añade** una. -->\n\n- A.';
    expect(summaryOf(body, 'en')).toBe('Repost a post.');
    expect(summaryOf(body, 'es')).toBeNull();
  });
});

describe('release data', () => {
  const zip = { sizeBytes: 865_121, sha256: SHA };
  const gh = (over: object = {}): string =>
    JSON.stringify({
      tagName: 'v0.2.0-rc.1',
      isPrerelease: true,
      publishedAt: '2026-11-05T12:00:00Z',
      body: 'Repost.\n\n<!-- es: Añade. -->\n\n- A.',
      ...over,
    });

  it('parses what gh prints, with the zip as measured', () => {
    expect(parseRelease(gh(), 'v0.2.0-rc.1', zip)).toEqual({
      label: '0.2.0-rc.1',
      prerelease: true,
      date: '2026-11-05T12:00:00.000Z',
      sizeBytes: 865_121,
      sha256: SHA,
      summary: { en: 'Repost.', es: 'Añade.' },
    });
  });

  it('a body with no usable summary is no summary, not a failed deploy', () => {
    expect(parseRelease(gh({ body: '- A.' }), 'v0.2.0-rc.1', zip).summary).toBeNull();
    expect(parseRelease(gh({ body: null }), 'v0.2.0-rc.1', zip).summary).toBeNull();
    expect(parseRelease(gh({ body: 'Repost.' }), 'v0.2.0-rc.1', zip).summary).toEqual({ en: 'Repost.', es: null });
  });

  it.each([
    ['another tag', gh({ tagName: 'v0.1.1' }), /is for v0\.1\.1/],
    ['no prerelease flag', gh({ isPrerelease: undefined }), /isPrerelease/],
    ['no date', gh({ publishedAt: null }), /publishedAt/],
    ['a bad date', gh({ publishedAt: 'soon' }), /publishedAt/],
    ['not JSON', 'nope', /JSON/],
  ])('throws on %s', (_, json, message) => {
    expect(() => parseRelease(json, 'v0.2.0-rc.1', zip)).toThrow(message);
  });

  it('takes release tags of any version, and nothing else', () => {
    expect(labelOfTag('v0.2.0')).toBe('0.2.0');
    expect(labelOfTag('v10.20.30-rc.12')).toBe('10.20.30-rc.12');
    for (const tag of ['', '0.2.0', 'v0.2', 'v0.2.0-beta.1', 'v0.2.0-rc.0', 'v../../etc/passwd', 'v0.2.0/../../x']) {
      expect(() => labelOfTag(tag)).toThrow(/not a release tag/);
    }
  });

  it('latest.json has every field, with absolute URLs', () => {
    const text = latestJson(RC, SITE);
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      name: 'instapost-0.2.0-rc.1.zip',
      version: '0.2.0-rc.1',
      tag: 'v0.2.0-rc.1',
      prerelease: true,
      released: '2026-11-05T12:00:00.000Z',
      size: 865_121,
      sha256: SHA,
      zip: 'https://monsieurbelbo.github.io/instapost/downloads/instapost-0.2.0-rc.1.zip',
      latest: 'https://monsieurbelbo.github.io/instapost/downloads/instapost-latest.zip',
      notes: 'https://github.com/monsieurBelbo/instapost/releases/tag/v0.2.0-rc.1',
    });
  });

  it('SHA256 is in sha256sum format, for both names', () => {
    expect(sha256Sums(RC)).toBe(`${SHA}  instapost-0.2.0-rc.1.zip\n${SHA}  instapost-latest.zip\n`);
  });

  it('a .sha256 must name this zip and this hash', () => {
    const name = 'instapost-0.2.0.zip';
    expect(() => checkSha256Line(`${SHA}  ${name}\n`, name, SHA)).not.toThrow();
    expect(() => checkSha256Line(`${SHA} *${name}\n`, name, SHA)).not.toThrow();
    expect(() => checkSha256Line(`${SHA}  ${name}\n`, name, 'f'.repeat(64))).toThrow(/SHA-256 is f+/);
    expect(() => checkSha256Line(`${SHA}  instapost-0.1.1.zip\n`, name, SHA)).toThrow(/not a sha256sum line/);
    expect(() => checkSha256Line(`${SHA}  dist/${name}\n`, name, SHA)).toThrow(/not a sha256sum line/);
    expect(() => checkSha256Line('', name, SHA)).toThrow(/not a sha256sum line/);
    expect(() => checkSha256Line(`${SHA.slice(1)}  ${name}\n`, name, SHA)).toThrow(/not a sha256sum line/);
  });

  it('BASE_URL gets exactly one trailing slash, whichever way it arrives', () => {
    const page = 'https://monsieurbelbo.github.io/instapost/';
    expect(baseUrlOf('https://monsieurbelbo.github.io/instapost')).toBe(page);
    expect(baseUrlOf('https://monsieurbelbo.github.io/instapost/')).toBe(page);
    expect(baseUrlOf('https://monsieurBelbo.github.io/instapost//')).toBe(page);
    expect(baseUrlOf('https://example.test')).toBe('https://example.test/');
    expect(baseUrlOf(undefined)).toBe(page);
    expect(baseUrlOf('')).toBe(page);
    for (const bad of ['not a url', 'file:///etc/', 'https://x.test/?a=1', 'https://x.test/#a']) {
      expect(() => baseUrlOf(bad)).toThrow();
    }
  });

  it('replaces only a folder made for it', () => {
    const repo = '/work/instapost';
    expect(outDirOf('_site', repo)).toBe('/work/instapost/_site');
    expect(outDirOf('/elsewhere/page', repo)).toBe('/elsewhere/page');
    expect(outDirOf('../page', repo)).toBe('/work/page');
    for (const bad of ['.', '..', '/', '/work', 'site', 'tools/site', 'site/_x', repo]) {
      expect(() => outDirOf(bad, repo)).toThrow(/refusing/);
    }
    expect(() => outDirOf(undefined, repo)).toThrow(/usage/);
  });
});

describe('scripts/build-site.ts, as the Site job runs it', () => {
  const temp = mkdtempSync(join(tmpdir(), 'instapost-site-'));
  afterAll(() => rmSync(temp, { recursive: true, force: true }));
  let runs = 0;

  const run = (env: { TAG?: string; BASE_URL?: string }, dir?: string) => {
    runs += 1;
    const out = join(temp, `out-${runs}`);
    const args = ['scripts/build-site.ts', '--out', out, ...(dir ? ['--release-dir', dir] : [])];
    const r = spawnSync(process.execPath, args, {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, TAG: env.TAG ?? '', BASE_URL: env.BASE_URL ?? '' },
    });
    return { out, status: r.status, stderr: r.stderr };
  };

  /** What `gh release download` and `gh release view` leave. */
  function releaseDir(name: string, over: { sha?: string; json?: object } = {}): { dir: string; bytes: Buffer } {
    const dir = join(temp, name);
    mkdirSync(dir);
    const bytes = Buffer.from(`pretend zip ${name}\n`);
    const zip = 'instapost-0.2.0-rc.1.zip';
    writeFileSync(join(dir, zip), bytes);
    const sha = over.sha ?? createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(dir, `${zip}.sha256`), `${sha}  ${zip}\n`);
    const body = 'Repost <now> & more.\n\n<!-- es: Añade <ya> & más. -->\n\n### Added\n\n- Videos come later (AM50).\n';
    const json = {
      tagName: 'v0.2.0-rc.1',
      isPrerelease: true,
      publishedAt: '2026-11-05T12:00:00Z',
      body,
      ...over.json,
    };
    writeFileSync(join(dir, 'release.json'), JSON.stringify(json));
    return { dir, bytes };
  }

  const read = (out: string, file: string): string => readFileSync(join(out, file), 'utf8');

  it('writes the page and the downloads, from BASE_URL with no trailing slash', () => {
    const { dir, bytes } = releaseDir('good');
    const { out, status, stderr } = run(
      { TAG: 'v0.2.0-rc.1', BASE_URL: 'https://monsieurbelbo.github.io/instapost' },
      dir,
    );
    expect(stderr).not.toContain('Error');
    expect(status).toBe(0);

    const sha = createHash('sha256').update(bytes).digest('hex');
    expect(sha256File(join(out, 'downloads/instapost-0.2.0-rc.1.zip'))).toBe(sha);
    expect(sha256File(join(out, 'downloads/instapost-latest.zip'))).toBe(sha);
    expect(lstatSync(join(out, 'downloads/instapost-latest.zip')).isFile()).toBe(true);
    expect(read(out, 'downloads/SHA256')).toBe(`${sha}  instapost-0.2.0-rc.1.zip\n${sha}  instapost-latest.zip\n`);
    const latest = JSON.parse(read(out, 'downloads/latest.json')) as Record<string, unknown>;
    expect(latest.zip).toBe('https://monsieurbelbo.github.io/instapost/downloads/instapost-0.2.0-rc.1.zip');
    expect(latest.size).toBe(bytes.length);
    expect(latest.sha256).toBe(sha);

    const en = read(out, 'index.html');
    const es = read(out, 'es/index.html');
    const enDetails = read(out, 'details/index.html');
    const esDetails = read(out, 'es/details/index.html');
    expect(enDetails).toContain(`<code class="sha">${sha}</code>`);
    expect(esDetails).toContain(`<code class="sha">${sha}</code>`);
    expect(enDetails).toContain('Repost &lt;now&gt; &amp; more.');
    expect(esDetails).toContain('Añade &lt;ya&gt; &amp; más.');
    expect(en).toContain(EN.prerelease);
    expect(es).toContain(ES.prerelease);
    expect(enDetails).toContain('<link rel="canonical" href="https://monsieurbelbo.github.io/instapost/details/">');
    expect(esDetails).toContain('<link rel="canonical" href="https://monsieurbelbo.github.io/instapost/es/details/">');
    for (const html of [en, es, enDetails, esDetails]) {
      expect(html).not.toContain('Videos come later');
      expect(html).not.toContain('AM50');
      expect(html).toContain('<link rel="canonical" href="https://monsieurbelbo.github.io/instapost/');
    }
    expect(read(out, '404.html')).toContain('href="/instapost/style.css"');
    expect(existsSync(join(dir, 'release.json'))).toBe(true);
    expect(existsSync(join(out, 'downloads/release.json'))).toBe(false);
  });

  it('every file a page points at exists, the font and its licence included', () => {
    const { dir } = releaseDir('refs');
    const { out } = run({ TAG: 'v0.2.0-rc.1' }, dir);
    const target = (from: string, ref: string): string => {
      const path = ref.startsWith('/instapost/') ? join(out, ref.slice('/instapost/'.length)) : resolve(from, ref);
      return existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
    };
    for (const file of ['index.html', 'es/index.html', 'details/index.html', 'es/details/index.html', '404.html']) {
      const html = read(out, file);
      const local = [...loadedRefs(html), ...anchors(html)].filter((r) => !/^(?:[a-z]+:|#)/i.test(r));
      expect(local.length).toBeGreaterThan(1);
      for (const ref of local) expect(existsSync(target(dirname(join(out, file)), ref)), `${file}: ${ref}`).toBe(true);
    }
    for (const m of read(out, 'style.css').matchAll(/url\("?([^")]+)"?\)/g)) {
      expect(m[1]).toMatch(/^assets\//);
      expect(existsSync(join(out, m[1] ?? ''))).toBe(true);
    }
    for (const font of ['InstrumentSans-Variable.woff2', 'OFL.txt']) {
      expect(sha256File(join(out, 'assets', font))).toBe(sha256File(join(REPO, 'public/fonts', font)));
    }
  });

  it.each([
    ['a missing release folder', '', (): string => join(temp, 'nowhere')],
    [
      'an empty release folder',
      '',
      (): string => {
        const dir = join(temp, 'empty');
        mkdirSync(dir);
        return dir;
      },
    ],
    ['no --release-dir', '', (): undefined => undefined],
  ])('with %s and no TAG it still builds, with no download', (_, tag, dir) => {
    const { out, status } = run({ TAG: tag }, dir());
    expect(status).toBe(0);
    expect(existsSync(join(out, 'downloads'))).toBe(false);
    const en = read(out, 'index.html');
    expect(en).toContain(EN.noRelease);
    expect(en).not.toContain('downloads/');
    expect(read(out, 'es/index.html')).toContain(ES.noRelease);
    expect(read(out, 'details/index.html')).toContain(EN.details.limits.title);
    expect(read(out, 'es/details/index.html')).toContain(ES.details.limits.title);
    expect(existsSync(join(out, 'assets/InstrumentSans-Variable.woff2'))).toBe(true);
  });

  it('a zip that doesn’t match its .sha256 throws and writes nothing', () => {
    const { dir } = releaseDir('tampered', { sha: 'f'.repeat(64) });
    const { out, status, stderr } = run({ TAG: 'v0.2.0-rc.1' }, dir);
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/its \.sha256 says f+/);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a release that doesn’t add up', () => {
    const missing = releaseDir('missing');
    rmSync(join(missing.dir, 'instapost-0.2.0-rc.1.zip'));
    const cases: [{ TAG?: string }, string | undefined, RegExp][] = [
      [{ TAG: 'v0.2.0-rc.1' }, missing.dir, /is not in/],
      [{ TAG: 'v0.2.0-rc.1' }, undefined, /no --release-dir/],
      [{ TAG: 'v0.2.0-rc.1' }, releaseDir('other', { json: { tagName: 'v0.1.1' } }).dir, /is for v0\.1\.1/],
      [{ TAG: 'nope' }, releaseDir('badtag').dir, /not a release tag/],
      [{}, releaseDir('notag').dir, /no TAG, but/],
    ];
    for (const [env, dir, message] of cases) {
      const { out, status, stderr } = run(env, dir);
      expect(status, String(message)).not.toBe(0);
      expect(stderr).toMatch(message);
      expect(existsSync(out)).toBe(false);
    }
  });

  it('refuses a folder outside the repo that isn’t empty, and leaves its files alone', () => {
    const out = join(temp, 'precious');
    mkdirSync(out);
    writeFileSync(join(out, 'thesis.txt'), 'years of work');
    const r = spawnSync(process.execPath, ['scripts/build-site.ts', '--out', out], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, TAG: '', BASE_URL: '' },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to replace .*precious: it is not empty/);
    expect(readFileSync(join(out, 'thesis.txt'), 'utf8')).toBe('years of work');
    expect(existsSync(join(out, 'index.html'))).toBe(false);
  });

  it('builds into an empty folder outside the repo', () => {
    const out = join(temp, 'empty-out');
    mkdirSync(out);
    const r = spawnSync(process.execPath, ['scripts/build-site.ts', '--out', out], {
      cwd: REPO,
      encoding: 'utf8',
      env: { ...process.env, TAG: '', BASE_URL: '' },
    });
    expect(r.status).toBe(0);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
  });

  it('imports only node built-ins and .ts files, all the way down: the Site job has no install', () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      if (/\bimport\(/.test(source)) bad.push(`${file}: dynamic import`);
      for (const m of source.matchAll(/^(?:import|export)\b[^;'"]*?from '([^']+)'|^import '([^']+)'/gm)) {
        const spec = m[1] ?? m[2] ?? '';
        if (spec.startsWith('node:')) continue;
        if (spec.startsWith('.') && spec.endsWith('.ts')) walk(resolve(dirname(file), spec));
        else bad.push(`${file}: ${spec}`);
      }
    };
    walk(join(REPO, 'scripts/build-site.ts'));
    expect(seen.size).toBeGreaterThan(4);
    expect(bad).toEqual([]);
  });
});

describe('the static files', () => {
  it('copy.js only copies: no network, no storage, no theme', () => {
    const js = readFileSync(join(REPO, 'site/copy.js'), 'utf8');
    expect(js).toContain('navigator.clipboard.writeText');
    for (const word of ['fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'localStorage', 'cookie', 'matchMedia']) {
      expect(js).not.toContain(word);
    }
    expect(js.split('\n').length).toBeLessThan(25);
  });

  it.each([
    ['copied', async () => {}, 'Copied'],
    ['refused', () => Promise.reject(new Error('no')), 'Select and copy'],
  ] as const)('a Copy button’s name follows what it shows, then comes back: %s', async (_, writeText, shown) => {
    let click = async (): Promise<void> => {};
    let restore = (): void => {};
    const name = 'Copy chrome://extensions';
    const button = {
      textContent: 'Copy',
      ariaLabel: name,
      dataset: { copy: 'chrome://extensions', done: 'Copied', fail: 'Select and copy' },
      setAttribute: () => {},
      addEventListener: (_type: string, f: () => Promise<void>) => {
        click = f;
      },
    };
    runInNewContext(readFileSync(join(REPO, 'site/copy.js'), 'utf8'), {
      document: { querySelectorAll: () => [button] },
      navigator: { clipboard: { writeText } },
      getSelection: () => ({ selectAllChildren: () => {} }),
      setTimeout: (f: () => void) => {
        restore = f;
      },
    });
    await click();
    expect([button.textContent, button.ariaLabel]).toEqual([shown, shown]);
    restore();
    expect([button.textContent, button.ariaLabel]).toEqual(['Copy', name]);
  });

  it('a well can grow with a big minimum font, and the language link doesn’t count the scrollbar', () => {
    const css = readFileSync(join(REPO, 'site/style.css'), 'utf8');
    expect(css).toMatch(/\.well \{[^}]*\bmin-height: 138px/);
    expect(css).not.toMatch(/\.well \{[^}]*[^-]height: 138px/);
    expect(css).not.toMatch(/\.lang \{[^}]*vw/);
  });

  it('Copy buttons start hidden, with the address as plain selectable text', () => {
    for (const c of [EN, ES]) {
      const html = renderPage(c, RELEASE, SITE);
      for (const address of ['chrome://extensions', 'arc://extensions']) {
        expect(html).toContain(`<code>${address}</code><button class="copy" type="button" hidden`);
        expect(html).toContain(`data-copy="${address}"`);
      }
    }
  });
});
