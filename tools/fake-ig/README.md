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

- recorded stories in a 9:16 phone frame, with w×h, bytes, `isTrusted`, the UA and client hints seen, and the time;
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
| `GET /__fake__/api/knobs` | Current knobs |
| `POST /__fake__/api/knobs` | Merge a JSON patch, e.g. `{"geometry":"fixed:1080x1920","insets":"0,0"}`. Unknown names or bad values give 400 and change nothing |
| `POST /__fake__/api/reset` | Clear stories (including `.fake-ig/stories/`), requests, writes, violations and knobs |

Knobs are server-global, so E2E runs with `workers: 1` and resets before each test.

## Knobs

Defaults come from `src/core/ig-contract/baseline.json`. U16 fails when `DEFAULT_KNOBS` in `knobs.ts` differs from `deriveKnobs(baseline.json)`, so a baseline update forces an update of the fake.

| Knob | Values (default first) | Effect |
|---|---|---|
| `classifier` | `ua`, `client-hints` | `is_mobile` from the User-Agent header, or from `sec-ch-ua-mobile: ?1` |
| `route` | `direct`, `homeOnly`, `elsewhere` | `homeOnly` 302s `/create/story/` to `/`; `elsewhere` to `/consent/`, an interstitial that is neither home nor a security flow |
| `input` | `present`, `afterTap` | The story input is in the DOM on mount, or only after + → Story |
| `accept` | `default`, `changed` | `image/avif,image/jpeg,image/png`, or with `image/heic` added (ACCEPT_DRIFT) |
| `listen` | `change`, `drop` | Which event the composer reads files from |
| `trusted` | `ignore`, `require` | `require` ignores file events with `isTrusted=false` |
| `geometry` | `viewportDpr`, `source`, `fixed:WxH`, `cssFixed:WxH` | Canvas backing and CSS size (see `client/geometry.ts`) |
| `insets` | `0,0` | CSS px reserved at the top and bottom before fitting the canvas |
| `save` | `on`, `off` | The Save button |
| `share` | `fake`, `real-paths`, `background` | `real-paths` also fires no-cors subresource POSTs to `i.instagram.com/rupload_igphoto/fb_uploader_<t>` and `/api/v1/media/configure_to_story/`; `background` goes home first and uploads 4.5 s later, so the story lands only if the popup is still open |
| `sw` | `none`, `desktopShell`, `claimLate` | A service worker that answers navigations with its own desktop-UA fetch, or one that claims the composer 2 s after it is ready |
| `auth` | `in`, `out`, `challenge`, `codeentry` | 302 to `/accounts/login/`, `/challenge/` or `/auth_platform/codeentry/` (placeholder pages with no form fields) |
| `offhost` | `none`, `afterReady`, `firstLoad` | Navigates to `https://accountscenter.instagram.com/` (NOTFOUND in a sealed browser): after ready, or as the 302 answer to `/create/story/` itself |
| `challenge` | `none`, `afterReady`, `afterReadySpa`, `afterShare`, `afterShareSpa` | A security challenge mid-session: 0.8 s after ready or after Share, by a full navigation to `/challenge/` or (`…Spa`) a `pushState` to it |
| `desktopComposer` | `302`, `desktopShell` | What a desktop UA gets for `/create/story/`: a 302 to `/`, or the desktop shell at that URL |
| `reload` | `none`, `afterReady` | The composer document reloads itself 0.5 s after it is ready (a later full-document load) |
| `locale` | `en`, `es` | Visible strings and `html[lang]` |
| `drift` | `none`, `renamed` | Random class names, root id and UA-script attribute |
| `marker` | `on`, `off` | `<meta name="instapost-fake-instagram" content="1">` |
| `slowMs` | `0` | Composer readiness delay in ms |

## Playing the human in Playwright

The `data-testid` hooks (`fake-create`, `fake-create-menu`, `fake-create-post`, `fake-create-story`, `fake-story-input`, `fake-post-input`, `fake-composer`, `fake-composer-canvas`, `fake-share`, `fake-save`, `fake-close`, `fake-toast`, `fake-rotate-toast`) are for tests only. The extension must never use them (T3).

- **Pick files by path, not by buffer.** `setInputFiles(path)` and `fileChooser.setFiles(path)` go through CDP and fire trusted events. With a `{name, mimeType, buffer}` payload, Playwright assigns the files from page script and fires **untrusted** `input` and `change` events, which `trusted=require` ignores.
- Tapping + → Story opens the file picker. Wrap the tap in `page.waitForEvent('filechooser')`, or call `setInputFiles` on `[data-testid=fake-story-input]` directly.
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
| `client/` | React 19 client: `MsiteShell`, `DesktopShell`, `StoryComposer`, `geometry`, `i18n`, `control` (isTrusted reports) |
| `sw/` | The `desktopShell` and `claimLate` service workers |
| `cert.ts` | Self-signed certificate and SPKI hash (strategy §7.5) |
