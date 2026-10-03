# Spyfall — rules reference

> Paraphrased for engine implementation. Not a copy of the official rulebook.

Evidence base: three official Hobby World English rulebooks read directly (Spyfall 2014 international printing, Spyfall 2 (c) 2016, Spyfall Time Travel (c) 2018), plus the Russian originals of Spyfall (rules v1.1) and Time Travel and Cryptozoic designer rulings on BGG (added in fact-check, see Verification), cross-checked against Cryptozoic's English product text, UltraBoardGames/Meeple Like Us/Shut Up & Sit Down summaries, and Traditional Chinese blog write-ups (2E愛玩芝麻事/逸馬/冒險安迪/龐奇桌遊). Where editions disagree or the text is ambiguous this is flagged as **[AMBIG]** with the reading the engine should default to.

## Identity

| Field | Value |
|---|---|
| EN name | Spyfall (sequels: Spyfall 2, Spyfall: Time Travel, DC Spyfall) |
| 繁中 name(s) | **間諜危機** (TW and HK retail name; HK shop listing reads "Spyfall 間諜危機"; official Chinese edition by Planplay/Zhiyanjia 2015). Sequels: **間諜危機 2** (official Chinese edition 2017, Planplay/TWOPLUS/Zhiyanjia); **間諜危機：時間旅行** is only a TW retailer label for the imported English box (no Chinese edition listed on BGG). No Chinese name found for DC Spyfall; if needed use "DC 間諜危機" as an app label, not as an official title. Simplified: 间谍危机. Informally "誰是間諜" / "地點版臥底" (unverified folk names; do NOT confuse with 誰是臥底, which is the word-pair game). Original Russian title: Находка для шпиона. JP: スパイフォール (Hemz Universal Games edition). |
| Designer / publisher | Alexandr (Alexander) Ushan; Hobby World (Russia) 2014, which also printed the first English edition (2014); US/UK English edition by Cryptozoic Entertainment (2015). Spyfall 2 (c) 2016 Hobby World (Cryptozoic English 2016/2017); Time Travel (c) 2018 Hobby World. |
| Player range | Base game 3–8 (box). Spyfall 2: 3–12 (two-spy option). Time Travel box 2–8: it adds official 2-player and 3-player variants and a team variant for 7+ (distribution table given for 7–10). |
| Best count | BGG community poll (230 votes, read via the geekdo JSON API): **best 6, recommended 4–8**. Spyfall 2 poll (29 votes): best 6–8, recommended 5–12. Chinese review also says 6 (冒險安迪). Spyfall 2 rulebook: beginners best with up to 8 players and one spy. For this app: aim 5–8, support 3–12. |
| Duration | Round: 6–10 min by player count (default 8). Whole game of 5 rounds is about 1 hour including talk. |
| Weight | Very light (BGG 1.23/5, 531 votes; box time 15 min, age 13+). |
| Physical components the app must replace | Location decks (one deck per location: N location cards each with its own role + 1 or 2 spy cards), ziplock bags (random location draw, no repeat), the **location reference list** printed in the rulebook's middle spread (the spy consults it when guessing), the **stopwatch** (rulebook says bring your own), paper/phone score tracking, the dealer role (shuffles, deals, starts the clock). Card art is copyrighted; the app must ship its own locations/roles. |

### Edition facts that matter

| Edition | Locations | Cards per deck | Max players | Notes |
|---|---|---|---|---|
| Spyfall (Russian original, Hobby World 2014, rules v1.1) | 30 | 8 (7 location + 1 spy) | 8 | 240 cards. Has the 26 locations below plus 4 Russia-specific ones (Terrorist Base, Vegetable Warehouse, Partisan Squad, Church). Rules v1.1 already carry the 6/7/8-minute table by player count. |
| Spyfall (2014 Hobby World English printing) | 26 | 8 (7 location + 1 spy) | 8 | 208 cards. 8-minute default; players may agree another length (first-timers may prefer 12–15 min). |
| Spyfall (Cryptozoic English, 2015+) | 30 per publisher text | 8 | 8 | Cryptozoic page: 240 cards, 30 bags, 3–8 players, 8-minute rounds. Names of its 4 extra locations not verified (a fan web app lists Broadway Theater and Cathedral in its "Spyfall 1" set, but Cathedral is catalogued on BGG as a promo). Its end-of-round vote wording differs (see Common variants). |
| Spyfall 2 | 20 | 12 (10 location + 2 spy) | 12 | 240 cards. Two-spy option; timer table by player count. |
| Spyfall: Time Travel | 30 | 8 (7 location + 1 spy, no second spy card) | 8 (team variant to 10) | 240 cards. Timer table up to 8 players; 2/3-player and team variants. |

**Locations (verified from rulebook spreads: 26 from the 2014 English rulebook spread, 20 from the Spyfall 2 spread), with suggested 繁中 names** (names are facts; role lists are card content, so author your own roles):

- Spyfall 26: Airplane 飛機, Bank 銀行, Beach 沙灘, Circus Tent 馬戲團帳篷, Day Spa 水療中心, Embassy 大使館, Hospital 醫院, Hotel 酒店, Passenger Train 長途火車, Pirate Ship 海盜船, Polar Station 極地研究站, Police Station 警署, Space Station 太空站, Submarine 潛艇, Supermarket 超級市場, Theater 劇院, Corporate Party 公司派對, Crusader Army 十字軍, Casino 賭場, Military Base 軍事基地, Movie Studio 電影製片廠, Ocean Liner 郵輪, Restaurant 餐廳, School 學校, Service Station 汽車維修站, University 大學.
- Spyfall 2 20: Race Track 賽車場, Construction Site 建築工地, Wedding 婚禮, Vineyard 葡萄園, Candy Factory 糖果工廠, Harbor Docks 港口碼頭, Library 圖書館, Coal Mine 煤礦, Art Museum 藝術博物館, Retirement Home 安老院, Rock Concert 搖滾演唱會, Stadium 運動場, Cat Show 貓展, Cemetery 墓園, Jail 監獄, Jazz Club 爵士樂酒吧, The U.N. 聯合國, Gas Station 油站, Subway 地鐵, Sightseeing Bus 觀光巴士.

