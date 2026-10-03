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
   every gesture-gated API (speech, audio, motion) is primed from a real tap.
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
core/transport.js    P2PHost / P2PClient (PeerJS) · LocalTransport (one device)
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
    paperMode: false,                    // true if a physical paper/pen variant exists
    singleDevice: 'full' | 'partial' | 'none',
    blurb: '一句介紹',
  },
  rules: {
    quick: ['30 秒學識，一行一句'],          // shown on the picker and in-game
    roles: [{ id, name, emoji, team, text }],
    sections: [{ title, body }],          // full reference, plain text
  },
  config: {
    defaults(n, prev) → cfg,              // recommended setup for n players (prev = last used)
    validate(cfg, n) → { ok, message, warnings: [] },
    fields(cfg, n) → Field[],             // shell renders the setup form from this
    summary(cfg, n) → string[],           // lobby lines, e.g. ['2 狼人', '預言家', '女巫']
  },
  engine,                                 // §4
  ui,                                     // §6
}
```

`Field` = `{ key, label, type: 'int'|'bool'|'select'|'roles'|'categories'|'seconds', help?, min?, max?, options? }`.
A `roles` field renders the role-count editor from v1 (with the auto-fill role);
`categories` renders bank category + difficulty filters with "已用 37 / 1,243".

## 4. Engine contract

```js
engine.setup({ players, config, rng, now, bag }) → state
engine.act(state, { pid, action }, ctx) → state      // ctx = { rng, now, bag }
engine.advance(state, ctx) → state                   // called when state.deadline passes
engine.view(state, pid) → object                     // pid = null → table/spectator view
engine.cue(state) → { id, text, minMs } | null       // narration for the current step
engine.focus(state) → null | { pids: [...], anonymous?: string }
engine.autoAct(state, pid, ctx) → action | null      // what to do for a stalled player
engine.result(state) → null | { winners, summary, lines, points? }
```

- `players` is `[{ id, name, seat, color }]` in seat order.
- `act` must validate: wrong phase, wrong player, illegal target → return `state`
  unchanged. Never throw on bad input from the network.
- **Host-internal actions** use `pid: '@host'`:
  `{ type: '@cue-done', id }` (narration for cue `id` finished),
  `{ type: '@next' }` (host pressed 下一步 in read-aloud mode or skipped a step),
  `{ type: '@auto', pid }` (host chose to auto-act a stalled player — session calls
  `autoAct` and feeds the result back as that pid).
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

### Pacing and anti-tell (night games)

- Every step that exists in the rules exists every time, even if its role is dead or in
  the centre. The narrator still calls it, and it lasts its full time.
- **Steps never end early because the actor finished.** A fixed duration per step, or
  narration end + fixed padding. Silence length must not reveal whether anyone acted.
- **Every seat gets something to tap during every night step.** Non-actors get a decoy
  of the same shape and size (e.g. 「㩒一張牌確認你未瞓著」). Tap noise and finger
  movement are then uninformative.
- Non-host phones mute SFX and dim to a black "閉眼" screen between their own actions.

## 5. Session & room (host)

`Room` holds: code, host pid, `players[] {id, name, token, seat, color, deviceId,
connected}`, `devices{}`, `gameId`, `config`, the current `Session`, `scoreboard
{pid: {played, wins, points}}`, `history[]`, `narration {mode, voiceURI, rate}`.

Room phases: `lobby` → `playing` → `results` → (`playing` again | `lobby`).

- **Lobby.** Host picks a game (everyone sees it change), edits config (everyone sees the
  summary), arranges seats to match the real table, starts. Players may pick their colour.
  The picker greys out games that don't fit the current head-count and says why.
- **Results.** Winners, an explanation of *why* (e.g. "強盜搶咗狼人張牌，所以阿明而家
  係狼人"), points, the running scoreboard. Buttons: 再玩一局 · 換遊戲.
- **Late join.** Lobby: normal. Mid-game: spectator (table view) until the next game.
- **Disconnect.** The seat is kept. If the engine is waiting on that seat for longer than
  `stallMs` (config, default 45 s), the host sees 「阿明斷咗線 — 代佢做／再等」.
  Auto-act uses `engine.autoAct` (abstain, pass, random legal choice).
- **Host refresh.** Snapshot of the room + session to localStorage on every change,
  restored under the same room code (v1 behaviour, kept).
- Every room/session change → per-device messages (§8).

## 6. Game UI contract

```js
ui.mount(root, api) → { update(view), destroy() }
```

`api`:
`send(action)` · `me` (current seat pid on this device) · `players` · `isHost` ·
`components` (§10) · `sfx(name)` · `toast(text)` · `now()` (host-synced clock) ·
`config` · `meta`.

UIs are **render-from-view**: `update(view)` may be called with the same view twice and
must be idempotent. Local, uncommitted UI state (a half-picked target) lives in the UI.

## 7. Devices, seats and single-device play

A **device** holds one or more **seats**. The common case is one seat per phone.
Two people can share a phone (someone's battery died); one phone can hold every seat
(no data at all — LocalTransport, no PeerJS).

- On a device with several seats the header shows the current seat; switching goes
  through a **PassGate** — a full-screen 「交俾 阿明 ・ 其他人唔好望」 card the receiver
  taps to open. Private covers (hold-to-peek) still apply behind it.
- When `focus` names seats on this device, the device walks through them in seat order,
  gating each one. With `anonymous`, the gate shows the role prompt instead of a name.
- Votes and other simultaneous secret actions become sequential on a shared device;
  engines already accept actions in any order, so nothing changes for them.
- `meta.singleDevice` tells the picker how well a game works on one phone, and the
  per-game doc explains how (e.g. "夜晚部手機放枱中間，被叫到嘅角色拎起")

## 8. Protocol (v2)

All messages are JSON over the PeerJS DataChannel (or in-process for LocalTransport).

Client → host

| t | payload | notes |
|---|---|---|
| `hello` | `{ seats: [{ name, token? }], deviceId }` | one device may register several seats |
| `act` | `{ pid, action, rev }` | `pid` must belong to the sender's device |
| `ink` | `{ pid, stroke, pts, end? }` | canvas stream, see §11 |
| `lobby` | `{ op, ... }` | colour pick, leave seat |
| `ping` | `{ t }` | clock sync |

Host → client

| t | payload |
|---|---|
| `welcome` | `{ device, seats: [{ id, token, name }], room, views }` |
| `room` | room view: players, seats, colours, game, config summary, phase, scores, narration flag |
| `views` | `{ rev, hostNow, bySeat: { pid: view }, table: view }` — only this device's seats |
| `ink` / `inkSync` | relayed strokes / full drawing on (re)join or new turn |
| `pong` | `{ t, hostNow }` |
| `reject` | `{ reason }` |

Views are sent whole (they are small); `rev` lets a client drop stale ones. Canvas ink is
the only stream kept outside views.

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
- Only seats the engine allows (`view.canDraw`) may ink; the host validates the sender.
- Strokes stream in ~50 ms batches (`ink`), host relays to everyone and appends to
  `room.ink`; `inkSync` re-sends the whole drawing on reconnect.
- The engine bumps `state.inkEpoch` to start a new picture; the session clears ink.
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
- Browser: two-tab and single-device runs per game before each release.

## 15. Implementation contracts (binding — parallel agents build against these)

### 15.1 Files

```
index.html                    <div id="app"></div>, loads css/base.css?v= and js/main.js?v= (module)
css/base.css                  all shared styles (tokens + layout from v1 styles.css, all components)
js/main.js                    boots: const app = createApp({ narrator }); startShell(app, root)
js/core/engine-kit.js         EXISTS — pure helpers (rng, shuffle, tally, seats, clone, ACT/HOST)
js/core/util.js               v1 js/util.js moved (DOM helpers, storage, room code, wake lock)
js/core/net.js                v1 js/net.js moved (PeerJS HostNet/ClientNet, unchanged behaviour)
js/core/sfx.js, shake.js      v1 moved
js/core/bag.js                content bag (15.5)
js/core/session.js            runs one engine (15.4)
js/core/room.js               host room: seats, devices, lobby, scores, snapshot, messages (§5, §8)
js/core/transport.js          HostTransport (P2P over HostNet) + ClientTransport (over ClientNet)
js/core/client.js             createApp() — the ONLY object the UI talks to (15.3)
js/core/narrator.js           createNarrator() (15.6) — browser only
js/ui/shell.js                startShell(app, root): all screens (§2), top bar, host menu, pass gate, night dim
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
- `engine.legalActions(state, pid) → action[]` **required** — every action this seat may
  send now (empty if none). Used by the fuzzer and by the default `autoAct`. For free-form
  input (typed guesses, typed words) return one representative valid example.
