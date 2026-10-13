# instapost: live checklist

The owner's checklist for everything that touches real Instagram. It copies the L and G lists of `docs/strategy.md` §8 with the same ids; tick items here as they are done. Ids are stable: never renumber or reuse one, and strike through an item that is dropped instead of deleting it.

**Before any step that loads the extension (strategy §6.4):**

- **Human only.** Branded Chrome, profile "IG secondary", or **Arc** (the owner's browser since the first live run on 2026-10-12; see L13), with `.output/chrome-mv3-live` loaded with "Load unpacked". No Playwright, no `wxt` dev, no DevTools device mode. The DevTools Network panel is allowed. Never load a mock (guarded) build there: it refuses in Chrome, Edge and Arc anyway (`BRANDED_BROWSER`).
- **`pnpm run verify` is green on the same build**, including E9 on the live artifact. `verify` builds both artifacts itself: load the `.output/chrome-mv3-live` it produced, without rebuilding in between.
- **Pace.** One composer window at a time, at least 60 s apart, and each L step at most once per day unless stated. Rehearsal stays ON for L4–L7.
- **Records.** Results go into the hand-off log and `src/core/ig-contract/baseline.json` (structural facts only). Raw captures, HAR files and screenshots with account data stay out of the repo.
- **Stop condition.** Any challenge, checkpoint, "suspected automated behaviour" notice or unexpected security email: stop. The kill switch locks the lane; wait at least 7 days and reassess.

## L: live verification (secondary account, human only)

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

  Write the structural facts into `baseline.json`, update the fake's defaults, and get U16, E12 and E13 green. A Story input row of `none …` (after the probe's 6 s wait for Instagram's header) is inconclusive on its own: do not write `storyInputBeforeTap: false` until L15 (+ → Story by hand) agrees.

  If the hand-off ends with `UNEXPECTED_PAGE`, the panel says which page it went to ("It went to /x/.", also on the hand-off record and in the background console): record that path as a contract fact, and do not retry until the fake models it.
- [ ] **L5** Geometry without Share. Rehearsal ON, H0: the owner taps + → Story and picks the calibration card; the agent records C8.
  - If the composer exposes a save or download control (`SAVE_STORY`; UI presence is (unverified)), the owner clicks it and drops the saved file into the calibration tool.
  - Close without Share. Repeat at a second popup size.
  - Set `composerProfile`; decide OD4 if the image is downscaled.
- [ ] **L6** Assisted-insert check: rehearsal ON, H1 ON, one attempt with the calibration card. Does C6 (composer ready) appear? No Share. If not, H0 stays the default and OD3 is moot.
  - Since 2026-10-12 (strategy AM37): the insert bypasses the story session that + → Story starts (Instagram's session id stays empty), so even with C6 a real Share after an insert is unproven; H1 stays off by default in the live build until a real post after an insert works (after L17).
  - Write into `baseline.json`: `untrustedInsertAccepted` (`true` if C6 appeared after the insert; `false` on `INJECTION_IGNORED`, and note whether the photo was visible in the composer anyway, strategy AM28) and, if it can be observed, `fileEvent` (`change` or `drop`). Then update the fake's defaults via `deriveKnobs` and get U16 and E12 (f) green, as in L4.
  - If the photo shows but the panel says `INJECTION_IGNORED`, do not tap Share; close the window. (Had Share been tapped, the panel would ask "Posted?" with no pre-answer and keep the window open until answered.)
- [ ] **L7** *Only if L5 left the output size ambiguous:* **one** rehearsal Share click, which the rules proven in E9 block. Read `upload_media_width/height` in DevTools if a blocked request shows its headers. Never repeat it; note any client retries or error toasts.
- [ ] **L8** First real post on the secondary, with rehearsal switched OFF: the owner clicks Share, H0 or H1 per L6, with a PNG hand-off.
  - With rehearsal off the composer window stays open after Share (strategy AM19). Wait until the story is visibly live on the phone, or clearly failed, **before** answering "Posted?" or closing the window; the answer closes it.
  - Note where the composer went after Share (`/` or another page) and whether it showed an upload indicator there; record it in `baseline.json` notes for C9 (AM17 counts only `/` as "composer left"). Another page shows as `UNEXPECTED_PAGE` with its path, and "Posted?" then has no pre-answer (AM28): check the story on the phone before answering, and never post again before that.
  - Check on the phone: size, crop, sharpness and colour against the export.
  - Screenshot it to calibrate P10.
  - Delete it.
  - On another day, post one JPEG-0.95 hand-off to compare.
- [ ] **L9** Phone lane: export a frame with a music placeholder, send it to the phone, add the Music sticker in the app on the secondary. Check the placeholder geometry and the duration. Post and delete, or discard.
- [ ] **L10** Soak (OD2): by default at least 10 desktop posts over at least 14 days, at most 1 a day, at varied times. Review Login activity, security emails and Accounts Center weekly (research Q5).
- [ ] **L11** After every Chrome major update, and monthly: rerun L2 and L4 (probe only).
- [ ] **L12** (optional, feeds OD5) On the secondary account, open "Switch to professional account" and read the consequences (privacy, music) **without confirming**.

### Arc (added after the first live run, 2026-10-12; strategy §11 AM29–AM35)

The first live run (Arc, rehearsal off, assisted insert off) ended `failed:DESKTOP_SHELL` in a 1512x902 window (`docs/contract.md` § "First live run"). Run these in order, in the Arc profile used by the "IG secondary" Space (extensions are per profile), one window at a time, at least 60 s apart, **rehearsal ON**.

- [ ] **L13** Load the live build in Arc: `arc://extensions` → turn on Developer mode → **Load unpacked** → `.output/chrome-mv3-live` (from the green `pnpm run verify`). After any rebuild that changes the manifest, **Remove** the extension and load it again (Arc may keep a stale manifest); a plain reload is enough otherwise. Open the editor and check, in its console, `navigator.userAgentData.brands` (`Chromium 155` and a GREASE brand were seen on 2026-10-12) and `getComputedStyle(document.documentElement).getPropertyValue('--arc-palette-title')` (non-empty in Arc). No Instagram is loaded in this step.
- [ ] **L14** *Requires L13.* **Probe composer** in Arc, rehearsal ON, no file. Before Instagram loads, the window must become narrow and tall by itself (it may jump once or twice while still blank). If the panel says "Waiting for you to make the window narrow and tall", drag the Instagram window's edge until the size turns ✓ (at most 767 px wide, taller than wide, at least 640 px tall); it then carries on by itself (Cancel and the 3-minute limit close it with Instagram never loaded). Expected panel rows when it closes:
  - **Page** `/ (home: Instagram's usual landing, tap + → Story there)`;
  - **Window** `asked 524×932, got 524×932 (…)` or similar: the width at most 767 and "opened at … instead of …" when Arc ignored the size;
  - **Browser** `Arc (recognised by its page colours)`;
  - **Mobile page** `yes`; **Viewport** at most 767 wide, `portrait`;
  - **Story input** `present`;
  - **Service worker** `controls the page — normal on Instagram` (or `not in control` if the probe was faster than Instagram's worker); never `intercepts requests` (that would have closed it with `SW_INTERCEPTS`: stop and report).

  Record C1–C5 from the hand-off record (C5 `fail` = `homeOnly` is Instagram's normal landing) and the Window row's text in `baseline.json` notes. The probe waits up to 6 s for Instagram's header before it reads the story input, so the window may stay open a few seconds on home. If the Story input row still says `none …`, that is inconclusive: note it, do **not** write `storyInputBeforeTap: false`, and let L15 (+ → Story by hand) decide. A `WINDOW_NOT_FITTED`, `LAYOUT_TOO_WIDE` or `LANDSCAPE` here means Arc did something new with the window: note the Window row and stop.
- [ ] **L15** *Requires L14 passing.* First **H0 rehearsal** in Arc: rehearsal ON, **assisted insert OFF**, one post-from-desktop with the calibration card. The panel says "Instagram opened its home page, as it usually does. In the Instagram window tap + → Story, then pick instapost/…". In the Instagram window tap **+**, then **Story**, and pick that file: the composer opens with the photo (`/create/story/`), the panel moves to "Waiting for you to review and tap Share" and shows the Canvas row (C8). Do **not** tap Share; close with **Cancel hand-off**. Record C8 and whether a "Rotate your device" toast appeared (it must not).

  *2026-10-12, second run (owner, test account):* the composer showed the snackbar "Rotate your device to add to your story." instead of its Share footer in a fitted 503x894 portrait window, after the owner's own + → Story → pick and after an H1 insert alike, because it reads the screen's orientation, not the window's (strategy §11 AM37; `docs/contract.md` C3b). Builds since then carry the portrait shim; L16 repeats this step with it.

### Arc with the portrait shim (added 2026-10-12; strategy §11 AM37)

Use a live build from a green `pnpm run verify` that has the portrait shim (the hand-off panel then has a **Screen** row). Remove and load it again in `arc://extensions` (L13). One window at a time, at least 60 s apart.

- [ ] **L16** *Requires L14 passing on the shim build.* Repeat **L15** (rehearsal ON, assisted insert OFF, + → Story by hand, pick the calibration card), no Share; close with **Cancel hand-off**. Expected: the composer shows its header and the **Share footer**, no "Rotate your device" snackbar; the panel's Screen row reads `portrait-primary (portrait shim in place)` (on home before the pick: `portrait-primary (portrait shim installed; the screen itself is landscape)`). Record C3b from the hand-off record (`preflight.C3b`), the Screen row and C8. If the hand-off ends with `SCREEN_LANDSCAPE` instead, record the error's detail ("The composer read …", "The page’s screen orientation could not be read …" or "The portrait shim went in only after the composer had opened …") and the Screen row, and stop: the shim did not take effect in Arc. *Since 2026-10-13 (strategy AM38):* if instead the composer shows the "Rotate your device" snackbar while the Screen row reads `portrait-primary` and the panel waits for Share, Instagram reads the screen some other way that instapost cannot see: Cancel, record the Screen row and `preflight.C3b` (it will say pass), and stop.
- [x] **L17** *Passed 2026-10-13 in Arc on the secondary account (H0 with the portrait shim; L16 was skipped).* *Requires L16 passing.* **First real post in Arc with the shim (H0)**: rehearsal **OFF**, assisted insert OFF, a PNG hand-off of a frame you are happy to post on the secondary. In the Instagram window tap **+ → Story**, pick the file, review, and tap **Share** yourself. As in L8: the window stays open after Share until you answer "Posted?"; wait until the story is visibly live on the phone, or clearly failed, before answering. Check it on the phone (size, crop, sharpness, colour), screenshot it for P10, then delete it. Record the outcome, the Screen row and where the composer went after Share. If Share fails or Instagram shows an error toast, note its text, answer "Not posted" and stop. (The H1 insert is a separate question: it never starts Instagram's story session, so its session id stays empty; L6 decides whether it is used at all.)

## G: gate before the primary account

- [ ] **G1** L10 complete with no warnings, challenges or unusual security emails.
- [ ] **G2** The last 5 preflights all passed; crop loss is 0.5% or less; OD4 decided.
- [ ] **G3** The kill switch is proven on the fake (E12 d, e, n, p, u: first-load and mid-session challenges, security pages, off-host before and after arming). Rehearsal is proven on the fake (E9) and on the secondary (nothing posted during L5–L7).
- [ ] **G4** The phone lane has been used end to end (L9).
- [ ] **G5** The owner explicitly accepts the residual terms-of-use grey area (OD1).
- [ ] **G6** The everyday profile holds only the live build; guarded builds were never loaded there.
- [ ] **G7** The account label in the everyday profile is set to the primary's handle. First primary post, then normal use under the rate guard.
