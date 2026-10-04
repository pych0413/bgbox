# 阿瓦隆 (avalon): one-phone playtest review

> Session `sp-avalon`, `--shared` (ONE 390x844 phone passed around a 5-seat table), 2026-10-04 08:55–09:41 UTC.
> Build under test: `https://pych0413.github.io/bgbox/` build `20261004005209`. It matches local HEAD `16da24d`, so the
> line numbers below are the code that ran. Config: the one-phone defaults (preset recommended: 梅林 · 派西維爾 · 亞瑟忠臣 /
> 刺客 · 莫甘娜, Lady off at 5, `revealSecs = questSecs = 0`, `passPhone = true`, assassination 120 s soft clock).
> Narration was 🔇 靜音, chosen by the console setup and not the app default. Seats: p1 阿聰 (host), p2 阿明, p3 小美,
> p4 大熊, p5 阿強. Reviewer: opus, read-only (no code edited).

## Verdict

**Not finished. The rules were right at every step played, but on one phone the public information is not public.**
The match stalled at the Quest 4 vote with 2 successes and 1 fail. The gate 「交俾 阿明 · 其他人唔好望」 was up from
09:20:11 UTC until the table was stopped (more than 20 minutes). The cause was the p2 (阿明) agent, which stopped
playing after 09:16:55 and never tapped the gate. That part is an AI artifact. Still, a real table has no clean way past
a player who walks away (C5).

Everything the engine did checks out against the verified rules (§ Facts): the roles and night knowledge, team sizes
2/3/2/3, leader rotation, the strict majority (3:2 passes), and one Fail failing Quest 2. Passing the role reveal round
the table leaked nothing.

Four gaps matter when the whole table shares one phone:

1. **The public screens go to the leader behind a 「其他人唔好望」 gate** (C1). Those are the vote reveal with names, the
   quest result and the team pick. In 靜音 the other four players learned a result only if the leader remembered to
   show the phone. In rounds 1 and 3 nobody did, and p3 never saw the 5:0 and 3:2 reveals live.
2. **No gate when a public screen becomes the same holder's secret screen** (C2). 小美 laid her Q4 proposal face up,
   confirmed it, and her vote screen opened on the face-up phone. 阿強 read her pending 「確定：贊成」 at 「已投 0/5」.
   In Q2, 阿聰 showed the vote reveal face up and then went straight to his own quest card, where he played Fail.
3. **One-phone mode drops the reveal's anti-tell window** (C3). Multi-phone play gives everyone the same 25 s. One phone
   uses tap mode with no minimum, so a Servant (two short lines) taps 「我睇完」 seconds before Merlin or an evil player.
   The rules text still says everyone gets the same time.
4. **A seat that steps away freezes the table** (C5). The full-screen gate covers ⋯, 💤 and 代佢做. For an order-free vote
   the gate keeps going back to the same seat (seat order, not clockwise: C4). Meanwhile the host's 「無反應」 list names
   players who are only waiting for the phone (C6).

C1 and C2 share their root with undercover C2/C3 and onuw C2 (`play.js:344`), and C5 is 9upper C6. One shell fix
covers all of them.

## Facts from the table

| | |
|---|---|
| Deal (engine state) | 阿聰 刺客 · 阿明 莫甘娜 · 小美 亞瑟忠臣 · 大熊 派西維爾 · 阿強 梅林 |
| Night knowledge | 梅林 阿強 sees [阿聰, 阿明] ✓ · 派西維爾 大熊 sees [阿強, 阿明] (Merlin + Morgana, shuffled) ✓ · 阿聰 and 阿明 see each other, no roles ✓ · 小美 none ✓ |
| Reveal walk | `seen` order p1 → p2 → p3 → p4 → p5. 阿聰 had the phone from 開始, so his reveal opened with no gate behind the hold cover, then one gate each |
| Q1 | leader 阿強, team 小美 + 大熊, 5:0, both Success → ✓ |
| Q2 | leader 阿聰, team 阿聰 + 小美 + 阿強, 5:0, 阿聰 played **Fail** → ✗ (2 成功 · 1 失敗) |
| Q3 | leader 阿明, team 阿明 + 大熊, **3:2** (小美 and 阿強 rejected), both Success (Morgana played Success) → ✓ |
| Q4 | leader 小美, team 阿明 + 小美 + 大熊. Votes in: 小美 approve (first, no gate), 阿聰 approve. Then the gate 「交俾 阿明」 from 09:20:11 UTC |
| End state | `room.phase = playing`, `game phase = vote`, `focus = { pids: [p2, p4, p5], together: true }`, `activeSeat = p1`, `lastResult = null`, `history = []`, `room.idle = [p2, p4, p5]` since 09:20:11 |
| Last table talk | 阿明's last line was at 09:16:55. Nudges from 阿強 (09:22:26), 大熊 (09:22:55), 阿聰 (09:23:32) and 小美 (09:28:11) got no answer |

