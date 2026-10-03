# 一夜終極狼人 (One Night Ultimate Werewolf) — play-flow spec

> Rules source: `docs/research/onuw.md` (base game only, **with its "Verification" corrections**: a dead Tanner does not
> block a lone Minion, a lone Minion must survive, a Doppelgänger card nobody copied is a plain Villager). Paraphrased;
> nothing copied from the official booklet or app. UI text is Hong Kong Cantonese; code, comments and this doc are English.
> Files: `js/games/onuw/{game,script,ui,index}.js`, `style.css`; tests `tests/onuw.test.mjs`. All times are UTC.
> Template: `docs/DESIGN.md` §15.9. QA pass 2026-10-03 UTC: every rule re-checked against the verified research (no rule
> deviations found); added `blocking`, `@void-round`, `carry`/anti-streak, presets, 💡 hints and the why-line fixes below.

## 1. At a glance

| | |
|---|---|
| Players | 3–10 (needs `players + 3` role cards) |
| Time | 10–20 min: deal 1 min · night 2–4 min (by roles and pace) · discussion 4–9 min · vote and reveal 2 min |
| Narration | `recommended` — every line is public information, spoken from the host phone; 讀稿 and 靜音 work too (steps run on timers) |
| Single device | `partial` — phone in the middle, the called role picks it up (§4). One phone each is much safer |
| Banks | none |
| Roles | the 12 base roles: 化身幽靈 狼人 爪牙 守夜人 預言家 強盜 搗蛋鬼 酒鬼 失眠者 村民 獵人 皮匠 |

**What the phones do.** Deal the cards (every seat peeks once), keep the three centre cards, call the night step by step
(narration + a fixed-length window per step), show each awake seat what it may know, apply every swap **to the cards**, give
every other seat an equal-looking decoy, run the discussion clock, collect a simultaneous secret vote, resolve ties and the
Hunter, work out who won per player (final card, not dealt role) and explain it, with a recap of the whole night.

**What happens at the table.** Talking: claiming roles, lying, accusing. Nobody touches a card, nobody reaches for
anything; at night people keep their eyes closed (or, in 靜音 mode, simply look at their own phone).

**Cards, not people.** Every ability moves *cards*: you are the role of the card in front of you **at the end of the
night**, and the app never shows you that card unless your ability does (Robber's new card, Insomniac's own card).

## 2. Setup

### Config

All keys optional; `defaults(n, prev, env)` fills them and keeps what the host chose before. With
`env.singleDevice` (one phone holds every seat) the pace becomes `slow`: the phone is picked up from the middle of the
table at every step, and ×1.5 on **every** window still tells nothing. The room also counts a hosted lobby with only the
host's phone as one device, so a hidden `paceAuto` marker remembers that the slow pace was automatic: when other phones
join, it goes back to `standard` (a pace the host picked by hand stays).

| key | UI label | type | default | meaning |
|---|---|---|---|---|
| `preset` | 角色配置 | select | `auto` | `auto` 推薦（跟人數）· `advanced` 進階（加化身幽靈）· `custom` 自訂角色 |
| `custom` | 自訂角色 | roles map | the recommended set for n | `{ role: count }` for doppelganger, werewolf, minion, seer, robber, troublemaker, drunk, insomniac, hunter, tanner; only shown for `custom`. **Villager is the auto-fill role** (「自動」): it takes whatever is left to make `n + 3` cards (0–3 of them) |
| `customMasons` | 守夜人 | bool | from the recommended set | Masons are a pair or nothing, so they are a switch, not a counter (a lone Mason cannot be expressed) |
| `loneWolf` | 獨狼睇牌 | bool | `true` | official option, "considered essential" by the community: a lone werewolf may look at one centre card |
| `pace` | 夜晚速度 | select | `standard` | `slow` 新手 ×1.5 · `standard` · `fast` ×0.7 — scales **every** night window by the same factor |
| `discussSec` | 討論時間 | seconds | `0` | `0` = by head-count: 3–4 → 4 min, 5–6 → 5, 7–8 → 7, 9–10 → 9; otherwise 30–1800 s |
| `ringVote` | 圈票 | bool | `true` | the officially blessed "everybody points one seat clockwise → nobody dies", as a one-tap agreement |
| `antiStreak` | 唔好連續做狼人 | bool | `false` | BACKLOG #20: nobody who was **dealt** a werewolf last game (`carry.wolves`) is dealt one again. Rejection sampling, so every allowed deal stays equally likely. Off by default: last game's wolves are public at the reveal, so the table then knows they are not wolves now (the help text says so) |

Not implemented on purpose (research "Open questions" 4a): the two lone-Minion house rules (Tanner blocks the lone Minion;
the literal reading where a dead Minion still wins). The default behaviour of the research is the only one.

### Recommended sets (with the reason shown in the lobby)

The lobby shows the role list, **and the reason**, to everybody (a pair of summary tags, the first starting with 💡) and the long form to the host under
the preset select (`fields[0].help`). Sources: official booklet for 3–5, BGG thread 1860094 / Nerdist for the rest (research "Setup").

