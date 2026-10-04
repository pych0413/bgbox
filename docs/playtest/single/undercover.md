# 誰是臥底 (undercover): one-phone playtest review

> Session `sp-undercover`, `--shared` (ONE 390x844 phone passed around a 5-seat table), 2026-10-04 05:57–06:12 UTC.
> Build under test: `https://pych0413.github.io/bgbox/` build `20261004005209`, which matches local HEAD `16da24d`, so the
> line numbers below are the code that ran. Config: game defaults (std preset 平民 4 · 臥底 1, parity, PK, no timers),
> narration 🔇 靜音. Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強. Reviewer: opus, read-only (no code edited).

## Verdict

**Finished, but the one-phone flow failed at its core.** The game ran end to end in about 14 minutes and civilians won
in round 1, but only **one clue of five** was given during the speaking round. The discussion was ended by one tap, and
**4 of 5 players never saw the vote reveal**. Most of the damage came from the console (non-holders could not see the
public screen) and from an AI holder tapping through other people's turns. Underneath that are three real one-phone gaps
in the app:

1. After a private hand-around ends, nothing tells the table to put the phone in the middle (C1, C2).
2. The first ballot after a public step has no pass gate (C3).
3. The deal narration still says 「用自己部手機」 (C4).

Everything private worked: the deal, the hold-to-peek card that locks again after each peek, the gates and the secret
ballots. No step waited on a seat that could never get the phone.

## Facts from the table

| | |
|---|---|
| Roles / words | 平民 熨斗: 阿聰, 阿明, 小美, 阿強 · 臥底 衣車: 大熊 (category 屋企用品) |
| Speaking order (engine) | `starter: p1`, order p1 → p5. **阿聰 was first to speak, but the phone was in 阿強's hands** (the last seat dealt) |
| Clues at the table (`hear`) | Only 阿強 gave a clue during the round (06:04:23 「去皺紋嘅熱手工具」). 阿聰 (06:05:56) and 小美 (06:08:16) spoke up later, during the vote, to complain they had not had a turn. 阿明 and 大熊 never gave a clue |
| Discussion | `want: {p5, p1, p2, p3, p4}`: 阿強 tapped 開始投票 first, and that one tap was counted for all four other seats on the phone |
| Ballots (round 1) | 阿聰→小美, 阿明→大熊, 小美→大熊, 大熊→阿聰, 阿強→大熊 → 大熊 out (3 votes) |
| Vote walk | 阿強 voted **with no gate** (`p1-001.png`: 「已投 1 / 5 · 仲未投：阿聰、阿明、小美、大熊」), then gates 阿聰 → 阿明 → 小美 → 大熊 |
| Result screen | `seen: {p4, p1, p2, …}`: 大熊 tapped 睇完 and it counted for everyone. The game went to `over` at about 06:12 |
| Final | 平民贏 (`allOut`), +2 for each of the four civilians. Result line 「平民一個自己人都冇投錯！」 even though 阿聰 voted for 小美 |

