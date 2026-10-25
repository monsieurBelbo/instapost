# instapost: posting from inside Instagram (design, spike S12, adopted)

- **Status:** **adopted, 2026-10-15** (strategy §11 AM46–AM52): the in-page lane is the product, the window lane its fallback. The owner decided OD15–OD19 (strategy §10), approved the `X-Frame-Options` strip (rule 1020) and the `Sec-Fetch-Dest: document` forge (rule 1021) as deviations, the UI direction "Create dialog, quiet entry" (`docs/inpage-ui-spec.md`), and dropped AirDrop (§13.7). The canonical docs now carry it: strategy AM46–AM52 (with §1, §2.1–§2.4, §7.11, §8 L25–L36, §9, §10), `docs/contract.md` C15–C16, `docs/live-checklist.md` L25–L36 and `README.md` (§12 below). §0–§11 are kept as the proposal was written (2026-10-14, against `main` = af856c9); where they differ from what was built and adopted, §13 and §14 win, and where they differ from the strategy, the strategy wins. In particular §3.7's "instapost never forges `Sec-Fetch-Dest`" was reversed live (AM47).
- **Owner request (2026-10-14):** "My idea was that they use this from Instagram, and I imagined sort of a subtle window opening where you can edit, compose your story, click post, and that's it. This takes you away from Instagram. It opens a lot of windows, pop-ups, and resizes. It's very disturbing. Is there a way to do this in a more headless way, more integrated with an actual Instagram page?"
- **Inputs:**
  - `docs/ux.md` (the autopilot as built);
  - strategy §1, §2.1, §3.6–§3.7 and §11 AM29–AM43;
  - contract C1–C14, spikes S5 and S6;
  - research §5.4 ("Avoid these");
  - the Chrome docs and Chromium sources saved during research;
  - Instagram's saved logged-out msite bundle of 2026-10-12;
  - the header facts F4–F6, checked today, and the code facts F7–F9 (§2).
- **Conventions:**
  - The same as ux.md.
  - **(unverified)** marks anything not yet seen in Arc or on real Instagram. Each such item has a check, N1–N17 (§11.3), done in spike S12 (§10) or in a live item (L24–L29).
  - Ids are stable. The ids proposed here were reserved by this file and copied into the canonical docs on adoption: F4–F9, N1–N17, OD15–OD19, R23–R28, U32–U36, B16–B18, E46–E56, L25–L29, and the codes `FRAME_REFUSED`, `PAGE_LEFT`, `TAB_HIDDEN` and `PAGE_IN_USE`. **Six collided with ids `main` took meanwhile** (AM44, AM45) and were renamed (strategy AM52): this file's U30 is **U37**, U31 is **U38**, B15 is **B19**, E44 is **E57**, E45 is **E58**, L24 is **L30**. The text below keeps the old names.
- **Words used here:**
  - **The page:** the owner's own desktop Instagram tab.
  - **The panel:** instapost's editor shown inside the page.
  - **The engine frame:** Instagram's mobile site (msite) in an iframe of the page, which the autopilot drives.
  - **The window lane:** today's docked popup.

> **Spike S12 implementation (2026-10-14, branch `spike/inpage-panel`):** what was built in the sealed environment, what passed, and what differs from this plan is in §13 at the end of this file. Everything above §13 is the design as proposed. **Adoption (2026-10-15, branch `feat/inpage`):** §14.

---

## 0. The answer

**Yes, but not fully headless.**

### Why not fully headless

Instagram's story composer has to render, in a visible, portrait, phone-sized viewport:

- it mounts a lazy + menu;
- it draws the photo on a canvas;
- it reads the screen orientation.

Every invisible host breaks one of these:

- a background tab stops rendering;
- an offscreen document has no display;
- `chrome.debugger` emulation shows a "started debugging this browser" bar in every window.

### What is recommended: Option 1

- **Where things run.** instapost's editor opens as a panel inside the Instagram page. Instagram's own mobile composer runs in a phone-sized frame inside that same page, and the panel shows it as a small live phone while the post runs.
- **What disappears.** No window, no pop-up, no resize, no focus change, and the owner never leaves Instagram. Every Arc window quirk (F1, AM29) disappears with the window.
- **What stays the same.** The whole autopilot is reused unchanged:
  - the agent, its three taps and Share-once;
  - the outcome rules;
  - the rate guard;
  - the kill switch and its lock.
- **A quality gain.** The frame's size no longer depends on the screen, so the upload can reach 1080×1920 on the MacBook (§3.11).

### What it costs (owner decisions OD15–OD19)

1. **A deliberate bypass of a clickjacking defence.** For about 20 s per run, in that one tab, instapost removes Instagram's `X-Frame-Options: DENY` from Instagram's mobile document. Research §5.4 said to avoid this.
2. **A new server-visible signal.** Instagram receives its mobile page requested as an iframe (`Sec-Fetch-Dest: iframe`), which no real client sends.
3. **A content script on www.instagram.com**, for the entry button and the panel. instapost is then present in every desktop Instagram page.
4. **The desktop page's requests change too.** During a run, the page's own requests in that tab also carry the Android profile, because dNR cannot tell the frame's requests from the page's (§3.6).

### Rejected

- Option 2, a background tab with `chrome.debugger`: the infobar, and hidden tabs don't render.
- An offscreen document: it never renders visibly.
- The side panel: Arc has no Chrome side panel.
- A hidden tab with zoom: it cannot be made portrait.

### Next step

**Spike S12** (§10), one engineer, about 4–5 days:

- a separate build that cannot post (a static write block, and no post mode);
- it proves the engine frame in Arc against real Instagram with a Check and Test runs (L24–L28), plus one optional Share test (L29).

The window lane stays as the fallback.

---

## 1. What the owner is asking for

| # | Requirement | Source |
|---|---|---|
| W1 | Start from instagram.com and never leave the page | owner |
| W2 | One subtle surface to edit and post; nothing else opens | owner |
| W3 | No new windows, pop-ups, resizes or focus changes | owner |
| W4 | One click after editing; nothing to do in Instagram (ux.md P1) | AM39 |
| W5 | The same safety: the rate guard, the kill switch and its 7-day lock, Share once, results from evidence, write-blocked tests, never logging in | ux.md §1.2 |
| W6 | The owner can see what instapost does in Instagram (ux.md P5) | ux.md |
| W7 | Works in Arc 155 on macOS, on the MacBook and on the ultrawide | strategy, F1 |

"Headless" is read as W2 + W3: nothing to manage. An engine that cannot be seen at all is not a goal unless S12 shows it works and the owner wants it (N15, §10.7).

---

## 2. Facts this design rests on

### 2.1 Checked today (2026-10-14)

Sources:

- F4–F6: logged-out HTTP checks;
- F7–F9: a reading of the saved logged-out msite bundle `scratchpad/rotate/story.js`, 2026-10-12.

| Id | Fact |
|---|---|
| F4 | `https://www.instagram.com/` answers `X-Frame-Options: DENY`, for both the desktop UA and the Android UA |
| F5 | Its `Content-Security-Policy` lists `*.instagram.com` in `frame-src` and `child-src`, and has **no `frame-ancestors`** |
| F6 | `Cross-Origin-Opener-Policy: same-origin-allow-popups`. COOP applies only to top-level documents, so it is ignored in a frame |
| F7 | **No frame-busting.** msite has no `top !== self → top.location = …`, no `frameElement`, no clickjacking guard and no `IntersectionObserver` `trackVisibility` |
| F8 | **msite navigates `window.top` itself on a failed write.** `PolarisInstajax`'s error path does: on a non-GET request that fails with a JSON `checkpoint_url` or `redirect_url`, set `window.top.location.href` to it. msite also writes `window.top.location` in its "open in app" flows, which instapost never taps. Consequence, in a frame: a checkpoint during a run takes over the owner's desktop page. That is why the engine frame is **not sandboxed** (§3.10) and why the page's own URL is watched during a run (§3.14) |
| F9 | **msite is frame-aware.** It checks `window.top === window` in 7 places, and when framed it skips: its time-spent logging and `WebSession` extension, `getInstalledRelatedApps`, and a cookie-store helper. msite can tell that it is framed, and a framed msite sends less telemetry than a top-level one. It also keeps a logging id (`ht_persistent_session_id`) in sessionStorage (§3.9) |

### 2.2 Already established

- **F1:** Arc ignores popup bounds. Most of the window code exists because of it.
- **F2 / AM30:** Instagram's service worker has no fetch handler and claims every client.
- **F3 / AM31:** msite renders its + → Story entry only at 767 CSS px or narrower.
- **C3a / C3b:** + → Story checks the viewport; the composer checks `screen.orientation`, hence the portrait shim.
- **C13 / AM40:** the result is decided from resource timing.

### 2.3 Platform

Sources: Chrome docs and Chromium sources, saved 2026-10-11.

- **dNR conditions:** `tabIds` (session rules only), `requestDomains`, `initiatorDomains`, `topDomains` (Chrome 145+), `resourceTypes`, `responseHeaders` (Chrome 128+).
  - There is **no frame condition** and **no request-header condition**.
  - Response headers can be modified.
  - For request headers, only `append` is restricted (an allow-list). `set` and `remove` have no documented restriction.
- **dNR also applies to the extension's own pages** (side panel, offscreen): research, `ruleset_manager.cc`.
- **`chrome.debugger` infobar** (`debugger_api.cc` `ExtensionDevToolsClientHost::Attach`): attaching shows the "started debugging this browser" infobar unless the browser runs with `--silent-debugger-extension-api` or the extension is policy-installed.
- **File inputs through the debugger:** `MayReadLocalFiles()` is the extension's "Allow access to file URLs". DevTools' `DOM.setFileInputFiles` depends on it.
- **Offscreen documents:** `chrome.offscreen` reasons include `IFRAME_SCRIPTING`.

### 2.4 Policy so far

- **Research §5.4, "Avoid these":**
  - stripping X-Frame-Options or CSP to iframe instagram.com;
  - forging `origin` or `sec-fetch-dest`.
- **What INSSIST did** (MV2, 2022 copy):
  - it stripped XFO **and CSP** on every Instagram response;
  - it set `sec-fetch-dest: document` and forged `origin` on every request from its tab;
  - it ran an iPhone UA.

  instapost does none of the forging (§3.7) and never strips CSP.
- **Strategy §1 item 7:** "no `content_scripts`, no `web_accessible_resources`". check-bundle T1 bans both, and bans the `webRequest` and `debugger` permissions.

---

## 3. Option 1: an in-page panel with an embedded mobile frame

### 3.1 Shape

```
The Instagram tab: https://www.instagram.com/… (Instagram's own desktop page; never edited)
│
└─ <div>, appended to <html> by instapost's content script, with a closed shadow root
   ├─ the Story pill ..................................... instapost UI in Instagram's document
   ├─ the panel:  <iframe src="chrome-extension://<dynamic id>/panel.html">
   │              the editor, in the extension's origin
   └─ the engine: <iframe src="https://www.instagram.com/" referrerpolicy="origin" allow="…">
                  only while a run is in progress
        └─ Instagram's mobile site, with the portrait shim (MAIN world) and the composer agent
           (isolated world), both injected with frameIds:[engine]
```

The background runs the same autopilot (reducer, agent commands, outcome rules) against the engine frame instead of a popup's top frame.

### 3.2 Entry point

- **E1, always available.** The toolbar icon and ⌥⇧S toggle the panel on an instagram.com tab. Outside Instagram they open the editor tab, as today. E1 needs no anchor in Instagram's page.
- **E2, the Story pill.** It sits next to Instagram's own **Create** item in the left navigation, the place a person looks to make something.
  - It is never inserted into Instagram's React tree. It is a fixed-position element in instapost's own host, placed over the navigation by measurement.
  - It is measured with `getBoundingClientRect` and a `ResizeObserver`, and measured again on scroll, on resize and on every URL change of the page.
