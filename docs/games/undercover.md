# 誰是臥底 (undercover) — play-flow spec

> Follows DESIGN.md §15.9. Rules source: `docs/research/undercover.md` — its **Verification** section (2026-10-03 UTC)
> overrides the draft text. QA pass 2026-10-03 UTC re-checked every rule against it (see §10).
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
The app cannot judge a clue — that is the table's job.

## 2. Setup

### 2.1 Config

| key | type | default | meaning |
|---|---|---|---|
| `preset` | `std` \| `blank` \| `custom` | `std` | role composition, §2.2. A named preset fixes the counts for the current head-count |
| `undercovers` | int | from the preset | undercover count; edited only under `custom` (0 only if a white card exists) |
| `blanks` | int | from the preset | white cards; 0–1 below 10 players, 0–2 from 10; edited only under `custom` |
| `win` | `parity` \| `last3` \| `last3OrParity` \| `civ_le_2` \| `one_civ` \| `size_based` | `parity` | infiltrator threshold, §3.9 |
| `blankGuess` | bool | true | an eliminated white card may type one guess at the civilian word |
| `guessWinner` | `team` \| `blank` | `team` | correct guess: all undercovers + white cards win, or that white card alone (Yanstar) |
| `tie` | `pk` \| `pk-random` \| `skip` | `pk` | tie handling, §3.7 |
| `pkVoters` | `all` \| `others` | `all` | who votes in a PK: every alive seat (research ALL_ALIVE, the CN classic 「大家」) or only the non-tied (NON_TIED, 3DM 565026) |
| `majority` | bool | false | a player needs MORE than half the cast ballots to go out (ss911 / Sina); otherwise nobody is out |
| `revealRole` | bool | true | announce the eliminated player's role |
| `abstain` | bool | false | allow 棄權 (a missing ballot after a timeout is an abstention either way) |
| `blankNeverFirst` | bool | **false** | house rule: the first speaker of round 1 is never the white card. Announced in the summary when on |
| `antiStreak` | bool | false | last game's undercovers / white cards become civilians when enough other seats exist (needs `carry`, §5.7) |
| `speakSec` | seconds 0–120 | 0 | per-speaker limit; time out = turn skipped |
| `discussSec` | seconds 0–300 | 0 | discussion limit; time out = vote opens |
| `voteSec` | seconds 0–120 | 0 | vote limit; missing ballots = abstain |
| `words` | `{cats: [], levels: []}` | all | bank filter; empty list = all |

`blankNeverFirst` was the draft's default; the verifier found no source for it (mrwhiteonline explicitly lets anyone
start) and BACKLOG #20 / ux-survey §5 want the first speaker random over all seats: when the white card can never
start, everybody knows the first speaker is not the white card. So it is now an announced, opt-in house rule.

`antiStreak` stays off: it is a deliberate bias, and with it on, last game's undercover knows they are a civilian
this time. The help text says so.

### 2.2 Presets (BACKLOG #8)

From the research setup table ("Project default" and "Blank-on option" columns), C/U/B:

| n | `std` | `blank` |
|---|---|---|
| 4 | 3/1/0 | — (2 v 2 would already be parity) |
| 5 | 4/1/0 | 3/1/1 |
| 6 | 5/1/0 | 4/1/1 |
| 7 | 5/2/0 | 5/1/1 |
| 8 | 6/2/0 | 6/1/1 |
| 9 | 7/2/0 | 6/2/1 |
| 10 | 7/3/0 | 7/2/1 |
| 11 | 8/3/0 | 8/2/1 |
| 12 | 9/3/0 | 8/3/1 |

Option labels: 「6 人：1 臥底 — 新手友善」, 「6 人：1 臥底 + 1 白板 — 多啲變化」 (「好刺激」 when one wrong vote loses,
i.e. 5 players), 「自訂人數」. The field help is the reason, computed from the threshold in force:
「冇白板，最易上手；平民投錯 4 次先輸。」 / 「加個白板，多啲變化；平民投錯 2 次先輸。」 / 「加白板好刺激：平民投錯一次就輸。」 /
「自己揀臥底同白板人數。」

A named preset ignores whatever `undercovers` / `blanks` the stored config carries (they may be stale after a preset
switch) and follows the head-count by itself, even when the host has edited other settings. The count steppers appear
only under 自訂. A config with counts but no `preset` (old saved configs, API callers) is read as `custom`.

`defaults(n, prev)` keeps `prev`'s preset (falls back to `std` when `blank` does not exist at n, or a `custom` table no
longer fits) and every other field.

### 2.3 Validation

Errors (`ok: false`): n outside 4–12; a preset this head-count lacks (「4 人唔可以加白板，揀過第二個組合。」); negative
counts; `U + B < 1`; `B` above 1 (below 10 players) / 2; `U + B > floor((n-1)/2)` (civilians must be a strict majority);
a table the threshold already decides at the deal (unreachable with the cap, checked anyway). Ints may arrive as
strings. Warnings (still `ok`):

