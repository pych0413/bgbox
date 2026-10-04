# 間諜 (spyfall): one-phone playtest review

> Session `sp-spyfall`, `--shared` (one 390x844 phone passed around a 4-seat table), 2026-10-04 06:14–06:24 UTC.
> Code under test: local HEAD `16da24d` (the working tree changes only `tools/playtest/` and `docs/playtest/`, so the
> game and shell line numbers below are the code that ran). Config: 1 round, **12 min** (the 新手 preset, which 阿聰
> picked), 1 spy, 24 locations, **舉手** (阿聰 changed it from the default 手機投票), accuser bonus `first-midround`.
> Narration 🔇 靜音. Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊 (dealer). Reviewer: opus, read-only (no code edited).

## Verdict

**The game finished: the spy won by naming the location.** 阿聰 (the spy) stopped the clock at 4:31 of 12:00 and named
🧵 深水埗布料街, which was correct: 間諜贏：估中地點, +4. These parts worked: the look hand-around, hold-to-peek, the
gates, the spy's reveal and pick, and the scoring explanation.

**The play phase does not work on one phone yet.** No public table screen exists. The phone stays on **one seat's private
screen**: that seat's card is one hold away, and its 🙋 指控 and 🕵️ 我係間諜 act **as that seat**. This table treated the
screen as private and handed the phone to every person asked. 7 questions took about 7.5 min of the clock, with gaps of
80–170 s while the phone travelled. A table that puts the phone in the middle instead exposes that seat (C1, C2). The
config also ignores the one-phone flag and defaults to 手機投票 (C4).

## Facts from the table

| | |
|---|---|
| Location / roles | 🧵 深水埗布料街 · 阿聰 🕵️ 間諜 · 阿明 幫人度身嘅裁縫 · 小美 揀緊窗簾布嘅師奶 · 大熊 讀時裝設計嘅學生 (`p1-003.png`) |
| Questions (`hear`) | 大熊→阿聰 06:16:51 · 阿聰→阿明 06:17:16 · 阿明→小美 06:18:38 · 小美→阿聰 06:19:06 · 阿聰→大熊 06:21:55 · 大熊→阿明 06:22:18 · 阿明→阿聰 06:23:41. The gaps of **82 s, 169 s and 83 s** are hand-overs: the person asked waited for the phone before answering. |
| Spy stop | At 06:22:42 阿聰 asked out loud for the phone. The gate reached him at about 06:23:41 (4:39 left). He revealed at 4:31 and picked the location with a confirm. Banner 「🕵️ 阿聰 話佢係間諜」 + 「⏸ 鐘停咗 · 剩 4:31」 |
| `lastResult` | winners `[p1]`, points p1 4 / others 0. Lines: 「第 1 局 🧵 深水埗布料街（間諜：阿聰）— 間諜贏：估中地點 · 阿聰 +4」, 「阿聰 停鐘亮身分，估中地點 🧵 深水埗布料街！」, 「間諜 +4（贏 +2，估中地點再 +2）。」 |
| Round reveal | Only 阿聰 saw the per-seat role table (`p1-003.png`, 「睇完 0 / 4 · 等緊：阿聰、阿明、小美、大熊」). His one 睇完 went straight to the results. The other three saw only the results summary (`p3-004.png`). |
| Final state | `phase: results`, `activeSeat: p1`, `focus: null`. `history` has one entry. |

