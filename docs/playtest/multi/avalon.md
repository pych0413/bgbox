# 阿瓦隆 Avalon (`avalon`): multi-agent playtest review

Session `mp-avalon`, room 4661, 2026-10-04 19:23–19:40 UTC. Five AI players (haiku and sonnet) each drove one headless phone window against the deployed build `https://pych0413.github.io/bgbox/`. With the `?v=` stamps and line endings normalised, the deployed `js/games/avalon/{game,ui,script}.js`, `js/ui/screens/{play,results}.js` and `js/ui/components/NarratorBar.js` are byte-identical to local `a72d23e`, so every line number below refers to the local repo.

Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強. Settings: 5 players, preset 推薦 (`recommended`): Merlin, Percival, 1 Loyal Servant against Assassin and Morgana. Lady of the Lake `auto`, so it is off at 5 players. Official Oberon switches (no Oberon in the deck). `flipEvil` off. `revealSecs` 40, `questSecs` 20, `discussSecs` 0, `assassinSecs` 0. Narration 靜音 (silent).

Sources checked:
- Rules and flow: `docs/research/avalon.md` (its "## Verification" section takes precedence) and `docs/games/avalon.md`.
- Code: `js/games/avalon/{game,ui,script}.js` and `style.css`; `js/ui/screens/{play,results}.js`; `js/ui/components/{NarratorBar,Scoreboard,Cover}.js`; `js/ui/logic.js`; `js/core/{session,room,client}.js`; `css/base.css`.
- Evidence: `room.lastResult`, `room.history`, `room.config`, the table chat log (`pt hear`, 21 lines), all 14 screenshots, and a live `see` of every seat after the game.

`node tests/run.mjs avalon` gave 91 passed and 0 failed.

## Verdict

**The game finished.** Evil won by assassination. Good completed three quests (✓ ✗ ✓ ✓), then the Assassin 小美 shot 阿明, who was Merlin. All five phones ended on the results screen.

**Every rule the game reached was correct.** This covers the deal, each role's night information, team sizes 2/3/2/3/3, strict-majority votes revealed with names, leader rotation (one seat per proposal, then one past the proposer after a quest), the rejection track resetting on approval, a single Fail failing a quest at 5 players, the shuffled anonymous pile, assassination only after the third success, and the Assassin able to name any seat but their own.

**No blocker or major issue.** Three seats (p2, p4, p5) reported a blocker: "stuck at the assassination". That is an AI artifact. The evil AIs talked for 5 min 41 s (19:34:21 to 19:40:02) before 小美 shot. Those three seats had already stopped under their own three-minute stall rule, and the shot landed after they quit. p2's "Merlin cannot be targeted" is a misreading: 🚫 marks your own seat on your own phone.

**Four minor issues are confirmed:**
1. During the assassination, only the Assassin's phone shows the pulsing 輪到你 pill.
2. On the quest screen, an evil player who selects Fail gets a red glow and a confirm button reading 「出「失敗」牌」. Someone looking over their shoulder can see both. This defeats the per-seat tile shuffle.
3. In 讀稿 (read) narration mode, the host's 下一步 during a quest auto-plays 成功 for any card not yet confirmed. That can silently cancel a sabotage.
4. The results recap numbers proposals with a global counter, but the game screens number them per quest.

