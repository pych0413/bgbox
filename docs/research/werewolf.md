# Werewolf (狼人殺) — rules reference
> Paraphrased for engine implementation. Not a copy of the official rulebook.

Research date: 2026-10-03 UTC. Confidence tags used below: **[official]** = the 2017 official standard-rules post and the NetEase "官方正版" app rule page; **[TW-official]** = Taiwan community compilation of official-app boards (Bahamut 官方狼人殺 board); **[common]** = widely repeated community practice, not in an official text; **[engine choice]** = the sources are silent or conflict, so this document picks a default and the implementer should keep it configurable.

## Identity

| Field | Value |
|---|---|
| EN name | Werewolf (Chinese-style "Lang Ren Sha"), also called Werewolf Killing. Not the same product as the French card game *The Werewolves of Miller's Hollow*, which is its ancestor. |
| 繁中 name(s) | 狼人殺 (HK / TW / CN). In Taiwan also 天黑請閉眼 (the name of the official-app board on Bahamut). TV segments that spread the game: 凹嗚狼人殺 (a segment of 八大綜合台《娛樂百分百》, Taiwan) and 狼人宮廷版 (a segment of TVB《娛樂大家》, Hong Kong). In-person play is 面殺, online/app play is 網殺. The moderator is 上帝 or 法官 (Cantonese write-ups also say MC / 主持). |
| Players | Classic: 6 to 12 players plus 1 human moderator. This app: 6 to 12 players, all human, no human moderator (app = moderator). |
| Best count | 12 is the competitive/official standard. 9 to 10 is the casual sweet spot with the 預言家 + 女巫 + 獵人 core. 6 and 7 are teaching sizes. The engine should prefer counts where wolves : gods : villagers is an even third (6 = 2/2/2, 9 = 3/3/3, 12 = 4/4/4) because the default win rule 屠邊 treats gods and villagers as two separate "edges". |
| Lineage | Mafia (Dimitry Davidoff, Moscow State University; Wikipedia gives 1986 as creation, Davidoff dates the first game to spring 1987) -> werewolf re-theme (Andrew Plotkin, 1997) -> *Les Loups-garous de Thiercelieux / The Werewolves of Miller's Hollow* (Philippe des Pallières and Hervé Marly, 2001; first published by des Pallières' own company Lui-même, now an Asmodee title; sheriff whose vote counts double, witch, hunter, seer) -> Chinese 狼人殺 (tabletop edition by 北京大魔王桌遊俱樂部: 2010 per zh / zh-yue Wikipedia, 2009 per Moegirl; IP bought in 2015 by 西安雲睿網絡科技, whose subsidiary 狼人殺（海南）文化傳媒有限公司 is the current publisher; official standard rules published 2017-06-02; the official app "狼人殺-官方正版" launched 2017, developed by that subsidiary and published/operated by NetEase, hence "網易狼人殺 / 官狼"). |
| Designer / publisher | Folk game with no single designer. Publisher as above. Role pool of the Chinese version is derived from Miller's Hollow plus many Chinese-added roles (守衛, 白癡/白痴, 狼王, 白狼王, 騎士 ...). |
| Physical components the app must replace | (1) Face-down role cards and the dealing. (2) The human moderator and his/her script ("天黑請閉眼 / 天亮請睜眼"). (3) Eyes-closed night plus hand gestures: number gestures for targets, thumb up/down for witch, seer and hunter answers. (4) Seat numbers 1..N. (5) Sheriff badge (警徽). (6) Vote counting (hand raises, 1.5 weight). (7) Timers for speeches. (8) Death bookkeeping and announcements in seat order. (9) Win adjudication. (10) Optional flip-up of cards on death/ability use (明牌局 reveals cards on death; 暗牌局 does not). |

## Roles

Teams: `wolf`; `good-god` (神 / 神職, "gods"); `good-villager` (平民 / 村民, "villagers"); `module` (not a dealt card). In win counting, gods and villagers are separate "edges" (see Scoring). The 白癡 counts as a god in the official 12-player board; some boards treat it as a villager (make this a flag).

| id | EN | 繁中 | team | ability (precise) | acts at night? when? |
|---|---|---|---|---|---|
| `werewolf` | Werewolf | 狼人 (小狼 / 普狼) | wolf | Night: all living wolves wake together (night 1 they learn who the other wolves are; per the 2017 official text, special wolves such as 狼王 / 白狼王 also signal their sub-role to teammates) and agree on exactly one kill target among any living player, including a fellow wolf or themself (自刀), or on no kill (空刀). Day: any wolf may self-explode (自爆) during the daytime phases: the wolf is revealed and removed, all remaining speeches and the day's exile vote are cancelled, and play goes to night. Exception: if the explode happens during the day-1 sheriff election (before the night-1 deaths have been announced), the moderator first announces last night's deaths, lets those players give last words and use death skills, and only then starts the night (zh-yue Wikipedia, Wikiversity, langrensha.net). NetEase official configs give a self-exploded wolf 30 s of "explode words" (狼人自爆30s遺言); face-to-face write-ups often send the table straight to night with no words. | Yes, every night. Second in the official order (after 守衛, before 女巫). |
| `villager` | Villager | 平民 / 村民 | good-villager | No ability. Speaks and votes by day. Never wakes at night. | No (the app must still fake-act, see App design notes). |
| `seer` | Seer | 預言家 | good-god | Each night picks one living player (engine: not self) and learns only the camp: good (金水) or wolf (查殺). Never learns the exact role. 狼王 and 白狼王 read as wolf. Re-checking the same player is usually not allowed (Moegirl) and is pointless in this role set; make it a flag, default forbid. | Yes, every night while alive. After 女巫 in the official order. |
| `witch` | Witch | 女巫 | good-god | Owns one antidote (解藥) and one poison (毒藥), each usable once per game. Antidote: only on tonight's wolf victim. She learns the victim only while the antidote is still unused (once used, she is told nothing). Poison: any living player; the target dies at dawn and cannot use a death trigger (a poisoned 獵人 / 狼王 cannot shoot). Official: at most one potion per night. Self-save of the antidote: official app boards = never; common house rule = first night only; rare = always. She may still use the poison on the night she is herself the wolf victim, because deaths resolve at dawn. | Yes, every night while alive and while any potion remains (fake-act when empty or dead). After 狼人 (needs the victim). |
| `hunter` | Hunter | 獵人 | good-god | Passive. When he dies by any cause except the witch's poison (and love-suicide in Cupid boards, out of scope), he may reveal and shoot one living player, or hold fire (壓槍). Triggers: wolf attack at night (NetEase: "當且僅當" killed by wolves or exiled), exile vote, a 狼王 shot (NetEase tip: may shoot). A 白狼王 blast is genuinely disputed: Moegirl and Wikiversity say he may shoot; langrensha.net (Caniculab app) says he may not; NetEase's "if and only if" wording omits it. Engine default yes, flag `hunterShootsOnBlast`. A shot victim can be any wolf; only a 狼王 chains (a shot 白狼王 has no skill, since his skill is explode-only). Official 12-player boards wake him every night just to show a thumb up (may shoot) or thumb down (poisoned, may not), so that nobody can tell who he is from the wake order. | Fake-wake / status screen every night (official: last in the order). |
| `guard` | Guard | 守衛 | good-god | Each night protects one living player (self allowed) or nobody (空守). A protected player cannot die from the wolf attack that night. Cannot protect the same player on two consecutive nights. Does NOT stop poison. If the same player is both protected and healed by the antidote the player still dies (同守同救, nicknamed 奶穿). | Yes, every night while alive. First in the official order (before 狼人). |
| `idiot` | Idiot | 白癡 / 白痴 (Aoo TV: 傻瓜) | good-god (flag: some boards = villager) | If voted out in the day exile vote, flips the card, is NOT exiled, stays alive, may keep speaking, but loses the right to vote for the rest of the game. Works once. Any other death (wolf attack, poison, hunter or wolf-king shot, 白狼王 blast) is an ordinary death with no flip. A flipped idiot is still alive and still counts as a living god for 屠邊; NetEase and langrensha.net both say the wolves must still knife him (追刀). Whether he can be exiled a second time is not stated anywhere official [engine choice: votable, and a second exile is an ordinary death]. Minority rules: he keeps his vote, or counts as dead after flipping (Moegirl; 凹嗚). | Night 1 only, to be confirmed by the moderator (fake for everyone else). |
| `wolf-king` | Wolf King | 狼王 (a.k.a. 狼槍, 毒狼, 黑狼王 in the self-explode-no-shot form) | wolf | A werewolf who, when eliminated by wolf knife (self-knife), exile or a hunter's shot, may shoot one living player (any camp). Does not shoot if poisoned. In the common "black wolf king" form a self-explode gives no shot (NetEase, Bahamut, Wikiversity, Moegirl); the 凹嗚 TV ruleset allows the shot on explode. As the last wolf he cannot shoot (the game is already over; Moegirl). When a 狼王 is on the board, hunter and wolf-king shots are announced without flipping the card. | Wakes with the wolves. |
| `white-wolf-king` | White Wolf King | 白狼王 | wolf | A werewolf who, ONLY when self-exploding by day, takes one living player with him (NetEase: "非自爆出局不得發動技能"). Any other death gives no skill. Cannot use the skill when he is the last wolf (Moegirl: counts as the wolves conceding; Wikiversity agrees), nor when he was poisoned the previous night and explodes during the day-1 sheriff election (Wikiversity). Last words around a blast are not settled by any official text: engine default = neither he nor the victim speaks (community practice: the explode forces night at once), flag `blastLastWords`; see Common variants. May self-knife. (Note: "白狼騎士" is a board name, not an alias.) | Wakes with the wolves. |
| `sheriff-badge` | Sheriff badge (module, not a card) | 警長 / 警徽 | module | An extra status held by one living player, elected on day 1 before the night's deaths are announced. Holder's vote counts 1.5 (some groups 2), speaks last each day, picks speaking direction, and "collects the vote" (歸票: tells the table where to vote; players may ignore it). On death by any cause the holder may pass the badge to a living player or tear it up (no sheriff afterwards). | No. |