- 「平民投錯 1 個平民，臥底方就贏 — 好難平民。」 when one wrong vote loses (`lossAfter == 1`)
- 「平民要投錯 N 個平民先會輸 — 臥底方好難贏，可以加多個臥底。」 when N ≥ 8
- 「臥底方 3 個或以上，「剩 3 個人」會好難贏（人數追上都未算）。多臥底建議揀「剩 3 人或者人數追上」。」 (`last3`, I ≥ 3)
- 「人少加白板會好難玩，建議 6 人以上先加。」 (n ≤ 5 with a white card)
- 「冇臥底，淨係得白板：…」 (only a white card)
- 「白板出局唔可以估詞，白板會弱啲。」

`lossAfter(C, I, win, n0)` = civilians that must be wrongly voted out for the infiltrators to win (research "mis-votes").

### 2.4 Fields / summary

`fields()` → select `preset`; int `undercovers` + `blanks` (only `custom`); select `win`; bool `blankGuess` and select
`guessWinner` (only with a white card; `guessWinner` only when guessing is on); select `tie`; select `pkVoters`; bool
`majority`; bool `revealRole`; bool `abstain`; bool `blankNeverFirst` (only with a white card); bool `antiStreak`;
seconds ×3; `categories` `words`. Select options are `{value, label}`. The `categories` field also carries
`bank: 'undercover'`, `levels`, `matches(value, entry)`, and — when the caller passes `{ bag }` as a third argument —
`stats: { used, total }`. The category list is read from the bank file itself, never hard-coded.

`summary()` lines, e.g. 「平民 5 · 臥底 2（新手友善）」「勝負：臥底方人數追上平民就贏」「平票：PK 再投，再平票冇人出局」
「詞庫：食物、飲品（簡單、中等）」, plus lines only when they differ from the default: 白板估詞 / 「白板估中淨係白板自己贏」 /
「白板唔會第一個講」 / 「PK 淨係冇份 PK 嘅人投」 / 「要過半數先出局」 / 「避免同一個人連續做臥底／白板」 / 唔公開身份 / 棄票 / 限時.

## 3. Flow

Phases: `deal → speak → discuss → vote → elim → (speak | over)`. PK reuses `speak` and `vote` with `kind: 'pk'`.
Every step has a narration cue; none is blocking. The host phone has no special screen: it is a player's
phone, plus the shell's generic menu (暫停 / 下一步 / 旁白 / 代佢做).

Every view carries `hint` (BACKLOG U1, §5.5): one line of 「而家要做咩」 for the 💡 sheet. **The game UI never shows it**;
the shell shows it only when the player taps 💡.

### 3.1 Setup of the hand (engine `setup`)

1. Draw a pair from the bag with the config filter. If the filter matches nothing it is ignored for this game
   (`view.relaxed` → toast 「所揀類別嘅詞已經冇晒，今局用咗其他類別」); an empty bank uses one built-in pair.
2. A coin decides which side the civilians get (`a` or `b`). Undercovers get the other.
3. Roles are a shuffle of the seats: undercovers, then white cards, the rest civilians. With `antiStreak` and a
   `carry`, last game's special seats are moved to the back of the shuffled queue first.
4. The first speaker of round 1 is random over **all** seats (only `blankNeverFirst` removes the white card).

### 3.2 deal

| Screen | Shows |
|---|---|
| Every player phone | 「你嘅詞語」, 「睇清楚你個詞，記住就㩒「記住喇」。」 + the hold-to-peek word card (RoleCard, 🃏 + the word in the same place and size for everybody; the white card's card says 「白板」; the card's own hint 「㩒住先睇到，放手即刻冚返」 is the only peek instruction) + 「🔓 鎖定詞語卡」 + button 「記住喇 ✓」. Under it 「已有 3 / 6 人記住咗 · 等緊：阿明、阿強」 |
| After 記住喇 | the card **locks itself** (sound `lock`, same for every role); text 「✓ 你已經記住咗」; 「想再睇一次？㩒 🔓 解鎖，睇完記得再鎖返。」 |
| Table / spectator | 「大家逐個睇緊自己嘅詞語，你係旁觀者。」 + the same progress line |
| Header (all) | 「今局：平民 5 · 臥底 1 · 白板 1」 (counts are announced) and the seat strip |

Hint: 「㩒住張卡睇你個詞，記住咗就㩒「記住喇」。」 → after 記住喇 「等其他人睇完。唔記得個詞，可以㩒 🔓 再睇。」

Narration (cue `deal`): 「準備開始。今局有 5 個平民、1 個臥底。大家用自己部手機睇詞語，睇完記住就㩒「記住喇」。」

Transition: when the last seat taps 記住喇 → round 1. No timer. A seat that never confirms blocks the game:
the shell's stall prompt (`focus` lists the unconfirmed seats) offers 「代佢做」 → `autoAct` = ready. Host
`@next` (twice: first press completes the cue) force-starts; a skipped player can still open 「睇返我個詞」.