There are also seven polish items. Players found the recap and assassination items. Two anti-tell problems (#1, #2), the 讀稿 hazard (#3) and the plain-text locked vote (#7) came from reading the code.

**Not exercised live:** Lady of the Lake (off at 5 players), the fifth-rejection loss, the quest-4 two-Fail rule (7+ players only), Mordred and Oberon, `flipEvil`, an Assassin miss (Good win), discussion and assassination timers, one-phone mode, 呢輪作廢 and 代佢做. The unit tests cover all of these.

## Did it finish?

Yes. `room.phase = 'results'`, `lastResult.winners = [p3, p4]`, summary 「邪惡陣營反敗為勝 — 刺客 小美 刺中梅林 阿明」, `points` p3 1 and p4 1, the rest 0. `room.history` holds one entry. `see` on p1–p5 showed the results screen on every seat.

Roles: 阿聰 亞瑟忠臣 · 阿明 梅林 (saw 小美、大熊) · 小美 刺客 (ally 大熊) · 大熊 莫甘娜 (ally 小美) · 阿強 派西維爾 (saw 阿明、大熊, unlabelled).

| quest | proposal (in quest) | leader | team | vote | result |
|---|---|---|---|---|---|
| 1 | 1 | 阿明 | 阿聰、阿明 | 4:1 pass (大熊 rejected) | ✓ 2 success |
| 2 | 1 | 小美 | 阿聰、小美、阿強 | 5:0 pass | ✗ 2 success, 1 fail (小美) |
| 3 | 1 | 大熊 | 小美、大熊 | 2:3 reject | — |
| 3 | 2 | 阿強 | 阿聰、阿明 | 3:2 pass (小美、大熊 rejected) | ✓ 2 success |
| 4 | 1 | 阿聰 | 阿聰、阿明、阿強 | 4:1 pass (大熊 rejected) | ✓ 3 success, so the assassination began |
| — | — | — | — | — | 19:40:02 小美 shot 阿明 (Merlin), so Evil won |

All of this matches `docs/research/avalon.md` ("Quest team sizes", "Voting & resolution", "Leader rotation", "Assassination").

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | minor | tell | During the assassination, only the Assassin's phone shows 輪到你 | The engine names the Assassin in `focus` so a shared phone's pass gate can say 「刺客請拎起部手機」, and it marks the focus `anonymous`. The shell's header badge ignores `anonymous`, so on separate phones the Assassin's header gets the pulsing yellow 輪到你 pill and nobody else's does. The chime already respects `anonymous`; the badge does not. Evidence: on p3-004 (the Assassin) the subtitle is cut to 「邪惡商量，好人安靜...」 because the pill is squeezed in after it. On p2-002, p4-001 and p5-001, with the same four header buttons, the subtitle shows in full. On a wider phone the pill is fully visible. Flow doc §1 and §3.8 promise "Every seat gets the same screen" for this step. §8.3 already lists this as a known low-priority tell. Impact is small (Good cannot act any more), but it names the Assassin before the shot, which the printed default forbids ("no card is shown before the shot"). | `js/ui/screens/play.js:484` (`myTurn` has no `!st.focus?.anonymous`, unlike `chimeForTurn` at `:516`); `js/games/avalon/game.js:995` | Add `&& !st.focus?.anonymous` to `myTurn` in `paintHeader`, matching the chime. Alternatively, build framework request #3 (`focus.decoyPids`: badge on every phone, gate only for the Assassin). Add a UI test: during `assassinate` every seat's header is the same. | `js/ui/screens/play.js`, `tests/avalon.test.mjs` (or the shell tests), `docs/games/avalon.md` §8.3 |
| 2 | minor | tell | An evil player's Fail selection shows a red glow and 「出「失敗」牌」 | The quest screen mirrors tile order per seat so that "an over-the-shoulder glance at *where* a finger went is uninformative" (flow §3.5). Two things undo that. (a) A selected Fail tile gets `.av-tile.fail.on`, a red border, background and glow. A Success pick glows blue. Only an evil phone can ever show the red glow, and colour is readable from across the table. (b) The big yellow confirm button changes its label to 「出「失敗」牌」. The research's anti-tell list says: "identical screen layout for every team member (two buttons, positions randomised per player if you want to defeat over-the-shoulder reads)". | `js/games/avalon/style.css:170-171`; `js/games/avalon/ui.js:522-529` (`on` class, `play.textContent = T.quest.play(choice)`); `js/games/avalon/script.js:577` | Use one neutral selection style for both tiles (for example the accent ring, not the team colour). Change the confirm label to a choice-free 「確定出牌」. The tile's own label still tells the player what they picked. Keep Fail inert for Good. Extend the "one shape for every seat" UI test to cover the selected state. | `js/games/avalon/{style.css,ui.js,script.js}`, `tests/avalon.test.mjs`, `docs/games/avalon.md` §3.5 |
| 3 | minor | flow | In 讀稿 mode, the host's 下一步 during a quest auto-plays 成功 for unconfirmed cards | p1 worried that the big yellow 下一步 makes skipping a step easy. In 靜音 and 語音 modes that cannot happen. The session acknowledges the cue after `minMs`, and the bar then disables 下一步. In this game the button was live only during the cue's few seconds, and a tap there only acknowledges the cue. In **讀稿** mode, though, 下一步 stays enabled after the cue is read. A narrator who taps it again to move on ends the quest early: `skipStep('quest')` calls `resolveQuest`, which fills every missing card with 成功, even inside the 20 s minimum window. An evil player who has not yet confirmed loses their Fail without anyone knowing, and the recap's 「由系統代出成功」 line comes only after the game. The ⋯ menu item 「⏭ 下一步（跳過今個步驟）」 has the same effect and no confirm. In `reveal` the same tap cuts every seat's identity window short. | `js/games/avalon/game.js:571-576` (`skipStep`), `:435-438` (`resolveQuest` defaults missing cards); `js/ui/components/NarratorBar.js:116` (`disabled = !line && mode !== 'read'`); `js/ui/screens/play.js:338`; `js/core/session.js:315-323` (silent auto-ack) | In `skipStep('quest')`, while the timed window is still open (`questSecs > 0 && !windowOver`), only end the clock (set `windowOver`, then resolve if every card is in). Fill missing cards only on a second 下一步 after the window, which is the dead-phone case the doc describes. Optionally add a toast confirm in the shell when a skip would play for a seat. Test: `@next` inside the window never changes `cards`. | `js/games/avalon/game.js`, `tests/avalon.test.mjs`, `docs/games/avalon.md` §5 (`@next` row) |
| 4 | minor | text | The results recap numbers proposals globally; the game numbers them per quest | During play, the top bar and 🗂 提議記錄 say 「任務 3 · 第 2 次提議」 (per quest, matching 連續否決 1/5). The recap says 「任務 2 · 第 2 次提議」, 「任務 3 · 第 3 次」, 「任務 3 · 第 4 次」, 「任務 4 · 第 5 次提議」, because it prints the global `proposalNo`. Players can read 「第 4 次」 as four rejections (p1). The 呢鋪唔計 vote line reuses the same global number. | `js/games/avalon/game.js:421` (`no: s.proposalNo` stored in `voteLog`), `:1142-1147`; `js/games/avalon/script.js:475-476`, `:479-483` (`voided`); compare `js/games/avalon/ui.js:150-163` and `game.js:773-775` (`s.rejects + 1`) | Store the per-quest index in each `voteLog` entry (`k: s.rejects + 1` before the tally changes the track) and in `voids`. Print 「任務 q · 第 k 次提議」 in `RECAP.proposal` and `voided`. Keep `no` as an internal id. | `js/games/avalon/{game.js,script.js}`, `tests/avalon.test.mjs` |
| 5 | polish | flow | The assassination has no clock and no "waiting for the Assassin" line by default | `assassinSecs` defaults to 0, so the step shows a static picker until the Assassin shoots. Non-Assassins see a disabled 「揀一個先」 (no target picked) or 「已記低」. p1, p4 and p5 read this as a hang during a 5–6 min AI deliberation. At a real table people would hear evil murmuring, but a quiet table or a slow Assassin looks the same. The research suggests "assassination deliberation (suggest 2–3 min)" as an optional timer. | `js/games/avalon/game.js:114` (`assassinSecs: 0`), `:489-494`; `js/games/avalon/script.js:612-622` | Default `assassinSecs` to 120 (a soft nudge, as now: nothing happens at 0:00). Add one line, identical on every phone, such as 「邪惡商量緊，刺客決定咗就會公佈」. Never "X is choosing". | `js/games/avalon/{game.js,script.js,ui.js}`, `docs/games/avalon.md` §2 |
| 6 | polish | text | The quest clock is labelled like a deadline but is only a minimum | The timer reads 「出牌時間 0:20」, so a player expects to lose their card at 0:00. In fact the clock is a minimum, and a missing card is waited for (`advance` sets `windowOver` and waits). The only explanation, 「時間到先公佈結果。」, appears after the card is played. p1 rushed and never found out what happens at timeout. | `js/games/avalon/script.js:584` (`timerLabel: '出牌時間'`), `:580`; `js/games/avalon/ui.js:531`; `js/games/avalon/game.js:746-751` | Relabel to 「最快 0:20 公佈」, or add one line for every team member before they play: 「唔使趕：時間到先一齊公佈，未出嘅會等你。」. Use the same text for good and evil. | `js/games/avalon/{script.js,ui.js}` |
| 7 | polish | tell | A locked vote stays on screen in plain text until the reveal | After confirming, the phone shows 「你投咗：贊成 ✓」 and keeps the chosen tile lit until the last vote lands. A neighbour who has not voted yet can read it and follow it. The research lists "the vote a player is casting until all votes are locked" as private. | `js/games/avalon/ui.js:419-431` (`locked` keeps `on`, `status.textContent = T.vote.voted(mine)`) | After locking, show a neutral 「已投 ✓」 with neither tile lit. Show your own choice only while 改票 is open, or on a hold. | `js/games/avalon/{ui.js,script.js}` |
| 8 | polish | ux | The results recap is one flat 25-line list, not foldable sections | The shell folds `result.lines` into sections when a heading line looks like 「── 標題 ──」, as werewolf, onuw and draw-guess do. Avalon's headings (「🎭 身份同夜晚情報」, 「📜 任務記錄…」, 「🗳 提議同投票記錄」, 「🗡️ 刺殺」) are plain strings, so they render as ordinary rows (p1-004). Flow doc §8.4 asked for this, and the shell now supports it. | `js/games/avalon/script.js:466-487` (`RECAP.*Head`); `js/ui/logic.js:135`, `:145-149` (`HEAD_RE = /^──\s+/`) | Emit every heading as `── 🎭 身份同夜晚情報 ──` (and the other heads), and update the recap tests. | `js/games/avalon/script.js`, `tests/avalon.test.mjs`, `docs/games/avalon.md` §3.10 |
| 9 | polish | rules | The results show who played which quest card, which the research says never happens | The recap lists 「出牌：阿聰 成功、小美 失敗、阿強 成功」. The research's information limits say: "No information about who played which quest card ever leaves the engine. Only counts." It is never shown live, so play is unaffected. But across an evening it teaches who sabotages when, which the physical game never reveals. Flow doc §3.10 and §7 chose this on purpose (the 「原來係咁」 moment). This is an owner decision, not a bug (p3). | `js/games/avalon/game.js:834` (`played` in `endView`), `:1132`; `js/games/avalon/script.js:471` | Keep it and note the deviation in flow doc §9. Or add a config bool (for example `revealCards`, default on) that drops the 出牌 lines and `played`. | `js/games/avalon/{game.js,script.js}`, `docs/games/avalon.md` |
| 10 | polish | text | Confetti on every results screen includes 🧀 | The shell's confetti set is `['🎉','✨','🧀','🎊','⭐']` for every game, so the Avalon win rains cheese (p3). 🧀 is the app's mascot (boot screen), so this may be intended, but it reads as a Cheese Thief leftover. Shell-wide. | `js/ui/screens/results.js:20` | Swap 🧀 for the finished game's `meta.emoji` (🏰 here). | `js/ui/screens/results.js` |
| 11 | polish | ux | The scoreboard gives losers 🥉, and its headers are single characters | 1, 1, 0, 0, 0 points becomes 🥇🥇🥉🥉🥉, because competition ranking puts the 0-point players at rank 3. 玩 / 贏 / 分 read as stray characters (p1). Same as werewolf #10. Shell-wide. | `js/ui/components/Scoreboard.js:20`, `:38-46`; `js/ui/logic.js:55-69` | Give medals only to rows with points above 0 (or only to winners of the last game). Write headers as 局 / 贏 / 分數, or add a one-line legend. | `js/ui/components/Scoreboard.js`, `js/ui/logic.js` |

## Rejected findings

| reported by | finding | why rejected |
|---|---|---|
| p2, p4, p5 (blocker) | "Game stuck at the assassination; the Assassin AI cannot decide" | The game finished. 小美 shot 阿明 at 19:40:02 (`pt hear`), `lastResult` is set, and every phone is on results. The wait was evil AI deliberation of 5 min 41 s. See AI-artifact notes. The real UX gap (no clock or status line) is confirmed as #5. |
| p5 (blocker) | "揀一個先 stays disabled; the Assassin cannot lock in" | p5 is Percival. Their picker stays on 「揀一個先」 until they pick a target, which they never did. On the Assassin's phone the button became 「確定刺殺 阿明」 (p3-004) and the shot went through. |
| p2 (major) | "Merlin is disabled in the assassination target list" | The 🚫 is on **your own** seat on **your own** phone (`exclude: v.me`, `ui.js:640`). The research says: "The UI should allow any seat except the Assassin's own." On the Assassin's phone 阿明 was selectable (p3-004) and was shot. |
| p2 (minor) | Hint 「人人都要㩒」 is confusing when only the Assassin counts | This is deliberate anti-tell: every seat taps so finger noise says nothing (flow §1, §3.8). The hint itself ends 「得刺客嗰下先算」 (`script.js:419`), and the screen says 「只有刺客嘅選擇先算數」. |
| p2 (minor) | No score summary between quests | The quest result shows 「而家：成功 1 · 失敗 1」 under the pile (p1-002), and the board's ✓/✗ circles are always on top. |
| p1 (minor) | Good players see a live 「❌ 失敗」 tile that does nothing | This is the documented anti-tell (flow §3.5). The research's anti-tell list asks for "identical screen layout for every team member (two buttons …)". A greyed tile would tell everyone who is good. The caption 「只有邪惡陣營先出得「失敗」。其他人㩒「失敗」冇反應。」 explains it, and the engine refuses Good's Fail anyway (`game.js:696`). |
| p1 (polish) | The pile showed the Fail first, so maybe it is sorted | The pile is built from counts and shuffled with `ctx.rng` (`game.js:445`). Only one mixed pile was seen, and the Fail landing first has a 1-in-3 chance. |
| p5 (minor) | "Quest 2 showed 2 symbols for a 3-person team" | p1-002 shows three cards ✗ ✓ ✓. The cards flip in one at a time, 350 ms apart (`ui.js:540-553`), so p5 captured the screen mid-animation. |
| p3 (minor) | No "I've seen it" button in the 40 s reveal | This is deliberate. The research says "Fixed-duration reveal screens for **every** role". Flow §3.1 says the window "never ends early". 40 s was this table's choice; the default is 25 s. Tap mode (`revealSecs 0`) exists for one-phone play. |
| p3 (polish) | Assassination screen should remind the Assassin who their ally is | That would print secret information on an open screen. The hold-to-peek 「我嘅身份」 card sits right under the picker (p3-004) and holds exactly this. |
| p3 (polish) | No discussion window between the leader confirming and the vote | The research says discussion is free, with "no official timer; app may offer an optional one" (`discussSecs` exists). Votes are untimed and can be changed until the last one lands, so talk can continue on the vote screen. |
| p1 (polish), p3 (minor) | Every result step waits for the leader's 繼續; no auto-advance | The research has no auto-advance, and a pause gives time to read the vote grid. The leader is public. The host can skip with ⋯ 「⏭ 下一步」 (`skipStep` voted / quest-result), and 代佢做 covers a dead phone. The 30–60 s waits were AI turn latency. |
| p5 (major) | Missing "lock the card open" feature | A card that stays open without holding puts the role on an open screen, which is the opposite of the research's peek protection. The lock the research mentions (Cheese Thief's `lockMode: 'peek'`) latches a card *shut*. Here every release re-covers the card, so it adds little. |
| p4 (minor) | Evil approved an all-good-looking team | Player strategy, not app behaviour. Q2 included 小美 (evil), and she failed it. |
| p2 (rights) | "Be targeted by the Assassin: could not verify" | Verified. 阿明 (Merlin) was the target, and the hit gave Evil the win (`toShot`, `game.js:496-504`). |

