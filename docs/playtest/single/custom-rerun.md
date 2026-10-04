# 通用派牌＋骰盅 (custom): one-phone re-run review

> Session `sp2-custom`, `--shared`: one phone, 2 seats (p1 阿聰 host 🙂 好人 🎲 5 · p2 阿明 🎭 內鬼 🎲 3), 2026-10-05 19:58–20:02 UTC.
> Build: local HEAD `328b04f` (table mode, public/private gates, `api.handTo` / `api.toTable`). Config: defaults (🎭 一個內鬼, 1 × d6, 房主一齊玩, selfRoll on, modSees off), narration voice.
> `docs/research/custom.md` does not exist, so `docs/games/custom.md` is the rules of record. Reviewer: opus, read-only. Table stopped.

## Verdict

**Finished, cleanly, in about 4 minutes.** There was no blocker, no major, no stall and no leak. `room.lastResult` matches the table: `noScore: true`, 阿聰 🙂 好人 5 · 阿明 🎭 內鬼 3. **Both majors from run 1 are fixed:**
- The deal and dice took **0 manual hand-overs** (run 1: 5). Each seat peeked, rolled and tapped one 「✓ 搞掂」.
- 開盅 and 開角色 were shown from the middle, with no seat face up.

What is left is friction around the host controls. After a public reveal they can only be reached through 揀名 and a private gate (F1). Two host buttons have no guard, and on a shared phone the host's walk turn puts them under his own card (F2). Caveat: with only 2 seats, the middle of the walk was checked from code only. `handTarget` goes clockwise, as the shell does (`ui.js:200-211`).

## Fixed since run 1

| run-1 | item | evidence now |
|---|---|---|
| C1 major | The dice step dropped out of the walk | Release sends nothing on a shared phone (`ui.js:256-259`). One 「✓ 搞掂 · 交俾 阿明」 button, with 「要搖骰就而家搖、鎖埋先交」 (`ui.js:466-477`). Log: both rolled in their own turn |
| C2 major | Laying the phone down showed a private seat | `sendHost` calls `api.toTable()` after 開晒啲骰 and 開晒角色 (`ui.js:190-192`). The table view shows the roster, 開盅 and the roles only. Seen by both players |
| C3 minor | No hand-back to the host | The last seat gets 「✓ 搞掂 · 交返俾房主 阿聰」, then `api.handTo` (`ui.js:221-227`) |
| C8 polish | 「（你）」 on the shared results | `results.js:287` sets `me: null` when a phone has 2+ seats. Screenshot p1-002 has no 「你」 |
| SUMMARY #2 | No gate for the host's own first peek | A private gate went to 阿聰 straight after 開始 |
| texts | Quick rule, 一部機玩 section, 「放喺枱面都唔使怕」 | `game.js:416`, `:446`, `:461-462` rewritten for one phone |
| T1, T2 | Die faces not printed; `wait` deaf to table talk | `pt.mjs:389-393`; self-test `pt.mjs:1267` |

## Still open from run 1

- **C4** (minor, not exercised): with modSees on, the 👁 role tags on the host seat are not behind their own hold. The spec now records this as "Not done" (`custom.md` §4; `ui.js:330-331`).
- **C5** (polish): after 開晒角色 your own card is still hold-to-peek. `RoleCard` has no face-up mode.
- **C6** (polish): results still show 「點解會咁」 and 贏 0. Re-reported this run, see F4.
- **C7** (polish): `.cu-btn` has no armed style (`style.css:50-61`). `base.css:232` covers only `.btn`, `.icon-btn` and `.c-seateditor-btn`.
- Older multi-phone re-run items:
  - #6: 「解鎖佢嘅骰盅」 on the host's own row (`ui.js:367`), and 「要主持再搖」 shown to the host (`ui.js:455`).
  - #7: 擲骰 vs 搖骰 (`game.js:355`, `:413`).
  - #9: `docs/research/custom.md` is missing.
- Tooling T3: there is still no `tap --confirm`.

