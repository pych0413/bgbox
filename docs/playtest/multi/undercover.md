# 誰是臥底 (`undercover`) — multi-agent playtest review

Session `mp-undercover`, room 2641, 2026-10-03 17:34–17:39 UTC. Five AI players, one headless phone window each (390×844), on the deployed build `20261003171423`. Its undercover, shell and component files (`game.js`, `ui.js`, `RoleCard.js`, `VotePanel.js`, `NarratorBar.js`, `play.js`, `results.js`) are byte-identical to local `a72d23e` once the `?v=` stamps and line endings are normalised. Settings: all defaults (`preset std` → 平民 4 · 臥底 1, `win parity`, `tie pk`, `pkVoters all`, `revealRole` on, `abstain` off, no timers), narration **靜音**. Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強.

Sources checked: `docs/research/undercover.md` (its "## Verification" section takes precedence), `docs/games/undercover.md`, `js/games/undercover/{game,ui}.js` (there is no `script.js` for this game), `js/ui/screens/{play,results}.js`, `js/ui/components/{RoleCard,NarratorBar,Scoreboard}.js`, and `js/core/{room,session,client}.js`. Evidence: `room.lastResult` and `room.history` on p1, the table chat (`pt hear`), the 16 screenshots, and the word bank. `node tests/run.mjs undercover` → 82 passed, 0 failed.

## Verdict

**The game finished in one round and the engine was right.** Words were dealt privately and the pair stayed hidden until the end. Speaking order, the vote, the tally, the role-only reveal, the win check (I = 0 → civilians), the result lines and the points (+2 for each civilian) all match the verified rules and the flow doc.

**There were no blockers or majors.** The confirmed findings are 4 minor and 6 polish. The most important ones:

1. Any seat can end the free discussion for the whole table with a single tap, **including an eliminated seat**.
2. Mid-game, nothing on screen keeps the vote record (who voted for whom). Any seat can dismiss the result screen, and it moves on by itself after 20 s with no visible clock.
3. The app has no foul workflow, which the verified rules ask for.

This game did not test PK, the 白板 (blank) and its guess, round 2 and later, the timers, single-device play, abstain, or `revealRole` off. Those parts are checked only against the code and the 82 unit tests.

## Did it finish?

Yes. `lastResult.summary = 「平民贏！平民詞「半島」，臥底詞「小島」」`, and `history` has one entry.