Anti-tell: hold-to-peek, lock after use; the white card's card has the **same size and place**, only the text
differs; no vibration; the same sounds for every role; the tap timing of 記住喇 tells nothing.

### 3.3 speak

| Screen | Shows |
|---|---|
| All phones | the speaker, big: 「阿強 講緊…」 (own phone, own turn: 「輪到你講！」 with a pulse); 「第 1 輪 · 第 1 / 6 個」; the order list with ✓ for those who have spoken; a Timer if `speakSec`; the one rule the app states as a rule: 「一人一句。唔可以講出個詞，或者入面任何一個字。」 (PK: 「平票嘅人再講多一句：點解你唔係臥底？」) |
| Speaker's phone | button 「講完喇 ▸」 |
| Others | no button. Eliminated: 「你已經出局，聽住大家講。」 |
| Header (all) | seat strip: current speaker highlighted, spoken dimmed, eliminated struck through with their role emoji (if revealed) |

Clue rules (verified): the only universal ban is saying your own word — CN/TW add "or any character of it". The clue
must be about your own word (CN classic: an undercover may not say something unrelated just to hide). Translation,
stating the length and repeating an earlier clue are popular **house rules**; the rules sheet lists them as
「好多人仲會加（開波前講好）」, never as app rules.

Order: round 1 starts at the starter and follows seat order, wrapping; **only alive seats**. Round r > 1 starts at
the next alive seat after the previous round's FIRST speaker (the rotation continues, dead seats skipped).
Narration: first turn 「第 1 輪。由 阿強 開始，跟座位次序，每人用一句嘢形容自己嘅詞語。」, then 「輪到 阿華。」 — role-neutral.
Own-turn sound `join` plays on the speaker's own phone only.

Hints: speaker 「輪到你：講一句形容你個詞，唔可以講出個詞或者入面嘅字，講完㩒「講完喇」。」 (PK: 「輪到你：再講一句形容你個詞，
話俾大家知你唔係臥底，講完㩒「講完喇」。」); listeners 「聽佢點講，諗下佢個詞同你嘅係咪一樣。」 (PK: 「平票嘅人再講多一句，聽清楚先投。」);
eliminated 「你出咗局，靜靜聽就得，唔好爆料。」

Transitions: 講完喇 (any seat may send it — see §5.2 — but the step id `at` must match) → next speaker; after the
last → `discuss` (round) or the PK vote (pk). Timer: each turn gets a fresh `speakSec`; time out skips the turn.
`@next` after the cue is done skips the speaker.

### 3.4 discuss

All phones: 「自由討論」「大家都講完喇。邊個最似臥底？傾夠就開始投票。」 + Timer if `discussSec` + button
「開始投票 🗳️」 (any seat). Narration: 「大家都講完喇。自由討論一下，邊個最似臥底？限時 90 秒。」
Hint: 「自由傾：邊個最可疑？傾夠就㩒「開始投票」。」 (eliminated: 「你出咗局，聽就得，唔好爆料。」)
Opening the vote early is harmless: ballots are secret and nothing resolves until everyone has voted.

### 3.5 vote

| Screen | Shows |
|---|---|
| Voter | 「投票」 / PK: 「PK 投票」; the VotePanel (pick, then 確定 — two taps); myVote can be changed (改票) until the last ballot lands; 「已投 3 / 6 · 仲未投：…」; Timer if `voteSec` |
| Tied seat under `pkVoters: others` | 「你喺 PK 入面，今次唔使投，等其他人決定。」 |
| Eliminated | 「你已經出局，唔使投票，睇住大家投。」 |
| Table | 「大家投緊票。」 + progress |

Rules: one ballot per voter; no self-vote; no dead target; abstain only if `abstain`. **Ballots stay private**
(views carry only `done` seats). The vote resolves the moment the last voter has voted, or on the timer.
Narration: 「投票時間。揀一個你覺得係臥底嘅人，全部人投晒就會公佈。」
Hints: 「揀一個你覺得係臥底嘅人，再㩒確定。」 (PK: 「喺平票嗰幾個入面揀一個你覺得係臥底嘅，再㩒確定。」); after voting
「投咗喇，等其他人。未公佈之前仲可以改。」; tied non-voter 「你喺 PK 入面，今次由其他人投。」; eliminated 「你出咗局，唔使投。」

### 3.6 elim (the result of a vote)

Everyone sees: the tally bars with **who voted for whom** (VotePanel reveal), then one of

- 「阿明 出局」 + role chip (🧑 平民 / 🕵️ 臥底 / ⬜ 白板) or 「身份唔公開」
- 「平票！阿華、阿明 同票」 + 「佢哋要再講多一句，然後全部人只喺佢哋之間再投一次。」 (`others`: 「…然後其他人只喺佢哋之間再投一次。」)
- 「{why}，今輪冇人出局」 + 「剩低嘅人繼續下一輪。」, why = 「冇人投票」 / 「冇人過半數」 / 「全部人同票」 / 「平票」 (tie = skip) / 「PK 再平票」