## Roles

There is no night and no special powers. "Roles" are the secret card identities plus table positions. The engine needs exactly two real teams.

| id | EN | 繁中 | team | ability (precise) | acts at night? when? |
|---|---|---|---|---|---|
| `spy` | Spy | 間諜 | spy | Receives no location and no role. Wins by surviving, by getting the table to unanimously accuse an innocent, or by naming the location. May interrupt the clock at any moment while it runs (see Procedure step 8) by revealing the card face up, then names exactly one location from the list. Also may use the normal once-per-round accusation to deflect suspicion. | No night phase in this game. |
| `spy-secondary` | Second spy (Spyfall 2 option) | 第二間諜 | spy (rival to `spy` unless "Old pals") | Same as `spy`. The two spies normally do not know each other and are scored individually for the location bonus, but jointly share the base spy win. Must reveal and declare a location right after the first spy does. If the other spy is caught, this spy scores as if a non-spy (see Scoring). | No. Only in the optional "Old pals" variant do spies see each other once, eyes-closed step before the clock starts. |
| `agent` | Non-spy / civilian | 平民 (非間諜) | non-spy | Knows the location and has a location role. Must drop vague hints proving knowledge while not revealing the location. Wins by getting a unanimous conviction of a spy. | No. |
| `location-role` | Location role (card "role"/"status") | 身分 / 職業 (e.g. 銀行職員) | cosmetic, non-spy only | Pure role-play flavour on the card. Each non-spy gets a different role from the location's list. Groups agree beforehand whether to act it out; Spyfall 1 strongly recommends it from the start, while Spyfall 2/Time Travel recommend it only once the group is past its first sessions. Roles carry no game effect. | No. |
| `dealer` | Dealer | 發牌員 / 莊 | n/a (a normal player) | Draws the location deck, deals, starts the stopwatch, asks the first question, and is the first suspect of the end-of-round vote (Hobby World texts; in the Cryptozoic Spyfall 1 text the dealer is instead the first *accuser*). | No. |

Engine note: store `team` per player as `spy | nonspy`. Role cards are `{locationId, roleId}` or `SPY`. Never persist the role in public state.

## Setup by player count

Role cards needed per round: N minus number of spies, all drawn from one location (roles not repeated if the list allows). Timer: the 2014 English Spyfall text uses a flat 8 min (groups may agree another length); the Russian Spyfall rules v1.1, Spyfall 2 and Time Travel all give the same per-count recommendation (3–4: 6, 5–6: 7, 7–8: 8 min), groups may override. Only Spyfall 2 extends the table to 9–12.

| Players | Spies | Location cards dealt | Recommended timer (RU S1 v1.1 / S2 / TT table) | Status |
|---|---|---|---|---|
| 2 | 1 (may be in the middle) | 2 location + spy card, 3 cards dealt, one face down in the middle | not specified (use 6) | Official, Time Travel 2-player variant only. Different win rules (see Variants). |
| 3 | 1 | 2 | 6 min | Official base. Time Travel 3-player variant (4 cards dealt, one hidden in the middle, questions in return allowed) is also official. |
| 4 | 1 | 3 | 6 min | Official |
| 5 | 1 | 4 | 7 min | Official |
| 6 | 1 | 5 | 7 min | Official (one spy recommended for 6 or fewer) |
| 7 | 1 (2 allowed) | 6 (or 5) | 8 min | Official; the spy count between 7–8 is the group's choice (Spyfall 2 says beginners should use one spy up to 8 players) |
| 8 | 1 (2 allowed) | 7 (or 6) | 8 min | Official; max for a single base deck |
| 9 | 2 recommended (1 allowed) | 7 (or 8) | 9 min | Official, Spyfall 2 (two spies recommended from 9) |
| 10 | 2 recommended (1 allowed) | 8 (or 9) | 9 min | Official, Spyfall 2 |
| 11 | 2 recommended (1 allowed) | 9 (or 10) | 10 min | Official, Spyfall 2 |
| 12 | 2 **mandatory in print** (deck has only 10 location cards) | 10 | 10 min | Official, Spyfall 2. In the app 1 spy is technically possible if roles per location >= 11, but treat as non-standard. |
| 13+ | not defined | n/a | n/a | Not supported by any official rules. If the app allows it, mark as house rule (suggest spies = ceil(N/6)). |

Round count: agreed before play; 5 recommended for the first session. First round dealer: the "most suspicious-looking" player (app: random). Next dealer: see Procedure step 1.

