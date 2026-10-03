# 芝士大盜 (`cheese-thief`) — play-flow spec

> Rules source: `docs/research/cheese-thief.md` (official rulebook + designer rulings, tags [O] [D] [C] [I] there).
> Code: `js/games/cheese-thief/{game,script,ui,index}.js`, `style.css`. Tests: `tests/cheese-thief.test.mjs`.
> All user-facing text is Hong Kong Cantonese. Times are UTC.

## 1. At a glance

| | |
|---|---|
| Players | 4–8 (best 6–8). 9+ is not supported by the publisher, so the picker greys it out. |
| Length | 10–15 min: ≈ 1 min dealing, ≈ 2.5–3 min night, 5 min talk (default), ≈ 1 min vote + reveal. |
| Narration | `required` — the night is read aloud hour by hour. Works in all three modes: 語音 (phone speaks), 讀稿 (host or a friend reads the text), 靜音 (no sound; every phone lights up on its own hour). |
| Single device | `full` — phone in the middle, picked up by whoever is called (see §4). |
| Paper mode | none. |

**What the phones do:** deal the card, roll each player's secret die under a cup (shake to roll), call the hours 1–6, remember where the cheese is, tell each awake player who is awake with them and whether the cheese is still on the table, take a lone sleepyhead's peek, take the thief's follower picks, run the day timer, collect the simultaneous vote, tally and explain, keep the evening score.

**What happens at the table:** everyone closes their eyes (voice/read mode) or looks only at their own phone (silent mode), the players whose hour is called open their eyes and look at each other, the thief touches the hand of each follower it picks (6–8 players), then free discussion and bluffing.

Round shape: `roll → night → day → vote → reveal → over`. One night, one discussion, one vote, no elimination.

## 2. Setup

### 2.1 Config

| key | type | default | applies to | meaning |
|---|---|---|---|---|
| `fallMouse` | bool | off | 6–8 | one sleepyhead card becomes 背鍋鼠 |
| `peek4` | bool | off | 4 | lone sleepyhead may peek in the 4-player variant (rulebook is unclear — research Q1) |
| `reroll` | bool | off | all | may roll again until pressing 鎖定; official = one roll stands |
| `hourSec` | seconds 5–30 | 10 | all | length of every hour window (official: 10 s) |
| `discussSec` | seconds 0–1800 | 300 | all | day timer; 0 = no timer, start the vote when everyone taps 夠鐘投票 |
| `recap` | bool | on | all | show the private 📓 夜晚記錄 in the day |

`config.defaults(n, prev)` keeps what the host used last time (`hourSec`, `discussSec`, `recap`, `reroll`, `peek4`, and `fallMouse` only if `n` is 6–8). It is valid for every n in 4–8.

`config.validate`: n outside 4–8 → 「芝士大盜要 4–8 個人」; `fallMouse` outside 6–8 → 「背鍋鼠只限 6–8 人」; bad `hourSec` / `discussSec` ranges. Warnings: 4p 「4 人局係官方變體：每人兩粒骰，大盜醒兩次，冇共犯。」, 5p 「…有貪瞓鼠一齊醒，嗰位先會變共犯」, fall mouse 「背鍋鼠想畀人投中 — 討論會更亂。」

`config.summary` (lobby lines), e.g. 7 players: `🧀 1 大盜 · 🐭 6 貪瞓鼠` / `🎲 每人 1 粒骰 · 夜尾大盜揀 2 位共犯（唔識大盜）` / `⏱ 每個點鐘 10 秒 · 討論 5 分鐘`.

### 2.2 Deal

One 🧀 thief; the rest 🐭 sleepyheads; with `fallMouse` one sleepyhead is swapped for 🎭 (never added). The deck equals the head-count. Dice are d6; 4 players roll two.

| n | dice each | followers | how |
|---|---|---|---|
| 4 | 2 | 0 | — |
| 5 | 1 | 0 or 1 | thief's witnesses: exactly one → automatic; two or more → thief picks one; thief alone → none |
| 6 | 1 | 1 | thief picks after hour 6; thief + follower meet |
| 7 | 1 | 2 | thief picks after hour 6; the two followers meet, **not** the thief |
| 8 | 1 | 2 | thief picks after hour 6; all three meet |

