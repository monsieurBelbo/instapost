# Fake Instagram

A local stand-in for the parts of instagram.com that instapost touches (strategy §6.1, §6.2, §7.6). It is served at the real origin to **sealed** browsers only, and it records every "posted" story.

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

- recorded stories in a 9:16 phone frame, with w×h, bytes, `isTrusted`, the UA and client hints seen, the time, whether + → Story started the story session and the screen orientation the page read at Share (AM37);
- "Composer views (landscape gate)": what the composer page showed each time it mounted with a photo or its gate flipped (Share, or the rotate snackbar with no Share), with the reading that decided it (AM37);
- writes to real-shaped paths (`WRITE_PATH_REACHED`) and violations (untrusted Share clicks);
- the last 200 requests, with UA, client hints, `sec-fetch-*`, origin and the classification;
- a knob form and a reset button.

`https://www.instagram.com/__fake__/reset` clears the browser side instead: it answers with `Clear-Site-Data: "cache", "storage"` and unregisters every service worker. Use it to clean the persistent dev profile.

## JSON API

All paths are on `www.instagram.com`. `/__fake__/` traffic is never part of the request log.

| Method and path | Result |
|---|---|
| `GET /__fake__/health` (any host, `127.0.0.1` included) | `{ok:true, fake:true, certValidTo, sourceHash}`. `sourceHash` is `fakeSourceHash()` (`source-hash.ts`) when the server started; the E2E global setup refuses a fake whose hash differs from the working tree |
| `POST /__fake__/control` | `{control, isTrusted}` from the fake's own controls (+, Story, Post, Home, Close, Save). `isTrusted` other than `true` records an `UNTRUSTED_CONTROL` violation |
| `GET /__fake__/api/stories` | Recorded stories, oldest first. Each image is at `/__fake__/stories/<id>.jpg` |
| `GET /__fake__/api/requests[?since=<seq>]` | Logged requests (the last 1000) |
| `GET /__fake__/api/writes`, `/__fake__/api/violations` | Recordings |
| `POST /__fake__/composer-view` | From the fake's own composer page (AM37): `{landscape, share, via, screenOrientation, inner, sessionStarted, path}` each time its landscape gate is read with a photo (mount, then every flip on `resize`). Malformed bodies give 400 |
| `GET /__fake__/api/composer-views` | Those reports, oldest first (the last 200); the E2E fixtures fail a test whose composer showed the snackbar unless it opted out |
| `GET /__fake__/api/knobs` | Current knobs |
| `POST /__fake__/api/knobs` | Merge a JSON patch, e.g. `{"geometry":"fixed:1080x1920","insets":"0,0"}`. Unknown names or bad values give 400 and change nothing |
| `POST /__fake__/api/reset` | Clear stories (including `.fake-ig/stories/`), requests, writes, violations and knobs |

Knobs are server-global, so E2E runs with `workers: 1` and resets before each test.

## Knobs

Defaults come from `src/core/ig-contract/baseline.json`. U16 fails when `DEFAULT_KNOBS` in `knobs.ts` differs from `deriveKnobs(baseline.json)`, so a baseline update forces an update of the fake. Since 2026-10-12 (strategy §11 AM35) the defaults are the **production shape** that the first live run and a logged-out reading of Instagram's code established (`baseline.json` `provenance` says which fact comes from where):

