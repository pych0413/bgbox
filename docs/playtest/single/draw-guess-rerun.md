# 你畫我猜 (draw-guess): one-phone re-run review

> Session `sp2-draw-guess`, `--shared`, 3 seats (p1 阿聰 host, p2 阿明, p3 小美), 2026-10-05 19:51–19:57 UTC, local HEAD `328b04f`.
> Config: defaults + `cycles: 1` (📱 手機畫板, 🗣️ 講出口, FFA, 80 s, hints on), narration 🔊 語音. Reviewer: opus, read-only.
> After the match I ran a short repro in the same session (a rematch with one abandoned turn) to check the round-3 gate claim and the clock hold. Then I stopped the table.

## Verdict

**Finished. It plays well on one phone now.** All 3 rounds ran in about 6 minutes. The result is 小美 46, 阿聰 43, 阿明 0, and `lastResult` matches the scoring (r2 +19 / +14, r3 +32 / +24).
- Each hand-over goes private gate (揀詞), then the public card (擺喺枱中間畫), then the table card at the reveal.
- The word was never on a face-up screen.
- Hints were spoken.

Round 1 had no picture and no score. That was AI pace: the drawer drew nothing, and he did not tap during the 14 s after both shouts.

The only real defects left are display and wording:
- The held clock still counts down on screen.
- The 「開始」 cue fires before the drawer taps.
- The seat chip says "held" while the step is public.

## Fixed since run 1

| Run 1 | Status |
|---|---|
| D1 nothing says to lay the phone flat | **Fixed**: pick note 「揀好就將部手機平放喺枱中間」, prompt 「部手機平放喺枱中間畫」, cue 「部手機擺喺中間」, public card |
| D2 / U10 clocks run behind an untapped gate | **Fixed in logic** (`session.holdClock`, `focus.hold`). Repro: `clockHeld: true` behind the table card, and the pick clock resumed at 0:14 after the tap. Display is still wrong (N1) |
| D3 no gate when the drawer is already on screen | **Fixed**: the rematch with host-as-first-drawer opened 「交俾 阿聰 · 揀詞」 |
| D4 peek chip on a face-up phone | **Fixed**: hold Cover 「拎起部機，㩒住睇個詞」 |
| D5 typed mode on one phone | **Fixed**: `config.defaults` forces shout, `validate` error (`game.js:262, 278`), the preset is dropped |
| D6 lobby help | **Fixed** (`game.js:319`) |
| D7 「（你）」 / 輪到你 on face-up screens | **Fixed** (`ui.js:65`, `results.js:286`). Header reads 「第 1/3 輪 阿聰 畫」 |
| D8 queue preview never public | **Fixed**: 「之後到：小美」 is visible behind the table card |
| D9 small canvas | **Fixed**: name chips sit under the canvas |
| D10 最快反應 / long grace banner | **Fixed**: 「仲有人估中？一齊㩒 · ↩ 撤銷」 |
| T1 public step hidden from the table | **Fixed**: the open step is read-only for every seat |
| T5 silent narration | **Fixed**: 語音, and cues echo into `hear` |

## Still open

- **T3**: `draw` and `wait` print the whole screen. Reported by p1 and p3.
- **T4**: `draw` needs a canvas index that changes every turn, and there is no `canvas` alias. Reported by p3.

## New confirmed findings

