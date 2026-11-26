# Nebulix 3.0 — audit, status and roadmap

Branch: `nebulix-3.0` (from `main` at v14.1.0). Backups: git tag `backup-pre-nebulix-3.0`, source archive
`NEBULIX_BACKUP/code/nebulix-src-14.1-pre-3.0.tgz` (630 files), production data archive taken right before the
14.1 deploy (`NEBULIX_BACKUP/archives/nebulix_data_predeploy141_*.tgz`, 77 data files) plus a Fly.io volume snapshot.

This file is the hand-off document: what exists, what each phase added, and what is still pending (with the
infrastructure each pending item needs). Status words mean:

* **Implemented** — works end to end and was tested.
* **Connected** — works through an external service that must be configured (keys / hosts); the UI shows its status.
* **Pending** — not built yet, or needs infrastructure Nebulix does not have.

## 1. Architecture (audit)

| Layer | What it is |
|---|---|
| Server | Node.js, **no npm dependencies**. `server/index.js` serves static files (CSS bundled into one file with a content hash) and registers route modules from `server/routes/*.js` through a tiny router (`r.get/post/put/delete(path, { auth, verified, limit, role, bodyLimit, stream })`). |
| Data | JSON tables on the Fly.io volume (`/data/*.json`) through `S.store.table(name)` / `S.store.touch(name)`; blobs (uploads, Hub files) are content-addressed by SHA-256 (`server/blobs.js`). Main tables: users, sessions, hubitems, hubreviews, hubsaves, aichats, drive, repos, notes, dms, channels, servers, clans, squads, events, tournaments, duels, quizzes, studydecks, studynotes, themes, mods, fusion, ugcworlds, worldtimes, trades, reports, shortlinks, stripe. |
| Auth | Session cookie `nx_sid`, email verification (`verified` routes), roles owner/admin/mod/user, rate limits per user/IP. |
| Realtime | One WebSocket (`/ws`) with typed messages (`hub.push`, `bus.on('ws:…')`), used by chat, DMs, presence, arena, casino 3D, worlds, duels, notifications. |
| Client | Vanilla ES modules, no framework: `h()` DOM builder, `mount()`, `t()` i18n (Spanish default, English and 4 more languages), lazy route loaders in `public/js/app.js`. |
| Hosting | Fly.io app `nebulix` + mirrors `nebulix-play`, `nebulix-zone`, `nebulix-hq`; one volume. Releases (Android APK, Windows EXE) built by GitHub Actions on `v*` tags. |

## 2. Module status

