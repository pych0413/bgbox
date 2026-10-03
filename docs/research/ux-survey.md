# UX survey: companion apps, web clones and phone-as-controller party games

Prepared 2026-10-03 UTC for the Board Game Box project (static GitHub Pages app, host phone as referee,
Cantonese-speaking iPhone group travelling in Japan). Everything below is paraphrased from the sources in
section 10. No rulebook or review text is reproduced.

Companion docs: `docs/DESIGN.md` (framework) and the per-game rules references in this folder. Section 7
says exactly where this survey confirms, extends or challenges DESIGN.md.

---

## 0. Scope, method and how far to trust this

**What was surveyed.** The official One Night Ultimate Werewolf narrator app (ONUW, 一夜終極狼人) and
Bezier's Ultimate Werewolf moderator app; five Avalon (阿瓦隆) narrator or moderator apps; eight Chinese,
Cantonese and Japanese werewolf (狼人殺 / 人狼) moderator or judge apps; Spyfall (間諜) clones; 誰是臥底 /
Word Wolf (ワードウルフ) apps and imposter-style pass-the-phone apps; 9UPPER Online (瞎掰王);
A Fake Artist Goes to New York (假畫家) web clones and Oink's app; skribbl.io, Gartic Phone and Gartic.io;
Jackbox's phone controller model; and generic pass-the-phone party games.

**Evidence base.** Roughly 600 individual store reviews were read: about 370 distinct Google Play reviews of
the official ONUW app (pulled by star filter, so not a random sample), about 85 reviews from other Play
listings, and about 160 App Store reviews across some 25 apps in the US, HK, TW, CN and JP storefronts. The
rest is store descriptions, publisher posts, GitHub READMEs and MDN/WebKit documentation. Store pages expose only the
first page of reviews, so the per-app samples are small (typically 3 to 8 on iOS).

**Evidence tags used below.**

| tag | meaning |
|---|---|
| [R] | a user review said it (source id in brackets) |
| [D] | a store description, publisher page or documentation says it |
| [I] | inference or design judgment of this survey, no direct source found |

**Known gaps (be honest about them).**
- The session's web-search budget ran out part-way. Reddit is blocked to our fetcher, BoardGameGeek thread
  pages and several Chinese sites (Zhihu, kknews) returned 403. So forum discussion (Reddit, BGG, Dcard, PTT,
  LIHKG, Twitter/X) is **not** represented. Section 9 lists what a human should still look up.
- No review in the sample complains about screen glow at night. That row of the brief is [I], backed only by
  phone-movement and click-noise complaints (3.1b, 3.1c).
- Counts quoted from keyword matching (for example "about 45 language complaints") are rough.
- Nothing here was play-tested. Per DESIGN principle 6 (iPhone first), every iOS-specific claim in section 6
  is a thing to test on the real travel phones, not a settled fact.

---

## 1. The field at a glance

| app or tool | what it is | model | signal gathered | worth learning from |
|---|---|---|---|---|
| One Night (Bezier, official ONUW narrator) | free narrator + day timer for the One Night family | one phone in the middle, voice, eyes closed | 367 Play reviews, 8 iOS | pacing options, expert mode, music themes, role long-press help; also the top source of complaints |
| Ultimate Werewolf Moderator (Bezier) | MC console for the full Ultimate Werewolf | moderator holds phone, QR-scans cards | 4 Play reviews + publisher posts | deck builder by attributes, per-role rule resolution, full-screen public timer; also its failures |
| Narradir, Night Phase Narrator, Audio Assistant for Avalon, Avalon Moderator (iOS), Avalon Companion (AI Insight) | Avalon night narrators and helpers | one phone in the middle, TTS or recordings | 11 + 1 + 8 Play/iOS reviews, descriptions | masking ambience, pause length, smart role selection, thumb counter, setup validation |
| 狼人殺AI主持 (HK/TW) | Cantonese/Mandarin/English judge | one shared phone | 8 iOS reviews, long feature list | random-delay skipping of dead roles, last-game review, 10+ rule toggles; also video-ad role unlock |
| 狼人殺MC (Cantonese), Boardgame MC助手 (香港版), 狼人法官助手 | Cantonese-voice MC apps | one shared phone, 12-player cap | 8 + 1 + 3 iOS reviews | the closest existing product to ours; reviews show what Cantonese players ask for |
| 狼人殺 official online (Langren World), 終極狼人殺, 本地獵殺 | online lobbies with voice/video | matchmaking | 14 Play, 21 iOS reviews | what to avoid: phone-number login, stranger lobbies, toxic chat |
| 人狼GAME, ワンナイト人狼 for mobile (JP) | per-phone dealing, online and face-to-face | each phone shows own role | 16 iOS reviews | closest to our per-phone architecture; shows the freeze-after-auto-lock failure |
| Spyfall web clones and Android app | location + timer + cross-off list | each phone shows own card | 35 Play reviews, CSM review | what "just cards with a timer" lacks |
| 谁是卧底官方单机, 誰是臥底 (HK 陀地王, TW), Word Wolf (JP), Imposter/Spy apps | pass-the-phone word reveal | one phone passed around | about 60 reviews | selfie avatars, word-bank freshness, first-speaker tell, tiny text |
| 9UPPER Online | free community port of 瞎掰王 | room code + invite link, web and Android | site and Play description | trilingual HK/TW/EN banks; face-to-face and voice-call modes |
| Fake Artist web clones, Let's Play! Oink Games | draw one stroke each, find the fake | phones as canvases | READMEs, 8 iOS reviews | minimal UI at 320 px wide; one clone was archived after the publisher got in touch |
| skribbl.io, Gartic Phone (new iOS app), Gartic.io | draw-and-guess in public or private rooms | typed guesses | 16 iOS reviews, comparison articles | word choice of three, letter hints, custom word lists; lag, toxic chat, buried undo |
| Jackbox | phones as controllers for a shared screen | 4-letter room code, QR, first joiner is VIP | publisher pages | join friction, host-loss pause, audience, family filter |

