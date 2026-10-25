# instapost: Instagram contract

This file has three parts:

1. **Contract C1–C14** (strategy §3.9): what instapost relies on in Instagram's mobile-web story composer, how each item is probed, the evidence for it, and when it was last verified. The code is `src/core/ig-contract/contract.ts` (`CONTRACT_VERSION = 1`) for C1–C9, and the agent's locators (`src/agent/locators.ts`, `drive.ts`, `net.ts`) with `src/core/handoff/outcome.ts` and `src/core/ig-contract/account.ts` for C10–C14 (the autopilot, strategy §11 AM39–AM40).
2. **The in-page frame, C15–C16** (strategy §11 AM46–AM48, `docs/inpage.md`): what the in-page lane relies on when msite runs in a frame of the owner's desktop Instagram tab, and what it relies on in that desktop page. C1–C14 hold unchanged inside the frame. The code is `src/core/inpage/frame-verdict.ts`, `src/core/ig-contract/frame-rules.ts`, `src/inpage/driver.ts` and `src/inpage/anchor.ts`.
3. **Spike results** from strategy §8 (S3–S10): facts about the dev environment that several streams depend on.

---

## Contract C1-C14

**Status, 2026-10-15 (the in-page lane, strategy §11 AM46–AM52).** The autopilot now runs first in a phone-sized frame of the owner's desktop Instagram tab; C1–C14 are probed there exactly as in the popup (the agent and its probes are unchanged, injected with `frameIds:[engine]`). Framing itself adds C15 and C16 (§ "The in-page frame" below). Checks, test runs, a Share test and real posts worked that way in Arc on the secondary account on 2026-10-14/15 (`docs/inpage.md` §13).

**Status, 2026-10-13 (autopilot, strategy §11 AM39–AM42).** The first real post worked (L17: Arc, secondary account, H0 with the portrait shim: the owner tapped + → Story, picked the file, tapped Share). Since AM39 instapost does those taps itself, so the contract gains C10–C14: the + entry and its menu, the armed story input, the Share control, the outcome endpoints and the account link. They are read from Instagram's saved, logged-out msite bundles and spiked against the fake (§ "Autopilot spike (2026-10-13)" below); none is verified live yet (L18–L22). C6 decides nothing any more (the compose watch reads Instagram's own canvas, C12) and C9 is diagnostic (the result comes from the publish answer, C13). Since AM39 the agent also taps +, Story and Share, through one audited helper; "no clicks" in the rules below now means no clicks but those three.

**Status, 2026-10-12:** the first live hand-off ran (Arc 155, live build, new secondary account; § "First live run" below). It confirmed C1 and C2 live; C3, C4 and C5 failed there for reasons now understood (Arc ignored the window size; msite has no story input above 767 CSS px; `/create/story/` lands on `/` by design), and its facts, with those of a logged-out reading of Instagram's production code the same day (F2, F3), are in `src/core/ig-contract/baseline.json` with their `provenance`. L4 has not passed yet: `capturedAt` stays `pre-L4`. The fake's default knobs are derived from the baseline (U16) and have the production shape since strategy §11 AM35. A second run the same day (§ "Second live run" below) found that msite makes two different orientation checks, so C3 is split since AM37: **C3a** (the viewport, at + → Story) and **C3b** (the screen orientation, in the composer page), which a landscape monitor fails in any window; the portrait shim answers it.

**Rules that apply to every probe:**

- No probe matches visible text or ARIA labels. The owner may use a Spanish UI, and the fake runs `en` and `es` (E12 l, E45) with randomised class names and ids (E12 m). Since AM45 (2026-10-14) U31 enforces it on the agent's and the background's sources, and § "Instagram in Spanish" below lists every finder and why it is language-free.
- The agent reads the DOM of the composer tab from the isolated world and nothing else: no page scripts, no network, no extension storage, no clicks (T3). The one script in the page's own world is the background's portrait shim (AM37, C3b), which changes two values and reports what the page then reads; it is not a probe of the DOM.
- C1–C5 (C3b too, since AM37) and the service-worker state are judged from the probe that decided the flow. C8 is taken from a second probe once the composer is ready (§11 AM13). All of them are stored on every Handoff record as `preflight`. The settings list of the last 20 preflights (§3.9 item 1) is not built yet; the records are in IndexedDB `handoffs`.