Location pool: one location per round, **never repeated within a game** (the used deck's bag goes back to the box). Pool the spy chooses from = the whole printed list (26/30/20 locations). Cryptozoic/retail lists show all locations to everyone; that list is the spy's guess menu.

## Procedure

Legend: PUBLIC = everyone sees; PRIVATE = one player only.

0. **Pre-game agreement (PUBLIC, simultaneous discussion).** Number of rounds, round length, number of spies (Spyfall 2), whether location roles are acted out, location pool.
1. **Choose dealer (PUBLIC).** Round 1: random. Rounds 2+: Spyfall 1 (English and Russian) and Time Travel say the previous round's spy deals; Spyfall 2 says the player to the left of the previous dealer. **Default for the app: left of previous dealer** (works with 1 or 2 spies, where "previous spy" is ambiguous, and spreads the first-question / first-final-vote-suspect position evenly). Offer `dealerRotation: previous-spy` as the Spyfall 1/Time Travel option. The dealer plays normally and may be the spy.
2. **Pick location and deal (PRIVATE data created by the host engine).** Draw a random unused location, shuffle roles, choose spy seat(s) uniformly at random, give each non-spy a distinct role (rule of thumb for the app: >= 11 roles per location so up to 12 players never repeat a role).
3. **Private look (PRIVATE, simultaneous, no timer).** Each player views their own card: SPY, or location plus role. Wait for all players to confirm before the clock starts. (Rulebook: players look without letting others see, then put the card face down.)
4. *(Optional, Old pals variant only)* Two spies learn each other: after everyone has looked at their card, the dealer tells everybody (dealer included) to close eyes, the two spies open eyes on the dealer's call, look at each other and close them again, then all open eyes together and the dealer starts the clock. Only "night-like" step in the game.
5. **Clock starts (PUBLIC).** The dealer starts the stopwatch and asks the first question, calling the target by name. Timer length: step table above. Clock keeps running during normal talk.
6. **Question loop (PUBLIC, sequential, free order).**
   - The asker names one player and asks one question. Questions usually concern the location but need not.
   - No follow-up questions; the answer may take any form.
   - The answerer then asks any player except the one who just asked them (so you cannot answer with a question or ping-pong).
   - Who asks whom is up to the players, driven by suspicion. Nothing forces everyone to be asked equally.
   - Players should not argue the case against someone while a vote is underway, because reasons leak the location.
7. **Mid-round accusation (PUBLIC, any player, once per round per player).**
   - The accuser stops the clock, names one suspect, and calls a vote.
   - Everyone except the suspect votes yes or no by raising a hand (open, effectively simultaneous). The accuser counts as yes.
   - **Unanimous** (all other players yes) -> round ends. The suspect shows their card.
     - Suspect is a spy: non-spies win. 
     - Suspect is not a spy: spy wins (the table was fooled).
   - Not unanimous -> clock resumes from where it stopped, the round continues. The accuser has used their one stop but still takes part in the final vote.
   - The spy may also accuse, as a feint.
   - While this vote is open the spy cannot reveal and guess. If the vote fails and play resumes, the spy regains the right to reveal (stated explicitly in the Russian Spyfall rules v1.1; a publisher answer relayed by a BGG user in 2014 says the same).
   - Accusations may interrupt someone mid-question or mid-answer (common BGG consensus; otherwise a spy could filibuster the clock).
8. **Spy reveal and guess (PUBLIC action, spy only, only while the clock is running and no vote is open).**
   - The spy stops the clock and reveals the spy card, then consults the full location list and names exactly one location.
   - Correct -> spy wins. Wrong -> non-spies win. Round ends immediately either way.
   - With two spies: the first spy reveals and names a location; the second spy must then reveal and name one too (same or different). Spies win if **either** is right.
9. **Time up -> final vote (PUBLIC, sequential rounds of voting).** The spy can no longer reveal or guess.
   - Discussion allowed: players declare suspicions and try to convince others. The no-arguments advice in the rulebooks is for the *mid-round* vote; for the end-of-round talk, Cryptozoic R&D (Matt Hyra, on BGG) says its Spyfall printings from the second one on forbid naming the location or describing card-art details, because the spy can no longer guess. App: show this as a reminder.
   - Start with the dealer as the suspect, then continue clockwise by seat (Hobby World Russian S1 v1.1, S2 and TT texts; confirmed for Spyfall 2 by Cryptozoic's Matt Hyra on BGG, 2018). For each suspect: every other player raises a hand if they think the suspect is the spy; the suspect does not vote. Each player is the suspect exactly once; players may keep arguing between votes but cannot change the order.
   - **First suspect with unanimous votes** reveals their card and voting stops: spy -> non-spies win; non-spy -> spy wins.
   - If every player has been the suspect and nobody was unanimously convicted -> spy wins.
   - Two spies: a suspect is convicted even if two players do not raise their hands (see Voting section for the threshold). The first conviction ends the round even with two spies (Matt Hyra, BGG 2019).
   - Edition difference: the Cryptozoic Spyfall 1 text instead rotates *accusers* (dealer first names any suspect, and so on); see Common variants.
10. **Round end (PUBLIC).** Reveal everyone's role, score the round (Scoring section), discard that location from the pool.
11. **Next round or game end.** Repeat from step 1 until the agreed number of rounds. Highest total score wins.

**Public vs private summary**: location, roles, and spy identity are private until a conviction/reveal. Everything else is public: timer state, who asked whom, accusations and their outcomes, accusation-used flags, and the location list.

## Night order

n/a. No night phase. The only eyes-closed step is the optional Old pals reveal between the two spies in Spyfall 2 (step 4).

## Voting & resolution

**Required yes votes** (suspect never votes, N = number of players in the round):

| Spies in game | Yes votes needed to convict a suspect | Applies to |
|---|---|---|
| 1 | N - 1 (everyone but the suspect) | mid-round accusation and every final-vote suspect |
| 2 | N - 2 (everyone but the suspect and one other) **[AMBIG]** | mid-round accusation and every final-vote suspect |

[AMBIG] Spyfall 2 (English) words the final vote as "convicted even if two players do not raise their hands" and the accusation rule as "all votes excluding two". Default reading: the suspect plus **one** dissenter may sit out, i.e. N - 2 yes votes (this is what the second spy refusing to sell out their partner needs). A Traditional Chinese write-up of 間諜危機 2 (gameurlife) reads it the same way ("total players minus 2" vote for the suspect). A strictly literal reading of "all votes excluding two" (two dissenters among the voters, N - 3 yes votes) is possible; offer it as a configurable option (`twoSpyThreshold: N-2 | N-3`), not default. The Russian Spyfall 2 text could not be obtained to settle this.

**Algorithm (mid-round):**

```
accuse(accuser, suspect):
  require clock running, no vote open, accuser has not accused this round, suspect != accuser
  pause clock; mark accuser.accusationUsed = true; log {accuser, suspect, t}
  yes = count of players != suspect voting yes (accuser = yes)
  if yes >= need(N, spies):       # unanimous / N-2
      end round: result = isSpy(suspect) ? NONSPY_WIN_ACCUSATION : SPY_WIN_INNOCENT_ACCUSED
  else:
      resume clock with remaining time unchanged   # spy may reveal again from here
```

**Final vote:**

```
# finalVoteMode = suspect-rotation (default)
for suspect in seatOrder(startingAt = dealer):     # each player is suspect exactly once
    yes = count of players != suspect voting yes
    if yes >= need(N, spies):
        reveal(suspect)
        end: isSpy(suspect) ? NONSPY_WIN_AT_TIMEUP : SPY_WIN_SURVIVED   # innocent convicted = outcome A for scoring
        return
end: SPY_WIN_SURVIVED

# finalVoteMode = accuser-rotation (Cryptozoic Spyfall 1 option)
for accuser in seatOrder(startingAt = dealer):
    suspect = accuser.nominate()                    # any other player, repeats allowed
    same unanimity test and endings as above
end: SPY_WIN_SURVIVED
```

- **Ties / majority:** none exist in the official default. A vote is binary per suspect; 3 of 4 yes still fails with one spy. A strict majority never convicts. (Only the German-edition majority variant can tie; there, no majority = spy survives. See Common variants.)
- **Simultaneous effects:** two interrupts at once (accusation and spy reveal, or two accusations): whichever the referee processes first stops the clock; the later one is rejected. The spy missing the chance is explicit in the rules: once another player has stopped the clock, the spy cannot guess for that stop; if the table then convicts them the spy loses. If the vote fails, the spy may reveal again later (Russian S1 v1.1).
- **Chain effects:** none. A failed mid-round accusation only consumes the accuser's single stop (and, under Spyfall 2/Time Travel scoring, may earn the accuser the bonus if that spy is later caught in another mid-round vote, see Scoring). Round end is immediate on the first conviction/guess; there is no second stage.
- **Accused spy's last word:** none in the official rules. After conviction the spy cannot guess.

## Scoring & win conditions

**Round result (one outcome per round):**

| # | Outcome | Winner | Trigger |
|---|---|---|---|
| A | `SPY_WIN_SURVIVED` | spy | Final vote ends with nobody unanimously convicted |
| B | `SPY_WIN_INNOCENT_ACCUSED` | spy | Mid-round unanimous accusation of a non-spy |
| C | `SPY_WIN_GUESS` | spy | Spy reveals and names the right location |
| D | `NONSPY_WIN_ACCUSATION` | non-spies | Mid-round unanimous accusation of the spy |
| E | `NONSPY_WIN_AT_TIMEUP` | non-spies | Spy convicted in the final vote |
| F | `NONSPY_WIN_BAD_GUESS` | non-spies | Spy reveals and names the wrong location |

An innocent unanimously convicted **in the final vote** (end of the sequence) ends voting and the spy wins; treat as outcome A for scoring (see ambiguity below).

**Points, one spy (all editions):**

| Outcome | Spy | Each non-spy | Accuser bonus |
|---|---|---|---|
| A | +2 | 0 | n/a |
| B | +2 +2 = **4** | 0 | n/a |
| C | +2 +2 = **4** | 0 | n/a |
| D | 0 | +1 | +1 more to one player (non-spy total 2), see below |
| E | 0 | +1 | **none** by default (option, see below) |
| F | 0 | +1 | none (confirmed by Cryptozoic's Matt Hyra on BGG, 2017) |

**Accuser bonus (precise):** it exists only when the spy is caught by a **mid-round** vote (outcome D). Every Hobby World text attaches it to the mid-round vote: Spyfall 1 (English 2014 and Russian v1.1) says "a successful vote (before the end of the round)"; the Russian Time Travel text heads the bullet "successful early vote". Who gets it:
- Spyfall 2 / Time Travel (default): the player who **first** accused that spy mid-round, **even if that first vote failed** and the spy was caught later in another player's mid-round vote. Only that one player scores it.
- Spyfall 1 (all printings): the player who stopped the game for the vote that *succeeded*.

**Engine default:** `accuserBonus = first-accuser-midround` (award on outcome D only, to the earliest logged mid-round accuser of the caught spy). Options: `successful-accuser` (Spyfall 1), `first-accuser-any-conviction` (house reading that also pays on outcome E if a mid-round accusation named the spy earlier; not supported by any rulebook text). Final-vote suspects are never "accusers".

**Points, two spies (Spyfall 2):**

| Outcome | Each spy | Each non-spy | Accuser |
|---|---|---|---|
| Spies win by survival (A) | +2 each | 0 | n/a |
| Spies win via innocent accused (B) | +2 +2 each | 0 | n/a |
| Spies win via guess (C) | +2 each, **plus +2 to each spy who guessed right** | 0 | n/a |
| Non-spies win (D/E) when one spy is caught | the caught spy 0; the **uncaught spy scores as if a non-spy** (+1, and also the accuser bonus if they were the first mid-round accuser of the caught spy in case D) | +1 | first accuser +1 (case D only) |
| Non-spies win by bad guess (F), neither spy right | 0 | +1 | none |
| Old pals variant, a spy caught in a mid-round vote | **neither spy scores** | +1 | +1 |

Note: the rulebook says the uncaught spy "scores points as if he were a non-spy player" (plural, in the accusation box), so the default treats them as a full non-spy for that round, including bonus eligibility. A stricter `+1 only` reading is a config option.

**[AMBIG] bonus for innocent convicted at final vote:** Spyfall 1/Spyfall 2/Time Travel list "all players unanimously accused a non-spy" as +2 for the spy, and the Chinese blog says the extra applies only to the accusation and spy-request situations, not the timer vote. The win-condition list scopes case B to "in the middle of the round", and the Russian texts use the verb for the mid-round *accusation* (обвинить) in that bullet, not the verb for the end-of-round *vote*. Default: +2 only (outcome A), no bonus.

**Game end:** after the agreed number of rounds, highest total wins. **Ties are not addressed** by the rulebooks; app default: shared win, optionally one tie-break round. Points never go negative in standard play (the team-variant captain can lose points, see Variants).

**Balance remark:** a spy who survives without being identified scores 2, a non-spy only 1; spy is a rare role (1 in N), so across 5 rounds many players are never the spy at N = 6–8. App option: fair spy rotation so everyone is spy before anyone repeats (non-official).

## Edge cases an engine must handle

- Minimum 3 players (2-player only through the Time Travel variant, which changes win rules).
- Spy count 1 or 2 only. The rulebook gives no minimum for two spies; engine suggestion: allow 2 spies only from N >= 6 and warn below 9 (official recommendation is 9+; 12 forces 2 in print).
- Location never repeats within a game; pool exhaustion before the last round must be impossible or handled (reshuffle with warning).
- Roles distinct within a round when role list long enough; role list must have >= N - spies entries.
- Clock **pauses** on every accusation vote and on spy reveal; resumes with the same remaining time on a failed accusation. Never lose or gain seconds across a pause.
- Each player may call at most **one** mid-round accusation per round (counts even if it failed). They may still be suspect or voter later and take part in the final vote.
- Same suspect may be accused again by a different player. A player cannot accuse themselves.
- Suspect never votes. Accuser's vote is implicitly yes.
- Spy may accuse (counts as their one stop). Spy may accuse and still later reveal. After any failed accusation the spy may reveal again.
- Accusation during an open accusation, or spy reveal during an accusation vote, is rejected.
- Spy reveal only while the clock is running. At 0:00 the spy cannot reveal/guess. If the spy was convicted, the round is over, no guess.
- Race: accusation and spy reveal in the same instant -> first processed wins, second rejected with a message.
- A non-spy cannot trigger the spy reveal. UI should not distinguish by failing differently in a public way.
- Unanimous conviction of a non-spy mid-round: spy wins with 4 and the accused non-spy is revealed as innocent.
- Unanimous accusation of the spy: no guess allowed afterwards.
- Spy guesses wrong: non-spies win +1 each, spy 0, **no accuser bonus**.
- Final vote order: dealer first, clockwise by seat; seat order must be defined (lobby seat ring); a vote on the dealer first even if the dealer is the spy. Each player is the suspect once and each voter votes once per suspect.
- Final vote with 2 spies: threshold N-2 per suspect; first conviction ends it.
- Final vote with 3 players: both others must agree.
- All suspects fail -> spy wins +2 (even if the spy was "obviously" guessed by several).
- Two-spy guess: second spy declares **after** hearing the first spy's guess; may duplicate it. Win if either right; the +2 location bonus only to the spy/spies who were right.
- Two-spy scoring: uncaught spy scores as a non-spy when the other spy is convicted (+1, plus the accuser bonus if they were the first mid-round accuser of that spy; never the spy +2). Old pals: if the conviction happened in a mid-round vote, neither spy scores; at the final vote the normal rule applies.
- First-accuser bonus (Spyfall 2/TT default) belongs to the first mid-round accuser who named the spy that is caught by a mid-round vote, not necessarily the one whose vote succeeded; nobody gets it when the spy is caught at the final vote. Log accusations in order with timestamps.
- A failed accusation names an innocent: no penalty, nothing public learned beyond who is under suspicion.
- Disconnection (app-specific): host must be able to mark a player absent so unanimity is computed over connected players, or void the round. If the spy disconnects, void the round (no score) rather than award a win.
- Host disconnect = game over unless state is migrated (P2P authoritative host).
- Dealer rotation: left of previous dealer (Spyfall 2) or previous spy (Spyfall 1/3); only matters for who asks first and who starts the final vote.
- The first asker is the dealer; first question is not subject to the "not the previous asker" restriction.
- Question rule: the asker may not pick the person who just asked them. With 3 players this forces a strict cycle: A asks B, B must ask C (not A), C must ask A (not B), A must ask B, and so on.
- No follow-ups and no answering with a question are verbal conventions. App should not try to enforce beyond showing the previous asker.
- Timer drift: use an absolute end timestamp on the host; handle phone lock/background.
- Score tally across rounds is a pure function of round results plus config; must be deterministic for unit tests.
- Config toggles not defined by rulebook (ties, final-vote order variants) must default to the official behaviour listed above.

## Common variants

- **Spyfall 2 two spies** (official). Normal: rival spies, do not know each other. Mid-round and final vote need N-2 (default reading; N-3 as option). Second spy scores as a non-spy when the first is caught.
- **Cryptozoic Spyfall 1 end-of-round vote** (official in that printing; Cryptozoic says it was meant only to clarify the original). At time-up each player in seat order, starting with the dealer, acts as *accuser* and names any suspect; everyone except that suspect votes; a unanimous vote reveals the card and ends the round; otherwise the turn passes left. The same player may be accused several times. If every player has had a turn as accuser without a conviction, the spy wins. Config: `finalVoteMode: suspect-rotation` (default, Hobby World S1 Russian v1.1 / S2 / TT) or `accuser-rotation` (Cryptozoic S1).
- **German-edition majority vote** (reported by BGG users for the German Spyfall rules, not verified against the German rulebook). At time-up each player in turn points at a suspect; the player with a majority reveals; no majority means the spy survives. Config: `finalVoteMode: majority`.
- **Original 2014 English one-pass reading** (historical). The first English text had the dealer ask everyone to vote "starting with themselves" and say the spy loses only if everyone but the suspect votes for them; many groups read this as one simultaneous round of pointing. The Russian original of the same 2014 text says plainly that the dealer puts every player to the vote in turn, starting with themselves, i.e. the suspect-rotation default (S2/TT say the same); do not implement this reading separately.
- **Old pals** (official Spyfall 2). Spies see each other once. Easier for spies. In this mode a mid-round spy conviction gives neither spy points.
- **Combining sets** (official). Mix decks to make spy's job harder (equal cards per bag; base rules, no second spy). To use 2-spy rules with Spyfall 1 you need two identical base sets.
- **Time Travel 2-player** (official). Deal 3 cards (1 spy) from the deck, 2 to players, 1 face down in the middle; so the spy may be in the middle. Players alternate questions. Either may accuse the other: the accused shows the card; a location -> **both lose**; spy -> accuser wins. The spy cannot accuse, only point at the middle card. Revealing the hidden card needs the other's agreement: spy card -> both win; location -> spy wins; disagree -> round continues.
- **Time Travel 3-player** (official). As 2-player but 4 cards (1 spy, 3 location, one face down); questions in return are allowed.
- **Time Travel team** (official, 7+ players; deal tables given for 7–10). Two location decks, two captains; each captain secretly draws one card from a different bag, so each knows only their own location. The agents get a shuffled pile of one spy plus a near-equal split of the two locations. Captains take turns asking every unpicked agent one question, then take turns picking one agent each; repeat. A captain may decline to pick, which ends the round for that captain. If a captain picks the spy, the spy reveals and the round ends; that captain scores nothing that round; the spy scores 1 for being picked, then guesses the location of the team that picked them and then the other team's, +1 per correct guess. An unpicked spy still guesses both at round end for +1 each. Captains: +1 per picked agent holding their location, -1 per agent holding the other location. Each agent who ends up on the team of their own location: +1. Two new captains each round; game ends when everyone has captained once or twice. Not recommended as a first app feature.
- **Play your role** (official). The 2014 English and Russian v1.1 Spyfall texts strongly recommend acting out the role from the start; Spyfall 2/Time Travel recommend it but not for the first few sessions. Answer in character according to the card.
- **Round length changes** (official). Use the table; beginners may take 12–15 min.
- **Spy last-chance guess when convicted** (house rule seen in some online implementations and a BGG variants thread; **not** official; popularity in HK/TW groups unverified). Off by default.
- **Majority instead of unanimity** (house/online rule; online sites often use majority; also the reported German-edition end-of-round rule above). Not the Hobby World/Cryptozoic English rule; it removes the design where unanimity makes conviction hard for non-spies.
- **First accuser gets the bonus in Spyfall 1** (BGG house rule, 2015, to stop players deliberately failing votes to steal the bonus). This is exactly what Spyfall 2/Time Travel later made official.
- **Single round, no score** (very likely common in casual HK/TW groups; not sourced). App must support "quick mode".
- **Custom locations** (common in digital versions, very likely popular for travel-themed play: 新幹線, 居酒屋, 溫泉旅館, 神社, 便利店, 迪士尼). Not official.
- **Name-address rule** (common house rule, Chinese review): always call the target by name when asking.
- **DC Spyfall** (2018, Cryptozoic/Hobby World official reimplementation, 3–8 players, 20 DC locations). Not the same engine: the spy is the **Joker** card; some decks contain a **Harley Quinn** location card whose holder knows the location and tries to feed it to the Joker (both score if the Joker guesses right, unless the heroes expose Harley); two "multiverse" decks hold eight different locations; one all-Joker deck gives every player a Joker card. Not needed for this app; listed only so it is not mistaken for a reskin.
- Popularity in HK/TW/CN: sources I could verify show the base 3–8 version with 8 min and a 5-round game; Spyfall 2 (間諜危機 2) has a Chinese edition (2017); Time Travel is sold in TW only as an English import; no HK-specific house rules were documented.

## App design notes

**Privacy rules (hard):**
- Private: the player's card (location/role or SPY), and who is the spy until a reveal/conviction. Public: everything else, including the location list.
- The **host phone is the authoritative referee** (P2P design). It holds the secret in memory, so the dashboard must never render roles of others before round end (host is also a normal player). Peek-by-devtools is the accepted trade-off.
- Reveal screen: hold-to-reveal with a fixed visible duration, identical layout and text length for spy and non-spy to avoid glance/length tells. Silent: no sound, no haptics on reveal (iOS Safari lacks the Vibration API anyway).
- Do not show different UI chrome for the spy. The **location list button must exist for everyone and be used by everyone** (Meeple Like Us flags passing the rulebook around as an information leak; an online-play write-up also complains that the digital version hid the spy-guess rule). Offer private local strike-through on the list.
- Spy reveal button visible to all; for a non-spy it only shows a private toast and logs nothing publicly.

**What needs a narrator (Cantonese TTS from host phone only):** nothing is mandatory. Optional public cues only: round start with the dealer's name, one minute left, time up and "start final vote", accusation called by X against Y, vote result, spy reveal prompt, winner. TTS must never speak anything secret. Reuse a short Cantonese phrase bank.

**Fully automatable on phones:** dealing, secret card display, location draw without repeats, timer with pause/resume, accusation limit tracking, vote tallies and thresholds, final-vote order, scoring, rounds, dealer rotation, scoreboards, spy guess check against the secret location.

**Needs human talk (not automatable):** questions and answers, role-play, arguments. App should not intermediate questions. Optional "question tracker" (asker taps target) that only displays "X asked Y; Y cannot ask X" — keep off by default; adds friction.

**Host-moderator dashboard needs:**
- Big timer (pausable), seat ring editor (final vote order), dealer indicator, accusation-used badges per player, current vote with live yes counts (reveal after all lock), outcome/override buttons for disconnects, round and score table with per-round breakdown, "who asked whom" optional strip, spy-count and timer settings with the player-count recommendation pre-filled, location pool picker, undo last event.
- No night timers, no secret panel.

**Voting UI:** accusation: tap suspect, all others tap Yes/No privately and simultaneously, lock, then reveal tally; auto-unanimity check. Final vote: step through suspects in seat order with the same yes/no flow; allow "skip to nominated suspect" only as an option because the official order is fixed.

**One shared phone mode:**
- The phone stores seat names and the assignment, so tap-to-pass: each player takes the phone, holds to reveal, hides, passes on.
- Then it is a timer + tally device: accusations: the phone picks the suspect and the table shows hands, one "unanimous?" tap; final vote: the phone steps through suspects, one tap each. On conviction it reveals the suspect's role.
- Spy reveal: the spy takes the phone, taps "I'm the spy", the phone shows the full location grid, the spy taps one, the phone announces right/wrong. This is the same no-tell approach with only one list screen.
- Anti-tell for pass-and-play: identical view duration and layout for all, auto-hide, never skip animations.

**Timer technical:** store absolute end time on host; derive remaining; on pause store remaining; broadcast with clock offset. Keep the host awake with the Screen Wake Lock API: supported in Safari from iOS 16.4, but broken in Home Screen (installed) web apps until iOS 18.4 (Safari 18.4 release notes: "Fixed Wake Lock API for Home Screen Web Apps"). On older iOS in standalone mode, fall back to a visible "keep screen on" warning. Re-request the lock on `visibilitychange`, since iOS drops it when the page is hidden.

**Content to author:** 20–30 locations, each with >= 11 original roles in Cantonese; mark 繁中 names; include a "trip/Japan" pack. Do not copy card art, role lists or rulebook text.

## Sources

Official rulebooks (read directly):
- https://reglur.spilavinir.is/Spyfall_rules_ENG.pdf (Spyfall 2014 international printing, 26 locations)
- https://world-of-board-games.com.sg/docs/Spyfall.pdf (identical file)
- https://hwint.ru/wp-content/uploads/2019/12/SPYFALL2_rules_ENG_curves.pdf (Spyfall 2, 2016)
- https://hobbyworldint.com/wp-content/uploads/2019/12/SPYFALL3_rules_eng_.pdf (Spyfall: Time Travel, 2018)
- https://hobbyworldint.com/portfolio-item/spyfall-2/

Secondary:
- https://cryptozoic.com/products/spyfall-game
- https://www.ultraboardgames.com/spyfall/game-rules.php (final vote and accusation summary)
- https://www.meeplelikeus.co.uk/spyfall-2014/ (reference-list leak, player count)
- https://www.shutupandsitdown.com/games/spyfall/
- https://mechanicsofmagic.com/2024/04/07/critical-play-spyfall-25/ (online UI problems)
- https://en.wikipedia.org/wiki/Spyfall_(card_game)
- https://andyventure.com/boardgame-spyfall/ (TW, 最佳人數 6)
- https://gameurlife.pixnet.net/blog/post/328444182 and https://gameurlife.pixnet.net/blog/post/345106867-%E9%96%93%E8%AB%9C%E5%8D%B1%E6%A9%9F2(spyfall2)-%E8%A6%8F%E5%89%87+%E5%BF%83%E5%BE%97
- https://punchboardgame.pixnet.net/blog/post/460341701 (間諜危機 2 繁體中文版)
- http://talkboardgame.blogspot.com/2015/11/spyfall.html
- https://wobgames.net/shop/spyfall-%E9%96%93%E8%AB%9C%E5%8D%B1%E6%A9%9F/ (HK retail listing)
- https://bghut.com/goods-7552.html (間諜危機：時間旅行)
- https://boardgamemap.com/ (JP review, FAQ article)
- https://github.com/adrianocola/spyfall (open-source web implementation, React + Firebase)
- https://www.wordimpostor.com/modes/spyfall (last-chance guess mention; online, non-official)
- BGG pages (HTML returns HTTP 403; data was read through the public geekdo JSON API instead): https://boardgamegeek.com/boardgame/166384/spyfall and https://boardgamegeek.com/thread/1386166/stopping-round-accuse-player-being-spy

Added by fact-check (2026-10-03):
- https://hobbygames.ru/download/rules/SPY_rules_new-web.pdf (Russian Spyfall rules v1.1, Hobby World 2014: 30 decks, 6/7/8-min table, dealer-first suspect order, spy regains guess after failed vote)
- https://hobbygames.ru/download/rules/Spyfall_Mashina_Vremeni_Rules.pdf (Russian Time Travel rules: bonus bullet titled "successful early vote")
- Spyfall 2 English rulebook pages 2–8 rendered and read as images (the PDF has no text layer)
- BGG via geekdo API: https://api.geekdo.com/api/geekitems?objectid=166384&objecttype=thing , .../dynamicinfo?objectid=166384 (poll best 6 / rec 4–8, weight 1.23), same for 193308 (Spyfall 2), 256085 (Time Travel), 221371 (DC Spyfall); edition/version records 283255, 408492
- BGG threads (Cryptozoic's Matt Hyra rulings): https://boardgamegeek.com/thread/1552336 (Cryptozoic vs original vs German final vote), https://boardgamegeek.com/thread/1381654 , https://boardgamegeek.com/thread/2084968 (Spyfall 2 final vote order), https://boardgamegeek.com/thread/1760249 (two spies: first conviction ends round), https://boardgamegeek.com/thread/1841033 (no bonus on wrong guess), https://boardgamegeek.com/thread/1386166 (one stop per player, same suspect re-accusable), https://boardgamegeek.com/thread/1281628 (spy may guess after failed vote), https://boardgamegeek.com/thread/1459024 (German majority rule), https://boardgamegeek.com/thread/2269435 (Time Travel has no second spy card), https://boardgamegeek.com/thread/2203873
- https://developer.apple.com/documentation/safari-release-notes/safari-18_4-release-notes (Wake Lock fix for Home Screen web apps); caniuse data (Fyrd/caniuse wake-lock.json, vibration.json)

## Verification

Adversarial fact-check, 2026-10-03 UTC. Method: re-read the three cited Hobby World English rulebooks myself (the Spyfall 2 PDF has no text layer, so its pages were rendered and read as images), then cross-checked against sources the original draft did not use: the Russian originals (Spyfall rules v1.1, Time Travel), BGG data via the geekdo JSON API (polls, weight, editions, publishers), BGG rules threads with rulings from Cryptozoic R&D (Matt Hyra), Apple's Safari release notes and caniuse data.

**Confirmed (no change needed):** 26 locations / 208 cards in the 2014 English printing (names match the rulebook spread); Spyfall 2 = 20 decks of 12 (10 location + 2 spy) and 3–12 players, location names match its spread; Time Travel = 30 decks of 8, 6/7/8-minute table; Spyfall 2 timer table 6/7/8/9/10 min; spy-count advice (one spy at 6 or fewer, two at 9+, two required at 12); dealer rotation (previous spy in S1/TT, left of previous dealer in S2); question rule (no asking straight back; strict cycle at 3 players); one stop per player per round, same suspect may be accused again (Cryptozoic ruling); unanimity rule for one spy; spy cannot reveal during an open vote or after time-up; second spy declares after the first and spies win if either is right; spy scoring 2 / +2 guess / +2 innocent accused; non-spy +1; no bonus on a wrong guess (Cryptozoic ruling); first conviction ends a two-spy round (Cryptozoic ruling); Old pals both spies score 0 after a mid-round conviction; Time Travel 2- and 3-player rules; combining sets; designer, publisher and years; BGG weight about 1.2; Vibration API absent on iOS Safari; Wake Lock in Safari from iOS 16.4.

**Changed:**
1. **Accuser bonus scope (changes scores).** The draft's default paid the first-accuser bonus also when the spy was convicted at the final vote. Every Hobby World text ties the bonus to a successful *mid-round* vote (S1 English and Russian: "before the end of the round"; Russian Time Travel heading: "successful early vote"). Default changed to outcome D only; the draft's behaviour is now an opt-in house option. Also recorded that Spyfall 1 pays the *successful* accuser, while S2/TT pay the *first* accuser.
2. **Uncaught second spy's score.** The draft said "+1, not accuser". The rulebook says they score points as if a non-spy, so the default now includes accuser-bonus eligibility; `+1 only` became an option.
3. **End-of-round vote edition difference (changes who is voted on).** Added the Cryptozoic Spyfall 1 rule (rotating *accusers*, repeat suspects allowed) and the reported German majority rule as official-edition variants with a `finalVoteMode` flag. The draft listed majority voting only as a house/online rule.
4. **Final-vote discussion.** The draft's "one rulebook says don't give reasons" really refers to the mid-round vote; replaced with the Cryptozoic rule that the end-of-round talk may not name the location or describe card art.
5. **Spy guess after a failed accusation.** Made explicit that the spy may reveal again after a failed vote (Russian v1.1 text; Hobby World ruling on BGG).
6. **Timer.** "Spyfall 1 = flat 8 min for all counts" is only true of the 2014 English text; Russian v1.1 has the same 6/7/8 table as S2/TT.
7. **Editions.** Added the Russian original (30 decks: the English 26 plus Terrorist Base, Vegetable Warehouse, Partisan Squad, Church). Cryptozoic's 30 confirmed (240 cards, 30 bags, 3–8) but its extra 4 names are still unverified. Time Travel has no second spy card.
8. **Identity / names.** "間諜危機：時間旅行" is only a TW retailer label for the English import; "間諜危機：DC" was unsupported and removed. Added the Chinese editions (2015 base, 2017 Spyfall 2), the Russian title, Time Travel box 2–8, and the BGG best-count poll (best 6, rec. 4–8; S2 best 6–8), replacing "poll not retrievable" and the unsupported "timer table treats 5–8 as core range" claim.
9. **DC Spyfall.** "Same engine, hero cards" was wrong: it uses a Joker spy, a Harley Quinn accomplice card, multiverse decks and an all-Joker deck.
10. **Time Travel team variant.** Corrected "each placed agent +1" to: only agents placed with the captain of their own location score; a captain who picks the spy scores nothing; a captain may decline to pick (ends their round); an unpicked spy still guesses both locations.
11. **Two-spy threshold.** Kept N-2 as the default, now backed by the TW Chinese reading, and added the literal N-3 reading as a `twoSpyThreshold` option.
12. **Play-your-role timing.** S1 recommends acting out roles from the start; S2/TT say not in the first few sessions.
13. **Wake Lock.** Added that Wake Lock was broken in Home Screen (standalone) web apps until iOS 18.4 (Safari 18.4 release notes), with a fallback note.
14. Pseudo-code: outcome names now match the outcome table; added the accuser-rotation loop.

**Still unresolved:** the exact two-spy threshold (Russian Spyfall 2 text not obtained); the 4 extra Cryptozoic location names; the German rule is reported by BGG users, not read from the German rulebook; whether the +2 "innocent accused" spy bonus also applies to a final-vote conviction (default stays no).
