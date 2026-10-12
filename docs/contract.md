# instapost: Instagram contract

This file has two parts:

1. **Contract C1–C9** (strategy §3.9): what instapost relies on in Instagram's mobile-web story composer, how each item is probed, the evidence for it, and when it was last verified. The code is `src/core/ig-contract/contract.ts` (`CONTRACT_VERSION = 1`).
2. **Spike results** from strategy §8 (S3–S10): facts about the dev environment that several streams depend on.

---

## Contract C1-C9

**Status, 2026-10-11:** every item is verified against the fake only. Nothing has been checked on real Instagram yet; that starts with L2 and L4 (`docs/live-checklist.md`). `src/core/ig-contract/baseline.json` still holds the pre-L4 assumptions, and the fake's default knobs are derived from it (U16).

**Rules that apply to every probe:**

- No probe matches visible text or ARIA labels. The owner may use a Spanish UI, and the fake runs `en` and `es` (E12 l) with randomised class names and ids (E12 m).
- The agent reads the DOM of the composer tab from the isolated world and nothing else: no page scripts, no network, no extension storage, no clicks (T3).
- C1–C5 and the service-worker state are judged from the probe that decided the flow. C8 is taken from a second probe once the composer is ready (§11 AM13). All of them are stored on every Handoff record as `preflight`. The settings list of the last 20 preflights (§3.9 item 1) is not built yet; the records are in IndexedDB `handoffs`.

| Id | Item | Decides | Last verified |
|---|---|---|---|
| C1 | `InstagramUserAgent.is_mobile === true` | Yes | fake, 2026-10-11 |
| C2 | Logged in | Yes | fake, 2026-10-11 |
| C3 | Portrait | Yes | fake, 2026-10-11 |
| C4 | Story input | Yes | fake, 2026-10-11 |
| C5 | `/create/story/` reachable directly | Yes | fake, 2026-10-11 |
| C6 | Composer ready | Yes | fake, 2026-10-11 |
| C7 | Error toasts | No (diagnostics only) | not probed |
| C8 | Canvas geometry | The owner's (OD4); the code only records it | fake, 2026-10-11 |
| C9 | Composer left | Yes | fake, 2026-10-11 |

### C1: `is_mobile`

- **Probe (agent, `src/agent/probes.ts` `readIsMobile`).** The first `script[type="application/json"]` whose text contains `InstagramUserAgent`, parsed by `parseIsMobile` in `src/core/ig-contract/ua-json.ts` (`"is_mobile"\s*:\s*(true|false)`). Missing gives `unknown`. `contract:check` uses the same parser.
- **Decision.** `false` gives `DESKTOP_SHELL`. `unknown` passes on the first probe, but fails a re-probe after a later full-document load (AM2). A same-document load (pushState, replaceState) is not re-probed (AM16), unless it comes after a new document was detected and before that document's probe answered: it is then probed strictly too (AM28).
- **Evidence.** Research §5.1: the initial HTML embeds `InstagramUserAgent`, and curl tests showed that only the User-Agent header decides `is_mobile`. Spike S5: rule 1001 puts the Android reduced UA on the document request.
- **Verified on the fake by:** U15, B6; E4 and E5 (the composer document carried the Android profile and the page said `is_mobile: true`); E7 (a normal tab stays desktop); E12 a (service-worker-served first load), E12 k (`classifier=client-hints`).
- **Live:** L2 (logged-out GET per UA), then L4.

### C2: logged in

- **Probe (background, `src/core/ig-contract/urls.ts` `classifyComposerUrl`).** The composer tab's URL, read from `tabs.onUpdated`, is not a login URL (`/accounts/login…`).
- **Decision.** A login URL gives `NOT_LOGGED_IN`: the window closes at once, so nobody logs in inside the spoofed tab, and there is no lock. Every other `/accounts…` path, `/auth_platform…`, `/challenge…` and `/checkpoint…` kill and lock (AM17); that holds from the first navigation on (AM20).
- **Evidence.** Research §5.4; strategy §3.6 kill-switch table.
- **Verified on the fake by:** U14, U9; E12 c (`auth=out`: closed, no lock).
- **Live:** L4 (the secondary account is logged in, so C2 should pass).

### C3: portrait

- **Probe (agent).** `innerHeight >= innerWidth` in the composer document.
- **Decision.** Not portrait: the window is refitted once and probed again. Still landscape gives `LANDSCAPE`.
- **Evidence.** Research §1 item 2: the composer shows "Rotate your device to add to your story." in a landscape viewport. The fake has the same guard and toast.
- **Verified on the fake by:** U9, U13; E13 (a popup forced to 960x600 is refitted exactly once, back to 511x941 outer, and the second probe is portrait).
- **Live:** L4, L5.

### C4: story input