---

## 2. What players love

1. **Nobody has to sit out as the narrator or moderator.** The strongest and most repeated praise of the ONUW
   app is that it frees a player to play [R S1, S2]. The same appears for Avalon narrators [R S6] and the
   werewolf judge apps, where a missing or error-prone 法官 is the stated reason people download them [D S8].
2. **Atmosphere.** Voice, music themes and the odd joke line are called out as what makes the night feel like
   a game rather than a chore [R S1]. Narradir and Night Phase Narrator both advertise ambient sound
   specifically so accidental movement is masked [D S4, S5].
3. **It teaches the game.** Reviewers say new players pick up roles quickly because the app tells each role
   what to do, and that rusty players stop forgetting powers or waking in the wrong order [R S1, S2].
4. **Speed.** Timers make the group play more rounds because discussion cannot sprawl [R S1]. Word Wolf
   players like that setup is two taps and a timer [R S11].
5. **Free, offline, no account, no ads.** Explicitly praised for ONUW [R S1] and advertised by the Avalon
   Night Phase Narrator ("no account, no network, no ads", works in airplane mode) [D S5], Undercover-style
   apps [D S12] and 9UPPER Online (no registration) [D S14].
6. **Pass-the-phone with photos.** The Chinese official single-device 誰是臥底 is loved for phone passing,
   selfie setup and a punishment list; one reviewer says it beats the online version [R S12].
7. **Local flavour.** The HK 誰是臥底 app is praised for topics that feel local (地道) [R S12]; Cantonese voice
   is the selling point of 狼人殺MC [R S9]. [I] Content that sounds like the friend group is a feature, not
   polish.
8. **Chaos that rewards bad drawing.** Gartic Phone and skribbl.io are liked because poor art is funny, and
   because custom word lists make the game theirs [D S16].
9. **Frictionless join.** Jackbox's four-letter room code plus QR code, no account, any browser, is the
   benchmark [D S17]. Our four-dice code is the same idea with a tap pad instead of a keyboard.
10. **Tools that keep their scope small.** The simplest Avalon helpers get 5-star "does exactly what it says"
    reviews [R S6, S4], even at 3.1 stars overall, because the complaints are all "do more".

---

## 3. What players complain about

### 3.1 The seven items in the brief

**a. Narrator too fast, too slow, or impossible to tune**
- Too fast: the paid Avalon Audio Assistant's 1-star review says the adjustable gap between instructions
  does not seem to work, so play outruns it [R S6]. ONUW reviewers want per-role pause options and a way to
  mark complex roles [R S1]. One asks for a true pause between lines instead of only stop [R S1].
- Too slow: a 狼人殺AI主持 reviewer asks for the judge to speak faster and in a nicer voice [R S8]. ONUW
  reviewers dislike the stalling step at the end of the night (everyone nudges their card) and want a skip
  [R S1]. One says the Super Villains narration adds about two minutes and Expert mode does nothing for it
  [R S1].
- Cannot be heard: music louder than voice drowned the wake/sleep cues [R S1]. The app also overrides master
  volume while open [R S1]. A Cantonese MC app got a 1-star because the voice was hard to understand [R S9].
- Settings cannot be tested: reviewers want to hear music or voice without starting a round [R S1].
- Text removed: one reviewer wants the instruction text kept visible instead of a "pause for N seconds"
  placeholder, because complex roles need reading [R S1].
- Lesson: pacing is not one slider. People want global speed, per-step pause, a "just open/close" mode that
  genuinely covers every role, a preview, and text as a fallback.

**b. Tap noises and movement giving roles away at night**
- The most direct evidence in the whole survey: two ONUW reviews say the app's click sound for roles that
  need input reveals whether that role is in play (a click means a player chose, silence means the app
  chose) and ask for the click to be removable or simulated [R S1].
- Movement around the phone gave away roles with eyes closed; one group used portable Bluetooth speakers
  under the table. Two more reviews play narration through a loud Bluetooth speaker to cover card-shuffling
  sound, and one of them complains of distortion when pushing the app through a speaker [R S1].
- The official app ends the night with a step where everyone nudges their card (presumably to mask swaps,
  [I]); two reviewers find it purposeless and want it skippable [R S1].
- Avalon helpers ship ambient wind or selectable background sound for the same reason [D S4, S5].
- 狼人殺AI主持 skips eliminated roles after a random delay so absence does not show [D S8]. This is the same
  idea as our fixed-duration decoys, implemented by randomising instead of padding.
- Lesson: a tell can be audible, visible or temporal. For a phones-only game the leak moves from cards to
  taps, vibration, screen glow and silence length. Our design (DESIGN.md section 4) already treats all four.

**c. Screen brightness revealing who is awake**
- [I] No review found. Reasoning: a lit screen in a dark room is visible through eyelids and at the edge of
  vision, and every phone that lights differently at a different time is a tell. Bezier's own design avoids
  the problem by using one phone in the middle and no per-player screens [D S2].
- The per-phone werewolf web app we found keeps the wolf's teammates visible on-screen all game but never
  tells a client about other roles [D S20]; it does not address glow.
- iOS web pages cannot set screen brightness [I]. The only controls are near-black UI, no flashes, and an
  instruction to turn brightness down in Control Center.

**d. Reconnect pain**
- JP 人狼GAME: after the iPhone auto-locked and woke, the app froze on the "choose who to execute" screen,
  twice in a row, and the session fell apart; others report that with more than five players one person never
  got their role notification, so one phone was passed around instead [R S11].