Timeline (UTC):
- 06:14 all four said 準備好.
- 06:15:22 阿聰 switched to 舉手 and the 新手 preset, then started.
- 06:15–06:16 look walk 阿聰 → 阿明 → 小美 → 大熊, gated in seat order.
- 06:16:51 the dealer 大熊 asked the first question.
- 06:17–06:23 seven questions, with the phone handed to each person asked via 換人.
- About 06:24:00 阿聰 tapped 🕵️, confirmed and picked the location.
- 06:24:09 results; one 睇完, then the final scoreboard.

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| C1 | major | one-phone flow / privacy | In play the shared phone has no public table screen: it stays on one seat's private screen | Once the last seat taps 準備好, `focus` is null for all of play (`game.js:1309-1322`). The shell closes the gate and keeps the last seat on screen. That screen is the seat's own: 「我嘅身分 · 淨係你見到」 (hold-to-peek, shown in play), its 🙋 指控 (also on the sticky clock bar) and its 🕵️ 我係間諜, which act as that seat (C2). Spec §4 says the phone lies on the table, any seat records a pass and no switching is needed, and the engine does take `ask` from any seat (`game.js:1144-1152`). The screen never says so. The chip 「而家睇：大熊 換人 ⇄」 and 「你答完就問下一個」 make it look private. This table, with the console enforcing it (T1), handed the phone to every person asked: 7 questions in about 7.5 min, with 80–170 s gaps. A human table that lays the phone down instead has that seat's card one hold away and its buttons under every finger. The location list, public by the rules, is readable only by the holder | `play.js:92-101` (`viewFor` always shows the seat on screen; no table mode for a phone with 2+ seats), `play.js:344`; spyfall `ui.js:43` (`WITH_CARD` includes play), `:125-126`, `:484-491` | **Shell:** on a phone with 2+ seats, when `focus` names none of its seats during play (not anonymous or night), show a public **table screen**. Use the existing `st.table` view (`play.js:100`) under a 「放喺枱中間 · 大家一齊睇」 header, the same card as undercover C1. **Spyfall table screen:** the clock, the floor card with the seat grid enabled (send `ask` as any seat on the phone; the engine does not check who taps), the location list, no role card, and one 🛑 button (C2). Optional, per the research note that the question tracker should be off by default and adds friction: let a one-phone table hide the tracker | shell (`play.js`) + spyfall ui |
| C2 | major | integrity | 🙋 指控 and 🕵️ 我係間諜 act as the seat on screen, not the person tapping | To accuse or reveal you must first switch to your own seat: chip, name, gate, 3 taps. Nothing on the play screen says so. If you skip it: **(a)** 🙋 (also the clock-bar shortcut) spends the on-screen seat's once-per-round accusation. The picker leaves out the seat on screen and offers yourself (`ui.js:352`). The accuser bonus, and in 舉手 mode the reporter, go to the wrong seat. **(b)** A real spy who taps 🕵️ on someone else's seat and confirms 「我係間諜，停鐘」 gets silence: the panel closes like 取消 by design (`ui.js:331-335`) and the clock keeps running. **(c)** Anyone who taps 🕵️ → 停鐘 while the spy's seat is on screen forces the spy out (`game.js:1166-1171`), which works as a probe of the seat on screen. 阿聰 knew to switch, but it cost about 60 s (06:22:42 → 06:23:41), mostly AI pace and the console. A human needs about 5 s, still with the clock running and a time-up race | Actions are always sent as `activeSeat` (`play.js`). Spyfall `ui.js:321-356` has no shared-phone path. Spec §4 「the accuser takes the phone (or switches to their own seat)」 relies on players knowing this | On the C1 table screen, put 🙋 and 🕵️ behind one **🛑 停鐘** button: 「邊個要停鐘？」 seat list, then the 「交俾 X」 gate, then X's own screen with 🙋 指控 / 🕵️ 我係間諜 / 取消. Everyone takes the same path, so it reveals no role. Until then, on a phone with 2+ seats, show 「以 大熊 身分」 in both panels plus 「唔係你？先㩒『換人』揀返自己」. **For the user to decide:** whether 🛑 freezes the clock while the phone changes hands. The rules stop the clock only for an accusation or a reveal; a neutral freeze that resumes on 取消 keeps the spy's right to stop at any moment | spyfall ui + shell |
| C3 | major | privacy (from code) | A new round's look, and a 手機投票 final vote, open on the seat already on screen with no gate | This is the same root as undercover C3. On roundEnd the phone is read by the table, and one 睇完 starts the next round. Focus is then every present seat, and the seat on screen is among them, so **no gate** opens. Whoever tapped 睇完 sees 「㩒住睇你嘅身分」 over someone else's card; the small 「而家睇：X」 chip is the only warning. The same happens at time-up with 手機投票 (the C4 default): the on-screen seat's 👍/👎 ballot opens ungated on the table phone. Not exercised here (1 round, 舉手, spy guessed) | `play.js:344` (`here.includes(seat)` → no gate) | Same fix as undercover C3: when a private walk starts after a public step, gate the seat on screen too | shell |
| C4 | minor | config | Spyfall ignores `singleDevice`: a 一部手機玩 room defaults to 手機投票 | Room passes `{ singleDevice }` to `defaults`/`validate` (`room.js:776-782`, `:817`), and draw-guess, avalon, cheese-thief and 9upper use it. Spyfall's `defaults(n, prev)` drops it and always sets `voteMode: 'phone'`. The summary here read 「手機投票」 (`p1-001.png`). On one phone that passes the phone to every voter for every vote (spec §4: use 舉手). The help 「舉手：大家同時舉手，由一個人㩒結果。」 sits above a select reading 各自用手機投 (`p1-002.png`) | `game.js:265-272`, `:318-341`, `:374` | In `defaults(n, prev, env)`: when `env?.singleDevice` is set, use `voteMode: 'hands'`, even over a carried-over `'phone'`. In `validate(cfg, n, env)`: warn 「一部手機玩建議揀舉手，唔係要逐個人傳部機投票」. Help: 「各自用手機投：每人喺自己部手機㩒。舉手：大家一齊舉手，一個人㩒結果（一部手機玩揀呢個）。」 Update spec §2 and the tests | spyfall |
| C5 | minor | one-phone flow / text | 「睇完 0 / 4 · 等緊：阿聰、阿明、小美、大熊」, yet one tap closes the reveal for everyone | `markSeen` sends `seats: deviceMates()` (correct per spec §3.6), but `seenLine` lists every seat as waiting. One tap after the 2 s lock jumped to the scoreboard. Only the tapper saw every role (`p1-003.png` vs `p3-004.png`). Part of that is the console (T1); at a human table the holder can also close it after 2 s | `ui.js:606-611`, `:590-596` | When this phone holds every waiting seat: 「一部手機：大家睇完先㩒（㩒一次就得）」. On a phone holding the whole table, keep 睇完 locked until the C1 「放喺枱中間」 card is dismissed (undercover C2) | spyfall ui (+ shell) |
| C6 | minor | text | Copy that assumes one phone each, and strikes that neither stay private nor survive | Three lines assume each player has a phone: 「㩒一下劃走（淨係你部手機見到）」 (`ui.js:511`), the 貼士 line (`game.js:217`), and 「唔好俾人睇你部手機證明身分」 (`game.js:153`). The UI is remounted for each seat, so `st.strikes` (`ui.js:55`) is wiped at every hand-over. While the phone sits on one seat, that seat's strikes are visible to the table, and heavy striking can hint at the spy | `ui.js:55`, `:511`; `game.js:153`, `:217` | Wording that fits both setups: 「（淨係呢部機見到；一部機輪流玩，換人會清返）」 and 「唔好攞手機出嚟證明身分…」. Show no strikes on the C1 table screen | spyfall |
| C7 | minor | text | No one-phone section in the rules, and the 💡 hint is wrong on one phone | `rules.sections` has no 一部手機玩 entry, unlike undercover's 單機玩法. The play hint 「…覺得邊個係間諜，可以㩒「🙋 指控」。」 is wrong on one phone unless you switch seat first (C2). p4 asked for one-phone help | `game.js:100-225`, `:1382` | Add a section: 「揀舉手投票。開局逐個傳部機睇身分。問答時部機放喺枱中間，邊個被問都可以㩒佢個名。要指控或者亮間諜身分，先㩒『換人』揀返自己（或者 🛑 停鐘）。」 Once C2's 🛑 path exists, the hint is correct again | spyfall |
| C8 | minor | text | 「發問中」 on the person who is still answering | The floor card reads 「小美 答完就問下一個」, because by design the card moves to whoever is asked. The grid badge on that same seat says 「發問中」, so p2 read it as 小美 asking | `ui.js:279` | Change the badge to 「答緊」 or 「輪到」 | spyfall ui |
| C9 | polish | ux | 「（你）」 on a shared phone | The lobby marks every seat 「（你）」. The round reveal marks the seat on screen, here the **spy** 「阿聰（你）」 with the is-me highlight, on a screen the whole table reads. The results scoreboard does the same (also undercover C7) | `SeatEditor.js:105`, `:127`; spyfall `ui.js:81`; `results.js:286` | When `mySeats.length > 1`, drop 「（你）」 and the is-me highlight | shell + spyfall ui |

