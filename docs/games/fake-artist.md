# 假畫家 (Fake Artist) — play-flow spec

> Rules source: `docs/research/fake-artist.md` (paraphrased from the Oink booklet and BGG; nothing copied). Its
> "## Verification" section (fact-check 2026-10-03 UTC) overrides the draft; this spec follows the verified text:
> the question master (QM) picks the theme and the title and knows the fake; clockwise, one stroke per turn, two laps;
> everybody but the QM votes at once; the fake is caught when it is among the most-pointed (current print) and then
> gets exactly one guess; points-v1 (fake + QM +2, or every real artist +1); first to 5 — or, like the current print,
> no points at all (`scoring: 'none'`: each round is just won by one side).
> Code: `js/games/fake-artist/{game,script,ui,index}.js` + `style.css`, tests: `tests/fake-artist.test.mjs`.
> Template: `docs/DESIGN.md` §15.9. All times UTC. All player-facing text is Hong Kong Cantonese.
>
> The game is listed under the generic name 假畫家 with our own word bank and art (research: the original publisher has
> asked a fan web app to stop; the name, logo and rulebook text carry the risk, the draw-and-vote mechanic does not).

## 0. Rules audit (QA 2026-10-03 UTC, against the verified research)

| # | verified rule | this spec | code | status |
|---|---|---|---|---|
| 1 | First QM: players pick (random/volunteer); next QM = the player to the left | §2 Dealing | `qmPtr` random, +1 each round; carried across games | OK (+ carry) |
| 2 | QM announces the theme to everybody, the fake included; picks a title; never draws, votes or guesses; knows the fake | §3.1–3.2 | `theme` public, `mine.fake` QM only, QM not in `artists` | OK |
| 3 | Deal: one X among the artists, random; the QM never gets it | §2 Dealing | `pickFake` uniform over `artists` | OK |
| 4 | Each artist a distinct pen; a stroke's colour identifies its author | §3.4 Pens | was: deepened lobby colours (two yellows ΔE 3 apart) | **FIX** → 12 distinct `PENS`, `view.pens` |
| 5 | QM picks who draws first (official); then clockwise | §3.3 | `first: 'qm'` default; `auto`/`random` offered; app QM random | OK |
| 6 | One continuous stroke per turn, two laps, same order; pen up = turn over | §3.4 | `turnOrder` × `laps`; Canvas `oneStroke` + `minStrokeLen`; `stroke` sent after `onStrokeEnd` (§15.10) | OK |
| 7 | Vote at once, every artist incl. the fake, never self, QM out | §3.5 | `vote.voters = artists`, self refused | OK |
| 8 | Tie: current print `must-guess` (F among the most-pointed = caught); v1 `escape`; house `revote` | §3.5 | `resolveVote`, exhaustive oracle test | OK |
| 9 | Caught → exactly one guess, QM judges; not caught → no guess | §3.6 | `guess`/`judge`, one verdict | OK |
| 10 | points-v1: not caught or right guess → fake +2, QM +2; wrong guess → every real artist +1, fake/QM 0 | §5.6 | `finishRound` | OK |
| 11 | First to 5, checked after the round; overshoot legal; simultaneous crossing (unruled) → highest, co-winners | §3.8 | `ending`, `result()` | OK |
| 12 | Later prints have no points; the engine must expose the scoring mode | §2 `scoring` | was missing | **FIX** → `scoring: 'none'` |
| 13 | Void the round when the fake/an artist drops; a dropped QM is replaced by the next in order | §5.2 | was missing | **FIX** → `@void-round` |
| 14 | Human QM below 5 players: reject unless unofficial counts are allowed | §2 Validation | 4 players + QM allowed with a warning (explicit choice) | OK (documented) |
| 15 | Missing ballot → abstain, flagged; a stalled guess → wrong, host override | §5.2, §5.5 | `@next`/autoAct | OK |
| 16 | Title never reaches the fake / a shared screen / TTS before the guess is locked | §3.6 | judge-only `guess.word`; swap tests; UI fake-DOM test | OK |
| 17 | Validation wording vs the research (5 = official minimum; 9+ hard to catch) | §2 Validation | said QM + 4 artists was below the minimum; advised 1 lap at 9+ | **FIX** |

## 1. At a glance

| | |
|---|---|
| Players | 3–10 (the research says 5–10 with a human QM; with the app as QM 3–4 players work and are the common travelling-group case, so the engine and `meta.players` say 3–10) |
| Length | 3–5 min per round, default first to 5 points ≈ 20 min |
| Narration | optional — short public cues only; never the word before the guess is locked |
| Single device | full — 📱 pass the phone clockwise, each player draws one stroke with a finger; 📝 paper works too (see §4) |
| Paper mode | yes (`meta.paperMode`), chosen at setup |
| Banks | `draw` (`{ w, alt, level, cat }`): the **category is the theme** shown to everybody, `w` the secret title, `alt` the aliases that count as a right typed guess |

**Two choices made at setup (user requirement):**

- **畫法 — 📱 手機畫板 / 📝 實體紙筆.** Phone: the shared Canvas, everybody watches the line appear live, one colour per seat.
  Paper: the app deals the theme and the word, names whose turn it is (name + colour) and how many laps remain, and the
  drawer taps 「畫完」 after drawing on the real sheet.
- **出題方式 — 手機出題 / 輪流有人出題.** App: a random word from the bank, nobody sits out, nobody knows who the fake is
  except the host process. Player: the QM (rotates one seat left each round) types a theme and a word (or rolls one with 🎲),
  does not draw or vote, knows who the fake is, rules on the fake's guess, and scores **with the fake** when the fake side wins.

