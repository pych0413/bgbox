# Codebase map — v1 Cheese Thief app and the v2 hub rewrite

Snapshot: 2026-10-03 07:15 UTC. Git HEAD is `13a9e7c` (v1). All paths are relative to `D:\board_game`.

- **v1** = what is committed at HEAD. It is stable, and every v1 line number below is exact.
- **v2** = the untracked/modified working tree (`js/core/`, `js/ui/`, `js/games/`, `css/`, `sw.js`, `tests/`, `tools/check-imports.mjs` ...). Parallel agents were still writing it while this map was made. `index.html` was rewritten to a 38-line shell at about 07:15 UTC. Treat v2 line numbers as "as of snapshot", and treat the v2 coverage in §10 as shallow: interfaces and carry-over checks, not a review.
- Scope: Cheese Thief (芝士大盜) is the first game of the hub. The v1 app is the "通用派牌 + 骰盅" (generic dealer + dice cup) game plus the connection layer that every game needs.

Zh names used here: 房主 host · 主持 moderator/referee (法官 in 狼人殺) · 玩家 player · 旁觀 spectator · 房間號碼 room code · 大廳 lobby · 派牌 deal · 回合 round · 角色牌 role card · 骰盅 dice cup · 骰仔 dice · 鎖定 lock · 冚住 / 掀盅 cover / lift the cup · 開晒 reveal all · 斷線 disconnected · 重連 reconnect.

---

## 0. TL;DR

1. v1 is 2,137 lines of JS across 7 modules (`app.js` 1122, `game.js` 322, `net.js` 206, `roles.js` 120, `sfx.js` 147, `shake.js` 103, `util.js` 117), one 281-line HTML file and one 517-line CSS file. There is no build step, no backend and no npm. PeerJS is the only runtime dependency; it is a classic `<script>` from jsDelivr that sets the global `Peer`.
2. `net.js`, `sfx.js`, `shake.js` and `util.js` are reusable as-is. They were already copied to `js/core/` with only stamp and Node-guard changes. `game.js`, `roles.js` and `app.js` are replaced. Their behaviour now lives in `js/games/custom/game.js`, `js/core/room.js`, `js/core/client.js`, the `js/ui/components/*` and `js/ui/screens/*`.
3. The v1 protocol has four client→host messages (`hello`, `roll`, `lock`, `seen`) and four host→client messages (`welcome`, `state`, `secret`, `reject`). There is no versioning and no ack. The host broadcast public state to every open connection, even ones that never said hello. The v2 protocol (`room.js`, `client.js`) fixes that and adds `v`, `bye`, `ping/pong`, `lobby`, `ink`, `notice`.
4. The lock logic (`app.js:562-595` + `game.js:198-225`) exists to survive a phone that locks while briefly offline, and to tell "host unlocked me" apart from "host never heard me" via `diceUnlockSeq`. In v2 locks are engine state (`custom/game.js`), so the `diceUnlockSeq` machinery has no counterpart. The offline-lock case is still open: a dropped `act` is silently lost (§6.4, §11 G4).
5. Hard-won iOS behaviours (pointer-capture try/catch, motion permission as first await, `diceSeq`-keyed roll chime, covers close on `visibilitychange`, suspended AudioContext drops sounds, stamped imports) are listed in §9 with their v2 status. Most already survived the move. Timer's private AudioContext, state-driven chimes, and service-worker registration have not yet.
6. v1 README promises two lock behaviours that the v1 code does not deliver (§6.5). v2's `custom` engine changes a few more rules. Confirm with the owner before treating v2 as "the same app".
7. Biggest DESIGN.md gaps (§11): engine `setup` has no host identity; `§8` protocol table is out of date versus `room.js`; bank files are in shards (`js/data/parts/`) and the three merged bank files `bag.js` imports do not exist yet (`check-imports` fails on them); no test or merge step that enforces unique draw-word keys (52 duplicates existed across shards at 07:03 UTC and were gone by 07:20 UTC); the service worker is not registered; `?v=` stamps are cache-busters, not immutable URLs (lazy `import()` after a push can load duplicate module instances); night-mute and user-mute share one flag; the planned move to `/bgbox/` is not in DESIGN.

---

## 1. Inventory

### 1.1 v1 (tracked, HEAD)

| File | Lines | Verdict | Where it went in v2 |
|---|---|---|---|
| `index.html` | 281 | replace (done) | 38-line shell + `js/main.js` |
| `styles.css` | 517 | adapt (done) | `css/base.css` (899 lines) |
| `js/app.js` | 1122 | replace | `ui/shell.js`, `ui/screens/*`, `core/client.js`, `ui/components/*` |
| `js/game.js` | 322 | replace | `games/custom/game.js` (engine) + `core/room.js` (plumbing) |
| `js/roles.js` | 120 | replace | ported into `games/custom/game.js:33-183`, then delete |
| `js/net.js` | 206 | **reuse as-is** | `core/net.js` (diff: one import stamp) |
| `js/util.js` | 117 | reuse, trim | `core/util.js` (adds `makeStore`) |
| `js/sfx.js` | 147 | reuse, extend | `core/sfx.js` (+Node guard, +5 sounds) |
| `js/shake.js` | 103 | **reuse as-is** | `core/shake.js` (+`typeof window` guard) |
| `manifest.webmanifest` | 14 | adapt (done) | renamed 桌遊盒, PNG icons |
| `icon.svg` | 9 | keep | still used as `rel=icon` |
| `README.md` | 191 | rewrite later | v1-specific (Cantonese user manual) |
| `.claude/launch.json` | 11 | rename | server name `cheese-thief`, port 5178 |
| `tools/bump-version.sh` | 15 → 123 | rewritten | see §8 |
| `.gitattributes` (`* text=auto eol=lf`), `.gitignore`, `.nojekyll`, `LICENSE` (MIT) | — | keep | `.nojekyll` and `eol=lf` matter, see §8 |

There is no `.github/` directory, so there is no CI. Deploy is "push to `main`, Pages serves the root".

### 1.2 v2 working tree (untracked/modified; snapshot)

`sw.js` (169) · `tools/check-imports.mjs` (364) · `tools/make-icons.mjs` (180) · `icons/*.png` · `css/base.css` (899) · `js/main.js` · `js/core/{engine-kit 120, util 145, net 206, sfx 160, shake 103, session 385, bag 176, transport 82, room 957, client 634, narrator 206}.js` · `js/ui/{dom 125, shell 321}.js` · `js/ui/screens/{home 228, join 135, lobby 397}.js` · `js/ui/components/{Cover, DiceCup, RoleCard, PlayerPicker, VotePanel, Timer, SeatEditor, Scoreboard, RulesSheet, NarratorBar, PassGate, ConfigForm, Canvas, index}.js` · `js/games/registry.js` + `{custom, cheese-thief, undercover, spyfall, 9upper}/…` · `js/data/undercover-words.js` + `js/data/parts/*` (14 shards) · `tests/{lib, run}.mjs` + 5 `*.test.mjs` (221 tests pass at 07:14 UTC) · `docs/DESIGN.md` (508) · `docs/games/9upper.md` · `docs/research/*`.

The v1 originals (`js/app.js`, `game.js`, `roles.js`, `net.js`, `util.js`, `sfx.js`, `shake.js`, `styles.css`) are still on disk next to the v2 copies. They are restamped by `bump-version.sh` and listed in the service-worker PRECACHE, so they should be deleted once nothing needs them (§8.4).

---

## 2. v1 module graph

```
index.html ──► (classic) peerjs@1.5.4  → window.Peer
          └──► (module)  js/app.js
app.js  ─► util.js, roles.js, game.js, net.js, shake.js, sfx.js
game.js ─► util.js (uid, shuffle, rollDie, hhmm), roles.js (buildDeck, validateRoles)
roles.js ─► util.js (uid, shuffle)
net.js  ─► util.js (makeRoomCode, sleep)           uses global Peer
sfx.js, shake.js: no imports (browser globals only)
```

Every relative import and asset URL carries `?v=<digits>` (`index.html:15,279`; each import line).

---

## 3. v1 files, one by one

Each entry gives purpose, key contents with line numbers, a reuse verdict, and the coupling to Cheese-Thief-specific logic.

### 3.1 `index.html` (281 lines)

