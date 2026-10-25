# instapost

A Chrome extension for posting Instagram stories from the desktop (Arc, Chromium 155): a local 1080x1920 editor, download and phone hand-off, and **one-click posting** through Instagram's own mobile-web story composer. On desktop instagram.com, a **New story** row in Instagram's sidebar opens instapost's composer over the page; you press **Post story** and instapost drives Instagram's mobile site in a phone-sized frame inside that same tab (the in-page lane, strategy §11 AM46–AM52, [`docs/inpage.md`](docs/inpage.md)), taps **+**, **Story** and **Share** there itself, and says "Posted" only when Instagram's own publish request answered with success. The older window lane stays as the fallback: the editor tab's Post story opens Instagram's mobile site in a narrow window docked at the right of your screen. It never builds Instagram requests: Instagram's own page sends every one (strategy §11 AM39–AM42, [`docs/ux.md`](docs/ux.md)).

> **Not affiliated with, endorsed or sponsored by Instagram or Meta.** "Instagram" is a trademark of Instagram, LLC, used here only to say what the extension works with. Posting this way is outside Instagram's terms of use: your account is at your own risk (see [Posting from Instagram](#posting-from-instagram-the-in-page-lane)). Provided as is, without warranty; see [LICENSE](LICENSE).

Everything you need to know before touching it:

- [`docs/strategy.md`](docs/strategy.md): the spec. §11 lists the amendments made while building; AM39–AM42 are the autopilot, AM44–AM45 the languages, AM46–AM52 the in-page lane.
- [`docs/inpage.md`](docs/inpage.md): the in-page lane's design, spike S12, the prototype and what changed when it was adopted (§13, §14). The approved UI spec is [`docs/inpage-ui-spec.md`](docs/inpage-ui-spec.md).
- [`docs/ux.md`](docs/ux.md): the autopilot's UX spec and implementation plan (screens, copy, how the result is decided, test modes); since AM46 the window lane's, the fallback.
- [`docs/contract.md`](docs/contract.md): what the extension relies on in Instagram's composer (C1–C14), in the in-page frame (C15–C16), and the spike results.
- [`docs/live-checklist.md`](docs/live-checklist.md): your steps on real Instagram, L1–L36 (L13–L17 for Arc, L18–L23 for the autopilot, L21 and L24 for Spanish, L25–L36 for the in-page lane) and the G gate.
- [`tools/fake-ig/README.md`](tools/fake-ig/README.md): the fake Instagram, its knobs and its JSON API.
- [`CHANGELOG.md`](CHANGELOG.md): what changed in each version.

## Install (someone shared a build with you)

You need desktop Chrome or Arc 155 or later. instapost is not in the Chrome Web Store, so it is loaded unpacked:

1. Unzip `instapost-<version>-<stamp>.zip` and put the `instapost` folder somewhere permanent (not Downloads), or leave it in the shared folder it came in.
2. Open `chrome://extensions` (Arc: `arc://extensions`), turn on **Developer mode** and click **Load unpacked** → that folder.
3. Open instagram.com logged in (reload a tab that was already open) and click **New story** in the left sidebar.
4. To update, replace the folder's contents (a shared folder updates by itself), wait for the sync to finish, click ↻ on instapost and reload Instagram.

`INSTALL.txt` in the folder has the details. Read its "READ THIS FIRST": posting this way is outside Instagram's terms of use and Instagram can detect it, so try a secondary account first.

## Hard rules

