/**
 * U6 (strategy §7.11): quality stepping with an injected encoder stops at the first result of
 * 8 MB or less; EXPORT_TOO_LARGE below 0.72; PNG for msite, JPEG otherwise.
 */
import { describe, expect, it } from 'vitest';
import {
  type Encode,
  type ExportMime,
  encodeWithPolicy,
  formatFor,
  JPEG_QUALITY_STEPS,
  MAX_EXPORT_BYTES,
} from './policy.ts';

/** Records every call; the size comes from `sizeAt(quality)`. */
function fakeEncoder(sizeAt: (mime: ExportMime, q: number | undefined) => number) {
  const calls: [ExportMime, number | undefined][] = [];
  const encode: Encode<string> = async (mime, quality) => {
    calls.push([mime, quality]);
    return { size: sizeAt(mime, quality), out: `${mime}@${quality ?? '-'}` };
  };
  return { encode, calls };
}

const MB = 1_000_000;

describe('U6 export policy', () => {
  it('formats: PNG for msite, JPEG otherwise', () => {
    expect(formatFor('msite')).toBe('image/png');
    expect(formatFor('phone')).toBe('image/jpeg');
    expect(formatFor('download')).toBe('image/jpeg');
  });

  it.each(['download', 'phone'] as const)('%s: one JPEG encode at 0.92 when it already fits', async (purpose) => {
    const { encode, calls } = fakeEncoder(() => 3 * MB);
    expect(await encodeWithPolicy(purpose, encode)).toEqual({
      ok: true,
      mime: 'image/jpeg',
      quality: 0.92,
      size: 3 * MB,
      out: 'image/jpeg@0.92',
    });
    expect(calls).toEqual([['image/jpeg', 0.92]]);
  });

  it('steps down and stops at the first result of 8 MB or less (inclusive)', async () => {
    const sizes = new Map<number | undefined, number>([
      [0.92, 12 * MB],
      [0.88, 9 * MB],
      [0.84, MAX_EXPORT_BYTES],
      [0.8, 6 * MB],
    ]);
    const { encode, calls } = fakeEncoder((_m, q) => sizes.get(q) ?? 1);
    const r = await encodeWithPolicy('download', encode);
    expect(r).toMatchObject({ ok: true, quality: 0.84, size: MAX_EXPORT_BYTES, out: 'image/jpeg@0.84' });
    expect(calls.map(([, q]) => q)).toEqual([0.92, 0.88, 0.84]);
  });

  it('EXPORT_TOO_LARGE when even 0.72 is over the limit; never encodes below 0.72', async () => {
    const { encode, calls } = fakeEncoder((_m, q) => Math.round(20 * MB * (q ?? 1)));
    const r = await encodeWithPolicy('phone', encode);
    expect(r).toEqual({ ok: false, code: 'EXPORT_TOO_LARGE', smallestSize: Math.round(20 * MB * 0.72) });
    expect(calls.map(([, q]) => q)).toEqual([...JPEG_QUALITY_STEPS]);
    expect(Math.min(...calls.map(([, q]) => q ?? 1))).toBe(0.72);
    expect(calls.every(([mime]) => mime === 'image/jpeg')).toBe(true);
  });

  it('one byte over the limit is too large', async () => {
    const { encode } = fakeEncoder(() => MAX_EXPORT_BYTES + 1);
    expect(await encodeWithPolicy('download', encode)).toMatchObject({ ok: false, code: 'EXPORT_TOO_LARGE' });
  });

  it('msite: a single PNG encode, no quality, no stepping, no size cap', async () => {
    const { encode, calls } = fakeEncoder(() => 14 * MB);
    expect(await encodeWithPolicy('msite', encode)).toEqual({
      ok: true,
      mime: 'image/png',
      quality: null,
      size: 14 * MB,
      out: 'image/png@-',
    });
    expect(calls).toEqual([['image/png', undefined]]);
  });

  it('propagates encoder failures', async () => {
    const encode: Encode<string> = async () => {
      throw new Error('ENCODE_FAILED');
    };
    await expect(encodeWithPolicy('download', encode)).rejects.toThrow('ENCODE_FAILED');
  });
});