- `engine.canInk?(state, pid) → bool` — drawing games only.
- `config.defaults(n)` must return a config valid for every n in `meta.players`.
- The session **clones state before every engine call**, so engines may mutate the state
  they receive and must return it. Returning `undefined` means "unchanged".
- State is plain JSON (no Map/Set/Date/functions) — it is snapshotted and cloned.
- Views carry `phase` and, when a timer runs, `deadline` (host ms). A view may set
  `night: true` (shell dims the screen and mutes SFX for this seat unless `focus` names it)
  and `title`/`subtitle` for the top bar.

### 15.3 `createApp({ narrator })` → `app`  (js/core/client.js)

Event: `app.on('change', fn)` fires after any change to `app.state`; `app.off`.

```js
app.state = {
  mode: null | 'host' | 'client' | 'local',
  conn: 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline' | 'error', connMessage: '',
  code: '1352' | null, isHost: false, deviceId: '',
  mySeats: ['p_x', ...], activeSeat: 'p_x' | null,
  room: {
    phase: 'lobby' | 'playing' | 'results',
    players: [{ id, name, seat, color, connected, deviceId, isHost, spectator }],   // seat order
    gameId: 'spyfall' | null, config: {}, configSummary: [''], configValid: { ok, message, warnings },
    scoreboard: { [pid]: { played, wins, points } }, history: [{ gameId, winners, summary }],
    narration: { mode: 'voice' | 'read' | 'silent' }, paused: false,
    stalled: [{ pid, since }],                         // host only: seats the session is waiting on
    lastResult: null | { gameId, winners, summary, lines, points },
  },
  views: { [pid]: view },          // only this device's seats
  table: view | null,              // engine.view(state, null)
  focus: null | { pids: [], anonymous: '' },
  cue: null | { id, text },        // host only: the current narration line
  ink: { epoch: 0, strokes: [] },  // drawing games
  rev: 0,
};

// entry points (all async-safe; errors land in state.conn/connMessage and are also thrown)
await app.host({ names })          // create a P2P room; first name = host's own seat
await app.join(code, { names })    // join a room with one or more seats on this device
app.local({ names })               // whole game on this device, no network
await app.resume()                 // host snapshot or client token from localStorage; false if none
app.leave()

// lobby — host only unless noted
app.lobby.selectGame(id)           // loads the game module + banks, applies config.defaults(n)
app.lobby.setConfig(cfg)
app.lobby.moveSeat(pid, index)
app.lobby.setColor(pid, color)     // host, or the seat's own device
app.lobby.addSeat(name)            // any device: add a seat on THIS device (shared phone)
app.lobby.removeSeat(pid)
app.lobby.kick(pid)
app.lobby.start() → { ok, message }

// play
app.act(pid, action)               // pid must be one of state.mySeats
app.ink(pid, payload)
app.setActiveSeat(pid)

// results — host only
app.results.again()
app.results.toLobby()

// host controls
app.hostCtl.pause(); app.hostCtl.resume(); app.hostCtl.next(); app.hostCtl.autoAct(pid)
app.narration.setMode('voice' | 'read' | 'silent')
app.clock.now()                    // host-synced ms
app.game(id) → Promise<loaded game module>   // cached; the shell uses it for rules/ui
```