- **Finding the anchor.** The search is structural and reads no text, so it works with a Spanish UI too (L21):
  1. **The navigation** is the smallest element that:
     - contains links whose pathname is at least two of `/explore/`, `/reels/` and `/direct/inbox/`;
     - is at most 400 px wide;
     - touches the viewport's left edge (`rect.left ≤ 16`).
  2. **Its items** are its outermost pressables that contain an svg (`a[href]`, `[role=link]`, `[role=button]`), in document order.
  3. **Create** is the last item with `href="#"` (or no href) between the `/direct/inbox/` link and the account link (`/<handle>/` holding an image, C14's rule). It must be exactly one item, else there is no anchor. Search and Notifications are also `#` items, but they come before Messages.
  4. **Placement.**
     - In the wide navigation (at least 180 px, with labels): the pill sits inside the Create row, at its right end.
     - In the collapsed navigation (icons only): a 28-px round badge just below the Create icon.
- **Fallback.** When there is no anchor within 3 s (narrow layouts with Instagram's bottom bar, other page types, or Instagram drift):
  - a 36-px round button is fixed at the right edge of the viewport, vertically centred;
  - the bottom-right corner is left alone, because Instagram's Messages bubble lives there;
  - the owner can drag the button along the edge, and its position is remembered (storage.local).
- **Setting.** "Show the Story button on Instagram", on by default (OD17). When it is off, E1 is the only entry.

### 3.3 The panel: shadow DOM or an extension-page iframe

| | Shadow DOM in Instagram's document | Extension page (`panel.html`) in an iframe |
|---|---|---|
| **Code** | The editor (Preact, raster, fonts) bundled into the content script and injected into every Instagram page | The existing editor page; the content script stays a few KB |
| **Storage** | `indexedDB` and `localStorage` would be instagram.com's: photos and drafts readable by Instagram's JS | The extension's own (subject to N4) |
| **Keyboard** | Key events cross the shadow boundary, retargeted to the host: Instagram's document listeners see the text being typed | Cross-origin: Instagram sees nothing |
| **Images, canvas, fonts** | Reachable by Instagram's JS through the shared document (a closed root hides nodes, not resources or events); `@font-face` must be declared on Instagram's document; the page CSP governs the editor's `blob:` images | Own document, own CSP (`'wasm-unsafe-eval'` kept) |
| **User activation (§3.13)** | Every click or key in the editor activates Instagram's document, and with it the same-origin engine frame. Every Post click would then delay the run by about 5 s, and typing text would keep the Story tap blocked | A click in the panel does not activate the engine frame (N5) |
| **Detectable by Instagram** | A shadow host; injected styles | A host plus a cross-origin frame. The frame's URL carries a per-session id (`use_dynamic_url`), so a page cannot probe for instapost at a fixed URL |
| **Manifest** | Content script only | Content script, plus `web_accessible_resources: [{resources: ["panel.html", "chunks/*", "assets/*"], matches: ["https://www.instagram.com/*"], use_dynamic_url: true}]` |

**Decision: an extension-page iframe.**

Open points for the iframe:

- **N3:** Instagram's page CSP does not block it. Its `frame-src` does not list `chrome-extension:`; Chromium is believed to exempt loads that a content script starts from the page's CSP.
- **N4:** its storage is not partitioned. Chrome partitions third-party iframes' storage by top-level site; an exemption for extension frames whose extension has host permission for the top site is believed, unverified. If the storage is partitioned:
  - the panel keeps drafts and exports through the background (a port with chunked bytes) instead of its own IndexedDB;
  - the background's IndexedDB is the extension's, unpartitioned.
- **The editor port check:** `isOwnPage` in `background-main.ts` must accept the panel's dynamic URL (check `sender.id` and the extension origin, dynamic form included).

### 3.4 Where the engine frame lives

The engine frame is a **direct child of Instagram's top document**, a sibling of the panel, never nested inside the panel.

- **Cookies.** The ancestor chain www → www is same-site, so the frame gets first-party cookies (`SameSite=Lax` and `Strict` included) and unpartitioned storage: the logged-in session is simply shared.
  - Nested inside the panel, the chain would be www → chrome-extension → www, which is cross-site:
    - Chromium computes no site-for-cookies;
    - `SameSite=Lax` and `Strict` cookies are withheld;
    - third-party cookie settings apply;
    - msite's `document.cookie` (`csrftoken`) may come back empty.

    That is unverified, and there is no reason to find out.
- **Same origin.** The frame is same-origin with the desktop page. The consequences are in §3.12, §3.13 and §3.15.
- **Created per run.** The frame is created when the run starts, after the rules are in place, and removed when the run ends. Between runs there is no frame and no rule.
  - Opening the panel never loads Instagram's mobile page. Pre-loading it would lengthen both the XFO bypass and the Android-profile window, and would send one more framed request per panel opening.
- **Never moved.** Moving an iframe element in the DOM reloads its document. The content script only restyles its container: the phone in the panel, the chip when minimised (§7.4).

### 3.5 The network rules, exactly

All three are session rules, installed in one `updateSessionRules` call before the frame is created. They are removed in one call once the frame is gone, and also at startup and on `onInstalled`, as today. The cleanup range grows from 1001–1019 to 1001–1029.

```jsonc
// 1001: the Android profile (variant U3, §3.6), for this run only.
// Today's rule 1001 minus main_frame.
{ "id": 1001, "priority": 1,
  "action": { "type": "modifyHeaders", "requestHeaders": [
    { "header": "user-agent",         "operation": "set", "value": "<androidReducedUa(155)>" },
    { "header": "sec-ch-ua-mobile",   "operation": "set", "value": "?1" },
    { "header": "sec-ch-ua-platform", "operation": "set", "value": "\"Android\"" },
    { "header": "sec-ch-ua-platform-version", "operation": "remove" }
    /* … and the 7 other CH_REMOVE headers, as today */ ] },
  "condition": { "tabIds": [TAB], "requestDomains": ["www.instagram.com", "i.instagram.com"],
                 "resourceTypes": [ /* ALL_RESOURCE_TYPES without "main_frame" */ ] } }

// 1020: let the engine frame render
{ "id": 1020, "priority": 1,
  "action": { "type": "modifyHeaders",
              "responseHeaders": [ { "header": "x-frame-options", "operation": "remove" } ] },
  "condition": { "tabIds": [TAB], "requestDomains": ["www.instagram.com"],
                 "resourceTypes": ["sub_frame"] } }

// 1002–1010: the test write block, unchanged: rehearsalRules(TAB), tabIds [TAB, -1], priority 100
```

- **Rule 1001 and the page's own document.** Rule 1001 differs from today's only by leaving out `main_frame`, so the desktop page's own document never gets the Android profile: a reload of the tab during a run stays desktop.
- **Rule 1020 and its scope.**
  - Rule 1020 matches only `sub_frame` responses from www in that one tab. XFO matters only on documents, so nothing else changes.
  - Only the engine frame should be a www sub_frame in that tab (N9: desktop Instagram is not known to embed www frames of its own).
  - It is never installed in any other tab, and never outside a run.
- **Rule ids.** Ids 1020–1029 are reserved for this lane, and `SESSION_RULE_LAST_ID` becomes 1029.
- **CSP is not touched:**
  - Instagram's response has no `frame-ancestors` (F5), so XFO alone decides whether it may be framed.
  - The desktop page's own CSP lists `*.instagram.com` in `frame-src` and `child-src` (F5), so the page may frame www.
  - The panel frame relies on N3.
  - Stripping CSP would remove Instagram's XSS defence from the frame: never.
  - If Instagram adds `frame-ancestors` one day, the lane ends with `FRAME_REFUSED` and the window lane remains (R27).
- **Lifetime.**
  - The rules are installed when the run leaves `queued`. They are removed after the frame is removed (as today: close first, then remove the rules).
  - A possibly running upload (ux.md §6.4) keeps the frame and the rules for up to 15 minutes. The page must stay open meanwhile (§7.6).

### 3.6 Giving the frame a mobile profile inside a desktop tab

For each request, dNR sees: the tab, the URL, the initiator, the top-level domain and the resource type. Inside one tab, the engine frame and the desktop page share all five, with one exception:

- the frame's **own document request** is `sub_frame`;
- the page's own document request is `main_frame`.

Every later request is indistinguishable: XHR and fetch calls to www and i, scripts and images. They come from the same tab, with the same initiator (www) and the same top domain (www), and with the same types. Nothing else can tell them apart:

- MV3 has no `webRequestBlocking`;
- `topDomains` is the top document's domain;
- there is no frame condition.

So there are three variants:

| Variant | Scope of rule 1001 | The frame's document | The frame's XHRs (graphql, logging, upload, publish) | The desktop page's own XHRs in that tab during the run | Proven? |
|---|---|---|---|---|---|
| U1, document only | `sub_frame` on www | Android | Desktop UA and desktop client hints, with msite's app id | Unchanged | No: even the publish request would differ from L20 |
| U2, document and writes | `sub_frame`, plus two rules (1021, 1022) on `rupload_igphoto` (i) and `configure_to_story` (www) | Android | Reads desktop; upload and publish Android | Unchanged (no writes of its own during a run) | Writes as in L20; reads are new |
| **U3, the whole tab for the run** | Every type except `main_frame` | Android | Android: identical to the popup since L17 | Android for the run's ~20 s | msite side identical to L18 and L20 |

- **Does the server classify only the document request?**
  - Research §5.1 and C1: `is_mobile` follows the User-Agent of the document request (curl tests).
  - Whether Instagram's API endpoints (`configure_to_story`, `rupload_igphoto`) look at the UA is unknown.
  - A Test run cannot find out: writes are blocked, so the upload ends with status 0 and the publish request is never sent. Only a real post can tell.
- **Do the frame's XHRs with the desktop UA matter (U1, U2)?**
  - They would pair msite's app id (`1217981644879628`, strategy §2.3) with a Mac UA and `sec-ch-ua-mobile: ?0`. No real client sends that combination, and it would last for the frame's whole life.
  - Whether msite even works that way is the question L27 answers.
- **Applying the UA rule tab-wide for the duration of the post** is U3, scoped to the run (from Post to the close) and excluding `main_frame`.
  - Its new inconsistency: during the run, the desktop page's own background requests (logging, graphql polling) carry the Android profile with desktop's app id.
  - That means about 20 s at a time, at most 6 times an hour.
- **Recommendation: U3 (OD16).**
  - The msite session keeps byte-for-byte the profile the owner already accepted and that already posted (L18, L20).
  - The anomaly is bounded in time.
  - The publish path does not change.
  - S12 also runs U1 (L27). If msite works with desktop-UA reads, U2 becomes a candidate after one real post made with it.
- **Not considered:**
  - per-request rewriting by frame through `chrome.debugger`'s Fetch domain: that is Option 2's footprint;
  - MAIN-world overrides of `navigator.userAgent`: they leave the headers as they are and add more page-visible lies.

### 3.7 `Sec-Fetch-Dest: iframe`

- **What is sent.** The engine document request carries:
  - `Sec-Fetch-Dest: iframe`, `Sec-Fetch-Mode: navigate` and `Sec-Fetch-Site: same-origin`;
  - `Referer: https://www.instagram.com/`. With `referrerpolicy="origin"` on the iframe; the default policy would send the full URL of whatever desktop page the owner is on.

  Today's popup sends `Sec-Fetch-Dest: document` and `Sec-Fetch-Site: none`.
- **Could dNR change it?**
  - The dNR docs restrict only `append` on request headers; `set` on `sec-fetch-dest` is not documented as refused.
  - Whether Chromium's network service sets the fetch-metadata headers again after an extension's change is unverified.
  - INSSIST 2022 forged it through webRequest.
- **instapost never forges it:**
  - research §5.4 says so;
  - a forged value is a lie the server can cross-check: `document` together with `navigate`, `same-origin` and a Referer is itself an unusual combination.

  It is neither tested nor built.
- **Could Instagram refuse framed requests?** Yes: it could answer them differently, with an error page, the desktop shell or a login wall. S12 sees that directly, through C1 and C2 in the frame: `FRAME_REFUSED`, `DESKTOP_SHELL` or `NOT_LOGGED_IN`.
- **Could Instagram flag them?** instapost cannot see that.
  - Because of XFO DENY, Instagram is never framed legitimately.
  - So a logged-in msite document with `Sec-Fetch-Dest: iframe` is probably this design's most distinctive new fingerprint.
  - F9 adds that msite's own code knows it is framed (R23).

### 3.8 Service worker scope with a framed client

- **The frame becomes a client of Instagram's worker.** It is a window client (`frameType: "nested"`) in the root scope.
  - msite registers the mobile-parameter worker (`enableAddToHomeScreen=true`), whose URL differs from the desktop page's.
  - A new worker therefore installs, calls `skipWaiting()` and `clients.claim()`, and takes control of the frame, the desktop page in the same tab and every other Instagram tab.
- **This is no change from today.** The popup does exactly the same (F2, AM30). The only difference: one of the claimed pages is the one the owner is looking at (a `controllerchange` there, harmless without a fetch handler).
- **Requests stay with the tab.** There is no fetch handler, so the frame's requests stay attributed to the tab and the tab-scoped rules apply. The tripwire (`workerStart > 0` → `SW_INTERCEPTS`) runs unchanged in the frame's agent.
- **No hard reload.** A subframe cannot be reloaded with `tabs.reload`, and the hard reload's reason (AM2: a first load served by the worker) is gone since AM30. The frame is new for every run, and C1 decides `DESKTOP_SHELL` as today.
- **A small difference: push.** The worker may see the nested client in `clients.matchAll()`. It is a diagnostic surface only, and part of R23.

### 3.9 Cookies and storage

- **Cookies are shared.** The chain is same-site, so the frame sends the owner's Instagram cookies exactly as the desktop page does (`sessionid`, `csrftoken`, …), and msite's `document.cookie` reads them.
  - There is nothing to log in to.
  - The `NOT_LOGGED_IN` rules are unchanged.
- **`localStorage` and IndexedDB** are shared with every Instagram tab, as with today's popup.
- **New: sessionStorage is shared with the desktop page.** sessionStorage belongs to a tab and an origin, and today's popup was a separate tab.
  - msite keeps a logging id in sessionStorage (`ht_persistent_session_id`, F9). If desktop Instagram uses the same module, the msite session and the desktop tab session share that id in Instagram's telemetry (R26).
  - S12 records the shared key names, never their values (N12).
- **History is shared too.** The tab's joint session history receives msite's own `pushState` entries (`/create/story/`, then `/`). Back after a run may first step through entries of the removed frame before it reaches the previous page (N12, §7.6).

### 3.10 Sandbox and the other iframe attributes

```html
<iframe src="https://www.instagram.com/" referrerpolicy="origin" loading="eager"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none';
               payment 'none'; clipboard-read 'none'; web-share 'none'">
```

**Sandbox flags against what Instagram needs:**

| Flag | Needed by Instagram | Effect if left out |
|---|---|---|
| `allow-scripts` | yes | msite does not run |
| `allow-same-origin` | yes: cookies, storage, service worker, its XHRs | logged out; nothing works |
| `allow-forms` | the story form is only a container; uploads are XHR | probably nothing (N7) |
| `allow-top-navigation` | **yes, for safety:** msite sends `window.top` to Instagram's checkpoint or login URL when a write fails (F8) | the navigation is blocked silently, and the kill switch never sees a checkpoint (a challenge would read as `UPLOAD_FAILED`) |
| `allow-popups`, `allow-modals`, `allow-downloads` | no | nothing on the autopilot's path |

**Decision: no `sandbox` attribute.**

- Without `allow-top-navigation` the kill switch goes blind to Instagram's own checkpoint redirect (F8).
- With `allow-scripts` and `allow-same-origin` together, the frame could lift its own sandbox anyway, so a sandbox would not be a security boundary.
- What a sandbox would have protected against (msite navigating the owner's page) is exactly what instapost must let happen and observe (§3.14).

**The other attributes:**

- **`allow`:** a same-origin frame inherits the page's permissions. Denying camera, microphone and the rest keeps msite's camera paths shut; instapost never needs them.
- **`referrerpolicy="origin"`:** see §3.7.
- **Not used:**
  - `credentialless`: it drops cookies;
  - the `csp` attribute: it asks Instagram to apply a CSP, which Instagram should never be asked to do.

### 3.11 Viewport, DPR and the portrait shim in a subframe

- **The frame's viewport is its box.** The layout viewport is the iframe's CSS box:
  - `innerWidth` and `innerHeight` are W×H;
  - `matchMedia('(orientation: portrait)')` matches;
  - W ≤ 767 gives msite's mobile header (F3), and C3a passes at + → Story.
- **Scaling changes only what the owner sees.** A CSS `transform: scale(s)` on the frame's container shrinks what the owner sees. It does not change W×H, `devicePixelRatio` or the frame's canvas sizes.
- **So instapost chooses the frame's size, not the screen.** `frameBox(dpr)` sets W = min(720, floor(1080 ÷ dpr), even) and H = W × 16 ÷ 9:

  | DPR | Frame | Where |
  |---|---|---|
  | 2 | 540×960 | the MacBook |
  | 1 | 720×1280 | the ultrawide |
  | 3 | 360×640 | |

  - If the composer's canvas follows viewport × DPR (C8, still open), the upload becomes:
    - 1080×1920 on the MacBook (the window today: about 1012×1800);
    - 720×1280 on the ultrawide (the window today: about 506×900).
  - S12 measures it (N10).
  - This removes window fitting entirely: AM29's schedule, F1, `WINDOW_NOT_FITTED`, `SCREEN_TOO_SMALL` and `LAYOUT_TOO_WIDE`.
- **The frame's DPR** is the display's scale times the Instagram tab's page zoom. A zoomed Instagram tab changes it, and the record notes it.
- **The portrait shim is still needed.**
  - `screen.*` is the real display, which is landscape, so C3b fails without the shim.
  - The shim runs in the frame's own window: `scripting.executeScript({target: {tabId, frameIds: [engineFrameId]}, world: 'MAIN', injectImmediately: true, func: portraitShim, args: [true]})`.
  - Every frame has its own `Screen` and `ScreenOrientation`, so the desktop page's are never touched (N6).
  - The agent goes into the same frame id (ISOLATED world).
  - check-bundle T3's shape check changes from `frameIds:[0]` to "one frame id taken from the session" (§8).
- **What Instagram's code in the frame can still see:**
  - `window.top !== window` (F9);
  - a 540-px viewport on a 1512-px-wide screen;
  - `document.hasFocus() === false`, because focus is in the panel;
  - that `getInstalledRelatedApps` was skipped.

### 3.12 Rendering and throttling

- **Visibility belongs to the page.** `document.visibilityState` is per page: the frame is `visible` while the Instagram tab is the active tab of a visible window, whatever the frame's size or position.
- **Visible but small, never hidden.**
  - Chromium's documented render throttling (no `requestAnimationFrame`, no paint) targets iframes that are **cross-origin** to the main frame and hidden or offscreen. The engine frame is same-origin with the page, so it is believed not to be throttled even when covered (unverified in 155, N15).
  - The design does not rely on that: the frame stays on screen and visible, scaled.
  - It is never `display:none`, which gives a 0×0 viewport in which msite collapses.
  - It is never `visibility:hidden`.
  - F7: msite does not use IntersectionObserver v2, the API that reports a scaled or covered frame as "not visible".
- **One main thread for both.** The frame shares the desktop page's process and main thread, because they are same-origin. Instagram's desktop work delays msite's tasks and the other way round.
  - The autopilot's budgets (ux.md §10) leave room for that.
  - The Steps row records the timings.
- **The owner switching tabs:**
  - **Before Share:** the page becomes hidden. As today, taps wait, and Share is sent only to a visible page. There is no window to raise, and instapost never switches tabs back by itself: it waits. After the 2-minute pre-Share cap it stops with `TAB_HIDDEN`.
  - **After Share:** the tab may stay hidden. The XHRs continue; the agent's 250-ms batches arrive about every second. Intensive throttling only starts after 5 minutes hidden, inside the 15-minute hold.

### 3.13 User activation

- **How Chromium propagates it.** User Activation v2 activates the clicked frame, its ancestors, and every frame of the page that is same-origin with the **clicked** frame ("same-origin visibility").
- **A click in the panel** (extension origin) activates the panel and Instagram's top document (an ancestor). It is believed not to activate the engine frame (N5).
- **A click or key on Instagram's own page, or on any instapost element in Instagram's document (the pill)**, activates the top document **and the same-origin engine frame**. Within about 5 s of it, the Story item's `input.click()` would open a real OS file chooser (R22).
  - The tap guard already refuses while `navigator.userActivation.isActive`.
  - In-page, the owner is on Instagram and likely to click, so the guard waits up to **30 s** instead of 6, with the line `Waiting until you stop clicking on Instagram for a moment…`. After that the run stops with `PAGE_IN_USE`.
  - The wait matters only before the Story tap and the insert; + and Share are not affected by activation.
- **Clicks on the engine frame itself never reach it.** The frame has `pointer-events: none` during the autopilot. Finish by hand turns them on.
- **That is why** the panel is an extension frame (§3.3) and why there is no scrim in Instagram's document: a scrim element there would be a same-origin click target.

### 3.14 Seeing the frame's navigations: the kill switch in a frame

`tabs.onUpdated` reports only the top document, so today's kill switch does not see the frame. Four sources replace it:

1. **webRequest, observational (a new permission, OD19).**
   - Events: `onBeforeRequest`, `onBeforeRedirect`, `onHeadersReceived`, `onCompleted` and `onErrorOccurred`.
   - Filter: `types: ['sub_frame']` and `urls` on www and i, filtered in code to the run's tab with `parentFrameId === 0`.
   - What it gives:
     - the engine `frameId`;
     - every document URL;
     - every redirect target (a redirect to facebook.com or Accounts Center shows as `redirectUrl` even without host permission there);
     - the status;
     - whether XFO was present;
     - errors such as `net::ERR_BLOCKED_BY_RESPONSE` (the frame refused; whether webRequest reports it that way is unverified, and source 2 is the backstop).
   - Nothing is blocked and no body is read.
   - The listeners are registered at worker start (MV3), so the worker also wakes for www sub_frames in other tabs, which are rare.
2. **The content script.**
   - It reads `iframe.contentWindow.location.pathname` (same origin, from the isolated world; unverified, and sources 1 and 3 cover it otherwise) at every `load` and every 250 ms during a run. That catches same-document moves: `pushState` to `/create/story/`, back to `/`.
   - A `SecurityError` means the frame left www.
3. **The agent:** its own `composer-left` and path facts, unchanged.
4. **The page itself during a run, through `tabs.onUpdated`** for the run's tab and the content script's port. F8 says msite moves the page itself to a checkpoint.
   - **A security page** in the page's URL (`/challenge`, `/checkpoint`, `/auth_platform`, any `/accounts…` but login): kill and lock. This is the same classifier, whoever navigated: an `/accounts/edit/` the owner opens during a run counts too. That errs on the safe side and is rare.
   - **A login URL:** stop (`NOT_LOGGED_IN`).
   - **The content script's port disconnects** (the document went away: reload, closed tab, another URL, back-forward cache): `PAGE_LEFT`.
   - **Same-document route changes** of the desktop page (feed → profile): ignored.

**Classification:**

- `classifyComposerUrl` stays unchanged for the frame's URLs.
- A frame that **never** reached a readable www document is the new **`FRAME_REFUSED`** (close, no lock). That covers `ERR_BLOCKED_BY_RESPONSE`, a 4xx or 5xx document, an unreadable first load with no observed off-host URL, and no `load` within 30 s. So a missing or failed rule 1020 is never mistaken for an off-host kill.
- An off-host URL seen in a redirect, or a frame that becomes unreadable after having been readable: `KILLED_OFFHOST` (kill and lock), as today.
- An off-host navigation of the **page** itself (the owner typing a URL) is `PAGE_LEFT` without a lock. This is weaker than the popup, where any off-host URL locked, because the owner never navigated the popup. It is recorded as a delta in §3.16.

### 3.15 What the desktop page in the same tab sees

| What | Detail | Today (popup) |
|---|---|---|
| instapost's host element | A `div` under `<html>` with a closed shadow root, on every page while the content script runs. A DOM walk or a `MutationObserver` on `<html>` sees it | Nothing in desktop tabs |
| Frames in `window.frames` | **The panel:** cross-origin, with a dynamic URL, while it is open. **The engine:** same-origin during runs; Instagram's desktop JS can read its DOM, `location` and `window` | None |
| Its own requests | The Android profile during runs (U3, §3.6) | Unchanged |
| Its service worker | Replaced by the mobile-parameter worker (`controllerchange`) | The same happens to the other tabs |
| User activation | From panel clicks (as an ancestor) | None |
| A `beforeunload` listener | Added by the content script between Share and the result (§7.6) | None |
| sessionStorage and session history | Shared with msite (§3.9) | Separate |
| Its `screen.orientation` | Untouched: the shim lives in the frame | Untouched |
| Navigation by msite | On a write that fails with a checkpoint, msite navigates the **page** (F8) | It navigated the popup |

### 3.16 Account-risk delta compared with today

| Change | Seen by Instagram's server? | Direction |
|---|---|---|
| The msite document requested as a frame (`Sec-Fetch-Dest: iframe`, `same-origin`, Referer www), and msite logging as framed (F9) | Yes, every run | **New and distinctive** (R23) |
| XFO removed in the browser | No, but implied by the line above | New: a deliberate bypass of a clickjacking defence (OD15) |
| The desktop page's requests with the Android profile for about 20 s (U3) | Yes | New, bounded (R24) |
| A content script and a DOM node on every desktop Instagram page | Only to Instagram's JS, if it looks | New (R25) |
| Shared sessionStorage logging id and shared history | Possibly, in telemetry | New (R26) |
| An off-host navigation of the page during a run no longer locks (§3.14) | No | Slightly weaker kill switch |
| Removed: the popup, window fitting, the hard reload, the Android-UA top-level navigation (no `Accept-CH` persisted from it), focus changes | — | Removed |
| Unchanged: synthetic taps, the untrusted insert, the portrait shim, msite's app id with a desktop JS realm, the rate guard, the kill switch, Share once | — | Unchanged |

**Net:** the session stops looking like "a phone-shaped desktop window on msite" and starts looking like "msite embedded in desktop Instagram". The second does not occur naturally, which arguably makes it easier to single out (unverified whether Meta looks; R23).

**Mitigations:**

- the frame exists only during a run;
- at most 6 runs an hour;
- S12 runs tests only;
- the kill switch and its lock are unchanged;
- the window lane remains.

---

## 4. Option 2: a background tab with `chrome.debugger` emulation

### 4.1 Mechanism

A background tab (or a minimised window) at Instagram, then `chrome.debugger.attach({tabId}, '1.3')` and:

- `Emulation.setDeviceMetricsOverride({width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, screenOrientation: {type: 'portraitPrimary', angle: 0}})`: a portrait mobile viewport and screen whatever the window. No shim and no fitting are needed, and the DPR can put the canvas at 1920 px.
- `Emulation.setUserAgentOverride({userAgent, userAgentMetadata: {platform: 'Android', mobile: true, …}})`: the UA, the `Sec-CH-UA-*` headers and `navigator.userAgentData` become consistent for this target only. There is no tab-wide split as in §3.6.
- `Emulation.setTouchEmulationEnabled({enabled: true, maxTouchPoints: 5})`.
- `Input.dispatchTouchEvent` and `Input.dispatchMouseEvent`: trusted taps (`isTrusted: true`, with pointer events).
- `DOM.setFileInputFiles`: it needs a file on disk and "Allow access to file URLs" for the extension (`MayReadLocalFiles`, §2.3), so the `DataTransfer` insert would stay.

These give the fewest inconsistencies of any option (research §5.4 table).

### 4.2 Why it is rejected

- **The infobar.** While attached, Chromium shows "instapost started debugging this browser", with Cancel, in **every** window. Only `--silent-debugger-extension-api` or a policy install suppresses it (§2.3).
  - One attach per post means a bar appearing and disappearing across all windows and pushing every page's content down: exactly the disturbance the owner objects to.
  - Whether and where Arc shows it is unverified (N16).
- **A hidden tab does not render.** A background tab is hidden:
  - no `requestAnimationFrame` and no paint;
  - timers at most once a second;
  - intensive throttling after 5 minutes;
  - freezing or discarding.

  CDP has no override for visibility:
  - `Page.setWebLifecycleState({state: 'active'})` only unfreezes;
  - `Emulation.setFocusEmulationEnabled` fakes focus, not visibility;
  - `Page.bringToFront` makes the tab visible by showing it.

  A screencast might keep the tab painting while `visibilityState` stays `hidden` (unverified). Instagram's composer draws on a canvas and mounts a lazy menu, which is why the agent refuses to tap a hidden page (ux.md §4.6). "Invisible" here therefore means "not rendering".
- **Where the tab would live in Arc.** A background tab shows in the sidebar and can be archived; a minimised window animates into the Dock.
- **Permissions and policy:**
  - the `debugger` permission, whose install warning covers access to the page debugger backend and reading and changing all data on all websites;
  - strategy §2.1 excludes it, and check-bundle T3 bans `chrome.debugger`;
  - opening DevTools on that tab detaches the debugger;
  - a CDP-attached, logged-in Instagram tab, whose detectable side effects (the Runtime domain) must be avoided.

### 4.3 Risk delta

- **Better:** fewer inconsistencies visible to Instagram's JS, and trusted, human-shaped events.
- **New:** a debugger-attached logged-in tab, and the broadest install permission.

### 4.4 Verdict

Rejected for this request. It is worth remembering as the consistent-emulation engine on Chrome if the owner ever accepts the infobar.

---

## 5. Other approaches

### 5.1 Hidden tab, zoom and JS overrides

- A normal tab has its window's landscape viewport. A 2× zoom on 1512×860 gives 756×430 CSS px: narrow enough (F3), but still landscape, so + → Story shows the rotate toast (C3a).
- Overriding `innerWidth` and `innerHeight` in the MAIN world changes nothing in the layout and adds more lies visible to the page.
- A hidden tab does not render (§4).

Rejected.

### 5.2 An offscreen document

`chrome.offscreen` with the reason `IFRAME_SCRIPTING` would host the msite frame. It is invisible, but:

- it is never displayed, so its visibility, `requestAnimationFrame`, DPR and screen are uncertain (unverified);
- its requests belong to no tab (`tabId` −1, shared with every service worker), so the rules would need `topDomains: [<extension id>]` (Chrome 145+; whether extension ids match is unverified);
- its cookies rely on the first-party treatment of extension top-level pages (unverified);
- there can be only one per extension.

That is too many unknowns for something that must render. Rejected.

### 5.3 The side panel (`chrome.sidePanel`)

The editor and the msite frame would sit in Chrome's side panel, next to the page:

- portrait by nature;
- inside the window, with no resizes;
- an extension page at the top, so activation is isolated and cookies are first-party (unverified);
- rules scoped with `topDomains`, because side panel requests have no tab.

It is the cleanest engine on Chrome. Arc, however, has no Chrome side panel UI (unverified; N16: in the editor's console, `typeof chrome.sidePanel`, and whether `chrome.sidePanel.open()` shows anything).

Rejected for Arc; noted for Chrome, and in case the owner changes browsers.

### 5.4 The engine frame inside the editor tab

The editor tab, an extension page, would host the msite frame:

- the rules are scoped to the editor tab, where every Instagram request is the frame's, so rule 1001 stays tab-wide with no desktop page to contaminate (no U1–U3 question);
- activation is isolated;
- there is no content script.

The same XFO bypass and framed-document signal remain (`Sec-Fetch-Site` would be cross-site or `none`; unverified). It removes windows and resizes, but not "being taken away from Instagram".

It is the fallback if the owner accepts the frame but not the content script.

### 5.5 A quieter window

Reuse one docked window across posts, fitted once and parked. With `focused:false` it is covered, so it is hidden (macOS occlusion) and throttled, and it would still have to come to the front.

It gives fewer resizes, but the same windows. Rejected as the answer; it is a cheap polish if S12 fails.

### 5.6 Arc split view, Little Arc

The Arc research of 2026-10-12 found no extension API that creates or sizes Arc splits, and Little Arc is another window. Rejected.

---

## 6. Comparison and recommendation

| | No windows or resizes (W3) | On Instagram (W1) | Renders reliably | Arc | New server signal | Install footprint | Effort |
|---|---|---|---|---|---|---|---|
| **1 In-page frame** | yes | yes | yes (visible, same-origin) | yes (N checks) | framed msite document; Android profile on the page's own requests for about 20 s | content script, web-accessible panel, `webRequest` | medium |
| 2 Debugger emulation | an infobar in every window | the panel yes, the engine in a hidden tab | no (hidden tab) | infobar unverified | none new, fewer mismatches; CDP attached | `debugger` | large |
| 5.2 Offscreen | yes | the panel yes | unknown | unknown | framed | `offscreen` | medium, risky |
| 5.3 Side panel | yes | beside it | yes | **no** | framed | `sidePanel` | medium |
| 5.4 Editor-hosted frame | yes | no | yes | yes | framed | none new | small |
| Today's window lane | no | no | yes | yes, with fitting | — | — | done |

**Recommendation: Option 1, and only after S12 passes and the owner has decided OD15.**

- **The panel:** an extension-page iframe (§3.3).
- **The engine:** a same-origin sibling frame:
  - created per run;
  - sized by `frameBox(dpr)` and scaled into the panel;
  - `pointer-events: none` during the autopilot;
  - not sandboxed (F8).
- **The rules:** 1001 (U3, without `main_frame`) and 1020 (XFO, `sub_frame`), for the run only.
- **Observation:** `webRequest` (observational) plus the page-side sources of §3.14.
- **Fallback:** the window lane, kept in Settings (OD18).

---

## 7. UX spec (in-page)

Everything not mentioned here stays as in `docs/ux.md`.

### 7.1 Principles

ux.md P1–P6 hold. P5 now reads "a phone inside the panel" where it read "a window in front". Two new ones:

| # | Principle |
|---|---|
| P7 | **Never leave Instagram and never take focus.** No window, no tab switch, no resize. instapost waits instead of raising anything |
| P8 | **Instagram's own page is never edited.** instapost adds only its pill and its panel, in its own host. Instagram's DOM is read only to place instapost's own controls, and, at the owner's click, to read a post's or a mention's metadata (docs/repost.md RP-13–RP-16, strategy AM57) |

### 7.2 Entry

- **On an instagram.com tab:** the pill (§3.2), or the toolbar icon or ⌥⇧S, opens the panel. The panel page loads on first use.
- **Elsewhere:** the toolbar opens the editor tab, as today. Its Post card's secondary line adds `Post from Instagram ↗`, which opens www.instagram.com in the current window with the panel open on the same draft (subject to N4).
- **The first visit after the update:** a one-time tooltip on the pill, `Post a story from here`, dismissable.
- **The pill's states:**
  - idle: a plus and `Story`;
  - during a run: a progress ring;
  - afterwards, for 10 s: ✓, ! or ?, like the toolbar badge, which stays as it is.

### 7.3 The panel

```
┌──────────── Instagram's desktop page (unchanged, still usable) ────────┬─────────────────────────────────────┐
│                                                                       │ instapost · @handle           –  ✕  │
│                                                                       ├────────────────┬────────────────────┤
│                                                                       │                │ Photo · Text       │
│                                                                       │   stage 9:16   │ controls           │
│                                                                       │   (the export) │                    │
│                                                                       │                │ ┌────────────────┐ │
│                                                                       │                │ │ Post card      │ │
│                                                                       │                │ │ [ Post story ] │ │
│                                                                       │                │ └────────────────┘ │
└───────────────────────────────────────────────────────────────────────┴────────────────┴────────────────────┘
```

- **Placement and size.**
  - A drawer on the right, over Instagram, with no reflow of Instagram's layout.
  - 12 px from the top, right and bottom edges; width `clamp(420px, 44vw, 760px)`; rounded corners and a shadow.
  - At 680 px wide or more: stage and rail side by side. Narrower: the stage above the rail, and the rail scrolls. Under 900 px of viewport: the full width.
- **Header:** the brand, the account chip, minimise (–) and close (✕).
- **Esc** closes the panel when idle and minimises it during a run.
- **No scrim:** Instagram stays usable beside the panel.
- **The body is the editor of ux.md, unchanged:** §4.3 import (drop, ⌘V, Choose photo…, Recent photos, Continue draft), §4.4 editing, §4.5 the Post card K1–K13. Settings and History open inside the panel.
- **Input.** Dropping a photo on the panel works, because the panel is the editor page. ⌘↵, ⌥⌘↵, ⌘O and ⌘V work while the panel has focus, and Instagram's own shortcuts never see them.
- **Send to phone…** uses `navigator.share` in the panel. That needs Instagram's page to let the frame use `web-share` (its Permissions-Policy, N13). If refused, the button opens the editor tab to share.

### 7.4 The run view, with the live phone

```
┌─────────────────────────────────────────────────────┐
│ instapost     Posting to @handle's story      0:07   │
├──────────────────┬──────────────────────────────────┤
│ ┌──────────────┐ │ ● Instagram open — mobile site in │
│ │              │ │   this tab, 540 × 960             │
│ │  live phone  │ │ ● Logged in as @handle            │
│ │  (Instagram  │ │ ◐ Starting a story and adding     │
│ │   in a frame,│ │   your photo… 0:02                │
│ │   scaled)    │ │ ○ Share                           │
│ │              │ │ ○ Confirm                         │
│ └──────────────┘ │ Usually 15–25 seconds. You can    │
│ Instagram,       │ keep browsing; don't reload this  │
│ mobile site      │ page until it's done.             │
│                  │ [ Stop ]  Esc          Details ▸  │
└──────────────────┴──────────────────────────────────┘
```

- **The live phone** takes the stage's place and size.
  - It is the engine frame (W×H) scaled to the stage box, with `pointer-events: none`, a 1-px outline and the caption `Instagram, mobile site`.
  - It shows what the docked window showed: Instagram's home, the + menu, the story editor and the upload.
- **Steps:** the ux.md §4.6 table. Only step 1's copy changes:
  - active: `Opening Instagram's mobile site in this tab…`;
  - done: `Instagram open — mobile site in this tab, {w} × {h}`.
- **Minimise (–), or Esc, during a run:**
  - The drawer collapses to a chip below the pill, with a 72×128 live thumbnail (the same frame, restyled, never moved), a progress ring and the current step. A click restores the drawer.
  - ✕ during a run minimises too: the run belongs to the background.
- **Gone in-page:** the guided resize, the raise-once and the docking texts of ux.md §4.6.
- **New lines:**
  - `Waiting until you stop clicking on Instagram for a moment…` (§3.13);
  - `Paused: this tab is in the background. Come back to it to continue.` (the page hidden before Share; the badge shows `…`).
- **The account prompt (§4.8) and Finish by hand (§4.9)** appear in the panel. Finish by hand enlarges the phone to the drawer's height (scale about 0.85) and turns its pointer events on.

### 7.5 Results

- **The cards are ux.md §4.7 unchanged, shown in the panel.**
- **On Posted,** the phone stays on Instagram's home for 2 s (Instagram's own success toast), then fades and the frame is removed.
- **View story ↗** navigates **this** tab to `/stories/<handle>/` once the run is closed: the owner is already on Instagram.
- **Couldn't confirm with an upload possibly running:** the phone stays, minimisable, for up to 15 minutes. The panel says `Instagram may still be uploading in this tab. Keep this page open.`

### 7.6 Leaving the page mid-post

| The owner… | Before Share | After Share, until the result |
|---|---|---|
| moves inside Instagram (feed → profile: a same-document change) | nothing happens; the panel and the phone stay (N14) | the same |
| reloads, closes the tab, types a URL, or follows a link that loads a new document | the run stops: `Stopped — you left the Instagram page. Nothing was posted.` (`PAGE_LEFT`, no lock); the rules are removed | first, the browser's own "Leave site?" prompt (the content script's `beforeunload`; it needs the page's sticky activation, which the Post click gave it; N11). If they leave anyway: Couldn't confirm, with the why `the Instagram page was closed before Instagram answered` |
| switches to another tab or another app | taps wait, with `Paused: this tab is in the background…`; the run carries on when the owner is back; after 2 minutes: `TAB_HIDDEN` | the run carries on: the upload runs in the background |
| clicks on Instagram's page | the run waits up to 30 s (§3.13), then `PAGE_IN_USE` | no effect |
| presses Back after the run | — | may step through msite's history entries first (N12) |

Never: instapost reactivating the tab, reopening the frame elsewhere, or retrying.

**Instagram itself moving the page** to a checkpoint or a login (F8) is the kill switch's case (§3.14): `KILLED_CHALLENGE` with the lock, or `NOT_LOGGED_IN`. The owner then sees Instagram's own page, which is what Instagram wants them to see. The next panel shows the pause banner (ux.md §4.10).

### 7.7 Several Instagram tabs

- **The pill and the panel exist in every Instagram tab.**
- **One run at a time** (`HANDOFF_BUSY`). A run belongs to the tab it started in, because its rules are scoped to that tab.
- **The other tabs:**
  - their Post cards show K7 as `A post is running in another Instagram tab. Show it`, which activates that tab;
  - their pills show the progress ring.
- **There is one draft** (IDB `docs`, `lastDocId`).
  - Editing it in two panels at once is last-write-wins.
  - A panel that regains focus reloads the draft if it changed, with the note `Updated from another tab`.
- **Closing the run's tab:** §7.6.
- **The editor tab, if open, and the panels** share the lane and History.

### 7.8 Settings, onboarding and the fallback

- **Settings:**
  - `Show the Story button on Instagram`, on by default.
  - Advanced → `Post using: [This Instagram tab] / [A separate window]`. The separate window is the window lane of ux.md §4.6, kept as the fallback (OD18).
  - After `FRAME_REFUSED` twice in a row, the Post card suggests the window once.
- **Onboarding (ux.md §4.2).**
  - The card's first paragraph becomes: `When you press Post story, instapost opens Instagram's mobile site in a small phone inside this panel and does the taps for you: + → Story, your photo, Share.`
  - Opened from Instagram, step 1 ("Log in to Instagram in a normal tab") is omitted. `NOT_LOGGED_IN` still says so when it happens.
  - The setup test stays required once (OD10).
- **The rest is unchanged:** the guarded builds' banner, the pause banner, History and Details. The Details Window row becomes a **Frame** row: `540×960 at DPR 2, scale 0.76, in this tab · U3 · rules 1001, 1020`.

### 7.9 Copy changes

The table uses ux.md §5's columns. All text goes through the i18n catalog being added on `feat/es-locale` (`src/ui/catalog.en.ts`), the pill's label included.

| Code | Where | Title | Body | Primary | Secondary |
|---|---|---|---|---|---|
| **`FRAME_REFUSED`** (new) | Step 1 | Instagram didn't open inside the page | Instagram's mobile site refused to load in this panel ({detail}). Nothing was posted. | Use a separate window | Send to phone… |
| **`PAGE_LEFT`** (new) | Before Share | Stopped — you left the Instagram page | The page reloaded or closed, so instapost stopped. Nothing was posted. | Post story | — |
| **`TAB_HIDDEN`** (`WINDOW_HIDDEN`, in-page) | Step 3 or 4 | This tab was in the background | Instagram pauses pages you're not looking at, and this one stayed in the background for 2 minutes. Nothing was posted. | Try again | Send to phone… |
| **`PAGE_IN_USE`** (`WINDOW_IN_USE`, in-page) | Step 3 or 4 | You were using Instagram | instapost doesn't tap while you click or type on Instagram, so it stepped back. Nothing was posted. | Try again | Finish by hand |

- **Codes that cannot occur in-page:** the window-only `WINDOW_NOT_FITTED`, `SCREEN_TOO_SMALL` and `LAYOUT_TOO_WIDE`.
- **A new `{why}` for `OUTCOME_UNKNOWN`:** `page closed`, shown as `the Instagram page was closed before Instagram answered`.
- **Everything else in ux.md §5 is unchanged.**

---

## 8. Engine changes for the product (after S12)

### 8.1 The surface

- A new `SessionBase.surface: 'window' | 'frame'`, fixed when the run starts.
- In the frame surface, one new phase, `framing`, replaces `scoping` through `reloading`:
  1. install rules 1001 and 1020, and the test rules for tests;
  2. send `openFrame{tabId, box, nonce}` to the content script;
  3. webRequest gives the `frameId`;
  4. the content script reports `load`;
  5. `injectAgent{tabId, frameId}`.

  `probing` and everything after it are unchanged.
- New effects: `openFrame`, `restyleFrame` and `closeFrame`. `injectAgent` and `sendAgent` carry a `frameId` (0 for a window).
- New events: `frameUpdated {url, status}` (§3.14, mapped like `tabUpdated`), `frameRemoved`, `pageLeft`, and the codes of §7.9.
- The U19 invariants extend to frames:
  - at most one `openFrame` per run;
  - the rules exist before the frame and are removed after it.

### 8.2 The agent

- **Its code is unchanged.**
- `acceptAgentMessage` compares `sender.frameId` with the session's `frameId` (today it requires 0) and, once known, `sender.documentId` (Chrome 106+), so a stale document cannot answer.

### 8.3 Leftover frames after an extension reload

A reload orphans the old content script, so its frame would stay in the page without a driver or rules.

- At startup the background runs a one-line cleanup in every Instagram tab: `tabs.query({url: 'https://www.instagram.com/*'})` (host permission is enough, no `tabs` permission), then an ISOLATED `executeScript` that removes a host left by an earlier instance.
- Rules 1001–1029 are cleaned as today.
- This replaces AM22 for frames.

### 8.4 The content script

`entrypoints/instagram.content.ts`, top frame only, `document_idle`:

- **It owns:** the host, the pill, the panel frame and the engine frame (create, restyle, remove on command), the path polling, the `beforeunload` guard, and a port to the background while a run is active.
- **It reads** Instagram's DOM only to measure the anchor (§3.2).
- **It never:** clicks, uses the network, stores anything in the page, or writes anything into Instagram's DOM other than appending its host to `<html>`.

### 8.5 The panel

- `panel.html` is the editor's `App` with `layout="panel"`.
- The editor port check accepts the panel's dynamic origin.
- Exports go through the panel's IndexedDB if N4 shows it is the extension's. Otherwise they go through the port: structured clone (Chrome 148+, `message_serialization`) or chunks.

### 8.6 Manifest

- **Additions:** `content_scripts` (www.instagram.com, top frame), `web_accessible_resources` (the panel, `use_dynamic_url`) and the `webRequest` permission.
- **No new install warning is expected,** since the host permissions already cover www.instagram.com (unverified).
- **Arc** needs Remove and then Load unpacked, because the manifest changed (L13).

### 8.7 check-bundle

- **T1:** a new snapshot. `FORBIDDEN_KEYS` loses `content_scripts` and `web_accessible_resources`; `FORBIDDEN_PERMISSIONS` loses `webRequest`.
- **T3:**
  - The shim's call target becomes `{tabId, frameIds: [<one identifier>]}`, still exactly once and in `background.js` only.
  - The content-script bundle gets the agent's bans plus:
    - no `.click`;
    - no `dispatchEvent`;
    - no network API;
    - no `innerHTML` or `insertAdjacentHTML`;
    - no `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie`;
    - no Meta-host URL except `https://www.instagram.com/`.

### 8.8 What goes away in the in-page lane

AM29's fitting and its schedule, `docked()`, raise-once, the guided resize, the hard reload, C5's route logic and `focusEditor`. The window lane keeps all of it.

---

## 9. Test strategy in the sealed environment

The fake must make the frame fail exactly as Instagram does. The tests then prove the rules, not the fake's goodwill.

### 9.1 The fake (`tools/fake-ig`)

- **Headers on every www and i HTML response.** Chromium enforces them for real in the sealed browser.
  - `X-Frame-Options: DENY`: knob `xfo`, with values `deny` (default), `sameorigin` and `none`.
  - A CSP shaped like F5: `frame-src` and `child-src` with `https://*.instagram.com`. Knob `frameAncestors`: `absent` (default), `none` or `self`.
  - COOP `same-origin-allow-popups`.
- **`baseline.json`** gains `xFrameOptions: "DENY"`, `frameAncestors: null` and `coop`, with the provenance `logged-out header check 2026-10-14`. `deriveKnobs` maps them (U16).
- **Framed documents.**
  - The request log already keeps `sec-fetch-*`.
  - Knob `framed`, applied when `sec-fetch-dest: iframe`: `serve` (default), `refuse` (a 403 page), `desktop` (the desktop shell whatever the UA), `login` (a 302 to `/accounts/login/`) or `offhost` (a 302 off-host).
- **F8 modelled.** The fake msite's reactions `checkpoint` and `login401` set `window.top.location.href`, as `PolarisInstajax` does, so in-page they take over the desktop shell.
- **F9 modelled.** The fake msite records `framed: window.top !== window` in its telemetry, and keeps a sessionStorage logging id.
- **The desktop shell** (`client/DesktopShell.tsx`) gains:
  - Instagram's left-navigation shape: links `/`, `#` (Search), `/explore/`, `/reels/`, `/direct/inbox/`, `#` (Notifications), `#` (Create), `/<handle>/` and `#` (More), with svgs and no dependence on text;
  - a Messages bubble at the bottom right;
  - knob `desktopNav`: `wide`, `collapsed`, `bottomBar`, `absent` or `renamed` (randomised classes).
- **Violations:** unchanged. A tap anywhere in the desktop shell counts as `TAP_OUTSIDE_ALLOWLIST`.

### 9.2 Unit (Vitest, node)

| Id | What |
|---|---|
| U30 | The frame rules: ids, scopes, no `main_frame` in the frame variant of 1001, the shape of 1020, cleanup of 1001–1029, the U1–U3 builders |
| U31 | `frameBox(dpr)` and the scaling into the panel |
| U32 | Frame URL classification, and the order that tells `FRAME_REFUSED` from an off-host kill |
| U33 | The reducer's `framing` transitions and the extended U19 invariants: one frame per run, rules before the frame and removed after it, no tap before the account decision, Share once |
| U34 | `acceptAgentMessage` with `frameId` and `documentId` |
| U35 | The anchor finder on DOM fixtures: wide, collapsed, renamed, absent |
| U36 | The S12 spike driver against fakes (§10.4) |

### 9.3 Browser (Vitest browser mode)

| Id | What |
|---|---|
| B15 | The agent and its probes inside a same-origin iframe of the fake's components read the frame's viewport, not the top's |
| B16 | The shim with `frameIds` changes only the frame's `ScreenOrientation` |
| B17 | User activation: a trusted click (CDP `Input`) in a cross-origin sibling frame leaves the engine frame inactive; a click in the top document activates it (N5, in the sealed browser) |
| B18 | A CSS-scaled frame keeps its `innerWidth`, its DPR and its canvas sizes |

### 9.4 E2E (Playwright, sealed)

Run on in-page builds of the `mock` and `live` artifacts. Reads of the engine frame use `quietEvaluate`, as in AM42.

| Id | What |
|---|---|
| E44 | A one-click post in-page: live → Posted on the fake; mock → a Share test |
| E45 | Without rule 1020, Chromium refuses the frame: `FRAME_REFUSED`, no lock, no write |
| E46 | The rules exist only during the run and only for that tab: a second Instagram tab's frame is refused and its documents keep the desktop UA in the fake's log; in the run's tab the page's `main_frame` stays desktop while the sub_frame and the XHRs are Android |
| E47 | The frame's kill switch: `framed=login` or `offhost`, a challenge inside the frame, a checkpoint that moves the page (F8), an off-host move mid-run; the lock where it applies |
| E48 | Leaving mid-run: a reload before Share → `PAGE_LEFT`; after Share → the `beforeunload` dialog, seen by Playwright and accepted → Couldn't confirm |
| E49 | Several tabs: a busy lane, K7 in the other tab |
| E50 | A same-document navigation of the desktop shell keeps the panel and the run |
| E51 | The pill: anchored for each `desktopNav` value, and the fallback |
| E52 | Activation: a panel click causes no wait; a click on the desktop page makes the run wait, then carry on; continuous clicks → `PAGE_IN_USE` |
| E53 | F8 without a sandbox: a checkpoint during a run moves the desktop shell to `/challenge/` → `KILLED_CHALLENGE` and the lock |
| E54 | C8 per frame size (the `viewportDpr` model → 1080×1920 at DPR 2) |
| E55 | The frame document's headers in the fake's log: the Android UA, `sec-fetch-dest: iframe`, a Referer with the origin only |
| E56 | The tab hidden before Share → wait → `TAB_HIDDEN`. Headless Chromium keeps hidden pages visible (AM42), so this is a reducer test plus a live check, as E41 is |

### 9.5 check-bundle and the seal

- **check-bundle:** T1 and T3 as in §8 for the in-page artifact. The normal builds are unchanged until the proposal is adopted.
- **The seal is unchanged:** the fake at the real origin, the resolver allow-list, `assertSealed()` on every launch.

---

## 10. Spike S12: the minimal build that proves the engine

### 10.1 Goal

Prove, in Arc 155 against real Instagram on the secondary account, with nothing posted, that:

- **(a)** Instagram's mobile site loads, logged in and as msite (`is_mobile: true`), in a same-origin frame of the desktop page, once rule 1020 removes XFO;
- **(b)** the autopilot reaches a Share-ready composer in that frame (+ → Story → insert → drawn → exactly one Share control) without a file chooser;
- **(c)** the rules and the frame leave no trace.

Measure, along the way:

- the frame's request headers;
- C8 at the frame's size;
- activation;
- U1 against U3;
- a covered frame.

**Not part of S12:** the real panel and editor UI, posting, and the product reducer.

### 10.2 Why nothing can be posted

1. **A static write block for the whole browser.** The spike build ships the static `block_ig_writes` ruleset, as guarded builds do, enabled in every tab while the build is loaded. Every upload and publish path is blocked everywhere: while the build is loaded, the owner cannot post from desktop at all in that profile.
2. **No post mode.** The spike driver has no `post` mode, at compile time.
   - Its modes are `check`, `test` and `shareTest`. `shareTest` needs a second confirmation in the spike panel.
   - The test write-block rules 1002–1010 (`[tab, -1]`) are installed too, and verified before a Share test, as today.
3. **A leak locks.** Any upload or publish entry with a non-zero status is `TEST_LEAK`: kill and lock (the unchanged rule).
4. **The safety machinery is the existing one,** in the same storage: the rate guard, and the kill switch with its lock.
5. **The product code is untouched.** The reducer, the runner and the editor do not change. In the spike build the editor's Post story is disabled, with `This spike build can't post.`
6. **A red bar** across the spike panel: `SPIKE — nothing can be posted from this build.`

### 10.3 Build and flags

- **`package.json`:** `"build:inpage-spike": "INSTAPOST_LIVE=1 INSTAPOST_INPAGE_SPIKE=1 wxt build --mode live"`.
- **`wxt.config.ts`,** when `INSTAPOST_INPAGE_SPIKE=1`, and only with `--mode live`:
  - the output goes to `.output/chrome-mv3-live-inpage`, through WXT's `outDirTemplate`, so the live artifact is never overwritten;
  - the name is `instapost IN-PAGE SPIKE`;
  - the key is the live key, so the owner **swaps** it for the live build in the secondary account's Arc profile and never loads both;
  - `permissions` gain `declarativeNetRequest` and `webRequest`;
  - `declarative_net_request` gets the static ruleset;
  - `web_accessible_resources: [{resources: ['spike-panel.html', 'chunks/*', 'assets/*'], matches: ['https://www.instagram.com/*'], use_dynamic_url: true}]`;
  - the content script is added;
  - an `entrypoints:resolved` hook drops `instagram.content` and `spike-panel` from every other build;
  - a Vite `define` sets `__INPAGE_SPIKE__`.
- **Runtime toggles,** in the spike panel, stored in storage.local `__spike`, so one build covers every variant:

  | Toggle | Values |
  |---|---|
  | `ua` | `tabwide` (U3) or `document` (U1) |
  | `frame` | `auto`, `540x960` or `412x732` |
  | `view` | `phone` (scaled), or `covered`: the same frame under the panel at opacity 0.01 |

### 10.4 Files

**Add:**

| File | What it does |
|---|---|
| `entrypoints/instagram.content.ts` | Top frame, `document_idle`. Builds the host with a closed shadow root on `<html>`; the pill with §3.2's anchor and fallback; the spike panel iframe (`runtime.getURL('spike-panel.html')`). On command: creates the engine iframe (§3.10's attributes, `frameBox`, scale), reports `load`, polls the frame's path every 250 ms, sets and clears the `beforeunload` guard, removes the frame |
| `entrypoints/spike-panel/index.html`, `main.tsx` | A minimal Preact page: the red bar; Check, Test run and Share test (with a confirmation); the toggles; the steps as they arrive; Details (the S12 record as JSON) with Copy |
| `src/core/ig-contract/frame-rules.ts` (+ `.test.ts`, U30) | `XFO_RULE_ID = 1020`, `xfoRule(tabId)`, `frameUaRule(tabId, major, chMode, variant)` with `variant` `tabwide` or `document`. `SESSION_RULE_LAST_ID` becomes 1029 in `rules.ts` |
| `src/core/inpage/frame-box.ts` (+ test, U31) | `frameBox(dpr)` and `scaleToFit(box, area)` |
| `src/inpage/spike-driver.ts` (+ test, U36) | Background, one run at a time, sequential steps with ux.md's budgets (detail below) |
| `src/inpage/frame-watch.ts`, `src/platform/web-request.ts` | The webRequest listeners of §3.14 for the run's tab: frame id, URLs, redirects, status, XFO seen, errors |
| `src/inpage/messages.ts` (+ test) | The messages between the content script and the background (`inpage/open-frame`, `frame-loaded`, `frame-path`, `remove-frame`, `unload-guard`, `toggle-panel`), shape-checked; the sender must be the content script in frame 0 of the run's tab |
| `tests/e2e/inpage-spike.spec.ts` | Sealed, against the fake, on the spike artifact: E45, E46 and E55; the `check` and `test` paths of E44 (Share-ready, and the fake's writes log stays empty); E52 (activation); E53 (F8 without a sandbox) |

**The spike driver's steps:**

1. Check the lane and note the open in the rate guard (`noteOpen`).
2. Install the rules: the chosen variant of 1001, 1020, and 1002–1010.
3. Send `openFrame` to the content script; take the frame id from webRequest; wait for `load`.
4. Inject the shim and the agent with `frameIds`.
5. `agent/probe`: C1, C3a, C4, C14, the shim's reading, the service worker.
6. By mode:
   - `check` ends here;
   - `test`: the account → `open-entry` (with the fingerprint) → `insert` (the calibration card from `src/raster/calibration.ts`) → `compose`, and stop before Share;
   - `shareTest`: verify the test rules, then `share`; the outcome comes from `decide()` with writes blocked.
7. Tear down: remove the frame, then the rules.
8. Write the S12 record.

It reuses `classifyComposerUrl`, `evaluateProbe`'s rows, `decide`, `rehearsalRules`, `testRulesInstalled`, `lockMsite` and the agent protocol.

**Change:**

| File | Change |
|---|---|
| `src/platform/scripting.ts` | `injectComposerAgent(tabId, frameId = 0)` and `injectPortraitShim(tabId, install, frameId = 0)` |
| `src/platform/tabs.ts` | `sendMessage(tabId, msg, frameId = 0)` |
| `src/shared/protocol.ts` | `ActiveAgentSession.frameId` (default 0); `acceptAgentMessage` compares it (U12 and U34) |
| `src/handoff/background-main.ts` | Spike build only: register the webRequest listeners and the content script's message handler synchronously; a toolbar click on an Instagram tab toggles the spike panel; `handoff/start` with `post` is refused |
| `wxt.config.ts`, `package.json` | §10.3 |
| `scripts/check-bundle.ts`, `tools/bundle/patterns.ts` | A `spike` artifact, when present: a T1 snapshot with the keys above; in T3 one MAIN-world call with `frameIds: [<identifier>]`, the content-script bans of §8.7, a marker proving the spike driver has no `post` mode, and the static ruleset present |
| `tools/fake-ig/core.ts`, `knobs.ts`, `html.ts`, `client/DesktopShell.tsx`, `src/core/ig-contract/baseline.json` | The knobs `xfo`, `frameAncestors`, `framed` and `desktopNav`; F8 for `checkpoint` and `login401`; the baseline facts F4–F6 |
| `playwright.config.ts` | A project `inpage-spike` on `.output/chrome-mv3-live-inpage` |

**Not touched:** the reducer, the runner, the editor, the agent's code, and the live and mock manifests.

### 10.5 Order of work

Each step ends green.

0. Start from `main` after the Spanish UI (`feat/es-locale`) has landed. It claims AM44 and changes four files this spike touches: `wxt.config.ts` (`default_locale`, a localised description), `scripts/check-bundle.ts`, and the fake's `core.ts` and `client/DesktopShell.tsx`. The pill's label goes into its catalog (`src/ui/catalog.en.ts`, `catalog.es.ts`).
1. The fake's headers and knobs, and the baseline (U16). A 10-line Playwright check shows the sealed browser refusing a framed fake page.
2. The frame rules and the frame box (U30, U31).
3. The platform `frameId` parameters and the protocol (U12, U34).
4. The content script and the spike panel against the fake: the pill, the panel, a frame that appears with rule 1020 and is refused without it.
5. The spike driver and the frame watch (U36); E45, E46, E55.
6. The agent in the frame, end to end on the fake: `check`, `test`, and `shareTest` with the fake's blocked upload; E52, E53.
7. The spike build and check-bundle's spike mode. `pnpm run verify` and `pnpm exec playwright test --project=inpage-spike` are green.

**Estimate:** 4–5 engineer-days.

### 10.6 What the owner checks by hand (proposed L24–L29)

**Before:**

- the conditions of the live checklist's preamble: Arc, the secondary account's profile, one run at a time, at least 60 s apart; the DevTools Network panel is allowed; stop at any challenge;
- swap the builds: `arc://extensions` → Remove instapost (live) → Load unpacked `.output/chrome-mv3-live-inpage`.

**After:**

- swap back (L13);
- run one normal setup test (L18) to confirm the live build is unaffected.

**L24: the pill and the panel, with nothing loaded**

- [ ] **L24**
  - On instagram.com's home, the pill appears next to Create (or at the right edge).
  - A click opens the spike panel with its red bar.
  - Instagram still scrolls, opens a profile and comes back, with the pill and the panel still in place.
  - A reload brings the pill back.
  - Do it on the MacBook and on the ultrawide.
  - Record: the anchor (`nav-wide`, `nav-collapsed` or `fallback`) and any console error that mentions instapost (expect none).

**L25: Check, with `ua: tabwide`**

- [ ] **L25** Press Run check.
  - **Expected:** a phone appears in the panel with Instagram's mobile home, logged in as the secondary, for about 5 s, then disappears: `Connected as @…`.
  - **Details:** `frame loaded`, `xfoSeen: DENY`, `is_mobile: true`, `viewport 540×960`, the DPR, `shim installed`, the account, `rules after: none`.
  - **DevTools, Network, Doc:** the frame's request to `www.instagram.com/` carries:
    - `user-agent: … Android 10; K …`;
    - `sec-ch-ua-mobile: ?1`;
    - `sec-fetch-dest: iframe`;
    - `referer: https://www.instagram.com/`.

    The Console has no "Refused to display … in a frame" error.
  - Then reload Instagram: the usual desktop layout.
  - **Stop and record** if the frame shows a login page, the desktop site or an error, or stays blank (`FRAME_REFUSED`, `DESKTOP_SHELL` or `NOT_LOGGED_IN`, with the detail). That is the no-go signal.

**L26: Test run, with `ua: tabwide` and the calibration card**

- [ ] **L26**
  - **Expected, in the phone:** + opens the menu, then Story, then the card appears in Instagram's story editor with its Share footer. No file chooser at any moment. Then it closes: `Test passed`.
  - Nothing appears on the profile (check on the phone).
  - **Record:**
    - the C10–C12 facts;
    - the Quality row: C8 at 540×960, expected 1080×1920 if C8 follows the viewport;
    - Steps;
    - the activation readings.

**L27: Test run, with `ua: document`**

- [ ] **L27** At least 60 s later, or on another day.
  - **Expected:** the same as L26.
  - **Record:** any difference: errors in the frame, a step that fails, a "Something went wrong".

**L28: interference, one Test run per item**

- [ ] **L28**
  - **(a)** Right after Run test, click once on Instagram's page. Expected: the run waits, then carries on.
  - **(b)** Run test, switch to another tab for 10 s, then come back. Expected: it pauses, then carries on.
  - **(c)** Run test and reload the page before the photo appears. Expected: `Stopped — you left the Instagram page`, and the next Check shows a fresh phone (no rule left over).
  - **(d)** With `view: covered`, one Test run with the phone hidden under the panel. Expected: it passes; otherwise note the step where it stops.
  - **(e)** After (a)–(d), Back from the home feed reaches the previous page within at most two presses. Note how many.

**L29: Share test in the frame (optional, once ever, on another day)**

- [ ] **L29**
  - **Expected:** Share is pressed; Instagram's own "upload failed" message appears inside the phone; `Share test passed`; nothing on the profile.
  - **DevTools:** the `rupload_igphoto` request from the frame carries the Android UA (tab-wide) and fails as blocked; there is no `configure_to_story`.

### 10.7 Go or no-go

| S12 result | Decision |
|---|---|
| L25: refused, the desktop site, or a login wall | **No-go:** Instagram treats framed documents differently. Keep the window lane, and consider §5.5's polish. Never forge `Sec-Fetch-Dest` |
| L25 and L26 pass (tab-wide) | **Go** for the owner's OD15 → the product build (§8) → a first real in-page post on the secondary account (a new live check, as L20) |
| L27 passes too | U2 becomes a candidate; one real post with U2 decides |
| L28 (d) passes | "Hide the Instagram view while posting" can be offered (a new OD) |
| Any challenge or security email within 7 days | Stop, lock and reassess (the unchanged stop condition) |

---

## 11. Risks, open decisions and checks

### 11.1 Risks (after R22)

| Id | Risk | Mitigation |
|---|---|---|
| R23 | The framed msite document (`Sec-Fetch-Dest: iframe`), plus msite knowing it is framed (F9), is a new and distinctive signal. Instagram may start refusing framed documents, or may flag the account | The frame only during runs; the rate guard; the kill switch; the window lane as fallback; never forge |
| R24 | The desktop page's own requests carry the Android profile during runs (U3) | Bounded to about 20 s per run, at most 6 an hour; U2 if a real post proves it |
| R25 | A content script and DOM on every desktop Instagram page: Instagram could detect instapost | A closed shadow root, a dynamic panel URL, no edits to Instagram's DOM, a few-KB script |
| R26 | sessionStorage (`ht_persistent_session_id`) and session history are shared between desktop and msite in one tab | Record the key names in S12; no mitigation in the design |
| R27 | Instagram adds `frame-ancestors` or another frame check | `FRAME_REFUSED`, then the window lane. CSP is never stripped |
| R28 | Panel storage partitioning (N4) and Permissions-Policy (N13) | Drafts and exports through the background; sharing through the editor tab |

### 11.2 Open decisions (after OD14)

| Id | Decision | Default |
|---|---|---|
| OD15 | **Adopt the in-page lane.** Accept, for each run and in the posting tab only: removing X-Frame-Options from Instagram's mobile document (a deliberate bypass of Instagram's clickjacking defence, reversing research §5.4's "avoid"), the framed-document signal (R23), and a content script with a web-accessible panel on www.instagram.com (reversing strategy §1 item 7) | Run S12 first (test mode only); decide after L25–L28 |
| OD16 | The device profile in the posting tab | U3; U2 only after a real post with it; never U1 for posts |
| OD17 | The Story pill on instagram.com | On by default; the toolbar and ⌥⇧S always work |
| OD18 | Keep the window lane as a fallback in Settings | Yes |
| OD19 | `webRequest` (observational) for the frame's kill switch | Yes. Without it, a refused first load cannot be told from an off-host one, so neither could lock |

### 11.3 Checks (N1–N17)

| Id | Unverified | Where it is checked |
|---|---|---|
| N1 | Instagram serves msite, logged in, to a framed document request | L25 |
| N2 | Removing XFO with dNR works for sub_frame in Arc | L25; E45 in the sealed browser |
| N3 | The panel iframe loads despite Instagram's page CSP, and `runtime.getURL` returns the dynamic URL | L24 |
| N4 | The panel's storage is not partitioned (the panel sees the editor's drafts) | L24, Details |
| N5 | A click in the panel does not activate the engine frame | B17; L26's readings |
| N6 | The shim through `frameIds` works in Arc, and only in the frame | L25 |
| N7 | msite works in the frame without a sandbox's restrictions, and does not try to move the page on the autopilot's path | L26 |
| N8 | The frame's requests are attributed to the tab, so the rules apply | L25, DevTools |
| N9 | Desktop Instagram embeds no www sub_frames of its own | L25, webRequest log |
| N10 | C8 at the frame's size | L26 |
| N11 | A content script's `beforeunload` shows the browser's prompt | E48; the product's live check |
| N12 | Shared sessionStorage keys; Back after a run | L25 Details; L28 (e) |
| N13 | `web-share` in the panel under Instagram's Permissions-Policy | product |
| N14 | Desktop Instagram keeps a host under `<html>` across same-document navigations | L24 |
| N15 | A covered same-origin frame keeps rendering | L28 (d) |
| N16 | Arc has no Chrome side panel; whether and where Arc shows the debugger infobar | one console check each, only to close §4 and §5.3 |
| N17 | The engine frame stays visible when Instagram opens its own modals (z-order) | L26 |

---

## 12. If adopted: changes to the canonical docs

**Done on adoption (2026-10-15).** strategy §11 AM46–AM52 (the lane, the rules and the owner's approvals, the UI and its languages, HEIC, the test-run rate exemption, AirDrop, the ids), with §1 items 1 and 7, §2.1–§2.4, §7.11 (U32–U39, B20, E46–E58), §8 (L25–L36), §9.1 (R23–R30), §9.2 (A26, A27) and §10 (OD15–OD19); `docs/contract.md` C15–C16 and § "The in-page frame"; `docs/live-checklist.md` L25–L36; `README.md` (hard rule 7, § "Posting from Instagram"); check-bundle T1–T3 (`scripts/check-bundle.ts`). `docs/ux.md` stays the window lane's spec, with a pointer to the approved in-page UI spec; its in-page rewrite (the list below) is not done. The plan as proposed:

- **`docs/strategy.md`:**
  - §11, an amendment with the next free AM id: OD15–OD19, the in-page lane, rules 1020–1029, the content script, the web-accessible panel, `webRequest`, and the codes `FRAME_REFUSED`, `PAGE_LEFT`, `TAB_HIDDEN` and `PAGE_IN_USE`;
  - §1 item 7 and §2.1 updated;
  - §9.1, R23–R28.
- **`docs/ux.md`:**
  - §0, §3, §4.1, §4.2, §4.6 (the run view), §5, §11 and §12 as in §7 here;
  - the window spec moves to a "Separate window (fallback)" section.
- **`docs/contract.md`:**
  - C15, framing: F4–F6, the rule, a framed document served as msite;
  - C16, the frame's identity: `frameId` and `documentId`;
  - F8 and F9 under C9 and C13;
  - C3a and C8 notes for the frame's size;
  - the S12 results.
- **`README.md`:**
  - hard rule 6 adds "and in the in-page frame";
  - a new hard rule: never strip CSP, and never forge `Sec-Fetch-*` or `Origin`;
  - the Arc section describes the panel.
- **`docs/live-checklist.md`:** L24–L29 as above, then the first in-page post.
- **check-bundle:** T1 and T3 as in §8.

---

## 13. Spike S12 as built (sealed environment, 2026-10-14)

Branch `spike/inpage-panel`, from `main` = af856c9. `feat/es-locale` had not landed (it still pointed at af856c9), so step 0 of §10.5 was skipped: the pill's label is English and no catalog exists yet. Nothing here touches real Instagram: every run below is against the fake in a sealed browser.

### 13.1 What was built

| Piece | Where | Notes |
|---|---|---|
| The build | `pnpm run build:inpage-spike` → `.output/chrome-mv3-live-inpage` | §10.3 as written: live mode, live key, "instapost IN-PAGE SPIKE", the static `block_ig_writes` ruleset, `declarativeNetRequest` + `webRequest`, the content script, the web-accessible panel with `use_dynamic_url`. `wxt.config.ts` drops the two spike entrypoints from every other build (`entrypoints:resolved`) and defines `__INPAGE_SPIKE__` (`INPAGE_SPIKE` in `src/shared/env.ts`) |
| Content script | `entrypoints/instagram-page.ts` → `src/inpage/page-script.ts`, `src/inpage/anchor.ts` | **Deviation:** an unlisted script declared in the manifest, not a WXT `*.content.ts`: WXT's content-script context posts `wxt:content-script-started` to the page with `window.postMessage`, which Instagram's JS would see (R25). check-bundle bans `postMessage` in it |
| Spike panel | `entrypoints/spike-panel/` | Red bar, Run check, Run test, Share test (a checkbox, then the button), Stop, the toggles (`ua`, `frame`, `view`, and `xfoRule` for E45), the steps, Details (the S12 record) with Copy |
| Driver | `src/inpage/spike-driver.ts`, `src/inpage/spike-background.ts` | §10.4's steps, sequential, in memory. Modes `check`, `test`, `shareTest`; no `post` anywhere (marker `instapost-spike:modes=check,test,shareTest;post=none`, checked by check-bundle). Records in storage.local `spikeRecords` (the last 20) |
| Frame watch | `src/platform/web-request.ts`, `src/inpage/frame-watch.ts` | Observational webRequest, `sub_frame` on www and i |
| Classification | `src/core/inpage/frame-verdict.ts` | §3.14's order (`frameLoadVerdict`, `frameUrlVerdict`, `pageUrlVerdict`) |
| Rules | `src/core/ig-contract/frame-rules.ts` | `frameUaRule` (U3 `tabwide`, U1 `document`), `xfoRule` (1020); `SESSION_RULE_LAST_ID` = 1029 in every build |
| Frame box | `src/core/inpage/frame-box.ts` | `frameBox(dpr)` (plus a 320-CSS-px floor), `scaleToFit` |
| Platform | `scripting.ts`, `tabs.ts`, `protocol.ts` | A `frameId` (default 0) for the shim, the agent and `sendMessage`; `acceptAgentMessage` checks the session's `frameId` and, once known, its `documentId` (U34). check-bundle's shim shape accepts `frameIds:[0]` or `frameIds:[<identifier>]` in every build |
| Editor | `src/ui/PostCard.tsx` | In the spike build only: Post story disabled with `This spike build can't post.`; the background also refuses `handoff/start` with `post`, and any start while a spike run is in progress |
| Fake | `tools/fake-ig` | Knobs `xfo`, `frameAncestors`, `framed`, `desktopNav`, and `challenge=afterReadyTop` (F8 reached without a write, since writes are blocked in every test); the F5 CSP and COOP on every HTML document; the Referer in the request log; F8 for `checkpoint` and `login401`; F9 telemetry (`msite_session`: `framed`, `sessionLogIdReused`); the desktop left navigation and the Messages bubble. Baseline: `xFrameOptions: "DENY"`, `frameAncestors: null`, `coop` |

Not built (left to the product, or out of the spike's time): the 30-s activation wait as its own budget (the agent is unchanged, so it waits its usual 6 s; `ACTIVATION_ACTIVE` maps to `PAGE_IN_USE`), the 2-minute `TAB_HIDDEN` cap (the agent's `HIDDEN` maps to `TAB_HIDDEN`), the account prompt (a mismatch or an unreadable account stops with `ACCOUNT_UNCONFIRMED` before any tap), Finish by hand, the minimised chip (the phone card stays beside the panel; closing the panel during a run leaves the phone visible), the pill's drag and stored position, the editor inside the panel, and §8.3's orphan cleanup by `executeScript`: instead the content script removes its frame as soon as its port to the background drops, and the background removes rules 1001–1029 at every worker start while no run is active. E48 (b), E49, E50, E54 (beyond C8 at 540×960), E56 and B15–B18 are not written (B17's question is answered at E2E level by E52).

### 13.2 What the sealed tests showed

`tests/e2e/inpage-spike.spec.ts`, projects `inpage-spike` (Playwright's Chromium 156) and `inpage-spike-cft155` (Chrome for Testing 155, Arc's Chromium), headless, with the owner's emulated MacBook screen at DPR 2: 19 tests, all green on both (38 runs). `pnpm run verify` (which now also builds the spike) was green as well: typecheck, lint, 1367 unit tests, 100 browser tests, check-bundle 13/13 with the spike artifact, and 194 E2E (33 skipped by mode, as before), the existing mock, live and CfT 155 smoke suites included with the fake's new framing headers on. Unit: U30–U32, U34, U36 and the message guards; browser: U35.

| Check | Result in the sealed browser |
|---|---|
| N2 (XFO removed by dNR) | **Yes, on Chromium 156 and on CfT 155.** With rule 1020 the fake's `X-Frame-Options: DENY` document renders in the frame; without it Chromium refuses it (E45: `FRAME_REFUSED`, no lock, no write, no rule left). A second Instagram tab's own frame of Instagram stays refused during a run (E46) |
| §3.14 source 1 (webRequest) | **webRequest does not see the refusal.** For the refused frame it reports `onCompleted` with 200 and no error (no `net::ERR_BLOCKED_BY_RESPONSE`); the only signal is the content script's `load` on an unreadable (error) document, which frameLoadVerdict turns into `FRAME_REFUSED`. And `onHeadersReceived` shows `X-Frame-Options: DENY` whether rule 1020 removed it or not (webRequest sees the response before dNR's change), so the record's `xfoSeen: DENY` is expected in both cases (L25). The frame id from `onBeforeRequest` was the one `scripting` and `tabs.sendMessage` accept |
| N3 (the panel under the page's CSP; the dynamic URL) | The panel loads although the page's CSP lists only `*.instagram.com` in `frame-src`. `runtime.getURL('spike-panel.html')` gives the dynamic URL; **`runtime.getURL('/spike-panel.html')`, with a leading slash, gives the fixed extension-id URL** (and that loads too). The iframe's `src` carries the per-session id; the frame's committed URL is the real extension origin. The page's own `fetch` of `chrome-extension://<id>/spike-panel.html` fails |
| N5 (a panel click does not activate the engine frame) | **Yes, for real input** (CDP `Input` at the panel's coordinates): the top document becomes active, the engine frame does not. A click on the desktop page activates the engine frame (same origin), and the agent waits it out: the Story tap came more than 4 s after the click, and no file chooser opened (E52). Test artefact: Playwright's `locator.click()` inside the panel *does* activate the engine frame (it evaluates in the top document with a gesture), so the specs use raw mouse input there |
| N6 (the shim per frame) | The shim installs in the engine frame (`frameIds:[engine]`); the desktop page's `screen.orientation.type` stays landscape |
| N8 (the frame's requests belong to the tab) | Yes: rule 1001 applies to the frame's document and to its subresources |
| N10 (C8 at the frame's size) | `frameBox(2)` = 540×960, and the fake's `viewportDpr` model gives a 1080×1920 canvas |
| N15 (a covered frame renders) | `view: covered` (the phone under the panel at opacity 0.01) passes a Test run |
| U1 against U3 | U3 (`tabwide`): the frame's document and scripts are Android, **and so is the desktop page's own XHR during the run** (R24, seen on the wire); a reload of the run's tab is a desktop `main_frame`. U1 (`document`): only the frame's document is Android; its scripts and the page's XHRs keep the desktop UA. Both pass on the fake, which classifies by the document's UA only; real Instagram's API is L27 |
| E55 (the engine document's headers) | Android UA and client hints, `sec-fetch-dest: iframe`, `sec-fetch-mode: navigate`, `sec-fetch-site: same-origin`, `Referer: https://www.instagram.com/` |
| F8 (no sandbox) | A checkpoint during the run moves the desktop page to `/challenge/`: `KILLED_CHALLENGE`, the 7-day lock, no rule left (E53) |
| §3.14 (E47) | `framed=login` → `NOT_LOGGED_IN`; `framed=offhost` → `KILLED_OFFHOST` (lock); `framed=refuse` → `FRAME_REFUSED`; `framed=desktop` → `DESKTOP_SHELL`; a challenge inside the frame (a navigation or a pushState) → `KILLED_CHALLENGE` (lock); a reload of the run's tab → `PAGE_LEFT` (E46, E48 a) |
| E51 | `nav-wide` (also with random classes), `nav-collapsed`, and the right-edge fallback after 3 s for a bottom bar or no navigation |
| F9, R26 | msite in the frame reuses the desktop page's sessionStorage logging id (`sessionLogIdReused: true`) |
| N12 (history) | A Test run leaves one extra entry in the tab's session history (`history.length` 2 → 3: msite's pushState to `/create/story/`) |
| Timing (fake, real dwell) | Check: the frame loads about 20 ms after `inpage/open-frame`, the whole check takes about 50 ms on the local fake. Test run: about 6.5–7.5 s (+ → Story at about 3 s, the insert at about 5 s, the composer at about 7 s). Share test: about 14 s (the blocked upload decided about 4 s after Share) |

### 13.3 Still unknown until Arc and real Instagram (L24–L29)

N1 (real Instagram serves msite to a framed request), N2 in Arc itself, N4 (panel storage partitioning: the spike panel stores only its toggles), N7, N9, N11 (no E2E of the `beforeunload` prompt), N12 (Back after a run), N13, N14 (desktop Instagram keeping the host across its own navigations), N16, N17, and whether Instagram's API looks at the UA of the frame's XHRs (U1, U2).

### 13.4 Trying it in Arc (the secondary account, test mode only)

The built artifact is copied to `.spikes/inpage-build/chrome-mv3-live-spike` (gitignored). §10.6's conditions apply: Arc, the secondary account's profile, one run at a time and at least 60 s apart, stop at any challenge.

1. In the secondary account's Arc profile, `arc://extensions` → Developer mode → **Remove** "instapost" (the live build; the spike carries the same key and must never sit beside it).
2. **Load unpacked** → `.spikes/inpage-build/chrome-mv3-live-spike`. Check the name: "instapost IN-PAGE SPIKE".
3. Open `https://www.instagram.com/`, logged in as the secondary. L24: the violet **+ Story** pill on the Create row (or a round button at the right edge after 3 s); a click (or the toolbar icon, or ⌥⇧S) opens the panel with its red bar. Scroll, open a profile, come back, reload: the pill stays or comes back.
4. L25: **Run check** (`ua: tabwide`). A phone appears beside the panel for a few seconds, then `Connected as @…`. Copy Details. Optional: DevTools → Network → Doc, the frame's request to `www.instagram.com/` (Android UA, `sec-ch-ua-mobile: ?1`, `sec-fetch-dest: iframe`, `referer: https://www.instagram.com/`), and no "Refused to display … in a frame" in the Console.
5. **Stop here and send the Details** if the outcome is `FRAME_REFUSED`, `DESKTOP_SHELL`, `NOT_LOGGED_IN` or any kill: that is §10.7's no-go signal. Never retry.
6. At least 60 s later, L26: **Run test**. Expected: + → Story → the grey calibration card in Instagram's story editor with its Share footer, no file chooser, then `Test passed`. Copy Details (C8, the steps). Nothing appears on the profile.
7. Optional, ≥ 60 s apart or another day: L27 (`ua: document`, Run test) and L28 (a)–(d) (a click on Instagram's page right after Run test; switching tabs for 10 s; a reload before the card appears; `view: covered`). Leave Share test (L29) for another day, once.
8. Swap back: Remove the spike, Load unpacked `.output/chrome-mv3-live` (from a green `pnpm run verify` on main), and run one setup test (L18).

### 13.5 Risks seen while building it

- **R23 is real and unavoidable without forging:** the engine document goes out with `sec-fetch-dest: iframe` and `sec-fetch-site: same-origin`, a combination Instagram never gets from its own clients (its documents carry XFO DENY). msite also logs itself as framed (F9).
- **R24 is real:** with U3 the desktop page's own requests in that tab carry the Android profile for the run (seen for an XHR on the wire). U1 avoids it but sends the frame's own scripts and XHRs with the desktop UA, a combination no real client sends either.
- **Activation leaks one way.** A real click in the panel does not activate the frame, but any click or key on Instagram's own page (or on the pill) does, and the unchanged agent waits only 6 s: an owner who keeps using Instagram during a run gets `PAGE_IN_USE` (§3.13's 30-s wait is not built).
- **Instagram's code can see instapost's footprint in the page:** a host element under `<html>` with a closed shadow root, a cross-origin frame (the panel, its `src` with a per-session id) and, during a run, a same-origin frame whose DOM, `location` and agent activity the desktop page can read. The fixed extension-id URL is avoided only because the panel's URL is built without a leading slash (N3): an easy regression.
- **F8 takes over the owner's tab.** A checkpoint in the frame moves the desktop page itself (the kill switch then locks); the owner sees Instagram's challenge in their own tab, not in a closable window.
- **The service worker holds the run in memory.** A worker stopped mid-run loses it; the content script drops its frame when its port closes, but the session rules 1001 and 1020 stay on that tab until the worker next starts (any tab update wakes it, and it then removes 1001–1029).
- **The spike build blocks every upload and publish path in every tab** while it is loaded: no posting from desktop Instagram in that profile until it is swapped back.
- **One main thread.** The frame shares the desktop page's renderer; the sealed tests saw no stall, real Instagram's desktop page is heavier.

### 13.6 Prototype: the panel posts (2026-10-14, after L25–L26 passed in Arc)

The owner asked for a working prototype first ("a subtle window … edit, compose your story, click post, and that's it"), full testing later. Same branch, same build command; this supersedes §10.2 and the "cannot post" lines of §13.1 for this build.

- **Build:** `pnpm run build:inpage-spike` → `.output/chrome-mv3-live-inpage`, named **"instapost IN-PAGE"**, live key. It **no longer ships the static `block_ig_writes` ruleset**. Test modes (Test run, Share test) still block writes with the session rehearsal rules 1002–1010 for the run's tab; a post installs none. check-bundle's in-page artifact: ruleset absent, marker `instapost-inpage:modes=check,test,shareTest,post` once in background.js. The editor tab's own Post story (window lane) is no longer disabled in this build; the two lanes still run one at a time.
- **Panel** (`entrypoints/spike-panel/`, 440 px drawer): the editor (drop, ⌘V or Choose photo…, Recent photos, Continue draft; the stage with pan, zoom, rotate; one text layer; safe zones) and a big **Post story**. Advanced (closed): Check, Test run, Share test (with its confirmation), Stop, the S12 toggles, the steps and Details with Copy. The live phone shows beside the drawer during a run, as the spike's `phone` view.
- **Post mode** (`src/inpage/spike-driver.ts`): the panel sends the msite export (export-cache.ts, the 1080×1920 PNG of the doc as it is now) with the start; the insert serves it instead of the calibration card (test modes use it too when a photo is loaded). + → Story → insert → composer ready → Share once (refused if already sent; Stop is ignored after a post's Share) → decide() with writes not blocked: Posted only on configure_to_story 2xx JSON without redirect; 4xx (or a failed upload) Not posted (`UPLOAD_FAILED`); anything else Couldn't confirm, with a bounded 2-minute hold for a late answer when an upload may still run (§6.4's rule, shortened from 15 minutes). Anything that stops a post after Share is Couldn't confirm, never Not posted. Never a retry. On Posted the phone stays 2 s, then the frame is removed and the session rules cleared, as for every run.
- **Kept:** the kill switch and its 7-day lock, the account check (a post with no expected account, a mismatch or an unreadable account stops before any tap with `ACCOUNT_UNCONFIRMED`; the panel asks for one Check first when no account is known), the rate guard (posts count toward the caps via `rate(…, 'post')` / `noteOpen(…, 'post')`; check and test runs only need the 60-s spacing).
- **Not built:** the account prompt, Finish by hand, the minimised chip, History records and the last result for in-page runs (only `spikeRecords`), View story ↗, the E2E update (`tests/e2e/inpage-spike.spec.ts` still expects the red bar and visible spike buttons).

### 13.7 Prototype: HEIC import (2026-10-15; AirDrop dropped for now)

Owner's request: "add support for .HEIC files and receive a file via AirDrop … the user sends the image from its phone via AirDrop, it seamlessly appears in our composer." In-page build only. Then, the same day: "I don't think the solution can include running and configuring a folder action. This is not something a normal user will do. Can we now drag and drop an HEIC file directly into the composer and forget about AirDrop for the time being?"

**HEIC/HEIF.** Every way the composer takes a photo (drag and drop from Finder, Choose photo…, paste, Recent photos) accepts HEIC/HEIF.

- Intake (`entrypoints/spike-panel/actions.ts` `firstImage`, rules in `src/raster/decode.ts` `isPhotoFile`/`heicByLabel`): a dropped or pasted file is a photo by its type (`image/*`), by a HEIC/HEIF name (`.heic`, `.heif`, `.hif`) or type (`image/heic`, `image/heif`, the `-sequence` ones), or else by its first bytes (JPEG, PNG, WebP, AVIF, or an ftyp brand among `heic heix hevc hevx heim heis mif1 msf1`): Finder hands a dragged HEIC over as `image/heic`, `''` or `application/octet-stream`. Choose photo… accepts `.heic,.heif,image/heic,image/heif`. A file dropped outside the dialog, or while it can't take a photo, does nothing (unhandled, the browser would open it in place of Instagram). The button (or, over a photo, a pill on the stage) reads "Converting HEIC…", then the photo is on the stage.
- Decoder: **libheif-js 1.23.2** (libheif's Emscripten build, wasm). **License: LGPL-3.0** (libheif; its bundled libde265 is LGPL-3.0 too). Shipped unmodified as a separate file (`assets/libheif-*.wasm` plus its glue in `assets/heic.worker-*.js`), so the LGPL's relinking terms are met by replacing those files; the LICENSE travels in `node_modules/libheif-js`. Before any public release: add the LGPL notice and a pointer to the source to the extension's About/credits.
- Lazy: `src/raster/decode.ts` knows HEIC only through `enableHeic(() => import('…/heic.ts'))`, which only the composer's entry calls; mock and live contain none of it (check-bundle: T3 fails if the worker appears outside the in-page build). The worker starts on the first HEIC and stops 30 s after the last, which also returns its wasm heap.
- Worker (`src/raster/heic.worker.ts`, a packaged module worker; MV3 forbids `blob:` workers): fetches its own wasm, compiles it under the existing `'wasm-unsafe-eval'`, decodes the primary image with libheif's default options (`irot`, `imir` and `clap` applied, so the pixels are upright; EXIF orientation is not applied again), tags the RGBA with its colour space and converts to sRGB on an OffscreenCanvas, then transfers the full-size ImageBitmap to the composer (the existing proxy/export path takes it unchanged) and finally encodes a JPEG (q 0.92) of the same pixels.
- Colour: iPhone HEICs are Display P3 (an ICC profile named "Display P3"; nclx primaries 12 elsewhere). `heic-colour.ts` reads the `colr` property; the canvas converts P3 → sRGB (checked on Chromium 155: P3 200,100,50 → sRGB 215,93,31). Anything else is treated as sRGB. HDR gain maps and 10-bit depth are dropped (8-bit SDR out).
- The stored original is the JPEG, under the HEIC's SHA-256 (browsers can't show a HEIC in Recent photos; drafts and Recent reopen it natively). Importing the same HEIC again decodes that JPEG and skips the worker.
- Speed (CfT 155 headless, this MacBook, synthetic noisy photos, extension CSP): 12 MP 0.8 s in the worker, about 1.1 s to the stage; 48 MP 3.2 s, about 4.2 s to the stage; the JPEG follows 0.25 s / 1.1 s later. The composer stays responsive throughout; the button reads "Converting HEIC…" (a pill on the stage when replacing a photo). Errors: "Couldn't convert this HEIC photo …" (DECODE_FAILED, `HEIC: …`), with a 60-s timeout and a fresh worker after any failure.

**AirDrop: dropped for now.** AirDrop always saves to ~/Downloads, and **Chromium refuses ~/Downloads itself to the File System Access API**: its blocklist has `DIR_DEFAULT_DOWNLOADS` (and home, Desktop, Documents) as "block this folder, allow its children", for the picker and for a dropped folder alike. So no extension page can watch where AirDrop lands. The prototype got around it with a **macOS Folder Action** on ~/Downloads (installed from Terminal) copying AirDropped photos into a child folder the composer watched; the owner ruled that out: installing and configuring a Folder Action is not something a normal user will do. The folder watch, its connect page, the bridge script and every "Get photos from your phone" entry were removed. The way in from the phone today: AirDrop to the Mac, then drag the photo from Finder (Downloads) into the composer. Revisit only with a path that needs no setup outside the browser.

**Unknown until tried in Arc (L-checks to add):**

- Dragging a real iPhone .heic from Finder (Downloads) into the composer in Arc: its MIME type there, Converting HEIC…, then the photo on the stage.
- Real iPhone HEICs: 24/48 MP timing, grid tiles, P3 colour next to the Photos app, Live Photos (the still is used), and HDR photos (gain map ignored).

---

## 14. Adopted as the product (2026-10-15)

The in-page lane worked live in Arc on the secondary account (2026-10-14/15), and the owner made it the product, with the window lane kept as the fallback. Owner decisions: the `X-Frame-Options` strip (rule 1020) and the `Sec-Fetch-Dest: document` forge (rule 1021) are approved deviations (OD15-style); the UI direction is "Create dialog, quiet entry" (`docs/inpage-ui-spec.md`); AirDrop is dropped (§13.7). Ported onto `feat/inpage` (from `main` 37a8085, after the Spanish editor and `pnpm run package`); target release v0.1.1.

| Before (spike branch) | Now |
|---|---|
| `pnpm run build:inpage-spike`, `INSTAPOST_INPAGE_SPIKE=1`, `.output/chrome-mv3-live-inpage`, "instapost IN-PAGE", `__INPAGE_SPIKE__` / `INPAGE_SPIKE` | Gone. Every build (dev, mock, live) carries the in-page lane: `pnpm run build:live` → `.output/chrome-mv3-live`, "instapost" |
| `entrypoints/spike-panel/` → `spike-panel.html` | `entrypoints/composer/` → `composer.html` (web-accessible, `use_dynamic_url`) |
| `src/inpage/spike-driver.ts`, `spike-background.ts` | `src/inpage/driver.ts`, `src/inpage/background.ts` (`createInpageDriver`, `startInpageLane`; types `Inpage*`) |
| Messages `spike/start`, `spike/stop`, `spike/status`, `spike/refused`, `spike/close-panel`; port `inpage-spike-panel` | `run/start`, `run/stop`, `run/status`, `run/refused`, `ui/close-panel`; port `inpage-composer` |
| storage.local `spikeRecords`, `__spike`; run ids `spk_…` | `inpageRecords` (records from the prototype are not carried over), `__e2eInpageToggles`; `inp_…` |
| Toggles read in every build | Developer toggles read and shown in guarded builds only; live always uses `DEFAULT_TOGGLES` (FS14) |
| Content script attached in every www top frame | It asks first (`inpage/attach`); the window lane's composer window gets nothing (no host, entry or observer) |
| The driver's probe always `guarded: false` | Guarded builds apply the fake-marker guard (GUARD_NOT_FAKE) and refuse a branded browser (`BRANDED_BROWSER`), as the window lane does |
| `pnpm run package` default `inpage` (a `.spikes/` copy), `arc:use inpage` (now `pnpm run unpacked`, folder `.unpacked/`) | Default `live`; `--build` rebuilds it; `inpage` is an alias of `live` |
| check-bundle: optional `spike` artifact, in-page files banned elsewhere | Every artifact: the in-page allowances pinned in T1/T2/T3 and documented in `scripts/check-bundle.ts` |
| Playwright projects `inpage-spike`, `inpage-spike-cft155` on the spike artifact | `inpage`, `inpage-cft155` on the mock artifact (the toggles need a guarded build), `inpage-live`, `inpage-live-cft155` (the `@live` post) on the live artifact; the spec drives the composer (AM53) |

**After the port (2026-10-15):**

- **Spanish** (AM48): every composer text is in the editor's typed catalogs (`inpage.*` in `src/ui/catalog.{en,es}.ts`; `src/inpage/strings.ts` only maps surfaces to keys, read at access time), and the entry's and coach's texts are the `page.*` keys in `src/ui/catalog.page.{en,es}.ts`, the only catalog the content script imports (with the signal-free `src/ui/i18n-core.ts`). The composer follows Settings → Language at once and now offers the setting; the content script gets the language resolved by the background with `inpage/state` (`PageState.lang`) and reads no storage. Dates in the pause texts read as Spanish sentences (ES-1). Tests: U30 (keys), U39 (surfaces), B20 (the entry).
- **Ids** (AM52): U37, U38, B19, E57, E58, L30 replace this file's colliding U30, U31, B15, E44, E45, L24; U31's no-text scan now covers the in-page decision code; U37 tests rule 1021 too.
- **Docs**: §12 above.
- **The fake and the E2E (2026-10-16, strategy AM53):** the fake now models the in-page facts by default: `X-Frame-Options: DENY` on every document, a framed (`Sec-Fetch-Dest: iframe`) document answered with "Sorry, this page isn't available" (`framed=unavailable`; rule 1021's `document` gets msite), Instagram's responsive left navigation whose collapsed form widens while hovered (`desktopNav=auto`), and the light/dark signal (`theme`); baseline.json carries `framedDocument` and `desktopNav` with their live provenance (U16). `tests/e2e/inpage.spec.ts` drives the composer and the entry: E46–E48, E51–E53, E55, E57, E58 ported, E59–E66 new (the entry on the responsive navigation, the 2026-10-15 hover regression, the dialog and the chip, the forge proven necessary, a real post on the live build, HEIC by Choose photo… and by drop, Spanish, light and dark). Two product fixes came out of it: a frame that shows neither the story input nor the account link after the one wait is `FRAME_REFUSED` (page unavailable) in every mode (a check used to pass there); and the composer re-reads its size on every mode change (opened right after its 0×0 preload, it sometimes drew the dialog off screen).

**Release review fixes (2026-10-16, for v0.1.1).** Each with a regression test:

- **RS-1** The window lane's idle cleanup (any tab or window closing) no longer removes the session rules while an in-page run holds them (background-main; U11). The driver reads its rules again right before the share command (after the dwell): any of its rules gone (1001, 1020, 1021, a test's write block) stops the run before Share; a test whose write block goes away while deciding is TEST_LEAK at once (U36).
- **RS-2** Anything that ends a post after Share, a kill included, is Couldn't confirm; a kill keeps its 7-day lock. The result view never shows "Not posted … Nothing was posted" + Send to phone for a post whose Share went out unrefused (only Instagram's own refusal, UPLOAD_FAILED, is Not posted).
- **RL-1** The desktop page's own URL kills only on Instagram's security routes (`/challenge`, `/checkpoint`, `/auth_platform`, `/accounts/suspended|disabled|onetap|password/reset`); Settings, Edit profile and every other `/accounts` settings route are ordinary pages (the frame still fails closed on every `/accounts` path). tabs.onUpdated acts on a change of the page's path only (a run started on Settings is not the page going there). After a post's Share, a security page in the desktop page is recorded, decide() finishes with the frame kept, then the lane locks (Posted with "desktop posting is paused", or Couldn't confirm).
- **RS-3** An in-flight marker (storage.local `inpageInflight`: the run at its start and again right before Share; cleared once its record is saved). A worker that finds one at its start saves the lost run as Couldn't confirm (after Share) or Stopped (before) and shows it as the last result; the composer shows that result even if it never saw the run start (FX14).
- **RS-4** `pnpm run package`: BUILD.txt and the `--to` marker name the build (`live`), never a path on the owner's Mac; the staged folder is refused if any text file names the repo or the home folder.
- **RL-2** onInstalled (install, update) re-injects the content script into open Instagram tabs; the toolbar on an Instagram tab without it injects and asks again, else opens the editor with "instapost was updated. Reload your Instagram tab to post from it." (FX14). INSTALL.txt says to reload a tab that was already open.
- **RL-3** Every build ships `licenses/libheif-LICENSE.txt` (LGPL-3.0 and GPL-3.0, from libheif-js) and `licenses/THIRD-PARTY.txt` (libheif 1.23.2, libde265 1.0.15, libheif-js 1.23.2, their source, the replaceable files); check-bundle T1 and the package step fail without them; INSTALL.txt has a Third-party section. R30 closed.
- **RL-5** The live toolbar icon is the FE9 mark (card, arrow, jade dot) on a dark tile (scripts/gen-icons.ts, tools/icons/); dev and mock keep their stripes. FR12 done.
- **RL-6** FX7: Instagram's login wall (a password field, no account link, no nav) gets no entry, and the page reports itself logged out (the Post card says to log in).
- **RL-7** The Spanish chip lines are shortened to fit (a browser test measures every chip text in both languages at 220 and 240 px).
- **RL-8** ACCOUNT_UNCONFIRMED's text follows the decision: another account, an unreadable one (turn off "Only post as" to post anyway), or none known yet (run the setup test).
- **RL-9** Right-to-left Instagram: the nav at the right edge is found; the corner, the fallback chip, the tooltip and the coach mirror.
- **RL-10** The shortcut shown (entry, tooltip, coach, keyboard sheet) is the one the browser assigned (`chrome.commands`), none when unset; the composer's own keys read `Ctrl+…` off macOS. INSTALL.txt says where to set it.
- **RL-11** README's test paragraph matches the ported spec.

**Release review fixes, second round (for v0.1.1).** Each with a regression test:

- **RS-5** A queued post (K10 → K11, and a paced result button) takes its export at the press and posts exactly that photo when the queue fires, with its frozen thumbnail in the K11 card; pasting the next photo or typing while it waits changes nothing. A queue never fires on a logged-out page (composer-state test).
- **RS-6** The Posted linger (2 s) now comes before the lock is weighed, with the kill switch still listening: a security page in the desktop page or in the frame during those seconds keeps the outcome Posted and locks the lane (U36).
- **RS-7** A run never starts on a page that is already on a security route (`/challenge`, `/checkpoint`, `/accounts/suspended`…): nothing is installed or opened, no open is counted, and the lane locks as the kill switch would mid-run (refused PAUSED); on the login page it is refused NOT_LOGGED_IN (U36).
- **RS-9** `pnpm run package` ships only a checked, current, traceable build: the live build is refused when any build input (src/, entrypoints/, public/, wxt.config.ts, package.json; tests aside) is newer than it, check-bundle T1–T5 runs on it (`--build` now runs build:all, as T5 needs both artifacts); a folder build needs `--unchecked`; a tree with uncommitted changes (untracked files too) needs `--allow-dirty`; BUILD.txt and the `--to` marker record `git describe --always --dirty`, the branch, the build's own time (also the version_name stamp) and the packaging time. Version 0.1.1.
- **RS-10 / RL-20** INSTALL.txt names the browser version the manifest requires (from `minimum_chrome_version`, 155) and where to update; says Instagram's own page can see instapost; that a shared folder must be view-only for the friend and written only by whoever shares the build (anyone who can change it runs code in their logged-in Instagram); to wait for a sync, then reload instapost and the Instagram tab, and not post mid-sync; and that Details carry the Instagram username.
- **RL-13** The in-page duplicate guard is persisted: a post's record carries its export's SHA-256 and doc hash, and the Post card reads the stored records (story-guard.ts), so K8 (This story may already be posted · Check my story, link It didn't post — post again) and K12 (Posted at … · Post again, before K10 so it holds through the spacing) survive View story's and Check my story's page load. It posted · It didn't post write the owner's mark onto the stored record (`ui/mark`; History shows "marked by you" and the guard reads it) and dismiss the result. The Post card's K-states are now pure (src/inpage/post-card.ts) and in the window lane's order.
- **RL-14** A result's Post story and Try again are paced like the Post card: during the spacing they read `Post story · in 0:41` / `Try again · 0:41` and queue (with the export taken at the press); under an hour or day cap they read `Available at …`, disabled. The result stays up until the new run is seen starting, so a refused start no longer drops its explanation.
- **RL-15** While the pointer is in the nav only the entry's placement is frozen, not its visibility: an Instagram overlay (More, Create, Search) that opens over the entry's slot hides it, so it never takes their clicks (B-test with a body-level popover).
- **RL-16** The import error line is decided by the error, not by the notice text (which mentions HEIC in both languages): a failed HEIC conversion reads "Couldn't convert this HEIC photo", a GIF, TIFF or damaged JPEG "Can't open this file".
- **RL-17** "Keep this page open" (held) shows only while the hold is live; a Couldn't confirm after the 2-minute hold ran out no longer says it (the frame is gone).
- **RL-19** SW_INTERCEPTS and ACCEPT_DRIFT have their own copy (Instagram changed its page; trying again won't help) with Send to phone as the only action.

Still open for the release: the "Post using: This tab | A window" switch of FS14, and whether `declarativeNetRequest` is still needed now that live ships no static ruleset (drop it only after a live check). The version is 0.1.1.

## 15. Repost (0.2.0)

Repost to story (Share → **Add to story** on a photo post, **Add to your story** on a story that mentions the owner) builds on this lane without changing it: the content script reads a post's metadata at the owner's click and docks its entries to Instagram's Share dialog, the composer loads the picture from Instagram's image CDN (the one audited GET, strategy AM55) and renders it as a card, and the run posts pixels as any story. Nothing changes Instagram's publish request: App-style repost (strategy AM60, OD21: the post sticker and the @mention by app-only fields in that request) was declined in the build and is not implemented (README hard rule 8). Spec, ids (RP-n; U40–U51, B21–B28, L37–L51, R31–R41 per AM61), risks and the owner's live checks: [`docs/repost.md`](repost.md).
