// docs/inpage.md §13.7: a dragged or pasted HEIC/HEIF is recognised by its type, its name or its ftyp brand.
import { describe, expect, test } from 'vitest';
import { HEIC_BRANDS, heicByLabel, isPhotoFile, sniffImageMime } from './decode.ts';

/** An ftyp box at offset 0: major brand, minor version 0, then the compatible brands. */
function ftyp(major: string, ...compatible: string[]): Uint8Array<ArrayBuffer> {
  const size = 16 + 4 * compatible.length;
  const b = new Uint8Array(size + 16);
  b.set([(size >> 24) & 255, (size >> 16) & 255, (size >> 8) & 255, size & 255], 0);
  b.set(
    [...`ftyp${major}`].map((c) => c.charCodeAt(0)),
    4,
  );
  b.set(
    [...compatible.join('')].map((c) => c.charCodeAt(0)),
    16,
  );
  return b;
}

describe('heicByLabel', () => {
  test.each([
    ['IMG_0001.HEIC', ''],
    ['IMG_0001.heic', 'application/octet-stream'],
    ['photo.heif', ''],
    ['DSCF0001.HIF', ''],
    ['no-extension', 'image/heic'],
    ['no-extension', 'image/heif'],
    ['burst', 'image/heic-sequence'],
  ])('%s (%s) is HEIC', (name, type) => {
    expect(heicByLabel({ name, type })).toBe(true);
  });

  test.each([
    ['IMG_0001.jpg', 'image/jpeg'],
    ['heic.png', 'image/png'],
    ['notes.heic.txt', 'text/plain'],
    ['', ''],
  ])('%s (%s) is not', (name, type) => {
    expect(heicByLabel({ name, type })).toBe(false);
  });
});

describe('sniffImageMime: HEIF brands', () => {
  test.each(['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heim', 'heis'])('major brand %s → image/heic', (brand) => {
    expect(HEIC_BRANDS).toContain(brand);
    expect(sniffImageMime(ftyp(brand))).toBe('image/heic');
  });

  test('an iPhone ftyp (mif1 major, heic compatible) → image/heic', () => {
    expect(sniffImageMime(ftyp('mif1', 'MiPr', 'miaf', 'MiHB', 'heic'))).toBe('image/heic');
  });

  test('AVIF also lists mif1: avif wins', () => {
    expect(sniffImageMime(ftyp('avif', 'mif1', 'miaf'))).toBe('image/avif');
  });

  test('a video ftyp is not a photo', () => {
    expect(sniffImageMime(ftyp('qt  ', 'qt  '))).toBeNull();
    expect(sniffImageMime(ftyp('isom', 'iso2', 'mp41'))).toBeNull();
  });
});

describe('isPhotoFile', () => {
  test('a HEIC typed "" with no extension counts by its bytes', async () => {
    expect(await isPhotoFile(new File([ftyp('heic', 'mif1')], 'IMG_0001', { type: '' }))).toBe(true);
    expect(await isPhotoFile(new File([ftyp('mif1', 'heic')], 'x', { type: 'application/octet-stream' }))).toBe(true);
  });

  test('by name or type without reading', async () => {
    expect(await isPhotoFile(new File(['not read'], 'IMG_0001.HEIC', { type: '' }))).toBe(true);
    expect(await isPhotoFile(new File(['not read'], 'x', { type: 'image/heic' }))).toBe(true);
    expect(await isPhotoFile(new File(['not read'], 'x.jpg', { type: 'image/jpeg' }))).toBe(true);
  });

  test('a PDF, a text file or a video is not a photo', async () => {
    expect(await isPhotoFile(new File(['%PDF-1.7'], 'a.pdf', { type: 'application/pdf' }))).toBe(false);
    expect(await isPhotoFile(new File(['hello'], 'notes', { type: '' }))).toBe(false);
    expect(await isPhotoFile(new File([ftyp('qt  ')], 'clip.mov', { type: 'video/quicktime' }))).toBe(false);
  });
});