Timeline (UTC): 05:58 everyone ready, host taps 開始 → 05:58–~06:03 deal walk p1→p5 (correct table order, slow AI holds)
→ 阿強 holds the phone through speak (taps 「阿聰/阿明/小美/大熊 講完喇」, gives his own clue 06:04:23) and discuss (one tap)
→ ~06:05 阿強 votes with no gate → 06:05–06:11 gated ballots 阿聰, 阿明, 小美, 大熊 → 大熊 sees the reveal alone and taps
睇完 → 06:12 results laid in the middle (console auto-show).

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| C1 | major | one-phone flow | After the deal the phone never goes to the middle: the last seat dealt keeps the public screen | When the last 記住喇 lands, `focus` becomes `null` (by design: speak and discuss are public). The shell closes the gate and leaves the screen on the last seat dealt (阿強). No card or line tells the table to lay the phone down. The rules sheet says to (「發言時部手機放喺枱中間」, `game.js:173`) but the screen does not, and in 靜音 nothing is spoken. In this match the starter was 阿聰 while 阿強 held the phone. 阿強 pressed 「阿聰 講完喇」 … 「大熊 講完喇」 with nobody speaking, so the round had one clue. The tapping-through itself is an AI artifact, and the other seats could not see the screen because of the console (T1). But a human who gets the phone last and sees 「阿聰 講緊…」 is also never told to put it down, and the spec's whole speak/discuss design (§4 「The phone sits in the middle」) depends on that | `js/ui/screens/play.js:344` (`!here.length` → close the gate, keep `activeSeat`; nothing marks the switch from private to public); `js/games/undercover/game.js:1448-1461` (`focus` null in speak/discuss/elim) | Shell, generic: on a phone holding 2+ seats, when `focus` goes from naming this phone's seats to none during play (not night), show a public card 「放喺枱中間 · 大家一齊睇」 that anyone can tap and that switches no seat. Optionally let a game opt in or out through `focus` (e.g. `{ pids: [], table: '…' }`). This also fixes C2 | shell (`play.js` evaluateFocusGate) |
| C2 | major | one-phone flow | The vote result shows only on the last voter's screen, and their one 睇完 closes it for the whole table | vote → elim: `focus` goes null, so the reveal (tally plus who voted for whom) opens in the last voter's hands. Here that was 大熊, the undercover. Their 睇完 is sent with every other seat on the phone (`withMates`), and the button unlocks after only 1.5 s. State `seen` lists p4 first, then everyone else. 阿聰, 小美 and 阿強 report they never saw the reveal, only the final totals. Spec §3.6 / D3 makes the open ballot the moment that 「ends the 我冇投你 arguments」 and waits for **every** seat's 睇完, which a shared phone turns into one person's tap | `js/games/undercover/ui.js:403` (`withMates({ type: 'continue' })`), `ui.js:27` (`LOCKOUT_MS = 1500`), plus C1 (no middle card) | The C1 card covers the hand-off. Also, on a phone that holds every seat, keep 睇完 locked until that card has been dismissed (or lengthen the lockout to ~4 s there), so the reveal is laid down before anyone can close it | shell + undercover ui |
| C3 | major | privacy / integrity | The first ballot after a public step has no pass gate | `evaluateFocusGate` opens no gate when `focus` already names the seat on screen. In a vote, `focus` = every voter, and the seat on screen (the last holder) is one of them, so 「開始投票」 jumps straight to **that seat's private ballot**. Seen in this match: 阿強 voted ungated (`p1-001.png`). At a real table the phone is in the middle during discuss and anybody may tap 開始投票 (spec §4). Whoever taps it now holds 阿強's ballot with only the small 「而家睇：阿強」 chip as warning. They can cast it by mistake thinking it is their own, and 阿強's pick (「X ●」) sits on a public screen. This happens again every round (the next vote starts on whoever tapped 睇完) and contradicts spec §4 (「sequential private ballots, each behind a gate」). It also affects other games: any private walk that starts on a public screen | `js/ui/screens/play.js:344` (`here.includes(seat)` → no gate) | Remember whether the previous step was public (no `focus` seat on this phone, or a different step signature). When a private walk starts from a public step, gate the seat on screen too: 「交俾 阿強 · 其他人唔好望」. The lobby → deal start gets the same gate, which is harmless | shell (`play.js`) |
| C4 | minor | text | The deal narration (and rules step 1) say 「用自己部手機」 at a one-phone table | Cue 「準備開始。今局有 4 個平民、1 個臥底。大家用自己部手機睇詞語…」 was read on the shared phone. Rules 點玩 step 1 says the same, which contradicts the 單機玩法 section two screens later | `js/games/undercover/game.js:917` (cue `deal`), `game.js:128` (rules) | Neutral wording that fits both: cue 「準備開始。今局有 …。逐個睇自己個詞，記住就㩒「記住喇」。」. Rules: 「每人睇自己個詞（一人一部機，或者一部機輪流傳）…」. Update `docs/games/undercover.md` §3.2 | undercover |
| C5 | minor | text | 「平民一個自己人都冇投錯！」 is false when a civilian voted for a civilian | The line fires when no civilian was **voted out**. Here 阿聰 (civilian) voted for 小美 (civilian) and the line still said nobody voted wrong. p1 and p3 both flagged it | `js/games/undercover/game.js:1175` | 「平民一個自己人都冇投走！」, which mirrors line 1174's 「平民投走咗 N 個自己人」. Update `tests/undercover.test.mjs:1431` and spec §5.6 line 4 | undercover |
| C6 | minor | privacy (from code) | 「睇返我個詞」 on the public screen lets anyone read the on-screen seat's word | During speak, discuss and elim on a shared phone, the word box offers 「🃏 睇返我個詞（淨係 阿強 本人好㩒）」 for the seat on screen. The phone is meant to sit in the middle then. Anyone can toggle it, tap 🔓 and hold, and learn 阿強's word (and so whether 阿強 is the odd one out). Only the label guards it. Spec §4 says the re-peek goes through a hand-over card, but the seat already on screen skips it. Not tried in this match | `js/games/undercover/ui.js:609-628` | On a shared phone, the button first opens a pass gate for that seat (a shell API such as `api.handTo(pid)` → `openGate('switch', …)`, even for the current seat), then shows the card | shell + undercover ui |
| C7 | polish | ux | The results / lobby scoreboard marks the last holder 「（你）」 on a shared phone | The shared results screen read 「大熊（你）」: the undercover, marked as "you" on a screen the whole table reads | `js/ui/screens/results.js:286`, `js/ui/screens/lobby.js:525` (`me: st.activeSeat ?? …`) | `me: (st.mySeats?.length ?? 0) > 1 ? null : …` | shell |
| C8 | polish | ux | The pass gate does not say what step it opens onto | Someone handed the phone during the vote walk lands on a ballot with no context (p3: 「交俾 小美 · 其他人唔好望」 → 「第 1 輪 · 投票 · 已投 3 / 5」) | `js/ui/screens/play.js:350`, `:357` | Add the public step to the subtitle, e.g. 「其他人唔好望 · 第 1 輪投票」, taken from the public header. It is the same for every seat, so it is no tell. Skip it on anonymous (night) gates | shell |

