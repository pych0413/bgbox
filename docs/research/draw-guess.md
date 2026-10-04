# Draw & Guess (你畫我猜) — rules reference

> Paraphrased for engine implementation. Not a copy of the official rulebook.

Evidence base and confidence. **Primary:** three publisher instruction sheets read directly: the classic Milton Bradley (Hasbro) "Rules for Pictionary" sheet (rules text ©1993 Pictionary Inc., item 4531-X1), the Mattel Pictionary All Play Square sheet (BJM16-0920, ©2013) and the Mattel Pictionary Man To Go sheet (R6637-0920, ©2009). The classic and 2013 sheets differ on card categories, the opening word, 3-player play and the winning rule; both are recorded below. **Secondary (rules summaries, retail-site guides):** Pictionary rule write-ups, Wikipedia (Pictionary, Draw Something, Catch Mind), skribbl.io's own start page (settings ranges only), several skribbl.io / Gartic / Drawize guides, and Traditional/Simplified Chinese write-ups (madestudio.com.tw, heyhafun.com, TapTap, a Taiwanese app-news site). **Not obtainable:** skribbl.io's, Gartic.io's and Drawize's exact point formulas and hint timers are not published; the web guides only say "faster guess = more points". The few concrete formulas found come from open-source clones and are used here only as data points. Everything under "RECOMMENDED" is our own design, not a copy of any product. Items tagged **[unverified]** could not be confirmed from any readable page (most came from a search-engine summary whose page could not be opened).

## Identity

| Field | Value |
|---|---|
| EN name | Pictionary (the physical original). App mode id: `draw-guess`. Digital relatives: skribbl.io, Gartic.io, Drawize, Draw Something, Catch Mind (KR). |
| 繁中 name(s) | **你畫我猜** — the generic name in HK, TW and CN for the Pictionary format and for phone apps. Simplified: 你画我猜. Draw Something has no confirmed official Chinese title; Chinese Wikipedia lists 你畫我猜 as its common CN/TW rendering and **猜猜畫畫** as the HK rendering, so 猜猜畫畫 is a fine HK alias in the lobby. Spoken Cantonese says 估 for "guess", so HK UI strings should read 估中 / 估唔中 (TW/CN: 猜中). **Do not confuse with** 比手畫腳 / 你比我猜 (charades, acting, no drawing; HK also calls it 有口難言 or 大電視, the latter from the TV show 獎門人), 你講我猜 / 你說我猜 (describe-and-guess), 你講我畫 (one person describes, the rest draw), 畫畫接龍 / 畫圖接龍 (relay chain, i.e. Telestrations and Gartic Phone). |
| Designer / publisher | Pictionary: Robert Angel (concept 1981), graphic design Gary Everson; first published 1985 by Angel Games; licensed to Western Publishing 1986; Hasbro took over Western's games division 1994; the classic rules sheet of the 1990s was printed by Milton Bradley (Hasbro) under ©1993 Pictionary Inc.; current publisher Mattel (the 2013 sheet says the trademark is owned by Pictionary Incorporated; the 2009 To Go sheet says Pictionary Incorporated and Mattel, Inc.). Draw Something: OMGPOP (launched February 2012; Zynga bought OMGPOP in March 2012; delisted December 2022). Gartic.io (2017) and Gartic Phone (December 2020): Onrizon Social Games. skribbl.io, Drawize: independent web games. |
| Player range | Pictionary classic sheet (1993): 3+ players; with exactly 3, two teams are formed and one person is the permanent Picturist for both teams; teams may be uneven; above 16 players add a fifth team or enlarge teams. Mattel 2013 sheet: 2 to 4 equal teams, ages 8+. Man To Go: 2 teams, ages 14+. Draw Something: 2. skribbl.io custom rooms: 2 to 20. Drawize private rooms: 2 to 100 (FAQ suggests its Teams mode for big groups). Gartic Phone: 4+ per one rules site (not confirmed elsewhere). **Our app: free-for-all (FFA) 3 to 12; team variant 4 to 12 (2 to 4 teams, 2+ players each).** |
| Best count | FFA 5 to 8 (a skribbl guide recommends 6 to 10). Team variant 6 to 10. Both the classic and the 2013 Pictionary sheets say play is quicker and more exciting with fewer teams and more players per team, so prefer 2 teams of 3 to 5 over three or four small teams. |
| Duration | Pictionary board game: not stated on any of the three sheets (a game runs until a team reaches Finish and wins the final word). Our FFA default: 7 to 12 turns (9 at 3 players), about 1.5 to 2 min each, so about 12 to 21 min. |
| Weight | Very light (zero rules to teach beyond "no letters, no talking"). Skill is drawing speed and shared references, which is why Chinese idioms and local culture matter (see App design notes). |
| Physical components the app must replace | Word cards (classic cards hold five words each, coded O Object, P Person/Place/Animal, A Action, D Difficult, AP All Play, and any word marked with a triangle is also played as All Play; in the 2013 Mattel deck the fifth, red category is Miscellaneous and All Play is a board square instead), category cards and board squares, the 1-minute timer, the die and board track (team progress), drawing pad plus pencils (or erasable boards), score keeping, and the human "how strict is a correct answer" judgement (all three sheets tell groups to agree strictness before play). The app additionally replaces the online games' chat box, guess checker, hint display and word picker. Card art and the printed word lists are copyrighted; ship our own word bank. |

### Reference games compared (research summary)

| Aspect | Pictionary (board; classic 1993 sheet and Mattel 2013 sheet) | Pictionary Man To Go (Mattel) | Casual 你畫我猜 (HK/TW/CN groups) | skribbl.io | Gartic.io / Drawize | Draw Something |
|---|---|---|---|---|---|---|
| Who guesses | Drawer's own team shouts; All Play (classic: triangle-marked words and the opening word; 2013: All Play squares): all teams at once, first correct wins control of the die | Own team, then turn passes | 2 to 4 teams of 3 to 6 guessing their own drawer; another TW write-up has all groups race and the first to raise a hand with the right answer scores; or each person vs the room | Everyone types in chat | Everyone types in chat | The one partner, asynchronous |
| Word choice | Card word fixed by board colour; classic gives the Picturist 5 s to study the word before the timer; 2013 Wild square: Picturist picks any category and must announce it before sketching | Card colour = category, read aloud | Random card, or drawer picks | Drawer picks 1 of up to 5 (3 is the commonly cited default; defaults are set server-side, not in the page); custom lists | Gartic: reportedly 2 offered, and the drawer may skip the turn (fan guide); Drawize: 3 offered (secondary) | Drawer picks 1 of 3 worth 1, 2 or 3 stars/coins; a drawer's bomb re-deals the three words |
| Round time | 60 s sand timer | 60 s | One 60 s round per team, then the next team (madestudio; it suggests 90 s for online play); 30 s to 1 min per word (heyhafun); 1 to 2 min (TapTap) | Setting 15 to 240 s; 80 s is the commonly cited default | Adjustable | No limit |
| Hints | Category only | Category only | Host may call the length or category; some apps show underscores (字數) | Underscores at start; letters revealed progressively (setting 0 to 5 hints; first reveal around the halfway mark per secondary sources); modes Normal / Hidden / Combination | Letters shown progressively (secondary) | Letter tiles incl. decoys; "bomb" removes wrong tiles |
| Correct guess | Team scores/advances; strictness agreed in advance | 1 point if solved; solved or not, play then passes to the other team; first to 15 | 1 point per word; skipping scores 0 and costs nothing | Guesser earns more the earlier; drawer earns per correct guesser; many guides say harder words pay more [likely conflated with Draw Something stars] | Same shape (time-based; drawer paid per correct guesser) | Coins by word tier |
| Close guesses | n/a (aloud) | n/a | Judged by the table | A "close" notice is shown (client string "$ is close!"); open-source clones use edit distance 1 and keep the near-miss text private | Not documented | n/a (tiles) |
| Fouls | No letters, numbers, dashes for length, "sounds like" ears, speaking, sign language (classic also: no pre-arranged secret clues; an X only to cross out or mark a spot, never as a letter); homophone drawings ("mail" for "male", "dock" for "doc") and syllable splitting are allowed | Same, but symbols (? !) are allowed and the Picturist may also act out the answer with the plastic figure and its prop | Agree beforehand: numbers for character count? arrows/symbols? 諧音 puns? | No spelling the word; room owner can kick/ban, plus a player votekick (vote count shown; threshold is server-side and unpublished) | Same | n/a |
| Game end | Classic 1993: the first team on Finish that then guesses a word wins, even if it is another team's All Play word. Mattel 2013: reach the final All Play square (no exact roll needed), then, while holding the die, be first to solve the next All Play; winning another team's All Play only hands you the die | First to 15 | Organiser's choice: fixed number of rounds or a 20 to 30 min time box, highest score wins (neither TW source names a target score) | 2 to 10 rounds (everyone draws once per round); top total wins | Rounds / target score | Streaks, no end |

