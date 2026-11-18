# Reach phase: plan for each roadmap item

Written 17 November 2026, after the Trust and Feel phases shipped. Updated 18 November 2026: the four
finished branches are merged and live, and plan 4 is built (see below).

Every Reach item already has a first version live on bounce.stefanstudio.com. Each plan below
covers the gap between that first version and what the design review asked for.

## What blocks what

- **The native iPhone build** blocks plan 5 entirely and the last step of plans 2 and 4. The app
  ships as a web app; `ios/` is not generated, and `modules/bounce-audio` (about 560 lines of Swift)
  is a start on native audio that the app does not use yet.
- **A decision on accounts** blocks plan 3. Sync needs to know which devices belong together.
- Plans 1, 4 and 6 need neither. Plan 4 is built; 1 and 6 can start now.

Suggested order for what is left: 6, then 1 (both web only), then 3 (after the accounts decision),
then 2, then 5 once the native build exists.

---

## 1. Vocal layers and comping (F3, F4)

**Live now.** Any lined-up take can be stacked on the picked take as a double, ad-lib or hook, with
level and pan. A take can be recorded straight to a layer. Best bars lets you tap a bar to play it
from another take, with a colour per take and 8 ms crossfades.

**Gap.** The review asked for lanes: lead, double, ad-libs and hook as separate tracks, each
holding its own takes. Today a layer is a pointer from one take to another, so a lane cannot have
takes of its own, cannot be comped, and disappears if you pick a different lead. Best bars works on
the lead only, and only on whole bars.

**Plan.**
1. Change the model from "layers on a take" to "lanes on a song": `Project.lanes`, each with a role,
   level, pan, its own list of takes, a picked take and its own comp. Migrate existing `layers` and
   `comp` on load; keep the old fields readable so a restore from an old backup still opens.
2. Record into a lane: the mic screen gets a lane picker in place of "Record as a layer on take N".
3. Song screen: one row per lane with mute and solo, replacing the Layers section.
4. Best bars per lane, plus half-bar cells for fast verses.
5. Render: `render.ts` already mixes layers through the lead's chain; give each lane its own chain
   so a hook can be brighter than a double.

**Size.** Large. The model change touches `model.ts`, `store.ts`, `studio.ts`, `render.ts`,
`song.tsx`, `vocals.tsx` and backup.

**Check.** Render tests for lane levels, pan and per-lane comp; a migration test from a song saved
today; end-to-end: record a lead, a double and a hook, comp the lead, export.

**Needs a device for.** Whether the Song screen stays readable on a phone with four lanes.

## 2. Listening links and platform snippets (F13, F15)

**Live now.** A private link to a player page where listeners leave notes pinned to a moment, with
the notes shown back in the app. Snippets in tall, square and wide shapes; the tall one keeps text
clear of app buttons. Lyric lines are shown in time with the vocal, with nudge controls.

