/**
 * The portrait orientation shim (strategy §11 AM37, owner-directed on 2026-10-12): the one MAIN-world
 * script instapost runs, a deliberate and narrow amendment of the "no MAIN-world script" policy.
 *
 * Why. Instagram's msite story composer (`PolarisStoryCreationPage`) decides `isLandscape` from
 * `screen.orientation.type` (else `window.orientation`, else the viewport), read when the page mounts
 * and on every `resize`. On a desktop with a landscape monitor that is always `landscape-primary`,
 * whatever the window, so the composer shows "Rotate your device to add to your story." and hides its
 * header and Share footer (live in Arc, 2026-10-12, a 503x894 portrait window). msite's earlier check,
 * at + → Story, reads the viewport and passes in the fitted window (C3a); this one does not (C3b).
 *
 * What it changes, and only when the page's `screen.orientation` exists and its `type` does not start
 * with `portrait`: two own accessor properties on that document's ScreenOrientation instance, `type`
 * → `portrait-primary` and `angle` → 0, enumerable and configurable like the native ones. Nothing else:
 * the prototype, `screen.width/height`, `matchMedia('(orientation: …)')` (already portrait in a fitted
 * window), `window.orientation`, events (none is dispatched: Instagram re-reads on mount and resize).
 *
 * What remains detectable by the page's own scripts: `Object.getOwnPropertyDescriptor(screen.orientation,
 * 'type' | 'angle')` exists (the native ones live on the prototype), the getters are not native code
 * (`Function.prototype.toString`), the type disagrees with `screen.width > screen.height` and with the
 * ScreenOrientation prototype getter, and the getter carries a non-enumerable symbol-keyed marker. It
 * also runs with the page's own globals (`Object.defineProperty`, `Symbol.for`), which the page could
 * observe or replace, so the background treats its result as untrusted data (protocol.ts
 * toPageOrientation). It is one more JS-visible inconsistency, scoped to the composer tab.
 *
 * How it runs. The background injects it with `scripting.executeScript({target:{tabId: composerTab,
 * frameIds:[0]}, world:'MAIN', injectImmediately:true, func: portraitShim, args:[install]})` into the
 * registered composer tab only, at every injection of the isolated agent (every document after the
 * hard reload, before the composer page can mount: the owner's file pick comes much later). No
 * registered content script, no web_accessible_resources, nothing in any other tab.
 *
 * Constraints. executeScript serialises the function's source, so it must be self-contained: no
 * imports at runtime, no outer variables, no helpers a bundler might inject (types only are imported).
 * check-bundle T3 runs the function it finds in the built background.js in a bare realm (node:vm, a
 * stand-in `screen` only) and checks its results, so a bundler helper or a free identifier fails the
 * build (SH-2). It is idempotent: a second injection into the same document finds its marker and
 * changes nothing. `install: false` (a guarded build's E2E flag only, AM37) only reads the type. `scr`
 * is for the tests; executeScript passes `install` alone, so the page's own `screen` is used.
 *
 * SH-2: the whole body is one try. Whatever throws (a page that replaced a global the shim uses, a
 * getter that throws) reads `failed`, with the type if it can still be read, else null; the
 * background then records C3b `unknown` and, on the composer, ends with SCREEN_LANDSCAPE.
 */
import type { OrientationShimState, PageOrientation } from '../core/ig-contract/contract.ts';

export function portraitShim(install: boolean, scr?: Screen): PageOrientation {
  let o: ScreenOrientation | null | undefined;
  try {
    o = (scr ?? screen).orientation;
    if (!o) return { type: null, shim: 'absent' };
    const mark = Symbol.for('portrait-shim');
    const own = Object.getOwnPropertyDescriptor(o, 'type');
    if (own) {
      const ours = typeof own.get === 'function' && (own.get as unknown as Record<symbol, unknown>)[mark] === true;
      const state: OrientationShimState = ours ? 'present' : 'failed';
      return { type: String(o.type), shim: state };
    }
    const type = String(o.type);
    if (type.startsWith('portrait')) return { type, shim: 'portrait' };
    if (!install) return { type, shim: 'off' };
    const getType = () => 'portrait-primary';
    const getAngle = () => 0;
    Object.defineProperty(getType, mark, { value: true });
    Object.defineProperty(o, 'angle', { get: getAngle, enumerable: true, configurable: true });
    // `type` last: an own `type` means the whole shim is in place (the idempotence check above).
    Object.defineProperty(o, 'type', { get: getType, enumerable: true, configurable: true });
    return { type: String(o.type), shim: 'installed' };
  } catch {
    let type: string | null = null;
    try {
      if (o) type = String(o.type);
    } catch {
      type = null;
    }
    return { type, shim: 'failed' };
  }
}