## 3. Flow

Conventions: **host phone** = the phone that runs the session; the host is also a player, so it shows a normal seat screen plus the shell's NarratorBar (current line, 🔁 replay, 下一步, mode switch). **Table view** = `engine.view(state, null)`, shown to spectators and to a host who is not seated: public information only.

### 3.1 `roll` — 派牌・搖骰

Everyone, eyes open, at the same time.

| Screen (seat) | |
|---|---|
| Lead line | ① 「㩒住張牌睇你身份　② 搖你嘅骰（搖部機或者㩒掣）」 → ③ 「睇清楚晒就㩒「準備好」」 → after ready 「好喇。等其他人準備好，夜晚就會開始 — 叫大家閉眼，部手機放低。」 |
| RoleCard | hold to peek, 🔒 to lock the card. The text is tuned to n (thief: how many followers it will pick; 4p: "你有兩粒骰…"). A follower is **not** shown here — nobody is a follower yet. |
| DiceCup | `shakeToRoll`, 🎲 button, hold to peek. One roll stands: after the first roll `lockedRoll` is true (corner 🔒 badge, a shake says 「點數鎖咗，搖極都唔會變」). With `reroll` the cup also shows 🔓 鎖定點數 and the die only stands once locked. The cup chime is keyed on the per-player `rollSeq`. |
| 4p chooser | sleepyheads only, after locking, if the two dice differ: 「你有兩粒骰：邊粒做你嘅「醒鐘」？先掀開個盅睇咗先揀。」 with two buttons 「左邊粒」「右邊粒」. The buttons never print the numbers (so nothing leaks over a shoulder); picking shows ✓. Equal dice → no choice needed. The thief never chooses: it wakes at both numbers. |
| 準備好 | enabled once the die stands (and, 4p, the die is chosen); then 「✓ 準備好 — 等緊其他人」, counter 「已準備 3 / 6」. |
| Table view | 「已準備 x / y」. |

Transition: when all seats are ready the night starts. `ready` fills in whatever is missing (rolls, locks, picks a random die in 4p), so the host's 代佢做 on a dead phone is one tap.

### 3.2 `night` — 夜晚

#### Step list (fixed by head-count)

```
begin
open 1, close 1, open 2, close 2, … open 6, close 6         (every hour, every game)
6p: rec-pick → rec-meet → rec-close
7p: rec-pick → rec-tclose → rec-meet → rec-close
8p: rec-pick → rec-meet → rec-close
dawn
```

