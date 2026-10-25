/**
 * U39 (strategy §11 AM48; inpage-ui-spec.md FX16): the in-page lane in English and Spanish. The composer's
 * texts (strings.ts) and the content script's (page-copy.ts) come from the typed catalogs (U30 checks their
 * keys and placeholders); here: every surface reads in the chosen language and follows a change at once
 * (nothing is frozen in a module constant), Spanish leaves no English sentence behind, U21's rules hold
 * (no codes, no Meta-host URL, "Nothing was posted" only where the result says so), the entry's states and
 * the coach mark read in both languages with Spanish-shaped dates, and the content script imports only the
 * small page catalogs.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { EDITOR_ONLY, hits } from '../../tools/bundle/patterns.ts';
import { EN } from '../ui/catalog.en.ts';
import { ES } from '../ui/catalog.es.ts';
import { PAGE_EN } from '../ui/catalog.page.en.ts';
import { PAGE_ES } from '../ui/catalog.page.es.ts';
import { setLangSetting } from '../ui/i18n.ts';
import type { InpageRecord } from './driver.ts';
import { IDLE_RUN, type PageRunState } from './messages.ts';
import { ariaShortcut, coachCopy, entryLook, pageT, shortcutOf, toLang } from './page-copy.ts';
import { detailRows, type ResultKind, resultView, runSteps } from './run-view.ts';
import { FAILURE_COPY_CODES, failureCopy, composerStrings as S } from './strings.ts';

const ROOT = new URL('../../', import.meta.url).pathname;
const NOW = Date.UTC(2026, 9, 15, 12);
/** 20 Oct 2026 was a Tuesday. */
const TUE = new Date(2026, 9, 20, 14, 5).getTime();

afterEach(() => {
  setLangSetting('en');
});

function rec(over: Partial<InpageRecord> & { raw?: string[] } = {}): InpageRecord {
  const { raw = [], ...rest } = over;
  return {
    marker: 'instapost-inpage:modes=check,test,shareTest,post',
    runId: 'inp_1',
    mode: 'post',
    writeBlocked: false,
    photo: null,
    toggles: { ua: 'tabwide', frame: 'auto', view: 'phone', xfoRule: 'on', fetchDest: 'document' },
    startedAt: 1000,
    endedAt: 19_000,
    outcome: null,
    code: null,
    detail: null,
    locked: null,
    tabId: 3,
    frame: {
      id: 5,
      documentId: null,
      box: { w: 540, h: 960 },
      dpr: 2,
      scale: 0.2,
      loaded: true,
      readable: true,
      urls: [],
      paths: [],
      status: 200,
      xfoSeen: null,
      error: null,
      otherSubFrames: 0,
    },
    rules: { installed: [1001, 1020, 1021], after: null, ua: 'tabwide' },
    orientation: null,
    probe: null,
    readyProbe: null,
    account: { detected: 'owner', expected: 'owner', decision: 'ok' },
    entry: null,
    compose: null,
    share: null,
    net: [],
    pageUrls: [],
    steps: raw.map((step, i) => ({ step, t: i * 100 })),
    ...rest,
  };
}