## New confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| F1 | minor | one-phone flow | After a public reveal, host controls can only be reached through 揀名 and a private gate | After 👁 開晒啲骰 the phone is in the middle, with no host control there. For 開晒角色, and again for 結束遊戲, the host had to: dismiss the table card, tap 揀名, pick himself, pass the private gate 「交俾 阿聰 · 其他人唔好望」, scroll, arm and confirm. That is about 6 taps each. Keeping the controls on the host seat is deliberate (spec §4), but the middle needs a way back. The hand-back after the walk uses the same 'don't look' wording. Merges p1 #1, p1 #2 and p2 #2 | `ui.js:480` (`ctlCard.hidden = !v.controller`); `game.js:787-788` (no seat means no controller); `ui.js:190-192`; route `play.js:1049-1054` → `switchSeat` `play.js:691`; hand-back `ui.js:226` (no `open`) → `play.js:699-701` | On the table view (`api.atTable && shared`), show one button 「🎛 主持掣 · 交俾 阿聰」 → `api.handTo(v.host, { open: true, why: '主持掣' })`. That is a public gate with no card or cup step. Use `open: true` for the hand-back too: 「輪到 阿聰 · 大家睇完牌」. Doc: one line in `custom.md` §4 | `js/games/custom/ui.js`, `docs/games/custom.md` |
| F2 | minor | safety | 下一回合 and 全體搖骰 are one tap, and on a shared phone they sit under the host's own card during his walk turn | `next-round` is not in NEED_CONFIRM and is allowed at any time. One stray tap re-deals mid-round, clears every die and lock, and restarts the walk. `roll-all` asks only if a cup is locked. During the walk it silently re-rolls the dice of seats that have already passed, and they then need a 揀名 trip to see them. The host holds the phone for his own peek and roll, with the `primary` ➡️ 下一回合 just below. Reported by p1 #3 | `ui.js:24-29`, `:146`, `:151-152`, `:230-233`; `game.js:568-576`, `:617-619` | Add `'next-round': '下一回合？大家嘅骰會清晒、重新派牌。'` to NEED_CONFIRM. Make 全體搖骰 always arm-then-confirm on a shared phone. While `inWalk(v)`, fold `ctlCard` behind 「🎛 主持掣」 | `js/games/custom/ui.js`, `tests/custom.test.mjs` |
| F3 | minor | one-phone flow (from code) | With selfRoll off, rolls after the walk have no walk | With 「只有主持搖」, focus is labelled 「睇牌」 and the host's walk turn shows no roll hint (`doneNote` is empty when `!mayRoll`). If the host taps 全體搖骰 after the walk, or re-rolls after 開盅, each seat has to pick its name from the middle to see its die. That is N extra gates, and nothing on the table view says who still has to look. The spec writes the manual route in (`custom.md` §4), but not the cost | `ui.js:475`; `game.js:822-825`; `custom.md` §4 「Dice after 全體搖骰」 | Shared phone, host's walk turn, `!selfRoll`: note 「要全體搖骰就而家㩒，大家輪住睇牌就見到自己嘅骰」. Optional: a per-seat `seenDice` flag that `roll-all` clears and `focus` walks (label 「睇骰」) | `js/games/custom/ui.js`, `game.js` |
| F4 | polish | text | Results: 贏 0 for both players and the heading 「點解會咁」 in a game that keeps no score (run-1 C6) | Screenshot p1-002: 「邊個贏由你哋講」 at the top, then 「點解會咁」, then 局 1 / 贏 0 on each row. That reads as both players losing. Reported by p1 #5 | `game.js:874` (no `linesTitle`); `Scoreboard.js:45`, `:56` | `linesTitle: '今局嘅牌同骰'`. Show `—` in the 贏 column, or hide it, when every row is `noScore` | `game.js`, `Scoreboard.js` |
| F5 | polish | rules | At 2 holders, your own card tells you the other's role, with no warning | Default traitor deck at k = 2 is 內鬼 + 好人. `validate` says 「夠人喇」 and gives no warning. Reported by p1 #4 | `game.js:277-304` | In `validate`: when k = 2 and both cards differ, warn 「淨係 2 個人：睇完自己張牌就知對方係咩」 | `game.js` |

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p2 | The roster shows 未睇牌 while the card is held | app is right | Spec §4: 「the release sends nothing on a shared phone」. `seen` goes with 「✓ 搞掂」, after the dice (`ui.js:247-259`). The tag means the seat has not finished its turn |
| p2 | The 「邊個要睇自己？」 menu appeared twice | merged into F1 | It is the 揀名 sheet (`play.js:794`) the host used to get back to his seat |
| p1 | 「其他人唔好望」 on the hand-back is wrong | merged into F1 (partly app is right) | A gate is warranted because the host seat holds his own covered card and cup. Only the tone could be public (`open: true`) |

## AI-artifacts

- None that a person would not also hit. The roughly 1-minute wait was AI pace.

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | fix |
|---|---|---|
| T3 (open) | Arm-then-confirm needs two separate taps, and the armed state is visible only as a changed label | `tap <seat> "<label>" --confirm` (tap, then tap 「再㩒一次…」). After a tap that arms, print `[armed] 再㩒一次：…` |
| T6 (new) | Every tap prints the whole screen (about 60 lines), which is the biggest token cost on one phone | `--brief`: print only the lines that changed since the last screen this seat saw, plus the gate and holder line |
| T7 (new) | The first `setup` failed with 「Failed to fetch dynamically imported module」 (ui/shell.js), though the file was served 200 | When boot fails with a dynamic-import fetch error, `setup` reloads once before it reports failure |
