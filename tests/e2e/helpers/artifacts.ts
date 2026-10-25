/**
 * The E2E artifacts and what their manifests must say (strategy §5, §7.9). Both carry the in-page lane
 * (docs/inpage.md §13) beside the window lane; there is no separate in-page artifact any more.
 */
import type { KeyMode } from '../../../tools/chrome/ext-id.ts';

export type ArtifactMode = 'mock' | 'live';

export const ARTIFACTS: Readonly<Record<ArtifactMode, string>> = {
  mock: '.output/chrome-mv3-mock',
  live: '.output/chrome-mv3-live',
};

export const MANIFEST_NAMES: Readonly<Record<ArtifactMode, string>> = {
  mock: 'instapost MOCK',
  live: 'instapost',
};

/** The key each artifact carries. */
export const KEY_OF: Readonly<Record<ArtifactMode, KeyMode>> = { mock: 'mock', live: 'live' };

/** `.output/chrome-mv3-<mode>` → mode. */
export function artifactMode(artifact: string): ArtifactMode {
  const m = /chrome-mv3-(mock|live)\/?$/.exec(artifact);
  if (!m) throw new Error(`e2e: artifact ${artifact} is not .output/chrome-mv3-{mock,live}`);
  return m[1] as ArtifactMode;
}