1. **Automation never runs in a profile that is logged in to Instagram or that can reach real Meta hosts.** That covers Playwright, CDP and `wxt` dev. Every launcher in this repo builds the sealed browser arguments from `tools/chrome/flags.ts` and calls `assertSealed()` first; keep it that way.
2. **Never log in anywhere** from a dev or test browser, and never log in inside the composer popup. If Instagram asks for a login there, the extension closes the window (`NOT_LOGGED_IN`).
3. **Only the live build goes into a branded Chrome profile**, loaded by hand. The dev and mock builds belong to sealed browsers only (strategy §5, G6).
4. **`https://www.instagram.com/__fake__/` is the fake only inside the sealed browser.** In any normal browser that address is the real Instagram. Never type it there.
5. `pnpm run contract:check` sends real logged-out requests to instagram.com. It is your manual check (L2, L11), not part of any automated run.
6. **instapost taps three of Instagram's controls and nothing else** (strategy AM39): + (Create), the Story menu item and Share, in the composer window or the in-page engine frame only, through one audited helper (`src/agent/tap.ts`), Share at most once per post, Instagram's Retry never. `check:bundle` fails the build on any other click in the agent. It never hand-builds a request, never retries a publish, and never says "Posted" on a guess.
7. **Two header changes in the in-page frame, and no others** (strategy AM47, owner-approved): during a run, for that tab's www `sub_frame` only, `X-Frame-Options` is removed from the frame's document (rule 1020) and `Sec-Fetch-Dest` is set to `document` on its request (rule 1021). Never strip CSP; never forge `Sec-Fetch-Site`, `Sec-Fetch-Mode`, `Sec-Fetch-User`, `Origin` or `Referer`; never touch cookies; never install a frame rule outside a run or for another tab. `check:bundle` T2 checks the two rules' shapes.

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

- **instapost's own screens** (the editor, and since AM48 the composer over Instagram and its New story entry). Settings → **Language** (in the editor's Settings and in the composer's): **Auto (browser)** (the default), **English** or **Español**. Auto follows the browser's UI language (`chrome.i18n.getUILanguage()`; Arc follows macOS): any Spanish (`es`, `es-AR`, `es-419`…) gives Spanish, anything else English. A change applies at once, in every open editor tab, and is stored with the other settings (`settings.lang`). Dates and times follow the chosen language. Every text lives in a typed catalog: `src/ui/catalog.en.ts` (the keys) and `src/ui/catalog.es.ts`, read through `t(key, params)` in `src/ui/i18n.ts`; U30 fails when the two catalogs differ in keys or placeholders. The composer's texts are the `inpage.*` keys (mapped per surface in `src/inpage/strings.ts`); the content script's entry and coach mark are the `page.*` keys, kept in `catalog.page.{en,es}.ts` so the content script imports only those (with `i18n-core.ts`), and it gets the language from the background, never from storage (U39, B20). To change a text, change both catalogs; to add one, add the key to both (TypeScript refuses a Spanish catalog with a missing key). The extension's description in `chrome://extensions` / `arc://extensions` comes from `public/_locales/{en,es}` and follows the browser, not the setting; the name is "instapost" in both.
- **Instagram in Spanish.** The autopilot never reads Instagram's words, ARIA labels or language (`docs/contract.md` § "Instagram in Spanish"; U31 fails the build on a new text read), so it works whatever language Instagram's UI is in. The fake's `locale=es` knob renders its whole page in Spanish (its Spanish strings are unverified guesses until live check L21); E45 runs the setup test, a Share test, a post and the account check against it.
- The Spanish copy is neutral (tú, no vos). The E2E seed and the unit tests pin English, so their copy checks do not depend on the machine's language; E44 and E45 switch to Spanish on purpose.

## Build modes and their safeguards

| Mode | Command | Output | Name and icon | Write-block ruleset | Fake-marker guard | Goes into |
|---|---|---|---|---|---|---|
| `development` | `pnpm run dev` | `.output/chrome-mv3-dev` | "instapost DEV", red striped | Yes | Yes | Sealed CfT 155, `.profiles/dev-fake` |
| `mock` | `pnpm run build:mock` | `.output/chrome-mv3-mock` | "instapost MOCK", orange striped | Yes | Yes | Sealed Playwright profiles |
| `live` | `pnpm run build:live` | `.output/chrome-mv3-live` | "instapost", plain violet | No; per-run block rules for every test and check instead | No; shows a FAKE INSTAGRAM bar on the fake | Your branded Chrome or Arc, by hand; also sealed Playwright profiles |

