# instapost

A Chrome extension for preparing Instagram stories on the desktop: a local 1080x1920 editor, download and phone hand-off, and a hand-off to Instagram's own mobile-web story composer where **you** click Share. It never calls Instagram's write endpoints and never clicks anything on Instagram.

Everything you need to know before touching it:

- [`docs/strategy.md`](docs/strategy.md): the spec. §11 lists the amendments made while building.
- [`docs/contract.md`](docs/contract.md): what the extension relies on in Instagram's composer (C1–C9) and the dev-environment spike results.
- [`docs/live-checklist.md`](docs/live-checklist.md): your steps on real Instagram, L1–L17 (L13–L17 for Arc) and the G gate.
- [`tools/fake-ig/README.md`](tools/fake-ig/README.md): the fake Instagram, its knobs and its JSON API.

## Hard rules

1. **Automation never runs in a profile that is logged in to Instagram or that can reach real Meta hosts.** That covers Playwright, CDP and `wxt` dev. Every launcher in this repo builds the sealed browser arguments from `tools/chrome/flags.ts` and calls `assertSealed()` first; keep it that way.
2. **Never log in anywhere** from a dev or test browser, and never log in inside the composer popup. If Instagram asks for a login there, the extension closes the window (`NOT_LOGGED_IN`).
3. **Only the live build goes into a branded Chrome profile**, loaded by hand. The dev and mock builds belong to sealed browsers only (strategy §5, G6).
4. **`https://www.instagram.com/__fake__/` is the fake only inside the sealed browser.** In any normal browser that address is the real Instagram. Never type it there.
5. `pnpm run contract:check` sends real logged-out requests to instagram.com. It is your manual check (L2, L11), not part of any automated run.

## Prerequisites

- macOS, Node **22.18** (see `.nvmrc`; tools run `.ts` files directly) and pnpm **9.15.0** (`corepack enable` picks it up from `package.json`).
- OpenSSL on `PATH`, for the fake's self-signed certificate.
- Playwright's Chromium, once: `pnpm exec playwright install chromium`.
- Google Chrome or Arc, only for loading the live build by hand (see "The live build in Arc").

## Setup

```sh
pnpm install          # also runs `wxt prepare`
pnpm run bootstrap    # keys, icons, fake certificate + SPKI hash, Chrome for Testing 155 in .cache/cft
```

`bootstrap` is idempotent. It writes:

- `keys/{dev,mock,live}.pub.b64`: public keys only, which give each build a stable extension ID.
- `.fake-ig/cert.pem`, `key.pem` and `spki.txt`: a 30-day certificate for `www.instagram.com` and `i.instagram.com`. No Keychain, NSS or `/etc/hosts` change is made; sealed browsers accept it by its SPKI hash. Renew it with `pnpm run fake:cert`. The fake server, `pnpm run dev` and the E2E suite all refuse to run within 3 days of expiry.
- `.cache/cft/`: Chrome for Testing 155.0.8059.39, the browser for `pnpm run dev` and the `@smoke` tests.

## Day-to-day development: `pnpm run dev`

```sh
pnpm run dev
```

1. It checks the certificate and the sealed arguments, and refuses to start otherwise.
2. It starts the fake Instagram (`node tools/fake-ig/server.ts`, HTTPS on 127.0.0.1:8443), or reuses one that is already running.
3. It runs `wxt` in `development` mode, with hot reload. The dev server listens on port 5317 (3000 is taken by Docker on this Mac); set `INSTAPOST_DEV_PORT` to change it.
4. WXT opens **sealed** Chrome for Testing 155 with the persistent, never-logged-in profile `.profiles/dev-fake` and the "instapost DEV" build (red striped icon) loaded.

In that browser:

- **The start page is the fake's dashboard, `https://www.instagram.com/__fake__/`.** It shows the stories "posted" to the fake (with size, bytes, `isTrusted`, the UA and client hints it saw), writes to real-shaped upload paths, violations, the last 200 requests and the knobs.
- **Open the editor** with the extension's toolbar icon (pin it from the puzzle-piece menu). Load a photo, then use Download JPEG, Share…, or Post from desktop. Post from desktop opens the composer popup against the fake; you play Instagram's side there (+ → Story, pick the file, Share).
- **Knobs.** Every unverified Instagram behaviour is a knob in the dashboard form: service-worker behaviour, login or challenge redirects, the story input's accept list, canvas geometry, locale, markup drift and more. Set one, then run a hand-off and watch the editor's hand-off panel. Reset clears the recordings and puts every knob back to the defaults derived from `baseline.json`. The knob table and the JSON API are in `tools/fake-ig/README.md`.
- **Settings** (`#/settings` in the editor): account label, rehearsal (default on), assisted insert (default on in the dev and mock builds, off in live: an inserted photo skips the story session that Instagram's + → Story starts, strategy AM37), the kill-switch lock with its `ENABLE` field, and **Probe composer**, which opens the popup, records C1–C8 and closes it. Rehearsal and assisted insert are fixed when a hand-off starts: both switches are locked while one runs, and the hand-off panel shows the ones that hand-off runs with.
- **A clean slate.** Open `https://www.instagram.com/__fake__/reset` in the dev browser. It clears caches and storage and unregisters the fake's service workers.

Ctrl+C stops `wxt`, which closes the browser, and then stops the fake if `dev` started it. `HEADLESS=1 pnpm run dev` runs Chrome headless, with your screen emulated so the composer popup still fits. `dev` always targets the sealed Chrome for Testing; the config refuses any other `wxt -b` browser.

To run the fake alone, use `pnpm run fake`.

## Build modes and their safeguards

| Mode | Command | Output | Name and icon | Write-block ruleset | Fake-marker guard | Goes into |
|---|---|---|---|---|---|---|
| `development` | `pnpm run dev` | `.output/chrome-mv3-dev` | "instapost DEV", red striped | Yes | Yes | Sealed CfT 155, `.profiles/dev-fake` |
| `mock` | `pnpm run build:mock` | `.output/chrome-mv3-mock` | "instapost MOCK", orange striped | Yes | Yes | Sealed Playwright profiles |
| `live` | `pnpm run build:live` | `.output/chrome-mv3-live` | "instapost", plain violet | No; per-session rehearsal rules instead | No; shows a FAKE INSTAGRAM banner on the fake | Your branded Chrome, by hand; also sealed Playwright profiles |

- **Guarded builds** (`development`, `mock`) carry a static ruleset that blocks Instagram's upload and publish endpoints, and they hand off only to a page with the fake's marker (`GUARD_NOT_FAKE` otherwise). Loaded into Google Chrome, Microsoft Edge or Arc by mistake, they refuse before opening any window (`BRANDED_BROWSER`, strategy AM23/AM28/AM34).
- **`wxt.config.ts` fails closed.** It refuses any other mode, `production` included, so a plain `wxt build` fails. It refuses `live` without `INSTAPOST_LIVE=1`, which `build:live` sets, and it refuses `live` under `wxt` dev. Without a valid certificate, `wxt` dev opens no browser at all.
- **Rehearsal** (live and guarded) blocks the same endpoints in the composer popup and in service-worker requests for the length of one hand-off. Keep it on until your first real post (L8).
- **The pace is human.** At least 60 s between composer opens, at most 6 per hour and 15 per day. A login, challenge or off-Instagram URL in the popup stops the hand-off; a challenge, any other account or security page (`/accounts/…`, `/auth_platform/…`) or an off-host URL also locks the desktop lane for 7 days until you type `ENABLE` in Settings. Any other unexpected Instagram page ends the hand-off without a lock (`UNEXPECTED_PAGE`).
- **After Share with rehearsal off**, the composer window stays open until you answer "Posted?" in the hand-off panel, so an upload still running in it is never cut off. Answer once the story shows as posted (or failed). The same happens, with rehearsal on too, when the inserted photo was never confirmed by the composer and you left it (for example with Share): instapost cannot tell whether a story went out, so "Posted?" has no pre-answer. Check the phone before answering, and never post again before that.
- **An unexpected Instagram page** (`UNEXPECTED_PAGE`) is named in the panel ("It went to /x/.") and on the hand-off record: on real Instagram, record it (live checklist L4, L8).
- **The portrait shim** (strategy §11 AM37) is the one script instapost runs in Instagram's own JavaScript world, in every build. Instagram's story composer decides "landscape" from the *screen* (`screen.orientation.type`), not from the window, so on a desktop with a landscape monitor it shows "Rotate your device to add to your story." instead of Share, however narrow and tall the window is (seen live in Arc on 2026-10-12). Just before the composer agent, the background runs a tiny function in the composer tab's top frame only (`scripting.executeScript` with `world:'MAIN'`), on every page of that tab: if the screen reads landscape, it makes `screen.orientation.type` read `portrait-primary` and `screen.orientation.angle` read `0` for that page, and nothing else (the screen's size, media queries and every other tab stay as they are). Instagram's own scripts could notice it (the two values are no longer the browser's native ones and disagree with the screen's size); it is one more inconsistency, kept to the composer window. The window is closed with `SCREEN_LANDSCAPE` (no lock) when, on the composer, the page's own `screen.orientation.type` still reads landscape, when the shim's reading could not be had at all, or when the shim only went in after the composer had opened (Instagram reads the screen when the composer opens, and again only on a resize; strategy AM38). That is all instapost can see: if Instagram ever reads the screen some other way (its screen size, a media query), the composer shows its rotate snackbar again while instapost records the screen as portrait and keeps waiting for a Share that cannot come; Cancel then, and note it (live checklist L16/L17). `check:bundle` allows that one MAIN-world call in `background.js` only, and runs the shipped shim on its own to prove it needs nothing else.