/** Sample arguments for each text function of strings.ts (a new function must be added here). */
const SAMPLES: Readonly<Record<string, readonly unknown[][]>> = {
  draft: [['14:05']],
  readyNote: [['owner'], [null]],
  posted: [['owner'], [null]],
  testBody: [['owner'], [null]],
  setupTitle: [['owner'], [null]],
  checkedTitle: [['owner'], [null]],
  lock: [['owner'], [null]],
  postedAt: [['14:05']],
  capButton: [['14:05']],
  postedNote: [['14:05']],
  spacingButton: [['0:42']],
  postAgainIn: [['0:42']],
  unconfirmedNote: [['14:05']],
  tryAgainIn: [['0:41']],
  queuedTitle: [['0:42']],
  queued: [['0:42']],
  capHour: [[6]],
  capDay: [[15]],
  closesIn: [[4]],
  pausedButton: [['20/10']],
  title: [['20/10']],
  detected: [['20/10']],
  pending: [[0], [1], [2], [3], [4]],
  active: [[0], [1], [2], [3], [4]],
  done: [[0], [1], [2], [3], [4]],
  loggedInAs: [['owner']],
  postsGoTo: [['owner']],
  expected: [['owner']],
  postedBody: [
    ['14:05', 18],
    ['14:05', null],
  ],
  unknownBody: [['…']],
  unknownWhy: [
    'no-upload-seen',
    'no-finalize-after-upload',
    'configure-5xx',
    'configure-0',
    'configure-html',
    'redirected',
    'share-not-acknowledged',
    'PAGE_LEFT',
    'TAB_HIDDEN',
    'AGENT_UNREACHABLE',
    'TIMEOUT',
  ].map((r) => [r]),
  unknownWhyDefault: [[]],
  saved: [['instapost/2026-10-15_1405_story.png']],
  frameRow: [
    [540, 960, 2, [1001, 1020]],
    [540, 960, 2, []],
  ],
  posting: [['0:12']],
  testing: [['0:12']],
  checking: [['0:12']],
  name: [['a', 'b']],
  paceBody: [[3, 1]],
  counts: [[3, 1]],
  build: [['live']],
  list: [[]],
  RATE_LIMITED: [['14:05'], [null]],
  mode: [['post'], ['test'], ['shareTest'], ['check']],
};

/** Every string a surface group holds now, each function called with its samples. */
function groupTexts(group: object): string[] {
  const out: string[] = [];
  for (const [name, v] of Object.entries(group)) {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') {
      const samples = SAMPLES[name];
      if (!samples) throw new Error(`no SAMPLES for the text function ${name}`);
      for (const args of samples) {
        const r = (v as (...a: unknown[]) => unknown)(...args);
        if (typeof r === 'string') out.push(r);
        else if (Array.isArray(r)) for (const row of r) out.push(String((row as [string, string])[1]));
      }
    } else if (v && typeof v === 'object') out.push(...groupTexts(v));
  }
  return out;
}

const everyComposerText = (): string[] => groupTexts(S);

/** Every result the composer can show (each kind, each failure code with its own copy, generic). */
function everyResult(): string[] {
  const out: string[] = [];
  const opts = { handle: 'owner', setup: false, time: '14:05', seconds: 18 };
  const outcomes: [InpageRecord['outcome'], string | null, InpageRecord['mode']][] = [
    ['posted', null, 'post'],
    ['tested', null, 'test'],
    ['shareTested', null, 'shareTest'],
    ['checked', null, 'check'],
    ['stopped', 'STOPPED', 'post'],
    ['stopped', 'STOPPED', 'test'],
    ['unknown', 'OUTCOME_UNKNOWN', 'post'],
    ...FAILURE_COPY_CODES.map((c): [InpageRecord['outcome'], string, InpageRecord['mode']] => ['notPosted', c, 'post']),
    ['notPosted', 'SOMETHING_NEW', 'post'],
  ];
  for (const [outcome, code, mode] of outcomes) {
    for (const setup of [false, true]) {
      const v = resultView(rec({ outcome, code, mode, detail: 'no-upload-seen' }), { ...opts, setup });
      if (!v) continue;
      // A stopped post has no body (its title says it all).
      out.push(...[v.head, v.title, v.body, ...v.chip, v.sub ?? ''].filter((t) => t !== ''));
    }
  }
  const raw = ['start', 'frame loaded', 'account', 'composer', 'share sent', 'shared', 'decided'];
  for (const mode of ['post', 'test', 'shareTest', 'check'] as const) {
    for (let n = 0; n <= raw.length; n++)
      out.push(...runSteps(rec({ mode, raw: raw.slice(0, n), outcome: null })).map((s) => s.text));
  }
  out.push(...detailRows(rec({ outcome: 'stopped', code: 'TIMEOUT', detail: 'x', raw: ['start'] })).map(([k]) => k));
  return out;
}

