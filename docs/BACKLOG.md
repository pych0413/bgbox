# Backlog — polish to apply after batch-1 builders deliver

Source: `docs/research/ux-survey.md` §7–§8 (the "must" list), cross-checked against DESIGN.md.
Owner = which part of the code a follow-up pass touches.

| # | item | owner | batch |
|---|---|---|---|
| 1 | **Narration watchdog.** If a cue's speech never starts (no `onstart` within ~1.5 s), never ends (length timeout), or volume is 0: show the line as big text on the host with 重講 / 跳過 / 下一步, never stall silently. | core/narrator.js + ui/shell NarratorBar | 1 |
| 2 | **Pre-flight check** before the first narrated game of the evening: zh-HK voice installed? (if not: Settings › 輔助使用 › 語音內容 › 聲音 › 中文(香港), fall back zh-TW), test line at current volume, silent-switch reminder, wake lock, Add to Home Screen tip, motion permission for dice games. | ui/shell | 1 |
| 3 | **Role-independent night feedback.** Same tap sound/animation/duration for every seat at every night step, incl. absent/dead roles. Assert in tests that every seat has a legal action during every night step. | games (cheese-thief first) + tests | 1 |
| 4 | **Black eyes-closed screen** between a seat's own night actions: near-black, no white flashes, fades only, hint to lower brightness. | ui/shell night overlay | 1 |
| 5 | **Wall-clock timers, wake lock on every phone while playing, resync on `visibilitychange`** (re-request views before rendering; banner 「已經同步」). | core/client + ui | 1 |
| 6 | **Seat recovery.** Lost token (new tab, cleared storage): tap your name in the room to reclaim it, host approves. | core/room + ui lobby/join | 1 |
| 7 | **Pacing presets** for narrated games: 新手 (slow) / 標準 / 快速, plus per-step pause scale and a 試聽 preview. | core/narrator + games' cue minMs | 1 |
| 8 | **Presets with a reason** per head-count in config forms (e.g. 「6 人：1 臥底 1 白板 — 新手友善」), invalid compositions blocked, role-count invariants fuzz-tested. | games + ConfigForm | 1/2 |
| 9 | **Saved group.** Names, colours and seat order remembered on the host device; next evening pre-fills the lobby. | core/room + ui | 1 |
| 10 | **Results that explain why**, including a night recap players could not see live. | games' result.lines | 1/2 |
| 11 | **Bag exhaustion UX.** When a filtered pool runs dry: say so, offer 重置 or 放寬類別. | core/bag + ConfigForm | 1 |
| 12 | **Offline single-device mode verified** end-to-end with the service worker; "可離線玩" badge. | delivery + ui | 1 |
| 20 | **Fair randomness.** First speaker random over ALL seats (undercover/spy included); optional anti-streak so the same person is not the spy/undercover twice running when avoidable. | games (undercover, spyfall, 9upper) | 1 |
| 22 | **Low-typing policy.** No typed input required in live play; typed guessing is opt-in. | games (draw-guess) | 2 |
| 23 | **Text size setting** (normal / large) for dim rooms and older eyes. | ui | 1 |
| 25 | **Host console safety.** Panic pause, "who is connected" list with battery reminder. | ui/shell host menu | 1 |
| T1 | **Built-in timer / alarm (user request).** ⏱️ in the lobby and play top bars, available in every game whether or not the game has its own timer. Host picks 30 s / 1 / 3 / 5 min / custom; the countdown is room state, so every phone shows it in sync (wall-clock deadline, resync on return). Warnings at 10 s, and at zero a sound + full-screen flash (no vibration on iPhone). 「枱中大時鐘」 full-screen mode for a phone lying in the middle of the table; pause / +30 s / stop. Works in local mode. Honest limit shown in help: the alarm only rings while the app is open (wake lock keeps the screen on). | core/room + ui/shell + Timer | 1 |
| U1 | **In-app teaching, ON DEMAND ONLY (user request — nothing shown by default).** A 💡 icon in the play top bar opens a sheet: 「而家要做咩」 (the phase hint from `view.hint`, one line, written for a first-timer), 「你嘅角色」 (*what you do* + *how you win*), and a link to the full 📖 rules. Every game provides `view.hint` for every phase, `rules.quick` (≤6 short lines) and every role in `rules.roles` with what-you-do AND how-you-win. Long-press a role name anywhere → its one-line ability. No auto-popups, no default-on tutorial mode. QA checks wording is short and beginner-friendly. | games + ui/shell | 1 |