| Module | Status | Where |
|---|---|---|
| **Nebulix OS** (desktop, windows, snapping, taskbar, start menu, search, widgets, 4 virtual desktops, quick settings, glass/Linux effects, Alt+\` switcher, Ctrl+K palette) | Implemented | `public/js/os/desktop.js`, `os14.css` |
| OS system apps: Files (local VFS), Text editor, Task Manager, Clipboard history, Screenshot (screen capture API), Camera, Calculator, Focus timer, System monitor, Command Center, Widgets, Nova Agents | Implemented | `public/js/os/apps.js`, `apps2.js` |
| OS: PDF viewer, archive manager (ZIP list/extract/compress), startup apps (phase 11); app permissions (Hub apps, phase 4) | Implemented, including the download manager (phase 20). | `os/apps2.js`, `zipread.js` |
| **Nebulix Android** | **Implemented on compute nodes** (phase 9): real devices with the official Android Emulator + AOSP x86_64 images (API 21–36) under KVM, managed by `services/compute-node/agent.js`; H.264 stream (scrcpy server) decoded with WebCodecs; APKs, apps, files, screenshots, recording, clipboard, GPS, rotation, resolution, snapshots, shell, logcat, hardware settings, quotas. **Connected** in production only once the owner adds a node (Admin → Compute). No Google Play. The in-browser Android-x86 4.4 (v86) stays as an offline fallback. | `views/android.js`, `server/routes/android.js`, `server/compute.js`, `services/compute-node/` |
| **Virtual machines** | In-browser (v86): templates, ISO/IMG, disks, snapshots, clone, export, Linux terminal. **Cloud PC (phase 10): server-side QEMU/KVM VMs on compute nodes** — ready-made qcow2 systems or ISOs, noVNC screen, ACPI shutdown / force off / reset, key combos, PNG screenshots, disk+memory snapshots, live CPU/RAM, hardware settings, quotas. Connected in production once a node is added. | `views/vm.js`, `views/cloudpc.js`, `services/compute-node/` |
| **Gaming — Arcade** | Implemented: 19 single-player games (Snake, 2048, Aim, Typing, Block Drop, Flap, Paddle Duel, Star Defenders, Brick Breaker, Memory, Gravity Dash, Star Stack, Nebula Ops 3D, Market Rush, **Minesweeper, Sudoku, Space Rocks, Gem Match, Reflex** — new in 3.0) + live duels (Tic-Tac-Toe, Connect Four, Rock Paper Scissors). Server-validated scores, personal bests, records, daily coin cap. | `views/arcade*.js`, `server/routes/arcade.js` |
| Gaming — Arena (Royale with building, Ops 5v5, 1v1, ranked), Nebula Worlds (3D obby/hangouts + builder), Casino 3D, Nebula Dash, Nebula Fusion, Boss raids, Tournaments, Leagues, Clans, Squads, Season pass | Implemented | `views/arena.js`, `worlds.js`, … |
| Game library (Hub games + Vault store + reviews, collections, saves) | Implemented | `views/hub.js`, `vault.js`, `library.js` |
| Game engine / editor for users | Partial: Nebulix Code + Hub publishing (upload a folder, versions, remix), Game API (scores, achievements, multiplayer rooms — phases 2–4), creator guide + starter template (phase 5). Visual level editor: Nebulix Game Maker (phase 19). |
| External game APIs | **Implemented (phase 15)** with keyless official public APIs: FreeToGame (free-to-play catalogue) and CheapShark (deals across official stores) in `#/discover`. Pending: IGDB / Steam Web API / Discord (need keys from the owner). |
| **Hub / App Store** | Implemented: uploads (file/zip/folder), sandboxed run modes, releases, reviews, discussions, media, collections, remix, official apps (6), showcase home. Install/uninstall into Nebulix OS with update badges (phases 2–3) and a manifest permission system (phase 4). |
| **Office** — Docs, Sheets, Slides, Notes, Drive | Implemented. Docs: Word export, comments, real-time co-editing (phase 8). Sheets and Slides: real-time co-editing (phase 12). Same-spot edits are merged (phase 13). | `views/docs.js`, `sheets.js`, `slides.js`, `doclive.js`, `objlive.js` |
| Tasks / calendar / whiteboard / markdown | Implemented: Calendar & Tasks with invitations (phases 2 and 4), Flow Board (kanban), Sketch Board, Markdown Writer, Habits, Journal, Mind maps, Forms (phase 16). |
| **Creative** — Nebulix Studio (code + Copilot), Pixel Forge, Beat Lab, Palette Lab, Nebula Synth (Pulse), image generation (Nova) | Implemented. Nebulix Photo (layered image editor) and Nebulix Audio (waveform editor) in phase 17. Video editor (phase 18). |
| **Music & video** — Pulse (radio, synth, DJ), Nebulix TV/Tube, Clips, Live | Implemented (existing). |
| **Social** — community chat, servers/channels, DMs, voice rooms (WebRTC), profiles, plaza, feed, clans, reports/moderation | Implemented (existing). |
| **Nova AI** — chat with history, per-conversation model choice, streaming, Markdown/code, web search, images, voice, Nova Agent (PRO), Nova Agents team (OS), tutor (Study) | Implemented / Connected (provider keys in Admin → AI; free models otherwise). |
| **Developer** — Nebulix Code (repos), Studio, Terminal, **Developer Toolbox** (JSON, regex, encoders + SHA-256, UUID/passwords, timestamps, cron, colours/gradients, diff, Markdown, text tools — new in 3.0), Nerd Lab, Security Lab | Implemented. QR codes, HTTP request tester (server-side, SSRF-protected) and SQL playground (sql.js) added in phase 11. Python playground in the browser (Pyodide/WebAssembly, phase 14). Pending: other runtimes, server-side execution. |
| **Education** — Nebulix Study (notes, flashcards SRS, AI tutor, quizzes, live class quizzes, grades, exams, tools) | Implemented (existing). |
| **Browser** — proxy browser, links, VPN mode | Implemented (existing). |
| **Economy** — coins, gems, bank, invest, market, shop, daily rewards, achievements, quests; server-side validation | Implemented (existing; unchanged in 3.0 except new arcade game entries with plausibility checks). |
| **Security** — sessions, 2FA, rate limits, CSP, sandboxed Hub apps, upload validation, audit/reports, lockdown | Implemented (existing). |

## 3. What Nebulix 3.0 phase 1 added (this branch)

1. **Arcade:** 5 new polished games — Minesweeper (3 levels, safe first click, chording, flag mode), Sudoku
   (generated puzzles, 3 levels, pencil notes, keyboard, 3-mistake rule), Space Rocks (vector space shooter with
   waves, particles and touch controls), Gem Match (60-second match-3 with cascading combos), Reflex (5-round
   reaction test). Server plausibility rules added in `server/routes/arcade.js`; valid and implausible scores tested.
2. **Nebulix OS:** Task Manager (real window list, end task, switch, memory/FPS), Clipboard history (records text
   copied inside the OS, pin/search/clear), Screenshot (browser screen-capture picker → Files/Pictures, download,
   copy), and an **Alt+\`** window switcher (Alt+Tab is reserved by the operating system in browsers).
3. **Developer Toolbox** (`#/devtools`): 10 client-side tools.

## 3b. What phase 2 added (v14.3.0)

1. **Calendar & Tasks** (`#/calendar`, `server/routes/calendar.js`, table `calendar`): month/week/agenda views,
   repeating events, reminders sent by a one-minute scheduler as `notice` messages (push when offline), tasks with
   projects, priorities, due dates, reminders and subtasks. Tested through the API (validation, per-account isolation,
   recurrence) and in the browser.
2. **App Store installs:** `POST /api/hub/:id/install`, `GET /api/apps/installed`, `?installed=1` filter. Nebulix OS
   registers each installed item as an app `x-<id>` (own window running the sandboxed game, "Installed" start-menu
   category, desktop icon).
3. **Game API:** `server/hubshim.js` now injects `window.Nebulix` (`submitScore`, `leaderboard`, `me`) answered by
   `public/js/gameapi.js` on the Hub page and in OS windows; per-game boards (`GET/POST/DELETE /api/hub/:id/board`),
   best score per player, top 200 kept. Tested end to end with a sandboxed test game.
4. **Chess** vs CPU (`views/arcade-chess.js`): move generator verified with perft (start position 20/400/8902/197281,
   Kiwipete 48/2039/97862, position 3 14/191/2812/43238); alpha-beta search at 3 levels.
5. **Fix:** the Hub buttons Star/Save/Install used `busy()`, which detaches the button's children while it runs, so the
   label update failed (Star and Save showed an error in production since 14.0). They now use a lock that keeps the content.

## 3c. What phase 3 added (v14.4.0)

1. **Solitaire** (Klondike, draw 1/3, undo, auto-complete) and **Checkers** vs CPU (`views/arcade-cards.js`); checkers rules
   unit-tested (7 opening moves per side, compulsory capture, double jump, crowning); server plausibility rules added.
2. **Game API achievements:** `Nebulix.unlock(id, title, desc)` / `Nebulix.achievements()`; endpoints
   `GET/POST/DELETE /api/hub/:id/ach` (max 50 per game, defined on first unlock, unlocked once per player, share of players
   shown on the game page). Tested end to end with a sandboxed test game.
3. **Calendar ↔ Study:** `GET /api/calendar` also returns the user's Study exams; shown read-only in month, week and agenda.
4. **Installed apps in the OS:** update badge and notice when the Hub version is newer than the last one opened
   (`os.appver` on the device); desktop icon menu with Open / Open in Nebulix Hub / Uninstall.

## 3d. What phase 4 added (v14.5.0)

1. **Calendar invitations:** `invites: [usernames]` on an event (friends only, max 20); guests get a notice and the event
   under `invited` in `GET /api/calendar`; `POST /api/calendar/invited/:owner/:id { st: yes|no|maybe }` notifies the owner;
   guests who said yes get the reminder. Tested with two accounts.
2. **Multiplayer rooms** (`server/hubrooms.js`, WebSocket messages `hr_join / hr_msg / hr_leave`, events `hr_joined /
   hr_peer / hr_msg / hr_error`): 16 players per room, 8 KB JSON messages, 30/s per player, private messages, cleanup on
   disconnect. Tested with two real WebSocket clients (join, relay, size limit, cross-game isolation, leave on close).
3. **App permissions:** optional `nebulix.json` (`permissions: camera | microphone | geolocation | midi`), read at publish,
   new version and lazily for older uploads; `POST /api/hub/:id/perms`; the iframe `allow` attribute only includes granted
   permissions; prompt before install and a banner on the game page. Tested end to end.
4. **Creator docs:** `docs/GAME-API.md`.

## 3e. What phase 5 added (v14.6.0)

1. **Online Chess and Checkers duels** (`server/duels.js`): new duel games `chess` (120 s per move) and `checkers` (90 s).
   Moves are validated on the server with **the same rules code** as the Arcade: `server/rules.js` loads the
   `rules:begin … rules:end` part of `arcade-chess.js` / `arcade-cards.js` into an isolated `vm` context (perft verified on
   the server: 20/400/8902). Checkmate, stalemate, threefold repetition, the 50-move rule, insufficient material, checkers
   wins and draws; wagers use the existing escrow. Tested via the API with two accounts (illegal, out-of-turn and
   opponent-piece moves rejected; Fool's mate ends in checkmate) and in the browser (flipped board for black).
2. **Create games** (`#/gamedev`): creator guide (es/en) and a starter template. The template is the official Hub game
   `server/hubapps/starter.html` (one copy): the page embeds it with the Game API connected and builds the .zip from it.

## 3f. What phase 6 added (v14.7.0)

1. **Bubble Shooter, Tower Defense, Word Search** (`views/arcade-more2.js`) with server plausibility rules. Tested in the
   browser: shots pop bubbles, a tower is built and kills enemies, and a full word search (9 words) ends with the score saved.
2. **Elo ratings** for chess and checkers duels (`server/duels.js`: start 1200, K 32 for the first 20 games then 20;
   not rated when the server restarted or the duel expired); `GET /api/duels/ratings?game=`; ratings and the change
   shown on the duel. Tested: equal ratings → +16 / −16.
3. **Watching friends' duels:** `GET /api/duels/live` and `GET /api/duels/:id/watch` (participants and friends of either
   player only, read-only, the client polls every 2.5 s). Unit-tested: friend can watch, stranger gets 404, spectator cannot move.

## 3g. What phase 7 added (v14.8.0)

1. **Word (.docx) export** for Nebulix Docs (`public/js/docx.js`, no libraries): the sanitised HTML becomes
   WordprocessingML (styles, numbering, hyperlinks, images re-encoded as PNG, tables with colspan) packed with
   `zipwrite.js`. Tested: a document with every kind of formatting exports to a valid package (all parts well-formed XML).
2. **Comments on documents** (`server/routes/drive.js`, table `doccomments`; `public/js/doccomments.js`): threads anchored
   to a quoted piece of text (highlighted with the CSS Custom Highlight API, so the document HTML never changes), replies,
   resolve/reopen, delete (author or owner). Anyone who can open the document can comment; the owner and the thread get a
   notice, and open editors refresh live (`dcomm` socket message). Tested with two accounts, including a private document (404).
3. **Live spectating:** opening `/api/duels/:id/watch` registers you for 90 s; every move is pushed to spectators over the
   WebSocket (`watch: true`), and the client only renews its seat every 20 s. Tested with three accounts.

## 3h. What phase 8 added (v14.9.0)

1. **Real-time co-editing in Nebulix Docs** (`server/doclive.js`, `public/js/doclive.js`). A live session per document
   holds the document as an ordered list of top-level blocks (paragraphs, headings, lists, tables) with ids. Editors send
   block operations (`s` replace, `i` insert after, `d` delete as a tombstone) over the WebSocket as `dl_*` messages, or
   over `POST /api/drive/item/:id/live` when a batch is bigger than the 64 KB socket frame (inline images). The server
   applies them in arrival order, relays them, and saves the merged HTML into `item.data.html` (at most every 1.5 s, and
   on shutdown), so Drive, Word export, comments and older clients keep working.
   * **Convergence:** one batch in flight per client; a remote operation on a block with unconfirmed local changes is
     skipped (the server applied it first, ours overwrites it), and remote inserts skip over our own unconfirmed
     inserts at the same spot. Edits beat deletes. Two people typing in the *same paragraph* at the same instant: the
     last batch the server receives wins for that paragraph (no character-level merge). A hash check every 20 s
     resends the full state if anything ever differs.
   * **Presence:** people stack in the toolbar, a coloured caret with the person's name, and their selection.
   * **Offline / restarts:** edits made while disconnected are queued and sent on reconnect; after a server restart
     (new block ids) unconfirmed changes are matched to the new blocks by content and position.
   * An old-style whole-document save (`PUT /api/drive/item/:id` with `data`) ends the live session first; everyone
     reloads. If WebSockets are unavailable the editor keeps the previous behaviour (autosave + 10 s refresh).
   * Tested: 22 protocol checks (relay, acks, persistence, tombstones, resurrect, HTTP batches, hash check, view-only and
     private access, reset) and 20 checks with two real browser editors typing at once (different paragraphs, new
     paragraphs after the same heading, the same paragraph, bold + delete, reload, server killed and restarted while
     one editor kept typing offline), with no console errors.

## 3i. What phase 9 added (v15.0.0)

**Nebulix Android on separate compute nodes.**

```
Browser ──(REST: create / start / stop / ticket)──▶ Nebulix server (Fly.io) ──(HMAC-signed control API)──▶ compute node (KVM host)
Browser ◀────────────────(WebSocket: H.264 + input, 10-minute ticket bound to one device and owner)──────────── compute node
```

* `services/compute-node/agent.js` (no npm dependencies, README + `setup.sh`): manages AVDs for the official Android
  Emulator with AOSP `default` x86_64 images (no Google Play), quick-boot, named snapshots, adb, the emulator console and
  scrcpy 3.3.4's server (H.264, control channel, clipboard). Up to `NX_MAX_RUNNING` devices at once, idle devices stop
  after 30 min. Control calls need `Authorization: NX <ts>.<hmac>`; browser endpoints need a ticket. Host commands always
  use argument arrays; `adb shell` runs inside the device.
* `server/compute.js` + `server/routes/android.js`: node registry in `S.meta.compute` (owner-only, secrets never sent to
  browsers), table `cdevices` (per-user quota: free 1, PRO 2–5, staff 10; free hardware ≤ 2 CPU / 3 GB / 6 GB), health
  checks, tickets, node origins added to the CSP `connect-src`. Admin → Compute tab.
* `public/js/views/android.js` (`#/android`, OS app “Nebulix Android”): device list, create dialog, device page with the
  WebCodecs player (mouse/touch/multi-touch, wheel, keyboard and text, right-click = back, Ctrl+V pastes), navigation
  bar, and Apps / Files / Device / Snapshots / Shell / Logs panels.
* Tested on a real KVM host (this repo's dev machine): 40 API/node checks (no-node honesty, owner-only node admin, wrong
  secret, quotas and hardware caps, boot in ~40 s, stream handshake, HOME key over the control channel, forged tickets,
  unsigned calls, screenshot PNG, APK install of F-Droid, launch, uninstall, snapshot restore bringing it back, file
  upload/list/download, traversal and missing files, GPS, resolution, logcat, MP4 recording, stopped-device errors) and
  6 browser checks (H.264 decoded on the canvas at 720×1280, a mouse click opening Gallery inside Android, no console
  errors, no mobile overflow). Bugs found and fixed while testing: adb accepting the forward before scrcpy listens
  (now waits for the dummy byte), adb offline for ~3 s after a snapshot restore, node errors surfacing as HTTP 500,
  orphaned devices that could not be deleted, a loading overlay that never hid.
* **Production needs a node**: Fly.io machines cannot run KVM. Run the agent on a KVM server behind HTTPS and add it in
  Admin → Compute. Until then `#/android` says so and offers the in-browser Android-x86.

## 3j. What phase 10 added (v15.1.0)

**Nebulix Cloud PC** (`#/cloudpc`, OS app “Cloud PC”) on the same compute nodes as Nebulix Android.

* Agent: VM images in `NX_VM_IMAGES` (`*.qcow2` ready-made disks → per-VM copy-on-write disk; `*.iso` → empty disk +
  CD-ROM, `-boot order=cd`; labels in `images.json`). Disks are created with `qemu-img` when installed, otherwise with
  QEMU itself through QMP `blockdev-create` (no extra dependency). Each VM: `qemu-system-x86_64 -enable-kvm -cpu host`,
  virtio disk/net, usb-tablet, VNC on 127.0.0.1 only, QMP socket for power (system_powerdown / quit / system_reset),
  `send-key`, `screendump` (PNG), `savevm`/`loadvm`/`delvm`; CPU %/RSS from `/proc`. Browser ↔ node: `/v1/vnc?t=`
  relays raw RFB bytes over the WebSocket (ticket scope `ctl`).
* Server: `routes/android.js` is now one factory for `/api/android` and `/api/cloudpc` (separate quotas and caps: free
  1 VM ≤ 2 CPU / 4 GB / 30 GB; PRO up to 8 CPU / 16 GB / 200 GB).
* Client: `public/js/views/cloudpc.js` with noVNC 1.7.0 (MPL-2.0, vendored unmodified in `public/js/vendor/novnc`).
* Tested on the dev KVM host: 22 API checks (images, caps, quotas, kind isolation from the Android API, start, VNC
  handshake through the relay, forged ticket, PNG screenshot of the Debian login, live stats, Ctrl+Alt+F2, snapshot
  save/restore/delete, hardware lock while running, ACPI shutdown in ~2 s, ISO machine booting Alpine) and a browser
  test: noVNC connected in 2 s, logged in as root and ran `uname -sr` with real key presses, no console errors, no
  mobile overflow.
* Known flake: one full Android run (right after restarting the agent) had 2 failing checks that did not reproduce in
  the next three runs (40/40 each); the log showed stream reconnects around a snapshot restore. Watch for it.

## 3k. What phase 11 added (v15.2.0)

1. **Files (Nebulix OS):** binary files are stored as data URLs (importing a PDF/ZIP used to corrupt it — fixed);
   PDFs open in the browser's own viewer inside a window (`frame-src blob:` added to the CSP for this); ZIP archives
   are listed and extracted with `public/js/zipread.js` (stored + deflate via `DecompressionStream`, entry and size
   limits counted while inflating, `..` path parts dropped); any file or folder can be compressed to ZIP.
2. **Startup apps:** “Open at startup” in the Start menu (`os.startup`), opened after the session restore; listed and
   removable in the Task Manager.
3. **Developer Toolbox:** QR codes (qrcode-generator 2.0.4, MIT, vendored; UTF-8 via TextEncoder), HTTP request tester
   (`POST /api/devtools/http`, verified users, 30/min, reuses the proxy's SSRF guard: scheme/credential/port/host checks
   and connect-time DNS validation; no automatic redirects; 1 MB cap; 12 s timeout) and SQL playground (sql.js 1.17.0,
   MIT, vendored; open/download .sqlite).
4. Tested: 17 HTTP-tester checks (public GET/POST with headers and body, redirect not followed, blocked loopback,
   localhost, 169.254.169.254, 10/8, 192.168/16, ::1, a public DNS name resolving to 127.0.0.1, IPv4-mapped IPv6,
   decimal IP, port 22, ftp, credentials, header injection, anonymous) and 11 browser checks (QR drawn incl. UTF-8,
   SQLite query results, PDF rendered in the viewer window with no CSP error, archive listing, extract-all of deflated
   text + subfolder + PNG, compress-and-read-back, startup app opened on reload, no console errors).

## 3l. What phase 12 added (v15.3.0)

**Real-time co-editing in Sheets and Slides** (`server/objlive.js`, `public/js/objlive.js`; WebSocket `ol_*`, HTTP
`POST /api/drive/item/:id/olive` for big batches). A document is a map of keyed units — one per cell (`c:B4`), per
slide (`s:<id>`), the slide order (`o:`) and settings (`m:<field>`); the same split/assemble code runs on both sides.
Edits are “set unit to JSON / delete” batches, one in flight per client; remote changes to units with unconfirmed
local edits are skipped, so copies converge (same cell at the same instant → the later batch wins). Concurrent slide
additions both survive (slides missing from the winning order are appended). Presence: peers stack, the other
people’s selected cell outlined with their name, dots on the slide each person views. Whole-document saves end the
session; the stored data stays the plain `item.data`, so exports and older clients keep working.
Tested: 10 protocol checks (units, relays, malformed ops, persistence, concurrent slide adds, presence, reset,
private / view-only) and 10 checks with two browsers (different cells at once, a formula using the other person’s
numbers, the same cell at once, outlines, server copy, two slides added at once, text edit, presence, no console errors).

## 3m. What phase 13 added (v15.4.0)

**Three-way merge instead of “last edit wins”.** `public/js/merge3.js` (the server runs the same code between its
markers in an isolated vm, `server/merge.js`): LCS-based diff3 on tokens (HTML tags and entities are one token, text is
per character; common prefix/suffix trimmed, 2.5 M-cell cap), pure insertions at the same spot keep both (theirs
first), real overlapping replacements return null; `mergeJson` merges objects key by key, arrays of `{id}` items by id
(edits beat deletes), strings per character.
* Docs: `s` ops carry `b` (the block as the sender last knew it). If the server's block changed since, it merges
  (`mergeHtml`), relays the merged block and returns `fixes` in the ack; the sender applies them and rebases anything
  typed meanwhile. The caret is shifted with text added before it (common prefix/suffix mapping).
* Sheets/Slides: unit ops carry `b`; the server merges with `mergeJson` (a newly created unit at the same instant is
  still last-wins). Same `fixes` flow in `public/js/objlive.js`.
* Overlapping replacements of the very same characters fall back to the later edit, as before.
* Tested: 14 merge unit cases and 7 two-browser checks (same paragraph typed at both ends at once, bold + typing in
  one paragraph, server copy, two edits to one cell, bold + new value on one cell, a move + a text edit on one slide
  element, no console errors), stable over 3 runs; all earlier co-editing suites still pass.

## 3n. What phase 14 added (v15.5.0)

**Python playground** (`#/devtools/python`): Pyodide 314.0.7 (CPython 3.14, MPL-2.0; core runtime + stdlib vendored
unmodified in `public/js/vendor/pyodide`, ~13 MB, loaded only when the tool is used) inside a module Web Worker
(`public/js/pyworker.js`). Nothing executes on the server; the worker has no DOM; Stop terminates the worker. stdin
lines feed `input()`. Extra packages (numpy, …) are not available because they would come from a third-party CDN.
Tested in the browser: demo with statistics/math/f-strings/input() (first load ~4 s), traceback, page responsive during
an endless loop, Stop, run again after Stop, no console errors.

## 3o. Production compute node on Fly.io (v15.6.0)

* App **`nebulix-compute`** (`fly.compute.toml`, image `services/compute-node/Dockerfile`: node 24 + QEMU 7.2 +
  qemu-utils), region cdg, `performance-2x` (2 dedicated vCPU, 4 GB), 20 GB volume `compute_data` (VM images downloaded
  on first boot by `start.sh`, VM disks, agent state). `auto_stop_machines = "stop"`, `min_machines_running = 0`: it
  sleeps when nobody uses it and wakes on the first request; `kill_timeout = 90` lets VMs shut down cleanly.
* **Measured, not assumed: Fly machines are Firecracker microVMs with no `/dev/kvm` and no vmx/svm flags.** So this node
  runs Cloud PC with QEMU **software emulation (TCG)** — the agent switches automatically (`accel: 'tcg'`), Nebulix shows
  a notice, and the Debian 12 console boots in well under 100 s. **Nebulix Android cannot run here** (the Android
  Emulator refuses x86_64 guests without hardware acceleration); the Android page now says so. Android still needs a
  KVM server (bare metal or nested virtualisation) added in Admin → Compute.
* Connection: secret `NX_NODE_SECRET` on `nebulix-compute` and `NX_COMPUTE_NODES` (`name|url|secret`) on `nebulix`,
  generated in the shell and never printed. Env nodes are read-only in Admin → Compute. VMs are placed on KVM nodes first.
* Ticket signatures are now compared as canonical base64url text (a variant spelling of the last character, which
  decodes to the same bytes, used to be accepted — not a forgery, but no longer allowed).
* Tested against the real Fly node from a local Nebulix server: 22/22 Cloud PC API checks (incl. VNC handshake, PNG
  screenshot, stats, snapshots, ACPI shutdown, Alpine ISO) and a browser session that logged into Debian and ran
  `uname -sr`. (This dev machine's DNS cache was stuck on the new hostname, so the local tests mapped it to Fly's IP;
  production resolves normally.)

## 3p. Quality sweep (v15.6.1)

* Route crawler (owner account): all 78 routes at 1366×820 (console errors, exceptions, same-origin HTTP ≥ 400, error
  states) and at 390×844 (horizontal overflow) → one broken route (`#/fps` pointed at a file that never existed; now
  opens the Arena). No overflow on any route.
* Nebulix OS crawler: all 40 desktop apps opened as windows → no errors.
* Arcade crawler: all 25 games started and played with keys and clicks → no errors.
* The 38 earlier regression suites (economy, Hub, media, study, plaza, arena, casino, worlds, …) rerun on fresh data:
  every remaining failure traced to the tests themselves (old cookie name `nbx_s`, 1 product/2 prices before the three
  Premium tiers, 7 boosts before the gem shop) or to pre-existing state in the test data (existing AAPL shares,
  interns, shields, an open Hi-Lo round, missing answer argument) — no product bugs.
* `public/js/package.json` declares the browser modules as ES modules for Node (server/arena.js imports one).

## 3q. What phase 15 added (v15.7.0)

**Discover games** (`#/discover`, `server/routes/discover.js`): FreeToGame (free-to-play PC/browser games; attribution
shown) and CheapShark (current deals in 35 official stores; links go through its redirect as its terms ask). The server
calls them with a descriptive User-Agent (site URL, no personal data), caches (6 h / 30 min, stale copy on errors),
validates filters against allow-lists and passes on only known fields and https links on the expected hosts. Images:
`img-src` allows freetogame.com, *.steamstatic.com and cheapshark.com. Nebulix never hosts these games.
Bug found by the browser test and fixed: an empty “any price” filter became `upperPrice=0` (Number('') is 0).
Tested: 10 API checks and 5 browser checks (cards and thumbnails, search keeps focus, deals with store links, no console
errors or CSP violations, no mobile overflow).

**Free compute?** Checked: Fly machines have no KVM; Oracle's Always Free tier is ARM (now 2 OCPU / 12 GB) — no x86 KVM,
so no Android emulator, and Cloud PC there would be as slow as on Fly. There is no free host that runs Nebulix Android.

## 3r. What phase 16 added (v15.8.0)

* **Productivity** (`#/ptools/<tool>`, `server/routes/ptools.js`, table `ptools`): Habits (14-day grid, streaks),
  Journal (moods, search), Read later (title/description fetched through the SSRF guard, every redirect hop re-checked),
  Mind maps (tidy tree, Tab/Enter/F2/Delete, fold, SVG export), Password vault and Scanner. Per-user documents with
  count/size limits and optimistic concurrency (`base` → 409 when changed on another device).
* **Password vault:** PBKDF2-SHA256 (310 000 iterations) → AES-256-GCM in the browser; the server accepts only
  `{v, salt, iv, ct, iter}` and refuses anything else; auto-lock after 5 min; copied passwords cleared after 30 s;
  unbiased password generator (rejection sampling).
* **Scanner:** camera or photos → grayscale + auto levels (or black & white / colour) → multi-page PDF written in the
  browser (JPEG pages) → download or Drive.
* **Forms** (`#/forms`, tables `forms`, `formresp`): 8 question types, required, open/closed, one or several answers per
  person, anonymous mode, server-side validation, owner notice on each answer, results with bars/averages, CSV.
* **Fixed:** `api.delete()` did not exist (the client exposes `api.del`), so the Delete buttons in Nebulix Android,
  Cloud PC and Admin → Compute crashed; an alias was added. Forms: switching a question to a choice type now saves two
  starter options (they used to exist only in the editor).
* Tested: 19 API checks, a redirect-to-private-address unit test (both IP and DNS-name targets blocked), and 13
  browser checks covering every tool and a form answered by a second user; no console errors.

## 3s. What phase 17 added (v15.9.0)

* **Nebulix Photo** (`#/photo`, `public/js/views/photo.js`): canvas editor with image/text/rectangle/ellipse layers,
  move (mouse/arrow keys), proportional resize handle, rotation, opacity, 16 blend modes, 7 filters, lock/hide/reorder/
  duplicate, crop tool, canvas size with templates, transparent background, undo/redo (60 steps), drag-and-drop and
  paste of images, export PNG/JPG, projects saved/opened as `.nbxphoto` JSON in Drive. No background removal (it would
  need an external service — not faked).
* **Nebulix Audio** (`#/audio`, `public/js/views/audio.js`): Web Audio decoding of any browser-supported file or a
  microphone recording; waveform with zoom; selection; cut/copy/paste/delete/trim/silence/fade in/fade out/gain (dB)/
  normalise (−1 dBFS)/reverse/mix a second file (resampled with OfflineAudioContext); undo/redo; playback with playhead;
  16-bit WAV encoder; download or Drive.
* Tested in the browser (17 checks): layers, mouse drag and resize, filter + undo, crop, PNG size, Drive project;
  delete/undo, fade, normalise peak 0.891, reverse, copy/paste length, WAV header and size, Drive; no console errors.

## 3t. What phases 18–19 added (v16.0.0)

* **Video editor** (`#/videoed`, `public/js/views/videoed.js`): media bin (video/image/audio, kept as object URLs on the
  device), video track (clips with in/out trim, split at playhead, reorder, fade, brightness/contrast/saturation/B&W),
  text track (position, size, colour; `.srt` import with `parseSrt`), music track (start, volume). Canvas preview at
  1280×720; export = real-time `canvas.captureStream(30)` + Web Audio mix (one AudioContext for the editor, because a
  media element can be routed only once) → `MediaRecorder` WebM (VP9/VP8 + Opus) → download or Drive.
* **Game Maker** (`#/gamemaker`, `views/gamemaker.js`, engine `public/js/gamemaker-runtime.js`): tile painter (ground,
  brick, spikes, coin, spring, enemy, start, goal; strokes interpolated), physics/colour settings, width 20–300, undo,
  levels saved to the account (`ptools` kind `levels`), play-test with keyboard and touch pads, **Publish to Hub**: one
  `index.html` with the level JSON and `runGame.toString()` (the same engine), zipped with `zipwrite.js`, uploaded as a
  Hub game with a thumbnail (`kind=game&thumb=1`); a win calls `Nebulix.submitScore` for the leaderboard.
* Tested in the browser: video (7 checks: import a generated WebM, trim/two clips, SRT, preview frame, export decoded as
  1280×720 with the right length and a non-blank frame, second export to Drive) and Game Maker (9 checks: painting,
  reaching the goal, spikes, enemy, save, publish with thumbnail and engine, the published HTML winnable standalone).
  Bugs fixed while testing: fast strokes left gaps; the thumbnail upload used the wrong parameters; a second video
  export would have crashed (one AudioContext per element).

## 3u. What phase 20 added (v16.1.0)

**Download manager** (`#/downloads`, OS app “Downloads”, `server/routes/downloads.js`): the server downloads a public
http(s) link into the user's Drive — proxy SSRF guard re-checked on every redirect (max 5), Content-Length checked
against the file-size limit and free quota before reading, streamed through `blobs.receive` (hash, size cap), quota
charged, Drive item created (`source` = link), notice when done; up to 3 at a time per user; progress, cancel, retry;
jobs kept in memory (last 50). Tested (9 checks): a PDF stored byte-exact, a page, 404, private address, non-http, a
10 GB file refused before downloading, a 125 MB download cancelled mid-way, the 3-at-a-time limit.

## 3v. Release trailer and a streaming fix (v16.2.0)

* **Trailer** (`public/media/nebulix-3.0-trailer.mp4`, 54 s, 1080p30 H.264/AAC, 14.8 MB, poster `.jpg`): shown on the
  sign-in page (button), on Home (dismissible card, `nbx.trailer.hide`) and at `#/trailer`; shared player in
  `public/js/trailer.js`. Big static files are streamed with Range support, so it seeks without downloading everything.
  How it was made (tooling in `tools/trailer/`, see its README):
  * Footage recorded from a local copy of the site (test accounts only, no real user data) in headless Brave at
    1920×1080 with CDP screencast. Page-driven scenes ran with the page clock slowed to ¼ (performance.now, Date.now,
    rAF, timers and CSS animations scaled) and played back 4× faster → smooth 30 fps; Android and Cloud PC streams
    recorded in real time from the local KVM node.
  * The Game Maker run is a real win: a press schedule found by searching against the engine in Node, replayed
    frame-exactly in the editor through the new optional `hooks.onStep`.
  * Original soundtrack synthesized with numpy (no samples or third-party audio); title cards rendered from HTML with
    Inter (OFL); edited with ffmpeg on the bar grid (120 BPM).
  * Android carries a “Próximamente” badge: it works on a KVM node, but the public site has none yet.
* **Fix — Android streams after the first one:** scrcpy's `cleanup=true` deletes the server jar from the device when a
  stream ends, but the agent cached “already pushed”, so every later stream timed out (`connect timeout`). The agent now
  pushes the jar before every stream (as the official client does) and retries a failed start once. Regression test:
  three streams in a row, each started after the previous one stopped (30 s after its last viewer) → 3/3 live.
  The production compute node has no Android, so this ships to the KVM node when it is set up.

## 4. Next phases (in order)

Everything in the module table that can be built without the owner's purchases or keys is done (phases 1–20).
What remains needs the owner:

1. **A KVM compute node** for Nebulix Android (and faster Cloud PC): a bare-metal server (e.g. OVH So you Start
   SYS-GAME-1/2, Hetzner AX42 or an auction server) with HTTPS, set up with `services/compute-node/README.md` and added
   in Admin → Compute. No free host can do this (Fly: no KVM; Oracle Always Free: ARM only).
2. **API keys** for IGDB (Twitch client ID/secret), the Steam Web API and Discord, if those integrations are wanted
   (keyless official APIs — FreeToGame, CheapShark — are already integrated).
3. **A background-removal service** (e.g. a remove.bg API key) if Nebulix Photo should offer it.
4. Optional later: server-side runtimes (Python with packages, other languages) on compute nodes.

## 5. How to verify

* Local server: `DATA_DIR=<copy> PORT=3999 node server/index.js`.
* Regression suites (scratch test scripts) cover economy, Hub, media, study, profiles; all passed for 14.1.
* New in 3.0 was tested in a browser: every Toolbox tool, the 5 games (start, play, scoring), the OS Task Manager,
  Clipboard and switcher, with no console errors.
