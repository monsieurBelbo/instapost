# instapost · in-page UI: final spec (2026-10-14)

**Direction:** a merge of the two directions, called **Create dialog, quiet entry**.
- **From "native create":** the composer as a centred dialog shaped like Instagram's own Create dialog, with an instapost-owned scrim, plus the Hide button that turns into a chip.
- **From "quiet sheet":** the entry as its own row in Instagram's sidebar, the live phone as a picture-in-picture in the stage's corner, and the chip being the composer iframe itself.

**Mockup:** `final.html`, a clickable self-contained mockup kept with the owner (not published in this repository).
- theme, nav width and entry slot;
- the preview mode;
- the outcome of Post: posted, needs you, page in use, upload failed, unconfirmed;
- the Post-card state: ready, first post, spacing, other tab, paused, logged out;
- speed and motion.

**Not seen next to real Instagram yet.** Instagram's measurements here are approximate (**~**) and need the read-only checks in §11 (FV).

**Id prefixes:** none of them is used in inpage.md, ux.md, the audit or the two direction specs.

| Prefix | Covers |
|---|---|
| FD | decisions |
| FE | entry |
| FC | composer container |
| FS | states |
| FX | edge cases |
| FT | tokens |
| FA | accessibility |
| FR | removals |
| FV | checks |
| FI | implementation |

Existing ids (K1–K13, P1–P8, N*, V*, AN*, EN*) keep their meaning.

---

## 0. Decision

### 0.1 Comparison

| | Native create | Quiet sheet |
|---|---|---|
| **Strengths** | <ul><li>Instagram's own Create pattern (photo left, controls right), so it reads as at home.</li><li>Big stage: 371×660 at 1280×800.</li><li>**The scrim lives in the extension iframe**, so while it is open no click can reach Instagram. `PAGE_IN_USE` cannot happen, which settles "hands off until Share" (inpage.md §3.13; N5 proven in E52).</li><li>Same geometry as today's editor (stage plus a 340-px rail).</li><li>Thorough tokens and contrast.</li></ul> | <ul><li>**The entry is a row under Profile.** The account link is already required for account detection (C14), it takes one click, never overlaps an Instagram control, and shows progress and the result itself.</li><li>The photo stays the hero, with the phone as a small picture-in-picture.</li><li>**The chip is the panel iframe shrunk**, so a click on it never activates the engine frame.</li></ul> |
| **Weaknesses** | <ul><li>The entry needs two clicks, through Instagram's Create menu: it depends on the menu's markup and mount timing (NV1–NV3), dies on any outside press (the 300-ms survival hack), cannot join the menu's keyboard order, and sits beside Instagram's own items (branding risk).</li><li>The full-stage phone cross-fade replaces your photo with Instagram's screen.</li></ul> | <ul><li>**Non-modal.** Instagram stays clickable during a run, which invites the failure P1 must avoid (activation leads to a 30-s wait, then `PAGE_IN_USE`).</li><li>A 440-px column gives a stage of about 261×464 at 1280×800 (≈ 45 % of the dialog's area).</li><li>It needs a new one-column editor layout and on-canvas `contenteditable` text: a new text model.</li><li>It covers Instagram's right column.</li></ul> |
| **Breaks when Instagram changes** | <ul><li>The Create-menu card: **high**. Every menu redesign, and account-type variants.</li><li>The sidebar fallback: medium.</li><li>The dialog: none.</li></ul> | <ul><li>The nav row: **medium**. Profile link plus measured gap, with fallbacks.</li><li>The sheet: none.</li></ul> |
| **Cost (content script + extension iframe)** | <ul><li>Content script: menu detection, card, row, corner, chip, coach and engine placement.</li><li>Iframe: the editor grid as-is plus a dialog shell and a full-viewport transparent iframe (NV5).</li></ul> | <ul><li>Content script: row, corner, coach and engine placement.</li><li>Iframe: a **re-laid-out editor** (column, bottom toolbar, inline text) and a sheet ↔ chip.</li></ul> |

### 0.2 Decisions

| Id | Decision | From | Why |
|---|---|---|---|
| **FD1** | Merge: the dialog from native create, the entry and preview from quiet sheet | both | Keeps the most robust entry and the activation-safe container, and costs the least editor rework |
| **FD2** | **No Create-menu companion card** | dropped (NC F0) | Most fragile piece, needs two clicks, and sits next to Instagram's own items |
| **FD3** | The entry is a **nav-row twin in the nav's free space** (FE1–FE5) | QS QE1–QE4 | Stable anchor (AN3), one click, never on an Instagram control |
| **FD4** | The composer is a **centred modal dialog drawn by one full-viewport extension iframe**: scrim, dialog and outside close button all in it (FC1) | NC NC2, NC5 | Clicks never reach Instagram while it is open; Instagram sees no keys; familiar shape |
| **FD5** | The live phone is a **PiP in the stage**: Small (default) · Large · Hidden (FS7) | QS | The export stays the hero; the phone proves it is real without dominating |
| **FD6** | **Hide (Esc) turns the dialog into a chip in the entry's slot.** The chip is the same composer iframe resized; the live phone glides into its thumbnail (FS8) | NC NC4 + QS | Gives Instagram back mid-run; a click on the chip never activates the engine |
| **FD7** | During a run Esc **hides**; Stop always needs a click | NC | Overrides ux.md §4.14's "Esc = Stop": Esc must never cost a post |
| **FD8** | Needs-you moments **never reopen the dialog by themselves**. They show on the chip, the entry and the toolbar badge | NC | P7: never take focus. A modal popping up would block the page |
| **FD9** | Posted closes itself after **4 s**. Any press, key or wheel inside cancels it. **Hovering does not pause it**: the pointer is already resting over Post | NC + QS | Zero interaction after Post |
| **FD10** | Instagram's neutrals are read from its page; instapost's own **jade** accent; primary = text-colour fill (never Instagram blue or gradient) | NC §5 | Native but not impersonating |
| **FD11** | The editor's existing `1fr 340px` grid is reused inside the dialog. TopBar out, dialog header in | NC | Least rework (`src/ui/editor.css` already has this grid) |
| **FD12** | Steps are always visible in the rail during a run, not behind a disclosure | NC | Room is there; trust (P5) |

---

## 1. Surfaces, layering, activation (FI)

