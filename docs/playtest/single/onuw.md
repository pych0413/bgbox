# 一夜終極狼人 (onuw): one-phone playtest review

> Session `sp-onuw`, `--shared` (ONE 390x844 phone passed around a 5-seat table), 2026-10-04 07:30–07:48 UTC.
> Build under test: `https://pych0413.github.io/bgbox/` build `20261004005209`. It matches local HEAD `16da24d` (only the
> `?v=` cache stamps differ), so the line numbers below are the code that ran. Config: auto 5-player preset (狼人 ×2 · 預言家 ·
> 強盜 · 搗蛋鬼 · 村民 ×3, 3 in the centre), loneWolf on, ringVote on, 夜晚慢 (×1.5, set by the one-phone default), discussion
> 5 min, narration 🔇 靜音 (chosen by the console setup, not the app default). Seats: p1 阿聰 (host), p2 阿明, p3 小美,
> p4 大熊, p5 阿強. Reviewer: opus, read-only (no code edited).

## Verdict

**Finished, with correct rules. On one phone it is not yet fair or reliable.** The match ran end to end in about 17
minutes. The tally, the death (阿明, 3 votes), the winner (狼人隊, no wolf died), every final card and the centre cards all
match the verified rules. The deal walk, the anonymous night gates, the decoy gate for centre steps, the opaque night cover
and the secret ballot walk all worked. Five one-phone gaps undercut the game:

1. **Dawn hands the phone, face up, to the last player who woke** (C1). Here that was the Robber, 阿明. All day the chip read
   「而家睇：阿明」, his night notes were one hold away for anyone at the table, and his ballot opened first without a gate
   (C2). All five players claimed Villager, and 阿明 was voted out.
2. **Both night actions lapsed** (C3). The step timer includes picking up the phone. The lone wolf's centre peek (18 s
   window) and the Robber's swap (15 s) both ran out mid-pick. AI console latency made this certain, but a slow first-timer
   with eyes closed will hit it too.
3. **🔇 靜音 and 📜 讀稿 break the eyes-closed night on one phone** (C4). 靜音 tells everyone 「唔使閉眼」. 讀稿 needs the
   reader to take the phone back at every step. Only 🔊 語音 works, and nothing warns the host.
4. **Two wolves or two Masons cannot both get the phone at night** (C5, from code). Only the first is gated. The second
   needs a manual 換人 inside 12–18 s, using seat numbers.
5. The reveal is written for whoever holds the phone: 「🎉 你贏咗！」 and 「阿聰（你）」 on the screen the whole table reads (C6).

C1 and C2 come from the same shell code as undercover's C1 and C3 (`docs/playtest/single/undercover.md`), so one shell
fix covers both games.

## Facts from the table

| | |
|---|---|
| Deal | 阿聰 🐺 狼人 · 阿明 🗡️ 強盜 · 小美, 大熊, 阿強 🧑‍🌾 村民. Centre: 🐺 狼人, 🌪️ 搗蛋鬼, 🔮 預言家 |
| Night (`lastResult` recap) | 狼人: 阿聰 alone (lone wolf), 「冇用能力」 (the peek lapsed). 預言家: nobody. 強盜: 阿明 「冇用能力」 (the swap lapsed). 搗蛋鬼: nobody |
| Window lengths (slow ×1.5) | begin 4.5 s · werewolf **18 s** · seer 18 s · robber **15 s** · troublemaker 15 s · dawn 3 s (`game.js:85`, `:353-361`) |
| Day | Started about 07:36:18 with the phone on 阿明 (the last real night gate). The vote gate came at 07:41:39, when the 5-minute timer ran out. Nobody pressed 下一步 |
| Vote walk | 阿明 (**no gate**, voted first) → 阿聰 (agreed to 圈票, so no ballot) → 小美 → 大熊 → 阿強 → 阿聰 again (the circle failed) |
| Ballots | 阿聰→阿明 · 阿明→小美 · 小美→阿聰 · 大熊→阿明 · 阿強→阿明 → 阿明 dies with 3 votes |
| Result | 「狼人隊贏 — 冇狼人死」, winners `[p1]`. Correct: a wolf is among the players, no wolf died and there is no Tanner |
| End state | `room.phase = results`, `history` has 1 entry. The game finished |