The stuck gate (`p2-001.png`, taken by the orchestrator) fills the whole screen: 🔒, 「交俾 阿明」, 「其他人唔好望」 and one
button, 「準備好喇，㩒一下」. ⋯, 換人 and the host menu are all underneath it.

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| C1 | major | one-phone flow / missing right | Public steps (pick, vote reveal, quest result) go to the leader behind a 「其他人唔好望」 gate, and nothing says to show the table | The rules make the votes public with names, and the quest result public as counts (research: "revealed simultaneously **with names**"; "the leader … reveals them all"). Spec §4.2 says that after `voted` and `quest-result` 「the phone is the public scoreboard: pass it round or read it out loud」, but no screen says so. The gate (`play.js:350`) reads 「交俾 小美 · 其他人唔好望」 for every step, so the table is told *not* to look at the very screens it should read. In 靜音 nothing is spoken (`cueVoted` / `cueResult` exist but are silent). The table learned the Q1 and Q3 reveals only from 🗂 提議記錄 afterwards, and the Q2 reveal only after 阿明 and 大熊 asked 阿聰 to 「show 俾大家睇」 (09:03:32, 09:03:35, 09:08:49). The leader can also misreport the tally or the Fail count. Each round also costs two extra hand-overs (last voter → leader, last quest member → leader), about 9–10 gates a round at 5 players. p1, p3 and p4 all reported this | `js/games/avalon/game.js:1117-1119` (`pick` / `voted` / `quest-result` focus = `[leader]` with no "public" mark); `js/ui/screens/play.js:346-350` (one gate wording for every step); `js/games/avalon/ui.js:443-478`, `:545-580` (no one-phone line); `js/ui/components/PassGate.js:22` | Engine: focus `{ pids: [leader], public: true }` for `pick`, `voted` and `quest-result`. Shell: for a public focus, the gate reads 「交俾 隊長 小美 — 公開畫面」 · 「擺喺枱中間，大家一齊睇」 (never 「其他人唔好望」). Avalon UI, when `api.config.passPhone`: a banner on `voted` / `quest-result` 「📢 擺喺枱中間俾大家睇清楚，先㩒繼續」. Optional: on a shared phone let whoever holds the phone tap 繼續 on these two public screens without a gate, which saves two passes a round. Same pattern as 9upper C2 and undercover C2 | avalon + shell |
| C2 | major | privacy / tell | No gate when a public screen turns into the same holder's secret screen (the leader's vote; the leader's own quest card) | `evaluateFocusGate` opens no gate when focus already includes the seat on screen. **Pick → vote**: the leader shows the proposal for discussion, taps 確定, and their ballot opens first on the face-up phone. In Q4, 阿強 (p5) read 小美's pending 「確定：贊成」 at 「已投 0/5」, and p1 saw the vote screen while the phone was 「擺咗出嚟」. **Voted → quest**: when the leader is on the team (as 阿聰 was in Q2, and leaders often are), 繼續 on the public reveal opens their own quest-card screen with no gate. 阿聰 had laid the Q2 reveal face up (09:07:17 「投票結果擺出嚟喇」) and then played Fail on the same phone. Once C1 tells leaders to put these screens in the middle, this path gets used every round | `js/ui/screens/play.js:344` (`here.includes(seat)` → no gate) | On a shared phone, open a gate on every step change into a secret step, even for the same seat. Remember the last public step, and when the next focus is a secret one (vote, quest, reveal) show 「交俾 小美（投票）· 其他人唔好望」 once. It costs one tap. Same root and fix as undercover C3 and onuw C2 | shell |
| C3 | major | anti-tell | One-phone mode drops the reveal's equal-time window; holding time tells who has information | Multi-phone play has one 25 s reveal window for everybody (spec §3.1: 「the phase never ends early」). With `env.singleDevice` the engine sets `revealSecs = questSecs = 0` (`game.js:218-219`), and 「我睇完」 works at once (`ui.js:321-332`). A Servant's card is two short lines (p3 read his in under 2 s). Merlin, Percival and evil read and memorise names, and the whole table watches who keeps the phone longest. The same holds for the quest card: hesitating over Fail takes longer than tapping Success. The research's one-phone notes require 「the same screen duration for every player … Cap reveals at a fixed length」 and 「a minimum decision window」. The rules sheet still promises 「睇身份嗰段時間每個人都有同樣長，冇人可以靠「睇得快唔快」估到邊個有情報」 (`script.js:149`), which is false in tap mode. Spec §4 says only 「Tell people to take about the same time」, and no screen tells them | `js/games/avalon/game.js:218-219`; `js/games/avalon/ui.js:321-332` (reveal), `:503-507` (quest confirm); `js/games/avalon/script.js:149`, `:535` | When `passPhone` is set: a per-holder minimum counted from the gate tap, the same for every role. 「我睇完」 unlocks after about 8 s (the reveal) and 「確定出牌」 after about 4 s (the quest), with a small fill ring so it reads as a rule and not lag. noteTap: 「每個人都揸住差唔多耐先交，唔好俾人睇出你有冇情報」. Rules line: 「一部手機：每個人最少揸住 8 秒先交得」 | avalon |
| C4 | minor | handover | The vote and quest walks always start from seat 1, not clockwise from the holder | `focusSeatsHere` keeps room seat order and the gate always takes `here[0]`. In Q4 the walk went 小美 (p3, leader) → 阿聰 (p1) → 阿明 (p2) → 大熊 → 阿強, so the phone crossed the table twice. Going clockwise from the leader would be p3 → p4 → p5 → p1 → p2. The research's advice is 「pass around once」 and 「keep the pass order fixed」 | `js/ui/screens/play.js:311-315`, `:346` | On a `together` focus, order the remaining seats by clockwise distance from the current holder (or from the leader) | shell |
| C5 | minor | one-phone flow | A gate for a seat that stepped away has no way out, and for a vote it keeps going back to that seat | The gate covers the whole screen and has one button (`PassGate.js:22-44`). ⋯ → 💤 標記缺席, 代佢做 and 呢輪作廢 are all underneath it. A real table can only tap through into the missing player's own screen to reach them. For an order-free step (the vote), 換人 to 大熊 lets him vote, but the next gate goes straight back to 阿明 (`here[0]`). Nothing on the gate says how long it has waited. In this run it held the table for 20+ minutes (AI artifact, see below), but a player on a bathroom break hits the same wall. p1, p3, p4 and p5 all reported it (p4 and p5 as a blocker) | `js/ui/components/PassGate.js:22-44`; `js/ui/screens/play.js:317`, `:346-350` | On a `together` focus, add a quiet second button to the gate: 「阿明 唔喺度？交俾下一位（大熊）」. It moves the gate to the next pending seat and puts 阿明 at the end of the walk. After about 2 minutes, add 「等咗好耐 — 房主可以 ⋯ → 💤」, which opens the host menu without opening 阿明's screen. Same as 9upper C6. An automatic pass after a timeout (p4) would be wrong, because nobody may vote for an absent player | shell |
| C6 | minor | host tools | 「斷咗線 / 無反應」 names players who are only queued behind the gate | Eval at the stall: `room.idle = [p2, p4, p5]` since 09:20:11. On one phone every seat is "connected" (same device) and only one can act, so every pending voter counts as idle once `stallMs` (45 s) passes. The host menu then offers 「🤖 代 大熊 做」 (an automatic Approve) and 「💤 當 大熊 缺席」 for 大熊 and 阿強, who were just waiting their turn | `js/core/room.js:1494-1508` (`othersWait` treats every blocked connected seat alike); `js/ui/screens/play.js:476-484` | In a `singleDevice` room, flag only the seat the gate currently names (the first of the walk), labelled 「等緊 阿明 拎部手機」 | core |
| C7 | minor | privacy (from code) | The 「我嘅身份 · 㩒住睇返我係咩」 cover is on every public screen | `paintMini` shows the hold-to-peek identity card on pick, voted and quest-result. On a shared phone those are the screens laid in the middle (C1), and anyone can hold the cover and read the leader's role and night knowledge. That would be cheating in plain sight, but it is also one stray thumb away | `js/games/avalon/ui.js:757-767` | With `passPhone`, hide the mini card on the public steps (`pick` for non-holders, `voted`, `quest-result`). A player who wants to re-read uses 換人, which goes through their own gate. Same as undercover C6 | avalon |
| C8 | minor | text | Merlin is told about a hidden Mordred in a game with no Mordred | The note 「（睇唔到莫德雷德，亦唔知有幾多個冇俾你睇到）」 is fixed text. This deck had no Mordred and Merlin saw both evil players. p5 (Merlin) reported 「warning that one evil (Mordred) is hidden」. A Merlin who believes in a hidden third evil plays the whole game wrong | `js/games/avalon/script.js:514`; `js/games/avalon/ui.js:276` | Choose the note from the public deck: no Mordred and Oberon seen → 「（全部邪惡你都見到）」; Mordred in → the current text; Oberon hidden from Merlin → 「（奧伯倫你睇唔到）」. The deck is public, so this leaks nothing | avalon |
| C9 | minor | text (from code) | Wording that assumes one phone each | The reveal cue says 「大家望住自己部電話，㩒住張卡睇…」 (`script.js:329`), spoken in 🔊 語音 and shown in 📜 讀稿. The rules night section is titled 「夜晚情報（喺你部電話睇…）」 and ends with the equal-time promise (`:143`, `:149`, C3). The table-view lines 「大家望住自己部電話睇身份」 (`:534`) and 「隊員正喺各自部電話秘密出牌」 (`:588`) are seatless-only and not reached on one phone. Not observed in this run (靜音) | `js/games/avalon/script.js:143`, `:149`, `:329` | `passPhone` variants: 「部手機會逐個交，輪到你先㩒住張卡睇，睇完㩒「我睇完」交俾下一位。」 Same pattern as undercover C4 and onuw C9 | avalon |
| C10 | minor | ux | After a hand-over the new holder lands mid-page | `openGate` → `setActiveSeat` remounts the game UI but never scrolls to the top (only `shell.js:275` does, on a screen change). The stuck page sat at `scrollY = 125`, and p3 saw offsets of 125/149, 181/246 and 246/425 after gates, with the status line and the board off screen. The console's own scroll-to-centre before every tap makes it worse here, but a real previous holder's scroll carries over the same way | `js/ui/screens/play.js:293-304` | `window.scrollTo(0, 0)` after a gate resolves and on `switchSeat` | shell |
| C11 | minor | one-phone flow (from code) | The assassination gate asks everyone to close their eyes before the evil team has talked | The step opens with `{ anonymous: '刺客請拎起部手機' }` and the gate 「其他人閉埋眼，唔好望」 as soon as the leader taps 「去刺殺階段」. The 120 s 「商量時間」 starts at the same moment (`startAssassinate`) and runs behind the gate. The screen title is 「邪惡陣營商量，刺客揀人」, and the research says Evil confer first. So the evil team confers with eyes closed, or the gate waits on an untimed talk. Not reached in this run | `js/games/avalon/game.js:549-558`, `:1130`; `js/ui/screens/play.js:332-341` | With `passPhone`: first a public 「邪惡陣營商量」 screen with the clock, face up in the middle. Any tap on 「準備好，刺客拎機」 then opens the anonymous gate | avalon |
| C12 | polish | text | 「（唔知佢哋嘅角色）」 with a single evil partner | At 5 players the evil card names one partner, but the note uses the plural 佢哋 | `js/games/avalon/script.js:520` | One partner → 「（唔知佢嘅角色）」 | avalon |
| C13 | polish | text | Screens laid face up speak to the holder: 「輪到你」, 「你係隊長」, 「阿聰（你）」 | When 阿聰 showed his Q2 pick, the table read 「輪到你 隊長 阿聰」 and 「你係隊長。揀 3 個人」 | `js/ui/screens/play.js:616-620` (turn badge); `js/games/avalon/script.js:539`; seat editor 「（你）」 | On a shared phone, public screens use the name (「阿聰係隊長」) and no 「（你）」. Same as onuw C6 / C11, undercover C7 and 9upper C8 | shell + avalon |

