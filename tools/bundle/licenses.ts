/**
 * RL-3 (strategy R30): the third-party licences every build ships. The HEIC worker carries libheif-js 1.23.2
 * (libheif 1.23.2 with the libde265 1.0.15 HEVC decoder, both LGPL-3.0) as separate, unmodified files: its wasm
 * (`assets/libheif-*.wasm`) and its JavaScript glue inside `assets/heic.worker-*.js`. Conveying that object code
 * needs the LGPL text, the GPL text it incorporates, and a pointer to the source: wxt.config.ts adds both files
 * under `licenses/` (not web-accessible), check-bundle fails a build whose libheif wasm ships without them, and
 * `pnpm run package` checks the staged folder again.
 */

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

/** The third-party notice (licenses/THIRD-PARTY.txt). */
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
`;
}

/** libheif's wasm in a build (assets/libheif-*.wasm). */
export const LIBHEIF_WASM = /^assets\/libheif-[\w-]+\.wasm$/;

/**
 * What is wrong with a build's licences: when it ships libheif's wasm, both licence files must be there, the
 * libheif file must hold the LGPL-3.0 and GPL-3.0 texts, and the notice must name both libraries and their source.
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
  }
  return problems;
}
