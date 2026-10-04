# 間諜 (spyfall): one-phone re-run review

> Session `sp2-spyfall`, `--shared` (one 390x844 phone passed around a 4-seat table), 2026-10-05 16:29–16:37 UTC.
> Code under test: HEAD `328b04f` ("One-phone play: table mode, public and private gates, co-wakers…"), clean tree, so
> the line numbers below match the code that ran. Config: 1 round and 8 min (both set by the setup; the app defaults
> for 4 players are 3 rounds and 6 min), 1 spy, 24 locations, 舉手 and tracker off (the one-phone defaults, U11),
> hidden `passPhone: true`. Narration 🔊 語音 (the console's fake TTS; every cue is in `hear`). Seats: p1 阿聰 (host),
> p2 阿明 (dealer and spy), p3 小美, p4 大熊. Reviewer: opus, read-only (no code edited). Compared with the first
> one-phone run, `docs/playtest/single/spyfall.md` (session `sp-spyfall`, HEAD `16da24d`).

## Verdict

**The game finished, and the non-spies won.** 阿明, the spy, stopped the clock with 2:31 left and revealed himself. He
guessed 年宵市場, but the location was 📚 書店. Each non-spy scored +1 and the spy 0. The score matches the rules
(research "Scoring": no bonus on a wrong guess).

**This run played the main one-phone path, and it works.** Two problems from run 1 were the core of it. C1: play had
no public table screen. C2: 🙋 and 🕵️ acted as whoever's seat was on screen. Both are fixed and both came up in play:
- The phone lay in the middle for all of play. It showed the clock, one 🛑 停鐘 and the location list, and no role card.
- The spy used 🛑 → 「邊個要停鐘？」 → his own screen → 🕵️ and named a place in front of everyone.
- The look walk, the hold-to-peek cover, and the whole-table 「大家睇完」 also worked.
- No screen leaked a role.
- Questions took 7 to 70 s each, and the longer gaps were the AI players being slow. In run 1 each question took
  80–170 s while the phone went round.

Three minor issues are new:
- **N1:** the table card covers the bottom of the round reveal.
- **N2 (found in the code):** a 舉手 final vote sends the phone to the middle after every suspect and hands it back to
  the same reporter.
- **N3:** the spy's guess is a public step, so the whole table sees the place he highlights before he confirms it. The
  text on that screen also says 「你」.

Several paths were not played. A single round that the spy ended by stopping the clock never reached an accusation on
one phone, the time-up final vote, the look for a second round, or a phone-mode vote. The previous run also ended
that way. Re-run with the app defaults (3 rounds, 6 min) and make sure at least one accusation happens and one round
reaches 0:00.

## Facts from the table

| | |
|---|---|
| Location / roles | 📚 書店 · 阿聰 店長 · 阿明 🕵️ 間諜 · 小美 店員 · 大熊 簽名嘅作者 (`p4-004.png`) |
| Look walk | 16:29:39 deal cue, then the private gates go 阿聰 → 阿明 → 小美 → 大熊, each moving on after 睇完喇 (「搞掂 n/4」). 16:31:05 start cue 「大家準備好，計時8分鐘，開始！由阿明問第一條問題。」 |
| Table screen | `p4-001.png`: chip 「📱 枱中間 — 㩒你個名睇自己」, clock 7:43, 🛑 停鐘 with 「要指控或者亮間諜身分就㩒：鐘即刻停，再揀返自己個名。」, location list open, no role card, no question card (tracker off) |
| Questions (`hear`) | 阿明→小美 16:31:29 · 小美→阿聰 16:31:38 · 阿聰→大熊 16:32:12 · 阿明→大熊 16:33:26 · 阿明→小美 16:33:48 · (no answer until 16:35:34, after 阿聰's nudge at 16:35:31) · 小美→大熊 16:35:34. The phone never moved for a question. |
| Stop | 16:36:34 cue 「有人停鐘，鐘停咗。」 (anonymous, U3). 16:37:01 cue 「阿明話佢係間諜！鐘停咗，等佢喺地點清單揀一個。」 Public card 「輪到 阿明 · 間諜揀地點」. Guess 年宵市場, confirmed. |
| Result | 16:37:20 cue 「非間諜贏：間諜估錯地點。地點係書店，間諜係阿明。」 Round reveal behind the table card (`p1-003.png`, `p3-002.png`), then 「大家睇完」, then the room results (`p2-007.png`). |
| `lastResult` | winners `[p1, p3, p4]`, points p1 1 / p2 0 / p3 1 / p4 1, summary 「阿聰、小美、大熊 同分奪冠，各 1 分」, lines 「第 1 局 📚 書店（間諜：阿明）— 非間諜贏：間諜估錯地點 · 阿聰 +1、小美 +1、大熊 +1」, 「阿明 停鐘亮身分，估咗「年宵市場」，真正地點係 📚 書店。」, 「每個非間諜 +1。」 |
| Final state | `room.phase: results`, `activeSeat: null`, `focus: null`. `history` has one entry. Config as above. |

## Fixed since run 1

| run 1 | status | evidence |
|---|---|---|
| C1 no public table screen in play | **fixed, played** | Table mode: the shell mounts the UI with `api.me = null` (DESIGN §7.1). The spyfall table screen is `ui.js:355-368`, and the list stays open there (`ui.js:731`, `:739`). The screen matches `p4-001.png`. |
| C2 🙋 / 🕵️ act as the seat on screen | **fixed, played** | One 🛑 → `stop` (`game.js:1213-1223`, which freezes the clock at once, U3) → `askWho` (`ui.js:332-344`) → the seat's own screen with 🙋 / 🕵️ / 「取消 · 繼續計時」 (`ui.js:384-416`). A seat screen reached by 揀名 offers no 🙋 / 🕵️ (`ui.js:375-381`). 阿明 went through exactly this path. |
| C3 a new round's look / phone-mode vote opens ungated | **fixed in code, not played** | `play.js:587-650` opens the private gate on every change of the focus signature, also for the seat already on screen (#2). roundEnd puts the phone in the middle, so the look for round 2 starts from a gate. |
| C4 config ignores `singleDevice` | **fixed, played** | `game.js:305-312`: 舉手, tracker off, `passPhone`. There is a warning at `:360`, and the help at `:401` covers both options. `configApplied` showed `voteMode: "hands"`, `tracker: false`. |
| C5 「睇完 0 / 4 · 等緊…」 but one tap closes it | **fixed, played** | On a whole-table phone the button reads 「大家睇完 ✓（一下就得）」 with no waiting list, and it is locked while the table card is up (`ui.js:626-668`, U5). |
| C6 copy that assumes one phone each; strikes on the table | **fixed** | `game.js:153` and `:217`, `ui.js:585`. The table screen strikes nothing (`ui.js:572-574`, `:599`). |
| C7 no one-phone rules section; wrong 💡 hint | **fixed** | The 一部手機玩 section is at `game.js:222-227`. The tracker-off hint 「…覺得邊個係間諜，可以停鐘指控。」 is at `game.js:1451`. |
| C8 「發問中」 on the person still answering | **fixed** (not seen: tracker off) | `ui.js:299` 「輪到」. |
| C9 「（你）」 on a shared phone | **fixed** | `seatName` is at `ui.js:94`, the is-me row at `ui.js:639`, and the 「你 N 分」 pill is gone at `ui.js:166-171`. The results screen (`p2-007.png`) shows none. |
| SUMMARY #1, #2, #5, #13, #21, #22 (spyfall strikes), #31 · U3, U4, U5, U11 | **applied** | as above |

## Still open from run 1

- **Coverage, not a code defect.** These paths were not played in either run: an accusation on one phone (🛑 → 🙋 →
  the 舉手 reporter as a public step), the time-up final vote, the look for a second round, and a phone-mode vote. The
  code for them reads correctly, except for N2.
- **Tooling T2.** A tap by text still takes the first match even when that control is COVERED (`pt.mjs:687`).
- **Tooling T6.** The setup again set `rounds: 1, minutes: 8`. That is why no round reached 0:00 and no second round
  was dealt.

## New confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| N1 | minor | one-phone ux | The table card hides the bottom of the round reveal | At roundEnd the phone goes to the middle behind 「📱 部手機擺返中間 · 擺喺枱中間 · 大家一齊睇 · 👀 大家睇緊 · 㩒一下」 (DESIGN §7.1 rule 2, U4). The card sits at the bottom and is about 200 css px tall. It hid 大熊's row and the 大家睇完 button (`p1-003.png`, `p3-002.png`; p1 and p3 both reported it). The backdrop takes every touch and the page cannot scroll, so the table cannot read the whole score table until someone taps. Here the phone was already public, because the guess was an `open` step, so the card adds nothing. | `PassGate.js:61` (`lockScroll()` for every kind, including `table`); `base.css:607-614` (a full-screen backdrop plus a bottom card for the public kinds); `play.js:499-517` (`openTableCard`), `:627` | Keep U4's one tap, but stop the card hiding content. Give `kind: 'table'` a compact one-row variant (icon, 「部手機擺返中間」 and the button, about 64 px). Do not lock scroll for `table`, and let vertical scrolling through the backdrop. Taps are already refused by `ctx.tableLocked` and `tableSend` (U5), so the backdrop does not need to swallow scrolls. Add bottom padding to the page while the card is up, so the last row can scroll above it. | shell |
| N2 | minor | one-phone flow (from code) | 舉手 final vote: after every suspect the phone goes to the middle, then the same reporter gets it back through a new card | `focus()` has no `tally` case (`game.js:1375-1391`). `closeVote` clears the vote, and `s.tally` does not keep the reporter (`game.js:925-931`). After each 舉手 result the focus signature changes from [reporter, open] to none while the reporter holds the phone, so the shell opens the table card (`play.js:627`). The next suspect's public card waits for that card (`play.js:609`). Then it opens 「輪到 阿明 · 最後投票 3/4」 for the person already holding the phone. The final vote goes dealer first, and the reporter is the dealer except for the dealer's own vote. With 4 players a full final vote therefore adds up to 3 table cards and 2 public cards that hand the phone to its holder. With 8 players it is 7 + 6. A mid-round accusation is fine: the phone should go to the middle when the clock restarts. | `game.js:1375-1391`, `:925-931` | Keep `reporter` in `s.tally` for 舉手 votes. In `focus()`, return `{ pids: [s.tally.reporter], open: true, label }` while a 舉手 final-vote tally is showing. The signature then stays the same across suspects with the same reporter, so no card appears. A new reporter gets one public card. roundEnd and a failed accusation still put the phone in the middle. The role card stays hidden because the step is still `open` (`ui.js:92`, `:555`). Add an engine test and a shell walk test. | spyfall engine |
| N3 | minor | integrity / text | The spy's guess is public, so the table sees the highlighted place before he confirms it, and the text says 「你」 | The guess focus is `open` (`game.js:1389`; spec §4 "spy stop"). On the spy's screen the UI highlights the place he taps and shows 「🕵️ 你揀咗邊個地點？」 and 「你揀咗「年宵市場」。想改就㩒第二個，確定就㩒底部嘅掣。」 (`ui.js:533-541`). The whole table reads it. The spy can tap 書店, watch the others' faces, then switch before confirming. At a real table the spy names one place, once. p1 reported the 「你」 text; p3 reported the text and the visible highlight. | `game.js:1389`; `ui.js:533-541` | **For the user to decide.** (a) Recommended: on a shared phone, make the guess a private step. Drop `open: true` from the guess focus; only shared phones read it, so multi-phone play does not change. The spy then gets 「交俾 阿明 · 其他人唔好望 · 間諜揀地點」 and picks alone. The pick shows in the reveal and is read out, and the 「你」 text becomes correct. A second spy forced out is still named on the gate, which is what the rules want. (b) Keep it public, but on a shared phone write the text in the third person (「阿明 揀緊地點…」) and drop the highlight: one tap picks, with a short undo. Option (b) still shows the pick, so it reduces probing but does not stop it. Update spec §3.5 and §4. | spyfall ui + engine, spec |

## Checks that passed (one-phone specifics, from code and play)

- **Look hand-over order.** The game starts with the phone in the middle. `walkOrder` goes clockwise from the host:
  阿聰 → 阿明 → 小美 → 大熊, as every report says. A later round's look starts clockwise from the last holder (#17).
- **Privacy of each hand-over.** `openGate` closes every cover and puts the table view behind the gate
  (`play.js:434-446`). The private gate is opaque from its first frame. When the spy's own screen turned into the
  public guess step, it went through a public card with the table view behind it, so no role card was ever on show
  (`ui.js:555`, `openStep`).
- **The stop shows no role.** Every stop is the same anonymous 🛑 with the cue 「有人停鐘」. Then comes the same name
  list and the same 🙋 / 🕵️ / 取消 screen. A non-spy's 「我係間諜，停鐘」 closes the panel and sends nothing
  (`ui.js:393-397`). A cancelled stop restarts the clock at the exact time it stopped (`game.js:1225-1231`).
- **No step waits on a seat that never gets the phone.** The look walk, the 舉手 reporter (open) and the guesser
  (open) are all `focus` gates with the host's 「X 唔喺度？」 row. roundEnd is one tap for the whole table. Play has no
  focus.
- **Text that assumes one phone each.** None is left in spyfall (`grep 手機|部機` in `game.js` / `ui.js`). The deal cue
  「每個人㩒住張卡睇自己嘅身分」 still fits a phone that is passed round.
- **The 💡 hint on the table phone** is built with no seat (`hintOf(s, null)`). It is the same for every role and
  anyone can close it.
- **Night anti-tell.** Not applicable: spyfall has no night and no eyes-closed step.

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p1 | 1 round, 8 min instead of 3 rounds, 6 min | rejected (setup) | `configApplied {"rounds":1,"minutes":8}` came from the setup. `defaults(4)` gives 3 rounds and `recommendedMinutes(4)` = 6 (`game.js:237-239`, `:283-284`). See tooling T6. |
| p1 | Anyone can tap 「▶ 繼續計時」 / 取消 before the stopper picks a name | app-is-right (U3, spec §4 step 3) + AI artifact | The spec says a stop closed without a name resumes the clock. Anyone can tap 🛑 again at once, and `stop` has no per-player limit (`game.js:1213-1223`), so a nervous neighbour costs the stopper one tap and cannot take away the right to reveal. At a real table the person who tapped 🛑 is at the phone and picks their name in about 2 s. The 25 s gap was AI pace. |
| p1 | The 💡 sheet in the middle covers the table controls | no change | Its text is the same for every role (`hintOf(s, null)`) and anyone can close it (✕). It opens only when someone taps 💡. |
| p1 | Second 「tap 開始 ▶」 exited with "no control matching" | tooling (TT4) | The lobby lies face up and any seat may tap it. The preflight sheet has its own 開始 ▶ (`preflight.js`, `onGo`). When p1 tapped again the game had already started, and the error printed that new screen. |
| p2 | No Q&A tracker on the shared phone | app-is-right (U11) | The user decided the tracker is hidden by default on one phone (`game.js:305-308`, spec §2). It can be turned on with 顯示邊個問緊. |
| p2 | No "waiting for X" while a question is unanswered | app-is-right + AI artifact | The app never follows the spoken Q&A (spec §1: "The app never listens to or mediates them"). 小美's 1:46 silence came from losing the question in a long `wait` output (p3's own note, TT2). |
| p2, p4 | A hint sheet popped up by itself at the round end | rejected (AI artifact / tooling) | The 💡 sheet opens only from 💡 (`play.js:102`) or the ⋯ menu (`play.js:900`); nothing opens it on its own. `p2-005.png` shows it open at roundEnd, so some seat tapped it. The likely cause is a stale numbered tap on the shared phone (TT1). |
| p3 | The phone shows who stopped the clock (「📱 阿明 拎緊部手機」) before the reason | app-is-right | A stop is public by the rules (research Procedure 8), and the hand-over has to name the holder. The reason stays hidden until the public step, which is the U3 design. An accuser and a spy take the same path. |
| p3 | `hear <session> 30` ignores the window | tooling misread (TT3) | `hear [n]` is a line count, not seconds (README; `pt.mjs:1029-1032`). |
| p4 | The narrator never spoke | tooling | Headless Chrome has no audio. 🔊 語音 ran on the fake TTS, and every cue is in `hear` (`🔊 旁白：…`). The 「（暫時冇旁白）」 that p2 saw is the narrator bar's idle text. |
| p4 | Accusation and voting not tested | coverage, not a finding | Correct, and the same as run 1. See "Still open" and the re-run advice. |
| p4 | 小美 was slow to answer | AI artifact | See p2 above. |

## AI artifacts (not app bugs)

- **Stop latency.** 25–27 s passed between 🛑 (16:36:34) and the reveal cue (16:37:01) while the console seats queued
  on one phone. A human needs a few seconds.
- **Lost question.** 小美 missed 阿明's question for 1:46 because it was at the end of a truncated `wait`.
- **Inaccurate reports.**
  - p4's `couldUse` is inverted again: false for things p4 did (peek, list, Q&A) and true for votes never reached.
  - p2's timeline is about 30 s early: it reports the stop at 16:36:05 and the result at 16:36:20, while the cues are at
    16:36:34 and 16:37:20.
  - p4's "hold-to-peek lasted exactly 1500 ms" describes the console's hold, not the app.

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | evidence | fix |
|---|---|---|---|
| TT1 | Numbered taps on a shared phone are racy | `resolve()` re-reads the screen and renumbers at tap time (`pt.mjs:682-689`). A `tap 3` from a seat whose last `see` came before another seat acted hits whatever is [3] now. This is the likely source of the "auto" 💡 sheet. | Under `--shared`, remember each seat's last-seen screen hash. Refuse a numbered tap when the hash has changed since that seat looked: 「畫面喺你上次睇之後變咗 — 再 see 一次」. |
| TT2 | `wait` puts new table talk last | `wait` prints the full screen (the location list alone is hundreds of lines), then 「said at the table while you waited」 (`pt.mjs:993-1006`). A `tail` cuts the talk off. | Print the talk first and the screen after, or add `wait --talk` (talk plus a one-line screen summary). |
| TT3 | `hear [n]` read as seconds | p3 ran `hear … 30` expecting 30 s | Say "last n lines" in `help`, or accept `hear 30s` as a time window. |
| TT4 | A label tap that misses because another seat already acted exits 1 | p1's second 「開始 ▶」 | Under `--shared`, if the screen changed since this seat's last look, say so and exit 0 with the new screen. |
| T2 (run 1) | still open | `pt.mjs:687`, first match even if COVERED | Prefer matches that are not COVERED or disabled. |
| T6 (run 1) | still open | `configApplied {"rounds":1,"minutes":8}` | Use the app defaults (3 rounds, 6 min for 4) so a round can reach 0:00 and the look for round 2 runs. |

## Fix list for the orchestrator (priority order)

1. **N2** (S): keep the 舉手 reporter in focus through a final-vote tally (`game.js:925-931`, `:1375-1391`), with tests.
2. **N3** (S, needs the user's decision): make the guess private on a shared phone (recommended), or third-person
   text with no tentative highlight.
3. **N1** (S–M, shell): a compact table card that does not lock scrolling, so a public screen behind it can still be
   read.
4. **Tooling** TT1, TT2 and T6 (then TT3, TT4, T2). Then re-run one-phone spyfall with the defaults (3 rounds, 6 min),
   making sure there is at least one 🛑 → 🙋 accusation and one round that reaches 0:00 (final vote).