Optional roles seen in the official app (騎士, 狼美人, 石像鬼, 惡靈騎士, 守墓人, 魔術師, 攝夢人, 丘比特, 盜賊, 野孩子, 禁言長老, 馴熊師, 隱狼) are out of scope for this module.

## Setup by player count

Every supported count 6 to 12 has at least one row. "Default" is what the app should preselect. Villager and god counts follow the Roles table. The row for 10 corrects an apparent typo on the NetEase page (it lists 3 villagers, which sums to 9; the 2017 official post lists 4). Witch self-save: every official text found (NetEase, all Bahamut official-app boards) says never; "first night" on the 6 to 8 rows below is an engine choice for casual boards that have no official version.

| Players | Wolves | Gods | Villagers | Win rule | Sheriff | Witch self-save (default) | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| 6 (default) | 2 `werewolf` | `seer`, `witch` | 2 | 屠城 | off | first night | common | Fastest teaching board. 屠邊 on 6 players ends after 2 kills, so keep 屠城. |
| 6 (alt) | 2 `werewolf` | `seer`, `hunter` | 2 | 屠城 | off | n/a | **official** (NetEase "6人明牌局") | Open-card: roles are revealed on death. Timers 60 s speech, 15 s vote, 60 s last words, 30 s explode word. A TW list and langrensha.net's 6-player page both use seer + guard instead of hunter (also 屠城). |
| 7 (default) | 2 `werewolf` | `seer`, `witch`, `hunter` | 2 | 屠城 | off | first night | common | |
| 7 (alt) | 1 `werewolf` + 1 `white-wolf-king` | `seer`, `witch`, `hunter`, `guard` | 1 | 屠邊 | off | never | TW-official ("生還者") | Very swingy; only 1 villager means the edge is one kill away. Offer as "hard". |
| 8 (default) | 3 `werewolf` | `seer`, `witch`, `hunter` | 2 | 屠城 | off | first night | common | 屠城 is the usual casual rule for 3 wolves vs 2 villagers + 3 gods. |
| 8 (alt) | 2 `werewolf` | `seer`, `witch`, `hunter` | 3 | 屠城 | off | first night | common | Easier for the good side. TW-official 8-player boards (諸神黃昏, 末日狂徒) need roles out of scope. |
| 9 (default) | 3 `werewolf` | `seer`, `witch`, `hunter` | 3 | 屠邊 (toggle 屠城 for beginners) | optional (off by default) | never (TW-official "9人標準" says 全程不可自救; CN community pages suggest first-night self-save for 9: offer as toggle) | TW-official ("9人標準", night order 狼→巫→預→獵) and the usual 3/3/3 | Beginner groups often use 屠城, because 屠邊 favors wolves on this small board (langrensha.net agrees). Variant 守衛局: swap 女巫 for 守衛. |
| 10 (default) | 3 `werewolf` | `seer`, `witch`, `hunter` | 4 | 屠邊 | on | never (NetEase official text: 女巫不可自救); first night is used on some TW 10-player boards (e.g. the 10-player 狼王魔術師 variant) | **official** (2017 post; NetEase "10人速推局") | NetEase timers: 15 s sheriff opt-in, 60 s speech, 90 s 警長發言, 15 s vote, 60 s last words, 30 s explode word. |
| 10 (alt) | 3 `werewolf` | `seer`, `witch`, `hunter`, `idiot` | 3 | 屠邊 | on | first night | TW-common (12-player board minus one villager and one wolf) | 4 gods vs 3 villagers: the villager edge is only 3 kills. A guard can replace the idiot. |
| 11 (default) | 4 `werewolf` | `seer`, `witch`, `hunter`, `idiot` | 3 | 屠邊 | on | never | common (no official 11 found) | Quoted as the "standard" 11 in 87G, a Chinese game-news site. Alt: 3 wolves + same gods + 4 villagers (easier for good); alt: swap 白癡 for 守衛. |
| 12 (default) | 4 `werewolf` | `seer`, `witch`, `hunter`, `idiot` | 4 | 屠邊 | on | never | **official** (2017 post; NetEase "12人標準場"; the competitive standard) | NetEase timers: 15 s opt-in, 120 s speech, 150 s 警長發言, 15 s vote, 120 s last words, 30 s explode word. "警長發言" is read here as the elected sheriff's own longer day speech (he sums up and 歸票); the page does not give a separate time for campaign speeches, so the engine uses the normal speech time for them [interpretation]. |
| 12 (alt A) | 1 `wolf-king` + 3 `werewolf` | `seer`, `witch`, `hunter`, `guard` | 4 | 屠邊 | on | never | **official** ("狼王守衛" / "進階場") | |
| 12 (alt B) | 1 `white-wolf-king` + 3 `werewolf` | `seer`, `witch`, `hunter`, `guard` | 4 | 屠邊 | on | never | **official** ("白狼王守衛") | |
| 12 (alt C) | 4 `werewolf` | `seer`, `witch`, `guard`, `idiot` | 4 | 屠邊 | on | never | TW-official ("預女守白") | No hunter. |

