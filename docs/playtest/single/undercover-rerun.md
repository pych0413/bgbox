# 誰是臥底 (undercover): one-phone re-run review

> Session `sp2-undercover`, `--shared` (one phone, 5 seats), 2026-10-04 16:10–16:27 UTC, local build at HEAD `328b04f`
> (the one-phone fixes: table mode, public and private gates, the phone to the middle, co-wakers, gate escape; DESIGN §7.1).
> Config: std preset (平民 4 · 臥底 1, parity, PK all, no timers), narration 🔊 語音.
> Seats: p1 阿聰 (host), p2 阿明, p3 小美, p4 大熊, p5 阿強. Reviewer: opus, read-only (no code edited). Table stopped.

## Verdict

**Finished: round 2, civilians won, about 15 minutes. The one-phone flow now holds.**
- **All eight run-1 findings (C1–C8) are fixed.** Some were seen in this run, some confirmed in code:
  - The phone goes to the middle after the deal, the vote and the result, behind 「部手機擺返中間」.
  - Every private step is gated, the first ballot included.
  - The table screen carries nothing private.
  - The deal cue is device-neutral.

**One real major is left, and it is new.**
- The shared 「X 講完喇 ▸」 table button is rebuilt at once, in the same place, for the next speaker, with no lockout and no undo.
- In a local room the screen redraws before a second tap lands. So a double tap, or two people tapping together, also ends the next speaker's turn.
- **5 of 9 clue turns** ended before the speaker had said anything. The console's partial-label taps inflated that count (TT1). But the 1-second double advances are exactly what a human table produces.

## Facts from the table

| | |
|---|---|
| Words / roles | 平民 金魚: 阿明, 小美, 大熊, 阿強 · 臥底 鯉魚: 阿聰 (category 動物) |
| Deal | Private gates in the order 阿聰 → 阿明 → 小美 → 大熊 → 阿強, hold-to-peek, relock after 記住喇. Then the table card. |
| R1 speak (starter 阿明) | 阿明 clue 16:14:00 → narrator 輪到 小美 16:14:05, 大熊 16:14:08, 阿強 16:14:10 (小美 and 大熊 skipped). 阿強's own turn 16:14:46. 輪到 阿聰 16:15:57 → 大家都講完喇 16:15:58 (阿聰 skipped). 大熊 16:14:26, 小美 16:14:32 and 阿聰 16:16:34 gave their clues out of turn. |
| R1 vote | Opened 16:16:58. Gates went 阿強 → 阿聰 (搞掂 1/5) → 阿明 → 小美 → 大熊. Result 16:21:07: **阿強 out (平民, 3 votes)**, 阿聰 2. |
| R2 speak (starter 小美) | 16:21:33 由 小美 開始 → 輪到 大熊 16:21:35 → 輪到 阿聰 16:21:36 (小美 and 大熊 skipped). 阿聰 16:21:46, 阿明 16:22:22. 小美 gave her clue late (16:22:04). **大熊's R2 clue was never given.** |
| R2 vote | Opened 16:24:16. Gates went 大熊 → 阿聰 1/4 → 阿明 → 小美. Result 16:26:36: **阿聰 out (臥底, 3 votes)** → `allOut`. |
| Final (`lastResult`) | 平民贏, winners p2–p5, +2 each. Lines include 「平民投走咗 1 個自己人：阿強。」 and 「佢一開始都唔知自己係臥底」. The results screen has no 「（你）」 (p3-004.png). |
| State at review | `phase: results`, `activeSeat: null`, `focus: null`. |

## Fixed since run 1 (`docs/playtest/single/undercover.md`)

