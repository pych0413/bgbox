# 間諜 (Spyfall) — play-flow spec

> Rules source: `docs/research/spyfall.md` (paraphrased from the official rulebooks; nothing copied). Its
> "## Verification" section (fact-check 2026-10-03 UTC) overrides the draft; this spec follows the verified text.
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
| `minutes` | 每局幾多分鐘 | int 2–20 | by head-count | 3–4 → 6, 5–6 → 7, 7–8 → 8, 9–10 → 9, 11–12 → 10 (Russian S1 v1.1 / S2 / TT table). Help: first-timers may take 12. |
| `spies` | 間諜人數 | select 1 / 2 | 1, or 2 from 9 players | 2 is only offered from 6 players. Option labels carry the reason: 「1 個（官方建議）」, 「2 個（熟手：互相唔知對方）」; the field help is the head-count reason (below). |
| `twoSpyThreshold` | 兩個間諜：幾多人反對都算通過 | select `n-2` / `n-3` | `n-2` | Shown only with 2 spies. `n-2` = one dissenter allowed (verified default reading), `n-3` = two (literal reading, option) |
| `voteMode` | 投票方式 | select | `phone` | `phone` = everyone taps yes/no on their own phone. `hands` = everyone raises hands, one person taps the result (single-device play) |
| `listSize` | 地點清單長度 | select 16/20/24/30 | 24 | |
| `categories` | 地點類別 | categories | all | value = `{ cats: [names] }` (the ConfigForm shape; a bare array is tolerated), empty = all |
| `accuserBonus` | 指控獎勵 +1 畀邊個 | select | `first-midround` | `first-midround` (S2/TT, default), `successful` (Spyfall 1), `first-any` (house reading). See 5.6. |
| `antiStreak` | 唔好連續做間諜 | bool | false | BACKLOG #20. Last round's spies sit out the spy draw when enough others remain. Off by default: not in any rulebook, and everyone then knows last round's spy is safe. |

`config.defaults(n, prev)` keeps `rounds`, `listSize`, `voteMode`, `categories`, `accuserBonus`,
`twoSpyThreshold` and `antiStreak` from the last game but re-derives `minutes` and `spies` from the head-count.
A config saved before the newer keys existed still validates; the engine fills in the defaults.

### Presets with a reason (BACKLOG #8)

`config.presets(n) → [{ id, label, reason, cfg }]`, `cfg` a patch over the current config. The first entry is what
`defaults(n)` gives. Every preset passes `validate` for that n (tested for 3–12).

| id | label | when | patch | reason (example for 6) |
|---|---|---|---|---|
| `standard` | 標準 | always | spies + minutes from the tables | 「6 人：1 個間諜 · 每局 7 分鐘 — 官方建議，6 人最好玩」 (3–4: 「人少易估，當熱身」; 9+: 「官方建議：9 人以上用 2 個間諜」) |
| `beginner` | 新手 | always | same spies, 12 minutes | 「第一次玩：1 個間諜 · 每局 12 分鐘 — 多啲時間諗問題」 |
| `two-spies` | 兩個間諜 | 6–8 players | spies 2, `n-2` | 「6 人熟手：2 個間諜互相唔知，最多 1 人反對都算通過」 |
| `quick` | 快玩 | always | rounds 1 | 「淨係玩一局試吓手」 |

Until the shell renders presets (§8), the standard reason is shown as the help line of 間諜人數.

### Validation

Errors (block start): head-count outside 3–12, rounds outside 1–10, minutes outside 2–20, spies not 1 or 2, two
spies with fewer than 6 players, unknown list size, vote mode, accuser-bonus mode or two-spy threshold, a
non-boolean `antiStreak`.

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
4. Each round: spies are chosen uniformly over all seats (with `antiStreak` on, last round's spies are left out
   of the draw when enough other seats remain), each non-spy gets a role from the secret location's role list, no
   repeats while the list allows (the bank has 7 roles, so tables of 9+ with few spies repeat roles; roles are
   flavour only).
