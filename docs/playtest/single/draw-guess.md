# 你畫我猜 (draw-guess): one-phone playtest review

> Session `sp-draw-guess`, `--shared` (ONE 390x844 phone passed around a 4-seat table), 2026-10-04 09:57–10:06 UTC.
> Build under test: `https://pych0413.github.io/bgbox/` build `20261004005209`. This is the same build the other one-phone
> reviews matched to local HEAD `16da24d`, so the line numbers below are the code that ran. Config: defaults except
> `cycles: 1` (📱 手機畫板, 🗣️ 講出口, 各自為政, 80 s, hints on), narration 🔇 靜音. Seats: p1 阿聰 (host), p2 阿明, p3 小美,
> p4 大熊. Reviewer: opus, read-only (no code edited). One extra repro table (`dgprobe`, 3 seats, `--shared`) was run
> after the match to test the stray-line report. It has been stopped.

## Verdict

**Finished, and the rules held, but on one phone the table only got to play 2 of the 4 rounds.** The match ran end to
end in about 8 minutes. Scoring matched the verified formula exactly: 奶茶 ⭐ with 大熊 tapped at r≈0 gave +10 / drawer
+7, and 蜜蜂 ⭐ at 73.1 s of 80 gave +12 / drawer +8. Every pass gate named the right drawer and showed nothing behind
it. No secret leaked at any hand-over, and no step waited on a seat that could not get the phone.

Rounds 1 and 3 ended 「時間到，冇人估中」 with empty canvases. Three things caused that:

1. **The app never tells the drawer to lay the phone in the middle (D1).** The drawer gets the phone behind a gate
   that says 「其他人唔好望」. The pick screen then says 「其他人隨即睇到你畫」, which is untrue on one phone. The play
   screen only says 「喺畫板上畫，唔准講嘢…」. The "put it in the middle" step from the spec (§4) appears only in the
   rules sheet. In this run the AI drawers of rounds 1 and 3 never used the console's `show`, but nothing in the app
   prompted them to.
2. **The clocks run behind an unanswered gate (D2).** 大熊 took about 80 s to tap his round-1 gate (AI pace). By then
   the 20 s pick had auto-picked the medium card 扭計骰 and 61 s of the 80 s drawing clock were gone.
3. **The console** shows a drawer's screen to nobody unless they type `show` (T1).

The "stray lines from the top-left corner" in the drawings are **a console artifact**. I reproduced it. While another
seat takes a `shot` of the face-up phone, the holder's mouse events reach the page at exactly half their CSS
coordinates. That puts stray points at the top edge, or loses the stroke entirely (T2).

Smaller one-phone gaps:

- The first drawer can skip the gate, so the three offers appear on screen with no gate (D3).
- The 👁 peek chip shows the word in large type on the phone the whole table is watching (D4).
- Typed mode cannot work on one phone at all, although the spec says it can (D5).

## Facts from the table

| | |
|---|---|
| Queue (engine) | Random first drawer 大熊 (p4), then seat order: 大熊 → 阿聰 → 阿明 → 小美 (1 cycle, 4 turns) |
| Hand-over walk | 阿聰 tapped 開始 → gate 「交俾 大熊」 → gate 阿聰 → gate 阿明 → gate 小美. Every gate named the right drawer. No manual 換人 ⇄ was needed. The phone always moved one seat clockwise |
| Words (`lastResult.lines`, 每輪重溫) | R1 大熊 「扭計骰」⭐⭐ timeout · R2 阿聰 「奶茶」⭐ 大熊 +10, 阿聰（畫）+7 · R3 阿明 「記者」⭐⭐ timeout · R4 小美 「蜜蜂」⭐ 大熊 +12, 小美（畫）+8 |
| Result | 大熊 22, 小美 8, 阿聰 7, 阿明 0. `winners: [p4]`, 「大熊 贏咗，22 分」, evening points p4 = 1 |
| Ink (`state.pictures` / `state.ink`) | R1: no stroke. R2: 8 strokes (the cup; stroke 1 holds `[23,0],[34,0],[46,0]` between `[250,350]` and `[341,350]`). R3: no stroke. R4: 9 strokes (the bee; stroke 7 holds `[237,0]`). So the keepsake had 2 pictures |
| Table talk (`hear`) | 10:01:14 阿聰 「畫緊，大家睇住部機」 · 10:01:20 大熊 風扇 · 10:01:27 小美 橙汁 · 10:01:38 大熊 奶茶 · 10:03:44 阿明 「開始畫咗」 · 10:05:08 大熊 蜜蜂 · 10:05:11 阿聰 蜜蜂！ |
| Face up | Only 阿聰 (R2) and 小美 (R4) used `show`. 大熊 (R1) and 阿明 (R3) never did, so the other three saw only 「📱 X 拎緊部手機」 for those rounds |
| End | `room.phase = results`, `activeSeat = p3` (the last drawer, so the shell scoreboard shows 「小美（你）」) |

