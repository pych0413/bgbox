# The Resistance: Avalon — rules reference

> Paraphrased for engine implementation. Not a copy of the official rulebook.

Repo game id: `avalon` (listed in `docs/DESIGN.md` as 阿瓦隆, 5–10 players: role reveal, team votes, quest cards, tokens).

Reading guide: statements marked **[official]** come from the publisher's printed rulebook (Indie Boards & Cards, 2012 printing, 8-page booklet; scan hosted at avalon.fun), the official Lancelot / Excalibur promo rule sheets (Indie Boards & Cards, 2012), and rulings posted on BoardGameGeek by the publisher Travis Worthington (credited in the rulebook for game development). The licensed digital rendition on Dized Rules (rules.dized.com) and its FAQ is used as a second source; **where Dized contradicts the printed rulebook or the publisher's ruling, the printed/publisher ruling wins and the Dized reading is listed under Common variants.** **[common]** means widespread community practice that the rulebook does not state outright. **[ambiguous]** means sources disagree; the engine should expose a switch (see "Open questions" in the Edge cases and Variants sections).

---

## Identity

| Field | Value |
|---|---|
| EN name | The Resistance: Avalon |
| 繁中 name(s) | 阿瓦隆 (HK/TW shop and community name); 抵抗組織：阿瓦隆 (full Taiwan/zh-wiki title, "The Resistance" itself is 抵抗組織) |
| Team names | Good = 正義陣營 / 藍方 (blue, "Loyal Servants of Arthur", 亞瑟的忠臣); Evil = 邪惡陣營 / 紅方 (red, "Minions of Mordred", 莫德雷德的爪牙) |
| Player range | 5–10 **[official]** |
| Best count | Not stated by the publisher. BoardGameGeek community poll: **best 7–8, recommended 5–10** (545 votes, checked 2026-10-03). 6 and 9 give Good its best head-count ratio (2:1); **7 is the tightest for Good (4:3)**, then 5 and 10 (3:2). Use 7–8 as the default balance-testing target. |
| Designer / publisher | Don Eskridge (designer of The Resistance, BGG year 2009; zh-wiki gives 2010); Avalon is the Arthurian re-theme with special characters, published by Indie Boards & Cards, 2012. Game development: Travis Worthington (publisher). |
| Length | About 30 minutes (BGG: 30 min, ages 12+) |
| Game type | Hidden team loyalty, public team-building votes, secret quest sabotage, end-game "find Merlin" assassination |

**Physical components the app must replace** (14 character cards, 10 quest cards, tokens, tableau):

- 14 character cards: Merlin, Assassin, Percival, Morgana, Mordred, Oberon, 5 Loyal Servants, 3 Minions of Mordred. The counts cap the deck: at most 5 Servants, at most 3 plain Minions.
- 10 quest cards: 5 Success, 5 Fail. Each team member gets one of each; the largest team is 5, hence 5 of each.
- Vote tokens: one Approve and one Reject per player (20 total in the box).
- 5 team tokens (the leader hands one to each nominee).
- Leader token; round marker (quest 1–5); vote-track marker (rejected-team counter, 5 spaces); 5 score markers (blue = success, red = fail).
- 3 double-sided score tableaus (one side per player count 5–10): show team size per quest for that count, the vote track, and mark the quest that needs two Fail cards.
- Optional: Lady of the Lake token (public) and Loyalty cards (a Good card and an Evil card; used only with the Lady, and with Plot cards from other Resistance sets).
- The leader's night-phase script (thumbs-up, eyes-closed ritual).

---

## Roles

Team colour in UI: Good = blue, Evil = red. All eight base-game roles are listed. Lancelot / Excalibur material is under Variants.

