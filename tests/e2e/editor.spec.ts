/**
 * E3 (strategy §7.11, §7.10): the walking-skeleton editor end to end, inside the loaded artifact.
 */
import { writeFile } from 'node:fs/promises';
import { expect, test } from './fixtures.ts';
import { decodeSize, syntheticImage } from './helpers/psnr.ts';

interface XfAttr {
  cx: number;
  cy: number;
  scale: number;
  rotDeg: number;
}

test('E3 load a 4000x3000 JPEG, pan, zoom, add text, toggle safe zones, download a 1080x1920 JPEG', async ({
  context,
  editor,
  exportBytes,
  downloadsSearch,
}, testInfo) => {
  const src = testInfo.outputPath('photo-4000x3000.jpg');
  await writeFile(src, await syntheticImage(context, 4000, 3000, 'image/jpeg'));

  const page = await editor();
  const stage = page.getByTestId('editor-stage');
  const xf = async (): Promise<XfAttr> => JSON.parse((await stage.getAttribute('data-xf')) || 'null') as XfAttr;

  await page.getByTestId('editor-file-input').setInputFiles(src);
  await expect(stage).not.toHaveAttribute('data-asset-id', '');
  await expect(stage).not.toHaveAttribute('data-xf', '');
  const fitted = await xf();
  // Cover: 4000x3000 → base scale 0.64 (2560x1920), centred, no zoom yet.
  expect(fitted).toEqual({ cx: 540, cy: 960, scale: 1, rotDeg: 0 });

  // Pan: a horizontal drag moves the image (cover leaves no vertical room at scale 1).
  const box = await stage.boundingBox();
  if (!box) throw new Error('stage has no box');
  const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.down();
  await page.mouse.move(mid.x + 40, mid.y + 25, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await xf()).cx).toBeGreaterThan(fitted.cx);
  const panned = await xf();
  expect(panned.cy).toBe(fitted.cy);

  // Zoom about the pointer with the wheel.
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel(0, -240);
  await expect.poll(async () => (await xf()).scale).toBeGreaterThan(1);

  // Text.
  await page.getByTestId('editor-text').fill('Hello from instapost');
  await page.getByTestId('editor-text-style').selectOption('highlight');
  await expect(stage).not.toHaveAttribute('data-text-xf', '');
  await expect(stage).toHaveAttribute('data-render-error', '');

  // Safe zones: on by default, toggled off and on again.
  const safe = page.getByTestId('editor-safe-zones');
  await expect(safe).toBeChecked();
  await safe.uncheck();
  await expect(safe).not.toBeChecked();
  await safe.check();
  await expect(safe).toBeChecked();

  // Download JPEG.
  await page.getByTestId('editor-download').click();
  await expect(page.getByTestId('editor-notice')).toContainText('Saved Downloads/instapost/', { timeout: 30_000 });
  const exportId = await page.locator('.panel').getAttribute('data-export-id');
  expect(exportId).toBeTruthy();

  const bytes = await exportBytes(exportId as string);
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  expect(await decodeSize(context, bytes)).toEqual({ w: 1080, h: 1920 });

  const items = await downloadsSearch();
  const done = items.filter((d) => d.state === 'complete');
  expect(done, JSON.stringify(items)).toHaveLength(1);
  expect(Math.max(done[0]?.fileSize ?? 0, done[0]?.bytesReceived ?? 0)).toBeGreaterThan(0);
  expect(done[0]?.mime).toBe('image/jpeg');
});
