/**
 * Lane picker, minimal (strategy §2.2, §7.10; the full picker is P7). The desktop (msite) lane
 * carries a photo with burned-in content only. Anything Instagram adds in the app forces the
 * phone lane: video, the licensed music sticker, interactive stickers and Close Friends. The words for
 * each reason are the editor's (src/ui/copy.ts `laneReasonText`, both languages).
 */
import type { Frame } from '../core/model/story.ts';

export type LaneReason = 'video' | 'music' | 'stickers' | 'closeFriends';

export interface LaneDecision {
  /** The msite hand-off may be offered for this frame. */
  desktop: boolean;
  /** Why not, in a stable order; empty when `desktop`. */
  reasons: LaneReason[];
}

export function laneFor(frame: Frame): LaneDecision {
  const has = (r: LaneReason): boolean => {
    switch (r) {
      case 'video':
        return frame.durationMs !== null || frame.layers.some((l) => l.kind === 'video');
      case 'music':
        return (
          frame.musicPlan !== undefined || frame.layers.some((l) => l.kind === 'placeholder' && l.purpose === 'music')
        );
      case 'stickers':
        return frame.layers.some((l) => l.kind === 'placeholder' && l.purpose !== 'music' && l.purpose !== 'other');
      case 'closeFriends':
        return frame.audience === 'closeFriends';
    }
  };
  const reasons = (['video', 'music', 'stickers', 'closeFriends'] as const).filter(has);
  return { desktop: reasons.length === 0, reasons };
}
