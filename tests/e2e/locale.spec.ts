/**
 * Languages (strategy §11 AM44: the editor in English and Spanish; AM45: Instagram in Spanish, live
 * checklist L21), on the mock and live artifacts.
 *
 * | Id  | Case | Expected |
 * |-----|------|----------|
 * | E44 (a) | a fresh install, Auto | the editor follows the browser's UI language; Settings → Español switches every screen at once and is stored; it survives a reload; English comes back |
 * | E44 (b) | the editor in Spanish | the import surface, the Post card, a Test run's run view, result, Details, the tab title, History, Settings and the shortcuts sheet in Spanish, no English sentence left |
 * | E45 (a) | Instagram in Spanish (`locale=es`), a fresh install | the setup test passes as in English: the account learned, + → Story by trial, the fingerprint stored; the taps hit the Spanish controls (+ "Inicio", "Publicación", "Historia") |
 * | E45 (b) | Instagram in Spanish, Share test | Share ("Tu historia") pressed once with publishing blocked; Instagram's Spanish "Error al subir." toast with "Reintentar" (untouched); `shareTested` |
 * | E45 (c) | Instagram and the editor in Spanish, Post story | live: Posted from the publish answer, one story from a Spanish page, the Spanish success toast, "Publicada en la historia de @…"; mock: the Share test semantics, in Spanish |
 * | E45 (d) | Instagram in Spanish, the account | Check connection reads the account; another account logged in asks before any tap |
 *
 * Every Spanish string of the fake is (unverified) (tools/fake-ig/client/i18n.ts): no Spanish Instagram page
 * has been seen. What E45 proves is that nothing the autopilot does depends on Instagram's words.
 */
import type { Page } from '@playwright/test';
import { FAKE_ACCOUNT } from '../../tools/fake-ig/knobs.ts';
import { type ExtGlobal, expect, test, whenClosed } from './fixtures.ts';
import {
  accountPrompt,
  checkConnection,
  detailRow,
  lastRecord,
  loadPhoto,
  phasesOf,
  photoFile,
  postCard,
  postStory,
  runStep,
  shareTest,
  testRun,
  waitResult,
} from './helpers/editor-flow.ts';
import type { FakeClient } from './helpers/fake-client.ts';

/** The editor's English sentences that must not survive in a Spanish screen (U30 checks every key). */
const ENGLISH = [
  'Post story',
  'Test run',
  'Test passed',
  'Settings',
  'History',
  'Details',
  'Nothing was posted',
  'Logged in as',
  'Share button found',
  'Drop a photo here',
  'Choose photo',
  'Ready to post',
  'Send to phone',
  'Save copy',
  'Keyboard',
];

async function expectNoEnglish(page: Page): Promise<void> {
  const text = await page.locator('.app').innerText();
  for (const en of ENGLISH) expect(text, `"${en}" in a Spanish screen`).not.toContain(en);
}

/** The fake's log lines for the controls tapped and the toasts shown: step, label, language. */
async function tapsAndToasts(fake: FakeClient, since = 0) {
  const log = await fake.log(since);
  return {
    taps: log.filter((l) => l.step.startsWith('tap:')).map((l) => [l.step, l.fields.label, l.fields.lang]),
    toasts: log.filter((l) => l.step === 'toast').map((l) => [l.fields.text, l.fields.action, l.fields.lang]),
  };
}

