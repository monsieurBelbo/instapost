/**
 * inpage-ui-spec.md FC3, FS7, FS8: the dialog, the live phone's slots and the chip, from the viewport alone
 * (the composer and the content script compute the same rects).
 */
import { describe, expect, it } from 'vitest';
import { chipPlace, dialogLayout, largeSlot, pipSlot, previewSlot, thumbSlot } from './geometry.ts';

describe('FC3 dialog geometry', () => {
  it('matches the spec table', () => {
    const at = (w: number, h: number) => {
      const l = dialogLayout(w, h);
      return [l.dlgW, l.dlgH, l.stageW, l.bodyH];
    };
    expect(at(1280, 800)).toEqual([711, 704, 371, 660]);
    expect(at(1030, 700)).toEqual([682, 652, 342, 608]);
    expect(at(1440, 900)).toEqual([768, 804, 428, 760]);
    expect(at(1920, 1080)).toEqual([846, 944, 506, 900]);
  });

  it('centres the dialog; the stage sits under the 44-px header, flush left', () => {
    const l = dialogLayout(1280, 800);
    expect(l.left).toBe(Math.round((1280 - 711) / 2));
    expect(l.top).toBe(48);
    expect(l.stage).toEqual({ x: l.left, y: l.top + 44, w: 371, h: 660 });
  });

  it('the import view is narrower (at least 420) and the rail is 300 under 1000 wide', () => {
    expect(dialogLayout(1280, 800, true).dlgW).toBe(420);
    expect(dialogLayout(990, 800).railW).toBe(300);
  });
});

describe('FS7 live preview slots', () => {
  const stage = { x: 100, y: 50, w: 371, h: 660 };
  it('Small: bottom right, 12-px inset, 30 % wide within 96–140, 9:16', () => {
    const s = pipSlot(stage);
    expect(s.w).toBe(111);
    expect(s.h).toBe(197);
    expect(s.x + s.w).toBe(stage.x + stage.w - 12);
    expect(s.y + s.h).toBe(stage.y + stage.h - 12);
    expect(s.r).toBe(10);
  });
  it('Large: centred under a 48-px band, stage height − 60', () => {
    const s = largeSlot(stage);
    expect(s.y).toBe(stage.y + 48);
    expect(s.h).toBe(600);
    expect(s.x - stage.x).toBe(Math.round((stage.w - s.w) / 2));
  });
  it('Hidden: the whole stage', () => {
    expect(previewSlot(stage, 'hidden')).toEqual({ ...stage, r: 0 });
  });
});

describe('FS8 chip', () => {
  it('replaces a row with room, compact in the collapsed nav, else top right', () => {
    const row = { kind: 'row' as const, rect: { x: 12, y: 500, w: 220, h: 48 }, room: 200 };
    expect(chipPlace(row, 1280)).toEqual({ rect: { x: 12, y: 500, w: 220, h: 76 }, compact: false });
    expect(chipPlace({ ...row, kind: 'tile', rect: { ...row.rect, w: 48 } }, 1100).compact).toBe(true);
    expect(chipPlace({ ...row, room: 60 }, 1280).rect).toEqual({ x: 1280 - 16 - 240, y: 16, w: 240, h: 76 });
    expect(chipPlace(null, 1280).rect.x).toBe(1024);
    // RL-9: right to left, the fallback chip mirrors to the top left.
    expect(chipPlace(null, 1280, true).rect).toEqual({ x: 16, y: 16, w: 240, h: 76 });
  });
  it('the thumbnail is 36×64, 6 px in', () => {
    expect(thumbSlot({ x: 10, y: 20, w: 220, h: 76 })).toEqual({ x: 16, y: 26, w: 36, h: 64, r: 6 });
  });
});