| n | cards | set | reason shown |
|---|---|---|---|
| 3 | 6 | 2 狼人, 預言家, 強盜, 搗蛋鬼, 1 村民 | 官方 3 人配置：牌少，兩隻狼人有八成機會至少一隻喺中間，靠強盜同搗蛋鬼製造混亂。 |
| 4 | 7 | 同上，2 村民 | 官方 4 人配置：同 3 人一樣，多 1 個村民（共 2 個）。 |
| 5 | 8 | 同上，3 村民 | 官方 5 人配置：再多 1 個村民（共 3 個），好人牌夠多，新手友善。 |
| 6 | 9 | 2 狼人, 爪牙, 預言家, 強盜, 搗蛋鬼, 3 村民 | 社群常用 6 人配置（Nerdist）：加爪牙（識狼人，狼人唔識佢）；9 張牌入面 6 張係好人牌。 |
| 7 | 10 | 2 狼人, 爪牙, 2 守夜人, 預言家, 強盜, 搗蛋鬼, 酒鬼, 失眠者 | 社群常用 7 人配置（BGG）：加一對守夜人、酒鬼同失眠者，換牌多咗，連自己張牌都要懷疑。 |
| 8 | 11 | 7 人配置 + 獵人 | 7 人配置再加獵人（BGG）：獵人死咗會帶走佢投嘅人，投票要小心。 |
| 9 | 12 | 2 狼人, 爪牙, 皮匠, 2 守夜人, 預言家, 強盜, 搗蛋鬼, 失眠者, 2 村民 | 社群常用 9 人配置（Nerdist）：加皮匠（佢想俾人投死，狼人唔可以亂推人出去），仲有 2 個村民。 |
| 10 | 13 | 2 狼人, 爪牙, 2 守夜人, 預言家, 強盜, 搗蛋鬼, 酒鬼, 失眠者, 獵人, 2 村民 | 社群常用 10 人配置（BGG）：13 張牌入面得 2 張村民，幾乎人人有嘢做。 |

Learning ladder (research): no recommended set contains the Doppelgänger; the Tanner appears only at 9, the Hunter from 8.
`advanced` = the recommended set with one Villager (or, when the set has none — 7 and 8 players — the Drunk) swapped for the
Doppelgänger, reason 「進階：將一張村民（冇村民就換酒鬼）換成化身幽靈。化身幽靈夜晚會長啲，第一次玩建議唔好加。」

`defaults(n, prev)`: the role list follows the head-count (it is recomputed from `n` whenever the preset is `auto` or
`advanced`, so adding a late joiner re-fits it). A `custom` list that no longer fits the new head-count falls back to `auto`.

### One-tap presets (`config.presets(n)`, BACKLOG #8)

Chips above the form, each a patch over the current config with a reason; every one passes `validate` for its n,
and tapping one makes the lobby highlight that one (the patches differ in roles or pace).

| id | label | cfg | reason |
|---|---|---|---|
| `recommended` | 推薦 | `preset: 'auto'`, pace standard | the reason of the table above |
| `beginner` | 新手 | 3–7: `auto` + pace slow · 8: the 7-player set + 1 Villager [D] · 9: the 7-player set + 2 Villagers (BGG) · 10: the BGG 10-player set with its Hunter swapped for the third Villager; all pace slow | 「第一次玩：唔加獵人，夜晚每步慢 1.5 倍。」 (9: 「唔加皮匠（改加酒鬼）」) — no Doppelgänger, Hunter or Tanner, as the research's learning ladder says |
| `advanced` | 進階 | `preset: 'advanced'`, pace standard | adds the Doppelgänger |
| `all-special` (10 only) | 全部特殊角色 | custom: every non-Villager card (13) | the official "no Villager cards" suggestion |

### Validation

Errors (block start): `n` outside 3–10; a key of the wrong type or range (numeric strings from a `<select>` are accepted);
custom card count ≠ `n + 3` — 「角色牌多咗 k 張」 or, when the villagers would exceed the 3 in the box, 「村民最多 3 張…仲要再加 k 張其他角色」;
no werewolf card; a role above its box count (werewolf 2, mason 2, villager 3, the rest 1).

Warnings (shown, never block):
- Doppelgänger present: 「有化身幽靈：夜晚會長啲，第一次玩建議唔好加。」
- Insomniac with none of Robber, Troublemaker, Drunk, Doppelgänger: 「失眠者而家冇人會換佢張牌…」
- fewer than half of the cards are village team (community heuristic, marked unsourced in the research)
- only one werewolf card (official variant): 「只有 1 張狼人（官方變體）…」
- discussion under a minute.

### Summary lines (lobby, everybody)

The shell turns every summary line into one **tag that does not wrap**, so each line is short (≤ 24 characters) and the
reason comes in two pieces. For 7 players: `🃏 10 張牌（7+3）` · `推薦（跟人數）` · `🐺 狼人 ×2` · `🦹 爪牙` · `🕯️ 守夜人 ×2` · `🔮 預言家` ·
`🗡️ 強盜` · `🌪️ 搗蛋鬼` · `🍺 酒鬼` · `🦉 失眠者` · `💡 社群常用 7 人配置` · `加守夜人、酒鬼、失眠者，換牌多` · `🌙 夜晚標準` ·
`☀️ 討論 7 分鐘` · `🐺 獨狼可睇中間一張` · `⭕ 可以圈票` (+ `🔁 唔會連續派到狼人` when on). The long reason of the table above is shown to the host under the preset select.

## 3. Flow

Phases: **deal → night → day → vote → reveal → over**. `over` is when `engine.result()` becomes non-null, so the shell
switches to the results screen at that moment; everything players want to see *live* (tally, deaths, every final card,
why, the recap) therefore sits in `reveal`, which waits for the host.

### 3.1 `deal`

| who | screen |
|---|---|
| each seat | the role card (hold to peek, 🔓 lock like every other role game) showing emoji, name, team colour and a one-line brief; the **public role list** (「今局角色（中間有 3 張）」: chips with counts — the official tokens next to the centre); the big 「記住喇」; 「已記住 3 / 6」; a collapsed 「夜晚點玩？」 |
| table | 「🃏 派牌」, the same counter, the role list |

Narration `on{gid}:deal` (host): 「派牌喇。㩒住張牌睇自己係邊個，記住佢。夜晚你張牌可能會被換走，手機唔會再話你知。睇完㩒「記住喇」，全部人好咗，天就會黑。」
The phase ends when every seat has tapped 記住喇 (`focus.pids` = seats that have not — a shared phone walks on through them).
Host 下一步: first acknowledges the line, the second starts the night for a slow table.

### 3.2 `night`

The night is a list of **steps**, built from the role *list* (centre cards included), in wake order:

`begin` · `doppelganger` · `doppelganger-minion` · `werewolf` · `minion` · `mason` · `seer` · `robber` · `troublemaker` · `drunk` ·
`insomniac` · `doppelganger-insomniac` · `dawn`

