/**
 * The test tripwires themselves (strategy §7.11, SG6 as amended by AM39; ux.md IF9).
 *
 * | Id  | Case | Expected |
 * |-----|------|----------|
 * | E11 | mock: after the autopilot's one Share, page script clicks Share again, the "Upload failed." Retry and Save | DOUBLE_SHARE, RETRY_CLICKED and TAP_OUTSIDE_ALLOWLIST in `fake.violations()`; the invariant check throws; the run itself saw the second upload (DUPLICATE_UPLOAD) and still said nothing was posted |
 * | E17 | a page fetch to an unmapped host; a request from the extension's own worker | both counted by the tripwire unless declared (AM26) |
 * | E18 | a fake control clicked from page script | + (an allowed control) is fine; the menu's third item is TAP_OUTSIDE_ALLOWLIST |
 *
 * SG6 before AM39 made every untrusted Share a violation (UNTRUSTED_SHARE, UNTRUSTED_CONTROL). Since the
 * autopilot taps +, Story and Share itself, untrusted taps of those three are allowed (Post once, by trial);
 * what the fake flags is a second Share, a Retry from script and any other control clicked from script.
 */
import type { HandoffState } from '../../src/core/handoff/state.ts';
import { expect, IG_ORIGIN, test, whenClosed } from './fixtures.ts';
import { lastRecord, loadPhoto, photoFile, postStory, waitResult } from './helpers/editor-flow.ts';

test('E11 a second Share, a Retry and Save from page script are violations, and the invariant check throws', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffState,
  handoffRecords,
  invariants,
}, testInfo) => {
  test.skip(extension.mode !== 'mock', 'a guarded build blocks the upload, so the composer stays for the extra clicks');
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer();
  // The autopilot pressed Share once; its blocked upload brings Instagram's "Upload failed." toast.
  await expect
    .poll(async () => ((await handoffState()) as HandoffState | undefined)?.phase, { intervals: [50], timeout: 30_000 })
    .toBe('confirmingUpload');
  await popup.locator('[data-testid="fake-toast-action"]').waitFor({ timeout: 5000 });
  // Before the bad clicks the invariants hold.
  await invariants.check();

  await popup.evaluate(() => {
    const click = (id: string) => {
      const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!el) throw new Error(`no ${id}`);
      el.click();
    };
    click('fake-share');
    click('fake-toast-action');
    click('fake-save');
  });
  await expect
    .poll(async () => (await fake.violations()).map((v) => v.kind).sort())
    .toEqual(['DOUBLE_SHARE', 'RETRY_CLICKED', 'TAP_OUTSIDE_ALLOWLIST']);
  await expect(invariants.check()).rejects.toThrow(/fake violations: .*DOUBLE_SHARE/);
  invariants.allowViolations();

  // The run saw more than one upload after its Share: the duplicate alarm, and still nothing posted.
  const card = await waitResult(page, 'shareTested');
  await expect(card).not.toContainText('Posted');
  await whenClosed(popup);
  const rec = await lastRecord(handoffRecords);
  expect(rec.result?.alarms).toContain('DUPLICATE_UPLOAD');
  expect(rec.evidence?.net.filter((e) => e.path.startsWith('/rupload_igphoto/')).length).toBeGreaterThanOrEqual(2);
  expect(await fake.stories()).toEqual([]);
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

test('E18 a fake control outside the autopilot’s allow-list clicked from page script is TAP_OUTSIDE_ALLOWLIST', async ({
  context,
  fake,
  invariants,
}) => {
  // A normal tab gets the desktop shell: + opens Post / Reel.
  const page = await context.newPage();
  await page.goto(`${IG_ORIGIN}/`);
  await page.locator('[data-testid="fake-create"]').waitFor();
  // A trusted tap is fine, and so is + from script (the autopilot's own control, ux.md P2).
  await page.locator('[data-testid="fake-create"]').click();
  await page.locator('[data-testid="fake-create-reel"]').waitFor();
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="fake-create"]')?.click());
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="fake-create"]')?.click());
  await page.waitForTimeout(300);
  expect(await fake.violations()).toEqual([]);
  // A control the autopilot never taps, clicked from script, as an agent "helping" would.
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="fake-create-reel"]')?.click());
  await expect.poll(async () => (await fake.violations()).map((v) => v.kind)).toEqual(['TAP_OUTSIDE_ALLOWLIST']);
  expect((await fake.violations())[0]).toMatchObject({ storyId: null, detail: expect.stringContaining('menuExtra') });
  await expect(invariants.check()).rejects.toThrow(/TAP_OUTSIDE_ALLOWLIST/);
  invariants.allowViolations();
});
