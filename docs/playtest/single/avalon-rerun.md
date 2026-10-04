# 阿瓦隆 (avalon): one-phone re-run review

> Session `sp2-avalon`, `--shared`, 5 seats (p1 阿聰 host, p2 阿明, p3 小美, p4 大衛*, p5 阿強), recommended deck (梅林 · 派西維爾 · 亞瑟忠臣 / 刺客 · 莫甘娜), Lady off, `passPhone`, narration 🔊 語音. Code at HEAD `328b04f`. Reviewer: opus, read-only. *The setup named p4 大熊. A later restart renamed the seat (see T1).

## Verdict

**Not finished. The tooling stopped the match, not the app.** Play reached the Quest 2 vote with the score at 0 successes and 1 failure. Then at 20:26:20 UTC the session file was deleted, and every later command returned 「no running session」. Every one-phone step that was played behaved as DESIGN §7.1 specifies:

- the gated role-reveal walk;
- the public pick card;
- the private, clockwise vote walk;
- the quest cards, gated to team members only;
- the result as counts on a public card.

All 13 findings from run 1 are fixed in code. Two small one-phone gaps remain (F1, F2).

Facts: Quest 1 had leader 大衛, team 阿明 + 大衛, and passed 3:2 (rejecters 阿聰 and 小美). Both members played Fail, so it failed. Quest 2 had leader 阿強, team 阿聰 + 小美 + 阿強, and stopped during its vote. `lastResult` and `history` could not be read because the session was gone.

## Fixed since run 1

| Run 1 | Now |
|---|---|
| C1 public steps behind 「其他人唔好望」 | pick, voted and quest-result are `open` steps (`game.js:1147-1152`), shown on the light 👉 「輪到 X · label · 大家一齊睇」 card (`play.js:642`, `:394`) ✓ |
| C2 no gate when a public step becomes the same seat's secret step | `step` keys (`game.js:1147-1158`). In play, 阿強's own Q2 ballot got a 🔒 gate right after his public pick ✓ |
| C3 no equal-time reveal | U9: an 8 s reveal and a 4 s card minimum for every seat (`ui.js:37-38`, `:380`, `:593`). The lobby showed both ✓ |
| C4 walk restarts at seat 1 | `walkOrder` now goes clockwise from the holder (`logic.js:198`) ✓ |
| C5 no way past an absent seat | the host's gate escape 「X 唔喺度？ ⏭ 跳過佢」 (`play.js:530-543`) ✓ |
| C6 idle list names queued seats | `room.js:51` ✓ |
| C7 mini card on public screens | hidden on open steps (`ui.js:840`). Partly: the 💡 sheet still shows it, see F1 |
| C8 Mordred note with no Mordred | `merlinNote(blind)` gives 「全部邪惡你都見到」 (`script.js:528-534`) ✓ |
| C9 「自己部電話」 wording | shared variants (`script.js:344`, `:578`, `:636`). The 19:31 narrator line said 「部手機會逐個交」 ✓ |
| C10 lands mid-page | `land` → `scrollTop` (`play.js:424`) ✓ |
| C11 eyes closed before evil talks | the `talk` phase comes first (`game.js:565`, `:634`). Not reached in play |
| C12 佢哋 with one partner | p4 saw 「唔知佢嘅角色」 ✓ |
| C13 「你係隊長」 on face-up screens | `leaderShared` (`ui.js:414`) ✓ |

## Still open

- Run-1 fix item 1, optional part: the public 繼續 still waits on one named seat (F2).
- The C7 privacy point, now on the 💡 sheet (F1).
- Tooling T1 from run 1, presence and rescue, still has no daemon-side check. A new, worse tooling failure took its place (T1 below).