Timeline (UTC; R1 is inferred from the clocks and the empty `p4-001.png` reveal):

- ~09:59:01: 開始. Gate 「交俾 大熊」.
- ~09:59:21: the pick clock ran out behind the closed gate, and the medium card 扭計骰 was auto-picked.
- ~10:00:20: 大熊 tapped his gate with 0:19 of the drawing clock left. He drew nothing.
- ~10:00:50: R1 reveal over. Gate 阿聰.
- ~10:00:56: 阿聰 picked 奶茶 (14 s left on the pick clock) and showed the phone.
- 10:01:38: 大熊 shouted 奶茶. 阿聰 tapped him only in the last second or so (+10 = r≈0).
- ~10:02:25: gate 阿明. 記者 ⭐⭐ (medium, so possibly auto-picked again). He never showed the phone and drew nothing. Timeout.
- ~10:04:10: 小美 picked 蜜蜂 and showed the phone.
- 10:05:08: 大熊 shouted 蜜蜂. 小美 tapped him at 73.1 s elapsed. 阿聰's 10:05:11 shout came after the answer had been said aloud.
- ~10:06: results.

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| D1 | major | one-phone flow / text | Nothing tells the drawer to lay the phone in the middle, and the pick screen says the others "see you draw" | Spec §4 and research ("One shared phone") say the drawer picks behind the gate and **then lays it flat in the middle**, because on one phone the drawer's seat is the table's screen. The app never says so on screen. The gate before the pick says 「其他人唔好望」. The pick note says 「揀完就即刻計時，其他人隨即睇到你畫」, which is only true when everyone has a phone. The play prompt is 「喺畫板上畫，唔准講嘢、寫字同數字。」. Even the 💡 line (`script.js:96`) says nothing about the middle. Only the rules sheet's 「用一部手機玩」 section (`game.js:132-135`) mentions it. A first-time drawer who was just told 「其他人唔好望」 has no cue to turn the screen to the table. In this run, rounds 1 and 3 had no picture, mask, timer or hints for the guessers. p1 and p3 both reported it as major. The AI drawers forgetting `show` is part of it (see T1), but the app gives a person no prompt either | `js/games/draw-guess/ui.js:382` (pick note), `:705` (drawer prompt); `js/games/draw-guess/script.js:31-34` (`cuePlay`), `:94-96` (hint); the UI has no one-phone flag (`js/ui/screens/play.js:221-247` `makeApi` has no `shared`); `js/games/draw-guess/game.js:1311-1314` (`focus` for `play` is a plain `{ pids: [drawer] }`, so neither the shell nor the console can tell that this screen belongs to the table) | Detect a shared phone in the UI: `api.shared` from `makeApi` (`(st.mySeats?.length ?? 0) > 1`), or the undercover way (`ui.js:74-78`, every seat on one `deviceId`). On a shared phone, canvas mode: the pick note becomes 「揀好就將部手機**平放喺枱中間**，大家望住你畫」. The drawer prompt becomes 「部手機平放喺枱中間畫 · 唔准講嘢、寫字同數字」. Paper mode: 「部手機擺喺中間計時，用紙筆畫…」. These replace existing default lines, so no new tutorial pops up (the 💡 rule holds). On one phone `cuePlay` starts 「開始！部手機擺喺中間。…」. That needs the engine to know, e.g. a hidden `cfg.passPhone` set in `config.defaults(…, env)` (as 9upper does). Optional, shared with fake-artist F1: `focus` for `play` returns `{ pids: [drawer], open: true }`, `filterFocus` passes `open`, and the shell and the console treat the step as a public screen | draw-guess ui + script (+ shell `api.shared`; core `open` flag optional) |
| D2 | minor | one-phone flow | The pick clock, then the drawing clock, run behind a gate nobody has tapped yet | `startTurn` sets the 20 s pick deadline the moment the reveal ends (`game.js:630`). On one phone that is the moment the gate 「交俾 X」 goes up. If X has not tapped within 20 s, the medium card is auto-picked and the 80 s drawing clock starts. The gate stays up, because focus is still X and `gatedFor` is unchanged (`play.js:347-349`), so the drawer is drawing on borrowed time before seeing the word. Round 1 was lost this way. 大熊's tap came with 0:19 of 80 s left, and the reveal (`p4-001.png`) shows an empty canvas and the medium word 扭計骰. The pick clock also showed 0:14 when 阿聰 and 小美 opened their gates (6 s gone). Spec §9 accepts the pick clock running during the hand-over, and it set 20 s for that reason. It does not cover the **drawing** clock running behind the gate. The 80 s gap was AI pace, but a real drawer who stepped away for a drink, or a phone sliding across a big table, hits the same thing. The gate also shows no clock, so X cannot tell that time is running | `js/games/draw-guess/game.js:24, 630` (`CHOOSE_MS` from the end of the reveal), `:1311-1314`; `js/ui/screens/play.js:293-304, 347-350` (the gate has no countdown and does not hold the clock) | Shell + core: on a phone that holds every seat, hold the room clock while an **auto** gate is up during a step with a deadline, and resume it on the tap. The pause machinery already shifts deadlines (spec §5.1, "pause-safe"). Do it silently, without a 暫停 banner. Then the 20 s means "20 s after the drawer has the phone", and §9 can say so. Cheap fallback: print the step's countdown on the gate (「揀詞 0:15」), and with a one-phone flag set the pick clock to 30 s | shell + core (draw-guess spec §9) |
| D3 | minor | privacy / one-phone flow | No gate when the drawer is already the seat on screen, so the three offers appear on a screen the table may be watching | `evaluateFocusGate` opens no gate when the seat on screen is in focus (`play.js:344`). Two draw-guess cases: (a) **the host is the random first drawer**. 開始 goes straight to the pick screen with the three words in large type on the phone the table was reading in the lobby. Reproduced on the repro table: 甲 tapped 開始 and the reply was his three offers (雪人 / 庫洛米 / 緣分). With 4 players this is 1 game in 4. (b) **A voided last turn**: void re-queues the drawer at the end (`game.js:781`). If that turn was last in the queue, the same seat draws next, so the reveal (face up in the middle) turns into the offers with no gate. The unpicked offers are PRIVATE (spec §5.1, research "What must stay private"). This is the same shell root cause as undercover C3 and fake-artist F2 | `js/ui/screens/play.js:344` (`here.includes(seat)` → no gate); `js/games/draw-guess/game.js:776-781` (`voidBookkeeping` re-queues at the end), `:1311-1314` | Shell (the undercover C3 fix): when a shared phone's focus goes from none (lobby, reveal, standings) to a named private step, gate the seat on screen too: 「到 阿聰 揀詞 · 其他人唔好望 · 㩒一下」. One fix covers every game | shell |
| D4 | minor | privacy (from code) | On a phone lying face up, the 👁 peek chip shows the word to the whole table | Canvas mode hides the word behind a tap chip that opens it at 1.75 rem for 2.5 s (`PEEK_MS`). The open chip grows upward over the mask. On separate phones that is safe (research: 「auto-hides after about 2 s, so people across the table cannot read it」). On one phone the screen is face up in the middle (D1), with three guessers staring at it. A drawer who forgets a 4-character idiom and taps the chip shows it to everyone for 2.5 s. Paper mode already uses a hold-to-peek `Cover`, which a hand can shield and which closes when the finger lifts. Not seen in this match: nobody peeked while the phone was face up | `js/games/draw-guess/ui.js:54` (`PEEK_MS = 2500`), `:279-321` (`makeWordPeek`: chip for canvas, `Cover` only for paper); `style.css:72-81` | On a shared phone, use the paper-mode hold-to-peek `Cover` in canvas mode too, labelled 「拎起部機，㩒住睇個詞」, so the word shows only while the finger is down. Keep the chip on a phone of one's own | draw-guess ui |
| D5 | minor | rules / text (from code) | ⌨️ Typed mode cannot be played on one phone at all, but the spec says it can, "just badly" | Spec §2 says typed on one phone 「can be played (the phone goes round), just badly」, so `validate` only warns. During `play`, focus is the drawer. If a guesser takes the phone with 換人 ⇄ to type, their screen shows and then the auto gate 「交俾 drawer」 covers it straight away (`gatedFor` was reset when the drawer took the phone). This is the bounce reported in 9upper C3. Nobody but the drawer can ever type, so every turn times out. `defaults` never keeps typed on one phone and the warning text is accurate (「其他人冇得打字」), so a table only gets there by overriding both | `js/ui/screens/play.js:344-350` (auto gate back to the focus seat); `js/games/draw-guess/game.js:259, 296` (warning only); `docs/games/draw-guess.md:85` | Make typed with `env.singleDevice` a `validate` **error** (「一部手機冇得打字估，請揀講出口」), and drop the "it can be played" sentence from §2 and §4. If the 9upper C3 shell fix (a hand-picked seat holds until the focus changes) lands, typed would still need one hand-over per guess, so keep the error | draw-guess (+ spec) |
| D6 | polish | text | Lobby and narration lines that assume one phone each | The lobby help for 畫喺邊 reads 「每部手機即時睇到畫家畫緊乜。」 (`game.js:313`). It is shown in a 一部手機玩 lobby too, where there is one phone. `fields(cfg, n)` gets no `env`. The pick note and `cuePlay` are covered in D1 | `js/games/draw-guess/game.js:313` | Reword so it fits both: 「畫家喺手機上畫，大家睇住同一幅畫（各自部機，或者擺喺中間嗰部）。」. Alternatively pass `env` to `fields` as well (framework request §8.1 already passes it to `validate` and `presets`) | draw-guess (+ core optional) |
| D7 | polish | text | Screens laid face up speak to the holder: 「輪到你」 and 「小美（你）」 | Face-up drawer screen header: 「第 2/4 輪 輪到你 阿聰 畫」 (`p4-003.png`, p3 report). Results 今晚戰績: 「小美（你）」, only because she held the phone last (p1). In-game, `rankRows` (standings, the over screen) and 「下一個畫」 tag `v.me`, which is the holder. Same family as fake-artist F8, avalon C13, undercover C7 and 9upper C8 | `js/ui/screens/play.js:616-620` (`turnBadge`); `js/ui/screens/results.js:286` (`me: st.activeSeat`); `js/ui/components/Scoreboard.js:50`; `js/games/draw-guess/ui.js:61, 731, 750, 827` (`seatName(…, v.me)`) | Shell: `me: null` when `mySeats.length > 1`, and no 輪到你 badge on a shared phone (the gate already names the holder). Draw-guess: `seatName` without 「（你）」 when `api.shared` | shell + draw-guess ui |
| D8 | polish | one-phone flow | The queue preview never reaches the table on one phone | The research asks for a PUBLIC queue preview, and the app puts 「之後到：阿B → 阿C」 and 「最遲 N 秒後開始畫」 on the **waiting** phones during `choose` (`ui.js:336-354`). On one phone the waiting body is never on screen: during `choose` the screen is the gate or the drawer's private pick. Only the reveal's 「下一個畫：X」 remains (p2 reported no queue preview) | `js/games/draw-guess/ui.js:336-354` (waiting body only), `:825-829` (reveal names one) | On a shared phone, add 「之後到：…」 under 「下一個畫」 in the reveal and the standings, which are the public screens on one phone | draw-guess ui |
| D9 | polish | ux | On one phone the table watches the drawer's canvas, which is the smallest one | Shout mode puts the peek slot, the 「邊個估中？」 name chips and (host seat) the 主持 bar around the drawer's canvas. On the face-up phone it was about 272 CSS px wide (`p2-010.png`), against about 342 px for the same picture at the reveal (`p4-001.png`), roughly 64 % of the area. The drawer's seat is the only screen on one phone, so everyone guesses from the small one | `js/games/draw-guess/ui.js:668-673` (chips above the canvas) | On a shared phone, put the name chips **under** the canvas (the drawer reaches them after the shout) and let the canvas take the full width | draw-guess ui |
| D10 | polish | text | 「⚡ 最快反應：大熊（73.1 秒估中「蜜蜂」）」 and a long 3 s banner | The fastest-guess highlight fires even when the "fastest" solve came with 7 s left. 73.1 s reads as a joke under 「最快反應」. The grace header 「✅ 確認緊 — 仲有人同時估中就加埋，揀錯可以撤銷」 is 22 characters for a state that lasts 3 s (p3). Neither is specific to one phone | `js/games/draw-guess/game.js:1487`; `js/games/draw-guess/ui.js:607` | Show 最快反應 only when the solve came within the first half of `T`, or word it 「最快估中」. Shorten the banner to 「✅ 仲有人估中？一齊㩒 · ↩ 撤銷」 | draw-guess |

