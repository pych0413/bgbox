# 一夜終極狼人 (`onuw`) — multi-agent playtest review

Session `mp-onuw`, room 2442, 2026-10-03 18:43–18:53 UTC. Five AI players each drove one headless phone window (390×844). The build was deployed at `https://pych0413.github.io/bgbox/` (build `20261003171423`). Its `js/games/onuw/{game,ui,script}.js`, `style.css`, `js/ui/screens/play.js` and `css/base.css` match local `a72d23e` byte for byte once the `?v=` stamps are normalised.

Settings: 5 players, preset `auto` (the official 5-player set: 2 狼人, 預言家, 強盜, 搗蛋鬼, 3 村民 — 8 cards), `loneWolf` on, `ringVote` on, `discussSec` 0 (5:00), pace **slow** (×1.5, set by the orchestrator; the default is `standard`), narration **靜音 (silent)**. Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強.

Sources checked:
- Rules: `docs/research/onuw.md` (its "## Verification" section takes precedence). Flow: `docs/games/onuw.md`.
- Code: `js/games/onuw/{game,ui,script}.js`, `style.css`; `js/ui/screens/play.js`, `js/ui/shell.js`, `js/ui/components/Cover.js`, `css/base.css`, `js/core/room.js`.
- Evidence: the engine state on the host (`session.state`: `log`, `notes`, `moves`, `votes`), `room.lastResult`, `room.history`, the table chat (`pt hear`), and the 12 screenshots.

`node tests/run.mjs onuw` gave 88 passed and 0 failed.

## Verdict

**The game finished, and the rules engine was right for the path that was played.** Both werewolves were in the centre (centre: 村民, 狼人, 狼人). 小美 (Seer) looked at 阿明 (村民). 阿聰 (Robber) robbed 小美 and got 預言家. 阿強 (Troublemaker) let the window lapse. The table voted out 大熊 (a 村民) 4 to 1. No player held a werewolf and someone died, so nobody won. That is win-matrix row 10 of the verified rules. Steps were called only for roles in the set, and the werewolf step still ran with nobody awake.

**No blocker.** The one blocker reported (p5: "the Troublemaker action screen never appeared") is an AI artifact. The engine log shows p5 awake at the 搗蛋鬼 step with the swap ability open for the whole 15 s window. The window then lapsed (`idle`).

**Three majors are confirmed:**
1. **Anti-tell.** The phone of whoever is awake lights up at full brightness. Every other phone sits under a 95 % black layer. The awake screen also looks different: purple border, live chips, a purple confirm button and a visible result cover. In 靜音 mode the app tells everyone to keep their eyes open and watch their own phone, so the neighbours can see who is awake. Reported by p3.
2. **Night results vanish.** A result is readable only until the step's window ends. A player who confirms late gets almost no time to hold the cover, and nothing says the result is saved for the day. p1 (Robber) and p3 (Seer) both lost their live result. AI latency made it worse, but a human who hesitates in the default 10 s Robber window hits it too.
3. **Doppelgänger copy in clear text.** The copied role (「你而家係 🐺 狼人…」) is printed in plain text outside the cover. Found in code. There was no Doppelgänger in this game.

**Not exercised live:** Doppelgänger, Minion, Masons, Drunk, Insomniac, Hunter, Tanner, the lone-wolf peek, the Seer's two-centre-card option, a Robber or Troublemaker swap that changes a team, the ring vote, and ties. The engine and UI unit tests cover them (the research vectors V1–V15, win-matrix rows 1–18, fuzz, UI per ability).

## Did it finish?

Yes. `room.phase = 'results'`. `lastResult.summary = 「冇人贏 — 場上冇狼人但有人死」`, with 0 points for everyone. `history` has one entry.

