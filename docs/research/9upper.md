# 9UPPER 瞎掰王 — rules reference

> Paraphrased for engine implementation. Not a copy of the official rulebook.

Research date: 2026-10-03 UTC (fact-checked the same day, see "Verification"). Confidence notes: no downloadable rulebook PDF was found (Time2Play's Shopline store now redirects to shoplineapp.com, BG Walker's "rulebook download" slot is empty, BGG is behind a Cloudflare challenge). However, two **photographed printed rulebooks** were read directly: the component page of the TW base-game rulebook (狗吠火車, first print, photo in the Punch Board Game write-up) and the complete three-panel TW 看圖掰 rulebook (same publisher, same rules engine, photo in the Punch 看圖掰 write-up). Those photos are treated as the primary source. The rest is reconciled from Traditional-Chinese write-ups that paraphrase the printed rulebook (Punch Board Game, 2E blog, Beast of Boardgame, BoardSheep; UpToGo 2026 is largely derived from Punch and is not independent), the TW publisher's two zeczec crowdfunding pages, HK retailer blurbs, the SDGs edition write-up, and the independent "9UPPER Online" web/Android app. Where they disagree it is listed; the engine should expose the disagreement as a config option. Items that could not be verified are flagged **unverified**.

## Identity

| Field | Value |
|---|---|
| EN name(s) | 9UPPER (BGG: "9upper 瞎掰王", transliteration "Xia Bai Wang"). The printed role cards carry English labels **THINKER / REALUPPER / 9UPPER** (seen on TW base-game and 看圖掰 cards; the 看圖掰 rulebook glosses the roles as 想想 (thinker), 老實人 (realupper), 瞎掰人 (9upper)). English retail copy (SG Boardgame Design) says "Thinker / Truthteller / 9upper"; GeTheMall's English title is "9UPPER Shit talking". |
| 繁中 name(s) | **HK**: 9UPPER 瞎掰王 (Yoho lists volume 4 as 狗噏當秘笈《9UPPER 瞎掰王》4, so 狗噏當秘笈 looks like a retail tagline rather than the series name). **TW**: 瞎掰王 (9upper). HK role names: 諗樣 / 老實人 / 9upper. TW role names: 想想 / 老實人 / 瞎掰人. The name is a Cantonese pun stated by the publisher: the rulebook's first panel glosses "9up" as 狗噏 (talking rubbish with no basis), and GeTheMall's HK copy says the same. That the digit also echoes the 9-second step is speculation. |
| Player range | 3-9 official. A 2-player variant is said to exist (2E blog: 「兩人有變體規則」; UpToGo repeats it) but neither gives its text and it is not on the photographed 看圖掰 rulebook panels: **unverified**, out of project scope. **Project scope: 3-9.** |
| Best count | No official statement. UpToGo calls 5-7 the sweet spot (enough bluffers to collide, not yet chaotic); 3-4 is fast with sharper interrogation; 8-9 is loud and chaotic. Maths: a Thinker guessing blind hits the honest player with probability 1/(N-1) (50% at 3, 12.5% at 9). |
| Play time | Printed 9-19 min (HK) or 9-99 min (TW, "scalable"). One round is about 3-6 minutes of talking; a full game is N x laps rounds (see Setup). |
| Age | 9+ (HK/TW base game); 15+ for 看圖掰; 18+ for 酒GAME版. |
| Publisher / designer | Publisher: **TIME2PLAY GAMES (Hong Kong)**, first released 2021 (BGG). Designer: BGG lists "(Uncredited)"; the Beast of Boardgame blog credits "Costo" as designer and artist (single source). Licensed to Taiwan in 2022: **狗吠火車 (DogBarkTrain)**; TW edition crowdfunded on 嘖嘖 (zeczec) 2022-11-30 to 2023-01-10 (UTC+8), first shipments December 2022, second print by mid-2023; BGG lists a "Traditional Chinese edition 2023" and a Simplified Chinese version (2023). Time2Play's founder says about 40,000 copies sold in HK (boardgamecafe.net interview, Dec 2025). HK retail HK$220 (GeTheMall, WOB, BG Walker). BGG weight about 1.5 / 5 (UpToGo quotes 1.50), category Party Game, mechanic "Player Judge". |
| Physical components the app must replace | Per the photographed TW rulebook component panel: (1) Term cards (題目牌), double sided: term on the black face that everybody sees, true explanation on the reverse; **239** in the TW first print (9 + 2 + 239 = 250 cards, which matches Punch's sleeve count of 250 and Beast's "250 cards"). Later TW boxes are sold as "300 game cards" (DogBarkTrain listing; the 9upper2 campaign also says 主遊戲一盒 300張遊戲牌), which fits the 50 extra terms the publisher added for everyone during the first campaign (inference: 239 + 50 + 11 = 300); campaign backers also got 50 exclusive terms. HK box counts after volume 1 were not checked. 看圖掰 has 232 term cards (243 total). Three difficulty levels. (2) Role cards (角色牌): 9 = 1 Thinker + 1 honest + 7 bluffers. (3) Function cards (功能牌): 2 (收皮啦 in HK, 公三小 in TW). (4) Score tokens (指示物): 25 discs in four denominations: 18 of the 1- and 3-point kind, 7 of the 5- and 10-point kind. (5) Rulebook. (6) Human acts the box cannot do: closing eyes for 9 s and tapping the table to mask card movement, counting the 9 seconds aloud together, secretly peeking at the card back. |

### Terminology (繁體中文, HK vs TW)

