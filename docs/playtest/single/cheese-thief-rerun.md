# 芝士大盜 (`cheese-thief`): one-phone re-run review

Session `sp2-cheese-thief`, 2026-10-04 15:45–16:07 UTC, local build at `328b04f` (v2: table mode, public/private gates, phone to the middle at dawn, co-wakers on one screen, gate escape; DESIGN §7.1). One shared 390×844 phone window (`pt.mjs --shared`) and a referee for the holder, pass gates and eyes closed. Five AI players: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強.

Settings: official rules (pick5 off), `hourSec` 10 plus the 10 s one-phone pad (a 20 s window), `discussSec` 300, recap on, narration 🔊 語音 (the app default; the lobby offers no 靜音 on a whole-table phone).

Sources:
- Rules: `docs/research/cheese-thief.md` (its "## Verification" section wins) and `docs/games/cheese-thief.md` (§3.2–3.4, §4 single device, §11).
- Contract: DESIGN §7.1.
- Code: `js/games/cheese-thief/{game,ui,script}.js`, `js/ui/screens/play.js` (evaluateFocusGate, anonGate, openGate, goTable, switchSeat, walkHere, seat chip), `js/ui/logic.js` (walkOrder, nightChrome), `js/ui/components/PassGate.js`, `js/ui/shell.js`, `js/core/sfx.js`, `tools/playtest/pt.mjs`.

Evidence:
- `room.lastResult`, `room.history` and `hear` (the narration and table talk).
- The 5 screenshots: p3-001 (vote), and p1-002, p3-003, p4-004 and p5-005 (results).
- A short verification game driven on the same phone after all facts were collected (16:17–16:21 UTC).
- Tests: `node tests/run.mjs cheese-thief` gives 105 passed, 0 failed; `ui-logic` gives 56 passed, 0 failed.

## Verdict

**It finished, and every ruling was correct.** The thief 大熊 (die 6) woke alone at hour 6 and stole unseen, so this 5p game had no follower. The vote went 大熊 4, 阿強 1. The sleepyheads won and scored +1 each.

**All 11 run-1 findings are fixed, including the dawn blocker.** At dawn the phone went to the middle behind 「☀️ 天光喇」 for everyone. The day ran from the table screen. Co-wakers at hours 2 and 5 shared one screen. Nobody was called 「你」 on the results.

**Night anti-tell held.** Every hour was the same length: the narrator's 「請閉返眼」 came 29 s apart for empty, two-awake and one-awake hours alike. The hour gate never named anyone, and the decoy gate looked exactly like the real one.

**Findings: 1 new major, 3 minor, 1 polish.**
- **Major (verified live): the first vote gate names the last night holder** whenever nobody picks their own seat by day. In 6–8p that seat is always on the thief's team. It is the same class of leak as the run-1 dawn blocker. Fix it before the next one-phone table (shell, effort S).

## Did it finish?

Yes: `phase = results`, `history` has one entry, and the summary reads 「貪瞓鼠贏 — 大盜 大熊 畀人揪出」.

| fact | value |
|---|---|
| roles / dice | 阿聰 🐭 2 · 阿明 🐭 5 · 小美 🐭 5 · 大熊 🧀 6 · 阿強 🐭 2 |
| night (recap) | h1 nobody · h2 阿聰 + 阿強 · h3 nobody · h4 nobody · h5 阿明 + 小美 · h6 大熊 stole, unseen · 今局冇共犯 |
| hour rhythm | each hour's close came 29 s after the last: 15:50:23, :52, 15:51:20, :49, 15:52:18, :47. Each call→close took 25 s (about 5 s of cue plus the 20 s window) |
| peeks | none were possible: no sleepyhead woke alone |
| day | dawn 15:52:50 behind the 天光喇 card; one table tap at 15:55:57 started the vote, with about 2:50 still on the clock |
| vote | gates 阿聰 → 阿明 → 小美 → 大熊 → 阿強, each 「其他人唔好望 · 投票 · 搞掂 n/5」. Reveal at about 16:05–16:07 (slow AI seats) |
| match length | about 20 min (ready 15:46, night 15:49:48, reveal about 16:06) |

The rules engine was right throughout. The thief stole automatically as its window opened. With no witness there was no follower (research, Night order: "thief alone → no Follower"). The thief was in the top set, so the sleepyheads won (`judge`). Points were 4 × +1 and the thief 0.

