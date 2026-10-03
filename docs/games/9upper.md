# 瞎掰王 9upper — play-flow spec

> Rules source: `docs/research/9upper.md` (2026-10-03). Where that doc lists a disagreement we pick the
> default it recommends and expose the rest as config. UI text is Hong Kong Cantonese; everything else English.
> Files: `js/games/9upper/{game,script,ui,index}.js`, `style.css`; tests `tests/9upper.test.mjs`.

## 1. At a glance

| | |
|---|---|
| Players | 3–9 (1 諗樣 + 1 老實人 + N−2 個 9upper) |
| Time | 15–30 min (N × laps rounds, about 1.5–2.5 min each) |
| Narration | optional (every cue is public information, host-only speech leaks nothing) |
| Single device | `full` — read-phase passes the phone seat to seat (see §4) |
| Banks | `9upper` → `js/data/9upper-terms.js`, entries `{ term, explain, cat, level, src }` |

One person is the **諗樣** (judge, public). Every round the app deals exactly one **老實人** among the others;
everybody else is a **9upper**. The *term* is public (everybody, judge included, sees it). Only the 老實人's
phone shows the *true explanation*, for a fixed reading window. Then everybody explains the term aloud, the
諗樣 cross-examines (and may play 收皮啦), and finally names who the 老實人 was. Points per round depend on the
card level (1–3). After `N × laps` rounds the highest score wins.

What the phones do: deal roles and terms, keep the reading window, rotate the 諗樣, show whose turn it is to
explain, collect the 諗樣's 收皮啦 and final pick, settle the scores (including the 收皮啦 netting), keep the
running score, keep the explanations and sources for the end.
What happens at the table: all the talking — explaining, cross-examining, bluffing, keeping a straight face.

## 2. Setup

Config (all keys optional; `defaults(n, prev, env)` fills them):

| key | type | default | meaning |
|---|---|---|---|
| `levelMode` | select | `'judge'` | `'judge'` 諗樣每輪自己揀 · `'1'` `'2'` `'3'` 固定難度 · `'mix'` 每輪隨機 |
| `laps` | int 0–3 | `0` | each seat is 諗樣 this many times. `0` = official table: 3–4 players → 3, 5–7 → 2, 8–9 → 1 |
| `readSecs` | seconds 0–120 | `15` | fixed reading window. `0` = no timer, every non-judge taps 「我睇完」 (one-phone play) |
| `speakSecs` | seconds 0–300 | `0` | per-explainer time limit, `0` = off |
| `callouts` | int 0–2 | `1` | 收皮啦 cards the 諗樣 may play per round (research default 1; the box has 2, only one playable) |
| `scoreFloor` | bool | `false` | true = a score can never drop below 0 (research: unspecified, negatives allowed by default) |
| `rePeek` | bool | `false` | true = the 老實人 may re-read the explanation while the table explains (lenient) |
| `topics` | categories | `{ cats: [] }` | the ConfigForm `categories` value; `cats` = bank categories to draw from, empty = all (a bare array is tolerated). Options are the bank's categories (`CATEGORIES` in game.js) |

Resulting rounds = `n × laps`: n=3 → 9, 4 → 12, 5 → 10, 6 → 12, 7 → 14, 8 → 8, 9 → 9.
`defaults(n, prev, env)` keeps the user's last choices (`prev`) but recomputes nothing from `n` (laps `0` is
head-count-aware by itself). `env.singleDevice === true` forces `readSecs: 0`.

