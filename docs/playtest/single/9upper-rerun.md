# 瞎掰王 9upper (9upper): one-phone re-run review

> Session `sp2-9upper`, `--shared` (ONE 390x844 phone passed around a 4-seat table), 2026-10-04 16:40–17:51 UTC.
> Build under test: local `http://localhost:5199/` = HEAD `328b04f` ("One-phone play: table mode, public and private gates,
> co-wakers, and per-game adoption"), clean tree, so the line numbers below are the code that ran. Contract: DESIGN §7.1.
> Config: preset 快玩 (4 rounds, 1 lap), levelMode mix, `passPhone: true` (forced on by `env.singleDevice`), readSecs 9,
> speakOrder 諗樣揀, speakSecs 0, 1 收皮啦, narration 🔊 語音. Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊.
> Reviewer: opus, read-only (no code edited). First one-phone run: `docs/playtest/single/9upper.md` (session `sp-9upper`).

## Verdict

**Not finished: 2 of 3 rounds were scored.** The plan was 4 rounds. Round 2 was voided when 大熊, its 諗樣, was marked
💤 absent, and his turn was dropped, which left 3 rounds. The players stopped at the round-2 reveal after about 71 minutes.
The engine was left at `phase: reveal`, round `2v1`, 第 2/3 輪. Final scores were 阿聰 5 · 阿明 2 · 小美 9 · 大熊 3 (💤).
Both scored rounds are exact by the research algorithm.

Two AI seats went silent: 大熊 from 16:48 (his agent ended its run after about 9 minutes) and 阿明 from about 17:09. That
is an AI artifact. It forced the host onto the new gate escape (「X 唔喺度？」 → 💤 / 🤖) seven times, and that path
exposed the two real one-phone problems of this run:

1. **🤖 代佢做 on an absent 諗樣 plays a ghost round (N1, major).**
   - Proxying the term step starts the read, although two players had just said aloud that they knew the term.
   - Every proxy in the explaining marks the current speaker 「⏭ 跳過咗」, including people who had spoken, and starts a
     second lap.
   - Only the 7th proxy would reach 揀人, and that proxy picks at random. A lucky random pick scores +D for a 諗樣 who is
     not at the table.
2. **A read gate passed by 🤖 or 💤 can take away the only look at the explanation (N2, major).**
   - In the replayed round 2, 阿明's look was proxied and he turned out to be the 老實人. Nobody ever read the true
     explanation, so the round was a pure coin flip.
   - Nothing told the table.

Everything the first run flagged for one phone is fixed: C1 to C8, and for this game #1, #4, #5, #9, #11, #12, #18, #19,
#20 and #34 of the summary.
- 「✅ 講完 · 下一位」 / 「⏭ 佢唔喺度，跳過」 are on the 諗樣's screen.
- The reveal goes to the middle behind the table card, with 「大家睇完 ✓ · 下一輪（一下就得）」 locked until that card is tapped.
- The explain cue says 「部手機交返俾小美」.
- The gate is opaque from its first frame.
- The public reveal no longer says 「（你）」.

The private half (equal 9 s windows, a private gate per reader, the 諗樣 never peeking) still works.

## Facts from the table

| | |
|---|---|
| Rounds | Planned 4 (快玩, 4 players). `history` has 2 entries. `voids` = `[{ n: 2, judge: p4, term: 「錢德拉塞卡極限」, how: 'absent', kept: false }]`. `judges` is now `[p3, p1, p2]` and `totalRounds` is 3. `lastResult` is null (the game is not over) |
| Round 1 | 諗樣 **小美**. 「表觀遺傳學」 (小美 knew it) was swapped for 「盲鰻」 ⭐⭐. Read order 大熊 → 阿聰 → 阿明. 老實人 **阿聰**, 9upper 阿明, 大熊. 收皮啦 on 阿明 (bluffer, hit). Pick: 阿聰, correct. 小美 +2 +1 = **+3**, 阿聰 **+2**, 阿明 **−1**. 大熊 never spoke |
| Round 2 (void) | 諗樣 **大熊**, 「錢德拉塞卡極限」 ⭐⭐⭐. 阿聰 and 小美 said aloud that they knew it (17:03:29, 17:03:53). The host proxied 大熊's 睇題目 (17:08:49). Reads: 阿聰 read; 阿明 was proxied (17:19:27); 小美 read. Three proxies in the explaining (17:22:10, 17:28:33, 17:33:18) cycled the speakers. 💤 on 大熊 at 17:33:47 voided the round |
| Round 2 (replay) | 諗樣 **阿聰** (第 2/3 輪). 「ubuntu」 → 「門口效應」 → 「篳路藍縷」 ⭐⭐⭐ (2 swaps). Read order 阿明 (proxied 17:45:16) → 小美. 老實人 **阿明**, 9upper 小美. 阿聰 called 阿明 after 小美 spoke, then decided. Pick: 小美 (9upper), so 小美 **+3**. Live round state: `spoken: []`, `turnNo: 1`. 小美 explained, but she was never marked ✅ (N4) |
| Scores | 3/3/3/3 → r1 5/2/6/3 → r2 **阿聰 5 · 阿明 2 · 小美 9 · 大熊 3**. Matches golden vectors 4 (r1: correct pick plus a callout hit on a bluffer, at D = 2) and 2 (r2: wrong pick, at D = 3) |
| Read order | Always from the 諗樣's left (`game.js:565`). Heard as: 「部手機由大熊開始」 (r1, judge p3), 「由阿聰開始」 (r2, judge p4), 「由阿明開始」 (replay, judge p1; the absent p4 was left out) |
| End state | `activeSeat: null` (phone in the middle), `focus: null`, `room.absent: [p4]`, `room.idle: []` (§7.1 #18: nobody is idle in a whole-table room) |

Timeline (UTC, from `hear`):
- 16:40:04–25 all four ready.
- 16:40:46 r1 term cue. 16:41:09 小美 knows it and swaps. 16:41:43 read cue. 16:42:51 explain cue (「部手機交返俾小美，由阿明開始」).
  阿明's window had already closed when his `hold` arrived (AI latency).
- 16:43–16:52 小美 cross-examines 阿明. 大熊's agent stops at about 16:48.
- ~16:54 小美 calls 大熊, who stays silent. 17:00:13 she calls 阿聰. 17:00:51 收皮啦 on 阿明. 17:02:10 decide → reveal → table card → 下一輪.
- 17:02:52 r2 term cue (大熊 is the 諗樣). 17:07:15 escape row opened. 17:08:49 🤖 on 大熊's 睇題目 → read cue with no swap.
- 17:09–17:19 阿明 is silent at his gate; 17:19:27 🤖 → 17:19:58 explain cue 「部手機交返俾大熊」 (the absent seat).
- 17:20:17 小美 explains. 17:22:10, 17:28:33 and 17:33:18 🤖 on 大熊's 解釋 card: each one skips a speaker, and the third
  starts the second lap.
- 17:33:47 💤 大熊 → round 2 replayed with 阿聰 as 諗樣. 17:34:07 and 17:34:18 two swaps. 17:34:28 read cue.
- 17:36–17:45 阿明 is silent; 17:45:16 🤖 passes his look. 17:45:42 explain cue. 17:46:00 小美 explains (as a 9upper).
- 17:47:18 阿聰 calls 阿明 (silent). 17:50:30 decide. 17:50:38 reveal: 老實人 阿明, 小美 +3. About 17:51 the players stop.

Screenshots (`%TEMP%\bgbox-playtest-shots\sp2-9upper\`):
- `p2-001.png` / `p4-002.png`: r1, the 諗樣's explain screen with 「✅ 講完 · 下一位」 and 「⏭ 佢唔喺度，跳過」.
- `p1-003.png` / `p1-004.png`: r2, the public card 「輪到 大熊 · 解釋」 with the open escape row (💤 當佢缺席 / 🤖 代佢做) over
  the table view 「小美 ⏭ 跳過咗 · 阿聰 🎤 講緊 · 阿明 ⏳ 等緊」, taken after the first proxy, although 小美 had explained.
- `p1-005.png` / `p3-006.png`: the replay reveal on the table view, with no 「（你）」.

## Fixed since run 1

| run-1 | summary # | was | now | evidence |
|---|---|---|---|---|
| C1 | #11 | The 諗樣's 下一位 marked every speaker ⏭ and started a second lap | With `passPhone` the 諗樣's 「✅ 講完 · 下一位」 is the speaker's own 講完, and 「⏭ 佢唔喺度，跳過」 is a separate button. `blocking` names nobody in explain | `game.js:896-900`, `:1140`; `ui.js:499-506`; `p2-001.png`. Residuals: the 🤖 path (N1) and 👉 叫佢講 (N4) |
| C2 | #1, #4, #5 | The reveal stayed in the 諗樣's hand and 下一輪 was live at once | `focus(reveal)` is `null` with passPhone, so the shell shows the table card 「📱 部手機擺返中間」. The table view has 「大家睇完 ✓ · 下一輪（一下就得）」, which stays disabled until the card is tapped (U4, U5) | `game.js:1121`; `ui.js:659-693`; p3: 「a table card 部手機擺返中間 appears… then 大家睇完」; `p1-005.png` |
| C3 | #9 | 「換人 ⇄」 to a 玩家 bounced straight back to the 諗樣 | A hand-picked seat holds while the focus signature is unchanged | `play.js:612`, `:635`. Not exercised this run (nobody took the phone to re-check their role) |
| C4 | #19 | The explain cues said 「收起電話」 / 「講完㩒我講完」 | One-phone head: 「睇卡完。部手機交返俾小美，由阿明開始解釋…」 | `script.js:127-139`; heard at 16:42:51, 17:19:58 and 17:45:42 |
| C5 | #12 | 一部手機輪流睇 could be turned off in a one-phone room | `validate(cfg, n, env)` refuses it. The room passes `{ singleDevice }` | `game.js:258-273`; `room.js:834` |
| C6 | #18 | A gate for an absent seat had no way out | The host device shows 「X 唔喺度？」 → 💤 當佢缺席 / 🤖 代佢做 under every named gate (⏭ only in multi-seat walks) | `play.js:530-556`. Used 7 times. 9upper's answers to it are N1 and N2 |
| C7 | #34 | The pass gate faded in from transparent | The backdrop is opaque from the first frame and only the card fades | `css/base.css:597-604` |
| C8 | #20 | 「（你）」 on the public reveal | On a shared phone `seatName` drops 「（你）」 and the score strip has no `.me` | `ui.js:46-48`; `p1-005.png` 「阿聰 揀咗 小美…」 |
| T1 (tool) | — | `see()` showed the screen behind a fading gate | The modal is read at any opacity | `pt.mjs` (T3 note near `:1208`). No gate misreads this run |
| T4/T5 (tool) | — | A silent seat froze the table; `wait` ignored `say` | The host may use the escape row (after `PT_ESCAPE_AFTER`, 60 s by default); `wait` wakes on table lines | `pt.mjs:64`; README §shared |

## Still open from run 1

- **T3 (tool): no `peek` op, and `hold` is capped at 8000 ms** (`pt.mjs:906`). The 9 s window starts at the separate
  「開始睇卡」 tap. 阿明 lost his whole round-1 window between two commands, and 阿聰 and 小美 had to chain the two commands in
  one shell line.
- **T7 (tool): no `tap --twice`** for arm-then-confirm controls. The 3 s confirms (`dom.js:161` `ARM_MS`, `ui.js:220-232`,
  `:296`) were missed again: 換題, 收皮啦, 代佢做 and 當佢缺席.
- **Run-1 note on the escape for a 諗樣**: the run-1 report already said a stalled 諗樣 is auto-acted with `start` and a
  random pick (`docs/games/9upper.md` §5 autoAct). On one phone that now matters, because the gate puts 🤖 one tap away
  (N1).

## New confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| N1 | major | one-phone flow / rules | 🤖 代佢做 on an absent 諗樣 plays a ghost round: it starts a known term, marks speakers who spoke as ⏭ 跳過咗, laps twice, then picks at random | **Term step.** On 「輪到 大熊 · 睇題目」 the proxy sends `start`. 阿聰 and 小美 had said aloud that they knew 錢德拉塞卡極限 (17:03), but on one phone nobody can flag 🙋 我識呢條: the table view only says 「出聲話俾諗樣知」, and only the 諗樣 can swap. The read began on a term two players knew, which breaks the research rule (step 3: 「If anyone, including the Thinker, already knows the term, redraw」). The explain cue then told the table 「部手機交返俾大熊」, the seat that was away.<br><br>**Explaining.** Each proxy on 「輪到 大熊 · 解釋」 is `{ done, skip: true }`. In order: 小美 ⏭ (she had explained at 17:20), then 阿聰 ⏭ (he had explained at 17:22), then 阿明 ⏭, and then 小美 🎤 again (`back`). The table's public record was wrong after the first tap (`p1-003.png`). Reaching 揀人 takes 2·(N−1) = 6 proxies, and a 7th proxy then picks **at random**. Because `resolve` scores the absent 諗樣 +D on a lucky pick, a seat that is not there can gain points. Each step needs open row → 🤖 → 再㩒一次. The host gave up after 3 proxies (11 minutes) and used 💤, which was the right tool from the start but nothing pointed to it.<br><br>A human host would hit this too, whenever a 諗樣 leaves mid-round and the host reaches for the first-looking option | `js/games/9upper/game.js:1219-1232` (`autoAct` for the judge: `term` → `start`, ignoring `r.knows` and spoken claims; `explain` → `{ done, skip: true }`; `judge` → random `pick`); `:505-524` (`endTurn` skip, then the `back` lap); `js/ui/screens/play.js:545-555` (🤖 offered on every named gate, whatever the engine would do) | With `cfg.passPhone`, `autoAct` for the **諗樣** returns `null` in `level` / `term` / `explain` / `judge`. Nobody can judge for an absent 諗樣, and the session then returns false (`session.js:257-271`). Shell: add a read-only `hostCtl.canAutoAct(pid)` (engine `autoAct` on a clone `!== null`) and leave 🤖 out of the escape row when it is false, so the row for an absent 諗樣 offers only 💤 (which voids and hands the seat on, `game.js:703-705`). Tests: no `autoAct` for the judge with passPhone; a 💤 on the judge mid-explain voids the round. Update `docs/games/9upper.md` §5 `autoAct` | 9upper (+ shell) |
| N2 | major | one-phone flow / rules | A read gate passed by 🤖 or 💤 can take the 老實人's only look, so the round runs with nobody knowing the truth, and nothing says so | **🤖 on a read gate.** It sends `peek` for the absent reader. Their 9 s window runs **behind the still-open gate 「交俾 阿明」** with nobody holding the phone (anyone who taps that gate in the meantime opens 阿明's card), then the next reader is called. In the replay 阿明 was proxied (17:45:16) and was the 老實人: no one read 「篳路藍縷」, so the 諗樣 judged two bluffs (小美 +3). The same happened to 阿明 in the voided round (17:19:27).<br><br>**💤 on a reader.** It passes their look over in the same way. The design keeps a round alive after a 💤 so that voiding "only when the 老實人 is away" does not leak the role. A role-independent redeal leaks nothing and is what the research asks for (edge cases: 「Honest player disconnects before reveal: void the round, redraw card and roles, same Thinker」).<br><br>**No signal to anyone.** The table sees only the escape tap in the log, and the reveal shows no line that the 老實人 never read. p3 noticed that with 2 present 玩家 her own role told her who was honest, but that is the 3-player rule, not this bug | `game.js:1221` (`autoAct` read → `peek`); `:439-453` (`startPeek` / `endPeek`: the window runs on with nobody at the phone); `:710` (`setAway` read → `endPeek`, no redeal); `play.js:545-555` | With `passPhone`: (1) `autoAct` in `read` returns `null`, because nobody can look for someone (the shell then toasts or hides 🤖, as in N1). (2) `setAway` during `read`, for a seat **not yet in `readDone`**, calls `voidRound(s, ctx, 'redeal')`. That gives a fresh term and fresh roles among the present seats, and it is the same whoever held the 老實人, so nothing leaks. Add `how: 'away'` to `redoLine` → 「💤 阿明 唔喺度：重新派過身份同題目」. A seat that already read keeps the round, as now. Tests: 💤 on the reader before or after their peek; no `autoAct` in pass read. Update §3.2a and §5 | 9upper |
| N3 | minor | text | 💤 on the 諗樣 restarts the round and shortens the game, but the confirm and the narrator do not say so | The two-tap confirm is the generic 「當 大熊 缺席？ 呢局唔再等佢」. The round in progress (cards read, three explanations) is thrown away, and 第 2/4 becomes 第 2/3. The new cue is a plain 「第 2 輪，阿聰做諗樣。題目係「ubuntu」…」. The public line 「💤 大熊 唔喺度：呢鋪由 阿聰 做諗樣」 is on the term screen (`redoNote`), but in 語音 the table hears nothing about the restart or the lost round (p1, p3) | `js/ui/screens/play.js:220` (one text for every seat and game); `js/games/9upper/script.js:112-116` (`cueTerm` takes no `redo`); `game.js:780-783` | Pass `redo` to `cueTerm`. For `absent` / `stuck` the line starts 「大熊唔喺度，呢輪重新嚟過，由阿聰做諗樣，一共 3 輪。」. Shell: let the engine supply the 💤 confirm line (optional `engine.absentNote(state, pid)` → 「呢輪會作廢，由 阿聰 做諗樣，全局少一輪」) and fall back to the generic text | 9upper (+ shell) |
| N4 | minor | one-phone flow | On one phone, 👉 叫佢講 sends the speaker who just finished back to ⏳ 等緊, so the list can still show nobody ✅ | C1 fixed 「✅ 講完 · 下一位」, but in 諗樣揀 the natural way to choose the next speaker is to tap their name. `call` makes the target the speaker and sends the one on the floor back to waiting. The live replay state shows `spoken: []`, `turnNo: 1` after 小美 explained in full and 阿聰 called 阿明. The list is the 諗樣's memory aid and the table's public record, and on one phone the speaker cannot tap 我講完 to fix it | `game.js:530-536` (`callSpeaker`: the current speaker is not marked spoken); `:363` (`callable`); `ui.js:562-579` | With `passPhone`, `callSpeaker` first ends the current speaker's turn as 講完 (push to `spoken`, drop from `skipped`). Let the 諗樣 call a ✅ player again for a follow-up (`callable`: any present explainer on one phone; the rules let the 諗樣 question anybody). Test, and a §3.4 note | 9upper |
| N5 | minor | one-phone flow (from code) | On a shared phone the 老實人's reminder card always says 「你睇過真正解釋喇」, even when they never opened the card or their look was proxied | The UI records whether the card was opened in its window (`readLog`) so that a 老實人 who missed it gets 「你冇打開到張卡，問到就答「張卡冇寫」」. That `Map` lives in one UI instance, and a shared phone remounts the UI on every hand-over (key `${gameId}|${seat}`). By the time the 老實人 takes the phone back with 換人 (C3, now possible), the record is gone, and a proxied look never mounted their UI at all. Spec §3.3 promises the honest line. Not hit this run (阿明 never came back) | `js/games/9upper/ui.js:61`, `:187-193`, `:419-421`; `js/ui/screens/play.js:1126-1128` (remount per seat) | Keep the record at module scope (`const READ_LOG = new Map()` outside `mount`, keyed by game start + round key + seat). Or, with N2, have the engine mark a look that ran without its reader (`r.unread`) so the card says 「你冇睇到張卡」 | 9upper |
| N6 | polish | ux | The 收皮啦 chips stay on screen, disabled, after the last card is used | 「🛑 收皮啦 · 剩 0 張」 with three disabled chips stays on the 揀老實人 screen. It reads like a second target list. The banner 「小美 對 阿明 出咗收皮啦」 already says what happened (p3) | `ui.js:258-300` (`el.hidden` only when `max === 0`); `:604`, `:626` | Hide the chips when `callouts.left === 0` and keep the header line or just the banner | 9upper |
| N7 | polish | text | After every 換題 the narrator repeats the whole prompt | 「換咗題。題目係「門口效應」。…有冇人已經識？識就出聲換題；冇人識就由阿聰㩒開始睇卡。」 played three times in a row in the replay | `script.js:112-116` | When `swapped`: 「換咗題：「門口效應」。{hint}仲有人識？」 | 9upper |
| N8 | polish | text | The 💡 hint at the reveal tells the table to wait for the 諗樣, but on one phone anyone taps 下一輪 | `hintFor` reveal, role `table`: 「睇吓真正解釋同分數，等諗樣繼續。」. On a whole-table phone the table view carries 「大家睇完 ✓ · 下一輪」 for anyone (behind 💡 only) | `script.js:203-205` | With `pass` and role `table`: 「大家睇完，任何一個㩒「下一輪」就得。」 | 9upper |

## One-phone checks that passed (from play and code)

- **Hand-over order.** The readers go clockwise from the 諗樣's left (`game.js:565`), a 💤 seat is left out, and after the
  last reader the phone goes back to the 諗樣 on the public card 「輪到 X · 解釋」. All three deals followed this.
- **Privacy of each hand-over.**
  - Each read gate is private: 「交俾 X · 其他人唔好望 · 睇卡 k/3」, opaque from frame one (C7). `openGate` closes every
    cover and puts the table view behind it (`play.js:440-442`).
  - A card and the 老實人's text exist only from that reader's own 「開始睇卡」 (`game.js:982-995`).
  - The 諗樣's steps (睇題目, 解釋, 揀老實人) use the **public** card (`game.js:1105`, `:1113-1118`). The 諗樣's screen has
    nothing secret, so the table may watch it, as §7.1 #4 intends.
- **Anti-tell on a shared phone** (the 9 s look replaces the eyes-closed step).
  - Every reader gets the same gate, the same 9 s started by their own tap and closed by the clock, no 我睇完, and the
    same card shape and length.
  - The 諗樣 never reads in pass mode.
  - p1, p3 and p4 all confirmed that a bluffer's look and the 老實人's look cannot be told apart.
- **No step waits for a seat that never gets the phone.** Each focus names one seat (the 諗樣 or the current reader), and
  the reveal names nobody. The only waits were on seats that were there but silent, and the escape row covered those,
  even though 9upper's answers to it were wrong (N1, N2).
- **No 「用自己部手機」-style lines on the one-phone path.** The together-mode notes 「大家望住自己部電話睇卡」 appear only
  without passPhone (`ui.js:455-461`, `script.js:184-188`), and `validate` forces passPhone on.
- **Table mode at the reveal (U4, U5).** Table card, then the table view, then one locked tap. Both reveals were read
  aloud in 語音.
- **Night anti-tell:** n/a. 9upper has no night, and "dawn to the middle" and co-wakers do not apply.
- **Scoring and the reveal screen.** Both rounds were exact. The reveal lists the 老實人, every 9upper, the pick line, the
  callout line, the true explanation with its source, and 分數變動.
- **Two-tap guards.** 換題 (counter 3 → 2 → 1), 收皮啦 (剩 1 → 0), 💤 and 🤖 all needed a second tap.

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p2 (blocker) | 「Hold-to-peek failed, I never saw my role」 | AI-artifact + tooling (T3) | The read started at 16:41:43 and the explain cue fired at 16:42:51, so 阿明's 9 s (reader 3/3) had ended before his `hold` arrived. By then the phone was on 小美's public card, and the referee rightly said 「你唔可以掂部手機」. A person taps 開始睇卡 and holds at once. A `peek` op fixes the console (T3) |
| p2 (major) | Peek window timing has no warning or fallback | AI-artifact | Same event. The window is fixed and equal for everyone by design (research: 「Exactly one card turn-over, 9 seconds. The honest player's slow reading is not extended」) |
| p2 (blocker) | Explain deadlock: 大熊 「🎤 講緊」 but never called | AI-artifact | 大熊's agent ended at about 16:48:45 (his own timeline). 小美 called him at about 16:54 (「大熊，我㩒咗你名喇」), then called 阿聰 at 17:00:13 and decided at 17:02:10. The table was never blocked |
| p4 (blocker) | The judge would not advance after 阿明 | AI-artifact | 小美 was cross-examining 阿明 (questions at 16:43:10 and 16:49:21), which the rules allow at any length. p4 stopped about 2.5 minutes after 阿明's answer |
| p2 (blocker) | No 換人 access to my own card during the explaining | app-is-right | In the explaining the 諗樣 holds the phone (rules 「用一部手機玩」: 「解釋嗰陣佢拎住…想睇返自己係咩，㩒上面個名換人，睇完擺返中間」). A non-holder asks the holder, and the hand-picked seat then holds (#9, `play.js:612`, `:635`). The referee correctly refused a non-holder's tap |
| p2 (major) | No re-peek after a missed window | app-is-right | Research: 「The honest player cannot re-read the card after step 4; do not offer a re-peek unless a lenient option is on」 (`rePeek` is off by default). Their role (honest or 9upper) is still on the reminder card via 換人 |
| p2 (major) | The phone screen is out of sync with the game | app-is-right | 阿明 **was** the speaker from 16:43 to 16:54 while 小美 questioned him. The list showed exactly that until she called 大熊 |
| p4 (major) | Nothing cues the judge to advance turns | app-is-right | The 諗樣's screen has the primary 「✅ 講完 · 下一位」 and the note 「㩒名叫佢講，講完㩒「✅ 講完」…」 (`p2-001.png`, `ui.js:499-511`) |
| p4 (major) | Spec does not say who advances turns with passPhone | app-is-right | Rules 「用一部手機玩」 and flow doc §3.4 「One phone」 say the 諗樣 ends every turn. A stalled 諗樣 goes to the host escape |
| p2, p4 (minor) | The judge announcing aloud that they know the term breaks the 我識 toggle | app-is-right | Research step 3: 「If anyone, including the Thinker, already knows the term, redraw」. Rules: 「出聲或者㩒「我識呢條」」 |
| p4 (minor) | The bluff decoy could be more natural | app-is-right | The decoy is within the 28–75 character band of spec §3.3 and has the same three-line shape (`script.js` `bluffDecoy`) |
| p1 (polish) | The host's own gate offers 「阿聰 唔喺度？」 | app-is-right | §7.1 #18: every named gate on the host device carries the row. On a whole-table phone the host device is the table's phone, and the host person can step away like anyone else |
| p1 (minor) | 「睇卡 1/3」 tells the table how many non-thinkers there are | app-is-right | The head count is public, and §7.1 #33 asks for walk progress on the gate |
| p1 (minor) | No narrator line saying why 阿明 was skipped | merged → N2 | |
| p1 (minor), p3 (major) | Every step of an absent seat needs open row → 🤖 → 再㩒一次 again; the gate keeps coming back | merged → N1 / N2 | 💤 already stops all waiting on a seat for the game. 🤖 is one step by design. The real problems are that 🤖 is offered for steps it cannot do properly (N1, N2) and that nothing points to 💤 (N1 fix) |
| p3 (major, part) | With 2 present 玩家, each can infer the other's role | app-is-right | That is 9upper at 3 players: 1 老實人 + 1 9upper (research Setup). The lobby line says 「人少，諗樣盲估都有一半機會中」. The 9upper gains nothing from knowing |
| p1 (major) | 💤 on the 諗樣 throws away the round and shortens the game | app-is-right; text part → N3 | By design: rules 「有人唔喺度」 (「佢係諗樣就換人做」) and research (「Thinker disconnects: void the round and hand the seat to the next player」). The missing warning is N3 |
| p1 (minor) | README lists 「⏭ 跳過佢」 but only 💤 / 🤖 appeared | app-is-right; README wording → tooling | ⏭ exists only in a multi-seat walk (`play.js:533-544`, §7.1 「walks only」). 9upper calls one reader at a time (`game.js:1111`) |
| p1 (minor), p3 (minor) | The 3 s 「再㩒一次」 window is too short, and the escape row closes on a second tap | AI-artifact + tooling (T7) | `ARM_MS = 3000` (`dom.js:161`). A person double-taps in well under 1 s. The row header is a disclosure toggle (`play.js:537`). A console `tap --twice` fixes it |
| p3 (minor) | The 諗樣's name buttons change index as people are called | tooling | The rows keep a fixed order (`v.explainers.map`, `ui.js:556`). Only the console's numbering of *controls* shifts when a row switches between a button and a plain line |
| p3 (minor) | Confirms for 換題 / 收皮啦 time out | AI-artifact | As above (`ui.js:220-232`, `:296`) |
| p3 (polish) | One tap on 「大家睇完 ✓ · 下一輪」 starts the next round for everyone | app-is-right | User decision U5: whole-table taps stay locked until the table card is dismissed, then one tap counts for the table. Both reveals were also read aloud |
| p3 (polish) | README should say that non-holders see the face-up screen on public steps | rejected | README already does: the row 「…during X's public step (`focus.open`) — everyone, read-only」 |
| p1 (polish) | Three known terms in a row make the game a coin flip | AI-artifact | An AI knows most terms. The 諗樣 still had 1 of 3 swaps left (`game.js:19`) and chose to keep 「篳路藍縷」 |
| p1, p3 (minor) | Two seats silent for 10–25 minutes | AI-artifact | Agent stamina: 大熊's run ended after about 9 minutes and 阿明's after about 30 minutes. Not app behaviour |

## AI-artifacts (would not happen with people)

- 大熊 (p4) ended his run at about 16:48 and 阿明 (p2) at about 17:09. Every escape use, the round-2 void and the 71-minute
  session came from that.
- 阿明's lost round-1 window: more than 9 s between his `tap 開始睇卡` and his `hold`.
- The missed 3 s confirms (換題, 收皮啦, 代佢做, 當佢缺席) came from command latency.
- AI testers know most terms, so the 「known term → swap」 loop ran more often than at a human table.

## Tooling notes (`tools/playtest/pt.mjs`, README)

| # | problem | effect in this run | fix |
|---|---|---|---|
| T3 (open) | No `peek`. `hold` is capped at 8000 ms (`pt.mjs:906`), and the 9 s starts at the separate 「開始睇卡」 tap | 阿明 lost his r1 look. 阿聰 and 小美 saw only 2 s on their first try | `peek <session> <seat>`: tap 「開始睇卡」 and hold the cover until the window closes. Raise the cap to 15 s. Document it in the README |
| T7 (open) | No `tap --twice` for arm-then-confirm (3 s) | Repeated 「no control matching 再㩒一次」, and the escape row was closed by a blind second tap | `tap <n> --twice` (two clicks about 300 ms apart). Make `tap "再㩒一次…"` succeed while the arm is live |
| T8 (new) | The referee's 60 s escape delay (`PT_ESCAPE_AFTER`, `pt.mjs:64`) reads like app behaviour | p1 and p3 reported 「the escape only works after 60 s」. The app shows the row at once | The README should say the delay is the console's rule, not the app's, and print 「（console: escape usable in N s）」 on the host's screen |
| T9 (new) | README lists 「⏭ 跳過佢 / 💤 / 🤖」 for every gate | p1 looked for ⏭ on a one-reader gate | README: 「⏭ only when the phone is walking several seats through one step」 |
| T10 (new) | `wait` prints the full screen on every return | Long, repetitive output, and slow agents fell further behind | `wait --diff`: print only changed lines plus new table and narrator lines |
| T11 (new) | No liveness per seat | The host could not tell a slow agent from a dead one, and waited 8–13 minutes at gates | `hear` / `wait` print 「上次出聲 / 上次指令」 per seat. The orchestrator restarts or replaces a seat whose agent has ended (both silences here were agents that had stopped) |

## Reviewer's checks (read-only, after the players stopped)

1. Engine state via `window.__app._room.session.state`: `phase: reveal`, `roundNo 2`, `judges [p3, p1, p2]`,
   `totalRounds 3`, the void entry above, and replay round `spoken: []` / `turnNo: 1` / `honest: p2` / `readDone: [p2, p3]`
   (阿明 counted as read although nobody held the phone: N2).
2. Scoring recomputed for both rounds: exact.
3. The 🤖 trace for the 諗樣 in explain was replayed by hand on the engine code (explainers `[p3, p1, p2]`): the 3 proxies
   matched the screens. The 4th to 6th proxies would run the `back` lap, and the 7th would `pick` at random (N1).

The table was stopped with `node tools/playtest/pt.mjs stop sp2-9upper`.