## Fixed since run 1 (`docs/playtest/single/cheese-thief.md`)

| run-1 # | finding | now |
|---|---|---|
| 1 blocker | Dawn opened on the last night holder with 「而家睇：X」 and live covers | **Fixed.** Dawn showed 「☀️ 天光喇 · 部手機擺返中間」 for everyone, and the chip read 「📱 枱中間 — 㩒你個名睇自己」 (seen at this table and in the verification game). One part was left behind (see N1). |
| 2 major | Lone peek lost inside the 15 s hour | **Fixed in code, not exercised here** (no lone sleepyhead). The hour is now 20 s (pad, `game.js:293-303`). The bar is drawn from the fixed `view.step.windowMs` with 「仲有 N 秒」 (players read 仲有 15/13/5 秒). 「⏰ 時間到 — 部手機擺返中間，閉眼」 shows when the window ends. The peek takes one tap (`ui.js:552-553`), and the awake card has three lines. |
| 3 major | 靜音 on one phone | **Fixed.** The NarratorBar offers only 🔊 語音 · 📜 讀稿 (p3-001.png), `meta.eyesClosed` (`game.js:35`), and the U1 lobby test passes. |
| 4 major | No one-phone day flow | **Fixed.** The table screen in the middle has the clock and 「🗳️ 大家夠鐘投票 ✓（一下就得）」, which counts for every seat (`api.tableSend`). Players opened their own card and 📓 through the chip and 📱 擺返中間. The one-tap design brings a new concern (N2). |
| 5 minor | Own-phone wording | **Fixed.** SHARED_NIGHT_TIP, the one-phone ready lead and night help, and the rules section 「一部手機玩」. The narrator said 「部手機擺喺枱中間」 and 「部手機逐個交」. |
| 6 minor | 「你贏咗」 / 「（你）」 on shared results | **Fixed.** `results.js:287` passes `me: null`, and the over banner reads 🧀 完咗 (`ui.js:1092-1095`). |
| 7 minor | 換人 live during secret night steps | **Fixed.** The chip is disabled and switchSeat refuses at night or in a secret step (`play.js:687-692`, paintHeader). |
| 8 minor | Shared hour walked in seat order | **Fixed** by U2: one combined screen (`buildCoNight`). Hours 2 and 5 each showed 「你哋一齊醒：…」 to both wakers. |
| 9 polish | Decoy name grid on one phone | **Fixed.** Unusable names are dimmed and the button reads 「睇完就㩒，部手機擺返中間」 (p4 saw the greyed names at hour 6). |
| 10 polish | 🔓 lock reset per seat | **Fixed.** It is hidden on a shared phone (`ui.js:144-154`). |
| 11 polish | Vote gates show no progress | **Fixed.** Gates read 「其他人唔好望 · 投票 · 搞掂 n/5」 (and 「睇牌・擲骰 · 搞掂 k/5」 for the deal). |

Console items from run 1:
- Fixed:
  - die labels are printed (players read their die under hold);
  - progress bars print as 「仲有 N 秒」;
  - `shot` frames are clean (5 good PNGs);
  - narration is echoed to `hear`;
  - the host escape works after 60 s.
- **Still open:** the referee's refusal after a window closes is still the bare 「(你唔可以掂部手機)」 (`pt.mjs:869`). 小美 hit it at 15:52:18.

## Still open from run 1

No app finding from run 1 is still open. Two caveats:
- Run-1 #2 (the lone peek inside the 20 s hour, done with one tap) was not exercised at this table.
- Run-1 #1 is fixed for the screen at dawn, but the last night holder still leaks through the day walk order (N1, below).