| run-1 | finding | now |
|---|---|---|
| C1 | After the deal the phone stayed on the last seat dealt | **Fixed.** The table card 「📱 部手機擺返中間 · 大家一齊睇」 appears after the deal, and the speak screen is the public table view with the chip 「📱 枱中間 — 㩒你個名睇自己」 (p5-001.png). |
| C2 | The vote result opened on the last voter's screen, and their 睇完 closed it for everyone | **Fixed.** The result goes to the middle behind the table card, and 大家睇完 stays locked until the card is dismissed (U5, p1-002.png). Every player read the tally. |
| C3 | The first ballot after a public step had no gate | **Fixed** (play.js:640-660; tests/undercover.test.mjs:2749). 阿強 (R1) and 大熊 (R2) were gated; p1's own gate read 「搞掂 1/5」. |
| C4 | 「用自己部手機」 in the cue and rules | **Fixed.** The cue at 16:11:26 was 「逐個睇自己個詞，記住就㩒「記住喇」」, and the rules at game.js:128 are neutral. |
| C5 | 「冇投錯」 was false | **Fixed in code** (game.js:1176-1180). Not exercised, because a civilian went out. |
| C6 | 「睇返我個詞」 on the public screen | **Fixed in code.** It now goes askWho → private switch gate → 📱 睇完 · 擺返中間 (ui.js:670-700, tested). Not used in this match. |
| C7 | 「（你）」 on the shared scoreboard | **Fixed** (results.js:287, lobby.js:533). |
| C8 | The gate did not say which step it opens | **Fixed.** 「交俾 X · 其他人唔好望 · 睇詞語 · 搞掂 N/5」 and 「第 N 輪投票」. |
| run-1 rejected / U5 | 開始投票 was one tap on a whole-table phone | Now two taps (arm then confirm), as decided. |
| T1–T4 | Console: public steps hidden, `wait` deaf to changes, 120 s cap, 靜音 | **Fixed.** The table is face up for every seat, `wait` wakes on chat and changes, `WAIT_MAX_S = 90`, and voice narration is echoed to `hear` as 🔊 旁白. |

## Still open

- **The speaking round still loses clue turns.** In run 1 the AI holder tapped through four turns (4 of 5 lost). In this run several seats tapped the shared table button (5 of 9 lost). The cause is new (N1 below): the table button has no protection against a second tap, and the engine has no undo.
- Nothing else from run 1's undercover list is open.

