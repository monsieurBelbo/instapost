/**
 * Toolbar and extension icons per mode, written as PNGs with node:zlib only (strategy §7.5).
 * Live (RL-5, inpage-ui-spec.md FE9/FR12): instapost's mark (the portrait card with an up arrow and the jade dot)
 * on a dark rounded tile, RGBA (tools/icons/mark.ts). Guarded builds keep their flat squares with diagonal
 * stripes so they cannot be mistaken for the live build: dev red #c62828, mock orange #ef6c00.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { markPixels } from '../tools/icons/mark.ts';
import { encodePng } from '../tools/icons/png.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ICON_SIZES = [16, 32, 48, 128] as const;

type Rgb = readonly [number, number, number];
const hex = (h: string): Rgb => [0, 2, 4].map((i) => Number.parseInt(h.slice(1 + i, 3 + i), 16)) as unknown as Rgb;
const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((i) => Math.round((a[i] ?? 0) * (1 - t) + (b[i] ?? 0) * t)) as unknown as Rgb;
const WHITE: Rgb = [255, 255, 255];

const STRIPED = {
  dev: hex('#c62828'),
  mock: hex('#ef6c00'),
} as const;

/** The live icon at `size` px (the FE9 mark). */
export const liveIcon = (size: number): Buffer => encodePng(size, size, 4, markPixels(size));

function write(mode: string, size: number, png: Buffer): void {
  const dir = resolve(ROOT, 'public/icons', mode);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${size}.png`), png);
}

if (import.meta.main) {
  for (const [mode, base] of Object.entries(STRIPED)) {
    const stripe = mix(base, WHITE, 0.55);
    const border = mix(base, [0, 0, 0], 0.35);
    for (const size of ICON_SIZES) {
      const period = Math.max(4, Math.round(size / 4));
      const edge = Math.max(1, Math.round(size / 32));
      const png = encodePng(size, size, 3, (x, y) => {
        if (x < edge || y < edge || x >= size - edge || y >= size - edge) return border;
        if ((x + y) % period < period / 2) return stripe;
        return base;
      });
      write(mode, size, png);
    }
    console.log(`public/icons/${mode}/{${ICON_SIZES.join(',')}}.png written (striped)`);
  }
  for (const size of ICON_SIZES) write('live', size, liveIcon(size));
  console.log(`public/icons/live/{${ICON_SIZES.join(',')}}.png written (the FE9 mark)`);
}