- JP ワードウルフ決定版: the timer stops while the phone sleeps, so players must keep touching the screen
  [R S11].
- Gartic.io (public rooms): multi-minute loading and room-list lag, plus bot floods that kick everyone out
  [R S16]. Gartic Phone's new iOS app makes users sign in with Discord every time [R S16].
- Spyfall Android: closing the app wipes the player list [R S13]. Official-style 狼人殺 app: forced re-login
  on every launch [R S10].
- Counter-examples worth copying: Jackbox pauses for five minutes if the host drops and keeps all data and
  players [D S17]; 狼人殺AI主持 advertises automatic reconnect for online mode [D S8].
- Lesson: sleeping phones and returning to the app are the dominant real-world failure in this sample, ahead
  of network quality. See features 5 and 6.

**e. Too much reading**
- ONUW reviewers want a recap of what was said at night and a list of what randomised roles do [R S1, S2],
  which is the flip side: they want information they can read after the fact, not while eyes are closed.
- Super Villains narration is too wordy for Expert mode to help [R S1].
- Tiny text: HK 陀地王 (text too small, worse on iPad), Chinese official single-device app (avatars too small,
  tablet view cropped to 75%) [R S12].
- Rules explanations: the Avalon helper's 1-star complains it does not say how many of each role per
  headcount, nor describe characters [R S6]; the Bezier moderator's help site and card scanning are called
  confusing [R S3].
- Lesson: short spoken cue plus one-line text, role help on demand (long-press), and a text-size setting.

**f. Accidental reveal**
- A web werewolf moderator (play-werewolf.app) makes players double-click to open a role card, specifically to
  prevent accidental reveals [D S20].
- A Spyfall Android reviewer asks for the location card to look different from other cards so nobody
  misclicks [R S13].
- With twelve players around one phone in 狼人殺AI主持, a reviewer calls reaching into the middle of the
  table awkward and unsafe and asks for per-player phones [R S8].
- Imposter apps leak the roles the other way: the imposter is never first to speak, so the first speaker is
  innocent [R S12]. The same reviewers ask that 白板 never speak first in 誰是臥底 for fairness [R S12], which
  is a different house rule with a different tell. Randomise by default, make any exception an announced
  toggle.
- Lesson: reveal needs deliberate friction (hold, double-tap, or gate), a prompt that does not name the
  holder, and a speaker order that is not a function of role.

**g. Slow Chinese typing**
- [I] No review says it directly. Indirect evidence: the JP Word Wolf app cannot take Japanese in its custom
  question form and only offers the default keyboard [R S11]; the Play 誰是臥底 custom word bank does not
  save [R S12]; Gartic.io and skribbl.io are typed-guess games by design [D S16].
- [I] On a phone, Cantonese input (倉頡, 速成, 粵拼, handwriting) is slower and more error-prone than English,
  and guess-typing steals attention from the drawing. All of our games can be played with speech: guess
  aloud, then one tap to record who got it.

### 3.2 Other recurring complaints

| theme | evidence | note for us |
|---|---|---|
| **Ads and paywalls break the mood** | ONUW 1-star: an ad played while the whole table had eyes closed [R S1]. JP ワンナイト人狼: an ad after every game [R S11]. 狼人殺AI主持: paid VIP did not remove ads [R S8]; video ads must be watched again each launch to unlock roles [R S8]. HK 陀地王: logout wiped paid packs [R S12]. Imposter apps: surprise charges, unskippable ads [R S12]. | We are free and static. Keep it that way, and never gate roles. |
| **Works on my phone, not yours** | About 15 of 367 ONUW Play reviews say narration or music is silent, stalls on a role, skips to voting, or only reads open/close on certain Android phones; one says the browser version works instead [R S1]. Updates caused slowness and freezes [R S1]. | A narrator that fails silently ends the game. Needs a visible fallback (feature 1). |
| **Languages, region locks** | About 45 of 367 ONUW Play reviews ask for Spanish, German, Polish and others, or complain a language is region-locked or paid [R S1]. | Cantonese-first is the right bet. [I] Ship every language in the bundle, never gate by region. |
| **Role and rule bugs** | ONUW wake-order and Doppelganger/Oracle/Nostradamus interaction bugs [R S1, S2]. 狼人殺MC: a dead witch could still auto-save next round [R S9]. HK 陀地王: 7 players with 2 undercover became 3 [R S12]. | Dead and used-up roles must not act; role counts need invariants in tests. |
| **Setup helps nobody avoid bad decks** | ONUW: wants recommendations by card set and headcount, and the app lets you pick impossible sets such as one Mason [R S1]. Avalon Audio Assistant: no per-headcount composition [R S6]. Bezier moderator deck builder cannot remove a card without restarting [R S3]. | Presets plus validation (feature 8). |
| **Perceived non-randomness** | 狼人殺AI主持: seat 2 is always the wolf [R S8]. 誰是臥底 apps: the same player is undercover every time [R S12]. 幹話王: the honest-one card lands on the same person often [R S12]. Word Wolf JP: the wolf is only ever the 3rd or 4th player [R S11]. | Even if the RNG is fair, streaks feel rigged. Offer an anti-streak option and show history. |
| **Content runs out or repeats** | Undercover word-party app: offline mode can run out of words [R S12]. Spyfall: locations repeat, want custom lists [R S13]. Spy and Fakeit: repetition, and want to add words [R S12]. Word Wolf JP: words from the wrong category sometimes appear [R S11]. | No-repeat bags with exhaustion handling (feature 11). |
| **Forgotten group** | Spyfall wipes the player list on close [R S13]; TW 誰是臥底 reviewers ask to save player names [R S12]. | Persist the group (feature 9). |
| **Strangers, toxicity, accounts** | Official-style 狼人殺 lobbies: abuse in chat, minors, matchmaking full of idle chat, mainland phone number required, so HK/TW users cannot log in (most of the 14 sampled Play reviews are about this) [R S10]. Undercover app and Gartic.io: no chat filter or block [R S12, S16]. | Private rooms only; no accounts. |
| **Layout failures** | ONUW buttons hidden behind Android navigation bar; no landscape, so no TV casting [R S1]. Gartic Phone iPad landscape awkward [R S16]. Chinese single-device app does not fill an iPad [R S12]. | Safe-area insets, rotate cleanly, and offer a big-screen table view. |
| **Size and speed** | ONUW: storage-heavy, lags after updates [R S1]. | Small bundle; precache once. |
| **Tone surprises** | ONUW: a teen group was frightened when an ad-lib "they're here" line appeared at midnight; a parent asks to edit the commentary; others miss removed jokes [R S1]. | Make flavour a setting. |
| **Help and rules** | Avalon Audio Assistant: wants a rules section and custom voices [R S6]. Spy app's own instructions make the spy-wins-by-timer outcome possible, with no support route [R S12]. | Rules are part of the app, with a 30-second version. |

