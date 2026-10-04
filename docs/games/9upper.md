# 瞎掰王 9upper — play-flow spec

> Rules source: `docs/research/9upper.md` (2026-10-03, including its "Verification" section, which reads the
> printed TW rulebooks). Where that doc lists a disagreement we pick the default it recommends and expose the
> listed variants as config. UI text is Hong Kong Cantonese; everything else English.
> Files: `js/games/9upper/{game,script,ui,index}.js`, `style.css`; tests `tests/9upper.test.mjs`.

## 1. At a glance

| | |
|---|---|
| Players | 3–9 (1 諗樣 + 1 老實人 + N−2 個 9upper) |
| Time | 15–30 min (N × laps rounds, about 1.5–2.5 min each) |
| Narration | optional (every cue is public information, host-only speech leaks nothing) |
| Single device | `full` — 「一部手機輪流睇」 passes the phone seat to seat for equal, fixed peeks (see §4) |
| Banks | `9upper` → `js/data/9upper-terms.js`, entries `{ term, explain, cat, level, src }` |

One person is the **諗樣** (judge, public). Every round the app deals exactly one **老實人** among the others;
everybody else is a **9upper**. The *term* is public (everybody, judge included, sees it). Only the 老實人's
phone shows the *true explanation*, for a fixed peek (9 s, the printed rule). Then the players explain, one by one,
while the 諗樣 cross-examines (never "what is your role?"), may play 收皮啦, and finally names who the 老實人 was.
**Who decides the order of the explanations is a setting** (`speakOrder`, §2): the 諗樣 (the rulebook, default), the
phone (a fresh random order every round), or the table itself. Points per round depend on the card level D (1–3). After `N × laps` rounds the highest score wins.

What the phones do: deal roles and terms, keep the peek window identical for everybody, rotate the 諗樣, track
who has explained, collect the 諗樣's 收皮啦 and final pick, settle the scores (including the 收皮啦 netting), keep
the running score, keep the explanations and sources for the end, and explain every score at the end.
What happens at the table: all the talking — explaining, cross-examining, bluffing, keeping a straight face.

## 2. Setup

Config (all keys optional; `defaults(n, prev, env)` fills them):

| key | type | default | meaning |
|---|---|---|---|
| `preset` | select | `'quick'` | `quick` 快玩 · `official` 官方玩法 · `newbie` 新手 · `custom` 自訂 (see below). **快玩 is the default for every head-count** (decision D5, 2026-10-04: travel nights; at 4 players 官方玩法 is 12 rounds); 官方玩法 is the next option of the same select |
| `levelMode` | select | `'mix'` | `'mix'` 每輪隨機 (rulebook: shuffled pile, top card) · `'judge'` 諗樣每輪自己揀 · `'1'` `'2'` `'3'` 固定難度 |
| `laps` | int 0–3 | `0` | each seat is 諗樣 this many times. `0` = rulebook table: 3–4 players → 3, 5–7 → 2, 8–9 → 1 |
| `callouts` | int 0–2 | `1` | 收皮啦 the 諗樣 may play per round (rulebook: once per round; 2 = house reading; 0 = off) |
| `readSecs` | seconds 5–30 | `9` | the peek window (rulebook 9 s; same length for every seat) |
| `passPhone` | bool | `false` | 一部手機輪流睇: one phone goes round, every reader gets their own `readSecs` window |
| `speakOrder` | select | `'judge'` | who decides the order in which the 玩家 explain: `'judge'` 諗樣揀 (rulebook step 3: "the Thinker chooses who speaks, in any order") · `'system'` 系統派 (the phones deal a fresh fully random order every round and announce each speaker) · `'free'` 自己決定 (the table sorts it out loud; the phones only tick people off). **Not part of any preset**: the field is always shown, right under the preset block, with a one-line help that follows the chosen mode (§3.4) |
| `speakSecs` | seconds 0–300 | `0` | per-explainer time limit, `0` = off. Not used by `speakOrder: 'free'` (nobody is on the floor to time) |
| `scoreFloor` | bool | `false` | true = a score can never drop below 0 (research: unspecified, negatives allowed by default) |
| `rePeek` | bool | `false` | true = the 老實人 may re-read the explanation while the table explains (lenient) |
| `antiStreak` | bool | `false` | last round's 老實人 is not dealt 老實人 again — only when ≥ 3 candidates remain (n ≥ 5), so it never comes close to naming the 老實人 (research: optional `balancedHonest`) |
| `topics` | categories | `{ cats: [] }` | bank categories to draw from, empty = all (a bare array is tolerated). Options = `CATEGORIES` in game.js |

**Presets (#8).** A named preset fixes `levelMode`, `laps` and `callouts` (those fields are hidden; their raw values
are kept for when the host switches to 自訂). The preset field's help is the reason, per head-count:

| preset | levelMode | laps | callouts | help (n = 5) |
|---|---|---|---|---|
| `official` 官方玩法 | mix | 0 (table) | 1 | 跟說明書：5 人每人做 2 次諗樣（共 10 輪），難度隨機，每輪 1 張收皮啦。 |
| `newbie` 新手（第一次玩） | `'1'` | 1 | 1 | 第一次玩：全部 ⭐ 簡單題（說明書建議第一局咁玩），每人做 1 次諗樣（共 5 輪）。 |
| `quick` 快玩 (default) | mix | 1 | 1 | 快玩：每人做 1 次諗樣（共 5 輪），難度隨機。 |
| `custom` 自訂 | raw | raw | raw | 自己揀難度、輪數同收皮啦張數。 |

Resulting rounds (official) = `n × laps`: n=3 → 9, 4 → 12, 5 → 10, 6 → 12, 7 → 14, 8 → 8, 9 → 9. 快玩 (the default) = `n`.
`defaults(n, prev, env)` keeps the user's last choices (`prev`), sanitised; nothing depends on `n` (laps `0` is
head-count-aware by itself). `env.singleDevice === true` turns `passPhone` on. The returned setup carries `presetRev: 2`
(not a form field, dropped by the engine): a setup saved before 2026-10-04 (no mark) that still holds the old default
`official` moves to `quick` once; a host who picks 官方玩法 afterwards keeps it.

