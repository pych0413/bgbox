# 你畫我猜 (`draw-guess`) — multi-agent playtest review

Session `mp-draw-guess`, room 6231, 2026-10-03 19:55–20:04 UTC. Four AI players (haiku and sonnet) each drove one headless phone window (390×844). The build was the deployed `https://pych0413.github.io/bgbox/`. Its `js/games/draw-guess/{game,ui,judge,script}.js`, `style.css` and `js/ui/screens/results.js` hash-match local `a72d23e` once the `?v=` stamps are normalised. Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊.

Settings: 4 players, FFA, 📱 phone canvas, ⌨️ typed guessing (standard strictness), `cycles: 1` (4 turns), round time auto = 100 s, hints on, all categories and tiers, narration 靜音 (silent).

Sources checked:
- Rules and flow: `docs/research/draw-guess.md` (its "## Verification" section takes precedence) and `docs/games/draw-guess.md`.
- Code: `js/games/draw-guess/{game,ui,judge,script}.js` and `style.css`, `js/ui/screens/{play,results}.js`, `js/core/{client,util}.js`, `css/base.css`.
- Evidence: `room.lastResult`, the engine's own `session.state` on the host (history with solver times, the last turn's guess log, every offered word), each seat's `state.ink` / `state.pictures`, the table chat log (`pt hear`), 52 screenshots, and a final `see` of p4.

`node tests/run.mjs draw-guess` gave 63 passed and 0 failed.

## Verdict

**The game finished, and the rules engine was right for every turn that was played.** All four turns, the hint clock (category at 25 %, one character at 50 %, no second reveal on 2-character words), the typed checker (太極, 茶道 and 魚龍 accepted on the first try), the private 好接近 / public 🔥 badge split, the solved-guesser lockout, the time-based scoring, the drawer share, the ranking and the evening point all match the verified rules. I recomputed every point from the engine's recorded `rem` values (table below).

**No blocker.** All four "major" reports from the players are rejected. Two are misreads: round 2 had no winner because nobody typed 粉筆, and 2-character words get exactly one reveal. Two are AI-speed artifacts: the reveal was "missing" and the canvas was "blank". The reveal was on screen for 7 s (p1-010), and every seat's ink store holds every stroke.

