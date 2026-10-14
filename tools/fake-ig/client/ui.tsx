/** @jsxImportSource react */
/**
 * Small shared pieces: Instagram's toasts and the composer's landscape snackbar.
 *
 * - **Toasts** (PolarisToastWrapper, IF6): `[role=alert][aria-live=polite][aria-atomic=true]
 *   [data-visualcompletion=ignore]` in the snackbar area, TOAST_MS long; `persist` toasts survive one
 *   navigation (persistOnNavigate). An action toast ("Upload failed." with Retry) holds a `button._aswp`.
 *   The shell owns them (ToastContext), so a toast shown on the composer is still there on home. C7: their
 *   text is diagnostics only and never drives a decision.
 * - **Snackbar** (AM37): the composer page's rotate snackbar (`._aa3b`), shown for as long as its landscape
 *   gate holds; the page then renders no header and no Share footer.
 */
import { createContext, type MouseEvent, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { TOAST_MS } from '../protocol.ts';
import { logStep, pageLang } from './control.ts';
import { useCx } from './styles.ts';

export interface ToastSpec {
  text: string;
  /** `rotate`: the session start's "Rotate your device" toast. */
  kind?: 'plain' | 'rotate';
  action?: { label: string; onAction: (e: MouseEvent<HTMLButtonElement>) => void };
  /** Survives one navigation (Instagram's persistOnNavigate). */
  persist?: boolean;
}

interface Shown extends ToastSpec {
  id: number;
}

export interface Toasts {
  show(t: ToastSpec): void;
  /** A route change: non-persistent toasts go, persistent ones lose their persistence. */
  navigated(): void;
}

export const ToastContext = createContext<Toasts>({ show: () => undefined, navigated: () => undefined });
export const useToasts = (): Toasts => useContext(ToastContext);

/** The shell's toast state: `[shown, api]`. */
export function useToastState(): [Shown[], Toasts] {
  const [shown, setShown] = useState<Shown[]>([]);
  const next = useRef(0);
  const timers = useRef(new Map<number, number>());
  const drop = useCallback((id: number) => {
    setShown((all) => all.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);
  const show = useCallback(
    (t: ToastSpec) => {
      // AM45: what the toast said, in the page's language (E45; diagnostics only, the agent never reads it).
      logStep('toast', { text: t.text, action: t.action?.label ?? null, kind: t.kind ?? 'plain', lang: pageLang() });
      const id = ++next.current;
      setShown((all) => [...all.filter((x) => x.kind !== t.kind || x.text !== t.text), { ...t, id }]);
      timers.current.set(
        id,
        window.setTimeout(() => drop(id), TOAST_MS),
      );
    },
    [drop],
  );
  const navigated = useCallback(() => {
    setShown((all) => {
      for (const t of all) {
        if (t.persist) continue;
        const timer = timers.current.get(t.id);
        if (timer !== undefined) window.clearTimeout(timer);
        timers.current.delete(t.id);
      }
      return all.filter((t) => t.persist).map((t) => ({ ...t, persist: false }));
    });
  }, []);
  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const timer of all.values()) window.clearTimeout(timer);
    };
  }, []);
  return [shown, { show, navigated }];
}

export function ToastList({ toasts }: { toasts: Shown[] }) {
  const c = useCx();
  if (toasts.length === 0) return null;
  return (
    <div className={c('toasts')} style={{ top: 'auto', bottom: 72 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          aria-live="polite"
          aria-atomic="true"
          data-visualcompletion="ignore"
          data-testid={t.kind === 'rotate' ? 'fake-rotate-toast' : t.action ? 'fake-action-toast' : 'fake-toast'}
          className={c('toast')}
          style={{ pointerEvents: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}
        >
          <span>{t.text}</span>
          {t.action ? (
            <button
              type="button"
              className={`${c('_aswp')} ${c('toastBtn')}`}
              data-testid="fake-toast-action"
              onClick={t.action.onAction}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function Snackbar({ text }: { text: string }) {
  const c = useCx();
  // AM45: logged once per showing, like the toasts (E45 reads the text; the agent never does).
  useEffect(() => {
    logStep('snackbar', { text, lang: pageLang() });
  }, [text]);
  return (
    <div role="status" data-testid="fake-landscape-snackbar" className={`${c('_aa3b')} ${c('toast')}`}>
      {text}
    </div>
  );
}

/** A placeholder avatar (no network): a coloured circle as a data-URI image. */
export const AVATAR_SRC =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"%3E%3Ccircle cx="12" cy="12" r="12" fill="%23c9a"/%3E%3C/svg%3E';

/** An inline glyph like Instagram's icons: an svg with one path (no text, no ARIA the agent reads). */
export function Glyph({ d, label }: { d: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-label={label}
      role={label ? 'img' : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d={d} />
    </svg>
  );
}

export const GLYPH = {
  create:
    'M2 12v3.45c0 2.849.698 4.005 1.606 4.944.94.909 2.098 1.608 4.946 1.608h6.896c2.848 0 4.006-.7 4.946-1.608C21.302 19.455 22 18.3 22 15.45V8.552c0-2.849-.698-4.006-1.606-4.945C19.454 2.7 18.296 2 15.448 2H8.552c-2.848 0-4.006.699-4.946 1.607C2.698 4.547 2 5.703 2 8.552ZM6.545 12.001h10.91M12.003 6.545v10.91',
  story: 'M12 2a10 10 0 1 0 10 10M12 7v10M7 12h10',
  post: 'M3 3h18v18H3zM8 12h8M12 8v8',
  reel: 'M2 7h20M7 2l3 5M14 2l3 5M10 11l5 3-5 3z',
  newStory: 'M12 3a9 9 0 1 0 9 9M12 8v8M8 12h8',
  facebook: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 6h2V5h-2a3 3 0 0 0-3 3v2H8v3h2v6h3v-6h2l1-3h-3V8z',
} as const;
