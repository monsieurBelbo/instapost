/** Hash routing for the editor tab: `#/settings` shows settings, anything else the editor. */
import { signal } from '@preact/signals';

export type Route = 'editor' | 'settings';

const parse = (hash: string): Route => (hash === '#/settings' ? 'settings' : 'editor');

export const route = signal<Route>(typeof location === 'undefined' ? 'editor' : parse(location.hash));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parse(location.hash);
  });
}
