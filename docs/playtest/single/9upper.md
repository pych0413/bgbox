# 瞎掰王 9upper (9upper): one-phone playtest review

> Session `sp-9upper`, `--shared` (ONE 390x844 phone passed around a 4-seat table), 2026-10-04 06:26–07:29 UTC.
> Build under test: `https://pych0413.github.io/bgbox/` build `20261004005209`, which matches local HEAD `16da24d`, so the
> line numbers below are the code that ran. Config: preset 快玩 (4 rounds, 1 lap), levelMode mix, `passPhone: true`
> (turned on by `env.singleDevice`), readSecs 9, speakOrder 諗樣揀, speakSecs 0, 1 收皮啦, narration 🔇 靜音.
> Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊. Reviewer: opus, read-only (no code edited). After the players stopped,
> the reviewer drove round 3 on the same table (07:33–07:45 UTC) to check three things the reports could not settle.

## Verdict

**Not finished: 2 of 4 rounds were played.** The game stalled at the round-3 gate 「交俾 阿明」 for 20 minutes because the
AI players for 阿明 and 大熊 had stopped responding (from about 06:45 UTC). That stall is an AI and referee artifact,
not an app block. Scores at the stop were 阿聰 7, 小美 5, 阿明 3, 大熊 2, and both rounds were scored exactly by the rules.

The private part of one-phone play works. Each reader gets a gate, an equal 9-second window and an auto-close, the
諗樣 never peeks, and the phone goes back to the 諗樣 after the last reader. The worst-looking report, 「部手機冇交返俾
諗樣」 in round 2, was a **console bug**: the gate was up, but its own target could not see it (T1). I reproduced the
hand-back in round 3, including a hold that ran past the end of the window.

The talking half of the round is where one phone breaks. All four are confirmed, and three were found in the code:

1. On one phone, nobody can ever be marked ✅ 已講. The 諗樣's 「下一位」 marks every speaker 「⏭ 跳過咗」. After the
   last speaker it starts a **second lap** instead of going to 揀人 (reproduced, C1).
2. The reveal stays in the 諗樣's hand. Nothing tells the 諗樣 to show it, and 「下一輪」 works at once, so in round 1
   only 大熊 saw the result (C2).
3. 「換人 ⇄」 to a 玩家 during the explaining is bounced straight back to the 諗樣. That makes the role-reminder card and
   `rePeek` unusable on one phone, although spec §4 relies on exactly that switch (reproduced, C3).
4. If the host turns 「一部手機輪流睇」 off on a one-phone room, only the first 玩家 ever sees a card, and nothing
   warns (C5).

## Facts from the table