Validation: `n` must be 3–9; every number an integer in range (numeric strings from a `<select>` are accepted);
`levelMode` one of the five values.
Warnings (non-blocking): `readSecs` 1–9 「睇卡時間咁短，老實人睇唔切」; total rounds > 20 「要玩好耐」;
`callouts` 2 at n = 3 「3 個人玩，收皮啦好易中老實人」.
Not implemented on purpose: `noGuessPenalty` (a stalled 諗樣 is auto-picked instead), `tieBreak` (ties share the win),
`balancedHonest` / anti-streak (excluding last round's 老實人 would tell the 諗樣 one more name to rule out — at 3 players
it would even name the 老實人), the 2-player variant (rules unverified).
Summary lines (lobby): `共 12 輪（每人做 3 次諗樣）` · `難度：諗樣自己揀` · `睇卡 15 秒` (or `睇卡：每人睇完自己㩒`) ·
`收皮啦 1 張` · optional `每人解釋限時 45 秒` · `類別：地理、科學` · `分數唔會低過 0` · `老實人可以再睇`.

## 3. Flow

Everything per round: **level → read → explain → judge → reveal**, then the next round, or `over` after the last.
(`level` is skipped unless `levelMode === 'judge'`.) Seats: 諗樣 = the judge of the round; 玩家 = the other N−1.

Round 1's 諗樣 is random; afterwards the seat to the left (next in seat order). Explaining order starts with the
seat after the 諗樣 and goes round the table.

### 3.1 `level` — the 諗樣 picks a difficulty

| who | screen |
|---|---|
| 諗樣 | 「揀題目難度」 / 「分數愈高，提示愈少」, three buttons: `⭐ 簡單 · 1 分 — 提示：話你知屬於邊一類` · `⭐⭐ 中等 · 2 分 — 提示：三個類別揀一個（得一個啱）` · `⭐⭐⭐ 困難 · 3 分 — 冇提示` |
| 其他人 | 「阿明 揀緊題目難度…」 |
| table | same as 其他人 |

Cue `r{n}:level`: 「第 3 輪，阿明做諗樣。阿明，請揀題目難度。分數愈高，提示愈少。」
Choosing draws the term (`bag.draw('9upper', predicate)`; if the pool for that level+category is empty it relaxes the
level, then the category, then takes anything, then one of three built-in emergency cards, so a round never dies
offline) → `read`. The bank's `level` is the card level D (1–3). A stalled 諗樣 is auto-acted with a random level.

### 3.2 `read` — the reading window

Fixed duration `readSecs` (default 15 s) for **everyone at once**. The window never ends early (§3.6).

| who | screen |
|---|---|
| 老實人 | term (public) + hint · a big hold-to-peek card. Back: 🃏 「㩒住睇卡」. Front: `你係老實人` / the true explanation / `用自己嘅講法講，唔好照讀。` |
| 9upper | the same term, hint and card, same size and back. Front: `你係 9upper` / `作一個解釋，要講得似真㗎！` / `你睇唔到真正解釋，靠你把口。` |
| 諗樣 | term + hint · the same sort of card so every phone is busy: front `你係諗樣` / `你唔會見到解釋，靜靜哋睇住大家。` / `等佢哋睇完，就逐個解釋俾你聽。` |
| table | term + hint + countdown |
| everyone | countdown (`Timer`, label 「睇卡時間」, warns at 5 s, beeps at 0); under the card: 「㩒住張卡睇，放手就冚返。睇卡嗰陣唔好露出表情。」 |

Cue `r{n}:read`: 「題目係「{term}」。{hint}阿明做諗樣，其他人望住自己部電話，㩒住張卡睇。其中一個人係老實人，會見到真正解釋；其他人係 9upper，要自己作。你哋有 15 秒。」
Hint speech: level 1 「提示：同地理有關。」 · level 2 「提示：地理、科學、歷史，三個入面得一個啱。」 · level 3 nothing.
(`readSecs = 0`: ending 「睇完請㩒「我睇完」。」 instead of the seconds.)

**換題 (swap).** The term is public before anyone peeks, so if somebody says 「我識呢條！」 the 諗樣 taps
`有人識呢條？換題` (two taps to confirm, max 2 per round). A new term of the same difficulty is drawn, the window
restarts, **roles and 老實人 stay the same**, nothing scores. (Research: host card swap, no scoring.)

When the window ends every card closes at the same instant and the phase becomes `explain`
(`@next` from the host skips the rest of the window).

