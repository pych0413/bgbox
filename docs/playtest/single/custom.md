# 通用派牌＋骰盅 (custom): one-phone playtest review

> Session `sp-custom`, `--shared`: ONE 390x844 phone passed around a 3-seat table, 2026-10-04 10:08–10:19 UTC.
> Build under test: `https://pych0413.github.io/bgbox/` build `20261004005209`. Its `js/games/custom/{game,ui}.js` and `js/ui/screens/play.js` match local HEAD `16da24d` except for the `?v=` import stamps, so the line numbers below are the code that ran. `node tests/run.mjs custom`: 59 passed, 0 failed.
> Config: game defaults. Preset 🎭 一個內鬼 (1 內鬼 + 2 好人), 1 × d6, 房主一齊玩, selfRoll on, modSees off, antiStreak off, narration silent.
> Seats: p1 阿聰 (host), p2 阿明, p3 小美. `docs/research/custom.md` does not exist, so `docs/games/custom.md` is the rules of record.
> Reviewer: opus, read-only (no code edited). Table stopped after the review.

## Verdict

**Finished, cleanly.** One full round took about 11 minutes, with no blocker, no stall and no leak during play. All three seats reached the results screen. `room.lastResult` matches what the table saw: 阿聰 🎭 內鬼 4 · 阿明 🙂 好人 2 · 小美 🙂 好人 6, with `noScore: true`. The table voted 2–1 against 阿明, so the 內鬼 got away. That was table play, not an app fault.

**The private part of one-phone play works.**
- The deal walk went 阿聰 → 阿明 → 小美 in seat order, and every gate named the right person.
- The card covered itself again on release.
- No tag, gate or timing differed by role.

**Two real one-phone gaps, from two missing pieces.** The walk knows only about the peek, and the shell has no "phone in the middle" state.

1. **The dice step drops out of the walk (C1, major).** `seen` fires on release and the next gate opens at once, so only the last seat could roll in her turn. At three seats, rolling and locking took **five extra 換人 hand-overs**.
2. **Laying the phone down shows a private seat (C2, major, from code).** With one phone, 開盅 and 開晒角色 can only be shown by laying the phone face up. The only screen for that is a seat's own: the host's role card and cup open at a touch, and the one-tap ➡️ 下一回合 is live. The rules even say 「放喺枱面都唔使怕」.

**Smaller items:**
- No hand-back to the host after the walk (C3).
- The moderator's 👁 role tags on a shared phone (C4).
- Four polish items. Three are carried over from the multi-phone re-run and are still open at HEAD.

## Facts from the table

| | |
|---|---|
| Roles / dice | 阿聰 🎭 內鬼 🎲 4 · 阿明 🙂 好人 🎲 2 · 小美 🙂 好人 🎲 6 (`room.lastResult.lines`) |
| Deal walk | 阿聰 peeked with no gate (he had just tapped 開始, `play.js:344`), then gates 「交俾 阿明」 → 「交俾 小美」. Each gate appeared the moment the previous peek was released |
| Game log, in order | 派咗牌 → **小美 搖** → 阿聰 搖 → 阿聰 鎖 → 阿明 搖 → 阿明 鎖 → 小美 鎖 → 開晒啲骰 → 開晒角色 → 遊戲完咗. One roll each. No card latched (`roleLocked: false` for all three) |
| Manual hand-overs (換人 ⇄) | **5**: 小美→阿聰 (10:11:30), 阿聰→阿明 (~10:12:14), 阿明→阿聰, 阿聰→小美 (10:16:40, only to lock), 小美→阿聰 (10:17:00) |
| Vote (spoken) | 阿聰 → 阿明, 小美 → 阿明, 阿明 → 阿聰 (10:17:12–10:17:27) |
| Reveal | The host laid the phone face up **on his own seat** for 開盅 (p1-004; his unlatched 內鬼 card is just below) and for the roles (p1-006) |
| Result | `winners: []`, `noScore: true`, `history[0].noScore: true`. Results screen says 「邊個贏由你哋講」 (p1-007) |

Timeline (UTC):