Sound `reveal` (the same whoever is out). Button 「繼續 ▸」 for every seat (disabled 1.5 s after the result
appears so a stray tap cannot skip it); the result also moves on by itself after 20 s. Eliminated player's own
phone adds 「你出局喇。可以繼續睇住，但唔使再講嘢或者投票。」

Narration: 「投票結果：阿明 出局。佢係平民。」 (without 「佢係…」 when roles are hidden);
「平票！阿華、阿明 同票。佢哋要再講多一句，然後大家再投一次，只可以投佢哋其中一個。」 (`others`: 「…然後其他人再投一次…」);
「冇人過半數，今輪冇人出局，繼續下一輪。」 etc.

Hints: out 「睇下邊個出局、邊個投咗邊個，然後㩒「繼續」。」; the eliminated seat 「你出局喇，之後唔使講嘢同投票，可以繼續睇。㩒「繼續」。」;
PK 「平票：佢哋再講一句，之後再投一次。㩒「繼續」。」; nobody out 「今輪冇人出局，㩒「繼續」開下一輪。」

**White card guess.** If the player voted out is a white card and `blankGuess` is on (the guess runs **before** the win
check, even when this elimination would hand the civilians the win):

- the white card's phone shows 「你係白板！你有一次機會估平民個詞，估中臥底方即刻贏。」 (`guessWinner: blank`:
  「…估中你自己即刻贏。」) + a text box + 「提交答案」 + 「要同個詞一樣先算（例如「士多啤梨」）。想放棄就留空再㩒。」;
  `focus` names that seat (a shared phone is handed over). The Timer 「估詞」 counts 90 s; nobody can continue meanwhile.
  Hint 「你係白板！打出你估嘅平民詞語，估中就贏。」 (others: 「等白板估平民個詞。」)
- others see 「白板 阿強 諗緊平民個詞…」 and the same timer.
- after the answer everybody sees 「白板 阿強 估「芥辣」」 + 「估中喇！🎯」 / 「唔啱 ✗」 (or
  「白板 阿強 冇作答，當估錯。」 on timeout / empty).
- the civilian word stays secret while the guess is open and after a wrong guess (the game goes on).
- the guess is judged by the engine: same word after NFKC, case, whitespace and punctuation are ignored; the
  undercover word is wrong; an optional bank field `alias: { a: [...], b: [...] }` adds accepted spellings. One try.
- the white card is announced as 白板 **even when `revealRole` is off** (the guess screen gives it away).
- Narration: 「投票結果：阿強 出局。白板 阿強，你有一次機會，用手機打出你估嘅平民詞語。」 then
  「白板 阿強 估「芥辣」，唔啱。」 / 「…，估中喇！」

After 繼續: win check already decided (`elim.next`): `over`, or PK, or the next round.

### 3.7 Ties and empty rounds (research "Voting & resolution", verified)

```
main vote
  nobody voted ...................................... no elimination ('nobody')
  majority on and top has ≤ half the cast ballots ... no elimination ('nomajority')  — so no PK ever with majority on
  unique top ........................................ out
  everybody alive tied (a vote cycle) ............... no elimination ('alltied')    — a PK would be meaningless
  tie, tie = skip ................................... no elimination ('tie')
  tie otherwise ..................................... PK
PK: the tied speak again (same relative order), then vote, targets = the tied only, no self-vote
    voters = every alive seat (pkVoters 'all', default) | alive minus the tied ('others')
    — with a 2-way tie and no abstain both give the same result (the tied two cancel out)
  unique top ........................................ out
  tie again: pk-random → random among the tied; otherwise no elimination ('pktie')
no elimination twice in a row → the third time somebody MUST go (random among the top, or among all if nobody voted)
```
`noElimStreak` counts rounds that ended without an elimination (a PK that ends level counts once). A PK never has zero
voters (a full-table tie skips it) and no vote ever happens with 2 players left (every threshold ends the game at
T = 2) — the fuzzer asserts both instead of the engine carrying a fallback.

### 3.8 over

`result()` is non-null only here. The shell's results screen shows winners, `summary`, `lines` and `points`;
the game's own `over` screen (also shown by `view.over`) reveals everything: banner 「🧑 平民贏！」 / 「🕵️ 臥底方贏！」 /
「⬜ 白板贏！」, the reason, both words, and every seat with role, word and 「第 2 輪出局」/「一直生還」, plus
「臥底同平民都唔知自己個詞係咪同大家唔同 — 呢個就係好玩嘅地方。」 Hint: 「完咗！睇下兩個詞係乜、邊個係臥底。」
Narration: 「遊戲完結，平民贏。所有臥底都被投出局，平民贏。」