| EN | HK (Cantonese, Time2Play) | TW (狗吠火車) |
|---|---|---|
| Thinker / judge / guesser | 諗樣 | 想想 |
| Honest player / truth-teller | 老實人 | 老實人 |
| Bluffer | 9upper (9-upper) | 瞎掰人 |
| Callout card (rulebook category: 功能牌, function card) | 收皮啦 (card name; also shouted "stop talking rubbish") | 公三小 (base game), 練肖話！ (看圖掰 edition), 你給我惦惦 (SDGs edition) |
| Printed English role labels | THINKER / REALUPPER / 9UPPER | same |
| Fact card / term card | 題目卡 / 冷知識卡 | 題目卡 |
| Difficulty level | 等級 1/2/3 | 等級 1/2/3 |
| Bluffing as an activity | 9up, 狗噏, 吹水 | 瞎掰, 講幹話 |
| Score token | 分數指示物 | 分數標記 / 指示物 |
| Eyes-closed step | 閉眼 9 秒 | 天黑請閉眼 (informal) |
| 9UPPER Online app roles | Thinker = 想想 / 諗樣, Truth-Knower = 老實人, Bluffer = 瞎掰人 / 9upper | same |

## Roles

No role has a night ability in the Werewolf sense. Roles are re-dealt every round (the Thinker seat rotates, the other N-1 players redraw from a deck of 1 honest + N-2 bluffers). There are no formal teams; points are individual. Effective alignments: the Thinker and the honest player both score when the Thinker picks right; each bluffer scores only when the Thinker wrongly picks that bluffer.

