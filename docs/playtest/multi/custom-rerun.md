# 通用派牌＋骰盅 (`custom`): multi-agent playtest re-run (after fix rounds 1 and 2)

Session `mp2-custom` ran on 2026-10-04 from 00:29 UTC to about 00:35 UTC (about 6 minutes of table time) against `http://localhost:5199/`. Three AI players (sonnet) each drove one headless phone (390×844). The served `js/games/custom/{game,ui}.js`, `js/ui/components/{DiceCup,Cover,Scoreboard}.js`, `js/ui/dom.js` and `js/ui/screens/results.js` hash-match the working tree. That tree holds the uncommitted round-2 fixes on branch `v2`, and every line number below refers to it.

Seats: p1 阿聰 (host, also a card holder), p2 阿明, p3 小美. Config (`room.config`): preset 🎭 一個內鬼 (1 內鬼 + 2 好人), 1 × d6, `hostPlays` on, `selfRoll` on, `modSees` off, `antiStreak` off. Narration was silent.

Evidence used:
- the table chat (`pt hear`);
- `room.lastResult`, `room.history` and `room.scoreboard`;
- all 17 screenshots (`%TEMP%/bgbox-playtest-shots/mp2-custom/`);
- two live `eval` probes on p1 (`dieFace`, closed `Cover`);
- the code, and `docs/games/custom.md` as the rules of record. `docs/research/custom.md` still does not exist.

`node tests/run.mjs custom`: **59 passed, 0 failed**.

## Verdict

**The game finished.** All three seats reached the results screen. No native dialog appeared, nothing blocked, and no role was denied a right.

**The engine and the result were correct.** `room.lastResult.lines` lists 阿聰 🙂 好人 🎲 3, 阿明 🙂 好人 🎲 6 and 小美 🎭 內鬼 🎲 1. That matches what the host read out at the table (00:33:42) and the 開盅 screenshots (p2-004, p1-005). `noScore: true`, `winners: []`, and `history[0].noScore` is true. The table voted 2 to 1 against 阿明 (a 好人), so the 內鬼 got away. That was table play, not an app fault.

**Run 1's blocker and both majors are fixed.**
- The in-page 「再㩒一次：…」 confirm worked live for 開晒啲骰, 開晒角色 and 結束遊戲. The host phone never froze and no guest dropped.
- Of run 1's 12 findings, 9 are fixed (4 seen working live), 1 is fixed with a gap left over, and 2 are not fixed (table below).

