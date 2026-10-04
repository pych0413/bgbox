# 假畫家 (fake-artist): one-phone playtest review

> Session `sp-fake-artist`, `--shared` (ONE 390x844 phone passed around a 5-seat table), 2026-10-04 09:39–09:55 UTC.
> Build under test: `https://pych0413.github.io/bgbox/` build `20261004005209`, which matches local HEAD `16da24d`, so the
> line numbers below are the code that ran. Config: 📱 手機畫板, 手機出題 (app QM), 2 laps, tie `must-guess`, 開口估,
> points, **1 round** (`endMode: rounds`), random first drawer, no stroke clock, narration 🔇 靜音. Seats: p1 阿聰 (host),
> p2 阿明, p3 小美, p4 大熊, p5 阿強. Reviewer: opus, read-only (no code edited).

## Verdict

**Finished, and the rules held. But on one phone the app hides the one thing this game is about: the picture.**
The round ran end to end (about 11–15 min at AI pace). The deal, the 10 strokes in order, the 5 secret ballots, the
tally (`must-guess`: top = {大熊}, the fake was not in it, so the fake escaped) and the +2 all matched the verified
rules. No secret leaked at any hand-over, and no step waited on a seat that could not get the phone.

Underneath that are five real one-phone gaps:

1. Every stroke is handed over with the **private** pass gate 「交俾 X · 其他人唔好望」, which covers the screen. So the
   table is told 18 times a round **not** to watch a drawing that the rules make public (F1).
2. The vote starts in the last drawer's hands **with no gate and no shared look at the finished picture**. This is the
   shell gap already found in undercover (C3) (F2).
3. The ballot walk goes backwards: 阿明 (seat 2) votes first, then the phone goes back to seat 1 (F3).
4. The tally and the round result open in the last voter's hands, and that one person's 睇完 closes the round for
   everyone. Only the 1-round config hid this here (F7).
5. Several lines assume one phone per person or a simultaneous vote: 「其他人即時睇到」, 「畫完同時投票」 and the cue
   「三、二、一，投！」 (F5).

The guess / judge path and the tie rule were not reached (the fake was not caught). The code review of that path found
one more one-phone gap (F6).

## Facts from the table