## Checks that passed (one-phone specifics read from code and play)

- **Deal hand-over order:** the gates follow table order of unconfirmed seats (`game.js:1450-1452`). The host who tapped
  開始 peeks first; then 阿明 → 小美 → 大熊 → 阿強, matching every report.
- **Deal privacy:** `openGate` calls `closeAllCovers()` before the gate. The card locks itself after 記住喇 and, on a
  shared phone, after every peek (`ui.js:115`). Every gate is the same card: 「交俾 X · 其他人唔好望」.
- **Vote privacy:** each later ballot is behind a gate. `secretChoice` shows 「已投 ✓」, never whom. The public line
  shows only who has and has not voted. The exception is C3.
- **No step waits forever on a seat:** deal, vote and the white-card guess walk the phone through `focus` gates.
  講完喇, 開始投票 and 睇完 count for every seat on the phone (`ui.js:274`, `:314`, `:403`). So no seat that never gets
  the phone can stall the game.
- **Night anti-tell:** not applicable (no night). The white card's card is the same size and place, but this match had
  no white card, so that was not exercised.
- **Over screen:** clear: both words, roles, every vote, points, 「佢一開始都唔知自己係臥底」.

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p1, p3 | 「開始投票」 one tap bypasses the D2 majority on a shared phone | app-is-right | Spec §4: 「開始投票」 sends `seats: [the other seats on this phone]`, 「so one tap counts for every alive seat the phone holds (a phone holding the whole table opens the vote with one tap, as before)」. §9 repeats it, and the multi-phone fix list chose it: 「A shared phone keeps the single tap」. With the phone in the middle the tap is a visible table act. Here it looked like one person deciding because nobody else could see the screen (T1). Optional, for the user to decide: on a phone that holds **every** seat, make it arm-then-confirm, 「全枱傾夠未？再㩒一次開始投票」 |
| p4, p5 | No clue log / the clues are not shown on screen | app-is-right | Spec §1: 「the clues are **spoken aloud**」. §9: 「No foul button / clue log: clue legality is social」. The app never hears a clue |
| p1, p2, p3, p4 | The speaking round was skipped / players never got a turn | merged → C1, rest AI-artifact + tooling | The app showed the right turn (`starter p1`). The holder 阿強 tapped 「X 講完喇」 for four people who could not see the screen. A human holder reading 「阿聰 講緊…」 would look at 阿聰. The app part is C1 |
| p5 | Vote tally never shown | merged → C2 | |
| p4 | Deal needs a 60 s auto-timeout | AI-artifact | Spec §3.2: 「No timer. A seat that never confirms blocks the game: the shell's stall prompt … offers 『代佢做』」. The holds of 60–240 s were AI pace |
| p2 | 180 s 「hang」 during the deal | AI-artifact | Same: AI holders were slow. The deal screen shows 「已有 2 / 5 人記住咗 · 等緊：…」 to whoever holds the phone |
| p5 | The game 「stalled ~3 min after voting」, phone 「cycling」 | AI-artifact + tooling | That was the gated vote walk (阿聰 → 阿明 → 小美 → 大熊) at AI pace. Non-holders could not see 「已投 n / 5」 (T1/T2) |
| p2 | Tapping 「而家睇：阿明 換人 ⇄」 refused with 「你唔可以掂部手機」 | tooling, working as intended | p2 did not hold the phone. The referee correctly refuses touches from non-holders (`pt.mjs:695`) |
| p2 | 小美 saying she never got the phone is an 「information leak」 | not a finding | Who held the phone is public at any real table |
| p3 | The pick 「大熊 ●」 is visible before 確定投票 | app-is-right | The voter has to see the pick to confirm it. The gate says 其他人唔好望, and D6 hides the pick once it is confirmed |
| p3 | 熨斗 / 衣車 is too far apart | rejected | 衣車 is a sewing machine. Both are electric appliances for clothes (category 屋企用品). 阿聰's 「插電…處理衫」 fits both. Only 發熱 / 皺紋 tell them apart, which is how the game is meant to work. One sample |
| p5 | 「佢一開始都唔知自己係臥底」 is confusing | app-is-right | Spec §1: 「**Nobody is told their role** — you only see your word」. The line teaches exactly that |
| p4 | The gate does not show who holds the phone | merged → C8 | The gate names the receiver, and the 「而家睇：X」 chip names the holder |

