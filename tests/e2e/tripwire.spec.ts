/**
 * E11 (strategy §7.11, SG6): the invariants catch an untrusted Share. A Share clicked from page
 * script (`HTMLElement.click()`, so `isTrusted: false`) must appear in `fake.violations()`, and
 * the fixture's invariant check, the one every test runs at teardown, must throw on it. The test
 * then opts out of that one check so its own teardown passes.
 *
 * E17 (§11 AM26, FID-3): the tripwire counts every request outside the sealed hosts, even one
 * that failed with ERR_NAME_NOT_RESOLVED, and every request the extension itself makes to a web
 * URL (SG11), unless the test declared it.
 * E18 (§11 AM26, FID-2): any fake control clicked from page script (+, Story, Close, …) is an
 * UNTRUSTED_CONTROL violation, so an agent that "helped" by clicking would fail every test.
 */
import { expect, IG_ORIGIN, test } from './fixtures.ts';
import { loadPhoto, photoFile, postFromDesktop, setSwitches, waitPhase, waitSeen } from './helpers/editor-flow.ts';

test('E11 an untrusted Share appears in fake.violations() and the invariant check throws', async ({
  context,
  editor,
  composer,
  fake,
  invariants,
}, testInfo) => {
  const page = await editor();
  await setSwitches(page, { assisted: true });
  await loadPhoto(page, await photoFile(context, testInfo));
  await postFromDesktop(page);
  const popup = await composer();
  await waitPhase(page, 'awaitingShare');

  // Before the bad click the invariants hold.
  await invariants.check();
  await popup.evaluate(() => {
    const share = document.querySelector<HTMLButtonElement>('[data-testid="fake-share"]');
    if (!share) throw new Error('no Share button');
    share.click();
  });
  await expect.poll(async () => (await fake.violations()).length).toBe(1);
  const [violation] = await fake.violations();
  expect(violation?.kind).toBe('UNTRUSTED_SHARE');
  const [story] = await fake.stories();
  expect(story?.isTrusted).toBe(false);
  expect(violation?.storyId).toBe(story?.id);

  await expect(invariants.check()).rejects.toThrow(/fake violations: .*UNTRUSTED_SHARE/);
  invariants.allowViolations();
  // The session itself still ends normally (C9 after the recorded Share).
  await waitSeen(page, 'finished');
  await waitPhase(page, 'idle');
});

test('E17 the tripwire flags undeclared requests outside the seal, and any request the extension makes itself', async ({
  context,
  extension,
  tripwire,
  invariants,
}) => {
  await invariants.check();
  // A page fetch to an unmapped host never leaves the machine (NXDOMAIN), but it still counts.
  const page = await context.newPage();
  await page.goto(`${IG_ORIGIN}/__fake__/health`);
  await page.evaluate(() => fetch('https://graph.instagram.com/e17', { mode: 'no-cors' }).catch(() => undefined));
  await expect.poll(() => tripwire.leaks()).toContain('outside: https://graph.instagram.com/e17');
  await expect(invariants.check()).rejects.toThrow(/undeclared requests/);
  tripwire.expectOutside('https://graph.instagram.com/e17');

  // The extension's own service worker requesting Instagram (SG11), even a sealed host.
  const url = `${IG_ORIGIN}/__fake__/health?e17=sw`;
  await extension.sw.evaluate(
    (u) =>
      fetch(u).then(
        () => undefined,
        () => undefined,
      ),
    url,
  );
  await expect
    .poll(() => tripwire.leaks().some((l) => l.startsWith('from the extension') && l.endsWith(url)))
    .toBe(true);
  tripwire.expectFromExtension(url);
  expect(tripwire.leaks()).toEqual([]);
  await invariants.check();
});

test('E18 a fake control clicked from page script is an UNTRUSTED_CONTROL violation', async ({
  context,
  fake,
  invariants,
}) => {
  const page = await context.newPage();
  await page.goto(`${IG_ORIGIN}/`);
  await page.locator('[data-testid="fake-create"]').waitFor();
  // A trusted tap is fine.
  await page.locator('[data-testid="fake-create"]').click();
  await page.waitForTimeout(300);
  expect(await fake.violations()).toEqual([]);
  // The same control clicked from script, as an agent "helping" with + → Story would.
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-testid="fake-create"]')?.click());
  await expect.poll(async () => (await fake.violations()).map((v) => v.kind)).toEqual(['UNTRUSTED_CONTROL']);
  expect((await fake.violations())[0]).toMatchObject({ storyId: null, detail: expect.stringContaining('create') });
  await expect(invariants.check()).rejects.toThrow(/UNTRUSTED_CONTROL/);
  invariants.allowViolations();
});
