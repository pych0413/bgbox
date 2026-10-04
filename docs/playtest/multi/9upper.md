# 瞎掰王 9upper (`9upper`): multi-agent playtest review

Session `mp-9upper`, room 2453, 2026-10-03 17:53–18:41 UTC. Four AI players each drove one headless phone window (390×844) against the deployed build `https://pych0413.github.io/bgbox/` (build `20261003171423`). Once the `?v=` stamps and line endings are normalised, that build's `js/games/9upper/{game,ui}.js`, `js/core/{room,session}.js` and `js/ui/screens/play.js` match local `a72d23e` byte for byte, so every line number below refers to the local repo.

Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊. Settings: 4 players, preset **官方玩法**, so `laps` resolves to 3 and the game has **12 rounds**. The orchestrator also sent `laps: 1`, but the preset overrides it (see Rejected). Other settings: `levelMode` mix, `readSecs` 9, `passPhone` off, `speakOrder` **系統派 (system)**, `speakSecs` 0, 1 收皮啦 per round, no `scoreFloor`, no `rePeek`, no `antiStreak`, all categories, narration **靜音 (silent)**.

Sources checked:
- Rules and flow: `docs/research/9upper.md` (its "## Verification" section takes precedence) and `docs/games/9upper.md`.
- Code: `js/games/9upper/{game,ui,script}.js` and `style.css`, `js/data/9upper-terms.js`, `js/core/{room,session,engine-kit}.js`, `js/ui/screens/{play,lobby}.js`, `js/ui/components/{Cover,Timer,NarratorBar}.js`, `js/ui/dom.js`.
- Evidence: the engine state on the host (`__app._room.session.state`, including `history`), `room.lastResult` (null) and `room.history` (empty), the table chat log (`pt hear`), all 19 screenshots, and a live `see` of all four seats after play stopped.

`node tests/run.mjs 9upper` gave 79 passed and 0 failed.

## Verdict

**The game did not finish: 3 of 12 rounds were completed.** The cause is the AI seats, not an app crash. 阿明 stopped acting in round 3. 大熊 never pressed 開始睇卡 when he became 諗樣 in round 4. 小美 went quiet after 18:20:24 UTC. Because the 官方玩法 preset gives 12 rounds at four players, even a table that kept going would have needed about 1.5–2.5 hours at AI speed. For a "one game per title" run, use the 快玩 preset (4 rounds).

**Rules and scoring were correct in every completed round.** Each round's deltas match the research algorithm: D by level, the honest player and the 諗樣 both scoring on a correct pick, only the picked 9upper scoring on a wrong pick, and the 收皮啦 settled as +1/−1. The Thinker rotated one seat per round. The 系統派 order was a fresh permutation every round and never included the 諗樣. Only the honest player's phone ever showed the explanation, and the 諗樣 got a decoy card of the same shape.

**No blocker was found.** The one blocker a player reported (p2: "the 諗樣's score did not update") was a misreading. 阿明 had picked 阿聰, who was a 9upper.

**One major issue is confirmed.** If a 諗樣 stops responding while their phone stays connected, the 揀人 step has no way out: 下一步 does nothing, 代佢做 is only offered for disconnected seats, and 9upper ignores 🗑️ 呢輪作廢. This table nearly reached that dead end in round 4.

**Two problems nobody reported were found in the code.** (1) On the honest player's card there is a paragraph to read, while everyone else's card has one short line. A glance shows which card is which, and the honest player is the one still reading after the others look up. (2) An honest player who misses the silent 9-second window is still told 「你睇過真正解釋喇」.

**Not exercised live:** 諗樣揀 order with `call`, an early 我決定咗, a 收皮啦 on the honest player (−3), 2 callouts, `levelMode` judge, `passPhone`, `rePeek`, `scoreFloor`, and the end screen. The unit tests cover all of these (`UI renders every phase…`, the golden vectors, the fuzzers).

## Did it finish?

