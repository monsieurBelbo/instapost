/**
 * RL-3: a build that ships libheif's wasm ships its licences (LGPL-3.0 with the GPL-3.0 it incorporates) and a
 * notice naming libheif and libde265 with their source; the licence file the build copies is the real one.
 * The notice also carries, word for word, the licence of every package bundled into instapost's scripts, and a new
 * dependency, or a new import of a devDependency's code, fails here until it is listed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUNDLED_PACKAGES,
  LIBHEIF_LICENSE_SOURCE,
  LICENSE_FILES,
  licenseProblems,
  packageDir,
  thirdPartyNotice,
} from './licenses.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const LICENSE = readFileSync(`${ROOT}${LIBHEIF_LICENSE_SOURCE}`, 'utf8');
const WASM = 'assets/libheif-abc123.wasm';
/** An import's specifier, WXT's own `#imports` included: `imports: false` in wxt.config.ts doesn't stop it resolving. */
const IMPORT_SPEC = /(?:from|import)\s*\(?'([@#\w][^']*)'/g;

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
    expect(licenseProblems([WASM, LICENSE_FILES.notice, LICENSE_FILES.libheif], () => 'MIT')).toHaveLength(
      7 + BUNDLED_PACKAGES.length,
    );
    expect(licenseProblems(['background.js'], () => '')).toEqual([]);
  });
});

describe('the notice covers the JavaScript instapost bundles', () => {
  const pkg = (dir: string) =>
    JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      version: string;
      license: string;
      dependencies?: Record<string, string>;
    };

  it('holds each package’s real licence text, version and source', () => {
    const notice = thirdPartyNotice();
    for (const p of BUNDLED_PACKAGES) {
      const dir = packageDir(p.name, p.via);
      const license = p.text ?? readFileSync(join(dir, 'LICENSE'), 'utf8');
      expect(license, p.name).toContain(p.copyright);
      expect(notice, p.name).toContain(license.trim());
      expect(pkg(dir).license, p.name).toBe(p.license);
      expect(notice, p.name).toContain(`--- ${p.name} ${pkg(dir).version} (${p.license}, ${p.source}) ---`);
    }
  });

  it('every package.json dependency, direct or not, is listed (libheif-js has its own section)', () => {
    const listed = new Set(['libheif-js', ...BUNDLED_PACKAGES.map((p) => p.name)]);
    const seen = new Set<string>();
    const walk = (dir: string) => {
      for (const name of Object.keys(pkg(dir).dependencies ?? {})) {
        if (seen.has(name)) continue;
        seen.add(name);
        const up = dir.slice(0, dir.lastIndexOf('/node_modules/') + '/node_modules/'.length);
        walk(dir === ROOT ? packageDir(name) : join(up, name));
      }
    };
    walk(ROOT);
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect([...seen].filter((name) => !listed.has(name))).toEqual([]);
  });

  it('what src and entrypoints import is listed too, which the walk above can’t see: wxt is a devDependency', () => {
    const listed = new Set(['libheif-js', ...BUNDLED_PACKAGES.map((p) => p.name)]);
    const WXT_HELPERS = /^wxt\/(browser|utils\/define-(background|unlisted-script))$/;
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const path = join(dir, e.name);
        if (e.isDirectory()) return sources(path);
        return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
      });
    const unlisted = ['src', 'entrypoints'].flatMap((dir) =>
      sources(join(ROOT, dir)).flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(IMPORT_SPEC)]
          .map((m) => m[1] ?? '')
          .filter((spec) => {
            const name = spec
              .split('/')
              .slice(0, spec.startsWith('@') ? 2 : 1)
              .join('/');
            return name === 'wxt' ? !WXT_HELPERS.test(spec) : !listed.has(name);
          })
          .map((spec) => `${file.slice(ROOT.length)}: ${spec}`),
      ),
    );
    expect(unlisted).toEqual([]);
  });

  it('the import scan sees every form: static, dynamic and #imports', () => {
    const source = "import { storage } from '#imports';\nimport 'idb';\nawait import('@preact/signals');\n";
    expect([...source.matchAll(IMPORT_SPEC)].map((m) => m[1])).toEqual(['#imports', 'idb', '@preact/signals']);
  });

  it('a notice without one of them is refused', () => {
    const files = [WASM, LICENSE_FILES.notice, LICENSE_FILES.libheif];
    const without = (name: string) => (f: string) =>
      f === LICENSE_FILES.notice ? thirdPartyNotice().replace(`--- ${name} `, '--- ') : LICENSE;
    expect(licenseProblems(files, without('idb'))).toEqual([`${LICENSE_FILES.notice}: does not carry idb's licence`]);
    expect(licenseProblems(files, without('@preact/signals'))).toEqual([
      `${LICENSE_FILES.notice}: does not carry @preact/signals's licence`,
    ]);
  });
});