Host and local modes run `Room` + `Session` in-process and deliver this device's payload
directly; client mode receives the same payloads over `ClientTransport`. Narration runs
only where the session runs (host/local): when `cue.id` changes and mode is `voice`,
`narrator.speak(text)` then `session.cueDone(id)`; in `read` mode the shell shows the
text and a 下一步 button that calls `app.hostCtl.next()`; in `silent` mode the session
auto-completes cues after `cue.minMs`.

### 15.4 `Session` (js/core/session.js) — host side

```js
new Session({ game, players, config, rng, bag, now: () => ms, onChange, onCue })
session.dispatch(pid, action)   // clones, engine.act, schedules deadline, emits
session.cueDone(id)             // dispatch(HOST, { type: ACT.CUE_DONE, id })
session.next()                  // dispatch(HOST, { type: ACT.NEXT })
session.autoAct(pid)            // engine.autoAct ?? legalActions[0], then dispatch as pid
session.pause() / resume()      // freezes timers; shifts state.deadline on resume
session.view(pid) / session.table() / session.focus() / session.cue() / session.result()
session.ink(pid, payload) → bool   // validates engine.canInk; appends; returns accepted
session.snapshot() / Session.restore(snap, deps)
```

### 15.5 Bag (js/core/bag.js)

```js
createBag({ storage }) → bag
await bag.load(bankId)            // dynamic import of js/data/<file>.js?v=N
bag.draw(bankId, filter?) → entry | null      // without replacement, persisted per bank
bag.stats(bankId, filter?) → { used, total }
bag.reset(bankId)
bag.custom(bankId) / bag.addCustom(bankId, entry) / bag.removeCustom(bankId, key)
```
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
| `Cover` | `{ front: Node, backArt: string, backLabel, lockMode: 'none' \| 'peek', locked, onOpen(open) }` — hold to peek; with lockMode 'peek' and locked, a press is refused with a shake |
| `RoleCard` | `{ role: { emoji, name, team, text } \| null, locked, onLockToggle, hint }` — Cover + 🔒 button underneath |
| `DiceCup` | `{ dice: [n] \| null, sides, rollSeq, canRoll, lockedRoll, onRoll, onLock, shakeToRoll: true }` — cup art, hold to peek, roll button, lock-roll button, shake detector |
| `PlayerPicker` | `{ players, me, count: 1, exclude: [pid], selected: [pid], disabled, onChange(sel), confirmLabel, onConfirm(sel) }` |
| `VotePanel` | `{ players, candidates: [pid], me, myVote, allowAbstain, progress: { done, total }, reveal: null \| { counts, top }, onVote(pid \| null) }` |
| `Timer` | `{ deadline, now: () => ms, label, paused, warnAt: [60, 10] }` — plays sfx at warnings/zero |
| `RulesSheet` | `RulesSheet.open(game)` / `.close()` — modal from `game.rules` |
| `NarratorBar` | `{ cue, mode, onReplay, onNext, onMode }` |
| `PassGate` | `PassGate.show({ title, subtitle }) → Promise<void>` (resolves when the receiver taps) |
| `SeatEditor` | `{ players, me, isHost, onMove(pid, index), onColor(pid, color), onKick(pid) }` |
| `Scoreboard` | `{ players, scoreboard, history }` |
| `ConfigForm` | `{ fields, value, onChange(cfg) }` — renders §3 Field[] (int, bool, select, seconds, roles, categories) |
| `Canvas` | batch 2 — `{ mode: 'draw' \| 'view', ink, color, canDraw, oneStroke, onInk(payload) }` |

Helpers in `js/ui/dom.js`: `el(tag, attrs, ...kids)`, `$`, `$$`, `toast(text)`, `dieFace(value, sides)`.

### 15.8 Game UI `api` (passed to `mount`)

```js
api = {
  me,                 // pid whose view is being rendered
  players,            // room players, seat order
  isHost, meta, config,
  send(action),       // app.act(me, action)
  ink(payload),
  now(),              // app.clock.now()
  sfx(name), toast(text),
  components,         // { Cover, RoleCard, DiceCup, PlayerPicker, VotePanel, Timer, Canvas, dieFace }
}
```
`update(view, ctx)` — `ctx = { focus, paused, narrationMode, ink }`.

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
