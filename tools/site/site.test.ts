/**
 * The page: what a release puts on it, what it must never carry, and the whole build as the Site job runs it. The looks
 * are checked by hand on a real build (widths, dark, no JS), not here.
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
import { esc, formatDate, formatSize, type Release, renderNotFound, renderPage, type Site } from './page.ts';
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

describe('a release on the page', () => {
  it('shows its version, size, date and SHA, and links the stable name under the versioned one', () => {
    const html = renderPage(EN, RELEASE, SITE);
    expect(html).toContain('Download instapost 0.2.0');
    expect(html).toContain('href="downloads/instapost-latest.zip" download="instapost-0.2.0.zip"');
    expect(html).toContain('Zip, 0.9 MB. Released <time datetime="2026-11-05">5 Nov 2026</time>.');
    expect(html).toContain(`<code class="sha">${SHA}</code>`);
    expect(html).toContain('<code>instapost-0.2.0.zip</code>');
    expect(html).toContain(`<strong>New in 0.2.0.</strong> <span>Repost a photo post.</span>`);
    expect(html).toContain(`href="${SITE.repo}/releases/tag/v0.2.0"`);
  });

  it('in Spanish it reads the same from one folder down', () => {
    const html = renderPage(ES, RELEASE, SITE);
    expect(html).toContain('Descargar instapost 0.2.0');
    expect(html).toContain('href="../downloads/instapost-latest.zip" download="instapost-0.2.0.zip"');
    expect(html).toContain('Zip, 0.9 MB. Publicada el <time datetime="2026-11-05">5 nov 2026</time>.');
    expect(html).toContain('<span>Añade una publicación.</span>');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<nav class="lang"><a href="../"');
    for (const ref of loadedRefs(html)) expect(ref).toMatch(/^\.\.\//);
  });

  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)('%s gives where it has run as a real list of its four tiers', (_, c) => {
    const list = /<h3>[^<]*<\/h3><ul>(.*?)<\/ul>/.exec(renderPage(c, RELEASE, SITE))?.[1] ?? '';
    expect(list.match(/<li><b>/g)).toHaveLength(4);
    expect(list).not.toContain('<br>');
  });

  it('the Spanish page marks the English button name it quotes', () => {
    expect(renderPage(ES, RELEASE, SITE)).toContain('<span lang="en">Load unpacked</span>');
  });

  it('English links are relative to the site’s folder', () => {
    const html = renderPage(EN, RELEASE, SITE);
    expect(html).toContain('<nav class="lang"><a href="es/"');
    for (const ref of loadedRefs(html)) expect(ref).toMatch(/^(?:assets\/|style\.css|copy\.js)/);
  });

  it('escapes everything a release carries', () => {
    const nasty = '<img src=x onerror=alert(1)>&"';
    const escaped = '&lt;img src=x onerror=alert(1)&gt;&amp;&quot;';
    const r: Release = {
      ...RELEASE,
      label: nasty,
      sha256: nasty,
      date: `2026-11-05T12:00:00.000Z${nasty}`,
      summary: { en: nasty, es: nasty },
    };
    for (const html of [renderPage(EN, r, SITE), renderPage(ES, r, SITE)]) {
      expect(html).not.toContain('<img src=x');
      expect(html).toContain(escaped);
      expect(html).toContain(`download="instapost-${escaped}.zip"`);
      expect(html).toContain(`<code class="sha">${escaped}</code>`);
    }
    const dollars = renderPage(EN, { ...RELEASE, label: "$&$'$`" }, SITE);
    expect(dollars).toContain("Download instapost $&amp;$'$`<");
  });

  it('a Spanish page with no Spanish summary shows the English one, marked as English', () => {
    const html = renderPage(ES, { ...RELEASE, summary: { en: 'Repost a photo post.', es: null } }, SITE);
    expect(html).toContain('<span lang="en">Repost a photo post.</span>');
  });

  it('a prerelease says so, and only a prerelease', () => {
    expect(renderPage(EN, RC, SITE)).toContain(`<li>${EN.prerelease}</li>`);
    expect(renderPage(ES, RC, SITE)).toContain(`<li>${ES.prerelease}</li>`);
    expect(renderPage(EN, RC, SITE)).toContain('Download instapost 0.2.0-rc.1');
    expect(renderPage(EN, RELEASE, SITE)).not.toContain(EN.prerelease);
    expect(renderPage(ES, RELEASE, SITE)).not.toContain(ES.prerelease);
  });

  it('a release with no usable summary keeps its download and has no What’s new, link included', () => {
    for (const c of [EN, ES]) {
      const html = renderPage(c, { ...RELEASE, summary: null }, SITE);
      expect(html).toContain('download="instapost-0.2.0.zip"');
      expect(html).not.toContain('id="new"');
      expect(html).not.toContain('href="#new"');
      expect(html).not.toContain(c.whatsNewLink);
    }
    expect(anchors(renderPage(EN, RELEASE, SITE))).toContain('#new');
    expect(renderPage(EN, RELEASE, SITE)).toContain('id="new"');
  });

  it('formats dates in UTC from a fixed table, and sizes in decimal MB', () => {
    expect(formatDate('2026-01-01T00:30:00Z', EN.months)).toBe('1 Jan 2026');
    expect(formatDate('2026-12-31T23:59:59Z', ES.months)).toBe('31 dic 2026');
    expect(formatDate('2026-01-01T00:30:00+02:00', EN.months)).toBe('31 Dec 2025');
    expect(EN.months).toHaveLength(12);
    expect(ES.months).toHaveLength(12);
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
  ] as const)('%s is the full page, with no download, version, What’s new or SHA', (_, c) => {
    const html = renderPage(c, null, SITE);
    expect(html).toContain(`<p class="dl is-off">${c.noRelease}</p>`);
    for (const gone of ['<a class="dl"', 'downloads/', 'download=', 'id="new"', '#new', 'class="sha"', 'SHA-256']) {
      expect(html).not.toContain(gone);
    }
    expect(html).not.toMatch(/\d+\.\d+\.\d+/);
    expect(html).toContain(`<p>${c.checkWithoutRelease}</p>`);
    for (const part of ['class="hero', 'class="install"', 'class="ledger"', 'class="riskpart"', 'class="datapart']) {
      expect(html).toContain(part);
    }
    expect(html).toContain(`<h2>${c.installHead}</h2>`);
    expect(html).toContain('<footer class="foot');
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

  it('links out only to the repo; absolute URLs are for head metadata', () => {
    for (const [, html] of everyPage()) {
      const body = html.slice(html.indexOf('<body'));
      for (const href of anchors(body)) if (/^[a-z]+:/i.test(href)) expect(href.startsWith(SITE.repo)).toBe(true);
      expect(body.replace(/https:\/\/github\.com\/monsieurBelbo\/instapost[^"]*/g, '')).not.toMatch(/https?:\/\//);
    }
  });
});

