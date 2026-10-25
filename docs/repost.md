# instapost: repost to story (spec, 0.2.0)

- **Status:** prototype built on `spike/repost` (2026-10-25, §15), tested live by the owner, ported to `feat/repost` for 0.2.0 (§16). OD20 approved in use. Ids follow strategy AM61: RP-n stay this spec's; AM54–AM59 (strategy amendments; AM60 App-style repost, not adopted; AM61 the ids), OD20 and OD21 (owner decisions), R31–R41 (risks), U40–U51 / B21–B28 (unit / browser tests), L37–L51 (the owner's live checks).
- **Owner decision after the live test (2026-10-25, OD21, strategy AM60):** "Tested the repost. Looks good, but it’s not an actual repost, i.e. the users doesn’t [get] the mention. We need to make this an actual repost." Offered the risk (README hard rule 6 broken; research.md §5.9 tier 3; a higher chance that Instagram flags the account; the web endpoint's acceptance unproven), the owner chose the **full reshare**: a post sticker linking to the original and an @mention that notifies the author, behind Settings → **App-style repost**, secondary account only until proven, with the pixel repost below kept as the fallback. **Declined in the build, not implemented** (README hard rule 8): it needs a script in Instagram's own page (MAIN world) that hooks its XHR/fetch, and adds the app-only fields to Instagram's publish request. The owner later dropped the requirement that the script hide itself (no stealth); the build declined it again on 2026-10-25, so the decision is back with the owner. This spec is the pixel repost, and only that. For the sticker and the mention the owner reposts from the Instagram app (Share → Add to story), or uses Send to phone… and adds a mention there (RP-29).
- **Owner request (2026-10-25, verbatim):** "I need you to build a repost feature. You need to be able to select a post and repost it to a story, or allow reposting stories that mention you, as the app does. Try a way to integrate it into the UI seamlessly and just build it."
- **Inputs:** `docs/inpage.md` (§7, P8, §14), strategy §11 (AM39–AM53), README hard rules, research.md §1 items 23–29, §5.6–5.9, §6.3. Research A (desktop DOM, CDN, flags) and Research B (how the app looks and behaves, code fit) are summarised in RP-1 and cited where used. (unverified) marks claims not yet seen on real Instagram. Each one has an L check (L37–L51).
- **Scope:** photos only: a photo post, the visible photo slide of a carousel, and a photo story that mentions the owner. Videos and reels show the entry disabled with a hint (RP-11). Instagram may be in English or Spanish, and instapost's own UI in en or es.

---

## 1. What a repost is

- **RP-1. Only pixels.**
  - The desktop web client has no story-reshare path. The fields `reshared_media_id`, `attached_media` and `story_sticker_ids` do not appear in any desktop or msite module (Research A §0, B §1).
  - Injecting them is Tier 3 (research.md §5.9). So it is banned. (OD21 chose it as App-style repost, strategy AM60; the build declined it: not implemented.)
  - A repost is therefore an ordinary 1080×1920 photo story. instapost renders it locally: the post's picture as a card over a generated background, with the author's credit drawn into the image.
  - It is posted through the existing in-page lane, unchanged.
  - The story is **not tappable**, the author is **not notified**, and there is no mention sticker. The composer says so, and how to notify them: Send to phone…, then a mention in the Instagram app (RP-29).
- **RP-2. The look follows the app.**
  - The post appears as a rounded card with a shadow, over a two-colour gradient taken from the photo.
  - Clicking the card cycles its style.
  - A mention repost shows the original 9:16 story as a rounded card at about 0.8 scale, with "@author" on it.
  - Interactive stickers are never imitated: no "View post", no link glyph, no tap affordance (research.md §6.3).
- **RP-3. No new Instagram traffic.**
  - Instagram's page and its msite engine frame make every request to instagram.com, as today.
  - The only new contact is with Instagram's **image CDN**: one GET per image that the owner's page is already showing, made by the composer after the owner's click (AM55).

## 2. Entry points

### 2.1 Posts: Share → Add to story (the app's path)

- **RP-4. Where.**
  - Any photo post: the feed, the post modal (opened from the feed, Explore or a profile grid, including the owner's own grid), and a hard-loaded permalink `/p/<code>/` or `/<user>/p/<code>/`.
  - The owner clicks Instagram's own **Share** (paper plane). Instagram opens its Share dialog.
  - instapost shows an **"Add to story"** strip docked to that dialog, for the post whose Share was clicked.
  - Nothing is added on posts until Share is clicked: no persistent clutter in the feed.
- **RP-5. Recognising the click and the dialog.** This works in any locale, by structure first.
  1. **Listener.** One passive, capture-phase `click` listener on `window`. The content script already has a capture `pointerup` listener. The listener only reads `e.composedPath()`; it never prevents or dispatches anything.
  2. **Share control.** Take the first `button` or `[role=button]` in the path that contains the **Share glyph**: an svg `path[d^="M13.973 20.046"]`.
     - Fallback: an `svg[aria-label]` in `SHARE_LABELS`, which holds `Share Post`, `Share`, `Compartir publicación` and `Compartir` (Research A §1.2, §6).
  3. **Action bar.** Walk up from the control, at most 6 ancestors, to the first one that holds exactly one rendered Like glyph (`path[d^="M16.792 3.904"]` or `path[d^="M34.6 3.1"]`) **and** a Comment (`path[d^="M20.656 17.008"]`) or Repost (`path[d^="M19.998 9.497"]`) glyph.
     - This rejects the sidebar's Messages and Notifications, which reuse the Share and Like glyphs.
     - No action bar found: ignore the click.
  4. **Post root.** From the action bar, take `closest('article')`. Failing that, the `[role=dialog]` that contains it. Failing that, `main`.
     - The root must contain a permalink: an `a[href]` holding `time[datetime]`, whose path matches `^/(?:[^/]+/)?(p|reel|tv)/([\w-]{5,64})/`.
     - The metadata (RP-13) is read **now**, at click time.
  5. **The dialog.** Instagram's Share dialog is the first `[role=dialog]` that appears within **1500 ms**, using the body `MutationObserver` the content script already has. It must:
     - not have been present at click time;
     - not contain the post root;
     - contain an `input` (the contact search);
     - be visible and at least 280×300 px.
   - The **panel** is the topmost ancestor of that input that is still at most 0.9 × the viewport width and 0.95 × its height.
   - No dialog in time: use the fallback (RP-7).
- **RP-6. The strip.**
  - **Host:** instapost's closed shadow root. Instagram's DOM is never edited (P8).
  - **Size:** the panel's width (clamped to 280–560 px, centred on the panel), 56 px tall, 8 px **below** the panel. If there is no room (less than 64 px below), it goes 8 px **above**; if there is no room either side, the fallback (RP-7) is used.
  - **Style:** the page palette (`--ig-elev` background, 12 px radius, `--pop-shadow`, `--pop-border` in dark mode).
  - **Contents:**
    - a 40 px round mark: instapost's dot in a story ring with a "+";
    - the label **Add to story** (14/18, 600);
    - a second line **with instapost** (12 px, `--ig-text-2`);
    - a chevron.
  - **Behaviour:**
    - Hover uses `--ig-hover`. Hovering preloads the composer, like the entry does.
    - The strip is a `button` whose accessible name comes from `page.repost.addName`.
    - It stays while the dialog is connected and visible, re-placed on resize and scroll per animation frame (the same coalescing as FE7), and is removed when the dialog goes.
  - **On click:** send `inpage/repost` (RP-18), then `open()` the composer. Instagram's Share dialog stays open under instapost's scrim: instapost never clicks Instagram's controls. The owner closes it afterwards (R36).
  - **Keyboard:** Instagram's dialog traps focus, so the strip is mouse-only in the prototype.
- **RP-7. The fallback popover.**
  - **When:** the action bar and post were recognised (RP-5 steps 1–4) but no dialog was recognised within 1500 ms, or the strip had no room.
  - **What:** a 36 px "Add to story" pill in the host, 8 px right of the Share control and centred on it vertically. If it would overflow, it goes above the control, centred.
  - **Lifetime:** 8 s, or until a scroll of more than 40 px, a route change, Esc, or a pointerdown elsewhere.
  - It uses the same metadata and the same click handling as the strip.
- **RP-8. Entry states** (strip, popover and pills alike):

| State | When | Shows |
|---|---|---|
| ready | photo, consent not `blocked`, no run in progress | enabled |
| video | the chosen media is a `video`, or the permalink is a reel (RP-11) | disabled, "Videos come later" |
| blocked | AM56 known-disabled signal (RP-16) | disabled, "@{handle} doesn't allow sharing this post" |
| busy | `PageState.run.phase === 'running'` in any tab | disabled, "Wait until the current post finishes" |
| off | Settings → On Instagram → "Show Add to story" off (new pref `repost`, default on) | nothing |
| unreadable | no author, no permalink, or no valid CDN candidate | nothing (fail closed) |

### 2.2 Stories that mention the owner

- **RP-9. In the DM thread, which is where the app puts it.**
  - **Where:** on `/direct/t/<id>/`, each incoming **story-mention** message gets an **"Add to your story"** pill, overlaid inside the bottom edge of the story preview.
    - If the preview is at least 132 px wide: centred, `min(w − 16, 200)` × 32 px, 8 px from the bottom.
    - Narrower: a 32 px round "+" button, 6 px inside the bottom-right corner.
    - It never covers the row's hover controls, which sit beside the bubble.
  - **Recognition:**
    1. Look for `a[href^="/stories/"]` that wraps an `img`, inside `main`. The href must parse as `/stories/<user>/<pk>/` with a valid handle and a numeric pk. The scan is throttled to 500 ms on mutations.
    2. **Confirm it is a mention.** Walk up at most 8 ancestors, stopping at one that holds a second story link. The first ancestor whose `textContent` (≤ 400 chars) matches `MENTION_PHRASES` confirms it.
       - English: "mentioned you in their story", "Mentioned you in their story".
       - Spanish: "te ha mencionado en su historia", "te mencionó en su historia" (es-LA, unverified).
       - `MENTION_PHRASES` is the one text table this feature reads (AM57).
       - Story replies and shared stories render the same link but not this phrase, so they get no pill.
    3. **Exclusions:**
       - `<user>` is the owner (`me`, RP-15);
       - the anchor contains a `video` (the pill is disabled, RP-11);
       - a `time[datetime]` in the row is more than 24 h old (disabled, "This story has expired").
       - Expired stories render Instagram's "Story unavailable" placeholder, which has no link, so they get no pill.
  - **Media:** the preview `img`'s widest `srcset` candidate, else its `currentSrc`, CDN-validated. It may be low-resolution (Research A §3: a preview thumbnail; R38).
  - **Memory:** every confirmed `<user>/<pk>` is added to the content script's in-memory `mentionsSeen` set, which lasts for the page's lifetime. Nothing is stored.
- **RP-10. In the story viewer: the sharper copy.**
  - **When:** on `/stories/<user>/<pk>/`, when `<user>/<pk>` is in `mentionsSeen`. That is, the owner opened the mention from the DM, as the app's flow does.
  - **What:** the same pill beside the story card.
  - **Media:** the largest visible `section img` (at least 200 px wide). A `section video` disables the pill.
  - **Age:** from `section time[datetime]`; no pill at 24 h or older.
  - **Place:** 12 px right of the media's right edge, bottom-aligned. If that is occluded or there is no room, 12 px left of its left edge. Otherwise hidden. Occlusion means `elementsFromPoint` at the centre hits an Instagram control (`isControl`).
  - **On click:** re-read the URL's pk and the current image. If the pk changed (auto-advance), hide the pill and send nothing.
  - The DM pill stays the primary entry. When the composer decodes a mention under 720 px wide, it says "For a sharper copy, open the story: Add to your story is there too" (RP-23).
- **RP-11. Videos come later.** Video entries are disabled, never hidden, with the hint "Videos come later" (tooltip and second line), so the owner knows why. This covers:
  - posts whose chosen slide is a `video`;
  - reels (`/reel/`);
  - DM previews holding a `video`;
  - viewer stories that are a `video`.

### 2.3 Copy (EN / ES)

- **RP-12.** The `page.*` keys go in `catalog.page.{en,es}.ts` and the `inpage.*` keys in `catalog.{en,es}.ts`, mapped in `strings.ts`. The Spanish is neutral, using tú.

| Key | en | es |
|---|---|---|
| page.repost.add | Add to story | Añadir a tu historia |
| page.repost.addName | instapost: add this post to your story | instapost: añadir esta publicación a tu historia |
| page.repost.with | with instapost | con instapost |
| page.repost.mention | Add to your story | Añadir a tu historia |
| page.repost.mentionName | instapost: add @{handle}'s story to yours | instapost: añadir la historia de @{handle} a la tuya |
| page.repost.video | Videos come later | Los vídeos llegarán más adelante |
| page.repost.blocked | @{handle} doesn't allow sharing this post | @{handle} no permite compartir esta publicación |
| page.repost.busy | Wait until the current post finishes | Espera a que termine la publicación en curso |
| page.repost.expired | This story has expired | Esta historia ha caducado |
| inpage.repost.loadingPost | Loading @{handle}'s post… | Cargando la publicación de @{handle}… |
| inpage.repost.loadingStory | Loading @{handle}'s story… | Cargando la historia de @{handle}… |
| inpage.repost.permTitle | Load photos from Instagram | Cargar fotos de Instagram |
| inpage.repost.permBody | To repost, instapost loads the photo you're already seeing from Instagram's image server. Your browser asks once. | Para compartir, instapost carga desde el servidor de imágenes de Instagram la foto que ya estás viendo. El navegador lo pregunta una vez. |
| inpage.repost.permAllow | Allow | Permitir |
| inpage.repost.permSettings | Allow in instapost's settings | Permitir en los ajustes de instapost |
| inpage.repost.permDenied | Without this permission instapost can't load the photo. You can still choose one. | Sin este permiso instapost no puede cargar la foto. Aún puedes elegir una. |
| inpage.repost.expiredLink | The photo's link expired. Reload Instagram's page and try again. | El enlace de la foto caducó. Recarga la página de Instagram e inténtalo de nuevo. |
| inpage.repost.failed | Couldn't load the photo from Instagram. | No se pudo cargar la foto de Instagram. |
| inpage.repost.tryAgain | Try again | Reintentar |
| inpage.repost.tabPost / tabStory | Post / Story | Publicación / Historia |
| inpage.repost.look | Look: Card · Photo · Dark | Aspecto: Tarjeta · Foto · Oscura |
| inpage.repost.bg | Background: Colours · Blur · Black | Fondo: Colores · Desenfoque · Negro |
| inpage.repost.size | Size | Tamaño |
| inpage.repost.credit | Show @{handle} | Mostrar @{handle} |
| inpage.repost.hint | Click the post to change its look | Haz clic en la publicación para cambiar su aspecto |
| inpage.repost.notePost | Posted as a photo: people can't tap through to the post. | Se publica como foto: no se puede tocar para ir a la publicación. |
| inpage.repost.noteStory | Posted as a photo: people can't tap through to the story. | Se publica como foto: no se puede tocar para ir a la historia. |
| inpage.repost.noMention | @{handle} isn't notified. To notify them, use Send to phone… and add a mention in the Instagram app. | @{handle} no recibe aviso. Para avisarle, usa Enviar al teléfono… y añade una mención en la app de Instagram. |
| inpage.repost.consent | Instagram's own repost respects @{handle}'s sharing settings. instapost can't always see them, so only repost what you're allowed to share. | La función de Instagram respeta los ajustes de @{handle}. instapost no siempre puede verlos, así que comparte solo lo que tengas permiso para compartir. |
| inpage.repost.consentOk | Got it | Entendido |
| inpage.repost.lowRes | For a sharper copy, open the story: Add to your story is there too. | Para una copia más nítida, abre la historia: ahí también está Añadir a tu historia. |
| inpage.repost.keptDraft | Your story is kept: Continue draft brings it back. | Tu historia se guardó: Continuar borrador la recupera. |
| inpage.settings.repost | Show Add to story on Instagram | Mostrar Añadir a tu historia en Instagram |

## 3. Page-side reads (content script, isolated world, metadata only)

- **RP-13. Post metadata**, read at click time from the post root (RP-5):
  - **Code:** from the permalink regex.
  - **Author:**
    - The first `header a[href]` whose path is `/<handle>/` with `isValidHandle`.
    - On collab posts, that first link is the owner.
    - No author means `unreadable`.
  - **Avatar:** the `header img` no larger than 64 px, CDN-validated; null if none.
  - **Visible media:**
    - **Carousel** (a clip `div[role=presentation] > div > ul > li`): the `li` whose rect centre lies inside the clip's rect at click time. Its `img` or `video` is the media.
      - `?img_index=N` is recorded as `slide`, for diagnostics only, since the carousel is virtualised.
    - **Otherwise:** the largest visible `img` or `video` in the root, outside `header`, at least 200 px wide.
    - A `video` or a `/reel/` path is a video (RP-11).
  - **Candidates:**
    - Parse `img.srcset` into `{url, w}` and add `currentSrc` (with `w = naturalWidth`).
    - Dedupe, drop non-CDN URLs, sort widest first, keep 3.
    - Web tops out at 1080w (Research A §1.4).
  - **Aspect:** `naturalWidth / naturalHeight` when complete, else the rect's ratio, clamped to 0.3–2.5.
- **RP-14. Mention metadata:** `author = <user>`, `storyPk = <pk>`, media candidates as in RP-13 from the preview or viewer `img`, `aspect`, `avatar: null`.
- **RP-15. `me` and `isOwn`.**
  - `me` = `profileHandle(findProfile(navItems(column)))`. This is the existing account detection, structural, and the same value `inpage/page` already reports.
  - `isOwn = me !== null && author.toLowerCase() === me.toLowerCase()`.
  - The composer re-checks it (RP-25). If either side is unknown, the post counts as **not own**.
- **RP-16. Known-disabled signals (AM56).** Read in this order; the first match wins:
  1. **No Share control:** Instagram hides Share when `ig_media_sharing_disabled` is set, so there is no click and no entry. Blocked by construction.
  2. **SSR flags:** on hard-loaded pages only.
     - Read at most 8 `script[type="application/json"][data-sjs]` elements, at most 4 MB in total, whose `textContent` includes `"code":"<code>"`.
     - `JSON.parse` each one and take the first object with `code === <code>`.
     - **blocked** if any of these holds (and the post is not own):
       - `ig_media_sharing_disabled === true`;
       - `can_viewer_reshare === false && can_reshare !== true`;
       - owner `is_private === true`.
     - **allowed** if the object is found otherwise.
     - **unknown** if it is not found. This is the usual case for posts opened as SPA modals.
  3. **Own posts** are always `allowed`.
  4. **Mentions:** `allowed` once confirmed by RP-9 and less than 24 h old.
  - The share dialog's external share bar (Research A §2) is recorded as `bar: seen | absent | unknown` in diagnostics only. It becomes a gate only after L42 shows that it is absent for private and no-reshare posts.
- **RP-17. Reads never become writes.**
  - No click, focus, dispatch, storage, network or navigation.
  - The content script's T3 bans are unchanged.
  - URL checks use host **suffix strings** (`.cdninstagram.com`), never literal Meta URLs, so `contentScriptMetaUrls` stays clean.
- **RP-18. The message.** `{v:1, type:'inpage/repost', src: RepostSource}`, pure type and guard in `src/core/repost/source.ts`:

```ts
interface RepostSource {
  kind: 'post' | 'mention';
  author: string;                 // isValidHandle
  code: string | null;            // post shortcode, [\w-]{5,64}; null for mentions
  storyPk: string | null;         // mentions, /^\d{5,25}$/
  media: { url: string; w: number }[]; // 1–3, isCdnImageUrl, widest first
  aspect: number;                 // 0.3–2.5
  avatar: string | null;          // isCdnImageUrl
  slide: number | null;           // 1..20, diagnostics
  isOwn: boolean;
  consent: 'allowed' | 'unknown'; // 'blocked' and videos are never sent
  via: 'dialog' | 'popover' | 'dm' | 'viewer';
}
```

  - It carries no caption, no other text, no bytes and no cookies.
  - **`isCdnImageUrl`** (`src/core/repost/cdn-url.ts`) accepts only:
    - `https:`;
    - no userinfo and no port;
    - a host ending in `.cdninstagram.com` or `.fna.fbcdn.net`, never `instagram.com` or any other host;
    - a non-empty path;
    - at most 2048 characters.

## 4. Background

- **RP-19. Accept, hold and relay.**
  - **Accept:** `inpage/repost` is accepted through `acceptPageUiMessage` (frame 0, www) plus `isRepostSource`, and refused during a run in that tab.
  - **Hold:** kept in memory as `pendingRepost: Map<tabId, {src, at}>`, one per tab, the newest wins, dropped after 60 s. Never written to storage.
  - **Relay:** sent as `{v:1, type:'ui/repost', src}` to that tab's composer port. If the port is not up yet, it is replayed once on connect, before `ui/page` and `ui/mode`. Either way it is consumed once.
  - The content script sends `inpage/repost` before its `inpage/composer` open, so the composer receives the repost before it shows (no flash of the import view).

## 5. Composer: getting the bytes (AM55, OD20)

- **RP-20. Permission.**
  - **Manifest:** `optional_host_permissions: ["https://*.cdninstagram.com/*", "https://*.fna.fbcdn.net/*"]` in every mode. `host_permissions` is unchanged.
  - **On `ui/repost`:** the composer runs `permissions.contains({origins: CDN_ORIGINS})`.
  - **Not granted:** the stage shows the permission card, with **Allow** (primary), **Choose photo…** and ✕. Allow calls `permissions.request` inside that click's user activation.
  - **If `request` throws** (no gesture in a framed page, or Arc refuses, unverified): show **Allow in instapost's settings**. It sends `ui/open-settings`; the background opens `editor.html#settings`, where the Settings row "Photos from Instagram's image server: Allow" requests the permission.
  - **Resume:** the composer listens to `permissions.onAdded` and resumes the intake by itself.
  - **Denied:** `permDenied`, then Choose photo….
- **RP-21. The audited fetch.** `src/ui/repost/cdn-fetch.ts`, the one network call outside the HEIC worker's wasm. It is composer-only. Per URL:

```ts
fetch(url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
             mode: 'cors', cache: 'default', signal: AbortSignal.timeout(15_000) })
// returns { ok, via: 'instapost:cdn-fetch', blob } — the marker check-bundle pins
```

  - `isCdnImageUrl` is checked again before the call.
  - The response must be 2xx and `image/*` (or sniff as JPEG, PNG, WebP or AVIF), at most 20 MB for media and 2 MB for the avatar.
  - **At most 3 GETs per repost:** the widest media candidate, then the next candidate once only after a 403/404/410, plus the avatar once (posts only, in parallel; a failure there is silent).
  - Nothing is retried automatically. **Try again** is the owner's click and re-runs the same plan once.
  - URLs live only in memory (`repostIntake` signal). They are never stored or logged, and are not in History or Diagnostics.
- **RP-22. Intake states** (shown in the stage area, like the import view):

| State | Shows | Actions |
|---|---|---|
| loading | the author's handle, a spinner, `loadingPost` / `loadingStory` | ✕ |
| permission | RP-20 card | Allow · Choose photo… · ✕ |
| expired (every media GET 403/404/410) | `expiredLink` | Choose photo… · ✕ |
| failed (network, timeout, not an image, too large, decode failed) | `failed` | Try again · Choose photo… |
| ready | the repost layout (§6) | — |

- **RP-23. Quality.** A decoded media width below 640 (posts) or 720 (mentions) shows an info notice. For mentions it is `lowRes`; for posts no extra copy, since the post can only be reloaded. A width below 320 is a failure (`failed`).

## 6. Composer: the repost layout

- **RP-24. Representation: no schema change.**
  - The card is painted into a bitmap asset: pure layout in `src/core/repost/card-layout.ts`, a Canvas 2D painter in `src/raster/card.ts`.
  - It is placed as the frame's `ImageLayer` with `fit: 'free'`, so `compose()`, `rasterize()` and `StoryDoc` schema 1 are unchanged.
  - The source photo is a second in-memory asset (`backdrop` in `editor-state.ts`) for the Blur background. `assetSize()` and the export's `RasterSources.image()` resolve both.
  - Restyling repaints the card (about 50 ms) and swaps the layer's `assetId`, keeping `xf`.
  - The card is painted at k = 1.3 (the maximum scale), so it stays sharp. The bitmap has a transparent margin of 64·k on each side for the shadow. The card text uses the bundled Instrument Sans 600, so no new font is needed.
- **RP-25. Repost state:** `src/ui/repost-state.ts`, in-memory signal `repost: { src, style, bg, credit, userScale, palette, cardAssetId, backdropAssetId } | null`.
  - **`isOwn` (composer):** `src.isOwn && author` equals the account the composer knows (`settings` account ?? `pageHandle`). Otherwise the post is not own.
  - **Credit:** `credit` is locked `true` unless the post is own (AM56).
  - **Leaving repost mode:** dropping, pasting or choosing a photo, Recent photos, or Continue draft clear `repost` and return to normal photo mode.
- **RP-26. Styles and geometry.** The numbers are story px at user scale 1, and tunable after L38.

| Style | Card |
|---|---|
| `card` (default, posts) | white `#ffffff`, radius 28, width 800. Header 104: avatar 56 circle at x 24, then 16 gap, then the handle `{author}` (no @, as in the app) 34 px `#000`. Photo full width below, aspect clamped to 3:4…1.91:1 (centre-cropped outside that), bottom corners clipped to the card. Shadow 0 12 40 `rgba(0,0,0,.35)` |
| `photo` | photo only, width 800, radius 28, same shadow. "@{author}" 34 px white with a 0 2 8 `rgba(0,0,0,.5)` shadow, 20 below the photo, left-aligned |
| `dark` | as `card` on `#121212`, handle `#f5f5f5` |
| `story` (mentions, only style) | the story at 864 wide, aspect 9:16 (centre-cropped otherwise), radius 32, same shadow. Credit pill inside the bottom-left (inset 24): height 52, padding 0 20, radius 26, `rgba(0,0,0,.45)`, "@{author}" 30 px white |

  - **Credit off** (own posts only): `card` and `dark` lose the header and keep a radius-28 photo on an 8 px card border; `photo` loses the handle.
  - **No avatar:** a 56 px circle in `palette.to` with the author's initial, 28 px white.
  - **Placement:** centre (540, 900) for posts and (540, 960) for mentions, unrotated.
  - **Scale:** posts 0.72–1.3, mentions 0.8–1.15. The minimum keeps the credit at least 24 story px.
  - **Centre clamp:** at least 50% of the card stays inside the frame.
  - **Pure functions:** `cardSpec(style, aspect, credit, kind)`, `cardXf(spec, userScale, centre)` and `clampCardCentre()`.
- **RP-27. Background.**
  - **Default, Colours:** `Fill {kind:'gradient', from, to, angleDeg: 180}`. The colours come from a pure function, `palette(sample16x16)` in `src/core/repost/palette.ts`:
    - the mean of rows 0–3 and the mean of rows 12–15 of a 16×16 cover sample of the source;
    - each mixed 15% toward black;
    - if their relative-luminance difference is below 0.08, `from` is lightened and `to` darkened by 12%.
  - **Blur:** the editor's existing backdrop: `{kind:'blur', assetId: backdrop, radiusPx: 48, dim: 0.35}`.
  - **Black:** `#000000`.
- **RP-28. Interaction.**
  - **Drag the card:** moves it (`panImage`, free fit, then `clampCardCentre`).
  - **Wheel, pinch, or Size in the rail:** `setRepostScale`, clamped.
  - **Tap the card:** under 6 px of movement and under 350 ms, deferred 220 ms so that a double-click still goes to the Text tab (existing). It cycles the look `card → photo → dark → card`. For posts only: a mention has one look.
  - **`S`** cycles the look as well. It is a free key; the composer uses T, G, F, H, 0, +, −, `,` and `?`.
  - **Rotation:** none in v1. The rotate and Fit/Fill controls are hidden in repost mode.
  - **Hint:** after loading, `hint` shows "Click the post to change its look" for 1.8 s (posts).
- **RP-29. Rail.**
  - **The first tab:**
    - It becomes **Post** (or **Story** for a mention).
    - Look (segmented; posts only), Background (segmented), Size (slider), Show @handle (switch, own posts only), Reset (back to the defaults).
    - Under the controls: `notePost` / `noteStory`, always shown; for anyone else's post and for a mention, followed by `noMention` (the author is not notified, and how to notify them).
  - **Text tab:** unchanged. The text layer stays on top of the card.
  - **Others' posts:** the first time, the one-time `consent` notice appears above the Post card with **Got it** (storage.local `repostNoteSeen`). It is not shown for own posts or mentions.
- **RP-30. Not kept.**
  - Reposts are not drafts: `scheduleAutosave` skips while `repost` is set.
  - Their media is imported with a no-op `store`, so it never appears in **Recent photos** and nothing of others' content is stored.
  - A story already on the stage was autosaved before. Loading a repost shows `keptDraft`; Continue draft brings it back.
  - Closing the composer keeps the repost in memory (the iframe stays loaded) until the page reloads.
- **RP-31. Diagnostics.** The run record gets `repost: { kind, author, via, slide, consent, bar, mediaW }` and Details gets one row:
  - English: "Repost: @author's post (slide 2), via Share dialog, 1080 px".
  - Spanish: "Repost: publicación de @author (diapositiva 2), desde Compartir, 1080 px".
  - No URLs.

## 7. Posting

- **RP-32. Unchanged.** **Test run**, **Share test** and **Post story** use the same lane, the same export (1080×1920 PNG for msite), the same account guard, rate guard and pace, Share pressed at most once, never a retry, and "Posted" only from the publish answer (AM40, AM46, AM50). A repost is just pixels to the driver.

## 8. Strategy amendments (as adopted in strategy §11, AM54–AM61)

| Id | Amendment | Overrides |
|---|---|---|
| AM54 | **Repost to story, pixels only (owner request, 2026-10-25).** <ul><li>Photo posts (feed, modal, permalink, own grid) through Share → **Add to story**.</li><li>Photo stories that mention the owner through the DM pill and the viewer pill.</li><li>Rendered locally as a card over a generated background. Posted by the unchanged in-page lane.</li><li>No native reshare: no `reshared_media_id`, `attached_media`, `story_sticker_ids`, `reel_mentions` or `tap_models`, ever.</li><li>No MAIN-world script beyond the portrait shim.</li></ul> | — |
| AM55 | **The image-CDN GET (needs OD20).** <ul><li>The composer, and only the composer, may GET an image that the owner's Instagram page is showing, from `*.cdninstagram.com` or `*.fna.fbcdn.net`, through `cdn-fetch.ts`: `credentials:'omit'`, `referrerPolicy:'no-referrer'`, `redirect:'error'`.</li><li>At most 3 GETs per owner click. No automatic retry. URLs are never stored.</li><li>Under the `optional_host_permissions` above, requested on the owner's click.</li><li>The content script and the background still make no request. Nothing goes to instagram.com.</li><li>Accepted cost: Meta's CDN sees a request from the extension's origin (R31).</li></ul> | README rule 6 ("never hand-builds a request"); strategy §1 "no network of its own" for editor pages; inpage.md §8.7 |
| AM56 | **The author's choice.** <ul><li>The entry is blocked when sharing is known disabled: no Share control, or the SSR flags (RP-16).</li><li>Anyone else's content always carries the credit. It cannot be removed and is at least 24 story px.</li><li>Own posts may hide the credit.</li><li>Mentions are allowed only when confirmed (RP-9) and under 24 h old.</li><li>When consent is unknown, a one-time note is shown and the credit stays mandatory.</li><li>Fake interactive stickers or "View post" marks are never drawn.</li><li>Watermarks are never cropped: centre-crop happens only outside 3:4…1.91:1.</li></ul> | — |
| AM57 | **Reading Instagram's page for reposts.** <ul><li>P8 now reads: "Instagram's DOM is read only to place instapost's own controls, and, at the owner's click, to read a post's or a mention's metadata (RP-13–RP-16)."</li><li>The content-script message rule adds `inpage/repost` metadata: handles, a shortcode, a story pk, validated CDN URLs, numbers and booleans. No captions or bytes.</li><li>The one text read is `MENTION_PHRASES` and `SHARE_LABELS` in `src/inpage/repost/words.ts`. U31 (no text in decision code) excludes exactly that file. No autopilot decision reads it.</li></ul> | inpage.md P8; `messages.ts` header; AM45 scope |
| AM58 | **Videos later.** Video and reel entries are shown disabled with "Videos come later". No poster-frame reposts of posts. | — |
| AM59 | **Reposts are not kept.** No draft, no Recent photo, no stored URL. In-memory only. | ux.md §4.3 (autosave) for reposts |

- **OD20** (owner): approve AM55, which adds the optional CDN host permissions and the composer's audited GET.
  - Alternative if the owner refuses: reposting by Choose photo or paste only. It is already possible and needs no change, but it is not seamless.

## 9. Manifest, check-bundle, README, docs

- **RP-33. Manifest** (`wxt.config.ts`, every mode): add `optional_host_permissions` (RP-20). Nothing else changes.
- **RP-34. check-bundle T1.**
  - The snapshot adds `optional_host_permissions` as exactly those two patterns.
  - The CDN patterns must never appear in `host_permissions`, and there is no `optional_permissions`.
  - `FORBIDDEN_PERMISSIONS` is unchanged.
- **RP-35. check-bundle T3** (`tools/bundle/patterns.ts`, self-tested):
  - **New `cdnFetchProblems(text)`.** Across all editor-side files (not `background.js`, `composer-agent.js`, the content script or the HEIC worker), there is **exactly one** `fetch(` besides the modulepreload polyfill. It sits in the same block as `"instapost:cdn-fetch"` (`sameBlock`), with `credentials:"omit"`, `referrerPolicy:"no-referrer"` and `redirect:"error"` in that block. `forbiddenEditorFetches` exempts exactly that site.
  - **`permissions.request`** is added to `AGENT_ONLY` (and so to `CONTENT_SCRIPT_ONLY`) and to `BACKGROUND_ONLY`. In editor chunks it is allowed only with the `CDN_ORIGINS` constant.
  - **The `Meta host URL` scan** exempts exactly the two permission patterns.
  - **The content-script scans are unchanged.** The new detectors must pass them: no `.click`, no `fetch(`, no `storage`, no `postMessage`, no `.focus(`.
- **RP-36. README.**
  - **Rule 6:** add "…except, for a repost, the composer's GETs (at most 3 per click: the picture, a fallback size, the author's avatar) of images the page already shows from Instagram's image CDN (AM55)".
  - **Feature paragraph:** "Repost: Share → Add to story on a photo post, Add to your story on a story mention".
  - **The `check:bundle` line** names the new allowance.
- **RP-37. Docs.**
  - inpage.md: the P8 wording (AM57) and a §15 pointer to this file.
  - strategy §11: AM54–AM59, plus OD20 in §10.
  - live-checklist: L37–L51.
  - `messages.ts` header (AM57).

## 10. Files

- **New, pure** (`src/core/repost/`):
  - `cdn-url.ts`;
  - `source.ts` (the type and guard);
  - `paths.ts` (permalink, story and DM path parsers);
  - `srcset.ts` (parse and pick candidates);
  - `ssr-flags.ts` (`reshareFlags(json, code)`);
  - `gate.ts` (the RP-8 state table);
  - `palette.ts`;
  - `card-layout.ts`.
- **New, page** (`src/inpage/repost/`):
  - `glyphs.ts` (the glyph prefixes);
  - `words.ts`;
  - `detect-post.ts` (RP-5, RP-13);
  - `detect-dialog.ts`;
  - `detect-mention.ts` (RP-9, RP-10);
  - `place.ts` (`stripPlace`, `popoverPlace`, `mentionPillPlace` and `viewerPillPlace`, all pure);
  - `entry.ts` (renders the strip, popover and pills into the host).
- **New, composer and editor:**
  - `src/ui/repost/cdn-fetch.ts`;
  - `src/ui/repost-state.ts`;
  - `src/raster/card.ts`;
  - `entrypoints/composer/RepostIntake.tsx`;
  - `entrypoints/composer/PostTab.tsx`.
- **Changed:**
  - `page-script.ts`: the click listener, the dialog watch and the entry wiring;
  - `messages.ts`: `inpage/repost`, `ui/repost`, `ui/open-settings`, and the `repost` pref;
  - `src/inpage/background.ts`;
  - composer `state.ts`, `App.tsx` (the S key), `StagePane.tsx` (tap to cycle), `Rail.tsx` and `Sheets.tsx` (the setting);
  - `editor-state.ts`: `backdrop`, `assetSize`, and skipping autosave;
  - `export-cache.ts`: resolving both assets;
  - the catalogs and `strings.ts`;
  - the editor's `SettingsSheet.tsx`: the permission row;
  - `wxt.config.ts`, `check-bundle.ts`, `patterns.ts` and its tests;
  - the docs (RP-36, RP-37).

## 11. Tests: prototype-first, unit and browser only, no E2E, no fake server

| Id | Layer | What |
|---|---|---|
| U40 | unit | `isCdnImageUrl`: accepts `scontent-*.cdninstagram.com` and `instagram.f*.fna.fbcdn.net` over https. Rejects http; www, i. or any other instagram.com host; `cdninstagram.com.evil.io`; `evilcdninstagram.com`; userinfo; ports; `data:` and `blob:` URLs; more than 2048 characters |
| U41 | unit | `srcset.ts`: parse, dedupe with `currentSrc`, widest first, cap 3, drop non-CDN entries |
| U42 | unit | `paths.ts`: `/p/`, `/<user>/p/`, `/reel/`, `?img_index`, `/stories/<user>/<pk>/`, `/direct/t/<id>/`; garbage rejected |
| U43 | unit | `isRepostSource` (shape, caps, `consent ≠ blocked`). Background accept (frame 0 www only), pending replay exactly once, 60 s expiry, refusal during a run |
| U44 | unit | `reshareFlags`: allowed, blocked (each of the 3 signals), unknown (no match, or a code mismatch as in a stale SSR blob), more than 4 MB skipped |
| U45 | unit | `gate.ts`: the RP-8 table, own-post exemption, mention age at the 24 h edge |
| U46 | unit | `palette`: flat, vertical ramp, low-contrast widening, valid hex output |
| U47 | unit | `card-layout`: each style × aspect 4:5, 1:1, 1.91:1, 3:4, 9:16; aspect clamp and crop; credit at least 24 px at minimum scale; bitmap margins; `cardXf` on-story width; centre clamp |
| U48 | unit | `repost-state` reducers: the look cycle, credit locked for others and toggleable for own, Reset, a photo import leaving repost mode |
| U49 | unit | `words.ts`: EN and ES mention phrases match; "replied to your story", "respondió a tu historia" and "sent a story" do not |
| U50 | unit | `patterns`: `cdnFetchProblems` positive and negatives (an option missing, two fetches, the marker outside the block), `permissions.request` banned in background, agent and content script, the permission-pattern exemption |
| U51 | unit | `place.ts`: strip below, above or none; popover right, above or none; pill widths and the 132 px switch; viewer right, left or hidden |
| B21 | browser | `detect-post` on fixture DOM (structure from Research A S1/S2): feed article, modal, permalink; EN and ES aria; collab; carousel (translateX `li`, slide 3 virtualised); video slide; reel; no Share means null; the sidebar Messages click is ignored |
| B22 | browser | `detect-dialog`: a share dialog within 1500 ms is recognised; "More options" and the post's own modal are not; a late dialog leads to the popover |
| B23 | browser | `detect-mention`: EN and ES mention rows get a pill; story reply, shared story, expired placeholder and own story get none; a `video` gives a disabled pill; `mentionsSeen` drives the viewer pill |
| B24 | browser | `card.ts` painter: each style rasterised; transparent corners, header colour, credit region non-empty, no-avatar initial |
| B25 | browser | `loadRepost` with stubbed bytes, then the export: gradient background, card `image` op and `text` op at 1080×1920; Blur resolves the backdrop; the IDB store is never called (not in Recent) |
| B26 | browser | Stage: tap cycles the look, a drag moves without cycling, a double-click opens the Text tab without cycling, wheel scale is clamped |
| B27 | browser | Intake with stubbed `fetch` and `permissions`: granted shows the card; not granted shows the permission card; `request` throwing shows the settings route; 403 then the second candidate, then expired; at most 3 GETs; timeout shows failed and Try again |
| B28 | browser | The strip, popover and pill labels fit in en and es (RL-7 style, at 220 and 240 px) |

- Later, not now: a sealed E2E with a fake CDN host and `expectFromExtension`, once port 8443 is free.

## 12. Risks

| Id | Risk | Mitigation |
|---|---|---|
| R31 | The extension now contacts Meta's CDN itself. A CORS GET from `chrome-extension://<live id>` may carry an `Origin` header that identifies instapost's build (unverified) | Only on the owner's click, at most 3 GETs, no cookies, no referrer, an image the page already loaded; L45 records the headers |
| R32 | The consent gap: for SPA-opened posts the author's "Allow sharing" setting is invisible (`unknown`) | Mandatory credit, known-disabled blocks, one-time note, own post first; AM56 |
| R33 | DOM drift (glyph paths, the dialog shape, the DM XMA) | Fail closed (no entry), the popover fallback, glyph plus aria fallback, unit fixtures |
| R34 | Signed URLs expire (`oe`) or churn | Captured at click, used within seconds, `expiredLink` copy |
| R35 | Copyright and terms: a non-linked copy of others' content | Credit, the consent rules, the owner's own judgement; reposts are personal-use only |
| R36 | Instagram's Share dialog stays open under the composer (instapost never clicks) | Accepted; the owner closes it |
| R37 | Mention phrases differ (es-LA, new wording): the pill goes missing | Fail closed; L44 records the wording; add it to `words.ts` |
| R38 | The DM preview may be low-resolution | Viewer pill (RP-10), `lowRes` notice |
| R39 | The story viewer auto-advances under the pill | Re-read the pk and image at click; mismatch sends nothing |
| R40 | `permissions.request` from a framed page in Arc may fail | The editor-tab settings route (RP-20) |
| R41 | **Not adopted** (AM60, OD21: declined in the build). App-style repost would need a MAIN-world hook into Instagram's XHR/fetch adding app-only fields to its publish request: the fields (tier 3) and the hook itself are both signals Instagram can see (the owner dropped any hiding of the hook: no stealth; declined again in the build, decision back with the owner) | Not built: pixels only (AM54); README hard rule 6 unchanged (strategy §9.1) |

## 13. Owner's live test (secondary account only; Test run before any post; own post first)

- [ ] **L37** Load the 0.2.0 live build (Remove, then Load unpacked: the manifest changed). Reload instagram.com and check that **New story** still works (L30).
- [ ] **L38** **Own photo post, Test run.**
  1. Profile → open one of your own photo posts → Share. The **Add to story** strip appears at the dialog's edge. Click it.
  2. The composer opens with the permission card → **Allow** → the browser prompt → Allow. The card appears on the coloured background. Note whether the prompt appeared from the framed composer.
  3. Click the card: Card → Photo → Dark. Switch Show @handle off and on. Drag and resize it.
  4. **Test run**: it passes, nothing is posted.
  5. Record: the Details Repost row and `mediaW`.
- [ ] **L39** **Own post, real post** (at least 60 s after L38): Post story → **Posted**. On the phone: the card is sharp, the credit is readable, and the story is not tappable (as expected). Then delete it.
- [ ] **L40** **Carousel:** on slide 2 of a carousel, click Share → Add to story. The composer shows slide 2. Repeat from the feed (not the modal).
- [ ] **L41** **Video:** a reel and a video slide each show the strip **disabled**, "Videos come later".
- [ ] **L42** **Others' public photo post** (a test account you follow): Share → strip → composer, with the credit locked on and the one-time note. Test run only. Also open a **private** account's post you can see and a post whose author turned off story sharing (if available). Record whether Instagram shows Share at all, whether the strip shows, and whether the dialog has the external share bar (Copy link and so on), so RP-16 can decide whether `bar` becomes a gate. Note the dialog's title in EN and ES. Under the controls the note says "@author isn't notified" and how to notify them (not on your own post, L38; on a mention, L44, it does).
- [ ] **L43** **Feed vs hard-loaded permalink:** paste `/p/<code>/` into the address bar, reload, then Share → strip. In Details, the Repost row reads `consent allowed` when the reloaded page carries the post's sharing flags (else `not known`; record which). From the feed it reads `not known`.
- [ ] **L44** **Mention:** from a second test account, post a photo story mentioning the secondary account.
  1. In the secondary's DM thread: the **Add to your story** pill on the preview → composer → story card + "@author" → Test run.
  2. Open the story from the DM: the viewer pill appears beside the card; compare the sharpness.
  3. Record: the DM wording in EN and ES, the href form, the preview width, and whether a story reply or shared story shows no pill.
- [ ] **L45** **Headers** (DevTools on the composer frame → Network, the image GET). Record: the status, `Origin` (present or absent, and its value), `Referer` (none), `Sec-Fetch-Mode` and `-Dest`, cookies (none), and the response's `Access-Control-Allow-Origin` and `Cross-Origin-Resource-Policy`. Only these values go into `baseline.json`, never a URL or a screenshot.
- [ ] **L46** **Spanish Instagram:** switch Instagram to Español and repeat L38 up to the Test run. The strip reads "Añadir a tu historia"; the DM mention pill is recognised.
- [ ] **L47** **Light and dark:** the strip and pills follow Instagram's appearance; the strip never covers Instagram's dialog content.
- [ ] **L48** **Expired link:** leave a post open for hours (or overnight), then Share → strip. Either it loads, or you see "The photo's link expired…". Reload and it works.
- **L49–L51** (the credit at the edges, the short window, a repost after a result): in `docs/live-checklist.md`.

## 14. Order of work

1. Pure core: U40 to U49 and U51.
2. Page detectors and entry: B21 to B23, B28.
3. Background relay: U43.
4. Composer intake, permission and fetch: B27.
5. Card painter, editor state, rail and stage: B24 to B26, U47, U48.
6. check-bundle and manifest: U50.
7. Docs (RP-36, RP-37), then `pnpm run typecheck`, `lint`, `test`, `test:browser`, `build:all` and `check:bundle` (no Playwright).
8. Hand to the owner for L37 onward, after OD20.

## 15. Implementation (2026-10-25)

Built on `spike/repost` in the sealed environment: unit and browser tests only (no fake server, no Playwright, no Instagram). Every RP item is implemented as written except:

- **Files** as §10, plus `src/core/repost/edit.ts` (the look's pure reducers, U48), `src/ui/repost/intake.ts` (the GET plan), `src/ui/repost/diag.ts` (diagnostics), `src/platform/permissions.ts` (the one `permissions.request`).
- **RP-5 step 5:** the dialog watch is a short-lived `MutationObserver` of its own on `body` (1500 ms), not the page script's nav observer (that one watches `body`'s children only).
- **RP-13 `slide`:** from `?img_index=N` of the post's link or the page's URL; null in the feed (the carousel is virtualised).
- **RP-16 `bar`:** "seen" when the dialog's panel holds a share link (`mailto:`, WhatsApp, Facebook sharer, X or Threads intents), else "absent"; diagnostics only. `RepostSource` carries it (12 keys).
- **RP-12 copy:** `inpage.repost.look` and `inpage.repost.bg` are split into one key per option (Look · Card · Photo · Dark, Background · Colours · Blur · Black); added `inpage.repost.cancel`, `inpage.repost.reset`, `inpage.settings.repostHelp`, `inpage.keys.look`, the Details keys (`inpage.details.repost*`, `inpage.details.via.*`) and the editor's Settings row (`settings.cdn*`). Spanish Details label: "Compartida". The Details row's consent and share-bar values are words in both languages (`inpage.details.consent.*`, `inpage.details.bar.*`, review RV-9).
- **RP-22:** a fifth state, `denied` (the browser said no), shows `permDenied` with Choose photo….
- **RP-26 centre clamp:** at least 71% of the card's width and of its height stay inside the frame (≈ half its area), and the credit's whole box stays in the frame (review RV-1, AM56): `creditBox` (the header from the avatar to the handle's end; the photo style's pill; the mention's pill, at the width the painter measured) is kept 270 below the top (Instagram's top bar), 200 above the bottom (its reply bar) and 16 from the sides, else at least inside the frame; where the area rule and the credit disagree, the credit wins. It applies to every card that shows a credit (own posts with the credit on too) and to the first placement, Reset and Size. The default placements already satisfy it.
- **RP-28:** the tap is reported by the editor's Stage (`onTap`, under 6 px and 350 ms, not on the text) and deferred 220 ms in the composer's StagePane; the zoom popover sizes the card (its range), the stage's Reset resets the repost, Fit/Fill is hidden. Wheel and pinch go through a `free`-layer limiter in editor-state (the scale range, then the centre clamp).
- **RP-30:** the story on the stage is saved at once (`keepCurrentDraft`) and offered as Continue draft; a toast says so (`keptDraft`). A repost run's export is never saved to Downloads/instapost by itself (review RV-7, AM59): no copy for a failed or Couldn't-confirm repost, and Keep copies skips reposts; Save copy stays the owner's choice (`autoCopy`, run-view.ts).
- **RP-24 `photo` look (review RV-6):** "@author" sits on its own backing pill (56 high, padding 20, radius 28, `rgba(0,0,0,.45)`), 16 below the photo, left-aligned, instead of white text with a shadow, so it reads on a light photo's Colours or Blur background.
- **RP-16 consent (review RV-8):** `allowed` needs a found media object with a flag that says so (`can_viewer_reshare === true`, `can_reshare === true` or `ig_media_sharing_disabled === false`) and none that blocks; a found object without any sharing flag (a profile grid's thin objects) is `unknown`.
- **RP-13 avatar (review RV-4):** the avatar is the image inside the author's own profile link, else the header's only small avatar; a collab header's unlinked avatar stack gives none (the card draws the initial, never maybe the collaborator's face).
- **RP-7 fallback (review RV-5):** with a Share dialog open but no room for the strip (or no panel found), the pill goes 8 px beside the dialog (right, else left, top-aligned) and never over it (L47); else the popover's own place only if it misses the dialog; else nothing (`popover-no-room`). It stays while the dialog is used (a pointerdown inside it) and goes with the dialog.
- **RP-19 (review RV-2):** a repost that arrives while a finished result is still on the composer (closing and the Posted auto-close do not dismiss it) dismisses that result first, so the intake and its permission card show; a run in flight keeps its view.
- **RP-22 layout (review RV-3):** the intake's card is centred in the stage with ✕ in the top-right corner, the initial or the mark in a 56 px circle, and the actions in a row; the loading spinner follows the text colour (both themes).
- **RP-31 diagnostics:** besides the run record's `repost` facts and the Details row ("@a's post (slide 2), via Share dialog, 1080 px · consent allowed, share bar seen"), storage.local `repostDiag` keeps the last 30 reasons an entry could not attach or a picture could not load (`where`: post, dialog, mention, viewer, intake, fetch; `why`: e.g. `no-permalink`, `no-author`, `no-cdn-media`, `no-dialog`, `strip-no-room`, `popover-no-room`, `control-gone`, `advanced`, `refused-running`, `perm-request-threw`, `perm-denied`, `gone-403`, `http-500`, `timeout`, `not-image`, `too-large`, `decode`, `too-small`, `paint`). The composer's Settings → Advanced → Diagnostics → Copy gives `{ runs, repost }` when there are any (the plain run list otherwise).
- **B26:** covers the tap, the drag and the wheel on the Stage; the 220 ms deferral against a double-click (StagePane) is not under test.
- **check-bundle:** as RP-34/RP-35; `permissions.request` in editor chunks must be exactly `({origins:[...X]})` (the constant spread), and the manifest's optional list is pinned to the two patterns, so nothing else can be asked for.
- **Test infra:** the browser project pre-bundles Preact (vitest.config.ts) so B26 can mount the Stage.
- **`pnpm run lint` in a worktree under `.claude/worktrees/`** processes no file (biome.json excludes `**/.claude/worktrees`); it was run with the same configuration minus that exclusion: 0 errors, the 7 warnings the baseline has.

Not built (later): videos and reels (AM58), keyboard access to the strip (Instagram's dialog traps focus), the sealed E2E with a fake CDN host.

## 16. Port to `feat/repost` (2026-10-25)

- Brought from `spike/repost` onto `main` after v0.1.1 by a three-way merge per file (the prototype's baseline, its tree, `main`), keeping both sides: the run record keeps v0.1.1's owner mark (RL-13) beside `repost`; the composer's state keeps `currentStory` (RL-13, the stored guard) beside `takeRepost`; `run-view.test.ts` keeps RL-17 and RL-19 beside RV-7; inpage.md keeps the second round of release fixes before §15.
- Ids renumbered per strategy AM61. Test handles as on `main` (`testuser`, `first.last`). Version 0.2.0.
- Not yet: the sealed E2E. App-style repost (AM60, OD21) was declined in the build and is not implemented (README hard rule 8).

