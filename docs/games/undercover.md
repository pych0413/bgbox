# 誰是臥底 (undercover) — play-flow spec

> Follows DESIGN.md §15.9. Rules source: `docs/research/undercover.md` (corrected 2026-10-03 UTC).
> Code: `js/games/undercover/{game,ui,index}.js` + `style.css`. Tests: `tests/undercover.test.mjs`.
> Every line in 「」 or quotes below is the exact user-facing Cantonese.

## 1. At a glance

| | |
|---|---|
| Players | 4–12 (best 6–10) |
| Time | 15–30 min |
| Narration | `optional` — the game never waits for the narrator. Cues are atmosphere and a prompt for the table |
| Single device | `full` (see §4) |
| Paper mode | none |
| Bank | `undercover` (`{a, b, cat, level}`), key `a|b` sorted |

Everyone gets one word. Most players hold the same word (平民); a few hold a similar-but-different word (臥底);
optionally a 白板 holds nothing. **Nobody is told their role** — you only see your word (the white card sees
「白板」, because it must know). Players describe their word in one sentence, one by one, then everyone votes
somebody out. The app replaces: the referee who writes word slips, the speaking-order bookkeeping, the vote
count, the tie procedure, the win check and the score sheet.

What the phones do: deal the words privately, show whose turn it is (and the order), collect secret ballots,
reveal tallies, run PK, take the white card's typed guess, decide the winner, explain the words.
What happens at the table: the clues are **spoken aloud**, the discussion is spoken, the arguments are human.
The app cannot judge a clue (own word, translation, repeated clue) — that is the table's job.

## 2. Setup

### 2.1 Config

| key | type | default | meaning |
|---|---|---|---|
| `undercovers` | int | by head-count, below | undercover count (0 only if a white card exists) |
| `blanks` | int | 0 | white cards; 0–1 below 10 players, 0–2 from 10 |
| `blankGuess` | bool | true | an eliminated white card may type one guess at the civilian word |
| `win` | `parity` \| `last3` | `parity` | infiltrators win when `I >= C` (parity), or — classic — when at most 3 players are left |
| `tie` | `pk` \| `pk-random` \| `skip` | `pk` | tie handling, §3.7 |
| `revealRole` | bool | true | announce the eliminated player's role |
| `abstain` | bool | false | allow 棄權 (a missing ballot after a timeout is an abstention either way) |
| `blankNeverFirst` | bool | true | the first speaker of round 1 is never the white card (it would have nothing to copy) |
| `speakSec` | seconds 0–120 | 0 | per-speaker limit; time out = turn skipped |
| `discussSec` | seconds 0–300 | 0 | discussion limit; time out = vote opens |
| `voteSec` | seconds 0–120 | 0 | vote limit; missing ballots = abstain |
| `words` | `{cats: [], levels: []}` | all | bank filter; empty list = all |
| `_n` | int | head-count | internal: the head-count the role counts were last recommended for |

Recommended undercovers by head-count (research table, no white card): 4–6 → 1, 7–9 → 2, 10–12 → 3.
`defaults(n, prev)` keeps `prev`'s hand-edited role counts while they still fit `n`; counts that were just the
old recommendation follow the new head-count (`_n` records which). All other fields carry over from `prev`.

### 2.2 Validation

Errors (`ok: false`): n outside 4–12; negative counts; `U + B < 1`; `B` above 1 (below 10 players) / 2;
`U + B > floor((n-1)/2)` (civilians must be a strict majority, so the deal is never already decided).
Ints may arrive as strings (the form). Warnings (still `ok`):

- 「平民投錯 1 個平民，臥底方就贏 — 好難平民。」 when one wrong vote loses (`lossAfter == 1`)
- 「平民要投錯 N 個平民先會輸 — 臥底方好難贏，可以加多個臥底。」 when N ≥ 8
- 「人少加白板會好難玩，建議 6 人以上先加。」 (n ≤ 5 with a white card)
- 「冇臥底，淨係得白板：…」 (only a white card)
- 「白板出局唔可以猜詞，白板會弱啲。」

The `undercovers` field help shows the civilians' margin: 「平民 6 人，平民投錯 4 個平民就輸。」
`lossAfter(C, I, win)` = civilians that must be wrongly voted out for the infiltrators to win.

### 2.3 Fields / summary

