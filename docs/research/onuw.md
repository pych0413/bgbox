# One Night Ultimate Werewolf — rules reference

> Paraphrased for engine implementation. Not a copy of the official rulebook.

## Identity

| Field | Value |
|---|---|
| EN name | One Night Ultimate Werewolf (ONUW). Base game only in this doc; expansions (Daybreak, Vampire, Alien, Bonus Roles, Super Villains) are out of scope. |
| 繁中 name(s) | 一夜終極狼人 (title of the licensed Chinese edition and of Taiwan retail listings); 終極一夜狼人 (casual HK/TW reordering); 一夜终极狼人 (CN, simplified). The bare name 一夜狼人 usually means the lighter Japanese original (ワンナイト人狼, One Night Werewolf), so do not use it as the ONUW title. |
| 日本語 | No Japanese-language edition is listed on BGG; Japanese blogs call it 究極のワンナイト人狼 or ワンナイトアルティメット人狼. The original Japanese game is ワンナイト人狼 (One Night Werewolf, Okui, 2013, 3-7 players). |
| Player range | 3-10 (printed). Needs `players + 3` role cards. Age 8+ (BGG). |
| Best count | Publisher does not name one; it only recommends 3-5 for a first game. Community figures vary: Nerdist (2017) says best at 5-6; a Chinese-language guide says 6-10. (BGG poll not readable during verification.) Treat 5-8 as "recommended" in the picker, 3-4 and 9-10 as "works". |
| Play time | About 10 minutes per game (one night, one day, one vote; BGG lists 10 min). Many games are played back to back. |
| Designers | Ted Alspach and Akihisa Okui (Okui designed the Japanese original One Night Werewolf, released January 2013). Artist: Gus Batts (BGG also credits Ted Alspach for graphics). |
| Publisher | Bezier Games (English first edition 2014; reprints listed by BGG through 2023). BGG lists the Chinese edition 一夜終極狼人 (2015) as published by **Playfun Games**. An earlier draft of this doc named 新天鵝堡 (Swan Panasia); no source confirming that was found, so treat it as unverified. Korean edition: 한밤의 늑대인간 (Popcorn Games / UBO CnC, 2019). |
| Physical components the app must replace | 16 role cards (12 distinct roles, listed below) and 16 matching role tokens (waking roles carry their wake number 1-9; Villager, Tanner and Hunter tokens are unnumbered); 3 centre cards; an Announcer (or the free Bezier narration app); a day timer; the pointing vote; optional chips for tournament play. |
| Number of games per session | 1 night + 1 day + 1 vote. Multi-game is just repeated independent deals (see Scoring). |

Evidence tags used below:

- **[R]** stated in the official Bezier rule booklets / narration guide / wake-order list (primary, read directly as PDFs).
- **[R14]** stated in the older 2014 rulebook (read directly; only differs from [R] where noted).
- **[PUB]** publisher / designer ruling posted on BoardGameGeek. During verification the threads were read directly through BGG's JSON API (`api.geekdo.com/api/articles?threadid=…`). Designer Ted Alspach posts as user 24301 ("toulouse"); the official Bezier Games account is user 2364000. Rulings by long-time rules expert "Clipper" (user 474653) are marked [C+], not [PUB].
- **[PUB?]** reported ruling that still could not be traced to a designer or publisher post.
- **[D]** derived by logic from [R] text; no explicit ruling found.
- **[C]** community / retailer / blog practice.

Card pool of the base box (16 cards): Doppelganger 1, Werewolf 2, Minion 1, Mason 2, Seer 1, Robber 1, Troublemaker 1, Drunk 1, Insomniac 1, Hunter 1, Tanner 1, Villager 3. [R]

## Roles

Team here is the team attached to the card. A player's team at the end is the team of the card in front of them (Doppelganger: the team of the role she copied). "Original role" = the card dealt at the start; it decides who wakes up.

