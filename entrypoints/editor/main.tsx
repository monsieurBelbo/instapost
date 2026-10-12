import { render } from 'preact';
import '../../src/ui/editor.css';
import { App } from './App.tsx';

const root = document.getElementById('app');
if (!root) throw new Error('editor: #app missing');

// A file dropped outside the stage must not navigate the tab away from the editor.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
}

render(<App />, root);
