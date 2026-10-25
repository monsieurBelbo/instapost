# Changelog

All notable changes to instapost are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-10-15

Post stories from inside Instagram's own desktop page, without leaving the tab.

### Added

- **New story** in Instagram's left sidebar on desktop instagram.com (a tile when the sidebar is collapsed, a corner button when the page has no sidebar). The toolbar icon and ⌥⇧S open it too. Settings → On Instagram can hide it.
- **Composer dialog** over the Instagram page, shaped like Instagram's Create dialog: drop, paste (⌘V) or choose (⌘O) a photo; drag, zoom, rotate, Fill or Fit; text; guides; recent photos and drafts. **Hide** (Esc) tucks it into a sidebar chip that shows progress and the result.
- **One-click posting in the same tab.** Post story (⌘↵) runs Instagram's mobile site in a phone-sized frame inside the page (shown small, large or hidden). instapost taps +, Story and Share there, and says "Posted" only when Instagram's own publish request succeeds.
- **HEIC/HEIF photos** from an iPhone, converted locally on your Mac.
- **Packaged builds for sharing**: a zip with install steps (INSTALL.txt) and build details (BUILD.txt), and an optional sync into a shared folder.

### Changed

- The in-page composer is now the main way to post. The editor tab and its docked window stay as the fallback.
- Test runs (setup test, Test run, Share test, Check connection) no longer count toward the 6-an-hour and 15-a-day post caps. Only the 60-second spacing applies to them.
- While the 60-second spacing runs, Post story and Try again show a countdown and queue the post. They no longer refuse it. Under an hourly or daily cap they show when posting is available again.

### Fixed

- A queued post sends the photo as it was when you pressed Post story, even if you edit afterwards.
- A challenge that appears in the 2 seconds after "Posted" still pauses posting.
- instapost no longer starts a post from Instagram's login or security pages.
- "You posted this story already" and the pending check are still there after the page reloads. Your "It posted / It didn't post" answer is saved in History.
- The New story entry hides behind Instagram's own overlays.
- Files that aren't HEIC (GIF, TIFF, a damaged JPEG) say "Can't open this file" instead of showing the HEIC message.

### Known limitations

- Desktop Chrome or Arc 155 or later only, installed unpacked (not in the Chrome Web Store).
- Photos only. Video is not supported yet.
- AirDrop into the composer is not supported. Drag AirDropped photos in from Downloads instead.
- Posting this way is outside Instagram's terms of use, and Instagram can detect it. Use it at your own risk, and try a secondary account first.

## [0.1.0] - 2026-10-14

First working version, built 2026-10-11 to 2026-10-14.

### Added

- Research and an implementation strategy for posting stories from a desktop browser.
- A sealed development environment: a fake Instagram, sealed test browsers that can't reach Instagram or Meta, and unit, browser and end-to-end tests.
- A local 1080×1920 story editor with download and hand-off to the phone.
- **One-click posting (window lane)**: instapost opens Instagram's mobile site in a narrow window docked at the right of the screen and taps +, Story and Share itself. The result comes from Instagram's own answer.
- Test modes (setup test, Test run, Share test, Check connection), rate caps and spacing, History with Details and Copy diagnostics, and a 7-day pause after any challenge.
- Arc support.
- Spanish: the editor in English or Spanish (a language setting), and posting works when Instagram itself is in Spanish.

