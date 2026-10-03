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