---

## 4. Teardown notes by game family

**ONUW and other eyes-closed night games.** The official app solves the problem with one phone in the middle
and a human-speed narrator, and everything players complain about (noise tells, narration failing, music
balance, ads at the wrong moment) follows from that model [D S2, R S1]. DESIGN.md goes further by giving
every seat a phone, so the tells become taps, glow and silence length, and the answer is decoys and fixed step
lengths rather than masking sound. Keep the narrator as optional atmosphere, as the design says.

**Werewolf (狼人殺).** Existing moderator apps are almost all single shared phone with voice. Their reviewers
ask for more players (the Cantonese MC caps at 12 and reviewers want 16) [R S9], more roles [R S8, S9], an
undo step for mis-taps [R S9], and per-player phones [R S8]. The per-phone web app on GitHub chose
no force-advance button, timer defaults when time runs out, hidden live vote tallies until locked, and
direction arrows for speaking order [D S20]; all four map to ideas in section 8. The Bezier console shows
how heavy a full-featured moderator becomes: a 21-player table abandoned it by night three [R S3].

**Avalon.** The helper market is almost entirely night-phase narration with a role selector. Advertised
features of the best one: recorded audio, dynamic script that rebuilds from selected roles, an automatic "how many thumbs"
announcement, ambient wind, pace control, wake lock, offline [D S5]. Complaint: pacing controls that do not
work [R S6]. The only app that tracks votes and quests is an AI-insight app with no review data [D S7].
Per-phone private reveal plus team and quest voting is open ground.

**Spyfall.** Web clones are skeletal: a timer, a cross-off list, and cards, with no turn indication and
conversation left to other tools [D S13]. The Android app's reviewers miss civilian roles per location
(for example "bartender at a bar") that older versions had, say locations are paywalled, want editable
location lists and spy count, and lose the player list every launch [R S13]. [I] The depth is in the
content, not the app.

**誰是臥底 / Word Wolf.** Pass-the-phone dominates, with a sidebar of online apps. Beloved: selfie setup,
first-speaker control, punishment lists, 3 to 16 players, offline [D S12, R S12]. Pain: first-speaker tell,
repetition, running out of words offline, text too small, dead players cannot review words, no vote
mechanism, no stop-and-vote button, custom words not saving [R S11, S12].

**9UPPER (瞎掰王).** The community 9UPPER Online runs rooms by code and invite link, supports 3 to 9, has a
Hong Kong Traditional, Taiwan Traditional and English interface and question bank, works face to face or over
a call, and states plainly that it is unofficial [D S14]. A different 瞎掰王-style app, "Bluff King", keeps the whole game on
one host phone, hands players a single shared QR that opens a static page, ships about 1,300 cards offline
and offers AI-generated custom sets [D S7]. The one 瞎掰王-style review we found complains that the
"honest" role keeps landing on the same player [R S12].

**Fake Artist (假畫家).** Open-source clones are deliberately minimal (designed for 320 px width), keep state
in server memory, and offer voting, scoring and a leaderboard [D S15]. The most prominent one was archived
in 2021 after the publisher contacted the author [D S15]. Take that as a risk note for naming and branding
(section 6), not as legal advice.

**Draw and guess.** skribbl.io: pick one of three words, letters appear as hints after about 40 seconds,
faster correct guesses score more, room owners can add custom word lists [D S16]. Complaints are about
public lobbies, lag, ads and thin drawing tools [D S16]. Gartic.io reviewers note undo is buried behind a
button, and that when nobody guesses the app should reveal the word [R S16]. Comparison articles say Gartic
Phone wins on laughs but is fiddlier on a phone, because drawing in chains on a small screen is hard, while
skribbl.io's shorter turns suit phones better [D S16].

**Jackbox-style controllers.** What carries over: room code plus QR, no install, first joiner is VIP and
starts the game, host-loss grace period, optional family filter, hide-the-code for streams [D S17]. What does
not carry over: audience scale, shared TV screen. [I] Our host phone can double as the table display.

**Pass the phone.** Strengths: nobody drifts to notifications, reveals create reactions, zero setup [D S18].
Pitfalls recorded above: first-speaker tell, ad interruptions, text size, repeated words, and the
reach-across problem at twelve seats.

---

## 5. Clever features worth borrowing