| fact | value |
|---|---|
| deal | 阿聰 強盜 · 阿明 村民 · 小美 預言家 · 大熊 村民 · 阿強 搗蛋鬼; centre 村民, 狼人, 狼人 |
| steps | `begin` · `werewolf` (awake: nobody) · `seer` (p3) · `robber` (p1) · `troublemaker` (p5) · `dawn` |
| night log | 小美 looked at 阿明 → 村民 · 阿聰 robbed 小美 → got 預言家 · 阿強 `idle` (lapsed) |
| final cards | 阿聰 預言家 · 阿明 村民 · 小美 強盜 · 大熊 村民 · 阿強 搗蛋鬼 |
| timeline | ready 18:43:18–30 · day from ≈18:46:50 · all five 夠鐘投票 ≈18:49:30 · last vote 18:50:24 · reveal waited 3 min (nobody tapped 睇完整個結果) → over 18:53:24 |
| votes | 阿聰→大熊 · 阿明→大熊 · 小美→大熊 · 大熊→阿聰 · 阿強→大熊 (大熊 4, 阿聰 1) |
| result | 大熊 died (村民). No werewolf among the players → 好人輸. No Minion or Tanner → 冇人贏 (row 10) |

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | major | tell | The awake phone lights up, and its screen looks different from a sleeper's | The shell dims every seat that is not in `focus` with a 95 % black layer. `focus.pids` is exactly the awake seats, so only the actor's phone fades up to full brightness when the window opens, and fades back at the end. On top of that, the onuw screen differs at a glance. The awake seat has a purple panel border and full-opacity purple-edged chips. Sleepers get chips at 50 % opacity. When a pick is pending, the big button turns into a purple gradient. The result cover (yellow stripes) is visible only for a seat with a result, and is `visibility:hidden` for everyone else. Tap count differs too: the actor picks, confirms and holds, while a sleeper taps once (or not at all, since nothing checks it). The research's anti-tell asks for "an equal-shaped decoy (fake pick-a-card with the same tap count and duration)" and to "keep brightness low", because "screen glow" is a leak even with eyes closed. In 靜音 mode the app's own footer says 「唔使閉眼，望住自己部機 — 輪到你嗰陣佢會自動亮起」. Players are told to keep their eyes open, and the one bright phone at the table names the role being called. The flow doc §3.8 lists this as an "honest limit", but it breaks the verified anti-tell rules. Reported by p3. p4 and p5 praised the anti-tell, but they only saw their own screen. | `js/ui/screens/play.js:539-540` (`night(… && !inFocus)`: only non-focus seats are dimmed); `css/base.css:1177-1183` (`.night-dim` 95 %); `js/games/onuw/ui.js:317` (`is-awake`), `:328` (cover visible only with a result), `:343-348` (chips live only for the chooser), `:354` (`is-action`); `js/games/onuw/style.css:76,84,102-104,118`; `js/games/onuw/script.js:767,779` (「自動亮起」) | (a) Shell: add an opt-in game meta flag (for example `meta.nightDim: 'uniform'`). For such a game, keep every seat, the awake ones included, under the same partial dim for the whole night, with readable content and no fade at window edges. (b) onuw: give every seat the same screen. Sleepers get live-looking chips and a fake pick → confirm, which shows 「💤 今輪冇嘢睇」 behind the same cover. Keep the cover visible for every seat. Drop the `is-awake`, `is-action` and `live` colour differences, or make them equally faint. (c) Rewrite `helpSilent` (no 「自動亮起」), and update `docs/games/onuw.md` §3.2 / §3.8. | `js/ui/screens/play.js`, `css/base.css`, `js/games/onuw/{ui.js,style.css,script.js}`, `docs/games/onuw.md` |
| 2 | major | ux | A night result disappears when its step ends, and nobody is told it is saved | `nightFor` sends `info` only while the stage is `window` and only notes with `ix === s.ix`. When the window closes, the cue screen 「聽住報…」 replaces it and the result is gone until the day's 📓 log. The window starts when the step does, not when you act. A seat that confirms at second 8 of a 10 s Robber window (the default `standard` pace) gets about 2 s to find and hold the cover. The 「✓ 搞掂」 line does not say the result will be in 📓 later. p3 (Seer) held the cover and saw the 強盜 cue instead. p1 (Robber) held it and saw the 搗蛋鬼 cue. Both recovered the result only in the day. AI latency (three tool calls for pick, confirm and hold) made it worse, but a slow human hits it too. The information is not lost, because the day log has it. The window lengths themselves follow the research (10 s base, 12 s Seer), and they must stay fixed and independent of the deal. | `js/games/onuw/game.js:1102-1108` (`info` filtered to the current step and window); `:342-350` (fixed windows); `js/games/onuw/script.js:780` (done line) | Keep the seat's own night notes so far peekable for the rest of the night. Every seat gets the same 📓 cover on the night screen, and sleepers get 「今晚未見過嘢」 behind it, so the cover tells nobody anything. This needs fix #1 so the cover is not under a 95 % dim. Add 「天光之後 📓 夜晚記錄都睇到」 to the done line. Optionally show the seconds left beside the bar. | `js/games/onuw/{game.js,ui.js,script.js}` |
| 3 | major | tell | The Doppelgänger's copied role is printed in clear text on her night screen | Everything a seat learns at night is meant to sit behind the hold-to-peek cover (flow doc §3.8), so that a neighbour with open eyes in 靜音 mode cannot read it. But `awakeLines` writes the copied role into the plain instruction lines: 「你而家係 🔮 預言家，即刻用佢嘅能力：…」, 「你複製咗 🐺 狼人。到「狼人」嗰一輪你會再醒…」, 「你複製咗 🏹 獵人，呢個角色夜晚冇行動…」. Combined with #1, the phone is also the only bright one at the 化身幽靈 step. The copied role (for example Werewolf) is a hidden team change, so a glance gives it away. The copied ability's instructions also name it (Seer, Robber, Troublemaker, Drunk), and the chips that become live hint at it (players and centre, players only, or centre only). Not exercised in this game, since the 5-player set has no Doppelgänger. It applies to the `advanced` preset and custom sets. | `js/games/onuw/script.js:686-690` (`awakeLines` for `doppelganger`), `:777-779` (`doppelDo`, `noAction`, `later`); `js/games/onuw/ui.js:319-324` (lines rendered as plain text) | Keep the plain line neutral: 「你複製咗一個角色 — 㩒住下面睇係乜、要做乜」. Put the copied role and the copied ability's instructions in the cover front, next to the copy note. Once #1 is fixed, every seat at that step looks the same, so the live chips stop telling. | `js/games/onuw/{script.js,ui.js}` |
| 4 | minor | tell | The table screen's 「已㩒掣 n / m」 shows whether anyone is awake | `markDone` counts an action as an ack, and nothing makes a sleeper tap the decoy. p3 said she did not tap while asleep, and nothing happened. So the count shows the awake seats. At this table, the werewolf step (both wolves in the centre) would read 0 / 5 and the Seer step 1 / 5. Anyone watching a seatless table screen (a tablet in the middle or a spectator phone) learns that no player holds a werewolf. `acks` is also in every seat's view data, though the seat UI does not draw it. | `js/games/onuw/game.js:583` (`markDone` pushes to `acked`), `:1154` (`v.acks` in every view); `js/games/onuw/ui.js:611`; `js/games/onuw/script.js:794` | Drop the night counter from the table screen, or show it only in the cue stage. Leave `acks` out of seat views. If a decoy counter is wanted, count only explicit `ack` taps, never actions. Update §3.8 「No names in counters」. | `js/games/onuw/{game.js,ui.js,script.js}`, `docs/games/onuw.md` |
| 5 | polish | text | 「你見到嘅嘢喺上面」 points the wrong way | After acting, the panel says 「✓ 搞掂。你見到嘅嘢喺上面，㩒住睇。」, but the result cover sits **below** that line (`panel = lines, peekWrap`). This cost p1 and p3 a moment while the window was running out. | `js/games/onuw/script.js:780`; `js/games/onuw/ui.js:228` | 「✓ 搞掂。㩒住下面個格睇你見到乜。」 (with the 📓 note from #2). | `js/games/onuw/script.js` |
| 6 | polish | text | Optional abilities do not say what happens if you do nothing | The Seer prompt says 「唔想睇就唔使理，時間到自動跳過」. The Robber, Troublemaker and lone-wolf prompts stop at 「唔想換就唔使理」. p1 could not tell whether doing nothing was a decline, and p5 thought no choice had been offered. The two-tap "not confirmed = declined" design is right (§7), and the rules make all three optional. | `js/games/onuw/script.js:773,774,776` | Add 「時間到就當你唔換／唔睇」 to all three, matching line 772. No extra skip button is needed. | `js/games/onuw/script.js` |
| 7 | polish | text | ✅ / ❌ on the reveal cards have no words | On a 冇人贏 screen every card shows a red ❌, including the dead player's (☠️ ❌). p1 was unsure what it meant. The text results already say 「好人隊 ❌輸」. | `js/games/onuw/ui.js:527` | Render 「✅ 贏」 / 「❌ 輸」, matching `cardLines`. | `js/games/onuw/ui.js` |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p5 (blocker) | The Troublemaker action screen never appeared; no choice was offered | **AI artifact.** The engine log has `{step:'troublemaker', k:'step', awake:['p5']}`. `resolveWindow` writes the `idle` note only for a seat whose ability was still open at the deadline (`game.js:673-689`), so the swap was offered for the full 15 s window (10 s × slow). The p5 AI was between tool calls while the window ran. A human watching the phone sees the chips light up. The timing concern is covered by #2. |
| p5 (minor) | Unclear whether the ability timed out or was never offered | Same root. 「冇用能力」 is the documented lapse of an optional ability (flow doc §3.8 "Lapses are silent too"). The prompt wording is #6. |
| p4 (major) | Night steps incomplete: no Minion, Mason, Drunk or Insomniac step | **App is right.** Verified Night order: "a step is called whenever its role card is in the card set, even when that card is in the centre". The official 5-player set has none of those cards. `buildSteps` (`game.js:354-365`) built `werewolf, seer, robber, troublemaker`, and the werewolf step ran with nobody awake. |
| p4 (minor) | The results screen is long | By design (§3.6). Each block is a section, and the night recap is collapsed. |
| p4 (minor) | Tell Villagers to claim early | Strategy advice, not a defect. The rules let anyone say anything. The 💡 day hint covers the basics. |
| p2 (polish) | 「㩒住先睇到，放手即刻冚返」 is awkward | It is natural Hong Kong Cantonese ("you only see it while holding; let go and it covers again"). |
| p2 (minor) | The night-log section is not shown as expandable | The `<details>` marker is there: shot p4-001 shows 「▼ 夜晚記錄（邊個做咗乜）」. The 「▸」 bullets on the step lines inside could look like toggles. A different glyph (「・」) would avoid that. Optional. |
| p1 (polish) | 🗑️ 呢輪作廢 sits next to ⏭ 下一步 with no confirm | It has a confirm with an explanation: `sh.confirm('呢輪作廢、重新嚟過？\n（有人部手機死咗、或者搞錯咗先用）')` (`js/ui/screens/play.js:111`). p1 did not tap it. |
| p1 (minor) | No night log during the night | Merged into #2. |
| p3 (minor) | 「每一輪都㩒」 contradicts 「唔想睇就唔使理」 | **Misread.** 「唔想睇就唔使理」 is about the ability. The big button still sends the decoy `ack` when nothing is selected (`ui.js:302-305`). The real gaps are that the decoy is unenforced and has a different tap count (#1), and that the counter leaks (#4). |
| p3 (minor) | Pick, confirm and peek are too many steps; the log cannot tell a decline from a timeout | Two-tap commit is deliberate (§7: a half-pick is never sent). Under the rules a lapsed optional ability is a decline, and the note is private to the owner. The time pressure is #2. |
| p3 (polish) | The day log needs a hold | Reported as working well. Hold-to-read is the right pattern for a secret. |

## AI-artifact notes (only an AI's speed or tooling would hit these)

- **Tool latency inside fixed windows.** Pick, confirm and hold were three separate CLI calls, each several seconds of model time. p3 spent most of the 18 s Seer window this way, and p1 most of the 15 s Robber window. p5 missed the 15 s Troublemaker window entirely. A human taps in about a second each. The real, human-scale part is kept as #2.
- **`hold` printed the next step.** `pt hold` shows the screen while held. By the time the hold landed, the cue stage of the next step had replaced the screen. That is why p1 and p3 quote 「強盜／搗蛋鬼 聽住報…」 as their "result".
- **Own-screen view of anti-tell.** Each AI saw only its own phone, so p4 and p5 called the anti-tell "excellent". Only p3 noticed from the console's `[overlay] night-dim` line that the overlay is lifted for the actor (#1).
- **Inaccurate timestamps in reports.** p2 put the vote at 18:48. The engine shows the last vote at 18:50:24 and the reveal timing out at 18:53:24 UTC.

## Rights checklists, merged per role

**🗡️ 強盜 (Robber)**: p1 阿聰

| right (verified rules) | result | evidence |
|---|---|---|
| Woken by dealt role at step 6, after the Seer and before the Troublemaker | ✓ | steps `seer` → `robber` → `troublemaker`. 聽住報 first, then 你醒咗 |
| Swap with one other player; never the centre, never himself | ✓ | 4 player chips live, centre disabled, self not listed |
| May decline | ✓ by design (do not confirm) | wording is unclear (#6) |
| Look at the new card | partly (#2) | the window closed before the hold; 📓 in the day: 「你同 小美 換咗牌，換到 預言家」 |
| Does not perform the stolen card's action | ✓ | no Seer action offered |
| Victim is not told | ✓ | 小美's notes have only her own Seer look |
| Day reminder of dealt role and night info, no current-card peek | ✓ | 📓 cover, warning line, no "my card" anywhere |

**🔮 預言家 (Seer)**: p3 小美

| right (verified rules) | result | evidence |
|---|---|---|
| Look at one other player's card, OR two centre cards, never both | ✓ (player option used) | `look-player` 阿明 → 村民. Centre pair not exercised; covered by tests |
| Cannot look at herself | ✓ | own name not listed |
| May decline | ✓ | 「唔想睇就唔使理，時間到自動跳過」 |
| Sees the faces as they are at step 5 | ✓ | 阿明 村民, before the Robber |
| Read the result privately | partly (#2) | the live result was lost to the window end; recovered from 📓 |
| Nobody else can tell she is awake | ✗ (#1) | her phone alone undimmed, with live chips and a purple panel |

**🌪️ 搗蛋鬼 (Troublemaker)**: p5 阿強

| right (verified rules) | result | evidence |
|---|---|---|
| Swap two other players' cards, unseen; not himself, not the centre | offered, not used (AI missed the window) | log `awake:['p5']`, then `idle`. Mode `pair` with a third pick dropping the oldest (`ui.js:254-255`) |
| May decline | ✓ (lapsed = declined) | 「阿強（搗蛋鬼） 冇用能力」 |
| Works on positions after the Robber | not exercised | covered by tests |
| Day reminder | ✓ | 📓 showed dealt 搗蛋鬼 and the lapse |

**🧑‍🌾 村民 (Villager)**: p2 阿明, p4 大熊

| right (verified rules) | result | evidence |
|---|---|---|
| Peek at the dealt card once, hold-to-peek | ✓ | p2, p4. Cover closes on release; 🔓 lock available |
| Public role list with counts | ✓ | 今局角色 chips (狼人 ×2 … 村民 ×3) |
| Same screens as an actor every step (decoy) | ✗ (#1) | dim layer, greyed chips, hidden cover; the actor's phone looks different |
| No card re-peek in the day | ✓ | only 📓 with 「你夜晚冇醒過，咩都冇見到」 |

**Everyone (day, vote, reveal)**

| right (verified rules) | result | evidence |
|---|---|---|
| Free discussion with a timer (5 min for 5), host +60 s | ✓ | 5:00, +60 秒 on the host only |
| Early vote when all agree, counts without names | ✓ | 想投票 n / 5, vote started at 5 / 5 |
| Vote one OTHER player; no self, no centre, no abstain; secret until all are in | ✓ | 4 candidates each, 確定 / 改票, 已投 n / 5 |
| Ring vote by unanimous agreement | offered, not used | ⭕ 我同意圈票 0 / 5 |
| Most votes die, ties all die, max ≤ 1 nobody | ✓ (single death) | 大熊 4 → dead |
| Win by final card per player | ✓ | row 10: no werewolf among the players and someone died → nobody wins |
| Full reveal: votes, who voted whom, dead card, every final card, centre, why, night recap | ✓ | reveal and results screens (shots p2-002, p4-001) |

**👑 房主 (host, also a player)**: p1 阿聰

| right / duty | result | evidence |
|---|---|---|
| Recommended set and reason pre-filled | ✓ | official 5-player set |
| ⋯ menu: pause, 下一步, 呢輪作廢 (with confirm), timer, connection per seat | ✓ | shot p1-002, `play.js:111` |
| No secret panel for a playing host | ✓ | host view shows only its own seat |
| Stall flags never name an awake seat at night | ✓ | `blocking` false at night (`game.js:1084-1090`) |

**Roles not in this set** (化身幽靈, 爪牙, 守夜人, 酒鬼, 失眠者, 獵人, 皮匠): not exercised. The engine tests cover them (88 passed). The code review found #3 for the Doppelgänger.
