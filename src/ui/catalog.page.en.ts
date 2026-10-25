/**
 * The in-page content script's texts in English (strategy §11 AM48; inpage-ui-spec.md FE6, FE8): the entry
 * ("New story") on Instagram's desktop page, its tooltip and accessible name, and the one-time coach mark.
 * Part of the editor's catalog (`catalog.en.ts` spreads it, so i18n.test.ts checks it with every other key);
 * a separate file because the content script imports only these (and `catalog.page.es.ts`), never the
 * whole catalog. Since docs/repost.md RP-12 also the repost entries (Add to story by Instagram's Share
 * dialog, Add to your story on a story mention). The shortcut's keys (as the browser spells them, RL-10) and
 * the frame's title (instapost) are not words and stay out of the catalog.
 */
export const PAGE_EN = {
  'page.entry.label': 'New story',
  'page.entry.name': 'instapost: new story',
  'page.entry.tip': 'instapost · New story',
  'page.entry.posting': 'Posting…',
  'page.entry.postingName': 'instapost: posting in another Instagram tab. Open.',
  'page.entry.postingTip': 'Posting in another Instagram tab · step {step} of {of}',
  'page.entry.posted': 'Posted',
  'page.entry.postedTip': 'Posted to @{handle}’s story',
  'page.entry.postedTipYours': 'Posted to your story',
  'page.entry.notPosted': 'Not posted',
  'page.entry.notPostedTip': 'Not posted · Open instapost to see why',
  'page.entry.unknown': 'Check your story',
  'page.entry.unknownTip': 'Couldn’t confirm · Check your story',
  'page.entry.resultName': 'instapost: {label}.',
  'page.entry.paused': 'Paused',
  'page.entry.pausedTip': 'Desktop posting is paused until {until}',
  'page.entry.pausedName': 'instapost: paused until {until}. Open.',
  'page.coach.title': 'Post a story from here',
  'page.coach.body': 'instapost opens over Instagram, so you never leave the page.',
  'page.coach.key': 'Shortcut',
  'page.coach.ok': 'Got it',
  // Repost (docs/repost.md RP-12): Share → Add to story, and Add to your story on a story mention.
  'page.repost.add': 'Add to story',
  'page.repost.addName': 'instapost: add this post to your story',
  'page.repost.with': 'with instapost',
  'page.repost.mention': 'Add to your story',
  'page.repost.mentionName': 'instapost: add @{handle}’s story to yours',
  'page.repost.video': 'Videos come later',
  'page.repost.blocked': '@{handle} doesn’t allow sharing this post',
  'page.repost.busy': 'Wait until the current post finishes',
  'page.repost.expired': 'This story has expired',
} as const;

export type PageKey = keyof typeof PAGE_EN;
export type PageCatalog = { readonly [K in PageKey]: string };
