/**
 * RL-3 (strategy R30): the third-party licences every build ships. The HEIC worker carries libheif-js 1.23.2
 * (libheif 1.23.2 with the libde265 1.0.15 HEVC decoder, both LGPL-3.0) as separate, unmodified files: its wasm
 * (`assets/libheif-*.wasm`) and its JavaScript glue inside `assets/heic.worker-*.js`. Conveying that object code
 * needs the LGPL text, the GPL text it incorporates, and a pointer to the source: wxt.config.ts adds both files
 * under `licenses/` (not web-accessible), check-bundle fails a build whose libheif wasm ships without them, and
 * `pnpm run package` checks the staged folder again.
 *
 * The same notice carries the licences of the JavaScript bundled into instapost's own scripts (BUNDLED_PACKAGES),
 * read from node_modules when the build runs, so the text and the version cannot drift. licenses.test.ts walks
 * package.json's `dependencies`, so a new one fails until it is listed here, and reads what src and entrypoints import,
 * which covers wxt and devDependencies (wxt.config.ts turns auto-imports off, so nothing arrives without an import);
 * check-bundle and the package step refuse a notice that lacks one.
 *
 * Imported before install by scripts/release-info.ts (through tools/package/text.ts): node built-ins only, and
 * node_modules is read only when thirdPartyNotice() is called.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Where the build gets libheif's licence file: libheif-js's copy, LGPL-3.0 followed by GPL-3.0 (and MIT). */
export const LIBHEIF_LICENSE_SOURCE = 'node_modules/libheif-js/libheif-wasm/LICENSE';
export const LICENSE_FILES = {
  notice: 'licenses/THIRD-PARTY.txt',
  libheif: 'licenses/libheif-LICENSE.txt',
} as const;

export const LIBHEIF_SOURCES = {
  libheif: 'https://github.com/strukturag/libheif',
  libde265: 'https://github.com/strukturag/libde265',
  libheifJs: 'https://github.com/catdad-experiments/libheif-js',
} as const;

/** WXT's npm packages carry no licence file; this is github.com/wxt-dev/wxt/blob/main/LICENSE, which both name. */
const WXT_LICENSE = `MIT License

Copyright (c) 2023 Aaron

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

interface BundledPackage {
  name: string;
  /** The direct dependency that brings it in, when pnpm keeps it out of the top-level node_modules. */
  via?: string;
  license: 'MIT' | 'ISC';
  source: string;
  /** The licence's copyright line, which the notice must carry. */
  copyright: string;
  /** The licence text, for a package that ships none (else its LICENSE file is read). */
  text?: string;
}

/**
 * The npm packages with code inside instapost's scripts, besides libheif-js above, as a source-map build lists them
 * (2026-11-05). WXT's part is its small browser shim and its define* helpers, a few hundred bytes.
 */
export const BUNDLED_PACKAGES: readonly BundledPackage[] = [
  {
    name: 'preact',
    license: 'MIT',
    source: 'https://github.com/preactjs/preact',
    copyright: 'Copyright (c) 2015-present Jason Miller',
  },
  {
    name: '@preact/signals',
    license: 'MIT',
    source: 'https://github.com/preactjs/signals',
    copyright: 'Copyright (c) 2022-present Preact Team',
  },
  {
    name: '@preact/signals-core',
    via: '@preact/signals',
    license: 'MIT',
    source: 'https://github.com/preactjs/signals',
    copyright: 'Copyright (c) 2022-present Preact Team',
  },
  {
    name: 'idb',
    license: 'ISC',
    source: 'https://github.com/jakearchibald/idb',
    copyright: 'Copyright (c) 2016, Jake Archibald',
  },
  {
    name: 'wxt',
    license: 'MIT',
    source: 'https://github.com/wxt-dev/wxt',
    copyright: 'Copyright (c) 2023 Aaron',
    text: WXT_LICENSE,
  },
  {
    name: '@wxt-dev/browser',
    via: 'wxt',
    license: 'MIT',
    source: 'https://github.com/wxt-dev/wxt',
    copyright: 'Copyright (c) 2023 Aaron',
    text: WXT_LICENSE,
  },
];

/** A package's folder in node_modules. A transitive one sits beside the package that brings it in. */
export function packageDir(name: string, via?: string): string {
  const direct = join(ROOT, 'node_modules', name);
  if (existsSync(direct)) return realpathSync(direct);
  if (!via) throw new Error(`${name} is not in node_modules`);
  const parent = packageDir(via);
  const mark = '/node_modules/';
  return join(parent.slice(0, parent.lastIndexOf(mark) + mark.length), name);
}

const blockHeading = (name: string) => `--- ${name} `;

function bundledBlock(p: BundledPackage): string {
  const dir = packageDir(p.name, p.via);
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string };
  const text = p.text ?? readFileSync(join(dir, 'LICENSE'), 'utf8');
  return `${blockHeading(p.name)}${version} (${p.license}, ${p.source}) ---\n\n${text.trim()}\n`;
}

/** The third-party notice (licenses/THIRD-PARTY.txt). Reads the bundled packages' licences from node_modules. */
export function thirdPartyNotice(): string {
  return `instapost — third-party software

