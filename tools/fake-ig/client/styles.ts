/** @jsxImportSource react */
/**
 * Cosmetic styles of the fake client. Class names go through `cx()` so `drift=renamed` can
 * randomise them per page load (strategy §6.1 "Markup drift"). Geometry-relevant styles
 * (the composer canvas) are inline, so StoryComposer also works unstyled (B6).
 *
 * The few class names Instagram's own composer and nav item set (`_aa3b` snackbar, `_aa3c` canvas,
 * `_aa3d` header and its buttons, `_a6hd` the nav link, `_aswp` the core button; docs/contract.md C10,
 * C12) are spelled as Instagram spells them, and `drift=renamed` randomises them too, so the agent's
 * structural fallbacks are what a drifted page leaves.
 */
import { createContext, useContext } from 'react';

export type ClassName =
  | 'app'
  | 'top'
  | 'brand'
  | 'feed'
  | 'post'
  | 'nav'
  | 'navBtn'
  | 'create'
  | 'menu'
  | 'menuItem'
  | 'toasts'
  | 'toast'
  | 'start'
  | 'backdrop'
  | 'bar'
  | 'barBtn'
  | 'share'
  | 'dtop'
  | 'dlinks'
  | 'topEntry'
  | 'navItem'
  | 'forms'
  | 'hiddenInput'
  | 'menuIcon'
  | 'footer'
  | 'avatar'
  | 'badge'
  | 'modal'
  | 'progress'
  | 'dialogBox'
  | 'snack'
  | 'toastBtn'
  | 'author'
  | IgClass;

/** Instagram's own class names (the composer module and the nav item), kept literally unless drifted. */
export type IgClass = '_aa3b' | '_aa3c' | '_aa3d' | '_aa3e' | '_aa3f' | '_aa3g' | '_aa3i' | '_aa3j' | '_a6hd' | '_aswp';

export type Cx = (name: ClassName) => string;

export const plainCx: Cx = (name) => (name.startsWith('_') ? name : `fk-${name}`);

/** Random class names, stable for the page's lifetime. */
export function renamedCx(): Cx {
  const names = new Map<ClassName, string>();
  return (name) => {
    let n = names.get(name);
    if (!n) {
      n = `_${Math.random().toString(36).slice(2, 9)}`;
      names.set(name, n);
    }
    return n;
  };
}

export const CxContext = createContext<Cx>(plainCx);
export const useCx = (): Cx => useContext(CxContext);

export function stylesheet(c: Cx): string {
  const s = (name: ClassName) => `.${c(name)}`;
  return `
${s('app')}{min-height:100%;display:flex;flex-direction:column}
${s('top')}{position:sticky;top:0;display:flex;align-items:center;height:44px;padding:0 12px;border-bottom:1px solid #dbdbdb;background:#fff;z-index:2}
${s('brand')}{font-weight:700;letter-spacing:.02em}
${s('feed')}{flex:1;padding:12px 0 72px;display:flex;flex-direction:column;gap:12px;align-items:center}
${s('post')}{width:min(100%,470px);aspect-ratio:4/5;background:linear-gradient(135deg,#eee,#ddd);display:flex;align-items:flex-end;padding:8px;box-sizing:border-box;color:#555;font-size:13px}
${s('nav')}{position:fixed;left:0;right:0;bottom:0;height:52px;display:flex;justify-content:space-around;align-items:center;border-top:1px solid #dbdbdb;background:#fff;z-index:2}
${s('navBtn')}{border:0;background:none;font:inherit;font-size:12px;color:#111;padding:8px}
${s('create')}{border:2px solid #111;border-radius:8px;background:#fff;font:700 20px/1 system-ui;width:36px;height:30px}
${s('menu')}{position:fixed;left:50%;transform:translateX(-50%);bottom:64px;display:flex;flex-direction:column;min-width:180px;background:#fff;border:1px solid #dbdbdb;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.18);overflow:hidden;z-index:20}
${s('menuItem')}{border:0;background:#fff;font:inherit;padding:12px 16px;text-align:left}
${s('menuItem')}:hover{background:#f2f2f2}
${s('toasts')}{position:fixed;left:0;right:0;top:56px;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none;z-index:30}
${s('toast')}{background:#262626;color:#fff;border-radius:8px;padding:10px 14px;max-width:90%;font-size:14px}
${s('start')}{margin:24px 16px 72px;padding:32px 16px;border:2px dashed #c7c7c7;border-radius:16px;text-align:center;color:#444}
${s('backdrop')}{position:fixed;inset:0;background:#000;z-index:10}
${s('bar')}{position:fixed;left:0;right:0;display:flex;justify-content:space-between;padding:10px 12px;z-index:12;pointer-events:none}
${s('barBtn')}{pointer-events:auto;border:0;border-radius:18px;background:rgba(0,0,0,.55);color:#fff;font:inherit;padding:8px 14px}
${s('share')}{pointer-events:auto;border:0;border-radius:22px;background:#fff;color:#111;font:600 15px system-ui;padding:10px 18px}
${s('dtop')}{position:sticky;top:0;display:flex;align-items:center;gap:24px;height:60px;padding:0 24px;border-bottom:1px solid #dbdbdb;background:#fff;z-index:2}
${s('dlinks')}{display:flex;gap:8px;margin-left:auto;position:relative}
${s('topEntry')}{margin-left:auto;display:flex;align-items:center}
${s('top')} ~ ${s('menu')}{top:52px;bottom:auto;left:auto;right:8px;transform:none}
${s('navItem')}{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;color:#111;text-decoration:none}
${s('forms')}{display:contents}
${s('hiddenInput')}{display:none}
${s('menuIcon')}{display:inline-flex;align-items:center;gap:10px;padding:12px 16px;cursor:pointer}
${s('footer')}{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:flex-end;padding:10px 12px;z-index:12}
${s('avatar')}{width:24px;height:24px;border-radius:50%;background:#c9a;display:inline-block}
${s('badge')}{display:inline-flex;margin-left:-8px}
${s('modal')}{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:40}
${s('dialogBox')}{background:#fff;color:#111;border-radius:12px;padding:16px 20px;min-width:200px;text-align:center}
${s('progress')}{display:block;width:160px;height:4px;margin:12px auto 0;background:#ddd;border-radius:2px;overflow:hidden}
${s('snack')}{position:fixed;left:8px;right:8px;bottom:72px;display:flex;justify-content:space-between;align-items:center;gap:8px;background:#262626;color:#fff;border-radius:8px;padding:10px 14px;z-index:45}
${s('toastBtn')}{border:0;background:none;color:#4cb5f9;font:600 14px system-ui}
${s('author')}{display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none}
${s('_aa3d')}{position:fixed;left:0;right:0;top:0;display:flex;justify-content:space-between;padding:10px 12px;z-index:12}
${s('_aa3f')}{display:flex;gap:6px}
${s('_aa3e')},${s('_aa3g')},${s('_aa3i')},${s('_aa3j')}{border:0;border-radius:18px;background:rgba(0,0,0,.55);color:#fff;font:inherit;padding:8px 12px}
${s('_aswp')}{border:0;border-radius:22px;background:#fff;color:#111;font:600 15px system-ui;padding:10px 18px;display:inline-flex;align-items:center;gap:8px}
`;
}