Recommended default win rule by size: 6 to 8 = 屠城, 9 = 屠邊 with a visible "beginner: 屠城" toggle, 10 to 12 = 屠邊. Wolves are 1/3 of the table in the even-thirds boards (6, 9, 12), which is the design intent of 屠邊. No simulation was run; balance statements here are from community text, not from data.

Validation the lobby must do: wolves >= 1; at least one god and one villager when the win rule is 屠邊 (otherwise the edge is already empty at the start); total = player count; at most one of each unique role (`seer`, `witch`, `hunter`, `guard`, `idiot`, `wolf-king`, `white-wolf-king`).

## Procedure

Legend: PUBLIC = shown to everyone (shared screen / host speaker). PRIVATE = only on that player's phone. "Sim" = all players act at the same time. "Seq" = one at a time.

0. **Lobby and config (host).** The host picks N, the preset and the toggles. PUBLIC: role list of the board (the composition is public knowledge in this game) and the toggles. Seat order 1..N is fixed here and must match how people sit in the circle, because speaking order and PK order depend on seats. No timer.
1. **Deal (Sim, PRIVATE).** Each phone shows its own card behind a hold-to-view control and waits for an "I have seen it" tap. Do not show wolf teammates yet. PUBLIC: only "n of N ready".
2. **Night N (N = 1 first).** All phones go to the night screen. Steps and who learns what are in "Night order". Fixed total duration, with decoys for every player. PRIVATE throughout. Timer per step (suggested 30 to 45 s; wolves 60 s).
3. **Dawn, day 1 only, if the sheriff module is on: sheriff election.** It happens BEFORE the night's deaths are announced, so the players who died last night still take part (they may run and may vote) and can even win the badge.
   1. Opt-in window (official 15 s in the app; face-to-face, candidates raise a hand while eyes are still closed). Sim, PRIVATE tap, results then PUBLIC. Candidates are 警上; everyone else is 警下.
   2. Candidates speak Seq, PUBLIC. Official 2017 order: by seat number, ascending if the last digit of the current clock minute is odd, descending if even (單順雙逆); Wikiversity and zh-yue Wikipedia instead have the moderator pick a random starting candidate. Engine: random bit for direction. Speech length: the normal speech time for the board (60 s / 120 s) [interpretation, see Setup]. Wolves may self-explode at any moment in this step, including the sheriff PK (official 2017).
   3. Withdrawal (退水): a candidate may withdraw during the speeches or in a short window afterward (Wikiversity: about a 3 s countdown). A withdrawn candidate cannot vote, including in the sheriff PK (official 2017).
   4. Vote (Sim, then PUBLIC tally; face-to-face this vote is cast with eyes closed): only players who never stood for election may vote (the "警下" voters). Candidates and withdrawn players do not vote. Abstaining is allowed.
   5. Results: highest tally is sheriff. Tie among 2 or more: the tied candidates give a PK speech and vote again among them only, then a second tie means no badge for the whole game. PK voters: the original 警下 voters only (Wikiversity: withdrawn candidates and first-round losers have no vote; the official text only says withdrawn players still cannot vote). One candidate at opt-in = elected without speeches or vote. Only one candidate left after withdrawals = elected. No candidate = no badge. All candidates withdraw = no badge. Nobody casts a vote (all abstain) = no badge (official 2017, zh-yue Wikipedia). If every player stood: all still speak and may withdraw; exactly one left = elected, otherwise no badge (official 2017).
