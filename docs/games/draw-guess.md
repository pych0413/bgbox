# 你畫我猜 (draw-guess) — play-flow spec

> Rules source: `docs/research/draw-guess.md` (paraphrased from the publisher sheets and the online-game conventions;
> nothing copied). Its "## Verification" section (fact-check 2026-10-03 UTC) overrides the draft; this spec follows the
> verified text. Where it deviates, §9 says so and why.
> Code: `js/games/draw-guess/{game,judge,fold,script,ui,index}.js` + `style.css`, tests: `tests/draw-guess.test.mjs`.
> Template: `docs/DESIGN.md` §15.9. All times UTC. All player-facing text is Hong Kong Cantonese.
> QA pass against the verified rules: 2026-10-03 UTC (see §9 and §10).

## 1. At a glance

| | |
|---|---|
| Players | 3–12 (free-for-all); 4–12 in teams (2–4 teams of 2+) |
| Length | 7–12 turns at about 1.5–2 minutes (FFA: 3 players draw 3×, 4–6 draw 2×, 7+ draw 1×) ⇒ roughly 12–22 minutes |
| Narration | optional. Shout play: short public lines (who draws, hints as they appear, who got it, the answer at the reveal, the leader after a cycle). **Typed play is silent** — `cue()` is always `null`, no beeps, no dings (it is for quiet places) |
| Single device | `partial` — works in 🗣️ 講出口 mode (paper or phone canvas); ⌨️ 打字估 needs one phone per player |
| Banks | `draw` (`js/data/draw-words.js`, flattened by the bag to `{ w, alt, level, cat }`, 1,811 words, 47 categories) |
| Paper mode | yes (📝 實體紙筆) |

**Setup choices (all in the lobby).**

| | |
|---|---|
| 畫喺邊 | 📱 **手機畫板** (default): the shared `Canvas`, tools `full` for the drawer, live on every phone · 📝 **實體紙筆**: a real sheet of paper; no phone shows a canvas; the phones deal the word to the drawer only, run the clock and the hints, and score |
| 點樣估 | 🗣️ **講出口** (default): players shout, the drawer taps who got it · ⌨️ **打字估**: typed guesses are checked automatically |
| 玩法 | **各自為政** (default, speed scoring) · **分隊** (Pictionary style, 4+ players) |

Both drawing modes work with both guessing modes (four combinations, one engine).

