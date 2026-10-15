# instapost

A Chrome extension for posting Instagram stories from the desktop (Arc, Chromium 155): a local 1080x1920 editor, download and phone hand-off, and **one-click posting** through Instagram's own mobile-web story composer. You press **Post story**; instapost opens Instagram's mobile site in a narrow window docked at the right of your screen, taps **+**, **Story** and **Share** there itself, and says "Posted" only when Instagram's own publish request answered with success. It never builds Instagram requests: Instagram's own page sends every one (strategy §11 AM39–AM42, [`docs/ux.md`](docs/ux.md)).

Everything you need to know before touching it:

- [`docs/strategy.md`](docs/strategy.md): the spec. §11 lists the amendments made while building; AM39–AM42 are the autopilot.
- [`docs/ux.md`](docs/ux.md): the autopilot's UX spec and implementation plan (screens, copy, how the result is decided, test modes).
- [`docs/contract.md`](docs/contract.md): what the extension relies on in Instagram's composer (C1–C14) and the spike results.
- [`docs/live-checklist.md`](docs/live-checklist.md): your steps on real Instagram, L1–L24 (L13–L17 for Arc, L18–L23 for the autopilot, L21 and L24 for Spanish) and the G gate.
- [`tools/fake-ig/README.md`](tools/fake-ig/README.md): the fake Instagram, its knobs and its JSON API.

## Hard rules

1. **Automation never runs in a profile that is logged in to Instagram or that can reach real Meta hosts.** That covers Playwright, CDP and `wxt` dev. Every launcher in this repo builds the sealed browser arguments from `tools/chrome/flags.ts` and calls `assertSealed()` first; keep it that way.
2. **Never log in anywhere** from a dev or test browser, and never log in inside the composer popup. If Instagram asks for a login there, the extension closes the window (`NOT_LOGGED_IN`).
3. **Only the live build goes into a branded Chrome profile**, loaded by hand. The dev and mock builds belong to sealed browsers only (strategy §5, G6).
4. **`https://www.instagram.com/__fake__/` is the fake only inside the sealed browser.** In any normal browser that address is the real Instagram. Never type it there.
5. `pnpm run contract:check` sends real logged-out requests to instagram.com. It is your manual check (L2, L11), not part of any automated run.
6. **instapost taps three of Instagram's controls and nothing else** (strategy AM39): + (Create), the Story menu item and Share, in the composer window only, through one audited helper (`src/agent/tap.ts`), Share at most once per post, Instagram's Retry never. `check:bundle` fails the build on any other click in the agent. It never hand-builds a request, never retries a publish, and never says "Posted" on a guess.

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
- **Open the editor** with the extension's toolbar icon (pin it from the puzzle-piece menu). Drop, paste or choose a photo, then press **Post story** (⌘↵) and **watch the autopilot**: the Instagram window opens docked at the right, reads the account, taps + → Story, adds the photo, presses Share and the editor shows the result from the fake's answer. A fresh profile asks for the **setup test** first (Run setup test: everything up to Share, nothing pressed). Other actions: **Test run**, **Send to phone…**, **Save copy**. In a dev or mock build every post ends as a **Share test** (the write-block ruleset stops the upload), never "Posted"; the live build posts to the fake.
- **Playing the owner.** When a knob makes Instagram's page drift (for example `trusted=require`), the result offers **Finish by hand**: you tap + → Story, pick the file from `Downloads/instapost/` and tap Share in the Instagram window; instapost only watches and confirms.
- **Knobs.** Every unverified Instagram behaviour is a knob in the dashboard form: service-worker behaviour, login or challenge redirects, the story input's accept list, the + menu, the Share footer, the upload and publish answers, canvas geometry, the account, locale, markup drift and more. Set one, then post and watch the run view. Reset clears the recordings and puts every knob back to the defaults derived from `baseline.json`. The knob table, the log and the JSON API are in `tools/fake-ig/README.md`.
- **Settings** (the sheet, `,` or `#settings`): the account posts go to (detected, with **Check again**), **Only post as @handle** (on by default: a different or unreadable account asks before any tap), Forget this account, **Also keep every posted story** in Downloads, the **Language**, the pace, and **Advanced**: **Check connection** (opens the window, reads the account, closes it, taps nothing), **Share test** (presses Share with publishing blocked, once ever on real Instagram: L19) and Copy diagnostics. A lock from the kill switch shows as a banner with **Resume…** (a checkbox, then Resume). **History** (`H`) lists the last 50 runs.
- **A clean slate.** Open `https://www.instagram.com/__fake__/reset` in the dev browser. It clears caches and storage and unregisters the fake's service workers.

