/**
 * The site's English words: a short main page and a plain details page. Inline HTML is allowed (<strong>, <code>, <b>);
 * {v} {size} are filled by page.ts from the release. Every fact traces to the verified facts sheet: don't add a claim
 * without one, and don't add a sentence to the main page without taking one out (site.test.ts counts the words).
 */
export interface Section {
  title: string;
  items: readonly string[];
}

export interface Copy {
  lang: 'en' | 'es';
  locale: string;
  otherLang: { label: string; hreflang: 'en' | 'es' };
  title: string;
  description: string;
  ogAlt: string;
  /** One line each: a full stop at a line's end is drawn as the mark's dot. */
  h1: readonly [string, string, string, string];
  sub: string;
  kind: string;
  phone: string;
  download: string;
  downloadMeta: string;
  prerelease: string;
  noRelease: string;
  risk: string;
  entry: string;
  shotAlt: string;
  caption: string;
  statement: readonly [string, string, string, string];
  posting: string;
  postingAlt: string;
  repost: string;
  repostAlt: string;
  installHead: string;
  steps: readonly [string, string, string, string, string];
  wellFolder: string;
  wellDev: string;
  wellLoad: string;
  copy: string;
  copied: string;
  copyFail: string;
  browserChrome: string;
  browserArc: string;
  line: string;
  detailsLink: string;
  source: string;
  legal: string;
  details: {
    title: string;
    description: string;
    head: string;
    limits: Section;
    reposts: Section;
    risk: Section;
    tried: Section;
    data: Section;
    permissions: Section;
    updating: Section;
    versionHead: string;
    newIn: string;
    allChanges: string;
    pictures: Section;
    foot: {
      changelog: string;
      older: string;
      problem: string;
      licence: string;
      font: string;
      asIs: string;
      affiliation: string;
      hosting: string;
    };
  };
  notFound: { head: string; body: string; link: string };
}