5. Dealer: random over ALL seats in round 1, drawn before and independently of the spies (so the dealer is the
   spy 1 time in N, BACKLOG #20); then one seat clockwise each round (Spyfall 2 rotation, the verified default).
   The dealer asks the first question and is the first suspect of the final vote.

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

**Transition:** when every seat at the table is ready the clock starts (an absent seat, §3.8, is not waited on).
**Narration (cue `start`):** 「大家準備好，計時{m}分鐘，開始！由{dealer}問第一條問題。」

**A re-dealt round** (the last one was voided, §3.8) shows a banner on every phone: 「🗑️ 上一鋪唔計，重新派過牌」 +
「阿明 唔喺度，佢係間諜 · 地點係 🏦 銀行 · 冇人得分」 (host void: 「房主話呢鋪唔計」); the deal cue starts 「上一鋪唔計，重新派過牌。」

**Anti-tell:** the clock never starts early or late depending on role; the ready button and the peek are the
same for all; peeking is local (hold, no sound).

### 3.2 play — the clock is running

Every seat sees the same public screen plus its own card.

1. **Clock.** The Timer component counts to `view.deadline` (the true end of the clock). It beeps at 60 s,
   10 s and zero. 「剩餘時間」. During play it is a compact bar that sticks under the app header while the page
   scrolls (the location list is long), with a 「🙋 指控」 shortcut on every seat's phone (「🙋 用咗」 once used): it
   opens the accusation picker and scrolls it into view. When play starts the page scrolls back to the top.
2. **Who asks next.** A card 「阿明 答完就問下一個」 (the first question: 「阿明 問第一條問題」; your own turn: 「你答完就問下一個」)
   with 「唔可以問返 阿華」 and a grid of seats. The card turns to a person the moment they are asked, while they are
   still answering, hence the wording. The seat holding the floor taps the person they ask; that person becomes the
   holder and the previous holder is blocked. The hint for the holder reads 「你問邊個？㩒佢個名」. 「↩ 撤銷」 takes back
   the last pass (8 deep). A small trail shows the last passes: 「阿明 → 阿華 → 阿B」. A seat that has used its
   accusation carries a small 🙋✓ (public, from `view.accUsed`).
3. **Accuse** 「🙋 指控」: one per player per round (the button shows 「已用咗指控」 afterwards). Opens a picker
   (everyone except you), confirm with 「指控佢」. Spies may use theirs as a feint.
4. **Spy button** 「🕵️ 我係間諜」: exists on every phone and behaves the same on every phone: no sound, no toast,
   the confirmation 「🕵️ 確定要亮身分？㩒落去鐘會即刻停，全場都知你係間諜，然後你要喺清單揀一個地點。…」
   [取消] [我係間諜，停鐘]. Only a spy's 停鐘 sends `spy-stop`; for a non-spy it closes the panel exactly like 取消.
   No screen ever says 「你唔係間諜」, so a phone cannot be held up as proof of innocence (the rules sheet adds
   「唔好俾人睇你部手機證明身分」). A non-spy can still *say* nothing happened; that is the same as in the box game.
5. **Accusation log** under the buttons: 「阿明 → 阿華 ✗ 唔通過」.
6. My card and the location list. The list is open during the look (`reveal`) and folds once when play starts; the
   📍 toggle reopens it. Tap a location to strike it out; the strike is local to your phone.

**Narration:** at one minute left (cue `warn`, only if the round is longer than 75 s): 「仲有一分鐘。」

**Pausing.** Host pause is generic (the session shifts `deadline`; the Timer freezes). The accusation and
spy-stop pauses are the engine's own: the remaining time is stored exactly and restored when play resumes.

**Time up** (deadline reached with no accusation open) → final vote.

### 3.3 vote — accusation (mid-round) or final vote

The clock is stopped. All phones show a banner:
- accusation: 「🙋 阿明 指控 阿華」 and the rule 「要所有人（除咗被指控嗰個）贊成先成立」 (two spies:
  「兩個間諜：最多 1 個人反對都成立」, or 2 with `n-3`), plus 「投票時唔好講理由」 (the rulebook: reasons leak the
  location while a vote is open)
- final vote: 「⏰ 最後投票 2/5」 and 「阿華 係唔係間諜？」, plus the frozen clock (「鐘停咗 · 剩 3:12」 or 「時間到」) and
  the reminder 「間諜已經唔可以估地點。可以傾，但唔好講出地點。」 (Cryptozoic ruling: talk is allowed between the
  final-vote suspects, but nobody may name the location or describe card details, because the spy can no longer guess)

**Narration (accusation, cue `accuse`):** 「鐘停咗。{accuser}指控{suspect}，大家投票。」
**Narration (time up, cue `timeup`):** 「時間到！間諜唔可以再估地點。最後投票由{first suspect: the dealer, or the next present seat}開始，可以傾，但唔好講出地點。」
Later suspects (cue `final`, 1.5 s): 「下一位：{suspect}。」

#### phone mode
- A voter who has not voted: two big buttons 「👍 贊成」 and 「👎 反對」. After voting: 「已投 ✓」 — **never which way**
  (decision D6: a neighbour's glance learns nothing before the tally) — and the list of who has voted (names only,
  never the choice).
- The accuser (accusation only): 「你係指控人，自動贊成」.
- The suspect: 「你被指控，唔使投票」, then waits.
- When the last vote arrives the result is revealed (3.4). Early "no" votes never end a vote early, so the timing
  tells nothing.

#### hands mode
- Everyone sees 「全部人同時舉手，贊成嘅舉手（被指控嘅人唔投）」.
- The **reporter** (the accuser; in the final vote the dealer, or the next seat when the dealer is the suspect)
  sees the result buttons: one per "no" count a conviction survives, then one for too many — one spy →
  「全部贊成」 / 「有人反對」; two spies → 「全部贊成」 / 「1 人反對」 / 「2 人或以上反對」 (with `n-3` one more step).
  Everyone else sees 「等 {reporter} 報告結果」.

**Rule:** a suspect is convicted when the number of "no" votes is at most `maxNo` (`view.vote.maxNo`, also
`view.rules.maxNo`): 0 with one spy (everyone but the suspect votes yes); 1 with two spies (N−2 yes, default);
2 with two spies and `twoSpyThreshold: 'n-3'`. The suspect never votes. The same test applies to mid-round
accusations and to every final-vote suspect.

### 3.4 tally — the result lingers 3.5 s

Phone mode lists 「贊成：阿明、阿B」 and 「反對：阿C」; hands mode shows 「反對 1 人」. Headline 「✅ 全票通過」 or
「❌ 唔通過」.

**Narration (cue `tally`):**
- convicted: 「全票通過，{suspect}要亮牌。」
- accusation failed: 「唔通過，鐘繼續行。」
- final vote failed: 「唔通過。」

After 3.5 s (`deadline`): convicted → round end; failed accusation → back to play, with the exact remaining time
(and the spy may stop the clock again — Russian v1.1); failed final vote → next suspect (seat order starting at
the dealer, each seat once); every seat tried → the spy survives. The first conviction ends the round, also with
two spies.

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
- a table: every seat, its role (or 🕵️ 間諜), `+points` this round, running total; ✓ after the name of each seat that has read it
- **睇完 (decision D3, 2026-10-04; playtest finding #3):** button 「睇完 ✓」 on every seat's phone, enabled 2 s after the
  screen appears so a stray tap cannot skip it (until then a line counts down 「睇清楚先，2 秒後先㩒得」); after the tap it
  reads 「✓ 睇完 · 等緊其他人」. Every phone shows the same line 「睇完 3 / 5 · 等緊：阿明、小美 · 齊人就開下一局」 (last round:
  「…齊人就睇總分」). The next round (or the end) comes when **every present seat** has tapped; the host's ⏭ forces it
  (the first press finishes the narration line). One eager friend no longer cuts everybody's reveal short. A tap the host
  never confirmed comes back as a button after 4 s.
- On a passed-round phone the tap sends `seats: [the other seats on this phone]`, so the reveal is read once for all of them.

**Narration (cue `end`, 4 s):** 「{headline}。地點係{location}，間諜係{names}。」

### 3.7 over

The engine's `result()` becomes non-null; the shell shows the results screen. **Narration (cue `over`):**
「{n}局打完。{winner} 贏咗，共 {points} 分。」 (tie: 「A、B 同分奪冠，各 {points} 分」). `result.lines` (BACKLOG #10):
one line per round with what was hidden during play — 「第 1 局 🏦 銀行（間諜：阿華）— 間諜贏：全場錯怪咗阿B ·
阿華 +4」 (agent wins with many scorers: 「非間諜各 +1，阿明 +2」) — then 「第 N 局點解咁計：」 and the explanation
of the last round (5.6). The ranking is left to the shell's own points display (`result.points` = running totals).
The per-round lines also show the spy history, which matters when `antiStreak` is on.

### 3.8 Absent seats and void rounds (D4, decision 2026-10-04; playtest finding #4)

The host can mark a seat absent (`{ type: '@absent', pid }`, e.g. a phone that went to the bathroom) and back (`@present`). Absent
seats are public — `view.absent`, 💤 next to the name (seat grid, reveal table, 「💤 唔喺度：阿明」 under the ready count) — and are
never waited on for the rest of the game:

- **reveal**: not waited on to ready (marking the last missing seat absent starts the clock).
- **play**: cannot be asked or accused (greyed in the seat grid and left out of the accusation picker); the question card moves
  to the next present seat if it was resting on them (`prev` is cleared). An open accusation **of** a seat that leaves is called
  off: the accuser keeps the one try and the clock resumes (cue 「阿明唔喺度，指控取消，鐘繼續行。」).
- **votes**: unanimity counts the **present** voters only (`votersOf` drops absent seats; with two spies the one/two allowed
  dissenters stay); a vote that was only waiting on the seat closes. Hands mode: the reporter is re-picked (the dealer, else the
  next present seat that is not the suspect), and the result buttons go up to the number of present voters.
- **final vote**: absent seats are passed over as suspects; 「最後投票 2/4」 counts present seats.
- **roundEnd**: their 睇完 is not needed.
- **later rounds**: never dealt the spy, never the dealer (the rotation passes over them).
- **An absent spy voids the round** (any phase before roundEnd): nobody scores, the round goes into the history as `code: 'void'`
  (its location greys out in the list, and its spies and location are public — the round is dead), and **the same round number
  is dealt again** with a spare location from the game's list (`state.spare`, never a planned or used one), the same dealer
  (or the next present seat). With no spare left the round simply does not count and the game moves on.
- **Host 呢鋪唔計 (`@void-round`)** does the same in any live phase; on roundEnd / over it changes nothing and `engine.canVoid`
  says why (「呢局已經計咗分，㩒「睇完」就得」).
- **Refused** (state unchanged → the shell says this game cannot) when fewer than `max(3, spies + 2, maxNo + 2)` present seats
  would be left, for a non-seat, an already-absent seat, or once the game is over.
- Unavoidable and by decision: when the round goes on after a seat is marked absent, the table learns that seat is not the spy.
  Absent marks are public, so a host cannot probe quietly.
- An absent seat's own phone says 「💤 房主當咗你唔喺度。返咗嚟就叫房主加返你。」 instead of its buttons, and the engine ignores
  its actions until `@present`. It still scores with its side for a round it was dealt into.

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
- **roundEnd:** one 「睇完」 counts for every seat the phone holds (`seats`), so the table moves on with one tap.
- In `phone` mode on one device the shell would pass the phone to every voter for every vote; use 舉手.

No paper mode.

## 5. Engine

### 5.1 State (PRIVATE marked)

```
cfg            normalised config
players, order seat order
list[]         PUBLIC { name, emoji, cat }
plan[]         PRIVATE { loc, roles[] } one entry per round (a voided round's slot is refilled from `spare`)
spare[]        PRIVATE { loc, roles[] } the unplanned list entries, for re-dealing a voided round (drawn without rng)
absent{}       PUBLIC  pid → true: marked absent by the host (D4)
roundNo, totals{pid:n}
history[]      finished rounds, public once finished: { n, loc, dealer, spies, code, winTeam, suspect,
               suspectRole (role of a convicted innocent), by, caught, bonusTo, bonusMode,
               accusations[{by,suspect}], picks, rightSpies, deltas } — a voided round: code 'void', why
               ('absent' | 'host'), absent (the spy who left), all deltas 0
round: {
  n, dealer, redo (this deal replaces a voided one), seen{} (who tapped 睇完, public)
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
| `{type:'ready'}` | reveal | not already ready | mark; when all present seats are ready → play, start clock |
| `{type:'ask', target}` | play | target is a present seat, ≠ holder, ≠ prev (sender may be any seat) | push floor; `{holder: target, prev: oldHolder}` |
| `{type:'undo-ask'}` | play | history non-empty | pop floor |
| `{type:'accuse', target}` | play | sender has not accused, target is a present seat ≠ sender, clock not at 0:00 | stop clock, open accusation vote (phone: accuser pre-voted yes) |
| `{type:'spy-stop'}` | play | sender is a spy, clock not at 0:00 | stop clock → guess |
| `{type:'vote', yes}` | vote (phone) | boolean, sender is a present voter (not the suspect), has not voted | record; when all present voters have voted → tally |
| `{type:'verdict', no}` | vote (hands) | sender is the reporter, `no` integer in 0..(present voters) | tally |
| `{type:'guess', loc}` | guess | sender is the current spy, `loc` integer in 0..list−1 | record; next spy, or judge |
| `{type:'next-round', seats?}` | roundEnd | a seat that has not tapped 睇完 | mark it (and `seats`: the other seats of a passed-round phone); every present seat → next round, or `over` |
| `@cue-done` / `@next` (host) | any | id matches / a cue is pending | marks the cue done; on roundEnd with no cue pending `@next` forces the next round (D3) |
| `@void-round` (host) | reveal / play / vote / tally / guess | — | void the round and deal it again (§3.8) |
| `@absent {pid}` / `@present {pid}` (host) | before over | §3.8 | mark absent / back |

An absent seat's own actions are ignored (`legalActions` is empty for it).

### 5.3 advance / deadline

- `play`, `clockLeft > 0`: 60 s warning cue; `deadline` moves to the end. 
- `play`, `clockLeft = 0`: time up → final vote on the dealer.
- `tally` (3.5 s): see 3.4.
- All other phases have no deadline.

A timer that fires up to 250 ms early is ignored.

### 5.4 focus

- reveal: present seats not ready
- vote, phone: present seats that have not voted (accuser and suspect excluded); hands: `[reporter]`
- roundEnd: `null` (no pass gate for reading); stall detection still sees the unread seats through `legalActions`
- guess: the spy whose turn it is
- otherwise `null`

### 5.5 autoAct (stalled seat)

reveal → `ready`; phone vote → `no`; hands reporter → `maxNo + 1` "no" votes (one dissenter too many to convict);
guess → a random location; roundEnd → `next-round` (a seat that has not tapped 睇完); play → `null` (never moves the
question). An automatic action never convicts — so a missing phone is marked **absent** instead (§3.8), which takes it out
of the vote rather than voting 反對 for it. Absent seats get nothing.

### 5.6 Results and explanation

Outcome codes and points (one spy; `×` = each of the two spies when there are two):

| code | headline | points |
|---|---|---|
| `survived` | 間諜贏：冇人被全票通過 | spy +2 |
| `final-innocent` | 間諜贏：最後投票錯怪咗{X} | spy +2 |
| `accused-innocent` | 間諜贏：全場錯怪咗{X} | spy +4 |
| `guess-right` | 間諜贏：估中地點 | spy +4 (2 + 2 for the guess); two spies: each +2, a spy who guessed right +2 more |
| `accused-spy` | 非間諜贏：捉到間諜{X} | each non-spy +1; accuser bonus +1 (below); two spies: the uncaught spy +1 as a non-spy (and may hold the bonus) |
| `final-spy` | 非間諜贏：最後投票揪出{X} | each non-spy +1; two spies: the uncaught spy +1; **no accuser bonus** (default) |
| `guess-wrong` | 非間諜贏：間諜估錯地點 | each non-spy +1, no bonus |

**Accuser bonus (verified, `bonusFor()` in game.js).** Every Hobby World text ties it to a successful vote *before
the end of the round*, so it exists only for `accused-spy`:
- `first-midround` (default, Spyfall 2 / Time Travel): the first player whose mid-round accusation named the caught
  spy, even if that vote failed and another player's mid-round vote caught the spy later.
- `successful` (Spyfall 1): the player whose mid-round accusation succeeded.
- `first-any` (house reading, not in any rulebook): the first mid-round accuser, also paid on `final-spy`.

No one gets it when no accusation named that spy, after a wrong guess, or (default) when the spy is only caught at
the final vote. With two spies the uncaught spy scores "as if a non-spy", so if they were the first mid-round
accuser of their partner they take the bonus too. An innocent convicted at the final vote is `final-innocent`
(+2, no extra) — the verified default reading.

The `lines` under the reveal explain each point, including what was hidden during play, for example:
- 「阿明 停鐘指控 阿華，全票通過 — 佢真係間諜！」「每個非間諜 +1。」「阿B 最先指控 阿華（嗰次唔通過），額外 +1。」
- 「最後投票，阿華 被全票通過 — 佢真係間諜！」「每個非間諜 +1。」「阿B 中途指控過 阿華，不過要中途全票捉到先有額外分。」
- 「阿華 停鐘亮身分，估咗「銀行」，真正地點係 🏥 醫院。」「每個非間諜 +1。」「間諜自己估錯，所以指控過佢嘅人冇額外分。」
- 「阿明 停鐘指控 阿B，全票通過，但 阿B 唔係間諜（佢嘅身分係「護士」）。」「間諜 阿華 贏，+4（贏 +2，中途錯怪好人再 +2）。」
- 「最後投票，阿明 被全票通過，但佢唔係間諜（…）。」「間諜 阿華 贏，+2（最後投票錯怪好人冇額外分）。」

### 5.7 Hints (BACKLOG U1)

`view.hint` — one line 「而家要做咩」 for a first-timer, shown only when the player taps 💡 (the shell; never
auto-shown). Per seat, but built from public facts only (phase, who holds the question, who is accused /
reporting / guessing, whether this seat has readied or voted) — a test swaps the spy and asserts every seat's hint
is unchanged. ≤ 50 characters, never a location or role name.

| phase | this seat | hint |
|---|---|---|
| reveal | not ready / ready / spectator | 「㩒住張卡睇自己身分，睇完㩒「準備好」。」 / 「等其他人睇完，齊人就開始計時。」 / 「大家睇緊身分，齊人準備好就開始。」 |
| play | holds the question / anyone else | 「輪到你：揀一個人問一條關於地點嘅問題，再㩒佢個名。」 / 「聽{holder}問同大家答；覺得邊個係間諜，可以㩒「🙋 指控」。」 |
| vote (accusation, phone) | voter / accuser / voted / suspect | 「{X}係唔係間諜？係就㩒贊成，唔係就反對；唔好講理由。」 / 「你指控咗{X}，自動當贊成，等其他人投。」 / 「投咗喇，等其他人投完。」 / 「你被指控，唔使投票，等大家決定。」 |
| vote (final, phone) | voter / suspect | 「最後投票：覺得{X}係間諜就㩒贊成；可以傾，但唔好講出地點。」 / 「輪到大家投你，你唔使投；可以解釋，但唔好講出地點。」 |
| vote (hands) | reporter / others | 「叫大家一齊舉手（覺得{X}係間諜先舉），數吓幾多人冇舉，㩒結果。」 / 「覺得{X}係間諜就舉手，等{reporter}㩒結果。」 |
| tally | all | 「睇吓投票結果，幾秒後自動繼續。」 |
| guess | guessing spy / others | 「喺地點清單揀你估嘅地點，再㩒「就係…」確定。」 / 「等{spy}喺清單揀地點：估中間諜贏，估錯大家贏。」 |
| roundEnd / over | all | 「睇吓地點、間諜同點計分，睇完㩒「睇完」。」; after the tap 「等其他人睇完，齊人就開下一局。」 (last: 「…睇總分。」) / 「打完喇！睇吓總分同每局發生咩事。」 |
| any (absent seat) | that seat | 「房主當咗你唔喺度；返咗嚟就叫房主加返你。」 |

`view.mine.role` = `'spy' | 'agent'` (a `rules.roles` id) so the 💡 sheet can show 「你嘅角色」. It is as secret as
the card. `rules.quick` is 6 short lines; each role's `text` says what you do and 「點贏」.

Game end: highest total wins, ties share (`winners` has all of them). `result.points` = totals.

## 6. Edge cases → tests (`tests/spyfall.test.mjs`)

| case | test |
|---|---|
| every head-count has valid defaults and the timer table | `config defaults are valid…` |
| config fields edit only owned keys; categories options = CATEGORIES | `config.fields only edit keys…` |
| `index.js` is the §15.1 module | `index.js is the §15.1 module…` |
| the shipped bank fits the engine (categories, roles, full games on it) | `the shipped bank … fits what the engine assumes` |
| config validation + warnings | `config.validate rejects nonsense…` |
| presets with a reason, all valid (#8) | `#8 presets — every head-count…` |
| invalid compositions/options blocked, old configs load (#8) | `#8 validate blocks invalid compositions…` |
| first asker random over all seats, independent of the spy (#20) | `#20 — the first asker…` |
| anti-streak option, off by default (#20) | `#20 option antiStreak…` |
| quick ≤ 6 lines, roles say what + how to win (U1) | `U1 — rules.quick…` |
| hint for every phase/seat, independent of the spy (U1) | `U1 — every phase has a hint…` |
| results explain why, incl. hidden info (#10) | `#10 — result lines…` |
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
| first-accuser bonus: first mid-round accuser, even if that vote failed | `first-accuser bonus goes to…` |
| **verified:** no bonus when the spy is caught at the final vote | `rule — accuser bonus only for a mid-round conviction…` |
| bonus options (`successful`, `first-any`) and the pure table | `option accuserBonus=…` (two tests), `bonusFor — every outcome…` |
| **verified:** uncaught second spy = non-spy, bonus included | `rule — the uncaught second spy…` |
| **verified:** two spies, final-vote catch: other spy +1, no bonus | `rule — two spies, one caught at the final vote…` |
| **verified:** spy may reveal again after a failed vote | `rule — the spy may stop the clock again…` |
| **verified:** final-vote talk reminder, no guess after time-up | `rule — at time-up the spy can no longer guess…` |
| final vote order and first conviction (two spies) | `rule — final vote: suspects in seat order…` |
| two-spy threshold option `n-3` | `option twoSpyThreshold=n-3…` |
| spy may accuse | `a spy may accuse as a feint…` |
| hands mode | `hands mode — …` (three tests) |
| game end, ties, result; 睇完 from every present seat (D3) | `next-round needs the round to be over…`, `totals are the sum…` |
| D3: the host's 下一步 forces the reveal on; `seats` from a shared phone; autoAct reads | `D3: the host’s 下一步 finishes the narration first…` |
| D4: absent — ready, floor, ask / accuse refused, @present; present-only unanimity; accusation of a leaver called off; final vote passes over; hands reporter re-picked; absent spy voids in every live phase and re-deals; host @void-round + canVoid; no spare → not counted; refusals; never spy / dealer later; fuzz with random @absent / @present / @void-round | `D4: …` (9 tests) |
| D6: own vote shows 已投 ✓ only | `D6: your own phone says 已投 ✓…` |
| UI: 睇完 countdown, 睇完 n / m, shared-phone `seats`, retry; 💤, the absent phone, the re-deal banner | `spyfall ui: 睇完 …`, `spyfall ui D4: …` |
| cues never leak, unique ids | `cues never speak a secret…` |
| autoAct | `autoAct readies, votes no…` |
| junk input | `act never throws and ignores junk…` |
| legalActions agrees with act | `legalActions and act agree exactly…` |
| views whitelisted, identical per seat, no leaks | `views are whitelisted…`, `a seat that is not in the game…` |
| fuzz, every head-count × 100 seeds, all options; role-count invariants every deal | `fuzz — every player count × 100 seeds…` |

## 7. 貼心 touches

- **Same list for the whole game**, grouped by category, with a private strike-through. Used locations grey out
  (they cannot be the answer).
- **Travel-flavoured bank**: 日本 / 香港 / 亞洲旅遊 / 節日活動 categories; the category filter makes a Japan-only
  game one tap.
- **Hands mode** and the PassGate walk make one-phone play practical; the question tracker works from any seat.
- **Undo** for a mistaken question pass; **confirm** for the spy stop and the accusation; the 睇完 button is
  delayed 2 s, with the countdown on screen, and the table moves on only when everyone has read the reveal.
- **A phone that walks off is fair to everyone**: mark it 💤 — votes count the people at the table, and if it was the spy
  the round is dealt again instead of handing anybody points.
- **Your own vote is not on your screen** (「已投 ✓」, never 👍 / 👎) until the tally shows everybody's at once.
- **The clock and 🙋 stay in reach**: a compact clock bar sticks under the header while the location list scrolls.
- The clock is **exact across pauses**; the Timer beeps at 60 s, 10 s and zero; the host's pause freezes it.
- **No tells**: same card and button layout for spy and non-spy, the spy button exists on every phone and opens the
  same silent panel on every phone (a non-spy's 停鐘 just closes it), the vote waits for everyone, the narrator never
  says anything secret.
- **The reveal explains every point**, including the first-accuser bonus and why it was NOT paid (caught only at the
  final vote, or the spy guessed wrong), and the hidden role of an innocent who was convicted.
- **Presets with a reason** per head-count; the final vote reminds everyone not to name the location.
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
- **Presets (BACKLOG #8, ConfigForm/lobby owner):** render `config.presets(n)` as one-tap chips above the form
  (label + reason), tap = `setConfig({ ...config, ...preset.cfg })`, highlight the chip whose patch matches the
  current config. Proposed as a §3 addition: `config.presets?(n) → [{ id, label, reason, cfg }]`.
- **💡 sheet (U1, shell owner):** `view.hint` is per seat and exists in every phase. `view.mine.role` is the
  `rules.roles` id for 「你嘅角色」 — it is secret in this game, so the sheet must show it behind hold-to-peek (or
  not at all on a shared phone), never as plain text.
- **Disconnects — done (D4).** The engine takes `{ type: '@absent', pid }` / `@present` as HOST (§3.8) and publishes
  `view.absent: [pid]` (the same in every view, so the shell may show 💤 on its own seat chips). It also supports
  `@void-round` (re-deal) and `engine.canVoid(state)` for the shell's message.
- **Bank (data owner):** the rules doc asks for ≥ 11 roles per location so a 12-seat table never repeats a role;
  `js/data/spyfall-locations.js` has 7 for all 174 locations.
- Not implemented (variants the doc lists as options only): Cryptozoic accuser-rotation and German majority final
  votes, Old pals, previous-spy dealer rotation, the strict "+1 only" uncaught-spy reading, Time Travel 2/3-player
  and team variants.
