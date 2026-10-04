# 假畫家 (`fake-artist`) — multi-agent playtest review

Session `mp-fake-artist`, room 5144, 2026-10-03 19:42–19:55 UTC. Five AI players (haiku and sonnet) each drove one headless phone window (390×844). The build was the deployed `https://pych0413.github.io/bgbox/`. Its `js/games/fake-artist/{game,ui,script}.js`, `style.css`, `js/ui/components/VotePanel.js`, `js/ui/screens/{play,results}.js` and `css/base.css` hash-match local `a72d23e` once the `?v=` stamps are normalised. Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強.

Settings: 5 players, 📱 phone canvas, 手機出題 (app is the question master, so all 5 draw), 2 laps (10 strokes), tie rule `must-guess`, spoken guess, `points` scoring, `endMode: rounds`, `rounds: 2`, `antiStreak: false`, no stroke clock, all drawable categories, narration 靜音 (silent).

Sources checked:
- Rules and flow: `docs/research/fake-artist.md` (its "## Verification" section takes precedence) and `docs/games/fake-artist.md`.
- Code: `js/games/fake-artist/{game,ui,script}.js` and `style.css`, `js/ui/components/VotePanel.js`, `js/ui/{hints,logic}.js`, `js/ui/screens/{play,lobby,results}.js`, `css/base.css`, `js/core/{room,session}.js`.
- Evidence: `room.lastResult`, `room.history`, the table chat log (`pt hear`), the 39 screenshots, and a final `see` of every seat.

`node tests/run.mjs fake-artist` gave 81 passed and 0 failed.

## Verdict

**The game finished, and the rules engine was right for the path that was played.** Both rounds ended the same way. The top vote was a 2–2 tie between two real artists (阿明 and 大熊), and the fake was not among the most-pointed. Under every tie rule that means "not caught", so the fake scored +2 each time (`must-guess`: "If `top` does not contain F: the fake artist is not caught under every `tieRule`"). The final result was 小美 and 阿強 as joint winners on 2 points. The deal, hold-to-peek, ack count, turn order, one stroke per turn, two laps, distinct pens, hidden ballots, simultaneous reveal and the result explanation all worked as specified.

**No blocker.** The only blocker that was reported (p2: "the tie rule is wrong") is a misread. The fake had 0 votes in both rounds.

**One major issue, which no player reported (found in code).** With a spoken guess, which is the default, the judge's phone shows the title in 36 px text with no cover as soon as the fake is caught. In app-QM mode the judge is the host seat, and that phone often sits in the middle of the table for narration. That is the one moment the fake is looking hardest for a clue. Everywhere else, this game hides the title behind hold-to-peek.

**Not exercised live:** the caught-fake path (guess, judge, 啱/錯, artists +1), `escape` and `revote` ties, player-QM mode (出題者 typing, picking the first drawer), paper mode, the stroke clock, and 呢輪作廢. The unit tests cover all of these (`spoken guess…`, `typed guess…`, `tie rule must-guess/escape/revote — every possible ballot…`, `revote…`, `player QM…`, `paper mode…`, `host 呢鋪唔計…`, and the UI fake-DOM test). A future table should force a caught fake, for example by agreeing votes over the chat.

## Did it finish?

Yes. `room.phase = 'results'`, and all five seats show 「🎨 假畫家 — 贏家 · 小美、阿強 同分奪冠，各 2 分」. `history` has one entry.