Other facts worth keeping: an anniversary-edition "challenge die" (draw with eyes closed or off-hand) is often mentioned **[unverified: not in any of the three sheets read]**; the classic game opens with an All Play word for all teams, while the 2013 edition opens on a yellow (Object) word for the team with the highest die roll; Catch Mind (캐치마인드, Netmarble, KR PC game) runs 20 rounds in team or solo mode and both drawer and guesser earn points; skribbl.io also lets guessers like or dislike each drawing; Gartic Phone is a different format (write, draw, describe chain) and is covered under variants.

## Roles

There are no secret roles. "Roles" are turn roles that rotate. Both guess modes and both drawing modes use the same ids.

| id | EN | 繁中 | team | ability (precise) | acts at night? when? |
|---|---|---|---|---|---|
| `drawer` | Drawer (Picturist, Pictionary's own term) | 畫家 / 畫手 / 畫畫嗰個 | the room (FFA) or own team | Sees the secret word. Chooses 1 of 3 offered words (one re-roll). Draws for the whole turn on the phone canvas or on paper. Must not speak, mouth words, gesture, write letters/numbers/Chinese characters, draw word-length dashes or "sounds-like" ear symbols. In shout mode is the **judge**: taps who guessed correctly. In typed mode may tap "accept" on a guess the auto-checker rejected. May abandon the turn. | No night. Acts only in their own turn. |
| `guesser` | Guesser | 猜題者 / 估嘅人 | the room (FFA) or the drawer's own team | Sees the length mask and time-released hints (never the word). Shout mode: calls guesses aloud, unlimited. Typed mode: submits text guesses (rate-limited). Once correct, becomes a silent witness for the rest of the turn. | No night. |
| `judge` | Judge (role, not a person) | 裁判 | n/a | Decides whether a guess is correct. Shout mode: the drawer. Typed mode: the engine (auto-check), with the drawer's accept as an override. Fouls and disputes: the host phone. | No night. |
| `host-referee` | Host / referee | 主持 / 裁判機 | n/a | The host phone runs the engine. Dashboard: pause, +30 s, skip turn, void turn, rule on disputes. Does not see the word unless host is the drawer, or uses a logged "referee peek" (then is ineligible to score that turn). | No night. |
| `rival` | Opposing-team player (team variant) | 對手隊員 | other team | May not guess in someone else's turn (typed input hidden, shouting is a table rule). May raise a foul flag. | No night. |
| `all-play-drawer` | All Play drawer (team variant) | 搶答畫家 | own team | In an All Play turn every team's drawer receives the same word at once and draws on a canvas private to their team. | No night. |
| `spectator` | Spectator | 旁觀者 | none | Sees public view and drawing; cannot guess or draw. Late joiners and seatless devices. | No night. |

## Setup by player count

Common to every count: one word bank (tiers 1/2/3 = easy/medium/hard); the turn queue is seat order starting from a random seat, repeated for the chosen number of cycles, so **every player draws exactly the same number of times**. Eligible guessers per turn = N minus 1 (the drawer).

**RECOMMENDED defaults (FFA).** Cycles: 3 for 3 players, 2 for 4 to 6 players, 1 for 7 to 12 players (target 7 to 12 turns). Round seconds: shout 80, typed 100 (iPhone Chinese input costs time). Tiers: each turn offers one easy, one medium, one hard word. Hints on.

| Players | FFA cycles | Total turns | Est. minutes | Team split options (team variant) | Draws per team (fixed rounds) | Status |
|---|---|---|---|---|---|---|
| 2 | not offered | n/a | n/a | n/a | n/a | Draw Something is a 2-player game; the app's minimum is 3 (the engine would still run with 1 guesser) |
| 3 | 3 | 9 | 16 | not supported (teams need 4+) | n/a | Commonly used online (skribbl-style); also official in classic Pictionary, but only as two one-person teams with a permanent Picturist (not adopted) |
| 4 | 2 | 8 | 14 | 2v2 | 4 | Smallest count with two real teams (classic rules also allow 3, see above); FFA commonly used |
| 5 | 2 | 10 | 18 | 3v2 | 5 | Commonly used; the classic sheet allows uneven teams (the 2013 sheet asks for equal teams) |
| 6 | 2 | 12 | 21 | 3v3, or 2v2v2 | 5 (3v3) / 4 (2v2v2) | Official team counts; best zone for FFA |
| 7 | 1 | 7 | 12 | 4v3 | 5 | Commonly used |
| 8 | 1 | 8 | 14 | 4v4, or 2v2v2v2 | 5 (2 teams) / 3 (4 teams) | Official team counts; FFA best zone |
| 9 | 1 | 9 | 16 | 3v3v3, or 5v4 | 4 (3 teams) / 5 (2 teams) | Commonly used |
| 10 | 1 | 10 | 18 | 5v5, or 4v3v3 | 5 / 4 | Commonly used; teams are the better format from here |
| 11 | 1 | 11 | 19 | 6v5, or 4v4v3 | 5 / 4 | Commonly used |
| 12 | 1 | 12 | 21 | 6v6, 4v4v4, or 3v3v3v3 | 5 / 4 / 3 | Commonly used; app maximum |

Draws per team (team variant) follow one rule: 2 teams draw 5 times each (4 when each team has only 2 players), 3 teams draw 4 times each, 4 teams draw 3 times each, giving 8 to 12 turns (8 only for 2v2). Rotation inside a team may be uneven by one draw (e.g. 3v3 with 5 draws); that is accepted because team scores are shared.

**RECOMMENDED defaults (team variant).** Round seconds: shout 60 (Pictionary's one minute), typed 80. Team assignment: alternate by seat order (A, B, A, B, ...) so opponents sit between teammates; the host can shuffle or edit. Scoring: 1 point per solved word (optional: star value 1/2/3). Length: fixed rounds (table above), then sudden death on a tie. Optional: All Play turn every 4th turn; an All Play is an extra turn inserted into the queue, it does not use up any team's draw count, so all teams still draw equally.

Config fields for the shell (`config.fields`): `teamMode` (ffa/teams), `guessMode` (shout/typed), `drawMode` (canvas/paper), `roundSeconds` (30 to 180 step 10), `cycles` (1 to 5), `rounds` per team (team), `tiers` (which of easy/medium/hard to offer, default all), `categories` filter, `hints` (bool), `strictness` (strict/standard/loose, typed only), `starsAsPoints` (team), `allPlayEvery` (0/3/4), `targetScore` (team race mode, optional).

House-rule chips shown on the lobby and in the rules sheet (display only, not enforceable by the app): allowed by default = arrows and motion lines, splitting a word into picture-syllables, 諧音 (homophone) puns, drawing something merely related to the word, pointing at one's own paper drawing; forbidden = letters, numbers, Chinese characters, kana, Latin or Chinese "blank boxes" for length, speaking/mouthing/sound effects, gestures or acting, "ear" symbols for sounds-like. Pictionary's official sheets state the forbidden list and explicitly allow homophone drawings (classic: "mail" for "male"; 2009/2013: "dock" for "doc") and the two Mattel sheets also allow syllable-splitting; no sheet bans arrows, Man To Go explicitly allows symbols such as ? and !, and the classic sheet allows an X only to cross out or mark a place; the Taiwanese casual guide lists numbers, arrows and 諧音 as the three things to agree on first.

## Procedure

Legend: PUBLIC = on every phone; PRIVATE = only the named seat. Times in seconds are defaults.

**0. Lobby and config (host).** Pick guess mode, draw mode, FFA or teams, time, cycles, categories. Seat order should match the real table (SeatEditor). PUBLIC: config summary and house-rule chips. Teams: auto-deal alternating by seat.

**1. Setup (engine).** Build the turn queue: random start seat, `cycles` passes through seat order (team variant: round-robin over teams, rotating the drawer within each team; all teams draw the same number of times). Zero all scores. Create the word offer pool per tier from the bag, minus words used earlier this evening. Seed the RNG used for word offers and hint positions. PUBLIC: queue preview ("1. Amy 2. Ben ...").

**2. Turn loop.** Repeat for every entry in the queue:

2.1 **Intro (3 s, PUBLIC).** "Drawer: X." Paper mode: the drawer takes a fresh sheet and a pencil. Canvas mode: the canvas clears (`inkEpoch` bump).

2.2 **Word choice (12 s, PRIVATE to the drawer, other phones show "X is choosing").** Drawer sees 3 cards: one tier 1 (1 star), one tier 2 (2 stars), one tier 3 (3 stars), each with category and word length. Actions: pick one, or re-roll once (burns all three for this game, deals three new). On timeout the engine auto-picks the tier 2 card. Only the picked word is marked used in the persistent bag; the unpicked words are excluded for the rest of this game but return to the bag for later evenings.

2.3 **Drawing and guessing (T seconds, deadline set at the moment of the pick).**
- PRIVATE to the drawer: the word (tap-to-peek chip that auto-hides after about 2 s, so people across the table cannot read it), the accepted aliases (so the judge in shout mode knows which synonyms count), canvas tools (canvas mode), the live guess feed (typed mode) with an accept button per guess, the guesser grid (shout mode), an abandon button.
- PUBLIC to everyone else: countdown, mask (one box per character), category chip and revealed characters per the hint clock, who has already guessed correctly (names only), and in canvas mode the live drawing.
- Hint clock (fractions of the turn's total time elapsed): 0%: length mask; 25%: category chip; 50%: reveal one character (words of 2+ characters); 75%: reveal a second character (words of 4+ characters only, `maxReveals = min(2, floor(L / 2))`; rules in "App design notes" and Edge cases).
- **Shout mode:** guessers call out answers freely, all at once. The drawer listens and taps the player who said a correct answer (alias lists and strictness are the drawer's call). The first accept starts a 3 s **grace window** in which the drawer may add co-winners who shouted the answer essentially simultaneously and may undo a mis-tap; when the window closes the turn ends. If the deadline passes while a grace window is open, the window still runs to its end. If the deadline passes with no accept, a 2 s **buzzer window** stays open for a late tap (a shout at the buzzer); accepts in it score with r = 0 and can be undone until it closes. (Rationale: a correct answer shouted aloud tells the whole room the word, so a second scoring guesser is not meaningful.)
- **Typed mode:** each guesser types in a text box; guesses are simultaneous. The engine adjudicates every guess (Voting & resolution A). Wrong guesses appear in a public feed; near-misses show only a "so close" badge without text; correct guesses show "X got it" without the word. A player who is correct is locked out of typing and stays silent about the word. The turn ends early when every connected eligible guesser is correct.
- Both: any non-drawer can raise a foul flag (Voting & resolution D). Host can pause, add 30 s, or void the turn.

2.4 **End of turn (instant).** Triggers: deadline reached (shout mode: only once any open grace or buzzer window has closed); typed mode all guessed; shout mode grace window closed; drawer abandons; host skips/voids. The engine computes points (Scoring), applies a foul penalty if upheld, writes the turn into history.

2.5 **Reveal (7 s, PUBLIC, host can skip).** Show the word and its accepted aliases, the final drawing (canvas mode), who scored what, and score deltas. Short reaction row (laugh, like) for fun. Both modes: foul flags are still honoured during the first 5 s. Typed mode only: in those 5 s the drawer may still accept guesses that were submitted before the deadline.

**3. Between cycles (5 s, PUBLIC).** Show the leaderboard.

**4. Game end.** After the last queue entry: final leaderboard, tie-break (Scoring), highlights (best average drawer score, fastest guesser, most 3-star words solved), hand `result` to the room scoreboard. Offer replay, change mode, or end session.

**Team variant differences.** Turn = one team's drawer (word choice as above). Only that team's guessers may guess (typed input hidden for rivals; shouting by rivals is against the table rules). Success: the drawer taps "we got it" (shout) or any teammate's typed guess is correct; the turn ends immediately, the team scores (shout mode: the same 2 s buzzer window covers a tap right at the deadline). Failure: time runs out, no score, no penalty (Pictionary: no points, turn passes). Every Nth turn (optional) is an **All Play**: all teams' drawers get the same single word (tier 2) simultaneously on private team canvases or private paper; first team to solve scores 2; time out scores nothing. (In Pictionary the All Play winner simply takes control of the die; the 2 points are our stand-in for that.)

## Night order

n/a. There is no night phase and no hidden-role waking. The only time-ordered mechanism is the per-turn hint clock (0% length mask, 25% category, 50% first reveal, 75% second reveal for words of 4+ characters) described above, plus the 3 s grace window and 2 s buzzer window in shout mode.

## Voting & resolution

There is no vote that decides the winner. Resolution is the adjudication of guesses, simultaneous accepts, fouls and tie-breaks.

### A. Typed-guess adjudication (engine, per submitted guess)

Preconditions: phase is `play`; sender is an eligible guesser who has not yet scored this turn and is not the drawer; the message is not empty after trimming; length is at most 30 code points; sender passes the rate limit (at least 700 ms since their last guess; more than 6 guesses in 10 s locks input for 5 s); identical text already submitted by that player this turn is ignored silently. Otherwise respond `reject` and do not count it.

1. `g = norm(text)`: Unicode NFKC, lower-case, remove all whitespace (incl. U+3000), remove all punctuation and symbols, then fold Traditional characters to Simplified using a fixed one-to-one table (applied identically to guess and answers; exclude characters whose Simplified form is ambiguous, e.g. 麵/面, 後/后, 乾/干/幹, 髮/發; list those words' variants explicitly in `alt`).
2. Answer set `A` = normalised primary word plus every entry of `alt` (regional terms, synonyms, Latin/kana aliases, e.g. 雪糕 / 冰淇淋 / 冰激凌 / ice cream).
3. Build candidates: `g` and `strip(g)`, where `strip` removes at most one leading filler from [係咪, 係唔係, 是不是, 我估, 我猜, 估, 猜, 係, 是] and at most one trailing filler from [呀, 啊, 嗎, 吗, 呢, 喇, 啦, 囉, 咯, 咩, 嘅] (only if something non-empty remains). Stripping can only add matches.
4. If any candidate is in `A`: **correct**. (Do not tokenise: a message listing several answers never matches.)
5. Else compute **close** against each `a` in `A` (stop at first hit): length of `a` is L. (i) L >= 3 and edit distance exactly 1; (ii) L = 2, guess is the answer reversed (a same-position match does not count, see the decision below); (iii) L >= 3, character-multiset overlap at least 60% of L and length within one of L (scrambled order); (iv) guess contains `a`, or `a` contains guess with guess length >= 2, and they are not equal; (v) guess is in the entry's optional `near` list (related answer, e.g. 獅子 for 老虎) which yields the softer message "right direction" instead of "so close". A hit under (i), (ii), (iii) or the "`a` contains guess" half of (iv) counts only if the guess shares at least one character with `a` that the hint mask has **not** revealed yet; a guess that contains the whole of `a` is always close (it must never become public text).
6. Else **wrong**.

**User decision 2026-10-04 (D9, from the multi-agent playtest, finding draw-guess #2).** The original rule (ii) also made a 2-character guess close when it shared one character in the same position. In play that did two things the hint design above argues against. Before the reveal it handed out half the word: 恐龍 was 好接近 for 魚龍 14 s before 龍 was revealed. After the reveal it was noise: with 筆 public, about 15 guesses of the form X筆 were each 好接近, and they steered the table into pen types for 50 s. So: for 2-character words there is no 好接近 from a same-position match before a hint has revealed that position, and a match on a position the hint has already revealed tells nobody anything new, so it does not count either (that second half applies to every length: the engine passes the revealed characters to the checker). The reversed answer, the `near` list and every rule for longer words keep working. A guess that loses its close mark this way is shown in the public feed like any wrong guess: marked wrong, it tells the table nothing about which of its characters are in the word.

Outcomes: correct -> record `{pid, t = host receipt time}`; close -> private "so close" to the guesser, a text-less "X is close" badge to others, full text to the drawer; wrong -> public feed. The strictness setting changes step 4 and 5: `strict` skips the Traditional/Simplified fold and the filler stripping (only NFKC, case, whitespace and punctuation normalisation) and matches the primary word and `alt` exactly; `standard` is as written; `loose` additionally turns a **close (iv)** hit (contains/contained) into correct, but only when the guess is at most L + 2 characters long; without that cap a message listing several answers would match through "contains" and defeat step 4. In every setting the drawer can accept any guess at its original timestamp.

### B. Shout-mode accept resolution

1. Only the drawer may accept; target must be an eligible guesser who has not scored; ignore accepts that arrive more than 2 s after the deadline; an accept up to 2 s late (buzzer window, only if no accept happened before the deadline) is scored with remaining time clamped to 0.
2. First accept records `t1` and opens a 3 s grace window. Further accepts inside the window are co-winners and **all take the same `r` as the first** (so a simultaneous shout is a true tie, not an order dispute). The drawer may undo any accept inside the window.
3. When the grace window closes the turn ends, even if that is after the deadline (the deadline does not cut an open grace window short). With no accept by the deadline, the 2 s buzzer window applies: every accept in it scores r = 0, each may be undone until it closes, and the turn ends when it closes. Accepts outside these windows are ignored.

### C. Simultaneity and ordering

All events are timestamped with host receipt time. Equal timestamps keep arrival order. After every action and timer tick the engine tests end conditions in this order: (1) abandon/void, (2) deadline (typed mode: immediately; shout mode: only when no grace or buzzer window is open, and with no accept yet it opens the 2 s buzzer window instead of ending), (3) typed all-guessed, (4) shout grace or buzzer window closed. Hint reveals are a function of elapsed time only, never of guesses.

### D. Foul resolution (any mode)

Any eligible guesser may flag the drawer during play or the 5 s reveal. Threshold = at least 2 flags and at least half of eligible guessers (N=3: both guessers; N=8: 4 of 7). Players who already solved the word count (they know the word, so they judge best). When the threshold is met the foul is **upheld**: guessers keep their points, the drawer's points for that turn become 0, and the reveal shows "foul". Flags beyond the threshold are ignored. Team variant: one rival flag pauses the clock and sends the host a ruling prompt (foul upheld = the turn scores nothing for the drawing team; rejected = resume).

### E. Final ranking and ties

Rank by total points. Tie-break 1: more correct guesses; tie-break 2: more points earned as drawer; still tied: share the rank. Team variant: higher team points wins; a tie after the fixed rounds goes to sudden death among the tied teams only (one All Play word; if nobody solves, a new word, at most 3 words in total, then a shared win).

## Scoring & win conditions

### RECOMMENDED FFA scoring (works identically in shout and typed mode)

Definitions: `T` = total turn time in ms (after any +30 s extensions), `acceptedAt` = timestamp of the correct guess/accept (host clock), `r = clamp((deadline - acceptedAt) / T, 0, 1)`. Tier multiplier `m` = 1.0 (easy), 1.5 (medium), 2.0 (hard).

- **Guesser:** `G = round(m * (10 + 20 * r))` (`Math.round`, half up). Easy 10 to 30, medium 15 to 45, hard 20 to 60. Always at least 10 x m, so a late solve still beats nothing; strictly ordered by time, so earlier always means more. Wrong guesses cost nothing.
- **Drawer:** let `k` be the number of correct guessers and `E = N - 1` the eligible guessers. If `k = 0`: `D = 0`. Otherwise `D = round(mean(G_i) * (0.5 + 0.5 * k / E))`. The drawer is paid the average guesser score, scaled from 50% (a lone solver in a big room) up to 100% (everyone solved). Fast, wide solving is what pays; a lone solver in shout mode (k = 1) gives the drawer about 55 to 75% of that solver's points.
- **Foul upheld:** `D = 0`.
- **Abandon:** everyone 0 for that turn; the word is spent (marked used) and the drawer's turn counts. **Void** (host, or drawer disconnect): everyone 0; the word goes back to the bag unused and the drawer is re-queued once at the end (Edge cases).

Worked examples (T = 80 s, rounded half up):

| Case | Numbers | Result |
|---|---|---|
| Easy, solved with 60 s left | r = 0.75 | G = 25 |
| Easy, solved with 20 s left | r = 0.25 | G = 15 |
| Easy, accepted 1 s after the buzzer | r = 0 | G = 10 |
| Hard, solved with 60 s left | r = 0.75, m = 2 | G = 50 |
| Typed, easy, N = 6 (E = 5), three solvers at r = 0.9, 0.6, 0.2 | G = 28, 22, 14; mean 21.33; factor 0.5 + 0.5 x 0.6 = 0.8 | D = 17 |
| Typed, easy, N = 4 (E = 3), all three solve at r = 0.8, 0.7, 0.5 | G = 26, 24, 20; mean 23.33; factor 1.0 | D = 23 |
| Shout, medium, N = 6, accepted at r = 0.5 | G = round(1.5 x 20) = 30; factor 0.5 + 0.5 x 1/5 = 0.6 | D = 18 |

Balance check (expected values, every player draws c times and is eligible to guess in c x (N - 1) turns): **shout mode** has one solver per turn, so a player's expected guessing income is about c x G in total, while drawing earns about c x 0.55 to 0.75 G; drawing is therefore roughly 35 to 43% of a typical total. One drawing turn is worth far more than one guessing turn (whose expected value is only G / E), but each player gets the same number of drawing turns, so it stays fair. **Typed mode** with everyone solving pays the drawer the mean G, which is only 1 / N of the turn's total points. Either way drawing is not a points farm, and a weak artist loses at most that share.

**Why time and not order:** order-based scoring (1st 100%, 2nd 80%, ...) needs a stable "who was first" signal, which in shout mode depends on the drawer's tap order and in typed mode on network latency. Time-based scoring is monotone in both, degrades gracefully with a few hundred ms of latency (80 s horizon, 20 pts of spread: 0.25 pt per second), and is what the web games describe. Order is implicit because later guesses always have smaller r.

### How the game ends (FFA)

After the final queue entry the highest total wins; ties by Voting & resolution E. Optional house variant: stop early when a player passes a target score (default off). Evening score hint for `result.points`: winners (all tied winners) get 1 evening point.

### RECOMMENDED team variant scoring (Pictionary-style)

- Success within time: the drawing team scores 1 point (or the tier star value 1/2/3 when `starsAsPoints` is on: the drawer is gambling on difficulty). Failure: 0, no penalty; the turn passes to the next team in order.
- All Play turn: first team to solve scores 2 flat. Solve times within 300 ms of each other (host receipt time) are a tie and both teams score. Nobody solves: nobody scores.
- Fixed rounds (default): every team draws the same number of times (table in Setup). Highest team total wins; tie goes to sudden death. Optional race mode: first team to `targetScore` (suggest 10; Mattel's To Go edition uses 15) wins, but the check happens only when all teams have had equal turns, to remove first-mover advantage; an immediate-win toggle is the Pictionary-like variant.
- Individual stats are tracked (who drew, who solved) but do not score in team mode.

## Edge cases an engine must handle

Word bank and offers
- Re-roll allowed exactly once per turn; a second re-roll is rejected; all six shown words are excluded for the rest of the game.
- If a tier pool is empty or below filter, borrow from the nearest tier; if the whole filtered pool is exhausted, reset the bag and tell the host.
- Choice timeout auto-picks tier 2; if the drawer's device is offline, the auto-pick still happens and the host may void the turn.
- A word containing Latin letters or digits is allowed in the bank only if drawable; the mask counts each non-space code point as one box.
- Length-1 words (e.g. 貓) have no character reveal; only the category chip applies. `maxReveals = min(2, floor(L / 2))` where L is the mask length.
- Words with spaces or hyphens show the gap in the mask; gaps are never revealed as hints.

Timing and clock
- Pause freezes the deadline and the hint clock (elapsed time is derived from `T - (deadline - now)`); +30 s extends both deadline and `T`, so `r` keeps its meaning and an already shown hint is never hidden.
- Deadline reached with no accepts: typed mode ends the turn at once; shout mode ends it when the 2 s buzzer window closes with no accept; everyone 0, reveal the word.
- Shout accept arriving up to 2 s late is valid with r = 0 (buzzer window, only when nobody was accepted before the deadline); later is ignored. An accept made before the deadline still lets its 3 s grace window run past the deadline.
- Typed guess arriving after the deadline (host clock) is ignored; a drawer accept during the 5 s reveal is valid only for a guess whose own timestamp was before the deadline, and scores with that guess's time.
- Two accepts or guesses at the same millisecond keep arrival order; shout co-winners in the grace window share the first accept's r.

Disconnects and joins
- Drawer disconnects during choice or play (all their devices offline for more than 15 s): void the turn (0 points), return the word to the bag unused, re-queue that drawer once at the end of the final cycle; if they never return, drop it.
- Guesser disconnects: stays eligible but is excluded from the typed all-guessed check after 10 s offline; keeps points; rejoin restores their view, the current mask, and `inkSync`.
- A player who leaves forever: remaining queue entries for that player are skipped; their score stays on the board.
- No new seats mid-game; newcomers are spectators until the next game.
- Drawer reconnecting mid-turn must receive the word again from engine state (not from the device).

Typed mode
- Empty or whitespace-only guesses ignored without counting; over-length guesses rejected; duplicates silently dropped.
- Several answers in one message do not match (no tokenising); a long sentence containing the answer is only accepted through filler stripping or the drawer's accept.
- Traditional/Simplified input both accepted via the fold; ambiguous-fold characters rely on `alt`.
- Full-width digits/letters and mixed case normalised by NFKC and lower-casing.
- A guess matching an alias of the word is correct; a guess equal to a related-but-different word is wrong (and may trigger `near`).
- Winners cannot type again this turn; their reactions are emoji only; nothing they send reaches unsolved players as text.
- The drawer cannot guess; the host-referee who used "referee peek" cannot guess or score that turn.
- IME composition: Enter pressed while `isComposing` must not submit a guess.
- Rate limit: 700 ms between guesses; more than 6 in 10 s locks the input 5 s; at most 60 guesses per player per turn.
- Close detection thresholds are length-relative so short words do not hide every wrong guess (edit distance 1 on a 2-character answer is far too loose; hence rule (ii), which since the 2026-10-04 decision is only the reversed answer).
- A close hit must share at least one character that the hint mask has not revealed yet; otherwise it says nothing new and is wrong (2026-10-04 decision, Voting & resolution A).

Shout mode
- Drawer cannot accept themselves; cannot accept a player twice; cannot accept before the first card is picked.
- Undo only inside the grace (or buzzer) window; after it closes the result is final unless the host voids.
- If the drawer never taps by the end of the buzzer window, nobody scores even if the room clearly solved it (the host may void: the word returns to the bag and the drawer is re-queued with a new word at the end).
- Two players shout the answer at once: the drawer may add the second as co-winner within the window.

Drawing and fairness
- Canvas mode: only the drawer may ink; ink from anyone else is dropped by the host; accidental one-point taps are discarded; clear/undo/erase are allowed; there is no text tool and no fill tool. Zero ink for 25 s: warn the host, never auto-void.
- Foul threshold uses eligible guessers at turn start; flags from the drawer or non-participants are ignored; a foul upheld mid-turn does not stop the turn, only zeroes D.
- Abandon: allowed any time during play; 0 for everyone; the word is spent; the drawer's turn counts.
- Host picks "void turn" for a technical failure: no scoring, word returned to bag, the drawer is re-queued once at the end.

Scoring and end
- `k = 0` gives D = 0; `E = 0` cannot occur at N >= 3 unless everyone else left; then D = 0.
- Rounding: always `Math.round` on the final value; tie-break counters (correct guesses, drawer points) are plain integers.
- A game with zero solved turns still ends normally with all zeros and shared first place.
- Team variant: a team that loses all members forfeits its turns; if only one team remains the game ends and that team wins; teams of uneven size draw the same number of times (members rotate more often in the small team).
- All Play: the single word is drawn with the team's canvas private; first solve wins; ties inside 300 ms score both.
- Sudden death repeats at most 3 words, then shared win.

Privacy and views
- Views are whitelist-built. A guesser view never contains the word; revealed characters appear in the view only after their reveal time; the category chip appears only after 25%. The drawer's accepted-alias list goes to the drawer only. Unit test: no non-drawer view for any phase contains the word or an unrevealed character.
- Close-guess text goes only to the sender and the drawer.

## Common variants

Marked [HK/TW/CN] where the variant is popular with Chinese-speaking groups.

- **Team Pictionary with a die and board** (official). Teams move by rolling after each solved word; category by square colour; All Play squares; win by reaching the final All Play square and then winning the next All Play while holding the die (2013 ruling). Not recommended for the app (the die and board add nothing a score counter cannot do).
- **Team rounds, 1 point per word** [HK/TW/CN]: 2 to 4 teams of 3 to 6; each team gets one 60 s round (a TW guide suggests 90 s online), then the next team; a solved word is 1 point; skipping scores 0 and costs nothing, which implies the drawer may move to another word inside the same round (a multi-word speed round); the organiser fixes the number of rounds. Neither Chinese source sets a target score (the "first to 15" figure is Mattel's Man To Go). A later `wordsPerTurn: multi` team option could model this.
- **All groups race** [TW]: one representative per group shows the same answer (drawing being one of four clue styles alongside acting, describing and mixed), and the first group to raise a hand with the full answer scores 1; 30 s to 1 min per word, about 20 to 30 min per session. This is our All Play turn used for every word.
- **Classic Pictionary 3-player rule** (official, 1993 sheet): two one-person teams and a permanent Picturist who draws every word for both. Not adopted (the Picturist never guesses), but FFA at 3 covers the same table.
- **Classic Pictionary win** (official, 1993 sheet): a team on Finish may win by solving any word, including another team's All Play. The 2013 Mattel ruling (only while holding the die) is the stricter one; if a board-race mode is ever built, use the 2013 ruling and offer the classic one as an option.
- **Free-for-all room game** [common in web games, growing with phone groups]: skribbl-style, one drawer, everybody else guesses, points by speed; this is the app default.
- **Hard-words / idiom rounds** (成語你畫我猜) [CN-popular; also TW]: draw the literal image, not the abstract idea (a Taiwanese guide's example is the frog at the bottom of a well for 井底之蛙). Tier 3 should be rich in idioms.
- **Word difficulty mix** [TW guide]: about 50% easy, 30% medium, 20% hard across a session; our "one card per tier" offer lets the drawer choose the mix.
- **Relay / chain drawing** (畫畫接龍, 傳話畫; Gartic Phone, Telestrations) [HK/TW youth via Gartic Phone]: write a sentence, next draws it, next describes the drawing, and so on; fun, no scoring. Candidate for a later `relay` mode. A silent team-building relay version (each person sees the previous drawing, a short time per person, drawers may not speak, limited skips) is also reported in CN write-ups **[unverified: figures such as 25 s per person and 3 min per team came from a search snippet]**.
- **Drawer cannot see the canvas / eyes closed / off-hand / one continuous line / invisible ink** (the reported Pictionary challenge die **[unverified]**; Gartic Phone modes such as Knock-Off; Drawize/KOONGYA options): optional handicap per turn for a bonus multiplier (suggest +25% G and D). Not in the base set.
- **Hot/cold nod:** the drawer may signal "close" twice per turn. Not official; breaks the poker-face rule. Off.
- **Steal:** when the drawing team fails, the next team gets one 10 s guess. House rule, not in the official sheets. Off by default.
- **Skip budget** [TW/CN]: teams may skip a word for free; our equivalent is the one re-roll plus abandon.
- **Penalty for last place** [CN team-building]: last team drinks or does a challenge; entirely out of band, leave to the table.
- **Charades (比手畫腳 / 你比我猜; HK 有口難言) and describe-and-guess (你講我猜)** [HK/TW/CN very popular]: different games that share the word bank. A tier-2 "action" category can double as charades later.
- **Best-drawing vote:** after the game, each player taps their favourite drawing (not their own) from a gallery of the turns; the top two get a cosmetic badge, no points. Optional later add-on (skribbl.io already has a per-drawing like/dislike).

## App design notes

**Mode matrix.** Four combinations, one engine; drawing mode only changes who produces ink and who sees it.

| | Guess mode (a) shout, drawer taps | Guess mode (b) typed, auto-check |
|---|---|---|
| (1) Shared phone canvas | Everyone watches live ink on their phone; drawer's phone has tools plus a seat grid; hints and timer on all phones. Classic in-person play, also works with one phone laid on the table (see below). | Full skribbl-style: canvas, hints, input box, feed. Works at a distance; best when shouting is unwelcome (izakaya, train, hotel hallway). |
| (2) Physical paper | Pictionary at its purest: phones show timer and hints only; drawer's phone deals the word and taps the winner. Needs no network after the word is dealt. | Quiet mode with real paper: guessers look at the paper and type; app runs hints, timer and scoring. |

**Why the two guess modes differ in scoring shape.** In shout mode the first correct guess is heard by everyone, so the turn ends after the 3 s grace window (single winner, optional co-winners inside that window). In typed mode correct answers stay hidden, so several players can score with falling points and the turn can end when all have solved. The one formula `G`/`D` covers both.

**Hints for Chinese words (the main adaptation).**
- A Chinese character carries far more information than a Latin letter: revealing one of two characters gives away about half the answer. Hence few reveals: at most two, never more than half the characters (`min(2, floor(L/2))`), reveal positions chosen at turn start by the seeded RNG (never changed afterwards). Words can override with an authored `reveal: [indexes]` when one character is a giveaway.
- Clock (fractions of elapsed time): 0% length mask (`□□□`, characters count as boxes, spaces shown as gaps); 25% category chip (動物, 食物, 地方, 動作, 成語, 日本旅遊, ...), skipped when the host filtered to one category; 50% first character; 75% second character (only if L >= 4). For T = 80 s: 20 s, 40 s, 60 s, which matches the common web-game habit of starting letters around the halfway mark.
- Hints never change points directly; time already does. No hint purchase by the drawer in v1.
- Optional later hint: Jyutping/pinyin initial for the first character; skip in v1.
- One search-engine summary of a Chinese write-up describes a host calling length then category at 10 s steps **[unverified]**. Our schedule is a generalisation of that.

**Word bank (content, not code).** `js/data/draw-guess-words.js`, entry shape `{ w, alt: [], near: [], cat, tier }`.
- `w` shown to the drawer in Traditional (HK style first, since the group speaks Cantonese); `alt` holds regional and Simplified/Latin/kana aliases; `near` is optional related answers.
- Mix HK, TW and CN terms in `alt` so every group member is covered: 風筒 / 吹風機 / 吹风机; 電單車 / 機車 / 摩托車; 的士 / 計程車 / 出租車; 雪糕 / 冰淇淋 / 冰激凌; 薯仔 / 馬鈴薯 / 土豆; 單車 / 腳踏車 / 自行車; 菠蘿 / 鳳梨 (HK/TW pineapple); 壽司 / 寿司 / sushi; 拉麵 / ramen / ラーメン. Watch cross-region collisions: 土豆 is potato in CN but peanut in TW, so list it under both entries' `alt` only if the group agrees, never as a `near` of the other.
- Tier rules: tier 1 = one concrete visible noun, 1 to 2 characters, universal (蘋果, 貓, 太陽); tier 2 = 2 to 3 characters, compound noun, simple action or scene, local culture (摩天輪, 打邊爐, 自動販賣機); tier 3 = 4-character idioms (守株待兔, 畫蛇添足), abstract concepts, two-concept phrases, pop culture.
- Include a travel-in-Japan pack (拉麵, 章魚燒, 新幹線, 鳥居, 富士山, 溫泉, 便利店, 自動販賣機) since this group travels there.
- Exclude words that need letters or numbers to draw (7-Eleven, Wi-Fi), pure homophone jokes without a picture, and sensitive content by default (an "18+" pack, as seen on Taiwanese word-bank sites, must be opt-in).
- Target at least 600 words at launch (about 40% / 35% / 25% across tiers) so repeats stay rare across evenings.

**What must stay private.** The word (drawer and engine only), the unpicked offers, close-guess text, the host's alias list. Never put the word in `room`, `views.table`, the ink stream or the narration. The word chip hides itself after about 2 s; in paper mode hold-to-peek (the shared `Cover`) covers the word on the drawer's phone so a phone lying next to the paper does not leak it.

**What needs a narrator.** Nothing. Narration is optional: countdown at 10 s and 3 s, and "hint: ..." lines, with the usual host-only Cantonese voice. Default off, because shouting players drown it out and it competes with shout guessing. Use sound effects (tick at 60/10/0 s via `Timer`, hint chime, correct ding).

**What can be fully automated on phones.** Canvas plus typed is fully automatic (drawer only draws). Everything else needs the drawer's tap in shout mode and a human drawing on paper, but timing, hints, word dealing and scoring are always automatic.

**Anti-tell concerns (no night, but real leaks exist).**
- Shoulder-surfing: tap-to-peek word chip, no full-screen word display during drawing.
- The accept tap and correct ding: acceptable (it ends the turn anyway); in typed mode the "X got it" line is public by design (it is progress, not the word); a "quiet" toggle mutes dings for travel use.
- Typed feed: hide close-guess text (otherwise a typo like "aple" hands the answer to everyone); keep the "X is close" badge for tension.
- iOS keyboard: disable autocorrect, autocapitalise and spellcheck on the guess field; support Chinese IMEs by ignoring Enter during composition; use `enterkeyhint="send"`; keep the field above the keyboard.
- Cheating via text on the canvas: no text tool in the app, so only manual stroke-writing is possible; the foul flag is the remedy.
- Latency: guesses are timestamped on the host, so remote players are at a few hundred ms disadvantage at most.
- Host fairness: the host runs the engine and can in principle read state with developer tools; this is the accepted peer-to-peer trade-off recorded in project memory. The "referee peek" is a logged, score-forfeiting convenience, not a security boundary.

**Host-moderator dashboard needs.** Phase and clock with pause, +30 s, skip turn, void turn (word returned to bag); who is connected; who has solved; foul flags (count versus threshold) and a ruling prompt for team fouls; live guess feed with accept (typed mode) for the host when the drawer is slow; "referee peek" with log; reroll count; ability to auto-act a stalled drawer (auto-pick tier 2) and to replace a dead phone.

**Canvas and transport notes (against DESIGN.md section 11).** Single stream `room.ink` is enough for FFA and normal team turns. **Team All Play needs one canvas per team**: add a `canvasId` (team id) to `ink`/`inkSync`, and make the host relay strokes only to seats of that team (spectators and rivals must not receive them). Tools: pen in 3 widths, 8 colours, eraser, undo, clear; no fill, no text, no image import. Normalised 0 to 1000 coordinates and fixed aspect ratio as already designed. `inkEpoch` bump at each turn start; `inkSync` on rejoin. In the reveal phase, keep the final ink on screen for 7 s and (optionally) store thumbnails for the end-of-game gallery in host memory only (not persisted).

**One shared phone.** Fully workable in shout mode with either drawing mode, not in typed mode (others have no keyboard). Flow: PassGate to the next drawer; the drawer holds the phone privately to choose a word (hold-to-peek), then lays it flat in the middle; everybody watches the mask, timer and hints on the same screen; the drawer draws on it (canvas) or on paper (paper); the drawer taps a name in the guesser strip. Words are hidden by the tap-to-peek chip so the table cannot read the word off the shared screen.

**Engine API mapping (DESIGN.md section 4).** `act` types: `pick`, `reroll`, `guess` (typed), `accept` (shout, or typed override with `guessId`), `undo-accept`, `foul`, `abandon`, `@next`, `@auto`; `view` per phase as in Procedure; `cue` ids like `draw:7:hint:50` only if narration is on; `autoAct` for a stalled drawer = pick tier 2, for a stalled guesser = nothing; `result` = ranking, lines (best drawer, fastest guesser), `points` (winners 1 evening point). `config.defaults(n)` implements the Setup tables; `config.validate` rejects teams under 4 players or teams with fewer than 2 members.

## Sources

Primary (publisher):
- Milton Bradley (Hasbro), "Rules for Pictionary" classic sheet, rules ©1993 Pictionary Inc., item 4531-X1 (scanned PDF; added by the fact-check): https://www.hasbro.com/common/instruct/Pictionary.PDF
- Mattel, Pictionary All Play Square instruction sheet (BJM16-0920): https://service.mattel.com/instruction_sheets/BJM16-ENG.pdf
- Mattel, Pictionary Man To Go instruction sheet (R6637-0920): https://service.mattel.com/instruction_sheets/R6637-0920.pdf

Pictionary summaries and history:
- https://en.wikipedia.org/wiki/Pictionary
- https://www.playiro.com/party-games/pictionary-rules
- https://therulebook.com/party-games/pictionary/
- https://www.geekyhobbies.com/pictionary-board-game-rules-and-instructions-for-how-to-play/
- https://officialgamerules.org/game-rules/pictionary/
- https://pictionarygen.com/how-to-play

Online and app conventions:
- https://skribbl.io/ (settings ranges: draw time, rounds, word count, hints, player cap)
- https://iogameguide.com/guides/skribbl-io-guide
- https://mecchachameleon.pro/guides/skribbl-io/
- https://mechanicsofmagic.com/2022/04/15/competitive-analysis-skribbl-io/
- https://mechanicsofmagic.com/2024/04/25/critical-play-skribbl-io-28/
- https://github.com/Wanderingsou1/scribble (open-source clone: time-based scoring formula, drawer share, fixed hint reveal order, close-guess event; a data point, not skribbl.io's formula)
- https://github.com/anshikaajainn887-spec/skribbl_clone_anshikajain (clone: drawer bonus per correct guesser)
- https://github.com/himynameisdave/cacographer/pull/86 (near-miss guesses kept private, edit distance 1 constant)
- https://garticio.org/gartic-io-gameplay-guide/ (fan guide; hints and skip rules)
- https://gamerules.com/rules/gartic-phone-the-online-telephone-game/
- https://www.drawize.com/frequently-asked-questions (2 to 100 per private room, Teams mode, Drawize Phone; no word-offer count or scoring)
- https://en.wikipedia.org/wiki/Draw_Something (1/2/3 star words, letter tiles, bombs)
- https://ko.wikipedia.org/wiki/캐치마인드 (Catch Mind: 20 rounds, team or solo)

- https://en.wikipedia.org/wiki/Gartic_Phone (redirects to Telephone game; Gartic Phone release and modes, no player count) (added by the fact-check)
- https://pt.wikipedia.org/wiki/Gartic (drawer is paid per correct guesser) (added by the fact-check)
- https://skribbl.io/js/game.js (client strings: "$ is close!", votekick count, like/dislike) (added by the fact-check)

Chinese-language sources:
- https://zh.wikipedia.org/zh-hk/你畫我猜 (Draw Something article: 你畫我猜 for CN/TW, 猜猜畫畫 for HK) (added by the fact-check)
- https://zh.wikipedia.org/zh-hk/比手畫腳 (charades; HK names 有口難言, 大電視) (added by the fact-check)
- https://madestudio.com.tw/zh/games/draw-guess/ (TW: teams of 3 to 6, 60 s, numbers/arrows/諧音 agreed first, difficulty tiers, idiom tip, 50/30/20 mix)
- https://heyhafun.com/2014/02/02/%E5%90%88%E4%BD%9C%E9%81%8A%E6%88%B2-%E4%BD%A0%E7%8C%9C%E6%88%91%E7%95%AB/ (TW: related describe/draw/act variants)
- https://www.taptap.cn/moment/569804482293006412 (CN: 1 to 2 minutes, drawer bonus by speed)
- https://gnn.gamer.com.tw/detail.php?sn=304866 (TW: 你畫我猜 modes incl. relay and competitive guessing)
- https://www.niusnews.com/=P32wip83 (TW: KOONGYA DrawParty modes)
- Search snippets only, pages not retrievable (treat as unverified): http://www.my-summit.com/tzxm/649.html and http://www.xdjunxun.com/tzxlyx/ncwh.shtml (CN team-building relay figures); a Chinese write-up of a host calling hints at 10 s steps (page not located).

Related project documents: D:\board_game\docs\DESIGN.md (engine contract, canvas section 11, bag section 12).

## Verification

Adversarial fact-check, 2026-10-03 UTC. Method: re-read the two cited Mattel sheets in full (text extracted from the PDFs), and checked the rest against different sources where they could be fetched: the classic Milton Bradley/Hasbro "Rules for Pictionary" sheet (scanned, read page by page), skribbl.io's live HTML and client script, Chinese Wikipedia (Draw Something and charades articles), Portuguese Wikipedia (Gartic), Korean Wikipedia (Catch Mind), and the cited Chinese guides re-read for exact wording. BoardGameGeek, Gartic's own sites, the Gartic/Gartic Phone fan wikis and namu.wiki refused automated access.

Confirmed as written: the 60 s timer; the Picturist rotating every word; a failed word passing play to the left with no penalty; All Play mechanics; the forbidden list (letters, numbers, dashes for length, "sounds like" ears, speaking, sign language); strictness agreed before play; Man To Go details (2 teams, 1 point, first to 15, symbols allowed); skribbl.io ranges (2 to 20 players, draw time 15 to 240 s, 2 to 10 rounds, 1 to 5 words offered, 0 to 5 hints) and its "close" notice; Drawize 2 to 100 per private room; Draw Something's 1/2/3-value word offer, letter tiles and bombs; Catch Mind's 20 rounds, team or solo, drawer and guesser both scoring; the TW guide's 50/30/20 difficulty mix, idiom tip and three things to agree first. All worked scoring examples were recomputed and are correct, as are the foul thresholds and the 55 to 75% lone-solver drawer share.

Changed (facts):
- Pictionary player range: classic rules officially support 3 players (two teams, one permanent Picturist) and allow uneven teams and a fifth team above 16 players; the old text said 4+ only and called 3 "not an official count". The 2013 sheet asks for equal teams; ages corrected to 8+ (2013) and 14+ (To Go), and the unsourced "12+" was dropped.
- Card categories: the five-word card with an All Play word (plus triangle-marked All Play words) is the classic deck; in the 2013 Mattel deck the red category is Miscellaneous and All Play is a board square.
- Winning rule: the classic sheet lets a team on Finish win on any word, even another team's All Play; the 2013 sheet requires the team to hold the die for the deciding All Play. Both are now recorded, with the 2013 ruling as primary and the classic one under Common variants. Also added the different opening (classic: an All Play word; 2013: a yellow word after a die roll), the classic 5 s look before the timer, the 2013 rule that a Wild-square category must be announced, and the classic limit on X marks and secret clues.
- Draw Something has no confirmed official Chinese title; Chinese Wikipedia gives 你畫我猜 (CN/TW) and 猜猜畫畫 (HK). Added the Zynga/delisting dates and Gartic's developer.
- Charades names: removed the unattested "你劃我猜"; added the HK names 有口難言 and 大電視.
- skribbl.io: "votekick if half the room agrees" was unsourced, now "vote count shown, threshold server-side". The page HTML does not show defaults (the server sets them), so the default word count stays "commonly cited". Added the Normal/Hidden/Combination modes and the per-drawing like/dislike.
- Casual 你畫我猜: the TW guide uses one 60 s round per team (90 s suggested online), not 60 s per word, and gives no target score; the "first to 10 or 15" ending was unsourced (15 is Man To Go). Rewrote that column and the "team race" variant, and added the all-groups-race variant from the second TW guide.
- The anniversary "challenge die" is now tagged unverified (it is in none of the three sheets, and nothing fetchable confirmed it). The Gartic Phone "4+" figure is sourced from one rules site only.
- "Teams of 2 to 3 are the sweet spot" contradicted both official sheets (fewer, larger teams play better); replaced.

Changed (internal consistency of the RECOMMENDED design):
- Team draws give 8 to 12 turns, not 9 to 12 (2v2 is 8).
- Abandon versus void: the scoring section said a voided turn's word stays used, while the edge cases and dashboard returned it to the bag. Now: abandon spends the word, void returns it.
- Shout-mode timing: the turn ended at the deadline (2.4 and C) while late accepts up to 2 s were still scored (B), and an open grace window could be cut short. Added an explicit 2 s buzzer window and the rule that the deadline never cuts an open grace window; updated 2.3, 2.4, B, C, Night order and Edge cases.
- Foul flags in the reveal were described as typed-only in 2.5 but "any mode" in D; now both modes, with drawer accepts in the reveal kept typed-only.
- `loose` strictness let "contains" matches accept a message listing several answers, against step 4; added a length cap (L + 2).
- Sudden death "up to 3 new words" (4 in total?) versus "at most 3 words": now at most 3 words in total, tied teams only. All Play turns are now stated not to use up team draw counts.
- Balance check: the claim that a drawing turn is worth less than an average guessing turn was false in shout mode (0.55 to 0.75 G against an expected G / E); restated with the correct expected values.
- Second character reveal is for words of 4+ characters only; stated wherever the hint clock appears.

Not verified (left as cited): Pictionary's 1981 concept date, Gary Everson credit and licensing years (Wikipedia only, since BoardGameGeek was unreachable); skribbl.io/Gartic/Drawize scoring formulas and hint timing (not published); Gartic.io's two-word offer and Drawize's three-word offer; the TapTap, gnn.gamer and niusnews claims; the CN relay figures already tagged unverified.
