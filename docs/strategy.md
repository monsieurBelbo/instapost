# instapost: implementation strategy

- **Status:** final strategy for the build phase, 2026-10-11.
- **Inputs:** `docs/research.md` (the fact base; "§n" and "research Qn" refer to it), three proposals and three judge reports. The risk-first proposal is the base. Judge-requested grafts and every must-fix item are folded in.
- **Conventions:**
  - **(unverified)** marks anything research could not confirm, or that this plan infers. Each one has a cheap check, listed in §9.2.
  - "Research §1 item n" means item n of research.md's TL;DR.
  - Checklist ids are stable. Never renumber or reuse an id: a new item takes the next free number in its section, and a dropped item is struck through, not deleted.
  - Commits, pushes and merges follow the owner's global rules: nothing is committed without the owner's explicit approval.
- **Local facts checked on 2026-10-11 on the owner's Mac:**
  - Google Chrome 155.0.8059.40, Node 22.18.0, pnpm 9.15.0, OpenSSL 3.0.14 on PATH.
  - Built-in display 3024x1964 Retina, which is 1512x982 pt at DPR 2.
  - The npm registry shows WXT 0.21.4 is itself developed against TypeScript ^6.0.3, Vite ^8.2 and Vitest ^4.1.10.
  - `pnpm setup` and `pnpm ci` are pnpm built-ins (judge-verified), so no project script uses those names.

---

## 1. Summary

1. **Route.** On a personal account, the only way to post a story from desktop is Instagram's own mobile-web (msite) story composer (research §1 item 2; §5.9 tier 1).
   - instapost opens it in a dedicated portrait popup with a User-Agent rewrite scoped to that tab, and hands it the finished image.
   - **The owner clicks Share.** The extension never calls Instagram write endpoints and never clicks anything in Instagram's page.
2. **Impossible from desktop on a personal account:**
   - video stories, because the msite composer is photo-only (§5.2);
   - Instagram's licensed music sticker;
   - interactive stickers: mention, link, poll, location and hashtag;
   - Close Friends;
   - scheduling;
   - any official API, because Graph API stories need a Business account (§4.1).
3. **Music, honestly.**
   - No desktop, web or API route adds Instagram's licensed music to a story, for any account type (research §1 item 5; §4.4).
   - v1: instapost reserves space for the music sticker in the editor and sends the image to the phone, where the owner adds the sticker.
   - v3: it can burn the owner's own or royalty-free audio into an MP4. On a personal account that MP4 also has to go through the phone.
4. **The local editor gets most of the effort.** It produces exact 1080x1920 output and offers:
   - cover, contain and free fit, with pan, zoom and rotate;
   - safe-zone and preview overlays;
   - burned-in text in OFL fonts.

   It works without Instagram, and no Instagram change can break it.
5. **Three exits, risk-free ones first.** Download and the share sheet (AirDrop to the phone) ship before any code that touches Instagram. A lane picker sends frames that carry music, stickers or Close Friends to the phone, and says why.
6. **Hand-off ladder:**
   - H1, assisted insert, enabled only after a live check;
   - then H0, manual pick: the owner picks the downloaded file;
   - then export.

   Each level gets one attempt. There are no retries and no escalation to drop events or CDP.
7. **Small Instagram footprint:**
   - no `content_scripts`, no `web_accessible_resources`, no MAIN-world script and no `chrome.debugger`;
   - one isolated-world agent, injected only into the composer tab;
   - header-only dNR session rules with an Android Chrome reduced UA, installed before the first navigation;
   - a hard reload to get past Instagram's service worker;
   - a kill switch on login, challenge, checkpoint and off-host URLs;
   - human-pace caps.
8. **Dev environment.**
   - One fake Instagram (Node HTTPS on 127.0.0.1:8443) is served at the real origin to a sealed Chrome.
   - The seal is a resolver allow-list, no proxy, and a self-signed certificate accepted by its SPKI hash.
   - Manual dev and E2E both use it. "Posted" stories land in `/__fake__/`.
   - Every unverified Instagram behaviour is a switchable knob.
9. **Builds.**
   - `development` and `mock` are guarded: they carry a static write-block ruleset and a fake-marker guard. `live` is the third mode.
   - Both the `mock` and the `live` artifacts are E2E-tested against the fake. Canary tests prove the block rules fire where they should and nowhere else.
   - Automation never runs in a profile that can reach real Meta hosts or that is logged in to Instagram.
10. **Live checks** run only on a secondary account, by hand, as a ladder:
    1. a logged-out UA check;
    2. a read-only probe;
    3. geometry measured without clicking Share;
    4. an injection check;
    5. at most one rehearsal Share;
    6. the first real post;
    7. a 14-day soak.

    A gate follows, including the owner explicitly accepting the terms-of-use grey area, before the primary account is used.
11. **Biggest unknown: the composer's canvas geometry.**
    - On the owner's 1512x982-pt MacBook, a 9:16 popup is about 880–900 CSS px tall.
    - If the canvas follows viewport × DPR, the upload is therefore about 1760–1800 px tall instead of 1920, a 6–9% downscale.
    - Per-tab zoom cannot fix that case. macOS display scaling ("More Space") or an external monitor can.
    - L5 measures it.
12. **Account type: stay personal.** Revisit Creator plus Meta Business Suite only if desktop video or link stickers become important. Business plus the Graph API is not recommended.

---

## 2. Decision: publish routes

### 2.1 Routes, ranked for a personal account

| Rank | Route | Tier (§5.9) | Works on personal | Photo / Video / Music | Plan |
|---|---|---|---|---|---|
| 1 | **msite hand-off** (H1 assisted insert → H0 manual pick) | 1 | Yes | Photo only / No / No | Primary desktop route. Built against the fake in D, verified live in L |
| 2 | **Phone hand-off**: `navigator.share({files})` (AirDrop is (unverified), research Q24), or download then Finder share | 0 | Yes | Yes / Yes from v2 / added in the app | v1; always available; the only route for video, music, stickers and Close Friends |
| 3 | **Download** (`~/Downloads/instapost/`) | 0 | Yes | Yes / Yes from v2 / — | v1, always on |
| Check | Desktop story creator **without** spoofing (Instagram blog of 2026-07-02, research Q1) | 0 | ? | ? | L1. If it exists, it replaces the msite route |
| Future | Creator account + Meta Business Suite, manual upload | 0 | No (Creator) | Yes / Yes / No (link sticker, no music) | Only if the owner switches. instapost adds an "MBS export" preset and never automates MBS (M3) |
| Future | Business account + Graph API adapter | 0 | No (Business) | Yes / Yes / No | Not recommended: needs public HTTPS hosting, a Meta app and a 60-day token (§4). Port reserved, not built (M4) |
| Excluded by policy | `chrome.debugger` emulation; MAIN-world navigator overrides | 1 (they are §5.4 backends for the same tier-1 route) | — | — | Not in v1, because of the footprint, the infobar and CDP on a logged-in tab. Debugger DPR emulation only as an owner-approved geometry fix (OD4) |
| Never | Hand-built private requests (2); native-only fields or signed bodies (3); password emulation or SaaS (4); waking msite's unreached `uploadStoryVideo` (2) | 2–4 | — | — | Out of scope |

### 2.2 What each lane can carry

| | Desktop lane (msite) | Phone lane |
|---|---|---|
| Photo with exact crop, position and text | Yes | Yes |
| Video | No | Yes (v2) |
| Licensed music sticker | No | Added in the app over a reserved placeholder |
| Mention, link, poll and location stickers; Close Friends | No | In the app; the editor reserves space |
| Owner effort per story | One Share click in the popup (plus a file pick on H0) | AirDrop, then 3–5 taps |
| Risk tier | 1 | 0 |

### 2.3 Risk notes

- **Terms-of-use grey area.** Instagram's Terms ban circumventing "technological measures" (§5.8). Whether a hidden-UI limit counts as one is a matter of interpretation. Research found no enforcement against individual users; enforcement targeted commercial automation.
- **The spoofed session stays detectably inconsistent** (research §1 item 10; §5.4):
  - the msite app ID `1217981644879628` appears alongside the desktop ID in the same session;
  - `X-IG-Max-Touch-Points: 0` is sent;
  - `navigator.userAgentData` says macOS desktop.

  The Android profile makes the `Sec-CH-UA-*` headers consistent with the UA, but the JS realm still says desktop. This cannot be removed, only kept small, human-paced and optional.
- **Fragility.** Instagram's msite code is point-in-time (research preamble, "Method limits"). The fallbacks are H0, then export or the phone. Detection is the per-hand-off probe (§3.9).

### 2.4 What the owner must decide or accept

| Id | Item |
|---|---|
| OD1 | Accept the residual terms-of-use grey area (required before gate G) |
| L3 | Create and use a secondary account |
| OD2 | Soak length |
| OD3 | Whether H1 is enabled after L6 |
| OD4 | What to do if the composer downscales |
| OD5 | Account type |

§10 has the details.

---

## 3. Architecture

### 3.0 Verdicts on the lead's preliminary thoughts

1. **"The contract is DOM/UX, not network": agreed, with three corrections.**
   - **The network is part of the contract.** The server classifies the *document request's* UA (§5.1), so the dNR rule must list `main_frame` explicitly: with `resourceTypes` unset, dNR matches everything *except* `main_frame`. Requests made by Instagram's service worker (tabId -1) escape tab-scoped rules (§5.4).
   - **Share belongs to the human.** The extension never reads or clicks it. The fake records `event.isTrusted` on Share and fails the test if the click was untrusted.
   - **The fake's Share posts to `/__fake__/stories`**, so the write-block ruleset stays on in every guarded build, E2E included. This reverses §8.5's "omit it in e2e", which was only needed because of `route()`. A `share=real-paths` canary knob also fires real-shaped writes to prove the rules block them.
2. **One HTTPS fake behind `--host-resolver-rules`: agreed, hardened.**
   - Use an **allow-list**: map the two fake hosts, then `MAP * ~NOTFOUND`, plus `--no-proxy-server` and `--disable-quic`. A system or PAC proxy would otherwise bypass the mapping.
   - Playwright only drives the browser and **observes** requests; it never uses `route()`.
   - The fake core is transport-free, so a `context.route` adapter is a cheap fallback if spike S3 fails.
   - Two browser binaries:
     - **CfT 155.0.8059.39** for `pnpm run dev` and an `@smoke` E2E project, because dNR client-hint behaviour is version-specific (research Q27) and the owner runs 155;
     - **Playwright's bundled Chromium** for the full E2E suite.
   - The **live artifact is E2E-tested too**, inside the sealed browser.
3. **The geometry probe comes first among msite checks: agreed, with a different method and a sharper expectation.**
   - It runs after L1 (desktop creator check), L2 (logged-out UA check) and L4 (read-only probe).
   - It measures **without a Share click**: the agent reads `canvas.width/height`, the canvas's CSS rect and the DPR (no pixel reads, so taint and WebGL do not matter). The composer's own save action (`SAVE_STORY`, §5.2; whether the UI exposes it is (unverified)) can export the result for analysis.
   - **Per-tab zoom cannot add device pixels to a canvas sized to the viewport.** Zoom raises the DPR and shrinks the CSS viewport by the same factor. It helps only if the composer fixes the canvas's CSS size, and the fake's `cssFixed` geometry model tests exactly that case.
4. **No persistent content script: agreed, and stricter.**
   - No `content_scripts` and no `web_accessible_resources`.
   - Session rules are created while the popup is still at `about:blank`, before the first navigation. They use fixed IDs, and cleanup is idempotent.
   - Host permissions are **required**, not optional: `permissions.request` opens a native prompt that Playwright cannot accept, which would leave the hand-off untestable.
   - A kill switch watches the composer tab's URL.
5. **Editor in a full tab with a pure render model: agreed.**
   - `compose(doc, frameId, tMs)` produces a serialisable display list, and one rasteriser serves both preview and export.
   - It is time-parametric from day one, so video plugs in later.
   - The render worker is deferred until video (or until the UI janks).
   - pica (as research §7.2 recommends) arrives in P5, with a quality test.

### 3.1 Entrypoints (WXT 0.21.4)

| Entrypoint | Role |
|---|---|
| `entrypoints/background.ts` | Hand-off orchestrator: pure reducer plus effect runner, with state in `chrome.storage.session` so it survives service-worker restarts. Also owns dNR session rules, the kill switch, the rate guard and cleanup (`onStartup`, `onInstalled`, `windows.onRemoved`). Clicking the action opens or focuses the editor tab, whose id is kept in `storage.session`, so no `tabs` permission is needed |
| `entrypoints/editor/index.html` + `main.tsx` | Full-tab editor, export, hand-off panel and settings (`#/settings`). Testable in Playwright |
| `entrypoints/composer-agent.ts` | `defineUnlistedScript`, isolated world. Injected with `scripting.executeScript` into the registered composer tab only. Probes, H1 insert and watch; no clicks |
| Later: `render.worker.ts`, `heic.worker.ts` (P4), `video.worker.ts` (V1) | Packaged worker files. No `blob:` workers (§7.4) |

None of these exist: side panel, offscreen document, options page, MAIN-world script.

### 3.2 Modules (functional core, imperative shell)

```
src/core/            pure TypeScript; own tsconfig with lib ES2023 only (no DOM, no chrome types)
  model/             story.ts (schema 1), ids.ts, migrate.ts
  geometry/          fit.ts, transform.ts, safe-zones.ts, window-fit.ts
  text/              layout.ts behind a TextMeasurer port (Intl.Segmenter)
  render/            compose.ts → DrawOp[] (display list), ops.ts
  export/            policy.ts (format per purpose, JPEG quality stepping)
  handoff/           state.ts, reducer.ts, effects.ts, rate-guard.ts, errors.ts
  ig-contract/       device-profile.ts, write-endpoints.ts, rules.ts, urls.ts, ua-json.ts,
                     contract.ts (C1–C9), probe-eval.ts, baseline.json
src/raster/          DOM side: rasterize.ts, measurer-canvas.ts, decode.ts, encode.ts, fonts.ts, calibration.ts
src/agent/           composer-agent internals: probes.ts, inject.ts, watch.ts (DOM only; messaging via shared/protocol)
src/handoff/         runner.ts (executes effects), session-store.ts, kill-switch.ts
src/publish/         lane.ts, download.ts, share.ts, msite.ts
src/platform/        thin wrappers: dnr, scripting, windows, tabs, downloads, storage, idb (mocked in Vitest; §8.4)
src/shared/          protocol.ts (messages v:1 and guards), env.ts (MODE, GUARDED), b64.ts
src/ui/              Preact components
```

**Enforced seams:**

- `tsc -p src/core` compiles with `lib: ["ES2023"]` and `types: []`. Any import that pulls in DOM or `chrome` types fails the type check.
- Only `src/core/ig-contract/`, `src/agent/` and `tools/fake-ig/` may contain Instagram-specific strings (T3).
- Files under `src/core/` and `tools/` use relative imports with explicit `.ts` extensions, so Node 22.18 can run the tools directly.

