# instapost: implementation strategy

- **Status:** final strategy for the build phase, 2026-10-11. **Amended through §11 AM43 (2026-10-13): since AM39 the extension posts by itself (the autopilot, `docs/ux.md`); where an earlier section says the owner clicks Share, picks the file or answers "Posted?", AM39–AM41 override it.**
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
   - ~~**The owner clicks Share.** The extension never calls Instagram write endpoints and never clicks anything in Instagram's page.~~ **Since AM39 (owner decision, 2026-10-13): after the owner presses Post story, nothing else needs them.** In the composer tab only, the isolated agent taps Instagram's own + (Create), the Story menu item and Share, through one audited tap helper, and puts the photo into the story input that + → Story armed. Instagram's own client builds and sends every request: the extension still never calls Instagram write endpoints itself (no hand-built requests, signed bodies, native-only fields or password handling). Share is pressed at most once per post, never retried, and "Posted" comes only from Instagram's own publish answer (AM40).
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
6. **Hand-off ladder** (superseded by AM39):
   - ~~H1, assisted insert, enabled only after a live check;~~
   - ~~then H0, manual pick: the owner picks the downloaded file;~~
   - ~~then export.~~

   Since AM39 there is one path, the autopilot: + → Story, the photo into the armed story input, Share once. When Instagram's page is not what it expects, it stops before Share and offers **Finish by hand** in the same window (the owner taps; instapost only observes and confirms) and the phone. Still no retries and no escalation to drop events or CDP.
7. **Small Instagram footprint:**
   - no `content_scripts`, no `web_accessible_resources`, no MAIN-world script and no `chrome.debugger` (one owner-directed exception since AM37: the background's portrait shim, a `func` run in the composer tab's top frame only);
   - one isolated-world agent, injected only into the composer tab (since AM39 it also taps +, Story and Share there, through one audited helper);
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
| Owner effort per story | ~~One Share click in the popup (plus a file pick on H0)~~ Since AM39: one click on Post story in the editor; nothing in the popup | AirDrop, then 3–5 taps |
| Risk tier | 1 | 0 |

### 2.3 Risk notes

- **Terms-of-use grey area.** Instagram's Terms ban circumventing "technological measures" (§5.8). Whether a hidden-UI limit counts as one is a matter of interpretation. Research found no enforcement against individual users; enforcement targeted commercial automation.
- **The spoofed session stays detectably inconsistent** (research §1 item 10; §5.4):
  - the msite app ID `1217981644879628` appears alongside the desktop ID in the same session;
  - `X-IG-Max-Touch-Points: 0` is sent;
  - `navigator.userAgentData` says macOS desktop.

  The Android profile makes the `Sec-CH-UA-*` headers consistent with the UA, but the JS realm still says desktop. This cannot be removed, only kept small, human-paced and optional.
- **The portrait shim adds one more inconsistency** (AM37, owner-directed 2026-10-12). Instagram's composer refuses to show Share while `screen.orientation.type` reads landscape, which a desktop's landscape monitor always does. In the composer tab only, the background makes the page's `screen.orientation` report `portrait-primary` and angle 0 through two own getters on that document's ScreenOrientation instance. Page scripts can see that: the getters are own properties and not native code, and the type disagrees with `screen.width > screen.height`, with the prototype's getter and with `matchMedia` on the screen. It is a deliberate amendment of "no MAIN-world script", kept to that one tab, one top frame and two values; it runs with the page's own globals, so its report is treated as untrusted data. Without it the desktop lane cannot share at all on a landscape monitor. `SCREEN_LANDSCAPE` (no lock) ends the hand-off only while, on the composer, the page's own `screen.orientation.type` still reads landscape, the shim's reading is unreadable, or the shim went in only after the composer had mounted (AM38). If Instagram starts reading the screen another way (the prototype's getter, `screen.width > screen.height`, a device-aspect media query), nothing here notices: the composer shows its snackbar again, C3b is recorded as pass, and the panel waits for a Share that cannot come until the owner cancels or the 15-minute `TIMEOUT`. The owner's eyes and the live checks L16/L17 catch that.
- **The autopilot adds synthetic taps** (AM39, owner-accepted as OD9, 2026-10-13). instapost's +, Story and Share are `element.click()` calls from the isolated world: `isTrusted: false`, no pointer, mouse or focus events before them, and no user activation in the page; the photo is a `File` the extension built, assigned to the story input Instagram itself armed; and the story session is shorter than a person's (a human-paced dwell lengthens it). No module in Instagram's saved msite bundles reads `isTrusted` or `userActivation` on that path, but Instagram could start to (R7, R18), and the taps move instapost from assisted to automated use under Instagram's terms (§5.8, OD9). Compared with the H1 insert of AM37 the session is now consistent: + → Story runs `startStoryCreationSession`, so the telemetry has an `enter` event, a non-empty `waterfall_id` and a sane duration.
- **Fragility.** Instagram's msite code is point-in-time (research preamble, "Method limits"). ~~The fallbacks are H0, then export or the phone.~~ Since AM39 every locator fails closed with a named code before Share (`STORY_ENTRY_MISSING`, `INPUT_MISSING`, `ACCEPT_DRIFT`, `INJECTION_IGNORED`, `SHARE_MISSING`), then Finish by hand, export or the phone. Detection is the per-hand-off probe (§3.9) and the C10–C14 facts each run records.

### 2.4 What the owner must decide or accept

| Id | Item |
|---|---|
| OD1 | Accept the residual terms-of-use grey area (required before gate G) |
| L3 | Create and use a secondary account |
| OD2 | Soak length |
| OD3 | Whether H1 is enabled after L6 |
| OD4 | What to do if the composer downscales |
| OD5 | Account type |
| OD9 | Accept the autopilot's synthetic taps (decided 2026-10-13; G5 to re-accept) |
| OD10–OD14 | Setup test, account lock, Facebook cross-post, window focus, human pace (AM39) |

§10 has the details.

---

## 3. Architecture

### 3.0 Verdicts on the lead's preliminary thoughts

1. **"The contract is DOM/UX, not network": agreed, with three corrections.**
   - **The network is part of the contract.** The server classifies the *document request's* UA (§5.1), so the dNR rule must list `main_frame` explicitly: with `resourceTypes` unset, dNR matches everything *except* `main_frame`. Requests made by Instagram's service worker (tabId -1) escape tab-scoped rules (§5.4).
   - ~~**Share belongs to the human.** The extension never reads or clicks it.~~ (Reversed by AM39: the agent taps Share once through its audited helper.) The fake records `event.isTrusted` on Share and fails the test if the click was untrusted.
   - ~~**The fake's Share posts to `/__fake__/stories`**~~ (since AM42 the fake's Share uploads and publishes to Instagram's real paths, as Instagram's client does; the guarded builds' ruleset blocks them), so the write-block ruleset stays on in every guarded build, E2E included. This reverses §8.5's "omit it in e2e", which was only needed because of `route()`. A `share=real-paths` canary knob also fires real-shaped writes to prove the rules block them.
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
| `entrypoints/editor/index.html` + `main.tsx` | Full-tab editor, export, run view, results, History and Settings on one page (AM41; `#settings` and `#history` open the sheet and the drawer). Testable in Playwright |
| `entrypoints/composer-agent.ts` | `defineUnlistedScript`, isolated world. Injected with `scripting.executeScript` into the registered composer tab only. Probes, watch, and since AM39 the autopilot: + → Story, the insert into the armed story input, the compose watch, Share once, and the request observer. Its only `.click()` is the audited tap helper (`src/agent/tap.ts`: +, Story, Share; T3) |
| Later: `render.worker.ts`, `heic.worker.ts` (P4), `video.worker.ts` (V1) | Packaged worker files. No `blob:` workers (§7.4) |

None of these exist: side panel, offscreen document, options page, MAIN-world script. (Since AM37 the background runs one MAIN-world `func`, the portrait shim, with `scripting.executeScript` into the composer tab only; it is not an entrypoint, a content script or a web-accessible resource.)

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
| `chrome.storage.local` | Settings: ~~`accountLabel`, `assistedInsert`, `rehearsal`~~ (removed by AM41), `chMode: 'full'\|'uaOnly'`, `composerProfile`, stricter rate caps, `accountLock`, `keepCopies`, `onboardedAt`. Background-owned keys (written only from its effect queue, AM25): `msiteLock`, `msiteLockReasons` (AM43), `expectedAccount`, `lastTestPassAt`, `menuFingerprint`, `lastResult`, `rateLog`, `composerWindow` |
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

**Since AM39–AM41** the messages are those of `docs/ux.md` IP1–IP3 (`src/shared/protocol.ts`): the editor sends `handoff/start {exportId|null, mode: post|test|shareTest|check, screen, browser, queue, exportSample?, exportSha256?, docHash?}`, `handoff/cancel`, `handoff/account-choice`, `handoff/manual`, `handoff/mark`, `handoff/enable-msite`, `ui/open-instagram`, `ui/forget-account`, `ui/use-account` (AM43), `ui/result-seen` (no `handoff/outcome`); the background answers with `handoff/status` and `handoff/lane`; the background drives the agent with `agent/probe`, `agent/watch`, `agent/drive {step: open-entry|insert|compose|share}` and `agent/observe` (no `agent/inject`); the agent answers with `agent/report`, `agent/get-file` (only while inserting, after the insert command), `agent/event` and `agent/fact` (entry, inserted, insert-failed, compose, share-done, share-refused, net, ui, visibility, owner-share), each accepted only in the phases that expect it. The table below is the pre-AM39 contract.

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

**Sequence** (each step is an effect emitted by `handoffReducer`). Since AM39 steps 7–9 are the autopilot's (`docs/ux.md` §3, §10): after the probe, the account decision (§4.8; a prompt only when the account differs, cannot be read or none is expected), then `openingEntry` (+ → Story), `inserting` (the photo into the armed story input), `composeReady` (the photo drawn, one Share control settled; a Test run ends here), `sharing` (Share once), `confirmingUpload` (AM40), `finished`. The window is docked at the right edge of the editor's screen and focused (OD13). The 15-minute inactivity close is gone: per-step budgets and a 2-minute pre-Share cap instead, and 15 minutes only while an upload may still run. "Posted?" is gone (AM40).

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

**Superseded by AM39 (2026-10-13).** The file goes only into the story input that Instagram's own + → Story armed in this document: the agent taps + (one re-tap if no menu appeared), then the Story item of the new menu dialog (chosen by the stored fingerprint, else by one trial: a wrong item only clicks the post input), sees the story input receive Story's `click()` (Chrome refuses the chooser without user activation), waits a human dwell, asks `agent/get-file`, assigns the `File` through `DataTransfer` and dispatches `input` and `change` (AM3). Every tap first checks that the page has no user activation (R22) and is visible. Then the compose watch waits for the drawn canvas and a settled Share footer, and Share is tapped once. The direct insert below (H1) and the manual pick (H0) are gone; H0's instructions survive only in Finish by hand. The pre-AM39 text follows for the record.

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
   | C9 | Composer left | URL leaves `/create/story`, or the C6 canvas is gone for more than 2 s. **Diagnostic since AM40**: going home after Share is recorded (`wentHome`) and only corroborates; the result comes from Instagram's publish answer |
   | C10 | + entry and menu (AM39, unverified L18) | The story input (C4), its `form`, and the one pressable with an svg in the previous sibling box (up to 4 ancestors); after a tap of +, a new visible `[role=dialog]` with exactly two outermost pressables (Story and Post); a third is `MENU_DRIFT` |
   | C11 | Story armed | The story input receives Story's `click()` within 3 s (Instagram's `startStoryCreationSession` ran; a landscape viewport refuses it: `LANDSCAPE`, "story session refused") |
   | C12 | Share control | `canvas._aa3c` drawn (backing store > 0), `header._aa3d`, no landscape snackbar `._aa3b`, exactly one visible Share footer (not the trash footer `_aa3k`) holding one `button` (v1) or `[role=button]` (v2; an svg badge = automatic Facebook cross-post), quiet for 1.5 s (cap 8 s); structural fallbacks for every class |
   | C13 | Outcome endpoints | XHR/fetch resource entries after the Share click: the upload `i.instagram.com/rupload_igphoto/fb_uploader_<digits>` and the publish `www.instagram.com/api/v1/media/configure_to_story/` (status, content type, redirect; AM40) |
   | C14 | Account (unverified L18) | The one navigation link to `/<username>/` holding an img or svg, outside `article`; `^[A-Za-z0-9._]{1,30}$`, reserved first segments rejected |

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
| `STORY_ENTRY_MISSING` | AM39: + → Story not as expected (no entry, no menu, a third item, neither item armed, a tap refused) | Stop tapping; offer Finish by hand (window kept 60 s, posts only) |
| `SHARE_MISSING` | AM39: the photo is in the composer but not exactly one Share control | Nothing pressed; offer Share it myself (Finish by hand) |
| `WINDOW_IN_USE` | AM39: the page kept user activation (the owner clicking in it) for 6 s before a tap | Nothing tapped; offer Finish by hand |
| `WINDOW_HIDDEN` | AM39: the page stayed hidden 10 s after one raise | Close |
| `ACCOUNT_UNCONFIRMED` | AM39: the account prompt was not answered within 60 s | Close |
| `UPLOAD_FAILED` | AM40 O2/O4: Instagram answered that the upload or the publish failed | Not posted; close after 3 s; never retried |
| `OUTCOME_UNKNOWN` | AM40: Share was pressed and the evidence is neither a clear yes nor a clear no | Couldn't confirm; held up to 15 min while an upload may still run, else close after 3 s |
| `TEST_LEAK` | AM40 O10: a test's publish request (or a 2xx upload) went through | Kill and lock |