Validation: `n` must be 3–9 (the composition is fixed by the rules: 1 + 1 + n−2); every field must be in range
(numeric strings from a `<select>` are accepted); `preset` / `levelMode` / `speakOrder` one of their values; bools are booleans.
`defaults`, `validate` and `presets` take the optional `env` ({ singleDevice }) as their last argument; 9upper only reads it in
`defaults` (→ `passPhone`), and has no `config.presets` of its own (its 玩法 select is the preset mechanism). A `speakOrder` the
host picked is kept when a second phone joins and `singleDevice` flips.
Warnings (non-blocking): `readSecs` < 9 「睇卡時間短過官方嘅 9 秒…」; total rounds > 20 「一共 24 輪，會玩好耐。」;
`callouts` 2 at n = 3 「3 個人玩，出兩張收皮啦一定會中老實人。」; `antiStreak` at n ≤ 4 「…唔會生效…」; `speakOrder: 'free'`
with `speakSecs` > 0 「「自己決定」次序冇人輪緊，解釋時限唔會生效。」.
The recommended setup never warns.
Summary lines (lobby): `5 人：1 諗樣 + 1 老實人 + 3 個 9upper — 最啱玩嘅人數` · `快玩：共 5 輪（每人做 1 次諗樣）` (官方玩法: `官方玩法：共 10 輪（每人做 2 次諗樣）`) ·
`難度：隨機` · `發言次序：諗樣揀` / `系統隨機派` / `自己決定` · `睇卡 9 秒` (or `一部手機輪流睇，每人 9 秒`) · `收皮啦 1 張` · optional `每人解釋限時 45 秒` ·
`類別：…` · `分數唔會低過 0` · `老實人可以再睇` · `老實人唔連續做`.
Head-count reasons: 3 「人少，諗樣盲估都有一半機會中」 · 4 「人少，追問更針對」 · 5–7 「最啱玩嘅人數」 · 8–9 「好熱鬧，諗樣最難估」.

Not implemented (all optional in the research): `noGuessPenalty` (needs a judge timer; a stalled 諗樣 is
auto-picked instead), `tieBreak` (ties share the win), `revealMode = read-aloud` (non-official reviewer reading),
the 2-player variant (rules unverified), the app-only "called player is muted" house rule.

## 3. Flow

Everything per round: **level → term → read → explain → judge → reveal**, then the next round, or `over` after
the last. (`level` is skipped unless `levelMode === 'judge'`.) Seats: 諗樣 = the judge of the round; 玩家 = the
other N−1.