Tap-mode (`readSecs = 0`): no timer; each 玩家 has the same 「我睇完」 button under the card; the phase ends when
all 玩家 are ready. The judge has no button. `focus.pids` shrinks as seats become ready.

### 3.3 `explain` — everybody explains

| who | screen |
|---|---|
| everyone | term + hint; the speaking list in order — `✅ 已講` / `🎤 講緊` / `⏳ 等緊`; 收皮啦 marker if played (`🛑 收皮啦 → 阿B`); optional per-speaker countdown |
| current speaker | big button 「我講完」 |
| 諗樣 | 「下一位」 (ends the current turn) · 「我決定咗，要揀人」 (jumps to `judge` early — the research allows the accusation at any moment) · the 收皮啦 row (§3.4) |
| 玩家 (not speaking) | a small hold-to-peek card: front `你係老實人` or `你係 9upper` (plus the explanation when `rePeek`), back 「㩒住睇返我係咩」 |

Cue `r{n}:explain`: 「睇完喇。收起電話，由阿B開始，逐個解釋「{term}」。次序係：阿B、阿C、阿D。」
Turn ends when the speaker (or the 諗樣) taps, or at the per-speaker deadline if `speakSecs > 0`.
If a 收皮啦 lands on the **current speaker** their turn ends at once (HK card text: 「停佢發言」). A 收皮啦 on someone
who has not spoken yet does *not* skip them (they still get to explain). After the last speaker → `judge`.

### 3.4 收皮啦 (callout)

Allowed to the 諗樣 in `explain` and `judge`, once per target, at most `callouts` per round, never on self.
UI: a row 「收皮啦」 with one chip per 玩家; tap a chip → it turns into 「確定？再㩒一下」 for 3 s (a wrong call on
the 老實人 costs 3 points, so it needs a second tap) → action. Played cards are public at once: every phone gets a
banner `🛑 阿明 對 阿B 出咗收皮啦！`, `deny` sound, and the target's own phone adds 「俾人 call 咗，繼續撐落去。」
Nothing is revealed until the reveal. The cards cannot be taken back.

### 3.5 `judge` — the pick

| who | screen |
|---|---|
| 諗樣 | 「邊個係老實人？」 PlayerPicker (everybody except self), confirm 「就係佢！」; 收皮啦 row below; remaining cards `收皮啦 剩 1 張` |
| 玩家 | 「阿明 諗緊邊個係老實人…」 + the role-reminder card + the 收皮啦 marker |
| table | same, no card |

Cue `r{n}:judge`: 「大家都解釋完喇。阿明，你可以繼續發問；覺得邊個太離譜，就出收皮啦。決定咗就揀邊個係老實人。」
No timer. A stalled 諗樣 is auto-acted with a random pick (no penalty — the research's optional `noGuessPenalty`
is not implemented).

### 3.6 Anti-tell handling

- **Fixed window** — the reading window never ends because somebody finished; no 「睇完」 button and no
  progress counter exist in timed mode (a counter would show who is slow). Tap mode exists only for one-phone play,
  where the people looking at the screen are the people holding it.
- **Identical cards** — 老實人, 9upper and 諗樣 get the same back art, the same card size (a fixed minimum face
  height), the same three-line front structure and the same peek sound. Nothing on screen differs by role except
  the words inside the held-open card.
- **Everybody looks down** — the 諗樣 holds a decoy card too, so nobody can be spotted as "the one reading".
- **Same end instant** — the window is one host deadline; all cards close together.
- **No explanation after the window** (unless `rePeek`) — the 老實人's phone drops the text, so the phone cannot be
  read out loud later and the 老實人 must speak from memory like in the box game; the role reminder card that stays
  has the same shape for both roles. The card is a fixed 5:3 box (the shared `Cover`), so a longer true explanation
  never makes a bigger card.
- The 諗樣's own view never contains anything about roles. Table (spectator) view never does either.
- Names in `focus` are not anonymised: who is a 玩家 is public (everyone except the 諗樣).