## New confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| N1 | **major** | tell | The first vote gate names the last night holder when nobody picks a seat by day | See the list after this table. | `play.js:407` walkHere uses `from: holder ?? lastHolder`. lastHolder is set at night by land() (`:421`) and anonGate (`:680`), and kept through dawn by goTable (`:488`) and evaluateFocusGate (`:598`). `logic.js:198-211` walkOrder ranks seats from that seat. | Set lastHolder to null at dawn (the dawn branch of evaluateFocusGate / goTable('dawn')). Do not record it in land(), anonGate or goTable('silent') while `secretNow(st)`. The first day walk after a night then starts at seat order[0] for every role assignment. Add a shell test: a shared room, a night ending with seat X on screen, then the first day-walk gate is order[0]. Check onuw (its vote walk probably starts at the last night actor, such as the Insomniac) and werewolf. Effort S. | shell: `js/ui/screens/play.js` |
| N2 | minor | rules | 大家夠鐘投票 ends the talk for everyone with one tap and no confirm | Any seat's single tap from the middle sends day-ready for all seats. The vote starts at once and cannot be undone. Here it fired about 3 s after 阿聰 said 「大家冇異議，我就㩒夠鐘投票喇」, with about 2:50 left; 阿聰 and 小美 both flagged it. The rule is that the group decides when the talk is over (research, Procedure step 10), and the thief is the one who gains from a short discussion. U5 already gave undercover's equivalent 開始投票 a second tap. | `ui.js:1139` calls `tableSend({type:'day-ready', on:true})` directly; compare undercover `ui.js:318-322`. | On a whole-table phone use `api.confirm('全枱傾夠未？', readyBtn)` as undercover does. Change the label 「（一下就得）」 and the rules line 「一下就得」 to match. Consider the same for onuw ready-vote (`onuw/ui.js:771`). This extends U5, so it **needs the user's OK**. Effort S. | game: `ui.js`, `game.js` (rules) |
| N3 | minor | tell | No night sound bed: occupied hours can be heard on the phone in the middle | Every hour lasts the same, but each occupied hour makes noise: the phone is picked up, the gate tapped and the phone set down. Empty hours (1, 3, 4 here) are silent. Sleepers learn which hours had someone awake and can catch a false hour claim. In the cardboard game a sleepyhead who wakes only opens their eyes. U8 built the noise bed for exactly this case (onuw #25), but cheese-thief never opted in. | `game.js:35` meta has `eyesClosed` but not `nightAmbient`; only `onuw/game.js:315` sets it. `play.js:1120-1122`. | Add `nightAmbient: true` to the meta and note it in the flow doc §4 'night'. Effort XS. | game: `game.js` |
| N4 | minor | flow | The dawn re-check line is missing from the table screen in the middle | From 5 players up, every seat is reminded to re-peek its card at dawn. On one phone that line exists only on a seat's own screen, behind the chip. The day table screen reads only 「☀️ 日頭討論 / 芝士唔見咗！自由討論。」 plus the timer and button. A 6–8p follower who missed the phone at rec-meet is not prompted. A table that never opens the chip also triggers N1. | `ui.js` buildTable `case 'day'` (about `:1165-1172`). | On a shared phone's day table screen, show the existing line in its one-phone form, the same for everyone: 「🔁 天光喇：大家輪流㩒上面揀名，再睇一次自己張身份牌」. This moves an existing rule line; it adds no tutorial (#19). Effort S. | game: `ui.js` |
| N5 | polish | ux | The co-waker 🤫 row holds nothing new in 5–8p hours | In a 5–8p `open` hour every co-waker's die equals the hour. Their role line is 「冇嘢要做」, or for the thief a line about a theft the shared lines already name, and a 5p pick is on the shared part too. The row still asks 「㩒自己個名（其他人望開）」 inside a 20 s window the wakers share. 阿聰 asked what it held, and 小美 ran out of time. | `ui.js:760` (ownTitle), `:817-827` (paintOwnRow), `:723-747` (coPrivateLines). | Hide the row in 5–8p `open` windows, or label it 「（自己粒骰＝而家個鐘，唔使另外睇）」. Keep it for 4p (different dice, the steal-or-wait choice) and rec-meet (a 7p follower's knowledge). Effort S. | game: `ui.js` |

**N1 in detail:**
- **Mechanism.** The shell walks the phone clockwise from the seat on screen, or failing that from `lastHolder`. lastHolder is set when a night gate lands, survives dawn, and changes by day only when someone picks a seat with the chip. So if the table only talks and then taps 大家夠鐘投票, the first private gate is 「交俾 <last night holder>」.
- **Verified live, 16:17–16:21 UTC.**
  - Dice: p1 5, p2 1, p3 5, p4 3 (the thief), p5 5.
  - 大熊 took the hour-3 gate, and nobody touched the phone after that.
  - At dawn the 天光喇 card was tapped, then 大家夠鐘投票.
  - The first gate read 「交俾 大熊 · 其他人唔好望 · 投票 · 搞掂 0/5」: the thief. An unbiased walk starts at seat 1, 阿聰.
- **In this match.** A normal 5p night leaves the phone with the seat shown at the latest occupied hour, which here was 大熊 (hour 6, the thief). The leak stayed hidden only because 阿聰 opened his 📓 just before the vote.
- **In 6–8p.** The last night gate is rec-meet (or rec-pick), so the named seat is always the thief or a follower. When it fires there, it is blocker-level.

## What worked on one phone

- **Hand-over order and privacy.**
  - The deal gates named the right seat in table order and carried no role.
  - 準備好 and 確定投票 passed the phone straight to the next gate, with no stray 擺返中間 step.
  - The vote gates hid the ballot, and the vote panel excluded self (p3-001.png).
  - The reveal came only after 5/5 votes.
- **Night anti-tell.**
  - The anonymous gate read 「擲到N點嘅請拎起部手機」 at every hour; in the verification game the hour 2/4 decoys looked exactly like the real hour-3 gate.
  - Hours were exactly the same length.
  - The gate-tap 'flip' sound is suppressed while the phone lies in the middle at night (`PassGate.js:57` fires while `nightChrome` → opaque → `sfx.setSuppressed`).
- **Co-wakers (U2).** Each pair at hours 2 and 5 shared one screen naming both wakers and the cheese state. Nobody was walked in turn.
- **Dawn and day.** 天光喇 went to the middle for everyone. The table screen carried the clock and the one-tap vote button. 📓 night logs were correct (「兩點鐘你醒咗。同你一齊醒：阿強。芝士仲喺枱上。」), and 阿聰 used his to expose 大熊's lie.
- **Results.** Votes, the full 🌙 夜晚重溫, every role and die, the scoreboard, and no 「你」 anywhere.
- **Wording.** One-phone lines everywhere.
- **Seats that cannot get the phone.** Nothing waits on one: day-ready counts the whole table, and the vote focus walks every present seat.

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p2 (major) | The game blocked at the vote | The game finished (phase `results`, lastResult above). p2 stopped waiting at about 16:00 while 小美 and 大熊 were slow. AI artifact. |
| p4, p5 (major) | Vote hand-overs took 90 s to 5 min | AI pace. Secret ballots have to go one hand-over at a time, and each gate appeared at once. A person votes in about 10 s. |
| p4 | No auto-advance for a stuck voter | By design: never auto-pass (summary #18, DESIGN §7.1). The host's gate carries 「X 唔喺度？」 (`play.js:530-558`), and 阿聰 saw it. |
| p2 | The 🤫 header said 「淨係 小美 睇」 after 阿明's tap | `ui.js:867` names the open panel (`openSeat`). 小美 had opened her own panel on the shared screen, and the referee showed it to 阿明 too (tooling T3). In 5–8p co-wakers share the same die, so nothing leaked. |
| p2 | Awkward 「同一步醒緊：你哋一齊睇同一個畫面」 | That is the referee's line (`pt.mjs:229`), not the app's. |
| p2 | A 10 s per-player window during the deal | The roll has no timer: focus waits for each 準備好 (`game.js:430-433`). The 20 s is the night hour. |
| p1, p3, p5 | The 💡 sheet (and 📖, ⏱️) opened by itself | The app never opens 💡 (`play.js:176-183`, `hints.js:2-3`). PassGate closes on `click`, so there is no click-through (`PassGate.js:56-61`). The sheets that opened were controls [1]–[3] of the table screen ([1] = 計時 on results), which fits stale numbered taps after another seat had already dismissed the card (tooling T1). |
| p1 | Sheets left open over the phone in the middle | Same cause. The shell also closes 💡 whenever the phone changes hands (`play.js:439`, `:490`). |
| p1 | The night log might stay 「芝士仲喺枱上」 after a same-hour theft | In 5–8p the theft happens as the window opens, before the notes are written (`game.js:671-682`). A 4p late steal rewrites the co-wakers' notes (`game.js:705-711`). |
| p3 | The window starts at the call, not at pickup | By design (U6 pad). A pickup-timed window would make step length depend on whether anyone woke, which is a tell (p3 agrees). A person fits well inside 20 s. |
| p1 | The hour window is too tight for the console | AI latency. The console already prints 「仲有 N 秒」. |
| p3 | Two taps to give the phone back, four steps to see your own screen | By design: U4 (the table card is tapped once) and the §7.1 hand-picked path. |
| p4 | Thief alone, so no follower | Correct for 5p (research, Night order). |
| p4 | The bluff about 阿強 rolling 6 was easy to expose | Deduction working as intended. |
| p4 | Hand-overs feel sluggish | AI pace. The gates appear at once. |
| p5 | A shell command leaked into table chat | 小美's own `say` text contained 「；node tools/playtest/pt.mjs wait …」 (16:04:19Z). AI quoting error (tooling T4). |

## AI artifacts (kept out of the findings)

- The console took about 5 s per call. That ate the 20 s co-wake windows (小美 went from 「仲有 15 秒」 to 「仲有 5 秒」 in two calls). A person taps the gate and reads three lines well inside the window.
- During the vote, 小美 held the phone about 4 min and 大熊 took about 5 min to pick it up. p2 gave up and reported a block that never happened.
- p5's report has the wrong order (「after 阿聰 and 阿明 finished their hours」), and its checklist marks every right `couldUse: false` while its notes say 「Fully honored」. These are misuses of the report fields.
- Durations in the timelines are LLM estimates. The narration timestamps are the ground truth.

## Tooling notes (`tools/playtest/pt.mjs`)

1. **T1: stale numbered taps.** `resolve` (`:682-689`) re-runs `see` and silently re-maps `tap N` onto the new screen. When another seat has just dismissed a card, `tap 1` lands on 💡, `tap 2` on 📖, and `tap 3` on ⏱️ (or [1] 計時 on results). That is the "hint sheet opened by itself" seen three times.
   - Fix: remember each seat's last printed control labels. Refuse a numbered tap whose label has changed, with 「畫面變咗（可能有人㩒咗）」 plus the new screen.
   - Also: concurrent `see` calls from several seats rewrite the same `data-pt` numbering in the one shared page, so serialise `see` and `tap` per phone.
2. **T2: "no control matching" after someone else acted.** It should say so: 「張卡／個掣已經畀人㩒咗 — 畫面已經變咗」 (阿聰's 開始 ▶, 天光喇, 大家睇緊; 小美's 夠鐘投票).
3. **T3: co-waker private panels.** At night the referee shows the whole shared screen to every co-waker, including another seat's open 「🤫 淨係 X 睇」 panel.
   - Fix: when `.ct-co-priv` is visible, show it only to X. The others get 「X 睇緊自己嘅嘢 — 望開」.
   - Optionally the app could add a non-visual `data-owner` attribute on the panel, so the referee does not need to parse the title.
4. **T4: `say` hygiene.** Reject or trim `say` text that contains `node tools/playtest` or `pt.mjs` (AI quoting slip at 16:04:19Z).
5. **T5: settle before printing.** `tap` prints 450 ms after the click, before a sheet's open animation ends (小美's 「邊個要睇自己？」 picker showed only on the next `see`). Wait for running animations or transitions to finish, up to about 800 ms.
6. **Still open from run 1 (note 5).** After a window closes, the refusal 「(你唔可以掂部手機)」 (`:869`) should add 「（你個鐘已經完咗 — 部手機擺返中間）」 when the refused seat was called in the step that just ended.

## Verification game

Run after all facts above were collected; it adds a second entry to `history`. It was driven on the same phone with `eval`:
- `再玩一局`, then the 5 deal gates in seat order.
- At night only the hour-3 gate was taken (by the thief 大熊).
- At dawn the 天光喇 card, then one tap on 大家夠鐘投票. The vote started at once, and its first gate was 「交俾 大熊」 (N1).

It also confirmed that:
- hours 2 and 4 showed the same anonymous gate as hour 3;
- the dawn chip read 「📱 枱中間 — 㩒你個名睇自己」;
- one table tap starts the vote (N2).

## Stopped

`node tools/playtest/pt.mjs stop sp2-cheese-thief` → `stopping`. No code was edited. Per the subagent rule against writing report files, this report was not written to `docs/playtest/single/cheese-thief-rerun.md`; the orchestrator writes it.
