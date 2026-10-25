/** U38 (was U31 in docs/inpage.md §9.2; strategy §11 AM52): frameBox(dpr) and the scaling into the panel. */
import { describe, expect, it } from 'vitest';
import { MSITE_MAX_CSS_WIDTH } from '../ig-contract/contract.ts';
import { frameBox, frameBoxFor, scaleToFit } from './frame-box.ts';

describe('U38 frame box', () => {
  it('§3.11 table: DPR 2 → 540×960, DPR 1 → 720×1280, DPR 3 → 360×640', () => {
    expect(frameBox(2)).toEqual({ w: 540, h: 960 });
    expect(frameBox(1)).toEqual({ w: 720, h: 1280 });
    expect(frameBox(3)).toEqual({ w: 360, h: 640 });
  });

  it('W is even, portrait, inside msite mobile layout, and W × DPR never exceeds 1080 above the floor', () => {
    for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.2, 2.5, 2.625, 3]) {
      const { w, h } = frameBox(dpr);
      expect(w % 2).toBe(0);
      expect(h).toBeGreaterThan(w);
      expect(w).toBeLessThanOrEqual(MSITE_MAX_CSS_WIDTH);
      expect(w * dpr).toBeLessThanOrEqual(1080);
    }
  });

  it('a zoomed-in tab (high DPR) keeps a usable phone width; a bad DPR counts as 1', () => {
    expect(frameBox(5).w).toBe(320);
    expect(frameBox(Number.NaN)).toEqual(frameBox(1));
    expect(frameBox(0)).toEqual(frameBox(1));
  });

  it('toggles', () => {
    expect(frameBoxFor('auto', 2)).toEqual({ w: 540, h: 960 });
    expect(frameBoxFor('540x960', 1)).toEqual({ w: 540, h: 960 });
    expect(frameBoxFor('412x732', 2)).toEqual({ w: 412, h: 732 });
  });

  it('scaleToFit: the largest scale ≤ 1 that fits, both sides', () => {
    expect(scaleToFit({ w: 540, h: 960 }, { w: 400, h: 600 })).toEqual({ scale: 0.625, w: 337, h: 600 });
    expect(scaleToFit({ w: 540, h: 960 }, { w: 270, h: 2000 })).toEqual({ scale: 0.5, w: 270, h: 480 });
    expect(scaleToFit({ w: 540, h: 960 }, { w: 2000, h: 2000 })).toEqual({ scale: 1, w: 540, h: 960 });
    expect(scaleToFit({ w: 0, h: 960 }, { w: 10, h: 10 }).scale).toBe(0);
  });
});