**What the phones do.** Deal three words (easy / medium / hard) to the drawer, keep the clock and the hint clock,
show the length mask and the hints, check typed guesses (aliases, simplified/traditional, close misses), run the
shout-mode confirmation and buzzer windows, score every turn, keep the foul flags (and, in teams, stop the clock for the
host's ruling), show the leaderboard after every cycle, remember every word and every result.
**What happens at the table.** The drawing (on paper, or with a finger), the shouting, spotting fouls.

## 2. Setup

### Config

| key | UI label | type | default | notes |
|---|---|---|---|---|
| `drawMode` | 畫喺邊 | select `canvas` / `paper` | `canvas` | |
| `guessMode` | 點樣估 | select `shout` / `typed` | `shout` | typed warns 「打字估要每人用自己部手機」 |
| `teamMode` | 玩法 | select `ffa` / `teams` | `ffa` | `teams` needs n ≥ 4 |
| `teams` | 幾多隊 | int 2–4 | 2 | only with teams; `teams × 2 ≤ n` |
| `teamAssign` | 點分隊 | select `alternate` / `shuffle` | `alternate` | alternate = by seat order (A B A B …), so opponents sit between teammates; changing the seat order in the lobby changes the teams |
| `teamRounds` | 每隊畫幾次 | int 0–8 | 0 = auto | auto: 2 teams → 5 (4 when no team has more than 2), 3 teams → 4, 4 teams → 3 |
| `starsAsPoints` | 難詞多分 | bool | false | teams: a solved word is worth 1 / 2 / 3 (its tier) instead of 1 |
| `cycles` | 每人畫幾次 | int 0–5 | 0 = auto | auto: n = 3 → 3, 4–6 → 2, 7–12 → 1 |
| `roundSeconds` | 每輪時間 | select 0 / 45 / 60 / 80 / 100 / 120 / 150 / 180 | 0 = auto | auto: shout 80, typed 100 (typing on an iPhone costs time); teams: shout 60, typed 80. Any 30–180 is valid |
| `hints` | 提示（類別、揭開字） | bool | true | off → only the length mask |
| `strictness` | 打字估嘅嚴格度 | select `strict` / `standard` / `loose` | `standard` | typed only, see §5.7 |
| `topics` | 詞庫類別 | categories `{ cats: [...], levels: [1,2,3] }` | all, all | the ConfigForm shape (a bare array is tolerated). `levels` = which tiers may be offered. The field carries `bank: 'draw'` + `matches(value, entry)` (= `topicMatch`), so the lobby prints 「已用 / 總數」 and offers 重置 from the bag (BACKLOG #11) |

`config.defaults(n, prev, env)` keeps the previous choices (sanitised), falls back to FFA when n < 4, clamps `teams`
to ⌊n/2⌋, and with `env.singleDevice` (the Room passes it: one device holds every seat) **never keeps typed** — a
pass-the-phone table always starts on 🗣️ 講出口; the drawing mode and the rest are kept. `cycles`, `teamRounds` and
`roundSeconds` are `0 = auto`, so they follow the head-count and the mode by themselves. Summary lines (lobby):
「6 人：每人畫 2 次，共 12 輪 · 約 22 分鐘」 · 「📱 手機畫板」 · 「🗣️ 講出口」 · 「每輪 80 秒」 · optional 「冇提示」,
「難詞多分」, 「類別：…」, 「難度：…」.

### Presets with a reason (BACKLOG #8)

`config.presets(n, env?) → [{ id, label, reason, cfg }]`, `cfg` a patch over the current config (the lobby renders
them as one-tap chips: `{ ...config, ...cfg }`). Every one passes `validate` for the head-count it is offered for
(tested for 3–12).

| id | label | patch | reason (example for 6) |
|---|---|---|---|
| `classic` | 經典：講出口＋紙筆 | shout, paper, FFA | 「6 人：一張紙、一支筆，手機派詞、計時、計分 — 最似真 Pictionary」 |
| `phone` | 手機畫板 | shout, canvas, FFA | 「6 人：冇紙冇筆都玩到，大家望住同一幅畫，用口講」 |
| `quiet` (not with `env.singleDevice`) | 靜靜哋（打字） | typed, canvas, FFA | 「6 人，新幹線、餐廳咁嘅地方：每人用自己部手機打字估，畫即時傳到每部手機」 |
| `teams` (n ≥ 4) | 分隊（Pictionary） | teams, 2 teams | 「6 人分 2 隊（3、3）：合作多啲、搶分少啲」 |

The head-count reason is also the help line of 每人畫幾次: 「6 人：每人畫 2 次，共 12 輪，大約 22 分鐘 — 最啱玩嘅人數。」

### Validation

`config.validate(cfg, n, env?)`. Errors (block start): head-count outside 3–12; an unknown enum value; a number out of
range or not an integer (numeric strings from a `<select>` are accepted); teams with n < 4; `teams × 2 > n`.
Warnings: typed (one phone per player — with `env.singleDevice` the stronger 「一部手機唔啱打字估：其他人冇得打字。請揀
「講出口」。」); typed + paper (「大家望住張紙，用自己部手機打答案」); more than 16 turns (says the minutes); uneven
teams (「隊伍人數唔平均…」); 10+ players FFA (「分隊玩會更緊湊」); typed with 3 players; exactly one category (no
category hint, smaller pool). Typed on one phone is a warning, not an error: it can be played (the phone goes round),
just badly.

### Dealing words

Every turn deals three words, one per allowed tier (a tier filter of fewer than three tiers repeats the allowed ones):
1. `bag.draw('draw', filter)` with filter = right tier ∧ category ∧ **not seen this game**. A pool that is empty
   falls back, in order: the other allowed tiers (nearest first) → any tier → any category → the built-in emergency
   list (12 words), so a turn never dies — even if the bag throws (bank not loaded) or the bank is empty.
2. The three words are shown sorted by tier. All offered words are added to `state.seen`, so neither a re-roll nor a
   later turn offers them again this game.
3. The picked word stays "used" in the persistent bag (draw without replacement across games and evenings). The
   unpicked ones are given back with `ctx.bag?.release?.('draw', w)` — optional-chained on purpose: with a bag that has
   no `release` (older core, the test harness) they simply stay used. A voided turn gives its word back the same way.
4. The first drawer is random over **all** seats; then seat order, repeated `cycles` times — everybody draws the same
   number of times (backlog #20). In teams: round-robin over the teams from a random team, drawers rotating inside a team.
   The next three drawers are public (`view.upNext`, the research's "queue preview").

## 3. Flow

Phases: `choose` → `play` → `reveal` → (`standings` after a full cycle) → `choose` of the next turn … → `over`.
A turn is one drawer with one word. `play` has sub-steps `run` · `grace` · `buzzer` · `ruling` (teams).

### 3.1 choose — the drawer picks one of three

| Seat | Shows |
|---|---|
| Drawer | 「揀一個詞嚟畫」, three big cards — tier (⭐ 簡單 / ⭐⭐ 中等 / ⭐⭐⭐ 困難), the word, 「類別 · N 隻字 · 最多 30／45／60 分」 (teams: 「全隊 +1 分」 or 「+n 分」) —, a 「🔄 唔鍾意？換一批（得一次）」 button (two taps) and a 20 s clock. Paper mode adds 「先攞定張白紙同支筆」 |
| Everyone else | 「✏️ 阿明 揀緊詞…」 (teams: with the team), 「之後到：阿B → 阿C → 阿D」 and the scores |

20 s (research: 12 s — §9). Time out → the **medium** card is picked. Re-roll: once per turn; burns the three words for
this game and restarts the 20 s. The canvas clears here (`inkEpoch` bump, canvas mode only).
**Narration (cue `t{n}:choose:first|again`):** 「第 {n} 輪，{drawer}畫。{drawer}，請揀一個詞。」 (teams: 「…，{隊}嘅{drawer}畫。…」)

### 3.2 play — draw and guess

The clock starts at the pick: `T` = `roundSeconds`. `deadline` in the view is the END of the turn.

**Hint clock** (fractions of `T`; pause-safe, see §5.1):

| elapsed | public hint |
|---|---|
| 0 | the length mask: one box per character (spaces and hyphens show as a gap and are never revealed) |
| 1/4 | the category chip — skipped when the host filtered to one category |
| 1/2 | one character is revealed (words of 2+ characters) |
| 3/4 | a second character (words of 4+ characters) |

`reveals = min(2, ⌊L/2⌋)` characters, positions drawn at the start of the turn and never changed. A one-character word
only gets the category. Hints never change points themselves — time does.

**Every seat, the drawer's too:** the timer, the mask, 「類別：稍後提示」 → the category, who has already got it
(「✅ 阿B」). The drawer's seat shows them because on a single shared phone that seat IS the table's screen.

**Drawer's seat** additionally: the word behind a 「👁 㩒一下睇個詞」 chip (tap → shown for 2.5 s, plus the accepted
aliases 「都接受：…」); canvas mode: the **canvas with full tools** (8 colours, 3 widths, eraser, undo, clear); then for
- 🗣️ shout: 「邊個估中？㩒佢個名」 — one chip per eligible guesser;
- ⌨️ typed: the live feed of everybody's guesses (newest first) with a ✔ per guess that the checker did not accept;
and a two-tap 「🏳️ 放棄今輪（大家 0 分）」. Paper mode: the word sits behind a hold-to-peek `Cover` (「㩒住睇個詞」) and
there is **no canvas on any phone**. The prompt line: 「喺畫板上畫，唔准講嘢、寫字同數字。」 / 「用紙筆畫，唔准講嘢、寫字同數字。」

**Guesser's seat:** the picture (canvas mode), and
- 🗣️ shout: 「睇住個畫板，大聲講出你嘅答案，畫家會㩒你個名。」 (paper: 「睇住張紙…」)
- ⌨️ typed: a text box + 「送出」 and 「估錯唔扣分 · 已打 3/60」. Close misses show only to the sender (「大魚吃小 好接近！」);
  the table sees 「🔥 好接近！」 without the text. A solved guesser gets 「✅ 你估中咗！靜靜哋等其他人，千祈唔好講出答案。」
  and the input disappears.
FFA: every non-drawer has a two-tap 「🚩 犯規？」 with the count against the threshold (§5.5).

**Rival's seat** (teams, the other team's turn) and **spectators**: the same public screen without an input;
「呢輪係 🔵 藍隊 畫同估，你唔使估；見到犯規可以㩒 🚩。」 — a rival's 🚩 stops the clock (§5.5).

**Host's seat** additionally shows a 「主持」 bar: 「＋30 秒」, a two-tap 「作廢今輪」 (§5.3) and, while a team foul
is pending, 「🚩 成立（今輪冇分）」 / 「唔成立，繼續」. The bar stays (it is the one-tap shortcut when the host plays on their own
phone); the **host phone's ⋯ menu** carries ＋30 秒 and the two rulings as well (`engine.hostActions`, §5.2), so on one shared
phone they are reachable whichever seat is on screen. 作廢 is *not* repeated there: the shell's own 🗑️ 呢輪作廢 (with its confirm)
sits in the same menu and sends `@void-round`, which voids exactly the same turns.

**Shout-mode resolution** (research "Voting & resolution B"):
1. The drawer taps a name → a **3 s grace window** opens (「✅ 確認緊 — 仲有人同時估中就加埋，揀錯可以撤銷」, a
   「確認中」 clock). The first tap fixes `r`; every further tap inside the window is a co-winner with the **same** `r`;
   each solved chip shows 「✅ ↩」 and tapping it undoes that one. Undoing the last one resumes the turn **with the
   clock exactly where it was** (it is frozen during the window, §9).
2. When the window closes the turn ends — even past the deadline.
3. Nobody tapped by the deadline → a **2 s buzzer window** (「⏰ 時間到 — 最後一刻有人講啱，仲㩒得到」, 「補㩒時間」):
   every tap in it scores with `r = 0`, each can be undone (「✅ ↩」) until the window closes, and the turn ends when it
   closes (`solved` if anyone is left tapped, else `timeout`). A tap does not extend the window. A tap that reaches the
   host after the deadline but before its timer fired lands in the same window (it closes 2 s after the real end; the
   overdue hints fire first); later than 2 s it is ignored.

**Typed-mode resolution:** every guess is judged by the engine (§5.7). Correct → the guesser is a solver (scored at that
moment), the table sees 「✅ X 估中咗」 without the text, and the guesser is locked out. The turn ends at the deadline
(no buzzer window) or the moment **every eligible guesser** has solved. Guesses after the deadline are ignored.
The drawer's ✔ overrides the checker for one guess; it counts at that guess's own time.

**Narration (shout only):** `t{n}:play` 「開始！限時 80 秒。答案有 N 隻字。估到就大聲講出嚟。」; each hint as it appears
`t{n}:s{k}` 「提示：類別係「食物」。」, 「提示：第二隻字係「虎」。」; a tap `t{n}:got:…` 「阿B估中咗！」; a team foul
`t{n}:ruling:{k}` 「暫停！🔵 藍隊話畫家犯規，請主持裁決。」. A line acknowledged once in a turn is never repeated (after a
ruling the old hint line does not come back).

### 3.3 reveal — the answer

**7 s for every turn**, the last one too (research 2.5). Everyone sees: 「🎉 阿B、阿C 估中」 (or 「⏰ 時間到，冇人估中」 /
「🏳️ 阿明 放棄咗呢條」 / 「🚩 犯規成立，🔵 藍隊 今輪冇分」 / 「⚠️ 作廢…」), the word big with its tier, category and aliases,
the points line 「阿B +34 · 阿C +34 · 阿明（畫）+28」 (teams: the team and its point), the final picture (canvas mode;
paper mode 「睇返張紙上嘅畫，對吓答案。」), 「自動下一輪 · 6 秒」, and the score strip with the deltas.
- Nobody skips it from a seat (the old drawer 「下一位」 is gone: it also cut the 5 s foul window short). The host's ⏭
  (`@next`) skips it.
- **For 5 s** (the "late window") a guesser may still flag 🚩 (only on a solved turn — there is nothing else to take
  away) and, in typed mode, the drawer may still ✔ a guess it forgot — both re-score the turn (§5.4). In teams a rival's
  late 🚩 freezes the reveal for the host's ruling. After the window the turn is final, except that the host may still
  作廢 it (a dead phone noticed only when the clock ran out).
**Narration (cue `t{n}:reveal:{outcome}[:foul]`):** 「答案係「老虎」。阿B、阿C估中。」 (+ 「不過犯規成立，畫家冇分。」) ·
「時間到，冇人估中。答案係「老虎」。」 · 「阿明放棄咗今輪，答案係「老虎」。」 · 「犯規成立，今輪冇分。答案係「老虎」。」 ·
「今輪作廢，唔計分，之後會補返。」

### 3.4 standings — after every full cycle

After the reveal of the last turn of a cycle (FFA: everybody drew once; teams: every team drew once), and never after
the last turn of the game nor for re-queued turns, a **5 s leaderboard** (research step 3): 「第 1/2 圈完 · 而家排名」,
the ranked scores (teams: the team totals), 「下一個畫：阿B」, 「下一圈 · 4 秒」. The host's ⏭ skips it.
**Narration (cue `c{k}:standings`):** 「第一圈完。阿明領先，85 分。」 (ties: 「阿明、阿B同分領先…」).

### 3.5 over

`result()` becomes non-null; the shell shows the results screen. `result.lines` come in three foldable sections
(`'── 標題 ──'` lines, which the results screen turns into sections):
- `── 排名 ──` 🥇 阿明 142 分（估中 5 次 · 畫畫得 61 分） … (teams: 🥇 🔴 紅隊 4 分（阿明、阿B、阿C）);
- `── 亮點 ──` 「🎨 最勁畫家：…（平均每次畫得 21.5 分）」, 「⚡ 最快反應：阿B（3.2 秒估中「老虎」）」, 「⭐ 最多困難詞估中：…」;
- `── 每輪重溫 ──` **one line per turn** (BACKLOG #10 — who drew which word, who got it, the points, fouls):
  「第 3 輪 · 阿明 畫「摩天輪」⭐⭐ — 阿B 估中 ｜ 阿B +34 · 阿明（畫）+28」.
`result.points`: every winner (all tied winners) gets **1 evening point**, the others 0 (research "How the game ends");
the in-game scores stay in the lines. The results screen keeps the game's pictures as a keepsake (shell).

## 4. Single-device play and paper mode

**Paper mode** (any head-count, multi-phone or one phone): the drawer's phone shows the three cards, then the clock, the
mask and hints, the shout chips (or the typed feed) and the word behind a hold-to-peek cover; everybody else's phone
shows the clock, the mask and the hints. **No phone shows a canvas** and no ink travels (`canInk` is false, the session
drops any stroke). Shout and typed guessing both work: typed players look at the paper and type on their own phones.
After the word is dealt nothing needs the network.

**One shared phone, 🗣️ 講出口 only.** `config.defaults` never keeps typed when `env.singleDevice`, `presets` drop the
typed one, `validate` warns if typed is chosen anyway. `focus` names the drawer during `choose` and `play`, so the shell
puts a PassGate in front of each drawer (「交俾 阿明 ・ 其他人唔好望」). The drawer taps a card behind the gate, then
lays the phone flat in the middle: it keeps showing the drawer's seat — the clock, **the mask and the hints**, and the
name chips. The word stays behind the peek chip / hold-to-peek cover, so the table cannot read it off the screen
(tested: no non-drawer seat view and no table view on that device ever holds an unrevealed character or an unpicked
offer, and the drawer's screen never shows the word unless tapped). In canvas mode the drawer draws on that phone and
everybody watches; in paper mode the phone is just the clock. During `reveal` / `standings` `focus` is `null`.
On one phone only the active (drawer's) seat is on screen during play, so 🚩 is not reachable: fouls are settled at the
table; the host's ⋯ menu has ＋30 秒, the foul ruling (`engine.hostActions`) and 🗑️ 呢輪作廢 (`@void-round`) for whichever seat is on screen.
⌨️ typed needs a phone per player: one phone cannot type for everybody.

## 5. Engine

### 5.1 State (PRIVATE marked)

```
cfg              normalised config + the resolved auto values (seconds, cycles, teamRounds, totalTurns)
players, order   seat order;  hostPid (the host's seat, or null)
teams            null | [{ members: [pid] }]       teamOf { pid: teamIndex }
queue[]          [{ drawer, team, again? }]        qi = index of the current turn; grows by one per voided turn
phase, deadline, timerLabel, revealMs, inkEpoch
scores {pid:n}, teamScores [n]                      DERIVED from history by recompute() after every change
seen[]           words offered this game (PRIVATE: the offers are secret until picked)
history[]        one public-after-the-fact entry per finished turn:
                 { n, drawer, team, w, alt, level, cat, outcome, solvers[{pid,rem,T,via}], E, flags, fouled, again,
                   solverPts{}, drawerPts, teamPts, deltas{} }
turn {
  n, drawer, team, eligible[], again
  offers[]       PRIVATE until picked      rerolls
  word           PRIVATE { w, alt, level, cat }
  boxes, reveals[]  PRIVATE (indexes)      shown (how many are public), showCat, stage, log[]
  T              total ms (grows with +30 s)
  sub            'choose' | 'run' | 'grace' | 'buzzer' | 'ruling' | 'done'
  pending[]      hint events still to fire (['cat','r','r'])      then[]  ms from each event to the next thing
  grace          { rem, T, restore: { in, pending, then } }   restore = where the frozen clock resumes
  ruling         null | { by, phase: 'play'|'reveal', sub, in, label }   a team foul holding the clock (deadline null)
  upheld         a team foul was upheld this turn
  solvers[]      sorted by how early they solved (more time left first)
  guesses[]      { id, pid, text, kind, rem, T, via? }  — PRIVATE text (the view decides who sees it)
  rate{}, seenG{}   per-player guess spacing / burst lock / normalised duplicates
  fouls[]        pids that flagged       outcome  null | 'solved' | 'timeout' | 'abandoned' | 'voided' | 'fouled'
  acked[]        cue ids acknowledged this turn
}
cueAck
```

**The clock.** The only absolute time in the state is `state.deadline`: the next thing that must happen (the next hint
event, or the end of the turn, or the end of a grace / buzzer window, the reveal, the standings). Everything else is a
duration relative to it (`turn.then`). The end of the turn is `deadline + Σ then`. A host pause shifts `deadline` and so
the hint chain and the end together; `advance` ignores a timer that fires early. `r = clamp(remaining / T)` is computed
from the end at the moment of the tap or guess; only integer arithmetic touches the points (`roundDiv`). A team foul
ruling stores the time left and sets `deadline = null`; the ruling restarts it.

### 5.2 Actions

All from a seat (`pid` must be a seat); anything else is ignored and returns the state unchanged.

| action | phase | validation | effect |
|---|---|---|---|
| `{type:'pick', i}` | choose | drawer, `i` integer 0–2 | word chosen, the other two offers released, clock starts |
| `{type:'reroll'}` | choose | drawer, first time | three new words, 20 s restart |
| `{type:'accept', target}` | play, shout | drawer; target eligible and not solved; sub `run` (or up to 2 s past the end), `grace`, `buzzer` | see §3.2 |
| `{type:'undo-accept', target?}` | play, shout, `grace` or `buzzer` | drawer; target or the last solver | remove; grace empty → the clock resumes |
| `{type:'guess', text}` | play, typed, `run` | eligible, not solved, non-empty after trim **and** after dropping punctuation, ≤ 30 code points, not after the end, not a duplicate (normalised), ≥ 700 ms since the last, not locked, < 60 used; a 7th guess inside 10 s is refused and locks the player for 5 s | judged by `judge.js`; right → solver |
| `{type:'accept', gid}` | play (`run`) or the first 5 s of reveal (only if the turn was `solved` / `timeout`), typed | drawer; the guess exists, not right yet, its author not solved | counts at the guess's own time; in the reveal it re-scores the turn |
| `{type:'foul'}` | play (`run` / `grace` / `buzzer`), or the first 5 s of a **solved** turn's reveal | FFA: any non-drawer seat, once, until the threshold is met · teams: a **rival**, once per turn, no ruling pending | FFA: counts (§5.5) · teams: opens the ruling |
| `{type:'rule', uphold}` | a pending ruling | **host seat**, `uphold` boolean | §5.5 |
| `{type:'abandon'}` | play (`run`, `buzzer`) | drawer | outcome `abandoned` |
| `{type:'extend'}` | play (`run`) | **host seat** (`hostPid`) | +30 s (`T` too), max 10 min |
| `{type:'void'}` | choose, play, reveal (not already voided) | **host seat** | outcome `voided` |
| `@cue-done`, `@next` (host) | any | `@next`: first press acknowledges a pending cue, then it skips: choose → medium card, play → end now (or a pending ruling → not upheld), reveal → on, standings → next turn | |
| `@void-round` (host, `ACT.VOID_ROUND`) | choose, play, reveal | — | the same as `void` (the shell's 呢鋪唔計) |
| `extend` / `void` / `rule` from `@host` | as above | — | for a host menu that dispatches them as the host itself (one phone) |

**`engine.hostActions(state)`** → `[{ label, action }]`, the host phone's ⋯ menu entries (the room shows them on the host device only and
dispatches the chosen `action` as `@host`). Exactly the host moves that change the state right now, never a clock-dependent guess:

| moment | entries |
|---|---|
| `play` / `run` (a drawing clock runs, total below 10 min) | 「⏱️ ＋30 秒」 → `{type:'extend'}` |
| a team-foul ruling pending (`play` or `reveal`) | 「🚩 犯規成立（今輪冇分）」 → `{type:'rule', uphold:true}` · 「▶️ 犯規唔成立，繼續」 → `{type:'rule', uphold:false}` |
| choose, grace, buzzer, reveal, standings, over, or at the 10 min cap | none |

No `void` entry on purpose: the menu already has the shell's 🗑️ 呢輪作廢 (confirm, `@void-round`, the same `voidTurn`), and a second
button would double it and skip the confirm.

### 5.3 advance / deadline

- `choose`: auto-pick the medium card.
- `play` / `run`: fire the next hint event; with none left the clock is out → **typed**: the turn ends (`solved` if anyone
  solved); **shout**: open the 2 s buzzer window.
- `play` / `buzzer`: window over → `solved` if any tap is left, else `timeout`. `play` / `grace`: window over → `solved`.
- `play` / `ruling`: no deadline (the host rules).
- `reveal`: the standings after a full cycle, else the next turn, or `over`. `standings`: the next turn.

**Abandon** — everybody 0, the word is spent, the drawer's turn counts. **Void** (host only; choose, play or reveal) —
nobody scores, the word (and any offers still on the table) is released, and the drawer is queued **once** more at the
end (a re-queued turn that is voided again is not queued a third time; the turn count in the title grows).

**Stalls.** `engine.blocking(state, pid)` is true only for the drawer during `choose` and for the host's seat while a
team ruling is pending. Nobody blocks a drawing clock: it runs out by itself, so a dead drawer's phone never raises the
「斷咗線」 banner mid-drawing; the host uses 作廢 / 呢鋪唔計 (research: a disconnected drawer's turn is voided and re-queued).
`autoAct`: choose → the medium card (same as the timeout); a pending ruling → not upheld; otherwise `null`.

### 5.4 Scoring (research, "RECOMMENDED FFA scoring")

`m` = 1.0 / 1.5 / 2.0 for easy / medium / hard; `r` = time left / `T` at the tap or guess (0 for a buzzer-window tap).
- **Guesser** `G = round(m × (10 + 20 r))` → easy 10–30, medium 15–45, hard 20–60. Wrong guesses cost nothing.
- **Drawer** `D = round(mean(G) × (0.5 + 0.5 k / E))` for `k ≥ 1` solvers out of `E = n − 1` eligible; `k = 0` → 0.
- **Foul upheld** (FFA) → `D = 0` (guessers keep theirs). **Abandon / void** → 0 for everyone.
- **Teams:** the drawing team scores 1 (or the tier, with `starsAsPoints`) when anyone on it solved; individuals score nothing;
  a failed turn costs nothing. A foul upheld by the host → the turn scores nothing for the drawing team.
- Worked examples (T = 80 s) are asserted in the tests: easy at r 0.75 → 25; typed N = 6 with r 0.9/0.6/0.2 → 28/22/14 and
  D = 17; N = 4 all solve at 0.8/0.7/0.5 → 26/24/20, D = 23; shout medium N = 6 at r 0.5 → 30, D = 18.

`scores` and `teamScores` are recomputed from `history`, so a late ✔, a late foul or a void in the reveal **can never
double count**. Ranking: points, then correct guesses, then drawer points; still tied → shared first place (all of them
win). Teams: higher team total wins, a tie is shared (sudden death is future work). A game with no solved turn is a
shared win.

### 5.5 Fouls

**FFA** (research D): any non-drawer (also players who already solved — they know the word) may flag the drawer, once,
during `play` or the first 5 s of a solved turn's reveal. The foul is **upheld** at `max(2, ⌈E / 2⌉)` flags, `E` = the
eligible guessers (n = 3: both guessers; n = 8: 4); later flags are ignored. An upheld foul does not stop the turn; it
zeroes `D`.
**Teams** (research D, team variant): a **rival** (only — teammates have no reason to flag their own drawer) taps 🚩 →
the turn clock **stops** (`sub = 'ruling'`, `deadline = null`, no ink, no taps, no guesses) and every phone shows
「🚩 阿C 話畫家犯規 — 計時停咗，等主持裁決」. The host's seat gets 「🚩 成立（今輪冇分）」 / 「唔成立，繼續」:
upheld → the turn ends (`outcome 'fouled'`), the drawing team scores nothing; rejected → the clock resumes exactly
where it stopped. One ruling at a time, each rival once per turn. A rival may also flag a **solved** team turn in the
reveal's first 5 s: the reveal freezes for the ruling; upheld removes the team's point. The host's ⏭ = not upheld;
作廢 voids the turn.

### 5.6 View (whitelist), focus, cue, autoAct

`view(state, pid)` builds a fresh object: `me, role ('drawer'|'guesser'|'rival'|'spectator'), phase, title, subtitle,
drawMode, guessMode, hintsOn, scoring, turn, upNext, scores, teams, myTeam, mod, last, sub, deadline, timerLabel, hint`
plus exactly one of `choose` (offers only for the drawer), `play` (mask, revealed characters, category only after its
event, solved names, `foul {n, need, mine, can}`, `ruling`, `canDraw`, and `word` only for the drawer), `reveal` (the
answer, only in the reveal / over; `foul`, `ruling`, `lateUntil`), `standings` (`{ cycle, cycles }`), and `feed`
(typed). `pid = null` (or an unknown seat) is the table view: no private field at all.
`view.hint` (BACKLOG U1): one line ≤ 40 characters for a first-timer, per phase, sub-step and role, built only from that
view (e.g. 「揀一個你畫得出嘅詞，星多分高；可以換一批。」, 「睇住個畫板，大聲講答案，畫家會㩒你個名。」,
「有人舉報畫家犯規，計時停咗，等主持裁決。」). Shown only behind the shell's 💡, never by itself.
`rules.quick` is 6 lines; every role's text is 「做乜：… 點贏：…」 (the 💡 sheet splits it) and its `team` is a colour,
so the sheet shows no 好人／壞人 label.
`focus`: the drawer during `choose` and `play`; `null` otherwise. `canInk`: the drawer while `play` in canvas mode,
not during a ruling; `inkEpoch` bumps at every turn start (canvas mode), which makes the session clear the picture.
`legalActions` lists every action that changes the state (the late ✔ / late 🚩 are not listed: whether their window is
open depends on the clock, which `legalActions` cannot see — the fuzzer adds them itself; a typed example guess is unique
per call).

### 5.7 The typed-guess checker (`judge.js`)

1. **Normalise** a guess: NFKC (full-width → half-width), lower-case, drop all whitespace, punctuation and symbols (so an
   emoji-only message is empty), then fold Traditional to Simplified with `fold.js` (2,947 one-to-one pairs from the OpenCC
   character table). The groups whose simplified form is shared by different words — **面/麵, 後/后, 乾/幹/干, 髮/發** — are *not*
   folded; instead the **answer** is expanded to every spelling of those characters, so 面包 matches 麵包 and 头发 matches 頭髮
   (the research lists those variants in `alt` by hand; expanding them in code gives the same matches without touching the bank).
2. The **answers** are the word and every `alt` (regional names, synonyms, Latin aliases), all normalised.
3. **Candidates** = the guess, and the guess with at most one leading filler (係唔係, 是不是, 係咪, 我估, 我猜, 估, 猜, 係, 是)
   and at most one trailing filler (呀 啊 嗎 吗 呢 喇 啦 囉 咯 咩 嘅) removed. Stripping only adds matches.
4. Any candidate equals an answer → **right**. No tokenising: 「老虎獅子」 never matches.
5. Else **close** if, against any answer of length L: (i) L ≥ 3 and edit distance 1; (ii) L = 2 and the guess shares a character in
   the same place or is reversed; (iii) L ≥ 3 and ≥ 60% of its characters are present, length within one (scrambled);
   (iv) the guess contains the answer, or is a ≥ 2-character piece of it. **near** if it is in the entry's own `near` list
   (the bank has none today). Else **wrong**.
6. Because (iv) catches any message that contains the answer, **a `wrong` guess — the only kind shown to the table as text —
   never contains the answer in any script** (property-tested against the whole bank).

| strictness | what counts as right |
|---|---|
| `strict` | only the exact word or an `alt` (NFKC, case, spaces, punctuation; no fold, no fillers). Everything `standard` would accept or call close is `close` — still never public text (otherwise 「摩天轮」 would be shown to everybody as a "wrong" guess) |
| `standard` | as above |
| `loose` | additionally a guess that contains the answer (or is a ≥ 2-character piece of it) and is at most (answer + 2) long; a long message or a list of answers still fails |

### 5.8 Results and explanation lines

See §3.5. Every turn has a line with the word, who got it and the points, so what the table could not see (who typed
it first, the drawer's points, a late foul) is explained after the game; the unpicked words are not listed.

## 6. Edge cases → the test list (`tests/draw-guess.test.mjs`)

- Meta/rules/engine shape; U1: `rules.quick` ≤ 6 lines of ≤ 40 characters, every role splits into 做乜／點贏 with no 陣營
  label, `roleFor` finds the seat's role; `CATEGORIES` covers every real bank category; defaults valid for n 3–12 with
  hostile `prev`; the turn table (3 → 9, 4 → 8, …, 12 → 12) and the team-rounds table; validation matrix and warnings;
  fields/summary.
- One phone: typed never survives `defaults(…, { singleDevice })` for any n or prev, the warning names it, no typed
  preset; paper / canvas presets; the topics field's `bank` + `matches` (#11).
- Judge: normalisation; right answers (word, alt, script, width, filler, ambiguous groups); lists of answers never match and never
  count as wrong; close / near / wrong rules; strictness; the "wrong never contains the answer" property over the bank.
- Queue: everybody draws exactly `cycles` times, the first drawer can be any seat; three distinct words per turn (easy/medium/
  hard), never repeated in a game; tier and category filters, nearest-tier borrowing; empty / missing / throwing bank → fallback words.
- Choose: only the drawer, bad indexes, one re-roll, clock restart, timeout → medium; unpicked offers released.
- Clock: the hint schedule (20/40/60 s of 80), reveal counts by word length, hints off, single category, gaps in the mask,
  pause shifting, `advance` ignoring early timers, host-only +30 s.
- `hostActions`: at every step of a whole game the list is exactly the host moves (＋30 秒, 成立, 唔成立) that change the state, each
  listed action sent as `@host` changes it, labels ≤ 24 characters with an emoji, never a `void`, empty outside a running clock /
  a pending ruling, ＋30 秒 gone at the 10 min cap; the rulings in the play and in the reveal each do what they say; through the
  real `Room` (one phone): the host device's views carry the labels, a stale label or a paused table fires nothing.
- Scoring: every worked example, tier ranges, monotonic in time, half-up rounding in integers, foul/abandon/void/E = 0, teams.
- Shout: accept rules, grace window, co-winners at the same `r`, undo (one / all / after close), the buzzer window (several taps,
  undo, ends when it closes, r = 0), late taps ≤ 2 s land in the buzzer window, abandon, void and `@void-round` in choose /
  play / reveal (host only, re-queued once, word released), `@next`.
- Stalls: `blocking` only for the drawer while choosing (and the host during a ruling) — also through `Session.blocking`;
  `autoAct`; the drawer cannot skip the reveal.
- Reveal 7 s for every turn including the last; the 5 s standings after each full cycle only (FFA and teams, never after the
  last turn or for re-queued turns), its view, hint, cue and `@next`; the queue preview.
- Typed: feed visibility per seat, input rules, rate limits (700 ms / burst lock / 60), all-solved ends the turn, clock-out,
  drawer override (play and the reveal window, never double counted), strictness, **no cues at all**.
- Fouls (FFA): thresholds for n = 3 / 8, upheld in the reveal window, ignored after it and beyond the threshold, not on a timeout.
- Fouls (teams): only rivals, the clock freezes (no deadline, no ink, nothing but the ruling is legal), host only, rejected →
  the exact time left, upheld → `fouled`, nothing scored; inside grace; in the reveal (freezes, then removes the point); ⏭ =
  not upheld; void during a ruling; `blocking` / `autoAct` for the host.
- Teams: alternate / shuffle seating, balanced draws, teammates only, team points, stars, typed rival ignored, ties.
- Results: sections (排名 / 亮點 / 每輪重溫), ranking, tie-breaks, all-zero shared win, per-turn lines, evening points.
- Privacy: no view but the drawer's contains the word, an unrevealed character or an unpicked offer (also in the fuzz, every
  step, every mode incl. paper); cues never speak an unrevealed character; `canInk`; the table view; the whitelist of view keys.
- Session: pause shifts the chain, ink only from the drawer, snapshot/restore mid-turn, the picture stays through the reveal and
  clears with the next turn, a whole game on timers alone.
- Room (real `Room`, `code: null`): one device holds every seat; shout is the default even if the last setup was typed; every
  views message carries all five seat views and the table, and none but the drawer's ever holds a secret; focus = the drawer;
  ink only from the drawer in canvas mode, never in paper mode; the game reaches the results.
- UI (fake DOM, stub Cover / Timer / Canvas, every seat + the table, driven by the fuzzer): every phase renders idempotently;
  no screen but the drawer's shows a secret; the drawer's screen hides the word until tapped (canvas chip) or held (paper
  cover); the mask is on every screen; the canvas gets `tools: 'full'` and `canDraw` = `engine.canInk` for the drawer only,
  the shared ink, `minStrokeLen 0`; no canvas at all in paper mode; typed play makes no sound; taps send what the engine
  accepts (pick, name chip, two-tap 🚩, the host's ruling buttons).
- Fuzz: random legal play (plus the clock-dependent late moves) for n ∈ {3,4,5,6,7,8,12} × {shout, typed} × {paper, canvas} ×
  {FFA, teams} ends with a well-formed result; every view's hint is 1–40 characters; `blocking` matches the contract at every
  step; it asserts that grace, buzzer (and buzzer solves), abandon, void, re-queue, fouls, team rulings (play and reveal),
  upheld team fouls, overrides, typed solves, team points and standings were all visited.

## 7. 貼心 touches

- The word is never on screen unless asked for (tap chip 2.5 s / hold-to-peek), so a phone on the table or a neighbour cannot read it.
- Close guesses are hidden from the table (otherwise 「摩天」 hands everybody the answer) but the guesser is told 「好接近！」.
- A mis-tap by the drawer can be undone for 3 s; a late shout still counts for 2 s (and can be undone too); a forgotten ✔ can be added for 5 s.
- The clock freezes during the grace window, so undoing a mis-tap costs nothing; it also freezes for a team foul ruling.
- The mask and hints are on the drawer's screen too, so a single phone lying in the middle shows the table everything public.
- 「之後到：阿B → 阿C」 while someone chooses, so the next drawer can grab paper; a short leaderboard after each cycle.
- Hints are announced aloud in shout play (useful when everybody is looking at the paper), and never in typed play.
- The shell's 💡 explains the current step in one line (`view.hint`), nothing pops up by itself.
- The results screen keeps every picture of the game (keepsake), so the reveal does not have to linger.
- While the host pauses, the canvas, the name chips, the word cards and the typed input lock (a stroke or tap the host would refuse is never faked).
- An emoji-only guess gets a toast (「打啲字先得喎」) instead of vanishing; an over-long one says so; a guess typed while composing Chinese is never sent half-written.

## 8. Framework requests

1. **`env` for validate / presets** (core + ui): the Room passes `{ singleDevice }` to `config.defaults` only. Please pass the same
   third argument to `config.validate(cfg, n, env)` (Room `#configStatus`) and `config.presets(n, env)` (lobby `paintPresets`), so a
   one-phone lobby shows the specific typed warning and hides the typed preset. Both are optional here; without them the generic
   warning and all presets appear.
2. ~~呢鋪唔計 in the host menu~~ — done: play.js offers 🗑️ 呢輪作廢 in the host's ⋯ menu.
3. ~~A host-menu extension point~~ — done: `engine.hostActions(state)` (§5.2) gives 「＋30 秒」 and the team-foul ruling on the host
   phone; 作廢 is left to the shell's 🗑️ 呢輪作廢 so the menu has one of it.
4. Lobby UI to move players between teams (today the seat order decides, or a random split).
5. Optional: dedicated `ding` (a guesser got it) and `hint` sounds in `sfx.js`; the UI reuses `reveal`, `join` and `win`.
   The Canvas toolbar plays its own `tap` / `deny` sounds; a `quiet` prop would let typed play be silent on the drawer's phone too.
6. Future (needs more of the framework): `canvasId` on `ink` / `inkSync` for a team **All Play** round (research, "Canvas and transport notes").

## 9. Deviations from the research doc (kept, with why)

- **Choice clock 20 s** (research 12 s). On a shared phone the clock starts while the phone is handed over and the PassGate
  waits for a tap; 12 s would often auto-pick before the drawer has read three cards (4-character idioms included). On
  separate phones it is only a ceiling — most drawers pick in a few seconds.
- **No separate 3 s intro step** (research 2.1). The choice screen already tells every phone who draws (and the cue says it);
  a 3 s pause before it would only add dead time to every turn.
- **Teams get the 3 s grace window too** (research: a team turn ends at the tap). A drawer's finger on a phone lying on the table
  mis-taps; one shared behaviour for both modes is easier to learn, and the team's score does not depend on when in the window
  it ends.
- **The grace window freezes the turn clock**, so undoing every tap resumes play with the time that was left (the research
  says the deadline never cuts an open window short but does not say what an all-undone window resumes to).
- **`strict` typed checking** turns everything the standard checker would accept or call close into `close` (hidden), not
  `wrong` — otherwise a correct answer in the other script would be shown to the whole table as text.
- **Ambiguous Simplified/Traditional groups** are handled by expanding the answer in code instead of listing variants in each
  entry's `alt` (same matches; the bank stays untouched).
- **A disconnected drawer is not voided automatically**: the engine cannot see connections. The host voids (作廢 / 呢鋪唔計),
  which re-queues the drawer once and returns the word, as the research asks; offline guessers are not excluded from the
  typed all-solved check (the clock or the host's ⏭ ends the turn).
- **Canvas `minStrokeLen` 0**: the research discards accidental one-point taps, but in this game a dot is a real mark (eyes,
  buttons, rain) and the Canvas's short-stroke refusal plays a deny sound and shakes; undo removes a stray dot.
- **Default drawing mode: the phone canvas** (the research does not pick one); paper is one tap away (preset 「經典」).
- **`legalActions` omits the clock-dependent late moves** (late 🚩 / late ✔ in the reveal); the fuzzer adds them itself.
- A per-game "quiet" toggle is not needed: typed play is silent by itself (no narration, no clock beeps, no dings or taps); the
  shell's 🔊 button mutes everything else.

**Not implemented** (future work, listed so nobody assumes them): team **All Play** turns, team **sudden death** (a team tie is
shared), `targetScore` race mode, the logged **referee peek**, the 25 s **no-ink warning** (the engine never sees ink), the
**best-drawing vote**, the reveal's **reaction row** (laugh / like), the optional challenge handicaps, per-word `near` and
`reveal` overrides (the bank has none and the bag's flattening drops them; the judge supports `near`).

## 10. QA log

2026-10-03 UTC — QA against the verified research (fixed rule → was → now):
- Shout buzzer window: a tap opened a fresh 3 s grace window → taps stay in the 2 s window (r = 0, undoable), the turn ends when it closes.
- Team fouls: every non-drawer counted toward the FFA threshold, so the rivals alone could uphold → a rival's flag stops the clock and the host rules.
- Reveal: 8 s, 25 s on the last turn, and the drawer could skip it (and the 5 s foul window with it) → 7 s every turn, the host's ⏭ only.
- Between cycles: nothing → the 5 s leaderboard (research step 3).
- Queue preview: missing → `view.upNext` and 「之後到：…」.
- FFA foul threshold: computed from the head-count → from the eligible guessers (same numbers in FFA, now as the research words it); flags after the threshold and on a timed-out reveal are ignored.
- Void: choose/play only → also in the reveal, and `@void-round` from the shell maps to it.
- Stalls: the drawer was auto-acted with `abandon` mid-drawing (word spent, turn lost) → `blocking` only while choosing, `autoAct` = the medium card; a dead drawer's turn is voided by the host.
- Single phone: the drawer's seat (the one the table sees) had no mask or hints → shown on every seat; `validate` / `presets` take `env.singleDevice`.
- U1: hints over 40 characters → all ≤ 40; role texts now 「做乜／點贏」 with colours instead of 好人／壞人 sides; 猜題者 → 估嘅人.
- #10: result lines are now sectioned (排名 / 亮點 / 每輪重溫). #11: the topics field carries `bank` + `matches`.