## Checks that passed (one-phone specifics, from code and play)

- **The reveal walk** went one gate per seat in seat order. The gate card shows nothing behind it, and the role sits behind
  a hold-to-peek cover with the same five-row layout for every role (`ui.js:251-287`). No role tell was seen at the table.
- **Night knowledge** is exactly as the verified rules say (engine state above). Percival's pair was shuffled. Evil
  players learn names, never roles.
- **Votes**: the screen shows only 「已投 x/5」. A locked vote is never on screen (`ui.js:421-436`). The tally is a strict
  majority of all seats.
- **The quest card**: the screen is the same for good and evil. The order of the two tiles is randomised per seat, a
  good player's 失敗 is inert with the same look and sound, and 「確定出牌」 never names the card (`script.js:583`).
- **The pile** is built from counts and shuffled. 「牌已經洗亂，睇唔出邊個出咩」.
- **🗂 提議記錄** keeps every proposal with leader, team, tally and rejecters, plus each quest's counts. It was the only way
  p3 caught up on rounds 1 and 3.
- **From code**: the assassination uses an anonymous gate that opens even when the Assassin already holds the phone
  (`play.js:332-341`), so the gate never shows whether the Assassin is the holder. The Lady (7+) goes to the holder, with
  the result behind its own cover.

## Rejected findings

