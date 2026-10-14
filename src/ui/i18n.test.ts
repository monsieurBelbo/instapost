/**
 * U30 (strategy §11 AM44): the editor's two languages. Both catalogs have exactly the same keys and, per
 * key, the same `{placeholders}` and the same leading/trailing spaces (fragments are glued to their
 * neighbours); Spanish is really Spanish (only a short list of keys may read the same in both); the
 * language follows the setting, and Auto follows the browser (es-* → Spanish, anything else English);
 * the copy rules of U21 hold in Spanish too (no codes, no Meta-host URLs, "Nothing was posted" only under
 * the §5 rule, no Instagram UI strings beyond its controls' names).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDITOR_ONLY, hits } from '../../tools/bundle/patterns.ts';
import { entryDetail } from '../core/handoff/reducer.ts';
import {
  ENTRY_RESULTS,
  ERROR_CODES,
  MSITE_LOCK_REASONS,
  RESULT_KINDS,
  type RunResult,
  UNKNOWN_WHYS,
} from '../core/handoff/state.ts';
import { EN } from './catalog.en.ts';
import { ES } from './catalog.es.ts';
import {
  ACTION_LABEL,
  accountPromptText,
  clock,
  dateTime,
  detailText,
  ERROR_COPY,
  finishByHandText,
  howItWorks,
  POST_NOTES,
  pauseReasonText,
  resultText,
  runHeader,
  STEP_COPY,
  tabTitle,
  whyText,
} from './copy.ts';
import { detailRows, entryText } from './details.ts';
import { dayLabel } from './history.ts';
import {
  browserTag,
  CATALOGS,
  intlLocale,
  LANGS,
  lang,
  langOf,
  type MsgKey,
  placeholders,
  resolveLang,
  setLangSetting,
  t,
  tParts,
} from './i18n.ts';
import { postCardState } from './post-card.ts';
import { stepsFrom } from './run-steps.ts';
import { shortcuts } from './shortcuts.ts';

const KEYS = Object.keys(EN) as MsgKey[];
const NOW = Date.UTC(2026, 9, 14, 12);

afterEach(() => {
  setLangSetting('en');
});

describe('U30 the catalogs', () => {
  it('have identical keys', () => {
    expect(Object.keys(ES).sort()).toEqual([...KEYS].sort());
  });

  it('have the same placeholders per key', () => {
    for (const k of KEYS) expect(placeholders(ES[k]), k).toEqual(placeholders(EN[k]));
  });

  it('glue fragments the same way: the same leading and trailing space per key, no empty text', () => {
    for (const l of LANGS) {
      for (const k of KEYS) {
        const text = CATALOGS[l][k];
        expect(text.trim().length, `${l} ${k}`).toBeGreaterThan(0);
        expect(/^\s/.test(text), `${l} ${k} leading space`).toBe(/^\s/.test(EN[k]));
        expect(/\s$/.test(text), `${l} ${k} trailing space`).toBe(/\s$/.test(EN[k]));
        expect(text, `${l} ${k}`).not.toMatch(/\s{2,}/);
      }
    }
  });

  it('Spanish is translated: only names, numbers and formats may read the same', () => {
    const same = KEYS.filter((k) => ES[k] === EN[k]).sort();
    expect(same).toEqual(
      [
        'action.tryAgainIn',
        'details.no',
        'details.row.serviceWorker',
        'details.steps.instagram',
        'details.steps.unit',
        'details.viewport',
        'history.seconds',
        'notice.errorCopy',
        'photo.zoom',
        'step.name.instagram',
        'step.seconds',
      ].sort(),
    );
  });

  it('placeholders() lists each name once, sorted', () => {
    expect(placeholders('{b} and {a}, again {b}')).toEqual(['a', 'b']);
    expect(placeholders('none')).toEqual([]);
  });
});

describe('U30 choosing the language', () => {
  it('Auto follows the browser: es-* is Spanish, anything else English', () => {
    for (const tag of ['es', 'es-AR', 'es-419', 'ES-es', 'es_MX']) expect(langOf(tag), tag).toBe('es');
    for (const tag of ['en', 'en-US', 'en-AR', 'pt-BR', 'eus', 'esperanto', '', null, undefined]) {
      expect(langOf(tag), String(tag)).toBe('en');
    }
    expect(resolveLang('auto', 'es-AR')).toBe('es');
    expect(resolveLang('auto', 'en-GB')).toBe('en');
    expect(resolveLang('en', 'es-AR')).toBe('en');
    expect(resolveLang('es', 'en-US')).toBe('es');
  });

  it('the setting switches every text at once, and Auto reads the browser tag', () => {
    const before = browserTag.value;
    try {
      setLangSetting('es');
      expect(lang.value).toBe('es');
      expect(t('post.label.post')).toBe('Publicar historia');
      expect(ACTION_LABEL.tryAgain).toBe('Volver a intentar');
      expect(ERROR_COPY.UPLOAD_FAILED.title).toBe('Instagram no aceptó la historia');
      setLangSetting('auto');
      browserTag.value = 'es-AR';
      expect(lang.value).toBe('es');
      browserTag.value = 'en-US';
      expect(lang.value).toBe('en');
      expect(t('post.label.post')).toBe('Post story');
    } finally {
      browserTag.value = before;
    }
  });

  it('t() fills placeholders; tParts() splits around elements', () => {
    expect(t('post.K12', { time: '14:05' })).toBe('You posted this story at 14:05.');
    setLangSetting('es');
    expect(t('post.K12', { time: '14:05' })).toBe('Publicaste esta historia a las 14:05.');
    const parts = tParts('onboarding.intro', { post: { el: 'strong' } });
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('Cuando pulsas ');
    expect(parts[1]).toEqual({ el: 'strong' });
  });

  it('dates and times use the chosen language (with the browser’s region when it speaks it)', () => {
    setLangSetting('es');
    expect(intlLocale('es')).toMatch(/^es/);
    expect(intlLocale('en')).toMatch(/^en/);
    // 20 Oct 2026 was a Tuesday: Spanish names the day and month in Spanish.
    const tue = new Date(2026, 9, 20, 14, 5).getTime();
    expect(dateTime(tue)).toBe('martes 20 de octubre a las 14:05');
    expect(dayLabel(NOW, NOW)).toBe('Hoy');
    setLangSetting('en');
    expect(dateTime(tue)).toMatch(/Tue/);
    expect(dayLabel(NOW, NOW)).toBe('Today');
    expect(clock(tue)).toMatch(/0?2:05|14:05/);
  });

  it('ES-1: “until …” / “detected …” read as Spanish sentences (no “el mar, 20 oct”), English unchanged', () => {
    const tue = new Date(2026, 9, 20, 14, 5).getTime();
    setLangSetting('es');
    expect(t('pause.title', { until: dateTime(tue) })).toBe(
      '⏸ La publicación desde el escritorio está en pausa hasta el martes 20 de octubre a las 14:05',
    );
    expect(ERROR_COPY.MSITE_LOCKED.body({ nothingPosted: true, freeAt: tue })).toBe(
      'La publicación desde el escritorio está en pausa hasta el martes 20 de octubre a las 14:05 para proteger tu cuenta. Abre Instagram en tu teléfono y completa cualquier verificación que te muestre.',
    );
    expect(t('settings.detected', { date: dateTime(tue) })).toBe('detectada el martes 20 de octubre a las 14:05');
    expect(t('settings.pausedUntil', { date: dateTime(tue) })).toBe(
      'en pausa hasta el martes 20 de octubre a las 14:05',
    );
    // A Spanish browser with a region (12 h clock in es-AR): the same sentence, no abbreviated weekday, no comma.
    vi.stubGlobal('navigator', { language: 'es-AR' });
    try {
      expect(intlLocale('es')).toBe('es-AR');
      const ar = t('pause.title', { until: dateTime(tue) });
      expect(ar).toMatch(/hasta el martes 20 de octubre a las 0?2:05\s?p\.\s?m\.$/);
      expect(ar).not.toMatch(/\bel mar\b|martes,/);
    } finally {
      vi.unstubAllGlobals();
    }
    setLangSetting('en');
    expect(t('pause.title', { until: dateTime(tue) })).toMatch(
      /^⏸ Desktop posting is paused until Tue,? (20 Oct|Oct 20), /,
    );
  });
});

/** Every text the run's copy produces now (the U21 scan, per language). */
function everyText(): string[] {
  const out: string[] = [...Object.values(ACTION_LABEL), howItWorks()];
  const contexts = [
    { nothingPosted: true },
    { nothingPosted: false },
    { nothingPosted: true, detail: 'story 30 s', freeAt: NOW + 60_000, handle: 'testuser', expected: 'other' },
    { nothingPosted: false, detail: 'menu 3 items', why: 'configure-5xx' as const, postedBeforeKill: true },
    { nothingPosted: true, detail: 'unreadable', handle: null },
    { nothingPosted: true, detail: 'manual 300 s' },
    { nothingPosted: true, detail: 'page reloaded' },
    { nothingPosted: true, detail: 'menu 1 items' },
  ];
  for (const c of Object.values(ERROR_COPY)) {
    out.push(c.title);
    for (const ctx of contexts) out.push(c.body(ctx));
  }
  for (const s of Object.values(STEP_COPY)) {
    out.push(s.active, s.done({ window: { w: 511, h: 909 }, handle: 'testuser', facebook: true }));
    if (s.test) out.push(s.test);
    if (s.shareTest) out.push(s.shareTest);
  }
  for (const n of Object.values(POST_NOTES)) out.push(typeof n === 'function' ? n('14:05') : n);
  const results: RunResult[] = [
    ...RESULT_KINDS.map((kind) => ({ kind, alarms: [], at: NOW }) as RunResult),
    ...ERROR_CODES.map((code) => ({ kind: 'notPosted', code, alarms: [], at: NOW }) as RunResult),
    ...UNKNOWN_WHYS.map((why) => ({ kind: 'unknown', code: 'OUTCOME_UNKNOWN', why, alarms: [], at: NOW }) as RunResult),
  ];
  for (const r of results) {
    for (const ctx of contexts) {
      const x = resultText(r, ctx);
      out.push(x.title, x.body);
    }
  }
  for (const kind of ['mismatch', 'unreadable', 'first'] as const)
    out.push(...accountPromptText(kind, 'testuser', 'other').lines);
  for (const mode of ['post', 'test', 'shareTest', 'check'] as const) out.push(runHeader(mode, 'testuser'));
  out.push(pauseReasonText([]), pauseReasonText(MSITE_LOCK_REASONS), finishByHandText('pick', null));
  return out;
}

