# 通用派牌＋骰盅 (`custom`) — play-flow spec

> Batch 1. Port of the whole v1 app (`js/game.js`, `js/roles.js`, `js/app.js`) as an engine +
> UI under the v2 framework, with generic presets (G17), per-head-count reasons (#8), the 💡 hint (U1),
> an optional anti-streak (#20) and a result that explains itself (#10).
> All user-facing text is Hong Kong Cantonese. Times in UTC.
> Code: `js/games/custom/{game,ui,index}.js`, `style.css`. Tests: `tests/custom.test.mjs`.

## 1. At a glance

| | |
|---|---|
| Players | 2–16 seats (the host's seat counts). With a moderator host, 2–16 seats but at least 2 card holders, so 3+ seats. |
| Minutes | 5–30 (open-ended; same as the registry entry, G16) |
| Narration | `none`. No cues, no timers, no night. |
| Single device | `full` |
| What the phones do | Deal one private role card per player from a deck the host designs; hold secret dice under a cup; remember who peeked; lock a card or a roll; let the host roll everyone, open all dice, open all roles, start the next round, end the game. |
| What happens at the table | Everything else. The app does not know the game: the group decides what the roles mean, when to call a vote, who won. |

It is the "any deck + any dice" tool for games the box does **not** list: a one-traitor guessing game,
random teams, 國王遊戲, the classic 殺手遊戲 with a human 法官, 狼人殺 with a human moderator and house
roles, a liar's-dice round, a drinking game. The box has real 芝士大盜 / 狼人殺 / 誰是臥底 now; the rules
sheet points people there (G17).

## 2. Setup

### Config (`cfg`)

| key | Field type | default | notes |
|---|---|---|---|
| `preset` | `select` | `traitor` | `traitor`, `teams`, `king`, `killer`, `werewolf`, `custom` |
| `roles_<preset>` | `roles` | per preset, fitted to k | one role list **per preset** (see below) |
| `hostPlays` | `bool` | `true` | off = the host is a moderator: no card, no dice |
| `modSees` | `bool` | `false` | only offered when `hostPlays` is off: the moderator also sees every role |
| `diceCount` | `int` 1–5 | `1` | |
| `diceSides` | `select` d4 d6 d8 d10 d12 d20 | `6` | values are numbers; strings from a form are coerced |
| `selfRoll` | `bool` | `true` | off = only the host may roll (own cup or everybody) |
| `antiStreak` | `bool` | `false` | 唔好連續攞同一張特別牌 (#20, see §5 deal) |

A role is `{ id, name (≤ 16), emoji (≤ 2 characters), count, desc (≤ 60), filler }`. At most one role is the
auto-fill (`filler`): it gets whatever card holders are left. Sanitising (`cleanRoles`) fixes ids (unique
strings), keeps only the first filler, clamps counts, falls back to `角色 N` / `❓`, and never throws.

**Why one list per preset.** The config form is generic and a `select` change cannot rewrite another
field. So every preset keeps its own list under `roles_<presetId>`, `fields()` points the `roles` Field
at the active preset's key, and edits survive switching presets back and forth.

### Presets (generic; sized by k = card holders)

Every preset role's `desc` reads `做乜：… 點贏：…` (U1): the card shows it, and the shell's 💡 sheet
splits it the same way.

| preset | label | deck for k holders | reason under the picker |
|---|---|---|---|
| `traitor` | 🎭 一個內鬼 | 🎭 內鬼 ×(2 if k ≥ 9 else 1) · 🙂 好人 (auto) | 最簡單：得一個人唔同一伙… / 人多就兩個內鬼… |
| `teams` | 🔴🔵 隨機分兩隊 | 🔴 紅隊 ×⌈k/2⌉ · 🔵 藍隊 (auto) | 隨機分隊，唔使包剪揼；單數人，紅隊多一個。 |
| `king` | 👑 國王遊戲 | 👑 國王 ×1 · 1️⃣ 1 號 … (k−1) 號 ×1 each (keycaps to 🔟, then 🔢), **no filler** | 國王叫號碼出題，大家照做… |
| `killer` | 🔪 殺手遊戲 | 🔪 殺手 ×max(1, ⌊k/4⌋) · 👮 警察 ×same · 🧑 平民 (auto) | 經典 1 : 1 : 2；要有個法官… |
| `werewolf` | 🐺 狼人殺（真人主持） | 🐺 狼人 ×(3 if k ≥ 10, 2 if k ≥ 6, else 1) · 🔮 預言家 · 🧪 女巫 · 🏹 獵人 · 🧑 平民 (auto) | 真人主持叫天黑；想部機做主持就揀主頁「狼人殺」。 |
| `custom` | ✏️ 自訂 | 🅰️ 角色 A ×1 · 🧑 平民 (auto), no text | 自己加減角色；開局前講清楚… |

Removed in G17: v1's `cheese` / `cheeseGang` (偵探 and 守衛 were invented, not Cheese Thief roles) and
`undercover` (the box has 誰是臥底). A saved config naming one of them falls back to `traitor`, keeping the
rest of the setup (dice, host mode…).

If the fixed roles do not fit `k`, counts shrink from the bottom of the list until they do (a head-count too
small for the werewolf preset drops 獵人, then 女巫, …).

**#8 — composition with a reason.** The picker's options read `🔪 殺手遊戲 — 2 殺手 + 2 警察 + 4 平民`
for the current k, and the preset field's help is the reason line, e.g.
`8 人：2 殺手 + 2 警察 + 4 平民 — 經典 1 : 1 : 2；要有個法官，建議房主唔攞牌做法官。`
(`8 人攞牌：…` when the host moderates).

### `defaults(n, prev)`

- `defaults(n)` is the `traitor` preset with `hostPlays: true`; valid for **every** n in 2–16 (tested for
  every preset, host playing and moderating).
- `prev` (last used config) is honoured key by key: preset, dice, `selfRoll`, `antiStreak`, `hostPlays`,
  `modSees`, every role list. A role list is:
  - **untouched** (equal, ignoring ids, to that preset's stock list for some head-count) → regenerated for the
    new k, so an untouched werewolf deck goes from 2 to 3 wolves at 10 holders and a 國王 deck grows a number;
  - **edited** and still fitting → kept;
  - **edited** and no longer fitting → **repaired**: no filler → the biggest role becomes the filler, then fixed
    counts shrink from the bottom. A deck of one-of-a-kind cards (every count ≤ 1, e.g. an edited 國王 deck)
    gets no filler (never two kings, never two 3 號): it is only trimmed;
  - still invalid after that → that preset's stock list for k (other settings kept).
- A moderator seat that no longer fits (n = 2) flips back to `hostPlays: true`. Garbage `prev` is ignored; the
  result is always valid.

### `validate(cfg, n)`

`k` = card holders = `n` if the host plays, else `n − 1`.

| condition | `ok` | message |
|---|---|---|
| n outside 2–16 | no | 人數要 2–16 個 |
| diceCount ∉ 1–5 | no | 骰仔要 1–5 粒 |
| diceSides ∉ {4,6,8,10,12,20} | no | 骰仔面數要係 d4、d6、… 其中一個 |
| fewer than 2 roles | no | 最少要兩個角色 |
| k < 2, host plays | no | 最少要 2 個玩家 |
| k < 2, moderator | no | 房主做主持嘅話，最少要 3 個人（而家得 N 個） |
| filler exists, fixed > k | no | 指定角色共 F 個，多過 K 個玩家 — 減少啲。 |
| no filler, fixed ≠ k | no | 角色總數 F，但有 K 個玩家 — 要啱數先開得。 |
| fine | yes | `F 個指定角色 + L 個「村民」= K 人 ✓` (moderator: `…（主持唔攞牌）`) |

Warnings (still `ok`): duplicate role names (`有角色同名：「X」，開牌嗰陣會分唔清。`); a deck with no special
role at all (`冇指定任何特殊角色，所有人都係「X」。`); `killer` / `werewolf` while the host plays
(`呢個玩法要有人做主持叫天黑：建議熄咗「房主一齊玩」，由房主做主持。`).

`fields(cfg, n)`: the seven/eight Fields above; the `roles` Field gets `max = k` (the + button cap) and
`help = validate().message`, so the v1 green/red total line is the field's help text.
`summary(cfg, n)` (lobby): the deck's name first (`🎭 一個內鬼`, `…（改過）` once edited), one line per role
with its **actual** count for n (`🎭 內鬼 ×1`, `🙂 好人 ×5`; more than 6 roles are packed 4 per line, so a
16-seat 國王 deck stays short), then `🎲 2 × d6`, then `房主一齊玩` or
`房主做主持（唔攞牌，睇到所有人角色）`, then `唔會連續攞同一張特別牌` when anti-streak is on.

## 3. Flow

There is one live phase, `play`, which repeats per **round**, and a terminal phase `ended`.

```
setup ── deal (round 1) ──▶ play ◀── next-round (round+1, new deal, dice cleared)
                              │  ▲── redeal (same round, roles only)
                              ▼
                            end ──▶ ended ──▶ results screen (再玩一局 / 換遊戲)
```

### What each phone shows (top to bottom)

**Status banner** (every seat):

| situation | text |
|---|---|
| before the first view of this game arrives | 載入緊… |
| my card not yet looked at | 輪到你睇牌 👇 㩒住張牌 |
| others still to look | 等緊 N 個人睇牌 |
| dice opened (and my card looked at) | 👁 開咗盅 — 睇下面「開盅」 |
| everybody looked | 大家都睇咗牌 ✓ |
| roles revealed | 🔓 角色已經公開 |
| game ended | 🏁 遊戲完咗 |

**Card holder** (host-as-player included):

1. **骰盅** — `DiceCup`: hold to lift the cup, 🎲 搖我嘅骰, 🔓 鎖定點數, shake to roll (the cup's own hints:
   㩒住掀起個盅 · 㩒住睇得，但搖唔到新骰 when locked). The card header adds the reason when rolling is off
   altogether: 已經開盅，要主持再搖 (revealed) · 今次淨係主持幫大家搖 (`selfRoll` off). In both cases the cup hides its roll button.
   A **locked** cup is a state, not two greyed-out buttons: the roll and lock buttons go (`canRoll: false`, no
   `onLock`), the cup keeps its corner lock badge, and the header shows a badge 「🔒 鎖定咗點數 · 主持先解得」
   (the host's own seat: 「🔒 鎖定咗點數」 — the host controls unlock it). The cup still lifts: it is your own number.
2. **開盅 🎲** (only after the host opened the dice) — everyone's dice as real faces, with `= sum` for 2+ dice. It sits
   right under the cup, on the first screen (the cup stays ABOVE the role card, as asked).
3. **我嘅角色牌** — `RoleCard` (hold to peek, release to cover): emoji, name, the role's `做乜：… 點贏：…` text
   (no team label — the roles are the group's own). Hint: 㩒住先睇到，放手即刻冚返 · 已鎖定，㩒下面解鎖 · 大家嘅角色都公開咗.
   Button: 🔓 鎖定角色牌 / 🔒 已鎖 — 㩒一下解鎖 (gone after the reveal, nothing left to hide).
4. **場上玩家** — roster in seat order. Tags: 主持 · 已睇牌 / 未睇牌 · 🎲 已搖 (rolled more than once this round:
   🎲 已搖 ×3, in red — a roll-until-it-fits shows before the lock) · 🔒骰 · 🔒牌, and after the
   reveal `🎭 內鬼`. Never a number a die shows, never a role before the reveal. **Long-press** (≈ ½ s, a scroll
   or tap does nothing) a role tag → a toast with its `做乜：… 點贏：…` line (U1); the tag's `title` says the same.
5. **主持控制** (host seat only, see below).
6. **🃏 本局牌組** (fold): every role with its count and text — public, it is in the lobby summary anyway.
7. **📜 記錄** (fold): newest first, last 25 lines, no timestamps (so no timezone to get wrong).

**Moderator** (host who does not play): no cup, no card. A note instead:
`你係主持 🎙️ 今次你唔攞牌、唔擲骰，由你控制場面。` — or, with `modSees`, `…你睇到所有人嘅角色（下面）。`
In the roster every holder carries a teal tag `👁 🔪 殺手` that nobody else sees. After the reveal it turns
into the public tag.

**Spectator / table view** (`pid = null`): note `你喺度睇緊 👀 下一局先加入到。`, roster, showdown, deck, log.
The table view is exactly the public part of every player's view.

**Host controls** (shown only on the host's seat, only while `play`):

| button | action | enabled when | confirm text |
|---|---|---|---|
| 🎲 全體搖骰 | `roll-all` | some card holder exists | if any cup is locked: 有人鎖咗骰盅，全體搖骰會一齊解鎖。繼續？ |
| 🔓 解鎖骰盅 | `unlock-dice` | some cup is locked | — |
| 👁 開晒啲骰 | `reveal-dice` | not yet revealed and someone rolled | 公開所有人嘅骰？ |
| 🃏 重新派牌 | `redeal` | always | 重新派牌（唔加回合數）？大家要重新睇牌，骰唔會變。 |
| 🔓 開晒角色 | `reveal-roles` | not yet revealed | 開晒所有角色？呢個回合就完喇。 |
| ➡️ 下一回合（重新派牌） | `next-round` | always | none (v1 parity) |
| 🏁 結束遊戲 | `end` | always | 結束遊戲？會去結果頁，所有角色同骰都會公開。 |

On a roster row whose cup is locked the host also gets a small 🔓 that unlocks just that seat.

### 💡 hint (U1 — shown only when the player taps 💡, never by this UI)

`view.hint`, one line (≤ 30 characters), built only from public facts plus this seat's own
"have I looked / am I the host / do I hold a card" — never from a role (tested by moving the cards and
checking no hint changes).

| situation (first match wins) | hint |
|---|---|
| game ended | 玩完喇：睇下結果，邊個贏由你哋自己講。 |
| spectator / table | 你喺度睇緊，下一局先入到場。 |
| roles revealed, host | 角色公開咗：對完答案，㩒「下一回合」重新派牌。 |
| roles revealed, others | 角色公開咗：對下答案，等主持開下一回合。 |
| my card not looked at | 㩒住張牌睇自己係咩角色，記住就放手，唔好講出口。 |
| dice opened | 開咗盅：睇下面「開盅」比大家嘅點數。 |
| moderator, others still looking | 你係主持：等大家睇完牌，再講規則開始玩。 |
| moderator, everybody looked | 大家睇完牌喇：講規則開始玩，要時用下面嘅主持掣。 |
| holder, others still looking | 等其他人睇完牌；記住唔好講自己係咩角色。 |
| host holder, everybody looked | 大家睇完牌喇：開始玩，要時用下面嘅主持掣。 |
| holder, everybody looked | 跟大家講好嘅規則玩；要擲骰就搖骰盅。 |

「你嘅角色」 in the 💡 sheet comes from `view.me.role` (the shell's `roleFor` falls back to the card's own
name / emoji / `desc`); `rules.roles` ids (`moderator`, `traitor`, `killer`, …) never clash with dealt role
ids (`<preset>_<n>`), so a renamed card can never be matched to the wrong text.

### Peek, seen, locks

- **Peek.** Hold the card, release to cover. The cover also closes on `visibilitychange`, `blur`,
  `pagehide` (inside `Cover`). A card that has been latched refuses the press with a shake.
- **Seen.** `seen` is sent (via `RoleCard.onOpen(false)`) when the finger is **released** after a peek, never on press. On a shared phone the
  pass gate therefore moves on only once the peek is over. Latching the card (`lock-role on`) also counts as seen.
- **Role lock** (owner only, both ways): a friend mashing your phone sees nothing; it refuses the peek, even
  for the owner, until the owner unlocks. Cleared by the reveal (nothing left to hide) and by every deal.
- **Dice lock** (owner locks, **only the host lifts**): freezes the roll. You can still read your own number,
  you cannot roll again, so nobody re-rolls for a better one. `roll-all` and `next-round` lift locks; the host can
  also lift all, or one seat.
- **Reveal dice** is final until the host rolls everyone again or starts a new round: while the dice are open,
  individual `roll` and `lock-dice` are refused (a re-roll after seeing everyone else's dice would be a swap).

### Sound and animation (via `api.sfx`)

Only on a *change* between two views (the first view a phone gets is history, not news):
new deal (`dealId` changed, including 重新派牌) → `deal`; roles opened → `reveal`; dice opened → `lift`;
a moderator pressing 全體搖骰 (no cup to rattle) → `roll`. `RoleCard` plays flip / lock / unlock / deny itself and
`DiceCup` plays lift / roll / lock / deny itself (this file does not double them).
The cup's roll chime is keyed on `me.rollSeq` (per-seat roll **counter**, never reset, so a repeat number
still chimes and a deal that re-sends the same dice does not).

### Robustness of the UI

`update(view, ctx)` runs the view through `normaliseView` first. A view without a `seats` array is **not
ours** and is ignored (nothing redrawn, no sound): on a P2P client the `room` message that starts this game
can land before the `views` message, so for a moment the shell still holds the previous game's views. That
case used to throw `TypeError: Cannot read properties of undefined (reading 'filter') at statusLine` (the old
`ui.js:191`). Every other field is defaulted (`roles`, `log`, `can`, `dice`, `me`, flags); a `null` ctx, a
non-array `api.players`, a missing `api.sfx` and an `api.send` that throws or returns a rejecting Promise are
all tolerated (the shell itself toasts a failed send).

### Anti-tell handling

This game has no night, so the tells are about the *table*:

- The public roster carries only neutral flags: `seenRole`, `rolled`, `rolls` (how many times this round — the log
  already says each roll, the count only makes it visible at a glance), `roleLocked`, `diceLocked`. No value,
  no role, no count of pips, before the host opens them. `me.dice` is only ever the viewer's own.
- `seen` fires on release, so how long you looked is not broadcast; the flag is binary and is public on purpose
  (it is how the group knows everybody has seen their card).
- A locked card and a locked cup look the same for every role.
- The public log says *that* someone rolled or locked, never what.
- The moderator is **blind by default**, so a host-moderator cannot be accused of peeking. `modSees` is an
  explicit, visible choice (the lobby summary says so) for games where the moderator must know.
- Reveals are host-only and confirmed; nobody can open another seat's card or cup.
- The 💡 hint never depends on a role.

## 4. Single-device play

`singleDevice: 'full'`. One phone on the table, every seat on it.

- After every deal the engine's `focus` names all card holders that have not looked yet, in seat order, so the
  shell walks the pass gate: 交俾 阿明 · 其他人唔好望 → peek, release → next seat. After everyone has seen,
  `focus` is `null` and the phone is free to switch seats through the header.
- A moderator or a seat that has no card never appears in `focus`.
- Dice: switch to a seat, hold the cup, roll. Or host: 🎲 全體搖骰, then everyone peeks at their own cup in turn.
- **Host controls live on the host's seat.** To use them switch to the host seat. That is deliberate: nobody
  can hit 開晒角色 by accident while looking at their own card.
- `autoAct` for a stalled or disconnected seat is `seen` (skip their peek) so a dead phone cannot hold up the walk.
- Paper mode: none (`paperMode: false`).

## 5. Engine

### Phases

`'play'` and `'ended'`. No timers: `advance` is the identity, `state.deadline` is never set, `cue` is `null`.

### State (plain JSON). PRIVATE fields are never copied into another seat's view.

```
phase, round, dealId            // dealId counts every deal incl. redeal; the UI recreates the Cover on change
hostPid                         // see "Host identity" below
selfRoll, modSees, antiStreak
dice: { count, sides }
roles: [{ id, name, emoji, desc, count, filler }]   // public; count is the ACTUAL count (filler resolved)
order: [pid]                    // seat order
seats[pid]: {
  id, name, playing,            // playing = holds a card and a cup (false for a moderator)
  roleId,                       // PRIVATE until revealRoles
  dice: [n] | null,             // PRIVATE until revealDice
  rollSeq,                      // PRIVATE to the seat (never in anyone else's view)
  roleLocked, diceLocked, seenRole
}
revealRoles, revealDice
log: [{ n, text }], logSeq      // public; n is monotonic so identical lines still differ
```

### Host identity

The engine needs the host's seat (host-only actions, who is the moderator). `setup` takes it from, in order:
the `hostPid` argument (the room passes it now — G1), a `players[i].isHost` flag, the first seat in seat order.

### Deal and anti-streak (#20)

`deal` shuffles the deck onto the card holders and resets every per-card flag. With `antiStreak` on, a seat
does not get the **special** card it held at the previous deal when the deck allows. Special = not the filler,
and at most a third of the table (`count × 3 ≤ k`): 國王, every number, 內鬼, 殺手 — not a 紅隊 that is half the
table (that would just flip the teams). Uniform rejection sampling (up to 60 shuffles, then the one with the
fewest repeats), so no seat is favoured. Off = exactly one shuffle (the same random stream as before).
Across games: `result().carry = { roles: { pid: roleName } }`; the room hands it back to the next `setup` of this
game as `carry`, matched **by role name** (ids are per deck). Garbage carry is ignored. First speaker: not
applicable (the app does not run turns).

### Actions (`act(state, { pid, action }, ctx)`; anything invalid returns `state` unchanged, never throws)

| type | by | valid when |
|---|---|---|
| `seen` | seat | holds a card, has not seen it, roles not revealed |
| `lock-role` `{on: bool}` | seat | holds a card, roles not revealed, `on` is a boolean that differs from the current latch |
| `roll` | seat | holds a cup, cup not locked, dice not revealed, and (`selfRoll` or host) |
| `lock-dice` | seat | has rolled, cup not locked, dice not revealed |
| `roll-all` | host | there is a card holder. Rolls every holder (lifts their locks), hides revealed dice, sets every holder's `rolls` to 1 |
| `unlock-dice` `{pid?}` | host | some cup is locked (or the named seat's is) |
| `reveal-dice` | host | not revealed and someone has rolled |
| `reveal-roles` | host | not revealed. Clears every card latch |
| `redeal` | host | always. New shuffle, same round, flags reset, **dice untouched** |
| `next-round` | host | always. Round + 1, new shuffle, flags reset, **dice cleared, locks cleared, dice reveal off, `rolls` back to 0** |
| `end` | host | always. `phase = 'ended'`, everything revealed |

`pid: '@host'` messages and `@next` / `@cue-done` / `@auto` are ignored (nothing host-internal is needed).
`legalActions` and `act` share one `allowed` predicate per type, and an action that would change nothing is
never legal (the fuzzer relies on it).

### View (whitelist-built)

```
phase, round, dealId, title '通用派牌', subtitle '第 N 回合'
controller            // this seat is the host
selfRoll, dice {count, sides}, roles [...]            // public
revealRoles, revealDice
seats: [{ id, name, playing, seenRole, rolled, rolls, roleLocked, diceLocked,   // rolls = this round's rolls
          roleId?   // only when revealRoles
          dice?     // only when revealDice and the seat rolled }]
me: { id, playing, role {id,name,emoji,desc}|null, dice|null, rollSeq,
      roleLocked, diceLocked, seenRole, mayRoll } | null
can: { roll, lockDice, lockRole, unlockRole, + host: rollAll, unlockDice, revealDice, revealRoles, redeal, nextRound, end }
all?: { pid: roleId }  // ONLY the host seat, ONLY with modSees (moderator), ONLY before the reveal
log: last 25 [{ n, text }]
hint                   // U1, see §3
```

`roleId` / `dice` keys are **absent**, not `null`, until revealed, so a leak is a missing-key bug a test can see.
Outside `me`, `controller`, `can`, `all`, `hint`, a player's view is deep-equal to the table view (tested every step).

### focus / autoAct / result

- `focus` → `{ pids: [card holders who have not seen their card] }` (seat order), `null` while all have seen,
  after the reveal, and after the end.
- `autoAct` → `{ type: 'seen' }` for such a seat, else `null`.
- `result` → `null` until `end`; then `{ winners: [], summary: '通用派牌：玩咗 N 回合', lines, carry }` (#10):
  1. `呢個係通用派牌：app 唔計輸贏，邊個贏由你哋自己講。`
  2. `最後一回合（第 N 回合）每個人嘅牌同骰，玩緊嗰陣收埋嘅而家全部公開：`
  3. one line per seat in seat order: `阿明：🔪 殺手　🎲 3 5（= 8）` (dice only if rolled, sum for 2+ dice), or
     `阿明：主持（冇牌）` for a moderator;
  4. one line per role held by 2+ seats: `🔪 殺手（2 個）：阿明、阿強` (one-of-a-kind cards are not repeated);
  5. `今回合冇人擲過骰。` when nobody rolled.

## 6. Edge cases → tests (`tests/custom.test.mjs`)

| edge case | test |
|---|---|
| registry meta == game meta | `registry meta matches game meta (G16)` |
| ≤ 6 quick lines; every role 做乜 + 點贏, split as the 💡 sheet does; no rules id clashes with a dealt id | `U1 — quick rules are ≤ 6 short lines…` |
| no 偵探 / 守衛 / Cheese Thief anywhere; a saved v1 cheese setup falls back | `G17 — no invented Cheese Thief presets…` |
| every preset × n × host/moderator valid; reason and mix in the picker; stock text complete | `#8 — every preset is valid for every head-count…` |
| untouched preset follows n; edited kept/repaired; one-of-a-kind deck never padded | `#8 — an untouched preset follows the head-count…` |
| 國王 deck: one king, unique numbers, short summary at 16 | `king preset deals one 國王…` |
| killer 1:1:2; moderator warning only while the host plays | `killer preset is 1 : 1 : 2…` |
| teams even / odd | `teams preset splits the table evenly…` |
| anti-streak: no repeat of a special card, no seat bias, off = repeats, teams not forced | `#20 — anti-streak (off by default)…` |
| anti-streak across games via carry, by name; garbage carry | `#20 — anti-streak carries over…` |
| defaults valid for every n and every preset | `config.defaults is valid for every head-count and every preset` |
| `prev` kept; repaired for a new n / no filler / moderator at n=2 / garbage | `defaults(n, prev) …`, `defaults repairs …` |
| every error and warning in §2, strings from a form | `validate catches every bad setup…`, `validate warns…` |
| role list sanitising (dup ids, 2 fillers, empty names, ZWJ emoji, counts) | `role lists are sanitised` |
| fields / summary (deck label, 改過) | `fields and summary describe the setup` |
| exact deck is dealt; moderator gets no card | `setup deals exactly the configured deck…`, `the moderator holds no card…` |
| werewolf preset composition | `werewolf preset deals 2 wolves…` |
| determinism, shuffle quality, no seat bias | `same seed gives the same deal…`, `every seat is equally likely…` |
| invalid config at setup throws (room validates first) | `setup throws on an invalid config` |
| host identity sources and fallback; a host who moved off seat 0 (G1) | `host identity comes from hostPid…` |
| host-only actions refused for everybody else | `only the host seat can use host actions` |
| seen is public; focus order; autoAct | `peeking is public…`, `autoAct skips…` |
| role latch semantics, owner-only | `role lock latches the card…` |
| redeal vs next-round (round, dice, locks, flags, rollSeq kept) | `redeal reshuffles…`, `next round deals fresh cards…` |
| reveal roles clears latches, final for the round | `reveal roles opens every card…` |
| roll range for every die type, counter counts rolls | `rolls are in range…`, `dice are fair enough` |
| dice lock: keeps roll, blocks roll, host-only unlock (all / one / bogus pid) | `a locked cup keeps its roll…` |
| roll-all lifts locks, hides reveal; selfRoll off | `roll-all rolls every card holder…`, `selfRoll off…` |
| reveal dice freezes the table until the host moves on | `reveal dice shows every roll…` |
| moderator sight only with `modSees`, only before the reveal, only for the host seat | `the moderator sees every role…` |
| end: result lines (why, sums, groups, no-roll line), everything shut | `ending reveals everything…`, `#10 — the result says why…`, `the result names a moderator…` |
| garbage network input, prototype-pollution pids/types, `@host` messages | `garbage from the network never throws…` |
| whitelist views, no internals, log has no values | `views are whitelist-built…` |
| log bounded, ordered, unique | `the log is bounded…` |
| host snapshot round trip | `state survives a JSON round trip…` |
| legalActions never offers a no-op | `legalActions only offers actions that change something…` |
| hint in every phase, ≤ 30 chars, never depends on the cards; 💡 「你嘅角色」 is the seat's own card | `U1 — every view in every phase has a one-line hint…` |
| UI renders every seat + table through random games, idempotent, never shows the hint, host controls only on the host | `custom ui: every seat and the table render…` |
| UI ignores a foreign view (the statusLine crash), defaults a partial one, tolerates odd api | `custom ui: a view that is not ours is ignored…` |
| UI taps → engine-accepted actions (seen on release, latch, roll, lock, per-seat unlock, every host button) | `custom ui: taps send the actions…` |
| per-round roll count: counts every roll (after an unlock too), kept by a lock and a re-deal, 1 after roll-all, 0 next round | `the roster counts this round's rolls…` |
| UI: 🎲 已搖 ×N, the 開盅 status line, the locked-cup badge (no greyed-out buttons), 開盅 under the cup | `custom ui: 已搖 ×N, the 開盅 status line…` |
| the rules name the lock like its button (鎖定點數) | `the rules call the dice lock by the button's name…` |
| long-press a role tag explains it; tap / scroll / jitter handled | `custom ui: U1 — long-pressing a role name…` |
| fuzz n = 2–16 × 100 seeds × presets/dice/moderator/modSees/selfRoll/antiStreak with per-step invariants and leak sweeps | `fuzz — every head-count x 100 seeds…`, `fuzz — long games with many rounds…` |

## 7. 貼心 touches

- **Walk the table.** On a shared phone the app itself calls the next person to look (focus → pass gate).
- **已睇牌 / 等緊 N 個人睇牌.** Nobody has to ask "咁大家睇咗未？".
- **Latch before you hand your phone over.** One tap and even you cannot peek until you unlock.
- **Locks that cannot be cheated.** The host owns the key to a cup.
- **Per-seat 🔓** on the roster, so one friend's stuck cup does not unlock everybody's.
- **開盅 showdown** with real dice faces and sums, so the group reads the result at a glance.
- **Moderator mode with a choice** of seeing everything (殺手遊戲 / 狼人殺) or nothing (a fair neutral dealer).
- **Presets that say why** for this head-count, follow the head-count until you edit them, and remember your edits.
- **國王遊戲 with anti-streak** so the crown moves on.
- **Confirm only what hurts**: reveal, redeal, end, and roll-all over somebody's lock. Next round is one tap.
- **Dice are cleared on a new round** so a stale number from last round can never be mistaken for a roll.
- **No timestamps in the log**, so nothing local-time appears anywhere.

## 8. Framework requests

1. ~~Host identity~~ — done (G1): `Room#begin` passes `hostPid` to `Session` → `engine.setup`; the engine still
   accepts `isHost` and falls back to the first seat.
2. **Stale views on a game switch (shell/core).** On a P2P client the `room` message (phase `playing`, new
   `gameId`) and the `views` message arrive as separate DataChannel messages, and `touch()` renders between them,
   so `play.js` can mount the new game's UI and push it a view the previous session built. This UI now ignores a
   view without `seats`, but other games may not. Suggested fix: the session stamps views with `gameId` (or the
   room's start counter) and `play.js` only pushes a view whose stamp matches `room.gameId`, or the client clears
   `views` / `table` when a `room` message changes `gameId` or enters `playing`.
3. **💡 sheet for a seat without a card** (moderator / spectator): today it lists `rules.roles`, i.e. every
   preset's roles. For this game the useful list is the deck in play — `view.roles` (`{ name, emoji, desc }`).
   Suggest: when the view has no own role but has `view.roles`, list those.
4. **Results hero** says `— 冇人贏` for this game, which reads like a draw. A `result.headline` override
   (e.g. `玩完喇`) would fit tools that do not score.
5. Verified against the code that exists today (no request): `ConfigForm`'s `roles` editor takes
   `[{ id, name, emoji, count, filler, desc }]`, honours `max` and shows `help`; `select` options are
   `{ value, label }` with typed values kept; `RoleCard` forwards `onOpen(open)`; `DiceCup` chimes on `rollSeq`
   and hides its roll button when `canRoll` is false; the shell uses native `confirm` for its own prompts, as this
   UI does for reveal / redeal / end; the shell loads `games/custom/style.css` for `meta.css`; the room hands
   `result().carry` back as `setup({ carry })`.
6. Nice to have: a `desc` input in the `roles` editor (v1 had none; the presets carry the 做乜 / 點贏 text).
7. Nice to have: the room could re-run `config.defaults(n, prev)` on head-count change even when the config was
   edited (`configDirty`), because `defaults` repairs rather than resets (and regenerates untouched preset
   lists); today an edited no-filler list — e.g. a 國王 deck after someone tweaked the dice — shows
   要啱數先開得 until the host fixes it.