| reported | by | why rejected |
|---|---|---|
| The picked tile and 「確定：贊成」 are readable by a neighbour | p1 minor, p3 minor | **App is right.** On a shared phone only the holder sees the screen while picking, behind the gate. The pick has to be visible to the person making it. The quest confirm is already neutral (`script.js:583`) and the tile order is random per seat. The vote's two-tap 「確定：贊成」 is a deliberate stray-thumb guard (spec §3.3), and locked votes are never shown. The actual leak path was the missing gate (C2) |
| Merge C2: "show mode carried over onto the secret vote screen" | p1 major, p4 major, p5 minor | Merged into **C2**. The `show` persistence itself is a console rule (T2). The missing gate is the app part. p5's 「確定：贊成 while 已投 0/5」 is not an inconsistent state: it was 小美's pending, unconfirmed vote, and it is evidence for C2 |
| "Night phase was not tested" | p2 | **Misread.** Avalon's night is the hold-to-peek reveal (spec §3.1). p4 and p5 confirmed their information, and the engine state matches |
| "Show mode vs pass-gate mode are confusing" | p2 | **Tooling.** `show` is a console verb (README, `--shared`). The app has no such state |
| "Quest card gate unclear, prior screen may linger" | p2 | **Unverified.** No evidence was given. The game UI remounts per seat (`play.js:681-684`: the key includes the seat) |
| Gate text unclear (「交俾 X 其他人唔好望」) | p2, p4 | **AI artifact.** The gate has one button, 「準備好喇，㩒一下」, and the other players used it without trouble. Saying which step a gate opens is undercover C8 |
| The 「換人 ⇄」 hint confused 阿明 and caused the stall | p5 major | **Wrong.** 「等佢交俾你（佢㩒「換人 ⇄」揀你）」 is the console's message to non-holders (`pt.mjs:460`), not app text. As the gate target, 阿明 got full access to the gate (`pt.mjs:447`). The stall came from the p2 agent stopping |
| The gate needs a 60 s timeout that forces a pass | p4 blocker | **Wrong fix.** Nobody may vote for an absent player, and an automatic Approve would change the result. The real gap is C5 |
| The Q2 result card had ✗ ✓ but no numbers | p1 polish | **App is right.** 「成功 2 張 · 失敗 1 張」 is in `.av-late`, which fades in after the pile flips (`style.css:187`, about 1.4 s). The console's `see` drops text below 5 % opacity and ran about 0.45 s after the tap |
| Show the names of who has not voted (「仲等：X」) | p3 polish | **By design** (spec §3.3: a count, never who). On one phone the gate names the next voter anyway |
| The proposal log is open by default | p3 | **Unverified.** The `<details>` is created closed (`ui.js:96`) and remounted per seat |
| A slow vote is a timing tell | p2 minor | Merged into **C3** |
| 5-player voting took 10+ minutes | p2 major | **AI artifact** (agent latency of 30–120 s per command). A person passes in seconds. The structural extra passes are in C1 and C4 |
| The Q2 result needed a 90 s wait and had no show button | p4 minor | `show` is a console verb. The structural part is C1 |
| The Merlin note is awkward Cantonese | p5 minor | Merged into **C8** (the real problem is that it appears with no Mordred) |

