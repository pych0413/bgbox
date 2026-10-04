# 瞎掰王 9upper (`9upper`): multi-agent playtest re-run (after fix rounds 1 and 2)

Session `mp2-9upper` ran from 2026-10-03 23:30 UTC to 2026-10-04 00:17 UTC (about 47 min) against `http://localhost:5199/`. Four AI players each drove one headless phone (390×844). The served `js/games/9upper/{game,ui,script}.js` and `js/ui/screens/play.js` hash-match the working tree, which holds the uncommitted round-2 fixes on branch `v2`. Every line number below refers to that working tree.

Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊. Config (`room.config`): preset **快玩** (4 rounds), `levelMode` mix, `readSecs` 9, `speakOrder` **judge (諗樣揀)**, `speakSecs` 0, 1 收皮啦 per round, no `passPhone`, `rePeek`, `scoreFloor` or `antiStreak`, all categories. Narration was **靜音**.

Evidence used: the table chat (`pt hear`); the host engine state (`__app._room.session.state.history`) and `room.lastResult`; all 20 screenshots (`%TEMP%/bgbox-playtest-shots/mp2-9upper/`); the code; `docs/games/9upper.md`; and `docs/research/9upper.md`. `node tests/run.mjs 9upper`: **95 passed, 0 failed**.

## Verdict

**The game finished.** All 4 rounds were played and every seat reached the results screen. Final scores: 小美 8 and 大熊 8 (shared win), 阿明 6, 阿聰 0.

**Rules and scoring were correct in every round.** The engine history matches the research doc on every point:
- the 諗樣 rotated p3 → p4 → p1 → p2;
- exactly one honest player each round;
- D scored for 諗樣 + 老實人 on a correct pick, and for the picked 9upper on a wrong pick;
- in R3, 收皮啦 on the honest player cost −3;
- ties are shared.

**No blocker and no major issue.** Run 1's major dead end (an idle 諗樣 in 揀人 with no void) is fixed in the code but did not come up live. Run 1 had 13 findings: 10 are fixed (7 seen working live, 3 only in code), 1 is not fixed, 1 is unchanged and 1 is fixed with a gap left over (table below).

**New confirmed findings: 2 minor and 7 polish.** The minor ones:
- When the 3 swaps run out, 我識呢條 stays on screen but does nothing.
- In 諗樣揀 mode the phone has already chosen the first speaker and moves on by itself, while the 諗樣's screen says 「次序由你話事」.

**Most of the reported noise comes from the AI seats.** Three of the four honest players missed the 9-second peek (R1–R3) because of 7–8 s console round-trips, and an LLM "knows" wasta, pantofolaio and Cygnus X-1. Together these made several rounds coin-flips. That says more about the harness than about the bank.

## Round log (engine history)

| R | 諗樣 | term (D) | swaps | first speaker (app) | 老實人 | pick | 收皮啦 | deltas |
|---|---|---|---|---|---|---|---|---|
| 1 | 小美 | 屯門 (2) | 0 | 阿聰 | 大熊 (missed peek, late open) | 大熊 ✅ | none | 小美 +2, 大熊 +2 |
| 2 | 大熊 | 扮鬼臉大賽 (3) | 1 (wasta) | 阿明 | 小美 (missed peek, late open) | 阿明 ❌ | none | 阿明 +3 |
| 3 | 阿聰 | 天鵝座X-1 (3) | 3 (收穫月, pantofolaio, 通勝) | 大熊 | 阿明 (never opened) | 大熊 ❌ | 阿明 (honest) | 阿聰 −3, 大熊 +3 |
| 4 | 阿明 | 枵腹 (3) | 3 (幽靈震動症候群, 著草, 倫敦大惡臭) | 大熊 | 大熊 (read in time) | 小美 ❌ | none | 小美 +3 |

## Run 1 findings: status now