Timeline (UTC):
- 07:30:57–07:31:02: everyone says 準備好.
- About 07:31–07:34: deal walk p1 → p5 behind pass gates.
- About 07:35:00: 狼人 gate. 阿聰 taps it and picks 中間 2, but his confirm lands after the window and is refused.
- About 07:35:19: 預言家 decoy gate (nobody).
- About 07:35:43: 強盜 gate. 阿明 taps it and picks 阿聰, but the window ends first.
- About 07:36:03: 搗蛋鬼 decoy gate.
- About 07:36:18: dawn, with the phone on 阿明. Discussion follows; all five claim Villager.
- 07:41:39: vote. Ballots and the ring walk run until about 07:46:40.
- About 07:47:28: 阿聰 lays the reveal face up and taps 睇完整個結果.

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| C1 | major | tell / privacy | Dawn leaves the phone face up on the last night waker's private screen | At `dawn`, `view.night` turns false and `focus` becomes null. The opaque night cover lifts on whoever tapped the last real night gate, here 阿明 (Robber). The Seer and Troublemaker were in the centre, and their decoy gates switch nobody. Three effects: **(a)** the chip 「而家睇：阿明」 tells the table who woke last (in general the last live waker: Robber, Troublemaker, Drunk or Insomniac). Here all five claimed Villager, and p1 says the holder drew his vote. **(b)** The phone 「on the table」 shows 阿明's own day view, and his 📓 夜晚記錄 (his swap result) is one hold away for anybody. **(c)** The vote starts on his ballot (C2). p1 and p3 reported (a); p4 and p5 saw it as a 「stall」 | `js/ui/screens/play.js:326-351` (`evaluateFocusGate` keeps `activeSeat` when focus empties); `js/core/client.js:1140-1144` (`setActiveSeat` cannot go seatless); chip `play.js:631-635`; `js/games/onuw/game.js:1218` (`night` false at dawn) | On a shared phone (`mySeats.length > 1`), when `focus` is null and the view is not night (dawn, day, reveal), show a public card 「☀️ 天光 — 部手機擺返枱中間」 and switch to the **seatless table view** (`st.table`). onuw's `buildTable` already shows the day timer, the role list and the counts, and its reveal says 「🐺 開牌」. Let `setActiveSeat(null)` work on a shared local device. A seat that wants to re-read its notes uses 換人 ⇄, which goes through its own gate. Same root as undercover C1 | shell |
| C2 | major | integrity | The vote starts on the day holder's ballot with no gate, so the vote order depends on the night | Vote `focus` lists all 5 seats. The seat on screen (阿明) is one of them, so no gate opens and 阿明 voted first. The gates then walked 阿聰, 小美, 大熊, 阿強. Whoever touches the phone first after the timer is holding 阿明's ballot | `play.js:344` (`here.includes(seat)` → no gate) | When a named focus with 2+ seats starts from a public step, always gate `here[0]` in table order, even if it is the seat on screen. With C1's table view this happens by itself. Same as undercover C3 | shell |
| C3 | major | timing | Night windows include the hand-over; both night actions in this game lapsed | Windows are fixed per step: werewolf 18 s and robber 15 s at slow pace. The deadline is set when the window opens, which is the moment the anonymous gate appears. So reaching for the phone, tapping the gate, reading, picking and confirming must all fit in 15–18 s. 阿聰's lone-wolf peek and 阿明's swap both ran out mid-pick. The late confirm was refused, and each learned only from the vote-screen 📓: 「今晚你冇用能力」, worded the same as declining. The countdown bar exists but has no number. On a shared phone the night UI mounts fresh after the gate, so the bar's total is the time **left at mount**: it starts full after the gate has already used part of the window. The in-app rules promise 「每一步都夠時間摸部機、做嘢、放返低」 | `game.js:537` (deadline at window entry), `game.js:353-361` (`windowMs`), `:85` (×1.5); gate at the same moment `play.js:333-341`; bar `js/games/onuw/ui.js:240`, `:381-397` (`barTotal = dl - now` on first tick); idle note `game.js:698`, `script.js:451`; promise `script.js:185` | (1) On a single device, add a fixed **hand-over pad** to every window, whether or not anyone is awake (e.g. +8 s per step kind), so it is still no tell. Use a hidden cfg flag set in `config.defaults` when `env.singleDevice`, like `paceAuto`. (2) Show the seconds left next to the bar (「仲有 9 秒」), and compute the bar's total from `windowMs`, not the mount time. (3) Word the lapse note 「今晚你冇確定（時間到或者唔想用）」 so a timed-out player is not told they chose nothing | onuw |
| C4 | major | anti-tell | 🔇 靜音 and 📜 讀稿 break the eyes-closed night on one phone; only 🔊 語音 works, and nothing warns | The one-phone rules (`script.js:183`) assume everyone hears 「X，請睜開眼」 with eyes closed. **靜音**: nothing is spoken, so with eyes closed nobody knows when to reach. The night help line says the opposite of what one phone needs: 「靜音模式：唔使閉眼，望住自己部機 — 輪到你嗰陣佢會自動亮起。」 With eyes open, everyone sees who reaches at each 「X請拎起部手機」 gate. **讀稿** (from code, not played): a cue waits for the reader's tap. The cue text sits on the same phone the last waker is holding, so the reader must take the phone back with eyes open at every step and sees who has it. The lobby warns only for `narration: 'required'`, and onuw is `'recommended'`. This run used 靜音 because the console setup chose it. The app default is 語音 (no saved pref in the profile, 22 voices present), so p1's 「lobby defaults to 靜音」 is a harness artifact, but the gap is real | `script.js:800` (helpSilent) via `ui.js:378`; `js/core/session.js:353-358` (read waits for a tap); `js/ui/screens/play.js:562` (narrator bar on the shared phone); `js/ui/screens/lobby.js:444`; `game.js:309`; no `shared` flag in `ctxFor` (`play.js:103-108`) | On a single device, onuw should default to 語音 (e.g. a meta field `sharedNarration: 'voice'`). Warn in the lobby when 靜音 or 讀稿 is picked with one phone: 「一部手機玩要用 🔊 語音：大家全程閉眼聽叫。靜音／讀稿會俾人見到邊個摸部機。」 Pass `shared` in `ctxFor` and drop helpSilent on a shared phone. With no TTS voice, recommend one phone each | onuw + shell |
| C5 | major | flow (from code) | Two awake seats on one phone: only the first gets the phone | At the werewolf and mason steps (and when a Doppelgänger copies one of them), `focus.pids` lists every awake seat and never shrinks during the window. The shell gates only `here[0]`. The second waker gets the phone only if the first uses 換人 ⇄. In a secret step that list shows 「座位 N」, not names, and the first waker must also wake the partner. All of this must fit in 18 s for wolves, or **12 s** for masons (8 s ×1.5). Spec §4 says this, but the in-app 「用一部手機玩」 rules do not tell players. The partner note is written when the window opens, so the second waker can read it later behind 📓. On one phone that means taking the phone during the day, which is visible. In practice the second wolf or mason starts the day not knowing the partner. Not exercised here (lone wolf), and p1 flagged it as untested | `game.js:1054` (focus = all awake seats); `play.js:333-341` (gate for `here[0]` only); `play.js:401-418` (seat menu 「座位 N」 in secret steps); `script.js:182-186`; `docs/games/onuw.md` §4 item 2 | Walk the anonymous focus on a shared phone. When the first waker taps 「搞掂」 (or at half the window), show the same anonymous gate (「狼人請拎起部手機」) for the next awake seat. Always show the same number of gates for that step kind (decoys for missing wakers), so the count tells nothing. Lengthen these windows on one device (C3's pad). Add the procedure to the 「用一部手機玩」 rules | shell + onuw |
| C6 | minor | ux | The reveal is written for the holder: 「🎉 你贏咗！」 and 「阿聰（你）」 on the phone the whole table reads | The reveal banner, vote bars and final-card rows use `api.me`, which is the seat on screen. When 阿聰 laid the phone face up, four players who had lost read 「你贏咗！」. p4 took it as their own result. See `p1-001.png` | `js/games/onuw/ui.js:524-525`, `:535`, `:558` | With C1's table view, the reveal falls back to 「🐺 開牌」 with no （你）. Otherwise pass `shared` in ctx and use `me = null` on a shared phone. Per-seat ✅贏 / ❌輸 stay on each row. Same family as undercover C7 | onuw (+ shell ctx) |
| C7 | minor | ux | Ring vote on one phone costs an extra hand-over and cannot really be decided in secret, in turn | Agreeing does not cast a ballot (spec §3.5), so the agreer is skipped and gets a second gate after everyone else. 阿聰 had gates at 07:41:39 and 07:46:40. Early voters cannot know whether the circle can still form, but the official rule is a spoken agreement before the count. After picking a target but before 確定, the button still read 「✓ 我同意圈票（㩒一下取消）」. The tick clears only when the vote is sent | `game.js:757-768`, `:1056-1061` (vote focus); `ui.js` vote ring block | On a shared phone, make the circle a table decision before the walk: a public card at vote start, 「全枱同意圈票？」. Yes = ring for every present seat, no = walk. Or let an agreer also pick a fallback target in the same turn. Untick the ring as soon as a target is picked | onuw |
| C8 | minor | flow (from code) | Two buttons need every seat, which one phone cannot do: 「🗳️ 我哋夠鐘投票」 and 「睇完整個結果」 | Day: 夠鐘投票 needs every present seat. On one phone it counts only the seat on screen (1 / 5), and the screen does not say so. The host line 「房主：想即刻投票？㩒右上角 ⋯ →「下一步」」 is the only way out. Reveal: 「睇完整個結果」 from a non-host seat shows 「✓ 等緊房主…」 and nothing happens. On one phone that is every game where the last voter is not seat 1, so the host must use ⋯ → 下一步 or wait 3 min. Not hit here, because 阿聰 (host) voted last | `game.js` `dayAct` (all present), `game.js:901-905` (`revealAct`: host or all); `ui.js:423-427`, `:576-581` | On a shared phone, hide 夠鐘投票 and show 「想即刻投票？房主㩒 ⋯ → 下一步」. At the reveal, a tap from the table view (C1) or from any seat on the host device finishes it. Give that one tap a two-tap confirm | onuw + shell |
| C9 | minor | text | Wording that assumes one phone each, and stale one-phone rules | **Own-phone wording**: decoy line 「每一輪都㩒，咁就冇人聽得出邊個醒」 (`script.js:797`); `helpVoice` 「個掣有冇用都照㩒」 (`:799`); 💡 sleep 「照㩒大掣，扮有嘢做」 (`:738`); `dealTip` (`:788`); QUICK line 2 (`:126`); rules 玩法流程 step 2 (`:136`); vote cue 「打開手機，揀你覺得係狼人嘅人」 (`:400`). On one phone a sleeping seat never holds the phone. **Stale**: 「用一部手機玩」 says 「冇人醒嗰輪（角色喺中間）部機唔會彈交接卡」 (`script.js:184`), and spec §4 and §8 request 1 say 「no gate appears」. The shell now shows a decoy gate for an empty step | `script.js` lines listed; `js/core/room.js:87-98` (`filterFocus` keeps `anonymous`), `play.js:336-340` (decoy gate); `docs/games/onuw.md` §4, §8 | With `shared` in ctx, hide the decoy line on a shared phone (or 「做完就放低部機」). Make the vote cue neutral: 「時間到！三、二、一，投票！」. Rewrite 「用一部手機玩」: 要用 🔊 語音; 部機放枱中間，全部人閉眼; 聽到叫你嘅角色先摸部機，㩒交接卡，做完放返低; 每一步都會彈交接卡（角色喺中間都會）; 兩隻狼／兩個守夜人點交機. Update spec §4 and §8 | onuw |
| C10 | minor | anti-tell | Reaching for the phone is heard at live steps and missing at centre steps | With one phone and eyes closed, a live step has someone sliding the phone and tapping, and a centre step is silent for the whole window. p1 flagged this as a polish item. Spec §4 accepts it. The research's one-phone notes say this "table centre, role picks up phone" style leaks and recommend a pass-around night. The official app plays background noise | `docs/games/onuw.md` §4 「What leaks, honestly」; `docs/research/onuw.md` App design notes → ONE shared phone | On a shared phone in 語音 mode, play a soft ambient bed through every night window, the same for every step. Have the begin cue ask everyone to keep one hand on the table. Longer term, build the research's pass-around night (a fixed slot per seat, decoys for non-actors) as onuw's one-phone mode | onuw + shell |
| C11 | polish | text | The one-phone lobby marks every seat 「（你）」 | 「阿聰（你）」 … 「阿強（你）」 | `js/ui/components/SeatEditor.js:105`, `:127` | No （你） when `mySeats.length > 1` | shell |
| C12 | polish | text | The ring-vote help does not say what "nobody dies" means | 「懷疑兩隻狼人都喺中間？…成場冇人死」. A no-kill is a wolf win whenever a wolf is among the players. 小美 had to argue it at the table | `script.js:844` | Behind 💡 only (`H.vote.ring`): 「冇人死：有狼喺玩家入面就係狼人隊贏；兩隻都喺中間先係好人贏。」 | onuw |

## Checks that passed (one-phone specifics, from code and play)

- **Rules**: the tally (max 3 ≥ 2, single top) kills 阿明. A wolf is among the players and alive, with no Tanner, so the
  wolf team wins (`analyse`, matching research Voting & resolution and the win formulas). The lone wolf was told
  「淨係得你一隻狼人醒」. The Seer and Troublemaker steps were called even though both cards were in the centre.
- **Deal walk**: p1 → p5 in table order, with a 「交俾 X · 其他人唔好望」 gate between seats and a hold-to-peek card that
  re-covers on release. No stale secret on the previous holder's screen.
- **Night gates**: anonymous (role, never a name). An empty step gets the same decoy gate (`filterFocus` keeps
  `{ pids: [], anonymous }`). Between steps a shared phone gets the **opaque** night cover (`logic.js:166`, `base.css`
  `.night-dim.opaque`, z 60) and is muted. The gate tap's flip sound is muted at night.
- **Vote**: secret and sequential. 「已投 n / 5」 counts only, and secretChoice means 「已投 ✓」. All ballots are revealed at
  once with who voted for whom. The ring fallback asks the agreer again and says why.
- **Nothing waits forever**: night windows are timed, the vote walks the seats that have not voted, the day ends on its
  timer, and the reveal has a 3-minute fallback.
- **Night notebook**: honest (「今晚你冇用能力」), with the 「你最後張牌可能已經被換咗」 warning.

## Rejected findings

| reported | by | why |
|---|---|---|
| 「Lobby defaults narration to 🔇 靜音」 | p1 | Harness. The console setup chose 靜音. The app default is 語音: `client.js:621`, `room.js:200`, no saved pref in the fresh profile, 22 voices available. The real gap (靜音 and 讀稿 are unusable on one phone, with no warning) is C4 |
| 「Robber action timed out: blocker」 | p2 | Kept as C3, at **major**. The swap is optional, the app reported the lapse honestly, and the length was inflated by AI turn latency |
| 「Confirm button may be off-screen」 | p2 | Unverified. The confirm is the big button under the picks (`ui.js:256-260`). No `below-screen` flag or screenshot was quoted |
| 「Phone read-only when shown」 | p2 | Not an issue (p2 says so) |
| 「Day discussion was completely skipped」 | p4 | False. `hear` has talk from 07:36:33 to 07:46:14, and the day ran its 5-minute timer (07:36:18 → 07:41:39). p4 could not see the day screen (C1 / T5) |
| 「Vote counter should say who voted」 | p4 | App is right. Research anti-tell: "Show 'N of M done' counters, never names". Spec §3.5: 「已投 4 / 6」 for everyone, never who |
| 「No sound or vibration when the phone reaches you」 | p4 | App is right. On one phone the pass gate is the cue. A chime at night would tell (`play.js:640-648`), and research says "no haptics" |
| 「已投 3/5 did not match what I saw」 | p5 | App is right. It is the global ballot count, and the final 5 ballots match |
| 「All five claimed Villager」 | p5 | Normal play (p5 says so) |
| 「Ring counters visible to later voters」 | p3 | Not a leak. Ring progress is public on every phone in multi-phone play too |
| 「No explicit dawn cue」 | p5 | Tooling. The dawn cue exists (`script.js:380`, 「天光喇，大家睜開眼！…限時 5 分鐘」), but 靜音 does not speak it and the console does not relay cues (T3) |
| 「No visible countdown」 (night), 「no day timer」 | p1, p3 | Mostly tooling. The night bar exists (`ui.js:240`), but `see` prints nothing for it. The day timer was on the phone, but the referee treated the phone as in 阿明's hands. The real parts are in C3 (no number, the bar restarts) and C1 (the holder's private screen) |
| 「~2 min stall after the night」 | p4, p5 | That was the day phase with the phone attributed to 阿明 (C1, T5) |

