/**
 * The site's pages, as pure functions: copy + release in, HTML out. No I/O and no imports that need an install, so the
 * Site job can run it and tests can pin it. Every release value goes through esc(). No inline style or script: the CSP
 * below refuses both.
 */
import type { Block, Copy } from './copy.en.ts';

export interface Release {
  /** Tag without the v: 0.2.0, 0.2.0-rc.1. */
  label: string;
  prerelease: boolean;
  /** When the GitHub Release was published: ISO, UTC. */
  date: string;
  sizeBytes: number;
  sha256: string;
  /** The changelog's summary, plain text. No Spanish: the page shows the English. None at all: no What's new. */
  summary: { en: string; es: string | null } | null;
}

export interface Site {
  /** Absolute, with a trailing slash: https://monsieurbelbo.github.io/instapost/ */
  baseUrl: string;
  repo: string;
}

/** The release's zip under its own name, and the name that stays put, so HTML cached across a release can't 404. */
export const zipName = (label: string): string => `instapost-${label}.zip`;
export const LATEST_ZIP = 'instapost-latest.zip';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const formatSize = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

export function formatDate(iso: string, months: readonly string[]): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const CSP =
  "default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'";

/** The mark (entrypoints/composer/icons.tsx). `.r` is the ring, filled with what's behind it through --mark-bg. */
const mark = (): string =>
  `<svg class="mark" viewBox="4 0.6 16.6 21.9" aria-hidden="true"><g class="m"><rect x="5.25" y="2.75" width="13.5" height="18.5" rx="3.75"/><path d="M12 16V9.2M9.2 11.8 12 9l2.8 2.8"/></g><circle cx="18.4" cy="4.6" r="4" class="r"/><circle cx="18.4" cy="4.6" r="3" class="d"/></svg>`;

const arrowDown =
  '<svg class="down" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.5v11M4.5 9.5 9 14l4.5-4.5"/></svg>';

const folderIcon =
  '<svg class="folder" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2.2 2.5h7.2A2.5 2.5 0 0 1 21 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.500z"/></svg>';

/** A body split with <br> is a list: read out as one, and its items are set apart. */
const block = (b: Block): string => {
  const items = b.body.split('<br>');
  const body = items.length > 1 ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : `<p>${b.body}</p>`;
  return `<div class="block"><h3>${b.title}</h3>${body}</div>`;
};

