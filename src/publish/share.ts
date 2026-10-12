/**
 * Phone exit (strategy §2.1 rank 2, P2): the Web Share API with files, which on macOS can reach
 * AirDrop (unverified, research Q24). Offered only when `navigator.canShare({files})` says yes;
 * otherwise the phone lane is Downloads plus Finder's Share menu.
 *
 * `share()` needs transient user activation, so callers should prepare the file before or very
 * quickly after the click; a `not-allowed` outcome means "click Share again".
 */

/** The parts of Navigator this module uses (injectable for tests). */
export interface ShareNavigator {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'not-allowed' | 'unsupported';

const nav = (): ShareNavigator | undefined => (globalThis as { navigator?: ShareNavigator }).navigator;

/** True when this browser can share these files (false when the API is missing). */
export function canShareFiles(files: File[], n: ShareNavigator | undefined = nav()): boolean {
  if (!n?.canShare || !n.share) return false;
  try {
    return n.canShare({ files });
  } catch {
    return false;
  }
}

/** Whether sharing a story JPEG is possible at all here (checked with an empty probe file). */
export function canShareStory(n: ShareNavigator | undefined = nav()): boolean {
  return canShareFiles([new File([], 'story.jpg', { type: 'image/jpeg' })], n);
}

/**
 * Opens the share sheet. `cancelled` when the owner closes it (AbortError), `not-allowed` when the
 * user activation expired (NotAllowedError), `unsupported` when files cannot be shared. Other
 * errors propagate.
 */
export async function shareFiles(
  files: File[],
  meta: { title?: string; text?: string } = {},
  n: ShareNavigator | undefined = nav(),
): Promise<ShareOutcome> {
  if (!n?.share || !canShareFiles(files, n)) return 'unsupported';
  try {
    await n.share({ files, ...meta });
    return 'shared';
  } catch (err) {
    const name = (err as { name?: unknown } | null)?.name;
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') return 'not-allowed';
    throw err;
  }
}