`fields()` → int `undercovers`, int `blanks`, bool `blankGuess`, select `win`, select `tie`, bool `revealRole`,
bool `abstain`, bool `blankNeverFirst`, seconds ×3, and `categories` `words`. Select options are `{value, label}`.
The `categories` field also carries `bank: 'undercover'`, `levels`, `matches(value, entry)`, and — when the
caller passes `{ bag }` as a third argument to `fields` — `stats: { used, total }` for 已用 / 總數.
The category list is read from the bank file itself (`js/data/undercover-words.js`, currently 29 categories), never hard-coded, so the curator can add some.
`summary()` lines, e.g. 「平民 5 · 臥底 2」「勝負：臥底方人數追上平民就贏」「平票：PK 再投，再平票冇人出局」
「詞庫：食物、飲品（簡單、中等）」, plus 白板 / 公開身份 / 棄票 / 限時 lines only when they differ from the default.

## 3. Flow

Phases: `deal → speak → discuss → vote → elim → (speak | over)`. PK reuses `speak` and `vote` with `kind: 'pk'`.
Every step has a narration cue; none is blocking. The host phone has no special screen: it is a player's
phone, plus the shell's generic menu (暫停 / 下一步 / 旁白 / 代佢做).

### 3.1 Setup of the hand (engine `setup`)

1. Draw a pair from the bag with the config filter. If the filter matches nothing it is ignored for this game
   (`view.relaxed` → toast 「所揀類別嘅詞已經冇晒，今局用咗其他類別」); an empty bank uses one built-in pair.
2. A coin decides which side the civilians get (`a` or `b`). Undercovers get the other.
3. Roles are a shuffle of the seats: undercovers, then white cards, the rest civilians.
4. The first speaker of round 1 is random (never a white card when `blankNeverFirst`).

### 3.2 deal