## AI artifacts (not app bugs)

- 阿強 (p5, holding the phone after the deal) tapped 「阿聰 / 阿明 / 小美 / 大熊 講完喇」 without waiting for anyone to
  speak, then tapped 開始投票 alone. He never used `show` or `say` to call the next speaker.
- Holds of 60–240 s per seat in the deal and the vote walk.
- Report quality: p2's rights checklist has `couldUse` inverted (for example 「Private word viewing … couldUse: false」 with the
  note 「Successfully held to reveal」). p4's timeline is off by about 10 min (deal 「06:13」). p5's report says
  「all 5 players delivered」 a clue, which the `hear` log and the engine state contradict. p5 was the holder who tapped
  through. The haiku seats' reports need checking against `hear` / state before anyone trusts them.

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | evidence | fix |
|---|---|---|---|
| T1 | Public steps are hidden from non-holders unless the holder runs `show` | `pt.mjs:458-461`: with no gate and not dark, every non-holder gets 「📱 阿強 拎緊部手機」. The spec puts the phone in the middle for speak, discuss and elim. No AI holder ran `show`, so four seats were blind for ~8 min. Only `results` is auto-shown (`:457`) | In `--shared`, while the room is playing, with no gate, not dark and `focus` without pids (a public step), treat the phone as on the table: `see` / `shot` read-only for every seat, and let any seat `tap` (the spec says anyone presses 講完喇 / 開始投票 / 睇完). Keep `hold` / `type` for the seat on screen, so the C6 peek still needs the holder. Revert at the next gate or focus |
| T2 | `wait` never wakes for a non-holder when the public stage changes | `pt.mjs:582` keys the wait on `g.why`, which is the same 「拎緊部手機」 line from deal to vote. p1, p3 and p5 all saw only 「(nothing changed in 60 s)」 | Put the public header (title + subtitle, e.g. 「第 1 輪 · 投票」) and `phase` into the refusal text and the wait key, so a stage change wakes `wait` and tells the seat where the game is |
| T3 | `wait` max 120 s equals the agents' Bash default timeout | `pt.mjs:578` (`Math.min(120, …)`). p2's calls timed out and went to the background | Cap at 90 s, or tell players in the README to use `wait 60` |
| T4 | Silent narration hides turn calls at a one-phone table | Setup used 🔇 靜音. A speaking phone in the middle would say 「輪到 阿明。」 to everyone | For one-phone runs default to `--narration read`, and have the console echo each new cue into `hear` as 「[旁白] …」 (what the table hears) |

## Fix list for the orchestrator (priority order)

1. **C3** (shell, `play.js:344`): gate the seat on screen when a private walk starts from a public step.
2. **C1 + C2** (shell `play.js` + undercover `ui.js:403`): a 「放喺枱中間 · 大家一齊睇」 card when a shared phone's focus
   empties. On a whole-table phone, 睇完 stays locked until that card is dismissed.
3. **T1 + T2** (pt.mjs): auto-show public steps and wake `wait` on stage changes, then **re-run this one-phone match**.
   Without these, the console cannot test the speaking round.
4. **C4, C5** (undercover text, plus test `tests/undercover.test.mjs:1431` and spec §3.2 / §5.6).
5. **C6** (shell API + undercover ui), **C7, C8** (shell polish), **T3, T4**.