## New confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| T1 | blocker (test only) | tooling | Seats can stop or restart the shared session | The chat log rotated at 19:48:27 and again at 20:09:28, which means `start` ran twice. The third start used other names (大衛, and 細龍/大頭 in one lobby). The game began without the host tapping 開始, and at 20:26:20 the session file was deleted by `stop` or a Chrome exit. That moment matches the haiku seats p4 and p5, which both say they "stopped (token limits)" | `startSession` and `stop` accept any caller (`pt.mjs:1147-1151`, `:1073`). The daemon writes no log of why it stopped (`:1078-1092`) | Give `start` an owner token (env), and require that token for `stop`, `start` and `setup` on an existing session. Give every response a session epoch, and print 「⚠️ session restarted, state lost」 when it changes. Write `<s>.log` with the stop cause (which seat's `stop`, or the Chrome exit code). README: players never run `start`, `stop` or `setup` | tools/playtest |
| F1 | minor | privacy (from code) | The 💡 sheet shows the holder's role cover on face-up public screens | Run 1's C7 fix hid the mini card on pick, voted and quest-result. 💡 still renders 「㩒住睇你嘅角色」 with the holder's role and win text. On a phone lying in the middle, anyone can hold it | `hints.js:76-91` builds the cover whenever `roleFor(view)` returns a role. `play.js:182` passes the holder's view with no `focus.open` check | On a shared phone, when the focus is `open` and names the holder (the same test as `ui.js:840`), list the game's roles instead of the cover | shell |
| F2 | polish | one-phone flow | Public results wait on the previous leader, who needs two taps | After the vote and after each quest, the phone shows 「輪到 大衛 · 任務 1 結果」. Only that leader can tap the card and then 繼續, so the whole table waits on one seat for a screen that is already face up. p1 found the hand-over to an evil player "unexplained". The label does explain it, and the 3-minute wait was agent latency | `focus` voted/quest-result → `[leaderOf]` open (`game.js:1149-1152`). `mayContinue` lets only the leader continue (`game.js:367`) | On a shared phone, let any seat at the table tap 繼續 on voted and quest-result (a table send, like `talked`), or skip the card when the leader already holds the phone | avalon + shell |

## Rejected

| reported | by | why |
|---|---|---|
| No public vote reveal; the phone went straight to a private gate | p1 | **App is right.** voted is an `open` step. The card is light, and the named 👍/👎 grid sits behind it with 「部手機擺喺中間…」 (`ui.js:505-510`) |
| The leader's pick uses 「🔒 交俾 阿強 其他人唔好望」 | p3 | **Misread.** pick is open, so its card is 👉 「輪到 阿強 · 揀隊員」. The 🔒 gate was 阿強's own Q2 ballot (the C2 fix) |
| 「已投 3/5」 is one too high | p3 | **App is right.** The count is votes actually cast (`game.js:1047`). The walk is clockwise from the holder, not in seat order |
| The reveal advanced without 我睇完 | p3 | **Unverified.** In tap mode, letting go sends nothing (`ui.js:362-369`), and 我睇完 is held back for 8 s. The likely cause is churn in the control numbers |
| A quest-card timing tell | p3 | **App is right.** The 4 s minimum applies to every member (`ui.js:566`, `:593`) |
| p4 played 成功 but the result showed 2 Fails | p4 | **AI artifact.** The tile order is random for each seat (`ui.js:582`), and each tile sends its own kind (`:560-561`). An agent that taps by position hits 失敗 half the time |
| Names are inconsistent (major) | p2, p3 | **Tooling** (T1 restart) |
| The game hangs on a seat nobody drives (blocker) | p2 | **AI artifact.** The C5 escape exists |
| 「準備好喇，㩒一下」 is unclear | p2 | **AI artifact**, the same as in run 1 |
| No markers for the eyes-closed narration | p2 | **App is right.** Spec `docs/games/avalon.md:25` says "(no eyes-closed ritual)". The reveal is hold-to-peek |
| A 💡 popup appeared on its own | p5 | **Tooling.** The app never opens 💡 (`play.js:176`). `[1]` is the 💡 button (see p1's `hold 1`) |
| No feedback after voting | p5 | **App is right.** The next gate shows 「搞掂 n/5」 (`logic.js:217-221`) |
| The quest tiles look the same | p5 | **By design** (anti-tell) |
| The vote choice can be read over the shoulder | p1 | **App is right** (rejected in run 1) |
| 「好人只可以出成功」 is repeated | p1 | **By design.** It is a cheap reminder |
| Voting through 5 gates is slow (3.5 min) | p1, p3, p4 | **AI artifact** (agent latency). A secret ballot needs one hand-over per voter |

## AI artifacts

- The p2, p4 and p5 reports (haiku) are unreliable: wrong pass orders, "token limits", and p4's Success claim.
- Silences of 60–180 s at gates are polling time, not app latency.

## Tooling notes

- **T1** above is the reason the match did not finish. It also explains the name drift and the start without 開始.
- **T2.** `hold N` on a control that is not a cover opened 💡 (p1, p5). Refuse it, or retarget to the screen's only hold-to-peek cover. Also accept a text target (`hold 㩒住睇身份`).
- **T3.** Avalon needs at least 5 seats, so "fewer players" cannot go below 5. To save tokens, use sonnet seats only (the haiku seats quit early), use `wait 90` polling, and give the orchestrator a 5-minute watchdog on `hear`.
