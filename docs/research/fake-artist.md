# A Fake Artist Goes to New York — rules reference

> Paraphrased for engine implementation. Not a copy of the official rulebook.

Evidence base: the official Oink Games English instruction booklet (the first-generation "v1" print with point chips) was read directly, page by page, including the scoring diagram. It was cross-checked against BoardGameGeek rules/variants forum threads (including reports from owners of the newer print), the Oink Japan product pages and retailer pages for the new edition, and Traditional Chinese write-ups (ZZAS, Pixnet, WOB Hong Kong shop listing). Where the sources disagree or the text is ambiguous it is flagged **[AMBIG]** with the reading the engine should default to. Items that are my own design suggestions rather than sourced rules are flagged **[DESIGN]**. Items that are community house rules are flagged **[HOUSE]**.

**The single most important finding for the engine:** the tie rule and the scoring system differ between printings. The v1 English booklet (uploaded to BGG "with permission from Oink Games" in May 2013; goes with the 2012 Japanese and 2014 English/Japanese editions) scores points to 5 and treats a tie for most votes as "fake artist NOT caught". Later booklets say a tie still forces the fake artist to guess: BGG users quote the same English sentence about two players with equal votes from September 2017 (the year BGG lists the first multilingual EN/DE/FR/ES/IT editions), again in 2021 and 2025, and a Japanese review of the current Japanese box says the same. Later copies also come without point chips or scoring (each round is just artists vs. fake artist + question master). Owners in 2021 and 2023 say their chip-less copies were years old, so this is **not** only a 2023 change. The current rule is therefore `must-guess` + no points. The engine must still expose `tieRule` and `scoringMode` as settings (see Voting & resolution and Scoring).

## Identity