## AI artifacts (not app bugs on their own)

- **Night lapses**: every console command plus model thinking takes 5–20 s, so pick → confirm inside a 15–18 s window
  (which also covers the gate) was nearly impossible. C3 stays because a slow human with eyes closed hits the same clock,
  and the bar is misleading after a gate.
- p4's timeline (「night ended at ~8 min, no dialogue before voting」) and p5's 「p2 held the phone 07:31–07:36 during the
  night」 mix up phases. Both came from a hidden day screen.
- p2's rights checklist has `couldUse` inverted (✅ items marked false).

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | evidence | fix |
|---|---|---|---|
| T1 | `see` prints nothing for the night countdown bar, so AI players cannot pace themselves | p1: 「no timer in the screen text」. The bar is a plain `<div class="on-bar">` | When the holder's view has `deadline`, add a line 「⏳ 仲有 N 秒」 (from `view.deadline` minus the host clock) to `see` |
| T2 | A tap after the step ended says only 「(你唔可以掂部手機)」 | p1, p2 | If the seat was the called holder in the previous screen, say 「（呢一步時間到咗，部手機已經收返）」 and name the step |
| T3 | Narrator cues (dawn, vote countdown, reveal) never reach `hear` | p5: 「no explicit dawn cue」 | Echo every new `room.cue` into the chat log as 「[旁白] …」 (what a speaking phone says to the table). Same as undercover T4 |
| T4 | One-phone onuw ran in 🔇 靜音 | setup notes; app default is 語音 | For one-phone onuw runs use `--narration voice` (讀稿 needs a reader to touch the phone, see C4). Check that voice cues complete in headless Chrome (the narration watchdog), or fall back to silent pacing plus T3 |
| T5 | During the day the referee hid the phone from four seats (「📱 阿明 拎緊部手機」) | p1, p3, p4, p5 | Public phases with no gate and no night should be `read` for everyone, i.e. auto-show (undercover T1). After C1 the screen will be the table view anyway |
| T6 | One AI round trip per tap cannot fit a night turn into 15–18 s | p1, p2 lapses | Add a `wait` that returns as soon as a gate names you, and let `tap` take several targets in sequence (`tap … "中間 2" "睇中間"`) with ~700 ms between them. That is human pace and keeps to fair-play rule 6 |
| T7 | `shot` captures only the viewport | p3: results cut off at 「最後張牌」 | `shot --full` (full-page capture) |

## Fix list for the orchestrator (priority order)

1. **C1 + C2** (shell, `play.js` + `client.js`): on a shared phone, switch to the seatless table view after dawn and in
   other public phases, and gate the first voter in table order. This is the same fix as undercover C1 and C3.
2. **C4** (onuw + shell): 語音 on one phone, a lobby warning for 靜音 and 讀稿, and a `shared` flag in `ctxFor`.
3. **C3** (onuw): a fixed hand-over pad on a single device, seconds next to the bar, the bar's total from `windowMs`, and
   clearer lapse wording.
4. **C5** (shell + onuw): walk the anonymous focus for two awake seats (wolves, Masons, a Doppelgänger copy) with a fixed
   gate count.
5. **C6, C8, C7** (onuw ui and engine), then the **C9** text and spec §4 and §8 updates.
6. **C10** (ambient night bed), **C11**, **C12**.
7. **T1–T7**, then re-run one-phone onuw with `--narration voice`, plus a 6-player run with a custom set containing two
   Masons to exercise C5.
