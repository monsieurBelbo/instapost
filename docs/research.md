# Instagram Stories from a desktop Chrome extension: research synthesis

- **Purpose:** input for the design phase of a personal Chrome MV3 extension that prepares stories (crop, resize, text, ideally music) and posts them to the owner's own Instagram account from desktop Chrome.
- **Compiled:** 2026-10-11. Five research angles were each checked by an adversarial fact-checker. Refuted claims are removed, corrections are applied, and claims that could not be confirmed are marked **(unverified)**.
- **Method limits:** nobody logged in, posted or created accounts. The web-search budget ran out during fact-checking, so the checkers fetched primary pages directly. Facts about Instagram's web code come from its production JS ("Polaris" build, served 2026-10-11, plus public GitHub snapshots dated 2026-09-19 and 2025-10-19). They are point-in-time and the extension must feature-detect them at runtime.
- **Terms:**
  - **msite** is Instagram's mobile-web UI, served at `www.instagram.com` to phone User-Agents.
  - **Graph API** is the Instagram Platform content-publishing API.
  - **IG Login** is Instagram API with Instagram Login, on `graph.instagram.com`.
  - **FB Login** is Instagram API with Facebook Login, on `graph.facebook.com`.
  - **MBS** is Meta Business Suite.

---

## 1. TL;DR