Each step has two stages: **cue** (the narration is playing; no deadline; ends on `@cue-done` or, in 讀稿 mode, on the host's 下一步) and **window** (a fixed timer, then the next step). Nothing ends a window early except the host's 下一步.

| step | window | awake in the window |
|---|---|---|
| `begin` | 3 s | nobody |
| `open h` | `hourSec` | every seat whose wake hour is h (4p: sleepyheads' chosen die; the thief wakes at both of its numbers) |
| `close h` | 2 s | nobody |
| `rec-pick` | `hourSec` | the thief |
| `rec-tclose` (7p) | 2 s | nobody |
| `rec-meet` | max(5 s, `hourSec`/2) | 6p thief + follower · 7p the two followers · 8p thief + both followers |
| `rec-close` | 2 s | nobody |
| `dawn` | 1.5 s | nobody (then → day) |

#### Narration (exact lines; `script.js`)

| cue | line |
|---|---|
| `begin` | 天黑請閉眼。大家將部手機放低，閉埋眼，唔好偷望。 |
| `open h` | 而家係**{一/兩/三/四/五/六}**點鐘。擲到「**{一…六}**」嘅老鼠，請睜開眼。 |
| `close h` | 請閉返眼。 |
| `rec-pick` 6p | 所有人伸一隻手出嚟，放喺枱面。大盜請睜眼，揀一位共犯，輕輕摸佢隻手。 |
| `rec-pick` 7p/8p | 所有人伸一隻手出嚟，放喺枱面。大盜請睜眼，揀兩位共犯，輕輕摸佢哋隻手。 |
| `rec-tclose` 7p | 大盜請閉返眼。 |
| `rec-meet` 6p | 被摸到手嘅共犯，請睜眼，同大盜對望認人。 |
| `rec-meet` 7p | 兩位共犯，請睜眼，互相認人。 |
| `rec-meet` 8p | 兩位共犯，請睜眼，同大盜三個人互相認人。 |
| `rec-close` 6p / 7p / 8p | 大盜同共犯，請閉返眼。 / 兩位共犯，請閉返眼。 / 大盜同兩位共犯，請閉返眼。 |
| `dawn` | 天光喇，請大家睜開眼。芝士唔見咗！ |
| `vote:call` | 邊個係芝士大盜？打開手機，揀你懷疑嘅人，大家一齊投！ |

The lines never say who is awake. Cue ids are `ct<gid>:night:<ix>:<kind>[:h]` and `ct<gid>:vote:call` (`gid` is random per game, so a replay never repeats an id). `minMs` = clamp(1.8 s, 0.16 s × characters, 7 s) — the on-screen time in 靜音 mode.

#### What every phone shows (one layout, so a sleeper's decoy and an awake player's screen are the same shape)

```
  [icon] 三點鐘                     ← public step title (same on every phone)
  ▓▓▓▓▓▓▓▓░░░░                       ← window countdown bar (pulsing while the cue plays)
  ┌ info card (fixed min-height) ───┐
  │ awake: live lines │ asleep: 💤  │
  └─────────────────────────────────┘
  [阿明] [阿欣] [阿珍] …            ← the other seats: live only when a pick is owed
  ┌ one big button ─────────────────┐
  │ 👆 㩒一下 — decoy / ack / action │
  └─────────────────────────────────┘
  help line
```

**Asleep** (`nightSeat = { awake: false }` — the view carries nothing else):

| step / stage | card |
|---|---|
| `begin` | 🌙 天黑 · 閉埋眼，部手機放低，唔好偷望。 |
| `open` cue (for everyone, awake-to-be included) | 🌙 聽住報時… · 如果擲到呢個點數，等報完先會有嘢睇。 |
| `open` window | 💤 瞓緊 · 呢個鐘冇你份。閉住眼，等報下一點。 |
| `close` | 😴 閉返眼 · 等下一點。 |
| `rec-*` | 🤝 共犯環節 · 唔關你事，繼續閉眼。 |
| `dawn` | 🌅 天光喇 · 可以睜眼喇。 |

The big button is always 「👆 㩒一下 · 每個點鐘都㩒，咁就冇人聽得出邊個醒」. Tapping sends `ack`; the engine just counts it (public `acks`), never lets it change a timer.

**Awake in an `open` window** (appears when the window opens, i.e. after the narration):

1. 「👀 你醒咗」
2. 「同你一齊醒：阿明、阿強」 / 「淨係得你醒，其他人都瞓緊。」
3. The cheese: 「🧀 芝士仲喺枱上。」 · 「🧀 芝士已經唔見咗，但你唔知係邊個偷。」 (a later waker) · 「🧀 阿明 偷走咗芝士 — 你睇到晒喇！」 (witness of the theft **in this very hour**) · to the thief 「🧀 你偷走咗芝士！收好佢，唔好露出破綻。」
4. Role lines:
   * lone sleepyhead (or fall mouse): 「👁 淨係得你醒，可以偷睇一個人粒骰（只得一次）。喺下面揀人，再㩒大掣。唔想睇就唔使理。」 — the grid becomes live (tap a name), the big button becomes 「👁 睇 阿明 粒骰」. The result appears under a hold-to-peek cover 「㩒住睇 阿明 粒骰」 (neighbours with open eyes in 靜音 mode cannot read it); it stays on screen for the rest of the window.
   * sleepyhead with company: 「有人同你一齊醒，今次唔可以偷睇。」
   * 4p sleepyhead without `peek4`: 「4 人局唔可以偷睇。」
   * 4p thief at its first of two wakes: 「而家偷，定係等你下一次醒（五點鐘）先偷？下面大掣＝而家偷；唔㩒就係等。」 — big button 「🧀 而家偷芝士」. At its last wake the theft is automatic.
   * 5p thief with two or more witnesses: 「🤝 你一定要揀 1 位同你一齊醒嘅人做共犯（喺下面揀，再㩒大掣）。唔揀嘅話，時間到會幫你隨機揀。」 — grid live over the witnesses only.
   * 5p witnesses after the pick: 「🤝 大盜揀咗 阿珍 做共犯。」; the picked one: 「🤝 你畀大盜揀咗做共犯！你同大盜一隊，唔好講畀人知。」
5. After the window the screen goes to the `close` card for everyone.

**`rec-pick` (6–8p)** — thief: 「🤝 你係大盜」 + 「揀 N 位共犯（喺下面㩒名，再㩒大掣），同時用手輕輕摸佢哋隻手。唔揀嘅話，時間到會幫你隨機揀。」, the grid is live over all other seats (taps accumulate up to N; a further tap drops the oldest), big button 「🤝 揀 阿明、阿玲 做共犯」. Everyone else: the decoy.

**`rec-meet`** — thief (6, 8p): 「你嘅共犯：阿明、阿玲」. Follower: 「🤝 你係共犯！」 · 6p/8p 「大盜係 阿珍。」 · 7p 「你唔知大盜係邊個。」 · 「另一位共犯：阿明」 (7p/8p). The fall mouse who was recruited sees 「你同時係背鍋鼠：想贏就要畀人投中。」. The 7p thief's eyes are closed at this step (its phone shows the decoy).

**Table view** during the night: 「🌙 {step}」, the countdown bar, 「已㩒掣 4 / 6」. It never shows how many seats are awake.

#### Anti-tell

* Every `open h` exists every game; its window is `hourSec` whether 0 or 6 seats are awake. The narration text has the same frame for every hour. A test pins both.
* Windows never end early because someone finished; peeks, acks, steals and picks do not touch `deadline`.
* The thief's theft is **automatic as its window opens** (5–8p; 4p only at the last wake). Nobody can dodge being seen by stealing in the last second, and the thief has nothing extra to tap. Witnesses are always told who.
* Every phone has the same boxes and one big button to tap each step; sleepers are asked to tap it every hour (blind-tappable, bottom half of the screen).
* No sound at night from this UI: the seat grid is plain buttons (not `PlayerPicker`, which clicks), no `Timer` (it ticks and beeps), the peek cover uses `openSound: 'none'`, no `api.sfx`. The shell additionally mutes and dims phones that are not in `focus`.
* The public part of a step (`view.step`) is only `{ ix, total, k, h, stage }`; the table view has no per-hour awake count; `acks` counts everybody who tapped anything.
* Peek results sit under a cover; the recap too.

### 3.3 `day` — 日頭討論

Everyone, eyes open. Banner 「☀️ 天光喇！芝士唔見咗！」, a Timer (label 討論時間) when `discussSec > 0`, 「自由討論，可以講大話。唔可以畀人睇你張牌、唔可以亮骰。」, the private recap behind a cover (「📓 你嘅夜晚記錄 · 㩒住睇」), your RoleCard and DiceCup again (peek only), and 「🗳️ 我哋夠鐘投票」 (toggle; shows 「想投票：2 / 6」). A recruited follower also sees a 🤝 banner (the fall mouse gets 「…但你淨係靠畀人投中先贏」).

Recap lines (only what this seat learned): 「三點鐘你醒咗。同你一齊醒：阿明。阿欣 偷咗芝士（你睇到）。」 · 「一點鐘你偷睇咗 阿欣 粒骰：4。」 · 「你揀咗 阿玲、阿明 做共犯。」 · 「你係共犯！大盜係 阿珍。另一位共犯：阿玲。」 · a seat that never woke: 「你夜晚冇醒過，咩都冇見到。」

Ends when: the timer passes, **or** every seat has tapped 夠鐘投票 (`day-ready`), **or** the host presses 下一步. Table view: timer + 「想投票：x / y」.

### 3.4 `vote` — 投票

Cue `vote:call` is spoken as the screen opens; voting is not blocked by it. VotePanel (pick, then 確定 — two taps on purpose), candidates = every other seat, progress 「已投 4/6」, 改票 allowed until the last vote lands. A follower is reminded they cannot vote for themselves (nobody can). Votes stay secret until all are in; the last vote triggers the reveal.

### 3.5 `reveal` — 開牌

Public, 9 s (`@next` skips): VotePanel in reveal mode with the bars **and who pointed at whom** (the physical game's simultaneous finger-pointing is public too), plus the top-voted cards turned over (🧀 芝士大盜 / 🐭 貪瞓鼠 / 🎭 背鍋鼠). The result is withheld until this lands. Then `over`.

### 3.6 `over` — result

Seat screen: 「🎉 你贏咗！」 / 「😿 你輸咗」, the summary, 「芝士喺四點鐘畀 阿明 偷走。」, and a debrief row per seat (card, follower tag, die/dice, 贏). The shell's results screen shows `result.lines` and `points` and runs 再玩一局 / 換遊戲.

**Verdict** (`judge`, exported and tested):

```
top = seats with the most votes (ties all count)
FM ∈ top                      → 背鍋鼠 wins alone                       (even tied with the thief)
thief ∈ top                   → 4p and |top| > 1 → thief wins
                                otherwise sleepyheads (non-followers, non-FM) win
else                          → thief + followers win                   (a follower fall mouse never shares it)
```

**Result lines** (`result.lines`, Cantonese) — each game: `最高票：阿明（3 票）` · `票數：阿明 3 · 阿強 2 …` · the reason, one of
* 「背鍋鼠 X 喺最高票入面，所以佢獨贏，其他人（包括大盜隊同貪瞓鼠）全部輸。」 (+ 「就算大盜 Y 都畀人揪出，背鍋鼠優先。」)
* 「4 人局：大盜 X 同 Y 平票，所以大盜贏。」
* 「大盜 X 喺最高票入面（平票都一齊開牌），所以貪瞓鼠贏。」 + 「共犯 … 跟大盜一齊輸。」 + 「背鍋鼠 … 冇畀人投中，所以都輸。」
* 「大盜 X 冇喺最高票入面，所以大盜同共犯贏。」 + 「共犯 … 畀人投中都唔緊要。」
then 「芝士喺兩點鐘畀 X 偷走。」, 「共犯：A、B」 / 「今局冇共犯。」, and a debrief line per seat 「阿明：🧀 大盜 · 骰 3 · 三點鐘醒」.

`summary`: 「貪瞓鼠贏 — 大盜 X 畀人揪出」 / 「大盜隊贏 — X 逃過一劫」 / 「背鍋鼠 X 成功畀人投中 — 一個人贏」 / 「大盜 X 贏 — 4 人局平票算大盜贏」.

**Points** (app convention, not official): 貪瞓鼠 win +1 each; thief team win: thief +2, follower +1; 背鍋鼠 solo win +3; losers 0.

## 4. Single-device play and paper mode

Single device is `full`. The phone sits in the middle; every seat lives on it, so the shell walks seats through PassGates.

* **roll:** `focus.pids` = seats not yet ready, so each player takes the phone in seat order, peeks their card, rolls, taps 準備好 and passes it on.
* **night:** the phone narrates. At every `open` window `focus` = `{ pids: awake seats, anonymous: '擲到「三」嘅請拎起部手機' }`, so the gate says what the narrator said and never a name. The awake players physically open their eyes, one of them takes the phone and sees the awake screen (who is with them — they can see each other too —, the cheese, the peek). A lone sleepyhead picks the target on the phone and hands it back. The thief's theft is automatic, so there is nothing for it to do; at 6–8p `rec-pick` has `anonymous: '大盜請拎起部手機'` and the thief picks followers on the phone **and** touches their hands; `rec-meet` has `anonymous: '大盜同共犯請拎起部手機'` (7p: `共犯請拎起部手機`). Nobody taps decoys on a shared phone (there is only one screen); the big button simply acks.
* **empty hours:** `focus` still returns `{ pids: [], anonymous }`, but the room layer drops it for a device that owns none of the pids, so a shared phone shows a gate only when somebody is awake. That only matters if a sleeper cheats by peeking at the phone — see §8.
* **day:** one phone cannot show each seat its recap at once; the recap is behind a cover on each seat's own screen, reached through the seat switcher. Players may skip the recap and rely on memory (the physical game does).
* **vote:** `focus.pids` = seats that have not voted, so each player takes the phone in turn and taps their vote.
* In 讀稿 mode with a single phone the narrator is a person: the host/third party reads the text and presses 下一步.

4p is playable on one phone like any other count.

## 5. Engine

### 5.1 Phases and state (plain JSON)

`roll → night → day → vote → reveal → over`.

| field | meaning | |
|---|---|---|
| `phase`, `n`, `cfg`, `order`, `names`, `gid` | | public (names only used to write result text) |
| `role{pid}` | `thief` / `sleepyhead` / `fall-mouse` | **PRIVATE** |
| `dice{pid}` | `null` until rolled, then `[d]` (4p `[d,d]`) | **PRIVATE** |
| `rollSeq{pid}`, `locked{pid}`, `ready{pid}` | roll bookkeeping | own seat only (`ready` as a count) |
| `pick4{pid}` | 4p sleepyhead's chosen die value | **PRIVATE** |
| `wake{pid}` | hours this seat opens its eyes | **PRIVATE** (own seat after the roll) |
| `steps[]`, `ix`, `stage` | the night script, current step, `cue` / `window` | step kind + hour public |
| `acked[]` | seats that tapped during this step | count only |
| `cheese {gone, by, hour}` | theft record | **PRIVATE**; seen only by who was awake at `hour`, and by the thief |
| `followers[]`, `informed[]` | the followers; who has been told | **PRIVATE** |
| `pending {by, among, count}` | a follower pick the thief still owes | **PRIVATE** |
| `recruitHour` | 5p: hour of the pick | **PRIVATE** |
| `peeked{pid}` | `{target, dice, h}` | **PRIVATE** |
| `notes{pid}[]` | the seat's private recap ledger | **PRIVATE**, own seat only |
| `dayReady{pid}`, `votes{pid}`, `voteCue`, `final`, `outcome` | | count / secret until reveal |
| `deadline`, `timerLabel` | the one running timer | public |

### 5.2 Actions (`act(state, {pid, action}, ctx)`; wrong phase / pid / target → state unchanged, never throws)

| phase | action | validation / effect |
|---|---|---|
| roll | `{type:'roll'}` | refused once locked. Rolls all of the seat's dice with `ctx.rng`, bumps `rollSeq`; locks unless `reroll`. |
| roll | `{type:'lock'}` | only with dice and not yet locked (reroll mode). |
| roll | `{type:'choose-hour', hour}` | 4p non-thief, locked, not ready, `hour` is one of its dice. |
| roll | `{type:'ready'}` | fills in a missing roll / lock / 4p choice (random die), marks ready; the last one starts the night. |
| night | `{type:'ack'}` | any step, any stage; counted once per seat per step. |
| night | `{type:'peek', target}` | window of an `open` step; seat is a lone, non-thief sleepyhead/fall mouse; n≠4 or `peek4`; `target` ≠ self and a seat; one peek per seat. Stores the target's dice and a recap note. Nobody else's view moves. |
| night | `{type:'steal'}` | 4p only: the thief, awake, cheese still on the table (its first of two wakes). |
| night | `{type:'recruit', targets:[…]}` | only the seat in `pending.by`, during a window; exactly `count` distinct seats from `pending.among`. |
| day | `{type:'day-ready', on}` | toggles; all ready → vote. |
| vote | `{type:'vote', target}` | target ≠ self, a seat; replaces an earlier vote; all voted → reveal. |
| host | `@cue-done {id}` | only for the current cue id → enters the window; also clears `vote:call`. |
| host | `@next` | night: cue → window, window → next step; day → vote; reveal → over. |

### 5.3 Advance / deadline

* `enterWindow` sets `deadline = now + windowMs(step)` and applies what a window opens with: the theft (5–8p, or 4p last wake), the `woke` notes for the awake seats, the 5p follower rule (1 witness → follower, ≥2 → `pending`), `rec-pick` → `pending`, `rec-meet` → informs followers.
* `advance` at a window deadline: settle a still-pending pick with `ctx.rng` (`sample(among, count)`), then next step. After `dawn` → `day` (`deadline = now + discussSec`). `advance` in `day` → vote; in `reveal` (9 s) → over.
* The cue stage has **no** deadline: the narrator (or the host's 下一步 in 讀稿 mode) is responsible, so a human reading slowly is never rushed.

### 5.4 `view(state, pid)`

Whitelist-built. Public keys: `phase, seat, n, opts{reroll,recap,peek4}, title, subtitle, deadline?, timerLabel?`, `night: true` while it is night (the shell dims/mutes on it), `step{ix,total,k,h,stage}`, counters (`ready`, `acks`, `dayReady`, `progress`), and after the vote `reveal{counts,top,votes}`, `revealed[{pid,role}]`; at `over` also `summary, winners, mode, cheese, debrief[]`.

Seat keys: `my{role, follower, dice, rollSeq, locked, wake?, needsChoice?, chosen?, ready?}` (own only; `follower` true only once told), `acked`, `nightSeat` (see §3.2: `{awake:false}` or `{awake:true, with, cheese, thief, picked, peek{mode,targets,done}, steal{can,twoWakes}, recruit{count,among}, recruited, meet{thief,mates}}`), `notes[]`, `dayReady.mine`, `candidates`, `myVote`.

### 5.5 `cue`, `focus`, `autoAct`, `legalActions`

* `cue`: night cue stage → the step's line; vote phase → `vote:call` until done.
* `focus`: roll → unready seats; night window of `open` / `rec-pick` / `rec-meet` → `{ pids: awake seats, anonymous }` (possibly empty); vote → unvoted seats; else null.
* `autoAct`: roll → `ready`; owed pick → a random valid `recruit`; day → `day-ready`; vote → a random other seat; otherwise null.
* `legalActions`: everything the seat may send now (ack until acked, every valid peek target, steal, every valid recruit combination, one vote per other seat except the current pick, …).

### 5.6 Rules decisions (the research doc's open questions)

| # | question | decision |
|---|---|---|
| 1 | 4p lone-sleepyhead peek | off; `peek4` switches it on and then shows both dice under the cup |
| 2 | fall mouse recruited | designer's ruling: it knows it is a follower but wins only by being top-voted |
| 3 | fall mouse wins with a caught thief? | no |
| 4 | Cat / Dog promos | not implemented |
| 5 | window length | 10 s default, 5–30 s configurable |

Other choices: the thief must take the cheese, so the theft is automatic at its window; 6–8p followers are picked on the phone **and** by touch (the follower has no other way to know to open their eyes — the phone cannot vibrate on iOS); 5p unpicked witnesses see who was picked (the thief points); votes can be changed until the last vote lands.

## 6. Edge cases → tests (`node tests/run.mjs cheese-thief`)

* **Deal & dice:** deck size / one thief / fall mouse replaces and is refused outside 6–8 · seeded deal, thief seat varies · one roll stands; reroll mode; 4p two dice; roll counter per seat · 4p choose-hour rules, equal dice, thief never chooses · `ready` fills in blanks · night starts only when all ready.
* **Night structure:** exact step lists for 4/5/6/7/8 · every window exactly `hourSec`, empty or not · same cue frame, same focus prompt for crowded and empty hours · sleepers' view identical every hour · acking/peeking/recruiting never touch the deadline · `@next` / `@cue-done` semantics · cue ids unique per game and across games · narration scripts for 6/7/8, none for 4/5.
* **Theft & peek:** theft at window open, witnesses told, later wakers not · lone sleepyhead sees cheese on the table · peek: not self, not twice, skip is doing nothing, target never notified and nobody's view changes · no peek with company / for the thief · fall mouse peeks · all-same-number games for 5–8.
* **Recruitment:** 5p none / one automatic / pick among ≥2 (invalid picks refused, auto-pick at window end) · 6/7/8p no automatic followers; counts 1/2/2; distinct, never the thief; knowledge per head-count; fall mouse can be recruited; missed pick made at window end.
* **4p:** wakes at both numbers, choice of theft hour, nothing to steal at the second, equal dice, chosen die decides the wake, peek option.
* **Day & vote:** ends on timer / all ready / host; self and junk votes refused; changing a vote; reveal contents; result withheld until the reveal lands.
* **Truth table** for 5–8p, fall mouse, 4p, plus a 4 000-case brute-force sweep against an independent derivation · result lines and points.
* **Information boundary:** `leakCheck` after every scripted step and sampled every step of ≥ 550 fuzzed games: no foreign role ids or dice keys, peek data only for the peeker, thief identity / follower knowledge only where the knowledge table allows, `with` = exactly the others awake, no secret in the table view.
* **Robustness:** junk actions never throw nor change state · wrong-phase refusals · JSON round-trip at every step · fuzz over every head-count × seeds × option variants · `autoAct` alone finishes any game.
* **UI (fake DOM, stub components):** every phase renders for every seat and the table, `update()` twice is identical, all night screens have the same shape, whole games finish through taps alone (UI only sends actions the engine accepts), the peek result and recap are the owner's only.

## 7. 貼心 touches

* One roll, shown as a locked cup — nobody can fish for a number by shaking again; `reroll` for casual tables.
* The recap 📓 so nobody has to remember what they saw at 3 o'clock (toggle `recap`).
* The 5p/6p/7p/8p scripts are separate and tested — the official app once played the 6p script at 7p.
* 讀稿 mode works for a non-playing friend; 靜音 mode works on a plane or in a quiet bar: phones light up on their own hour.
* Clear "who is awake with me / is the cheese still there" on every awake screen cures the classic "cheese blindness".
* Peek results and the recap sit under hold-to-peek covers; the role card has its own 🔒.
* 4p: the die choice buttons never print the numbers.
* The reveal shows who pointed at whom, like real finger-pointing, and the result lines say *why* (including the odd rules: tie with the thief, follower caught, fall mouse).
* `ready` auto-completes, so one dead phone costs one tap, not the game.
* The host can change narration mode mid-night from the shell menu.

## 8. Framework requests

1. **Empty-hour decoy on a shared phone.** `room.js filterFocus` returns `null` when a device owns none of `focus.pids`, and `play.js` only opens a gate for owned seats, so a single shared phone shows its 「擲到「三」嘅請拎起部手機」 gate only when someone really is awake. Request: for a device that owns every seat, keep `{ pids: [], anonymous }` and show the anonymous prompt as a plain card (no seat to open) so an empty hour looks the same. Low priority (only matters if a sleeper peeks).
2. **DiceCup lock label.** With the `reroll` option the locked cup's button reads 「🔒 已鎖，主持解鎖」, but this game has no host unlock. Request an optional `lockedLabel` prop.
3. **Silent covers.** `Cover` plays `props.openSound ?? 'flip'`; the game passes the unknown name `'none'` as "no sound" at night. Request: honour `openSound: null` / `false`.
4. **Night hint in the shell.** The shell dims phones that are not in `focus`; the game's own screen is a normal screen under the dim layer and keeps its big decoy button tappable. No change needed, but the shell must keep `.night-dim { pointer-events: none }`.
5. **`@next` while no cue is showing.** In 讀稿 mode the host's 下一步 during a window skips the rest of the window (the game treats `@next` as "advance"). If the NarratorBar hides 下一步 when `cue` is null, hosts lose that skip — acceptable, but keep the button available in 讀稿 mode.