Ctrl+C stops `wxt`, which closes the browser, and then stops the fake if `dev` started it. `HEADLESS=1 pnpm run dev` runs Chrome headless, with your screen emulated so the composer popup still fits. `dev` always targets the sealed Chrome for Testing; the config refuses any other `wxt -b` browser.

To run the fake alone, use `pnpm run fake`.

## Languages: English and Spanish

instapost speaks English and Spanish (strategy §11 AM44, AM45):

- **instapost's own screens.** Settings → **Language**: **Auto (browser)** (the default), **English** or **Español**. Auto follows the browser's UI language (`chrome.i18n.getUILanguage()`; Arc follows macOS): any Spanish (`es`, `es-AR`, `es-419`…) gives Spanish, anything else English. A change applies at once, in every open editor tab, and is stored with the other settings (`settings.lang`). Dates and times follow the chosen language. Every text lives in a typed catalog: `src/ui/catalog.en.ts` (the keys) and `src/ui/catalog.es.ts`, read through `t(key, params)` in `src/ui/i18n.ts`; U30 fails when the two catalogs differ in keys or placeholders. To change a text, change both catalogs; to add one, add the key to both (TypeScript refuses a Spanish catalog with a missing key). The extension's description in `chrome://extensions` / `arc://extensions` comes from `public/_locales/{en,es}` and follows the browser, not the setting; the name is "instapost" in both.
- **Instagram in Spanish.** The autopilot never reads Instagram's words, ARIA labels or language (`docs/contract.md` § "Instagram in Spanish"; U31 fails the build on a new text read), so it works whatever language Instagram's UI is in. The fake's `locale=es` knob renders its whole page in Spanish (its Spanish strings are unverified guesses until live check L21); E45 runs the setup test, a Share test, a post and the account check against it.
- The Spanish copy is neutral (tú, no vos). The E2E seed and the unit tests pin English, so their copy checks do not depend on the machine's language; E44 and E45 switch to Spanish on purpose.

## Build modes and their safeguards

| Mode | Command | Output | Name and icon | Write-block ruleset | Fake-marker guard | Goes into |
|---|---|---|---|---|---|---|
| `development` | `pnpm run dev` | `.output/chrome-mv3-dev` | "instapost DEV", red striped | Yes | Yes | Sealed CfT 155, `.profiles/dev-fake` |
| `mock` | `pnpm run build:mock` | `.output/chrome-mv3-mock` | "instapost MOCK", orange striped | Yes | Yes | Sealed Playwright profiles |
| `live` | `pnpm run build:live` | `.output/chrome-mv3-live` | "instapost", plain violet | No; per-run block rules for every test and check instead | No; shows a FAKE INSTAGRAM bar on the fake | Your branded Chrome or Arc, by hand; also sealed Playwright profiles |