**FI1. Three pieces, one host.** The host is a `div` appended to `<html>` with a closed shadow root (P8: Instagram's DOM is never edited).

| Piece | Lives in | Holds |
|---|---|---|
| **Host UI** | Instagram's document (content script) | <ul><li>Entry row, tile or corner button.</li><li>Coach mark.</li><li>Tooltips.</li><li>The chip's status badge (`pointer-events:none`).</li><li>The engine container.</li></ul> |
| **Composer iframe** (one `chrome-extension://…` page, dynamic URL) | Extension origin | **Open:** full viewport, drawing scrim, dialog and outside ✕ / Hide. **Chip:** resized to the chip's rect, drawing the chip. **Closed:** 0×0 and `visibility:hidden`, kept loaded once preloaded |
| **Engine frame** (`https://www.instagram.com/`, per run) | Sibling of the composer iframe, direct child of the host | Instagram's mobile site. Restyled (transform, radius, opacity) between slots, **never re-parented** (that reloads it) |

**FI2. Stacking**, low to high:
1. Instagram.
2. Host z-layer 1: the entry and coach.
3. The engine in Hidden mode (opacity 0.01, under the stage or under the chip's thumbnail).
4. The composer iframe.
5. The engine in Small, Large or chip-thumbnail mode (`pointer-events:none`).
6. The chip badge.
7. The tooltip.

The host sits at the top of the page's stacking order. Idle entry points step aside from Instagram's overlays by occlusion (FE7); the chip and the live phone never do (FX4).

**FI3. Activation map** (inpage.md §3.13):

| Owner's input | Lands in | Activates the engine frame? |
|---|---|---|
| Anything in the dialog, the scrim or the chip | Extension origin | **No** (N5) |
| Entry row, tile, corner, coach | Instagram's top document | Yes. Harmless before Post. During a run this tab shows the chip instead of the entry |
| Instagram's page | Instagram | Yes. Before Share the agent waits up to 30 s, then `PAGE_IN_USE` (FX11) |
| The phone itself | — | Never: `pointer-events:none` (Finish by hand excepted) |

**FI4. Messaging.**
- All page ↔ composer traffic goes through the background port. Never `window.postMessage`, which Instagram's JS would see (R25).
- New and changed messages:
  - `inpage/composer {mode: closed|open|chip, rect?}`: background → content script; it sizes the iframe.
  - `inpage/slots {stage, pip, large, chipThumb, preview}`: composer → content script. Sent on layout, resize and preview changes.
  - `inpage/theme {scheme, tokens}`: content script → composer, on connect and on every change.
  - `inpage/state {run: {mode, step, progress, waiting, needs, shared, result}, lane}`: background → all Instagram tabs. It **replaces** the boolean `inpage/run-state`.

---

## 2. Entry (FE)

### FE1. The row: its own row below Profile (AN3)

- **Size and position:**
  - same left and width as Instagram's Profile item;
  - 48 high, padding 12, radius 8, gap 16;
  - a 24-px mark and a 16/20 label `New story`;
  - Instagram's hover colour (`--ig-hover`) and a press colour of 9 % text.
- **Placed only if** the free gap below Profile, up to the next control or the nav's bottom, is ≥ the measured row pitch (~52) + 8. Then the row sits 8 px below Profile.
- **Never** inserted into Instagram's nav DOM and never over an Instagram control.

### FE2. Above More (AN4)

- When FE1 has no room: bottom-aligned 8 px above the first item of the bottom group (More, Threads).
- Same look as FE1.

### FE3. Collapsed nav (~72 px)

- A **48×48 tile** in the same column.
- No label. A tooltip to the right: `instapost · New story ⌥⇧S`.

### FE4. Corner: no nav found and viewport ≥ 768

- A 40-px round button, top right, 16 px inset (AN7), page-elevated.
- Shown only if `elementsFromPoint` finds no Instagram control under it.
- Never bottom right: that is Instagram's Messages bubble (LY5).

### FE5. None

| When | Why |
|---|---|
| Viewport < 768 wide | Instagram's mobile layout |
| Login wall (FX7) | No nav or account link |
| Story viewer, modals, routes without the nav | Nowhere to anchor |
| Settings `Toolbar and ⌥⇧S only` | The owner's choice |

In all these cases the toolbar icon and ⌥⇧S still work.

### FE6. States

The accent colour is used **only** for state.

| State | Mark | Label (wide) | Tooltip (collapsed, or always when not idle) | Accessible name |
|---|---|---|---|---|
| Idle | Outline mark, jade dot | `New story`, plus a `⌥⇧S` key chip that fades in on hover or focus | `instapost · New story ⌥⇧S` | `instapost: new story` |
| Open (dialog open in this tab) | same | `New story` at **700**, like Instagram's current route; `aria-expanded=true` | — | same |
| Running in **this** tab, dialog hidden | — | The **chip** replaces the row in the slot (FS8) | — | — |
| Running in **another** tab | Jade 2-px ring that fills per step; mark at 66 % | `Posting… 0:07` (time in text-2, tabular) | `Posting in another Instagram tab · step 3 of 5` | `instapost: posting in another Instagram tab. Open.` |
| Needs you (another tab) | Jade dot | `Needs you` | `instapost needs you · Choose which account` | `instapost: needs you.` |
| Result in another tab (10 s) | Badge ✓, ! or ? | `Posted` · `Not posted` · `Check your story` | `Posted to @handle's story` · `Not posted · Open instapost to see why` · `Couldn't confirm · Check your story` | `instapost: {label}.` |
| Paused (lock) | Pause badge | `Paused` | `Desktop posting is paused until {date}` | `instapost: paused until {date}. Open.` |

### FE7. Tracking and hiding

- **Observers:**
  - ResizeObserver on the nav and Profile;
  - MutationObserver on the nav subtree;
  - a URL check on each change;
  - all coalesced per animation frame.
- **The nav is cached** and looked up again only when it is detached or the route changes. No scroll listener and no 1-s interval (EN5).
- **While the anchor's rect changes** (the nav animating 244↔72, Arc's sidebar toggling), the entry fades out over 120 ms and returns once the rect has been stable for 150 ms.
- **Occlusion check at every placement:** `elementsFromPoint` at the entry's centre, skipping the host, must hit the nav. Otherwise the entry fades out. This covers Instagram's Search and Notifications slide-outs, post modals, its Create dialog and the story viewer (EN3).
- **While the dialog is open,** the row stays (under the scrim) with its Open state.

### FE8. Coach mark

- **When:** once, on the first visit after the update, and only when FE1, FE2 or FE3 is placed.
- **Where:** 12 px right of the nav, at the entry's top, with an arrow pointing at the entry.
- **Size:** 268 wide, radius 12, popover elevation.
- **Copy:** title `Post a story from here`. Body: `instapost opens over Instagram, so you never leave the page. Shortcut ⌥⇧S`. Button: [`Got it`].
- **Dismissed** by Got it or by opening instapost. Never shown again.
- The row's own tooltip is suppressed while the coach shows.

### FE9. The mark

- A portrait card with an up arrow: 24 px, 2-px stroke, in the page's text colour.
- One jade dot (r 3) with a 2-px ring in the surface colour.
- **One mark everywhere:** the toolbar icon (replacing the flat purple square), the entry, the dialog header and the coach.
- No Instagram glyphs or gradients.

---

## 3. Composer container (FC)

### FC1. Shape

- A centred modal dialog, radius 12, drawn inside the full-viewport composer iframe.
- **Scrim** `rgba(0,0,0,.65)` in both themes.
- **Close button outside the dialog:** 40 px, a white glyph, 12 px from the viewport's top-right corner. It morphs between ✕ (`Close`) and Hide (minimise glyph, `Hide — posting carries on`).

### FC2. Header (44 px, 1-px separator)

| Position | Content |
|---|---|
| Left | Back (edit only, `Choose another photo`), then the mark |
| Centre | The title, 16/20 at 600 |
| Right | ⋯ (`More`). During a run it becomes the tabular clock `0:07` (`aria-hidden`) |

### FC3. Geometry

| Quantity | Rule |
|---|---|
| Vertical margin `mv` | 48 px (24 when the viewport is under 760 tall) |
| `bodyH` | `clamp(400, H − 2·mv − 44, 900)` |
| `stageW` | `bodyH × 9/16` |
| `rail` | 340 when W ≥ 1000, else 300 |
| Too wide | If `stageW + rail > W − 128`, the stage shrinks (minimum 225) and the height follows |
| Import width | `max(stageW, 420)`. It grows to `stageW + rail` over 280 ms when a photo loads |
| Small viewports | Under 720×560: a stacked sheet (16-px margins, stage on top up to 50 % of the height, rail scrolls below). Not mocked |

| Viewport | Dialog | Stage | Small PiP |
|---|---|---|---|
| 1030×700 (Arc sidebar shown) | 682×652 | 342×608 | 103×183 |
| ~1270×860 (owner's MacBook, sidebar shown) | 745×764 | 405×720 | 122×217 |
| 1280×800 | 711×704 | 371×660 | 111×197 |
| 1440×900 | 768×804 | 428×760 | 128×228 |
| 1512×982 | 814×886 | 474×842 | 140×249 |
| 1920×1080 and up | 846×944 (max) | 506×900 | 140×249 |

### FC4. Behaviour

| Action | Idle (import, edit) | During a run | On a result |
|---|---|---|---|
| Esc, outside ✕, scrim click | Closes. The draft autosaves; no "discard?" prompt | **Hides** to the chip (FS8) | Closes. A held phone goes to the chip (FS13) |
| Entry, ⌥⇧S, chip | Toggle open and closed | Opens straight into the run view | Opens the result |

- **Preload:** the composer page loads on the entry's hover or focus (or on the first ⌥⇧S) and stays loaded at 0×0. Later opens are instant, and the themed first paint means no white flash.
- **Theme:** the iframe's CSS `color-scheme` matches Instagram's, so Chromium never paints an opaque backdrop (NV5).
- **Opening and closing are local.** The content script resizes the iframe at once, then tells the background. ✕ never round-trips (PA5).

### FC5. Focus

| Moment | Focus goes to |
|---|---|
| Open, import | `Choose photo…` |
| Open, edit | The dialog (never Post) |
| Run | `Stop` |
| Account prompt | `Post as @other` |
| Result | Its primary button |
| Close | The element focused before opening, else the entry |

Programmatic focus never grants activation.

---

## 4. States (FS)

### FS1. Import

- **Drop area,** centred:
  - an 88-px glyph;
  - `Drop a photo here` (20/25 at 400);
  - `or paste one with ⌘V`;
  - [`Choose photo… ⌘O`] (primary);
  - `JPEG · PNG · WebP · AVIF` (12, text-2).
- **Footer** (1-px separator):
  - `Recent photos` (14/600) with the last 4 in a 4-up grid (radius 8, image outline);
  - on the right, `Continue draft · edited 11:02 ›`.
- **Dragging a file** over the dialog: a 2-px dashed jade outline on a soft jade fill, `Drop to use this photo`.
- **Errors** appear as one line under the button (danger, `role=alert`): `Can't open this file. instapost opens JPEG, PNG, WebP and AVIF. For iPhone HEIC photos, export a JPEG from Photos first.`
- **Toasts** (bottom centre of the stage or the import area, never bottom right):
  - `One photo per story: used the first one.`
  - `Photo replaced. Your text stayed.` `Undo ⌘Z`

### FS2. Edit: the stage

The stage is black and flush with the dialog's bottom-left corner. It is the export (the same `compose()` code).

- **Photo:** pan by dragging, zoom with the wheel, nudge with the arrows (⇧ for bigger steps).
- **Text layer:** drag to place it; double-click to edit.
- **Instagram's buttons** (G, on by default): ghost outlines of Instagram's top bar (top 12.5 %: progress bars, avatar, handle, ✕) and reply bar (bottom 11 %). Plain shapes only.
- **Tools:** 32-px round translucent buttons, 8-px gaps, just above the reply band, bottom left:
  - Zoom (opens a 148-px slider popover; `Zoom = −`);
  - Fit (`Fit whole photo F`);
  - Instagram's buttons (`Instagram's buttons G`).
- **Reset** (`Reset 0`): bottom right, shown only once something changed.
- **Hint:** `Drag to reposition` for 1.8 s after a photo loads.

### FS3. Edit: the rail (padding 16)

- **Account row:** a 32-px monogram, `@handle`, and `Your story` (12, text-2).
- **Tabs** `Photo | Text`: 40 high, a 1-px underline in the text colour (like Instagram's Filters | Adjustments), ←/→ to switch.
- **Photo tab:**
  - `Framing` [Fill | Fit];
  - `Zoom` `100%` (a 2-px track and a 16-px thumb);
  - `Rotate` `0°` [Left] [Right];
  - the hint `Drag the photo to move it, or use the arrow keys.`;
  - `Replace photo…`.
- **Text tab:**
  - a text box `Add text…` with a `0/200` counter (1-px `field-border`, focus 2-px jade ring);
  - `Style` [Plain | Highlight];
  - `Colour`: 6 swatches (White, Black, Yellow, Coral, Sky, Lime) plus a custom one, 28 px;
  - `Size` slider;
  - the hint `Drag the text on the photo to place it.`
- **No uppercase section headings.** Labels are 14/600 in sentence case.

### FS4. Post card: the sticky rail footer

The thumbnail is 27×48 and is the exact upload. Only the title, the note and the button change; there are no dialogs. The first match wins (ux.md §4.5 order).

| K | Title | Note | Button |
|---|---|---|---|
| K13 Ready | ✓ `Ready to post` | `1080 × 1920 · as @handle`, or an amber warning: `Text is under Instagram's top bar` / `…reply bar` | [`Post story ⌘↵`] primary, 40 px |
| K12 Posted < 24 h | ✓ `Posted at 14:32` | `You posted this story already.` | [`Post again ⌘↵`] secondary |
| K6 First post | `One test before your first post` | `About 20 seconds, nothing is posted. It also checks which account is logged in.` | [`Run setup test ⌘↵`] |
| K10 Spacing | ✓ `Ready to post` | `Posts are at least a minute apart.` | [`Post story · in 0:42`]. A click queues it |
| K11 Queued | `Starting in 0:42…` | `It starts by itself. You can close this.` | [`Cancel`] secondary |
| K9 Hour or day cap | `Pace limit reached` | `6 posts in the past hour.` / `15 posts today, the daily limit. Resets at midnight.` | [`Available at {time}`] disabled |
| K7 Another tab | `Posting in another Instagram tab` | `One post at a time.` `Show it` | [`Posting…`] disabled |
| K4 Paused | `Paused` | `Send to phone… still works (in ⋯).` plus the banner (FX9) | [`Paused until Tue 20 Oct`] disabled |
| **KL Logged out** (new) | `Not logged in` | `Log in to Instagram to post a story.` | [`Post story`] disabled |
| K8 Unconfirmed < 24 h | ? `This story may already be posted` | `14:32, not confirmed.` `It didn't post — post again` | [`Check my story`] |
| K2, K3, K5 | as ux.md §4.5 | | |

- **Secondary actions** (`Test run`, `Save copy`, `Send to phone…`) live in ⋯ (FS14), not under the button, to keep the footer calm.
- **Test run** chip in the rail during a test: `Test run — nothing will be posted` (warn-soft fill).

### FS5. Run

| Area | Content |
|---|---|
| Header | Title `Posting…` (Test run: `Test run`). The clock replaces ⋯ |
| Outside button | Hide (`Hide — posting carries on`) |
| Stage | The export stays, under a light bottom veil. The live phone appears per FS7 |
| Rail | <ul><li>Account row: `@handle` · `Posting to your story` (Test run: `Test run · nothing will be posted`).</li><li>The test chip, if any.</li><li>A **5-segment progress bar** (3 px, 4-px gap, jade; a failed segment turns red).</li><li>The **steps** (FS6).</li><li>One **note** (info: surface-2 with an info glyph; warn: warn-soft with a clock glyph).</li></ul> |
| Footer | [`Stop`] [`Hide Esc`], both secondary. **After Share:** `Instagram is uploading — this can't be stopped now.` (12, text-2) above a full-width [`Hide Esc`] |

Notes, one at a time:

| When | Note |
|---|---|
| Before Share | `Usually 15–25 seconds. If you hide this, keep hands off Instagram until Share.` |
| After Share | `Shared. You can close this and keep browsing — instapost confirms in the background.` |
| Waiting (warn) | `Waiting until you stop clicking on Instagram for a moment…` |
| 20 s after Share | `Still uploading. Keep this Instagram page open.` |
| 60 s after Share | `Instagram is slow. instapost keeps waiting and won't post twice.` |
| Tab hidden (warn) | `Paused: this tab is in the background. Come back to it to continue.` |
| Port lost | `Reconnecting to instapost…` |

### FS6. Steps

| State | Glyph (20 px) |
|---|---|
| Pending | ○ |
| Active | Jade spinner; the text goes to 600 |
| Done | Jade ✓ |
| Failed | Red ! |
| Unconfirmed | Amber ? |
| Skipped | – |

Every change of state also changes the text.

| Step | Pending | Active | Done | Test run |
|---|---|---|---|---|
| 1 | `Open Instagram` | `Opening Instagram's mobile site in this tab…` | `Instagram open — mobile site in this tab` (the size moves to Details) | same |
| 2 | `Check the account` | `Checking who's logged in…` · prompt: `Waiting for you to choose the account…` | `Logged in as @handle` · `Logged in as @other — you chose to post` | same |
| 3 | `Start a story with your photo` | `Starting a story and adding your photo…` | `Photo is in Instagram's story editor` | same |
| 4 | `Share` | `Pressing Share…` → `Instagram is uploading…` | `Shared` (+ ` · also to Facebook`) | pending `Find Share — not pressed`; done `Share button found — not pressed (test run)` |
| 5 | `Confirm` | `Waiting for Instagram to confirm…` | `Instagram confirmed the story` | pending `Skipped in a test run`; done `Skipped (test run)` |

- A failed step's text becomes the error title, e.g. `You were using Instagram`.
- An unconfirmed step 5 reads `Instagram didn't confirm in time`.
- In results the steps stay, compact: 13 px, 4-px rows.

### FS7. Live preview (the engine frame, restyled)

The composer reports its slots (FI4). The content script applies `transform: translate() scale()`, a radius and a shadow to the engine container. The frame stays at `frameBox(dpr)` (540×960 CSS px at DPR 2), so the upload stays 1080×1920 whatever the preview size.

| Mode (Settings `While posting, show Instagram`) | Slot | Look |
|---|---|---|
| **Small** (default) | Bottom right of the stage, 12-px inset, width `clamp(30 % of stageW, 96, 140)`, 9:16 | Radius 10, a 1-px `rgba(255,255,255,.16)` edge, shadow `0 10px 26px -6px rgba(0,0,0,.45)` |
| **Large** | Centred in the stage under a 48-px caption band; height `stage − 60` | Radius 12; the export behind it turns black |
| **Hidden** | The stage's rect, **under** the composer iframe, opacity 0.01 (N15) | The stage shows the export, dimmed, with a step pill (13 px, bottom centre, above the reply band) that repeats the active step |

- **Reveal:** only after the frame's first `load` plus one frame (RV7). Until then the Small or Large slot shows a themed placeholder: a spinner and `Opening Instagram…`.
- **Caption:** a pill at the top left of the stage: `● Live preview · Instagram mobile site` (jade dot). When held: amber dot and `Live preview · Instagram may still be uploading`.
- **Size tool:** a 32-px round button at the stage's top right, `Enlarge` / `Shrink`. A click on the small phone also enlarges it: the click falls through to the composer's own button underneath, because every engine wrapper has `pointer-events:none`. The choice becomes the default for next time.
- **End of the run:**

| Result | The phone… |
|---|---|
| Posted | stays on Instagram's home for 2 s (its own success toast), then fades (200 ms) and the frame is removed |
| Failure after Share | stays 3 s |
| Failure before Share | goes at once |
| Couldn't confirm | is **held** (FS13) |

- **Tap echo** (optional; cut if it costs agent changes): Large only. A 34-px jade ripple (560 ms) at each tap rect the agent reports: +, Story, Share.
- **Finish by hand** (ux.md §4.9):
  - the phone takes the Large slot (scale ≈ 0.85 of the stage height) and its pointer events turn on;
  - the caption reads `Your turn · tap in the phone`;
  - the note gives ux.md's text with "the phone" instead of "the Instagram window": `In the phone, tap +, then Story, and pick {file} from Downloads/instapost. Then tap Share. instapost watches and confirms the post.`

### FS8. Hidden: the chip

The composer iframe is resized to the chip's rect and draws the chip. The host draws only the badge (`pointer-events:none`). The engine glides (280 ms, transform and radius only) from its stage slot into the chip's thumbnail, above the iframe.

**Slot:**

| Entry | Chip |
|---|---|
| FE1 or FE2 placed, wide nav | The entry's left and width, 76 high (it replaces the row). Needs a gap of ≥ 84, else top right |
| Collapsed nav | Compact 48×76: the thumbnail only, with a tooltip `{line 1} · {line 2}` |
| FE4, FE5, or no gap | 240×76, top right, 16-px inset. If an Instagram control is under it: bottom left, then top left. Never bottom right |

**Layout:**
- radius 12, popover elevation;
- a 36×64 thumbnail (radius 6): the **live phone** while a run shows it, else the export;
- two text lines: 14/600 and 12 text-2, tabular;
- a 2-px progress bar along the bottom (jade; amber when waiting or unconfirmed; red on failure);
- a 20-px status badge at the thumbnail's top right, drawn above the phone.

| State | Line 1 | Line 2 | Badge | Lifetime |
|---|---|---|---|---|
| Running | `Posting · 0:07` (`Test run · 0:07`) | `Hands off until Share` → `Uploading — browse freely` | — | until the result |
| Waiting | `Posting · 0:12` | `Waiting for you to stop…` (amber) | clock, amber | until the click stops |
| Needs you | `Needs you` | `Choose the account · 0:58` (jade) | ?, jade | until the choice or 60 s |
| Queued | `Starts in 0:42` | `Posts are a minute apart` | clock | until it starts or is cancelled |
| Posted | `Posted to your story` | `14:32 · confirmed` | ✓, jade | 10 s |
| Test passed | `Test passed` | `Nothing was posted` | ✓ | 10 s |
| Stopped | `Stopped` | `Nothing was posted` | — | 10 s |
| Not posted | `Not posted` | `See why` | !, red | until opened |
| Couldn't confirm | `Couldn't confirm` | `Check your story` | ?, amber | while held, then until opened |

- **Accessible name:** `instapost: {line 1}. {line 2}. Open.` A click opens the dialog in its run or result view.
- **A queued post** that starts while the dialog is closed shows only on the chip. The dialog never reopens by itself (FD8).

### FS9. Needs you: the account prompt (ux.md §4.8)

- **Where:** a card at the top of the run rail: jade-soft fill, a 1-px jade 35 % inset ring, radius 12.
- **Copy:**
  - title `Instagram is logged in as @other`;
  - body `You usually post as @handle. Nothing is posted until you choose.`;
  - [`Post as @other`] primary · [`Cancel`] secondary;
  - `Cancels itself in 0:58` (12, tabular).
- **Unreadable account:** `instapost couldn't tell which account is logged in. The live preview shows it.` [`Post anyway`] [`Cancel`].
- **No account expected yet:** `Instagram is logged in as @other. Post as @other?`
- **While the dialog is hidden:** the chip shows `Needs you`, the toolbar badge shows `…`, and the live region announces it if focus is in the composer. **The dialog is not reopened.**
- **After 60 s:** `ACCOUNT_UNCONFIRMED` (FS11).

### FS10. Header titles

| View | Title |
|---|---|
| Import, edit | `New story` |
| Run | `Posting…` · `Test run` |
| Result | `Story posted` · `Not posted` · `Check your story` · `Test passed` · `Stopped` · setup test passed: `Ready to post` |

### FS11. Results

**Layout:**
- The result replaces the rail's body below the compact steps, entering with a 70-ms stagger:
  1. a 40-px icon (✓ jade solid · ! danger-soft · ? warn-soft · ✕ neutral);
  2. the `Not posted` kicker (12/600, danger) on failures;
  3. the title (20/24 at 600, balanced);
  4. one sentence (text-2);
  5. at most one sub-line (12);
  6. `Saved a copy: Downloads/instapost/{file} · Show` on every failure after the export;
  7. `Details ▸` with a key–value list, the code and `Copy diagnostics`.
- **Footer:** one primary and at most one secondary, both 40 px.
- **Posted** also pops a 64-px jade ✓ seal on the stage for 1.6 s.

| Result | Title | Body | Primary | Secondary |
|---|---|---|---|---|
| Posted | `Posted to @handle's story` | `14:32 · took 18 s · Instagram confirmed it.` | `View story` | `New story N`, then the auto-close row (FS12) |
| Posted, duplicate | `Posted — check for a duplicate` | ux.md §4.7 | `View story` | `New story N` |
| Test passed | `Test passed` | `Everything up to Share works, and you're posting as @handle. Nothing was posted.` | `Post story ⌘↵` | `Done` |
| Setup test passed | `Ready. You're posting as @handle.` | `The setup test passed: everything up to Share works. Nothing was posted. From now on, Post story posts.` | `Post story ⌘↵` | `Done` |
| Stopped | `Stopped. Nothing was posted.` | — | `Post story ⌘↵` | `Done` |
| `PAGE_IN_USE` | `You were using Instagram` | `instapost doesn't tap while you click or type on Instagram, so it stepped back. Nothing was posted.` | `Try again` | `Finish by hand` |
| `UPLOAD_FAILED` | `Instagram didn't accept the story` | `Instagram answered that the upload failed ({detail}), so your story wasn't posted. instapost never retries on its own.` | `Try again` | `Send to phone…` |
| `ACCOUNT_UNCONFIRMED` | `Posting cancelled` | `Instagram was logged in as @other, not @handle, and nobody confirmed within a minute. Nothing was posted.` | `Try again` | `Settings` |
| `OUTCOME_UNKNOWN` | `Couldn't confirm the post` | `instapost pressed Share, but {why}. Check your story before you post this photo again.` + `Instagram may still be uploading in this tab. Keep this page open.` (when held) | `Check my story` | `It posted · It didn't post` (links; they only correct History and the duplicate guard) |
| `FRAME_REFUSED` | `Instagram didn't open inside the page` | `Instagram's mobile site refused to load here ({detail}). Nothing was posted.` | `Use a separate window` | `Send to phone…` |
| `PAGE_LEFT` | `Stopped — you left the Instagram page` | `The page reloaded or closed, so instapost stopped. Nothing was posted.` | `Post story` | — |
| `TAB_HIDDEN` | `This tab was in the background` | `Instagram pauses pages you're not looking at, and this one stayed in the background for 2 minutes. Nothing was posted.` | `Try again` | `Send to phone…` |
| `NOT_LOGGED_IN` (in-page) | `Log in to Instagram first` | `Instagram asked to log in. Log in on this page, then post again. instapost never logs in for you. Nothing was posted.` | `Done` | `Try again` |
| `KILLED_CHALLENGE`, `KILLED_OFFHOST` | ux.md §5 (`window` → `page`) | | `Send to phone…` | — |
| Every other code | ux.md §5 and inpage.md §7.9, in this same card | | | |

- **`{why}` additions:** `page closed` → `the Instagram page was closed before Instagram answered`.
- **Buttons:**
  - **View story** and **Check my story** navigate **this tab** to `/stories/<handle>/` once the run is closed (a page load).
  - **Try again** is a new click, paced by the rate guard (`Try again · 0:41`).
  - **New story** clears the draft and returns to import.
- **Details rows:** as ux.md §4.13. The Window row becomes **Frame**: `540 × 960 at DPR 2, in this tab · U3 · rules 1001, 1020`.

### FS12. Auto-close (Posted only)

- A 2-px bar (text-2 on sep) shrinks over 4 s.
- Text: `Closes in 4 s` … `1 s`, with `Keep open` at the right.
- Any pointerdown, key or wheel inside the composer cancels it. The bar and the line then disappear.
- On close, the chip shows Posted for 10 s.
- Failures, Couldn't confirm and test results never close by themselves.

### FS13. Couldn't confirm: held

- The phone **stays** (Small slot, amber caption) while Instagram may still upload (ux.md §6.4: up to 15 min; closed earlier by a late answer).
- Closing the dialog moves the phone into the chip, with the ? badge and `Couldn't confirm` / `Check your story`.
- K8 then shows in the Post card for 24 h.

### FS14. Sheets and menus inside the dialog

Sheets cover the dialog's body under the header, fade in with a 6-px rise, and close with Esc.

- **⋯ menu:** radius 12, 40-px rows, arrow keys plus Home and End, Esc returns focus to ⋯.

  | Item | Key | Notes |
  |---|---|---|
  | `Test run` | ⌥⌘↵ | Disabled without a photo |
  | `Save copy` | | Disabled without a photo |
  | `Send to phone…` | | |
  | — separator — | | |
  | `History` | H | |
  | `Settings` | , | |
  | `Keyboard shortcuts` | ? | |

- **Settings:**

  | Section | Content |
  |---|---|
  | `On Instagram` | <ul><li>`Show New story in Instagram's sidebar` [`In the sidebar` \| `Toolbar and ⌥⇧S only`].</li><li>`While posting, show Instagram` [`Small` \| `Large` \| `Hidden`], with the help line `Instagram's mobile site runs in this tab while instapost posts. Hidden keeps it out of sight.`</li></ul> |
  | `Account` | <ul><li>Monogram and `Posts go to @handle`, with `Detected 14 Oct, 14:02` and [`Check again`].</li><li>☑ `Only post as @handle` · `Ask before posting if Instagram is logged in as someone else.`</li><li>`Forget this account`.</li></ul> |
  | `Copies` | ☐ `Also keep every posted story in Downloads/instapost` · `Stories that are not posted are always saved there.` |
  | `Pace and safety` | `At most 1 post a minute, 6 an hour and 15 a day. Tests and checks count too. Today: 2 posts · this hour: 1.` |
  | **`Advanced`** (collapsed by default) | <ul><li>`Check connection` · `Opens Instagram's mobile site in this tab, reads the account and stops. Posts nothing.` [`Run`]</li><li>`Share test` · `Presses Share with publishing blocked, to prove instapost can read Instagram's upload. Use it once.` [`Run…`] (asks once more inline)</li><li>`Post using` · `A separate window is the older way, kept as a fallback.` [`This tab` \| `A window`]</li><li>`Diagnostics` · `The last 20 runs, structural facts only (includes your username).` [`Copy`]</li><li>`Build: live · in-page · Arc 155`</li></ul> |
  | **`Developer`** (dev and guarded builds only, under Advanced) | The S12 toggles `ua`, `frame`, `view`, `xfoRule`. Never in the live build |

  While a run is active, settings that change a run are disabled with `A post is running; this applies to the next one.`

- **History:** ux.md §4.11 as a sheet: `Posts today 3 / 15 · this hour 1 / 6`, rows by day, `View story` on Posted rows under 24 h old.
- **Keyboard shortcuts:** a two-column list (FA4).
- **Guarded builds:** a small `Test build` chip in the header, left of ⋯. It replaces the red SPIKE bar.

---

## 5. Edge cases (FX)

| Id | Case | Behaviour |
|---|---|---|
| **FX1** | Instagram navigates within the page (feed → profile, Back): a same-document route change | **Nothing stops.** The dialog, chip and phone stay; the host survives (N14). The entry and chip re-anchor on the next frame. While the dialog is open the scrim blocks clicks, so only the browser's Back or Forward can do this |
| **FX2** | A full page load **before Share** (reload, typed URL, a link that loads a document) | `PAGE_LEFT`, no lock, rules removed. The new page's entry shows ! for 10 s, and opening instapost shows the card |
| **FX3** | A full page load **after Share** | First the browser's own `Leave site?` (the content script's `beforeunload`; N11). If the owner leaves anyway: Couldn't confirm, with `the Instagram page was closed before Instagram answered` |
| **FX4** | Instagram overlays (post modal, Search or Notifications panel, its Create dialog, the story viewer) | <ul><li>**Idle entry:** fades out by occlusion (FE7).</li><li>**Chip and live phone during a run:** stay on top, because rendering needs them on screen (N17). If the chip's slot disappears, it moves to the next free corner (FS8).</li></ul> |
| **FX5** | Instagram moves the page itself to a checkpoint or login (F8) | The kill switch: `KILLED_CHALLENGE` with the 7-day lock, or `NOT_LOGGED_IN`. The owner sees Instagram's page; the next dialog shows the pause banner |
| **FX6** | Several Instagram tabs | <ul><li>One run at a time (`HANDOFF_BUSY`); it belongs to its tab.</li><li>Other tabs: entry FE6 "Running in another tab" and Post card K7 with `Show it`, which activates that tab only on that click (never by itself, P7).</li><li>One draft, last write wins. A dialog that regains focus with a newer draft reloads it and toasts `Updated from another tab`.</li><li>A queued post belongs to the tab that queued it.</li></ul> |
| **FX7** | Login wall (no nav or account link, or a `/accounts/login` route) | <ul><li>No entry.</li><li>The toolbar or ⌥⇧S still opens the dialog: editing and drafts work, and the Post card is KL.</li><li>Logging in reloads the page, and the entry appears.</li><li>A session that expires mid-run gives `NOT_LOGGED_IN` (FS11).</li></ul> |
| **FX8** | Rate guard | K9 caps, K10 spacing, then K11 queued. A queue survives closing the dialog (chip "Queued"). A queued start never reopens the dialog |
| **FX9** | Pause lock (`MSITE_LOCKED`) | <ul><li>A banner at the top of the rail: a pause glyph on warn-soft, radius 12.</li><li>Title `Desktop posting is paused until Tue 20 Oct, 14:05`, with ux.md §4.10's reason text.</li><li>[`Send to phone…`] and `Resume…`. Resume expands inline: `Resume desktop posting? Only resume once you've opened Instagram on your phone and the account works normally there.` ☐ `The account works normally on my phone` [`Resume`].</li><li>Post card K4; entry `Paused`.</li></ul> |
| **FX10** | Tab hidden before Share | Taps wait, with the note `Paused: this tab is in the background…`. After 2 min: `TAB_HIDDEN`. instapost never switches back to the tab. After Share, hidden is fine |
| **FX11** | The owner clicks Instagram while the run is hidden, before Share | The chip turns amber (`Waiting for you to stop…`) and the dialog's note says the same. The agent waits up to 30 s of quiet, then `PAGE_IN_USE`. While the dialog is open this cannot happen (FI3) |
| **FX12** | The viewport changes mid-run (Arc's sidebar ⌘S, window resize, the nav switching wide ↔ collapsed) | The dialog relays out (FC3), the composer re-reports its slots, and the engine is re-transformed (no reload). The chip follows the entry slot. The entry fades during the change (FE7) |
| **FX13** | Instagram's theme changes | New tokens over the port. Transitions are off for one frame so colours snap. The iframe's `color-scheme` is updated |
| **FX14** | Extension updated or reloaded | <ul><li>The old host removes itself once `runtime.id` is gone (no dead `chrome-extension://` frame, EN10).</li><li>The background re-injects into open Instagram tabs.</li><li>A run in progress follows the worker-restart rules: before Share, `Stopped. Nothing was posted.`; after, Couldn't confirm.</li><li>If re-injection fails, the toolbar opens the editor tab with `instapost was updated. Reload your Instagram tab to post from it.`</li></ul> |
| **FX15** | Narrow: under 768 wide | No entry; the dialog is the stacked sheet (FC3); the chip goes top right after the occlusion check. Never bottom right |
| **FX16** | Spanish Instagram, Spanish instapost | Anchors are structural (no text read). Every string goes through the `feat/es-locale` catalog, entry label included (EN11) |
| **FX17** | `FRAME_REFUSED` | The card (FS11). After two in a row the Post card suggests `A separate window` once |
| **FX18** | Instagram's own shortcuts | instapost binds nothing on Instagram's page (no Esc, no chords). ⌥⇧S is the browser command (L23). Keys typed in the dialog never reach Instagram (cross-origin) |
| **FX19** | Closing mid-edit | Always allowed. The draft autosaves 500 ms after each change. No "discard?" prompt |
| **FX20** | ⌥⇧S or the entry while open | Toggles: closes when idle, hides during a run |

---

## 6. Tokens (FT)

**FT1. Theme source.**
- Instagram's own appearance, **not** the OS: the computed luminance of `body`, or the nav's background, with the `--ig-*` variables as a fast path (V5), watching `<html>` attribute changes.
- **The host UI** (entry, coach, tooltip, badge) uses the page's own colours, read at runtime.
- **The composer** gets the tokens below over the port.

**FT2. Page colours read at runtime** (defaults ~):

| | Light | Dark |
|---|---|---|
| `ig-bg` | #ffffff | #000000 |
| `ig-elev` | #ffffff | #262626 |
| `ig-text` | #000000 | #f5f5f5 |
| `ig-text-2` | #737373 | #a8a8a8 |
| `ig-sep` | #dbdbdb | #262626 |
| `ig-hover` | rgba(0,0,0,.05) | rgba(255,255,255,.1) |

**FT3. Composer colours.** Contrast is measured on `surface` unless stated otherwise.

| Token | Light | Dark | Use |
|---|---|---|---|
| `surface` | #ffffff | #262626 | dialog, popovers, chip |
| `surface-2` / `-hover` | #efefef / #dbdbdb | #363636 / #474747 | secondary buttons, notes, segmented track |
| `seg-on` | #ffffff | #4f4f4f | selected segment |
| `text` | #000000 | #f5f5f5 (13.9:1) | |
| `text-2` | #737373 (4.7:1; **never on surface-2**) | #a8a8a8 (6.4:1) | secondary text |
| `text-2-fill` | #636363 (5.2:1 on #efefef) | #a8a8a8 (5.1:1 on #363636) | secondary text on surface-2 (unselected segments) |
| `sep` | #dbdbdb | #363636 | dividers (decorative) |
| `field-border` | #8e8e8e (3.3:1) | #737373 (3.2:1) | text box edge |
| `hover` | rgba(0,0,0,.05) | rgba(255,255,255,.08) | |
| `primary-bg` / `-hover` / `-fg` | #000 / #262626 / #fff | #f5f5f5 / #dbdbdb / #000 | Post story; **never Instagram blue** |
| `accent` | #0b7a6c (5.2:1) | #3dd6be (8.3:1) | mark dot, progress, done, focus ring, live dot. Jade sits outside Instagram's gradient |
| `accent-soft` / `on-accent` | rgba(11,122,108,.10) / #fff | rgba(61,214,190,.14) / #00231e (9.2:1) | drop overlay, prompt |
| `danger` / `-soft` | #c62828 (5.6:1) / 8 % | #ff6b6b (5.5:1) / 13 % | |
| `warn` / `-soft` / `on-warn` | #a15c00 (5.2:1) / 10 % / #fff | #ffb547 (8.6:1) / 13 % / #000 | |
| `scrim` | rgba(0,0,0,.65) | same | |
| `img-outline` | 1 px rgba(0,0,0,.1) | 1 px rgba(255,255,255,.1) | every photo and thumbnail |
| tooltip, toast | #262626 bg / #f5f5f5 fg | #363636 bg / #f5f5f5 fg | |

**Elevation:**

| Level | Light | Dark |
|---|---|---|
| Popover (menus, chip, coach, corner) | `0 4px 12px rgba(0,0,0,.15)` | `0 8px 24px rgba(0,0,0,.55)` plus a 1-px #363636 border |
| Dialog | `0 12px 32px rgba(0,0,0,.18)` | none (the scrim does the work) |

**FT4. Type.** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`, sentence case only.

| Size | Use |
|---|---|
| 11/16 (500) | key chips |
| 12/16 | secondary text, captions, Details |
| 13/16 | compact steps, run pill |
| 14/18 | body and menus; buttons and labels at 600 |
| 16/20 | dialog title (600), entry label (400; 700 when open) |
| 20/24 | result titles (600); import title (400) |

- Story text (content, not UI): Instrument Sans 600.
- Timers use tabular numbers.

**FT5. Spacing.**
- 4-px grid: 4 · 6 (popover inset) · 8 · 12 · 16 (rail padding) · 20 (field gap) · 24 · 32.
- Dialog margins: 48 (or 24) vertical, at least 64 horizontal.

**FT6. Radii** (outer = inner + padding):

| Radius | Used for |
|---|---|
| 4 | key chips, the export thumbnail |
| 6 | menu rows, segment thumb, chip thumbnail |
| 8 | buttons, inputs, notes, tooltips, toasts, nav-row twin |
| 10 | small phone |
| 12 | dialog, popovers, coach, chip, prompt, pause banner, large phone |
| 999 | pills, swatches, stage tools |

**FT7. Motion.** Transitions name their exact properties; none uses `all`.

| Duration | Easing | Used for |
|---|---|---|
| 120 ms | — | hover, colour, press (`scale .96`), entry fade |
| 150 ms | `cubic-bezier(.2,0,0,1)` | menus (fade + 4 px) |
| 200 ms | `cubic-bezier(.2,0,0,1)` | dialog (fade + scale .96 → 1), scrim, chip, phone reveal and fade |
| 280 ms | `cubic-bezier(.2,0,0,1)` | import → edit width growth, phone ↔ chip glide (transform and radius only), progress segments, result entrance (70-ms stagger) |
| 500 ms | — | entry ring step fill |
| 560 ms | — | tap echo |

- **Icon swaps:** opacity, scale .25 → 1, blur 4 → 0.
- **Theme switch:** no transitions for one frame.
- **Reduced motion:** no scale, translate or blur; opacity only at 100 ms; the width change and the glide are instant; spinners and the ring are static; no tap echo and no seal pop (the seal simply appears).

---

## 7. Accessibility and keyboard (FA)

- **FA1. Dialog.**
  - `role=dialog aria-modal=true`, labelled by its title.
  - Focus is trapped inside the composer iframe, including the outside close button; focus moves per FC5.
  - The iframe has `title="instapost"`.
- **FA2. Entry.**
  - A `button` with `aria-haspopup=dialog`, `aria-expanded` and `aria-keyshortcuts="Alt+Shift+S"`, and the state-aware name from FE6.
  - Targets: the row 48, the tile 48, the corner 40.
  - The host is the last tab stop on the page (AK1). The keyboard path is ⌥⇧S, which every tooltip and the coach advertise.
- **FA3. Live region** (polite, atomic): only step changes, needs-you moments and results. The clock is `aria-hidden`; the progress bar is `aria-hidden` (the steps carry the text).
- **FA4. Keys.** Single-letter keys are off while typing; nothing is bound on Instagram's page.

  | Keys | Action |
  |---|---|
  | ⌥⇧S | Open or close (or hide) instapost, anywhere on Instagram |
  | ⌘↵ | The Post card's primary button |
  | ⌥⌘↵ | Test run |
  | ⌘O · ⌘V | Choose · paste a photo |
  | Esc | Close a menu, then a sheet, then the zoom popover, then the dialog; **hide** during a run |
  | T | Edit text |
  | G | Instagram's buttons |
  | F | Fill / Fit |
  | 0 | Reset |
  | = · − | Zoom in · out |
  | Arrows (⇧ for 10×) | Nudge, when the stage has focus |
  | N | New story, after a result |
  | H · , · ? | History · Settings · Shortcuts |

- **FA5. Stage.** `role=img` with `aria-roledescription="story editor"` and the label `Story preview. Drag, or use the arrow keys, to reposition the photo.` It is tabbable only while editing.
- **FA6. Contrast.**
  - Every text token is ≥ 4.5:1 in both themes (FT3).
  - Component edges and the focus ring are ≥ 3:1: a 2-px accent ring with a 2-px offset everywhere, inset 2 px on the stage.
  - Dividers are decorative.
- **FA7. Hidden layers** (closed menus and sheets, the zoom popover, the chip while closed, a dimmed Reset) use `visibility:hidden`, so they leave the tab order.
- **FA8.** Icons are never the only signal: every state change also changes text.

---

## 8. Responsive summary

| Viewport | Instagram nav (~) | Entry | Dialog | Chip |
|---|---|---|---|---|
| ≥ 1264 wide | wide (244) | FE1 row, or FE2 | FC3 table | entry width (~220) × 76, in the slot |
| 768–1263 | collapsed (72) | FE3 tile | FC3 table (rail 300 under 1000) | compact 48×76 |
| < 768 | Instagram's mobile bars | none (FE5) | stacked sheet | top right |
| any, < 720×560 | — | as above | stacked sheet | as above |

The owner's MacBook in Arc with the sidebar shown (~1270) sits on the 1264 breakpoint: ⌘S flips the nav live (FX12).

---

## 9. Copy not already given above

- **Toasts:**
  - `Saved a copy to Downloads/instapost`;
  - `Diagnostics copied` · `Structural facts only; includes your username.`;
  - `Updated from another tab`;
  - `Marked as posted by you` / `Marked as not posted by you`.
- **Tooltips** (dialog: 350-ms delay, above the control):
  - `Choose another photo`
  - `instapost` (the header mark)
  - `Zoom = −`
  - `Fit whole photo F`
  - `Instagram's buttons G`
  - `Reset 0`
  - `Enlarge` / `Shrink`
- **Send to phone…** uses `navigator.share` in the composer. If it is refused (N13), it opens the editor tab to share.
- **Every string** goes through the `feat/es-locale` catalog.

---

## 10. Delete from today's panel (FR)

- [ ] **FR1** The violet `#7c3aed` `+ Story` pill and its drop shadow, its placement inside Create's row, and the 28-px badge below Create (EN1, EN2, EN6).
- [ ] **FR2** The right-edge, vertically centred 36-px fallback, its drag-to-move and its stored position.
- [ ] **FR3** `opacity:.6` as the running state, and the boolean `inpage/run-state` (replaced by `inpage/state`, FI4).
- [ ] **FR4** The 1-s re-measure interval and `findAnchor` on every scroll event.
- [ ] **FR5** The 440-px right drawer: `clamp(420px,44vw,760px)`, the `display` toggling, the fixed `#fff` / `#0e0f11` colours, the `0 12px 40px rgba(0,0,0,.28)` shadow, ✕ round-tripping through the background, the `–` minimise and the 72×128 chip under the pill (inpage.md §7.3, §7.4).
- [ ] **FR6** The separate `.phone` card left of the drawer (radius 14, outline), the floating white `Instagram, mobile site` caption, and the covered phone at z 0 / opacity .01 over Instagram's page.
- [ ] **FR7** The spike UI:
  - the red SPIKE bar and `instapost · in-page spike (S12)`;
  - the `ua`, `frame`, `view` and `xfoRule` radios (to Developer, dev builds only);
  - `rule 1001` and `Sec-Fetch-Dest` labels;
  - the Run check / Run test / Share test row and its checkbox (Check and Share test go to Advanced; Test run goes to ⋯);
  - the open JSON record and the `title — CODE (detail)` outcome line (replaced by Details and Copy diagnostics).
- [ ] **FR8** Raw step names (`rules`, `frame loaded`, `story entry`, `inserted`, `composer`, `write block verified`, `decided late`), 0.1-s timings, and the frame size in step 1. They move to Details.
- [ ] **FR9** `aria-live` around the ticking clock in `RunView.tsx` (RV6).
- [ ] **FR10** Window-lane copy in-page: `RUN_HINT`, `SLOW_20_TEXT`, `HELD_TEXT`, step 1's "phone-sized window" and `{w} × {h}`, and onboarding's "narrow window".
- [ ] **FR11** In-page editor chrome:
  - the TopBar (mode badge, `Last: ✓`, the History, Settings and `?` links);
  - the 860-px breakpoint;
  - uppercase `h2` headings;
  - the fixed dark theme (tokens replace it).
- [x] **FR12** Text-glyph icons (✓ ✕ ◐ ○ ● +) and the flat purple toolbar icon (FE9). (2026-10-16: the live toolbar icon is the mark, RL-5.)

---

## 11. Before building: read-only checks in Arc, on the secondary account, nothing clicked except opening menus (FV)

- [ ] **FV1** (V1, V2) Nav width and mode at viewports 1030, 1190, 1270, 1280, 1440, 1670 and 1920. Exact wide/collapsed breakpoint. Item order, element types and hrefs, including any Meta AI, Dashboard or Threads items.
- [ ] **FV2** (V3) The gap from Profile's bottom to the next control at viewport heights 700, 800 and 900. This decides FE1 vs FE2 and whether the chip fits in the slot (≥ 84).
- [ ] **FV3** (V5) The theme signal: `body` background, `<html>` attributes, `--ig-*` variables, in light and dark.
- [ ] **FV4** (V7, N17) The z-index and DOM position of Instagram's post modal, story viewer, Search panel and Create dialog against the host. The phone stays visible over them.
- [ ] **FV5** (NV5) A full-viewport transparent extension iframe stays transparent in Arc with a matching `color-scheme`. A scrim click does not activate the engine frame (N5 at full size).
- [ ] **FV6** (N15, V8) The engine keeps rendering at the Small scale (~0.2), at the chip's thumbnail scale (~0.067), and in Hidden mode. A Test run in each.
- [ ] **FV7** Resizing the composer iframe (full viewport ↔ chip ↔ 0×0) never reloads it in Arc.
- [ ] **FV8** (L23) Arc honours ⌥⇧S as an extension command on an Instagram tab.
- [ ] **FV9** (NV4, V9) Instagram's own Create-dialog metrics (header height, radius, scrim, close position) for parity, and the Messages bubble's rect.

---

## 12. Mockup map (`final.html`)

| Dock group | Shows |
|---|---|
| Theme | FT1–FT3 |
| Nav | FE1, FE3 |
| Entry | FE1, FE2, FE4, FE5 |
| Preview | FS7 |
| On Post | Posted (FS11, FS12), Needs you (FS9), Page in use (FX11 → FS11), Upload failed, Unconfirmed (FS13) |
| Post card | First post (K6), Spacing (K10 → K11), Other tab (FX6, FE6 busy), Paused (FX9), Logged out (KL) |
| Speed, Motion | 2× run; reduced motion (FT7) |

Also clickable:
- the coach mark;
- Hide (Esc) during a run, which goes to the chip;
- clicking the stand-in page while hidden, which gives the amber wait;
- Settings with Advanced;
- the Keyboard shortcuts sheet;
- the ⋯ menu;
- real file import, paste and drop.

**Not mocked:** History, Finish by hand, K9 caps, the stacked sheet under 720×560, `FRAME_REFUSED`, `PAGE_LEFT`, and other-tab results on the entry.
