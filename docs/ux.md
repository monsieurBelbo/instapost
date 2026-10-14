# instapost: UX spec (autopilot)

- **Status:** spec for implementation, 2026-10-13. Branch `feat/autopilot-ux`.
- **Owner decision (2026-10-13):** "There should be no interactive steps after posting from the extension. Otherwise, what is the point? Rework the whole UX process and make this really usable and effective for the user."
- **Inputs:** two UX proposals ("invisible autopilot" and "transparent autopilot") and the autopilot recipe (spikes in sealed CfT 155 and Chromium 156 against Instagram's saved, logged-out msite bundles). Where the proposals differed, this spec takes the stronger choice; §2 lists each choice and why.
- **Policy change:** strategy §11 **AM39** records this reversal of strategy §1 item 1. Outcome rules are AM40, test modes and settings AM41, the fake and the E2E suite AM42 (all written 2026-10-13 with the implementation). Where this file and those amendments differ, the amendments record what was built.
- **Conventions:**
  - **(unverified)** marks anything not yet seen on real Instagram. Every such item has a live check (§12).
  - Ids are stable. Never renumber or reuse one; strike through a dropped item instead.
  - Copy in `code font` or quotes is the exact UI text, in English. Since strategy §11 AM44 (2026-10-14) the editor also speaks Spanish: the English text here is `src/ui/catalog.en.ts`, the Spanish one `src/ui/catalog.es.ts` (same keys, same placeholders; Settings → Language: Auto (browser), English, Español). `{x}` is a placeholder. Times use the chosen language through `Intl` (`14:05`). `@handle` is the detected Instagram username.
  - Copy never quotes Instagram's own UI strings beyond the names of its controls (+, Story, Share).

---

## 0. The whole thing in one paragraph

The owner opens instapost (toolbar icon or ⌥⇧S), drops, pastes or picks a photo, adjusts it and presses **Post story** (⌘↵). That is the last thing they do. A phone-sized Instagram window docks at the right edge of the screen and visibly works by itself: it opens Instagram's mobile site, checks which account is logged in, taps + → Story, adds the photo, presses Share and waits for Instagram's answer. The editor shows the same five steps with what each one established. About 15–25 seconds later the window closes and the editor says **Posted to @handle's story**, but only when Instagram's own publish request answered with success. If Instagram refused, the card says "Not posted" and why. If instapost cannot tell, it says **Couldn't confirm** and asks the owner to check before posting again. It never says "Posted" on a guess, never retries a publish and never asks "Posted?".

---

## 1. Principles

### 1.1 New (AM39)

| # | Principle | Replaces |
|---|---|---|
| P1 | **After Post story, zero required input.** No + → Story, no file pick, no Share tap, no "Posted?" answer and no resizing in the normal path. **Stop** is available until Share is pressed, never required. Exceptions (a changed account, Arc refusing to size the window, Instagram drift) may ask for one choice; they never happen in the normal path. | strategy §1 item 1 ("the owner clicks Share"), §2.2 "Owner effort", H0 and AM19 |
| P2 | **instapost taps Instagram's own controls, and nothing else.** In the composer tab only, from the isolated agent only, through **one audited tap helper** that knows three controls: + (Create), the Story menu item and Share. Instagram's own client builds and sends every request. No hand-built requests, signed bodies, native-only fields, password handling or new MAIN-world script. | strategy §1 items 1 and 7 ("never clicks anything in Instagram's page"), §3.8 |
| P3 | **Share at most once per post, never Retry.** The background sends the Share command once per hand-off; a re-injected agent never gets a second one. Instagram's Retry, toast actions and dialogs are never tapped. A new attempt always needs a new click from the owner, paced by the rate guard. | §3.10 "errors never retry" (kept and sharpened) |
| P4 | **Results come from evidence, never from a question.** "Posted" only when Instagram's own publish request (`configure_to_story`) answered 2xx JSON without a redirect. Anything short of a clear yes or a clear no is **Couldn't confirm**, with "check your story before posting again". | "Posted?" with a pre-answer (§3.6 step 9, AM19, AM28) |
| P5 | **Transparent, not hidden.** The Instagram window is visible, in front and docked where it does not cover the editor's run view. The run view mirrors what the window is doing. | the panel-centric hand-off |
| P6 | **One next step.** Every failure names one primary action and at most one secondary. Codes live in Details. | the error box with `<code>` and a separate fallback paragraph |

### 1.2 Unchanged

- One hand-off at a time.
- The rate guard: at least 60 s between composer opens, at most 6 an hour and 15 a day. Tests and checks count.
- The kill switch and its 7-day lock (login stops; challenge, checkpoint, security pages and off-host lock).
- Write blocking for every test (the former rehearsal rules 1002–1019, `tabIds:[tab, -1]`), and the static block ruleset in guarded builds.
- Rule 1001 (tab-scoped Android UA), the fit before load (AM29), the hard reload, the portrait shim (AM37/AM38), probes C1–C9, the service-worker tripwire (AM30).
- Never log in, never inside the composer window.
- The phone and download exits. Every failure after the export leaves a copy in `Downloads/instapost/`.

---

## 2. Choices made while merging

| Topic | Invisible proposal | Transparent proposal | Chosen | Why |
|---|---|---|---|---|
| Window | Docked right, `focused:false`, raise once if hidden | Beside or inside the editor, `focused:true` | **Docked at the right edge of the editor's screen, as tall as `windowFit()` allows, `focused:true`**, raised once if it becomes hidden | Focus keeps the page visible (a hidden page is throttled and the lazy + menu may wait for frames); a tall window keeps the upload near 1920 px (C8) |
| Progress | 4-dot chip | 6-step list with facts | **5-step list with facts** in the editor's free area | Trust: each line says what was established; still glanceable |
| Story entry | + → Story, else a direct insert | + → Story only | **+ → Story only.** No direct insert anywhere | A direct insert skips Instagram's story session (empty `waterfall_id`, a 1.76×10⁹ s duration in its telemetry) and a real post after it is unproven |
| Test | Persistent "Test mode" setting, presses Share | "Test run" action, stops before Share | **Test run** (action, stops at Share), plus **Share test** in Advanced (presses Share, publishing blocked) | No "forgot test mode on"; no blocked upload in Instagram's telemetry on every test (R15); the Share test still proves the outcome detection once (L19) |
| First post | Onboarding suggests a test | "Check account first" gate | **Setup test required once** before the first real post | It learns the account and the + menu's shape with publishing blocked; one 20 s click, once |
| Account | Detected; mismatch pauses with a 60 s prompt | Detected; mismatch or unreadable stops | **Detected; "Only post as @handle" on; a mismatch or an unreadable account pauses before any tap and asks** (60 s, then cancels) | Without a human Share this is the only wrong-account guard; asking costs one click only when something changed |
| Outcome | 2xx + went home = posted | 2xx + went home within 30 s = posted | **2xx JSON, no redirect = posted**; going home is corroboration only | Instagram's client treats any 2xx as success, so it goes home on a 2xx whatever the body: going home adds no protection and only turns real posts (a failed tray refresh) into "unknown" |
| "Share did nothing" | — | `SHARE_IGNORED` = not posted after 10 s | **Rejected.** Couldn't confirm instead | Resource timing only shows a request once it ends; an upload still running is invisible, so "nothing was sent" cannot be proven |
| Drift fallback | Close | **Finish by hand** (window kept 60 s) | **Finish by hand** | The window is already there; the owner can still post from desktop the day Instagram changes; detection still decides the result |
| Pacing | Queue the 60 s spacing | Queue the 60 s spacing | **Queue**, in the background | One click, no error, survives closing the editor |
| Layout | Sheet and drawer | Routes | **One page**: Settings sheet, History drawer, onboarding card (`#settings`, `#history` deep-link to them) | The editor stays in view; fewer screens |
| Resume after a lock | Checkbox confirm | Type RESUME | **Checkbox confirm** | Deliberate without a typing exercise; AM25's message is unchanged |
| Human pace | 0.6–1.2 s jitter, 1.5 s before Share | Readiness-driven | **Readiness, then a jittered dwell** (0.7–1.5 s per tap, 1.5–3 s before the insert, ≥ 2 s before Share) | About 6 s more, much closer to a person's rhythm, and the owner can follow it |

---

## 3. Flow at a glance

| # | Owner | instapost | On screen | Typical |
|---|---|---|---|---|
| 0 | Toolbar icon or ⌥⇧S | Opens or focuses the editor tab; restores the draft | Editor | instant |
| 1 | Drop, ⌘V, or Choose photo… | Decodes, stores the original, picks Fill or Fit | Stage with the photo; the Post card renders the exact upload | < 1 s |
| 2 | Adjusts (optional) | Live render | Stage | — |
| 3 | **Post story ⌘↵** | Freezes the cached export (1080×1920 PNG) and starts the run; queues it if the 60 s spacing applies | Run view replaces the stage | instant |
| 4 | — | **Instagram**: opens the window docked right, rule 1001, fit before load, navigate, hard reload, portrait shim, probe | Step 1; the window appears | 3–6 s |
| 5 | — | **Account**: reads @handle from Instagram's navigation and checks it | Step 2 | < 1 s |
| 6 | — | **Story**: taps +, then Story (Instagram starts its story session), adds the photo to the armed story input, waits for the composer to draw it and its Share footer to settle | Step 3; the composer appears with the photo | 4–8 s with dwell |
| 7 | — | **Share**: re-checks the composer, presses Share once | Step 4; Instagram's own "uploading" state | 2–10 s |
| 8 | — | **Confirm**: reads Instagram's publish response; closes the window 2 s after Instagram goes home | Step 5, then the result | 1–3 s |

Nothing in rows 4–8 needs the owner.

---

## 4. Screens and copy

The editor is one page: a top bar, the main area (stage, run view or result) on the left, and a rail on the right (photo and text controls, then the Post card). Settings is a sheet, History a drawer, onboarding a card over the empty stage.

### 4.1 Entry point

- **Toolbar click** opens or focuses the single editor tab (unchanged mechanism).
- **Shortcut:** manifest `commands._execute_action`, suggested Alt+Shift+S (⌥⇧S). Whether Arc honours extension commands is (unverified, L23); the shortcut sheet says it can be changed at `arc://extensions/shortcuts`.
- **Tab title:** `instapost` · `Posting… 0:07 · instapost` · `✓ Posted · instapost` · `Not posted · instapost` · `? Check your story · instapost`.
- **Toolbar badge** (`action.setBadgeText`, no permission): `…` while a run is active or queued; `✓` after a post, until the editor tab is next focused or 10 min; `!` after a failure and `?` after Couldn't confirm, until the editor has shown it.
- **The run belongs to the background.** Closing the editor tab does not stop it; reopening the editor shows the run, or its result (kept in storage.local).

### 4.2 First run (onboarding card)

Shown over the empty stage while `onboardedAt` is null. Existing installs see it once after this update.

```
┌──────────────────────────────────────────────────────────────────┐
│ Post stories from Arc in one click                               │
│ When you press Post story, instapost opens Instagram's own       │
│ mobile site in a narrow window at the right of your screen and   │
│ does the taps for you: + → Story, your photo, Share.             │
│                                                                  │
│ 1  Log in to Instagram in a normal tab                           │
│    instapost never sees your password and never logs in.         │
│    [ Open instagram.com ↗ ]                                      │
│                                                                  │
│ 2  Run the setup test                                            │
│    About 20 seconds. Everything runs up to Instagram's Share     │
│    button, which is not pressed. Nothing is posted. It also      │
│    finds which account you use.                                  │
│    [ Run setup test ]                                            │
│                                                                  │
│ How it works ▸                                     Skip for now  │
│ Tip: pin instapost to the toolbar. Keep the Instagram window in  │
│ view while it works; you don't need to click it.                 │
└──────────────────────────────────────────────────────────────────┘
```

- **Open instagram.com ↗** asks the background to open `https://www.instagram.com/` in a normal tab (desktop UA; rule 1001 is scoped to the composer tab). The editor never holds an Instagram URL (check-bundle T3 bans Meta-host URLs in editor chunks).
- **Run setup test** runs a Test run (§7) with the current photo, or with the calibration card (`src/raster/calibration.ts`) when there is none.
- **Pass:** step 2 reads `Ready. You're posting as @handle.` and the card offers `[ Start ]`. `lastTestPassAt` and `expectedAccount` are set.
- **`NOT_LOGGED_IN`:** step 1 is highlighted: `Not logged in yet. Log in at instagram.com, then run the test again.`
- **How it works ▸** expands:
  > When you press **Post story**, instapost: (1) opens Instagram's mobile site in a narrow window next to this one; (2) checks which account is logged in; (3) taps + → Story and adds your photo; (4) presses Share once; (5) waits for Instagram's answer. You can watch every step in that window. instapost only uses Instagram's own page, the same controls you would tap on a phone. It never sees your password, never posts more than 6 times an hour, never retries a failed post on its own, and only says "Posted" when Instagram confirms it.
- **Guarded builds** add: `Test build: posts go to the fake Instagram only.`
- Loading the extension in Arc stays a README step (L13); it cannot be on screen before the extension is loaded.

### 4.3 Empty editor and import

```
┌──────────────────────────────────────────────┬─────────────────────────────────┐
│        ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐           │ Recent photos                   │
│        │   Drop a photo here       │          │ [▣][▣][▣][▣]                    │
│        │   or paste it  ⌘V         │          │ [▣][▣][▣][▣]                    │
│        │   [ Choose photo… ]  ⌘O   │          │ Continue draft · edited 11:02 ▸ │
│        │   JPEG · PNG · WebP · AVIF│          │                                 │
│        └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘           │ Last post ✓ today 14:32         │
└──────────────────────────────────────────────┴─────────────────────────────────┘
```

- **Drop** works anywhere in the window; the whole window shows an outline and `Drop to use this photo`.
- **Paste:** ⌘V outside a text field takes the first `image/*` from the clipboard (screenshot → ⌘V → ⌘↵ is a fast path).
- **Choose photo…** is the existing file input (⌘O, if Arc lets the page have it, L23).
- **Recent photos:** the last 8 originals (IDB `assets`, kept 30 days or 50 items). A click loads one.
- **Continue draft:** the autosaved doc (IDB `docs`, written 500 ms after a change; `lastDocId` in storage.local).
- **Replacing a photo** that has text keeps the text: toast `Photo replaced. Undo ⌘Z`.
- **Several files dropped:** the first is used: `One photo per story: used the first one.`
- **Import errors** appear as one line under the drop zone (`DECODE_FAILED`, §5).

### 4.4 Editing

Kept: cover framing with pan, zoom and pinch; arrow-key nudges; one text layer; the same `compose()`/`rasterize()` for preview and export, so the stage is the export.

Slice 2 (after the autopilot ships; not needed for P1):

- **Fill | Fit:** Fill is today's cover. Fit shows the whole photo over a blurred copy of itself (`Fill.blur`, radius 60, dim 0.2). Photos wider than 4:5 open in Fit, others in Fill; Reset (0) returns to that default.
- **Rotate:** 90° buttons (R, ⇧R) and a ±45° Straighten slider with today's snap (AM27, AM28 (7)).
- **Instagram view** (default on, G toggles): ghost shapes where Instagram's top bar (progress bar, avatar, @handle) and reply bar sit, drawn as plain shapes with the detected handle; no Instagram assets or strings. Tooltip on a zone: `Instagram covers this area with its own buttons.`
- **Inline warnings** under the stage, never blocking: `Text is under Instagram's top bar` / `… reply bar`; `This photo is small ({w} px wide); it may look soft` (upscaled more than 1.35×); after C8 is known: `Instagram redraws stories at {w}×{h} in this window ({pct}% of 1920).`
- **Hold Space to peek:** guides off, the frame as exported.
- **Undo / redo** (⌘Z, ⇧⌘Z): 50 steps of doc state.

### 4.5 Post card (rail, bottom; the single primary action)

```
┌───────────────────────────────────┐
│ ┌──────┐  Your story · @handle     │
│ │      │  1080 × 1920 PNG · 2.4 MB │
│ │thumb │  ✓ Ready to post          │
│ │ 9:16 │                           │
│ └──────┘                           │
│ [        Post story   ⌘↵         ] │
│  Test run  ·  Send to phone…  ·  Save copy │
└───────────────────────────────────┘
```

- **The thumbnail is the upload.** An export cache renders `exportFrame(doc, 'msite')` 600 ms after the last edit and keeps the blob in memory (written to IDB `exports` only on Post). Clicking the thumbnail opens it full height: `This is the exact image instapost will upload.` While stale it dims (`Updating preview…`); Post waits up to 1 s for a fresh render, else renders at once. A stale render is never posted.
- **Secondary actions:** **Test run** (⌥⌘↵, §7), **Send to phone…** (the share sheet; falls back to Save copy with `AirDrop it from Finder`), **Save copy** (`Downloads/instapost/`).
- **Facebook line:** if the last run saw Instagram's automatic Facebook cross-post on its Share control, the note adds `· also shares to Facebook (your Instagram setting)`.

States, first match wins. Only the button and the note change; no dialogs.

| # | State | Button | Note |
|---|---|---|---|
| K1 | No photo | *(disabled)* `Post story` | `Add a photo to post.` |
| K2 | Font loading | *(disabled)* `Post story` | `Loading the text font…` |
| K3 | Phone-only frame (music, stickers, Close Friends) | `Send to phone…` (primary) | `LANE_REASON_TEXT`, e.g. `The music sticker can only be added in the Instagram app.` |
| K4 | Paused (kill-switch lock) | *(disabled)* `Paused until {date}` | Banner (§4.10) |
| K5 | Guarded build in a branded browser | *(disabled)* `Post story` | `This test build can't post from {browser}.` |
| K6 | No setup test passed on this install | `Run setup test` | `One test run before your first post: about 20 seconds, nothing is posted. It also checks which account is logged in.` |
| K7 | A run in progress (any tab) | *(disabled)* `Posting…` | `A post is in progress. Show it`. Its result is in but the window is still open: `Instagram window open`; kept for Finish by hand or closing: `The last run's Instagram window is still open. Press Done on its result, or close that window.`; held while Instagram may still upload (§6.4; Done does not close it): `Instagram may still be uploading the last story. Its window closes by itself at {time}; close it yourself once you've checked your story.` (AP-10) |
| K8 | This story's last run is Couldn't confirm (< 24 h, same image or doc version) | `Check my story ↗` | `This story may already be posted ({time}, not confirmed).` Link: `It didn't post — post again` |
| K9 | Hour or day cap | *(disabled)* `Available at {time}` | `6 posts in the past hour.` / `15 posts today, the daily limit. Resets at midnight.` |
| K10 | Spacing (≤ 60 s left) | `Post story · in 0:42` | `Posts are at least a minute apart.` A click queues the post |
| K11 | Queued | `Cancel` | `Starting in 0:42…` with the frozen thumbnail; it then starts by itself |
| K12 | This story was posted in the last 24 h | `Post again` (secondary style) | `You posted this story at {time}.` |
| K13 | Ready | `Post story ⌘↵` | `✓ Ready to post` and `as @handle` |

The background pushes the lane state (`handoff/lane`) on connect and after every change, so K4, K7 and K9–K11 are known before the click. "Same story" means the same export SHA-256 or the same doc version (`docHash`).

### 4.6 Run view (the main area while the autopilot works)

**The window.**

- Docked at the right edge of the screen the editor is on (`screen.avail*` from the editor): top = `availTop`, right = the available area's right edge, size from `windowFit()` unchanged (9:16, inner height up to 932 px and the available height minus the frame, width at most 767 CSS px × the tab zoom). On the owner's MacBook about 506×900. AM29's fit, verification and re-apply schedule are unchanged; only `centred()` becomes `docked()`.
- Created with `focused:true` and kept in front. instapost never focuses the editor during the run (that would cover the window).
- The run view lays itself out left of the window's overlap (from the status's window box and the editor's `screenX`/`innerWidth`), so nothing it shows is under the window.
- **If the page becomes hidden before Share** (another window covers it; Instagram's page is then throttled): instapost waits before its next tap, raises the window once (`windows.update({focused:true})`) and records `raisedForVisibility`. Still hidden after 10 s: `WINDOW_HIDDEN`. The Share command is sent only while the page is visible: hidden when the Share dwell ends, the window is raised and Share goes out when it shows (AP-5). After Share, visibility no longer matters.
- **If the owner clicks or types in the Instagram window** before Share (the page then has user activation, and a tap could open a real file chooser): instapost waits for the activation to lapse (up to 6 s), then carries on; still active: `WINDOW_IN_USE`.

```
┌─────────────────────────────────────────────────────────────┐┌──────────────────┐
│ instapost       Posting to @handle's story          0:07    ││ Instagram window │
├─────────────────────────────────────────────────────────────┤│ (docked right,   │
│   ┌────────┐  ● Instagram open — mobile site, 506 × 900     ││  in front)       │
│   │ thumb  │  ● Logged in as @handle                        ││                  │
│   │ (what  │  ◐ Starting a story and adding your photo… 0:02││  + menu → Story  │
│   │  gets  │  ○ Share                                       ││  photo appears   │
│   │ posted)│  ○ Confirm                                     ││  Share pressed   │
│   └────────┘                                                ││  uploading…      │
│   Usually 15–25 seconds. Keep the Instagram window in view; ││  home            │
│   you don't need to click it.                               ││                  │
│   [ Stop ]  Esc                                 Details ▸   ││                  │
└─────────────────────────────────────────────────────────────┘└──────────────────┘
```

**Header:** `Posting to @handle's story` (before the account is read: `Posting to your story`). Test run: amber chip `Test run — nothing will be posted`. Share test: `Share test — publishing is blocked`. Check: `Checking the connection`. Live build on the fake: a red bar `FAKE INSTAGRAM — this window is the test server, not Instagram.`

**Steps.** The active line has a spinner and seconds; a done line is ● plus a fact; a failed line is ✕ plus the error title.

| Step | Active | Done | Test run | Share test | Check |
|---|---|---|---|---|---|
| 1 Instagram | `Opening Instagram in a phone-sized window…` | `Instagram open — mobile site, {w} × {h}` | same | same | same |
| 2 Account | `Checking who's logged in…` | `Logged in as @handle` | same | same | same, then the run ends |
| 3 Story | `Starting a story and adding your photo…` | `Photo is in Instagram's story editor` | same | same | — |
| 4 Share | `Pressing Share…` → `Instagram is uploading…` | `Shared` (+ ` · also to Facebook` when seen) | `Share button found — not pressed (test run)` | `Pressed Share (publishing blocked)` | — |
| 5 Confirm | `Waiting for Instagram to confirm…` | `Instagram confirmed the story` | `Skipped (test run)` | `Instagram's upload was blocked, as expected` | — |

Later lines while confirming: after 20 s `Still uploading. Keep the Instagram window open.`; after 60 s `Instagram is slow. instapost keeps waiting and won't post twice.`

**Stop.**

- Before Share: **Stop** (Esc while the editor has focus). The window closes; result `Stopped. Nothing was posted.`
- From the Share command on, the button is replaced by `Instagram is uploading — this can't be stopped now.`
- Closing the Instagram window by hand before Share counts as Stop: `Stopped — you closed the Instagram window. Nothing was posted.` After Share it is Couldn't confirm.

**Arc refuses to size the window** (AM29's guided resize, now an exception line in step 1): `Arc didn't let instapost resize the Instagram window. Drag its edge until it's narrow and tall — instapost carries on by itself. Now 1512 × 902 ✗ · 1:41 left`, turning into `Now 524 × 965 ✓`. The limit drops from 3 to 2 minutes (`WINDOW_NOT_FITTED`).

**When the window closes:**

| Result | Close |
|---|---|
| Posted | 2 s after Instagram goes home (its own success toast shows), or 8 s after the confirmation if it never does (at most 15 s) |
| Test run, check | At once |
| Share test passed | 3 s after the blocked upload is seen |
| Not posted (after Share) | 3 s |
| Not posted (before Share), offer of Finish by hand | 60 s, unless the owner chooses Finish by hand |
| Other errors before Share | At once |
| Couldn't confirm, with an upload possibly still running | Kept open up to 15 min (Instagram's photo upload has no timeout); closed earlier if a late answer arrives (§6.4) |
| Couldn't confirm, nothing more can arrive | 3 s |
| Kill switch | At once |

After the window closes, the editor's window is focused again only if the Instagram window was the focused one at that moment (so the owner was watching it).

### 4.7 Results (replace the run view in place; the step list stays above)

**Posted**

```
   ✓  Posted to @handle's story
      14:32 · took 18 s · Instagram confirmed it.
   [ New story  N ]   View story ↗   Done                     Details ▸
```

- **View story ↗** opens `https://www.instagram.com/stories/<handle>/` in a normal tab through the background.
- **New story** clears the doc and focuses the drop zone. **Done** returns to the editor with the doc kept.
- Facebook cross-post seen: `Also shared to Facebook, as set in your Instagram account.`
- Two publish requests seen (`DUPLICATE_UPLOAD` alarm): title `Posted — check for a duplicate`, body `Instagram sent its publish request twice. Check your story and delete a duplicate if there is one.`
- Posted, then a security check (kill switch after the confirmation): the card stays Posted and the pause banner appears (§4.10).
- After 10 s the header shows `Last: ✓ 14:32`.

**Not posted** (template; title and sentence per code, §5)

```
   ✕  Not posted — {title}
      {sentence} Saved a copy: Downloads/instapost/2026-10-13_1432_story.png  Show
   [ {primary} ]   {secondary}                                Details ▸
```

Every failure after the export saves the PNG to `Downloads/instapost/` (unless "Keep a copy" already did) and offers `Show` (`downloads.show`, Finder with the file selected).

**Couldn't confirm**

```
   ?  Couldn't confirm the post
      instapost pressed Share, but {why}. Check your story before you post this photo again.
      The Instagram window stays open while Instagram may still be uploading.   (when held)
   [ Check my story ↗ ]   It posted · It didn't post            Details ▸
```

"It posted" and "It didn't post" are optional. They only correct History and the duplicate guard (K8); nothing waits for them. A marked result is the owner's word, never Instagram's: the card, the steps, Details and the tab title say `Marked as posted by you` / `Marked as not posted by you`, and only Instagram's publish answer (O1) says `Instagram confirmed it` (AP-3).

**Test passed**

```
   ✓  Test passed
      Everything up to Share works, and you're posting as @handle. Nothing was posted.
   [ Post story  ⌘↵ ]   Done
```

**Share test passed:** `✓ Share test passed` · `Instagram tried to upload and the upload was blocked, as it should be. Nothing was posted.` `[ Done ]`

**Check passed:** `✓ Connected as @handle. Posts go to this account.` `[ Done ]`. With "Only post as" on and another account logged in, a check never says that (AP-4): `! Connected as @other — posts are locked to @handle` · `Post story will stop and ask before posting as @other. Choose Use @other to post as @other from now on, or log in to Instagram as @handle in a normal tab.` `[ Use @other ]` `Done`. Use @other makes the account that check read the expected one (the background takes it from its own last result).

**Stopped:** `Stopped. Nothing was posted.` `[ Post story ]` `Done`

### 4.8 Account prompt (exception)

Shown only when "Only post as" is on and the detected account differs from the expected one, cannot be read, or no account is expected yet. The run pauses on Instagram's home **before any tap**. Nothing is posted until the owner chooses; after 60 s it cancels (`ACCOUNT_UNCONFIRMED`).

```
┌──────────────────────────────────────────────────────────────────┐
│ Instagram in this browser is logged in as @other.                │
│ You usually post as @handle.                                     │
│ [ Post as @other ]   Cancel                 Cancels itself in 0:58│
│ Nothing is posted until you choose.                              │
└──────────────────────────────────────────────────────────────────┘
```

- Unreadable: `instapost couldn't tell which account is logged in. The Instagram window shows it.` Buttons: `Post anyway` · `Cancel`.
- No expected account (after Forget): `Instagram is logged in as @other. Post as @other?` Buttons: `Post as @other` · `Cancel`.
- Choosing to post sets `expectedAccount` to the detected handle (not when unreadable).
- This is the one interactive moment that can remain. Without a human looking at the composer, it is the only guard against posting to the wrong account.

### 4.9 Finish by hand (exception; chosen by the owner, never automatic)

Offered as an action when Instagram drift stopped the autopilot and the window is safe to reuse (effect `offer-manual`, §5). Choosing it focuses the Instagram window and the run view shows:

- Photo not yet in the composer: `In the Instagram window tap +, then Story, and pick {file} from Downloads/instapost. Then tap Share. instapost watches and confirms the post.`
- Photo already in the composer (`SHARE_MISSING`): `Check the photo in the Instagram window and tap Share. instapost confirms the post.`

From then on instapost taps nothing; the agent only observes (including the owner's Share click). The result comes from the same rules (§6). After 5 minutes without a result: `TIMEOUT`.

### 4.10 Pacing and pause

- **Pacing** shows in the Post card (K9–K11) and in History's header (`Posts today 3 / 15 · this hour 1 / 6`), never as an error after a click unless two tabs raced (then the result uses the same copy).
- **Pause banner** (top of the editor) after `KILLED_CHALLENGE`, `KILLED_OFFHOST` or `TEST_LEAK`:

```
 ⏸ Desktop posting is paused until Tue 20 Oct, 14:05
   On 13 Oct at 14:05: Instagram asked for a security check, so instapost paused desktop
   posting for 7 days to protect your account. Open Instagram on your phone and complete
   any check it shows.                                        [ Send to phone… ]  Resume…
```

The text names each reason stored with the lock (`msiteLockReasons`, cleared by Resume; AP-12): `KILLED_CHALLENGE` as above; `KILLED_OFFHOST`: `The Instagram window went to another website, so instapost paused desktop posting for 7 days as a precaution. If you didn't expect this, check your login activity on your phone.`; `TEST_LEAK`: `A test went through to Instagram: its upload or publish request wasn't blocked, so the test story may be live. Check your story and delete the test story if it's there. Desktop posting stays paused until you resume.` A lock of an earlier build (no reason) keeps the general text.

- **Resume…** expands inline: `Resume desktop posting? Only resume once you've opened Instagram on your phone and the account works normally there.` `[ ] The account works normally on my phone` `[ Resume ]` (enabled by the checkbox). It sends AM25's `handoff/enable-msite` with the lock it showed.

### 4.11 History (drawer, H)

```
 History                                       Posts today 3 / 15 · this hour 1 / 6     ✕
 Today
  ▣ 14:32  ✓ Posted · @handle · 18 s                       View story ↗   ⋯
  ▣ 14:30  ✓ Test passed                                                  ⋯
 Yesterday
  ▣ 21:10  ? Couldn't confirm                              Check ↗        ⋯
  ▣ 18:12  ✕ Not posted · Instagram didn't accept the story               ⋯
   ⋯  Open in editor · Send to phone… · Save copy · Details
      (Couldn't confirm rows also: It posted · It didn't post)
```

- Source: the last 50 IDB `handoffs` joined with `exports`; thumbnails from the export blob, cached. Exports are pruned after 30 days (grey placeholder).
- **View story** only for Posted rows under 24 h old.

### 4.12 Settings (sheet, `,`)

```
 Settings                                                               ✕
 ACCOUNT
   Posts go to   (M) @handle   detected 13 Oct, 14:32        [ Check again ]
   [✓] Only post as @handle — ask before posting if Instagram is logged in
       as someone else
   Forget this account

 COPIES
   [ ] Also keep every posted story in Downloads/instapost
       (Stories that are not posted are always saved there.)

 LANGUAGE (AM44)
   [ Auto (browser) ▾ ]   Auto (browser) · English · Español
   Auto follows your browser: Spanish when your browser is in Spanish, English otherwise.

 PACE AND SAFETY
   At most 1 post a minute, 6 an hour and 15 a day. Tests and checks count too.
   Desktop posting: Active · 2 posts today          (or the paused state, §4.10)

 ADVANCED ▸
   Check connection   Opens the Instagram window, reads the account and closes it.
                      Posts nothing. Counts towards pacing.              [ Run ]
   Share test         Presses Share with publishing blocked, to prove instapost can
                      read Instagram's upload. Instagram shows its own "upload failed"
                      message. Use it once (live checklist L19).          [ Run ]
   Diagnostics        The last 20 runs, structural facts only (includes your
                      username).                                         [ Copy ]
   Build: live · Arc 155
```

- The account shows as a monogram and the handle; no avatar is fetched (that would be a request from the extension to Meta's CDN).
- While a run is active, settings that change a run are disabled with `A post is running; this applies to the next one.` (AM21 semantics).

### 4.13 Details (one component: run view, results, History)

Collapsed by default; **Copy diagnostics** copies the record as JSON.

- Today's rows, with their pure text functions: Page, Window, Browser, Mobile page, Viewport, Screen, Story input, Service worker, Canvas.
- New rows:

| Row | Example |
|---|---|
| Result | `Posted (Instagram confirmed it)` |
| Evidence | `Share pressed 14:32:21 · upload 200 · publish 200 application/json, no redirect · went home +1.2 s · progress seen` |
| Account | `@handle (from Instagram's navigation) · expected @handle` |
| Story entry | `+ → Story · menu 2 items, Story is item 2 (known) · armed after 0.3 s · 0 trials` |
| Share control | `footer v1` / `footer v2 (Facebook badge)` |
| Image check | `photo in composer matches the export (0.98)` (diagnostic until L20 sets a threshold) |
| Steps | `opened 0.0 · Instagram 3.5 · account 3.7 · armed 5.1 · photo in composer 7.4 · Share 9.6 · confirmed 11.4 s` |
| Window | `asked 506×900, got 506×900 (1 attempt) · docked right · focused · raised: no` |
| Quality | `Instagram redrew the photo at 1012×1800 (94% of 1920)` |
| Requests after Share | path, status and type of each XHR/fetch, query dropped, digits as `<n>` |
| Alarms | `DUPLICATE_UPLOAD` |
| Code | `UPLOAD_FAILED` (failures only) |
| Run | `handoff_…` |

### 4.14 Keyboard

Single-key shortcuts are inactive while a text field has focus. Browser-reserved keys (⌘N, ⌘W, ⌘Y, ⌘,) and Arc's ⌘S are not used.

| Keys | Action |
|---|---|
| ⌥⇧S (global, suggested) | Open or focus instapost |
| ⌘↵ | The Post card's primary button (Post story, Run setup test, Send to phone…) |
| ⌥⌘↵ | Test run |
| Esc | Stop (before Share); else close a sheet, a drawer or text editing |
| ⌘O · ⌘V | Choose photo · paste photo |
| ⌘Z · ⇧⌘Z | Undo · redo (slice 2) |
| T | Edit text |
| G | Instagram view on/off |
| F | Fill / Fit (slice 2) |
| 0 | Reset placement |
| = · − | Zoom in · out about the centre |
| R · ⇧R | Rotate 90° (slice 2) |
| Arrows (⇧: 10 px) | Nudge |
| Space (hold) | Peek at the export (slice 2) |
| N | New story (after a result) |
| H · , | History · Settings |
| ? | This sheet |

---

## 5. Copy for every code

Conventions:

- Every failure after the export adds `Saved a copy: Downloads/instapost/{file}  Show`.
- **Try again** is a new click, paced by the rate guard (`Try again · 0:41`).
- **Finish by hand** and **Share it myself** lead to §4.9 (window kept 60 s).
- **"Nothing was posted"** is said only when the Share command was never sent, the owner's own Share click was not seen (Finish by hand), and no upload or publish request was seen. Any error after Share becomes **Couldn't confirm** unless §6 decides Posted or Not posted.
- Codes appear only in Details.

| Code | Where | Title | Body | Primary | Secondary |
|---|---|---|---|---|---|
| `RATE_LIMITED` (spacing) | Post card | — | Queued, no card (K10, K11) | — | Cancel |
| `RATE_LIMITED` (hour) | Post card | Pace limit reached | 6 posts in the past hour. instapost keeps a human pace so your account looks like normal use. You can post again at {time}; your story is kept. | Send to phone… | Save copy |
| `RATE_LIMITED` (day) | Post card | That's today's 15 posts | instapost allows 15 posts a day. You can post again tomorrow. | Send to phone… | Save copy |
| `HANDOFF_BUSY` | Post card | A post is already running | One post at a time. This one can go when it's done. | Show it | — |
| `MSITE_LOCKED` | Banner, Post card | Desktop posting is paused until {date} | §4.10 | Send to phone… | Resume… |
| `GUARD_NOT_FAKE` | Step 1 | Stopped: not the fake Instagram | This test build only works with the fake Instagram, and the window loaded something else. It was closed. Nothing was posted. | Copy diagnostics | — |
| `BRANDED_BROWSER` | Post card | This is a test build | Test builds refuse to run in Chrome, Edge or Arc so they can never reach the real Instagram. Load the live build here, or use the sealed browser from `pnpm run dev`. | — | — |
| `DESKTOP_SHELL` | Step 1 | Instagram sent its desktop site | instapost needs Instagram's mobile site and got the desktop one this time, so it closed the window. Nothing was posted. | Send to phone… | Try again |
| `NOT_LOGGED_IN` | Step 1 | Log in to Instagram first | Instagram asked to log in. Log in at instagram.com in a normal tab of this browser profile, then post again. instapost never logs in for you, and never in its own window. Nothing was posted. | Open instagram.com ↗ | Try again |
| `LANDSCAPE` | Step 1 or 3 | Couldn't make the Instagram window portrait | Instagram only starts a story in a tall, narrow window, and this one read as landscape. Nothing was posted. (Step 3 variant, from the story session refusing: `Instagram refused to start a story because the window read as landscape.`) | Try again | Send to phone… |
| `SCREEN_TOO_SMALL` | Step 1 | This display is too small | The Instagram window needs at least 640 points of height. Move this window to a larger display, or choose More Space in System Settings → Displays. Nothing was posted. | Send to phone… | — |
| `INPUT_MISSING` | Step 3 | Instagram didn't offer a story upload | Instagram's page had no place to add a story photo this time. Instagram may have changed its page. Nothing was posted. | Send to phone… | Finish by hand |
| `ACCEPT_DRIFT` | Step 3 | Instagram changed its story upload | It no longer takes the image types instapost expects, so instapost stopped instead of guessing. Nothing was posted. | Send to phone… | Finish by hand |
| `INJECTION_IGNORED` | Step 3 | Instagram didn't take the photo | instapost added your photo, but Instagram's story editor didn't open with it. Nothing was posted. | Finish by hand | Send to phone… |
| `SW_TOOK_CONTROL` | History only | Stopped by an older version | An earlier instapost closed the window when Instagram's background worker took over. Current versions only note it. | — | — |
| `KILLED_CHALLENGE` | Any, banner | Instagram wants a security check | instapost closed the window and paused desktop posting for 7 days to protect your account. Open Instagram on your phone and complete any check it shows. {Nothing was posted. / Your story was posted before the check.} | Send to phone… | — |
| `KILLED_OFFHOST` | Any, banner | The Instagram window left Instagram | It went to another website, so instapost closed it and paused desktop posting for 7 days as a precaution. If you didn't expect this, check your login activity on your phone. {Nothing was posted. / …} | Send to phone… | — |
| `AGENT_UNREACHABLE` | Before Share | Lost touch with the Instagram window | instapost's helper in that window stopped answering, so the window was closed. Nothing was posted. | Try again | Send to phone… |
| `TIMEOUT` | Before Share | Instagram stopped responding | The step "{step}" didn't finish within {n} seconds, so the window was closed. Nothing was posted. (Finish by hand: `Nothing happened in the Instagram window for 5 minutes, so it was closed.`, with "Nothing was posted" only under the rule above.) | Try again | Send to phone… |
| `EXPORT_TOO_LARGE` | Post card | This story is too big to export | Even at the lowest quality it's over 8 MB. Zoom in a little or use a simpler photo. | — | Send to phone… |
| `DECODE_FAILED` | Drop zone | Can't open this file | instapost opens JPEG, PNG, WebP and AVIF. For iPhone HEIC photos, export a JPEG from Photos (File → Export) and drop that. | Choose photo… | — |
| `FONT_NOT_LOADED` | Post card | The text font didn't load | The text can't be drawn without it. Reload this tab; your draft is saved. | Reload | — |
| `UNEXPECTED_PAGE` | Before Share | Instagram opened an unexpected page | The Instagram window went to {path}, so instapost stopped there. Nothing was posted. | Try again | Send to phone… |
| `NAVIGATION_TIMEOUT` | Step 1 | Instagram didn't load | Instagram didn't start loading within 30 seconds. Check your connection. Nothing was posted. | Try again | Send to phone… |
| `SW_INTERCEPTS` | Step 1 | Instagram's page behaved differently | Instagram's background worker handled the window's own requests, so they could leave without the mobile profile. instapost closed the window to be safe. Nothing was posted. | Send to phone… | Copy diagnostics |
| `WINDOW_NOT_FITTED` | Step 1 | Couldn't make the window phone-sized | Arc didn't let instapost resize the Instagram window, and it wasn't resized by hand within 2 minutes. Instagram never loaded. Nothing was posted. | Try again | Send to phone… |
| `LAYOUT_TOO_WIDE` | Step 1 | The Instagram window stayed too wide | Instagram only shows its story button when the window is at most 767 points wide, and it stayed wider. Nothing was posted. | Try again | Send to phone… |
| `SCREEN_LANDSCAPE` | Step 3 | Instagram thought the screen was sideways | Its story editor asked to rotate the device and hid Share; instapost's portrait fix didn't take effect in that window. Nothing was posted. | Send to phone… | Copy diagnostics |
| **`STORY_ENTRY_MISSING`** (new) | Step 3 | Couldn't start a story | instapost couldn't open Instagram's + → Story menu the way it expects ({detail}). Instagram may have changed its page. Nothing was posted. | Finish by hand | Send to phone… |
| **`SHARE_MISSING`** (new) | Step 4 | Couldn't find Share | Your photo is in Instagram's story editor, but instapost couldn't find exactly one Share button, so it pressed nothing. Nothing was posted. | Share it myself | Send to phone… |
| **`WINDOW_IN_USE`** (new) | Step 3 or 4 | You were using the Instagram window | instapost doesn't tap while you click or type in that window, so it stepped back. Nothing was posted. | Finish by hand | Try again |
| **`WINDOW_HIDDEN`** (new) | Step 3 or 4 | The Instagram window was hidden | Another window covered it, and Instagram pauses hidden pages. Keep it in view while instapost works; you don't need to click it. Nothing was posted. | Try again | Send to phone… |
| **`ACCOUNT_UNCONFIRMED`** (new) | Step 2 | Posting cancelled | Instagram was logged in as @{detected}, not @{expected}, and nobody confirmed within a minute. Nothing was posted. (Unreadable: `instapost couldn't tell which account was logged in, and nobody confirmed within a minute.`) | Try again | Settings |
| **`UPLOAD_FAILED`** (new) | Step 4–5 | Instagram didn't accept the story | Instagram answered that the upload failed ({detail}), so your story wasn't posted. instapost never retries on its own. | Try again | Send to phone… |
| **`OUTCOME_UNKNOWN`** (new) | Step 5 | Couldn't confirm the post | instapost pressed Share, but {why}. Check your story before you post this photo again. | Check my story ↗ | It posted · It didn't post |
| **`TEST_LEAK`** (new; effect `kill`) | Step 5 | The test didn't block publishing | During a test, Instagram's publish request went through ({detail}). The test story may be live: check your story now and delete it if it is. Desktop posting is paused. | Check my story ↗ | Resume… |

`{why}` for `OUTCOME_UNKNOWN`:

| Reason | Text |
|---|---|
| `no-upload-seen` | Instagram's upload didn't finish within 2 minutes |
| `no-finalize-after-upload` | Instagram uploaded the photo but didn't finish publishing it within 75 seconds |
| `configure 5xx` | Instagram's server answered with an error ({status}) while publishing |
| `configure 0` | the publish request was cut off before Instagram answered |
| `configure html` / `redirected` | Instagram answered the publish request with a web page instead of a confirmation |
| `window closed` | the Instagram window was closed before Instagram answered |
| `agent lost` | instapost lost touch with the Instagram window |
| `unexpected page` | Instagram went to an unexpected page ({path}) |
| `share not acknowledged` | instapost couldn't tell whether Share was pressed |
| `not blocked` | the test's write block didn't stop the upload: it reached Instagram, which answered {status} (O9b) |

Results that are not errors: Posted, Posted — check for a duplicate, Test passed, Share test passed, Check passed, Stopped (§4.7).

---

## 6. How the result is decided

### 6.1 What Instagram does after Share

From `PolarisStoryCreationActions.uploadStory` (saved bundles; recipe §2 step 5):

1. `UPLOAD_REQUESTED`: Instagram's "uploading" state.
2. Photo upload: `POST https://i.instagram.com/rupload_igphoto/fb_uploader_<id>` (XHR, no timeout, no retry).
3. Publish: `POST /api/v1/media/configure_to_story/` (same origin, XHR, 60 s timeout). Instagram's client treats **any 2xx** as success.
4. Success: toast ("…added to Instagram", or "…and Facebook"), tray refresh, `pushState('/')`.
5. Failure: toast "Upload failed." with **Retry**, no navigation. instapost never taps Retry.
6. Never settles: `feedback_required` (a feedback dialog), 401 `require_login` (routes to login), a `checkpoint_url`/`redirect_url` (full navigation; the kill switch acts).

### 6.2 Evidence

The agent's `PerformanceObserver({type:'resource', buffered:true})`, running since the agent started (AM30), reports every XHR/fetch entry that starts after the Share click. Instagram clears its own resource-timing buffer, so polling is never used. Each entry carries the host, the pathname (no query), `responseStatus`, `contentType`, whether it was redirected and its timing relative to the click. A failed or blocked request still produces an entry, with status 0. The background, not the agent, classifies the entries (the agent bundle may not contain write-endpoint strings, T3).

UI facts are corroboration only and are recorded: went home, Instagram's progress state seen, a new toast (and whether it had an action button).

### 6.3 Rules (pure `decide()`, recipe §2 step 6)

| # | Evidence after the Share click | Result |
|---|---|---|
| O1 | Publish request 2xx, JSON content type, not redirected | **Posted** |
| O2 | Publish request 4xx, not redirected | **Not posted** (`UPLOAD_FAILED`) |
| O3 | Publish request 5xx, status 0, HTML, or redirected (a login page answers 200 HTML) | **Couldn't confirm** |
| O4 | No publish request; the last upload ended non-2xx more than 3 s ago | **Not posted** (`UPLOAD_FAILED`) |
| O5 | No publish request 75 s after a 2xx upload | **Couldn't confirm** (`no-finalize-after-upload`) |
| O6 | No upload entry 120 s after Share | **Couldn't confirm** (`no-upload-seen`) |
| O7 | More than one upload or publish request | Alarm `DUPLICATE_UPLOAD`; decide on the first publish request |
| O8 | The window closed, the agent went silent, an unknown page, or no acknowledgement of the Share command within 15 s (the agent's visibility and activation waits, 6 s each, plus a margin), before O1–O6 decided | **Couldn't confirm** (held). A refusal that arrives later, with no write seen, turns it into the before-Share failure it names (AP-5) |
| O9 | Test with Share (Share test): an upload entry with status 0 and no publish request within 3 s | **Share test passed** |
| O9b | Test with Share: an upload that reached a server (any other non-2xx status): the block failed | **Couldn't confirm** (`not-blocked`; AP-8) |
| O10 | Test with Share: any publish request, or a 2xx upload | **`TEST_LEAK`** (lock) |

Why going home is not required for Posted: Instagram goes home on any 2xx, so it would add nothing against a "200 with a failure inside" (which Instagram's own client would also show as success), and it would turn real posts whose tray refresh failed into Couldn't confirm. The residual risk is a 2xx JSON answer that did not create a story; instapost cannot read response bodies without a MAIN-world hook, which this spec does not add.

### 6.4 After Couldn't confirm

When an upload may still be running (O5, O6), the window stays open up to 15 minutes and the agent keeps reporting. A later publish entry that decides O1 or O2 updates the record and the card (`Update: Instagram confirmed it at 14:41.` or `Update: Instagram said the upload failed.`). Closing the window ends it as it stands. When writes are blocked (a Share test, a guarded build's post) a later answer follows O9/O10 instead: a leak is `TEST_LEAK` (kill and lock), a blocked upload passes the Share test, and it is never Posted (AP-2).

The evidence keeps at most 64 entries per run, but the cap never drops an upload or publish entry: those are kept up to 8 (enough for O7), and only the other requests (GraphQL, logging) share the rest. In Finish by hand only upload and publish entries are kept until the owner shares (AP-1).

---

## 7. Test modes

| Mode | Where | Does | Write-block rules | Counts toward pace | Result |
|---|---|---|---|---|---|
| `post` | Post story | Everything | Off (live); the static ruleset in guarded builds | Yes | Posted / Not posted / Couldn't confirm |
| `test` | Test run; setup test | Everything up to finding the Share control; never presses Share | On | Yes | Test passed |
| `shareTest` | Settings → Advanced | Everything, including one Share press, after the background has verified that rules 1002–1019 are installed for this tab | On | Yes | Share test passed, or `TEST_LEAK` |
| `check` | Settings → Advanced (was "Probe composer") | Window, probe and account; no file | On | Yes | Check passed |

- A Test run passes when: the probe passed, the account was read (or confirmed), the story session was armed by + → Story, the photo is drawn in the composer, the Share footer settled with exactly one control, and C3b passed. It records the account (`expectedAccount` if none), the + menu's fingerprint (count, Story item index and icon hash) and `lastTestPassAt`.
- A test is suggested (a one-line hint on the Post card, never a gate) after an extension update, after any drift failure (`STORY_ENTRY_MISSING`, `INPUT_MISSING`, `ACCEPT_DRIFT`, `INJECTION_IGNORED`, `SHARE_MISSING`, `ACCOUNT_UNCONFIRMED` unreadable) and when the last post is more than 14 days old: `Instagram may have changed since your last post 3 weeks ago. A test run takes 20 seconds.`
- The only gate is the one-time setup test (K6).
- **Guarded builds** always talk to the fake and their static ruleset blocks the real write paths, so a `post` there sees the blocked path (Share test semantics). The post success path is tested on the live artifact against the fake.

---

## 8. UI components and state

```
App
├─ TopBar          brand · mode badge (non-live) · AccountChip · LastResult · History · Settings
├─ PauseBanner     kill-switch / TEST_LEAK lock (§4.10)
├─ Main            ImportSurface | Stage (+ Onboarding card) | RunView | ResultCard
├─ Rail            PhotoControls · TextControls · PostCard
├─ HistoryDrawer   SettingsSheet   ShortcutSheet
└─ Details         (inside RunView, ResultCard, HistoryDrawer)
```

| Signal | Shape | Source |
|---|---|---|
| `lane` | `{kind:'ready'\|'spacing'\|'queued'\|'hourly'\|'daily'\|'paused'\|'busy', freeAt?, reason?, today, hour}` | `handoff/lane` from the background |
| `run` | `{id, mode, startedAt, step:'instagram'\|'account'\|'story'\|'share'\|'confirm', steps: StepView[], thumb, canStop, queuedUntil?, accountPrompt?, resize?, manual?, fake, window}` | `handoff/status`, through a pure `stepsFrom(status, mode)` |
| `result` | `{id, kind:'posted'\|'notPosted'\|'unknown'\|'tested'\|'shareTested'\|'checked'\|'stopped', code?, why?, account?, at, durationMs, facebook?, alarms[], held?, evidence}` | the final status; also storage.local `lastResult` |
| `exportCache` | `{exportId?, blobUrl, sha256, bytes, w, h, docUpdatedAt, stale}` | the editor (§4.5) |
| `account` | `{handle, detectedAt} \| null`, `accountLock` | settings |
| `history` | the last 50 records with thumbnails | IDB |

- Links to Instagram (Open instagram.com, View story, Check my story) go through a background message `ui/open-instagram {page:'home'\|'story', handle?}`; the background validates the handle and calls `tabs.create`. The editor bundle keeps no Meta-host URL (T3).
- Send to phone… stays in the editor (it needs the click's user activation).
- The safety copy on failure is written by the editor when it shows the result; if the editor was closed, the copy is in History (Save copy).

---

## 9. What gets deleted

- [ ] **DL1** The "Posted?" question: its buttons, `postedPrompt`, `answerPosted`, `postedAnswer`, `finishedInfo`, the `outcome` event and `handoff/outcome`. History keeps optional marks for Couldn't confirm rows only.
- [ ] **DL2** H0 in the normal path and as an automatic fallback: `awaitingPick`, `pickText`, "Instagram opened its home page… tap + → Story…", the `degrade-h0` effect. The text survives only in Finish by hand.
- [ ] **DL3** H1 (the direct insert) as a level: `injecting`, `assistedInsert`, the Assisted insert switch, chips and hints. The insert happens only into a story input armed by + → Story.
- [ ] **DL4** "Waiting for you to review and tap Share" (`SHARE_TEXT`) and the hold-open texts (`HOLD_OPEN_TEXT`, `HOLD_OPEN_UNKNOWN_TEXT`); `awaitingShare`.
- [ ] **DL5** The Rehearsal setting, its chips and "keep it on until L8". Replaced by Test run and Share test.
- [ ] **DL6** The typed account label ("Posts as", display only).
- [ ] **DL7** The 13-phase timeline and `PHASE_LABEL` on the main path (the phase log stays in Details).
- [ ] **DL8** The always-visible probe table, the error box that leads with `<code>`, the separate fallback paragraph and auto-scrolling the panel.
- [ ] **DL9** The `connected / not connected` indicator. A lost port shows only as `Reconnecting to instapost…` in the run view.
- [ ] **DL10** The Editor / Settings top nav, the `#/settings` page and `route.ts`.
- [ ] **DL11** "Probe composer" as a main Settings section (now Advanced → Check connection).
- [ ] **DL12** Typing ENABLE (now a checkbox confirm; the message is unchanged).
- [ ] **DL13** Downloading the export before every post (now on failure, or with "Also keep every posted story").
- [ ] **DL14** "Post from desktop" and the equal-weight Download JPEG / Share… buttons (now Post story, with Save copy and Send to phone… as links).
- [ ] **DL15** "Location and EXIF data removed" on every export (moved to Details).
- [ ] **DL16** `HandoffPanel.tsx`, `SettingsView.tsx`, `EditorPanel.tsx` and `EditorView.tsx`, replaced by §8's components.
- [ ] **DL17** The 15-minute inactivity window on the main path (per-step budgets and a 2-minute pre-Share cap instead; 15 minutes stays only for holding a possibly running upload).

---

## 10. Autopilot recipe (summary)

The full recipe, with spike evidence, goes into strategy §11 **AM39** (policy and recipe), **AM40** (outcome rules, §6) and `docs/contract.md` C10–C14. Summary:

- **Path:** + (Create) → the Story menu item → the file into the armed story input → Share, once. This is the only path that runs Instagram's `startStoryCreationSession` (portrait check, uuid session id): `handleStoryCreationClick` is its only caller and is reached only from the lazy + menu's Story item. The menu's props are exactly two actions (Story, Post), read in `PolarisMobileCreationNavItem`; the menu module itself was not readable logged out (unverified, L18).
- **Allowed actions** (isolated agent, composer tab only, one audited tap helper): `plus.click()`, `storyItem.click()`, `share.click()`; `setInputFile` (DataTransfer, `input`, `change`); one capture-phase `click` listener for observation. No constructed mouse, pointer, keyboard, touch or drag events, no submit, no network, no storage, no new MAIN-world script. Every handler on the path is a React `onClick`, and no module in the saved bundles reads `isTrusted` or `userActivation`.
- **Why the insert works without a chooser:** the Story item's handler calls `input.click()` on the story input; with no user activation, Chrome refuses the chooser (console warning only). The agent sees that click (its capture listener: the session is armed), waits about 0.4 s plus a human dwell, then sets the file. **Exception:** within about 5 s of a real click in that window the same path opens the OS chooser, so every tap is guarded by `navigator.userActivation.isActive === false` (`WINDOW_IN_USE` if it stays active), and injection comes from the background only (an injection from an extension page's click could carry a gesture).
- **Finding things structurally** (no text, no ARIA; Spanish UI works the same):
  - Entry: the story input (C4 accept set), its `form[role=presentation]`, the sibling post form (`accept="image/jpeg"`), and the single svg link in the previous sibling box (the +; its `aria-label` is Instagram's "Home" string by a bug of theirs, never used).
  - Menu: the new `[role=dialog]` after the + tap; exactly two outermost pressables, else `STORY_ENTRY_MISSING` (never tap an unknown third item). The Story item is chosen by a stored fingerprint (index and icon hash), else by trial: a wrong item only clicks the post input (no chooser, a post session in Instagram's state only), then + again and the other item; at most one wrong item per post. Armed = the story input received its click within 3 s.
  - Composer: `canvas._aa3c` with `width > 0` (drawn), `header._aa3d`, no landscape snackbar `._aa3b`, exactly one visible footer (not the trash footer `_aa3k`) with one `button` (v1) or `[role=button]` (v2; a Facebook badge = automatic cross-post); the footer quiet for 1.5 s (cap 8 s) because v1 can switch to v2 after a GraphQL answer. Each legacy class has a structural fallback.
  - Account: the one navigation link to `/<username>/` (Instagram's `PolarisProfileNavItem`), username `^[A-Za-z0-9._]{1,30}$`, reserved first segments rejected, feed links ignored (unverified, L18).
- **Budgets:** home ready 15 s · activation wait 6 s · menu 6 s (one re-tap of + only if no dialog appeared) · armed 3 s · insert → `/create/story` 10 s · drawn 10 s · footer settle 1.5 s quiet, 8 s cap · upload entry 120 s · publish after upload 75 s · pre-Share cap 2 min · hold for a running upload 15 min.
- **Share once:** the background sends the Share command once per hand-off (persisted before it is sent); the agent re-checks the composer and the activation, records t0, clicks, and acknowledges. Instagram's `uploadStory` has no in-flight guard, so a second click would post twice.
- **Outcome:** §6. The observer runs from the agent's start; `responseStatus` and `contentType` were readable from the isolated world in CfT 155 and Chromium 156, cross-origin too when CORS passes; a dNR block reads as status 0.
- **Differences from a person** (accepted by the owner, R18): untrusted clicks without pointer events or focus changes, no user activation in the window, a file built by the extension, a short story session in Instagram's telemetry (the dwell lengthens it). Compared with the direct insert, the session is now consistent (`enter` event, non-empty `waterfall_id`, a sane duration).
- **Facebook:** Share follows the account's own cross-post setting, like a human Share; instapost records and shows it (OD12).
- **Fake:** models the + menu (lazy, both orders, optional third item), the session start, the composer DOM, v1/v2 footers, Instagram's real XHR upload and publish with `responseStatus`, success and failure reactions, buffer clearing, and records `DOUBLE_SHARE`, `RETRY_CLICKED` and taps outside the allow-list as violations. Its CORS preflight must echo the requested headers (`*` fails for credentialed requests).

---

## 11. Risks and open decisions

**Risks** (strategy §9.1 update in AM39):

- **R1** (restriction of the account): the mitigation "the human clicks Share" becomes "audited taps of +, Story and Share only, Share once, human-paced dwell, no retries"; likelihood unchanged or higher (unverified).
- **R7** (untrusted events ignored): the autopilot fails closed (`STORY_ENTRY_MISSING`, `INJECTION_IGNORED`, or Couldn't confirm after Share); Finish by hand and the phone remain.
- **R10** (wrong account): account lock and prompt (§4.8), replacing "human review before Share".
- **R15** (blocked uploads in Instagram's telemetry): the Test run stops before Share; the Share test is rare and deliberate.
- **R18** (new) Instagram notices automation: untrusted clicks, no user activation, extension-built File, short sessions. Owner-accepted (OD9); human-paced dwell; rate guard; kill switch.
- **R19** (new) A false "Posted" or a double post: Posted needs a 2xx JSON publish answer; Share once; Retry never; the duplicate alarm; K8/K12 guard re-posting.
- **R20** (new) Locator drift (+ menu, footer, account link): every locator fails closed with a named code; fingerprints and structural fallbacks; a test run is suggested after drift.
- **R21** (new) An upload cut off by closing the window too early: windows close only per §4.6's table; a possibly running upload holds the window up to 15 min.
- **R22** (new) The owner's own click in the composer window during a run opens a real file chooser: the activation guard.

**Open decisions** (new ids; OD1–OD8 are taken in strategy §10):

| Id | Decision | Default in this spec |
|---|---|---|
| OD9 | Accept synthetic (untrusted) taps of +, Story and Share as the new footprint, moving instapost from assisted to automated use under Instagram's terms (research §5.8). Re-accept G5 before the primary account | Decided by the owner on 2026-10-13; G5 to re-accept |
| OD10 | One setup test required before the first autopilot post on an install | Yes |
| OD11 | Account lock on by default; a mismatch or an unreadable account asks before any tap | Yes |
| OD12 | When Instagram would also share to Facebook automatically: proceed and say so, or stop before Share | Proceed and say so |
| OD13 | The Instagram window takes focus during the run and is raised once if hidden | Yes |
| OD14 | Human-pace dwell between taps (about 6 s per post) | Yes |

---

## 12. Live checks

New items in `docs/live-checklist.md`, Arc, secondary account, live build from a green `pnpm run verify`, one window at a time, at least 60 s apart:

- **L18** Setup test (Test run, Share not pressed): C10 menu structure (count, order, Story index, icon hash, item tag and role), C11 armed time, C12 footer variant and Facebook badge, C14 account (exactly one candidate), no file chooser opened, the photo drawn. Expect `Test passed`, nothing on the profile.
- **L19** Share test, once ever: Share pressed, the upload entry with status 0, Instagram's failure toast, no publish request. Expect `Share test passed`.
- **L20** First autopilot post: the publish entry (status, `application/json`, no redirect), the upload status (200 visible through CORS?), went home, toast. Check on the phone, then delete it.
- **L21** L18 with Instagram in Spanish; L20 in Spanish on another day.
- **L22** Account lock: with another account logged in, a test run pauses with the account prompt before any tap; Cancel.
- **L23** Arc behaviour: the focused docked window is in front; clicking the editor mid-run raises it once; closing it after the photo is in the composer shows no "Leave site?" prompt; ⌥⇧S, ⌘↵ and ⌘O reach instapost.

Gate changes: **G5** re-accepted for OD9; **G7** reads "`expectedAccount` (detected) is the primary"; **G3** adds the outcome rules proven on the fake (E29–E43).