## AI artifacts (not app bugs on their own)

- **The stall.** The p2 (阿明) agent stopped playing. Its last line at the table was at 09:16:55, and it never tapped
  「交俾 阿明」 (up from 09:20:11). Its report is unreliable: it describes a 「75+ minute」 session running to 10:15 UTC
  (the table was stopped at about 09:41), a 1:1 score (it was 2:1), and claims it played Quest 1 (it was not on that
  team). p5 also claims a Quest 1 card it never played (p5 led Q1, and the team was 小美 + 大熊).
- 60–120 s silences at most gates are agent polling time, not app latency.
- p4 and p5 timelines (about 22 min vs about 65 min) do not match the table log.
- A slow human would still hit C5 (someone away from the table), so that finding stays, at minor.

## Tooling notes (`tools/playtest/pt.mjs`)

- **T1 No presence check, and no table rescue.** The referee cannot tell a slow seat from a seat whose agent has gone.
  Track the last command time per seat in the daemon. Refusals and `wait` output can then add 「⚠️ 阿明 已經 N 分鐘冇郁」.
  Add a README table rule that mirrors a real table: after 5 minutes on a gate whose target has been silent, the host
  seat may tap it **only** to open ⋯ → 💤 for that seat. The referee allows that one path. The orchestrator should also
  watch `hear` and the gate for longer than 5 minutes and re-spawn the seat. Players should `say` before leaving.
