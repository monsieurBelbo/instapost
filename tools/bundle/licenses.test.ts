/**
 * RL-3: a build that ships libheif's wasm ships its licences (LGPL-3.0 with the GPL-3.0 it incorporates) and a
 * notice naming libheif and libde265 with their source; the licence file the build copies is the real one.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIBHEIF_LICENSE_SOURCE, LICENSE_FILES, licenseProblems, thirdPartyNotice } from './licenses.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const LICENSE = readFileSync(`${ROOT}${LIBHEIF_LICENSE_SOURCE}`, 'utf8');
const WASM = 'assets/libheif-abc123.wasm';

describe('RL-3 third-party licences', () => {
  it('the source licence file holds both texts, and a complete build passes', () => {
    const files = [WASM, LICENSE_FILES.notice, LICENSE_FILES.libheif];
    const read = (f: string) => (f === LICENSE_FILES.notice ? thirdPartyNotice() : LICENSE);
    expect(licenseProblems(files, read)).toEqual([]);
  });

  it('libheif without its licences fails; a build without libheif needs none', () => {
    expect(licenseProblems([WASM], () => '')).toEqual([
      `${LICENSE_FILES.notice} missing (libheif ships)`,
      `${LICENSE_FILES.libheif} missing (libheif ships)`,
    ]);
    expect(licenseProblems([WASM, LICENSE_FILES.notice, LICENSE_FILES.libheif], () => 'MIT')).toHaveLength(7);
    expect(licenseProblems(['background.js'], () => '')).toEqual([]);
  });
});
