/**
 * The composer's texts (inpage-ui-spec.md §9, FX16; strategy §11 AM48), grouped by surface. Every text lives
 * in the typed catalogs (`src/ui/catalog.en.ts`, `catalog.es.ts`, keys `inpage.*`); this module only maps the
 * composer's surfaces to those keys. Each property is read at access time (`t()` reads the language signal),
 * so a component that renders `S.post.ready` follows a change of Settings → Language at once. Never copy a
 * text into a module-level constant: it would keep the language it had when the module loaded.
 *
 * The content script uses `catalog.page.*.ts` through `page-copy.ts` instead (its bundle stays lean).
 */
import { type MsgKey, t, tk } from '../ui/i18n.ts';
import { combo, type KeyOs, keyOs } from './keys.ts';

/** The formats line under Choose photo… (names, the same in every language). */
export const FORMATS = 'JPEG · PNG · WebP · AVIF · HEIC';
/** instapost's own name (the dialog's mark, the frames' titles). */
export const MARK = 'instapost';

/** An object whose properties read their key's text at access time, plus `fns` as they are. */
function texts<T extends Record<string, MsgKey>, F extends object = Record<never, never>>(
  keys: T,
  fns?: F,
): { readonly [K in keyof T]: string } & F {
  const o: Record<string, unknown> = { ...fns };
  for (const [name, key] of Object.entries(keys)) {
    Object.defineProperty(o, name, { get: () => tk(key), enumerable: true });
  }
  return o as { readonly [K in keyof T]: string } & F;
}

const STEP_INDEX = [0, 1, 2, 3, 4] as const;
type StepIndex = (typeof STEP_INDEX)[number];
const stepKey = (kind: 'pending' | 'active' | 'done', i: number): MsgKey | null =>
  i >= 0 && i <= 4 ? (`inpage.step.${kind}${i as StepIndex}` as MsgKey) : null;

/** The failure copy codes that have their own text; others read as `generic`. */
const FAILURE_CODES = [
  'PAGE_IN_USE',
  'UPLOAD_FAILED',
  'ACCOUNT_UNCONFIRMED',
  'FRAME_REFUSED',
  'PAGE_LEFT',
  'TAB_HIDDEN',
  'NOT_LOGGED_IN',
  'DESKTOP_SHELL',
  'STORY_ENTRY_MISSING',
  'INJECTION_IGNORED',
  'SHARE_MISSING',
  'SCREEN_LANDSCAPE',
  'TIMEOUT',
  'AGENT_UNREACHABLE',
  'KILLED_CHALLENGE',
  'KILLED_OFFHOST',
  'TEST_LEAK',
  'LAYOUT_TOO_WIDE',
  'INPUT_MISSING',
  'UNEXPECTED_PAGE',
  'GUARD_NOT_FAKE',
  // RL-19: Instagram's own changes the probe stops at (the window lane has copy for both).
  'SW_INTERCEPTS',
  'ACCEPT_DRIFT',
] as const;
type FailureCode = (typeof FAILURE_CODES)[number];
/** Codes that share another code's copy. */
const FAILURE_ALIAS: Readonly<Record<string, FailureCode>> = { LANDSCAPE: 'SCREEN_LANDSCAPE' };

/** The `{why}` of a Couldn't confirm, by the driver's reason (ux.md §5, "page" for "window"). */
const WHY: Readonly<Record<string, MsgKey>> = {
  'no-upload-seen': 'inpage.why.noUploadSeen',
  'no-finalize-after-upload': 'inpage.why.noFinalize',
  'configure-5xx': 'inpage.why.configure5xx',
  'configure-0': 'inpage.why.configure0',
  'configure-html': 'inpage.why.configureHtml',
  redirected: 'inpage.why.configureHtml',
  'share-not-acknowledged': 'inpage.why.shareNotAck',
  PAGE_LEFT: 'inpage.why.pageLeft',
  TAB_HIDDEN: 'inpage.why.tabHidden',
  AGENT_UNREACHABLE: 'inpage.why.agentLost',
  TIMEOUT: 'inpage.why.timeout',
  // RS-2: a kill after a post's Share (it keeps its lock); RS-3: the worker restarted after Share.
  KILLED_CHALLENGE: 'inpage.why.challenge',
  KILLED_OFFHOST: 'inpage.why.offhost',
  'worker-restarted': 'inpage.why.restarted',
};

