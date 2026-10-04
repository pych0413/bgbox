# 一夜終極狼人 (onuw): one-phone re-run review

> Session `sp2-onuw`, `--shared` (ONE 390x844 phone passed round a 5-seat table), 2026-10-05 17:53–18:07 UTC.
> Build under test: the local server on port 5199, serving HEAD `328b04f` (the working tree differs only by two untracked docs), so the line numbers below are the code that ran.
> Config: auto 5-player preset (狼人 ×2 · 預言家 · 強盜 · 搗蛋鬼 · 村民 ×3, 3 in the centre), loneWolf on, ringVote on. One phone sets pace slow (×1.5), `passPhone` (+8 s per role step), discussion 5:00 and narration 🔊 語音.
> Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強. Reviewer: opus, read-only (no code edited).
> Compared with run 1: `docs/playtest/single/onuw.md` (C1–C12, T1–T7) and `docs/playtest/single/SUMMARY.md` (decisions U1–U12).

## Verdict

**Finished, and the rules were correct.** The rules engine handled every step correctly, and the run-1 one-phone fixes are in:
- Dawn sends the phone to the middle.
- Every voter gets a gate.
- The two wolves share one screen.
- 靜音 is not offered.
- Every role step gets the +8 s pad.
- The countdown shows seconds.
- The reveal is neutral (no 「你贏咗」).

**The night "blocker" is AI latency.** All five players called the lost night actions a blocker. In fact each window ran its full 26/26/23/23 s from the moment its gate appeared, and 小美 tapped the gate with 3 s left.

**Two new majors:**
1. **The vote walk starts from the last seat that held the phone** (R1). After a day when nobody touches the phone, that is the last seat that acted at night, so the first ballot gate names the night's last actor. Run-1 C1 leaked the same information through the dawn screen.
2. **One tap from anyone ends the discussion** (R2). 「大家夠鐘投票 ✓（一下就得）」 has no confirm, and the narrator then says 「時間到！」. It cut the day off with 2:11 left, before the Seer had spoken.

There are also five minor findings that the players did not see, read from the code and the narrator timing: dawn wakes everyone while the last actor may still hold the phone, the cover's words during each cue, the silent sequential vote, the lapse note, and the hint glossary.

## Facts from the table

| | |
|---|---|
| Deal | 阿聰 🗡️ 強盜 · 阿明 🔮 預言家 · 小美 🌪️ 搗蛋鬼 · 大熊 🐺 · 阿強 🐺. Centre: 村民 ×3 |
| Night (`reveal.recap`) | 狼人: 大熊 and 阿強 recognised each other (one combined screen, U2). 預言家, 強盜 and 搗蛋鬼 all 「冇用能力」 |
| Window lengths | begin 4.5 s · werewolf **26 s** · seer **26 s** · robber **23 s** · troublemaker **23 s** · dawn 3 s (`game.js:364-379`: base ×1.5 + 8 s). The narrator lines were 15/35/35/32/32 s apart, so each cue took about 9 s |
| Day | Started at about 17:58:3x UTC. 「大家夠鐘投票」 was tapped at 18:01:35 UTC with about 2:11 left. 阿明 never spoke |
| Vote walk | 小美 → 大熊 → 阿強 → 阿聰 → 阿明, each behind 「交俾 X · 投票 · 搞掂 n/5」 |
| Ballots | 阿聰→阿明 · 阿明→大熊 · 小美→阿明 · 大熊→阿明 · 阿強→阿明, so 阿明 dies with 4 votes |
| Result | 「狼人隊贏 — 冇狼人死」, winners `[p4, p5]`. Correct: wolves are among the players, none died, and there is no Tanner (research Voting & resolution) |
| End state | Nobody tapped 大家睇完, so the reveal went to results on its 3-minute fallback. `room.phase = results`, `history` has 1 entry, `lastResult.summary` is as above |

Timeline (UTC, 2026-10-05):
- 17:53:43–48: everyone said 準備好.
- 17:54:02: deal cue; deal walk p1 → p5 with hold-to-peek.
- 17:55:53: begin cue (「部手機放喺枱中間，大家一隻手放喺枱上…」).
- 17:56:08: wolves called; window about 17:56:17–17:56:43; both wolves on one combined screen.
- 17:56:43: Seer called; window about 17:56:52–17:57:18; 阿明 never tapped the gate.
- 17:57:18: Robber called; window about 17:57:27–17:57:50; 阿聰 never tapped the gate.
- 17:57:50: Troublemaker called; window about 17:57:59–18:58:22 → about 17:57:59–17:58:22; 小美 tapped with 3 s left and her pick missed.
- 17:58:22: dawn cue and the 天光 card; claims: 大熊 村民, 小美 搗蛋鬼, 阿聰 強盜, 阿強 村民.
- 18:01:35: 夠鐘投票 tapped (by whom is unknown); vote cue 「時間到！…」.
- 18:04:21: reveal cue: 阿明 died, wolves won.
- About 18:07:21: the 3-minute reveal fallback moved the room to results.