**New confirmed findings: 2 minor and 5 polish, plus 2 carried over from run 1 (#8, #9).** The minor ones:
- After 開盅 the 🔓 鎖定點數 button stays live. A tap plays the lock sound, and the engine then refuses it without a word.
- On the first screen the banner says 「㩒住張牌」, but the first big gold cover is the dice cup. The role card starts at the bottom edge of the screen.

**Several reports were console artifacts.** These include the "die faces have no label" report (they do: `role="img" aria-label="3 點"`, verified live) and the "role text leaks in the 💡 sheet" report (the closed front is `aria-hidden`, verified live). Both were also reported in run 1. The console's text views are what fail to show the truth (see Harness notes).

## Timeline (UTC)

| time | what happened |
|---|---|
| 00:29:39–00:29:44 | all three said 準備好; host tapped 開始 |
| ~00:30 | each seat held its card (阿聰 好人, 阿明 好人, 小美 內鬼); 阿明 proposed: roll once, then one line each |
| 00:30–00:31:20 | all three rolled once (log: one 搖咗骰 each); 阿聰 locked his cup (🔒骰 on his row) |
| 00:31–00:33 | table talk; 小美 admitted rolling 1 |
| ~00:33:30 | host: 👁 開晒啲骰 → 「再㩒一次：公開所有人嘅骰？」 → confirmed; banner 「👁 開咗盅 — 睇下面「開盅」」, showdown 3 / 6 / 1 under the cup |
| ~00:33 | 小美 tapped 🔓 鎖定點數 after 開盅: nothing happened (#1) |
| 00:33:42–00:34:54 | spoken vote: 阿聰 → 阿明, 小美 → 阿明, 阿明 → 阿聰 |
| 00:35:19 | host: 🔓 開晒角色 (confirmed), then 🏁 結束遊戲 (confirmed) → results on every seat |

## Run 1 findings: status now

| run-1 # | title | status | evidence |
|---|---|---|---|
| 1 (blocker, harness) | Console cannot see or answer native dialogs | **Fixed in the harness; now moot** | `tools/playtest/pt.mjs:30,304-322` (dialog shown in `see`, answered with `dialog`/`tap 1|2`). This game no longer opens native dialogs at all |
| 2 (major) | Host reveal and end used a blocking `confirm()` on the server phone | **Fixed, seen live** | `ui.js:161-175` (`api.confirm` → `dom.js:194-216` `confirmTap`). All three confirms worked in the page; the room stayed online |
| 3 (major) | Connection bar covers the header, so a stranded guest cannot leave | **Fixed in code, not exercised** | `css/base.css:1230-1232` (`body.has-netbar` pushes `#app` and `.play-top` down), `:1225` (`.netbar-leave`). No disconnect happened this run |
| 4 | Re-rolls only in the folded log | **Fixed in code, not exercised** | `ui.js:264-265` (`🎲 已搖 ×N`), `game.js:450` (rules text). Nobody re-rolled this run |
| 5 | 「iPhone」 permission text on every phone | **Fixed, seen live** | p3-001: 「㩒一下，部機可能會問你畀唔畀動作權限」; `DiceCup.js:230-231` (`motionWords`) |
| 6 | Die faces are pictures only | **Fixed in code, verified by eval** | `dom.js:115-120` (`role="img"`, `aria-label="N 點"`); `Cover.js:73-77` + `dom.js:135-152` (label only while the cover is open). Live probe: `["img","3 點"]`. Players reported it again because the console does not print `aria-label` on non-controls (see Rejected) |
| 7 | No status line on 開盅; showdown below the role card | **Fixed, seen live** | `ui.js:252` banner 「👁 開咗盅 — 睇下面「開盅」」; `ui.js:152` showdown right under the cup (p2-004, p1-005) |
| 8 | Results said 「冇人贏」 and gave everyone 🥇 | **Fixed, with a gap** | Hero 「邊個贏由你哋講」 (`logic.js:97-99`), no medals (rank `·`), history 「唔計輸贏」 (`Scoreboard.js:63`). The leftovers are new #4: the 「點解會咁」 heading and a 贏 column of zeros |
| 9 | Locked cup showed two greyed buttons; rules said 鎖定骰盅 | **Fixed, seen live** | p1-005: a locked cup has the corner 🔒 and no buttons (`ui.js:205-209`); rules say 鎖定點數 (`game.js:450`) |
| 10 | No suggested round for a preset | **Not fixed** | No `howTo` in `game.js:51-60`. This run the vote snowballed behind whoever spoke first, which is the same gap. Carried over as #8 |
| 11 | `docs/research/custom.md` missing | **Not fixed** | All three players noted it again. Carried over as #9 |
| 12 (harness) | Taps landed at half coordinates after an outside reload | **Fixed in the harness** | `pt.mjs:20` (`reload` op), `:349-350` (tap self-check). Not needed this run |

## Confirmed findings (this run)

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | minor | dead control | After 開盅, 🔓 鎖定點數 stays enabled; a tap plays the lock sound and does nothing | The spec refuses `lock-dice` while the dice are open (§3 Peek/seen/locks: "while the dice are open, individual `roll` and `lock-dice` are refused"). The engine does refuse it. The UI hides the roll button (header 「已經開盅，要主持再搖」), but keeps the lock button live (p2-004). p3 tapped it: the screen did not change, the roster showed no 🔒骰, and no toast appeared. `DiceCup` plays `sfx('lock')` before the send, so the phone even sounds as if the lock worked. Reported by p2 and p3. | `js/games/custom/ui.js:208` (`onLock` checks only `diceLocked`, not `revealDice`); `js/ui/components/DiceCup.js:198-202` (sound before `onLock`), `:299` (hidden only when `!onLock`); engine `game.js:562` | `onLock: v.me.diceLocked \|\| v.revealDice ? undefined : onLockDice`. Keep the pre-roll greyed state as it is. Add a UI test: after `reveal-dice`, the lock button is hidden | `js/games/custom/ui.js`, `tests/custom.test.mjs` |
| 2 | minor | first-time UX | The banner says 「輪到你睇牌 👇 㩒住張牌」, but the first big gold cover under it is the dice cup; the role card starts at the bottom edge | p3-001: banner, then 骰盅 with a full-width gold striped cover (「㩒住掀起」), then 我嘅角色牌 at about 600 of 844 CSS px. Both covers share the same striped back (`.c-cover-back`); only the art (cup or card) differs. A newcomer can hold the cup first and see an empty 「–」 / 未搖過. It does no harm, but the banner's 張牌 points at the wrong thing. Keep the order: the spec puts the cup above the card on purpose, as the user asked. p3 rated this medium; it is downgraded because the cup art and its label are distinct. | `js/games/custom/ui.js:251` (banner text), `:152` (order: cup, showdown, card); `css/base.css:280-288` (shared back) | Banner while unseen: 「輪到你睇牌 👇 㩒住下面張角色牌」. Mark the due card: `roleCard.classList.toggle('cu-due', !!me.playing && !me.seenRole && !v.revealRoles)` with an accent outline or pulse. Optional: on a new deal, scroll that card into view once. Update spec §3 banner table | `js/games/custom/ui.js`, `style.css`, `docs/games/custom.md` |
| 3 | polish | ux | Custom's armed host buttons have no armed style, so the 3 s arm and its silent expiry show only as a text swap | `confirmTap` adds `.armed` to the tapped node (`dom.js:211`). `base.css:232` styles `.armed` only on `.btn`, `.icon-btn` and `.c-seateditor-btn`. The host buttons here are `.cu-btn`, which has no `.armed` rule. 9upper, draw-guess and fake-artist each added their own. So 「再㩒一次：…」 looks like an ordinary label, and when it reverts after `ARM_MS` nothing marks the change. The 3 s window itself is spec (§3: "within about 3 s"). p1 missed it because the console took seconds between calls, not because the window is short (see Rejected). | `js/games/custom/style.css:50-73` (no `.cu-btn.armed`); `css/base.css:232-236` | `.cu-btn.armed { background: rgba(228,87,61,.18); border-color: var(--danger); color: #ffb3a3; animation: armPulse 1s ease-in-out infinite; }`. Optional, shell-wide: a thin bar on `.armed::after` that shrinks over `ARM_MS`, so the expiry is visible | `js/games/custom/style.css` (optionally `css/base.css`) |
| 4 | polish | wording | Results: the recap is titled 「點解會咁」, and 今晚戰績 shows 贏 = 0 for everyone in a game that keeps no score | p3-005: hero 「邊個贏由你哋講」, then a card titled 「點解會咁」 (it reads like "why did this happen?"), then 局 1 / 贏 0 on every row. The group had just agreed that 小美 won. `result()` sets no `linesTitle`, so results.js falls back to its default heading. Scoreboard dropped the medals and, when nobody scored, the 分 column, but it always draws 贏. Reported by p1, p2 and p3. | `js/games/custom/game.js:872` (no `linesTitle`); `js/ui/screens/results.js:257` (default 「點解會咁」); `js/ui/components/Scoreboard.js:44-50` (贏 column always drawn) | `game.js` `result()`: `linesTitle: '今局嘅牌同骰'`. `Scoreboard`: hide the 贏 column (or show 「–」) when no history row tonight was judged (every row `noScore` or `void`). Keep 局 | `js/games/custom/game.js`, `js/ui/components/Scoreboard.js` |
| 5 | polish | consistency | After 開晒角色 the player's own card is still hold-to-peek | The roster already shows every role, and the card hint says 「大家嘅角色都公開咗」. The card still sits under the 🎴 「㩒住睇」 cover, which hides nothing. Spec §3 item 3 removes the lock button after the reveal ("nothing left to hide") but says nothing about the cover. Reported by p1. | `js/games/custom/ui.js:211-217` (`cardProps` after `revealRoles` changes only the hint); `RoleCard` has no face-up mode | After `revealRoles`, show the card face-up: either a `faceUp` prop on `RoleCard` that pins the Cover open, or a static front in place of the RoleCard. Add one line to spec §3 | `js/games/custom/ui.js` (or `js/ui/components/RoleCard.js`), `docs/games/custom.md` |
| 6 | polish | wording | Host-seat wording: 「解鎖佢嘅骰盅」 on the host's own row, and 「已經開盅，要主持再搖」 shown to the host himself | (a) The per-row 🔓 label is the same on every row, including 阿聰（你）, where it reads "unlock HIS cup" (p1). (b) On the host's own cup the header says re-rolling needs 「主持」, but he is the 主持 (p1-005). Players missed (b); it was found in a screenshot. | `js/games/custom/ui.js:298` (static `aria-label` and `title`); `:383` (one text for everyone) | (a) Set the label per row in `syncRoster`: `s.id === api.me ? '解鎖我嘅骰盅' : `解鎖 ${name} 嘅骰盅``. (b) When `v.controller`: 「已經開盅 — 要再搖就㩒「全體搖骰」」 | `js/games/custom/ui.js` |
| 7 | polish | wording | The quick rules say 「㩒 🎲 擲骰」, but the button says 「🎲 搖我嘅骰」 | 擲骰 is fine Cantonese. But a quick-rules line that names a button should use the button's own words. Elsewhere 擲 and 搖 are mixed: 「搖部手機就擲骰」, 「搖部機擲骰（而家熄咗）」, and the 💡 「要擲骰就搖骰盅」. Reported by p1. | `js/games/custom/game.js:413` (quick rule 3); also `:450`, `:726`; `js/ui/components/DiceCup.js:254` | Quick rule: 「每人一個秘密骰盅：㩒「🎲 搖我嘅骰」或者搖部手機。」 Use 搖骰 throughout the custom text and the DiceCup notes | `js/games/custom/game.js`, `js/ui/components/DiceCup.js` |
| 8 | polish (carried, run-1 #10) | help | No suggested round or fair-vote line for 🎭 一個內鬼, so the spoken vote snowballs behind whoever votes first | The table again had to invent a format (阿明 at 00:30:30). The host then named his target before the count. The 內鬼 switched to that name (00:33:53), and the good side lost 2 to 1. p2 and 小美's own reasoning both show the order effect. Leaving voting to the table is by design (spec §1). A one-line suggestion behind 💡 is not a rule change. | `js/games/custom/game.js:51-60` (preset has no `howTo`), `:725-726` (hint), `:440-443` (預設牌組 section) | Give each preset a `howTo` line. Traitor: 「建議：輪流講一句，之後數三聲一齊指；指中內鬼好人贏。」 Show it in 📖 預設牌組 and as the 💡 line once everybody has looked. Never show it by default | `js/games/custom/game.js`, `docs/games/custom.md` |
| 9 | polish (carried, run-1 #11) | harness / docs | `docs/research/custom.md` still does not exist; the brief still points to it | All three players fell back to `docs/games/custom.md` and said so. | `docs/research/`; the workflow brief | Write a short `docs/research/custom.md` with a "## Verification" section (lock semantics, reveal finality, what is public, no score). Or have the brief name `docs/games/custom.md` for tool-type games | `docs/research/custom.md` or the playtest workflow script |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p1 (low) | The arm-then-confirm window (about 3 s) is too short | **The window matches the spec; the miss was console latency.** Spec §3 says "the second tap within about 3 s sends" (`dom.js:161` `ARM_MS = 3000`). p1's arm tap and confirm tap were separate CLI round-trips several seconds apart. Run back to back in one call, it worked every time. A person reading a 10-character prompt taps again well within 3 s. The visibility gap behind this report is real and is kept as #3 |
| p1, p2, p3 (low) | Die faces have no text or aria label, under the cup or in 開盅 | **AI artifact (console).** `dieFace` sets `role="img"` and `aria-label="N 點"` (`dom.js:118-119`). Under the cup, the label is present only while the cover is held open (`Cover.js:73-77`, run-1 #6 / #37). Live probe on p1: `dieFace(3,6)` → `["img","3 點"]`. The console's `see` and `hold` text walker prints text nodes only (`pt.mjs:164-176`) and never an `aria-label` on a non-control, so the number looked missing |
| p1, p2, p3 (low) | The 💡 sheet keeps the role text in the DOM behind the cover; a screen reader could read it | **AI artifact (console).** The console's `[overlay]` line uses `innerText` (`pt.mjs:129`). `innerText` includes the closed cover's front, which is only `opacity: .001` (`base.css:297`). The main text walker drops anything under 0.05 opacity (`pt.mjs:106`), which is why the main card "looked" different. The 💡 box and the main card use the same `Cover`. While closed, the front is `aria-hidden="true"` (`Cover.js:75`; live probe: `"true"`), inside a `role="button"` with its own label, and `user-select: none` (`base.css:266`). Assistive tech and copy-select get only 「㩒住睇你嘅角色」 |
| p1 (low) | The roster unlock button was COVERED | **AI artifact (scroll position).** At one scroll offset the sticky `.play-top` lay over that row, and a person scrolls. The label problem is kept as #6 |
| p1 (low) | In the lobby, the sticky 開始 ▶ bar covers 今局設定 / ⚙️ 改設定 | **App is right.** `.lobby-start` is sticky at the bottom and is the lobby's last child (`lobby.js:473`, `base.css:882-885`). At full scroll nothing is under it. The COVERED flag was at scroll 405/589, mid-page, where any sticky bar overlaps something. The console's own `tap` scrolls the target to the centre first (`pt.mjs:339`) |
| p1 (low) | ⏱ 計時 and ⏸ 暫停 in a game with no clock | **App is right.** Both are host-only (`play.js:598-604`). ⏱ is the shell's table timer (T1), and it suits a tool game: a 2-minute talk round, for example. ⏸ freezes every action (「暫停緊 — 先㩒「繼續」」, `play.js:133,152,165`), and a resumed host room starts paused. Neither is a game clock |
| p2 (low) | No secret, simultaneous vote or pointing tool | **App is right by design.** Spec §1: "The app does not know the game: the group decides what the roles mean, when to call a vote, who won." The fairness problem p2 saw is the missing suggested round, kept as #8 |
| p2 (low) | The 📖 rules sheet lists every preset's roles, not this deck's | **App is right.** `rules.roles` is the tool's static reference. It covers every preset plus the moderator, and its ids never clash with dealt ids (`game.js:405-433`). `RulesSheet.open` takes no view (`play.js:213-217`). The dealt deck with counts is the 🃏 本局牌組 fold on the play screen. Marking the roles in play would be a shell-wide RulesSheet feature, in the same family as spec §8 request #3, not a custom bug |
| p2 (low) | The 開盅 block pushes the role card down while someone may be holding it | **App is right.** Spec §3 item 2 puts 開盅 right under the cup (that was run-1 #7's fix). Only the host's reveal can trigger the shift, and a peek in progress survives it, because `Cover` captures the pointer (`Cover.js:98-104`), so the card does not close as it moves |
| p3 (info) | Never saw the 開晒角色 state; the phone jumped straight to results | **Not an app issue.** The host tapped 開晒角色 and then 結束遊戲 seconds apart (00:35:19). The results screen repeats every card and die |

## Harness notes

- **Use one visibility rule for overlay text.** `[overlay]` uses `innerText` (`pt.mjs:129`), so a closed cover inside a sheet "leaks" its front, while the main view hides it. That made all three players report a secrecy issue that does not exist, in both runs. Fix: build the overlay text with the same `styleVisible` text walker as the main view.
- **Show `role="img"` labels in `see` and `hold`.** Dice are drawn as pips with an `aria-label`. Printing `[img 3 點]` for a visible, labelled `role="img"` would stop the hold-plus-screenshot workaround and the repeated "no aria" reports. It would also show a real leak if a covered die ever kept its label.
- **Confirm in one call.** The arm-then-confirm pattern needs both taps inside 3 s. A `tap <seat> "<label>" --confirm` mode (tap, then tap 「再㩒一次」 at once) would keep AI hosts from missing it. Tell players that a confirm prompt expires.
- The brief still sends players to `docs/research/custom.md` (#9).

## Missed by players (found in code or screenshots)

- #6(b): 「已經開盅，要主持再搖」 is shown on the host's own cup (p1-005).
- #3: custom's `.cu-btn` has no `.armed` style, unlike every other game that arms its own buttons.
- #1: the refused lock still plays `sfx('lock')`, so it sounds as if it worked.
- **No secret leaks found.** The checks:
  - `publicSeat` adds `roleId` / `dice` only after a reveal.
  - The 💡 hint is built without roles (`game.js:707-727`).
  - Closed covers are `aria-hidden` and their dice unlabelled.
  - The log says only *that* someone rolled or locked (「阿聰 鎖定咗點數 🔒」, 「小美 搖咗骰 🎲」).

## Rights checklist (merged per role)

Every card holder has the same rights in this tool; the role changes only the card text. The host seat adds the controls.

**Every card holder (🙂 好人 p1 and p2, 🎭 內鬼 p3)**

| right | p1 好人 | p2 好人 | p3 內鬼 | note |
|---|---|---|---|---|
| Hold to peek own card; 已睇牌 flips on release | ✓ | ✓ | ✓ | banner points at the cup first (#2) |
| 🎲 搖我嘅骰, then hold the cup to read it | ✓ (3) | ✓ (6) | ✓ (1) | labelled `N 點` while open (console cannot show it) |
| 🔓 鎖定點數 before 開盅 | ✓ | not used | not used | 🔒骰 on the row; head badge 「🔒 鎖定咗點數」 |
| 🔓 鎖定點數 after 開盅 (should be gone) | — | seen | tapped, refused silently | #1 |
| Public status: 已睇牌 / 🎲 已搖 / 🔒骰, banner | ✓ | ✓ | ✓ | no values leak |
| 💡 hint (role behind a hold) and 📖 rules | ✓ | ✓ | ✓ | the leak reports are console artifacts |
| 🃏 本局牌組 and 📜 記錄 | ✓ | ✓ | ✓ | |
| See 開盅 when the host opens the dice | ✓ | ✓ | ✓ | banner 「👁 開咗盅 — 睇下面「開盅」」; list under the cup |
| See every role after 開晒角色 | ✓ | ✓ | (went straight to results) | own card still covered (#5) |
| Results: every card and die public | ✓ | ✓ | ✓ | 「邊個贏由你哋講」; 「點解會咁」 and 贏 0 (#4) |

**Host seat extras (p1)**

| right | p1 | note |
|---|---|---|
| Per-row 🔓 on a locked cup | seen on his own row | label 「解鎖佢嘅骰盅」 (#6) |
| 👁 開晒啲骰 (in-page confirm) | ✓ | needs both taps within 3 s; no armed colour (#3) |
| 🔓 開晒角色 (in-page confirm) | ✓ | |
| 🏁 結束遊戲 (in-page confirm) → results on every seat | ✓ | |
| 🎲 全體搖骰 / 🔓 解鎖骰盅 / 🃏 重新派牌 / ➡️ 下一回合 | not used | covered by unit tests (59/59) |
| ⏱ table timer / ⏸ pause | not used | host-only shell tools (rejected as noise) |
