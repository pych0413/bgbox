# 狼人殺 werewolf — play-flow spec

> Rules source: `docs/research/werewolf.md` (2026-10-03, **including its "Verification" section**, whose corrections win:
> witch self-save "never" for 9–12, seer may not re-check, a shot victim has last words, exile-PK explode is off by default,
> HK usage 開眼 not 睜眼). Where the research lists a disagreement we pick the default it recommends and expose the
> popular variants as config. UI text is Hong Kong Cantonese; everything else English.
> Files: `js/games/werewolf/{game,script,ui,index}.js`, `style.css`; tests `tests/werewolf.test.mjs`.

## 1. At a glance

| | |
|---|---|
| Seats | **6–13** (`meta.players`). App-as-moderator: 6–12 players, every seat plays. Human moderator: the host seat holds no card, so 7–13 seats = 6–12 players. The 13th seat exists only for the moderator. |
| Time | 25–60 min (a night is ~2 min at the standard pace, a day is the speeches plus a 20 s vote) |
| Narration | **required** — the night is called out loud. It works in all three modes: 語音 (the phone speaks), 讀稿 (a human reads the big text and taps 下一步), 靜音 (every stage line is also printed on every phone, steps advance by their own clocks). Every cue is public information. |
| Single device | `partial` — works for the whole game on one passed phone (§4), but wolves hand the phone round and every step takes longer, so it defaults to the slow pace. |
| Banks | none |
| Paper mode | none |

The app is the 上帝/法官 (moderator): it deals, calls the night, resolves it, announces deaths in seat order, times
speeches, counts votes and judges the win. The people do all the talking and lying.

Roles in v1: 狼人 · 平民 · 預言家 · 女巫 · 獵人 · 守衛 · 白痴. **Not in v1:** 狼王, 白狼王 (the research allows omitting them),
the sheriff module (§8), 女巫 using both potions in one night, the "shot victim follows the shooter's last-words timing"
variant. The research's two official boards that need a 狼王/白狼王 are offered with plain wolves instead and say so.

## 2. Setup

### 2.1 Config

`config.defaults(n, prev, env)` fills everything; `env.singleDevice` (one phone holds every seat) forces the slow pace and
`voteSecs: 0` — the phone has to travel to every voter, and a vote clock would make the last ones abstain. `n` counts
**seats**; the number of players is `n − 1` with a human moderator.

| key | type | default | meaning |
|---|---|---|---|
| `moderator` | select | `app` | `app` 手機做主持 (everybody plays) · `human` 房主人手做上帝 (host holds no role, sees everything). Forced `human` at 13 seats, forced `app` below 7. |
| `board` | select | `auto` | `auto` = the recommended board for the head-count · a board id (§2.2) · `custom`. A saved board that does not fit the new head-count silently becomes `auto` (validate warns). |
| `roles` | roles `{id: count}` | recommended board | only used when `board` is `custom`: `werewolf` (min 1) and each god 0–1; the villagers fill the rest (shown as 自動). |
| `winRule` | select | `auto` | `auto` = the board's rule · `edge` 屠邊 · `city` 屠城. Custom boards: 6–8 players → 屠城, 9+ → 屠邊, and a board without a god or without a villager → 屠城. |
| `witchSelfSave` | select | `auto` | `auto` = the board's rule (custom boards: 6–8 players `first`, 9+ `never`, as the research recommends) · `never` · `first` (night 1 only) · `always`. Only shown when there is a witch. |
| `guardStack` | select | `die` | 同守同救: `die` (奶穿, official) or `live`. Only shown with both a guard and a witch. |
| `idiotIs` | select | `god` | the white-idiot counts as `god` (official) or `villager` for 屠邊. Only shown with an idiot. |
| `wolfVote` | select | `plurality` | wolves disagree: `plurality` (most picks, ties random) or `unanimous` (all the same target, else 空刀). 空刀 is itself a candidate under `plurality`. |
| `nightOrder` | select | `official` | `official` 守衛→狼人→女巫→預言家→獵人, or `tw` 狼人→預言家→守衛→女巫→獵人. Cosmetic: only the witch depends on another step. |
| `pace` | select | `normal` | `slow` / `normal` / `fast` — the fixed window of every night step and the final-action window (table below). |
| `lastWords` | select | `night1` | who gets 遺言: `night1` (night-1 deaths only, any number; official), `night1single` (night 1, or a night with exactly one death), `all`. Every death **by day** always speaks. |
| `hunterOrder` | select | `words` | per dead player: `words` (遺言, then the final action) or `shot` (final action, then 遺言). Same order for everybody. Only shown with a hunter. |
| `speakOrder` | select | `dead` | `dead` start next to the single dead player (random seat on a peaceful or multi-death night) · `random`. The direction flips every day. |
| `selfExplode` | select | `on` | `off` · `on` (during day speeches) · `pk` (also during PK speeches). Never during the vote, last words or the final action. |
| `openCard` | select | `auto` | 出局亮牌: `auto` follows the board (only the official 6-player 明牌 board) · `on` · `off`. |
| `spectate` | bool | `false` | dead players see every role. Off by default: a dead player's screen is the easiest one to leak. |
| `speakSecs` | seconds 0–300 | 60 | per speaker (day speeches and PK). 0 = no clock, the speaker taps 我講完. |
| `wordsSecs` | seconds 0–300 | 60 | per 遺言 — the research's and the official default (decision D7, 2026-10-04; was 45). A self-explode always gets 30 s (0 stays untimed). The 快玩 preset sets 30. |
| `voteSecs` | seconds 0–120 | 20 | the vote closes at the deadline and anyone who has not voted abstains. 0 = wait for everybody. |

Fixed window lengths (`pace`), in seconds:

| | 守衛 | 狼人 | 女巫 | 預言家 | 獵人 | 最後行動 |
|---|---|---|---|---|---|---|
| slow | 25 | 50 | 30 | 25 | 12 | 18 |
| normal | 15 | 35 | 20 | 15 | 8 | 12 |
| fast | 10 | 25 | 14 | 10 | 6 | 8 |

### 2.2 Recommended boards, with the reason shown to players

The first board of each head-count is what `defaults` picks (`board: 'auto'`). The reason is the help line under 角色配置 in the
lobby form, one short tag in the lobby summary (「💡 3 狼 3 神 3 民，屠邊」) and, once dealt, the board card on every phone.
`config.presets(n)` exposes the same boards (plus 新手慢慢嚟 / 快玩 / 人手上帝) as one-tap chips. The lobby merges a chip's `cfg`
over the current config, so every board chip also carries `moderator` (`app`, or `human` at 13 seats) — a 9-player board
picked while the host was the human moderator would otherwise be read as 8 players and fall back — and the 人手上帝 chip
carries `board: 'auto'` (the recommended board for one player fewer).

