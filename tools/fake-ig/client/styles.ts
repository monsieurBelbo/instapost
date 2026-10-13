/** @jsxImportSource react */
/**
 * Cosmetic styles of the fake client. Class names go through `cx()` so `drift=renamed` can
 * randomise them per page load (strategy §6.1 "Markup drift"). Geometry-relevant styles
 * (the composer canvas) are inline, so StoryComposer also works unstyled (B6).
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
  | 'topEntry';

export type Cx = (name: ClassName) => string;

export const plainCx: Cx = (name) => `fk-${name}`;

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
`;
}