describe('what a screen reader meets', () => {
  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)(
    '%s: every step has its heading and text before its well, so Copy never comes before the instruction',
    (_, c) => {
      const steps = renderPage(c, RELEASE, SITE).split('<li class="step">').slice(1);
      expect(steps).toHaveLength(5);
      for (const step of steps) {
        expect(step.indexOf('<h3>')).toBeGreaterThanOrEqual(0);
        expect(step.indexOf('<h3>')).toBeLessThan(step.indexOf('class="well'));
      }
    },
  );

  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)(
    '%s: the ledger’s heading is its lead, and each cell names its column, not two empty headings',
    (_, c) => {
      const html = renderPage(c, RELEASE, SITE);
      expect(html).toContain(`<h2 class="ledger-lead">${c.ledgerLead}</h2>`);
      expect(html).toContain(`<div class="cells" aria-hidden="true"><span class="colhead">${c.canHead}</span>`);
      expect(html).not.toContain(`<h2>${c.canHead}</h2>`);
      expect(html).not.toContain(`<h2>${c.cantHead}</h2>`);
      expect(html).toContain(`<div class="can"><span class="tag">${c.canHead}</span>`);
      expect(html).toContain(`<div class="cant"><span class="tag">${c.cantHead}</span>`);
    },
  );

  it('the column tags stay in the tree at every width: hidden by clipping, never display:none', () => {
    expect(readFileSync(join(REPO, 'site/style.css'), 'utf8')).not.toMatch(/\.tag\s*\{\s*display:\s*none/);
  });
});