| id | EN | 繁中 | team | ability (precise) | acts at night? when? |
|---|---|---|---|---|---|
| `thinker` | Thinker / judge | 想想 (TW), 諗樣 (HK) | public judge side | Identity is public. Takes the function (callout) cards. Never sees the explanation. Invites the other players to speak in any order they like and may ask any question about the term, but **may not ask a player about their role** (看圖掰 rulebook, step 3). May play the callout card on one player, at most once per round. Finally names exactly one other player as the honest player. Cannot name self. Scores per Scoring. | Does not open eyes at the 9-second step; counts down with everyone else (the rulebook has all players count the 9 seconds together). |
| `honest-player` | Honest player / truth-teller | 老實人 | truth side (scores with the Thinker if identified) | Exactly one per round. Privately reads the explanation during the 9-second eyes-closed step, returns the card, then must answer questions consistently with the card only. May say the card has no information on a detail instead of inventing it. Gains D points if the Thinker picks them. | **Yes**: the only player who opens eyes during the 9-second step (once, 9 s max). |
| `bluffer` | Bluffer / 9upper | 瞎掰人 (TW), 9upper (HK) | bluff side (each for self) | N-2 per round. Never sees the explanation (sees only the public term and any printed hints). Must invent a confident explanation, may cross-examine others, and wants the Thinker to pick them. Does not know who the other bluffers or the honest player are. Gains D points if the Thinker wrongly picks them; loses 1 if hit by a correct callout. | No (keeps eyes closed and may tap the table to mask the honest player's movement). |
| `callout-card` (item, not a role) | Callout card | 收皮啦 / 公三小 | held by the Thinker | Placed face-up in front of one chosen player during questioning to say "I think this one is bluffing". Identity is not revealed on placement; it is settled at the final reveal. **At most one may be played per round**: the 看圖掰 rulebook says 「每回合一次」 even though its box, like the base box, contains 2 function cards and the Thinker takes them (Punch, UpToGo). The 2E blog states the same one-per-round limit for the base game. | n/a |

### Optional and expansion roles (not in the base game)

| id | EN | 繁中 | source / status | ability |
|---|---|---|---|---|
| `bluff-emperor` | Bluff Emperor | 瞎掰帝 | Taiwan expansion 接著掰 (9upper2, crowdfunded 2023, needs the base game) | A special bluffer role. Marketing copy only says this player must spin a convincing story whatever direction is given. Exact mechanic and scoring were not retrievable: **unverified**. The 9UPPER Online app implements a "9UP King" in this slot (see App notes), but that is the app's own design. |
| `hype-hound` | Hype Hound | 帶風向者 | 9UPPER Online app only (unofficial) | Bluffer who privately gets a "leader" to steer the Thinker toward. |
| `accomplice` | Accomplice | 共犯 | app only | Two bluffers share a false direction and know each other. |
| `hindered-truth-knower` | Hindered Truth-Knower | 受阻老實人 | app only | Honest player with a reading handicap (mask, distortion, five-second window); pays more if picked. |
| `dream-teller` | Dream Teller | 報夢者 | app only | Bluffer who is handed a plausible-but-wrong answer and tells it sincerely. |

## Setup by player count

The role deck is always: 1 Thinker + 1 honest + (N-2) bluffers (N cards). Every player starts with a 3-point token (3 points). **Round 1**: the whole N-card role deck, Thinker card included, is shuffled and dealt one per player; whoever gets the Thinker card reveals it and takes the function cards (看圖掰 rulebook setup step 1; 2E, Beast and BoardSheep agree; Punch instead says "pick a player", which is equivalent for the engine). **Later rounds**: the player to the left of the previous Thinker becomes Thinker and only the other N-1 cards ({1 honest, N-2 bluffers}) are re-dealt.

"Laps" = how many times every player takes the Thinker seat. This is **explicit in the printed rulebook**: its end-of-game table is headed 「每個人作想想的次數」 (times each person is Thinker): 3 at 3-4 players, 2 at 5-7, 1 at 8-9 (seen on both the TW base-game and 看圖掰 rulebook photos; Beast says the same in 圈 / laps). The 2E blog's "3回合" wording should be read the same way.

| N | Thinker | Honest | Bluffers | Blind-guess hit rate 1/(N-1) | Official laps | Total rounds (N x laps) | Status |
|---|---|---|---|---|---|---|---|
| 2 | - | - | - | - | - | - | Variant exists, rules **unverified**; not supported |
| 3 | 1 | 1 | 1 | 50.0% | 3 | 9 | official |
| 4 | 1 | 1 | 2 | 33.3% | 3 | 12 | official |
| 5 | 1 | 1 | 3 | 25.0% | 2 | 10 | official |
| 6 | 1 | 1 | 4 | 20.0% | 2 | 12 | official |
| 7 | 1 | 1 | 5 | 16.7% | 2 | 14 | official |
| 8 | 1 | 1 | 6 | 14.3% | 1 | 8 | official |
| 9 | 1 | 1 | 7 | 12.5% | 1 | 9 | official |

Notes for the engine:
- The official table is the only one; nothing in this game is "commonly used" instead of official, except the app's own simplification below.
- **9UPPER Online app** uses 1 lap at every count (rounds = opening player count, each person is Thinker exactly once). Project default recommendation: official laps, with a `laps` option 1-3.
- Each player begins on 3 points (rulebook). That this exists so a Thinker can absorb a wrong -3 callout is our inference; the rulebook gives no reason.
- Round count is fixed from the opening roster; late joiners/leavers should not change it silently (see edge cases).

## Procedure

Phases are strictly sequential. "Public" = everyone may know; "private" = only the named player(s).

0. **Pre-game (public).** Pick language/deck, difficulty policy, laps (default by N), whether timers are on. Each player gets 3 points. Seat order decides Thinker rotation (to the left = next in clockwise order; in the app: join order).
1. **Choose the Thinker (public).** Round 1: random, by dealing the full role deck including the Thinker card (rulebook); afterwards the Thinker role passes to the left. The Thinker is revealed and takes the function (callout) cards; only one may be played per round.
2. **Deal secret roles (private, simultaneous).** In round 1 this happens in the same deal as step 1. In later rounds the remaining N-1 players each get one face-down role card from {1 honest, N-2 bluffers}. Each player looks only at their own. Nobody, including the Thinker, learns anyone else's role.
3. **Draw the term card (public term, private explanation).** The top card of the term deck (or of the chosen difficulty stack) goes in the middle with the term side (black face) up. Everyone looks at the term and any printed hints. The rulebook suggests level 1 cards for a first game. The explanation side must stay unseen. If anyone, including the Thinker, already knows the term, redraw (BoardSheep advises confirming nobody knows the meaning first; the boardgamecafe.net reviewer notes the round breaks if the judge knows the term; the app implements this as a host card swap with no scoring).
   - Level 1 (D=1): printed category hint(s), all true (normally exactly one).
   - Level 2 (D=2): three category hints, exactly one true (the other two are decoys).
   - Level 3 (D=3): no hints; may be an odd phrase or a picture.
4. **Eyes-closed step, 9 seconds (private, simultaneous, timed).** Everybody closes eyes and **all players count down nine seconds together** (rulebook: 所有玩家一同倒數 9 秒); any player may tap or make noise to cover sound. Within those 9 s only the honest player opens eyes, turns the card over, reads the explanation, puts the card back term-side up, and closes eyes. Actor: honest only. Timer: 9 s (printed rulebook, HK retail copy, every TW write-up); BoardSheep's pre-release write-up says about ten seconds and the app's optional timer is 10 s (see variants).
5. **Explanations (public, speech).** Everybody opens eyes. The Thinker invites the other players to speak, in any order the Thinker chooses (rulebook step 3; Punch and UpToGo describe going around the table, which is one allowed order). The honest player answers truthfully from what the card said; bluffers improvise. The Thinker may ask any question about the term ("is it a person?") but may **not** ask a player about their role. Other players may cross-examine each other. No printed time limit.
6. **Callout (optional, public placement, once per round).** At any time during questioning, before the accusation, the Thinker may drop a callout card in front of one player whose answer sounds too absurd. The player's role is **not** revealed yet. The card cannot be taken back. Only one per round even though the Thinker holds two cards (看圖掰 rulebook 「每回合一次」; 2E). (App-only house rule: the called player stops speaking. The card names 收皮啦 / 你給我惦惦 mean "shut up", but no rulebook source mutes the player.)
7. **Accusation (public, single actor).** When the Thinker is satisfied, even before everyone has spoken, the Thinker names exactly one other player as the honest player. No other player votes.
8. **Reveal and score (public, simultaneous effects).** All role cards are turned up (and the explanation is read out so the table learns the true answer). Scores update per "Scoring". The callout resolves now.
9. **Rotate (public).** The Thinker seat moves one player to the left; all non-Thinker players redraw roles; a new term card is drawn; repeat from step 3.
10. **End (public).** After N x laps rounds the highest score wins.

## Night order

n/a. There is no night phase. The only hidden-action step is the 9-second eyes-closed step (Procedure step 4), in which exactly one role wakes: the honest player, once, who learns the explanation of the current term. Nobody else wakes or acts.

## Voting & resolution

There is **no vote**. The Thinker alone chooses one player (the 9UPPER Online Google Play blurb says players "vote", but the app's own How-to-Play page and role guide confirm that only the Thinker picks and "other players do not vote").

Resolution algorithm (D = card level 1..3; `accused` is the Thinker's pick; `callTarget` is the callout recipient or null):

```
delta = {every player: 0}
if accused is honest:
    delta[thinker] += D
    delta[honest]  += D
else:                       # accused is a bluffer
    delta[accused] += D     # thinker and honest get nothing
if callTarget != null:
    if callTarget is honest:
        delta[thinker] -= 3
    else:                   # bluffer
        delta[thinker]  += 1
        delta[callTarget] -= 1
apply all deltas simultaneously
```

- The main result and the callout are independent and are netted per player (a player can be both accused and called out).
- No ties exist: exactly one accused player. No "no majority" case.
- No chain effects or cascading eliminations; nobody is eliminated.
- The Thinker cannot be accused or called out. The Thinker and `honest` are never the same player.
- If the Thinker never names anyone: physical rules are silent. The app (optional timer) charges the Thinker D points and records no accused. Mark as an optional rule `noGuessPenalty`.

## Scoring & win conditions

Base numbers (all agreeing sources unless noted):

| Event | Thinker | Honest | Accused bluffer | Called-out bluffer | Others |
|---|---|---|---|---|---|
| Thinker picks the honest player | +D | +D | - | - | 0 |
| Thinker picks a bluffer | 0 | 0 | +D | - | 0 |
| Callout hits a bluffer | +1 | - | - | -1 | - |
| Callout hits the honest player | -3 | - | - | - | - |

Reading guide:
- D is 1, 2 or 3 by the card's level (the card face prints 難度 followed by one, two or three small icons; Beast calls them "score markers"). Equivalent formulation (2E, matching the legible part of the 看圖掰 rulebook's scoring step): the accused player gains D whatever their role, and the Thinker also gains D only if the accused is the honest player (2E: 「被指證的人，立刻獲得該牌等級的分數」).
- The callout gamble pays +1 to the Thinker (and takes 1 from the target) or costs the Thinker 3, so it has positive expected value only above 75% confidence (break-even p x 1 = (1-p) x 3, p = 0.75). A **blind** callout on a random non-Thinker hits a bluffer with p = (N-2)/(N-1): EV = -1 at N = 3, -1/3 at N = 4, 0 at N = 5, +0.2 at N = 6, +1/3 at N = 7, +3/7 at N = 8, +0.5 at N = 9. So a blind callout loses at 3-4 players, breaks even at 5, and is a free +EV play at 6+ (it also costs the target 1, a 2-point swing between them). This is a balance quirk of the printed rules (our arithmetic, not stated by any source); do not "fix" it in the engine, but the bot/hint text should not call blind callouts bad at large N.
- Honest players want to be picked (+D). Bluffers want to be picked even more (they alone score D when the Thinker errs).
- The callout is a transfer in the base game: bluffer -1, Thinker +1 (zero-sum). The SDGs edition words it as "steal one point from that team".

Game end: after N x laps rounds. Highest total score wins. Ties for first are **not covered** by any source: default to a shared win, optionally play one extra round per tied player as Thinker (config `tieBreak`).

Negative totals: physical tokens suggest scores stay at 0 or above, but no source states a floor and a player can in principle go below 0 (e.g. a Thinker on 0 points who picks the honest player after calling out the honest player on a level 1 or 2 card nets D-3, which is negative). **Unspecified**; project default: allow negatives, display them, expose `scoreFloor` option.

Disagreements (record them, do not hard-code):
- Beast of Boardgame reports "Thinker +1 on a correct pick, honest +D; wrong pick: bluffer +1". This contradicts Punch, the 2E blog, the legible part of the 看圖掰 rulebook's scoring step (the Thinker gets "the same points" as the accused honest player), UpToGo (derived from Punch) and the app (all: Thinker +D, honest +D; wrong pick: bluffer +D). Beast's scoring paragraph also contains a stray sentence about taking cards from a deck as points that belongs to some other game, so it is treated as a transcription error; only affects the engine if someone configures it. (The HK retailer blurbs give no point values.)
- Callout cards per round: **resolved**. The box holds 2 function cards and the Thinker takes them (Punch; Beast says one), but only one may be played per round (看圖掰 printed rulebook 「每回合一次」; 2E 「每回合僅可打1張」). The SDGs edition hands out one; the app allows once per card. The boardgamecafe.net review speaks of condemning several liars per round; treat that as a house reading, available as `calloutsPerRound = 2`. Default `calloutsPerRound = 1`.
- 樸宿桌迷藏版 write-up (Punch, 2026): says the first player to 10 points wins and lists a 「禁聲話！」 function card and "a wrong guess of bluffer scores both players"; it contradicts all other material and reads machine-written. **Unverified**; ignore for the engine.

Golden test vectors (N = 5, D = 2):

| # | accused | callout on | deltas |
|---|---|---|---|
| 1 | honest | none | Thinker +2, honest +2 |
| 2 | bluffer X | none | X +2 |
| 3 | honest | honest | Thinker +2-3 = -1, honest +2 |
| 4 | honest | bluffer Y | Thinker +2+1 = +3, honest +2, Y -1 |
| 5 | bluffer X | X | X +2-1 = +1, Thinker +1 |
| 6 | bluffer X | bluffer Y | X +2, Y -1, Thinker +1 |
| 7 | bluffer X | honest | X +2, Thinker -3 |
| 8 | (none, timeout rule on) | none | Thinker -2 |

## Edge cases an engine must handle

Roles and setup
- N < 3 or N > 9 is rejected (2-player variant out of scope).
- Deck composition per N exactly as the Setup table; honest count is always exactly 1; bluffer count is N-2, which is 1 at N = 3.
- At N = 3 the Thinker is effectively choosing between two people (50% blind); accusing the bluffer gives that bluffer +D.
- From round 2 on the Thinker is excluded from the role draw (in round 1 the Thinker card is part of the deal); roles of the N-1 others are redrawn every round, so the same player can be honest several rounds in a row. No fairness balancing in the official game (optional config `balancedHonest`).
- Round-1 Thinker is random; later Thinkers follow seat order, one step each round; after N rounds every player has been Thinker once (a lap).
- Bluffers do not know each other (except under the app's optional Accomplice role).
- Thinker identity is public; every other role is private until the reveal.

Card and hints
- Same card is never reused inside a game; across sessions prefer unseen cards (memorisation kills replay value; reviewers complain about this).
- Level decides D (1/2/3). Printed rule: on level 1 every hint is relevant (photographed cards show a single category hint); level 2 has three hints of which exactly one is relevant; level 3 has none and may be a picture or odd phrase. The TW publisher also mentions picture prompts (圖像題) and action prompts (動作題) as card types (zeczec 9upper2 page); the action-prompt format is **unverified**.
- Level selection: the 看圖掰 rulebook shuffles all term cards into one face-up pile and uses the top card each round (so levels come mixed at random), recommending level 1 cards only for a first game. Write-ups also show the Thinker choosing a level per round (2E) or the group choosing a stack for the whole game (Beast). Support `difficultyMode = random-mix (default, rulebook) | per-round-thinker | fixed`.
- If any participant already knows the term, redraw before the 9-second step; the discarded card scores nothing and roles stay the same (app behaviour).
- Honest player may only report what the card says; if a question is outside the card, "the card does not say" is a legal answer (2E blog).
- The honest player cannot re-read the card after step 4; do not offer a re-peek unless a lenient option is on.
- Level 2: a bluffer may follow the true hint or deliberately take a decoy; both are legal.

Timing and phase order
- Exactly one card turn-over, 9 seconds. The honest player's slow reading is not extended.
- The Thinker never opens eyes at step 4 (never sees the card back).
- The accusation may happen at any moment after the 9-second step, even before everyone has spoken.
- The Thinker chooses who speaks and in what order; the Thinker may not ask anyone "what is your role?" (rulebook). Not enforceable by the engine; show it as a rule hint on the Thinker's screen.
- Callout can only be placed after the 9-second step and before the accusation; one per round; cannot be moved or withdrawn; its target stays masked until the reveal; target may be the same player as the accused or a different player.
- Callout cannot target the Thinker.
- A round must end with an accusation (or the optional timeout penalty); a round cannot end in a draw.
- The Thinker cannot accuse self; an accusation cannot be changed after confirmation.

Scoring
- Settle main result and callout in one atomic step; show both components (e.g. +2 main, -1 callout).
- Case 3 above: Thinker can lose points even when right (callout on honest, pick honest).
- Negative scores allowed by default (see Scoring); expose `scoreFloor`.
- Total is final after N x laps rounds; tie handling is configurable.
- Half points never occur in the core game (D is an integer 1-3). The app's optional roles introduce 1.5D multipliers; keep scores as integers x2 internally if those are ever added.

Players and connectivity
- Honest player disconnects before reveal: void the round (no score), redraw card and roles, same Thinker (suggested policy; physical game has no analogue).
- Thinker disconnects: void the round and hand the seat to the next player; mark the lap bookkeeping so that nobody gets two turns in one lap.
- A bluffer disconnects: round may continue with fewer bluffers only if N-1 >= 3; otherwise void.
- Late join only between rounds; new player starts on 3 points and the round count does not change (unspecified; recommended).
- Leaving mid-game under N = 3: end the game early, highest score wins.
- Host can remove a player and transfer host (app feature), neither changes the round counter.

Content and integrity
- A card is invalid if the term or true explanation leaks the answer in its hints. Keep a data validator: level in 1..3; level 1 has at least 1 hint and all hints true (the house style is exactly 1); level 2 has 3 hints with exactly 1 true; level 3 has 0.
- Never ship text copied from the commercial cards; use an original, fact-checked bank (see App notes).
- Players may accidentally reveal the explanation by speaking first; not enforceable by the engine, only a table etiquette note.

## Common variants

Official product line
- **9UPPER volumes 1, 2, 3, 4 and 十9UPPER 瞎掰王+ (HK, Time2Play)**: same rules per box, different term cards; 十瞎掰王 is the 1+2 combination (Beast). Volumes 2-4 are listed by Time2Play's own store (search snippets) and GeTheMall ("9UPPER 1, 2, 3, 4"). BG Walker also lists two HK special boxes, **馬介休別注版** (HK$380) and **勞氣生財 (新年版)** (HK$188); their contents were not inspected: **unverified**. Popular in HK. The "+" box contents were not inspected: **unverified**.
- **酒GAME版 (HK drinking edition, 2024, Time2Play x HK craft-beer brand 友)**: no scoring; the loser drinks; the 收皮啦 card becomes 飲啦; 110 moisture-proof plastic cards including 100 new terms; 18+; HK$220-280 depending on retailer. Exact assignment of who drinks in each outcome is in a rulebook that could not be fetched: **unverified**. Popular in HK drinking circles.
- **看圖掰 (9UPPER pictures, TW 狗吠火車, 2025)**: identical flow and scoring (rulebook read directly), but the shared card shows a picture; 232 term cards (243 cards in total); 15+; the callout card is called 練肖話！ (2 in the box, once per round).
- **接著掰 (9upper2) expansion, TW**: crowdfunded on zeczec 2023-05-18 to 2023-07-11 (UTC+8), shipped July 2023, needs the base game; 250 term cards (+80 campaign-only), continues the picture and action prompt types, and adds the 瞎掰帝 role (marketing copy only; rules **unverified**).
- **SDGs 教育版 (TW, 2024)**: team mode for classrooms with a teacher as non-playing moderator who secretly picks the honest team and hands every other team a bluffer card plus a 混淆卡 (a "how to bluff" prompt), teams write down their answer on a record sheet and read from it. Fixed 1 point (no levels), 3-8 players or teams, 10+, 40-50 min, 170 cards including 154 term cards on SDGs themes, one 「你給我惦惦」 card (callout) per Thinker team: steal 1 point if right, lose 3 if it hits the honest team. Also includes an individual mode (fewer than 8 players). Niche.
- **2-player variant**: mentioned by the 2E blog and UpToGo; text not retrievable. **Unverified**.
- **Reading-aloud method (BGG description, boardgamecafe.net review)**: the BGG entry describes every non-judge in turn picking up the card and "reading" the explanation, the honest player verbatim and the liars only pretending to read while saying something else. No rulebook-derived source describes this (all of them, and the printed rulebook, use the 9-second eyes-closed peek), and the reviewer's own group switched to an eyes-closed peek. Treat it as a reviewer's reading, not an official mode. It does map well to phones (every phone shows a "reading" screen; only the honest phone holds real text), so it could be an optional `revealMode = read-aloud`.
- **Peek length**: BoardSheep's pre-release (Nov 2022) write-up says about ten seconds; the boardgamecafe.net group used 20 s; the app's optional timer is 10 s. Official: 9 s.
- **樸宿桌迷藏版 (2026 limited edition)**: write-up inconsistent with everything else; ignore.

House and app variants
- **9UPPER Online (independent, unofficial; Hong Kong developer, opened 2026-07-12; Google Play 2026-08-12)**: 1 lap only; callout once per card with the called player muted; optional timers (view 10 s, 30 s per speaker, guess 30 s, all off by default); host card swap; short or full answer edition; difficulty D 1-3 on every card; direction tags on "tagged" cards, none on "open" cards; five optional roles (9UP King = challenge word, 2D if picked; Hype Hound; Accomplice; Hindered Truth-Knower 1.5D to the honest player; Dream Teller 1.5D). HK/TW/EN.
- **Chitchat Clinic blog house rules (TW)**: "double-faced role" that holds partial truth, 30-second bluff limit, rewards (extra hint, double score) and forfeits (tell a joke). Blog-invented, not widely played.
- Typical table etiquette in HK/TW groups: friends try to keep a straight face, and call "收皮啦" aloud; the score is treated as secondary.
- Mark of popularity: about 40,000 copies sold in HK per Time2Play's founder (boardgamecafe.net interview, Dec 2025), marketed mainly through YouTubers rather than hobby channels; base game and 酒GAME版 are popular in HK. In TW the base game, 看圖掰 and expansions are popular, helped by repeated episodes of the TV show 娛樂百分百 (segment 桌遊研究社) from 2023, and the base game reached a second print within months (zeczec 9upper2 page). Mainland-China uptake: a Simplified edition exists (BGG, 2023); popularity not verified.

## App design notes

What must stay private
- Each player's role (until reveal), the honest player's identity, and the **explanation text**. Only the honest player's phone should ever receive the explanation text, and only for the viewing window (default 9 s, optional up to 30 s). Do not ship answers in the same JS bundle as questions: put them in per-card (or per-chunk) files fetched only by the honest player's device, so bluffer phones never load them. A determined cheater on the host phone can still read them (the host is the authoritative referee); this is the same host-can-peek trade-off already accepted for Cheese Thief, acceptable for a friend game.
- Public: the term, the printed hints, the Thinker, the current level D, whether the callout was played and on whom, the accusation, scores.
- The callout target is public the moment the card is placed; only that player's role is hidden.

What a narrator (Cantonese TTS from the host phone only) helps with
- Announce the Thinker (「今輪由 X 做諗樣」), run the 9-second countdown that the rulebook has everyone count together (「九、八、七…」), announce "start talking" (「開始吹水」), play a stinger when the callout is used (「收皮啦！」), drum-roll before the reveal, read the true answer aloud, and read score changes. All of that is public information, so host-only audio leaks nothing. iPhone Safari speechSynthesis has zh-HK voices, but audio needs a user gesture to unlock; prerecorded clips are the safer fallback. No narration is required to run the game.

What can be fully automated on phones
- Role dealing, card draw, answer privacy, the 9-second timer, Thinker rotation, lap counting, scoring (including callout netting and edge cases above), end detection, scoreboard.
- What stays human: the talking, cross-examination, and judging who sounds honest. Nothing is typed (explanations are spoken, in line with the app benchmark).

Anti-tell concerns (9-second step and phones)
- With phones there is no need to close eyes: replace step 4 with a "heads-down" step in which **every** phone shows the same card-back layout for the same fixed time. The honest phone shows the real text; every other phone (Thinker included) shows a scrambled or blurred text block of the same length. Same animation, same brightness, same countdown ring, no haptics, no sound that differs by role; auto-lock disabled; end of the step at the same instant on every phone.
- Advise players to hold the phone close; shoulder-surfing a lit screen is the new tell, and a decoy block removes the "who has real text" signal.
- Table-tapping noise is not needed on phones. In single-phone mode the speaker can play a drum/tick loop to mask card handling.
- Do not let bluffers see anything that differs by role besides the role label (e.g. avoid a "waiting" screen that bluffers see but honest does not).
- Timer expiry and "I have finished reading" taps must not make the honest player stand out: no early-finish button, or give every player the same button.

Host-moderator dashboard (the host is also a player, so it must hide secrets)
- Phase controls: start round, start discussion, force the accusation step, skip/swap card (no score, same roles), pause, undo the last scoring (manual correction for disputes).
- Settings: laps, difficulty policy, timers (all off by default; official 9 s card view is fixed), callouts per round (default 1, option 2), noGuessPenalty, scoreFloor, tieBreak, answer edition (full/short), revealMode (official peek / optional read-aloud).
- Roster: connection status, kick, transfer host, rejoin with the same seat.
- Never show roles or the answer to the host unless the host is the honest player in that round. A non-playing "table display" mode can show the scoreboard, the term, the hints, timers and the callout marker on a shared tablet.

How it could work on ONE shared phone
- Public screen: current Thinker, term, hints, level, scoreboard.
- Role reveal by pass-and-play: seat order fixed; each non-Thinker takes the phone in turn and taps hold-to-reveal for exactly the same duration (all see the same layout; the honest player's block contains the real text, others a scrambled block). Phone is passed on or laid face-up in the middle; the Thinker should not handle it during this phase.
- Faster alternative for big groups: eyes-closed method, phone lying in the middle with a drum/tick loop and a spoken 9-second countdown; the honest player turns the phone over, reads, turns back. Light through eyelids and the physical move remain weak tells; use only with a trusting group.
- Thinker picks the accused and the callout target by tapping names; the phone settles the score and speaks the result. All state is local, no P2P needed.
- 9 players x about 10 s per reveal = about 90 s overhead per round; recommend phones-per-player for 6+ players.

Content, naming, legal
- The game needs a large bank of original trivia; the 9UPPER Online app wrote 1,790 original concepts in three languages and checked each fact. The commercial cards are copyrighted and must not be copied, translated or paraphrased. The name 9UPPER / 瞎掰王 / 狗噏當秘笈 belongs to Time2Play; use a neutral display name (e.g. 吹水王) and describe the mechanic only. Suggested card schema: `{id, level 1|2|3, term, shape: tagged|open, hints[3] with trueIndex (level 2) or hint (level 1), answerFull, answerShort, source, locale}`, written in HK written Chinese with Cantonese-friendly phrasing and a travel-in-Japan topic pack as an optional bonus.
- Track seen card ids per device (localStorage) so repeat sessions avoid reuse.
- Keep the Thinker-only accusation, no voting, no text entry; allow optional timers like the benchmark app.

## Sources

- https://boardgamegeek.com/boardgame/383053/9upper-xia-bai-wang (BGG; data via api.geekdo.com item 383053: 2021, 3-9, 9-19 min, age 9, publishers TIME2PLAY GAMES and 狗吠火車, designer uncredited)
- https://beastofboardgame.wordpress.com/2024/07/10/%E3%80%8A9upper%E3%80%8B/ (components, laps, one callout card, designer credit "Costo")
- https://punchboardgame.pixnet.net/blog/post/568570412 (TW rules walkthrough: setup, 9 s, scoring, callout; its photos include the **printed TW rulebook component panel** (9 role cards, 2 function cards, 239 term cards, 18 + 7 tokens, hint rules, 9up = 狗噏 gloss) and the rulebook's laps table; first-print errata cards numbered C)
- https://joaoio.pixnet.net/blog/post/340213389 (2E blog: setup, step list, laps by player count, one callout per round, 2-player variant mention)
- https://uptogo.com.tw/%E5%A8%9B%E6%A8%82/%E7%9E%8E%E6%8E%B0%E7%8E%8B-%E5%B9%BE%E4%BA%BA%EF%BC%9F/ (player count discussion, scoring recap, 2-player variant mention)
- http://usnoopy.blogspot.com/2022/11/9upper.html (BoardSheep: levels, hints, Thinker public, confirm nobody knows the term)
- https://www.chitchatclinic.com.tw/blog/9upper (components 300 cards / 25 tokens, house variants; its scoring summary is unreliable)
- https://www.sgboardgamedesign.com/product-page/9upper-%E7%9E%8E%E6%8E%B0%E7%8E%8B (English blurb: "9up" slang, Time2Play, Taiwan licence 2022)
- https://www.yohohongkong.com/zh-hk/product/135380-%E7%8B%97%E5%99%8F%E7%95%B6%E7%A7%98%E7%AC%88-9UPPER-%E7%9E%8E%E6%8E%B0%E7%8E%8B-4 (HK retail text: 諗樣, 老實人, 9-upper, 9 s eyes closed, HK$220)
- https://club.wewacard.com/market/%E7%8E%A9%E6%A8%82%E9%AB%94%E9%A9%97/%E7%8E%A9%E5%85%B7%E5%8F%8A%E6%BD%AE%E7%89%A9/p-WWCD2501A0096/9UPPER-%E7%9E%8E%E6%8E%B0%E7%8E%8B-%E9%85%92Game%E7%89%88 (HK Cantonese description)
- https://lifeisbg.com/products/9upper-%E7%9E%8E%E6%8E%B0%E7%8E%8B-%E9%85%92game%E7%89%88 (酒GAME版: no scoring, 飲啦 replaces 收皮啦, 110 PVC cards, 18+)
- https://goodmovebg.com/products/9upper-%E7%9E%8E%E6%8E%B0%E7%8E%8B-%E9%85%92-game-%E7%89%88 (drinking edition, volume 4 listing)
- https://www.dogbarktrain.com/products/9upper (TW publisher listing: 300 cards, 25 tokens, 9-99 min)
- https://www.dogbarktrain.com/products/9upper-pictures and https://punchboardgame.pixnet.net/blog/posts/9578035198 (看圖掰: 243 cards, 15+, 練肖話; the post's second photo, https://pimg.1px.tw/punchboardgame/1756963912-3656639498-g.jpg, is the **complete printed 看圖掰 rulebook**: random deal incl. Thinker card, all count 9 s together, Thinker picks speakers and may not ask roles, callout once per round, scoring, laps table)
- https://www.zeczec.com/projects/TW-9upper (TW publisher crowdfunding page: campaign 2022-11-30 to 2023-01-10, 239 terms + 50 unlocks + 50 added, eyes-closed peek with noise, sample level-2 card with three hints)
- https://www.zeczec.com/projects/TW-9upper2 (接著掰 campaign 2023-05-18 to 2023-07-11; base box "300 game cards"; expansion 250 + 80 terms; 瞎掰帝 marketing copy; picture and action prompt types; 公三小 on the honest player costs 3)
- https://www.gtm.hk/en/products/9upper (GeTheMall HK: "9 up" glossed as 狗噏, 收皮啦 card, volumes 1-4)
- https://wobgames.net/9upper-%E7%9E%8E%E6%8E%B0%E7%8E%8B/ (Welcome On Board HK: 諗樣 / 老實人 / 9upper, roles drawn from cards)
- https://bgwalker.com/product/9UPPER-%E7%9E%8E%E6%8E%B0%E7%8E%8B-(%E7%B9%81%E4%B8%AD%E7%89%88)-NmH1qb8tpVTuCj82 (BG Walker HK: HK$220, related 酒GAME版, 9UPPER2, 馬介休別注版, 勞氣生財 新年版; rulebook slot empty)
- https://boardgamecafe.net/2023/04/22/9upper/ (review: judge and genuine both score, side-bet callout with stiff penalty, reading-aloud description, 20 s house peek)
- https://boardgamecafe.net/2025/12/05/interview-hong-kong-and-boardgames-charles-yan/ (Time2Play founder: about 40,000 copies sold in HK, beer-brand drinking edition)
- https://centlusboardgame.com/product/9upper-%E7%9E%8E%E6%8E%B0%E7%8E%8B/ (Malaysian retailer: thinker / honest person / 9-uppers, 9-second eyes-closed read)
- https://www.dogbarktrain.com/products/%E7%9E%8E%E6%8E%B0%E7%8E%8B-sdgs-%E6%95%99%E8%82%B2%E7%89%88 (SDGs edition: 170 cards, 154 terms, 你給我惦惦 card, 3-8 players or groups, 10+, 40-50 min)
- https://punchboardgame.pixnet.net/blog/post/576512580 (SDGs edition rules, team mode, 惦惦卡)
- https://www.punchboardgame.com/products/%E7%9E%8E%E6%8E%B0%E7%8E%8B%E6%93%B4%E5%85%85-%E6%8E%A5%E8%91%97%E6%8E%B0-9upper2-%E7%B9%81%E9%AB%94%E4%B8%AD%E6%96%87%E7%89%88 (接著掰 expansion, 瞎掰帝, marketing copy only)
- https://punchboardgame.pixnet.net/blog/posts/885748306376980930 (樸宿桌迷藏版; treated as unreliable)
- https://play.google.com/store/apps/details?id=com.nineupper.online (9UPPER Online listing, independent and unaffiliated, updated 2026-08-12)
- https://9upper-online.com/en/how-to-play (app rules and current scoring)
- https://9upper-online.com/en/guides/bluffing (what each role sees and does in the app)
- https://9upper-online.com/en/guides/hosting (rooms, host controls, timers, answer editions)
- https://9upper-online.com/en/guides/special-roles (optional advanced roles)
- https://9upper-online.com/en/guides/updates (release notes: 1-lap rotation, callout once per card, difficulty scoring)
- https://9upper-online.com/en/guides/card-design (original card shapes: tagged vs open topics)
- Not reachable / not fetched: Time2Play's store (time2play.com.hk now redirects to shoplineapp.com), BGG pages (Cloudflare challenge; the item JSON via api.geekdo.com did load), books.com.tw (403). BG Walker's "規則書 下載" slot is empty, so no rulebook PDF exists there.

## Verification

Adversarial fact-check, 2026-10-03 UTC. Web search quota was exhausted, so sources were reached by direct URL, Brave result pages and the in-app browser. Key new evidence came from sources the original draft did not use: photos of the **printed TW rulebooks** (base-game component panel and laps table; full 看圖掰 rulebook), the TW publisher's two zeczec campaign pages, GeTheMall, WOB, BG Walker, Centlus, boardgamecafe.net (review and publisher interview), the BGG item JSON, the DogBarkTrain SDGs listing, and the Google Play page (raw HTML).

Checked and confirmed (no change needed):
- Role deck 1 Thinker + 1 honest + (N-2) bluffers; 3-9 players; Thinker public, other roles secret; roles re-dealt every round; Thinker passes to the left.
- Everyone starts on 3 points.
- Scoring: correct pick = Thinker +D and honest +D; wrong pick = accused bluffer +D only; callout on a bluffer = Thinker +1, bluffer -1; callout on the honest player = Thinker -3 (Punch, 2E, legible rulebook text, zeczec "一口氣扣3分").
- Laps 3 / 2 / 1 for 3-4 / 5-7 / 8-9 players, printed in the rulebook table as times each person is Thinker; totals 9-14 rounds are correct arithmetic.
- 9-second eyes-closed peek by the honest player only, noise to mask it; difficulty levels with 1 / 3-with-1-true / 0 hints; level 3 can be a picture; honest may answer "no information".
- HK names 諗樣 / 老實人 / 9upper and card 收皮啦; TW names 想想 / 老實人 / 瞎掰人 and card 公三小; 看圖掰 card 練肖話; drinking edition 飲啦, 110 plastic cards, 18+, beer brand 友; 看圖掰 15+ and 243 cards.
- BGG: 2021, 3-9, 9-19 min, age 9, designer uncredited, publishers TIME2PLAY GAMES and 狗吠火車, mechanic Player Judge.
- 9UPPER Online: unofficial; Google Play "Updated on Aug 12, 2026" and its blurb does say players "vote"; one lap per player (release note 2026-08-29); callout once per card with target muted; three optional timers off by default; special-role multipliers as listed.
- Golden test vectors 1-8 recomputed: all correct.

Changed:
1. **Blind-callout maths was backwards.** The draft said a blind callout loses "except at N = 3 or 4"; in fact it loses at 3-4 players (EV -1 and -1/3), breaks even at 5 and gains at 6+ (+0.2 to +0.5). Fixed in Scoring.
2. **Callout count per round resolved**: the 看圖掰 printed rulebook says once per round while the box has 2 function cards that the Thinker takes; the draft's "Thinker takes the callout card (one)" was corrected; default stays 1, with 2 as a house option.
3. **Round-1 Thinker**: the rulebook deals the full role deck including the Thinker card; the draft had the Thinker chosen outside the deal. Setup, Procedure and edge cases updated.
4. **Missing rule added**: the Thinker chooses who speaks, in any order, and may ask anything about the term but may not ask a player's role (rulebook step 3).
5. **Who counts the 9 seconds**: all players count together (rulebook), not "the Thinker"; any player may make noise (not just bluffers).
6. **Components**: term cards are 239 in the TW first print (250 cards in total with 9 role + 2 function cards), not "250 term cards"; 看圖掰 has 232 term cards; score tokens come in 1/3/5/10 (18 + 7), not just 1 and 3; rulebook calls the callout a 功能牌.
7. **Realupper**: printed on the standard role cards (THINKER / REALUPPER / 9UPPER), not on "one TW special edition".
8. **9up = 狗噏 pun** is stated by the publisher's rulebook and by GeTheMall; it is not the researcher's inference. 狗噏當秘笈 downgraded to a retail tagline seen on Yoho's volume-4 listing.
9. **Laps** now cited to the printed rulebook table rather than inferred from blogs.
10. **Level 1 hints**: rulebook says all level-1 hints are relevant; validator relaxed to "at least 1, all true". Default `difficultyMode` set to the rulebook's mixed shuffled pile.
11. **Beast-scoring disagreement**: removed the false claim that the HK retailer text gives Thinker +D (it gives no numbers); added 2E and the rulebook as corroboration and noted Beast's stray foreign-game sentence.
12. **TW release dates**: zeczec campaign 2022-11-30 to 2023-01-10 (UTC+8), first shipments Dec 2022; 接著掰 campaign 2023-05-18 to 2023-07-11, shipped July 2023, 250 + 80 terms.
13. **SDGs callout card name** corrected to 「你給我惦惦」; added 170 cards, 10+, 40-50 min.
14. **Variants added**: BGG's reading-aloud method (flagged non-official, offered as optional `revealMode`), peek-length variants (10 s pre-release, 20 s house), HK special boxes 馬介休別注版 and 勞氣生財 新年版, drinking-edition year 2024.
15. **Popularity**: added the publisher's ~40,000 HK copies and TW TV exposure.

Still unverified: 2-player variant text; 瞎掰帝 mechanics and scoring; drinking-edition drinking assignments; contents of 十瞎掰王+ and the two HK special boxes; HK-print component counts after volume 1; the exact wording of the base-game (non-看圖掰) rulebook scoring and callout steps (only its component page and laps table were seen; the one-per-round limit for the base game rests on the 看圖掰 rulebook plus 2E); "Costo" as designer (single source); the format of "action prompt" cards.