## Tests: `pnpm run verify`

```sh
pnpm run verify
```

It runs, in order:

1. `typecheck`: the root project, `src/core` (no DOM, no `chrome` types) and the fake's client.
2. `lint`: Biome.
3. `test`: unit tests (Vitest, node).
4. `test:browser`: raster, export, fonts and the composer agent against the fake's React components (Vitest browser mode).
5. `build:all`: the mock and live builds.
6. `check:bundle`: manifest snapshots, rulesets and forbidden patterns in the built output (T1–T5).
7. `playwright test`: the E2E suite against the fake.
   - Projects `mock` and `live` run every spec on Playwright's Chromium; `cft155-mock` and `cft155-live` run the `@smoke` set on Chrome for Testing 155.
   - Playwright starts the fake as its web server, or reuses a running one; the global setup refuses a running fake that was started from older sources (stop `pnpm run dev` and rerun).
   - A global setup aborts the run unless the certificate is valid, both artifacts match their modes and a sealed browser fails to reach `www.facebook.com`.

E2E runs headless with the owner's screen emulated (3024x1964 at 2x; E26 also emulates the ultrawide at 1512,−428). To watch a run, use `pnpm exec playwright test --headed --project=mock tests/e2e/handoff.spec.ts`. The specs are in `tests/e2e/`: `00-seal`, `editor`, `handoff`, `canary`, `tripwire`, `failure-matrix`, `geometry`, `arc` (E20–E27: Arc's window behaviour, the guided resize, Instagram's service worker, the 767 px breakpoint, the late story input, the two displays, Arc detection) and `orientation` (E28: the portrait shim and msite's two orientation checks). In the mock build the specs can make Chromium's windows behave like Arc's (`__e2eWindowQuirk` in the extension's storage.local: `arc`, `arcLate`, `ignoreAll`) and switch the portrait shim to read-only (`__e2ePortraitShimOff`: `true` everywhere, `"home"` everywhere but the composer, E28 e); both are compiled out of the live build, and `check:bundle` proves it. The emulated screen is landscape, as on the owner's desk, so without the portrait shim no hand-off in the suite could reach Share; every spec checks that no composer showed its rotate snackbar (except E28 b and e, which switch the shim off on purpose).

The fake has the production shape by default (strategy §11 AM35, AM37): `/create/story/` lands on `/`, the story input sits in the header beside + only while the window is at most 767 CSS px wide, every page load registers a service worker that takes control of the page without handling its requests, as Instagram's does, + → Story refuses a landscape window with the rotate toast, and the composer hides Share while the page reads a landscape screen orientation.

## The live build on your secondary account

Only after `pnpm run verify` is green, and only by hand:

1. Run `pnpm run verify`. It builds `.output/chrome-mv3-live` and proves it against the fake, including the rehearsal canary E9. Do not rebuild before loading it.
2. In **Google Chrome**, create a separate profile for the secondary account ("IG secondary"). Never use your everyday profile before gate G.
3. Open `chrome://extensions`, switch on Developer mode, choose **Load unpacked** and pick `.output/chrome-mv3-live`. Its name is "instapost" with a plain icon.
4. In the extension's Settings, set the account label, keep **Rehearsal on**, and leave **Assisted insert off** (the live build's default) until L6 and OD3: an inserted photo skips the story session Instagram starts at + → Story, so picking the file yourself is the way Instagram expects (strategy AM37).
5. Work through [`docs/live-checklist.md`](docs/live-checklist.md) in order, starting with L1, at the pace it states. Stop at any challenge, checkpoint or unexpected security email.

