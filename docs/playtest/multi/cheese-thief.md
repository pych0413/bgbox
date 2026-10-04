# 芝士大盜 (`cheese-thief`) — multi-agent playtest review

Session `mp-cheese-thief`, room 4265, 2026-10-03 17:21–17:33 UTC. Five AI players, one headless phone window each (390×844), on the deployed build `20261003171423`. Its game, shell and core files are byte-identical to local `a72d23e` once the `?v=` stamps are normalised. Settings: 5 players, **家規 `pick5` on** (the thief picks 1 follower after hour six), `hourSec` 15, `discussSec` 300, recap on, narration **靜音 (silent)**. Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強.

Sources checked: `docs/research/cheese-thief.md` (its "## Verification" section takes precedence), `docs/games/cheese-thief.md`, `js/games/cheese-thief/{game,ui,script}.js`, `js/ui/**`, `js/core/{room,session}.js`. Evidence: the final engine state (`window.__app._room.session.state` on p1), `room.lastResult`, the table chat log, the 22 screenshots with their mtimes, and a Node re-run of `engine.view` + `roleFor` + `describeNote` on the final state. `node tests/run.mjs cheese-thief` → 89 passed, 0 failed.

## Verdict

**The game finished and the rules engine was right.** The night ran hours 1–6, then the `pick5` follower step and dawn. The theft happened automatically at hour 5, and the only lone sleepyhead (小美, hour 2) got her peek. The co-wakers at hour 1 were told they could not peek. The follower was told at `rec-meet`. The day ran its 5:00 timer, the vote passed 4–1, and the result was correct: thief 大熊 caught, so the sleepyheads win and follower 阿強 loses with him. Points were +1 ×3.

**No blocker survived verification.** The one reported blocker (p5: "never told I was the follower") is contradicted by the engine state and the UI code. p5 was lit and told at `rec-meet`, and from dawn its role card front and its 📓 both said 共犯 / 大盜係 大熊. It missed both because of AI latency.

**One major finding is confirmed, and it is specific to 靜音 mode.** The shell lifts the night dim only for the phones in `focus`. With eyes open, a glance shows who woke at each hour, and during 「共犯 · 大盜揀人」 exactly one phone lights up: the thief's. This is the open framework request §8 #8 in the flow doc, now seen in play.

## Did it finish?

Yes. `room.phase = results`, `lastResult.summary = 「貪瞓鼠贏 — 大盜 大熊 畀人揪出」`, `history` has one entry.