## Fixed since run 1

| run 1 | status now | evidence |
|---|---|---|
| C1 dawn left the phone face up on the last waker's screen | **Fixed** | 「☀️ 天光喇 · 部手機擺返中間」 at dawn (play.js:600-608). Every player saw the table view by day |
| C2 the first ballot opened with no gate | **Fixed** (every voter is gated, 0/5 … 4/5). The walk's starting point is a new leak, see R1 | p1, p3, p5 gate lists |
| C3 night windows included the hand-over; the bar restarted; the lapse note read like declining | **Fixed** | +8 s pad (game.js:367-378); bar drawn from `windowMs` with 「仲有 N 秒」 (ui.js:96-131; p3 saw 「⏳ 仲有 3 秒」); lapse note 「冇確定（時間到或者唔想用）」. Its remaining ambiguity is R6 |
| C4 靜音 / 讀稿 broke the night | **Fixed** (U1) | `meta.eyesClosed` (game.js:314); the NarratorBar in p1-005.png offers 語音 / 讀稿 only; setup set 語音 |
| C5 the second wolf or Mason could not get the phone | **Fixed** (U2) | Both wolves woke on one gate and one combined screen (p4, p5; ui.js:445-545) |
| C6 「🎉 你贏咗！」 / 「（你）」 on the shared reveal | **Fixed** | p1-005.png: per-row ✅贏 / ❌輸, no 你 |
| C7 the ring vote cost a second hand-over | **Fixed** (#24) | Agreeing comes with a fallback ballot in the same turn (game.js:792-797); 「⭕ 全枱同意圈票」 on the table screen |
| C8 夠鐘投票 / 睇完 needed every seat | **Fixed, but over-fixed**: one tap with no confirm, see R2 | ui.js:771 |
| C9 own-phone wording, stale one-phone rules | **Mostly fixed** | dealTipShared, helpVoiceShared, ackSubShared, cueVote passPhone and a rewritten 「用一部手機玩」 (script.js:182-187). Two lines remain, see R9 |
| C10 the reach for the phone is heard | **Built** (U8, `nightAmbient`, game.js:315); not audible headless | README quirks |
| C11 「（你）」 on every lobby seat | **Fixed** | SeatEditor.js:127-128 |
| C12 the ring help did not say what "nobody dies" means | **Fixed** | script.js:762 |
| T1 night countdown missing from `see` | **Fixed** | p3 saw 「[⏳ 仲有 3 秒]」 |
| T3 cues never reached `hear` | **Fixed** (fake TTS → 🔊 旁白) | `hear` |
| T4 narration was 靜音 | **Fixed** (語音) | setup |
| T5 the day screen was hidden from non-holders | **Fixed** (table level) | p1–p5 read the day screen |

## Still open from run 1

- **T2 / T6 (tooling)**: a failed tap still says only 「no control matching」 or 「control [n] is gone」, and there is still no multi-step tap. These are the main reasons no AI could act at night. See T2 and T4 below.
- **T7 (tooling)**: no `shot --full`.
- **C9 leftovers**: R9.
- **C10, long term**: the research's pass-around night is not built (U8 chose to keep pick-up-from-the-middle plus the noise bed). It is accepted, but the rest is still leaked by a hand that is off the table, and R3 adds a case.

## New confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| R1 | major | tell / privacy | The vote walk starts at the last seat that held the phone; after a quiet day that is the last night actor | The vote focus names all 5 seats and the phone is in the middle at vote start, so `walkHere` orders the seats clockwise from `lastHolder`. A seat becomes `lastHolder` whenever the phone lands on it, including the waker who tapped a night gate, and neither dawn nor the table card clears it. If nobody picks up the phone by day, the first gate 「交俾 X · 投票 · 搞掂 0/5」 names the last seat that acted at night. In the 5-player set that is the Troublemaker, else the Robber, the Seer or a wolf. Run-1 C1 leaked the same information. This run went 小美 → 大熊 → 阿強 → 阿聰 → 阿明. 小美 was both the last night actor and the last day holder (she read her 📓), so the run alone cannot say which rule picked her; the code path is clear either way. Players noticed only that the order was unexplained (p1, p3, p5). `lastHolder` also carries into 再來一局's deal | `js/ui/screens/play.js:407` (`from: holder ?? lastHolder`), `:419-422` (land), `:451-456` (anon gate lands on the waker), `:600-608` (dawn keeps it), `:560-575` (resetShared never clears it); `js/ui/logic.js:198-214` | Clear `lastHolder` at dawn, whenever the table card goes up, and in resetShared. A walk that starts with the phone in the middle starts from the first seat in table order (or the host). Show the order on the first gate or in the vote cue (「投票次序：阿聰 → 阿明 → …」). The same shell code runs the werewolf and cheese-thief votes after a night | shell |
| R2 | major | integrity / flow | One tap from anyone ends the discussion: 夠鐘投票 has no confirm, and the narrator says 時間到 | On the table screen, 「🗳️ 大家夠鐘投票 ✓（一下就得）」 sends a whole-table `ready-vote` for all 5 seats, so the vote starts at once. Here it ended the day with about 2:11 left, before the Seer had spoken, and he was voted out. The 圈票 button beside it and the reveal's 大家睇完 both take two taps; the button that ends the day takes one. The research asks for an early-vote button that is "host-confirmed". The cue then says 「時間到！」 with 2 min left. Nobody could tell who had tapped | `js/games/onuw/ui.js:771` (compare `:772-775`, `:646-651`); `game.js:764-769`; `script.js:867`, `:405-407`; `docs/games/onuw.md` §3.4 | Wrap the tap in `api.confirm` and show the time left (「全枱都夠鐘？仲有 2:11 — 再㩒一次即刻投票」), as U5 did for undercover. Drop 「（一下就得）」. Give `cueVote` an early variant (「夠鐘投票！…」) for a vote started before the deadline. Update §3.4 | onuw |
| R3 | minor | anti-tell | Dawn says 大家睜開眼 the moment the last window ends | The dawn cue is the last step's close line plus 「天光喇，大家睜開眼！」, spoken as soon as the last deadline passes. The 3 s dawn window comes **after** it. A slow last actor is still holding the phone when everyone opens their eyes. Here 小美 was mid-pick at the 17:58:22 UTC deadline, and her next tap hit 「☀️ 天光喇」. The 天光 card also comes up while the narrator is still saying 「搗蛋鬼，請閉眼」. In a 5-player game the last role step is almost always the Troublemaker | `game.js:383-396`, `:1066-1072`, `:1265` (the dawn view is not `night`, so `play.js:600-608` shows the card at once); `script.js:395-400` | With passPhone: dawn cue 「搗蛋鬼，請閉眼。大家閉住眼，部手機擺返中間。」, then the fixed dawn window, then 「天光喇，大家睜開眼！…」 as the day's first cue. Keep `night` true until the dawn window ends | onuw |
| R4 | minor | ux / flow | During every spoken night cue the phone tells the called role to put it back | The anonymous gate opens only at CUE_DONE, 5–9 s after 「X，請睜開眼」 (about 9 s here). Until then the opaque cover reads 「📱 擺返中間 · 部手機放返枱中間，閉埋眼」. A person who reaches as soon as their role is called is told to put the phone back and close their eyes. p3's first `see` after waking showed closed eyes, and the gate came about 5 s later. No AI looked at the phone during a cue | `js/ui/logic.js:152`, `:173`; `game.js:1007-1009`, `:1094-1099` | While a night cue is playing (`view.step.stage === 'cue'`), use different cover words: 「🌙 聽緊旁白 · 叫到嘅角色：講完張卡就出」. Or open the gate when the cue starts and keep the window clock from CUE_DONE. Every step stays the same length | shell + onuw |
| R5 | minor | integrity | The one-by-one vote never says to stay quiet until everyone has voted | In the official rules everyone points at once on a 3-2-1 count. On one phone the ballots take about 2:46 and nothing asks for quiet. 小美 (18:01:39 UTC) and 阿聰 (18:01:56 UTC) announced their votes during the walk, and 阿明 voted last under that pressure. fake-artist already has 「全部投完先好講」 | `script.js:405-407`, `:788`; compare `js/games/fake-artist/script.js:50` | Make the passPhone cue 「…部手機逐個交，全部投完先好講，最後一齊公開。」 and the gate label 「投票 · 投完先好講」 | onuw |
| R6 | minor | text | The lapse note cannot tell 'I declined' from 'time ran out', although the engine can | Every called seat that did not act gets 「今晚你冇確定（時間到或者唔想用）」, and the public log says 「冇用能力」. p1, p2 and p3 could not tell what had happened. Tapping the big button without a pick sends `ack`, which is a deliberate decline | `game.js:704-719` (ignores `s.acked`); `script.js:457-459`, `:499-500` | Record `declined` when the seat acked without acting (「強盜：你揀咗唔換牌」), otherwise `idle` (「強盜：時間到，你今晚冇換到牌」). Make the same split in the public log | onuw |
| R7 | minor | text | The 💡 sheet's 「🎭 呢局有咩角色」 lists all 13 roles | On the table view hints.js lists every role in rules.roles (化身幽靈, 爪牙, 皮匠…) under a heading that means 'in this game'. The game has only 狼人, 預言家, 強盜, 搗蛋鬼 and 村民 (p4-003.png, p5-004.png) | `js/ui/hints.js:51-61`, `:93-95` | Filter by `view.roleList` when the view has one, with counts. Otherwise title the list 「🎭 全部角色」 | shell |
| R8 | polish | ux | Putting the phone back by hand costs a second tap | After 「📱 擺返中間」 the public card 「部手機擺返中間 · 👀 大家睇緊 · 㩒一下」 comes up over the day timer and someone has to tap it. Checking your own notes costs chip, name, gate and put-back, then this card (p1 met it twice, p3) | `play.js:705-711`, `:113`, `:499-517` | Needs a decision (it touches U4): `toTable({ card: false })` when the holder taps 擺返中間 themselves, or let the card dismiss itself after about 3 s | shell |
| R9 | polish | text | Run-1 C9 leftovers: two lines still assume one phone each | 「呢輪冇你份：照㩒大掣，扮有嘢做。」 and the Doppelgänger's 「照㩒大掣就得（當假動作）」. On one phone the big button means 'done, put it back'. The sleep line is probably unreachable; noAction is reached by a Doppelgänger who copies a role with no night action | `script.js:746`, `:839` | Add a shared variant: 「呢個角色夜晚冇行動 — 㩒大掣，部手機放返中間」 | onuw |

## One-phone checks that passed (from code and play)

- **Hand-over order and privacy.** The deal walks p1 → p5 behind 「交俾 X · 其他人唔好望 · 睇牌」, with a hold-to-peek card that covers itself on release; 「記住喇」 hands the phone straight to the next gate. Night gates are anonymous (the role, never a name), one per step, opaque from the first frame. Dawn goes to the middle for every role assignment. By day a seat reads its own 📓 through chip → own name → private gate. Every ballot is behind its own gate. 「已記住 n/5」 and 「已投 n/5」 count without names.
- **Co-wakers (U2).** Both wolves took one gate and shared one screen, and each 📓 is labelled with its owner.
- **Nothing waits forever.** Night windows are timed. The deal and vote gates have the host's 「X 唔喺度？」 row. The day ends on its timer. The reveal fell through to results after 3 minutes.
- **Night anti-tell.** Each step kind has a fixed length (26/26/23/23 s here) whoever is awake, there is no tap counter at night, the shared phone is muted with the noise bed on, and 靜音 is not offered.
- **Rules.** Max 4 ≥ 2 with a single top kills 阿明. Wolves among the players survive and there is no Tanner, so the wolf team wins (research Voting & resolution and the win formulas).

## Rejected findings

| reported | by | why |
|---|---|---|
| Night: Seer, Robber and Troublemaker lost their abilities (blocker) | p1, p2, p5 (p3, p4: major) | AI latency. Each window ran its full length from the moment its gate appeared: 26/26/23/23 s (game.js:364-379). The narrator lines were 35/35/32/32 s apart, which is about 9 s of cue plus the window. p3 saw the gate and tapped with 3 s left. A person needs about 10–15 s, and the official narrator counts to ten |
| Padding was not applied; only ~3 s were available | p5 | Refuted by the timing above |
| The step should wait for the actor to take the phone; allow a grace period for a half-made pick | p1, p3 | The app is right. DESIGN §4 says "Steps never end early because the actor finished. A fixed duration per step." The research says every cue is played "even if the card is in the centre, each with the same fixed length plus padding". Waiting would make live steps longer than centre steps |
| Use 「X 唔喺度？」 at night | p1 | DESIGN §7.1 #18: never on an anonymous gate and never at night |
| No countdown at night | p5 | It exists: p3 saw 「[⏳ 仲有 3 秒]」 (ui.js:96-131) |
| The gate was bypassed at the Seer step | p2 | No evidence of a bug. One anonymous gate opens per step (play.js:653-665), and the same path worked at the wolf and Troublemaker steps. p2's polling missed it |
| Hint sheets open automatically | p2, p5 | 💡 opens only on a tap (hints.js:1-3). Other seats tapped the same phone, and stale control numbers made p1's tap land on 💡 (T3) |
| The wolf partner panel shows my own name | p4 | Misread. p4 held 阿強's 📓, which correctly reads 「同你一齊醒嘅狼人係 大熊」. Each wolf is asked to read only their own book (script.js:824) |
| Silent players are not prompted to claim a role | p4 | Discussion is free under the rules (research Procedure 6) |
| 「小美 唔喺度？」 on my own gate | p3 | By design (#18). On a whole-table phone the host's device is the only one; the row is folded and its actions take two taps |
| The day clock runs while someone reads their notes | p3 | The day timer is the rules' timer. U10's hold is only for draw-guess day-step gates |
| The night leaks by sound, with no decoys | p1 | Already decided (U8): decoy gates for centre roles plus the noise bed (game.js:315). It cannot be heard headless, and every role was in play here |
| Robber time-out silently counted as declining (major) | p1 | Merged into R6 (minor). The current wording is honest about both cases; the fix splits them |

## AI artifacts (not app bugs on their own)

- **The night lapses.** Each console command plus model thinking takes 5–30 s. p1 woke on the 17:57:18 narrator line, which comes before the gate exists, and did not look again until the step was over. p2 did the same. p3 needed about 20 s from seeing the gate to tapping it.
- **p5's report**: it names the wolves as "p1, p5" in one place and gives the vote order with the wrong seat ids. p4's and p5's rights checklists have `couldUse` false on rights they used. p2's timeline (18 minutes, 5 minutes on results) does not match the narrator timestamps (about 10 minutes from deal to result).
- **p4's "own name" panel**: p4 read the partner's book.

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | evidence | fix |
|---|---|---|---|
| T1 | `wait` wakes on the narrator line, about 9 s before the gate exists (the gate opens at CUE_DONE). The first look shows closed eyes, so agents lose a turn | p3: first `see` after the wake had no gate, which came about 5 s later. p1: 「wait returned only on the next narrator line」 | At night, after a narrator wake, keep polling until the step's window opens (REF_JS `focus.anonymous` appears, or night ends), up to 15 s. Then return what this seat may see. Every seat returns at the same moment, so no tell |
| T2 | Still no multi-step tap (run-1 T6), so a gate → pick → confirm cannot fit in one AI turn | All three village night actions lapsed | `tap <s> <seat> 1 "阿明" "確定"`: up to 4 targets about 700 ms apart, stopping at the first failure. Show the called seat 「⏳ 呢步仲有 N 秒」 on its anonymous gate (from the step deadline) |
| T3 | On one shared phone another seat's tap moves the screen between your `see` and your `tap n`, and the tap lands on a different control | p1's tap landed on 💡 after the table card had already been dismissed | Remember each seat's last control labels and refuse `tap n` if the label has changed: 「螢幕變咗（有人㩒咗嘢）」 plus the new screen |
| T4 | Failed taps (`pt.mjs:688`, `:695`) do not say the screen moved on, and they print the raw screen with `fmt`, skipping the referee's `present`. That is a small bypass if the screen turns private between the guard and the tap | p1 and p3 got 「no control matching」 and 「control [6] is gone」 | Catch the error in the op, observe the phone again, and print 「（螢幕已經變咗）」 through `present()` |
| T5 | Taps on the table controls are not attributed. At a real table everyone sees who touches the phone in the middle | Nobody knew who tapped 夠鐘投票 (R2) | Log table-level taps to the chat as notes, as the escape row already does: 「📱 阿強 㩒咗「🗳️ 大家夠鐘投票」」 |
| T6 | Still no `shot --full` (run-1 T7) | Reveal screenshots are cut off | `Page.captureScreenshot` with `captureBeyondViewport` |

## Fix list for the orchestrator (priority order)

1. **R1** (shell, `play.js`): clear `lastHolder` at dawn and at the table card, start walks from table order when the phone is in the middle, and show the order. Check werewolf and cheese-thief, which use the same path.
2. **R2** (onuw): two-tap 夠鐘投票 with the time left, and an early-vote cue variant.
3. **R3 + R4** (onuw + shell): split dawn so eyes open after the dawn window, and give the cover neutral words during a night cue.
4. **R5, R6, R7**: the no-talking vote line, the declined-or-timed-out note, and the glossary filter.
5. **R8** (needs a decision, U4) and **R9**.
6. **T1–T5**. Then re-run one-phone onuw, plus a 6–7 player custom set with a Doppelgänger and two Masons, to exercise R1 with no daytime pick-up, R3 and the co-waker book.
