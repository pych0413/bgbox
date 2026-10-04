# 狼人殺 (werewolf): one-phone re-run review

Session `sp2-werewolf` (`--shared`), 2026-10-04 18:27–19:27 UTC. Six AI players (p1 阿聰 host, p2 阿明, p3 小美, p4 大熊, p5 阿強, p6 阿珍) shared **one** phone. A referee decided who held it, enforced the hand-over cards, and kept everyone's eyes closed at night.

This run comes after the one-phone fixes: table mode, public and private gates, dawn to the middle, co-wakers, and the gate escape (DESIGN §7.1).

**Settings.** Defaults for 6 players on one phone:

- Board `6-sw`: 2 狼人, 預言家, 女巫, 2 平民.
- 屠城 (「6 人用屠城，免得 2 刀就完」). The witch may save herself on night 1.
- Pace slow (wolves 50 s, witch 30 s, seer 25 s, plus the opening and closing lines). 60 s speeches, 60 s 遺言, no vote clock.
- `passPhone: true`. Narration 🔊 語音 (the lobby offered no 靜音: 「一部手機：大家要閉眼，所以冇靜音」).

## Verdict

**The game finished.** Wolves (阿明, 阿珍) won by 屠城 on day 3, after about 60 minutes. Roughly 28 of those minutes were two AI seats stalling on day 3.

**One-phone werewolf is now playable and fair.** All four serious findings of run 1 are fixed, and the players saw each fix at the table:

- **Dawn.** The phone goes to the middle behind 「☀️ 天光喇」, whoever acted last. The chip no longer names the seer.
- **Speeches and 遺言.** Each one goes to the speaker on a public card 「輪到 X · 發言」. 我講完 and their own 💥 are in their hand.
- **Wolves.** They share one combined screen. Nobody hands the phone between wolves, and a dead wolf is never first in line.
- **Tally and 遺言.** They no longer sit on the last voter's screen.

No secret leaked. The deal, the eyes-closed screens, the anonymous night cards and the decoy steps for the dead witch and seer all held.

**Nothing in this run is a blocker or major.** There are 7 minor and 3 polish findings. Most are rough edges of the new one-phone parts:

- The speech clock is held correctly, but the timer still counts down and beeps behind the card.
- The shared wolf pick has some rough semantics.
- The 💡 role list on the table phone includes roles that are not in play.
- A proxied vote shows as an ordinary abstain.
- Werewolf never got the U8 night noise bed.

## Finished?

Yes. `room.lastResult` reads 「狼人隊贏：好人全部出局（屠城）」, winners p2 and p6. The recap, the table talk and the reports agree:

| | What happened |
|---|---|
| Night 1 | Wolves 空刀: one shared selection, ended by one 空刀 tap. The witch used nothing (p3 missed her call: tooling T3). The seer checked 阿聰 ✅. Peaceful night. |
| Day 1 | Everyone claimed villager. 阿聰 exiled 2–1–1 (小美 and 阿珍 voted for him; 大熊 and 阿強 abstained). He gave 遺言. |
| Night 2 | Wolves killed 小美 (one shared pick). The witch could not save herself and did not poison. The seer checked 阿明 🐺. |
| Day 2 | 阿強 claimed seer (阿明 wolf). 阿珍 counter-claimed (小美 金水, 阿強 wolf). 阿強 exiled 3–1. |
| Night 3 | Neither wolf picked inside the window, so 空刀. The dead witch and dead seer were still called, with the same lengths. |
| Day 3 | 大熊 and 阿明 stalled for 8 and 7 minutes. The host used 「X 唔喺度？」 → 🤖 代佢做 for both speeches and both votes (both votes became 棄權). 大熊 exiled 1–0. 屠城. |

p2, p4 and p5 filed their reports as "in progress" or "not finished". They stopped reading before the end; see AI artifacts.

## Fixed since run 1