function head(c: Copy, site: Site, root: string): string {
  const url = c.lang === 'en' ? site.baseUrl : `${site.baseUrl}es/`;
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#efefef">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#161616">
<title>${c.title}</title>
<meta name="description" content="${esc(c.description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${site.baseUrl}">
<link rel="alternate" hreflang="es" href="${site.baseUrl}es/">
<link rel="alternate" hreflang="x-default" href="${site.baseUrl}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="instapost">
<meta property="og:locale" content="${c.locale}">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${site.baseUrl}assets/og-${c.lang}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(c.ogAlt)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${root}assets/mark-tile.svg" type="image/svg+xml">
<link rel="icon" href="${root}assets/icon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="${root}assets/icon-180.png">
<link rel="preload" href="${root}assets/InstrumentSans-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${root}style.css">
<script src="${root}copy.js" defer></script>
</head>`;
}

function hero(c: Copy, r: Release | null, root: string, site: Site): string {
  const fill = (s: string): string =>
    r
      ? s
          .replace('{v}', () => esc(r.label))
          .replace('{size}', () => esc(formatSize(r.sizeBytes)))
          .replace(
            '{date}',
            () => `<time datetime="${esc(r.date.slice(0, 10))}">${esc(formatDate(r.date, c.months))}</time>`,
          )
      : s;
  const get = r
    ? `<a class="dl" href="${root}downloads/${LATEST_ZIP}" download="${esc(zipName(r.label))}"><span>${fill(c.download)}</span>${arrowDown}</a>`
    : `<p class="dl is-off">${c.noRelease}</p>`;
  const release = r
    ? `<li>${fill(c.metaRelease)}${r.summary ? ` <a href="#new">${c.whatsNewLink}</a>` : ''}</li>${r.prerelease ? `<li>${c.prerelease}</li>` : ''}`
    : '';
  return `<section class="hero grid">
  <div class="card">
    <div class="card-inner">
      <p class="brand">${mark()}instapost</p>
      <h1>${c.h1.map((l) => `<span>${l}</span>`).join(' ')}</h1>
      <p class="sub">${c.sub}</p>
      <p class="phone">${c.phone}</p>
      ${get}
      <p class="risk">${c.risk}</p>
      <ul class="meta">
        ${release}
        <li>${c.needs}</li>
        <li>${c.tried}</li>
        <li><a href="${site.repo}">${c.sourceLink}</a></li>
      </ul>
    </div>
    <span class="dot" aria-hidden="true"></span>
  </div>

  <div class="side">
    <p class="lead">${c.lead}</p>
    <p class="why">${c.why}</p>
    <figure class="scene">
      <div class="window">
        <div class="bar" aria-hidden="true"><span>instagram.com</span></div>
        <div class="inner">
          <div class="nav" aria-hidden="true">
            <i class="logo"></i><i></i><i></i><i></i><i></i><i></i><i></i><i class="round"></i>
            <span class="entry">${mark()}<span>${c.entry}</span></span>
            <span class="entry-note">${c.entryNote}</span>
          </div>
          <div class="room">
            <picture>
              <source srcset="${root}assets/composer-${c.lang}-dark.webp" media="(prefers-color-scheme: dark)">
              <img src="${root}assets/composer-${c.lang}-light.webp" width="1392" height="1354" fetchpriority="high" alt="${esc(c.shotAlt)}">
            </picture>
          </div>
        </div>
      </div>
      <figcaption>${c.caption}</figcaption>
    </figure>
  </div>
</section>`;
}

function install(c: Copy, r: Release | null, site: Site): string {
  const [s1, s2, s3, s4, s5] = c.steps;
  const zip = esc(r ? zipName(r.label) : 'instapost.zip');
  const copyRow = (browser: string, address: string): string =>
    `<div class="addr"><span class="who">${browser}</span><code>${address}</code><button class="copy" type="button" hidden data-copy="${address}" data-done="${c.copied}" data-fail="${c.copyFail}" aria-label="${c.copy} ${address}">${c.copy}</button></div>`;
  const note = r?.summary
    ? `<p id="new" class="new"><strong>${c.newIn.replace('{v}', () => esc(r.label))}</strong> <span${
        c.lang === 'es' && !r.summary.es ? ' lang="en"' : ''
      }>${esc((c.lang === 'es' && r.summary.es) || r.summary.en)}</span> <a href="${site.repo}/releases/tag/v${esc(r.label)}">${c.allChanges}</a></p>`
    : '<p></p>';
  return `<section class="install">
  <header class="install-head grid">
    <h2>${c.installHead}</h2>
    <p>${c.installIntro}</p>
  </header>
  <ol class="steps">
    <li class="step">
      <h3>${s1.title}</h3><p>${s1.body}</p>
      <div class="well files" aria-hidden="true"><code>${zip}</code><span class="then"></span><span class="fold">${folderIcon}<b>${c.wellFolder}</b></span></div>
    </li>
    <li class="step">
      <h3>${s2.title}</h3><p>${s2.body}</p>
      <div class="well urls">${copyRow(c.browserChrome, 'chrome://extensions')}${copyRow(c.browserArc, 'arc://extensions')}</div>
    </li>
    <li class="step">
      <h3>${s3.title}</h3><p>${s3.body}</p>
      <div class="well toggle" aria-hidden="true"><span>${c.wellDev}</span><i></i></div>
    </li>
    <li class="step">
      <h3>${s4.title}</h3><p>${s4.body}</p>
      <div class="well load" aria-hidden="true"><span class="chip">${c.wellLoad}</span><span class="tree"><b>${c.wellFolder}</b> <em>${c.wellChoose}</em><br><code>manifest.json</code></span></div>
    </li>
    <li class="step">
      <h3>${s5.title}</h3><p>${s5.body}</p>
      <div class="well row-well" aria-hidden="true"><i></i><span class="entry">${mark()}<span>${c.entry}</span></span></div>
    </li>
  </ol>
  <div class="after grid">
    ${note}
    <div class="notes">${block(c.updating)}${block(c.removing)}</div>
  </div>
</section>`;
}

function ledger(c: Copy): string {
  const cell = (cls: string, tag: string, lines: string[]): string =>
    `<div class="${cls}"><span class="tag">${tag}</span>${lines.map((l) => `<p>${l}</p>`).join('')}</div>`;
  return `<section class="ledger">
  <div class="row headrow">
    <h2 class="ledger-lead">${c.ledgerLead}</h2>
    <div class="cells" aria-hidden="true"><span class="colhead">${c.canHead}</span><span class="colhead">${c.cantHead}</span></div>
  </div>
  ${c.rows
    .map(
      (r) => `<div class="row">
    <h3>${r.topic}</h3>
    <div class="cells">${cell('can', c.canHead, r.can)}${cell('cant', c.cantHead, r.cant)}</div>
  </div>`,
    )
    .join('\n  ')}
</section>`;
}

function risk(c: Copy): string {
  return `<section class="riskpart">
  <h2>${c.riskHead}</h2>
  <div class="plain grid">
    <p class="statement">${c.riskLead}</p>
    <div class="blocks">
      ${c.riskBlocks.map(block).join('\n      ')}
      <details class="wide"><summary>${c.exactHead}</summary><p>${c.exactBody}</p></details>
    </div>
  </div>
</section>`;
}

function data(c: Copy, r: Release | null): string {
  // The one name longer than the narrowest two-column layout's cell: it breaks at a word, not at a letter.
  const permName = (k: string): string => k.replace('RequestWith', 'Request<wbr>With');
  const check = r ? c.checkWithRelease.replace('{sha}', () => esc(r.sha256)) : c.checkWithoutRelease;
  return `<section class="datapart plain grid">
  <div>
    <h2>${c.dataHead}</h2>
    <p class="statement">${c.dataLead}</p>
  </div>
  <div class="blocks">
    ${c.dataBlocks.map(block).join('\n    ')}
    ${block({ title: c.checkTitle, body: check })}
    <details class="wide"><summary>${c.permsHead}</summary><dl class="perms">${c.perms
      .map(([k, v]) => `<div><dt><code>${permName(k)}</code></dt><dd>${v}</dd></div>`)
      .join('')}</dl></details>
  </div>
</section>`;
}

function foot(c: Copy, root: string, site: Site): string {
  const f = c.foot;
  return `<footer class="foot grid">
  <p class="foot-brand">${mark()}instapost</p>
  <div class="foot-text">
    <p class="foot-links">
      <a href="${site.repo}">${f.source}</a>
      <a href="${site.repo}/blob/main/CHANGELOG.md">${f.changelog}</a>
      <a href="${site.repo}/releases">${f.older}</a>
      <a href="${site.repo}/issues">${f.problem}</a>
      <a href="${site.repo}/blob/main/LICENSE">${f.licence}</a>
      <a href="${root}assets/OFL.txt">${f.font}</a>
    </p>
    <p>${f.asIs}</p>
    <p>${f.affiliation}</p>
    <p>${f.hosting}</p>
  </div>
</footer>`;
}

/** `root` is '' at / and '../' at /es/. Every internal link is relative, so the site works under /instapost/. */
export function renderPage(c: Copy, r: Release | null, site: Site): string {
  const root = c.lang === 'en' ? '' : '../';
  const other = c.lang === 'en' ? 'es/' : '../';
  return `<!doctype html>
<html lang="${c.lang}">
${head(c, site, root)}
<body>
<nav class="lang"><a href="${other}" hreflang="${c.otherLang.hreflang}" lang="${c.otherLang.hreflang}">${c.otherLang.label}</a></nav>
<main>
${hero(c, r, root, site)}
${install(c, r, site)}
${ledger(c)}
${risk(c)}
${data(c, r)}
</main>
${foot(c, root, site)}
</body>
</html>
`;
}

/** GitHub Pages serves this at any depth, so its links are absolute from the site's path. */
export function renderNotFound(en: Copy, es: Copy, site: Site): string {
  const path = new URL(site.baseUrl).pathname;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>instapost: ${en.notFound.head}</title>
<link rel="icon" href="${path}assets/mark-tile.svg" type="image/svg+xml">
<link rel="stylesheet" href="${path}style.css">
</head>
<body class="lost">
<main>
<p class="foot-brand">${mark()}instapost</p>
<h1>${en.notFound.head}</h1>
<p>${en.notFound.body} <a href="${path}">${en.notFound.link}</a></p>
<p lang="es">${es.notFound.body} <a href="${path}es/">${es.notFound.link}</a></p>
</main>
</body>
</html>
`;
}