## Checks that passed (one-phone specifics, from play and code)

- **Hand-over order.** The first drawer is random over all seats, then seat order (`queue`). The phone moved one seat
  clockwise every turn (大熊 → 阿聰 → 阿明 → 小美), and the gate always named the next drawer (`focus` = drawer in
  `choose`/`play`, `game.js:1311-1314`). No manual 換人 ⇄ was needed.
- **Privacy of each hand-over (except D3).** The gate goes up the moment the reveal ends, before the offers render.
  `openGate` closes every cover first (`play.js:297`). The pick screen is private behind the gate. From `choose` to
  `play` the focus stays the same, so there is no second gate. The word never appeared on the face-up screen: p1 and p3
  checked, and only the mask, the category chip, the revealed characters and the chips were public. The revealed
  character 茶 / 蜂 is the 50 % hint, public by design.
- **Reveal / standings / over.** `focus` is null, so no gate appears and the reveal stays on the phone that is in the
  middle. Right after the reveal the next gate covers it.
- **No step waits on a seat that never gets the phone.** `blocking` is only the drawer while picking (they get the
  phone through the gate) and the host during a team ruling. The drawing clock runs out by itself. 🚩 cannot be reached on
  one phone, as spec §4 says ("fouls are settled at the table"). The host's ⋯ menu has ＋30 秒 and 🗑️ 呢輪作廢 from any
  seat.
