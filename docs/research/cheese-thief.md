# Cheese Thief — rules reference

> Paraphrased for engine implementation. Not a copy of the official rulebook.


## Identity

| Field | Value |
|---|---|
| EN name | Cheese Thief |
| 繁中 name(s) | 奶酪大盜 (the title in the body text of the 2020 HK/TW box and on the Jolly Thinkers shop page; the box-front logo itself is drawn as 奶酪大盗). Marketing copy also writes 乳酪大盜 (e.g. HK retailer WOB Games). Spoken HK Cantonese: 芝士大盜 (recommended for the UI and narration) [I]. 起司大盜 would be the natural Taiwanese rendering (起司 = cheese in TW) but is not printed on any box [I, unverified]. 簡中: 奶酪大盗 (2018 crowdfunded edition). |
| Other-language names | DE Käsedieb (printed on the trilingual CN/EN/DE box, not a separate German edition) · FR **CHEESENAPPiNG!** (Don't Panic Games, 2023; roles Voleur de Fromage / Dormeur / Complice / Souris Émissaire) · JP チーズは誰が食べた？ (JELLY JELLY GAMES, released 2023-10-27; roles チーズドロボー / ねぼすけ / フォロワー / おちょうしもの; "チーズ泥棒" is only the informal pre-localisation rendering) · KR 누가 치즈를 훔쳤을까? (2021) · TH ชีสหนูอยู่ไหน (2023) · Nordic edition 2024 keeps the English title |
| Players | 4–8. The first crowdfunded Chinese release (2018) was advertised as 5–8 (confirmed on the Modian campaign page); the 2020 Jolly Thinkers rulebook adds a 4-player two-dice variant. |
| Best count | BGG community poll (16 votes): best 6–8, recommended 5–8. Weight 1.17 / 5 (18 votes). Rating about 6.97 from 1,050 ratings (checked 2026-10-03 UTC). |
| Length / age | 10–15 minutes (box says 10'), age 8+. One night, one discussion, one vote. No elimination. |
| Designer | Dongxu Li (李東旭 / 李东旭; the 2018 crowdfunding page names him as 东旭, surname from BGG) |
| Publisher | Jolly Thinkers' Learning Centre Ltd. (空中棋園, Hong Kong), 2020. The game was first self-published in 2018 through a Modian (mainland China) crowdfunding campaign run by the DOUBLE KILL team (Double Kill Games, whose logo is on the 2018 box; the campaign page describes them as running a board-game bar in Sydney; they are also the mainland agent on the 2020 box); the campaign succeeded on 2018-08-07 12:00 UTC (20:00 UTC+8), raising ¥20,920 against a ¥6,666 goal from 193 backers. Taiwan importer on the 2020 box: 黑傑桌上遊戲創意工作室 (HateJob). Licensed editions per BGG: Korean 2021 (Popcorn Games + sternenschimmermeer, both Korean), French 2023 (Don't Panic Games), Japanese 2023 (JELLY JELLY GAMES), Thai 2023, Nordic 2024 (Lautapelit.fi; DA/EN/FI/NO/SV). Nominated for the 2024 Guldbrikken (Best Parlor Game). |
| Artists | Moyo (illustration); Ming Li (graphic design, per the French credits and the HK box); 別府さい (Sai Beppu) on the Japanese edition |
| Official companion | Free "Cheese Thief Moderator" app by Laurin-Neil Dorra / LaudoStudio (App Store seller name "Laurin Dorra"), iOS and Android, that reads the night script aloud. Current version **1.1.12** on both stores (iOS released 2025-11-13, requires iOS 13.0 or later; Google Play "updated on" 2025-11-08), checked 2026-10-03 UTC. Voice languages: **English and German only** (no Chinese, no Cantonese). Settings: language and countdown speed. History: 1.0.4 first iOS release 2020-09-07; 1.1.0 new EN/DE voices 2024-01-10; 1.1.2 background music + volume slider 2024-01-17; 1.1.5 fixed the off-by-one player-count script bug 2024-05-23; 1.1.12 fixed audio dropouts. |
| Physical components | 8 character cards (1 Cheese Thief, 7 Sleepyhead) + 1 Fall Mouse card (9 cards total), 8 dice cups (tree-stump shaped), 8 six-sided dice, 1 foam cheese token, rulebooks (separate 繁中 / English / German booklets in the HK/TW box). The 2018 crowdfunded box had only 8 role cards, 8 dice, 8 cups and 1 cheese. |
| What the app must replace | (1) Role cards. (2) Cup + die: a secret roll that other players can later peek at. (3) The cheese token that is physically taken and hidden on the thief's body. (4) The moderator (a player or the app), who calls the hours. (5) Eyes-open co-presence: seeing who else is awake. (6) The hand-touch / eye-contact ritual for choosing Followers. (7) Simultaneous finger-pointing vote. (8) Card reveal of the top-voted player(s). |

### Provenance and confidence tags

Confidence tags used below: **[O]** official rulebook content (English rulebook excerpt, or a full translation of it, cross-checked against designer quotes); **[D]** ruling by the designer / publisher account on BoardGameGeek; **[C]** community write-up, agreeing across at least two independent sources; **[I]** my inference or recommendation for the engine (not a rule).

The BGG rulebook PDFs (EN/CN/DE, file page 208253 and siblings) sit behind a login and were not downloaded. The rules below are rebuilt from (a) the publisher's verbatim rulebook quotes in BGG threads (account JollyThinkers) and the designer's rulings (BGG account of Dongxu Li), (b) the **official French rulebook** (Don't Panic Games, publicly downloadable, a full translation of the Jolly Thinkers rulebook: components, night script, 5/6/7/8-player Follower scripts, vote, 4-player variant, Fall Mouse), (c) a fan Japanese translation of the English rulebook (hackmd; useful but contains one mistranslation, see 4p below, and predates the 2023 4p amendment), (d) the 2018 Modian crowdfunding page (original 5–8 player rules) and the 2018 promo skill sheet, (e) the English rulebook's front matter on a retailer page, and (f) Traditional Chinese write-ups of the Chinese rulebook. The former open question on the 4-player solo peek is now settled by the French rulebook; see "Open questions" at the end of the Edge cases section for what remains.

## Roles

Cards dealt: one Cheese Thief, the rest Sleepyheads; optionally one Sleepyhead is swapped for the Fall Mouse (6–8 players only). The Follower is **not a card**: it is a status given to a player during the night.

| id | EN | 繁中 | team | ability (precise) | acts at night? when? |
|---|---|---|---|---|---|
| `cheese-thief` | Cheese Thief | 奶酪大盜 (UI: 芝士大盜) | thief team | Exactly one per game. At its wake hour it must take the cheese from the table and hide it, even if other players are awake and watching. It never gets the peek. In the 4-player variant it may wake at both of its dice's hours (once if they match) and chooses at which one to steal [O][D]. In 6–8 players it chooses the Followers after hour 6. In 5 players it chooses the Follower among the witnesses when several watch the theft. Wins unless it is among the top-voted players (and no Fall Mouse is). [O][D] | Yes. At hour = its die (5–8p). 4p: both dice's hours. 6–8p: also the Follower step after hour 6. |
| `sleepyhead` | Sleepyhead | 貪睡鼠 (printed on the HK/TW box; 2018 mainland edition: 嗜睡老鼠; Cantonese: 貪瞓鼠) | sleepyheads | No power besides one optional peek. At its wake hour, if it is the only player awake, it may look at exactly one die of exactly one other player, then covers it again (5–8p only; **never in 4p** [O]). If anyone else is awake it may do nothing except acknowledge them silently. Wins if the Cheese Thief is among the top-voted players. [O] | Yes. At hour = its die. 4p: at the one hour it chose out of its two dice. |
| `follower` | Follower | 共犯 (printed on the HK/TW box; 2018 mainland edition: 背叛者) | thief team (status overlay) | A Sleepyhead (or the Fall Mouse) who has been recruited. A recruited Sleepyhead wins and loses together with the Thief, and can be voted out without hurting the thief team. A recruited Fall Mouse does **not** join the thief team's win (see `fall-mouse`). Cannot vote for itself (nobody can). During the night it must not pass on any dice information. 5p: a Sleepyhead awake at the thief's hour becomes one (the thief points at one if several). 6p: 1, chosen by touch after hour 6, mutual recognition. 7p: 2, chosen by touch, the two know each other but not the thief. 8p: 2, mutual recognition among all three. 4p: none. [O][D] | Only in the recruitment moment: 5p during the thief's hour; 6–8p in the extra step after hour 6. Otherwise acts as a Sleepyhead at its own hour. |
| `fall-mouse` | Fall Mouse (FR "Souris Émissaire" = scapegoat mouse) | 背鍋鼠 (printed in the HK/TW component list; alt. 替罪鼠 unverified; 2018 promo name "Blanco") | solo | Optional, 6–8 players only. Replaces one Sleepyhead card and obeys every Sleepyhead rule (including the peek), but its goal is to be among the top-voted players. If it is, it wins alone and nobody else wins, regardless of who else is revealed with it. If it was chosen as a Follower it still wins only by being top-voted, never by the thief team winning, and never with the Sleepyheads (the 2018 promo sheet calls it an independent third party even when recruited). [O][D] | Yes, exactly like a Sleepyhead. |
| `cat` / `dog` (promo) | Cat "Sherlock" / Dog "Watson" promo cards (from the 2018 mainland crowdfunding; the third promo, "Blanco", became the Fall Mouse) | 貓 / 狗 | sleepyheads (can be recruited) | Day-phase reveal abilities, per the designer's BGG answer and the 2018 promo skill sheet (v1.0): Sherlock (cat) reveals its card and secretly checks one player's die; Watson (dog) reveals its card and makes one chosen player commit their vote first. The sheet recommends them for 7–8 players and at most one promo at a time. Not in the retail box; recommend not implementing in v1. [D] | No (day phase only) |

Team summary for scoring: **Sleepyheads** = Sleepyheads who are not Followers and not the Fall Mouse. **Thief team** = Thief + Followers, excluding a Fall Mouse that was recruited (it stays solo). **Solo** = Fall Mouse.

## Setup by player count

Hours called are always 1–6 and the die is always a d6, so with one die each (5–8p) each hour has on average n/6 wakers. In 4p it is lower (about 0.8 per hour: three Sleepyheads wake once, the Thief once or twice).

| Players | Cards (1 Thief + …) | Dice per player | Followers | How Followers arise | Fall Mouse | Status |
|---|---|---|---|---|---|---|
| 4 | 3 Sleepyheads | **2** | 0 | none (rulebook: "no Followers") | not allowed | Official variant [O]; no solo peek [O]; tie rule amended 2023-10-09 [D] |
| 5 | 4 Sleepyheads | 1 | 0 or 1 | Witness rule: a Sleepyhead awake at the thief's hour is recruited. If two or more witnesses, thief points at one. If the thief wakes alone, no Follower exists this game. | not allowed | Official [O] |
| 6 | 5 Sleepyheads (or 4 + Fall Mouse) | 1 | exactly 1 | Step after hour 6: thief touches one hand; mutual recognition (they see each other). Not tied to who woke with the thief. | allowed | Official [O][D] |
| 7 | 6 Sleepyheads (or 5 + Fall Mouse) | 1 | exactly 2 | Step after hour 6: thief touches two hands; the Followers learn each other, **not** the thief. The thief learns them. | allowed | Official [O] |
| 8 | 7 Sleepyheads (or 6 + Fall Mouse) | 1 | exactly 2 | Step after hour 6: thief touches two hands; all three see each other. | allowed | Official [O] |
| 9–10 | — | — | — | Not supported by the publisher. Only suggestion found: bigger dice (d8/d10) so wake groups stay small (BGG, untested). | — | Unofficial; offer as "experimental" or leave out |
| 3 or fewer | — | — | — | Not supported. | — | — |

Notes:
- The deck size equals the player count. The Fall Mouse replaces a Sleepyhead rather than being added. [O]
- Dice are rolled once, privately, with no re-roll (the rulebook says to slide the cup without changing the result) [O]. The foam cheese starts on the table. The die stays under the cup so other players can later peek. [O]
- In 6–8 players the Follower is picked from **all** other players, not just those who woke with the thief. A thief that woke alone still gets Followers. [D]
- Probabilities for 1-die counts (n−1 other players each match a given hour with p = 1/6): P(thief alone) = 0.482 / 0.402 / 0.335 / 0.279 for n = 5 / 6 / 7 / 8. P(≥1 Sleepyhead awake with the thief) = 0.518 / 0.598 / 0.665 / 0.721. In 5p this last number is the chance a Follower exists. [I]

## Procedure

Legend: PUBLIC = everyone knows. PRIVATE = only the named player(s). Official hour windows are 10 seconds; the follower steps use 5-second countdowns [O, EN/FR rulebook]. The official app lets you change the countdown speed (app setting, not a rule).

1. **Choose the moderator.** A player (who also plays, with their own die and role) or the app/host phone. All players, moderator included, keep eyes closed during the night. PUBLIC.
2. **Build and deal the deck.** n cards: 1 Thief + (n−1) Sleepyheads; with the Fall Mouse option one Sleepyhead is replaced. Shuffle, deal one face down to each player. Each player looks at their own card. PRIVATE per player. Simultaneous.
3. **Roll.** Each player rolls their die under their cup (4p: two dice), checks the number secretly, and slides the cup toward the cheese so any player can later reach it. The number is that player's wake hour. PRIVATE per player. Simultaneous. No re-rolls. [O]
   - 4p: each Sleepyhead must wake exactly once, at one of its two numbers [O]; the engine asks for the choice up front (deciding in advance is equivalent to deciding at wake time because sleepers receive no information [I]). The Thief keeps both numbers and may wake at both (once if they match) [O].
4. **Cheese on the table.** The cheese token sits in the centre, reachable by all. PUBLIC.
5. **Night begins.** The moderator tells everyone to sleep. PUBLIC. Sequential from here on.
6. **Hours 1 to 6**, strictly in order, each followed by the same fixed window whether or not anyone has that number (see Night order). At each hour the players holding that number open their eyes, act per their role, then close their eyes when told. What is seen is PRIVATE to the players awake at that hour.
7. **Recruitment step after hour 6 (6, 7, 8 players only).** Everyone holds out a hand; the thief secretly picks Followers; Followers are told. Detail in Night order. PRIVATE to the Thief and the recruited.
8. **Dawn.** Everyone opens their eyes; it is announced that the cheese has been stolen. PUBLIC.
9. **Discussion.** Free-form and simultaneous. No required order and no official time limit (designer suggests 5–10 minutes [D]). Players may say anything true or false about their die, wake hour, who was awake and whether the cheese was there. They may **not** show their die or flip their role card. [O] Followers keep the thief team's goal and typically lie in concert.
10. **Vote.** When the group decides the discussion is done, the moderator counts down (the script is "Who is the Cheese Thief? 3, 2, 1, vote") and every player points at one *other* player at the same instant. Everyone must vote (a player may point strategically, not only at whom they believe), nobody votes for themselves, no abstaining. [O][D]
11. **Reveal.** The player(s) with the most votes turn their role card face up. Ties reveal all tied players. PUBLIC. [O]
12. **Resolve.** Apply the win rules (see Voting & resolution). Optionally the table reveals all cards and dice afterwards for debrief (not in the rules, but customary). [I]
13. **Next round.** There is no carry-over: re-deal, re-roll. The game is exactly one night and one vote.

## Night order

**Hour loop (all counts).** For h = 1, 2, 3, 4, 5, 6: let W(h) = the players awake at hour h.
- 5–8p: W(h) = players whose die equals h.
- 4p: W(h) = Sleepyheads whose chosen hour is h, plus the Thief if either of its dice is h. (The rule text says the Thief *can* wake at both hours; whether it may stay asleep at one of them is not ruled. Default: it is woken at both; see open question 6.)

Every hour is called and every window runs its full length, including hours where W(h) is empty. This is an anti-tell requirement for the app. [I]

| Case at hour h | What the awake players do / learn | Notes |
|---|---|---|
| W(h) empty | Nothing. | Window still elapses. |
| One Sleepyhead alone (5–8p) | Sees that everyone else is asleep. Sees whether the cheese is still on the table. May peek at **one** die of **one** other player (cup lifted then replaced), or do nothing. | Target can be anyone, including the thief. The target is asleep and is never told. [I] |
| One Sleepyhead alone (4p) | **No peek.** Sees who is awake (nobody) and the cheese state; must do nothing else. | Official: the French rulebook's 4p variant says a lone Sleepyhead can NOT look at any die and must do nothing; TW write-ups agree. The fan JP translation renders it as optional, which is a mistranslation. [O] |
| Two or more Sleepyheads (no thief) | Everyone sees who else is awake, and whether the cheese is on the table. No peeking, no signalling beyond a silent smile. | They learn they share an hour, not their dice. [O] |
| Thief awake (any W size) | The Thief must take the cheese and hide it, whether or not others are watching. Everyone awake sees the theft and sees who did it. | The Thief cannot peek (the peek is a Sleepyhead action only). [O] |
| Thief + exactly one Sleepyhead (5p only) | The witness becomes a Follower immediately. | Both now know each other. [O] |
| Thief + two or more Sleepyheads (5p only) | The Thief points at exactly one witness; that one becomes the Follower. The unpicked witnesses stay Sleepyheads and now know who the thief is. | [O][D] |
| Thief + any others (6–8p) | Nobody is recruited at this moment. Co-wakers simply witness the theft. | Recruitment happens after hour 6. [D] |
| Thief at 4p, first of two wake hours | The Thief may steal now or wait for the second wake. | Publisher ruling 2023-12-31 (account JollyThinkers): it may choose which time to steal; not yet in the printed FR/JP texts. [D] |
| Thief at 4p, cheese already stolen | Nothing more to do; it just sees who is awake. | [I] |

**Recruitment step after hour 6** (script for the moderator, paraphrased). In every case all players first hold out one hand toward the centre so a touch reveals nothing:
- **6 players.** Thief opens its eyes and quietly touches one player's hand (5 s). The touched player opens its eyes and they look at each other (5 s). Both close their eyes. Result: 1 Follower; the Follower knows the thief and the thief knows the Follower. [O]
- **7 players.** Thief opens its eyes and touches two players' hands (5 s). The two touched players keep their eyes closed. The thief closes its eyes. The two Followers open their eyes and look at each other (5 s), then close. Result: 2 Followers who know each other but **not** the thief; the thief knows both. [O]
- **8 players.** Thief opens its eyes and touches two players' hands (5 s). Both Followers open their eyes and make eye contact with the thief (5 s). All three close. Result: 2 Followers and the thief all know each other. [O]
- Followers must not share dice information during the night (no finger signals, no lifting cups). [O]
- A player may be both a witness of the theft and a chosen Follower; the pick is free, the thief is not forced to choose a witness. [D]

**After the recruitment step (or after hour 6 for 4p and 5p)**: dawn.

**Who knows what at dawn (for engine tests)**

| Player | Known privately |
|---|---|
| Thief | Own die; the hour(s) it woke; who was awake with it; who its Followers are (always). |
| Sleepyhead who woke at the theft hour | The thief's identity (saw the theft), plus the above generic info. |
| Follower, 6p/8p | The thief's identity. 8p also the other Follower. |
| Follower, 7p | The other Follower (and that it is a Follower). It learns the thief only if it happened to witness the theft at its own hour. |
| Follower, 5p | The thief (it witnessed). |
| Lone peeker (5–8p only) | One other player's die value. |
| Any Sleepyhead | Own die, own wake hour, who else was awake, whether the cheese was on the table when they woke. |

## Voting & resolution

**Vote collection.** Every player casts exactly one vote on a different player (rulebook: everyone points at "another player"). Self-votes are illegal, abstaining is illegal. The Thief may vote for its Follower, a Follower may not vote for itself. Votes are simultaneous; none may change after reveal. [O][D]

**Algorithm** (n = player count, FM = Fall Mouse in play):

```
tally[p] = number of votes received by p
max      = max(tally)                    // at least 1 because every player votes
H        = { p : tally[p] == max }        // the "top set", may contain ties
reveal cards of all p in H

if FM exists and FM ∈ H:
    winners = { FM }                     // solo, regardless of who else is in H
elif thief ∈ H:
    if n == 4 and |H| > 1:
        winners = { thief }              // 4p amendment; no Followers in 4p
    else:
        winners = all Sleepyheads        // non-Follower, non-FM Sleepyheads
else:
    winners = { thief } ∪ (Followers − { FM })   // even if a Follower is in H;
                                                  // a recruited FM never shares this win
```

**Truth table (5–8 players, no Fall Mouse)**

| Top set H | Winner |
|---|---|
| {Thief} | Sleepyheads |
| {Thief, anyone} (tie) | Sleepyheads (thief revealed, whatever else is revealed) [O][D] |
| {Follower} only | Thief team |
| {Sleepyhead} only | Thief team |
| {Follower, Sleepyhead} tie, no Thief | Thief team |
| everyone tied on 1 vote (H contains the Thief) | Sleepyheads [D] |

**Fall Mouse overrides** (6–8p): FM ∈ H → FM wins alone, even when tied with the Thief (publisher example: tied with a Sleepyhead or with the Thief, FM wins) and even when the FM was recruited as a Follower. [O][D] Everyone else loses, including the thief team and the Sleepyheads. FM ∉ H → FM loses whatever else happens, including when it is a Follower and the thief team wins. [D]

**4 players** differ only on ties involving the Thief: H = {Thief} alone → Sleepyheads win; H = {Thief, someone} → Thief wins; H without the Thief → Thief wins. Reason (publisher, 2024-01-31): in a 4-player game two suspects point at each other and the other two can split their votes to force a 2–2 tie, which under the old rule always caught the Thief. [D] The amendment (posted 2023-10-09) is printed in the Japanese edition (2023-10-27) but **not** in the French rulebook, so a physical French/older English copy will disagree; the engine follows the amendment.

## Scoring & win conditions

- **No official scoring.** A game is one night, one discussion, one vote; the winners simply win. There is no multi-round format, no elimination and no carry-over. [O]
- **Sleepyheads win** if the Thief is in the top set (and no Fall Mouse is). **Thief team wins** if the Thief is not in the top set (and no Fall Mouse is), even if a Follower is revealed. 4p tie rule above. **Fall Mouse wins alone** if it is in the top set; it never wins any other way. [O][D]
- A Follower who is voted out still wins if the thief survives. [O] A Follower loses with the Thief if the thief is caught. [O] Exception: a Fall Mouse that was recruited never shares the thief team's win. [D]
- Historical note: the 2018 crowdfunded rules phrased the vote as the top-voted player(s) "dying" (ties all die, no abstaining) with the same outcomes: thief dies → Sleepyheads win; a Sleepyhead or the Follower dies → thief side wins. [O, 2018]
- **Evening scoreboard (app convention, not official) [I]:** +1 point to each winning player per round. Optional weighting because the thief team is small: Thief +2, Follower +1 on a thief-team win, Fall Mouse +3. Optional "rotating thief" mode in which the Thief card rotates through all seats over n rounds so everyone plays Thief once; this is not in the rulebook and should be an explicit toggle.

## Edge cases an engine must handle

Each bullet is intended as a unit test.

**Deal and dice**
- Deck size equals player count; exactly one Thief; Fall Mouse only when 6 ≤ n ≤ 8 and replaces (does not add to) a Sleepyhead; Fall Mouse rejected at 4, 5 and ≥9.
- 4p: each player gets two dice values; every Sleepyhead has a chosen hour from {d1, d2}; the Thief wakes at {d1, d2}, once if d1 == d2.
- A die value is fixed at the roll; there is no API to re-roll.
- All players roll the same number: they all wake together. 5p still resolves (thief picks one Follower from the four witnesses); 6–8p uses the normal recruitment step; nobody can peek.

**Night**
- Hours 1–6 are all processed, in order, even when W(h) is empty; step durations are identical for empty and full hours.
- Lone Sleepyhead (5–8p) may peek at exactly one other player; peeking at self is illegal; second peek is illegal; skipping the peek is legal; the peeked player is never notified.
- When a Sleepyhead is alone, every other player is asleep by definition, so the target is always asleep; the engine does not need to model the target's state.
- Two or more Sleepyheads awake together: peek attempts are rejected.
- Thief is the only waker: steals, no witness, no Follower in 5p; 6–8p still recruits.
- Thief wakes with one Sleepyhead in 5p: that player becomes the Follower with no choice. With two or more: the thief must pick exactly one of the witnesses; picking a non-witness or self is illegal; passing is illegal.
- 6–8p: no automatic Followers during the hour loop even if Sleepyheads witnessed the theft; the number of Followers is exactly 1 (6p) or 2 (7p, 8p) after the recruitment step; picks must be distinct, must not be the thief, and may be any other player including the Fall Mouse and non-witnesses.
- 7p knowledge: the two Followers learn each other, neither learns the thief unless they were also witnesses; the thief learns both. 6p/8p: Followers learn the thief. 8p: the two Followers also learn each other.
- 4p: the thief steals at exactly one of its wake hours; stealing at the first leaves nothing to steal at the second; if it never steals before its last wake the engine auto-steals at the last wake (a non-steal is illegal). Sleepyheads wake once. No Followers are created. A lone Sleepyhead in 4p gets **no** peek action (official rule; any peek attempt is rejected).
- The cheese can be taken only once. Co-wakers of the theft hour (including the Fall Mouse and any Sleepyhead) see who took it.
- A Follower is never the Thief; the Fall Mouse can be a Follower; a Follower keeps its Sleepyhead/Fall Mouse card for reveal purposes.
- The wrong script for the player count is a bug magnet: in May 2024 the official app played the 6-player script in a 7-player game (every count was one off; fixed in iOS 1.1.5, 2024-05-23). Test that the recruitment step selects the right variant for n = 6, 7, 8 and none for n = 4, 5.
- Followers are forbidden from transferring dice info at night; the engine exposes no channel, so there is nothing to test beyond "no view contains another player's die except via a legal peek".

**Day and vote**
- Votes are simultaneous; a vote cannot be cast for self; a player cannot vote twice; every player must have voted before the tally (host may force a default for a stalled seat).
- Votes remain secret until all are in; then all are revealed at once.
- Ties: every tied top-voted player is revealed; there is no runoff or tie-break, except the 4p Thief tie rule.
- Everyone gets exactly one vote (5–8p, no Fall Mouse): H = all players, thief ∈ H → Sleepyheads win. With Fall Mouse present: FM ∈ H → FM wins. 4p all-ones: H includes the thief with |H| > 1 → Thief wins.
- Thief and Follower tied for most votes → Sleepyheads win (thief revealed). [D]
- Follower alone has the most votes → thief team wins; the Follower being revealed does not expose the thief.
- Fall Mouse tied with Sleepyhead or with Thief for the most votes → FM wins alone. [D]
- Fall Mouse recruited as a Follower, H = {a plain Sleepyhead} (thief ∉ H, FM ∉ H) → Thief and any *other* Follower win; the FM loses. This is the case that actually tests the "FM never wins with the thief team" ruling. [D]
- Fall Mouse recruited as a Follower, thief ∈ H, FM ∉ H → Sleepyheads win; FM loses. [D]
- Fall Mouse not in H, thief ∈ H: FM loses (it only wins by being top-voted; it is not counted among the winning Sleepyheads). [D]
- Thief votes for a Follower: allowed. Follower votes for self: illegal. [D]
- The Thief itself may be the host/moderator; the engine must not leak role information through narration timing.

**Information boundary**
- No view of any seat contains another seat's card, die or recruitment status, except what that seat legitimately learned (co-wakers, the thief's identity for witnesses and 6p/8p Followers, a peek result, the other Follower in 7p/8p).
- A peek returns the target's die (5–8p only; 4p has no peek).
- Role reveal at the end is limited to H until the result is announced; afterwards the app may reveal all.

**Open questions** (decide before shipping; defaults suggested)
1. ~~4p solo peek.~~ **Resolved:** the official French rulebook's 4-player variant says a lone Sleepyhead can NOT look at any die and must do nothing. The fan JP translation's "may skip" reading is a mistranslation. No peek in 4p; offer a peek only as a labelled house rule (see Common variants).
2. ~~Fall Mouse as Follower.~~ **Resolved:** designer (BGG, 2022-07-25), publisher (by email, reported on BGG in 2025) and the 2018 promo sheet ("independent third party even if recruited") all say the Fall Mouse wins only by being top-voted. One BGG user reads the printed "wins alone" the other way; listed under Common variants, not the default.
3. ~~Does the Fall Mouse share a Sleepyhead victory?~~ **Resolved as no:** its only win condition is being top-voted, and the promo sheet makes it a third party. (Not stated in so many words in the rulebook, hence [D].)
4. Promo Cat/Dog: the abilities are now confirmed by the designer and the 2018 promo sheet, but timing details (when in the discussion they may reveal, whether the dog's target must vote openly before the countdown) are unruled. Skip in v1.
5. ~~Window length.~~ **Resolved:** EN/FR rulebooks, the JP translation and most TW write-ups say a 10-second countdown per hour and 5-second countdowns in the Follower step; one TW blog says 5 s per hour. Default 10 s, configurable.
6. **4p Thief's second wake.** The rule says the Thief *can* wake at both of its hours, and the publisher lets it choose which hour to steal at. Whether it may also stay asleep at the non-stealing hour (so co-wakers see nobody) is unruled. Default: the Thief is woken at both hours; expose "thief may skip a wake" as an option.

## Common variants

- **Fall Mouse (背鍋鼠), 6–8 players, official [O].** The card is in the standard HK/TW box, and Taiwanese write-ups recommend adding it only after the base game is understood [C]. Probably the most-used variant in TW/HK/CN groups, but that popularity is my guess, not a measured fact [I]. It began as the 2018 promo "Blanco", whose sheet recommended 7–8 players; the retail rule allows 6–8.
- **Rejected reading: recruited Fall Mouse also wins with the thief team.** One BGG user argues the printed text ("wins alone if top-voted") does not forbid it. Designer and publisher say no. Offer only as an explicitly labelled house rule, if at all.
- **4-player two-dice variant, official [O].** Rule amended in October 2023 so a Thief tie counts as a Thief win [D]; older/French printings lack the amendment (a Thief tie then counts as a Sleepyhead win). Thief may choose which of its two wake hours to steal at [D].
- **House rule: 4p lone peek allowed [C].** This is what the fan Japanese translation implies. It is not the official rule; label it as a house rule if offered.
- **Promo Sherlock (cat) and Watson (dog) [D].** 2018 crowdfunding promos (not in the retail box); the sheet recommends them for 7–8 players and at most one promo per game. A 2026 BGG critique calls them problematic because revealing them clears you as "not the thief", and the dog's power has little effect. No evidence of wide use. Skip.
- **House rule: thief wakes at one extra hour of its choice, plus a redone Cat who also wakes extra [C, 2026 BGG].** Motivation: in 6p the theft hour is too easy to find. Experimental only.
- **Noise masking [C].** Background music (also in the official app since January 2024), tapping the table, a thick tablecloth, seating so cups are reachable without movement, or "sleepwalking" (everyone gently touches their cup at least once). Players report cup noise as the main tell. The retail cheese is foam partly for this reason (JELLY JELLY GAMES notes it makes no sound).
- **Hour cards instead of cups (BGG) [C].** Deal 3–4 cards per hour so the distribution is balanced and portable. Easy to support as an app option (balanced hour deal), but then probabilities above no longer apply.
- **More than 8 players [C].** Only an untested suggestion (d8 or d10) exists.
- **Rotating thief across rounds** and **points per round** are house conventions, not rules. Mark them clearly as app options.
- **Reveal dice after the game** for debrief: customary, not in the rules.
- **2018 original rules (5–8 players).** The crowdfunded edition had no 4-player variant and no Fall Mouse in the base box; its 6-player step had the thief reopen its eyes while "all other players" held out a hand. Otherwise the same as today. Not worth a separate mode.
- Evidence of use in HK/TW/CN groups beyond the Fall Mouse is thin: the HK publisher, TW blogs and mainland reviews all describe only the official counts and the Fall Mouse.

## App design notes

**What must stay private**
- Each player's card, die (or two dice), chosen hour (4p), recruitment status and everything seen at night: only that seat's view carries it. The engine must build views by whitelist.
- Who is awake at each hour, and the cheese location, are known only to the players awake then. No public "cheese stolen at hour X" display.
- Peek results go only to the peeker. The peeked player gets no notification.
- Recruitment: a Follower learns only what its count allows (see knowledge table). The thief's pick UI is private to the thief; other phones must show a decoy of identical duration.
- Do not create a vote-count progress that leaks who has voted for whom; "7/8 voted" is fine.
- Day-phase private recap: a per-player night log (hour woke, who else awake, cheese state, peek result). The physical game relies on memory, so make the recap a toggle (default on for casual tables). Keep it as the player's own aid, never a shared log.

**What needs a narrator** (host phone only, optional; Cantonese)
Cue ids (ids must be unique per step) with draft lines in original wording:

| cue id | draft Cantonese line |
|---|---|
| `night:begin` | 天黑，請閉眼。 |
| `night:hour:H:open` | 而家係 H 點，擲到 H 嘅老鼠請睜開眼。 |
| `night:hour:H:close` | 請閉返眼。 |
| `night:recruit:6` | 所有人伸出右手。大盜請睜眼，輕輕摸一位老鼠嘅手。（5 秒）被摸到嘅共犯請睜眼，同大盜對望。（5 秒） |
| `night:recruit:7` | 所有人伸出右手。大盜揀兩位共犯；被揀嘅共犯唔好睜眼。（5 秒）大盜閉眼，兩位共犯睜眼互相認人。（5 秒） |
| `night:recruit:8` | 所有人伸出右手。大盜揀兩位共犯。（5 秒）兩位共犯請睜眼，三人互相認人。（5 秒） |
| `night:recruit:close` | 所有人請閉眼，收返隻手。 |
| `day:begin` | 天光喇，請睜眼。芝士唔見咗！ |
| `vote:call` | 邊個係芝士大盜？三、二、一，指！ |

Narration is generic: no role-specific calls exist, so the whole night is six hour calls plus at most one recruitment script. Write one script per player count (6/7/8 differ) and test them (the official app once shipped the wrong one). The official app only speaks English and German, so a Cantonese narrator is a real gap this hub fills.

**What can be fully automated on phones**
Everything except the discussion: deal, dice, hour sequencing, empty-hour padding, cheese state, co-waker lists, the peek, the thief steal and Follower picks (tap a name instead of touching a hand), mutual-recognition screens, the vote, tally, tie handling, win decision, evening scoring. A human narrator is optional. In digital play the secrecy of "eyes closed" is only needed against peeking at neighbours' screens; consider a "screens-only" mode where the narrator is omitted and each phone shows a fixed-length hour screen.

**Anti-tell concerns**
- Every hour lasts the same time whether anyone is awake or not (fixed per-step duration), and the narrator calls all six every time.
- Tapping noise from lone peekers and thieves is the main physical tell. Give every phone a same-shaped decoy interaction at every hour (non-wakers tap a pointless "zzz" target), mute all non-host phones at night, drop brightness, and let the host play quiet background audio.
- Remove the physical-game exploit of stealing in the first or last second (BGG complaint): co-wakers of the theft hour always see the theft and the thief's name, however fast.
- Auto-show the cheese state to every waker (cuts "cheese blindness", a common real-play error).
- Hand-touch recruitment is replaced by a private pick; keep a same-length screen for everyone else so duration cannot give the thief or Followers away.
- iPhone: no vibration, so feedback must be sound and animation; rolling needs a user gesture for any audio or motion permission.

**Host / moderator dashboard**
Shows only phase, current hour and countdown, device-connected status, a per-hour "all phones acknowledged" indicator, replay cue, skip step, pause/+time, and auto-act for a stalled seat (lone peeker: skip; thief: take the cheese; thief's pick: random legal; voter: random legal non-self). No role or die information by default. An opt-in "god view" for a non-playing host should be clearly marked as breaking fairness. The existing "房主都要玩" toggle already covers the dealing trust trade-off.

**Single shared phone**
Two workable modes:
1. *Phone as moderator, physical eyes.* The phone deals roles and dice by pass-gate, then narrates the hours while players physically open eyes. Co-presence and eye contact stay real. A lone Sleepyhead picks the phone up and taps a target to see that die, and the narrator always says the same line so it does not announce who is alone. The cheese is a physical stand-in (a coin). The thief records its Followers on the phone through a pass-gate so scoring works.
2. *Full digital pass-around.* Each waking player in turn takes the phone through a pass-gate; slower, with a multi-waker hour needing each co-waker to be shown the others. Only recommended when nobody can get eyes closed.
The 4-player two-dice variant is workable in mode 1.

**Reuse notes**
The existing hub already has a Cover (hold to peek) and a DiceCup; the secret roll can be reused with a roll-once lock and no re-roll. The peek is a new PlayerPicker action. Do not reuse the official moderator app's art, voice or script text; use original wording and art.

## Sources

Primary / official
- BoardGameGeek item data (designer, publishers, year, polls, alt names), fetched through the public geekdo API: https://api.geekdo.com/api/geekitems?objectid=294175&objecttype=thing
- BGG game page: https://boardgamegeek.com/boardgame/294175/cheese-thief
- BGG file listing with the official EN/CN/DE rulebooks (login-gated download): https://api.geekdo.com/api/files?objectid=294175&objecttype=thing
- BGG rules threads with designer / publisher rulings (read through the API): Ties? https://boardgamegeek.com/thread/3410779/ties · Rule doubts? https://boardgamegeek.com/thread/2904819/rule-doubts · Updated 4-player winning condition https://boardgamegeek.com/thread/3168167 · Rules check (waking together) https://boardgamegeek.com/thread/2906477 · Fall Mouse ties https://boardgamegeek.com/thread/3217498 · All players receive one vote https://boardgamegeek.com/thread/3307195 · Is the app wrong? https://boardgamegeek.com/thread/3299378 · Followers query https://boardgamegeek.com/thread/3705332 · When can the thief act? https://boardgamegeek.com/thread/3677104
- BGG community threads: 7-player followers https://boardgamegeek.com/thread/3331520/7-players-game-followers-strategy · Promo cards https://boardgamegeek.com/thread/2866541 · House rules https://boardgamegeek.com/thread/3760615 · Sleepwalking https://boardgamegeek.com/thread/3224024 · Noise https://boardgamegeek.com/thread/3523463 · Beyond 8 players https://boardgamegeek.com/thread/3378771 · Cards instead of cups https://boardgamegeek.com/thread/3027310 · Quick review https://boardgamegeek.com/thread/2985400 · Family review (rule summary) https://boardgamegeek.com/thread/3124481
- English rulebook front matter (preparation, night sequence, winning and losing) reproduced by a retailer: https://themindcafe.sg/product/cheese-thief/
- Jolly Thinkers product page: https://www.jollythinkers.com/products/cheese-thief
- Official moderator app (App Store): https://apps.apple.com/us/app/cheese-thief-moderator/id1519580020 · LaudoStudio: https://laudostudio.de/CheeseThief
- Modian crowdfunding page (2018; original 5–8 player rules, components, funding result): https://zhongchou.modian.com/item/19497.html
- **Official French rulebook** (Don't Panic Games, CHEESENAPPiNG!; full rules incl. 4-player variant and Fall Mouse): https://www.dontpanicgames.com/static/CHEESENAPPING_REGLES.pdf · product page https://www.dontpanicgames.com/en/produit/cheesenapping/
- BGG versions (edition names, years, publishers, languages): https://boardgamegeek.com/boardgame/294175/cheese-thief/versions · stats / polls via https://api.geekdo.com/api/dynamicinfo?objectid=294175&objecttype=thing
- BGG images used as evidence: HK/TW box back with Traditional Chinese blurb and credits https://boardgamegeek.com/image/5643702 · 2018 promo skill sheet v1.0 (Sherlock / Watson / Blanco) https://boardgamegeek.com/image/5134975
- More BGG threads: Moderator app voices / background music (publisher, Jan 2024) https://boardgamegeek.com/thread/3088857 · Android voice issue, app versions 1.1.11 / 1.1.12 (developer LaudoStudio) https://boardgamegeek.com/thread/3587977 · Which are the promo cards? https://boardgamegeek.com/thread/3238503
- Official moderator app (Google Play): https://play.google.com/store/apps/details?id=de.LaudoStudio.CheeseThief

Complete translation of the rulebook, used for procedure detail
- Fan Japanese translation of the English rulebook (includes 4-player and Fall Mouse; mistranslates 4p point 3; predates the 2023 tie amendment): https://hackmd.io/@rabit-import-tablegames/H1e-gi4aO

Traditional / Simplified Chinese, Japanese, German
- Andy Venture (TW) rules and component list with role names 貪睡鼠 / 共犯 / 背鍋鼠: https://andyventure.com/boardgame-cheese-thief/
- GameSquare (TW), also posted on PTT: https://gamesquare.pixnet.net/blog/posts/14218986779 · https://pttgamer.com/BoardGame/1VewiGfa
- Punch Boardgame (TW): https://punchboardgame.pixnet.net/blog/post/468012296
- HK retail listing (WOB Games, bilingual HK box): https://wobgames.net/shop/cheese-thief-%E5%A5%B6%E9%85%AA%E5%A4%A7%E7%9B%9C/
- Sohu introduction (mainland, 2019): https://www.sohu.com/a/327432939_100185646
- Japanese edition announcement (JELLY JELLY GAMES): https://jelly2games.com/news/11573 · Bodoge info: https://bodoge.hoobby.net/games/cheese-thief
- German reviews with role names Käsedieb / Sündenmaus: https://www.sprungbrettle.de/deduktionsspiel-kaesedieb/ · https://www.brettspiel-news.de/index.php/brettspieltest/9696-test-kaesedieb
- English reviews: https://www.tabletopgaming.co.uk/reviews/cheese-thief-review/ · https://www.boardseyeview.net/post/cheese-thief

Retrieved on 2026-10-03 UTC.

## Verification

Adversarial fact-check run on 2026-10-03 UTC. Where possible I used sources the first draft did not cite; cited sources were re-read rather than trusted.

**What was checked, and against what**
- *Full rules text:* the official French rulebook (Don't Panic Games, CHEESENAPPiNG!, public PDF; it was not cited before). I checked every procedural step against it: deal, roll, 10 s hour windows, the thief's forced steal, the lone-Sleepyhead peek, co-waker behaviour, the 5/6/7/8-player Follower scripts with their 5 s countdowns and who sees whom, the discussion limits, the simultaneous vote on "another player", tie reveal, the win/loss bullets, the 4-player variant (all four points) and the Fall Mouse variant. All matched the draft **except the 4p solo peek** (see changes).
- *Original rules:* the 2018 Modian crowdfunding page content (5–8 players, 8 cards, the original Follower scripts, "top-voted dies / ties all die" phrasing). This independently confirms the 5p witness rule (including "thief alone → no Follower"), the 6/7/8p scripts and the 7p "Followers don't know the thief" rule.
- *Rulings:* every Cheese Thief thread on BGG, including ones the draft did not cite (app voices 3088857, Android audio 3587977, promo cards 3238503, Fall Mouse strategy 3199276, odds 3310915 and others). I also confirmed who the posters were through the BGG user API: "loveflyqinqin" = Dongxu Li (the designer), "JollyThinkers" = the publisher account, "LaudoStudio" = Laurin-Neil Dorra (the app developer).
- *Tie / win outcomes:* the publisher's quoted rulebook text (5–8p: the thief in the top set loses whatever else is revealed; the Fall Mouse in the top set wins alone, even if tied or recruited), the 4p amendment text (2023-10-09) and its rationale (2024-01-31), the 2023-12-31 ruling that the 4p thief chooses its theft hour, and the 2024-05-29 ruling that "all tied on one vote" means a Sleepyhead win for 5–8p only. Also the JELLY JELLY GAMES article, which shows the 4p amendment printed in the Japanese edition.
- *Promo cards:* the 2018 promo skill sheet v1.0 (BGG image 5134975) and the designer's 2022 answer.
- *Names and editions:* BGG item, version and publisher records (via the geekdo API), the HK/TW box-back image (Traditional Chinese blurb uses 奶酪大盜 / 貪睡鼠 / 共犯; credits; HK publisher 空中棋園; TW importer; mainland agent), a TW component list (繁中/EN/DE rulebooks, 背鍋鼠), the JP publisher's article (2023-10-27 release, JP role names) and the Don't Panic Games product page.
- *Platform versions:* the App Store listing (version history up to 1.1.12, 2025-11-13, iOS 13.0+), the Google Play listing (1.1.12, updated 2025-11-08), the LaudoStudio page (languages EN/DE, speed setting) and the developer's BGG posts.
- *Numbers:* BGG stats (16-vote player poll best 6–8 / recommended 5–8, weight 1.1667 from 18 votes, average 6.968 from 1,050 ratings), the Modian funding figures, and I recomputed the probabilities (5/6)^(n−1), which were correct.

**What was changed**
1. **4p solo peek (changes outcomes): it was an open question, it is now an official rule.** A lone Sleepyhead in the 4-player variant may NOT peek and must do nothing (French rulebook, 4p point 3; TW write-ups agree). The fan JP translation the draft relied on mistranslates this point as optional. I updated the role table, setup table, night table, edge cases, information boundary, open question 1 and Common variants (the peek is now a labelled house rule only).
2. **Win algorithm bug (changes outcomes):** the thief-team branch returned "Thief + Followers", which would wrongly include a recruited Fall Mouse. Now it is `{thief} ∪ (Followers − {FM})`. The team summary and the Follower role row were fixed to match.
3. **Wrong unit-test scenario:** the "Fall Mouse who is also a Follower" test used a case where the thief is caught, so it could never exercise the ruling. I replaced it with the real test (FM recruited, a plain Sleepyhead top-voted → Thief and the other Followers win, FM loses) and kept the old case as a separate bullet.
4. **Open questions 2, 3 and 5 resolved:** Fall Mouse never shares the thief team's or the Sleepyheads' win (designer + publisher + promo sheet: "independent third party"); the window is 10 s (EN/FR rulebooks; only one TW blog says 5 s). Added open question 6 (whether the 4p Thief may stay asleep at its non-stealing hour), with a default.
5. **4p tie amendment provenance:** noted that it is printed in the JP edition but missing from the French rulebook (and from pre-2023 English copies), and that it was posted by the publisher account. The draft called it the "designer". The rationale is paraphrased more accurately (the other two players split their votes to force a tie).
6. **Promo Cat/Dog:** the source is the designer plus the 2018 promo sheet, not "a single BGG answer", so the tag is now [D]. Cat = "Sherlock", Dog = "Watson". The dog makes one player commit their vote *first*; the draft said "vote immediately". Added the sheet's advice: 7–8 players, at most one promo at a time.
7. **Identity:** added the French edition CHEESENAPPiNG! (2023) and the Nordic 2024 edition. Lautapelit.fi publishes the Nordic edition, not a "Finnish" one. Popcorn Games + sternenschimmermeer are the Korean 2021 edition. Käsedieb is the German title on the trilingual box, not a separate edition. "チーズ泥棒" is an informal JP alias, not a wrong name. The 2018 release was crowdfunded on Modian by the DOUBLE KILL team, described on that page as running a Sydney board-game bar; the draft said it was "self-published in mainland China". Added funding figures, the HK publisher's Chinese name 空中棋園, the TW importer and the mainland agent, the graphic designer Ming Li, and the 2024 Guldbrikken nomination.
8. **App versions:** added the current version 1.1.12 (iOS 2025-11-13, iOS 13.0+; Android 2025-11-08), the version history, and the fact that the app speaks **only English and German**. The developer's full name is Laurin-Neil Dorra. The off-by-one script bug was fixed in iOS 1.1.5 (2024-05-23).
9. **Smaller fixes:** the n/6 wakers-per-hour figure applies only to 5–8p. "No re-roll" is upgraded from [I] to [O]. Co-waker and thief rows are upgraded from [C] to [O]. The rulebook explicitly bans abstaining and voting for yourself. A 7p Follower knows the thief if it witnessed the theft. Components: the HK/TW box has separate 繁中/EN/DE booklets. Added 2018 Chinese role names (嗜睡老鼠, 背叛者). The 6p Cantonese recruit cue was missing the Follower's eye-contact step; I fixed it and added a close cue. Added sources.

**Not independently verified (flagged in text)**
- 替罪鼠 as an alternative name for the Fall Mouse, and 起司大盜 as a TW spelling: no printed source found.
- The exact English wording of the 4p point 3: the English PDF on BGG is behind a login. The French official text is unambiguous, and the Japanese fan text is the only source that disagrees.
- Whether the Chinese-language retail rulebook already includes the 2023 4p amendment or the "thief chooses theft hour" clarification.
- German role name Sündenmaus: taken from the draft's cited German reviews, not re-fetched.
