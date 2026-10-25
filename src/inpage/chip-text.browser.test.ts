/**
 * RL-7 (inpage-ui-spec.md FS8): every text the chip shows fits its line, in English and in Spanish, with the
 * composer's own CSS: the chip in the slot of a wide navigation's entry (Instagram's Profile row, 220 px), and in
 * the 240-px top-right fallback. An ellipsis there would cut the one instruction that matters ("Hands off until
 * Share", "Uploading — browse freely").
 */
import '../../entrypoints/composer/composer.css';
import { afterEach, describe, expect, it } from 'vitest';
import { EN } from '../ui/catalog.en.ts';
import { ES } from '../ui/catalog.es.ts';
import { fill } from '../ui/i18n-core.ts';

const ARGS = { clock: '12:34', left: '0:59', time: '14:05' };
/** The chip's two lines, as Chip.tsx and run-view.ts pair them. */
const LINE1 = [
  'posting',
  'testing',
  'checking',
  'queued',
  'posted',
  'testPassed',
  'stopped',
  'notPosted',
  'unknown',
  'checked',
];
const LINE2 = ['handsOff', 'uploading', 'queuedNote', 'postedNote', 'nothing', 'seeWhy', 'checkStory'];

afterEach(() => {
  document.body.innerHTML = '';
});

function overflow(width: number, t1: string, t2: string): { t1: number; t2: number } {
  // A transformed slot: the chip's `position: fixed; inset: 0` fills it, as it fills its iframe.
  const slot = document.createElement('div');
  Object.assign(slot.style, { position: 'relative', width: `${width}px`, height: '76px', transform: 'translateZ(0)' });
  slot.innerHTML =
    '<button type="button" class="chip"><span class="chip-thumb"></span><span class="chip-txt">' +
    '<span class="chip-t1"></span><span class="chip-t2"></span></span></button>';
  document.body.append(slot);
  const a = slot.querySelector('.chip-t1') as HTMLElement;
  const b = slot.querySelector('.chip-t2') as HTMLElement;
  a.textContent = t1;
  b.textContent = t2;
  const r = { t1: a.scrollWidth - a.clientWidth, t2: b.scrollWidth - b.clientWidth };
  slot.remove();
  return r;
}

describe('RL-7 the chip’s texts fit', () => {
  for (const [lang, cat] of [
    ['en', EN],
    ['es', ES],
  ] as const) {
    for (const width of [220, 240]) {
      it(`${lang}, ${width} px`, () => {
        const text = (k: string) => fill((cat as Record<string, string>)[`inpage.chip.${k}`] ?? '?', ARGS);
        const cut: string[] = [];
        for (const k of LINE1) if (overflow(width, text(k), '').t1 > 0) cut.push(`line 1 ${k}: ${text(k)}`);
        for (const k of LINE2) if (overflow(width, '', text(k)).t2 > 0) cut.push(`line 2 ${k}: ${text(k)}`);
        expect(cut).toEqual([]);
      });
    }
  }

  it('the measurement sees a cut (positive control)', () => {
    expect(overflow(220, 'x'.repeat(80), 'y'.repeat(80))).toMatchObject({
      t1: expect.any(Number),
      t2: expect.any(Number),
    });
    const o = overflow(220, 'x'.repeat(80), 'y'.repeat(80));
    expect(o.t1).toBeGreaterThan(0);
    expect(o.t2).toBeGreaterThan(0);
  });
});