| id | players | board | rule · self-save | reason (abridged) |
|---|---|---|---|---|
| `6-sw` ★ | 6 | 2 狼 · 預 女 · 2 民 | 屠城 · first | 最易上手；好人得 4 個，屠邊殺 2 個就完，所以用屠城 |
| `6-sh` | 6 | 2 狼 · 預 獵 · 2 民 | 屠城 · 明牌 | 官方 6 人明牌局，出局要亮牌 |
| `7-swh` ★ | 7 | 2 狼 · 預 女 獵 · 2 民 | 屠城 · first | 教學局 |
| `7-hard` | 7 | 2 狼 · 預 女 獵 守 · 1 民 | 屠邊 · never | 硬核：只有 1 個平民（官方有白狼王，呢版用普通狼） |
| `8-swh` ★ | 8 | 3 狼 · 預 女 獵 · 2 民 | 屠城 · first | 8 人最常見 |
| `8-easy` | 8 | 2 狼 · 預 女 獵 · 3 民 | 屠城 · first | 好人易啲 |
| `9-swh` ★ | 9 | 3 狼 · 預 女 獵 · 3 民 | 屠邊 · **never** | 3/3/3 天然平衡；新手可改屠城 |
| `9-guard` | 9 | 3 狼 · 預 獵 守 · 3 民 | 屠邊 | 守衛局（守衛代替女巫） |
| `10-swh` ★ | 10 | 3 狼 · 預 女 獵 · 4 民 | 屠邊 · never | 官方 10 人速推局（官方有警長，呢版未有） |
| `10-idiot` | 10 | 3 狼 · 預 女 獵 白 · 3 民 | 屠邊 · first | 4 神職，女巫首夜可自救補返 |
| `11-swhi` ★ | 11 | 4 狼 · 預 女 獵 白 · 3 民 | 屠邊 · never | 11 人常見配置 |
| `11-easy` | 11 | 3 狼 · 預 女 獵 白 · 4 民 | 屠邊 · never | 好人易啲 |
| `11-guard` | 11 | 4 狼 · 預 女 獵 守 · 3 民 | 屠邊 · never | 守衛局 |
| `12-std` ★ | 12 | 4 狼 · 預 女 獵 白 · 4 民 | 屠邊 · never | 官方 12 人標準場（官方有警長，呢版未有） |
| `12-guard` | 12 | 4 狼 · 預 女 獵 守 · 4 民 | 屠邊 · never | 官方「狼王守衛」去咗狼王 |
| `12-noh` | 12 | 4 狼 · 預 女 守 白 · 4 民 | 屠邊 · never | 冇獵人 |

★ = recommended. Seat order is the circle: the lobby's seat editor must match how people really sit, because speaking and PK
order follow seat numbers (1..N among the players; the human moderator is not numbered).

### 2.3 Validation

Hard errors: seats outside 6–13 · `app` with 13 seats · `human` with fewer than 7 seats · any field out of range / not in its
enum · custom board with no wolf, more fixed roles than players, fewer than 2 good players · 屠邊 on a board with no god or no
villager. Warnings (never block): a saved board that no longer fits (replaced by the recommended one — says which) · the 硬核
board · wolves at least half the table · a human moderator (「旁白揀讀稿」) · a speech clock under 15 s · 10+ players
(「官方有警長，呢版暫時未有」).

Lobby summary lines: roles with counts · 🎙️ who moderates · ⚖️ 屠邊/屠城 · 🧪 女巫自救 rule · optional 守衛/白痴 variants ·
⏱ pace · 🗣 speech clock · 💥 / 🂠 / 👻 toggles · 💡 the reason tag.

## 3. Flow

Seats: **player** = a seated player; **moderator** = the host seat in human mode (no card). Dead players are spectators of
their own game: they keep seeing the public screens and (config) every role.

Every stage of the game is a *step* with a **cue** (the narrator line, blocking: the clock starts only when the narration is
finished, or the host taps 下一步) followed by its **run** (the fixed window / the speech / the vote). Cue ids are unique per
stage (`{gid}:{seq}:{cue|tail}`). Every phone also shows the stage's line (`view.say`) so 靜音 mode works.

**Spoken wording (zh-HK voice and 讀稿).** The narrator calls players by **name** (names are unique in a room; the seat
number is on every chip and roster row, and 「3號阿明」 reads badly aloud), counts are words (「兩票」 — a voice reads
"2 票" as 「二票」), ordinals are words (「第十四晚」), spoken lists end in 「同」 / 「或者」, and only seconds stay as digits
(「45 秒」 is read 「四十五秒」). Written text — the recap, the tally screen, notes — keeps the 「3號阿明」 form.

### 3.1 Deal

| who | screen |
|---|---|
| player | the 🃏 stage card with the line below; a hold-to-peek **RoleCard** (`做乜：… 點贏：…`; 點贏 states **this table's rule for the player's side** — a wolf 「今局屠城，要殺晒所有好人…」 or 「今局屠邊，…」, the good side 「所有狼人出局。（今局屠城：…）」 — never 「睇設定」; a wolf's card adds 「第一晚你會知邊個係隊友」, a guard / witch card the 同守同救 note); the board card (roles × counts, and the board's reason); 「睇完喇」 button; 「n / N 人睇完」 (a count, never who). The card has the shared 🔒 lock. The 📖 rules sheet (no table) names both rules. |
| moderator | 「你係上帝：唔攞牌，睇到全場身份」; the god panel (§3.10); no card |
| table / spectator | the board card and the count |