describe('U39 the composer in two languages', () => {
  it('follows Settings → Language at once: the texts are read at access time, not kept', () => {
    expect(S.post.post).toBe('Post story');
    expect(S.actions.sendToPhone).toBe('Send to phone…');
    setLangSetting('es');
    expect(S.post.post).toBe('Publicar historia');
    expect(S.actions.sendToPhone).toBe('Enviar al teléfono…');
    expect(S.edit.swatches.white).toBe('Blanco');
    expect(S.keys.list('⌥⇧S', 'mac')[0]).toEqual([
      '⌥⇧S',
      'Abrir o cerrar instapost (en cualquier página de Instagram)',
    ]);
    // RL-10: no toolbar shortcut set, no row for it; the composer's keys in the platform's spelling.
    expect(S.keys.list(null, 'mac')[0]?.[0]).toBe('⌘↵');
    expect(
      S.keys
        .list('Alt+Shift+S', 'other')
        .slice(0, 5)
        .map(([k]) => k),
    ).toEqual(['Alt+Shift+S', 'Ctrl+Enter', 'Ctrl+Alt+Enter', 'Ctrl+O', 'Ctrl+V']);
    expect(S.settings.language).toBe('Idioma');
    setLangSetting('en');
    expect(S.post.post).toBe('Post story');
  });

  it('Spanish leaves no English text behind (only names, numbers and formats read the same)', () => {
    const en = [...everyComposerText(), ...everyResult()];
    setLangSetting('es');
    const es = [...everyComposerText(), ...everyResult()];
    expect(es).toHaveLength(en.length);
    const same = es.filter((t, i) => t === en[i]);
    expect([...new Set(same)].sort()).toEqual(['Zoom']);
    for (const t of es) expect(t.trim().length, JSON.stringify(t)).toBeGreaterThan(0);
  });

  it('U21 in both languages: no error code and no Meta-host URL in any text', () => {
    const codes = new RegExp(
      `\\b(?:${[...FAILURE_COPY_CODES, 'OUTCOME_UNKNOWN', 'STOPPED', 'SOMETHING_NEW'].join('|')})\\b`,
    );
    for (const l of ['en', 'es'] as const) {
      setLangSetting(l);
      for (const t of [...everyComposerText(), ...everyResult()]) {
        expect(t, `${l}: ${t}`).not.toMatch(codes);
        expect(hits(t, EDITOR_ONLY), t).not.toContain('Meta host URL');
      }
    }
  });

  it('"Nothing was posted" only for a failure that could not have posted, never for Couldn’t confirm', () => {
    const opts = { handle: 'owner', setup: false, time: '14:05', seconds: 18 };
    for (const [l, nothing] of [
      ['en', 'Nothing was posted.'],
      ['es', 'No se publicó nada.'],
    ] as const) {
      setLangSetting(l);
      const body = (code: string) => resultView(rec({ outcome: 'notPosted', code }), opts)?.body ?? '';
      expect(body('PAGE_IN_USE')).toMatch(new RegExp(`${nothing.replace('.', '\\.')}$`));
      expect(body('TEST_LEAK')).not.toContain(nothing);
      expect(body('UPLOAD_FAILED')).not.toContain(nothing);
      const unknown = resultView(rec({ outcome: 'unknown', code: 'OUTCOME_UNKNOWN', detail: 'configure-5xx' }), opts);
      expect(unknown?.body).not.toContain(nothing);
    }
  });

  it('a result, its steps and Details read in Spanish', () => {
    setLangSetting('es');
    const opts = { handle: 'owner', setup: false, time: '14:05', seconds: 18 };
    const posted = resultView(rec({ outcome: 'posted' }), opts);
    expect(posted).toMatchObject({
      head: 'Historia publicada',
      title: 'Publicada en la historia de @owner',
      body: '14:05 · tardó 18 s · Instagram lo confirmó.',
      chip: ['Historia publicada', '14:05 · confirmada'],
    });
    const setup = resultView(rec({ mode: 'test', outcome: 'tested' }), { ...opts, setup: true });
    expect(setup?.title).toBe('Listo. Publicas como @owner.');
    const unknown = resultView(rec({ outcome: 'unknown', code: 'OUTCOME_UNKNOWN', detail: 'PAGE_LEFT: reload' }), opts);
    expect(unknown?.body).toBe(
      'instapost pulsó Compartir, pero la página de Instagram se cerró antes de que Instagram respondiera. Revisa tu historia antes de volver a publicar esta foto.',
    );
    const steps = runSteps(rec({ raw: ['start', 'frame loaded', 'account'], outcome: null }));
    expect(steps.map((s) => s.text)).toEqual([
      'Instagram abierto: sitio móvil en esta pestaña',
      'Sesión iniciada como @owner',
      'Iniciando una historia y añadiendo tu foto…',
      'Compartir',
      'Confirmar',
    ]);
    const rows = Object.fromEntries(detailRows(rec({ outcome: 'stopped', code: 'TIMEOUT', raw: ['start'] })));
    expect(rows.Código).toBe('TIMEOUT');
    expect(rows.Marco).toBe('540 × 960 con DPR 2, en esta pestaña · reglas 1001, 1020, 1021');
    expect(rows.Cuenta).toBe('@owner · se esperaba @owner (ok)');
    expect(failureCopy('LANDSCAPE')).toEqual(failureCopy('SCREEN_LANDSCAPE'));
    expect(failureCopy(null).title).toBe('Algo salió mal');
  });

  it('a handle-less result has its own sentence, not "as your account"', () => {
    const opts = { handle: null, setup: true, time: '14:05', seconds: null };
    const noAccount = rec({
      mode: 'test',
      outcome: 'tested',
      account: { detected: null, expected: null, decision: null },
    });
    expect(resultView(noAccount, opts)?.title).toBe('Ready to post.');
    expect(S.post.readyNote(null)).toBe('1080 × 1920 · to your story');
    expect(S.result.postedBody('14:05', null)).toBe('14:05 · Instagram confirmed it.');
    setLangSetting('es');
    expect(resultView(noAccount, opts)?.title).toBe('Lista para publicar.');
    expect(S.settings.lock(null)).toBe('Publicar solo como la cuenta detectada');
    expect(S.refusal.RATE_LIMITED(null)).toBe('Entre ejecuciones pasa al menos un minuto.');
  });
});