test.describe('the editor’s language', () => {
  test.use({ seeded: false });

  test('E44 (a) Auto follows the browser; Español switches every screen at once, is stored and survives a reload', async ({
    editor,
    seed,
    storedSettings,
  }) => {
    await seed({ account: null, testPassed: false, onboarded: false, lang: 'auto' });
    const page = await editor();
    // Auto: the browser's UI language (es-* → Spanish, anything else English).
    const ui = await page.evaluate(() => (globalThis as ExtGlobal).chrome.i18n.getUILanguage());
    const auto = /^es(?:[-_]|$)/i.test(ui) ? 'es' : 'en';
    await expect(page.locator('html')).toHaveAttribute('lang', auto);
    await expect(page.getByTestId('onboarding').locator('h1')).toHaveText(
      auto === 'es' ? 'Publica historias desde Arc con un clic' : 'Post stories from Arc in one click',
    );

    await page.getByTestId('settings-open').click();
    const select = page.getByTestId('settings-language');
    await expect(select).toHaveValue('auto');
    await expect(select.locator('option')).toHaveText([
      auto === 'es' ? 'Automático (navegador)' : 'Auto (browser)',
      'English',
      'Español',
    ]);
    await select.selectOption('es');
    // At once, everywhere: the sheet, the page behind it, <html lang>.
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByTestId('settings-sheet').locator('h1')).toHaveText('Ajustes');
    await expect(page.getByTestId('settings-sheet')).toContainText('Idioma');
    await expect(select.locator('option').first()).toHaveText('Automático (navegador)');
    await page.getByTestId('settings-close').click();
    await expect(page.getByTestId('onboarding').locator('h1')).toHaveText('Publica historias desde Arc con un clic');
    await expect(page.getByTestId('onboarding-setup-test')).toHaveText('Hacer la prueba inicial');
    await expect(page.getByTestId('import-surface')).toContainText('Suelta una foto aquí');
    await expect(page.getByTestId('post-note')).toHaveText('Añade una foto para publicar.');
    await expect(page.getByTestId('settings-open')).toContainText('Ajustes');
    await expectNoEnglish(page);
    await expect.poll(async () => (await storedSettings())?.lang).toBe('es');

    // A reload keeps it (storage.local `settings.lang`).
    await page.reload();
    await expect(page.locator('.app')).toHaveAttribute('data-connected', 'true');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByTestId('onboarding').locator('h1')).toHaveText('Publica historias desde Arc con un clic');

    // And English comes back.
    await page.getByTestId('settings-open').click();
    await page.getByTestId('settings-language').selectOption('en');
    await expect(page.getByTestId('settings-sheet').locator('h1')).toHaveText('Settings');
    await page.getByTestId('settings-close').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('onboarding').locator('h1')).toHaveText('Post stories from Arc in one click');
  });
});

test('E44 (b) the editor in Spanish: import, the Post card, a Test run, its result and Details, History, Settings, the keyboard sheet', async ({
  context,
  extension,
  editor,
  composer,
  seed,
}, testInfo) => {
  await seed({ lang: 'es' });
  const page = await editor();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByTestId('import-surface')).toContainText('Suelta una foto aquí');
  await expect(page.getByTestId('import-choose')).toContainText('Elegir foto…');
  await expect(page.getByTestId('post-note')).toHaveText('Añade una foto para publicar.');
  await expectNoEnglish(page);

  await loadPhoto(page, await photoFile(context, testInfo));
  await expect(postCard(page)).toHaveAttribute('data-state', 'K13');
  await expect(page.getByTestId('post-primary')).toContainText('Publicar historia');
  await expect(page.getByTestId('post-note')).toHaveText('✓ Lista para publicar');
  await expect(page.getByTestId('post-test')).toHaveText('Prueba');
  await expect(page.locator('#sec-photo')).toHaveText('Foto');
  await expect(page.locator('#sec-text')).toHaveText('Texto');

  await testRun(page);
  // The tab title while it runs (§4.1).
  await expect(page).toHaveTitle(/^Publicando… \d:\d\d · instapost$/);
  await whenClosed(await composer());
  const card = await waitResult(page, 'tested');
  await expect(card).toContainText('Prueba superada');
  await expect(card).toContainText(
    `Todo funciona hasta Compartir, y publicas como @${FAKE_ACCOUNT}. No se publicó nada.`,
  );
  await expect(page.getByTestId('run-view').locator('h1')).toHaveText(`Prueba como @${FAKE_ACCOUNT}`);
  await expect(page.getByTestId('run-view').locator('.chip')).toHaveText('Prueba: no se publicará nada');
  await expect(runStep(page, 'instagram')).toContainText('Instagram abierto: sitio móvil');
  await expect(runStep(page, 'account')).toContainText(`Cuenta Sesión iniciada como @${FAKE_ACCOUNT}`);
  await expect(runStep(page, 'story')).toContainText('Historia La foto está en el editor de historias de Instagram');
  await expect(runStep(page, 'share')).toContainText('Botón Compartir encontrado, sin pulsar (prueba)');
  await expect(runStep(page, 'confirm')).toContainText('Omitido (prueba)');
  if (extension.mode === 'live') {
    await expect(page.getByTestId('run-fake-bar')).toHaveText(
      'INSTAGRAM FALSO: esta ventana es el servidor de prueba, no Instagram.',
    );
  }
  await expect(await detailRow(page, 'result')).toHaveText('Prueba superada (Compartir sin pulsar)');
  await expect(page.getByTestId('details').last().locator('dt').first()).toHaveText('Resultado');
  await expect(await detailRow(page, 'mobile')).toHaveText('sí');
  await expect(page.getByTestId('details-copy')).toHaveText('Copiar diagnóstico');
  await expectNoEnglish(page);

  await page.getByTestId('result-done').click();
  await page.getByTestId('history-open').click();
  const drawer = page.getByTestId('history-drawer');
  await expect(drawer.locator('h1')).toHaveText('Historial');
  await expect(drawer.getByTestId('history-pace')).toContainText('Publicaciones hoy');
  await expect(drawer.locator('h2').first()).toHaveText('Hoy');
  await expect(drawer.getByTestId('history-row').first()).toContainText('✓ Prueba superada');
  await expectNoEnglish(page);
  await drawer.getByTestId('history-close').click();

  await page.getByTestId('settings-open').click();
  const sheet = page.getByTestId('settings-sheet');
  await expect(sheet).toContainText('Las publicaciones van a');
  await expect(sheet.getByTestId('settings-account-lock').locator('..')).toContainText(
    `Publicar solo como @${FAKE_ACCOUNT}`,
  );
  await expect(sheet.getByTestId('settings-pace')).toContainText('Publicación desde el escritorio: Activa');
  await sheet.getByTestId('settings-advanced').click();
  await expect(sheet).toContainText('Comprobar la conexión');
  await expect(sheet).toContainText('Prueba de Compartir');
  await expectNoEnglish(page);
  await page.getByTestId('settings-close').click();

  await page.getByTestId('shortcuts-open').click();
  await expect(page.getByTestId('shortcut-sheet')).toContainText('Teclado');
  await expect(page.getByTestId('shortcut-sheet')).toContainText('Abrir o mostrar instapost (desde cualquier lugar)');
  await expectNoEnglish(page);
});

