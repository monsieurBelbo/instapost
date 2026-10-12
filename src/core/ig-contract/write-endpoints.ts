/**
 * Instagram write endpoints as dNR urlFilters, verbatim from research §8.7 (strategy §3.7).
 *
 * Single source for both the static `block_ig_writes` ruleset (guarded builds, SG3) and the
 * per-hand-off rehearsal rules 1002.. (any build, SG5). These are reverse-engineered paths and
 * will change; E8 and E9 prove the rules fire.
 */
export const WRITE_URL_FILTERS = [
  '||instagram.com/rupload_igphoto/',
  '||instagram.com/rupload_igvideo/',
  '||instagram.com/api/v1/media/configure_to_story/',
  '/api/v1/web/create/configure_to_story/',
  '/create/configure_to_story/',
  '/api/v1/media/configure/',
  'configure_sidecar/',
  'configure_to_clips/',
  'configure_to_longform/',
] as const;

export type WriteUrlFilter = (typeof WRITE_URL_FILTERS)[number];
