/**
 * Build mode for extension code (strategy §5). Only for code bundled by WXT/Vite:
 * `import.meta.env.MODE` is replaced at build time. Fails closed: anything that is not
 * exactly `live` is guarded (development, mock, and `test` under Vitest).
 */

export type BuildMode = 'development' | 'mock' | 'live';

const raw: string = import.meta.env.MODE;

export const MODE: BuildMode | 'test' = raw === 'development' || raw === 'mock' || raw === 'live' ? raw : 'test';

/** development and mock: static write-block ruleset and fake-marker guard (SG3, SG4). */
export const GUARDED: boolean = MODE !== 'live';
