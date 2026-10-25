/**
 * Repost (docs/repost.md RP-25, RP-27, RP-28, AM56): the repost's look as the owner edits it, as pure
 * reducers. The credit is locked on unless the post is the owner's own (the account instapost knows); a
 * mention has one look (story) and always carries the credit.
 */
import type { CardKind, CardStyle } from './card-layout.ts';
import { clampUserScale, nextLook } from './card-layout.ts';

export type RepostBg = 'colours' | 'blur' | 'black';
export const REPOST_BGS: readonly RepostBg[] = ['colours', 'blur', 'black'];

export interface RepostLook {
  style: CardStyle;
  bg: RepostBg;
  credit: boolean;
  userScale: number;
}

export function defaultLook(kind: CardKind): RepostLook {
  return { style: kind === 'mention' ? 'story' : 'card', bg: 'colours', credit: true, userScale: 1 };
}

/** RP-25: own post = the source says so and its author is the account the composer knows; else not own. */
export function isOwnPost(src: { kind: CardKind; isOwn: boolean; author: string }, account: string | null): boolean {
  return src.kind === 'post' && src.isOwn && account !== null && src.author.toLowerCase() === account.toLowerCase();
}

export function cycleLook(look: RepostLook, kind: CardKind): RepostLook {
  return kind === 'mention' ? look : { ...look, style: nextLook(look.style, kind) };
}

export function withLook(look: RepostLook, style: CardStyle, kind: CardKind): RepostLook {
  if (kind === 'mention') return { ...look, style: 'story' };
  return { ...look, style: style === 'story' ? 'card' : style };
}

/** AM56: the credit can be hidden only on the owner's own post. */
export function withCredit(look: RepostLook, want: boolean, own: boolean): RepostLook {
  return { ...look, credit: own ? want : true };
}

export function withScale(look: RepostLook, s: number, kind: CardKind): RepostLook {
  return { ...look, userScale: clampUserScale(kind, s) };
}

export function withBg(look: RepostLook, bg: RepostBg): RepostLook {
  return REPOST_BGS.includes(bg) ? { ...look, bg } : look;
}