| feature | seen in | why it works | in DESIGN.md? |
|---|---|---|---|
| Seat-order setup (circle of players, drag to match table) | Bezier moderator's circular roster [D S3]; speaking-direction arrows [D S20]; Word Wolf designated order [D S12] | speaking order, left/right neighbour rules and vote rings all need real seating | yes: SeatEditor |
| Role recommendation by player count | Narradir "smart" selection [D S4]; Avalon Moderator presets and validation [D S7]; ONUW reviewers asking for it [R S1]; Bezier deck builder [D S3] | turns setup from homework into one tap | partly: `config.defaults(n)` and `validate` |
| Rules on the card | ONUW long-press role tutorial [D S2] | the person who forgot what a role does can check silently | yes: RulesSheet; add long-press on every role |
| Decoy actions | requested by ONUW reviewers [R S1]; random-delay skips in 狼人殺AI主持 [D S8] | removes the tell instead of masking it | yes: section 4 |
| Timers with warnings | ONUW day timer with alarm [D S2]; Bezier public full-screen timer [D S3] | pacing without a nagging human | yes: Timer 60/10/0 |
| Early stop | JP Word Wolf reviewers asking for stop-and-vote [R S11] | discussion ends when the wolf is obvious | not yet |
| Expert mode | ONUW [D S2] | veterans skip the full lines | not yet |
| Ambient sound that masks | Narradir, Night Phase Narrator, ONUW themes [D S2, S4, S5] | masks small movements | yes, optional; add ducking |
| Thumb counter | Night Phase Narrator [D S5] | removes the commonest setup mistake | n/a per phone: each phone shows its own list |
| End-of-game explanation | requested for ONUW (recap, win conditions, who changed teams) [R S1, S2]; "last-game review" in 狼人殺AI主持 [D S8]; Bezier moderator announces the winner [D S3] | settles disputes and teaches | yes: results `lines` |
| Game log | requested for the Bezier moderator [R S3] | undoes "who did the witch save" arguments | partly: results only; add live log for host |
| Undo last step | requested for 狼人法官助手 [R S9] | fat fingers | not yet |
| Replay with the same group | Spyfall and 誰是臥底 reviewers asking to save players [R S12, S13]; 萌狼 "restart without rebuilding the room" [D S9] | the evening is a series of games | yes: room outlives game |
| Session scoreboard and recap collage | shareable end-of-game collage in a 誰是臥底 app on the HK store [D S12] | a souvenir of the trip | yes: Scoreboard; collage is new |
| No-repeat word decks | "no repeated questions" is marketed by 誰是臥底 apps [D S12] | keeps long sessions fresh | yes: `bag.js` |
| Custom decks for the group | skribbl.io [D S16]; Spy, 誰是臥底, Word Wolf reviewers [R S11, S12] | in-jokes carry the evening | partly: custom entries mentioned |
| Role-list validation and saved decks | Avalon Moderator, Bezier moderator [D S3, S7] | prevents invalid sets | partly |
| Tunable timeouts with defaults, no force-advance | per-phone werewolf web app [D S20] | removes moderator bias and stalls | partly: stall controls exist |
| Hidden live tallies until lock | same [D S20] | stops bandwagoning | yes: VotePanel reveal |
| Host-loss pause | Jackbox [D S17] | host's phone drop is not game over | not stated |
| Hide the room code | Jackbox [D S17] | stops strangers joining | n/a (private friends) |
| Preview before start | requested for ONUW [R S1] | test voice/music in the room's noise | not yet |
| Voice choice | requested for ONUW and Avalon [R S1, S6]; three voice languages in 狼人殺AI主持 [D S8] | accessibility, taste | yes: voice picker |
| Selfie or avatar per player | official single-device 誰是臥底 [R S12] | handoff to the right person | not yet (colours only) |
| Local-slang content | HK 陀地王 [R S12] | feels like us | yes in banks |

---

## 6. Pitfalls specific to friends travelling in Japan

| situation | what goes wrong | evidence | design response |
|---|---|---|---|
| **No physical cards** | dealing, shuffling, card swaps and dice must all be replaced, so the app becomes the single point of truth | [D S2] | the phones are the components; keep single-device fallback |
| **Noisy room (izakaya, train, hostel)** | the host phone's TTS is inaudible; Bluetooth speakers are already a workaround | [R S1] | captions on the host screen, a loud mode, speaker pairing tip, read-aloud mode for a human narrator |
| **Dark room, bright phones** | glow, brightness mismatches and unequal timing leak who is awake; in bright sun a dark theme is unreadable | [I] | near-black night UI, day theme with high contrast, text size setting |
| **Weak or expensive data** | PeerJS needs internet for signalling; free TURN relays may be rate-limited; roaming SIMs; hotel Wi-Fi often isolates clients | [D S19] MDN: relay needed for some NATs; [I] the rest | single-device mode with no network; precache; hotspot hint; TURN health check; hold a mobile-data fallback in the join screen |
| **A phone dies** | host death ends the room; guest death loses a seat | [I] | multi-seat devices (designed); backup host (could); deputy snapshot; plug-in prompt |
| **Screen locks mid-game** | JP reviews: app freeze after auto-lock, timer paused in sleep | [R S11] | wake lock on every phone, wall-clock timers, resync on return; test Home Screen mode |
| **Silent switch and volume** | [I] iPhone ring/silent switch commonly mutes Web Audio; speech may behave differently; ONUW reviewers hit volume problems | [R S1] | pre-flight sound test; detect "no audio played" and ask |
| **Cantonese TTS needs setup** | the voice is not always installed or enabled; a 狼人殺MC reviewer asked how to turn it on, another asked for newer voices; an MC app was called unintelligible | [R S9] | onboarding (feature 2) |
| **Mixed languages** | a Cantonese group with Mandarin speakers, Japanese hosts or English words; apps lock languages by region | [R S1] | Cantonese-first, role names with emoji, optional English/Japanese subtitle |
| **Publisher IP** | one Fake Artist web clone was archived after the publisher got in touch; 9UPPER Online and Avalon narrators prominently say they are unofficial | [D S15, S14, S5] | own wording, own art, no publisher logos, short disclaimer; neutral titles if the site is public |
| **Small groups, odd counts** | some games need 6 or more (Gartic Phone chain at 6+; 狼人殺 6 to 12) | [D S16] | picker explains why a game is greyed out, suggests alternatives |
| **Attention on trains and planes** | slow pace, long sessions, interruptions | [I] | resume after interruption, pause everywhere |