No. `room.phase = 'playing'`, `lastResult = null`, `room.history = []`. The engine sits in `explain` in round 4/12, with 阿明 marked spoken (he was skipped by the host) and 小美 on the floor.

| R | 諗樣 | term (D) | swaps | order (系統派) | 老實人 | pick | 收皮啦 | deltas |
|---|---|---|---|---|---|---|---|---|
| 1 | 阿聰 | 深水埗 (1) | 2 (水下曲棍球, 啦啦隊效應) | 阿明, 小美, 大熊 | 小美 | 小美 ✅ | 大熊 (9upper) | 阿聰 +2, 小美 +1, 大熊 −1 |
| 2 | 阿明 | 擲血腸比賽 (2) | 0 | 大熊, 阿聰, 小美 | 小美 | 阿聰 ❌ | none | 阿聰 +2 |
| 3 | 小美 | 香埗頭 (2) | 0 | 大熊, 阿明, 阿聰 | 阿明 | 阿聰 ❌ | 大熊 (9upper) | 阿聰 +2, 小美 +1, 大熊 −1 |
| 4 | 大熊 | 耀變體 (3) | 0 | 阿明, 小美, 阿聰 | 阿明 | none | none | stalled: 大熊 idle about 7 min in `term`, host 下一步 at about 18:22; 阿明 silent, host skipped him at about 18:36; 小美 idle |