| Run-1 # | Finding | Status in this run |
|---|---|---|
| 1 (blocker) | Every dawn named the last night role on the chip | **Fixed.** `play.js:607` goes to the table behind 「☀️ 天光喇」 on night → day. Every report saw the card. |
| 2 (major) | Speeches and 遺言 never reached the speaker | **Fixed.** `game.js:1355-1360` gives a public focus with `hold: true`. The 「輪到 X · 發言」 card was used about 15 times, plus 遺言 for 阿聰 and 阿強. |
| 3 (major) | Dead wolf first in line, so night 2 was 空刀 | **Fixed in code.** `game.js:1335-1337`: living wolves first, and dead wolves dropped on one phone. Not exercised, since no wolf died. |
| 4 (major) | Wolf hand-over unexplained, and the 換人 path named the teammate | **Fixed** (U2). There is one combined screen, 「🐺 你哋一齊揀：2號阿明、6號阿珍」. The rules text was rewritten (`script.js:196`). |
| 5 | 換人 during a secret step named the person | **Fixed.** `switchSeat` refuses during secret steps. The chip and 換人 are disabled at night. |
| 6 | 票型, 遺言 and dawn stayed with the last holder | **Fixed.** A table card 「部手機擺返中間」 comes before the tally. 遺言 has its own public card. |
| 7 | 靜音 allowed on one phone | **Fixed** (U1). The lobby offers no 靜音. |
| 8 | The 新手慢慢嚟 preset stalled every speech | **Fixed** by #2: the speaker always holds 我講完. |
| 9 | Text assumed one phone each, or named controls that do not exist | **Mostly fixed.** Night 1 says 「部手機擺喺枱中間…」, the 換人 / ⋯ instructions are gone, and a new 「一部機玩」 rules section exists. Nights 2 and later still drop the one-phone line (new #4). |
| 10 | 「（你）」 on shared screens | **Fixed.** `ui.js:70` youTag is off when `api.shared`, and `play.js` uses noYou for VotePanel and PlayerPicker. The results screen shows plain names. |
| 11 | The holder voted first with no card | **Fixed.** Every voter gets 「交俾 X · 其他人唔好望 · 第 N 日投票 · 搞掂 k/N」, clockwise from the last holder (#17). |
| T1 | The referee read hand-over cards aloud | **Fixed.** Eyes-closed seats get the real narrator line. |
| T2 | The wrong seat could tap a named card | **Fixed.** No complaints. |
| T4 | `wait` ignored table talk | **Fixed.** `wait` wakes on any new chat or narrator row. |
| T5 | Day screens were hidden from non-holders | **Fixed.** The phone in the middle is readable by everyone. |

## Still open from run 1

- **T3 (tooling, major for the harness): `wait` misses a card that is already up.** p3 started `wait` just after 「女巫請開眼」 had been spoken. `wait` keys on a change from its first look, so it slept through her whole 35 s turn. She missed the night-1 witch step. See tooling notes.
- Nothing else. Run-1 #9 survives only in a narrower form, as new #4.

## New confirmed findings

| # | Sev | Category | Title | Root cause | Fix | Owner |
|---|---|---|---|---|---|---|
| 1 | minor | ux / clock | The speech and 遺言 timer counts down, beeps at 10 s and at 0, and the list says 「🎙 講緊」, all behind the unanswered 「輪到 X · 發言」 card. The room clock is actually held (U10). When the speaker taps, the timer jumps back to about 1:00. | `werewolf/ui.js:119` builds the Timer with `paused: !!c?.paused` and ignores `ctx.clockHeld`, which `play.js:172` supplies and no game reads. `Timer.js:48,55` only freezes and silences when `paused`. `ui.js:522` marks the current speaker 講緊 from the step alone. The hold itself works (`session.js:337-356`). | Use `paused: !!c?.paused \|\| !!c?.clockHeld`, ideally with the label 「⏸ 等 X 開始」 instead of 暫停緊. While `clockHeld`, show 「⏳ 等緊開始」 for the current speaker. Check other games that use `hold` too. | werewolf `ui.js` (shell DESIGN note) |
| 2 | minor | text | The 💡 sheet on the table phone lists every role in the game (🏹 獵人, 🛡️ 守衛, 🤡 白痴) and a generic win line (「…睇房主設定」). The board has only wolves, villagers, seer and witch, under 屠城. Everyone reads the middle phone. | `hints.js:93-95` falls back to `allRoles(game.rules)` (static `RULES.roles`) whenever `roleFor(view)` is null. That is always the case for the table view (`api.me` null). | Let a view name the roles in play and the rule, e.g. `view.hintRoles = ['werewolf', 'villager', 'seer', 'witch']` and `view.hintWin`. The werewolf table view fills them from `board` and `opts.win`, and `hints.js` filters the list. | shell `hints.js` + werewolf view |
| 3 | minor | ux | Combined wolf screen, which holds one shared selection. (a) 空刀 is a single tap. It locks every wolf, and the screen leaves at once with no undo, while a kill needs pick then 確定. (b) The hint still says 「意見唔一致：票數最多嘅人被殺，同票隨機」, which cannot happen on one screen. (c) The recap credits each wolf with the shared pick: 「阿明→3號小美、阿珍→3號小美（一致）」. p6 tapped 大熊 and never picked 小美. | (a) `ui.js:362` sends `{pick: null, lock: true}` with `seats`. `game.js:866-878` copies it to every mate. `game.js:1332` drops locked wolves from focus, and the shell moves the phone to the middle. (b) `game.js:740-742` sets `P.hint = rule` with or without co-wakers. (c) `game.js:909` and `script.js` `recapNight` print each wolf's copied `sel`. | (a) On a combined screen, make 空刀 a choice: a 空刀 chip, then 確定, or `api.confirm`. (b) Hide the rule hint when `ctx.coWakers.length > 1`. (c) Set `rec.wolves.shared = true` when the tap carried mates, and print 「🐺 狼人（一齊揀）→ 3號小美」. | werewolf `ui.js`, `game.js`, `script.js` |
| 4 | minor | handover | From night 2 on, the spoken line is just 「第二晚，天黑請閉眼」, and 狼人請開眼 follows 3 s later (night 1 gave 8 s). The 遺言 speaker still physically holds the phone. Only the dim on the screen says 「📱 擺返中間」. | `script.js:499`: `if (n !== 1) return …` ignores `pass`. | With `pass`, say 「第二晚，天黑請閉眼。部手機擺返枱中間。」 on every night. The longer text also raises `minMs`, which gives a few more seconds before the wolves wake. | werewolf `script.js` |
| 5 | minor | rules-text | 🤖 代佢做 at a vote gate casts a 棄權, and the public 票型 shows it as an ordinary abstain (「棄權：2號阿明、4號大熊」). Abstaining is a read in 狼人殺, and neither of them chose it. | The escape `play.js:550-555` calls `autoAct`. Werewolf `autoAct` for a vote is `{type: 'vote', target: null}` (`game.js:1388`), and the tally and recap have no marker. | On a vote step, label the button 「🤖 代佢棄權」. Mark proxied ballots in the tally and recap as 「棄權（代做）」. This needs the core to flag actions that came from `autoAct`, or the engine to record it. | shell + core + werewolf |
| 6 | minor | text | The witch screen says 「呢個規則你唔可以自救」 on night 2 without the reason. The lobby said 「女巫第一晚可以自救」. | `script.js:652`, `game.js:772`. | Name the rule: 「今局淨係第一晚可以自救」 or 「今局女巫唔可以自救」. | werewolf `script.js` / `game.js` |
| 7 | minor | tell | On a whole-table phone, werewolf has no night noise bed. U8 went to onuw only. Reaching for the phone in the middle at the witch and seer steps, and putting it back, is heard against silence. | `game.js:91-105`: meta has `eyesClosed` but no `nightAmbient: true`. `play.js:1122` plays the bed only for that flag or `table.ambient`. | Add `nightAmbient: true` to the werewolf meta (one line, DESIGN §7.1 U8). | werewolf `game.js` |
| 8 | polish | tell (weak) | On one phone a dead wolf is not called. Once a wolf dies, one person reaches at the wolves' step instead of two, while a dead seer or witch still picks the phone up. An eyes-closed table can hear the difference. | `game.js:1337` (`if (pass) pids = pids.filter(alive)`) and the rules text `script.js:196` 「出咗局嘅狼人唔使拎」. The original reason, a chained hand-over that gave the dead wolf the card (run-1 #3), is gone: the U2 screen mounts the first living wolf anyway. | Keep dead wolves in `pids` after the living. The screen is the living wolf's, and `commit` counts only living wolves. Say 「出咗局嘅狼人都照拎」. Or keep the current rule and document the trade-off. Not observed, since no wolf died. | werewolf `game.js`, `script.js` |
| 9 | polish | ux | On a shared phone, the witch and seer never see their closing line (「☠️ 今晚你用咗毒藥毒 X」 / 「今晚你冇用藥」). When the window ends the focus drops and the phone goes to the middle under the dim. A witch whose tentative pick was spent at the bell finds out only from 📓 by day. | `game.js:1326` returns no focus once the stage leaves `run`. `play.js:627` then goes to the middle silently. | With `passPhone`, keep the called seats in focus through the tail line, which has the same length for every step and decoys. Or put 「⏰ 時間到」 in the dim's words for the seat that was holding the phone. | werewolf `game.js` / shell |
| 10 | polish | a11y | The role card's accessible name 「㩒住睇角色牌」 differs from its visible text 「㩒住睇身份」 (WCAG 2.5.3, label in name). The console's `hold "㩒住睇身份"` failed for every player. | `RoleCard.js:77` defaults `ariaLabel`, and werewolf `ui.js:185-195` passes only `backLabel`. | Make the RoleCard's default `ariaLabel` its `backLabel`, or pass `ariaLabel` from werewolf. | shell `RoleCard` |

**Evidence for #1:** `p4-002.png` shows 「發言 0:59」 behind 「輪到 大熊 · 發言」, with 4號大熊 already marked 🎙 講緊. p1 saw 0:00 behind 大熊's day-3 card during his 8-minute stall. p6 saw 0:53, then 0:47, then 1:00 after tapping 開始.

**Evidence for #3:** the night-1 recap line 「2號阿明→空刀、6號阿珍→空刀」, and the night-2 line 「…→3號小美（一致）」, against p6's taps (小美 on night 1, 大熊 on night 2).

## Rejected findings (the app is right, or the claim is wrong)

- **p1/p3: the vote start differs each day, or seems unpredictable, and on day 3 "no gate, whoever grabbed it first".** The walk goes clockwise from the last holder (DESIGN §7.1 #17; flow doc §4 「Votes … clockwise from the holder」).
  - Days 1 and 2 started at 阿明, the last speaker. On day 3, 阿明's and 大熊's speeches were proxied, so the phone never landed on them. The last real holder was 阿珍, and her private card 「交俾 阿珍」 opened (`play.js:401-407`).
  - The day-1 and day-2 table card appeared because a seat held the phone (`play.js:627`). On day 3 it already lay in the middle.
- **p1: you can vote for yourself.** Research, Exile vote 1: 'Each ballot is one living player or an abstain'.
- **p1: the host's own card offers 「阿聰 唔喺度？」.** On a whole-table phone the host is the device, not the person. If 阿聰 walks off, someone else at the table needs that escape.
- **p1: a vote takes 6 private hand-overs (about 5.5 min).** This comes with one phone (flow doc §4, Votes). Most of the time was AI latency. A pointing vote would be a new option, like U7 for 假畫家, not a bug.
- **p1/p3: the escape unlocks only after 60 s; the confirm disappears after about 10 s.** The 60 s is the console's referee rule (`pt.mjs:64`, `PT_ESCAPE_AFTER`); the app shows 「X 唔喺度？」 at once. The app's arm window is 3 s (`dom.js:161`), and a person double-taps easily. The console round trip is the problem (tooling).
- **p1: ⏭ is offered on vote cards but not on speech cards.** By design: 「⏭ 跳過佢」 applies to walks only (#18). A speech is one person; use 💤 or 🤖.
- **p6: ⏭ on a vote circles back to the same absent seat.** By design: the seat goes to the end of the walk (#18), and with no vote clock the vote cannot close without them. 💤 當佢缺席 removes the seat.
- **p6: no teammate mark on the vote list.** The day rule keeps nothing secret in the open (`ui.js` header). The same VotePanel is used face up on phones of one's own.
- **p3 (major) and p6: the witch and wolf windows close silently, with no countdown.**
  - There is a silent progress bar on the night stage card (`ui.js:134-138`). The console's text view cannot show it.
  - When the window ends, the dim says 「📱 擺返中間 · 部手機放返枱中間，閉埋眼」.
  - Fixed windows are the anti-tell (research, Anti-tell 1).
  - p3 deliberated for several minutes; 30 s for the witch is the slow pace. Downgraded to an AI artifact. Polish #9 covers the missing closing line.
- **p1/p6: night 3's silent 空刀.** No wolf picked inside the 50 s window, because 阿明 was unresponsive and 阿珍 was late. A tentative pick would have counted (`game.js:909`). AI artifact.
- **p5: the dead seer is still called.** This is the deliberate decoy (research, Anti-tell; rules 「角色出局咗都照叫、照拎機」).
- **p4: the two seers "verified dead players".** Misread. 阿強 checked 阿聰 on night 1, while he was alive. 阿珍's claim was a wolf's bluff.
- **p4: no "vote is final" warning.** The ballot already needs a pick and then 確定投票, and the phone moves on.
- **p2: "night 1 had a 1–1 disagreement".** Misread. On the combined screen there is one selection. The recap shows a single 空刀 for both wolves.
- **p6: the 💡 sheet blocked the middle phone at dawn.** A player opened it: p6's index `tap 1` hit 💡 (tooling). Its wrong role list is kept as #2.
- **p3: 「只有 阿明 可以㩒」 at a table card someone had already tapped.** That is the console's refusal text, not the app (tooling).

## AI artifacts (only an AI's speed or tooling would hit these)

- **Day-3 stalls.** 大熊 sat at his speech card from 18:58:26 to 19:06:52 UTC, and 阿明 from 19:08:10 to 19:15:07. Both voters then stalled until 19:27. A slow human would answer a name called aloud; the escape exists for one who has really left.
- **p3's two lost witch turns.** Night 1 was tooling T3. On night 2 she deliberated past the window.
- **Night-3 空刀.** The wolves answered late.
- **Report quality.**
  - p2, p4 and p5 stopped before the end and reported "in progress".
  - p2 described a plurality tie that cannot happen.
  - p4 gave 「~100+ minutes」.
  - p5 marked `finished: false` while describing day 3.
- **Dead 阿聰 kept talking at the table and prompting others.** The console allows it (see tooling).

## Tooling notes (`tools/playtest/pt.mjs`)

- **T3 is still open (major for the harness).** `wait` (`pt.mjs:981-1003`) returns only on a change from its own first look, or on new chat. A card that was already up for this seat when `wait` started is printed only after it closes. That cost p3 her night-1 witch step.
  - **Fix:** keep the last printed key per seat. If the first look differs from it and the seat may act (an anon or private gate for it), return at once.
- **Narrator lines between two calls are lost.** `wait` prints only rows since the current call (`heard()`), and the eyes-closed view shows only the newest narrator line (`pt.mjs:785`).
  - **Fix:** keep a chat cursor per seat and print everything since that seat's last output.
- **`wait` is capped at 90 s without saying so.** `WAIT_MAX_S = 90` (`pt.mjs:62`) silently cuts `wait 120`. Print 「(capped at 90 s)」.
- **Controls are matched by accessible name only.** `hold "㩒住睇身份"` failed (app polish #10). Match visible text as well.
- **Index taps break when the screen shifts.** p6's `tap 1` opened 💡. Refuse an index tap when the screen hash changed since that seat last saw it, or tell players to use labels.
- **The escape confirm cannot be reached.** The 3 s arm window is shorter than one console round trip. Two attempts failed with 「no control matching 再㩒一次」. Add `tap … --confirm`, which taps the armed button again in the same call.
- **Escape taps are logged by the console, not the app.** The table-talk lines 「📱 阿聰（房主）喺交接卡…㩒咗…」 come from `pt.mjs:864`, and p1 credited the app with them. Keep the log, but tag it as a console note.
- **Co-wakers have no private channel.** `say` is public, so the two wolves could not agree a target, and the shared selection went to whoever tapped first.
  - **Fix:** add `say --awake`. Allow it only while the seat is on the current anonymous step's combined screen, and deliver it only to those co-wakers.
- **Dead seats can `say` freely.** Tag their lines 「（出局）」, or refuse them outside their own 遺言.
- **Unclear refusal text.** At a table card someone already tapped, say 「已經有人㩒咗，而家輪到 X」 instead of 「只有 X 可以㩒」 (`pt.mjs:867`).
- **Missing annotation.** The 「— 唔係你㩒」 note is sometimes missing from `tap` output (`pt.mjs:809`).
- **README.** For eyes-closed games, tell players to loop `wait` all night and to run `hear` after each wake-up.

## What worked

- **The deal.** Private cards 「交俾 X · 其他人唔好望 · 搞掂 k/6」, the hold-to-peek card, and 睇完喇 handing straight to the next card. The counter never names anyone.
- **The night.**
  - Anonymous cards (「狼人請拎起部手機」) and 「🌙 你閉緊眼」 with the last narrator line for everyone else.
  - The combined wolf screen named both wolves, to the wolves only.
  - The dead witch and dead seer were called on night 3 for the same lengths (witch about 35 s, seer about 29 s).
- **Dawn and the day.**
  - The 天光喇 card, whoever held the phone.
  - The speaking order follows the research: day 1 random start going down, day 2 next to the dead player going up.
  - Public speech cards, with 我講完 and 💥 in the speaker's hand (with the 「唔係狼人㩒咗冇反應」 decoy copy).
  - 遺言 for the day exiles and none for the night-2 death.
- **Votes.** One private card each, with the progress in the subtitle, and a full 票型 with abstainers.
- **The host escape.** 「X 唔喺度？」 → 跳過 / 💤 / 🤖 unblocked four stalls without switching seats.
- **The end screen.** Every role, how each player left, and a night-by-night recap of hidden actions (wolf picks, witch passes, seer checks, timeouts).

Session stopped with `node tools/playtest/pt.mjs stop sp2-werewolf`.