- **T2 `show` outlives a phase change.** `shownFor` is kept while the holder is the same and no gate appears
  (`pt.mjs:458`). So the leader's face-up proposal stayed face up onto their own secret ballot. End `show` when the
  view's phase or step changes, as a person picks the phone back up. The app-side gap (C2) stays reported.
- **T3 `wait` is capped at 120 s** (`pt.mjs:578`), which equals the Bash tool's default 120 s timeout. `wait 120` (or
  p2's `wait 300`) is killed by the harness. Cap it at 90 s and say so in the README.
- **T4 「covers the screen at 0% darkness」 for pass gates.** The overlay probe reads only `background-color`
  (`pt.mjs:121-129`), and `.c-passgate` paints a `radial-gradient` background image (`css/base.css:597-602`). Treat a
  `background-image` other than `none` as opaque. In `--shared` mode, print a one-liner instead, for example
  「📱 張交接卡叫你 — tap 1」.
- **T5 Scroll carry-over on the shared window.** `resolve()` scrolls every target to the centre before a tap, and on one
  window that offset reaches the next holder. Add this to the README quirks for `--shared`, and keep C10 since the app
  should reset the scroll anyway.

## Fix list for the orchestrator (priority order)

1. **C2 + C1 (shell + avalon).** A gate on every public→secret step change, a public gate wording plus a 「擺喺枱中間」
   banner for pick / voted / quest-result, and optionally no gate for 繼續 on public screens. This shares its root with
   undercover C2/C3, onuw C2 and 9upper C2.
2. **C3 (avalon).** An equal minimum hold on the reveal and the quest card when `passPhone` is on, and correct the
   rules text.
3. **C5 + C6 + C4 (shell / core).** 「唔喺度？交俾下一位」 on together-gates, a long-wait hint to the host menu, idle
   only for the gated seat, and a clockwise walk.
4. **C7, C8, C11 (avalon).** Hide the mini card on public screens, choose the Merlin note from the deck, and add a public
   talk screen before the Assassin's gate.
5. **C9, C10, C12, C13** text and scroll polish.
6. **Tooling T1–T5**, before the next one-phone run, because T1 alone would have saved this match.
