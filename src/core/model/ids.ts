/**
 * Identifier conventions (strategy §3.3). All ids are plain strings so StoryDoc stays
 * JSON; the aliases document intent. Randomness is injected (`UuidFn`), because src/core
 * has no DOM or Node globals: the shell passes `() => crypto.randomUUID()`.
 */

export type DocId = string;
export type FrameId = string;
export type LayerId = string;
/** Lower-case hex SHA-256 of the original asset bytes (IndexedDB `assets` key). */
export type AssetId = string;
export type ExportId = string;
export type HandoffId = string;
/** Per-hand-off secret from crypto.randomUUID(), sent to the agent only via tabs.sendMessage. */
export type Nonce = string;

export type UuidFn = () => string;

export const ID_PREFIX = {
  doc: 'doc',
  frame: 'frm',
  layer: 'lyr',
  export: 'exp',
  handoff: 'hof',
} as const;
export type IdKind = keyof typeof ID_PREFIX;

/** `<prefix>_<uuid>`, e.g. `frm_3b9d…`. */
export function newId(kind: IdKind, uuid: UuidFn): string {
  return `${ID_PREFIX[kind]}_${uuid()}`;
}

/** The kind encoded in an id made by newId(), or null. */
export function idKind(id: string): IdKind | null {
  const prefix = id.slice(0, id.indexOf('_'));
  for (const [kind, p] of Object.entries(ID_PREFIX)) if (p === prefix) return kind as IdKind;
  return null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
export const isAssetId = (s: string): s is AssetId => SHA256_HEX.test(s);