**Gap.** Links: no way to see that someone listened, no expiry, no approval ("this mix is the
one"), and notes do not jump the app's player to that moment. Snippets: no animated cover, and
sharing goes through the general share sheet instead of straight to Instagram, TikTok or Messages.

**Plan.**
1. Links: tapping a note seeks the song to that moment. Add a play count and "last heard", an
   optional expiry date, and a thumbs-up on the page that shows in the app as approved.
2. Links: a new mix replaces the audio today; keep the earlier version reachable so notes still
   point at what was heard.
3. Snippets: animated cover (slow zoom and a waveform that moves with the audio), behind the
   existing Reduce Motion handling.
4. Snippets: per-platform presets that pick shape, length and safe areas together ("Reel",
   "TikTok", "Story", "Message").
5. One-tap posting. In a browser the share sheet is the only route, so this step is to make the
   preset choose the right file and caption and open the sheet once. Direct hand-off to a named app
   needs the native build.

**Size.** Medium for steps 1 to 4; step 5 is small on web and waits on native for the rest.

**Check.** Server tests for expiry and counts; the page still escapes all text; ffprobe on each
preset's size and length; end-to-end: leave a note, tap it, the player seeks.

**Decision for you.** Whether play counts are worth it, given the page is anonymous: a count says a
link was opened, not who opened it.

## 3. Restore and sync (F19)

**Live now.** Backup is one-way from each device, locked to a secret the device holds. A restore
code copies songs, audio and covers to another device once. Size limits and upload clean-up are in
place.

**Gap.** The review asked for "capture on the iPhone at the studio, mix on the iPad at home". Today
that means copying a long code between devices, and the two then drift apart: an edit on one never
reaches the other.

**Plan.**
1. Decide what ties devices together (see below). Recommended: sign-in. Convex Auth with Google and
   Apple is already set up, and `devices` already links a device to an account.
2. Per-account library on the server: projects keyed by account, each with `updatedAt`. Audio files
   are already content-keyed, so they deduplicate.
3. Pull as well as push. On launch and on a timer, fetch projects changed since the last sync.
4. Conflicts: last edit wins per project, and the losing copy is kept as "Song (from iPad)" so
   nothing is silently lost. Takes are append-only, so two devices adding takes merge cleanly.
5. Audio on demand: list a song before its audio has arrived and fetch it when opened, so a phone
   does not download the whole library.
6. Deletes need tombstones so a delete on one device is not undone by the other.
7. Settings: show which devices are syncing and when each last synced.

**Size.** Large, and the riskiest item here: sync bugs lose work.

**Check.** A two-client test harness against a local server: edit on A, see it on B; edit both
offline, reconnect, both copies survive; delete on A, gone on B; restore from an old backup still
works. Run it for several days on your own two devices before anyone else uses it.

**Decision for you.** Sign-in to sync (recommended), or keep it account-free with a pairing code
that links two devices. Account-free keeps the app's "no account needed" promise but makes a lost
phone harder to recover from.

## 4. Undo and snapshots (F11)

**Built, 18 November 2026.**

- Mix A and Mix B are level-matched while comparing: the louder is turned down to the quieter, by
  up to 12 dB, with a line under the switch saying by how much. Exports are not changed.
- Mixes can be saved by name on the Mix page (up to 20 a song), renamed, deleted, made the mix in
  use, or put on the other side of A and B to compare.
- Undo and redo for the mix survive a reload, 50 steps a song.
- A tap with two fingers undoes on the Mix and Song pages.

**Still open.**

- Undo for the song (deleted takes, layers, best bars, lyrics) still lasts only for the session.
  Those steps hold on to audio files and cannot simply be written down; it needs its own design.
- Levels are matched once both mixes have been rendered. A saved mix that was never rendered has
  no loudness until it has played once.
- Shake to undo needs the native build.

## 5. Lock Screen, Live Activities, Shortcuts (F20, F21)

**Live now.** The player tells the browser what is playing, so Lock Screen controls work in Safari
where the browser allows it. The home-screen web app has two shortcuts.

**Gap.** Everything the review named here is native: a Live Activity and Dynamic Island for
recording time and render progress, an Action button and Shortcuts action for "Capture a beat", and
a Home Screen widget for "Freestyle over the last beat". None of it can be built on the web.

**Plan.** This item is really "ship the native iPhone app", then three small features on top.
1. Native build first, as its own project: finish `modules/bounce-audio` to replace the stand-in
   `engine.ts` (record, play in time, monitor), give `files.ts`, `aac.ts` and `video.ts` real
   native versions, and get a development build onto a device. Measure round-trip latency early;
   it decides whether takes line up.
2. Now Playing through the native audio session, replacing Media Session.
3. Live Activity for a take in progress and for a render, as a widget extension.
4. App Intents for "Capture a beat" and "Freestyle over the last beat", which gives Shortcuts,
   the Action button and Siri together.
5. Home Screen widget showing the last beat, opening straight to the mic.

**Size.** Step 1 is the largest piece of work on this page. Steps 2 to 5 are small to medium each
once it exists.

**Check.** Only on real devices: a current iPhone, an older one, and an iPad.

**Decision for you.** Whether the native app is the next big investment. If not, park this item;
nothing else on the page depends on it except the last steps of plans 2 and 4.

## 6. Artist profiles, credits and splits (F5, F18)

**Live now.** Credits with roles and shares, a warning when they do not add up to 100%, and a split
sheet in the export. One-tap chips for recent artists. Saved artist profiles with a
vocal chain, a session artist, and a large-control artist view on the mic screen.

**Gap.** The review's profile also had a photo and mic timing, and starting a session was meant to
fill in credits and the cover photo too. Credits are typed per song with no memory of who people
are. The split sheet is plain text and nobody signs it.

**Plan.**
1. Profile gains a photo and the measured mic timing for that artist's usual setup, so a session
   starts already in time.
2. Starting a session fills in the performer credit and offers the artist's photo for the cover.
3. People, not strings: credits pick from saved artists and collaborators, with their usual role
   and share remembered. Free typing still works.
4. Split sheet as a PDF with the song title, date, each person's role and share, and signature
   lines. Keep the text file for pasting.
5. Optional: send the split sheet through a listening-style link where each person taps to agree.
   This overlaps with plan 2's approval and should reuse it.

**Size.** Medium. Steps 1 to 3 are small each; the PDF is the larger piece.

**Check.** Unit tests for filling credits from a session and for share totals; open the PDF in
Preview and on an iPhone; end-to-end: start a session, record, export, read the sheet.

**Decision for you.** Whether "agree to the split" (step 5) is wanted. It makes Bounce part of a
legal-ish agreement, which is a bigger promise than a printable sheet.