### 3.9 Win check (after every elimination and every guess; research order, verified)

C / U / B = civilians / undercovers / white cards alive, I = U + B, T = C + I, n0 = starting head-count.

1. correct guess → `guessWinner` side wins (even with the civilians in the majority)
2. `I == 0` → civilians win
3. infiltrators win if `I >= 1` and (`C == 0` — the safety net for every threshold — or the threshold holds):

| `win` | holds when | note |
|---|---|---|
| `parity` (default) | `I >= C` | equal or more |
| `last3` | `T <= 3` | pure CN classic. With 2+ infiltrators it fires LATER than parity (2C v 2U plays on); with 4+ alive only `C == 0` ends it |
| `last3OrParity` | `T <= 3` or `I >= C` | whichever first; the option the verifier recommends for multi-undercover games |
| `civ_le_2` | `C <= 2` | NetEase / ss911 / Sina |
| `one_civ` | `C <= 1` | Yanstar, PTT |
| `size_based` | `T <= 2` if n0 < 7, else `T <= 3` | 3DM 565026 (cutoff 7) |

4. otherwise the next round

If the last undercover goes but a white card remains, the game continues (the white card counts as infiltrator).
Every threshold ends the game at T = 2, so a vote never happens with 2 players left.

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
| `cfg` | fitted config (role counts clamped, preset resolved) |
| `seats`, `names`, `alive`, `counts0` | public |
| `roles` | **PRIVATE** seat → civilian / undercover / blank |
| `words` | **PRIVATE** seat → word, `null` for the white card |
| `pair` | **PRIVATE until `over`**: `{civ, und, accept[], cat, level}` |
| `ready`, `round`, `starter`, `firstSeat`, `roundOrder`, `order`, `turn`, `speakKind` | speaking |
| `ballots`, `candidates`, `voters`, `voteKind` | **PRIVATE while the vote is open** (only `done` seats are exposed) |
| `pkCands`, `elim`, `outs`, `history`, `noElimStreak` | results; `outs[].role` is disclosed per `revealRole`; `elim.reason` / `history[].reason` = why nobody went out |
| `win` | `{ side: civilians \| infiltrators \| blank, why, c, i, guesser? }`; why = allOut / parity / last3 / last2 / civ2 / civ1 / wipe / guess |
| `cueDone`, `deadline`, `timerLabel`, `relaxed` | |

### 5.2 Actions