HEIC/HEIF photos (from an iPhone) are converted in the browser with libheif,
compiled to WebAssembly by libheif-js 1.23.2: libheif 1.23.2 with the libde265
1.0.15 HEVC decoder.

  libheif     by struktur AG and contributors. GNU LGPL version 3.
              Source: ${LIBHEIF_SOURCES.libheif} (v1.23.2)
  libde265    by struktur AG and contributors. GNU LGPL version 3.
              Source: ${LIBHEIF_SOURCES.libde265} (v1.0.15)
  libheif-js  the Emscripten build of both.
              Source: ${LIBHEIF_SOURCES.libheifJs} (v1.23.2)

The GNU Lesser General Public License version 3 incorporates the GNU General
Public License version 3: both texts are in libheif-LICENSE.txt, next to this
file.

instapost uses these libraries unmodified, as separate files that you may
replace with your own build of libheif-js 1.23.2:
  assets/libheif-*.wasm      libheif and libde265, compiled
  assets/heic.worker-*.js    instapost's worker, with libheif-js's JavaScript
                             glue (libheif-wasm/libheif.js) inside

The font Instrument Sans is under the SIL Open Font License 1.1
(fonts/OFL.txt).

instapost's own scripts include the JavaScript libraries below, each with its
licence.

${BUNDLED_PACKAGES.map(bundledBlock).join('\n')}`;
}

/** libheif's wasm in a build (assets/libheif-*.wasm). */
export const LIBHEIF_WASM = /^assets\/libheif-[\w-]+\.wasm$/;

/**
 * What is wrong with a build's licences: when it ships libheif's wasm, both licence files must be there, the
 * libheif file must hold the LGPL-3.0 and GPL-3.0 texts, and the notice must name both libraries and their source,
 * and carry the licence of every bundled package.
 * `files` are the build's paths (relative, `/`-separated); `read` reads one of them.
 */
export function licenseProblems(files: readonly string[], read: (path: string) => string): string[] {
  if (!files.some((f) => LIBHEIF_WASM.test(f))) return [];
  const problems: string[] = [];
  for (const f of Object.values(LICENSE_FILES)) if (!files.includes(f)) problems.push(`${f} missing (libheif ships)`);
  if (files.includes(LICENSE_FILES.libheif)) {
    const text = read(LICENSE_FILES.libheif);
    if (!/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/.test(text))
      problems.push(`${LICENSE_FILES.libheif}: no LGPL-3.0 text`);
    if (!/GNU GENERAL PUBLIC LICENSE\s+Version 3/.test(text))
      problems.push(`${LICENSE_FILES.libheif}: no GPL-3.0 text`);
  }
  if (files.includes(LICENSE_FILES.notice)) {
    const text = read(LICENSE_FILES.notice);
    for (const want of ['libheif', 'libde265', 'LGPL', LIBHEIF_SOURCES.libheif, LIBHEIF_SOURCES.libde265]) {
      if (!text.includes(want)) problems.push(`${LICENSE_FILES.notice}: does not name ${want}`);
    }
    for (const p of BUNDLED_PACKAGES) {
      if (!text.includes(blockHeading(p.name)) || !text.includes(p.copyright)) {
        problems.push(`${LICENSE_FILES.notice}: does not carry ${p.name}'s licence`);
      }
    }
  }
  return problems;
}
