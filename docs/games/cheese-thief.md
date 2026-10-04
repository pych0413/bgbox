# 芝士大盜 (`cheese-thief`) — play-flow spec

> Rules source: `docs/research/cheese-thief.md` (official rulebook + designer rulings, tags [O] [D] [C] [I] there). Its **"## Verification"** section overrides the draft text above it; §9 below is the rule-by-rule audit against it (2026-10-03 UTC).
> Code: `js/games/cheese-thief/{game,script,ui,index}.js`, `style.css`. Tests: `tests/cheese-thief.test.mjs`.
> All user-facing text is Hong Kong Cantonese. Times are UTC.

## 1. At a glance

| | |
|---|---|
| Players | 4–8 (best 6–8). 9+ is not supported by the publisher, so the picker greys it out. |
| Length | 10–15 min: ≈ 1 min dealing, ≈ 2.5–3 min night, 5 min talk (default), ≈ 1 min vote + reveal. |
| Narration | `required` — the night is read aloud hour by hour. Works in all three modes: 語音 (phone speaks), 讀稿 (a friend who is not playing reads the text; see §3.2), 靜音 (no sound; every phone lights up on its own hour). |
| Single device | `full` — phone in the middle, picked up by whoever is called (see §4). |
| Paper mode | none. |

**What the phones do:** deal the card, roll each player's secret die under a cup (shake to roll), call the hours 1–6, remember where the cheese is, tell each awake player who is awake with them and whether the cheese is still on the table, take a lone sleepyhead's peek, take the thief's follower picks, run the day timer, collect the simultaneous vote, tally and explain, keep the evening score.

**What happens at the table:** everyone closes their eyes (voice/read mode) or looks only at their own phone (silent mode), the players whose hour is called open their eyes and look at each other, the thief touches the hand of each follower it picks (6–8 players), then free discussion and bluffing.

Round shape: `roll → night → day → vote → reveal → over`. One night, one discussion, one vote, no elimination.

## 2. Setup

### 2.1 Config