| action | by | valid when | effect |
|---|---|---|---|
| `{type:'ready'}` | any seat | `deal`, not yet ready | mark ready; all ready → round 1 |
| `{type:'done', at?}` | any seat | `speak`; `at` (the view's `speak.id`) equals the current step when given | next speaker / `discuss` / PK vote |
| `{type:'start-vote'}` | any seat | `discuss` | open the vote |
| `{type:'vote', target}` | a voter | `vote`; target ∈ candidates, ≠ self; `null` only with `abstain` | set (overwrite) the ballot; last ballot resolves |
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
`deadline` + `timerLabel` (『發言』『討論』『投票』『估詞』); the 20 s result timer has no label, so no clock is shown.

### 5.4 focus / autoAct / legalActions / cue

- `focus`: `deal` → unconfirmed seats; `vote` → voters yet to vote; `elim` with a pending guess → the white card;
  otherwise `null` (speaking and discussion are public — gating a shared phone for them would be silly). No `anonymous`.
- `autoAct`: ready / done / start-vote / vote (abstain if allowed, else a random legal target) / empty guess /
  continue. `null` when the seat has nothing to do.
- `legalActions`: exactly the actions that change the state. The guess lists a wrong example and the right word
  (fuzzer only; never sent to a phone).
- `cue` ids are unique per step: `deal`, `speak:{round}:{round|pk}:{turn}`, `discuss:{round}`,
  `vote:{round}:{main|pk}:{n}`, `elim:{n}:{result|guess|verdict}`, `over`. Cue text never contains a word or a role of
  a player still in the game (checked by a test).

### 5.5 View (whitelist)

Public part, identical for every seat (**tested: `view(A)` minus `me` and `hint` deep-equals the table view**): `phase`,
`title`, `subtitle`, `round`, `counts`, `flags` (`revealRole`, `abstain`, `blankGuess`, `guessWinner`, `tie`, `pkVoters`,
`majority`, `win`), `seats`, `outs`, `history` (with ballots and `reason`), `deadline`/`timerLabel`, and
`deal` / `speak` / `vote` / `elim` / `over` for the phase. `me` (own seat only): `id`, `alive`, `word` (`null` for
the white card), `ready`, and — only for the white card — `blank: true`; in a vote `canVote`, `targets`, `myVote`;
`mustGuess` for the white card with a pending guess. Views never alias engine state.

`hint` (per seat, also on the table view): one line, ≤ 48 characters, built **only from public facts** about the seat
(phase, alive, ready, whose turn, voter or not, voted or not, the announced white card) — never from a role or a word.
Tested: two seats with the same public facts always get the same hint, whatever their roles.

### 5.6 Result and explanation (BACKLOG #10)

`winners`: every player on the winning side (eliminated ones too); with `guessWinner: blank` only the guessing white
card. `summary`: 「平民贏！平民詞「泳池」，臥底詞「沙灘」」 (「白板贏！…」 for a solo guess).
`lines`, in order:

1. the reason — 「所有臥底都被投出局，平民贏。」 / 「所有臥底同白板都被投出局，平民贏。」 / 「白板被投出局，平民贏。」 /
   「場上剩低 1 個平民、1 個臥底方，臥底方人數追上平民，臥底方贏。」 / 「場上淨係剩 3 個人，臥底方仲有人喺度，臥底方贏。」 /
   「平民淨係剩 2 個，臥底方仲有人喺度，臥底方贏。」 / 「平民淨係剩 1 個，臥底方贏。」 / 「平民全部出局，臥底方贏。」 /
   「白板 阿強 出局之後估中平民嘅詞語「泳池」，臥底方即刻贏。」 (or 「…，白板自己贏。」)
2. 「詞語：平民「泳池」，臥底「沙灘」（地方）」
3. 「平民：…」, 「臥底：…（佢一開始都唔知自己係臥底）」 (two or more: 「佢哋」), 「白板：…」
4. the mis-votes that decided it: 「平民投走咗 2 個自己人：阿明、阿強。」 or 「平民一個自己人都冇投錯！」
5. with `revealRole` off: 「今局出局嗰陣冇公開身份，下面係真身份。」
6. one line per vote: 「第 1 輪：阿龍 出局（臥底，5 票）」, 「第 2 輪：阿華、阿明 同票，要 PK」, 「第 2 輪 PK：阿明 出局（平民，4 票）」,
   「第 3 輪：冇人過半數，冇人出局」, 「第 4 輪：阿詩 出局（白板，5 票）；白板估「x」，估錯」, 「…（平民，連續冇人出局所以隨機抽）」

`points` (equalised preset, winners only): civilians +2 each; each winning undercover `round(2·C0/U0)`; each winning white
card 3 (a lone white card with no undercover is paid like an undercover; a solo correct guess also pays 3).

### 5.7 carry (anti-streak)

`result().carry = { special: [pids of every undercover and white card] }`. `setup({ ..., carry })` reads it only when
`cfg.antiStreak` is on: those seats go to the back of the shuffled queue, so they are civilians whenever at least
`U + B` other seats exist (otherwise as many as possible are skipped). Garbage `carry` is ignored. The room keeps the
last `result().carry` per game id in host memory (`js/core/room.js` `carries`) and the Session hands it to the next
`setup` of the same game, so the toggle works across games of one evening. It is part of the host's saved room
(`snapshot().carries`), so a host refresh / resume of the same room keeps it; a new room starts with none.

## 6. Edge cases → tests (`tests/undercover.test.mjs`)

| edge case | test |
|---|---|
| quick ≤ 6 short lines; every role: what you do + how you win | U1 — rules.quick … |
| only "own word" is a hard clue ban | clue rule — the only hard ban … |
| defaults per n (preset std, verified defaults: parity, ALL_ALIVE, plurality, team guess, random starter) | defaults are valid … |
| every preset × n × threshold legal and undecided, with a reason; deal = preset counts | #8 — every preset … |
| preset missing at n blocked; presets follow n; 自訂 kept while it fits | #8 — a preset that does not exist …; #8 — named presets follow … |
| every role split 4–12 legal/illegal for every threshold; never decided at the deal | validate accepts exactly the legal role splits, for every threshold |
| string ints, n out of range, garbage keys | validate rejects … coerces |
| lopsided tables warn (incl. last3 with 3+ infiltrators) | validate warns |
| parity equal-or-more; pure last3 later than parity with 2+; C == 0 net; T = 2 always ends | thresholds — parity … |
| last3OrParity / civ_le_2 / one_civ / size_based truth tables; mis-votes `2I - 3` shift | thresholds — last3OrParity … |
| C == 0 ends a pure-last3 game with 4 infiltrators | C == 0 safety net … |
| last3OrParity / civ_le_2 / one_civ / size_based in play | last3OrParity ends …; civ_le_2, one_civ and size_based … |
| first speaker random over all seats incl. undercover and white card; house rule narrows | #20 — the first speaker … |
| anti-streak on/off, tight pool, carry from result, garbage carry | #20 — anti-streak … |
| filter by category/level; filter matches nothing; empty bank | category and level filters; a filter that matches nothing |
| orientation random, roles shuffled | which word … |
| garbage config clamped | setup survives nonsense config |
| deal gate, idempotent ready | nobody speaks until every seat has confirmed |
| garbage actions, foreign seats | foreign seats, garbage … ; garbage thrown at every phase |
| speaking order, wrap, dead skipped, rotation from first speaker | speaking starts …; later rounds start … |
| double tap on 講完喇 | a stale or double tap … |
| speak/discuss/vote timers, no-timer default | speaking timer …; discussion ends …; a vote timer … |
| ballot validation, dead seats, abstain, overwrite, auto-resolve | ballots are validated …; a dead seat …; abstaining …; the vote resolves … |
| nobody votes | nobody voting means nobody leaves |
| PK ALL_ALIVE flow; NON_TIED; 2-way equivalence; 3-way tie targets | a tie goes to PK …; PK voters — NON_TIED …; PK in a 3-way tie … |
| second tie (pk / pk-random), skip, cycle | a second tie …; tie = skip …; a vote where everybody ties |
| no-majority rule, abstentions not counted, no PK with majority | no-majority rule … |
| no-elimination streak guard | after two rounds without an elimination … |
| reveal on/off, white card always announced when it guesses | the eliminated role is announced …; with reveal off … |
| guess: correct wins at once, team vs solo winner, wrong continues / civilians win, normalisation, alias, timeout, one try, off | the white card tests (8) |
| civilians must remove undercover AND white card; parity; last3; white-card-only game | winning tests |
| result lines (mis-votes, hidden roles, PK, empty rounds), both words, points | the result explains …; #10 — result lines …; points … |
| hints: every phase, every seat, one line, public facts only | U1 — every phase has a hint …; no view carries … |
| cue ids unique, never leak a word/role | every phase has a cue …; cues never say … |
| `@next` semantics, `@cue-done`, host-only types | @next first finishes …; the host can push every step … |
| focus, autoAct | focus names exactly …; autoAct gives a stalled seat … |
| views: no seat sees more than its own secret, at every step, public part identical | no view carries anything but … ; your own word shows up only … |
| fuzz: 9 head-counts × 140 seeds × 14 config variants; dealt counts = config; PK voters never empty; no vote at T = 2; rare branches reached | random legal play ends … |
| every listed legal action changes the state (all 14 variants) | every action the engine lists is accepted … |
| determinism, JSON state, `act` returns its input | the same seed …; engine state is plain JSON …; act returns … |

## 7. 貼心 touches

- **Nobody has to referee.** The phones know both words, the order, the count and the rules.
- **One-tap presets with a reason** (「6 人：1 臥底 — 新手友善」, 「平民投錯 4 次先輸」); counts only under 自訂.
- **The card locks itself** after 記住喇, and on a shared phone after every peek.
- **「睇返我個詞」** is always one tap away (the most common complaint in this game).
- **The white card's screen is the same size and place** as everyone else's; no role-dependent sound or animation.
- **Fair-feeling start**: anybody can speak first, undercover and white card included; exceptions are announced toggles.
- **Counts are announced** (「平民 5 · 臥底 1 · 白板 1」) at the top of every screen, like at a real table.
- **The order is visible**, with ticks, so nobody is skipped or speaks twice; names keep their seat colour.
- **Open ballots after the vote** (who voted for whom) — it ends the 「我冇投你」 arguments.
- **PK is explained in words** on the result screen, so nobody asks 「點解要再投？」
- **Forced elimination after two level rounds** so a stubborn table cannot loop forever; the screen says why.
- **Dead players stay in**: they keep their word card, see everything, and can press 繼續.
- **A dead phone does not stop the game**: stall prompt → 「代佢做」; host `@next` skips a step; timers are optional.
- **Words the group has seen are not repeated** across evenings (bag), and the 日本旅行 / 港式地道 categories fit the trip.
- **The results screen teaches**: both words, who held what, how many own people the civilians threw out, every vote,
  hidden roles, and 「臥底自己一開始都唔知」.
- **💡 on demand only**: every phase has a one-line hint, shown only when tapped.
- **No vibration, no sound that differs by role**; the elimination reveal uses one sound.

## 8. Framework requests / notes for other tasks

1. **Room: carry between games (anti-streak, BACKLOG #20) — done.** The room keeps `res.carry` from `engine.result()`
   per `gameId` in host memory (`js/core/room.js`: `this.carries`, stored when a game ends, passed to the next
   `Session` for the same game), the Session passes it to `engine.setup({ ..., carry })`, and `tests/lib.mjs` `Sim`
   takes a `carry` option. So `antiStreak` works from the second game of an evening on.
2. **💡 sheet (U1).** Read `view.hint` for 「而家要做咩」. In this game nobody knows their own role (only the white card,
   `view.me.blank`), so 「你嘅角色」 should list the three `rules.roles` lines (each has 「點贏：」) rather than one role; never
   pick a role from hidden state.
3. **Registry meta (G16).** `js/games/registry.js` has a different blurb (「大家拎到相似嘅詞，輪流描述，揾出拎住唔同詞嘅臥底。」,
   with the wrong 揾 for 搵); game meta is 「人人一個詞，臥底嘅詞好似但唔同 — 一句嘢形容，投出臥底！」.
4. **Lobby: show 已用 / 總數.** `config.fields(cfg, n, { bag })` fills `field.stats` for the `categories` field; the
   lobby should pass its bag (`bag.stats` throws if the bank is not loaded, which `fields` swallows).
5. **RoleCard lock label.** RoleCard words its lock for a role card (「🔓 鎖定角色牌」, the refusal toast 「角色牌鎖咗，要自己
   解鎖」, the label 「㩒住睇角色牌」); nobody here holds a role, only a word. Done game-side for now (playtest polish): the UI
   passes no `onLockToggle`, so RoleCard's own lock button stays hidden, and renders its own 「🔓 鎖定詞語卡」 /
   「🔒 已鎖 — 㩒一下解鎖」 under the card with RoleCard's classes; a press on the locked cover is refused in a capture
   listener on the card (「詞語卡鎖咗，要自己解鎖」) before the cover can say 角色牌; the cover's aria-label is set to
   「㩒住睇詞語」 after every paint (and passed as `ariaLabel`). RoleCard has since grown `lockLabels` ({ lock, locked,
   message }) and `ariaLabel` (#39, another task); once that lands, this can shrink to passing `onLockToggle` + those props
   (the test then has to catch the refusal toast from the Cover, not `api.toast`). Tested with the real RoleCard on a fake DOM.
6. **Bank aliases.** `undercover-words.js` entries could carry `alias: { a: [...], b: [...] }` (other spellings / Mandarin
   forms) which the engine accepts as a correct white-card guess. There is no 簡 ↔ 繁 folding.
7. **`api.players[].deviceId`** is used to detect a shared phone; the UI treats a missing id as "own phone".
8. The game assumes the shell keeps mounting one game UI per seat (as `screens/play.js` does) and re-mounts it when the seat changes.
9. Host `@next` is "complete the cue first": the shell's 「下一步」 needs two presses while the current cue is still being
   narrated. If the shell wants a single press it should call `cueDone(id)` itself before `next()`.

## 9. Open issues / deliberate deviations

- **Human judge for the white card's guess.** The research suggests a host/group 「啱 / 唔啱」 button as a fallback for
  spoken guesses. Not built: in a referee-less game the only judges are players who do not know their side (an
  undercover would accept the undercover word), and judging needs the civilian word on screen mid-game. The engine
  judges typed guesses (normalised + bank aliases). A Mandarin / Simplified spelling is wrong unless aliased.
- **`blankModel: separate_winner`** (CN 3DM: the white card is a third side that wins alone if all undercovers go while it
  lives) is not offered: the research does not say whether parity-style thresholds count the white card, or who wins
  when undercovers reach the threshold with the white card alive.
- **Reveal "role + word"** (some Western apps) is not offered: it hands the civilian word to the remaining undercovers.
- **Hiding the white card's existence** ("hardcore") and **counts-only vote reveal** are not offered.
- `secondTie: ELIMINATE_ALL_TIED / HOST_DECIDES` from the research pseudo-code are not offered (no source in the variants list).
- No foul button / clue log: clue legality is social (research: out of scope for v1).
- No multi-round session scoring beyond what the room already does with `points` (one game = one round).

## 10. QA pass 2026-10-03 UTC — rule check against the verified research

Only rows that needed a fix, or could not be resolved:

| rule | verified doc | code before | now |
|---|---|---|---|
| thresholds | parity default; pure last3 = `T <= 3` (later than parity with 2+ infiltrators); `C == 0` net for all; offer `last3OrParity`; all six allowed values | parity + pure last3 + net; no `last3OrParity` / `civ_le_2` / `one_civ` / `size_based` | all six, each unit-tested over every split 4–12; warning for last3 with 3+ infiltrators |
| PK voters | default ALL_ALIVE; NON_TIED is a variant to expose | ALL_ALIVE only | `pkVoters: all \| others` |
| no majority | `majorityRequired`: ≤ half → no elimination, counts toward the streak | not offered | `majority` option |
| main-vote cycle wording | everybody tied → no PK, no elimination | said 「再次平票」 (wrong on a first tie) | reasons `alltied` / `pktie` / `tie` / `nomajority` / `nobody`, each with its own line |
| clue bans | only "own word / any character" is universal; translation, length, repeats are house rules; clue must be about your word | all four listed as rules (rules sheet + speak screen) | one hard rule; the rest 「好多人仲會加（開波前講好）」; CN no-unrelated-clue rule added |
| Mr. White guess winner | `all_infiltrators` (default) vs `blank_only` (Yanstar, bestpartygames, MASJV) | team only | `guessWinner: team \| blank`, side `blank`, 「⬜ 白板贏！」 |
| first speaker | "never start on the blank" is only a house rule (no source) | default ON | default OFF (BACKLOG #20), announced toggle |
| human guess judge | host/group fallback suggested | — | not built, see §9 |
| separate-winner white card | third model | — | not built, see §9 |