Since AM39 `INPUT_MISSING`, `ACCEPT_DRIFT` and `INJECTION_IGNORED` no longer degrade to H0: in a post they keep the window 60 s and offer Finish by hand (a test closes it). Any error after the Share command is Couldn't confirm unless AM40's rules decided; a kill after a Posted keeps Posted and locks.

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
| `live` | `pnpm run build:live` (`INSTAPOST_LIVE=1`) | `.output/chrome-mv3-live` | "instapost", plain, `keys/live` | **No**; ~~rehearsal rules per hand-off~~ the write-block rules for every Test run, Share test and check (AM41) | Ignored (shows a banner) | Branded Chrome profiles, by hand; **and** sealed Playwright profiles |

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
| SG5 | ~~Rehearsal~~ Test modes (AM41) | Tab-scoped rules 1002–1019 (`tabIds:[tab,-1]`) from the same endpoint list, installed for every `test`, `shareTest` and `check` (writes are blocked whenever `mode !== 'post'`, and always in guarded builds by SG3). A Test run stops before Share; a Share test presses it only after the background verified the rules are installed for the tab; any publish request or 2xx upload in a test is `TEST_LEAK` (kill and lock) | **E9, E30, E31 on the live artifact before the first live Share test (L19)**; U18, U19 |
| SG6 | ~~The human clicks Share~~ Audited taps (AM39) | One tap helper (`src/agent/tap.ts`) holds the agent bundle's only `.click()` and only `click` listener (capture, observation); it taps +, the Story item and Share only, with budgets (+ ≤ 3 per document, Story ≤ 2 and Share 1 per hand-off, Share only with the background's token), containment, path, no user activation and a visible page. T3 fails the build on any other click site or constructed input event. The fake records every control's `isTrusted` and flags `DOUBLE_SHARE`, `RETRY_CLICKED` and `TAP_OUTSIDE_ALLOWLIST` | E11, E18, T3, U22, B14 |
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
| Share | Instagram uploads to rupload and `configure_to_story` (§5.3) | **Since AM42:** an XHR upload to `i.instagram.com/rupload_igphoto/fb_uploader_<id>` and an XHR publish to `/api/v1/media/configure_to_story/`, answered per the `rupload`/`configure` knobs; a story only for a published upload id. Before AM42: POST `/__fake__/stories` with the canvas JPEG plus metadata; records `isTrusted`; SPA-navigates to `/`. With `share=real-paths` it also fires no-cors POSTs to `i.instagram.com/rupload_igphoto/fb_uploader_<t>` and `/api/v1/media/configure_to_story/` | `share=fake\|real-paths` |
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
| U18 | `src/core/handoff/outcome.test.ts` (AM40) | Every O1–O10 row on the spike's entry shapes; never `posted` for a redirect, HTML, status 0 or a 5xx; the duplicate alarm; the write-blocked branch; `nothingPosted` in every phase |
| U19 | `reducer.test.ts`, autopilot (AM39–AM41) | The chain probe → account → `openingEntry` → `inserting` → `composeReady` → `sharing` → `confirmingUpload` → `finished`; exactly one Share command across re-injection, a new document and a worker restart; no Share in `test`, none in `shareTest` without verified rules; the account prompt and its timeout; the queue; Stop only before Share; a window closed after Share is `unknown`; the hold and a late answer; Finish by hand; `offer-manual`, `hold`, `kill`; a kill after O1 keeps Posted; a hidden page raised once (E41's case) |
| U20 | `src/ui/run-steps.test.ts` | `stepsFrom` for every mode and failure step |
| U21 | `src/ui/copy.test.ts` | Copy for every error code; "Nothing was posted" never reachable after Share; no Meta-host URL; no Instagram UI strings beyond +, Story and Share |
| U22 | `tools/bundle/patterns.test.ts` | T3's click rules: one `.click()` inside the tap helper, one capture `click` listener; two click sites, a click outside the helper, a listener without capture, `el["click"]()` and a constructed `MouseEvent` all fail |
| U23 | `window-fit.test.ts` | `docked()` on the MacBook, the ultrawide at negative offsets, a small screen and zoom ≠ 1 |
| U24 | `rate-guard.test.ts`, `lane.test.ts` | Spacing-only queueing; the hour and day caps; `laneOf` priorities |
| U25 | `account.test.ts` | Handle validation, reserved segments, `accountDecision` in every case and mode |
| U26 | `src/ui/history.test.ts` | The duplicate guard by SHA-256 and docHash within 24 h (K8, K12) |
| U27 | `tools/fake-ig/core.test.ts` (amends U16) | The upload and publish routes, the CORS preflight echo, server truth (one story per upload id), the new knobs, `deriveKnobs` with the autopilot's baseline facts |
| U28 | `settings-state.test.ts` | Migration ignores `accountLabel`, `assistedInsert` and `rehearsal`; the setup gate follows `lastTestPassAt` |
| U29 | `src/agent/agent.test.ts` | `findEntry`, `pressables`, `glyphHash`, `composerState`, `readAccount`, the tap budgets and guards (node DOM fixtures) |

**Browser (Vitest browser mode):**

| Id | File | Asserts |
|---|---|---|
| B1 | `src/raster/rasterize.browser.test.ts` | Calibration source (generated in-test) under cover: the corner fiducials land on exact pixels. Contain leaves background bars. Rotating 90° moves markers as expected |
| B2 | `raster/export.browser.test.ts` | JPEG is 1080x1920 `image/jpeg`; a noise image steps down to 8 MB or less; there is no APP1 `Exif` segment. PNG is 1080x1920 |
| B3 | `raster/fonts.browser.test.ts` | Instrument Sans loads from the bundled woff2. An unloaded font id throws `FONT_NOT_LOADED` |
| B4 | `raster/text.browser.test.ts` | The canvas measurer's line count equals the layout's; highlight-box pixels sit behind the glyphs |
| B5 | `raster/decode.browser.test.ts` | JPEG, PNG and WebP blobs (generated) decode; the proxy is at most 2160 px |
| B6 | `src/agent/agent.browser.test.ts` | Mounts the fake `StoryComposer` (React 19). The probe finds the story input by accept set and ignores the post input. Inject fires React `onChange` and the canvas mounts. `trusted=require` gives `inject-ignored`. `locale=es` and `drift=renamed` give identical results. The C8 read matches `dataset.fakeGeometry` |
| B11 | `src/agent/drive.browser.test.ts` (AM39) | On the fake's `MsiteShell`: + → menu (both orders) → Story → armed → insert → composer; the trial path; `menuItems=3` gives `MENU_DRIFT` |
| B12 | `src/agent/net.browser.test.ts` (AM40) | The request observer under `clearResourceTimings()`; `responseStatus` and `contentType` for 200, 400, 500, a 302 to HTML and status 0 |
| B13 | `src/agent/compose.browser.test.ts` | `composerState` and the settle on the fake composer: v1 → v2, `fbAuto`, the landscape snackbar; Share once |
| B14 | `src/agent/tap.browser.test.ts` | The tap helper's guards: hidden, wrong container, budget, and `userActivation.isActive` after a real click all refuse |

**Static** (`scripts/check-bundle.ts`, run after the builds):

| Id | Asserts |
|---|---|
| T1 | Manifest snapshot per mode, as §5 lists |
| T2 | `rules/block_ig_writes.json` and the `declarative_net_request` key are present in mock and absent in live; the JSON equals `blockRuleset()` |
| T3 | Forbidden patterns. **Every bundle:** `signed_body`, `ig_sig_key_version`, `x-ig-`, `x-csrftoken` (case-insensitive), `chrome.debugger`, `world:"MAIN"` or `world:'MAIN'` (since AM37: except exactly once in `background.js`, the portrait shim's `executeScript`), `fakeGeometry`, `data-testid="fake-`. **`composer-agent.js`:** `.click(`, `MouseEvent`, `PointerEvent`, `KeyboardEvent`, `DragEvent`, `TouchEvent`, `setFileInputFiles`, `fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `storage.`. **`rupload_ig` and `configure_to`** may appear only in `background.js` and `rules/*.json`. **`src/`:** no `fake-` test ids outside `tools/` and `tests/` |
| T4 | `tsc -p src/core` passes; `src/core` contains no `chrome.`, `browser.` or `document.` |
| T5 | `.output/chrome-mv3-mock` and `.output/chrome-mv3-live` exist (WXT's default `{{modeSuffix}}`); the three key-derived IDs are distinct |

**E2E** (Playwright; `mock` and `live` projects unless noted; `@smoke` also runs on CfT 155):

| Id | Spec | Asserts |
|---|---|---|
| E1 `@smoke` | `00-seal` | `www.facebook.com`, `static.cdninstagram.com`, `graph.instagram.com` and `example.com` fail with `ERR_NAME_NOT_RESOLVED`. The fake health page loads with no interstitial and no permission prompt |
| E2 `@smoke` | `00-seal` | The extension service worker is up, its ID equals the key-derived ID, and its manifest name matches the project |
| E3 | `editor` | Load a generated 4000x3000 JPEG, pan, zoom, add text, toggle safe zones. The export decodes to 1080x1920 and a download item is `complete` with bytes > 0 (`sw.evaluate(downloads.search)`) |
| E4 | `handoff` | Probe mode: (since AM42: see the rows below and AM42) the popup opens, C1–C8 are reported, the window closes, no file is set and no story is recorded |
| ~~E5~~ `@smoke` | `handoff` | Struck (AM42): moved to E29. H1 happy path with `geometry=fixed:1080x1920`. The composer **document** request (`sec-fetch-dest: document`) carried the Android UA, `sec-ch-ua-mobile: ?1`, `sec-ch-ua-platform: "Android"` and no high-entropy hints. The human clicks Share; exactly one story with `isTrusted: true`; PSNR against the PNG export is at least 38 dB. Phase reaches finished; `getSessionRules()` is empty after the window closes |
| ~~E6~~ | `handoff` | Struck (AM42): moved to E40. H0 with assisted insert OFF: the instructions show; the human taps + → Story and picks the export; the story is recorded |
| E7 | `handoff` | Scoping: during a session, a second normal tab to `https://www.instagram.com/` gets the desktop shell (Mac UA in the log, `is_mobile:false`) |
| E8 `@smoke` | `canary` (mock only) | (Superseded by the E8 row below, AM42.) `share=real-paths`: writes 0; story still recorded; `onRuleMatchedDebug` fired. A fetch to `rupload_igphoto` from the extension service worker and from a page is blocked (`ERR_BLOCKED_BY_CLIENT`) |
| E9 `@smoke` | `canary` (live only) | (Superseded by the E9 row below, AM42.) Rehearsal OFF with `share=real-paths`: 2 writes arrive, so live does not block. Rehearsal ON: 0 writes, the story is still recorded, an extension-service-worker fetch (tabId -1) is blocked during the session, and after close a new non-rehearsal session has no stale block |
| E10 | `handoff` | `marker=off`: mock gives `GUARD_NOT_FAKE` (window closed, nothing injected, no story); live proceeds. With the marker on, live shows `handoff-banner` "FAKE INSTAGRAM" |
| E11 | `tripwire` | Meta-test: (since AM42: see the rows below and AM42) an untrusted Share dispatched with `page.evaluate` appears in `fake.violations()`, and the invariant helper throws |
| E12 | `failure-matrix` | One test per knob: (since AM42: see the rows below and AM42) (a) `sw=desktopShell` → after the hard reload the page is mobile and uncontrolled, and afterwards a normal tab still gets desktop; (b) `sw=claimLate` → `SW_TOOK_CONTROL`; (c) `auth=out` → `NOT_LOGGED_IN`, no lock; (d) `auth=challenge` → kill, then the next start gives `MSITE_LOCKED`, and `ENABLE` re-enables; (e) `offhost=afterReady` → kill; (f) `trusted=require` → `INJECTION_IGNORED` → H0 with exactly one inject; (g) `listen=drop` → same as (f); (h) `input=afterTap` → H0; (i) `route=homeOnly` → H0 with the "tap + → Story" text; (j) `accept=changed` → `ACCEPT_DRIFT` → H0; (k) `classifier=client-hints` → still mobile; (l) `locale=es` → same outcomes as `en`; (m) `drift=renamed` → unaffected |
| E13 | `geometry` | (since AM42: see the rows below and AM42) For `viewportDpr`, `source`, `fixed:1080x1920` and `cssFixed:360x640`, the agent's C8 report equals the fake's ground truth. A popup forced to landscape is refitted once |
| E14 | `handoff` | A second start within 60 s gives `RATE_LIMITED` and opens no window |
| E15 | `handoff` | Closing the popup mid-flow removes the session rules and resets the state to idle; the next session starts cleanly |

**E2E since AM39–AM42** (the autopilot; `mock` and `live` unless noted; a Post story in a guarded build always ends as a Share test, because SG3 blocks the upload, so "Posted" is proven on the live artifact against the fake). E16–E28 are defined in §11 (AM21–AM38) and were rewritten for the autopilot (AM42).

| Id | Spec | Asserts |
|---|---|---|
| ~~E5~~ | — | Struck: the post is E29 (its UA, client-hint and PSNR assertions moved there) |
| ~~E6~~ | — | Struck: Finish by hand is E40 |
| E4 | `handoff` | Check connection (was probe mode): C1–C8 and the account read and learned, nothing tapped, closed |
| E8 `@smoke` | `canary` (mock) | A Post story: the static ruleset blocks Instagram's upload (`onRuleMatchedDebug` names `block_ig_writes`), no session block rule, no publish, `shareTested`; both write paths blocked from another tab and from the extension's worker |
| E9 `@smoke` | `canary` (live) | A Share test's rules `[tab, -1]` block the upload and an extension-worker write; the next Post story has no block rule, both writes arrive, Posted |
| E11 | `tripwire` | A second Share, a Retry and a Save from page script are `DOUBLE_SHARE`, `RETRY_CLICKED`, `TAP_OUTSIDE_ALLOWLIST`; the invariant check throws; the run records `DUPLICATE_UPLOAD` |
| E29 `@smoke` | `autopilot` (live) | Post story, both menu orders: Posted from a 2xx JSON publish; one story; the story session started (uuid `waterfall_id`); no violation; window closed; Android profile on the wire; PSNR ≥ 38 dB; no session rule left. Mock: the same click ends `shareTested` |
| E30 | `autopilot` | The setup test from a fresh install: no upload; `tested`; account, fingerprint and `lastTestPassAt` stored |
| E31 | `autopilot` | Share test: rules `[tab, -1]`; Share pressed once; the upload blocked (status 0); Instagram's failure toast; `shareTested`; no story. (b) the rules gone before the composer: the background's check catches it (`AGENT_UNREACHABLE`), Share never pressed. (c) the rules removed after that check: live `TEST_LEAK`, killed and locked; mock still blocked by the static ruleset |
| E32 | `outcome` (live) | configure 400 → `UPLOAD_FAILED`; 500, reset, html200, redirectLogin → `OUTCOME_UNKNOWN`; rupload 500 and cors → `UPLOAD_FAILED`; `tray=throw` → Posted; one upload, Retry never tapped |
| E33 | `entry` | `trusted=require` → `STORY_ENTRY_MISSING` (no menu, one re-tap), Finish by hand offered; `menuItems=3` → `STORY_ENTRY_MISSING`; no fingerprint, Post first → one wrong item, then Story, fingerprint stored; with it → Story at once |
| E34 | `entry` | The owner's click in the window before + → Story: the autopilot waits for the activation to lapse, no file chooser; clicking on → `WINDOW_IN_USE` |
| E35 | `outcome` | `fb=auto` after a delay → v2 with the badge, `share_to_facebook=true`, the result line; `shareControl=missing|two` → `SHARE_MISSING`, nothing pressed, Share it myself |
| E36 | `entry` | Another account: the prompt before any tap; Cancel → stopped; confirm → carries on and remembers; unreadable → its prompt; no answer → `ACCOUNT_UNCONFIRMED` after 60 s (mock) |
| E37 | `outcome` (live) | `rtClear=on` during a 2.5 s upload: decided correctly |
| E38 | `outcome` (live) | A challenge after a published story: Posted plus `KILLED_CHALLENGE` and the lock |
| E39 | `run` | A post within 60 s is queued (K10 → K11) and starts by itself; Cancel while queued opens nothing |
| ~~E41~~ | — | Struck from E2E: headless Chromium keeps a minimised popup's page visible; U19 (the reducer), U11 (the runner raises the window, focus only, once) and L23 cover the raise |
| E40 | `entry` | Finish by hand after `STORY_ENTRY_MISSING`: the owner's trusted + → Story, pick and Share; instapost only observes; the result from the requests, no question |
| E42 | `run` | Stop before Share → stopped, nothing tapped after it; the window closed before Share → stopped; closed after Share → Couldn't confirm (window closed), then K8 until "It didn't post" |
| E43 | `run` (live) | The same story after Posted → K12 "Post again"; another edit → a new story |

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
- [ ] ~~**L6**~~ (moot since AM39: no direct insert) Assisted-insert check: rehearsal ON, H1 ON, one attempt with the calibration card. Does C6 (composer ready) appear? No Share. If not, H0 stays the default and OD3 is moot. Since AM37: the insert never starts msite's story session (its session id stays null), so H1 stays off in live until a real post after an insert works (after L17).
  - Write into `baseline.json`: `untrustedInsertAccepted` (`true` if C6 appeared after the insert; `false` on `INJECTION_IGNORED`, and note whether the photo was visible in the composer anyway, AM28) and, if it can be observed, `fileEvent` (`change` or `drop`). Then update the fake's defaults via `deriveKnobs` and get U16 and E12 (f) green, as in L4.
- [ ] ~~**L7**~~ (replaced by L19 since AM39) *Only if L5 left the output size ambiguous:* **one** rehearsal Share click, which the rules proven in E9 block. Read `upload_media_width/height` in DevTools if a blocked request shows its headers. Never repeat it; note any client retries or error toasts.
- [ ] **L8** (for the autopilot L20 supersedes it; its phone checks apply there) First real post on the secondary, with rehearsal switched OFF: the owner clicks Share, H0 or H1 per L6, with a PNG hand-off.
  - Check on the phone: size, crop, sharpness and colour against the export.
  - Screenshot it to calibrate P10.
  - Delete it.
  - On another day, post one JPEG-0.95 hand-off to compare.
- [ ] **L9** Phone lane: export a frame with a music placeholder, send it to the phone, add the Music sticker in the app on the secondary. Check the placeholder geometry and the duration. Post and delete, or discard.
- [ ] **L10** Soak (OD2): by default at least 10 desktop posts over at least 14 days, at most 1 a day, at varied times. Review Login activity, security emails and Accounts Center weekly (research Q5).
- [ ] **L11** After every Chrome major update, and monthly: rerun L2 and L4 (probe only).
- [ ] **L12** (optional, feeds OD5) On the secondary account, open "Switch to professional account" and read the consequences (privacy, music) **without confirming**.
- [ ] **L13** (Arc, added 2026-10-12, AM29–AM35) Load the live build in Arc through `arc://extensions` (Developer mode, Load unpacked; Remove and load again after a manifest change); check the editor's brands and `--arc-palette-*` in its console. No Instagram.
- [ ] **L14** (Arc) **Probe composer**, rehearsal ON: the window becomes narrow and tall before Instagram loads (or the owner drags it, guided by the panel); the panel shows Page `/ (home…)`, Browser Arc, Story input `present`, a viewport at most 767 wide and portrait, Service worker "controls the page — normal on Instagram". Record C1–C5 and the Window row. A Story input `none …` (after the probe's 6 s input wait, AM36) is inconclusive until L15.
- [ ] **L15** (Arc) First H0 rehearsal: rehearsal ON, assisted insert OFF, + → Story in the Instagram window, pick the calibration card, composer ready with the photo, no Share; Cancel. Record C8. *2026-10-12, second run:* the composer showed "Rotate your device to add to your story." instead of Share in a fitted portrait window (it reads the screen's orientation, AM37); L16 repeats it with the portrait shim.
- [ ] **L16** (Arc, added 2026-10-12, AM37) L15 again on a build with the portrait shim: composer with its Share footer, no rotate snackbar; Screen row `portrait-primary (portrait shim in place)`; record `preflight.C3b`, the Screen row and C8; a `SCREEN_LANDSCAPE` means the shim did not take effect in Arc: record its detail and stop.
- [ ] **L17** (Arc, AM37) First real post in Arc with the shim, H0: rehearsal OFF, assisted insert OFF, + → Story and pick by hand, the owner taps Share; as L8 (held open until "Posted?", check on the phone, P10 screenshot, delete). Record the outcome and the Screen row.

- [ ] **L18** (autopilot, AM39) The setup test (Test run, Share never pressed): C10 menu structure (count, order, Story index, glyph hash), C11 armed time, C12 footer variant and Facebook badge, C14 account (exactly one candidate), no file chooser, the photo drawn. Expect Test passed, nothing on the profile; write `menuOrder`, `menuItemCount`, `shareFooter` into `baseline.json`.
- [ ] **L19** (AM40) The Share test, once ever: Share pressed, the upload entry with status 0, Instagram's failure toast, no publish request. Expect Share test passed.
- [ ] **L20** (AM39, AM40) The first one-click post: the publish entry (status, `application/json`, no redirect), the upload status (200 visible through CORS?), went home, the toast. Check on the phone (once, no duplicate), then delete it. Write `configureContentType`.
- [ ] **L21** L18 with Instagram in Spanish; L20 in Spanish on another day.
- [ ] **L22** The account lock: with another account logged in, a Test run pauses with the account prompt before any tap; Cancel.
- [ ] **L23** Arc behaviour: the focused docked window stays in front; clicking the editor mid-run raises it once; closing it after the photo is in the composer shows no "Leave site?" prompt; ⌥⇧S, ⌘↵ and ⌘O reach instapost.

### G: gate before the primary account

- [ ] **G1** L10 complete with no warnings, challenges or unusual security emails.
- [ ] **G2** The last 5 preflights all passed; crop loss is 0.5% or less; OD4 decided.
- [ ] **G3** (since AM39 also: the outcome rules proven on the fake, E29–E43, and the test modes' blocks on the secondary, L18, L19) The kill switch is proven on the fake (E12 d, e). Rehearsal is proven on the fake (E9) and on the secondary (nothing posted during L5–L7).
- [ ] **G4** The phone lane has been used end to end (L9).
- [ ] **G5** (re-accepted for OD9 since AM39) The owner explicitly accepts the residual terms-of-use grey area (OD1).
- [ ] **G6** The everyday profile holds only the live build; guarded builds were never loaded there.
- [ ] **G7** ~~The account label in the everyday profile is set to the primary's handle.~~ Since AM39: `expectedAccount` (detected by the setup test, L18) is the primary, with "Only post as" on. First primary post, then normal use under the rate guard.

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
| R1 | Instagram flags or restricts the primary because of the spoofed msite session | Low to medium (unverified); unchanged or higher since AM39 (unverified) | High | Tier 1 only; ~~the human clicks Share~~ audited taps of +, Story and Share only, Share once, human-paced dwell, no retries (AM39); secondary soak and gate G; Android header profile; no login in the spoofed tab; rate guard; kill switch; stable IP; authenticator 2FA | Kill-switch URLs; weekly Login activity review; security emails |
| R2 | Trouble on the secondary spreads to the primary | Unknown | High | Separate Chrome profile; secondary kept out of Accounts Center. Shared phone and IP are acknowledged; isolation is partial | The same reviews on both accounts |
| R3 | The msite composer is removed or changes its route, input or accept list | Medium over a year | Medium; the phone lane keeps working | Contract module; fake knobs for both outcomes; H1 → H0 → export ladder | Per-hand-off preflight; L11; `contract:check` |
| R4 | Classification moves off the UA header (client hints or JS) | Low to medium | Medium | The profile already sends mobile client hints; the `classifier=client-hints` knob keeps that path tested | C1 `is_mobile` false → `DESKTOP_SHELL`; `contract:check` |
| R5 | Instagram's service worker serves a desktop shell, or takes control mid-session | Medium | Low to medium | Hard reload; controller check; `controllerchange` abort; rehearsal rules also cover tabId -1 | Probe; E12 a and b |
| R6 | The composer downscales or crops the image | Medium to high on the MacBook | Medium (softness) | L5 measurement; window fit; display "More Space"; external monitor; opt-in debugger DPR emulation (OD4) | C8 on every hand-off; crop-loss warning |
| R7 | The composer ignores untrusted events | Unknown | Low since AM39: the autopilot fails closed before Share; Finish by hand and the phone remain | One attempt per step, then `STORY_ENTRY_MISSING`, `INJECTION_IGNORED` or (after Share) Couldn't confirm | L18; E33 (`trusted=require`) |
| R8 | A dev or test build posts for real | Very low | High | SG1–SG11 | E1, E8, E9, invariants |
| R9 | The rehearsal rules fail and rehearsal posts for real on the secondary | Low | Medium | Rules derived from the same list as the static ruleset; E9 on the live artifact; at most one rehearsal Share | E9; DevTools shows the request blocked |
| R10 | A story is posted to the wrong account | Low | Medium | ~~Account label in the panel; human review before Share~~ The detected account (C14) checked before any tap; "Only post as @handle" on by default; a mismatch or an unreadable account asks (60 s, then cancels) (AM39, OD11); one browser profile per account | Account row in Details; L22 |
| R11 | The sealed environment leaks (proxy, resolver semantics, Local Network Access) | Low | High: automation could reach real Instagram | Allow-list, `--no-proxy-server`, `globalSetup` seal precheck, tripwire; dev profiles never logged in | E1; precheck; tripwire |
| R12 | The fake drifts from reality and gives false confidence | Medium | Medium | `baseline.json` drives the knob defaults (U16); L4 and L11 | U16; live preflight |
| R13 | Chrome changes dNR client-hint handling, service-worker bypass or `tab.width` | Low to medium | Medium | `minimum_chrome_version` 155; pinned CfT; `@smoke` on the owner's major | `test:smoke155` on every Chrome major |
| R14 | Libraries using blob workers (HEIC, AAC) break under MV3 | Medium | Low | Packaged workers; spikes P4 and V1 | Spike tests |
| R15 | Blocked test uploads look anomalous in Instagram's telemetry, or get retried by its client | Unknown | Low to medium | The Test run stops before Share; the Share test is rare and deliberate (L19, once); geometry from the probe | L19 notes |
| R18 | Instagram notices the automation: untrusted clicks, no user activation, an extension-built File, short story sessions (AM39) | Unknown | High on the primary | Owner-accepted (OD9); human-paced dwell (OD14); rate guard; kill switch; secondary soak before G | Security emails; Login activity; L18–L20 |
| R19 | A false "Posted" or a double post | Low | Medium | Posted only from a 2xx JSON publish answer without a redirect (AM40 O1); Share once (persisted before it is sent); Instagram's Retry never tapped; the duplicate alarm; K8/K12. Residual: a 2xx JSON answer that created no story (bodies are not read); and Chrome resends a POST whose reused connection was reset before any answer byte (seen against the fake, AM42), invisible to the page: one story only if Instagram's publish is idempotent per upload id (unverified) | E32, E11, U18; the phone |
| R20 | Locator drift (+ menu, footer, account link) | Medium over a year | Medium | Structural locators with fallbacks; every one fails closed with a named code; the menu fingerprint; a test run suggested after drift | C10–C14 on every run; L18 |
| R21 | An upload cut off by closing the window too early | Low | Medium | Windows close only on AM40's schedule; a possibly running upload holds the window up to 15 min | E42; U19 |
| R22 | The owner's own click in the composer window during a run makes a tap open a real file chooser | Low | Low | Every tap waits for `userActivation.isActive` to lapse (6 s), else `WINDOW_IN_USE`; injection only from the background | E34; B14 |
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
| A19 | Instagram's + menu has exactly two items (Story, Post), in a new `[role=dialog]` | `PolarisMobileCreationNavItem` props (the menu module was not readable logged out) | L18 (C10) |
| A20 | The account is the one navigation link to `/<username>/` (`PolarisProfileNavItem`) | Saved bundles | L18, L22 (C14) |
| A21 | `responseStatus` and `contentType` of Instagram's XHRs are readable from the isolated world on the live site, cross-origin too when CORS passes | Spikes on CfT 155 and Chromium 156 against the fake | L19, L20 |
| A22 | The publish answer is `application/json`, not redirected | Saved bundles | L20 |
| A23 | Chrome refuses the story input's chooser without user activation, and the activation guard keeps it so | Spike; E34 | L18 (no chooser opened) |
| A24 | Arc keeps the focused, docked popup in front | Inference | L23 |
| A25 | `windows.remove` shows no "Leave site?" prompt when the page has no user activation | Inference | L23 |

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
| OD9 | Accept synthetic (untrusted) taps of +, Story and Share as the new footprint, moving instapost from assisted to automated use under Instagram's terms (research §5.8). Re-accept G5 before the primary | Decided by the owner on 2026-10-13 ("There should be no interactive steps after posting from the extension"); G5 to re-accept | — |
| OD10 | One setup test (Test run) required before the first autopilot post on an install | Yes / no | Yes |
| OD11 | Account lock on by default; a mismatch or an unreadable account asks before any tap | Yes / no | Yes |
| OD12 | When Instagram would also share to Facebook automatically | Proceed and say so; or stop before Share | Proceed and say so |
| OD13 | The Instagram window takes focus during the run and is raised once if hidden | Yes / no | Yes |
| OD14 | Human-pace dwell between taps (about 6 s per post) | Yes / no | Yes |

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

### Amendments from the first live run (Arc, 2026-10-12)

The first live hand-off (Arc 155 on macOS, live build, new secondary account, rehearsal off, assisted insert off) failed with `DESKTOP_SHELL`: the composer window came out 1512x902 on the owner's ultrawide, msite rendered its wide layout (no + → Story, no story input), the page was controlled by Instagram's worker, and the probe read `isMobile: true` but `swControlled: true` and `portrait: false`. The phases were `opening(0) → scoping(+246 ms) → fitting(+280) → navigating(+298) → reloading(+848) → probing(+3541) → closing`; C1 and C2 passed, C3–C5 failed. The facts established that day (owner experiments in Arc; logged-out reading of Instagram's production code) are F1 (Arc's windows), F2 (Instagram's service worker) and F3 (msite's shape); `docs/contract.md` and `baseline.json` (`provenance`) say which fact comes from where. These amendments override §3.6–§3.10 where they conflict.

| Id | Amendment | Overrides |
|---|---|---|
| AM29 | **The composer window is fitted, verified and held before Instagram loads (Arc), else the owner resizes it.** (1) `windows.create` passes `state:'normal'` with the bounds, and so does every product `windows.update` (Arc ignored a popup's create bounds and an update without a state, F1). (2) `fitting`, while the tab is still `about:blank`: wait until two `windows.get` reads 100 ms apart agree (at most 1 s); measure the frame delta from the actual window (outer minus `tabs.get` size; Arc's is 0x47) and `tabs.getZoom`; `windowFit()`; `windows.update({state:'normal', …box})`; verify by polling `tabs.get` every 100 ms (at most 1.5 s) that the tab is within ±2 px of the target. Hardening from the Arc research (Arc often ignores the first update and may re-place a new popup up to about 1 s after the create): within that verification the same box is **re-applied at 0/150/300/500/1000 ms** whenever the tab is not fitted at that moment, and a fit counts only once it **still holds 1.1 s** after the first update. One retry, 300 ms later, the same way. **The re-apply and hold schedule is an amendment of W2 ("one update, one retry 300 ms later") made by the implementer; the owner approved it on 2026-10-12 (AM36, AL-4).** Its budget: at most 5 `windows.update` per attempt, 10 before Instagram loads, all on `about:blank`; exactly 1 for the refit (U11 asserts the counts). If it is rejected, `FIT_REAPPLY_MS` and `FIT_HOLD_MS` go, each attempt is one update, and the P4 refit covers a late re-placement at the cost of one wide first load. A tab that is not fitted but usable anyway (at most 767 CSS px wide at its zoom, taller than wide, at least 640 px tall) still navigates. None of this is visible to Instagram; the single refit after the navigation stays one `windows.update` without re-applies or hold, measures the window with one read (no settling) and verifies beside the event queue, so the kill switch is never held up by it (AM36, AL-3). (3) Otherwise phase `resizing`: the editor asks the owner to drag the Instagram window narrow and tall and shows its tab size live (`windows.onBoundsChanged` plus a 1 s poll; e.g. "1512×902 ✗", "524×965 ✓") with a countdown and Cancel; it carries on by itself on the first usable size; after 3 minutes `WINDOW_NOT_FITTED` (close, phone fallback; Instagram was never loaded). (4) The record's `window` holds the screen, the requested and created boxes, every update with its target, result and `applied` count, the attempts, `manualResize`, the final tab size, the frame delta and the zoom (structural numbers only). (5) Guarded builds only: the E2E window-quirk shim (`storage.local __e2eWindowQuirk`: `arc` = the create ignores the bounds and the first update, updates without `state:'normal'` or within 400 ms of the create are dropped; `arcLate` = honoured, then re-placed at 1512x949 after 500 ms; `ignoreAll` = every product update dropped) and `__e2eResizeTimeoutMs`; check-bundle T3 proves the live bundle contains neither. Specs act as the owner with `chrome.windows.update` from the extension service worker, which the shim never sees. Headless E2E can emulate the owner's two displays (`--screen-info={MacBook}{ultrawide at 1512,-428}`, spike S11, CfT 155 and Chromium 156). Specs E20 (a), E21 (b), E22 (c), E26 (i) | §3.6 steps 1 and 3; §7.10 window fit; §3.10 (new `WINDOW_NOT_FITTED`) |
| AM30 | **Instagram's service worker is normal; only interception is fatal.** F2: every logged-in load re-registers the root worker at `/www-service-worker.js?s=push&__d=www&enableAddToHomeScreen=<is_mobile>&zenon_device_id=<id>`; a different URL installs a new worker that calls `skipWaiting()` and, on activate, `clients.claim()` (and disables navigation preload), so the composer is controlled within about a second on every hand-off. It has no fetch handler, so the page's requests stay tab-attributed and covered by the tab-scoped rule 1001. Therefore: `swControlled` is diagnostics only (`DESKTOP_SHELL` is decided by `is_mobile` alone: `false` on the first probe, anything but `true` on a strict re-probe); `controllerchange` is counted on the record (`swControllerChanges`) and `SW_TOOK_CONTROL` is no longer emitted; rule 1001 stays tab-only (`uaRule` keeps its RangeError for tab −1; the rehearsal rules keep `[tab, -1]`). The **tripwire** replaces the control proxy: a www/i.instagram.com `PerformanceResourceTiming` with `workerStart > 0`, or the navigation entry's `workerStart > 0` when its type is not `reload`, means a worker handled the page's requests: new fatal code `SW_INTERCEPTS` (close, no lock), from the probe (`swIntercepted`, `navType` on the report) or from the agent's watch (`sw-intercepted`). The watch also keeps a `PerformanceObserver({type:'resource', buffered:true})` from the agent's start, because a page's resource-timing buffer stops growing at 250 entries; the agent never resizes it. Cross-origin entries without `Timing-Allow-Origin` report `workerStart` 0 (a documented blind spot; the same-origin www entries suffice). Verified in Chromium: `workerStart` stays 0 under a worker without a fetch handler and is > 0 under one with it (browser test; E23 and E12 a/a2 on the fake) | AM2 (control as `DESKTOP_SHELL`); §3.6 steps 5 and 8; §3.10 `DESKTOP_SHELL`, `SW_TOOK_CONTROL` |
| AM31 | **The composer must be at most 767 CSS px wide.** F3: msite renders its mobile header (with + → Story and the story input) only up to IGDS `nav-bottom-screen-max`, 767 CSS px; at 768 px and more there is no create entry at all (the live run at 1512 px had no file input). `MSITE_MAX_CSS_WIDTH = 767` (contract.ts): `windowFit()` caps the inner width at 767 × the tab zoom (as well as 9:16 and the screen), and probe row 5 requires `inner.w ≤ 767` **and** portrait, else one refit (which targets ≤ 767), else `LAYOUT_TOO_WIDE` (still too wide) or `LANDSCAPE`. C4 is recorded `unknown` when the decision stopped before it. E24 (f) | §3.6 step 7 row "Not portrait"; §7.10 window fit; §3.10 (new `LAYOUT_TOO_WIDE`) |
| AM32 | **The story input lives behind + on home; `/` is the normal landing.** F3: `/create/story/` without media lands on `/` (route `homeOnly`), which is Instagram's normal outcome, not drift: C5 still records the fact (`fail` = not reachable directly) but nothing degrades because of it. The story input is the hidden `<input type=file accept="image/avif,image/jpeg,image/png">` of PolarisImageFileForm beside the header's + / Story entry, present whenever that entry is rendered. Picking a file there starts msite's story session (portrait check: `innerHeight < innerWidth` → "Rotate your device") and SPA-navigates (pushState) to `/create/story/` with the composer; HEIC is desktop-only. So: (1) on `/` the input may mount after hydration: the first probe that reaches C4 and finds no input waits once, up to 6 s, for the agent's `input-appeared`, then probes once more before it decides (a same-document load during the wait resumes it); since AM36 that holds for H1, for H0 with H1 off and for the probe mode alike, so C4 never comes from a snapshot taken before hydration; (2) H1 inserts into the header input; the insert's SPA navigation is a same-document load (AM16), so `injecting` resumes and `composer-ready` lands; an insert made on home engages the composer only once the tab shows `/create/story`; (3) H0's text on home: "Instagram opened its home page, as it usually does. In the Instagram window tap + → Story, then pick …". E25 (h), E6 (g) | §3.6 steps 4 and 7 (H0 text); §3.8 H1 step 3; §3.9 C5; AM18 |
| AM33 | **Panel labels say what was seen.** The Story input row comes from the pure `storyInputText()`: `none (no file input on the page)`, `none image-only (file inputs: …)`, `present`, `present, accept list differs: …` (the words "accept list changed" only for a decided `ACCEPT_DRIFT`), plus ` (not checked: stopped before this step)` when the decision never reached C4 (the live run's "absent (accept list changed)" was both wrong and misleading). New rows: Page (path, and "home: Instagram's usual landing" for `homeOnly`; the deciding status carries the route even when it is sent from `closing`), Window (inner size asked against reached, attempts, re-applied updates, resized by you, refit, created box when it differs), Browser, Service worker ("controls the page — normal on Instagram" or "intercepts requests"). The guided resize (AM29) has its own block with the live size and the time left. Test ids `handoff-resize`, `handoff-resize-size` (`data-ok`, `data-w`, `data-h`) and `data-row` on each row | §7.10 hand-off panel |
| AM34 | **Arc is recognised by its page colours, and refused by guarded builds.** Arc 155 reports the same `userAgentData.brands` as Playwright's Chromium (`Chromium 155`, `Not(A:Brand 24` on the owner's Arc; a research claim that Arc copies Chrome's brands does not hold there), but it injects `--arc-palette-*` CSS custom properties on page roots, the editor's own included. The editor detects the flavour at start (brands for Google Chrome and Microsoft Edge, then the palette for Arc, else Chromium) and sends it in `handoff/start`; it is recorded on the HandoffRecord (`browser`) and shown in the Browser row. A guarded build refuses `arc` like the branded browsers (`BRANDED_BROWSER`, detail `browser arc`, no window); the live build only records it. A heuristic: nothing else depends on it. E27 | AM23; AM28 (5) |
| AM35 | **The fake has the production shape by default.** `route=homeOnly`; msite's mobile layout (header with + and, beside it, the hidden story input, `input=present`) only while the viewport is ≤ 767 CSS px, re-evaluated live, else a wide layout without any create entry or file input; `hydrateMs` (default 0) delays the header; picking or inserting a file in the header input runs the `listen`/`trusted`/portrait/photo checks and SPA-navigates to `/create/story/` with the composer. `sw=claimOnRegister` (default): every load registers `/fake-sw/claim-on-register.js?enableAddToHomeScreen=<is_mobile>&zenon_device_id=<per-load id>`, a worker with no fetch handler that calls `skipWaiting()` and `clients.claim()`; a page a worker takes control of sends one request (`/fake-static/beacon`), so the tripwire has something to read. The alternatives stay as knobs: `route=direct` (the composer route renders itself), `input=afterTap` (the menu variant), `sw=desktopShell` (hypothetical: a fetch handler that answers navigations with its own desktop-UA fetch and handles every other request, at a stable URL, claiming every page that registers it, so it drives `SW_INTERCEPTS`), `sw=claimLate`, `sw=none`. `baseline.json` gains `swClaimsOnLoad`, `swFetchHandler`, `msiteMaxCssWidth` and a `provenance` map (which facts come from the 2026-10-12 live run, which from the code reading); `route: homeOnly`, `storyInputBeforeTap: true`, `swControlledAfterHardReload: true`, `firstLoadServedBySw: false`; `deriveKnobs` maps them (U16). Specs that need the old shape pin it (`route=direct` for E12 g and i). E12 (a)/(a2) now end in `SW_INTERCEPTS`, E12 (b) is counted, not fatal, E12 (s) is `DESKTOP_SHELL` from client hints with `chMode=uaOnly` (a later SW-served desktop document now trips `SW_INTERCEPTS` first, so the AM2 strict re-probe to `DESKTOP_SHELL` is driven without a worker since AM36: E12 (w)), E12 (t) needs no worker | §6.1; §7.6 knob table; §7.7; AM26 (`preinstallFakeSw` stays off: the default worker registers itself) |
| AM36 | **Review fixes to the Arc changes (2026-10-12).** (1) AL-1/AF-1: the P5 input wait covers every first decision that reads C4 (H1, H0 with H1 off, the probe mode), not only an H1-capable `INPUT_MISSING`; while it runs C4 counts as not reached, so a session that ends during it records `unknown`; when it runs out, the probe that started it decides as it is (C4 `fail`, checked). The watch it starts is no inject; one wait per hand-off. L14/L4: a `none …` after the wait is inconclusive until L15. (2) AL-3: the refit's `measureTab` has `settle: false` (one read) and its `updateWindow` verifies beside the event queue, answering `windowFitted` when it ends; a stale one is ignored. (3) AL-4: AM29's re-apply and hold schedule was approved by the owner on 2026-10-12 (see AM29). (4) AL-5/AF-4: E12 (w) drives AM2's strict re-probe end to end without a worker (`chMode=uaOnly`, then the fake classifies by client hints and the composer document is reloaded): `DESKTOP_SHELL` on home in H0 and after the H1 insert on the composer. (5) AF-2: an interception the watch reports after the probe sets `swIntercepted: true` on the record's probes (so its preflight) and on the closing status; the Service worker row says "intercepts requests" whenever `SW_INTERCEPTS` ended the session. (6) AF-7: the Window row says "refitted once" only when the refit's verification fitted, else "refit not honoured". (7) AF-8: the `resize` status carries `maxW` (767 × the tab zoom), and the instruction names that width when the zoom is not 100%. (8) AF-9: the Page row's note follows the probed path (`/` home, `/create/story…` the composer, "opened from home" when C5 was `homeOnly`), not C5's route alone. (9) AF-10: `DESKTOP_SHELL`'s text no longer claims `is_mobile false`; the detail names what the deciding probe read (`false`, or no flag at all on a later page). (10) AF-5/AF-6: docs point C3/C4 at L14/L15 and the README's Browser row is recorded in every build. (11) E19's simulated extension reload first lets the page's worker claim it and P2's count land: the still-running old worker otherwise persisted that count after `storage.session.clear()` and the new worker kept the popup as a stored session's (a race of the simulation, about 1 run in 6) | AM29, AM32, AM33, AM35; §3.6 step 7; §7.10 hand-off panel |

### Amendments from the second live run (Arc, 2026-10-12)

The owner ran a hand-off with the AM29–AM36 build on a test account in Arc, on the MacBook display. The window was fitted before Instagram loaded (503x894 CSS px at 2x, portrait; `matchMedia('(orientation: landscape)')` false), + → Story opened the chooser, and after the pick `/create/story/` showed the snackbar "Rotate your device to add to your story." instead of its share footer; the same after the H1 insert. `screen.orientation.type` was `landscape-primary`. Instagram's public bundles, read the same day, explain it (research §5.1, §5.2; `docs/contract.md` C3a, C3b, § "Second live run").

| Id | Amendment | Overrides |
|---|---|---|
| AM37 | **The portrait orientation shim, the one MAIN-world script (owner-directed, 2026-10-12).** *Finding.* msite makes two different orientation checks: (i) `PolarisStoryCreationActions.startStoryCreationSession`, called by `PolarisStoryCreationFileForm`'s Story tap **before** the file chooser: `innerHeight < innerWidth` → toast and reject, else `STORY_CREATION_SESSION_STARTED` with a uuid `sessionId` (C3a: the viewport, which the fitted window passes); the H1 insert never runs it (`onFileChange` → `storyCreationSelectMedia`), so its `sessionId` stays null; (ii) `PolarisStoryCreationPage`: `isLandscape` = `viewportOrientation.startsWith('landscape')` from `usePolarisDisplayProperties` (`screen.orientation.type`, else `window.orientation` ±90, else `''`; read at mount via `useState` and on `resize`), only without an orientation `viewportWidth > viewportHeight`; landscape renders `PolarisSnackbar(STORY_LANDSCAPE_WARNING_TEXT)` instead of the header and Share (C3b: the screen, landscape on any landscape monitor whatever the window). AM32's "picking a file runs the portrait check" was wrong: the tap runs (i), the composer runs (ii). *Decision.* (1) **Shim** (`src/agent/portrait-shim.ts`, `src/platform/scripting.ts`): the runner's `injectAgent` first runs `scripting.executeScript({target:{tabId: composerTab, frameIds:[0]}, world:'MAIN', injectImmediately:true, func: portraitShim, args:[install]})`, then the isolated agent: only into the registered composer tab, on every document after the hard reload (and on every same-document load, where it is a no-op), so before the composer page can mount (the owner's pick comes much later). No registered content script, no `web_accessible_resources`, nothing in any other tab. `func` is self-contained and idempotent: only if `screen.orientation` exists and its type does not start with `portrait`, it defines own accessors on that ScreenOrientation instance, `type` → `portrait-primary` and `angle` → 0 (enumerable, configurable), with a symbol-keyed marker (`Symbol.for('portrait-shim')`) on the getter so a re-injection changes nothing; it dispatches no event (Instagram re-reads at mount) and leaves the prototype, `screen.width/height`, `matchMedia`, `window.orientation` and everything else alone. (2) **Its report**: `{type, shim}` with `shim` ∈ `installed`, `present`, `portrait`, `absent`, `failed`, `off`, validated as untrusted page data (`toPageOrientation`) and stamped by the background on each agent report of that document (`ProbeReport.orientation`; the isolated world cannot see the page's getters, and an agent-sent value is dropped). A rejected injection is `AGENT_UNREACHABLE`. (3) **Decision rule** (probe-eval row 5b, reducer `onInjected`): once the composer is reached (a probe on `/create/story…`, or the same-document load of the pick's or the insert's SPA navigation) and the page still reads a landscape type → new error **`SCREEN_LANDSCAPE`** (effect `close`, no lock; detail `screen <type>, portrait shim <state>`); on home it is recorded only. Preflight `C3b` (pass / fail / unknown); `C3` is C3a. Panel: a Screen row (`data-row="screen"`, `data-type`, `data-shim`, e.g. "portrait-primary (portrait shim installed; the screen itself is landscape)") and the error's detail "The composer read …". Reducer protocol v6 (additive): `agentInjected.orientation`, session `pageOrientation`. (4) **Assisted insert stays OFF by default in the live build** (OD3 unchanged), and Settings says why (the insert skips the story session; a second reason, beside L6, that H1 is not the right mechanism on real Instagram); H1 itself stays. (5) **Guarded builds only**: storage.local `__e2ePortraitShimOff` (true) makes the shim read only (`off`); it is compiled out of live (check-bundle T3 `E2E_HOOKS`, with the mock background as positive control). Live and guarded builds both install the shim. (6) **check-bundle T3**: `world:"MAIN"` is allowed only in `background.js`, exactly once, inside an `executeScript(…)` call with `target:{tabId…}`, `frameIds:[0]`, `injectImmediately:true` (the marker no other call has) and a `func`, and without `files`, `allFrames` or `documentIds`; the shim's body (`portrait-shim`) is in `background.js` exactly once; `world:"MAIN"` and the body stay forbidden in `composer-agent.js` and the editor chunks (patterns self-test). (7) **Detectable**: own `type`/`angle` descriptors on the instance, non-native getters, a type that disagrees with the screen's size and the prototype's getter, the marker; it runs with the page's own globals. One more JS-visible inconsistency, scoped to the composer tab (§2.3). (8) **Fake**: knob `landscapeCheck` (`screen`, the default from baseline `composerLandscapeCheck: "screen"`, provenance "live 2026-10-12"; `viewport`, the earlier assumption): the composer computes `isLandscape` from `screen.orientation.type` (else `window.orientation`, else the viewport) when it mounts with the photo and on every `resize`, shows the snackbar (`fake-landscape-snackbar`) and no header and no Share while landscape, and reports each verdict to `POST /__fake__/composer-view` (`GET /__fake__/api/composer-views`, dashboard "Composer views"); + → Story checks `innerHeight < innerWidth` (toast `fake-rotate-toast`, no chooser) and issues a uuid session id; a file in the header input (pick or insert) has no orientation check; the story metadata records `sessionStarted`, `sessionId` and `screenOrientation`. `deriveKnobs` maps the baseline fact (U16). (9) **E2E**: the headless screen is landscape (`HEADLESS_SCREEN_ARGS`), so without the shim no hand-off could share; the fixtures' invariant fails any test whose composer showed its snackbar or whose story was shared from a landscape reading (E28 b opts out). E28 (a) H1: the page reads `portrait-primary` on the landscape screen, Share, posted, `sessionStarted: false`; (b) mock, shim off: snackbar, no Share, `SCREEN_LANDSCAPE`, C3b fail, no lock; live: the flag is inert, posted; (c) H0 by + → Story: `sessionStarted: true` with a uuid, posted; (d) a landscape window at + → Story: rotate toast, no chooser, then portrait and posted (C3a). E5 and E6 assert the story's session and screen. Rehearsal, rule 1001, the kill switch and all other behaviour are unchanged. Live checklist L16 (L15 with the shim), L17 (first real post in Arc with the shim, H0) | §1 item 7 and §3.1 (no MAIN-world script); §2.3; §3.6 steps 6 and 7; §3.8 (H1 default); §3.9 (C3 → C3a, C3b); §3.10 (new `SCREEN_LANDSCAPE`); §7.6 knobs and routes; §7.7; T3; AM32 (the portrait check at the pick) |
| AM38 | **Review fixes to the portrait shim (2026-10-13).** (1) *SH-1, a shim that comes after the composer mounted.* Instagram reads the orientation when `PolarisStoryCreationPage` mounts and again only on `resize`; the shim goes in at the `complete` after each commit, so a composer that mounted first keeps its snackbar although the page then reads portrait. The reducer tracks `composerEntered` (a commit moved the tab from another page onto `/create/story` since the previous injection; in `reloading` only commits after the reload's own one count) and consumes it at every `agentInjected`. When that injection's shim reports `installed` on the composer, in the same document (`!fresh`) or at the first injection after the reload, the reading gets `afterComposerMount: true` (the background's mark, never the page's: `toPageOrientation` drops it). Cases: (a) the owner picks before the reloaded home's first `complete` (row 5b at the first probe); (b) home read a portrait screen, so nothing was installed, and the screen is landscape by the pick (the same-document check in `onInjected`). The reload's own commit to `/create/story/` (route `direct`) and a new document found by a later load are exempt. Not adopted: injecting the shim at the reload's `loading` (it can land in the outgoing document, and AM37 fixes the injection moments) and dispatching a `resize` (AM37 says "dispatch nothing"); either needs the owner. (2) *SH-2, an unreadable reading fails closed.* `{type: null, shim: 'failed'}` (a throw in the page, or a malformed result) records C3b `unknown` (`c3bOf`) and, on the composer, `SCREEN_LANDSCAPE` with detail `screen unknown, portrait shim failed`. The shim's whole body is one `try`: a throw returns `failed` with the type if it can still be read. check-bundle T3 cuts the shim's function out of the built `background.js` (the declaration the MAIN-world call passes as `func`, holding the marker) and runs it in a bare `node:vm` realm with a stand-in `screen` only, checking every reading (landscape → `installed`, then `present`; `install:false` → `off`; portrait; no orientation; a throwing getter → `{null, failed}`), so a bundler helper or a free identifier fails the build. (3) *SH-3, the blind spot is documented* (§2.3, README, docs/contract.md C3b): only the page's own `screen.orientation.type` is observed. (4) *SH-4, T3 independent of how MAIN is spelled.* `MAIN_WORLD` now flags every `world` key whose value is not a quoted `ISOLATED` (the enum, variables, computed values); `ExecutionWorld.MAIN` (dotted or bracketed) is banned in every file and any `ExecutionWorld` outside `background.js`; `background.js` may have exactly one non-ISOLATED world key, spelled `"MAIN"`, in the shim's call; `registerContentScripts` is banned in every bundle; `createElement("script")` in `composer-agent.js`. (5) *Panel.* SH-1's reading shows "portrait-primary (portrait shim installed only after the composer had read the landscape screen)" and the error's detail "The portrait shim went in only after the composer had opened and read the landscape screen; …"; SH-2's "The page’s screen orientation could not be read (…)". (6) *E2E.* `__e2ePortraitShimOff: "home"` (guarded builds only) makes the shim read only off the composer; E28 (e) (mock): the pick's composer mounts landscape, the shim installs after it, snackbar, no Share, `SCREEN_LANDSCAPE` with the late detail, C3b fail, no lock. Reducer protocol v6.1 (additive): session `composerEntered`, `PageOrientation.afterComposerMount` | §2.3 (the risk note); AM37 (3), (5), (6); T3 |

### Amendments for the autopilot (2026-10-13)

The first real post (L17, Arc, secondary account, H0 with the portrait shim) worked on 2026-10-13: the owner tapped + → Story in the popup, picked the file from Downloads, tapped Share and answered "Posted?" in the panel. The owner's decision the same day: *"There should be no interactive steps after posting from the extension. Otherwise, what is the point? Rework the whole UX process and make this really usable and effective for the user."* `docs/ux.md` is the UX spec and the implementation plan (IR, IP, IA, IB, IU, IF, IT, IW ids); `docs/contract.md` § "Autopilot spike (2026-10-13)" has the evidence. These amendments override every earlier section and amendment where they conflict.

| Id | Amendment | Overrides |
|---|---|---|
| AM39 | **The autopilot: instapost taps Instagram's own +, Story and Share (owner decision, 2026-10-13; OD9).** *Policy.* After the owner presses **Post story** (⌘↵) nothing else needs them: no + → Story, no file pick, no Share tap, no "Posted?" answer and no resizing in the normal path (P1). Exceptions may ask for one choice and never happen in the normal path: a changed or unreadable account (the account prompt, §4.8, 60 s then `ACCOUNT_UNCONFIRMED`), Arc refusing to size the window (the guided resize, now 2 minutes), and Instagram drift (Finish by hand, chosen by the owner: the window is kept 60 s, the owner taps, instapost only observes and confirms). *What instapost may do in Instagram's page* (P2): in the composer tab only, from the isolated agent only, through one audited helper (`src/agent/tap.ts`): `plus.click()`, `storyItem.click()`, `share.click()`; the `File` into the story input that + → Story armed (DataTransfer, `input`, `change`, AM3); one capture-phase `click` listener for observation. No constructed mouse, pointer, keyboard, touch or drag events, no submit, no network, no storage, no new MAIN-world script; Instagram's own client builds and sends every request (no hand-built requests, signed bodies, native-only fields or password handling). *The recipe* (`docs/ux.md` §10): + (C10: the one svg pressable in the box before the story input's form, up to 4 ancestors) → the new `[role=dialog]` with exactly two outermost pressables (a third is `MENU_DRIFT`, never tapped) → the Story item, chosen by the stored fingerprint (count, index, glyph hash) or by one trial (a wrong item only clicks the post input) → armed when the story input receives Story's `click()` within 3 s (C11; Instagram's `startStoryCreationSession` ran its portrait check and issued a uuid session id; refused in a landscape viewport: `LANDSCAPE` "story session refused"; without user activation Chrome refuses the chooser) → a human dwell → the insert (`agent/get-file`, only while inserting) → Instagram's own SPA navigation to `/create/story/` (a same-document load, AM16) → the compose watch (C12: the drawn canvas, no landscape snackbar, exactly one Share control, the footer quiet 1.5 s, cap 8 s, because v1 can switch to v2) → a dwell (≥ 2 s) → **Share once**: the background sends the command once per hand-off, persisted (`shareSent`) before it leaves; a re-injected agent never gets a second one; Instagram's Retry, toast actions and dialogs are never tapped. Every tap first waits up to 6 s for the page's user activation to lapse (R22: within about 5 s of a real click the Story item's `input.click()` would open the OS chooser; `WINDOW_IN_USE`) and for a visible page (one raise, then `WINDOW_HIDDEN`). *The window* is docked at the right edge of the editor's screen (`docked()` replaces `centred()`; AM29's fit, verification and re-applies unchanged) and focused (OD13). *The account* (C14) is read on home before any tap: "Only post as @handle" is on by default (OD11); a mismatch, an unreadable account or no expected account asks; a Test run or a check learns it without asking. *Pace:* readiness, then a jittered dwell (0.7–1.5 s per tap, 1.5–3 s before the insert, ≥ 2 s before Share; OD14). *Budgets:* home ready 15 s, activation 6 s, menu 6 s (one re-tap of + if no dialog appeared), armed 3 s, insert to drawn 30 s, compose deadline 20 s, Share acknowledgement 10 s (the agent may first wait 6 s for activation and visibility; ux.md said 5 s), pre-Share cap 2 min (paused while resizing or prompting), a possibly running upload held 15 min. Drift fails closed before Share with a named code (`STORY_ENTRY_MISSING`, `INPUT_MISSING`, `ACCEPT_DRIFT`, `INJECTION_IGNORED`, `SHARE_MISSING`); a post then keeps the window 60 s for Finish by hand, a test closes it. Unchanged: one hand-off at a time; the rate guard (tests and checks count); the kill switch and its 7-day lock; rule 1001, the fit before load, the hard reload, the portrait shim, probes C1–C9, the service-worker tripwire; never logging in; the phone and download exits (every failure after the export leaves a copy in `Downloads/instapost/`) | §1 items 1, 6, 7; §2.2 "Owner effort"; §3.1 (agent row); §3.5; §3.6 steps 7–9; §3.8; §3.10 (H0 degradation); AM19; AM21; AM28's "Posted?" parts; AM37 (4) (H1 stays off) |
| AM40 | **The result comes from Instagram's own publish answer, never from a question.** After the Share click the agent's `PerformanceObserver({type:'resource', buffered:true})`, running since it started (Instagram clears its own resource-timing buffer, so polling is never used), reports every XHR/fetch entry that ends: host (www, i, other), pathname without the query, `responseStatus`, `contentType`, redirected, offsets from the click. The background classifies them (C13; the agent bundle may not hold write-endpoint strings, T3) with the pure `decide()` (`src/core/handoff/outcome.ts`): **O1** publish 2xx JSON not redirected → Posted; **O2** publish 4xx → Not posted (`UPLOAD_FAILED`); **O3** publish 5xx, 0, HTML or redirected (a login page answers 200 HTML) → Couldn't confirm; **O4** no publish and the last upload ended non-2xx more than 3 s ago → Not posted; **O5** no publish 75 s after a 2xx upload → Couldn't confirm, held; **O6** no upload entry 120 s after Share → Couldn't confirm, held; **O7** more than one upload or publish → the `DUPLICATE_UPLOAD` alarm, the first publish decides; **O8** the window closed, the agent lost, an unexpected page or no Share acknowledgement before a decision → Couldn't confirm; **O9** writes blocked: an upload that did not succeed and no publish within 3 s → Share test passed; **O10** writes blocked: any publish, or a 2xx upload → `TEST_LEAK` (kill and lock). Going home (C9, `wentHome`) is corroboration only: Instagram goes home on any 2xx, so requiring it would add nothing and would turn real posts whose tray refresh failed into Couldn't confirm. Residual risk: a 2xx JSON answer that created no story (bodies are not read without a MAIN-world hook, which this does not add). "Nothing was posted" is said only when Share was never sent (or refused), the owner's Share was not seen and no upload or publish entry was seen. A kill after O1 keeps Posted and locks; before it, after Share, Couldn't confirm and locks. While an upload may still run the window is held up to 15 min and a later O1/O2 entry updates the result (§6.4); "It posted / It didn't post" only correct History and the duplicate guard (K8). The windows close per `docs/ux.md` §4.6: Posted 2 s after Instagram went home (else 8 s), tests at once, Share test and Not posted after Share 3 s | §3.6 step 9 ("Posted?", pre-answer, the 3 s close); AM19; AM28 (3); C9 as a decision |
| AM41 | **Test modes, settings, state v7, the one-page editor.** *Modes:* `post`; `test` (Test run and the one-time setup test, OD10: everything up to finding Share, Share not pressed); `shareTest` (Settings → Advanced: Share pressed once after the background verified rules 1002–1019 for the tab; L19, once); `check` (was `probe`: window, probe and account, no file). Write blocking is derived: `mode !== 'post'`, and always in guarded builds (SG3), so **a Post story in a guarded build ends as a Share test and can never show "Posted"**; the Posted path is proven on the live artifact against the fake (E29). The Rehearsal switch and Assisted insert are gone (DL3, DL5). *Settings:* `accountLabel`, `assistedInsert` and `rehearsal` removed (old keys ignored); `accountLock` (default on), `keepCopies`, `onboardedAt`; background-owned `expectedAccount`, `lastTestPassAt`, `menuFingerprint`, `lastResult`. *State contract v7 (breaking):* phases `idle, queued, opening, scoping, fitting, resizing, navigating, reloading, probing, awaitingAccount, openingEntry, inserting, composeReady, sharing, confirmingUpload, manual, finished, closing`; a stored session in a removed phase (`injecting`, `awaitingPick`, `awaitingShare`) is dropped at startup (rules removed, AM22 closes the popup). Errors added: `STORY_ENTRY_MISSING`, `SHARE_MISSING`, `WINDOW_IN_USE`, `WINDOW_HIDDEN`, `ACCOUNT_UNCONFIRMED`, `UPLOAD_FAILED`, `OUTCOME_UNKNOWN`, `TEST_LEAK`; the effect `degrade-h0` becomes `offer-manual` and `hold`. *Pacing:* a post blocked only by the 60 s spacing is queued in the background and starts by itself (K10, K11). *Editor:* one page (top bar, pause banner, the stage or the run view or the result, the rail with the Post card K1–K13; Settings sheet, History drawer, onboarding card); the run view mirrors five steps (Instagram, Account, Story, Share, Confirm) with facts; results replace it in place; Details holds the codes. Deleted: `docs/ux.md` §9 DL1–DL17 (the "Posted?" question, H0/H1, the rehearsal chips, the 13-phase timeline, the old panel and settings page, typing ENABLE, the download before every post, `HandoffPanel.tsx`, `SettingsView.tsx`, `EditorPanel.tsx`, `EditorView.tsx`, `route.ts`). Not done yet: editor slice 2 (`docs/ux.md` §4.4, IU14) | §3.3 (Settings); §3.6 preconditions ("the PNG is already in Downloads"); §5 SG5; AM21; AM25's ENABLE wording (the message is unchanged; the editor confirms with a checkbox) |
| AM42 | **The fake and the E2E suite for the autopilot (2026-10-13).** *Fake* (`tools/fake-ig`, IF1–IF12): msite's + as Instagram's nav item (`a[href="#"][role=link]._a6hd` with an svg, before the box holding the story form and the post form, whose input now accepts `image/jpeg`), the lazy menu popover (`menuDelayMs`, `menuOrder`, `menuItems=3`), Story running the session start (the viewport check, a uuid, the `enter` telemetry, then the story input's `click()` a microtask later), the composer's DOM (`canvas._aa3c` 0×0 until drawn, `header._aa3d`, the snackbar `._aa3b`, ShareFooter v1 / v2, `fb`, `shareControl`), Share as Instagram's `uploadStory` (no in-flight guard; XHR upload to `i.instagram.com/rupload_igphoto/fb_uploader_<id>`, then `configure_to_story` with a form body; CORS for www with credentials, the preflight echoing the requested headers), the reactions (the success toast and home; `tray=throw`; "Upload failed." with Retry; `feedback`, `checkpoint`, `login401`, `redirectLogin`, `html200`), `rupload`/`configure` answers including `slow:<ms>`, `hang` and `reset`, `rtClear` (Instagram clearing its timing buffer), the account link (`account=<h>|none|ambiguous|other:<h>`), the telemetry log (`/__fake__/api/log`) and the violations `DOUBLE_SHARE`, `RETRY_CLICKED`, `TAP_OUTSIDE_ALLOWLIST` (they replace `UNTRUSTED_SHARE` and `UNTRUSTED_CONTROL`; untrusted taps of +, Story and Share are the autopilot's and allowed, Post once by trial). A story exists only when the publish request succeeded for an upload id that has an upload, and **once per upload id**: against the fake, Chrome resent a POST whose reused connection was reset before any answer byte up to 4 times, invisibly to the page (one XHR, one resource entry), so the fake answers a repeated upload id with the same story (Instagram's own idempotency is unverified, R19). `share=fake|real-paths|background` and the direct `/__fake__/stories` share are gone. *E2E:* every spec drives the autopilot from the editor (no human step after Post story except where a case is about the owner: the account prompt, Stop, closing the window, Finish by hand, a click in the window). Playwright's `page.evaluate` and locator actions run with `userGesture: true` and so give the page user activation (the autopilot then waits, R22); specs read the Instagram window mid-run through CDP `Runtime.evaluate` without a gesture (`quietEvaluate`). Headless Chromium keeps a minimised popup's page `visible`, so E41 (raise once when hidden) stays with U19, U11 and L23. The guarded window-quirk shim keeps a popup whose bounds "Arc" ignored on screen (the docked box's right edge, `arcPlacement`), since Chromium refuses a window less than half on screen. Retired or moved: E5 → E29, E6 → E40, E12 (f) → E33 (a)/E40, E12 (r) (the knob is gone; E37, U19), E12 (v) → E13's `cssFixed` in the default window (C6 decides nothing since AM39), the old E12 (w) on the composer → E12 (t) (a new document after the insert is `INJECTION_IGNORED`), E28 (c) → E29/E40, E18 now flags a tap outside the allow-list. New: E29–E40, E42, E43, and E31 (b)/(c), which sabotage a Share test's block rules from the extension's worker to prove the background's rule check and `TEST_LEAK` end to end (§7.11) | §6.1, §7.6 (Share knob, `UNTRUSTED_*`); §7.9 invariants (no `UNTRUSTED_SHARE`; no `DOUBLE_SHARE`, `RETRY_CLICKED`, `TAP_OUTSIDE_ALLOWLIST`; at most one post session per page); §7.11 E5, E6, E11, E12, E13; AM14; AM26 (`UNTRUSTED_CONTROL`, `share=background`) |
| AM43 | **Review fixes to the autopilot's outcome and copy (2026-10-13).** *Evidence (AP-1):* the 64-entry cap no longer drops the entries that decide: upload and publish entries are always kept (up to 8, enough for O7) and only other requests share the rest; in Finish by hand only write entries are kept until the owner shares, so a missed Share click is still seen by its upload and never ends as TIMEOUT "Nothing was posted". *Blocked writes (AP-2, AP-8):* a late answer in a run whose writes are blocked follows O9/O10 (a late leak is `TEST_LEAK`, kill and lock; a late blocked upload passes the Share test; never Posted); O9 passes only on status 0, and an upload that reached a server under the block is Couldn't confirm `not-blocked`. *Share (AP-5):* `SHARE_ACK_MS` is 15 s (the agent's visibility and activation waits, 6 s each, plus a margin); Share is sent only to a visible page (hidden at the dwell: raised, sent when it shows, else `WINDOW_HIDDEN`); a refusal that arrives after the acknowledgement timer, with no write seen, becomes the before-Share failure it names and the 15-minute hold is let go. *Copy (AP-3, AP-4, AP-9, AP-10, AP-11, AP-12):* an owner's mark carries `markedBy: 'owner'` on the result and is never shown as "Instagram confirmed it"; a check reports `mismatch`/`unreadable` instead of `ok` and, with the lock on and another account logged in, says so and offers Use @account (`ui/use-account`; the background takes the handle from its own last result); a guarded build's post that ends as a Share test shows the Share test's steps; K7 no longer says "Press Done" for a window held while Instagram may still upload; onboarding's "Not logged in yet" reads `lastResult`; the pause banner names each stored lock reason (`msiteLockReasons`) | §6 of `docs/ux.md` (O8, O9), §4.6, §4.7, §4.10 |