**What the phones do.** Deal the word, hide the fake, enforce the turn order and laps (phone mode: one stroke per turn,
too-short strokes are discarded), run the simultaneous vote and the tie rule, run the fake's one guess, score points-v1,
rotate the QM, keep the scoreboard and decide when the game is over.

**What happens at the table.** The banter (no naming the title), the drawing itself in paper mode, and — in 開口講 mode — the
guess, spoken aloud.

## 2. Setup

### Config

| key | UI label | type | default | notes |
|---|---|---|---|---|
| `draw` | 畫法 | select `phone` / `paper` | `phone` | |
| `qm` | 出題方式 | select `app` / `player` | `app` | `player` only offered (and valid) from 4 players: 3 artists + the QM |
| `laps` | 畫幾圈 | int 1–3 | 2 | official: 2 laps = 2 × artists strokes |
| `tieRule` | 平票點算 | select | `must-guess` | `must-guess` current official print (the fake in the top = caught, so it must guess); `escape` v1 booklet (any tie at the top = not caught); `revote` house rule (§3.5). The ONUW-style reveal-everybody rule gives the same outcome as `must-guess` and is not a separate option |
| `guess` | 估題目方式 | select `spoken` / `typed` | `spoken` | typing is opt-in (BACKLOG #22); spoken needs no typing at all |
| `scoring` | 計分 | select `points` / `none` | `points` | `points` = points-v1 of the v1 print (fake + QM +2 / every real artist +1, first to `target`). `none` = the later prints, which have no points: each round is won by the fake side or by the artists; the game is `rounds` long and whoever won the most rounds wins (**[DESIGN]**: the print has no game winner at all). `points` stays the default because it is the only mode with a goal for the evening; the current-print tie rule is the default either way |
| `endMode` | 結束方式 | select `target` / `rounds` | `target` | only with `points` (`none` is always `rounds`) |
| `target` | 目標分數 | int 1–15 | 5 | shown for `target`; first to reach it, checked after the round is scored |
| `rounds` | 打幾多輪 | int 0–20 | 0 | shown for `rounds` and for `none`; 0 = one round per player (N rounds) |
| `first` | 邊個先畫 | select `qm` / `auto` / `random` | `qm` | shown only with a QM. `qm` = the QM taps who starts (**the official rule, the default**), `auto` = left of the QM (house rule: no tell), `random`. With the app as QM there is nobody to choose: the first drawer is random over all artists |
| `turnSecs` | 每筆限時（秒） | seconds 0–60 | 0 | 0 = no clock; a timed-out stroke is **given up** (the slot is used, no second chance) |
| `antiStreak` | 上一輪嘅假畫家呢輪唔做 | bool | false | BACKLOG #20; only while ≥ 3 other candidates remain. Also covers the first round of the next game (`carry.lastFake`) |
| `topics` | 題目類別 | categories → `{ cats, levels }` | `{ cats: [], levels: [] }` | empty cats = every drawable category; empty levels = 簡單 + 中等 (level 3 is not drawable one stroke at a time). Only affects words the app picks (手機出題, and the QM's 🎲) |

**Drawable categories.** The bank also holds charades-style categories (`成語`, `歇後語與俗語`, `抽象`, `電影與故事場面`, `動作`);
they are listed in `EXCLUDED_CATEGORIES` and never offered or drawn. A test fails if the bank gains or loses a category without
a decision. A word is skipped when the theme (= its category) would hand the answer to the fake: the category contains the word
or one of its aliases, or the word contains the category (e.g. `小鳥` under `雀鳥`, `太空人` under `太空`).

`config.defaults(n, prev, { singleDevice })` keeps every taste from the last game, re-checks the head-count (`qm: 'player'` falls back
to `app` below 4 players, `first: 'qm'` falls back to `auto` without a QM) and ignores junk. Old configs missing newer keys validate.
With `singleDevice` (one phone holds every seat) it picks pass-the-phone defaults: `qm: 'app'` (research: the shared phone cannot show a QM
the fake privately; the app asks) and `turnSecs: 0` (handing the phone over would eat into a stroke clock); every other taste is kept.

### Presets with a reason (BACKLOG #8)

`config.presets(n) → [{ id, label, reason, cfg }]`, `cfg` a patch over the current config; every preset passes `validate` and
plays through the fuzzer for every n.

| id | label | when | patch | reason |
|---|---|---|---|---|
| `standard` | 標準 | always | phone, app, 2 laps, points, first to 5 | 「6 人：人人都畫，先到 5 分 — 最啱玩嘅人數」 (the why follows the head-count: 易俾人睇穿 / 平票好常見 / 最啱玩 / 假畫家較難揪) |
| `paper` | 紙筆 | always | `draw: 'paper'` | 「有紙有筆：大家望住同一張紙，手機淨係派題同投票」 |
| `host` | 輪流出題 | n ≥ 5 | `qm: 'player'` | 「官方玩法：輪流做出題者，佢唔畫，但知邊個係假畫家」 (5 = QM + 4 artists, the official minimum; at 4 the form still offers it, with a warning) |
| `quick` | 快玩 | always | points, rounds, 3 | 「時間唔多：淨係玩 3 輪，比總分」 |
| `noscore` | 唔計分 | always | `scoring: 'none'`, rounds 0 | 「新版盒玩法：每輪淨係分勝負，每人一輪」 |

Tested: every preset is valid for every n, plays to the end, and no two presets play the same (their summaries differ).

### Validation

Errors (block start): head-count outside 3–10; any key with an out-of-range value; `qm: 'player'` below 4 players.

Warnings (shown, do not block): ≤ 3 artists (「好易俾人睇穿」; with a QM: 「官方最少要 5 人」 — the research's "reject unless
allowUnofficialCounts": choosing 輪流出題 at 4 is that explicit opt-in); ≥ 9 artists (the fake is hard to catch); `escape` with ≤ 5 artists
(heavily favours the fake); more than 24 strokes; target > 8; a rounds game over 12 rounds; a stroke clock under 5 s; `antiStreak` with
3 artists. The default set-up for 5–8 players has no warning at all (tested). Removed in the 2026-10-03 QA: a warning that called QM + 4
artists "below the official minimum" (it *is* the minimum), the advice to draw 1 lap at 9+ (fewer strokes make the fake even harder to
catch), and a warning about `first: 'qm'` that fired on every default app-QM set-up.

### Dealing

1. Round 1 QM (player mode): where the last game of 假畫家 stopped (`carry.nextQm`, so the rotation runs on through the evening), else
   random over all seats; then one seat left each round (the research: next QM = next in seat order).
2. The word: app mode draws through the bag (`draw`, filtered by categories and levels, relaxing level → category → everything;
   an emergency list covers a bank that cannot be loaded). Player mode: typed (or rolled) at `qm-input`.
3. The fake is dealt **uniformly at random among the artists** (never chosen by the QM; the QM is never the fake). `antiStreak`
   keeps last round's fake out of the draw while enough candidates remain.
4. First drawer: see `first` (official: the QM picks). With the app as QM it is random over all artists, independent of who the fake is (BACKLOG #20).
5. Drawing order is clockwise (seat order) from the first drawer, two laps, so nobody ever draws twice in a row.

## 3. Flow

Phases: `[qm-input]` → `deal` → `[first]` → `draw` → `vote` → `tally` → `[revote → tally]` → `[guess → [judge]]` → `result`
→ (`qm-input`/`deal` again | `over`). The shell shows `view.title` 「第 3/6 輪」 and `view.subtitle` 「主題：動物」 (during
drawing 「主題：動物 · 第 2/2 圈」). A persistent theme card and a score strip (🧑‍🎨 marks the QM) sit above/below the body.

### 3.1 qm-input (player mode only)

| Screen | Shows |
|---|---|
| QM | 「你係出題者」, two fields 主題（公開）/ 題目（秘密）, 「🎲 由詞庫抽一個」 (fills both fields; roll again as often as you like; the draft is private to the QM), 「出題」 |
| Everyone else / table | 「等 阿明 出題…」 |

Validation (`checkEntry`, same function in UI and engine): both fields filled; theme ≤ 12 characters, word ≤ 16; the theme must not
equal or contain the word (it would give the answer away): 「主題唔可以包住題目，會洩露答案。」 Keeping the rolled word keeps its
bank aliases for typed guesses; a typed word has none.

**iOS IME.** The fields track `compositionstart` / `compositionend`. The 出題 button inspects the composition on `pointerdown`,
*before* the tap moves focus (which makes a browser commit half-typed pinyin as plain letters), and refuses the tap that interrupted
it with 「仲輸入緊，揀好字先再㩒」; the letters stay in the field to fix. A string that is still being composed is never submitted.
Tested in a real browser with `Input.imeSetComposition`.

**Narration (cue `r{n}:qm`):** 「第 N 輪，阿B做出題者。阿B，請喺手機打一個主題同一個題目，打完㩒出題。」

### 3.2 deal — everybody looks at their card

| Screen | Shows |
|---|---|
| Every artist (fake or not — **identical layout**) | A hold-to-peek `Cover`, then four lines: role · 「主題：動物」 · the big word (the fake: ✕) · a one-line note; 「睇完喇」; 「已睇 3/6」 with one pip per seat (counts only, no names) |
| After tapping | 「✓ 睇完喇 · 等緊其他人」 (the card can still be peeked at any time, also during drawing and voting) |
| QM | the same shape: 「🧑‍🎨 你係出題者」, theme, word, 「假畫家：阿明」; no button |
| Table / spectator | 「大家睇緊自己張卡…」 + progress |

Drawing does not start until every artist has tapped 睇完喇 (research: block start until all have acknowledged). The fake's card
and a real artist's card have the same keys in the view, the same four lines, the same peek animation and sound.

**Narration (cue `r{n}:deal`):** 「第 N 輪。阿B出題。主題係「動物」。有一個人係假畫家，佢唔知題目。每個人㩒住張卡睇自己嘅，睇完㩒睇完喇。」

### 3.3 first (player mode with `first: 'qm'`, the default)

QM: 「邊個先畫？」 with a PlayerPicker over the artists; the others wait. Cue: 「阿B，請揀邊個先畫，之後順時針輪流。」 This is the
official rule and the default. It leaks a little (the QM knows the fake and could start or end with them), which is why `auto` (left of the QM) is offered.

### 3.4 draw — one stroke per turn, two laps

Everyone sees: 「輪到 ● 阿明 畫」 (「輪到你畫！」 on the drawer's phone, with the shell's 輪到你 badge and chime), 「第 1/2 圈 · 第 3/10
筆」, the order as chips `1 ● 阿明 ●○` (number, colour dot **and name** — colour is never the only cue; the dots count strokes done
against laps), the optional stroke clock, and the player's own card (peek). The QM and spectators see the same screen without
a button.

**📱 phone.** The shared `Canvas` (square, `tools: 'none'`, `color` = the seat's pen, `colorOf(pid)`, `oneStroke`, `minStrokeLen: 20`,
`me`) — exactly DESIGN §15.10: the Canvas auto-undoes a stroke shorter than `minStrokeLen` and fires `onShort`; an accepted stroke fires
`onStrokeEnd({ strokeId, length })`, after its last ink batch (`end: true`) has gone out on the same ordered channel, and only then the UI sends
`{ type: 'stroke', length }`. The drawer draws one continuous stroke; a stroke shorter than 20 units (an accidental tap) is discarded by the Canvas and the
drawer may retry (`onShort` → a toast and a soft thud). An accepted stroke locks the Canvas (green frame, 「✓ 畫完喇，等緊…」), the UI
sends `{ type: 'stroke', length }`, the engine moves the turn, the next drawer's Canvas arms. Safety nets: if the Canvas ends a stroke but
its callback never reaches the UI, the UI sends the stroke from the ink after 0.9 s; if the host has not moved the turn after 3 s a
「冇反應？再送一次」 button resends. Everyone else's Canvas has no pointer handling and keeps scrolling.

**Pens.** A stroke's colour is how everybody knows who drew it (the research: one distinct colour per artist; two players never share one).
The lobby palette has near twins (two yellows ΔE 3 apart once deepened, two blues, pinks, greens) and pale colours that vanish on the cream
sheet, so the engine deals every seat one of 12 `PENS` at setup (`view.pens`): the closest (seat, pen) pairs by hue are matched first, so a
pen resembles its seat's lobby colour. Every pen is ≥ 3.5:1 against the paper and ≥ 24 ΔE from every other pen; every seat gets a different
pen for any lobby colours; the map is the same on every phone and does not change when the QM moves (all tested). Dots, chips, the score
strip and the strokes all use it.

**📝 paper.** No canvas. Big turn card (colour dot + name), the lap line, the order chips, 「喺紙上用自己嘅筆一筆過畫完（筆唔好離開紙），
畫完就㩒「畫完」。」 The drawer's phone has the 畫完 button; the human QM also gets 「阿明 畫完喇（幫佢㩒）」 so one person can keep the
table moving. A stalled drawer is moved on by the host (代佢做 = 畫完, since the drawing happened on the paper).

**Clock (`turnSecs`).** `deadline` = now + secs at every turn start. Expiry = the stroke is given up (`kind: 'forfeit'` in phone mode,
counted as done in paper mode); the next drawer gets a fresh clock. A timer that fires early is ignored.

**Narration.** Phone: at the start 「大家睇完卡。由阿明開始，順時針每人畫一筆，一共畫 2 圈。」 and at the start of lap 2 「第 2/2 圈，由阿明開始。」
Paper: also every turn, 「輪到阿B。」 (the phone is the referee while eyes are on the paper). Cues never block play.

### 3.5 vote → tally → [revote]

All artists (fake included) vote at once on their own phone: VotePanel, pick then 「確定投俾 X」 (two taps on purpose), ballots **locked at
submit** (no 改票), no self vote, no abstain button, QM not a candidate and does not vote. During voting everyone sees only 「已投 3/6」.
The picture (phone mode) stays on screen above the ballot (small, so the ballot fits without scrolling); in paper mode: 「望住張紙，諗吓邊個畫得唔似。」
When the last ballot is in → `tally`.

**tally** (lingers 4.5 s, then moves on by itself; host 下一步 skips): the simultaneous reveal — a bar per artist, who voted for whom — and a verdict:
`🎯 揪到假畫家：阿明！` (only when caught — otherwise the fake is **not** named yet), `😏 假畫家逃過一劫…`, `⚖️ 平票！冇被指嘅人再投一次`.
Notes under it: 「平票，但假畫家喺最高票入面，所以算揪到。」 / 「舊版規則：平票一律當冇揪到。」

**Deciding "caught" (F = the fake, top = the most-pointed):**

| situation | must-guess | escape | revote |
|---|---|---|---|
| nobody voted / top empty | free | free | free |
| top = {F} | caught | caught | caught |
| top ∌ F | free | free | free |
| F ∈ top, ≥ 2 tied | **caught** | **free** | second ballot (below); if nobody is outside the tie: caught |

With 4 artists the only vote shapes are 3-1, 2-2, 2-1-1, 1-1-1-1 (4-0 is impossible). Tested exhaustively (every possible ballot × every
fake position) against an independent oracle, then sampled with 5 and 6 artists.

**revote.** Only the artists **outside** the tie vote, only for the tied. A unique winner decides (the fake → caught; anybody else → free);
a second tie falls back to must-guess (the fake was in the first top) → caught. A new `r{n}:revote` cue: 「平票！冇被指嘅人再投一次，只可以喺平票嘅人入面揀。」
Then a second tally (「再投結果」).

**Narration (cue `r{n}:vote`):** 「畫完喇！睇清楚幅畫，揀你覺得邊個係假畫家。三、二、一，投！」
**Narration (cue `r{n}:tally:{1|2}`):** 「最高票係阿明、阿B。平票。假畫家逃過一劫。」 / 「…阿C係假畫家！」

### 3.6 guess — the caught fake's one guess

Everyone sees 「🕶️ 阿明 係假畫家！有一次機會估題目」 (the identity is public now) and the picture (for the fake to look at).

| Mode | Fake | Judge | Others |
|---|---|---|---|
| 開口講 | 「🎤 你被揪出喇。大聲講出你估嘅題目，等判斷嗰個人㩒啱或者錯。」 | the word large + 「✅ 啱」「❌ 錯」, each needs a second tap (「確定「啱」？再㩒一下」) | 「阿明 大聲講緊佢估嘅題目，等 阿B 判斷…」 |
| 打字 | a field + 「就係呢個！」 + 「我唔知」; typing handled like the QM's (IME-safe) | waits | waits; the typed guess is public once sent |

**Who is the judge:** the QM in player mode; otherwise the host seat if it is a real artist, else the next artist after the fake in seat order
(`engine.setup` receives `hostPid` from the session). The judge is never the fake.

**Typed matching.** `normText` = NFKC, lower-case, spaces / punctuation / symbols removed. An exact match with the word or one of its
bank aliases (`alt`) is right on the spot (`by: 'match'`). Anything else goes to `judge` (phase `judge`): the judge sees the typed text
and the word and may overrule — synonyms, Cantonese vs Mandarin vs Japanese, specificity (「雪糕」 for 「冰淇淋」) stay a human decision.
An empty guess (「我唔知」 or a stalled fake) is wrong at once (`by: 'none'`). Exactly one guess: nothing is accepted after the verdict.

**The word never reaches the fake before the guess is locked:** the fake's view has `mine.word: null`; `guess.word` is only put in the
judge's view; the cue never says it; tests swap the word in the state and assert the fake's and the table's views and cues are unchanged.

**Narration (cue `r{n}:guess`):** 「阿明被揪出嚟喇！阿明有一次機會，大聲講出你估嘅題目。」 (打字: 「…喺手機打出你估嘅題目。」) and, when the judge has to rule on a typed
guess (cue `r{n}:judge`): 「阿B，判斷吓佢估啱唔啱。」

### 3.7 result — the whole picture and why points moved

Shown to everyone, no secrets left:

- headline: `🕶️ 假畫家贏：冇人揪到佢` / `🕶️ 假畫家贏：被揪出，但估中咗題目` / `🎨 真畫家贏：假畫家估錯題目`
- big card 題目 「大象」, chips 假畫家 ● 阿明 and 出題者 ● 阿B
- 📱 **the picture with every stroke's owner:** legend chips (colour dot + name, 🕶️ on the fake); tapping a chip greys out everybody else's strokes;
  「▶ 重播」 redraws the strokes one by one in the order they were drawn
- 📝 the drawing order per lap (the paper itself is on the table), skipped strokes marked 「（放棄）」
- the explanation lines (§5.6): the ballots, why the fake was or was not caught (including the tie rule), the guess and who ruled, the points
  (唔計分: who won the round)
- every artist's (and the QM's) +points and running total (唔計分: 「贏」 and rounds won, 「3 勝」)
- 「下一輪」 / 「睇總結」 (when this round decided the game), enabled 2.5 s after the screen appears so a stray tap cannot skip it; any artist or the QM may press it

**Narration (cue `r{n}:result`, 4 s):** 「假畫家被揪出，但估中題目，所以假畫家贏。題目係大象，假畫家係阿明。阿明，出題者阿B各得 2 分。」

### 3.8 over

`engine.result()` becomes non-null; the shell shows the results screen. `result.lines` (BACKLOG #10), two lines per round: what was hidden
during play — 「第 2/5 輪 「大象」（陸上動物）· 假畫家：阿明 · 出題：阿B — 估錯，真畫家贏 · 阿C +1、阿D +1、阿E +1」 — and why it ended so —
「　↳ 投票：阿明 3、阿C 1 → 揪到 → 開口估，錯」 (ties: 「平票都要估，算揪到」 / 「平票當冇揪到（舊版）」; revote: 「再投：…」; abstentions counted).
A voided round gets one line: 「第 3 輪（作廢，唔計）「雪櫃」（電器與科技）· 假畫家：阿C」. Then 「🕶️ 最勁假畫家（做假畫家贏）」 and 「🔍 最醒目（一眼睇穿假畫家）」.
`result.points` = the game's totals (唔計分: `{}`, nothing reaches the evening scoreboard's points); winners = the highest total, equal totals share
(「阿明、阿B 同分奪冠，各 6 分」); 唔計分: the most rounds won (「阿明 贏得最多輪（3 輪）」).
`result.carry = { lastFake, nextQm }` (host only, never in a view) hands the QM rotation and the anti-streak to the next game of 假畫家.

## 4. Single-device play and paper mode

**One phone, 📱.** The app is the QM (`config.defaults(n, prev, { singleDevice: true })` sets it, and drops any stroke clock). The shell's pass gate follows `focus`: at `deal` it walks the artists who have not looked; at `draw` it
hands the phone to the drawer (「交俾 阿B ・ 其他人唔好望」) who draws one stroke on the same Canvas; at `vote` it walks the voters (sequential secret ballots
— not simultaneous, but nobody sees a ballot before the tally); the judge gets the phone for 啱／錯. This is the "pass the phone clockwise, one stroke each" play the
research describes as fitting the official design well.

**One phone, 📝.** The same, but the phone is only passed for the private steps; during drawing the table can leave it in the middle, any seat on the
device taps 畫完 (the shell's seat switcher), or the QM keeps the table moving.

**Paper mode in general.** Needs a sheet and one pen per artist (colour = the seat colour; names and order numbers are shown too). The picture is not stored,
so the result shows the drawing order instead of a replay.

## 5. Engine

### 5.1 State (PRIVATE marked)

```
cfg                normalised config                    host         the host seat (from setup's hostPid) or null
players, order     seat order                           inkEpoch     bumped for every round started after the first
pens {pid:hex}     one distinct pen per seat (public)   cueAck       id of the last acknowledged narration line
phase, deadline, timerLabel                             qmPtr        index of the next QM (player mode)
roundNo, started, totalRounds (0 = open target game), ending          lastFake     previous scored round's fake (or carry.lastFake)
scores {pid:n}, wins {pid:n} (rounds won), stats {pid:{fake,fakeWins,caught,qm,spotted}}
history[]          finished rounds (public once finished): { n, qm, fake, word, theme, outcome, fakeSide, caught, tieRule, judge, scoring,
                   winners, round1, round2, guess, deltas } — or a voided one { n, voided: true, qm, word, theme, fake, phase }
round: {
  n, key, redo            n = the round number shown; key = rounds started (cue ids); redo = dealt again after 呢鋪唔計
  qm, artists[]           artists in seat order starting left of the QM (all seats without a QM)
  theme                   PUBLIC once dealt          word, alt[]   PRIVATE
  fake                    PRIVATE until caught / the round is over
  draft {seq,theme,word,alt}   PRIVATE to the QM        acks {pid:true}
  turnOrder[], turn, strokes[{pid,lap,kind}]     kind: ink | paper | forfeit
  vote {round, voters[], candidates[], votes{pid:target|null}}      votes PRIVATE until the tally
  tally1, tally2 {round, counts, top, votes, abstained}             public after the reveal
  caught (null while a second ballot is pending), revotePending, next ('revote' | 'guess' | 'score')
  judge, guess {text, mode, correct, by}      by: judge | match | none | auto
  rv                      the reveal object (public)
}
```

The drawing (ink) never enters state (DESIGN §15.10); the session keeps it and clears it when `inkEpoch` changes.

### 5.2 Actions

All from a seat (`pid` must be one of the players); anything else is ignored and returns the state unchanged. Nothing throws on junk (tested).

| action | phase | validation | effect |
|---|---|---|---|
| `{type:'qm-random'}` | qm-input | sender is the QM | a private draft from the bank (`draftSeq++`) |
| `{type:'qm-set', theme, word}` | qm-input | QM; both strings; `checkEntry` | deal; keeps the draft's aliases if the word is unchanged |
| `{type:'qm-auto'}` | qm-input | QM | draw from the bank and deal (host 代佢做) |
| `{type:'ready'}` | deal | an artist who has not tapped | mark; all marked → `first` or `draw` |
| `{type:'first', target}` | first | QM; `target` an artist | start the drawing from `target` |
| `{type:'stroke', length}` | draw | **phone mode**, sender is the current drawer, `length` a finite number ≥ 10 | `turn++` (`kind: 'ink'`); the last stroke → `vote` |
| `{type:'done'}` | draw | **paper mode**, the current drawer or the QM | `turn++` (`kind: 'paper'`) |
| `{type:'skip'}` | draw | the current drawer | give the stroke up (`kind: 'forfeit'`) |
| `{type:'vote', target}` | vote / revote | sender is in `vote.voters`, has not voted, target ∈ candidates and ≠ self (or `null` = abstain, used by the host) | record; all voted → tally |
| `{type:'guess', text}` | guess (typed) | sender is the fake, text a string | match → result; empty → wrong; else → judge |
| `{type:'verdict', correct}` | guess (spoken) / judge | sender is the judge, `correct` a boolean | result |
| `{type:'next'}` | result | an artist or the QM | next round, or `over` |
| `@cue-done {id}` / `@next` (host) | any | id matches the current cue / — | `@next` first acknowledges the cue, then skips the step (below) |
| `@void-round` (host, 呢鋪唔計) | any before `result` | — | the round is thrown away (no points, wins or stats; its fake does not count for anti-streak), recorded as voided for the recap; a fresh round under the same number: new word, new fake, the next QM (research: a QM who drops is replaced by the next in order), a new picture, the redo cue 「上一鋪唔計，重新嚟過。」. In `result`/`over` nothing happens (the round is already scored) |

`@next` (host 下一步, second press) per phase: `qm-input` deal a bank word; `deal` everybody counts as having looked; `first` random first drawer; `draw`
give the stroke up (paper: counts as done); `vote`/`revote` missing ballots become abstentions (flagged in the reveal, never convict); `tally` move on;
`guess`/`judge` the guess counts as wrong; `result` next round.

### 5.3 advance / deadline

- `draw` with `turnSecs`: the stroke is given up, the next drawer gets `now + turnSecs`.
- `tally`: 4.5 s, then `revote` / `guess` / score.
- All other phases have no deadline. A timer that fires early is ignored.

### 5.4 view (whitelist), focus, canInk

- `view(state, pid)` builds a fresh object: `me, phase, title, subtitle, round {n, total, key, redo}, mode {…, scoring}, qm, artists, seats, pens, scores, wins, theme, fake` (null until caught / round over),
  `myRole` (`artist` / `fake` / `question-master`, own role only), `mine` (the card: `{role, theme, word}` — `word: null` for the fake — and `fake` only for the QM),
  `draft` (QM), `ready`, `first`, `draw` (`current, lap, laps, total, turn, order, counts, canDraw, canDone, minLen`), `vote` (`candidates, voters, done, total, canVote`, and `myVote` only the viewer's own),
  `tally` (after the reveal), `guess` (`judge, stage, text, canGuess, canJudge`, `word` for the judge only), `reveal`, `last`, `deadline`, `hint`.
- `focus`: `qm-input`/`first` → QM; `deal` → artists not yet looked; `draw` → the drawer; `vote`/`revote` → voters not yet voted; `guess` → the judge (spoken) or the fake (typed);
  `judge` → the judge; otherwise `null`.
- `blocking(state, pid)` (stall detection): exactly the seats in `focus`; nobody during the tally linger or on the result screen (anyone may
  press 下一輪 there, so a dead phone holds nothing up). Tested: whenever there is no deadline and no result, somebody is blocking, has a legal
  action, and 代佢做 moves the game.
- `canInk(state, pid)`: phase `draw`, phone mode, `pid` is the current drawer.

### 5.5 autoAct (a stalled seat)

`qm-input` → `qm-auto`; `deal` → `ready`; `first` → the first artist; `draw` → `skip` (phone) / `done` (paper); `vote`/`revote` → abstain; typed `guess` → an empty guess;
spoken guess and `judge` → 「錯」; `result` → `next`. An automatic action never convicts and never hands the fake a win.

### 5.6 Results and explanation

| outcome | headline | points |
|---|---|---|
| `escaped` | 假畫家贏：冇人揪到佢 | fake +2, QM +2 (player mode) |
| `guess-right` | 假畫家贏：被揪出，但估中咗題目 | fake +2, QM +2 |
| `guess-wrong` | 真畫家贏：假畫家估錯題目 | every real artist +1 (however they voted); fake and QM 0 |

唔計分 (`scoring: 'none'`): no deltas; the round's winners are the fake (+ the QM) or every real artist, counted in `wins`.

With the app as QM the QM share simply does not exist (research: single shared phone / app QM). No negative points, no other bonuses. Game end: the first to reach `target` (checked when
the round is scored; overshoot is legal) or after `rounds` rounds. Several players over the target in one round: highest total wins, equal totals share (documented in the rules text).

`rv.lines` (shown on the result screen, kept in `result.lines`) explain each point, for example:
「投票：阿明 2 票、阿B 2 票、阿C 1 票」 · 「平票（阿明、阿B），但假畫家喺最高票入面，所以都要估題目。」 · 「阿明 估「犀牛」，阿B 判：錯。」 ·
「每個真畫家 +1：阿C、阿D。假畫家同出題者冇分。」

### 5.7 Hints (BACKLOG U1)

`view.hint` — one line 「而家要做咩」, ≤ 40 characters (tested for every phase and seat, names included), shown only when the player taps 💡. **Role-neutral until the fake is named**: a test swaps the fake and asserts
every other seat's hint (and every public cue) is unchanged. Roles are explained in the 💡 sheet through `view.myRole` / `view.mine.role` and `rules.roles` (what you do + 點贏).
`rules.quick` is 6 short lines (≤ 40 characters).

| phase | hint (examples) |
|---|---|
| qm-input | QM 「你係出題者：打主題同題目（或㩒🎲），再㩒「出題」。」 / others 「等阿B出題。主題公開，題目淨係真畫家知。」 |
| deal | 「㩒住張卡睇題目（假畫家只見到 ✕），睇完㩒「睇完喇」。」 |
| draw | drawer (phone) 「輪到你：喺畫板一筆過畫完，放手就算一筆。」, (paper) 「…畫完再㩒「畫完」。」 / others 「睇住阿明畫；留意邊個畫得唔似。」 / QM 「你唔使畫，睇住大家畫；假畫家贏，你都贏。」 |
| vote | 「揀你覺得係假畫家嘅人再確定；唔可以投自己。」 |
| guess | fake 「你被揪出：打出你估嘅題目，只有一次機會。」 / judge 「聽佢估咗乜，啱就㩒「啱」，唔啱㩒「錯」。」 |
| result | 「睇吓題目、假畫家同邊個贏，再㩒「下一輪」。」 |

## 6. Edge cases → tests (`tests/fake-artist.test.mjs`)

| case | test |
|---|---|
| module shape, `index.js` is the §15.1 module | `module shape`, `index.js is the §15.1 module…` |
| defaults valid for every head-count; fields/summary; tastes kept, junk ignored | `config defaults…`, `config.defaults keeps tastes…`, `config.validate rejects nonsense…` |
| presets with a reason, valid and playable (#8) | `#8 presets…` |
| `rules.quick` ≤ 6 lines, roles say what and how to win (U1) | `U1 — rules.quick…` |
| the bank: drawable + excluded categories partition it, no leaky theme/word, filters honoured, a missing bank never kills a round | `the shipped draw bank…`, `bank draws never hand the fake the answer…`, `a missing or empty bank…` |
| one fake, app / player QM, QM rotates left, first QM random, fake uniform, first drawer random (#20), anti-streak | `app QM…`, `player QM…`, `the fake is dealt uniformly…`, `option antiStreak…` |
| QM input validated; 🎲 draft private; aliases kept; wrong actors ignored | `the QM types…`, `QM entries are validated…`, `🎲 qm-random…`, `the QM knows the word…` |
| first drawer: auto / random / QM picks | `first drawer…` |
| the fake's card has the same shape as a real artist's | `the fake and the real artists get a card of exactly the same shape…` |
| drawing waits for everyone to look | `drawing waits until every artist has looked…` |
| clockwise, 2 laps, 2 × artists strokes, never twice in a row — both modes | `phone/paper — clockwise, 2 laps…`, `laps 1 and 3…` |
| only the drawer inks, a tap is not a stroke; paper `done` rules | `phone mode — only the current drawer…`, `paper mode — nobody inks…` |
| forfeit by skip / autoAct / host; stroke clock | `a stroke is given up…`, `option turnSecs…` |
| fresh picture each round; state never holds ink; the real Session | `the picture is a fresh epoch…`, `with the real Session…` |
| ballots: no self vote, QM out, locked, hidden until the last; abstentions | `ballots…`, `a stalled voter is abstained…` |
| every tie rule vs an oracle: all 4-artist ballots × fake position, sampled 5–6 | `tie rule must-guess/escape/revote — every possible ballot…`, `…also holds with 5 and 6 artists`, `the v1 booklet example…`, `must-guess — F in a tie…` |
| revote: who votes, who is a candidate, every second ballot; everyone tied | `revote — only the artists outside the tie…`, `revote when everybody is tied…`, `revote — the screens and cues…` |
| spoken / typed guess, matching, judge overrule, stalled guess, not caught = no guess | `spoken guess…`, `app QM — the judge is the host seat…`, `typed guess…`, `a stalled guess / judge…`, `not caught…` |
| exact points both QM modes; no double awards; target / overshoot / co-winners; rounds mode | `points-v1…`, `the fake and the QM are different players…`, `first to the target wins…`, `endMode rounds…` |
| results explain why (#10); the reveal object | `result lines explain every round…`, `the reveal object…` |
| privacy by swapping secrets (fake, word) across a whole random game; whitelisted views | `privacy — the fake, the word and the ballots do not leak…` (4 configs), `views are whitelisted…` |
| hints exist for every phase/seat, role-neutral (U1); cues unique, never the word | `U1 — every phase has a short hint…`, `narration cues…`, `host 下一步…` |
| focus, legalActions, junk input | `focus names…`, `legalActions offers exactly…`, `junk actions…` |
| fuzz: every head-count × draw mode × QM mode × tie rule × guess mode; the real bank | `fuzz — random legal play terminates…`, `fuzz on the real bank…` |
| pure helpers (pen colours on the cream sheet, stroke length, matching) | `penColor…`, `strokeLength / matchesWord / tidy helpers` |
| one-phone defaults (`singleDevice`); warnings that were wrong or noisy | `config.defaults with { singleDevice }…`, `config.validate rejects nonsense…` |
| host 呢鋪唔計 in every phase: nothing scored, same number, next QM, new picture, unique cue ids, recap; through the real Session | `host 呢鋪唔計 (@void-round)…`, `@void-round through the real Session…` |
| `blocking` = focus; never in tally/result; no silent deadlock; 代佢做 always moves the game | `blocking — the table waits exactly on…` |
| `carry`: QM rotation and anti-streak across games; junk ignored | `carry — the QM rotation and antiStreak run on…` |
| 唔計分 (none-v2): no points, round winners, most rounds wins, fields | `唔計分 (none-v2, the current print)…` |
| distinct pens for any lobby colours, contrast, same map everywhere | `pens — every seat gets its own pen…` |
| random voids × both scorings × every head-count | `fuzz with 唔計分 and the host voiding rounds at random…` |
| the UI (fake DOM): every phase × seat × 3 set-ups, no early word for the fake / table, no junk text; every control sends what the engine accepts (ready, stroke after `onStrokeEnd` only once per turn, nothing on `onShort`, vote, judge's two taps, typed guess, 畫完 / 幫佢㩒, QM entry refused when the theme names the word, 下一輪 locked for a beat) | `UI (fake DOM) renders every phase…` |

Browser checks done (own headless Chrome via CDP, iPhone-size viewport, the real app in local mode): deal with peek (fake vs artist), pass gates, ten strokes drawn on the
real Canvas with the mouse (an accidental tap on turn 3 was discarded and did not advance the turn), vote/tally/guess/result in both draw modes, the typed-guess and
QM-typing screens, IME composition (programmatic click and real press while composing both refused), highlight and replay in the result, and a UI fuzz that mounted
the UI for three seats through 14 complete games (3 741 renders: no exception, no "undefined"/"null"/"NaN" text).

## 7. 貼心 touches

- Colour is never the only cue: dot + name + order number everywhere; every seat has its own dark pen (no look-alike yellows).
- The card can be peeked again at any time during drawing and voting, so nobody has to remember the word.
- 「睇完喇」 shows a count, not names, so how long anybody takes tells nothing.
- Theme/word leak guard on both sources (bank categories vs words and aliases; the QM's typing).
- Tap-to-highlight and ▶ 重播 in the result turn the picture into the "why".
- Host 代佢做 never decides a vote and never gives the fake a win.
- Draw-start cue is short and non-blocking; paper mode announces every turn because eyes are on the sheet.
- All sound is shared SFX (`lock`, `deal`, `reveal`, `deny`); nothing differs between the fake and the others.

## 8. Framework requests

Already done by the framework and adopted here: the registry entry mirrors the game's meta (`players: [3, 10]`; the G16 test enforces it);
`Session` passes `hostPid` to `engine.setup` (BACKLOG G1), so in app-QM mode the host seat judges the fake's guess (a real artist, else the next artist
after the fake), and `Sim` passes `hostPid: 'p1'`; `carry` (rotation + anti-streak across games); `config.defaults(n, prev, { singleDevice })`;
`@void-round` (呢鋪唔計); `engine.blocking` for stall detection.

Still open:

1. **Result screen picture.** The Canvas ink survives until the next round's epoch, so the game's own result screen shows the full picture; the shell's *final*
   results screen (after `over`) cannot, because the session stops. If a keepsake picture is wanted there, the shell would need to keep `ink` and render a view-only Canvas.
2. **Narrator bar over the board.** On the host's phone the fixed NarratorBar can cover the lower part of the Canvas while a cue is unacknowledged (the page scrolls, but
   a drawer who is also the host loses the bottom of the sheet). A compact bar (or auto-collapse after the cue is spoken) while a Canvas can draw would help.
3. **A 「呢鋪唔計」 button.** `app.hostCtl.voidRound()` exists but no screen calls it yet. The host ⋯ menu needs it (two taps, it throws a round away);
   when it returns false (here: on the result screen, where the round is already scored) a toast such as 「呢輪已經計咗分，㩒下一輪就得」 instead of silence.