test.describe('Instagram in Spanish, a fresh install', () => {
  test.use({ seeded: false });

  test('E45 (a) the setup test: the same run as in English; the account learned; the taps hit the Spanish controls', async ({
    context,
    editor,
    composer,
    fake,
    seed,
    handoffRecords,
    localKeys,
  }, testInfo) => {
    await fake.setKnobs({ locale: 'es' });
    await seed({ account: null, testPassed: false, onboarded: false });
    const page = await editor();
    await loadPhoto(page, await photoFile(context, testInfo));
    await expect(postCard(page)).toHaveAttribute('data-state', 'K6');
    await testRun(page);
    await whenClosed(await composer());
    await waitResult(page, 'tested');

    const rec = await lastRecord(handoffRecords);
    expect(rec).toMatchObject({ mode: 'test', outcome: 'tested' });
    expect(rec.probe?.lang).toBe('es');
    // C14 in Spanish: the account comes from the navigation's profile link, as in English.
    expect(rec.account).toMatchObject({ detected: FAKE_ACCOUNT, decision: 'learn', confirmedBy: 'learned' });
    // C10/C11: the fake's default menu is Post, Story; the trial found Story at index 1, by structure.
    expect(rec.entry).toMatchObject({ result: 'armed', menuCount: 2, storyIndex: 1, trials: 1 });
    expect(rec.compose).toMatchObject({ drawn: true, controls: 1, variant: 'v1', settled: true });
    const keys = await localKeys(['expectedAccount', 'lastTestPassAt', 'menuFingerprint']);
    expect(keys.expectedAccount).toMatchObject({ handle: FAKE_ACCOUNT });
    expect(typeof keys.lastTestPassAt).toBe('number');
    expect(keys.menuFingerprint).toMatchObject({ count: 2, storyIndex: 1 });

    // The page the autopilot drove was Spanish where it tapped: + (its aria-label is Instagram's Home
    // string, "Inicio"), the wrong item "Publicación", then "Historia". Share was never pressed.
    const { taps } = await tapsAndToasts(fake);
    expect(taps).toEqual([
      ['tap:create', 'Inicio', 'es'],
      ['tap:post', 'Publicación', 'es'],
      ['tap:create', 'Inicio', 'es'],
      ['tap:story', 'Historia', 'es'],
    ]);
    expect(await fake.uploads()).toEqual([]);
    expect(await fake.stories()).toEqual([]);
  });
});

test('E45 (b) Share test in Spanish: "Tu historia" pressed once, publishing blocked, Instagram’s Spanish failure toast untouched', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ locale: 'es', menuOrder: 'storyPost' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await shareTest(page);
  const popup = await composer();
  const card = await waitResult(page, 'shareTested');
  await expect(card).toContainText('Share test passed');
  await whenClosed(popup);

  const rec = await lastRecord(handoffRecords);
  expect(rec).toMatchObject({ mode: 'shareTest', outcome: 'share-tested' });
  expect(rec.evidence?.net.find((e) => e.path.startsWith('/rupload_igphoto/'))).toMatchObject({ host: 'i', status: 0 });
  expect(rec.evidence?.ui.toast).toBe('action');
  const { taps, toasts } = await tapsAndToasts(fake);
  expect(taps).toEqual([
    ['tap:create', 'Inicio', 'es'],
    ['tap:story', 'Historia', 'es'],
    ['tap:share', 'Tu historia', 'es'],
  ]);
  expect(toasts).toContainEqual(['Error al subir.', 'Reintentar', 'es']);
  expect(await fake.stories()).toEqual([]);
  expect(await fake.writes()).toEqual([]);
});