Cue (not blocking): 「派咗牌喇。每人㩒住張牌睇自己身份，睇完就㩒「睇完喇」。全部人睇完，就會天黑。」 (human mode: 「…今局房主做上帝，唔攞牌。」)
All ready → night 1. `@next` (or the moderator's 下一步) forces the start. Wolves do **not** see their teammates here.

### 3.2 Night

Order (per `nightOrder`, only roles that are **on the board**): `begin` → 守衛 → 狼人 → 女巫 → 預言家 → 獵人. Each role step is
**cue (open) → window (fixed seconds) → cue (close)**. The board is public, so calling exactly the board's roles every night
reveals nothing; a role that is dead or out of potions is still called, for the same length. The official order also wakes
the 白痴 on night 1 only, to confirm his identity: the app's deal already does that, the step carries no information and no
choice, and leaving it out on every board is not a tell, so it is omitted. A new step starts with clean chips (the previous
step's picks are shown only during its own closing line).

Narration (exact):

| step | open | close |
|---|---|---|
| begin | night 1: 「天黑請閉眼。大家將部手機放喺面前，閉埋眼，唔好偷望。」 later: 「第二晚，天黑請閉眼。」 | — |
| 守衛 | 「守衛請開眼。今晚你想守邊個？」 | 「守衛請閉眼。」 |
| 狼人 | night 1 「狼人請開眼。互相認一認隊友，再揀今晚殺邊個。」 later 「狼人請開眼。揀今晚殺邊個。」 | 「狼人請閉眼。」 |
| 女巫 | 「女巫請開眼。睇吓手機，決定今晚用唔用藥。」 | 「女巫請閉眼。」 |
| 預言家 | 「預言家請開眼。今晚你想驗邊個？」 | 「預言家請閉眼。」 |
| 獵人 | 「獵人請開眼。睇吓今晚你開唔開到槍。」 | 「獵人請閉眼。」 |

**The night screen — one layout for every seat, every step** (this is the anti-tell core). Every playing seat — wolf or
villager, alive or dead, with potions or without — gets the same four boxes, and the engine builds the content through the
same function for real actors and decoys; the UI never knows which it is.

1. the stage card (public): the step's title, the stage line and a silent progress bar (no beeps, no tick — a Timer would
   tell the room who is awake);
2. an **info card** of fixed minimum height (this seat's private lines);
3. a grid with **one chip per playing seat**;
4. two buttons: a *skip* (label varies) and 確定.

Interaction (identical for everybody): tap a chip → tentative pick (tap it again to un-pick); 確定 → lock it; the skip button →
lock "nobody". A locked seat is frozen (its chips go dark) — except a wolf, who may change his mind and unlocks by re-picking.
Whatever is tentative when the window closes counts. Nothing is optimistic: the screen changes when the host echoes the view.
During a step's opening line every phone's chips are grey and the hint reads 「準備緊…旁白讀完先㩒得。」 (same words for every seat), so a
tap in the cue is never dropped without a word. Chips carry the class `can` when tappable (not `on`, which tools read as "selected")
and `aria-pressed="true"` only on the picked or locked chip.

What each seat's info card says:

| seat | info card | chips enabled | skip label |
|---|---|---|---|
| 守衛 (alive) | 「上一晚你守咗 X，今晚唔可以再守佢。」 / first night 「你可以守任何人，包括自己。」 / after a skip 「上一晚你空守…」 | every living seat except last night's target (tagged 🚫上晚) | 空守（今晚唔守人） |
| 狼人 (alive) | 「🐺 隊友：6號阿F、7號阿G」(+ 已出局 mates) and 「揀今晚要殺邊個。你揀嘅同隊友揀嘅會即時顯示。」; hint = the `wolfVote` rule. Chips show a coloured dot per wolf who currently picked it; mates carry a 🐺 tag | every living seat (a mate or himself = 自刀) | 空刀（唔殺人） |
| 女巫 (alive, a potion left) | while the antidote is unused: 「今晚被狼人襲擊嘅係：X」 (「（你自己）」, 「呢個規則你唔可以自救」) or 「今晚冇人被狼人襲擊」; once used: 「解藥已經用咗，唔會再知道邊個被襲擊」; always 「解藥：有　毒藥：有」. The victim's chip is tagged 💊. **Her pick names the potion**: 確定 becomes 「💊 用解藥救 X」 / 「☠️ 用毒藥毒 X」 and the potions line gives way to 「☠️ 揀咗毒 X：時間到都會用，再㩒佢一次取消。」 (after 確定: 「☠️ 已確定：用毒藥毒 X」 / 「已確定：今晚唔用藥」) — it takes that line's place, so her panel never grows a line when she taps. The hint follows what she can still do (both · 「㩒一個人＝用毒藥…」 · 「…毒藥已經用咗」 · 「今晚冇藥用得…」). Her closing line says what was spent: 「💊 今晚你用咗解藥救 X。」 / 「☠️ …」 / 「今晚你冇用藥。」 | the victim chip = **antidote** (when allowed); every other living seat except herself = **poison** (when the poison is left). One tentative pick, so one potion a night. | 唔用藥 |
| 預言家 (alive) | 「揀一個人驗…」; after 確定: 「X 係：🐺 狼人 / ✅ 好人」. Past results are tags on the chips (✅/🐺) | living seats except himself and anybody already checked | 今晚唔驗 |
| 獵人 (alive) | 「你今晚冇被毒 👍 如果你出局，可以開槍…」 or 「你今晚被毒咗 👎 就算出局都開唔到槍」 (decoy chips) | decoy: every living seat | 知道喇 |
| **decoy** (everybody else; a dead role holder; a witch with both potions spent) | 「呢一步同你冇關係，繼續閉眼。」 / 「你已經出局，今晚冇得揀。」 / 「兩支藥都用晒喇…」 + 「想㩒就㩒：揀個人、㩒確定，扮有嘢做都得。」 | every living seat | 跳過 |

Decoy taps are stored like real ones (so the state and the legal actions are uniform) and are ignored when the window closes.
The witch's potion labels change only her own panel's words; every phone keeps the same boxes, chips and buttons.
No night window ever *blocks* (`engine.blocking`, §5): its clock ends it, so a dead phone is never flagged at night — flagging
the holders of the called role would point at them. The wolves' live picks, the witch's victim, the seer's result and the hunter's poison note are the only
differences, and none of them is visible to another seat.

Other night rules:
- **Wolves.** Each living wolf has a pick (or 空刀). At the window's end: `plurality` counts the picks (空刀 is a candidate; a tie
  is broken with the seeded rng); `unanimous` needs every living wolf to have picked the same target. No picks = no kill.
- **Guard.** His pick is final at the window's end (confirmed or not). A skip frees last night's target.
- **Witch.** The tentative pick is read at the window's end: the victim chip = 救 (if the antidote is left and allowed — self-save
  follows `witchSelfSave`), any other chip = 毒 (if the poison is left and not herself). Potions are spent only then.
- **Seer.** The result appears on 確定, so a seer cannot tap through the table. An unconfirmed pick resolves at the window's
  end and the result is kept in his notes.
