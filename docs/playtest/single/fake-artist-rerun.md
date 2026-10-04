# 假畫家 (fake-artist): one-phone re-run review

> Session `sp2-fake-artist`, `--shared` (one phone, 3 seats: p1 阿聰 host, p2 阿明, p3 小美), 2026-10-05 19:49–20:05 UTC.
> Config: 📱 手機畫板, 手機出題, 2 laps, 一齊指 vote, tie `must-guess`, 開口估, points, 1 round, 🔊 語音.
> Reviewer: opus, read-only (no code edited).

## Verdict

**Finished. The rules held, and every one-phone gap from run 1 except one wording item is fixed.** All 3 cards were dealt
behind private gates, then 6 strokes were drawn behind public 「輪到 X · 畫第 n 筆」 cards. A table card over the finished
picture came next, then the 3-2-1 一齊指 and a one-person entry (阿明 got 2 votes). 阿明 guessed 「筆」 and 阿聰 judged it
wrong, so the result was 真畫家贏 (阿聰 1, 小美 1, 阿明 0). This matches the research rules: a caught fake gets one guess
and the QM judges it, or in app-QM mode the host does (research line 193). No secret leaked at any hand-over, and no step
waited on a seat that could not get the phone.

p2 reported 「卡於判斷」 (blocker). That is false. The narration log shows the verdict at 20:04:52 and the result at
20:05:03. p2's own 120 s wait ran out while the judge was still working (AI-artifact).

New findings: one minor wording issue at the guess hand-over, and two polish items.

## Fixed since run 1

| Run-1 | Status | Evidence |
|---|---|---|
| F1 private gate on every stroke | **Fixed** | `game.js:1405` draw focus `open: true` gives the public card (`play.js:393-398`). p1 and p3 watched every stroke. |
| F2 vote opens with no gate and no look at the picture | **Fixed** | 一齊指 table card 「大家睇清楚幅畫，可以傾」 (`ui.js:777`), narration at 19:59:13. |
| F3 walk restarts at seat 1 | **Fixed** | `walkHere` → `walkOrder(…, { from: holder ?? lastHolder })` (`play.js:401-407`). The deal went 阿聰 → 阿明 → 小美. |
| F4 sequential ballots let voters steer | **Fixed (U7)** | `defaults`: a shared phone gets `vote: 'point'` and `passPhone` (`game.js:373`). |
| F5 text assumes a phone each | **Fixed** | Rules step 4 and the 兩種畫法 help now cover one phone (`game.js:219-227`). The pass cue is at `game.js:1045`. |
| F6 開口估: the phone goes to the judge, not to the fake | **Fixed** | Guess focus is `open` (`game.js:1413`). On a shared phone the picture shows first and the answer stays covered (`ui.js:914-922`). See N1 for the gate title. |
| F7 the last voter's 睇完 closes the tally | **Fixed** (1 round only) | Table mode 「部手機擺返中間」 comes before the results (p1). The U5 睇完 lock across rounds was not exercised. |
| F8 「（你）」 on shared screens | **Fixed** | `ui.js:82` (`!shared()`), tally `me: null` (`ui.js:815`), `results.js:287`. |
| F9 ⏭ in reach of the holder | **Fixed** | ⏭ is now only in the ⋯ menu (`play.js:859`). |
| F11 「輪到你」 only for the last voter | **Fixed** | `logic.turnBadge` (`play.js:1025-1032`). |

## Still open

- **F10** (polish): 輪 still means both round and lap. `ui.js:145` prints 「共 1 輪」 next to 「第 1/2 圈」. The fix is unchanged: use 局 for rounds.

## New confirmed findings