describe('the head', () => {
  const head = (c: typeof EN, r: Release | null): string => renderPage(c, r, SITE).split('</head>')[0] ?? '';

  it('says who it is, in both languages, with absolute URLs', () => {
    const en = head(EN, RELEASE);
    expect(en).toContain(`<title>${EN.title}</title>`);
    expect(en).toContain(`<link rel="canonical" href="${SITE.baseUrl}">`);
    expect(en).toContain('<meta property="og:locale" content="en_US">');
    expect(en).toContain(`<meta property="og:image" content="${SITE.baseUrl}assets/og-en.png">`);
    const es = head(ES, RELEASE);
    expect(es).toContain(`<link rel="canonical" href="${SITE.baseUrl}es/">`);
    expect(es).toContain('<meta property="og:locale" content="es_LA">');
    expect(es).toContain(`<meta property="og:url" content="${SITE.baseUrl}es/">`);
    expect(es).toContain(`<meta property="og:image" content="${SITE.baseUrl}assets/og-es.png">`);
    for (const h of [en, es]) {
      expect(h).toContain(`<link rel="alternate" hreflang="en" href="${SITE.baseUrl}">`);
      expect(h).toContain(`<link rel="alternate" hreflang="es" href="${SITE.baseUrl}es/">`);
      expect(h).toContain(`<link rel="alternate" hreflang="x-default" href="${SITE.baseUrl}">`);
      expect(h).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(h).toContain('<meta name="color-scheme" content="light dark">');
      expect(h).toContain('media="(prefers-color-scheme: light)" content="#efefef"');
      expect(h).toContain('media="(prefers-color-scheme: dark)" content="#161616"');
      expect(h).toContain('as="font" type="font/woff2" crossorigin');
      expect(h).toContain('<meta property="og:image:width" content="1200">');
    }
  });

  it('never carries a version, so a stale share card can’t lie', () => {
    expect(head(EN, RELEASE)).not.toContain('0.2.0');
    expect(head(ES, RC)).not.toContain('0.2.0');
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
    expect(html).toContain(`<p lang="es">${ES.notFound.body}`);
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
    expect(compared).toBeGreaterThan(100);
  });

  it.each([
    ['en', EN, 'post or test'],
    ['es', ES, 'publicación o prueba'],
  ] as const)('%s says the forged headers and phone frame apply to a test as well as a post', (_, c, both) => {
    expect(c.exactHead).toContain(both);
    expect(c.riskBlocks[1]?.body).toContain(both);
    expect(c.riskBlocks[2]?.title).toContain(both);
    expect(c.perms.find(([k]) => k.startsWith('declarativeNetRequest'))?.[1]).toContain(both);
  });

  it.each([
    ['en', EN],
    ['es', ES],
  ] as const)('%s names every header the exact block promises', (_, c) => {
    for (const header of [
      'X-Frame-Options',
      'Sec-Fetch-Dest',
      'User-Agent',
      'Sec-CH-UA-Mobile',
      'Sec-CH-UA-Platform',
    ]) {
      expect(c.exactBody).toContain(`<code>${header}</code>`);
    }
  });

  it.each([
    ['en', EN, 'secondary account'],
    ['es', ES, 'cuenta secundaria'],
  ] as const)(
    '%s says secondary account wherever it gives the live record, and at the install step',
    (_, c, account) => {
      expect(c.tried).toContain(account);
      expect(c.rows.at(-1)?.can[0]).toContain(account);
      expect(c.steps[4].body).toContain(account);
    },
  );

  it.each([
    ['en', EN, 'in a normal window, not Incognito', 'in Instagram’s left sidebar'],
    ['es', ES, 'en una ventana normal, no de incógnito', 'en la barra lateral izquierda de Instagram'],
  ] as const)('%s says where step 5 happens: New story never appears in Incognito', (_, c, normal, sidebar) => {
    expect(c.steps[4].body).toContain(normal);
    expect(c.steps[4].body).toContain(sidebar);
  });

  it.each([
    ['en', EN, 'Downloads/instapost'],
    ['es', ES, 'Descargas/instapost'],
  ] as const)('%s says saved copies outlive Remove', (_, c, folder) => {
    expect(c.removing.body).toContain(folder);
    expect(c.dataBlocks[0]?.body).toContain(folder);
  });

  it.each([
    ['en', EN, 'unless it’s a repost'],
    ['es', ES, 'salvo si viene de Añadir a tu historia'],
  ] as const)('%s doesn’t say a failed repost saves itself', (_, c, except) => {
    expect(c.dataBlocks[0]?.body).toContain(except);
  });

  it.each([
    ['en', EN, UI_EN, 'While the page stays open'],
    ['es', ES, UI_ES, 'Mientras la página siga abierta'],
  ] as const)('%s says a copy is saved only while the page stays open, as Settings does', (_, c, ui, open) => {
    expect(c.dataBlocks[0]?.body).toContain(open);
    expect(ui['inpage.settings.keepCopiesHelp']).toContain(open);
  });

  it.each([
    ['en', EN, '@handle', 'read it before you paste it'],
    ['es', ES, '@usuario', 'léelo antes de pegarlo'],
  ] as const)('%s says what Copy diagnostics holds, since the page links to public issues', (_, c, handle, read) => {
    expect(c.dataBlocks[0]?.body).toContain(handle);
    expect(c.dataBlocks[0]?.body).toContain(read);
  });

  it.each([
    ['en', EN, 'Read and change your data', 'can read and change', 'your DMs', 'None of this goes to me'],
    ['es', ES, 'Leer y modificar tus datos', 'puede leer y cambiar', 'mensajes directos', 'Nada de esto me llega'],
  ] as const)('%s owns up to what the Instagram permission reads, DMs included', (_, c, label, can, dms, notMe) => {
    expect(c.dataBlocks[2]?.body).toContain(label);
    const host = c.perms.find(([k]) => k.startsWith('www.instagram.com'))?.[1];
    for (const words of [can, dms, notMe]) expect(host).toContain(words);
  });

  it('permissions and addresses are the browser’s words, untranslated', () => {
    expect(ES.perms.map(([k]) => k)).toEqual(EN.perms.map(([k]) => k));
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
    expect(en).toContain(`<code class="sha">${sha}</code>`);
    expect(en).toContain('Repost &lt;now&gt; &amp; more.');
    expect(es).toContain('Añade &lt;ya&gt; &amp; más.');
    expect(en).toContain(EN.prerelease);
    for (const html of [en, es]) {
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
    for (const file of ['index.html', 'es/index.html', '404.html']) {
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