A step exists iff its role card is in the set (`doppelganger-minion` needs Doppelgänger **and** Minion; `doppelganger-insomniac`
needs Doppelgänger **and** Insomniac). Villager, Hunter, Tanner never wake. Every step has two stages:

1. **cue** — the host phone speaks the step (or shows it, 讀稿 mode, or waits `minMs`, 靜音 mode). Ends on `@cue-done`, or 下一步.
2. **window** — fixed length. Whoever is awake acts; **everybody** taps their big button; at the deadline the engine settles
   anything still owed and moves to the next step's cue. The window never ends early.

Window lengths at `standard` (× `pace`): begin 3 s · doppelganger **20** · doppelganger-minion 8 · werewolf **12** (10 when
`loneWolf` is off) · minion 8 · mason 8 · seer **12** · robber 10 · troublemaker 10 · drunk 8 · insomniac 8 ·
doppelganger-insomniac 8 · dawn 2. They depend on the step kind and the config only — never on the deal.

**Who is awake** is decided by the *dealt* role (`orig[pid]`), plus the Doppelgänger's copy — never by the card in front of
the seat when the step comes. So a Robber who stole the Troublemaker card does not wake at 7 (his dealt role is Robber), and
the real Troublemaker, now holding a Robber card, still does and still swaps.

| step | awake seats | learns (immediately, behind a hold-to-peek cover) | may choose | lapse |
|---|---|---|---|---|
| `doppelganger` | the Doppelgänger | after copying: the target's role; | **must** pick another player (never the centre, never herself). If the copy is Seer/Robber/Troublemaker/Drunk she then acts at once with that role's normal options. Copy of Werewolf/Mason/Minion/Insomniac: told she will wake in that step. Villager/Tanner/Hunter: nothing more | copy: random other player (note 「系統幫你隨機揀」); copied Drunk: random centre swap; copied Seer/Robber/Troublemaker: lapses |
| `doppelganger-minion` | the Doppelgänger iff she copied Minion | the original werewolves | — | — |
| `werewolf` | original werewolves + a Doppelgänger who copied Werewolf | who else is awake, or 「冇其他狼人醒，另一張狼人牌一開始喺中間」 | exactly one awake and `loneWolf`: look at **one** centre card | lapses |
| `minion` | original Minion | the werewolves (original + Doppelgänger-Werewolf), or 「冇狼人醒（冇玩家派到狼人牌）」; wolves never learn her | — | — |
| `mason` | original Masons + a Doppelgänger who copied Mason | the other Mason, or alone | — | — |
| `seer` | original Seer | the card(s) seen — a Doppelgänger card shows the **Doppelgänger face**, not what it copied | one other player's card **or** two distinct centre cards | lapses |
| `robber` | original Robber | the NEW card he now holds | swap with another player (not the centre, not himself) | lapses (he stays a Robber) |
| `troublemaker` | original Troublemaker | nothing (the swap is blind) | swap two other players (not herself, not the centre, not the same twice) | lapses |
| `drunk` | original Drunk | nothing (blind) | **must** swap with one centre card of his choice | random centre card, note 「系統幫你隨機揀」 |
| `insomniac` | original Insomniac | her current card's face | — | — |
| `doppelganger-insomniac` | the Doppelgänger iff she copied Insomniac | her current card's face | — | — |

A robbed Doppelgänger who copied the Insomniac still wakes (dealt role) and sees whatever she holds now. The Robber who robs
the Doppelgänger sees a **Doppelgänger face** and is silently the copied role (he is never told which).

The "nobody / alone" notes say what is **true about the deal** (「另一張…牌一開始喺中間」, 「冇玩家派到狼人牌」), not "it is
in the centre now": a Doppelgänger-Drunk may have taken that card out of the centre at step 1, and the app never lies.

**What a seat sees in the window** (the same layout for every seat at every step, §3.8):

```
 [icon] 預言家                         ← the step being called: public, spoken aloud
 ▬▬▬▬▬▬▬▬▬▬▬▬                          ← countdown bar, no sound
 ┌ info card ───────────────────────┐   awake:  「👀 你醒咗」 + what you may do (+ a cover: 「㩒住睇結果」)
 └──────────────────────────────────┘   asleep: 「💤 瞓緊 — 呢一輪冇你份。閉住眼，等下一輪。」
 [阿B] [阿C] [阿D] [阿E] [阿F]          ← the other seats (live only while you have a choice)
 [中間 1] [中間 2] [中間 3]              ← the three centre cards (live only while you have a choice)
 ┌ 👆 㩒一下 ───────────────────────┐   the one big button: decoy for everybody, confirm for the chooser
 └ 每一輪都㩒，咁就冇人聽得出邊個醒 ─┘
```

Choosing: tap what you want, the button turns into the confirmation (`🔮 睇 阿C 張牌`, `🔮 睇中間第 1 張、中間第 3 張`,
`🗡️ 同 阿C 換牌`, `🌪️ 對調 阿C 同 阿D`, `🍺 同中間第 2 張對調`, `👥 複製 阿B`, `👁 睇中間第 1 張`), a second tap
commits — a half-pick is never sent, and an optional ability you do not want is simply not confirmed. Seer: a player pick
clears centre picks and the other way round; Troublemaker: a third pick drops the oldest.

**Night screens of the shell.** `view.night = true` for every seat from `begin` until the `dawn` step (the screen then
lights up for 「天光喇」). The shell dims and mutes every seat that is not in `focus`; `focus.pids` = the awake seats during
the window, so only they are lit and audible. Nothing in the UI makes a sound.

### 3.3 Narration (host phone, own wording)

Each step's cue is **one line**: it closes the previous role's eyes, then opens the next. It is built from the step and the
config only, so a role sitting in the centre sounds exactly like one that is awake. Quoted from `script.js` (full set,
`loneWolf` on, 5 minutes):