| fact | value |
|---|---|
| pair | civilians 「半島」, undercover 「小島」 (bank: `{a:'小島', b:'半島', cat:'自然與植物', level:2}`) |
| roles | 阿聰 / 阿明 / 小美 / 阿強 平民 · 大熊 臥底 |
| round 1 order | 阿聰 (random starter) → 阿明 → 小美 → 大熊 → 阿強, clues 17:35:51 → 17:37:05 |
| discussion | three accusations at 17:37:16–17. The vote opened seconds later, when some player tapped 開始投票. 大熊 never spoke again |
| vote | 阿聰, 阿明, 小美, 阿強 → 大熊; 大熊 → 阿聰. 大熊 out with 4 votes, shown as 🕵️ 臥底 |
| result | 平民贏 (`allOut`), points p1/p2/p3/p5 +2, 「平民一個自己人都冇投錯！」 |

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | minor | rules / ux | One tap from any seat, even an eliminated one, ends the discussion for everyone | The discuss screen shows 「開始投票 🗳️」 on every phone that has a seat, dead seats included, and the engine accepts `start-vote` from any seat. In play the vote opened a few seconds after the accusations, before the accused could answer (p1, p3). The verified rules say the discussion runs "until the host ends it" (or a 60–120 s timer), and "eliminated players do not speak or vote". With 2+ undercovers, an eliminated undercover can cut the table's discussion short to protect a teammate. Ballots can still be changed until the last one lands, so the harm is limited: it is pressure, not a lost vote. | `js/games/undercover/game.js:1271-1275` (no alive check), `js/games/undercover/ui.js:246-248` (the button is shown for every `v.me`). The flow doc §3.4 chose "any seat" for shared phones | Show the button only to **alive** seats, and reject `start-vote` from dead seats in the engine. On phones of their own, make it a consent step: 「想開始投票 2 / 4」 opens the vote when a majority of the alive seats have tapped. Host `@next` and `discussSec` still force it. A shared phone keeps the single tap. Add a test that a dead seat's `start-vote` is a no-op | `js/games/undercover/game.js`, `js/games/undercover/ui.js`, `docs/games/undercover.md` §3.4 / §5.2, `tests/undercover.test.mjs` |
| 2 | minor | missing-right (info) | The vote record vanishes mid-game | Who-voted-for-whom is the main deduction tool from round 2 on ("阿明 voted for a civilian last round"). The research makes ballots public after the lock. The tally appears only on the `elim` screen. Any seat's 繼續 dismisses it, and it moves on by itself after 20 s with no visible clock (`timerLabel` null). After that, nothing on screen shows earlier votes until the final results, although every view already carries `history` with the ballots. Not reported, because the game ended in round 1 | `js/games/undercover/ui.js:454-474` (`view.history` is only used for the screen key at :459), `js/games/undercover/game.js:744` (`RESULT_MS` deadline, no label) and `:49` | Add a collapsible 「📜 之前嘅投票」 under 睇返我個詞 that lists each history entry: the round, who voted for whom, and who went out, with the role per `revealRole`. It is public data and the same on every phone, so it carries no tell. Either show a small countdown on the result screen or drop the 20 s auto-advance when no seat is stalled | `js/games/undercover/ui.js`, `js/games/undercover/style.css`, `js/games/undercover/game.js` |
| 3 | minor | missing-right | No foul workflow for a clue that says your own word | The verified edge cases say: "give any alive player a 'foul' button and let the group or host confirm. Penalty options: forfeit, lose the clue, or (strict) treated as voted-out". The host dashboard should have a "foul" control. The app has no foul control and no host action to put someone out, so the table's only penalty is to vote the player out next time (p1, p3). The flow doc §9 lists this as a deliberate v1 omission | `js/games/undercover/game.js:1109-1129` (`hostAct` has no foul) and no `engine.hostActions` (the shell hook exists at `js/core/session.js:373`, used by draw-guess) | Add `engine.hostActions`: 「🎛️ 犯規：〔name〕出局」 for each alive seat, or one entry that opens a seat picker. It eliminates the seat with the reveal per `revealRole`, adds a `foul` line to the history, and runs the normal win check. Add one rules-sheet line saying what the table does on a foul | `js/games/undercover/game.js`, `js/games/undercover/ui.js`, `docs/games/undercover.md` §9 |
| 4 | minor | ux (shell) | The host's 下一步 ⏭ looks like the main action and does not say it skips | In 靜音 the bar is shown whenever a cue exists, which in this game is always. Its 下一步 is `btn-primary`, the brightest button on the host's screen next to 講完喇 / 繼續 (p1-001, p1-003), and it does not say what it skips. In undercover the first press completes the cue and the second press skips the step. A skipped **vote** resolves with the missing ballots counted as abstentions (`game.js:663`), so two stray taps 1.5 s apart can put someone out on partial ballots. The ⋯ menu already labels the same action 「⏭ 下一步（跳過今個步驟）」 | `js/ui/components/NarratorBar.js:61` (`btn-primary`), `js/ui/screens/play.js:434` (bar shown for the host in 靜音 with a cue), `:461` | Make the bar's 下一步 `btn-ghost` and label it 「⏭ 跳過呢步」, or hide it in 靜音 (the ⋯ menu keeps it). Ask for confirmation before skipping an open vote | `js/ui/components/NarratorBar.js`, `js/ui/screens/play.js` |
| 5 | polish | missing-right | No clue log, not even a private note | Clues are spoken only, and the speak screen shows ticks with no text. From round 2 on, players rely on memory (p1, p3, p4). The research lists a clue log as implementation priority 6 and notes that it helps memory. The flow doc §9 leaves it out on purpose | `js/games/undercover/ui.js:191-229` (`speakScreen`) | Cheapest with no leak: a private 📝 notes pad on each phone, kept locally and never sent. Later, an optional typed one-line clue revealed once all are in, as the research suggests | `js/games/undercover/ui.js` |
| 6 | polish | text | The word card says 角色牌 | The lock button reads 「🔓 鎖定角色牌」 / 「🔒 已鎖 — 㩒一下解鎖」, the locked message 「角色牌鎖咗」, and the aria label 「㩒住睇角色牌」. In this game nobody gets a role, only a word (p1). This is the open request in the flow doc §8 #5 | `js/ui/components/RoleCard.js:74-75`, `:84`; `js/games/undercover/ui.js:91-99` (cannot override) | Add `lockLabels` and `ariaLabel` props to RoleCard. Undercover passes 「鎖定詞語卡」 / 「詞語卡鎖咗」 / 「㩒住睇詞語」 | `js/ui/components/RoleCard.js`, `js/games/undercover/ui.js` |
| 7 | polish | ux | Clutter on the deal screen | Every unconfirmed phone shows a purple 「輪到你」 pill during a step everyone does at the same time (p1, p3-001). The hold instruction appears twice (the lead line 「㩒住張卡先睇到，放手即刻冚返…」 and the RoleCard hint 「㩒住先睇到，放手即刻冚返」), plus a manual 🔓 鎖定角色牌 that 記住喇 already does. None of this is a tell, because it is the same on every phone | `js/ui/screens/play.js:484-487` (the badge follows `focus`), `js/games/undercover/ui.js:146` + `js/ui/components/RoleCard.js:82` | Hide the badge when `focus` contains every seat, or let `focus` carry a `simultaneous` flag. Pass `hint: ''` to the card during the deal | `js/ui/screens/play.js`, `js/games/undercover/ui.js` |
| 8 | polish | text | 「佢哋」 for a single undercover | Results line 「臥底：大熊（佢哋一開始都唔知自己係臥底）」 (p3) | `js/games/undercover/game.js:1090` | `${unds.length > 1 ? '佢哋' : '佢'}` | `js/games/undercover/game.js` |
| 9 | polish | text (shell) | 🧀 in every game's confetti | The confetti set is the Cheese Thief theme (p3) | `js/ui/screens/results.js:20` | Use the game's `meta.emoji` in place of 🧀 | `js/ui/screens/results.js` |
| 10 | polish | docs | The flow doc says anti-streak does nothing, but it works | §5.7 says 「The room does not pass `carry` yet… the toggle has no effect」, and §8.1 repeats it. The room keeps `res.carry` per game and passes it to `setup`, so `antiStreak` works | `docs/games/undercover.md:399-400`, `:470-473` vs `js/core/room.js:997`, `:1080`, `js/core/session.js:153` | Rewrite §5.7 and §8.1 to say the room passes `carry` | `docs/games/undercover.md` |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p1, p3 | No abstain button on the vote screen | **App is right.** The research says: "Abstain is allowed if configured." Flow doc §2.1 sets `abstain` to `false` by default, and the lobby offers 「容許棄票」 (configApplied `abstain:false`). |
| p3 | No speaking timer / no discussion timer | **App is right.** Research: "Timer (optional): about 20-30 s per speaker". `speakSec` and `discussSec` exist and default to 0, and the shell's ⏱️ 計時 is also there. Who can end the discussion is kept as #1. |
| p3 | 「繼續 ▸」 greyed out for a non-host, with no explanation | **AI artifact.** Every seat gets 繼續. It is disabled for the first 1.5 s on every phone so that a stray tap cannot skip the result (`ui.js:27`, `:322-330`). p3 read the control list inside that window. |
| p1, p3 | 半島 / 小島 share 島 | **App is right.** The verified pair rule only bans one word containing the other. The ban applies to each player's own word, so it hits both sides equally. 371 of the 899 bank pairs share a character, which is folk-standard (叉燒/燒肉, 炒飯/炒麵). |
| p1, p3 | 自然與植物 is the wrong category for 半島 / 小島 | **App is right.** It is the "nature" category, which also holds landforms (火山/冰川, 瀑布/溪流, 河流/湖泊). The category is shown only on the results screen. |
| p1 | Tied winners get a "bronze-looking" medal; 大熊 is ranked 5 | **App is right.** The medal is 🥇 (`Scoreboard.js:20`) drawn by the Windows emoji font. 1-1-1-1-5 is standard competition ranking. |
| p1 | 呢局得分 leaves out 大熊 +0 | **By design.** Flow doc §5.6 says `points` covers winners only. The 今晚戰績 table right below lists 大熊 with 0. |
| p4 | Word-length tell at the deal | No defect. Both words were 2 characters, and the card has the same size and place for everyone (p4 said the same). |
| p4 | Re-viewing the word needs a tap | **By design.** 「🃏 睇返我個詞」 is one tap away on every phase screen (flow doc §7). |
| p3 | The vote started before I could tap 開始投票 | Merged into #1. The console error 'no control matching' was a race in the tool. |
| p4, p1, p3 | Clues are not displayed | Kept as #5 (polish). |
| p1 | No foul button | Kept as #3. |