| id | EN | 繁中 | team | ability (precise) | acts at night? when? |
|---|---|---|---|---|---|
| `merlin` | Merlin | 梅林 | good | Learns which players are evil, but only as "evil" (never which evil role). Does **not** see Mordred. **Does see Oberon** (printed script + publisher ruling; Dized's text disagrees, see Oberon note). Merlin does not see who is Percival. Must hide this knowledge, because if Good completes 3 quests the Assassin gets one guess at Merlin. | Yes. Opens eyes after the evil team has finished recognising each other and raised thumbs (step 5 of the script). Also gives a thumb to Percival at step 7 (shared with Morgana). |
| `percival` | Percival | 派西維爾 | good | Learns the identity of Merlin. If Morgana is in play, Percival sees two players (Merlin and Morgana) and cannot tell which is which. If Morgana is not in play he sees exactly one player and knows it is Merlin. | Yes. Opens eyes at step 8, after Merlin and Morgana raise thumbs. |
| `loyal-servant` | Loyal Servant of Arthur | 亞瑟的忠臣 (忠臣) | good | No ability. Must play Success on any quest. | No. |
| `assassin` | Assassin | 刺客 | evil | Ordinary evil player during the game. If Good scores 3 successful quests, the Assassin names one player; if that player is Merlin, Evil wins instead. Card reveal at that moment is **[ambiguous]**: the 2012 printed rulebook has Evil confer "without revealing any Character cards" and the Assassin then names a target; the Dized text has the Assassin reveal their own card just before naming. Either way no other card is shown before the shot. The Assassin is a separate card from Morgana, Mordred, Oberon and the plain Minions. | Yes, as part of the evil team (recognition step 2, thumb for Merlin at step 4). The assassination itself happens after the last quest, not at night. |
| `morgana` | Morgana | 莫甘娜 | evil | Appears to Percival as a second Merlin (raises a thumb at Percival's step). Her power only matters if Percival is in play. Otherwise ordinary evil. | Yes. Recognition (step 2), thumb for Merlin (step 4), thumb for Percival (step 7). |
| `mordred` | Mordred | 莫德雷德 | evil | Invisible to Merlin: does not raise a thumb for Merlin. Otherwise sees and is seen by the evil team normally. | Yes. Recognition (step 2). No thumb at step 4. |
| `oberon` | Oberon | 奧伯倫 (奧伯龍; colloquially 孤兒牌, "orphan card") | evil | Evil, but isolated: does not learn who the other evil players are and the other evil players do not learn him. Plays blind. **Is seen by Merlin** and **shows Evil to the Lady of the Lake** (official default; the Dized reading that hides him from both is a variant, see below). Oberon replaces a plain Minion. | Eyes stay closed at recognition (step 2). Raises a thumb for Merlin at step 4 (default; skipped only under the Dized-reading variant). |
| `minion-of-mordred` | Minion of Mordred | 莫德雷德的爪牙 (爪牙) | evil | No ability beyond being evil: knows the evil team (except Oberon), may play Fail. | Yes. Recognition (step 2), thumb for Merlin (step 4). |

Derived properties the engine needs per role:

| id | team | seen by Merlin | seen by evil teammates | appears to Percival | Lady of the Lake reads |
|---|---|---|---|---|---|
| `merlin` | good | no | no | **yes** (as the "Merlin" candidate) | good |
| `percival` | good | no | no | no | good |
| `loyal-servant` | good | no | no | no | good |
| `assassin` | evil | yes | yes | no | evil |
| `morgana` | evil | yes | yes | **yes** (as a "Merlin" candidate) | evil |
| `mordred` | evil | **no** | yes | no | **evil** (printed loyalty-card rule; Dized FAQ agrees: hidden from Merlin, not from the Lady) |
| `oberon` | evil | **yes** (default; `oberonSeenByMerlin`) | **no** | no | **evil** (default; `oberonReadsGoodToLady`) |
| `minion-of-mordred` | evil | yes | yes | no | evil |

**Oberon ruling (important, resolved).** The printed rulebook's extended script exempts only Mordred from the Merlin-thumb step, and its Oberon text says only that he neither reveals himself to nor learns the other Evil players (it also calls him "not a Minion of Mordred", which is the root of the confusion, because the thumb line is addressed to "Minions of Mordred"). The publisher settled it on BoardGameGeek in October 2012 (thread "Oberon - Revealed to Merlin?", reply by Travis Worthington of Indie Boards & Cards): Oberon is hidden from the evil team but **is revealed to Merlin**. For the Lady of the Lake, the printed rule requires every examined player to pass the loyalty card that matches the loyalty on their character card, and Oberon's card is an Evil card, so **Oberon shows Evil**. A 2023 BGG rules thread gives the same answer. The Dized rendition (Oberon card page and FAQ) says the opposite on both points (invisible to Merlin, shows good to the Lady). That contradicts the printed rules and the publisher, so treat it as a variant. Most English and Chinese guides agree with the official reading (孤兒牌: 梅林知道其身份); a minority of Taiwan write-ups and some groups hide Oberon from Merlin. Keep the two switches (`oberonSeenByMerlin` default **true**, `oberonReadsGoodToLady` default **false**) so groups that learned the Dized reading can still play their way.

---

## Setup by player count

### Base composition [official]

| N | Good | Evil | Base cards (Good) | Base cards (Evil) | Approvals needed (strict majority) |
|---|---|---|---|---|---|
| 5 | 3 | 2 | Merlin + 2 Servants | Assassin + 1 Minion | 3 |
| 6 | 4 | 2 | Merlin + 3 Servants | Assassin + 1 Minion | 4 |
| 7 | 4 | 3 | Merlin + 3 Servants | Assassin + 2 Minions | 4 |
| 8 | 5 | 3 | Merlin + 4 Servants | Assassin + 2 Minions | 5 |
| 9 | 6 | 3 | Merlin + 5 Servants | Assassin + 2 Minions | 5 |
| 10 | 6 | 4 | Merlin + 5 Servants | Assassin + 3 Minions | 6 |

Official swap-in rules for special characters:

- Percival replaces one Loyal Servant. In a 5-player game with Percival, the plain Minion should also be replaced by Mordred or Morgana. **[official]**
- Morgana, Mordred and Oberon each replace one plain Minion (never the Assassin). **[official]**
- Merlin and the Assassin are always in the deck. **[official]** (The setup page says they "are included in all games"; the optional-characters page softens this to "in most cases" you will want Merlin, "but it is not required". The app should always include both; a no-Merlin/no-Assassin game is just The Resistance and is out of scope.)
- Per-count constraint implied by the swaps: at most `GOOD_COUNT[N] − 1` good specials (only Percival exists) and at most `EVIL_COUNT[N] − 1` evil specials besides the Assassin. At N=5/6 that means **only one** of Morgana / Mordred / Oberon.
- Balance knobs (the printed rulebook's notes on each character and the Dized FAQ agree): easier for Evil = add Mordred or Morgana; easier for Good = add Percival or Oberon, or use the Lady of the Lake. The rulebook advises adding one special character at a time as the group learns.

### Commonly used role sets [common]

These are the sets most guides recommend. English guides and the Chinese-community standard (as summarised on zh-wiki: Morgana and Assassin at every count, Oberon only at 7 and 10, Mordred only at 9 and 10, a plain Minion only at 8) agree everywhere except **8 players**. Marked "plain" = official base only; "std" = the commonly used set with specials. For this HK/TW group, default to the Chinese-standard column choice.

| N | plain (official base) | std (common) | Servants in std | Notes |
|---|---|---|---|---|
| 5 | Merlin, 2 Servants / Assassin, Minion | Merlin, Percival, 1 Servant / Morgana, Assassin | 1 | Percival forces Mordred or Morgana for balance (official). Mordred is the alternative. |
| 6 | Merlin, 3 Servants / Assassin, Minion | Merlin, Percival, 2 Servants / Morgana, Assassin | 2 | Many groups start plain at 6 for new players. |
| 7 | Merlin, 3 Servants / Assassin, 2 Minions | Merlin, Percival, 2 Servants / Morgana, Assassin, Oberon | 2 | Alternate: Minion instead of Oberon (common in Taiwan guides). Two-Fail rule on quest 4 starts here. |
| 8 | Merlin, 4 Servants / Assassin, 2 Minions | Merlin, Percival, 3 Servants / Morgana, Assassin, **Minion** (Chinese standard, zh-wiki) | 3 | English guides (e.g. hexagamers) use Mordred instead of the Minion; offer both presets. Official rulebook recommends the Lady of the Lake from 7 players; some TW/zh-wiki sources say 8+. |
| 9 | Merlin, 5 Servants / Assassin, 2 Minions | Merlin, Percival, 4 Servants / Morgana, Mordred, Assassin | 4 | Plain 9-player is the max-Good base (6 vs 3). |
| 10 | Merlin, 5 Servants / Assassin, 3 Minions | Merlin, Percival, 4 Servants / Morgana, Mordred, Oberon, Assassin | 4 | Uses all four optional characters. |

Engine validation rules:

- `good_count + evil_count == N` using the table above.
- `merlin` count = 1, `assassin` count = 1.
- `percival` ≤ 1, `morgana` ≤ 1, `mordred` ≤ 1, `oberon` ≤ 1. Servants ≤ 5, Minions ≤ 3.
- Warn (do not forbid) when Morgana is in play without Percival (her power is inert) and when Percival is in play at N=5 without Morgana/Mordred.
- Custom sets that break the team counts are not part of the official game; offer them only behind an "advanced" switch.

### Quest team sizes [official]

Rows are player count, columns are quest 1–5. An asterisk means that quest needs two Fail cards.

| N | Q1 | Q2 | Q3 | Q4 | Q5 |
|---|---|---|---|---|---|
| 5 | 2 | 3 | 2 | 3 | 3 |
| 6 | 2 | 3 | 4 | 3 | 4 |
| 7 | 2 | 3 | 3 | 4* | 4 |
| 8 | 3 | 4 | 4 | 5* | 5 |
| 9 | 3 | 4 | 4 | 5* | 5 |
| 10 | 3 | 4 | 4 | 5* | 5 |

Two-Fail rule: **only quest 4, only when N ≥ 7** (7, 8, 9, 10 players). In 5- and 6-player games every quest, including quest 4, fails on a single Fail card. Quest 5 never needs two Fails.

Reference constants:

```js
const GOOD_COUNT = {5:3, 6:4, 7:4, 8:5, 9:6, 10:6};
const EVIL_COUNT = {5:2, 6:2, 7:3, 8:3, 9:3, 10:4};
const TEAM_SIZE  = {
  5: [2,3,2,3,3],  6: [2,3,4,3,4],  7: [2,3,3,4,4],
  8: [3,4,4,5,5],  9: [3,4,4,5,5], 10: [3,4,4,5,5],
};
const failsNeeded = (n, questNo) => (n >= 7 && questNo === 4) ? 2 : 1;
const approvalsNeeded = n => Math.floor(n / 2) + 1;   // strict majority
```

---

## Procedure

Players sit in a ring. "Clockwise" is the direction the leader token travels. The engine needs one canonical seat order for the whole game.

1. **Choose configuration** (public, host). Player count N, role set (preset or custom within the validation rules), options (Lady of the Lake, Oberon settings, Targeting, discussion timers). It is common practice to announce which special characters are in play before dealing, because Merlin/Morgana/Percival reasoning depends on it **[common]**. Default: the role list is public, who holds what is secret.
2. **Pick the first leader** (public, random) **[official]**. The printed setup picks the leader before dealing, because the leader reads the night script. If the Lady of the Lake is used, its token goes now to the player on the leader's **right**, i.e. the player who will be the last to lead in clockwise order **[official]**. The token is public.
3. **Deal roles** (private to each player, sequential in effect but simultaneous in UI). Shuffle the chosen character cards, one to each player, each player looks at their own card only. Nobody may ever show their card or loyalty card or describe its artwork; they may say anything else, true or false.
4. **Night / reveal phase** (private information, see "Night order"). Evil recognise each other (minus Oberon), Merlin learns evil (minus Mordred; Oberon included by default), Percival learns Merlin (+ Morgana). Everyone else learns nothing. Official procedure is the eyes-closed thumbs ritual read by the leader (or a narrator); on phones each role simply gets a private info screen.
5. **Round loop** for quest numbers 1 to 5 (stop as soon as a game-end condition fires):
   1. **Nominate** (public; actor = leader). The leader picks exactly `TEAM_SIZE[N][quest]` players by handing each a team token. The leader may include themselves or not. A player can hold only one token. Table discussion is free and unstructured (no official timer; app may offer an optional one).
   2. **Vote** (secret then public; all N players including the leader, simultaneous). Each player secretly chooses Approve or Reject, then all votes are revealed at once, with names attached. Strict majority of Approve = team approved. A tie, or a majority of Reject, = rejected.
   3. **If rejected:** increment the vote track, pass the leader token one seat clockwise, and return to step 5.1 for the **same** quest with a different leader. If this is the 5th consecutive rejection in the round, **Evil wins immediately** (skip to step 7). The fifth proposal is still voted on in the official game; it can be approved.
   4. **If approved:** the vote track is reset (it only counts consecutive rejections inside one round) and the quest is played.
   5. **Quest** (secret, simultaneous, team members only). Each team member gets one Success and one Fail card, chooses one in secret, and plays it face down. Good players must play Success. Evil players may play Success or Fail.
   6. **Resolve** (public). The leader gathers the played cards, shuffles them without looking, and reveals them all. Only the count of Success and Fail is known; who played which is never shown. The quest is a Fail if the number of Fail cards is at least `failsNeeded(N, quest)`; otherwise it is a Success. Record it (blue marker for success, red for fail) and advance the round marker.
   7. **Check game end** (see Scoring). If the game is not over:
   8. **Lady of the Lake** (only if used and only after quests 2, 3 and 4): see below.
   9. **Pass the leader token** one seat clockwise from the player who made the last proposal (the quest proposer), and start the next quest.
6. **Lady of the Lake step** (optional, public holder, private result; the rulebook says it is "best saved" for 7+ players). Immediately after the 2nd, 3rd and 4th quests are resolved (counting quests actually played, which matters only under Targeting), and only if the game has not ended, so at most three uses per game: the token holder chooses one other player who has never held the token (not themselves, not the original holder, not any later holder). The chosen player secretly shows the holder their loyalty card for their team (Good or Evil, never the role). The chosen player then **takes** the token. The holder may tell the table anything about what they saw, true or false, and may not show the card. Everyone always knows who holds the token. Using the wrong loyalty card is cheating: that side loses (the app prevents this by computing the answer).
7. **Game end.**
   - Third failed quest, or fifth consecutive rejected team: **Evil wins** immediately. No assassination.
   - Third successful quest: **assassination phase** (secret decision, public reveal). The printed rule says the Evil players confer and the Assassin names one Good player as Merlin, with no character cards revealed. Whether Good players may talk during this is unclear; on BGG it is argued both ways, and the printed wording ("the Evil players discuss") leans towards Evil-only talk. **[common]** etiquette: Good players stay quiet, and Merlin in particular must not speak up. If the named player holds Merlin, Evil wins. If not, Good wins. Card reveal: printed 2012 rulebook = none before the shot; Dized = the Assassin shows their own card just before naming; zh-community convention = all Evil flip their cards first (see Common variants). Engine default: no cards shown before the shot; once the Assassin locks a target, show the Assassin, the target and whether the target is Merlin, then reveal all roles.
   - The game ends the moment the result is determined; remaining quests are not played.

Timers: none in the official game. Optional app additions (see App design notes): discussion timer per proposal, a cap on assassination deliberation, and fixed-length private reveal screens.

---

## Night order

Official extended script (used whenever any of Percival, Morgana, Mordred or Oberon is in play), paraphrased. Without special characters (base game) the script collapses to steps 1, 2 (all evil open eyes), 3, 4 (all evil thumbs, nobody exempt), 5, 6 and 10.

| Step | Narrator says (paraphrase) | Who acts | What they learn / do |
|---|---|---|---|
| 1 | Everyone close eyes and hold a fist out in front | all | Nothing. |
| 2 | Evil characters, except Oberon, open your eyes and look around | Assassin, Morgana, Mordred, plain Minions | Each learns exactly who the other evil players are (as evil; no role labels). Oberon keeps eyes shut. |
| 3 | Evil characters close your eyes | same | nothing |
| 4 | Evil characters, except Mordred, raise a thumb so Merlin can know you | Assassin, Morgana, Minions, **Oberon** (default; omitted only if `oberonSeenByMerlin=false`) | Thumbs only; their own eyes are closed so they learn nothing new. (The printed line says "Minions of Mordred, not Mordred himself"; per the publisher's ruling this includes Oberon.) |
| 5 | Merlin, open your eyes and see the evil characters | Merlin | Learns the set of thumbed players = evil minus Mordred (and minus Oberon if `oberonSeenByMerlin` is false). Merlin sees only "evil", no roles, and does not learn how many are hidden. |
| 6 | Evil lower thumbs and make fists again; Merlin closes eyes | evil, Merlin | nothing (order of these two actions is not rules-significant) |
| 7 | Merlin and Morgana raise a thumb so Percival can know you (skip if no Percival) | Merlin, Morgana (if present) | Thumbs only. |
| 8 | Percival, open your eyes and see Merlin (and Morgana) | Percival | Sees 2 thumbs if Morgana is in play (cannot tell which is Merlin), 1 thumb if not (that player is Merlin). Percival learns nothing about evil teams. |
| 9 | Merlin and Morgana lower thumbs; Percival closes eyes | Merlin, Morgana, Percival | nothing |
| 10 | Everyone open your eyes | all | Night ends. |

Who sees whom (observer rows, target columns). "E" = sees as evil; "M?" = sees as a Merlin candidate; "-" = no information.

| observer \ target | Merlin | Percival | Servant | Assassin | Morgana | Mordred | Oberon | Minion |
|---|---|---|---|---|---|---|---|---|
| Merlin | - | - | - | E | E | **-** | E (default; - under Dized variant) | E |
| Percival | M? | - | - | - | M? | - | - | - |
| Servant | - | - | - | - | - | - | - | - |
| Assassin / Morgana / Mordred / Minion | - | - | - | E | E | E | **-** | E |
| Oberon | - | - | - | - | - | - | - | - |

Notes:

- Evil players never learn each other's specific roles from the night phase. Only Merlin-vs-Morgana ambiguity and "who is evil" are exposed. Under the printed rules the Assassin is identified only when they make the shot (see Assassination).
- Merlin's knowledge is names-only. With Mordred in play the number of players Merlin sees is smaller than the true evil count (Merlin is not told this).
- Percival does not know Mordred, Oberon or other evil exist as roles.
- Morgana knows she shows up for Percival, but the rules do not tell her whether Percival is actually in the game; the public role list tells everyone.

Suggested Cantonese narrator lines for the host phone (非官方原文，只係建議；代碼同文檔一律英文)：

1. 「所有人閉眼，伸一隻拳頭出嚟。」
2. 「邪惡陣營（奧伯倫除外）睜開眼，互相認人。」
3. 「邪惡陣營閉眼。」
4. 「邪惡陣營（莫德雷德除外）豎起大拇指，畀梅林認。」
5. 「梅林睜眼，睇清楚邪惡陣營。」
6. 「邪惡陣營收返大拇指，梅林閉眼。」
7. 「梅林同莫甘娜豎起大拇指，畀派西維爾認。」（無莫甘娜就讀「梅林豎起大拇指」；無派西維爾，規則上 7–9 可以跳過，但為免被聽出，建議照讀並停頓相同時間）
8. 「派西維爾睜眼。」
9. 「梅林同莫甘娜收返大拇指，派西維爾閉眼。」
10. 「所有人睜開眼。」

---

## Voting & resolution

### Team vote

```
approvals = count(votes == APPROVE)       // all N players vote, leader included
approved  = approvals >= floor(N/2) + 1   // strict majority; equivalently approvals > rejects
```

- All players vote, including the leader and including players on the team. Votes are locked in secretly and revealed simultaneously **with names**. This is the main public information source in the game.
- Tie (possible only at even N: 6, 8, 10) = rejected.
- Approved: reset `voteTrack = 0`, go to quest.
- Rejected: `voteTrack += 1`, leader token moves one seat clockwise, same quest number, new nomination. If `voteTrack == 5` after a rejection: Evil wins at once.
- The vote track counts consecutive rejections within the same quest round only; every approved team plays its quest and ends the round, so the track starts at 0 again.

### Leader rotation

- Leader seat = `(startSeat + totalProposalsSoFar) mod N`, where every proposal counts, approved or rejected.
- After a quest, the next quest's leader is the next seat clockwise after the player who proposed the team that just played.
- Start leader is random. The Lady holder at start is the seat immediately before the start leader (counter-clockwise neighbour).

### Quest

- Only team members act. Each plays exactly one card. Good players are given no choice (Success only). Evil choose freely.
- `fails = count(played == FAIL)`. Quest fails iff `fails >= failsNeeded(N, quest)`. With N≥7 on quest 4, exactly one Fail card yields a **Success**, and the table still sees that one Fail card was in the pile.
- Reveal order is shuffled; no attribution. The app must discard submission order and seat association when it builds the revealed pile.

### Chain effects and ordering of checks

After each quest result, in this order:

1. If `failedQuests == 3`: Evil wins (reason `three-fails`). Stop; no Lady, no assassination.
2. Else if `successQuests == 3`: go to assassination (no Lady use after that quest).
3. Else if `questsResolved` (successes + fails so far) is 2, 3 or 4 and the Lady is in use: run the Lady check (this is only reachable if the game is still undecided). Without Targeting this equals the quest number; with Targeting, count quests played, not the quest slot chosen (community reading on BGG; the rulebook does not address the combination).
4. Pass leader token, begin next quest.

A rejected-team 5th-strike is checked at the moment of the fifth rejection (reason `five-rejections`).

### Assassination

- Actor: the player holding the Assassin card. Evil players may talk it over first; the Assassin makes the call alone.
- No character cards are revealed before the shot (printed rulebook). Variants: Dized has the Assassin show their own card first; Chinese groups often have every Evil player flip their card first (see Common variants). With Oberon in play under the printed rule, the evil team may not know who Oberon is, and anyone can claim to be him.
- Target: any single other player (the rules say a player on the good team; naming an evil player is legal but certain to lose). The UI should allow any seat except the Assassin's own.
- Resolution: target is Merlin → Evil wins (`assassinated-merlin`). Otherwise Good wins (`assassin-missed`).
- Percival is the usual decoy target; Morgana's presence exists to confuse Percival, not the Assassin.

---

## Scoring & win conditions

There is no point scoring. One game = one result for each player's team.

| Result | Trigger | Reason code |
|---|---|---|
| Evil wins | 3 failed quests | `three-fails` |
| Evil wins | 5 consecutive rejected teams in one round | `five-rejections` |
| Evil wins | 3 successful quests, then the Assassin names Merlin | `assassinated-merlin` |
| Good wins | 3 successful quests, then the Assassin names someone who is not Merlin | `assassin-missed` |

- Good never wins before the assassination step resolves.
- At most 5 quests are played. The quest count and the checks above guarantee termination.
- Check order: the first condition to fire ends the game. The two Evil instant-win conditions (3 fails, 5 rejections) can never co-occur with Good reaching 3 successes in the same instant.
- Multi-game sessions are not defined by the rules. For the hub, track per-player wins per team (good/evil) and per role, and optionally "first to N wins" as a house format. Rotate the seat order or the start leader between games.

---

## Edge cases an engine must handle

Team sizes and fails
- Team size for each (N, quest) must match the table exactly; reject a nomination with wrong size, duplicate players, or players not in the game.
- Leader may nominate themselves or not; leader may be absent from the team.
- N=5 and 6: quest 4 fails on one Fail card. N=7..10: quest 4 needs two. Quest 5 always needs one, at every N.
- N=7, quest 4: team of 4, one Fail played → quest **succeeds**; pile shows 1 Fail and 3 Success publicly.
- Evil can fail to sabotage: evil players may play Success. A Good player can never submit Fail (engine rejects it; UI shouldn't offer it).
- A quest whose team contains zero evil players always succeeds; a team with one evil on a two-Fail quest cannot fail.

Voting
- Strict majority required: N=6, 3 Approve vs 3 Reject = rejected. N=8: 4–4 rejected. N=10: 5–5 rejected.
- Leader's own vote counts like any other.
- Votes are public after reveal; the engine must keep the per-player log for the table.
- Fifth rejection ends the game immediately; the sixth nomination never happens.
- Fifth proposal is still put to a vote in the official game (some digital implementations skip the vote and force the team; treat as variant).
- A rejected team does not change the quest number, the score, or Lady-of-the-Lake state. Leader moves on.
- An approved team resets the rejection counter to 0, even if the next team gets rejected 4 times again.

Leader and Lady
- Leader moves one seat per proposal regardless of approval; start leader is random; Lady starts one seat before the start leader.
- Lady is used only after quests 2, 3, 4 (the 2nd/3rd/4th quest resolved; at most 3 uses per game), and only if the game is still going: after quest 3 only when the score is not 3–0 for either side; after quest 4 only when the score is 2–2 (otherwise the game has ended).
- Lady target restrictions: not self, not any previous holder including the initial one. So the third check (after quest 4) chooses from N−3 candidates (≥2 at N=5), the first from N−1, the second from N−2.
- The checked player receives the token, so the next holder is always the person just checked.
- Lady reveals only Good/Evil: Merlin, Percival, Servants show Good; Assassin, Morgana, Mordred, Minion, **Oberon** show Evil. Mordred is **evil** to the Lady (printed loyalty-card rule plus Dized FAQ). Oberon shows Evil unless the `oberonReadsGoodToLady` variant is on.
- The holder's public claim and the private result are independent; the app should not constrain what the holder says.
- Lady use after quests 2, 3, 4 does not depend on whether a given quest succeeded or failed.

Night knowledge
- Merlin sees evil minus Mordred (Oberon included by default; excluded only if `oberonSeenByMerlin=false`). Merlin never sees a role name.
- Percival sees {Merlin} plus {Morgana} when she is in play; one name = Merlin for certain; two names = shuffled, unlabelled.
- Evil players (not Oberon) see all other evil except Oberon. Mordred sees evil and is seen by evil.
- Oberon sees nobody; evil do not see Oberon.
- Morgana without Percival: legal, no visible effect. Percival without Morgana: legal, Percival learns Merlin exactly.
- A 5-player game with Percival and no Morgana/Mordred is legal but the rulebook advises against it.
- Example: 5 players with Mordred + Assassin as the evil pair. Merlin sees one thumb (the Assassin) and has no way to know a second evil player exists except from the public role list.
- Information on private screens must be randomised in order (names shuffled) so seat order does not leak roles.

Assassination
- Triggered only by the third successful quest. Never after three fails or five rejections.
- Assassin must be a distinct card; there is always one when Merlin is in play.
- Any non-Merlin target ends the game for Good. Naming the Assassin themself or an evil player is legal and loses.
- Percival and Morgana are indistinguishable to Percival, not to the Assassin; Assassin picks from the whole table.

Information limits
- Cards (role or loyalty) can never be shown; the app never offers a "show my card" feature to other players.
- Role list in play is public by convention; each player's role is private.
- No information about who played which quest card ever leaves the engine. Only counts.
- The fail count of a quest that still succeeded (quest 4, N≥7) is public.

Connectivity
- A player who disconnects mid-vote or mid-quest must be recoverable (reconnect restores their pending prompt) or the host can force a default. Defaults: AFK vote = Reject is a house rule, not official; AFK quest card for a Good player = Success; for an Evil player = ask host.
- Host/referee phone is authoritative; a late vote after reveal must be ignored.

Tests worth writing
- Table-driven test: `TEAM_SIZE`, `failsNeeded`, `approvalsNeeded` for every N from 5 to 10.
- Property test: for any random legal setup, number of evil seen by Merlin equals evil minus Mordred (minus Oberon when hidden).
- Simulation: random games always terminate within 5 quests and 5 rejections per round.
- Lady: sequence of checks never repeats a target, never targets a holder, always has a legal candidate at N≥5.

---

## Common variants

Official (publisher) optional rules and expansions

- **Targeting** [official, rare]: the leader also chooses which quest to attempt next; a quest already scored cannot be chosen; quest 5 may be chosen only after at least two other quests have succeeded. Team size follows the chosen quest. Votes should consider both quest and team. The two-Fail rule still applies to quest 4 at N≥7. In the app this changes the round marker logic (no auto-advance).
- **Lady of the Lake** [official, popular]: as described. The printed rulebook and the Dized FAQ both say it helps Good. The printed rulebook recommends it for **7 or more players** (a recommendation, not a hard lock; the Dized rendition drops this note). Several Taiwan/zh-wiki write-ups say 8+. Offer it for any N, default on for N≥7.
- **Plot cards / Loyalty cards** [official, not popular]: Plot cards from other Resistance sets use the loyalty cards for revealing. Skip in v1.
- **Lancelot (蘭斯洛特)** [official promo, Indie Boards & Cards 2012 rule sheet; popular in CN/TW/HK groups]: two cards, Good Lancelot and Evil Lancelot, replace one Good and one Evil card. The promo sheet has **three official variants** (it resolves the earlier "from quest 3 vs mapped to five quests" question: these are two different variants):
  - **Variant 1 (random switches):** Loyalty deck of **5 cards = 3 "No Change" + 2 "Switch Allegiance"**, shuffled face down. At the start of round 3, and at the start of rounds 4 and 5, flip the top card. On a Switch, the two Lancelots secretly swap allegiance: win conditions and quest-card rules swap too, but they keep their character cards. Possible outcomes: 0, 1 or 2 switches.
  - **Variant 2 (known schedule, forced play):** deck of **7 cards = 5 No Change + 2 Switch**. At game start, deal 5 cards **face up** in order, one per round. A Switch takes effect at the start of that round (rounds 1–5, public knowledge). The current Evil Lancelot **must play Fail**; the current Good Lancelot must play Success.
  - **Variant 3 (no switching):** the two Lancelots know each other: a step at the end of the night script has them open their eyes to see their counterpart. Recommended only for larger groups.
  - Night (variants 1 and 2): Evil Lancelot keeps his eyes **closed** while Evil recognise each other, but raises a thumb so the Evil team learns him; he does not learn them. The sheet does not mention Merlin, but the common reading is that he also raises a thumb for Merlin as an evil character **[common]**.
  - With Targeting, "round" means the number of quests played so far (community reading).
- **Excalibur (王者之劍)** [official promo, a **separate** 2012 promo card often sold together with the Lancelots]: when proposing the team, the leader must hand Excalibur to one team member who is not the leader. Handing it out is **mandatory** (publisher ruling on BGG, 2013); using it is optional. Team members play their quest cards face down in front of themselves, so it is clear who played what. Before the cards are collected, the holder may order **one other** team member to swap their played card for their unplayed one. The holder then privately looks at the card originally played. Then the leader shuffles and reveals as normal. Net effect: one card is flipped, and the holder learns what that player originally chose. Engine: Excalibur needs a per-seat card mapping until the switch is resolved, and only then the anonymised pile.

House variants and digital behaviours

- **Oberon visibility** [variant, see Roles]: the official default is "Merlin sees Oberon, Lady reads him Evil" (printed script, publisher's 2012 BGG ruling, widely taught as 孤兒牌). The **Dized reading** ("Oberon hidden from Merlin and reads Good to the Lady", from Dized's Oberon page and FAQ) and the common house rule "hidden from Merlin only" are variants. Provide both switches.
- **Assassination card reveal** [edition/convention differences]: printed 2012 rulebook = Evil confer without revealing any card, and the Assassin names the target. Dized = the Assassin reveals their own card, then names. zh-wiki / Chinese groups often = when the Assassin declares the shot, **every Evil card is flipped face up** (one zh-wiki-described form also bans conferring, with "刺殺討論" as a variant that allows it). Offer the "Evil flip all, then confer" convention as a toggle because HK groups may expect it. It mostly helps Evil when Oberon is in play.
- **Plain game for beginners** [common in HK/TW]: start without Percival/Morgana at 6, add them after one game.
- **Fifth team auto-sent** [digital implementations]: after four rejections the fifth team is forced with no vote. Official game votes on the fifth.
- **Quest result shown as Success/Fail only** vs official "show the shuffled cards": some digital versions hide the Fail count. Official shows the count; keep it (it matters for the quest-4 two-Fail rule).
- **Anonymous voting** [rare]: show only tallies. This is harder for Good; not official.
- **Role list hidden** [rare].
- **Assassination etiquette** [common]: Evil may debate freely; Good players and especially Merlin stay silent. Some groups time-box this.
- **Assassin merged with another evil card** [rare]: e.g. the Assassin is also Mordred. Not official; avoid.
- **More than 10 players**: not defined by the rules. Do not support in v1.
- **Naming conventions in zh communities** [common]: Good = 藍方, Evil = 紅方; the Lady is often called 湖中女神 (CN/TW shops) or 湖中仙女 (zh-wiki).

---

## App design notes

**What must stay private**
- Each player's role card and any "loyalty" result.
- Night knowledge (Merlin's evil list, Percival's two names, evil team recognition).
- The vote a player is casting until all votes are locked.
- Each team member's quest card choice, and in the engine, any mapping between a played card and a seat.
- The Lady's private result. The Lady's choice of target and the fact of who holds the token are public.
- The Assassin's target until they confirm.

**What is public by design**: seat order, current leader, Lady holder, team nominations, **every player's vote with name** (after reveal), the vote track, quest board, the count of Fail cards revealed each quest, the final role reveal.

**Narrator needs**
- Phone-reveal mode needs none; each role gets a private info screen. This is the default and removes the eyes-closed ritual entirely.
- Eyes-closed mode (for groups who like the ritual) uses the host phone as narrator with the script above. Pace it with fixed pauses so a longer pause never signals "someone is there". When Percival is absent, still read steps 7–9 with the same pauses so absence does not leak.
- Optional public announcements: "Team proposed: A, B, C", "Votes: …", "Quest 2: one Fail", "X holds the Lady of the Lake", "Evil wins by assassination".

**What can be fully automated**: dealing, validation of role sets, private info screens, vote collection and tally, tie handling, quest-card collection and shuffled reveal, fails-needed rule, leader and Lady rotation, vote track, win checks, assassination resolution, game log (JSONL + CSV).

**Anti-tell concerns**
- Fixed-duration reveal screens for **every** role, including Servants and Oberon (show a "no information" screen of the same length). Randomise the order of names shown to Merlin and Percival.
- Eyes-closed mode: thumb gestures, rustling, tapping, sniffing a held phone, and peeking are the tells. Another reason to default to phone-reveal.
- No distinctive audio or haptics on private screens (Safari on iPhone has no vibrate anyway; keep SFX off during private phases).
- Quest cards: identical screen layout for every team member (two buttons, positions randomised per player if you want to defeat over-the-shoulder reads). Show only how many cards are in, never who has played; apply a minimum decision window so a fast Fail click is not distinguishable.
- Votes: show a count of locks, not who has locked, until reveal.
- Reveal pile: animate cards in random order and discard submission order.
- Peek protection: press-and-hold to view private info with auto-hide; a lock option like the Cheese Thief role-card lock is a good fit.
- Trust model (project memory): the host phone is the authoritative referee and can technically read all roles (the room is P2P with the host as hub, no backend). Reuse the "房主都要玩" toggle: if the host plays, the dashboard hides the role map; if the host is a non-playing moderator, the dealing is provably fair and the dashboard may show everything.

**Host-moderator dashboard**
- Seat ring with leader token, Lady token, and team tokens; quest board with the two-Fail marker; vote track.
- Phase indicator and who is still pending in each secret step (names visible only to a non-playing host).
- Force-advance and reassign controls for AFK players, disconnect recovery, undo for a mis-tapped nomination (before the vote opens).
- Role table (if the host is non-playing), assassination arbiter, full event log, "end game and reveal all".
- Optional timers: discussion per proposal (suggest 2–3 min), assassination deliberation (suggest 2–3 min).

**One shared phone (pass-and-play)**
- Deal and night: "Pass to X → X holds to reveal → X hides → pass on", with the same screen duration for every player. Alternatively run the eyes-closed ritual with the phone reading the script aloud (works with a single device).
- Vote: pass around once for blind tapping (screen blank between players), then show the reveal grid.
- Quest: pass the phone only to team members, each taps Success or Fail on identical screens; the app shuffles and shows the count.
- Lady: pass to the holder, show "Good/Evil" for a few seconds, then hide.
- Assassination: pass to the Assassin, then reveal the result.
- Pass-and-play adds timing tells (who takes longer holding the phone). Cap reveals at a fixed length and keep the pass order fixed.

---

## Sources

Primary rules, printed / publisher (added in verification; these take precedence over Dized where they differ):
- https://avalon.fun/pdfs/rules.pdf (scan of the 2012 Indie Boards & Cards rulebook, 8 pages: components, setup table, base and extended scripts, quest table, two-Fail note, game end and assassination, optional characters, Targeting, Plot/Loyalty cards, Lady of the Lake with its 7+ note)
- https://www.dropbox.com/s/rdpkev7vqspk41n/lancelot.pdf (official Lancelot promo rule sheet, 3 variants; link posted on BGG thread 1775986)
- https://www.dropbox.com/s/3tycg378pkbijek/excalibur.pdf (official Excalibur promo rule sheet)
- BGG thread 864973 "Oberon - Revealed to Merlin?" (reply by publisher Travis Worthington, BGG user "T Worthington", 2012-10-03): https://boardgamegeek.com/thread/864973
- BGG thread 1027610 "Is it optional to deal out Excalibur?" (publisher reply, 2013-08-25): https://boardgamegeek.com/thread/1027610
- BGG community threads used for corroboration: 1067864 (Oberon and Merlin), 1237833 and 953788 (no card reveal before the assassination), 3201182 (Oberon passes the red card to the Lady), 908221 (Lady/Lancelot timing under Targeting), 889311 (Lady start and passing), 894267 (Morgana shows Evil to the Lady; Evil Lancelot night knowledge)
- BGG item data for 128882 / 41114 via api.geekdo.com (year, players, time, player-count poll: best 7–8, 545 votes)

Primary rules (publisher rulebook as rendered by Dized Rules; used for counts, scripts, FAQ rulings; note its Oberon page/FAQ and its Assassin-reveal wording differ from the printed rulebook):
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/faq
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/3blsBDWxT2-DsBsywtDKOg/2-deal-character-cards-and-tokens
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/cU__njMzRvuCCvNEEv1Gcg/extended-setup
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/iIaqJw8dQY6ZKBy_UoCN0Q/3-evil-reveals-itself
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/vssfk7UbQ2yIwe70PLWFFA/4-merlin-looks-into-the-future
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/UYfQ0oxjToy3HJGqh_qPvA/percival
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/kyuq11xwSK64FHOLrK_SQw/oberon
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/eM_VYrNHRji85kL1c7RIpA/mordred
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/27mY948nTV2uSBxJpRGHuQ/morgana
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/wbfNtuNzT0SolAX3IFvcag/lady-of-the-lake
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/GJO8vXM8RvWvzBgagrPsDw/who-starts-with-the-lady-of-the-lake-token
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/2DzqJoIGSZeme6ORrIn_FA/what-are-the-loyalty-cards-for
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/GfYG8nn6T0aixjKTinTXgA/nominating-the-team
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/CHJOFZ5YTo-uqMwKaxtIzw/casting-votes
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/V3eSkuHJSIi-qfEWDXPTAw/result-of-voting
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/UUQVWxChTdmzBFZGf6cjsw/support-or-sabotage
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/_kkXSpYFS2qit8JIEWz-yA/resolve-quest
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/N1CwFhVhT62DAmDo-ukZTw/end-of-round
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/nlZqaq_ERhWsBzx7-lxlwg/targeting
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/ZXYBfRlqRC2sEzECCLLmHA/ending-the-game-and-assassinating-merlin
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/K_MlLyWiS_yuZsA5erj9nA/game-end-and-winning
- https://rules.dized.com/game/rZluqS52QmGdpoVxcmVLtg/wSUXl7DMRYChqUEfD0eXUQ/discussion-and-secret-information

Secondary, English:
- https://www.ultraboardgames.com/avalon/game-rules.php (night script, vote, quest 4 rule)
- https://ultraboardgames.com/avalon/optional-rules.php (Lady of the Lake, targeting, loyalty cards)
- https://www.ultraboardgames.com/avalon/optional-character-cards.php (optional characters; its Oberon reading differs from the script)
- https://www.rulespal.com/resistance-avalon/rulebook (components list, counts; its quest table was garbled and was not used)
- https://hexagamers.com/avalon-setup-by-player-count/ and https://hexagamers.com/avalon-characters-roles-explained/ (recommended role sets; Merlin sees Oberon)
- https://officialgamerules.org/game-rules/the-resistance-avalon/ and https://avalon-game.com/wiki/rules/ (quest table cross-check; note avalon-game.com is a digital implementation with its own Lady timing and forced 5th team)
- https://badlancelot.tumblr.com/rules (UChicago house rules; Oberon, Lady)
- https://en.wikipedia.org/wiki/The_Resistance_(game) (designer, publication years)

Secondary, Traditional Chinese:
- https://andyventure.com/boardgame-avalon/ and https://andyventure.com/boardgame-avalon-expansion/ (role names, Lady 8+, Lancelot, Excalibur)
- https://www.drawnow.com.tw/fun/content/119 (setup table, Lady 7+)
- https://boardgamehot.com/avalon-rule/ (quest 4 rule, Lady after rounds 2–4)
- https://sites.google.com/site/zhuoyouziliaobeiwang/zhuo-you-zi-liao/a-wa-long and https://sites.google.com/site/zhuoyouziliaobeiwang/zhuo-you-zi-liao/a-wa-long/lan-si-luo-te-kuo-chong (recommended sets per count; Oberon hidden from Merlin; Lancelot deck)
- https://zh.wikipedia.org/zh-tw/%E6%8A%B5%E6%8A%97%E7%BB%84%E7%BB%87 (Chinese titles, character names, Lady 8+ note; re-read in verification: per-count role presets with Oberon at 7/10, Mordred at 9/10, Minion at 8, and the Chinese convention that all Evil cards are flipped when the Assassin declares)
- Search-result snippets only (pages not opened): https://www.douban.com/note/523559795/, https://www.jianshu.com/p/9121522e73ba, https://zhuanlan.zhihu.com/p/509998950 (these blocked fetching; they support 孤兒牌 / Merlin knows Oberon).

---

## Open questions for the implementer

- Oberon (resolved): defaults `oberonSeenByMerlin=true` and `oberonReadsGoodToLady=false`. These are official per the printed rulebook and the publisher's ruling. Ship a "Dized reading" preset that flips both, for groups who learned it that way.
- Lady of the Lake player count (resolved): the printed rulebook recommends 7+ (not a hard lock). Default on for N≥7, available at any N.
- Lancelot (resolved): exact rules are now in Common variants (3 official variants). Still open: whether Evil Lancelot raises a thumb for Merlin in variants 1/2 (the sheet is silent; default yes).
- Best player count (resolved): BGG poll says best 7–8.
- Still open: the assassination card-reveal convention (printed = none, Dized = Assassin, zh groups = all Evil). Pick a default with the group; suggested default is printed.

---

## Verification

Adversarial fact-check, 2026-10-03 UTC. Method: re-derived every outcome-relevant rule from sources other than the Dized pages the first draft relied on. Those sources were mainly the scanned 2012 printed rulebook, the official Lancelot and Excalibur promo sheets, publisher posts on BoardGameGeek, BGG item data, and zh-wiki. Each was then compared line by line with the draft.

**Checked and confirmed (no change needed)**
- Good/Evil counts for 5–10 (3/2, 4/2, 4/3, 5/3, 6/3, 6/4) and the derived approval thresholds (strict majority; ties reject).
- Quest team-size table for every N, and the two-Fail rule: only quest 4, only at 7+ players.
- Components: 14 character cards (as listed), 10 quest cards (5+5), 5 team tokens, 20 vote tokens, 5 score markers, round, vote-track and leader markers, 2 loyalty cards, Lady token.
- Base and extended night scripts: who opens eyes (Evil except Oberon), who thumbs for Merlin (Evil except Mordred), Merlin and Morgana thumb for Percival.
- Voting: everyone votes including the leader, votes are revealed with names, leader passes clockwise after each rejection and after each quest, and 5 rejected teams in one round means Evil wins at once. The fifth team is still voted on.
- Quest play: Good must play Success, Evil chooses freely, cards are shuffled before reveal.
- Win conditions: 3 fails, 5 rejections, or 3 successes followed by the assassination.
- Lady of the Lake: starts with the player on the first leader's right; used after quests 2/3/4; may not target anyone who has held it; the examined player takes the token; the holder may say anything but may not show the card; passing the wrong loyalty card loses the game.
- Targeting: quest 5 is locked until two other quests have succeeded, and quest 4 still needs two Fails at 7+.
- Percival with Mordred or Morgana at 5 players; balance effect of each optional character; Morgana and Mordred show Evil to the Lady.

**Changed**
1. **Oberon (outcome-changing default).** The draft called the official text self-contradictory and leaned on Dized's Oberon page/FAQ. In fact the printed script and the publisher's 2012 BGG ruling both say Merlin sees Oberon, and the printed loyalty-card rule makes Oberon show Evil to the Lady. Defaults are now marked official, and the Dized reading is moved to Common variants.
2. **Assassin card reveal.** The draft said as fact that the Assassin reveals their card when acting. The printed rulebook says Evil confer without revealing any character cards; the reveal comes only from Dized's wording. This is now marked as an edition difference, the zh-community "flip all Evil cards" convention is added, and an engine default is set.
3. **Lady of the Lake player count.** The draft said the publisher sets no minimum. The printed rulebook recommends 7+, which is now stated (as a recommendation, not a lock).
4. **Lancelot.** The draft had one 7-card deck and an unresolved start timing. It now gives the official three variants: V1 uses 3+2 cards flipped at the start of rounds 3–5; V2 uses 5+2 cards with 5 dealt face up for rounds 1–5, and Evil Lancelot must Fail; V3 has the Lancelots know each other. Evil Lancelot's night knowledge is now as written on the sheet.
5. **Excalibur.** The draft called it part of the Lancelot set. It is a separate promo. Added: handing it out is mandatory and using it is optional (publisher ruling); the holder learns the originally played card; the engine needs per-seat mapping until the switch.
6. **Best player count.** The draft called it "unverified folklore"; the BGG poll gives best 7–8 (545 votes).
7. **Head-count ratio.** The draft said "5 is the thinnest"; in fact 7 players (4:3) is the tightest for Good.
8. **The Resistance year.** 2010 changed to BGG 2009 (zh-wiki says 2010; both noted).
9. **Setup order.** The draft picked the leader and Lady after the night phase. The printed setup picks the leader before dealing (the leader reads the script), and the Lady goes to the leader's right at that point. Steps renumbered.
10. **Lady timing under Targeting.** Now keyed on the number of quests resolved, not the quest slot.
11. **8-player "std" preset.** The draft's Mordred set is the English-guide choice. The zh-wiki/Chinese standard uses a plain Minion at 8 (Mordred only at 9–10). Both are now listed, with the Chinese one as default for this group.
12. **Small fixes.** Tableau is "3 double-sided tableaus"; the rulebook's "Merlin not required" note now sits next to "always included"; the per-count cap on evil specials at N=5/6 is stated; the Cantonese narrator line 7 is adjusted for games without Morgana; the reading guide now ranks printed/publisher sources above Dized.

**Could not verify / residual doubt**
- Which printing the Dized text mirrors (it may be a later reprint that added the Assassin-reveal wording); no newer printed rulebook was reachable (publisher site blocked).
- Whether Evil Lancelot (variants 1/2) raises a thumb for Merlin: the official sheet is silent.
- Exact prevalence of the 7-player Oberon vs Minion and 8-player Minion vs Mordred presets in HK groups specifically.