- **Purpose.** Static markup for all five screens, toggled by `.screen.active` (`data-screen` = `home` 22-48, `join` 51-80, `create` 83-150, `lobby` 153-182, `game` 185-271), plus `#toast` (275) and `#netbar` (276).
- **Head.** `viewport-fit=cover, maximum-scale=1, user-scalable=no` (5). Apple standalone metas (7-9). Manifest (12). `rel=icon` and `apple-touch-icon` both point at `icon.svg` (13-14). CSS `?v=` (15).
- **Scripts.** PeerJS is a blocking classic script (278). `js/app.js?v=` is the only module (279).
- **Game screen.** Dice cup card first (194-228), then role card (231-245), players (248-251), host panel (254-264), log (267-270). The cup artwork is an inline SVG with gradient id `cupBody` (198-214).
- **Verdict.** Replace. Already replaced in the working tree. Reusable pieces: the head meta block, and the cup SVG (now `DiceCup.js:34-54` with a unique gradient id).
- **Coupling.** Total: all copy, ids and layout are Cheese Thief / generic-dealer specific.
- **Still to fix in the new shell.** `apple-touch-icon` still points at `icon.svg` (new `index.html:15`) although `icons/icon-180.png` now exists. iOS home-screen icons are generally PNG; verify on device.

### 3.2 `styles.css` (517 lines)

- **Sections.** Tokens (12-30). Root font-size `clamp(13px, 4.1vw, 19px)` so everything is `rem` and scales with the phone (34-38). `#app` max-width 30rem (58-62). Screens (65-67). Buttons (186-213). Role editor (216-266). Dice keypad and the neon `.code-frame` (268-336). Cover card (370-461: `.locked` 414-422, `.pinned` 424-428, `.denied` 430-435). Dice (441-454). `.host-only` gate (490). Toast (496-505), netbar (507-513). `prefers-reduced-motion` (515-517).
- **Verdict.** Adapt. Already ported to `css/base.css` with `.cover-card*` renamed `.c-cover*` and extra `-webkit-touch-callout: none` and `body.modal-open` rules.
- **Coupling.** Low: only token names (`--cheese*`), the `.hero*` block and emoji. The layout system is game-neutral.

### 3.3 `js/util.js` (117 lines)