| fact | value (engine state) |
|---|---|
| roles / dice | 阿聰 🐭 1 · 阿明 🐭 3 · 小美 🐭 2 · 大熊 🧀 5 · 阿強 🐭 1 |
| night | h1 阿聰+阿強 · h2 小美 alone, peeked 阿聰 (1) · h3 阿明 alone, **no peek recorded** · h4 none · h5 大熊 stole, unseen · h6 none · night end: 大熊 picked 阿強 |
| follower | `followers = informed = ['p5']`, p5 note `{k:'follower', thief:'p4'}` |
| day | `dayReady` p2, p3, p5 = 3/5. The vote opened on the **timer**: day start ≈ 17:27:04 (p3-008 at 17:27:09 shows 4:55); p3-009 at 17:32:08 shows the vote screen at 已投 0/5 |
| vote | p1, p2, p3, p5 → 大熊; 大熊 → 小美. Top = {大熊} |

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | major | tell | 靜音 mode: a lit phone shows who is awake, and at the follower step who the thief is | In 靜音 everyone keeps their eyes open and looks at their own phone. Sleepers sit at 95 % dim; the `focus` seats drop to ≈ 0 % (p3 measured 95 % → 9 % mid-fade at its hour). Across a table the brightness alone shows who woke at each hour (and so who is alone, who is the thief, and when the cheese went). During 「共犯 · 大盜揀人」, a step title every phone shows, exactly one phone lights: the thief's. At 「共犯 · 認人」 two phones light: thief + follower. The 「唔關你事」 vs 「你係大盜」 panel text p3 flagged is unreadable at 95 % dim; brightness is the real leak. 語音 / 讀稿 are unaffected because eyes are closed. | `js/ui/screens/play.js:539-540` lifts the dim for `focus` seats in every narration mode; `css/base.css:1177-1185` (`.night-dim` 95 %). Known open request: `docs/games/cheese-thief.md` §8 #8. | In 靜音 mode use **one** night level for every seat at every step: either no focus-based lift with a uniform partial dim that the owner can read up close, or lift **every** seat during each `open` / `rec-*` window, since the screens are already glance-identical. Also drop the 「閉 眼」 overlay title so a lit phone and a dimmed one do not differ. Until then, the 靜音 help line should state the trade-off. | `js/ui/screens/play.js`, `js/ui/shell.js`, `css/base.css` |
| 2 | minor | text | Results heading reads 「芝士大盜 — 贏家」 when the thief lost | The shell results hero writes `${emoji} ${game name} — 贏家`. The game's name is also the thief's role name, so the biggest line on the screen says "Cheese Thief — winners" right after the thief was caught (shot p3-011). Reported by p1 and p3. | `js/ui/screens/results.js:240-244` | Make the hero a result, e.g. 「🏆 贏家」 with the game name as a small kicker line, or lead with `res.summary`. | `js/ui/screens/results.js` |
| 3 | minor | ux | A seated host's 下一步 ⏭ sits right under the big 👆 button at night | In 語音 / 讀稿 the NarratorBar is fixed at the bottom all night, above the dim (z-index 65). A seated host taps 👆 every step with eyes closed (語音), so a stray tap on 下一步 ends the current window for everyone and can cut a lone peeker's hour short. In 靜音 the bar shows only during cues, so the risk is lower there. p1 saw controls [12] ⏸ and [13] 下一步 ⏭ just below 👆. It is not a role tell: the host's layout is the same at every step. | `js/ui/screens/play.js:434` (bar shown for a host at night unless silent), `:461` (`onNext` always wired); `js/ui/components/NarratorBar.js:61` | For a **seated** host at night outside 讀稿: hide 下一步 during a window, or make it hold-to-confirm. Keep it plain in 讀稿 (flow doc §8 #5). | `js/ui/screens/play.js`, `js/ui/components/NarratorBar.js` |
| 4 | minor | tell | Your vote is printed large on your own screen before the reveal | The rules make the vote simultaneous ("3, 2, 1, point"), and the research doc says votes stay secret until all are in. On a phone, the confirm button reads 「確定投俾 大熊」 and after voting the panel reads 「你投咗 大熊 ✓」. A neighbour can read either at a glance and, since 改票 is allowed until the last vote, react to it. Not reported by players. | `js/ui/components/VotePanel.js:95` and `:105` (name in the strong / button text) | For hidden-role games add a VotePanel option (e.g. `secretChoice`): the button reads 「確定投票」 and the voted state 「已投 ✓」, with the chosen name only on the highlighted row or under a hold. | `js/ui/components/VotePanel.js`, `js/games/cheese-thief/ui.js` |
| 5 | polish | a11y | Die value exists only as drawn pips | `dieFace(v, 6)` draws pips with no text or label, so a screen reader, a text console or a quick glance at a 5 vs a 6 gets no number. Reported by p1, p2 and p3. | `js/ui/dom.js:109-113` | Add `role="img"` and `aria-label="N 點"`, but only on a face that is actually shown. The cup and night covers keep the face in the DOM while covered, so set the label when the cover opens (or have `Cover` mark its closed front `aria-hidden`). | `js/ui/dom.js`, `js/ui/components/Cover.js` |
| 6 | polish | ux | A missed peek result vanishes with no pointer to 📓 | The peek is three steps (tap a name, tap 👆, hold 「㩒住睇 X 粒骰」), all inside the hour. When the window closes, the cover goes and nothing says the value is saved. p3 only found it later in 📓. A first-timer on the official 10 s hour could do the same. | `js/games/cheese-thief/ui.js:478-491` (`peekWrap` hidden once `nightSeat.awake` is false) and `:287-288` (peek instructions) | Add one short line with the peek instructions or under the cover: 「睇唔切唔緊要：天光喺 📓 夜晚記錄睇得返」. It is the same for every peeker, so it carries no tell. | `js/games/cheese-thief/ui.js` |

## Rejected findings

