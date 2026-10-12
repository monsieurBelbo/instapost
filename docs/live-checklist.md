# instapost: live checklist

The owner's checklist for everything that touches real Instagram. It copies the L and G lists of `docs/strategy.md` §8 with the same ids; tick items here as they are done. Ids are stable: never renumber or reuse one, and strike through an item that is dropped instead of deleting it.

**Before any step that loads the extension (strategy §6.4):**

- **Human only.** Branded Chrome, profile "IG secondary", `.output/chrome-mv3-live` loaded with "Load unpacked". No Playwright, no `wxt` dev, no DevTools device mode. The DevTools Network panel is allowed.
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

  Write the structural facts into `baseline.json`, update the fake's defaults, and get U16, E12 and E13 green.

  If the hand-off ends with `UNEXPECTED_PAGE`, the panel says which page it went to ("It went to /x/.", also on the hand-off record and in the background console): record that path as a contract fact, and do not retry until the fake models it.
- [ ] **L5** Geometry without Share. Rehearsal ON, H0: the owner taps + → Story and picks the calibration card; the agent records C8.
  - If the composer exposes a save or download control (`SAVE_STORY`; UI presence is (unverified)), the owner clicks it and drops the saved file into the calibration tool.
  - Close without Share. Repeat at a second popup size.
  - Set `composerProfile`; decide OD4 if the image is downscaled.
- [ ] **L6** Assisted-insert check: rehearsal ON, H1 ON, one attempt with the calibration card. Does C6 (composer ready) appear? No Share. If not, H0 stays the default and OD3 is moot.
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

## G: gate before the primary account

- [ ] **G1** L10 complete with no warnings, challenges or unusual security emails.
- [ ] **G2** The last 5 preflights all passed; crop loss is 0.5% or less; OD4 decided.
- [ ] **G3** The kill switch is proven on the fake (E12 d, e, n, p, u: first-load and mid-session challenges, security pages, off-host before and after arming). Rehearsal is proven on the fake (E9) and on the secondary (nothing posted during L5–L7).
- [ ] **G4** The phone lane has been used end to end (L9).
- [ ] **G5** The owner explicitly accepts the residual terms-of-use grey area (OD1).
- [ ] **G6** The everyday profile holds only the live build; guarded builds were never loaded there.
- [ ] **G7** The account label in the everyday profile is set to the primary's handle. First primary post, then normal use under the rate guard.
