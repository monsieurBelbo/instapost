/**
 * How the result is decided (ux.md §6, strategy §11 AM40; docs/contract.md C12, C13): from Instagram's own
 * upload and publish requests, as the agent's resource-timing observer saw them, never from a question.
 * Against the fake's real-shaped endpoints, which answer as their knobs say.
 *
 * | Id  | Case | Expected |
 * |-----|------|----------|
 * | E32 | live, the fast cases of the outcome matrix | configure 400 → UPLOAD_FAILED; 500, reset, html200, redirectLogin → OUTCOME_UNKNOWN, never Posted; rupload 500, cors → UPLOAD_FAILED; `tray=throw` (no navigation home) → Posted |
 * | E35 | the Share control | `fb=auto` after a delay: re-queried, v2 with the Facebook badge recorded, `share_to_facebook=true`, the result line; `shareControl=missing|two` → SHARE_MISSING, nothing pressed, Share it myself offered |
 * | E37 | `rtClear=on` while a slow upload runs | still decided correctly: Instagram clearing its resource-timing buffer hides nothing from the observer |
 * | E38 | a security check after a published story | Posted, and the kill switch's lock; both shown |
 *
 * The hang and slow cases of O5/O6 are covered by U18/U19 with the guarded budget scale; the mock build
 * blocks every upload, so the matrix runs on the live artifact (mock: E31).
 */
import type { ConfigureKnob, RuploadKnob } from '../../tools/fake-ig/knobs.ts';
import { expect, test, whenClosed } from './fixtures.ts';
import {
  detailRow,
  lastRecord,
  loadPhoto,
  photoFile,
  postStory,
  resultAction,
  waitResult,
} from './helpers/editor-flow.ts';

const liveOnly = 'a guarded build blocks every upload, so its posts are Share tests (E31)';

const CASES: Array<{
  name: string;
  knobs: { configure?: ConfigureKnob; rupload?: RuploadKnob; tray?: 'ok' | 'fail' | 'throw' };
  kind: 'posted' | 'notPosted' | 'unknown';
  code: '' | 'UPLOAD_FAILED' | 'OUTCOME_UNKNOWN';
  why?: string;
  stories: number;
}> = [
  { name: 'configure 400', knobs: { configure: '400' }, kind: 'notPosted', code: 'UPLOAD_FAILED', stories: 0 },
  {
    name: 'configure 500',
    knobs: { configure: '500' },
    kind: 'unknown',
    code: 'OUTCOME_UNKNOWN',
    why: 'configure-5xx',
    stories: 0,
  },
  {
    name: 'configure reset',
    knobs: { configure: 'reset' },
    kind: 'unknown',
    code: 'OUTCOME_UNKNOWN',
    why: 'configure-0',
    stories: 1,
  },
  {
    name: 'configure html200',
    knobs: { configure: 'html200' },
    kind: 'unknown',
    code: 'OUTCOME_UNKNOWN',
    why: 'configure-html',
    stories: 0,
  },
  {
    name: 'configure redirectLogin',
    knobs: { configure: 'redirectLogin' },
    kind: 'unknown',
    code: 'OUTCOME_UNKNOWN',
    why: 'redirected',
    stories: 0,
  },
  { name: 'rupload 500', knobs: { rupload: '500' }, kind: 'notPosted', code: 'UPLOAD_FAILED', stories: 0 },
  { name: 'rupload cors', knobs: { rupload: 'cors' }, kind: 'notPosted', code: 'UPLOAD_FAILED', stories: 0 },
  { name: 'tray throw', knobs: { tray: 'throw' }, kind: 'posted', code: '', stories: 1 },
];

for (const c of CASES) {
  test(`E32 ${c.name} → ${c.kind}${c.why ? ` (${c.why})` : ''}`, async ({
    context,
    extension,
    editor,
    composer,
    fake,
    handoffRecords,
  }, testInfo) => {
    test.skip(extension.mode !== 'live', liveOnly);
    await fake.setKnobs(c.knobs);
    const page = await editor();
    await loadPhoto(page, await photoFile(context, testInfo));
    await postStory(page);
    const popup = await composer();
    const card = await waitResult(page, c.kind, { code: c.code });
    if (c.kind !== 'posted') await expect(card).not.toContainText('Posted');
    // §5: after Share, "Nothing was posted" is never said.
    await expect(card).not.toContainText('Nothing was posted');
    if (c.kind === 'unknown') {
      await expect(card).toContainText('Couldn’t confirm the post');
      await expect(page.getByTestId('result-check-story')).toBeVisible();
    }
    if (c.kind === 'notPosted') {
      await expect(card).toContainText('Instagram didn’t accept the story');
      await expect(resultAction(page, 'tryAgain')).toBeVisible();
    }
    await whenClosed(popup);
    // Server truth matches what the result claims or leaves open (a reset publish may have created the story).
    expect(await fake.stories()).toHaveLength(c.stories);
    if (c.knobs.configure) {
      // The page sent one publish request and the agent saw one entry. On a reset, Chrome itself may resend
      // the POST on a new connection (the fake answers a repeated upload id with the same story).
      const rec0 = await lastRecord(handoffRecords);
      expect(rec0.evidence?.net.filter((e) => e.path.includes('configure_to_story'))).toHaveLength(1);
      const sends = (await fake.writes()).filter((w) => w.path.startsWith('/api/v1/media/configure_to_story/'));
      testInfo.annotations.push({ type: 'configure sends', description: String(sends.length) });
      expect(sends.length).toBeGreaterThanOrEqual(1);
      if (c.knobs.configure !== 'reset') expect(sends).toHaveLength(1);
    }
    const rec = await lastRecord(handoffRecords);
    expect(rec.result?.kind).toBe(c.kind);
    if (c.why) expect(rec.result?.why).toBe(c.why);
    // instapost never retried: one upload; Instagram's own Retry was never tapped.
    expect((await fake.uploads()).length).toBe(1);
    const steps = (await fake.log()).map((l) => l.step);
    expect(steps.filter((s) => s === 'tap:share')).toHaveLength(1);
    expect(steps).not.toContain('tap:retry');
    if (c.knobs.tray === 'throw') {
      // Instagram never went home: the result did not need it (O1).
      expect(rec.evidence?.ui.wentHomeAt ?? null).toBeNull();
    }
  });
}