| reported by | claim | why rejected |
|---|---|---|
| p5 (blocker) | Recruited as follower but never told | **AI-artifact.** The engine told p5: `informed = ['p5']`, note `{k:'follower', thief:'p4'}`. At `rec-meet` the focus was `['p4','p5']`, so p5's phone was lit for 7.5 s with 「🤝 你係共犯！ 大盜係 大熊。」. From dawn the card front read 「🤝 共犯 — 大盜係 大熊。…」 (`roleFor`, `ui.js:46-58`) and 📓 read 「你係共犯！大盜係 大熊。」. Both were recomputed from the final state. The same 🔁 line under every card asks everyone to re-check. |
| p5 (major) | No mutual recognition with the thief | Same evidence as above: `nightFor` gives p5 `meet:{thief:'p4'}` and gives p4 「你嘅共犯：阿強」. |
| p5 (major) | Dawn card re-check should show 共犯 | It does (`my.follower = true`, `my.crew = {thief:'p4'}` → card 「🤝 共犯」). |
| p5 (minor) | 「唔關你事，繼續閉眼」 misleads a follower | App-is-right. During `rec-pick` the follower is not involved yet (official 6p script: the thief picks first, then the picked player opens their eyes). At `rec-meet` its screen switches to 你係共犯. |
| p5 (minor) | Potential leak if follower status were shown | Speculative; no defect. |
| p2 (major) | Peek at 阿聰 at hour 3 lost / not recorded | **AI-artifact.** No `peek` action ever reached the engine (`peeked` holds only p3). p2 was alone at hour 3, so a peek inside the window would have been accepted (`canPeek`). The hour-3 window was ≈ 17:24:55–17:25:10, and p2's next screenshot (17:25:20) already shows hour 4's cue. The taps landed after the window, when the selection resets and 👆 is a plain ack. |
| p2 (minor) | 5p "follower step" violates official rules | App-is-right. The host enabled 家規 `pick5`, which "replaces the official 5p witness rule with the 6p night-end step" (flow doc §2.1). The lobby summary and warning label it as a house rule. |
| p2 (minor) | Ready-to-vote UI ambiguous | The button already says 「✓ 我夠鐘投票 — 等緊其他人（㩒一下取消）」 and the counter shows x / 5. There is no concrete defect. |
| p2 (polish) | Hold prints no die value in text | Merged into #5. The rest is a limit of the console tool. |
| p1 (minor) | Vote opened after ≈ 1m50s although not everyone was ready | **AI-artifact / misread.** The vote opened on the 5:00 timer: day start ≈ 17:27:04, deadline ≈ 17:32:04, vote screen at 17:32:08. p1's 「想投票：0 / 5」 snapshot was minutes older than its failed tap. The on-screen promise 「全部人都想先會開始，或者時間到」 held. |
| p1 (minor) | Night dim darkens progressively, 27 % → 49 % → 95 % | App-is-right. Those readings are samples of the 1 s opacity fade-in (`css/base.css:1183`). The dim does lift at your own hour (p3: 95 % → 9 %), as 「到你個鐘佢會亮」 promises. |
| p1 (minor) | Hour windows too short (12–15 s) | AI-artifact. Each window was exactly `hourSec` = 15 s, longer than the official 10 s (research: "Window length … 10 s"). p1 missed its own hour 1 because it was reading a screenshot. The 📓 fallback worked. |
| p1 (polish) | Host's extra controls at night are a tell | Not a role tell: the host is public and its layout is the same at every step. The mis-tap part is kept as #3. |
| p3 (minor) | Peek flow too tight in 15 s | Mostly AI latency (three console round trips). The part a slow human would hit is kept as #6. |
| p3 (minor) | 「唔關你事」 on the 共犯 steps marks the uninvolved phones | Merged into #1. The panel text cannot be read through a 95 % dim, so the leak is brightness. The layout and classes are identical by design and pinned by the glance test. |
| p3 (polish) | 「冇人睇到」 vs 「冇人醒」 wording | App-is-right. They state different facts: nobody watched the theft, and nobody woke that hour. Both are accurate. |
| p1, p3 (polish) | Results heading | Kept as #2. |

## AI-artifact notes (only an AI's speed or tooling would hit these)