| step | line |
|---|---|
| begin | 天黑請閉眼。大家將部手機放低，閉埋眼，夜晚唔准出聲，唔好偷望。 |
| doppelganger | 化身幽靈，請睜開眼。揀一個人，睇佢張牌，你就變成佢嘅角色；如果佢有夜晚行動，你即刻做。 |
| doppelganger-minion | 如果化身幽靈複製咗爪牙，請睜開眼，睇邊個係狼人。其他人繼續閉眼。 |
| werewolf | 化身幽靈，請閉眼。狼人，請睜開眼，睇下有冇其他狼人。如果淨係得你一隻，你可以睇中間一張牌。 |
| minion | 狼人，請閉眼。爪牙，請睜開眼，睇邊個係狼人。狼人唔會知你係邊個。 |
| mason | 爪牙，請閉眼。守夜人，請睜開眼，睇下另一個守夜人係邊個。 |
| seer | 守夜人，請閉眼。預言家，請睜開眼。你可以睇一個人嘅牌，或者睇中間兩張牌。 |
| robber | 預言家，請閉眼。強盜，請睜開眼。你可以同另一個人換牌，然後睇你換返嚟嗰張。 |
| troublemaker | 強盜，請閉眼。搗蛋鬼，請睜開眼。你可以將另外兩個人嘅牌對調，唔准睇。 |
| drunk | 搗蛋鬼，請閉眼。酒鬼，請睜開眼。你一定要同中間一張牌對調，唔准睇。 |
| insomniac | 酒鬼，請閉眼。失眠者，請睜開眼，睇返自己而家張牌有冇變。 |
| doppelganger-insomniac | 失眠者，請閉眼。如果化身幽靈複製咗失眠者，請睜開眼，睇返自己而家張牌。 |
| dawn | 化身幽靈，請閉眼。天光喇，大家睜開眼！由而家開始自由討論，限時 5 分鐘。夜晚完咗，唔准再睇自己張牌。 |
| vote | 時間到！打開手機，揀你覺得係狼人嘅人。三、二、一，投票！ |
| reveal | 全部人投晒票喇。{最高票嘅係阿明，佢死咗 / 平票，阿明、阿B 一齊死 / 冇人拎到兩票或以上，冇人死。}{獵人阿C開槍，帶走阿D。}{好人隊贏。} |

(The Doppelgänger's `…-minion` sub-step has no 請閉眼 in front: it is her own role continuing. The `dawn` cue shows the
discussion length of this game.) Cue ids: `on{gid}:night:{ix}:{step}`; `minMs` = clamp(length × 150 ms, 2.5 s, 9 s).

### 3.4 `day`

| who | screen |
|---|---|
| everyone | 「☀️ 天光喇！」, the discussion `Timer` (60 s and 10 s warnings, beeps at zero), the public role list |
| each seat | 「📓 你嘅夜晚記錄」 behind a cover: 「派牌：你本來係 🗡️ 強盜。」 + every note of the night (「強盜：你同 阿B 換咗牌，換到 🐺 狼人。」), and the warning 「⚠️ 呢度只係「派牌時係咩」同「夜晚見過咩」。你最後張牌可能已經被換咗，唔好當佢係你而家嘅角色。」 There is **no** "my current role" anywhere (research: never offer it) |
| host | `＋60 秒` on the timer (max 6 presses; only the host seat is accepted). Pause and 「下一步」 (= start the vote now) are in the shell's ⋯ menu, and the day screen reminds the host: 「房主：想即刻投票？㩒右上角 ⋯ →「下一步」。」 |
| everyone | 「🗳️ 我哋夠鐘投票」 — when **all** seats tap it, or the timer ends, or the host presses 下一步, the vote starts |

### 3.5 `vote`

Narrated with the countdown line above. Every seat gets the shared `VotePanel`: every other seat, pick then 確定 (two taps),
改票 allowed until the last vote lands; 「已投 4 / 6」 for everyone, never who. No abstain, no self, no centre.
When the last seat has voted the phase becomes `reveal` and all votes are public at once.

**圈票 (ring vote)** (config `ringVote`): under the ballot, 「⭕ 我同意圈票」. If every seat agrees, the engine gives every seat
one vote on the next seat clockwise (everybody ends on exactly 1 vote → nobody dies). Agreeing never costs a ballot: if the
circle falls through, everybody's own vote counts. Choosing a person leaves the circle. If everyone has decided but not all
agreed, the agreers see 「圈票未成立：其他人已經揀咗人。你要自己揀一個人」 and the shared-phone focus asks them again.

### 3.6 `reveal`

Everyone — seats and the table screen — sees the same screen, built to be read together:

