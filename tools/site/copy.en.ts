/**
 * The page's English words. Inline HTML is allowed (<strong>, <code>); {v} {size} {date} {zip} {sha} are filled by
 * page.ts from the release. Every fact traces to the verified facts sheet: don't add a claim without one.
 */
export interface Block {
  title: string;
  body: string;
}
export interface Row {
  topic: string;
  can: string[];
  cant: string[];
}
export interface Step {
  title: string;
  body: string;
}
export interface Copy {
  lang: 'en' | 'es';
  locale: string;
  otherLang: { label: string; hreflang: 'en' | 'es' };
  title: string;
  description: string;
  ogAlt: string;
  months: readonly string[];
  h1: readonly string[];
  sub: string;
  download: string;
  noRelease: string;
  phone: string;
  risk: string;
  metaRelease: string;
  prerelease: string;
  whatsNewLink: string;
  needs: string;
  tried: string;
  sourceLink: string;
  lead: string;
  why: string;
  entry: string;
  entryNote: string;
  caption: string;
  shotAlt: string;
  installHead: string;
  installIntro: string;
  wellFolder: string;
  wellChoose: string;
  wellDev: string;
  wellLoad: string;
  copy: string;
  copied: string;
  copyFail: string;
  steps: readonly [Step, Step, Step, Step, Step];
  browserChrome: string;
  browserArc: string;
  newIn: string;
  allChanges: string;
  updating: Block;
  removing: Block;
  ledgerLead: string;
  canHead: string;
  cantHead: string;
  rows: readonly Row[];
  riskHead: string;
  riskLead: string;
  riskBlocks: readonly Block[];
  exactHead: string;
  exactBody: string;
  dataHead: string;
  dataLead: string;
  dataBlocks: readonly Block[];
  checkTitle: string;
  checkWithRelease: string;
  checkWithoutRelease: string;
  permsHead: string;
  perms: readonly (readonly [string, string])[];
  foot: {
    source: string;
    changelog: string;
    older: string;
    problem: string;
    licence: string;
    font: string;
    asIs: string;
    affiliation: string;
    hosting: string;
  };
  notFound: { head: string; body: string; link: string };
}