test('E35 (a) fb=auto after 800 ms: the footer switches to v2 with the badge; recorded; share_to_facebook=true', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ fb: 'auto', fbDelayMs: 800 });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  await whenClosed(await composer());
  const card = await waitResult(page, extension.mode === 'live' ? 'posted' : 'shareTested');
  const rec = await lastRecord(handoffRecords);
  // The compose watch waited for the footer to settle after the v1 → v2 switch.
  expect(rec.compose).toMatchObject({ variant: 'v2', fbAuto: true, controls: 1, settled: true });
  expect(rec.result?.facebook).toBe(true);
  await expect(await detailRow(page, 'share-control')).toContainText('v2');
  if (extension.mode === 'live') {
    await expect(card).toContainText('Also shared to Facebook');
    const [story] = await fake.stories();
    expect(story?.shareToFacebook).toBe(true);
    expect(story?.meta).toMatchObject({ variant: 'v2', fbAuto: true });
  }
});

for (const control of ['missing', 'two'] as const) {
  test(`E35 shareControl=${control}: SHARE_MISSING, nothing pressed; Share it myself offered`, async ({
    context,
    editor,
    composer,
    fake,
    handoffRecords,
  }, testInfo) => {
    await fake.setKnobs({ shareControl: control });
    const page = await editor();
    await loadPhoto(page, await photoFile(context, testInfo));
    await postStory(page);
    const popup = await composer();
    const card = await waitResult(page, 'notPosted', { code: 'SHARE_MISSING' });
    await expect(card).toContainText('Nothing was posted');
    await expect(card).toHaveAttribute('data-held', 'offerManual');
    await expect(resultAction(page, 'shareItMyself')).toBeVisible();
    const steps = (await fake.log()).map((l) => l.step);
    expect(steps).not.toContain('tap:share');
    expect(await fake.uploads()).toEqual([]);
    const rec = await lastRecord(handoffRecords);
    expect(rec.compose?.controls).toBe(control === 'missing' ? 0 : 2);
    await page.getByTestId('result-done').click();
    await whenClosed(popup);
  });
}

test('E37 rtClear=on while a slow upload runs: Instagram clearing its timing buffer hides nothing; Posted', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  test.skip(extension.mode !== 'live', liveOnly);
  // The buffer is cleared every 2 s: at least once while the 2.5 s upload runs.
  await fake.setKnobs({ rtClear: 'on', rupload: 'slow:2500' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  await whenClosed(await composer());
  await waitResult(page, 'posted');
  const rec = await lastRecord(handoffRecords);
  const upload = rec.evidence?.net.find((e) => e.host === 'i');
  expect(upload).toMatchObject({ status: 200 });
  expect((upload?.end ?? 0) - (upload?.start ?? 0)).toBeGreaterThanOrEqual(2000);
  expect(await fake.stories()).toHaveLength(1);
});

test('E38 a security check after a published story: Posted stays Posted, and desktop posting is paused', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  handoffRecords,
  storedSettings,
  tripwire,
}, testInfo) => {
  test.skip(extension.mode !== 'live', liveOnly);
  void tripwire;
  await fake.setKnobs({ challenge: 'afterShare' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  await whenClosed(await composer());
  const card = await waitResult(page, 'posted');
  await expect(card).toContainText('Posted to @');
  await expect(card).toContainText('paused desktop posting for 7 days');
  await expect(card).toContainText('Your story was posted before the check.');
  await expect(page.getByTestId('pause-banner')).toBeVisible();
  // AP-12: the banner names the security check, and nothing about a test story.
  await expect(page.getByTestId('pause-banner')).toContainText('Instagram asked for a security check');
  await expect(page.getByTestId('pause-banner')).not.toContainText('test story');
  const rec = await lastRecord(handoffRecords);
  expect(rec.result).toMatchObject({ kind: 'posted', killed: 'KILLED_CHALLENGE' });
  expect(rec.outcome).toBe('posted');
  expect((await storedSettings())?.msiteLockedUntil ?? 0).toBeGreaterThan(Date.now());
  expect(await fake.stories()).toHaveLength(1);
});