**One major issue, which no player flagged (found in code, and visible in p3's quoted feed).** In typed mode the drawer's own guess feed prints each correct guess in plain text (「阿聰 魚龍（已計）」) for the rest of the turn. The word otherwise sits behind the tap-to-peek chip, and in paper mode behind hold-to-peek. In ⌨️ + 📝 play the drawer's phone lies next to the paper that everyone is staring at. The UI test checks that the drawer's screen hides the word in shout mode only.

**Not exercised live:** shout mode (grace and buzzer windows), paper mode, teams and team fouls, FFA foul flags, abandon, void / 呢輪作廢, ＋30 秒, pause, the late ✔ in the reveal, re-roll, Simplified input and strictness, the burst lock, and the between-cycle standings (`cycles: 1`). The unit tests and the fuzzer cover all of these.

## Did it finish?

Yes. `room.phase = 'results'`, every seat shows 「✏️ 你畫我猜 — 贏家 · 阿聰 贏咗，89 分」, and `room.history` has one entry. Play ran from about 19:56 to 20:03 UTC (about 8 minutes; the lobby estimated 9).

| turn | drawer | offered (easy / medium / hard) | word | outcome | solvers (s left of 100) | points |
|---|---|---|---|---|---|---|
| 1 | 大熊 (p4) | 熱狗 / 太極 / 騎驢搵驢 | 太極 ⭐⭐ 運動, alt 打太極 | solved | 阿聰 39.7, 小美 38.3, 阿明 31.6 | 阿聰 +27 · 小美 +26 · 阿明 +24 · 大熊 (drew) +26 |
| 2 | 阿聰 (p1) | 粉筆 / 蛋糕模 / 獅鷲 | 粉筆 ⭐ 文具, alt 粉笔 / chalk | timeout | — | 0 |
| 3 | 阿明 (p2) | 沙灘 / 伊貝 / 茶道 | 茶道 ⭐⭐⭐ 日本, alt 日式茶道 / 抹茶茶道 / 點茶 / 茶席 | solved | 大熊 40.1, 小美 35.5, 阿聰 29.2 | 大熊 +36 · 小美 +34 · 阿聰 +32 · 阿明 (drew) +34 |
| 4 | 小美 (p3) | 爵士鼓 / 魚龍 / 未來 | 魚龍 ⭐⭐ 恐龍與遠古生物, no alt (auto-picked on the 20 s timeout) | solved at clock-out | 阿聰 49.3 | 阿聰 +30 · 小美 (drew) +20 |

Final: 阿聰 89 (3 solves, 0 drawn) · 小美 80 · 大熊 62 · 阿明 58. `lastResult.points` = p1 1, others 0. Checks: G = round(m·(10+20r)) gives 27/26/24, 36/34/32 and 30. D = round(mean G × (0.5 + 0.5k/E)) gives 26, 34 and 20 (30 × 4/6). `state.seen` holds exactly 12 words (4 turns × 3), so no re-roll happened in any turn. Turn 4's whole guess log is 阿聰 恐龍 (close, 64.2 s left), 阿聰 魚龍 (right, 49.3 s left) and 阿明 恐龍 (close, 37.7 s left). 大熊 never guessed in turn 4.

Every solve came after the 50 % character reveal, which is why the fastest reaction was 50.7 s. The AI drawers started 20–40 s late (the canvas was still blank at 1:14 in turn 4 on the host's phone), so the guessers mostly worked from hints. That is AI pacing, not the app.

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | major | secret-at-a-glance | Typed mode: the drawer's feed prints the answer in plain text after the first correct guess | The drawer's word is hidden by design: a tap chip that hides itself after 2.5 s (canvas mode) or hold-to-peek (paper mode). The flow doc §4 promises "the drawer's screen never shows the word unless tapped", and the research lists shoulder-surfing as the anti-tell to beat. The typed feed on the same screen, however, shows each right guess as 「阿聰 魚龍（已計）」 (p3 quoted exactly this from turn 4), and it stays there for the rest of the turn. Close guesses also show their full text, and a rule-(iv) close such as 「魚龍化石」 contains the answer. In ⌨️ + 📝 play (a supported combination, with its own warning) the drawer's phone lies by the paper that every unsolved guesser is looking at. In canvas mode it is the phone the drawer holds out while drawing. The UI test asserts the hidden word for `guessMode === 'shout'` only, so this path was never checked. | `js/games/draw-guess/ui.js:478` (right → `${g.text}（已計）`), `:479-481` (close text in clear); `game.js:1177-1180` (`feedFor` gives the drawer every text); `tests/draw-guess.test.mjs:2327-2329` (shout-only assertion) | Drawer feed: show a right guess as 「✅ 估中（已計）」 with no text (the text matched the answer, so it adds nothing). In close and wrong texts, replace every character that also occurs in the word or an alias (after the fold), and has not been revealed yet, with 「＊」. The drawer knows the word and loses nothing, and can still ✔ a near miss. Extend the UI test's hidden-word check to typed mode, before and after a solve. | `js/games/draw-guess/ui.js`, `tests/draw-guess.test.mjs` |
| 2 | minor | rules-design | 2-character close rule hands out a character early, then becomes noise that misleads | Rule (ii) (L = 2: same character in the same position, or reversed) is implemented exactly as verified. It does two things the research's own Chinese-hint rationale argues against ("revealing one of two characters gives away about half the answer. Hence few reveals"). **Before the reveal**, a category-guided guess gives away half the word: 阿聰's 恐龍 was 好接近 at 1:04, 14 s before 龍 was revealed, and he solved 魚龍 at 0:49. **After the reveal**, every X筆 guess in turn 2 got 好接近 (about 15 of them: 鉛筆, 毛筆, 蠟筆, 炭筆, 原筆…). Each badge carried zero information, because 筆 was already public, yet they steered all three guessers into pen types for 50 s. Nobody solved 粉筆. p2 and p4 both read the badges as "a pen type is right". Reported by p1 and p3. | `js/games/draw-guess/judge.js:149` (`pair`); `game.js:1097` (`analyse` is not told which positions are already revealed); research `docs/research/draw-guess.md:125` rule (ii), `:220`, `:279` | (a) Pass the revealed indexes to `analyse`, and do not count a close hit whose only shared characters are already-revealed positions. Treat it as `wrong`: its text then holds only public characters, so re-run the "wrong never contains the answer" property. (b) Ask the research owner whether same-position matches on L = 2 should count before the reveal at all (alternative: only "reversed" plus the `near` list for 2-character words). Update `docs/research/draw-guess.md` "Voting & resolution A" first, then the judge and its tests. | `docs/research/draw-guess.md`, `js/games/draw-guess/judge.js`, `game.js`, `tests/draw-guess.test.mjs` |
| 3 | minor | ux | Peeking at the word moves the canvas down while the drawer is drawing | The closed chip is one line (about 48 CSS px). Opened, it holds the word at 1.75 rem plus the alias line and the tier line (about 88 px). The chip sits above the canvas, so every peek pushes the canvas, toolbar and feed down by about 40 CSS px, and they jump back 2.5 s later. A finger in the middle of a stroke, or about to start one, lands in the wrong place. Screenshots: canvas top at y≈570 (p1-007) and y≈650 (p1-009) in 2× pixels. Reported by p1. | `js/games/draw-guess/ui.js:291-305` (chip swaps its children), `:642-645` (chip above the canvas); `style.css:70-79` (no reserved height) | Give `.dg-word-chip` a fixed height equal to the open state, so the closed label is centred in it. Alternatively, open the word as an absolutely positioned card over the mask and hint rows, so the canvas never moves. | `js/games/draw-guess/ui.js`, `style.css` |
| 4 | minor | ux | Reveal: the drawer's 5 s ✔ window has no visible end, and the note outlives it | Typed reveal, drawer only: 「估中咗但系統漏咗？㩒 ✔ 補返（幾秒內）。」 above a scroll box of up to 20 guesses (turn 2 had about 17). The only clock is 「自動下一輪 · N 秒」, which counts the 7 s reveal, but the ✔ window is 5 s (`LATE_MS`). At 「自動下一輪 · 2 秒」 the ✔ buttons have already gone while the note still says 㩒 ✔ (p1-010). A further line 「幾秒後自動下一位…」 repeats the countdown. Reported by p1. The 7 s / 5 s lengths are the verified rule (2.5) and stay as they are. | `js/games/draw-guess/ui.js:744` (window test), `:749` (static note), `:771-774` (✔ removed at `lateUntil`, block kept), `:779` (duplicate wait line); `game.js:27,29,1198` | Put the window's own countdown in the note (「漏咗？㩒 ✔ 補返 · 剩 3 秒」 from `rv.lateUntil`). When it closes, collapse the `.dg-late` block or change its note to 「補返時間過咗」. Replace the duplicate 「幾秒後自動下一位…」 with the next drawer's name (see #5). Optionally list close guesses first in the late feed, since they are the likely misses. | `js/games/draw-guess/ui.js` |
| 5 | minor | flow | Typed mode: the next drawer gets no heads-up at the reveal and no nudge when the 20 s pick starts | Typed play is silent by design, so `sound()` is muted for every seat, including the drawer's `deal`. `buzz()` (vibration, which is silent) exists but nothing calls it. The reveal does not say who draws next (`view.upNext` is in the view, but the reveal body never uses it). A player who looks up to laugh at the reveal finds their phone has switched to the pick screen, and after 20 s the medium card is auto-picked. Their 100 s drawing clock then starts without them. p3's own miss was AI latency (see "AI artifacts"), but a person chatting at the table hits the same gap. | `js/games/draw-guess/ui.js:77` (all sounds off in typed), `:779` (reveal wait line has no name); `js/core/util.js:53-55` (`buzz` unused); `game.js:24` (`CHOOSE_MS`), `:1243` (`upNext`) | In the reveal, show 「下一個畫：小美（你）」 from `v.upNext[0]`, bold on that player's own phone. On the drawer's phone, call `buzz([60, 40, 60])` once when its `choose` body mounts, in both modes. Vibration suits quiet places. | `js/games/draw-guess/ui.js` (and `js/core/util.js` export, already there) |
| 6 | polish | ux | Waiting phones show no countdown while the drawer picks | The non-drawers' `choose` body is a pencil, 「小美 揀緊詞…」 and the queue preview. The view carries `deadline` and `timerLabel: '揀詞'`, but nothing renders them, so guessers cannot tell how long they will wait. About 60 % of the screen is empty (p1-015). Reported by p1. | `js/games/draw-guess/ui.js:326-342`; `game.js:630-631`, `:1256-1259` | Add the calm `makeCountdown('揀緊詞')` (no beeps) to the waiting body. Optionally fill the space with the current ranking (`rankRows`). | `js/games/draw-guess/ui.js` |
| 7 | polish | ux | Typed mode: the drawer's canvas is smaller than the guessers' | `.dg-canvas.drawer` reserves 36 rem of chrome, which is sized for shout mode's name chips above the canvas. Typed mode has no chips (the feed sits below the canvas), but keeps the same reserve. On an 844 px phone the drawer gets 268 px against the guessers' 300 px, so the person who needs precision gets the smallest board. Reported by p3. | `js/games/draw-guess/style.css:140` (and `:138`); `ui.js:620` (no chips when typed); `css/base.css:777` | `.dg-play.is-typed .dg-canvas.drawer { --c-chrome: 33rem; }`. The feed then starts a little lower, which is acceptable because it scrolls. | `js/games/draw-guess/style.css` |
| 8 | polish | text | Results: 「點解會咁」 heading on a scoring game, and a 3-way-tie highlight | The shell titles every game's `result.lines` 「點解會咁」, which fits a hidden-role reveal but not 排名 / 亮點 / 每輪重溫. 「⭐ 最多困難詞估中：阿聰、小美、大熊（1 條）」 is a tie of 3 of 4 players over the game's only hard word, so it highlights nobody. Reported by p1. | `js/ui/screens/results.js:133`; `js/games/draw-guess/game.js:1486-1489` | Let `result` carry an optional `linesTitle` (here 「分數點嚟」), with the shell keeping 「點解會咁」 as the default. Skip a highlight when more than half the players share it, or word it 「各 1 條」. | `js/ui/screens/results.js`, `js/games/draw-guess/game.js` |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p2 (major) | Round 2: several pen guesses were 好接近 but nobody won | **App is right.** The answer was 粉筆 (alt 粉笔 / chalk), and nobody typed it. Rule A: a close guess gives only "private 'so close' to the guesser, a text-less 'X is close' badge to others"; it never scores. The misleading badges are kept as #2. |
| p2 (minor) | A 2-character word only ever reveals one character | **App is right.** "`maxReveals = min(2, floor(L / 2))`" gives 1 for L = 2, and the second reveal is "for words of 4+ characters only". The mask shows the revealed character in its box (□龍, p3-014), so it is clear that one of two characters is out. |
| p2 (minor), p4 (major), p3 (minor) | The round-2 reveal was missing or too short, and the word was never shown | **AI artifact.** The reveal ran its 7 s: p1-010 shows 「⏰ 時間到，冇人估中」 with 粉筆 in large type and its aliases. p3's and p4's blocking `wait` spanned it. p4 even names the wrong word (原子筆 was 阿明's public wrong guess). 7 s is the verified length (2.5), and the per-turn recap on the results screen repeats the word (「第 2 輪 · 阿聰 畫「粉筆」⭐ — 時間到，冇人估中」). |
| p4 (major) | The canvas stayed blank for 20+ s, and no drawing was ever visible in round 4 | **AI artifact.** The AI drawers started late. On the host's phone the turn-4 canvas is also blank at 1:14 (p1-016), and the drawer's own screen shows the shark at 0:50 (p3-014). p4's ink store (`state.ink`, epoch 4) holds all 8 of 小美's strokes, and `state.pictures` holds all 6 of 阿明's turn-3 strokes, the same as every other seat. p4 took no screenshot after 1:10 and sent no guess in turn 4. |
| p3 (major) | Could not see or use the 3-word choice and re-roll | **AI artifact.** p3's `wait` blocked through the 20 s pick (the flow doc's deliberate 20 s, longer than the research's 12 s). The timeout picked the medium card, 魚龍 ⭐⭐, exactly as `autoIndex` does (`game.js:634-637`). The real gap underneath, no nudge for the next drawer, is kept as #5. |
| p3 (minor) | The peek chip showed no accepted aliases | **App is right.** 魚龍 has `alt: []` (engine history), so the 「都接受」 line is hidden by design (`ui.js:318-319`). p1 saw 「都接受：粉笔／chalk」 for 粉筆. |
| p3 (minor) | Plain wrong guesses did not reach the drawer's feed | **There were none.** Turn 4's whole log is 恐龍 (close), 魚龍 (right) and 恐龍 (close). `feedFor` gives the drawer every guess with its text (`game.js:1180`), and p1's turn-2 drawer feed shows wrong ones (「阿明 螢光筆」, p1-009). |
| p3 (polish) | Score pills do not show a solver's points until the reveal | **By design.** The reveal shows every delta (`ui.js:131-145`), and the drawer's share is only known when the turn ends. |
| p2 (minor) | The drawer gets no live feedback that guesses are arriving | **Misread.** The drawer's feed lists every guess live, newest first, each with ✔ (`ui.js:463-496`). p2 says they did not look at it while drawing. |
| p2 (polish) | ✅ / 估中咗 wording varies | Each wording fits its place: own feed 「✅ 估中咗！」, solved block 「✅ 你估中咗！…」, public chip 「✅ 阿聰」. No defect. |
| p4 (minor) | Nobody guessed 原子筆 | Wrong word. The answer was 粉筆 (see above). |
| p4 (minor) | Empty character boxes are visible from the start | **App is right.** The length mask is the 0 % hint (research 2.3: "0%: length mask"). |
| p4 (minor) | 點茶 should not be an alias of 茶道 | **Content judgement, no change.** 点茶 is the Japanese name for the tea-making procedure at the heart of 茶道, so accepting it is defensible. Nobody typed it. |
| p1 (minor) | The re-roll confirm (確定換？再㩒一下) vanishes after about 3 s | **AI artifact.** `confirmButton` waits 3 s (`ui.js:94-105`). This is the same two-tap used by 放棄, 作廢 and 🚩, and a human's second tap comes within a second. p1's next console command arrived after the window closed, and the 12 offered words in `state.seen` confirm that no re-roll was sent. |
| p1 (polish) | 「估中咗但系統漏咗」 can be read as 但系 / 統 | The app never writes 但係 as 但系, so the line parses as 但 + 系統. An optional rewording is folded into #4. |
| p1 (polish) | 作廢今輪 sits next to ＋30 秒 and may lack a confirm | It is already two-tap (「確定作廢？再㩒一下」, `ui.js:398-403`). The ⏭ 下一步 that p1 could not find is in the ⋯ menu (`play.js:338`). |
| p1, p3 (notes) | Holding the peek chip shows nothing | **Tooling.** `hold` prints the screen while the pointer is still down. The chip opens on the click (release), as its label 「㩒一下」 says. |

## AI-artifact notes

- **Drawer start lag.** The AI drawers began 20–40 s into turns 3 and 4 (blank canvases at 1:28, 1:14 and 1:10). The guessers therefore leaned on the 25 % and 50 % hints, and every solve came after the character reveal. Scores were compressed into a 24–36 band. With human drawers expect earlier solves and a wider spread.
- **Blocking `wait`.** A blocking `wait` swallowed short phases: the 7 s reveal (p3, p4) and the 20 s pick (p3). p1's 3 s two-tap window expired between two console commands.
- **Hallucinated or inconsistent report details**, not used as evidence: p4's "原子筆", "second character at 75 %", "~23 minutes" and "2 cycles" (the game ran about 8 min with 1 cycle, and no turn had a second reveal). p2 says "eraser behaviour is correct (tested visually)" but also that it used the pen only. p2's "75 % second reveal on schedule" never happened.
- **Close-guess spam.** p3 and p4 sent 7–13 guesses a turn without hitting the burst lock. That is within the 6-per-10 s rule at console speed, so the lock was not exercised.

## Rights checklist (merged per role)

**Drawer (畫家)**

| right (verified rules) | result | evidence |
|---|---|---|
| Sees 3 cards (easy / medium / hard) with category, length and max points | ✓ | p1 (粉筆 / 蛋糕模 / 獅鷲), p2, p4. p3 missed its pick (AI latency) |
| Re-roll once per turn (burns the three, restarts the clock) | not completed | Button present for all. p1's two-tap timed out (AI pacing). 12 seen words = no re-roll sent |
| Pick within the clock; timeout auto-picks tier 2 | ✓ | Turn 4 auto-picked 魚龍 ⭐⭐ |
| Word behind tap-to-peek (about 2 s) with aliases | ✓ (chip) / ✗ (feed) | Chip worked for all four (2.5 s, 「都接受：…」 when there are aliases). The typed feed leaks right-guess text (#1). Peek shifts the canvas (#3) |
| Canvas: 8 colours, 3 widths, eraser, undo, clear, live to everyone | ✓ | Tools present. Every seat's ink store holds every stroke. Only the pen was used. Drawer canvas smaller than guessers' (#7) |
| No text tool | ✓ | Only strokes. Reminder line 「喺畫板上畫，唔准講嘢、寫字同數字。」 |
| Live guess feed with ✔ per guess (typed) | ✓ | p1 and p3 saw close, wrong and right rows with ✔. Never needed |
| Late ✔ in the first 5 s of the reveal | present, not used | p1-010. Window end not shown (#4) |
| Abandon (two-tap, everyone 0) | present, not used | all drawers |

**Guesser (估嘅人)**

| right | result | evidence |
|---|---|---|
| Length mask from 0 % | ✓ | every turn |
| Category at 25 % (「類別：稍後提示」 before) | ✓ | about 1:15 in each turn |
| One character at 50 %; second only for 4+ characters | ✓ | 太, 筆, 道, 龍 in their own boxes; no second reveal on 2-character words |
| Typed guesses: 700 ms gap, burst lock, 60 cap, 已打 n/60, wrong costs nothing | ✓ (lock not triggered) | p3 sent 13 guesses in turn 2 |
| Close: private text to the sender, text-less 🔥 badge to others | ✓ | p1 「恐龍 好接近！」; others saw 「🔥 好接近！」. Rule design concern in #2 |
| Correct → locked out, told to stay silent; others see the name only | ✓ | 「✅ 你估中咗！靜靜哋等其他人，千祈唔好講出答案。」 |
| 🚩 foul flag (two-tap, count against threshold) | present, not used | all guessers |
| Live drawing | ✓ | ink stores identical on all seats |
| Reveal: word, aliases, deltas, final drawing | ✓ | p1, p2. p3 and p4 missed it through tool latency |
| Simplified / variant input accepted | not tested live | unit tests cover the fold |

**Host / referee (主持)**

| right | result | evidence |
|---|---|---|
| ⏸ pause, ＋30 秒, 作廢今輪 (two-tap), ⋯ menu with ⏭ 下一步 and 🗑️ 呢輪作廢 | present, not used | p1-016 (主持 bar), header ⏸ and ⏱️ |
| Team-foul ruling | n/a (FFA) | — |
| Does not see the word unless drawing | ✓ | host's guesser screens show only the public view |

**Judge (engine, typed)**

| right | result | evidence |
|---|---|---|
| Auto-check against the word and aliases | ✓ | 太極, 茶道, 魚龍 first try |
| Close detection per rules (i)–(v) | ✓ as written | (ii) design concern, #2 |
| Scoring G / D, ranking and tie-breaks, evening points | ✓ | all values recomputed above |

**Results**

| item | result |
|---|---|
| Ranking with solves and drawer points, tie-breaks | ✓ |
| Highlights (best drawer, fastest guesser, most hard words) | ✓ (weak tie line, #8) |
| One recap line per turn, including the unsolved turn | ✓ |
| Drawing gallery with 💾 儲存圖片, evening scoreboard, 再玩一局 | ✓ |