### 3.7 `reveal`

Everyone gets the same screen. Two beats (pure CSS delay, no extra state): 「阿明 揀咗 阿B…」 → after about 1.2 s the
`reveal` sound and:

```
老實人係 阿B 🙋
✅ 估中！阿明 同 阿B 各 +2          (or)   ❌ 阿明 揀咗 阿C，但 阿C 係 9upper。阿C 呃到諗樣，+2
🛑 收皮啦 → 阿D：阿D 係 9upper，阿D −1，阿明 +1          (or)  🛑 收皮啦 → 阿B：中咗老實人！阿明 −3
題目「{term}」 {stars}
真正解釋：{explain}
來源：{src}
分數變動：阿明 +3 · 阿B +2 · 阿D −1        (then the new score chips)
```

Buttons: the 諗樣 sees 「下一輪」 (last round: 「睇總結」); everyone else sees 「等阿明開下一輪」. `@next`
from the host works as well; a stalled 諗樣 is auto-acted.

Cue `r{n}:reveal`: 「老實人係阿B。阿明估中咗，阿明同阿B各得兩分。真正解釋係：{explain}」 (wrong pick:
「老實人係阿B。阿明揀咗阿C，但阿C係9upper，阿C得兩分。」 + the same explanation). Each callout adds a sentence.

### 3.8 `over` and results