| Screen | Shows |
|---|---|
| Every player phone | 「你嘅詞語」 + the hold-to-peek word card (RoleCard, 🃏 + the word in the same place and size for everybody; the white card's card says 「白板」) + button 「記住喇 ✓」. Under it 「已有 3 / 6 人記住咗 · 等緊：阿明、阿強」 |
| After 記住喇 | the card **locks itself** (sound `lock`, same for every role); text 「✓ 你已經記住咗」; 「想再睇一次？㩒 🔓 解鎖，睇完記得再鎖返。」 |
| Table / spectator | 「大家逐個睇緊自己嘅詞語，你係旁觀者。」 + the same progress line |
| Header (all) | 「今局：平民 5 · 臥底 1 · 白板 1」 (counts are announced) and the seat strip |

Narration (cue `deal`): 「準備開始。今局有 5 個平民、1 個臥底。大家用自己部手機睇詞語，睇完記住就㩒「記住喇」。」

Transition: when the last seat taps 記住喇 → round 1. No timer. A seat that never confirms blocks the game:
the shell's stall prompt (`focus` lists the unconfirmed seats) offers 「代佢做」 → `autoAct` = ready. Host
`@next` (twice: first press completes the cue) force-starts; a skipped player can still open 「睇返我個詞」.

Anti-tell: hold-to-peek, lock after use; the white card's card has the **same size and place**, only the text
differs; no vibration; the same sounds for every role; the tap timing of 記住喇 tells nothing.

### 3.3 speak

| Screen | Shows |
|---|---|
| All phones | the speaker, big: 「阿強 講緊…」 (own phone, own turn: 「輪到你講！」 with a pulse); 「第 1 輪 · 第 1 / 6 個」; the order list with ✓ for those who have spoken; a Timer if `speakSec`; the reminder 「一人一句嘢形容自己個詞。唔可以直接講出個詞（包括其中一個字）、唔可以翻譯、唔可以講字數。」 |
| Speaker's phone | button 「講完喇 ▸」 |
| Others | no button. Eliminated: 「你已經出局，聽住大家講。」 |
| Header (all) | seat strip: current speaker highlighted, spoken dimmed, eliminated struck through with their role emoji (if revealed) |

Order: round 1 starts at the starter and follows seat order, wrapping; **only alive seats**. Round r > 1 starts at
the next alive seat after the previous round's FIRST speaker (the rotation continues, dead seats skipped).
Narration: first turn 「第 1 輪。由 阿強 開始，跟座位次序，每人用一句嘢形容自己嘅詞語。」, then 「輪到 阿華。」 — role-neutral.
Own-turn sound `join` plays on the speaker's own phone only.

Transitions: 講完喇 (any seat may send it — see §5.2 — but the step id `at` must match) → next speaker; after the
last → `discuss`. Timer: each turn gets a fresh `speakSec`; time out skips the turn.
`@next` after the cue is done skips the speaker.

### 3.4 discuss

All phones: 「自由討論」「大家都講完喇。邊個最似臥底？傾夠就開始投票。」 + Timer if `discussSec` + button
「開始投票 🗳️」 (any seat). Narration: 「大家都講完喇。自由討論一下，邊個最似臥底？限時 90 秒。」
Opening the vote early is harmless: ballots are secret and nothing resolves until everyone has voted.

### 3.5 vote

| Screen | Shows |
|---|---|
| Voter | 「投票」 / PK: 「PK 投票」; the VotePanel (pick, then 確定 — two taps); myVote can be changed (改票) until the last ballot lands; 「已投 3 / 6 · 仲未投：…」; Timer if `voteSec` |
| Eliminated | 「你已經出局，唔使投票，睇住大家投。」 |
| Table | 「大家投緊票。」 + progress |

Rules: one ballot per alive seat; no self-vote; no dead target; abstain only if `abstain`. **Ballots stay private**
(views carry only `done` seats). The vote resolves the moment the last voter has voted, or on the timer.
Narration: 「投票時間。揀一個你覺得係臥底嘅人，全部人投晒就會公佈。」

### 3.6 elim (the result of a vote)

Everyone sees: the tally bars with **who voted for whom** (VotePanel reveal), then one of

- 「阿明 出局」 + role chip (🧑 平民 / 🕵️ 臥底 / ⬜ 白板) or 「身份唔公開」
- 「平票！阿華、阿明 同票」 + 「佢哋要再講多一句，然後全部人只喺佢哋之間再投一次。」
- 「冇人投票，今輪冇人出局」 / 「平票，今輪冇人出局」 / 「再次平票，今輪冇人出局」 + 「剩低嘅人繼續下一輪。」

Sound `reveal` (the same whoever is out). Button 「繼續 ▸」 for every seat (disabled 1.5 s after the result
appears so a stray tap cannot skip it); the result also moves on by itself after 20 s. Eliminated player's own
phone adds 「你出局喇。可以繼續睇住，但唔使再講嘢或者投票。」

Narration: 「投票結果：阿明 出局。佢係平民。」 (without 「佢係…」 when roles are hidden); 
「平票！阿華、阿明 同票。佢哋要再講多一句，然後大家再投一次，只可以投佢哋其中一個。」

**White card guess.** If the player voted out is a white card and `blankGuess` is on:

- the white card's phone shows 「你係白板！你有一次機會猜平民個詞，猜中臥底方即刻贏。」 + a text box + 「提交答案」
  + 「要同個詞一模一樣（例如「士多啤梨」）。想放棄就留空再㩒。」; `focus` names that seat (a shared phone
  is handed over). The Timer 「猜詞」 counts 90 s; nobody can continue meanwhile.
- others see 「白板 阿強 諗緊平民個詞…」 and the same timer.
- after the answer everybody sees 「白板 阿強 猜「芥辣」」 + 「猜中喇！🎯」 / 「唔啱 ✗」 (or
  「白板 阿強 冇作答，當作猜錯。」 on timeout / empty).
- the civilian word stays secret while the guess is open and after a wrong guess (the game goes on).
- the guess is judged by the engine: same word after NFKC, case, whitespace and punctuation are ignored; the
  undercover word is wrong; an optional bank field `alias: { a: [...], b: [...] }` adds accepted spellings.
- the white card is announced as 白板 **even when `revealRole` is off** (the guess screen gives it away).
- Narration: 「投票結果：阿強 出局。白板 阿強，你有一次機會，用手機打出你覺得嘅平民詞語。」 then
  「白板 阿強 猜「芥辣」，唔啱。」 / 「…，猜中喇！」

After 繼續: win check already decided (`elim.next`): `over`, or PK, or the next round.

### 3.7 Ties (research default PK, `pkVoters = ALL_ALIVE`)

```
vote result
  nobody voted ............................. no elimination
  unique top ............................... out
  tie, tie != skip, top < alive ............ PK
  tie otherwise (skip, or everybody tied) .. no elimination
PK: the tied speak again (same relative order), then ALL alive seats vote, only for the tied
    (a tied player can only vote for another tied player)
  unique top ............................... out
  tie again: pk-random → random among the tied;  pk / skip → no elimination
no elimination twice in a row → the third time somebody MUST go (random among the top, or among all if nobody voted)
```
`noElimStreak` counts rounds that ended without an elimination (a PK that ends level counts once).

### 3.8 over

`result()` is non-null only here. The shell's results screen shows winners, `summary`, `lines` and `points`;
the game's own `over` screen (also shown by `view.over`) reveals everything: banner 「🧑 平民贏！」 / 「🕵️ 臥底方贏！」,
the reason, both words, and every seat with role, word and 「第 2 輪出局」/「一直生還」, plus
「臥底同平民都唔知自己個詞係咪同大家唔同 — 呢個就係好玩嘅地方。」
Narration: 「遊戲完結，平民贏。所有臥底都被投出局，平民贏。」

### 3.9 Win check (after every elimination and every guess)

1. correct guess → infiltrators win (even with the civilians in the majority)
2. `I == 0` → civilians win
3. infiltrators win if `C == 0`, or: `parity`: `I >= C`; `last3`: `C + I <= 3` (pure — parity alone is not enough)
4. otherwise the next round

If the last undercover goes but a white card remains, the game continues (the white card counts as infiltrator).

## 4. Single-device play (`singleDevice: 'full'`)

One phone passed around (or the table's phone with several seats). Everything runs through the shell's pass gate:

- **deal**: `focus` = the unconfirmed seats → 「交俾 阿明 / 其他人唔好望」 → peek → 記住喇 (locks) → the gate moves to the next seat.
- **speak / discuss**: public. The phone sits in the middle; the screen says whose turn it is and the button reads
  「阿強 講完喇 ▸」 — anybody presses it. "Your turn" highlights are not shown (the seat on screen is just whoever
  held the phone last).
- **vote**: `focus` = seats yet to vote → sequential private ballots, each behind a gate. After the last ballot the
  result is public on the same screen.
- **white card guess**: `focus` = that seat → hand the phone to the white card to type.
- **look at my word again**: top-bar seat button → pick your own seat → hand-over card → 「睇返我個詞（淨係 阿詩 本人好㩒）」.
  On a shared phone the card is locked by default and **re-locks after every peek**.

## 5. Engine

### 5.1 State (`js/games/undercover/game.js`, plain JSON)

| field | note |
|---|---|
| `phase` | `deal` `speak` `discuss` `vote` `elim` `over` |
| `cfg` | fitted config (role counts clamped) |
| `seats`, `names`, `alive`, `counts0` | public |
| `roles` | **PRIVATE** seat → civilian / undercover / blank |
| `words` | **PRIVATE** seat → word, `null` for the white card |
| `pair` | **PRIVATE until `over`**: `{civ, und, accept[], cat, level}` |
| `ready`, `round`, `starter`, `firstSeat`, `roundOrder`, `order`, `turn`, `speakKind` | speaking |
| `ballots`, `candidates`, `voters`, `voteKind` | **PRIVATE while the vote is open** (only `done` seats are exposed) |
| `pkCands`, `elim`, `outs`, `history`, `noElimStreak` | results; `outs[].role` is disclosed per `revealRole` |
| `win`, `cueDone`, `deadline`, `timerLabel`, `relaxed` | |

### 5.2 Actions

| action | by | valid when | effect |
|---|---|---|---|
| `{type:'ready'}` | any seat | `deal`, not yet ready | mark ready; all ready → round 1 |
| `{type:'done', at?}` | any seat | `speak`; `at` (the view's `speak.id`) equals the current step when given | next speaker / `discuss` / PK vote |
| `{type:'start-vote'}` | any seat | `discuss` | open the vote |
| `{type:'vote', target}` | an alive voter | `vote`; target ∈ candidates, ≠ self; `null` only with `abstain` | set (overwrite) the ballot; last ballot resolves |
| `{type:'guess', word}` | the eliminated white card | `elim` with a pending guess; `word` is a string | judge; settle |
| `{type:'continue'}` | any seat | `elim`, no pending guess | next step |
| host `@cue-done {id}` | host | id = the current cue | remember the cue as done |
| host `@next` | host | always | first press completes the current cue; a second press skips the step (speaker / discussion / vote / guess / result / deal) |
| host `@auto {pid}` | host | | `autoAct` for that seat |

Anything else (wrong phase, unknown seat, malformed payload, `__proto__` types…) returns the state unchanged;
nothing throws. "Any seat" for the public controls is deliberate: a shared phone acts as whichever seat is on
screen. The UI decides who is shown the button; `done` carries `at` against double taps.

### 5.3 advance / deadlines

`state.deadline` is set by: each speaker turn (`speakSec`), discussion (`discussSec`), vote (`voteSec`), a pending
guess (90 s), the result screen (20 s). `advance` = the same as the host skipping that step. Views carry
`deadline` + `timerLabel` (『發言』『討論』『投票』『猜詞』); the 20 s result timer has no label, so no clock is shown.

### 5.4 focus / autoAct / legalActions / cue

- `focus`: `deal` → unconfirmed seats; `vote` → seats yet to vote; `elim` with a pending guess → the white card;
  otherwise `null` (speaking and discussion are public — gating a shared phone for them would be silly). No `anonymous`.
- `autoAct`: ready / done / start-vote / vote (abstain if allowed, else a random legal target) / empty guess /
  continue. `null` when the seat has nothing to do.
- `legalActions`: exactly the actions that change the state. The guess lists a wrong example and the right word
  (fuzzer only; never sent to a phone).
- `cue` ids are unique per step: `deal`, `speak:{round}:{round|pk}:{turn}`, `discuss:{round}`,
  `vote:{round}:{main|pk}:{n}`, `elim:{n}:{result|guess|verdict}`, `over`. Cue text never contains a word or a role of
  a player still in the game (checked by a test).

### 5.5 View (whitelist)

Public part, identical for every seat (**tested: `view(A)` minus `me` deep-equals the table view**): `phase`, `title`,
`subtitle`, `round`, `counts`, `flags`, `seats`, `outs`, `history` (with ballots), `deadline`/`timerLabel`, and
`deal` / `speak` / `vote` / `elim` / `over` for the phase. `me` (own seat only): `id`, `alive`, `word` (`null` for
the white card), `ready`, and — only for the white card — `blank: true`; in a vote `canVote`, `targets`, `myVote`;
`mustGuess` for the white card with a pending guess. Views never alias engine state.

### 5.6 Result and explanation

`winners`: every player on the winning side (eliminated ones too). `summary`: 「平民贏！平民詞「泳池」，臥底詞「沙灘」」.
`lines`: the reason, 「詞語：平民詞語「泳池」，臥底詞語「沙灘」（地方）」, 「平民：…」, 「臥底：…（臥底自己一開始都唔知，以為個詞同大家一樣）」,
「白板：…」, then one line per vote: 「第 1 輪：阿龍 出局（臥底）」, 「第 2 輪：平票（阿華、阿明），再 PK 一次」,
「第 3 輪 PK：阿明 出局（平民）」, 「第 3 輪：冇人出局」, 「…；白板猜「x」，猜中」.
Reasons: 「所有臥底都被投出局，平民贏。」 / 「所有臥底同白板都被投出局，平民贏。」 / 「場上剩低 1 個平民、1 個臥底方，臥底方人數追上平民，臥底方贏。」
/ 「場上淨係剩 3 個人，臥底方仲未出局，臥底方贏。」 / 「白板被投出局之後，猜中平民嘅詞語「泳池」，臥底方即刻贏。」

`points` (equalised preset, winners only): civilians +2 each; each winning undercover `round(2·C0/U0)`; each winning white
card 3 (a lone white card with no undercover is paid like an undercover).

## 6. Edge cases → tests (`tests/undercover.test.mjs`)

| edge case | test |
|---|---|
| every role split 4–12 legal/illegal; deal never already decided | validate accepts exactly the legal role splits |
| string ints, n out of range | validate rejects … coerces |
| lopsided tables warn | validate warns |
| parity / last3 truth table, `C == 0` safety net | infiltrators-win truth table |
| defaults per n; `prev` handling | defaults … |
| filter by category/level; filter matches nothing; empty bank | category and level filters; a filter that matches nothing |
| orientation random, roles shuffled; blank never first | which word …; the first speaker is never … |
| garbage config clamped | setup survives nonsense config |
| deal gate, idempotent ready | nobody speaks until every seat has confirmed |
| garbage actions, foreign seats | foreign seats, garbage … ; garbage thrown at every phase |
| speaking order, wrap, dead skipped, rotation from first speaker | speaking starts …; later rounds start … |
| double tap on 講完喇 | a stale or double tap … |
| speak/discuss/vote timers, no-timer default | speaking timer …; discussion ends …; a vote timer … |
| ballot validation, dead seats, abstain, overwrite, auto-resolve | ballots are validated …; a dead seat …; abstaining …; the vote resolves … |
| nobody votes | nobody voting means nobody leaves |
| PK flow, second tie (pk / pk-random), skip, cycle | a tie goes to PK; a second tie …; tie = skip; a vote where everybody ties |
| no-elimination streak guard | after two rounds without an elimination … |
| reveal on/off, white card always announced when it guesses | the eliminated role is announced …; with reveal off … |
| guess: correct wins at once, wrong continues / civilians win, normalisation, alias, timeout, one try, off | the white card tests (7) |
| civilians must remove undercover AND white card; parity; last3; white-card-only game | winning tests |
| result lines, both words, points | the result explains …; points …; result is null until … |
| cue ids unique, never leak a word/role | every phase has a cue …; cues never say … |
| `@next` semantics, `@cue-done`, host-only types | @next first finishes …; the host can push every step … |
| focus, autoAct | focus names exactly …; autoAct gives a stalled seat … |
| views: no seat sees more than its own secret, at every step, public part identical | no view carries anything but … ; your own word shows up only … |
| fuzz: 9 head-counts × 120 seeds × 9 config variants, invariants, rare branches reached | random legal play ends … |
| every listed legal action changes the state | every action the engine lists is accepted … |
| determinism, JSON state, `act` returns its input | the same seed …; engine state is plain JSON …; act returns … |

## 7. 貼心 touches

- **Nobody has to referee.** The phones know both words, the order, the count and the rules.
- **The card locks itself** after 記住喇, and on a shared phone after every peek.
- **「睇返我個詞」** is always one tap away (the most common complaint in this game).
- **The white card's screen is the same size and place** as everyone else's; no role-dependent sound or animation.
- **Never starts on the white card** (default): the first speaker would have nothing to copy.
- **Counts are announced** (「平民 5 · 臥底 1 · 白板 1」) at the top of every screen, like at a real table.
- **The order is visible**, with ticks, so nobody is skipped or speaks twice; names keep their seat colour.
- **Open ballots after the vote** (who voted for whom) — it ends the 「我冇投你」 arguments.
- **PK is explained in words** on the result screen, so nobody asks 「點解要再投？」
- **Forced elimination after two level rounds** so a stubborn table cannot loop forever; the screen says why.
- **Dead players stay in**: they keep their word card, see everything, and can press 繼續.
- **A dead phone does not stop the game**: stall prompt → 「代佢做」; host `@next` skips a step; timers are optional.
- **Words the group has seen are not repeated** across evenings (bag), and the 日本旅行 / 港式地道 categories fit the trip.
- **The results screen teaches**: both words, who held what, every vote, and 「臥底自己一開始都唔知」.
- **No vibration, no sound that differs by role**; the elimination reveal uses one sound.

## 8. Framework requests / notes for other tasks

1. **Lobby: show 已用 / 總數.** `config.fields(cfg, n, { bag })` fills `field.stats` for the `categories` field; the
   lobby should pass its bag (`bag.stats` throws if the bank is not loaded, which `fields` swallows). Alternatively the
   lobby can call `bag.stats(field.bank, e => field.matches(value, e))`. At the moment nobody does either, so the line is hidden.
2. **RoleCard lock label** 「🔒 已鎖 — 㩒一下解鎖」 / 「🔓 鎖定角色牌」 say "角色牌" (role card); a word card would like
   `lockLabels` or neutral wording (「鎖定張卡」). Cosmetic.
3. **Bank aliases.** `undercover-words.js` entries could carry `alias: { a: [...], b: [...] }` (other spellings / Mandarin
   forms) which the engine accepts as a correct white-card guess. There is no 簡 ↔ 繁 folding.
4. **`api.players[].deviceId`** is used to detect a shared phone; the UI treats a missing id as "own phone".
5. The game assumes the shell keeps mounting one game UI per seat (as `screens/play.js` does) and re-mounts it when the seat changes.
6. Host `@next` is documented as "complete the cue first": the shell's 「下一步」 therefore needs two presses while the current cue
   is still being narrated. If the shell wants a single press it should call `cueDone(id)` itself before `next()`.

## 9. Open issues

- No foul button / clue log: clue legality is social (research: out of scope for v1).
- Guess matching is exact after normalisation; a Mandarin/Simplified spelling of the right word is wrong unless aliased.
- `majorityRequired`, other infiltrator thresholds (`civ_le_2`, `one_civ`, `size_based`) and the separate-winner white card
  from the research doc are not offered.
- No multi-round session scoring beyond what the room already does with `points` (one game = one round).