| # | Sev | Category | Title | Detail | Root cause | Fix | Owner |
|---|---|---|---|---|---|---|---|
| N1 | minor | text / one-phone | The guess hand-over names the judge as if the judge were guessing | The public card says 「輪到 阿聰 · 開口估題目」 with the button 「▶ 阿聰 開始」, but 阿明 (the fake) is the one who speaks. Nothing before the guess says who judges or why. The narration names only the fake. p1 and p3 both reported it, and p3's 「who judges?」 setup point is merged here. | `game.js:1413` (`{ pids: [r.judge], open: true, label: '開口估題目' }`); `play.js:393-398` (`publicText` always builds 「輪到 {focus seat} · label」) | Let focus carry a `title` override, passed through `filterFocus` (`room.js`) and used by `publicText`. Fake-artist sets it to 「阿明 開口估題目 · 阿聰 判斷」, with the button 「▶ 阿聰（判斷）開始」. Have `cueCaught` name the judge too: 「…講出你估嘅題目，阿聰判斷」. | fake-artist + core/shell |
| N2 | polish | text | The pre-flight sheet mentions a night in a game that has none | 「開波前 30 秒檢查一次，夜晚旁白先唔會甩轆」 shows for every voice-narrated game, including 假畫家. | `js/ui/preflight.js:138` | Use the night wording only when the game meta has a night step. Otherwise say 「旁白先唔會甩轆」. | shell |
| N3 | polish | text | 輪 vs 局 (F10 carried over) | See "Still open". | `ui.js:145` | 「共 1 局」 / 「第 1/1 局」 | fake-artist |

## Rejected findings

- **Anyone can edit any row on the 指！ sheet** (p1 major, p2 major, p3 minor): app-is-right. Under U7, everyone points with their fingers and then **one person** enters the result. The sheet says 「一個人幫大家㩒：每個人指緊邊個」 (`ui.js:784`), and each row is labelled 「阿聰 指 →」 (`ui.js:748`). The overwrite happened because three AIs tapped the same table phone at once using shifting control numbers. At a real table one person holds the phone (tooling, see T1).
- **Picks are visible as the rows fill, so the vote is not simultaneous** (p1, p3): app-is-right. The simultaneous part is the physical 3-2-1 point (narration 「三、二、一，指！指住唔好郁」). The sheet only records hands that are already up. Research one-phone note: 「physical 3-2-1 pointing with one person tapping the tally」.
- **Only the host can judge, and the other artist cannot verify** (p3): app-is-right. Research line 193 says to allow a host override in app-QM mode. The answer and the guess are both on the result screen, so the table can dispute there.
- **The drawer hint 「一筆過畫完」 shows to onlookers** (p1, p3): not a bug. It is one phone, and the screen belongs to the drawer who holds it. The console shows that same screen to every seat with a read-only note (tooling).
- **12 gates in a 3-player round** (p3 polish): app-is-right. The single-tap public card per stroke is the design for #4 and U4 (DESIGN §7.1).
- **The pass-gate label is unclear** (p2): unverified. p1 and p3 used every gate without trouble.

## AI-artifacts

- **The game got stuck at the judgment** (p2 blocker). It finished. The judge needed about 2.5 min of tool turns (20:02:27–20:04:52), and p2 gave up after 120 s. p2's timestamps are also shifted by +1 h.
- **The 啱/錯 and 確定 arm resets after 3 s** (`ui.js:720`, `:898`). A person tapping twice in a row does this well inside 3 s. The AI's tool latency missed it.
- **「no control matching 確定」**: another seat had already confirmed. This is a race between parallel AIs.

## Tooling notes (`tools/playtest/pt.mjs`)

- **T1:** On a table-mode screen (holder = nobody), the referee lets several seats tap at once. Add a claim: the first seat to tap holds the table phone until the screen changes or the seat says `release`. Other seats get a message such as 「阿聰 is entering — wait」.
- **T2:** Controls in repeated rows (vote chips) all print as 「阿明」「小美」「冇指」. Prefix each control with its row label (`.fk-point-who` text, or the nearest labelled ancestor), e.g. 「[8] 阿聰 指 → 阿明 (selected)」. After `tap`, print that row's new selection.
- **T3:** When `tap` text misses because the screen has moved on, say 「screen changed since your last see」 instead of 「no control matching」.
- **T4:** `room.lastResult` and `history` stay empty while the in-game result is up (phase `playing`). Have reviewers read the outcome from `hear` or the game view, or have `pt.mjs` dump `engine.result` on request.