| | |
|---|---|
| Rounds played | 2 of 4 (`history` has 2 entries; `lastResult` null; engine at round 3 `term`, judge p2, term 「日冕加熱問題」 ⭐⭐⭐) |
| Round 1 | 諗樣 大熊 · term 「褦襶」 ⭐⭐⭐ (no hints) · 老實人 **阿明** · 9upper 阿聰, 小美 · pick 阿聰 (9upper) → 阿聰 +3 · no 收皮啦 · nobody spoke at the table (chat silent 06:26:54–06:31:20) |
| Round 2 | 諗樣 阿聰 · 「逆旅」 swapped (阿聰 knew it) → 「協調道」 ⭐⭐ (3 hints, 1 true) · 老實人 **阿明** (again) · 9upper 小美, 大熊 · 收皮啦 大熊 (hit) → 大熊 −1, 阿聰 +1 · pick 小美 (9upper) → 小美 +2 |
| Scores | 3/3/3/3 → after r1 6/3/3/3 → after r2 **阿聰 7 · 阿明 3 · 小美 5 · 大熊 2**. Both rounds match the research algorithm (golden vectors 2 and 6) |
| Read order | r1 (judge p4): 阿聰 → 阿明 → 小美 → back to 大熊 · r2 (judge p1): 阿明 → 小美 → 大熊 → back to 阿聰 · r3 (judge p2, reviewer): 小美 → 大熊 → 阿聰 → back to 阿明. Always seat order from the 諗樣's left, as in spec §3.3 |
| Speaking | r2 only: 小美 explained (06:39:57) and answered follow-ups. 大熊 (called 06:42) and 阿明 (called 06:53) never spoke, because their agents had stopped |
| Stall | r3 gate 「交俾 阿明」 from 07:09 to 07:29+. `room.idle = [{ pid: p2, since 07:09:28 }]` (冇反應, listed only in the host's ⋯ menu), `stalled = []` |

Timeline (UTC): 06:26:14 table up → 06:26:49–54 all 準備好 → ~06:27 開始, gate to 大熊 (r1 諗樣) → reads 阿聰, 阿明, 小美 →
~06:30 大熊 alone runs the explaining and picks 阿聰. Nobody spoke and nobody else saw the reveal (C2) → 大熊 taps 下一輪 →
~06:31 gate to 阿聰 (r2 諗樣) → 06:31–06:34 swap 逆旅 → 協調道 → reads 阿明, 小美 (missed her window: T3), 大熊 →
~06:38 explain. The gate 「交俾 阿聰」 is up (p2 and p4 both saw it), but 阿聰's console printed 大熊's screen from
behind the still-transparent gate (T1) → 06:39:57 阿聰 has the phone, 小美 explains → 06:42 / 06:53 calls to 大熊 and 阿明
(silent) → 07:01 `show` → 07:07–07:08 收皮啦 大熊, pick 小美 → reveal → 07:09 下一輪 → gate 「交俾 阿明」 → 20-minute stall
→ 07:28–07:29 the players stop.

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| C1 | major | one-phone flow | On one phone nobody can be marked ✅ 已講: 下一位 marks every speaker 「跳過咗」 and then starts a second lap | During the explaining `focus` is `[judge]`, so the 諗樣 holds the phone and the speaker's own 「我講完」 is never on screen. The only ways to end a turn are the 諗樣's 「下一位」, which the engine treats as a **skip** (「⏭ 跳過咗 · 叫返佢」, back once at the end), and 「👉 叫佢講」, which sends the interrupted speaker back to ⏳ 等緊. Reproduced in round 3: 下一位 ×3 → 小美 ⏭, 大熊 ⏭, 阿聰 ⏭, and then **小美 🎤 講緊 again**, then 大熊 (`back=[p3,p4]`). The list can never show who really explained (p3: 「my row stayed 👉 叫佢講」 after she had explained). The rule meant for a friend who was away (#23) gives every speaker a second turn. In 系統派 that is a second announced lap of N−1 「🎤 輪到 X」, and the judge note even says 「人唔喺度就㩒「下一位」跳過，佢最尾會再輪到」. The 諗樣 can still end it with 「我決定咗，要揀人」, so it is not a block. Related: `blocking` names the speaker in explain, so a shared phone lists the speaker as 冇反應 in ⋯ after 45 s although only the 諗樣 can end the turn | `js/games/9upper/game.js:889` (`endTurn(…, pid !== speaker(s))`: the 諗樣's done is a skip), `:498-517` / `:481-487` (skipped players get the floor back), `:1086` (explain focus = judge), `:1108` (`blocking` = speaker); `js/games/9upper/ui.js:492-493`, `:499` | With `cfg.passPhone` (the one-phone flag), the 諗樣's 「下一位」 ends the turn as **講完** (✅ 已講, no come-back), labelled 「✅ 講完 · 下一位」. Add a small separate 「⏭ 佢唔喺度，跳過」 for the skip semantics. With passPhone, `blocking` in explain should name nobody (the 諗樣 ends turns). Update spec §3.4 (#23 skips), §4 and the tests | 9upper |
| C2 | major | one-phone flow | The reveal stays in the 諗樣's hand, nothing says to show it, and 下一輪 is live at once | `focus(reveal) = [judge]`, so the reveal opens on the 諗樣's screen. On a shared phone that screen is the only copy of the 「原來係咁」 moment: the 老實人, the 9upper list, the score lines and the true explanation with its source. Spec §3.8 says 「Everyone gets the same screen」, but on one phone that holds only if the 諗樣 thinks to lay it down. In 靜音 nothing is read aloud. Round 1: 大熊 saw it alone and tapped 下一輪. 阿聰 learned his +3 from the score strip in round 2 (06:31:20 「我冇睇到結算畫面」), and 小美 never saw the r1 true explanation (06:33:36). The button has no lockout or confirm, and no line tells the 諗樣 to show the table. In voice / 讀稿 the cue reads the result aloud, which softens this, but only 靜音 was tested | `js/games/9upper/game.js:1089-1091` (reveal focus = judge, no "public" mark); `js/games/9upper/ui.js:631-666` (`revealBody`: 下一輪 shown and enabled at once) | On a shared phone (shell: expose `api.shared = mySeats.length > 1`, or use `cfg.passPhone`) the reveal gets a line 「📢 擺部手機喺枱中間，大家一齊睇」, and 下一輪 becomes arm-then-confirm 「大家睇完？再㩒一下」 (or locks for about 4 s). Better and generic: the shell's 「放喺枱中間」 card from undercover C1, triggered by a focus flag such as `{ pids: [judge], table: true }` that 9upper sets in `reveal` | 9upper ui + shell |
| C3 | major | one-phone flow | 「換人 ⇄」 to a 玩家 during explain or judge is bounced straight back to the 諗樣, so the role reminder and rePeek cannot be used on one phone | Spec §4.4: 「rePeek and the role-reminder card need a private seat switch; on one phone they are only used if somebody switches seat by hand」. They cannot be. Reproduced in round 3: the 諗樣 handed the phone to 小美 through 換人 ⇄ and her gate, and 小美's screen appeared (「小美（你） 🎤 講緊 · 我講完 · 㩒住睇返我係咩」). At once an auto gate 「交俾 阿明」 covered it (`activeSeat p3, focus [p2]`). A 玩家 gets about 0.2 s, so: no 「㩒住睇返我係咩」 to check one's role, no `rePeek` re-read for the 老實人 (a config option that silently does nothing on one phone), and no 「我講完」 (C1). The same bounce hits any game whose focus names one seat while someone wants the phone for something else | `js/ui/screens/play.js:340-350` (`evaluateFocusGate`: focus names another seat of this phone → auto gate, also right after a 'switch' gate), `:353-357` (`switchSeat` sets nothing that outlives the gate); `js/games/9upper/game.js:1086` | Shell: a hand-picked seat holds until the focus **changes**. Remember the focus signature at the moment of the 'switch' gate and skip the auto gate while it is unchanged, so the holder hands it back with 換人 ⇄. Then fix the spec §4.4 wording. Until then, hide `rePeek` (or warn in `validate`) when `env.singleDevice` | shell (+ 9upper spec) |
| C4 | minor | text | The explaining cues say 「收起電話」 and 「講完㩒「我講完」」 at a one-phone table | Every explain cue starts 「睇卡完。收起電話，…」. On one phone the 諗樣 must keep it to tap 叫佢講, 收皮啦 and 揀人 (the round-2 cue was quoted by p1). The 自己決定 cue and the 系統派 config help tell players to tap 「我講完」, which a 玩家 cannot reach on one phone (C1, C3). By contrast the read cue already has a one-phone version (「部手機由阿B開始逐個傳…」) | `js/games/9upper/script.js:129-131` (`cueExplain`, no `pass` flag); `js/games/9upper/game.js:235` (系統派 help) | Pass `pass` to the explain cue, as `cueRead` does. One-phone wording: 「睇卡完。部手機交返俾阿聰，由小美開始解釋「…」。阿聰可以叫人、追問…」. 自己決定: 「講完就話一聲，阿聰會剔走你個名」. 系統派 help: 「…講完㩒「我講完」（一部手機就由諗樣㩒）」 | 9upper |
| C5 | major | one-phone flow (from code) | Turning 「一部手機輪流睇」 off in a one-phone room silently breaks every read | `defaults` turns `passPhone` on for `env.singleDevice`, but the field stays visible and `validate` ignores `env`. If the host turns it off, `read` becomes the together window: focus = every 玩家. The shell gates only the first one (`here[0]`). Its 9 s started at the 諗樣's 開始睇卡, before the hand-over, and the window then ends for everybody. The other 玩家 never see a card, and with C3 they cannot reach their reminder later either. Most rounds the 老實人 never reads the explanation. Spec §4.3 knows this (「Without passPhone, a device holding several seats would only let its first seat read」) but nothing guards it. Not exercised in this match | `js/games/9upper/game.js:252` (`validate(cfg, n)`, no `env`), `:1084-1085` (together focus), `:417-431` (`startRead`); `js/ui/screens/play.js:345-350` (gates only the first seat named) | `validate(cfg, n, env)`: with `env.singleDevice` and `passPhone === false`, return `ok: false` with 「一部手機玩要開「一部手機輪流睇」，唔係得第一個人睇到卡。」. Alternatively `norm()` forces it on and the field is hidden on one phone. Add a test | 9upper |
| C6 | minor | one-phone flow | A pass gate for a seat that is away has no way out except tapping into that seat's screen | The shell's own escapes (⋯ → 💤 唔喺度, 呢輪作廢, 代佢做) are host-only and sit under the full-screen gate (`z-index: 100`). The 冇反應 notice for the seat (`room.idle`, p2 from 07:09) is only listed inside ⋯. At a real table someone taps 「準備好喇」 for the missing friend, then uses ⋯ → 💤. That is harmless at a `term` gate, but at a read gate it lands one tap away from 「開始睇卡」 on the absent seat's card. In this match the referee stopped anyone but 阿明 tapping (T4), so the table froze for 20 min | `js/ui/components/PassGate.js:22-46` (one button only); `js/ui/screens/play.js:347-350`; `js/core/room.js:1476-1524` (`#refreshStalls`: idle list only in ⋯) | On the host device, once the gated seat is in `room.idle` / `stalled`, the gate shows a small secondary 「佢唔喺度？」. It opens the ⋯ absent / void / 代佢做 rows **without** switching seat. No game change is needed | shell |
| C7 | polish | ux | The pass gate fades in from fully transparent | `.c-passgate` starts at `opacity: 0` and fades to 1 over 0.18 s, but it catches taps from the first frame. For that moment the screen behind shows through: the previous holder's own view of the next step (for example the round-3 term after 下一輪). Nothing secret leaks, because it is the holder's own view and in 9upper the term is public. But a gate should hide from frame one, and the fade is what makes the console misread gates (T1) | `css/base.css:597-602`; `js/ui/components/PassGate.js:43` (`requestAnimationFrame(() => root.classList.add('in'))`) | Make the backdrop opaque at once and fade only `.c-passgate-card` | shell |
| C8 | polish | text | 「（你）」 on the public reveal of a shared phone | The reveal pick line reads 「阿聰（你） 揀咗 小美…」 on the 諗樣's view (`p1-003.png`), the screen the table is meant to share (C2). On a laid-down phone 「你」 points at the 諗樣, not the reader. The same holds for the shell results / lobby scoreboard (undercover C7). 「輪到你」 in the header is right: it shows only for the seat holding the phone | `js/games/9upper/ui.js:45` (`seatName`), `:651` | On a shared phone (`api.shared`) drop 「（你）」 on public lines (reveal, score strip). Shell: as undercover C7 | 9upper ui + shell |

## Checks that passed (one-phone specifics, from play and code)

- **The 諗樣 never peeks on one phone.** Readers are the other seats from the 諗樣's left (`game.js:671`). The phone goes to
  the 諗樣 only after the last reader. That satisfies the research one-phone note: 「the Thinker should not handle it during this phase」.
- **Hand-back after the last reader.** `focus(explain) = [judge]` opens 「交俾 <諗樣>」. This was seen in round 1
  (「交俾 大熊」), in round 2 (p2 and p4 both saw 「交俾 阿聰」) and in the reviewer's round 3 (「交俾 阿明」), even when the last
  reader's `hold` ran past the end of the window.
- **Read privacy.** Every read gate is the same plain 「交俾 X · 其他人唔好望」. `openGate` closes every cover first. A seat's
  card (and the 老實人's text) exists only from its own 「開始睇卡」 (`hasCard`, `mayRead`, `game.js:968-981`). After the
  window the reader's screen shows no card (`showCard` only in `peek`).
- **Anti-tell.** Every reader has the same 9 s, started by their own tap and closed by the clock. There is no 「我睇完」
  and no early end. The cards have the same shape and the same open sound. The 「你冇打開到張卡」 note is private to that seat.
- **No step waits forever on a seat that cannot get the phone** with the default config. term and judge wait on the
  諗樣, who has the phone. read gates each reader. In explain the 諗樣 can always 下一位 or 決定 (C1 is wrong labelling,
  not a block). A 💤 諗樣 lets anyone press 下一輪 (`ui.js:659`). Exception: C5.
- **Round change.** reveal → 下一輪 → gate to the next 諗樣. This worked on both changes.
- **Scoring and the reveal screen.** Both rounds are exact (`history` above). The reveal lists the 老實人, the 9upper,
  one line per effect, the true explanation with its source, and 分數變動 (`p1-003.png`).
- **Two-tap guards.** 換題 (counter 3 → 2) and 收皮啦 (剩 1 → 0, then disabled) both needed the second tap.

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p1 (major) | 「The phone was not handed back to the Thinker after the last peek; 大熊 had to 換人」 | tooling (T1) | The gate 「交俾 阿聰」 was up: p4 saw it after his hold (「screen immediately transitioned to pass-gate for Thinker」) and so did p2 (「交俾 阿聰」). The referee gave 阿聰, its target, full access, and `see` printed the page **behind** the gate, because the gate was still at opacity 0 and `see` skips anything under 5 % opacity. That page was 大熊's explain view: 「而家睇：大熊」, 「大熊（你） ⏳ 等緊」, every control COVERED. Reproduced in round 3: the hand-back gate appears, and a freshly opened gate stayed at opacity 0 for ≥ 0.87 s in this headless Chrome |
| p2, p4 (blocker) | 「Thinker stuck / phone stuck with 阿聰 for 4–10 min; Thinker forced through the read hand-over」 | app-is-right + AI-artifact | Spec §4.1: in explain the 諗樣 holds the phone and the talking is aloud. Research: 「Nothing is typed (explanations are spoken)」. The 「交俾 阿聰」 they saw was the hand-back **after** the reads, not a peek for the Thinker. 阿聰 then waited for 大熊 and 阿明, whose agents had stopped |
| p1, p3 (blocker / major) | Round-3 gate 「交俾 阿明」 froze the table for 18–20 min with no escape | AI-artifact + tooling (T4); app part → C6 | 阿明's agent had stopped. At a real table anyone takes the phone and taps the gate, then the host uses ⋯ → 💤 or 呢輪作廢 (spec §3.2a). The referee allows only the named seat. The real gap, no escape on the gate itself, is C6 (minor) |
| p1, p3 (major) | Nobody saw the round-1 reveal | merged → C2 | |
| p1 (minor) | The first speaker was chosen by the app, not the 諗樣 | app-is-right | Spec §3, decision #20: in 諗樣揀 the queue is 「a **suggestion** that starts at a random 玩家… the 諗樣 may call anybody at any time」, and the 「👉 叫佢講」 buttons did that. 「大熊 held the phone at that moment」 is T1 again: the phone was gated to 阿聰 |
| p1 (minor) | Two-tap confirms (換題, 收皮啦) close after 3 s | AI-artifact | `confirmButton` arms for 3 s (`ui.js:226`). A person double-taps in under 1 s, while each console `tap` takes about 3.3 s (T7). It worked once the taps overlapped |
| p1 (minor) | 「輪到你」 / 「大熊（你）」 point at the wrong person | partly confirmed → C8; rest tooling | 「輪到你」 shows only for the seat that holds the phone, and that is right. 「大熊（你）」 was 大熊's own screen, seen by 阿聰 through the transparent gate (T1). The public reveal line is C8 |
| p1 (minor) | 🙋 我識呢條 is dead for non-諗樣 on one phone | app-is-right + tooling | In `term` the phone is with the 諗樣 (spec §4.1), and the 諗樣's screen says 「有人已經識呢個詞？出聲就換題」, which is the right one-phone instruction. 阿聰 saw the 玩家 screen (with 我識呢條) only through the transparent gate after his own 下一輪 (T1). On a real phone that screen is never shown to a 玩家 at a one-phone table |
| p1, p3 (minor) | Tell: the next screen (round-3 term) shows before the gate covers it | tooling (T1) + polish C7 | The term is public by rule (research step 3: everyone, the Thinker too, reads it before the peek). On a real phone the fade lasts 0.18 s; the console showed it for seconds (T1) |
| p3 (minor) | The shown phone keeps 換人 ⇄ / 💡 / 收皮啦 drawn | app-is-right | A phone laid in the middle is still the 諗樣's phone and the 諗樣 still uses those buttons. Read-only is a console rule for `show` |
| p3 (minor) | The speaking list contradicts the table | merged → C1 | |
| p3 (minor) | No reading order on the public screen | app-is-right | Each read gate names the next reader, and the order is fixed (seat order from the 諗樣's left: rules 「用一部手機玩」, cue 「部手機由阿B開始逐個傳」). p3 inferred an odd order from console gate lines that belonged to the end of round 1 and the start of round 2 (「交俾 大熊」 = r1 hand-back, 「交俾 阿聰」 = r2 諗樣) |
| p3 (polish) | Three taps per peek (gate, 開始睇卡, hold) | app-is-right (design) | The gate confirms the hand-over and 「開始睇卡」 starts the reader's own clock (spec §3.3: 「started by their own tap」). Folding them would start the 9 s while the phone is still in transit |
| p2, p3, p4 (major / minor) | Hold-to-peek showed no card or no feedback; a reader lost the window | tooling (T3) / AI-artifact | The window starts on 「開始睇卡」 (by design). The separate `hold` came 3–5 s later and is capped at 8000 ms. `hold` prints the screen while held, so if the card text was missing, the window was already over |
| p4 (major) | Explanations are not shown on the phone; the 諗樣 cannot review claims | app-is-right | Research: 「What stays human: the talking, cross-examination, and judging… Nothing is typed」 |
| p4 (major) | Non-諗樣 cannot request the phone | app-is-right | A speaker does not need the phone to talk. The one thing they would need it for (我講完) is C1, fixed on the 諗樣's side |
| p4 (minor) | The reveal needs a 「ready to see results?」 gate so the holder cannot read others' roles | app-is-right; the hand-off part → C2 | At the reveal every role is public (research step 8) |
| p2 (minor) | Hold gives no textual feedback | tooling (T3) | As above |

## AI-artifacts (would not happen with people)

- Round 1 had no talking at all. The AI 諗樣 大熊 called no one aloud and picked after about 2 minutes. The others did
  not know the discussion had started, because they could not see the public screen (T6).
- 阿明 (the 老實人 in both rounds) and 大熊 stopped answering from about 06:45 UTC. So round 2 had one explanation, and
  round 3 froze at the gate.
- The two-tap confirms and the 9-second windows were missed because of command latency, not reading speed.

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | effect in this run | fix |
|---|---|---|---|
| T1 | `see()` decides the modal from `styleVisible`, which drops anything under 5 % opacity (`pt.mjs:106`, `:134`). A fresh `.c-passgate` starts at opacity 0, and in this headless Chrome frames ran slowly: rAF took 0.1–0.6 s, and a new gate stayed at opacity 0 for ≥ 0.87 s. Meanwhile the referee (`REF_STATE`, `:428`) already sees the gate and gives its **target** full access | 阿聰 was shown 大熊's explain screen behind his own gate (major report p1), saw the next round's term early, and reported 我識呢條 and 「（你）」 problems that came from the screen behind | In `see()` treat `.c-passgate` (and any `[aria-modal=true]` with a box) as the modal whatever its opacity. Or run `document.getAnimations().forEach(a => a.finish())` before reading. Never list controls behind a gate |
| T2 | Overlay darkness is `opacity × background-color alpha` (`pt.mjs:122-126`), so a gate painted with a gradient `background` always reads 「0% darkness」 | Players doubted that the gate covered the screen | Count `background-image !== 'none'` as opaque |
| T3 | `hold` is capped at 8000 ms (`pt.mjs:503`), the read window is 9 s, and it starts at the separate 「開始睇卡」 tap | 小美 missed her round-2 card. 阿明 (老實人) and 大熊 were unsure what they had read | Add a `peek <n>` op that taps 「開始睇卡」 and holds the cover at once until the window closes. Raise the cap to 15 s |
| T4 | Only the named seat may tap a gate (`pt.mjs:444-449`, `:695`) | An AI seat that went silent froze the table for 20 min (the 10-minute stall rule ended the run) | After N minutes (or on `tap --for <seat>`) let the host tap a gate for an idle seat, with a public `say` line 「（阿聰 代 阿明 㩒咗）」, as a person would. Then the app's ⋯ → 💤 path (C6) can be tested |
| T5 | A shared-table `wait` keys only on the screen (`pt.mjs:577-590`), so a `say` does not wake it | p1: 「nothing changed in 60 s」 while 小美 had just spoken | Include the chat-log length in the `wait` key and print new lines |
| T6 | Non-holders learn nothing about public steps unless the holder uses `show` | Round 1 passed with nobody speaking. Nobody but the holder knew when 解釋 started or who was 🎤 講緊 | For non-holders, `wait` prints the current narrator line and the screen title (both public by design: 「every cue is public information」). Optionally print a line when the seat is named 🎤 講緊 |
| T7 | About 3.3 s per `tap` (scroll, metric check, hover, 450 ms settle) | A sequential second tap re-armed the 3 s confirms instead of confirming | Add `tap <n> --twice` (two clicks 300 ms apart) for arm-then-confirm controls, or cut the settle time |

## Reviewer's checks on the live table (07:33–07:45 UTC, after the players stopped)

1. Round 3 reads: 阿明 tapped his gate and 開始睇卡. The gates went 小美 → 大熊 → 阿聰. 阿聰 then held the card from about
   5 s into his window until it had ended, as 大熊 did in round 2. Result: `focus [p2]`, gate 「交俾 阿明」 up, opacity 1.
   **The hand-back works** (T1 explains the round-2 report).
2. Gate fade: a gate opened by 換人 sampled every 40 ms showed `opacity 0` for 625 ms without `.in`, then still 0 at 871 ms
   with `.in` (C7, T1).
3. 換人 ⇄ during explain: the 諗樣 handed the phone to 小美. She saw her screen, then an auto gate 「交俾 阿明」 covered it at
   once (`activeSeat p3, focus [p2]`) (C3).
4. 下一位 ×n by the 諗樣: `skipped = [p3, p4]`, then `p1`. After the last speaker the floor went back to 小美, then 大熊
   (`back = [p3, p4]`). Every row read 「⏭ 跳過咗 · 叫返佢」 (C1).

The table was stopped with `node tools/playtest/pt.mjs stop sp-9upper`. Screenshots: `p4-001.png` (r1 explain on 大熊),
`p2-002.png` (r3 gate), `p1-003.png` (r2 reveal) in `%TEMP%\bgbox-playtest-shots\sp-9upper\`.