---

## 7. What this survey changes in DESIGN.md

**Confirmed (no change).** One-phone fallback, decoys and fixed durations, mute non-host phones, hold-to-peek,
PassGate, NarratorBar replay/skip, narrator modes including 讀稿, bag without replacement, results with
reasons, spectator on late join, snapshot restore, precache, no ads, no accounts.

**Extend.**
1. Narrator: add a visible failure path (watchdog banner, text line, one-tap repeat/skip) and a pre-flight
   test; per-step pause scale; expert mode; preview; ducking under voice; separate night and day music
   switches. (features 1, 2, 7, 13)
2. Anti-tell: state in section 4 that **UI feedback must be role-independent** for audio and visual too,
   not just taps and durations. (feature 3)
3. Recovery: seat-claim by name, host-gone pause semantics, resync on `visibilitychange`, wall-clock timers.
   (features 5, 6)
4. Setup: show presets with a reason, block invalid compositions, assert role-count invariants in the fuzzer.
   (feature 8)
5. Randomness: first speaker is random over all roles; optional anti-streak for special roles with history
   shown at the end. (feature 20)
6. Content: handle exhaustion, locale tags, batch-add custom entries. (features 11, 21)
7. Timers: early-vote button and a public full-screen "table clock" view. (feature 19)
8. Text size and contrast settings. (feature 23)

**Challenge.**
- "Steps never end early" is right for secrecy, but the official app's end-of-night stall earned complaints.
  Keep the fixed length, but make the wait visibly meaningful (a night-end ring, not an idle screen).
- "Non-host phones mute SFX" removes a tell but also removes feedback; use visual feedback of identical
  shape for everyone, and test it with eyes open at table distance.
- A **per-phone app trades away** what ONUW's one-phone model has: nobody can see anyone's screen at all. The
  design is stronger on tells that are mechanical (cards, order) and weaker on ones that are physical (glow,
  reaching). Treat dark UI as a first-class requirement, not decoration.

---

## 8. Thirty feature ideas, prioritised

Priority meaning. **must**: the evidence says the product fails or leaks without it. **should**: clear
evidence of player value, moderate cost. **could**: nice, speculative or costly. "Status" compares with
DESIGN.md: done = already designed, part = partly, new = absent. Evidence tags as in section 0.

### Must (12)

| # | feature | why | games | status |
|---|---|---|---|---|
| 1 | **Narration that cannot fail silently.** Watchdog on every cue (TTS never started, never ended, volume 0); on trip show the line as big text on the host and a one-tap Repeat / Skip / Next; same text on an optional "read aloud" card | about 15 ONUW reviews report silent or stalled narration on particular phones [R S1]; DESIGN already notes unreliable `onend` | all narrated | part |
| 2 | **Voice and audio pre-flight.** One screen before the first game: is a zh-HK voice installed (if not, steps to add one, falling back to zh-TW/en), test line at current volume, silent-switch reminder, wake lock check, "add to Home Screen" prompt, motion permission | Cantonese voice setup questions and unintelligible voice reviews [R S9]; ONUW volume complaints [R S1] | all | new |
| 3 | **Role-independent feedback at night.** Identical tap, sound, animation and duration for every seat at every step, including dead, used-up and absent roles; decoys that need the same number of taps | direct evidence that a role-specific click is a tell [R S1]; 狼人殺AI主持 hides dead roles on purpose [D S8] | all night games | part |
| 4 | **Black "eyes-closed" screen.** Near-black UI between a seat's own actions, no white flashes, soft fades, instruction to lower brightness in Control Center, role card visible only while held | physical inference [I]; ONUW movement and glow-like tells [R S1] | ONUW, Werewolf, Avalon, Cheese Thief | part |
| 5 | **Timers on wall-clock, wake lock on every phone, resync on return.** Timers computed from timestamps (not intervals); wake lock while a game runs; on `visibilitychange` re-open the channel and fetch the current view before showing anything; a banner "back in sync" | JP freeze after auto-lock [R S11]; timer pauses in sleep [R S11]; MDN: lock released when page hidden or low battery [D S19] | all | part |
| 6 | **Seat recovery.** If a token is lost (new tab, cleared storage), tap your name to reclaim your seat, host-approved; a dead phone's seat can be played from another phone; one phone can hold several seats | per-phone role bugs force "pass one phone around" [R S11]; DESIGN section 7 | all | part |
| 7 | **Pacing controls.** Global voice speed, per-step pause scale, 新手 (slow) and 快速 (just open/close, genuinely covers every role) presets, pause, and a **試聽** preview for voice and ambience | [R S1, S6, S8]; pacing complaints in 3.1a | narrated games | part |
| 8 | **Head-count presets with a reason, plus hard validation.** "6 players: 2 wolves, seer, witch, hunter, villager (why)", difficulty labels, blocked invalid sets, invariants fuzz-tested | [R S1, S3, S6, S12]; the 2-to-3 undercover bug | all role games | part |
| 9 | **Saved group and one-tap replay.** Names, colours, seat order and last game remembered on the device; 再玩一局 and 換遊戲 on results; evening scoreboard | [R S12, S13] | all | done in design, add persistence of group |
| 10 | **Results that explain why.** Plain-Cantonese timeline of what happened, who changed teams, win conditions, and the night recap players could not read live | [R S1, S2]; 狼人殺AI主持 "last-game review" [D S8] | all | done (extend with recap) |
| 11 | **No-repeat content bags that handle running dry.** Per-bank history survives evenings, clear message when a filtered pool is exhausted, offer reset or widen filters, locale tags (HK/TW/EN/JA) | [R S12, S13]; "no repeats" marketed by competitors [D S12] | 誰是臥底, Spyfall, draw, fake artist, 9upper | done (add exhaustion UX) |
| 12 | **Complete offline single-device mode.** Everything playable with no network after first load, with PassGate; precache all games and banks; a visible "offline ok" badge | weak data in Japan; offline praised [D S5, S12]; ONUW errors when offline [R S1] | all | done in design, verify |

