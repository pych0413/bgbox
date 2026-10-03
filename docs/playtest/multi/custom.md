# 通用派牌＋骰盅 (`custom`): multi-agent playtest review

Session `mp-custom`, room 5662, 2026-10-03 20:06–20:20 UTC. Three AI players (haiku and sonnet) each drove one headless phone window (390×844). The build was the deployed `https://pych0413.github.io/bgbox/` (`main.js?v=20261003171423`). I fetched the deployed `js/games/custom/{game,ui}.js`, `js/ui/screens/home.js`, `js/ui/shell.js` and `js/core/client.js`. Once the `?v=` stamps are normalised they match local `a72d23e`. Seats: p1 阿聰 (host, also a player), p2 阿明, p3 小美.

Settings: defaults, because `config '{}'` was passed. That gives preset 🎭 一個內鬼 (1 內鬼 + 2 好人), 1 × d6, `hostPlays` true, `selfRoll` true, `modSees` false, `antiStreak` false, narration silent.

Sources checked:
- Rules and flow: `docs/research/custom.md` **does not exist**, so there was no "## Verification" section to apply (see #11). I used the flow spec `docs/games/custom.md` (§3 Flow, host-controls table, Peek/seen/locks, Anti-tell) as the rules of record, and the in-app `rules` in `game.js:409-465`.
- Code: `js/games/custom/{game,ui}.js`, `js/ui/components/{DiceCup,Cover}.js`, `js/ui/dom.js`, `js/ui/{shell,sheet}.js`, `js/ui/screens/{home,play,results}.js`, `js/core/{client,net}.js`, `css/base.css`, and the console `tools/playtest/pt.mjs`.
- Evidence: table talk (`pt hear`), `see` on every seat, the reports' screenshots plus new ones (p2-003, p3-008), `eval` probes on p1 (state, click coordinates, a captured `confirm()` text), and `room.lastResult` / `room.history` after I finished the game.

`node tests/run.mjs custom` gave 54 passed and 0 failed. The UI test stubs `globalThis.confirm = () => true` (`tests/custom.test.mjs:1185`), so it never sees the blocking dialog behind #1 and #2.

## Verdict

**The players did not finish. The cause is a native `window.confirm()` dialog that the console cannot see or answer. Nothing is wrong in the game's rules engine.** The host tapped 👁 開晒啲骰 at 20:10:35. `ui.js` asks 「公開所有人嘅骰？」 through `window.confirm` (I captured that exact text later). The console has no dialog handler, so the tap's `mouseReleased` never returned ("fetch failed" after 120 s), and every later command on p1 queued behind the open modal. The host's phone is the room's server, so its frozen JS stopped serving the room. Both guests went to 「同房主斷咗，重連緊…」 after about 12 s (`SILENT_MS`), then to 「揾唔到房主」. The engine never received `reveal-dice`: the restored snapshot still had `revealDice: false`.

The second "blocker", the dead 返去 button, is a **console artifact**. p1 reloaded its tab through its own raw CDP connection, outside the console. After that, the console's taps on p1 land at **half** the coordinates (I logged a click at 98,14 for the 💡 button centred at 196,28). A JS `click()` on the same 返去 button restored the room in under 4 s: `mode host`, `conn online`, the game paused, every flag and log line intact. Both guests reconnected by themselves.

**I finished the game afterwards to verify the rest of the flow.** On p1 only, I replaced `window.confirm` with a stub that returns true, tapped ▶ 繼續, then 👁 開晒啲骰, 🔓 開晒角色 and 🏁 結束遊戲. The showdown showed 阿聰 1 · 阿明 2 · 小美 4. The roster then read 阿聰 🎭 內鬼 · 阿明 🙂 好人 · 小美 🙂 好人, and every seat reached the results screen. `room.lastResult.lines` = 「阿聰：🎭 內鬼　🎲 1」, 「阿明：🙂 好人　🎲 2」, 「小美：🙂 好人　🎲 4」, 「🙂 好人（2 個）：阿明、小美」, and `room.history` has one entry. This confirms what was said at the table: 小美's 4 and 阿明's 2 were true. 阿聰 claimed 5 on a real 2, then re-rolled once to a 1. The log holds two 「阿聰 搖咗骰」 lines, not the three he reported. At the table the good side won 2 votes to 1.

**Real app findings:** two majors and several minors and polish items.
- **Major:** a blocking native `confirm()` on the phone that is the server (#2).
- **Major:** the connection bar covers the header, so a stranded guest cannot reach ⋯ → 離開 (#3).
- **Minor and polish:** re-rolls are visible only in a folded log, the "iPhone" motion text shows on any device, the die faces have no text alternative, the dice reveal gets no status line, and the results header says 「冇人贏」 for a tool that does not score.

No secret was readable at a glance on any screen. The cup sits above the card, both stay behind hold-to-peek, and the roster flags carry no values.

## Did it finish?

**No, not by the players.** Their table round worked:
- 20:07: cards and dice dealt privately.
- 20:08–20:09: numbers claimed and argued over.
- 20:10: the vote at the table went 阿聰 ×2 vs 阿明 ×1.

The app round stalled at the host's first reveal tap. After the session I resumed the host and finished it myself (see Verdict). Room phase is now `results`, and `lastResult.summary` = 「通用派牌：玩咗 1 回合」.

| time (UTC) | what happened |
|---|---|
| 20:06:45–20:06:54 | all three 準備好; host started |
| 20:07–20:08 | each held the card, rolled, held the cup; claims 小美 4, 阿明 2, 阿聰 5 (real 2) |
| 20:08:57 | 小美 locked her dice (🔒骰 public, host got the per-seat 🔓) |
| ~20:09–20:10 | 阿聰 re-rolled once (log: 2 rolls total for 阿聰) |
| 20:10:04–20:10:24 | table vote: 小美 → 阿聰, 阿聰 → 阿明, 阿明 → 阿聰 |
| 20:10:35 | host tapped 👁 開晒啲骰 → native confirm opened → console hung → host page frozen |
| ~20:11 | guests: 「⚠️ 同房主斷咗，重連緊…」 (flapping) |
| ~20:17 | guests: 「⚠️ 揾唔到房主 — 佢可能熄咗個頁面」, covering the header buttons |
| ~20:20 | p1 reloaded its tab outside the console; console taps on p1 now land at half coordinates; 返去 "dead" |
| ~20:30 | reviewer: JS-clicked 返去 → room restored (paused), guests reconnected; stubbed confirm; 繼續 → 開晒啲骰 → 開晒角色 → 結束遊戲 → results on all seats |

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | blocker | harness | The playtest console cannot see or answer native dialogs, so any `confirm()` hangs the seat for good | The daemon enables the Page domain but never listens for `Page.javascriptDialogOpening`. A tap that opens `window.confirm` blocks inside `Input.dispatchMouseEvent(mouseReleased)` until the dialog closes, which never happens. The CLI request times out ("fetch failed", 120 s), and every later `see` / `tap` / `shot` on that seat queues behind the modal. p1's own CDP session got "No dialog is showing" because a session only tracks dialogs that opened after its own `Page.enable`. In this game it hits all four confirmed host buttons (開晒啲骰, 開晒角色, 重新派牌, 結束遊戲) and 全體搖骰 when a cup is locked, so **no AI table can ever reach the results screen of `custom`**. Shell confirms elsewhere hit it too: 呢輪作廢 (`play.js:111`), 踢走 (`lobby.js:505`), 離開 (`shell.js:185`), and 重置 in `ConfigForm.js:335`. | `tools/playtest/pt.mjs:213` (Page.enable, no dialog listener); `:252-258` (`tap` awaits `mouseReleased`) | In the daemon, listen for `Page.javascriptDialogOpening` per session and keep `{type, message}`. Send `mouseReleased` without awaiting the click handler, or race it with a short timeout. Show an open dialog in `see` as `[dialog] confirm "公開所有人嘅骰？" → tap ok / tap cancel`, and map `tap <seat> ok|cancel` to `Page.handleJavaScriptDialog`. Never auto-accept, so the player still makes the choice. | `tools/playtest/pt.mjs` |
| 2 | major | flow / connection | Host-only reveal and end buttons use a blocking native `confirm()` on the phone that *is* the server | `sendHost` → `confirmed()` → `globalThis.confirm`. While the host reads 「開晒所有角色？呢個回合就完喇。」, every timer and data-channel handler in the room stops. A guest's action gets no ack after 4 s (`ACK_TIMEOUT`) and toasts 冇送到. After 12 s of host silence (`SILENT_MS`) every guest shows 「同房主斷咗，重連緊…」 and re-dials, which is what the guests saw here. A host who stops to discuss "should I open them?" for 12 s drops the whole table. Unverified extra risk: an Android in-app WebView without `onJsConfirm` returns `false` silently, so the four buttons would just do nothing. The spec requires a confirm ("Reveals are host-only and confirmed"), but not a native one. The box already has an in-page two-tap pattern (`9upper/ui.js:187` `confirmButton`). Evidence: the stub captured 「公開所有人嘅骰？」 from this button, and the snapshot taken after the freeze had `revealDice: false`. | `js/games/custom/ui.js:47-49` (`confirmed` = `globalThis.confirm`), `:132-136` and `:159-162` (`sendHost`), `:165` (`rollAll`); `js/core/client.js:64,67` (4 s / 12 s timeouts) | Replace `confirmed()` with an in-page arm-then-confirm. The first tap turns the button into 「再㩒一次：公開所有人嘅骰」 for about 3 s, and the second tap sends. An open `openSheet` confirm also works. Either way the event loop keeps serving the room. Update the UI test to drive the two taps instead of stubbing `confirm`. Separately, give `sh.confirm` (`shell.js:182`) the same non-blocking treatment for 作廢 / 踢走 / 離開. | `js/games/custom/ui.js`, `tests/custom.test.mjs`; later `js/ui/shell.js`, `js/ui/screens/{play,lobby}.js` |
| 3 | major | ux / connection | The connection bar covers the play header, so a guest stranded by a lost host cannot open ⋯ → 🚪 離開房間 | `.netbar` is `position: fixed; top: 0; z-index: 95`, about 2.25 rem tall. `.play-top` is `sticky; top: 0; z-index: 30`, and its icon buttons sit 9–47 CSS px from the top. The bar hides the top two-thirds of 💡 📖 🔊 ⋯ (p3-006). The console marks all four COVERED, and p3's tap on 選項 opened nothing. Only `.status-layer` is moved down when the bar shows. When the host is gone (「揾唔到房主 — 佢可能熄咗個頁面」), the only way out is ⋯ → 離開, so the bar hides the exit exactly when it is needed. A person aiming at the icon centre hits the bar. | `css/base.css:1165-1170` (`.netbar`), `:1196` (only `.status-layer` offset), `:897-901` (`.play-top` sticky at 0) | Push the page down while the bar shows: `body:has(.netbar:not(.hidden)) { padding-top: calc(2.25rem + var(--safe-t)); }` and `body:has(.netbar:not(.hidden)) .play-top { top: calc(2.25rem + var(--safe-t)); }`. Also, once a client has said `host-gone` for about 30 s, put a 「🚪 離開」 button in the bar (`connectionMessage` → node instead of text). | `css/base.css`, `js/ui/shell.js` (`netbar`) |
| 4 | minor | rules / anti-cheat | Re-rolls before a lock show only in the folded 📜 log, and the roster says 🎲 已搖 whether you rolled once or ten times | The spec makes the lock optional and puts each roll in the public log (Anti-tell: "The public log says *that* someone rolled or locked, never what"), and the app does exactly that: 「阿聰 搖咗骰 🎲」 appears twice. But the log is a closed `<details>` at the bottom of the screen, and the roster tag carries no count. A bluffer can roll until the die matches a claim and then lock, and in practice nobody notices. That defeats the liar's-dice use the spec names. The host-player can also lift his own lock (🔓 per seat). That is logged too, but it is just as easy to miss. A roll count would not break anti-tell, because the log already makes the count public. | `js/games/custom/game.js:650-664` (`publicSeat`: `rolled` only), `:479-483` (`rollSeq` never reset, so it cannot be reused per round); `js/games/custom/ui.js:248` (tag), `:148-149` (log fold, closed) | Track `rollsThisRound` per seat (reset by `next-round`, set to 1 by `roll-all`), publish it in `publicSeat`, and tag 「🎲 已搖 ×3」 when it is above 1. Optionally add a config `lockOnRoll` (「搖完即刻鎖」, for liar's dice). Add one line to the 骰盅 rules section: 「講點數之前先鎖，大家先信你」. | `js/games/custom/game.js`, `ui.js`, `tests/custom.test.mjs`, `docs/games/custom.md` |
| 5 | minor | text / ux | 「㩒一下，iPhone 會問你畀唔畀動作權限」 shows on non-iPhones, and the shake row pushes the role card below the first screen | `needsMotionPermission()` is a feature test (`DeviceMotionEvent.requestPermission` is a function). Chrome 154 on Windows passes it (verified on p2), so recent Chrome on Android very likely does too, and every such phone gets the iPhone wording. The 📳 開啟搖骰 button and its note also take about 110 CSS px between the cup and the role card (p3-002, p3-006). The other texts in the same branch also name Apple: 「iPhone 拒絕咗動作權限」, 「Safari 記住咗…」 and 「iPhone 未送緊動作數據」. Reported by p1 and p3. | `js/ui/components/DiceCup.js:249` (and `:229-231`, `:245`); `js/core/shake.js:21` | Use neutral wording: 「㩒一下，部手機會問你畀唔畀用動作感應（之後搖部機就擲骰）」. Keep the iPhone / Safari text behind a real iOS check. Fold the note into the cup's own hint line to save a row. | `js/ui/components/DiceCup.js` |
| 6 | minor | a11y | Die faces are pictures only: no text in the cup or in the 開盅 list | A d6 face is a `div.die.pips` with pip children and no `role` or `aria-label`. The cup's `aria-label` stays 「㩒住睇骰仔」 while it is held open. A screen-reader user cannot read their own die, or anyone's after 開晒啲骰 (`see` on p3 after the reveal: 「開盅 🎲 / 阿聰 / 阿明 / 小美」, with no numbers). Other sides (d4, d8, …) already render the number as text. | `js/ui/dom.js:109-114` (`dieFace`); `js/ui/components/Cover.js:110` (static label); `js/games/custom/ui.js:329` | `dieFace`: `role="img" aria-label="${value} 點"` on the pips die. The Cover root is `role=button`, so its children stay out of the accessibility tree while it is closed. For the showdown, also set the row's `aria-label` 「阿聰：1 點」. Optionally have Cover switch its `aria-label` to the front's text while open. | `js/ui/dom.js`, `js/games/custom/ui.js` |
| 7 | polish | ux | Opening the dice changes no status line, and the 開盅 list sits below the role card, under the fold on every phone | `statusLine` handles `ended` and `revealRoles` but not `revealDice`, so the banner keeps saying 「大家都睇咗牌 ✓」. The only cue at the top is the cup header 「已經開盅，要主持再搖」 and the `lift` sound. On p3 the showdown started about 630 CSS px down. A table waiting to compare claims has to know to scroll. | `js/games/custom/ui.js:232-239` (`statusLine`), `:152` (order: cup, card, **showdown**, roster) | Add `if (v.revealDice) return ['ok', '👁 開咗盅 — 睇下面「開盅」'];` before the "everyone looked" line. Optionally move `showCard` above `roleCard` while it is visible, as the spec's order is for the play state. | `js/games/custom/ui.js`, `docs/games/custom.md` §3 |
| 8 | polish | text | Results say 「— 冇人贏」 and give everyone 🥇 for a tool whose rules say the app does not score | `result()` returns `winners: []` on purpose, and its own first line says 「app 唔計輸贏，邊個贏由你哋自己講」. The shell header still reads 「🎲 通用派牌＋骰盅 — 冇人贏」 with 🤝, 今晚玩過 says 冇人贏, and 今晚戰績 ranks all three 🥇 with 0 wins (p3, p2-003). Here the table had just decided the good side won, so the header contradicts the group. | `js/ui/screens/results.js:244`; `js/ui/components/Scoreboard.js:57`; `js/games/custom/game.js:868` | Let `result()` return `noScore: true` (or read `meta`), and have results.js title it 「— 邊個贏由你哋講」 with Scoreboard showing 「（唔計分）」. Skip the medal column when no game tonight scored. | `js/ui/screens/results.js`, `js/ui/components/Scoreboard.js`, `js/games/custom/game.js` |
| 9 | polish | ux / text | A locked cup shows a greyed 「🔒 已鎖，主持解鎖」 *button* next to a greyed roll button, and the rules call the lock by another name | After locking, both buttons are disabled, so the row looks broken (p3-005). The rules sheet says 「㩒『鎖定骰盅』會凍結你嘅點數」, but the button says 「🔓 鎖定點數」 (the spec and the UI agree on 鎖定點數). | `js/ui/components/DiceCup.js:291-294`; `js/games/custom/game.js:450` | Show the locked state as a label or badge (`.c-cup-locked`, not a disabled button) and keep the roll button hidden while locked. Change the rules text to 「鎖定點數」. | `js/ui/components/DiceCup.js`, `js/games/custom/game.js` |
| 10 | polish | flow / help | First-time tables do not know how to play a preset: no suggested round for 🎭 一個內鬼 | Both guests asked 「呢個咩玩法㗎？我哋點樣揾內鬼？」 (20:07:41), and the host made up a round: roll, say your number and a line, count to three, point. The preset's `why` 「最簡單：得一個人唔同一伙，自己作題目都啱用」 and the 💡 line 「跟大家講好嘅規則玩」 do not suggest one. Not finding one is by design ("the app does not know the game"), but a one-line suggestion behind 💡 costs nothing and follows the user's 貼心-on-demand rule. Reported by p1 and p3. | `js/games/custom/game.js:51-60` (preset has no `howTo`), `:723` (hint), `:440-443` (預設牌組 section) | Give each preset a `howTo` line, for example traitor: 「建議：輪流講一句，數三聲一齊指；指中內鬼好人贏。」 Show it in 📖 預設牌組 and in the 💡 sheet once everybody has looked. Never show it by default. | `js/games/custom/game.js`, `docs/games/custom.md` |
| 11 | polish | harness / docs | The playtest brief points to `docs/research/custom.md`, which does not exist, so there is no "## Verification" for this game | `docs/research/` has research for nine games but none for `custom`. The flow spec has no Verification section. All three players and this review fell back to `docs/games/custom.md`. Reported by p1 and p3. | the workflow brief; `docs/research/` | Either write a short `docs/research/custom.md` (rules of record: lock semantics, reveal finality, what is public) with a "## Verification" section, or have the brief name `docs/games/custom.md` for tool-type games. | playtest workflow script, `docs/research/` |
| 12 | minor | harness | After a tab reload outside the console, the console's taps on that seat land at half coordinates | After p1's raw-CDP reload, `tap` on 💡 (centre 196,28) produced `click@98,13` on a `<B>`. p2 (never reloaded) taps correctly. That is why 返去 looked dead (rejected below). Viewport and DPR still read 390×844 @2, so this is an input-mapping problem in the daemon's session, not the page. | `tools/playtest/pt.mjs:210-219` (emulation applied once per session at start) | Add a `reload <seat>` op that reloads through the daemon's own session and re-applies `Emulation.setDeviceMetricsOverride` / focus emulation. In the player brief, tell players never to drive CDP directly. | `tools/playtest/pt.mjs`, player brief |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p1 (blocker) | 返去 on the home screen does nothing, so the host cannot resume | **AI artifact (console).** The console's taps on p1 land at half coordinates after p1's out-of-console reload (#12). A JS `click()` on the same button resumed the room in under 4 s: `mode host`, `conn online`, paused, flags and log intact. Both guests rejoined automatically. The resume code (`client.js:889-939`, `home.js:126-152`) works. |
| p1 (blocker), p2 (blocker), p3 (blocker) | The host's phone froze or disconnected after 開晒啲骰 and the game could not end | **Merged into #1 (cause) and #2 (the real app risk).** The freeze is the native confirm that the console cannot answer. A human would see 「公開所有人嘅骰？」 and tap OK. The app-side cost (a blocking modal on the server phone) is kept as #2. |
| p3 (major) | Reveal and end are host-only, and a guest cannot nudge or trigger them | **App is right.** The spec's host-controls table lists them for the host seat only, and its Anti-tell section says "Reveals are host-only and confirmed; nobody can open another seat's card or cup." The host phone is the server (home: 「房主部手機就係 server」), so with no host there is no room to reveal in. The guest's missing way out is kept as #3. |
| p1 (major) | Re-rolls are undetectable, so claims are meaningless | **Partly app-is-right; downgraded to minor #4.** Every roll is in the public log (「阿聰 搖咗骰 🎲」 twice). Only the visibility (folded log, no count in the roster) is a real gap. p1 also over-counted: one re-roll landed, not two. |
| p1 (minor) | While holding the card the roster still says 未睇牌 | **App is right.** Spec, Peek/seen/locks: "`seen` is sent … when the finger is **released** after a peek, never on press", so the shared-phone gate moves on only after the peek, and how long you looked is not broadcast. |
| p3 (minor) | A lock is a public social tell | **App is right.** Spec, Anti-tell: "The public log says *that* someone rolled or locked, never what". The 🔒骰 flag is public so the host can lift it and so the table can trust a claim. 小美 used it as exactly that trust signal. |
| p2 (minor) | The host's aggressive talk gave him away | **Not an app issue.** That is table play. |
| p3 (minor) | The game screen started scrolled to 545/723 | **Unverified.** `shell.js:266` scrolls to 0 on every screen mount, and no game code scrolls. The console's `tap` calls `scrollIntoView` on its target, and p3 itself was unsure whether its lobby tap caused this. |
| p2 (good thing) | "Buttons are disabled (COVERED) during the disconnect, which prevents invalid actions" | **Misread.** COVERED means the connection bar lies on top of them (#3), not a deliberate disable. |

## AI-artifact notes

- **The freeze (#1).** Only a console with no dialog handling hangs forever. A person sees a native dialog and answers it. Kept as a harness blocker because no `custom` playtest can finish without the fix.
- **返去 (#12).** p1 left the console and drove CDP directly (its own declared deviation). Its reload broke the console's tap mapping for that seat. A human tapping 返去 on a real phone resumes the room (verified with a DOM click).
- **Timing.** The guests' banner came about 30–40 s after the tap because the host's JS was frozen indefinitely. A human host who answers the dialog within 12 s causes no visible drop, which is why #2 is major and not blocker.
- **Rule invention (#10).** Kept, because a human first-time group asks the same question.
- p1 once ran `see` on p2 by mistake (header text only, no secret). p2's timeline puts the drop at 20:10:43. The real trigger was the 20:10:35 tap.

## Missed by players (found in code)

- #2: the blocking `confirm()` on the server phone (players blamed the network).
- #7: no status line when the dice open.
- #8: 「冇人贏」 / 🥇-for-all on results. Nobody reached the results screen.
- #9b: the rules text says 鎖定骰盅 while the button says 鎖定點數.
- In #4: the host-player can lift his own dice lock. It is logged, but just as hidden as re-rolls.
- **No secret leaks found.** `publicSeat` only adds `roleId` / `dice` after a reveal (`game.js:661-662`). `v.all` exists only for a non-playing host with `modSees` (`:806`). The 💡 hint never reads a role (`:709-724`). `me.dice` is only the viewer's own. Covers close on blur, visibilitychange and pagehide (`Cover.js:18,36`).

## Rights checklist (merged per role)

In this tool every card holder has the same rights. The role changes only the card text. The host seat adds the controls.

**Every card holder (🎭 內鬼 p1, 🙂 好人 p2 and p3)**

| right | p1 內鬼 | p2 好人 | p3 好人 | reviewer | note |
|---|---|---|---|---|---|
| Hold to peek own role card; covers on release | ✓ | ✓ | ✓ | — | the card text has 做乜 / 點贏 |
| Roll own dice (🎲 搖我嘅骰, `selfRoll` on) | ✓ | ✓ | ✓ | — | |
| Hold the cup to read own dice (cup above card) | ✓ | ✓ | ✓ | — | picture only (#6) |
| Re-roll before locking | ✓ (1 landed) | — | — | — | visible only in the folded log (#4) |
| 🔓 鎖定點數 (only the host lifts it) | not used | not used | ✓ | — | cup: 「㩒住睇得，但搖唔到新骰」 |
| 🔓 鎖定角色牌 (owner toggles) | not used | not used | not used | — | button present; unit tests cover it |
| Public status: 已睇牌 / 🎲 已搖 / 🔒骰 / 🔒牌, banner | ✓ | ✓ | ✓ | — | no values leak |
| 🃏 本局牌組 and 📜 記錄 | ✓ | ✓ | ✓ | — | log folded by default |
| 💡 hint (role behind a hold) and 📖 rules | ✓ | ✓ | ✓ | — | |
| See 開盅 after the host opens the dice | ✗ (froze) | ✗ | ✗ | ✓ | 1 / 2 / 4 shown as faces; no status line (#7) |
| See every role after 開晒角色 | ✗ | ✗ | ✗ | ✓ | roster tags 🎭 內鬼 / 🙂 好人; long-press explains |
| Results screen (every card and die public) | ✗ | ✗ | ✗ | ✓ | header 「冇人贏」 (#8) |
| ⋯ → 🚪 離開房間 while the host is gone | — | ✗ | ✗ | — | covered by the connection bar (#3) |

**Host seat extras (p1)**

| right | p1 | reviewer | note |
|---|---|---|---|
| Per-seat 🔓 解鎖佢嘅骰盅 (appears on a locked row) | seen ✓, not tapped | — | |
| 🔓 解鎖骰盅 (all) | not used | — | unit tests |
| 🎲 全體搖骰 / 🃏 重新派牌 / ➡️ 下一回合 | not reached | — | unit tests |
| 👁 開晒啲骰 | ✗ (native confirm, console hung) | ✓ with confirm stubbed | #1, #2 |
| 🔓 開晒角色 | ✗ | ✓ | |
| 🏁 結束遊戲 → results | ✗ | ✓ | |
| ↩︎ 返去 after a refresh (host = server) | ✗ (console artifact) | ✓ | resumes paused; guests rejoin |
| ⏸ / ▶ 繼續 | — | ✓ | the restored room starts paused |