## AI-artifact notes (only an AI's speed or tooling would hit these)

- **The "stuck" assassination.** The evil AIs talked from 19:34:21 to 19:40:02 UTC (小美 probed 阿聰 at 19:36:58 and decided at 19:40:02). p2, p4 and p5 had already applied their three-minute no-change stop rule, so they report `finished: false` for a game that finished.
- **The armed 「再㩒一下確定」 window.** It lasts 3 s (`ui.js:233`, and flow §3.8 by design). p3's second tap came in a separate tool command more than 3 s later, so the button had reset. A human double-taps well inside 3 s. This is not a finding.
- **The quest clock already at 0:11–0:13 when p1 first saw it.** That is polling latency. The clock is a minimum anyway, so no card can be lost (wording issue confirmed as #6).
- **"No alert when the card phase opens" (p1).** The shell plays the 'turn' chime when `focus` names your seat (`play.js:514-517`). Quest members and voters get it, and it is suppressed only for anonymous focus. AIs cannot hear it, and 靜音 narration is not muted sound effects.
- **Miscounts.** p5's two-card pile was a mid-flip screenshot. p4 counted 4 proposals instead of 5 and recalled its own Q3-1 vote as Reject; the log shows 贊成.
- **Leader 繼續 delays of 30–60 s.** These are AI turn latency, not app behaviour.

## Rights checklists, merged per role

Legend: ✅ used and worked · ➖ not reachable or not needed this game · ⚠️ worked, with a confirmed finding attached.

### Every seat

| right | status | seats / note |
|---|---|---|
| Learn own role privately, hold-to-peek, same 40 s window for everyone | ✅ | all 5. One card layout per role; Servant gets the same-height empty grid (「你冇特別情報」) |
| Public role list in play (今局角色) | ✅ | p1, p3, p4, p5 |
| Vote approve / reject on every proposal (leader and team included), secretly, change until the last vote, simultaneous named reveal | ⚠️ | all 5, 5 proposals. Only 「已投 n/5」 is shown, never who. Locked vote readable on own screen (#7) |
| See quest board, team sizes, ✓/✗, rejection track, per-quest Fail count, proposal history | ✅ | p1, p2, p3, p5 |
| Nominate exactly team-size players as leader, self allowed | ✅ | 阿明 Q1, 小美 Q2 (incl. self), 大熊 Q3-1 (incl. self), 阿強 Q3-2, 阿聰 Q4 (incl. self) |
| Leader rotation one seat per proposal; track resets on approval | ✅ | 「連續否決歸零（之前 1 次）」 seen after Q3-2 |
| Anonymous, shuffled quest result (counts only) | ✅ | p1, p3 (p5's two-card read was mid-animation) |
| Table talk: accuse, defend, bluff | ✅ | 21 chat lines |
| Re-peek own role at any time | ✅ | 「㩒住睇返我係咩」 under every screen |
| Final role reveal with night info, every card, every vote, the shot | ⚠️ | ✅ shown. Global proposal numbers (#4), flat list (#8), card attribution is a design choice (#9) |
| Host controls: pause, 下一步, 呢輪作廢, 代佢做 | ➖ | Not needed. 讀稿-mode 下一步 hazard found in code (#3) |

### 亞瑟忠臣 Loyal Servant (p1 阿聰)

| right | status | note |
|---|---|---|
| No night information, on the same-length card, so absence of info leaks nothing | ✅ | 「你冇特別情報 / 靠觀察、投票同推理」 |
| Play Success; Fail not available to Good | ✅ | 4 quests. Fail tile is inert by design; engine refuses Good's Fail (`game.js:696`) |
| Stay quiet during the assassination; decoy tap available | ✅ | Screen says 「好人同梅林請保持安靜」 |

### 梅林 Merlin (p2 阿明)

| right | status | note |
|---|---|---|
| See the evil seats (minus Mordred, plus Oberon by default), names only, shuffled | ✅ | Saw 小美、大熊, no role labels. No Mordred or Oberon in the deck |
| Not shown who Percival is | ✅ | `knowledgeFor` gives Merlin only `seesEvil` |
| Play Success, vote, lead | ✅ | Led Q1 with 阿聰 + self |
| Be a valid assassination target | ✅ | Shot by 小美, so Evil won. The 🚫 on p2's own phone is the self-exclusion |

### 派西維爾 Percival (p5 阿強)

| right | status | note |
|---|---|---|
| See Merlin and Morgana as two unlabelled names | ✅ | 「其中一個係梅林，另一個係莫甘娜」: 阿明、大熊 |
| Play Success only | ✅ | Q2, Q4 |
| Lead a team | ✅ | Q3-2: 阿聰 + 阿明, passed 3:2, success |
| Stay quiet during the assassination | ✅ | The game resolved after p5 stopped; p5's "stuck" report is an AI artifact |

### 刺客 Assassin (p3 小美)

| right | status | note |
|---|---|---|
| Learn evil allies, without role labels | ✅ | 「你嘅邪惡同伴：大熊（唔知佢哋嘅角色）」 |
| Play Fail, or choose Success | ✅ | Failed Q2 (single Fail fails at 5 players). Both tiles were offered. Red-glow tell (#2) |
| Confer with Evil after the third success; Good stays quiet | ✅ | Spoken at the table, 19:34–19:40 |
| Name any seat except self (ally allowed), with a deliberate second tap | ✅ | Shot 阿明. 3 s armed window is by design |
| App never hints who Merlin is | ✅ | The shot was a real read (「阿聰太大聲，好似個誘餌」) |
| Assassin's identity stays hidden until the shot (printed default) | ⚠️ | Broken by the 輪到你 pill on the Assassin's phone only (#1) |

### 莫甘娜 Morgana (p4 大熊)

| right | status | note |
|---|---|---|
| Learn evil allies, without role labels | ✅ | Saw 小美 |
| Appear to Percival as a Merlin candidate | ✅ | Percival's card showed 阿明、大熊 |
| Vote, lead, talk | ✅ | Led Q3-1 (小美 + self, rejected 2:3) |
| Play quest cards | ➖ | Never on a team that played. The evil quest right was covered by p3 |
| Join the assassination talk | ✅ | Suggested 阿聰 at 19:35:12 |

### Not reachable this game

Lady of the Lake (off under `auto` at 5 players) · fifth-rejection loss (track peaked at 1/5) · quest-4 two-Fail rule (7+ players) · Mordred, Oberon and both Oberon switches · `flipEvil` · Assassin miss / Good win · discussion and assassination timers · one-phone pass-and-play · 呢輪作廢 and 代佢做. The unit tests cover each of these (`tests/avalon.test.mjs`, 91 passing).