| Field | Value |
|---|---|
| EN name | A Fake Artist Goes to New York (often "Fake Artist"). Official digital version is part of "Let's Play! Oink Games" (first released 2021; Switch launch December 2021 after a Kickstarter). Current platforms per Oink: Nintendo Switch, PlayStation 5, Steam, App Store / Google Play (free app, games sold separately), Apple Arcade. Fake Artist is in the base game and supports **3-8 players online or offline**, with no CPU players. |
| JP name | エセ芸術家ニューヨークへ行く (Ese Geijutsuka New York e Iku) |
| Other names | Korean: 가짜 예술가 뉴욕에 가다 (PopcornEdu 2018). Hungarian: Egy imposztor New Yorkban (Gémklub 2025). |
| 繁中 name(s) | **偽藝術家紐約行** (TW blogs ZZAS and Pixnet; both also call the role **偽藝術家**). **冒牌藝術家去紐約** (HK retail listing, WOB). **假畫家** is a common colloquial name for the impostor and the game, but no source checked uses it as an official name. BGG lists an EN/FR/ES/ZH export edition (2018) and WOB says its box has Chinese rules, but the official Chinese title on that box could not be confirmed. 簡體: 伪艺术家纽约行 / 假画家 (**[AMBIG]** unverified). |
| Designer / publisher | Jun Sasaki (佐々木隼; BGG and Wikipedia say "Jun Sasaki"), Oink Games (Japan). Released 2011 (Oink: "制作年 2011"; BGG year 2011). Sasaki's Oink note says it was the first board game he "finished", first played with pen and paper at drinks after game meet-ups (about 2009). Japan Board Game Prize 2012: 8th place (Oink product page). |
| Editions (BGG) | Japanese 2012; English/Japanese 2014; multilingual EN/DE/FR/ES/IT/JP, EN/DE/FR/ES/IT/NL, EN/ES, German, all 2017; EN/FR/ES/ZH export 2018; Korean 2018; Nordic 2022; Hungarian 2025. A US Target-exclusive larger box (about 2019) has a bigger pad and booklet; other components are the same (BGG owners). |
| Player range | Box (Oink EN/JP site, BGG, HK listing, a 2014 JP retailer page): **5-10** (one of whom is the question master). Older listings (TW blogs from 2013, one JP retailer's "新版" listing): **5-11**, which matches the 10 cards of the v1 print. |
| Best count | BGG poll (112 votes, read via the geekdo API 2026-10-03 UTC): **best 6-7, recommended 5-10**. Community signals: works at 4 but "doesn't shine until 5"; at 9-11 players the fake artist gets hard to catch under standard rules (BGG reports at 9 and 11); a TW blog prefers 8 or fewer. **[DESIGN]** treat 6-8 as the sweet spot, 5 as OK (only 4 voters, ties very frequent), 9+ as needing a variant. |
| Duration | About 20 min on the box (several rounds); a single round is about 3-5 min. |
| Weight | Very light: BGG weight 1.09 / 5 (191 votes). Age 8+. |
| Components in the box | v1 print (English booklet p.2): 10 title cards with different coloured backs, 12 coloured pens, 1 whiteboard marker, drawing paper pad, point chips (15 blue "1" and 15 magenta "2"), instruction booklet. Later print (BGG owner reading their own booklet, HK listing WOB, a Japanese review): 9 title tiles, 10 pens, whiteboard marker, 100-sheet pad, no point chips, multilingual booklet. **[AMBIG]** Oink's own JP product page still mentions 10 cards (and 10 pens and a 100-sheet pad); the 9-tile figure is from owners and retailers. The card backs need not match the pen colours (BGG). |
| Physical components the app must replace | (1) **Title cards/tiles + whiteboard marker**: private per-player reveal of "theme + title" or "theme + X". (2) **Coloured pens**: one distinct colour per artist on a shared canvas (or, in paper mode, a "your colour is X" prompt). (3) **Drawing sheet**: shared digital canvas or a physical sheet. The official sheet has fields for theme, title, fake artist's colour and won/lost, so a per-round history record mirrors it. (4) **Different-coloured card backs** that let the QM remember which player holds the X: becomes the QM's dashboard. (5) **Point chips**: scoreboard. (6) **The 3-2-1 simultaneous finger-pointing**: simultaneous in-app vote or host-led countdown. (7) **The question master** (a human who invents the theme and title): either a human host/QM or a word bank. (8) Instruction booklet. |

Chinese terminology used by HK/TW sources (use these in the UI):

| Concept | 繁中 | Notes |
|---|---|---|
| Question Master (QM) | 出題者 | ZZAS also says 說故事的人 (storyteller, by analogy with Dixit). |
| Artist (real) | 藝術家 / 真畫家 / 真正藝術家 | |
| Fake Artist | 假畫家 / 偽藝術家 / 冒牌藝術家 | TW blogs (ZZAS, Pixnet) use 偽藝術家; 假畫家 is the colloquial form and reads most naturally in Cantonese UI. |
| Theme / category | 主題 / 分類 | In the official flow the QM announces the category to everyone, including the fake artist. |
| Title / word | 題目 | The secret thing being drawn (JP お題). |
| Stroke ("mark") | 一筆 | Pen down to pen up. |
| Lap / round of drawing | 一輪 | Each artist draws one stroke per lap; two laps. |
| Point (finger-point vote) | 指認 | |
| Point chips | 分數籌碼 / 得分標記 | |

## Roles

No night phase. Roles are secret card identities plus a table position. Every round has exactly one QM (a human, or the app), exactly one fake artist in the official game, and all other players are real artists.

| id | EN | 繁中 | team | ability (precise) | acts at night? when? |
|---|---|---|---|---|---|
| `question-master` | Question Master | 出題者 | Fake side (scores only when the fake artist wins, v1 scoring) | Chooses the theme and announces it publicly, chooses the secret title, writes it on all but one card (an X on the remaining one), deals the cards, remembers which card/colour carries the X (so the QM knows who the fake artist is, but does not choose who gets it), decides who draws first, runs the 3-2-1 countdown, judges the fake artist's guess. Does NOT draw, does NOT vote, does NOT guess. Rotates every round. | No night. Acts at setup, start-player choice, countdown, guess adjudication. |
| `artist` | Artist (real) | 藝術家 / 真畫家 | Artists | Knows theme and title. Draws one continuous stroke per turn, two laps in total, in a personal colour. Must prove knowledge without making the title obvious. Points at the player believed to be the fake artist. Must not reveal the title to the fake artist. | No night. Draws on own turn; votes at countdown. |
| `fake-artist` | Fake Artist | 假畫家 | Fake side (with the QM) | Knows the theme (it is announced to everyone) but not the title (card shows X). Draws like everyone else (one stroke per turn, two laps), bluffing. Also points at someone at the countdown (the rulebook diagram shows the fake artist voting). If caught, reveals identity and gets exactly one guess at the title. | No night. Draws on own turn; votes; guesses if caught. |
| `fake-artist-2` | Second fake artist (large-group variant, unofficial) | 第二位假畫家 | Fake side | Same as `fake-artist`; neither fake knows the other (this is a design choice; see variants). Needs the two-fake rules in Common variants. | No. |

There is no accomplice role in the official game. A review mention of "accomplice" variants exists but no rules were found.

## Setup by player count

"Total" counts the human QM. "Artists" = players who draw and vote (includes the fake artist). Strokes = artists x 2 laps. Votes cast = artists (each artist votes once, never for self). Max votes a player can receive = artists - 1. Cards needed = artists (1 X card + artists-1 title cards).

**Human QM (official format):**

| Total | QM | Artists | Real | Fake | Cards | Strokes (2 laps) | Votes cast | Status |
|---|---|---|---|---|---|---|---|---|
| 4 | 1 | 3 | 2 | 1 | 3 | 6 | 3 | Unofficial. BGG users say it works but is dull and the fake is exposed easily. |
| 5 | 1 | 4 | 3 | 1 | 4 | 8 | 4 | **Official minimum.** Ties (2-2, 1-1-1-1) are very common, so `tieRule` matters most here. |
| 6 | 1 | 5 | 4 | 1 | 5 | 10 | 5 | Official. |
| 7 | 1 | 6 | 5 | 1 | 6 | 12 | 6 | Official. |
| 8 | 1 | 7 | 6 | 1 | 7 | 14 | 7 | Official. |
| 9 | 1 | 8 | 7 | 1 | 8 | 16 | 8 | Official. BGG reports the fake artist wins too easily. |
| 10 | 1 | 9 | 8 | 1 | 9 | 18 | 9 | Official maximum (later prints: exactly 9 tiles). |
| 11 | 1 | 10 | 9 | 1 | 10 | 20 | 10 | Only in older listings ("5-11": TW blogs, one JP "新版" retailer listing). The v1 print's 10 cards and 12 pens physically allow it; the later 9 tiles do not. |
| 12+ | 1 | 11+ | | 1 or 2 | | | | Unofficial. Use the two-fake variant. A BGG thread discusses 15 players with 2 fakes. |

**App as QM (no human QM; everyone draws), commonly used by online companions and by owners who bought the box for 4 people:**

| Total | Artists | Real | Fake | Strokes | Status |
|---|---|---|---|---|---|
| 3 | 3 | 2 | 1 | 6 | **[DESIGN]** playable only as a joke; fake is nearly always obvious. |
| 4 | 4 | 3 | 1 | 8 | Commonly used (BGG: app lets a 4-person trip group play). Oink's own digital version also goes down to 3 players. |
| 5-9 | 5-9 | 4-8 | 1 | 10-18 | Recommended range. |
| 10 | 10 | 9 | 1 | 20 | Works; consider 2 fakes from 9-10 up. **[DESIGN]** |
| 11-14 | n | n-1 / n-2 | 1 or 2 | 2n | Unofficial; 2 fakes. |

Colours needed: exactly `artists` distinct, colour-blind-safe colours (the physical sets shipped 12 pens in v1 and 10 in later prints; BGG owners complain that similar pinks/greens make 9+ players confusing, so the app should also show a name label or number next to each colour).

## Procedure

Legend: PUBLIC = everyone sees/hears; PRIVATE = only named players. There are no timers in the official rules. Suggested timers are marked **[DESIGN]**.

1. **Pick the first QM.** Players decide among themselves (random pick or volunteer). PUBLIC. Decide scoring mode (points to 5 is the v1 print; later prints have no points) and tie rule (`must-guess` in later prints, `escape` in v1) before the first round.
2. **QM announces the theme (category)** aloud. PUBLIC, including to the fake artist. Examples in the booklet: animals, vehicles, fruits. (A BGG thread confirms the category is meant to be known to the fake artist; a few apps hide it, which makes the game harder than designed.)
3. **QM chooses the title** (a concrete, easy-to-draw item within the theme) and writes it on the back of every title card except one; on that one writes an X. The QM uses as many cards as there are artists. PRIVATE to the QM. The booklet stresses choosing an easy title because the QM only earns points when the fake artist wins.
4. **Deal.** QM shuffles the cards face down and places one in front of each artist (random; the QM does not choose who gets the X). Each artist looks at their own card privately without showing it. Whoever sees X is the fake artist. PRIVATE to each artist. Cards have different back colours so the QM can note which colour got the X: the QM therefore knows who the fake artist is. The fake artist must not react. **[AMBIG]** Some tables let the QM choose the fake artist deliberately; the booklet says shuffle-and-deal, so default to random.
5. **Choose pens.** Each artist takes a distinct colour. PUBLIC. Each stroke's colour identifies its author for the whole round.
6. **QM chooses who draws first.** PUBLIC. Official: the QM decides. Drawing then proceeds clockwise. **[HOUSE]** "player to the left of the QM starts" is common and avoids the QM leaking information by choosing the fake artist first or last.
7. **Drawing, lap 1.** Sequential, one artist at a time. Each makes exactly one stroke on the shared sheet: pen down to pen up, one continuous mark; as soon as the pen lifts the turn passes to the next artist. The fake artist takes a turn like everyone else. PUBLIC (everyone watches the sheet). Artists must not say the title. The fake artist is told to "talk the talk" and act as if informed. **[AMBIG]** Table talk during drawing is not regulated; most groups allow banter and accusations but forbid naming the title or explaining your stroke.
8. **Drawing, lap 2.** Same order, same rule. Total strokes = 2 x artists. After the last stroke the picture is final.
9. **(Optional, not in the rules) Discussion.** The official booklet goes straight to the countdown. Many tables allow a short look/argue window first. **[HOUSE]**
10. **Vote.** The QM counts "3, 2, 1, point!" and all artists (including the fake artist) simultaneously point at the one other artist they believe is the fake. QM does not vote. Simultaneous. PUBLIC the instant it happens. Each artist points at exactly one player and not at self (the rules do not spell out "not self"; the diagram shows only pointing at others).
11. **Resolve** (see Voting & resolution): tally, find the most-pointed player(s), decide whether the fake artist was "caught".
12. **If caught:** the fake artist must reveal their identity (PUBLIC) and gets exactly **one** spoken guess at the title. The QM judges it. Only now is the title revealed. If **not caught:** the fake artist does not have to reveal or guess; the official diagram gives no points for it. **[AMBIG]** one unverified review summary says the fake may still guess for fun with no extra points. The identity and title are normally revealed at round end anyway.
13. **Score** (see Scoring). Title is written on the sheet and everyone enjoys the masterpiece (the booklet recommends naming the artwork on the sheet).
14. **Next round.** The player to the left of the current QM becomes QM. Repeat from step 2. In v1 scoring the game ends as soon as someone has 5 or more points.

## Night order

n/a. There is no night. The only "waking" is the fake artist's guess after being caught, and nobody closes eyes at any time. Anti-tell issues therefore concern private screens at the deal, not night noises (see App design notes).

## Voting & resolution

**Ballot.** One ballot per artist (fake artist included). Target = any other artist. The QM is not a candidate and does not vote. Ballots are simultaneous.

**Tally.** `counts[p]` = number of ballots naming p. Let `max = max(counts)` and `top = { p : counts[p] == max }`. Because every artist votes, `sum(counts) = artists`, so `max >= 1`.

**Deciding "caught"** (the fake artist is `F`):

| `tieRule` | Source | Caught when | Notes |
|---|---|---|---|
| `escape` | **v1 English booklet** (2013 BGG upload; scoring diagram on p.7: "not caught" = not pointed at the most, OR received the same number of votes as other artists) | `top == {F}` (F is the unique most-pointed player) | Any tie at the top, even one containing F, counts as NOT caught. Strongly favours the fake side, especially with 4 voters. Matches the TW blogs written from that era (ZZAS: not caught "包含平手"; Pixnet: a tie counts as not caught). |
| `must-guess` | **Later official booklets** (in the current box; probably since the 2017 multilingual prints, since the first BGG quote is from 2017-09). Owners quote an English line saying that even when two players have equal votes the fake must guess, and only once (BGG, 2017-09, 2021-01, 2025-01). A 2023 owner says a tie with at least one real artist means F is caught. A Japanese review of the current JP box says F must answer even when several players share the most votes. Wikipedia's summary agrees: F wins outright only if a non-fake gets the most votes. | `F in top` (counts[F] == max) | **Default for the app: this is the current official rule.** **[AMBIG]** The official wording ("two people", "the same number as a real artist") does not literally say "tied *at the top*". Read literally, it could make F guess whenever any two players tie, or whenever F matches any artist's count. BGG readers reject both readings as unintended. Implement as `counts[F] == max`. If F's count equals a lower-ranked real artist's count (neither at the top), F is not caught. |
| `revote` | **[HOUSE]** (BGG) | If `top == {F}` caught; if `F in top` and `size(top) > 1` run a second ballot where only artists NOT in `top` vote, and only for members of `top`; resolve the new unique winner; if there are no eligible voters or it ties again fall back to `must-guess`. If `F not in top` F is not caught. | |
| `all-reveal` | **[HOUSE]** (ONUW style, BGG) | Every player in `top` reveals their card; if F is among them F is caught (must guess); otherwise F wins outright. | Equivalent to `must-guess` in outcome. |

**If `top` does not contain F:** the fake artist is not caught under every `tieRule`, even if F received several votes (only a strictly lower count than the leader matters).

**Guess phase (only if caught).** F states one title. The QM (or host) rules correct/incorrect. There is no second attempt. Synonym/near-miss judging is up to the QM (see Edge cases). Outcome = `guess-correct` or `guess-wrong`.

**Round result:**

| Condition | Result |
|---|---|
| F not caught | Fake side wins (F and QM). |
| F caught, guess correct | Fake side wins (F and QM) — the "reversal". |
| F caught, guess wrong | Artists win. |

**Chain/simultaneous effects:** none. There is no elimination and no night resolution. The only ordering that matters: ballots lock -> reveal tally -> (if caught) reveal F -> guess -> reveal title -> score.

## Scoring & win conditions

**Mode `points-v1` (v1 print, "first to 5").** Exact points per round:

| Outcome | Fake artist | Question master | Each real artist |
|---|---|---|---|
| F not caught (incl. ties under `escape`) | +2 | +2 | 0 |
| F caught, guess correct | +2 | +2 | 0 |
| F caught, guess wrong | 0 | 0 | +1 |

- "Each real artist" means **all** real artists, every one of them (BGG: answered "All artists", consistent with the rulebook wording "only the artists earn 1 point each"). It does not depend on how an artist voted. The fake artist gets 0 in this branch. Do not confuse with the **[HOUSE]** variant where only artists who pointed at F score. **[AMBIG]** The v1 role summary on p.3 says an artist "can earn points if they guess the identity of the fake artist", which some readers take to support that house rule. The p.7 scoring chart, which settles outcomes, awards every artist. Default: all real artists.
- The fake artist and the QM always receive identical points in any given round (both 2 or both 0). Artists get at most 1 and only in the artists-win outcome.
- No negative points and no other bonuses. The QM never loses points.
- **Game end:** the first player to reach **5 points** wins, checked when a round is scored. Scores can overshoot (4 + 2 = 6 is legal). The booklet gives no other end condition (a BGG reply simply cites "first to 5"; a how-to page adds "or whenever you decide", which is informal).
- **[AMBIG] Simultaneous crossing.** Not covered. This will happen often because F and QM score together and all artists score together. **[DESIGN]** default: highest total wins; if still tied, co-winners (or play one more round). Document the choice to players.
- QM rotation: after each round the player to the left of the QM becomes QM. A player's points are the same pool whether they scored as QM, fake or artist. The official rules do not address the case where the game ends mid-rotation (some players have been QM more often than others). **[DESIGN]** optionally prefer a fixed-length game (see variants) for fairness.

**Mode `none-v2` (later prints, per BGG owner reports and a Japanese review of the current JP box that describes no point system).** A 2021 BGG owner says their rules only state who wins, and mentions that "a previous version" awarded points. A 2023 owner says the newest printing has no point chips, and two replies say their copies, bought years earlier, never had chips either. The exact first chip-less print is **[AMBIG]**; the 2017 multilingual editions are the likely change point. Each round is independent: either **artists win** (F caught and guess wrong) or **fake artist + QM win** (F not caught, or caught but guesses correctly). Nothing to total; the table decides when to stop. Many groups in the BGG threads ignore points even with the v1 print.

**Scoring variants seen in the wild [HOUSE]:**
- One poster: F caught and guesses right earns only F 1 point (QM nothing); F caught and wrong gives each artist 1; F not caught gives F and QM 1 each. Aim: stop the QM choosing giveaway titles.
- Another: F not caught gives F and QM 1 each, plus a bonus point for F if F then guesses the title.
- Dixit-style: QM scores 0 (the poster even suggested -1) if the vote is unanimous and F still cannot guess, or if nobody voted for F.
- Only artists who actually pointed at F score when the artists win (and some tables let real artists who received votes score nothing).

## Edge cases an engine must handle

Roles and setup
- Reject a human-QM round with fewer than 5 total players (fewer than 4 artists) unless `allowUnofficialCounts` is on.
- The number of cards (title copies + X) always equals the number of artists; exactly one X. Dealing is uniform random; the QM never chooses who gets X unless `qmPicksFake` is on.
- QM never draws, never votes, never guesses, never receives the X.
- The fake artist counts as an artist for turn order, for ballots (casts one) and for receiving votes.
- A human QM knows the fake artist's identity (official). In app-QM mode nobody knows except the app/host.
- The fake artist must be shown the theme but never the title; the title must never be sent to the fake artist's client before the guess is locked.
- If the theme text itself leaks the title (for example theme "Lion" with title "Lion"), reject at word-bank/QM entry.
- All artists must acknowledge their private reveal before drawing starts; block start until all have acknowledged.

Drawing
- Exactly `2 x artists` strokes: lap 1 then lap 2 in the same order, so no artist ever draws twice in a row.
- One stroke = one contiguous pen-down to pen-up. A second contact in the same turn is ignored or ends the turn. Multi-touch ignored.
- A turn timeout (if enabled) forfeits that stroke but advances the turn; the stroke slot is consumed (do not give the player a second chance). A forfeit by the fake artist is not evidence by itself.
- Zero-length taps: **[DESIGN]** accept a dot as a stroke only if it has a minimum visible length/duration, otherwise ask the player to retry.
- The colour of each stroke is public and fixed per player for the round; two players never share a colour.
- Undo is not in the rules. If supported, restrict to the stroke owner before the next player starts.

Vote and tie
- Self-vote impossible; QM not selectable; one ballot each; ballots locked at submit; reveal only when all have locked (or after a host-forced timeout, defaulting missing ballots to "abstain" and flagging it).
- "Unanimous" for F means every ballot except F's own names F (F cannot vote for self), so F's maximum is `artists - 1`: F is caught.
- `top` contains only real artists: F not caught (every `tieRule`). Example: counts A=2, B=2, F=1.
- `escape`: counts F=2, A=2 -> NOT caught; counts F=3, A=1 -> caught.
- `must-guess`: counts F=2, A=2 -> caught; counts F=1, A=1, B=1, C=1 with 4 artists (a cycle) -> everyone tied at the top, F in top -> caught.
- With 4 artists (5 players) the only possible vote shapes are 3-1, 2-2, 2-1-1 and 1-1-1-1. **4-0 is impossible** because nobody can vote for themselves, so the most anyone can get is 3. Test every assignment of those shapes to F and to the real artists. (The v1 booklet's own example, with 4 artists, is F=2, two artists 1 each, one artist 0: caught under every `tieRule`.)
- F's count equals a non-top artist's count (for example F=1, A=1, B=2): not caught.
- `revote`: if all non-top players do not exist (everyone tied) fall back; if the revote ties again fall back to `must-guess`.
- Pointing at a player who then proves to be the QM is impossible by construction.

Guess
- Exactly one guess, no retry. The guess must be locked before the title is displayed anywhere.
- The QM decides correctness; the engine must allow overrides because of synonyms, Cantonese vs Mandarin vs Japanese words, singular/plural, and specificity (guessing "cat" for title "lion": wrong; guessing "雪糕" for title "冰淇淋": QM judgement). Store an alias list per word-bank entry in app-QM mode; allow host override.
- If F is not caught, no guess phase is required (an optional "for fun" guess awards nothing).
- If F disconnects or abstains in the guess phase, record the guess as wrong after a timeout, with a host override.

Scoring and end
- Outcome table exactness: not caught -> F+2, QM+2; caught+correct -> F+2, QM+2, artists 0; caught+wrong -> each real artist +1, F 0, QM 0.
- F and QM are always equal in a round; the fake artist and QM are different players, so one player never gets two awards.
- Reaching 5 mid-scoring ends the game after the round is fully scored; two or more players over 5 in the same round follow the tie-break setting.
- Scores never decrease. A player who leaves keeps their total on the scoreboard but is skipped for QM rotation.
- `none-v2` mode: no scores; end of game only when the host stops it.

Rotation and lifecycle
- Next QM = next player in the seating order after the current QM; if that player is absent, skip. Seating order is a lobby setting (phones have no physical seating), so the engine needs a seat order list.
- If the QM disconnects before the deal, reassign the QM to the next in order and restart the round. If a real artist disconnects mid-drawing, their remaining strokes are forfeited or the round is voided by host choice (a picture with a missing contributor skews the vote). If F disconnects, void the round.
- Player count change between rounds below the minimum pauses the game.
- Round history must record: theme, title, fake artist, strokes (replayable), ballots, caught/escaped, guess, result, points awarded.
- All timestamps stored in UTC.

Joke/degenerate rounds that the engine may support as settings
- No fake artist (all cards have the title) or everyone is a fake artist (all X): the normal win condition is not defined; these are for fun (see variants).

## Common variants

Official / semi-official
- **v1 scoring** (points to 5) vs **v2 no points** (see Scoring). The ZZAS Taiwan blog describes the points game and a small-group alternative where everyone is QM once and highest score wins (popular in TW write-ups; **[AMBIG]** unverified in HK practice).
- **App/online as question master:** a computer picks a drawable word and category and hands them out so everyone can draw and nobody sits out. Many fan apps do this (BGG: fake-artist.herokuapp.com, johannes1509 word generator, nraw/fake_artist_companion). Some omit the category, which is harder than designed. Likely the most useful mode for travelling friends with only phones.
- **Digital edition:** "Let's Play! Oink Games" includes the game in its base package on Switch, PS5, Steam, App Store/Google Play and Apple Arcade, with online and offline play for 3-8 players and no CPU players.

Typical app / online adaptations (what other people have built)
- **Role-and-word dealer + separate drawing surface:** each player opens their own page and sees "fake" or the word; drawing happens elsewhere (a Zoom whiteboard with a different colour per player plus private chat for the deal works, per BGG). This is the simplest pattern.
- **Shared digital canvas with per-player colours:** the sketch is a live canvas on every phone, strokes turn-gated (BGG: Vue + Express + Socket.io project by jteraoka; a Heroku companion planned a collaborative canvas).
- **App as question master:** no human QM, so everyone draws and the QM's points disappear. The app picks a theme and an easy-to-draw title (word lists taken from drawing games work well; one BGG user warned that random hard words skew the game towards the artists because the fake cannot guess them).
- **Single shared phone:** an Apple Shortcuts companion passes one phone around with voice narration to deal the roles (the BGG thread documents the "first player is asked to choose" tell and its fix).
- **Official digital edition:** "Let's Play! Oink Games" runs it online with friends or strangers, or offline, for 3-8 players.
- **Takedown precedent:** the jteraoka "Fake Artist Online" web app (Vue/Express/Socket.io) stopped being hosted after its author was contacted by Oink Games, and its README says the author complied with Oink's requests. See App design notes on naming and branding.

Table size
- **Two fake artists** for very large groups, **[HOUSE]**, from a BGG reply to someone planning a 15-player game (the app suggests it from 12): each artist gets two votes; if both fakes are exposed they guess simultaneously; sample scoring: both exposed and both fail -> artists 2 each; both exposed and both guess right -> fakes 1 each, QM 2; both exposed and one guesses right -> artists 1 each, successful fake 1, QM 1; one exposed and fails -> artists 1 each, hidden fake 1, QM 1; neither exposed -> fakes 1 each, QM 2. The poster leaves out "one exposed and guesses right". **[DESIGN]** score that like "neither exposed" (fakes 1 each, QM 2). **[DESIGN]** define "exposed" as being among the two most-voted players (ties exposed).
- **Draw once but two strokes** per turn for 9+ players: speeds the game and exposes the fake. **[HOUSE]**
- **Length cap per stroke:** about 5 cm / 2 inches, or about 10-15 seconds, with "lifting the pen ends your turn". **[HOUSE]** Stops show-offs and keeps the sketch ambiguous.
- **No separate clue drawings:** all marks must contribute to the picture (some groups ban symbols such as writing numbers to hint). The official rules allow a mix of one object or several; the group chooses. **[HOUSE]**

Tie handling: the current official rule is `must-guess`; `escape` is the older v1 English ruling (keep it as an option for groups using a v1 box). **[HOUSE]**: revote among the tied (BGG 2015 and 2016); ONUW-style reveal of everyone tied (BGG 2016); allow table talk to change votes (BGG 2016).

Reduced-player or humour variants **[HOUSE]**
- **Two words in 4-5 players:** two artists get title A, the third gets a related title B, nobody knows if they are the odd one out. Works at 4 and 5.
- **"Artistic differences":** no fake artist; half the players get one word, half another from the same category; players win only if they all declare artistic differences.
- **Everyone is fake** (all cards X) or **no fake** (all cards have the title): comic rounds; a suggested win rule is that the table wins only if everyone points at themselves (for all-fake) or at nobody (for no-fake).
- **Strategic start player:** QM picks who starts to help or throw off the fake. Others prefer fixed "left of QM".
- **Discussion window** before the 3-2-1 vote, with or without a time limit; a BGG reply says the Oink digital edition sets no time limit on pre-vote discussion by default.
- **Endless rounds / "stop whenever"** instead of first to 5.

## App design notes

**What must stay private**
- The **title** (QM and real artists only) and the **fake artist's identity** (the fake artist, and the human QM; in app-QM mode only the host process).
- **Ballots** until everyone has locked (simultaneous reveal removes bandwagoning; official play uses a 3-2-1 reveal).
- The title must not be spoken by the host phone's TTS or shown on any shared screen until after the guess is locked.
- The host phone is the authoritative referee and necessarily holds the title and the fake artist's id in memory. **Best fit:** let the human QM be the host phone, since the official QM already knows both facts; this removes the host-can-peek trade-off for this game. If the host is also an artist, accept the same trade-off as other games on the hub (the person can inspect the state), or use app-QM with the host outside the artist set only if desired.

**Naming and IP**
- Oink Games sells its own digital version and has asked at least one fan web app to stop hosting (jteraoka, see Common variants). The name, logo, box art and rulebook text carry more risk than the general draw-and-vote mechanic (not legal advice). **[DESIGN]** In the hub, list the game under a generic name (for example "假畫家" / "Fake Artist"-style party drawing), use our own word bank and art, and link to Oink's product page instead of using its branding.

**Needs a narrator?** No. It is a day game with open eyes. Optional host-only Cantonese audio is a nice-to-have, never required. Suggested lines (**[DESIGN]**, Cantonese): "主題係：動物" (public theme), "輪到紅色畫一筆" (turn prompts), "三、二、一，指！" (vote countdown), "假畫家係……" (reveal), "你有一次機會估題目" (guess prompt), "答案係……" (title reveal after the guess). The narrator must never speak the title before the guess.

**What can be fully automated on phones**
- Word bank (theme + title + alias list, in Traditional Chinese; include Japan-travel flavoured themes), random deal, colour assignment, enforcing one stroke per turn (pointer-down starts, pointer-up ends, input locked for everyone else), turn order and laps, simultaneous ballots, tally and `tieRule`, scoring in either mode, QM rotation, game-end detection, per-round history, canvas export as an image for the keepsake aspect.
- Needs a human or an override: judging the fake artist's guess (synonyms, dialect words); creative theme/title (unless the word bank is used).

**Anti-tell concerns (most important)**
- Make the private reveal screen visually and temporally identical for the fake artist and for real artists: same layout, same font sizes, same hold-to-reveal duration, same auto-hide timer, same haptic and sound behaviour. The fake artist's screen shows the theme and a placeholder where the title would be (an "X"), for the same duration.
- Require all artists to tap "I have seen it" and show a common "waiting" screen to everyone, so the time anyone takes does not reveal who is who.
- Do not make the first artist choose or confirm a word. A BGG user's Apple Shortcuts companion originally asked the first player to pick from a list; the second player could then infer that player 1 was the fake artist if player 1 was never asked. Choose the word before the deal or by the app.
- If the QM chooses the start player, that leaks a little information (picking the fake artist first or last). Offer `startPlayer: qm | left-of-qm | random`, default random or left-of-QM for app-QM.
- Hide ballot targets until reveal, and show only a lock indicator ("3/5 voted") with no names, not who voted.
- Shoulder-surfing: partial screen brightness, an auto-hide timer, and an option to require holding a finger to reveal.
- Sound/haptics: no per-role vibration or chime.

**Shared canvas (multi-phone)**
- Host owns turn state. Each artist's phone draws only during its turn; the stroke is streamed as normalized points (0..1 in canvas coordinates, fixed aspect ratio) and replayed on all other phones; late joiners/reconnects receive the full stroke list. The host validates that the sender is the current drawer.
- iOS Safari: use pointer events with `touch-action: none` on the canvas to stop scrolling, ignore multi-touch, and consider palm rejection. Version floor (MDN browser-compat-data): Pointer Events and `touch-action: none` need **iOS Safari 13+**. `PointerEvent.getCoalescedEvents()` exists only in **Safari / iOS Safari 18.2+**, so feature-detect it and fall back to plain `pointermove` samples on older iPhones.
- Each artist has a fixed colour plus a name chip/number for accessibility. Show whose turn it is in large text, and a stroke counter (for example "5/12").
- Optional: a short per-stroke timer (**[DESIGN]** 15 s), configurable or off.
- **Paper mode:** the phones only deal roles, show "now: Ann (red)" prompts and the lap counter, run the vote and scoring. Players draw on a physical sheet with their own pens (or a single paper pad, which fits the "travelling without cards" case).

**Host/QM dashboard**
- QM-private panel: theme, title, fake artist's name/colour, turn tracker, who has locked a ballot (count only until reveal), tally after reveal, guess judge buttons (correct/incorrect/override), scoreboard, next QM, settings: scoring mode (`points-v1` / `none-v2`), target points (default 5), `tieRule` (`escape` / `must-guess` default / `revote` / `all-reveal`), `qmKnowsFake`, theme visible to fake (default yes), number of fakes (1 default, 2 at 12+), start-player mode, strokes per lap, stroke timer, discussion window, word bank/language. Provide a "void round" button.

**Voting UI**
- The in-app vote works well with the table in one room: tap a player chip, lock, wait, simultaneous reveal after a host-led (or narrated) 3-2-1. Alternative "physical pointing" mode: the QM reads off the fingers and enters the tally; this keeps the original ritual but loses the audit trail.

**Single shared phone (pass-and-play)**
- App-QM is the default (the phone cannot show a QM the fake's identity privately without a passcode).
- Deal: pass the phone around; each player presses and holds to see their private card (theme + title, or theme + X), then it auto-hides before passing on. Use a neutral "pass to next player" interstitial so the phone-owner's screen time does not leak.
- Drawing: the phone itself is the canvas; hand it clockwise, each player draws one stroke with a finger, laps counted by the app. This fits the official design well.
- Vote: physical 3-2-1 pointing with one person tapping the tally, or sequential secret ballots (hide after each pick; cannot be truly simultaneous). The guess is spoken; the owner of the phone taps correct/incorrect and then the title is revealed.
- Scoring and rotation: the app tracks it; there is no QM so `points-v1` is adapted: **[DESIGN]** fake wins -> fake +2 (no QM share); artists win -> each real artist +1; or simply use `none-v2`.

**Suggested state machine** **[DESIGN]**: `lobby -> choose-qm -> theme-title -> deal(ack all) -> draw[2*artists] -> (discussion) -> vote(lock all) -> reveal-tally -> (caught? guess : skip) -> reveal-title -> score -> (game-over? summary : rotate-qm -> theme-title)`.

## Sources

Primary and rules
- Oink Games English instruction booklet, v1 print (pages 1-8 read as images): https://cdn.1j1ju.com/medias/c0/75/df-a-fake-artist-goes-to-new-york-rulebook.pdf (same text mirrored at https://tesera.ru/images/items/744225/rule_fakeartist_e.pdf; BGG file "English rules from Oink Games", fileid 104980)
- Oink Games product page (EN): https://oinkgames.com/en/games/analog/a-fake-artist-goes-to-new-york/
- Oink Games product page (JP): https://oinkgames.com/ja/games/analog/a-fake-artist-goes-to-new-york/
- Oink designer note: https://note.com/oinkgames/n/nb67a5089c1cc and https://studio.oinkgms.com/post/13296903550
- Wikipedia: https://en.wikipedia.org/wiki/A_Fake_Artist_Goes_to_New_York
- BGG game page (HTML blocked; metadata from api.geekdo.com): https://boardgamegeek.com/boardgame/135779/a-fake-artist-goes-to-new-york

BGG rules/variants/general threads (used for ties, scoring clarification, newer-print changes, variants, apps)
- Ties: https://boardgamegeek.com/thread/1411836 , https://boardgamegeek.com/thread/1853073
- Scoring and artist points: https://boardgamegeek.com/thread/2794457 , https://boardgamegeek.com/thread/2654887 , https://boardgamegeek.com/thread/1388124 , https://boardgamegeek.com/thread/2738290
- Newer print drops points / component counts: https://boardgamegeek.com/thread/3177431 , https://boardgamegeek.com/thread/3055329
- QM knowledge and dealing: https://boardgamegeek.com/thread/1348167 , https://boardgamegeek.com/thread/1488808
- What a "mark" is, house rules, single vs several pictures: https://boardgamegeek.com/thread/1387941 , https://boardgamegeek.com/thread/1541615 , https://boardgamegeek.com/thread/2933186 , https://boardgamegeek.com/thread/1830365
- Table talk, discussion: https://boardgamegeek.com/thread/1353382 , https://boardgamegeek.com/thread/3323477
- Player counts and variants: https://boardgamegeek.com/thread/2903511 , https://boardgamegeek.com/thread/1460936 , https://boardgamegeek.com/thread/3278937 , https://boardgamegeek.com/thread/1779047 , https://boardgamegeek.com/thread/2033824 , https://boardgamegeek.com/thread/2658907 , https://boardgamegeek.com/thread/2616205 , https://boardgamegeek.com/thread/1728116 , https://boardgamegeek.com/thread/1389731
- Apps and online play: https://boardgamegeek.com/thread/1422814 , https://boardgamegeek.com/thread/1659555 , https://boardgamegeek.com/thread/2429160 , https://boardgamegeek.com/thread/3405975 , https://boardgamegeek.com/thread/3548358

Reviews and how-to pages
- Mischief Makers facilipedia: https://www.mischiefmakers.co/facilipedia/fake-artist-in-new-york
- Shut Up & Sit Down: https://www.shutupandsitdown.com/games/a-fake-artist-goes-to-new-york/
- What's Eric Playing: https://whatsericplaying.com/2017/08/14/a-fake-artist-goes-to-new-york/
- I Slay the Dragon review: https://islaythedragon.com/featured/review-a-fake-artist-goes-to-new-york/
- The Corner Ferndale: https://www.thecornerferndale.com/about-us/blog/board-game-spotlight-how-to-play-fake-artist-goes-to-new-york_ae13.html
- Icebreakers write-up: https://icebreakers.ws/small-group/fake-artist.html
- Virtual gaming guide: https://hanwendong1.github.io/VirtualGaming/content/5-Fake-Artist.html
- Online companion repo: https://github.com/jteraoka/fake-artist-online (README: no longer hosted after contact from Oink Games)

Added during verification (2026-10-03 UTC)
- BGG metadata, poll and weight via the geekdo JSON API: https://api.geekdo.com/api/geekitems?objectid=135779&objecttype=thing , https://api.geekdo.com/api/dynamicinfo?objectid=135779&objecttype=thing ; edition list: BGG versions for 135779 (Japanese 2012 through Hungarian 2025); file list (English rules upload 2013-05-22)
- Further BGG threads (read via https://api.geekdo.com/api/articles?threadid=N): 2331713 (pens vs card colours), 2253183 and 2487978 (Target larger box), 2355542 (German edition has no component text), 2864070 (browser version), 1617855 (final picture)
- Oink digital page: https://oinkgames.com/en/games/digital/lets-play-oink-games
- MDN browser-compat-data (PointerEvent, getCoalescedEvents, touch-action): https://github.com/mdn/browser-compat-data

Japanese
- Hoobby rules summary and info page: https://bodoge.hoobby.net/games/fake-artists-go-to-new-york/instructions/5576 , https://bodoge.hoobby.net/games/fake-artists-go-to-new-york
- Boardgame blog review (describes the current JP box: 9 cards, 10 pens, no points, and a tie at the top still forces the fake to answer): https://boardgame-blog.com/afakeartist-goes-to-newyork/
- Retailer page (2014 Japanese edition, 5-10 players, designer 佐々木 隼, JP/DE/EN/FR booklet): https://suppe.sugorokuya.jp/items/140054
- 新版 retailer text (lists 5-11 players and says points are handed out by the vote; edition date unclear): https://banesto.nagoya/shopdetail/000000004819/

Traditional Chinese
- ZZAS Taiwan: https://zzaslai.blogspot.com/2013/06/blog-post.html
- Pixnet 童教桌遊研究院: https://mj9981168.pixnet.net/blog/post/175523700
- WOB 桌遊天地 (Hong Kong): https://wobgames.net/shop/fake-artist-goes-new-york/

## Verification

Adversarial fact-check done 2026-10-03 UTC. Web search was unavailable (budget used up), so checks used direct fetches: the v1 English booklet PDF read page by page, Oink EN/JP product pages and the Oink digital page, English Wikipedia, BGG data through the geekdo JSON API (item metadata, player-count poll, weight, edition list, file list, and the full text of about 30 rules, general and variant threads, several of them not cited before), the WOB HK listing, the ZZAS and Pixnet TW blogs, a Japanese review and two Japanese retailer pages, Oink's note article, the jteraoka repo README (GitHub API), and MDN browser-compat-data.

Confirmed unchanged against the v1 booklet: roles (QM picks the category and announces it to all artists, writes one X and the title on the other cards, uses as many cards as artists, shuffles and deals, remembers the colour of the X card, does not draw or vote); artists pick pens; the QM picks who goes first; play goes clockwise for two laps of one mark each; 3-2-1 countdown, after which the artists (including the fake, as the p.6 diagram shows) point; the fake reveals and gets exactly one guess only if pointed at the most; scoring (not caught or right guess: fake and QM +2 each; wrong guess: every real artist +1); next QM is the player to the left; first to 5 wins; v1 components (10 cards, 12 pens, 15+15 chips, marker, pad). Also confirmed: 5-10 players, 20 min, 8+, released 2011, designer Jun Sasaki, Japan Board Game Prize 2012 8th place, first finished game from about 2009. All variant and house-rule summaries were re-read in their source threads and are accurate (two fakes, two strokes at 9+, 2-inch cap, Dixit-style, scoring variant 2738290, two-words, artistic differences, all-fake/no-fake, revote, ONUW reveal), as are the app/companion claims (herokuapp/meteor, nraw, johannes1509, Apple Shortcuts tell and fix, no time limit on discussion in the digital version).

Changed:
- **Tie-rule history (outcome-critical).** The `must-guess` wording is not just a "newest print" owner report. BGG users quote it from September 2017 (the year of the first multilingual editions), and again in 2021 and 2025. A Japanese review of the current JP box and Wikipedia's summary agree. It is the current official rule; `escape` is the older v1 English ruling. The intro, the `must-guess` row and Common variants were updated, and the literal-wording ambiguity is documented. The default stays `must-guess`.
- **Points removal timeline.** Chip-less, points-free copies predate 2023: a 2021 owner had win/lose-only rules, and 2023 replies mention copies from years earlier. Marked **[AMBIG]**, with the likely change point at the 2017 editions.
- **Vote partition error.** With 4 artists, "4-0" is impossible because nobody can self-vote, so the maximum is 3. Valid shapes are 3-1, 2-2, 2-1-1 and 1-1-1-1. "Unanimous for F" now means all ballots except F's own.
- **Best count gap filled.** BGG poll: best 6-7, recommended 5-10 (112 votes). Weight 1.09/5.
- **Digital edition.** Added Apple Arcade, App Store/Google Play as a free app with games sold separately, the 2021 release (Switch December 2021), Fake Artist in the base game, 3-8 players online and offline, and no CPU. PS5 was confirmed on Oink's page.
- **Chinese names.** Removed the unsupported claim that 假畫家 is the role name in both HK and TW write-ups (ZZAS and Pixnet use 偽藝術家). The "平手" attribution was corrected to the TW blogs only, not HK. Simplified names are marked unverified.
- **Components.** Pen count corrected from "9-12" to 12 (v1) and 10 (later). Noted that Oink's JP page still says 10 cards, against the 9 tiles owners report. Added the Target larger-box note and the edition list, and noted that card backs need not match pen colours.
- **Designer romanisation.** Dropped "Shun Sasaki": the cited retailer page shows only the kanji 佐々木 隼. Added the kanji.
- **5-11 player-count sources** reworded (TW blogs and one JP 新版 listing; the 2014 JP retailer page says 5-10).
- **Scoring nuance.** Added **[AMBIG]**: the v1 p.3 role box links artist points to identifying the fake, but the p.7 chart (authoritative) pays every artist. The Dixit variant now includes the poster's -1 option.
- **Two-fake variant.** Source is a 15-player plan, and the "one exposed and guesses right" case was missing; filled as **[DESIGN]**.
- **iOS platform versions.** Pointer Events and `touch-action: none` need iOS Safari 13+. `getCoalescedEvents()` needs Safari/iOS 18.2+, so it must be feature-detected.
- **Added an IP note.** The jteraoka fan web app stopped hosting after Oink Games contacted its author, so the hub should use a generic name and its own assets.

Not independently verifiable with the tools available: the exact Chinese title printed on the 2018 EN/FR/ES/ZH box; the print or year in which point chips were dropped; the Japanese 2011/2012 original tie wording (the earliest text available is the 2013 English translation); BGG pages behind the 403 (thread HTML), which were read through the API instead.