Every build carries both lanes: the in-page lane (the content script on www.instagram.com, the web-accessible composer page, the `webRequest` frame watch and the session rules 1001/1020/1021 for the run's tab) and the window lane (the editor tab). There is no separate in-page build any more. The in-page lane's Developer toggles (`ua`, `frame`, `view`, `xfoRule`, `fetchDest`; storage key `__e2eInpageToggles`) exist in the guarded builds only.

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
4. `test:browser`: raster, export, fonts, the composer agent against the fake's React components, and the in-page entry (its place, U35; its language, B20) (Vitest browser mode).
5. `build:all`: the mock and live builds.
6. `check:bundle`: manifest snapshots, rulesets and forbidden patterns in the built output (T1–T5), with the in-page lane's allowances (content script, web-accessible composer, `webRequest`, the frame rules as session rules only) pinned and documented in `scripts/check-bundle.ts`.
7. `playwright test`: the E2E suite against the fake.
   - Projects `mock` and `live` run every window-lane spec on Playwright's Chromium; `cft155-mock` and `cft155-live` run the `@smoke` set on Chrome for Testing 155; `inpage` and `inpage-cft155` run the in-page spec on the mock artifact (both browsers), `inpage-live` and `inpage-live-cft155` its `@live` post on the live artifact.
   - Playwright starts the fake as its web server, or reuses a running one; the global setup refuses a running fake that was started from older sources (stop `pnpm run dev` and rerun).
   - A global setup aborts the run unless the certificate is valid, both artifacts match their modes and a sealed browser fails to reach `www.facebook.com`.

E2E runs headless with the owner's screen emulated (3024x1964 at 2x; E26 also emulates the ultrawide at 1512,−428). To watch a run, use `pnpm exec playwright test --headed --project=live tests/e2e/autopilot.spec.ts`. The specs are in `tests/e2e/`: `00-seal`, `editor`, `autopilot` (E29–E31: the one-click post, the setup test, the Share test), `entry` (E33, E34, E36, E40: + → Story, the owner's clicks, the account prompt, Finish by hand), `locale` (E44, E45: the editor in Spanish; Instagram in Spanish), `outcome` (E32, E35, E37, E38: how the result is decided), `run` (E39, E42, E43: the queue, Stop, closing the window, the duplicate guard), `handoff` (E4, E7, E10, E14–E16, E19), `canary` (E8, E9), `tripwire` (E11, E17, E18), `failure-matrix` (E12), `geometry` (E13), `arc` (E20–E27), `orientation` (E28) and `inpage` (E46–E66: the in-page lane from the owner's side, the entry on Instagram's sidebar, the composer and its chip, check, Test run, Share test and a real post in the frame, the frame rules and the kill switch, HEIC, Spanish, light and dark; helpers in `tests/e2e/helpers/inpage.ts`, which read instapost's closed shadow root over CDP and never give Instagram's page a user gesture during a run). After Post story no spec touches Instagram's window except where the case is about the owner (the account prompt, Stop, closing the window, a click in it, Finish by hand). A post in the mock build always ends as a Share test (its ruleset blocks the upload); "Posted" is proven on the live artifact against the fake. Playwright's own evaluate gives a page user activation, which the autopilot waits out, so specs read the Instagram window mid-run through CDP without a gesture (`quietEvaluate`). In the mock build the specs can make Chromium's windows behave like Arc's (`__e2eWindowQuirk` in the extension's storage.local: `arc`, `arcLate`, `ignoreAll`) and switch the portrait shim to read-only (`__e2ePortraitShimOff`: `true` everywhere, `"home"` everywhere but the composer, E28 e); both are compiled out of the live build, and `check:bundle` proves it. The emulated screen is landscape, as on the owner's desk, so without the portrait shim no hand-off in the suite could reach Share; every spec checks that no composer showed its rotate snackbar (except E28 b and e, which switch the shim off on purpose).

The fake has the production shape by default (strategy §11 AM35, AM37, AM42): `/create/story/` lands on `/`, the story input sits in the header beside + only while the window is at most 767 CSS px wide, + opens a two-item menu a moment later, Story starts the story session (and refuses a landscape window with the rotate toast) and clicks the story input, every page load registers a service worker that takes control of the page without handling its requests, as Instagram's does, the composer hides Share while the page reads a landscape screen orientation, and Share uploads and publishes with XHRs to Instagram's real paths, which the fake answers as its knobs say.

## The live build on your secondary account

Only after `pnpm run verify` is green, and only by hand:

1. Run `pnpm run verify`. It builds `.output/chrome-mv3-live` and proves it against the fake, including the write-block canary E9 and the one-click post E29. Do not rebuild before loading it.
2. Use a separate profile for the secondary account ("IG secondary" in Chrome, or the Arc profile of its Space). Never use your everyday profile before gate G.
3. Load `.output/chrome-mv3-live` with **Load unpacked** (`chrome://extensions` or `arc://extensions`, Developer mode on). Its name is "instapost" with a plain icon.
4. Log in to Instagram in a normal tab of that profile (never in instapost's window), then in the editor run the **setup test** (L18): everything up to Share, nothing posted; it learns the account and Instagram's + menu. There is no Rehearsal or Assisted insert switch any more: tests always block publishing, and a post is a post.
5. Work through [`docs/live-checklist.md`](docs/live-checklist.md) in order, at the pace it states: for the autopilot, L18 (setup test), L19 (one Share test), then L20 (the first one-click post); for the in-page lane (the product since v0.1.1), L30–L36 from instagram.com itself (§ "Posting from Instagram" below). Stop at any challenge, checkpoint or unexpected security email.

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

`pnpm run package [live] [--build] [--to <shared folder>] [--allow-dirty]` packages a live-key build (default: the live build, `.output/chrome-mv3-live`; `--build` rebuilds both artifacts first, `pnpm run build:all`) for use outside the Chrome Web Store:

- Only a checked, current build goes out (RS-9): the live build is refused when a build input (src/, entrypoints/, public/, wxt.config.ts, package.json) is newer than it (run with `--build`), and check-bundle (T1–T5) must pass on it. A tree with uncommitted changes is refused unless `--allow-dirty`. Any other built folder (`pnpm run package <dir> --unchecked`) cannot be checked and says so in BUILD.txt.
- It always writes `dist/instapost-<version>-<stamp>.zip` (gitignored; the stamp is the build's own time), containing the extension, `INSTALL.txt` (install steps, the browser version it needs, the account-risk and detectability notes, the shared folder's trust, what Details contain) and `BUILD.txt` (`git describe --always --dirty`, the branch, when it was built and packaged, whether check-bundle passed).
- `--to <folder>`, e.g. a shared iCloud Drive or Dropbox folder, also syncs the unpacked extension there. The recipient loads that folder once with **Load unpacked** (Developer mode). After each new `pnpm run package -- --to <folder>`, they click ↻.
- The manifest gets a `version_name` with the build stamp, so the extensions page shows which build is loaded. The key is unchanged, so the extension ID and the recipient's stored settings survive updates.
- Guarded (dev/mock) builds are refused. A folder that is not empty and was not created by the script is never wiped.

## Release

1. Set the version in `package.json` (the manifest takes it from there) and add its section to `CHANGELOG.md`.
2. `pnpm run verify` must be green.
3. Commit, then tag the commit: `git tag -a v<version> -m "instapost <version>"`. Tag before packaging, so BUILD.txt's `git describe` names the tag.
4. `pnpm run package -- --build --to <shared folder>`: rebuilds both builds, checks the live one and writes `dist/instapost-<version>-<stamp>.zip`, then syncs the shared folder. On a committed tree it needs no `--allow-dirty`.
5. Send the zip, or tell recipients the shared folder has updated (they click ↻ and reload Instagram).

## Posting from Instagram (the in-page lane)

From v0.1.1 this is how instapost is meant to be used (strategy §11 AM46–AM52). Everything happens in your own desktop Instagram tab:

1. **Open instapost.** On https://www.instagram.com/, click **New story** in Instagram's left sidebar (below Profile; a small tile when the sidebar is collapsed, a round button at the top right when the page has no sidebar). The toolbar icon and **⌥⇧S** do the same on any Instagram tab (elsewhere they open the editor tab); an Instagram tab that was open before instapost was installed or updated gets the entry without a reload (if that fails, the editor opens and says to reload the tab). The entry, its tooltip and the first-time note show the shortcut the browser actually assigned (none when another extension holds ⌥⇧S; set one at chrome://extensions/shortcuts). The first time, a small note points at the entry; Settings → On Instagram can hide the entry (toolbar and shortcut only). Instagram's login wall gets no entry; a right-to-left Instagram (Arabic, Hebrew…) gets it at the right.
2. **Make the story.** A dialog opens over Instagram, shaped like Instagram's own Create dialog. Drop a photo on it, paste one (⌘V) or **Choose photo…** (⌘O). **HEIC/HEIF** from an iPhone works too: drag it straight from Finder (AirDropped photos land in Downloads); it is converted on your Mac ("Converting HEIC…", a second or two for 12 MP). Recent photos and Continue draft come back from earlier sessions. Drag the photo, zoom, rotate, Fill or Fit; **T** adds text; **G** shows where Instagram's own buttons will sit.
3. **Post story** (⌘↵). The first time, the button reads **Run setup test**: about 20 seconds, nothing is posted; it learns which account is logged in. Then **Post story** posts: Instagram's mobile site appears as a small live phone in the dialog (Settings: Small, Large or Hidden) while instapost taps + → Story, adds your photo and presses Share once. Keep the tab in front and don't click on Instagram until Share (instapost waits while you use the page, and steps back if you keep at it). **Hide** (Esc) tucks the dialog into a chip in the sidebar that shows the progress and the result; once Share is pressed you can keep browsing. "Posted to @…'s story" comes only from Instagram's own answer; "Couldn't confirm" means check your story before posting the same photo again.
4. **Test runs.** ⋯ → **Test run** (⌥⌘↵) does everything up to Share and presses nothing; Settings → Advanced has **Check connection** (reads the account, taps nothing) and **Share test** (presses Share once with publishing blocked; once ever is enough). Tests block Instagram's upload and publish requests for that run, and need only the 60-s spacing: they don't count toward the 6-an-hour and 15-a-day post caps (AM50).
5. **If something is off**, the result says what happened and what to do; Details and Copy diagnostics carry structural facts only (your username included). A challenge or an off-Instagram page pauses desktop posting for 7 days (Resume… after you've checked Instagram on your phone).

**What it changes in your Instagram tab, and the account risk.** For the ~20 s of a run and for that tab only, instapost gives Instagram's requests from that tab an Android phone profile (your desktop page's own background requests too), removes Instagram's `X-Frame-Options` from the phone frame's page (Instagram forbids framing it) and sets `Sec-Fetch-Dest: document` on that page's request (Instagram refuses framed requests with "Sorry, this page isn't available"). All three end with the run. **Instagram can detect this**: the forged and stripped headers, the framed mobile page (Instagram's own code knows it is framed), the synthetic taps and the content script on its pages are signals no ordinary browser sends. The owner accepted these deviations knowingly (OD9, OD15); anyone using a shared build takes the same risk with their own account. Try it on a secondary account first, keep to the pace, and stop at any challenge (live checklist L30–L36, gate G before a main account).

**Sharing a build.** `pnpm run package -- --build` rebuilds both builds, checks the live one (check-bundle) and writes `dist/instapost-<version>-<stamp>.zip` with install steps and the account-risk note; `--to <shared folder>` also syncs the unpacked extension there for the recipient's **Load unpacked** ("Sharing a build with someone" above). The build carries libheif and libde265 (LGPL-3.0, AM49) with their licence texts and a notice naming their source (`licenses/` in every build; check-bundle and the package step refuse a build without them), and INSTALL.txt points to them.

**Under the hood** ([`docs/inpage.md`](docs/inpage.md) §13–§14; strategy AM46–AM48): one content script on www.instagram.com (top frame; the entry, the composer frame and, during a run, the engine frame inside one closed shadow root; it never clicks, stores or edits Instagram's page); the composer is an extension page with a dynamic URL behind its own scrim; the engine frame is `https://www.instagram.com/` at 540×960 CSS px (at DPR 2), with the portrait shim and the agent injected into that frame only; session rules 1001 (Android profile, every type but the page's own document), 1020 and 1021 for the run's tab; observational `webRequest` for the frame's kill switch. The window lane (the editor tab, its docked window) is unchanged and remains the fallback; the content script stays out of its window (`inpage/attach`); one run at a time across both lanes. Sealed tests: `pnpm exec playwright test --project=inpage` (on the mock artifact, where the Developer toggles exist) and `--project=inpage-live` (the `@live` post on the live artifact); `tests/e2e/inpage.spec.ts` drives the entry and the composer (E46–E48, E51–E53, E55, E57, E58 and E59–E66; docs/inpage.md §14).

## License

[MIT](LICENSE). Shipped builds also carry third-party notices in `licenses/` (libheif-js and its bundled libheif/libde265 are LGPL-3.0; Preact and @preact/signals are MIT; idb is ISC; the fonts are OFL).
