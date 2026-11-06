/**
 * The site's pages, as pure functions: copy + release in, HTML out. No I/O and no imports that need an install, so the
 * Site job can run it and tests can pin it. Every release value goes through esc(). No inline style or script: the CSP
 * below refuses both.
 */
import type { Copy, Section } from './copy.en.ts';

export interface Release {
  /** Tag without the v: 0.2.0, 0.2.0-rc.1. */
  label: string;
  prerelease: boolean;
  /** When the GitHub Release was published: ISO, UTC. */
  date: string;
  sizeBytes: number;
  sha256: string;
  /** The changelog's summary, plain text. No Spanish: es/details/ shows the English. None at all: no New in line. */
  summary: { en: string; es: string | null } | null;
}

export interface Site {
  /** Absolute, with a trailing slash: https://monsieurbelbo.github.io/instapost/ */
  baseUrl: string;
  repo: string;
}

type PageName = 'main' | 'details';

/** The release's zip under its own name, and the name that stays put, so HTML cached across a release can't 404. */
export const zipName = (label: string): string => `instapost-${label}.zip`;
export const LATEST_ZIP = 'instapost-latest.zip';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const formatSize = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

const CSP =
  "default-src 'none'; img-src 'self'; style-src 'self'; font-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'";

/** The mark (entrypoints/composer/icons.tsx). `.r` is the ring, filled with what's behind it through --mark-bg. */
const mark = (): string =>
  `<svg class="mark" viewBox="4 0.6 16.6 21.9" aria-hidden="true"><g class="m"><rect x="5.25" y="2.75" width="13.5" height="18.5" rx="3.75"/><path d="M12 16V9.2M9.2 11.8 12 9l2.8 2.8"/></g><circle cx="18.4" cy="4.6" r="4" class="r"/><circle cx="18.4" cy="4.6" r="3" class="d"/></svg>`;

const arrowDown =
  '<svg class="down" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.5v11M4.5 9.5 9 14l4.5-4.5"/></svg>';

const folderIcon =
  '<svg class="folder" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6l2.2 2.5h7.2A2.5 2.5 0 0 1 21 10v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.500z"/></svg>';

/** A big line's closing full stop becomes the mark's round dot. It stays a real "." to copy and to read out. */
const dotted = (line: string): string => line.replace(/\.$/, '<b class="stop">.</b>');
const lines = (all: readonly string[]): string => all.map((l) => `<span class="l">${dotted(l)}</span>`).join(' ');

/** Each page's address, from the site's root: the same page in both languages, so hreflang and the language link agree. */
const pathOf = (lang: Copy['lang'], name: PageName): string =>
  `${lang === 'es' ? 'es/' : ''}${name === 'details' ? 'details/' : ''}`;
const rootOf = (lang: Copy['lang'], name: PageName): string => '../'.repeat(pathOf(lang, name).split('/').length - 1);

