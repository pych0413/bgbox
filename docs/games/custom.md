# 通用派牌 + 骰盅 (`custom`) — play-flow spec

> Batch 1. Port of the whole v1 app (`js/game.js`, `js/roles.js`, `js/app.js`) as an engine +
> UI under the v2 framework. All user-facing text is Hong Kong Cantonese. Times in UTC.
> Code: `js/games/custom/{game,ui,index}.js`, `style.css`. Tests: `tests/custom.test.mjs`.

## 1. At a glance

| | |
|---|---|
| Players | 2–16 seats (the host's seat counts). With a moderator host, 2–16 seats but at least 2 card holders, so 3+ seats. |
| Minutes | open-ended (5–180 listed) |
| Narration | `none`. No cues, no timers, no night. |
| Single device | `full` |
| What the phones do | Deal one private role card per player from a deck the host designs; hold secret dice under a cup; remember who peeked; lock a card or a roll; let the host roll everyone, open all dice, open all roles, start the next round, end the game. |
| What happens at the table | Everything else. The app does not know the game: the group decides what the roles mean, when to call a vote, who won. |

It is the "any deck + any dice" tool: Cheese Thief with house roles, 狼人殺 with a human moderator,
臥底 with paper words, a liar's-dice round, a drinking game.

## 2. Setup

### Config (`cfg`)

| key | Field type | default | notes |
|---|---|---|---|
| `preset` | `select` | `cheese` | `cheese`, `cheeseGang`, `werewolf`, `undercover`, `custom` |
| `roles_<preset>` | `roles` | per preset, fitted to n | one role list **per preset** (see below) |
| `hostPlays` | `bool` | `true` | off = the host is a moderator: no card, no dice |
| `modSees` | `bool` | `false` | only offered when `hostPlays` is off: the moderator also sees every role |
| `diceCount` | `int` 1–5 | `1` | |
| `diceSides` | `select` d4 d6 d8 d10 d12 d20 | `6` | values are numbers; strings from a form are coerced |
| `selfRoll` | `bool` | `true` | off = only the host may roll (own cup or everybody) |

A role is `{ id, name (≤ 16), emoji (≤ 2 characters), count, desc (≤ 60), filler }`. At most one role is the
auto-fill (`filler`): it gets whatever card holders are left. Sanitising (`cleanRoles`) fixes ids (unique
strings), keeps only the first filler, clamps counts, falls back to `角色 N` / `❓`, and never throws.

**Why one list per preset.** The config form is generic and a `select` change cannot rewrite another
field. So every preset keeps its own list under `roles_<presetId>`, `fields()` points the `roles` Field
at the active preset's key, and edits survive switching presets back and forth.

### Presets (ported from v1, counts adapt to n in `defaults`)

| preset | label | roles |
|---|---|---|
| `cheese` | 🧀 Cheese Thief | 🐭 芝士小偷 ×1 · 🔍 偵探 ×1 · 🧑‍🌾 村民 (auto) |
| `cheeseGang` | 🧀 Cheese Thief（雙賊） | 🐭 芝士小偷 ×2 · 🔍 偵探 ×1 · 🛡️ 守衛 ×1 · 🧑‍🌾 村民 (auto) |
| `werewolf` | 🐺 狼人殺（基本） | 🐺 狼人 ×(1 if n<6, 2 if n<10, else 3) · 🔮 預言家 ×1 · 🧪 女巫 ×1 · 🏹 獵人 ×1 · 🧑 平民 (auto) |
| `undercover` | 🕵️ 臥底 | 🕵️ 臥底 ×(2 if n≥9 else 1) · ⬜ 白板 ×(1 if n≥7 else 0) · 🧑 平民 (auto) |
| `custom` | ✏️ 自訂 | 🅰️ 角色 A ×1 · 🧑 平民 (auto) |

If the fixed roles do not fit the number of card holders `k`, `defaults` shrinks counts from the bottom of
the list until they do (a head-count too small for the werewolf preset drops 獵人, then 女巫, …).

### `defaults(n, prev)`

- `defaults(n)` is the `cheese` preset with `hostPlays: true`; valid for **every** n in 2–16 (tested for
  every preset).
- `prev` (last used config) is honoured key by key: preset, dice, `selfRoll`, `hostPlays`, `modSees`, every
  role list. A role list that no longer fits the new head-count is **repaired** (no filler → the biggest
  role becomes the filler; fixed counts shrunk) instead of thrown away. A moderator seat that no longer
  fits (n = 2) flips back to `hostPlays: true`. Garbage `prev` is ignored; the result is always valid.

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
role at all (`冇指定任何特殊角色，所有人都係「村民」。`).

`fields(cfg, n)`: the six/seven Fields above; the `roles` Field gets `max = k` (the + button cap) and
`help = validate().message`, so the v1 green/red total line is the field's help text.
`summary(cfg, n)` (lobby): one line per role with its **actual** count for n (`🐭 芝士小偷 ×1`,
`🧑‍🌾 村民 ×4`), then `🎲 2 × d6`, then `房主一齊玩` or `房主做主持（唔攞牌，睇到所有人角色）`.

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
| my card not yet looked at | 輪到你睇牌 👇 㩒住張牌 |
| others still to look | 等緊 N 個人睇牌 |
| everybody looked | 大家都睇咗牌 ✓ |
| roles revealed | 🔓 角色已經公開 |
| game ended | 🏁 遊戲完咗 |

**Card holder** (host-as-player included):

1. **骰盅** — `DiceCup`: hold to lift the cup, 🎲 搖我嘅骰, 🔓 鎖定點數, shake to roll (the cup's own hints:
   㩒住掀起個盅 · 㩒住睇得，但搖唔到新骰 when locked). The card header adds the reason when rolling is off
   altogether: 已經開盅，要主持再搖 (revealed) · 今次淨係主持幫大家搖 (`selfRoll` off). In both cases the cup hides its roll button.
2. **我嘅角色牌** — `RoleCard` (hold to peek, release to cover): emoji, name, ability text (no team label —
   the roles are the group's own). Hint: 㩒住先睇到，放手即刻冚返 · 已鎖定，㩒下面解鎖 · 大家嘅角色都公開咗.
   Button: 🔓 鎖定角色牌 / 🔒 已鎖 — 㩒一下解鎖 (gone after the reveal, nothing left to hide).
3. **開盅 🎲** (only after the host opened the dice) — everyone's dice as real faces, with `= sum` for 2+ dice.
4. **場上玩家** — roster in seat order. Tags: 主持 · 已睇牌 / 未睇牌 · 🎲 已搖 · 🔒骰 · 🔒牌, and after the
   reveal `🐭 芝士小偷`. Never a number a die shows, never a role before the reveal.
5. **主持控制** (host seat only, see below).
6. **🃏 本局牌組** (fold): every role with its count and ability text — public, it is in the lobby summary anyway.
7. **📜 記錄** (fold): newest first, last 25 lines, no timestamps (so no timezone to get wrong).

**Moderator** (host who does not play): no cup, no card. A note instead:
`你係主持 🎙️ 今次你唔攞牌、唔擲骰，由你控制場面。` — or, with `modSees`, `…你睇到所有人嘅角色（下面）。`
In the roster every holder carries a teal tag `👁 🔍 偵探` that nobody else sees. After the reveal it turns
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

### Anti-tell handling

This game has no night, so the tells are about the *table*:

- The public roster carries only neutral flags: `seenRole`, `rolled`, `roleLocked`, `diceLocked`. No value,
  no role, no count of pips, before the host opens them. `me.dice` is only ever the viewer's own.
- `seen` fires on release, so how long you looked is not broadcast; the flag is binary and is public on purpose
  (it is how the group knows everybody has seen their card).
- A locked card and a locked cup look the same for every role.
- The public log says *that* someone rolled or locked, never what.
- The moderator is **blind by default**, so a host-moderator cannot be accused of peeking. `modSees` is an
  explicit, visible choice (the lobby summary says so) for games where the moderator must know.
- Reveals are host-only and confirmed; nobody can open another seat's card or cup.

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
selfRoll, modSees
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
the `hostPid` argument, a `players[i].isHost` flag, the first seat in seat order. See §8.

### Actions (`act(state, { pid, action }, ctx)`; anything invalid returns `state` unchanged, never throws)

| type | by | valid when |
|---|---|---|
| `seen` | seat | holds a card, has not seen it, roles not revealed |
| `lock-role` `{on: bool}` | seat | holds a card, roles not revealed, `on` is a boolean that differs from the current latch |
| `roll` | seat | holds a cup, cup not locked, dice not revealed, and (`selfRoll` or host) |
| `lock-dice` | seat | has rolled, cup not locked, dice not revealed |
| `roll-all` | host | there is a card holder. Rolls every holder (lifts their locks), hides revealed dice |
| `unlock-dice` `{pid?}` | host | some cup is locked (or the named seat's is) |
| `reveal-dice` | host | not revealed and someone has rolled |
| `reveal-roles` | host | not revealed. Clears every card latch |
| `redeal` | host | always. New shuffle, same round, flags reset, **dice untouched** |
| `next-round` | host | always. Round + 1, new shuffle, flags reset, **dice cleared, locks cleared, dice reveal off** |
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
seats: [{ id, name, playing, seenRole, rolled, roleLocked, diceLocked,
          roleId?   // only when revealRoles
          dice?     // only when revealDice and the seat rolled }]
me: { id, playing, role {id,name,emoji,desc}|null, dice|null, rollSeq,
      roleLocked, diceLocked, seenRole, mayRoll } | null
can: { roll, lockDice, lockRole, unlockRole, + host: rollAll, unlockDice, revealDice, revealRoles, redeal, nextRound, end }
all?: { pid: roleId }  // ONLY the host seat, ONLY with modSees (moderator), ONLY before the reveal
log: last 25 [{ n, text }]
```

`roleId` / `dice` keys are **absent**, not `null`, until revealed, so a leak is a missing-key bug a test can see.
Outside `me`, `controller`, `can`, `all`, a player's view is deep-equal to the table view (tested every step).

### focus / autoAct / result

- `focus` → `{ pids: [card holders who have not seen their card] }` (seat order), `null` while all have seen,
  after the reveal, and after the end.
- `autoAct` → `{ type: 'seen' }` for such a seat, else `null`.
- `result` → `null` until `end`; then `{ winners: [], summary: '通用派牌：玩咗 N 回合', lines }`.
  `lines[0]` is the explanation: `呢個玩法冇輸贏。下面係最後一回合嘅牌同骰：`; then one line per seat in seat order:
  `阿明：🐭 芝士小偷　🎲 3 5` (dice only if rolled), or `阿明：主持（冇牌）` for a moderator.

## 6. Edge cases → tests (`tests/custom.test.mjs`)

| edge case | test |
|---|---|
| defaults valid for every n and every preset | `config.defaults is valid for every head-count and every preset` |
| `prev` kept; repaired for a new n / no filler / moderator at n=2 / garbage | `defaults(n, prev) …`, `defaults repairs …` |
| every error and warning in §2, strings from a form | `validate catches every bad setup…`, `validate warns…` |
| role list sanitising (dup ids, 2 fillers, empty names, ZWJ emoji, counts) | `role lists are sanitised` |
| fields / summary | `fields and summary describe the setup` |
| exact deck is dealt; moderator gets no card | `setup deals exactly the configured deck…`, `the moderator holds no card…` |
| werewolf preset composition | `werewolf preset deals 2 wolves…` |
| determinism, shuffle quality, no seat bias | `same seed gives the same deal…`, `every seat is equally likely…` |
| invalid config at setup throws (room validates first) | `setup throws on an invalid config` |
| host identity sources and fallback | `host identity comes from hostPid…` |
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
| end: result lines, everything shut | `ending reveals everything…`, `the result names a moderator…` |
| garbage network input, prototype-pollution pids/types, `@host` messages | `garbage from the network never throws…` |
| whitelist views, no internals, log has no values | `views are whitelist-built…` |
| log bounded, ordered, unique | `the log is bounded…` |
| host snapshot round trip | `state survives a JSON round trip…` |
| legalActions never offers a no-op | `legalActions only offers actions that change something…` |
| fuzz n = 2–16 × 100 seeds × presets/dice/moderator/modSees/selfRoll with per-step invariants and leak sweeps | `fuzz — every head-count x 100 seeds…`, `fuzz — long games with many rounds…` |

## 7. 貼心 touches

- **Walk the table.** On a shared phone the app itself calls the next person to look (focus → pass gate).
- **已睇牌 / 等緊 N 個人睇牌.** Nobody has to ask "咁大家睇咗未？".
- **Latch before you hand your phone over.** One tap and even you cannot peek until you unlock.
- **Locks that cannot be cheated.** The host owns the key to a cup.
- **Per-seat 🔓** on the roster, so one friend's stuck cup does not unlock everybody's.
- **開盅 showdown** with real dice faces and sums, so the group reads the result at a glance.
- **Moderator mode with a choice** of seeing everything (狼人殺) or nothing (a fair neutral dealer).
- **Each preset remembers your edits**; the next evening starts from last time's setup (`prev`).
- **Confirm only what hurts**: reveal, redeal, end, and roll-all over somebody's lock. Next round is one tap.
- **Dice are cleared on a new round** so a stale number from last round can never be mistaken for a roll.
- **No timestamps in the log**, so nothing local-time appears anywhere.

## 8. Framework requests

1. **Host identity (needed, one line).** `engine.setup` must be told which seat is the host: host-only actions
   (roll-all, reveal, unlock, next round, end) and the moderator seat depend on it. The engine accepts, in order,
   a `hostPid` argument, an `isHost: true` flag on the entry in `players`, else falls back to the first seat in
   seat order. `Room#begin()` currently builds `players` as `{ id, name, seat, color }`; adding
   `isHost: p.id === this.hostPid` there (or `hostPid` in `Session#ctx()`) is enough. Without it the fallback is
   wrong whenever the host moved their seat in the lobby: the player in seat 0 would get the host controls and the
   real host would get none. Tests use p1 as host.
2. Verified against the code that exists today (so no request, recorded as an assumption): `ConfigForm`'s
   `roles` editor takes `[{ id, name, emoji, count, filler, desc }]`, honours `max` and shows `help`; `select`
   options are `{ value, label }` with typed values kept; `RoleCard` forwards `onOpen(open)`; `DiceCup` chimes on
   `rollSeq` and hides its roll button when `canRoll` is false; the shell uses native `confirm` for its own
   prompts, as this UI does for reveal / redeal / end; the shell loads `games/custom/style.css` for `meta.css`.
3. Nice to have: a `desc` input in the `roles` editor (v1 had none, the presets carry the ability text).
4. Nice to have: the room could re-run `config.defaults(n, prev)` on head-count change even when the config was
   edited (`configDirty`), because `defaults` repairs rather than resets; today an edited no-filler role list simply
   shows 要啱數先開得 until the host fixes it.