Round 1's 諗樣 is random (the rulebook deals the 諗樣 card with the others); afterwards the seat to the left (next
in seat order). The speaking queue `round.explainers` depends on `speakOrder`:
- `judge`: a **suggestion** that starts at a random 玩家 (backlog #20; the 老實人 is as likely as anyone to be first) and goes
  round the table; the 諗樣 may call anybody at any time.
- `system`: a **fully random permutation** of the 玩家, drawn fresh every round *before and independently of* the 老實人.
  Nothing rotates and nothing balances out, so neither the position in the queue nor the first speaker says anything about
  who holds the real card (tested statistically: the 老實人's queue position is uniform and independent of their seat).
- `free`: seat order from the 諗樣's left, only the order of the list on screen; nobody is "up".

Every view carries `hint` — one line for a first-timer, 「而家要做咩」, about the viewer's OWN situation. The game
UI never shows it; the shell shows it only behind 💡 (U1). Examples: term/judge 「大家睇吓題目：有人已經識就㩒「換題」，
冇人識就㩒「開始睇卡」。」 · read/老實人 「記住張卡寫乜，等陣用自己嘅講法講。唔好露出表情！」 · read/9upper
「你睇唔到真解釋，趁而家諗定點作。唔好露出表情！」 · explain/judge 「㩒名叫人解釋、隨便追問（唔可以問身份）；覺得離譜就出收皮啦。」 ·
explain/judge in 系統派 「電話派人講，你追問（唔可以問身份）；覺得離譜就出收皮啦。」 · explain/9upper waiting in 系統派 「等電話派到你；聽住其他人講，諗樣問你就繼續作。」 ·
explain/老實人 in 自己決定 「自己傾好次序先講：照張卡講，講完㩒「我講完」。」 (then 「你講完喇；聽住其他人，諗樣問你就照實答。」) ·
judge/9upper 「等諗樣揀人：揀中你就係呃到佢，淨係你有分！」. `myRole` = the viewer's `rules.roles` id ('judge',
'honest', 'bluffer'), or null before a 玩家 has their card and for the table.

### 3.1 `level` — the 諗樣 picks a difficulty (only with levelMode `'judge'`)

| who | screen |
|---|---|
| 諗樣 | 「揀題目難度」 / 「分數愈高，提示愈少」, three buttons: `⭐ 簡單 · 1 分 — 提示：話你知屬於邊一類` · `⭐⭐ 中等 · 2 分 — 提示：三個類別揀一個（得一個啱）` · `⭐⭐⭐ 困難 · 3 分 — 冇提示，作起嚟最辣` |
| 其他人 / table | 「阿明 揀緊題目難度…」 |

Cue `r{n}:level`: 「第 3 輪，阿明做諗樣。阿明，請揀題目難度：星愈多，提示愈少，分數愈高。」
Choosing draws the term (`bag.draw('9upper', predicate)`; if the pool for that level+category is empty it relaxes the
level, then the category, then takes anything, then one of three built-in emergency cards) → `term`. A stalled
諗樣 is auto-acted with a random level.

### 3.2 `term` — everybody reads the term first

Rulebook step 3: the term card goes face-up, everybody reads the term and its hints, and if anybody already knows
it the card is redrawn — **before** the 9-second step.

| who | screen |
|---|---|
| 諗樣 | term + hint; 「有人已經識呢個詞？出聲就換題，身份唔變。冇人識就開始。」; big 「開始睇卡」; `有人識呢條？換題（仲有 3 次）` (two taps) |
| 玩家 | term + hint; 「已經識呢個詞？出聲或者㩒「我識呢條」，諗樣決定換唔換。」 · 「等 阿明 開始睇卡…」 · 「🙋 我識呢條」 (tap again: 「🙋 已話咗識（再㩒取消）」) |
| table | term + hint; 「等 阿明 開始睇卡…」 |

**「我識呢條」 (decision D5, 2026-10-04).** Every 玩家 has the same button; it only **flags** the 諗樣's 換題 button, which then reads
`🙋 阿聰、小美 話識 · 換題（仲有 2 次）` with an accent outline. It never swaps by itself (the 諗樣 still decides — a swap is two taps)
and it is no tell: nobody holds a card in `term`, the flags are public (`view.knows`), and a swap clears them.

After a 換題 every phone's term card shows 「🔄 換咗題（仲可以換 2 次）」 for 4 s (silent play has no cue to say so).

Cue `r{n}:term:{swaps}`: 「第 3 輪，阿明做諗樣。題目係「{term}」。{hint}有冇人已經識？識就出聲換題；冇人識就由阿明㩒開始睇卡。」
(round intro only when there was no `level` step; after a swap it starts 「換咗題。」).
Hint speech: level 1 「提示：同地理有關。」 · level 2 「提示：地理、科學、歷史，三個入面得一個啱。」 · level 3 「冇提示。」

**換題 (swap).** 諗樣 only, in `term` only, max 3 per round (the rulebook just says "redraw"; the cap only stops
endless fishing). Same difficulty (`levelWanted`; with `mix` any level), **roles, 老實人 and speaking order stay**,
nothing scores. No clock runs in `term`, so nobody's peek is eaten by reading the term.
`start` (諗樣) → `read`. No timer; a stalled 諗樣 is auto-acted with `start`.

### 3.2a 呢輪作廢 and 💤 唔喺度 (decision D4/D6, 2026-10-04)

The host has two tools for a seat that stops answering (the shell's ⋯ menu / stall banner):

- **🗑️ 呢輪作廢** (`@void-round`): the round in play is thrown away — no score, no stats, its term is never dealt again — and
  dealt again under the **same round number**: a fresh term, fresh roles and a fresh speaking order. Who keeps the 諗樣 seat:
  - **same 諗樣** when the stuck seat is a 玩家 (a void during the read or the explaining);
  - **the next 諗樣** when the stuck seat is the 諗樣 — a void in a step only the 諗樣 can move on (`level` 揀難度, `term`
    開始睇卡, `judge` 揀人), or when the host names the 諗樣 (`{ type: '@void-round', pid }`; naming a 玩家 keeps the 諗樣).
    **Lap bookkeeping:** the stuck 諗樣's turn moves to the end of this lap, once, so they still judge if they are back by
    then and nobody judges twice in a lap. Stuck again (or already the last of the lap): that turn is lost, the game is one
    round shorter. With nobody left to judge, the game ends.
  - A scored round (`reveal`) is never voided: `engine.canVoid` says 「呢輪已經計咗分，㩒「下一輪」就得」.
- **💤 唔喺度** (`@absent { pid }`, back with `@present { pid }`): public; the seat is not waited on for the rest of the game.
  The 諗樣 → the round is void and the seat moves on (their turn is dropped). Before the read (`level`, `term`) → the cards are
  dealt again without them. Pass-the-phone read → their peek is passed over. Explaining → their turn is skipped (⏭, listed
  as 💤 唔喺度, never ✅ 已講; back in time, they get it once at the end). 揀人 → their card stands (they can still be picked).
  From the next deal on: no card and no turn as 諗樣 (dropped when it comes up). Their own actions are ignored until
  `@present`. Refused (state unchanged) when fewer than 3 seats would be left.
  **Never automatic on a role:** voiding only when the absent seat is the 老實人 would tell the table who it was, and keeping
  the round only when it is a 9upper would tell the 諗樣 the same. The host, who cannot see roles, may still void.

Every phone shows why a deal is fresh, in `level` / `term`: 「🗑️ 上一鋪作廢：新題目、重新派身份」 · 「🗑️ 上一鋪作廢：阿明 遲啲先做諗樣，
呢鋪由 小美 做」 · 「💤 阿明 唔喺度：呢鋪由 小美 做諗樣」. A 💤 sits next to the name in the score strip. The results list every
void (「🗑️ 第 2 輪作廢（「深水埗」）…」, 「💤 第 5 輪：阿明 唔喺度，冇做諗樣」). Rules text: the 📖 section 「有人唔喺度」.

### 3.3 `read` — the 9-second peek

**Together (default, one phone each).** One window of `readSecs` (9 s) for **everyone at once**; it never ends early.

| who | screen |
|---|---|
| 老實人 | a big hold-to-peek card. Back: 🃏 「㩒住睇卡」. Front: `你係老實人 🙋` / the true explanation / `用自己嘅講法講，唔好照讀。` |
| 9upper | the same card, same size and back. Front: `你係 9upper 🤥` / a bluffing-prompt block built from the public term and hint (`S.bluffDecoy`, e.g. 「即場作！「深水埗」點嚟、幾時開始有，記住佢同「香港冷知識」有關；加個人名或者地方，細節愈具體愈似真。」) / `你睇唔到真正解釋，靠你把口。` |
| 諗樣 | the same sort of card, so every phone is busy: `你係諗樣 🧠` / a block of question ideas (`S.judgeDecoy`) / `等佢哋睇完，就逐個解釋俾你聽。` |
| table | 「大家望住自己部電話睇卡。」 |
| everyone | countdown (`Timer`, label 「睇卡時間」, warns at 5 s); note 「㩒住張卡睇，倒數完先好擡頭。唔好露出表情。」 |

The decoy blocks are about as long as a real explanation (bank: 17–67 characters, median 36; decoys 28–75, most 30–50, the
template picked per round and seat so the length varies like a real one) and every card uses one font size and a text
box that always reserves four lines, so neither a glance at a neighbour's card nor who is still reading heads-down
names the 老實人. The window opens with the **same `deal` sound and a screen flash on every phone** (諗樣 and table
too; an iPhone on silent plays no Web Audio, so the flash is the cue) — not again when a phone re-mounts mid-window.
Each phone notes whether its card was opened during the window (`Cover` `onOpen`). A 老實人 whose phone watched the
whole window without an open is not told 「你睇過真正解釋喇」 afterwards; the reminder card says
「你冇打開到張卡，問到就答「張卡冇寫」。」 / 「唔好話俾人知你冇睇到。」 instead (same three-line shape,
private to that phone). A phone that (re)mounted after the start of the window cannot know and shows the usual line.

Cue `r{n}:read`: 「開始睇卡！大家一齊數 9 秒。」 (rulebook: everybody counts the 9 seconds together).
When the window ends every card closes at the same instant → `explain` (`@next` from the host skips the rest).

**Pass (`passPhone`).** The phone goes left from the 諗樣 (`readers` = seat order after the judge). For each reader:
`focus = [reader]` → the shell's PassGate 「交俾 阿B」 → the reader sees 「開始睇卡（9 秒）」 and taps it (`peek`) →
their card opens for exactly `readSecs`, the clock closes it → next reader. There is **no 我睇完 button**: every
reader holds the phone for the same time, so a slow read cannot point at the 老實人 (research "anti-tell":
"exactly the same duration"). Others see 「阿B 睇緊卡…（已睇 1/4）」. A seat's card (and, for the 老實人, the text)
exists only from the start of its own window. After the last reader → `explain`.
Cue `r{n}:read`: 「部手機由阿B開始逐個傳，每人睇 9 秒，夠鐘自動冚返。」

### 3.4 `explain` — the 諗樣 runs the questioning, the order depends on `speakOrder`

Every seat's screen: the term + hint, the speaking list (`round.explainers`: `✅ 已講` / `⏭ 跳過咗` / `🎤 講緊` / `⏳ 等緊`), the 收皮啦
marker (`🛑`), an optional per-speaker countdown and, for a 玩家, the small hold-to-peek card (front `你係老實人` /
`你係 9upper`, plus the explanation when `rePeek`; back 「㩒住睇返我係咩」). The 諗樣's 「我決定咗，要揀人」 (`decide`, any
time — the rulebook allows the accusation before everybody has spoken) and the 收皮啦 row (§3.5) are in every mode. What differs:

| | `judge` 諗樣揀 (default) | `system` 系統派 | `free` 自己決定 |
|---|---|---|---|
| queue | rotation from a random 玩家, a suggestion | fresh random permutation per round, independent of the 老實人 | seat order, display only |
| on the floor | `turn.pid` = current speaker (🎤 講緊) | same, dealt by the phone | nobody (`turn.pid` = `null`), no clock |
| announcement | the list only | a banner 「🎤 輪到 阿B」 / 「🎤 輪到你講！」 (soft `turn` chime on that phone) + 「下一位：阿C」 (last: 「之後就到諗樣揀人」); list rows numbered `1.` … | none; note 「大家自己傾好邊個先講；講完㩒「我講完」。」 |
| speaker | big 「我講完」 | big 「我講完」 | every 玩家 not yet ticked off sees 「我講完」 (ticks themselves) |
| 諗樣 | each waiting name is `👉 叫佢講` (`call`), a skipped one `⏭ 跳過咗 · 叫返佢`; 「下一位」 skips the speaker | no `call`; 「下一位」 skips the speaker; note 「電話隨機派人，次序同邊個係老實人冇關。人唔喺度就㩒「下一位」跳過，佢最尾會再輪到。…」 | each waiting name is `👆 講完喇` (ticks that 玩家 off); no 「下一位」 |
| leaves `explain` | the last speaker ends | the last speaker ends | the last 玩家 is ticked off |

Cues. `judge`: `r{n}:explain` 「睇卡完。收起電話，由阿B開始解釋「{term}」。阿明可以叫人、追問，但唔可以問人係咩身份。」
`system`: `r{n}:explain` 「睇卡完。收起電話，今輪由電話隨機派人，第一位係阿B，解釋「{term}」。阿明可以追問，但唔可以問人係咩身份。」,
then one short line per turn, id `r{n}:explain:{k}` (k = `turnNo`, turns ended so far): 「輪到阿C。」 / 「最後一位，輪到阿D。」
(「最後一位」 = nobody, not even a skipped player, is left after them)
(minMs 1200). `free`: `r{n}:explain` 「睇卡完。收起電話，大家自己傾好邊個先講，逐個解釋「{term}」，講完㩒「我講完」。阿明可以追問，
但唔可以問人係咩身份。」 (nobody is named, nobody is first). Every cue is public: the dealt order of a 系統派 round is public
to everybody.

Turns. `judge` / `system`: a turn ends when the speaker (or the 諗樣) taps, or at the per-speaker deadline if
`speakSecs > 0`; the next speaker is the first waiting one in queue order; after the last → `judge`. In `judge` only,
`call` makes the target the current speaker (fresh `speakSecs`); the interrupted speaker goes back to waiting (not marked ✅).
The UI sends `done` with the turn number it saw (`turn.no` = `round.turnNo`, which counts every ended turn and call): a
我講完 and a 下一位 tapped at the same moment end one turn, not two (the engine ignores a `done` whose `turn` is stale).

**Skips (#23).** A turn ended FOR the speaker — the 諗樣's 下一位, or the host's ⏭ 下一步 — is a skip, not a 我講完: the
row shows `⏭ 跳過咗` (`round.skipped`, public as `turn.skipped`). Once nobody new is waiting, each skipped player gets the
floor back **once** (`round.back`), in the order they were skipped; skipped again after that, they stay skipped and the
round moves on. In 諗樣揀 the 諗樣 can also call a skipped player back at any time (`call`). A speaking clock that runs
out is not a skip (they had the floor for the whole time). `free`: the host's ⏭ ticks the first waiting 玩家 off as
skipped; they come back onto the list once nobody else is waiting. `view.turn.next` is who is up after the current
speaker (the 系統派 banner's 「下一位」). `free`: `done` ticks one 玩家 off (✅ 已講) — a 玩家 can
only tick themselves, the 諗樣 can tick anybody with `target` (one shared phone, a flat phone); once everybody is ticked off
→ `judge`. No clock runs in `free` (`speakSecs` is ignored; `validate` warns).

### 3.5 收皮啦 (callout)

Allowed to the 諗樣 in `explain` and `judge` (after the peek, before the pick), once per target, at most `callouts`
per round (default 1), never on self. UI: a row 「🛑 收皮啦 · 剩 1 張」 with one chip per 玩家 **in seat
order** (the same order as the 揀人 list above it) and a red outline that sets it apart from the picker; tap a chip →
「確定收皮 大熊？」 for 3 s (a wrong call costs 3) → action. Played cards are public at once: banner `🛑 阿明 對 阿B 出咗收皮啦！`, `deny`
sound, and the target's own phone adds 「俾人 call 咗，繼續撐落去。」 The target's role stays hidden until the reveal.
The card cannot be taken back. **It does not silence anybody** (muting is the online app's house rule; no
rulebook source has it), so the current speaker keeps the floor.
Rules text on the EV: 「賺 1 蝕 3，大約有七成半把握先抵；不過 6 人或以上 9upper 多，求其出都唔蝕。」 (research:
break-even at p = 0.75; a blind callout is −EV at 3–4 players, 0 at 5, +EV at 6+ — do not call it bad at large N.)

### 3.6 `judge` — the pick

| who | screen |
|---|---|
| 諗樣 | 「邊個係老實人？」 PlayerPicker (the 玩家), confirm 「就係佢！」; note 「揀之前仲可以繼續問（唔可以問身份）。揀咗就改唔到。」; 收皮啦 row |
| 玩家 | 「阿明 諗緊邊個係老實人…」, 「諗樣仲可以追問，大家都可以互相質疑。」 + the role-reminder card + the 收皮啦 banner |
| table | same, no card |

Cue `r{n}:judge`: 「阿明，決定咗就揀邊個係老實人；揀之前仲可以繼續問。」
No timer. Only the 諗樣 picks (nobody votes). A stalled 諗樣 is auto-acted with a random pick (no penalty).

### 3.7 Anti-tell handling

- **Fixed windows** — together: one host deadline for everybody, all cards close together; pass: every reader gets
  exactly `readSecs`, started by their own tap, ended by the clock. No 「睇完」 button and no early end anywhere.
- **Identical cards** — 老實人, 9upper and 諗樣 get the same back art, the same card size (the shared `Cover`, fixed
  5:3), the same three-line front structure, the same peek sound, one font size, a four-line text box, and a text block
  of about the same length (decoys for the 9upper and the 諗樣, see §3.3).
- **One start for everybody** — the read window opens with the same sound and flash on every phone.
- **Everybody looks down** — the 諗樣 holds a decoy card too in the together window.
- **No explanation outside the window** (unless `rePeek`) — the 老實人's phone drops the text, so the 老實人 must speak
  from memory like in the box game; the role reminder that stays has the same shape for every role.
- **Nothing before your window** — in pass mode a seat's view has no card and no role until its own window starts.
- The 諗樣's view and the table view never contain anything about roles. Phase hints only ever talk about the
  viewer's own role.

### 3.8 `reveal`

Everyone gets the same screen. Two beats (CSS delay): 「阿明 揀咗 阿B…」 → after about 1.2 s the `reveal` sound and:

```
老實人係 阿B 🙋
🤥 9upper：阿C、阿D                                    (every card face up, seat order)
✅ 阿明 揀中老實人：阿明 同 阿B 各 +2
   (or) ❌ 阿明 揀咗 阿C，但 阿C 係 9upper：阿C 呃到諗樣 +2，阿明 同 阿B 冇分
🛑 收皮啦 → 阿D：真係 9upper，阿D −1、阿明 +1      (or)  🛑 收皮啦 → 阿B：佢係老實人！阿明 −3
（分數唔會低過 0：阿明 實際扣少咗）                   (only with scoreFloor, when it clipped)
真正解釋 · ⭐⭐ / {term} / {explain} / 來源：維基百科：深水埗   (S.srcLabel: a readable label, a link for a web source)
分數變動：阿明 +3 · 阿B +2 · 阿D −1        (then the new score chips)
```

Buttons: the 諗樣 sees 「下一輪」 (last round: 「睇總結」); everyone else sees 「等阿明開下一輪」. `@next`
from the host works as well; a stalled 諗樣 is auto-acted.

Cue `r{n}:reveal`: 「老實人係阿B。阿明估中咗，阿明同阿B各得 2 分。真正解釋係：{explain}」 (wrong pick:
「…阿明揀咗阿C，但阿C係 9upper，阿C呃到諗樣，得 2 分。」). Each callout adds a sentence.

### 3.9 `over` and results (#10)

`engine.result` is non-null only in `over`. Winners = every seat with the top score (ties share the win).
`points` = final scores (everyone starts on 3). Summary: `阿明 以 11 分贏出` / `阿明、阿B 同分，一齊贏（10 分）`.
Lines: first **why each player has their score** (winners first, 🏆), then awards, then one block per round —

```
🏆 阿明 11 分：開局 3、做諗樣估中 +4、做老實人被揀中 +2、收皮啦中 9upper +1、俾人收皮 −1、呃到諗樣 +2
阿B 7 分：開局 3、呃到諗樣 +4
阿C 3 分：開局 3，冇加冇減
🤥 最勁 9up：阿B（呃過諗樣 2 次）
🧠 最準諗樣：阿明（估中 2/2）
🛑 收皮啦出咗 4 次：中 9upper 3 次，中老實人 1 次
第 1/10 輪「{term}」⭐⭐（諗樣 阿明）
　老實人係 阿B；阿明 揀咗 阿C（9upper）→ 阿C 呃到諗樣 +2
　🛑 收皮啦 → 阿D：係 9upper → 阿D −1、阿明 +1
　真正解釋：{explain}
　來源：{srcLabel}
```

Every reason sums back to the final score (tested). Reasons: 做諗樣估中 · 做老實人被揀中 · 呃到諗樣 · 收皮啦中 9upper ·
收皮啦中老實人 · 俾人收皮 · 唔會低過 0 補返 (scoreFloor).

## 4. Single-device play

`meta.singleDevice = 'full'`. Turn on 「一部手機輪流睇」 (`passPhone`; the shell's `env.singleDevice` does it
automatically once passed). The phone moves like this:

1. `level` / `term` / `explain` / `judge` / `reveal`: `focus.pids = [judge]` — the shell hands the phone to the 諗樣
   behind a PassGate. In `term` the 諗樣 shows the term to the table.
2. `read`: `focus.pids = [reader]`, one reader at a time from the 諗樣's left. PassGate 「交俾 阿B ・ 其他人唔好望」 →
   「開始睇卡（9 秒）」 → the card for exactly 9 s → the clock closes it and focus moves to the next reader, whose gate
   appears. After the last reader the phone goes back to the 諗樣.
3. The together window does not work on one phone (one window for N people) — that is why pass mode exists.
   Without `passPhone`, a device holding several seats would only let its first seat read.
4. `rePeek` and the role-reminder card need a private seat switch; on one phone they are only used if somebody
   switches seat by hand (the shell's own gate). The 諗樣's phone never shows anything about roles.

No paper mode.

## 5. Engine

Phases: `level` → `term` → `read` → `explain` → `judge` → `reveal` → (`level`|`term`) … → `over`.

State (JSON; **PRIVATE** = never in any view before `reveal`):

```
phase, deadline, timerLabel, cfg (normalised, preset applied, laps resolved), players [{id,name,seat,color}],
order [pid…], totalRounds (= judges.length), roundNo, judges [pid…] (the whole schedule), judgeLaps [lap…] (parallel),
moved {pid: lap} (a stuck 諗樣's turn already moved this lap), voids [{n, judge, term, how, kept?}] (how: redeal / stuck /
absent / skip), absent [pid…] (💤, public), lastHonest (public after its reveal),
scores {pid: n}, stats {pid: {judged, caught, fooled, callHit, callMiss}},
history [round summaries incl. parts[] = why each point moved — after reveal only], cueAck,
round: {
  n, key (n, or `${n}v${voids}` after a void: cue ids and the UI's per-round memory), judge,
  explainers [pid…] (speaking queue — by cfg.speakOrder: rotation from a random start / random permutation / seat order; seats marked 💤 at the deal are left out), readers [pid…] (seat order from the judge's left),
  honest (PRIVATE), term {term, explain (PRIVATE), cat, level, src, hint}, levelWanted, swaps, knows [pid…] (我識呢條, public), redo {how, judge, kept}|null (public),
  reader, readStarted, readDone [pid…] (pass mode), speaker (null in 自己決定), spoken [pid…], skipped [pid…] (turn ended
  for them), back [pid…] (already had their one come-back), turnNo, called [pid…], pick, reveal
}
```

`hint` (the card hint) is built at draw time and public: level 1 `{ kind: 'one', options: [cat] }`, level 2
`{ kind: 'three', options: [3 shuffled categories, exactly one true] }` (decoys are real bank categories), level 3 `null`.

### Actions (all validated; bad input returns the state unchanged, never throws)

| action | pid | phase | rule |
|---|---|---|---|
| `{type:'level', level:1\|2\|3}` | judge | `level` | draws the term → `term` |
| `{type:'swap'}` | judge | `term` | `swaps < 3`; new term of `levelWanted`; honest, explainers unchanged; clears `knows` |
| `{type:'know', on?}` | a 玩家 dealt this round | `term` | 我識呢條: adds (or with `on: false` removes) the seat in `knows`; never swaps |
| `{type:'away', turn?}` | the speaker (`free`: a 玩家 not yet ticked) | `explain` | what 代佢做 sends for a 玩家 whose phone is gone: the turn ends as a **skip** (⏭ 跳過咗, back once), never as their own 我講完. A seat can only ever skip itself |
| `{type:'start'}` | judge | `term` | → `read` |
| `{type:'peek'}` | the current reader | `read`, `passPhone` | starts that reader's `readSecs` window (once) |
| `{type:'done', turn?}` | current speaker or judge | `explain`, `judge` / `system` | speaker → spoken (sent by the 諗樣: also → skipped); next waiting in queue, else a skipped player once; none left → `judge`. Optional `turn` (number) must equal `round.turnNo`, else ignored |
| `{type:'done', target?}` | a 玩家 (self) or the judge (`target`) | `explain`, `free` | ticks that 玩家 off (a 玩家's `target` is ignored); already ticked / not a 玩家 / judge without `target` → unchanged; all ticked → `judge` (a host-skipped 玩家 is back on the list once first) |
| `{type:'call', target}` | judge | `explain`, `judge` mode only | target is a 玩家, not speaking, not spoken (or skipped) → current speaker (fresh turn timer). Refused in `system` and `free` |
| `{type:'decide'}` | judge | `explain` | → `judge` |
| `{type:'callout', target}` | judge | `explain`, `judge` | target is a 玩家, not yet called, `called.length < callouts`; nobody is muted |
| `{type:'pick', target}` | judge | `judge` | target is a 玩家 → scores settle → `reveal` |
| `{type:'next'}` | judge (any present seat while the judge is 💤) | `reveal` | next round, or `over` after the last |
| `@void-round {pid?}` | host | any but `reveal` / `over` | 呢輪作廢 (§3.2a): same 諗樣 (a 玩家 stuck) or the next one with lap bookkeeping (the 諗樣 stuck: `level`, `term`, `judge`, or `pid` = the 諗樣) |
| `@absent {pid}` / `@present {pid}` | host | any but `over` | 💤 (§3.2a); refused below 3 seats at the table |
| `@cue-done {id}` | host | any | acknowledges the cue if `id` matches |
| `@next` | host | any | acknowledges a pending cue first; otherwise skips the wait: `level` → random level, `term` → `read`, `read` together → `explain`, `read` pass → start the reader's window, then end it (never skips a reader), `explain` → end turn as a skip (`free`: tick the first 玩家 still waiting, as a skip), `judge` → nothing, `reveal` → `next` |

`@auto` is handled by the session via `autoAct`.

### Timers

`read` together: `deadline = now + readSecs·1000` at `start`, label 「睇卡時間」; `advance` → `explain`.
`read` pass: no deadline until `peek`; then `now + readSecs·1000`, label 「阿B 睇卡」; `advance` → next reader / `explain`.
`explain`: when `speakSecs > 0` each turn (also a called or dealt one) gets `deadline = now + speakSecs·1000`, label 「{name} 講緊」;
`advance` ends the turn. `free` has no current speaker, so no clock. No other phase has a deadline.

### Views (whitelist)

Common: `me, phase, title ('第 3/12 輪'), subtitle ('阿明 做諗樣'), deadline?, timerLabel?, round {n, total, key}, absent [pid…],
knows [pid…] (`term` only), redo {how, judge, kept}|null (`level` / `term` of a fresh deal), judge,
explainers, scores, term {text, level, hint}|null, readMode ('together'|'pass'), readSecs,
reading {pid, started, done, order}|null (pass mode, read phase), turn {pid, spoken, total, skipped, no, next}|null (explain; `pid` is `null`
in `free`), speakOrder ('judge'|'system'|'free', public), callouts {max,left,used}, canSwap, swapsLeft, last, rePeek, mine,
myRole, reveal, hint`.

`mine` (a 玩家 holding their card; null for the 諗樣, the table, and anybody before their card opens):
`{ honest: bool, explain?: string }`. `explain` is present only for the 老實人, only during their window (or
`explain`/`judge` with `rePeek`). The reveal object exists only in `reveal`/`over`:
`{ judge, honest, pick, correct, d, term, explain, src, cat, level, called: [{pid, hit}], changes: [{pid, delta, nominal}], lines[] }`.

### `focus`

`level|term|explain|judge|reveal` → `{ pids: [judge] }` (in `free` too: on one shared phone the 諗樣 holds it and ticks names); `reveal` with the 諗樣 marked 💤 → null (anybody presses 下一輪; a shared phone's gate never asks for a seat that is away); `read` together → all 玩家 at the table; pass → `[reader]`; `over` → null.

### `blocking(state, pid)` — is the table really waiting on this seat?

The room's stall check (代佢做 / 💤) asks this, not `focus`: the 諗樣 in `level`, `term`, `judge`, `reveal` · the reader whose turn it is
in a pass-the-phone read (not yet started) · the speaker on the floor in `explain` (諗樣揀 / 系統派) · nobody in the shared read window
(it has a clock) or in 自己決定 (the 諗樣 can tick anybody off) · never a seat marked 💤.

### `canVoid(state)`

`{ ok: true }`, or `{ ok: false, message }` on `reveal` (「呢輪已經計咗分，㩒「下一輪」就得」 / 「…㩒「睇總結」就得」) and after the end.

### `autoAct(state, pid)`

`level` judge → random level · `term` judge → `start` · `read` (pass) reader → `peek` · `explain` judge → `done` (a skip) and the
speaker → `away` (a skip: ⏭ 跳過咗, never ✅ 已講 — round-1 leftover, 2026-10-04) (`free`: a 玩家 not yet ticked → `away`, the judge →
`done` of the first 玩家 still waiting, a ticked 玩家 → null) · `judge` judge → random pick · `reveal` judge → `next` ·
a seat marked 💤 → null · otherwise null.

### `legalActions(state, pid)`

Exactly the actions in the table that are legal for `pid` now (together `read` → none; the clock does it).

### Scoring (D = `term.level`)

```
if pick is honest:  judge +D, honest +D          else:  pick +D
for each 收皮啦 target t:  t is honest → judge −3     else → t −1, judge +1
```

Settled **atomically**: deltas are netted per player, then applied; with `scoreFloor` each score is clamped at 0
afterwards and `changes[].delta` is the applied value (`nominal` keeps the unclamped one). Golden vectors 1–7 from
the research are in the tests (vector 8 needs the unimplemented `noGuessPenalty`).

## 6. Edge cases → test list

Tests named `rule: …` pin a research rule. Covered in `tests/9upper.test.mjs`:
- Config: defaults valid and warning-free for n 3–9; laps table; presets (each preset fixes its keys, hides them,
  says how long; custom shows them; newbie draws ⭐ only); validation of every field; summary head-count line
  with a reason; `env.singleDevice`.
- Setup: totalRounds = n × laps; every seat judges `laps` times; judges rotate left; round-1 judge random; honest is
  never the judge; exactly one honest; everybody starts on 3; first speaker random over every 玩家 (#20); anti-streak
  on/off/no effect at n ≤ 4.
- Each phase accepts only its actions from the right seat; garbage input → unchanged, no throw.
- Level: default random mix; fixed; judge-chosen; `cats` filter; fallback chain to the emergency card.
- Hints: level 1 one true option, level 2 three options one true (distinct, real categories), level 3 none.
- Term: public before the peek, no clock, swap only there (limit, same level, same roles, new cue, nothing scores).
- Read: 9 s together window, no early end, `@next` skips; pass mode — readers from the judge's left, one equal
  window each, no early finish, no card before your window, `@next` never skips a reader.
- Explain: queue order; `done` by speaker/judge only; `call` (judge only, waiting targets only, interrupted speaker
  returns to waiting); `speakSecs` incl. after a call; `decide` any time.
- Speaking order (`speakOrder`): the field is always shown (every preset), one help line per mode, and the engine honours it
  under every preset; 系統派 — a permutation of the 玩家, the 老實人's queue position and the first speaker are uniform and
  independent of the seat (sampled over 400–900 seeds at n = 3, 4, 5), a new order each round, `call` refused and not
  legal, the stale `turn` guard, one cue per turn, `speakSecs` per dealt turn, `@next` / `autoAct`; 自己決定 — no speaker, no
  clock, self-tick / judge-tick rules, last tick → `judge`, legal actions, `autoAct`, `@next`, one cue naming nobody; hints
  ≤ 40 chars for every mode with the mode's own wording; the scripted leak check and the fuzzers run in both modes; a fake-DOM
  UI test for the announcement, the chime, the missing 叫佢講 and the tick buttons.
- Skips (#23): the 諗樣's 下一位 and the host's ⏭ mark ⏭ 跳過咗; a skipped player comes back once after everybody else
  (系統派 / 諗樣揀 / 自己決定), the 諗樣 can call them back in 諗樣揀, a second skip is final, a clock that runs out is not
  a skip, and the turn number survives a come-back (a stale double tap never ends the wrong turn).
- Cards (#16, #21): every card holds a block of similar length during the read; the read window opens with one `deal`
  sound and a flash on every phone, once; a 老實人 whose phone saw an unopened window is told so; a phone that joined
  later shows the usual line.
- 收皮啦: once per round by default, 2 as an option (distinct targets), 0 disables, not during term/read, not self,
  does not mute the speaker; the chips follow seat order and the armed chip names its target (#22).
- Reveal: names the 9uppers; the source is a readable label (`srcLabel`: 維基百科 / Wikipedia / 萌典 / … or the host
  name, never percent-encoded, at most 32 characters of title) and a link; a 換題 is announced on every phone.
- Scoring: the seven golden vectors (N = 5, D = 2), D by level, floor on/off, netting per player.
- End: `next` after the last reveal → `over`; winners / tie / points; every round's term, explanation, source;
  per-player breakdown sums to the final score (#10); reveal lines name the 老實人 and every reason.
- Cues: ids unique per step, acknowledged cue → null, `@next` acknowledges first; term cue carries the term.
- U1: every phase × every seat (and the table), in every `speakOrder`, has a one-line hint ≤ 40 chars, never the explanation, never another
  role's tip; `myRole` only for your own card; rules.quick ≤ 6 short lines; every role text says 做咩 + 得分.
- Leaks: at every step of random games in every mode, no view other than the honest seat's (in its window, or with
  `rePeek`) contains the explanation; no `honest` key outside `mine` of a card holder; `mine.honest` is only the
  viewer's own; no private state keys in any view.
- UI smoke test (tiny DOM shim): mounts every seat through random games in every mode, never puts the explanation on
  a wrong screen, and the new controls (開始睇卡, peek, 叫佢講, 收皮啦 double tap, decide, pick) send the right actions.
- Fuzzer: every n 3–9 × 110 seeds plus five config modes with leak checks; empty/missing bank; determinism and
  JSON-safety; every legal action changes the state.
- Decisions 2026-10-04: D5 — 快玩 is the default at every n (n rounds), 官方玩法 next in the select with the rulebook table,
  an old saved 官方玩法 moves over once and a later pick stays; 我識呢條 (public, toggles, never swaps, cleared by a swap, only
  in `term`, same button on every 玩家's phone). D4/D6 — 呢輪作廢 with a stuck 玩家 (same 諗樣, fresh term / roles / order, no
  score, fresh cue ids, the voided term never returns) and with a stuck 諗樣 (moved to the end of the lap once, then dropped;
  every seat still judges once per lap; the last voids end the game); `canVoid`; 💤 for the 諗樣 (void, turn dropped, no card
  later, their later turns dropped), for a 玩家 (skipped, never ✅, back once with `@present`; their card stands in 揀人), before
  the read (cards dealt again without them / with them), for a pass-the-phone reader; refused below 3 seats; 下一輪 for anybody
  while the 諗樣 is away; `blocking` per phase; `autoAct` for a speaker → `away` (⏭ 跳過咗); a fuzz with random voids, absences
  and returns (leak sweep at every step, history = rounds played, at most one 諗樣 turn per seat per lap). UI: 我識呢條 →
  the 諗樣's flagged 換題, the fresh-deal line, ⏭ after 代佢做, 💤 in the list and the scores, 下一輪 for others, no card for a
  seat that was away at the deal.

## 7. 貼心 touches

- A calm `term` step: the term is read before anybody's peek starts, and 換題 there keeps the roles.
- Presets with a reason, and a 新手 preset that follows the rulebook's "level 1 for your first game".
- Everyone (the 諗樣 too) holds a same-shaped card, so reading is invisible; on one phone every reader gets the
  same seconds.
- The 諗樣 runs the room: tap a name to call on somebody, end a turn, or decide early. Or hand the order to the phone
  (系統派: 「輪到 阿B」 on every screen, a chime on the called phone, a spoken line per turn) or to the table (自己決定: tap 「我講完」).
- 收皮啦 needs a second tap, because a wrong one costs 3; the rules text gives the honest maths.
- Reveal shows the true explanation and its source — the 「原來係咁」 moment — and the end screen explains every
  score and keeps every round's explanation.
- 💡 hints for first-timers, only on demand.
- Terms never repeat across evenings (the bag). The answer bank is only loaded on the host phone; every other phone
  only ever receives views, and a view never carries anybody's secret.

## 8. Framework requests

1. `config.defaults(n, prev, env)` — room.js calls `defaults(n, prev)` only. Please pass `{ singleDevice: true }`
   in LocalTransport mode so 9upper turns on `passPhone` by itself. Until then the field help says
   「得一部手機就開」.
2. **U1 shell sheet**: 9upper provides `view.hint` (every phase, every seat, table too) and `view.myRole` (the id
   into `rules.roles`, or null). The 💡 sheet should show 「而家要做咩」 = `view.hint` and 「你嘅角色」 = the
   `rules.roles` entry for `view.myRole`.
3. **Presets in ConfigForm**: a select option cannot carry a patch today, so a named preset hides the fields it
   controls and the game applies the preset internally. If ConfigForm ever supports `options[].patch`, 9upper can
   switch to writing the preset values into the visible fields.
4. `categories` Field: 9upper supplies `options` itself (`CATEGORIES` in game.js); a `stats` object
   (「已用 37 / 1,243」) is not supplied because `config.fields` has no bag access.
5. Stall detection: 9upper has `engine.blocking` (§5); `autoAct` covers every phase. With the 2026-10-04 core change a
   connected seat can be listed as 「冇反應」 too; in 9upper the long, normal waits are a speaker talking (no `speakSecs`) and
   the 諗樣 thinking in 揀人, so that list should stay quiet (the ⋯ menu), never a banner.
6. Bank curators: a new category in `js/data/9upper-terms.js` must be added to `CATEGORIES` in game.js
   (the test fails until it is). The 新手 preset needs ⭐ (level 1) terms — keep at least ~20.
7. 「呢輪作廢」 (`@void-round`) and 💤 (`@absent` / `@present`) are implemented (§3.2a), with `canVoid`.
8. Naming (research, legal): 9UPPER / 瞎掰王 belongs to Time2Play; the research suggests a neutral display name
   (e.g. 吹水王). `meta.name` and the registry entry are left as they are — the lead decides.