- **Guarded builds** (`development`, `mock`) carry a static ruleset that blocks Instagram's upload and publish endpoints, and they hand off only to a page with the fake's marker (`GUARD_NOT_FAKE` otherwise). Loaded into Google Chrome, Microsoft Edge or Arc by mistake, they refuse before opening any window (`BRANDED_BROWSER`, strategy AM23/AM28/AM34).
- **`wxt.config.ts` fails closed.** It refuses any other mode, `production` included, so a plain `wxt build` fails. It refuses `live` without `INSTAPOST_LIVE=1`, which `build:live` sets, and it refuses `live` under `wxt` dev. Without a valid certificate, `wxt` dev opens no browser at all.
- **Test modes** (strategy AM41) replace the old Rehearsal switch. A **Test run** (and the one-time setup test) does everything up to finding Share and never presses it; a **Share test** presses Share once with publishing blocked; **Check connection** loads Instagram and reads the account. All three install the write-block rules for the composer tab and for service-worker requests for that one run. A publish request that gets through during a test is `TEST_LEAK`: the window closes and desktop posting is paused.
- **How "Posted" is decided** (AM40): only from Instagram's own publish request (`configure_to_story`) answering 2xx JSON without a redirect. A 4xx or a failed upload is **Not posted**; anything else (a 5xx, a cut-off answer, a web page instead of JSON, a window closed after Share) is **Couldn't confirm**: check your story before posting the same photo again (the Post card reminds you). While Instagram may still be uploading, the window stays open up to 15 minutes. instapost never asks "Posted?" and never retries.
- **The pace is human.** At least 60 s between composer opens (a post within the minute waits and starts by itself), at most 6 per hour and 15 per day, tests and checks included. A login, challenge or off-Instagram URL in the window stops the run; a challenge, any other account or security page (`/accounts/…`, `/auth_platform/…`) or an off-host URL also pauses desktop posting for 7 days (the pause banner's **Resume…**). Any other unexpected Instagram page ends the run without a lock (`UNEXPECTED_PAGE`, named in Details).
- **The portrait shim** (strategy §11 AM37) is the one script instapost runs in Instagram's own JavaScript world, in every build. Instagram's story composer decides "landscape" from the *screen* (`screen.orientation.type`), not from the window, so on a desktop with a landscape monitor it shows "Rotate your device to add to your story." instead of Share, however narrow and tall the window is (seen live in Arc on 2026-10-12). Just before the composer agent, the background runs a tiny function in the composer tab's top frame only (`scripting.executeScript` with `world:'MAIN'`), on every page of that tab: if the screen reads landscape, it makes `screen.orientation.type` read `portrait-primary` and `screen.orientation.angle` read `0` for that page, and nothing else (the screen's size, media queries and every other tab stay as they are). Instagram's own scripts could notice it (the two values are no longer the browser's native ones and disagree with the screen's size); it is one more inconsistency, kept to the composer window. The window is closed with `SCREEN_LANDSCAPE` (no lock) when, on the composer, the page's own `screen.orientation.type` still reads landscape, when the shim's reading could not be had at all, when the shim only went in after the composer had opened (Instagram reads the screen when the composer opens, and again only on a resize; strategy AM38), or when the autopilot sees Instagram's own rotate snackbar instead of the Share footer (AM39). `check:bundle` allows that one MAIN-world call in `background.js` only, and runs the shipped shim on its own to prove it needs nothing else.

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

