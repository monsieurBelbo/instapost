/**
 * Toolbar and extension icons per mode, written as PNGs with node:zlib only (strategy §7.5).
 * Guarded builds get diagonal stripes so they cannot be mistaken for the live build:
 * dev red #c62828, mock orange #ef6c00; live is plain violet #6a1b9a.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SIZES = [16, 32, 48, 128] as const;

type Rgb = readonly [number, number, number];
const hex = (h: string): Rgb => [0, 2, 4].map((i) => Number.parseInt(h.slice(1 + i, 3 + i), 16)) as unknown as Rgb;
const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((i) => Math.round((a[i] ?? 0) * (1 - t) + (b[i] ?? 0) * t)) as unknown as Rgb;
const WHITE: Rgb = [255, 255, 255];

const MODES = {
  dev: { base: hex('#c62828'), striped: true },
  mock: { base: hex('#ef6c00'), striped: true },
  live: { base: hex('#6a1b9a'), striped: false },
} as const;

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** 8-bit RGB PNG; `pixel(x, y)` returns the colour of each pixel. */
export function encodePng(w: number, h: number, pixel: (x: number, y: number) => Rgb): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type RGB, deflate, no filter set, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [mode, { base, striped }] of Object.entries(MODES)) {
  const stripe = mix(base, WHITE, 0.55);
  const border = mix(base, [0, 0, 0], 0.35);
  for (const size of SIZES) {
    const period = Math.max(4, Math.round(size / 4));
    const edge = Math.max(1, Math.round(size / 32));
    const png = encodePng(size, size, (x, y) => {
      if (x < edge || y < edge || x >= size - edge || y >= size - edge) return border;
      if (striped && (x + y) % period < period / 2) return stripe;
      return base;
    });
    const dir = resolve(ROOT, 'public/icons', mode);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${size}.png`), png);
  }
  console.log(`public/icons/${mode}/{${SIZES.join(',')}}.png written${striped ? ' (striped)' : ''}`);
}