## AI-artifact notes

- **The discussion lasted seconds.** Three AIs posted the same accusation within 1 s (17:37:16–17), then one tapped 開始投票 at once. A human table would normally keep talking, and the accused would answer. #1 stands because one eager player, or an eliminated one, can do the same.
- **阿聰's first clue took about 80 s.** That was model thinking time. There is no speak timer by default, which is correct.
- **p5's report has false observations.** It says 「Clues remained visible on screen after each speaker finished」 and 「clear timer/order」. No clue text or timer exists in this configuration. p2 also lists a timer. p2 and p5 rated the pair "well-chosen" while p1 and p3 called it weak. Their "goodThings" are not used as evidence.
- **p3's greyed 繼續** was the 1.5 s lockout, seen because the console prints the controls the moment the screen changes.
- **The hold-to-peek "saw it mid-card"** comes from the DOM text that `pt hold` prints. A human sees the same thing, so it is not an artifact, just a note that the console reads the text and not pixels.

## Rights checklists, merged per role

**Everyone (alive seat)**

| right (verified rules) | result | evidence |
|---|---|---|
| Counts announced (平民 n · 臥底 n · 白板 n) | ✓ | header on every screen; deal narration |
| Private word with hold-to-reveal, auto-hide, then confirm | ✓ | all 5; the card locks after 記住喇 |
| The round waits until every seat has confirmed | ✓ | 「已有 3 / 5 人記住咗 · 等緊：阿聰、阿明」 |
| Re-view your own word, available to everyone, not logged | ✓ | 🃏 睇返我個詞 on every phase. The card stays locked and needs 🔓 then hold |
| Visible speaking order, alive seats only, random starter, ticks | ✓ | 1–5 list, 第 n / 5 個, 阿聰 drawn as starter |
| The one hard clue rule shown on screen | ✓ | 「一人一句。唔可以講出個詞，或者入面任何一個字。」 |
| Free discussion until the host ends it or a timer runs out | ✗ partly: any seat, even a dead one, ends it (#1) | p1, p3 |
| Secret simultaneous vote, no self-vote, change until the lock, progress without choices | ✓ | pick → 確定投俾; 改票; 已投 4/5 · 仲未投：阿聰 |
| Abstain if configured | ✓ (off in this game) | `abstain:false` |
| Ballots public after the lock (who voted for whom) | ✓ on the result screen; ✗ afterwards (#2) | p1-003 |
| Eliminated: role revealed only (default), words secret until the end | ✓ | 「大熊 出局 / 🕵️ 臥底」; words only on results |
| Foul call with group or host confirmation | ✗ (#3) | none exists |
| Clue log (optional) | ✗ (#5) | none exists |
| End: word pair, who held what, vote history, points | ✓ | 點解會咁 lines, +2, 今晚戰績 |
| PK on a tie, second-tie rule, streak guard | not exercised | covered by unit tests (82 pass) |

**🧑 平民** (p1 阿聰, p2 阿明, p3 小美, p5 阿強)

| right | result | evidence |
|---|---|---|
| Hold the civilian word C, not told your role | ✓ | the card shows only 「半島」, with the same layout for all |
| Win when every infiltrator is out | ✓ | `allOut` → 平民贏, +2 each |
| See whether the table voted out its own people | ✓ | 「平民一個自己人都冇投錯！」 |

**🕵️ 臥底** (p4 大熊)

| right | result | evidence |
|---|---|---|
| Hold U, not told you are the odd one out | ✓ | card 「小島」, identical layout; deduced from the clues |
| Speak, vote, and change the vote like everyone else | ✓ | voted 阿聰 |
| Win at parity (default) | not reached | voted out in round 1 |
| Not readable at a glance (no role-dependent sound, animation or layout) | ✓ | same `lock` / `reveal` sounds; the hint is built from public facts only |
| As an eliminated teammate, cannot affect the live game | ✗: a dead seat can still end the discussion (#1) | code |

**⬜ 白板** (not dealt in this game; code-checked only)

| right | result | evidence |
|---|---|---|
| Knows it is blank; the card has the same size and place, only the text differs | ✓ (code) | `ui.js:79-89` |
| One typed guess when voted out, before the win check; correct guess wins per `guessWinner` | ✓ (code + tests) | `game.js:719-731`, `settleGuess` |
| Always announced as 白板 when it guesses, even with `revealRole` off | ✓ (code) | flow doc §3.6 |
| Can be the first speaker (house rule `blankNeverFirst` off) | ✓ (code) | `setup` pool = all seats |