export const EN: Copy = {
  lang: 'en',
  locale: 'en_US',
  otherLang: { label: 'Español', hreflang: 'es' },
  title: 'instapost: post Instagram stories from your computer',
  description:
    'A free browser extension that adds New story to Instagram on the web. Photos only, installed by hand, at your own risk. Not affiliated with Instagram.',
  ogAlt: 'Phone down. Story up. instapost: post photo stories to Instagram from your computer.',
  h1: ['Phone', 'down.', 'Story', 'up.'],
  sub: 'Post photo stories to Instagram from your computer.',
  kind: 'A free extension for Arc and Chrome.',
  phone: 'Open this on a computer.',
  download: 'Download {v}',
  downloadMeta: '{size}. Photos only.',
  prerelease: 'Preview release.',
  noRelease: 'No download yet.',
  risk: 'It works outside Instagram’s terms: your account, your risk. Try a secondary one first.',
  entry: 'New story',
  shotAlt:
    'The instapost window. On the left, a mountain lake photo with the words First light, framed as a story. On the right, controls for the text’s style, colour and size, and a Post story button.',
  caption: 'Drop a photo. Crop it. Add text.',
  statement: ['Post the', 'photo.', 'Skip the', 'doomscroll.'],
  posting: 'Usually 15 to 25 seconds. Hands off, tab in front.',
  postingAlt: 'A story of a purple sunset over hills, with the words Golden hour and a round check mark over it.',
  repost: 'Repost a photo post, as a picture.',
  repostAlt: 'A story showing a photo post of a mountain lake as a card, with the handle a.friend.example on top.',
  installHead: 'Install it by hand.',
  steps: [
    '<strong>Unzip.</strong> Move the folder out of Downloads and leave it there.',
    '<strong>Copy yours.</strong> Paste it in a new tab.',
    '<strong>Turn on Developer mode,</strong> top right.',
    '<strong>Click Load unpacked.</strong> Choose the instapost folder.',
    '<strong>Open or reload Instagram.</strong> New story is in the left sidebar.',
  ],
  wellFolder: 'instapost',
  wellDev: 'Developer mode',
  wellLoad: 'Load unpacked',
  copy: 'Copy',
  copied: 'Copied',
  copyFail: 'Select and copy',
  browserChrome: 'Chrome',
  browserArc: 'Arc',
  line: 'Tried on real Instagram only in Arc on a Mac, with a secondary account.',
  detailsLink: 'Limits, risk, data, updates',
  source: 'Source',
  legal: 'Not affiliated with Instagram or Meta. © 2026 monsieurBelbo.',
  details: {
    title: 'instapost: limits, risk, data, updates',
    description: 'What instapost can’t do, what it risks, what it keeps and sends, and how to update or remove it.',
    head: 'Details.',
    limits: {
      title: 'Limits',
      items: [
        'One photo per story: JPEG, PNG, WebP, AVIF, HEIC (iPhone’s untested). No GIF, TIFF, video, Reels.',
        'One text box. No music, mentions, links, polls, stickers, Close Friends, drawing, scheduling.',
        'First press: Run setup test, about 20 seconds, posts nothing.',
        'Hands off, tab in front until Share; page open after.',
        'Posted means Instagram answered; otherwise Couldn’t confirm: check your story. No retries.',
        '60 seconds between stories, 6 an hour, 15 a day; failures count.',
        'Desktop Chrome or Arc, Chromium 155+, logged in, same profile, not Incognito.',
        'No New story? On Instagram: Extensions menu, instapost’s icon.',
      ],
    },
    reposts: {
      title: 'Reposts',
      items: [
        'Photo posts: Share → Add to story. Picture showing others’ @handle: no sticker, tap-through or author notice.',
        'Photo stories mentioning you: DM previews, under 24h, English/Spanish Instagram.',
        'Repost only with permission.',
      ],
    },
    risk: {
      title: 'Risk',
      items: [
        'It works outside Instagram’s terms: your account, your risk. Try a secondary one first.',
        'Instagram can tell: its code sees button (every page), frame; servers, unusual posts.',
        'Only during a post or test, in that tab: phone-sized mobile Instagram, Android requests, portrait script, simulated taps.',
        '<code>User-Agent</code>, <code>Sec-CH-UA-Mobile</code>, <code>Sec-CH-UA-Platform</code> say Android; <code>X-Frame-Options</code>, detailed client hints removed; <code>Sec-Fetch-Dest</code>: <code>document</code>.',
        'If Instagram changes break it before Share, it stops.',
        'A security check can take over the tab, pausing posts 7 days; instapost says to complete it on your phone.',
        'Whoever can change the folder can run code in your logged-in Instagram. <a href="../">Get it here.</a>',
      ],
    },
    tried: {
      title: 'Where it’s run',
      items: [
        '<b>Real Instagram:</b> only Arc on Mac, secondary account; photo-post reposts lightly.',
        '<b>Automated only:</b> Chromium 155, 156.',
        '<b>Not on real Instagram:</b> Google Chrome, main, Creator, Business accounts, other languages, mention reposts.',
        '<b>Never:</b> Edge, Brave, Windows, Linux.',
      ],
    },
    data: {
      title: 'Your data',
      items: [
        'No server, no analytics, here or in it. Stays on your computer.',
        'While the page stays open, failed or unconfirmed stories go to Downloads/instapost, except reposts.',
        'Copy diagnostics: clipboard only; username, recent runs, pages, reposted @handles. Read before pasting.',
        'Goes out: your story, to Instagram; reposts fetch image, avatar from its image server, once your browser asks, no cookies.',
      ],
    },
    permissions: {
      title: 'Permissions',
      items: [
        'Storage, downloads, scripting, network rules, request watching, on Instagram; optionally *.cdninstagram.com, *.fna.fbcdn.net.',
        'Browser: “Read and change your data”, “Manage your downloads”, “Block content on any page”.',
        'Not tabs, cookies, debugger, all sites.',
        'Reads username, shared post, DM text around story links.',
      ],
    },
    updating: {
      title: 'Updating. Removing.',
      items: [
        'No auto-updates. Replace folder contents, click ↻ on instapost, reload Instagram. Settings stay.',
        'Arc keeps the old one? Remove, Load unpacked.',
        'Remove deletes settings, drafts, recent photos, history; then delete the folder and Downloads/instapost.',
      ],
    },
    versionHead: 'This version',
    newIn: 'New in {v}.',
    allChanges: 'All changes',
    pictures: {
      title: 'The pictures',
      items: ['instapost’s are real, on a local Instagram stand-in, made-up accounts; rest drawn.'],
    },
    foot: {
      changelog: 'Changelog',
      older: 'Older versions',
      problem: 'Report a problem',
      licence: 'MIT licence',
      font: 'Font licence',
      asIs: 'Provided as is. Third-party notices in zip.',
      affiliation: 'Not affiliated with Instagram or Meta. “Instagram” is a trademark of Instagram, LLC.',
      hosting: 'GitHub Pages keeps visitor logs. © 2026 monsieurBelbo.',
    },
  },
  notFound: { head: 'Page not found.', body: 'That address isn’t here.', link: 'Go to instapost' },
};