| key | type | default | applies to | meaning |
|---|---|---|---|---|
| `fallMouse` | bool | off | 6–8 | one sleepyhead card becomes 背鍋鼠 (official option; "玩熟先加") |
| `peek4` | bool | off | 4 | **house rule**, labelled 「家規：4 人局都可以偷睇骰」. Official (French rulebook, 4p point 3): a lone sleepyhead in 4p may NOT peek and must do nothing. |
| `pick5` | bool | off | 5 | **house rule**, labelled 「家規：5 人都喺夜晚尾由大盜揀 1 個共犯」 (play-test request 2026-10-03). Replaces the official 5p witness rule with the 6p night-end step: no follower at the theft hour; after hour six the thief picks **1** follower from anyone, thief and follower meet (6p script, prompts, 5 s meeting). Ignored at other head-counts (never an error); kept for the next 5p game. |
| `reroll` | bool | off | all | **house rule**, labelled 「家規：擲骰可以重擲」: may roll again until pressing 鎖定. Official: one roll stands. |
| `hourSec` | seconds 5–30 | 10 | all | length of every hour window (official: 10 s). On one phone the hand-over pad below comes on top; a `prev` value always wins (a saved 15 s with no `passPhone` key — the old one-phone default — is read as 10 s once the pad exists) |
| `passPhone` | bool (hidden) | `env.singleDevice` | all | **one phone in the middle** (one-phone playtest #7, decision U6): every window somebody may be called in (`open`, `rec-pick`, `rec-meet`) gets `PASS_PAD_SEC` = **10 s** on top, so the official hour is **20 s** on one phone — the same at every hour, crowded or empty, so it tells nothing. Also switches the begin and vote lines to "the phone in the middle". Not a form field: `defaults` sets it from `env` on every re-run, so a second phone joining turns it off |
| `discussSec` | seconds 0–1800 | 300 | all | day timer; 0 = no timer, start the vote when everyone taps 夠鐘投票 |
| `recap` | bool | on | all | show the private 📓 夜晚記錄 in the day |

`config.defaults(n, prev, env)` keeps what the host used last time (`hourSec`, `discussSec`, `recap`, `reroll`, `peek4`, `pick5` (5p only), and `fallMouse` only if `n` is 6–8) and sets `passPhone` from `env.singleDevice` whenever `env` is given. It is valid for every n in 4–8.

`config.validate`: n outside 4–8 → 「芝士大盜要 4–8 個人」; `fallMouse` outside 6–8 → 「背鍋鼠只限 6–8 人」 (blocked, never silently dropped); bad `hourSec` / `discussSec` ranges. Warnings: 4p 「4 人局係官方變體：每人兩粒骰，大盜醒兩次，冇共犯，唔可以偷睇。」, 5p official 「5 人局：大盜偷芝士時有貪瞓鼠一齊醒，嗰位先會變共犯（可能冇）。想實有共犯，可以開家規「夜尾揀共犯」。」 (names the house rule so the group can pick it), fall mouse 「背鍋鼠想畀人投中 — 討論會更亂，建議玩熟先加。」, and one 「家規：…（官方…）」 line per house rule that is on (5p `pick5`: 「家規：5 人局夜晚尾由大盜揀 1 位共犯（官方係偷芝士嗰陣一齊醒嘅貪瞓鼠先做共犯）。」). A house rule that is ON always starts its warning with 「家規：」; none does by default.

`config.presets(n)` (lobby 「快速揀」 chips): 5 players only — 「官方：共犯靠撞」 `{ pick5: false }` and 「家規：夜尾揀共犯」 `{ pick5: true }`, each with its reason. Every other head-count: none.

`config.summary` (lobby lines), e.g. 7 players: `🧀 1 大盜 · 🐭 6 貪瞓鼠` / `🎲 每人 1 粒骰 · 夜尾大盜揀 2 位共犯（唔識大盜）` / `💬 7 人：推理最多 — 2 位共犯互相認得，但唔知大盜係邊個。` / `⏱ 每個點鐘 10 秒 · 討論 5 分鐘` — on one phone `⏱ 每個點鐘 20 秒（含交機 10 秒） · 討論 5 分鐘` (+ `👁 家規：…` / `🔓 家規：…` when on).

**Head-count notes (BACKLOG #8 — the 💬 line, `script.js headCountNote`).** The composition is fixed by the rules, so the "preset" is the head-count itself and the line says why it plays the way it does:

| n | line |
|---|---|
| 4 | 4 人：官方兩粒骰變體 — 大盜醒兩次、冇共犯、唔可以偷睇，平票算大盜贏。 |
| 5 | 5 人：共犯靠撞 — 大盜偷芝士嗰陣有人一齊醒先有，大盜一個醒就冇（家規可改做夜尾揀）。 · with `pick5`: 5 人（家規）：實有共犯 — 夜尾大盜揀 1 位，兩個互相認得，好似 6 人局。 (summary also says 「🎲 每人 1 粒骰 · 夜尾大盜揀 1 位共犯（家規）」 and 「🤝 家規：5 人局夜晚尾由大盜揀 1 個共犯（官方係靠撞）」) |
| 6 | 6 人：最啱新手 — 夜尾大盜揀 1 位共犯，兩個互相認得。 |
| 7 | 7 人：推理最多 — 2 位共犯互相認得，但唔知大盜係邊個。 |
| 8 | 8 人：最熱鬧 — 2 位共犯同大盜三個互相認得。 |

### 2.2 Deal

One 🧀 thief; the rest 🐭 sleepyheads; with `fallMouse` one sleepyhead is swapped for 🎭 (never added). The deck equals the head-count. Dice are d6; 4 players roll two.

| n | dice each | followers | how |
|---|---|---|---|
| 4 | 2 | 0 | — |
| 5 | 1 | 0 or 1 | thief's witnesses: exactly one → automatic; two or more → thief picks one; thief alone → none |
| 5 + 家規 `pick5` | 1 | 1 | as 6p: thief picks anyone after hour 6; thief + follower meet |
| 6 | 1 | 1 | thief picks after hour 6; thief + follower meet |
| 7 | 1 | 2 | thief picks after hour 6; the two followers meet, **not** the thief |
| 8 | 1 | 2 | thief picks after hour 6; all three meet |

## 3. Flow

Conventions: **host phone** = the phone that runs the session; the host is also a player, so it shows a normal seat screen plus the shell's NarratorBar (current line, 🔁 replay, 下一步, mode switch). **Table view** = `engine.view(state, null)`, shown to spectators and to a host who is not seated: public information only.

### 3.1 `roll` — 派牌・搖骰

Everyone, eyes open, at the same time.

Order on screen (play-test request, as in v1): **lead · DiceCup · (4p chooser) · RoleCard · 準備好 · count · 夜晚點玩？** — the cup sits ABOVE the role card.

| Screen (seat) | |
|---|---|
| Lead line | ① 「㩒住張牌睇你身份　② 搖你嘅骰（搖部機或者㩒掣）」 → ③ 「睇清楚晒就㩒「準備好」」 → after ready 「好喇。等其他人準備好，夜晚就會開始 — 部手機放喺面前，唔好鎖機（一鎖就斷線，到你醒都冇嘢睇）。」 (iOS suspends a locked page and its DataChannel — see §10) |
| DiceCup | `shakeToRoll`, 🎲 button, hold to peek. One roll stands: after the first roll `lockedRoll` is true (corner 🔒 badge, a shake says 「點數鎖咗，搖極都唔會變」). With `reroll` the cup also shows 🔓 鎖定點數 and the die only stands once locked (`lockedLabel` 「🔒 已鎖定」 — there is no host unlock in this game). The cup chime is keyed on the per-player `rollSeq`. |
| 4p chooser | sleepyheads only, after locking, if the two dice differ: 「你有兩粒骰：邊粒做你嘅「醒鐘」？先掀開個盅睇咗先揀。」 with two buttons 「左邊粒」「右邊粒」. The buttons never print the numbers (so nothing leaks over a shoulder); picking shows ✓. Equal dice → no choice needed. The thief never chooses: it wakes at both numbers. |
| RoleCard | hold to peek, 🔒 to lock the card. The text is tuned to n (thief: how many followers it will pick, 5p with or without the 家規; 4p: "你有兩粒骰…"). A follower is **not** shown here — nobody is a follower yet. |
| 夜晚點玩？ | folded tip; one line says the peek is done **on your own phone** (「…唔使掂人哋部機 — 夜晚其他人部機係黑嘅」) — v1 players used to lift another phone's cup. |
| 準備好 | enabled once the die stands (and, 4p, the die is chosen); then 「✓ 準備好 — 等緊其他人」, counter 「已準備 3 / 6」. |
| Table view | 「已準備 x / y」. |

Transition: when all seats are ready the night starts. `ready` fills in whatever is missing (rolls, locks, picks a random die in 4p), so the host's 代佢做 on a dead phone is one tap.

### 3.2 `night` — 夜晚

#### Step list (fixed by head-count)

```
begin
open 1, close 1, open 2, close 2, … open 6, close 6         (every hour, every game)
6p, and 5p with the 家規 pick5: rec-pick → rec-meet → rec-close   (5p uses the 6p lines and prompts)
7p: rec-pick → rec-tclose → rec-meet → rec-close
8p: rec-pick → rec-meet → rec-close
dawn
```

Each step has two stages: **cue** (the narration is playing; no deadline; ends on `@cue-done` or, in 讀稿 mode, on the host's 下一步) and **window** (a fixed timer, then the next step). Nothing ends a window early except the host's 下一步.

| step | window | awake in the window |
|---|---|---|
| `begin` | 3 s | nobody |
| `open h` | `hourSec` (+10 s on one phone) | every seat whose wake hour is h (4p: sleepyheads' chosen die; the thief wakes at both of its numbers) |
| `close h` | 2 s | nobody |
| `rec-pick` | `hourSec` (+10 s on one phone) | the thief (official touch countdown is 5 s; the app gives the hour length because the thief also taps the phone — a pick the phone never got is made at random, which would not match the hand that was touched) |
| `rec-tclose` (7p) | 2 s | nobody |
| `rec-meet` | max(5 s, `hourSec`/2) — 5 s at the official 10 s hour (+10 s on one phone) | 6p thief + follower · 7p the two followers · 8p thief + both followers |
| `rec-close` | 2 s | nobody |
| `dawn` | 1.5 s | nobody (then → day) |

#### Narration (exact lines; `script.js`)

| cue | line |
|---|---|
| `begin` | 天黑喇，請大家閉眼。手機放喺面前唔好鎖，唔好偷望。 — one phone (`passPhone`): 天黑喇，請大家閉眼。部手機擺喺枱中間，唔好偷望。 |
| `open h` 5–8p | 而家**{一/兩/三/四/五/六}**點鐘。擲到**{一…六}**點嘅老鼠，請睜開眼。 |
| `open h` 4p | 而家**{一…六}**點鐘。醒鐘係**{一…六}**點嘅老鼠，請睜開眼。 (4p sleepyheads wake by the die they *chose*, so "擲到" would be wrong) |
| `close h` | 請閉返眼。 |
| `rec-pick` 6p | 所有人伸一隻手出嚟。大盜請睜眼，喺手機揀一位共犯，再輕輕摸佢隻手。 |
| `rec-pick` 7p/8p | 所有人伸一隻手出嚟。大盜請睜眼，喺手機揀兩位共犯，再輕輕摸佢哋隻手。 |
| `rec-tclose` 7p | 大盜請閉返眼。 |
| `rec-meet` 6p | 被摸到手嘅共犯，請睜眼，同大盜對望認人。 |
| `rec-meet` 7p | 被摸到手嘅兩位共犯，請睜眼，互相認人。 |
| `rec-meet` 8p | 被摸到手嘅兩位共犯，請睜眼，同大盜三個互相認人。 |
| `rec-close` 6p | 大盜同共犯，請閉返眼。大家收返隻手。 |
| `rec-close` 7p | 兩位共犯，請閉返眼。大家收返隻手。 |
| `rec-close` 8p | 大盜同兩位共犯，請閉返眼。大家收返隻手。 |
| `dawn` | 天光喇，請大家睜開眼。芝士唔見咗！ |
| `vote:call` | 夠鐘投票！邊個係芝士大盜？喺手機揀一個人，投晒先一齊公開。 — one phone: 夠鐘投票！邊個係芝士大盜？部手機逐個交，揀一個人，投晒先一齊公開。 |

Rules for the script (pinned by a test that compares the full night, line by line, for every head-count): the lines never say who is awake and never contain a name; every hour has the same frame and length (only the numeral changes); numbers are words so the zh-HK voice reads them right (「兩點鐘」, 「兩點」); every line is ≤ 36 characters so it reads in one breath. Cue ids are `ct<gid>:night:<ix>:<kind>[:h]` and `ct<gid>:vote:call` (`gid` is random per game, so a replay never repeats an id). `minMs` = clamp(1.8 s, 0.16 s × characters, 7 s) — the on-screen time in 靜音 mode.

**The three narration modes**

* **語音** — the host phone speaks each line; everybody really closes their eyes; the shell completes the cue when speech ends.
* **讀稿** — someone reads the line on the host phone and presses 下一步; the window then runs on its own timer (下一步 during a window skips the rest of it). The reader must have their eyes open, so the reader **must not be a player**: a seated host should use 語音 or 靜音 (said in the rules sheet 「旁白三個模式」). The whole night can be driven by 下一步 alone (tested).
* **靜音** (one phone each only — a whole-table phone offers no 靜音, U1) — nobody speaks; each line stays on the host bar for `minMs`; everyone keeps eyes open and looks only at their own phone, which lights up on its own hour. The night help line says 「唔使閉眼、唔好抬頭、唔使摸手」 and the thief's pick text drops the hand touch (the followers learn it from their phone; a reaching hand would be seen).

#### What every phone shows (one layout, so a sleeper's decoy and an awake player's screen are the same shape)

```
  [icon] 三點鐘          [🎲 你粒骰] ← public step title + your own dice (silent hold-to-peek, every phone)
  ▓▓▓▓▓▓▓▓░░░░                       ← window countdown bar (pulsing while the cue plays)
  ┌ info card (fixed height) ───────┐
  │ [👁 㩒住睇 阿明 粒骰]  (a peek)  │ ← the peek result, FIRST in the card (never below the fold)
  │ awake: live lines │ asleep: 💤  │
  └─────────────────────────────────┘
  [阿明] [阿欣] [阿珍] …            ← the other seats: tappable on EVERY phone
  ┌ one big button ─────────────────┐
  │ 👆 㩒一下 (same label for all)  │
  │ small line: what this tap does  │
  └─────────────────────────────────┘
  help line
```

**Asleep** (`nightSeat = { awake: false }` — the view carries nothing else):

| step / stage | card |
|---|---|
| `begin` | 🌙 天黑 · 閉埋眼，部手機放低（唔好鎖機），唔好偷望。 |
| `open` cue (for everyone, awake-to-be included) | 🌙 聽住報時… · 如果擲到呢個點數，等報完先會有嘢睇。 |
| `open` window | 💤 瞓緊 · 呢個鐘冇你份。閉住眼，等報下一點。 |
| `close` | 😴 閉返眼 · 等下一點。 |
| `rec-*` | 🤝 共犯環節 · 唔關你事，繼續閉眼。 |
| `dawn` | 🌅 天光喇 · 可以睜眼喇。 |

The big button is always 「👆 㩒一下 · 每一步都㩒，咁就冇人聽得出邊個醒」. Tapping a name lights it (a pure decoy — the same gesture a peeker makes); tapping the big button sends `ack` and clears the name. The engine just counts acks (public `acks`), never lets them change a timer.

**Awake in an `open` window** (appears when the window opens, i.e. after the narration):

1. 「👀 你醒咗」
2. 「同你一齊醒：阿明、阿強」 / 「淨係得你醒，其他人都瞓緊。」
3. The cheese: 「🧀 芝士仲喺枱上。」 · 「🧀 芝士已經唔見咗，但你唔知係邊個偷。」 (a later waker) · 「🧀 阿明 偷走咗芝士 — 你睇到晒喇！」 (witness of the theft **in this very hour**) · to the thief 「🧀 你偷走咗芝士！收好佢，唔好露出破綻。」
4. Role lines:
   * lone sleepyhead (or fall mouse): 「👁 你可以偷睇一粒骰（得一次）：㩒個名，再㩒大掣。唔想睇就直接㩒大掣。」 — tap a name (it lights up exactly like a sleeper's decoy tap), then the big button; its label stays 「👆 㩒一下」, only the small line says 「㩒落去就睇 阿明 粒骰（得一次）」. The result appears **at the top of the info card** under a silent hold-to-peek cover 「㩒住睇 阿明 粒骰」 (one compact row; neighbours with open eyes in 靜音 mode cannot read it); it stays for the rest of the window, then lives in the day recap 📓. While it may peek and after it has, the card also says 「睇唔切唔緊要：天光喺 📓 夜晚記錄睇得返。」 (the same line for every peeker, so it tells nothing; left out when the table turned `recap` off, because then there is no 📓 by day). The seat stays in `focus` after peeking, so the shell keeps its phone lit.
   * sleepyhead with company: 「有人同你一齊醒，今次唔可以偷睇。」
   * 4p sleepyhead without `peek4`: 「4 人局唔可以偷睇（官方規則）。」
   * 4p thief at its first of two wakes: 「而家偷，定係等五點鐘先偷？㩒大掣＝而家偷；想等就唔好㩒。」 — the big button keeps its label; the small line says 「㩒落去＝而家偷芝士；想等就唔好㩒」. At its last wake the theft is automatic.
   * 5p thief with two or more witnesses: 「🤝 你一定要揀 1 位同你一齊醒嘅人做共犯：㩒名，再㩒大掣。唔揀，時間到會幫你隨機揀。」 — taps on non-witnesses are ignored.
   * 5p witnesses after the pick: 「🤝 大盜揀咗 阿珍 做共犯。」; the picked one: 「🤝 你畀大盜揀咗做共犯！你同大盜一隊，唔好講畀人知。」
5. After the window the screen goes to the `close` card for everyone.

**Night covers are dark.** At night the game's covers (your dice, the peek result) use a dark back instead of the cheese-yellow one, so a lit phone does not glow across the table. The 🎲 cover in the title row shows your own die/dice; it is on every phone (same element, silent), usable whenever your phone is lit (your own hour, or a shared phone in your hands). A dimmed phone shows nothing (shell dim) — see §8 request 10.

**A phone passed around (2+ awake seats on one device).** Since the one-phone playtest (U2) they share ONE combined screen (§4): what all of them saw is written once in the third person, what only one knows or may do (its die, a 4p thief's steal-or-wait, a 7p follower's knowledge of the thief) sits behind its own 「🤫 名」 panel, a 5p thief's pick goes out as the thief (`api.sendAs`), and the big button acks for all of them (`{ type: 'ack', seats }`). Everyone stays in `focus` all window. The older chained walk (`{ type: 'done' }` dropping a seat from `focus`) is still accepted by the engine but never sent by the UI; `done` never touches the timer and never reaches any view.

**`rec-pick` (6–8p, and 5p with the 家規)** — thief: 「🤝 你係大盜」 + (語音/讀稿) 「揀 N 位共犯：㩒名，再㩒大掣，同時輕輕摸佢哋隻手 — 佢哋靠呢下先知要睜眼。」 / (靜音) 「…（靜音模式唔使摸手）…」. Taps accumulate up to N (a further tap drops the oldest); the small line reads 「㩒落去就揀 阿明、阿玲 做共犯」. Everyone else: the decoy (same gesture, same look).

**`rec-meet`** — thief (6, 8p): 「你嘅共犯：阿明、阿玲」. Follower: 「🤝 你係共犯！」 · 6p/8p 「大盜係 阿珍。」 · 7p 「你唔知大盜係邊個。」 — **unless that follower watched the theft at its own hour**, then 「大盜係 阿珍（你夜晚親眼見到佢偷）。」 (research, "who knows what at dawn") · 「另一位共犯：阿明」 (7p/8p). The fall mouse who was recruited sees 「你同時係背鍋鼠：想贏就要畀人投中。」. The 7p thief's eyes are closed at this step (its phone shows the decoy).

**Table view** during the night: 「🌙 {step}」, the countdown bar, 「已㩒掣 4 / 6」. It never shows how many seats are awake.

#### Anti-tell

* Every `open h` exists every game; its window is `hourSec` whether 0 or 6 seats are awake. The narration text has the same frame for every hour. A test pins both.
* Windows never end early because someone finished; peeks, acks, steals and picks do not touch `deadline`.
* The thief's theft is **automatic as its window opens** (5–8p; 4p only at the last wake). Nobody can dodge being seen by stealing in the last second, and the thief has nothing extra to tap. Witnesses are always told who.
* Every phone has the same boxes and one big button to tap each step; every seat has a legal `ack` at the start of every step, cue and window (tested for 4–8p).
* **A glance cannot tell a peek, a steal or a follower pick from a decoy** (tested on the DOM for 4p, 5p and 6p): every phone's night root, panel, chips and big button carry the same classes, all names are tappable on every phone, the big label is always 「👆 㩒一下」, and nothing changes colour because a seat is awake or acting (no yellow "action" button, no lit panel border, no "live" chips; the panel has a fixed height). Only the panel text and the small line under the button differ. Everyone can make the same gesture: tap a name, tap the big button.
* No sound at night from this UI: the seat grid is plain buttons (not `PlayerPicker`, which clicks), no `Timer` (it ticks and beeps), the peek cover uses `openSound: 'none'`, no `api.sfx` (tested). The shell additionally mutes and dims phones that are not in `focus`.
* The public part of a step (`view.step`) is only `{ ix, total, k, h, stage }`; the table view has no per-hour awake count; `acks` counts everybody who tapped anything.
* Peek results sit under a cover; the recap too.

### 3.3 `day` — 日頭討論

Everyone, eyes open. Order on screen: banner 「☀️ 天光喇！芝士唔見咗！」 (same for all) · a Timer (label 討論時間) when `discussSec > 0` · **your DiceCup, then your RoleCard** (peek only; cup above card as in v1) · **the re-check line under the card** · 「🗳️ 我哋夠鐘投票」 (toggle; 「想投票：2 / 6」) · 「自由討論，可以講大話。唔可以畀人睇你張牌、唔可以亮骰。」 · the private recap behind a cover (「📓 你嘅夜晚記錄 · 㩒住睇」).

**Dawn re-check (play-test request).** From 5 players up, every phone — thief, follower, sleepyhead alike — shows the same line right under the role card: 「🔁 天光喇：再㩒住睇一次你張身份牌 — 夜晚可能有人畀大盜拉咗做共犯。」 It never says whether anything changed. After the owner lifts the card it reads 「✓ 睇咗。記住：身份牌嘅嘢唔好畀人睇到。」 (an own action, same for everybody). 4p has no followers, so no line.

**共犯 only on the card front.** There is no follower banner any more (it sat at the top of the day and vote screens, the easiest place for a neighbour to read). A told follower's RoleCard front becomes 「🤝 共犯」 with who it knows — 「大盜係 阿明。」 / 「你唔知大盜係邊個。」 (7p unless it watched the theft) · 「另一位共犯：阿玲。」 (7p/8p) — then the follower text; a recruited fall mouse gets 「🎭 背鍋鼠＋共犯」 (still wins only by being top-voted). The thief's card adds 「你嘅共犯：阿玲、阿明。」 once it has followers. All of it is on the hold-to-peek front only (`view.my.crew`). The day 💡 line is the same for every seat (「再㩒住身份牌睇一次，然後講你幾點醒、見到邊個。」): the 💡 sheet is not covered, so a per-role line would name a follower.

Recap lines (only what this seat learned): 「三點鐘你醒咗。同你一齊醒：阿明。阿欣 偷咗芝士（你睇到）。」 · 「一點鐘你偷睇咗 阿欣 粒骰：4。」 · 「你揀咗 阿玲、阿明 做共犯。」 · 「你係共犯！大盜係 阿珍。另一位共犯：阿玲。」 · a seat that never woke: 「你夜晚冇醒過，咩都冇見到。」

Ends when: the timer passes, **or** every seat has tapped 夠鐘投票 (`day-ready`), **or** the host presses 下一步. Table view: timer + 「想投票：x / y」.

### 3.4 `vote` — 投票

Cue `vote:call` is spoken as the screen opens; voting is not blocked by it. VotePanel (pick, then 確定 — two taps on purpose), candidates = every other seat, progress 「已投 4/6」, 改票 allowed until the last vote lands. The panel runs with **`secretChoice`** (decision D6): your own phone says 「確定投票」 / 「已投 ✓」 and never lights or names whom you picked, so a neighbour's glance learns nothing before the reveal. The lead says 「（唔可以投自己）」 for everybody — no follower banner. Votes stay secret until all are in; the last vote triggers the reveal.

### 3.4a A seat that stops responding: 💤 absent (decision D4)

A friend leaves the table with the phone still connected. The host marks the seat absent from the shell (`{ type: '@absent', pid }`; `@present` brings it back). From then on, for the rest of this game, nothing waits for it:

* **roll:** the night starts once every *present* seat is ready; an absent seat that never got there is filled in like 代佢做 (rolled, locked, 4p hour picked at random).
* **day:** 「我哋夠鐘投票」 counts present seats only (「想投票：3 / 4」).
* **vote:** it casts no vote (its taps are refused; no `legalActions`, no `autoAct`), it is still a candidate (its name carries 💤) and can be caught, and the vote reveals once every present seat has voted. A vote it cast before it left stands (and stays in the 「已投 n/N」 total). If every seat is absent the empty tally is revealed at once instead of waiting forever. Its own phone says 「💤 房主當咗你暫時離開，今次唔使投票。返嚟咗就同房主講聲。」 instead of the ballot.
* **night:** unchanged — it still wakes at its hour and the thief still steals as its window opens; no hour ever waited for anybody.
* **public:** `view.absent` (seat order) is the same on every phone and the table; the roll, day, vote and table screens show 「💤 暫時離開（唔使等）：阿明」 under their counts. `engine.blocking` is false for it. `@present` makes the day check and an open vote wait for it again.
* Unchanged state (the shell says this game cannot do it): an unknown seat, a seat already in that state, or `over`.

### 3.5 `reveal` — 開牌

Public, 9 s (`@next` skips): VotePanel in reveal mode with the bars **and who pointed at whom** (the physical game's simultaneous finger-pointing is public too), plus the top-voted cards turned over (🧀 芝士大盜 / 🐭 貪瞓鼠 / 🎭 背鍋鼠). The result is withheld until this lands. Then `over`.

### 3.6 `over` — result

Seat screen: 「🎉 你贏咗！」 / 「😿 你輸咗」, the summary, 「芝士喺四點鐘畀 阿明 偷走。」, a debrief row per seat (card, follower tag, die/dice, 贏), and 🌙 夜晚重溫 (`view.recap`, the same lines on every phone). The shell's results screen shows `result.lines` and `points` and runs 再玩一局 / 換遊戲.

**Verdict** (`judge`, exported and tested):

```
top = seats with the most votes (ties all count)
FM ∈ top                      → 背鍋鼠 wins alone                       (even tied with the thief)
thief ∈ top                   → 4p and |top| > 1 → thief wins
                                otherwise sleepyheads (non-followers, non-FM) win
else                          → thief + followers win                   (a follower fall mouse never shares it)
```

**Result lines** (`result.lines`, Cantonese, BACKLOG #10) — each game: `最高票：阿明（3 票）` · `票數：阿明 3 · 阿強 2 …` · the reason, one of
* 「背鍋鼠 X 喺最高票入面，所以佢獨贏，其他人（包括大盜隊同貪瞓鼠）全部輸。」 (+ 「就算大盜 Y 都畀人揪出，背鍋鼠優先。」)
* 「4 人局：大盜 X 同 Y 平票，所以大盜贏（2023 年官方修訂）。」
* 「大盜 X 喺最高票入面（平票都一齊開牌，大盜照計畀人揪出），所以貪瞓鼠贏。」 + 「共犯 … 跟大盜一齊輸。」 (a recruited fall mouse is not listed there) + 「背鍋鼠 X 唔喺最高票，所以都輸（佢做咗共犯都一樣）。」
* 「大盜 X 唔喺最高票，所以大盜同共犯贏。」 (「所以大盜贏」 when there is no team follower) + 「共犯 … 畀人投中都唔緊要，照贏。」 + for the fall mouse 「背鍋鼠 X 雖然做咗共犯，但佢淨係靠畀人投中先贏，所以輸。」 / 「背鍋鼠 X 唔喺最高票，所以輸。」

then 「共犯：A、B」 / 「今局冇共犯。」, **🌙 夜晚重溫** — one line per hour plus the follower step, the night as nobody saw it live:
* 「一點鐘：阿欣 醒咗 — 阿欣 偷睇咗 阿明 粒骰（3）」
* 「兩點鐘：冇人醒」
* 「三點鐘：阿明、阿強、阿珍 醒咗 — 大盜 阿明 偷走芝士（阿強、阿珍 睇到）；大盜揀咗 阿珍 做共犯」 (5p)
* 4p: 「兩點鐘：… — 大盜 阿明 醒咗，但揀咗遲啲先偷」 / 「五點鐘：… — 大盜 阿明 再醒，芝士早就冇咗」
* 6–8p: 「夜尾：大盜揀咗 阿珍、阿玲 做共犯（兩個互相認得 / 兩位共犯互相認得，大盜冇同佢哋對望 / 三個互相認得）」

and a debrief line per seat 「阿明：🧀 大盜 · 骰 3 · 三點鐘醒」. `result.recap` carries the recap lines on their own; the `over` view publishes them as `recap`.

`summary`: 「貪瞓鼠贏 — 大盜 X 畀人揪出」 / 「大盜隊贏 — X 逃過一劫」 / 「背鍋鼠 X 成功畀人投中 — 一個人贏」 / 「大盜 X 贏 — 4 人局平票算大盜贏」.

**Points** (app convention, not official): 貪瞓鼠 win +1 each; thief team win: thief +2, follower +1; 背鍋鼠 solo win +3; losers 0.

## 4. Single-device play and paper mode

Single device is `full`. The phone lies in the middle of the table; every seat lives on it. The shell's one-phone contract (DESIGN §7.1) does the hand-overs; this game supplies the steps, the table screen and the one-phone wording.

* **narration (U1):** `meta.eyesClosed: true` — a whole-table phone offers 🔊 語音 and 📜 讀稿 only (讀稿 needs a reader who is not playing; the lobby says so). 靜音 stays for one phone each.
* **roll:** `focus` = `{ pids: seats not yet ready, label: '睇牌・擲骰' }`, so each player gets the phone behind 「交俾 X · 其他人唔好望 · 睇牌・擲骰」, peeks their card, rolls, taps 準備好 (「好喇，交俾下一位…」) and passes it on. The 🔓 lock is hidden on a shared phone (#36): it would not survive the hand-over and any holder could undo it.
* **night:** the begin line says 「部手機擺喺枱中間」. At every `open` window `focus` = `{ pids: awake seats, anonymous: '擲到三點嘅請拎起部手機' }` (4p: `'醒鐘係三點嘅請拎起部手機'`), so the gate says what the narrator said and never a name; an empty hour gets the same decoy gate. Every window carries the 10 s hand-over pad (`passPhone`), and `view.step.windowMs` (the step kind's fixed length) lets the bar show the time already gone when the screen mounts after the gate, with 「仲有 N 秒」 beside it and 「⏰ 時間到 — 部手機擺返中間，閉眼」 when it runs out (#7). The seat alone in its hour:
  * sees a **three-line** awake card (who is awake, the cheese, the one thing it may do);
  * **peeks with ONE tap** on a name — the two-tap gesture exists only so a peek looks like a decoy on a phone of its own, and nobody taps decoys on the phone in the middle (#7);
  * sees only the names a tap can use; with nothing to pick they are dimmed and the button reads 「睇完就㩒，部手機擺返中間」 (#36).
* **several seats awake together (U2, #8):** the thief and its witnesses, sleepyheads together, the 6–8p meeting. The shell opens ONE gate and mounts the first called seat with `ctx.coWakers` / `ctx.views`; the game draws ONE combined screen (`buildCoNight`):
  * written once, in the third person, everything all of them saw: who is awake (also seats on other phones), the cheese (a theft is named only when every one of them saw it — a 4p thief's later wake shows just 「芝士已經唔見咗」), a 5p thief's pick among the witnesses (made on the grid and sent **as the thief** with `api.sendAs`; everyone then reads 「大盜揀咗 X 做共犯」), and at the meeting the crew (6p / 8p: 「大盜：A · 共犯：B」; 7p: the followers, and the thief only when every one of them knows it);
  * behind each seat's own 「🤫 名」 panel (the others look away; every panel has the same shape): its own die, a 4p thief's choice to steal now or wait (its button sends `steal` as that seat; the witness then reads the theft on the shared part), a 7p follower's 「大盜係 X（你夜晚親眼見到佢偷）」 / 「你唔知大盜係邊個」;
  * one big button: the owed pick, else 「睇完就㩒，部手機擺返中間」 = `{ type: 'ack', seats: coWakers }` for all of them. Nobody leaves `focus` until the window ends; the legacy `done` action still works in the engine but the UI no longer sends it (no chained walk).
* **dawn:** the shell puts the phone in the middle behind 「☀️ 天光喇」 — the holder and the chip are the same for every role assignment.
* **day:** the table screen (`view(state, null)`: title, the clock, 想投票) has 「🗳️ 大家夠鐘投票 ✓（一下就得）」 → `api.tableSend({ type: 'day-ready', on: true })`, which counts for every seat on the phone (`seats`), so on a whole-table phone one tap starts the vote; it is locked while the 「擺返中間」 card is up (U5). A shared phone that does not hold the whole table reads 「🗳️ 呢部機嘅人都夠鐘投票」 with the count. A seat picked by hand (換人) sees its card, die and 📓, no per-seat 夠鐘投票, and 「📱 想投票：擺返中間，喺枱面㩒「夠鐘投票」」.
* **vote:** `focus` = `{ pids: seats that have not voted, label: '投票' }`; the shell gates each voter (also the one on screen) with 「其他人唔好望 · 投票 · 搞掂 k/n」. The vote line says 「部手機逐個交」.
* **reveal / over:** public; on a shared phone nobody is 「你」 (#20): 🧀 完咗 and no 「（你）」.
* In 讀稿 mode with a single phone the narrator is a person who does not play: they read the text and press 下一步.

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
| `done[]` | awake seats that handed a shared phone on in this window (they leave `focus`) | **PRIVATE**; reset every step |
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
| night | `{type:'ack', seats?}` | any step, any stage; counted once per seat per step. `seats` (a shared phone's combined screen, U2) acks every listed seat. |
| night | `{type:'peek', target}` | window of an `open` step; seat is a lone, non-thief sleepyhead/fall mouse; n≠4 or `peek4`; `target` ≠ self and a seat; one peek per seat. Stores the target's dice and a recap note. Nobody else's view moves. |
| night | `{type:'steal'}` | 4p only: the thief, awake, cheese still on the table (its first of two wakes). |
| night | `{type:'done'}` | window only; the seat is awake now, not done yet, and owes no follower pick. Adds it to `done` (and `acked`); `focus` drops it. Never touches `deadline`. Legacy: the UI no longer sends it (a shared phone shows co-wakers one screen, U2). |
| night | `{type:'recruit', targets:[…]}` | only the seat in `pending.by`, during a window; exactly `count` distinct seats from `pending.among`. |
| day | `{type:'day-ready', on, seats?}` | toggles; `seats` (a shared phone's whole-table tap) sets every listed seat at once; all present seats ready → vote. |
| vote | `{type:'vote', target}` | target ≠ self, a seat; replaces an earlier vote; all voted → reveal. |
| host | `@cue-done {id}` | only for the current cue id → enters the window; also clears `vote:call`. |
| host | `@next` | night: cue → window, window → next step; day → vote; reveal → over. |

### 5.3 Advance / deadline

* `enterWindow` sets `deadline = now + windowMs(step)` and applies what a window opens with: the theft (5–8p, or 4p last wake), the `woke` notes for the awake seats, the 5p follower rule (1 witness → follower, ≥2 → `pending`), `rec-pick` → `pending`, `rec-meet` → informs followers.
* `advance` at a window deadline: settle a still-pending pick with `ctx.rng` (`sample(among, count)`), then next step. After `dawn` → `day` (`deadline = now + discussSec`). `advance` in `day` → vote; in `reveal` (9 s) → over.
* The cue stage has **no** deadline: the narrator (or the host's 下一步 in 讀稿 mode) is responsible, so a human reading slowly is never rushed.

### 5.4 `view(state, pid)`

Whitelist-built. Public keys: `phase, seat, n, opts{reroll,recap,peek4}, title, subtitle, hint, deadline?, timerLabel?, absent[]` (the 💤 seats, §3.4a), `night: true` while it is night (the shell dims/mutes on it), `step{ix,total,k,h,stage,windowMs}` (`windowMs` = the step kind's fixed length, pad included, the same in every view — the night bar is drawn from it), counters (`ready`, `acks` — seat views only: on the table view of a shared phone it would count who is awake —, `dayReady`, `progress` — `ready`, `dayReady` and `progress` count the seats the table still waits for), and after the vote `reveal{counts,top,votes}`, `revealed[{pid,role}]`; at `over` also `summary, winners, mode, cheese, debrief[], recap[]`.

`hint` (BACKLOG U1) is one line for the shell's 💡 sheet, built only from what this view already shows, never drawn by the game UI (tested). Seat hints: roll — look / choose a die (4p) / ready / wait; night — asleep 「未到你：閉住眼，每一步都照㩒一下大掣。」 (identical every step, so it tells a sleeper nothing), awake, lone peeker, thief, 4p steal choice, follower pick, meeting; day — **one line for every seat** 「再㩒住身份牌睇一次，然後講你幾點醒、見到邊個。」 (the 💡 sheet is not behind a cover, so a per-role line — 「幫大盜…」 — would show a neighbour who is a follower; role advice lives on the role card); vote / voted; reveal; over. Table hints per phase. Texts in `script.js HINT`.

Seat keys: `my{role, follower, dice, rollSeq, locked, wake?, crew?, needsChoice?, chosen?, ready?, absent?}` (own only; `follower` true only once told; `crew` = `{thief, mates}` for a told follower — from its own follower note — and `{thief: null, mates: followers}` for the thief once it has followers, drawn only on the role card front), `acked`, `nightSeat` (see §3.2: `{awake:false}` or `{awake:true, with, cheese, thief, picked, peek{mode,targets,done}, steal{can,twoWakes}, recruit{count,among}, recruited, meet{thief,mates}}`), `notes[]`, `dayReady.mine`, `candidates`, `myVote`.

### 5.5 `cue`, `focus`, `autoAct`, `legalActions`

* `cue`: night cue stage → the step's line; vote phase → `vote:call` until done.
* `focus`: roll → `{ pids: unready seats, label: '睇牌・擲骰' }`; night window of `open` / `rec-pick` / `rec-meet` → `{ pids: awake seats (legacy `done` ones excepted), anonymous }` (possibly empty) for the whole window; vote → `{ pids: unvoted seats, label: '投票' }`; else null; never a 💤 seat at the roll or the vote. The shell lifts its night dim exactly for the seats named here (tested in a real Room: one phone per seat, and one shared phone where thief and witnesses stay in focus together all hour).
* `blocking` (the room's stall detector asks it first): an unready seat at the roll, a seat that has not asked to vote by day, an unvoted seat in the vote — never a 💤 seat, and **never at night**: every hour runs on its own clock and an owed follower pick is made at window end, so the old fallback (focus = the awake seats) would have pointed a stall banner at exactly who is awake.
* `autoAct`: roll → `ready`; owed pick → a random valid `recruit`; day → `day-ready`; vote → a random other seat; otherwise null.
* `legalActions`: everything the seat may send now (ack until acked, every valid peek target, steal, every valid recruit combination, `done` for an awake seat, one vote per other seat except the current pick, …).

### 5.6 Rules decisions (the research doc's open questions, after its "## Verification")

| # | question | status in research | decision |
|---|---|---|---|
| 1 | 4p lone-sleepyhead peek | **resolved: not allowed** (official French rulebook; the fan JP text mistranslates it) | no peek in 4p. `peek4` is an off-by-default **house rule** labelled 「家規」 in the form, the lobby summary and a validate warning; when on, the peek shows both of the target's dice |
| 2 | fall mouse recruited | resolved | it is told it is a follower but wins only by being top-voted; never shares the thief team's win |
| 3 | fall mouse shares a sleepyhead win? | resolved: no | no — FM ∉ top set → FM loses, whatever else happens |
| 4 | Cat / Dog promos | unruled timing | not implemented |
| 5 | window length | resolved: 10 s (EN/FR) | `hourSec` 10 s default, 5–30 s configurable; follower meeting 5 s at the default |
| 6 | 4p thief's non-stealing wake | **open** | documented default: the thief is woken at **both** of its hours. At the first it may steal (one tap) or wait; at its last wake an unstolen cheese is taken automatically. After stealing, its other wake still happens: co-wakers see it awake, the cheese already gone, and are not told who took it. No "thief may sleep through a wake" option (research suggests one; not built — see §9 open items) |
| — | 5p follower rule | official (witness rule) | default stays official; the play-test asked for a night-end pick, so `pick5` is an off-by-default **家規** (field, summary, warning, lobby preset) that plays the 6p step with 1 follower |
| — | 4p tie | resolved (2023-10-09 amendment) | a tie that includes the thief is a thief win in 4p; the rules sheet and the result line name the amendment because older / French printings say the opposite |

Other choices: the thief must take the cheese, so the theft is automatic at its window (5–8p); 6–8p followers are picked on the phone **and** by touch in 語音/讀稿 mode (the follower has no other way to know to open their eyes — the phone cannot vibrate on iOS), phone only in 靜音 mode; 5p unpicked witnesses see who was picked (the thief points) [I]; votes can be changed until the last vote lands; no re-roll unless the 家規 is on.

## 6. Edge cases → tests (`node tests/run.mjs cheese-thief`)

* **Deal & dice:** deck size / one thief / fall mouse replaces and is refused outside 6–8 · seeded deal, thief seat varies · one roll stands; reroll (家規) mode; 4p two dice; roll counter per seat · 4p choose-hour rules, equal dice, thief never chooses · `ready` fills in blanks · night starts only when all ready.
* **Config (U1 / #8):** house rules off by default for every n and labelled 家規 in field, summary and warning · a 💬 reason line per head-count · 400 fuzzed `defaults(n, prev)` are valid and their lobby counts equal the dealt roles; an invalid fall mouse is refused · `rules.quick` ≤ 6 lines ≤ 40 chars · every role text has 做乜 then 點贏 · the 4p no-peek rule appears in quick, the sleepyhead role and the 4p section.
* **Night structure:** exact step lists for 4/5/6/7/8 · every window exactly `hourSec`, empty or not · same cue frame, same focus prompt for crowded and empty hours · sleepers' view (and 💡 hint) identical every hour · acking/peeking/recruiting never touch the deadline · `@next` / `@cue-done` semantics · cue ids unique per game and across games · narration scripts for 6/7/8, none for 4/5.
* **Anti-tell timeline (4–8p, hourSec 10 and 7):** the full list of lines, silent-mode times and window lengths is identical between "everyone on one hour, nobody acts" and "spread out, thief elsewhere, everybody peeks / steals / picks"; every seat has an `ack` at every step and stage; 4p one-wake vs two-wake thief also identical.
* **Narration:** the exact script, line by line, for every head-count; ≤ 36 chars, no digits, no names; the vote call once · 讀稿: the night runs on 下一步 alone (theft and a skipped pick still happen) · 靜音: on cue timers alone, under 4 minutes.
* **Theft & peek:** theft at window open, witnesses told, later wakers not · lone sleepyhead sees cheese on the table · peek: not self, not twice, skip is doing nothing, target never notified and nobody's view changes · no peek with company / for the thief · fall mouse peeks · all-same-number games for 5–8.
* **Recruitment:** 5p none / one automatic / pick among ≥2 (invalid picks refused, auto-pick at window end) · 6/7/8p no automatic followers; counts 1/2/2; distinct, never the thief; knowledge per head-count; **7p follower who watched the theft knows the thief, the other does not**; fall mouse can be recruited; missed pick made at window end.
* **4p:** wakes at both numbers, choice of theft hour, nothing to steal at the second, equal dice, chosen die decides the wake, no peek by default (house option).
* **Day & vote:** ends on timer / all ready / host; self and junk votes refused; changing a vote; reveal contents; result withheld until the reveal lands.
* **Truth table** for 5–8p, fall mouse, 4p, plus a 4 000-case brute-force sweep against an independent derivation · result lines and points · odd cases worded right (FM follower, no follower, thief tie, 4p amendment) · **night recap** lines exact for a 5p night with peek + theft + pick, 4p wait-then-steal and steal-then-wake, 6/7/8p follower step; same recap on every phone at `over`.
* **💡 hints:** every phase × every seat and the table, ≤ 32 chars, one line; tracks what the seat can do (peek / thief / pick / sleep).
* **Information boundary:** `leakCheck` after every scripted step and sampled every step of ≥ 550 fuzzed games: no foreign role ids or dice keys, peek data only for the peeker, thief identity / follower knowledge only where the knowledge table allows, `with` = exactly the others awake, no secret in the table view, `recap` only at `over`.
* **Robustness:** junk actions never throw nor change state · wrong-phase refusals · JSON round-trip at every step · fuzz over every head-count × seeds × option variants · `autoAct` alone finishes any game.
* **UI (fake DOM, stub components):** every phase renders for every seat and the table, `update()` twice is identical, the 💡 hint is never drawn, all night screens have the same shape, whole games finish through taps alone (UI only sends actions the engine accepts), the peek result and recap are the owner's only · **glance test:** at every night step of a 6p game and at a 5p pick and a 4p first-wake steal, every phone's night root / panel / chips / big button carry identical classes and the same big label before and after a peek, a steal, a follower pick and a sleeper's identical decoy gesture; the peek cover is silent; `api.sfx` is never called at night.
* **Play-test fixes (2026-10-04 UTC):** 5p `pick5` — off by default and 家規-labelled everywhere, presets 5p-only, ignored elsewhere; no witness follower, the 6p script / prompt / pick of anyone / meeting, recap 「夜尾：…（兩個互相認得）」, anti-tell timeline crowd vs spread, 60 fuzzed games end with exactly one follower · `done`: refused in a cue stage, for a sleeper, while a pick is owed, twice; drops the seat from `focus` (prompt stays), never moves the deadline, invisible to every other view, reset next step · `my.crew` per head-count (6p, 7p witness vs not, 5p witness) and in `leakCheck` · day 💡 line identical for every seat · **real Room**: one phone per seat — exactly the awake seats are in focus for their whole window and stay so after a peek / a pick; one shared phone — the gate walks thief → witness → witness as each sends `done`, and the thief's pick is its own, not the random fallback · **UI**: cup above card on roll and day; the dawn re-check line identical on every phone, under the card, not at the top, hidden at 4p; everything outside covers identical between a follower and anyone else on the day and vote screens; card fronts say 共犯 / who is known / 你嘅共犯; on a shared walk the last tap sends `done` (a pick still owed → `ack`; last seat and sleepers → `ack`); the 🎲 cover is in every night title row, silent, own dice only; the peek result is first in the card.

* **Decisions (2026-10-04 UTC):** `@absent` / `@present` — the roll starts the night without the absent seat (its die filled in, 4/5/8p), 夠鐘投票 and the vote count present seats, no vote from an absent seat (refused, no legal action, no autoAct) but it is still a candidate and can be caught, a vote cast before leaving stands and stays in the total, the last missing voter closes the vote, @present waits for it again, every seat absent reveals an empty tally, garbage / a seat / `over` unchanged; `blocking` never at night and never for a 💤 seat; `view.absent` identical on every phone and the table; a fuzz over 4–8p that marks random seats absent and back (games end, a vote never waits on an absent seat, leak checks hold) · **UI**: every ballot has `secretChoice`, the absent candidate's name carries 💤, the absent seat sees the 💤 line and no ballot, the public 💤 line on seat and table screens; the lone peeker's 「睇唔切唔緊要…」 line before and after the peek, never for a sleeper or a seat awake with company, and not when `recap` is off.

## 7. 貼心 touches

* One roll, shown as a locked cup — nobody can fish for a number by shaking again; the 家規 `reroll` for casual tables.
* The recap 📓 so nobody has to remember what they saw at 3 o'clock (toggle `recap`), and 🌙 夜晚重溫 at the end: who woke when, who peeked at whom, when the cheese went and who watched, who was recruited.
* The 5p/6p/7p/8p scripts are separate and pinned line by line in a test — the official app once played the 6p script at 7p.
* 讀稿 mode works for a non-playing friend; 靜音 mode works on a plane or in a quiet bar: phones light up on their own hour and nobody has to touch hands.
* Clear "who is awake with me / is the cheese still there" on every awake screen cures the classic "cheese blindness".
* Peek results and the recap sit under hold-to-peek covers; the role card has its own 🔒. A peeker whose hour runs out is told the die waits in 📓.
* Your own vote never shows on your screen before the reveal (「已投 ✓」).
* A friend who wanders off does not freeze the table: the host marks the seat 💤 and 夠鐘投票 and the vote go on without it.
* 4p: the die choice buttons never print the numbers.
* Every phone looks the same at night, and everyone can make the same tap-a-name-then-the-button gesture, so neither a glance nor finger movement gives a peeker or a thief away.
* The reveal shows who pointed at whom, like real finger-pointing, and the result lines say *why* (including the odd rules: tie with the thief, follower caught, fall mouse, the 4p amendment).
* 💡 has a one-line hint for every screen and the role card says what you do and how you win — nothing pops up by itself.
* `ready` auto-completes, so one dead phone costs one tap, not the game.
* The host can change narration mode mid-night from the shell menu.

## 8. Framework requests

1. ~~**Empty-hour decoy on a shared phone.**~~ Done in the framework: `filterFocus` keeps `{ pids: [], anonymous }` and `play.js` shows the decoy gate once per step.
2. ~~**DiceCup lock label.**~~ `DiceCup` has `lockedLabel`; the game passes 「🔒 已鎖定」.
3. **Silent covers (still needed).** `Cover` plays `sfx(props.openSound ?? 'flip')`; the game passes `'none'`, which is silent today only because `sfx()` ignores unknown names. Request: document and honour `openSound: null` / `false` (or `'none'`) as "no sound", so a future sound named `none` or a stricter `sfx()` cannot make the night peek audible.
4. **Night dim stays click-through.** The shell dims phones that are not in `focus`; the game's own screen sits under the dim layer and keeps its decoy grid and big button tappable. No change needed, but keep `.night-dim { pointer-events: none }`.
5. **`@next` while no cue is showing.** In 讀稿 mode the host's 下一步 during a window skips the rest of the window (the game treats `@next` as "advance"). Keep the button available in 讀稿 mode even when `cue` is null.
6. **💡 sheet (U1).** The game now returns `view.hint` for every phase and seat (and the table). The shell's 💡 must show it only on tap, never by itself. At night (`view.night`), opening the sheet should stay as dark as the dimmed screen — a bright modal on one phone would mark it out.
7. **讀稿 with a seated host.** 讀稿 needs a reader with open eyes, which breaks the night if the reader is also a player. Request: when the narration mode is `read`, the game's `meta.narration` is `'required'` and the host device has a seat, the lobby / narrator bar warns 「讀稿要搵個唔玩嘅人讀；主持有玩就用語音或者靜音」.
8. **靜音 brightness tell.** The game's night screens are now identical at a glance, but the shell un-dims only the `focus` seats, so in 靜音 mode (everyone's eyes open) a lit phone across the table shows who is awake. Request: in 靜音 mode use one dim level for every seat at night (readable by its owner up close), or at least note the trade-off in the shell's help.
9. ~~**Walk contract in DESIGN §7.**~~ Replaced by U2 (DESIGN §7.1): several called seats of one phone share ONE gate and ONE combined screen (`ctx.coWakers`, `api.sendAs`). The game no longer sends `done`.
12. **「⏰ 時間到」 on the dim (one-phone #7).** The seat's own screen says 「⏰ 時間到 — 部手機擺返中間，閉眼」 only if its clock reaches zero before the host moves on, which on the whole-table phone (the host itself) is a split second. Request: when a shared phone goes to the middle at the end of an anonymous step, let the opaque dim's title read 「⏰ 時間到」 for a few seconds — on every shared phone and every step alike (real gate or decoy), so it tells nothing.
10. **Night peek at your own cup on a dimmed phone (optional).** The 🎲 cover is on every night screen, but on a phone the shell has dimmed (not in `focus`) the 95 % dim hides it. If players should be able to check their number with eyes open between their hours, `css/base.css` could let a held cover show through on a one-seat phone, e.g. `body.is-night:has(.ct-mydice .c-cover.open) .night-dim:not(.opaque) { opacity: .35; }` (or a generic `.peek-through` marker). Trade-off: in 靜音 mode a neighbour sees a screen brighten (not what is on it).
11. **「輪到你」 badge at night.** `play.js paintHeader` shows the yellow 「輪到你」 pill for a focus seat at night too; the night screen already says 「👀 你醒咗」, and the pill is the brightest thing in the top bar of a lit phone. Suggest `myTurn && !view?.night`.

## 9. Rules audit (2026-10-03 UTC)

Checked one by one against `docs/research/cheese-thief.md` "## Verification" (which overrides its draft). "Doc" = this file before the pass; "code" = `game.js` / `ui.js` / `script.js` before the pass.

| # | verified rule | doc before | code before | verdict | what changed |
|---|---|---|---|---|---|
| R1 | 4p: a lone sleepyhead may NOT peek (French rulebook, 4p point 3) | "rulebook is unclear — research Q1" | no peek by default ✓, but the option read 「4 人局都可以偷睇骰」 / 「官方未講清楚」 | **FIX** | field 「家規：4 人局都可以偷睇骰」 + help 「官方規則係唔可以」; summary 👁 家規; validate warning; rules text (quick, sleepyhead role, 4p section, night section); role card; doc §2.1 / §5.6 |
| R2 | a 4p peek may exist only as an off-by-default, clearly labelled house option | default off | default off ✓, not labelled | **FIX** | as R1; test: off for every n, 家規 in field / summary / warning |
| R3 | win: FM ∈ top → FM alone; thief ∈ top → sleepyheads (non-follower, non-FM); else thief ∪ (followers − FM) | ✓ | `judge` ✓ (truth table + 4 000-case sweep) | OK | — |
| R4 | the FM never shares the thief team's or the sleepyheads' win | ✓ | ✓ | OK (logic) / **FIX** (wording) | result lines no longer say a recruited FM "loses with the thief", nor 「大盜同共犯贏」 when the only follower is the FM; the FM gets its own reason line |
| R5 | 4p tie amendment (2023-10-09): thief in a tied top set → thief wins | ✓ | ✓ | OK | rules sheet + result line name the amendment (older / French printings say the opposite) |
| R6 | 5p: thief alone → no follower; 1 witness → follower; ≥ 2 → thief points at one; unpicked witnesses know the thief | ✓ | ✓ | OK | — |
| R7 | 6p: 1 follower, picked from anyone after hour 6, mutual recognition | ✓ | ✓ | OK | — |
| R8 | 7p: 2 followers know each other, not the thief; the thief knows both | ✓ | ✓ | OK | — |
| R9 | 7p witness rule: a 7p follower learns the thief **if it watched the theft** at its own hour | 「7p 你唔知大盜係邊個」 | meet / notes always `thief: null` at 7p, so a follower who saw the theft was told 「你唔知大盜係邊個」 (contradicting its own recap) | **FIX** | `followerKnowsThief`: 7p → the thief iff it saw the theft; UI 「大盜係 X（你夜晚親眼見到佢偷）」; test |
| R10 | 8p: 2 followers + thief all know each other | ✓ | ✓ | OK | — |
| R11 | follower pick: distinct, never the thief, may be the FM or a non-witness | ✓ | ✓ | OK | — |
| R12 | hour window 10 s (EN/FR), configurable | ✓ | `hourSec` 10, 5–30 ✓ | OK | — |
| R13 | follower steps: 5 s countdowns | meet ✓ | meet 5 s ✓; pick = `hourSec` | OK (deliberate) | documented: the thief taps the phone and touches hands; a missed phone pick would not match the touch |
| R14 | everyone votes once, for another player; no abstaining, no self-vote | ✓ | ✓ | OK | rules text now says 唔可以棄權 |
| R15 | no re-roll (official) | ✓ default off | ✓ default off, label not marked as house rule | **FIX** | 「家規：擲骰可以重擲」 + 「官方規則：擲一次就定案」; summary / warning |
| R16 | 4p: two dice; sleepyhead wakes once at a chosen die; thief wakes at both (once if equal), chooses its theft hour, forced at the last | ✓ | ✓ | OK | — |
| R17 | 4p thief's non-stealing wake (open Q6) — keep a documented default | not covered | wakes at both | **FIX** (doc) | §5.6 row 6 and the 4p rules section state the default and what co-wakers see |
| R18 | narration: the recruit close also tells everyone to take the hand back (research cue `night:recruit:close`) | missing | missing | **FIX** | 「…請閉返眼。大家收返隻手。」 for 6/7/8 |
| R19 | 4p sleepyheads wake by their *chosen* die | — | cue said 「擲到「二」嘅老鼠」 | **FIX** | 4p cue 「醒鐘係兩點嘅老鼠，請睜開眼。」 + matching shared-phone prompt |
| R20 | the thief's phone pick must match the touched hands [I] | — | cue said only 「揀一位共犯，輕輕摸佢隻手」 | **FIX** | 「喺手機揀一位共犯，再輕輕摸佢隻手」; the thief screen explains why the touch matters |
| A1 | every hour (and every step) lasts its fixed length whoever is awake | ✓ | ✓ | OK | tested now for 4–8p, two `hourSec` values, idle vs acting nights, 4p one vs two thief wakes |
| A2 | every seat has a legal action every night step (decoy of identical shape) | ✓ | ✓ engine; UI chips disabled for sleepers | **FIX** (UI) | every name tappable on every phone, so a sleeper can make the peeker's exact gesture |
| A3 | the steal and the peek look and sound identical to the decoy at a glance | partly | yellow "action" big button, big label 「👁 睇 X 粒骰」 / 「🧀 而家偷芝士」, yellow awake panel border, lit "live" chips, green role block | **FIX** | one big label for all, same classes and colours; the action only in the small line; fixed-height panel; DOM glance test + no-sound test |
| A4 | 靜音 mode: nothing visible from across the table | — | thief told to touch hands even in 靜音 | **FIX** | 靜音 help line 「唔使閉眼、唔好抬頭、唔使摸手」; pick text without the touch |
| U1 | `view.hint` every phase; roles say what you do AND how you win; `rules.quick` ≤ 6 | — | no `hint`; thief / sleepyhead texts lacked an explicit win; quick lacked the 4p rule | **FIX** | `hintFor` + `script.js HINT`; roles 「做乜：… 點贏：…」; quick rewritten (6 lines); tests |
| B8 | presets / head-count notes with a reason | — | none | **FIX** | 💬 line per n; fuzzed role-count invariants |
| B10 | result lines explain why, incl. a night recap | partial | no recap | **FIX** | 🌙 夜晚重溫 in `result.lines`, `result.recap`, `view.recap` at `over`, over screen |

**Still open (not built):** a "thief may sleep through one of its 4p wakes" option (research open Q6 suggests exposing it; the documented default stands); a toggle for the pre-2023 4p tie rule for tables using an old French / English rulebook; promo Cat / Dog.

## 10. Play-test on real iPhones (2026-10-03 UTC) — findings and fixes (2026-10-04 UTC)

| # | report (Cantonese, from the user) | finding | fix |
|---|---|---|---|
| P1 | 「骰盅要放喺身份牌上面」 (asked in v1 too) | v2 put the role card first on the roll and day screens | cup above card on both (`buildRoll`, `buildDay`); a silent 🎲 「你粒骰」 cover in every night title row |
| P2 | 「半夜嘅時候，所有人嘅畫面都黑咗，咁可以查看其他人點數嘅老鼠就睇唔到其他人嘅點數」 | Reproduced against the deployed code in headless Chrome (5 tabs as 5 phones in a room, and 一部手機玩): the shell's dim (`play.js` `sh.sound.night(... && !inFocus)`) **does** lift for the awake seat, because `focus` names it for the whole window — a peek went through and showed. What does make "every screen black" at the peeker's hour: **(a)** the phones themselves locking during the ~2.5 min night (Screen Wake Lock ignored by iOS Chrome / the Google app / older Home Screen apps; players also press the side button) — iOS then suspends the page and its DataChannel, so a 10 s hour passes before the phone is back (core commit 4bc7b41: wake-lock video fallback + 12 s re-dial); **(b)** the peek result sat partly below the fold of the fixed 12 rem info card (`style.css .ct-panel` + a 4:1 cover after four lines), so with a 10 s hour first-timers ran out of time and the phone went dark for `close`; **(c)** v1 habit — the peek used to be lifting another phone's cup, and every other phone is (correctly) dark now; **(d)** one shared phone: `focus` never shrank inside a window and `play.js evaluateFocusGate` gates only the first focus seat of the device, so the 2nd/3rd awake seat (a 5p thief who must pick, a witness, a 6–8p follower at the meeting) never got the phone. | (a) nightfall line 「…手機放喺面前唔好鎖…」, roll and `begin` texts say 唔好鎖機; (b) the peek result is now the first thing in the card, one compact row, dark night covers; (c) rules / role card / roll tip say the peek is on your own phone; (d) `{ type: 'done' }` + `focus` minus done seats → the gate walks every awake seat; 15 s default hour on one phone. Real-Room tests pin both the per-phone focus and the walk. |
| P3 | 「夜晚結束前，要畀多個環節芝士大盜揀共犯」 | 6–8p night-end pick works and is lit on the thief's phone (verified in a 6-phone room); 5p uses the official witness rule, so a 5-player table often has no pick at all | 家規 `pick5` (off by default, 5p only): the 6p night-end step with 1 follower; offered in the 5p warning, summary and as a lobby preset |
| P4 | 「日頭起身時，要提示大家重新睇一次自己嘅身份牌…唔好放喺手機畫面最上面」 | the day / vote screens put 「🤝 你係共犯」 in a banner at the top; the day 💡 line was role-specific | identical 🔁 re-check line under the card on every phone (5p+); no banner; 共犯 + who you know only on the role card front (`my.crew`); one day 💡 line for all |

## 11. One phone in the middle (2026-10-04 UTC) — what the one-phone playtest changed

From `docs/playtest/single/cheese-thief.md` and the cross-game summary (decisions U1, U2, U5, U6):

| finding | change |
|---|---|
| #1 dawn names the last night holder | shell (table mode); the game's table view carries the clock and 想投票, and no night tap counter (it would count the awake on a shared phone) |
| #5 夠鐘投票 needs every seat | `day-ready` takes `seats`; the table screen's 「大家夠鐘投票 ✓（一下就得）」 (`api.tableSend`), locked behind the table card |
| #6 靜音 on one phone | `meta.eyesClosed: true`; rules 「旁白三個模式」 and the new 「一部手機玩」 section |
| #7 peeks lost in the 15 s hour | hidden `passPhone` + 10 s pad on every awake window (20 s hour); `view.step.windowMs`; bar with 「仲有 N 秒」 / 「⏰ 時間到…」; one-tap peek and a three-line card on a shared phone |
| #8 co-wakers walked in seat order | one combined screen with per-seat 🤫 panels (U2); `ack` takes `seats`; the pick goes out with `api.sendAs` |
| #19 own-phone wording | night tip, ready line, night help, decoy sub-line, role / rules text made device-neutral; begin and vote cues for one phone |
| #20 「你贏咗」 / 「（你）」 | none on a shared phone (over screen, reveal panel) |
| #33 gate subtitle | `focus.label` 「睇牌・擲骰」 / 「投票」 |
| #36 decoy grid and 🔓 lock | unusable names dimmed with 「睇完就㩒，部手機擺返中間」; no lock on a shared phone |
