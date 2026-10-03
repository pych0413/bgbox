# 間諜 (Spyfall) — play-flow spec

> Rules source: `docs/research/spyfall.md` (paraphrased from the official rulebooks; nothing copied).
> Code: `js/games/spyfall/{game,ui,index}.js`, tests: `tests/spyfall.test.mjs`.
> Template: `docs/DESIGN.md` §15.9. All times UTC. All player-facing text is Hong Kong Cantonese.

## 1. At a glance

| | |
|---|---|
| Players | 3–12 (DESIGN §0 says 3–8; the engine supports 12 because Spyfall 2 does, with two spies from 9) |
| Length | 6–10 min per round (by head-count), default 3 rounds, about 35 min |
| Narration | optional — short public cues only, never a secret |
| Single device | full — set 投票方式 to 舉手 and pass the phone round for the private look |
| Banks | `spyfall` (locations `{ name, emoji, cat, roles[7] }`) |

**What the phones do.** Draw the location list and the secret, deal a card to each seat (a location and
a role, or 「你係間諜」), run the clock, track who may ask whom, stop the clock for accusations, count votes
and apply the unanimity rule, let a spy stop the clock and name a place, score every round.

**What happens at the table.** The questions and answers. The app never listens to or mediates them; it only
shows whose turn it is. Raising hands (if you pick 舉手) and role-playing the role card are also physical.

**One game = N rounds on one fixed location list.** The list is drawn once when the game starts (24 by
default) and is the same for every round, like the printed list in the box. Each round's secret is one
location from it that has not been used yet. Used locations stay on the list but show grey, because they can
no longer be the answer.

## 2. Setup

### Config

| key | UI label | type | default | notes |
|---|---|---|---|---|
| `rounds` | 幾多局 | int 1–10 | 3 | 1 = quick game (no scoring emphasis). The rulebook suggests 5 for a first session; 3 suits a travelling group that plays several games an evening. Capped at the list size. |
| `minutes` | 每局幾多分鐘 | int 2–20 | by head-count | 3–4 → 6, 5–6 → 7, 7–8 → 8, 9–10 → 9, 11–12 → 10 (the Spyfall 2 table) |
| `spies` | 間諜人數 | int 1–2 | 1, or 2 from 9 players | 2 needs at least 6 players |
| `voteMode` | 投票方式 | select | `phone` | `phone` = everyone taps yes/no on their own phone. `hands` = everyone raises hands, one person taps the result (single-device play) |
| `listSize` | 地點清單長度 | select 16/20/24/30 | 24 | |
| `categories` | 地點類別 | categories | all | value = `{ cats: [names] }` (the ConfigForm shape; a bare array is tolerated), empty = all |

`config.defaults(n, prev)` keeps `rounds`, `listSize`, `voteMode` and `categories` from the last game but
re-derives `minutes` and `spies` from the head-count.

### Validation

Errors (block start): head-count outside 3–12, rounds outside 1–10, minutes outside 2–20, spies not 1 or 2, two
spies with fewer than 6 players, unknown list size or vote mode.

Warnings (shown, do not block):
- 3 players: 「3 個人玩間諜好易估到，5–8 人先最好玩」
- one spy with 9 or more players: 「N 人建議 2 個間諜，1 個間諜太易俾人揪出」
- two spies with fewer than 9: 「官方建議 9 人或以上先用 2 個間諜」
- minutes more than 2 below the recommendation
- exactly one category chosen (the list is topped up from other categories if too few locations match)

### Drawing the list and dealing

1. Draw `listSize` distinct locations through the bag, filtered by category. If the filtered pool is smaller
   than the list, the bag refills and starts repeating; repeats are skipped. If fewer than 8 (or `rounds`)
   remain, the list is topped up from the whole bank. `rounds` is capped at the final list length.
2. The list is shuffled, then grouped by category (so the spy can scan it), and the order carries no
   information about the secret.
3. One distinct secret per round is chosen at setup (`state.plan`). Only these keep their role pool in state.
4. Each round: spies are chosen uniformly (no "previous spy cannot repeat" rule), each non-spy gets a role from
   the secret location's role list, no repeats while the list allows (the bank has 7 roles, so tables of 9+ with
   few spies repeat roles; roles are flavour only).
5. Dealer: random in round 1, then one seat clockwise each round. The dealer asks the first question and
   starts the final vote.

## 3. Flow

Phases: `reveal` → `play` ⇄ `vote` / `tally` → `guess` → `roundEnd` → (`reveal` again | `over`).

### 3.1 reveal — everyone looks at their card

