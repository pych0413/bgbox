# 誰是臥底 (Who Is the Undercover) — rules reference

> Paraphrased for engine implementation. Not a copy of the official rulebook.

Research date: 2026-10-03 UTC. Confidence notes: 誰是臥底 is a folk game with no single rulebook. Everything below is reconciled from many community write-ups, app descriptions and open-source implementations (see Sources). Where sources disagree, the disagreement is listed and the engine is expected to expose it as a config option. Items I could not verify are flagged "unverified". Several Chinese sites (Baidu Baike, Zhihu, Douban) blocked fetching, so their content is only known through search snippets or secondary summaries.

## Identity

| Field | Value |
|---|---|
| EN name(s) | Who Is the Undercover; Who Is Spy / Who's the Spy; "Undercover" (+ "Mr. White" blank) in Western apps. Japanese sibling: Word Wolf (ワードウルフ). |
| 繁中 name(s) | 誰是臥底 (HK/TW standard); 找出臥底 (some TW apps); a Hong Kong app is titled 誰是臥底(香港版) with a Cantonese word library. Mainland: 谁是卧底. |
| Player range | Apps: minimum 3 (Yanstar Undercover 3-20, TW "Who Is Spy" 3-10, 誰是臥底(香港版) 3-20; bestpartygames 4-20). Written rules: Baidu's text says n >= 3; published count tables start at 3 (TW pixnet guide), 4 (M-Calc) or 6 (CN classic table). **Project scope: 4-12.** |
| Best count | About 6-10 (bestpartygames calls 6-12 optimal; Word Wolf guides cap at about 9 because speaking time runs short above that). Under 5 is thin, over 12 starves each player of speaking time. |
| Publisher / designer | None. Folk party game. Popularised in mainland China by the Hunan TV variety show 快樂大本營 (Happy Camp) in 2012 (Baidu's English article says Happy Camp adapted and renamed it; the earliest episode in its episode table is 2012-09-29; other sources give other first-air dates), and it evolved from an older party game 捉鬼 ("ghost catching"). Commercial relatives: Undercover (Yanstar Studio, with the Mr. White blank role) and Word Wolf ワードウルフ (designer 川崎晋; conceived on his blog in Nov 2003, first published in a game book in Oct 2012, phone apps from about 2015, self-published box 2019, Gentosha Education box 2020-04-25, per Japanese Wikipedia). |
| Physical components the app must replace | (1) Word-pair slips or cards, one slip per player, written or drawn by a referee; a physically blank slip for 白板. (2) A referee (主持人 / 法官) who knows the words and the roles, assigns speaking order and tallies votes, OR slips drawn blind by players in a refereeless game. (3) A way to vote (pointing on a countdown, paper ballots, or fingers). (4) Speaking-order bookkeeping, an optional timer, a score sheet. (5) A word bank (the pairs). |

### Terminology (繁體中文, as used in HK/TW)

| EN | 繁中 |
|---|---|
| civilian | 平民 |
| undercover | 臥底 |
| blank / Mr. White | 白板 |
| infiltrators (undercover + blank together) | 臥底方 / 潛伏者 (informal; not a standard term) |
| word / identity word | 詞語 / 身份詞 |
| word pair | 詞對 / 題目 |
| description round | 描述輪 / 發言 |
| vote | 投票 |
| eliminated | 淘汰 / 出局 |
| tie | 平票 |
| tie-break speeches + revote | PK (平票PK) |
| moderator / referee | 主持人 / 法官 |
| guess the civilian word | 猜詞 |

## Roles

Nobody is told their role. Players only see a word (or nothing). The blank is the one exception: an empty card tells its holder what they are.

| id | EN | 繁中 | team | ability (precise) | acts at night? when? |
|---|---|---|---|---|---|
| `civilian` | Civilian | 平民 | civilians | Holds the civilian word C (shared by every civilian). Does not know whether they are civilian or undercover until others' clues make it obvious. Each round gives one truthful clue about C without saying C. Votes. Wins when every infiltrator has been voted out. | No night phase |
| `undercover` | Undercover | 臥底 | infiltrators | Holds the undercover word U, related to C but different. Does not know their word is the odd one out and has to infer it from the clues. If there are several undercovers, all share the same U by default and do not know each other. Gives one clue per round and is expected to describe U honestly (never a clue unrelated to U). Votes. Wins by reaching the infiltrator threshold (see Scoring). | No night phase |
| `blank` | Blank / Mr. White | 白板 | infiltrators (default) | Holds no word and knows it. Has to fake plausible clues from what earlier speakers said. Votes. In the digital/Western rule set, when voted out, gets exactly one spoken guess at C: a correct guess wins immediately. In some CN rule sets the blank is instead a separate third winner (see Common variants). | No night phase |
| `moderator` | Moderator / Referee | 主持人 / 法官 | none (non-player) | Optional. Knows both words and all roles, calls the speaking order, tallies votes, rules on guesses and rule violations. In the app this becomes the host dashboard, or nobody (fully automatic). | No night phase |

State, not role: `alive` / `eliminated`. Eliminated players do not speak or vote (they may watch).

## Setup by player count

There is **no official table** for 誰是臥底. Every row below is "commonly used" (folk/app guidance), not official. The closest first-party source is the Yanstar Undercover app, which auto-suggests counts but does not publish its table. The "Project default" column is this project's design choice, built from the sources and the balance arithmetic below.

Notation: C/U/B = civilians / undercovers / blanks; I = U + B. "Mis-votes" = the number of civilian eliminations that brings infiltrators to parity (infiltrators alive >= civilians alive) if no infiltrator is ever voted out, i.e. `C - I`. The game is lost on that mis-vote, so civilians can afford `C - I - 1` mistakes; "1" means the very first wrong vote loses. Higher means easier for civilians. Under the pure "last 3" threshold (`T <= 3` with an infiltrator alive) the count changes by `2I - 3` while all infiltrators are alive: one fewer with 1 infiltrator, one more with 2, three more with 3, and with 4 or more infiltrators alive `T <= 3` cannot be reached by mis-votes at all (see the `C == 0` guard in Scoring).

| N | Project default (no blank) C/U/B | Mis-votes | Blank-on option C/U/B | Mis-votes | Other combinations seen in sources |
|---|---|---|---|---|---|
| 4 | 3/1/0 | 2 | not allowed (2 infiltrators vs 2 civilians is already parity) | n/a | 3/1/0 only (M-Calc: "no blank recommended") |
| 5 | 4/1/0 | 3 | 3/1/1 (harsh: 1) | 1 | 3/1/1 (a CN guide example seen via search, and M-Calc "3-4 civilians, 0-1 blank"); 3/2/0 is legal but rare |
| 6 | 5/1/0 | 4 | 4/1/1 | 2 | 4/2/0 (Word Wolf beginners' split, TW app "6-9 players: 2 undercovers"); 6-8 players = 1 undercover (CN classic) |
| 7 | 5/2/0 | 3 | 5/1/1 | 3 | 6/1/0 (CN classic: 6-8 players = 1 undercover); 5/2/0 (TW guide: 7-10 = 2 undercovers); 4/2/1 is legal but harsh (1) |
| 8 | 6/2/0 | 4 | 6/1/1 | 4 | 7/1/0 (CN classic); 6/2/0 (a CN guide's 8-player example, seen via search); 5/2/1 (2) |
| 9 | 7/2/0 | 5 | 6/2/1 | 3 | 6/2/1 (a CN guide's 9-player example, seen via search); 6/3/0 (TW app: 10 players = 3, so rare at 9) |
| 10 | 7/3/0 | 4 | 7/2/1 | 4 | 8/2/0 (TW guide 7-10 = 2; M-Calc 10-11 = 2); 7/3/0 (TW app: 10 players = 3 undercovers) |
| 11 | 8/3/0 | 5 | 8/2/1 | 5 | 9/2/0 (M-Calc 10-11 = 2); 8/3/0 (TW guide 11-15 = 3) |
| 12 | 9/3/0 | 6 | 8/3/1 | 4 | 10/2/0 (CN classic 9-12 = 2); 9/3/0 (M-Calc 12-16 = 3, TW guide 11-15 = 3) |

Rules of thumb that most sources follow:

- Civilians must be a strict majority at the start. A convenient cap is `undercovers + blanks <= floor((N-1)/2)`; the engine should refuse configs that violate it (louisvrd/undercover uses exactly this cap, `(players - 1) // 2`). Not every source respects it: MASJV's recommended table turns Mr. White on at 3-4 players with 1 impostor, which already meets its own equal-or-outnumber win rule at 3 players and at 4 players (2 civilians vs 2). Do not copy that table below N = 5.
- Blank count is 0 or 1 in written rules (M-Calc: 0-1). Some apps allow up to 2 (playpartyplay: 0-2 Mr. White; Yanstar lets the host adjust the suggested counts, its exact table is not published). Allow 2 blanks only at N >= 10.
- Undercover count by size, as published by different sources (they overlap and disagree, which is why the project default is a design choice):
  - CN classic: 6-8 = 1, 9-12 = 2, 13-15 or 13-16 = 3, 16-20 or 17-20 = 4 (ss911 and a Sina blog; both pair this table with the `civ_le_2` win rule and a >50 percent elimination vote, not with "last 3").
  - TW guide (pixnet): 3-6 = 1, 7-10 = 2, 11-15 = 3, 16-20 = 4.
  - TW app (Who Is Spy, v1.04): 3-5 = 1, 6-9 = 2, 10 = 3.
  - M-Calc (TW): 4-6 = 1, 7-11 = 2, 12-16 = 3.
  - Another TW/HK app: 3-10 players, 1-3 undercovers selectable, blank optional.
  - Open-source default (MASJV): 3-6 = 1 undercover + blank on, 7 = 1 or 2, 8-12 = 2 + blank on.
  - Word Wolf (JP sibling): 3-5 = 1 minority, 6 = 1 or 2, 7-9 = 2, 10 = 2 or 3; 11+ should be split into two groups.
- Two or more undercovers by default hold the same word U. All civilians hold C. Which of the pair is C and which is U must be randomised every round.
- Players are never told how many undercovers or blanks exist in "hardcore" play, but the common practice is to announce the role counts (e.g. "5 civilians, 1 undercover, 1 blank"). Default: announce counts, make hiding the blank's existence an option.

## Procedure

Public = visible/audible to everyone. Private = visible only to the named player(s).

0. **Lobby and configuration.** Host picks N, role counts (C/U/B), word source (bank or custom), win threshold, tie rule, reveal rule, blank-guess rule, scoring preset, timers. PUBLIC: player list, seating order, role counts (default), rule toggles. Host acts alone; players join and can reorder seats to match the physical circle.
1. **Pick the word pair.** Engine draws a pair (a, b) from the bank and randomly designates which one is C and which is U. PRIVATE: the pair and its orientation (host-authoritative state; the host UI hides it unless the host opts to peek). Never reveal the orientation of the pair in advance.
2. **Assign roles.** Uniformly random assignment of civilian/undercover/blank to the N players. PRIVATE (nobody sees a role label on screen).
3. **Deal.** Every player privately views their word; the blank sees a placeholder in the same position and layout. Simultaneous when everyone has their own phone; sequential ("hand-over" screens) on a shared phone. PRIVATE. Hold-to-reveal, auto-hide after about 5 s, then "I remember it" confirm. Soft timer 15-20 s. The round cannot start until every player has confirmed.
4. **Round r, description phase** (r = 1, 2, ...). Alive players speak **sequentially**, once each, out loud. PUBLIC.
   - Order: a fixed seating circle, clockwise or counter-clockwise (M-Calc). Round 1 starts at a random player (Yanstar, M-Calc, TW "Who Is Spy"). Option (project default, design choice): never start on the blank, because the blank has zero information. This is a house rule; none of the fetched app rules forbids Mr. White from starting, and mrwhiteonline explicitly lets any player start. Later rounds: default continues the rotation by starting at the next alive player after the previous round's first speaker. Alternatives: restart from the original first speaker skipping the dead, or fresh random each round.
   - Content: one sentence (CN/TW standard, "每人用一句話描述") or a word / short phrase (Yanstar: a word or a short phrase; bestpartygames: one word). Must be true of your own word: the CN classic text explicitly forbids an undercover from saying something unrelated to their word just to hide. Core ban (all sources): never say your own word; CN/TW rules also forbid using any character of it (M-Calc). Widespread house bans (not in every source): repeating what a previous speaker already said, translating the word into another language, giving its length/character count. Undercover and blank are expected to improvise within these bans.
   - Timer (optional): about 20-30 s per speaker, skip on timeout.
   - Variant: some apps run several description rounds before one vote.
5. **Discussion** (optional). Free talk, PUBLIC. Timer about 60-120 s or until the host ends it.
6. **Vote.** All alive players vote **simultaneously** for one other alive player. PRIVATE while open, PUBLIC after all ballots are locked (default: show who voted for whom; option: counts only). Self-vote is not allowed. Abstain is allowed if configured. Timer about 15-30 s; a missing ballot counts as abstain. Physical equivalent: countdown "3-2-1" and everyone points at once.
7. **Resolve the vote** per "Voting & resolution": unique top = eliminate; tie = PK; second tie = rule from config; no elimination = go to the next description round with the same alive set.
8. **Reveal.** PUBLIC announcement of the eliminated player's identity, scope depends on the reveal rule: role only (default, most common), role plus their word, or "out" only with nothing revealed (hardcore). The remaining words stay secret until game end.
9. **Blank guess** (only if the eliminated player is a blank and the rule is on). The blank speaks one guess aloud, PUBLIC; the host (or the group) rules correct or incorrect. See edge cases for matching.
10. **Win check** (order given in Scoring). If nobody has won, increment r and return to step 4 with the surviving players.
11. **Game end.** PUBLIC full reveal: the word pair, who held what, vote history. Score the round. Offer "play another round": re-deal, new pair, rotate the starting seat.

## Night order

n/a. There is no night phase and nobody wakes up or closes their eyes. The deal in step 3 is the only moment with private information, and it is simultaneous on personal phones. The closest thing to a "night" risk is step 3's tell leakage (see App design notes).

## Voting & resolution

Inputs: `ballots` (voter -> target or abstain), `alive`, config `{pkVoters, secondTie, majorityRequired, maxNoElimStreak}`.

```
resolveVote(ballots, alive):
  valid = ballots whose voter in alive, target in alive, target != voter
  tally[p] = number of valid ballots on p
  if valid is empty: return NO_ELIMINATION            // everyone abstained / timed out
  maxV = max(tally);  top = { p : tally[p] == maxV }
  if cfg.majorityRequired and maxV * 2 <= len(valid): return NO_ELIMINATION
     // ss911 / Sina: only a player with more than 50 percent of the votes goes out; otherwise nobody does (counts toward maxNoElimStreak)
  if len(top) == 1: return ELIMINATE(top[0])
  return resolveTie(top, round = 1)

resolveTie(cands, round):
  if len(cands) == len(alive): return NO_ELIMINATION  // everybody tied (e.g. a vote cycle): a PK would be meaningless
  PK speech: each candidate gives one more clue/defence, PUBLIC, sequential (order is a design choice; no source specifies one)
  PK vote: simultaneous, targets restricted to cands, no self-vote
     voters = (cfg.pkVoters == ALL_ALIVE) ? alive : (alive - cands)
        // default pkVoters = ALL_ALIVE: the most-copied CN classic text says "大家" (everyone) re-votes between the tied pair.
        // NON_TIED (3DM 565026: "the remaining players" vote on the PK players; also the usual Werewolf convention) is the alternative.
        // With a 2-way tie, no self-vote and no abstain, both settings give the same result: each tied player must vote for the other, so their votes cancel.
        // They differ only for 3+ way ties. voters can never be empty here: cands < alive, and any state with T = 2 has already ended the game.
  retally -> unique max: ELIMINATE; still tied: cfg.secondTie
secondTie options: NO_ELIMINATION (default; next description round, same players) | RANDOM_AMONG_TIED | ELIMINATE_ALL_TIED | HOST_DECIDES
```

Sources describe these tie behaviours (all appear in the wild):

- **PK then revote with the tied players as the only targets** (CN classic text as copied by youxiniao and 3DM 565037: everyone re-votes between the two tied players; 3DM 565026: the tied players describe again and the remaining players vote on them; TW app "Who Is Spy": a second vote between two tied players). None of these says what happens on a second tie.
- **Revote once; if tied again, nobody is eliminated and play returns to speaking** (open-source party-box implementation, PR #39: the first tie clears the ballots and all alive players re-vote, the second tie means "nobody out" and the next speaking round).
- **Tie means no elimination; just start the next description round** (Baidu-wiki English text).
- **System picks a random eliminee** (one Chinese app, reported via search snippet, not individually verified).
- **Discussion and persuasion until someone changes their vote** (PTT write-up for a moderated game).
- **Mandatory in-app tie resolution phase** (MASJV: a three-phase vote, no random tie-break).
- **No rule given at all** (most Western apps and several TW app descriptions).

Elimination resolution chain (strictly in this order):

1. Mark the target `eliminated`; they stop speaking and voting.
2. Reveal per `revealOnElimination`.
3. If the target is a `blank` and `blankGuess` is on: run the guess. A correct guess ends the game immediately (outcome per `blankGuessWinner`). A wrong guess changes nothing else.
4. Run the win check (Scoring section). If nobody has won, start the next round.

There are no simultaneous or chain effects beyond this: one elimination per vote, and the only trigger is the blank's guess. Streak guard: after `maxNoElimStreak` (default 2) consecutive no-elimination rounds, force a random elimination among the last top-voted players (design suggestion) so a game cannot loop forever.

## Scoring & win conditions

Definitions after any elimination: `C` civilians alive, `U` undercovers alive, `B` blanks alive, `I = U + B`, `T = C + I`.

**Win check order (run after every elimination and after every blank guess):**

1. Blank guessed correctly -> terminal win for the blank side (see below).
2. `I == 0` -> **civilians win**.
3. Evaluate the configured infiltrator threshold; if met -> **infiltrators win**. Safety net for every threshold: `C == 0` (and `I >= 1`) -> **infiltrators win**. Pure `last3` and large-game `size_based` need it, because with 4 or more infiltrators alive `T <= 3` cannot happen and the game would otherwise never end.
4. Otherwise continue.

Every threshold below includes `I >= 1`, so steps 2 and 3 are mutually exclusive by construction. The order still matters for clarity. Example under `parity`: 3 remain (2 civilians + the last undercover, parity not met because 1 < 2). If the vote hits the undercover, civilians win. If it hits a civilian, it is 1 v 1 and the undercover wins. Under `last3` that 3-player state can never be voted on, because the undercover already won the moment an elimination left only 3 players.

Under `blankModel = separate_winner` (blank is a third party) the check is instead: `U == 0 and B >= 1` -> blank wins; `U == 0 and B == 0` -> civilians win; the threshold is tested with `U >= 1` (an undercover must be alive), which is how the 3DM sources phrase it ("the undercover is alive when 2/3 remain").

**Infiltrator thresholds found in the wild (config key `infiltratorWin`):**

| key | condition | where used | effect for 1 infiltrator |
|---|---|---|---|
| `parity` (project default) | `I >= 1` and `I >= C` | M-Calc (TW, "greater than or equal"), party-box, MASJV, louisvrd, mrwhiteonline and bestpartygames ("equals") | wins at T = 2 (1 civilian + 1 infiltrator) |
| `last3` | `I >= 1` and `T <= 3` | CN classic (Baidu text, youxiniao, 3DM 565037), TW pixnet guide ("3 left and an undercover still alive"), TW app "Who Is Spy" | wins at T = 3 (2 civilians + 1 undercover): one fewer mis-vote than parity. With 2+ infiltrators it triggers later than parity (see Notes) |
| `civ_le_2` | `I >= 1` and `C <= 2` | NetEase game 逆水寒手游, ss911 web game, a Sina blog | same as `last3` for 1 undercover, same as parity for 2, later than parity for 3+ |
| `one_civ` | `I >= 1` and `C <= 1` | Yanstar Undercover ("only 1 Civilian is left"), PTT write-up (2 left with 1 undercover, or 3 left with 2 undercovers) | same as parity for 1 infiltrator; for 2 infiltrators it needs 1 civilian left (harder for infiltrators than parity) |
| `size_based` | `I >= 1` and (starting N < cutoff ? `T <= 2` : `T <= 3`) | 3DM 565026 (cutoff 7); 3DM 565023 (cutoff 6) | small games behave like parity for 1 undercover, large games like `last3` |

Notes on thresholds: a few sources phrase parity as "outnumber" instead of "equal or exceed"; the dominant reading is equal-or-exceed (M-Calc, louisvrd, MASJV, mrwhiteonline, bestpartygames). `last3` is not equivalent to parity when there are 2 or more infiltrators: parity fires at `C <= I`, pure `last3` only at `C <= 3 - I`. Example: 2 civilians vs 2 undercovers (T = 4) has reached parity, but under pure `last3` play continues. With 3 infiltrators alive, `last3` needs 0 civilians left. With 4 or more alive it cannot fire until some are voted out, so the `C == 0` safety net is what ends such a game. The folk "3 left" rule was written with one undercover in mind (Baidu: the number of undercovers "can be chosen arbitrarily" but the rule is not adjusted). Offer `last3OrParity` (fire on either) as a config option for multi-undercover games. The 4-player classic game with `last3` is extremely hard for civilians (one mis-vote loses), which is probably why the 3DM guides switch to a 2-left rule below 6 or 7 players.

**Civilians win:** `I == 0` (every undercover and every blank voted out). Several sources state this explicitly; the Chinese phrasing is "all undercovers and blanks eliminated".

**Blank outcomes, three models (config `blankModel`):**

- `infiltrator_with_guess` (project default; Yanstar, Mr White apps): blank is on the infiltrators' side and counts in `I`. If voted out, one guess at C; correct = immediate win for the blank side (`blankGuessWinner`: `all_infiltrators` vs `blank_only`). Sources split: Yanstar ("Mr. White wins immediately"), bestpartygames ("Mr White wins instantly") and MASJV award the win to Mr. White; mrwhiteonline and louisvrd say all the impostors win at once. Project default `all_infiltrators` (team-consistent scoring); `blank_only` follows the most widely installed app (Yanstar). Wrong guess = blank is simply out, game continues.
- `infiltrator_no_guess` (TW/CN apps, M-Calc): same teams and thresholds, no guess. M-Calc counts blanks with undercovers for the "greater than or equal" check.
- `separate_winner` (CN guides: 3DM 565023 and 565026): the blank is its own side and wins alone if all undercovers are out while the blank is still alive. 3DM 565026 says explicitly that the game ends at that moment with the blank as sole winner. Civilians therefore have to remove the blank before the last undercover goes ("all undercovers and blanks out" is the civilian win in both pages). Thresholds then test for a live undercover (`U >= 1`), not `I`.

**Multi-round play and scoring.** No standard exists. Variants:

- **Yanstar preset** (only first-party numbers): win = civilians 2 points each, Mr. White 6, Undercover 10. A live ranking is shown after each round. It rewards the rarer roles but is not adjusted for role counts (a 12-player game with 3 undercovers pays infiltrators far more in total than civilians).
- **Equalised preset** (project default, design suggestion): civilians win: each civilian +2. Infiltrators win: each winning undercover gets `round(2 * C0 / U0)` where C0 and U0 are the starting counts, so the undercovers' total equals the civilians' total; a winning blank gets an extra 3 (1.5x a civilian's points) on top, so with a blank the infiltrator side's total is slightly higher. A blank who steals the win with a correct guess gets the same as a winning blank. Losing side scores 0. This is the same idea as the CN web-game formula below.
- **CN web-game formula** (ss911, fetched): undercover reward = civilian count x civilian reward / undercover count; civilians get +1 to +4 per win depending on the undercover count, with matching -1 to -4 on a loss; leaving mid-game costs -40 (undercover) or -20 (civilian). The page's own worked example (10 players, 2 undercovers, 10 x 2 / 2 = 10) plugs in the player count rather than the 8 civilians, so its formula and example disagree.
- **Flat**: 1 point to every winner.
- **Social penalties**: losers drink or perform a forfeit (popular in TW/HK/CN groups; the app should offer a non-alcoholic dare list).

**How a multi-round session ends** (config): after N rounds (default N = number of players so each person can be start seat once), or first to a target score (default 20 on the equalised preset), or the host ends it. Ties on score are broken by number of wins as undercover or blank, then by fewer total eliminations as civilian (design suggestion). Between rounds: new pair, re-randomise roles, rotate the starting seat, and avoid giving the same player the undercover role twice in a row if possible (design suggestion).

## Edge cases an engine must handle

Setup and dealing:

- Reject configs where `U + B > floor((N-1)/2)`, or where `C <= 0`, or `U == 0 and B == 0` unless "decoy round" is enabled.
- N outside the allowed range (project 4-12; 3 is a degenerate mode where a single mis-vote loses).
- Word pair validation: both non-empty; not equal after normalising Traditional/Simplified, whitespace, punctuation, case; neither contains the other; not two names for the same thing.
- Pair orientation (which word is C) is randomised per round, so a bank pair never tells players which side is "the normal one".
- Blank must have a `null` word; its card layout must match the others.
- More than one undercover: same U for all (default). Undercovers must not learn each other.
- A player who has not confirmed the deal blocks the start; a disconnect during the deal pauses the game.
- Host being a player: the host phone holds the authoritative state, so it can see everything (accepted trade-off of the P2P design, as in the existing Cheese Thief app).

Speaking:

- Speaking order contains only alive players, is stable inside a round, and rotates between rounds per config.
- A player who uses their own word or character in a clue: enforcement is social; give any alive player a "foul" button and let the group or host confirm. Penalty options: forfeit, lose the clue, or (strict) treated as voted-out. Voice cannot be machine-checked reliably in Cantonese.
- Speaker timeout: skip the turn and record "no clue".
- Eliminated players cannot speak or vote; their own clue history stays visible.
- Duplicate or paraphrased clue: social enforcement only.

Voting:

- Self-vote is invalid. Eliminated players cannot vote or be voted for.
- Ballots are idempotent: re-voting before lock overwrites the previous ballot; ballots are immutable after the reveal.
- Abstain / timeout counts as no ballot; all-abstain = no elimination.
- Top is a tie of 2, 3 or more players; top includes every alive player (cycle) -> no PK.
- A PK can never have zero eligible voters: a tie that includes every alive player skips the PK, and 2 alive players never vote because every threshold has already ended the game at T = 2. Unit-test that this branch is unreachable instead of coding a fallback.
- `majorityRequired` variant (over 50 percent of votes, ss911 / Sina): a plurality without a majority eliminates nobody (literal reading of "only a player with more than 50 percent goes out"). It counts toward `maxNoElimStreak`.
- `pkVoters` differs by source (all alive per the CN classic "大家" wording, the default; non-tied only per 3DM 565026 and the Werewolf convention). Expose it. It only changes outcomes in 3+ way ties, or when tied players may abstain.
- Disconnect during voting: auto-abstain after the timer; if the player is gone for good, host may force-eliminate (this reveals the role per the reveal rule, which affects fairness; see App design notes).

Elimination, reveal, blank guess:

- Reveal scope follows config (role only / role plus word / none). With "none", win check still runs and only "alive/dead" is shown.
- Blank eliminated: guess flow runs before the win check even when the elimination would otherwise end the game with a civilian win (that is exactly when the guess matters).
- Blank guesses the undercover word U -> incorrect (only C counts). Only one guess, no retries.
- Guess matching: normalise Traditional/Simplified, whitespace, punctuation, case; accept bank-defined aliases (e.g. 的士 / 計程車). Because spoken Cantonese and written forms differ, fall back to a host/group "correct / wrong" button instead of strict string equality.
- A wrong guess still leaves the blank eliminated; run the win check afterwards (the blank no longer counts in `I`).
- A correct guess ends the game even if civilians outnumber infiltrators at that moment.
- Blank eliminated when the threshold is already met cannot happen (the game would have ended earlier).

Win checks:

- Order is blank guess, then `I == 0`, then threshold (plus the `C == 0` safety net), then continue.
- After the last undercover is voted out but a blank remains: under `infiltrator_*` models the game continues (blank counts in `I`); under `separate_winner` the blank wins immediately.
- `parity` uses `>=`; `last3` uses `T <= 3`; every threshold also requires `I >= 1`. All five thresholds in the table, plus `last3OrParity`, must be unit-tested for N = 4..12 with each valid role split. Include the multi-infiltrator cases where pure `last3` and parity disagree (e.g. 2C v 2U, or 8/3/1 at N = 12 where `T <= 3` is unreachable while 4 infiltrators live).
- Config where the threshold is already met at deal time must be rejected, e.g. 4 players with 1 undercover and 1 blank under parity.
- Infinite loops: repeated ties; enforce `maxNoElimStreak`.

Rounds and sessions:

- Between rounds, word pairs must not repeat within a session.
- Starting-seat rotation and role re-randomisation; optional anti-repeat for the undercover role.
- Aborted round (host cancels, or too many players leave): no points.
- A player leaving mid-game: keep them "alive but muted, auto-abstain" until the host resolves it; if they must be removed, either force-eliminate with the configured reveal or void the round.
- Late joiners are not allowed mid-round.

## Common variants

Mark: [HK/TW/CN] popular in Cantonese/Chinese-speaking groups, [West] Western apps, [JP] Japanese Word Wolf, [rare] unverified or niche.

- **Referee plus paper slips, no blank** [HK/TW/CN, most common]. Moderator knows everything; players do not.
- **Add a 白板** [HK/TW/CN, very common]. 0 or 1 blank; many guides suggest it only from 5-6 players up.
- **Blank guesses the civilian word when voted out** [West; common in apps, less common in written CN/TW rules]. Correct guess = the blank wins.
- **Blank as a third faction** [CN]. Wins alone if all undercovers are gone while the blank lives.
- **Tie handling**: PK speeches then revote among the tied [CN, popular]; within that, who votes in the PK differs (everyone, per the classic text, vs only the non-tied players, per 3DM 565026); tie means no elimination [Baidu English text, apps]; revote once then no elimination [party-box]; random pick [some apps]; discuss until the vote changes [moderated groups, PTT].
- **Majority vote**: only a player with more than 50 percent of the votes is eliminated [ss911 / Sina CN rules]; plurality is the norm elsewhere.
- **Elimination reveal**: role only [Yanstar, mrwhiteonline, PTT; most]; role plus word [some Western apps, e.g. playpartyplay "their word is revealed"]; moderator only says "civilian" or "undercover" and never the words [PTT write-up, HK/TW style]; no reveal at all [rare, hardcore].
- **Win threshold**: parity [modern apps]; last 3 [CN classic, TW pixnet]; last 3 or parity, whichever first [project option for multi-undercover games]; civilians <= 2 [NetEase, ss911, Sina]; one civilian left [Yanstar, PTT write-up]; size-based [3DM guides].
- **Mr. White's correct guess**: Mr. White alone wins [Yanstar, bestpartygames, MASJV] vs all impostors win [mrwhiteonline, louisvrd].
- **Mr. White may not speak first** [house rule, unverified in any fetched source; mrwhiteonline explicitly lets any player start].
- **Several description rounds before one vote** [TW app].
- **Voting style**: everyone taps privately [apps]; host tallies [apps]; simultaneous pointing [physical]; "turnstile" voting (players vote one at a time to avoid herd voting) in a TW app [rare].
- **Clue form**: one sentence [HK/TW/CN standard]; one word or short phrase [West].
- **Extra speaking constraints**: must use song lyrics, no repetition of an earlier clue, no translation into another language [house rules, popular].
- **Round cap**: if undercover/blank is still alive after n rounds (often 3), they win [reported in a Chinese write-up; unverified source].
- **Special roles from related games**: a "madman" (狂人) who wins with the wolf side without knowing the other word [JP app variants, rare in HK; not part of the base Word Wolf rules on Japanese Wikipedia, unverified]; "goddess" tie-breaker role in one open-source variant [rare].
- **Decoy round**: everyone gets the same word and nobody is undercover [rare; known in Word Wolf culture; unverified for Undercover].
- **Hell mode** [TW app, details unknown]. The iOS app "Who's the Spy? Party Game" (id6757357535) added a "地獄模式" in v1.0.4 and a beta "turnstile" vote in v1.1.9 (current v1.4.1 when checked); no rule description is public.
- **Penalties / drinking for losers** [HK/TW/CN, very popular socially]; app should provide a mild dare list.
- **Word Wolf style** [JP]: timed free discussion (3-5 minutes for small groups) instead of round-robin clues, one vote, and a "reversal" guess for the wolf. Useful as a future sibling mode.

## App design notes

**Config object (suggested):**

```json
{
  "players": 8, "civilians": 6, "undercovers": 2, "blanks": 0,
  "infiltratorWin": "parity",
  "blankModel": "infiltrator_with_guess",
  "blankGuessWinner": "all_infiltrators",
  "revealOnElimination": "role",
  "tie": { "pk": true, "pkVoters": "ALL_ALIVE", "secondTie": "NO_ELIMINATION", "maxNoElimStreak": 2 },
  "vote": { "visibility": "open_after_lock", "allowAbstain": true, "majorityRequired": false },
  "speaking": { "start": "random_not_blank", "rotate": "next_alive", "timerSec": 25, "clue": "sentence" },
  "scoring": "equalised"
}
```

**What must stay private**

- Each player's word and the blank placeholder. All role information. The pair's orientation (which word is C). The un-revealed words of eliminated players (depending on the reveal rule).
- Vote ballots while the vote is open.
- The host UI hides the role/word table by default behind an explicit "peek" toggle, with an optional "I am playing, hide everything" mode. In a P2P design the host phone is still authoritative, so a technically minded host could inspect memory; same trade-off already accepted for Cheese Thief.

**Needs a narrator?** No. It is fully automatable on phones; a narrator is purely atmosphere. If the host phone narrates in Cantonese, keep the lines role-neutral: start of deal, whose turn, "time's up", the 3-2-1 vote countdown, the elimination announcement, and the winner. Never use different phrasing that depends on the viewer's role. The blank's guess should be spoken by the player, not by TTS.

**Fully automatable:** role/word dealing, randomised pair orientation, speaking order and timers, vote collection and tallying, tie flow, win checks, scoring, history. **Needs humans:** judging clue legality (own word, repetition, translation) and judging the blank's spoken guess. Give the host dashboard a one-tap "correct / wrong" for the guess and a "foul" workflow.

**Anti-tell concerns (no night phase, so the tells are about the phone):**

- Deal screen timing: everyone should hold the card for a similar duration, and hold-to-reveal plus auto-hide prevents neighbours reading it.
- The blank's screen must be pixel-identical in layout, only the text differs (empty or a neutral placeholder), so a peeking neighbour learns nothing from layout.
- Re-viewing a forgotten word is a known pain (apps often forbid it, one app even says the word cannot be reviewed). If allowed, make it available to everyone and do not log it on the host dashboard or show "who peeked".
- No vibration or sound at deal or vote that differs by role. No role-dependent animations.
- Avoid word length or font size hints that differ by role (word lengths differ anyway; consider fixed font and truncation).
- A clue log (public list of who said what each round, typed by the speaker or by one scribe) helps players remember earlier clues. If clues are typed, hide them until all are in, to stop copying and copy-then-vary tells.

**Host-moderator dashboard (when a human wants to run it):** roster with alive/eliminated, current speaker and timer, "skip speaker" and "foul" controls, live vote status ("12 of 15 locked") without showing choices, tally and tie flow controls, reveal controls, the blank-guess judge button, round log, score board, and an emergency "force eliminate disconnected player" action (document that it reveals a role).

**One shared phone:**

- Deal by pass-the-phone: "Player N, tap to see your word" -> hold -> "Hand to next" interstitial with a neutral screen. The host/owner sees no more than the others.
- Speaking order is a big "now speaking" screen with a timer.
- Voting: either (a) turnstile private voting (each player taps a vote then hands the phone on), (b) all point on 3-2-1 and one person enters the tally, or (c) a shared "vote with me" screen. Option (a) has the best privacy but slower flow; some TW apps offer host-tally and private voting side by side.
- Elimination, blank guess and scoring happen on the same screen.

**Word bank design (affects fun more than rules):** two words of the same category and same part of speech; neither contains the other; not two names for the same thing; understandable to everyone; Cantonese colloquial wording for HK groups (e.g. 的士 vs 巴士 style pairs, local food, MTR, places in Japan for the travelling use case); store Traditional primary text, optional Simplified/jyutping aliases; store an `aliases` list per word for guess matching; easy/medium/hard by semantic distance.

**Suggested implementation priority:** (1) classic civilians+undercover, parity threshold with the `C == 0` safety net, PK once then no-elim; (2) blank with guess; (3) all five thresholds plus `last3OrParity` (allowed `infiltratorWin` values: `parity`, `last3`, `last3OrParity`, `civ_le_2`, `one_civ`, `size_based`), and the three blank models as config; (4) scoring presets; (5) shared-phone mode; (6) typed-clue mode and clue log.

## Sources

Primary-ish / official or semi-official:

- https://www.yanstarstudio.com/undercover-how-to-play (Yanstar Undercover rules, Mr. White guess, scoring 2/6/10, win when 1 civilian left)
- https://www.yanstarstudio.com/fr/undercover-how-to-play (French rules page, role reveal after elimination, random starter)
- https://apps.apple.com/sg/app/undercover-word-party-game/id946882449 (Yanstar Studio OU app listing, v6.3.6 when checked on 2026-10-03: reveals eliminated role, real-time ranking after each round)
- https://apps.apple.com/tw/app/%E8%AA%B0%E6%98%AF%E8%87%A5%E5%BA%95-who-is-spy/id1157927944 (TW app v1.04, 2019-02-26: 3-10 players, 3-5 = 1 / 6-9 = 2 / 10 = 3 undercovers, last-3 rule, second vote on a two-way tie, 白板 option)
- https://apps.apple.com/app/id6757357535 ("Who's the Spy? Party Game", v1.4.1: host-tally vs private vote, custom order, hell mode since v1.0.4, turnstile vote beta since v1.1.9)
- https://apps.apple.com/app/id6553973564 (TW app: 3-16 players, whiteboard mode)
- https://apps.apple.com/us/app/-/id1640417332 (誰是臥底(香港版), Cantonese bank, 3-20 players, scoring)

Chinese-language rule write-ups and implementations:

- https://m-calc.com/content/undercover-rules-vocabulary-guide (TW guide: setup table, parity win rule, blank, deal flow)
- https://cellus709.pixnet.net/blog/post/30137785 (TW guide: undercover counts 3-6/7-10/11-15/16-20 = 1/2/3/4; undercover wins if still alive when 3 players remain, i.e. `last3`)
- https://www.ptt.cc/bbs/TurtleSoup/M.1465135687.A.60C.html (PTT: 6-player example, role announced but not words, win thresholds)
- https://www.mofang.com.tw/comment/id1157927944/153 (TW app review: several description rounds, no re-view of the word)
- https://games.sk5s.com/whereisspy/ (找出臥底, 3-16 players, blank option)
- https://www.ss911.cn/Pages/GameRules5.shtml (CN web game: counts by size, >50 percent vote, civilians <= 2, scoring formula and quit penalty)
- https://www.youxiniao.com/news/gonglve/2508408.html (CN rules: 1-undercover example, word-pair rules, tie head-to-head vote)
- https://shouyou.3dmgame.com/gl/565023.html (CN: PK on ties, win rules with blank and size thresholds)
- https://shouyou.3dmgame.com/gl/565026.html (CN: blank wins if all undercovers out while alive)
- https://shouyou.3dmgame.com/gl/565037.html (CN: flow, PK, last 3)
- https://zhidao.baidu.com/question/580879615 and https://zhidao.baidu.com/question/2208074411255984188.html (blank win condition)
- http://www.jy135.com/yule/277142.html (CN blank rules; page encoding is damaged, only partly readable, so used only as weak corroboration)
- https://blog.csdn.net/weixin_43931042/article/details/84879974 (basic rule, last 3)
- https://blog.sina.com.cn/s/blog_b96255ec0101fl47.html (counts by size 6-8/9-12/13-16/17-20 = 1/2/3/4, civilians <= 2 rule, >50 percent elimination vote)
- https://www.9game.cn/nishuihan1/8356661.html (NetEase game: civilians <= 2)
- https://lieyunpro.com/archives/51023 (history: 捉鬼 to 誰是臥底, app types)
- https://sspai.com/post/23842 (app: random first speaker)
- https://baike.baidu.com/en/item/Who%20is%20undercover/1473914 (Baidu English text: basic rules, tie leads to next round, last 3)
- https://github.com/MrXiao-9527/party-box/pull/39 (digital implementation: PK revote then no elimination, parity win)

Western/open-source Mr. White implementations:

- https://www.bestpartygames.net/games/undercover/undercover
- https://mrwhiteonline.com/how-to-play/
- https://mrwhiteonline.com/undercover-game/
- https://mrwhiteonline.com/
- https://www.playpartyplay.com/undercover
- https://github.com/antebrl/undercover-word-game
- https://github.com/MASJV/undercover-game (default counts by size, tie-resolution phase)
- https://github.com/louisvrd/undercover (role cap, guess normalisation, equal-or-exceed win)
- https://jeuxvideal.fr/undercover-jeu-guide/ (1 undercover up to 6 players, 2 from 7)

Japanese sibling game (Word Wolf) and analogies:

- https://ja.wikipedia.org/wiki/ワードウルフ (designer 川崎晋, 2003 concept, 2012 publication, Gentosha 2020 box, single vote plus optional wolf guess)
- https://boku-boardgame.net/wordwolf
- https://kaitoo.net/game/wordwolf-how-many-people/
- https://note.com/m_dabyss/n/nb741cd926bf9
- https://osaka-jinro-lab.com/article/word-wolf/
- https://asobi.kids/guide/word-wolf/
- https://bodoge.hoobby.net/games/word-wolf
- https://github.com/gangtao/AgentHowl/issues/50 and https://www.langrensha.net/strategy/2021061101.html (PK revote voter-eligibility ambiguity in Werewolf, used as an analogy for `pkVoters`)

Not individually verifiable (blocked or reached only through search snippets): Baidu Baike Chinese article, Zhihu answers, Douban notes, ximalaya Q&A pages (one is behind a captcha and was not bypassed). Treat claims attributed to "reported" in the text accordingly.

## Verification

Adversarial fact-check run on 2026-10-03 UTC. Web search was unavailable for this pass, so every check below is a direct fetch of the named page. Where possible I used pages the original draft did not cite (Japanese Wikipedia, Sina blog, bestpartygames, playpartyplay, App Store listings) and re-read the cited pages to check they were reported accurately.

**Checked and confirmed (no change needed):**

- Yanstar Undercover rules page (EN and FR): 3-20 players, random first speaker, a word or short phrase, Mr. White gets one guess when voted out and "wins immediately" if right, civilians win when all Undercovers and Mr. Whites are out, infiltrators win when only 1 civilian is left, scoring 2 / 6 / 10. App listing (Yanstar Studio OU, v6.3.6) reveals the eliminated player's role.
- M-Calc: setup table (4 = 3/1/0, no blank; 5-6 = 1 undercover; 7-11 = 2; 12-16 = 3; blank 0-1), win rule infiltrators >= civilians, ban on any character of your own word, random starter, then clockwise or counter-clockwise.
- PTT write-up: 4/2 split at 6 players, moderator announces role only, ties broken by more persuasion, undercovers win with 1 civilian left (`one_civ`).
- TW app "Who Is Spy": 3-10 players, last-3 rule, 白板 option. ss911: counts 6-8/9-12/13-15/16-20, >50 percent vote, civilians <= 2 rule, scoring formula and quit penalties.
- 3DM 565023 / 565026: size-based thresholds with cutoffs 6 and 7; blank wins alone if all undercovers are out while it lives; civilians need all undercovers and blanks out.
- mrwhiteonline and louisvrd: correct Mr. White guess makes all impostors win; parity is equal-or-exceed; louisvrd caps special roles at `(players - 1) // 2` and normalises case, accents and punctuation when matching guesses.
- MASJV defaults by size and its "no random tie-break" voting; party-box PR #39 (revote once, second tie means nobody out, parity rule).
- Word Wolf minority counts by size (kaitoo); Word Wolf is a single vote with an optional wolf guess (Japanese Wikipedia). Baidu English: evolved from 捉鬼, renamed by Happy Camp, ties go to the next round, "three remain including the undercover" means the undercover wins.
- No night phase, so wake order does not apply. All mis-vote numbers in the setup table equal `C - I` and are arithmetically correct.

**Errors found and fixed:**

1. **`last3` vs parity (outcome-changing).** The draft claimed `last3` differs from parity only with exactly one infiltrator and that mis-vote counts change by -1 with one infiltrator "and nothing otherwise". Wrong. Pure `last3` (`T <= 3`) fires *later* than parity when there are 2 or more infiltrators: 2C v 2U is parity but play continues. The change is `2I - 3` mis-votes. With 4 or more infiltrators alive, `T <= 3` is unreachable and the game could never end. Fixed the notation paragraph and the threshold notes, added a universal `C == 0` safety net to the win check, and added `last3OrParity` as a config option.
2. **Win-check example (outcome-changing).** The draft's example ("3 remain: 2 civilians + last undercover, vote hits undercover -> civilians win, not '3 left'") describes a state that cannot exist under `last3`: the undercover has already won when 3 remain. Rewrote the example under parity. Made `I >= 1` explicit in every threshold (it was missing from `size_based`, so "steps 2 and 3 can never both be true" was not guaranteed).
3. **PK voter default (tie resolution).** The draft set `pkVoters = NON_TIED`, claiming it "matches the CN PK wording". The most-copied CN classic text (youxiniao, 3DM 565037) says everyone (大家) re-votes between the tied pair; only 3DM 565026 says "the remaining players". Changed the default to `ALL_ALIVE` in the pseudo-code and the config, and kept `NON_TIED` as a variant. I also noted that the two give identical results for a 2-way tie with no self-vote and no abstain.
4. **Unreachable PK fallback.** The draft's "voters is empty (e.g. 2 alive both tied)" branch and the matching edge case cannot happen: every threshold ends the game at T = 2, and full-table ties skip the PK. Replaced both with an assertion and a unit-test note.
5. **`majorityRequired` pseudo-code was broken.** When nobody had a majority, it fed a single top player into `resolveTie`, so the PK eliminated that player anyway. Changed to the literal ss911/Sina reading: no majority, no elimination, and it counts toward the no-elimination streak.
6. **Sources misreported.** Pixnet was annotated "win when 2 civilians remain"; it actually uses "3 left with an undercover alive" (`last3`). Corrected the annotation and added pixnet to the `last3` row. "Word Wolf-like apps" was listed as using parity; Word Wolf is a single vote with no elimination rounds, so I removed it. Added Sina as a second `civ_le_2` source and bestpartygames as a parity ("equals") source.
7. **Mr. White guess winner.** Added bestpartygames and MASJV to the "Mr. White alone wins" side (draft cited only Yanstar), and recorded the split under Common variants.
8. **Clue bans overstated.** The draft listed "translate into another language", "repeat a previous clue" and "state the character count" as hard bans. Only "never say your own word" (plus "no character of it" in CN/TW) is universal. The others are now labelled widespread house rules. Added the CN classic rule that an undercover must not give an unrelated clue just to hide.
9. **"Never start on the blank" presented as common practice.** No fetched source has this rule, and mrwhiteonline explicitly lets anyone start. It stays as the project default but is now labelled a house rule.
10. **Rules of thumb "all sources agree".** MASJV's own default table breaks the strict-majority cap at 3-4 players. Reworded to "most sources" and added a warning.
11. **Unverified attributions removed or replaced.** "Yanstar suggests 1-2 Mr. Whites" (not on Yanstar's pages) was replaced with playpartyplay's 0-2. "Yanstar-style guides say 6-10 / other apps 5-8" was replaced with bestpartygames' 6-12 and the Word Wolf ~9 cap. The player-range row now cites the actual app ranges and Baidu's n >= 3.
12. **Identity / history.** Happy Camp date is now anchored to Baidu's episode table (earliest 2012-09-29). Word Wolf history corrected to "conceived 2003, published Oct 2012, Gentosha box 2020-04-25". I dropped the romanisation "Kawasaki Susumu" because the reading of 川崎晋 could not be confirmed.
13. **Scoring.** The equalised preset's "same total for both sides" holds only without a blank, so I clarified it. The ss911 formula is now marked as fetched, with a note that its worked example uses the player count instead of the civilian count.
14. **Version numbers added** where they were checked: Yanstar app v6.3.6; TW "Who Is Spy" v1.04 (2019-02-26); "Who's the Spy? Party Game" v1.4.1, hell mode from v1.0.4, turnstile vote beta from v1.1.9.

**Still unverified:** the random-eliminee app, the "round cap after 3 rounds" variant, the decoy round, the madman role, the reading of 川崎晋, the exact first Happy Camp air date, and any Hong Kong-specific house rules beyond the 誰是臥底(香港版) listing (3-20 players, Cantonese bank, scoring; its win rules are not published). Baidu Baike (Chinese), Zhihu and Chinese Wikipedia could not be fetched (403/404).