Results go into the hand-off log and `src/core/ig-contract/baseline.json`, as structural facts only. HTML, cookies, tokens, HAR files and screenshots with account data never go into the repo.

## The live build in Arc

Arc (Chromium 155) is the owner's browser; the first live run happened there on 2026-10-12 and failed (`docs/contract.md` § "First live run"). Arc needs a few things Chrome does not:

1. **Loading it.** In the Arc profile used by your "IG secondary" Space (extensions are per profile), open `arc://extensions`, switch on Developer mode, **Load unpacked** and pick `.output/chrome-mv3-live` from a green `pnpm run verify`. After a rebuild that changed the manifest, **Remove** it and load it again: Arc may keep the old manifest. Then follow the live checklist's Arc items, L13–L17, with rehearsal on until L17.
2. **The composer window.** Arc ignores the size a new popup asks for (it opened 1512x949) and often ignores the first resize. instapost sizes the window while it is still blank, before Instagram loads: it re-applies the size a few times within about a second and waits until it holds. If Arc still will not let it, the editor's hand-off panel says **"Waiting for you to make the window narrow and tall"**: drag the Instagram window's edges until the live size in the panel turns from `1512×902 ✗` to something like `524×965 ✓` (at most 767 px wide, taller than wide, at least 640 px tall; at a browser zoom other than 100% the panel names the width that applies, e.g. 843 px at 110%). It carries on by itself as soon as it is; Cancel, or 3 minutes without a usable size (`WINDOW_NOT_FITTED`), closes the window with Instagram never loaded. The window must stay that narrow: wider than 767 CSS px, Instagram's mobile site has no + → Story at all (`LAYOUT_TOO_WIDE`).
3. **What the panel rows mean** (after a probe or a hand-off):
   - **Page**: where the composer tab was when instapost decided. `/ (home: Instagram's usual landing, tap + → Story there)` is normal: Instagram sends `/create/story/` without a photo to its home page. A decision taken later on the composer itself reads `/create/story/ (the story composer, opened from home)`.
   - **Window**: the inner size instapost asked for against the one it got, the attempts, "size re-applied" when the browser ignored the first updates, "resized by you", "refitted once" (or "refit not honoured" when the browser ignored that resize too), and "opened at 1512×949 instead of …" when the browser ignored the requested size.
   - **Browser**: `Arc (recognised by its page colours)`, `Google Chrome`, `Microsoft Edge` or `Chromium`. Recorded in every build; a test (mock) build refuses Google Chrome, Microsoft Edge and Arc before opening a window, so there only Chromium appears.
   - **Mobile page** and **Viewport**: Instagram's own `is_mobile`, and the window's CSS size, DPR and orientation.
   - **Story input**: `present` (the hidden story input beside +), `none (no file input on the page)`, `none image-only (file inputs: …)`, or `present, accept list differs: …`; "(not checked: stopped before this step)" when the hand-off stopped earlier, e.g. on a too-wide window. Instagram's header can appear a moment after the page, so when the first look finds no input instapost waits up to 6 s for it and looks again before it decides (in a probe too).
   - **Service worker**: `controls the page — normal on Instagram` is expected (Instagram's worker takes over every page within about a second, without touching its requests). `intercepts requests` means the worker handled the page's own requests, which could then leave without the mobile profile: the window is closed (`SW_INTERCEPTS`) and the mobile route needs a re-check.
   - **Screen** (strategy AM37): the screen orientation Instagram's composer reads after the portrait shim, and what the shim did, e.g. `portrait-primary (portrait shim installed; the screen itself is landscape)`, then `… (portrait shim in place)` on the composer. On the composer, `landscape-…`, `unknown (the portrait shim could not be installed)` or `… (portrait shim installed only after the composer had read the landscape screen)` mean the composer asks to rotate the device and hides Share: the hand-off ends with `SCREEN_LANDSCAPE` (record it and stop). The row shows `screen.orientation.type` only: if the composer shows "Rotate your device…" while the row says portrait, Instagram reads the screen another way; Cancel and record it.
   - **Canvas**: the composer's canvas size once a photo is in it (C8).