### 3.3 Data model

```ts
// src/core/model/story.ts — schema 1. Units: story pixels, 0..1080 × 0..1920.
export interface StoryDoc { id: string; schema: 1; size: { w: 1080; h: 1920 }; frames: Frame[]; createdAt: number; updatedAt: number }
export interface Frame {
  id: string;
  durationMs: number | null;              // null = photo. Video and audio frames set it (v2)
  background: Fill;
  layers: Layer[];                        // bottom to top
  audience: 'all' | 'closeFriends';       // closeFriends forces the phone lane
  musicPlan?: MusicPlan;                  // forces the phone lane
}
export type Fill =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; from: string; to: string; angleDeg: number }   // colours sampled from the image (P3)
  | { kind: 'blur'; assetId: string; radiusPx: number; dim: number };
export interface Xf { cx: number; cy: number; scale: number; rotDeg: number }  // centre-based; scale 1 = the fit's base scale
export interface Timed { startMs?: number; endMs?: number }                     // ignored for photos
export type Layer = ImageLayer | TextLayer | PlaceholderLayer | VideoLayer;
export interface ImageLayer extends Timed { kind: 'image'; id: string; assetId: string;
  fit: 'cover' | 'contain' | 'free'; focal: { x: number; y: number }; xf: Xf }   // focal (0..1) is used for the initial placement and "re-fit"; xf is the source of truth
export interface TextLayer extends Timed { kind: 'text'; id: string; text: string; fontId: string; sizePx: number; color: string;
  align: 'left' | 'center' | 'right'; style: 'plain' | 'highlight' | 'inverse' | 'outline' | 'glow'; boxColor?: string;
  letterSpacingPx: number; lineHeight: number; maxWidthPx: number; xf: Xf }
export interface PlaceholderLayer { kind: 'placeholder'; id: string;                  // preview only, never exported
  purpose: 'music' | 'mention' | 'link' | 'poll' | 'location' | 'other'; rect: { x: number; y: number; w: number; h: number }; label: string }
export interface VideoLayer extends Timed { kind: 'video'; id: string; assetId: string;
  trim: { inMs: number; outMs: number }; fit: 'cover' | 'contain'; xf: Xf }          // reserved: compose() throws NOT_IMPLEMENTED until V1
export interface MusicPlan { title: string; artist?: string; startSec?: number; note?: string }
```

- **Cover:** the base scale is `max(1080/w, 1920/h)`. `xf.scale` is clamped to at least 1, and the translation is clamped so the frame is always covered.
- **Contain:** the base scale is `min(…)`, with no clamp.
- **Free:** no clamps.

**Storage:**

| Where | What |
|---|---|
| IndexedDB (`idb`) store `assets` | Original Blob, keyed by SHA-256, with w, h and mime |
| IndexedDB store `docs` | StoryDoc |
| IndexedDB store `exports` | `{id, docId, frameId, docHash, purpose:'msite'\|'phone'\|'download', mime, w, h, bytes, sha256, blob, createdAt}` |
| IndexedDB store `handoffs` | Log records (§3.6) |
| `chrome.storage.local` | Settings: `accountLabel`, `assistedInsert`, `rehearsal`, `chMode: 'full'\|'uaOnly'`, `msiteLockedUntil`, `composerProfile`, stricter rate caps |
| `chrome.storage.session` | The active hand-off state |

### 3.4 Rendering pipeline

1. **Decode.** For JPEG, PNG, WebP and AVIF, use `createImageBitmap(blob, {imageOrientation:'from-image'})` at full size, upright. Decoding once and cropping later avoids the EXIF sub-region bug (§3.3).
   - HEIC goes through `heic.worker.ts` with libheif-js 1.23.5 (P4). heic-to is not used: it creates blob workers (§7.4).
   - The original is stored. A proxy of at most 2160 px on the long side drives interaction.
2. **Compose** (pure): `compose(doc, frameId, tMs, target: 'preview' | 'export') → DrawOp[]`. Placeholders and guides are emitted only for `preview`.
3. **Rasterise:** one `rasterize(ops, ctx, scale)` call for both targets.
   - Preview: an on-screen canvas.
   - Export: `new OffscreenCanvas(1080, 1920)`, using `getContext('2d', {colorSpace:'srgb'})`.
   - It throws `FONT_NOT_LOADED` unless every font it uses passes `document.fonts.check` (or `self.fonts.check` in a worker).
4. **Resample.** The walking skeleton uses `imageSmoothingQuality = 'high'`. P5 adds **pica 10.0.3, split build, `mks2013`** (never the `cib` path), as research §7.2 recommends, to pre-resample sources that shrink by more than 2x. P5 includes a zone-plate quality test, so the gain is measured rather than assumed.
5. **Encode** with `convertToBlob`.
   - **Download and phone lanes:** JPEG, with quality stepping 0.92 → 0.88 → … → 0.72 until the file is 8 MB or less, otherwise `EXPORT_TOO_LARGE` (§3.1).
   - **msite lane:** PNG. The composer accepts PNG and re-encodes to JPEG at about 0.92 (§2 fn 5), so Instagram's encode stays the only lossy step. PNG and JPEG hand-offs are compared in L8.
   - Re-encoding strips EXIF and GPS data, and the UI says so.
6. **Fonts:** `FontFace` from bundled woff2 files, awaited before any draw.

### 3.5 Messaging

All messages are JSON discriminated unions with `v: 1`, defined in `src/shared/protocol.ts`. The export goes to the agent as **base64** (a 1080x1920 PNG is about 3–7 MB, far below the 64 MB message limit). That avoids the manifest-wide `message_serialization` switch and keeps every peer simple. The protocol module hides the encoding, so changing it is a one-file change.

| Channel | Messages |
|---|---|
| Editor ⇄ background, `runtime.connect({name:'handoff'})` | Editor → background: `handoff/start {exportId, mode:'post'\|'probe', rehearsal, screen:{availLeft, availTop, availWidth, availHeight}}`, `handoff/cancel`, `handoff/outcome {handoffId, posted}`. Background → editor: `handoff/status {handoffId, phase, level, error?, probe?, banner?:'FAKE_INSTAGRAM'}` |
| Background → agent, `tabs.sendMessage(tabId, msg, {frameId:0})` | `agent/probe`, `agent/inject`, `agent/watch {readyTimeoutMs}`, each carrying `{handoffId, nonce}` |
| Agent → background, `runtime.sendMessage` | `agent/report {probe}`; `agent/get-file`, answered with `{ok, name, mime, b64}`; `agent/event {event:'input-appeared'\|'composer-ready'\|'composer-left'\|'inject-ignored'\|'inject-unconfirmed'\|'sw-controller-change'}` (`inject-unconfirmed`: AM28) |

The background **accepts an agent message only when all of these hold:**

- `sender.id === runtime.id`;
- `sender.tab.id === state.tabId` and `sender.frameId === 0`;
- `new URL(sender.url).origin === 'https://www.instagram.com'`;
- `handoffId` and `nonce` match the active hand-off (the nonce comes from `crypto.randomUUID()`, is created per hand-off and is sent only through `tabs.sendMessage`);
- the current phase allows the message (`get-file` only in `injecting`).

Anything else is dropped and logged. The agent never reads extension storage; T3 bans `storage.` in its bundle. All waiting happens in the agent or the editor, so the background service worker stays event-driven.

`ProbeReport`:

```ts
{ marker: boolean; isMobile: true | false | 'unknown'; inner: { w: number; h: number }; dpr: number; portrait: boolean;
  swControlled: boolean | 'unknown'; storyInput: 'present' | 'absent'; acceptOk: boolean; acceptSeen?: string[];
  canvas?: { w: number; h: number; css: { x: number; y: number; w: number; h: number } }; lang: string }
```

### 3.6 The composer popup: creation, scoping and lifecycle

**Preconditions:**

- the msite lane is not locked;
- the rate guard allows another hand-off;
- no hand-off is active;
- the export is saved;
- for `post`, the PNG is already in `~/Downloads/instapost/`, so H0 needs nothing more.

**Sequence** (each step is an effect emitted by `handoffReducer`):

1. `windows.create({type:'popup', url:'about:blank', focused:true, left, top, width, height})`. The first outer size is a guess: target inner size plus 80 px of height.
2. `declarativeNetRequest.updateSessionRules({removeRuleIds:[1001…1019], addRules:[uaRule(tabId), …(rehearsal ? rehearsalRules(tabId) : [])]})`.
3. **Fit the window.** Read `tabs.get(tabId).width/height` (not sensitive, no `tabs` permission needed), compute the frame delta, then call `windows.update` once to reach `windowFit()` (§7.10).
4. `tabs.update(tabId, {url: 'https://www.instagram.com/create/story/'})`. Whether this direct route works is checked in L4; if it does not, the H0 instructions say "tap + → Story".
5. **Hard reload.** On the first `tabs.onUpdated` with `status:'loading'` and a `www.instagram.com` URL:
   - call `tabs.reload(tabId, {bypassCache:true})` **once**;
   - **arm the kill switch**.

   That a forced reload leaves the page uncontrolled by Instagram's service worker is (unverified); S4 checks it on the fake and L4 checks it live. The reload cuts short the probably service-worker-served first load, which would carry the desktop UA.
6. **Probe.** On `status:'complete'` after the reload, run `scripting.executeScript({target:{tabId, frameIds:[0]}, files:['/composer-agent.js']})`, then `agent/probe`.
7. **Evaluate** the probe in this order. No branch retries, except the single refit for landscape.

   | Condition | Result |
   |---|---|
   | Guarded build and `!marker` | `GUARD_NOT_FAKE`; close the window |
   | Live build and `marker` | Show the "FAKE INSTAGRAM" banner and continue |
   | URL matches login | `NOT_LOGGED_IN`: close **immediately** so nobody logs in inside the spoofed tab (§5.4). No lockout |
   | `isMobile === false`, or `swControlled === true` | `DESKTOP_SHELL`; close |
   | Not `portrait` | Refit once, re-probe. If still landscape: `LANDSCAPE` |
   | `mode:'probe'` | Store the report, close, `DONE` |
   | `storyInput:'absent'` or `!acceptOk`, or H1 disabled | H0: `awaitingPick`. The editor says "In the Instagram window tap + → Story and pick `instapost/<file>.png`". `agent/watch` |
   | Otherwise | H1 (§3.8) |
8. **`awaitingShare`.** When the composer is ready, the editor says "Review in the Instagram window, then tap Share".
   - The agent watches for **C9** (composer left) and for `controllerchange`.
   - A service worker taking control mid-session ends it with `SW_TOOK_CONTROL` (no lockout). Its fetches would bypass the tab rules.
9. **Finish.** On C9, or when the tab URL leaves `/create/story`:
   - the editor asks "Posted?", pre-answered from detection;
   - a `Handoff` record is written;
   - the window closes after 3 s.

   Inactivity for 15 minutes closes the window with `TIMEOUT`.
10. **Cleanup** on `windows.onRemoved`, `tabs.onRemoved`, `runtime.onStartup` and `runtime.onInstalled`: `removeRuleIds:[1001…1019]` and clear the session state. This is idempotent.

**Kill switch** (`src/handoff/kill-switch.ts`, background side, no DOM). After arming, every `tabs.onUpdated` for the composer tab is classified by `urls.ts`:

| URL | Action |
|---|---|
| `/accounts/login…` | **stop**: close the window, remove the rules, no lockout |
| `/challenge/…` or `/checkpoint/…` | **kill** |
| Any host other than `www.instagram.com` | **kill** |
| `url` undefined, meaning a host without permission, such as accountscenter or facebook.com | **kill** |
| Any other `www.instagram.com` path outside `/create/story` | "composer left" (C9) |

**Kill** means: close the window, remove the rules, set `msiteLockedUntil = now + 7 days`, and route the story to export or the phone. Re-enabling requires typing `ENABLE` in settings. Nothing is ever retried automatically.

**Rate guard** (all modes, `probe` included):

- at least 60 s between composer opens;
- at most 6 per rolling hour;
- at most 15 per local calendar day.

Settings can only make these stricter. A six-frame story set therefore takes about 6 minutes, which is human pace (§5.8).

**Handoff record:**

```ts
{ id, exportId, mode, level:'H1'|'H0'|null, rehearsal, chMode, phaseLog:[{phase, t}], probe?: ProbeReport,
  outcome: 'posted-confirmed'|'not-posted'|'abandoned'|`failed:${ErrorCode}`|`killed:${ErrorCode}`, startedAt, endedAt }
```

### 3.7 Device profile (dNR, header only)

The profile is the **Android Chrome reduced UA**, whose UA class research verified by curl (§5.1). It keeps the real Chrome brands, which is consistent with Chrome's TLS and HTTP/2 fingerprint. `<major>` comes from `navigator.userAgent` in the background.

**Rule 1001:**

- action `modifyHeaders`, priority 1;
- condition:
  - `tabIds: [composerTab]`;
  - `requestDomains: ['www.instagram.com','i.instagram.com']`;
  - `resourceTypes`: **every type, `main_frame` included**: main_frame, sub_frame, stylesheet, script, image, font, object, xmlhttprequest, ping, csp_report, media, websocket, webtransport, webbundle, other.

| Header | Operation |
|---|---|
| `user-agent` | set `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/<major>.0.0.0 Mobile Safari/537.36` |
| `sec-ch-ua-mobile` | set `?1` |
| `sec-ch-ua-platform` | set `"Android"` (quotes are part of the value) |
| `sec-ch-ua` (brands) | untouched |
| `sec-ch-ua-platform-version`, `-arch`, `-bitness`, `-model`, `-full-version`, `-full-version-list`, `-wow64`, `-form-factors` | remove |

- **Client-hint fallback.** Whether `set` and `remove` on `sec-ch-ua*` apply in CfT 155 is (unverified, research Q27); S5 checks it against the fake's header log. If they do not apply, `chMode:'uaOnly'` keeps only the UA operation; the server ignores client hints (§5.1).
- **Composer parity.** Whether msite serves the Android UA the same story composer as it does iOS is (unverified); L4 checks it.
- **Scope.** CDN hosts are left out of the rule (OD6).
- **Never** append an Instagram app version to the UA (§5.4).

**Rehearsal rules 1002–1019** (any build, toggle in the hand-off panel, default ON in every build; the owner switches it off for the first real post, L8):

- one `block` rule per write-endpoint filter, priority 100, with `tabIds: [composerTab, -1]`;
- `-1` (`tabs.TAB_ID_NONE`) also catches service-worker-initiated uploads;
- the filters are the same list as the static ruleset (§3.2 `write-endpoints.ts`, verbatim from §8.7: `||instagram.com/rupload_igphoto/`, `||instagram.com/rupload_igvideo/`, `||instagram.com/api/v1/media/configure_to_story/`, `/api/v1/web/create/configure_to_story/`, `/create/configure_to_story/`, `/api/v1/media/configure/`, `configure_sidecar/`, `configure_to_clips/`, `configure_to_longform/`);
- no `resourceTypes`, which is a superset of §8.7's list. `main_frame` stays excluded, which is fine because writes are never navigations.

