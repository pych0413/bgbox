# 狼人殺 (werewolf): one-phone playtest review

Session `sp-werewolf`, 2026-10-04 08:20–08:52 UTC. Six AI players (p1 阿聰, p2 阿明, p3 小美, p4 大熊, p5 阿強, p6 阿珍) shared **one** phone through the console (`--shared`). A referee decided who held the phone, enforced the hand-over cards, and kept everyone's eyes closed at night.

**Settings.** Board `6-sw`: 2 狼人, 預言家, 女巫, 2 平民. 屠城, witch may save herself on night 1. Pace slow, 60 s speeches, 60 s 遺言, no vote clock (the single-device defaults). Narration 🔇 靜音, which the harness chose.

## Verdict

**The game finished.** Good won at about 08:52 UTC after about 32 minutes: 阿聰 was exiled on day 1 (4 votes to 2), and 阿珍 lost the day-2 PK after a 2–2 tie.

**One-phone werewolf is not fair to play yet.** Three problems come from the app:

1. **Blocker.** After every night the phone stays with whoever acted last, and the seat chip reads 「而家睇：<that person>」. On this board that is the seer, every morning.
2. **The day never moves the phone.**
   - Speeches, 遺言, 我講完 and 💥自爆 only work on the holder's seat.
   - In 靜音 nobody else could see any of it. 6 × 60 s of speeches looked like a 6-minute stall by the seer.
3. **Passing the phone between wolves failed on both nights.**
   - Night 1: nothing tells the first wolf that 確定 passes the phone on. The rules point to a 換人 path instead, and that path puts the teammate's name on the hand-over card.
   - Night 2: the hand-over card went to the dead wolf first, so the night became 空刀.

**Two referee bugs in the console also distorted the match:**

- It read the 「交俾 阿珍」 card out as narration to the eyes-closed table. That became the main case against 阿珍.
- It gave 阿珍's night-1 hand-over card to 阿聰, so she was refused.

**What worked well:** the deal with hand-over cards, hold-to-peek, the witch's night-1 panel, the vote gates, the PK rules, and the night-by-night recap.

## Finished?

Yes. `room.lastResult`: 「好人隊贏：狼人全部出局」, winners p2–p5. The recap matches every report:

- **Night 1.** 阿聰 picked 阿明; 阿珍 did not pick. The witch saved 阿明. The seer checked 阿聰 and saw 🐺.
- **Day 1.** 阿聰 exiled, 4 votes to 2.
- **Night 2.** 阿珍 did not pick, so 空刀. The witch used nothing. The seer checked 阿珍 and saw 🐺.
- **Day 2.** 阿珍 and 阿強 tied 2–2, and 大熊 got 1 vote. In the PK, 阿珍 got 2 votes to 1 and was exiled.

## What really happened (from the recap, the timings and the code)

- **The "dawn stall" was the speech phase.** Day 1 ran 6 speeches × 60 s (08:27 → 08:34). Day 2 ran 5 × 60 s (08:41 → 08:46). The timings fit to the minute.
  - Speeches have no focus, so the phone stayed with the seer, who had acted last.
  - Only he could see 「X 🎙 講緊」. The others kept saying 「阿強，show 部手機」.
- **阿聰's 遺言 did run** (`game.js:1123` → `deathSteps`). It ran for 60 s on 阿珍's phone, after she cast the last vote. 阿聰 never knew he had last words.
- **Night 1, wolves.**
  1. The anonymous card went to 阿聰, the first wolf by seat.
  2. He picked 阿明 without pressing 確定, so the phone did not move on.
  3. He opened 換人 and chose 阿珍. The card read 「交俾 阿珍」.
  4. The referee wrongly let only 阿聰 tap it. 阿珍 got the phone with seconds left and never picked.
  5. The kill went ahead on 阿聰's pick alone.
- **Night 2, wolves.** The wolves' focus includes dead holders, sorted by seat. The card therefore went to the dead 阿聰. 阿珍 was refused, the window ran out, and the night was 空刀.
- **Voting.** Whoever held the phone when the vote opened (the seer) voted first, with no card. That is why the others saw 「已投 1/6」 and 「3/6」.

## Confirmed findings

