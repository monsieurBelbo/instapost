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

/**
 * ux.md §6.1, docs/contract.md C13 (the autopilot spike, 2026-10-13, from Instagram's saved msite bundles):
 * after Share, Instagram's own client uploads the photo to `i.instagram.com/rupload_igphoto/fb_uploader_<id>`
 * (XHR, no timeout, no retry), then publishes it with `/api/v1/media/configure_to_story/` on the page's own
 * host (XHR, 60 s timeout). The outcome rules (src/core/handoff/outcome.ts) classify the agent's resource
 * timing entries with these. Only the background may hold them (check-bundle T3).
 */
export const UPLOAD_HOST = 'i.instagram.com';
/** A pathname (query dropped) of the photo upload. */
export const UPLOAD_PATH = /^\/rupload_igphoto\/fb_uploader_\d+\/?$/;
export const PUBLISH_HOST = 'www.instagram.com';
/** The pathname of the publish request, with or without its trailing slash. */
export const PUBLISH_PATHS: readonly string[] = [
  '/api/v1/media/configure_to_story/',
  '/api/v1/media/configure_to_story',
];