| | |
|---|---|
| Word | 「飯糰」, theme 日本食物 (public). Fake: **阿聰** (p1, also the host, held the phone first) |
| Deal walk | 阿聰 (no gate, he held the phone) → gates 阿明 → 小美 → 大熊 → 阿強, in table order. All 4 gates named the right seat |
| Drawing | Random first drawer 小美. Order 小美 → 大熊 → 阿強 → 阿聰 → 阿明, twice (10 strokes, 1 per turn). A gate before every stroke (10 gates). The phone went from 阿強 (last card) to 小美 |
| Vote walk | **阿明 voted first with no gate** (the last drawer: p1's screen showed 「已投 1/5」 when he got it). Then gates 阿聰 → 小美 → 大熊 → 阿強. So the phone went seat 2 → seat 1 → 3 → 4 → 5 |
| Ballots | 大熊 2, 阿聰 1, 阿強 1, 小美 1 (p1→大熊, p2→阿聰, p3→大熊, p4→阿強, p5→小美) → top = {大熊} → 「最高票唔係假畫家」 → escaped |
| Score | 阿聰 +2 (no QM share in app-QM mode), everyone else 0. `lastResult.winners = [p1]`, 「阿聰 贏咗，共 2 分」 |
| Table talk | 09:49:10 阿聰 (fake) described his stroke. 09:53:04 阿聰 accused 大熊 aloud **while the ballot walk was still going** (小美 and 大熊 had not voted) |
| End | `room.phase = results`, `activeSeat = p5` (the last voter, so the scoreboard shows 「阿強（你）」) |

Timeline (UTC): 09:39–09:42 everyone ready → 09:43 開始 → 09:43–09:47 deal walk → 09:47–09:52 two laps, 10 gated
strokes → ~09:52 阿明 votes ungated, then 4 gated ballots → ~09:54 tally and round result in 阿強's hands; his 睇完 ends the
game → 09:55 shell results (the console lays them face up).

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| F1 | major | one-phone flow / text | Every stroke hand-over is a private gate that says 「其他人唔好望」 and hides the public picture | Research, Procedure step 7: drawing is 「PUBLIC (everyone watches the sheet)」. The one-phone note says to hand the phone round, one stroke each. Spec §1: 「everybody watches the line appear live」. On one phone the shell opens the same full-cover gate before every stroke as for the secret deal: 「🔒 交俾 小美 · 其他人唔好望 · 準備好喇，㩒一下」. It shows the instant the pen lifts, so nobody gets a look at the stroke just drawn. The wording tells the table to look away from the picture for the whole round. p3: 「At my second turn (stroke 6/10) the shot showed 5 strokes I had never seen drawn」. p1: 「a gate cancels show, so I could not lay the phone face up after my own stroke」. The draw screen holds no secret except the closed 「㩒住睇返我張卡」 cover, so the gate protects nothing that the cover does not already protect. Reported by p1 (minor ×2) and p3 (major ×2), merged | `js/ui/screens/play.js:344-350` (`evaluateFocusGate`: any named focus on another seat → `openGate('auto', …, { subtitle: '其他人唔好望' })`); `js/core/room.js:87-99` (`filterFocus` passes only `pids` / `anonymous` / `together`, so an engine cannot mark a step public); `js/games/fake-artist/game.js:1304` (draw focus is a plain `{ pids: [drawer] }`) | Engine: `focus` for `draw` returns `{ pids: [drawer], open: true }` (a public turn). Core: `filterFocus` passes `open`. Shell: for an `open` focus on a shared phone, use a light hand-over that does not cover the canvas, e.g. a bottom banner 「輪到 ● 小美 畫 · 大家一齊睇 · 小美㩒一下開始」. The tap switches the seat and arms the canvas. Keep 「其他人唔好望」 and the full cover for deal, vote, guess and judge. On a public screen the 「㩒住睇返我張卡」 cover belongs to whoever is on screen, but anyone at the table could hold it. So hide it during `open` steps on a shared phone, or route it through a gate (undercover C6's `api.handTo`). Update spec §4 (「交俾 阿B ・ 其他人唔好望」 → the public wording) | shell + core + fake-artist |
| F2 | major | privacy / one-phone flow | The first ballot opens in the last drawer's hands with no gate, and nobody gets a shared look at the finished picture | After stroke 10/10, `startVote` sets focus = every voter. The last drawer is on screen and is one of them, so the shell opens no gate and 阿明's **private ballot** replaces the canvas at once. At a real table everyone leans in to watch the last stroke (and they should, see F1), so they then see 阿明's pick (「大熊 ●」 before 確定投票). Nothing marks the switch from drawing to voting: p3 got 「交俾 阿聰」 with no vote wording and 「no public cue that drawing is over」. p1: 「the vote starts right after the last stroke with no talk or accusation window」. The official booklet goes straight to the 3-2-1, but everyone has watched the sheet by then, and the app's own tip says 「投票之前可以講嘢」 (`game.js:252`). On one phone the table has had no look at the whole picture before the first ballot. Same shell root cause as undercover C3 | `js/ui/screens/play.js:344` (`here.includes(seat)` → no gate when the seat on screen is in focus); `js/games/fake-artist/game.js:697-704` (`startVote` right after `advanceTurn` → `nextDrawer`) | Shell (undercover C3): when a private walk starts from a public step, gate the seat on screen too. With F1's `open` flag the switch is easy to see: the previous focus was `open`, the new one is not. Use a step label on the gate (undercover C8): 「畫完喇 · 輪流投票 — 交俾 阿聰 · 其他人唔好望」. Fake-artist, one phone: before the walk, put up one public card over the full picture, 「畫完喇！部手機擺喺中間，大家睇清楚幅畫（可以傾，唔好講題目）」, with a 「開始投票」 that anyone can tap. Paper mode skips it | shell + fake-artist ui |
| F3 | minor | one-phone flow | The pass walk restarts at seat 1 instead of moving clockwise from the holder | `focusSeatsHere` returns the focus seats in **room seat order** and the shell gates `here[0]`. The vote went 阿明 (seat 2, on screen) → 阿聰 (seat 1) → 小美 (3) → 大熊 (4) → 阿強 (5), so the phone went back one seat and then forward. p1 reported it. The same happens at every later round's deal: the walk starts at whoever tapped 睇完, then jumps to seat 1 | `js/ui/screens/play.js:311-315` (`focusSeatsHere`: `st.room.players` order), `:347` (`target = here[0]`) | Pick the first focus seat **after the seat on screen**, going round the table (cyclic seat order), and fall back to `here[0]`. One change in the shell fixes every game's pass walk (deal, vote, reads) | shell |
| F7 | major | one-phone flow | Tally and round result open in the last voter's hands, and their 睇完 closes the round for everybody | After the last ballot the phase is `tally` (7 s, then `result`). `focus` is null in both, so no gate opens and nothing says to show the table. In 靜音 nothing is read aloud. The 7 s reveal (「who voted for whom」, the verdict) and the round result (word, fake, picture, points) show only on 阿強's screen. His 睇完 sends `seats: deviceMates()`, so one tap marks all 5 seats seen and starts the next round (here, the game ended). The line still reads 「睇完 0 / 5 · 等緊：阿聰、阿明、小美、大熊、阿強」 although one tap clears it (p5). D3 (spec §3.7) is meant to stop one eager friend from cutting everyone's reveal short. On a shared phone it does the opposite. In a game of several rounds, 4 of 5 people would not see the word or the fake before the next deal. Only the 1-round config hid that here (the shell results screen is laid face up). The same mechanism is undercover C1/C2 and 9upper C2 | `js/games/fake-artist/game.js:1298-1310` (`focus` null for `tally` / `result`); `js/games/fake-artist/ui.js:797` (`next` with every device mate), `:892-893` (the 睇完 line names every seat); `js/ui/screens/play.js:344` (focus empty → no card) | Shell (undercover C1): when a shared phone's focus empties during play, show a 「📱 擺喺枱中間 · 大家一齊睇」 card that anyone can tap and that switches no seat. Fake-artist on a shared phone: keep 睇完 locked until that card is dismissed (or lengthen the 2.5 s unlock), label it 「大家睇完 ✓（一下就得）」 and drop the 「等緊：five names」 list. On a phone holding every seat, the 7 s `TALLY_MS` should start only when the card is dismissed (or the result keeps the tally, which it already does, so the linger can stay) | shell + fake-artist ui |
| F4 | minor | rules | On one phone the ballots are sequential, so early voters can steer later ones out loud | Research: the vote is a simultaneous 3-2-1 point. Its one-phone note offers two ways: physical 3-2-1 pointing with one person tapping the tally, **or** sequential secret ballots. The app only does the second. Here the fake (阿聰) voted second and at 09:53:04 accused 大熊 aloud (「我覺得大熊個八角形同條斜線有啲怪」) while 小美, 大熊 and 阿強 were still to vote. 小美 then voted 大熊 and said she 「cannot say it did not influence me」. The counter 「已投 n/5」 is fine (counts only) | `js/games/fake-artist/game.js:697-704` (one ballot per seat, walked by the shell); no one-phone vote mode in `config` | Cheap: on a shared phone the ballot gate and the ballot title say 「投票中 — 全部投完先好講」. Better, for the user to decide: a one-phone option **一齊指** (research: physical pointing). The phone counts 「三、二、一，指！」 in the middle, then one person taps who pointed at whom (or only the counts). The tally and the tie rule run as now. It keeps the official ritual and the simultaneity, and saves 4 hand-overs | fake-artist (user decision) |
| F5 | minor | text | Rules, cues and help assume one phone per person or a simultaneous vote | On a one-phone table: quick rule 「畫完同時投票」 (`game.js:199`) and rules step 4 (`:219`). 「📱 手機畫板：畫喺手機上，其他人即時睇到」 (`:223`, config help `:416`), which is untrue while F1 stands. The narration cue 「畫完喇！睇清楚幅畫，揀你覺得邊個係假畫家。三、二、一，投！」 (`script.js:47-49`) announces a simultaneous vote and then the app walks the phone. The guess rule 「冇出題者就係房主」 (`:236`) means seat 1 on one phone, where there is no 房主 as a person. Not heard here (narration was 靜音), found in code | `js/games/fake-artist/script.js:47-49`; `js/games/fake-artist/game.js:199, 219, 223, 236, 416`; the engine never learns it is on one phone (`js/core/session.js:156` passes no `singleDevice` to `engine.setup`; `config.defaults` sees it, `game.js:351-356`) | Pass the one-phone fact to the engine, as 9upper does with `cfg.passPhone`. Set a hidden `cfg.passPhone` in `defaults(…, env)` and in `norm`, or have the core hand `env.singleDevice` to `setup`. Then on one phone: `cueVote` → 「畫完喇！大家睇清楚幅畫，跟住輪流投票，投完交俾下一個。」. Rules step 4: 「畫完一齊投票（一部手機就輪流投，投完先講）」. Phone-drawing help: 「…一部手機就輪流傳，大家一齊睇住畫」. Guess rule: 「冇出題者就由第一位判斷」 or name the judge seat. Update spec §3.5 / §4 | fake-artist |
| F6 | minor | one-phone flow (from code) | 開口估 on one phone: the phone goes to the judge behind a private gate, but the caught fake needs the picture | `guess` focus = `[judge]` (the host seat, or the next artist after the fake). On one phone that opens 「交俾 阿聰 · 其他人唔好望」. The judge's screen says 「㩒住張卡睇答案，唔好俾人望到」 and has the full picture *below* the judge buttons. The caught fake, who has one guess and must study the picture to make it (spec §3.6: the picture is 「for the fake to look at」), is not handed the phone and is told by the gate not to look. The word is safe behind the hold cover, so the judge *could* show the screen, but nothing says so. Not reached in this match | `js/games/fake-artist/game.js:1306` (`guess` focus = judge in spoken mode); `js/games/fake-artist/ui.js:704` (judge note), `:724` (picture after the action) | On a shared phone in 開口講: the judge's note becomes 「部手機擺喺中間俾 阿聰 睇幅畫（答案冚住）；佢講完你先㩒住睇答案，再㩒啱／錯」, with the picture **above** the covered word. With F1's `open` flag, mark this step `open` too (the only secret is behind the cover). Typed mode is fine: the fake gets the phone first | fake-artist (+ shell flag) |
| F8 | polish | text | 「（你）」 marks the last holder on screens the whole table reads | Shell results scoreboard: 「阿強（你）」 (p1, p3). The lobby marks every seat 「（你）」 (p1). The in-game round result's points list and the tally VotePanel also tag `v.me`, which is the holder. Same as undercover C7 and 9upper C8 | `js/ui/screens/results.js:286`, `js/ui/screens/lobby.js:501, 525` (`me: st.activeSeat ?? …`); `js/ui/components/SeatEditor.js:105, 127`; `js/games/fake-artist/ui.js:63, 878` (`seatName(pid, v.me)`), tally `VotePanel` `me: v.me` (`ui.js:626`) | `me: null` when `mySeats.length > 1` (shell results and lobby). SeatEditor: no tag when every seat is mine. Fake-artist: no 「（你）」 on the result and the tally when the phone is shared (`api.shared` or `cfg.passPhone`) | shell + fake-artist ui |
| F9 | polish | ux | Host-only controls (⏸, ⏭ 跳過呢步, ⏱️) are in reach of whoever holds the shared phone | In local mode `st.isHost` is true for every holder, so the top bar's ⏸ and the narrator bar's ⏭ show on every screen (p1 saw 「⏸ 暫停」「⏭ 跳過呢步」 at his card). ⏭ during the vote turns every missing ballot into an abstention (`game.js:1018-1020`). During the deal it marks every artist as having looked (`:1012-1014`). It takes two taps when someone is waited on (`skipNeedsConfirm`), and abstentions are listed publicly in the tally, so this is a soft spot, not a leak | `js/ui/screens/play.js:562` (narrator bar for `isHost`), `:599-606` (`paintTools`); `js/core/room.js` (local room: one device is host) | On a phone holding every seat, keep ⏭ only in ⋯, and make its confirm say what it does in this step (「跳過 = 未投嘅人當冇投」). Or hide ⏭ during secret steps (deal / vote) | shell |
| F10 | polish | text | 輪 means round, turn and (to readers) lap | The theme card says 「共 1 輪」, the top bar 「第 1/1 輪」, the turn line 「第 1/2 圈 · 第 4/10 筆」, the badge 「輪到你」, and the void row 「呢鋪唔計」. p3 and p4 read 「共 1 輪」 as one lap against 「第 1/2 圈」. Not specific to one phone | `js/games/fake-artist/ui.js:126` (`共 ${total} 輪`); round title in `view.title` | Use one word for a game round everywhere, e.g. 局: 「共 1 局」 and 「第 1/1 局」. 鋪 is already used in 呢鋪唔計. Keep 圈 for laps and 輪到 for turns | fake-artist |
| F11 | polish | ux | 「輪到你」 shows for the last voter only | During the walk `filterFocus` sets `together` from the **remaining** voters. 小美 (3 left) got no badge (`p3-009.png`); 阿強 (last) got 「輪到你」 (`p5-011.png`). On one phone every holder is the one being waited on, so the badge comes and goes for no visible reason | `js/core/room.js:97` (`together` = remaining `pids.size > 1`) | Let the engine mark a step as everybody's (`focus.together: true` for `deal` / `vote`) and pass it through `filterFocus`. Or hide 輪到你 on a shared phone, since the gate already names the holder (`play.js:648` already drops the chime there) | core + fake-artist |

## Checks that passed (one-phone specifics, from play and code)

- **Deal hand-over and privacy.** The walk goes through un-looked artists in table order (`game.js:1303`). The host who
  tapped 開始 looks first; gates follow for 阿明 → 小美 → 大熊 → 阿強. `openGate` closes every Cover before the gate
  (`play.js:297`). The fake's card and a real artist's card have the same four lines and the same hold-to-peek
  (p1: 「🕶️ 你係假畫家 … 你唔知題目」 only while held). After 睇完喇 the gate shows nothing of the card.
- **Draw rules.** App QM → `first` becomes random (`game.js:322, 657`). Order 小美 → 大熊 → 阿強 → 阿聰 → 阿明, the same
  in both laps; 10 strokes, one per turn, nobody twice in a row. The counters 「第 1/2 圈 · 第 4/10 筆」 and the ●○ dots were right.
- **Vote privacy (except F2).** Every later ballot is behind a gate. `secretChoice` shows 「已投 ✓」, never whom. The
  progress line shows counts only (「已投 2/5」). Nobody can vote for themselves. With app QM there is no QM to exclude.
- **Tally and scoring.** Counts 2-1-1-1, top = {大熊}, the fake is not in top → free under every tie rule (research:
  「If `top` does not contain F: the fake artist is not caught under every `tieRule`」). +2 to the fake only, matching the
  research's one-phone points-v1 adaptation (「fake wins -> fake +2 (no QM share)」).
- **No step waits on a seat that never gets the phone.** Deal, vote, guess and judge walk the phone via `focus` gates.
  The tally moves on by itself after 7 s. 睇完 sends every device mate (`ui.js:797`, `game.js:1124-1129`).
- **Night anti-tell.** Not applicable: the game has no night and its focus is never anonymous (research: 「There is no
  night」).
- **Results.** The shell results screen showed the word, the vote tally with 「最高票唔係假畫家」, the picture with
  「儲存圖片」 and the two awards.

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p4 | 「Could not see the full picture at voting time」 | app-is-right + AI-artifact | The vote screen puts the picture at full size above the ballot (`ui.js:557-575`; spec §3.5). Screenshots `p1-008.png`, `p3-009.png`, `p5-011.png` show all 10 strokes on the ballot screen, and p2 confirms it. p4 voted 「from memory」 without looking again |
| p4 | 「No unique max, so the fake was not caught under must-guess」 | misread | 大熊 had 2 votes, a unique top. The fake had 1, so he was not in the top. The app's 「最高票唔係假畫家」 is the right reason |
| p3 | Vote order 阿聰 → 阿明 → … | misrecorded | p1's screen showed 「已投 1/5」 when he got his gate, and the code (`play.js:344`) confirms that 阿明 voted first, ungated. The real issue is F2 / F3 |
| p1, p3 | 「~20 hand-overs, 11–15 min for one round」 | inherent + AI pace | The research's one-phone play is exactly 「hand it clockwise, each player draws one stroke」. The shell already skips the gate when the same seat goes on (`play.js:344`), and in this game no seat ever does. There were 18 gates (4 deal + 10 strokes + 4 votes). The minutes are agent latency (about 30–60 s per action). The real saving is F1's light public hand-over (no full cover, one tap), and optionally F4's 一齊指 (4 fewer gates) |
| p1 | 「Skip the gate when the same person goes on」 | already so | `play.js:344` opens no gate when the seat on screen is in focus (that is what causes F2) |
| p5 | 「睇完 is below the fold」 | app-is-right | The button sits after the word, the picture, the votes and the points on purpose: read first, then tap (D3, with a 2.5 s unlock). The one-phone part, where one tap covers everyone and the line lists five names, is **F7** |
| p5 | 「No game-state indication while others held the phone」 | tooling (T1) | At a real table the drawer's screen is in plain view and shows 「第 1/2 圈 · 第 4/10 筆」 and the order chips. The referee hides it from non-holders. The app part (the gate tells people not to look) is F1 |
| p5 | 「draw syntax not documented in-game」 | tooling (T3) | `draw` is a console command (README, player commands). The app has no reason to explain it |
| p1 | 「Nothing gives the canvas box; I had to map screenshot pixels by hand」 | tooling (T2) | Console geometry, not the app |
| p1 | `wait` repeats the screen; odd scroll values; 「換人 ⇄ (COVERED)」 | tooling (T4) | The console scrolls each target to the middle before a tap or draw (README 「Known console quirks」). That leaves the page offset, and the sticky header then covers the seat chip. A person's page stays at the top |
| p2 | No issues | — | p2's checklist agrees with the facts |

## AI artifacts (not app bugs)

- **Pace.** Each seat took about 30–60 s per action, so the round took 11–15 min. Spec §1 estimates 3–5 min a round
  for people.
- **Report quality.** p4 misread the tie rule. p3 recorded the vote walk in the wrong order. p5 labels its role
  「AI Player Testing Fake Artist」 although it was a real artist. p4 voted without looking at the ballot screen's
  picture. Check the haiku seats' reports against state before trusting them.
- **Coordinates.** p5 first sent pixel coordinates to `draw`. The console clamped them into the 0–1 range and drew a
  zero-length stroke, which the Canvas threw away as too short.
- 阿聰 (the fake) described his own stroke aloud at 09:49:10. That is table talk, allowed (research: talk is not
  regulated, except naming the title).

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | evidence | fix |
|---|---|---|---|
| T1 | Public steps are hidden from non-holders: the drawing, and the in-game tally and result | `pt.mjs:458-461`: with no gate and not dark, every non-holder gets 「📱 X 拎緊部手機」. Only `room.phase === 'results'` is face up (`:457`). A gate cancels `show` (`:444`), so the holder cannot even show the stroke just drawn. p3 saw lap 1 only at her lap-2 turn, and four seats never saw the 7 s tally | (a) As undercover T1: in `--shared` while playing, with no gate, not dark and `focus` without pids (tally, result), make the phone face up: everyone can `see` / `shot` read-only. (b) Once F1 lands, read the app's `focus.open` (via `REF_STATE`) and treat an open step the same way, so non-holders can watch the drawer, while `hold` / `draw` / `tap` stay with the holder. (c) Until then, a `watch` command, read-only for a non-holder during a non-anonymous, non-night step while no Cover is held, would model looking over a shoulder |
| T2 | No canvas geometry for `draw` | `see` prints only 「canvas 340×340」 (`pt.mjs:158`). p1 mapped screenshot pixels to 0–1 by hand and redid it every turn because the scroll changed | Print the canvas rect in screenshot pixels (DPR 2) and the page scroll, e.g. 「canvas 340×340 · shot px x50..730 y…」. Better: `shot --canvas` crops to the canvas so 0–1 maps straight onto the image. Have `draw` echo the stroke it made |
| T3 | `draw` silently clamps out-of-range points | `pt.mjs:558` (`Math.min(1, Math.max(0, x))`). p5's pixel coordinates collapsed to one corner, and the Canvas threw the stroke away as too short | Refuse any point outside 0..1 with the usage line `draw <session> <seat> <n> "0.3,0.55 0.7,0.55"` |
| T4 | Console scroll leaks into what players see | `scroll 78/196`, 「換人 ⇄ (COVERED)」 on the draw screen, `scroll 280/286` on the ballot | After a gate tap (hand-over), scroll the page back to the top, as a fresh pair of hands would. Print the scroll note only when a needed control is off screen. Let `wait` print what changed rather than the whole screen |
| T5 | Silent narration hides the cues a one-phone table would hear | Setup used 🔇 靜音, so F5's 「三、二、一，投！」 was never heard | As undercover T4: default one-phone runs to `--narration read` and echo each new cue into `hear` as 「[旁白] …」 |

## Fix list for the orchestrator (priority order)

1. **F2 + F3** (shell, `play.js:311-350`; the same fix as undercover C3): gate the seat on screen when a private walk
   starts from a public step, and walk the table clockwise from the holder.
2. **F1** (engine focus `open` for `draw` → `room.js` `filterFocus` → shell light public hand-over without
   「其他人唔好望」, and hide the re-peek card on public screens). This is the core of the game on one phone. Then add the
   fake-artist 「畫完喇，擺喺中間睇清楚」 card before the ballot walk (F2's second half).
3. **F7** (shell 「擺喺枱中間」 card from undercover C1/C2 when focus empties, plus fake-artist 睇完 locked until it is
   dismissed and one-phone wording on the 睇完 line).
4. **F5, F6** (fake-artist one-phone wording through a `cfg.passPhone`-style flag; judge note and picture order).
5. **F4** (user decision: offer 一齊指 on one phone, or at least 「投票中唔好傾」).
6. **F8–F11** polish. **T1–T5**, then **re-run** with `rounds: 2` and narration `read`. Rig nothing: with 5 artists a
   caught fake is common enough. The re-run should reach the guess path (F6) and a round change (F3 at the deal, F7).
