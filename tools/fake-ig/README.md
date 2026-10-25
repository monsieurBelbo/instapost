# Fake Instagram

A local stand-in for the parts of instagram.com that instapost touches (strategy §6.1, §6.2, §7.6; since 2026-10-13 the autopilot's, §11 AM39–AM42 and `docs/ux.md` IF1–IF12). It is served at the real origin to **sealed** browsers only. It models Instagram's mobile-web home with the + → Story entry, the story session, the composer with its Share footer, and Instagram's own upload and publish requests, and it records what the page did: stories, uploads, writes, telemetry, taps and violations.

## Run it

```sh
pnpm run fake:cert   # once, and whenever the certificate is within 3 days of expiry
pnpm run fake        # node tools/fake-ig/server.ts
```

- It listens on `https://127.0.0.1:8443` only. Sealed browsers (`tools/chrome/flags.ts`) map `www.instagram.com` and `i.instagram.com` there and accept the certificate by its SPKI hash.
- It refuses to start when the certificate is missing, does not match `spki.txt` or expires within 3 days, or when the client bundle fails to build.
- Playwright starts it as `webServer` and polls `https://127.0.0.1:8443/__fake__/health`.
- Never open it in a normal browser profile, and never point a browser at it without the sealed arguments.

## Dashboard

`https://www.instagram.com/__fake__/`, in a sealed browser. `pnpm run dev` opens it as the start page.

It shows:

- **Stories**: in a 9:16 phone frame, with w×h, bytes, `isTrusted` of the Share click (the autopilot's is `false`; the owner's in Finish by hand `true`), the UA and client hints seen, whether + → Story started the story session, the screen orientation the page read at Share, the Share control (v1/v2, Facebook badge) and whether Facebook cross-posting was asked for;
- **Autopilot evidence**: the uploads the server received (answered or not, and how), and the page's story-creation telemetry and taps (`enter`, `menu_opened`, `post_session_started`, `image_process_*`, `compose_*`, `tray_refresh`, `tap:<control>` with `isTrusted`);
- **Composer views (landscape gate)**: what the composer page showed each time it mounted with a photo or its gate flipped (Share, or the rotate snackbar with no Share), with the reading that decided it (AM37);
- **Writes** to the real write paths (`WRITE_PATH_REACHED`) and **Violations** (`DOUBLE_SHARE`, `RETRY_CLICKED`, `TAP_OUTSIDE_ALLOWLIST`, `SHARE_META_INVALID`);
- the last 200 requests, with UA, client hints, `sec-fetch-*`, origin, Referer and the classification;
- a knob form and a reset button.

`https://www.instagram.com/__fake__/reset` clears the browser side instead: it answers with `Clear-Site-Data: "cache", "storage"` and unregisters every service worker. Use it to clean the persistent dev profile.

## What the page does (the production shape)

Defaults come from `src/core/ig-contract/baseline.json` (U16: `DEFAULT_KNOBS` must equal `deriveKnobs(baseline.json)`, so a baseline update forces an update of the fake; `provenance` says where each fact comes from). The shape is Instagram's as its saved, logged-out msite bundles (2026-10-12 and 2026-10-13) and the live runs show it:

- **Home and the route.** `/create/story/` without media 302s to `/` (`route=homeOnly`). msite's mobile layout applies only while the viewport is at most 767 CSS px wide (a resize re-renders it); wider, a layout with no create entry and no file input at all.
- **The + entry (C10).** In the header, after hydration (`hydrateMs`): a box with the + link (`a[href="#"][role=link][tabindex=0]._a6hd` holding an svg whose `aria-label` is the Home string, as Instagram's is), then a box with the story form and the post form (`form[role=presentation][method=POST][enctype=multipart/form-data]` around a hidden file input; the form's `onClick` selects the file). The story input accepts `image/avif,image/jpeg,image/png`, the post input `image/jpeg`.
- **The menu.** + opens a portal `div[role=dialog]` `menuDelayMs` later (the lazy popover), with `div[role=button][tabindex=0]` items holding a glyph and a label, in `menuOrder`; a second + or an outside click closes it. **Story** runs `startStoryCreationSession`: the viewport check (`innerHeight < innerWidth`: the "Rotate your device" toast and nothing else), else a uuid session, the `enter` telemetry, then (a microtask later) the story input's `click()`: the file chooser when the page has user activation, nothing otherwise. **Post** clicks the post input and logs `post_session_started`.
- **The file (C11).** The story input's `change` → (`listen`, `trusted`) → not an image: the "only images" toast; else `image_process_*` with the session's `waterfall_id`, then an SPA navigation (pushState) to `/create/story/` with the composer.
- **The composer (C12).** `canvas._aa3c` (0×0 until drawn, `slowMs` after the file), `header._aa3d` (Close, Save, text, draw, AI label), the landscape gate (`landscapeCheck`; the snackbar `._aa3b` and no header or footer when the page reads a landscape screen, AM37), and the Share footer: ShareFooter (`footer` → `button._aswp`) or ShareFooterV2 (`footer` → `div[role=button]` with the avatar and, for `fb=auto`, the badge svg), switching v1 → v2 `fbDelayMs` after the photo when `fb` is `linked` or `auto`.
- **Share (C13)**, as Instagram's `uploadStory`: no in-flight guard (a second click uploads and publishes again: `DOUBLE_SHARE`); the canvas as a JPEG; the progress modal (`[role=dialog] [role=progressbar]`); an XHR `POST https://i.instagram.com/rupload_igphoto/fb_uploader_<upload id>` with credentials and Instagram's rupload headers, no timeout; only after a 2xx, an XHR `POST /api/v1/media/configure_to_story/` with a form body (`caption`, `configure_mode=1`, `share_to_facebook`, `upload_id`, …) and a 60 s timeout. The fake's own metadata rides on the upload as `x-fake-meta`. **Success**: the toast `[role=alert][aria-live=polite][aria-atomic=true]` (5 s, kept for one navigation), the tray refresh (`POST /graphql/query`), then home. **Failure**: the modal goes and the "Upload failed." toast offers Retry (`button._aswp`). `checkpoint_url` navigates there, `require_login` goes to the login page, `feedback_required` shows a dialog that never settles.
- **The server's answers.** The upload host answers www with CORS (the origin, credentials, the preflight echoing the requested headers: `*` would not cover a credentialed request). A story is stored only when the publish request succeeded for an upload id that has an upload, and once per upload id (a repeated publish answers with the same media: Chrome resends a POST whose reused connection was reset before any answer byte, AM42).
- **Instagram clears its resource-timing buffer** (`rtClear=on`): every 2 s and on image loads, so only an observer created early sees every entry.
- **Framing (docs/inpage.md F4–F6, §9.1).** Every HTML document on www and i carries `X-Frame-Options` (`xfo`), the F5-shaped CSP (`frameAncestors`) and `Cross-Origin-Opener-Policy: same-origin-allow-popups`; a framed shell request (`sec-fetch-dest: iframe`) is answered as `framed` says, by default with Instagram's "Sorry, this page isn't available" (C15). msite logs `msite_session` with `framed: window.top !== window` (F9) and keeps a sessionStorage logging id (`ht_persistent_session_id`) that the desktop shell keeps too, so a framed msite in a desktop tab reuses it (`sessionLogIdReused`, R26). Its `checkpoint` and `login401` reactions set `window.top.location.href` (F8).
- **The account (C14).** One profile link `/<handle>/` with the avatar in the bottom navigation (after hydration); feed posts carry their authors' links inside `article`.
- **The service worker.** Every page load registers a worker that claims the page and has no fetch handler (`sw=claimOnRegister`); a page a worker takes control of sends one request, `GET /fake-static/beacon` (204), so its timing can be read (`workerStart` 0 here, > 0 under `sw=desktopShell`).

## Knobs

| Knob | Values (default first) | Effect |
|---|---|---|
| `classifier` | `ua`, `client-hints` | `is_mobile` from the User-Agent header, or from `sec-ch-ua-mobile: ?1` |
| `route` | `homeOnly`, `direct`, `elsewhere` | `homeOnly` 302s `/create/story/` to `/` (production); `direct` renders the composer route itself, header with + included (instapost taps + only on home, so the autopilot stops there); `elsewhere` 302s to `/consent/`, an interstitial that is neither home nor a security flow |
| `input` | `present`, `afterTap` | The story input is in the DOM whenever the + entry is (production), or only after Story was tapped (nothing for the autopilot to arm: `INPUT_MISSING`) |
| `accept` | `default`, `changed` | `image/avif,image/jpeg,image/png`, or with `image/heic` added (`ACCEPT_DRIFT`) |
| `listen` | `change`, `drop` | Which event the story input reads files from (`drop`: the insert is ignored) |
| `landscapeCheck` | `screen`, `viewport` | What the composer page's landscape gate reads (AM37): `screen.orientation.type` (else `window.orientation`, else the viewport), or the viewport only. + → Story checks the viewport either way |
| `trusted` | `ignore`, `require` | `require` ignores untrusted clicks on + and the menu items and untrusted file events (an Instagram that started to check; the autopilot stops with `STORY_ENTRY_MISSING`) |
| `account` | `fake_owner`, `<handle>`, `none`, `ambiguous`, `other:<handle>` | The profile link's handle; `none`: no profile link (unreadable); `ambiguous`: two handles |
| `menuOrder` | `postStory`, `storyPost` | The menu's items in order (Instagram's is unknown logged out, L18) |
| `menuItems` | `2`, `3` | `3` adds a third item (Reel) the autopilot must never tap (`MENU_DRIFT`) |
| `menuDelayMs` | `300` | The lazy menu appears this long after the tap of + |
| `fb` | `none`, `linked`, `auto` | Facebook cross-posting: `linked` switches the footer to v2 after `fbDelayMs`; `auto` adds the badge and publishes with `share_to_facebook=true` |
| `fbDelayMs` | `800` | When the footer switches (Instagram's GraphQL answer) |
| `shareControl` | `v1`, `v2`, `missing`, `two` | ShareFooter, ShareFooterV2 from the start, no Share footer, or two (`SHARE_MISSING`) |
| `rupload` | `ok`, `500`, `cors`, `reset`, `hang`, `slow:<ms>` | The upload's answer: ok; 500 JSON; no CORS grant (the page reads status 0); the socket reset; no answer; ok after a delay |
| `configure` | `ok`, `400`, `feedback`, `login401`, `checkpoint`, `500`, `reset`, `redirectLogin`, `html200`, `hang`, `slow:<ms>` | The publish answer: 200 JSON with the media; 400 JSON; 400 `feedback_required`; 401 `require_login`; 400 with a `checkpoint_url`; 500 JSON; the socket reset (the story may exist); a 302 to the login page; 200 HTML; no answer (the story exists); ok after a delay |
| `tray` | `ok`, `fail`, `throw` | The tray refresh after a published story: 200; 500 (the page still goes home); the page's refresh throws (the toast, no navigation, the modal stays) |
| `rtClear` | `on`, `off` | Instagram clearing its resource-timing buffer (every 2 s and on image loads) |
| `geometry` | `viewportDpr`, `source`, `fixed:WxH`, `cssFixed:WxH` | Canvas backing and CSS size (see `client/geometry.ts`) |
| `insets` | `0,0` | CSS px reserved at the top and bottom before fitting the canvas |
| `save` | `on`, `off` | The composer's Save button |
| `sw` | `claimOnRegister`, `none`, `desktopShell`, `claimLate` | `claimOnRegister` (production): every load registers `/fake-sw/claim-on-register.js?enableAddToHomeScreen=<is_mobile>&zenon_device_id=<per-load id>`, a worker with no fetch handler that calls `skipWaiting()` and `clients.claim()`. `desktopShell` (hypothetical): a worker with a fetch handler, at a stable URL, that answers navigations with its own desktop-UA fetch, passes every other GET through itself and claims every page that registers it (the product closes with `SW_INTERCEPTS`). `claimLate`: a worker without a fetch handler that claims the composer 2 s after it is ready. `none`: the fake's workers are unregistered |
| `auth` | `in`, `out`, `challenge`, `codeentry` | 302 to `/accounts/login/`, `/challenge/` or `/auth_platform/codeentry/` (placeholder pages with no form fields) |
| `offhost` | `none`, `afterReady`, `firstLoad` | Navigates to `https://accountscenter.instagram.com/` (NOTFOUND in a sealed browser): 0.5 s after the composer drew the photo, or as the 302 answer to `/create/story/` itself |
| `challenge` | `none`, `afterReady`, `afterReadySpa`, `afterReadyTop`, `afterShare`, `afterShareSpa` | A security challenge mid-run: 0.8 s after the photo was drawn, or after the Share flow settled (home after a published story, or the "Upload failed." toast), by a full navigation to `/challenge/` or (`…Spa`) a `pushState` to it. `afterReadyTop` (docs/inpage.md F8): msite's instajax error path, `window.top.location.href = /challenge/…`, which in a frame moves the desktop page |
| `desktopComposer` | `302`, `desktopShell` | What a desktop UA gets for `/create/story/`: a 302 to `/`, or the desktop shell at that URL |
| `reload` | `none`, `afterReady` | The composer document reloads itself 0.5 s after the photo was drawn (a new document, which 302s home) |
| `locale` | `en`, `es` | Visible strings, aria-labels and `html[lang]` (every `es` string is unverified: no Spanish Instagram page has been seen; strategy AM45, live checklist L21) |
| `drift` | `none`, `renamed` | Random class names (Instagram's own `_aa3c`, `_aa3d`, `_aa3b`, `_a6hd`, `_aswp` included), root id and UA-script attribute |
| `marker` | `on`, `off` | `<meta name="instapost-fake-instagram" content="1">` |
| `slowMs` | `0` | The composer draws the photo this long after it took the file |
| `hydrateMs` | `0` | The header (+, the story input) and the navigation (the account link) mount this long after the page renders (P5) |
| `xfo` | `deny`, `sameorigin`, `none` | docs/inpage.md F4: `X-Frame-Options` on every HTML document of www and i (`DENY` is Instagram's, logged-out check 2026-10-14). Chromium enforces it in the sealed browser, so a frame of the fake renders only when rule 1020 removed it |
| `frameAncestors` | `absent`, `none`, `self` | F5: the documents' CSP is `frame-src https://*.instagram.com; child-src https://*.instagram.com` with no `frame-ancestors` (Instagram's); `none` / `self` add one (R27: dNR's XFO removal does not touch CSP) |
| `framed` | `unavailable`, `serve`, `refuse`, `desktop`, `login`, `offhost` | How a shell request the server sees as framed (`sec-fetch-dest: iframe`, the browser's own value for the in-page engine frame) is answered. `unavailable` (default; C15, live 2026-10-14): the shell with only "Sorry, this page isn't available" and a link home: no header, no +, no story input, no navigation (no account link), HTTP 200, and the log step `page_unavailable`. Rule 1021 forges `document`, so the engine frame gets the normal shell, as on Instagram; the in-page specs leave 1021 out (guarded `fetchDest: iframe`) to reach these answers. The others: as any other document, a 403 page, the desktop shell whatever the UA, a 302 to the login page, a 302 off Instagram |
| `desktopNav` | `auto`, `wide`, `collapsed`, `hover`, `bottomBar`, `absent`, `renamed` | The desktop shell's navigation (docs/inpage.md §3.2; contract.md "Desktop Instagram's page"). `auto` (default): responsive, wide with labels (244 px) from 1264 CSS px, collapsed to icons (72 px) from 768 px and **widening to 244 px over the page while hovered** (after a 100-ms hover intent, a 200-ms animation; it collapses as soon as the pointer leaves its DOM: live 2026-10-14/15, breakpoints approximate), a bottom bar below 768 px. `hover`: that hover-expanding navigation at any width (`data-fake-nav-expanded`). Fixed shapes: labels, icons only, a bottom bar, none, the wide one with random class names. Links `/`, `#`, `/explore/`, `/reels/`, `/direct/inbox/`, `#`, `#` (Create), `/<handle>/` with the avatar, a spacer, `#` (More); plus a Messages bubble at the bottom right |
| `theme` | `auto`, `light`, `dark` | The desktop shell's appearance as Instagram signals it: `__fb-light-mode` / `__fb-dark-mode` on `<html>`, the `--ig-*` colour variables as bare `r, g, b` triplets, the page's and the navigation's backgrounds from them (`data-fake-theme` on `<html>` for tests). `auto` (default) follows `prefers-color-scheme` live |

`share=fake|real-paths|background` and the direct `/__fake__/stories` share are gone (AM42): Share always uploads and publishes as Instagram's client does, and the guarded builds' block rules stop it there.

## JSON API

All paths are on `www.instagram.com`. `/__fake__/` traffic is never part of the request log.

| Method and path | Result |
|---|---|
| `GET /__fake__/health` (any host, `127.0.0.1` included) | `{ok:true, fake:true, certValidTo, sourceHash}`. `sourceHash` is `fakeSourceHash()` (`source-hash.ts`) when the server started; the E2E global setup refuses a fake whose hash differs from the working tree |
| `POST /__fake__/control` | `{control, isTrusted, repeat?, doc, label?, lang?}` from the fake's own controls; logged as `tap:<control>` with `isTrusted`, `repeat` and (AM45) the control's visible label and the page's language (E45 checks that a `locale=es` run tapped the Spanish controls). A second Share in one composer session is `DOUBLE_SHARE` (whoever clicked); an untrusted Retry is `RETRY_CLICKED`; an untrusted click on anything but +, Story, Share and Post (the autopilot's one trial) is `TAP_OUTSIDE_ALLOWLIST` |
| `POST /__fake__/log`, `GET /__fake__/api/log[?since=<seq>]` | The page's telemetry steps (`{step, doc, fields}`), oldest first; `doc` is a per-document id. Also (AM45) every toast (`toast`: `text`, `action`, `kind`, `lang`) and the rotate snackbar (`snackbar`: `text`, `lang`), diagnostics only |
| `GET /__fake__/api/stories` | Recorded stories, oldest first. Each image is at `/__fake__/stories/<id>.jpg` |
| `GET /__fake__/api/uploads` | The uploads the server received, answered or not (the last 50) |
| `GET /__fake__/api/requests[?since=<seq>]` | Logged requests (the last 1000) |
| `GET /__fake__/api/writes`, `/__fake__/api/violations` | Recordings |
| `POST /__fake__/composer-view` | From the fake's own composer page (AM37): `{landscape, share, via, screenOrientation, inner, sessionStarted, path}` each time its landscape gate is read with a photo |
| `GET /__fake__/api/composer-views` | Those reports, oldest first (the last 200); the E2E fixtures fail a test whose composer showed the snackbar unless it opted out |
| `GET /__fake__/api/knobs` | Current knobs |
| `POST /__fake__/api/knobs` | Merge a JSON patch, e.g. `{"geometry":"fixed:1080x1920","configure":"500"}`. Unknown names or bad values give 400 and change nothing |
| `POST /__fake__/api/reset` | Clear stories (including `.fake-ig/stories/`), uploads, the log, requests, writes, violations and knobs |

Knobs are server-global, so E2E runs with `workers: 1` and resets before each test.

## Playing the owner in Playwright

After Post story the autopilot does everything in the window; specs act there only when the case is about the owner (`tests/e2e/helpers/human.ts`): Finish by hand (`docs/ux.md` §4.9), a click in the window while the autopilot waits (E34), closing it (E42). The `data-testid` hooks (`fake-create`, `fake-create-menu`, `fake-create-story`, `fake-create-post`, `fake-create-reel`, `fake-story-input`, `fake-post-input`, `fake-profile-link`, `fake-composer`, `fake-composer-canvas`, `fake-share-footer`, `fake-share`, `fake-fb-badge`, `fake-save`, `fake-close`, `fake-text`, `fake-draw`, `fake-ai-label`, `fake-upload-modal`, `fake-feedback`, `fake-toast`, `fake-action-toast`, `fake-toast-action`, `fake-rotate-toast`, `fake-landscape-snackbar`) are for tests only. The extension must never use them (T3).

- **User activation.** Playwright's `page.evaluate` and every locator action run with a user gesture, so they give the page user activation for about 5 s, and the autopilot waits for it to lapse before any tap (or stops with `WINDOW_IN_USE`). To look at the window without touching the run, use CDP `Runtime.evaluate` without a gesture (`quietEvaluate`, `quietWaitFor` in `tests/e2e/helpers/fake-page.ts`).
- **Pick files by path, not by buffer.** `fileChooser.setFiles(path)` goes through CDP and fires trusted events. With a `{name, mimeType, buffer}` payload, Playwright assigns the files from page script and fires **untrusted** `input` and `change` events, which `trusted=require` ignores.
- **+ → Story by hand** (`human.pickViaStory`): a trusted tap of + and of Story starts the story session and opens the story input's file chooser (the window must be at most 767 CSS px wide and portrait); the pick navigates in-page to `/create/story/`.
- **Share by hand** (`human.share`): a real `locator.click()`; the story records `isTrusted: true`.
- The headless E2E screen is landscape: without the extension's portrait shim the composer shows `fake-landscape-snackbar` and no `fake-share`. Read what it showed with `GET /__fake__/api/composer-views` (the window may already be closed).
- `data-fake-layout` on the shell's root says which layout is rendered (`mobile` or `wide`); `data-fake-input` on `<html>` the verdict on the last file event.
- Readiness and geometry: `document.documentElement.dataset.fakeReady === '1'` once the canvas is drawn, and `dataset.fakeGeometry` holds the ground truth as JSON (`canvas`, `css`, `dpr`, `inner`, `source`, `crop`, `model`, `insets`). The field names match the agent's C8 report.

## Files

| File | Role |
|---|---|
| `server.ts` | node:https adapter: certificate check, body collection, transport behaviours (`slow`, `hang`, `reset`), `startFakeServer()` |
| `source-hash.ts` | `fakeSourceHash()`: SHA-256 over the fake's sources and the contract files it imports, for the stale-fake check |
| `core.ts` | Transport-free `handle(request) → response`: routes, logging, write matching (same `WRITE_URL_FILTERS` as the block rules), the upload and publish routes, control reports and violations |
| `knobs.ts`, `ua.ts`, `store.ts`, `html.ts`, `protocol.ts` | Knobs and baseline mapping, classifier, recordings, server-rendered HTML, shared types |
| `bundle.ts` | In-memory esbuild bundle of `client/main.tsx` at server start |
| `client/` | React 19 client: `MsiteShell` (layouts, the + entry and menu, the story session, the file, the account link), `DesktopShell`, `StoryComposer` (the composer DOM, the footers, Share), `upload` (Instagram's upload and publish XHRs), `rt-clear`, `orientation` (msite's two orientation checks, AM37), `geometry`, `i18n`, `ui` (toasts, the snackbar, glyphs), `control` (tap reports and telemetry), `sw` (registration per knob, the beacon) |
| `sw/` | The `claimOnRegister` (default), `desktopShell` and `claimLate` service workers |
| `cert.ts` | Self-signed certificate and SPKI hash (strategy §7.5) |