### 3.8 Handing the file to Instagram

- **H1, assisted insert.** The agent finds the story input structurally: an `input[type=file]` whose `accept` list, split on commas and trimmed, **set-equals** `{image/avif, image/jpeg, image/png}` (§5.5; C4). It then:
  1. asks for the file with `agent/get-file`;
  2. builds `new File([bytes], 'story.png', {type:'image/png'})`;
  3. assigns it through `DataTransfer`;
  4. dispatches bubbling, composed `input` and `change` events;
  5. waits up to 10 s for C6, composer ready.

  If C6 appears: `awaitingShare`. Otherwise `INJECTION_IGNORED` → **H0** in the same window, with no second synthetic attempt.
  - The agent enforces one inject per `handoffId`, and the reducer never emits a second `Inject`.
  - Whether `isTrusted=false` is accepted is (unverified); it is checked in L6.
- **H0, manual pick.** The owner taps + → Story in the popup and picks the file from `~/Downloads/instapost/`. The agent only watches for C6 and C9.
- **Never on real Instagram:** `DragEvent`, CDP `DOM.setFileInputFiles`, or clicks of any kind. T3 bans them in the agent bundle.

### 3.9 Drift detection

1. **Preflight on every hand-off.** C1–C5, C8 and the service-worker state are stored on the `Handoff` record. The settings page shows the last 20.
2. **Versioned contract.** `src/core/ig-contract/contract.ts` defines C1–C9. `docs/contract.md` gives each item's probe, evidence and "last verified" date (fake or live).

   | Id | Item | Probe |
   |---|---|---|
   | C1 | `InstagramUserAgent.is_mobile === true` | Agent: first `script[type="application/json"]` containing `"InstagramUserAgent"`, then `"is_mobile"\s*:\s*(true\|false)`. Missing means `unknown` |
   | C2 | Logged in | Background: final URL is not a login pattern |
   | C3 | Portrait | `innerHeight >= innerWidth` |
   | C4 | Story input | Accept set-equality (§3.8) |
   | C5 | `/create/story/` reachable directly | Final URL |
   | C6 | Composer ready | A visible `<canvas>` with CSS area of at least 50% of the viewport and backing size > 0 |
   | C7 | Error toasts | Diagnostics only, never a decision, because they depend on text |
   | C8 | Canvas geometry | Backing size, CSS rect, DPR, inner size |
   | C9 | Composer left | URL leaves `/create/story`, or the C6 canvas is gone for more than 2 s |

   **No probe matches visible text or ARIA labels.** The owner may use a Spanish UI, and the fake runs `en` and `es`.
3. **`baseline.json`** holds structural facts only. It is written from L4 and L5 (§7.7) and contains no HTML and no tokens. The fake's default knobs are derived from it, and U16 fails if they diverge, so updating the baseline forces an update of the fake.
4. **`pnpm run contract:check`** (manual, at most weekly; also L2 and L11). It sends one logged-out GET of `https://www.instagram.com/` per UA: the chosen Android UA and a Mac Chrome UA. It parses `is_mobile` with the **same** `ua-json.ts` the agent uses and prints the result. HTML is never stored.
5. **Chrome drift.** When the branded Chrome major changes:
   - bump `CFT_BUILD`;
   - run `pnpm run test:smoke155` (renamed for the new major);
   - redo L11.
6. **Optional bundle-marker watch** (X6): a logged-out grep of the public JS for the accept list, the rotate guard and the story entry gate.

### 3.10 Error handling

Errors never retry. Every error leaves the image in Downloads and offers the phone lane.

| Code | Cause | Effect |
|---|---|---|
| `RATE_LIMITED`, `HANDOFF_BUSY`, `MSITE_LOCKED` | Guards | No window opens; the UI shows when the lane frees up |
| `GUARD_NOT_FAKE` | Guarded build without the fake marker | Close; nothing injected |
| `BRANDED_BROWSER` | Guarded build in Google Chrome or Microsoft Edge (AM23, AM28) | No window opens |
| `DESKTOP_SHELL` | `is_mobile` false or service-worker-controlled after the hard reload | Close; suggest L-recheck |
| `NOT_LOGGED_IN` | Login URL | Close; "log in on normal desktop instagram.com in this profile, then retry" |
| `LANDSCAPE`, `SCREEN_TOO_SMALL` | Geometry | Close; explain |
| `INPUT_MISSING`, `ACCEPT_DRIFT`, `INJECTION_IGNORED` | Contract | Degrade to H0 in the same window |
| `SW_TOOK_CONTROL` | `controllerchange` mid-session | Close |
| `KILLED_CHALLENGE`, `KILLED_OFFHOST` | Kill switch | Close, remove rules, 7-day lock |
| `AGENT_UNREACHABLE`, `TIMEOUT` | Injection or messaging failed; 15 min idle | Close |
| `NAVIGATION_TIMEOUT` | The first navigation did not commit on www within 30 s (AM20, AM28) | Close |
| `UNEXPECTED_PAGE` | An unknown www page (AM17); the status and record name its path (AM28) | Close before the composer is engaged; after it, `finished` with no pre-answer |
| `EXPORT_TOO_LARGE`, `DECODE_FAILED`, `FONT_NOT_LOADED` | Editor | Shown in the editor |

---

## 4. Editor features roadmap

**v1, photo (P milestones):**

- **Import:**
  - JPEG, PNG, WebP and AVIF natively;
  - **HEIC through libheif-js 1.23.5 in a packaged worker** (P4), because iPhone originals are HEIC and Chrome cannot decode them;
  - EXIF orientation;
  - drag-and-drop and a file picker.
- **Fit:**
  - cover with a focal point, or contain with a fill: solid (EyeDropper), two-colour gradient sampled from the image, or blurred copy;
  - free transform;
  - pan, zoom about the pointer, and rotate, with handles, a numeric panel, 1 px and 10 px nudges, and snapping to the centre, thirds and safe-zone edges.
- **Overlays:**
  - safe zones: top 270, bottom 384, sides 65 px, plus a strict ad-safe bottom of 672 (§3.2);
  - a neutral viewer-chrome preview drawn as plain shapes with no Instagram branding: progress bars, the avatar and name row, and the reply bar. It is calibrated from a phone screenshot in L8.
- **Placeholder layers** for music, mention, link, poll and location, never exported. The **lane picker** routes frames to the phone (§2.2).
- **Text:**
  - the 13 OFL lookalikes from §6.2, grouped as "Instagram-like fonts" and **labelled by their own family names** (Instrument Sans, Gabarito, Courier Prime, Racing Sans One, Antic Didone, Lexend, Cormorant, Marck Script, JetBrains Mono, Coiny, Quicksand, Gravitas One, Fjalla One), never by Instagram's style names;
  - styles: plain, highlight, inverse, outline, glow;
  - `Intl.Segmenter` wrapping, so grapheme clusters are never split, plus `letterSpacing` and line height;
  - rotate and scale handles;
  - emoji: system, or bundled Noto Color Emoji COLRv1 (the full font from the googlefonts releases, loaded lazily);
  - a "burned-in, not editable on Instagram" label.
- **Export:** JPEG 1080x1920 sRGB, 8 MB or less; PNG for msite; an export report (pixels, bytes, "location and EXIF removed").
- Drafts with autosave; undo and redo.

**v1.x, only after the first desktop post (L8):** templates, a brand kit, story sets, collages and an outbox folder (X).

- A story set is one hand-off per frame under the rate guard.
- The outbox folder uses the File System Access API. Re-granting permission after a restart probably needs a user gesture (unverified).

**v2, video (V):**

- Mediabunny 1.61.3's `Conversion` API in `video.worker.ts`:
  - `avc1.640028`, 30 fps constant;
  - `hardwareAcceleration:'no-preference'`;
  - tracks shifted to start at 0, so no `edts` box is written;
  - `fastStart:'in-memory'`.
- AAC-LC at 48 kHz and 128 kbps, with the native encoder on macOS (`canEncodeAudio`). Fallback: `@mediabunny/aac-encoder` repackaged as a worker file.
- Clips longer than 60 s are split into segments of 3–60 s.
- iPhone HEVC and HDR input is probed with `VideoDecoder.isConfigSupported`.
- An MP4 validator test.
- Delivered **through the phone lane only**.

**v3, music and account options (M):**

- a music plan with a cue line (song, start time, placement) as share text and a filename suffix;
- burned-in owned or royalty-free audio, mixed with `OfflineAudioContext` in the page, with a Rights Manager warning;
- an MBS export preset if the owner moves to Creator;
- a Graph adapter only if the owner moves to Business;
- never private `music_params`.

---

## 5. Build modes and safeguards

| Mode | Command | Output | Name, icon, key | Write-block ruleset | Fake marker | Loaded into |
|---|---|---|---|---|---|---|
| `development` | `pnpm run dev` (`wxt`, HMR) | `.output/chrome-mv3-dev` | "instapost DEV", red striped, `keys/dev` | Yes | Required | Sealed CfT 155, `.profiles/dev-fake` |
| `mock` | `pnpm run build:mock` | `.output/chrome-mv3-mock` | "instapost MOCK", orange striped, `keys/mock` | Yes | Required | Sealed Playwright profiles; manual sealed CfT |
| `live` | `pnpm run build:live` (`INSTAPOST_LIVE=1`) | `.output/chrome-mv3-live` | "instapost", plain, `keys/live` | **No**; rehearsal rules per hand-off | Ignored (shows a banner) | Branded Chrome profiles, by hand; **and** sealed Playwright profiles |

`wxt.config.ts` throws on:

- any other mode, including `production`, so a plain `wxt build` fails closed;
- `live` without `INSTAPOST_LIVE=1`;
- `live` under `wxt` dev.

The hand-off code is identical in every mode. Research's "posting code only in live" (§8.7.1) is replaced: there is no posting code at all, and the safeguards act at the network and target level.

| Id | Safeguard | Mechanism | Proven by |
|---|---|---|---|
| SG1 | Sealed browser | `--host-resolver-rules` allow-list (`MAP` the two fake hosts, `MAP * ~NOTFOUND`, `EXCLUDE localhost`, `EXCLUDE 127.0.0.1`), `--no-proxy-server`, `--disable-quic`, SPKI-accepted certificate, dedicated user-data directory. One flags builder serves both launchers | E1; Playwright `globalSetup` precheck; U17 |
| SG2 | Profiles | Dev and E2E profiles are never logged in. Live builds run only in branded-Chrome profiles: "IG secondary", then the everyday profile after gate G | Protocol (§6.4) |
| SG3 | Static `block_ig_writes` in guarded builds | Generated from `write-endpoints.ts` at build time by the `build:publicAssets` hook; omitted in live | E8, U8, T2 |
| SG4 | Fake-marker guard | Guarded builds hand off only if the agent sees `<meta name="instapost-fake-instagram">`. A DOM read, **never a network probe** | E10 |
| SG5 | Rehearsal | Tab-scoped rules 1002–1019 (`tabIds:[tab,-1]`) from the same endpoint list | **E9, run on the live artifact before any live rehearsal click** |
| SG6 | The human clicks Share | No clicks in the agent (T3); the fake records `isTrusted` and an untrusted Share fails the run | E11, T3 |
| SG7 | Forbidden patterns | Source and bundle scan (§7.11 T3) | T3 |
| SG8 | Manifest snapshots | Per mode: permissions, no `content_scripts`, no `web_accessible_resources`, ruleset presence, key, `minimum_chrome_version` | T1, T2 |
| SG9 | Human pace | Rate guard, kill switch, no retries, one hand-off at a time | U9, U10, E12, E14 |
| SG10 | Automation rule | **Never run CDP, Playwright or `wxt` dev in a profile that can reach real Meta hosts or is logged in to Instagram.** `assertSealed()` runs on every launch path, and `wxt` dev launches no browser at all without the certificate | U17, E1 |
| SG11 | Live gating | Env var; distinct extension ID, name and icon; the live build never makes requests of its own to Instagram (T3; E-invariant: the fake sees no `Origin: chrome-extension://` requests) | T1, T3, E-invariants |

**Manifest**, the same in every mode except where noted:

- `manifest_version: 3`.
- `minimum_chrome_version: "155"`, the only version tested (CfT 155 and newer).
- `permissions`: `storage`, `unlimitedStorage`, `scripting`, `downloads`, `declarativeNetRequestWithHostAccess`. Guarded builds add `declarativeNetRequest` and `declarativeNetRequestFeedback` (for `onRuleMatchedDebug`, unpacked only).
- `host_permissions`: `https://www.instagram.com/*`, `https://i.instagram.com/*`.
- `content_security_policy.extension_pages`: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`.
- `key`, `action`, `icons`.
- `declarative_net_request` in guarded builds only.
- **Absent:** `content_scripts`, `web_accessible_resources`, `side_panel`, `tabs`, `cookies`, `webRequest`, `debugger`, `<all_urls>`.
- WXT's dev manifest adds `tabs` and its own host permissions (§8.1). Snapshots therefore run on build output only.

---

## 6. Dev environment and test strategy

### 6.1 The contract the fake must mimic

| Contract item | Real Instagram (research) | Fake behaviour | Knob |
|---|---|---|---|
| Server-side UA classification | Only the `User-Agent` header counts (§5.1) | Classifies every request from the headers it receives (after dNR) and embeds `{"InstagramUserAgent":{…is_mobile…}}` in a `script[type="application/json"]`. The shape is neutral; Instagram's markup is not copied | `classifier=ua\|client-hints` |
| Desktop and msite shells | Desktop has no story entry (research §1 item 1) | Desktop: top nav, Create → Post/Reel. msite: bottom nav, Create (+) → Post/Story | — |
| Story route | `/create/story/` (§5.2) | `direct`: renders the composer route. `homeOnly`: 302 to `/`. Desktop UA: 302 to `/` | `route` |
| Story input | Hidden `input[type=file] accept="image/avif,image/jpeg,image/png"` (§2 fn 5) | Present on mount, or only after tapping Story. A separate post input accepts video too | `input=present\|afterTap`, `accept=default\|changed` |
| Event handling | React root delegation (§5.5) | React 19 `createRoot`; reads `change` (or `drop`); can ignore untrusted events | `listen=change\|drop`, `trusted=ignore\|require` |
| Portrait guard | `innerHeight < innerWidth` → "Rotate your device…" toast (§5.1) | Same check and toast (localised) | — |
| Photo only | Video → "Upload failed. Only images can be posted." | Same | — |
| Composer pixels | Cover crop to the canvas aspect, then `toBlob('image/jpeg', ~0.92)` (§2 fn 5, fn 7) | Same; the geometry model is selectable; ground truth goes in `documentElement.dataset.fakeGeometry` | `geometry=viewportDpr\|source\|fixed:WxH\|cssFixed:WxH`, `insets=top,bottom` |
| Save action | `SAVE_STORY` exists; UI exposure (unverified) | A "Save" button downloads the composed JPEG | `save=on\|off` |
| Share | Instagram uploads to rupload and `configure_to_story` (§5.3) | POST `/__fake__/stories` with the canvas JPEG plus metadata; records `isTrusted`; SPA-navigates to `/`. With `share=real-paths` it also fires no-cors POSTs to `i.instagram.com/rupload_igphoto/fb_uploader_<t>` and `/api/v1/media/configure_to_story/` | `share=fake\|real-paths` |
| Root service worker | Can serve responses dNR does not see (§5.4) | `desktopShell`: a real service worker that answers navigations with `fetch(event.request)` from its own context (tabId -1, so desktop UA, so desktop shell). `claimLate`: a new service worker claims clients 2 s after the composer is ready | `sw=none\|desktopShell\|claimLate` |
| Auth and challenges | Logged out → login; challenge and checkpoint flows | 302 to `/accounts/login/` or `/challenge/`. Placeholder pages contain **no form fields** | `auth=in\|out\|challenge` |
| Off-host redirect | accountscenter and similar | After ready, navigates to `https://accountscenter.instagram.com/` (unmapped, so NOTFOUND, so URL invisible) | `offhost=none\|afterReady` |
| Locale | The owner may use Spanish | All visible strings in `en` or `es` | `locale=en\|es` |
| Markup drift | Class names churn | Randomised class names and ids | `drift=none\|renamed` |
| Marker | — | `<meta name="instapost-fake-instagram" content="1">` | `marker=on\|off` |
| Readiness delay | — | Composer readiness delayed by N ms | `slowMs` |