## Framework fixes from `docs/research/codebase-map.md` §11 (H = before release)

| id | sev | fix | owner |
|---|---|---|---|
| G1 | H | `setup` gets `hostPid` (and `Sim` passes one) — needed for moderator modes (`custom` hostPlays=false). | DESIGN §4, core/session, tests/lib |
| G4 | H | Actions have ack/failure feedback: UI shows 「冇送到 / 重連緊」 instead of pretending; no optimistic state. | core/client + ui |
| G10 | H | Register the service worker (snippet in sw.js header); build stamp in `hello`/`welcome` → mismatched peers get 「請重新整理」; deploy rule: never push during play; in-app browser (LINE/WhatsApp/IG) → 「請用 Safari 開」 hint. | ui + core |
| G11 | H | Banks end up as single files after the content curators run; add merge-time uniqueness asserts as a test (`tests/data.test.mjs`). | tests |
| G18 | H | `app.local()` and the home screen never touch `Peer`; multi-phone entry shows 「多部手機玩要上網」 when PeerJS failed to load. | core/client + ui |
| G20 | H | `?as=<name>` storage namespace so two tabs in one browser are two devices (needed for our own testing). | core/util storage + client |
| G3 | M | Lobby: offline seats are dropped after a grace period (or host kicks); `start()` warns about offline seats. | core/room |
| G7 | M | PeerJS id namespace → `bgbox-v2-`. | core/net |
| G9 | M | Snapshot size guard: drop ink first, warn visibly if storage write fails. | core/client |
| G13 | M | Night "suppress" flag separate from the user's mute preference; Timer uses sfx.js, no private AudioContext. | core/sfx + ui |
| G14 | M | One set of DOM helpers (`ui/dom.js`); drop `$ $$ el toast` from core/util. | core + ui |
| G16 | M | `game.js` meta is the single source; registry must not drift (test that registry meta == game meta). | games/registry + tests |
| G17 | M | Remove the invented Cheese Thief presets (偵探/守衛) from `custom`; point people to the real 芝士大盜. | games/custom |
| G23 | M | Cap/chunk large messages (`inkSync`, `welcome`). | core/room |
| G27 | M | /bgbox/ rename: redirect page carrying `?r=` and hash, README, launch.json name. | release |
| G28 | L | Delete v1 files before the final bump. | release |

## Polish contract (core ↔ ui) — binding for the framework polish pass

New `app` surface (core/client.js) that ui/ consumes. Everything optional-chained in the UI.