const HISTORY_MODE: Readonly<Record<string, MsgKey>> = {
  post: 'inpage.history.mode.post',
  test: 'inpage.history.mode.test',
  shareTest: 'inpage.history.mode.shareTest',
  check: 'inpage.history.mode.check',
};

/** The composer (the dialog, its sheets and the chip). */
export const composerStrings = {
  dialog: texts({
    titleNew: 'inpage.dialog.titleNew',
    titlePosting: 'inpage.dialog.titlePosting',
    titleTest: 'inpage.dialog.titleTest',
    titleCheck: 'inpage.dialog.titleCheck',
    close: 'inpage.dialog.close',
    hide: 'inpage.dialog.hide',
    back: 'inpage.dialog.back',
    more: 'inpage.dialog.more',
    testBuild: 'inpage.dialog.testBuild',
  }),
  import: texts(
    {
      title: 'inpage.import.title',
      paste: 'inpage.import.paste',
      choose: 'inpage.import.choose',
      opening: 'inpage.import.opening',
      converting: 'inpage.import.converting',
      error: 'inpage.import.error',
      heicError: 'inpage.import.heicError',
      recent: 'inpage.import.recent',
      drop: 'inpage.import.drop',
    },
    { draft: (time: string) => t('inpage.import.draft', { time }) },
  ),
  stage: texts({
    zoom: 'inpage.stage.zoom',
    fit: 'inpage.stage.fit',
    fill: 'inpage.stage.fill',
    ghost: 'inpage.stage.ghost',
    reset: 'inpage.stage.reset',
    hint: 'inpage.stage.hint',
    live: 'inpage.stage.live',
    liveHeld: 'inpage.stage.liveHeld',
    opening: 'inpage.stage.opening',
    enlarge: 'inpage.stage.enlarge',
    shrink: 'inpage.stage.shrink',
    enlargeName: 'inpage.stage.enlargeName',
    shrinkName: 'inpage.stage.shrinkName',
    converting: 'inpage.stage.converting',
  }),
  account: texts({
    yourStory: 'inpage.account.yourStory',
    posting: 'inpage.account.posting',
    testing: 'inpage.account.testing',
    checking: 'inpage.account.checking',
    unknown: 'inpage.account.unknown',
  }),
  edit: texts(
    {
      tabs: 'inpage.edit.tabs',
      photo: 'inpage.edit.photo',
      text: 'inpage.edit.text',
      framing: 'inpage.edit.framing',
      fill: 'inpage.edit.fill',
      fit: 'inpage.edit.fit',
      zoom: 'inpage.edit.zoom',
      rotate: 'inpage.edit.rotate',
      left: 'inpage.edit.left',
      right: 'inpage.edit.right',
      photoHint: 'inpage.edit.photoHint',
      replace: 'inpage.edit.replace',
      textPlaceholder: 'inpage.edit.textPlaceholder',
      textName: 'inpage.edit.textName',
      style: 'inpage.edit.style',
      plain: 'inpage.edit.plain',
      highlight: 'inpage.edit.highlight',
      colour: 'inpage.edit.colour',
      custom: 'inpage.edit.custom',
      size: 'inpage.edit.size',
      textHint: 'inpage.edit.textHint',
    },
    {
      swatches: texts({
        white: 'inpage.edit.swatch.white',
        black: 'inpage.edit.swatch.black',
        yellow: 'inpage.edit.swatch.yellow',
        coral: 'inpage.edit.swatch.coral',
        sky: 'inpage.edit.swatch.sky',
        lime: 'inpage.edit.swatch.lime',
      }),
    },
  ),
  post: texts(
    {
      thumb: 'inpage.post.thumb',
      ready: 'inpage.post.ready',
      underTop: 'inpage.post.underTop',
      underReply: 'inpage.post.underReply',
      post: 'inpage.post.post',
      postAgain: 'inpage.post.postAgain',
      postedNote: 'inpage.post.postedNote',
      firstTitle: 'inpage.post.firstTitle',
      firstNote: 'inpage.post.firstNote',
      firstButton: 'inpage.post.firstButton',
      spacingNote: 'inpage.post.spacingNote',
      queuedNote: 'inpage.post.queuedNote',
      cancel: 'inpage.post.cancel',
      capTitle: 'inpage.post.capTitle',
      otherTitle: 'inpage.post.otherTitle',
      otherNote: 'inpage.post.otherNote',
      showIt: 'inpage.post.showIt',
      posting: 'inpage.post.posting',
      pausedTitle: 'inpage.post.pausedTitle',
      pausedNote: 'inpage.post.pausedNote',
      loggedOutTitle: 'inpage.post.loggedOutTitle',
      loggedOutNote: 'inpage.post.loggedOutNote',
      preparing: 'inpage.post.preparing',
      unconfirmedTitle: 'inpage.post.unconfirmedTitle',
      postAnyway: 'inpage.post.postAnyway',
    },
    {
      readyNote: (handle: string | null) =>
        handle ? t('inpage.post.readyNote', { handle }) : t('inpage.post.readyNoteYours'),
      postedAt: (time: string) => t('inpage.post.postedAt', { time }),
      unconfirmedNote: (time: string) => t('inpage.post.unconfirmedNote', { time }),
      postAgainIn: (left: string) => t('inpage.post.postAgainIn', { left }),
      spacingButton: (left: string) => t('inpage.post.spacingButton', { left }),
      queuedTitle: (left: string) => t('inpage.post.queuedTitle', { left }),
      capHour: (n: number) => t('inpage.post.capHour', { n }),
      capDay: (n: number) => t('inpage.post.capDay', { n }),
      capButton: (time: string) => t('inpage.post.capButton', { time }),
      pausedButton: (date: string) => t('inpage.post.pausedButton', { date }),
    },
  ),
  pause: texts(
    {
      body: 'inpage.pause.body',
      resume: 'inpage.pause.resume',
      resumeAsk: 'inpage.pause.resumeAsk',
      resumeCheck: 'inpage.pause.resumeCheck',
      resumeButton: 'inpage.pause.resumeButton',
    },
    { title: (date: string) => t('inpage.pause.title', { date }) },
  ),
  run: texts({
    testChip: 'inpage.run.testChip',
    stop: 'inpage.run.stop',
    hide: 'inpage.run.hide',
    uploading: 'inpage.run.uploading',
    noteBefore: 'inpage.run.noteBefore',
    noteAfter: 'inpage.run.noteAfter',
    noteSlow20: 'inpage.run.noteSlow20',
    noteSlow60: 'inpage.run.noteSlow60',
    noteHolding: 'inpage.run.noteHolding',
    noteReconnect: 'inpage.run.noteReconnect',
    noteCheck: 'inpage.run.noteCheck',
  }),
  steps: texts(
    {
      uploading: 'inpage.step.uploading',
      confirmedLate: 'inpage.step.confirmedLate',
      testPending3: 'inpage.step.testPending3',
      testPending4: 'inpage.step.testPending4',
      testDone3: 'inpage.step.testDone3',
      testSkip4: 'inpage.step.testSkip4',
      shareTestDone3: 'inpage.step.shareTestDone3',
      shareTestDone4: 'inpage.step.shareTestDone4',
      checkSkip: 'inpage.step.checkSkip',
      stopped: 'inpage.step.stopped',
      unconfirmed: 'inpage.step.unconfirmed',
    },
    {
      /** The owner's step `i` (0..4) before it starts, while it runs, and once done. */
      pending: (i: number) => {
        const k = stepKey('pending', i);
        return k ? tk(k) : '';
      },
      active: (i: number) => {
        const k = stepKey('active', i);
        return k ? tk(k) : '';
      },
      done: (i: number) => {
        const k = stepKey('done', i);
        return k ? tk(k) : '';
      },
      loggedInAs: (handle: string) => t('inpage.step.loggedInAs', { handle }),
    },
  ),
  result: texts(
    {
      headPosted: 'inpage.result.headPosted',
      headNotPosted: 'inpage.result.headNotPosted',
      headCheck: 'inpage.result.headCheck',
      headTest: 'inpage.result.headTest',
      headSetup: 'inpage.result.headSetup',
      headStopped: 'inpage.result.headStopped',
      headChecked: 'inpage.result.headChecked',
      kicker: 'inpage.result.kicker',
      postedLate: 'inpage.result.postedLate',
      postedPaused: 'inpage.result.postedPaused',
      testTitle: 'inpage.result.testTitle',
      setupBody: 'inpage.result.setupBody',
      shareTestTitle: 'inpage.result.shareTestTitle',
      shareTestBody: 'inpage.result.shareTestBody',
      checkedBody: 'inpage.result.checkedBody',
      stoppedTitle: 'inpage.result.stoppedTitle',
      stoppedTestTitle: 'inpage.result.stoppedTestTitle',
      unknownTitle: 'inpage.result.unknownTitle',
      heldNote: 'inpage.result.heldNote',
      nothingPosted: 'inpage.result.nothingPosted',
      paused: 'inpage.result.paused',
      show: 'inpage.result.show',
      details: 'inpage.result.details',
      copyDiagnostics: 'inpage.result.copyDiagnostics',
      keepOpen: 'inpage.result.keepOpen',
      itPosted: 'inpage.result.itPosted',
      itDidntPost: 'inpage.result.itDidntPost',
    },
    {
      posted: (handle: string | null) =>
        handle ? t('inpage.result.posted', { handle }) : t('inpage.result.postedYours'),
      postedBody: (time: string, secs: number | null) =>
        secs !== null ? t('inpage.result.postedBody', { time, secs }) : t('inpage.result.postedBodyShort', { time }),
      testBody: (handle: string | null) =>
        handle ? t('inpage.result.testBody', { handle }) : t('inpage.result.testBodyYours'),
      setupTitle: (handle: string | null) =>
        handle ? t('inpage.result.setupTitle', { handle }) : t('inpage.result.setupTitleYours'),
      checkedTitle: (handle: string | null) =>
        handle ? t('inpage.result.checkedTitle', { handle }) : t('inpage.result.checkedTitleYours'),
      unknownBody: (why: string) => t('inpage.result.unknownBody', { why }),
      /** `{why}` for the driver's reason (a key of WHY), else the default. */
      unknownWhy: (reason: string): string | null => {
        const k = WHY[reason];
        return k ? tk(k) : null;
      },
      unknownWhyDefault: () => t('inpage.why.default'),
      saved: (file: string) => t('inpage.result.saved', { file }),
      closesIn: (s: number) => t('inpage.result.closesIn', { s }),
      detailRows: texts({
        result: 'inpage.details.result',
        code: 'inpage.details.code',
        detail: 'inpage.details.detail',
        account: 'inpage.details.account',
        frame: 'inpage.details.frame',
        took: 'inpage.details.took',
        run: 'inpage.details.run',
        steps: 'inpage.details.steps',
      }),
      frameRow: (w: number, h: number, dpr: number, rules: readonly (string | number)[]) =>
        t('inpage.details.frameValue', {
          w,
          h,
          dpr,
          rules: rules.length > 0 ? rules.join(', ') : t('inpage.details.none'),
        }),
      expected: (handle: string) => t('inpage.details.expected', { handle }),
    },
  ),
  actions: texts(
    {
      viewStory: 'inpage.action.viewStory',
      newStory: 'inpage.action.newStory',
      post: 'inpage.action.post',
      done: 'inpage.action.done',
      tryAgain: 'inpage.action.tryAgain',
      sendToPhone: 'inpage.action.sendToPhone',
      checkStory: 'inpage.action.checkStory',
      settings: 'inpage.action.settings',
    },
    {
      /** RL-14 (FS11): Try again during the spacing, `Try again · 0:41`. */
      tryAgainIn: (left: string) => t('action.tryAgainIn', { label: tk('inpage.action.tryAgain'), left }),
    },
  ),
  chip: texts(
    {
      handsOff: 'inpage.chip.handsOff',
      uploading: 'inpage.chip.uploading',
      queuedNote: 'inpage.chip.queuedNote',
      posted: 'inpage.chip.posted',
      testPassed: 'inpage.chip.testPassed',
      nothing: 'inpage.chip.nothing',
      stopped: 'inpage.chip.stopped',
      notPosted: 'inpage.chip.notPosted',
      seeWhy: 'inpage.chip.seeWhy',
      unknown: 'inpage.chip.unknown',
      checkStory: 'inpage.chip.checkStory',
      checked: 'inpage.chip.checked',
    },
    {
      posting: (clock: string) => t('inpage.chip.posting', { clock }),
      testing: (clock: string) => t('inpage.chip.testing', { clock }),
      checking: (clock: string) => t('inpage.chip.checking', { clock }),
      queued: (left: string) => t('inpage.chip.queued', { left }),
      postedNote: (time: string) => t('inpage.chip.postedNote', { time }),
      name: (line1: string, line2: string) => t('inpage.chip.name', { line1, line2 }),
    },
  ),
  menu: texts({
    test: 'inpage.menu.test',
    save: 'inpage.menu.save',
    phone: 'inpage.menu.phone',
    history: 'inpage.menu.history',
    settings: 'inpage.menu.settings',
    keys: 'inpage.menu.keys',
  }),
  settings: texts(
    {
      title: 'inpage.settings.title',
      close: 'inpage.settings.close',
      onInstagram: 'inpage.settings.onInstagram',
      entry: 'inpage.settings.entry',
      entrySidebar: 'inpage.settings.entrySidebar',
      entryNone: 'inpage.settings.entryNone',
      preview: 'inpage.settings.preview',
      small: 'inpage.settings.small',
      large: 'inpage.settings.large',
      hidden: 'inpage.settings.hidden',
      previewHelp: 'inpage.settings.previewHelp',
      account: 'inpage.settings.account',
      noAccount: 'inpage.settings.noAccount',
      noAccountHelp: 'inpage.settings.noAccountHelp',
      checkAgain: 'inpage.settings.checkAgain',
      lockHelp: 'inpage.settings.lockHelp',
      forget: 'inpage.settings.forget',
      copies: 'inpage.settings.copies',
      keepCopies: 'inpage.settings.keepCopies',
      keepCopiesHelp: 'inpage.settings.keepCopiesHelp',
      language: 'settings.language',
      langAuto: 'settings.lang.auto',
      langHelp: 'settings.langHint',
      pace: 'inpage.settings.pace',
      advanced: 'inpage.settings.advanced',
      check: 'inpage.settings.check',
      checkHelp: 'inpage.settings.checkHelp',
      run: 'inpage.settings.run',
      shareTest: 'inpage.settings.shareTest',
      shareTestHelp: 'inpage.settings.shareTestHelp',
      shareTestRun: 'inpage.settings.shareTestRun',
      shareTestConfirm: 'inpage.settings.shareTestConfirm',
      shareTestGo: 'inpage.settings.shareTestGo',
      diagnostics: 'inpage.settings.diagnostics',
      diagnosticsHelp: 'inpage.settings.diagnosticsHelp',
      copy: 'inpage.settings.copy',
      running: 'inpage.settings.running',
      developer: 'inpage.settings.developer',
    },
    {
      postsGoTo: (handle: string) => t('inpage.settings.postsGoTo', { handle }),
      detected: (when: string) => t('inpage.settings.detected', { when }),
      lock: (handle: string | null) => (handle ? t('inpage.settings.lock', { handle }) : t('inpage.settings.lockNone')),
      paceBody: (today: number, hour: number) => t('inpage.settings.paceBody', { today, hour }),
      build: (build: string) => t('inpage.settings.build', { build }),
    },
  ),
  history: texts(
    {
      title: 'inpage.history.title',
      close: 'inpage.history.close',
      empty: 'inpage.history.empty',
      marked: 'inpage.history.marked',
    },
    {
      counts: (today: number, hour: number) => t('inpage.history.counts', { today, hour }),
      /** A run's kind (its mode) as History lists it. */
      mode: (mode: string) => {
        const k = HISTORY_MODE[mode];
        return k ? tk(k) : mode;
      },
    },
  ),
  keys: texts(
    { title: 'inpage.keys.title', close: 'inpage.keys.close' },
    {
      /**
       * The keyboard sheet's rows: the keys (not words) and what they do. RL-10: the toolbar shortcut as the
       * browser has it (no row when none is set), the composer's own keys in the platform's spelling.
       */
      list: (shortcut: string | null = null, os: KeyOs = keyOs()): [string, string][] => [
        ...(shortcut ? [[shortcut, t('inpage.keys.open')] as [string, string]] : []),
        [combo('post', os), t('inpage.keys.post')],
        [combo('test', os), t('inpage.keys.test')],
        [combo('choose', os), t('inpage.keys.choose')],
        [combo('paste', os), t('inpage.keys.paste')],
        ['Esc', t('inpage.keys.esc')],
        ['T', t('inpage.keys.text')],
        ['G', t('inpage.keys.ghost')],
        ['F', t('inpage.keys.fit')],
        ['0', t('inpage.keys.reset')],
        ['= −', t('inpage.keys.zoom')],
        ['← ↑ → ↓', t('inpage.keys.nudge')],
        ['N', t('inpage.keys.newStory')],
        ['H · ,', t('inpage.keys.panels')],
      ],
    },
  ),
  toast: texts({
    saved: 'inpage.toast.saved',
    savedFailed: 'inpage.toast.savedFailed',
    diagnostics: 'inpage.toast.diagnostics',
    diagnosticsNote: 'inpage.toast.diagnosticsNote',
    copied: 'inpage.toast.copied',
    onePhoto: 'inpage.toast.onePhoto',
    replaced: 'inpage.toast.replaced',
    phoneFailed: 'inpage.toast.phoneFailed',
    phoneFailedNote: 'inpage.toast.phoneFailedNote',
    markedPosted: 'inpage.toast.markedPosted',
    markedNotPosted: 'inpage.toast.markedNotPosted',
    markedNote: 'inpage.toast.markedNote',
  }),
  refusal: texts(
    {
      title: 'inpage.refusal.title',
      BUSY: 'inpage.refusal.BUSY',
      PAUSED: 'inpage.refusal.PAUSED',
      SHARE_NOT_CONFIRMED: 'inpage.refusal.SHARE_NOT_CONFIRMED',
      NO_TAB: 'inpage.refusal.NO_TAB',
      NO_PHOTO: 'inpage.refusal.NO_PHOTO',
      BRANDED_BROWSER: 'inpage.refusal.BRANDED_BROWSER',
      NOT_LOGGED_IN: 'inpage.refusal.NOT_LOGGED_IN',
      RENDER: 'inpage.refusal.RENDER',
    },
    {
      RATE_LIMITED: (time: string | null) =>
        time ? t('inpage.refusal.RATE_LIMITED', { time }) : t('inpage.refusal.RATE_LIMITED_LATER'),
    },
  ),
};