| # | Sev | Category | Title | Root cause | Fix | Owner |
|---|---|---|---|---|---|---|
| 1 | **blocker** | tell | Every dawn names the last night role (here the seer): the phone and the 「而家睇：X」 chip stay on that seat | `game.js:1285-1312` gives no focus at dawn. `play.js:344` keeps `activeSeat` when there is no focus. `play.js:634` shows the name once the step is no longer secret | On a shared phone, switch to the table view when night ends (`st.table` exists in local mode) and show a neutral card 「天光喇 · 部手機擺返枱中間」 with chip 「📱 枱中間」. Or the engine sends a fixed public focus at dawn. Add a test: dawn holder and chip do not depend on roles | shell + engine |
| 2 | major | flow | Speeches and 遺言 never hand the phone to the speaker. 我講完 and 💥自爆 only work for the holder. In 靜音 the speech phase cannot be seen | `game.js:1285-1312` (no focus for speech/words). Doc `werewolf.md:372-373` chose 「→ nobody」. `ui.js:485` and `ui.js:525` show those buttons only for the seat on screen | On a single device, hand speech/words to the speaker with a named card 「交俾 X 發言」 (focus `{pids:[c.pid]}`). He then has 我講完 and his own 自爆. Show the speaking order on the table view. Update doc §4 | engine + doc |
| 3 | major | missing-right | Night 2: the dead wolf is first in line, so the live wolf never got the phone → 空刀 | `game.js:1297-1299` includes dead holders and drops a wolf only when he locks. `play.js:311-314` sorts by seat. `script.js:603`: the dead player's screen has no instruction | List living unlocked wolves first, or drop dead wolves on a single device. Keep the order of `focus.pids` in the shell. Dead-wolf screen on a shared phone: 「㩒「跳過」，將部手機交返出去」. Add a test | engine + shell |
| 4 | major | handover | Passing between wolves is never explained, and the rules contradict the engine | `game.js:1299`: moves on only after 確定. `script.js:617`: 「即時顯示」. `script.js:195`: points to 「⋯ → 換人」, which does not exist and names the teammate. `play.js:331-341`: the card is bound to the lowest-seat wolf | Preferred: one wolf screen for all awake wolves, ended by one 確定 (「隊友一齊睇住部手機，揀好㩒確定」). Otherwise say 「揀好㩒確定，部手機會叫下一隻狼」 and remove the 換人 instruction | script + engine |
| 5 | minor | tell | 換人 during a secret step names the person on the card (「交俾 阿珍」), although the menu hides names. It can also open any seat's night screen | `play.js:357` always uses the name. `play.js:414` hides names when the step is secret | In secret steps, title the card with the role prompt or 「交俾下一位」, and only offer seats that are being called | shell |
| 6 | minor | flow | The 票型, 遺言 and dawn screens stay with the last holder and move on by their own clocks (tally about 8.8 s, then 遺言, then night) | Same gap as #1 (no focus for say/words/dawn) | Use the table view from #1 for every public announcement. Optionally hold the tally until 「大家睇完」 on a single device | shell + engine |
| 7 | minor | ux | 靜音 is allowed for one-phone werewolf with only the generic note. With eyes closed, nobody knows their role was called | `lobby.js:444`. Doc `werewolf.md:15` says 「printed on every phone」, which is false for one phone | One-phone werewolf: default to 語音 and warn 「一部機 + 靜音：夜晚閉眼冇人知叫緊邊個」. Correct the doc | lobby + doc |
| 8 | minor | flow | Found in the code: the 新手慢慢嚟 preset (no speech or 遺言 clock) stalls every speech on one phone, because the speaker never gets it | Preset at `game.js:314`. `blocking()` at `game.js:1352-1353`. No focus for speech | Fixed by #2. Until then, keep `speakSecs` on a single device | engine |
| 9 | minor | text | Text assumes one phone each or names controls that do not exist | `script.js:481` (spoken 「大家將部手機放喺面前」), `script.js:181` (「自己部手機」), `script.js:195-196` (「⋯ → 換人」, 「⋯ → 下一步」) | For one phone: 「將部手機擺喺枱中間」. Name the real controls (the 換人 ⇄ chip, ⋯ → ⏭ 跳過呢步) | script |
| 10 | polish | ux | 「（你）」 / 「你」 on screens the whole table reads: every seat in the lobby, 「大熊（你）」 in the results, a shown PK screen 「你係 PK 嘅人」 that misled 大熊 | `SeatEditor.js:105,127`. `results.js:286` → `Scoreboard.js:50`. `VotePanel.js:102`. `werewolf/ui.js:64` | When one phone holds several seats, drop 「（你）」 in the lobby and results, and use names on screens laid face up | shell components |
| 11 | polish | handover | On a shared phone the current holder votes first instead of in seat order (seen as 「已投 1/6」, 「3/6」, 「2/5」) | `play.js:344`: no card when the holder is one of the voters | Always hand the vote to the first voter in seat order, or document the current behaviour | shell |