| fact | round 1 | round 2 |
|---|---|---|
| theme / title | 交通工具 / 火車 | 甜品 / 棉花糖 |
| fake | 小美 (p3) | 阿強 (p5) |
| drawing order | 小美 → 大熊 → 阿強 → 阿聰 → 阿明 (the fake drew first, by random draw) | 阿聰 → 阿明 → 小美 → 大熊 → 阿強 |
| votes | 阿明 2, 大熊 2, 阿強 1, 小美 0 | 阿明 2, 大熊 2, 小美 1, 阿強 0 |
| verdict | fake not in the top → escaped, 小美 +2 | fake not in the top → escaped, 阿強 +2 |
| result lines | 「第 1/2 輪 「火車」（交通工具）· 假畫家：小美 — 假畫家逃脫 · 小美 +2」 / 「↳ 投票：阿明 2、大熊 2、阿強 1 → 最高票唔係假畫家」 | 「第 2/2 輪 「棉花糖」（甜品）· 假畫家：阿強 — 假畫家逃脫 · 阿強 +2」 / 「↳ 投票：阿明 2、大熊 2、小美 1 → 最高票唔係假畫家」 |
| points | `lastResult.points` = p3 2, p5 2, others 0 | |

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | major | secret-at-a-glance | The judge's phone shows the title openly while the caught fake is still thinking | Spoken guess (the default): as soon as the tally names the fake, the judge's screen shows 「答案係」 and the title in 2.25 rem bold (`.fk-judge-word`), with no cover. It stays there for as long as the fake takes to answer. In app-QM mode the judge is the host seat (`pickJudge`), and with narration on, the host phone is usually the one left in the middle of the table. The research says "The guess must be locked before the title is displayed anywhere" and asks for hold-to-reveal against shoulder-surfing. The game does that for every other private screen (deal card, re-peek, 💡 role). Here the fake can win the round by glancing at one phone. No player reached this phase, so it was found in code. The engine side is correct: `guess.word` goes only to the judge. | `js/games/fake-artist/ui.js:643-681` (judge panel; the word is set uncovered at `:674-678`); `game.js:1125-1131` (`canJudge` in spoken `guess`, the word goes to the judge immediately) | Put the answer behind the same hold-to-peek `Cover` the card uses (「㩒住睇答案」, close on release), and keep ✅ 啱 / ❌ 錯 outside it. The judge is a real artist or the QM, so they already know the word, and the peek is only for synonyms. In typed mode the word can stay visible in `judge`, because the guess is already locked there. | `js/games/fake-artist/ui.js`, `style.css` |
| 2 | minor | ux | The picture shrinks to 240 px on the vote and guess screens, with no way to enlarge it | While drawing, the canvas is about 340 px. On the vote screen it is `compact` (`--c-chrome: 38rem`, so `max(15rem, 100dvh − 38rem)` = the 240 px floor on any phone up to 848 px tall). This is exactly when everyone has to match small strokes to people. The tiny purple box in R1 and the leaf strokes in R2 were hard to read (p1-005, p2-005). The caught fake's guess screen uses the same compact board, so the fake also loses detail when guessing. Reported by p1 and p3. | `js/games/fake-artist/style.css:87`; `ui.js:538` (vote board `compact: true`), `ui.js:624` (guess board) | Keep the full-size board on the vote screen and make the ballot denser (two-column name chips instead of full-width rows), or add tap-to-enlarge (a full-screen view-only Canvas). Reuse the result screen's legend highlight (tap a name, everyone else's strokes dim) on the vote screen. | `js/games/fake-artist/ui.js`, `style.css` |
| 3 | minor | ux | Ballot and tally colour dots are lobby colours, not the pen colours on the canvas | `VotePanel` paints each dot from `player.color` (the lobby colour). The fake-artist UI passes `api.players` unchanged, so 大熊 is coral in the list but red on the canvas, 阿明 is light green against a dark green pen, and 阿聰 is bright yellow against dark gold (p1-005, p3-006). The research says a stroke's colour is how players know who drew it, and that matching happens at the vote. The order chips, score strip and result legend already use `view.pens`. The shell's final winner chips (阿強 in lavender) have the same mismatch. Reported by p1 and p3. | `js/ui/components/VotePanel.js:43-45`; `js/games/fake-artist/ui.js:561` (vote) and `:603` (tally) pass `players: api.players` | Pass `api.players.map((p) => ({ ...p, color: pen(p.id) }))` to both VotePanels. Optionally let `VotePanel` take a `colorOf(pid)` prop, as `Canvas` does. | `js/games/fake-artist/ui.js` (and optionally `js/ui/components/VotePanel.js`) |
| 4 | minor | flow | Who voted for whom is on screen for only 4.5 s; the result keeps only the counts | The tally (the simultaneous reveal with voter chips under each bar) moves on by itself after `TALLY_MS` = 4.5 s. The result screen and the final recap then show only counts (「投票：阿明 2 票、大熊 2 票、阿強 1 票」). The accuse-and-defend talk ("you voted 阿明, why?") is the fun part. In physical play the fingers stay pointed while people argue, but here that information is gone after 4.5 s. p3 saw the reveal once and missed it entirely in R2. The reveal object already holds the ballots (`rv.round1.votes`). Reported by p3, and p2 found the brief reveal hard to parse. | `js/games/fake-artist/game.js:26` (`TALLY_MS`); `script.js:143-147,161` (`voteLine` = counts only); `ui.js:800` (result renders `rv.lines` only) | Add one line to `revealLines`: 「邊個投邊個：阿聰→阿明、小美→阿明、阿明→大熊…」, or render a static VotePanel `reveal` on the result screen under the picture. Consider 6–8 s for the tally, or advancing it on the host's 下一步. | `js/games/fake-artist/script.js`, `ui.js`, `game.js` |
| 5 | minor | flow | Any seat's 下一輪 / 睇總結 ends the result screen for everyone, without notice | Any artist can tap 下一輪 (by design, spec §3.7). One tap moves all five phones on, with no toast or countdown. p1 was still reading and talking when R2 began. p3 tried to tap 下一輪 and it was already gone. On the last round 睇總結 is disabled for 2.5 s (anti-stray-tap lock) with no explanation, and then someone else's tap jumped every phone to the summary. A slow human reader, or someone in the middle of ▶ 重播, hits this the same way. | `js/games/fake-artist/game.js:995-997` (`next` from any artist); `ui.js:718,728,760,809-812` (button on every seat, silent 2.5 s lock) | Either count 「睇完 n/5」 and advance when everyone has tapped (host can force it from 下一步), or keep any-seat advance but show 「阿明 㩒咗下一輪」 as a toast, plus a 3 s 「準備緊下一輪…」 bar the others can see. Show the 2.5 s lock as a fill on the button. | `js/games/fake-artist/game.js`, `ui.js` |
| 6 | minor | ux | A vote tap can be silently lost when another ballot arrives during the press | Each progress change (「已投 3/5」→「4/5」) changes the panel key, so `VotePanel.update` runs `paint()`, which replaces every button. If another player's ballot lands between press and release, the release happens on a new node, no `click` fires, and the local pick (`pending`) survives. The screen still says 「確定投俾 阿明」 with no lock and no error. This matches p3's R1 report exactly: the first tap on 確定 did nothing while the counter went from 3/5 to 4/5, and the second tap locked. At a 3-2-1 vote, ballots arrive in the same few seconds, so a human ~100 ms tap can hit this too. The same shell component is used by other games. | `js/ui/components/VotePanel.js:164-166,171-183` (full repaint on every update); `js/games/fake-artist/ui.js:567-568` (key includes `progress`) | In `VotePanel`, update the progress text and pips in place, and rebuild the rows and button only when `candidates`, `myVote`, `pending` or `reveal` change. Alternatively, act on `pointerup` with a check against `pending` instead of relying on `click`. | `js/ui/components/VotePanel.js` |
| 7 | minor | text | Scoring text names a 出題者 who does not exist in app-QM mode; narration says 「阿強各得 2 分」 | `rules.quick` line 6 「假畫家同出題者贏各 +2；真畫家贏每人 +1。」 and the 計分 help 「舊版盒有分：假畫家同出題者贏各 +2…」 are fixed text, so they appear with 手機出題 too. In that mode only the fake scored +2 (correct per the research's app-QM adaptation). The result cue says 「阿強各得 2 分。」 (各 = "each", but there is one person; shown in the host's narrator bar, p1-009). Reported by p1. | `js/games/fake-artist/game.js:191` (`rules.quick`), `:424` (`fields` 計分 help ignores `m.qm`); `script.js:88` (`各得` without a QM) | Quick rule: 「假畫家贏 +2（有出題者，佢都 +2）；真畫家贏每人 +1。」. Make the help text depend on `m.qm`. In `pointsSpoken`, use `rv.qm ? '各得 2 分' : '得 2 分'`. | `js/games/fake-artist/game.js`, `script.js` |
| 8 | polish | ux | The header 輪到你 badge is clipped off for the drawer, and reads as "your drawing turn" during the deal and vote | The shell appends the badge after `view.subtitle` in a single-line `small` with `nowrap` + ellipsis. During `draw` the subtitle is 「主題：交通工具 · 第 1/2 圈」, which already fills the line on a 390 px phone, so the drawer never sees the badge (p3-002, p2-004). The body's 「輪到你畫！」 still covers this. During `deal` and `vote` the badge marks seats the table is waiting on, which is correct, but the wording reads like a drawing turn. Reported by p3. | `js/games/fake-artist/game.js:1066` (lap appended to the subtitle); `js/ui/screens/play.js:484-488`; `css/base.css:911` | Drop 「· 第 n/2 圈」 from the subtitle (the body already shows 「第 1/2 圈 · 第 3/10 筆」), or render the badge before the subtitle. The shell could take a phase verb (`view.turnLabel`: 睇卡 / 投票). | `js/games/fake-artist/game.js` (or `js/ui/screens/play.js`) |
| 9 | polish | text | 🧀 in the results confetti | The final-results confetti cycles 🎉 ✨ 🧀 🎊 ⭐ for every game. The cheese is the app mascot, but on a 假畫家 win screen it reads like a leftover from 芝士大盜. Reported by p3. | `js/ui/screens/results.js:20` | Use `meta.emoji` (🎨 here) in place of 🧀. | `js/ui/screens/results.js` |
| 10 | polish | text | 🗑️ 呢輪作廢 on a scored round says 「呢個遊戲唔支援」 | On `result`, the engine leaves a scored round alone, so `dispatch` returns false and the host gets 「呢個遊戲唔支援」, which is untrue for this game. The flow doc §8.3 asked for 「呢輪已經計咗分，㩒下一輪就得」. The same section still says "no screen calls it yet", but `play.js` now does. Found in code. Nobody voided a round. | `js/ui/screens/play.js:113-114`; `js/games/fake-artist/game.js:825` | Let the engine expose whether voiding is possible (for example `hostActions` or a `canVoid(state)`), and say 「呢輪已經計咗分」 when it is not. Update flow doc §8. | `js/ui/screens/play.js`, `docs/games/fake-artist.md` |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p2 (blocker) | Tie-rule mismatch: a 2–2 top tie should force the fake to guess under `must-guess` | **App is right.** The fake was not in the tied top group in either round: R1 小美 had 0 votes (top 阿明 2, 大熊 2), and R2 阿強 had 0 votes (top 阿明 2, 大熊 2). The verified rule says "If `top` does not contain F: the fake artist is not caught under every `tieRule`… Example: counts A=2, B=2, F=1." `resolveVote` (`game.js:693`) does exactly this, and the screen explained it (「最高票係 阿明、大熊，但佢哋都唔係假畫家，所以假畫家逃脫」). |
| p2 (minor) | The rules sheet auto-opened twice while drawing | **AI artifact.** Only the 📖 button, the 💡 sheet's link and the ⋯ menu open it (`play.js:60,73,373`). p2 says its "format fix" stopped it, so it was a mistyped control number in the console, and the console's `draw`/`tap` presses whatever control that number resolves to. |
| p2 (minor) | The vote-result block mixes counts and voter names | **Tooling artifact.** The text dump flattens the VotePanel reveal. On screen, each row has name + 🎯 + count, a bar, and the voters' chips underneath (`VotePanel.js:137-153`). The real problem is that this reveal is brief; see #4. |
| p1 (minor) | The preset 「標準 5 人：人人都畫，先到 5 分」 contradicts the 2-round setup | **Misread.** 快速揀 lists one-tap options. Each label describes what tapping it would set. A preset is marked `on` only when it matches the current config (`lobby.js:370`, `presetMatches`). None matched here, so none was highlighted. |
| p1 (polish) | A 22 px scroll offset clips the theme card while drawing and voting | **AI artifact.** The console scrolls the target into the middle of the screen before every `draw`/`tap` (`tools/playtest/pt.mjs` `resolve` → `scrollIntoView({ block: 'center' })`). The app does not leave that offset. |
| p1 (polish) | The golden re-peek card takes a lot of height and sits below the fold | **Not a defect.** The drawer's whole canvas is on screen above it (p3-002). The card is deliberately last and short (`style.css:60`, 5:2). |
| p1, p3 (minor) | No discussion window before voting; ballots open at once | **App is right.** The verified procedure says: "Optional, not in the rules. The official booklet goes straight to the countdown. Many tables allow a short look/argue window first. [HOUSE]". Ballots stay open until the last one locks, so anyone can talk first, and the reveal is simultaneous. A host-set discussion timer is a possible enhancement from the research's dashboard list, not a bug. |
| p3 (polish) | No start-player choice and no pen choice | **App is right.** With the app as question master, the research's design note is "`startPlayer` … default random or left-of-QM for app-QM", and the spec's choice is random over all artists, independent of the fake (BACKLOG #20). The research lists colour assignment as automatable, and distinct pens are required (two players never share one). Choosing who starts is offered (`first`) only when there is a human QM. |
| p4, p5 (minor) | No turn timer; some strokes took 20–40 s | **App is right / AI latency.** The table ran `turnSecs: 0`, the default. The official rules have no timers, and a 0–60 s stroke clock is available in settings. The waits were AI players thinking, not the app. |
| p4 (minor) | No colour-blind labels on player chips during drawing | **App already does this.** Every order chip shows turn number + colour dot + name (`ui.js:479-486`, p1-003), as the research asks ("a name label or number next to each colour"). The result also has tap-to-highlight per player. |
| p4 (polish) | Result phrasing is slightly verbose | Subjective. The line is clear, and p1/p3 praised it. |
| p4 (polish) | The emoji reveal might leak | p4 found it consistent itself: 🕶️ appears only after the round ends. There is no leak. |
| p5 (polish) | Confetti covers the screen and blocks interaction | **AI artifact.** `.confetti` has `pointer-events: none` (`css/base.css:1140`) and is removed after 6 s (`results.js:266-267`). The console lists any full-screen layer as an overlay. The 🧀 inside it is kept as #9. |
| p1, p2, p3, p5 | Caught-fake guess, judge and artist +1 could not be tested | Coverage gap, not a defect. See the verdict and #1. |

## AI-artifact and misread notes

- p4's timeline ("~50 minutes", "drawing ~15–18 min") is invented. The whole game ran 19:42–19:55 UTC, about 13 minutes including the lobby.
- p2 says "QM role rotated between rounds". There is no question master in 手機出題 mode.
- p1 credits the "last round's fake is not the fake again" setting. `antiStreak` was off. The fake changed by chance.
- p4 describes a "2-sec auto-hide timer" on the card. The cover is hold-to-peek and closes on release, with no timer.
- Player slips, not app issues: in R1 阿聰 said his wheel sat 「喺軌上面」 (on the track), which let the fake 小美 infer 火車. In R2 p1 said 棉花糖 aloud while accusing.
- p3's lost 確定 tap in R1 looked like console flakiness, but the code explains it (see #6). It was kept because a human tap can hit it too.

## Rights checklists, merged per role

### 真畫家 (real artist): p1 ×2, p2 ×2, p3 R2, p4 ×2, p5 R1

| right | status | evidence |
|---|---|---|
| Theme announced to everyone | ✅ | Big 主題 card and header subtitle from the deal onward. |
| Title private, hold-to-peek, re-peek any time | ✅ | 「🎨 你係真畫家 / 主題 / 火車」 only while held. The striped card stays under the board during drawing and voting. |
| 睇完喇 with a count-only wait | ✅ | 「已睇 n/5」 pips, no names. Drawing waits for all. |
| One continuous stroke per turn, two laps, no double turns, locked outside your turn | ✅ | 「第 2/2 圈 · 第 9/10 筆」, `oneStroke`, too-short strokes rejected, order chips ●○. |
| Own distinct pen with number + name | ✅ | Five distinct pens (gold, green, blue, red, purple). The vote list uses different colours (#3). |
| Watch every stroke live | ✅ | All phones updated live. |
| One secret vote, never self, reveal only when all have locked | ✅ | Two-step pick/confirm, 「已投 n/5」, then the tally. A tap can be lost (#6). |
| See who pointed at whom | ⚠️ | Only during the 4.5 s tally (#4). |
| Scrutinise the picture when voting | ⚠️ | 240 px, no zoom (#2). |
| +1 each if the fake is caught and guesses wrong | — | Not exercised (tests `points-v1…`). |
| Judge the guess (host seat, app-QM) | ⚠️ | Not exercised. The judge screen shows the word uncovered (#1). |
| See the title, the fake, the replay and highlight at round end | ✅ | p3-007: 題目 火車, 假畫家 小美, legend chips, ▶ 重播. |
| Read the result at your own pace | ⚠️ | Anyone's 下一輪 ends it for all (#5). |

### 假畫家 (fake artist): 小美 R1, 阿強 R2

| right | status | evidence |
|---|---|---|
| Theme known, title never shown before the round ends | ✅ | 「🕶️ 你係假畫家 / 主題：交通工具 / ✕ / 你唔知題目，扮到似識就贏。」. `view.mine.word = null`. |
| Card layout and timing identical to a real artist's | ✅ | Same Cover, same four lines, same ack and sounds (p3, p5). |
| Draw like everyone, one stroke per turn | ✅ | 小美 drew first in R1 (random draw). Nothing told her she was first because she was the fake. |
| Vote like everyone | ✅ | 小美 voted 阿明, 阿強 voted 大熊. |
| Not caught: no forced reveal or guess, +2 | ✅ | Both rounds: 「假畫家 小美 +2。」 / 「假畫家 阿強 +2。」 |
| If caught: exactly one guess with the picture in view; QM/host judges | — | Not exercised. The engine and tests are fine. The picture is compact (#2), and the judge's screen is readable at a glance (#1). |
| 💡 role explanation behind a hold | ✅ | `hints.js` role card is a hold-to-peek Cover. |

### 出題者 (question master)

Not in play (手機出題). The player-QM rights (type theme and title, 🎲, pick the first drawer, know the fake, judge, score with the fake) are covered by the `player QM…`, `first drawer…` and `the QM knows the word…` tests only.

### Host (p1 阿聰)

| right | status | evidence |
|---|---|---|
| ⏸ pause, ⏭ 下一步, 🗑️ 呢輪作廢, 代佢做 for a dropped seat | ✅ available, not used | Header ⏸ and the ⋯ menu (`play.js:337-339`). On a scored round, 呢輪作廢 shows a misleading toast (#10). |
| Narrator bar in 靜音 mode | ✅ | Text shown on the host phone only (p1-009). Its wording has a typo-level error (#7). |