| # | Sev | Cat | Title | Detail | Root cause | Fix | Owner |
|---|---|---|---|---|---|---|---|
| N1 | minor | ux / one-phone | The held clock still counts down on screen | Behind the table card and the private gate, the public 「最遲 N 秒後開始畫」 ran to **0** while `clockHeld` was true (repro). After the tap it jumped back to 0:14. The table believes the pick is being lost. p1 (「19 秒」) and p2 both reported the clock "running". | `js/core/session.js:337-357` moves `state.deadline` only on release. `js/games/draw-guess/ui.js:216-238` (`makeCountdown`) and `:195-207` (Timer) only read `c.paused`. `ctx.clockHeld` (`js/ui/screens/play.js:172`) is ignored | Treat `c.clockHeld` like `paused` in both (freeze, and show 「等 X 接手」). Better: the room view publishes an effective deadline (deadline + held so far), so every game's Timer is right | draw-guess ui (+ core) |
| N2 | minor | text | 「開始！…限時 80 秒」 is spoken before the drawer taps ▶ 開始 | The cue fires on choose → play, while the public card is up and the clock is held (1:20 frozen). All 3 rounds (19:52:14, 19:54:34, 19:55:59). Reported by p1 and p3. | `js/games/draw-guess/game.js:862`; `script.js:33-37` `cuePlay` | On `passPhone`: 「X 揀好喇。部手機擺喺中間，X 㩒開始就計時。答案有 N 隻字…」. Or have the shell emit the cue when the public card is tapped | draw-guess script |
| N3 | minor | ux / one-phone | The seat chip says the phone is held during the public drawing step | The face-up drawing screen shows 「而家睇：阿聰 換人 ⇄」 and 「📱 擺返中間」 next to 「部手機平放喺枱中間畫」 (repro, p3). A guesser who taps 換人 takes the canvas off the table's screen. | `js/ui/screens/play.js:1061-1068` (the shared branch ignores `focus.open`), `:113` (homeBtn) | When `focus.open` names the seat on screen: chip 「📱 枱中間 — X 畫緊」 (disabled), and hide 擺返中間 | shell |
| N4 | polish | flow | The reveal runs out behind the table card | The reveal is 7 s with no hold (focus is `null`). The card says 「大家睇緊 · 㩒一下」, but the reveal moves on to 「X 揀緊詞」 behind it. On one phone the reveal is the only big view of the answer and drawing. The card does **not** auto-dismiss: the players' "auto-advance" was another seat tapping it (repro: still up after 10 s). | `js/games/draw-guess/game.js:27, 799`; `play.js:519-527` (`syncHold` needs `focus.hold`) | On `passPhone`, set `REVEAL_MS` to about 10 s, or start the reveal countdown when the table card is tapped | draw-guess (+ shell) |

## Rejected

- **p1 major: "no private gate before my round-3 pick"**. Not reproduced. The table card leads to 「交俾 阿明 · 揀詞」, and `play.js:513` → `evaluateFocusGate` → `openGate('private')` has no host-only branch. Likely cause: another seat dismissed the card, and p1's index tap then hit the private gate's 「準備好喇，㩒一下」. That makes it tooling (TN1).
- **p2 majors: "my correct guesses were not credited" and "guessers are blocked"**. The app is right. 阿明 said 蒼蠅 at 19:55:28, 3 s after 阿聰 was credited (19:55:25), and 阿聰 had said it first at 19:55:10. 楓葉 at 19:56:41 came after 小美 at 19:56:40. In shout mode the drawer credits the first correct shout (rules 用一部手機玩, `game.js:133`).
- **p2 "no feedback for my shout" and "unclear one-phone workflow"**. Both shouts are in `hear`. The workflow is in the rules sheet.
- **p1 開波前檢查 sheet**. It only appears before the first game (the rematch skipped it).
- **p3 three taps to start**. The public card is the deliberate "lay it flat" step and the start of the U10 hold (§7.1 #4).
- **p3 peek on a face-up phone**. That is the D4 fix: the cover says 拎起部機.
- **p3 「X 唔喺度？」 on one's own gate**. On one phone the device is always the host, and the row stays folded. This belongs to the console (TN2).

## AI artifacts

- Round 1: the AI drawer drew nothing and did not tap during the 14 s after both shouts (19:53:27 → 19:53:42). A human drawer would have tapped. The fallback is the host's 作廢今輪.
- p3 "never saw the round-2 reveal": console latency longer than the 7 s reveal (see N4).

## Tooling notes (`tools/playtest/pt.mjs`)

- **TN1**: on `--shared`, `tap <index>` can land on a different card than the one the seat last saw. Record the gate title and kind at the seat's last `see` or `wait`, and refuse with 「張卡變咗，再睇一次」 if it changed.
- **TN2**: `decide()` gives the named seat `tap:'all'` on its own gate, so the 「X 唔喺度？」 row looks usable. Mark escape items host-only for every seat.
- **T3, T4** (still open): one-line `draw` and `wait` confirmations, and a stable `canvas` alias for `draw`.
