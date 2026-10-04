# Board Game Box — design

> Status: framework design (v2 rewrite). Per-game flows live in `docs/games/<id>.md`.
> All times in this repo are UTC.

## 0. What we are building

A static web app (GitHub Pages, no backend, no build step) that turns a group of iPhones
into the components of a party board game. One phone hosts; the others join a room by
tapping four dice. The host picks a game; the app deals, runs nights, collects secret
actions and votes, keeps time, narrates aloud in Cantonese if asked, and keeps score
across the whole evening.

The group is a handful of Cantonese-speaking friends, all on iPhone, often travelling
(Japan), often with no cards, sometimes with weak data, sometimes with one phone dead.

### Games (v1)

| id | 名 | players | what the app replaces |
|---|---|---|---|
| `cheese-thief` | 芝士大盜 | per rules doc | dice + cups, role cards, night count, peeks |
| `onuw` | 一夜終極狼人 | 3–10 | role + centre cards, night actions, timer, vote |
| `werewolf` | 狼人殺 | 6–12 | the moderator, night actions, votes |
| `avalon` | 阿瓦隆 | 5–10 | role reveal, team votes, quest cards, tokens |
| `undercover` | 誰是臥底 | 4–12 | word slips, speaking order, votes |
| `spyfall` | 間諜 | 3–8 | location cards, timer, accusations |
| `fake-artist` | 假畫家 | per rules doc | word cards, the shared paper (optional), votes, score |
| `draw-guess` | 你畫我猜 | 3–12 | word cards, the drawing (optional), timer, score |
| `9upper` | 瞎掰王 9upper | 3–9 | fact cards, role cards, score |
| `custom` | 通用派牌 + 骰盅 | 2–16 | any role deck + secret dice (today's app) |

## 1. Principles

1. **The host phone is the referee.** Every rule is decided by a pure engine running on
   the host. Other phones render a *view* and send *actions*. Nothing else.
2. **A phone only ever receives what its player may know.** Views are built per player
   by the engine; there is no shared state object that clients filter. Leaks are tested.
3. **Engines are pure.** No DOM, network, `Math.random()` or `Date.now()` inside an
   engine — `rng` and `now` are injected. Every engine runs headless under Node and is
   fuzzed to completion in tests.
4. **The room outlives the game.** Players join once per evening. Switching game,
   replaying, seat order, colours and the scoreboard all live on the room.
5. **One dead phone must not stop the table.** A device can hold several seats; a whole
   game can run on one device. Stalled players can be auto-acted by the host.
6. **iPhone first.** No vibration (Safari has none), sound and animation carry feedback,
   every gesture-gated API (speech, audio, motion) is primed from a real tap. **No native dialogs**
   (`confirm`, `alert`, `prompt`): on the host phone they stop the room's server (guests see 冇送到 after 4 s and
   同房主斷咗 after 12 s). A risky tap asks twice in the page instead (`sh.confirm` / `api.confirm`, §15.8).
7. **Nothing repeats.** Content is drawn without replacement and remembered across
   evenings on the host device.

## 2. Layers

```
ui/shell.js          screens & routing: home · picker · create · join · lobby · play · results
ui/components/*.js   Cover · DiceCup · RoleCard · PlayerPicker · VotePanel · Timer
                     · Canvas · RulesSheet · NarratorBar · PassGate · Scoreboard · SeatEditor
games/<id>/ui.js     mount(root, api) → { update(view), destroy() }
───────────────────────────── view ↓   ↑ action ─────────────────────────────
core/room.js         (host) players · seats · devices · scores · current session · snapshot
core/session.js      (host) runs one engine: act/advance/timers/cues/views/auto-act
games/<id>/engine.js pure rules
core/transport.js    HostTransport / ClientTransport (PeerJS); local play has no transport at all
core/narrator.js     speechSynthesis (zh-HK first) + read-aloud mode
core/bag.js          draw-without-replacement over content banks, persisted
```

`js/net.js`, `js/shake.js`, `js/sfx.js`, `js/util.js` from v1 move under `core/` and
are kept; their hard-won fixes are listed in `docs/research/codebase-map.md` and must
survive the move.

## 3. Game module contract

Each game is a folder `js/games/<id>/` whose `index.js` default-exports:

```js
export default {
  meta: {
    id, name, emoji, accent,             // accent: CSS colour for this game's chrome
    players: [min, max], minutes: [lo, hi],
    narration: 'required' | 'recommended' | 'optional' | 'none',
    narrationDefault?: 'voice' | 'read' | 'silent',  // mode while this game is selected (typed / quiet games);
                                         // absent = the host's own last choice
    turnOrder?: boolean,                 // seat order IS the turn order → lobby hint 「座位次序＝輪流次序…」;
                                         // absent = js/ui/logic.js TURN_ORDER_GAMES decides (15.11)
    paperMode: false,                    // true if a physical paper/pen variant exists
    singleDevice: 'full' | 'partial' | 'none',
    banks?: [bankId], css?: boolean,     // §15.2
    blurb: '一句介紹',
  },
  rules: {
    quick: ['30 秒學識，一行一句'],          // shown on the picker and in-game
    roles: [{ id, name, emoji, team, text }],
    sections: [{ title, body }],          // full reference, plain text
  },
  config: {
    defaults(n, prev, env) → cfg,         // recommended setup for n players (prev = last used)
    validate(cfg, n, env) → { ok, message, warnings: [] },
    fields(cfg, n, { bag }) → Field[],    // shell renders the setup form from this
    summary(cfg, n) → string[],           // lobby lines, e.g. ['2 狼人', '預言家', '女巫']
    presets?(n, env) → [{ id, label, reason, cfg }],   // optional one-tap chips above the form
  },
  engine,                                 // §4
  ui,                                     // §6
}
```

`Field` = `{ key, label, type: 'int'|'bool'|'select'|'roles'|'categories'|'seconds', help?, min?, max?, options? }`.
A `roles` field renders the role-count editor from v1 (with the auto-fill role);
`categories` renders bank category + difficulty filters with "已用 37 / 1,243".