| Screen | Shows |
|---|---|
| Every seat (spy or not — identical layout) | Header 「第 1/3 局 · 發牌員 阿明 · 1 個間諜」, the role card (hold to peek, release to cover), a 「睇完喇 — 準備好」 button, the location list (open by default), who is ready |
| After tapping | Button becomes 「✓ 準備好喇 · 等緊 2 個人」 and the names still missing |
| Host | Same screen plus the shell's host menu (pause, auto-act for a stalled seat) |
| Spectator / late joiner | Header and who is ready, no card |

The card is a RoleCard with a neutral team (no colour or label differs between spy and non-spy).
- Non-spy: location emoji + name big, 「你嘅身分：櫃員」.
- Spy: 🕵️ + 「你係間諜」, 「靠大家嘅問答諗出地點，唔好俾人睇穿。」

Everyone has the location list, so nobody can tell who is the spy from who opens it.

**Narration (cue `deal`, 2.5 s):** 「第{n}局，發牌員係{dealer}。每個人㩒住張卡睇自己嘅身分，睇完㩒「準備好」。」

**Transition:** when every seat is ready the clock starts. **Narration (cue `start`):** 「大家準備好，計時{m}分鐘，開始！由{dealer}問第一條問題。」

**Anti-tell:** the clock never starts early or late depending on role; the ready button and the peek are the
same for all; peeking is local (hold, no sound).

### 3.2 play — the clock is running

Every seat sees the same public screen plus its own card.

1. **Clock.** The Timer component counts to `view.deadline` (the true end of the clock). It beeps at 60 s,
   10 s and zero. 「剩餘時間」.
2. **Who asks next.** A card 「輪到 阿明 問」 with 「唔可以問返 阿華」 and a grid of seats. The seat holding the
   floor taps the person they ask; that person becomes the holder and the previous holder is blocked. The
   heading for the holder reads 「你問邊個？」. 「↩ 撤銷」 takes back the last pass (8 deep). A small trail shows
   the last passes: 「阿明 → 阿華 → 阿B」.
3. **Accuse** 「🙋 指控」: one per player per round (the button shows 「已用咗指控」 afterwards). Opens a picker
   (everyone except you), confirm with 「指控佢」. Spies may use theirs as a feint.
4. **Spy button** 「🕵️ 我係間諜」: exists on every phone. A non-spy gets a private toast 「你唔係間諜，唔使㩒」
   and nothing is sent. A spy gets a confirmation 「確定？㩒落去鐘會停，全場即刻知你係間諜，然後你要喺清單揀
   一個地點。」 [取消] [我係間諜，停鐘].
5. **Accusation log** under the buttons: 「阿明 → 阿華 ✗ 唔通過」.
6. My card and the location list (collapsed by default during play). Tap a location to strike it out; the strike
   is local to your phone.

**Narration:** at one minute left (cue `warn`, only if the round is longer than 75 s): 「仲有一分鐘。」

**Pausing.** Host pause is generic (the session shifts `deadline`; the Timer freezes). The accusation and
spy-stop pauses are the engine's own: the remaining time is stored exactly and restored when play resumes.

**Time up** (deadline reached with no accusation open) → final vote.

### 3.3 vote — accusation (mid-round) or final vote

The clock is stopped. All phones show a banner:
- accusation: 「🙋 阿明 指控 阿華」 and the rule 「要所有人贊成先成立」 (two spies: 「最多 1 個人反對」)
- final vote: 「⏰ 時間到 · 最後投票 2/5」 and 「阿華 係唔係間諜？」, plus the frozen clock (「鐘停咗 · 剩 3:12」 or 「時間到」)

**Narration (accusation, cue `accuse`):** 「鐘停咗。{accuser}指控{suspect}，大家投票。」
**Narration (time up, cue `timeup`):** 「時間到！進入最後投票，由{dealer}開始。」 Later suspects (cue `final`, 1.5 s): 「下一位：{suspect}。」

#### phone mode
- A voter who has not voted: two big buttons 「👍 贊成」 and 「👎 反對」. After voting: 「你投咗：贊成」 and the list
  of who has voted (names only, never the choice).
- The accuser (accusation only): 「你係指控人，自動贊成」.
- The suspect: 「你被指控，唔使投票」, then waits.
- When the last vote arrives the result is revealed (3.4). Early "no" votes never end a vote early, so the timing
  tells nothing.

#### hands mode
- Everyone sees 「全部人同時舉手，贊成嘅舉手（被指控嘅人唔投）」.
- The **reporter** (the accuser; in the final vote the dealer, or the next seat when the dealer is the suspect)
  sees the result buttons: one spy → 「全部贊成」 / 「有人反對」; two spies → 「全部贊成」 / 「1 人反對」 / 「2 人或以上反對」.
  Everyone else sees 「等 {reporter} 報告結果」.