- Dead roles and used-up potions never change a window's length. Nothing a seat taps is reflected on any other seat's screen,
  verified by a test (a wolf's view does not change when the seer confirms).

**Resolution (at dawn, all effects at once).** `G` = attacked and guarded, `H` = attacked and healed.
Wolf kill lands when `G == H` (nothing, or the 奶穿 double); with `guardStack: live` it lands only when neither. Poison always
kills, and a victim who is both attacked and poisoned dies with cause 毒 (a hunter in that state cannot shoot).

### 3.3 Dawn

Cue (public, no cause): 「天光喇，請大家開眼。昨晚死咗嘅係阿明同阿B。」 sorted by **ascending seat**; a quiet night:
「天光喇，請大家開眼。昨晚係平安夜，冇人死。」 With 出局亮牌 a sentence follows: 「阿明係獵人，阿B係平民。」
Screen (everybody): 🌅 「昨晚出局」 and a chip per dead player, or 「平安夜，冇人死」.
The dawn cue stays up for **at least 8 s** (`S.DAWN_MIN_MS`, also in 語音; other cues keep `cueMinMs`): in 靜音 it is the only place the
night's result is said, and the playtest's ≈3 s card was missed by half the table. After the dawn every day screen keeps it in the
stage card — 「🌅 昨晚：平安夜」 / 「🌅 昨晚出局：2號阿明、5號阿強」 (seat order, no cause; public `view.lastNight`) — until night falls.
The win check runs here, **before** any death trigger: if the game is decided, the dawn is still announced and then the game ends.

### 3.4 Death triggers: 遺言 and 最後行動

For every newly dead player in ascending seat order the step list is `words` and `final` (order per `hunterOrder`).

**遺言 (`words`).** Who: every day death (exile, shot, self-explode — the explode gets 30 s) and, per `lastWords`, night-1 deaths.
Cue: 「阿明，請講遺言。你有 60 秒。」 Screen: the speaker list with a single 🎙 row; the speaker has 我講完. The timer, 我講完 or 下一步
ends it.

**最後行動 (`final`).** Present **iff a hunter is on the board**, for **every** dead player (poisoned, wolf-killed, exiled,
shot, exploded), always the same fixed length. Cue: 「阿明出局。最後行動時間，有技能嘅人請喺 12 秒內使用。」
Only the dead seat gets a panel (the night layout). It is daytime and the table is watching, so the panel is **word for word the same**
for a hunter, a poisoned hunter and anybody else: 「🏹 最後行動時間」 / 「獵人可以揀一個人開槍帶走（被毒死就開唔到）。其他人等時間過，照㩒都冇效果。」,
skip 「唔開槍」; his 💡 line is the same for everybody too (「最後行動：獵人揀一個人開槍（被毒死除外），其他人等時間過。」); everyone else sees 🏹 「3號阿明 出局，最後行動時間」 and a timer. The window never ends
early. If the shooter picked a living player (tentative counts) the shot happens at the end: the victim dies at once, his own
steps (遺言, 最後行動) go **in front of** the rest of the queue (a chain), and a public line follows:
「阿C係獵人，開槍帶走咗阿D！」 (明牌: 「阿D係預言家。」 follows). A hunter who holds fire or times out announces nothing — exactly like a non-hunter.
Shot victims always get 遺言 (a daytime death; research default).

### 3.5 Discussion

One `speech` step per living player (a flipped idiot included), once each. Order: `speakOrder`; direction flips every day (a
random bit on day 1); with `dead` the start is the first living seat after the single dead player in today's direction, else a
random living seat. Cues: first 「而家開始發言，由阿E開始，跟住係阿F、阿G，之後按座位號順數落去。每人 60 秒。」 (倒數 the other way; the
next two speakers are NAMED because 「由大到細，由阿聰開始」 read wrong when 阿聰 was seat 1 and the order wrapped to 6, 5, 4…) then 「阿F請發言。」 and
「最後一位，阿I請發言。」 (the clock is read once; it is on every screen). Screen: the whole order with ✅ 已講 / 🎙 講緊 / ⏳ 等緊, the clock in the stage card, 我講完 on the
speaker's phone, and — for every **living** seat — the **💥 自爆** control (a 1 s hold). It is the same control on every
living phone; a non-wolf's hold sends the same message and the engine ignores it, with identical on-screen feedback.
Dead seats and the moderator do not get it. A speech with a clock never blocks; with `speakSecs: 0` only the speaker does.

### 3.6 Vote

Cue: 「發言完畢，請大家投票。揀你覺得係狼人嘅人，唔想投可以棄權。」 Voters: every living player except a flipped idiot (and a 💤
absent seat, §3.11). Candidates: every living player (including yourself, a flipped idiot and an absent seat — its name carries 💤).
Screen: the shared **VotePanel** (pick → 確定, 改票 until the vote closes, 棄權) with **`secretChoice`** (decision D6): your own phone
says 「確定投票」 / 「已投 ✓」 and never lights or names whom you picked, so a glance across the table learns nothing before the tally; a
progress count 「已投 n/N」 (never who). Voters who cannot vote see why (dead / flipped idiot / PK / 💤 「房主當咗你暫時離開，今次唔使投票。
返嚟咗就同房主講聲。」).
The vote closes when everyone has voted, at `voteSecs`, or on 下一步; non-voters abstain. Nothing about anybody's ballot is in
another seat's view before the tally.

### 3.7 Tally, PK, exile, idiot flip

Public tally screen: the VotePanel's reveal with 票型 (who voted whom), the abstainers listed, and the verdict. Cue:
「投票結果：阿G四票，阿H兩票。阿G得票最多，被放逐。」 The tally is read ballot by ballot, so its cue stays up **4 s + 0.8 s per voter,
at most 15 s** (`S.tallyMinMs`, decision D7; the text's own reading time when that is longer): 7.2 s for 4 voters, 11.2 s for 9, 13.6 s
for 12. Every other cue keeps `cueMinMs`; the dawn keeps its 8 s floor.

- **Unique top** → exile: 遺言 (and the final window) follow, then night. Winner check at once.
  If the top is an **unflipped 白痴**: nobody dies; 「阿I翻牌，係白痴！唔使出局，不過以後冇投票權。」 He keeps speaking, is still a
  candidate, still counts as a living god (or villager, `idiotIs`), has no 遺言 and no final window; a second exile kills him normally.
- **Tie (2 or more)** → 「…阿G、阿H同票，要 PK。」 each tied player gives a PK speech in seat order (「阿G同阿H平票，要 PK 發言。阿G先講。」,
  then 「到阿H PK 發言。」), then a second vote among **only the tied players** by everyone who is not tied (and not a flipped idiot).
  Cue 「再投一次，淨係可以揀阿G或者阿H。PK 嘅人今次唔投。」 If nobody is left to vote → 「…除咗同票嘅人，冇人可以再投，今日係平安日。」
- **Second tie, or everybody abstains** → 平安日 (「第二次都係平票，今日係平安日，冇人出局。」), nobody exiled, no further PK, straight to night.
  The tally screen's verdict line says why it is a 平安日: 「第二次都平票：今日平安日」 / 「除咗同票嘅人冇人可以投：今日平安日」 / 「今日平安日，冇人出局」.

**🗳 之前嘅投票（票型）.** The tally is up for a few seconds, so every day screen (not the night) also carries the shell's public fold
(`view.recent`, rendered by the play screen's **RecentFold** under the game, closed until tapped): every vote so far, newest first — entry
「第 1 日・PK 投票」, lines 「4號阿D 3 票（1號阿A、2號阿B、3號阿C）」 · 「棄權：7號阿G」 · 「➜ 1號阿A 被放逐」 (the recap's grouping). It is built
from the public `view.voteLog` (resolved votes only — an open ballot never shows).

### 3.8 Self-explode

Allowed during a day speech (`selfExplode: on`) or also during PK speeches (`pk`), in the speech's cue or run stage. Refused
during the vote, last words, the final window, announcements and the night, and for anyone who is not a living wolf. Effect: the
wolf dies (cause 自爆, revealed as a wolf), the remaining speeches and the vote are cancelled, he gets 遺言 (30 s) and the final window,
then it is night. The first accepted explode wins; a second wolf pressing a moment later finds the day already over. If it was
the last wolf, the game ends after the announcement. Cue: 「阿明自爆！佢係狼人。今日即刻完結，直接入夜。」

Window choice: the research's official default is "any time in the day" (including 遺言), with "own speech only" and "not in exile
PK" as variants. We allow it from the first speech's opening line onwards, which gives a wolf the same tactical option as an
explode during the dawn's 遺言 (the day is cut before any discussion or vote) without cutting off a dead player's last words
or dropping a pending hunter window from the queue. The vote is the cutoff (research edge case: deny once the vote started).

### 3.9 Game over, results, and the recap of hidden actions

`result()` = `{ winners, summary, lines }` (plus `spectators: [hostPid]` with a human moderator, nothing otherwise). `winners` is the whole
winning camp (dead players included); a draw has none. `spectators` tells the Room the god sat this game out, so his `scoreboard.played`
stays put; it never appears in an app-moderated game, where the host plays.

- **Wolves win** (屠邊: all gods dead *or* all villagers dead; 屠城: all gods *and* villagers dead) or **good wins** (all wolves
  dead). If both qualify at once the **wolves win** (狼刀優先). The check runs after every death batch and **before** any trigger.
  When that win also took the last wolf (`state.winBoth`), the why adds 「最後一隻狼同一晚都出咗局，不過狼人嘅條件同時達成：兩邊一齊達成，
  算狼人贏（狼刀優先）。」 — the roles list shows every wolf dead, and without it the win reads like a bug (playtest p5).
- **Draw (a safeguard we added, not in the research):** six consecutive day+night rounds in which nobody left the game.
  Without it a table of passive wolves and abstaining voters could play forever. Summary 「打和：連續幾日夜都冇人出局」.

`lines` (all Cantonese, plain strings), in order. A line 「── 標題 ──」 starts a foldable section on the results screen
(`ui/logic.js` `resultSections`): the why stays open on top, the roles and every night / day fold under their own heading;
a renderer without sections still shows a readable list.

```
屠邊：神職全部出局，或者平民全部出局，狼人就贏。      ← why (rule + which edge fell)
今次係平民先俾殺晒。
📜 下面逐晚回顧，包括你哋睇唔到嘅操作（㩒標題打開）。
── 🎭 身份揭曉 ──
　1號阿明：🐺 狼人　第 2 日被放逐
　5號阿E：🔮 預言家　第 1 夜被毒死
　9號阿I：🤡 白痴（翻過牌）　生存到最後
　…
── 🌙 第 1 夜 ──
　🛡️ 守衛（8號阿H）守咗 10號阿J
　🐺 狼人：1號阿明→10號阿J、2號阿B→10號阿J　⇒ 襲擊 10號阿J（一致）
　🧪 女巫（6號阿F）用毒藥毒咗 11號阿K
　🔮 預言家（5號阿E）驗咗 1號阿明：🐺 狼人
　🏹 獵人（7號阿G）冇被毒
　➜ 結果：11號阿K 被毒死（10號阿J 被守衛守住，冇事）
── ☀️ 第 1 日 ──
　🗳 投票：2號阿B 4 票（1號阿明、5號阿E、…）；3號阿C 1 票（2號阿B）；棄權：9號阿I
　　➜ 2號阿B 被放逐
　🏹 3號阿C 開槍帶走咗 …   💥 …自爆   🤡 …翻牌
```

Night lines explain 奶穿, 毒穿, a saved victim, a guarded victim, a poisoned hunter and a peaceful night. The wolves' verdict says how
it came about: （一致） every living wolf picked it · （其他狼人冇揀） the ones who picked agreed, the rest never picked ·
（票數最多） · （同票，隨機揀） · 空刀 with （冇狼人揀） / （意見唔一致） (`unanimous`) or nothing when they chose 空刀. Votes are
grouped by target, most votes first, then the abstainers (「全部棄權」 when nobody voted). The in-game `over` screen
shows the banner, every role and how/when each player left; the room's results screen shows `summary` and `lines`.

### 3.10 Human moderator (上帝 mode)

The host seat holds no card, is not numbered, gets no chip, no ballot and no speech slot. The moderator's view carries a
`god` block (and only his view does): every role, the witch's potions, the guard's last target and — during a night window — each
actor's live pick/lock, the wolves' target the moment it is fixed, the seer's result, tonight's guard/save/poison. The god
panel also has a big **⏭ 下一步** (the engine action `{ type: 'skip' }`, accepted from the host seat only; same effect as
`@next`). The moderator reads the line shown in the stage card (旁白: 讀稿), taps 下一步 to start each window, may tap again to cut a
window short, and may 代佢做 for a disconnected player from the ⋯ menu. His screen is never dimmed at night. The results list the moderator
(🎙️ 上帝：…) and exclude him from `winners`.


### 3.11 A seat that stops responding: 💤 absent (decision D4)

A friend leaves the table with the phone still connected (iOS keeps the link up, so the stall detector never fires). The host
marks the seat absent from the shell (`{ type: '@absent', pid }`, ACT.ABSENT; `@present` brings it back). From then on, for the rest
of this game:

- **Nothing waits for it.** The deal starts the night once every *present* seat has tapped 睇完喇 (the count reads 「n / present」);
  it is not a voter in any vote opened later (still a candidate), and in an open vote it stops being waited for — a ballot it cast
  before it left stands; if it was the last missing voter the vote resolves at once; its queued speech and 遺言 turns are dropped
  and the turns left are renumbered (「發言 3/7」, 最後一位, and the next PK speaker gets the 「…平票，要 PK 發言」 opening); its own
  turn in progress ends at once. A seat that is already absent when it ties stays a PK candidate but gets no PK speech (the
  present tied seats are numbered 1/n, so the first still gets the opening). A PK whose only possible voters are absent is a
  平安日 (「除咗同票嘅人冇人可以投」).
- **It is still a player.** It can be killed, exiled or shot; it counts for the win; at night it wakes and gets its panel like
  anybody (every night step already runs on a fixed clock and never waits for anyone, so absence changes nothing a sleeping
  table could notice). Its 最後行動 window keeps its fixed length (anti-tell); its 遺言 is dropped.
- **Public.** `seats[].absent` is the same on every phone; the roster chip and the ballot name show 💤; `my.absent` on its own
  phone; `engine.blocking` is false for it. `@present` makes it count again and, while a vote is open, makes it a voter of that
  vote if it may vote (alive, not flipped, not PK-tied). Turns already dropped are not given back.
- Unchanged state (the shell says this game cannot do it): an unknown seat, the human moderator, a seat already absent / present,
  or a finished game.

## 4. Single-device play

One phone in the middle, voice on. The shell's pass-gate does the hand-overs; the engine only supplies `focus`.

- **Night:** during a window `focus = { pids: every holder of the called role (alive or dead, potions or not), anonymous: '守衛請拎起部手機' }`.
  The gate shows the role prompt, never a name, so the phone is passed at the same moment whether the holder is alive or not, and
  a dead seer takes the phone and plays a decoy. With several wolves the list shrinks as each wolf confirms, so the gate
  moves on to the next wolf (a wolf who re-picks comes back into the list). Other roles do not shrink (a lit screen going dark
  would say who finished).
- **Day:** vote → the unvoted voters in seat order (each behind a gate); 最後行動 → the dead seat; speeches and 遺言 → nobody
  (use ⋯ → 下一步, or give `speakSecs`).
- `defaults(n, prev, { singleDevice: true })` sets `pace: 'slow'` because every step now includes a hand-over, and `voteSecs: 0`
  because the phone has to reach every voter before the vote can close.
- Realistically fine up to ~8 players; 12 people around one phone is cramped (the research says so too).

## 5. Engine

**Step machine.** `state.cur` = the current step `{ k, stage }`, `state.q` = the queue behind it. Kinds: `night` (`begin` and
the role steps; stages `cue` → `run` → `tail`), `dawn`, `words`, `final`, `say` (`tally` · `shot` · `flip` · `explode`),
`speech`, `vote`, plus the sentinel `plan` (`discuss`, `night`). `state.phase` ∈ `deal night dawn words final say speech vote over`
and is also in every view.

Queue discipline: night resolution builds `[dawn, …death steps…, plan:discuss]`; discussion pushes the speeches and the vote in
front; a vote result pushes `[tally, …outcome steps…, plan:night]`; a hunter's shot and a self-explode push in front / replace the
queue. After a win only `dawn` and `say` steps still play, so the last announcement is never lost and no trigger ever runs.

PRIVATE state (never in any view before `over`, except through the per-seat blocks below): `role`, `nt` (the night's picks,
`attacked / guarded / saved / poisoned / seer`), `potion`, `guardLast`, `notes`, `rec` (recap), `cur.sel` / `cur.votes`.

### Actions (all validated; bad input returns the state unchanged, never throws)

| action | from | when | rule |
|---|---|---|---|
| `{type:'ready'}` | a player | `deal` | idempotent; all ready → night 1 |
| `{type:'night', pick?: pid\|null, lock?: bool}` | a player | a role step's window | `pick` must be null or a chip the **panel** enables for this seat; a locked seat is frozen (wolves excepted: a new pick unlocks); `lock:true` with no pick locks "nobody" |
| `{type:'final', pick?, lock?}` | the dead player | his `final` window | same, targets = living seats; only a hunter who is not poisoned has an effect |
| `{type:'done'}` | the speaker | `speech` / `words` run | ends the turn |
| `{type:'vote', target: pid\|null}` | a voter | `vote` run | target ∈ candidates or null (abstain); replaceable until the vote closes |
| `{type:'explode'}` | a living wolf | `speech` (cue or run; PK only with `pk`) | everything else is a no-op |
| `{type:'skip'}` | the human moderator | any | = `@next` |
| `@cue-done {id}` | host | a pending cue | matched by id; starts the run / ends an announcement |
| `@next` | host | any | `deal` → start; a cue → its run; a run → its end (commit); a tail → the next step |
| `@absent {pid}` / `@present {pid}` | host | any before `over` | §3.11: a player seat stops / starts being waited for; unchanged for an unknown seat, the moderator, or a seat already in that state |

`legalActions` is exactly the actions above that would change the state (a locked non-wolf has none; an already-chosen pick is
not offered twice), **including `explode` for a living wolf** while it is allowed. That is safe because legalActions never leaves
the host and the stall detector asks `engine.blocking` first. `autoAct`: ready · confirm what is tentative at night / final ·
done · abstain · (moderator) skip — never explode.

`engine.blocking(state, pid)` — is the game *waiting* on this seat (so a dead phone stalls the table)? Session/room stall
detection asks it before anything else. True only for: an unready seat at the deal; the speaker of an untimed speech / 遺言
(`speakSecs` / `wordsSecs` 0); a voter who has not voted in an untimed vote (`voteSecs` 0). False for every night window and
the final-action window (fixed clocks — flagging the holders of the called role would point at them), any step with a running
deadline, every narration line and announcement, a wolf's chance to explode, the human moderator (his 下一步 is optional), and a
seat the host marked 💤 absent (§3.11).

`@void-round` (呢鋪唔計) is **not supported** and leaves the state unchanged: nothing in this game can be undone (deaths and
potions are permanent; replaying a vote would let the host overturn an exile). A dead phone is covered by the clocks, autoAct
and 下一步.

### Views (whitelist)

Common: `me, mod, isMod, phase, n, d, seq, title, subtitle, night, say, hint, board, opts, seats, alive, stage, voteLog, lastNight?, recent?,
deadline?, span?, timerLabel?, hintRoleText?`. `seats` = `[{pid, no, alive, flipped, absent?, how?, at?, role?}]` (`absent` = the host marked it 💤, §3.11): `role` **only when public** — dead seats with
出局亮牌, and everybody at `over` / for the moderator / for dead spectators (`spectate`). **Never the viewer's own seat**: it is in `my`,
and the UI keeps it behind a cover (a role glyph on your own chip was readable from the next seat all day — playtest #2). `how` only for
public causes (exile, shot, explode) until `over`. `lastNight = { n, deaths[] }` (seat order, no cause) on the day phases after that
dawn; `voteLog = [{ d, round, votes[{by,to}], outcome, pid, tied }]`, every resolved vote (public 票型), present in every view;
`recent` (day phases, once a vote has happened) = the shell's fold shape `[{ id: 'ww-votes', title, entries[{ title, lines }] }]` built from it. Per-seat `my = { role, alive, flipped, ready, canVote, notes[], mates?, potion?, absent? }` (`mates` wolves only,
`potion` the witch only, `notes` = the seat's own seer / guard / witch records). Phase blocks: `ready` · `nt` (the panel:
`step stage chips[{pid on mark tag by}] info hint skip ok pick set lock`, **same keys for every seat**) · `dawn` · `words` ·
`final` (`nt` only for the dead seat) · `sayInfo` · `speech` (with the public `order`) · `vote` (`cands voters progress myVote?`) · `over`.
`view.roleId` = the seat's own role id (players only; never for the table or the moderator) — the shell's 💡 sheet reads it.
`view.hintRoleText` = `{ what, win }` for that card at THIS table (`S.roleHintText`): the board's extra line (隊友, 同守同救) under 做乜
and only this table's rule (屠邊 or 屠城) under 點贏, so the 💡 role box never says 「睇房主設定」. It is built from the role, the board and
the win rule only — every seat holding the same card gets the same words, all game.
`view.hint` is one line (≤ 40 characters) for the 💡 sheet, built only from what that seat may know: its own panel at night
(real actor → the role's how-to, decoy → 「呢一步冇你份…」, dead → 「你已經出局…」), its own turn by day, otherwise the public
step — **by day never the seat's card** (the sheet's 而家要做咩 is plain text on a face-up phone; only its role box is covered), so the
lines are worded for both sides (「聽人發言：記低邊個講咩，諗吓邊個似狼、邊個似神職。」, 「揀一個你想放逐嘅人…」) and a dead hunter's 最後行動 line is everybody's; a dead seat gets 「你已經出局：可以睇，但唔好出聲。」 except for its own 遺言 / 最後行動; a non-voter is told why
(翻咗牌 / PK); the moderator and the table get their own lines.

### Focus

`deal` → unready seats · night window → holders of the called role (wolves: who have not locked) with `anonymous` · `final` window →
the dead seat · `vote` run → voters who have not voted · otherwise `null`.

## 6. Edge cases → the test list (`tests/werewolf.test.mjs`)

Every bullet of the research's "Edge cases an engine must handle" has a test, grouped:

- **Config.** Every preset sums to its head-count and is a legal board; recommended boards per head-count; `defaults` valid for every seat
  count 6–13 (13 forced `human`); keeps / sanitises `prev`; follows the head-count; `singleDevice` → slow + untimed vote; validation of
  every field and of custom boards; effective rules follow the board unless overridden (custom: 屠城 / first-night self-save on 6–8,
  屠邊 / never on 9+); fields adapt to the board and show the reason; summary; `presets` are valid patches with reasons, a board chip
  never falls back even over a human-moderator config, the 上帝 chip lands on the board for one player fewer.
- **Deal.** Roles match the board; shuffled and deterministic per seed; human moderator holds no role / no number / `hostPid` honoured;
  ready is counted never named; the cue never blocks.
- **Night.** Only board roles are called, in the official or Taiwan order, dead holders included; every step is cue → fixed window →
  tail and never ends early (even when everyone has confirmed); window lengths per pace; cues are public, unique and id-matched; **every
  seat has a legal action during every step** (real actors, dead holders, used-up witch, villagers; official and Taiwan order; every
  pace) and the clock never moves when everybody confirms; **the night screen has the same shape for every seat**; a new step starts
  with clean chips; every playing seat is dimmed, the moderator is not.
- **Night rules.** The full truth table (nothing / guard / heal / 奶穿 / poison / 毒穿 / 空刀 / nobody picks / 自刀 / self-guard);
  poison beats the antidote and the guard; `guardStack: live`; ascending-seat announcements with no cause; guard no-repeat, self
  guard, skip frees, tentative pick counts, dead guard guards nobody; locked seats are frozen, wolves may re-pick; plurality / tie
  random (seeded) / 空刀 candidate / dead wolves ignored / unanimous; wolves see live picks and mates, nobody else does; lone wolf; witch
  sees the victim only while the antidote is unused, victim chip = antidote and other chip = poison, one potion a night, never poisons
  herself, self-save never / first / always, still poisons when she is the victim, no victim = poison only, used-up and dead witch
  are decoys; hunter step (poison note, never an attack note); seer result only after 確定, camp only, no self / dead / repeat check,
  auto-resolve at the window's end, dead / idle seer; no decoy tap is visible to anybody.
- **Day.** Last-words rules (night1 / night1single / all, day deaths always, poison included on night 1); 遺言 timers; the final window
  exists iff a hunter is on the board, is the same length for every dead player and looks the same to bystanders; hunter shot, shot
  victim speaks and gets his own window; poisoned hunter / hold fire / timeout; exiled hunter; `hunterOrder: shot`; **win before
  triggers** (last-god hunter never shoots); a shot that ends the game is announced then the game ends; 明牌 reveals roles.
- **Speeches.** Start next to a lone dead player in today's direction, every living player once, direction flips daily, random start is
  seeded, a flipped idiot still speaks, done / timer / @next / only the speaker, the last speaker.
- **Votes.** Voters and candidates (flipped idiot, dead, self), secrecy and progress, change of vote, unique top, public 票型, timer and
  abstain-on-timeout, no-timer waits, all abstain, tie → PK (the tied never vote), second tie, three-way tie, nobody left to vote.
- **Idiot.** Flip (no death / no words / no vote / still speaks), second exile kills, dies to wolves and counts as a god, `idiotIs`.
- **Explode.** Ends the day, words 30 s (0 untimed), non-wolf / dead / `off` / vote / words / final / night refused, PK flag, double
  explode resolves once, last wolf explodes → good wins, `legalActions` offers it to a living wolf only.
- **Winning.** 屠邊 both edges, 屠城, good wins, wolves-first priority, the six-round draw and its counter reset.
- **Human moderator.** god block for the host only, live picks, skips alone finish a game, nobody else may skip, moderator is not a
  player anywhere, 13 seats.
- **Focus / autoAct / @next / garbage / legalActions** (every offered action changes the state).
- **Framework hooks.** `engine.blocking` per phase (deal, untimed speech / 遺言 / vote; never night, final, announcements, clocks,
  the moderator, garbage) and through a real `Session`; `@void-round` never changes the state; spoken cues of random games carry
  no seat number, no digit vote count, no 二票 and no digit ordinal.
- **Leaks.** At every step of random games: no view mentions a role it may not know, and (metamorphic) **a seat's view does not change
  when two *other* seats swap roles** (a wolf's teammates excepted); notes / potions / mates are the owner's alone; night causes of death stay
  secret; spectate on/off; views are fresh and JSON-safe.
- **Result.** Winners are the camp, the summary says why, the recap contains guard / wolves / witch / seer / hunter lines, 奶穿 / 毒穿 /
  saved / guarded, shots, flips, explodes, the moderator line, votes grouped by target, 「其他狼人冇揀」, the lines fold into sections (why · roles · one per night / day).
- **Contract.** `view.hint` (≤ 40 characters) for every phase and seat, role text splits into 做乜 / 點贏, `view.roleId` is the own card,
  `rules.quick` ≤ 6 lines of ≤ 34 characters.
- **Fuzz.** Every seat count 6–13 × 100 seeds (invariants on every step: the dead stay dead, voters / candidates / speakers are legal, night panels
  keep one shape, the final window is a fixed length, state is plain JSON, once decided only announcements remain), the stock `Sim.runRandom`,
  eight rule variants, dead-phone `autoAct`-only games, balance sanity (both camps win, every seat wins and sees every role).
- **UI** (fake DOM): every phase renders for every seat idempotently; one night shape; no `sfx` at night; a whole game finished by tapping;
  deal / god / explode / vote / final screens.
- **Playtest fixes (2026-10).** No role in the roster for its owner (明牌 dead excepted); by day no secret outside a cover — 我嘅身份 starts
  closed, no glyph on the own chip, mates / potions / notes only on the 📓 cover, and (metamorphic) **a phone's uncovered screen through a
  whole day does not change when its own card is swapped**; the dead player's final panel is word for word the same for a hunter; dawn
  `minMs ≥ 8000`; `lastNight` / `voteLog` public and identical on every phone, no open ballot in the log; the 昨晚 line and the 票型 fold
  on screen; the witch's potion labels, undo by re-tap, potion-state hints, closing line and the cue's 「準備緊…」; 狼刀優先 explained;
  the role card's table rule; the day 💡 line is the same for a wolf and a good seat, and for a hunter and anybody else in 最後行動; the witch's
  pick line replaces her potions line (a tap never grows her panel); the speaking-order cue names the next speakers; chip `can` / `aria-pressed`.
- **Decisions (2026-10-04).** 遺言 60 s by default (快玩 30); the 票型 cue `4000 + 800 × voters` ms, capped at 15 s; the vote screen passes
  `secretChoice` (and 💤 on an absent candidate); `view.hintRoleText` is this table's rule, the same for every holder of a card, all game,
  and is what the shell's 💡 sheet shows; **@absent / @present** at the deal (the night starts without it), in a vote (not a voter, still a
  candidate, a cast ballot stands, the last missing voter closes it, @present rejoins an open vote), in PK (not a voter; only-absent voters →
  平安日), in speeches (turn dropped and renumbered, its own turn ends at once, 最後一位 still right, no turn next day), 遺言 dropped but the
  final window kept, public and identical `seats[].absent`, never `blocking`, garbage / moderator / over unchanged; a fuzz that marks random
  seats absent and back through whole games (nothing ever waits on or gives the floor to an absent seat).

## 7. 貼心 touches

- Every head-count has a recommended board **and the reason** (「6 人用屠城，免得 2 刀就完」), in the lobby, on the deal card and in `presets`.
- A decoy that is exactly the same shape as the real thing for every seat, including the dead, the used-up witch and the villagers; no
  sound, no timer beep, no lit screen that depends on a role; the shell's black 閉眼 screen between a seat's own steps.
- The 最後行動 window after **every** death once a hunter is on the board, so nobody can tell the hunter by the pause.
- 💥 自爆 on every living phone with a 1 s hold (no accidental explode) and an honest note that it does nothing for non-wolves.
- Wolves see each other's picks live (dots on the chips) and may change their minds until the window closes — no gestures needed.
- The witch's one-tap logic (「㩒被襲擊嗰位 = 救，㩒其他人 = 毒」) shows her potions at all times and tells her honestly when she is the victim and may not save herself.
  Her button names the potion a tap would spend (「☠️ 用毒藥毒 X」), a second tap on the chip takes a stray pick back, and her closing line says what she did.
- A face-up phone by day shows no secret: 「我嘅身份」 starts folded, your own chip has only the gold ring, and a wolf's mates, the witch's potions
  and every night record sit on a hold-to-peek 📓 cover that every card holder has (a villager's says 「冇夜晚記錄」) and that shares the card's 🔒.
- The night's result and every past 票型 can be found again all day (「🌅 昨晚…」 in the stage card, the shell's 🗳 之前嘅投票 fold under the game).
- The role card says this table's win rule for your side, and the day 💡 lines serve both sides (a wolf is not told to hunt wolves) without
  ever depending on your card — the sheet is plain text on a face-up phone.
- The seer's board remembers his results (✅/🐺 on the chips) and cannot waste a night on a repeat or on himself.
- A 💡 hint for every phase and every seat, and role text split into 做乜 / 點贏; the 💡 role box states this table's rule (屠邊 or 屠城).
- Your own ballot is never on your screen (「已投 ✓」) until the tally; the 票型 stays up long enough to read every ballot.
- A friend who leaves the table does not freeze it: the host marks the seat 💤 and the deal, the votes and the speeches go on without it.
- Public stage line on every phone, so 靜音 and 讀稿 modes never need the host's speaker.
- The shared phone never learns a name at night; the dead take the phone like everybody else.
- A human moderator who sees everything, live, with one big 下一步, and can still 代佢做 a dropped phone.
- The results explain **why** and replay every night, including what nobody could see (the guard's choice, the wolves' picks, the witch's
  potion, the seer's checks, 奶穿 and 毒穿).
- Dead players keep a read-only public screen; roles stay hidden from them unless the group turns `spectate` on.

## 8. Not in v1 / framework requests

Deferred on purpose (so tell the players, as `rules.sections` does):
- **Sheriff** 警長 (opt-in, speeches, 退水, 1.5 vote, 歸票, badge hand-over, single / double explode). The official 10–12 player boards have
  one; we run them without. The vote tally is already per-voter, so a weight of 3 (halves) is a small addition. Warned in the lobby for 10+.
- 狼王 / 白狼王 (and the research's other advanced roles), both potions in one night, `shotVictimLastWords: inherit`, `winPriority: good`,
  `hunterShootsOnBlast`, `flippedIdiotVotable: false`, `seerRecheck`.
- A self-poisoning witch is not allowed (the research: "any living player"; self-poison is never useful).

Requests for the framework (status 2026-10-03 UTC):
1. ~~`Sim` should pass `hostPid` to `setup`~~ — done (G1): `setup` uses `hostPid`, `Sim` passes `'p1'`.
2. ~~The room should keep a seat the engine marks as a non-player (the human moderator) out of `scoreboard.played`~~ — done: `Room#finish`
   honours `result.spectators: [pid]`; `result()` returns the moderator's pid there when `config.moderator === 'human'`, never otherwise.
3. ~~An engine-provided `waitingOn(pid)` for the stall detector~~ — done as `engine.blocking` (implemented here, §5).
4. NarratorBar in 讀稿 mode keeps 下一步 enabled during a running window, so a double tap skips it (the engine treats the first `@next` as the
   cue acknowledgement and the second as a skip, like 9upper). A short debounce there would protect a human narrator.
5. The shell dims a seat at night unless `focus` names it. A dead non-holder is dimmed for the whole night, which is intended; if the shell ever
   wants a spectator view of the night it must not read `view.nt` (it is a decoy for them).