### 6.2 Serving and recording

- **Server.** `node tools/fake-ig/server.ts` runs `node:https` on 127.0.0.1:8443 with one self-signed leaf certificate whose SANs are `www.instagram.com` and `i.instagram.com`. It routes on the `Host` header. All logic lives in `core.handle(req) → res`, and the transport is a thin adapter.
- **Client.** The fake client is React 19, bundled in memory by esbuild at server start. Node's type stripping runs `.ts` files but not TSX.
- **Recording.** Every non-`/__fake__` request is logged: host, method, path, the `user-agent`, `sec-ch-ua*`, `sec-fetch-*` and `origin` headers, and the classification.
  - **Stories** are kept in memory and written to `.fake-ig/stories/`.
  - **Writes** to real-shaped paths are logged as `WRITE_PATH_REACHED`.
  - **Violations:** untrusted Share clicks.
- **Dashboard.** `https://www.instagram.com/__fake__/` shows:
  - stories in a 9:16 phone frame, with w×h, bytes, `isTrusted`, the UA and client hints seen, and the time;
  - writes, violations and the last 200 requests;
  - a knob form and a reset button.

### 6.3 Test layers

| Layer | Tool | Scope | Speed |
|---|---|---|---|
| Unit (U) | Vitest 4 node project with `WxtVitest()` and `fakeBrowser`; `src/platform/*` mocked | Pure core, reducer, rules, protocol, fake core, flags | < 5 s |
| Browser components (B) | Vitest 4 browser mode, Playwright provider, Chromium | Raster, export, fonts, decode, agent against the fake's React components (no extension) | < 30 s |
| Static (T) | `node scripts/check-bundle.ts` on `.output/*` | Manifests, rulesets, forbidden patterns, output paths | < 5 s |
| E2E (E) | Playwright 1.64, `launchPersistentContext`, sealed args, fake as `webServer`, `workers:1` | Projects `mock`, `live` (bundled Chromium, all specs) and `cft155-mock`, `cft155-live` (CfT 155, `@smoke`) | minutes |
| Manual dev | `pnpm run dev`: sealed CfT 155 plus the fake dashboard | Day-to-day work | — |
| Live (L) | The owner, by hand, branded Chrome, secondary account | §8 L ladder | — |

**Pixel determinism:**

- every font is bundled and awaited;
- no system emoji in pixel tests;
- assertions use semantic probes (marker positions, PSNR), which hold on any OS;
- golden images (P9) are darwin-only.

### 6.4 Live smoke protocol (secondary account)

- **Human only.** Branded Chrome, profile "IG secondary", `.output/chrome-mv3-live` loaded with "Load unpacked". No Playwright, no `wxt` dev, no DevTools device mode (CDP emulation would add a third fingerprint). The DevTools Network panel is allowed.
- **Prerequisite for any step that loads the extension:** `pnpm run verify` is green on the same build, including **E9 on the live artifact**.
- **Pace.** One composer window at a time, at least 60 s apart, and each L step at most once per day unless stated. Rehearsal stays ON for L4–L7.
- **Records.** Results go into the Handoff log and `baseline.json` (structural facts only). Raw captures, HAR files and screenshots containing account data stay out of the repo (`.gitignore`).
- **Stop condition.** Any challenge, checkpoint, "suspected automated behaviour" notice or unexpected security email: stop, the kill switch locks the lane, wait at least 7 days, reassess with the owner.

---

## 7. Scaffold spec

### 7.1 File tree

```
instapost/
  package.json  pnpm-lock.yaml  .nvmrc (22.18.0)  .npmrc (engine-strict=true)  .gitignore  biome.json
  tsconfig.json                      extends ./.wxt/tsconfig.json
  wxt.config.ts  vitest.config.ts  playwright.config.ts
  keys/{dev,mock,live}.pub.b64       public keys only (committed); give each mode a stable extension ID
  public/
    icons/{dev,mock,live}/{16,32,48,128}.png     generated by scripts/gen-icons.ts
    fonts/InstrumentSans-Variable.woff2, fonts/OFL.txt   (the other 12 families arrive in P6)
  entrypoints/
    background.ts
    editor/index.html  editor/main.tsx  editor/App.tsx
    composer-agent.ts
  src/  (as in §3.2)
  tools/
    chrome/flags.ts  chrome/versions.ts  chrome/install-cft.ts  chrome/ext-id.ts
    fake-ig/server.ts  core.ts  ua.ts  knobs.ts  store.ts  html.ts  cert.ts  route-adapter.ts (only if S3 fails)
    fake-ig/sw/desktop-shell.js  fake-ig/sw/claim-late.js
    fake-ig/client/main.tsx  MsiteShell.tsx  DesktopShell.tsx  StoryComposer.tsx  geometry.ts  i18n.ts  tsconfig.json
    contract/check-ua.ts
  scripts/dev.ts  scripts/gen-keys.ts  scripts/gen-icons.ts  scripts/check-bundle.ts
  tests/
    setup/unit.ts
    e2e/global-setup.ts  e2e/fixtures.ts  e2e/helpers/{fake-client,psnr,human}.ts
    e2e/00-seal.spec.ts  editor.spec.ts  handoff.spec.ts  canary.spec.ts  tripwire.spec.ts
    e2e/failure-matrix.spec.ts  geometry.spec.ts
  docs/research.md  strategy.md  contract.md  live-checklist.md
```

`.gitignore`: `node_modules .output .wxt .profiles .fake-ig .cache test-results playwright-report *.har captures/ .env*.local`.

### 7.2 package.json

The versions marked "research" come from research.md. The others were the newest releases **at least 14 days old** on the npm registry on 2026-10-11, aligned with WXT 0.21.4's own toolchain (TypeScript ^6.0.3, Vitest ^4.1.10, Vite ^8.2). Pin them exactly.

```json
{
  "name": "instapost",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22.18 <23" },
  "scripts": {
    "postinstall": "wxt prepare",
    "bootstrap": "node scripts/gen-keys.ts && node scripts/gen-icons.ts && node tools/fake-ig/cert.ts && node tools/chrome/install-cft.ts",
    "fake:cert": "node tools/fake-ig/cert.ts",
    "fake": "node tools/fake-ig/server.ts",
    "dev": "node scripts/dev.ts",
    "build:mock": "wxt build --mode mock",
    "build:live": "INSTAPOST_LIVE=1 wxt build --mode live",
    "build:all": "pnpm run build:mock && pnpm run build:live",
    "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p src/core/tsconfig.json && tsc --noEmit -p tools/fake-ig/client/tsconfig.json",
    "lint": "biome check .",
    "test": "vitest run --project unit",
    "test:browser": "vitest run --project browser",
    "test:e2e": "pnpm run build:all && playwright test --project=mock --project=live",
    "test:smoke155": "pnpm run build:all && playwright test --project=cft155-mock --project=cft155-live",
    "check:bundle": "node scripts/check-bundle.ts",
    "contract:check": "node tools/contract/check-ua.ts",
    "verify": "pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run test:browser && pnpm run build:all && pnpm run check:bundle && playwright test"
  },
  "dependencies": {
    "preact": "10.29.8",
    "@preact/signals": "2.11.3",
    "idb": "8.0.3"
  },
  "devDependencies": {
    "wxt": "0.21.4",
    "web-ext": "10.7.0",
    "vite": "8.3.1",
    "typescript": "6.0.3",
    "vitest": "4.1.11",
    "@vitest/browser-playwright": "4.1.11",
    "@playwright/test": "1.64.0",
    "playwright": "1.64.0",
    "@puppeteer/browsers": "3.2.3",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.7",
    "esbuild": "0.28.2",
    "@biomejs/biome": "2.5.14",
    "@types/node": "22.20.4"
  }
}
```

- **Versions:**
  - wxt 0.21.4 and later, web-ext 10.7.0 and Playwright 1.64.0 come from research.
  - These packages arrive later, at the research versions: pica 10.0.3 (P5), libheif-js 1.23.5 (P4), mediabunny and `@mediabunny/aac-encoder` 1.61.3 (V1), msw 3.0.3 (Vitest only, M4).
  - Preact 11 (released 2026-10-08) and TypeScript 7 are deliberately not used yet.
- **Invocation.** Always call scripts as `pnpm run <name>`. No script is named `setup` or `ci`, because those collide with pnpm built-ins.
- **Tools run under Node.** `node x.ts` relies on Node 22.18's default type stripping. Tools may not use enums, namespaces or parameter properties (`erasableSyntaxOnly`), and they import relatively with `.ts` extensions. S9 checks this.

**`tsconfig.json`** extends `./.wxt/tsconfig.json`, with:

- `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`;
- `"jsx": "react-jsx"` and `"jsxImportSource": "preact"`. Vite honours the tsconfig `jsx*` options, and S1 confirms the editor renders;
- `exclude: ["tools/fake-ig/client"]`.

**`src/core/tsconfig.json`** sets `lib: ["ES2023"]`, `types: []`, `include: ["./**/*.ts"]`.

**`tools/fake-ig/client/tsconfig.json`** sets `"jsxImportSource": "react"` and `lib` DOM. Every client file also starts with `/** @jsxImportSource react */`, so Vite (B6) and esbuild agree.

**`biome.json`** uses the recommended rules, plus `noRestrictedImports` for `src/core/**` (forbidding `wxt*`, `preact*` and `../platform*`) as a fast editor-side hint. The real fence is the core tsconfig.

### 7.3 wxt.config.ts (essentials)

```ts
import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';
import { blockRuleset } from './src/core/ig-contract/rules.ts';
import { readSpki, sealedWebExtArgs } from './tools/chrome/flags.ts';
import { cftExecutable } from './tools/chrome/versions.ts';

const MODES = {
  development: { name: 'instapost DEV',  icon: 'dev',  key: 'dev',  guarded: true },
  mock:        { name: 'instapost MOCK', icon: 'mock', key: 'mock', guarded: true },
  live:        { name: 'instapost',      icon: 'live', key: 'live', guarded: false },
} as const;
type Mode = keyof typeof MODES;
const modeOf = (m: string): Mode => {
  if (!(m in MODES)) throw new Error(`instapost: unknown mode "${m}" (development | mock | live)`);
  return m as Mode;
};
const spki = readSpki(); // null when .fake-ig/spki.txt is missing or the cert has expired

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ mode, command }) => {
    const m = modeOf(mode);
    if (m === 'live' && command === 'serve') throw new Error('live never runs under wxt dev');
    if (m === 'live' && process.env.INSTAPOST_LIVE !== '1') throw new Error('build live with INSTAPOST_LIVE=1');
    const { name, icon, key, guarded } = MODES[m];
    const icons = Object.fromEntries([16, 32, 48, 128].map((s) => [s, `icons/${icon}/${s}.png`]));
    return {
      name,
      description: 'Prepare Instagram stories on desktop.',
      key: readFileSync(`keys/${key}.pub.b64`, 'utf8').trim(),
      minimum_chrome_version: '155',
      permissions: ['storage', 'unlimitedStorage', 'scripting', 'downloads', 'declarativeNetRequestWithHostAccess',
        ...(guarded ? ['declarativeNetRequest', 'declarativeNetRequestFeedback'] : [])],
      host_permissions: ['https://www.instagram.com/*', 'https://i.instagram.com/*'],
      content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
      action: { default_title: name, default_icon: icons },
      icons,
      ...(guarded ? { declarative_net_request: { rule_resources: [
        { id: 'block_ig_writes', enabled: true, path: 'rules/block_ig_writes.json' }] } } : {}),
    };
  },
  hooks: {
    'build:publicAssets': (wxt, files) => {
      if (MODES[modeOf(wxt.config.mode)].guarded)
        files.push({ relativeDest: 'rules/block_ig_writes.json', contents: JSON.stringify(blockRuleset(), null, 2) });
    },
  },
  // Fail closed: without the fake's certificate, `wxt` dev opens no browser at all.
  webExt: spki
    ? { binaries: { chrome: cftExecutable() }, chromiumArgs: sealedWebExtArgs(spki),
        startUrls: ['https://www.instagram.com/__fake__/'] }
    : { disabled: true },
});
```

No `web-ext.config.ts` is used, so nothing can override the sealed arguments.

### 7.4 Chrome flags and browsers

`tools/chrome/flags.ts`. Every value is an argv element and **contains no shell quotes**.