describe('U30 the U21 rules in Spanish', () => {
  it('no error code and no Meta-host URL in any text', () => {
    setLangSetting('es');
    const code = new RegExp(`\\b(?:${ERROR_CODES.join('|')}|DUPLICATE_UPLOAD)\\b`);
    for (const text of everyText()) {
      expect(text, text).not.toMatch(code);
      expect(hits(text, EDITOR_ONLY), text).not.toContain('Meta host URL');
    }
    for (const k of KEYS) expect(hits(ES[k], EDITOR_ONLY), k).not.toContain('Meta host URL');
  });

  it('“No se publicó nada” only when the context says nothing could have been posted', () => {
    setLangSetting('es');
    const nothing = 'No se publicó nada';
    for (const code of ERROR_CODES) {
      expect(ERROR_COPY[code].body({ nothingPosted: false }), code).not.toContain(nothing);
    }
    for (const code of ['OUTCOME_UNKNOWN', 'UPLOAD_FAILED', 'TEST_LEAK'] as const) {
      expect(ERROR_COPY[code].body({ nothingPosted: true }), code).not.toContain(nothing);
    }
    expect(ERROR_COPY.NOT_LOGGED_IN.body({ nothingPosted: true })).toMatch(/No se publicó nada\.$/);
  });

  it('quotes only instapost’s own names, and never Instagram’s own UI beyond +, Historia and Compartir', () => {
    setLangSetting('es');
    const theirs = [/\b(?:Añadir|Agregar) a (?:tu )?historia\b/i, /\bNueva publicación\b/i, /\bDescartar\b/];
    const ours = new Set(['Instagram', 'Cuenta', 'Historia', 'Compartir', 'Confirmación', 'Publicada']);
    for (const text of everyText()) {
      for (const re of theirs) expect(text, text).not.toMatch(re);
      for (const m of text.matchAll(/“([^”]*)”/g)) expect(ours, text).toContain(m[1]);
    }
  });
});