**Rule:** a suspect is convicted when the number of "no" votes is at most `spies − 1` (everyone else yes; with two
spies one dissenter is allowed). The suspect never votes.

### 3.4 tally — the result lingers 3.5 s

Phone mode lists 「贊成：阿明、阿B」 and 「反對：阿C」; hands mode shows 「反對 1 人」. Headline 「✅ 全票通過」 or
「❌ 唔通過」.

**Narration (cue `tally`):**
- convicted: 「全票通過，{suspect}要亮牌。」
- accusation failed: 「唔通過，鐘繼續行。」
- final vote failed: 「唔通過。」

After 3.5 s (`deadline`): convicted → round end; failed accusation → back to play, with the exact remaining time;
failed final vote → next suspect (seat order starting at the dealer); every seat tried → the spy survives.

### 3.5 guess — a spy stopped the clock

Everyone sees 「🕵️ 阿華 話佢係間諜」 and the clock frozen. The guessing spy sees the list in pick mode:
tap a location (it highlights), then 「就係「銀行」！」 in the bar fixed at the bottom of the screen locks it in
(the list is long, so the button stays reachable while scrolling). The list sits directly under the instructions
and the spy's card is pushed below it. Everyone else sees 「等 阿華 揀地點…」
and the list with picks marked.

**Narration (cue `guess`):** 「{spy}話佢係間諜！鐘停咗，等佢喺地點清單揀一個。」

**Two spies.** The second spy stays hidden until the first has named a place, then is forced out too
(cue `guess2`): 「另一個間諜{name}都要企出嚟，輪到佢揀。」 The first pick is public, its verdict is not — the second
spy hears it and may copy it. Either spy being right means the spies win.

The judgement is immediate after the last pick.

### 3.6 roundEnd — the reveal

Shown to everyone, no secrets left:
- location (emoji, name), headline (see 5.6), 「間諜：🕵️ 阿華」
- the explanation lines (why, point by point)
- a table: every seat, its role (or 🕵️ 間諜), `+points` this round, running total
- button 「下一局」 (last round: 「睇總分」), enabled 2.5 s after the screen appears so a stray tap cannot skip it. Any seat can press it.

**Narration (cue `end`, 4 s):** 「{headline}。地點係{location}，間諜係{names}。」

### 3.7 over

The engine's `result()` becomes non-null; the shell shows the results screen. **Narration (cue `over`):**
「{n}局打完。{winner} 贏咗，共 {points} 分。」 (tie: 「A、B 同分奪冠，各 {points} 分」). `result.lines` lists
every round (location, spies, headline) and the explanation of the last round; the ranking is left to the shell's
own points display (`result.points` = running totals).

## 4. Single-device play

One phone, `voteMode: hands`.
- **reveal:** `focus` lists the seats that are not ready; the shell walks them in seat order behind a PassGate
  (「交俾 阿明 ・ 其他人唔好望」). Each peeks, taps 準備好 and hands it on.
- **play:** the phone lies on the table showing the clock and the who-asks-next card. Any seat may record a pass,
  so the table just taps the next asked name; no seat switching is needed.
- **accusation:** the accuser is the active seat, so the accuser takes the phone (or switches to their own seat), taps
  指控 and picks the suspect. The table raises hands; in `hands` mode the accuser taps the result.
- **spy stop:** the spy takes the phone, taps 「我係間諜」, picks the location. Same flow as a multi-device game.
- **final vote:** the dealer (or the next seat) taps the result for each suspect.
- In `phone` mode on one device the shell would pass the phone to every voter for every vote; use 舉手.

No paper mode.

## 5. Engine

### 5.1 State (PRIVATE marked)

```
cfg            normalised config
players, order seat order
list[]         PUBLIC { name, emoji, cat }
plan[]         PRIVATE { loc, roles[] } one entry per round
roundNo, totals{pid:n}, history[] (finished rounds, public once finished)
round: {
  n, dealer,
  loc            PRIVATE index into list
  spies[]        PRIVATE
  roles{pid}     PRIVATE
  ready{}, accUsed{}, accusations[{by,suspect,result}]       public
  floor {holder, prev}, askHist[]                            public
  warned, frozen (ms left while stopped), finalIdx
  vote {kind, suspect, by, mode, votes{pid:bool}, noCount, reporter}   votes are private until closed
  guess {order[], idx, picks{}}
}
tally          public result of the last vote, while phase = 'tally'
phase, deadline, clockLeft, cue, seq
```

