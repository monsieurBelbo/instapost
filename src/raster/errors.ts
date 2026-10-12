/**
 * Errors raised by the DOM-side raster modules. The three editor error codes of strategy §3.10
 * (FONT_NOT_LOADED, DECODE_FAILED, EXPORT_TOO_LARGE) are shown in the editor and never reach
 * the hand-off reducer. MISSING_ASSET and NO_CONTEXT are programming or platform faults.
 */

export type RasterErrorCode = 'FONT_NOT_LOADED' | 'DECODE_FAILED' | 'EXPORT_TOO_LARGE' | 'MISSING_ASSET' | 'NO_CONTEXT';

/** The message starts with the code, e.g. `FONT_NOT_LOADED: gabarito`. */
export class RasterError extends Error {
  readonly code: RasterErrorCode;
  constructor(code: RasterErrorCode, detail: string, options?: { cause?: unknown }) {
    super(`${code}: ${detail}`, options);
    this.name = 'RasterError';
    this.code = code;
  }
}

export const isRasterError = (e: unknown, code?: RasterErrorCode): e is RasterError =>
  e instanceof RasterError && (code === undefined || e.code === code);