| id | EN | 繁中 | team | ability (precise) | acts at night? when? |
|---|---|---|---|---|---|
| `doppelganger` | Doppelgänger | 化身幽靈 (variants: 雙面人, 分身, 二重身) | Copies the viewed role's team: werewolf if she views Werewolf or Minion; village if Mason, Seer, Robber, Troublemaker, Drunk, Insomniac, Villager, Hunter; Tanner-side if Tanner. [R] | Looks at (never takes) ONE OTHER PLAYER's card. Centre cards and her own card are not legal targets. She becomes that role and team without swapping. Viewed Villager/Tanner/Hunter: nothing more. Werewolf/Mason: wakes with that group at its normal step. Seer/Robber/Troublemaker/Drunk: performs that action immediately, inside her own step, and does not wake again later. Minion: sees the werewolves in a special step right after her own step. Insomniac: wakes again right after the Insomniac. The copied role is attached to the Doppelgänger CARD: whoever ends the night holding that card is the copied role (see edge cases). [R] | Yes. First step; plus optional follow-ups `doppelganger-minion` and `doppelganger-insomniac`. |
| `werewolf` | Werewolf | 狼人 | werewolf | All Werewolves wake and look for other awake werewolves. If nobody else is awake, the other werewolf card is in the centre. Lone Wolf option: a werewolf who is alone may look at one centre card. [R] | Yes. Step 2. |
| `minion` | Minion | 爪牙 (variant: 內奸) | werewolf (but see win rules) | Wakes right after the werewolves. Werewolves stick out a thumb so the Minion sees exactly who they are; werewolves do not learn who the Minion is. If no player is a werewolf, the Minion sees nobody. [R] Win: if werewolves are among the players, the Minion wins with them even if the Minion is the one who dies. [R] If no player is a werewolf, the Minion needs another player to die AND must survive herself. [R] + [PUB] (Bezier 2021: each such Minion needs one other player to die, not herself; Taiwan write-ups also say 自己活著) | Yes. Step 3. |
| `mason` | Mason | 守夜人 (aliases: 共濟會 / 共濟會員, a literal "Freemason" used by some Chinese players; 石匠, literal "mason". Japanese blogs use フリーメイソン or 石工, not a Chinese term. Daybreak's Sentinel is a different card, 哨兵) | village | Always used as a pair. Wakes and looks for the other Mason. Sees nobody = the other Mason card is in the centre. [R] | Yes. Step 4. |
| `seer` | Seer | 預言家 (one Taiwan review of the Chinese edition uses it; two other Taiwan write-ups use 先知, so both are common) | village | MAY look at one other player's card OR any two of the three centre cards. Cannot do both. Does not move cards. [R] | Yes. Step 5. |
| `robber` | Robber | 強盜 | team of the card taken; village if no swap | MAY swap his card with another player's card (not centre), then looks at the new card. The victim receives the Robber card and is village team (and role Robber). The Robber does NOT perform the new card's night action. If he declines he stays Robber (village). [R] | Yes. Step 6. |
| `troublemaker` | Troublemaker | 搗蛋鬼 (variant: 災難製造者) | village | MAY swap the cards of two OTHER players (neither is himself; no centre cards) without looking at them. Those players become the role and team of their new cards without knowing it. [R] | Yes. Step 7. |
| `drunk` | Drunk | 酒鬼 | team of the centre card taken | MUST swap his card with one of the three centre cards (his choice) and does NOT look at it. He is now the card in front of him and its team. [R] | Yes. Step 8. |
| `insomniac` | Insomniac | 失眠者 (variant: 失眠患者) | village | Wakes late and looks at her own current card to see whether it changed. The rulebook says to include her only with Robber and/or Troublemaker; Drunk and Doppelgänger-swappers also make her meaningful. [R] | Yes. Step 9. |
| `villager` | Villager | 村民 | village | No ability. Definitely not a werewolf. [R] | No. |
| `hunter` | Hunter | 獵人 | village | If the Hunter dies, the player he is pointing at (the player he voted for) also dies, no matter how many votes that target got. [R] | No. |
| `tanner` | Tanner | 皮匠 (variants: 制革匠, 皮革匠) | neither team (counts as a village member for the "all werewolves in centre" rule, but is not on the village team) | Wins only if he dies. If he dies and no werewolf dies, the werewolves do not win. If he dies and a werewolf also dies, the village team wins too. If he dies while all werewolves are in the centre, the village team loses. [R] Exception: when no player is a Werewolf, a Tanner's death does NOT stop a surviving Minion from winning (Bezier Games ruling, 2021). [PUB] | No. |

Role-name note for the UI: use the names above as primary. 化身幽靈 / 爪牙 / 守夜人 / 強盜 / 搗蛋鬼 / 酒鬼 / 失眠者 / 村民 / 獵人 / 皮匠 / 狼人 are the same in every Taiwan source checked; only the Seer varies (預言家 or 先知). Show the aliases in the rules sheet. 預言家 is also what HK groups say in 狼人殺, so it will be understood. (The physical card faces of the Chinese edition were not seen directly.)

## Setup by player count

Rules that hold for every count (validator): total cards = players + 3 [R]; the 3 leftover cards go face down in the centre [R]; both Masons or neither [R]; keep at least one Werewolf card (rulebook allows a single Werewolf as a deliberate variant) [R]; do not exceed the base pool counts unless the app owns expansion cards; Insomniac only with Robber and/or Troublemaker (warn, do not block) [R]. Showing the list of roles in play, with counts, to everyone is part of the official procedure (tokens next to the centre). [R]

The publisher's booklet only prescribes 3, 4 and 5 players. Larger counts are community sets. A commonly repeated balance guideline: at least half of the players' cards should be village team, otherwise there are more liars than truth-tellers. [C; no written source found during verification, so treat it as a heuristic]

| Players | Cards | Source | Set (base game only) |
|---|---|---|---|
| 3 | 6 | OFFICIAL [R] | Werewolf x2, Seer, Robber, Troublemaker, Villager x1 |
| 3 | 6 | community alt [C] (Nerdist) | Werewolf x2, Seer, Robber, Villager x2 |
| 4 | 7 | OFFICIAL [R] | 3-player set + 1 Villager (Villager x2) |
| 5 | 8 | OFFICIAL [R] | 3-player set + 2 Villagers (Villager x3) |
| 6 | 9 | community [C] (Nerdist) | Werewolf x2, Minion, Seer, Robber, Troublemaker, Villager x2, plus one more Villager OR Tanner |
| 6 | 9 | community [C] (BGG thread 1860094) | Werewolf x1 (sic, only one), Minion, Mason x2, Seer, Robber, Troublemaker, Drunk, Insomniac |
| 7 | 10 | community [C] (BGG thread 1860094) | Werewolf x2, Minion, Mason x2, Seer, Robber, Troublemaker, Drunk, Insomniac |
| 8 | 11 | community [C] (BGG thread 1860094) | 7-player set + Hunter |
| 8 | 11 | DERIVED [D] | 7-player set + 1 Villager (gentler) |
| 9 | 12 | community [C] (Nerdist) | Werewolf x2, Minion, Tanner, Seer, Robber, Troublemaker, Mason x2, Villager x2, plus one more Villager OR Insomniac |
| 9 | 12 | community [C] (BGG thread 1860094) | 7-player set + Villager x2 |
| 10 | 13 | community [C] (BGG thread 1860094) | Werewolf x2, Minion, Mason x2, Seer, Robber, Troublemaker, Drunk, Insomniac, Hunter, Villager x2 |
| 10 | 13 | DERIVED [D] | Werewolf x2, Minion, Mason x2, Seer, Robber, Troublemaker, Drunk, Insomniac, Tanner, Hunter, Villager x1. Advanced: swap the Villager for the Doppelgänger. The 13 non-Villager cards (all specials, no Villager) also form a legal 10-player set. |

(An earlier draft credited a 7-player set to Nerdist and 6/7-player sets to a Chinese guide. Neither page has them: the Nerdist article covers only 3, 6 and 9 players, and the Chinese guide gives no role lists. Those rows were replaced with the BGG sets above.)

Learning ladder: the official text says not to add more than 1 or 2 new roles at a time and tells new players to skip the Doppelgänger. [R] A Chinese-language guide says to leave out Doppelgänger, Tanner and Hunter in first games. [C] The exact order (Minion, then Drunk/Insomniac, then Masons, then Hunter/Tanner, Doppelgänger last) is a suggestion only. [D] Official text also suggests exotic sets: a single Werewolf, a fully random deal of all cards, or a village with no Villager cards. The 2014 booklet adds a fourth: draw `players + 3` role tokens at random from a bag. [R][R14]

Where the two Werewolves start (initial deal, uniform random; useful for default-set sanity checks) [D]:

| Players | P(both werewolves in centre = nobody is a wolf) | P(exactly one in centre = lone wolf) | P(both among players) |
|---|---|---|---|
| 3 | 0.200 | 0.600 | 0.200 |
| 4 | 0.143 | 0.571 | 0.286 |
| 5 | 0.107 | 0.536 | 0.357 |
| 6 | 0.083 | 0.500 | 0.417 |
| 7 | 0.067 | 0.467 | 0.467 |
| 8 | 0.055 | 0.436 | 0.509 |
| 9 | 0.045 | 0.409 | 0.545 |
| 10 | 0.038 | 0.385 | 0.577 |

(Robber, Troublemaker and Drunk then move cards, so end-of-night odds differ.)

## Procedure

Visibility legend: PUBLIC = shown to the whole table; PRIVATE = only the named player's phone.

1. **Choose the role set.** Host picks a preset or edits counts; app validates (see Setup). Result: the list of roles in play with counts is PUBLIC (the token display). Which player holds which is not.
2. **Shuffle and deal.** Shuffle exactly `players + 3` cards; deal one face down to each player; put 3 face down in the centre (positions 1, 2, 3 for engine addressing). PRIVATE: each player looks at their own dealt card once. PUBLIC: nothing about cards. Then each player keeps that card face down in front of them: from here on the card moves, the player does not announce it.
3. **Night starts.** Everyone closes their eyes (the Announcer too; the Announcer is also a normal player with a card). In the app this is a "night" state where every phone is dark or showing a decoy. No communication of any kind is allowed while another role is acting: no moving, pointing or signalling. [R]
4. **Night steps in order** (full table in Night order). Each called role is woken by role name, performs its action, and is told to close eyes. The official Announcer counts silently to ten after waking each role to give it time. [R][R14] (Both the current Getting Started Guide and the 2014 booklet say this.) Steps are called for every role in the game, including roles whose cards sit in the centre (they simply have nobody to wake). Actors are sequential; each step has one acting group; steps are separated by the timer. PRIVATE: all information learned.
5. **Night ends.** Two official versions exist. In the Getting Started Guide (current, and the same in the 2014 booklet), the Announcer, eyes closed, nudges the cards around. In the 2023 narration sheet, every player, eyes closed, shifts their own card slightly without changing its position. Both exist so nobody can claim "my card was never touched". [R][R14] Then everyone opens their eyes. In the app this is a fixed pause; cards cannot be re-viewed.
6. **Day discussion.** Everyone talks freely. Anyone may say anything, true or false (werewolves are expected to claim another role). Showing a card to anyone is forbidden, and looking at any card after the night is forbidden, because the card in front of you may no longer be the role you were dealt. [R] Length is not fixed by the rules: "a few minutes"; use a timer, when it ends everyone must vote. [R] Recommended defaults [C]: 3-4 players 4 min, 5-6 players 5 min, 7-8 players 7 min, 9-10 players 8-10 min; host can add 60 s. (The publisher's own app mock-up shows a 10:00 game timer.) PUBLIC: all speech. PRIVATE: only each player's memory of what they were dealt and what they learned.
7. **Vote.** On a countdown every player simultaneously points at ONE OTHER player. The Getting Started Guide counts "three, two, one"; the 2023 narration sheet counts "one, two, three". No self-vote, no abstention, no pointing at the centre (official text: each player points to another player [R]; BGG rules experts confirm there is no abstain and no self-vote [C+]). Votes are visible to everyone (pointing is public) and the Hunter's target is exactly his vote. In the app: lock in privately, reveal all at once. PUBLIC after reveal.
8. **Resolve deaths** with the algorithm in Voting & resolution (ties, nobody-dies rule, Hunter). Dead players reveal their card (PUBLIC).
9. **Determine winners** using Scoring & win conditions. The rules only make the dead reveal [R]. In practice everyone then reveals their current card so teams can be checked, and the Doppelgänger says which role she copied. [C] PUBLIC. (The app knows everything, so it simply shows the full reveal.) The game is over; there is no second night.
10. **Next game / scoring.** New deal, new role set if wished. Official extra: tournament play with chips (see Scoring).

## Night order

Each row is one engine step. The rules say to call the roles that are in the game; the game includes the three centre cards, so a step is called whenever its role card is in the card set, even when that card is in the centre, which also stops timing from revealing what is where. [R][D] Who wakes is decided by the ORIGINAL role dealt at the start of the night (plus the Doppelgänger's copied role), never by which card they hold when the step comes: the rulebook says the Robber does not do the action of the card he takes, and that a Doppelgänger who copied an action role does not wake again "with the original role". On BGG (thread 1195006), Ted Alspach restated the Robber rule, and players summarise it as "you only perform actions based on what you saw before the night". [R][PUB][C]

| # | step id | called if | who wakes | what they learn / may do | notes |
|---|---|---|---|---|---|
| 1 | `doppelganger` | Doppelgänger card in play | player whose original role is Doppelgänger | Picks one other player, privately sees that card, becomes that role (card is NOT swapped). If the role is Seer, Robber, Troublemaker or Drunk, takes that action now with exactly the normal options. | A copied Seer, Robber, Troublemaker or Drunk action happens now, before the real werewolves, Minion, Seer and so on act, so every later step sees the changed cards. It does not wake again later. Villager, Tanner, Hunter copy: nothing else at night. Werewolf, Mason: wakes later with that group. Insomniac: later at 9a. Minion: handled by 1b. |
| 1b | `doppelganger-minion` | Doppelgänger AND Minion cards both in play | Doppelgänger (only if she copied Minion); werewolves give the thumbs | The "Doppelgänger-Minion" keeps eyes open and sees who the werewolves are (they stick out thumbs, eyes closed). Everyone else closes eyes. | Called even if the Doppelgänger did not copy Minion, and even if the Minion card is in the centre, so the pause is identical. This role never wakes at step 3. Thumbs come from players whose original role is Werewolf (the Doppelgänger cannot be a werewolf and a Minion at once). [R] |
| 2 | `werewolf` | Werewolf card in play | players whose original role is Werewolf, plus the Doppelgänger if she copied Werewolf | Each looks for other awake werewolves. Alone = the other werewolf is in the centre. Lone Wolf option: if exactly one werewolf is awake, he may look at ONE centre card. | Count "awake werewolves" = original werewolves + Doppelgänger-Werewolf. With both present nobody is alone. A werewolf who was robbed by a Doppelgänger-Robber at step 1 still wakes here (original role). |
| 3 | `minion` | Minion card in play | player whose original role is Minion | Sees the werewolves (thumbs up): original werewolves and the Doppelgänger-Werewolf. | Werewolves do not see the Minion. Nobody to see if both werewolves are in the centre. The Minion does not see other Minions. |
| 4 | `mason` | Mason cards in play | original Masons plus a Doppelgänger who copied Mason | See each other. Alone = other Mason is in the centre (or, with Doppelgänger, she is the second awake person). | If the Doppelgänger copied a Mason, a lone real Mason sees her and thinks she is the other Mason. |
| 5 | `seer` | Seer card in play | original Seer | May look at one other player's card OR two centre cards. | Sees the card faces as they are now. A Doppelgänger card shows the Doppelgänger face, not the copied role. |
| 6 | `robber` | Robber card in play | original Robber | May swap with another player and view his new card. | Does not use the new card's ability. The victim, if later called, still wakes by his own original role. |
| 7 | `troublemaker` | Troublemaker card in play | original Troublemaker | May swap two other players' cards unseen. | Works on the positions as of now (after Robber). |
| 8 | `drunk` | Drunk card in play | original Drunk | Must swap with a centre card of his choice, unseen. | His old card goes to the centre. |
| 9 | `insomniac` | Insomniac card in play | original Insomniac | Looks at own current card. | Sees the result of Robber, Troublemaker, Drunk and any Doppelgänger swaps. If she was robbed she sees the Robber card. |
| 9a | `doppelganger-insomniac` | Doppelgänger AND Insomniac cards both in play | Doppelgänger (only if she copied Insomniac) | Looks at her own current card to see whether she is still the Doppelgänger. | Called even if she did not copy Insomniac, so the pause is identical. |

The three no-wake roles are Villager, Tanner and Hunter. [R]

The base-game wake order in the rulebook chart is 1 Doppelgänger, 2 Werewolves, 3 Minion, 4 Masons, 5 Seer, 6 Robber, 7 Troublemaker, 8 Drunk, 9 Insomniac, 9a Doppelgänger/Insomniac. [R] The physical tokens are printed 1-9 only; Villager, Tanner and Hunter tokens have no number, and there is no "9a" token. The step "1b" (Doppelgänger-Minion) is this doc's engine label; the rulebook puts it at the end of the Doppelgänger phase without a number.

Expansion-proofing: Bezier's combined "Wake Order 5.0" list for all One Night games renumbers the roles. The Doppelgänger is **−7** there, because Oracle (−9), Copycat (−8), Vampire roles (−6) and others wake before her. Werewolves 2, Minion 3, Masons 4, Seer 5, Robber 6, Troublemaker 7, Drunk 8 and Insomniac 9 keep their numbers, with lettered sub-steps for expansion roles (e.g. 2-B Alpha Wolf). [R] The base relative order is unchanged, but the engine should store wake order as a sortable key (e.g. a string or decimal) and not hard-code the base token integers.

Information handed out per step (PRIVATE to the named waker): werewolves learn their partner(s) or "alone" (+ optional one centre card); Minion learns the werewolf list; Masons learn their partner or "alone"; Seer learns one player's role or two centre roles; Robber learns the new role he now has; Insomniac learns her final card; Doppelgänger learns the copied role (and follows up with that role's information).

Engine note: the "wake by original role" rule plus blind choices means decisions never depend on information from another player's step (only the Doppelgänger's own copy and the lone wolf's own "am I alone" feed her own later choice). See App design notes for the simultaneous-night shortcut this allows.

## Voting & resolution

Inputs: `vote[p]` = the other player p points at (every player has exactly one; self and centre are illegal).

Algorithm (all steps are simultaneous in meaning; order below is only bookkeeping):

1. `count[q]` = number of players pointing at q.
2. `max` = highest `count`.
3. If `max <= 1`, nobody dies (this covers a deliberate ring vote where everyone points one seat clockwise and every player gets exactly one vote; the rules explicitly bless agreeing to this before the count). [R]
4. Otherwise every player with `count == max` dies. All tied players die; there is no revote and no tiebreak. [R] (3-way or 4-way ties are possible with enough players.)
5. Hunter cascade: for every dead player whose current card (Doppelgänger: copied role) is Hunter, the player that Hunter voted for also dies, regardless of that target's own count. If a newly dead player is also a Hunter, repeat. Already-dead targets change nothing, so loops terminate. [R for the single-Hunter case; chain and cycle behaviour is [D] from "if the Hunter dies"]
6. The dead set is final. Dead players reveal their cards. Result evaluation uses the dead set only; "how many votes" is irrelevant afterwards.

Pseudo-code:

```
dead = set(); max = max(count.values())
if max >= 2: dead = { p : count[p] == max }
queue = [p for p in dead if role(card[p]) == 'hunter']
while queue:
    h = queue.pop()
    t = vote[h]
    if t not in dead:
        dead.add(t)
        if role(card[t]) == 'hunter': queue.append(t)
```

where `role(card)` is the card's role, or for the Doppelgänger card its `copiedRole` (a Doppelgänger card that copied nothing is a no-ability village card, see edge cases).

Quick vectors (4 players A,B,C,D; vote lists show who each player points at):

| Votes (A,B,C,D) | counts | dead |
|---|---|---|
| B,A,D,C | A1 B1 C1 D1 | nobody (max 1) |
| B,A,B,A | A2 B2 | A and B |
| B,A,A,A with A=Hunter | A3 | A, then Hunter shoots B (A voted B): A and B |
| B,C,D,A | all 1 | nobody |
| B,A,A,B | A2 B2 | A and B |

## Scoring & win conditions

There is no point scoring in the rules: each game has winners and losers. Official multi-game option ("tournament play" in the 2014 rulebook): the winner(s) of each game take a chip; first player to reach a chosen number of chips (the example is five) wins; if tied for most, keep playing until one player leads; large events can use double elimination (a player is out after losing twice). [R14] Suggested app scoring: 1 point per winning player per game plus the running scoreboard the room already keeps; Tanner solo win scored like any other win (house choice, not official).

Definitions at the end of the vote (using final cards, Doppelgänger = copied role):

- `W` = players holding a Werewolf (including a Robber/Drunk/Troublemaker victim who ended up with one, and a Doppelgänger who copied Werewolf).
- `M` = players who are the Minion (Minion card holder, or Doppelgänger-Minion).
- `T` = players who are the Tanner (Tanner card holder, or Doppelgänger-Tanner).
- `D` = dead set from Voting & resolution.

Results:

```
wolfDied   = any(w in D for w in W)
tannerDied = any(t in D for t in T)

villageWins = wolfDied or (len(W) == 0 and len(D) == 0)

tannerWins(t) = t in D                     # each Tanner only if he/she personally died

if len(W) > 0:
    # normal case: Werewolves and Minion(s) win or lose together
    wolfTeamWins  = (not tannerDied) and (not wolfDied)
    minionWins(m) = wolfTeamWins           # even a dead Minion shares it
else:
    # no player is a Werewolf: each Minion plays alone
    minionWins(m) = (m not in D) and len(D) >= 1
    # any other death counts, the Tanner's included; the Tanner block does NOT apply here
```

Who wins what:

- **Village team** (every player whose final card is village team) win iff `villageWins`. The Tanner is NOT on the village team.
- **Werewolf team** (final Werewolf and Minion cards) when at least one player is a Werewolf: win iff `wolfTeamWins`. A dead Minion or dead werewolf still shares the win. Rule text: if the Minion dies and no werewolf dies, the werewolves and the Minion win. [R]
- **Minion with no werewolf players**: the rule text says she wins if one other player (not the Minion) dies [R]. Rulings add that she must also survive, and that a Tanner's death counts as the "other" death, so she can win alongside the Tanner. Bezier Games (official BGG account, 2021): if the werewolves are in the centre and the Tanner dies, the Tanner and the Minion both win. In the Squire+Minion case Bezier also says each needs one other player to die, not themselves. [PUB] Clipper (2022) says the same: "somebody dies but not me", and Tanner + lone Minion both win. [C+]
- **Tanner** wins iff he dies. He can win alongside the village team (if a werewolf also died) [R][PUB], or alongside a lone Minion when no player is a werewolf [PUB]. He never wins alongside werewolves, because his death blocks the werewolf team whenever a werewolf is among the players [R]. Several Tanners (Tanner + Doppelgänger-Tanner): each wins only if he or she personally died [C+].
- Several teams can lose at once (e.g. nobody wins when the Minion alone dies with no werewolf players; Ted Alspach, BGG: "everyone loses. But the Minion loses more" [PUB]). Village and werewolf team can never both win.

Win-condition matrix (every combination; "wolves" = werewolf team incl. Minion):

| # | Situation (after vote and Hunter) | Village | Wolves | Tanner |
|---|---|---|---|---|
| 1 | Werewolf in play, at least one werewolf died, no Tanner died | WIN | lose | (none/lose) |
| 2 | Werewolf in play, werewolf died AND Tanner died | WIN | lose | WIN |
| 3 | Werewolf in play, nobody died (ring vote) | lose | WIN | lose |
| 4 | Werewolf in play, only villagers died | lose | WIN | lose |
| 5 | Werewolf in play, only the Minion died | lose | WIN | lose |
| 6 | Werewolf in play, Tanner died, no werewolf died | lose | lose | WIN |
| 7 | Werewolf in play, Tanner and Minion died, no werewolf died | lose | lose | WIN (Tanner only) [PUB: Ted Alspach, BGG thread 1362902] |
| 8 | No player is a werewolf (both in centre), nobody died | WIN | lose | lose |
| 9 | No werewolf players, a non-Minion, non-Tanner player died, Minion exists and is ALIVE, no Tanner died | lose | WIN (Minion) | lose |
| 10 | No werewolf players, someone died, no Minion in play, no Tanner died | lose | (no members) | lose |
| 11 | No werewolf players, only the Minion died | lose | lose | lose [R + PUB: Ted Alspach, BGG thread 1069779, "everyone loses"] |
| 12 | No werewolf players, Tanner died alone | lose | WIN if some player is the Minion (she is alive) [PUB: Bezier 2021]; otherwise no members | WIN |
| 13 | No werewolf players, Tanner and Minion both died | lose | lose (Minion died) | WIN (Tanner only) |
| 14 | No werewolf players, Tanner and a villager died, Minion alive | lose | WIN (Minion) [PUB: Bezier 2021; C+ Clipper 2022] | WIN |
| 15 | Hunter's shot kills a werewolf | WIN | lose | (as 1/2) |
| 16 | A Robber ended holding a Werewolf card and died | WIN | lose | (as 1/2) |
| 17 | A Robber stole the only werewolf card in play; the original werewolf (now holding the Robber card) died, the thief (now a werewolf) lived | lose | WIN | lose |
| 18 | No werewolf players, Minion AND another non-Tanner player died (tie) | lose | lose (the Minion must survive) [PUB + C+] | lose |

Notes on the cells: rows 1-6, 8 and 10 follow directly from the official text. Row 7 is Ted Alspach's explicit ruling: if the Tanner and the Minion both die, only the Tanner wins. Rows 9, 12-14 and 18 follow the reading of the Minion-without-werewolves text given by the Bezier account and by Clipper: the Minion needs someone else dead and herself alive, and a Tanner's death does not block her. Row 11 is Ted Alspach's explicit ruling. **Corrected in verification:** an earlier draft had rows 12, 14 (and test V8) with the Tanner's death blocking the lone Minion. That reading was never sourced and is contradicted by the 2021 Bezier ruling; it now appears under Common variants.

Also the well-known misreading to avoid: some Chinese blogs say the Tanner "wins only if he dies alone" and that the village wins "instead" when a werewolf dies with him. The official text says both win in that case.

## Edge cases an engine must handle

Setup and roles in play
- Role count must equal `players + 3`; centre is always exactly 3 cards (`validate` returns error otherwise).
- Mason count is 0 or 2.
- A role with its card in the centre is still "in the game": its step is still called and lasts the full time, including `doppelganger-minion` (needs Minion in game) and `doppelganger-insomniac` (needs Insomniac in game), but those two exist only if a Doppelgänger card is in the game.
- Both werewolves in the centre: nobody wakes at step 2 (still called); the Minion sees nobody; village wins only on "nobody died".
- Exactly one werewolf awake: Lone Wolf peek (if the option is on). Peeking costs nothing and changes nothing.
- Both Masons in the centre or only one Mason among players: Masons see nobody.
- Insomniac in the set with none of Robber, Troublemaker, Drunk, Doppelgänger: warn (she will always see her own dealt card), do not block.

Wake-by-original-role
- Robber (step 6) steals the Troublemaker card: the player who started as Troublemaker still wakes at step 7 and swaps; the Robber, now holding the Troublemaker card, does not wake.
- A Werewolf robbed or swapped before step 2 (only possible via Doppelgänger actions at step 1) still wakes as a werewolf at step 2.
- A Mason or Seer swapped by a Doppelgänger-Troublemaker still wakes by original role.
- Only original-role players wake. The Doppelgänger wakes at her own step, then only where her copy dictates.

Doppelgänger
- Legal target: another player's card only. Never centre, never self.
- Copy of Villager/Tanner/Hunter: nothing else at night; she is that role.
- Copy of Seer/Robber/Troublemaker/Drunk: the action happens inside step 1; she never wakes again for it; the real Seer/Robber/Troublemaker/Drunk still act at their own step on the already changed layout.
- Copy of Werewolf: wakes at step 2 and counts as awake werewolf (kills the lone-wolf peek for a real lone werewolf); team = werewolf; the Minion sees her thumb.
- Copy of Mason: wakes at step 4; team = village.
- Copy of Minion: sees werewolves in `doppelganger-minion`; does not wake at step 3; team = werewolf.
- Copy of Insomniac: wakes at `doppelganger-insomniac`; sees her own current card.
- The copied role travels with the Doppelgänger CARD: if another player ends up holding that card (Robber robbed her, Troublemaker swapped it, Drunk took it from the centre after a Doppelgänger-Drunk put it there), that player is the copied role. [R]
- Robbed Doppelgänger who copied Insomniac: she still wakes at `doppelganger-insomniac` (original role) and sees whatever card she now holds.
- Robber robs the Doppelgänger: he sees a Doppelgänger face and is silently the copied role; he is not told what that was.
- Doppelgänger-Robber robs a Werewolf: the Doppelgänger now holds a Werewolf card (is a werewolf for winning, never woke as a werewolf), and the original werewolf now holds the Doppelgänger card, which carries "Robber" (village).
- Doppelgänger-Drunk: swaps her Doppelgänger card with a centre card; the Doppelgänger card (copy = Drunk) now sits in the centre.
- A Doppelgänger card that never copied anyone (it started in the centre and the Drunk took it) has no copied role: treat as a plain village-team card with no ability. [PUB: Ted Alspach, BGG thread 1067944, "just a plain old villager"]
- Doppelgänger who copies the Tanner: she is a Tanner; each Tanner wins only if he or she personally died. [C+: Clipper, BGG thread 2821862] Either Tanner's death blocks the werewolves.

Night actions
- Seer: either one other player's card or two distinct centre cards; may choose to do nothing; cannot view herself.
- Robber: may decline; cannot target the centre or himself.
- Troublemaker: may decline; two distinct other players; cannot include himself; cannot include centre cards.
- Drunk: mandatory swap with a centre card he chooses; sees nothing; his old card now in the centre.
- Insomniac: sees the final card after Robber, Troublemaker, Drunk and Doppelgänger swaps.
- All swaps are on cards, not people: you are the role of the card in front of you at the END of the night.
- No one may look at any card after the night. Do not offer "show my current role" anywhere in the day UI. A memory aid showing only what you were dealt and what you learned is fine.

Voting and deaths
- Every player must point at another player; self-votes and abstentions are illegal; centre cards cannot be voted for.
- Votes are revealed simultaneously.
- `max <= 1` means nobody dies (all-ones ring vote, or everyone distinct).
- Ties at `max >= 2` kill all tied players (2, 3 or 4 of them).
- Hunter's target dies even with zero votes. If the target is already dead nothing more happens.
- Hunter chain: Doppelgänger-Hunter or a card swap can make two Hunters; each dead Hunter shoots; cycles terminate.
- Hunter whose card was swapped is no longer the Hunter; the new holder is. The vote of the current Hunter-card holder is his shot.
- Hunter kills the Tanner: Tanner wins. Hunter kills a werewolf: village wins even if the Hunter's own side voted wrongly.

Winning
- Wolves-in-centre + nobody dies = village win; wolves-in-centre + any death = village loss.
- A dead Tanner blocks the werewolf team whenever at least one player is a Werewolf. [R][PUB] It does NOT block a surviving Minion when no player is a Werewolf: Tanner and Minion both win. [PUB: Bezier Games, BGG thread 2598353, 2021] (Corrected; an earlier draft had the opposite.)
- Lone Minion (no werewolf players) who dies: loses, even if another player died with her in a tie. [PUB + C+]
- Village team can win with villagers dead as long as one werewolf died.
- If any werewolf died the werewolf team cannot win; a dead Minion alone does not stop the werewolf team from winning.
- Two Minions (Minion card plus Doppelgänger-Minion) with no werewolf players: no ruling found for this exact pair. Default, by analogy with the Bezier Squire+Minion ruling where each wins if the other dies: each Minion wins iff she is alive and at least one other player (the other Minion counts) died.
- A winner list must be computed per player (final card), never per original role.

## Common variants

- **Lone Wolf**: official *option* (labelled as such in the rulebook and the 2023 narration sheet), recommended default ON. BGG consensus (thread 1291986) is that it is a variant "considered by most to be essential", because it gives a lone werewolf a centre card to claim as cover. [R][C]
- **Official app / narrator timing**: the free Bezier app calls the roles, plays background noise and runs a day timer whose speed can be adjusted. Bezier also publishes a printable narration sheet (©2023, file name "Online Narration") with scripts for every base role, the Doppelgänger-Minion and Doppelgänger-Insomniac. [R]
- **Different sets**: single werewolf, random full deal, no Villager cards (everyone special). Official suggestions. [R]
- **Learning rule**: leave Doppelgänger, Tanner and Hunter out of the first games; add roles gradually. Reported as standard advice in Chinese guides (popular in CN/TW groups). [C]
- **Day timer length**: about 5 minutes is the figure quoted in Chinese guides for 6-10 players; the publisher's own app mock-up shows 10:00. [C]
- **Ring vote to force no-kill**: officially allowed when all agree before the count. Popular among groups who suspect both werewolves are in the centre. [R]
- **Tournament / chips**: official tournament mode (first to a chip target; double elimination for big events). [R14]
- **Shift-your-cards vs Announcer nudge**: the Getting Started Guide (current, and the same in the 2014 booklet) has the Announcer nudge the cards after the night; the 2023 narration sheet has every player shift their own card. Both exist only to hide movement. [R][R14] (Not needed in the app.)
- **Expansions** (not implemented here): Daybreak (破曉, 11 new roles including Alpha Wolf, Apprentice Seer, Curator), Bonus Roles, Vampire, Alien, Super Villains. Each adds wake-order slots (the official "Wake Order 5.0" is one sorted list across all One Night games, with the Doppelgänger at −7). [R]
- **Lone Minion + dead Tanner, alternative reading** (not official): some groups, and an earlier draft of this doc, let the Tanner's death block the Minion even when no player is a werewolf. The 2021 Bezier ruling says both win. Offer it only as a house-rule toggle, default OFF.
- **Lone Minion, literal reading** (not official): read word for word, the rule text ("one other player (not the Minion) dies") would let a Minion who dies in a tie with another player still win. Rulings say she must survive. House-rule toggle, default OFF.
- **Lone-Minion house rules** (Ted Alspach welcomed homebrew fixes on BGG): treat a lone Minion as a werewolf for win purposes, so the village wins by killing her; or always pair the Minion with the Tanner. [C]
- **Point at the centre = vote for nobody**: a much-discussed house rule (BGG threads 1421899 and 1422062). Not official; the official way to kill nobody is the agreed circle vote. [C]
- **Not official, avoid**: re-voting on ties, letting werewolves know the Minion, allowing abstain, letting dead players speak, letting players re-peek at their card after the night.
- **Reported Chinese/Japanese naming variants**: 守夜人 / 共濟會 / 石匠 for Mason; 預言家 / 先知 for Seer; 皮匠 / 制革匠 for Tanner. Keep the Taiwan names in the UI and list aliases in the glossary.

## App design notes

State model
- `original[pid]` = dealt role (immutable; decides who wakes). `cards[pid]` and `centre[1..3]` hold card objects `{ role, copiedRole? }`; swaps move whole card objects, so a Doppelgänger card keeps its `copiedRole`. `finalRole(card) = card.role === 'doppelganger' ? (card.copiedRole ?? 'villager') : card.role` (copiedRole absent = ability-less village card). Log every night event (`who, step, action, positions before/after`) for the end-of-game replay.
- Engine contract fit: `cue` ids per step, e.g. `night:doppelganger:open`, `night:werewolf:open`, `night:doppelganger-minion:open`; `focus(state)` names the original-role holders for the current step (with `anonymous: '預言家請拎起部手機'` on a shared phone); `autoAct` = Seer looks at a random centre pair, Robber/Troublemaker decline or random, Drunk random centre card, Doppelgänger random player, vote random legal.

What must stay private (never in any other seat's view)
- Dealt role, copied role (even the holder of a robbed Doppelgänger card only sees a Doppelgänger face), all night results, the current card in front of anyone, and centre card identities. Public: `roleList` (counts of roles in play, as the official tokens show), seat order, the current night step number, vote tallies and the dead players' revealed cards.
- Never send an unfiltered state object to clients; build per-seat whitelist views. During the day, a seat's view must not include its CURRENT card. Offer only a "reminder": what I was dealt and what I learned at night.
- The host phone holds the full state, so a technical host can peek (same trade-off as the other games in this project: accepted because the app is free, serverless and played between friends).

Narrator needs (Cantonese, host phone only; own wording, not the official script)
- Needed: night start, one cue pair (open/close) per step, dawn, vote countdown, timer warnings. Everything else is automatable.
- Suggested lines (paraphrase function, tune for TTS):

| step | suggested Cantonese cue |
|---|---|
| start | 天黑請閉眼。 |
| doppelganger | 化身幽靈請睜眼，揀一個人睇佢張牌，你而家就係佢嘅角色；如果有夜晚行動，即刻做。化身幽靈請閉眼。 |
| doppelganger-minion | 如果你而家係爪牙，請保持睜眼，其他人閉眼。狼人請伸出拇指。狼人收返拇指，化身幽靈請閉眼。 |
| werewolf | 狼人請睜眼，睇下有冇其他狼人。(獨狼：你可以睇中間一張牌。)狼人請閉眼。 |
| minion | 爪牙請睜眼。狼人請伸出拇指，等爪牙認得你哋。狼人收返拇指，爪牙請閉眼。 |
| mason | 守夜人請睜眼，睇下另一個守夜人係邊個。守夜人請閉眼。 |
| seer | 預言家請睜眼，你可以睇一個人嘅牌，或者睇中間兩張牌。預言家請閉眼。 |
| robber | 強盜請睜眼，你可以同另一個人換牌，然後睇你新嗰張。強盜請閉眼。 |
| troublemaker | 搗蛋鬼請睜眼，你可以交換另外兩個人嘅牌，唔准睇。搗蛋鬼請閉眼。 |
| drunk | 酒鬼請睜眼，同中間一張牌交換，唔准睇。酒鬼請閉眼。 |
| insomniac | 失眠者請睜眼，睇返自己張牌有冇變。失眠者請閉眼。 |
| doppelganger-insomniac | 如果你睇咗失眠者，化身幽靈請睜眼，睇返自己張牌。化身幽靈請閉眼。 |
| dawn | 天光喇，大家睜眼。 |
| vote | 時間到，三、二、一，投票！ |

- All cues for roles that are in the game are played even if the card is in the centre, each with the same fixed length plus padding, so listeners cannot tell that a role is absent. Never skip a cue early because the actor finished.

Anti-tell
- Eyes-closed physical night leaks through tap noise, reaching, screen glow and uneven silence. With phones nobody needs closed eyes: give every seat an equal-shaped decoy (fake pick-a-card with the same tap count and duration) at every step, mute SFX on non-host phones, keep brightness low, no haptics. The official remedy was the Announcer tapping the table; the app's remedy is decoys and fixed durations.
- Show "N of M done" counters, never names, so the dashboard does not reveal who still has a role.
- Fixed per-step durations: 10 s base (matches the official silent count), 15 s for the Doppelgänger (two choices), 12 s for the Seer; 1.5x for first-timers. The step never ends early.

Fully automated on phones (no human moderator)
- Dealing, centre cards, all swaps, who-sees-what, lone-wolf logic, vote tally, tie rule, Hunter cascade, winner computation, scoreboard, final replay. The only human actions are the choices themselves and talking.
- **Simultaneous-night shortcut (recommended default).** Because every night choice is blind (no actor's choice depends on another player's information, except the Doppelgänger's own copy and the lone wolf's own peek), all phones can collect choices in one window and the engine applies them in wake order afterwards. Use a 2-stage screen for everyone: stage 1 shows each seat their own role card and (if they have an action) the picker, with equal-looking decoys for others; the Doppelgänger gets stage 1b (pick player, see copy, then the picker for the copied action, all on her phone only); every werewolf-waker pre-selects a centre card "in case you are alone" and the engine uses it only if exactly one werewolf is awake. Stage 2 delivers each seat's night report (same screen layout and length for all; non-informed roles see an "all quiet" decoy). Narration becomes optional atmosphere.
- Classic narrated night (sequential, host phone speaks, only the called role's phone lights up with decoys elsewhere) remains available for groups who like the ritual.

Host-moderator dashboard (when the host is a non-playing referee or just wants control)
- Step list with current step, timers, skip/extend, per-step "done" counters (no names), stall controls ("代佢做" auto-act), vote progress "已投 4/6", pause, override timer, and after the game the full night log. Do not show roles during the game for a playing host.

ONE shared phone
- Seat-order pass-around with fixed-length slots (PassGate between seats, as the framework already defines). Pass 1: each seat sees its role (hold to peek), then its blind action screen of fixed length (decoy if no action). The Doppelgänger gets the same-length two-stage screen others see as a decoy. Between passes the engine resolves the night. Pass 2: each seat collects its night report on an equal-length screen. Votes are sequential secret picks, then one simultaneous reveal. The "table centre, role picks up phone" style leaks who holds which role by who reaches, so avoid it for onuw.

Other design notes
- Presets from Setup by player count; validator per the rules above; warnings for Insomniac without swappers and for fewer than half village-team cards.
- Day UI: timer with +60 s, an "everyone ready to vote" early-vote button (host-confirmed), a ring-vote helper (assigns each vote to the next seat if all tap agree; leads to max = 1 and no deaths), and rules sheet (30-second version + role glossary with aliases).
- Results screen explains why, using the log, e.g. "強盜搶咗狼人張牌，所以強盜先係狼人" and lists winners per player.
- Recovery: seats persist through reconnects; re-send the per-seat view; night collection windows are re-openable only for seats that have not submitted.

Suggested unit-test vectors (4 players A,B,C,D, final cards; votes listed A,B,C,D):

| id | final cards | votes | dead | winners |
|---|---|---|---|---|
| V1 | A=Werewolf, B=Villager, C=Seer, D=Villager | B,A,D,C | none | wolves (A) |
| V2 | same | B,A,B,A | A,B | village (C,D,B) |
| V3 | A=Hunter, B=Werewolf, C=Villager, D=Villager | B,A,A,A | A, then B (Hunter shot) | village |
| V4 | A=Hunter, B=Tanner, C=Werewolf, D=Villager | B,D,A,A | A, then B | Tanner only |
| V5 | A=Villager, B=Seer, C=Robber, D=Villager (both wolves in centre) | B,C,D,A | none | village |
| V6 | A=Minion, B=Seer, C=Villager, D=Villager (wolves in centre) | B,A,B,B | B | Minion (A) only |
| V7 | A=Minion, B=Seer, C=Villager, D=Villager (wolves in centre) | B,A,A,A | A | nobody |
| V8 | A=Tanner, B=Seer, C=Villager, D=Minion (wolves in centre) | B,A,A,A | A | Tanner (A) and Minion (D) (corrected per Bezier 2021 ruling; was "Tanner only") |
| V9 | A=Werewolf, B=Minion, C=Seer, D=Villager | B,A,B,B | B | wolves (A,B) |
| V10 | A=Werewolf (a Robber who stole it), B=Robber (the original werewolf), C=Seer, D=Villager | B,A,A,A | A | village (B,C,D) |
| V11 | A=Tanner, B=Werewolf, C=Seer, D=Villager | B,A,A,B | A,B | Tanner and village (A,C,D) |
| V12 | A=Minion, B=Seer, C=Villager, D=Villager (wolves in centre) | B,A,A,B | A,B (tie 2-2) | nobody (lone Minion died) |
| V13 | A=Tanner, B=Minion, C=Werewolf, D=Villager | B,A,A,A | A | Tanner only (werewolf among players, so the Tanner's death blocks the wolf team, Minion included) |
| V14 | A=Minion, B=Minion (Doppelgänger-Minion), C=Villager, D=Villager (wolves in centre) | B,A,A,B | A,B | nobody (both Minions died) |
| V15 | same as V14 | B,A,B,B | B | A (the surviving Minion; default by analogy with the Bezier Squire+Minion ruling, see open question 1) |

## Sources

Primary (read directly)
- Official rule booklet "One Night Roles" (6 pp), Bezier Games: https://cdn.shopify.com/s/files/1/0740/4855/files/ONUW_rules-updated_for_BGG.pdf
- Official Getting Started Guide (setup, night, day, game end, tokens, tips): https://cdn.shopify.com/s/files/1/0740/4855/files/ONUW_Getting_Started_for_BGG.pdf
- Official Online Narration guide (night scripts incl. Doppelgänger-Minion and Doppelgänger-Insomniac steps, Lone Wolf script): https://cdn.shopify.com/s/files/1/0740/4855/files/ONUW_Online_Narration.pdf
- Official wake-order list across all One Night games: https://cdn.shopify.com/s/files/1/0740/4855/files/Wake_Order_5.0.pdf
- Older 2014 rulebook (tournament play, announcer card-shuffle step), library-hosted copy: https://weizmann.libanswers.com/loader?fid=13106&type=1&key=f91f75d7cc37020ea956f897dcd6c57d
- Publisher product page and combination blog: https://beziergames.com/products/one-night-ultimate-werewolf and https://beziergames.com/blogs/news/one-night-ultimate-werewolf-combinations

Secondary
- Role sets for 3, 6, 9 players: https://nerdist.com/article/our-favorite-rolesets-for-one-night-werewolf/
- Rules summaries: https://www.ultraboardgames.com/one-night-ultimate-werewolf/game-rules.php and https://www.ultraboardgames.com/one-night-ultimate-werewolf/roles.php ; https://www.geekyhobbies.com/one-night-ultimate-werewolf-party-game-rules-explained-with-pictures/ ; https://familygameshelf.com/2023/08/01/how-to-play-one-night-ultimate-werewolf/ ; https://revneads.wordpress.com/2015/04/16/onuw-one-night-ultimate-werewolf-daybreak/
- Traditional Chinese names and rule summaries: https://home.gamer.com.tw/creationDetail.php?sn=2736503 ; https://arsl4000.pixnet.net/blog/posts/7102786610 ; http://bgnachimu.blogspot.com/2015/02/one-night-ultimate-werewolf.html ; https://mgzblog.pixnet.net/blog/posts/14012563317 ; http://gamesoncloud.blogspot.com/2014/06/one-night-ultimate-werewolf.html ; Taiwan retail listing https://www.phantasia.tw/bg/home/3755 ; simplified-Chinese guide (no role lists; beginner advice, 5-minute day, "6-10 players") https://avalontactics.com/board-game-guides/ultimate-werewolf-one-night-rules-guide
- Japanese summaries: https://kyoheiomi.com/board-game/variant-rules/one-night-ultimate-werewolf ; https://boku-boardgame.net/one-night-ultimate-werewolf
- Strategy/role pages (via search snippet only; site failed to load): http://onenightultimate.com/

BGG threads (originally second-hand). During verification every thread below was read directly via `https://api.geekdo.com/api/articles?threadid=<id>`; the file page 98229 was not opened.
- https://boardgamegeek.com/thread/1069779/minion-effect-with-no-werewolves
- https://boardgamegeek.com/thread/1096963/question-what-if-minion-dies-alone-no-werewolf-con
- https://boardgamegeek.com/thread/1362902/what-if-tanner-and-werewolf-dies
- https://boardgamegeek.com/thread/2014982/no-player-is-a-werewolf-but-one-player-is-a-minion
- https://boardgamegeek.com/thread/1067944/doppelganger-in-middle-taken-by-drunk
- https://boardgamegeek.com/thread/1244073/doppelganger-faq
- https://boardgamegeek.com/thread/1150466/win-condition-guide and https://boardgamegeek.com/filepage/98229/one-night-ultimate-werewolf-win-condition-quick-re
- https://boardgamegeek.com/thread/1860094/recommended-roles-for-678910-players
- Added in verification: thread 2598353 (Bezier Games official account, 2021: lone Minion + dead Tanner both win; lone Minion must survive), 2940622 (Clipper 2022: same), 2821862 (each Tanner wins only if personally dead), 1195006 (Robber does not use the stolen role; designer post), 3137895 (no abstain/self-vote), 3263228 (designer: wolves in centre, any death means village loses), 1291986 (Lone Wolf is a variant), 2462339 (Bezier: Doppelgänger-Werewolf card swapped means the new holder is the werewolf), 2977619 (optional vs mandatory actions)
- BGG item data and versions (Chinese edition = Playfun Games 2015; no Japanese edition listed): `https://api.geekdo.com/api/geekitems?objectid=147949&objecttype=thing` and `https://api.geekdo.com/api/geekitem/linkeditems?linkdata_index=boardgameversion&objectid=147949&objecttype=thing`

**Open questions for the project owner**

1. Two Minions with no werewolf players (Minion + Doppelgänger-Minion): no ruling for this exact pair. The default follows the Bezier Squire+Minion analogy: each Minion wins iff she is alive and at least one other player died. A Tanner's death counts and does not block her.
2. Hunter chain and cycles: rule text is single-Hunter; the engine applies the cascade logically.
3. A centre Doppelgänger card taken by a Drunk is ability-less village. Now verified: Ted Alspach, BGG thread 1067944.
4. Lone Wolf default: ON.
4a. Expose the two lone-Minion house rules (Tanner blocks the lone Minion; literal reading where a dead Minion can still win) as toggles, default OFF?
5. Primary Seer name in the UI: 預言家 with 先知 as alias. Taiwan sources are split, so this is a choice, not a fact.
6. Decide whether the app should let a robbed Doppelgänger holder be told his copied role at the end only (current plan) or never until reveal.

## Verification

Adversarial fact-check pass, 2026-10-03 (UTC). Method: re-read the four Bezier PDFs and the 2014 booklet page by page as images. Then checked every outcome-relevant claim against different sources where possible:

- BGG forum threads, read directly through the geekdo JSON API, including designer (user 24301) and official Bezier account (user 2364000) posts.
- BGG item and version data.
- Nerdist and the avalontactics guide, re-read to check the role sets credited to them.
- Three Taiwan write-ups and two Japanese write-ups.

**Confirmed unchanged:**
- Card pool (16 cards, 16 tokens).
- Player range 3-10 and `players + 3` cards.
- Official 3/4/5-player sets.
- Every role ability and team.
- Doppelgänger sub-steps (Minion thumbs at the end of her phase; Doppelgänger-Insomniac after the Insomniac).
- The copied role travels with the Doppelgänger card.
- Lone Wolf as an official option.
- Masons always used as a pair.
- Insomniac only with Robber and/or Troublemaker.
- Base wake order 1-9 plus 9a.
- Vote: point at another player; most votes die; all tied players die; max ≤ 1 means nobody dies; the circle vote is blessed.
- Hunter's target dies regardless of votes.
- Village, werewolf and Tanner win text.
- Tournament chips (first to a target such as five; tie means keep playing; double elimination).
- Designers and artist, Okui's original (January 2013).
- Win-matrix rows 1-8, 10, 11, 13, 15-17.
- Test vectors V1-V7 and V9-V11, recomputed by hand.
- The base-deal probability table, recomputed: P(both wolves in centre) = 3 / C(n+3, 2), etc.

**Changed (outcome-relevant):**
1. Lone Minion + dead Tanner (no werewolf among players). The draft said the Tanner's death blocks the Minion. Bezier Games' official BGG account (2021) rules that Tanner and Minion both win, and Clipper (2022) agrees. Fixed: pseudo-code, matrix rows 12 and 14, test V8 (now "Tanner and Minion"), Tanner role row, edge-case list, open question 1. The old reading moved to Common variants.
2. Lone Minion must survive. The draft's formula let a Minion who dies in a tie with another player still win. Rulings (Bezier 2021: each needs one other player to die, not themselves; Clipper: "somebody dies but not me"; two Taiwan write-ups: 自己活著) say she must survive. Fixed: formula, row 9, new row 18, new vectors V12-V15. The literal reading is noted under Common variants.
3. Two-Minion default changed from "another died and no Tanner died" to "she is alive and anyone else died", by analogy with the Bezier Squire+Minion ruling.

**Changed (sourcing / facts):**
4. Role sets. The 7-player "Nerdist" set and the 6/7-player "Chinese guide" sets do not exist in those sources (Nerdist covers only 3/6/9; avalontactics gives no lists). Replaced with BGG thread 1860094 sets for 6-10, including a real base-only 10-player set. The derived alternatives are kept and marked [D]. The "half village" heuristic is marked unsourced.
5. Chinese publisher. "新天鵝堡 (Swan Panasia)" is unconfirmed; BGG lists the Chinese edition 一夜終極狼人 (2015) as Playfun Games. Added the Korean edition.
6. Japanese title. BGG lists no Japanese edition, so the Japanese titles are blog names. Added ワンナイトアルティメット人狼.
7. Mason alias. "CN/JP: 共濟會員" was wrong for Japanese, which uses フリーメイソン / 石工.
8. Seer name. "Taiwan edition = 預言家" is softened: Taiwan sources use both 預言家 and 先知.
9. Best player count. The "6-8 sweet spot" did not match the cited sources (Nerdist 5-6; avalontactics 6-10).
10. End-of-night card nudge. The Announcer-nudge version is not just "older": it is in the current Getting Started Guide too. The everyone-shifts version is from the 2023 narration sheet.
11. "Silent count to ten" was tagged [R14] only; it is also in the current guide, so now [R].
12. Vote countdown wording differs between the guide and the narration sheet; noted.
13. Full card reveal at game end is common practice [C]; the rules only make the dead reveal.
14. Token numbering. The tokens carry 1-9 only (no 9a; Villager, Tanner and Hunter tokens are unnumbered). Added the Wake Order 5.0 renumbering (Doppelgänger −7) as an engine expansion-proofing note.
15. Ruling tags upgraded from second-hand to read directly: Drunk takes an unused Doppelgänger card means "plain old villager" (Ted Alspach); only the Minion dies with no wolves means everyone loses (Ted Alspach); Tanner + Minion die with wolves in play means Tanner only (Ted Alspach).
16. Added house rules seen on BGG: point at the centre to vote nobody; treat a lone Minion as a werewolf.

**Not verified / residual doubt:** The BGG best-player-count poll could not be read (API returns 401). The physical card faces of the Chinese edition were not seen. Hunter chains and cycles have no ruling (logic only). The Bezier 2021 Minion ruling comes from the publisher's community account, not Ted Alspach himself; it defers to "Jorgen" for fringe cases. The two-Minion case has no direct ruling.