`clockEnd = deadline + clockLeft`. `deadline` is the next wake-up (the 60 s warning, or the end), `clockLeft` is
how long after that wake-up the clock really ends. The session only shifts `deadline` when the host pauses, so
deriving the end from it keeps a host pause correct.

### 5.2 Actions

All from a seat (`pid` must be one of `players`); anything else is ignored and returns the state unchanged.

| action | phase | validation | effect |
|---|---|---|---|
| `{type:'ready'}` | reveal | not already ready | mark; when all ready → play, start clock |
| `{type:'ask', target}` | play | target is a seat, ≠ holder, ≠ prev (sender may be any seat) | push floor; `{holder: target, prev: oldHolder}` |
| `{type:'undo-ask'}` | play | history non-empty | pop floor |
| `{type:'accuse', target}` | play | sender has not accused, target is a seat ≠ sender, clock not at 0:00 | stop clock, open accusation vote (phone: accuser pre-voted yes) |
| `{type:'spy-stop'}` | play | sender is a spy, clock not at 0:00 | stop clock → guess |
| `{type:'vote', yes}` | vote (phone) | boolean, sender is not the suspect, has not voted | record; when all voters have voted → tally |
| `{type:'verdict', no}` | vote (hands) | sender is the reporter, `no` integer in 0..n−1 | tally |
| `{type:'guess', loc}` | guess | sender is the current spy, `loc` integer in 0..list−1 | record; next spy, or judge |
| `{type:'next-round'}` | roundEnd | any seat | next round, or `over` |
| `@cue-done` / `@next` (host) | any | id matches / a cue is pending | marks the cue done; nothing waits on it |

### 5.3 advance / deadline

- `play`, `clockLeft > 0`: 60 s warning cue; `deadline` moves to the end. 
- `play`, `clockLeft = 0`: time up → final vote on the dealer.
- `tally` (3.5 s): see 3.4.
- All other phases have no deadline.

A timer that fires up to 250 ms early is ignored.

### 5.4 focus

- reveal: seats not ready
- vote, phone: seats that have not voted (accuser and suspect excluded); hands: `[reporter]`
- guess: the spy whose turn it is
- otherwise `null`

### 5.5 autoAct (stalled seat)

reveal → `ready`; phone vote → `no`; hands reporter → a verdict one dissenter too many to convict; guess → a random
location; roundEnd → `next-round`; play → `null` (never moves the question). An automatic action never convicts.

### 5.6 Results and explanation

Outcome codes and points (one spy; `×` = each of the two spies when there are two):

| code | headline | points |
|---|---|---|
| `survived` | 間諜贏：冇人被全票通過 | spy +2 |
| `final-innocent` | 間諜贏：最後投票錯怪咗{X} | spy +2 |
| `accused-innocent` | 間諜贏：全場錯怪咗{X} | spy +4 |
| `guess-right` | 間諜贏：估中地點 | spy +4 (2 + 2 for the guess); two spies: each +2, a spy who guessed right +2 more |
| `accused-spy` | 非間諜贏：捉到間諜{X} | each non-spy +1; the first accuser of that spy +1 more; two spies: the uncaught spy +1 |
| `final-spy` | 非間諜贏：最後投票揪出{X} | as above |
| `guess-wrong` | 非間諜贏：間諜估錯地點 | each non-spy +1, no bonus |

First-accuser bonus: the first player whose mid-round accusation named the spy who is eventually convicted,
even if their own vote failed and the spy was convicted later (mid-round or at the final vote). No one gets it
when no accusation ever named that spy, nor after a wrong guess.

The `lines` under the reveal explain each point, for example:
- 「阿明 停鐘指控 阿華，全票通過 — 佢真係間諜！」「每個非間諜 +1。」「阿B 最先指控咗 阿華，額外 +1。」
- 「阿華 停鐘亮身分，估咗「銀行」，真正地點係 🏥 醫院。」「每個非間諜 +1。」
- 「最後投票，阿明 被全票通過，但佢唔係間諜。」「間諜 阿華 贏，+2。」

Game end: highest total wins, ties share (`winners` has all of them). `result.points` = totals.

## 6. Edge cases → tests (`tests/spyfall.test.mjs`)