### Should (13)

| # | feature | why | games | status |
|---|---|---|---|---|
| 13 | **Ducking ambience, separate night/day music.** Music never louder than voice, automatically lowered under speech, independent toggles for night and day phases, volume never forced | music drowned narration [R S1]; day-music preferences split [R S1]; master volume override [R S1] | narrated games | part |
| 14 | **Narration flavour setting.** 平實 (plain) / 戲劇 (dramatic), no sudden scary ad-libs by default, and a colloquial vs written Cantonese switch | [R S1] frightened teens, parent request | narrated games | new |
| 15 | **Rules on the card.** Long-press any role, anywhere, for a one-line ability; the 30-second rules sheet; a private "what I know" note that fills automatically from night results | [D S2]; [R S1, S6] | role games | part |
| 16 | **Reveal friction options.** Hold-to-peek (done), plus optional double-tap-to-open, auto-hide after N seconds, hide on app switch, lock | [D S20], [R S13] | role games | part |
| 17 | **Better PassGate.** Anonymous role prompts, fixed-length slots, "3 of 8 seen" progress, auto-blank timeout, optional selfie or emoji avatar so the phone reaches the right hands | [R S12] | pass-the-phone | part |
| 18 | **Seat ring.** Draggable circle matching the table, arrow showing speaking direction, "tap the person on your left" quick-seat for groups who join in random order | [D S3, S20] | all | part |
| 19 | **Timer pack.** Big shared timer, warnings with sound plus flash (iOS has no vibration), +60 s and pause, **early-vote** button, a full-screen "table clock" the host can lay in the middle | [D S3]; [R S11] | day phases | part |
| 20 | **Fair-feeling randomness.** Random first speaker including the spy/undercover; optional anti-streak for special roles (not the same player twice in a row if the pool allows); end-of-session role history | [R S8, S11, S12] | 誰是臥底, 瞎掰王, 狼人殺 | new |
| 21 | **Group decks.** Batch paste one entry per line, import/export via link or QR, dictation, per-deck sharing, stored locally and mixed into the bag | [R S11, S12]; typing cost [I] | word games | part |
| 22 | **Low-typing policy.** No typed input in live play: tap chips, say it aloud then tap who got it; multiple-choice guess mode for 你畫我猜; typed guess only as an option | [I]; Chinese IME limits [R S11] | draw-guess, fake artist | new |
| 23 | **Text size and contrast.** Slider and presets for dim room vs sunlight; captions of narration lines for noisy rooms | tiny-text complaints [R S12] | all | new |
| 24 | **Drawing kit.** Always-visible undo, palm-safe strokes, one-tap palette, 3-word choice, letter hints, reveal the answer when nobody guesses, iPad landscape | [R S16, D S16] | draw-guess, fake artist | part |
| 25 | **Host console safety.** Undo last host step, panic pause, "who is connected" with a plug-in reminder, auto-act for stalled seats (done) and no force-advance for players | [R S9]; [D S20] | all | part |

### Could (5)

| # | feature | why | games | status |
|---|---|---|---|---|
| 26 | **Deputy host.** Periodically replicate the room snapshot to a chosen second phone so the game resumes if the host dies (new code, clients rejoin) | host battery risk [I] | all | new |
| 27 | **Mixed-language labels.** Role names with emoji plus optional English and Japanese subtitle; word banks tagged by locale | [R S1] language requests; [D S14] trilingual banks | all | new |
| 28 | **Connection wizard.** If a join fails after N seconds: switch off Wi-Fi, try a personal hotspot, check TURN, retry; log which path worked | [D S19] relay needed on some networks | all | new |
| 29 | **Dead-player view.** Optional spectator mode for the eliminated showing all words or roles after death, off by default | [R S12] asked for this in 誰是臥底 | 誰是臥底, 狼人殺 | new |
| 30 | **Evening recap card.** One shareable image: scores, funniest drawing, who was wolf most often | [D S12] collage feature; a souvenir for the trip | all | new |

---

## 9. Open questions and what a human should still check

1. **Forums.** Reddit (r/boardgames, r/werewolf, r/AvalonTheResistance), BGG forums for ONUW app and Avalon
   apps, LIHKG, Dcard, PTT, Bahamut (巴哈姆特) boardgame boards, Plurk/X Japanese 人狼 threads. Useful queries:
   "narrator too fast", "peek", "phone light", "app noise", "手機 狼人殺 偷看", "天黑請閉眼 手機 聲".
2. **iOS Cantonese voice.** Which zh-HK voices are actually installed on the travel iPhones, how do they sound
   at 0.7 to 1.3 rate, and does the ring/silent switch mute `speechSynthesis` or Web Audio on the current iOS.
3. **Wake lock in Home Screen mode.** Safari 16.4 added the API [D S19]; verify that it holds on the installed
   iOS version when the app is added to the Home Screen.
4. **TURN.** `js/net.js` lists a free public relay. Confirm it still answers before any trip, and decide
   whether to host one.