1. **Desktop instagram.com has no story creator.** The Help Center says story sharing "isn't available on computers" ([help 1257341144298972](https://help.instagram.com/1257341144298972/)). In the desktop web code, the only Create items are `POST / LONG_VIDEO / BULK_UPLOAD / LIVE_VIDEO / AD / AI`, and the mobile story entry renders only when `!PolarisUA.isDesktop()`. Instagram's own blog guide (posted 2026-07-02) contradicts this: it says you can post from instagram.com via "your profile photo in the top-left" ([blog](https://about.instagram.com/blog/tips-and-tricks/how-to-use-instagram-stories)). That description probably matches the mobile-web layout. A manual check on the owner's account, without posting, is needed.
2. **A mobile-web (msite) story composer still exists, and desktop Chrome can reach it.** Three things are needed:
   - The User-Agent request header must be a phone UA. The server classifies the device from that header only; client hints are ignored.
   - The page must be reloaded.
   - The viewport must be portrait (`innerHeight >= innerWidth`), otherwise the toast "Rotate your device to add to your story." appears.

   The composer is **photo-only**: it accepts `image/avif`, `image/jpeg` and `image/png`, and rejects video with "Upload failed. Only images can be posted.". It offers one text style, drawing and static stickers. It has **no video, music, mentions, links, polls or Close Friends**. It works for personal, Creator and Business accounts.
3. **The official Graph API can publish stories, but only for Business accounts.** Use `media_type=STORIES`, then `media_publish`. Creator accounts get `(#10) The user is not an Instagram Business`; the FB Login overview says stories are "only available to business accounts". Requirements:
   - a Meta app at Standard Access; no App Review is needed for your own account;
   - media at a **public HTTPS URL**, because Meta cURLs it;
   - images as JPEG of 8 MB or less; videos as MP4/MOV of 3–60 s and 100 MB or less.

   The API has **no stickers, text, music, Close Friends or scheduling**. Invisible mentions are possible via `user_tags`, but that is documented only for FB Login and is (unverified) on IG Login.
4. **Meta Business Suite (desktop) is the only official first-party desktop story composer.** It works for Business or Creator accounts and **does not need a Facebook Page**. It offers crop, trim, text, mentions, a **link sticker**, and Share now or Schedule. It has no music.
5. **There is no desktop, web or API path for Instagram's licensed music sticker on Stories.** The new Audio API (2026-06-01) covers Reels only and requires FB Login. Two realistic options:
   - Burn user-owned or royalty-free audio into an MP4. This only works through the Graph API or a manual MBS upload, because the msite composer is photo-only, and it carries a risk of copyright muting.
   - **Hand the file off to the phone** and add the music sticker in the app.
6. **Text must be burned into pixels** by the extension, using OFL fonts that look like Instagram's. Native text metadata exists only in the app and the private app API. Interactive stickers (mention, hashtag, location, link, poll) are metadata, not pixels, and the extension cannot produce them except through a native-app emulation. That route is the highest risk and is out of scope.
7. **Export format: exactly 1080x1920.**
   - Photos: sRGB JPEG, quality about 0.92, 8 MB or less.
   - Videos: MP4 with H.264 High@4.0 (`avc1.640028`), 30 fps constant frame rate, AAC-LC at 48 kHz and 128 kbps, `moov` atom first, **no edit list**, each segment 3–60 s.
   - Show safe-zone guides: top about 14%, bottom 20% (organic heuristic) to 35% (ads), sides 6%.
8. **Recommended browser stack:**
   - WebCodecs plus Mediabunny 1.61.x, run in an extension page or a dedicated worker. They are **not available in the MV3 service worker**.
   - pica 10 (split build), and heic-to or libheif for HEIC input.
   - The MV3 CSP must contain `'wasm-unsafe-eval'`, and MV3 **forbids `blob:` workers**. heic-to, `@mediabunny/aac-encoder`, pica's full build and the default ffmpeg.wasm loader all use `blob:` workers, so they need patching or packaged worker files.
9. **Recommended architecture:** an editor that runs fully locally and is independent of Instagram, plus thin, replaceable publish adapters:
   - **(a) msite hand-off.** Open a dedicated portrait popup window. Add a tab-scoped session dNR rule that sets a phone UA. Inject the finished JPEG into Instagram's own file input. The **user clicks Share**.
   - **(b) Official Graph API adapter**, optional, for a Business account.
   - **(c) Export or send to phone.**

   Do **not** call private endpoints directly, send Android-signed bodies, or inject native-only fields.
10. **Risk.** Instagram's Terms of Use ban unauthorized automated access and circumventing "technological measures". Spoofing the UA is a grey area. A spoofed msite session is detectably inconsistent in four ways:
    - it uses msite app ID `1217981644879628` alongside desktop ID `936619743392459`;
    - it sends `X-IG-Max-Touch-Points: 0`;
    - its `Sec-CH-UA-*` headers say desktop;
    - its `navigator.userAgentData` says desktop.

    Keep everything user-initiated and at human pace. Never handle the password, never log in inside the spoofed tab, and keep the extension unpacked rather than published to the Chrome Web Store.
11. **Dev environment:**
    - WXT 0.21.4 or later on Chrome for Testing 155. Branded Chrome ignores `--load-extension` since version 137; WXT and web-ext load the extension via CDP `Extensions.loadUnpacked` instead.
    - Vitest with `fakeBrowser` for unit tests.
    - Playwright 1.64 with a **fake-Instagram fixture served at the real origin** via `context.route`, plus a fail-closed abort for any other request.
    - A mock Graph API server.
    - Build modes `dev`, `mock`, `e2e` and `live`. Posting code exists only in `live`; other builds carry a dNR block ruleset for Instagram write endpoints.
12. **Instagram has no sandbox.** Meta test users are Facebook-only and their creation is suspended.
    - Live tests go to a **secondary account the user creates manually**: a private personal account for the msite route, or a Business account with no followers for the API route. Business accounts cannot be private (unverified).
    - Post one human-clicked story at a time and delete it afterwards.
    - **Close Friends cannot be targeted from the web or the API**, so it cannot be used to isolate tests on those routes.

---

## 2. Capability matrix

Values are Yes, No, Partial or Unknown. Risk levels: **None** (official), **Medium** (UA spoof of Instagram's own UI), **High** (hand-built private web calls), **Very high** (native-app emulation).

| Surface | Photo story | Video story | Crop/position | Text | Mentions/hashtags | Link sticker | Music | Close Friends | Scheduling | Account types | Risk level |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Desktop instagram.com (desktop UA) | No [1] | No [1] | No [2] | No | No | No | No [3] | No [4] | No | All | None |
| Mobile-web instagram.com (msite, phone UA) | Yes [5] | No [6] | Partial [7] | Partial [8] | No [9] | No | No | No [10] | No | All (personal, Creator, Business) | Medium [11] |
| Meta Business Suite (desktop) | Yes | Yes | Yes [12] | Yes | Partial [13] | Yes [14] | No [15] | Unknown | Yes | Business, Creator; no Page needed [16] | None |
| Instagram Graph API | Yes [17] | Yes [18] | No [19] | No [20] | Partial [21] | No [22] | No [23] | No | No [24] | Business only for stories [25] | None (setup cost, public hosting) |
| Private web endpoints (direct calls) | Yes [26] | Partial (unverified) [27] | No (pre-render) | Partial [28] | Unknown [29] | Unknown | Unknown [30] | Unknown [31] | Extension-driven only | All | High [32] |
| (reference only) Private mobile-app API emulation | Yes | Yes | No (pre-render) | Partial | Yes | Yes (1 link) | Yes [33] | Yes (unverified 2026) [34] | Own scheduler | All | Very high [35] |
| Native mobile app (iOS, Android, iPad) | Yes | Yes (up to 60 s per clip) | Yes | Yes | Yes | Yes | Yes [36] | Yes | Partial (unverified) [37] | All | None |

Footnotes:

1. The Help Center story article renders "This feature isn't available on computers" and lists only the Android, Instagram Lite, iPhone and iPad apps ([help](https://help.instagram.com/1257341144298972/)). The desktop Create menu enum (`PolarisCreationNavMenu.react`) contains no STORY item. The mobile Create entry `PolarisMobileCreationNavItem` renders only when `!PolarisUA.isDesktop()`. The Instagram blog of 2026-07-02 claims otherwise (see TL;DR item 1).
2. Desktop Create > Post (feed and reels only) offers the crop presets `ORIGINAL`, `SQUARE_1_1`, `PORTRAIT_4_5`, `LANDSCAPE_16_9` and `PORTRAIT_9_16`, plus zoom, filters and adjustments.
3. "Add music to a post with multiple photos" shows "isn't available on computers" ([help 1223433768344104](https://help.instagram.com/1223433768344104/)). The desktop *Reels* code path does send `music_params` (see section 6.4), but whether the desktop UI exposes music is (unverified).
4. The Close Friends article shows "isn't available on computers" ([help 2183694401643300](https://help.instagram.com/2183694401643300/)).
5. The input `accept` list is `image/avif, image/jpeg, image/png`; HEIC/HEIF is accepted only when the device class is desktop. Output is a canvas JPEG made with `canvas.toBlob('image/jpeg')` at Chrome's default quality of about 0.92, which strips EXIF and C2PA data.
6. `PolarisStoryCreationFileForm` accepts images only. `storyCreationSelectMedia` rejects non-images with the toast "Upload failed. Only images can be posted.". The functions `storyCreationSelectVideo` and `uploadStoryVideo` exist but nothing calls them. Third-party reports of 15 s video through DevTools emulation ([Agorapulse, 2025-10-01](https://www.agorapulse.com/blog/instagram-stories/publish-instagram-stories-from-the-desktop/)) are probably outdated.
7. `PolarisStoryCreationUtils.getCropInfo` centre-crops (cover) the source to the canvas aspect. No user repositioning was found, so the extension should pre-render an exact 9:16 image.
8. There is one text style with 8 colours (`TEXT_COLORS`), default font size 22, weight 600, and pinch scale up to `MAX_SCALE = 52/22`. Text is burned into pixels and also sent as the `caption` field (lines joined with `\n`). The composer also has drawing brushes (marker, chisel, magic, eraser; sizes 1–22) and static image stickers.
9. Static stickers come from `POST /api/v1/web/creatives/async_assets/`. There are no mention, hashtag, location, poll or link stickers.
10. The web `configure_to_story` body has no audience field. `PolarisMediaConstants.MediaVisibility` defines `CLOSE_FRIENDS: 5`, but the story flow never sends it.
11. Requests are built by Instagram's own client in the user's real session. The anomalies are the spoofed UA, the msite app ID, and the touch-point and client-hint mismatches (section 5.4). Terms-of-use status is a grey area (section 5.8).
12. MBS can "crop the aspect ratio, trim the length of the video" ([Meta help 972600925713914](https://www.facebook.com/business/help/972600925713914)).
13. Mentions are documented; a hashtag sticker is not.
14. "Click Add link to add a URL" is documented by Meta. [Sprout Social (2026-02-02)](https://sproutsocial.com/insights/schedule-instagram-stories/) confirms that link stickers can be scheduled. Agorapulse's claim that MBS has no link sticker contradicts Meta's own documentation and is treated as wrong.
15. Music is not documented. Sprout Social and Agorapulse report that it is not available.
16. "you must have an Instagram business or creator account". An account not connected to a Page can log in to MBS with Instagram credentials ([help 428687951269163](https://www.facebook.com/business/help/428687951269163)). The MBS mobile app can also create and schedule stories ([help 609176706604372](https://www.facebook.com/business/help/609176706604372)).
17. JPEG only, 8 MB or less, sRGB, fetched by Meta from a public URL.
18. MP4 or MOV, 3–60 s, 100 MB or less. Supplied as a public `video_url`, or as a byte upload through resumable upload (FB Login only).
19. There is no crop or fit parameter; the docs say "We recommend 9:16 to avoid cropping or blank space".
20. There is no text field. `alt_text` is "not supported" for stories.
21. `user_tags` (since 2025-07-09) creates mentions without a visible sticker. It is documented in the FB-Login-oriented reference. The IG Login overview says "This API setup cannot access ads or tagging", so mentions on `graph.instagram.com` are (unverified). There is no hashtag support.
22. "Publishing stickers (i.e., link, poll, location) is not supported."
23. The Audio API is Reels-only and FB-Login-only. Audio burned into a video story's own track is possible but may be copyright-matched.
24. There is no `scheduled_publish_time`, and containers expire after 24 h. The extension (with the browser running) or a backend must call `media_publish` at the right time.
25. The FB Login overview, fetched 2026-10-11, says "Content Publishing is available to all Instagram Professional accounts, except Stories, which are only available to business accounts." Treat Business as required on both login types.
26. Upload to `rupload_igphoto`, then call `configure_to_story`, mirroring msite (section 5.3).
27. A web video path exists in the code (`rupload_igvideo` plus a cover image plus `configure_to_story`), but no UI reaches it.
28. Only the `caption` text is sent, along with the pixels.
29. The web client never sends `reel_mentions`, `tap_models` or `story_sticker_ids` for stories. Whether the web endpoint accepts them is untested. INSSIST injected `reel_mentions` in 2022.
30. The web Reels composer sends `music_params` to `configure_to_clips`. There is no equivalent for stories. INSSIST claims to support story music, but its mechanism is (unverified).
31. No web code sends an audience for stories. Whether the endpoint accepts one is unknown.
32. Headers and fields have to be maintained by hand, and they drift. The finalize endpoint changed between Oct 2025 and Apr 2026. Requests that the real client never sends act as a fingerprint.
33. The client sends `music_params` and `music_burnin_params` and burns the audio in locally. Tracks come from the private endpoints `music/search_v2/`, `music/keyword_search/` and `clips/music/` ([instagrapi](https://github.com/subzeroid/instagrapi)).
34. dilame's types document `audience: 'besties'`, but the library has not been released since 2024-03.
35. Requires a password login as an emulated Android device, with signed bodies. Version checkpoints hit these clients in 2026-02 and 2026-08. Meta has sued commercial operators of this pattern.
36. Uses the licensed library. Some business accounts are limited to Meta Sound Collection, "over 14,000 songs and sounds" ([help 402084904469945](https://help.instagram.com/402084904469945/)).
37. The Instagram blog (2026-07-02) describes in-app story scheduling for "accounts that meet Instagram's eligibility requirements". No Help Center article was found. The MBS mobile app does schedule stories.

Other first-party surfaces checked:

- **Windows Store app** (9NBLGGH5L9XT, updated 2026-08-12): an Edge PWA wrapper of the website, advertising feed posting only, so no story creation ([store](https://apps.microsoft.com/detail/9nblggh5l9xt?hl=en-US&gl=US)).
- **iPad app** (launched 2025-09-03): has the full story composer, but `isIOSBinaryMacOSCompatible:false`, so it cannot run on Apple-silicon Macs ([blog](https://about.instagram.com/blog/announcements/instagram-for-ipad), [App Store](https://apps.apple.com/us/app/instagram/id389801252)).
- **Edits desktop:** announced as "coming soon" on 2026-06-11, with sync between mobile and desktop. Whether it has shipped, and whether it can publish stories, is (unverified) ([TechCrunch](https://techcrunch.com/2026/06/11/metas-edits-app-is-getting-an-ai-assistant-and-a-desktop-version/)).
- **Drafts:** app drafts are stored on the device and "You won't be able to access a saved draft from another device" (reel-draft help [639718330257952](https://help.instagram.com/639718330257952/?cms_platform=iphone-app)). Story drafts last 7 days ([SMT, 2021-07-16](https://www.socialmediatoday.com/news/instagram-stories-drafts-are-now-available-to-all-users/603498/); stale). There is no first-party "send to phone" feature.
- **Creator Studio:** retired in 2023 and folded into MBS. In 2026-06 Meta reused the name for an unrelated Facebook AI companion app.

---

## 3. Story media specs and safe zones

### 3.1 Specs table

| Property | Graph API (official, [IG User Media ref](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media)) | msite composer (code, 2026-09/10) | App and Help Center | **Recommended export** |
|---|---|---|---|---|
| Aspect and size | Image: "9:16 recommended"; no width range for stories (feed is 320–1440 px, 4:5 to 1.91:1). Video: aspect 0.1:1 to 10:1, at most 1920 columns | Centre-crops source to the canvas aspect | Non-9:16 photos are placed on a background; whether it is a gradient from the image's colours is (unverified) | **Exactly 1080x1920** |
| Image format | **JPEG only** (no PNG; MPO/JPS unsupported) | Input AVIF, JPEG or PNG; output canvas JPEG | — | JPEG, quality 0.90–0.95 |
| Image size | 8 MB max | — | — | Lower quality until 8 MB or less |
| Colour | sRGB; other colour spaces are converted | sRGB canvas | — | sRGB canvas (default 2D context) |
| Video container | MOV or MP4, `moov` atom at front, **no edit lists** | Not accepted | .mp4/.mov | MP4, Mediabunny `fastStart:'in-memory'` |
| Video codec | H.264 or HEVC, progressive, closed GOP, 4:2:0, VBR up to 25 Mbps | — | — | H.264 High@4.0 `avc1.640028`, about 8–12 Mbps, keyframe every 1–2 s |
| Frame rate | 23–60 fps | — | — | 30 fps constant (set `frameRate: 30` explicitly) |
| Audio | AAC, 48 kHz max, mono or stereo, 128 kbps | — | — | AAC-LC `mp4a.40.2`, 48 kHz, stereo, 128 kbps |
| Duration | **3–60 s** | — | One clip up to 60 s; "Longer videos will be broken up into multiple clips"; trimmer is iOS-only ([help](https://help.instagram.com/1257341144298972/?cms_platform=iphone-app)) | Split client-side into segments of 3–60 s |
| File size | 100 MB max | — | — | Under 100 MB (60 s at about 12 Mbps fits) |
| Photo display time | — | — | About 5–7 s; a music sticker extends it, often to 15 s (unverified; the 15 s figure is only instagrapi's default) | Default photo-with-audio export to 15 s, never under 3 s |

Other spec sources, kept for reference only:

- **Story tech spec page** [292794301336717](https://www.facebook.com/business/help/292794301336717): **stale**. It still lists story video as "1 - 15 seconds", images at 30 MB, and Meta Spark (shut down in Jan 2025).
- **Ads Guide, Instagram Story** ([image](https://www.facebook.com/business/ads-guide/update/image/instagram-story), [video](https://www.facebook.com/business/ads-guide/update/video/instagram-story)): 9:16 with 1% tolerance, 1440x2560 recommended, minimum width 500 px for images and 250 px for video, 30 MB per image, 4 GB per video. These are looser than the organic limits; follow the Graph API limits instead.
- **Sharing to Stories SDK** (mobile only): background JPG or PNG at least 720x1280, 9:16 or 9:18; video H.264, H.265 or WebM, up to 1080p and 20 s, under 50 MB recommended on iOS; sticker about 640x480; default background `#222222`.
- **msite private route:** OpenCLI restricts story images to aspect ratios between 9:16 and 3:4 (padding with white otherwise) and trims video to 15 s. These are a library's own choices, not Instagram limits.

### 3.2 Safe zones (1080x1920)

| Zone | Ads Guide (official, ads) | Organic heuristic (community, unverified) | Suggested default guide |
|---|---|---|---|
| Top | 14% (about 269 px) | 250–270 px | 270 px |
| Bottom | 35% (about 672 px) | 340–384 px (about 18–20%) | 384 px, with an optional strict "ad-safe" mode at 672 px |
| Sides | 6% (about 65 px) each | 65–75 px | 65 px |

Meta publishes **no organic safe-zone spec** ([GrowthScribe, 2026-06-30](https://growthscribe.com/instagram-story-size/)). The often-quoted pairs "14% / 250 px" and "20% / 340 px" do not match arithmetically on a 1920 px canvas.

### 3.3 Composition rules that follow from the specs

- Always compose to exactly 1080x1920 so Instagram never crops or pads the image. Offer three fit modes:
  - cover, with a draggable focal point;
  - contain, with a fill of solid colour, a two-colour gradient sampled from the image, or a blurred copy;
  - free transform.
- Decode images with `createImageBitmap(blob, {imageOrientation:'from-image'})`, which honours EXIF orientation by default since Chrome 81. pica 10.0.0 worked around a Chrome bug when cropping a sub-region of an EXIF-rotated source. To avoid that bug, decode the whole image once into an upright bitmap, then crop from it.
- Canvas re-encoding strips EXIF and GPS data. That is a privacy gain, and the UI should tell the user. Do not offer Display P3 export.
- Instagram re-encodes every upload and publishes no bitrate targets ([Meta Engineering, 2022-11-04](https://engineering.fb.com/2022/11/04/video-engineering/instagram-video-processing-encoding-reduction/)). Client rupload params still declare `image_compression {lib_name:'moz', lib_version:'3.1.m', quality:'80'}`; this is client-declared metadata, not a server target.

---

## 4. Official API route (Instagram Platform / Graph API)

### 4.1 Requirements

- **Account type:** a **Business** account for stories. Creator accounts fail with `OAuthException` code 10, "(#10) The user is not an Instagram Business" ([FB Login overview](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login), [community thread](https://developers.secure.facebook.com/community/threads/1226500261819047)). Personal accounts have had no API access since the Basic Display API shut down on 2024-12-04.
- **Business account side effects:**
  - It cannot be set to private (unverified; the Help Center page renders client-side).
  - It may lose access to the licensed music library ("certain business accounts ... do not have access", [help 402084904469945](https://help.instagram.com/402084904469945/)).
- **Meta app:**
  - The app type must be **Business**.
  - Keep it in Development mode, at **Standard Access**, with the owner's Instagram account holding an app role. No App Review is needed for "a business I own or manage" ([App Review doc](https://developers.facebook.com/documentation/instagram-platform/app-review.md)). Advanced Access requires App Review.
  - Apps that are not linked to a verified business can have up to 50 testers ([app roles](https://developers.facebook.com/docs/development/build-and-test/app-roles)).
  - The "Instagram Tester" invite (accepted in Instagram > Apps and Websites > Tester Invites) is documented only by third parties.
- **One login type per app:** "Your app can either use Facebook Login or Instagram Login but not both". Supporting both login types means two Meta apps.

| | IG Login (recommended for v1) | FB Login |
|---|---|---|
| Host | `graph.instagram.com` | `graph.facebook.com` |
| Scopes | `instagram_business_basic`, `instagram_business_content_publish` (the legacy `business_*` scopes stopped working on 2025-01-27) | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` (plus `ads_management` or `ads_read` if the user has a Business Manager role on the Page) |
| Facebook Page | Not needed | Needed. Page Publishing Authorization must be complete, and if the Page requires 2FA, the user must have completed 2FA |
| Only on this path | — | Resumable byte upload (video), media **delete** (`instagram_manage_contents`, since 2025-12-03), Audio API (Reels), `GET /<IG_ID>/stories`, the `media_product_type` field, `link_clicks` story insight |
| Token type | Instagram User token | User token per the references; the publishing guide says "Page access token". The docs are inconsistent, so whether a Page token works is (unverified) |

### 4.2 Publish flow

1. `POST /<IG_ID>/media` with `media_type=STORIES` and `image_url` or `video_url`, plus optional `user_tags` and optional `is_ai_generated` (since 2026-06-22). It returns a container ID.
2. `GET /<CONTAINER_ID>?fields=status_code,status` until the status is `FINISHED`. Other states are `IN_PROGRESS`, `ERROR`, `EXPIRED` and `PUBLISHED`. Meta recommends polling about once per minute for no more than 5 minutes; for images, start at 3–5 s and back off.
3. `POST /<IG_ID>/media_publish?creation_id=<CONTAINER_ID>`.

Notes:

- A published story reports `media_type` as `IMAGE` or `VIDEO`. With IG Login there is no documented way to confirm that a published item is a story, so keep the container ID and media ID locally.
- Containers expire after 24 h.
- Multi-frame stories must be published one at a time, in order. Stop at the first failure; third-party schedulers report that later frames fail too ([Later](https://help.later.com/hc/en-us/articles/360042772514-Schedule-Publish-Instagram-Stories), via search snippet).

### 4.3 Media delivery

- **Images:** always fetched from a public URL ("Meta cURLs media ... must be hosted on a publicly accessible server"). No byte upload exists for images on either login type. The IG Login `upload-media.md` page returned "Page Not Found" on 2026-10-11.
- **Video, FB Login only:** create the container with `upload_type=resumable`, then `POST https://rupload.facebook.com/ig-api-upload/<ver>/<CONTAINER_ID>` with headers `Authorization: OAuth <token>`, `offset: 0` and `file_size: <bytes>` and the binary body. A `file_url` header can be used instead of the body. To resume, read `video_status.uploading_phase.bytes_transferred`. Supported types are REELS, STORIES and VIDEO (carousel items); IMAGE is not supported.
- An untested idea: encode a still image as a short MP4 (3 s or longer) so it can be uploaded without hosting. The result would be a *video* story.

### 4.4 Unsupported features (documented)

- **Stickers:** link, poll and location stickers are not supported. Mentions work through `user_tags` (username required; x and y optional for stories).
- **Other unsupported fields:** `alt_text` ("Reels and stories are not supported"), `collaborators`, shopping tags and filters. `caption` and `location_id` are not documented for stories.
- **Not in the API at all:** music, text overlay, Close Friends audience and scheduling. No changelog entry from 2025 or 2026 adds any of these for stories ([changelog](https://developers.facebook.com/documentation/instagram-platform/changelog.md)).
- **Audio API (2026-06-01):**
  - Search with `GET /ig_audio?audio_type=music|original_sound&user_id=…&search_query=…`.
  - Attach with `audio_configuration {audio_id, audio_volume, video_volume}`. **The only `media_type` that accepts it is `REELS`, and it requires FB Login** ([doc](https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api.md)).
  - `download_url` expires after about 1.5 days.
  - Do not mux these tracks into stories: that use is undocumented and probably violates the licence.

### 4.5 Limits and errors

- **Publishing quota:** Meta documents disagree, giving 100 (guide), 50 (carousel section, `media_publish` reference, and `content_publishing_limit` "currently 50") and 25 (2023 blog). Read it live with `GET /<IG_ID>/content_publishing_limit?fields=config,quota_usage`. The quota is enforced on `media_publish`. Mocks should default to 50.
- **Container cap:** "An Instagram account can only create **400 containers** within a rolling 24 hour period". `content_publishing_limit` does not report this cap, so a validate-only dry-run (create the container without publishing) still uses it.
- **Error codes to map** (subcode / code), from [error-codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md):

| Subcode / code | Meaning | Handling |
|---|---|---|
| 2207052 / 9004 | Media could not be fetched from the URL | Check hosting |
| 2207003 / -2 | Download timeout | Retryable |
| 2207004 / 36000 | Image larger than 8 MiB | Fix the export |
| 2207005 / 36001 | Unsupported image format | Fix the export (the doc's "fix" text for this row is wrong) |
| 2207009 / 36003 | Aspect ratio out of range | Documented for the feed range; whether it applies to stories is undocumented |
| 2207026 / 352 | Unsupported video format, often bitrate | Fix the export |
| 2207053 | Unknown upload error | Recreate the container |
| 2207027 / 9007 | Media not ready | Poll longer |
| 2207020, 2207008 | Expired or temporary error | Retry 1–2 times within 30 s to 2 min |
| 2207042 / 9 | Publishing quota reached | Wait |
| 2207051 / 4 | Suspected spam | **Stop; do not retry** |
| 2207050 / 25 | Account restricted or checkpointed | **Stop**; the user must resolve it in the app |
| 2207001, 2207032 | Server or create failure | Retryable |
| 2207073 | Media type not supported (delete) | — |
| OAuth code 10 | Account is not Business | Explain that a Business account is required |

### 4.6 Auth and tokens without a backend

- **IG Login (Business Login for Instagram)** supports only the authorization-code flow:
  - Authorize at `https://www.instagram.com/oauth/authorize?client_id=…&redirect_uri=…&response_type=code&scope=instagram_business_basic,instagram_business_content_publish`. Optional parameters are `force_reauth` (2025-06-14) and `enable_fb_login` (re-supported 2026-02-06).
  - The code is single-use, valid for 1 h, and comes with a trailing `#_` that must be stripped.
  - Exchanging it at `POST https://api.instagram.com/oauth/access_token` **requires `client_secret`**. So does the long-lived exchange (`ig_exchange_token`).
- **Backend-free option for v1:**
  1. In the App Dashboard, use Instagram > API setup > "Generate token" to get a **60-day** token. Paste it into the options page and store it in `chrome.storage.local`.
  2. Refresh it with `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…`. This needs **no secret**. The token must be at least 24 h old and unexpired, with `instagram_business_basic`. Each refresh returns a new 60-day token (`expires_in` about 5,184,000).
  3. Schedule the refresh with `chrome.alarms` every 7–30 days, and warn the user before expiry.

  Whether dashboard tokens can be refreshed indefinitely while the app stays in Development mode is (unverified).
- **FB Login option:**
  - Implicit `response_type=token` works without a secret. The documented desktop redirect is `https://www.facebook.com/connect/login_success.html`, which returns the token in the URL fragment. Facebook Login for Business (`config_id`) defaults to an implicit grant.
  - A long-lived Page token from `/{user-id}/accounts` "does not have an expiration date".
  - A user token can be extended to 60 days manually with the Access Token Debugger.
- **`chrome.identity.launchWebAuthFlow`:**
  - Redirect URLs are `https://<ext-id>.chromiumapp.org/*`, and the call returns a Promise since Chrome 106.
  - Whether Meta accepts chromiumapp.org as a registered redirect is (unverified). Spike-test it early.
  - Pin the extension ID with a manifest `key`.
  - The archived Google "instagram-auth" sample is a Chrome packaged app that uses the legacy implicit flow. It is not precedent for Business Login.

### 4.7 Calling the API from an MV3 extension

- **CORS** (live probes, 2026-10-11):
  - `graph.instagram.com` and `graph.facebook.com` return `Access-Control-Allow-Origin: *`.
  - **The `graph.instagram.com` preflight fails**: OPTIONS returns 500 with no allow-headers. Avoid preflights by sending `access_token` as a query or form parameter, never as an `Authorization` header or a JSON body.
  - `api.instagram.com/oauth/access_token` and `rupload.facebook.com` send **no** CORS headers.
- **Where to call from:** make all calls from the service worker or extension pages, with `host_permissions` for `https://graph.instagram.com/*`, `https://graph.facebook.com/*`, and if needed `https://api.instagram.com/*` and `https://rupload.facebook.com/*`. Never call from content scripts, where cross-origin requests are always treated as cross-origin.
- **API version:**
  - Pin the version in a single constant. v26.0 (2026-07-29) is the newest; v25.0 (2026-02-18, supported until 2028-07-29) is used in the docs.
  - From **2026-10-27**, all versions lose `pretty`, `debug`, `date_format`, root `?ids=` and ETags.
  - A probe with a bogus token cannot prove that a version exists.

### 4.8 Does it need a backend?

- **Token handling:** no. Use a dashboard token plus refresh, or the FB Login implicit flow.
- **Media hosting:** **yes, unavoidably for images.** Options:
  - a user-owned bucket or CDN serving short-lived public objects, deleted after publish (signed URLs that expire quickly or need basic-auth reportedly fail);
  - a tiny serverless relay;
  - for video only, FB Login resumable upload.
- **Scheduling:** in the extension with `chrome.alarms` (the browser must be running), or in a backend.

### 4.9 Testing the official route

1. **Mock Graph API server**, the default target. It should mirror `/media`, `/<container>?fields=status_code`, `/media_publish`, `/content_publishing_limit` and `/refresh_access_token`, including the error subcodes in 4.5, a quota of 50 and the 400-container cap.
2. **Validate-only mode:** create a real container, poll until `FINISHED` or `ERROR`, and never publish. It uses the 400-container budget, so rate-limit it. That this performs real media validation is an inference.
3. **End-to-end:** a second real Business account with no followers, created by the user and given an app role. Clean up with `DELETE /<IG_MEDIA_ID>` (FB Login only; the docs show POST syntax), or manually, or wait for the 24 h expiry.
4. **No sandbox:** test users are Facebook-only, limited to 10, and their creation is "temporarily" removed ([test users](https://developers.facebook.com/docs/development/build-and-test/test-users)). Development mode's "only role users see data" applies to Facebook data, and whether it hides Instagram stories is (unverified); assume API stories are public.

---

## 5. Unofficial routes

### 5.1 How instagram.com chooses msite

- **Server-side classification:**
  - The initial HTML embeds an `InstagramUserAgent` JSON object with `is_mobile`, `is_ios`, `is_android`, `is_ipad`, `is_android_tablet`, `is_mobile_safari`, `is_in_app_browser`, `is_windows_pwa` and `user_agent`.
  - curl tests on 2026-10-11 showed that **only the User-Agent header matters**. A desktop UA sent with `Sec-CH-UA-Mobile: ?1` and `Sec-CH-UA-Platform: "Android"` returned `is_mobile:false`. An Android UA sent with `?0` and macOS hints returned `is_mobile:true`.
  - Because the JSON is in the initial HTML, **a reload is required after changing the UA**.
- **Client reads:** `PolarisUA.isMobile()` and `polarisGetAppPlatform` read the server JSON. Only the tablet heuristics (`isIpad`, which looks for a Macintosh UA with `maxTouchPoints > 1`, and `isAndroidTablet`) read `navigator`.
- **Desktop feed creation** is gated by `hasFeedCreation() = PolarisUA.isDesktop() && isLoggedIn()`. A mobile-classified tab therefore loses the desktop Post composer, so **scope the UA rewrite to the composer tab only**.
- **Portrait guards** (corrected 2026-10-12 from the second live run in Arc and Instagram's public bundles, strategy §11 AM37; the earlier text knew only the first one). msite makes **two different checks**, and they read different things:
  - **At + → Story (the session start).** `PolarisStoryCreationFileForm`'s Story tap calls `PolarisStoryCreationActions.startStoryCreationSession` *before* it opens the file chooser. When `window.innerHeight < window.innerWidth` it shows the toast "Rotate your device to add to your story." and rejects (no chooser); otherwise it dispatches `STORY_CREATION_SESSION_STARTED` with a uuid `sessionId`. This reads the **viewport**, so a narrow, tall window passes it (contract C3a). A file put straight into the story input (the H1 insert, §5.5) never runs it: `onFileChange` goes to `storyCreationSelectMedia` directly, and `sessionId` stays null.
  - **In the composer page (§5.2).** `PolarisStoryCreationPage` decides `isLandscape` from `usePolarisDisplayProperties`: the orientation is `screen.orientation.type` (or the `moz`/`ms` variants), else `window.orientation` (±90 → `landscape-primary`, anything else `portrait-primary`), else nothing, read when the page mounts and again on every window `resize`; with an orientation it is `startsWith('landscape')` (unless UC Browser), only without one `viewportWidth > viewportHeight`. This reads the **screen**, so on a desktop with a landscape monitor the composer is always "landscape", whatever the window (contract C3b). Seen live 2026-10-12 in Arc: a fitted 503x894 portrait window (`matchMedia('(orientation: landscape)')` false, `screen.orientation.type` `landscape-primary`) showed the snackbar instead of Share, after the H1 insert and after the owner's own + → Story → pick alike. instapost's answer is a narrowly scoped MAIN-world portrait shim in the composer tab (strategy §11 AM37).
  - The action popup is capped at 800x600, so it cannot be used.
  - The side panel's `path` must be an extension-local page, so instagram.com could only be shown there in an iframe, which would require stripping X-Frame-Options and CSP. Avoid that.
  - Use **`chrome.windows.create({type:'popup', width:430, height:932, url:'https://www.instagram.com/'})`** or a narrow normal window.
- **Web app IDs** (`PolarisConfigConstants`):

| App | ID |
|---|---|
| msite (`instagramWebFBAppId`) | `1217981644879628` |
| Desktop (`instagramWebDesktopFBAppId`) | `936619743392459` |
| Windows PWA | `487152425211411` |
| Oculus PWA | `1035956773910536` |

  `getAppId()` picks the desktop ID when `isDesktop()`, otherwise the msite ID. A spoofed tab therefore appears to the server as a *second web app* used by the same session.

### 5.2 What the msite story composer offers (2026-09/10 bundles)

- **Route and entry:** `/create/story/`. The entry point is `PolarisMobileCreationNavItem`, then `PolarisStoryCreationFileForm` with `entryPoint: 'quick_cam_button'`.
- **Landscape gate** (2026-10-12, strategy §11 AM37; the second of the two checks in §5.1): `PolarisStoryCreationPage` styles its shell for landscape and passes `isLandscape` to `PolarisStoryImageCreationContainer`, which then renders a `PolarisSnackbar` with `STORY_LANDSCAPE_WARNING_TEXT` ("Rotate your device to add to your story.") **instead of** its header and its Share footer; the photo stays on the canvas, but nothing can be shared. `isLandscape` comes from the *screen* orientation (§5.1), read when the composer page mounts with the photo and on every `resize`, not from the viewport the session start checked. The session start's `sessionId` (null after an insert) is carried in the story-creation state; whether a Share without it works is not known (live checklist L6, after L17).
- **Reducer actions** (`polarisStoryCreationReducer`):
  - `IMAGE_PROCESSED`, `VIDEO_PROCESSED` (the video path is unreached)
  - `ENTER_ADD_TEXT`, `CHANGE_TEXT`, `SAVE_TEXT`, `CHANGE_COLOR`
  - `DRAW_LINE`, `UNDO_DRAWING`, `CHANGE_ACTIVE_BRUSH`
  - `OPEN_STICKER_TOOL`, `ADD_STICKER`, `TOGGLE_STICKER_VARIANT`
  - `TOGGLE_SHARE_TO_FACEBOOK_STORY`, `SET_GEN_AI_SELF_DISCLOSURE`, `SAVE_STORY` (download)
- **Missing:** there are no music, mention, link, poll, location or audience actions.
- **Output size:** the composed canvas is exported as JPEG. Whether the canvas size follows viewport x DPR or the source size is (unverified). To find out, compare `upload_media_width/height` in the rupload params against the exported file, either in a fixture or on a throwaway account. Emulate a DPR of 3 or more if downscaling appears.

### 5.3 msite publish pipeline (exact requests)

**Photo story:**

1. The client uploads to `POST https://i.instagram.com/rupload_igphoto/fb_uploader_<uploadId>` (`PolarisAPIFbUploaderPhoto`), sent `withCredentials`, deliberately without `X-IG-WWW-Claim` or the device-id headers. Headers:
   - `Offset: 0`
   - `X-Entity-Length`, `X-Entity-Name`, `X-Entity-Type`
   - `X-Instagram-Rupload-Params: {media_type:1, upload_id, upload_media_height, upload_media_width, transcode_only}`
2. The client finalizes with `POST /api/v1/media/configure_to_story/` on www.instagram.com (`PolarisAPICreationFinalizeStory`). Body fields:
   - `caption` (text lines joined with `\n`)
   - `configure_mode:'1'` (1 = story reel; 2 = direct story)
   - `share_to_facebook`, `share_to_fb_destination_id`
   - `share_to_fb_destination_type`, either `PAGE` or `USER`
   - `upload_id`
   - `gen_ai_detection_method:'SELF_DISCLOSURE_FLOW'` when the AI label is set (present in the 2026-09 bundle, absent in 2026-06)

**Video story (in the code but unreached by the UI):**

1. `POST https://i.instagram.com/rupload_igvideo/story_<Date.now()>`, which can be chunked. A GET on the same URL returns `{offset}` for resuming. Params: `for_album:true`, `media_type:2`, `upload_media_duration_ms`, `video_format`, and others.
2. A cover frame grabbed at 1 s is uploaded through `rupload_igphoto` with the same `upload_id`.
3. `configure_to_story` is called with `upload_id` only.

**Endpoint history:**

| Period | Finalize endpoint |
|---|---|
| 2019–2022 | `/create/configure_to_story/` |
| 2025-10 | Gated by `gkx('16462')` between `/api/v1/media/configure_to_story/` and `/api/v1/web/create/configure_to_story/` |
| 2026-04 onwards | `/api/v1/media/configure_to_story/` only |

**Headers Instagram's client sends on web API calls:**

- `X-IG-App-ID`, `X-CSRFToken`, `X-ASBD-ID`, `X-IG-WWW-Claim` (`hmac…`), `X-Instagram-AJAX` (rollout hash)
- `X-Web-Device-Id`, `X-Mid`, `X-FB-LSD`
- **`X-IG-Max-Touch-Points: String(navigator.maxTouchPoints)`**
- a `jazoest` body token, computed as `'2'` plus the sum of the csrftoken's character codes

Tools that call these endpoints directly, such as OpenCLI, read these values from the live page and cookies instead of hard-coding them.

**Other web configure endpoints:** `/api/v1/media/configure/`, `configure_sidecar/`, `configure_to_clips/` and `configure_to_longform/`.

**After Share (2026-10-13 reading of `PolarisStoryCreationActions.uploadStory`, strategy §11 AM40):** `UPLOAD_REQUESTED`; the upload above (XHR, no timeout, no retry); only after a 2xx, the finalize above (XHR, 60 s timeout), any 2xx of which the client treats as success; then a success toast, the tray refresh (`POST /graphql/query`) and `pushState('/')`. On failure the "Upload failed." toast with Retry and no navigation; `feedback_required` shows a dialog, 401 `require_login` goes to the login page, a `checkpoint_url` navigates there. `uploadStory` has no in-flight guard: a second Share click uploads and publishes again. instapost never calls these endpoints; it reads the page's own requests from resource timing (`docs/contract.md` C13).

### 5.4 Making a desktop tab look mobile from MV3

| Backend | Mechanism | What stays inconsistent | Cost |
|---|---|---|---|
| **dNR (header only)** | A **session** rule from `updateSessionRules` with `condition.tabIds:[composerTab]` (tab IDs work only in session rules) sets `user-agent` on `www.instagram.com` and `i.instagram.com` | `Sec-CH-UA` (desktop), `Sec-CH-UA-Mobile: ?0`, `Sec-CH-UA-Platform`, `navigator.userAgent`, `navigator.userAgentData`, `navigator.maxTouchPoints` (0, sent as `X-IG-Max-Touch-Points`), pointer and hover media queries | No infobar; permissions `declarativeNetRequestWithHostAccess` plus Instagram host permissions |
| **dNR plus MAIN world** | Also `set` `sec-ch-ua`, `sec-ch-ua-mobile: ?1` and `sec-ch-ua-platform`, and `remove` the high-entropy hints (pattern from [UserAgent-Switcher](https://github.com/ray-lothian/UserAgent-Switcher/blob/master/v3/network.js), verified on Chrome 154; derive GREASE brands the way Chromium does). Add a `world:'MAIN', runAt:'document_start'` content script that overrides `navigator.userAgent`, `platform`, `maxTouchPoints` and `userAgentData` | Navigators inside workers; media queries; screen and DPR | Generate both from **one shared device-profile module**. Chrome's dNR docs do not explicitly allow `set` on `sec-ch-ua*`, but Chromium source applies no deny-list |
| **`chrome.debugger` Emulation** | `Emulation.setUserAgentOverride` (with `userAgentMetadata`, which drives both the Sec-CH-UA headers and `userAgentData`), plus `setDeviceMetricsOverride({mobile:true, deviceScaleFactor:3…})` and `setTouchEmulationEnabled({enabled:true, maxTouchPoints:5})` | Fewest mismatches | `debugger` permission (make it optional). A global "*Extension* started debugging this browser" infobar appears; it is not a prompt. Opening DevTools on that tab detaches the session. Enterprise policies can block attach (stricter in M155). Allows `Network.setBypassServiceWorker` |

Additional constraints:

- **Instagram's service worker** (corrected 2026-10-12 from a logged-out reading of production code, strategy §11 AM30; the earlier text guessed `/service-worker-<hash>.js` and a worker that serves the page):
  - **Path and registration.** Every logged-in page load registers the root-scope worker at `/www-service-worker.js?s=push&__d=www&enableAddToHomeScreen=<derived from is_mobile>&zenon_device_id=<id>`. A URL that differs from the registered one (the mobile composer's `enableAddToHomeScreen` differs from the owner's desktop tabs') installs a **new** worker.
  - **Lifecycle.** The new worker calls `skipWaiting()` on install and, on activate, `clients.claim()` (and disables navigation preload). So the composer page becomes **controlled within about a second on every hand-off**, hard reload or not, and fires `controllerchange`; the first live run (2026-10-12) saw `swControlled: true` at the probe.
  - **No fetch handler** (the 2024 copy that could be read logged out; the 2026 worker is behind login). The worker never handles the page's requests: they stay attributed to the tab, so the tab-scoped rule 1001 still rewrites them, and their `PerformanceResourceTiming.workerStart` is 0. Being controlled is therefore harmless; what would matter is interception. dNR still "won't affect responses generated by the service worker or retrieved from CacheStorage", and tab-scoped rules miss service-worker fetches (tabId -1), so instapost treats `workerStart > 0` on a www/i.instagram.com request (or on a navigation that was not a reload) as fatal (`SW_INTERCEPTS`) and keeps rule 1001 tab-only.
  - The smoke test must still check that the loaded page's JSON says `is_mobile:true` and that the mobile Create item (+ → Story, only at ≤ 767 CSS px, F3) exists. Do not just trust the rule.
- **Login:** **never log in inside the spoofed tab.** The login-time fingerprint (`CIPCanvasID`) hashes the UA, `userAgentData`, touch points, screen, DPR, media queries and WebGL. Log in normally on desktop first, then open the mobile-mode window.
- **Avoid these:**
  - stripping X-Frame-Options or CSP to iframe instagram.com (INSSIST 2022 did this);
  - appending an Instagram app version to the UA, which can trigger `unsupported_version` checkpoints;
  - forging `origin` or `sec-fetch-dest` headers.

### 5.5 Handing the file to Instagram's composer

1. **Build the file:** `new File([blob],'story.jpg',{type:'image/jpeg'})`, then `const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;`.
2. **Dispatch events:** bubbling, composed `input` and `change` events. If the site reads a dropzone instead, dispatch a `DragEvent('drop')`. The DOM is shared across worlds, so React's root listeners see the change.
3. **Caveats:**
   - Dispatched events have `isTrusted=false`. Whether Instagram checks this is (unverified); test it in a fixture and on a throwaway account.
   - CDP `DOM.setFileInputFiles` is trusted but needs file paths on disk.
4. **Getting the blob from the side panel to the content script:** Chrome 148 or later with the manifest key `"message_serialization": "structured_clone"` sends `Blob` and `File` directly ([blog, 2026-04-22](https://developer.chrome.com/blog/structured-clone-messaging)). Every messaging peer must use the same format, otherwise the port closes. Without it, send chunked ArrayBuffers over a Port.
5. ~~**Leave the final "Share to story" click to the user.**~~ **Superseded on 2026-10-13 by the owner's decision (strategy §11 AM39, `docs/ux.md`).** instapost now taps Instagram's own + (Create), the Story menu item and Share with `element.click()` from the isolated world, and puts the file only into the story input that + → Story armed (so Instagram's story session starts, with its portrait check and a uuid session id; a file set without it skips the session). Instagram's own client still builds and sends every request. The facts behind it (the menu's two actions, no `isTrusted` or `userActivation` reads on that path, no chooser without user activation, Share without an in-flight guard, the outcome read from resource timing) are in `docs/contract.md` C10–C14 and § "Autopilot spike (2026-10-13)". This moves the extension from assisted to automated use under the terms discussed in §5.8 (strategy OD9).

### 5.6 Private endpoints beyond msite

- **Native-app sticker schema**, documented by instagrapi:
  - `configure_to_story` on `i.instagram.com` takes Android device fields, `reel_mentions`, and `tap_models` normalized to 0–1.
  - `story_sticker_ids` values are `hashtag_sticker`, `location_sticker`, `link_sticker_default` and `polling_sticker_v2`.
  - Links go through `media/validate_reel_url/`, and only one link is used.
  - Music uses `music_params {audio_asset_id, audio_cluster_id, audio_asset_start_time_in_ms, overlap_duration_in_ms, product:'story_camera_music_overlay_post_capture', …}`, `music_burnin_params`, and `edits.media_audio_overlay_info.audio_mix_burned_in`. The audio is burned in locally, and a photo becomes a 15 s clip.
  - Close Friends was historically `audience:'besties'` (dilame).
- **OpenCLI** (30K stars, `instagram story`): reuses the browser session, but posts an **Android-signed body**: `ig_sig_key_version=4`, `signed_body=<HMAC-SHA256>.<json>` with an embedded key and a fake Samsung SM-G930F device. That mixed identity is the high-risk pattern to avoid.
- **INSSIST v23.2.1** (MV2, 2022 copy): ran an iPhone OS 11 UA, plus `Instagram 231.0.0.18.113` on `/api/v1/` calls. It also:
  - stripped XFO and CSP;
  - forged `origin` and `sec-fetch-dest`;
  - redirected Instagram's service worker to its own copy;
  - monkey-patched Instagram's `http.post` to inject `reel_mentions`, plus `reshared_media_id`, `story_sticker_ids` and `attached_media` for reshares.

  Its current MV3 mechanism is not inspected.

### 5.7 Ecosystem (as of 2026-10-11)

| Item | Status | Notes |
|---|---|---|
| INSSIST (bcocdbombenodlegijagbhdjbifpiijp) | v39.8.2, 600K users, 4.7 stars from 8.4K ratings, MV3 | Photo and video stories free. PRO adds story music, mentions, location, links, scheduling ("publishes when the browser is online") and growth automation. Pro costs $14.5/mo, Lifetime $145. Trustpilot 3.1 from 28 reviews, with lockouts and unreliable posting reported. Story music claims are unverified |
| InLoad (ikcgnmhndofpnljaijlpjjbbpiamehan) | v1.0.7, 2025-11-03, 50K users | Mobile-view wrapper |
| IG Story Desktop (kkbfdganebpdpboknjfkiokbejiaojdl) | v1.0.0, 2026-04-06, about 700 users | One-click mobile mode |
| StoryFlow (fenofcbigfihegijdcpoiabnjindlble) | v1.0.0, 2026-01-30, 3.3 stars from 6 ratings | Overlay on instagram.com; "uses Instagram's upload API with browser cookies" |
| EasyLoad (elnnmjddaleoeklbolbfhagpikikkkin) | v1.1.3, 2026-09-30, 10K users | Text, stickers, custom audio, scheduling; mechanism undisclosed |
| Removed or unpublished (Chrome update service returns `noupdate`) | — | Phoneon, both "Desktop for Instagram" IDs, App for Instagram, StoryTeller, Upload to Instagram Story, njgjofbileedkmkphcmhmpngdjdeloeh. Store listings churn |
| instagrapi (Python) | 3.0.21, 2026-10-09; 11 releases since 2026-09-21; Beta | Mobile private API over HTTP/2 with CAA login. Self-described as "best suited for testing, research". Only useful as a schema reference |
| dilame/instagram-private-api | 1.46.1, 2024-03-07, stale | Historical sticker types |
| jlobos/instagram-web-api, Gimenz/insta-fetcher | Stale, hard-coded headers | — |
| OpenCLI | Active (pushed 2026-10-10) | Android-signed story calls; avoid this pattern |

No maintained JavaScript library exists to embed. Any direct-call code would be the project's own, with ongoing maintenance.

### 5.8 Breakage history, terms of use and enforcement

- **Breakage in 2026:**
  - Version checkpoints for emulated app clients: instagrapi #2369 (2026-02-04, `unsupported_version`) and #2773 (2026-08-20, `needs_upgrade`).
  - Repeated web-endpoint and GraphQL drift: OpenCLI #2241, #2247, #2456 and #2553 (2026-08/09).
  - The story finalize endpoint changed between 2025-10 and 2026-04.
- **Instagram Terms of Use** (effective 2025-01-01, last recorded change 2026-08-29, [Open Terms Archive](https://github.com/OpenTermsArchive/pga-versions/blob/main/Instagram/Terms%20of%20Service.md)) prohibit:
  - automated access "without our express permission";
  - "interfere with or impair the intended operation";
  - reverse engineering;
  - "circumvent, by-pass, or override any technological measures that control or limit access".

  No clause names UA switching. Whether a hidden desktop UI limit counts as such a "measure" is a matter of interpretation.
- **Enforcement:** Meta's lawsuits targeted commercial automation sellers that mimicked the official app's connection (2020), scrapers, Octopus (2022) and Voyager Labs (2023), not individual users. Mass mistaken bans were reported in 2025-06 ([TechCrunch](https://techcrunch.com/?p=3019034)).
- **Triggers reported for "We suspect automated behavior"** (Storrito, 2026): unconfirmed 2FA logins, VPN or IP changes, multiple devices, using a browser, ad-blockers and rapid posting.
- **Mitigations:**
  - no retries on anti-abuse responses (429, `feedback_required`, `challenge_required`, 2207051);
  - human pace and one account;
  - a stable IP;
  - authenticator-app 2FA.
- **Chrome Web Store policy** applies only if the extension is published. The policy (2025-05-22) bars facilitating "circumventing paywalls or login restrictions" and requires a single purpose and the narrowest permissions. Keep the extension **unpacked and personal**.

### 5.9 Risk tiers, lowest to highest

| Tier | Route | Notes |
|---|---|---|
| 0 | Official: Graph API (Business), MBS, native app, export to phone | No terms-of-use risk. Graph API and MBS lack music |
| 1 | msite UI hand-off: Instagram's own client sends the requests; the user clicks Share | The UA, app-ID and touch-point mismatches above. No new login |
| 2 | Hand-built msite web requests (rupload plus `configure_to_story`) | Every header is maintained by hand and drifts; any mistake creates an unseen fingerprint |
| 3 | Native-only fields (`reel_mentions`, `tap_models`, `music_params`) or Android-signed bodies from a web session | A client identity no real client produces (OpenCLI pattern, INSSIST 2022) |
| 4 | Password login as an emulated device (instagrapi) or third-party SaaS | New-device challenges and checkpoints; handing a session to a third party is a listed restriction reason |

Tiers 1 and above are a synthesis; Meta publishes no risk model.

---

## 6. Text and music: what is achievable from desktop

### 6.1 Text

- **Render all text as canvas pixels** and label it "burned-in (not editable on Instagram)".
  - In the app, story text is pixels plus separate `text_metadata` (instagrapi sends it as a hard-coded constant). Extension-rendered text therefore loses native-text features. Instagram launched "See Translation" for story text in 2021, and whether it works only on native text is (unverified).
  - Neither the Graph API nor msite has a rich-text field. The msite route sends overlay text as `caption` only if the composer's own text tool is used.
- **Text engine needs:**
  - manual line wrapping (canvas has none);
  - rounded highlight boxes per line, like Instagram's "Classic" and "Strong" styles;
  - stroke, glow (`shadowBlur`), alignment, and rotate and scale handles;
  - `ctx.letterSpacing` and `wordSpacing` (Chrome 99+) and `fontKerning`;
  - fonts loaded through FontFace or `document.fonts.load` before calling `fillText`;
  - in workers, `self.fonts` loaded before rendering an OffscreenCanvas.

### 6.2 Fonts and emoji

- **Fonts:** Instagram's fonts are proprietary. [Kapwing (2025-12-30)](https://www.kapwing.com/resources/about-the-new-instagram-fonts) lists these OFL Google Fonts lookalikes:

| Instagram style | Lookalike |
|---|---|
| Classic | Instrument Sans |
| Modern | Gabarito |
| Typewriter | Courier Prime |
| Strong | Racing Sans One |
| Elegant | Antic Didone |
| Directional | Lexend |
| Literature | Cormorant |
| Signature | Marck Script |
| Editor | JetBrains Mono |
| Bubble | Coiny |
| Deco | Quicksand |
| Poster | Gravitas One |
| Squeeze | Fjalla One |

  Bundle these as woff2 files and label them "Instagram-like". Do not use Instagram names or branding in the UI. Instagram's text effects are Neon, Sparkle, Shimmer and Pixel, and its animations include Pop and Jump.
- **Emoji:** canvas `fillText` uses the operating system's emoji font, so output varies by machine. Offer two settings:
  - "System emoji";
  - bundled **Noto Color Emoji** (COLRv1, Chrome 98+). Download the full font from the googlefonts/noto-emoji releases, because the Google Fonts CSS API serves subsets.

  Twemoji is an alternative: `@twemoji/api` 17.0.3, graphics under CC-BY-4.0 (attribution required). Use `Intl.Segmenter` so wrapping never splits ZWJ sequences.

### 6.3 Interactive stickers

- **Mention, hashtag, location, link and poll stickers are metadata** (`tap_models` and `story_sticker_ids`), not pixels. Only the app or native-app emulation can create them.
- **Do not draw fake interactive stickers.** Offer a "reserve space for sticker" placeholder layer that appears in the preview and is never exported.
- **Available elsewhere:** clickable mentions are possible only through Graph API `user_tags` (invisible, with the FB Login caveat). Link stickers are possible only through MBS or the app.

### 6.4 Music: options

| Option | How | Surfaces | Pros | Cons and risk |
|---|---|---|---|---|
| **A. Burn in user-supplied or royalty-free audio** | Decode with `decodeAudioData`, mix with `OfflineAudioContext` (gain, fades, ducking), encode to AAC, mux into the MP4. A photo becomes a video of at least 3 s (default 15 s) | Graph API (Business) or manual MBS upload. **Not msite, which is photo-only** | Fully desktop; deterministic | Not an Instagram music sticker (no lyrics or sticker UI). The music guidelines (2020-05-20, possibly stale) permit "Music in stories" but limit full-length recorded tracks; Rights Manager can mute, block or remove. Business accounts may face stricter matching (unverified) |
| **B. Prepare on desktop, add music in the app (recommended for licensed music)** | Export 1080x1920 JPEG or MP4 and move it to the phone, then add the Music sticker in the app | Native app | The only way to get licensed music; works for every account type | Manual step on the phone. Drafts do not sync. Leave room for the music sticker (placeholder guide) |
| B1. Hand-off channels | `navigator.share({files})` from the extension page (secure context, needs a user gesture; on macOS this probably reaches AirDrop, unverified); a QR code to an **HTTPS** companion page (a plain-HTTP LAN page cannot use the Web Share API); OS sync (AirDrop, iCloud or Google Photos); the deep link `https://www.instagram.com/linking/create-story?story_camera_mode=live` from Instagram's 2026 blog (phone behaviour unverified; not routed on web) | — | — | Meta's Sharing to Stories SDK (`instagram-stories://share`, `com.instagram.share.ADD_TO_STORY`, Facebook App ID required since Jan 2023) is **native-app only**. Whether music can be added in the composer it opens is (unverified) |
| C. Licensed music through the private API | instagrapi-style `music_params` and `music_burnin_params` | Native-app emulation | Real music sticker metadata | Tier 4 risk: terms violation and ban risk. **Out of scope** |
| D. A Reel with music instead of a Story | Graph API Audio API (FB Login, Business or Creator plus a Page, `REELS` only), or the desktop web Reels composer (its code sends `music_params` to `configure_to_clips`, but the Help Center says music is unavailable on computers, so UI exposure is unverified) | Graph API or desktop web | Official licensed audio | It is a Reel, not a Story; sharing it to Story is a manual step on the phone |

Industry precedent: Sprout Social's "Mobile Publisher" and Buffer's notification publishing both hand off to the phone for music, stickers and links.

---

## 7. Browser editing tech

### 7.1 Where code runs

- **WebCodecs** (`VideoEncoder`, `AudioEncoder`, `VideoDecoder`, `ImageDecoder`) is `[Exposed=(Window,DedicatedWorker), SecureContext]`. **`OfflineAudioContext` is Window-only.** Neither is available in the MV3 service worker, where dynamic `import()` is also blocked.
- **Put the editor in an extension page:** the side panel (Chrome 114+; `sidePanel.open()` needs a user gesture, 116+) or a full tab. Run rendering and encoding in a **dedicated worker** spawned from a **packaged file**. Do audio mixing in the page.
- **Offscreen document** (Chrome 109+, reasons `BLOBS` and `WORKERS`): use it only if exports must continue after the panel closes. Only one can exist per extension, and only `chrome.runtime` is available inside it. With reason `AUDIO_PLAYBACK` it closes after 30 s of silence.

### 7.2 Image pipeline

1. Decode with `createImageBitmap(blob,{imageOrientation:'from-image'})`. For HEIC input, decode with heic-to or libheif first.
2. Preview interactively on a display-size canvas.
3. Render the final image on a 1080x1920 OffscreenCanvas. Downscale with **pica** (`mks2013` filter). Do not use pica's `cib` path, which is "buggy in Chrome".
4. Encode with `convertToBlob({type:'image/jpeg', quality:0.92})`, or with `@jsquash/jpeg` (mozjpeg). Step the quality down until the file is 8 MB or less.

### 7.3 Video and audio pipeline

- **Toolkit:** **Mediabunny 1.61.3** (2026-10-05, MPL-2.0, released almost weekly). It supersedes the deprecated `mp4-muxer`, and Remotion is migrating to it. Use the `Conversion` API:
  - `trim {start,end}`;
  - `video: {width:1080, height:1920, fit:'cover', crop, rotate, frameRate:30, codec:'avc', process(sample) for overlay drawing}`;
  - `allowTransformationMetadata` (`allowRotationMetadata` is deprecated);
  - `quality` (`bitrate` is deprecated).

  To replace audio, set `audio:{discard:true}` and `composable:true`, then call `output.addAudioTrack(AudioBufferSource)`. Mediabunny has no built-in mixer.
- **Edit-list pitfall:** Mediabunny writes `edts/elst` whenever a track's first timestamp is not 0, including a trimmed start or encoder priming. The Graph API forbids edit lists. **Shift both tracks so they start at 0** and assert in tests that no `edts` box exists.
- **H.264 encoding:**
  - The H.264 level must fit the frame size. 1080x1920 is coded as 1088x1920 = 8160 macroblocks, which needs **Level 4.0** (`avc1.640028`). At 60 fps, use Level 4.2 (`avc1.64002a`).
  - Use `hardwareAcceleration:'no-preference'`; the prefer-* values are treated as hard requirements.
  - The software fallback is OpenH264. It is absent from Chromium builds without proprietary codecs.
- **AAC encoding:** only OS encoders are used. AAC is enabled on **Windows, macOS and Android**, and disabled on Linux and ChromeOS. Windows N editions lack it, and Windows accepts only bitrates of 96, 128, 160 or 192 kbps. Check `canEncodeAudio('aac')` and fall back to `@mediabunny/aac-encoder` (about 1 MB). On the owner's Mac, native AAC works; Linux CI needs the fallback.
- **HEVC:** WebCodecs encoding has needed no flag since Chrome 130 on Windows, macOS and Android (hardware only, except macOS, which also has a software encoder). Do not offer HEVC output.
- **iPhone input:** accept HEVC and HDR video. Decoding needs Chrome 107+ (10-bit 108+); HDR is supported on Windows and macOS; Linux needs VAAPI. Probe with `VideoDecoder.isConfigSupported` or MediaCapabilities. Render HDR through an sRGB canvas to get 8-bit SDR; Chrome's exact tone-mapping is (unverified). Include an iPhone HDR HEVC sample in the test fixtures.
- **ffmpeg.wasm:** fallback only. `@ffmpeg/core` 0.12.10 (2025-01-07) has had slow releases, is about 30 MB of wasm and is GPL-2.0-or-later. Use the single-thread core; the multi-thread core needs COOP/COEP isolation, and whether that works in offscreen documents is (unverified). Load it from `chrome.runtime.getURL` paths, never `toBlobURL`.

### 7.4 MV3 CSP and worker constraints

- **Manifest CSP:** `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"}`.
  - The default MV3 policy is `script-src 'self';`, which disables wasm.
  - Adding `'unsafe-eval'` or `blob:` to `script-src` or `worker-src` makes the extension **fail to load**.
  - Unpacked MV3 extensions additionally allow `http://localhost:*` and `http://127.0.0.1:*` script sources, which the dev server needs. Packed builds do not.
- **No `blob:` workers.** Chromium's `'self'` never matches `blob:`, and `worker-src` falls back to `script-src`. These libraries create blob workers by default:
  - **heic-to** (all builds);
  - **`@mediabunny/aac-encoder`** (`inlineWorker`);
  - **pica's full build**;
  - **ffmpeg.wasm's `toBlobURL` pattern**.

  The failure is inferred from Chromium source, not run in a browser. Fix by emitting each worker as a packaged file (a Vite or Rollup worker entry, `patch-package`, or pica's `pica_main.mjs` plus `pica_worker.js` with `workerURL`). Alternatively, host them in a manifest `sandbox` page, which allows a custom CSP but has no `chrome.*` APIs and talks over `postMessage`. Confirm that WebCodecs is available there.
- **Content scripts:** isolated-world MV3 content scripts get Chrome's own isolated-world CSP, which includes `'wasm-unsafe-eval'`. MAIN-world scripts are subject to instagram.com's CSP. Never run wasm in Instagram content scripts.

### 7.5 Library table

| Library | Version and date | License | MV3 notes |
|---|---|---|---|
| mediabunny | 1.61.3, 2026-10-05 | MPL-2.0 | Primary mux/demux/convert. Pin together with the AAC encoder |
| @mediabunny/aac-encoder | 1.61.3, 2026-10-05 | MPL-2.0 | Blob worker; patch it. Needs wasm |
| pica | 10.0.3, 2026-08-15 | MIT | Use the split build. Default export is a factory; global OffscreenCanvas override |
| heic-to | 1.6.6, 2026-10-11 (libheif 1.23.6) | LGPL-3.0 | A wasm2js build (about 3.1 MB of JS per entry point, no real wasm). Blob worker, so patch it or use `libheif-js` 1.23.5 in a packaged worker. The non-csp build uses `new Function`. heic2any 0.0.4 (2023) is unmaintained |
| @jsquash/jpeg | 1.6.0, 2025-05-12 | — | mozjpeg encoder |
| @jsquash/resize | 2.1.1, 2026-01-05 | — | Alternative resampler |
| wasm-vips | 0.0.19, 2026-09-29 | MIT | Heavy alternative |
| @ffmpeg/ffmpeg and @ffmpeg/core | 0.12.15 / 0.12.10, 2025-01-07 (core-mt 2025-04-28) | GPL-2.0-or-later | Lazy, optional fallback |
| @twemoji/api | 17.0.3, 2026-06-01 | MIT code, CC-BY-4.0 graphics | Optional emoji images |
| mp4-muxer | 5.2.2, 2025-07-02 | — | **Deprecated**; do not use |
| @remotion/webcodecs | 4.0.534 | — | Being phased out in favour of Mediabunny |

Licences matter once a build is shared: every shipped build carries `licenses/THIRD-PARTY.txt` (and libheif's LGPL text, since the HEIC worker bundles libheif-js). Keep ffmpeg.wasm optional so the bundle never becomes GPL by accident.

---

## 8. Extension engineering, dev environment and testing

### 8.1 Framework

- **WXT ≥ 0.21.4** (released 2026-08-11, commits daily, about 10.6k stars). Versions 0.21.0–0.21.3 ignored `web-ext.config.ts`.
  - Requirements: Node 22 or later and vite ^6.3.4, ^7 or ^8. TypeScript 5.4+ and **web-ext ≥ 9.2.0** are optional peers; install web-ext yourself as a devDependency.
  - File-based entrypoints: `background`, `sidepanel`, `*.content.ts`, `options`.
  - `manifest: ({browser, manifestVersion, mode, command}) => ({…})` builds a different manifest per mode. `wxt --mode <m>` and `import.meta.env.MODE` select the mode, with `.env.[mode]` files and the `WXT_` and `VITE_` prefixes.
  - Content scripts accept `world:'MAIN'`. SPA navigation is available via `ctx.addEventListener(window,'wxt:locationchange',…)`.
  - Extension pages get HMR. Content-script UIs get HMR only through `createIframeUi`.
- **Dev manifests differ from build manifests.** In dev mode WXT omits `content_scripts`, registers them at runtime with `scripting.registerContentScripts`, adds the `tabs` and `scripting` permissions and host permissions, and adds the dev-server origin to the CSP. Two consequences:
  - The first page load after the browser starts can run before the scripts are registered.
  - **Run E2E tests and permission or manifest snapshot tests against `wxt build --mode e2e` output only.**
- **Document-start override:** use `defineContentScript({matches:['https://www.instagram.com/*'], world:'MAIN', runAt:'document_start', allFrames:true})`, which is a documented guarantee. In MV3 WXT's `injectScript` is synchronous per WXT docs, but its ordering against inline page scripts is unproven.
- **Alternatives:**
  - **CRXJS 3.0.0** (2026-09-24, ESM-only, vite ^3–^8) is a viable bare-Vite fallback. Document-start scripts must be IIFE. WXT's comparison says CRXJS does not respect content-script `run_at`.
  - **Plasmo** has had no release or commit since 2025-05-17. Do not use it.

### 8.2 Browser and extension loading (Chrome changes)

| Change | Since | Effect |
|---|---|---|
| `--load-extension` removed from branded Google Chrome | Chrome 137 ([PSA, 2025-04-04](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ)) | Now a hard compile-time ignore that logs "--load-extension is not allowed in Google Chrome, ignoring.". `--disable-features=DisableLoadExtensionCommandLineSwitch` **no longer works** |
| `--disable-extensions-except`, `--extensions-on-chrome-urls` removed from branded Chrome | Chrome 139 ([PSA, 2025-06-12](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/FxMU1TvxWWg/m/daZVTYNlBQAJ)) | Use Chromium or Chrome for Testing (CfT) |
| `--remote-debugging-port` and `--remote-debugging-pipe` ignored on the default profile | Chrome 136 | Always use a non-default `--user-data-dir` |
| `--load-extension` also ignored in Chromium/CfT under Enhanced Safe Browsing or a `command_line` entry in ExtensionInstallTypeBlocklist | Current main | Use fresh temporary profiles. The harness should assert that the extension's service worker appears within N seconds |
| Supported loading path for branded Chrome | CDP `Extensions.loadUnpacked({path})` over `--remote-debugging-pipe` with `--enable-unsafe-extension-debugging` | Used by web-ext 8.8.0 and later (latest 10.7.0, 2026-09-21), and therefore by WXT dev. Puppeteer offers `enableExtensions`, `installExtension` and `triggerExtensionAction`. `--remote-debugging-pipe` sets `navigator.webdriver=true`, which web-ext counters with `--disable-blink-features=AutomationControlled` |

- **Chrome for Testing** on 2026-10-11 was Stable **155.0.8059.39** and Beta 156.0.8078.12. Install with `npx @puppeteer/browsers install chrome@stable`. It does not auto-update and is meant for trusted content only.
- **WXT runner configuration:** `webExt: { binaries:{chrome:<CfT path>}, startUrls:[…], chromiumArgs:[…], chromiumProfile, keepProfileChanges }`. Put developer-specific values in a gitignored `web-ext.config.ts`. To keep a login, use `chromiumArgs:['--user-data-dir=./.wxt/chrome-data']` and gitignore that directory, because it holds Instagram session cookies.

### 8.3 Extension primitives and permissions

- **Manifest baseline:**
  - `permissions`: `sidePanel`, `storage`, `scripting`, `declarativeNetRequestWithHostAccess`. Add `declarativeNetRequest` for block rules, which need no host access, in non-live modes.
  - `host_permissions`: `https://www.instagram.com/*` and `https://i.instagram.com/*` (rupload host, for UA consistency). Add the Graph hosts if the API adapter is built.
  - `optional_permissions`: `debugger`, `offscreen`.
  - `minimum_chrome_version`: 148 if structured-clone messaging is used.
- **dNR limits** ([docs, 2026-09-11](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)):
  - 5,000 session rules (Chrome 120+);
  - 30,000 safe dynamic rules (Chrome 121+);
  - 5,000 unsafe dynamic or session rules (`modifyHeaders` and `redirect` count as unsafe);
  - 50 enabled static rulesets out of 100;
  - 1,000 regex rules.

  `append` is allowlisted (the list includes user-agent). Request-header changes stop applying once the response arrives. `topDomains` and `excludedTopDomains` exist since Chrome 145.
- **dNR also covers the extension's own requests.** Rules apply to requests from the extension's own service worker, side panel and offscreen pages; only requests from *other* extensions are skipped (`ruleset_manager.cc`). So a block ruleset also guards the extension's own fetches.
- **Withheld site access:** if the user withholds access, `chrome.permissions.addHostAccessRequest({tabId})` (Chrome 133+) re-prompts. It only works with the new extensions menu, and whether that menu is default in 155 is (unverified). Keep a fallback UI message.
- **Side panel API gates:** `getLayout` 140+, `close` and `onOpened` 141+, `onClosed` 142+, and since 145 `close()` rejects when only the global panel is open. `offscreen.hasDocument()` needs 150+; `runtime.getContexts` works from 116+. Chrome 148 exposes the `browser.*` namespace.

### 8.4 Unit tests

- **Setup:** Vitest with `WxtVitest()` (from `wxt/testing/vitest-plugin`) and `fakeBrowser.reset()` in `beforeEach`.
- **fakeBrowser coverage:** it implements only `action`, `alarms`, `notifications`, `runtime`, `storage`, `tabs`, `webNavigation` and `windows`. Every other API **throws `MockNotImplementedError`**. Put `declarativeNetRequest`, `sidePanel`, `offscreen`, `debugger` and `scripting` behind small adapter modules (`src/platform/*.ts`) and `vi.mock` them.
- **What to test this way:** pure crop, text layout and safe-zone logic; the device-profile generator (dNR rules and MAIN-world values from one source); the Graph client state machine; the error classifier.
- **MSW** (3.0.3, 2026-10-10): use `msw/node` **only in Vitest**, for HTTP-client code. MSW cannot intercept instagram.com from an extension ([msw#2667](https://github.com/mswjs/msw/issues/2667)).
- **Media pipeline:** keep it as a plain ES module and test it in an ordinary page with Playwright `channel:'chrome'` (branded Chrome has the codecs; no extension is needed). Probe `VideoEncoder.isConfigSupported` and `canEncodeAudio`, since codec availability in Chromium or CfT CI builds is not guaranteed. Add an **MP4 validator test**: no `edts` box, `moov` before `mdat`, constant 23–60 fps, at least 3 s, AAC at 48 kHz or less.

### 8.5 E2E with a fake Instagram

- **Launch:** Playwright **1.64.0** (2026-10-07) bundles CfT (since 1.57; since 1.63 also on Linux arm64). Use `chromium.launchPersistentContext(userDataDir, {channel:'chromium', args:['--disable-extensions-except='+p, '--load-extension='+p]})` with `p = .output/chrome-mv3`.
  - Headless works on channel `chromium`; the default headless shell cannot load extensions.
  - Get the service worker with `context.serviceWorkers()[0] ?? waitForEvent('serviceworker')`. The extension ID is `sw.url().split('/')[2]`. A manifest `key` makes the ID stable.
- **Side panel:** not supported ([#26693](https://github.com/microsoft/playwright/issues/26693)). Open `chrome-extension://<id>/sidepanel.html?tabId=…` in a tab. Optionally add one flaky-gated real-panel test using `PW_CHROMIUM_ATTACH_TO_OTHER=1`.
- **Fake Instagram at the real origin:** use `context.route('https://www.instagram.com/**')` to serve a local fixture app (`fixtures/fake-instagram/`). It should provide desktop and msite variants that reproduce only the DOM contract:
  - the mobile Create "+" item and the "Story" entry;
  - the hidden `<input type=file accept="image/avif,image/jpeg,image/png">`;
  - the portrait guard and the "Rotate your device" toast;
  - an inline `InstagramUserAgent` JSON whose `is_mobile` reflects the request UA;
  - React-style root listeners;
  - a Share button.

  Stub `rupload_igphoto` and `configure_to_story` with `route.fulfill`, assert on the captured bodies and headers (UA, `X-IG-App-ID`), and **abort every other request** to `*.instagram.com`, `*.cdninstagram.com`, `*.fbcdn.net` and `*.facebook.com`.
- **Keep `serviceWorkers:'allow'`** (the default). `serviceWorkers:'block'` disables Playwright routing for every service-worker target, **including the extension's MV3 worker**, which would open a hole in the fail-closed setup. The fixture does not register a service worker, and Instagram's real one never loads. Add a test asserting that a fetch from the extension's service worker to instagram.com is caught. Requests from a real side panel or offscreen document may bypass routing (unverified); the dNR and build-mode safeguards cover them.
- **dNR runs before Playwright routing.** Chromium appends the extension proxy before DevTools interception, so a dNR block or redirect probably fires before `route()` sees the request (inferred from source). dNR `modifyHeaders` may also not show on `route.fulfill` responses. **Omit the write-block ruleset in `e2e` builds**, and assert the UA from request headers seen by `route` or from a JS probe.
- **HAR:** use only for one-off capture of read-only pages to seed the fixture. Matching is strict on URL, method and POST body. Scrub cookie values (`sessionid`, `csrftoken`, `ds_user_id`, `mid`, `ig_did`, `rur`), the headers `x-csrftoken`, `x-ig-www-claim` and `x-asbd-id`, and the form fields `fb_dtsg`, `lsd` and `jazoest`. Gitignore `*.har`, and never record write flows.

### 8.6 Manual mock development (no Playwright)

- **Serve the fixture** over HTTPS on `127.0.0.1:8443`.
- **Launch CfT** through `webExt.chromiumArgs` with:
  - `--host-resolver-rules="MAP www.instagram.com 127.0.0.1:8443"`
  - `--ignore-certificate-errors-spki-list=<base64 SPKI sha256>`, which works only together with a non-default `--user-data-dir`.
- **Why:** instagram.com is **HSTS-preloaded with `include_subdomains`** and has no static pins, so certificate errors cannot be clicked through.
- **Do not:**
  - edit `/etc/hosts`;
  - install a system-wide root (mkcert);
  - use dNR redirects to localhost. A main-frame redirect changes the origin, and subresource redirects trigger Chrome 142's Local Network Access prompt.
- **Caveat:** `--host-resolver-rules` may be unreliable when another Chrome instance shares the profile or network service (unverified).

### 8.7 Safeguards: making posting impossible outside `live`

1. **Build modes:** `dev`, `mock`, `e2e` and `live`. The publish module is compiled only when `MODE==='live' && WXT_ALLOW_LIVE_POST==='1'`, so it is dead code everywhere else. A CI check greps non-live bundles to confirm the module is absent.
2. **Per-mode manifests:** different name, icon and `key` (so a separate extension ID) and per-mode host permissions.
3. **Static dNR ruleset `block_ig_writes`** in `dev` and `mock` builds (not `e2e`). Priority 100, action `block`, resource types `xmlhttprequest`, `other` and `ping`. URL filters:
   - `||instagram.com/rupload_igphoto/`
   - `||instagram.com/rupload_igvideo/`
   - `||instagram.com/api/v1/media/configure_to_story/`
   - `/api/v1/web/create/configure_to_story/`
   - `/create/configure_to_story/`
   - `/api/v1/media/configure/`
   - `configure_sidecar/`, `configure_to_clips/`, `configure_to_longform/`

   These are reverse-engineered endpoints and will change. Prove the rules match with `declarativeNetRequestFeedback` and `onRuleMatchedDebug` in a CfT spike.
4. **Profiles:** dev, mock and e2e profiles are **never logged in to Instagram**.
5. **Playwright** aborts all un-mocked Meta-domain requests.
6. **Single client:** every Instagram-touching call goes through one guarded client that throws unless `MODE==='live'`. The extension never clicks Share without an explicit confirmation in the side panel.
7. **Optional "dry-run" on a throwaway account:** block only `configure_to_story` with `urlFilter` plus `tabIds`. The UI flow and the upload are then exercised but nothing is published. Uploaded bytes still reach Instagram's servers.

### 8.8 Live-testing options (in order of preference)

1. **Fixture plus mocks:** the default for all automated tests.
2. **Graph API validate-only:** create a container and never publish. Rate-limit it, because it counts toward the 400-container cap.
3. **Secondary account created by the user** (Claude cannot create accounts):
   - For the msite route: a private personal account with no followers, used normally for a few days first.
   - For the API route: a Business account with no followers and an app role. It is public.
   - Run `live` builds in a **separate Chrome profile** logged in to that account (a gitignored persistent profile, or Load unpacked in a dedicated everyday profile).
   - Post **one manual, human-clicked** story per test and delete it afterwards: with the API on the FB Login path, otherwise manually in the app, or let it expire after 24 h.
4. **Never point Playwright or Puppeteer at real instagram.com with a real account.** Automation flags (`navigator.webdriver`, CDP) plus a spoofed UA add up to a detection risk.
5. **Close Friends is not a fallback** for the web or API routes, because neither can target an audience.

### 8.9 Smoke tests to write on day one

- Each media library (Mediabunny, the AAC encoder, pica split build, heic-to or libheif, jsquash) loads and runs inside the `chrome-extension://` editor page under the declared CSP.
- In the composer window: `JSON InstagramUserAgent.is_mobile === true`, the mobile Create item exists, the story file input's `accept` contains `image/jpeg`, and `innerHeight >= innerWidth`.
- The dNR `set` on `user-agent` and `sec-ch-ua*` is visible to a local header-echo server in the pinned CfT version.
- The block ruleset matches requests from both the page and the extension.
- The exported JPEG is 1080x1920, sRGB and 8 MB or less; the exported MP4 passes the validator in 8.4.

---

## 9. Open questions and items that need live verification

**Instagram surfaces (manual, no posting needed unless stated):**

1. Does desktop instagram.com (desktop UA, wide window) show a story creator on the owner's account via the "profile photo, top-left" path described in Instagram's 2026-07-02 blog? If it does, that is a lower-risk target than msite.
2. With a dNR header-only phone UA and a portrait popup window, does the msite composer load reliably, or does Instagram's service worker sometimes serve a cached desktop shell? (2026-10-12, partly answered: the worker has no fetch handler, so it never serves a shell, §5.4; the first live run's composer was mobile, `is_mobile: true`, but 1512 CSS px wide, where msite has no + → Story; strategy §11 AM29–AM32.) Does a `DataTransfer`-injected `File` with `isTrusted=false` events work? Test the injection in the fixture first, then on a throwaway account. (2026-10-12, second live run in Arc: the insert reaches the composer, but it bypasses the story session start, so `sessionId` stays null, §5.1; and the composer then refused to show Share on the landscape monitor, as it did for the owner's own pick, §5.2. Open: does Share work with the portrait shim of strategy §11 AM37, after + → Story by hand (live checklist L16, L17), and after an insert with no session id (L6)?)
3. Is video still unreachable in the msite story UI? (The code says yes.)
4. What canvas size does msite export: viewport x DPR, or the source size? Is a 1080x1920 input downscaled?
5. Does the server treat a desktop session that also uses the msite app ID `1217981644879628` differently, for example with login-activity entries or checkpoints? Use a throwaway account only.
6. Does the desktop Reels composer expose a music UI to users? Its code sends `music_params`.
7. MBS: does it offer music or Close Friends for Instagram stories? What are its media limits and scheduling horizon?
8. In-app story scheduling: which accounts are eligible, per the 2026 blog?
9. Does a Creator account keep the licensed music library where a Business account loses it? The Help Center does not distinguish them.
10. Has Edits desktop shipped, and do its projects sync into the story composer?
11. On iOS and Android, what do `instagram.com/linking/create-story?story_camera_mode=live` and its mode values do?
12. Does the in-app handling of videos over 60 s split them (as the Help Center says) or trim them (as some reports say)? Is the non-9:16 background a gradient sampled from the image?
13. Would Meta read UA spoofing to reach a hidden UI as circumventing a "technological measure"? There is no precedent for individual users.
14. How does INSSIST MV3 implement story music and mentions? This needs a static review of its CRX. Does the web `configure_to_story` endpoint accept interactive fields? Throwaway account only, and not recommended.

**Graph API (needs a test Business account and a Meta app):**

15. Do Creator accounts still get error #10 for stories on `graph.instagram.com`? The docs say stories are Business-only.
16. Does `user_tags` on stories work on IG Login?
17. Is `https://<ext-id>.chromiumapp.org/<path>` accepted as a Business Login redirect, and does `launchWebAuthFlow` capture the `#_`-suffixed redirect?
18. Can a Dashboard-generated 60-day token be refreshed indefinitely while the app is in Development mode?
19. What is the live `quota_total` (50 or 100)? Do stories count toward it? Does error 2207009 (aspect ratio) apply to stories?
20. Does resumable upload accept a JPEG for `STORIES`? Is the "image as a short MP4" workaround acceptable?
21. Is burned-in audio on API-published story videos muted, and does `copyright_check_status` appear on `STORIES` containers?
22. FB Login: does a non-expiring Page token work for `/media` and `media_publish`? The docs conflict.
23. Will an IG Login delete endpoint, or Audio API support for `STORIES`, appear? Watch the changelog.

**Chrome and tooling:**

24. Does the Web Share API with files reach AirDrop from macOS desktop Chrome?
25. Do heic-to and `@mediabunny/aac-encoder` work after replacing their workers with packaged files? Is WebCodecs available in a manifest sandbox page?
26. Does Playwright's bundled CfT include H.264 and AAC encoders on each CI OS? Probe at runtime.
27. Does dNR `set` on `sec-ch-ua*` work in CfT 155? It worked empirically on 154.
28. Confirm the dNR-before-Playwright-route ordering empirically.
29. Is `--host-resolver-rules` reliable in CfT 146 and later?
30. Do offscreen documents and side panels become `crossOriginIsolated` with the COEP and COOP manifest keys?
31. Is the new extensions menu, which `addHostAccessRequest` needs, the default in Chrome 155?
32. Does Chrome embed an ICC profile when exporting from a `display-p3` canvas? How does it tone-map HDR `VideoFrame`s drawn to an sRGB canvas?

---

## 10. Sources

asOf is the source's own date, or "undated (fetched 2026-10-11)". **Stale** marks sources older than 2025 that are still used for context.

### Sections 1–2: first-party surfaces

- Instagram Help: [Share a photo or video to your story, 1257341144298972](https://help.instagram.com/1257341144298972/) and its [iPhone](https://help.instagram.com/1257341144298972/?cms_platform=iphone-app) and [iPad](https://help.instagram.com/1257341144298972/?cms_platform=ipad-app) variants. Undated (fetched 2026-10-11).
- Instagram Help: [Close Friends, 2183694401643300](https://help.instagram.com/2183694401643300/); [Post a photo (computer), 442418472487929](https://help.instagram.com/442418472487929/); [Add audio to post, 570998714799168](https://help.instagram.com/570998714799168/); [Music on multi-photo post, 1223433768344104](https://help.instagram.com/1223433768344104/); desktop reels and crop pages [117838865078314](https://help.instagram.com/117838865078314/), [2720958398006062](https://help.instagram.com/2720958398006062/), [1631821640426723](https://help.instagram.com/1631821640426723/); [Tips, 314684928883274](https://help.instagram.com/314684928883274/). All undated (fetched 2026-10-11).
- Instagram Help: [Licensed music library, 402084904469945](https://help.instagram.com/402084904469945/); [Reel drafts, 639718330257952](https://help.instagram.com/639718330257952/?cms_platform=iphone-app); [View a story, 899271546851408](https://help.instagram.com/899271546851408/). Undated (fetched 2026-10-11).
- Instagram blog: [How to use Instagram Stories: complete 2026 guide](https://about.instagram.com/blog/tips-and-tricks/how-to-use-instagram-stories), 2026-07-02. Its reliability on platform details is mixed.
- Instagram blog: [Introducing Instagram for iPad](https://about.instagram.com/blog/announcements/instagram-for-ipad), 2025-09-03.
- Instagram blog: [Stories on mobile web](https://about.instagram.com/blog/announcements/instagram-stories-and-save-on-mobile-web), 2017-11-16 (**stale**).
- [Social Media Today on mobile-web stories](https://www.socialmediatoday.com/news/instagrams-giving-users-the-ability-to-upload-basic-stories-from-the-web/511139/), 2017-11-17 (**stale**).
- Meta Business Help: [Create and manage stories in MBS (desktop), 972600925713914](https://www.facebook.com/business/help/972600925713914); [MBS access, 428687951269163](https://www.facebook.com/business/help/428687951269163); [Creator Studio moved to MBS, 2160250460681592](https://www.facebook.com/business/help/2160250460681592); [Content tab, 500155770399970](https://www.facebook.com/business/help/500155770399970); [MBS mobile scheduling, 609176706604372](https://www.facebook.com/business/help/609176706604372); [Drafts, 2223502627919449](https://www.facebook.com/business/help/2223502627919449). Undated (fetched 2026-10-11).
- Third-party guides (corroboration only): [Sprout Social](https://sproutsocial.com/insights/schedule-instagram-stories/), 2026-02-02; [Agorapulse](https://www.agorapulse.com/blog/instagram-stories/publish-instagram-stories-from-the-desktop/), 2025-10-01; [PersonaXpand](https://personaxpand.com/blog/how-to-post-instagram-stories-from-a-computer), checked 2026-10-01; [Metricool](https://metricool.com/post-instagram-stories-computer/), 2026-06-26; [SocialRails](https://socialrails.com/blog/how-to-post-instagram-stories-from-pc-complete-guide), 2026-07-20; [Sked Social](https://skedsocial.com/blog/create-instagram-stories-from-laptop), 2026-10-09; [Hopper HQ](https://www.hopperhq.com/blog/how-to-post-to-instagram-from-desktop/), 2026-07 (contradicts itself); [allthings.how](https://allthings.how/how-to-upload-instagram-story-from-pc/), 2025-03-07.
- [Microsoft Store Instagram listing](https://apps.microsoft.com/detail/9nblggh5l9xt?hl=en-US&gl=US), 2026-08-12. [App Store Instagram listing](https://apps.apple.com/us/app/instagram/id389801252), fetched 2026-10-11.
- TechCrunch: [Edits desktop](https://techcrunch.com/2026/06/11/metas-edits-app-is-getting-an-ai-assistant-and-a-desktop-version/), 2026-06-11; [In-app scheduling](https://techcrunch.com/2022/11/08/instagram-scheduling-tool-all-professional-accounts), 2022-11-08 (**stale**); [Facebook creator AI app](https://techcrunch.com/2026/06/24/facebook-rolls-out-an-ai-companion-app-for-creators/), 2026-06-24.
- [Social Media Today on story drafts](https://www.socialmediatoday.com/news/instagram-stories-drafts-are-now-available-to-all-users/603498/), 2021-07-16 (**stale**).
- Instagram production web JS: static.cdninstagram.com bundles referenced by `https://www.instagram.com/accounts/login/`, served 2026-10-11. Modules include `PolarisCreationNavMenu.react`, `PolarisUA`, `PolarisHasFeedCreation`, `polarisStoryCreationReducer`, `PolarisStoryCreationActions`, `PolarisStoryCreationFileForm.react`, `PolarisAPICreationFinalizeStory` and `PolarisConfigConstants`. Also curl UA tests on the same date.
- Bundle snapshots on GitHub: [hackjobsp/Hotelzinho-da-Ana fotos/atv1_files](https://github.com/hackjobsp/Hotelzinho-da-Ana/tree/main/fotos), 2026-09-19; [aayushchouhan72/echelon-dev-society](https://github.com/aayushchouhan72/echelon-dev-society/blob/main/src/assets/hero-4_files/UBuTHq8FNoy.js.download), 2025-10-19; BautistaAlfaro/ArgentinaRadar, 2026-06-22; gustavonunes010t/hefesTT0, 2026-04-23.

### Section 3: media specs

- [IG User Media reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) and its [.md version](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md). Undated (fetched 2026-10-11).
- [Story technical specs, 292794301336717](https://www.facebook.com/business/help/292794301336717). Undated; contains pre-2025 content (**stale**).
- Ads Guide, Instagram Story: [image](https://www.facebook.com/business/ads-guide/update/image/instagram-story) and [video](https://www.facebook.com/business/ads-guide/update/video/instagram-story). Undated.
- Safe-zone heuristics: [GrowthScribe](https://growthscribe.com/instagram-story-size/), 2026-06-30; [MakeTechEasier](https://maketecheasier.com/instagram-story-reel-safe-zone), undated.
- [PetaPixel on 60 s stories](https://petapixel.com/2022/09/26/instagram-users-can-now-post-60-second-uninterrupted-stories), 2022-09-26 (**stale**). [Kapwing on background colours](https://www.kapwing.com/resources/how-to-change-instagram-story-background-colors/), 2025-05-16.
- Meta Engineering: [Instagram video processing](https://engineering.fb.com/2022/11/04/video-engineering/instagram-video-processing-encoding-reduction/), 2022-11-04 (**stale**); [AV1 for Reels](https://engineering.fb.com/2023/02/21/video-engineering/av1-codec-facebook-instagram-reels/), 2023-02-21 (**stale**).
- Chrome: [Chrome 94 colour-managed canvas](https://developer.chrome.com/blog/new-in-chrome-94/), 2021-09 (**stale**, still accurate); [MDN createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap); [pica changelog](https://github.com/nodeca/pica/blob/master/CHANGELOG.md), 10.0.0 dated 2026-05-16.

### Section 4: official API

- Content publishing: [guide](https://developers.facebook.com/docs/instagram-platform/content-publishing/), [IG Login variant](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [resumable uploads](https://developers.facebook.com/documentation/instagram-platform/content-publishing/resumable-uploads.md), [Audio API](https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api.md) (2026-06-01). Undated (fetched 2026-10-11).
- References: [IG Container](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container.md), [content_publishing_limit](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit), [media_publish](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish.md), [stories](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/stories.md), [IG Media (delete)](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media.md), [error codes](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/error-codes.md). Fetched 2026-10-11.
- Platform docs: [changelog](https://developers.facebook.com/documentation/instagram-platform/changelog.md) (latest relevant entry 2026-06-22); [overview](https://developers.facebook.com/docs/instagram-platform/overview); [FB Login overview](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login) (Stories business-only, 2026-10-11); [IG Login overview](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login.md); [App Review](https://developers.facebook.com/documentation/instagram-platform/app-review.md).
- Auth: [Business Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login), [oauth-authorize](https://developers.facebook.com/documentation/instagram-platform/reference/oauth-authorize.md), [refresh_access_token](https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token.md), [IG Login get-started](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started).
- Facebook Login: [manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow), [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business), [long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived). At v25.0.
- App setup: [test users](https://developers.facebook.com/docs/development/build-and-test/test-users), [app modes](https://developers.facebook.com/docs/development/build-and-test/app-modes), [app roles](https://developers.facebook.com/docs/development/build-and-test/app-roles). Fetched 2026-10-11.
- [Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog) and [v26.0](https://developers.facebook.com/docs/graph-api/changelog/version26.0), 2026-07-29.
- Meta developers blog: [Stories publishing launch](https://developers.facebook.com/blog/post/2023/05/16/introducing-stories-publishing-to-the-content-publishing-api-on-instagram/), 2023-05-16 (**stale**). [Community thread on error #10](https://developers.secure.facebook.com/community/threads/1226500261819047), v18-era (**stale**).
- Vendors: [Publer](https://publer.com/help/en/article/why-am-i-getting-error-from-instagram-10-the-user-is-not-an-instagram-business-ghev7b.md), about 2024 (**stale**); [Later](https://help.later.com/hc/en-us/articles/360042772514-Schedule-Publish-Instagram-Stories), via search snippet; [Buffer](https://support.buffer.com/articles/scheduling-instagram-posts-reels-stories-and-notifications-3XA98S9Q5p.md); [Storrito on MBS](https://storrito.com/resources/comparison/meta-business-suite-desktop/), 2026 footer.
- Chrome: [chrome.identity](https://developer.chrome.com/docs/extensions/reference/api/identity), 2026-09-11; [network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests); [archived instagram-auth app sample](https://github.com/GoogleChrome/chrome-extensions-samples/tree/main/_archive/apps/samples/instagram-auth) (**stale**).
- Live CORS probes of graph.instagram.com, graph.facebook.com, api.instagram.com and rupload.facebook.com, 2026-10-11.
- [Sharing to Stories](https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/). Undated; references the Jan 2023 change.

### Section 5: unofficial routes

- Library code: [instagrapi](https://github.com/subzeroid/instagrapi) and [PyPI](https://pypi.org/project/instagrapi/), 3.0.21, 2026-10-09; [instagrapi story guide](https://subzeroid.github.io/instagrapi/latest/usage-guide/story/); [best practices](https://github.com/subzeroid/instagrapi/blob/master/docs/usage-guide/best-practices.md), 2026-09-19; [dilame configure-story types](https://github.com/dilame/instagram-private-api/blob/master/src/types/media.configure-story.options.ts), 2024-03 (**stale**); [jlobos/instagram-web-api](https://github.com/jlobos/instagram-web-api/blob/master/lib/index.js), 2024-07 (**stale**); [Gimenz/insta-fetcher](https://github.com/Gimenz/insta-fetcher/blob/master/src/index.ts), 2026-03.
- OpenCLI: [private-publish.js](https://github.com/jackwener/OpenCLI/blob/main/clis/instagram/_shared/private-publish.js), [story.js](https://github.com/jackwener/OpenCLI/blob/main/clis/instagram/story.js), [runtime-info.js](https://github.com/jackwener/OpenCLI/blob/main/clis/instagram/_shared/runtime-info.js). 2026-08/10.
- INSSIST: [code copy v23.2.1](https://github.com/skillslasher/INSSIST/blob/main/background.f193d192.js) and [ig-injection](https://github.com/skillslasher/INSSIST/blob/main/ig-injection/index.js), 2022 (**stale**); [inssist.com](https://inssist.com); [music guide](https://inssist.com/feature-guides/how-to-add-music-to-instagram-stories-on-pc), 2026-04-12; [ExtScope](https://extscope.org/extension/bcocdbombenodlegijagbhdjbifpiijp); [Trustpilot](https://www.trustpilot.com/review/inssist.com).
- Chrome Web Store listings and Chrome update-service checks: [INSSIST](https://chromewebstore.google.com/detail/inssist-post-stories-dm-w/bcocdbombenodlegijagbhdjbifpiijp), [InLoad](https://chromewebstore.google.com/detail/ikcgnmhndofpnljaijlpjjbbpiamehan), [IG Story Desktop](https://chromewebstore.google.com/detail/ig-story-desktop/kkbfdganebpdpboknjfkiokbejiaojdl), [StoryFlow](https://chromewebstore.google.com/detail/fenofcbigfihegijdcpoiabnjindlble), [EasyLoad](https://chromewebstore.google.com/detail/elnnmjddaleoeklbolbfhagpikikkkin). Checked 2026-10-11.
- Breakage reports: instagrapi issues [#2369](https://github.com/subzeroid/instagrapi/issues/2369), [#2773](https://github.com/subzeroid/instagrapi/issues/2773), [#2865](https://github.com/subzeroid/instagrapi/issues/2865), [#2136](https://github.com/subzeroid/instagrapi/issues/2136); OpenCLI issues [#2247](https://github.com/jackwener/OpenCLI/issues/2247), [#2553](https://github.com/jackwener/OpenCLI/issues/2553). 2025-02 to 2026-10.
- Terms and enforcement: [Instagram Terms of Use (Open Terms Archive)](https://github.com/OpenTermsArchive/pga-versions/blob/main/Instagram/Terms%20of%20Service.md), effective 2025-01-01, last change 2026-08-29; [help 581066165581870](https://help.instagram.com/581066165581870); [Meta Platform Terms](https://developers.facebook.com/terms/), 2026-02-03; [Meta automation lawsuits](https://about.fb.com/news/2020/06/automation-software-lawsuits/), 2020-06 (**stale**); [TechCrunch on mass bans](https://techcrunch.com/?p=3019034), 2025-06-16; [Storrito on suspicious activity](https://storrito.com/help-center/troubleshooting-instagram-s-suspicious-activity-detected-notifications/), 2026; [CWS program policies](https://developer.chrome.com/docs/webstore/program-policies/policies), 2025-05-22.
- Chrome APIs: [declarativeNetRequest](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest), 2026-09-11; [debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger), 2026-10-05; [sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel), 2026-09-11; [UA client hints](https://developer.chrome.com/docs/privacy-security/user-agent-client-hints); [Emulation.pdl](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Emulation.pdl); [debugger_api.cc](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/debugger/debugger_api.cc); [UserAgent-Switcher MV3](https://github.com/ray-lothian/UserAgent-Switcher/blob/master/v3/network.js), 2026-10-03.

### Section 6: text and music

- [Kapwing on Instagram fonts](https://www.kapwing.com/resources/about-the-new-instagram-fonts), 2025-12-30.
- [Chrome COLRv1 fonts](https://developer.chrome.com/blog/colrv1-fonts), 2022-02 (**stale**, still accurate). [@twemoji/api](https://registry.npmjs.org/@twemoji/api), 2026-06-01.
- [Instagram music guidelines](https://about.instagram.com/blog/announcements/updates-and-guidelines-for-including-music-in-video), 2020-05-20 (**stale**; no newer version found). [Rights Manager](https://www.rightsmanager.fb.com), undated.
- instagrapi [video.py](https://github.com/subzeroid/instagrapi/blob/master/instagrapi/mixins/video.py) and [track.py](https://github.com/subzeroid/instagrapi/blob/master/instagrapi/mixins/track.py), 2026-10-09.
- [MDN navigator.share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share), 2026-07-16.

### Section 7: browser editing tech

- [WebCodecs Editor's Draft](https://w3c.github.io/webcodecs/), 2026-10-07. [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen), 2026-09-21.
- Chromium source (main, fetched 2026-10-11): [media_switches.cc](https://chromium.googlesource.com/chromium/src/+/main/media/base/media_switches.cc), [audio_encoder.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webcodecs/audio_encoder.cc), [video_encoder.cc](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webcodecs/video_encoder.cc), [media_options.gni](https://chromium.googlesource.com/chromium/src/+/main/media/media_options.gni), [csp_info.cc](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/manifest_handlers/csp_info.cc), [csp_validator.cc](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/csp_validator.cc), [csp_source.cc](https://chromium.googlesource.com/chromium/src/+/main/services/network/public/cpp/content_security_policy/csp_source.cc).
- Mediabunny: [releases](https://github.com/Vanilagy/mediabunny/releases), [converting](https://mediabunny.dev/guide/converting-media-files), [output formats](https://mediabunny.dev/guide/output-formats), [AAC encoder](https://mediabunny.dev/guide/extensions/aac-encoder). 1.61.3, 2026-10-05.
- Superseded or fallback tools: [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (deprecated, 2025-07-02); [Remotion WebCodecs](https://www.remotion.dev/docs/webcodecs/); [ffmpeg.wasm releases](https://github.com/ffmpegwasm/ffmpeg.wasm/releases), 2025-01-07; [ffmpeg.wasm issue #617](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/617).
- Chrome manifest docs: [MV3 CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy), 2024-02-13, confirmed by source; [cross_origin_embedder_policy](https://developer.chrome.com/docs/extensions/reference/manifest/cross-origin-embedder-policy), 2021 (**stale**).
- npm registry, 2026-10-11: [pica](https://registry.npmjs.org/pica), [heic-to](https://registry.npmjs.org/heic-to), [libheif-js](https://registry.npmjs.org/libheif-js), [heic2any](https://registry.npmjs.org/heic2any), [@jsquash/jpeg](https://registry.npmjs.org/@jsquash/jpeg), [wasm-vips](https://registry.npmjs.org/wasm-vips), [@ffmpeg/ffmpeg](https://registry.npmjs.org/@ffmpeg/ffmpeg). Repos: [heic-to](https://github.com/hoppergee/heic-to), [pica](https://github.com/nodeca/pica).
- [StaZhu HEVC matrix](https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding), 2025-05-20.

### Section 8: extension engineering and dev/test

- WXT: [releases 0.21.4](https://github.com/wxt-dev/wxt/releases/tag/wxt-v0.21.4), 2026-08-11; [npm](https://registry.npmjs.org/wxt); docs on [compare](https://wxt.dev/guide/resources/compare), [browser startup](https://wxt.dev/guide/essentials/config/browser-startup), [content scripts](https://github.com/wxt-dev/wxt/blob/main/docs/guide/essentials/content-scripts.md), [unit testing](https://github.com/wxt-dev/wxt/blob/main/docs/guide/essentials/unit-testing.md), [E2E testing](https://wxt.dev/guide/essentials/e2e-testing); source [web-ext runner](https://github.com/wxt-dev/wxt/blob/main/packages/wxt/src/internal/runners/web-ext.ts) and [manifest.ts](https://github.com/wxt-dev/wxt/blob/main/packages/wxt/src/internal/manifest.ts).
- Other frameworks: [CRXJS changelog](https://raw.githubusercontent.com/crxjs/chrome-extension-tools/main/packages/vite-plugin/CHANGELOG.md), 3.0.0, 2026-09-24; [Plasmo releases](https://github.com/PlasmoHQ/plasmo/releases), 2025-05-17.
- Chrome changes: PSAs on [--load-extension](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ) (2025-04-04) and [M139 flags](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/FxMU1TvxWWg/m/daZVTYNlBQAJ) (2025-06-12); [remote debugging changes](https://developer.chrome.com/blog/remote-debugging-port), 2025-03-17; [CfT versions](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json), 2026-10-11; [extension_service.cc](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/extension_service.cc).
- Extension loaders: [web-ext 8.8.0](https://github.com/mozilla/web-ext/releases/tag/8.8.0), 2025-06-19; [web-ext chromium runner](https://github.com/mozilla/web-ext/blob/master/src/extension-runners/chromium.js); [Extensions.pdl](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Extensions.pdl); [Puppeteer extensions guide](https://pptr.dev/guides/chrome-extensions).
- Playwright: [chrome-extensions](https://playwright.dev/docs/chrome-extensions); [v1.57.0](https://github.com/microsoft/playwright/releases/tag/v1.57.0), 2025-11-25; [v1.63.0](https://github.com/microsoft/playwright/releases/tag/v1.63.0), 2026-09-04; issues [#26693](https://github.com/microsoft/playwright/issues/26693) and [#41935](https://github.com/microsoft/playwright/issues/41935); [mock](https://playwright.dev/docs/mock); [crServiceWorker.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/crServiceWorker.ts).
- Test tooling: [fake-browser APIs](https://github.com/aklinker1/webext-core/tree/main/packages/fake-browser/src/apis); [msw](https://registry.npmjs.org/msw), 3.0.3, 2026-10-10; [msw#2667](https://github.com/mswjs/msw/issues/2667), 2026-03-15.
- Network and dNR internals: [HSTS preload json](https://chromium.googlesource.com/chromium/src/+/main/net/http/transport_security_state_static.json); [network_switches.cc](https://chromium.googlesource.com/chromium/src/+/main/services/network/public/cpp/network_switches.cc); [Local Network Access](https://developer.chrome.com/blog/local-network-access), 2025-09-29; [ruleset_manager.cc](https://chromium.googlesource.com/chromium/src/+/main/extensions/browser/api/declarative_net_request/ruleset_manager.cc); [url_loader_factory_utils.cc](https://chromium.googlesource.com/chromium/src/+/main/content/browser/loader/url_loader_factory_utils.cc).
- Extension platform: [structured-clone messaging](https://developer.chrome.com/blog/structured-clone-messaging), 2026-04-22; [What's new in extensions](https://developer.chrome.com/docs/extensions/whats-new); [permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions), 2026-09-11; [new extensions menu](https://developer.chrome.com/blog/new-extensions-menu-testing), 2024-11-19 (**stale** for default status).