| case | test |
|---|---|
| every head-count has valid defaults and the timer table | `config defaults are valid…` |
| config fields edit only owned keys; categories options = CATEGORIES | `config.fields only edit keys…` |
| `index.js` is the §15.1 module | `index.js is the §15.1 module…` |
| the shipped bank fits the engine (categories, roles, full games on it) | `the shipped bank … fits what the engine assumes` |
| config validation + warnings | `config.validate rejects nonsense…` |
| spies count, role distinctness, list holds the secret | `setup deals the right number of spies…` |
| list grouped by category, secret not tied to position | `the list is grouped by category…` |
| category filter, top-up, unknown category | `category filter restricts the list…` |
| odd/missing bank entries, empty bank | `odd bank entries are sanitised…` |
| rounds capped by list size | `rounds are capped…` |
| location never repeats within a game | `the secret location never repeats…` |
| dealer rotates clockwise | `dealer is random in round 1…` |
| clock starts only when all are ready | `the clock starts only when every seat is ready` |
| only `ready` works during the look | `nothing but ready works…` |
| question tracker, cannot ask back, undo | `question tracker…`, `with three players…` |
| unanimous accusation of the spy, bonus | `a unanimous accusation of the spy…` |
| accusing a non-spy gives the spy 4 | `unanimously accusing a non-spy…` |
| failed accusation: exact remaining time | `one "no" sinks an accusation…` |
| one accusation each, no self, none during a vote | `everyone gets exactly one accusation…` |
| accuser/suspect cannot vote, no revoting | `the accuser and suspect cannot vote…` |
| votes hidden until closed | `view of a vote in progress…` |
| warning cue, time up opens the final vote | `one-minute warning cue…` |
| host pause shifts the clock | `a host pause shifts the deadline…` |
| nothing allowed at 0:00 | `no accusation or spy stop once the clock reached 0:00` |
| short round skips warning | `a short round…` |
| spy stop: only spies, right guess 4 | `only a spy can stop the clock…` |
| wrong guess: +1 each, no bonus | `a wrong guess gives…` |
| convicted spy cannot guess | `a convicted spy gets no last guess` |
| final vote order, survival, conviction | `final vote goes dealer first…`, `a conviction in the final vote…` |
| spy cannot guess after time up | `the spy cannot guess once time is up` |
| three players need both | `with three players both others must agree` |
| two spies: threshold, guess flow, scoring | `with two spies one dissenter…`, `two-spy guess…`, `two spies both wrong…`, … |
| scoring table | `scoreRound — every outcome…` |
| first-accuser bonus rules | `first-accuser bonus…`, `the bonus also applies…` |
| spy may accuse | `a spy may accuse as a feint…` |
| hands mode | `hands mode — …` (three tests) |
| game end, ties, result | `next-round needs the round to be over…`, `totals are the sum…` |
| cues never leak, unique ids | `cues never speak a secret…` |
| autoAct | `autoAct readies, votes no…` |
| junk input | `act never throws and ignores junk…` |
| legalActions agrees with act | `legalActions and act agree exactly…` |
| views whitelisted, identical per seat, no leaks | `views are whitelisted…`, `a seat that is not in the game…` |
| fuzz, every head-count × 100 seeds | `fuzz — every player count × 100 seeds…` |

## 7. 貼心 touches

- **Same list for the whole game**, grouped by category, with a private strike-through. Used locations grey out
  (they cannot be the answer).
- **Travel-flavoured bank**: 日本 / 香港 / 亞洲旅遊 / 節日活動 categories; the category filter makes a Japan-only
  game one tap.
- **Hands mode** and the PassGate walk make one-phone play practical; the question tracker works from any seat.
- **Undo** for a mistaken question pass; **confirm** for the spy stop and the accusation; the reveal button is
  delayed 2.5 s.
- The clock is **exact across pauses**; the Timer beeps at 60 s, 10 s and zero; the host's pause freezes it.
- **No tells**: same card and button layout for spy and non-spy, the spy button exists on every phone, the vote waits
  for everyone, the narrator never says anything secret.
- **The reveal explains every point**, including the first-accuser bonus, so nobody has to ask the rulebook.
- 1-round **quick game**, 5-round **full game**; ties share the win.
- No vibration (Safari has none); the toast and sounds do the work.

## 8. Framework requests

- `js/games/registry.js` lists spyfall as players [3, 8], minutes [10, 20]. The module says players [3, 12] (two spies
  from 9, as in Spyfall 2) and minutes [10, 45] (3 rounds of 6–10 minutes plus talk). The registry needs the same numbers
  or the picker will grey the game out at 9+ players before the module loads.
- None blocking. `ConfigForm` already round-trips the shapes used here: `categories` = `{ cats: [...] }`, `select`
  options `[{ value, label }]` with the value type kept (`listSize` stays a number).
- For hands mode the shell's focus walk should treat `focus.pids` as "the seat that must act", which it does for the
  PassGate; nothing else is needed.
- `RoleCard` is passed `team: 'card'` so no team colour or label differs between spy and non-spy.
