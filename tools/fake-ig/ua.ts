/**
 * Server-side device classification (strategy §6.1, §7.6), computed from the headers the fake
 * receives (so after dNR). Real Instagram decides from the User-Agent header only (research
 * §5.1); `classifier=client-hints` switches to `sec-ch-ua-mobile`.
 */
import type { Knobs } from './knobs.ts';

/** The `InstagramUserAgent` object the shell embeds. The shape is neutral, not Instagram's markup. */
export interface UaClassification {
  is_mobile: boolean;
  is_ios: boolean;
  is_android: boolean;
  is_ipad: false;
  is_android_tablet: false;
  user_agent: string;
}

/** Lower-case header names. */
export type HeaderBag = Readonly<Record<string, string | undefined>>;

export const MOBILE_UA_RE = /\b(iPhone|iPod|iPad|Android)\b/;
const ANDROID_RE = /Android/;
const IOS_RE = /iPhone|iPod|iPad/;

export function classify(headers: HeaderBag, classifier: Knobs['classifier']): UaClassification {
  const ua = headers['user-agent'] ?? '';
  return {
    is_mobile: classifier === 'client-hints' ? headers['sec-ch-ua-mobile'] === '?1' : MOBILE_UA_RE.test(ua),
    is_ios: IOS_RE.test(ua),
    is_android: ANDROID_RE.test(ua),
    is_ipad: false,
    is_android_tablet: false,
    user_agent: ua,
  };
}
