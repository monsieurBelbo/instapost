/** @jsxImportSource react */
/**
 * Small shared pieces: the `role="status"` toast (C7 is diagnostics only, so its text never
 * drives a decision) and a self-hiding toast state.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCx } from './styles.ts';

export function Toast({ text, rotate = false }: { text: string; rotate?: boolean }) {
  const c = useCx();
  return (
    <div role="status" data-testid={rotate ? 'fake-rotate-toast' : 'fake-toast'} className={c('toast')}>
      {text}
    </div>
  );
}

/** `[text, show]`: show(text) displays a toast for `ms`. */
export function useToast(ms = 4000): [string | null, (text: string) => void] {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback(
    (next: string) => {
      setText(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setText(null), ms);
    },
    [ms],
  );
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [text, show];
}