Scores at the stall: 阿聰 9, 小美 5, 阿明 3, 大熊 1 (everyone started on 3). Every delta above matches `docs/research/9upper.md` "Voting & resolution".

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | major | flow | A 諗樣 who stops responding while still connected blocks 揀人 for good, and 呢輪作廢 is unsupported | The host has three tools and none works in the `judge` step: (a) ⏭ 下一步 does nothing there, and no message says so. (b) 🤖 代佢做 and the stall banner only appear for **disconnected** seats, and an idle phone that is still open counts as 🟢 喺度. (c) 🗑️ 呢輪作廢 sends `@void-round`, which 9upper ignores, so the host sees 「呢個遊戲唔支援」. Five other games support it. In round 4 the 諗樣 大熊 was idle on a connected phone. The host could push `term` on and skip the silent speakers, but once the last speaker was skipped the round would have reached `judge` with no exit. The research edge cases ("honest disconnects → void the round, same Thinker"; "Thinker disconnects → void and hand on the seat") are not implemented. Reported in part by p1 and p3, who described it as "no timeout". | `js/games/9upper/game.js:612-627` (`skipStep`: `default: break` for `judge` at :624); `:629-641` (`hostAct` handles only `CUE_DONE` and `NEXT`, with no `ACT.VOID_ROUND`); `js/core/room.js:1427` (`if (p.connected) continue;`, so a connected seat is never "waited on"); `js/ui/screens/play.js:338` (下一步 closes the menu with no feedback) | (1) 9upper: handle `@void-round`. Discard the round with no score, then redeal the term, the roles and the order. Keep the same 諗樣, or move the seat on if the 諗樣 is the stuck one, and adjust `judges` so nobody loses a turn in the lap. (2) Shell: after `stallMs`, list a seat the engine is blocking on under 「無反應」 even when it is connected, with 代佢做 (whose auto-pick is random) and 呢輪作廢 next to it. (3) When 下一步 changes nothing, show a toast such as 「呢步要 X 自己做 — 可以代佢做或者呢輪作廢」. | `js/games/9upper/game.js`, `js/core/room.js`, `js/ui/screens/play.js` |
| 2 | minor | tell | Only the 老實人's card has a paragraph to read; everyone else's card has one short line | In the 9 s window the honest card shows the real explanation: the bank median is 36 characters and the longest is 67, which is 2–4 lines, and anything over 52 characters switches to a smaller font class. The 9upper card shows 「作一個解釋，要講得似真㗎！」 (13 characters) and the 諗樣 card shows 「你唔會見到解釋，靜靜哋睇住大家。」 (16). This gives away the role in two ways. (1) A glance at a neighbour's open card shows either a block of text or a single line. (2) A 9upper or the 諗樣 reads their line in a second and looks up, so the honest player is the one still reading heads-down at 0:05. Nothing tells the others to keep their eyes on the phone until 0:00. The research app notes ask for "a scrambled or blurred text block of the same length" on every other phone, shown for the same time. p4 noticed that the texts differ, but nobody named the timing tell. | `js/games/9upper/ui.js:153-165` (`faceFor`); `:143` (the `long` class can only apply to the honest text); `js/games/9upper/style.css:63`; `ui.js:371-377` (read notes) | Give the 9upper and 諗樣 cards a decoy block about as long as a typical explanation. For the 9upper this can be useful prompts built from the public term and hint (「諗定：一個地方、一個年份、一個人名…」). For the 諗樣, use a fixed paragraph of question ideas. Clamp all three cards to the same line count and use one font size, then drop the `long` switch. Add 「倒數完之前一直望住電話」 to every seat's read note. | `js/games/9upper/ui.js`, `js/games/9upper/script.js`, `js/games/9upper/style.css` |
| 3 | minor | ux | A 老實人 who missed the 9 seconds is still told 「你睇過真正解釋喇」, and the window opens with no sound | Round 3: the honest player 阿明 never held his card during the window (his report says no explanation was ever shown). His reminder card then said 「你睇過真正解釋喇，用自己嘅講法講。」. The miss itself came from AI latency, but a human can lose most of the window too. With narration on 靜音, nothing sounds on a player's phone when the 諗樣 taps 開始睇卡: the `deal` sound plays only on the 諗樣's phone, and the Timer's first beep comes at 5 s left. Someone looking at the table can lose about 4 of the 9 seconds, and with `rePeek` off the card then lies to them. | `js/games/9upper/ui.js:157-162` (post-window honest text assumes the card was read); `:340-381` (`readBody`: no sound at window start, Cover `onOpen` unused); `:308` (`deal` on the 諗樣's phone only) | Play one identical sound (`flip`/`deal`) on every phone when `read` begins. Track on each phone, through Cover `onOpen`, whether the seat opened its card during the window. If the honest player never did, their reminder says 「你冇打開到張卡：當張卡乜都冇寫，答「張卡冇寫」。」, in the same three-line shape, private to that phone. | `js/games/9upper/ui.js` |
| 4 | minor | ux | A skipped speaker is shown as ✅ 已講 and can never get the floor back | Round 3: 小美 skipped the silent 阿明 with 下一位, and the list showed 「2. 阿明 ✅ 已講」. 阿明 was the honest player, and 小美 then picked wrong. Round 4: the host's 下一步 skipped 阿明 and the list showed 「1. 阿明 ✅ 已講」 (shot p1-006). The 諗樣 cannot tell who actually explained. In 系統派 `call` is refused, and in 諗樣揀 `call` refuses anyone already in `spoken`, so a skipped player can never be called back. Reported by p1 and p3. | `js/games/9upper/game.js:450-459` (`endTurn` marks the speaker spoken however the turn ended); `:688-691` (`call` refuses spoken targets); `js/games/9upper/ui.js:461,471` (✅ 已講 for every spoken id) | Keep `round.skipped`: a turn ended by the 諗樣's 下一位, the host's 下一步 or the deadline (not the speaker's own 我講完) is a skip. Show it as ⏭ 跳過咗. In 系統派, re-queue skipped players after the others. In 諗樣揀, keep them callable. Add `skipped` to `view.turn`. | `js/games/9upper/game.js`, `js/games/9upper/ui.js` |
| 5 | minor | ux | The 收皮啦 confirm hides the target's name, and its chips are in a different order from the pick list | On the 諗樣's 揀人 screen, the picker lists 阿聰 / 阿明 / 大熊 (seat order). Directly below, the 收皮啦 chips list 大熊 / 阿明 / 阿聰 (this round's speaking order) in a very similar style (shot p3-005). An armed chip reads only 「確定？再㩒一下」. p3 armed the wrong player (阿聰) and was saved only by the second tap. A wrong 收皮啦 costs 3 points. | `js/games/9upper/ui.js:241` (chips from `v.explainers`), `:249` (armed label has no name), `:508` (picker from `api.players`) | Use seat order in both lists. Make the armed label 「確定收皮 大熊？」. Set the callout row apart visually (🛑 red outline) from the picker. | `js/games/9upper/ui.js`, `js/games/9upper/style.css` |
| 6 | minor | text | The source shows as a raw, percent-encoded URL | All 782 bank entries have a URL as `src`, and 242 of them are percent-encoded. For example 深水埗 shows as `https://zh.wikipedia.org/wiki/%E6%B7%B1%E6%B0%B4%E5%9F%97`, two lines of noise on the reveal (shot p1-004). The same applies to every round block on the end screen. Reported by p1 and p3. | `js/games/9upper/ui.js:561`; `js/games/9upper/script.js:226` | Add a `srcLabel(src)` helper in `script.js`. A Wikipedia URL becomes 「維基百科：深水埗」 or 「Wikipedia：Blazar」 (`decodeURIComponent` of the last path segment, `_` → space). Anything else becomes its hostname. Render it as a link on the reveal. | `js/games/9upper/script.js`, `js/games/9upper/ui.js` |
| 7 | polish | rules | The reveal names the 老實人 but not the 9uppers | The rulebook turns every role card face up at the reveal. The app names the honest player, the pick and the 收皮啦 target. With exactly one honest player every other role can be worked out, but in round 1 nobody saw 阿明's role written down. Reported by p1 and p3. | `js/games/9upper/script.js:166-183` (`revealLines`) | Add a line 「🤥 9upper：阿明、大熊」 (every 玩家 except the honest player). | `js/games/9upper/script.js` |
| 8 | polish | ux | 換題 changes the term on everyone's phone without any notice | When the 諗樣 swaps, the other phones simply show a new term. The only notice is the narration cue 「換咗題。」, which says nothing in 靜音. `swapsLeft` is already public in the view. Reported by p3. | `js/games/9upper/ui.js:92-105` (`paintTerm`); `js/games/9upper/script.js:40` | When `term.text` changes inside `term` in the same round, flash 「🔄 換咗題（仲有 N 次）」 on every phone. | `js/games/9upper/ui.js` |
| 9 | polish | text | The players' 揀人 waiting screen does not say that questions can continue | The other seats see only 「X 諗緊邊個係老實人…」. In round 1 the 諗樣 kept asking follow-up questions for about 3 minutes. The 諗樣's own screen says 「揀之前仲可以繼續問」, but the others' screens do not. Reported by p3. | `js/games/9upper/ui.js:519,528`; `js/games/9upper/script.js:122` | Add 「諗樣仲可以追問，大家都可以互相質疑。」 under the wait line. | `js/games/9upper/ui.js`, `js/games/9upper/script.js` |
| 10 | polish | ux | The header's 「輪到你」 sits on the 諗樣 while someone else is speaking | In `explain` the engine's focus is the 諗樣, so 大熊's header said 「輪到你」 while his body said 「🎤 輪到 小美」. 小美, who was actually speaking, had no pill (seen live on all four seats). Found in code. | `js/games/9upper/game.js:853-854` (`focus` → `[judge]` in `explain`); `js/ui/screens/play.js:484` | In `explain` without `passPhone`, return `{ pids: [speaker] }` when someone is on the floor. Keep `[judge]` for the one-phone PassGate. Alternatively add `engine.blocking()` and leave `focus` for the gate. | `js/games/9upper/game.js` |
| 11 | polish | ux | The host's inline 下一步 bar disappears in 靜音 | In 靜音 the narrator bar shows only while a cue is pending, and the session acknowledges a silent cue by itself after `minMs`. After that, skipping a stuck step means ⋯ → 下一步. p1 saw the bar "gone a minute later". This is a shell issue. | `js/ui/screens/play.js:438` (`wanted` false once the silent cue is acknowledged) | In 靜音, keep a one-line host strip with ⏭ 下一步 while the engine is waiting on one seat, or put ⏭ in the header next to ⏸. | `js/ui/screens/play.js`, `js/ui/components/NarratorBar.js` |
| 12 | polish | missing-right | Only the 諗樣 can start a 換題 | The rule is: "If anyone, including the Thinker, already knows the term, redraw." Players can only speak up. In round 2, 阿聰 said he knew 擲血腸比賽, the 諗樣 kept the term, and 阿聰 (a 9upper) told the real story and fooled the 諗樣 for +2. That is exactly the broken round the research warns about. A human 諗樣 would usually swap, so this is only polish. | `js/games/9upper/game.js:661-667` (swap is 諗樣-only); `js/games/9upper/ui.js:310-316` | Give every player a 「我識呢條」 button in `term`. Roles are not shown yet in `term`, so it gives nothing away. Pressing it marks the 諗樣's swap button 「阿聰話識」, or swaps straight away while swaps remain. | `js/games/9upper/game.js`, `js/games/9upper/ui.js` |
| 13 | polish | ux | The room code is shown only as dice pips | The lobby code is four d6 faces with no digits. To read it out, players have to count pips. Shell issue. Reported by p1. | `js/ui/screens/lobby.js:485`; `js/ui/dom.js:109-116` | Put a small digit under each die (and an `aria-label`). | `js/ui/screens/lobby.js`, `js/ui/dom.js` |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p2 (blocker) | The 諗樣's score did not update after a correct pick in round 2 | **Misread (app is right).** Engine `history[1]`: honest = 小美, pick = 阿聰 (a 9upper), `correct: false`, change 阿聰 +2. The screenshot cited (p2-002) is round 1's 揀人 step, with everyone still on 3. |
| p2 (minor) | In round 2, 小美 never had a speaking turn before the pick | **AI artifact (polling).** The chat log has 小美 speaking at 18:00:36, after 大熊 and 阿聰 and before the pick. p2 polled too rarely to see her 🎤 state. |
| p2 (minor) | The read step showed different text in round 1 and round 3 | **App is right.** p2 was the 諗樣 in round 2 and a player in round 3. The 諗樣 gets 「大家都喺度睇卡…」 and players get 「㩒住張卡睇…」 (`ui.js:371-377`). The 諗樣 is public, so this leaks nothing. |
| p2 (major) | The honest player was never shown the explanation | **AI artifact.** For the full 9 s window the text was on 阿明's phone behind 「㩒住睇卡」 (`game.js:746-751`, `ui.js:157-161`), and the agent did not hold the card in time. The real remainder (misleading text, silent start) is #3. |
| p2 (major) | Long unexplained delays; the game "eventually auto-advances" | **AI artifact.** Nothing auto-advances in `term`, which has no clock by design (flow doc §3.2). The waits were the 諗樣 agents taking a long time to tap. The genuine dead end is #1. |
| p2 (minor, tell) | An honest player who never read the card would be exposed | Merged into #3. |
| p4 (minor) | Hold-to-peek does not release when the timer runs out | **App is right.** At the deadline the host moves to `explain` (`game.js:738-740`), and the read body, card included, is torn down (`ui.js:632-637`). The "0:03" p4 saw was still inside the window. |
| p4 (minor) | The callout result was not clearly displayed | **App is right.** The reveal shows 「🛑 收皮啦 → 大熊：真係 9upper，大熊 −1、阿聰 +1」 (`script.js:174-178`, shot p1-004). |
| p4 (major) | Other players stopped responding | **AI artifact.** The seats quit (see notes). |
| p1 (major ×2), p3 (major) | No timeout or nudge for an idle 諗樣 in `term` or an idle speaker in `explain` | **Mostly AI artifact / app is right.** A per-speaker limit already exists (`speakSecs`, 0–300 s, off by default as the research asks for every timer). The host's 下一步 moves `term` on and skips one speaker in `explain`, which p1 used. At a real table a 諗樣 standing in front of a big 開始睇卡 button gets told 「㩒啦」 out loud. The one real dead end (an idle 諗樣 in `judge`, no void) is #1. |
| p1 (minor), p3 (minor) | The double-tap confirm (3 s) is too short | **AI artifact.** A thumb double-taps in under a second. The misses came from console round-trips longer than 3 s. The real part (no target name, different order) is #5. |
| p1 (polish) | The term bank leans well-known | **AI artifact.** A language model knows far more trivia than a typical table: 阿聰 "knew" 4 of the 7 terms drawn. 換題 exists for exactly this. |
| p1, p3 (checklists) | The 諗樣 cannot choose who speaks | **Configuration choice.** This run used `speakOrder: 'system'`. The rulebook mode 諗樣揀 (with `call`) is the default and is covered by tests. |
| p1 (minor) | The connection list shows idle seats as 🟢 喺度 | **App is right.** They were connected. The "idle" marker belongs in the fix for #1. |
| setup note | `laps: 1` was accepted but the lobby said 12 rounds | **App is right.** A named preset fixes `levelMode`, `laps` and `callouts` and hides those fields (`game.js:187-192`, flow doc §2). Use `preset: 'quick'` (or `'custom'` with `laps: 1`) for a 4-round game. |
| p1 (polish, tell) | Different note under the 諗樣's cover | Correct as built: the 諗樣 is public. No change needed. |

## AI-artifact notes (only an AI's speed or tooling would hit these)

- **Seats quit, and that is why the game stopped at 3/12.** 阿明's last act was in round 3 (his report says he gave up there). As honest player in round 3 he never spoke, and 小美 skipped him at 18:12. 大熊 never pressed 開始睇卡 as 諗樣 in round 4: the term sat from about 18:15 until p1's host 下一步 at about 18:22. 小美 last spoke at 18:20:24 UTC, and her report stops at 18:29. p1 gave up at 18:41.
- **The game was too long for this harness.** 官方玩法 at four players is 12 rounds. The AI pace was about 5 minutes for round 1 and about 11 minutes for round 3. Use preset **快玩** (4 rounds, each seat is 諗樣 once) when the user wants one game per title.
- **A 9 s window is shorter than a poll loop.** 阿明 missed his only honest read because the agent never held the card in time. Human players do not have this lag, but the misleading text after the window (#3) is still real.
- **The 3 s double-tap needs both taps in one command** for the console (換題, 收皮啦).
- **Encyclopaedic knowledge.** The AIs "knew" 水下曲棍球, 啦啦隊效應, 擲血腸比賽 and 耀變體. In round 2 a 9upper who said he knew the term was not swapped out. That reflects how an AI 諗樣 behaves, and the polish item #12 is the only app change.

## Rights checklists, merged per role

**🧠 諗樣 (Thinker)**: p1 阿聰 (R1), p2 阿明 (R2), p3 小美 (R3), p4 大熊 (R4, idle)

| right (verified rules) | result | evidence |
|---|---|---|
| Identity public; takes the callout card | ✓ | 「X 做諗樣」 subtitle, 🧠 on the score chip, 「🛑 收皮啦 · 剩 1 張」 |
| See the public term and hints; level and points shown | ✓ | All seats. Level 2 shows 「三揀一，得一個啱」 |
| Redraw a known term before the peek (same roles, no score) | ✓ (諗樣 only, at most 3) | p1 swapped twice in R1 and the counter went 3→2→1. Other players cannot trigger a swap (#12) |
| Never sees the explanation; keeps head down with everyone | ✓ | Decoy cover 「你係諗樣 🧠 你唔會見到解釋」 with the same 0:09 countdown. Its text is much shorter than the honest card's (#2) |
| Choose who speaks and in what order | replaced by config | `speakOrder` 系統派 in this run: random order, 下一位 only. 諗樣揀 with `call` not exercised live (covered by tests) |
| Ask anything about the term, never about roles | ✓ | Spoken aloud; the rule is on the 輪流解釋 and 揀人 screens |
| One 收皮啦 per round, on a non-諗樣, public at once, role hidden until reveal | ✓ | p1 R1 and p3 R3, both on 大熊. Banner 「🛑 X 對 大熊 出咗收皮啦！」. The confirm label has no name (#5) |
| Accuse at any time, even before everyone has spoken | ✓ present, not used | 「我決定咗，要揀人」 from the first speaker on |
| Name exactly one other player, not self, cannot undo | ✓ | Picker without self, 「就係佢！」, 「揀咗就改唔到」 |
| Scoring (+D on a correct pick, +1/−1 callout, −3 on honest) | ✓ (−3 not exercised) | R1 阿聰 +2, R3 小美 +1 |
| See who has really spoken | ✗ (#4) | Skipped players show as ✅ 已講 |

**🙋 老實人 (honest player)**: p3 小美 (R1, R2), p2 阿明 (R3; R4 idle)

| right (verified rules) | result | evidence |
|---|---|---|
| The only phone that ever receives the explanation, during the window only | ✓ | p3 read 深水埗 and 擲血腸比賽. Leak tests pass (`game.js:746-751,807`) |
| Same card shape and timing as everyone else | partly (#2) | Same cover and countdown, but a much denser text block that takes longer to read |
| One 9 s look, no re-read (unless `rePeek`) | ✓ | 「㩒住睇返我係咩」 shows the role and 「張卡冇寫」 tip only |
| A clear start to the window, and an honest message if it was missed | ✗ (#3) | No sound on 玩家 phones in 靜音. 阿明 missed it and was told 「你睇過真正解釋喇」 |
| May say the card does not say | ✓ | Text on the card. 小美 used it in R1 (「呢個我唔知喎」) |
| Scores D with the 諗樣 when picked | ✓ | R1 小美 +1. R2 wrong pick, 0 |
| Force a redraw if they already know the term | ✗ (#12) | Can only say so aloud |

**🤥 9upper (bluffer)**: p1 阿聰 (R2, R3, R4), p4 大熊 (R1, R2, R3), p2 阿明 (R1), p3 小美 (R4)

| right (verified rules) | result | evidence |
|---|---|---|
| Sees no explanation, only the public term and hints | ✓ | 「你係 9upper 🤥 你睇唔到真正解釋」 |
| Does not know the other roles | ✓ | Views carry only `mine.honest` for oneself |
| Explain in turn, cross-examine others | ✓ (R1–R3), blocked in R4 | Chat log |
| +D when the 諗樣 picks you wrongly | ✓ | 阿聰 +2 in R2 and R3 |
| −1 when hit by a 收皮啦, keeps talking (no mute) | ✓ | 大熊 −1 in R1 and R3 |
| Re-check own role during talking | ✓ | Hold-to-peek 「㩒住睇返我係咩」 |
| Cannot tell the honest player from screen layout | partly (#2) | The honest player reads longer, and their text block is visibly bigger |

**👑 房主 (host, also a player)**: p1 阿聰

| right / duty | result | evidence |
|---|---|---|
| ⏸ pause | ✓ present (header), not used | Shot p1-006 |
| ⏭ 下一步 (skip the current step) | ✓ in `term` and `explain`. ✗ in `judge` (#1) | R4: term → read at about 18:22; skipped 阿明 at about 18:36 |
| 🗑️ 呢輪作廢 | ✗ unsupported by 9upper (#1) | `hostAct` ignores `@void-round` |
| 🤖 代佢做 for a stuck seat | ✗ for connected idle seats (#1) | Only disconnected seats are flagged |
| Connection list | ✓ shows connected / disconnected, not idle | 「阿明 🟢 喺度 小美 🟢 喺度 大熊 🟢 喺度」 |
| Inline 下一步 strip | partly (#11) | Hidden in 靜音 once the cue is acknowledged |
| No secret shown to the host | ✓ on screen | The host's own views carry only its own card. The accepted host-can-peek trade-off (engine state in memory) is unchanged |
