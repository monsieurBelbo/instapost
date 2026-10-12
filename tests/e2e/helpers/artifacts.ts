/** The two E2E artifacts and what their manifests must say (strategy §5, §7.9). */

export type ArtifactMode = 'mock' | 'live';

export const ARTIFACTS: Readonly<Record<ArtifactMode, string>> = {
  mock: '.output/chrome-mv3-mock',
  live: '.output/chrome-mv3-live',
};

export const MANIFEST_NAMES: Readonly<Record<ArtifactMode, string>> = {
  mock: 'instapost MOCK',
  live: 'instapost',
};

/** `.output/chrome-mv3-<mode>` → mode. */
export function artifactMode(artifact: string): ArtifactMode {
  const m = /chrome-mv3-(mock|live)\/?$/.exec(artifact);
  if (!m) throw new Error(`e2e: artifact ${artifact} is not .output/chrome-mv3-{mock,live}`);
  return m[1] as ArtifactMode;
}