| item | core provides | ui does |
|---|---|---|
| T1 timer | `app.state.room.timer = null \| { endsAt, label, paused, remainingMs }` (host clock; in lobby AND play; survives snapshot). `app.hostCtl.timer.start(ms, label)`, `.pause()`, `.resume()`, `.add(ms)`, `.stop()`. Local mode too. | ⏱️ button (host) in lobby + play top bars with presets 30 s / 1 / 3 / 5 min / 自訂; every phone shows a strip countdown; 「枱中大時鐘」 full-screen mode; warn sound at 10 s, zero sound + full-screen flash; help line about the app having to stay open. |
| U1 hints | — (games put `view.hint`) | 💡 in the play top bar → sheet: 「而家要做咩」 (`view.hint`), 「你嘅角色」 (role card's what-you-do / how-you-win from `rules.roles` matched by `view.role?.id` or `view.mine?.role` when present), link to 📖. Never auto-opens. |
| #1 narration watchdog | narrator reports `onstart`/`onend`; `app.state.narration = { mode, status: 'idle' \| 'speaking' \| 'stalled', line }` (stalled = no start within 1.5 s or length timeout hit). | Host NarratorBar shows the line big when stalled with 重講 / 跳過 / 下一步. |
| #2 pre-flight | `narrator.hasCantonese()`, `narrator.test(text)`. | Before the first narrated game of a session: a 30-second check screen (zh-HK voice? test line, silent-switch reminder, Add to Home Screen tip, motion permission for dice games). Skippable, remembered per device. |
| G4 ack | `app.act()` returns a Promise that resolves when the host's next `views` rev arrives and rejects after 4 s or when offline; `app.state.outbox` = unacked count. | 「傳送緊…」 if outbox > 0 for > 1.5 s; 「冇送到 — 重連緊」 toast on reject; never pretend success. |
| #5 resync | on `visibilitychange` → visible: client pings, re-requests views, re-acquires wake lock; `app.state.resyncedAt`. | brief 「已經同步」 chip. |
| #6 seat recovery | client: `app.claimSeat(code, pid)`; host: room view `claims: [{ pid, name, deviceId }]`, `app.lobby.approveClaim(pid)`, `app.lobby.rejectClaim(pid)`; a reject on hello for a duplicate disconnected name returns the claimable pid. | Join screen offers 「我係 阿明，之前斷咗線」 when the name matches a disconnected seat; host sees an approve card. |
| #9 saved group | room saves `bgb:group` { names, colours, order } at each start; `app.state.savedGroup`. `app.lobby.applySavedOrder()`. | Local-mode name list pre-filled; lobby 「用返上次座位」 button. |
| #11 bag | `app.bag.stats(bankId, filter)`, `app.bag.reset(bankId)`; `notice` event when a pool reshuffles. | ConfigForm categories field shows 已用 / 總數 and 重置 when stats are available. |
| G10 version | `hello`/`welcome` carry the build stamp (read from the `?v=` of js/main.js); mismatch → `app.state.versionMismatch = true`. | Banner 「有新版本 — 請重新整理」 (host and clients). |
| G13 night | `sfx.setSuppressed(bool)` separate from the user's mute; Timer uses sfx only. | Night overlay calls setSuppressed, never setMuted. |
| G18 offline | `app.local()` and home never touch `Peer`. | 開房 / 入房 show 「多部手機玩要上網」 if PeerJS failed to load; in-app browsers (LINE / WhatsApp / Instagram UA) get 「請用 Safari 開」. |
| #4 night screen | — | Night overlay near-black, fades only, no white flashes; hint to lower brightness. |
| #23 text size | — | Settings: 字體 標準 / 大 (root font-size scale), per device. |
| #25 host console | room view already has players' `connected`; | Host ⋯ menu: who is connected (🔋 reminder), 暫停 always one tap away. |

## Requests from game QA (collected)

| from | request | owner |
|---|---|---|
| qa:spyfall | `config.presets?(n) → [{ id, label, reason, cfg }]` rendered as one-tap chips above ConfigForm (sent to polish:ui). Games adopt it afterwards. | DESIGN §3 + ui + games |
| qa:spyfall | 💡 sheet must keep secret roles behind hold-to-peek (sent to polish:ui). | ui |
| qa:spyfall | Generic host action for a seat that drops mid-vote: `{ type: '@absent', pid }` / `@void-round`, so engines can count unanimity over connected seats or void the round. | DESIGN §4 + core + games |
| qa:spyfall | Spyfall locations: 11 roles each (Spyfall 2 tables up to 12 never repeat a role). | data |
| build:avalon | Stall detection must ignore decoy actions: `engine.blocking?(state, pid)` → else focus.pids → else legalActions (sent to polish:core). | core |
| build:avalon | Results screen: render `result.lines` as folded emoji-headed sections for long recaps. | ui |
| build:avalon | Lobby hint for turn-order games: 「座位次序＝輪流次序，開局前用換位排好」. | ui |
| build:avalon | Optional `focus.decoyPids` so every seat shows the same 輪到你 badge during a secret step. | core + ui (low) |
| build:fake-artist | Keepsake: the final results screen keeps the last picture(s) (shell keeps `ink` after the session stops, view-only Canvas) — and offers 「儲存圖片」 (canvas → PNG download/share) as a trip souvenir. | ui |
| build:fake-artist | Compact/auto-collapse the host NarratorBar while a Canvas can draw, so it never covers the sheet. | ui |
| build:onuw | Shared phone, empty night step: room.filterFocus must keep `{ pids: [], anonymous }` for a device holding seats, and play.js shows the same anonymous decoy gate even when the called role is in the centre — otherwise a shared phone reveals that a role is absent. | core + ui (H for night games) |
| build:onuw | Results screen: section headings (`{ h: 'title' }` entries or `result.sections`) instead of one flat list. | ui |
| build:draw-guess | `bag.release(bankId, key)`: the engine already calls `ctx.bag?.release?.('draw', w)` for unpicked offers and voided words; today the bag consumes every offered word. | core |
| build:draw-guess | Room must call `config.defaults(n, prev, { singleDevice })` everywhere (builder saw two arguments) so typed guessing is never kept for one shared phone. | core |
| build:draw-guess | Host-menu extension point: `engine.hostActions?(state) → [{ label, action }]` dispatched as `@host` (draw-guess +30 s / 呢題作廢 today only show on the host seat's screen). | core + ui |
| build:draw-guess | Optional per-game default narration mode (`meta.narrationDefault`): typed/quiet games should not default to voice. | core + games |
| build:draw-guess | Lobby UI to move players between teams (today seat order or a random split decides). | ui (low) |
| build:draw-guess | Optional dedicated 'ding' and 'hint' sounds in sfx.js. | core (low) |
| qa:onuw | Room#finish honours `result.void === true`: no scoreboard played/wins, history line marked 唔計. | core |
| qa:werewolf | Room#finish must not count non-players (the human moderator) as played: `result.spectators: [pid]` or an engine marker. | core |
| qa:avalon / qa:fake-artist / qa:onuw | ⋯ menu 「呢鋪唔計」 (two taps / confirm) → `app.hostCtl.voidRound()`; when it returns false show a toast (e.g. 「呢輪已經計咗分，㩒下一輪就得」). Also on the stalled-seat card: 代佢做 · 呢鋪唔計 · 再等. | ui |
| qa:werewolf | NarratorBar 讀稿 mode: debounce 下一步 ~1.5 s after a cue ends, so a double tap cannot acknowledge a line and then cut the night window short. | ui |
| qa:onuw / qa:werewolf | 💡 sheet: read `view.roleId` for the seat's own role; allow `view.hintRoleLabel` (e.g. 「你派到嘅角色」) for games where cards change hands. | ui (low) |

## Found in the batch-1 preview smoke test (2026-10-03 09:05 UTC)

| item | status |
|---|---|
| Registry `batch` flags did not match the staged release (ONUW/werewolf/Avalon were 1, 9upper was 2), so three missing games looked playable. | fixed in 8ea1d81 |
| 一部手機玩 setup: empty name fields show 「玩家 1…」 placeholders but 開始 refuses with 「最少要 2 個人」. Placeholders look like defaults — either use them as names when left blank or make the hint say 「填名先」. | open (ui) |
| P2P: a headless-Chrome run saw guests fall back to the join screen 14–20 s after joining. Not reproduced in the app's browser pane on the live Pages build (host + background guest tab, lobby then a game, 141 s stable). Re-check on real iPhones during the trip test. | watch |
| `manifest.webmanifest?v=1` in index.html is not restamped by tools/bump-version.sh. | open (tools, low) |