- **Shout judging.** The name chips, the 3 s grace window with ↩ and the scoring all worked on the shared phone
  (`r` 0.086 → +12 and D = round(12 × (0.5 + 0.5 × 1/3)) = 8. `r` ≈ 0 → +10 and D = 7).
- **Night anti-tell.** Not applicable: no night, and `focus` is never anonymous (research: "Night order: n/a").
- **Results.** The shell laid them face up. Winner, ranking with correct guesses and drawing points, the 每輪重溫 line
  for every turn including both timeouts, and the keepsake gallery were all there.

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p2 (blocker) | 「Word and unrevealed hints visible to all players」 (茶, 「第二隻字係「茶」」) | misread | 「提示：第二隻字係「茶」」 is the 50 % hint, public by design (research hint clock: "50%: reveal one character"). p1 and p3, who both held and watched a face-up phone, say the word itself never showed. The UI only renders the word inside the closed peek chip (`ui.js:279-321`) |
| p2 (blocker) | 「Draw command failed; could not draw in round 3」 | unverified (tooling / usage) | 「no control matching」 is the console's error for a label that matches no control (`pt.mjs:343`). `draw` takes the canvas **number**. Round 3's epoch has no stroke at all. The phone was not face up, so no other seat's `shot` could interfere (T2). p2's report also misnumbers the rounds (it puts its own turn in round 2 and 阿聰's in round 1). See T4 |
| p2 (major) | 「Peek does not auto-hide after 2 s」 | rejected | `PEEK_MS = 2500` and a timer closes the chip (`ui.js:54, 311-315`). p4 saw it hide. The privacy point that is real is D4 |
| p2 (major ×2) | 「No hold-to-peek cover」, 「full drawer interface exposed on the shared phone」 | app-is-right | Canvas mode uses the tap chip and paper mode the hold cover (spec §3.2). On one phone the drawer's seat **is** the table's screen, with mask, hints and name chips public by design (spec §4, research "One shared phone"). The real gap is D4 |
| p2 (major) | 「Shout capture mechanism unclear」 | app-is-right | In 講出口 the app does not hear shouts. The drawer taps the name (research "B. Shout-mode accept resolution") |
| p2 (minor) | 「Guesser accept buttons look tappable on the shared phone」 | app-is-right | The drawer taps them on the phone in the middle. That is the whole one-phone flow |
| p2 (minor) | 「No grace-window feedback on the shared display」 | tooling (T1) | The chips header shows 「✅ 確認緊…」 on the drawer's screen (`ui.js:607`). p2 could not see it because the drawer had taken the phone back |
| p4 (major) | 「Drawer got the phone at 0:19 of the turn」 | confirmed as D2 (mechanism), cause AI pace | The drawing clock ran because the gate went unanswered for about 80 s (AI latency). The pick auto-picked the medium card. 「only 4 s to draw」 / 「others guessed correctly by default」 is wrong: R1 timed out with no stroke |
| p4 (major) | 「4 turns instead of 8」 | app-is-right | The orchestrator set `cycles: 1` (setup echo). Auto would be 2 for 4 players |
| p4 (minor) | 「Turn 3 silent, no explanation」 | app-is-right | The recap says 「第 3 輪 · 阿明 畫「記者」⭐⭐ — 時間到，冇人估中」. Nothing was drawn and nobody guessed |
| p3, p4 (minor), p1 (minor) | 「3 s co-winner window too short; 阿聰 also said 蜜蜂」 | app-is-right | 阿聰 said it 3 s **after** 大熊 had said it aloud. Research: 「a correct answer shouted aloud tells the whole room the word, so a second scoring guesser is not meaningful」. Co-winners are for shouts made "essentially simultaneously" (rule B.2). p3's second tap missed the window because of AI latency (several seconds per command) |
| p1, p3 (minor) | 「Reveal auto-advances; guessers never see it」 | app-is-right + D1/T1 | 7 s for every turn, host can skip (verified research 2.5). `focus` is null in the reveal, so on a phone in the middle it is public. It was missed only because the phone was never in the middle (D1) and the console hid it (T1) |
| p3 (minor) | 「Three candidate words readable over the shoulder」 | app-is-right | The offers sit behind the gate's 「其他人唔好望」, like any private screen. The real exposure is D3, where there is no gate at all |
| p1, p3 (polish) | 「Keepsake has only 2 of 4 pictures」 | app-is-right | Rounds 1 and 3 have no stroke (`state.pictures` holds epoch 2 only). An empty canvas is not kept (`js/core/client.js:444-446`). The recap lists all 4 words |
| p3 (minor) | 「hold on the peek chip shows no word」, 「show makes tap read-only」 | AI misread | The chip is a **tap** control: it opens on release, so `hold` prints it closed (T4). In the referee the holder keeps full access while the phone is face up (`pt.mjs:456` comes before the `shownFor` check at `:458`). p3's later tap failed because the grace window had closed and the chips were gone |
| p4 (minor) | 「No per-turn drawing log」 | out of scope | The results keep every picture (keepsake) and a recap line per turn |

## AI artifacts (not app bugs)

- **Pace.** A gate tap took about 6 s (p1, p3) and up to about 80 s (p4, round 1). Two drawers (大熊, 阿明) produced no
  stroke in 80 s. 阿聰 tapped 大熊 about 35 s after the 奶茶 shout, which cut his points from about 19 to 10.
- **`show` forgotten.** Only two of four drawers laid the phone face up. A person turns the screen to the table more
  naturally, but D1 still applies: the app tells them 「其他人唔好望」 and never the opposite.
- **Report quality.** p2 (blocker ×2) and p4 contain claims the state contradicts: the word on screen, 「others guessed
  correctly by default」, 「drew one stroke」, and the round numbering. Check the haiku seats against the state before
  trusting them.

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | evidence | fix |
|---|---|---|---|
| T1 | A drawer's public screen is hidden from the table unless the holder types `show` | `pt.mjs:456-460`: no gate and not dark → every non-holder gets 「📱 X 拎緊部手機」. Draw-guess's play screen is meant for the whole table (spec §4). Rounds 1 and 3 were invisible to three seats | When the app marks a step public (D1's optional `focus.open`, the same flag as fake-artist F1), treat it as face up automatically. Until then, on every `see` / `draw` by a holder in a draw-guess `play` step, print 「（呢個畫面係俾全枱睇嘅 — 記得 show）」. Let `wait` for non-holders print the narrator bar's line, which is public |
| T2 | **Concurrent `shot` from another seat corrupts the holder's input** (stray lines, lost strokes) | Reproduced on `dgprobe`. While p2 / p3 looped `shot` (and `see`), p1's `draw` stroke "0.25,0.15 → 0.75,0.15" got `[59,0],[70,0],[81,0]`. The page's pointer log shows three moves at (77,197), (80,197), (83,197) in the middle of the stroke, exactly half the CSS coordinates of the moves around them (≈(154,395)…(171,395)). So input was mapped at half scale (DPR 2) while `Page.captureScreenshot` ran. With `shot` alone, several strokes vanished silently (the press landed off the canvas). `see` alone and no concurrency: clean. p1 / p3's cup and bee strokes have the same pattern | Serialise every CDP call on a shared phone through one per-phone queue in the daemon (`Input.*`, `Page.captureScreenshot`, `Runtime.evaluate`), so a screenshot never runs while a press / move sequence is in flight. Have `draw` check the result (count the strokes on the canvas, or log the page's pointer events) and say 「stroke lost — try again」 instead of printing a normal screen. Add a `selftest` case: draw while another seat shoots, and assert that all points are collinear |
| T3 | Output is too long and each command is slow | p1: a 10-stroke drawing printed thousands of lines, and the clock went from 1:20 to 0:52 while the console worked | Default `draw` / `tap` to a one-line summary (「drew 1 stroke · 0:48 left」), with full screens behind `--full`. `draw` could accept several strokes in one call (`"…" ; "…"`) |
| T4 | `hold` on a tap chip, and `draw` on a label | p3 held 「👁 㩒一下睇個詞」 and got a closed chip. p2's `draw` with a label returned 「no control matching」 | `hold` on a plain button says 「呢個係 tap 掣，唔係㩒住睇」. `draw` accepts `canvas` as the target and refuses any control that is not a canvas, with the usage line |
| T5 | 🔇 靜音 hides the cues a one-phone table would hear | Narration was silent, so the cue lines (who draws, hints, the answer) reached non-holders only by chance | As fake-artist T5 and undercover T4: run one-phone tables with `--narration read`, and echo each new cue into `hear` as 「[旁白] …」 |

## Fix list for the orchestrator (priority order)

1. **D1**: one-phone wording on the pick note, the drawer prompt and `cuePlay` (「平放喺枱中間」), via `api.shared`
   (shell) and a hidden one-phone cfg flag. Optionally the `focus.open` flag shared with fake-artist F1.
2. **D3**: shell, the same fix as undercover C3 / fake-artist F2. Gate the seat on screen when a private step follows a
   public one (lobby → first pick, reveal → a re-queued pick).
3. **D2**: shell + core. Hold the clock while an auto gate is up on a phone holding every seat (or at least show the
   countdown on the gate), then update spec §9.
4. **D4, D5**: hold-to-peek in canvas mode on a shared phone. Typed + one phone becomes a `validate` error, and the spec
   wording is fixed.
5. **D6–D10** polish (D7 is the shared shell 「（你）」 / 輪到你 fix).
6. **T2 first** (it corrupts drawings and loses strokes in every drawing game on `--shared`), then T1, T3–T5. Then
   **re-run** with `cycles: 1`, narration `read`, and no `shot` while another seat is drawing until T2 lands.