4. **Death announcement (PUBLIC).** App states who died, sorted by ascending seat number (not by order of death), with no cause; or announces a peaceful night (平安夜). The app must not tell anyone privately at night that they will die (the witch is the only player who sees the victim).
5. **Death triggers (Seq, ascending seat).** For each newly dead player, in this default order: last words (step 6), then the shot if the player is a `hunter` / `wolf-king` that is allowed to shoot, then badge hand-over if the dead player was the sheriff. Shot decisions are PRIVATE until confirmed and then PUBLIC. A shot victim triggers the same sequence (chain). Win check after every death batch (see Voting & resolution). Order of "last words" versus "shot" is an engine choice; the sources disagree (see Common variants).
6. **Last words (PUBLIC, Seq, official 60 to 120 s by size).** Who gets them: players exiled by vote and players who die by day; night deaths only on night 1 (any number of them, any cause, poison included); night 2 onward: none (NetEase configs; langrensha.net). A self-exploded wolf gets 30 s in NetEase configs. Shot victims: NetEase says every player who dies by day has last words, and langrensha.net says a daytime death of any kind has them, so a hunter / 狼王 shot fired during the day (including the dawn shot of a hunter killed on night 2+) gives the victim last words [default; flag `shotVictimLastWords` = day|inherit, where "inherit" follows the shooter's own timing, as the Wikiversity glossary implies]. 白狼王 blast: default neither speaks (see Roles; flag `blastLastWords`). Dead players afterwards say nothing.
7. **Day discussion (Seq, PUBLIC).** Every living player speaks once (official 60 to 120 s). Speaking order: with a sheriff, the sheriff picks the direction and speaks last (official 2017: the sheriff may not speak first). With no sheriff, start next to the dead player (Moegirl, hupu: 死左 / 死右) or at a random seat chosen by the moderator (zh-yue Wikipedia); engine: next to the dead player, random seat on a peaceful night, random direction [engine choice]. The "單順雙逆" clock rule in the 2017 official text is for the sheriff-candidate speeches (step 3.2), not for day discussion. A flipped idiot still speaks. Any wolf may self-explode here.
8. **Exile vote (Sim commit, PUBLIC reveal).** All living players except a flipped idiot vote for one living player or abstain (official 15 s). Sheriff vote = 1.5. Resolve using the algorithm in "Voting & resolution".
9. **Resolution of the vote.** Exiled player: apply the idiot rule; otherwise they die; then last words, shot, badge, win check. Tie after PK or no votes: peaceful day, nobody is exiled, go to night.
10. **Loop.** Go to night N+1. Repeat steps 2, 4 to 9 (no election after day 1, except under the double-explode variant, where an election paused by an explode on day 1 resumes on day 2 before that dawn's deaths are announced).
11. **Game end.** As soon as a win condition is met (checked as in "Scoring"), stop everything, skip any pending trigger, and PUBLICLY reveal all roles with a night-by-night timeline.

Self-explode interrupts at any time during steps 3.2 to 3.5 (sheriff election including its PK), 6 and 7 (and exile-PK speeches where allowed). Effects: the wolf dies; 白狼王 takes its target; the explode words (30 s, NetEase) if enabled; if the explode happens during the sheriff election the badge is lost (official 2017, "single explode swallows the badge"); then:
- **Explode during the day-1 sheriff election (deaths not yet announced):** the election ends; the moderator announces last night's deaths, the night-1 dead give last words and use death skills (hunter shot, badge does not exist), win check, then night 2 (zh-yue Wikipedia, langrensha.net, Wikiversity).
- **Double-explode variant (TW 12-player compilations, Wikiversity):** the first explode only pauses the election: announce deaths, last words, night. On day 2, before that dawn's deaths are announced, the election resumes directly at the withdrawal step and goes to the vote (the day-1 candidate list carries over). A second explode then destroys the badge; deaths are announced with no last words and play goes to night 3.
- **Explode at any later point of the day:** remaining speeches and the exile vote are cancelled; go to night.

## Night order

**Standard order [official 2017 post, TW-official boards]:** (night-1-only specials omitted)

| # | Waker | Learns | Chooses |
|---|---|---|---|
| 1 | `guard` | Who he protected last night (to enforce the rule) | One living player (self allowed) or nobody; not the same player as last night |
| 2 | `werewolf` (incl. `wolf-king`, `white-wolf-king`) | Night 1: who the other wolves are, and which of them is the 狼王 / 白狼王 (official 2017: special wolves signal by gesture). Later: living wolves | One kill target (any living player, incl. wolves) or none; wolves must agree |
| 3 | `witch` | Tonight's victim (if the antidote is unused) | Antidote on the victim (subject to self-save rule) or poison on any living player or nothing; at most one potion tonight |
| 4 | `seer` | Good or wolf for the chosen player | One living player |
| 5 | `hunter` | Whether he may shoot if he dies (thumb up) or not (thumb down, poisoned) | Nothing |
| 6 | `idiot` | Night 1 only: confirmation of identity | Nothing |

Without a guard the order is simply wolves -> witch -> seer -> hunter (-> idiot on night 1). The official full-role order also places 狼美人 and 隱狼 between wolves and witch, and 馴熊師 and 禁言長老 between seer and hunter. The 2017 text also says first-night-only steps are faked (called out loud) even when nobody holds that card, which is the official basis for the anti-tell decoys below.

**Hard constraint:** only the witch depends on another waker (she needs the wolf target). Everything else is chosen independently and resolved together at dawn, so the order is cosmetic and only matters for anti-tell design. The guard acts before the wolves in the official order but does not see the wolf target.

**Alternatives groups use:**
- Wolves -> seer -> guard -> witch -> hunter (Taiwan beginner write-ups).
- Wolves -> witch -> seer -> hunter (the usual 12-player 預女獵白 and 9-player boards).
- Moegirl's generic flow: wolves -> seer -> witch.
- Miller's Hollow original: Thief and Cupid (and Lovers) on night 1, then wolves (the Little Girl may peek), seer, witch, per the fan transcription cited below; secondary write-ups differ on whether the seer wakes before or after the wolves. Not outcome-relevant here.
- Some TW boards add a "hunter night gun" step where the moderator tells the hunter during the night whether he may shoot, then he claims the shot the next day before leaving the table.

**Dawn resolution (all effects simultaneous)** is specified in the next section.

## Voting & resolution

### Night resolution (exact)

Inputs: `attacked` (wolf target or none), `guarded` (guard target or none), `saved` (antidote target, must equal `attacked` or none), `poisoned` (poison target or none).

```
G = (attacked != none) and (attacked == guarded)
S = (attacked != none) and (attacked == saved)
wolfDies    = (attacked != none) and (G == S)     # unprotected+unhealed OR protected+healed (奶穿)
poisonDies  = (poisoned != none)                  # guard and antidote never stop poison
deaths      = {attacked if wolfDies} U {poisoned if poisonDies}
cause[p]    = 'poison' if p == poisoned else 'wolf'    # poison wins for trigger purposes
```

Consequences: protected only = survives; healed only = survives; protected AND healed = dies; poisoned = dies regardless; poisoned AND attacked on the same player = dies with cause poison (a hunter in that state cannot shoot). If both potions on one night were allowed (variant), the poison still kills a healed player. All night deaths are applied at the same moment at dawn.

### Exile vote (exact)

1. Eligible voters: living players, minus a flipped idiot (NetEase, zh-yue Wikipedia). Each ballot is one living player or an abstain (official 2017: abstaining is allowed in every vote). Candidates: any living player including the flipped idiot (he has no second immunity) [engine choice; no official text covers a second vote on him].
2. Weight in integer halves: 2 per voter, 3 for the sheriff (a 1.5 vote). Using integers avoids float ties.
3. Tally. Highest weight wins; if the maximum is 0 (everyone abstained) nobody is exiled.
4. Unique maximum: that player is exiled.
5. Tie for the maximum between 2 or more players: PK. Each tied player gives a PK speech (Seq, PUBLIC). Then a second vote among only the tied players. Voters are all eligible voters EXCEPT the tied players themselves (so a tied sheriff cannot vote; an untied sheriff still counts 1.5). Abstain is allowed.
6. Second tie or all abstain: peaceful day (平安日). Nobody is exiled and play goes straight to night.
7. Exiled player processing:
   - If `idiot` and not yet flipped: flip, stay alive, lose vote permanently. The day's vote is over, no further exile; the idiot gets no last words. If the idiot held the badge, pass or tear it at once (engine choice; sources are silent).
   - Otherwise the player dies (cause `exile`), then last words, then shot if hunter or wolf king, then badge if sheriff.

### Death triggers and chains

```
process(deaths):
    mark all in `deaths` dead at once
    if gameOver(): stop (no triggers fire)                  # win check BEFORE triggers
    for p in sorted(deaths by seat):
        last words if eligible
        if p can shoot and p.role in {hunter, wolf-king} (cause != poison, not self-explode for wolf-king):
            target = p.choice (a living player) or hold fire
            if target: process({target})                    # recursion: chain
        if p is sheriff: pass or tear the badge
    if gameOver(): stop
```

- Poison blocks the shot; a lover-suicide also would, but Cupid is out of scope.
- A 白狼王 blast resolves as: the wolf dies and the target dies together, then the win check, then (default) last words of neither, then the target's own death skill (a hunter target may shoot by default, flag `hunterShootsOnBlast`). If the 白狼王 is the last wolf, the blast does not fire at all and good wins (Moegirl, Wikiversity).
- A shot victim's last words follow `shotVictimLastWords` (default: a shot fired by day gives the victim last words; see Procedure step 6).
- Simultaneous shooters (for example a hunter killed by wolves and a self-knifed 狼王 dying on the same night): shots resolve in ascending seat order; each shot victim may in turn be a shooter.

### Sheriff mechanics inside voting
Sheriff: 1.5 vote in the exile vote and in PK votes where he is not tied. Not used in the sheriff election itself. He speaks last in each day's discussion and picks the direction: 警左 / 警右 (start at the first living player on his left, going clockwise, or on his right, going counter-clockwise) when the night was peaceful or had two or more deaths; 死左 / 死右 (same, but around the single dead player) when exactly one player died. Badge on death: pass to a living player or tear (always allowed, for any cause, even without last words).

## Scoring & win conditions

There are no points inside one game; the outcome is wolves or good. Check after every batch of deaths (night resolution, exile, each shot, each self-explode) and again at the start of each phase.

- **Good win:** all wolves are dead (any wolf subtype counts).
- **Wolves win, 屠邊 (official for 9+ and all 12-player boards):** all gods dead OR all villagers dead. Gods = `seer`, `witch`, `hunter`, `guard` and, by default, `idiot` (a flipped idiot counts as a living god). Villagers = `villager`. The sheriff badge counts for nothing.
- **Wolves win, 屠城 (official 6-player board; common for 6 to 8 and beginner 9):** all gods AND all villagers dead.
- **Both conditions true at once (at night):** wolves win. This is the "狼刀在先 / 狼刀優先" ruling stated by Moegirl, Wikiversity and zh-yue Wikipedia: if the wolf kill actually lands on the last god or last villager (not guarded, not healed), wolves win even if the last wolf is poisoned the same night; a face-to-face moderator may end the night at once. The win check also runs before triggers, so a hunter who dies as the last god cannot shoot and wolves win (Moegirl lists "last god in a 屠邊 game" among the no-shot cases). If the last wolf is exiled or killed, good wins and a dying 狼王 cannot shoot (Moegirl). Moegirl adds that when several camps qualify, the usual priority is wolves at night and good by day. No official text states the priority; keep it a flag, default wolves-first at night.
- **Last wolf is a 白狼王 who self-explodes:** he cannot take a target, wolves have no living member, good wins (Moegirl: treated as the wolves conceding, 交牌; Wikiversity agrees). Moegirl notes the analogous 狼美人 case is disputed between boards, so keep a flag, default good wins.
- **Parity win (wolves >= good) is NOT official** in this lineage (it is the Mafia style; Miller's Hollow itself ends when only one side is left). Offer as an optional variant only. Moegirl records a 屠城 speed-up some groups use: wolves win once living good < living wolves, or at 1 good vs 1 wolf.
- **1 wolf vs 1 good player:** the day vote ties, so it ends at night unless wolves abstain; this is expected.
- **Multi-round / series:** not defined by any source. Suggested: track each human's wins across games with role shuffles; show a per-player tally (win = 1 point for the winning camp, plus a counter of times as wolf), and let the group play first to N wins. Keep it outside the rules engine.

## Edge cases an engine must handle

Night:
- Wolves attack a player who is both guarded and healed: the player dies (奶穿). Hunter in that state CAN shoot (cause is wolf, not poison).
- Wolves attack a guarded player who is not healed: survives; announcement is a peaceful night if nobody else died. The guard and witch learn nothing extra at dawn.
- Witch heals an unguarded victim: survives.
- Witch poisons the guard's protected player: the player dies (poison ignores the guard, 毒穿).
- Witch is the wolf victim and self-save is not allowed: she sees she is the victim, the antidote option is disabled, she may still use the poison and it still kills.
- Witch is told the victim only while the antidote is unused; after it is used she gets no information. She still wakes (fake) every night.
- No kill (空刀) or wolves disagree and the rule resolves to no kill: the witch is told nobody was attacked and cannot use the antidote; she may still poison.
- Self-knife (自刀): a wolf is the victim; the witch may heal him; a guard may protect him.
- Guard protects himself; guard skips a night (空守): the no-repeat rule only blocks consecutive same-target picks, so a skip frees him next night (engine choice; stated rule is only "not the same player two nights in a row").
- Guard is dead: nobody is protected. Dead roles still fake-act (anti-tell).
- Seer checks a wolf-king or white-wolf-king: result wolf. Seer cannot check himself or a dead player.
- Two potions on the same night are rejected by default (flag allows).
- All wolves AFK at night: treat as no kill.

Day:
- Night-1 victims vote and run in the sheriff election before the announcement. If a night-1 victim wins the badge, he dies at the announcement and must hand over or tear it.
- A night-1 victim who is a wolf may still self-explode during the election (nobody knows he is dead yet). A 白狼王 poisoned on night 1 who explodes on the sheriff stage cannot take anyone (Wikiversity).
- Wolf self-explode in the sheriff election: badge lost (official "single explode"); then announce night-1 deaths, last words and death skills, then night. Alt rule (double explode): the election pauses and resumes on day 2 at the withdrawal step with the same candidate list; a second explode destroys the badge.
- Sheriff vote where every eligible voter abstains: no badge.
- Self-explode on the same tick as a vote button press: first accepted event wins; once the vote has started, deny the explode (engine choice; sources allow explode "any time in the day" without defining the cutoff). Some rulesets (zh-yue Wikipedia) forbid explode during PK speeches; flag it.
- Two wolves click explode at the same moment: only one resolves; the day ends at once.
- All players abstain: nobody exiled, no PK.
- Three-way tie: all three go to PK.
- Sheriff is in the PK: he cannot vote in the PK (the tied players never vote).
- Exiled idiot flips: no exile, no last words (langrensha.net: a flip is not an exile), vote rights gone, flag set; he still speaks. If later voted out again: dies normally [engine choice; no official text].
- Idiot as sheriff when flipped: must pass or tear the badge (engine choice).
- Exiled hunter: last words then shot (default); if the shot kills a 狼王 that is allowed to shoot, the 狼王 shoots too.
- Poisoned hunter or 狼王: no shot; announcement shows only the death.
- Hunter dies as the last god: no shot (win check first).
- Hunter dies the same dawn as a night-2+ death: no last words, but the shot happens.
- Hunter shot victim: dies at once. Default: the shot is fired by day, so the victim gets last words (NetEase "all daytime deaths have last words"); alt `inherit`: the victim only speaks if the shooter would have (Wikiversity glossary counts a night-dead shooter's victim as a night death).
- Sheriff dies at night 2+: no last words but the badge decision still happens.
- Multiple night deaths are announced in ascending seat order regardless of cause.
- Dead players cannot talk, vote, point or react; the app must show them a read-only screen.
- Direction of speaking with dead seats: skip dead seats; sheriff last; flipped idiot included.
- A wolf who self-explodes while sheriff: badge still passes (official: any cause).
- Game ends between a shot and its chain: stop immediately; do not run later triggers.

Win-check races:
- Wolves kill the last villager while the witch poisons the last wolf in the same night: both conditions hold, wolves win (priority flag).
- The idiot flips on the exile vote: nobody dies, so no win check fires and no other player is exiled that day.
- Last wolf dies by the hunter's shot while the hunter was the last god and was exiled: wolves already won before triggers; wolves win (default flag).

## Common variants

- Witch self-save: never = NetEase official boards, Wikiversity default, every Bahamut official-app board including the 7- and 9-player ones [popular in CN, TW, HK for 12 players]; first night only = common for 9 to 10 players, used for a long time on the 凹嗚 TV format (Wikiversity) and recommended by CN community pages for 9 players [very popular]; always = rare (Moegirl: "some specific rules").
- Witch may use both potions the same night: Miller's Hollow original allows it; the Chinese standard forbids it [Chinese groups: forbidden].
- Same guard, same save (奶穿): dies in the official and most boards [standard]. A minority of home groups let the target live.
- Win rule: 屠邊 (9+ standard) vs 屠城 (6 to 8, beginners) vs parity (Mafia style, rare in 狼人殺).
- Idiot counted as villager instead of god in some boards; flipped idiot treated as dead for 屠邊 by the Aoo TV ruleset (wolves need not re-kill him; Wikiversity), alive in the official format (NetEase: the wolves must still knife him); some rules let a flipped idiot keep his vote (Moegirl).
- 狼王: shoots on self-explode ("狼王" in Aoo) versus no shot ("黑狼王"). With a 狼王 on the board hunters shoot without flipping.
- Sheriff: 1.5 votes (standard) vs 2 votes; single-explode swallow (official app, 10-player TW boards) vs double-explode swallow (TW 12-player compilations) [TW popular]; sheriff passes badge or tears it; no sheriff for 8 or fewer players (Wikipedia says 10+ may have one).
- Last words: night 1 only (official) vs night 1 plus any single-death night (some groups) vs all deaths (casual groups) vs no last words for poisoned players (one wiki variant).
- Hunter timing: hunter shot first then last words (some sites) vs last words then shot then badge (another official-sounding source). Pick one and document it for players.
- Hunter shot by a 白狼王 blast: may shoot (Moegirl, Wikiversity) vs may not (langrensha.net / Caniculab app). Default may shoot.
- Last words of a shot victim: daytime death so yes (NetEase wording, langrensha.net) vs inherits the shooter's timing (Wikiversity glossary). Default yes.
- Last words around a 白狼王 blast: neither speaks (community practice: explode forces night) vs both speak (literal reading of NetEase's 30 s explode words and "all daytime deaths have last words"). Default neither.
- Self-explode window: any time in the day incl. sheriff PK (official 2017) vs only during the exploding wolf's own speech (some rules, zh-yue Wikipedia) vs not during exile-PK speeches (zh-yue Wikipedia).
- Sheriff PK voters: original 警下 voters only (Wikiversity; official text bars withdrawn players) vs everyone not in the PK, including first-round losers (Moegirl; Moegirl even lets withdrawn players vote, which contradicts the official text).
- All players stand for sheriff: everyone still speaks and may withdraw, one left = elected (official 2017) vs skip straight to "no badge" (Moegirl).
- Sheriff-candidate speaking order: seat order with direction by clock parity (official 2017) vs a random starting candidate (Wikiversity, zh-yue Wikipedia).
- Exile ties: PK then 平安日 (official) vs a third speech-and-vote round before 平安日 vs no PK at all, a first tie is 平安日 (both Moegirl).
- No kill on night 1 (wolves only meet): some rules (Moegirl).
- Seer may re-check the same player: usually not allowed (Moegirl); allowed only in boards with role-changing roles.
- Vote openness: open "票型" (who voted whom) is standard in 狼人殺 inference; closed-eye hand vote is used for the sheriff election.
- Open-card (明牌) vs hidden-card (暗牌) on death: the official 6-player board is open-card; all 10 and 12-player boards are hidden.
- Eyes-closed night with gestures (official) vs masks and silence with the moderator noting roles while music plays (Taiwan community variant).
- Cantonese groups often add the TVB-style terms 金水, 銀水, 查殺, 上警, 退水, 悍跳 but play the same rules.
- Roles to add later (popular in CN): 騎士, 狼美人, 石像鬼, 守墓人, 魔術師, 攝夢人, 惡靈騎士, 丘比特/盜賊.

## App design notes

### How the app replaces the 上帝/法官

| Moderator duty | App mechanism |
|---|---|
| Hand out cards and remember them | Host phone is authoritative; deals roles privately; each client shows only its own card. |
| "天黑請閉眼" and wake order | Everyone sees the same night screen. Private action panels appear in the official order with a fixed total duration. Optional host-speaker narration in Cantonese (public only). |
| Read gestures | Taps on the player's own phone. No gestures and no eyes-closed rule needed. |
| Tell the witch the victim, the seer the camp, the hunter his status | Private panels. |
| Resolve the night | The guard/antidote equality (XNOR) formula in "Voting & resolution": the wolf victim dies when guarded == healed. |
| Announce deaths in seat order | Public screen plus optional TTS, sorted by seat. |
| Run the sheriff election | State machine with opt-in, speech timer, withdrawal and voter filter. |
| Time speeches | Per-phase timer with a visible "speaking now" seat. |
| Count votes with 1.5 weight and PK | Commit-then-reveal ballots, integer weights. |
| Enforce silence for the dead | Read-only screen for dead players. |
| Adjudicate win | Automatic after each death batch, with the priority flags above. |

### What must stay private
Each player's role; wolf teammates (and the wolf kill proposal); the guard's choice; the witch's potion status and what she was shown; the seer's results (the seer may claim anything in speech); the hunter's can-shoot flag; and whether anyone is dying until the dawn announcement.

### What is public
The board composition; the alive list and seat order; every vote and tally (票型); deaths at dawn (no cause); sheriff election results; idiot flips; hunter and 狼王 shots; the timer; "n of N ready" counters (the same for everyone, never "who").

### What needs a narrator (optional)
Nothing mechanical. Cantonese narration from the host phone is atmosphere and pacing only, and must contain no secrets. Draft lines for review by a native speaker:
- Night start: 「天黑請閉眼」 (casual: 「天黑喇，大家閉埋眼」; zh-yue Wikipedia's MC script uses 「天黑，所有人闔埋眼」).
- Role calls (only if a narrated eyes-closed mode is offered): 「狼人請開眼」 / 「狼人請閉眼」 (HK usage favours 開眼 over 睜眼).
- Day start: 「天光喇，請大家開眼」 (zh-yue Wikipedia: 「天光，所有玩家可以醒啦」; an HK lifestyle guide: 「天光請開眼」).
- Result: 「昨晚係平安夜」 or 「昨晚 X 號、Y 號死咗」.
- Phases: 「請上警嘅玩家舉手」, 「請開始投票」, 「平票，請 X 號同 Y 號 PK 發言」, 「今日係平安日」.
Platform facts (MDN browser-compat-data 8.1.4, 2026-10-01): Web Speech `speechSynthesis` is in iOS Safari since 7; iOS ships a zh-HK voice (Sin-Ji), but check `getVoices()` at runtime. iOS Safari needs a user gesture before speech or audio starts. Screen Wake Lock API: iOS Safari 16.4+ in the browser tab, but it did not work in Home Screen (standalone) web apps until iOS 18.4 (WebKit bug 254545), so a PWA-installed host on iOS 16.4 to 18.3 needs a fallback (keep the page in Safari, or a silent looping video).

### Fully automatable on phones
Dealing, all night actions, resolution, death sorting, speaking order, timers, badge handling, vote tally with PK and tie rules, idiot flip, hunter and 狼王 prompts, chain resolution, win check, reveal and game log. Not automatable: the talking and lying itself, and eye-contact tells.

### Anti-tell concerns
- Identical night duration for every player, including dead players, used-up roles (empty witch), villagers, and unique roles that are no longer alive. Give them a decoy "pick someone" panel with the same shape, delay and tap count. The official 12-player flow wakes 獵人 and 白癡 for the same reason, and a Cantonese moderator app broadcasts the same prompts after gods die to hide who is gone.
- Do not vibrate, ping or light up differently by role. Use dim night mode and discourage screen peeking (hold-to-view, auto-hide after a few seconds).
- Never message a victim at night. Never show the shot panel at dawn only to hunters: give every newly dead player a "final action" screen of the same duration (real for hunter and 狼王, decoy for others).
- Wolf coordination: show each wolf the teammates' live picks; default resolution = plurality of picks with random tie-break, with an option "must be unanimous else no kill". This is an engine choice; the physical game relies on gestures.
- The "self-explode" control: show the same-looking control to everybody and make it do nothing visible for non-wolves; hold-to-confirm.
- Dead players default to a public-info-only view (no role reveal) unless the group enables spectator reveal, because screens leak.
- Public ready counters must be aggregated.

### Host-moderator dashboard (redacted for a playing host)
Phase and day number; timer with pause, extend and skip; roster with alive/dead, connection status and seat; counts of who has acted (not who or what); force-advance for AFK players; replace or kick a player; public event log; toggle summary (locked after the start); end game; panic pause. The host is also a player, so the host phone holds all secrets in memory; the same "host can peek" trade-off as the other games applies and should be documented rather than engineered away. An optional "God view" is only for a non-playing human moderator.

### One shared phone (pass-the-phone)
Possible and common (an existing Cantonese moderator app does it, up to 12 players, though twelve people around one phone is cramped). Design: the phone circulates in seat order; each player sees "pass to seat k", taps to reveal a private panel, acts, taps done, the screen blanks. Order never depends on role. Because the witch needs the wolf kill, run two laps: lap 1 collects guard, wolf and seer picks (wolves picking in turn with visible earlier picks), lap 2 gives every player a 2-second decoy screen except the witch, who gets the real panel. Cost about 8 s per player on lap 1 and 3 s on lap 2: roughly 2 minutes a night at 12 players. Alternative for groups that like the classic feel: eyes-closed narrated night with the phone in the middle, which relies on honesty and on masking tap noise.

### Rule toggles (suggested config schema)
`winRule` (edge|city), `sheriff` (on|off), `sheriffVote` (1.5|2), `badgeSwallow` (single|double), `sheriffPkVoters` (offstage|allButPk), `witchSelfSave` (never|first|always), `witchBothPotions` (false), `guardWitchStack` (die|live), `guardNoRepeat` (true), `seerRecheck` (false), `idiotIsGod` (true), `flippedIdiotAlive` (true), `flippedIdiotVotable` (true), `lastWords` (night1|night1+single|all), `shotVictimLastWords` (day|inherit), `blastLastWords` (none|both), `explodeWords` (30 s|0), `hunterOrder` (words-first|shot-first), `hunterShootsOnBlast` (true), `openCard` (false), `winPriority` (wolves|good), `lastWolfWhiteKingBlast` (false), `wolfDisagree` (plurality|unanimous|none), `selfExplodeWindow` (anyTimeDay|ownSpeech), `selfExplodeInExilePk` (false), `selfExplodeInVote` (false), `timers`. Suggested timers (from the official 10-player and 12-player configs, otherwise engineering guesses): sheriff opt-in 15 s, speech 60 s (12 players: 120 s), sheriff's own speech 90 s (12 players: 150 s), last words 60 s (12 players: 120 s), PK speech 60 s, vote 15 s, explode word 30 s, night step 30 to 45 s, wolves 60 s.

## Sources

Primary or near-primary (official posts and configs):
- https://www.gameres.com/753084.html (official standard rules, 2017-06-02: night order, sheriff, tie handling, presets)
- https://langrensha.163.com/wanfa/guize/2017/10/18/26899_719311.html (NetEase official app configs: presets, timers, last words, witch no self-save)

Rule detail (reputable community):
- https://zh.wikipedia.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA (roles, sheriff, publisher)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E9%81%8A%E6%88%B2%E8%A7%92%E8%89%B2/%E8%AD%A6%E9%95%B7 (sheriff election special cases, single and double explode)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E9%81%8A%E6%88%B2%E8%A7%92%E8%89%B2/%E5%A5%B3%E5%B7%AB (witch rules and house rules)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E9%81%8A%E6%88%B2%E8%A7%92%E8%89%B2/%E5%AE%88%E8%A1%9B (guard, 奶穿, 毒穿)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E9%81%8A%E6%88%B2%E8%A7%92%E8%89%B2/%E7%8D%B5%E4%BA%BA (hunter)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E9%81%8A%E6%88%B2%E8%A7%92%E8%89%B2/%E7%99%BD%E7%97%B4 (idiot)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E9%81%8A%E6%88%B2%E8%A7%92%E8%89%B2/%E7%8B%BC%E7%8E%8B (wolf king)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E6%9D%BF%E5%AD%90 (boards by count)
- https://forum.gamer.com.tw/C.php?bsn=37190&snA=992 (Bahamut compilation of TW official boards: night orders, 雙爆吞警徽, 9/7/8-player boards)
- https://www.iheima.com/article-316350.html (12-player 預女獵白 standard; PK and tie handling; first-night self-save claim)
- https://www.langrensha.net/strategy/2020120401.html (同守同救 and 同守同毒)
- https://www.langrensha.net/strategy/2023020901.html (hunter shot flow by cause)
- https://www.langrensha.net/strategy/2022072601.html (last-words rules)
- https://www.langrensha.net/strategy/2020101501.html (屠邊 vs 屠城)
- https://www.langrensha.net/strategy/2021092802.html (6-player board)
- https://m.ali213.net/wenda/131073.html (witch can poison on the night she is killed)
- https://m.hupu.com/bbs/44838679.html (organised rules: last words, speaking order)
- https://home.gamer.com.tw/artwork.php?sn=5216954 (TW flow, masks variant, double explode)
- https://vocus.cc/article/68a8347ffd89780001efbc41 (TW 9-player beginner setups; no win rule stated)
- https://andyventure.com/boardgame-langrensha/ (TW overview of roles and setups)
- https://www.233leyuan.com/post-detail/2067079834350256128 (community comments on simultaneous-win rulings; low authority)
- https://www.87g.com/lrs/61283.html (11-player configs; seen only as a search snippet, treat as low authority)

Added by the fact-check pass (independent of the sources above):
- https://zh.moegirl.org.cn/%E7%8B%BC%E4%BA%BA%E6%9D%80 (Moegirl: history 2009 / 2015 / 2017, roles, 狼刀優先, last-wolf 白狼王 and 狼王, hunter no-shot cases, sheriff special cases, exile-tie variants)
- https://zh-yue.wikipedia.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA (Cantonese Wikipedia: MC script, single and double explode procedure incl. death announcement after an explode, no explode in exile PK, all-abstain = no sheriff, TV segments)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E9%81%8A%E6%88%B2%E8%A7%92%E8%89%B2/%E7%99%BD%E7%8B%BC%E7%8E%8B (white wolf king: no skill as last wolf or if poisoned before a sheriff-stage explode)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E9%81%8A%E6%88%B2%E8%A7%92%E8%89%B2/%E7%8B%BC%E4%BA%BA (狼刀在先)
- https://zh.wikiversity.org/wiki/%E7%8B%BC%E4%BA%BA%E6%AE%BA/%E7%99%BC%E8%A8%80%E5%B8%B8%E7%94%A8%E8%A1%93%E8%AA%9E (glossary: 倒牌, 毒殺)
- https://www.langrensha.net/strategy/2022052001.html (all daytime deaths have last words)
- https://www.langrensha.net/strategy/2022051901.html (hunter cannot shoot when taken by 白狼王 or 狼美人)
- https://www.langrensha.net/strategy/2022110302.html (flipped idiot must still be knifed)
- https://www.langrensha.net/strategy/2021010502.html (9-player boards: 屠邊 favours wolves, sheriff optional, first-night self-save suggested)
- https://www.langrensha.net/strategy/2020121502.html (6-player board with seer + guard, 屠城)
- https://fr.wikipedia.org/wiki/Les_Loups-garous_de_Thiercelieux (first publisher Lui-même, Asmodee today)
- https://www.weekendhk.com/weekspecial/%e7%8b%bc%e4%ba%ba%e6%ae%ba-%e6%95%99%e5%ad%b8-%e9%81%8a%e6%88%b2-%e8%a7%92%e8%89%b2-js01-1209597/ (HK Cantonese moderator phrasing)
- MDN browser-compat-data 8.1.4 (`api.WakeLock`, `api.SpeechSynthesis`) for iOS version numbers

Lineage and ancestors:
- https://en.wikipedia.org/wiki/Mafia_(party_game) and https://en.wikipedia.org/wiki/The_Werewolves_of_Millers_Hollow
- https://www.deviantart.com/bintavivi/art/Werewolves-of-Miller-s-Hollow-Rules-283794845
- https://www.poly-ed.com/source-code/werewolves-of-millers-hollow-roles/ (witch may use both potions in Miller's Hollow)

Existing Cantonese moderator app (design reference):
- https://apps.apple.com/hk/app/%E7%8B%BC%E4%BA%BA%E6%AE%BAmc-%E5%BB%A3%E6%9D%B1%E8%A9%B1%E7%8B%BC%E4%BA%BA%E6%AE%BA%E4%B8%BB%E6%8C%81/id1526692596

Not used: the Asmodee rulebook PDFs (`images-cdn.asmodee.us/.../kg02_rules.pdf`, `kg03_rules.pdf`) were not readable because the host's TLS certificate had expired; the original Miller's Hollow facts above come from secondary sources. One Wikipedia sentence (four gods exiled on day 1 gives wolves an instant win) is not corroborated anywhere else and was left out.

### Open questions (for the orchestrator to decide)
1. Witch self-save default per count (every official text = never, now the default for 9 to 12; casual 6 to 8 rows default to first night as an engine choice).
2. Hunter timing: last words before the shot (used here) or shot before last words. No source found settles it.
3. Is self-explode allowed once voting has started or during exile-PK speeches? (Official 2017 explicitly allows it during the sheriff PK; zh-yue Wikipedia forbids it in exile PK.)
4. Flipped idiot who holds the badge: force hand-over (used here) or keep the badge without the vote. No source found.
5. ~~Last wolf is a 白狼王 who self-explodes~~: resolved, the blast does not fire (Moegirl and Wikiversity agree). Kept as a flag only.
6. Wolf kill disagreement in phone mode: plurality (used here), unanimity or no kill.
7. Simultaneous win priority: wolves first at night (used here) is stated by Moegirl, Wikiversity and zh-yue Wikipedia, but by no official text.
8. Whether the 9-player default should be 屠邊 (TW official) or 屠城 (beginner friendly).
9. Last words for a hunter's shot victim (default yes, by NetEase wording) and around a 白狼王 blast (default none, community practice). Ask the group which they are used to.
10. Hunter taken by a 白狼王 blast: may shoot (default) or not (langrensha.net).

## Verification

Adversarial fact-check pass, 2026-10-03 UTC. Method: re-read the two primary texts in full (the 2017-06-02 official standard-rules post on GameRes and the NetEase "狼人殺-官方正版" rule page) and checked every outcome-relevant claim against sources the first draft did not cite where possible: Moegirl (zh), Cantonese Wikipedia (zh-yue), un-cited Wikiversity pages (白狼王, 狼人, glossary), un-cited langrensha.net articles, French and English Wikipedia, and MDN browser-compat-data. The Bahamut compilation was re-read to check the paraphrase of the TW boards.

**Confirmed (no change needed):**
- Night order 守衛 → 狼人 → 女巫 → 預言家 → 獵人 → 白癡 (night 1 only), with the hunter woken every night for a thumb up / down (official 2017; Bahamut 7-, 8-, 9-player boards).
- Witch: one potion per night, poison blocks hunter / 狼王 shots, no self-save in every official text (NetEase, all Bahamut official boards); she learns the victim only while the antidote is unused (Moegirl, Wikiversity).
- Guard: may self-guard and may skip, no same target on consecutive nights, 同守同救 = death (奶穿), poison ignores the guard (毒穿) (official 2017, NetEase, Bahamut, Wikiversity, Moegirl).
- Exile vote: sheriff 1.5, abstain allowed, tie → PK speeches → only off-stage players vote → second tie = 平安日 (official 2017; Moegirl; zh-yue Wikipedia). Night deaths announced in ascending seat order (official 2017).
- Sheriff election before the night-1 announcement; only 警下 players vote; withdrawn players never vote; tie → PK → second tie = no badge; self-explode during the election (including its PK) = no badge under the official single-explode rule; badge may be passed or torn on any death (official 2017; Wikiversity; zh-yue Wikipedia).
- Last words: night 1 and daytime deaths only; 30 s explode words; timers and team sizes of the NetEase 6-, 10- and 12-player configs; 屠城 on the 6-player board, 屠邊 on 10 and 12; 10-player NetEase page sums to 9 (typo), 2017 post gives 3/3/4.
- 12-player presets 預女獵白, 狼王守衛, 白狼王守衛 (official 2017 + NetEase) and TW boards 預女守白, 9人標準, 7人生還者 (Bahamut).
- 狼王: no shot when poisoned or self-exploding (NetEase, Bahamut, Wikiversity, Moegirl); shots announced without flipping when a 狼王 is on the board. 白狼王: skill only on a daytime self-explode.
- 狼刀優先 at night (Moegirl, Wikiversity, zh-yue Wikipedia); a hunter dying as the last god cannot shoot (Moegirl).
- Lineage dates (Davidoff 1986/1987, Plotkin 1997, des Pallières and Marly 2001); TVB 《娛樂大家》 狼人宮廷版 and 《娛樂百分百》 凹嗚狼人殺 segments (zh and zh-yue Wikipedia).

**Changed:**
1. Explode during the day-1 sheriff election: the draft said the night's death announcement and last words move to the next dawn. Wrong. Deaths are announced, last words and death skills happen, then night (zh-yue Wikipedia, Wikiversity, langrensha.net). Procedure and Roles rewritten; double-explode procedure detailed (resume at the withdrawal step, same candidate list).
2. Sheriff election: added "all eligible voters abstain → no badge" (official 2017, zh-yue Wikipedia), "one candidate left after withdrawals → elected", the official all-stood rule, and PK-voter detail. Candidate speaking order corrected from "random" to the official 單順雙逆 seat order (random start kept as the community variant). The draft had applied the clock rule to "last-words order" and day discussion, which the source does not say.
3. Shot-victim last words: the draft stated "time-of-death inheritance" as fact. NetEase says every daytime death has last words, and langrensha.net says any daytime death does, so the default is now "victim speaks" with inheritance as the flagged variant (Wikiversity glossary).
4. Internal contradiction fixed: Procedure step 6 listed the 白狼王 blast among deaths with last words while Roles said neither speaks. Now one flagged default (neither), with sources on both sides. Removed the unsourced claim that a self-exploded 白狼王 alone gets no explode words.
5. 白狼王 alias "狼騎" removed (unsupported; "白狼騎士" is a board name). Added: no skill as last wolf (now sourced: Moegirl and Wikiversity, Open question 5 resolved) and no skill when poisoned the night before and exploding on the sheriff stage (Wikiversity).
6. Hunter shot by a 白狼王 blast: documented the real split (Moegirl and Wikiversity yes, langrensha.net no, NetEase wording silent); clarified that only a 狼王 chains (a shot 白狼王 has no skill).
7. Witch self-save default for 9 players changed from "first night" to "never": the TW-official 9人標準 board the row cites says 全程不可自救. First night kept as a toggle and variant.
8. Wolves' night-1 info: they also learn which teammate is the 狼王 / 白狼王 (official 2017 "特殊身份狼人手勢示意").
9. Lineage: Chinese tabletop year is 2010 (zh / zh-yue Wikipedia) or 2009 (Moegirl), both shown; added the 2015 IP purchase and the NetEase publishing role; Miller's Hollow first publisher is Lui-même (fr Wikipedia), Asmodee today.
10. Flipped idiot: second exile marked as engine choice (no official text); NetEase / langrensha.net "wolves must still knife him" cited; minority rules added.
11. Seer re-check default set to forbid (Moegirl: usually not allowed).
12. "警長發言 90 s / 150 s" re-labelled as the sheriff's own day speech [interpretation]; campaign speeches use the normal speech time.
13. Platform version numbers added (none were given): speechSynthesis iOS Safari 7+, zh-HK Sin-Ji voice, Screen Wake Lock iOS Safari 16.4+ but broken in Home Screen web apps until 18.4 (browser-compat-data 8.1.4).
14. Common variants extended: explode window, sheriff PK voters, all-stood rule, candidate order, exile-tie variants, first-night no-kill, 屠城 speed-up, seer re-check, blast and shot-victim last words. Config schema extended with the matching flags.
15. App-design table called the night formula "XOR"; the formula (victim dies when guarded == healed) is an equality / XNOR. Wording fixed (the pseudo-code itself was right).

**Not verified (kept, flagged):** hunter last-words-vs-shot order and badge timing; idiot-as-sheriff on flip; "wolves → seer → guard → witch" as a TW beginner order; 87G's 11-player board; the original Miller's Hollow wake order (sources disagree on seer vs wolves); Miller's Hollow witch using both potions in one night; the Cantonese moderator app's 12-player pass-the-phone mode. Web search quota ran out partway through, so these got no independent check beyond the pages listed in Sources.