export type ComposerStrings = typeof composerStrings;

/** The failure copy for a code (FS11, ux.md §5 with "page" for "window"); unknown codes read as generic. */
export function failureCopy(code: string | null): { title: string; body: string } {
  const c = code ? (FAILURE_ALIAS[code] ?? code) : null;
  if (c !== null && (FAILURE_CODES as readonly string[]).includes(c)) {
    return { title: tk(`inpage.fail.${c}.title` as MsgKey), body: tk(`inpage.fail.${c}.body` as MsgKey) };
  }
  return { title: t('inpage.fail.generic.title'), body: t('inpage.fail.generic.body') };
}

/**
 * RL-8: ACCOUNT_UNCONFIRMED's body by the account decision that stopped the run: an account Instagram showed
 * that is not the expected one (the code's own body), none instapost could read, or none expected yet.
 */
export function accountFailureBody(decision: string | null): string {
  if (decision === 'prompt-unreadable') return t('inpage.fail.ACCOUNT_UNCONFIRMED.unreadable');
  if (decision === 'prompt-first') return t('inpage.fail.ACCOUNT_UNCONFIRMED.first');
  return t('inpage.fail.ACCOUNT_UNCONFIRMED.body');
}

/**
 * RL-16: the import view's error line. A failed HEIC conversion gets its own line; any other decode failure (a
 * GIF, a TIFF, a damaged JPEG) the generic "Can't open this file". Decided by the error (editor-state.ts
 * errorNotice's `heic` flag), never by the notice's text, which mentions HEIC in every language.
 */
export function importErrorText(n: { code?: string; heic?: boolean; text: string }): string {
  if (n.code !== 'DECODE_FAILED') return n.text;
  return n.heic === true ? composerStrings.import.heicError : composerStrings.import.error;
}

/** The codes with their own failure copy (for tests). */
export const FAILURE_COPY_CODES: readonly string[] = [...FAILURE_CODES, ...Object.keys(FAILURE_ALIAS)];