function head(c: Copy, site: Site, name: PageName): string {
  const root = rootOf(c.lang, name);
  const url = site.baseUrl + pathOf(c.lang, name);
  const [title, description] = name === 'main' ? [c.title, c.description] : [c.details.title, c.details.description];
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#efefef">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#161616">
<title>${title}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="alternate" hreflang="en" href="${site.baseUrl}${pathOf('en', name)}">
<link rel="alternate" hreflang="es" href="${site.baseUrl}${pathOf('es', name)}">
<link rel="alternate" hreflang="x-default" href="${site.baseUrl}${pathOf('en', name)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="instapost">
<meta property="og:locale" content="${c.locale}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
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
<link rel="stylesheet" href="${root}style.css">${name === 'main' ? `\n<script src="${root}copy.js" defer></script>` : ''}
</head>`;
}

const langLink = (c: Copy, name: PageName): string =>
  `<nav class="lang"><a href="${rootOf(c.lang, name)}${pathOf(c.otherLang.hreflang, name)}" hreflang="${c.otherLang.hreflang}" lang="${c.otherLang.hreflang}">${c.otherLang.label}</a></nav>`;

function hero(c: Copy, r: Release | null, root: string): string {
  const fill = (s: string): string =>
    r ? s.replace('{v}', () => esc(r.label)).replace('{size}', () => esc(formatSize(r.sizeBytes))) : s;
  const get = r
    ? `<a class="dl" href="${root}downloads/${LATEST_ZIP}" download="${esc(zipName(r.label))}"><span class="dl-text"><span class="dl-what">${fill(c.download)}</span> <span class="dl-meta">${fill(c.downloadMeta)}${r.prerelease ? ` ${c.prerelease}` : ''}</span></span>${arrowDown}</a>`
    : `<p class="dl is-off">${c.noRelease}</p>`;
  return `<section class="hero grid">
  <div class="card">
    <div class="card-inner">
      <p class="brand">${mark()}instapost</p>
      <h1>${lines(c.h1)}</h1>
      <p class="sub">${c.sub}</p>
      <p class="kind">${c.kind}</p>
      <p class="phone">${c.phone}</p>
      ${get}
      <p class="risk">${c.risk}</p>
    </div>
    <span class="dot" aria-hidden="true"></span>
  </div>

  <figure class="scene">
    <div class="window">
      <div class="bar" aria-hidden="true"><span>instagram.com</span></div>
      <div class="inner">
        <div class="nav" aria-hidden="true">
          <i class="logo"></i><i></i><i></i><i></i><i></i><i></i><i></i><i class="round"></i>
          <span class="entry">${mark()}<span>${c.entry}</span></span>
          <i class="last"></i>
        </div>
        <div class="room">
          <div class="shot">
            <picture>
              <source srcset="${root}assets/composer-${c.lang}-dark.webp" media="(prefers-color-scheme: dark)">
              <img src="${root}assets/composer-${c.lang}-light.webp" width="1392" height="1354" fetchpriority="high" alt="${esc(c.shotAlt)}">
            </picture>
            <b class="press" aria-hidden="true"></b>
          </div>
        </div>
      </div>
    </div>
    <figcaption>${c.caption}</figcaption>
  </figure>
</section>`;
}

/** Three story frames: what it's for, a real post landing, a real repost. The stage pictures have no theme. */
function reel(c: Copy, root: string): string {
  const frame = (src: string, alt: string, caption: string): string =>
    `<figure class="story">
    <div class="frame"><img src="${root}assets/${src}" width="712" height="1264" loading="lazy" alt="${esc(alt)}"></div>
    <figcaption>${caption}</figcaption>
  </figure>`;
  return `<section class="reel">
  <p class="frame says">${mark()}<span class="says-text">${lines(c.statement)}</span></p>
  ${frame(`stage-posted-${c.lang}.webp`, c.postingAlt, c.posting)}
  ${frame('stage-repost.webp', c.repostAlt, c.repost)}
</section>`;
}

function install(c: Copy, r: Release | null): string {
  const [s1, s2, s3, s4, s5] = c.steps;
  const zip = esc(r ? zipName(r.label) : 'instapost.zip');
  const copyRow = (browser: string, address: string): string =>
    `<div class="addr"><span class="who">${browser}</span><code>${address}</code><button class="copy" type="button" hidden data-copy="${address}" data-done="${c.copied}" data-fail="${c.copyFail}" aria-label="${c.copy} ${address}">${c.copy}</button></div>`;
  return `<section class="install">
  <h2>${dotted(c.installHead)}</h2>
  <ol class="steps">
    <li class="step">
      <p>${s1}</p>
      <div class="well files" aria-hidden="true"><code>${zip}</code><span class="then"></span><span class="fold">${folderIcon}<b>${c.wellFolder}</b></span></div>
    </li>
    <li class="step">
      <p>${s2}</p>
      <div class="well urls">${copyRow(c.browserChrome, 'chrome://extensions')}${copyRow(c.browserArc, 'arc://extensions')}</div>
    </li>
    <li class="step">
      <p>${s3}</p>
      <div class="well toggle" aria-hidden="true"><span>${c.wellDev}</span><i></i></div>
    </li>
    <li class="step">
      <p>${s4}</p>
      <div class="well load"><span class="chip" aria-hidden="true">${c.wellLoad}</span><span class="tree"><b>${c.wellFolder}</b><br><code>manifest.json</code></span></div>
    </li>
    <li class="step">
      <p>${s5}</p>
      <div class="well row-well" aria-hidden="true"><i></i><span class="entry">${mark()}<span>${c.entry}</span></span></div>
    </li>
  </ol>
</section>`;
}

/** Every internal link is relative to the page's own folder, so the site works under /instapost/. */
export function renderPage(c: Copy, r: Release | null, site: Site): string {
  const root = rootOf(c.lang, 'main');
  return `<!doctype html>
<html lang="${c.lang}">
${head(c, site, 'main')}
<body>
${langLink(c, 'main')}
<main>
${hero(c, r, root)}
${reel(c, root)}
${install(c, r)}
<section class="limits">
  <p class="line">${c.line}</p>
  <a class="more" href="details/">${c.detailsLink}</a>
</section>
</main>
<footer class="foot">
  <p class="foot-brand">${mark()}instapost</p>
  <a class="foot-source" href="${site.repo}">${c.source}</a>
  <p class="legal">${c.legal}</p>
</footer>
</body>
</html>
`;
}

const topic = (s: Section): string =>
  `<section class="topic">
  <h2>${s.title}</h2>
  <ul>${s.items.map((i) => `<li>${i}</li>`).join('')}</ul>
</section>`;

/** What's specific to this release: no release, no section, and the source stays in the footer. */
function thisVersion(c: Copy, r: Release | null, site: Site): string {
  if (!r) return '';
  const label = esc(r.label);
  const tag = `${site.repo}/releases/tag/v${label}`;
  const summary = r.summary
    ? `<strong>${c.details.newIn.replace('{v}', () => label)}</strong> <span${
        c.lang === 'es' && !r.summary.es ? ' lang="en"' : ''
      }>${esc((c.lang === 'es' && r.summary.es) || r.summary.en)}</span> `
    : '';
  return topic({
    title: c.details.versionHead,
    items: [
      `${summary}<a href="${tag}">${c.details.allChanges}</a>`,
      `SHA-256: <code class="sha">${esc(r.sha256)}</code>`,
      `<code>shasum -a 256 ${esc(zipName(r.label))}</code>`,
    ],
  });
}

/** One plain page for the careful: headings and short bullets, no card. */
export function renderDetails(c: Copy, r: Release | null, site: Site): string {
  const root = rootOf(c.lang, 'details');
  const d = c.details;
  const f = d.foot;
  return `<!doctype html>
<html lang="${c.lang}">
${head(c, site, 'details')}
<body class="doc">
${langLink(c, 'details')}
<header class="doc-top"><a class="foot-brand" href="../">${mark()}instapost</a></header>
<main>
<h1>${dotted(d.head)}</h1>
${[d.limits, d.reposts, d.risk, d.tried, d.data, d.permissions, d.updating].map(topic).join('\n')}
${thisVersion(c, r, site)}
${topic(d.pictures)}
</main>
<footer class="foot foot-full">
  <p class="foot-brand">${mark()}instapost</p>
  <div class="foot-text">
    <p class="foot-links">
      <a href="${site.repo}">${c.source}</a>
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
</footer>
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
<h1>${dotted(en.notFound.head)}</h1>
<p>${en.notFound.body} <a href="${path}">${en.notFound.link}</a></p>
<p lang="es">${es.notFound.head} ${es.notFound.body} <a href="${path}es/">${es.notFound.link}</a></p>
</main>
</body>
</html>
`;
}