```ts
export const FAKE_PORT = 8443;
export const RESOLVER_RULES = [
  `MAP www.instagram.com 127.0.0.1:${FAKE_PORT}`,
  `MAP i.instagram.com 127.0.0.1:${FAKE_PORT}`,
  'MAP * ~NOTFOUND',
  'EXCLUDE localhost',
  'EXCLUDE 127.0.0.1',
].join(',');
export const LNA_ARGS: string[] = []; // filled only if S3 shows a Local Network Access prompt (feature name confirmed in S3)
export const sealedArgs = (spki: string) => [
  `--host-resolver-rules=${RESOLVER_RULES}`,
  `--ignore-certificate-errors-spki-list=${spki}`,
  '--no-proxy-server', '--disable-quic', '--no-first-run', '--no-default-browser-check', ...LNA_ARGS,
];
export const sealedWebExtArgs = (spki: string) =>
  [...sealedArgs(spki), `--user-data-dir=${resolve('.profiles/dev-fake')}`];      // web-ext path (WXT docs pattern, §8.2)
export const sealedPlaywrightArgs = (spki: string, extDir: string) =>
  [...sealedArgs(spki), `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`];
// Never put --user-data-dir in Playwright args: launchPersistentContext takes it as a parameter and rejects the flag.
export function assertSealed(args: string[]): void { /* exactly one --host-resolver-rules equal to RESOLVER_RULES, --no-proxy-server present,
  no --proxy-server or --proxy-pac-url, the SPKI flag present; otherwise throw */ }
export function readSpki(): string | null { /* .fake-ig/spki.txt, or null when the cert is missing or expires within 3 days */ }
```

- **`tools/chrome/versions.ts`:**
  - `CFT_BUILD = '155.0.8059.39'` (research §8.2; the owner's branded build is 155.0.8059.40);
  - `CFT_CACHE = '.cache/cft'`;
  - `cftExecutable()` uses `computeExecutablePath({browser: Browser.CHROME, buildId: CFT_BUILD, cacheDir})` from `@puppeteer/browsers`.

  `install-cft.ts` calls `install()` with the same arguments.
- **Playwright's bundled Chromium** is the browser for the main E2E projects. S10 records its version from `chromium.version()` in `docs/contract.md`.
- **Exclusion rules come after the MAP rules.** Exclusions are evaluated before mappings, and the first matching MAP wins, so `MAP *` must come last among the MAPs. Whether that ordering holds in CfT 155 is (unverified, research Q29); S3 and E1 check it.

### 7.5 Certificates and keys (no system trust stores touched)

**`tools/fake-ig/cert.ts`** never touches the Keychain, NSS, `/etc/hosts` or mkcert (§8.6).

1. It writes `.fake-ig/openssl.cnf`:

   ```ini
   [req]
   distinguished_name=dn
   x509_extensions=ext
   prompt=no

   [dn]
   CN=instapost fake instagram

   [ext]
   subjectAltName=DNS:www.instagram.com,DNS:i.instagram.com
   basicConstraints=critical,CA:FALSE
   keyUsage=critical,digitalSignature,keyEncipherment
   extendedKeyUsage=serverAuth
   ```

   A config file is used because it works with both OpenSSL 3 and macOS LibreSSL.
2. It runs `openssl req -x509 -new -newkey rsa:2048 -nodes -sha256 -days 30 -config .fake-ig/openssl.cnf -keyout .fake-ig/key.pem -out .fake-ig/cert.pem`.
3. It writes `.fake-ig/spki.txt`, computed as `createHash('sha256').update(new X509Certificate(pem).publicKey.export({type:'spki', format:'der'})).digest('base64')`.

The server refuses to start, and `readSpki()` returns null, when the certificate expires within 3 days. Running `pnpm run fake:cert` renews it.

**`scripts/gen-keys.ts`** runs per mode, and only if the key file is missing:

1. `generateKeyPairSync('rsa', {modulusLength: 2048})`;
2. writes the base64 SPKI DER of the public key to `keys/<mode>.pub.b64`;
3. discards the private key, since unpacked builds do not need it.

**`tools/chrome/ext-id.ts`** computes the extension ID: `sha256(der)`, the first 16 bytes as hex, with each digit mapped from 0–f to a–p. E2 compares it with the loaded ID.

**`scripts/gen-icons.ts`** writes solid-colour PNGs with `node:zlib` and no other dependencies. Guarded builds get diagonal stripes: dev red `#c62828`, mock orange `#ef6c00`, live violet `#6a1b9a`.

### 7.6 Fake Instagram server

**Routes** (`core.ts`; `www` means `Host: www.instagram.com`, `i` means `Host: i.instagram.com`):

| Host | Method and path | Behaviour |
|---|---|---|
| www | `GET /` | msite or desktop shell, by classification (§6.1) |
| www | `GET /create/story/` | msite with `route=direct`: composer route. Otherwise 302 to `/` |
| www | `GET /accounts/login/`, `GET /challenge/` | Placeholder text pages, **no inputs** |
| www | `GET /fake-static/client.js` | esbuild bundle of `client/main.tsx` (`jsx:'automatic'`, `format:'esm'`) |
| www | `GET /fake-sw/desktop-shell.js`, `/fake-sw/claim-late.js` | Service-worker scripts, registered by the client when the `sw` knob asks |
| www | `POST /__fake__/stories` | Body `image/jpeg`, header `x-fake-meta` (JSON: `isTrusted`, canvas w/h, css w/h, dpr, source w/h, lang, knobs). Records and returns `{id}` |
| www | `GET /__fake__/` | Dashboard (server-rendered HTML with a small polling script) |
| www | `GET /__fake__/stories/:id.jpg` | Stored image |
| www | `GET /__fake__/api/{stories,requests,writes,violations}` | JSON |
| www | `GET` and `POST /__fake__/api/knobs` | Read or merge knobs (server-global; E2E runs with `workers:1`) |
| www | `POST /__fake__/api/reset` | Clears stories, requests, writes, violations and knobs (back to baseline defaults) |
| www | `GET /__fake__/reset` | Page that unregisters every service worker and responds with `Clear-Site-Data: "cache", "storage"`; it is used to clean the persistent dev profile |
| any | `GET /__fake__/health` | `{ok:true, fake:true, certValidTo}` |
| www | Any method on a §8.7 write path (`/api/v1/media/configure_to_story/`, `/api/v1/media/configure/`, …) | Logs `WRITE_PATH_REACHED`, returns 200 `{status:"fake-ok"}` |
| i | Any method on `/rupload_igphoto/*` or `/rupload_igvideo/*` | Logs `WRITE_PATH_REACHED`, returns 200 |
| any | Anything else | 404 |

**Pages and DOM.**

- Shell HTML is `<!doctype html><html lang="{en|es}">`. Its head holds:
  - a viewport meta;
  - the **marker** `<meta name="instapost-fake-instagram" content="1">`, unless `marker=off`;
  - the classification JSON `<script type="application/json" data-fake-ua>{"InstagramUserAgent":{"is_mobile":…,"is_ios":…,"is_android":…,"is_ipad":false,"is_android_tablet":false,"user_agent":"…"}}</script>`.

  Its body is `<div id="root">` plus the module script.
- Test hooks are `data-testid` attributes used **only by Playwright as the "human"**. T3 bans them in `src/` and in the bundles, so the agent cannot cheat.

| `data-testid` | Element |
|---|---|
| `fake-create` | Create (+) button (`aria-label` localised) |
| `fake-create-menu`, `fake-create-post`, `fake-create-story` | `role="menu"` and its `role="menuitem"` entries |
| `fake-story-input` | `<input type="file" accept="image/avif,image/jpeg,image/png" hidden>` (the `accept` changes with the knob) |
| `fake-post-input` | `<input type="file" accept="image/jpeg,image/png,video/mp4,video/quicktime" hidden>` |
| `fake-composer`, `fake-composer-canvas` | Composer section and canvas (backing and CSS size per the geometry knob) |
| `fake-share`, `fake-save`, `fake-close` | Composer buttons (text localised) |
| `fake-toast`, `fake-rotate-toast` | `role="status"` toasts |

**What the agent relies on** is structural only:

- the `input[type=file]` accept set;
- the largest visible `<canvas>`;
- `meta[name=instapost-fake-instagram]`;
- `script[type="application/json"]` containing `InstagramUserAgent`.

**Composer geometry.** For `viewportDpr`, the CSS box is the largest 9:16 box inside `innerWidth × (innerHeight − insets)`, and the backing size is `round(css × devicePixelRatio)`. The source is cover-cropped to the canvas aspect and drawn centred.

**UA classifier** (`ua.ts`):

- `is_mobile = /\b(iPhone|iPod|iPad|Android)\b/.test(ua)`;
- `is_android = /Android/`, `is_ios = /iPhone|iPod|iPad/`;
- with `classifier=client-hints`: `is_mobile = headers['sec-ch-ua-mobile'] === '?1'`.

**Knob defaults** come from `src/core/ig-contract/baseline.json`. Before L4 the baseline is: `route=direct, input=present, accept=default, listen=change, trusted=ignore, geometry=viewportDpr, insets=0,0, save=on, sw=none`.

**Fallback transport.** `route-adapter.ts` is written only if S3 fails. It maps Playwright `route.fulfill` onto `core.handle()`. In that mode the guarded builds drop the static ruleset for E2E, as in §8.5.

### 7.7 Baseline file (structural facts only)

```json
{ "capturedAt": "2026-…", "chromeVersion": "155.0.8059.40", "uaProfile": "android-reduced", "chMode": "full",
  "isMobileKeyFound": true, "route": "direct", "storyInputBeforeTap": true,
  "accept": ["image/avif", "image/jpeg", "image/png"], "swControlledAfterHardReload": false,
  "firstLoadServedBySw": "unknown",
  "geometry": { "model": "viewportDpr", "insets": [0, 0], "saveExposed": "unknown" } }
```

Never store HTML, cookies, tokens, user IDs or usernames. Never store HAR files (§8.5).

### 7.8 Vitest config

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    projects: [
      { plugins: [WxtVitest()],
        test: { name: 'unit', environment: 'node', setupFiles: ['tests/setup/unit.ts'],
                include: ['src/**/*.test.ts', 'tools/**/*.test.ts'], exclude: ['**/*.browser.test.ts'] } },
      { test: { name: 'browser', include: ['src/**/*.browser.test.ts'],
                browser: { enabled: true, provider: playwright(), headless: true, instances: [{ browser: 'chromium' }] } } },
    ],
  },
});
```

- `tests/setup/unit.ts`: `beforeEach(() => fakeBrowser.reset())`, with `fakeBrowser` from `wxt/testing/fake-browser`. Both export paths were confirmed in WXT 0.21.4's package exports.
- The browser project uses no WXT plugin and imports only `src/raster`, `src/agent` and the fake client components.

### 7.9 Playwright config and fixtures

```ts
import { defineConfig } from '@playwright/test';
import { cftExecutable } from './tools/chrome/versions.ts';

export default defineConfig({
  testDir: 'tests/e2e', workers: 1, fullyParallel: false, retries: 0, timeout: 60_000,
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: { command: 'node tools/fake-ig/server.ts', url: 'https://127.0.0.1:8443/__fake__/health',
               ignoreHTTPSErrors: true, reuseExistingServer: true },
  projects: [
    { name: 'mock', use: { artifact: '.output/chrome-mv3-mock' } },
    { name: 'live', use: { artifact: '.output/chrome-mv3-live' } },
    { name: 'cft155-mock', grep: /@smoke/, use: { artifact: '.output/chrome-mv3-mock', executablePath: cftExecutable() } },
    { name: 'cft155-live', grep: /@smoke/, use: { artifact: '.output/chrome-mv3-live', executablePath: cftExecutable() } },
  ],
});
```

**`global-setup.ts`** aborts the whole run unless all of these hold:

1. The certificate is valid.
2. Both artifacts exist, and their manifest names match their modes.
3. **The seal precheck passes.** A sealed browser with no extension is launched; `https://www.facebook.com/` must fail with `net::ERR_NAME_NOT_RESOLVED`, and `https://www.instagram.com/__fake__/health` must return `fake:true` with no interstitial.

**`fixtures.ts`** (test-scoped):

- **Launch:** `chromium.launchPersistentContext(mkdtemp(), {channel: executablePath ? undefined : 'chromium', executablePath, headless: false, viewport: null, args: sealedPlaywrightArgs(spki, abs(artifact))})`, with `assertSealed(args)` run first. Headed is the default until S8 decides otherwise, and `viewport: null` keeps real window sizes.
- **Identity:** the extension service worker comes from `serviceWorkers()[0]`, or from `waitForEvent('serviceworker')` if none exists yet. The fixture asserts that the extension ID equals `extIdFromKey(keys/<mode>.pub.b64)`.
- **Exposes:**
  - `editor()`, which opens `chrome-extension://<id>/editor.html`;
  - `composer()`, which waits for the next page whose URL starts with `https://www.instagram.com/`;
  - `fake` (`knobs`, `reset`, `stories`, `requests`, `writes`, `violations`), over Node https with `ca: cert.pem` and `servername: 'www.instagram.com'`;
  - `human` (`tapCreateStory`, `pickFile` via `setInputFiles`, `share` via a real click, `save`);
  - `exportBytes(id)` (reads IndexedDB through `sw.evaluate`, returns base64).