### Details on the top four

1. **Dawn tell (blocker).**
   - The night order is wolves → witch → seer, so the seer always ends the night holding the phone.
   - At dawn the night overlay lifts. The chip then shows 「而家睇：阿強」 even if he put the phone back in the middle.
   - A dead holder still takes the phone for his role step, so a dead seer is named too. With a hunter on the board, the hunter is named instead.
   - The table used this twice: 小美 at 08:36:10 and 08:48:46.
2. **Day phase.**
   - Flow doc §4 deliberately sends speeches and 遺言 to nobody. That only works if the phone lies face up and someone reads it aloud.
   - Even then, 我講完 and 💥自爆 belong to the seat on screen. A wolf who is not the holder can never explode, which both wolves reported.
   - Handing the phone to each speaker also fits the research's 「自爆 only during own speech」 variant.
3. **Dead wolf first.** The shell re-sorts focus by seat. Ordering in the engine alone is therefore not enough, and `focusSeatsHere` must keep the engine's order too.
4. **Wolf hand-over.** The research's one-phone design has wolves pick in turn and see earlier picks. On a shared phone with eyes closed, every wolf is awake at the same moment. One shared wolf screen is simpler, and it removes both 換人 and the naming card.

## Rejected and merged reports

- **p2: seer claiming in public should be discouraged.** The app is right: claiming and 悍跳 are part of play, and the research says 'the seer may claim anything'.
- **p2: no decoy wake for villagers on one phone.** This is the research's 'eyes-closed narrated night, phone in the middle' option, which doc §4 chose. Every role on the board, dead holders included, is called every night.
- **p2/p4: the holder timeout is 2–4 minutes.** Misread: those were the speech clocks. See #2.
- **p2: voting needs a pass per voter.** That comes with one phone, as doc §4 says.
- **p2: no death announcement.** There is one (the 8 s dawn screen, then 「🌅 昨晚：…」), but it was on the seer's phone. See #1 and #6.
- **p5: the tally has no 票型.** The app is right: the tally names every voter, as do the recap and the fold. The console flattens the text, as the README warns.
- **p5: a peaceful night gives no cause.** The app is right (research Procedure step 4: 'no cause').
- **p5: role-step narration could leak.** The app is right: every role is called every night for the same length (`game.js:1295-1297`).
- **p5: the phone went read-only in the PK.** Console behaviour for a non-holder. The PK candidate's own screen explains it.
- **p1/p6: no 自爆 on the vote screen.** The app is right: the research denies an explode once voting has started. The real problem is #2.
- **p1: 「冇揀」 rather than 空刀.** The wording is right (doc §3.9). The cause is #3.
- **p3: the seer's result might show at dawn.** The app is right: the dawn replaces the panel and his notes sit under the 📓 cover.
- **p3: the witch's night-2 step never came.** Not shown to be an app bug.
  - Her focus is [p3] (`game.js:1297-1300`), and the card opens for her (`play.js:331-341`). 阿珍 heard 「女巫請拎起部手機」.
  - The likely cause is tooling T3 plus AI response time inside a 30 s window.
- **p4: the PK said I cannot vote.** He was reading 阿珍's screen laid face up. See #10.
- **p6: the wolf never got the phone.** Split: night 1 is tooling T2 plus #4; night 2 is #3.
- **p6: 已投 5/6 tells the last voter the result.** Harmless, since seat order is public.
- **p6: the phone stays with the last dealt player into the night.** Harmless: that screen is fully covered by the shared-phone night overlay.
- **p6: wording 「叫到你先好拎」 / 「揀一個先」.** The first is console text. The second is fine Cantonese.
- **p6: `hear` ignores seconds.** Wrong usage: it takes a line count.

