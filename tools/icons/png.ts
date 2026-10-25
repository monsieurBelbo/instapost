/** PNG encoding with node:zlib only (strategy §7.5): 8-bit RGB or RGBA, no filter, no interlace. */
import { crc32, deflateSync } from 'node:zlib';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** An 8-bit PNG; `pixel(x, y)` returns each pixel's RGB (3 channels) or RGBA (4). */
export function encodePng(
  w: number,
  h: number,
  channels: 3 | 4,
  pixel: (x: number, y: number) => readonly number[],
): Buffer {
  const stride = w * channels + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) raw.set(pixel(x, y).slice(0, channels), row + 1 + x * channels);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  // bit depth 8, colour type RGB (2) or RGBA (6), deflate, no filter set, no interlace
  ihdr.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