- **Probe (agent, `findStoryInput`).** An `input[type=file]` whose `accept` list, split on commas and trimmed, set-equals `{image/avif, image/jpeg, image/png}`. An input whose list names only image types is a candidate; the post input also accepts video, so it never counts.
- **Decision.** No candidate gives `INPUT_MISSING`, and a candidate with another list gives `ACCEPT_DRIFT`. Both degrade to H0 in the same window; nothing is inserted.
- **Evidence.** Research §5.5 and §2 fn 5: a hidden `<input type=file accept="image/avif,image/jpeg,image/png">`. Spike S7: inserting through `DataTransfer` plus a synthetic `change` fires React 19's `onChange` (AM3).
- **Verified on the fake by:** B6 (the story input is chosen and the post input ignored); E5 (H1 insert); E12 h (`input=afterTap`), E12 j (`accept=changed`); E12 f and g (an ignored insert degrades to H0 with exactly one inject).
- **Live:** L4 (presence before tapping), L6 (whether an `isTrusted:false` insert is accepted).

### C5: `/create/story/` reachable directly

- **Probe (background).** The tab's URL at the first `complete` after the hard reload. `/create/story…` is `direct`; anywhere else on www is `homeOnly`.
- **Decision.** `homeOnly` is H0, and the instructions say "tap + → Story". Leaving for `/` is not C9 until the composer is engaged (AM18): a client-side redirect home after the reload's `complete` also makes C5 `homeOnly` (fail). Any other www page is `UNEXPECTED_PAGE` (AM17).
- **Evidence.** Research §5.2: the route is `/create/story/`; whether it works directly is (unverified, A8).
- **Verified on the fake by:** U9; E4 and E5 (`direct`); E12 i (`route=homeOnly`: H0 with the "tap + → Story" text, then posted from home).
- **Caveat found by E12 a.** When a service worker answers the first composer load with a desktop-UA fetch and the server redirects that request to `/`, the redirect commits before the hard reload runs. The reload then reloads `/`, and C5 reads `homeOnly` although the route itself works. On the fake this happens on every run; E12 a pins it, and E12 a2 runs a post through it (H0 from home). If L4 sees `homeOnly` together with a "(ServiceWorker)" first document in DevTools, read C5 with that in mind. Whether a desktop `/create/story/` 302s home at all is the fake's `desktopComposer` knob (unverified, L4).
- **Live:** L4.

### C6: composer ready

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

- **Probe.** Background: the tab's URL leaves `/create/story` after having been on it (`urls.ts`, `composer-left`). Agent: the path leaves `/create/story`, or the C6 canvas has been gone for more than 2 s (`C9_CANVAS_GONE_MS`).
- **Decision.** Once the composer is engaged (AM18: C6 seen, the H1 file served, or, AM28, an insert dispatched that C6 never confirmed), the session finishes. The editor asks "Posted?", pre-answered "posted" when C9 followed `awaitingShare`; the record is written. The window closes 3 s later, except after Share in a post with rehearsal off, where it stays open until the owner answers (AM19), so an upload that is still running in the page is never cut off. Only `/` counts as "composer left" (AM17); any other www page ends it with `UNEXPECTED_PAGE`, naming the page (AM28). With no Share detected but one possible (an unknown page after Share, or C9 after an unconfirmed insert), "Posted?" has no pre-answer (`postedUnknown`), and after an unconfirmed insert the popup is held open whatever rehearsal says (AM28). Engagement belongs to one document: once a later load is known to be a new document, a Share or insert made in the old one no longer counts (AM28). The agent's watch keeps running after a `composer-left`.
- **Evidence.** None from research yet: where the real composer goes after Share is (unverified). The URL rule and the canvas rule are both structural, so either a navigation or the composer unmounting counts. The fake navigates in-page to `/`.
- **Verified on the fake by:** U9, U14; E5, E6, E8, E9, E11 and E12 f–j, l, m (Share, then the in-page navigation to `/`, then `posted-confirmed`); E12 r (`share=background`: an upload that runs after the composer went home lands only because the popup is held open, AM19); E12 v (`geometry=cssFixed:360x640`: C6 never confirms the insert, Share from H0 is C9 with no pre-answer, held open, AM28).
- **Live:** L8 (the first real post): whether the composer goes to `/` after Share, and whether the upload finishes before or after that.

### Also probed on every hand-off

These are not C items, but the same probe reports them:

- **Fake marker (SG4).** `<meta name="instapost-fake-instagram">`. In a guarded build, a missing marker gives `GUARD_NOT_FAKE` (E10). In live, a present marker shows the FAKE INSTAGRAM banner (E5, E10).
- **Service-worker control.** `navigator.serviceWorker.controller !== null` from the isolated world. Controlled after the hard reload gives `DESKTOP_SHELL`; a `controllerchange` later gives `SW_TOOK_CONTROL` (E12 a, b).

---

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
- The fake's `share=real-paths` canary must use subresource requests, never navigations, because `main_frame` is intentionally excluded.

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

