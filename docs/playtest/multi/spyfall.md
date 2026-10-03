# 間諜 (`spyfall`) — multi-agent playtest review

Session `mp-spyfall`, room 6621, 2026-10-03 17:45–17:52 UTC. Five AI players each drove one headless phone window (390×844). The build was deployed at `https://pych0413.github.io/bgbox/`. Its `js/games/spyfall/{game,ui}.js`, `js/ui/components/Scoreboard.js` and `js/ui/screens/play.js` match local `a72d23e` byte for byte once the `?v=` stamps are normalised. Settings: 5 players, `rounds` 1, `minutes` **8** (set by the playtest orchestrator; the app's own default for 5 players is 7), 1 spy, 24 locations, phone voting, all categories, `accuserBonus` first-midround, narration **靜音 (silent)**. Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強.

Sources checked:
- Rules and flow: `docs/research/spyfall.md` (its "## Verification" section takes precedence) and `docs/games/spyfall.md`.
- Code: `js/games/spyfall/{game,ui}.js` and `style.css` (spyfall has no `script.js`), `js/ui/{shell,logic,hints}.js`, `js/ui/screens/{play,results}.js`, `js/ui/components/{Scoreboard,RoleCard,Cover}.js`, `js/core/{room,session,sfx}.js`.
- Evidence: `room.lastResult`, `room.history`, the table chat log (`pt hear`) and the 15 screenshots.

`node tests/run.mjs spyfall` gave 82 passed and 0 failed.

## Verdict

**The game finished. The rules engine and scoring were right for the path that was played.** 大熊 was dealt the dealer role at random, so he asked first. Every seat peeked and readied before the 8:00 clock started. The question tracker blocked asking straight back. About 4m46s in (3:14 left), the spy 阿明 stopped the clock, revealed himself and named 🔺 古埃及金字塔工地, which was correct. That is outcome C: spy +4 (2 for the win, 2 for the guess), everyone else 0. This matches the verified scoring table.

**No blocker was found.** The one major issue reported by players (p2: "the game skipped my required answer") is an AI artifact. The app never mediates answers. The p2 AI passed the floor without speaking (see the chat log).

**One major issue is confirmed, and no player reported it.** On a non-spy's phone, 🕵️ 我係間諜 plays a buzz and shows the toast 「你唔係間諜，唔使㩒」. On the spy's phone the same button is silent. One tap therefore proves you are innocent, and it costs nothing: you do not have to show the location the way a shown card would. It is also an audible tell when tapped by accident.

**Not exercised live:** mid-round accusations, the accusation vote, the final vote at time-up, the accuser bonus, and spy re-reveal after a failed vote. The spy ended the round first. The engine and UI unit tests cover all of these (`everyone gets exactly one accusation…`, `final vote goes dealer first…`, `rule — the spy may stop the clock again…`, `spyfall ui: every phase renders on every seat…`). A future table should force an accusation and a time-up.

## Did it finish?

Yes. `room.phase = 'results'`. `lastResult.summary = 「阿明 贏咗，共 4 分」`. `history` has one entry.

| fact | value |
|---|---|
| location / roles | 🔺 古埃及金字塔工地 — 阿聰 監工 · 小美 石匠 · 大熊 送水嘅小童 · 阿強 祭司 · **阿明 🕵️ 間諜** |
| dealer / first asker | 大熊 (random in round 1) |
| ready → clock | all ready 17:46:09 UTC. First question 17:46:49. |
| floor trail (tracker) | 大熊 → 阿聰 → 阿明 → 小美 → 阿強 → 阿明 → 大熊 → 小美 → 阿明 |
| end | 阿明 `spy-stop` at 3:14 left (≈ 17:50:40), guess = secret → `guess-right` |
| points | p2 +4. p1, p3, p4, p5 0 (`lastResult.points`) |
| lines | 「第 1 局 🔺 古埃及金字塔工地（間諜：阿明）— 間諜贏：估中地點 · 阿明 +4」 / 「阿明 停鐘亮身分，估中地點…」 / 「間諜 +4（贏 +2，估中地點再 +2）。」 |

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | major | tell | 🕵️ 我係間諜 proves innocence for free, and buzzes only for non-spies | A non-spy who taps the button hears the `deny` buzz (150→90 Hz sawtooth) and gets the toast 「你唔係間諜，唔使㩒」. A spy who taps it hears nothing and gets a confirm panel. (1) When accused, a non-spy can tap it and hold up the toast, which proves innocence without giving away the location. In the physical game the only proof is showing your card, and that hands the spy the location, so the game polices itself. Here the proof is free. Once a group discovers this, elimination finds the spy. (2) Without any intent, an accidental tap buzzes across the table and tells neighbours "this one is not the spy". The verified rules require that the button "only shows a private toast and logs nothing publicly" and that the UI should not "distinguish by failing differently in a public way". No player tapped it. Found in code. | `js/games/spyfall/ui.js:288-291` (`api.sfx('deny'); api.toast('你唔係間諜，唔使㩒')` for a non-spy; the spy gets `setMode('spy')` with no sound) | Give every seat the same confirm panel (`ui.js:271-278`) with identical text, and no sound for anyone. For a non-spy, make 「我係間諜，停鐘」 close the panel exactly like 取消. Never print 「你唔係間諜」. Some proof is unavoidable, because a non-spy can still say "I pressed 停鐘 and nothing happened". So add a rule line to `rules.quick` / 指控同投票: 「唔好俾人睇你部手機證明身分」. | `js/games/spyfall/ui.js`, `js/games/spyfall/game.js` (rules text) |
| 2 | minor | ux | The clock and 🙋 指控 scroll away while you use the location list | The timer sits in the page flow (`.sf-clock`, order 2), and the header subtitle only says 「大熊 發問」. The 24-location list stays open in play. The flow doc §3.2 item 6 says it should be collapsed by default during play, but `listOpen` is only set at round start (`reveal` → open) and never collapses. So anyone who scrolls the list loses the clock, the turn card and 指控 (shot p3-003). The page also does not reset scroll when `reveal` turns into `play` and the blocks reorder, so the clock can start partly clipped (p3-002). This is reported by p3, and p4 raised the length of the list. | `js/games/spyfall/ui.js:101,118` (timer in flow), `:547` (`st.listOpen = v.phase === 'reveal'`, never closed for play); `js/games/spyfall/style.css:18`; `js/games/spyfall/game.js:1137` (subtitle has no time); `js/ui/shell.js:266` (scroll reset only on screen mount) | Make a compact `.sf-clock` sticky under the app header (`position: sticky`) during `play`, showing m:ss and a small 🙋 shortcut, or add the remaining time to the subtitle. Collapse the list once when `play` starts, as the spec says, and keep the 📍 toggle. Scroll to the top on the `reveal`→`play` change. | `js/games/spyfall/ui.js`, `js/games/spyfall/style.css` |
| 3 | minor | flow | Any one seat's 下一局 / 睇總分 moves the whole table on | After the 2.5 s lock, any seat's tap advances every phone. p1 tapped 睇總分 while p3 was still reading, and p3's screen jumped to the final results (its tap found no button). The final screen keeps the explanation lines, but it drops the per-player role table (監工 / 石匠 / …). In a multi-round game, one eager player would also cut everyone's round reveal short. | `js/games/spyfall/game.js:904,1001-1009` (`next-round` from any seat); `js/games/spyfall/ui.js:508-511` (button on every seat) | Have each seat tap 「睇完」 and advance when everyone has (or a majority has), with the host able to force it from ⋯. Alternatively, make it host-only and show 「等 阿聰 開下一局」 on the other phones. | `js/games/spyfall/game.js`, `js/games/spyfall/ui.js` |
| 4 | minor | missing-right | A dropped phone blocks every conviction, and a seat cannot be marked absent | The verified edge cases ask for a host action to mark a player absent, so that unanimity counts only connected seats, or to void the round (always void if the spy left). The shell offers 「代佢做」 and 「呢鋪唔計」 for a disconnected seat. 代佢做 casts 「反對」, so one lost phone at the final vote makes the spy win. Only voiding is fair. Not exercised in this game. It is a known open request (flow doc §8 "Disconnects"). | `js/games/spyfall/game.js:1083-1086` (autoAct votes no); there is no `@absent` host action in `act`/`hostAct` (`:909-916`) | Add a generic host-internal `{ type: '@absent', pid }`. It drops the seat from `votersOf` and `needYes`, and voids the round if the seat is a spy. Surface it next to 代佢做. | `js/games/spyfall/game.js`, `js/core/room.js`, `js/ui/screens/play.js` |
| 5 | polish | ux | Nobody can see who has already used their accusation | The view publishes `accUsed` (every seat that has accused), and the rules list "accusation-used flags" as public. The research doc's dashboard list includes "accusation-used badges per player". The UI never renders it: the seat grid shows only 發問中 / 🚫, and your own button turns into 已用咗指控. The 今局指控 log names past accusers, but only as a list below the actions. Reported by p1. | `js/games/spyfall/ui.js:233-242` (seat buttons ignore `v.accUsed`); `js/games/spyfall/game.js:1294` | Add a small 🙋✓ mark on the seat chip of each id in `v.accUsed` (add `v.accUsed` to the `kFloor` key). | `js/games/spyfall/ui.js` |
| 6 | polish | ux | 「輪到 X 問」 shows while X is still answering, and the tracker cannot be turned off | The asker taps the person they asked as soon as the question is asked, so the card reads 「輪到 阿聰（你） 問」 while 阿聰 is still answering. The research app notes say to keep the question tracker "off by default; adds friction". The app has no switch. It is harmless when ignored, but then the card goes stale. It worked smoothly here. Reported by p1. | `js/games/spyfall/ui.js:230-232`; no config key in `js/games/spyfall/game.js:245-258` | Reword the holder line to 「阿聰 答完就問下一個」. Optionally add a `tracker` bool (default on is fine for one-phone play, but say what it is for), or fade the card after about 60 s with no tap. | `js/games/spyfall/ui.js`, `js/games/spyfall/game.js` |
| 7 | polish | ux | Tied zero scores all get 🥈 on 今晚戰績 | Ranks are shared on ties, so the four players on 0 points are all rank 2 and all get a silver medal (shot p3-006). It reads as if they earned something. This is a shell component, so every game is affected. Reported by p1. | `js/ui/components/Scoreboard.js:41` (`MEDAL[r.rank]`); `js/ui/logic.js:61-67` (shared rank) | Show no medal for 0 points, or when a tie covers everyone below first. Show `·` or the plain rank number instead. | `js/ui/components/Scoreboard.js` |
| 8 | polish | ux | The game title is cut off on the host's phone | The host header has five icon buttons (💡 📖 ⏱️ ⏸ ⋯; other seats have four), so 「間諜 · 第 1/1 局」 truncates to 「間諜 · 第 1/1…」 (shot p1-002). The round is repeated anyway on the game's own first row (「第 1/1 局」 pill). Reported by p1. | `js/games/spyfall/game.js:1281` (title includes the round); `js/ui/screens/play.js:469-475`; `css/base.css:910` | Make the title just 「間諜」, because the round is already on the `.sf-head` row. Alternatively the shell could shrink `.play-tools` when it shows five buttons. | `js/games/spyfall/game.js` (or `css/base.css`) |
| 9 | polish | text | 「睇清楚先㩒…」 does not say the lock lasts 2 seconds | Under 下一局 / 睇總分 the button is disabled for 2.5 s, with this vague line underneath. Players could not tell whether it was a lock (p1) or why it was disabled (p3). | `js/games/spyfall/ui.js:44,509-511` | Show 「2 秒後可以㩒」 with a short countdown, or remove the line and let the button itself fade in. | `js/games/spyfall/ui.js` |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p2 (major) | "The game skipped my required answer; it auto-advanced to 小美" | **AI artifact / misread.** The app never mediates answers. The verified rules say "App should not intermediate questions", and the flow doc §1 says "The app never listens to or mediates them". The tracker moves only when someone taps a name. The chat log has no line from 阿明 at all. The p2 AI passed the floor to 小美 without speaking (trail 阿聰 → 阿明 → 小美). |
| p5 (minor) | 阿明's answer missing from the hear log | Same root: the spy AI never spoke. The app has no answer record by design. |
| p2 (minor) | Tapping the reveal "confirm" struck locations instead | **AI artifact / unverified.** Revealing takes two explicit taps: 🕵️ 我係間諜, then 「我係間諜，停鐘」 in a panel that replaces the action grid (`ui.js:271-278`). The cited screenshot p2-001 is the reveal-phase peek screen, not a marking state. Numbered console controls shift when the panel replaces the grid, and that fits an index-based tap landing on a list chip. Strikes are hidden in the spy's pick mode (`ui.js:463`), so nothing carried over. |
| p5 (major ×2) | Accusation and final-vote flows could not be verified | Not a defect, just untested coverage. The engine and UI tests cover both (82 passed). This is listed under the verdict as a gap for the next table. |
| p5 (minor, tell) | The spy guessed correctly, so maybe it had outside knowledge | Not an app issue. The spy's view has no location (`viewMine`, `game.js:1257-1259`). The table gave strong clues: 「人多到要排隊先做得嘢」, 「日曬雨淋」, 「好大舊，一睇就知好有年代」. |
| p1 (minor) | Default timer 8:00 for 5 players, though the table says 7 | **App is right.** `config.defaults(5)` gives `recommendedMinutes(5) = 7` (`game.js:209-215,250`). The playtest setup forced `minutes: 8` ("requested keys … minutes=8"). |
| p3 (polish) | No time limit on the spy's guess; a staller holds the table | **App is right.** No rulebook times the spy's naming, and the physical table has the same social pressure. 代佢做 exists for a disconnected seat. |
| p3 (polish) | 建築地盤 and 古埃及金字塔工地 are too similar; roles 監工 and 石匠 fit both | Role lists do not overlap (`js/data/spyfall-locations.js:51` vs `:209`; 監工 and 石匠 belong only to the pyramid). Near pairs make the spy's job hard on purpose, and the official lists have them too (Pirate Ship / Ocean Liner / Submarine). |
| p3 (polish) | ↩ 撤銷 available to every seat | **By design** (flow doc §4: any seat may record a pass, so a single phone lying on the table works). A mis-tapped undo is reversed by tapping the name again. |
| p3 (minor) | Scroll offset jumps by itself (0 → 89, 645 after a chip tap) | **Mostly a tooling artifact.** The console scrolls a control into view before tapping it. The one real part (no scroll reset at `reveal`→`play`) is merged into #2. |
| p4 (polish) | The location list needs scrolling | 24 grouped chips cannot fit one phone screen. Grouping and the 📍 collapse exist. The real problem (the clock and 指控 scroll away, and the list does not collapse in play) is #2. |
| p4 (minor), p5 (minor) | Turn changes took 15–25 s | **AI artifact.** The floor moves only when a player taps, and the AIs took that long to talk and tap. |
| p1 (polish) | The pause during the spy's choice is short, and there is no count of guesses | **App is right.** The verified rules end the round right after the guess. With two spies, each pick is listed for everyone (`ui.js:417-419`), and the second spy is shown only when it is their turn (`game.js:1226`). |
| p3 (minor), p1 (polish) | Results moved on / vague hint | Kept as #3 and #9. |

## AI-artifact notes (only an AI's speed or tooling would hit these)

- **Silent floor passes.** Several passes in the trail have no speech in the chat log: 阿明 → 小美, 阿強 → 阿明, and 阿明 → 大熊. The AIs tapped the next name without saying the question aloud. A human table cannot do this, so "skipped answer" reports are not app behaviour.
- **Latency gaps.** The 15–25 s "nothing changed" stretches (p4, p5) are model thinking time between `wait` / `tap` calls. The engine has no deadline in `play` other than the clock.
- **Console scroll-into-view.** The 645 px jump after a chip tap is the tool scrolling the target into view. A thumb does not do that.
- **Index-based taps after a re-render.** The spy confirm panel replaces the action grid, which renumbers controls. That fits p2's "tapped confirm, got a strike".

## Rights checklists, merged per role

**📍 非間諜 (地點內嘅人)**: p1 阿聰 (監工), p3 小美 (石匠), p4 大熊 (送水嘅小童, dealer), p5 阿強 (祭司)

| right (verified rules) | result | evidence |
|---|---|---|
| Private look at the location and your role, hold-to-peek, same layout as the spy's card | ✓ | p1, p3, p4, p5. `RoleCard team:'card'`, mid-screen, covered on release |
| Clock starts only after everyone has looked | ✓ | 已準備 x/5 with the names still missing. Started at 17:46:09 when the last seat readied |
| Location list for everyone, with a private strike-through | ✓ | p3, p5 struck items and used 還原劃線. It is open by default in play (#2) |
| Dealer asks first; the first question has no restriction | ✓ | 大熊 → 阿聰, 「第一條問題，想問邊個都得」 |
| Ask anyone except the person who just asked you | ✓ | 🚫 on the previous asker, 「唔可以問返 大熊」 |
| Answer in any form, with no app mediation | ✓ | verbal only |
| One mid-round accusation per round (stops the clock, names a suspect) | not used live. Covered by tests | 🙋 指控 visible and enabled on every phone |
| Vote yes/no on an accusation (suspect excluded, accuser auto-yes, unanimity) | not exercised. Covered by tests | `everyone gets exactly one accusation…`, `the accuser and suspect cannot vote…` |
| Know who has already used their accusation (public) | ✗ not shown (#5) | `v.accUsed` unrendered |
| Final vote at time-up: dealer first, seat order, first unanimous suspect ends it | not exercised. Covered by tests | `final vote goes dealer first…` |
| Accuser bonus (+1, first mid-round accuser of a spy caught mid-round) | n/a this round | `bonusFor` tests |
| See the clock-stop, the spy reveal, the result and the per-point explanation | ✓ | 「🕵️ 阿明 話佢係間諜」, 「⏸ 鐘停咗 · 剩 3:14」, reveal table, 「間諜 +4（贏 +2，估中地點再 +2）」 |
| 我係間諜 as a non-spy gives nothing away | ✗ (#1) | private toast plus `deny` buzz, which proves innocence for free |
| Time to read the round reveal | partly (#3) | any one seat's 睇總分 moves everyone after 2.5 s |

**🕵️ 間諜**: p2 阿明

| right (verified rules) | result | evidence |
|---|---|---|
| Learn you are the spy; no location or role | ✓ | `viewMine` card 「你係間諜」, no `loc` |
| Same screens, buttons and timing as a non-spy (no tell) | ✓ in layout and timing. ✗ in sound when a non-spy taps 我係間諜 (#1) | the spy's phone is silent where a non-spy's buzzes |
| Ask and answer like everyone else | ✓ in the app (the AI stayed silent) | floor passed through 阿明 three times |
| Stop the clock and reveal while it runs and no vote is open | ✓ | stopped at 3:14, with a confirm step |
| Name exactly one location from the full list, with a confirm button that stays reachable | ✓ | correct guess, outcome `guess-right`, +4 |
| Accuse as a feint | not used. Covered by tests | `a spy may accuse as a feint…` |
| Reveal again after a failed accusation | not exercised. Covered by tests | `rule — the spy may stop the clock again…` |
| No guess after time-up or after conviction | not exercised. Covered by tests | `the spy cannot guess once time is up`, `a convicted spy gets no last guess` |

**👑 房主 (host, also a normal player)**: p1 阿聰

| right / duty | result | evidence |
|---|---|---|
| Setup with the head-count recommendation pre-filled | ✓ (default 7 min for 5). This run overrode it to 8 | `config.defaults` |
| ⏸ pause / ⋯ menu / 下一步 | present, not needed | shot p1-002 |
| No secret panel; others' roles hidden until round end | ✓ | host view shows only its own card |
| Handle a dropped phone fairly | partly (#4) | 呢鋪唔計 voids. No way to mark a seat absent. 代佢做 votes 反對 |
