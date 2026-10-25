/**
 * RL-16: the import view's error line is decided by the error, not by the notice's text (which mentions HEIC
 * for every decode failure, in both languages): a failed HEIC conversion reads "Couldn't convert this HEIC
 * photo"; a GIF, a TIFF or a damaged JPEG reads "Can't open this file".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { RasterError } from '../raster/errors.ts';
import { errorNotice } from '../ui/editor-state.ts';
import { setLangSetting } from '../ui/i18n.ts';
import { importErrorText, composerStrings as S } from './strings.ts';

afterEach(() => setLangSetting('en'));

const gif = new RasterError('DECODE_FAILED', 'not a JPEG, PNG, WebP or AVIF file (image/gif)');
const jpeg = new RasterError('DECODE_FAILED', 'image/jpeg could not be decoded');
const heic = new RasterError('DECODE_FAILED', 'HEIC: libheif could not decode the image');
const noHeic = new RasterError('DECODE_FAILED', 'HEIC is not supported in this build');

describe('RL-16 the import error line', () => {
  for (const l of ['en', 'es'] as const) {
    it(`${l}: GIF and a corrupt JPEG get "can't open", a failed HEIC its own line`, () => {
      setLangSetting(l);
      expect(importErrorText(errorNotice(gif))).toBe(S.import.error);
      expect(importErrorText(errorNotice(jpeg))).toBe(S.import.error);
      expect(importErrorText(errorNotice(heic))).toBe(S.import.heicError);
      expect(importErrorText(errorNotice(noHeic))).toBe(S.import.heicError);
      expect(S.import.error).not.toBe(S.import.heicError);
      // The notice's own text is the same for all of them (why the text cannot decide).
      expect(errorNotice(gif).text).toBe(errorNotice(heic).text);
    });
  }

  it('other errors keep their own message', () => {
    expect(importErrorText({ kind: 'error', text: 'Something else', code: 'EXPORT_TOO_LARGE' } as never)).toBe(
      'Something else',
    );
    expect(importErrorText(errorNotice(new Error('plain')))).toBe('plain');
  });
});