## New confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| N1 | **major** | one-phone flow / rules | 「X 講完喇 ▸」 double-advances: a double tap or two people tapping together skip the next speaker, and there is no undo | Anyone may tap it (§4, rules game.js:174). After an advance the button is rebuilt in the same spot for the next speaker, with the new step id, and is live at once. In a local room `room.act` runs in-process (client.js:1136), so the redraw beats a second tap, and the `at` guard (game.js:1403) only catches taps that still carry the old id. 5 of 9 turns were lost (3 players, both rounds). The order list showed 小美 ✓ and 大熊 ✓ for unspoken turns. 大熊's R2 clue never happened. The 2–3 s gaps are AI partial-label taps (TT1). The 1 s gaps (16:15:57→58, 16:21:35→36) are human-plausible | `ui.js:283-290` (rebuilt at once, no lock), `ui.js:291-293` (shared-seat path); `game.js:1402-1406` (`at` only stops stale ids, no undo); `play.js:304-312` (`tableSend` has no bounce guard); docs §5.2's claim 「`done` carries `at` against double taps」 | (1) Disable the new button for about 1.5 s (LOCKOUT_MS) after each `actionStep` change wherever it is shown for someone else (atTable or sharedDevice), and pulse the new name. (2) Engine `{type:'undo-done', at}`: accepted while `at` is the current id, `turn > 0` and the previous advance was under about 15 s ago (`s.turnAt`); it sets `turn--` and also undoes the jump into discuss. The UI offers 「↩ 返轉頭：{prev} 未講」 for those seconds. (3) Optional: a shell bounce guard in `tableSend` (about 700 ms) for every game's table taps. Docs §3.3/§4/§5.2, tests: a double tap within 300 ms advances once, and undo restores the speaker | undercover + shell (optional) |
| N2 | minor | text | 💡 「🎭 呢局有咩角色」 lists 白板 when the match has none | A role-less view (the table, or any undercover seat) lists all of `rules.roles` under 「呢局」, while the header says 「今局：平民 4 · 臥底 1」 (p1). Other games' table views show their full catalogue the same way | `js/ui/hints.js:94-95`; `game.js:111-124` | `view.hintRoles` (the ids in play) filters the list, and undercover sets it from the counts. Otherwise the heading becomes 「呢個遊戲有咩角色」 | shell hints.js + undercover view |
| N3 | polish | ux / text | The armed 開始投票 label 「再㩒一次：全枱傾夠未？」 drops the action | U5 works, but the armed button only asks a question. p2 and p3 could not tell what the second tap does. The 3 s arm means a second person's tap also confirms it (fine, but say so) | `ui.js:322`, `:332` → `dom.js:203` | `api.confirm('開始投票？全枱傾夠未', …)`; update §4 and the UI test | undercover ui.js |
| N4 | polish | handover | Every named gate on a whole-table phone shows 「X 唔喺度？」 under the receiver's own button | The #18 row is meant for the host device, and on one phone that is every gate, including the present receiver's (p3). It takes two taps, so harm is unlikely, but it is noise at every hand-over | `play.js:443`, `:530-560` | Show it only after about 20 s unanswered (run-1 #18 proposed about 2 min), or as a small ⋯ | shell |
| N5 | polish | one-phone flow (from code) | 大家睇完's lock runs out behind the table card; a bounce on the bottom-anchored card hits what is underneath | The 1.5 s lock starts at mount, behind the card, so 睇完 is live the instant the card goes. The table card's button sits at the bottom, over the NarratorBar's 重講 / 暫停 / mode buttons in voice mode. Not observed | `ui.js:465`, `:471`; `css/base.css:607-609`; `PassGate.js:56-62` | Restart the lock when `ctx.tableLocked` goes true→false. The shell swallows taps for about 400 ms after any PassGate closes | undercover ui + shell |

## One-phone checks from code and play (passed)

- **Hand-over order:**
  - The deal goes clockwise from the start (p1 first).
  - Each vote walk goes clockwise from the last holder (§7.1 #17): R1 from 阿強 (last dealt), R2 from 大熊 (last voter).
  - Every gate named the right person, and no gate waited for a seat that could not get the phone.
- **Privacy of each hand-over:**
  - `openGate` closes every cover first. The word card relocks after every peek on a shared phone.
  - Ballots use `secretChoice`.
  - The table view carries no word. 睇返我個詞 from the middle goes through askWho and a private gate, and is hidden during the vote.
- **Nothing waits forever:**
  - Speak, discuss and elim are whole-table taps.
  - The deal, the vote and the white-card guess are focus gates.
  - `room.idle` stays empty in a whole-table room, and the gate escape covers an absent seat.
- **Text assuming own phones:** none left in undercover. The white-card cue 「用手機打出…」 is device-neutral.
- **Anti-tell:**
  - There is no night.
  - Deal gates and screens are identical for every seat, and the blank card has the same size and place (not exercised: no blank in this match).
  - The vote order depends only on the last holder, never on role.

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p1, p2, p3 | 開始投票 can be ended by anyone / opened 2–5 s after the last remark | app-is-right (+N3) | U5: 「開始投票 on a whole-table phone needs a second tap」; spec §4. The fast openings came from two AI seats tapping inside the 3 s arm |
| p1 | Another seat tapped the host's 開始 | app-is-right | On one phone the device is the host's phone; whoever holds it starts (setup: 「邊個都可以㩒」) |
| p1 | The 💡 sheet covers the table for everyone | inherent (+N2) | One phone; the sheet closes on every hand-over (play.js:439, :491) |
| p1 | No 犯規 button | app-is-right | Spec §9: 「No foul button / clue log: clue legality is social (research: out of scope for v1)」 |
| p1, p3 | The vote order is not seat order; the first voter was ungated; the order is unexplained | app-is-right | §7.1 #17, clockwise from the last holder; the first ballot is gated (code + test; p1's gate read 1/5); each gate names the next voter |
| p1 | 「仲未投：…」 shows who voted first | not a finding | Who holds the phone is public |
| p2, p4 | 大熊's R2 clue was missing from the logs | merged → N1 | He was skipped. The app keeps no clue log by design (§1 「spoken aloud」, §9) |
| p2 | The R2 starter was not announced | app-is-right | Narrator 16:21:33 「第 2 輪。由 小美 開始…」 |
| p2 | The gate's accept button is unclear | app-is-right | The title 「交俾 X · 其他人唔好望」 names the receiver |
| p3 | Two taps after each result | app-is-right | U4 + U5 as decided |
| p3 | A long hold lets a neighbour glance | inherent | Hold-to-peek with relock is the mitigation |
| p5 | Speaking has no 交俾 gate | app-is-right | §4: speak is a table step; the clue is spoken |
| p5 | Game blocked at the R2 vote (finished:false) | AI-artifact | p5 stopped at 16:22:44 after elimination; results reached at 16:26:36 |
| p5 | 「講完喇」 lacks 我/你 | merged → N1 | 「你」 to the table is banned on a shared phone (#20) |

## AI artifacts

- Three seats each tapped 「講完喇」 when 阿明 finished (16:14:05/08/10, 2–3 s apart = console tap latency). A human would see the label change to the next name. N1 stays, because of the 1 s double advances.
- Two seats confirmed 開始投票 within 3 s of the last remark, twice.
- 阿強 held his speaking turn 71 s, and gates took 30–90 s each: AI pace.
- p5 left the table after being voted out.
- Report quality:
  - p2 filed two "blockers" for one bug.
  - p4 marked 「Speak one clue per round without interruption: couldUse true」 although skipped in both rounds, and called the missing clue a logging issue.
  - p5's `couldUse` values are inverted (「couldUse:false ✅ Working」), and it reported finished:false for a finished game.
  - p1 said 大熊 voted with no gate (contradicted by code and test).

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | evidence | fix |
|---|---|---|---|
| TT1 | `tap` matches a partial label against the **current** screen, so `tap 講完喇` from a seat that last saw 「阿明 講完喇」 lands on 「小美 講完喇」 | `pt.mjs:684-688` (`items.find(line => line.includes(ref))` after a fresh `see`). R1 16:14:05→08→10 | Remember each seat's last-shown control labels. If the screen changed and the matched label was not among them, refuse with 「畫面變咗：已經有人㩒咗 — 而家係：…」. Prefer an exact label match over a substring |
| TT2 | A race prints 「no control matching …」 plus a full dump; one tap printed the screen twice | p1, p3 | Say 「已經有人㩒咗」 and print the current view once |
| TT3 | `wait` / `tap` print the whole screen every time; 「(nothing changed in 60 s)」 followed by a full gate dump is confusing | p3 | Add a brief mode: the status line, what changed, and new table talk only |
| TT4 | Five AI hands on one table button | N1 evidence | README: a table control is pressed by **one** person. Announce it with `say` (「我㩒『阿明 講完喇』」) and tap the full label, never a fragment. Normally the speaker taps their own 講完喇 |
| TT5 | An eliminated seat quits early and files an unfinished report | p5 | README: keep `wait`ing until the results screen, even when out |

## Fix list for the orchestrator (priority order)

1. **N1** (undercover ui.js + game.js + docs, optional shell bounce guard): post-advance lock, undo, and tests.
2. **TT1, TT4** (console and README) before the next one-phone re-run, so the speaking round tests the app rather than five racing hands.
3. **N2** (shell hints.js + undercover view), **N3** (undercover label).
4. **N4, N5** (shell polish), **TT2, TT3, TT5**.
