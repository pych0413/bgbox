# One-phone playtest: summary (2026-10-04, UTC)

Each game was played once, with every seat on one shared phone (`tools/playtest/pt.mjs --shared`, one 390x844 window passed round the table, build `20261004005209` = HEAD `16da24d`). The AI players took turns holding the phone, and a referee let only the holder touch it. One opus reviewer per game checked every finding against `docs/research/<id>.md`, the flow docs and the code. Per-game reports are in `docs/playtest/single/<id>.md`.

**Findings:** 101 confirmed: 2 blocker, 30 major, 42 minor, 27 polish. Another 131 were rejected, mostly as AI pace or console artifacts.

**Matches:** 8 of 10 finished. The other two froze at a pass gate when one AI seat stopped responding: 9upper after 2 of 4 rounds, and avalon at the Quest 4 vote. That freeze is an AI artifact, but it exposed a real gap (#18). The rules engine was correct in every game, at every step played.

## What already works on one phone
- Deal walks, hold-to-peek with relock, per-reader gates, and secret ballots each behind their own gate.
- The anonymous night gate appears at every step, including decoys.
- No step ever waited on a seat that could not get the phone.

## What breaks, across games
1. **The phone never goes back to the middle.** The shell has no seatless "table" state, so after a private walk the screen stays on whoever touched the phone last.
   - At dawn this names the last night actor. That is both blockers.
   - By day, the public screens (reveal, tally, location list, 開盅) sit on one seat's private screen.
2. **The gate cannot tell public steps from private ones.**
   - Public steps that belong to one person (a stroke, the leader's vote reveal, the 諗樣's reveal) get the private 「其他人唔好望」 gate.
   - Private steps that start on the seat already on screen get no gate at all.
3. **"One tap" means different things.** One person's 睇完 closes a reveal for the whole table, while 夠鐘投票 needs every seat to hold the phone.
4. **The eyes-closed night does not fit one phone yet.**
   - 靜音 cannot work.
   - The time to pick up the phone comes out of a 15–18 s window.
   - Two wolves cannot both get the phone.

## Verdict per game

| game | finished | playable on one phone? | private enough? |
|---|---|---|---|
| cheese-thief | Yes: 5p, ~17 min, the thief escaped (+2), every ruling correct | **No.** 3 of 4 lone-sleepyhead peeks were lost inside the 15 s hour (#7). 靜音 cannot work (#6). The day needs every seat to tap 夠鐘投票 (#5). | **No (blocker).** Dawn opens on the last night holder, names them with 「而家睇：X」 and leaves their 📓 and role covers live. In 6–8p that seat is always on the thief's team (#1). |
| undercover | Yes: round 1, civilians won, ~14 min | **Barely.** Nothing sends the phone to the middle (#1). The last voter's one 睇完 closes the reveal for everyone (#5). | **Mostly.** The first ballot after a public step opens with no gate (#2), and 「睇返我個詞」 works on the public screen (#22). |
| spyfall | Yes: the spy stopped at 4:31 and guessed right (+4) | **Awkward.** The play phase has no table screen, so the phone went to every person asked: 7 questions took ~7.5 of 12 min (#1). 🙋 and 🕵️ act as the seat on screen (#13). | **No.** A phone laid in the middle exposes that seat's card, and a new round's look opens with no gate (#2). |
| 9upper | No: 2 of 4 rounds (an AI seat went silent at a gate) | **Half.** The reads work. The talking half breaks: nobody can be marked ✅ 已講 (#11), the reveal stays with the 諗樣 (#4, #5), and 換人 bounces back (#9). | **Yes for reads.** Turning off 一部手機輪流睇 silently breaks them (#12). |
| onuw | Yes: the Werewolf team won, correctly | **No.** Both night actions lapsed, because the window includes picking up the phone (#7). 靜音 and 讀稿 break the night (#6). Two wolves or Masons cannot both act (#8). | **No.** Dawn leaves the Robber's private screen face up with his name on the chip (#1), and his ballot opens ungated (#2). |
| werewolf | Yes: good won in ~32 min, after 2 days and a PK | **No.** Speeches, 遺言, 我講完 and 💥自爆 never reach the speaker (#10). The wolf hand-over failed both nights, and on night 2 the dead wolf got the gate, giving 空刀 (#8). | **No (blocker).** Every dawn the chip names the last night role, which was the seer on this board (#1). |
| avalon | No: stopped at the Q4 vote (an AI seat went silent at a gate) | **Clunky.** Public reveals and results go to the leader behind 「其他人唔好望」, and nothing says to show the table (#4). A seat that steps away freezes the table (#18). | **Not quite.** The leader's ballot opens ungated after a public step, and a neighbour read a pending vote (#2). Holding time is a tell (#14). The identity mini-card shows on public screens (#22). |
| fake-artist | Yes: 1 round, the fake escaped, the rules held | **Yes, but** every stroke is handed over behind the private gate, 18 times a round, covering the public drawing (#4). One 睇完 closes the tally for everyone (#5). | **Secrets yes.** The first ballot opens with no gate (#2). |
| draw-guess | Yes: 4 turns, but only 2 had a drawing (scoring exact) | **Only if the drawer knows to lay the phone flat**, and the app never says so (#16). The clocks run behind a gate nobody has tapped (#23). | **Mostly.** The offers open ungated when the drawer is already on screen (#2), and the peek chip shows the word on a face-up phone (#22). |
| custom | Yes: 1 round, ~11 min, no stall | **Clunky.** The walk covers only the peek, so dice took 5 manual hand-overs (#15). | **No when laid down.** The only screens are seats' own, so the host's card and cup open at one touch (#1, #22). |

## Prioritized fixes (all games)

Effort: S ≤ half a day · M ≈ 1 day · L = several days, tests included. Items that share a shell or core root cause are merged into one row; the games column lists every game it fixes.

| # | sev | games | title | effort |
|---|---|---|---|---|
| 1 | **blocker** | SHARED shell: cheese-thief, werewolf (both blockers), onuw, undercover, spyfall, fake-artist, custom, 9upper, draw-guess | No phone-in-the-middle state: dawn names the last night actor, and public screens sit on one seat | L (dawn slice S–M) |
| 2 | major | SHARED shell: undercover, spyfall, onuw, avalon, fake-artist, draw-guess, custom, werewolf, cheese-thief | No gate when a private step starts on the seat already on screen | S–M |
| 3 | major (enabler) | SHARED shell: all | Games cannot tell they are on a shared phone, and cannot hand the phone over | S |
| 4 | major | SHARED core+shell: fake-artist, avalon, 9upper, werewolf, draw-guess | Public one-person steps get the private 「其他人唔好望」 gate | M |
| 5 | major | SHARED: undercover, spyfall, fake-artist, 9upper, cheese-thief, onuw | One tap closes a reveal for everyone, yet 夠鐘投票 needs every seat | M |
| 6 | major | SHARED lobby: cheese-thief, onuw, werewolf | 靜音 (and onuw 讀稿) break the eyes-closed night on one phone, with no warning | S–M |
| 7 | major | cheese-thief, onuw | Night windows include picking up the phone, so peeks and actions lapse | M |
| 8 | major | werewolf, onuw, cheese-thief | Several wakers in one secret step: only the first gets the phone (in werewolf, even a dead wolf) | M–L |
| 9 | major | SHARED shell: 9upper, draw-guess, cheese-thief, werewolf | 換人 bounces straight back by day, and at night it strands or names the waker | S–M |
| 10 | major | werewolf | Speeches and 遺言 never hand the phone to the speaker | S–M |
| 11 | major | 9upper | Nobody can be marked ✅ 已講; 下一位 marks a skip and starts a second lap | S |
| 12 | major | 9upper | 一部手機輪流睇 can be turned off in a one-phone room | S |
| 13 | major | spyfall | 🙋 指控 and 🕵️ 我係間諜 act as the seat on screen | M |
| 14 | major | avalon | One-phone mode drops the equal-time reveal, so holding time is a tell | S–M |
| 15 | major | custom | The walk covers only the peek, so dice need manual hand-overs | S–M |
| 16 | major | draw-guess | Nothing tells the drawer to lay the phone flat in the middle | S |
| 17 | minor | SHARED shell: avalon, fake-artist (+#8) | The walk restarts at seat 1 instead of going round from the holder | S |
| 18 | minor | SHARED shell+core: avalon, 9upper | A gate for a seat that stepped away has no way out | M |
| 19 | minor | ALL | One-phone wording pass, and the missing 「一部手機玩」 rules | M (S per game) |
| 20 | minor | ALL | 「（你）」, 「你贏咗」 and 「輪到你」 shown to the whole table | S |
| 21 | minor | spyfall, draw-guess | Config ignores singleDevice: spyfall defaults to 手機投票, and typed draw-guess is allowed | S |
| 22 | minor | undercover, avalon, custom, draw-guess, spyfall | Private bits left on screens that lie face up | S each |
| 23 | minor | draw-guess | The pick and drawing clocks run behind a gate nobody has tapped | M |
| 24 | minor | onuw | The ring vote costs an extra hand-over and cannot be decided in turn | S–M |
| 25 | minor | onuw | Reaching for the phone is heard at live steps and missing at centre steps | M |
| 26 | minor | SHARED shell: avalon | The new holder lands mid-page after a hand-over | S |
| 27 | minor | avalon | The assassination gate closes eyes before evil has talked | S |
| 28 | minor | avalon | Merlin is told about a Mordred who is not in play; 「佢哋」 is used with one partner | S |
| 29 | minor | fake-artist | In 開口估 the phone goes to the judge while the caught fake needs the picture | S |
| 30 | minor | fake-artist | Sequential ballots let early voters steer the rest out loud | S |
| 31 | minor | spyfall | The 「發問中」 badge sits on the person who is still answering | S |
| 32 | minor | undercover | 「平民一個自己人都冇投錯！」 is false when a civilian voted for a civilian | S |
| 33 | polish | SHARED shell: undercover, cheese-thief | The gate does not say which step it opens or how far the vote has got | S |
| 34 | polish | SHARED shell: 9upper | The pass gate fades in from fully transparent | S |
| 35 | polish | SHARED shell: fake-artist | ⏭ is in reach of whoever holds the shared phone | S |
| 36 | polish | cheese-thief | The decoy name grid and the unexplained 🔓 lock on a shared phone | S |
| 37 | polish | fake-artist | 輪 is used for round, turn and lap; 輪到你 shows only for the last voter | S |
| 38 | polish | draw-guess | Queue preview, canvas width, 最快反應, the grace banner, lobby help | S |
| 39 | polish | custom | Carried over: face-up card after 開晒角色, 「點解會咁」 / 贏 0, silent armed buttons | S |
| 40 | polish | onuw | The ring-vote help does not say what "nobody dies" means | S |

### 1 · blocker · SHELL: no phone-in-the-middle state
- **Games:**
  - Blockers: cheese-thief (dawn), werewolf (dawn).
  - Major: onuw (dawn), undercover C1 and C2, spyfall C1 and C5, fake-artist F7, custom C2.
  - Partly: 9upper C2, draw-guess D1.
  - Minor: werewolf (the tally, 遺言 and dawn stay with the last holder).
- **Why (one phone):** Whoever touched the phone last keeps it.
  - At dawn the chip 「而家睇：X」 names the last night actor: the seer every morning in 狼人殺, the thief or a follower in 6–8p 芝士大盜, the Robber in 一夜狼人. That seat's 📓 and role covers are one hold away for anybody.
  - By day, the public screens sit on one seat's private screen. The table either passes the phone for every look or exposes that seat, and the last voter's single 睇完 closes the reveal for people who never saw it.
- **Root cause:**
  - `js/ui/screens/play.js:344`: when focus names none of this phone's seats, the shell only closes the gate, and `activeSeat` stays.
  - `play.js:628-635` paints 「而家睇：${name}」.
  - `js/core/client.js:1140-1144`: `activeSeat` persists, and `currentSeat` falls back to `mySeats[0]`, so there is no seatless state.
  - `play.js:92-101` (`viewFor`) always renders a seat, although `core/room.js:387-392` already sends local devices the seatless `st.table`.
  - The engines leave focus null at dawn, day and reveal: cheese-thief `game.js:399-420`, werewolf `game.js:1285-1312`, onuw `game.js:1218`, undercover `game.js:1448-1461`, spyfall `game.js:1309-1322`, fake-artist `game.js:1298-1310`, custom `game.js:821-823`.
- **Fix:**
  - Add a seatless table state on a phone with 2+ seats: `activeSeat = null`, chip 「📱 枱中間 — 㩒你個名睇自己」.
  - Enter it automatically on every night→day switch, and whenever focus goes from this phone's seats to none outside the night. Put a neutral card in front that anyone can tap: 「☀️ 天光喇 — 部手機擺返中間」 / 「📱 擺喺枱中間 · 大家一齊睇」.
  - Render `st.table` there, and add 「🀄 放喺枱中間」 to the 換人 sheet. Leaving the table for a seat goes through the normal gate.
  - Each game needs a public-only table view with nothing private on it:
    - cheese-thief: timer, 想投票
    - onuw: `buildTable` already has it
    - werewolf: dawn result, speaking order, 票型
    - undercover: order, reveal
    - spyfall: clock, floor card whose seat grid sends `ask`, location list, 🛑 (#13)
    - fake-artist: tally and result
    - 9upper: reveal (with #4)
    - custom: roster, 開盅, revealed roles
  - **Ship the dawn slice first: it alone clears both blockers.**
  - Test: on a shared phone, the dawn holder and chip are the same for every role assignment.
- **Owner:** `js/ui/screens/play.js`, `js/core/client.js`, and each game's `ui.js` table view. **Effort:** L (dawn slice S–M).

### 2 · major · SHELL: no gate when a private step starts on the seat already on screen
- **Games:** undercover C3, spyfall C3, onuw C2, avalon C2, fake-artist F2, draw-guess D3, custom C2(4), werewolf (the holder votes first), cheese-thief (the vote starts with no public card).
- **Why:** A tap on 開始投票 or 睇完, or the last stroke, drops whoever is touching the phone straight into the current seat's private ballot, card or word offers, on a screen the table may be watching.
  - In avalon, 阿強 read 小美's pending 「確定：贊成」.
  - A new spyfall round opens someone's role on the table phone.
  - In onuw and werewolf, the vote order follows the night.
- **Root:** `play.js:344`: `if (!here.length || here.includes(seat))` opens no gate.
- **Fix:** Remember the previous focus signature and whether the step was public. When focus moves into a private named step, gate `here[0]` even if it is the seat on screen: 「交俾 X（投票）· 其他人唔好望」. "Moves into" covers three cases: from no focus, from an `open` step (#4), or to a new step for the same seat (avalon pick→vote, voted→quest). With #1 most cases resolve themselves, but keep the explicit rule for same-seat step changes.
- **Owner:** `js/ui/screens/play.js` plus a test. **Effort:** S–M.

### 3 · major (enabler) · SHELL: games cannot tell they are on a shared phone
- **Games:** every game. Needed by #5, #7, #13, #15, #16, #19, #20 and #22.
- **Why:** No game can change its wording or controls for one phone, or hand the phone to a named seat. For example, custom's last seat is never told the phone goes back to the host (custom C3).
- **Root:**
  - `play.js:103-108` (`ctxFor`) and `:221-247` (`makeApi`) carry no shared flag.
  - Engines get `singleDevice` only through `config.*(…, env)` (`core/room.js:776-817`). `core/session.js:156` (setup) gets none.
- **Fix:**
  - Pass `shared = mySeats.length > 1` in ctx and api.
  - Add `api.handTo(pid)`, which runs `openGate('switch', pid)`.
  - Where engines or cues need to know, set a hidden `cfg.passPhone` in `config.defaults` from `env.singleDevice`: fake-artist, draw-guess, onuw, cheese-thief.
- **Owner:** `js/ui/screens/play.js`; each game's `config.defaults`. **Effort:** S.

### 4 · major · CORE+SHELL: public one-person steps get the private gate
- **Games:** fake-artist F1 (every stroke) and F6 (開口估), avalon C1 (pick, vote reveal, quest result), 9upper C2 (reveal), werewolf speeches (#10), draw-guess D1 (optional).
- **Why:** Some steps belong to one person but are meant to be watched by everyone.
  - 假畫家 says 「其他人唔好望」 18 times a round and covers the drawing the game is about.
  - Avalon's leader gets the public vote reveal behind 「其他人唔好望」, and nothing tells them to show it. In 靜音 the table learns the votes only if the leader shows the phone, and the leader could misreport.
  - In 9upper, the 諗樣 reads the reveal alone, and 下一輪 works at once.
- **Root:**
  - `js/core/room.js:87-99`: `filterFocus` cannot carry a public flag.
  - `play.js:346-350`: there is one gate wording for every step.
  - The engines return a plain `{pids:[x]}`: fake-artist `game.js:1304`, avalon `game.js:1117-1119`, 9upper `game.js:1089-1091`, draw-guess `game.js:1311-1314`.
- **Fix:**
  - Engines return `focus { pids:[x], open:true }`, and `filterFocus` passes it through.
  - On a shared phone, the shell then shows a light hand-over that does not cover the screen: 「輪到 ● 小美 畫 · 大家一齊睇 · 小美㩒一下開始」 / 「交俾 隊長 X — 公開畫面 · 擺喺枱中間」.
  - Keep the private gate for the deal, vote, guess and judge steps.
  - Hide identity hold-covers on open steps (avalon mini-card, fake-artist re-peek).
  - A step change from open to private triggers #2.
  - For the 9upper reveal, also lock 下一輪 per #5. Update fake-artist spec §4.
- **Owner:** `js/core/room.js`, `js/ui/screens/play.js`, `js/ui/components/PassGate.js`, and the engines of fake-artist, avalon, 9upper, werewolf and draw-guess. **Effort:** M.

### 5 · major · SHARED: "the table taps once"
- **Games:** undercover C2, spyfall C5, fake-artist F7, 9upper C2, cheese-thief (day flow), onuw (夠鐘投票 and 睇完整個結果).
- **Why:** There are two opposite failures.
  - (a) A tap that should mean "we've all read it" is one person's tap. The last voter's 睇完 closed the undercover reveal for 3 people who never saw it, and did the same to spyfall's role table and fake-artist's tally. Meanwhile the screen still says 「睇完 0 / 5 · 等緊：…」.
  - (b) A tap that needs every seat cannot happen on one phone. Cheese-thief 想投票 never got past 1/5. Onuw 夠鐘投票 counts only the seat on screen, and a non-host's 睇完整個結果 waits for the host.
- **Root:**
  - undercover `ui.js:403` and `:27` (LOCKOUT_MS 1500)
  - spyfall `ui.js:590-596`, `:606-611`
  - fake-artist `ui.js:797`, `:892-893`
  - 9upper `ui.js:631-666`
  - cheese-thief `game.js:533`, `:809-811` (`allPresent(dayReady)`)
  - onuw `dayAct` and `game.js:901-905`
- **Fix:**
  - One rule for a phone that holds every seat: a table tap counts for every seat on the device (`withMates`), but only from the table state (#1) and after its card is dismissed.
  - Label it 「大家睇完 ✓（一下就得）」 and drop the n/m waiting list.
  - Day-ready: any holder's tap is the table's decision. Either send it for all device seats, or the engine accepts `{type:'day-ready', all:true}` in a singleDevice room.
  - Onuw reveal: any seat on the host device can finish it, with a two-tap confirm.
  - Build it once as a core helper, which multi fix #20 already asked for.
- **Owner:** `play.js` (a table-tap API), plus `ui.js` and `game.js` in undercover, spyfall, fake-artist, 9upper, cheese-thief and onuw. **Effort:** M.

### 6 · major · LOBBY: 靜音 (and onuw 讀稿) break the eyes-closed night
- **Games:** cheese-thief, onuw, werewolf.
- **Why:**
  - With eyes closed and no voice, nobody knows when their hour or role is called.
  - With eyes open, everyone sees who reaches for the phone.
  - In onuw 讀稿, the reader has to take the phone back, eyes open, at every step.
  - The help line even says 「唔使閉眼，望住自己部機」.
  - The app defaults to 語音, so a table has to pick 靜音 itself, but nothing warns them.
- **Root:**
  - `js/ui/screens/lobby.js:444`: a generic note with no one-phone check, shown only for narration `required` (onuw is `recommended`).
  - `js/ui/logic.js:166` dims the in-focus seat in silent mode, even on a shared phone.
  - Own-phone help lines: cheese-thief `ui.js:530-533`, onuw `script.js:800`.
  - `docs/games/werewolf.md:15` claims 靜音 works because every phone shows the line.
- **Fix:**
  - In a singleDevice room, default eyes-closed games to 🔊 語音 (a meta flag such as `sharedNarration:'voice'` for onuw).
  - Hide 🔇 靜音, or warn in the lobby and on 開始: 「一部手機玩唔好用靜音：大家閉埋眼就聽唔到報時 — 用🔊語音，或者搵個唔玩嘅人📜讀稿」 (for onuw: 語音 only).
  - If 靜音 stays, stop dimming the in-focus seat on a shared phone and use the one-phone help lines.
  - Correct the werewolf doc.
- **Owner:** `lobby.js`, `logic.js`, game meta, `docs/games/werewolf.md`. **Effort:** S–M. **Decision U1.**

### 7 · major · Night windows include picking up the phone
- **Games:** cheese-thief (3 of 4 peeks lost), onuw (the wolf's centre peek and the Robber's swap both lapsed).
- **Why:**
  - The deadline starts when the gate appears. Reaching for the phone with eyes closed, tapping the gate, reading, picking and confirming must all fit in 15–18 s.
  - The bar starts full whenever the seat's UI mounts, so the waker cannot see time already gone. A name picked but not confirmed is silently dropped.
  - The window just ends, and onuw's lapse note reads like declining: 「今晚你冇用能力」.
- **Root:**
  - cheese-thief: `game.js:266-275` (deadline at window entry), `:114` (SHARED_HOUR_SEC 15), `ui.js:547` (`bartotal = dl - now`), `ui.js:454` (two-tap peek).
  - onuw: `game.js:537`, `:353-361`, `:85`, `ui.js:381-397`.
  - `play.js:332-340` opens the gate at the same moment.
- **Fix:**
  - On a single device, add a fixed hand-over pad to every window, the same at every step whether or not anyone is awake (anti-tell holds). Cheese-thief hour 15→20 s; onuw +8 s per step kind. Set it through the hidden cfg from #3.
  - Put `windowMs` in `view.step` and draw the bar from it, with seconds shown (`role=progressbar`, 「仲有 N 秒」).
  - Show 「⏰ 時間到 — 部手機擺返中間，閉眼」 on the dim for the seat whose window ended.
  - Cheese-thief on a shared phone: make the peek one tap and shorten the awake card.
  - Onuw lapse note: 「今晚你冇確定（時間到或者唔想用）」.
- **Owner:** cheese-thief `game.js`, `ui.js`; onuw `game.js`, `ui.js`, `script.js`; shell dim text. **Effort:** M. **Decision U6.**

### 8 · major · Several wakers in one secret step
- **Games:**
  - werewolf: night 2, the dead wolf was first in line, giving 空刀; night 1, the hand-over was unexplained.
  - onuw: two wolves or two Masons.
  - cheese-thief (minor): a shared hour walks in seat order, so a thief who owes a pick can come last.
- **Why:**
  - The anonymous gate goes to the lowest seat in focus, dead or alive.
  - The second waker gets the phone only if the first finds 換人, which names the teammate on the card and eats an 18 s window.
  - The rules point to a ⋯ → 換人 that does not exist.
  - Werewolf lost both night kills to this.
- **Root:**
  - `play.js:311-315` (`focusSeatsHere` re-sorts by seat) and `:333-341` (only `here[0]` is gated).
  - werewolf: `game.js:1297-1299` (dead wolves are listed; the list shrinks only on 確定), `script.js:195`, `:603`, `:617`.
  - onuw `game.js:1054`; cheese-thief `game.js:414`.
- **Fix:**
  - Everyone awake at the same step may see each other, so on a shared phone render one combined night screen for every waker of that step on the device:
    - Wolves agree by pointing, and one 確定 ends the step.
    - Onuw wolves and Masons see 「隊友：X」 together.
    - Cheese-thief co-wakers see the thief's pick live.
  - If a chained walk is kept instead:
    - Honour the `focus.pids` order: living, unlocked seats first, and the seat that owes a pick first.
    - Say 「揀好㩒確定，部手機會叫下一隻狼」.
    - The dead wolf's decoy says 「㩒「跳過」，將部手機交返出去」.
    - Keep the gate count constant per step kind.
  - Lengthen these windows too (#7), and fix the one-phone rules text.
  - Test: a lone live wolf gets the phone first on night 2.
- **Owner:** `play.js`; werewolf, onuw and cheese-thief `game.js`, `ui.js`, `script.js`. **Effort:** M–L. **Decision U2.**

### 9 · major · SHELL: 換人 bounces back by day and strands or names the waker at night
- **Games:** 9upper C3 (major), draw-guess D5 (typed mode cannot work), cheese-thief (minor: a stray 換人 at night strands the waker), werewolf (minor: 換人 during a secret step names the person and can open any seat's night panel).
- **Why:**
  - On one phone, 9upper's role reminder, rePeek and 我講完 cannot be reached: switch to 小美 and the auto gate 「交俾 阿明」 covers her at once.
  - At night, one stray tap on the chip moves the phone to a seat that is not in focus. The opaque dim then swallows every tap for the rest of the hour.
  - Or the hand-over card reads 「交俾 阿珍」 to a table that should have its eyes closed.
- **Root:** `play.js:340-350` (the auto gate fires again right after a switch), `:334-335` (`gatedFor === sig`, so the waker is never re-gated), `:357` (the switch title always uses the name), `:414`, `:628-635` (the chip stays enabled during anonymous steps).
- **Fix:**
  - A hand-picked seat keeps the phone until the focus signature changes: store the signature at the switch, and skip the auto gate while it is unchanged.
  - During anonymous steps on a shared phone, disable the chip, or limit it to `focus.pids`, title the card with `focus.anonymous`, and let a switch clear `gatedFor`.
  - Fix 9upper spec §4.4.
- **Owner:** `play.js` and `docs/games/9upper.md`. **Effort:** S–M.

### 10 · major · werewolf: speeches and 遺言 never reach the speaker
- **Why:**
  - 6 × 60 s of speeches ran on the seer's screen.
  - Only the holder can tap 我講完 or 💥自爆.
  - The exiled 阿聰 never knew he had last words.
  - The 新手慢慢嚟 preset (speakSecs 0) stalls every speech (minor).
- **Root:** werewolf `game.js:1285-1312` (no focus for speech and words), `docs/games/werewolf.md:372-373`, `ui.js:485`, `:525`; preset `game.js:314`; `blocking()` at `:1352-1353`.
- **Fix:** On a single device, set focus for the speech and words runs to `{ pids:[c.pid], open:true }` (#4). That gives a public gate, 「交俾 X 發言」, so each speaker holds the phone and has 我講完 and their own 💥自爆 (the "own speech only" explode variant). Show the speaking order on the table view in between. Update flow doc §4.
- **Owner:** werewolf `game.js`, `ui.js`, flow doc. **Effort:** S–M, after #4.

### 11 · major · 9upper: nobody can be marked ✅ 已講
- **Why:** The 諗樣's 下一位 marks every speaker 跳過咗 and starts a second lap. After 45 s, speakers also show as 冇反應.
- **Root:** `game.js:889`, `:481-487`, `:498-517`, `:1086`, `:1108`; `ui.js:492-493`, `:499`.
- **Fix:**
  - With `cfg.passPhone`, 下一位 ends the turn as 講完 and is labelled 「✅ 講完 · 下一位」.
  - Add a small separate 「⏭ 佢唔喺度，跳過」.
  - In explain, `blocking()` names nobody.
  - Update spec §3.4 and §4, and the tests.
- **Owner:** `js/games/9upper/game.js`, `ui.js`, tests. **Effort:** S.

### 12 · major · 9upper: 一部手機輪流睇 can be turned off on one phone
- **Why:** Only the first 玩家 reads, so the 老實人 usually never sees the explanation.
- **Root:** `game.js:252` (`validate` ignores env), `:1084-1085`, `:417-431`.
- **Fix:** In `validate(cfg, n, env)`, a single device with `passPhone === false` returns ok:false: 「一部手機玩要開「一部手機輪流睇」…」. Alternatively, force it on in `norm()` and hide the field. Add a test.
- **Owner:** `js/games/9upper/game.js`, tests. **Effort:** S.

### 13 · major · spyfall: 🙋 指控 and 🕵️ 我係間諜 act as the seat on screen
- **Why:**
  - To accuse, you must first 換人 to yourself: 3 taps with the clock running.
  - If you skip it, you spend someone else's accusation.
  - A real spy who confirms on another seat gets silence.
  - Anyone can tap 🕵️ 停鐘 on the spy's seat and force the spy out, which works as a probe.
- **Root:** Actions are sent as `activeSeat`; spyfall `ui.js:321-356`, `:331-335`, `:352`; `game.js:1166-1171`.
- **Fix:** On the table screen (#1), one 🛑 停鐘 button: 「邊個要停鐘？」 → seat list → gate → that seat's 🙋 / 🕵️ / 取消. Everyone takes the same path, so it reveals no role. Until then, label the panels 「以 大熊 身分」 and add 「唔係你？先㩒『換人』揀返自己」.
- **Owner:** spyfall `ui.js` + #1. **Effort:** M. **Decision U3.**

### 14 · major · avalon: one-phone mode drops the equal-time reveal
- **Why:** In tap mode, `revealSecs` and `questSecs` are 0. A Servant is done in 2 s, while Merlin, Percival and evil read names, so holding time tells who has information. The rules text still promises equal time.
- **Root:** `game.js:218-219`; `ui.js:321-332`, `:503-507`; `script.js:149`, `:535`.
- **Fix:** With passPhone, set an equal per-holder minimum counted from the gate tap (reveal ~8 s, quest card ~4 s) with a fill ring. Correct the rules text.
- **Owner:** avalon `game.js`, `ui.js`, `script.js`. **Effort:** S–M. **Decision U9.**

### 15 · major · custom: the walk covers only the peek
- **Why:** `seen` fires on release, and the next gate opens at once. Rolling and locking then need about 2(N−1) manual hand-overs: 5 here, about 6 min.
- **Root:** `ui.js:194-199`; `game.js:820-823`; texts at `game.js:416`, `:461-462`, `:719`.
- **Fix:**
  - On a shared phone, do not send `seen` on release.
  - Put one button under the card: 「✓ 搞掂 · 交俾 阿明」. For the last seat it reads 「✓ 搞掂 · 交返俾房主 阿聰」 and uses #3 `handTo`.
  - Add the note 「要搖骰就而家搖、鎖埋先交」.
  - Update the texts and spec §4, and add a test.
- **Owner:** custom `ui.js`, `game.js`, `docs/games/custom.md`, `tests/custom.test.mjs`. **Effort:** S–M.

### 16 · major · draw-guess: nothing tells the drawer to lay the phone flat
- **Why:** Turns 1 and 3 gave the guessers no picture, mask, timer or hint. The pick note even says 「其他人隨即睇到你畫」.
- **Root:** `ui.js:382`, `:705`; `script.js:31-34`, `:94-96`.
- **Fix:** On a shared phone (#3):
  - pick note: 「揀好就將部手機平放喺枱中間，大家望住你畫」
  - drawer prompt: 「部手機平放喺枱中間畫 · 唔准講嘢、寫字同數字」
  - cuePlay: 「開始！部手機擺喺中間…」

  These replace existing lines, so no new tutorial appears. Optionally mark play as `open` (#4).
- **Owner:** draw-guess `ui.js`, `script.js`. **Effort:** S.

### 17–40 (minor and polish), in brief

- **17 · SHELL walk order** (avalon C4, fake-artist F3)
  - Problem: the vote walk starts at seat 1, so the phone crosses the table twice.
  - Fix: keep the engine's `focus.pids` order; for together walks, start after the holder. `play.js:311-315`, `:346-347`. S.
- **18 · SHELL+CORE: absent seat at a gate** (avalon C5, C6; 9upper C6)
  - Problem: the full-screen gate covers ⋯. Using 換人 to let others vote sends the next gate straight back. The host menu offers 代 X 做 for seats that are only queued.
  - Fix: add 「X 唔喺度？交俾下一位（Y）」 on together gates. After ~2 min, show a host-device 「佢唔喺度？」 that opens 💤 / 作廢 / 代佢做 without switching seat. In singleDevice rooms flag only the gated seat as idle. Never auto-pass. `PassGate.js:22-46`, `play.js:346-350`, `core/room.js:1476-1524`. M.
- **19 · Wording pass** (all games)
  - Problem lines include: 「用自己部手機」 (undercover cue, rules), 「望住自己部機」 / 「到時你部機會自動亮起」 (cheese-thief), 「收起電話」 / 「講完㩒我講完」 (9upper), 「同時投票」 / 「三、二、一，投！」 / 「其他人即時睇到」 (fake-artist), 「大家望住自己部電話」 (avalon), 「打開手機」 and the stale 「冇人醒嗰輪部機唔會彈交接卡」 (onuw), 「大家將部手機放喺面前」 and non-existent controls (werewolf), 「淨係你部手機見到」 (spyfall), lobby help (draw-guess), and custom's quick rule.
  - Fix: use #3 to swap in device-neutral or one-phone variants. Replace existing lines only; teaching stays behind 💡 / 📖 (multi D17). Add the missing 「一部手機玩」 rules sections (cheese-thief, spyfall) and correct the stale ones (onuw, werewolf). M overall, S per game.
- **20 · 「（你）」 / 「你贏咗」 / 「輪到你」 on shared screens** (all)
  - Problem: four losing players read 「🎉 你贏咗！」 on the onuw and cheese-thief over screens (minor). The other cases are polish.
  - Root: `results.js:286`, `lobby.js:501`, `:525`, `SeatEditor.js:105`, `:127`, `Scoreboard.js:50`, `VotePanel.js:102`, `play.js:616-620`, plus the game UIs (cheese-thief `ui.js:753`, `:765`; onuw `ui.js:524-558`; 9upper `ui.js:45`, `:651`; fake-artist `ui.js:63`, `:626`, `:878`; draw-guess `ui.js:61`, `:731`, `:750`, `:827`; spyfall `ui.js:81`; avalon `script.js:539`; werewolf `ui.js:64`).
  - Fix: use `me: null` when `mySeats.length > 1`, names instead of 你, and no 輪到你 badge. S.
- **21 · Config ignores singleDevice**
  - spyfall: `defaults(n, prev, env)` should pick voteMode `hands` (even over a carried-over `phone`), `validate` should warn, and the help should cover both options (`game.js:265-374`).
  - draw-guess: typed mode on a single device becomes a validate error, and spec §2/§4 lose the "it can be played" sentence (`game.js:259`, `:296`).
  - S.
- **22 · Private bits on face-up screens**
  - undercover 「睇返我個詞」: route it through `handTo` (`ui.js:609-628`).
  - avalon mini identity card: hide it on public steps (`ui.js:757-767`).
  - custom: re-latch the card after every peek (`ui.js:211-217`); put the 主持 👁 tags behind 「㩒住睇所有人角色（主持專用）」 (`ui.js:260-262`).
  - draw-guess canvas peek chip: use a hold Cover, 「拎起部機，㩒住睇個詞」 (`ui.js:279-321`).
  - spyfall: no strikes on the table screen (`ui.js:55`, `:511`).
  - Most of this goes away with #1. S each.
- **23 · draw-guess clocks behind an untapped gate** (D2)
  - Fix: on a whole-table phone, hold the room clock while a day-step auto gate is up, using the pause-safe deadline shift. Otherwise, show the countdown on the gate and use a 30 s pick. Not for night gates: #7 pads those. Spec §9. `game.js:24`, `:630`; `play.js:293-304`. M. **Decision U10.**
- **24 · onuw ring vote** (one phone)
  - Problem: the agreer is skipped and gets a second gate later.
  - Fix: a public 「全枱同意圈票？」 card at the start of the vote, or a fallback target in the same turn. Untick the ring as soon as a target is picked. `game.js:757-768`, `:1056-1061`. S–M.
- **25 · onuw pick-up sound**
  - Problem: at live steps you can hear someone take the phone; centre steps are silent.
  - Fix: in 語音 on a shared phone, play an ambient bed through every night window, the same for every step. The research's pass-around night is the long-term option. M. **Decision U8.**
- **26 · SHELL scroll to top after a hand-over** (avalon C10)
  - Fix: call `scrollTo(0,0)` when a gate resolves and on `switchSeat`. `play.js:293-304`. S.
- **27 · avalon: the assassination gate closes eyes before evil has talked**
  - Fix: with passPhone, show a public 「邪惡陣營商量」 clock first; a tap then opens the anonymous gate. `game.js:549-558`, `:1130`. S.
- **28 · avalon Merlin note**
  - Fix: choose the note from the public deck (all evil seen / Mordred in play / Oberon hidden). Use 「佢」 for a single partner. `script.js:514`, `:520`. S.
- **29 · fake-artist 開口估 on one phone**
  - Fix: the judge's note reads 「部手機擺喺中間俾 X 睇幅畫（答案冚住）；佢講完你先㩒住睇答案」, with the picture above the covered word. Mark the step `open` (#4). `game.js:1306`, `ui.js:704`, `:724`. S.
- **30 · fake-artist: sequential ballots let voters steer**
  - Problem: the fake accused 大熊 aloud while 3 seats were still to vote.
  - Fix: 「投票中 — 全部投完先好講」 on the shared ballot gate. A 一齊指 mode is **Decision U7**. S.
- **31 · spyfall 「發問中」 badge** on the person still answering
  - Fix: change it to 「答緊」 or 「輪到」. `ui.js:279`. S.
- **32 · undercover 「冇投錯」 is false**
  - Fix: 「平民一個自己人都冇投走！」; update `tests/undercover.test.mjs:1431` and spec §5.6. `game.js:1175`. S.
- **33 · SHELL gate subtitle**
  - Fix: show the public step and progress, e.g. 「其他人唔好望 · 第 1 輪投票 · 已投 2/5」 (undercover C8, cheese-thief vote progress). Leave it off anonymous gates. `play.js:350`, `:357`. S.
- **34 · SHELL: the pass gate fades in from transparent**
  - Fix: make the backdrop opaque from the first frame and fade only the card. `css/base.css:597-602`, `PassGate.js:43`. S.
- **35 · SHELL ⏭ in reach of any holder** (fake-artist F9)
  - Fix: on a whole-table phone, keep ⏭ only in ⋯, and name the effect in the confirm: 「跳過 = 未投嘅人當冇投」. `play.js:562`, `:599-606`. S.
- **36 · cheese-thief decoy grid and 🔓 lock on a shared phone**
  - Fix: dim the names and show 「睇完就㩒，部手機擺返中間」. Label the lock 「鎖住張牌，唔會㩒錯打開」, and hide it or keep it per seat. `ui.js:350`, `:520-522`, `:863`. S.
- **37 · fake-artist wording and badge**
  - Fix: use 局 for a game round. Pass `together` through `filterFocus`, so 輪到你 is not shown only to the last voter. `ui.js:126`; `core/room.js:97`. S.
- **38 · draw-guess polish**
  - Fix: show 「之後到：…」 on the reveal and standings; on a shared phone, give the canvas full width with the chips below it; show 最快反應 only for a solve in the first half of the turn; shorten the grace banner; make the 畫喺邊 help device-neutral. S.
- **39 · custom carried-over polish**
  - Fix: show the card face up after 開晒角色; set `linesTitle` 「今局嘅牌同骰」; hide 贏 on noScore nights; add a `.cu-btn.armed` style. S.
- **40 · onuw ring help**
  - Fix: add behind 💡 only: 「冇人死：有狼喺玩家入面就係狼人隊贏；兩隻都喺中間先係好人贏。」. S.

## Suggested order of work
- **Wave A, shell foundation (~2 days):** #1 dawn slice, #2, #3, #9, #17, #20, #26, #34. This clears both blockers and the ungated-ballot privacy hole in 8 games.
- **Wave B, table mode and public steps:** the full #1, then #4 and #5, then #10 and #13 on top of them.
- **Wave C, the night on one phone:** #6, #7, #8. Decide U1, U2 and U6 first.
- **Wave D, per-game majors:** #11, #12, #14, #15, #16, #21.
- **Wave E:** the #19 wording pass, then the remaining minors and polish.
- **Before the next one-phone run:** console fixes T1–T6 below, then U12.

## Needs the user's decision
- **U1** 靜音 on one phone for eyes-closed games (cheese-thief, werewolf, onuw): hide it (recommended) or only warn? Onuw 讀稿 too, or recommend one phone each when TTS is not available?
- **U2** Wolves, Masons and co-wakers on one phone: one combined night screen for everyone awake together (recommended), or a chained walk where 確定 passes the phone on?
- **U3** Spyfall 🛑 停鐘: freeze the clock while the phone changes hands and resume on 取消, or keep it running as the rules do?
- **U4** Table mode trigger: enter it automatically whenever focus leaves this phone's seats outside the night (recommended), or only at dawn plus a manual 「放喺枱中間」? Must the public card be tapped first?
- **U5** Whole-table taps: lock 睇完 / 下一輪 until the table card is dismissed (recommended), use a fixed ~4 s lock, or arm-then-confirm? Undercover 開始投票 on a whole-table phone: keep the single tap (spec), or add 「全枱傾夠未？再㩒一次」?
- **U6** Night hand-over pad on one phone: cheese-thief hour 15→20 s, onuw +8 s per step. Longer nights or lost actions?
- **U7** Fake-artist one-phone vote: keep sequential ballots with 「全部投完先好講」, or add a 一齊指 mode (3-2-1, one person enters the pointing, 4 fewer hand-overs)?
- **U8** ONUW long term: build the research's pass-around night as the one-phone mode, or keep the pick-up-from-the-middle night with an ambient sound bed?
- **U9** Avalon one-phone equal-time minimums: reveal ~8 s and quest card ~4 s, counted from the gate tap?
- **U10** Draw-guess: hold the room clock while a day-step gate is up (changes spec §9), or only show the countdown on the gate with a 30 s pick?
- **U11** Spyfall on one phone: hide the question tracker by default (ties to multi D7)?
- **U12** Re-runs: 9upper and avalon did not finish. Fix the console first (T1–T6), then re-run all ten one-phone tables with 語音 or 讀稿 after Waves A–B? Or re-run only those two now?

## Console (pt.mjs) issues that distorted these runs
- **T1** Public steps are hidden from non-holders unless the holder types `show`. This was the biggest distortion, in undercover, fake-artist, draw-guess, onuw, spyfall and 9upper. Fix: in `--shared` mode, treat the phone as face up (read-only for every seat) whenever there is no gate, it is not night, and focus names no seat or is `open`.
- **T2** Every run used 🔇 靜音, a harness choice; the app default is 語音. Cues are never echoed to `hear`. Fix: run night games with `--narration voice` and the rest with `read`, and echo each new cue as 「[旁白] …」.
- **T3** `see()` ignores elements under 5 % opacity, so a gate's target was shown the screen behind a still-fading gate (9upper). The overlay probe also reads a gradient backdrop as 0 % dark (9upper, avalon). Fix: treat `.c-passgate` and `[aria-modal]` as the modal at any opacity, and count `background-image` as opaque.
- **T4** A `shot` from another seat corrupts the holder's input at half scale, which caused the stray draw-guess lines. Fix: serialise every CDP call per phone.
- **T5** Only the named seat may tap a gate, so a silent AI seat froze 9upper and avalon for about 20 min. Fix: after N minutes, let the host tap for an idle seat with a public `say` line.
- **T6** `wait` does not wake on a public stage change or on chat, and its 120 s cap equals the agents' Bash timeout. About 3.3 s per `tap`, a `hold` cap of 8 s and no countdown text mean AI seats cannot fit a 15–18 s night window. Fix: key `wait` on the public header and chat length, cap it at 90 s, print 「⏳ 仲有 N 秒」, and add a `peek` op and multi-target taps.
- **Also:**
  - `show` outlives a phase change.
  - The console's scroll carries over to the next holder.
  - In werewolf the referee read the 「交俾 阿珍」 card aloud as narration, which became the main case against her, and gave her night-1 hand-over card to 阿聰.
  - Die faces (`role=img` labels) are not printed (cheese-thief, custom).

## Housekeeping
- No table is running. `tools/playtest/.sessions/` has no `sp-*.json` session files (only the `sp-*.chat.jsonl` logs), and no `pt.mjs` daemon process is alive, so nothing needed `pt.mjs stop`.
- At merge time, per-game reports exist on disk for 9upper, avalon, draw-guess, fake-artist, onuw and undercover. The cheese-thief, spyfall, werewolf and custom findings above come from the reviewers' structured output; their `single/<id>.md` files were not found.
- No code was edited.

## Decisions (user, 2026-10-04 10:45 UTC — "全部照你建議")

| # | decision |
|---|---|
| U1 | One-phone room + eyes-closed game (cheese-thief, werewolf, onuw): hide 🔇 靜音. Keep 📜 讀稿 with a warning that a non-player should read. |
| U2 | Co-wakers (wolves, Masons, any seats awake in the same secret step) share ONE combined night screen on a shared phone; no chained hand-over. |
| U3 | 間諜 🛑 停鐘 on a shared phone freezes the clock the moment it is tapped (from the table screen, then the tapper picks their name). |
| U4 | Table mode is automatic: whenever focus leaves this phone's seats outside the night, the phone goes to the middle behind a public 「擺返中間」 card that is tapped once. |
| U5 | Whole-table taps (睇完, 下一輪…) stay locked until the table card is dismissed. 誰是臥底 開始投票 on a whole-table phone needs a second tap. |
| U6 | Night hand-over padding: cheese-thief hour 15 → 20 s on one phone; onuw +8 s per step on one phone. |
| U7 | 假畫家 one-phone vote: a 一齊指 mode (3-2-1 countdown, everyone points, one person enters the result). |
| U8 | 一夜狼人 one-phone night keeps pick-up-from-the-middle, with an ambient sound bed on every step so reaching for the phone is masked. |
| U9 | 阿瓦隆 one-phone equal time: role reveal ≥ 8 s and quest card ≥ 4 s, counted from the gate tap. |
| U10 | 你畫我猜: the room clock does not run while a pass gate is up. |
| U11 | 間諜 on one phone: the question tracker is hidden by default. |
| U12 | Fix the playtest console first, then re-run all ten one-phone tables. |