1. banner 「🎉 你贏咗！」 / 「😿 你輸咗」 (「🐺 開牌」 on the table) and the one-line summary;
2. 🗳️ 票數: one bar per player with the voters under it, ☠️ on the dead;
3. ☠️ 死咗: a card per dead player with the role they ended as (🏹 line for a Hunter's shot) — or 「冇人死」;
4. 🃏 最後張牌: per player 「派到 X → 最後 Y」, the Doppelgänger's copy, team, ✅/❌; the three centre cards at the end;
5. 點解會咁: the rule that decided it, in sentences;
6. 夜晚記錄（邊個做咗乜）: collapsed — who looked at what, who swapped what.

The host phone narrates the tally, deaths, Hunter shots and the winning side (§3.3). 「睇完整個結果」: a tap by the host (or
by every seat, or 3 minutes) opens the results screen.

### 3.7 `over` and the results screen

`result()` = `{ winners, summary, lines, points, headline, carry }` (+ `void: true` for 呢局唔計); the shell's results screen shows `lines` as a flat list under 「點解會咁」, so
they are self-contained. Points: **1 per winner**, 0 otherwise (the Tanner's solo win counts like any win — a house choice
from the research). Winners are computed **per player from the final card** (Doppelgänger = what her card copied; a card
that copied nothing = Villager), never from the dealt role. Everybody can lose (e.g. no werewolf among the players and only
the Minion died). Example (6 players; the Robber stole the lone wolf's card and was voted out; the original wolf, now a
Robber, wins with the village; the Doppelgänger copied the Hunter):

```
好人隊贏 — 狼人 玩家1 死咗
🗳️ 票數：玩家1 4 · 玩家2 1 · 玩家3 1 · 玩家4 0 · 玩家5 0 · 玩家6 0
🗳️ 邊個投邊個：玩家1→玩家3 · 玩家2→玩家1 · …
☠️ 投票死咗：玩家1（狼人）
攞住狼人牌嘅玩家：玩家1。
狼人 玩家1 死咗 → 好人贏，狼人隊（包括爪牙）輸。
── 最後張牌 ──
玩家1：派到 🗡️ 強盜，搶咗 玩家2 張牌 → 最後張牌 🐺 狼人 → 狼人隊 ❌輸
玩家2：派到 🐺 狼人，俾 玩家1（強盜） 搶咗張牌 → 最後張牌 🗡️ 強盜 → 好人隊 ✅贏
…
玩家6：派到 👥 化身幽靈 → 最後張牌 👥 化身幽靈（複製咗 獵人） → 好人隊 ✅贏
中間三張：第 1 張 🧑‍🌾 村民　第 2 張 🐺 狼人　第 3 張 🧵 皮匠
── 夜晚記錄 ──
派牌：玩家1 強盜、玩家2 狼人、…；中間 村民、狼人、皮匠
▸ 👥 化身幽靈
　玩家6 睇咗 玩家4 張牌：🏹 獵人，所以變成 獵人
▸ 🐺 狼人
　狼人 玩家2 淨係得自己醒（獨狼）
　獨狼 玩家2 睇咗中間第 2 張：🐺 狼人
▸ 🔮 預言家
　玩家3（預言家） 睇咗 玩家1 張牌：🗡️ 強盜
▸ 🗡️ 強盜
　玩家1（強盜） 同 玩家2 換牌，睇到新張牌係 🐺 狼人
```

The 「張牌嘅旅程」 inside each player's line is generated from the swap log ("搶咗 X 張牌", "俾 Y（搗蛋鬼） 同 Z 對調咗",
"同中間第 2 張對調咗"), so 「強盜搶咗狼人張牌，所以強盜先係狼人」 is spelled out for every player whose card moved. Steps whose
card is in the centre are shown too: 「▸ 🗡️ 強盜（冇人醒）」.