| run-1 # | title | status | evidence |
|---|---|---|---|
| 1 (major) | Idle 諗樣 blocks 揀人; 呢輪作廢 unsupported | **Fixed in code, not exercised** | `game.js:640-664` (`voidRound`, `voidHow`), `:685-712` (💤), `:1101-1111` (`blocking`), `room.js:1484-1500` (connected-but-idle seats listed under 無反應), host ⋯ has 🗑️ 呢輪作廢 / 💤 (`play.js:452-455`) |
| 2 | Only the honest card held a paragraph | **Fixed, seen live** | 諗樣 peek 「你張卡冇解釋。等陣追問細節…」 (p1, p2); 9upper card 「「枵腹」：諗定一個來源…」 (p3); `script.js:47-69`, `ui.js:178-195` |
| 3 | Missed read still told 「你睇過真正解釋喇」; silent start | **Fixed, with a gap** | p2 (R3, never opened) got 「你冇打開到張卡，問到就答「張卡冇寫」」; sound + flash `ui.js:432-435`. The gap is new finding #4 (a sub-second late open counts as read) |
| 4 | Skipped speaker shown ✅ 已講 | **Fixed in code, not exercised** | `game.js:498-517` (`skipped`, `back`), `ui.js:544-558` (⏭ 跳過咗 · 叫返佢) |
| 5 | 收皮啦 confirm hid the name; order differed | **Fixed, seen live** | 「確定收皮 阿明？」 (p1); chips in seat order inside a red box (shots p2-003, p4-004) |
| 6 | Raw percent-encoded source | **Fixed, seen live** | 「維基百科：屯門」, 「Wikipedia：Cygnus X-1」, 「萌典：枵腹從公」 |
| 7 | Reveal did not name the 9uppers | **Fixed, seen live** | 「🤥 9upper：阿聰、阿明」 (shot p1-001) |
| 8 | 換題 had no notice | **Fixed, seen live** | 「🔄 換咗題（仲可以換 2 次）」 / 「（唔可以再換）」 |
| 9 | Waiting screen did not say questions can continue | **Fixed, seen live** | 「諗樣仲可以追問，大家都可以互相質疑。」 |
| 10 | Header 「輪到你」 sits on the 諗樣 while someone else speaks | **Not fixed** | Shot p4-004: 大熊's header shows 輪到你 while 阿明 is 🎤 講緊. `game.js:1086-1087` still returns `[judge]` in `explain`. Carried over as new finding #3 |
| 11 | Host's inline 下一步 strip vanishes in 靜音 | **Unchanged** (⏭ still only in ⋯) | `play.js:562`. Not needed this run |
| 12 | Only the 諗樣 could start a 換題 | **Fixed, seen live, used heavily** | 我識呢條 flags 「🙋 阿聰、阿明、小美 話識 · 換題（仲有 3 次）」. A new edge case is finding #1 |
| 13 | Room code only in pips | **Fixed in code** | `lobby.js:489-491` (digit under each die) |

## Confirmed findings (this run)