| Id | Item | Decides | Last verified |
|---|---|---|---|
| C1 | `InstagramUserAgent.is_mobile === true` | Yes | **live, 2026-10-12** (pass); fake, 2026-10-12 |
| C2 | Logged in | Yes | **live, 2026-10-12** (pass); fake, 2026-10-12 |
| C3a (`C3`) | Portrait viewport at + → Story, and at most 767 CSS px wide (AM31) | Yes | fake, 2026-10-12; live 2026-10-12: failed in the first run (1512x902 window, AM29), **passed in the second** (503x894 fitted window: + → Story opened the chooser) |
| C3b | The composer page reads a portrait screen orientation (AM37) | Yes (`SCREEN_LANDSCAPE` on the composer) | **live, 2026-10-12: failed** (`landscape-primary` on a landscape monitor, before the shim); fake, 2026-10-12 (with and without the shim) |
| C4 | Story input | Yes | fake, 2026-10-12; live 2026-10-12: failed in the first run (no file input at 1512 CSS px, F3); in the second the H1 insert went into the header's input |
| C5 | `/create/story/` reachable directly (a fact; `homeOnly` is the norm, AM32) | Only the H0 text | fake, 2026-10-12; live 2026-10-12: `homeOnly` |
| C6 | Composer ready | No since AM39 (C12 decides) | fake, 2026-10-12 |
| C7 | Error toasts | No (diagnostics only; since AM40 a new toast after Share, and whether it has an action button, is recorded as corroboration) | not probed |
| C8 | Canvas geometry | The owner's (OD4); the code only records it | fake, 2026-10-13 (E13 through the autopilot) |
| C9 | Composer left | No since AM40 (`wentHome`, corroboration) | fake, 2026-10-13 |
| C10 | The + entry and its menu (AM39) | Yes (`STORY_ENTRY_MISSING`) | fake, 2026-10-13; code reading 2026-10-13; live: L18 |
| C11 | Story armed: the story input receives Story's click (AM39) | Yes (`LANDSCAPE` "story session refused", `STORY_ENTRY_MISSING`) | fake, 2026-10-13; live: L18 |
| C12 | The Share control (AM39) | Yes (`SHARE_MISSING`, `SCREEN_LANDSCAPE`, `INJECTION_IGNORED`) | fake, 2026-10-13; live: L18 (variant, Facebook badge) |
| C13 | The outcome endpoints (AM40) | Yes (Posted, Not posted, Couldn't confirm) | fake and spike, 2026-10-13; live: L19, L20 |
| C14 | The account link (AM39) | Yes (the account prompt) | fake, 2026-10-13; live: L18, L22 |
| C15 | Framing: msite renders, logged in and mobile, in a frame of the desktop tab, with rules 1020 and 1021 (AM46, AM47) | Yes (`FRAME_REFUSED`; then C1, C2 in the frame) | **live, Arc, 2026-10-14/15** (check, test run, Share test, posts); fake E57, E58 |
| C16 | The frame's identity: its `frameId` (webRequest) and `documentId` (the injection), and the sender's origin (AM46) | Yes (agent messages from anything else are dropped) | **live, Arc, 2026-10-14** (Arc's subframe `sender.url`); U34; fake E57 |

### C1: `is_mobile`

- **Probe (agent, `src/agent/probes.ts` `readIsMobile`).** The first `script[type="application/json"]` whose text contains `InstagramUserAgent`, parsed by `parseIsMobile` in `src/core/ig-contract/ua-json.ts` (`"is_mobile"\s*:\s*(true|false)`). Missing gives `unknown`. `contract:check` uses the same parser.
- **Decision.** `false` gives `DESKTOP_SHELL`. `unknown` passes on the first probe, but fails a re-probe after a later full-document load (AM2). A same-document load (pushState, replaceState) is not re-probed (AM16), unless it comes after a new document was detected and before that document's probe answered: it is then probed strictly too (AM28).
- **Evidence.** Research §5.1: the initial HTML embeds `InstagramUserAgent`, and curl tests showed that only the User-Agent header decides `is_mobile`. Spike S5: rule 1001 puts the Android reduced UA on the document request.
- **Verified on the fake by:** U15, B6; E4 and E5 (the composer document carried the Android profile and the page said `is_mobile: true`); E7 (a normal tab stays desktop); E12 a (service-worker-served first load), E12 k (`classifier=client-hints`), E12 s (`classifier=client-hints` with `chMode=uaOnly`: the desktop site, `DESKTOP_SHELL`); E12 w (a later full-document load served desktop, on home in H0 and after the H1 insert on the composer: the strict re-probe gives `DESKTOP_SHELL`, AM2).
- **Decision since 2026-10-12 (AM30).** `is_mobile` alone decides `DESKTOP_SHELL`; a controlled page no longer does.
- **Live:** **pass on 2026-10-12** (Arc, secondary account: `is_mobile: true` in the hard-reloaded composer). L2 (logged-out GET per UA), then L4.

### C2: logged in

- **Probe (background, `src/core/ig-contract/urls.ts` `classifyComposerUrl`).** The composer tab's URL, read from `tabs.onUpdated`, is not a login URL (`/accounts/login…`).
- **Decision.** A login URL gives `NOT_LOGGED_IN`: the window closes at once, so nobody logs in inside the spoofed tab, and there is no lock. Every other `/accounts…` path, `/auth_platform…`, `/challenge…` and `/checkpoint…` kill and lock (AM17); that holds from the first navigation on (AM20).
- **Evidence.** Research §5.4; strategy §3.6 kill-switch table.
- **Verified on the fake by:** U14, U9; E12 c (`auth=out`: closed, no lock).
- **Live:** **pass on 2026-10-12** (the secondary account, logged in on desktop instagram.com in Arc). L4.

### C3a: portrait viewport (and narrow enough)

Stored as `C3` on the preflight (the id predates the split).

- **What Instagram checks.** `startStoryCreationSession`, run by the Story tap before the file chooser opens: `innerHeight < innerWidth` gives the toast "Rotate your device to add to your story." and no chooser; otherwise a story session starts with a uuid `sessionId` (research §5.1, corrected 2026-10-12). A file put straight into the story input (the H1 insert) never runs this check, so its `sessionId` stays null.
- **Probe (agent).** `innerHeight >= innerWidth` in the composer document; since AM31 row 5 also needs `innerWidth <= 767` (`MSITE_MAX_CSS_WIDTH`).
- **Decision.** Not portrait, or wider than 767 CSS px: the window is refitted once (to at most 767 × zoom) and probed again. Still too wide gives `LAYOUT_TOO_WIDE`, still landscape `LANDSCAPE`. Before any of this, the window is fitted while it is still `about:blank` (AM29: settle, measure, update with `state:'normal'`, re-applied at 0/150/300/500/1000 ms while not fitted, verified, held 1.1 s, one retry), or the owner resizes it by hand (`resizing`, else `WINDOW_NOT_FITTED`).
- **Evidence.** Research §1 item 2: the composer shows "Rotate your device to add to your story." in a landscape viewport. The fake has the same guard and toast. F3 (2026-10-12): msite has no + → Story above 767 CSS px. F1 (2026-10-12, owner's console in Arc): `windows.create` ignored a popup's bounds (1512x949 at (1831,13), tab 1512x902); `windows.update` with `state:'normal'` 500 ms later was honoured (524x1012, tab 524x965, frame 0x47); the product's update without a state ~280 ms after the create was not.
- **Verified on the fake by:** U9, U11, U13; E13 (a popup forced to 960x600 is refitted exactly once, back to 511x941 outer, and the second probe is portrait); E20 (Arc-like windows, fitted before Instagram loads), E21/E22 (guided resize, `WINDOW_NOT_FITTED`), E24 (900 px wide portrait: refit, or `LAYOUT_TOO_WIDE`), E26 (the owner's two displays).
- **Fake (AM37).** + → Story checks `innerHeight < innerWidth` and shows the rotate toast without a chooser (E28 d); a file in the header input has no orientation check; the story records `sessionStarted` and `sessionId`.
- **Live:** **failed on 2026-10-12** in the first run (Arc: 1512x902, landscape, the create's bounds ignored; the fix is AM29); **passed** in the second run the same day (503x894 fitted portrait window: + → Story opened the chooser). L4, L5, L14.

### C3b: the composer page reads a portrait screen (AM37)

- **What Instagram checks.** `PolarisStoryCreationPage` takes `isLandscape` from `usePolarisDisplayProperties`: `screen.orientation.type` (or the `moz`/`ms` variants), else `window.orientation` (±90 → landscape), else the viewport (`width > height`); read when the composer page mounts with the photo and again on every `resize`. Landscape renders a snackbar with "Rotate your device to add to your story." instead of the composer's header and its Share footer (research §5.2). A desktop with a landscape monitor reads `landscape-primary` whatever the window, so this check fails in every fitted window without help.
- **The portrait shim** (`src/agent/portrait-shim.ts`, strategy §11 AM37). The background runs it with `scripting.executeScript({target:{tabId: composerTab, frameIds:[0]}, world:'MAIN', injectImmediately:true, func, args:[install]})` just before the agent, on every document of the composer tab after the hard reload (so before the composer page can mount), and nowhere else. When `screen.orientation` exists and its type does not start with `portrait`, it defines own getters on that ScreenOrientation instance: `type` → `portrait-primary`, `angle` → 0. It dispatches nothing and leaves the prototype, `screen.width/height`, `matchMedia`, `window.orientation` and everything else alone; a second injection into the same document finds its marker and changes nothing.
- **Probe (background).** The shim's own result, the type the page reads afterwards and the shim's state (`installed`, `present`, `portrait`, `absent`, `failed`, or `off` with a guarded build's E2E flag), validated as untrusted page data and stamped on the agent's report as `orientation` (the isolated world cannot see the page's getters, and anything the agent sends there is dropped). Pass when the type is not `landscape-…`; with `absent` (no `screen.orientation`, type null) Instagram falls back to `window.orientation`, absent on desktop, and then to the portrait viewport, so that passes too. **Fail** when the type is `landscape-…`, or (AM38, SH-1) when the shim installed itself only at the injection after a commit had reached the composer (`afterComposerMount`, set by the background: the composer mounted and read the landscape screen first, and re-reads it only on `resize`). **`unknown`** without a reading, or (AM38, SH-2) with an unreadable one, `{type: null, shim: 'failed'}`: the shim threw in the page or its result was malformed, and the page's own type, landscape on the owner's monitors, still exists.
- **Decision.** Once the composer is reached (`/create/story…`, by a probe there or by the same-document load of the pick's or the insert's SPA navigation) and the page may still read a landscape screen there: `SCREEN_LANDSCAPE` (close, no lock). "May" is a landscape type (detail `screen <type>, portrait shim <state>`), an unreadable reading (`screen unknown, portrait shim failed`, SH-2), or a shim that came after the composer mounted (`screen portrait-primary, portrait shim installed after the composer mounted`, SH-1: the pick's SPA navigation when home read a portrait screen and the screen turned landscape, or a pick made before the reloaded home's first `complete`; the reload's own commit to `/create/story/` never counts). On home it is recorded only (the composer is not mounted there). The panel's Screen row shows the reading.
- **Blind spot (AM38, SH-3).** C3b observes the page's own `screen.orientation.type` and nothing else. If Instagram read the screen another way (the ScreenOrientation prototype getter, `screen.width > screen.height`, a device-aspect media query), the composer would show its snackbar again while C3b records `pass`; there is no `SCREEN_LANDSCAPE` then, and the panel waits for a Share that cannot come until Cancel or the 15-minute `TIMEOUT`. The owner's eyes and L16/L17 catch it.
- **What remains detectable.** Own `type`/`angle` descriptors on the instance (the native ones live on the prototype), getters that are not native code, a type that disagrees with `screen.width > screen.height` and with the prototype's getter, and the marker on the getter. One more JS-visible inconsistency of the spoofed session, scoped to the composer tab (strategy §2.3).
- **Verified by:** the browser test of the shim (installs once, only on a landscape screen, prototype and the rest untouched, no event; SH-2: a throwing page global or getter reads `failed`, never an exception); check-bundle T3 (SH-2: the shim cut out of the built `background.js` gives every expected reading in a bare `node:vm` realm, so it is self-contained); U9 (row 5b and the reducer, H0 and H1; SH-1 (a) and (b), SH-2); U11 (the injection: MAIN world, the composer tab's frame 0, before the agent, on every new document, read only with the E2E flag in guarded builds only, or only off the composer with `"home"`); E28 (a) (H1 on the emulated landscape screen: the page reads `portrait-primary`, Share, posted), E28 (b) (mock with the shim off: snackbar, no Share, `SCREEN_LANDSCAPE`; live ignores the flag), E28 (c) (H0 by + → Story: session started, posted), E28 (e) (mock, the shim only on the composer: snackbar, `SCREEN_LANDSCAPE` "after the composer mounted", C3b fail); every E2E that reaches the composer (the fixtures' invariant: no composer showed its snackbar).
- **Live:** **failed on 2026-10-12** before the shim (Arc, owner, test account: window fitted 503x894 @2x portrait, `matchMedia('(orientation: landscape)')` false, `screen.orientation.type` `landscape-primary`; snackbar instead of Share after the H1 insert and after + → Story → pick by hand). With the shim: L16, L17.

### C4: story input

- **Probe (agent, `findStoryInput`).** An `input[type=file]` whose `accept` list, split on commas and trimmed, set-equals `{image/avif, image/jpeg, image/png}`. An input whose list names only image types is a candidate; the post input never counts: its list is `image/jpeg` in the 2026-10-13 bundles (`PolarisMobileCreationNavItem`; earlier readings had video types), which is not the story set (`POST_ACCEPT` in contract.ts).
- **Decision.** No candidate gives `INPUT_MISSING`, and a candidate with another list gives `ACCEPT_DRIFT`. ~~Both degrade to H0 in the same window~~ Since AM39 nothing is tapped or inserted; a post keeps the window 60 s for Finish by hand, a test closes it. Since AM39 the story input is also how C10 finds the + entry.
- **Evidence.** Research §5.5 and §2 fn 5: a hidden `<input type=file accept="image/avif,image/jpeg,image/png">`. Spike S7: inserting through `DataTransfer` plus a synthetic `change` fires React 19's `onChange` (AM3).
- **Where (F3, 2026-10-12, AM32).** The story input is the hidden `<input type=file accept="image/avif,image/jpeg,image/png">` of PolarisImageFileForm beside the header's + / Story entry, on `/` too, present whenever that entry is rendered: only at ≤ 767 CSS px. It may mount after hydration, so the first probe that reaches C4 and finds none waits once, up to 6 s, for the agent's `input-appeared`, then probes again: in a post (H1 or H0) and in probe mode alike (AM36), so C4 is never read from a snapshot taken before hydration; a session that ends during the wait records C4 `unknown`. Inserting into it (or picking a file) starts msite's story session and SPA-navigates to `/create/story/` with the composer.
- **Recorded as.** `unknown` when the decision stopped before C4 (guard, login, desktop site, interception, layout rows), with the panel's "(not checked: stopped before this step)"; the panel's Story input row is `storyInputText()` (AM33).
- **Verified on the fake by:** B6 (the story input is chosen and the post input ignored); E5 (H1 insert into the header input, then the SPA navigation); E25 (the input mounts 1.5 s after the page: the wait catches it); E4 (b) (probe mode, the header mounting 2.5 s late: `present`, C4 pass); E6 (H0 from home); E12 h (`input=afterTap`, after the wait), E12 j (`accept=changed`); E12 f and g (an ignored insert degrades to H0 with exactly one inject); E24 (no file input at all in the wide layout).
- **Live:** **failed on 2026-10-12** at 1512 CSS px (no file input on the page, `acceptSeen: []`), which F3 explains; the panel's "absent (accept list changed)" was wrong (AM33). L4/L14 (presence beside + at ≤ 767 px), L15 (the H0 pick), L6 (whether an `isTrusted:false` insert is accepted). A `none …` there after the 6 s wait is inconclusive until L15 shows by hand whether + → Story has the input.

### C5: `/create/story/` reachable directly

- **Probe (background).** The tab's URL at the first `complete` after the hard reload. `/create/story…` is `direct`; anywhere else on www is `homeOnly`.
- **Decision (since 2026-10-12, AM32).** C5 records a fact and decides nothing: `/create/story/` without media lands on `/` (`homeOnly`, `fail`), which is **Instagram's normal outcome, not drift** (F3). On `/` the header's story input is used: H1 inserts into it, H0's text says "Instagram opened its home page, as it usually does. In the Instagram window tap + → Story, then pick …". Leaving for `/` is not C9 until the composer is engaged (AM18), and an insert made on home engages it only once the tab shows `/create/story`. Any other www page is `UNEXPECTED_PAGE` (AM17).
- **Evidence.** Research §5.2: the route is `/create/story/`. F3 (logged-out code reading, 2026-10-12) and the first live run (route `homeOnly`): it lands on `/` without media.
- **Verified on the fake by:** U9; E4, E5, E6, E25 (`homeOnly`, the default since AM35); E12 i (`route=direct`, the old assumption: C5 passes, "tap + → Story and pick").
- **Caveat found by E12 a.** When a service worker answers the first composer load with a desktop-UA fetch and the server redirects that request to `/`, the redirect commits before the hard reload runs. The reload then reloads `/`. Since F3 that is where the route lands anyway; E12 a pins it with the hypothetical worker. Whether a desktop `/create/story/` 302s home at all is the fake's `desktopComposer` knob (unverified, L4).
- **Live:** **`homeOnly` on 2026-10-12** (as F3 says). L4.

### C6: composer ready

**Since AM39 C6 decides nothing.** The autopilot's compose watch (C12) reads Instagram's own composer canvas (`canvas._aa3c`, drawn = a backing store), so a small fixed canvas (`cssFixed:360x640`, under half of the default window) no longer stalls the run (E13 runs it in the default window). The text below is the H0/H1 era's.

- **Probe (agent watch, `isComposerReady`, every 250 ms).** A visible `<canvas>` with a backing size greater than 0 whose CSS area inside the viewport is at least 50% of the viewport (`C6_MIN_VIEWPORT_AREA`).
- **Decision.** It moves H1 and H0 to `awaitingShare`. In H1, no C6 within 10 s of the insert gives `INJECTION_IGNORED`, and the session degrades to H0. AM28: the agent tells the two cases apart: `inject-unconfirmed` when the insert was dispatched (the photo may be in the composer), `inject-ignored` when it could not be made. After `inject-unconfirmed`, leaving the composer is C9 with no pre-answer (see C9). AM24: only a canvas that was not already ready when the watch first started in that document counts, H1 reports it only after the insert, and the background accepts it in `injecting` only once the file was served, so a pre-existing canvas (a camera preview) never passes for an inserted photo.
- **Evidence.** Research §2 fn 7: the composer draws the cover-cropped photo into a canvas.
- **Verified on the fake by:** B6; E5, E6, E12; E13 for all four geometry models.
- **Known limit.** A canvas with a fixed CSS size can cover less than half of a large popup: `cssFixed:360x640` covers 49.6% of the default 511x909 popup, so C6 never holds there. E13 runs that model in a 450x800 popup (`composerProfile`). If L5 finds a small fixed composer canvas, the threshold or the window fit needs a decision.
- **Live:** L5, L6.

### C7: error toasts

- **Probe.** None. Toasts depend on visible text, so C7 is diagnostics only and never drives a decision. The agent does not read toasts in v1.
- **Evidence.** Research §1 item 2 and §2 fn 6 quote the composer's toasts (portrait guard, photo only).
- **Live:** L5 and L7 note any toast by hand.

### C8: canvas geometry

- **Probe (agent `probeComposer`).** For the largest visible canvas: `canvas.width/height`, `getBoundingClientRect()`, `devicePixelRatio` and `innerWidth/innerHeight`. There are no pixel reads, so taint and WebGL do not matter.
- **When (§11 AM13).** Entering `awaitingShare` (C6 holds) sends one more `agent/probe`. Its report is accepted in `awaitingShare` only to record C8, as the record's `readyProbe` and `preflight.C8`; it never re-evaluates the flow. A probe-mode run has no file, so its C8 has the inner size and DPR but no canvas.
- **Evidence.** Research §5.2 and Q4: the canvas follows the viewport × DPR, or the source size (A6). Strategy §1 item 11 and S8: on the owner's MacBook the popup is 511x909 CSS px, so a viewport × DPR canvas would be 1022x1816, a 5.3% downscale.
- **Verified on the fake by:** B6 (the read equals `dataset.fakeGeometry`); E13: the record's C8 equals the fake's ground truth for `viewportDpr` (1022x1816 in 511x908 CSS px), `source` and `fixed:1080x1920` (1080x1920), and `cssFixed:360x640` (720x1280 in 360x640 CSS px at x 45, y 80 of a 450x800 popup).
- **Live:** L5 (measured without Share, at two popup sizes), then OD4.

### C9: composer left

**Since AM40 C9 is diagnostic.** Going home after Share is recorded on the evidence (`ui.wentHomeAt`) and only corroborates; Posted needs C13's publish answer (Instagram goes home on any 2xx, so going home adds no protection). A Posted run closes 2 s after Instagram went home, else 8 s after the confirmation. The text below is the H0/H1 era's ("Posted?" is gone).

- **Probe.** Background: the tab's URL leaves `/create/story` after having been on it (`urls.ts`, `composer-left`). Agent: the path leaves `/create/story`, or the C6 canvas has been gone for more than 2 s (`C9_CANVAS_GONE_MS`).
- **Decision.** Once the composer is engaged (AM18: C6 seen, the H1 file served, or, AM28, an insert dispatched that C6 never confirmed), the session finishes. The editor asks "Posted?", pre-answered "posted" when C9 followed `awaitingShare`; the record is written. The window closes 3 s later, except after Share in a post with rehearsal off, where it stays open until the owner answers (AM19), so an upload that is still running in the page is never cut off. Only `/` counts as "composer left" (AM17); any other www page ends it with `UNEXPECTED_PAGE`, naming the page (AM28). With no Share detected but one possible (an unknown page after Share, or C9 after an unconfirmed insert), "Posted?" has no pre-answer (`postedUnknown`), and after an unconfirmed insert the popup is held open whatever rehearsal says (AM28). Engagement belongs to one document: once a later load is known to be a new document, a Share or insert made in the old one no longer counts (AM28). The agent's watch keeps running after a `composer-left`.
- **Evidence.** None from research yet: where the real composer goes after Share is (unverified). The URL rule and the canvas rule are both structural, so either a navigation or the composer unmounting counts. The fake navigates in-page to `/`.
- **Verified on the fake by:** U9, U14; E5, E6, E8, E9, E11 and E12 f–j, l, m (Share, then the in-page navigation to `/`, then `posted-confirmed`); E12 r (`share=background`: an upload that runs after the composer went home lands only because the popup is held open, AM19); E12 v (`geometry=cssFixed:360x640`: C6 never confirms the insert, Share from H0 is C9 with no pre-answer, held open, AM28).
- **Live:** L8 (the first real post): whether the composer goes to `/` after Share, and whether the upload finishes before or after that.

### C10: the + entry and its menu (AM39)

- **What Instagram renders (code reading 2026-10-13, `PolarisMobileCreationNavItem`).** In msite's mobile header (≤ 767 CSS px): a box holding the popover trigger, a link `a[href="#"][role=link][tabindex=0]._a6hd` with an svg (its `aria-label` is Instagram's "Home" string, by a bug of theirs, so it is never used), and the next box holding two `form[role=presentation][method=POST][enctype=multipart/form-data]`: the story form (`accept="image/avif,image/jpeg,image/png"`, C4) and the post form (`accept="image/jpeg"`). A tap of + lazily loads the menu popover (`PolarisMobileCreationMenuPopover`, not readable logged out) with the two actions it is given: Story (`handleCameraIconClick`) and Post (`handlePostIconClick`).
- **Probe (agent, `findEntry`, `pressables`, `newDialogs`, `glyphHash`).** From the story input up to 4 ancestors: the previous sibling box holding exactly one pressable (`button, [role=button], a[href], [role=link], [role=menuitem]`) that contains an svg. After the tap of +: a new visible `[role=dialog]` within 6 s (one re-tap of + if none appeared), with exactly two outermost pressables. The Story item is the stored fingerprint's index when the count and the glyph hash (fnv1a over the svg's viewBox and shapes) match, else item 0 by trial; a wrong item only clicks the post input (no chooser without activation), then + again and the other item, once.
- **Decision.** No entry, no menu, a third item (never tapped), neither item arming the story input, or a tap the helper refused: `STORY_ENTRY_MISSING` with that detail (`no + entry beside the story input`, `no menu after +`, `menu 3 items`, `neither menu item started a story`, `tap refused`). The tap helper taps + and Story only on `/`. The fingerprint is stored (`menuFingerprint`) when an armed run learned it.
- **Verified on the fake by:** U29, B11; E29 (both orders), E30, E33 (`trusted=require`, `menuItems=3`, the trial and the fingerprint), E12 i (`route=direct`: + is not tapped off home).
- **Live:** L18 (count, order, Story index, glyph hash, tag and role of the items), L21 (Spanish: the same facts, the same glyph hash; § "Instagram in Spanish").

### C11: Story armed (AM39)

- **What Instagram does.** The Story item runs `handleStoryCreationClick`: `onStartStoryCreation(entryPoint).then(() => selectFile())`. `startStoryCreationSession` checks `innerHeight < innerWidth` (C3a: a "Rotate your device" toast and nothing else) and otherwise dispatches `STORY_CREATION_SESSION_STARTED` with a uuid `sessionId`; `selectFile` clears the story input and calls its `click()`. Without user activation Chrome refuses the chooser (a console warning only). `onFileChange` → `storyCreationSelectMedia` → `readImageFile` → `STORY_CREATION_IMAGE_PROCESSED` → `browserHistory.push('/create/story/')`.
- **Probe (agent, `observeClick`).** One capture-phase `click` listener on the story input (and one on the post input) while Story is tapped: armed when the story input receives the click within 3 s. Then the insert (AM3) into that input only.
- **Decision.** No click on either input in a landscape viewport: `LANDSCAPE` ("story session refused"); otherwise `STORY_ENTRY_MISSING` (`story input not armed`). Within about 5 s of a real click in the window the same path would open the OS chooser, so every tap first waits for `navigator.userActivation.isActive` to be false (6 s, else `WINDOW_IN_USE`).
- **Evidence.** Code reading 2026-10-13; the autopilot spike (the chooser was refused without activation; the story session started with a uuid; its telemetry had an `enter` event and a non-empty `waterfall_id`, where the H1 insert of AM37 had none).
- **Verified on the fake by:** B11, B14; E29 (`sessionStarted`, uuid, `waterfall_id`), E28 (d) (C3a: `LANDSCAPE`), E34 (no file chooser after the owner's click).
- **Live:** L18 (no chooser opened; armed time).

### C12: the Share control (AM39)

- **What Instagram renders (`PolarisStoryImageCreationContainer`, `PolarisStoryCreationShareFooter`, `…V2`).** `canvas._aa3c` (0×0 until the photo is drawn), `header._aa3d` (Close `._aa3e`; `._aa3f` with Save `._aa3g`, text `._aa3i`, draw `._aa3j`), the landscape snackbar `._aa3b` instead of header and footer (C3b), and the Share footer: ShareFooter (`footer` → one `button`) while the account has no Facebook destination, ShareFooterV2 (`footer` → one `[role=button]` with the avatar, and a badge svg when Instagram cross-posts to Facebook automatically) once its GraphQL answer says so, which can switch v1 → v2 after the composer appeared. A trash footer (`footer._aa3k`) shows only while a sticker moves.
- **Probe (agent, `composerState`, `watchCompose`).** On `/create/story`: the named canvas (else the largest visible one) with a backing store, the snackbar, exactly one visible footer (not `_aa3k`) with pressables, its controls (`button` or `[role=button]`), the variant and the badge; the footer quiet for 1.5 s (cap 8 s from the first footer; deadline 20 s). Each class has a structural fallback (E12 m, `drift=renamed`).
- **Decision.** Not drawn: `INJECTION_IGNORED` ("composer not drawn"); the snackbar: `SCREEN_LANDSCAPE`; not exactly one control: `SHARE_MISSING` (nothing pressed; Share it myself). Share is tapped once, after re-checking all of it and the page's activation and visibility.
- **Verified on the fake by:** U29, B13; E29, E35 (`fb=auto` after a delay: v2, the badge, `share_to_facebook=true`; `shareControl=missing|two`), E12 m.
- **Live:** L18 (variant and badge), L20.

### C13: the outcome endpoints (AM40)

- **What Instagram sends after Share (`PolarisStoryCreationActions.uploadStory`).** `UPLOAD_REQUESTED`; the photo upload `POST https://i.instagram.com/rupload_igphoto/fb_uploader_<id>` (XHR, credentials, no timeout, no retry); only after a 2xx, the publish `POST /api/v1/media/configure_to_story/` on www (XHR, form body, 60 s timeout), whose any 2xx Instagram's client treats as success. Success: a toast ("…added to …", or "…and Facebook"), the tray refresh (`POST /graphql/query`), `pushState('/')`. Failure: the "Upload failed." toast with Retry, no navigation. Never settles: `feedback_required` (a dialog), 401 `require_login` (to the login page), a `checkpoint_url` (a full navigation; the kill switch acts).
- **Probe (agent, `net.ts`).** A `PerformanceObserver({type:'resource', buffered:true})` from the agent's start (Instagram clears its own resource-timing buffer, so polling would miss entries): every XHR/fetch entry that ends after the Share click, as host (`www`, `i`, `other`), pathname without the query (≤ 200 characters), `responseStatus` (0 for blocked, failed, opaque or CORS-refused), `contentType` (≤ 64), redirected, start and end relative to the click, in 250 ms batches with a heartbeat.
- **Decision (background, `outcome.ts` `decide()`, O1–O10, strategy AM40).** Posted only on a publish 2xx with a JSON content type, not redirected.
- **Evidence.** The saved bundles; the autopilot spike: `responseStatus` and `contentType` readable from the isolated world in CfT 155 and Chromium 156, cross-origin when CORS passes; a dNR block reads as status 0; a credentialed CORS preflight needs the requested headers echoed (`*` fails).
- **Verified on the fake by:** U18, B12; E29, E31, E32 (400, 500, reset, html200, redirectLogin, rupload 500 and cors, `tray=throw`), E37 (`rtClear=on` during a slow upload), E38, E11 (`DUPLICATE_UPLOAD`).
- **Live:** L19 (the blocked upload, status 0, the failure toast), L20 (the publish answer's status and type; whether the upload's 200 is readable through CORS).

### C14: the account link (AM39)

- **What Instagram renders (`PolarisProfileNavItem`).** One navigation link to `/<username>/` holding the avatar.
- **Probe (agent, `readAccount`).** Links to `/<handle>/` (relative or on www) holding an img or svg, outside `article` (feed authors), those inside a navigation landmark preferred; one distinct handle is the account, none or several is unreadable. Handles match `^[A-Za-z0-9._]{1,30}$` and reserved first segments (`explore`, `accounts`, `stories`, …) are rejected. The first probe waits once (P5) for a link that mounts after hydration.
- **Decision.** Compared with `expectedAccount` before any tap: a mismatch, an unreadable account or no expected account asks (§4.8 of `docs/ux.md`), unless "Only post as" is off; a Test run or a check learns it.
- **Verified on the fake by:** U25, U29; E4 (learned by a check), E30 (learned by the setup test), E36 (mismatch, unreadable, timeout), E7, E15, E16, E19 (the prompt holds a run on home).
- **Live:** L18 (exactly one candidate), L22 (another account logged in).

### Instagram in Spanish (AM45, live checklist L21)

**Audit, 2026-10-14.** Every finder the autopilot and the background use to decide, with what it reads. None reads Instagram's visible text, an ARIA label, an alt text, a title or the page's language, so none needed an English+Spanish fallback and none was added. U31 (`src/agent/no-text.test.ts`) scans `src/agent`, `src/core/handoff`, `src/core/ig-contract` and `src/handoff` for those reads and fails on a new one; B15 runs the whole chain against the msite fixture with English and Spanish words and labels; E12 (l) and E45 run it against the fake in `es`.

| What | Code | Reads | Language |
|---|---|---|---|
| C1 `is_mobile` | `probes.ts` `readIsMobile` | the JSON text of `script[type="application/json"]` holding `InstagramUserAgent` | a data blob; its keys and booleans are not localised (one of U31's two allowed text reads) |
| C2 login, the kill switch, `UNEXPECTED_PAGE` | `urls.ts` `classifyComposerUrl` (background) | the tab's URL path | paths are not localised (`/accounts/login/`, `/challenge/`, …) |
| C3a/C3b | `probes.ts`, the portrait shim | `innerWidth/innerHeight`, `screen.orientation.type` | none |
| C4 story input | `probes.ts` `findStoryInput` | `input[type=file]` and its `accept` list | MIME types |
| C6/C8 canvas | `probes.ts` `largestCanvas`, `readyCanvases` | `<canvas>` geometry and backing size | none |
| C10 the + entry | `locators.ts` `findEntry`, `pressables` | from the story input's `form`, the previous sibling box's one pressable (`button, [role=button], a[href], [role=link], [role=menuitem]`) holding an svg | roles and tags; the +'s aria-label (Instagram's Home string: "Home", "Inicio") is never read |
| C10 the menu | `locators.ts` `newDialogs`, `pressables`, `glyphHash` | a new visible `[role=dialog]`, its outermost pressables (exactly two), each item's svg shape data (fnv1a) | the items' labels ("Story"/"Historia", "Post"/"Publicación") are never read; the glyph hash and the stored fingerprint are the same in every language (B15) |
| C11 armed | `tap.ts` `observeClick` | a capture `click` on the story input (or the post input) | none |
| C12 composer and Share | `locators.ts` `composerState` | `canvas._aa3c` (else the largest canvas), `header._aa3d` (else a visible header), the snackbar `._aa3b`, visible `footer`s but `_aa3k`, their `button`/`[role=button]` controls, an svg badge | class names and roles; the footer's text ("Your story"/"Tu historia") and the snackbar's ("Rotate your device…") are never read |
| C13 outcome | `net.ts` (agent), `outcome.ts` `decide()` (background) | resource timing: host class, pathname, `responseStatus`, `contentType`, redirected | none |
| C7 corroboration | `locators.ts` `newToast`, `progressShown` | a new visible `[role=alert]` and whether it holds a button; `[role=progressbar]` | roles only; the toast's text ("Upload failed."/"Error al subir.") is never read |
| C14 account | `locators.ts` `readAccount`, `profileHandle`; `account.ts` | links to `/<handle>/` holding an img or svg, outside `article`, inside a navigation landmark preferred | the path; Instagram's routes (`explore`, `accounts`, …) are not localised |
| Diagnostics | `probes.ts` `probeComposer` | `<html lang>` (≤ 64 characters) | recorded on the probe (`probe.lang`: `en`, `es`) and in Details; nothing decides on it (U31's other allowed read) |

**Unverified until L21.** The fake's Spanish strings are plausible renderings, not Instagram's (no Spanish Instagram page has been loaded: the saved bundles are logged-out English). What L21 can still find is a structural difference in Instagram's Spanish build (a third menu item, another footer), which would fail closed with the same codes as in English (`STORY_ENTRY_MISSING`, `SHARE_MISSING`).

**In-page lane (AM46).** The in-page decision code reads no text either: the entry's anchor (`src/inpage/anchor.ts`) finds Instagram's desktop navigation by its links' paths (`/`, `/explore/`, `/reels/`, `/direct/inbox/`, `/<handle>/`), the svg or img they hold and their geometry; the labels ("Profile"/"Perfil", "More"/"Más") are never read (U35 runs it with Spanish labels and random class names). The frame's kill switch reads URLs and paths (`frame-verdict.ts`). U31 scans `src/core/inpage`, the driver, the frame watch, the anchor and the in-page background.

### Also probed on every hand-off

These are not C items, but the same probe reports them:

- **Screen orientation (AM37).** The portrait shim's reading for the current document (C3b), on every report as `orientation` and in the panel's Screen row.
- **Fake marker (SG4).** `<meta name="instapost-fake-instagram">`. In a guarded build, a missing marker gives `GUARD_NOT_FAKE` (E10). In live, a present marker shows the FAKE INSTAGRAM banner (E5, E10).
- **Service worker (since 2026-10-12, AM30).** `navigator.serviceWorker.controller !== null` from the isolated world is **diagnostics only**: Instagram re-registers its root worker on every logged-in load at `/www-service-worker.js?s=push&__d=www&enableAddToHomeScreen=<is_mobile>&zenon_device_id=<id>`, the new worker calls `skipWaiting()` and `clients.claim()`, and so it controls the composer within about a second on every hand-off (F2; the live run saw `swControlled: true`). A `controllerchange` is counted on the record (`swControllerChanges`); `SW_TOOK_CONTROL` is no longer emitted. The worker has **no fetch handler**, so the page's requests stay tab-attributed and rule 1001 applies. What is fatal is **interception**: a www/i.instagram.com `PerformanceResourceTiming` with `workerStart > 0`, or the navigation entry's when it was not a `reload`, gives `SW_INTERCEPTS` (close, no lock), from the probe (`swIntercepted`, `navType`) or from the agent's watch (a scan every 250 ms plus a `PerformanceObserver`, because a page's resource-timing buffer stops at 250 entries). Blind spot: a cross-origin entry without `Timing-Allow-Origin` reports `workerStart` 0. Verified in Chromium (browser test: 0 without a fetch handler, > 0 with one) and on the fake: E23 (the default claim-on-register worker: controlled, `workerStart` 0 on every www request, counted, posted), E12 a/a2 (the hypothetical `desktopShell` worker with a fetch handler: `SW_INTERCEPTS`), E12 b (`claimLate`: counted, posted). Rule 1001 stays tab-only (`uaRule` throws for tab −1); the rehearsal rules keep `[tab, -1]`.

---

## The in-page frame (C15–C16; strategy §11 AM46–AM48)

**Status, 2026-10-15.** Facts F4–F9 come from logged-out header checks and a reading of Instagram's saved msite bundle (2026-10-14, `docs/inpage.md` §2.1); spike S12 checked the framing rules in the sealed browser (`docs/inpage.md` §13.2); the owner's live runs in Arc (2026-10-14/15) found the two facts no logged-out check could: Instagram refuses a framed request, and Arc's subframe senders. Nothing here reads Instagram's text.

### C15: framing (AM46, AM47)

- **What Instagram sends** (F4–F6, logged-out, 2026-10-14). `https://www.instagram.com/` answers **`X-Frame-Options: DENY`** to the desktop UA and to the Android UA alike. Its `Content-Security-Policy` lists `*.instagram.com` in `frame-src` and `child-src` (so the desktop page may frame www) and has **no `frame-ancestors`**, so XFO alone forbids the frame. `Cross-Origin-Opener-Policy: same-origin-allow-popups` applies to top-level documents only. Rule 1020 removes XFO from www `sub_frame` responses in the run's tab; without it Chromium refuses the frame (S12 on Chromium 156 and CfT 155: E58).
- **What Instagram does with a framed request** (owner, live in Arc, 2026-10-14). The browser sends the engine frame's document request with `Sec-Fetch-Dest: iframe` (and `Sec-Fetch-Mode: navigate`, `Sec-Fetch-Site: same-origin`, `Referer: https://www.instagram.com/` with `referrerpolicy="origin"`). With that, and XFO already removed, Instagram served its **"Sorry, this page isn't available"** page in the frame instead of msite. With rule 1021 setting `Sec-Fetch-Dest: document` on that request, Instagram served msite, logged in and mobile (C1, C2 in the frame), and checks, test runs, a Share test and real posts worked. The other fetch-metadata headers, `Origin`, the Referer and cookies are left as the browser sends them. What Instagram's server makes of the resulting combination is unknown (strategy R23).
- **msite's own code** (F7–F9, the saved bundle). **F7** no frame-busting (no `top !== self` redirect, no `frameElement` check, no clickjacking guard). **F8** on a failed non-GET request that answers with a JSON `checkpoint_url` or `redirect_url`, msite sets **`window.top.location.href`**: in a frame, a checkpoint takes over the owner's desktop page. The frame is therefore not sandboxed, and the page's own URL is watched during a run (`pageUrlVerdict`: a security page kills and locks, a login stops, another host is `PAGE_LEFT`). **F9** msite is frame-aware: it checks `window.top === window` in 7 places and, framed, skips its time-spent logging, `WebSession` extension, `getInstalledRelatedApps` and a cookie-store helper; it reuses the desktop page's sessionStorage logging id (`ht_persistent_session_id`, seen in S12).
- **Probe** (`frame-verdict.ts` `frameLoadVerdict`, in this order): an off-host redirect of the document → `KILLED_OFFHOST` (lock); a security page → `KILLED_CHALLENGE` (lock); a login page → `NOT_LOGGED_IN`; then `FRAME_REFUSED` (no lock) for a network error, a 4xx/5xx document, a `load` whose document the content script cannot read (Chromium's error page is cross-origin), or no load within 30 s; else the agent's probe decides C1–C5 in the frame. **webRequest does not see a refusal** (S12): for a refused frame it reports `onCompleted` 200 without an error, and `onHeadersReceived` shows `X-Frame-Options: DENY` whether or not 1020 removed it (webRequest sees the response before dNR's change), so the record's `xfoSeen: DENY` is expected either way. Later frame URLs (webRequest navigations, the content script's 250-ms path reads: msite moves by pushState) go through the window lane's `classifyComposerUrl`.
- **The frame's size.** `frameBox(dpr)`: W = min(720, ⌊1080 ÷ DPR⌋), even, at least 320; H = W × 16 ÷ 9 (540×960 at DPR 2, 720×1280 at DPR 1). W ≤ 767 keeps msite's mobile header (F3, C3a); the composer's canvas follows the viewport model (C8: 1080×1920 at DPR 2 on the fake). The owner sees it scaled down by a CSS transform, which changes neither the viewport, the DPR nor the canvas.
- **Decision.** `FRAME_REFUSED` ends the run without a lock (the window lane remains); `DESKTOP_SHELL` and `NOT_LOGGED_IN` as in the popup. **"Page isn't available"** (strategy AM53): Instagram's error page for a framed request is msite's shell (logged in, mobile, and as far as the fake knows HTTP 200) with no header and no navigation, so the frame loads and reads as Instagram; after the probe's one wait, a frame with neither the story input nor the account link is not msite's home, and the driver stops with `FRAME_REFUSED` (detail `page unavailable`) in every mode, before any tap (U36, E62). Structural: nothing reads its text.
- **Verified:** live in Arc 2026-10-14/15 (L25, L26 on the spike; the prototype's posts); fake E57 (served), E58 (1020 off → refused), E62 (1021 off → "page isn't available" → `FRAME_REFUSED`; with 1021 the check passes), E47 (the frame's kill switch), E53 (F8), E63 (a post on the live build). The fake answers a framed document as Instagram did (`framed=unavailable`, baseline `framedDocument`). **If Instagram adds `frame-ancestors`** or refuses framed documents another way, the lane fails closed with `FRAME_REFUSED` (R27); CSP is never stripped.

### C16: the frame's identity (AM46)

- **frameId.** The engine frame's id comes from `webRequest.onBeforeRequest` for the run tab's www `sub_frame` document (the content script creates the frame right after the rules are in); `scripting.executeScript` and `tabs.sendMessage` accept it (S12). Only one www sub_frame is expected in the tab (N9: desktop Instagram embeds none of its own; the record counts any other as `otherSubFrames`).
- **documentId.** The agent's injection result names the frame's document; from then on only that document may speak (`acceptAgentMessage`, U34). A new document in the frame (a full navigation) is a new agent.
- **The sender's origin: Arc reports an odd `url` for subframes** (live, 2026-10-14). The agent's messages from the engine frame reached the background with a `sender.url` that was not the frame's www URL, so an origin check derived from the url would drop them. The check now prefers the browser's own `sender.origin` (Chrome 80+) and falls back to the url's origin (`src/shared/protocol.ts` `senderOrigin`, U34); the driver logs the url, origin and frame id of any dropped agent message.
- **The desktop page shares the frame's origin**, so its scripts could read the frame's DOM and location during a run (R25); the content script reads only the frame's pathname.

### Desktop Instagram's page (the entry and the content script; AM48)

- **The navigation** (desktop shell, logged in): a left column of links `/` (Home), `#` (Search), `/explore/`, `/reels/`, `/direct/inbox/`, `#` (Notifications), `#` (Create), `/<handle>/` (Profile, with the avatar) and `#` (More), with svgs; a spacer between Profile and More. Wide (labels) at 180 CSS px and more, collapsed (icons) below; a bottom bar or none on some routes and narrow windows. Found by paths, svgs and geometry only (U35, E51).
- **The sidebar expands while hovered** (live, Arc, 2026-10-14/15). Instagram's collapsed sidebar widens under the pointer and collapses when the pointer leaves it. The entry is not in Instagram's DOM, so it is re-placed by measurement; re-placing it while the sidebar animated under the pointer chased it away from the pointer (unclickable). The entry now stays where it is while the pointer is over the nav column or the entry, and moves once the anchor has been still for 150 ms. The fake models it (`desktopNav=auto`, baseline `desktopNav: "hoverExpand"`), and E60 replays the regression: from the widened nav onto the entry, which never fades or moves.
- **Overlays.** Instagram's own modals cover the entry; it hides while covered (occlusion, FE7).
- **The page's CSP** lets the composer iframe load (an extension page with a per-session dynamic URL; S12, N3), and the page cannot `fetch` it. `runtime.getURL('/composer.html')` with a leading slash gives the fixed extension-id URL: the code never uses it.
- **msite mounts late in the frame.** Its header (with the story input) and navigation (with the account link) mount after hydration, so the first probe in the frame often sees neither. The one input wait (P5) now ends only when everything that was missing has appeared (an account alone no longer ends it), then the probe runs again.

## Spike results (2026-10-11)

### Setup

- **Browsers.** Every spike that launches a browser ran on both:
  - **Playwright's bundled Chromium:** Chrome for Testing **156.0.8078.4** (Playwright 1.64.0, `chromium-1248`). It reports the brand "Chromium".
  - **CfT 155.0.8059.39** from `.cache/cft`, the `@smoke` and `pnpm run dev` browser.
- **Launch.** `chromium.launchPersistentContext(<fresh temp dir>, {channel:'chromium' | executablePath: cftExecutable(), viewport: null, args})`.
  - `args` came from `sealedPlaywrightArgs(spki, extDir)` (`sealedArgs(spki)` when no extension was loaded), and `assertSealed(args)` ran on every launch.
  - The extensions were the S1 build outputs `.output/chrome-mv3-mock` and `.output/chrome-mv3-live`. Each loaded extension's ID was checked against the key-derived ID.
- **Server.** A throwaway HTTPS server (`.spikes/server.mjs`, not the D3 fake) ran on 127.0.0.1:8443 with `.fake-ig/cert.pem`.
  - It logged host, method, path, `user-agent`, `sec-ch-ua*`, `sec-fetch-*`, `origin` and the local socket for every request.
  - It sends `Accept-CH` for the eight high-entropy hints.
- **Machine.** macOS, built-in display 1512x982 pt at DPR 2. No system proxy is configured (`scutil --proxy` shows exceptions only).
- **Headed or headless.** Spikes ran headless unless noted. S3 (LNA) and S8 also ran headed, and S4–S7 were repeated headed on CfT 155 to check parity.
- **Raw data.** Results are in `.spikes/results/*.json` and the spike code is in `.spikes/*.ts`. Both are gitignored.

| Spike | Verdict | Consequence |
|---|---|---|
| S3 | **PASS** | The resolver allow-list, port mapping, SPKI acceptance and seal hold on 155 and 156. `LNA_ARGS` stays empty. No `route-adapter.ts` is needed |
| S4 | **PASS** (fake) | The hard reload works as specified. Two new facts for D1: (1) the SW-served first load still reaches the server once with the desktop UA; (2) any later full-document navigation in the composer tab is SW-served again |
| S5 | **PASS** | `chMode` default stays `'full'`; `uaOnly` also verified. E5 must read headers from the fake's log (or `request.allHeaders()`), never `request.headers()` |
| S6 | **PASS** | A11 confirmed for the extension SW **and** the site's own SW (both `tabId -1`). On live, E9 cannot use `onRuleMatchedDebug` (no feedback permission) |
| S7 | **PASS** (fake) | React 19 `onChange` fires on a synthetic `change` with `isTrusted:false`. Dispatching `input` alone does not fire `onChange`. A5 stays open live (L6) |
| S8 | **PASS**, decision taken | **E2E default is headless**, with the emulated owner screen (`HEADLESS_SCREEN_ARGS`); plain headless popups are capped at 600 px. `viewport: null` is mandatory |
| S9 | **PASS** (scaffold; re-confirmed) | Node 22.18 runs `tools/*.ts` and `src/core` imports |
| S10 | **PASS** | Bundled 156.0.8078.4; CfT 155.0.8059.39. Both artifacts load on both browsers; `minimum_chrome_version` is enforced |
| Dev runner | **PASS** | `wxt` dev passes the sealed args and the CfT 155 binary; the sealed profile `.profiles/dev-fake` is the one Chrome uses |

### S3: host mapping, certificate, seal, proxy, Local Network Access

**What ran:**

- **No extension, headless, both browsers:**
  - navigations to `https://www.instagram.com/` (with subresources on www and i) and to `https://i.instagram.com/__spike__/health`;
  - 12 seal URLs, each in a fresh page;
  - a page `fetch` to an unmapped host;
  - the `EXCLUDE` hosts;
  - `chrome://version` and `chrome://net-internals/#proxy`.
- **Live build, headless and headed, both browsers:**
  - a popup opened by an extension page (`editor.html` calling `chrome.windows.create`);
  - a popup opened by the extension SW;
  - a cross-origin page fetch www → i, timed against an 8 s ceiling;
  - extension-SW fetches to both hosts;
  - `navigator.permissions.query` for `local-network-access`, `local-network` and `loopback-network`.

**Observed (identical on 155 and 156):**

- **Mapping with a port works.**
  - `response.serverAddr()` is `127.0.0.1:8443` for both hosts.
  - The server sees `Host: www.instagram.com` and `Host: i.instagram.com`, with no port, and SNI equal to the host.
- **The SPKI certificate is accepted with no interstitial**, over TLS 1.3. Issuer and subject are "instapost fake instagram". No CT or HSTS error appears.
  - The SPKI list also bypasses the name mismatch: `https://localhost:8443/` and `https://127.0.0.1:8443/` load with no interstitial even though the SANs do not cover them.
- **The seal holds.** All of these fail with `net::ERR_NAME_NOT_RESOLVED` in under 250 ms:
  - www.facebook.com, static.cdninstagram.com, graph.instagram.com;
  - example.com over https and http;
  - the apex instagram.com, accountscenter.instagram.com, scontent.cdninstagram.com, graph.facebook.com, www.google.com;
  - **the IP literals** 192.0.2.1 and [2001:db8::1]: `MAP *` also catches IP literals.

  A page `fetch` to graph.instagram.com rejects, and Playwright reports `net::ERR_NAME_NOT_RESOLVED`.
- **`EXCLUDE` placed after `MAP *` still works** (A9 ordering). localhost and 127.0.0.1 resolve normally.
- **`--no-proxy-server`** is present in `chrome://version`'s command line, and every connection went directly to 127.0.0.1:8443.
  - `chrome://net-internals/#proxy` no longer prints the effective settings in 155 and 156.
  - The negative case (a configured system or PAC proxy) could not be exercised without changing system settings or adding a proxy flag, which the seal forbids.
- **No Local Network Access prompt, headed or headless:**
  - Every subresource, www → i fetch (2 ms) and extension-SW fetch (3–7 ms) succeeded.
  - All three permission names exist and stay `prompt`, meaning never requested.
  - This is expected: the fake pages are themselves served from 127.0.0.1, so their requests go loopback to loopback.

**Consequence:**

- `LNA_ARGS` stays `[]`; `tools/chrome/flags.ts` now records why.
- No `route-adapter.ts` is needed.
- The fake must route on `Host` without a port.
- Because the SPKI bypass also covers `localhost` and `127.0.0.1`, the fake should answer only `/__fake__/health` for those hosts and 404 everything else.

### S4: service worker, hard reload, isolated-world observation (A4 on the fake, A10)

**What ran:** live and mock builds, both browsers, headless, plus a headed repeat on CfT/live.

1. A normal tab registers the spike SW at `https://www.instagram.com/sw.js` with scope `/`. The SW answers navigations itself with `fetch()` from its own context and marks those requests.
2. A popup is opened at `about:blank`, and rule 1001 (S5) is installed for it.
3. `tabs.update` sends the popup to `/create/story/`. A `tabs.onUpdated` listener calls `tabs.reload(tabId, {bypassCache:true})` once on the first `loading` event (§3.6 step 5).
4. An isolated-world script (`scripting.executeScript`) reads `navigator.serviceWorker.controller` and listens for `controllerchange`. The SW is then told to `clients.claim()`.
5. For contrast, a plain navigation, a hard reload after `complete`, and a soft reload.

**Observed (identical on all four combinations and headed):**

- **A10: the SW registers and controls pages** on the SPKI-accepted origin.
- **`tabs.onUpdated` exposes the URL** (`https://www.instagram.com/create/story/`) without the `tabs` permission; host permission is enough, so the kill switch can classify URLs.
- **First navigation:** the SW served it with a request from its own context (`viaSw`, `sec-fetch-mode: cors`) that carried the **Mac UA**. The tab-scoped rule does not apply to it. **That request reached the server** even though the reload was issued on the very first `loading` event.
- **The hard reload works.** The next document request went straight to the network (`sec-fetch-mode: navigate`) with the **Android UA**.
  - The page is **uncontrolled**: `controller === null` in both the main and the isolated world.
  - The server classifies it `is_mobile=true`.
- **The isolated world sees the SW.** `navigator.serviceWorker` is an object there, `controller` reads correctly, and after a late `clients.claim()` the isolated listener got exactly one `controllerchange`, with the new `scriptURL`.
- **A plain navigation or a soft reload** in the same popup is SW-served again: Mac UA, `is_mobile=false`, page controlled. A hard reload after `complete` also yields an uncontrolled page with the Android UA.

**Verdict: PASS on the fake.** Whether the real Instagram SW behaves the same is still L4.

**Consequences for D1 and D2:**

1. The §3.6 sequence is sound, but it does **not** stop the SW-served desktop-UA document request from reaching the server. Expect one desktop-classified `/create/story/` GET with `tabId -1` per hand-off whenever Instagram's SW answers navigations with a network fetch. L4 should note it in DevTools ("(ServiceWorker)" first document).
2. The hard reload protects only the document it reloads. **Every later full-document load in the composer tab** is SW-controlled again and served with the desktop UA. The reducer should treat a second document load after the reload as needing a re-probe, or end with `DESKTOP_SHELL`. As specified, only `controllerchange` on the current document is caught. (Chrome also reports SPA `pushState` as `loading`; AM16 tells the two apart by the agent's sentinel.)
3. The agent's `sw-controller-change` watch works from the isolated world, as specified.

### S5: tab-scoped dNR header rule 1001 (A1, research Q27)

**What ran:** live and mock builds, both browsers, headless, plus a headed repeat on CfT/live.

1. **Desktop baseline.** A normal tab loads `/` twice, so `Accept-CH` is in effect.
2. **Composer popup.** A popup is opened at `about:blank` and rule 1001 is added with `updateSessionRules` before the first navigation. The rule is built exactly per §3.7:
   - `tabIds:[tab]`, `requestDomains` www and i, all 15 resource types including `main_frame`;
   - set the UA to `androidReducedUa(major)`, set `sec-ch-ua-mobile: ?1` and `sec-ch-ua-platform: "Android"`;
   - remove the 8 high-entropy hints.

   `tabs.update` then sends the popup to `/create/story/`, followed by a hard reload.
3. **Controls:**
   - a second normal tab during the session;
   - an extension-SW fetch;
   - Playwright's request events;
   - the `uaOnly` variant, then idempotent cleanup.

**Observed (identical on 155 and 156, mock and live, headless and headed):**

- **Rule acceptance.** `updateSessionRules` accepts the rule with only `declarativeNetRequestWithHostAccess` (live), and `getSessionRules` returns it unchanged.
- **The baseline document** carries the Mac UA, `?0`, `"macOS"` and all 8 high-entropy hints, `sec-ch-ua-form-factors: "Desktop"` included.
- **In the popup, on the document and on every subresource**, including i.instagram.com, and again after the hard reload:
  - UA `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Mobile Safari/537.36`, with 155 or 156 as the major;
  - `sec-ch-ua-mobile: ?1` and `sec-ch-ua-platform: "Android"`;
  - **none** of the 8 high-entropy hints;
  - `sec-ch-ua` untouched (`"Chromium";v="155", "Not(A:Brand";v="24"`).

  The server classifies the popup `is_mobile=true`.
- **The JS realm still says desktop**, as §2.3 expects: Mac `navigator.userAgent`, `userAgentData.mobile=false`, platform `macOS`, `maxTouchPoints 0`.
- **A second normal tab** during the session gets the Mac UA, `?0`, `"macOS"`, all hints and `is_mobile=false` (E7 holds).
- **An extension-SW fetch** (`tabId -1`) gets the desktop UA and **no `sec-ch-ua*` headers at all**.
- **`uaOnly`:** Android UA, while the client hints stay desktop (`?0`, `"macOS"`, 8 high-entropy hints).
- **Cleanup:** removing ids 1001–1019 twice leaves `getSessionRules()` empty.
- **Playwright's request events:** `request.headers()` shows the **pre-dNR** headers (Mac UA, `?0`). Only `await request.allHeaders()` shows what went on the wire (Android, `?1`, `"Android"`, no `sec-ch-ua-arch`).
- **Headless UA.** In headless runs the background's `navigator.userAgent` is `…HeadlessChrome/156.0.0.0…`.

**Verdict: PASS.**

**Consequence:**

- `chMode` default stays `'full'`, as in the baseline, and `uaOnly` remains a verified fallback.
- E5 and E7 assertions must come from the fake's request log (as specified) or `allHeaders()`, never from `request.headers()`.
- `chromeMajorFromUa()` must accept `HeadlessChrome/<n>`; its doc comment in `device-profile.ts` now says so.
- CfT and Chromium send no "Google Chrome" brand, so fake checks must not expect one.

### S6: write-block rules (A11, SG3, SG5)

**What ran:** both browsers, headless (plus headed on CfT). Writes went to `https://i.instagram.com/rupload_igphoto/x` and `https://www.instagram.com/api/v1/media/configure_to_story/` (POST, `no-cors`) from page tabs A and B and from the extension SW. A control GET ran each time. Outcomes come from the server log plus Playwright `requestfailed`.

- **Mock (static `block_ig_writes`):**
  - every page and extension-SW write gives `TypeError: Failed to fetch` and `net::ERR_BLOCKED_BY_CLIENT`, and the server sees nothing;
  - the controls pass;
  - `sendBeacon` (`ping`) and `<img>` (`image`) to rupload are blocked too;
  - `onRuleMatchedDebug` fired for each block, with ruleset `block_ig_writes`, rule 1 or 3, the tab's id for page requests and **`tabId -1` for extension-SW requests**;
  - `getMatchedRules` counted 8;
  - a **`main_frame` navigation** to `/api/v1/media/configure_to_story/` is **not** blocked, by design.
- **Live (no static ruleset):**

  | Rules | Tab A | Tab B | Extension SW |
  |---|---|---|---|
  | None | reached | reached | reached |
  | `tabIds:[-1]` | reached | reached | **blocked** |
  | `tabIds:[tabA]` | **blocked** | reached | reached |
  | `rehearsalRules(tabA)` from `src/core` (`[tabA, -1]`) | **blocked** | reached | **blocked** |
  | After cleanup | reached | reached | reached |

  This holds for both endpoints. `onRuleMatchedDebug` is unavailable in live (no `declarativeNetRequestFeedback`).
- **S6b, the site's own service worker** (`https://www.instagram.com/sw.js`) posting to rupload:
  - mock static: blocked, and `onRuleMatchedDebug` reports **`tabId -1`**;
  - live with no rule, or with a `[tab]`-only rule: **reached**;
  - live with `[-1]` or `rehearsalRules(tab)`: blocked.

**Verdict: PASS.** A11 holds for both kinds of service worker.

**Consequence:**

- The `-1` in the rehearsal rules is essential: without it, uploads made by Instagram's SW escape.
- E8 (mock) may assert `onRuleMatchedDebug`.
- E9 (live) must assert through the fake's `writes()` log and `requestfailed` `net::ERR_BLOCKED_BY_CLIENT`.
- The fake's `share=real-paths` canary must use subresource requests, never navigations, because `main_frame` is intentionally excluded. (Since AM42 the canary is the fake's own Share: Instagram-shaped XHRs, which are subresources.)

### S7: DataTransfer injection into React 19 (A5 on the fake)

**What ran:**

- **The page.** The served page renders a React 19.2.8 root (esbuild bundle from `node_modules`, production) with two hidden inputs:
  - the story input (`accept="image/avif,image/jpeg,image/png"`) with `onChange` and `onInput`;
  - a post input with a different accept list.
- **The injection.** An isolated-world `scripting.executeScript({func})` picks the input by accept **set-equality**, builds `new File([png], 'story.png', {type:'image/png'})`, assigns it through `DataTransfer` and dispatches bubbling, composed events in three variants: `input`+`change`, `change` only, and `input` only.
- **Isolation check.** The packaged `/composer-agent.js` was injected with `files:[…]`.
- **Coverage:** live and mock builds, both browsers, headless, plus headed on CfT.

**Observed (identical everywhere):**

- **The story input is chosen**, not the post input. `input.files.length` is 1 and `value` is `C:\fakepath\story.png`.
- **`input` + `change`:** React `onInput` and `onChange` both fire with `nativeEvent.isTrusted === false`, the File arrives (`story.png`, `image/png`), and the "composer" canvas mounts.
- **`change` only:** `onChange` fires.
- **`input` only:** only `onInput` fires, no `onChange`, so no canvas.
- **The isolated world cannot see page globals.** The agent's sentinel `__instapostAgentV1` is `true` in the isolated world and absent in the main world.

**Verdict: PASS on the fake.** Whether real Instagram accepts `isTrusted:false` is still open; L6 checks it.

**Consequence:**

- §3.8 must keep dispatching **`change`**; `input` alone does nothing in React.
- B6 and E12(f) can model "ignores untrusted" only through the fake's `trusted=require` knob. React itself does not filter on `isTrusted`.

### S8: popup geometry, headed and headless (A16)

**What ran:**

- **Popups.** `chrome.windows.create({type:'popup', url:'about:blank', width, height})` from the live build's SW for 430x932, 524x1012, 480x900 and 400x700. For each one:
  - the window and tab sizes were read at `about:blank` and after loading the fake;
  - the page's inner and outer size, DPR and screen were read;
  - `windowFit` (§7.10) ran with the measured frame delta, followed by one `windows.update`.
- **Runs:** headed on the real display, and headless in four variants: default, `--screen-info`, `--force-device-scale-factor=2`, and a non-null Playwright viewport. Both browsers each time.

**Observed:**

- **Headed (both browsers):**
  - the screen is 1512x982, with avail 1512x949 at `availTop` 33, DPR 2;
  - popups get the requested outer size, clamped to `availHeight` (524x1012 becomes 524x949);
  - **the frame delta is 0 x 32** (outer minus `tabs.get` inner);
  - `tabs.get(tab).width/height` is correct already at `about:blank` and in the `windows.create` result, without the `tabs` permission;
  - the fitted inner size is **511x909** (949 − 32 − 8 = 909; 909 × 9/16 ≈ 511), reached exactly with one `windows.update`, portrait.
- **Headless default:**
  - the screen is **800x600 at DPR 1**;
  - every popup is clamped to 600 tall (568 inner);
  - the fit would give 315x560, below the 640 px floor, so the real code would return `SCREEN_TOO_SMALL`. **Not equivalent.**
- **`--force-device-scale-factor=2`:** the screen shrinks to 400x300. Useless.
- **`--screen-info={0,0 3024x1964 devicePixelRatio=2 workAreaTop=66}`:** **identical to headed** in every number (screen, avail, DPR 2, clamping, delta 0x32, fit 511x909). The values are physical pixels: passing 1512x982 gives a 756x491 screen.
- **Playwright `viewport: {1280,720}`:** the popup's page and `tabs.get` report 1280x720 or 1280x688 whatever the window size, and the popup turns landscape. `viewport: null` is therefore mandatory.
- **Parity of everything else.** S3–S7 gave identical results headed and headless. The only difference is the `HeadlessChrome` UA token.

**Verdict: PASS.** Decision: **headless is the E2E default**, and it requires the screen emulation.

**Consequences, all made in code:**

- `tools/chrome/flags.ts` exports `HEADLESS_SCREEN_ARGS`, and `sealedPlaywrightArgs(spki, extDir, { headless })` appends them.
- `playwright.config.ts` sets `use: { headless: true }`. Fixtures must pass `headless` through to both the launch and `sealedPlaywrightArgs`, and keep `viewport: null`.
- The §7.9 fixture text ("`headless: false` … Headed is the default until S8 decides otherwise") is superseded.

**Further notes:**

- The §3.6 first-guess frame delta of +80 px overestimates. The real delta is 32 px, and the refit makes it harmless.
- On the owner's MacBook the composer inner height will be about **909 CSS px**, not 880–900. A `viewportDpr` canvas would be 1818 px tall, a 5.3% downscale (§1 item 11, OD4).

### S9: Node 22.18 runs tools/*.ts

The scaffold stream ran S9 (see its report). It was re-confirmed here:

- `node tools/contract/print-rules.ts 42` prints `rehearsalRules(42)`;
- every spike imported `src/core/ig-contract/*.ts` and `tools/chrome/*.ts` directly under Node 22.18.0.

**PASS.**

### S10: browser versions and extension loading

**Versions:**

| Browser | Version | Source |
|---|---|---|
| Playwright bundled Chromium | **156.0.8078.4** | `browser.version()`; Chrome for Testing build, Playwright 1.64.0, `~/Library/Caches/ms-playwright/chromium-1248` |
| Pinned CfT | **155.0.8059.39** | `.cache/cft/chrome/mac_arm-155.0.8059.39` |

**Loading:**

- Both artifacts load on both browsers. The SW is `chrome-extension://<id>/background.js` and the IDs equal the key-derived ones:
  - mock `jehchapoghccaofddgdkakdkjijmknhk`, manifest name "instapost MOCK";
  - live `fjhalnhlfpiiknemdjbbgmlmmcdmkbom`, manifest name "instapost";
  - both with `minimum_chrome_version` 155.
- **Negative control:** a copy of the mock build with `minimum_chrome_version: "999"` is refused on both browsers. The refusal is **silent**: no SW ever appears, and no error reaches Playwright.

**Verdict: PASS.**

**Consequence:**

- E2's "SW appears within N seconds" is the only signal that an extension failed to load, so keep it strict.
- The bundled browser is one major ahead of the owner's 155, which is why the `@smoke` CfT 155 projects matter.

### Dev runner (`wxt` dev / web-ext)

**What ran:**

1. **Without a browser.**
   - WXT's own `registerWxt('serve')` resolved the merged config.
   - That config was fed to web-ext 10.7.0's real `cmd.run`, exactly as WXT's runner builds it, but with an argv-dumping stub in place of Chrome.
2. **One real launch.** `HEADLESS=1 pnpm exec wxt` (chrome-launcher adds `--headless`), with the spike server on 8443. The live Chrome argv was read from `ps`; afterwards the profile directories were inspected and the dev editor was loaded in a sealed Playwright browser while Vite ran.

**Observed:**

- **Resolved config:**
  - mode `development`;
  - `binaries.chrome` is the CfT 155 path;
  - `chromiumArgs` is exactly `sealedWebExtArgs(spki)`, so `assertSealed` passes;
  - no `chromiumProfile`;
  - `startUrls` is `https://www.instagram.com/__fake__/`.
- **Final argv:** chrome-launcher's `--user-data-dir=<web-ext temp>` comes first; then web-ext's defaults (no `--disable-extensions`, no `--load-extension`; the extension is loaded through CDP `Extensions.loadUnpacked` with `--remote-debugging-pipe --enable-unsafe-extension-debugging`); then all sealed args; then `--user-data-dir=.profiles/dev-fake`; then `--disable-blink-features=AutomationControlled` and the start URL. `assertSealed` on the final argv passes.
- **The last `--user-data-dir` wins.** Chrome populated `.profiles/dev-fake`. The web-ext temp dir held only web-ext's own `Preferences` and logs.
- **The real headless run** started CfT 155 with that argv, and the only requests the spike server saw were `GET /__fake__/` and `/favicon.ico` on `www.instagram.com`, with UA `HeadlessChrome/155`.
- **The dev editor renders.** It is served from `.output/chrome-mv3-dev`, which loads its modules from `http://localhost:3000`, and its ID is the dev key's `fbemdapddmpdphldgpgbkigpemcoonia`. All 9 localhost requests succeeded, headless and headed, with no LNA prompt.

**Verdict: PASS.** The sealed `chromiumArgs` and `binaries.chrome` are what reach Chrome.

**Notes:**

- web-ext writes WXT's `chromiumPref` into its temp dir, so those prefs never reach `dev-fake`. This is harmless, since there are no content scripts.
- web-ext `shift()`s WXT's `startUrls` array in place, so a reopen ("o + enter") starts without the start URL.
- On this Mac **Docker listens on `*:3000`**. WXT warned and bound `[::1]:3000`; it worked, but pinning a free dev-server port would avoid ambiguity.
- The run left `.profiles/dev-fake` (4 MB, gitignored, never logged in). It is the intended manual-dev profile.

### Changes made because of these spikes

- **`tools/chrome/flags.ts`:**
  - the `LNA_ARGS` doc now records the S3 evidence, and the value stays `[]`;
  - new `HEADLESS_SCREEN_ARGS`;
  - `sealedPlaywrightArgs()` takes an optional third argument, `{ headless?: boolean }`, and appends `HEADLESS_SCREEN_ARGS` when headless. This is backward compatible, and `assertSealed` passes on both forms.
- **`playwright.config.ts`:** `use: { headless: true }`, with the fixture contract as a comment.
- **`src/core/ig-contract/device-profile.ts`:** the `chromeMajorFromUa` doc comment requires `HeadlessChrome/<n>` to parse. The function is still a stub.

`pnpm run typecheck` and `pnpm run lint` pass after these changes.

---

## Review fixes: observed in the sealed browser (2026-10-12)

Measured in Playwright's Chromium 156 (headless, sealed, mock build) with a `tabs.onUpdated` listener in the extension's service worker. They decide AM16, AM20 and AM23 (strategy §11).

| Action in the composer tab | `tabs.onUpdated` (changeInfo; tab.url) |
|---|---|
| A popup created at `about:blank` | `{status:'loading'}`, `{status:'complete'}`; `tab.url` undefined (no permission for about:blank) |
| `tabs.update` to an unmapped host (accountscenter) | `{status:'loading'}`, then `{}` (the hidden URL or title change), then `{status:'complete'}`; `tab.url` undefined throughout |
| `tabs.update` to `https://www.instagram.com/…` | `{status:'loading', url}` (the commit), `{title}`, `{status:'complete'}`; no earlier `loading` with the old URL |
| `history.pushState`, `history.replaceState`, a hash change | `{status:'loading', url}`, then `{status:'complete'}`, within 2 ms: the same as a document load |
| `location.reload()` | `{status:'loading'}`, `{status:'complete'}` |
| `document.title = …` | `{title}` only |

- **`scripting.executeScript({files:['/composer-agent.js']})` returns the script's value** (`results[0].result`): the WXT wrapper returns `main()`'s result. The agent returns `true` when it installs itself and `false` when the sentinel was already set (AM16).
- **Brands.** The extension service worker's `navigator.userAgentData.brands` is `["Not:A-Brand", "Chromium"]` in Playwright's Chromium 156 headless; E2 asserts no branded brand on both E2E browsers (AM23).
- **Extension requests are visible to Playwright.** `context.on('request')` reports the extension service worker's fetches (`request.serviceWorker()` is `background.js`) and the editor page's (frame URL `chrome-extension://…`), so the tripwire can flag them (AM26).

---

## First live run (Arc, 2026-10-12)

The owner's first live hand-off. Arc (Chromium 155) on macOS: the MacBook (1512x982 pt at 2x, primary, at 0,0) and a 3440x1440 ultrawide at 1x placed at (1512,−428); the editor was on the ultrawide (`screen.avail*`: 1512, −428, 3440x1410). Live build, a new secondary account, rehearsal off, assisted insert off.

- **Record.** Phases `opening(0) → scoping(+246 ms) → fitting(+280) → navigating(+298) → reloading(+848) → probing(+3541) → closing`; outcome `failed:DESKTOP_SHELL`; probe `{marker:false, isMobile:true, inner:1512x902, dpr:1, portrait:false, swControlled:true, storyInput:'absent', acceptOk:false, acceptSeen:[], lang:'en'}`; route `homeOnly`; preflight C1 pass, C2 pass, C3 fail, C4 fail, C5 fail. The panel said "Story input: absent (accept list changed)".
- **Why.** `DESKTOP_SHELL` came from `swControlled` (the rule at the time), not from `is_mobile`, which was `true`. The window was never fitted: Arc ignored the create's bounds and the product's update. At 1512 CSS px msite renders its wide layout, which has no file input at all. `/create/story/` landed on `/`, as it does.
- **Facts established that day** (they are the basis of strategy §11 AM29–AM35; `baseline.json` records each with its source):
  - **F1, Arc's windows** (owner's console experiment from the editor): `chrome.windows.create({type:'popup', url:'about:blank', focused:true, left:2970, top:-328, width:524, height:1012})` ignored the bounds: the window came out 1512x949 at (1831,13), its tab 1512x902. `chrome.windows.update(id, {state:'normal', left:2970, top:-328, width:524, height:1012})` 500 ms later was honoured: 524x1012, tab 524x965 (frame 0x47). A `type:'normal'` create with `state:'normal'` honoured its bounds (±30 px). The owner can resize both windows by hand (e.g. a tab of 379x866). Arc's `navigator.userAgentData.brands` = `[Chromium 155, Not(A:Brand 24]`, the same as Playwright's Chromium; Arc injects `--arc-palette-*` CSS custom properties on page roots (a detection heuristic, AM34).
  - **F2, Instagram's service worker** (logged-out reading of production code): the registration URL and lifecycle above (§ "Also probed on every hand-off"); no fetch handler in the 2024 copy (the 2026 worker is behind login).
  - **F3, msite's shape** (same reading): `/create/story/` without media lands on `/`; the story input sits beside + / Story and exists whenever that entry does; the mobile header renders only at ≤ 767 CSS px (IGDS `nav-bottom-screen-max`); picking a file runs the portrait check and SPA-navigates to `/create/story/`; HEIC is desktop-only.
- **Arc research (same day).** Arc often ignores the first `windows.update`; an Arc-aware extension re-applies a window's bounds at 0/50/150/300/500/1000 ms; popups created with a `chrome-extension://` URL honour their bounds where `about:blank` ones do not (not adopted: instapost keeps `about:blank` and re-applies, AM29).
- **Spike S11 (sealed, headless, CfT 155.0.8059.39 and Chromium 156.0.8078.4).** `--screen-info={0,0 3024x1964 devicePixelRatio=2 workAreaTop=66}{1512,-428 3440x1440 devicePixelRatio=1 workAreaBottom=30}` emulates both displays: a window moved onto the ultrawide reads `screen.avail*` = 1512, −428, 3440x1410 and DPR 1, exactly the owner's numbers, and a popup created there at (2970,−328) 524x1012 keeps those bounds (tab 524x980, headless frame 0x32). A `label=…` needs quotes, which the seal forbids, and an unquoted one crashes the browser. `HEADLESS_DUAL_SCREEN_ARGS` (flags.ts) and E26 use it.

---

## Second live run (Arc, 2026-10-12)

The owner, a test account, the live build with AM29–AM36, in Arc on the MacBook display (landscape). The composer window was fitted before Instagram loaded: 503x894 CSS px at 2x, portrait (`matchMedia('(orientation: landscape)')` false), while `screen.orientation.type` was `landscape-primary`.

- **What happened.** On home + → Story opened the file chooser (C3a passed). After a photo was picked, `/create/story/` showed a bottom snackbar "Rotate your device to add to your story." instead of the share footer. The same after the H1 insert into the header input (H1) and after the owner's own + → Story → pick (H0).
- **Why** (Instagram's public bundles, read the same day). Two different checks (research §5.1, §5.2): the session start at + → Story reads the viewport (`innerHeight < innerWidth`), but the composer page's `isLandscape` reads `screen.orientation.type` first, at mount and on `resize`. A landscape monitor is therefore "landscape" to the composer in any window. The H1 insert also bypasses the session start (`onFileChange` → `storyCreationSelectMedia`), so its `sessionId` stays null.
- **Consequences** (strategy §11 AM37). C3 split into C3a and C3b; the portrait shim in the composer tab; new error `SCREEN_LANDSCAPE`; assisted insert stays off by default in the live build; `baseline.json` `composerLandscapeCheck: "screen"` with its provenance; the fake models both checks (knob `landscapeCheck`); live checklist L16, L17.

## First real post (Arc, 2026-10-13)

L17 passed on the secondary account: the live build with the portrait shim, H0. The composer window was fitted before Instagram loaded; on home the owner tapped + → Story, picked the PNG from `Downloads/instapost/`, saw the composer with its Share footer (no snackbar: C3b passed with the shim), tapped Share, and answered "Posted?" in the panel. The owner's decision the same day (strategy §11 AM39): no interactive steps after Post story. C10–C14 above come from that decision.

## Autopilot spike (2026-10-13)

Read from Instagram's saved, logged-out msite bundles (`PolarisMobileCreationNavItem.react`, `PolarisStoryCreationFileForm.react`, `PolarisImageFileForm.react`, `PolarisStoryCreationActions`, `usePolarisDisplayProperties`, `PolarisToastActions`, `PolarisStoryCreationPage.react`, `PolarisStoryImageCreationContainer`, `PolarisStoryCreationShareFooter.react` and `…V2`) and spiked in sealed CfT 155 and Chromium 156 against local pages. Nothing here touched real Instagram.

- **The only path that starts Instagram's story session** is + → Story: `handleStoryCreationClick` is `startStoryCreationSession`'s only caller and is reached only from the lazy + menu's Story item. It checks the viewport (`innerHeight < innerWidth` → the rotate toast), dispatches `STORY_CREATION_SESSION_STARTED` with a uuid `sessionId`, then `selectFile()` clears the story input and calls its `click()`. A file set on the input without it (AM37's H1) runs `onFileChange` → `storyCreationSelectMedia` → `readImageFile` → `STORY_CREATION_IMAGE_PROCESSED` → `browserHistory.push('/create/story/')` with `sessionId` null: empty `waterfall_id` and a duration of about 1.76×10⁹ s in the telemetry. With + → Story first, the session is consistent.
- **The menu's props** are exactly two actions (Story, Post); the popover module itself was not readable logged out (C10, L18).
- **No user activation, no chooser.** The Story item's `input.click()` without user activation opens no chooser (a console warning); a capture listener sees the click, so the session is armed and the file can be set. Within about 5 s of a real click in that window the same click opens the OS chooser: hence the activation guard (R22).
- **Every handler on the path is a React `onClick`**, and no module in the saved bundles reads `isTrusted` or `userActivation`: `element.click()` from the isolated world drives +, Story and Share.
- **Share has no in-flight guard** (`uploadStory`): a second click uploads and publishes again. Hence Share once (IR11) and the fake's `DOUBLE_SHARE`.
- **Outcome evidence.** `PerformanceResourceTiming.responseStatus` and `contentType` are readable from the isolated world for the page's XHRs, cross-origin too when CORS passes; a request blocked by dNR reads as status 0; Instagram's client calls `performance.clearResourceTimings()`, so only an observer created early (`buffered: true`) sees every entry. A credentialed cross-origin preflight must be answered with the requested headers echoed (`Access-Control-Allow-Headers: *` does not cover credentialed requests).
- **The Share footer** is ShareFooter (a `button`) while the account has no Facebook destination, else ShareFooterV2 (a `[role=button]` with the avatar, plus a badge when cross-posting is automatic), and can switch after a GraphQL answer: hence the 1.5 s settle (C12).

### Observed in the sealed browser while rewriting the E2E suite (2026-10-13)

- **Chrome resends a POST on a reset reused connection.** With the fake's `configure=reset` (the server destroys the socket after reading the request), Chromium sent the same publish request four times on fresh connections before giving up; the page's XHR failed once and its resource timing showed one entry. So a publish whose connection resets before any answer byte may reach Instagram more than once without the page or instapost seeing it. The fake now answers a repeated upload id with the same story (one story per upload id); whether Instagram's `configure_to_story` is idempotent per `upload_id` is unverified (strategy R19).
- **Playwright's `page.evaluate` and locator actions give the page user activation** (`Runtime.callFunctionOn` with `userGesture: true`), which the autopilot then waits out (R22). Specs read the Instagram window mid-run through CDP `Runtime.evaluate` without a gesture.
- **Headless Chromium keeps a minimised or covered popup's page `visible`**, so the "hidden before a tap" case (E41) cannot be produced there; it is a reducer test (U19) and a live check (L23).
- **Chromium refuses window bounds less than half on screen** ("Bounds must be at least 50% within visible screen space"). With the window docked at the right edge, a test that forces a wider window must also move it left.