## Checks that passed (one-phone specifics, from code and play)

- **Look hand-over order:** `focus` = the present seats that are not ready. The gates follow seat order: 阿聰 (the host,
  already holding the phone) → 阿明 → 小美 → 大熊. This matches every report.
- **Privacy of each hand-over:** `openGate` calls `closeAllCovers()` before the gate (`play.js:293-297`), and every gate
  is the same card, 「交俾 X · 其他人唔好望」. p1 found his cover closed when the phone came back. Nobody saw anyone
  else's card.
- **No role tell in the look:** the card is a fixed 5:3 cover (`css/base.css:262-277`). 準備好 and the 🕵️ panel are the
  same for every seat.
- **No step waits forever on a seat:** the look walk, the 舉手 reporter, the guess and the forced second spy all use
  `focus` gates. On roundEnd, 睇完 counts for every seat on the phone (`seats`). Play has no `focus`, and 換人 is
  always available.
- **Spy reveal and guess:** a clear inline confirm, a public frozen clock, a pick with a change-or-confirm step, correct
  scoring (+2 win, +2 guess) and a plain-words explanation.
- **Question tracker:** the no-asking-back rule 🚫, the trail and ↩ 撤銷 worked.
- **Night anti-tell:** not applicable. There is no night step; Old pals is not implemented.

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p1 | 每局 8 分鐘 default for 4 players | rejected (setup) | The setup set `minutes: 8`. `defaults(4)` gives 6 (`game.js:228-229`, `:269`), and the help reads 「4 人建議 6 分鐘」 |
| p1, p2, p3 | No automatic gate after tapping the person asked; 換人 needed for every question | merged → C1 | By design no hand-over is needed. Spec §4: the phone lies on the table and anyone records the pass, and `ask` is accepted from any seat. The hand-over on every question came from a screen that looks private, plus the referee (T1) |
| p1, p3 | The clock runs during hand-overs | merged → C1 / C2; magnitude is an AI artifact | The rules keep the clock running during talk; only an accusation or a spy reveal stops it (research Procedure 5, 7, 8). With the phone in the middle there is no hand-over per question. What is left is the seat switch before 🙋 or 🕵️ (C2) |
| p1, p3 | The spy's and accuser's rights depend on the holder, who can block them | merged → C2 | At a real table a human just picks the phone up. 阿明 asking another question after the spy's request was AI behaviour |
| p1 | Asking for the phone out of turn is a tell | app-is-right, rest merged → C2 | The stop is public by rule (research Procedure 8). Accusers take the same switch, so it shows an intent to stop, not a role. C2's single 🛑 path makes every stop look the same |
| p1 | Page height changes while peeking | rejected | The cover has a fixed size with absolutely positioned faces, so card content cannot shift the layout. The console scrolls the cover into view before `hold` (`pt.mjs:346-347`) |
| p2 | No final vote when the spy guesses | app-is-right | Research Procedure 8: on a correct or wrong guess, the round ends immediately either way |
| p2 | No 'spy is revealing' screen | app-is-right + tooling | The banner 「🕵️ 阿聰 話佢係間諜」 (`ui.js:216`), the frozen clock (`ui.js:172`) and cue `game.js:492` exist. p2 never held the phone and narration was 靜音 (T1, T5) |
| p2 | Location and spy shown to all at the end | app-is-right | Research Procedure 10: round end is public and every role is revealed |
| p3 | The location list is only on the phone | merged → C1 | The list is public by the rules; the C1 table screen should carry it |
| p4 | The spy's guess is not logged or announced | app-is-right | `lastResult.lines` has 「阿聰 停鐘亮身分，估中地點 🧵 深水埗布料街！」, and the guess phase lists picks (`ui.js:477`) |
| p4 | No status cue while waiting | tooling (T4) | The phone shows the clock and the floor card. The console told non-holders only 「拎緊部手機」 |

