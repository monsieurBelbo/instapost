/**
 * E1, E2 (strategy §7.11, SG1, SG10, S10): the browser is sealed and the right artifact is loaded.
 */
import { type ExtGlobal, expect, IG_ORIGIN, test } from './fixtures.ts';
import { MANIFEST_NAMES } from './helpers/artifacts.ts';

/** Hosts that must never resolve in a sealed browser (E1). */
const OUTSIDE = [
  'https://www.facebook.com/',
  'https://static.cdninstagram.com/',
  'https://graph.instagram.com/',
  'https://example.com/',
];

test('E1 @smoke the network is sealed; the fake loads with no interstitial or prompt', async ({
  context,
  tripwire,
}) => {
  // These probes leave the sealed hosts on purpose; the tripwire counts every other such request.
  for (const url of OUTSIDE) tripwire.expectOutside(url);
  tripwire.expectOutside('https://graph.instagram.com/');
  // A failed navigation commits an error page later, so each one gets its own page.
  for (const url of OUTSIDE) {
    const error = await (await context.newPage()).goto(url).then(
      () => 'loaded',
      (err: Error) => err.message,
    );
    expect(error, url).toContain('net::ERR_NAME_NOT_RESOLVED');
  }
  // A page fetch to an unmapped host fails the same way.
  const page = await context.newPage();
  await page.goto(`${IG_ORIGIN}/__fake__/health`);
  const fetchOutside = await page.evaluate(() =>
    fetch('https://graph.instagram.com/', { mode: 'no-cors' }).then(
      () => 'reached',
      (err: Error) => err.name,
    ),
  );
  expect(fetchOutside).toBe('TypeError');

  const res = await page.goto(`${IG_ORIGIN}/__fake__/health`);
  expect(res?.status()).toBe(200);
  expect(await res?.json()).toMatchObject({ ok: true, fake: true });
  // No interstitial: the document is the fake's JSON, served under the fake's own certificate.
  expect((await res?.securityDetails())?.subjectName).toBe('instapost fake instagram');
  expect(page.url()).toBe(`${IG_ORIGIN}/__fake__/health`);
  // No Local Network Access prompt was ever requested (S3): the permission is still untouched.
  const lna = await page.evaluate(async () => {
    try {
      return (await navigator.permissions.query({ name: 'local-network-access' as PermissionName })).state;
    } catch {
      return 'unsupported';
    }
  });
  expect(['prompt', 'unsupported']).toContain(lna);
});

test('E2 @smoke the extension service worker is up with the key-derived id and its mode name', async ({
  extension,
}) => {
  // The fixture already asserted id and name; repeat them here so E2 states its own claim.
  expect(extension.sw.url()).toBe(`chrome-extension://${extension.id}/background.js`);
  const manifest = await extension.sw.evaluate(() => (globalThis as ExtGlobal).chrome.runtime.getManifest());
  expect(manifest.name).toBe(MANIFEST_NAMES[extension.mode]);
  expect(manifest.minimum_chrome_version).toBe('155');
  const { extIdForMode } = await import('../../tools/chrome/ext-id.ts');
  expect(extension.id).toBe(extIdForMode(extension.mode));
  // AM23: sealed browsers report no branded brand, so guarded builds hand off here (and refuse in
  // a branded profile before any window opens).
  const brands = await extension.sw.evaluate(
    () =>
      (navigator as unknown as { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands.map(
        (b) => b.brand,
      ) ?? [],
  );
  expect(brands).toContain('Chromium');
  const { isBrandedBrowser } = await import('../../src/core/ig-contract/device-profile.ts');
  expect(isBrandedBrowser(brands), brands.join(', ')).toBe(false);
});