## Behaviour a slow human could also run into

These come from AI players, but slowness alone does not explain them:

- **The 6-minute "stall".** A person would probably lay the phone face up at dawn; the AI seer never ran `show`. The chip still names him (#1), and the buttons are still his (#2).
- **阿聰 used most of the 50 s wolf window finding 換人.** A human would also be lost: #4 is real.
- **小美 missed the 30 s witch window.** Mostly console T3 and model response time.
- **Report quality.**
  - p5 marked every right `couldUse: false` while writing 「Fully preserved」.
  - p4 gave 06:20 UTC and 45–50 minutes, and p5 gave about 90 minutes. The real values are 08:20 UTC and about 32 minutes.
  - p1 thought 「The step ended on her confirm」, but the recap shows 阿珍 never picked.

## Tooling notes (`tools/playtest/pt.mjs`)

- **T1, major. The referee reads hand-over cards out as narration.** At `pt.mjs:448`, eyes-closed players get 「旁白：「${r.gate}」」, which is the card's text. The real narrator never speaks card text. This sent 「交俾 阿珍」 to the whole table, and it became the main evidence against her.
  - **Fix:** for eyes-closed players, print the real narration line (`state.cue.text`). Never print a card that names a seat; print 「有人傳緊部手機」 instead.
- **T2, major. Wrong person allowed to tap a named card during a secret step.** At `pt.mjs:446` the target is `called[0]` whenever the step is secret, even for a card that says 「交俾 阿珍」. 阿珍 was refused, and 阿聰 tapped her card himself.
  - **Fix:** if the card matches `交俾 <name>`, target that name. Use `called[0]` only for the anonymous role prompt.
- **T3, major. `wait` misses a card that is already up.** At `pt.mjs:585-590`, `wait` waits for a change from the state at the moment it is called. A card already showing for the caller is only printed after it closes. This most likely cost 小美 her night-2 witch step.
  - **Fix:** return at once if the first view is something the caller can act on and has not been printed to this seat yet (keep the last printed key per seat).
- **T4, minor. `wait` ignores table talk.** It does not return on new `say` lines. Add new chat lines to its output, or return when one arrives.
- **T5, minor. By day, non-holders can see nothing until the holder runs `show`, and are told to demand the phone.** At `pt.mjs:458` the message 「等佢交俾你（佢㩒「換人 ⇄」揀你）」 pushed players to ask for the phone. At a real table a day screen lies face up.
  - **Fix:** in public phases (dawn, speech, tally, results), let everyone read the screen unless a card or ballot is up. When an automatic card is due, say 「gate 會自動出」.
- **T6, polish.**
  - `wait` sometimes prints the same state two or three times.
  - `p4-003.png` came out as a 2×2 grid of four half-size copies. Two seats were probably capturing or changing the shared window's size at once. Serialize `shot` on a shared phone.
  - For one-phone werewolf runs, use `--narration read` so the eyes-closed table gets real cues (#7).

## What worked

- **The deal.** Hand-over cards went seat by seat, the hold-to-peek card showed each role, and 「n / N 人睇完」 gave a count, never names. No secret leaked.
- **Night privacy.** The night-1 wolf screen showed 「隊友：6號阿珍」 with 🐺 tags. Night prompts named no one (「狼人請拎起部手機」), and the shared-phone overlay fully covers the last holder's screen between steps.
- **The witch's night-1 panel.** It names the victim and the potions left. The confirm button says which potion it will use (「💊 用解藥救 2號阿明」), and one potion per night is enforced.
- **Votes.** Each ballot went behind its own named card and stayed secret until the tally. The tally names who voted for whom. PK speeches went in seat order, tied players could not vote, and the eligible count read 「已投 0/3」.
- **The end screen.** It gives a one-line why, reveals every role, and shows a night-by-night recap of hidden actions, which made debugging this match possible.
- **Session state.** Stopped with `pt.mjs stop sp-werewolf`. The other running session, `sp-avalon`, was left alone.