- **Auto `afterEach` invariants:**
  1. A passive `context.on('request')` tripwire saw no host outside {www.instagram.com, i.instagram.com, localhost, 127.0.0.1, chrome-extension://…}.
  2. `fake.violations()` is empty.
  3. No fake request carried `Origin: chrome-extension://…`.
  4. In the `mock` projects, `fake.writes()` is empty.
- **Fresh state:** `fake.reset()` runs before each test.
- **PSNR** (`helpers/psnr.ts`): both images are decoded with `createImageBitmap` on an `about:blank` page, never fetched from the extension.

### 7.10 Walking skeleton: what to implement now

**Editor** (`entrypoints/editor`):

- **Load:** a file input and drag-and-drop for JPEG, PNG, WebP and AVIF. Assets go to IndexedDB, keyed by SHA-256, with a proxy bitmap.
- **Fit:** cover by default (`compose` plus cover maths).
- **Interaction:**
  - pan by drag;
  - zoom with the wheel or a trackpad pinch, about the pointer, clamped in cover mode;
  - a rotate slider (±180°, snaps to 0 and ±90 within 3°).
- **One text layer:**
  - a textarea, Instrument Sans, size, colour, centre alignment, style `plain` or `highlight`;
  - drag to position;
  - `Intl.Segmenter` wrapping.
- **Overlays:** a safe-zone overlay toggle, on by default.
- **Buttons:**
  - **Download JPEG**: q0.92 stepping, to `instapost/<yyyy-mm-dd_HHMMss>_story.jpg`;
  - **Share…**: `navigator.share({files})` when `navigator.canShare` allows it;
  - **Post from desktop**: export PNG, download it, then `handoff/start`;
  - **Probe composer** (settings): `mode:'probe'`, no file.
- **Hand-off panel:**
  - the phase timeline and the error with its fallback;
  - the account label ("posts as …", typed by the owner);
  - the rehearsal toggle (default ON; switched off by the owner from L8 on);
  - the assisted-insert toggle (default ON in guarded builds, OFF in live until OD3);
  - lock status with an `ENABLE` field.
- **Test ids:** `editor-file-input`, `editor-stage`, `editor-zoom`, `editor-rotate`, `editor-text`, `editor-text-style`, `editor-safe-zones`, `editor-download`, `editor-share`, `editor-post-desktop`, `handoff-phase`, `handoff-error`, `handoff-banner`, `setting-rehearsal`, `setting-assisted`, `setting-account-label`, `setting-enable`, `setting-probe`.

**Publishers** (`src/publish`):

- `download.ts`: `downloads.download({url: objectURL, filename: 'instapost/…', saveAs: false, conflictAction: 'uniquify'})`, then revokes the object URL once the download completes;
- `share.ts`;
- `msite.ts`: the hand-off port client.

**Background:**

- reducer, runner and session store;
- rule 1001 (§3.7) and rules 1002–1019;
- `windowFit` (`src/core/geometry/window-fit.ts`):
  - target inner height is `min(profile?.innerH ?? 932, availHeight − frameDeltaH − 8)`;
  - width is `round(h × 9/16)`, unless the measured `composerProfile` gives another ratio;
  - below 640 px of height: `SCREEN_TOO_SMALL`;
  - the window is centred on `availLeft/availTop`;
- the kill switch, the rate guard, cleanup, and the action → editor behaviour.

**Composer agent:**

- an idempotent sentinel, `globalThis.__instapostAgentV1`;
- probe (C1, C3, C4, C6, C8, service-worker state, marker, `lang`);
- inject (§3.8);
- watch (input appears, C6 ready, C9 left, `controllerchange`; all timeouts live in the agent);
- reports through `runtime.sendMessage`.

**Fake:** everything in §7.6, including the dashboard.

**Docs:**

- `docs/contract.md`: C1–C9, each "last verified: fake";
- `docs/live-checklist.md`: a copy of the §8 L and G lists, with the same ids.

### 7.11 Tests to write now

**Unit (Vitest, node):**

| Id | File | Asserts |
|---|---|---|
| U1 | `src/core/geometry/fit.test.ts` | Cover, contain and free base scale and placement for 4000x3000, 3024x4032, 1080x1920, 1000x1000 and 6000x1000 sources. A seeded property test: after 200 random pans and zooms, cover never exposes the background. Focal (0.25, 0.5) lands at the frame centre unless clamped |
| U2 | `geometry/transform.test.ts` | Zooming about a pointer keeps that point fixed (±0.5 px); rotation about the centre; the matrix compose/invert round trip |
| U3 | `geometry/safe-zones.test.ts` | Default rects 270/384/65; strict 672; containment helper |
| U4 | `text/layout.test.ts` | Fixed-advance fake measurer: wraps at `maxWidthPx`, honours `\n`, never splits 👨‍👩‍👧‍👦, 🇦🇷 or e + U+0301; one highlight box per line; empty text gives no lines |
| U5 | `render/compose.test.ts` | Display-list snapshot for a fixture doc (image, text, music placeholder). Placeholder and guides appear only in `preview`. `VideoLayer` throws `NOT_IMPLEMENTED` |
| U6 | `export/policy.test.ts` | Quality stepping with an injected encoder stops at the first result of 8 MB or less; `EXPORT_TOO_LARGE` below 0.72; PNG for `msite`, JPEG otherwise |
| U7 | `ig-contract/device-profile.test.ts` | Snapshot of rule 1001 for `(tabId 42, major 155)`. `resourceTypes` contains `main_frame`. Exact UA. Set and remove ops as in §3.7. No op on `sec-ch-ua`. The `uaOnly` variant has only the UA op |
| U8 | `ig-contract/rules.test.ts` | Static ruleset and rehearsal rules both derive from `WRITE_URL_FILTERS` (equal sets). Static: ids 1..n, priority 100, no `tabIds`, no `resourceTypes`. Rehearsal: ids 1002.., `tabIds [tab, -1]`. Snapshot |
| U9 | `handoff/reducer.test.ts` | Full transition table: guard fail; `DESKTOP_SHELL`; `NOT_LOGGED_IN` (no lock); landscape refits once; input missing → H0; inject → ready; inject → ignored → H0 with **no second Inject**; challenge → kill and lock; off-host or undefined URL after arming → kill; `SW_TOOK_CONTROL`; window closed → cleanup; composer left → finished; probe mode. No transition ever emits a retry |
| U10 | `handoff/rate-guard.test.ts` | 60 s spacing, 6 per rolling hour and 15 per day, at the boundaries (fake timers); settings cannot loosen them |
| U11 | `src/handoff/runner.test.ts` | Effect order for the happy path. Re-instantiating the runner from `storage.session` mid-flow resumes it (simulated service-worker restart). `onStartup`, `onInstalled` and `windows.onRemoved` remove ids 1001–1019 |
| U12 | `shared/protocol.test.ts` | Rejects agent messages with the wrong tab, frame, origin, nonce or phase; base64 round trip of 12 MB |
| U13 | `geometry/window-fit.test.ts` | availHeight 945 and frame delta 62 give a 9:16 inner size of at most 875 tall; always portrait; `SCREEN_TOO_SMALL`; the profile overrides the default |
| U14 | `ig-contract/urls.test.ts` | Classifies stop, kill, composer-left and ok for: login, `/challenge/`, `/checkpoint/`, accountscenter, `undefined`, `/create/story/`, `/` |
| U15 | `ig-contract/ua-json.test.ts` | `parseIsMobile`: true, false, `unknown` when missing; tolerant of whitespace and nesting; ignores non-JSON scripts |
| U16 | `tools/fake-ig/core.test.ts` | UA table (Android reduced is mobile, Mac Chrome is desktop, iPhone is mobile); routes; knobs; write recording; marker; reset; desktop and `homeOnly` redirects; auth and challenge redirects; **default knobs equal `deriveKnobs(baseline.json)`** |
| U17 | `tools/chrome/flags.test.ts` | No argument contains a quote. Playwright args have no `--user-data-dir`. `assertSealed` rejects a missing `--no-proxy-server`, a different rule string or an added `--proxy-server` |

**Browser (Vitest browser mode):**

| Id | File | Asserts |
|---|---|---|
| B1 | `src/raster/rasterize.browser.test.ts` | Calibration source (generated in-test) under cover: the corner fiducials land on exact pixels. Contain leaves background bars. Rotating 90° moves markers as expected |
| B2 | `raster/export.browser.test.ts` | JPEG is 1080x1920 `image/jpeg`; a noise image steps down to 8 MB or less; there is no APP1 `Exif` segment. PNG is 1080x1920 |
| B3 | `raster/fonts.browser.test.ts` | Instrument Sans loads from the bundled woff2. An unloaded font id throws `FONT_NOT_LOADED` |
| B4 | `raster/text.browser.test.ts` | The canvas measurer's line count equals the layout's; highlight-box pixels sit behind the glyphs |
| B5 | `raster/decode.browser.test.ts` | JPEG, PNG and WebP blobs (generated) decode; the proxy is at most 2160 px |
| B6 | `src/agent/agent.browser.test.ts` | Mounts the fake `StoryComposer` (React 19). The probe finds the story input by accept set and ignores the post input. Inject fires React `onChange` and the canvas mounts. `trusted=require` gives `inject-ignored`. `locale=es` and `drift=renamed` give identical results. The C8 read matches `dataset.fakeGeometry` |

**Static** (`scripts/check-bundle.ts`, run after the builds):

| Id | Asserts |
|---|---|
| T1 | Manifest snapshot per mode, as §5 lists |
| T2 | `rules/block_ig_writes.json` and the `declarative_net_request` key are present in mock and absent in live; the JSON equals `blockRuleset()` |
| T3 | Forbidden patterns. **Every bundle:** `signed_body`, `ig_sig_key_version`, `x-ig-`, `x-csrftoken` (case-insensitive), `chrome.debugger`, `world:"MAIN"` or `world:'MAIN'`, `fakeGeometry`, `data-testid="fake-`. **`composer-agent.js`:** `.click(`, `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `DragEvent`, `TouchEvent`, `setFileInputFiles`, `fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `storage.`. **`rupload_ig` and `configure_to`** may appear only in `background.js` and `rules/*.json`. **`src/`:** no `fake-` test ids outside `tools/` and `tests/` |
| T4 | `tsc -p src/core` passes; `src/core` contains no `chrome.`, `browser.` or `document.` |
| T5 | `.output/chrome-mv3-mock` and `.output/chrome-mv3-live` exist (WXT's default `{{modeSuffix}}`); the three key-derived IDs are distinct |

**E2E** (Playwright; `mock` and `live` projects unless noted; `@smoke` also runs on CfT 155):

| Id | Spec | Asserts |
|---|---|---|
| E1 `@smoke` | `00-seal` | `www.facebook.com`, `static.cdninstagram.com`, `graph.instagram.com` and `example.com` fail with `ERR_NAME_NOT_RESOLVED`. The fake health page loads with no interstitial and no permission prompt |
| E2 `@smoke` | `00-seal` | The extension service worker is up, its ID equals the key-derived ID, and its manifest name matches the project |
| E3 | `editor` | Load a generated 4000x3000 JPEG, pan, zoom, add text, toggle safe zones. The export decodes to 1080x1920 and a download item is `complete` with bytes > 0 (`sw.evaluate(downloads.search)`) |
| E4 | `handoff` | Probe mode: the popup opens, C1–C8 are reported, the window closes, no file is set and no story is recorded |
| E5 `@smoke` | `handoff` | H1 happy path with `geometry=fixed:1080x1920`. The composer **document** request (`sec-fetch-dest: document`) carried the Android UA, `sec-ch-ua-mobile: ?1`, `sec-ch-ua-platform: "Android"` and no high-entropy hints. The human clicks Share; exactly one story with `isTrusted: true`; PSNR against the PNG export is at least 38 dB. Phase reaches finished; `getSessionRules()` is empty after the window closes |
| E6 | `handoff` | H0 with assisted insert OFF: the instructions show; the human taps + → Story and picks the export; the story is recorded |
| E7 | `handoff` | Scoping: during a session, a second normal tab to `https://www.instagram.com/` gets the desktop shell (Mac UA in the log, `is_mobile:false`) |
| E8 `@smoke` | `canary` (mock only) | `share=real-paths`: writes 0; story still recorded; `onRuleMatchedDebug` fired. A fetch to `rupload_igphoto` from the extension service worker and from a page is blocked (`ERR_BLOCKED_BY_CLIENT`) |
| E9 `@smoke` | `canary` (live only) | Rehearsal OFF with `share=real-paths`: 2 writes arrive, so live does not block. Rehearsal ON: 0 writes, the story is still recorded, an extension-service-worker fetch (tabId -1) is blocked during the session, and after close a new non-rehearsal session has no stale block |
| E10 | `handoff` | `marker=off`: mock gives `GUARD_NOT_FAKE` (window closed, nothing injected, no story); live proceeds. With the marker on, live shows `handoff-banner` "FAKE INSTAGRAM" |
| E11 | `tripwire` | Meta-test: an untrusted Share dispatched with `page.evaluate` appears in `fake.violations()`, and the invariant helper throws |
| E12 | `failure-matrix` | One test per knob: (a) `sw=desktopShell` → after the hard reload the page is mobile and uncontrolled, and afterwards a normal tab still gets desktop; (b) `sw=claimLate` → `SW_TOOK_CONTROL`; (c) `auth=out` → `NOT_LOGGED_IN`, no lock; (d) `auth=challenge` → kill, then the next start gives `MSITE_LOCKED`, and `ENABLE` re-enables; (e) `offhost=afterReady` → kill; (f) `trusted=require` → `INJECTION_IGNORED` → H0 with exactly one inject; (g) `listen=drop` → same as (f); (h) `input=afterTap` → H0; (i) `route=homeOnly` → H0 with the "tap + → Story" text; (j) `accept=changed` → `ACCEPT_DRIFT` → H0; (k) `classifier=client-hints` → still mobile; (l) `locale=es` → same outcomes as `en`; (m) `drift=renamed` → unaffected |
| E13 | `geometry` | For `viewportDpr`, `source`, `fixed:1080x1920` and `cssFixed:360x640`, the agent's C8 report equals the fake's ground truth. A popup forced to landscape is refitted once |
| E14 | `handoff` | A second start within 60 s gives `RATE_LIMITED` and opens no window |
| E15 | `handoff` | Closing the popup mid-flow removes the session rules and resets the state to idle; the next session starts cleanly |

---

## 8. Milestones

### S: scaffold and spikes (fully local; nothing reaches Instagram)

- [x] **S1** Scaffold the tree, `package.json` and configs as §7. `pnpm install`; `wxt prepare`. Confirm three WXT 0.21.4 behaviours this spec relies on: the editor renders with Preact JSX through the tsconfig `jsxImportSource`; the `build:publicAssets` hook adds the generated ruleset; `webExt: {disabled: true}` opens no browser. Run `git init` and commit only with the owner's approval.
- [x] **S2** `pnpm run bootstrap`: keys, icons, certificate and SPKI, CfT 155.0.8059.39 in `.cache/cft`.
- [x] **S3** Spike on CfT 155 and Playwright Chromium:
  - host mapping with a port;
  - the SPKI certificate accepted with no interstitial (including CT);
  - `MAP * ~NOTFOUND` seals the network;
  - `--no-proxy-server` works;
  - no Local Network Access prompt (if one appears, set `LNA_ARGS` in dev and test profiles only).

  If mapping fails, build `route-adapter.ts` (§7.6) instead.
- [x] **S4** Spike:
  - service-worker registration works on the SPKI-accepted origin;
  - `tabs.reload({bypassCache:true})` leaves the page uncontrolled;
  - the isolated-world agent can read `navigator.serviceWorker.controller` and receive `controllerchange`.
- [x] **S5** Spike (research Q27): the fake's log shows the rule-1001 UA on `main_frame`, `set` on `sec-ch-ua-mobile` and `-platform`, and `remove` of the high-entropy hints, on CfT 155 and on Playwright Chromium. Otherwise `chMode:'uaOnly'`.
- [x] **S6** Spike: `block_ig_writes` matches page and extension-service-worker requests (`onRuleMatchedDebug`); `tabIds:[-1]` matches extension-service-worker requests.
- [x] **S7** Spike: `DataTransfer` injection from the isolated world fires React 19's `onChange` in the fake.
- [x] **S8** Spike: popup inner size headed and headless in Playwright. Decide the `headless` default.
- [x] **S9** Spike: Node 22.18 runs `tools/*.ts`, including imports from `src/core` with `.ts` extensions.
- [x] **S10** Record Playwright's bundled Chromium version in `docs/contract.md`.

### P: photo editor v1 and risk-free exits

- [x] **P1** Walking-skeleton editor (§7.10) with U1–U6, B1–B5 and E3 green.
- [ ] **P2** Share-sheet adapter. Check research Q24 by hand: from the editor, `navigator.share({files})` reaches AirDrop on macOS Chrome 155. If not, the phone lane is Downloads plus Finder's Share menu (`downloads.show`).
- [ ] **P3** Contain fit and backgrounds (solid with EyeDropper, sampled gradient, blur); free transform; numeric panel, nudges and snapping.
- [ ] **P4** HEIC through libheif-js 1.23.5 in packaged `heic.worker.ts` (spike: loads under the CSP, no blob worker). EXIF orientation fixtures 1–8 (B7).
- [ ] **P5** pica 10.0.3 split build (`pica_main.mjs` plus packaged `pica_worker.js`, `mks2013`) for sources downscaled more than 2x. A zone-plate test compares it with native resampling (B8).
- [ ] **P6** Text v1: 13 OFL families labelled by family name, 5 styles, emoji setting, rotate and scale handles.
- [ ] **P7** Placeholder layers and the lane picker.
- [ ] **P8** Drafts autosave; undo and redo.
- [ ] **P9** darwin goldens for 3 fixture docs (B9; skipped on other OSes).
- [ ] **P10** Viewer-chrome preview overlay with neutral shapes; geometry calibrated in L8.

### D: desktop hand-off against the fake

- [x] **D1** Background reducer, runner, session store, rate guard and kill switch, with U7–U14 green.
- [x] **D2** Composer agent (probe, inject, watch), with B6 green.
- [x] **D3** Fake Instagram per §7.6 and the dashboard, with U15–U17 green.
- [x] **D4** E1–E15 green on the **mock and live** artifacts; the `@smoke` set green on CfT 155.
- [x] **D5** T1–T5 green; `pnpm run verify` green end to end.
- [x] **D6** `docs/contract.md` and `docs/live-checklist.md` written.
- [ ] **D7** Calibration tool in settings:
  - downloads a 1080x1920 calibration card with corner fiducials, 60 px edge rulers and a 9:16 border;
  - analyses a returned composer image (fiducials → crop rect and scale) and stores `composerProfile`.

  B10 tests synthetic crops and scales.

### L: live verification (secondary account, human only, §6.4 protocol)

- [ ] **L1** (research Q1) In the "IG secondary" branded-Chrome profile, with no extension, normal desktop UA and a wide window: look for a story entry (profile photo at top left, or the Create menu). Look only. If one exists, stop and re-plan around it, since it needs no spoofing.
- [ ] **L2** `pnpm run contract:check` (logged out, one GET per UA): the exact Android reduced UA gives `is_mobile:true`; Mac Chrome gives `false`. Record the key path in `baseline.json`.
- [ ] **L3** The owner sets up the secondary account:
  - a private personal account created on the phone, with authenticator 2FA, **not** added to the primary's Accounts Center;
  - normal use on the phone for at least 3 days;
  - then logged in on normal desktop in the new "IG secondary" profile.

  **Isolation is partial:** the two accounts share the phone and the home IP, and whether Meta acts on linked accounts together is (unverified).
- [ ] **L4** *Requires D4 and D5.* Load the live build into "IG secondary". Set the account label; rehearsal ON. Run **Probe composer**, with no file. Record:
  - C1–C5 and the service-worker state after the hard reload;
  - whether the first document was "(ServiceWorker)" in the DevTools Network panel;
  - that a normal desktop tab afterwards still shows the desktop shell and Create menu.

  Write the structural facts into `baseline.json`, update the fake's defaults, and get U16, E12 and E13 green.

  If the hand-off ends with `UNEXPECTED_PAGE`, the panel names the page (AM28): record that path as a contract fact, and do not retry until the fake models it.
- [ ] **L5** Geometry without Share. Rehearsal ON, H0: the owner taps + → Story and picks the calibration card; the agent records C8.
  - If the composer exposes a save or download control (`SAVE_STORY`; UI presence is (unverified)), the owner clicks it and drops the saved file into the calibration tool.
  - Close without Share. Repeat at a second popup size.
  - Set `composerProfile`; decide OD4 if the image is downscaled.
- [ ] **L6** Assisted-insert check: rehearsal ON, H1 ON, one attempt with the calibration card. Does C6 (composer ready) appear? No Share. If not, H0 stays the default and OD3 is moot.
  - Write into `baseline.json`: `untrustedInsertAccepted` (`true` if C6 appeared after the insert; `false` on `INJECTION_IGNORED`, and note whether the photo was visible in the composer anyway, AM28) and, if it can be observed, `fileEvent` (`change` or `drop`). Then update the fake's defaults via `deriveKnobs` and get U16 and E12 (f) green, as in L4.
- [ ] **L7** *Only if L5 left the output size ambiguous:* **one** rehearsal Share click, which the rules proven in E9 block. Read `upload_media_width/height` in DevTools if a blocked request shows its headers. Never repeat it; note any client retries or error toasts.
- [ ] **L8** First real post on the secondary, with rehearsal switched OFF: the owner clicks Share, H0 or H1 per L6, with a PNG hand-off.
  - Check on the phone: size, crop, sharpness and colour against the export.
  - Screenshot it to calibrate P10.
  - Delete it.
  - On another day, post one JPEG-0.95 hand-off to compare.
- [ ] **L9** Phone lane: export a frame with a music placeholder, send it to the phone, add the Music sticker in the app on the secondary. Check the placeholder geometry and the duration. Post and delete, or discard.
- [ ] **L10** Soak (OD2): by default at least 10 desktop posts over at least 14 days, at most 1 a day, at varied times. Review Login activity, security emails and Accounts Center weekly (research Q5).
- [ ] **L11** After every Chrome major update, and monthly: rerun L2 and L4 (probe only).
- [ ] **L12** (optional, feeds OD5) On the secondary account, open "Switch to professional account" and read the consequences (privacy, music) **without confirming**.

### G: gate before the primary account

- [ ] **G1** L10 complete with no warnings, challenges or unusual security emails.
- [ ] **G2** The last 5 preflights all passed; crop loss is 0.5% or less; OD4 decided.
- [ ] **G3** The kill switch is proven on the fake (E12 d, e). Rehearsal is proven on the fake (E9) and on the secondary (nothing posted during L5–L7).
- [ ] **G4** The phone lane has been used end to end (L9).
- [ ] **G5** The owner explicitly accepts the residual terms-of-use grey area (OD1).
- [ ] **G6** The everyday profile holds only the live build; guarded builds were never loaded there.
- [ ] **G7** The account label in the everyday profile is set to the primary's handle. First primary post, then normal use under the rate guard.

### X: v1.x (after L8)

- [ ] **X1** Templates.
- [ ] **X2** Brand kit.
- [ ] **X3** Story sets: one hand-off per frame under the rate guard; numbered phone exports.
- [ ] **X4** Collages.
- [ ] **X5** Outbox folder through the File System Access API (whether a re-grant needs a gesture is (unverified)).
- [ ] **X6** Logged-out bundle-marker watch script.
- [ ] **X7** Optional CI on ubuntu: headed E2E under xvfb, semantic pixel probes only, never builds or loads anything near real Instagram.

### V: v2 video

- [ ] **V1** Packaged `video.worker.ts`, Mediabunny 1.61.3, and `@mediabunny/aac-encoder` 1.61.3 repackaged as a worker file (spike: no blob worker).
- [ ] **V2** Video layer with trim and cover; `compose()` supports `tMs`.
- [ ] **V3** MP4 validator test: no `edts`, `moov` before `mdat`, 30 fps constant, 3–60 s, AAC at 48 kHz or less.
- [ ] **V4** Split clips longer than 60 s into 3–60 s segments.
- [ ] **V5** iPhone HEVC and HDR input probe and fixture.
- [ ] **V6** Delivery through the phone lane; the lane picker forces video to the phone.

### M: v3 music and account options

- [ ] **M1** Music plan with a cue line (song, start time mm:ss, placement) as share text and a filename suffix.
- [ ] **M2** Burned-in owned or royalty-free audio (`OfflineAudioContext`, AAC) with a Rights Manager warning.
- [ ] **M3** *Only if the owner moves to Creator (OD5):* an MBS export preset; upload stays manual.
- [ ] **M4** *Only if the owner moves to Business:* the Graph adapter, a mock Graph server (msw 3.0.3 in Vitest), and a decision on public hosting.

---

## 9. Risk register

### 9.1 Risks

| Id | Risk | Likelihood | Impact | Mitigation | Detection |
|---|---|---|---|---|---|
| R1 | Instagram flags or restricts the primary because of the spoofed msite session | Low to medium (unverified) | High | Tier 1 only; the human clicks Share; secondary soak and gate G; Android header profile; no login in the spoofed tab; rate guard; no retries; kill switch; stable IP; authenticator 2FA | Kill-switch URLs; weekly Login activity review; security emails |
| R2 | Trouble on the secondary spreads to the primary | Unknown | High | Separate Chrome profile; secondary kept out of Accounts Center. Shared phone and IP are acknowledged; isolation is partial | The same reviews on both accounts |
| R3 | The msite composer is removed or changes its route, input or accept list | Medium over a year | Medium; the phone lane keeps working | Contract module; fake knobs for both outcomes; H1 → H0 → export ladder | Per-hand-off preflight; L11; `contract:check` |
| R4 | Classification moves off the UA header (client hints or JS) | Low to medium | Medium | The profile already sends mobile client hints; the `classifier=client-hints` knob keeps that path tested | C1 `is_mobile` false → `DESKTOP_SHELL`; `contract:check` |
| R5 | Instagram's service worker serves a desktop shell, or takes control mid-session | Medium | Low to medium | Hard reload; controller check; `controllerchange` abort; rehearsal rules also cover tabId -1 | Probe; E12 a and b |
| R6 | The composer downscales or crops the image | Medium to high on the MacBook | Medium (softness) | L5 measurement; window fit; display "More Space"; external monitor; opt-in debugger DPR emulation (OD4) | C8 on every hand-off; crop-loss warning |
| R7 | The composer ignores untrusted events | Unknown | Low; H0 still works | One attempt, then H0 | L6; C6 timeout |
| R8 | A dev or test build posts for real | Very low | High | SG1–SG11 | E1, E8, E9, invariants |
| R9 | The rehearsal rules fail and rehearsal posts for real on the secondary | Low | Medium | Rules derived from the same list as the static ruleset; E9 on the live artifact; at most one rehearsal Share | E9; DevTools shows the request blocked |
| R10 | A story is posted to the wrong account | Low | Medium | Account label in the panel; one browser profile per account; human review before Share | — |
| R11 | The sealed environment leaks (proxy, resolver semantics, Local Network Access) | Low | High: automation could reach real Instagram | Allow-list, `--no-proxy-server`, `globalSetup` seal precheck, tripwire; dev profiles never logged in | E1; precheck; tripwire |
| R12 | The fake drifts from reality and gives false confidence | Medium | Medium | `baseline.json` drives the knob defaults (U16); L4 and L11 | U16; live preflight |
| R13 | Chrome changes dNR client-hint handling, service-worker bypass or `tab.width` | Low to medium | Medium | `minimum_chrome_version` 155; pinned CfT; `@smoke` on the owner's major | `test:smoke155` on every Chrome major |
| R14 | Libraries using blob workers (HEIC, AAC) break under MV3 | Medium | Low | Packaged workers; spikes P4 and V1 | Spike tests |
| R15 | Blocked rehearsal uploads look anomalous in Instagram's telemetry, or get retried by its client | Unknown | Low to medium | Geometry measured through the probe and `SAVE_STORY` first; at most one rehearsal Share, ever | L7 notes |
| R16 | Meta treats UA switching as circumvention | Low (no precedent against an individual user) | High | Owner's informed acceptance (OD1); personal, unpacked build; never published | Terms watch |
| R17 | The owner expects music and video from desktop | High | Low | Honest UI; lane picker; phone hand-off kept painless | — |

### 9.2 Unverified assumptions and their cheap checks

| Id | Assumption | Source | Check |
|---|---|---|---|
| A1 | dNR `set` and `remove` on `sec-ch-ua*` apply in CfT 155 | Research Q27 | S5 (fake header log); fallback `uaOnly` |
| A2 | The exact Android reduced UA gets `is_mobile:true` today | §5.1 (the Android UA class was verified by curl) | L2 |
| A3 | msite serves the same story composer to Android and iOS UAs | Inference | L4 |
| A4 | A forced reload bypasses Instagram's service worker; the first load is service-worker-served | §5.4, inference | S4 on the fake; L4 in DevTools |
| A5 | `isTrusted=false` insertion is accepted | §5.5 | B6 and E12 f on the fake (both outcomes); L6 |
| A6 | Composer canvas size: viewport × DPR, or source size | §5.2, research Q4 | E13 on the fake; L5, L7, L8 |
| A7 | `SAVE_STORY` is exposed in the msite UI | §5.2 (reducer action only) | L5 |
| A8 | `/create/story/` works directly, and the input exists before tapping | §5.2 | L4 |
| A9 | Resolver allow-list ordering, SPKI acceptance and no Local Network Access prompt in CfT 155 | Research Q29, §8.6 | S3, E1 |
| A10 | Service workers register on the SPKI-accepted origin; the isolated world can see the controller | Inference | S4 |
| A11 | `tabIds:[-1]` matches service-worker-initiated requests | dNR docs (`TAB_ID_NONE`) | S6, E9 |
| A12 | Web Share with files reaches AirDrop on macOS | Research Q24 | P2 |
| A13 | libheif-js and the AAC encoder run as packaged workers under the CSP | §7.4 (inferred from source) | P4, V1 |
| A14 | DevTools shows headers of requests an extension blocked | Inference | L7, only if needed |
| A15 | Creator keeps the music library; Creator privacy (research says nothing); Business cannot be private | Research Q9, §4.1 | L12 (read the screen, do not confirm) |
| A16 | Popup inner size is the same headed and headless | Inference | S8 |
| A17 | Linked accounts are actioned together | Unknown | No cheap check; precautions in L3 |
| A18 | Per-tab zoom adds no device pixels to a canvas sized to the viewport | Analysis | E13 `cssFixed` versus `viewportDpr` on the fake |

---

## 10. Open decisions for the owner

| Id | Decision | Options | Recommendation |
|---|---|---|---|
| OD1 | Accept the residual terms-of-use grey area of the tier-1 msite route on the primary account | Yes, or desktop posting stays on the secondary only and the primary uses the phone lane | The owner's call. Required before G5 |
| OD2 | Soak length before the primary | Default: at least 10 posts over at least 14 days, at most 1 a day; shorter is the owner's risk choice | Keep the default |
| OD3 | Enable H1 assisted insert if L6 passes | H1 on, with H0 as fallback; or H0 only (always pick the file yourself; zero synthetic events) | H1 on |
| OD4 | If L5 shows downscaling | (a) accept 6–9% softness; (b) switch macOS display scaling to "More Space" while posting; (c) use a taller external monitor; (d) opt-in `chrome.debugger` DPR emulation: a global "started debugging this browser" infobar, CDP attached to a logged-in Instagram tab, a larger footprint (a §5.4 tier-1 backend excluded by policy) | (b) or (c); (d) only as a deliberate, owner-approved escalation |
| OD5 | Account type | Stay personal; Creator plus MBS (desktop video, link stickers, scheduling, no music; whether Creator can stay private and keeps music is (unverified)); Business plus Graph API (needs public hosting; probably public; may lose music) | Stay personal. Reconsider Creator if you regularly want more than about 3 desktop video stories a week, or link stickers. Not Business |
| OD6 | Scope of the UA rule | `www` and `i` only, as research §8.3; or also `*.cdninstagram.com` and `*.fbcdn.net` for UA consistency on CDN requests (more host permissions) | `www` and `i` only; revisit after L4 |
| OD7 | Default phone channel | Share sheet (if P2 passes); Downloads plus Finder Share or AirDrop; a synced outbox folder (X5) | Share sheet if P2 passes, otherwise Downloads plus Finder |
| OD8 | CI | Local `pnpm run verify` only; or GitHub Actions later (X7) | Local only for now |

---

## 11. Amendments from the build phase (2026-10-11)

These override earlier sections where they conflict. Evidence for A-S items is in `docs/contract.md` § "Spike results".

| Id | Amendment | Overrides |
|---|---|---|
| AM1 | E2E runs **headless by default** with screen emulation: `sealedPlaywrightArgs(spki, extDir, { headless })` appends `HEADLESS_SCREEN_ARGS` (owner screen 3024x1964 @2x). `viewport: null` is mandatory; a Playwright viewport turns popups landscape. Plain headless caps popups at 600 px | §7.9 "headed by default"; §7.4 signature |
| AM2 | Instagram's service worker serves the first composer load once with the desktop UA before the hard reload replaces it, and any **later full-document load in the composer tab is SW-served again** (desktop UA). The runner must treat every subsequent `status:'loading'` of the armed composer tab as needing a re-probe; if the re-probe shows `isMobile !== true` or `swControlled === true`, end with `DESKTOP_SHELL`. Never hard-reload more than once per hand-off | §3.6 step 5 wording; reducer D1 |
| AM3 | Synthetic `change` (not `input` alone) is what fires React 19 `onChange`; dispatch both, `change` last | §3.8 H1 step 4 (order) |
| AM4 | Playwright `request.headers()` shows pre-dNR headers. E5/E7 read headers from the fake's request log (or `request.allHeaders()`) | §7.11 E5, E7 |
| AM5 | On the live build there is no `onRuleMatchedDebug`; E9 asserts via the fake's writes log and `requestfailed` (`ERR_BLOCKED_BY_CLIENT`) | §7.11 E9 |
| AM6 | The static block ruleset never matches navigations; the fake's `share=real-paths` canary must use subresource requests only | §6.1 Share knob |
| AM7 | The SPKI bypass also covers `localhost`/`127.0.0.1`; the fake routes on `Host` without port and serves only `/__fake__/health` for non-Instagram hosts | §7.6 routes |
| AM8 | `wxt prepare` always runs in `production`: the manifest callback returns a stub for production+prepare only; the `build:before`/`build:publicAssets` hooks still reject production builds | §7.3 |
| AM9 | WXT merges `web-ext.config.*`/`.webextrc` over `webExt`; a `config:resolved` hook re-asserts the seal before any browser starts | §7.3 "nothing can override" |
| AM10 | `src/core` fence = `rootDir` in the core tsconfig (relative escapes) + Biome `noRestrictedImports` (packages); T4 additionally scans import specifiers | §3.2 enforced seams |
| AM11 | Pin a free WXT dev-server port in `scripts/dev.ts` (port 3000 is taken by Docker on the owner's Mac) | — |
| AM12 | Playwright bundled browser is CfT **156.0.8078.4**; CfT **155.0.8059.39** stays the `@smoke`/dev browser | §7.4 |
| AM13 | C8 is measured once the composer is ready: entering `awaitingShare` sends one more `agent/probe`, and `agent/report` is also accepted in `awaitingShare`, where it only records `readyProbe` (on the record, and as `preflight.C8`) and never re-evaluates the flow. C1–C5 stay with the deciding probe | §3.5 acceptance ("report" only in `probing`); §3.9 item 1 |
| AM14 | E13 runs `cssFixed:360x640` in a 450x800 popup (`composerProfile`): in the default 511x909 popup that box covers 49.6% of the viewport, below C6's 50%, so the composer never counts as ready. C6 stays at 50% | §7.11 E13 |
| AM15 | E2E specs that open a second composer within one test (E9, E12 d, l, m, E15) clear the rate guard's `rateLog` in storage.local between the sessions; E14 proves the guard itself | §7.11 E9, E12, E15 |

**Amendments from the review fixes (2026-10-12).** Evidence for the Chrome behaviour is in `docs/contract.md` § "Review fixes: observed in the sealed browser".

| Id | Amendment | Overrides |
|---|---|---|
| AM16 | **Same-document loads.** Chrome reports `pushState`, `replaceState` and hash changes in the composer tab as `status:'loading'`, then `complete`. After every armed `loading` the agent is re-injected, and its sentinel tells whether the document is new (`agentInjected.fresh`, the agent script returns `false` when it was already there). The same document resumes the interrupted phase (`injecting`, `awaitingPick`, `awaitingShare`) with its level and degradation unchanged and no new `agent/watch`; agent events that arrived meanwhile are buffered (`agent/event` is accepted in `probing`) and replayed. Only a new document is probed, strictly. AM2's "every subsequent `status:'loading'`" reads "every later **full-document** load". A full-document load that lands on `/` once the composer is engaged still counts as C9: it cannot be told from a full navigation home after Share (E12 t pins it). Known limit: a `replaceState` in the reloaded document before its first `complete` still makes the first probe strict | AM2 wording; §3.5 acceptance (`agent/event` also in `probing`) |
| AM17 | **The URL classification fails closed.** Besides `/challenge` and `/checkpoint`, `/auth_platform…` and every `/accounts…` path except `/accounts/login…` (suspended, disabled, onetap, …) **kill** and lock. Only `/` counts as "composer left" (to confirm in L8). Any other www path is the new error `UNEXPECTED_PAGE` (effect: close, no lock): before the composer is engaged it closes the popup without a reload, probe or insert, on the first load and after the reload too; once engaged it ends the session (`finished`) with no "posted" pre-answer and the status carries `UNEXPECTED_PAGE` | §3.6 kill-switch table, rows 2 and 5; §3.10 (adds `UNEXPECTED_PAGE`) |
| AM18 | **C9 needs an engaged composer.** Leaving `/create/story` counts as C9 only once the composer was in use: `composer-ready` was seen (`awaitingShare`), or the H1 file was served. Leaving it for `/` before that is C5 failing: `route` becomes `homeOnly` (C5 `fail` on the record), the pending probe or H0 carries on with "tap + → Story", and `injecting` before the file was served degrades to H0 (still one inject). The agent's watch keeps running after `composer-left` and reports each later leave | §3.6 step 9 ("or when the tab URL leaves `/create/story`"); §3.9 C9; §11 AM2 C9 handling |
| AM19 | **No 3 s close while an upload may run.** A C9 that followed Share (from `awaitingShare`) in a `post` hand-off with rehearsal **off** holds the popup open: no `closeDelay`; it closes on the owner's "Posted?" answer, a cancel, the window being closed, or 15 min of inactivity. The status carries `holdOpen` and the panel says why. With rehearsal on, or a C9 before Share, the popup still closes after 3 s | §3.6 step 9 ("the window closes after 3 s") |
| AM20 | **The first navigation is classified before the kill switch arms.** In `navigating`, a visible URL that is not www (i.instagram.com, `http:`) or an update with neither status nor URL (the tab's URL or title changed to a page the extension cannot see: accountscenter, facebook.com) **kills** and locks; a login URL stops; an unexpected www page is `UNEXPECTED_PAGE`. A 30 s `navigation` timer closes a first navigation that never commits on www: `KILLED_OFFHOST` when hidden-URL loads were seen, else `TIMEOUT` | §3.6 kill switch ("after arming") and step 5 |
| AM21 | **The panel shows the running session's switches.** Every status of an active hand-off carries its `rehearsal` and `assistedInsert` snapshot (fixed at start, as the rules are); while a hand-off runs the panel's chips show those, not the stored settings. Settings disables both switches while a hand-off runs; their text says they apply to the next hand-off. New test ids: `handoff-chip-rehearsal`, `handoff-chip-assisted` (`data-on`), `handoff-hold-open` (AM19), `setting-switches-locked` | §7.10 hand-off panel (toggles, test ids); §3.7 "toggle in the hand-off panel" |
| AM22 | **A popup left by a reloaded extension is closed.** From `windowCreated` until the session ends the popup is remembered in storage.local (`composerWindow`). At every service-worker start, a remembered popup that no stored session owns (reload, update or disable/enable cleared storage.session), and that is still a single-tab popup on www.instagram.com, is closed before the startup cleanup | §3.6 step 10 |
| AM23 | **Guarded builds refuse in branded browsers before any window.** `start` in a guarded build fails with `GUARD_NOT_FAKE` (no window, no rate-log entry) when the background's `navigator.userAgentData.brands` names Google Chrome or Microsoft Edge. CfT and Playwright's Chromium report only "Chromium" (S5; E2 asserts it) | §3.6 preconditions; SG4 (now also checked before navigation) |
| AM24 | **C6 must be caused by the file.** The agent counts a canvas as ready only if it was not already ready when the watch first started in that document (a pre-existing canvas counts once it has stopped and started satisfying C6 again); in an H1 run it reports `composer-ready` only after the insert; the reducer accepts `composer-ready` in `injecting` only once the file was served | §3.8 H1 step 5; §3.9 C6 |
| AM25 | **The kill-switch lock is the background's alone.** It lives in storage.local `msiteLock`, written only from the background's effect queue; the editor never writes it. ENABLE is an editor → background message (`handoff/enable-msite`, carrying the lock the editor showed) that clears it in the same queue; a lock newer than the one shown stays. A lock left in `settings.msiteLockedUntil` by an earlier build still counts until ENABLE clears it | §3.3 Settings (`msiteLockedUntil` storage); §3.6 "Re-enabling requires typing ENABLE" |
| AM26 | **Test and tooling.** The tripwire counts every request outside the sealed hosts, `ERR_NAME_NOT_RESOLVED` included, and every request the extension itself makes to a web URL, unless the test declares it (`expectOutside`, `expectFromExtension`). T3's patterns live in `tools/bundle/patterns.ts` with a self-test, and add: clicks by any means, form submission, page storage, the fake's hooks, a `dispatchEvent` allow-list (`input`/`change` only) in the agent; network APIs in `background.js`; network APIs other than Vite's modulepreload and Meta-host URLs in the editor chunks. The fake reports `isTrusted` for every control (`UNTRUSTED_CONTROL`). The fake's health reports a source hash and the E2E global setup refuses a stale fake. `baseline.json` gains `untrustedInsertAccepted` and `fileEvent` (L6) and allows `unknown` for `route`, `storyInputBeforeTap` and `isMobileKeyFound`; `deriveKnobs` maps L6 into the fake, so baseline.json is written from L4–L6. New knobs `route=elsewhere`, `auth=codeentry`, `offhost=firstLoad`, `challenge`, `desktopComposer`, `reload`, `share=background` (E12 a2, n–u); new specs E16–E19; the `preinstallFakeSw` fixture option follows `DEFAULT_KNOBS.sw`. `wxt` dev refuses every target browser but `chrome`, and `HEADLESS=1 pnpm run dev` gets the emulated owner screen | §7.9 invariant 1; §7.11 T3; §3.9 item 3; §7.3 |
| AM27 | **Editor.** The rotate slider snaps to 0 and ±90 only when moving towards them (within 3°), so keyboard steps can leave a snap point. A blurred background fill is drawn 3σ larger than a cover on every side, so the export is opaque to its edges | §7.10 rotate slider; §3.3 `blur` fill |
| AM28 | **Review fixes, round 2.** (1) *A new document drops the interrupted phase* (AM16): once `agentInjected.fresh` shows that a later load brought a new document, the phase that load interrupted (`injecting`, `awaitingPick`, `awaitingShare`) is gone with the old document. The strict probe of the new document decides; a Share or an insert made in the old one no longer counts (a `/` before that probe's report is C5 `homeOnly`, an unknown page is `UNEXPECTED_PAGE`); an interrupted H1 is `INJECTION_IGNORED`; and a later same-document load in the new document re-probes instead of resuming a phase whose agent and watch are gone. (2) *An unconfirmed insert keeps the composer engaged* (AM18): the agent reports `inject-unconfirmed` when it dispatched the insert but C6 did not hold within 10 s (a canvas under 50% of the viewport, a stale canvas, AM14/AM24), and `inject-ignored` only when the insert could not be made (no input, no file). Both degrade to H0 with `INJECTION_IGNORED`, but after `inject-unconfirmed` leaving the composer (`/` or the agent's `composer-left`) is C9 with **no pre-answer** (`postedUnknown`), the popup is held open whatever rehearsal says (an upload or a pick by hand may still run in it), and the record's `detail` says so. A new document clears it. E12 v pins it on the fake (`geometry=cssFixed:360x640` in the default popup: the photo shows, C6 never holds). (3) *No pre-answer when it cannot be told*: an unknown www page after Share (AM17) is `postedUnknown` too; the panel then makes neither answer primary, says Share may have been tapped, and its fallback is "check the story on the phone before posting it again". The finished state keeps the page, so a reconnected editor still gets `UNEXPECTED_PAGE`. (4) *`UNEXPECTED_PAGE` names the page*: its path (query and fragment dropped) is the status and record `detail` (`page /x/`), shown in the panel ("It went to /x/.") and in the background log in every phase, `navigating` included: a contract fact to record (L4, L8). (5) *New codes*: `BRANDED_BROWSER` (effect `no-window`) replaces AM23's `GUARD_NOT_FAKE` for a guarded build in a branded browser; `NAVIGATION_TIMEOUT` (effect `close`) replaces AM20's `TIMEOUT` for the 30 s first-navigation deadline. (6) *The `navigation` timer survives a service-worker restart* (storage.session keeps every timer), and the 15 min backstop in `navigating` still kills (`KILLED_OFFHOST`) after a hidden-URL load. (7) *Rotate snap by gesture* (AM27): the snap's direction compares the slider's raw value with the previous raw value of the same gesture (pointerdown or keydown to `change`), so a pointer drag towards 0 or ±90 stays snapped instead of flickering, while keyboard steps still leave a snap point. (8) Panel: the `finished` phase reads "Composer left"; new test ids `handoff-posted` (`data-pre-answer` `true`/`false`/`null`) and `handoff-error-detail` | AM16 (resume after a new document); AM17 (pre-answer, detail); AM18 (engaged); AM19 (held open with rehearsal on after an unconfirmed insert); AM20 (`TIMEOUT` → `NAVIGATION_TIMEOUT`); AM23 (`GUARD_NOT_FAKE` → `BRANDED_BROWSER`); AM27 (snap direction); §3.5 agent events; §3.8 H1 step 5; §3.10 |