- **Exports.** `CODE_ALPHABET='123456'`, `CODE_LEN=4`, `isRoomCode` (`/^[1-6]{4}$/`) (10-12). `randInt` with rejection sampling on crypto bytes (15-22). `shuffle` (25-32). `rollDie` (34). `makeRoomCode` (36-40). `uid` (72-bit hex, 42-46). DOM helpers `$ $$ el` (49-66), `toast` (68-76; no-op unless `#toast` exists). `buzz` (78-80). `hhmm` (82-84; uses the device's local time). Safe `lsGet/lsSet/lsDel` (87-98). `keepAwake` wake lock (100-114). `sleep` (117).
- **Verdict.** Reuse, but trim. In v2 `ui/dom.js` re-implements `$ $$ el toast` with different semantics (value applied last, style objects, self-installing toast). Drop the DOM helpers and `toast` from `core/util.js` so there is one copy. `core/util.js` also gained `makeStore` (105), an injectable key/value store for Node tests.
- **Coupling.** Only the "room code = four dice" design choice, which is deliberate (memory: 1296 codes by design).
- **Note.** `util.shuffle(arr)` and `engine-kit.shuffle(rng, arr)` have different signatures; do not mix them.

### 3.4 `js/roles.js` (120 lines)

- **Exports.** `PRESETS` (11-54: `cheese`, `cheeseGang`, `werewolf`, `undercover`, `blank`), `makeRole` (58-67), `presetRoles` (69-72), `fixedCount` (75-77), `validateRoles` (83-101), `buildDeck` (107-120).
- **Role shape.** `{ id, name, emoji, count, desc, filler }`. At most one role has `filler: true`; it absorbs `playerCount − fixed`. With no filler the counts must sum exactly to the head-count.
- **Preset roles (zh).** 芝士小偷 (thief), 偵探 (detective), 守衛 (guard), 村民 (villager), 狼人 (wolf), 預言家 (seer), 女巫 (witch), 獵人 (hunter), 平民 (civilian), 臥底 (undercover), 白板 (blank). 偵探 and 守衛 are not roles of the real Cheese Thief; they are generic-dealer inventions.
- **Verdict.** Replace. Ported into `games/custom/game.js` (`cleanRoles` 107-126, `checkRoles` 131-145, `fitCounts`/`repairRoles` 148-168, presets 35-78); delete `roles.js` afterwards.
- **Coupling.** The presets are game-specific; the filler/deck logic is generic.

### 3.5 `js/game.js` (322 lines)

- **`class Game`** (host only; the authoritative room). Full state in §5.
- **Methods.** `join` (72-100), `disconnect` (102-114), `kick` (116-124), `canStart` (127-136), `deal` (138-154), `rollFor/rollOne/rollAll` (157-183), `markSeen` (185-190), `setLock` (198-211), `unlockAllDice` (213-225), `revealAllRoles/Dice` (228-239), `note` (242-245), `publicState` (249-273), `snapshot/restore` (277-311), `secretFor` (314-321).
- **Verdict.** Replace. Rules went to `custom/game.js`; token identity, snapshot, device/seat handling went to `room.js`. Keep as the reference for behaviour only.
- **Coupling.** Total (roles + dice are hard-wired).

### 3.6 `js/net.js` (206 lines)

- **`peerIdFor(code)` = `'cheesethief-v1-' + code`** (13-14). ICE list: Google and Twilio STUN plus three `openrelay.metered.ca` TURN entries (18-26). Passing `config` replaces PeerJS's defaults, so the STUN entries must stay.
- **`HostNet`** (52-137). `open(preferred)` (59-89) retries 14 times for a fresh code and 6 times with `1200·(i+1)` ms back-off when reclaiming its own id after a refresh. `#wire` (91-120) tracks connections by remote peer id, reconnects the signalling socket on `disconnected`, and runs a 5 s watchdog. `sendTo`, `broadcast`, `close`.
- **`ClientNet`** (142-206). Random peer id per connect. `#dial` (160-179) uses a 15 s timeout, JSON serialization, `reliable: true`, and emits `open` on every successful dial. `#scheduleRetry` (181-191) is linear back-off `min(1000·n, 6000)` ms with no cap on attempts.
- **Verdict.** Reuse as-is. Changes needed: (a) decide the `NS` namespace (§11 G7); (b) a way to close one remote peer (kick) — `room.js` currently relies on `reject` + the client closing itself; (c) see the leak bug in §4.5 item 6.
- **Coupling.** Only the `NS` string and a few Chinese error strings (88, 163, 165).

### 3.7 `js/sfx.js` (147 lines)

- **Design.** Everything is synthesised with Web Audio; there are no audio files.
- **Pieces.** `ensure()` (21-32) lazily creates the AudioContext and resumes it. A capture-phase `pointerdown` listener (35) runs `ensure()` so audio unlocks from a real touch. `primeAudio`, `isMuted`, `setMuted` (37-42). `noiseBuf` (45-52). `clack` (55-69). `tone` (71-83). `whoosh` (86-102). `SOUNDS` (104-136): `roll lift flip lock unlock deny deal reveal join start tap`. `sfx(name)` (138-147) drops the sound if muted or if the context is suspended.
- **Verdict.** Reuse. `core/sfx.js` already adds Node guards and `warn zero turn vote win`. Needs a separate "suppress" flag for night-time muting (§11 G13).
- **Coupling.** None.

### 3.8 `js/shake.js` (103 lines)

- **Exports.** `motionSupported` (15-17), `needsMotionPermission` (20-22), `requestMotionPermission` (25-29), `class ShakeDetector` (31-103).
- **Detector.** Reads `accelerationIncludingGravity`, `|hypot − 9.81| ≥ threshold` per sample (87-89). Spikes closer than 90 ms collapse into one (91-92). `hits` spikes inside `window` ms fire `onShake` and start the `cooldown` (97-100). `start()` arms a 2.5 s probe: no reading means `onNoSensor` (58-69).
- **Defaults are 12 / 3 / 1000 / 1500; the app passes `threshold: 10, hits: 3` (`app.js:490-491`).**
- **Verdict.** Reuse as-is. **Coupling.** None.

### 3.9 `js/app.js` (1122 lines) — everything else

Mapping from v1 regions to where the behaviour lives in v2:

| v1 lines | What | v2 destination |
|---|---|---|
| 12-37 | `S` state, `RESUME_TTL` 8 h | `core/client.js` `state` |
| 42-56 | `goto`, `netbar` | `ui/shell.js` |
| 61-85 | `PIPS`, `dieEl` | `ui/dom.js` `dieFace/addPips` |
| 90-162 | role editor + validation | `ui/components/ConfigForm.js` ('roles' field) + `custom/game.js` `config` |
| 167-217 | dice keypad, code slots | `ui/screens/join.js` |
| 222-272 | lobby render | `ui/screens/lobby.js` |
| 279-357 | game screen render | `games/custom/ui.js` (appeared at about 07:20 UTC; not reviewed) using `RoleCard`, `DiceCup` |
| 372-431 | `bindCover`, `LOCK_BLOCKS_PEEK`, global closers | `components/Cover.js` |
| 436-462 | `doRoll`, `nudgeLocked` | `components/DiceCup.js:158-165,148-156` |
| 467-557 | shake wiring, `onShakeButton` | `DiceCup.js` shared "hub" (56-124) |
| 562-595 | `requestLock`, `syncLocks` | engine state in `custom/game.js` (§6) |
| 600-633 | `chimeForState`, `chimeForSecret` | `DiceCup.chimeForSeq` ✓; state chimes **not yet** |
| 638-653, 1029-1049 | QR on demand, copy link | `ui/screens/lobby.js:14-` |
| 658-748 | host wiring, snapshot | `core/room.js` + `core/client.js` |
| 753-804 | client wiring | `core/client.js` `handleMessage` |
| 809-908 | create / join / leave | `client.js` `host/join/leave` |
| 913-960 | resume, resume card | `client.js` `resume` + `screens/home.js` |
| 1091-1099 | `?r=` deep link | `ui/shell.js:297-` |
| 1104-1113 | wake-lock re-arm, `beforeunload` | `client.js:612-619`, `shell.js:311` |
| 1116-1121 | hard fail if no `Peer` | replaced; must degrade gracefully (§11 G18) |

- **Verdict.** Replace in full. It is a 1,100-line closure over one global `S`, wired directly to `document`, so none of it is reusable as a module. Mine it only for behaviour (§9).
- **Coupling.** Total.

### 3.10 Misc

- `manifest.webmanifest` (v1): name "Cheese Thief", `start_url`/`scope` `./`, single SVG icon `any maskable`. The working tree version is renamed 桌遊盒 and uses four PNGs.
- `.claude/launch.json`: `python -m http.server 5178` under the name `cheese-thief`.
- `README.md`: Cantonese user manual for v1. Several claims are inaccurate (§6.5).

---

## 4. Network protocol (v1)

### 4.1 Transport

- PeerJS cloud signalling (default host, no key). Star topology: the host's phone is the server; each client opens one reliable DataChannel to it.
- Host peer id = `cheesethief-v1-<CODE>` (`net.js:13`). Clients get random ids per connect, so identity cannot be the peer id. It is the per-player token (§4.4).
- Payloads are plain JSON objects with a string `t`. The client dials with `{ reliable: true, serialization: 'json' }` (`net.js:162`). There is no schema validation: the host does `switch (msg?.t)` (`app.js:701`).
- Signalling is only needed to join or rejoin. Open DataChannels survive a signalling drop. This is why the host's `disconnected` handler just calls `peer.reconnect()` (`net.js:102-105`).

### 4.2 Message catalogue

**Client → host**

| `t` | Payload | Sent from | Host handling |
|---|---|---|---|
| `hello` | `{ name: string, token: string \| null }` | `app.js:869`, on **every** `ClientNet` `open` (also reconnects) | `Game.join(peerId, name, token)` (`game.js:72-100`); reply `welcome` or `reject` |
| `roll` | `{}` | `app.js:447` (`doRoll`) | needs `isPlayer`, `settings.dice.self`, `!diceLocked`, else ignored (`app.js:713-720`) → `rollOne` |
| `lock` | `{ what: 'role' \| 'dice', on: boolean }` | `app.js:567, 588, 593` | `setLock(pid, what, !!on)` (`game.js:198-211`); `what` is not validated |
| `seen` | `{ what: 'role' \| 'dice' }` | `app.js:803` (`sendSeen`) | `markSeen` (`game.js:185-190`) |

**Host → client**

| `t` | Payload | When | Client handling |
|---|---|---|---|
| `welcome` | `{ you: { id, token, name }, state, secret }` | reply to an accepted `hello` (`app.js:705-710`) | stores token (`ct:token:<code>`) and resume pointer (`ct:resume`), sets state and secret, goes to lobby or game (`app.js:754-767`) |
| `state` | `{ state: publicState }` | broadcast on every change, coalesced per microtask (`app.js:658-672`) | replaces `S.state`, closes covers on a round change, `syncLocks`, `chimeForState`, screen switch (`app.js:769-779`) |
| `secret` | `{ secret: { roleId, dice, diceSeq, round } }` | after deal, roll, reveal-roles; only to the owner (`app.js:674-682`) | `chimeForSecret`, store, **clear both local locks**, close covers (`app.js:781-789`) |
| `reject` | `{ reason: string }` | name taken or room full (`game.js:89-92` via `app.js:704`) | shows reason, deletes token, closes net, back to join (`app.js:791-797`) |

There are no pings, acks, versions, sequence numbers, or host→client error messages. `Game.join` has no phase check.

### 4.3 Sequences

```
join:       client ──hello{name,token?}──► host
            client ◄─welcome{you,state,secret}── host        (or reject)
            ... host ──state──► all, host ──secret──► owner

reconnect:  DataChannel drops → ClientNet 'close' → backoff dial → 'open' → hello again.
            Token present ⇒ Game.join returns the same player (game.js:74-85).

host refresh: host reclaims the same peer id (retry while the server still holds it), restores
            Game.restore(snap), marks every non-host player disconnected (game.js:299), clients
            redial and hello with their tokens; welcome carries the stored secret.
```

### 4.4 Identity and secrecy

- **Identity.** Each player has `token = uid('t')` (`game.js:54`). The token goes only in `welcome.you.token` to its owner and is stored in `localStorage` as `ct:token:<code>` (`app.js:757`). It is deleted on `reject` (794). `publicState` never contains tokens.
- **Secrecy.** `publicState()` is a whitelist: `roleId` appears only if `revealRoles`, `dice` only if `revealDice` (`game.js:268-269`). Everything private is sent per-player as `secret`.
- **Trust.** The host's own JS memory holds everything (`assign`, `dice`). That is the documented host-can-peek trade-off (README 100-112, memory). The only mitigation is "房主都要玩" off, which makes the host a card-less moderator.
- **Cosmetic gating.** `.host-only` (`styles.css:490`) is just CSS. Authority is the host: clients can send only the four messages above, and none of them is privileged.

### 4.5 Observations (things to fix, not port)

1. **Broadcast to strangers.** `HostNet.broadcast` (`net.js:128`) sends to every open connection, including ones that never said `hello`. With only 1,296 room codes, anyone can connect and receive public state. v2 `Room` sends only to registered devices (`room.js:200`) ✓.
2. **Kicked players are not disconnected.** `Game.kick` (116-124) deletes the player, but the connection stays open, gets no `reject`, and keeps receiving broadcasts. v2 `Room.kick` sends `reject` and bans the device id (`room.js:603-643`) ✓.
3. **Dead UI path.** The lobby shows a 旁觀 (spectator) tag (`app.js:242`), but nothing creates a non-host player with `isPlayer: false`. Mid-game join is also not gated by phase, so a new player can take a freed seat and hold no card.
4. **Token loss = locked out.** A returning player who lost the token cannot reclaim the seat. The name check only collides with connected players (`game.js:89`), and the disconnected player's seat still counts, so once the room is full (the normal in-game case) they see 房滿咗.
5. **`welcome` does not prime `heardDiceSeq`.** The first remote re-roll after a (re)connect is silent (`app.js:754-767` never calls `chimeForSecret`). v2 `DiceCup` primes on its first update (`DiceCup.js:226-235`) ✓.
6. **Failed join leaks a `ClientNet`.** In `doJoin` (`app.js:856-881`) `S.net = net` is only assigned after `connect()` succeeds. On a wrong code, `peer-unavailable` fires (`net.js:152-155`) and schedules retries; the 15 s timeout rejects `connect()`; the catch runs `S.net?.close()` on `null`. The local `net` keeps redialling forever and keeps firing `host-gone`/`reconnecting` status into the shared `#netbar`, including during a later real game. v2 `client.js:445-451` calls `teardown()` on failure ✓.
7. **`replaced` is ignored.** `Game.join` returns the old peer id (`game.js:84`), but `app.js` never closes the old connection. Harmless (its later close is a no-op because `byPeer` no longer matches), but the old tab keeps receiving broadcasts until it closes.
8. **Lobby disconnect deletes the player** (`game.js:107-110`), which frees the seat but also forgets the token. In-game disconnects keep the seat.
9. **Names.** Truncation is `slice(0, 12)` on UTF-16 (`app.js:811,847`, `game.js:88`), which can cut an emoji in half. `room.js:305` repeats this.

---

## 5. Host state shape, snapshot and restore

### 5.1 `Game` fields (`game.js:24-48`)

```
code, phase: 'lobby' | 'playing', round: int (0 until first deal)
settings: { maxPlayers, hostPlays,
            roles: [{ id, name, emoji, count, desc, filler }],
            dice: { count, sides, self } }
players: Map<pid, { id, name, token, isHost, isPlayer, connected, peerId,
                    seenRole, seenDice, roleLocked, diceLocked, diceSeq }>   (51-59)
assign:  Map<pid, roleId>      SECRET (until revealRoles)
dice:    Map<pid, number[]>    SECRET (until revealDice)
revealRoles, revealDice: bool
diceUnlockSeq: int             bumped only by unlockAllDice()
log: [{ ts, text }]  (max 60)
hostId, onChange(), onSecret(pid)   (callbacks wired by app.js:684-695)
```

- `maxPlayers` counts card holders only. If the host does not play, the room holds `maxPlayers + 1` people (`seatsUsed` 62).
- `canStart` (127-136) requires 2 or more seated **and** `seated === maxPlayers` exactly, then role validation.
- `deal()` (138-154) shuffles one deck onto the seated players, resets `seenRole` and `roleLocked`, optionally bumps `round`, then calls `onSecret` for every player. It does **not** touch `dice` or `diceLocked`.
- `rollFor` (157-169) replaces the dice, bumps `diceSeq`, clears `seenDice`, clears **that player's** `diceLocked` and sets **global** `revealDice = false`.

### 5.2 Per-player payloads

- `publicState()` (249-273): settings (with role definitions and counts), `revealRoles/Dice`, `diceUnlockSeq`, per-player public flags (`hasDice`, `roleLocked`, `diceLocked`, `seenRole`, ...), log with `t = hhmm(ts)` formatted on the host in its local time.
- `secretFor(pid)` (314-321): `{ roleId, dice, diceSeq, round }`.
- Pushing: `pushState` coalesces with `queueMicrotask`, then broadcasts, `chimeForState`, `syncLocks`, `saveHostSnapshot`, `render` (`app.js:658-672`). `pushSecret` sends to the owner, or applies in-process for the host (674-682).

### 5.3 Snapshot / restore

- `snapshot()` (277-289) returns `v: 1`, `savedAt`, code, phase, round, `settings`, `hostId`, players (including tokens and peer ids), `assign` and `dice` entries, reveal flags, `diceUnlockSeq`, log.
- It is saved to `localStorage['ct:host:<code>']` after every state push, with a pointer `ct:resume = { mode, code, savedAt }` (`app.js:744-748`).
- `Game.restore(snap)` (291-311) uses `Object.create(Game.prototype)`, so the constructor is skipped. Players are rebuilt with defaults `{ roleLocked: false, diceLocked: false, diceSeq: 0, ...p, connected: p.isHost, peerId: null }`, so every non-host is offline until they `hello`. The snapshot's `v` field is never checked. Callbacks are reset to no-ops (rewired by `wireGame`).
- `resumeHost(code)` (`app.js:913-932`) reclaims the peer id, restores, rebuilds `S.secret` from `secretFor(hostId)`, then toasts "叫朋友 refresh". The resume card honours an 8 h TTL (`app.js:12, 937`).
- Client side: `ct:token:<code>` plus `ct:resume = { mode: 'client', code, name }`. Nothing else is persisted.
- Keys are never purged except on `leaveRoom` (`app.js:889-908`), so abandoned rooms leave `ct:host:*` and `ct:token:*` behind.

### 5.4 localStorage keys in v1

`ct:name`, `ct:muted`, `ct:shake`, `ct:motionPerm`, `ct:token:<code>`, `ct:host:<code>`, `ct:resume`. v2 uses `bgb:*` (`bgb:device`, `bgb:seats:<code>`, `bgb:host:<code>`, `bgb:resume`, `bgb:bag:<bank>`, `bgb:cfg:<game>`, `bgb:narration`) but `DiceCup.js:59-60` still reads `ct:shake` and `ct:motionPerm`, which keeps existing users' iOS grant memory. All repos of one GitHub user share one origin (`pych0413.github.io`), so prefixes must stay unique.

---

## 6. Locks and the `diceUnlockSeq` reconciliation

### 6.1 Two locks, two meanings (memory: do not conflate)

| | Role card lock | Dice cup lock |
|---|---|---|
| What it refuses | the **peek** (a friend grabbing your phone sees nothing) | the **roll** (nobody re-rolls for a better number); you can still look at your own dice |
| Encoded in | `LOCK_BLOCKS_PEEK = { role: true, dice: false }` (`app.js:372`) | same |
| Who unlocks | the owner, toggling (`game.js:201-204`) | **only the host**, "unlock all" (`game.js:213-225`); players cannot self-unlock (`game.js:206`) |
| Look | full dark scrim with a big padlock: `.locked::after` (`styles.css:414-422`) | small corner padlock: `.pinned::after` (`styles.css:424-428`) |
| Cleared by | `deal()` (`game.js:149`), owner toggle | `rollFor` for that player (`game.js:166`), host unlock-all |

Locking a role card closes every open cover straight away (`app.js:568`). Pressing a locked role cover shakes it, plays `deny`, buzzes, and toasts (`app.js:379-387`).

### 6.2 Local latch and reconciliation (`app.js:562-595`)

```js
requestLock(what,on): S.lock[what]=on (optimistic) → host: game.setLock / client: send {t:'lock'} → buzz, sfx → render

syncLocks(st):                       // called from pushState (host), welcome, state
  me = st.players[myId]
  if (st.diceUnlockSeq > S.seenUnlockSeq)           // host opened every cup
       { S.seenUnlockSeq = st.diceUnlockSeq; S.lock.dice = false }
  else if (client && S.lock.dice && !me.diceLocked) // host never heard my lock
       send {t:'lock', what:'dice', on:true}
  else S.lock.dice = me.diceLocked                  // host is truth
  if (client && S.lock.role && !me.roleLocked) send {t:'lock', what:'role', on:true}
  else S.lock.role = me.roleLocked
```

Why each branch exists:

- **Re-send instead of adopt.** A phone that locked while briefly offline must not be unlocked by the first stale `state` it receives after reconnecting. Locks are idempotent on the host (`setLock` early-returns when nothing changes, `game.js:202, 206`).
- **`diceUnlockSeq`.** Re-sending would also fight the host's legitimate unlock-all. The counter, bumped only in `unlockAllDice` (`game.js:221`), lets a phone tell "host cleared my lock" (counter moved: drop the local latch) from "host never received it" (counter unchanged: re-send).
- **Seed.** `S.seenUnlockSeq` is seeded from the first state (`welcome`, `app.js:762`) and from the game on the host (`wireGame`, 691), so history is not treated as news. It resets in `leaveRoom` (896). The counter survives host refresh (`snapshot` 286, `restore` 305).
- **Host phone.** Skips the re-send branches (host state is the truth) and just mirrors `me.*Locked`.
- **`secret` handler.** On every `secret` message the client clears both local latches (`app.js:786`) because a fresh card or roll is a new object to protect. Any lock the host still holds is restored by the next `state` message (`S.lock.* = me.*Locked`). `rollAll` clears locks the same way without bumping the counter, which is intentional: a fresh roll is a new object.

### 6.3 Scenario table

| Scenario | Result |
|---|---|
| Client locks dice while offline, reconnects | `welcome` has `me.diceLocked=false`, counter unchanged → re-sends lock ✓ |
| Host presses 解鎖骰盅 | counter +1 → every client clears its latch ✓; `btn-unlock-dice` disabled when no cup is locked (`app.js:348`) |
| Client unlocks role while a stale `state` (still locked) arrives | `S.lock.role=false` so no re-send; falls to the `else` → shows locked again until the host processes the unlock and re-broadcasts. If the unlock message was lost, the card stays locked; the user taps again. Unlock is best-effort, lock is sticky. |
| Host re-deals | host clears `roleLocked` only; the client's `secret` handler clears both locally, then the next `state` re-asserts `diceLocked` |
| One player re-rolls | `revealDice = false` for **everyone** (`game.js:167`) |

### 6.4 What v2 does instead

`custom/game.js` keeps `roleLocked`, `diceLocked`, `rollSeq` per seat in engine state and sends them in each seat's view (`myView`, 540-555). Actions are `lock-role {on}`, `lock-dice`, `unlock-dice {pid?}`, `roll`, `roll-all` (412-512). `Cover` and `DiceCup` take `locked` / `lockedRoll` as props and keep no local latch. Consequences:

- No optimistic local state, so no reconciliation and no `diceUnlockSeq`. A lock is real only when the host applied it.
- A dropped `act` is lost silently: `app.act` returns `false` when `clientT.send` fails (`client.js:546`). The UI must say so (§11 G4). v1's "re-send on reconnect" guarantee is gone unless someone adds a retry.

### 6.5 Where the v1 README disagrees with v1 code, and where v2 changes rules

- README:45 says "dealing or re-rolling unlocks automatically". In code, `deal()` does **not** clear `diceLocked` (`game.js:149`) and `rollFor` does **not** clear `roleLocked`. The client only appears to unlock for a moment; the next `state` restores it.
- v1 `deal()` / next-round does not clear dice at all. v2 `next-round` clears dice, dice locks and `revealDice` (`custom/game.js:489-499`); `redeal` keeps dice (483-487); `reveal-roles` clears role locks (473-481); `roll` is refused while `revealDice` is on (429) whereas in v1 any roll silently re-hid everyone's dice.
- These are probably improvements, but they are **rule changes**; confirm them.

---

## 7. Sound and shake wiring

### 7.1 Sound

- **Unlock.** `sfx.js` creates and resumes its AudioContext inside a capture-phase `pointerdown` handler (35). `sfx()` returns silently if muted or the context is `suspended` (143), because audio scheduled into a suspended context all fires at once on resume. The mute button, when turning sound **on**, calls `primeAudio(); sfx('tap')` (`app.js:1065`).
- **Mute.** One global `muted` flag toggles the master gain (`setMuted`, 39-42). The preference is persisted by the app (`ct:muted`, `app.js:1052-1066`), not by `sfx.js`.
- **Platform facts (documented, not bugs).** Safari has no `navigator.vibrate`, so `buzz()` (`util.js:78-80`) is silent on iPhone; feedback is sound + animation. Safari routes Web Audio through the ringer switch (README 81-88).
- **Triggers in v1:**
  - Local gestures: cover open → `lift` (dice) or `flip` (role) (`app.js:391`); locked press → `deny` (384); roll → `roll` (445); lock/unlock → `lock`/`unlock` (567).
  - State-driven (`chimeForState`, `app.js:602-614`): the first state a phone receives is history and stays silent. Then lobby→playing = `start`, round change = `deal`, `revealRoles` false→true = `reveal`, lobby head-count growth = `join`. A same-round re-deal (`deal({nextRound:false})`) is silent because only `round` is compared.
  - Secret-driven (`chimeForSecret`, 616-633): keyed on `diceSeq`, not on the dice values. A deal re-sends the same dice and must not rattle the cup; a re-roll to the same number must. A roll this phone made itself is suppressed for 1,200 ms (`lastLocalRoll`, 630).

### 7.2 Shake

1. `ShakeDetector` (`shake.js`) plus a `shaker` instance in `app.js:467-492`: three jolts over 10 m/s² inside 1 s, 90 ms spike collapse, 1.5 s cooldown.
2. `syncShake()` (494-540) runs on every `renderGame`. It starts or stops the detector, and paints the button and note for each state: unsupported, permission denied, armed, off, stalled.
3. The button handler `onShakeButton()` (542-557) calls `requestMotionPermission()` as its **first await** (iOS only grants from inside the tap). It persists `ct:motionPerm` and `ct:shake`.
4. `onShake` (469-474) rolls only if on the game screen, `isPlayer`, and `dice.self || host`. It goes through the same `doRoll()` as the button (440-448), which, if locked, calls `nudgeLocked()` (451-462, throttled to once per 2.5 s).
5. `onNoSensor` (480-487): armed but silent for 2.5 s. On iOS this resets the remembered grant to `unknown` (a lapsed grant, not missing hardware) and points the user back at the button.
6. `denied` is sticky in Safari, so the note explains how to re-enable it in site settings (502-509).

v2 moved this into `DiceCup.js`: one shared detector "hub" for all cups on the page (56-124), `wantsShake()` and `visible(c)` so that only the on-screen cup rolls (65-77), and the same first-await rule (109-124).

---

## 8. Deployment

### 8.1 Hosting

- GitHub Pages "Deploy from a branch", `main`, `/ (root)`. Live URL today: `https://pych0413.github.io/cheese-thief/` (memory). The repo is `pych0413/cheese-thief`.
- **Planned (memory, user-approved 2026-10-03).** Rename the repo to `bgbox` (new URL `https://pych0413.github.io/bgbox/`) at the batch-1 release, then create a tiny new `cheese-thief` repo whose page redirects to `bgbox` and **keeps `?r=` room codes**. Implications:
  - The redirect page must forward the query and hash (a static `<meta refresh>` or fixed link drops `?r=`; use JS such as `location.replace(newBase + location.search + location.hash)`). `roomLink()` uses `location.origin + location.pathname` (`app.js:641`, `shell.js:174`) so it stays correct after the move.
  - Origin is unchanged, so `localStorage` is shared, but v1 data (`ct:host:*`) is not readable by v2 (`client.js:469` requires `snap.v === 2`). Never deploy v2 over a live v1 evening.
  - v1 never registered a service worker, so the old scope holds no stale worker.
  - Home-screen icons use `start_url: "./"`, which is path-relative, good.
- Pages quirks relied on: `.nojekyll` (no Jekyll processing), `.gitattributes` `* text=auto eol=lf` (keeps `#!/bin/sh` scripts LF on Windows). Some v2 files currently have CRLF on disk (e.g. `core/sfx.js`, `ui/dom.js`); Git normalises them on add.
- Pushing: per memory, `gh` is off PATH on this machine (`/c/Program Files/GitHub CLI/gh.exe`), account `pych0413`, and a hook blocks pushes to the default branch (use a branch + PR; the hook matches the whole command string).
- Known weak links: the public PeerJS cloud, the openrelay TURN servers, and the jsDelivr CDN for PeerJS and qrcode-generator are all third-party freebies.

### 8.2 Why `?v=` stamps (commit `4424804`)

GitHub Pages serves everything with `Cache-Control: max-age=600` and the header cannot be changed. For ten minutes after a push a recent visitor gets the **new** `index.html` against the **old** CSS/JS: a half-broken screen, worse than being wholly stale. Every asset URL and every relative module import therefore carries `?v=<stamp>`, so a fresh `index.html` can only pull the CSS/JS it shipped with. Verify a deploy with `curl` or a fresh browser context, because a browser that visited recently shows the old assets.

Caveat (see §11 G10): the stamp is only a cache key. GitHub Pages ignores the query and serves the latest file at that path, so an *old* page that lazy-loads a module after a push gets new code under an old stamp.

### 8.3 `tools/bump-version.sh` (working tree, 123 lines)

Usage: `tools/bump-version.sh [DIGITS] [--no-check]`. The default stamp is `date -u +%Y%m%d%H%M%S` (seconds, so two pushes in a minute never share a stamp). It is POSIX `sh`, with no `sed -i` and no `find`, to run under Git Bash.

1. Restamps every relative `.js/.mjs/.css?v=<digits>` reference found inside quotes, backticks or `(...)` (so absolute URLs such as `https://cdn…` are never touched) in `js/**`, `css/**`, `index.html` and `sw.js` (`PAT`, line 62).
2. Writes the stamp into `sw.js` `const VERSION` (the cache name includes it).
3. Regenerates `sw.js`'s `// BEGIN PRECACHE … // END PRECACHE` block from the file tree: `./`, `index.html`, manifest, `icon.svg`, `icons/*.png|svg`, `css/*.css`, every `js/**/*.js|css` with the new stamp (lines 84-108).
4. Runs `node tools/check-imports.mjs --same-stamp` unless `--no-check`; the exit status is the checker's.

v1's script was 15 lines of `sed -i` over `index.html` and `js/*.js` (non-recursive).

Dry run on a scratch copy at 07:11 UTC: 35 files restamped, 65 PRECACHE entries, 141 references on one stamp, then **13 `check-imports` errors** for modules that did not exist yet (`bag.js` banks, `registry.js` game folders, `custom/ui.js`). Mid-development use `--no-check`. `check-imports` also enforces: no missing target, no letter-case mismatch (Windows is case-insensitive, Pages is not), no bare specifiers, no root-absolute paths (they break under `/<repo>/`), a `?v=` on every `.js/.css` reference, and warns on files missing from PRECACHE.

### 8.4 `sw.js` (169 lines, new)

- Scope-relative (nothing hard-codes `/`): works at `/cheese-thief/`, `/bgbox/` and a root dev server.
- Navigations and `index.html`: network-first with a 3.5 s timeout, falling back to the cached shell (`shellFirst`, 127-142). Stamped assets and PRECACHE entries: cache-first (144-151). The `peerjs` and `qrcode` CDN files: cache-first in a separate cache, re-fetched with CORS so only good responses are cached (156-169). Everything else (signalling, STUN/TURN) is untouched.
- Updates: a new worker installs (all-or-nothing precache, 82-90) and **waits** until all tabs close, unless the page posts `skip-waiting` (103-107). It never swaps mid-game, so a running page keeps lazy-loading modules from the cache of the version it started with.
- On `localhost` it is a pass-through unless registered as `sw.js?force` (59-60).
- **Not registered yet.** No `serviceWorker.register` exists anywhere in `index.html`, `main.js` or `shell.js`. The snippet is only in the `sw.js` header comment (19-29). `PRECACHE` currently holds `./` and `index.html` (VERSION `'1'`) until `bump-version.sh` runs.
- It would precache all 14 data shards and the leftover v1 files, because the script walks `js/**`.

---

## 9. Behaviours that MUST be preserved

"v2 now" = what the working tree at 07:15 UTC does. ✓ carried · ✗ missing/regressed · ? not yet written or not checked.

| # | Behaviour | v1 source | Why | v2 now |
|---|---|---|---|---|
| 1 | `setPointerCapture` inside `try/catch`; peeking must work without it | `app.js:394-401` | it throws for pointers the browser no longer tracks; uncaught, the card silently never opens | ✓ `Cover.js:76-83`, `SeatEditor.js:68`; **Canvas must do the same** |
| 2 | `preventDefault` on `pointerdown`, `contextmenu` blocked, `user-select:none`, `touch-action: manipulation`, `-webkit-touch-callout:none` | `app.js:395`, `styles.css:372-377` | stops selection/callout/ghost clicks on long press | ✓ `Cover.js:76-88`, `base.css:249-256` |
| 3 | Release closes: `pointerup/cancel/leave`, `blur`, key-up | `app.js:402-412` | a card must never stay open | ✓ `Cover.js:84-96` |
| 4 | **Every cover closes on `visibilitychange` (hidden), window `blur`, `pagehide`**; also on a new deal/secret/round and when a role card is locked | `app.js:429-431, 568, 680, 772, 787` | never leave a card face-up when the phone is put down or handed over | ✓ `Cover.js:29-39` (`closeAllCovers` exported for seat switches) |
| 5 | **iOS motion permission: `requestMotionPermission()` is the FIRST await in the tap handler**; lapsed grant → `unknown`; `denied` → site-settings help | `app.js:542-557, 480-487, 502-509` | iOS only grants motion from inside a real tap | ✓ `DiceCup.js:109-124, 84-91, 199-204` |
| 6 | Shake tuning: 3 jolts ≥ 10 m/s² in 1 s, 90 ms collapse, 1.5 s cooldown; locked cup nudge throttled 2.5 s | `app.js:490-491`, `shake.js:42-56, 91-100`, `app.js:451-462` | a phone set down is one jolt; one shake = one roll | ✓ `DiceCup.js:70-75, 148-156` |
| 7 | One roll path for button and shake | `app.js:440-448` | the two paths cannot drift | ✓ `DiceCup.js:158-165` |
| 8 | **Roll chime keyed on a per-player roll counter, not on dice values**; first update is history; ignore own echo for 1.2 s | `game.js:162-164`, `app.js:616-633` | a re-deal re-sends the same dice (must stay silent); a re-roll to the same value is a real roll | ✓ `rollSeq` in `custom/game.js:381, 548`, `DiceCup.js:226-235` (also fixes the v1 `welcome` gap) |
| 9 | State chimes: first state is history; `start`, `deal`, `reveal`, `join` are edge-triggered | `app.js:602-614` | without the history rule, joining mid-game plays a fanfare | ? only `join` (`lobby.js:111`) and the vote `reveal` found; game UIs appeared at 07:20 UTC and were not checked |
| 10 | AudioContext created/resumed inside a real pointerdown; **never schedule into a suspended context (drop the sound)**; un-mute doubles as unlock | `sfx.js:21-35, 143`, `app.js:1065` | iOS starts contexts suspended; queued sounds burst on resume | ✓ `core/sfx.js`; ✗ `Timer.js:26-35` creates its **own** context and listener |
| 11 | No vibration on iPhone: all feedback is sound + animation; `buzz()` stays a harmless no-op | `util.js:78-80` | WebKit has no `navigator.vibrate` | ✓ (not used in v2 components) |
| 12 | Role lock refuses the peek (shake + `deny` + toast); dice lock refuses the roll but still allows a peek; players cannot unlock dice | `app.js:372-387`, `game.js:206` | the two locks guard different things | ✓ `Cover.js` `lockMode`, `custom/game.js:429-436, 450-467` |
| 13 | Lock survives a brief offline period; host unlock is distinguishable from "host never heard me" | `app.js:580-595`, `game.js:213-225` | see §6 | ✗ not re-implemented; offline `act` is dropped (G4) |
| 14 | Per-seat secret token, stored per room code, sent in every `hello`; deleted on reject | `app.js:757, 868-870, 794`, `game.js:54, 74-85` | refresh/sleep must not lose a seat | ✓ `client.js:210-212, 404-410`, `room.js:387` |
| 15 | Host snapshot restored under the **same room code**: reclaim peer id with back-off; restored players offline until hello; clients redial forever (≤ 6 s) | `net.js:59-89, 181-191`, `game.js:299`, `app.js:913-932` | the host phone reloads the tab far too eagerly | ✓ `client.js:455-496`, `room.js:98-100`; ⚠ heartbeat is 5 s + visibility/pagehide, not every change |
| 16 | `reject` stops the client's retry loop; a failed connect must close the net | `app.js:795` (v1 leaks on failed join, §4.5.6) | otherwise a zombie net spams the netbar | ✓ `client.js:235, 445-451` |
| 17 | Signalling watchdog: `peer.reconnect()` on `disconnected`, 5 s interval | `net.js:102-119` | signalling sockets die silently when a phone sleeps | ✓ `core/net.js` unchanged |
| 18 | STUN + public TURN in `config` | `net.js:18-26` | carrier-grade NAT on mobile data | ✓ unchanged |
| 19 | Room code = four dice 1-6, `makeRoomCode` crypto, host retries up to 14 on a taken id, join keypad is dice faces, `?r=` deep link | `util.js:10-12, 36-40`, `net.js:60-88`, `app.js:167-217, 1091-1099` | deliberate (memory) | ✓ `join.js`, `shell.js:297`; check `join.js` keeps the neon frame |
| 20 | Crypto randomness with rejection sampling for outcomes; no `Math.random` in rules | `util.js:15-34` | fairness | ✓ `engine-kit.cryptoRng`; `rint` has negligible float bias (< 2⁻²⁸ at n ≤ 16) |
| 21 | A phone never receives another seat's secret: public state is a whitelist; private data goes down one channel | `game.js:249-273` | core promise | ✓ `Room.#viewsFor` (`room.js:248-264`), engine `view()` whitelists, leak tests |
| 22 | Wake lock on while in a room; re-arm on return to foreground; host `beforeunload` guard | `util.js:100-114`, `app.js:1104-1113` | wake locks drop when the tab backgrounds | ✓ `client.js:298, 615`, `shell.js:311` |
| 23 | Coalesced pushes (one broadcast per tick) | `app.js:658-672` | avoids a message storm on `deal` | ✓ `Room.#batch` |
| 24 | QR: pinned `qrcode-generator@1.4.4`, loaded **on tap only**, SVG, text fallback | `app.js:638-653, 1034-1049`; commit `e68046e` | the earlier pinned build 404'd and loaded eagerly | ✓ `lobby.js:14-`; SW lib cache regex covers `/qrcode` |
| 25 | `?v=` on every relative import and asset URL; one stamp for the whole tree; `.nojekyll`, `eol=lf` | §8 | Pages `max-age=600` | ✓ `check-imports.mjs` |
| 26 | Never `skip-waiting` while in a room | `sw.js:13-17` | a swapped worker could serve half a new app | ? worker not registered yet |
| 27 | Layout: rem units, root `clamp(13px, 4.1vw, 19px)`, `#app` max 30rem, `100dvh`, safe-area insets, `viewport-fit=cover`, reduced-motion rule | `styles.css:34-62, 515-517`, `index.html:5` | UI scales with the phone | ✓ `base.css:46`, new `index.html:5` |
| 28 | Gradient ids in SVG art are unique per instance | `DiceCup.js:35` (v1 had one cup, one id) | `url(#id)` into a `display:none` SVG renders nothing; duplicate ids collide | ✓ |
| 29 | `restartAnim` trick (`classList.remove`; `void el.offsetWidth`; `add`) | `app.js:381, 459` | re-trigger a CSS animation | ✓ `dom.js` |
| 30 | `.cover-front` is `opacity: .001`, not `0`, while closed | `styles.css:402` | reason not documented; do not change without testing on iOS | ✓ `base.css:284` |
| 31 | Name rules: unique among connected, ≤ 12 chars, `autocomplete=nickname`; reconnect keeps the seat | `game.js:88-92`, `index.html:32` | | ⚠ `room.js:305` still `slice` on UTF-16 (G21) |
| 32 | Clients can only act for their own seats; `@`-prefixed host actions are refused | v1: the host ignored anything but 4 types | privilege boundary | ✓ `room.js:689-696` |
| 33 | Connection feedback: signalling lost (warn), host gone (error), 15 s connect timeout | `app.js:737-741, 862-867`, `net.js:165` | the only signal that a phone is offline | ✓ `client.js:310-314, 412-418`, 12 s welcome timeout |

---

## 10. State of the v2 tree (what is already built)

- **Pure engines + harness.** `engine-kit.js` (rng, shuffle, tally, seats, clone, `HOST`/`ACT`), `session.js` (clones before each call, deadlines, pause, cues, auto-act, ink validation, snapshot), `tests/lib.mjs` (`Sim`, `makeBag`, leak helpers). 221 tests pass (spyfall, 9upper, custom, cheese-thief, narrator).
- **Host room + app facade.** `room.js` (players, devices, lobby, scoreboard, stall detection, snapshot v2, protocol), `client.js` (`createApp`, entry points, resume, clock sync with min-RTT offset), `transport.js` (`PROTOCOL = 2`), `narrator.js` (speech with a length-based fallback timer, `prime()` in taps), `bag.js`.
- **UI.** `shell.js` with `home/join/lobby` screens and the shared components. Game UIs were just starting to appear at 07:20 UTC (`games/{custom,9upper,cheese-thief}/ui.js`; `index.js` only for `custom` and `9upper`; `undercover` and `spyfall` still engine-only). They were not reviewed here, so the game-screen chimes and lock UI (§9 #9, #12) are unchecked.
- **Delivered but unregistered.** `sw.js`, `manifest`, PNG icons.
- **v2 protocol as implemented (differs from DESIGN §8; see G5):**
  - Client→host: `hello {v, deviceId, seats:[{name, token?}]}`, `act {pid, action, rev}`, `ink {pid, stroke, pts, end?, op?...}`, `lobby {op: color|leave|addSeat, ...}`, `ping {c}`, `bye`.
  - Host→client: `welcome {v, device, seats:[{id,name,token}], room, views}`, `room`, `views {rev, hostNow, bySeat, table, focus, cue?}`, `ink`, `inkSync`, `pong {c, hostNow}`, `notice {text}`, `reject {reason}` (also used for kick, dissolve, version mismatch).
  - A device may own several seats; a claimed `deviceId` is honoured only if the seat tokens prove it (`room.js:402-410`).

---

## 11. Gaps and contradictions in `docs/DESIGN.md` relative to the code

Severity: **H** will bite soon, **M** decide before release, **L** note.

### Contradictions with existing behaviour

- **G1 (H) Engine `setup` has no host identity.** §4 gives `players: [{id, name, seat, color}]` (lines 107-109) but the v1 concept of a card-less moderator host (`hostPlays=false`, `game.js:21`) needs it. `custom/game.js:578-582, 401-405` invents `hostPid` / `players[i].isHost` / first-seat fallback, and `tests/lib.mjs:77` passes none. Add `hostPid` to the `setup` contract and to `Sim`.
- **G2 (M) Head-count model changes silently.** v1 fixes `maxPlayers` at room creation and requires an exact match to start (`game.js:127-136`; stepper 2-16 at `app.js:990-991`). DESIGN derives `n` from the lobby (§3 `config.defaults(n, prev)`, §5). That is intentional, but §0/§5 never say that "choose player count at creation" disappears, or that role configs must follow head-count changes (`Room.#afterHeadcount`, `room.js:520-523`).
- **G3 (M) Lobby disconnects.** v1 deletes a disconnected lobby player (`game.js:107-110`). DESIGN §5 says the seat is always kept. `Room.peerClosed` (`room.js:364-374`) keeps it everywhere, so a closed iOS tab (no `bye`) leaves a ghost seat that still counts toward `n` and can be dealt a hand. DESIGN should state the lobby rule (drop after a grace period, or host must kick) and `start()` should refuse or warn when a seat is offline.
- **G4 (H) Lock reconciliation and offline actions.** DESIGN §10 mentions the lock modes but not the reconciliation (§6). In v2 it is not needed, but "no optimistic local state" becomes a rule nobody wrote down, and `act` has no ack or failure feedback (`client.js:546`). Specify: the UI shows "冇送到 / 重連緊" instead of pretending, and decide whether `lock-*` actions queue for retry.
- **G5 (M) §8 is stale versus `room.js`/`client.js`.** Missing: `v` on `hello`/`welcome` and the version `reject`; `device` in `welcome`; `bye`; `notice`; `ping.c`/`pong.c`; `lobby` ops (`color`, `leave`, `addSeat`); `reject` as kick/dissolve; `inkSync` size limits; `ink` batch shape (`session.js:36-58`).
- **G6 (L) `act.rev` has no semantics.** §8 lists it; `room.js:354` ignores it. `rev` is only used on the client to drop stale `views` (`client.js:185`). Define it or drop it.
- **G7 (M) PeerJS namespace unchanged.** `core/net.js:13` still uses `cheesethief-v1-`. The `v` handshake makes cross-version joins fail politely, except that a v2 client dialling a stale v1 host makes that host seat a ghost "玩家" (v1 `join` with `name` undefined). Consider `bgbox-v2-`.
- **G8 (M) Key namespaces.** v1 `ct:*`, v2 `bgb:*`; `DiceCup` reads `ct:shake` / `ct:motionPerm`. Fine (it keeps iOS grants), but document which keys are legacy-on-purpose. Also `ct:muted` has no v2 home yet.
- **G9 (M) Snapshot cadence and size.** §5 says snapshot "on every change"; `client.js` uses a microtask queue plus a 5 s heartbeat plus `visibilitychange`/`pagehide` (161-171, 299, 612-619). `Session.snapshot` includes `ink` (up to 3,000 strokes × 6,000 points, `session.js:25-27`), while `makeStore.set` swallows quota errors (`util.js:105-124`). On iOS (≈ 5 MB) a big drawing could silently stop saving and a later resume would restore an old snapshot. Add a size check with a visible warning, and drop ink first.
- **G10 (H) Stamps are not immutable URLs.** §13 says static and dynamic imports carry `?v=`. On Pages the query is ignored, so a page started before a push that lazy-loads a game module or bank gets **new** code under its **old** stamp. That can produce two instances of one module (`Cover`'s `covers` set, `DiceCup`'s shake hub, `sfx`'s context). The service worker is the only guard (it serves the running page from the cache of its own version), and it is **not registered yet** and absent on first visit. Mitigations: register it; never `skip-waiting` in a room; include a build stamp in `hello`/`welcome` so mismatched peers warn; state a deploy rule ("no pushes during play"). iOS in-app browsers (LINE, WhatsApp, Instagram) generally do not run service workers (verify), so add an "open in Safari" hint.
- **G11 (H) Bank layout.** §12/§15.5 name single files (`undercover-words.js`, `spyfall-locations.js`, `draw-words.js`, `9upper-terms.js`). On disk the content is sharded in `js/data/parts/` (undercover u1-u3, spyfall s1-s3, draw d1-d8 so far) and only `undercover-words.js` exists at top level, holding 291 of 777 pairs. `bag.js:29,34,39` import three files that do not exist, so `check-imports` and `bump-version.sh` fail. Needed: a merge step (a tool, or `bag.js` loading the shards) and a rule that shards are not precached twice.
- **G12 (M) Draw-bank key uniqueness is unenforced.** At 07:03 UTC the draw shards held 1,642 words with only 1,590 unique `w`: 52 words sat in two shards (e.g. 龜兔賽跑 in d1 and d7), contradicting the shard header ("each word appears in exactly one category") and breaking `key: e.w` (`bag.js:35`). By 07:20 UTC the shards had been edited to 1,867 words in 47 categories (d1-d8), all unique, with levels 1/2/3 = 673/790/404. Nothing guards it, so add a test or merge-time assertion for unique `w` (and for unique undercover words and spyfall names). Undercover: 777 pairs, all 1,554 words unique ✓. Spyfall: 156 locations, 7 roles each, names unique ✓.
- **G13 (M) Night-mute vs user mute.** §4 says non-host phones mute SFX at night. `sfx.js` has one `muted` flag and the app persists it as the user's preference; `Timer.js:39` reads `isMuted()`. A night mute that calls `setMuted(true/false)` would overwrite a user's saved mute. Add a separate "suppressed" flag. Also fold `Timer.js`'s private AudioContext into `sfx.js` (it now has `warn`, `zero`).
- **G14 (M) Duplicate DOM helpers.** `core/util.js:49-76` (`$ $$ el toast`) vs `ui/dom.js:8-82`. `util.toast` silently does nothing without a `#toast` element; the two `el()`s differ on `value`, `style` objects and kid flattening. Keep only `ui/dom.js`.
- **G15 (M) Threat model is missing from DESIGN.** Principle 2 ("a phone only receives what its player may know", §1) holds for clients, but the host device holds everything, and `custom`'s `modSees` moderator view shows all roles by design (`custom/game.js:644-647`). v1's README and memory state the host-can-peek trade-off; DESIGN should too, plus: locks are local protection only; the 4-dice room code is guessable (1,296), so decide whether lobby joins need a PIN or host approval.
- **G16 (L) Registry duplicates each game's `meta`** (`registry.js:10-12`) and has already drifted: `custom` is 🎲 / `[5,30]` / `通用派牌＋骰盅` there versus 🎴 / `[5,180]` / `通用派牌 + 骰盅` in `custom/game.js:303-316`. Make `game.js` the single source (pure and light) or generate the registry.
- **G17 (L) Names.** DESIGN calls the game 芝士大盜; v1 calls the role 芝士小偷 and the presets "Cheese Thief". The `custom` presets (`cheese`, `cheeseGang`) use invented roles (偵探, 守衛) and will confuse players once the real `cheese-thief` game exists.
- **G18 (H) Single-device play must not depend on PeerJS.** DESIGN §13 promises one-phone play offline. v1 replaces the whole page if `window.Peer` is missing (`app.js:1116-1121`) and loads PeerJS as a blocking script (`index.html:278`). The new `index.html:35` uses `defer`, good; make sure `app.local()` and the home screen never touch `Peer` (only `net.js:35` does) and show a "multi-phone needs internet" message instead.
- **G19 (M) v1 lobby features missing from DESIGN §5/§10/§15:** copy link, QR code, `?r=` deep link, wake lock, `beforeunload` guard, "leave room" confirm, the resume card. The new shell has several; the spec should list them.
- **G20 (M) Two-tab testing.** §14 says "two-tab runs", but identity is stored in `localStorage` (`bgb:seats:<code>`, `bgb:device`), shared by tabs. A second tab that sends the same tokens takes over the first tab's seat (`room.js:387-417`). Use two browser profiles or a private window, or add a `?as=` storage namespace for testing.
- **G21 (L) Player names are cut on UTF-16** (`room.js:305`; v1 `app.js:811,847`, `game.js:88`), which can split an emoji. `custom/game.js:92-99` already has a grapheme-safe cutter; reuse it.
- **G22 (L) Times.** DESIGN says "All times in this repo are UTC" (line 4). `hhmm()` (`util.js:82-84`) renders on-screen log times in the viewer's local zone. Clarify that the rule covers docs/logs/specs, not what players read on screen. v2's custom log carries a sequence number, not a clock.
- **G23 (M) Large messages.** PeerJS `json` serialization sends one string per message; there is no chunking. `inkSync` (`room.js:284-288`) and `welcome` are unbounded. Some browsers cap an SCTP message at tens to hundreds of KB (verify on iPhone Safari). Cap or chunk `inkSync`; actions are already capped at 8 KB (`room.js:32`), ink batches at 400 points (`session.js:27`).
- **G24 (L) Modal scroll lock.** `lockScroll` only toggles `body.modal-open { overflow: hidden }` (`dom.js:68-75`, `base.css:68`). iOS Safari often still scrolls the page behind a sheet; verify with `PassGate` and `RulesSheet`.
- **G25 (L) Canvas checklist (not yet reviewed):** pointer-capture try/catch (§9 #1), `pointercancel` ends the stroke, `touch-action: none`, callout off, keep a margin from the left screen edge (iOS back-swipe), `devicePixelRatio`-aware backing store.
- **G26 (L) Dev ergonomics.** `.claude/launch.json` still names the server `cheese-thief`. The service worker is a pass-through on localhost, so the offline path is only tested with `sw.js?force`. `bump-version.sh` fails mid-development unless `--no-check`.
- **G27 (M) Release plumbing for the rename.** DESIGN has no section on the `/bgbox/` move: redirect page (carry `?r=` and hash), README/clone URLs, `sw.js` scope, a decision not to ship v2 mid-evening, and what happens to Home-Screen apps (iOS keeps a separate storage container per home-screen app).
- **G28 (L) Leftovers.** v1 files (`js/app.js`, `game.js`, `roles.js`, `net.js`, `util.js`, `sfx.js`, `shake.js`, `styles.css`) and `README.md` are still in the tree and precache list; v1 and v2 stamps are mixed until `bump-version.sh` runs (`check-imports` reported 12 refs on `202609190342` and 34 on `1` at 07:05 UTC).

### Already resolved in the v2 tree (verify when touching)

Unauthenticated broadcast (§4.5.1); kicked devices keep their connection (§4.5.2); failed-join zombie net (§4.5.6); `welcome` not priming the roll counter (§4.5.5); no protocol version handshake (now `v`, though not in DESIGN); Node-safe `sfx`/`shake`; `-webkit-touch-callout`; PNG icons and a PNG-based manifest; a deferred PeerJS script.