test('E45 (c) Post story with Instagram and the editor in Spanish: posted (live) from a Spanish page, one story', async ({
  context,
  extension,
  editor,
  composer,
  fake,
  seed,
  handoffRecords,
}, testInfo) => {
  await fake.setKnobs({ locale: 'es', menuOrder: 'storyPost' });
  await seed({ lang: 'es' });
  const page = await editor();
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  await expect(page.getByTestId('run-view').locator('h1')).toHaveText(
    /^Publicando en (?:tu historia|la historia de @)/,
  );
  const popup = await composer();
  const closed = whenClosed(popup);

  if (extension.mode === 'live') {
    const card = await waitResult(page, 'posted');
    await expect(card).toContainText(`Publicada en la historia de @${FAKE_ACCOUNT}`);
    await expect(card).toContainText('Instagram lo confirmó.');
    await expect(page).toHaveTitle('✓ Publicada · instapost');
    for (const step of ['instagram', 'account', 'story', 'share', 'confirm'] as const) {
      await expect(runStep(page, step)).toHaveAttribute('data-status', 'done');
    }
    await expect(runStep(page, 'confirm')).toContainText('Instagram confirmó la historia');
    await closed;
    const stories = await fake.stories();
    expect(stories).toHaveLength(1);
    // Shared from the Spanish page, after + → Story started Instagram's story session.
    expect(stories[0]?.meta).toMatchObject({ lang: 'es', sessionStarted: true, variant: 'v1' });
    const { taps, toasts } = await tapsAndToasts(fake);
    expect(taps).toEqual([
      ['tap:create', 'Inicio', 'es'],
      ['tap:story', 'Historia', 'es'],
      ['tap:share', 'Tu historia', 'es'],
    ]);
    expect(toasts).toContainEqual(['Foto añadida a tu historia.', null, 'es']);
    expect((await lastRecord(handoffRecords)).result).toMatchObject({ kind: 'posted', account: FAKE_ACCOUNT });
  } else {
    // A guarded build blocks every upload: the Share test semantics (E29 mock), in Spanish.
    const card = await waitResult(page, 'shareTested');
    await expect(card).toContainText('Prueba de Compartir superada');
    await closed;
    const { toasts } = await tapsAndToasts(fake);
    expect(toasts).toContainEqual(['Error al subir.', 'Reintentar', 'es']);
    expect(await fake.stories()).toEqual([]);
  }
  await expectNoEnglish(page);
});

test('E45 (d) the account in Spanish: Check connection reads it; another account asks before any tap', async ({
  context,
  editor,
  composer,
  fake,
  handoffRecords,
  clearRateLog,
}, testInfo) => {
  await fake.setKnobs({ locale: 'es' });
  const page = await editor();
  await checkConnection(page);
  const first = await composer();
  await whenClosed(first);
  const card = await waitResult(page, 'checked');
  await expect(card).toContainText(`Connected as @${FAKE_ACCOUNT}`);
  const check = await lastRecord(handoffRecords);
  expect(check.account).toMatchObject({ detected: FAKE_ACCOUNT, decision: 'ok' });
  expect(check.probe?.lang).toBe('es');
  await page.getByTestId('result-done').click();

  // Another account is logged in (Instagram in Spanish): the prompt, before any tap.
  await fake.setKnobs({ account: 'other:someone.else' });
  await clearRateLog();
  const since = (await fake.log()).at(-1)?.seq ?? 0;
  await loadPhoto(page, await photoFile(context, testInfo));
  await postStory(page);
  const popup = await composer({ not: [first] });
  const prompt = accountPrompt(page);
  await expect(prompt).toHaveAttribute('data-kind', 'mismatch', { timeout: 30_000 });
  await expect(prompt).toContainText('@someone.else');
  await page.getByTestId('account-cancel').click();
  await whenClosed(popup);
  await waitResult(page, 'stopped');
  const rec = await lastRecord(handoffRecords);
  expect(rec.account).toMatchObject({ detected: 'someone.else', expected: FAKE_ACCOUNT, decision: 'prompt-mismatch' });
  expect(phasesOf(rec)).not.toContain('openingEntry');
  expect((await tapsAndToasts(fake, since)).taps).toEqual([]);
});