export const EN: Copy = {
  lang: 'en',
  locale: 'en_US',
  otherLang: { label: 'Español', hreflang: 'es' },
  title: 'instapost: post Instagram stories from your computer',
  description:
    'A free browser extension for Chrome and Arc. It adds a New story button to Instagram on the web. Photos only, installed by hand, at your own risk. Not affiliated with Instagram.',
  ogAlt: 'instapost: post Instagram stories from your computer.',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  h1: ['Post', 'Instagram', 'stories', 'from your', 'computer.'],
  sub: 'A free browser extension for Chrome and Arc.',
  download: 'Download instapost {v}',
  noRelease: 'No download yet. The first release is on its way.',
  phone: 'This runs on a computer. Open this page there.',
  risk: 'It works outside Instagram’s terms of use, so your account is at your own risk. Try a secondary account first.',
  metaRelease: 'Zip, {size}. Released {date}.',
  prerelease: 'This is a preview of the next version.',
  whatsNewLink: 'What’s new',
  needs: 'Needs Chrome 155 or newer, or Arc on Chromium 155 or newer, on a computer.',
  tried: 'Tried on real Instagram only in Arc on a Mac, with a secondary account. Windows and Linux are untested.',
  sourceLink: 'Source on GitHub',
  lead: 'It adds a New story button to Instagram on the web. Pick a photo, add text if you want, press Post story. Photos only: no video, music or mentions.',
  why: 'I made it to share a photo without opening the app and getting stuck in the feed.',
  entry: 'New story',
  entryNote: 'instapost adds this',
  caption:
    'An illustration. The instapost window is real, captured on a local stand-in for Instagram with a made-up account. Everything around it is drawn.',
  shotAlt:
    'The instapost window. On the left, a mountain lake photo with the words First light, framed as a story. On the right, controls for the text’s style, colour and size, and a Post story button.',
  installHead: 'Install it',
  installIntro: 'instapost isn’t in the Chrome Web Store, so you load it by hand.',
  wellFolder: 'instapost',
  wellChoose: 'choose this one',
  wellDev: 'Developer mode',
  wellLoad: 'Load unpacked',
  copy: 'Copy',
  copied: 'Copied',
  copyFail: 'Select and copy',
  browserChrome: 'Chrome',
  browserArc: 'Arc',
  steps: [
    {
      title: 'Unzip it.',
      body: 'Double-click the zip you downloaded. Put the instapost folder somewhere it can stay, not Downloads. The browser reads it from there every time, so don’t move or delete it. If you move it, repeat step 4.',
    },
    {
      title: 'Open the extensions page.',
      body: 'Copy the address for your browser and paste it into a new tab.',
    },
    {
      title: 'Turn on Developer mode.',
      body: 'The switch is at the top right of that page. It’s what lets you add an extension by hand. Leave it on.',
    },
    {
      title: 'Click Load unpacked.',
      body: 'Choose the instapost folder, the one that directly holds <code>manifest.json</code>.',
    },
    {
      title: 'Click New story.',
      body: 'Open or reload instagram.com in a normal window, not Incognito, logged in to a secondary account if you have one. New story is in Instagram’s left sidebar. Not there? On Instagram, click instapost’s icon in the extensions menu. Add a photo, press Run setup test and stay on that tab. It takes about 20 seconds and posts nothing. After that, pressing Post story really posts.',
    },
  ],
  newIn: 'New in {v}.',
  allChanges: 'All changes',
  updating: {
    title: 'Updating.',
    body: 'Nothing updates by itself, so come back here for new versions. Replace the folder’s contents with the new version. On the extensions page, click Reload (↻) on instapost, then reload Instagram. Your settings stay. If Arc holds on to the old version, use Remove and Load unpacked again, which wipes what instapost stored in your browser.',
  },
  removing: {
    title: 'Removing.',
    body: 'On the extensions page, click Remove. That deletes your settings, drafts, recent photos and history. Then delete the folder, and Downloads/instapost if you have it.',
  },
  ledgerLead: 'One photo at a time, from your click.',
  canHead: 'It can',
  cantHead: 'It can’t',
  rows: [
    {
      topic: 'Photos',
      can: [
        '<strong>Open your photo.</strong> Drop, paste or choose a JPEG, PNG, WebP, AVIF or HEIC. A real iPhone HEIC photo is still untested.',
      ],
      cant: ['<strong>No video or Reels.</strong> One photo per story. GIF and TIFF don’t open.'],
    },
    {
      topic: 'Editing',
      can: [
        '<strong>Crop it and add text.</strong> Drag, zoom, rotate, and add one text box. Your draft saves itself. The finished picture is 1080 × 1920, without the photo’s location or camera data.',
      ],
      cant: [
        '<strong>No music, mentions, links or polls.</strong> Also no location, hashtag stickers or Close Friends. From what I found, Instagram on the web doesn’t offer them.',
        '<strong>No drawing or Instagram’s stickers.</strong>',
      ],
    },
    {
      topic: 'Posting',
      can: [
        '<strong>Post it for you.</strong> Instagram’s mobile site runs in a phone-sized frame in your tab and instapost taps +, Story and Share, usually in 15 to 25 seconds.',
        '<strong>Tell you what happened.</strong> It says Posted only when Instagram itself answers that the story went through. If it can’t tell, it says Couldn’t confirm, and you check your story.',
      ],
      cant: [
        '<strong>No scheduling.</strong>',
        '<strong>No posting in the background.</strong> Keep the tab in front and your hands off until Share. You can stop the post until then. After Share you can keep browsing, but keep the page open. If you reload or close it, instapost can’t tell whether the story went through and says Couldn’t confirm.',
      ],
    },
    {
      topic: 'Reposts',
      can: [
        '<strong>Repost a photo post as a picture.</strong> Click Instagram’s Share on it, then Add to story. Someone else’s post always shows their @handle. Only lightly tried on real Instagram.',
        '<strong>Repost a story that mentions you.</strong> From its preview in your DMs. Photos under 24 hours old, with Instagram in English or Spanish. Not yet tried on real Instagram.',
      ],
      cant: [
        '<strong>No real reposts.</strong> It’s a picture with no sticker. People can’t tap through to the original, and the author isn’t notified.',
        '<strong>No videos or Reels.</strong> Also no posts known to block sharing.',
      ],
    },
    {
      topic: 'Pace',
      can: [
        '<strong>Queue a story.</strong> Press Post story during the 60-second wait between stories and that photo starts by itself when the wait ends. You can cancel.',
      ],
      cant: [
        '<strong>No going faster.</strong> 60 seconds between stories, 6 an hour, 15 a day. Every story it starts counts, even a failed one.',
        '<strong>No retries.</strong> It presses Share once per story. Trying again is up to you.',
      ],
    },
    {
      topic: 'Where',
      can: [
        '<strong>Run in Chrome 155 or newer, or Arc on Chromium 155 or newer,</strong> logged in to instagram.com in the same browser profile. Only Arc, with a secondary account, has been tried on real Instagram.',
      ],
      cant: ['<strong>No phones, Firefox or Safari.</strong>', '<strong>No automatic updates.</strong>'],
    },
  ],
  riskHead: 'Your account is at your own risk.',
  riskLead: 'Using instapost is outside Instagram’s terms of use. Try it on a secondary account first.',
  riskBlocks: [
    {
      title: 'Where it has run.',
      body: '<b>On real Instagram:</b> only Arc (Chromium 155) on macOS, with a secondary personal account. Reposting a photo post is only lightly tried.<br><b>Automated tests only,</b> against a local stand-in for Instagram: Chromium 155 and 156.<br><b>Not yet tried on real Instagram:</b> Google Chrome, main accounts, Creator and Business accounts, real iPhone HEIC photos, Instagram in any language but English, reposting stories.<br><b>Not tried at all:</b> Edge, Brave, Windows, Linux.',
    },
    {
      title: 'Instagram can tell.',
      body: 'Its page code can see instapost’s button on every page and the phone frame during a post or test. A post made this way also looks unusual to its servers.',
    },
    {
      title: 'During a post or test.',
      body: 'Only in the tab where it happens, Instagram’s requests say they come from an Android phone, your desktop page’s background requests included. A few headers change so the mobile site loads in the frame, a small script tells it the screen is portrait, and the taps are simulated. All of it ends with the post or test.',
    },
    {
      title: 'It can break.',
      body: 'Any time Instagram changes its page. If a post is running, instapost stops, says why and doesn’t press Share. If Instagram shows a security check, it can take over your tab, and instapost then pauses posting for 7 days.',
    },
    {
      title: 'Your folder.',
      body: 'Anyone who can change the files in the instapost folder can run code inside your logged-in Instagram. Download it from this page and keep it where only you can change it.',
    },
    {
      title: 'Reposts are other people’s work.',
      body: 'Only repost what you’re allowed to share. instapost can’t always see the author’s settings.',
    },
  ],
  exactHead: 'The exact changes during a post or test',
  exactBody:
    '<code>X-Frame-Options</code> is removed from the frame. <code>Sec-Fetch-Dest</code> is set to <code>document</code>. A small script in Instagram’s own JavaScript world makes the screen read as portrait. <code>User-Agent</code> becomes an Android phone’s, <code>Sec-CH-UA-Mobile</code> and <code>Sec-CH-UA-Platform</code> say the same, and the more detailed client hints are removed. During a test, upload and publish requests are also blocked.',
  dataHead: 'Your data',
  dataLead: 'instapost has no server and sends nothing to me. There’s no analytics in it or on this page.',
  dataBlocks: [
    {
      title: 'What stays.',
      body: 'Settings, drafts, photos and history live on your computer. While the page stays open, a story that fails or can’t be confirmed is also saved to Downloads/instapost, unless it’s a repost. Copy diagnostics only fills your clipboard. It lists your recent posts and tests with their times and pages, your username and the @handle of anyone you reposted, so read it before you paste it anywhere.',
    },
    {
      title: 'What goes out.',
      body: 'Your story goes to Instagram when you post. A repost also fetches the picture from Instagram’s image server, run by Meta, after your browser asks you once. For a photo post, it fetches the author’s avatar from there too. These fetches send no cookies. That server sees them and may be able to tell they come from instapost.',
    },
    {
      title: 'What it asks for.',
      body: 'Storage, downloads, scripting and network rules, on www.instagram.com and i.instagram.com. Your browser may call these “Read and change your data” and “Block content on any page”. It doesn’t ask for tabs, cookies, the debugger or access to all sites.',
    },
  ],
  checkTitle: 'What you can check.',
  checkWithRelease:
    'The source is public. This zip’s SHA-256 is <code class="sha">{sha}</code>. On a Mac, <code>shasum -a 256</code> followed by the file should print the same.',
  checkWithoutRelease: 'The source is public.',
  permsHead: 'Every permission, in plain words',
  perms: [
    ['storage, unlimitedStorage', 'Settings, drafts, photos and history on your computer.'],
    [
      'scripting',
      'Puts instapost’s helper and the portrait script into the phone frame, and adds New story to Instagram tabs already open.',
    ],
    [
      'downloads',
      'Save copy, and copies of stories that didn’t post. Your browser may call this “Manage your downloads”.',
    ],
    [
      'declarativeNetRequest, declarativeNetRequestWithHostAccess',
      'Changes headers during a post or test, and blocks publishing during tests.',
    ],
    ['webRequest', 'Watches the frame load. It only observes.'],
    [
      'www.instagram.com, i.instagram.com',
      'Where it works. On every Instagram page it can read and change what’s there. It reads your username, the post you click Share on and, in your DMs, the text around a story link, to spot a mention. None of this goes to me. Photos upload to i.instagram.com.',
    ],
    [
      '*.cdninstagram.com, *.fna.fbcdn.net',
      'Instagram’s image servers. Optional. Your browser asks once, when you first repost. Only reposts use them.',
    ],
  ],
  foot: {
    source: 'Source',
    changelog: 'Changelog',
    older: 'Older versions',
    problem: 'Report a problem',
    licence: 'MIT licence',
    font: 'Font licence',
    asIs: '© 2026 monsieurBelbo. Provided as is, without warranty. Third-party notices are in the zip, in its <code>licenses</code> folder.',
    affiliation:
      'Not affiliated with, endorsed or sponsored by Instagram or Meta. “Instagram” is a trademark of Instagram, LLC, used here only to say what the extension works with.',
    hosting: 'This page is on GitHub Pages, which keeps its own visitor logs.',
  },
  notFound: { head: 'Page not found.', body: 'That address isn’t here.', link: 'Go to instapost' },
};
