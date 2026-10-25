/**
 * The composer (inpage-ui-spec.md, "Create dialog, quiet entry"): an extension page the content script
 * frames in the Instagram tab. Full viewport while open (scrim, dialog, outside close button), the chip
 * while hidden, 0×0 while closed. The editor (import, the stage, text, safe zones, drafts) and Post story,
 * the run with the live phone as a picture-in-picture, the results, and Settings → Advanced (Check, Share
 * test, Diagnostics). It talks to its page and to the driver over PANEL_PORT only; the background knows its
 * tab from the port's sender, so a run always belongs to the Instagram tab this composer is in.
 */
import { render } from 'preact';
import './composer.css';
import { enableHeic } from '../../src/raster/decode.ts';
import { App } from './App.tsx';

// docs/inpage.md §13.7: HEIC/HEIF import, its worker and libheif's wasm load on the first HEIC only.
enableHeic(() => import('../../src/raster/heic.ts'));

const root = document.getElementById('app');
if (!root) throw new Error('composer: #app missing');
render(<App />, root);