5. **Anti-streak randomisation.** It is a deliberate bias. Decide per game whether to default it on and how
   to disclose it (suggested: show it in the game's rules sheet).
6. **Expert mode semantics.** The official app's Expert mode does not shorten some expansions [R S1]. Decide
   how to define "fast" so it covers every role we ship.
7. **Dead-player spectating** (feature 29) is requested but changes the information model: decide per game.
8. **Publisher contact risk** (section 6): decide whether the public site should avoid brand-adjacent names.

---

## 10. Sources

All fetched 2026-10-03 UTC. Reviews were read from public store pages and the public Google Play review
listing; nothing is reproduced.

**S1** One Night (Bezier, official ONUW narrator), Google Play: https://play.google.com/store/apps/details?id=com.mobieos.karan.Wolf_Android14_11_13 (367 reviews pulled by star filter)
**S2** One Night, App Store: https://apps.apple.com/us/app/one-night/id728175611 (description and 8 reviews)
**S3** Ultimate Werewolf Moderator: https://play.google.com/store/apps/details?id=com.beziergames.uwexmoderator ; https://beziergames.com/pages/uw-moderator-app-quick-start ; https://beziergames.com/blogs/news/a-new-way-to-run-your-ultimate-werewolf-games
**S4** Narradir (Avalon and Secret Hitler narrator): https://play.google.com/store/apps/details?id=com.liweiyap.narradir
**S5** Night Phase Narrator (Avalon Big Box): https://play.google.com/store/apps/details?id=com.pocketnedapps.avalonnarrator
**S6** Audio Assistant for Avalon: https://apps.apple.com/us/app/audio-assistant-for-avalon/id931226475
**S7** Avalon Moderator (iOS): https://apps.apple.com/us/app/avalon-moderator/id6771264616 ; Avalon Companion AI Insight and the listed Bluff King app: https://play.google.com/store/apps/details?id=com.luming.avalonhelper2
**S8** 狼人殺AI主持 (HK/TW): https://apps.apple.com/tw/app/%E7%8B%BC%E4%BA%BA%E6%AE%BAai%E4%B8%BB%E6%8C%81-%E5%85%A8%E9%9D%A2%E7%9A%84%E7%8B%BC%E4%BA%BA%E6%B3%95%E5%AE%98/id1613802321 ; Play listing https://play.google.com/store/apps/details?id=com.teddy.werewolf.party
**S9** 狼人殺MC (Cantonese): https://apps.apple.com/hk/app/id1526692596 ; Boardgame MC助手 (香港版): https://apps.apple.com/hk/app/id6444035653 ; 狼人法官助手: https://apps.apple.com/hk/app/id1217460398 ; 萌狼: https://apps.apple.com/sa/app/app/id1525690109
**S10** Online 狼人殺 lobbies: Play (TW reviews) https://play.google.com/store/apps/details?id=com.c2vl.kgamebox ; https://sj.qq.com/appdetail/com.c2vl.kgamebox/review ; https://apps.apple.com/cn/app/id1126393139 ; https://apps.apple.com/tw/app/id1228173973 ; https://apps.apple.com/tw/app/id6504466828
**S11** Japanese apps: https://apps.apple.com/jp/app/id1303085553 (人狼GAME) ; https://apps.apple.com/jp/app/id1222278363 (ワードウルフ決定版) ; https://apps.apple.com/jp/app/id1060638530 ; https://apps.apple.com/jp/app/id1529747588 ; https://apps.apple.com/jp/app/id886948262 (ワンナイト人狼)
**S12** 誰是臥底 and imposter-style apps: https://apps.apple.com/tw/app/id1157927944 ; https://apps.apple.com/hk/app/id1533757733 ; https://apps.apple.com/cn/app/id715027145 ; https://play.google.com/store/apps/details?id=com.soda.whoisspy ; https://apps.apple.com/us/app/id946882449 ; https://apps.apple.com/us/app/id6749012623 ; https://apps.apple.com/us/app/id1436433223 ; https://apps.apple.com/tw/app/id6756179924 ; https://apps.apple.com/us/app/%E8%AA%B0%E6%98%AF%E8%87%A5%E5%BA%95/id784258202
**S13** Spyfall: https://play.google.com/store/apps/details?id=io.github.maxcriser.spyfall ; https://www.commonsensemedia.org/website-reviews/spyfall (CSM) ; https://github.com/adrianocola/spyfall ; TechRadar roundup (title only): https://www.techradar.com/how-to/how-to-play-spyfall-online
**S14** 9UPPER Online: https://9upper-online.com/ ; https://play.google.com/store/apps/details?id=com.nineupper.online
**S15** Fake Artist: https://github.com/kcgidw/fao ; https://github.com/citruz/fakeartist ; https://github.com/acrimi/Fake-Artist-Game-Master ; https://apps.apple.com/us/app/id1564193305 (Let's Play! Oink Games)
**S16** Drawing: https://apps.apple.com/us/app/id6788498566 (Gartic Phone) ; https://apps.apple.com/us/app/id1270393677 (Gartic.io) ; https://iogameguide.com/guides/skribbl-io-guide ; https://onlineparty.games/compare/gartic-phone-vs-skribbl-io ; https://doodleduel.ai/compare
**S17** Jackbox: https://www.jackboxgames.com/how-to-play ; https://www.jackboxgames.com/blog/how-to-play-party-pack-nine-remotely ; https://steamcommunity.com/app/442070/discussions/0/358415206096198643
**S18** Pass the phone: https://passthephone.app/en/blog/fun-party-games-you-can-play-on-one-phone/
**S19** Platform: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API ; https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis ; https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols ; https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ ; https://peerjs.com/docs/
**S20** Werewolf web moderators: https://github.com/piercefu/werewolf ; https://play-werewolf.app/how-to-use