`engine.result` is non-null only in `over`. Winners = every seat with the top score (ties share the win; the
research's optional tie-break round is not implemented). `points` = final scores (everyone starts on 3).
Summary: `阿明 以 11 分贏出` / `阿明、阿B 同分，一齊贏（10 分）`.
Lines: awards, then one block per round —

```
🤥 最勁 9up：阿B（呃過諗樣 3 次）
🧠 最準諗樣：阿明（估中 2/3）
🛑 收皮啦 出咗 4 次，中 3 次
第 1 輪「{term}」⭐⭐（諗樣 阿明）
　老實人 阿B；阿明 揀咗 阿C（9upper），估錯
　真正解釋：{explain}
　來源：{src}
　分數：阿C +2
```

## 4. Single-device play

`meta.singleDevice = 'full'`. Recommended config: `readSecs = 0` (the shell passes `env.singleDevice` to
`config.defaults`). The phone moves like this:

1. `level` / `explain` / `judge` / `reveal`: `focus.pids = [judge]` — the shell (play.js) hands the phone to the 諗樣
   behind a PassGate and shows him 「輪到你」.
2. `read`: `focus.pids` = every 玩家 who has not tapped 「我睇完」 yet; the shell walks them in seat order behind a
   PassGate (title 「交俾 阿B ・ 其他人唔好望」). Each holds the card, then taps 「我睇完」, which drops them from
   `focus` and brings the next PassGate. When the last one is done the phone goes back to the 諗樣.
3. Timed mode on one phone is not workable (one window for N people) — that is why tap mode exists.
4. `rePeek` and the role-reminder card need a private seat switch; on one phone they are only used if somebody
   switches seat by hand (the shell's own gate). The 諗樣's phone never shows anything about roles.

No paper mode.

## 5. Engine

Phases: `level` → `read` → `explain` → `judge` → `reveal` → (`level`|`read`) … → `over`.

State (JSON; **PRIVATE** = never in any view before `reveal`):

```
phase, deadline, timerLabel, cfg (normalised, laps resolved), players [{id,name,seat,color}], order [pid…],
totalRounds, roundNo, judges [pid…]  (the whole schedule, public),
scores {pid: n}, stats {pid: {fooled, judged, caught, callHit, callMiss}}, history [round summaries — after reveal only],
cueAck (last acknowledged cue id),
round: {
  n, judge, explainers [pid…], honest (PRIVATE), term {term, explain (PRIVATE), cat, level, src, hint},
  levelWanted, ready [pid…] (tap mode), turn, called [pid…], swaps, pick, reveal
}
```

`hint` is built at draw time and public: level 1 `{ kind: 'one', options: [cat] }`, level 2 `{ kind: 'three',
options: [3 shuffled categories, exactly one true] }` (the two decoys are drawn from the bank's real categories — a
made-up decoy would be spotted at once), level 3 `null`.

### Actions (all validated; bad input returns the state unchanged, never throws)

| action | pid | phase | rule |
|---|---|---|---|
| `{type:'level', level:1\|2\|3}` | judge | `level` | draws the term, → `read` |
| `{type:'ready'}` | a 玩家 | `read`, `readSecs = 0` | idempotent-rejected if already ready; all ready → `explain` |
| `{type:'swap'}` | judge | `read` | `swaps < 2`; new term of `levelWanted`; same honest; window restarts |
| `{type:'done'}` | current speaker or judge | `explain` | next turn; last → `judge` |
| `{type:'decide'}` | judge | `explain` | → `judge` |
| `{type:'callout', target}` | judge | `explain`, `judge` | target is a 玩家, not yet called, `called.length < callouts`; current speaker's turn ends |
| `{type:'pick', target}` | judge | `judge` | target is a 玩家 → scores settle → `reveal` |
| `{type:'next'}` | judge | `reveal` | next round, or `over` after the last |
| `@cue-done {id}` | host | any | acknowledges the cue if `id` matches |
| `@next` | host | any | acknowledges a pending cue first; otherwise skips the wait: `level` → auto level, `read` → `explain`, `explain` → end turn, `judge` → nothing, `reveal` → `next` |

`@auto` is handled by the session via `autoAct`.

### Timers

`read`: `deadline = now + readSecs·1000` (only when `readSecs > 0`), label 「睇卡時間」; `advance` → `explain`.
`explain`: when `speakSecs > 0` each turn gets `deadline = now + speakSecs·1000`, label 「{name} 講緊」;
`advance` ends the turn. No other phase has a deadline.

### Views (whitelist)

Common: `me, phase, title ('第 3/12 輪'), subtitle ('阿明 做諗樣'), deadline?, timerLabel?, round {n,total}, judge, explainers,
scores, term {text, level, hint}|null, readMode ('timer'|'tap'), turn {index,total,pid}|null, callouts {max,left,used},
canSwap, swapsLeft, last (is this the last round), rePeek, mine, reveal, levels (judge in `level` only)`.

`mine` (a 玩家 only; null for the 諗樣 and the table): `{ honest: bool, explain?: string, ready?: bool }`.
`explain` text is present only for the 老實人, only during `read` (or `explain`/`judge` with `rePeek`). The 諗樣 gets
`mine: null` plus `card: 'judge'` so the UI can show the decoy card. The reveal object exists only in `reveal`/`over`:
`{ honest, pick, correct, d, term, explain, src, cat, called: [{pid, hit}], changes: [{pid, delta, nominal}], lines[] }`.

### `focus`

`level|explain|judge|reveal` → `{ pids: [judge] }`; `read` → all 玩家 (tap mode: those not yet ready); `over` → null.

### `autoAct(state, pid)`

`level` judge → random level · `read` (tap) 玩家 → `ready` · `explain` speaker or judge → `done` · `judge` judge → random pick ·
`reveal` judge → `next` · otherwise null.

### `legalActions(state, pid)`

Exactly the actions in the table that are legal for `pid` now (timed `read` → none for everyone; the clock does it).

### Result and explanation lines

See §3.8. Scoring (D = `term.level`):

```
if pick is honest:  judge +D, honest +D          else:  pick +D
for each 收皮啦 target t:  t is honest → judge −3     else → t −1, judge +1
```

Settled **atomically**: deltas are netted per player, then applied; with `scoreFloor` each score is clamped at 0
afterwards and `changes[].delta` is the applied value (`nominal` keeps the unclamped one). Golden vectors from the
research are in the tests.

## 6. Edge cases → test list

- Config: defaults valid for n 3–9 and laps by head-count; validation of every field; fields/summary shape; `env.singleDevice`.
- Setup: totalRounds = n × laps; every seat judges `laps` times; judges rotate by seat; honest is never the judge; exactly one honest.
- Each phase accepts only its actions from the right seat; wrong phase / wrong seat / illegal target / garbage input → unchanged, no throw.
- Level: per-judge choice draws that level; fallback when the pool is empty (level, then cats, then anything, then the emergency card); `mix`; fixed; `cats` filter.
- Hints: level 1 one true option, level 2 three options one true (and distinct), level 3 none.
- Read: timed (no early end, no ready, `@next` skips), tap (ready, focus shrinks, all ready ends), swap (limit 2, same honest, new term, restart, roles unchanged).
- Explain: seat order from the judge's left; `done` by speaker/judge only; `speakSecs` advance; 收皮啦 on the current speaker ends the turn; `decide`.
- 收皮啦: limit by config, once per target, not self, not outside explain/judge, `callouts: 0` disables.
- Scoring: the eight research golden vectors (N = 5, D = 2), floor on/off, net per player.
- End: after the last reveal `next` → `over`; result winners / tie / points / lines contain explanation and src; null before.
- Cues: ids unique per step, acknowledged cue → null, `@next` acknowledges first.
- Leaks: for every step of random games, no view other than the honest seat's contains the explanation before reveal; no `honest` flag in the judge/table view; `mine.honest` is only the viewer's own.
- Fuzzer: every n 3–9 × 100+ seeds, in timer mode and tap mode, every level mode; terminates; result well-formed.
- Determinism and JSON-safety of the state.

## 7. 貼心 touches

- 換題 for a term somebody already knows, with the roles untouched.
- Level choice shows exactly what it costs: stars, points and how much hint you get.
- Everyone (the 諗樣 too) holds a same-shaped card, so reading is invisible.
- The role reminder stays available while the table explains.
- 收皮啦 needs a second tap, because a wrong one costs 3.
- Reveal shows the true explanation and its source — the 「原來係咁」 moment — and the end screen keeps every round's.
- `speakSecs` and the 睇卡 length are adjustable; `readSecs = 0` for one phone.
- Terms never repeat across evenings (the bag). The answer bank is only loaded on the host phone; every other phone
  only ever receives views, and a view never carries anybody's secret.
- Narration reads the whole reveal aloud, explanation included, so people can look at each other instead of the phone.

## 8. Framework requests

1. `config.defaults(n, prev, env)` — room.js currently calls `defaults(n, prev)` only. Please pass a third argument
   `{ singleDevice: true }` when the room is in LocalTransport mode, so 9upper can default to `readSecs: 0` (timed
   reading cannot work when one phone is passed between N−1 people). Until then the lobby field help says so.
2. `categories` Field: used as read from `ConfigForm.js` — `{ key: 'topics', type: 'categories', options: [{value,label}] }`,
   value `{ cats: [...] }`. The game must supply `options` itself (it hard-codes `CATEGORIES`); a `stats` object
   (「已用 37 / 1,243」) is not supplied because `config.fields` has no bag access — if the shell wants it, it can add
   `stats` from `bag.stats('9upper')` before rendering.
3. Stall detection (room.js) only flags *disconnected* seats that have a legal action, so 9upper's long `explain`
   phase is fine. `autoAct` covers every phase for a dead phone.
4. The bank merge step (`js/data/9upper-terms.js`) must drop duplicate terms: shards n3 and n4 currently both contain
   水熊蟲, 綠閃光, 夜光雲, 紅色精靈, 黃道光, STEVE, 貝利珠. `tests/9upper.test.mjs` checks the merged file for
   duplicates, valid levels, a `src`, and categories that are all listed in `CATEGORIES` (game.js); a new category in
   the bank fails that test until `CATEGORIES` is updated.
5. A shell-level 「呢輪作廢」 (void the round) for a dead phone would help; not implemented here.