- **Console latency vs 15 s windows.** Each `see` / `tap` / `shot` is a separate round trip with model thinking in between. p1 missed its own hour 1 live, p2's peek taps landed after hour 3 closed, p3 never held its peek cover, and p5 missed the 7.5 s `rec-meet`. In every case the app's fallback (📓 recap, card front) held the information. A human holding the phone does each of these in 1–3 s.
- **p5 never read its card or 📓 after dawn.** It deduced 大熊 independently and voted against its own thief. A human following the 🔁 re-check line would have seen 「🤝 共犯 — 大盜係 大熊」.
- **p1's "re-read my die at hour 2".** `pt hold` prints DOM text, so p1 "saw" the pip through a 95 % dim. A human sees almost nothing (shot p1-004). Reading your die between your own hours on a dimmed phone is the optional flow-doc request §8 #10 and not a rules right (the official game has no mid-night look at your own cup).
- **Dim percentages** (27 / 49 / 9 %) are mid-transition samples of the `.night-dim` opacity fades, not separate levels.

## Rights checklists, merged per role

**🐭 貪瞓鼠** (p1 阿聰, p2 阿明, p3 小美; p5 阿強 until recruited)

| right (verified rules) | result | evidence |
|---|---|---|
| Secret role card, hold-to-peek, with 做乜 / 點贏 | ✓ | p1, p3, p5 |
| Roll once, privately, no re-roll; cup above the card | ✓ | cup locks after the roll (🔒, 「搖唔到新骰」); cup above the card on roll and day screens (p1-001, p3-001, p3-008) |
| Wake at your hour; see who else is awake; cheese state shown automatically | ✓ | p3 h2 「淨係得你醒…芝士仲喺枱上」; p1 / p5 h1 together; p2 h3 alone |
| Lone sleepyhead peeks at one other die, once, never at self; target not told | ✓ | p3 peeked 阿聰 = 1 (state + recap). p2 had the right but its taps were late (AI). |
| No peek when someone else is awake | ✓ | p5: 「有人同你一齊醒，今次唔可以偷睇」 |
| Sleeping phones identical, every hour the same length | ✓ in layout and timing; ✗ in brightness in 靜音 (#1) | windows 15 s each, empty or not |
| Not told about the follower pick unless involved | ✓ | 共犯 steps show 唔關你事 to the uninvolved |
| Dawn re-check under the card, same on every phone | ✓ | p1, p3; turns 「✓ 睇咗」 after lifting |
| Private 📓 night log | ✓ | p1, p3 (holds the peek result) |
| Free discussion, may lie, may not show card or die | ✓ | rule line on screen; 5:00 timer |
| One simultaneous vote on another player; no self-vote, no abstain | ✓ (choice visible on own screen, #4) | self excluded; 改票 until last vote |
| Win if the thief is in the top set | ✓ | 大熊 4 votes → 貪瞓鼠贏, +1 each |

**🤝 共犯** (p5 阿強, recruited by the `pick5` 家規)

| right | result | evidence |
|---|---|---|
| Learn you are a follower, and (6p script) who the thief is | ✓ in the app; missed by the AI | `rec-meet` lit p5 with 「你係共犯！大盜係 大熊」; card front and 📓 from dawn |
| Thief knows you | ✓ | p4 rec-meet 「你嘅共犯：阿強」, card 「你嘅共犯：阿強」 |
| Win and lose with the thief, even if voted | ✓ | lost with 大熊 (「共犯 阿強 跟大盜一齊輸」) |
| No channel to pass dice info | ✓ | none exists |
| Not readable at a glance | ✓ in the day (only on the card front); ✗ at night in 靜音 (#1: the phone lights at 認人) | |

**🧀 芝士大盜** (p4 大熊)

| right | result | evidence |
|---|---|---|
| Must steal at its hour; witnesses always see it | ✓ | automatic at hour 5 window open; no witnesses |
| No peek | ✓ | thief gets `peek.mode = off` |
| Pick 1 follower from anyone after hour six (家規 `pick5`) and meet them | ✓ | picked 阿強; 認人 step |
| Followers shown on its own card | ✓ | 「你嘅共犯：阿強」 |
| Not identifiable at a glance at night | ✗ in 靜音 (#1: only lit phone during 「共犯 · 大盜揀人」) | |
| Win if not in the top set | ✓ (lost: 4 votes) | |