| # | sev | category | title | detail | root cause | fix | owner files |
|---|---|---|---|---|---|---|---|
| 1 | minor | flow / dead end | Once the 3 swaps are used up, 我識呢條 still shows and does nothing, the 諗樣 can no longer see the flags, and there is no clean way out | R3 and R4 each used all 3 swaps. Each then played a term that 2–3 players had flagged (天鵝座X-1, 枵腹). The table had to improvise 「照玩定作廢」 out loud. (1) 玩家 phones still show 🙋 我識呢條, and the engine still accepts `know`, but nothing can happen. p2 tapped it and only saw 「已話咗識（再㩒取消）」. (2) The flags are drawn only inside the 換題 button's label, and that button is hidden at the cap, so the 諗樣 no longer sees who flagged. (3) The host's 🗑️ 呢輪作廢 in `term` treats the 諗樣 as the stuck seat. It hands the seat to the next player and defers the 諗樣 to the end of the lap, which is wrong for "everyone knows this term". The cap is the app's own invention: the rulebook just says "redraw" (research step 3). Since D5 lets players flag terms, the cap now binds on swaps made in good faith. How often this happens was inflated by AI knowledge, but the dead button is real at any frequency. | `game.js:19` (`MAX_SWAPS = 3`); `:856` (swap refused at cap even when flagged); `:862-871` (`know` accepted at cap); `ui.js:365-370,391-396` (know button always shown); `ui.js:387` (the swap button, the only place flags render, hidden when `!canSwap`); `game.js:659-664` (`voidHow` → `stuck` in `term`) | (a) A swap made while at least one 玩家 has flagged 我識呢條 does not count toward the cap; keep the cap only for unflagged swaps (the fishing case). Alternatively raise the cap to 5. (b) When `swapsLeft === 0`, hide 我識呢條 on 玩家 phones, show one public line on every phone, 「換題次數用晒：照玩」, and still show the flag names to the 諗樣 as plain text. (c) Optional: a void in `term` with flags present → `redeal` (same 諗樣) | `js/games/9upper/game.js`, `js/games/9upper/ui.js` |
| 2 | minor | wording / rule fidelity | In 諗樣揀 mode the phone has already picked the first speaker and moves on by itself, while the 諗樣's screen says 「次序由你話事」 | All four seats reported it. The explain step opens with a random 玩家 already 🎤 講緊 (R1 阿聰, R2 阿明, R3 and R4 大熊; shot p4-004) before the 諗樣 taps anything. Each 我講完 hands the floor to the next player in the queue, and the last one drops everybody into 揀人 without notice; p4's 我決定咗 tap missed because the screen had already changed. The judge's note reads 「㩒名叫佢講，次序由你話事」. In 靜音, the only line that says the phone chose (the cue 「由阿B開始解釋」) is never spoken. The rulebook says the 諗樣 invites players in any order. The app does honour that through `call`: tapping another name moves the floor, and the interrupted speaker goes back to waiting (p4 saw this). The flow doc calls the queue "a suggestion". So the behaviour is as designed, but the screen contradicts it, and every 諗樣 simply followed the app. | `game.js:466` (`startExplain`: `speaker = nextUp(s)` in `judge` mode); `:508-516` (`endTurn` → next in queue, `toJudge` when none); `ui.js:497-500` (judge note) | Smallest fix (copy only): in 諗樣揀, the judge note becomes 「電話揀咗 {first} 先講；想叫其他人就㩒佢個名。最後一位講完就去揀人。」 Rulebook-pure alternative: in `judge` mode start with `speaker = null` and a single line 「㩒名叫第一位講」. After that, a 我講完 hands the floor to nobody until the 諗樣 taps, and the move to 揀人 stays the 諗樣's own 我決定咗 (or happens once all have spoken, with a toast) | `js/games/9upper/ui.js` (or `game.js` for the alternative) |
| 3 | polish | ux | Header 「輪到你」 sits on the 諗樣 while someone else is speaking (run 1 #10, not fixed) | Shot p4-004: 大熊 (諗樣) has 輪到你 in the header while 阿明 is 🎤 講緊. The real speaker has no pill. | `game.js:1086-1087` (`focus` → `[judge]` in `explain`); `play.js:616` (`turnBadge` reads `focus`) | In `explain` without `passPhone`, return `{ pids: [speaker] }` when someone has the floor, and `[judge]` otherwise. Stall detection now uses `blocking()`, so `focus` only drives the badge and the PassGate | `js/games/9upper/game.js` |
| 4 | polish | ux / honesty of the card | A sub-second open at the very end of the window counts as "read", so the reminder still says 「你睇過真正解釋喇」 | p4 (honest in R1) and p3 (honest in R2) pressed the card at about 0:00. The window closed while they held it, so they never read the text, yet the reminder said 「你睇過真正解釋喇」. p2 (R3), who never opened the card, correctly got 「你冇打開到張卡」. So the run-1 fix works, but any `onOpen(true)` counts. Separately, p2 read the explain-phase cover label 「㩒住睇返我係咩」 as "you can still see the card". | `ui.js:417` (`readLog` set true on any open); `ui.js:187-190`; `ui.js:477,589` (cover label) | Measure the time open inside the window with `onOpen(true/false)` (`Cover.js:95,149`), and count the card as read only after about 2 s in total. Alternatively use neutral wording that is true either way: 「張卡已經冚咗：用自己嘅講法講，唔記得就話「張卡冇寫」。」. Cover label after the window: 「㩒住睇返身份」 | `js/games/9upper/ui.js` |
| 5 | polish | reveal | The reveal does not say which level-2 hint was the true one, and the headline keeps its 「…」 | The term card still shows 「粵語俚語由來／香港冷知識／奇怪動物（三揀一）」 above the reveal, but nothing marks 香港冷知識 as the real category (p1, p2). `rv.cat` is already in the view. The headline 「小美 揀咗 大熊…」 keeps its ellipsis after the 1.2 s beat, so the screen looks like it is still waiting (shots p1-001, p1-002). | `ui.js:651` (headline); `ui.js:653-657` (truth card has no category); `script.js:290-309` (`roundBlock`, same); `game.js:1048` (`cat` in view) | In the truth card, for levels 1–2, add 「✔ 啱嘅提示：香港冷知識」, and add the same line to `roundBlock`. Drop the 「…」 once `.g9-reveal-late` has appeared (or write 「小美 揀咗 大熊 →」) | `js/games/9upper/ui.js`, `js/games/9upper/script.js` |
| 6 | polish | copy | Decoy coaching does not fit word-type terms, and the 9upper prompt pushes numbers the cards rarely have | 諗樣 decoy: 「幾時開始有？邊個整出嚟？」 was shown for 枵腹, a plain word (p2). 9upper decoy: 「諗定一個來源、一個例子同一個數字」. 小美 followed it in R4 (玄枵) and was singled out for it, and most cards hold no number. That makes the prompt bad bluffing advice next to an honest 「張卡冇寫」. | `script.js:47-55` (`judgeDecoy`); `script.js:58-69` (`bluffDecoy`) | Make the prompts fit any term type: 諗樣 「問佢哋：喺邊度見過？點用？點解叫呢個名？」. For 9upper, drop "一個數字", or say 「細節唔好作得太盡，卡通常得一兩句」. Keep the lengths (anti-tell) | `js/games/9upper/script.js` |
| 7 | polish | content | Some cards give themselves away or read as translations | (1) Some cards can be answered from the term alone. 屯門 (L2) is 「屯兵之門」, which every bluffer derived from the characters. 幽靈震動症候群 (L1) names its own meaning. 通勝 (L1) is common HK knowledge. 枵腹 (L3) is a dictionary gloss: anyone who knows 枵 gives the card word for word. (2) Two texts read as translations. 扮鬼臉大賽: 「埃格勒蒙特蟹市集…馬頸圈」. The Egremont Crab Fair is named after crab apples, so 蟹市集 is a mistranslation (check against Wikipedia, *Egremont Crab Fair*), and HK readers would say 馬軛. 天鵝座X-1: 「首個被廣泛接受係黑洞嘅天體」 should be 「首個被廣泛認為係黑洞嘅天體」. Most of the "the whole table knew it" complaints are an AI artifact (see Rejected). | `js/data/9upper-terms.js:676` (屯門), `:442` (幽靈震動症候群), `:103` (通勝), `:19` (枵腹), `:594` (扮鬼臉大賽), `:346` (天鵝座X-1) | A content pass. Flag terms whose characters spell out the answer and either drop them or move them to L1. Fix the two texts. Optionally add a validator rule: the explanation must not just restate the term's characters | `js/data/9upper-terms.js` |
| 8 | polish | shell | The ⋯ 選項 sheet has no ✕ and ignores Escape | p3 and p4 thought the sheet was stuck. Only a tap on the backdrop closes it (shots p3-004, p4-002). `RulesSheet` and `sheet.js` both have a ✕, and `RulesSheet` also closes on Escape. | `play.js:361-372` (`openMenu`: backdrop `pointerdown` only) | Add a ✕ to the sheet header and an Escape `keydown` listener, the same way `RulesSheet.js:58,76` does | `js/ui/screens/play.js` |
| 9 | polish | shell | The host's header cuts the subtitle to 「阿聰 …」 | The host phone has 5 header icons (💡 📖 ⏱ ⏸ ⋯). Together with the 輪到你 pill, 「阿聰 做諗樣」 is cut to 「阿聰 …」 at 390 px (shot p1-002). Found in a screenshot, not reported by players. | `play.js:613-620` (header row) | Fold ⏱ into ⋯ on narrow screens, or let the subtitle wrap under the title | `js/ui/screens/play.js`, `css/base.css` |

## Rejected findings

| reported by | claim | why |
|---|---|---|
| p2, p3, p4 (medium/major) | The 9 s peek leaves a slow honest player with no recovery | **AI artifact.** Three of four honest players missed the window because each console round-trip took 7–8 s; p1 measured his holds landing at 0:01–0:02. The window starts with the same `deal` sound and screen flash on every phone (`ui.js:432-435`). The rulebook allows exactly one 9 s look with no re-read (research "Timing"), and `rePeek` is offered as a lenient setting. A table that really lost the card has the host's 🗑️ 呢輪作廢, which redeals with the same 諗樣 during `read`/`explain` (`game.js:659-664`). The real remainder is #4. |
| p1, p3, p4 (medium) | The term bank is too well known | **Mostly AI artifact.** A language model "knows" wasta, pantofolaio, Cygnus X-1, 收穫月, 倫敦大惡臭 and 幽靈震動症候群; a typical HK table does not. The bank has 782 entries, of which 314 are L3, and run 1 already rejected the same claim. The real parts are #1 (swap cap) and #7 (a few self-revealing cards). |
| p1, p2, p4 | The two-tap confirm (3 s) expires too fast | **AI artifact** (same as run 1). A thumb double-taps in under a second, and the armed label names the target. The misses were console round-trips (`ui.js:226,293`). |
| p1, p2, p3, p4 | The 收皮啦 row is easy to confuse with the pick row and has no confirm | **App is right.** There is a confirm: 「確定收皮 阿明？」 (`ui.js:281-293`), which p1 used. The chips sit in a red-outlined box under the picker (`style.css:137`; shots p2-003, p4-004). The two rows look identical only in the console's flattened list of controls. The stakes sit behind 💡 by design (the user wants help only on demand). Optional: append 「（中老實人 −3）」 to the armed label only. |
| p1 | The hint sheet's ✕ is named 「閂咗佢」 | **App is right / console artifact.** An `aria-label` on an icon button is correct practice (`sheet.js:20`); the console matches buttons by accessible name. |
| p2, p3, p4 (info/low) | Guest phones have no 呢輪作廢 or stall control | **App is right.** These are host tools (⋯: ⏭ 跳過呢步, 🗑️ 呢輪作廢, 💤, and the 無反應 list, `play.js:451-478`), and 📖 「有人唔喺度」 documents them (`game.js:121-124`). Nobody stalled. |
| p4 | A called-over speaker went back to 👉 叫佢講 instead of ✅ | **App is right.** An interrupted speaker goes back to waiting (flow doc §3.4). |
| p3, p4 | The step jumped to 揀人 without the 諗樣 | **By design** (§3.4: the last speaker ends `explain`; the pick screen says 「揀之前仲可以繼續問」). The missing notice is folded into #2. |
| p2 | The swap notice vanished when I tapped 我識呢條 | **Coincidence.** The 🔄 notice hides itself after 4 s (`ui.js:120`). The real issue (a dead button at the cap) is #1. |
| p2 | The results table is hard to read | **Console artifact.** It renders cleanly (shot p1-003). |
| p1, p2 | `hold` printed the next phase / the timer read 0:01 | **Console artifact** (the print timing and latency of `hold`). |

## AI-artifact notes

- **Most honest players missed their peek** (R1 大熊, R2 小美, R3 阿明). Only R4 had an informed honest player. Rounds 1–3 were therefore judged between bluffers who all guessed, which is why all four reports call the picks "coin flips". Treat the content verdict from this run with care.
- **Knowledge inflation.** Players flagged 我識呢條 on 8 of 12 terms drawn. In a human HK table, perhaps 通勝, 著草, 屯門 and 幽靈震動症候群 would be known; wasta, pantofolaio, 天鵝座X-1 and 倫敦大惡臭 mostly would not.
- **The 3 s double-tap** needs both taps in one console command (same as run 1).

## Rights check (merged)

| role | right | result |
|---|---|---|
| 🧠 諗樣 | Public identity, holds the callout card; never sees the explanation; holds a decoy card of the same shape during the peek | ✓ (p1, p2, p4 quotes) |
| 🧠 諗樣 | Redraw a known term before the peek | ✓ up to 3; ✗ after the cap (#1) |
| 🧠 諗樣 | Invite players in any order | ✓ via `call`, but the screen pre-picks and contradicts its own note (#2) |
| 🧠 諗樣 | Accuse at any time; 收皮啦 once, public, settled at the reveal; −3 on the honest player | ✓ (R3) |
| 🙋 老實人 | The only phone that ever gets the explanation; same card shape; one look | ✓ (R4 大熊 read it; leak tests pass) |
| 🙋 老實人 | Honest message if the card was missed | ✓ for a card never opened (p2 R3); ✗ for a sub-second late open (#4) |
| 🤥 9upper | Sees only the public term and hint; +D when picked by mistake | ✓ (R2 阿明, R3 大熊, R4 小美 +3 each) |
| 👑 房主 | ⏸, ⏭, 🗑️ 呢輪作廢, 💤, connection list | present in ⋯ (`play.js:451-455`), not needed this run |