- `/create/story/` without media lands on `/` (`route=homeOnly`);
- msite's mobile layout, with the header's + entry and the hidden image-only story input beside it, only while the viewport is at most 767 CSS px wide (live: a resize re-renders it); wider, a layout with no create entry and no file input at all;
- msite's two orientation checks (AM37, live and Instagram's bundles, 2026-10-12): **+ → Story** first runs the session start, `innerHeight < innerWidth` → the "Rotate your device to add to your story." toast (`fake-rotate-toast`) and no file chooser, else a uuid story session id; a file in the header input (a pick, or an insert that never tapped Story, whose session id stays null) passes the `listen`/`trusted`/photo checks with **no** orientation check and navigates in-page (pushState) to `/create/story/` with the composer. **The composer page** then reads its landscape gate when it mounts with the photo and on every `resize`: with `landscapeCheck=screen` (production) `screen.orientation.type` (else `window.orientation`, else the viewport), so on a landscape monitor it shows the snackbar (`fake-landscape-snackbar`) and renders no header and no Share, whatever the window, unless the page reads a portrait type (the extension's portrait shim); the story's metadata records `sessionStarted`, `sessionId` and `screenOrientation`;
- every page load registers a service worker that claims the page and has no fetch handler (`sw=claimOnRegister`); a page a worker takes control of sends one request, `GET /fake-static/beacon` (204), so its timing can be read (`workerStart` 0 here, > 0 under `sw=desktopShell`).

| Knob | Values (default first) | Effect |
|---|---|---|
| `classifier` | `ua`, `client-hints` | `is_mobile` from the User-Agent header, or from `sec-ch-ua-mobile: ?1` |
| `route` | `homeOnly`, `direct`, `elsewhere` | `homeOnly` 302s `/create/story/` to `/` (production); `direct` renders the composer route itself; `elsewhere` 302s to `/consent/`, an interstitial that is neither home nor a security flow |
| `input` | `present`, `afterTap` | The header's story input is in the DOM whenever the + entry is (production), or only after + → Story (a menu variant) |
| `accept` | `default`, `changed` | `image/avif,image/jpeg,image/png`, or with `image/heic` added (ACCEPT_DRIFT) |
| `listen` | `change`, `drop` | Which event the composer reads files from |
| `trusted` | `ignore`, `require` | `require` ignores file events with `isTrusted=false` |
| `geometry` | `viewportDpr`, `source`, `fixed:WxH`, `cssFixed:WxH` | Canvas backing and CSS size (see `client/geometry.ts`) |
| `insets` | `0,0` | CSS px reserved at the top and bottom before fitting the canvas |
| `save` | `on`, `off` | The Save button |
| `share` | `fake`, `real-paths`, `background` | `real-paths` also fires no-cors subresource POSTs to `i.instagram.com/rupload_igphoto/fb_uploader_<t>` and `/api/v1/media/configure_to_story/`; `background` goes home first and uploads 4.5 s later, so the story lands only if the popup is still open |
| `sw` | `claimOnRegister`, `none`, `desktopShell`, `claimLate` | `claimOnRegister` (production): every load registers `/fake-sw/claim-on-register.js?enableAddToHomeScreen=<is_mobile>&zenon_device_id=<per-load id>`, a worker with no fetch handler that calls `skipWaiting()` and `clients.claim()`. `desktopShell` (hypothetical): a worker with a fetch handler, at a stable URL, that answers navigations with its own desktop-UA fetch, passes every other GET through itself and claims every page that registers it (the product closes with `SW_INTERCEPTS`). `claimLate`: a worker without a fetch handler that claims the composer 2 s after it is ready. `none`: the fake's workers are unregistered |
| `auth` | `in`, `out`, `challenge`, `codeentry` | 302 to `/accounts/login/`, `/challenge/` or `/auth_platform/codeentry/` (placeholder pages with no form fields) |
| `offhost` | `none`, `afterReady`, `firstLoad` | Navigates to `https://accountscenter.instagram.com/` (NOTFOUND in a sealed browser): after ready, or as the 302 answer to `/create/story/` itself |
| `challenge` | `none`, `afterReady`, `afterReadySpa`, `afterShare`, `afterShareSpa` | A security challenge mid-session: 0.8 s after ready or after Share, by a full navigation to `/challenge/` or (`…Spa`) a `pushState` to it |
| `desktopComposer` | `302`, `desktopShell` | What a desktop UA gets for `/create/story/`: a 302 to `/`, or the desktop shell at that URL |
| `reload` | `none`, `afterReady` | The composer document reloads itself 0.5 s after it is ready (a later full-document load) |
| `locale` | `en`, `es` | Visible strings and `html[lang]` |
| `drift` | `none`, `renamed` | Random class names, root id and UA-script attribute |
| `marker` | `on`, `off` | `<meta name="instapost-fake-instagram" content="1">` |
| `slowMs` | `0` | Composer readiness delay in ms |
| `hydrateMs` | `0` | The header's + entry and story input mount this long after the page renders (P5) |
| `landscapeCheck` | `screen`, `viewport` | What the composer page's landscape gate reads (AM37): `screen` (production, baseline `composerLandscapeCheck`) = `screen.orientation.type`, else `window.orientation`, else the viewport; `viewport` = `innerWidth > innerHeight` only (the assumption before 2026-10-12). + → Story checks the viewport either way |

## Playing the human in Playwright

The `data-testid` hooks (`fake-create`, `fake-create-menu`, `fake-create-post`, `fake-create-story`, `fake-story-input`, `fake-post-input`, `fake-composer`, `fake-composer-canvas`, `fake-share`, `fake-save`, `fake-close`, `fake-toast`, `fake-rotate-toast`, `fake-landscape-snackbar`) are for tests only. The extension must never use them (T3).

- **Pick files by path, not by buffer.** `setInputFiles(path)` and `fileChooser.setFiles(path)` go through CDP and fire trusted events. With a `{name, mimeType, buffer}` payload, Playwright assigns the files from page script and fires **untrusted** `input` and `change` events, which `trusted=require` ignores.
- Tapping + → Story opens the file picker of the header's story input (it must be rendered: at most 767 CSS px wide). Wrap the tap in `page.waitForEvent('filechooser')`, or call `setInputFiles` on `[data-testid=fake-story-input]` directly. The tap starts the story session (and is refused with the rotate toast in a landscape window); the pick then navigates in-page to `/create/story/`, where the composer holds the photo. `setInputFiles` on the input skips the tap, so that story records `sessionStarted: false`, as H1's insert does.
- The headless E2E screen is landscape: without the extension's portrait shim the composer shows `fake-landscape-snackbar` and no `fake-share`. Read what it showed with `GET /__fake__/api/composer-views` (the popup may already be closed).
- `data-fake-layout` on the shell's root says which layout is rendered (`mobile` or `wide`).
- Share with a real `locator.click()`. A Share dispatched from page script is recorded as an `UNTRUSTED_SHARE` violation, and any other control clicked from page script (+, Story, Post, Home, Close, Save) as `UNTRUSTED_CONTROL`.
- Readiness and geometry: `document.documentElement.dataset.fakeReady === '1'` once the canvas is drawn, and `dataset.fakeGeometry` holds the ground truth as JSON (`canvas`, `css`, `dpr`, `inner`, `source`, `crop`, `model`, `insets`). The field names match the agent's C8 report.

## Files

| File | Role |
|---|---|
| `server.ts` | node:https adapter: certificate check, body collection, `startFakeServer()` |
| `source-hash.ts` | `fakeSourceHash()`: SHA-256 over the fake's sources and the contract files it imports, for the stale-fake check |
| `core.ts` | Transport-free `handle(request) → response`: routes, logging, write matching (same `WRITE_URL_FILTERS` as the block rules) |
| `knobs.ts`, `ua.ts`, `store.ts`, `html.ts`, `protocol.ts` | Knobs and baseline mapping, classifier, recordings, server-rendered HTML, shared types |
| `bundle.ts` | In-memory esbuild bundle of `client/main.tsx` at server start |
| `client/` | React 19 client: `MsiteShell` (layouts, header input, story session), `DesktopShell`, `StoryComposer`, `orientation` (msite's two orientation checks, AM37), `geometry`, `i18n`, `control` (isTrusted reports), `sw` (registration per knob, the beacon) |
| `sw/` | The `claimOnRegister` (default), `desktopShell` and `claimLate` service workers |
| `cert.ts` | Self-signed certificate and SPKI hash (strategy §7.5) |
