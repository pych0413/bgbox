# 阿瓦隆 (`avalon`) — play-flow spec

> Rules source: `docs/research/avalon.md` (including its **Verification** section, which wins where it differs
> from the first draft: Oberon is seen by Merlin and reads Evil to the Lady, no card is shown before the shot, the
> Lady is recommended from 7 players, the fifth proposal is still voted on). UI text is Hong Kong Cantonese;
> everything else is English. Times in this repo are UTC.
> Files: `js/games/avalon/{game,script,ui,index}.js`, `style.css`. Tests: `tests/avalon.test.mjs`.
> QA pass 2026-10-03 UTC: every rule re-checked against the verified research (§9), framework hooks adopted (`blocking`,
> `@void-round`, `carry`, `defaults(n, prev, { singleDevice })`), backlog U1 / #8 / #10 / #20 / #3 applied.

## 1. At a glance

| | |
|---|---|
| Players | 5–10 seats (good/evil 3/2, 4/2, 4/3, 5/3, 6/3, 6/4) |
| Time | 30–45 min |
| Narration | `optional` — announcements only (the role list in play, the team, the vote tally, the quest pile, the Lady's use, the shot). Nothing in the game waits for the narrator |
| Single device | `full` — the phone goes seat to seat behind the shell's pass gate (see §4) |
| Banks | none |
| Components used | `Cover` (hold-to-peek cards), `PlayerPicker` (team, Lady, shot), `Timer`. `VotePanel` is not used: it votes *for a player*, Avalon votes approve / reject |
| Paper mode | none |
| Not implemented (on purpose) | Lancelot, Excalibur, Targeting, Plot / Loyalty cards (research: out of v1), a moderator host (the host seat is an ordinary player) |

**What the phones do.** Deal the role cards, show each seat exactly what its role knows behind a hold-to-peek cover
(no eyes-closed ritual), rotate the leader by seat, let the leader name the team on their phone, collect the
approve / reject votes in secret and show them all at once with names, collect the success / fail cards and show the
shuffled pile as counts, run the quest track and the rejection track, run the Lady of the Lake, let the Assassin
name Merlin, and finally explain the whole game including what nobody could see live.

**What happens at the table.** All the talking: proposing and defending teams, accusing, lying about what the Lady
showed, keeping a straight face, the evil team murmuring before the shot.

**Anti-tell in one paragraph.** The identity card has one layout for every role and the same fixed window for every
seat (servants look at a card too). The quest screen is the same two tiles for good and evil — good's 「失敗」 tile is
inert but looks and sounds identical — and the quest result only ever shows the shuffled pile as counts. The
assassination screen is the same picker on every phone and only the Assassin's confirm is real; a shared phone's pass
gate calls 「刺客」, never a name. Every seat has a legal action at every one of those steps (asserted in the tests), and
`engine.blocking` keeps those decoy taps out of the room's 「斷咗線」 detection. The 💡 hint (§3.11) never depends on the
role, so even the hint sheet reads the same for good and evil.

## 2. Setup

### Config (all keys optional; `defaults(n, prev, env)` fills them)

| key | type | default | meaning |
|---|---|---|---|
| `preset` | select | `'recommended'` | `recommended` 推薦配置（跟人數）· `plain` 基本版（新手）· `alt` 另一款配置 · `custom` 自訂 |
| `roles` | roles (map) | `{percival:1, morgana:1, mordred:0, oberon:0}` | only edited (and shown) on `custom`: counts of the four optional roles. Servants and minions are auto. Merlin and the Assassin are always dealt |
| `lady` | select | `'auto'` | `auto` = on from 7 players · `on` · `off` |
| `oberonSeenByMerlin` | bool | `true` | official ruling. `false` = Oberon is invisible to Merlin too (shown only when Oberon is in the deck) |
| `oberonReadsGoodToLady` | bool | `false` | official: the Lady reads Evil. `true` = good (shown only with Oberon **and** the Lady) |
| `flipEvil` | bool | `false` | 刺殺前邪惡亮牌: when the assassination starts every evil seat's role is public (zh-community convention) |
| `revealSecs` | seconds 0–120 | `25` | the identity window. `0` = no clock, each seat taps 「我睇完」 (one-phone play) |
| `questSecs` | seconds 0–60 | `12` | minimum time before the quest result. `0` = result as soon as every card is in (one-phone play) |
| `discussSecs` | seconds 0–600 | `0` | team-talk timer shown while the leader picks. A nudge only: nothing happens at 0:00 |
| `assassinSecs` | seconds 0–600 | `0` | talk timer during the assassination. A nudge only |
| `passPhone` | bool (not a form field) | `false` | set by `defaults` when one phone holds every seat; remembers that the two clocks were zeroed *for* the shared phone |

`defaults(n, prev, env)`: keeps every valid key of `prev`, drops junk, coerces numeric strings. `roles` follows the
recommendation unless the preset is `custom` (so switching to 自訂 starts from the right deck for this head-count);
on `custom` it is repaired for a new `n` (Percival kept, then Morgana, Mordred, Oberon while evil has room).
`env.singleDevice` (the room passes it: local play, or every seat on the host's phone) sets `revealSecs = questSecs = 0` and
`passPhone = true`; the lobby summary adds `📱 一部手機玩：唔計時，逐個交電話`. When the room later asks with
`singleDevice: false` (the host opened the room alone, then friends joined on their own phones) and `passPhone` is set, the
clocks go back to 25 s / 12 s — otherwise a multi-phone game would silently run untimed, which leaks who looks long or plays
slowly. A table that chose 0 s itself (no `passPhone`) keeps it. Valid for every `n` in 5–10 and every preset (tested).

### One-tap presets (`config.presets(n)`, BACKLOG #8)

Chips above the form (`快速揀`); each `cfg` is a patch over the current config and passes `validate` at that `n`. The first is what
`defaults(n)` deals, so a fresh table lights it up.

| id | label | patch | reason shown (n = 7 example) |
|---|---|---|---|
| `standard` | 標準 | `preset: recommended, lady: auto`, official Oberon switches | 加埋奧伯倫：7 人好人最蝕，孤軍嘅奧伯倫幫到好人 (one per head-count) |
| `beginner` | 新手 | `preset: plain, lady: off` | 冇特別角色、冇湖中女神：淨係梅林對刺客，最易上手 |
| `alt` | 莫德雷德版 / 冇奧伯倫版 / 奧伯倫版 (per n) | `preset: alt, lady: auto`, official switches | 用爪牙代奧伯倫：邪惡三個互相識，易配合 |
| `hidden-oberon` | 奧伯倫隱形 | `preset: recommended, lady: auto, oberonSeenByMerlin: false, oberonReadsGoodToLady: true` | 另一種講法：梅林睇唔到奧伯倫，女神驗佢係好人 — only at 7 and 10, where the standard deck has Oberon (the research's "ship a Dized-reading preset") |

Invalid sets cannot be reached from a chip; the 自訂 editor is still blocked by `validate` (tested by a role-count fuzz).

### Presets per head-count, and the reason the lobby shows

The reason is the `help` of the 角色配置 select **and** a `💡` line of `summary()`, so every player sees it.

| n | 推薦 `recommended` | why (shown) |
|---|---|---|
| 5 | Merlin, Percival, 1 servant / Morgana, Assassin | 5 人好人只得 3 個。派西維爾幫好人，莫甘娜扮梅林搗亂，官方建議兩個一齊用，咁邪惡先唔會太弱。 |
| 6 | Merlin, Percival, 2 servants / Morgana, Assassin | 6 人好人 4 對邪惡 2，好人佔優。派西維爾配莫甘娜，令佢分唔清邊個先係真梅林，雙方就差唔多。 |
| 7 | Merlin, Percival, 2 servants / Morgana, Assassin, Oberon | 7 人係好人最辛苦嘅人數（4 對 3）。派西維爾幫好人，莫甘娜牽制佢；奧伯倫唔識自己人，邪惡要靠估，場面更平衡。 |
| 8 | Merlin, Percival, 3 servants / Morgana, Assassin, Minion | 8 人（5 對 3）用華人圈最常見嘅標準配置：派西維爾、莫甘娜，再加一個普通爪牙。 |
| 9 | Merlin, Percival, 4 servants / Morgana, Mordred, Assassin | 9 人好人 6 對 3，好人偏強，所以加莫甘娜同莫德雷德（梅林睇唔到佢）幫邪惡。 |
| 10 | Merlin, Percival, 4 servants / Morgana, Mordred, Oberon, Assassin | 10 人好人 6 對 4，場上有莫甘娜、莫德雷德同奧伯倫，場面最複雜，適合玩過幾次嘅人。 |

`plain` (all n): Merlin + servants / Assassin + minions. 「基本版：冇派西維爾同莫甘娜，淨係梅林識邪惡，最易上手。
第一次玩、或者有新朋友，建議用呢個。」

`alt` (community swaps, each with its own reason):

| n | composition | reason (shown) |
|---|---|---|
| 5, 6 | Percival + **Mordred** instead of Morgana | 改用莫德雷德代替莫甘娜：梅林睇唔到佢，派西維爾就一眼認到梅林，邪惡更易收埋。 |
| 7 | Percival, Morgana, **Minion** instead of Oberon | 用普通爪牙代替奧伯倫（台灣常見）：邪惡人人識得自己人，比推薦配置易配合。 |
| 8 | Percival, Morgana, **Mordred** instead of the Minion | 用莫德雷德代替普通爪牙（英文圈常見）：梅林睇唔到莫德雷德，邪惡更易收埋。 |
| 9 | Percival, Morgana, **Oberon** instead of Mordred | 用奧伯倫代替莫德雷德：邪惡其中一人孤軍作戰，好人更易搵出內鬼。 |
| 10 | Percival, Morgana, Mordred + **Minion** (no Oberon) | 唔用奧伯倫，改用一個普通爪牙：邪惡四人互相識晒，易啲配合。 |

`custom`: 「自己揀派西維爾、莫甘娜、莫德雷德、奧伯倫，忠臣同爪牙會自動補夠人數。」

### Validation

Blocking: `n` outside 5–10; any key of the wrong type / range (「睇身份時間」設定唔啱。); an impossible deck: at 5 and 6 players
only **one** of Morgana / Mordred / Oberon fits, at 7–9 two, at 10 three (「邪惡陣營得 2 人，刺客之外最多再揀 1 個特別角色…」).
Warnings (non-blocking): Morgana without Percival (her power is inert); Percival at 5 players with neither Morgana nor Mordred
(the rulebook advises against it); the Lady forced on below 7; `revealSecs` 1–9; `questSecs` 1–4; Oberon hidden from both Merlin and
the Lady while the Lady is on. The validate `message` of a good setup is the composition line
`好人 4（梅林、派西維爾、亞瑟忠臣 ×2）／邪惡 3（刺客、莫甘娜、奧伯倫）✓`.

### Lobby summary lines

`7 人：4 好 3 壞` · `🔵 好人：梅林、派西維爾、亞瑟忠臣 ×2` · `🔴 邪惡：刺客、莫甘娜、奧伯倫` · `🌊 湖中女神：開（人數夠，自動開）` ·
(Oberon in deck) `奧伯倫：梅林睇到，女神驗到邪惡` · `💡 <the reason>` · `⏱ 睇身份 25 秒（人人一樣長）` · `出牌 12 秒（時間到先公佈）` ·
optional `組隊討論 …` / `刺殺商量 …` / `刺殺前邪惡亮牌`.

## 3. Flow

Phase order: `reveal → pick → vote → voted → (quest → quest-result → [lady → lady-peek]) → … → assassinate → shot → over`.
A rejected team goes `voted → pick` (next leader, same quest). `over` exists so that `engine.result` is only non-null after the last
dramatic screen: the room jumps to the results screen the moment `result` is non-null.

### 3.0 What every screen has (persistent chrome, repainted from the view)

1. **The board** (public, always on top): five quest circles showing the team size (✓ blue / ✗ red once decided, the current one
   glows, a red `2✖` badge on the quest that needs two Fail cards), the rejection track (5 pips, the last one dashed — the fifth
   rejection ends the game) and, when the Lady is in play, `🌊 湖中女神：阿傑`.
2. **Seat chips** in seat order: colour dot, name, `👑` leader, `🌊` Lady holder, `🛡` on the current team, a border on you.
3. **The body** — the phase's own screen (below). Rebuilt only when (phase, proposal / quest number, my part) changes, so a held
   cover or a half-picked team is never torn away by an unrelated update.
4. **My identity card** (seats only, every phase after the reveal): the same cover, labelled 「我嘅身份」 / 「㩒住睇返我係咩」.
5. **提議記錄** (a closed `<details>`): every past proposal grouped by quest — leader, team, 通過/否決, tally, who rejected — and each
   quest's result. Public information only, so nobody has to keep notes.
6. **今局角色**: the deck in play (good | evil) as chips.

The top bar (the shell's) shows `第 2 個任務` / `隊長 阿明 · 第 3 次提議`. A seat named by `focus` also gets the shell's 輪到你 badge.

### 3.1 `reveal` — everybody looks at their identity (the "night")

Narration cue `av<gid>:reveal` (timed mode):
「新一局阿瓦隆，一共七個人。今局角色：好人方面：梅林、派西維爾、兩位忠臣；邪惡方面：刺客、莫甘娜、奧伯倫。大家望住自己部電話，
㩒住張卡睇你嘅身份同情報，睇咗唔好露出表情。你哋有 25 秒。」 (tap mode ends 「睇完請㩒「我睇完」。」)

| who | screen |
|---|---|
| every seat | title 「睇你嘅身份」; one big hold-to-peek card (back: 🏰 「㩒住睇身份」); the `Timer` 「睇身份時間」 (warns at 5 s, beeps at 0); note 「㩒住張卡睇，放手就冚返。每個人嘅卡一樣大、一樣長，有冇情報都要照睇。」 |
| table / spectator | 「大家望住自己部電話睇身份。」 |

**The card face has five rows for every role** — `🧙 梅林` / team pill (`正義陣營` blue or `邪惡陣營` red) / what you know (label) /
the names grid (always reserves two rows of space) / a one-line note. The *content* is the only thing that differs:

| role | label | names | note |
|---|---|---|---|
| Merlin | 你睇到嘅邪惡 | the evil seats except Mordred (Oberon included unless `oberonSeenByMerlin` is off), shuffled | （睇唔到莫德雷德，亦唔知有幾多個冇俾你睇到） |
| Percival | 梅林係 (one name) or 其中一個係梅林，另一個係莫甘娜 (two) | Merlin (+ Morgana), shuffled | 保護梅林 / （你分唔出邊個真邊個假） |
| Assassin, Morgana, Mordred, Minion | 你嘅邪惡同伴 | the evil seats except yourself and Oberon, shuffled | （唔知佢哋嘅角色）, or （冇人認得你，你都唔識其他人） when nobody is left |
| Oberon | 你唔識任何人 | — | 邪惡同伴都唔識你 |
| Servant | 你冇特別情報 | — | 靠觀察、投票同推理 |

Evil players learn *who* is evil, never which role. Merlin sees names only. The lists are shuffled once at setup, so seat order never
leaks a role (tested: Percival's first name is Merlin about half the time).

**Timed mode (`revealSecs > 0`, default).** One deadline for everybody. The phase **never ends early** — not when all seats have
looked. Releasing the card sends `{type:'seen'}`, a harmless "I looked" that every seat (servants too) can send once, so tap noise and
finger movement tell nothing; it does nothing public. At the deadline the phase becomes `pick`. A late peeker simply uses the identity
card that stays on screen for the rest of the game.

**Tap mode (`revealSecs = 0`).** No clock; each seat has a 「我睇完」 button under the card; the phase ends when all have tapped. The button
is the same for every role.

Anti-tell: the window is one host deadline (all phones the same); every seat gets the same card, the same back, the same release
sound; servants hold a card with an empty names grid of the same height; no "已睇 4/6" counter exists.

### 3.2 `pick` — the leader names the team

Cue `av<gid>:pick:<n>`: 「第一個任務，要兩個人出。隊長係阿明，請喺電話揀隊員。大家可以先討論。」 Quest 4 at 7+ players adds
「呢個任務要兩張失敗牌先算失敗。」 After rejections it adds 「呢個任務已經連續兩次被否決，到第五次邪惡陣營就贏。」 and on the fourth
rejection 「呢個係最後一次提議，再被否決，邪惡陣營就即刻贏。」

| who | screen |
|---|---|
| leader | 「揀 2 位隊員」; 「你係隊長。揀 2 個人（可以包括自己），大家一齊討論之後先確定。」; the `PlayerPicker` (all seats in seat order, `揀咗 1 / 2`); button 「確定 2 位隊員」 (enabled at exactly the right number) |
| everybody else | 「等 阿明 揀隊員…」 |
| table | 「阿明 揀緊隊員，大家可以討論。」 |
| everyone | banners: `呢個任務要兩張失敗牌先算失敗。` (quest 4, 7+); red `最後一次提議！再被否決，邪惡直接贏。` (fourth rejection); optional discussion `Timer` 「討論時間」 (a nudge: nothing happens at 0:00) |

The leader's half-picked team never leaves their phone. The team is stored in seat order. The leader may include themselves or not.
Sound: `turn` on the leader's phone only (the leader is public).

### 3.3 `vote` — everybody votes, in secret

Cue: 「阿明提議自己、阿欣出任務。大家請投票：贊成定反對？」 (the leader is called 自己 when on the team; otherwise 「阿明提議阿強、阿欣出任務。」)

| who | screen |
|---|---|
| every seat | 「投票：贊成定反對？」; `隊員：` chips of the team; two big tiles 👍 贊成 / 👎 反對; the confirm button 「揀一個先」 → 「確定：贊成」/「確定：反對」 (two taps, so a stray thumb does not lock anyone in); after confirming 「已投 ✓　等緊其他人…」 with **neither tile lit** and a small 「改票」 (a vote may be changed until the last one lands). A locked vote is never on screen — a neighbour who has not voted could read it and follow it (research: the vote being cast is private until all are locked); your own choice shows only while you pick it or after 改票 reopens it; 「已投 3/7」 (a count, never who); note 「全部人投完先會同時公開，每個人投咩都會見到。」 |
| table | the team and the count |

The leader and the team members vote like everybody else. When the last vote lands the engine tallies at once.

### 3.4 `voted` — the votes, with names

Strict majority of **all** seats approves; a tie rejects (`approves >= floor(n/2)+1`).

| who | screen |
|---|---|
| everybody | ✅ 隊伍通過 / ❌ 隊伍被否決 (or 🔴 連續五次被否決 — 邪惡陣營贏); 「贊成 5 · 反對 2」; two columns of names 👍 贊成 / 👎 反對 (sound `reveal`); 「過半（4 票以上）先通過，平手算否決」; the track: 「連續否決：2/5」 or 「連續否決歸零（之前 2 次）」 |
| leader | button 「繼續」 (「睇結果」 after the fifth rejection) |
| others | 「等 阿明 繼續…」 |

Cues: approved 「投票結果：五個贊成，兩個反對，隊伍通過。反對嘅人：阿輝、阿玲。」 (all in favour: 「全票贊成。」);
rejected 「投票結果：三個贊成，四個反對，隊伍被否決。反對嘅人：…。隊長傳俾阿強，呢個任務已經連續兩次被否決。」 (+ 「下一次係最後一次提議。」
after the fourth); fifth 「…呢個任務連續五次被否決，邪惡陣營勝利！」

Transitions on 繼續: fifth rejection → `over`; approved → `quest` (the vote track was already reset to 0 at the tally and the screen says 「連續否決歸零」, so the next quest starts with a clean
track); rejected → the leader token moves **one seat**, `proposalNo + 1`, `pick` for the same quest. The fifth team is still voted on and may
be approved (official).

### 3.5 `quest` — the team plays success / fail

Cue: 「隊伍通過喇。阿明、阿欣，請喺電話揀「成功」或者「失敗」。好人只可以出成功。你哋有 12 秒。」

| who | screen |
|---|---|
| team member | 「出任務牌」; `隊員：` chips; the `Timer` 「出牌時間」 (timed mode); **two tiles** ✅ 成功 (幫任務成功) and ❌ 失敗 (破壞任務), in a random order per seat per quest, with **one look for both** (neutral border, and the same accent ring when picked — never a team colour); the confirm button 「揀一張牌先」 → 「確定出牌」 whichever tile is picked; the same caption for everybody 「只有邪惡陣營先出得「失敗」。其他人㩒「失敗」冇反應。」; after playing 「已經出牌 ✓　時間到先公佈結果。」 and both tiles dim (no echo of the choice) |
| not on the team | 「你唔喺隊入面，等隊員出牌。」 |
| table | 「隊員正喺各自部電話秘密出牌。」 |

**Good and evil see the identical screen.** For a good seat the 「失敗」 tile is simply inert: it is not greyed, not disabled, makes the
same `tap` sound, and the confirm button stays on 「揀一張牌先」. The UI never offers `fail` to good, and the engine would refuse it
anyway. Tile order is mirrored per seat at random so an over-the-shoulder glance at *where* a finger went is uninformative too.
A picked Fail looks exactly like a picked Success and the button says 「確定出牌」 for both (playtest #17): a red glow or 「出「失敗」牌」
could only ever appear on an evil phone and is readable across the table; a tinted border on the *other* tile would give the pick away
just the same. Only the emoji and words inside the tile say which card it is. Test: the CSS has no rule that tells the two tiles apart,
and a good seat with Success picked and an evil seat with Fail picked have the same picked-tile classes and the same button.

**The clock is a minimum.** In timed mode (`questSecs > 0`) nothing resolves early, even when every card is in: the result appears at the
later of the deadline and the last card. A card still missing at the deadline is **waited for** (the engine never plays success on an evil
player's behalf; a dead phone is settled by 代佢做 or the host's 下一步). No running count is shown inside the window (it would show who is
slow); after it, and in tap mode (`questSecs = 0`), a count 「已出牌 1/3」 is fine because everybody is waiting anyway.

### 3.6 `quest-result` — the shuffled pile

The engine builds the pile from the **counts only** and shuffles it with `ctx.rng`: no seat order, no submission order survives.
Each phone flips the cards one at a time (`flip` / `deny` sounds), then the verdict.

| who | screen |
|---|---|
| everybody | 「任務 1 結果」; the pile; 「牌已經洗亂，睇唔出邊個出咩。」; ✅ 任務成功 / ❌ 任務失敗; 「成功 3 張 · 失敗 1 張」; on a quest that needs two Fails and got one: 「呢個任務要兩張失敗先算失敗，所以一張失敗仍然成功。」; 「而家：成功 2 · 失敗 2」 |
| leader | 「下一個任務」 / 「去湖中女神」 / 「去刺殺階段」 / 「睇結果」 (whatever comes next) |
| others | 「等 阿明 繼續…」 |

Cue: 「任務結果：一張成功，一張失敗。任務失敗。而家成功零次，失敗一次。」 Quest 4 at 7+ with one Fail adds 「呢個任務要兩張失敗先算失敗，所以一張失敗都算成功。」;
three successes add 「好人完成咗三個任務！不過邪惡陣營仲有最後機會：刺殺梅林。」; three failures add 「邪惡陣營完成三次破壞，邪惡陣營勝利！」

Order of checks on 繼續 (exactly as the research states): **3 failures → over (evil), no Lady, no assassination · 3 successes → assassinate
(no Lady) · else the Lady if the quest just finished was the 2nd, 3rd or 4th · else the next quest** (leader moves one seat past the proposer).

### 3.7 `lady` / `lady-peek` — Lady of the Lake (optional)

Starts with the seat to the right of the first leader (the one who will lead last); public. The holder checks one seat that has **never**
held it and is not themself: candidates are N−1, N−2, N−3 (≥ 2 at five players). The checked seat takes the token.

Cue (`lady`): 「湖中女神喺阿傑手上。阿傑，請揀一個未攞過女神嘅人，驗佢係好人定邪惡。」

| who | `lady` screen | `lady-peek` screen |
|---|---|---|
| holder | 「阿傑 手持湖中女神」; 「揀一個人驗身份。有 🚫 嘅係已經持有過女神嘅人，唔可以揀。」; picker (`驗佢！`) | 「你驗咗 阿玲」; a hold-to-peek 🌊 cover (「㩒住睇結果」) hiding 「佢係好人」 / 「佢係邪惡」 in blue / red; 「結果得你一個人知。你可以講真話，亦可以呃人，但係唔可以畀人睇電話。」; button 「睇完喇，交出女神」 |
| everybody else | 「等 阿傑 揀人驗身份…」 | 「阿傑 驗緊 阿玲，結果只有 阿傑 睇到。」 and 「阿玲 而家攞住湖中女神」 |

Cue (`lady-peek`): 「阿傑驗咗阿玲，結果得阿傑一個人知，阿傑可以講真話，亦可以呃人。阿玲而家攞住湖中女神。」 (never the answer.)
Loyalty comes from the character card: Merlin, Percival, servants → 好人; Assassin, Morgana, **Mordred**, Minion → 邪惡; **Oberon → 邪惡**
unless `oberonReadsGoodToLady`. The holder's public claim and the private answer are independent; the app never constrains what they say.
The answer is in no view except the holder's, during `lady-peek`, and in the final recap.

### 3.8 `assassinate` — after the third success

Cue: 「好人完成咗三個任務，但係梅林仲未安全。邪惡陣營可以商量，刺客請揀一個人。好人同梅林請保持安靜，唔好出聲。」 (+ 「邪惡陣營嘅角色已經公開。」 with `flipEvil`).

**Every seat gets the same screen**: 「邪惡陣營商量，刺客揀人」 / 「只有刺客嘅選擇先算數。好人同梅林請保持安靜。」 / a `PlayerPicker` of every
seat except yourself / a confirm button 「確定刺殺 阿明」 (second tap 「再㩒一下確定」 within 3 s) / the optional soft timer 「商量時間」.
For the Assassin the second tap sends the real `{assassinate, target}`; for everybody else it sends `{decoy}`, which changes nothing public,
and their screen says 「已記低（只有刺客嘅選擇先算數）」. Same taps, same sound (`lock`), same layout — finger noise tells nothing about who
the Assassin is. With `flipEvil` an extra box lists the evil seats with their roles for everybody.

Any seat is a legal target (the engine accepts the Assassin naming an evil seat or themself and simply loses; the UI never offers self).
Evil may talk it over out loud; the Assassin decides alone.

### 3.9 `shot` — the result, before the results page

「刺客 阿欣 刺咗 阿明…」, then 「阿明 係梅林！邪惡陣營反敗為勝！」 or 「阿強 唔係梅林，梅林係 阿明。好人贏！」 (sounds `reveal` / `deny`). Cue:
「刺客阿欣刺咗阿明。阿明正正係梅林！邪惡陣營反敗為勝！」 / 「…唔係梅林，梅林係阿明。好人贏！」 It lasts 8 s or until the Assassin taps 「睇結果」
(or the host's 下一步); then `over`.

### 3.10 `over` and the results screen

`engine.result` is non-null only in `over`. Winners = every seat on the winning team; `points` = 1 for a winner, 0 otherwise.
Summary: `邪惡陣營贏 — 三個任務失敗` / `邪惡陣營贏 — 同一個任務連續五次被否決` / `邪惡陣營反敗為勝 — 刺客 阿欣 刺中梅林 阿明` /
`好人贏 — 刺客 阿欣 刺錯 阿強，梅林係 阿明`.

Lines (the shell lists them under 「點解會咁」) — the first sentence says why the game ended, then the recap nobody could see live:

```
好人完成咗三個任務，刺客 阿欣 刺咗 阿強（🛡️ 派西維爾），但係梅林係 阿明，好人贏。
── 🎭 身份同夜晚情報 ──
阿明：🧙 梅林（好人）— 夜晚見到邪惡：阿傑、阿玲、阿欣
阿強：🛡️ 派西維爾（好人）— 夜晚見到梅林同莫甘娜（唔知邊個真）：阿明、阿玲
阿傑：👤 奧伯倫（邪惡）— 孤軍作戰，冇人識佢
…
── 📜 任務記錄（連出咗咩牌） ──
任務 2（3 人，隊長 阿欣）：阿強、阿玲、阿輝 → 失敗（2 成功、1 失敗）
　出牌：阿強 成功、阿玲 失敗、阿輝 成功
任務 4（4 人，隊長 阿輝）：… → 成功（3 成功、1 失敗）
　出牌：…
　（呢個任務要兩張失敗先算失敗，得一張失敗所以仍然成功）
── 🗳 提議同投票記錄 ──
任務 1 · 第 1 次提議：隊長 阿明 揀 阿輝、阿欣 → 通過 4:3（贊成：…；反對：…）
── 🌊 湖中女神 ──
阿傑 驗 阿玲 → 睇到邪惡
── 🗡️ 刺殺 ──
阿欣 刺咗 阿強（🛡️ 派西維爾）→ 刺錯咗
```

Every heading is a 「── 標題 ──」 line, so the shell folds the recap into sections (the why-line first, untitled; a long recap opens
only its first section). Proposals are numbered **per quest** — 「任務 3 · 第 2 次提議」, as on the game screens and the 連續否決 track —
never with the game-wide counter, which would read like rejections (playtest #33); a 呢鋪唔計 line uses the same number.
If a card was defaulted by the host's 下一步 the quest block adds 「（X 冇出牌，由系統代出成功）」. Who played which card is only ever shown here,
after the game — never live.

### 3.11 💡 hints (`view.hint`, BACKLOG U1)

One line (≤ 40 characters, tested) per phase and seat, shown only in the shell's 💡 sheet — never printed by the game screen (tested).
Chosen from what that seat's view already shows (leader, team membership, own vote / card done, Lady holder) and **never from the role**
(tested by re-dealing the cards to other seats: no hint changes), so the hint sheet is no tell either.

| phase | who | hint |
|---|---|---|
| `reveal` | every seat (timed) | 㩒住張卡睇身份同情報，記熟佢，唔好露表情。 |
| | tap mode: not yet / done · table | 㩒住張卡睇身份，睇完㩒「我睇完」交俾下一位。 / 睇完喇，等其他人。張卡之後都可以㩒住睇返。 · 大家睇緊自己嘅身份。 |
| `pick` | leader · others | 你係隊長：揀 3 個人出任務，可以揀埋自己。 · 隊長揀緊隊員，你可以出聲講想邊個去。 |
| | fifth proposal: leader · others | 最後一次提議：揀 3 個人，要大家肯通過。 · 第五次提議：再被否決，邪惡即刻贏。 |
| `vote` | not voted (5th: 第五次提議：一否決，邪惡就即刻贏。) · voted · table | 睇清楚隊員有冇可疑，㩒贊成或者反對。 · 投咗喇，等齊人就會公開邊個投咩。 · 大家投緊票，齊人先公開。 |
| `voted` | leader · others · fifth rejection | 記住邊個投反對，再㩒「繼續」。 · 記住邊個投咩，呢啲係推理嘅線索。 · 連續五次否決，邪惡贏咗。 |
| `quest` | member (good **and** evil) · played · not on the team | 揀一張牌：好人只出得成功，邪惡可以搞破壞。 · 出咗牌喇，等公佈結果。 · 隊員秘密出牌，之後只會公佈幾多張失敗。 |
| `quest-result` | leader · others | 睇吓有幾多張失敗，諗吓邊個可疑，再㩒繼續。 · 睇吓有幾多張失敗，諗吓隊入面邊個可疑。 |
| `lady` / `lady-peek` | holder · others | 揀一個人，私下睇佢係好人定邪惡。 / 㩒住睇結果；你可以講真話，亦可以呃人。 · 女神持有人揀緊驗邊個。 / 只有持有人知結果，佢講嘅未必係真。 |
| `assassinate` | **every seat the same** | 邪惡傾計，刺客揀邊個係梅林；人人都要㩒，得刺客算。 |
| `shot` · `over` | everybody | 睇吓刺客有冇刺中梅林。 · 完咗！去結果頁睇晒每個人嘅身份。 |

`rules.quick` is six lines of ≤ 30 characters; every `rules.roles[].text` is written 「做乜：… 點贏：…」 so the 💡 sheet's 「你嘅角色」 shows
what you do and how you win (both tested through `ui/logic.js roleParts`).

## 4. Single-device play and paper mode

`meta.singleDevice = 'full'`. Config: `revealSecs = 0`, `questSecs = 0` — chosen automatically, because the room passes `env.singleDevice` to
`config.defaults` (and the clocks come back if the table later spreads over several phones, §2). The phone moves by `focus`:

1. `reveal` (tap mode): `focus.pids` = every seat that has not tapped 「我睇完」, so the shell walks the seats in seat order, one pass gate each
   (「交俾 阿明 · 其他人唔好望」). Each holds the card, taps 「我睇完」, the next gate appears.
2. `pick`, `voted`, `quest-result`: `{ pids: [leader] }` — the leader's gate. After `voted` and `quest-result` the phone is the public
   scoreboard: pass it round or read it out loud, then the leader taps 繼續.
3. `vote`: every seat that has not voted, in seat order; the vote stays hidden (the view only ever carries the viewer's own vote); after the last
   one the reveal screen goes to the leader.
4. `quest`: only the team members who still owe a card, in seat order; the phone goes back to the leader for the result. Team membership is public,
   so the gates name people.
5. `lady` / `lady-peek`: the holder (public).
6. `assassinate`: `{ pids: [assassin], anonymous: '刺客請拎起部手機' }` — the gate says **刺客請拎起部手機 · 其他人閉埋眼，唔好望** and never a name, so
   passing the phone does not announce who the Assassin is. The other evil players can still murmur; the phone is a single screen, so the decoy
   taps do not exist here.
7. `shot`: the Assassin, then the results.

A shared phone cannot hide *how long* a player holds it. Tell people to take about the same time at every turn (the card, the vote, the quest
card). Timed windows cannot work on one phone (one clock for N hand-overs) — hence the 0 s settings.

Two people on one phone (a dead battery) work the same way: a device with several seats gets a gate between them. No data at all: one phone,
everybody present (`app.local`); the page works offline once loaded.

There is no paper mode.

## 5. Engine

Phases: `reveal → pick → vote → voted → quest → quest-result → [lady → lady-peek →] pick … → assassinate → shot → over`.

State (JSON; **PRIVATE** = never in any view of another seat, not even in the table view):

```
game, gid, cfg (normalised), n, order [pid…], names {pid: name}, deck [{role, count}] (public), ladyOn,
role {pid: roleId}                     PRIVATE until over
knows {pid: {kind, pids}}              PRIVATE: each seat gets only its own entry (kinds: seesEvil, seesMerlin, allies, alone, none)
phase, deadline, timerLabel, cueAck,
questNo, proposalNo, startIx, leaderIx, rejects,
team [pid…], votes {pid: 'approve'|'reject'}   PRIVATE until the reveal; reveal {approves, rejects, approved, needed, before, after, ends}
flip {pid: bool}                       per-seat tile mirroring (only that seat's view)
cards {pid: 'success'|'fail'}          PRIVATE until over (never in a view; not even as a count per seat)
windowOver, auto [pid…]                the quest clock is over / seats whose card the host defaulted
outcome {no, team, leader, successes, fails, need, success, pile}   public pile = counts, shuffled
results [true|false|null ×5], quests [{…, played PRIVATE until over}], voteLog [{q, no, k, leader, team, votes, approves, rejects, approved}] public after each reveal (no = game-wide id; k = the proposal's number within its quest, rejects + 1)
seen [pid…], decoyed [pid…]            internal bookkeeping for the two decoy taps
voids [{q, no, k, phase, leader}]      the host's 呢鋪唔計 (public; recapped in the results with k)
lady {holder, held [pid…], step {holder, target, loyalty PRIVATE (holder only)}, log [{q, holder, target, loyalty}]}
shot {assassin, target, hit, merlin}, pendingEnd {winner, reason}, winner, reason, final {winners, summary, lines, points}
```

`view(state, pid)` is built field by field. Common: `me, phase, n, title, subtitle, hint, deadline?, timerLabel?, order, deck, board {sizes, need, results, questNo,
wins, losses}, track {rejects, max}, leader, proposalNo, lady {holder, held, log, step}|null, history [public proposals], quests [public quests],
opts {reveal, quest, flipEvil}`, and `redo: true` while a step restarted by 呢鋪唔計 is running (public). Seats also get `mine {role, knows {kind, pids}, seen}`; the table view has no `mine`.
Per phase: `pick {leader, size, need, canPick}` · `vote {leader, team, progress {done,total}, mine}` · `voted {leader, team, votes, approves, rejects,
approved, needed, before, after, ends, nextLeader}` · `quest {no, team, size, need, mode, mine, progress?}` where `mine` is
`{member, done, flip, canFail}` for a member (the **same keys for good and evil**) and `null` otherwise · `outcome {no, team, leader, successes, fails,
need, success, pile, next}` · `ladyStep {stage, holder, target, candidates (holder only), held, mine {loyalty} (holder only, peek stage)}` ·
`assassinate {canShoot, tapped, candidates, flipped}` (**the same keys for every seat**) · `shot {assassin, target, hit, merlin, canContinue}` ·
`end {winner, reason, summary, roles, knows, quests (with played), lady (with loyalty), shot}` only in `over`.

### Actions (validated; bad input returns the state unchanged and never throws)

| action | who | phase | rule |
|---|---|---|---|
| `{type:'seen'}` | any seat | `reveal` | once per seat. Tap mode: all seen → `pick`. Timed mode: nothing public, never ends the window |
| `{type:'pick', team:[pid…]}` | the leader | `pick` | exactly `TEAM_SIZE[n][quest-1]` distinct, real seats → `vote` (team stored in seat order) |
| `{type:'vote', vote:'approve'\|'reject'}` | any seat | `vote` | may overwrite until the last vote; the last vote tallies → `voted` |
| `{type:'continue'}` | the leader | `voted`, `quest-result` | see §3.4, §3.6 |
| `{type:'quest', card:'success'\|'fail'}` | a team member who has not played | `quest` | `fail` only from an evil role (refused for good). Tap mode / after the clock: the last card resolves |
| `{type:'lady', target}` | the holder | `lady` | not themself, not a past holder → `lady-peek` |
| `{type:'lady-done'}` | the holder | `lady-peek` | token → target, next quest |
| `{type:'assassinate', target}` | the Assassin | `assassinate` | any seat id → `shot` (Merlin → evil, otherwise good) |
| `{type:'decoy'}` | any seat except the Assassin | `assassinate` | once per seat, changes nothing public |
| `{type:'continue'}` | the Assassin | `shot` | → `over` |
| `@cue-done {id}` | host | any | acknowledges the cue if `id` matches |
| `@next` | host | any | first acknowledges a pending cue; then skips: `reveal` → `pick`, `voted`/`quest-result` → continue, `quest` → play success for every missing card (recorded in `auto`) and resolve, `lady-peek` → done, `shot` → `over`. `pick`, `vote`, `lady`, `assassinate` need a real decision and are left alone |
| `@void-round` | host | `pick`, `vote`, `quest` | 呢鋪唔計 for a dead phone, with no effect on the score or the vote track. `pick`: the token moves one seat — **not** a rejection, not a proposal. `vote`: the ballots cast so far are discarded (none was public) and the same team is voted on again (no-op if nobody voted). `quest`: the cards played so far are discarded (none was public), the same team plays again with a fresh window (no-op if no card yet). Recorded in `voids`; the next cue gets a new id and a preface (「隊長換人，唔算否決。」 / 「啱啱嘅投票唔計，重新投過。」 / 「啱啱出嘅牌唔計，重新出過。」), and every phone shows a banner while the step runs again (`view.redo`: 「上一位隊長冇揀到隊，主持叫咗下一位（唔算否決）。」 / 「主持取消咗啱啱嘅投票，請重新投。」 / 「主持取消咗啱啱出嘅牌，請重新出。」). Every other phase: unchanged — public screens are skipped with `@next`, and the Lady's check and the shot need the real person (`@auto` covers a dead phone there) |

`@auto` is resolved by the session through `autoAct`.

### Timers (`state.deadline`)

`reveal`: `now + revealSecs·1000` (timed mode) → `pick`. `quest`: `now + questSecs·1000` (timed mode): at the deadline `windowOver` is set; the quest resolves then
if every card is in, otherwise on the last card. `pick`: `discussSecs` and `assassinate`: `assassinSecs` are soft — `advance` leaves the state alone (the `Timer`
just beeps). `shot`: 8 s → `over`. No other phase has a deadline.

### `focus`

`reveal` → seats that have not looked · `pick`/`voted`/`quest-result` → `[leader]` · `vote` → seats that have not voted · `quest` → members who have not played ·
`lady`/`lady-peek` → `[holder]` · `assassinate` → `{ pids: [assassin], anonymous: '刺客請拎起部手機' }` · `shot` → `[assassin]` · `over` → null.

### `blocking(state, pid)` — is the table really waiting on this seat?

Stall detection (`Session.blocking`) asks this instead of `legalActions`, because the anti-tell taps give every seat something legal:
`reveal` → only in tap mode, the seats that have not tapped 「我睇完」 (timed: **nobody**, the clock ends it; `seen` is a decoy) ·
`pick`/`voted`/`quest-result` → the leader · `vote` → seats that have not voted · `quest` → members who owe a card · `lady`/`lady-peek` → the holder ·
`assassinate` → **the Assassin only** (the decoys never block) · `shot`/`over` → nobody (the shot's 8 s clock ends it). Tested per phase, as a property over
fuzzed games (a blocker always has a legal action; outside the timed reveal and the shot it equals `focus`), and in a real `Room`: a disconnected
non-assassin during the assassination is never listed in `stalled`; a disconnected Assassin is, and 代佢做 then shoots.

### `autoAct(state, pid)` — a stalled seat

`reveal` → `seen` · `pick` → a random team · `vote` → **approve** (a dead phone has no opinion; reject would risk the fifth-rejection loss) · `quest` → **success**
(never a surprise sabotage; an evil player on a dead phone does not sabotage) · `voted`/`quest-result`/`lady-peek`/`shot` → continue / done · `lady` → a random legal
target · `assassinate` → the Assassin shoots a random seat; every other seat answers `decoy` (so a disconnected decoy seat is cleared by 代佢做).

### `legalActions(state, pid)`

Exactly the actions in the table that would change something now. Every seat has at least one at the start of: `reveal`, `vote`, `quest` (members), `assassinate`.
Free-form input does not exist, so a leader's `pick` lists every legal team (≤ 252).

### Setup, carry and fair randomness (BACKLOG #20)

The deck is shuffled with `rng`; each seat is Merlin ≈ 1/n of the time (tested). The first leader is uniform over **every** seat, except that
`setup` receives `carry` (the last `result().carry` of 阿瓦隆 in this room, `{ firstLeader }`) and skips that seat when it is still seated —
the research's "rotate the start leader between games"; the other seats stay uniform (tested), and junk or a departed seat changes nothing.
There is deliberately **no role anti-streak**: last game's roles are public on the results screen, so "less likely to be evil again" would be
a tell. `hostPid` is accepted and unused (the host is an ordinary player; no moderator mode).

### Result and explanation lines

See §3.10. Scoring: none in the game; the evening scoreboard gets 1 point per winning seat. `result.carry = { firstLeader }` (kept by the room,
never shown). The recap (BACKLOG #10) also lists `👑 第一任隊長：X；湖中女神由 Y 開始` under the vote log and, when the host used it,
`⏭ 主持「呢鋪唔計」` with one line per cancelled step.

## 6. Edge cases → test list (`tests/avalon.test.mjs`)

Team sizes and fails
- Team size per (N, quest) enforced; wrong size, duplicates, ghosts, `__proto__`, non-arrays refused; only the leader picks; leader in or out of the team.
- 5–6 players: one Fail fails quest 4; 7–10: two; quest 5 always one — table-driven over every N × quest × fail count.
- N=7 quest 4: four members, one Fail → quest **succeeds**, the pile shows 1 Fail + 3 Success, the cue says so; the same at 6 players fails.
- Evil may play Success; good's Fail is refused by the engine, absent from `legalActions`, and `canFail:false` in the view; teams without evil always succeed.

Voting
- Strict majority and ties for every approve count 0..N at N = 5..10; the leader's vote counts.
- Secret until the last vote (a count only, nothing else in any view), changeable until then, late votes ignored; names and the log public after.
- A rejection moves the leader one seat, keeps the quest, the score and the Lady; approval resets the track to 0 even after four rejections (and the next quest can take four again).
- Fifth rejection: evil wins, no sixth proposal, shown on the vote screen first; the fifth proposal is still voted on and can be approved.
- Leader token: one seat per proposal over a whole game; start leader random and uniform.

Lady
- Used only after quests 2, 3, 4 and only while undecided — a table over result sequences (3–0 after quest 3 and anything but 2–2 after quest 4 skip it); never after quest 1 or 5.
- Candidates N−1, N−2, N−3, never the holder or any past holder (including the first); the checked seat takes the token; the first holder is the seat before the first leader.
- Loyalty per role (Mordred evil, Oberon evil / good by switch); private to the holder; the log never holds it; the cue never says it; off at 5–6 on 跟人數.

Night knowledge
- The observer × target table with all four optional roles; Merlin = evil − Mordred (− Oberon when hidden) as a property over presets, counts and seeds; never a role name.
- Percival: Merlin alone or Merlin + Morgana; Morgana without Percival and Percival without Morgana deal; 5p Mordred + Assassin gives Merlin one name; Oberon sees nobody and is seen by no evil seat.
- Names shuffled (Percival's first name is Merlin ≈ half the time; Merlin's and the evil lists are not seat-ordered).

Assassination
- Only after the third success, never after three fails or five rejections; only the Assassin shoots; Merlin → evil, anyone else (evil seat, even themself) → good; the shot screen precedes the result.
- One screen shape for every seat, a legal action for every seat, anonymous focus, decoys change nothing public; `flipEvil` reveals exactly the evil roles.

Information limits
- Quest cards: the pile is counts, shuffled, and **identical whichever team member played the Fail** (all views equal); no view before `over` has `played`/`cards`.
- Leak sweep at every step of scripted and random games, for every N: no role name outside the public deck / own card / flipped evil cards; no state key; what a seat is told equals an independent oracle of the research table.
- Role-name words occur in cues only in the reveal, assassination and shot lines.

Connectivity and framework
- Views are stateless, so a reconnect restores the pending prompt; a JSON snapshot taken at every phase gives identical views, focus and cue.
- Garbage / wrong-phase / wrong-seat / host-internal messages never throw and never change the state; every legal action changes something; `autoAct` finishes any phase alone (voters approve, members succeed).
- Cue ids unique per step; acknowledged cues disappear; `@next` acknowledges first and never gets stuck.
- Fuzz: every N in 5–10 × 100 seeds (clock modes, presets, Lady, switches mixed) terminates with a well-formed result and all four end reasons occur; the full-harness fuzz; ≤ 5 quests, ≤ 5 proposals per quest.
- Config: every preset valid at every N with the expected composition; defaults / validate / fields / summary shapes.
- UI (fake DOM, the real `Cover` / `PlayerPicker` / `Timer`): every phase renders for every seat and the table, `update()` is idempotent, the identity card, the quest screen and the assassination screen have one shape for every seat, the inert Fail tile makes the same sound as the live one, a whole game can be played by tapping alone, the hint is never printed unasked, and after 呢鋪唔計 the vote / quest screens open again clean.

QA additions (2026-10-03 UTC)
- `blocking` per phase, as a fuzz property, and through a real `Room` (decoy seats never stall; the Assassin does).
- `@void-round` in every phase (pick passes the token without a rejection; vote / quest restart; everything else unchanged; seats cannot send it), recap lines, and a fuzz with random voids keeping the vote track and leader rotation consistent.
- `carry`: last game's first leader never leads first again, the rest uniform, roles unaffected; through the Room over four games with 再玩一局.
- One shared phone: clocks zeroed with `passPhone`, restored when friends join (also through a real Room where the host opened alone).
- Presets: valid over several base configs at every n, the first equals `defaults`, 新手 has no specials and no Lady, 奧伯倫隱形 only at 7/10; role-count fuzz.
- 💡: hint ≤ 40 characters for every phase × seat × table, independent of the role, identical on the anti-tell screens; `rules.quick` ≤ 6 short lines; every role text splits into 做乜 / 點贏.
- #3: the timed reveal gives every seat a tap, nobody blocks it, it ends exactly at its deadline even when all have looked.

## 7. 貼心 touches

- The reason for the recommended deck is shown in the lobby, per head-count, plus a gentle 「基本版（新手）」 for new friends.
- The identity card never goes away: 「我嘅身份」 sits under every screen, still behind a cover.
- The board answers the questions people keep asking: whose turn to lead, how many rejections are left, which quest needs two Fails, who holds the Lady.
- 提議記錄 keeps every proposal, tally and rejecter, so nobody has to remember who voted for whom.
- 今局角色 stays on screen, so 「有冇莫甘娜？」 never needs a rules check.
- A team is picked with two taps (pick, 確定) and a vote with two taps (揀, 確定); the assassination needs a deliberate second tap.
- The vote track reset, the two-Fail rule, the fifth-proposal warning are all said out loud and on screen when they matter.
- Lady: 🚫 marks who cannot be checked and the note says the holder may lie — the app never takes the choice or the bluff away.
- Narration is announcements only; with 靜音 the same lines scroll on the host phone. Nothing waits for it.
- The results explain the whole game, including what each seat knew at the start and who played which card — the 「原來係咁」 moment.
- A dead phone never stops the table: 代佢做 votes approve, plays success, or answers the decoy.

## 8. Framework requests

1. ~~`config.defaults(n, prev, env)`~~ — done by core (`{ singleDevice }`); adopted, including the way back to timed play (§2).
2. ~~Stall detection and decoys~~ — done by core (`engine.blocking`); adopted (§5).
3. **Uniform 輪到你 badge.** During the assassination only the Assassin's phone gets the badge (`focus` = the Assassin so that a shared phone's gate can be
   anonymous). On separate phones that is a tiny tell for an over-the-shoulder glance. A `focus.decoyPids` (badge shown, gate not opened) would close it. Low priority.
4. ~~**Results screen headings.**~~ — done: the shell folds `result.lines` at 「── 標題 ──」 lines, and every recap heading is one (§3.10).
5. **Seat order.** Leader rotation follows seat order, so the lobby's 換位 should be used to match the real table; the lobby could say so for games with rotating
   turn order. (The rules sheet's 手機點用 says it; nothing in the lobby does.)
6. **呢鋪唔計 button.** `app.hostCtl.voidRound()` exists but no screen offers it yet. For 阿瓦隆 it only does something in `pick`, `vote` and `quest`
   (it returns false elsewhere), so the stalled-seat card is the natural place: 「代佢做 · 呢鋪唔計 · 再等」, with a toast when it returns false.

## 9. Rules verification (QA, 2026-10-03 UTC)

Each rule of `docs/research/avalon.md` (Verification section wins) → this doc → the code. FIX = changed in this pass.

| rule (research) | doc | code | verdict |
|---|---|---|---|
| Good/evil 3/2, 4/2, 4/3, 5/3, 6/3, 6/4; Merlin + Assassin always | §1, §2 | `GOOD_COUNT`, `EVIL_COUNT`, `composition` | OK |
| Percival replaces a servant; Morgana / Mordred / Oberon replace a minion; at 5–6 only one evil special | §2 Validation | `composition`, `repairRoles` | OK |
| Team sizes per N × quest (table) | §1, §3.2 | `TEAM_SIZE`, `validTeam` | OK |
| Two Fails only on quest 4 at 7+; quest 5 always one | §3.5–3.6 | `failsNeeded` | OK |
| Strict majority of all seats, tie rejects; leader votes | §3.4 | `approvalsNeeded`, `tallyVotes` | OK |
| 5th consecutive rejection in a round → evil at once; the 5th team is still voted on | §3.4 | `tallyVotes` → `pendingEnd` | OK |
| Approval resets the track; a rejection keeps quest, score, Lady | §3.4 | `tallyVotes`, `nextProposal` | OK |
| Leader moves one seat per proposal; after a quest, next seat after the proposer; first leader random | §3.4, §5 | `nextProposal`, `nextQuest`, `firstLeader` | OK |
| Rotate the start leader between games (multi-game note) | §5 Setup | `firstLeader(carry)`, `result.carry` | **FIX** (was uniform every game) |
| Good must play Success; evil chooses; pile shuffled, counts only | §3.5–3.6 | `act` quest, `resolveQuest` | OK |
| Order after a quest: 3 fails → evil; 3 successes → assassin; else Lady after quests 2/3/4 played; else next quest | §3.6 | `nextAfterQuest` | OK |
| Lady starts right of the first leader; never a past holder or self; checked seat takes it; reads the loyalty card (Mordred evil, Oberon evil by default) | §3.7 | `setup`, `act` lady, `loyaltyOf` | OK |
| Lady recommended 7+ (not a lock) | §2 | `lady: 'auto'`, warning below 7 | OK |
| Night: evil (not Oberon) see evil (not Oberon); Merlin sees evil except Mordred, Oberon by default; Percival sees Merlin (+ Morgana) unlabelled; names shuffled | §3.1 | `knowledgeFor` | OK |
| Oberon switches default official; ship a Dized-reading preset that flips both | §2 | `oberonSeenByMerlin` / `oberonReadsGoodToLady`, `presets` `hidden-oberon` | **FIX** (the preset did not exist) |
| Assassination only after the third success; no card shown before the shot by default; 「邪惡亮牌」 toggle (zh convention); any target, Merlin → evil | §3.8–3.9 | `startAssassinate`, `flipEvil`, `toShot` | OK |
| Recommended sets per N (zh standard; 8p alt = Mordred, 7p alt = Minion) | §2 | `PRESET_TABLE` | OK |
| Warnings: Morgana without Percival; Percival at 5 without Morgana/Mordred | §2 | `validate` | OK |
| Fixed-length private reveal for every role (anti-tell) | §3.1 | timed `reveal`, never early | OK |
| One phone: timed windows cannot work; several phones must stay timed | §2, §4 | `defaults(…, env)`, `passPhone` | **FIX** (once zeroed for a host alone in the lobby, the clocks never came back when friends joined) |
| Dead phone recoverable or host default (house rule) | §5 | `autoAct`, `@void-round`, `blocking` | **FIX** (no 呢鋪唔計; a long timed reveal could report a decoy-only seat as stalling) |
| AFK evil quest card: research says "ask host" | §5 autoAct | success | deliberate: asking the host would tell a playing host that the seat is evil |
| Eyes-closed narrated night (optional mode) | §1 | not built | out of scope: phone reveal is the research's default |
| Lancelot, Excalibur, Targeting, Plot cards | §1 | not built | out of scope (research: variants) |