`env` = `{ singleDevice: boolean }` — true when **one device holds every seated player** (local play, or a
host phone that all seats share; the room's `singleDevice`, §5). It is the **optional** last argument of
`defaults`, `validate` and `presets`: a game that ignores it needs no change, and a game that wants
pass-the-phone defaults (e.g. no typed guessing on one shared phone) reads it. `defaults` is re-run with
`prev = config` whenever someone joins or leaves (head-count or device set changes) and the host has not edited
the config yet (a second phone joining flips `singleDevice`); `validate` and `presets` run on every room view.

`presets(n, env)` entries need a `label` and an object `cfg` (others are dropped). The lobby shows them to the
host as 「快速揀」 chips (`reason` as small print); a tap sets `{ ...config, ...preset.cfg }`; the chip whose
`cfg` keys all equal the current config is shown selected (`logic.presetMatches`).

## 4. Engine contract

```js
engine.setup({ players, config, rng, now, bag, hostPid, carry? }) → state
engine.act(state, { pid, action }, ctx) → state      // ctx = { rng, now, bag }; ctx.now is a number (host ms)
engine.advance(state, ctx) → state                   // called when state.deadline passes
engine.view(state, pid) → object                     // pid = null → table/spectator view
engine.cue(state) → { id, text, minMs } | null       // narration for the current step
engine.focus(state) → null | { pids: [...], anonymous?: string }
engine.autoAct(state, pid, ctx) → action | null      // what to do for a stalled player
engine.result(state) → null | { winners, summary, lines, points?, void?, spectators?, carry? }
// optional (15.2): blocking · hostActions · canInk · canVoid;  required: legalActions
engine.blocking?(state, pid) → boolean               // is the game waiting on this seat?
engine.hostActions?(state) → [{ label, action }]     // extra host-menu buttons, dispatched as '@host'
engine.canInk?(state, pid) → boolean                 // drawing games, §11
engine.canVoid?(state) → { ok: true } | { ok: false, message }   // would '@void-round' do anything now? (why not)
```

- `players` is `[{ id, name, seat, color }]` in seat order.
- `hostPid` = the seat on the host's phone (`null` if that seat is not playing) — for moderator modes.
  `carry` = the previous game of the **same kind** on this host's `result().carry` (anti-streak memory);
  absent for the first game, never sent to any phone.
- `act` must validate: wrong phase, wrong player, illegal target → return `state`
  unchanged. Never throw on bad input from the network.
- **Host-internal actions** use `pid: '@host'`. A seat can never send a type starting with `@` (the room
  refuses it), so an engine may trust `pid === '@host'` for these:
  `{ type: '@cue-done', id }` (narration for cue `id` finished),
  `{ type: '@next' }` (host pressed 下一步 in read-aloud mode or skipped a step),
  `{ type: '@auto', pid }` (host chose to auto-act a stalled player — session calls
  `autoAct` and feeds the result back as that pid; the engine never sees `@auto` itself),
  `{ type: '@void-round' }` (`ACT.VOID_ROUND` — host chose 呢輪作廢: a phone died or the round got mixed up).
  `@void-round` is **optional**: the engine discards the current round and starts it again (or ends the game
  with `result.void`); an engine that does not support it returns the state unchanged, so
  `app.hostCtl.voidRound()` returns `false` and the UI toasts 「呢個遊戲唔支援呢輪作廢」. It is also refused
  while the game is paused. An engine may say **why not** with `engine.canVoid(state)` → `{ ok: false, message }`
  (「呢輪已經計咗分，㩒「下一輪」就得」): the host's 呢輪作廢 then toasts that message at once, without arming.
- **Absent seats (decision D4).** `{ type: '@absent', pid }` (`ACT.ABSENT`; games may use the literal) — the host
  marked this seat absent (a friend left the table, a phone lies dead or forgotten). The seat stops being waited on
  **for the rest of the current game**: votes, unanimity and majorities count present seats only, ready checks
  and 睇完 counts skip it, turn order passes it by, and a step it alone was holding up moves on (the engine's
  own rule, e.g. 間諜: a spy who is absent voids the round). `{ type: '@present', pid }` (`ACT.PRESENT`) brings it
  back; it is optional even for an engine that takes `@absent`. Both arrive with `pid === '@host'`, like
  `@void-round`, and are **optional**: an engine without them returns the state unchanged → `false`, the seat is
  not marked, and the shell toasts 「而家標記唔到 阿明 缺席 — 可以代佢做或者呢鋪唔計」 (an engine may also refuse for
  its own reason, e.g. too few seats left). Absent seats are **public**: the room view's `absent: [pid]`
  goes to every phone, and views may show 💤 next to the name. The core keeps the list (`session.absent`, in the
  snapshot), clears it with the game, and stall detection never flags an absent seat (`session.blocking` is false
  for it). An engine should also keep absent seats out of `focus` and `blocking`.
- `hostActions(state)` — the game's own host-only buttons (e.g. 你畫我猜 「＋30 秒」 / 「呢題作廢」). The session
  sanitises the list (≤ 6 entries; `label` non-empty, trimmed to 24 chars; `action` a plain object with a string
  `type`). Only the **host device** is told, as `[{ i, label }]` (the actions themselves never leave the host);
  the ⋯ menu shows them as 「🎛️ label」. A tap calls `app.hostCtl.hostAction(i, label)`: the room re-reads the
  current list, refuses (`false`) if `i` is gone or `label` no longer matches (a list that changed under the
  finger), else dispatches `action` as `pid: '@host'`. Name these types `@…` and check `pid === '@host'` in
  `act` — a type without `@` could also be sent by a seat as its own action.
- `blocking(state, pid)` — true while the game is really **waiting on that seat** (not merely "has a legal
  action": night decoys give every seat one). Stall detection asks, in order: `engine.blocking` → does
  `focus().pids` name the seat (when `focus` returns an object with `pids`) → `legalActions` non-empty.
- Timers: an engine sets `state.deadline` (host ms) and optionally `state.timerLabel`.
  The session schedules `advance` at the deadline. Pausing is generic: the session
  freezes and later shifts `state.deadline`; engines never see pause.
- `view(state, pid)` must be a **whitelist** construction — build a fresh object, never
  spread `state`. Include `deadline` when a timer is running.
- `cue` ids must be unique per step (`'night:3:seer:open'`), so the narrator speaks a
  line exactly once and `@cue-done` cannot be mistaken for an older line.
- `focus` names the seats that must look at or touch their phone *privately right now*.
  It drives the "輪到你" badge and, on a shared device, the pass gate (§7).
  `anonymous` replaces names with a role prompt for eyes-closed steps
  (`'預言家請拎起部手機'`), so a shared phone never announces who holds a role.
  The engine always returns the whole focus; **the room filters it per device** (`room.filterFocus`):
  a device only learns about its own seats. During an `anonymous` step every device with a **playing** seat
  gets `{ pids: [<its own called seats>], anonymous }` — `pids: []` when the called role sits on another
  phone or in the centre — so a shared phone cannot tell where the role is. A named (non-anonymous) focus goes
  only to the devices it names; a spectator-only device gets `null`. An engine must therefore keep an
  anonymous step in `focus` even when its role is dead or in the centre (the narrator still calls it).
  A **named** focus that calls more than one seat reaches each named device with `together: true` (a deal, a
  vote: everybody's at once, so no 「輪到你」 pill, §15.11); never on an anonymous step. An engine may also set
  `simultaneous: true` itself. Separately, the **host device** gets `waiting` (bool, `views`): does the engine's
  whole focus name any seat (or an anonymous step) right now — its ⏭ 跳過呢步 then takes two taps.
- `result(state)` is polled after every state change while playing; it returns `null` until the game is over,
  and the first non-null value ends the game (room → `results`, session stopped). Fields:
  `winners: [pid]`, `summary` (one line), `lines` (the 「點解會咁」 recap, see 15.2 *Result fields*),
  `points?: { pid: n }`, and the optional `void`, `spectators`, `carry`.

### Pacing and anti-tell (night games)

- Every step that exists in the rules exists every time, even if its role is dead or in
  the centre. The narrator still calls it, and it lasts its full time.
- **Steps never end early because the actor finished.** A fixed duration per step, or
  narration end + fixed padding. Silence length must not reveal whether anyone acted.
- **Every seat gets something to tap during every night step.** Non-actors get a decoy
  of the same shape and size (e.g. 「㩒一張牌確認你未瞓著」). Tap noise and finger
  movement are then uninformative.
- Non-host phones mute SFX and dim to a black "閉眼" screen between their own actions (語音 / 讀稿).
  In **靜音** eyes stay open, so a lit phone among dark ones would show who is awake: there every seat's phone
  gets the **same readable ~70 % dim all night**, the awake one included, with the same overlay words (decision D1,
  §7 Night dim). Engines keep the awake seat's screen the same shape and brightness as a sleeper's.

## 5. Session & room (host)

`Room` holds: code (`null` in local play), host pid, `players[] {id, name, token, seat, color, deviceId,
connected, spectator, kicked, keep, offlineSince}`, `devices{}`, `gameId`, `config`, the current `Session`,
`scoreboard {pid: {played, wins, points}}`, `history[]`, `lastResult`, `narration {mode}` (voice and rate are
per device, §9) plus the host's own mode preference, `carries {gameId: result.carry}` (host only, kept in the
snapshot, never sent), the table `timer`, pending seat `claims`.

Room phases: `lobby` → `playing` → `results` → (`playing` again | `lobby`).

The **room view** (`room` message, §15.3) is built field by field from this. New in the framework pass:
`singleDevice` — `true` when **one device holds every seated player** (local play always; a hosted room while
all seated players sit on the host's device). It is recomputed from the seating on every room view and is what
games receive as `env.singleDevice` in `config.defaults / validate / presets` (§3). Also in the view:
`loading` (the picked game's module is still loading), `timer` (the table timer, below), host-only
`stalled` / `idle` / `claims` / `versionMismatch`, and per player `offlineSince`, `keep`, `dropAt` (when an offline
lobby seat will be dropped). `absent` — the seats the host marked absent this game (D4, §4; public, `[]` outside a
game). Host-only `idle` — connected seats the table has waited on for stallMs (#9, below).

- **Lobby.** Host picks a game (everyone sees it change), edits config (everyone sees the
  summary), arranges seats to match the real table, starts. Players may pick their colour.
  The picker greys out games that don't fit the current head-count and says why.
- **Results.** Winners, an explanation of *why* (e.g. "強盜搶咗狼人張牌，所以阿明而家
  係狼人"), points, the running scoreboard. Buttons: 再玩一局 · 換遊戲.
  `result.void === true` (呢鋪唔計) scores **nothing**: no `played` / `wins` / `points` change, `lastResult.void`
  is set, the history line is marked `void` (shown 「🚫 唔計」), and the results hero says 呢鋪唔計 instead of a
  winner. `result.spectators: [pid]` names seats that did not play (a human moderator): they get no
  `played` / `wins` / `points` for that game. `result.carry` is stored per game id for the next game of the
  same kind (`engine.setup({ carry })`) and is never part of `lastResult`.
- **Late join.** Lobby: normal. Mid-game: spectator (table view) until the next game.
- **Disconnect.** The seat is kept. If the engine is *blocked on that seat* (`engine.blocking`, §4) for longer
  than `stallMs` (config, default 45 s; the clock restarts whenever the game state changes), the host sees
  「⚠️ 阿明 斷咗線，成個遊戲等緊佢 — 代佢做 · 💤 當佢缺席 · 呢鋪唔計 · 再等」. Auto-act uses `engine.autoAct` (abstain,
  pass, random legal choice); 💤 當佢缺席 sends `@absent` (§4, two taps); 呢鋪唔計 sends `@void-round`.
- **Connected but silent (#9).** iOS keeps the link of a phone put down or taken to the bathroom, so it shows
  🟢. Such a seat goes on a second host-only list, `idle: [{ pid, since }]`, after stallMs with no state change —
  but only while **the rest of the table waits for it** (some present seat is not blocked) and no game clock
  (`state.deadline`) will end the step by itself; a step everybody is in at once (a discussion, a vote nobody has
  cast) is never pinned on one seat, and neither is a **secret step** (`focus.anonymous`, e.g. the Assassin's pick):
  there the host device learns only *that* the table waits (`waiting`), never on whom — only a dead phone is named,
  because nothing else would unfreeze the table. It gets **no banner** — a long table talk before a pick or the assassination
  looks exactly the same — only the ⋯ menu's 「斷咗線 / 無反應」 rows (🤖 代佢做 · 💤 當佢缺席), and a ⏭ that the
  engine ignores names it (「跳唔到呢步 — 等緊 阿明…」). Absent seats are on neither list.
- **Lobby ghosts.** A remote seat that goes offline in the lobby is dropped `LOBBY_GRACE_MS` (180 s — a phone that
  auto-locked for a minute or two keeps its seat and its place) later unless
  the host keeps it (`keepSeat`, banner 「保留個位」). Mid-game seats are always kept.
- **Lost token.** A phone that lost its token can `claim` an offline seat; the host approves
  (`state.room.claims`) and the old token dies.
- **Table timer.** A host-clock countdown that lives on the room in every phase (`room.timer`): the host starts
  1 s – 3 h, every phone shows it from the same `endsAt`; 暫停 holds it, 繼續 releases it; a timer that rang
  clears itself after 60 s.
- **Liveness.** iOS suspends a locked or backgrounded page and its DataChannel dies, often without a `close`. So a
  seated client pings every 4 s (`hb: 1`) and treats 12 s with nothing at all from the host as a dead channel: it
  closes it and re-dials (the seat tokens re-seat it; it never goes back to the join screen). Back in the
  foreground (visibilitychange / pageshow / online) it pings at once and re-dials if there is no reply in 3 s. The
  host closes a heartbeat phone that has been silent 15 s while the host page is visible (same path as a close);
  time the host page itself spent hidden never counts (fresh windows on return, and `room.hostBack(ms)` stops the
  lobby-grace clock for that time), and it rejoins the signalling server at once under the same code. Transient
  PeerJS errors never end a client's retries — only a host `reject` or leaving does. `app.connLog()` keeps the last
  40 connection events (UTC, no tokens) for ⚙️ 連線記錄.
- **Host refresh.** Snapshot of the room + session to localStorage on every change,
  restored under the same room code (v1 behaviour, kept).
- Every room/session change → per-device messages (§8).

## 6. Game UI contract

```js
ui.mount(root, api) → { update(view), destroy() }
```

`api`:
`send(action)` (→ the `app.act` promise, 15.3) · `ink(payload)` · `me` (the seat pid being shown; `null` while
this phone only watches — then the UI is mounted with the table view) · `players` · `isHost` ·
`components` (§10) · `sfx(name)` · `toast(text)` · `now()` (host-synced clock) ·
`config` · `meta`. Exact shape and `update(view, ctx)` in 15.8.

UIs are **render-from-view**: `update(view)` may be called with the same view twice and
must be idempotent. Local, uncommitted UI state (a half-picked target) lives in the UI.
The UI is mounted once per (game, seat): switching seat on a shared phone destroys it and mounts a fresh one.

Besides the game's own fields, the shell reads a few **optional, conventional view fields** (`night`,
`title`, `subtitle`, `hint`, `roleId`, `hintRoleLabel`, `hintRoleText`, `canDraw`) — listed in 15.2.

## 7. Devices, seats and single-device play

A **device** holds one or more **seats**. The common case is one seat per phone.
Two people can share a phone (someone's battery died); one phone can hold every seat
(no data at all — local mode: the Room runs in-process, no transport, no PeerJS).

- On a device with several seats the header shows the current seat; switching goes
  through a **PassGate** — a full-screen 「交俾 阿明 ・ 其他人唔好望」 card the receiver
  taps to open. Private covers (hold-to-peek) still apply behind it.
- When `focus` names seats on this device, the device walks through them in seat order,
  gating each one. With `anonymous`, the gate shows the role prompt instead of a name.
  The gate only moves on when `focus` gets **smaller**: an engine with several seats awake in one step must
  drop a seat from `focus` once it is done (cheese-thief: a `{ type: 'done' }` action, sent by the UI only when
  another awake seat shares the phone), or the second and third awake seats on a shared phone never get it.
- **Anonymous (eyes-closed) steps gate the same way whoever holds the role.** The room sends
  `{ pids: [], anonymous }` to every device with a playing seat (§4), and `play.js` opens the role-prompt gate
  (subtitle 「其他人閉埋眼，唔好望」) on **every shared phone (2+ seats) once per step** — also when the called
  role sits on another phone or is in the centre. If one of this device's seats is called, the gate hands the
  phone to that seat when tapped; otherwise it is a **decoy**: tapping it changes nothing. A shared phone
  therefore never shows whether a role is here, elsewhere or absent. While the step is anonymous the seat chip
  reads 「🤫 而家係秘密步驟」 and the seat switcher lists 「座位 N」 without names or 輪到 badges.
- **Night dim** (`logic.nightChrome`, `js/ui/night.js`). `view.night` makes the phone dim and silent:
  - **語音 / 讀稿** (eyes closed): near-black (95 %) between that seat's own steps, lifted while `focus` names it;
    the overlay says 「閉 眼 · 🌙 可以將螢幕調暗啲」.
  - **靜音** (decision D1; eyes stay open, so brightness would be a tell): **one readable ~70 % dim on every
    single-seat phone all night** — the awake / focus seat gets **no lift**, nothing fades at a window's edges, and
    the overlay words are the same on every phone (「夜 晚 · 🌙 可以將螢幕調暗啲」, never 閉眼). SFX are muted on
    every phone alike.
  - On a device holding **2+ seats** focus still drives the pass gate: a seat that is not called is covered by
    an **opaque** layer that swallows taps (the screen underneath belongs to whoever held the phone last); the
    called seat sees its screen (in 靜音 under the same soft dim). On a single-seat phone every level stays
    tappable, so decoy buttons keep working (§4 anti-tell).
- Votes and other simultaneous secret actions become sequential on a shared device;
  engines already accept actions in any order, so nothing changes for them.
- `meta.singleDevice` tells the picker how well a game works on one phone, and the
  per-game doc explains how (e.g. "夜晚部手機放枱中間，被叫到嘅角色拎起"). `room.singleDevice` (§5) is the live
  fact games read in `config.*` to choose pass-the-phone defaults.
- **Seat order hint.** For games where seat order is the turn order (`meta.turnOrder: true`, or listed in
  `logic.TURN_ORDER_GAMES` when the game does not say), the lobby shows everyone the emphasised hint
  「座位次序＝輪流次序，開局前用換位排好」 under the seat list.

## 8. Protocol (v2)

All messages are JSON over the PeerJS DataChannel; the host's own device (and local play) gets the same
messages in-process, with no wire. Every message has a string `t`.

Client → host

| t | payload | notes |
|---|---|---|
| `hello` | `{ v: 2, build, deviceId, seats: [{ name, token? }] }` | one device may register several seats |
| `claim` | `{ v: 2, build, deviceId, pid }` | lost token: ask for an offline seat back; the host approves |
| `act` | `{ pid, action, rev, id? }` | `pid` must belong to the sender's device; `id` → `ack` |
| `ink` | `{ pid, stroke, pts, end?, color?, width?, eraser? } \| { pid, op }` | canvas stream, see §11 |
| `lobby` | `{ op: 'color' \| 'leave' \| 'addSeat', ... }` | colour pick, leave seat, add a seat on this device |
| `sync` | `{}` | send me everything again (page came back to the foreground; throttled to 1/s) |
| `ping` | `{ c, hb? }` | clock sync + heartbeat (every 4 s; `hb: 1` lets the host close it after 15 s of silence — older hosts ignore it) |
| `bye` | `{}` | leaving on purpose |

Host → client

| t | payload |
|---|---|
| `welcome` | `{ v, build, device, seats: [{ id, token, name }], room, views }` — re-sent when this device's seat list changes |
| `room` | room view (15.3): players, seats, colours, game, config summary, phase, scores, narration, `singleDevice`, timer, `absent` … — `stalled`, `idle`, `claims`, `versionMismatch` carry data for the host device only |
| `views` | `{ rev, hostNow, bySeat: { pid: view }, table: view, focus, canInk }` — only this device's playing seats; `focus` is filtered to them (§4); `canInk` = those of them `engine.canInk` allows to draw now. **Host device only:** `cue` (`{ id, text }`), `hostActions` (`[{ i, label }]`, §4), `waiting` (bool, §4) |
| `ack` | `{ id, ok }` — after the views the action produced; `ok` = it changed the game (false = refused) |
| `claimWait` | `{ pid, name }` — the claim waits for the host's approval |
| `notice` | `{ text }` — non-fatal message for the toast |
| `ink` / `inkSync` | relayed strokes / full drawing on (re)join or new turn |
| `pong` | `{ c, hostNow }` |
| `reject` | `{ reason, claimable? }` — fatal; `claimable = { pid, name }` when the name belongs to an offline seat |
| `chunk` | `{ id, i, n, data }` — transport only: any message over ~20,000 chars is split and reassembled before the Room or app sees it |

Views are sent whole (they are small); `rev` lets a client drop stale ones. Canvas ink is
the only stream kept outside views. A spectator-only device gets `table` and no `bySeat` entries.

## 9. Narrator

- `speechSynthesis`, voice preference zh-HK (iOS "Sinji / 善怡") → zh-TW → zh-CN → ja →
  en; rate 0.7–1.3 slider; volume; 試聽 button.
- Modes (host only, per room): **語音** (phone speaks) · **讀稿** (big text + 下一步 for a
  human narrator) · **靜音** (on-screen prompts only; steps advance on timers).
- Cue lifecycle: `cue.id` changes → speak → `onend` **or** a length-based timeout
  (iOS `onend` is unreliable) → wait `minMs` → `@cue-done`.
- The first `speak()` is primed inside the tap on 開始遊戲 (iOS gesture rule).
- Night ambience (optional, synthesised, quiet) under the narration.
- Scripts are written per game in Cantonese, in `games/<id>/script.js`, never copied from
  official apps.

## 10. Shared components

| component | from v1? | purpose |
|---|---|---|
| `Cover` | yes | hold-to-peek, release to cover, optional lock (role: blocks peek; dice: blocks roll) |
| `DiceCup` | yes | secret dice under an upside-down cup, shake-to-roll |
| `RoleCard` | new | Cover + emoji + name + team colour + ability text |
| `PlayerPicker` | new | pick k of n seats in seat order, with exclusions; shows colours |
| `VotePanel` | new | secret vote → "已投 4/6" → simultaneous reveal with tallies |
| `Timer` | new | big countdown, sounds at 60 s/10 s/0, host pause/+60 s |
| `Canvas` | new | §11 |
| `RulesSheet` | new | 30-second rules + role glossary, openable any time from the top bar |
| `NarratorBar` | new | host: current line, replay, skip, pause, mode switch |
| `PassGate` | new | §7 |
| `SeatEditor` | new | lobby: drag/tap to reorder seats to match the real table |
| `Scoreboard` | new | evening totals, per-game history |

## 11. Shared canvas (draw-guess, fake-artist)

- Fixed aspect ratio, coordinates normalised to 0–1000 integers, so every phone shows
  the same picture. `devicePixelRatio`-aware backing store.
- `touch-action: none`, no callout/magnifier/selection on the canvas, pointer events
  with coalesced points when available, quadratic smoothing on render.
- Only seats the engine allows (`engine.canInk`) may ink; the host validates the sender. Each device is told
  which of its own seats may draw now (`views.canInk` → `app.state.canInk`), and a drawing game's views also
  carry `canDraw` for their own seat (what the UI passes to `Canvas`).
- Strokes stream in ~50 ms batches (`ink`), host relays to everyone and appends to
  the session's drawing (`session.drawing`); `inkSync` re-sends the whole drawing on reconnect.
- The engine bumps `state.inkEpoch` to start a new picture; the session clears ink.
- **Keepsake.** When the epoch moves on mid-game, each client keeps the old picture in `app.state.pictures`
  (≤ 24); the results screen shows them all plus the last one, view-only, with 「💾 儲存圖片」 (§15.3, 15.11).
- Fake artist: one stroke per turn, a too-short stroke (accidental tap) is discarded and
  the player may try again. Draw & guess: colours, widths, eraser, undo, clear.

## 12. Content banks

`js/data/*.js` export plain arrays. `core/bag.js` draws without replacement:

- key per entry (word, or `a|b` for pairs); used keys persisted per bank on the host
  device; when the filtered pool is exhausted it resets and says so.
- Category and difficulty filters from config; custom entries per bank stored locally
  and mixed in.

## 13. Delivery

- No build. Static and dynamic imports carry `?v=<stamp>`; `tools/bump-version.sh`
  rewrites every stamp under `js/**` and `index.html` (now recursive).
- Service worker: network-first for `index.html`, cache-first for stamped assets,
  precache the shell, all game modules and data, so the app opens with no signal.
  Multi-phone play still needs internet for PeerJS signalling; one-phone play does not.
- `manifest.webmanifest` + PNG `apple-touch-icon` for Add to Home Screen.

## 14. Testing

- `node tests/run.mjs` (no dependencies): per-engine unit tests with a seeded RNG, plus
  a fuzzer that plays random legal actions to completion for every player count and
  asserts: terminates, `result` is well-formed, and **no view for seat A contains seat
  B's private fields** (engine-specific leak checks).
- `tests/lib.mjs` mirrors the core contracts: `Sim(game, { n, seed, config, hostPid = 'p1', carry, singleDevice })`
  calls `setup` and `config.defaults(n, undefined, { singleDevice })` exactly as the Room does; `makeBag` has
  `draw`, `release` and `stats` like `core/bag.js`. `tests/core.test.mjs` covers session / room / app (focus
  filtering, `result.void` / `spectators` / `carry`, `hostActions`, `@void-round`, `canVoid`, `@absent` /
  `@present`, idle stalls, keepsake, `resumeInfo`). `tests/ui-logic.test.mjs` runs the shared components and the
  play screen under a fake DOM (two-tap confirms, the 靜音 night chrome being identical on every seat, 💤).
- Browser: two-tab and single-device runs per game before each release.

## 15. Implementation contracts (binding — parallel agents build against these)

### 15.1 Files

```
index.html                    <div id="app"></div>, loads css/base.css?v= and js/main.js?v= (module)
css/base.css                  all shared styles (tokens + layout from v1 styles.css, all components)
js/main.js                    boots: const app = createApp({ narrator, storage }); startShell(app, root, { narrator });
                              storage = a `as:<name>:`-prefixed localStorage view when the URL has ?as=<name>, else undefined
js/core/engine-kit.js         EXISTS — pure helpers (rng, shuffle, tally, seats, clone, ACT/HOST)
js/core/util.js               v1 js/util.js moved (storage makeStore / lsGet, room code, ids, wake lock; no DOM helpers — js/ui/dom.js)
js/core/net.js                v1 js/net.js moved (PeerJS HostNet/ClientNet, unchanged behaviour)
js/core/sfx.js, shake.js      v1 moved
js/core/bag.js                content bag (15.5)
js/core/session.js            runs one engine (15.4)
js/core/room.js               host room: seats, devices, lobby, scores, snapshot, messages (§5, §8)
js/core/transport.js          HostTransport (P2P over HostNet) + ClientTransport (over ClientNet)
js/core/client.js             createApp() — the ONLY object the UI talks to (15.3)
js/core/narrator.js           createNarrator() (15.6) — browser only
js/ui/shell.js                startShell(app, root, { narrator }): router, shared services (sh.*), night dim, status layer
js/ui/screens/<name>.js       home (+ one-phone setup, connecting) · join · lobby · play · results — mountX(sh) → { el, update(state), destroy() }
js/ui/logic.js                pure UI rules, Node-testable: fits, teamStyle, rankRows, result sections, presets, roleFor … (15.11)
js/ui/hints.js                the 💡 sheet (15.11)
js/ui/ink.js                  Canvas maths (smoothing, outbox, ids) + paintStrokes, shared with the keepsake PNG
js/ui/{timer,status,settings,preflight,sheet,dom}.js   table timer UI, notice layer, ⚙️, pre-flight check, bottom sheet, DOM helpers
js/ui/night.js                the night overlay (dark · soft · opaque), driven by logic.nightChrome (§7)
js/ui/components/<Name>.js    one file per component (15.7)
js/games/registry.js          export const GAMES = [{ id, meta, load: () => import('./<id>/index.js?v=N') }]
js/games/<id>/game.js         PURE: export const meta, rules, config, engine — Node-importable, imports only engine-kit and js/data
js/games/<id>/ui.js           export function mount(root, api) → { update(view, ctx), destroy() }
js/games/<id>/index.js        import * as g from './game.js?v=N'; import { mount } from './ui.js?v=N';
                              export default { ...g, ui: { mount } }
js/games/<id>/style.css       optional; loaded by the shell when meta.css === true
js/data/*.js                  content banks (default-exported arrays)
tests/lib.mjs, tests/run.mjs  EXIST — harness (Sim, makeBag, test, leak helpers)
tests/<id>.test.mjs           per game; tests/core.test.mjs for session/room
docs/games/<id>.md            the play-flow spec for each game (template in 15.9)
```

Every relative import and every `href`/`src` to our own files carries `?v=N`
(any integer is fine while developing; `tools/bump-version.sh` restamps all of them).

### 15.2 Engine contract additions (to §4)

- `meta.banks?: string[]` — content banks the session must load before `setup`.
- `meta.css?: boolean` — shell loads `games/<id>/style.css`.
- `meta.narrationDefault?: 'voice' | 'read' | 'silent'` — narration mode while this game is selected (a
  typed / quiet game should not default to voice). Any other game, or none given, uses the host's own last
  choice; a mode the host picks explicitly becomes that choice (kept across a host refresh).
- `meta.turnOrder?: boolean` — seat order is the turn order → lobby seat-order hint (§7). Absent = fall back
  to `logic.TURN_ORDER_GAMES` (`undercover, spyfall, 9upper, avalon, werewolf, fake-artist, draw-guess`).
- `engine.legalActions(state, pid) → action[]` **required** — every action this seat may
  send now (empty if none). Used by the fuzzer and by the default `autoAct`. For free-form
  input (typed guesses, typed words) return one representative valid example.
- `engine.canInk?(state, pid) → bool` — drawing games only. Evaluated on every view build: each device's
  `views` message carries `canInk: [pid]` for its own playing seats the engine lets draw now (the session
  answers false while paused or after the game), → `app.state.canInk`; the shell folds the narrator bar for
  those seats.
- `engine.blocking?(state, pid) → bool`, `engine.hostActions?(state) → [{ label, action }]`,
  `engine.canVoid?(state) → { ok, message? }` and the `@void-round`, `@absent` / `@present` host actions — semantics
  in §4. All optional.
- `config.defaults(n, prev, env)` must return a config valid for every n in `meta.players`; `env` is optional
  (§3). `config.validate(cfg, n, env)` and `config.presets?(n, env)` take the same optional `env`;
  `config.fields(cfg, n, { bag })` gets the content bag for 「已用 / 總數」 counts.
- `engine.setup` also receives `hostPid` (the host phone's playing seat, else `null`) and, from the second game
  of the same kind on, `carry` (the previous `result().carry`).
- The session **clones state before every engine call**, so engines may mutate the state
  they receive and must return it. Returning `undefined` means "unchanged".
- State is plain JSON (no Map/Set/Date/functions) — it is snapshotted and cloned.
- Views carry `phase` and, when a timer runs, `deadline` (host ms). Optional, conventional view fields the
  shell reads (everything else in a view is the game's own; always whitelist, never spread state):

| view field | read by | meaning |
|---|---|---|
| `night: true` | play screen | dims the screen and mutes SFX (§7): 語音 / 讀稿 — near-black for this seat unless `focus` names it; 靜音 — the same readable ~70 % dim on every seat all night, the awake one included (D1); opaque for an uncalled seat on a device holding 2+ seats |
| `title`, `subtitle` | top bar | |
| `hint` (string or `{ text }`) | 💡 sheet | one line 「而家要做咩」 for a first-timer, for every phase |
| `roleId` | 💡 sheet | the seat's **own** role id, matched against `rules.roles` — never anybody else's; omit it (undercover) when the role is secret even from its holder, and the sheet lists every role instead |
| `hintRoleLabel` | 💡 sheet | relabels the 「你嘅角色」 heading (≤ 20 chars), e.g. 「你派到嘅角色」 where cards change hands |
| `hintRoleText` | 💡 sheet | the seat's own role text **for this table** (≤ 400 chars), preferred over the generic `rules.roles` text: a string written 「做乜：… 點贏：…」 or `{ what, win }` — e.g. 狼人殺 prints only the win rule this table plays (屠邊 / 屠城) and the side's own goal. Only in that seat's own view (it is as secret as the role); ignored when no own role is found |
| `canDraw` | game UI, play screen | this seat may ink now (the UI passes it to `Canvas`); the play screen prefers `state.canInk` and falls back to `view.canDraw` / `view.draw.canDraw` to fold the narrator bar. (`canInk` itself is **not** a view field: it travels beside the views, `views.canInk` → `state.canInk`, computed from `engine.canInk`) |
| `recent` | play screen (`RecentFold`, under the game UI) | **public** "what just happened" folds, so a result that flashed for a few seconds can be found again (#10): one fold or an array (max 4) of `{ id?, title, lines?, entries?: [{ title?, lines }], open? }`; a line is a string, `{ text }`, or a ballot `{ from: pid, to: pid \| null }` (shown 「阿明 → 小美」, null = 棄權). E.g. `[{ id: 'votes', title: '📜 之前嘅投票', entries: [{ title: '第 2 日', lines: [{ from, to }, …] }, …] }, { id: 'night', title: '🌅 昨晚', lines: ['2號阿明 出局'] }]`. Newest entry first; empty folds are dropped; a fold starts **closed** unless `open: true` and keeps its open/closed state across updates. Must be identical in every seat's view (and the table view) — never a secret. A game that wants the fold somewhere else in its own layout renders `api.components.RecentFold` itself from another field instead |

  Fallbacks the 💡 sheet also tries for the own role, in order: `role`, `mine.role`, `my.role`, `me.role`,
  `my.dealt` (an id string, or `{ id, name, emoji, team, text }` for custom decks); `mine.follower === true`
  picks the role id `follower` (芝士大盜 共犯).

**Result fields** (`engine.result`, §4):

| field | effect |
|---|---|
| `winners: [pid]`, `summary`, `points?: { pid: n }` | scoreboard (`played`, `wins`, `points`), `lastResult`, history line |
| `lines` | the 「點解會咁」 recap: strings; or `{ text }`. A **section heading** is `{ h: '標題' }` or a string `'── 標題 ──'` (dashes trimmed); lines under it form a foldable section. Lines before the first heading are an untitled section that is always shown; an empty heading is dropped. A recap of **more than 8 lines starts folded except its first section**; a short one starts fully open |
| `void: true` | 呢鋪唔計: no scoreboard change at all (not even `played`), `winners`/`points` ignored, `lastResult.void` and the history line marked `void`; results hero says 呢鋪唔計, no points card |
| `spectators: [pid]` | seats that did not play (a human moderator): no `played` / `wins` / `points` for them |
| `noScore: true` | a tool that does not judge (通用派牌): results headline 「邊個贏由你哋講」 (never 冇人贏), the history line reads 唔計輸贏, no medals; `lastResult.noScore` and the history entry carry it |
| `linesTitle` | the recap card's heading (≤ 24 chars) where 「點解會咁」 does not fit, e.g. 「分數點嚟」 for a scoring game; `lastResult.linesTitle` |
| `carry` | any JSON; kept per game id on the host (snapshot included) and handed to the next `setup({ carry })` of that game — anti-streak memory. Never sent to a phone, never in `lastResult` |

### 15.3 `createApp(opts)` → `app`  (js/core/client.js)

`createApp(opts)` — every option is optional: `narrator`, `storage` (Web-Storage-like, or a `Map`; `js/main.js`
passes a `as:<name>:`-prefixed view of localStorage for a `?as=<name>` tab, which makes that tab its own device
and identity), and injection points for tests (`now`, `rng`, `registry`, `makeHostNet`, `makeClientNet`,
`timers`, `saveEveryMs`, `banks`, `build`).

Events: `app.on('change', fn(state))` fires after any change to `app.state`; `app.on('notice', fn(text, info?))`
fires for non-fatal messages (a bag reshuffle carries `info = { kind: 'bag-reshuffle', bankId }`, a failed
snapshot write `{ kind: 'save-failed' }`); `app.off`.

```js
app.state = {
  mode: null | 'host' | 'client' | 'local',
  conn: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline' | 'error', connMessage: '',
  code: '1352' | null, isHost: false, deviceId: '',         // code is null in local mode
  mySeats: ['p_x', ...], activeSeat: 'p_x' | null,
  room: {
    phase: 'lobby' | 'playing' | 'results',
    players: [{ id, name, seat, color, connected, deviceId, isHost, spectator,
                offlineSince, keep, dropAt }],             // seat order, spectators last
    gameId: 'spyfall' | null, config: {}, configSummary: [''], configValid: { ok, message, warnings },
    singleDevice: false,             // one device holds every seated player (= env.singleDevice for config.*);
                                     // absent until the first room message — read it as false
    loading: null | 'spyfall',       // lobby: the picked game's module / banks are still loading
    scoreboard: { [pid]: { played, wins, points } }, history: [{ gameId, winners, summary, void? }],
    narration: { mode: 'voice' | 'read' | 'silent' }, paused: false,
    timer: null | { id, label, totalMs, endsAt, remainingMs, paused, done },   // table timer, host clock (§5)
    stalled: [{ pid, since }],                         // host only: seats the session is waiting on, phone away
    idle: [{ pid, since }],                            // host only: the same, phone connected but silent (#9)
    absent: [pid],                                     // D4: seats marked absent this game (public)
    claims: [{ pid, name, deviceId, at }],             // host only: phones asking for an offline seat back
    versionMismatch: [{ pid, build }],                 // host only: seats on a phone with another build stamp
    lastResult: null | { gameId, winners, summary, lines, points, void?, noScore?, linesTitle? },   // void: 呢鋪唔計
  },
  views: { [pid]: view },          // only this device's playing seats
  table: view | null,              // engine.view(state, null)
  focus: null | { pids: [], anonymous: '', together: true },   // filtered to this device (§4): an anonymous
                                               // step is { pids: [], anonymous } on every device with a playing
                                               // seat; `together` = a named step calls more than one seat
  canInk: ['p_x'],                 // this device's seats engine.canInk lets draw right now (§15.2)
  cue: null | { id, text },        // host only: the current narration line
  hostActions: [{ i, label }],     // host device only: the game's own buttons right now (engine.hostActions, §4)
  waiting: false,                  // host device only: the engine's whole focus names a seat / an anonymous step (§4)
  ink: { epoch: 0, strokes: [] },  // drawing games: the current picture
  pictures: [{ epoch, strokes }],  // earlier pictures of THIS game, oldest first, max 24 (older ones fall off).
                                   // A picture is kept when the ink epoch moves on mid-game; the list is cleared
                                   // when a new game starts and when the room is back in the lobby
  narration: { mode, status: 'idle' | 'speaking' | 'stalled', line, cueId, reason },   // host/local: what the
                                   // narrator is doing; 'stalled' (+ reason) drives the big-text fallback in NarratorBar
  outbox: 0,                       // client: actions still waiting for the host's ack
  resyncedAt: 0, build: '', versionMismatch: false, versionInfo: null,
  savedGroup: null | { v, savedAt, names, colours, order },   // seating saved at the last start on this phone
  claimable: null | { code, pid, name },                      // the last join was refused: that seat is ours but offline
  claim: null | { code, pid, name, status: 'sending' | 'waiting' },
  saveFailed: false,               // host: the snapshot could not be written (storage full)
  rev: 0,
};

// entry points (all async-safe; errors land in state.conn/connMessage and are also thrown)
await app.host({ names })          // create a P2P room; first name = host's own seat
await app.join(code, { names })    // join a room with one or more seats on this device
app.local({ names })               // whole game on this device, no network
await app.resume()                 // host snapshot or client token from localStorage; false if none, null if cancelled
app.resumeInfo() → { mode, code, savedAt, gameId, phase } | null
                                   // what resume() would come back to, WITHOUT doing it: mode 'host'|'client'|'local',
                                   // code null for local, gameId/phase of the saved room (phase may be null).
                                   // null = nothing saved, older than 8 h, its snapshot / seat tokens gone, or already in a room.
                                   // Reads THIS app's own store, so a `?as=<name>` tab sees its own identity (G20)
app.forgetResume() → bool          // 「唔要」: drop the breadcrumb and a host's snapshot with it (a client keeps its
                                   // seat tokens: the same code + name later still gets the seat back); false while in a room
await app.claimSeat(code, pid)     // lost token: ask the host for an offline seat back → { ok, status: 'waiting' | 'approved' }
app.resync()                       // page back in the foreground: re-learn the clock, ask the host for everything again
app.leave()
app.prefs.get(key, fallback = null)   // small per-IDENTITY preferences (e.g. 'ct:name', the name draft) in the same
app.prefs.set(key, value)             // store as everything else — a `?as=` tab keeps its own. Device-wide settings
                                      // (mute, voice, text size, pre-flight skip) stay in plain localStorage on purpose
app.keepsake() → [{ epoch, strokes }]   // the game's pictures for the results screen: state.pictures, then the
                                        // current ink if non-empty (not in the lobby); deep copies, safe to keep

// lobby — host only unless noted
app.lobby.selectGame(id)           // loads the game module + banks, applies config.defaults(n, lastUsed, { singleDevice })
app.lobby.setConfig(cfg)
app.lobby.moveSeat(pid, index)
app.lobby.setColor(pid, color)     // host, or the seat's own device
app.lobby.addSeat(name)            // any device: add a seat on THIS device (shared phone)
app.lobby.removeSeat(pid)
app.lobby.kick(pid)
app.lobby.keepSeat(pid, keep = true)    // keep an offline lobby seat past the 180 s grace
app.lobby.applySavedOrder()             // seat order + colours of the last start on this phone (state.savedGroup)
app.lobby.approveClaim(pid); app.lobby.rejectClaim(pid)   // state.room.claims
app.lobby.start() → { ok, message, warnings? }   // warnings name seats that are offline (the game starts anyway)

// play
app.act(pid, action) → Promise<boolean>   // pid must be one of state.mySeats. true = the host applied it (its
                                          // views already arrived); false = the host refused it; rejects
                                          // (err.code 'offline' | 'timeout' after 4 s) when it never got there
app.ink(pid, payload)
app.setActiveSeat(pid)

// results — host only
app.results.again()
app.results.toLobby()

// host controls — all return booleans, false when not the host (or not playing)
app.hostCtl.pause(); app.hostCtl.resume(); app.hostCtl.next(); app.hostCtl.autoAct(pid)
app.hostCtl.voidRound()            // dispatches '@void-round' (§4): true iff the engine changed state; false if it
                                   // does not support it, the game is paused, or it is not playing — the UI toasts
                                   // engine.canVoid's message, else 「呢個遊戲唔支援呢輪作廢」
app.hostCtl.canVoid() → { ok, message } | null   // engine.canVoid (null: the game does not say); read-only
app.hostCtl.markAbsent(pid) / markPresent(pid)   // D4 '@absent' / '@present' (§4): true iff the engine changed state;
                                   // false: the game cannot, already so, paused, not playing. state.room.absent = [pid]
app.hostCtl.hostAction(i, label)   // one of state.hostActions: pass its `i` and `label`; false if stale (§4)
app.hostCtl.timer.start(ms, label?) / .pause() / .resume() / .add(ms) / .stop()   // the table timer (§5)
app.narration.setMode('voice' | 'read' | 'silent')
app.narration.replay(); app.narration.skip()   // 重講 / 跳過 the current line (the stalled-line panel)
app.clock.now()                    // host-synced ms
app.game(id) → Promise<loaded game module>   // cached; the shell uses it for rules/ui
app.games                          // the registry (picker cards need no module); app.narrator; app.build; app.canNetwork()
app.connLog() → ['<UTC ISO> text']  // last 40 connection events (status, re-dials and why, visibility, wake lock, timeouts); no tokens
app.bag.stats(bankId, filter?) → { used, total } | null   // null on a client or before the bank is loaded
app.bag.reset(bankId) → bool                              // false on a client
```

Host and local modes run `Room` + `Session` in-process and deliver this device's payload
directly; client mode receives the same payloads over `ClientTransport`. Narration runs
only where the session runs (host/local): when `cue.id` changes and mode is `voice`,
`narrator.speak(text)` then `session.cueDone(id)`; in `read` mode the shell shows the
text and a 下一步 button that calls `app.hostCtl.next()`; in `silent` mode the session
auto-completes cues after `cue.minMs`. Voice mode has a watchdog: speech that has not started within 1.5 s, hits
the length timeout, or comes out at volume 0 sets `state.narration.status = 'stalled'` (+ `reason`), and the
NarratorBar shows the line big with 重講 / 跳過 / 下一步; the cue still completes on its `minMs` timer, so the
table never freezes.

`app.act` never throws synchronously and its rejection is never "unhandled" (fire-and-forget is fine). Every
entry point that can start narration (`host`, `local`, `lobby.start`, `results.again`, `hostCtl.resume`,
`narration.setMode / replay`) calls `narrator.prime()` as its first statement (iOS gesture rule). An async entry
point (`host`, `join`, `claimSeat`, `resume`) that is cancelled by `leave()` while it awaits the network closes
what it made and touches nothing (`host()` / `resume()` then resolve `null`; `join` / `claimSeat` reject).

### 15.4 `Session` (js/core/session.js) — host side

```js
new Session({ game, players, config, hostPid?, carry?, rng, bag, now: () => ms, onChange, onCue(cue, { replay }),
              onInk(batch | null), timers?, narrationMode? })
session.begin()                 // schedule the deadline, announce the first cue, emit (not for restored sessions)
session.dispatch(pid, action) → bool   // clones, engine.act, schedules deadline, emits; true iff the state changed.
                                // Refused (false) while paused or stopped; an engine that throws is logged and ignored
session.cueDone(id)             // dispatch(HOST, { type: ACT.CUE_DONE, id })
session.next()                  // dispatch(HOST, { type: ACT.NEXT })
session.autoAct(pid)            // engine.autoAct ?? legalActions[0], then dispatch as pid ('@auto' is routed here)
session.pause() / resume()      // freezes timers; shifts state.deadline on resume, which replays the current cue
session.stop() / poke()         // stop = game over; poke = re-check the deadline now (page back in the foreground)
session.setNarrationMode(mode)  // only 'silent' makes the session complete cues by itself
session.view(pid) / session.table() / session.focus() / session.cue() / session.result()   // fresh JSON copies
session.legal(pid) → action[]   // engine.legalActions
session.blocking(pid) → bool    // engine.blocking → focus.pids → legalActions (§4); always false for an absent seat
session.setAbsent(pid, away) → bool   // dispatch(HOST, { type: '@absent' | '@present', pid }); session.absent (seat order,
                                // snapshotted) changes only when the engine changed state. isAbsent(pid)
session.canVoid() → { ok, message } | null   // engine.canVoid, sanitised (message ≤ 60 chars); null if none / threw
session.hostActions() → [{ label, action }]   // engine.hostActions, sanitised (≤ 6, label ≤ 24 chars, plain-object actions)
session.canInk(pid) → bool      // engine.canInk; false when the engine has none, while paused, and after stop()
session.deadline() → ms | null
session.ink(pid, payload) → bool   // validates engine.canInk; appends to session.drawing; returns accepted
session.drawing = { epoch, strokes }   // reset (and onInk(null) = "resync everyone") when state.inkEpoch changes
session.snapshot() / Session.restore(snap, deps)   // a restored session starts PAUSED; the host taps 繼續
```

`ctx.now` handed to engines is a number (host ms at the call), not a function. `HOST` = `'@host'` and `ACT`
(`CUE_DONE`, `NEXT`, `AUTO`, `VOID_ROUND`, `ABSENT`, `PRESENT`) come from `js/core/engine-kit.js`.

### 15.5 Bag (js/core/bag.js)

```js
createBag({ storage, rng?, banks?, onNotice? }) → bag
await bag.load(bankId)            // dynamic import of js/data/<file>.js?v=N (idempotent); bag.isLoaded(bankId)
bag.draw(bankId, filter?) → entry | null      // without replacement, persisted per bank; a copy
bag.release(bankId, key) → bool               // put an offered-but-unused entry back (below)
bag.stats(bankId, filter?) → { used, total }
bag.reset(bankId)
bag.custom(bankId) / bag.addCustom(bankId, entry) / bag.removeCustom(bankId, key)
bag.label(bankId) → display name;  bag.takeNotices() → queued 「題目用晒，已經重新洗牌」 messages
```
`onNotice(text, { kind: 'bag-reshuffle', bankId })` fires when a filtered pool is exhausted and reshuffled;
`createApp` re-emits it as the `notice` event.

**`bag.release(bankId, key)`** — gives one drawn entry back by its key (§12 keys: `w` for `draw`, `term` for
`9upper` …) so it can come up again. For entries that were *offered* but not used: 你畫我猜 offers three words
and keeps one, so the engine calls `ctx.bag?.release?.('draw', w)` for the other offers and for the word of a
voided turn (optional-chained: a bag without `release` still works). Returns `true` iff the key was marked used
(then persisted); a non-string key, a key not marked used (e.g. already forgotten by an exhaustion reshuffle)
or a bank that was never drawn from returns `false` and changes nothing; an unknown bank id throws. The test
bag (`tests/lib.mjs` `makeBag`) has the same method.

Bank ids → files and keys: `undercover` → undercover-words.js, key `[a,b].sort().join('|')`;
`spyfall` → spyfall-locations.js, key `name`; `draw` → draw-words.js (flattened to
`{ w, alt, level, cat }`), key `w`; `9upper` → 9upper-terms.js, key `term`.
Storage key `bgb:bag:<bankId>` = array of used keys. Engines receive `bag` in `ctx` and
must draw during `setup`/`act`/`advance` only (never in `view`).

### 15.6 Narrator (js/core/narrator.js)

```js
createNarrator() → {
  prime(),                         // call inside a real tap (iOS) — speaks an empty utterance
  voices() → [{ voiceURI, name, lang }], pickDefault() → voiceURI (zh-HK > zh-TW > zh-CN > ja > en)
  set({ voiceURI, rate, volume }),
  speak(text) → Promise<void>,     // resolves on end OR after a length-based timeout (iOS onend is unreliable)
  cancel(),
  hasCantonese() → bool,           // false → the shell suggests installing 粵語 voice in iOS settings
}
```

### 15.7 Components (js/ui/components/<Name>.js)

Each exports a factory `Name(props) → { el, update(props), destroy() }`; `update` takes the
full props again. All styles live in css/base.css under `.c-<name>`.

| component | props |
|---|---|
| `Cover` | `{ front: Node, backArt: string, backLabel, lockMode: 'none' \| 'peek', locked, onOpen(open) }` — hold to peek; with lockMode 'peek' and locked, a press is refused with a shake. While closed the front is `aria-hidden` and every die face in it loses its 「N 點」 label (#37); both come back only while held open |
| `RoleCard` | `{ role: { emoji, name, team, text } \| null, locked, onLockToggle, hint, lockLabels?, ariaLabel? }` — Cover + 🔒 button underneath. For a card that is not a role (誰是臥底's word): `lockLabels: { lock, locked, message }` rewords the 🔓 button, its locked face and the refusal toast; `ariaLabel` the cover's label; `hint: ''` hides the hint line |
| `DiceCup` | `{ dice: [n] \| null, sides, rollSeq, canRoll, lockedRoll, onRoll, onLock, shakeToRoll: true }` — cup art, hold to peek, roll button, lock-roll button, shake detector |
| `PlayerPicker` | `{ players, me, count: 1, exclude: [pid], selected: [pid], disabled, onChange(sel), confirmLabel, onConfirm(sel) }` |
| `VotePanel` | `{ players, candidates: [pid], me, myVote, allowAbstain, progress: { done, total }, reveal: null \| { counts, top, votes? }, onVote(pid \| null), allowChange?, title?, colorOf?, secretChoice? }` — the progress line (「已投 2/5」 + pips) is updated **in place**; rows and 確定 are rebuilt only when candidates, `myVote`, the local pick, the options or the reveal change, so a ballot arriving mid-press never swallows a tap (#15). `colorOf(pid)` → the dot colour (假畫家's pen colours), falling back to `player.color`. `secretChoice` (default **off**; hidden-role games turn it on — decision D6 of 2026-10-04, summary item D14): the button reads 「確定投票」 and the voted state 「已投 ✓」, with no name and no row lit |
| `Timer` | `{ deadline, now: () => ms, label, paused, warnAt: [60, 10] }` — plays sfx at warnings/zero |
| `RulesSheet` | `RulesSheet.open(game)` / `.close()` — modal from `game.rules` |
| `NarratorBar` | `{ cue, mode, onReplay, onNext, onMode, paused?, onPause?, onSkip?, stalled?, line?, reason?, compact?, hidden?, confirmNext? }` — `stalled` (+ `line`, `reason`) = the phone was asked to speak and nothing came out: big text, 🔁 重講, ⏭ 跳過 (`onSkip`), 下一步. `compact` (the play screen sets it while this phone's seat can draw — `state.canInk` / `view.canDraw`) folds the bar to one line (icon, line, 下一步) with a ▴ to open it for this turn. The host's skip is a small **ghost** 「⏭ 跳過呢步」 (#13); only the 讀稿 narrator with a line to read (or a stalled line) gets the big primary 「下一步 ⏭」. `confirmNext` (string) = skipping now would cut somebody off: the first tap arms the button 「再㩒一次：…」, only a second tap within ~3 s calls `onNext`. 下一步 ignores a second tap within 1.5 s of a real one |
| `PassGate` | `PassGate.show({ title, subtitle, button? }) → Promise<void>` (resolves when the receiver taps, or when `hide()` / another `show()` replaces it) · `PassGate.hide()` · `PassGate.isOpen()` |
| `SeatEditor` | `{ players, me, isHost, onMove(pid, index), onColor(pid, color), onKick(pid), mySeats?, palette?, orderHint? }` — `mySeats` = every seat on THIS device (default `[me]`); `orderHint` (string) replaces the host-only default hint and shows it emphasised to everyone (turn-order games, §7). Reorder: host only (▲ ▼ or drag the ⠿ handle); colour: host or the seat's own device; ✕: host on others' seats, any device on its own extra seats — `onKick` is called either way and the lobby picks kick vs removeSeat |
| `Scoreboard` | `{ players, scoreboard, history, games?, me?, showHistory? }` — `history` = `[{ gameId, winners, summary, void?, noScore? }]` oldest first (a `void` row reads 「🚫 唔計」, a `noScore` row 「唔計輸贏」); `games` = `{ gameId: meta }` for emoji + name; `me` highlights your row. Sorted by points, then wins, then fewer games played, then seat; ties share a rank. Columns 局 · 贏 · 分數; **分數 is left out on a night where no game awarded points** (decision D13), and a medal 🥇🥈🥉 goes only to a row that won something (points above 0, or wins on a night without points) — everyone else shows `·` (`logic.scoreboardMode`) |
| `RecentFold` | `{ recent, players, colorOf? }` — the public 「📜 之前嘅投票」 / 「🌅 昨晚」 folds (`view.recent` shape, §15.2): one `<details>` per fold, closed by default, open state kept across updates; ballots with seat dots. The play screen renders `view.recent` with it automatically |
| `ConfigForm` | `{ fields, value, onChange(cfg), bag?, onBagChange? }` — renders §3 Field[] (int, bool, select, seconds, roles, categories) |
| `Canvas` | `{ ink, canDraw, tools: 'none' \| 'full', color, width, oneStroke, minStrokeLen, me?, rearm?, touchGuard?, colorOf(pid), onInk(payload), onStrokeEnd({ strokeId, length }), onShort() }` — see 15.10 |

Helpers in `js/ui/dom.js`: `el(tag, attrs, ...kids)`, `$`, `$$`, `toast(text)`, `dieFace(value, sides)` (a face
carries `role="img"` + `aria-label="N 點"`; `labelDice(root, on)` adds / strips them — `Cover` does it), and the
**arm-then-confirm** (#3) every risky tap uses instead of a native dialog: `confirmTap(text, { node, key, inline,
ms, onDisarm }) → bool` — the first call arms (`node` reads 「再㩒一次：<first line of text>」 for ~3 s, class
`armed`; `inline: false` keeps an icon's face and toasts instead) and returns false; the same key tapped again
on the same button after 0.35 s and within ~3 s returns true. `isArmed(key, node?)`, `disarmConfirm()`.

### 15.8 Game UI `api` (passed to `mount`)

```js
api = {
  me,                 // pid whose view is being rendered; null while this phone only watches (spectator seat or
                      // no seat) — the UI then gets the table view and send() just toasts 「旁觀緊，做唔到嘢」
  players,            // room players, seat order (live getter)
  isHost, meta, config,   // isHost and config are live getters too
  send(action),       // app.act(me, action) → Promise<boolean>; a failure to reach the host is toasted by the shell
  ink(payload),       // app.ink(me, payload)
  now(),              // app.clock.now()
  sfx(name), toast(text),
  confirm(text, node?, opts?),   // arm-then-confirm (dom.js confirmTap): `if (!api.confirm('開晒所有角色？', btn)) return;`
                      // — false on the first tap (btn reads 「再㩒一次：…」), true on the second. NEVER window.confirm:
                      // it freezes the host phone, which is the room's server (the shell turns any window.confirm
                      // into this as a safety net, on the button just tapped)
  components,         // { Cover, RoleCard, DiceCup, PlayerPicker, VotePanel, Timer, Canvas, RecentFold, dieFace }
}
```
`update(view, ctx)` — `ctx = { focus, paused, narrationMode, ink }` (`focus` already filtered to this device, §4).
The UI is mounted once per (game, seat) and destroyed on a seat switch, so `api.me` never changes under it.

### 15.10 Shared drawing (binding for Canvas, fake-artist, draw-guess)

Wire format (already implemented in `js/core/session.js` `normalizeInk` / `applyInkBatch`):

- A game UI sends strokes with `api.ink(payload)`:
  `{ stroke: '<id>', pts: [[x, y], ...], end?: true, color?, width?, eraser? }` — x, y are
  integers 0–1000 on a **square** canvas (uniform scale on every phone); ≤ 400 points per
  batch; style keys only on the first batch of a stroke. Or `{ op: 'undo' }` (removes this
  seat's last stroke) / `{ op: 'clear' }`.
- Stroke ids are `` `${me}-${salt}.${n}` ``: `me` = the Canvas `me` prop (whitespace stripped, last 20 chars;
  `c` when the prop is absent), `salt` = up to 3 random base-36 characters drawn once per Canvas instance,
  `n` = that instance's stroke counter. Unique per device even across remounts; an id longer than 40 chars
  is rejected.
- Every phone receives the drawing as `ctx.ink = { epoch, strokes: [{ id, pid, pts, end, color?, width?, eraser? }] }`
  in `update(view, ctx)`; strokes with `end: false` are still being drawn (render progressively).
- The engine decides who may draw with `engine.canInk(state, pid)` and starts a fresh picture by
  bumping `state.inkEpoch`. Ink never enters engine state, so an engine that needs to know a
  stroke happened (fake artist turn order) receives a normal action from the UI
  (`{ type: 'stroke', length }`) after `onStrokeEnd`.
- Limits: 12,000 points per picture, 6,000 per stroke, 3,000 strokes per picture.
- The picture a game leaves behind is kept for the results screen (`app.state.pictures` / `app.keepsake()`,
  15.3): the results screen draws it with a view-only Canvas (`canDraw: false`, `tools: 'none'`,
  `colorOf`) and exports PNGs with `paintStrokes` from `js/ui/ink.js`.

`Canvas` behaviour: square, DPR-aware backing store, `touch-action: none`, no callout /
magnifier / selection, pointer capture in try/catch, `pointercancel` ends the stroke,
quadratic-midpoint smoothing, batches flushed every ~50 ms, keeps a margin from the left
screen edge (iOS back-swipe). `tools: 'none'` = one colour (the `color` prop, else `colorOf(me)`), no
toolbar; `'full'` = 8 colours, 3 widths, eraser, undo, clear (clear asks twice). Viewers (`canDraw` false)
get no pointer handling at all, so the page keeps scrolling over the canvas. A completed stroke shorter than
`minStrokeLen` (0–1000 units) is auto-undone and `onShort()` fires so the player may retry (the outbox holds
batches back until a stroke reaches that length, so a tap usually sends nothing; an `undo` is sent only if
something already left the device). With no `ink` prop the canvas works stand-alone (own strokes stay, undo /
clear are local); with one, my own stroke is painted at once from local points and reconciled with `ink` — a
stroke the host never echoes within 3 s counts as refused and disappears.

Optional props (safe to omit):

- `me` — the pid drawing on this device: goes into stroke ids (above) and supplies the pen colour through
  `colorOf(me)` when `tools: 'none'` and no `color` is given.
- `oneStroke` + `rearm` — `oneStroke` stops input after **one accepted stroke**; the lock lifts when `canDraw`,
  `oneStroke`, `color`, `rearm` or the ink epoch changes. `rearm` is any JSON value (fake artist passes the turn
  counter): changing it re-arms a locked canvas. An `update()` with identical props never lifts the lock, and
  a too-short stroke never engages it (retrying is free).
- `touchGuard` (default `true`) — non-passive `touchstart` / `touchmove` `preventDefault` on the canvas (and
  `gesturestart` on its paper) while this seat may draw, so iOS cannot scroll or zoom mid-stroke; viewers are
  never guarded.

### 15.11 UI logic, the 💡 sheet, and what the play / results screens do with the contracts

`js/ui/logic.js` — pure (no DOM), unit-tested under Node:

| helper | what it decides |
|---|---|
| `fits(meta, n, mode) → { ok, reason }` | does a game fit the table (head-count over **seated** players, spectators excluded; `meta.singleDevice === 'none'` fails in local mode); `reason` is shown on the greyed picker card |
| `teamStyle(role) → { color, label }` | team colour + Cantonese label: `role.color` / `role.teamLabel` win, then a team table (`good`, `wolf`, `spy` …), then a CSS-colour `team` |
| `rankRows(players, scoreboard)` | scoreboard order: points, wins, fewer games played, seat; ties share a rank |
| `turnOrderMatters(id, meta)`, `TURN_ORDER_GAMES` | `meta.turnOrder` (boolean) wins, else membership in `TURN_ORDER_GAMES` (§15.2) |
| `presetMatches(cfg, presetCfg)` | every key of the preset's `cfg` equals the current config (JSON equality) |
| `savedOrderDiffers(players, group)`, `savedGroupNames(group)` | offer 「用返上次座位」; pre-fill one-phone setup |
| `headingOf(line)`, `resultSections(lines)`, `sectionsOpen(sections, longOver = 8)` | `result.lines` → `[{ title, lines }]` (rules in §15.2 *Result fields*); `sectionsOpen` → all open when the recap has ≤ 8 lines, else only section 0 |
| `pictureFileName(gameName, index, date)` | `假畫家-2026-10-03-2.png` (index 0 has no suffix) |
| `roleFor(view, rules)`, `roleParts(text)` | the 💡 sheet's own-role card and its 「做乜」 / 「點贏」 split (text written `做乜：… 點贏：…`) |
| `fmtDuration`, `fmtClock`, `TIMER_PRESETS`, `timerStep`, `clampTimerSec`, `timerLeftMs`, `timerCue`, `inAppBrowser` | table-timer maths and sounds; in-app browser detection |
| `turnBadge(focus, seat, { night })` | the header's 「輪到你」: only when focus names this seat ALONE — never at night, never for `anonymous`, `together` or `simultaneous` focus (#14) |
| `skipNeedsConfirm({ waiting, focus, night, mode, cueId, ackedCueId })`, `SKIP_CONFIRM` | does the host's ⏭ 跳過呢步 take two taps: when the engine waits on a seat (`state.waiting`), an anonymous step, the host's own seat is called, or night — except the 讀稿 narrator's tap on a line it has not moved past yet (#13) |
| `scoreboardMode(rows)` | `{ points, earned(row) }`: is there a 分數 column tonight; may a row wear a medal (#39) |
| `resultHero(result, meta)`, `confettiSet(meta)` | the results headline (#39, see below); confetti with the game's own emoji |
| `recentFolds(recent)` | `view.recent` → `[{ key, title, open, entries: [{ title, lines }] }]` (§15.2) |
| `nightChrome({ seat, night, inFocus, mode, shared })`, `NIGHT_WORDS` | the night overlay `{ on, level: 'dark' \| 'soft' \| 'opaque' \| null, words }` (§7): in 靜音 the same for every seat (D1); `words` depend on the mode only |
| `hintRoleText(view)` | `view.hintRoleText` as one 「做乜：… 點贏：…」 string ('' if none); `roleFor` puts it in place of the rules text |

**💡 sheet** (`js/ui/hints.js`, `HintSheet(sh, { onRules }) → { open(game, view), update(game, view), close(), isOpen() }`)
— **on demand only**: it opens when the player taps 💡 (top bar or ⋯ menu) and never by itself. Sections:
「而家要做咩」 (`view.hint`), 「你嘅角色」 (role card from `roleFor`: the game's `rules.roles` entry for `view.roleId`,
behind the same hold-to-peek `Cover` as a role card, so a glance from the next seat sees nothing; heading from
`view.hintRoleLabel` if present; **text from `view.hintRoleText` if present** — this table's rule, e.g. 狼人殺's win
condition — else the `rules.roles` text), and 「📖 睇晒成套規則」. A game with no own-role field (undercover) lists every role
of the game instead. It follows the live view while open and **closes whenever the phone changes hands** (seat
switch, pass gate).

**Play screen** (`screens/play.js`), host ⋯ menu: ▶/⏸ · ⏭ 跳過呢步 (a skip the engine ignores toasts 「跳唔到呢步 — 要等人
自己做…」, #9) · 🗑️ 呢輪作廢 (two taps → `hostCtl.voidRound()`; when `hostCtl.canVoid()` says no, its message at once and
nothing armed; when it returns false, that message or 「呢個遊戲唔支援呢輪作廢」; 「暫停緊 — 先㩒「繼續」」 while paused) ·
**💤 標記缺席…** (D4: the sheet turns into a seat picker in place — 「💤 阿明」 takes two taps → `hostCtl.markAbsent`;
an absent seat reads 「👋 阿明 返咗嚟」, one tap → `markPresent`; ‹ 返回; a refusal toasts) · one 「🎛️ label」 per
`state.hostActions` entry (`hostCtl.hostAction(i, label)`; toast 「而家做唔到」 on false) · ⏱️ · narration mode ·
「🤖 代 X 做」 + 「💤 當 X 缺席」 per seat in `room.stalled` or `room.idle` (「斷咗線 / 無反應」) · the connection list
(💤 缺席 tag) · 🚪 離開房間 (two taps). Every confirm is the in-page arm-then-confirm (`sh.confirm`,
never a native dialog, #3): the row stays open on the first tap and reads 「再㩒一次：…」. ⏭ 跳過呢步 (menu and narrator
bar) takes two taps when `logic.skipNeedsConfirm` says skipping would cut somebody off (#13). A stalled seat also gets
a banner — 「⚠️ 阿明 斷咗線，成個遊戲等緊佢」 — with **代佢做 · 💤 當佢缺席 · 呢鋪唔計 · 再等** (💤 and 呢鋪唔計 take two
taps; rebuilt only when it changes, so an armed button keeps its label). A connected seat nobody answers on
(`room.idle`, #9) gets no banner, only the ⋯ rows 🤖 代 X 做 · 💤 當 X 缺席, and the ⏭ toast names it. The night overlay follows
`logic.nightChrome` (§7). The narrator
bar is compact while `state.canInk` (or `view.canDraw`) names this phone's seat. The header's 「輪到你」 follows
`logic.turnBadge` and sits **before** the subtitle (a long subtitle's ellipsis never hides it). Under the game UI,
`view.recent` renders as `RecentFold` (#10). Shared-phone behaviour: §7.

**Connection bar** (`shell.js`, #4): when it shows, `body.has-netbar` + `--netbar-h` (its measured height, safe area
included) push the page and the sticky play header down, so 💡 📖 ⋯ → 🚪 stay reachable. A **guest** stuck behind it
for 30 s (the host has gone) also gets 🚪 離開 inside the bar (two taps). `sh.leave(node?)` / `sh.confirm(text, node?,
opts?)` are the shell's own arm-then-confirm entry points (lobby ‹ and ✕ 踢走 and results 🚪 go through them; ConfigForm's
↺ 重置 calls `confirmTap` itself). 📋 複製連結 (lobby, the in-app-browser card) uses `dom.copyBox()`: when the clipboard
refuses, the link appears in the page as a selected read-only field (「㩒住條連結 → 揀「拷貝」」) — never
`window.prompt`. DiceCup's motion-permission lines say 「iPhone」 / Safari only on a real iPhone / iPad
(`shake.isIOS`, `motionWords`; neutral 「部機」 wording elsewhere, #38).

**Results screen** (`screens/results.js`): hero (#39, `logic.resultHero`) — the game's emoji + name as a small
kicker line, then the **result** as the headline: the game's `summary` (every scoring game writes it as the result,
「貪瞓鼠贏 — 大盜 阿明 畀人揪出」), 🚫 呢鋪唔計 for `lastResult.void`, 「邊個贏由你哋講」 for `noScore`, else 🏆 贏家 /
🤝 冇人贏 — never 「<game> — 贏家」; then the winners' chips. Confetti (winners only) uses the game's own emoji.
「點解會咁」 (or `result.linesTitle`) as foldable sections (`result.lines`), points card, the evening scoreboard, and for drawing
games a **keepsake** card: `app.keepsake()` pictures, view-only, thumbnails when there are several, 「💾 儲存圖片」
(PNG files, 1080 px + a caption strip; the share sheet where `navigator.canShare` allows, else downloads). The PNGs
are rendered as soon as the screen opens so the tap itself can call `navigator.share` (iOS needs a real tap).

### 15.12 `Room` (js/core/room.js) — host side

```js
new Room({ code, hostDeviceId, names, send(deviceId, msg, peerId), loadGame(id), bag, now, rng, timers, store,
           onCue(cue, { replay }), onNotice(text), onChange(), onGroup(group), narrationMode, stallMs, build,
           restore?, game? })
Room.restore(snap, deps) → Promise<Room>      // session comes back PAUSED;  Room.readGroup(store) → saved seating | null
room.receive(peerId, msg) / peerClosed(peerId) / welcome(deviceId) / sync()      // §8, remote devices
room.selectGame(id) → Promise<{ ok, message }>        // loads module + banks, config.defaults(n, lastUsed, { singleDevice })
room.setConfig(cfg) · moveSeat(pid, index) · setColor(deviceId, pid, color) · addSeat(deviceId, name) · removeSeat(deviceId, pid)
room.kick(pid) · keepSeat(pid, keep) · applySavedOrder() · approveClaim(pid) · rejectClaim(pid)
room.start() → { ok, message, warnings? }  ·  room.again()  ·  room.toLobby()   // toLobby also aborts a running game (nothing scored)
room.act(deviceId, pid, action) → bool          // the seat's own device only; '@…' types and > 8 KB refused
room.ink(deviceId, pid, payload) → bool
room.pause() · resume() · next() · cueDone(id) · autoAct(pid) · voidRound() · canVoid() · hostAction(i, label?) · setNarrationMode(mode) · poke() · hostBack(awayMs)
room.markAbsent(pid) · markPresent(pid)        // D4 '@absent' / '@present' as the host; room view `absent`; stalls skip them
room.timerStart(ms, label?) · timerPause() · timerResume() · timerAdd(ms) · timerStop()
room.snapshot() · close(reason) · dispose() · currentCue() · seatedCount · player(pid) · seatsOfDevice(id) · deviceOfPeer(peerId)
export filterFocus(focus, seatIds)   // §4: what one device may learn about focus
```
Every public mutator runs inside one batch: all changes made during a call are flushed to the devices once,
synchronously, when the outermost call returns (`room` message if the room view changed, `views` if any engine
state changed). A device only ever receives the views of **its own playing seats** plus the public table view;
tokens go only to the device that owns the seat. `act` returns true iff the engine changed state; a remote
`act` carrying an `id` is answered with an `ack` after the resulting views. Limits: `MAX_SEATS` 16 players per
game, `MAX_PEOPLE` 24 including spectators.

### 15.9 `docs/games/<id>.md` template

1. At a glance — players, minutes, what the phones do vs what happens at the table.
2. Setup — config fields with defaults per head-count, validation, warnings.
3. Flow — every phase: what the host phone, each role's phone and the table view show;
   what happens physically; exact Cantonese narration lines; timers; transitions;
   anti-tell handling.
4. Single-device play and paper mode (if any).
5. Engine — phases, state fields (mark PRIVATE), actions + validation, advance/deadline
   rules, focus, autoAct, result + the Cantonese explanation lines.
6. Edge cases → the test list.
7. 貼心 touches specific to this game.
8. Framework requests — anything this game needs that §15 does not provide.
