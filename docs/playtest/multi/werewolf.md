# 狼人殺 (`werewolf`): multi-agent playtest review

Session `mp-werewolf`, room 5412, 2026-10-04 19:02 to about 19:21 UTC. Six AI players each drove one headless phone window (390×844). Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強, p6 阿珍. The build was served from `https://pych0413.github.io/bgbox/`. After normalising the `?v=` stamps, its `js/games/werewolf/{game,ui,script}.js`, `js/ui/screens/play.js`, `css/base.css` and `js/core/session.js` are byte-identical to local `a72d23e`.

Settings: 6 players, board `auto` (the 6-player 預女 board: 2 狼人, 預言家, 女巫, 2 平民), 屠城, witch self-save on night 1 only, `wolfVote` plurality, official night order, pace **slow** (set by the orchestrator; wolves 50 s, witch 30 s, seer 25 s), `speakSecs` 60, `wordsSecs` 45, `voteSecs` 20, no hunter, so no 最後行動 window. Narration was **靜音 (silent)**.

Sources:
- Rules: `docs/research/werewolf.md`. Its "## Verification" section takes precedence.
- Flow: `docs/games/werewolf.md`.
- Code: `js/games/werewolf/{game,ui,script}.js`, `js/ui/screens/{play,lobby,results}.js`, `js/ui/shell.js`, `js/ui/components/Scoreboard.js`, `js/core/session.js`, `css/base.css`.
- Evidence: `room.lastResult`, `room.history`, the table chat (`pt hear`), and screenshots p1-001 … p6-011 in `%TEMP%\bgbox-playtest-shots\mp-werewolf\`.

`node tests/run.mjs werewolf`: 131 passed, 0 failed.

## Verdict

**The game finished, and the rules engine was correct on the path that was played.** The game had a PK on day 1, a 1-vs-1 tie with nobody left to vote, and a final night where the wolf kill and the poison landed together. Wolves won under 屠城 + 狼刀優先. The research says exactly this: "if the wolf kill actually lands on the last god or last villager … wolves win even if the last wolf is poisoned the same night". Speaking order, PK voters, last-words eligibility, the seer's no-repeat rule and the witch's information rule all matched the verified rules.

**No blocker.** The one blocker reported, p4's "game hung on night 4", is an AI artifact. The room is in `results`, `lastResult` holds the wolves' win, and `history` has one entry.

**Three majors are confirmed. All three are about what a person at the table can see, not about rules:**
1. **Your role is readable at a glance on every day screen.** Your own seat chip carries your role emoji (🐺 / 🧪 / 🧑). The 「我嘅身份」 box is open by default. It prints the wolf's 「🐺 隊友：4號大熊」, the witch's potions and who she saved, and the seer's checks in plain text, outside the hold-to-peek cover. Reported by p1, p3 and p6. p2 listed the seer's version as a good thing.
2. **At night, only the awake role's phone lights up.** The shell lifts the 95 % night dim for the seats that `focus` names. In werewolf, `focus` is the holders of the role being called. Reported by p3 and p6, and suspected by p1. The shell code behind this is the same as onuw #1.
3. **The dawn result is on screen for about 3 seconds and is never repeated.** In 靜音 mode the dawn card is the only place that says 平安夜 or who died. p3, p4 and p6 never saw it. The speech screen that follows says nothing about the night.

The players missed or under-weighted three things:
- The witch's confirm button never says whether her pick is the antidote or the poison. Labels for this exist in `script.js` but nothing uses them.
- The 票型 tally screen is capped at 7 s, and the app has no way to look at earlier tallies.
- The results screen does not explain why the wolves won although both wolves are dead.

**Not exercised live:** hunter, guard, idiot, self-explode (offered, not pressed), 自刀 and 空刀 (both controls enabled, not used), the witch's self-save, a multi-death dawn, 明牌, the human-moderator mode and voice narration. The unit tests cover them (131 tests: night truth table, explode, idiot, hunter chains, leaks and fuzz).

## Did it finish?

Yes. `room.phase = 'results'`. `lastResult.summary = 「狼人隊贏：好人全部出局（屠城）」`, winners `p4, p6`, `points {}`. `history` has one entry.

| fact | value |
|---|---|
| deal | 1 阿聰 平民 · 2 阿明 預言家 · 3 小美 女巫 · 4 大熊 狼人 · 5 阿強 平民 · 6 阿珍 狼人 |
| night 1 | wolves 大熊→阿明, 阿珍→阿明 ⇒ 阿明 (一致) · witch saved 阿明 · seer 阿明 checked 小美 ✅ · 平安夜 |
| day 1 | order 1,6,5,4,3,2 (random start, descending) · vote 阿強 2 (阿聰, 小美), 大熊 2 (阿明, 阿強), 阿聰 1 (阿珍), 棄權 大熊 → PK · PK 阿強 3 (阿聰, 小美, 阿珍), 大熊 1 (阿明) → 阿強 exiled (平民), 遺言 45 s |
| night 2 | 大熊 冇揀, 阿珍→阿明 ⇒ 阿明 killed (其他狼人冇揀) · witch no potion · seer checked 阿聰 ✅ |
| day 2 | order 3,4,6,1 (next to the dead seat 2, ascending) · 阿珍 2 (阿聰, 小美), 阿聰 1 (大熊), 小美 1 (阿珍) → 阿珍 exiled (狼人), 遺言 45 s |
| night 3 | 大熊→阿聰 ⇒ 阿聰 killed · witch no potion · seer step run as a decoy (seer dead) · no 遺言 (night 2+) |
| day 3 | order 4,3 · 大熊 1 (小美), 小美 1 (大熊) → nobody left to vote → 平安日 |
| night 4 | 大熊→小美 · witch poisoned 大熊 ⇒ 小美 (wolf) and 大熊 (poison) both die → 屠城 and 狼刀優先 → wolves win |
| timeline (UTC) | ready 19:02:27–19:02:41 · first day-1 speech 19:05:37 · 阿強's 遺言 19:10:22 · day 2 talk 19:12:57–19:14:57 · day 3 talk 19:17:13–19:17:55 · over ≈19:21 |

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | major | tell | Your role, wolf mates, potions and seer checks are on screen without the cover | On every day screen (dawn, speeches, vote, tally, 遺言, and the dead view), two things show secrets without a peek. (a) The 座位 strip draws your role emoji on your own chip: 「6 阿珍 🐺」, 「3 小美 🧪」, 「1 阿聰 🧑」. It stays there after death. (b) The 「我嘅身份」 `<details>` box is open by default. Its hold-to-peek RoleCard is covered, but the lines under it are not: 「🐺 隊友：4號大熊」, 「🧪 解藥冇・毒藥有」, 「第 1 夜用解藥救咗 2號阿明」, 「第 1 夜驗 3號小美：✅ 好人」. A phone lies face-up on the table all day, so one glance from a neighbour reveals a role. The research lists these as things that must stay private: "Each player's role; wolf teammates …; the witch's potion status and what she was shown; the seer's results". The engine sends this data only to its owner, which is right. The UI then draws it in the open. Shots p6-004, p3-005, p1-004. | `js/games/werewolf/ui.js:143` (`role ? el('small', { text: role.emoji })` for your own seat); `js/games/werewolf/game.js:1332` (`pid === seat` puts your own role in `seats`); `js/games/werewolf/ui.js:151` (`details … open: true`), `:180-196` (mates, potions and notes drawn as plain `<p>`) | (a) Drop `pid === seat` from `rosterOf`, because `my.role` already carries it. The roster then shows a role only when it is public (明牌 dead, `spectate`, `over`). Mark your own chip with the existing `is-me` ring only. (b) Move the mates, potion and notes lines onto the hidden face of the RoleCard. If the Cover takes extra content, show them only while held. Otherwise put them in a second hold-to-peek 「📓 我嘅記錄」 cover. Start the `<details>` closed. Update the "Leaks" tests so that no own-role glyph and no note text appear outside a Cover. | `js/games/werewolf/{ui.js,game.js}`, `tests/werewolf.test.mjs`, `docs/games/werewolf.md` §5 Views |
| 2 | major | tell | At night only the awake role's phone is bright; every other phone is 95 % black | `play.js` dims a seat at night unless `focus` names it. Werewolf's night `focus` is "every holder of the called role", so on the wolf step the wolves' phones fade up to full brightness while the other four sit under `rgba(2,2,4,.95)`. The witch and seer steps work the same way. p6 measured 13–32 % (still fading out) on its own wolf step against 95 % on every decoy step. p3's witch panel is fully lit (p3-004). Two smaller tells sit on top. A wolf who confirms drops out of `focus` (`pids.filter(… !lock)`), so his phone dims again mid-step while an undecided mate's stays lit. And decoys at 95 % can hardly read their decoy panel, so the "everyone taps" tap-noise cover does not happen. The research says: "Do not vibrate, ping or light up differently by role. Use dim night mode". The flow doc §7 promises "no lit screen that depends on a role". Its §8.5 note describes the opposite. In 靜音 mode the lit screen is currently the only wake signal, so the fix must give every phone the same signal. | `js/ui/screens/play.js:539-540` (`night(… && !inFocus)`); `js/games/werewolf/game.js:1188-1197` (`focus` names the role holders, and wolves drop out on lock); `css/base.css:1177-1183` (`.night-dim` 95 %) | Same shell fix as onuw #1. Add an opt-in meta flag such as `meta.nightDim: 'uniform'`. When it is set and `focus.anonymous` is present on a single-seat device, keep every seat under the same partial dim for the whole night, actors included. Pick a level where text stays readable (about 70 %) and do not fade at window edges. Keep `focus` for the shared-phone pass-gate only. Then every phone shows a readable panel at every step, which is what the decoy design already assumes. Fix §8.5 of the flow doc. | `js/ui/screens/play.js`, `js/ui/shell.js`, `css/base.css`, `js/games/werewolf/game.js` (`meta`, line 83), `docs/games/werewolf.md` §7/§8 |
| 3 | major | flow | The dawn result (平安夜 / who died) flashes for about 3 s and is not repeated | The dawn is an announce-only step. In 靜音 mode the session completes the cue after `cue.minMs`, which is `cueMinMs(text) = max(1800, min(7000, len×160))`. For 「天光喇，請大家開眼。昨晚係平安夜，冇人死。」 that is about 3.4 s. Then the first speech starts. The speech screen's stage line only gives the order (「而家開始發言，按座位號由大到細，由阿聰開始。每人 60 秒。」). The night's result survives only as a 💀 on a roster chip. Players put their phones face-down at night and pick them up at dawn, so a slow human misses it too. p3, p4 and p6 never saw the dawn card on days 1 and 2, and p6 saw it only on days 3 and 4. The research marks the step PUBLIC: "App states who died … or announces a peaceful night (平安夜)". | `js/games/werewolf/script.js:528-530` (`cueMinMs` gives every cue 1.8–7 s); `js/games/werewolf/game.js:942` (dawn queued as a bare announcement), `:1166-1179` (`cue`); `js/games/werewolf/ui.js:423-456` (`speakBody` has no night-result line); `js/core/session.js:312` (silent mode acks after `minMs`) | (a) Give the dawn cue its own floor (for example `minMs ≥ 8000`). (b) Add a public `v.lastNight = { n, deaths: [pid] }` to day views. Show one line 「🌅 昨晚：平安夜」 / 「🌅 昨晚出局：2號阿明」 in the stage card, or above the speaker list, until the vote starts. Seat order, no cause. | `js/games/werewolf/{game.js,ui.js,script.js}` |
| 4 | minor | ux | The witch's pick never says "antidote" or "poison" | The witch chooses by which chip she taps: the 💊 victim means save, anyone else means poison. After a tap the chip only gets a faint tint, and the button still reads 「確定」, then 「已確定 ✓」. Nothing confirms which potion she is spending, before or after. A tentative pick is spent at the window's end even without 確定 (flow §3.2), so a stray tap on a neighbour poisons them and cannot be undone. The labels 「💊 救」 and 「☠️ 毒」 already exist and nothing uses them. Once the antidote is gone, the hint 「㩒被襲擊嗰位＝用解藥救佢」 still shows although there is no victim to tap. A tap during the 3 s 「女巫請開眼」 cue is dropped and nothing on screen says why (p3's night-4 first tap). When the window lapses, nothing tells her 「今晚冇用藥」. Reported by p3: "I could not tell on screen whether I had chosen antidote or poison." | `js/games/werewolf/game.js:744` (one hint for every potion state), `:733-746` (`P.ok` stays 「確定」); `js/games/werewolf/script.js:569-571` (`save`/`poison` labels unused); `js/games/werewolf/ui.js:330-339` (taps ignored while `stage !== 'run'`, `ok` label) | In `panel()`, when the witch has a pick, set `P.ok` to 「💊 用解藥救 X」 or 「☠️ 用毒藥毒 X」 and add an info line saying the same. Only the witch's own phone sees it, and the panel shape is unchanged. Pick the hint by potion state: 「㩒一個人＝用毒藥」 once the antidote is used. During `cue`, grey the chips with a 「準備緊…」 hint. At `tail`, show 「今晚你冇用藥」 if nothing was spent. | `js/games/werewolf/{game.js,script.js,ui.js}` |
| 5 | minor | ux | The 票型 screen is up for 7 s at most and cannot be found again | The tally is a `say` step whose cue lasts `cueMinMs` (5.6 s for the day-1 tie, never more than 7 s). Then a PK speech or 遺言 replaces it. The research calls vote openness standard ("open 票型 … is standard in 狼人殺 inference"), but during the game nothing can bring an earlier tally back. On a 12-player table, 7 s is too short to read twelve ballots. For outcome `nobody` (1 v 1), the line under the panel says only 「今日平安日，冇人出局」. The reason, 「除咗同票嘅人，冇人可以再投」, is only in the 7 s stage line. Reported by p1, p3, p4 and p6. | `js/games/werewolf/script.js:528-530`; `js/games/werewolf/game.js:1047` (tally is announce-only); `js/games/werewolf/ui.js:565-567` (`nobody` and `none` fall back to `tallyPeace`) | Give the tally `minMs ≥ 4000 + 800 × voters`, capped at about 15 s. Keep a public `v.votes` history (today's and earlier rounds) and show it under a 「🗳 之前嘅投票」 fold on the day screens. Add `S.UI.day.tallyNobody` for the `nobody` outcome. | `js/games/werewolf/{game.js,ui.js,script.js}` |
| 6 | minor | text | The results do not explain a wolves' win when the last wolf died the same night | The result says only 「屠城：所有好人（神職同平民）都出局，狼人先贏。」. The roles list shows both wolves dead (「4號大熊：🐺 狼人 第 4 夜被毒死」), so the win looks like a bug. p5 called it one ("poison was never applied"). p3 and p6 asked for a line. The ruling is correct: the research says "Wolves kill the last villager while the witch poisons the last wolf in the same night: both conditions hold, wolves win". | `js/games/werewolf/script.js:794-810` (`explainLines` gets only `win, why, rule`); `js/games/werewolf/game.js:1553` | When wolves win and the last night's deaths include a wolf, add: 「同一晚狼人殺咗最後一個好人，就算最後一隻狼同晚被毒死，都係狼人贏（狼刀優先）。」. Optionally mention 狼刀優先 in the witch's 💡 tip. | `js/games/werewolf/{script.js,game.js}` |
| 7 | minor | text | Role card and 💡 hints ignore the table's settings and the player's side | The wolf card says 「殺晒神職或者平民（屠邊），或者殺晒所有好人（屠城）— 睇設定。」 but never says which rule this table plays, although `v.opts.win` is in the view. The good card says 「放逐晒所有狼人」, but poison (and a hunter's shot) also count. The 💡 hint during someone else's speech tells everyone, wolves included, 「聽人發言，揾出講大話嘅人」. Reported by p6. | `js/games/werewolf/script.js:38-39` (`WIN_WOLF`, `WIN_GOOD`), `:58-64` (`roleCardText` takes no win rule), `:635` (`speech.other`); `js/games/werewolf/ui.js:161` | Pass `win` to `roleCardText` and print just the active rule (「今局屠城：殺晒所有好人」). Use 「所有狼人出局」 for good. Give `hintFor` a wolf variant for `speech.other` (「扮好人、睇吓邊個似神職」). It is built from the seat's own role and shown only on that phone. | `js/games/werewolf/{script.js,ui.js,game.js}` |
| 8 | polish | text | 「按座位號由大到細，由阿聰開始」 reads as wrong when it starts at seat 1 | The order 1, 6, 5, 4, 3, 2 is correct: a random start, then descending with wrap. But "biggest to smallest, starting at 1" confuses people (p3). The speaker list shows the real order, so this is wording only. | `js/games/werewolf/script.js:499` | Say 「由阿聰開始，之後 6號、5號… 倒數落去」, or name the next two seats, or use 順時針 / 逆時針 if the seat editor guarantees the circle. | `js/games/werewolf/script.js` |
| 9 | polish | rules | 遺言 defaults to 45 s; the research suggests 60 s | Day speeches are 60 s and 遺言 45 s. The research's timers say "last words 60 s (12 players: 120 s)", and the official 6-player config has 60 s. The setting can be changed, so this is only the default (p1, p6). | `js/games/werewolf/game.js:78` (`wordsSecs: 45`) | Default `wordsSecs` to 60, or document 45 as a deliberate engine choice in the flow doc §2.1. | `js/games/werewolf/game.js`, `docs/games/werewolf.md` |
| 10 | polish | ux | 今晚戰績 shows a 分 column of zeros for a game without points | Werewolf returns no `points`, so 分 is 0 for everyone, winners included. The medals (🥇 for both winners, 🥉 for the rest) are standard competition ranking but are not explained. This is shell-wide (p1, p6). | `js/ui/components/Scoreboard.js:38-46` | Hide 分 when no game tonight awarded points, or rank by 贏 with a one-line legend. | `js/ui/components/Scoreboard.js` |
| 11 | polish | flow | The host's 開始 ▶ is below the fold in the lobby | The start button comes after the seats, game, summary, config, narration and board cards, so the host has to scroll past every setting (p1). Shell-wide. | `js/ui/screens/lobby.js:222`, `:469` | Pin the start button to the bottom of the screen (sticky), or add a 「⬇ 開始」 chip at the top when the room is ready. | `js/ui/screens/lobby.js`, `css/base.css` |
| 12 | polish | a11y | Night chips use class `on` to mean "enabled", and the real pick has no `aria-pressed` | The playtest console reads class `on` as "selected", which is why p2, p3, p4 and p6 reported every chip as `(selected)`. That part is tooling (see AI-artifact notes). The real gap: the chosen chip has only the `pick`/`lock` classes, so a screen reader cannot tell which seat is picked. | `js/games/werewolf/ui.js:276-279` | Rename the class (for example `can`), and set `aria-pressed="true"` on the picked or locked chip only. | `js/games/werewolf/ui.js`, `js/games/werewolf/style.css` |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p4 (blocker) | Game hung on night 4 and never reached dawn or results | **AI artifact.** The room is in `results`. `lastResult` has the night-4 recap (「3號小美 被狼人殺死、4號大熊 被毒死」) and winners p4/p6, and p1, p3 and p6 all read the results screen around 19:21 UTC. Night 4 on the slow pace is wolves 50 s + witch 30 s + seer 25 s + cues, which is more than p4's 120 s `wait` allowed after its own pick. |
| p1 (major), p6 (minor) | The vote opens right after the last speech, with no rebuttal window, and 20 s is too short | **App is right.** Research Procedure 7–8: every living player speaks once, then the exile vote, "(official 15 s)". The rules have no free-talk round. The app's 20 s default is longer than official. p1's 0:01 confirm came from speaking, picking and confirming as three tool calls. |
| p1 (minor) | Decoy lists show dead players; "a real actor's list probably differs" | **App is right.** Every night panel, real or decoy, has one chip per seat, with dead seats shown but disabled (`game.js:1337-1344`; flow §3.2 "one chip per playing seat"). p3's real witch panel showed the same struck-through dead seats. |
| p1 (minor) | The decoy text 「呢一步同你冇關係」 differs from a real panel | **By design.** The research asks for a decoy "with the same shape, delay and tap count", not the same words. The witch's victim line and the seer's result cannot be copied to decoys. The words are visible only to someone reading another phone at night. The real night tell is brightness (#2). |
| p1 (polish) | 「可以將螢幕調暗啲」 sounds optional, but the dim was forced | **Misread.** The line asks the player to lower the phone's own brightness. The overlay is the anti-tell screen. Its uneven level is #2. |
| p1, p5 (polish) | Dead players still get the night dim and a decoy panel | **App is right.** Research anti-tell: "Identical night duration for every player, including dead players … Give them a decoy 'pick someone' panel". |
| p1 (polish) | You can vote for yourself | **App is right.** Candidates are "one living player" (research Exile vote 1). The VotePanel already needs a second tap on 「確定投俾 X」 with the name shown. |
| p2 (minor), p4 (minor) | Several seat buttons look selected at once | **Tooling.** `pt.mjs:134` reports class `on` (enabled) as `selected`. p2's own screenshot showed one gold chip. The real a11y gap is #12. |
| p2 (minor) | The role reveal should group by team | The reveal lists every seat with role emoji, cause and time, and the board composition is on the deal card. Low value. |
| p2 (minor) | Seer prompt phrasing is formal | p2 itself calls it correct. 「今晚你想驗邊個？」 is natural HK Cantonese. |
| p3 (major) | The witch's window ran out twice | **AI artifact.** The witch window is 30 s on the slow pace (20 s normal). The recap shows no tentative pick either night, so the AI never tapped. The feedback gaps a human would also meet (no "time's up" line, dropped cue taps) are in #4. |
| p3 (polish) | A peaceful night with no sheriff gave a fixed start | **App is right.** The start is `rint(rng, …)` over the living seats (`game.js:1006`). Seat 1 was the draw. Research Procedure 7: "random seat on a peaceful night". |
| p3 (polish), p4 (major) | The 1 v 1 tie skipped PK with no explanation; are the rules unclear? | **The rules are right.** Research: "1 wolf vs 1 good player: the day vote ties, so it ends at night … this is expected". Flow §3.7: nobody left to vote → 平安日. The cue said 「除咗同票嘅人，冇人可以再投，今日係平安日」. That the reason does not stay on screen is part of #5. |
| p4 (minor) | Hidden cards, but the official 6-player board is 明牌 | **App is right.** The default 6-player board is 預女 (research Setup "6 (default) … common", no 明牌). 明牌 belongs to the official 預獵 board, which the app offers as `6-sh` with `openCard: auto → on`. |
| p4 (minor) | The decoy panel stays up after 確定, and it is unclear whether to dismiss it | **By design.** Night windows have a fixed length whoever acted (research: "Identical night duration … same … delay"). 「已確定 ✓」 is the expected state. |
| p5 (minor) | The results show 大熊 「被毒死」, but the poison "never took effect" | **Misread.** All night deaths apply together at dawn (research Night resolution: "All night deaths are applied at the same moment"). 狼刀優先 decides only the winner, and 大熊 did die. The confusion is real and is #6. |
| p5 (polish) | The speech timer should show the total | The first speaker's cue states 「每人 60 秒」. The Timer is a shared component. Low value. |
| p5 (polish) | Dead players' night buttons were all disabled | **AI artifact, probably.** In the `run` stage the engine enables decoy chips for the dead (`game.js:686`, `:711-713`). Chips are disabled in every seat's cue and tail stages, which is where 3-second polling tends to land. |
| p6 (minor) | The PK intro shows no breakdown | Merged into #5. The breakdown was on the tally screen just before. |

## AI-artifact notes (only an AI's speed or tooling would hit these)

- **Tool latency inside fixed windows.** Pick and confirm were separate CLI calls, several seconds each. The witch (p3) let the 30 s window pass on nights 2 and 3. 大熊 (p4) abstained by timeout on the day-1 vote and never picked on night 2, where 阿珍's pick stood: 「其他狼人冇揀」. A human taps in about a second.
- **Polling misses short screens.** 3-second polling skipped the 3 s dawn card and parts of the 7 s tally. The screens really are short, and that is kept as #3 and #5, but humans glance more often than an AI polls.
- **`(selected)` on every chip** comes from `tools/playtest/pt.mjs:134`, which treats class `on` as selected. The werewolf grid uses `on` for "enabled".
- **Own-screen view of anti-tell.** Each AI saw only its own phone, so p2, p4 and p5 called the anti-tell "excellent". Only p3 and p6 noticed, from the console's `[overlay] night-dim` line, that their own lit step differed from the decoy steps (#2).
- **Invented details.** p2's good-things list praises a "1.5-weight sheriff vote". This build has no sheriff module, and a 6-player board would not use one.

## Rights checklists, merged per role

**🐺 狼人 (Werewolf)**: p4 大熊, p6 阿珍

| right (verified rules) | result | evidence |
|---|---|---|
| Do not see teammates at the deal; learn them on night 1 | ✓ | deal card has no mates; night-1 panel 「🐺 隊友：4號大熊」 |
| Pick one living target, including a mate or self (自刀), or 空刀 | ✓ offered | all living chips including 6 阿珍 enabled; 「空刀（唔殺人）」 button. Neither 自刀 nor 空刀 used |
| See mates' live picks; disagreement rule stated | ✓ | coloured dots; 「意見唔一致：票數最多嘅人被殺，同票隨機」. Night 2: a wolf who never picked was ignored (「其他狼人冇揀」) |
| Kill resolves at dawn; witch can save | ✓ | night 1 saved, nights 2–4 killed |
| Self-explode during day speeches (hold 1 s), same control on every living phone | ✓ offered, not used | button on every living seat, hidden for the dead. Not offered during 遺言 or the vote: a documented engine choice (flow §3.8) |
| Dead wolf: decoy only, no live picks | ✓ | 「你已經出局，今晚冇得揀」 |
| Wolves win under 屠城 with 狼刀優先 | ✓ | night 4 |
| Nobody can tell who the wolves are | ✗ (#1, #2) | 「6 阿珍 🐺」 chip, plain 「隊友」 line; only the wolves' phones lit on the wolf step |

**🔮 預言家 (Seer)**: p2 阿明

| right (verified rules) | result | evidence |
|---|---|---|
| Check one living player each night; camp only | ✓ | N1 小美 ✅, N2 阿聰 ✅ |
| Not self; no re-check | ✓ | own chip disabled; 小美 tagged ✅ and disabled on N2 |
| Result only after 確定 | ✓ | 「X 係：✅ 好人」 after confirm |
| A dead seer's step is still called for the same length | ✓ | N3 and N4 seer steps ran (no recap line, decoys shown) |
| Results stay private | ✗ (#1) | 「第 1 夜驗 3號小美：✅ 好人」 printed under 我嘅身份 all day |
| Nobody can tell the seer is awake | ✗ (#2) | lit phone on the seer step |

**🧪 女巫 (Witch)**: p3 小美

| right (verified rules) | result | evidence |
|---|---|---|
| One antidote, one poison, each once | ✓ | antidote N1, poison N4 |
| Learns the victim only while the antidote is unused | ✓ | N1 「今晚被狼人襲擊嘅係：2號阿明」 with 💊; later 「解藥已經用咗，唔會再知道邊個被襲擊」 |
| Antidote only on tonight's victim; poison any living player except herself | ✓ | dead seats struck through, own chip disabled |
| At most one potion a night | ✓ | one tentative pick |
| Self-save per setting (night 1 here) | not exercised | she was not the victim |
| May poison on the night she is the victim | ✓ | N4: killed and poisoned 大熊 the same night |
| Knows which potion a tap spends | partly (#4) | only the hint text; the button says 確定 |
| Potion status private; step not a tell | ✗ (#1, #2) | 「🧪 解藥冇・毒藥有」 plain; lit phone on the witch step |

**🧑 平民 (Villager)**: p1 阿聰, p5 阿強

| right (verified rules) | result | evidence |
|---|---|---|
| Hold-to-peek role card, aggregated ready count | ✓ | 「0 / 6 人睇完」, card re-covers on release |
| Same night panel as actors at every step (decoy) | shape ✓, brightness ✗ (#2) | pick + 確定 on every step; 95 % dim vs a lit actor |
| Speak in turn, 我講完 | ✓ | day 1, 2, 3 |
| Vote with 棄權 and 改票; PK vote when not tied | ✓ | day 1 PK 3–1 |
| 遺言 when exiled; none after a night-2+ death | ✓ | 阿強 45 s (#9); 阿聰 died N3, no words |
| Dead: read-only, own card still peekable | ✓ | 👻 banner, 「你已經出局，唔可以投」 |
| Role not visible at a glance | ✗ (#1) | 「1 阿聰 🧑」 |

**Everyone (dawn, day, vote, end)**

| right (verified rules) | result | evidence |
|---|---|---|
| Public dawn announcement in seat order, no cause, or 平安夜 | partly (#3) | the card exists but is up for about 3 s in 靜音; day 3 and 4 seen by p6 |
| Speaking order: random start on a peaceful night, next to a single death | ✓ | 1,6,5,4,3,2 · 3,4,6,1 · 4,3 |
| Votes secret until the tally; progress without names | ✓ | 「已投 n/N」 |
| 票型 public | ✓ but brief (#5) | tally panel with who voted whom and 棄權 |
| Tie → PK speeches → tied players do not vote → second tie or nobody left = 平安日 | ✓ | day 1 PK; day 3 `nobody` |
| Win check before triggers, 屠城, 狼刀優先 | ✓ | night 4 |
| End: every role, cause and time of death, night-by-night recap of hidden actions | ✓ | `lastResult.lines`; the why line is #6 |

**👑 房主 (host, also a player)**: p1 阿聰

| right / duty | result | evidence |
|---|---|---|
| Recommended board and reason pre-filled | ✓ | 6-player 預女 board, 屠城 |
| Start | ✓ | below the fold (#11) |
| ⏸ / 下一步 / ⋯ menu | present, not needed | the game advanced on its clocks |
| No secret panel for a playing host | ✓ | `god` block only with `moderator: 'human'` (`game.js:1425`) |
| Stall flags never name a seat at night | ✓ | `blocking` false at night (`game.js:1241-1253`) |