describe('U30 Spanish screens (pure parts)', () => {
  it('the Post card, the run steps, the result and Details read in Spanish', () => {
    setLangSetting('es');
    const k13 = postCardState({
      hasPhoto: true,
      fontsReady: true,
      phoneOnly: null,
      pausedUntil: null,
      brandedTestBuild: null,
      testPassed: true,
      lane: null,
      story: null,
      now: NOW,
    });
    expect(k13).toMatchObject({ id: 'K13', label: 'Publicar historia', note: 'Lista para publicar' });
    const steps = stepsFrom({ phase: 'opening', mode: 'post', startedAt: NOW, result: null }, NOW);
    expect(steps[0]?.text).toBe('Abriendo Instagram en una ventana del tamaño de un teléfono…');
    const posted: RunResult = { kind: 'posted', alarms: [], at: NOW, account: 'testuser' };
    expect(resultText(posted, { nothingPosted: false, durationMs: 18_000 }).title).toBe(
      'Publicada en la historia de @testuser',
    );
    expect(tabTitle({ result: posted })).toBe('✓ Publicada · instapost');
    const rows = detailRows({ handoffId: 'hof_1', result: posted, code: 'UPLOAD_FAILED' });
    expect(rows.map((r) => r.label)).toEqual(['Resultado', 'Código', 'Ejecución']);
    expect(rows[0]?.value).toBe('Publicada (Instagram lo confirmó)');
    expect(shortcuts()[0]?.action).toBe('Abrir o mostrar instapost (desde cualquier lugar)');
  });

  it('the reducer’s details read in the current language inside copy', () => {
    setLangSetting('es');
    expect(detailText('menu 3 items')).toBe('menú de 3 opciones');
    expect(detailText('story session refused')).toBe('Instagram rechazó iniciar la historia');
    expect(detailText('publish 400 application/json')).toBe('publicación 400 application/json');
    expect(detailText('write-block rules not verified')).toBe('write-block rules not verified');
    expect(ERROR_COPY.STORY_ENTRY_MISSING.body({ nothingPosted: true, detail: 'no menu after +' })).toContain(
      '(no apareció el menú después de +)',
    );
    expect(whyText('not-blocked', 'upload 403')).toContain('403');
    setLangSetting('en');
    expect(detailText('menu 3 items')).toBe('menu 3 items');
    expect(detailText('upload 200')).toBe('upload 200');
  });

  it('ES-2: every detail an entry failure, UPLOAD_FAILED or TEST_LEAK can carry is worded in Spanish', () => {
    setLangSetting('es');
    const entry = ENTRY_RESULTS.filter((r) => r !== 'armed').flatMap((result) =>
      (result === 'MENU_DRIFT' ? [0, 1, 3, null] : [2]).map((menuCount) => entryDetail({ result, menuCount })),
    );
    // newDocument() right after the + tap; outcome.ts's upload/publish shapes (UPLOAD_FAILED, TEST_LEAK).
    const others = [
      'page reloaded',
      'upload 0',
      'upload 403',
      'publish 200',
      'publish 400 application/json redirected',
    ];
    for (const d of [...entry, ...others]) expect(detailText(d), d).not.toBe(d);
    expect(detailText('page reloaded')).toBe('la página se recargó');
    expect(detailText('menu 1 items')).toBe('menú de 1 opción');
    expect(detailText('menu 0 items')).toBe('menú de 0 opciones');
    expect(ERROR_COPY.STORY_ENTRY_MISSING.body({ nothingPosted: true, detail: 'page reloaded' })).toBe(
      'instapost no pudo abrir el menú + → Historia de Instagram como lo espera (la página se recargó). Puede que Instagram haya cambiado su página. No se publicó nada.',
    );
    const facts = { fpUsed: false, storyIndex: null, glyph: null, trials: 0, plusTaps: 1, armedMs: null };
    expect(entryText({ ...facts, result: 'MENU_DRIFT', menuCount: 1 })).toBe(
      '+ → Historia · menú de 1 opción · intentos por tanteo: 0 · + tocado 1× · MENU_DRIFT',
    );
    setLangSetting('en');
    expect(detailText('menu 1 items')).toBe('menu 1 item');
    expect(detailText('page reloaded')).toBe('page reloaded');
    expect(entryText({ ...facts, result: 'MENU_DRIFT', menuCount: 1 })).toBe(
      '+ → Story · menu 1 item · 0 trials · + tapped 1× · MENU_DRIFT',
    );
  });
});