## AI artifacts (not app bugs)

- **Slow hand-overs.** Each one took 60–170 s. 小美 took about 2.5 min to hand to 阿聰, including a failed text tap (T2).
- **Ignoring the spy's request.** 阿明 kept asking questions for a minute after the spy asked for the phone.
- **Inaccurate reports.**
  - p4's checklist has `couldUse` inverted: false for things p4 did.
  - The time left at the reveal was reported as 4:49 (p2), "about 6 min" (p3) and 6:22 (p4); it was 4:31.
  - p4's "about 12 minutes of active play" was really about 7.5 min.
  - p2 wrote "survival +2"; it is win +2, guess +2.

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | evidence | fix |
|---|---|---|---|
| T1 | The referee keeps play, and the round reveal, private to the seat on screen | `pt.mjs:456-461`. Only room phase `results` is auto-shown (`:457`), and spyfall's `roundEnd` happens during room phase `playing`. That forced a hand-over for every question, and 3 seats never saw the role table | Same fix as undercover T1. On a public step (no gate, not dark, `focus` without pids, including the game's `roundEnd`), let every seat `see` the screen and `tap`, and keep `hold`/`type` for the seat on screen. A re-run then exercises C2, because someone will tap 🙋 on another seat's screen |
| T2 | `tap` by text hits a COVERED or disabled control | `pt.mjs:342` takes the first line that contains the text. 小美's 「阿聰」 tap hit the grid button behind the 換人 sheet and reported success | Prefer matches without `COVERED` or `disabled`. If every match is covered, fail and list the matches |
| T3 | No way to choose a `select` option | `key ArrowDown` works, but README:38 and `pt.mjs:525` list only Enter, Escape, Backspace and Tab | Add `tap <select> "<option text>"`, which sets the value and dispatches `change`, and document the arrow keys |
| T4 | `wait` for non-holders | Many 「nothing changed in 60 s」 results (`pt.mjs:578-603`). Gates for other seats arrive looking like your own event | Same as undercover T2: key the wait on phase plus the public header, and label other seats' gates 「（公開：交俾 阿明）」 |
| T5 | Silent narration | Non-holders never heard 「阿聰話佢係間諜！鐘停咗…」 (`game.js:492`) | For one-phone runs use `--narration read`, and echo cues into `hear` (undercover T4) |
| T6 | The setup overrode `minutes` | `configApplied {"rounds":1,"minutes":8}` | Use the game's defaults or presets unless a test needs otherwise |

## Fix list for the orchestrator (priority order)

1. **C1 + C2:** a shell table mode for a phone with 2+ seats when `focus` is empty, plus a spyfall table screen with one
   🛑 停鐘 path to the seat's own 🙋 / 🕵️. The user decides whether 🛑 freezes the clock.
2. **C3:** `play.js:344`, shared with undercover C3. Gate the seat on screen when a private walk starts after a public step.
3. **C4:** spyfall `defaults` and `validate` should honour `singleDevice` (舉手 on one phone), and the help should cover
   both options.
4. **T1 + T2 + T5**, then re-run `sp-spyfall` one-phone with 2+ rounds and default settings. Try an accusation and a
   time-up final vote.
5. **C5–C9** text and polish.