describe('U39 the entry and the coach on Instagram’s page', () => {
  const run = (over: Partial<PageRunState>): PageRunState => ({ ...IDLE_RUN, ...over });

  it('every state reads in both languages; the shortcut stays keys', () => {
    const states: [PageRunState, number | null][] = [
      [run({}), null],
      [run({ phase: 'running', here: false, step: 1, startedAt: NOW - 65_000 }), null],
      [run({ phase: 'result', here: false, endedAt: NOW - 1000, result: 'posted', handle: 'owner' }), null],
      [run({ phase: 'result', here: false, endedAt: NOW - 1000, result: 'posted', handle: null }), null],
      [run({ phase: 'result', here: false, endedAt: NOW - 1000, result: 'failed' }), null],
      [run({ phase: 'result', here: false, endedAt: NOW - 1000, result: 'unknown' }), null],
      [run({}), TUE],
    ];
    const en = states.map(([r, p]) => entryLook(r, p, 'en', NOW));
    const es = states.map(([r, p]) => entryLook(r, p, 'es', NOW));
    expect(en.map((l) => l.st)).toEqual(['idle', 'busy', 'result', 'result', 'result', 'result', 'paused']);
    expect(es.map((l) => l.st)).toEqual(en.map((l) => l.st));
    for (let i = 0; i < en.length; i++) {
      const a = en[i];
      const b = es[i];
      if (!a || !b) throw new Error('missing look');
      expect(b.label).not.toBe(a.label);
      expect(b.tip).not.toBe(a.tip);
      expect(b.name).not.toBe(a.name);
      expect(b.small).toBe(a.small);
      expect(b.glyph).toBe(a.glyph);
    }
    expect(es[0]).toMatchObject({ label: 'Nueva historia', tip: 'instapost · Nueva historia' });
    expect(es[1]).toMatchObject({
      label: 'Publicando…',
      small: '1:05',
      tip: 'Publicando en otra pestaña de Instagram · paso 2 de 5',
    });
    expect(es[2]?.tip).toBe('Publicada en la historia de @owner');
    expect(es[3]?.tip).toBe('Publicada en tu historia');
    expect(es[2]?.name).toBe('instapost: Publicada.');
    expect(en[0]).toMatchObject({ label: 'New story', name: 'instapost: new story' });
    // RL-10: the shortcut is the browser's own spelling (keys, not words), or none.
    expect([shortcutOf('⌥⇧S'), shortcutOf('Alt+Shift+S'), shortcutOf(''), shortcutOf(undefined)]).toEqual([
      '⌥⇧S',
      'Alt+Shift+S',
      null,
      null,
    ]);
    expect([ariaShortcut('⌥⇧S'), ariaShortcut('Alt+Shift+S'), ariaShortcut('⌘⇧Y'), ariaShortcut('Ctrl+Y')]).toEqual([
      'Alt+Shift+S',
      'Alt+Shift+S',
      'Meta+Shift+Y',
      'Control+Y',
    ]);
    expect([ariaShortcut(null), ariaShortcut('S')]).toEqual([null, null]);
  });

  it('the pause reads as a sentence in Spanish (ES-1): “hasta el martes 20 de octubre”', () => {
    const es = entryLook(IDLE_RUN, TUE, 'es', NOW, 'es-AR');
    expect(es.tip).toBe('La publicación desde el escritorio está en pausa hasta el martes 20 de octubre');
    expect(es.name).toBe('instapost: en pausa hasta el martes 20 de octubre. Abrir.');
    expect(entryLook(IDLE_RUN, TUE, 'en', NOW).tip).toMatch(/^Desktop posting is paused until Tue,? (20 Oct|Oct 20)$/);
    // A lock that has run out is no pause.
    expect(entryLook(IDLE_RUN, NOW - 1, 'es', NOW).st).toBe('idle');
  });

  it('the coach mark, and a language from the wire', () => {
    expect(coachCopy('es')).toEqual({
      title: 'Publica una historia desde aquí',
      body: 'instapost se abre sobre Instagram, así que nunca sales de la página.',
      key: 'Atajo',
      ok: 'Entendido',
    });
    expect(coachCopy('en').ok).toBe('Got it');
    expect(pageT('es', 'page.entry.postingTip', { step: 3, of: 5 })).toContain('paso 3 de 5');
    expect([toLang('es'), toLang('en'), toLang(undefined), toLang('fr')]).toEqual(['es', 'en', 'en', 'en']);
  });

  it('the page catalogs are the editor catalog’s page.* keys (one source, checked by U30)', () => {
    for (const [k, v] of Object.entries(PAGE_EN)) expect(EN[k as keyof typeof EN]).toBe(v);
    for (const [k, v] of Object.entries(PAGE_ES)) expect(ES[k as keyof typeof ES]).toBe(v);
    const pageKeys = Object.keys(EN).filter((k) => k.startsWith('page.'));
    expect(pageKeys.sort()).toEqual(Object.keys(PAGE_EN).sort());
  });

  it('the content script imports only the page catalogs and i18n-core, never the editor’s catalog or signals', () => {
    const imports = (file: string) =>
      [...readFileSync(`${ROOT}${file}`, 'utf8').matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    const pageCopy = imports('src/inpage/page-copy.ts');
    expect(pageCopy).toContain('../ui/catalog.page.en.ts');
    expect(pageCopy).toContain('../ui/catalog.page.es.ts');
    for (const file of ['src/inpage/page-copy.ts', 'src/inpage/page-script.ts', 'src/ui/i18n-core.ts']) {
      for (const spec of imports(file)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/catalog\.(?:en|es)\.ts$|\/i18n\.ts$|strings\.ts$|signals/);
      }
    }
  });
});

// Keep the ResultKind import honest (the result kinds the table above walks).
const KINDS: readonly ResultKind[] = ['posted', 'tested', 'shareTested', 'checked', 'stopped', 'failed', 'unknown'];
it('U39 walks every result kind', () => {
  setLangSetting('es');
  const seen = new Set<string>();
  for (const outcome of ['posted', 'tested', 'shareTested', 'checked', 'unknown', 'notPosted'] as const) {
    const v = resultView(rec({ outcome, code: outcome === 'notPosted' ? 'TIMEOUT' : null }), {
      handle: 'owner',
      setup: false,
      time: '14:05',
      seconds: 1,
    });
    if (v) seen.add(v.kind);
  }
  seen.add(
    resultView(rec({ outcome: 'stopped', code: 'STOPPED' }), { handle: null, setup: false, time: '', seconds: null })
      ?.kind ?? '',
  );
  expect([...seen].sort()).toEqual([...KINDS].sort());
});