E2E runs headless with the owner's screen emulated (3024x1964 at 2x; E26 also emulates the ultrawide at 1512,−428). To watch a run, use `pnpm exec playwright test --headed --project=live tests/e2e/autopilot.spec.ts`. The specs are in `tests/e2e/`: `00-seal`, `editor`, `autopilot` (E29–E31: the one-click post, the setup test, the Share test), `entry` (E33, E34, E36, E40: + → Story, the owner's clicks, the account prompt, Finish by hand), `locale` (E44, E45: the editor in Spanish; Instagram in Spanish), `outcome` (E32, E35, E37, E38: how the result is decided), `run` (E39, E42, E43: the queue, Stop, closing the window, the duplicate guard), `handoff` (E4, E7, E10, E14–E16, E19), `canary` (E8, E9), `tripwire` (E11, E17, E18), `failure-matrix` (E12), `geometry` (E13), `arc` (E20–E27) and `orientation` (E28). After Post story no spec touches Instagram's window except where the case is about the owner (the account prompt, Stop, closing the window, a click in it, Finish by hand). A post in the mock build always ends as a Share test (its ruleset blocks the upload); "Posted" is proven on the live artifact against the fake. Playwright's own evaluate gives a page user activation, which the autopilot waits out, so specs read the Instagram window mid-run through CDP without a gesture (`quietEvaluate`). In the mock build the specs can make Chromium's windows behave like Arc's (`__e2eWindowQuirk` in the extension's storage.local: `arc`, `arcLate`, `ignoreAll`) and switch the portrait shim to read-only (`__e2ePortraitShimOff`: `true` everywhere, `"home"` everywhere but the composer, E28 e); both are compiled out of the live build, and `check:bundle` proves it. The emulated screen is landscape, as on the owner's desk, so without the portrait shim no hand-off in the suite could reach Share; every spec checks that no composer showed its rotate snackbar (except E28 b and e, which switch the shim off on purpose).

The fake has the production shape by default (strategy §11 AM35, AM37, AM42): `/create/story/` lands on `/`, the story input sits in the header beside + only while the window is at most 767 CSS px wide, + opens a two-item menu a moment later, Story starts the story session (and refuses a landscape window with the rotate toast) and clicks the story input, every page load registers a service worker that takes control of the page without handling its requests, as Instagram's does, the composer hides Share while the page reads a landscape screen orientation, and Share uploads and publishes with XHRs to Instagram's real paths, which the fake answers as its knobs say.

## The live build on your secondary account

Only after `pnpm run verify` is green, and only by hand:

1. Run `pnpm run verify`. It builds `.output/chrome-mv3-live` and proves it against the fake, including the write-block canary E9 and the one-click post E29. Do not rebuild before loading it.
2. Use a separate profile for the secondary account ("IG secondary" in Chrome, or the Arc profile of its Space). Never use your everyday profile before gate G.
3. Load `.output/chrome-mv3-live` with **Load unpacked** (`chrome://extensions` or `arc://extensions`, Developer mode on). Its name is "instapost" with a plain icon.
4. Log in to Instagram in a normal tab of that profile (never in instapost's window), then in the editor run the **setup test** (L18): everything up to Share, nothing posted; it learns the account and Instagram's + menu. There is no Rehearsal or Assisted insert switch any more: tests always block publishing, and a post is a post.
5. Work through [`docs/live-checklist.md`](docs/live-checklist.md) in order, at the pace it states: for the autopilot, L18 (setup test), L19 (one Share test), then L20 (the first one-click post). Stop at any challenge, checkpoint or unexpected security email.

Results go into History (Details, Copy diagnostics) and `src/core/ig-contract/baseline.json`, as structural facts only. HTML, cookies, tokens, HAR files and screenshots with account data never go into the repo.

## The live build in Arc

Arc (Chromium 155) is the owner's browser; the first live run happened there on 2026-10-12 and failed (`docs/contract.md` § "First live run"). Arc needs a few things Chrome does not:

1. **Loading it.** In the Arc profile used by your "IG secondary" Space (extensions are per profile), open `arc://extensions`, switch on Developer mode, **Load unpacked** and pick `.output/chrome-mv3-live` from a green `pnpm run verify`. After a rebuild that changed the manifest, **Remove** it and load it again: Arc may keep the old manifest. Then follow the live checklist: L13–L17 were the hand-off era's Arc items (L17, the first real post, passed on 2026-10-13); the autopilot's are L18–L23.
2. **The composer window.** It docks at the right edge of the screen the editor is on, in front; keep it in view while instapost works (you don't need to click it: a click there makes instapost wait, R22). Arc ignores the size a new popup asks for (it opened 1512x949) and often ignores the first resize. instapost sizes the window while it is still blank, before Instagram loads: it re-applies the size a few times within about a second and waits until it holds. If Arc still will not let it, the run view says **"Arc didn’t let instapost resize the Instagram window. Drag its edge until it’s narrow and tall"** with the live size (`Now 1512 × 902 ✗` until it reads like `Now 524 × 965 ✓`: at most 767 px wide, taller than wide, at least 640 px tall). It carries on by itself as soon as it is; Stop, or 2 minutes without a usable size (`WINDOW_NOT_FITTED`), closes the window with Instagram never loaded. The window must stay that narrow: wider than 767 CSS px, Instagram's mobile site has no + → Story at all (`LAYOUT_TOO_WIDE`).
3. **What the Details rows mean** (Details ▸ under the run view, a result or a History row; Copy diagnostics copies them as JSON). Since the autopilot there are also Result, Evidence (Share pressed, the upload and publish answers, went home), Account, Story entry (+ → Story, the menu, armed), Share control (footer v1 or v2, the Facebook badge), Steps (the time of each), Quality, Requests after Share and Alarms:
   - **Page**: where the composer tab was when instapost decided. `/ (home: Instagram's usual landing; instapost taps + → Story there)` is normal: Instagram sends `/create/story/` without a photo to its home page.
   - **Window**: the inner size instapost asked for against the one it got, the attempts, "size re-applied" when the browser ignored the first updates, "resized by you", "refitted once" (or "refit not honoured" when the browser ignored that resize too), and "opened at 1512×949 instead of …" when the browser ignored the requested size.
   - **Browser**: `Arc (recognised by its page colours)`, `Google Chrome`, `Microsoft Edge` or `Chromium`. Recorded in every build; a test (mock) build refuses Google Chrome, Microsoft Edge and Arc before opening a window, so there only Chromium appears.
   - **Mobile page** and **Viewport**: Instagram's own `is_mobile`, and the window's CSS size, DPR and orientation.
   - **Story input**: `present` (the hidden story input beside +), `none (no file input on the page)`, `none image-only (file inputs: …)`, or `present, accept list differs: …`; "(not checked: stopped before this step)" when the run stopped earlier, e.g. on a too-wide window. Instagram's header can appear a moment after the page, so when the first look finds no input instapost waits up to 6 s for it and looks again before it decides (in a probe too).
   - **Service worker**: `controls the page — normal on Instagram` is expected (Instagram's worker takes over every page within about a second, without touching its requests). `intercepts requests` means the worker handled the page's own requests, which could then leave without the mobile profile: the window is closed (`SW_INTERCEPTS`) and the mobile route needs a re-check.
   - **Screen** (strategy AM37): the screen orientation Instagram's composer reads after the portrait shim, and what the shim did, e.g. `portrait-primary (portrait shim installed; the screen itself is landscape)`, then `… (portrait shim in place)` on the composer. On the composer, `landscape-…`, `unknown (the portrait shim could not be installed)` or `… (portrait shim installed only after the composer had read the landscape screen)` mean the composer asks to rotate the device and hides Share: the run ends with `SCREEN_LANDSCAPE` (record it and stop). The row shows `screen.orientation.type` only; the autopilot also looks for Instagram's own rotate snackbar, so a composer that asks to rotate while the row says portrait still ends the run (`SCREEN_LANDSCAPE`, "rotate snackbar shown"): record it, Instagram reads the screen another way.
   - **Canvas**: the composer's canvas size once a photo is in it (C8).

## Sharing a build with someone

`pnpm run package [inpage|live|<dir>] [--build] [--to <shared folder>]` packages a live-key build (default: the in-page build) for use outside the Chrome Web Store:

- It always writes `dist/instapost-<version>-<stamp>.zip` (gitignored), containing the extension, `INSTALL.txt` (install steps and the account-risk note) and `BUILD.txt`.
- `--to <folder>`, e.g. a shared iCloud Drive or Dropbox folder, also syncs the unpacked extension there. The recipient loads that folder once with **Load unpacked** (Developer mode). After each new `pnpm run package -- --to <folder>`, they click ↻.
- The manifest gets a `version_name` with the build stamp, so the extensions page shows which build is loaded. The key is unchanged, so the extension ID and the recipient's stored settings survive updates.
- Guarded (dev/mock) builds are refused. A folder that is not empty and was not created by the script is never wiped.