| time | what happened |
|---|---|
| 10:08:51–10:08:59 | everyone said 準備好 |
| ~10:09 | 開始; walk p1 → p2 → p3 |
| 10:10:22 | 小美 (last in the walk) rolls during her turn |
| 10:11:30 | she hands the phone to 阿聰 with 換人 |
| after 10:11:30 | 阿聰 rolls and locks; 阿明 rolls and locks |
| 10:13:33 | 小美 proposes the round of claims and votes |
| 10:16:40–10:17:00 | 小美 gets the phone back only to lock |
| 10:17:12 | spoken vote |
| ~10:18:40 | 開晒啲骰 (the first confirm missed because of console latency) |
| 10:18:56 | 開晒角色 |
| 10:19:04 | 結束遊戲 |

## Confirmed findings

| # | sev | category | title | detail | root cause | fix | owner |
|---|---|---|---|---|---|---|---|
| C1 | major | one-phone flow | The pass-gate walk covers only the peek, so the dice step drops out for every seat but the last | Each seat gets the phone only for its peek. `seen` is sent when the finger lifts, focus drops that seat, and the shell opens 「交俾 <next>」 straight away. The cup sits above the card, but the banner says 「輪到你睇牌 👇 㩒住張牌」, so people peek first and the phone is gone before they can roll. Only the last seat keeps it. The log shows 小美 (last) rolling first, and everyone else rolling later through 換人. Locking cost 小美 another round trip. In total that was 5 manual hand-overs and about 6 minutes from the last peek to the last lock. At N seats it is roughly 2(N−1) extra gates. Away from the phone nobody can tell who still has to roll or lock: the 🎲 已搖 / 🔒骰 tags are on the holder's screen. That is why 小美 told 阿明 to roll after he had locked. The texts promise a walk but say nothing about dice: quick rule 「一部機都玩得：app 會逐個叫人接機睇牌」, the 一部機玩 section, and spec §4 ("switch to a seat, hold the cup, roll"; after 全體搖骰 "everyone peeks at their own cup in turn", with no walk at all). Reported by p1 (major) and p3 (minor) | `js/games/custom/ui.js:194-199` (seen on release, also on a shared phone); `js/games/custom/game.js:820-823` (focus = unseen seats only); `js/ui/screens/play.js:344-350`; texts `game.js:416`, `:461-462`, hint `:719` | Custom UI, **shared phone only** (detect device mates as `undercover/ui.js:67-71` does): do not send `seen` on release. After the first peek, show one button under the card: 「✓ 搞掂 · 交俾 阿明」. The next seat comes from `ctx.focus.pids`. For the last seat the button reads 「✓ 搞掂 · 交返俾房主 阿聰」 (C3). Add the note 「要搖骰就而家搖、鎖埋先交」. The tap sends `seen`, so the existing focus walk carries on, and neither the engine nor the multi-phone flow changes. Shared-phone banner: 「輪到你：睇牌、搖骰，搞掂㩒「交俾下一個」」. Texts: quick rule 6 becomes 「一部機都玩得：app 會逐個叫人接機，睇牌搖骰一次過做完先交」, and the same goes into 一部機玩 and spec §4. Optional: a per-seat `seenDice` flag that 全體搖骰 clears, so focus walks the table again for the new roll. Test: with two seats on one device, a release sends nothing and the button sends `seen` | `js/games/custom/ui.js`, `game.js` (rules text), `docs/games/custom.md` §4, `tests/custom.test.mjs` |
| C2 | major | privacy (one phone) | Laying the phone down shows a private seat: its role card and cup open at one touch, and host controls are live | With one phone, the table can only see 開盅 and 開晒角色 if the phone is laid face up, and the only screens available are seats' own. 阿聰 laid down his own seat for the dice reveal while his 內鬼 card was unlatched. p1-004 shows 開盅 with 我嘅角色牌 under its 「㩒住睇」 cover right below. The cover opens on `pointerdown` with `touch-action: manipulation`. A friend's resting finger opens it, and a scroll that starts on the card flashes it until the browser cancels the pointer. The cup behaves the same way. The rules say the opposite: 「…放手即刻冚返，所以放喺枱面都唔使怕」. The same face-up host seat (p1-006) also shows ➡️ 下一回合 (one tap, no confirm: new deal, dice cleared), a per-row 🔓 on every locked cup (no confirm), and the label 「阿聰（你）」. A deal started from there (下一回合 / 重新派牌) opens the host's new peek on the public phone with no gate (same root as undercover C3). Not exercised: the console makes a shown phone read-only. p1 reported the host controls on the face-up phone and p3 reported 「（你）」; the privacy part was missed | `js/ui/screens/play.js:405-419`, `:625-635` (the 換人 sheet offers seats only, with no public mode, although `core/room.js:392` already sends local devices the table view); `js/games/custom/ui.js:211-217` (no re-latch after a peek on a shared phone, unlike `undercover/ui.js:114-115`); `js/ui/components/Cover.js:98-104` + `css/base.css:267`; `game.js:446` (text); `play.js:344` | (1) Shell: on a phone holding 2 or more seats, add 「🀄 放喺枱中間（大家一齊睇）」 to the 換人 sheet. It renders `st.table` (pid `null`): roster, 開盅 and revealed roles, with no card, cup, host controls or 「你」. Leaving it goes through the usual gate. Custom's table note (`ui.js:375-377`) then needs a line for this mode, e.g. 「部機放咗喺枱中間 👀」, in place of 「下一局先加入到」. (2) Custom UI: on a shared phone, re-cover and latch the card locally after every peek, as undercover does. (3) Rules 角色牌: 「一部機輪流玩嘅話，擺出嚟之前㩒「放喺枱中間」，或者先鎖定張牌」. (4) Undercover C3's gate fix also covers a deal started from the face-up host seat | `js/ui/screens/play.js`, `js/games/custom/ui.js`, `game.js`, `docs/games/custom.md` §4 |
| C3 | minor | handover | After the walk the phone stays with the last seat, and nothing says it goes back to the host | After 小美's peek, focus went `null`. The shell closed the gate and left her seat on screen with 「大家都睇咗牌 ✓」. The host controls exist only on the host's seat (spec §4), and nothing on screen says so. 小美 had to work it out (10:10:22 「之後交返俾阿聰」), then used 換人. Reported by p3 | `game.js:821-823`; `play.js:344` (gate closed, `activeSeat` kept); `ui.js:253` (banner gives no next step) | Use C1's last-seat button 「交返俾房主 阿聰」. A game UI needs a shell call to hand the phone over, e.g. `api.handTo(pid)` → `openGate('switch', …)`, the same API undercover C6 asks for. Without C1: on a shared phone, once everyone has looked and the seat on screen is not the host, the banner reads 「大家睇完牌 ✓ · 主持掣喺 阿聰 個位」 | `js/ui/screens/play.js` (handTo), `js/games/custom/ui.js` |
| C4 | minor | privacy (one phone, from code) | With 主持睇到所有人角色 on a shared phone, the host seat shows every role to whoever holds it | With modSees on, the moderator's roster carries 👁 role tags for every holder. On a multi-phone table that is the moderator's own phone. On one phone, the controls live on that seat (spec §4), so the phone keeps coming back to it. The tags sit just under 開盅, so laying the phone down to show the dice shows every role. Anyone handed the host seat through 換人 also sees them. Not exercised (modSees was off), but this is the natural one-phone setup for 殺手遊戲 (its reason line says 「要有個法官」) | `game.js:809-812` (`view.all`); `ui.js:260-262` (tags) | On a shared phone, hide the 👁 tags behind one hold-to-peek, 「㩒住睇所有人角色（主持專用）」. C2's table view covers the face-up moment. Add one line to spec §3 (Moderator) and §4 | `js/games/custom/ui.js`, `docs/games/custom.md` |
| C5 | polish | consistency | After 開晒角色 the player's own card is still hold-to-peek (re-run #5, still open) | The roster shows every role, and the hint says 「大家嘅角色都公開咗」, yet the card sits under a 「㩒住睇」 cover that hides nothing. Reported by p1 | `ui.js:211-217` (after `revealRoles`, only the hint changes; `RoleCard` has no face-up mode) | After `revealRoles`, show the card face up: a `faceUp` prop that pins the Cover open, or a static front in its place | `js/games/custom/ui.js` / `RoleCard.js` |
| C6 | polish | wording | Results: the recap is headed 「點解會咁」 and 今晚戰績 shows 贏 0 in a game with no score (re-run #4, still open) | p1-007: hero 「邊個贏由你哋講」, then a card headed 「點解會咁」, then 局 1 / 贏 0 on every row. Reported by p1 | `game.js:872` (no `linesTitle`); `results.js:257`; `Scoreboard.js:44-50` | In `result()`, set `linesTitle: '今局嘅牌同骰'`. In Scoreboard, hide the 贏 column when every row tonight is `noScore` or `void` | `game.js`, `Scoreboard.js` |
| C7 | polish | ux | Custom's armed host buttons have no armed style, so the 3 s arm and its expiry are silent (re-run #3, still open) | p1 asked for a visible countdown. The miss itself was console latency (see Rejected), but 「再㩒一次：…」 on a `.cu-btn` looks like an ordinary label, and when it reverts nothing marks the change | `custom/style.css:50-61` (no `.cu-btn.armed`); `base.css:232` | Add `.cu-btn.armed { background: rgba(228,87,61,.18); border-color: var(--danger); animation: armPulse 1s ease-in-out infinite; }`. Optional, shell-wide: a bar on `.armed::after` that shrinks over `ARM_MS` | `js/games/custom/style.css` |
| C8 | polish | ux | The results scoreboard on a shared phone marks the last holder 「（你）」 | 「阿聰（你）」 appears on a screen the whole table reads (p1-007, p3-009). Reported by p3. Same as undercover C7 | `js/ui/screens/results.js:286` (`me: st.activeSeat ?? …`) → `Scoreboard.js:50` | `me: (st.mySeats?.length ?? 0) > 1 ? null : …` | shell `results.js` |

## Checks that passed (one-phone specifics, from code and play)

- **Hand-over order.** Gates follow seat order of unseen card holders (`game.js:822`, `play.js:312-316`). The host who tapped 開始 peeks first with no gate. A moderator host is never in focus, so the first gate goes to the first holder.
- **Privacy of each hand-over.** `openGate` closes the 💡 sheet and every cover before the gate (`play.js:295-297`). Every gate is the same card, 「交俾 X · 其他人唔好望」, for every role. `seen` fires on release whatever the card says. The roster tags (已睇牌, 🎲 已搖, 🔒骰) are the same for every role. The log says that someone rolled or locked, never what they rolled.
- **No step waits on a seat that never gets the phone.** Only the peek is in `focus`. `autoAct` is `seen`, and the host controls need nobody. The extra hand-overs in C1 were optional steps (dice), never a stall.
- **Text that assumes everyone has a phone.** None found: no 「用自己部手機」 anywhere in custom. The one line that is wrong on a shared phone is 「放喺枱面都唔使怕」 (C2).
- **Night anti-tell.** Not applicable: no night. The killer and werewolf presets run their night at the table with a human moderator. C4 is the one-phone risk there.
- **Results.** Correct and self-explaining: every card and die, 「🙂 好人（2 個）：阿明、小美」, and 「app 唔計輸贏」.

## Rights checklist (merged)

| right | p1 阿聰 內鬼 (host) | p2 阿明 好人 | p3 小美 好人 | note |
|---|---|---|---|---|
| Peek own card when the gate names you | ✓ | ✓ | ✓ | covers itself again on release |
| Roll own die | ✓ (via 換人) | ✓ (via 換人) | ✓ (in her turn, as the last seat) | C1 |
| Read own die under the cup | ✓ | ✓ | ✓ (console could not show it) | tooling T1 |
| 🔓 鎖定點數 | ✓ | ✓ | ✓ (needed an extra hand-over) | C1 |
| 換人 ⇄ to a named person | ✓ | ✓ | ✓ | every gate named the right person |
| Host: 開晒啲骰 / 開晒角色 / 結束遊戲 | ✓ | — | — | 3 s arm (C7) |
| Lay the phone face up for the table | ✓ (own seat only) | — | — | C2 |
| 🔓 鎖定角色牌, 全體搖骰, 重新派牌, 下一回合 | not used | not used | not used | covered by unit tests |

## Rejected findings

| reported by | finding | verdict | why |
|---|---|---|---|
| p1 | The confirm window (~3 s) is too short | AI-artifact | Spec §3: the second tap "within about 3 s sends" (`dom.js:161` `ARM_MS = 3000`). The arm and confirm were separate console calls seconds apart, and the confirm worked when both taps were in one command. `multi/custom-rerun.md` and `single/9upper.md` reached the same verdict. The visibility gap is kept as C7 |
| p1, p3 | Die faces have no text; a player cannot read their own die or 開盅 | tooling | `dieFace` sets `role="img"` and `aria-label` 「N 點」 (`dom.js:114-120`). The Cover strips the label only while the cup is closed (`Cover.js:73-77`). On a phone the pips are plain (p1-002). The console prints `aria-label` only for controls (`pt.mjs:153`) |
| p1 | The table cannot see who has rolled or locked | merged → C1, partly tooling | The flags are public but show only on the held phone. At a real table the holder reads them out or tilts the phone; the console hides even the public screen from non-holders |
| p3 | Roll and lock cost two hand-overs per person | merged → C1 | |
| p3 | After a roll, the 換人 chip was COVERED | AI-artifact | The console scrolls every target to the middle before a tap (README). At scroll 0 the chip is at the top (p1-002, p2-003). Optional: a sticky seat chip on a shared phone. C1's button makes this moot |
| p3 | Shake-to-roll means every person sees a permission prompt | app is right | Permission and the on/off state are saved once per phone (`DiceCup.js:57-61`, `ct:motionPerm` / `ct:shake`), not once per seat. A shake rolls only the cup on screen (`DiceCup.js:23`) |
| p3 | A traitor host controls the vote order and the reveals | app is right | Spec §1: "the group decides … when to call a vote, who won". A neutral dealer is offered as 房主一齊玩 off, explained in rules 房主做主持 (`game.js:457-458`). An optional 💡 line is fine |
| p1 | ⚙️ 改設定 COVERED in the lobby | app is right | The sticky 開始 ▶ bar overlaps whatever is at mid-scroll, and at full scroll nothing is under it. `multi/custom-rerun.md` reached the same verdict |
| p1 | A face-up phone shows only the holder's scroll position, and the others cannot scroll | tooling (scroll part) | At a real table people lean in and scroll. The host controls on a face-up phone are kept in C2 |
| p1 | `wait` does not wake on table talk | tooling | See T2 |
| p3 | `tap` / `wait` print the screen twice | tooling | Cosmetic, unverified |

## AI-artifacts (would not hit a person)

- The missed 3 s confirm (console round trips).
- The 換人 chip "covered" after the console centred the roll button.
- 小美 telling 阿明 to roll after he had locked. She could not glance at the phone in 阿聰's hands; a person would lean over or ask. The structural part (nothing on the gate says who still has to roll) is C1.
- Part of the ~6-minute dice phase was AI pace. The 5 hand-overs are structural (C1).

## Tooling notes (`tools/playtest/pt.mjs`)

| # | problem | fix |
|---|---|---|
| T1 | `see` / `hold` never print a die value, so players needed `shot` during a background `hold` (carried over from the re-run) | Print `[img 4 點]` for a visible `role="img"` with an `aria-label`. The Cover already strips the label while closed, so this cannot leak |
| T2 | Shared `wait` keys only on the screen (`pt.mjs:579-592`), so table talk does not wake it and players polled `hear` with sleeps | Add `wait --talk` or include the chat-file length in the wait key, and print the new lines on return |
| T3 | Arm-then-confirm needs two taps within 3 s (carried over) | `tap <seat> "<label>" --confirm`: tap, then tap 「再㩒一次…」 at once |
| T4 | A shown phone is read-only and viewport-only, so C2's touch hazard cannot be exercised and viewers see only the holder's scroll | `shot --full` (capture beyond the viewport) for read-level viewers. Optionally a referee-logged `poke` that lets a viewer touch a shown phone, to model a curious friend |
| T5 | Occasional double print of a screen | Print once per command |

## Still open from the multi-phone re-run (not re-reported by players here)

Verified unchanged at HEAD:

| re-run # | item | where |
|---|---|---|
| #1 | 鎖定點數 stays live after 開盅 | `ui.js:208` |
| #2 | The banner points at the cup | C1's shared-phone banner replaces it on one phone |
| #6 | Host-seat wording: 「解鎖佢嘅骰盅」 on the host's own row, 「要主持再搖」 shown to the host | `ui.js:298`, `:383` |
| #7 | 擲骰 vs 搖骰 | `game.js:413` |
| #8 | No suggested round per preset | |
| #9 | `docs/research/custom.md` missing | |
