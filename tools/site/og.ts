/**
 * One-off: paints the sharing images and the icons (site/assets/og-{en,es}.png, icon-{32,180}.png), which are committed.
 * Run it again only when og.html, the mark or the wording changes:
 *
 *   node tools/site/og.ts [outDir]
 *
 * A plain browser reading local files, with name resolution off, so it can't reach anything. They carry no version, so
 * they don't go stale with a release.
 */
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const out = resolve(process.argv[2] ?? here('../../site/assets'));

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
for (const lang of ['en', 'es']) {
  await page.goto(`${pathToFileURL(here('og.html')).href}#${lang}`);
  await page.reload();
  await page.evaluate(() => document.fonts.load('600 112px "Instrument Sans"').then(() => document.fonts.ready));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/og-${lang}.png` });
}
for (const size of [32, 180]) {
  const icon = await (await browser.newContext({ viewport: { width: size, height: size } })).newPage();
  await icon.goto(pathToFileURL(here('../../site/assets/mark-tile.svg')).href);
  await icon.evaluate((s) => {
    document.documentElement.setAttribute('width', String(s));
    document.documentElement.setAttribute('height', String(s));
  }, size);
  await icon.screenshot({ path: `${out}/icon-${size}.png`, omitBackground: true });
}
await browser.close();