Winning explanation (every case, sentence by sentence in `script.js:whyLines`): village wins when a werewolf dies, or when no
player holds a werewolf and nobody dies; the werewolf team (werewolves + Minion, a dead Minion still shares) wins when a
werewolf is among the players and neither a werewolf nor a Tanner died; a Tanner wins iff he personally died (with the village
if a werewolf died too, never with the wolves; with no werewolf player: 「皮匠 X 死咗 → 皮匠贏」); with no werewolf among
the players each Minion wins iff she is alive and someone else died (a Tanner's death counts and does not block her); a
second Tanner who did not die is told 「冇死 → 佢輸（每個皮匠要自己死先贏）」. The summary says 「狼人 X 死咗」, never "voted
out": the Hunter's shot may have done it.

### 3.7a 呢局唔計 (`@void-round`)

ONUW is one round per game, so the host's `@void-round` (a phone died, the table wants a fresh deal) ends the game
**unscored**: allowed in `deal`, `night`, `day` and `vote`; refused from `reveal` on (the result is known by then).
`result()` = `{ winners: [], points: all 0, void: true, summary: '呢局唔計 — …', lines, carry }`; the lines lay open what
was hidden so far: 「🚫 房主喺夜晚宣佈呢局唔計…」, the deal, the cards that had moved, and the night recap up to that point.
Every phone shows the same short 「🚫 呢局唔計」 screen (`view.voided`); the results screen carries the lines.

### 3.7b 💡 hints (`view.hint`, BACKLOG U1 — shown only when the player taps 💡)

One line (≤ 40 characters) per phase, built from what that view already shows (the step being called, the seat's own
ability, its own vote) — the differential leak test scrambles every hidden card and vote and checks the view, hint
included, does not change.

| phase | hint |
|---|---|
| deal | 「㩒住張牌睇你係乜角色，記住佢，再㩒「記住喇」。」 / after: 「等其他人睇完張牌，夠晒人天就會黑。」 |
| night | begin 「天黑喇：閉埋眼，部手機放低。」 · cue 「閉住眼聽報；叫到你嘅角色先睜眼。」 · asleep 「呢輪冇你份：照㩒大掣，扮有嘢做。」 · one per ability (copy, seer, robber, troublemaker, drunk, lone wolf) · after acting / information only 「㩒住上面格仔睇你見到乜，記住佢。」 · dawn |
| day | 「講你係乜、見過乜（可以講大話），搵出狼人。」 |
| vote | pick · voted · agreed to the circle · the circle fell through |
| reveal / over | 「睇下邊個死咗、點解；睇完㩒「睇完整個結果」。」 · 「等房主去結果頁。」 · over · void |
| table | one public line per phase |

`rules.roles`: every text is 「做乜… 點贏：…」 (aliases stay in the 做乜 part), so the 💡 sheet's 「你嘅角色」 shows what you do
and how you win; it uses `my.dealt`, the role you were dealt — all the app ever tells you. `rules.quick`: six short lines.

### 3.8 Anti-tell handling (DESIGN §4)

- **Every step exists every time.** The step list comes from the role list, so a Seer card in the centre is called exactly
  like a Seer at the table; both Doppelgänger sub-steps are called whenever both cards are in the set, even when she copied
  something else. Test: step lists, cue texts and window lengths are identical across different deals.
- **Steps never end early.** A window ends at its deadline (or by the host). Test: every seat acted and tapped → the step
  is still there; `advance` before the deadline does nothing.
- **Every seat has something to tap in every step and stage** (`ack`). Test: all 3–10 head-counts × both presets × every
  step × cue and window — each seat has a legal `ack`.
- **Identical shape.** One layout for every step and seat; the info card, the cover slot and the button have fixed size (the
  cover slot is reserved even when empty); the grid is 2 columns up to 6 other seats, 3 above. Test (fake DOM): the night
  screen of every seat has the same shape at every step.
- **No sound at night** from the UI (the only sounds are 記住喇's lock click in the deal, the reveal fanfare and the timers' beeps by day); the shell mutes non-focused seats. Results are behind a hold-to-peek cover (so a
  neighbour with open eyes in 靜音 mode cannot read them) with no flip sound.
- **No names in counters:** 「已㩒掣 4 / 6」 on the table screen only.
- **Anonymous prompts** for a shared phone: 「預言家請拎起部手機」 — the role, never the seat (`focus.anonymous`).
- **Honest limit (靜音 mode, eyes open):** a lit screen is visible to the neighbours, because the shell lights exactly the
  awake seats. Voice and 讀稿 play with closed eyes; in 靜音 play ask everyone to turn the brightness down and cup the phone.
- **Lapses are silent too:** an optional ability nobody confirmed is simply a note in the owner's recap; a mandatory one
  (Drunk's swap, Doppelgänger's copy) is made for them with the note 「系統幫你隨機揀」.

## 4. Single-device play (and paper mode)

`meta.singleDevice = 'partial'`, no paper mode. With the whole game on one phone (`app.local`), the shell behaves like this:

0. **defaults**: `config.defaults(n, prev, { singleDevice: true })` picks the slow pace (×1.5 on every window).
1. **deal**: `focus.pids` shrinks as seats tap 記住喇, so the phone walks seat to seat behind a PassGate
   (「交俾 阿B ・ 其他人唔好望」); the same for **vote**.
2. **night**: the phone sits in the middle, everybody keeps their eyes closed. When a window opens with someone awake the
   shell shows a gate 「預言家請拎起部手機」 (role, not name); that seat taps it, acts, and puts the phone back. Two awake
   seats (the werewolves, the masons) look one after the other: the first uses 換人 ⇄ to hand over.
3. **day / reveal**: the phone lies on the table. Everybody tapping 「夠鐘投票」 would mean passing the phone round, so on one phone the host starts the vote with ⋯ → 「下一步」 (or the timer runs out); the same menu entry opens the results after the reveal.

What leaks, honestly: a step whose role is in the centre has nobody awake, so **no gate appears** (see framework request 1);
and reaching for the phone is audible. Both only matter to people with open eyes, hence "everybody keeps their eyes closed",
and why one phone each is recommended. The research's alternative for one phone (pass-around slots, resolve later) is not
built: this engine runs the classic sequential night. Nothing else is device-specific: acting for a seat and the decoy tap
are the same actions.

## 5. Engine

Phases: `deal` → `night` (`stage: 'cue' | 'window'`, step index `ix`) → `day` → `vote` → `reveal` → `over`.

State (JSON; **PRIVATE** = never in any view before `reveal`):

```
game, gid, n, cfg (normalised), order [pid…], names {pid: name}, host (hostPid, else the first seat), voided,
phase, deadline, timerLabel,
counts {role: n}                 public: the role list
cards {pid: {role, copied?}}     PRIVATE: the card in front of each seat NOW
centre [{role, copied?} × 3]     PRIVATE
orig {pid: role}                 PRIVATE: dealt role — decides who wakes
dealtCentre [role × 3]           PRIVATE until reveal
dop null | {pid, target, copied, acted}   PRIVATE: the Doppelgänger's copy
steps [{k}], ix, stage, acked [pid…], did {pid: true}
notes {pid: [note]}              PRIVATE per seat: what that seat learned (only the owner's ever leaves, via view())
log [event], moves [{k, by, via, ps, c}]  PRIVATE until reveal: the whole night, for the recap
ready {pid}, dealCue, dayReady {pid}, extends, votes {pid: pid}, ringAgree {pid}, voteCue, revealDone {pid}, revealCue
final, report, outcome           the analysis, the report and the result, from `reveal` on
```

`card.copied` exists only on the Doppelgänger card and travels with it. `finalRole(card)` = the card's role, or for the
Doppelgänger card what it copied (a card that copied nothing is a Villager).

### Actions (all validated; wrong phase / stage / seat, illegal targets, garbage → state unchanged, never a throw)

| action | pid | when | rule |
|---|---|---|---|
| `{type:'ready'}` | seat | `deal` | once; all ready → `night` |
| `{type:'ack'}` | seat | `night`, both stages | the decoy tap: marks the seat in `acked` (a counter, no names), changes nothing else |
| `{type:'copy', target}` | Doppelgänger | `doppelganger` window | another player; once |
| `{type:'look-player', target}` | Seer, or Doppelgänger-Seer | window | another player; one look per step |
| `{type:'look-centre', cards:[i,j]}` | Seer / Doppelgänger-Seer | window | two distinct of 0–2 |
| `{type:'look-centre', cards:[i]}` | the lone werewolf | `werewolf` window | `loneWolf` on, exactly one werewolf awake, once |
| `{type:'rob', target}` | Robber / Doppelgänger-Robber | window | another player |
| `{type:'swap', a, b}` | Troublemaker / Doppelgänger-Troublemaker | window | two different players, neither is the actor |
| `{type:'drunk-swap', card}` | Drunk / Doppelgänger-Drunk | window | 0–2 |
| `{type:'ready-vote', on}` | seat | `day` | all seats on → `vote` |
| `{type:'extend'}` | host seat | `day` | +60 s, at most 6 times; accepted from anyone only if no host is known |
| `{type:'vote', target}` | seat | `vote` | another player; replaces the previous vote; leaves the ring; last vote → `reveal` |
| `{type:'ring', on}` | seat | `vote`, `ringVote` | all seats on → ring votes → `reveal` |
| `{type:'done'}` | seat | `reveal` | the host seat (or every seat) → `over` |
| `@cue-done {id}` | host | `deal`/`night` cue/`vote`/`reveal` | acknowledges the cue if the id matches; in a night cue it opens the window |
| `@next` | host | any | acknowledges a pending cue first; then: deal → force night, cue → open window, window → settle and move on, day → vote, reveal → over |
| `@void-round` | host | `deal` / `night` / `day` / `vote` | 呢局唔計 (§3.7a): straight to `over`, unscored; a seat sending it changes nothing |

The Doppelgänger uses the same action types for the copied role (`via: 'doppel'`), only in her own step.

### Windows, lapses, deadlines

`enterWindow`: `acked` and `did` reset, `deadline = now + windowMs(cfg, step)` (see §3.2), the awake seats' information notes are
written (werewolves, Minion, Masons, Insomniac, the two sub-steps). `advance` at the deadline (or `@next` in a window) runs
`resolveWindow`: a Doppelgänger who never copied copies a random other player; a mandatory swap nobody made (Drunk,
Doppelgänger-Drunk) is made at random (`auto: true`); every other unused ability becomes an `idle` note. Then the next step's
cue stage, or the day. `day`: `deadline = now + discussSec` (default by head-count). `reveal`: 3 minutes.

### `focus` and `autoAct`

`focus`: `deal` → seats not ready · night window of a calling step → `{ pids: awake seats, anonymous: '預言家請拎起部手機' }` —
**also with `pids: []`** when the role sits in the centre · cue stage, `begin`, `dawn` → null · `vote` → seats with no vote and no
ring agreement (once only agreers are left, those) · everything else null.

`autoAct`: `deal` → ready · night: copy (random other), drunk (random centre), seer (random centre pair), everything else the
harmless `ack` · `day` → ready-vote · `vote` → random other · `reveal` → done.

### `blocking(state, pid)` (stall detection)

`true` only where nothing but that seat moves the game: `deal` (it has not tapped 記住喇) and `vote` (the seats `focus`
still asks). `false` in every night cue and window, the day and the reveal: they run on deadlines, and at night every
seat has the decoy, so "has a legal action" (the session's fallback) would flag — and show the host — exactly the awake
seats.

### `setup` and `carry`

`setup({ players, config, rng, now, hostPid, carry })`: `hostPid` is the host seat (host-only +60 s and 「睇完整個結果」),
else the first seat. `carry` is the previous onuw game's `result().carry = { wolves: [pids dealt a werewolf] }` (the room
keeps it, it never reaches a phone); only `antiStreak` reads it. Junk carries are ignored.

### `legalActions`

Exactly what the table above allows now. Every seat always has `ack` (until it has tapped in this stage) — that is the
decoy assertion. The Troublemaker's list is all pairs of the others; the Seer's is every other player and the three centre pairs.

### Views (whitelist, built field by field)

Common: `seat, phase, n, title, subtitle, night, roleList [{role,count}], opts {loneWolf, ringVote, pace}, hint, deadline?, timerLabel?`.
Per phase: `deal` `ready {done,total}`; `night` `step {ix,total,k,stage}`, `acks {done,total}`; `day` `dayReady {done,total,mine}`,
`canExtend`; `vote` `progress`, `ring {on,done,total,mine,stuck}`; `reveal`/`over` `reveal {…}` and `revealDone` — or, for a
voided game, only `voided: true`.

`my` (seats only): `dealt` (the viewer's own dealt role), `ready`/`acked`; `night: { awake, info, ab, copied }` — `info` = this
seat's notes of the current step, `ab = { name, via, mandatory, mode }` is what it may still do (`mode` ∈ `player`, `seer`, `pair`,
`centre1`); `notes` (day and vote) = the dealt role + all of the seat's own notes. **Never**: the seat's current card, any
other seat's anything, the centre, the log, others' votes before the reveal. `reveal` (from `reveal` on) carries the votes,
counts, deaths, shots, every card (`orig`, `face`, `copied`, `final`, `team`, `won`, `dead`), the centre, the summary and the three
text blocks `why` / `cardLines` / `recap`.

### Result and the analysis

`analyse({ order, cards, centre, orig, dealtCentre, votes })` is a pure function (exported, so tests run the research vectors
straight through it):

```
counts[q] = votes on q; max = highest; tied = (max >= 2) ? { q : counts[q] == max } : {}      dead = tied
Hunter cascade: each dead Hunter (by FINAL role) shoots the player he voted for (also with 0 votes);
                a newly dead Hunter shoots too; an already dead target changes nothing; cycles end
W = final werewolves · M = final Minions · T = final Tanners
villageWins  = any W dead  ||  (no W && nobody dead)
wolfTeamWins = W non-empty && no W dead && no T dead
win(Tanner)  = he is dead
win(wolf)    = wolfTeamWins                       win(Minion) = W non-empty ? wolfTeamWins : (alive && anybody dead)
win(village) = villageWins
```

## 6. Edge cases → test list (`tests/onuw.test.mjs`)

- **Config**: meta/rules/engine shape (quick ≤ 6 short lines; every role splits into what-you-do / how-you-win); registry
  meta equals game meta (G16); no CJK literals in `game.js`; recommended sets valid for n 3–10, official for 3–5, `n+3`
  cards, caps, masons as a pair, ladder; advanced swap; defaults valid for every n and preset, summary and reason, fields;
  defaults keep/sanitise/refit; one phone → slow pace; presets (valid, distinct, readable reason, each recognised after a
  tap, beginner without Doppelgänger/Hunter/Tanner, the research sets at 8/9, all-special only at 10); validate errors and
  warnings; custom editor with villager auto-fill.
- **Fair deal**: carry ignored when `antiStreak` is off (same deal); on: last game's dealt wolves never get one, every n,
  uniform over the other places (3,000 deals); junk carries; `result().carry`.
- **Setup**: `n+3` cards from the role list, 3 centre, `orig == dealt`, deterministic, `hostPid` (and bad `hostPid`), bad config
  survives, out-of-range head-count throws; step list from the role list incl. centre cards and both sub-steps; deal phase.
- **Night rules** (research "Edge cases"): werewolves see each other; lone wolf peek only when alone, once, one card, changes
  nothing, option off; both wolves in the centre (step still called, Minion sees nobody); Minion sees wolves, wolves never learn
  the Minion; Masons (pair, lone, none); Seer (one player or two centre cards, never both, never herself, distinct, optional,
  Doppelgänger face); Robber (sees the new card, victim told nothing, once, declines, never performs the stolen role);
  wake-by-original-role (Robber steals the Troublemaker card); Troublemaker (others only, blind, positions after the Robber);
  Drunk (mandatory, blind, old card to the centre, lapsed window swaps); Insomniac (final card after Robber, Troublemaker, Drunk).
- **Doppelgänger**: target rules; copy of Villager/Tanner/Hunter; Seer acts at once and never again, the real Seer acts later;
  Robber robs a Werewolf (card carries "robber"); robbed Doppelgänger-Insomniac still wakes; Werewolf (counts as awake, kills the
  lone-wolf peek, Minion sees her); Mason; Minion (sub-step, not step 3, called even when she copied something else); Troublemaker
  swaps before the real wolves/seer act; Drunk (card with copy in the centre; a plain Doppelgänger card = Villager); Tanner copy;
  lapse rules.
- **Pacing and anti-tell**: every seat has a legal action in every step and stage (all n, both presets); view.night and
  focus; windows never end early; fixed lengths per kind and pace, identical across deals; cue texts and ids; 下一步 semantics;
  begin/dawn; the day timer starts when dawn closes.
- **Day, vote, deaths, win**: timer by head-count, early vote, host-only +60 s with a cap; vote validation and change; ring vote
  (all agree, ballots kept, stuck state, off); the research vectors V1–V15; win-matrix rows 1–18; ties of 2/3/4; ring = nobody;
  Hunter (zero votes, chain, cycle, already dead, Doppelgänger-Hunter, swapped card, kills Tanner); two Minions; two Tanners.
- **Reveal and results**: the four ways out of `reveal`; result lines contain tally, deaths, card trails, the night recap;
  summary sentences per outcome; why-lines name every winner (a Tanner with no werewolf player, two Tanners); points;
  nobody-wins is well-formed.
- **Framework hooks**: `blocking` (deal and vote only; never at night, in the day or the reveal; through a real `Session`);
  `@void-round` in each voidable phase (unscored, lines lay open the deal and the night, every view `voided`, nothing moves
  after) and refused from the reveal on; 💡 hints for every phase / seat / table, ≤ 40 characters, checked in every leak
  pass.
- **Leaks**: structural whitelist of view keys; no secret key before the reveal; differential check (scramble every hidden
  card/vote → every seat's and the table's view is unchanged); own notes only; a robbed Doppelgänger shows only its face;
  votes secret until the reveal.
- **Fuzz**: every head-count 3–10 × 100 seeds (preset / advanced / random custom sets): terminates, every night step runs once,
  in order, cue then window, fixed window length, cards conserved, an independent referee (the research pseudo-code) agrees on
  dead and winners, points sum, state is plain JSON, deterministic by seed; garbage actions never throw; autoAct for every phase.
- **UI** (fake DOM): every phase for every seat, idempotent, finished by tapping alone; identical night shape; each ability
  sends the right action; private results only on the owner's screen; day recap without a current card, host-only +60 s;
  the public reveal; vote and ring; a seatless device; the 呢局唔計 screen.
- **Room**: a dropped phone is never flagged at night or in the day, only when the vote waits on it; `carry` reaches
  `room.carries` and never the results screen.

## 7. 貼心 touches

- The role list and the reason for the preset are shown to everybody; the preset changes by itself when somebody joins.
- Slow table? 新手 pace (×1.5) stretches every window by the same factor, so nobody can tell who is slow.
- Choosing is two taps (pick, confirm) and an unwanted optional ability is just not confirmed — no "are you sure" dialogs.
- Results behind a cover with no sound: neighbours in 靜音 mode cannot read or hear them.
- Mandatory choices are never lost: a lapsed Drunk or Doppelgänger gets a random choice and a note saying so.
- The day recap keeps "what I was dealt" and "what I saw" so nobody has to remember, and warns that the card may have changed.
- 圈票 in one tap, without losing anybody's own ballot if it falls through.
- The reveal shows who voted for whom, the dead players' cards, **every** final card and the swap trail, then the night
  recap: 「原來係咁」 for the whole table, not just the winners.
- The host phone reads the outcome aloud (tally, deaths, Hunter shot, winners) so people look at each other, not at the phone.
- Host extras: +60 s on the timer, 下一步 at every step, pause from the shell menu, 代佢做 for a dead phone (autoAct on every phase),
  呢局唔計 when a dead phone spoiled the night.
- One-tap presets with a reason (新手 leaves out the Hunter / Tanner and slows the night); one phone for everybody gets the
  slow pace by itself.

## 8. Framework requests

1. **Shared phone, empty step.** `room.filterFocus` returns `null` when none of a device's seats is in `focus.pids`, so on a
   one-phone game a step whose role sits in the centre shows **no** 「請拎起部手機」 gate while a step with a live role does —
   a tell for anyone with open eyes. Please keep `{ pids: [], anonymous }` for a device that holds at least one seat, and let
   the play screen show the same gate for an empty `pids` (any seat on the device may tap it).
2. ~~Stall detection in timed phases~~ — done with `engine.blocking` (§5). Without it the session fell back to `focus` /
   `legalActions` and flagged a dropped phone mid-discussion (and, in a night window longer than the stall limit, exactly
   the awake seat).
3. ~~`hostPid` in `setup`~~ — done (the Room and `Sim` pass it).
6. **A voided game should not count as played.** `room.#finish` adds 1 to `played` for every seat even when
   `result.void === true`; please skip the scoreboard (and perhaps the history line) for a void result.
7. **No UI for `hostCtl.voidRound()` yet.** The host ⋯ menu needs a 「呢局唔計」 entry (with a confirm) for games that support
   `@void-round`.
4. **Results lines as sections.** `result.lines` is a flat list; this game wraps the recap in `── 最後張牌 ──` / `── 夜晚記錄 ──`
   header lines. Support for `{ h: 'title' }` entries (or `result.sections`) would render them as headings.
5. **Cover has `openSound: 'none'`** (used for every night cover so peeking is silent); if the component ever drops that prop,
   the night would start to click.
