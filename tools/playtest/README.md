# Playtest console (`pt.mjs`)

One headless Chrome holds one 390x844 "phone" window per seat (mobile metrics, DPR 2). A small daemon keeps the CDP
sessions alive, and every player drives only its own phone through a CLI, the way a person holds one phone. With
`--shared` there is ONE phone for the whole table instead (一部手機玩, see the last section). No packages;
Node 22+ (global `WebSocket`) and Chrome or Edge (set `PT_CHROME` to point at another binary).

```
node tools/playtest/pt.mjs help          # the full command list
node tools/playtest/pt.mjs selftest      # checks the console itself against a local page, then cleans up
```

## Orchestrator: set a table up

```
node tools/playtest/pt.mjs start t1 --seats p1,p2,p3 [--base URL] [--names 阿聰,阿明,小美] [--shared]
node tools/playtest/pt.mjs setup t1 --game cheese-thief [--config '{"k":"v"}'] [--narration silent|read|voice]
...players play...
node tools/playtest/pt.mjs eval  t1 p1 "return window.__app.state.room.lastResult"   # final result only
node tools/playtest/pt.mjs stop  t1
```

`start` opens the seats (the first seat is the host). `setup` has the host open a room, the other seats join it, and the
host picks the game, config and narration mode. Session names are letters, digits, `-` and `_`. Runtime state lives in
`tools/playtest/.sessions/` (git-ignored); screenshots go to `<tmp>/bgbox-playtest-shots/<session>/`.

Pick **`--narration voice`** for games with an eyes-closed night (cheese-thief, werewolf, onuw, avalon's night) and
`read` or `voice` for the rest. Every phone has a fake text-to-speech (see "The narrator" below), so 🔊 語音 works
headless and the eyes-closed seats hear the narrator. For an eyes-closed night, 📜 讀稿 needs a person who is not
playing to read the lines, and the console has none. On a one-phone table the app refuses 🔇 靜音 for eyes-closed games (`setup` then reports
`"narrationSet": false`).

## Player commands

Every command is `node tools/playtest/pt.mjs <command> <session> <seat> ...`. Each one prints what the phone shows afterwards.

| command | what it does |
|---|---|
| `see` | The screen: title, visible text, overlays that cover the screen, and numbered controls. |
| `tap <n or "label">` | Tap control `n`, or the first control whose label contains the text. Numbers are re-assigned on every `see`/`tap`, so use the latest list. |
| `hold <n or "label"> [ms]` | Press and hold (hold-to-peek covers). Prints the screen while the finger is down, then lets go. |
| `type <n or "label"> <text>` | Focus a text box and replace its content. |
| `draw <n> "x,y x,y ..."` | Drag a finger across a canvas, with 0-1 coordinates. |
| `scroll <dy>` | Scroll the page (px, negative = up). |
| `key [Enter\|Escape\|Backspace\|Tab]` | Press a key. With a dialog open, Enter accepts and Escape dismisses. |
| `wait [sec=25]` | Block (at most 90 s) until this phone's screen changes or somebody speaks at the table (a player or the narrator), then print the screen and what was said meanwhile. |
| `dialog accept\|dismiss [text]` | Answer a native `confirm()` / `prompt()` (see below). |
| `reload` | Reload this phone's tab. |
| `shot` | Save a PNG screenshot of this phone and print its path. |
| `say <text>` / `hear [n]` | Talk at the table (everyone hears it) / read the last `n` things said, the narrator's lines included (`🔊 旁白：…`). |
| `show [off]` | `--shared` only, holder only: lay your screen face up for everyone (see the last section). |

Orchestrator only: `start`, `setup`, `stop`, `eval`.

Flags on controls in `see`: `disabled`, `selected`, `open`, `above-screen` / `below-screen` (scroll to reach it), `COVERED`
(something else sits on top of its centre, so a tap would hit that instead).

In the screen text, a picture with a label says it in brackets: a die face reads `[4 點]`, but only while it is
uncovered. A progress bar says its value (`[⏳ 仲有 8 秒]`) when the app gives it one. A pass gate prints
`[pass gate: private|switch|anon|public|table]`. A public card (`public` / `table`) also prints the screen behind it
under `--- behind the card ---`, because that screen stays visible. Its controls are not listed, because the card
blocks them.

## The narrator (fake text-to-speech)

Headless Chrome has no voice, so every phone gets a fake `speechSynthesis` before the app loads. It offers one
Cantonese voice (`模擬粵語（playtest）`, zh-HK). Each line "takes" a time based on its length and fires start and end like
a real engine, so 🔊 語音 runs as it does on a phone and the narrator never stalls.

Every line spoken out loud lands in the table talk as `🔊 旁白：…`. That is how a player with eyes closed hears their
call: read it with `hear`, or just `wait`, which wakes on every new line. Silent utterances (volume 0, the app's iOS
priming) are not heard. In multi-phone play, a line spoken by a phone other than the host's is marked
`🔊 旁白（阿明部機）：…`, because the whole table hears that too.

## Native dialogs

`window.confirm()` / `prompt()` / `alert()` are what a real phone shows as modal dialogs, so the console treats them the same way.

- **confirm / prompt** freeze the page, like on a phone (on the host phone that also stalls the room, so guests start to
  drop after a few seconds). `see` shows the dialog instead of the page:

  ```
  == p1 阿聰 | dialog open | scroll - ==
  [dialog] confirm "公開所有人嘅骰？"
  the page behind it is frozen until this is answered — on the host phone that stalls the whole room
  --- controls ---
  [1] button "OK" (accept)
  [2] button "Cancel" (dismiss)
  answer: dialog <session> p1 accept|dismiss   (or tap 1 / tap 2, key Enter / Escape)
  ```

  Answer with `dialog <session> <seat> accept|dismiss [text]` (the text is for `prompt`), or `tap 1` / `tap 2` / `tap ok` /
  `tap cancel`, or `key Enter` / `key Escape`. **Nothing is auto-accepted:** the player reads the text and chooses.
  Any other tap while a dialog is open is refused with a note, because a modal dialog also swallows touches on a phone.
  A dialog that opened after your last screen (say, on a timer) is shown first: `tap 1` or `key Enter` meant for the page
  never answers a dialog you have not seen.
- A `tap` that opens a dialog returns at once, showing the dialog. It never waits for the page's click handler.
- **alert** is dismissed automatically and reported once on the next screen as `[alert] "…" — dismissed automatically`.
- **beforeunload** is accepted automatically so a reload can go through, and reported the same way.
- `reload` with a dialog open dismisses it first (leaving the page abandons its dialog) and says so.
- `eval` and `shot` fail fast with a clear message while a dialog is open, instead of hanging behind it.
- Other seats are never blocked by one seat's dialog.

## Reloading and phone metrics

Use `reload`, never a reload through your own CDP connection. `reload` goes through the daemon's session and re-applies the
phone metrics (390x844, DPR 2, focus emulation). Phone metrics belong to the daemon's CDP session: a second client that
reloads the tab, sets its own metrics, zooms the page or sets an emulation `scale` can leave this seat's taps in the wrong
place (in the custom playtest they landed at half the coordinates while `innerWidth` and DPR still read right). So before
every `tap` / `hold` / `type` / `draw` the console checks the viewport, hovers the target and asks the page where it felt
the pointer. If either is off it puts the phone back (metrics, zoom) and checks again; if the pointer still lands
elsewhere it refuses the tap with a message instead of tapping blind. That is a safety net, not a licence to drive CDP
yourself.

After a reload the app starts from its home screen, like closing and reopening a tab. Get back into a room through the UI,
the way a person would (for example the resume button).

## Fair-play rules for AI players

You are one person at a table with one phone. These keep the playtest honest, so findings mean something.

1. **One seat, one phone.** Run commands for your own seat only. Never `see`, `tap` or `shot` another seat, even though the
   console would let you.
2. **Player commands only.** Use the commands in the table above. `start`, `setup`, `stop` and `eval` belong to the
   orchestrator. Do not read page state in any other way (JS variables, `window.__app`, storage, network traffic, the DOM
   beyond what `see` prints).
3. **No back doors.** Do not open DevTools, a CDP connection or another browser, and do not read `tools/playtest/.sessions/`
   or other seats' screenshots and output while the match is running.
4. **Only a person's information.** What you know comes from your own phone and from what is said out loud at the table
   (`say` / `hear`). There is no private channel between seats. Do not pass secrets any other way, and do not act on
   anything you could not have seen or heard from your seat.
5. **Secrets stay secret.** Read hidden roles, cards, words and results the way a person does, for example with `hold` on a
   hold-to-peek cover. Do not read engine code, tests or earlier playtest reports to learn hidden facts about the current
   match. Reading a game's rules to learn how to play is fine.
6. **Play at human pace.** One action at a time, through visible controls. Use `wait` for something to change instead of
   hammering `see`. Do not script timing to exploit windows no person could hit.
7. **Answer dialogs yourself.** Read the dialog text and pick. Do not accept by reflex. Answer promptly, as a person would,
   because the page is frozen until you do.
8. **Do not paper over app problems.** If a control is dead, covered or confusing, try what a person would try (scroll, tap
   by label, `reload`), then report what you saw, what you tried and when. Do not work around it with `eval` or script clicks.
9. **Report what your phone showed.** Quote the on-screen text, name the seat and the moment, and say whether it could be a
   console artifact (see below) before calling it an app bug.

## Known console quirks (so they are not reported as app bugs)

- `selected` is a heuristic: `aria-pressed`, or the class `on` / `selected` / `is-on`. A control that uses one of those
  classes for something else (for example "can be tapped now") shows as selected. Trust a screenshot when in doubt.
- Before every `tap` / `hold` / `draw` the target is scrolled to the middle of the screen. A page that shows an offset
  after that is showing the console's scroll, not its own.
- Text inside a folded `<details>` is not on screen and is left out of `see`. The text view flattens grouped layouts
  (a vote tally's bars and voter chips come out as lines of text); use `shot` for layout questions.
- Headless Chrome has no real vibration, audio or on-screen keyboard. Speech is the fake narrator above: its timing is
  an estimate, not a real voice's. Sound effects, including the one-phone night noise bed, are not heard at all.
- One phone, one finger: the console runs one command at a time per phone (a `tap`, a `shot`, a look). With `--shared`
  every seat queues on the same phone, so a command can wait a moment for another seat's command. A `hold` keeps the
  phone for its whole press. `wait` takes the phone only for each look.

## Housekeeping

- `stop <session>` closes the session's Chrome and removes its profile (`<tmp>/pt-<session>-…`, about 60 MB). If a run
  was killed half way, leftover test Chromes carry `pt-<session>-` in their `--user-data-dir`. Stop only those (match that
  profile name, and the process name `chrome.exe`); do not touch a person's own Chrome.
- `start` begins with an empty `hear`. A table talk log left by an earlier session of the same name is kept as
  `.sessions/<session>.chat.<UTC time>.jsonl`, so an orchestrator can still read it, but no player hears it.
- `selftest` starts its own session with two seats on a local page. It exercises a modal whose card is still fading in
  (read) with a closed cover inside it (not read), dialogs, the fake narrator (`hear`, and `wait` waking on talk),
  concurrent commands on one phone, reload, metric drift, an outside `scale` override and
  page zoom. Then it stops and checks that no Chrome, daemon, session file or profile is left behind. Run it after any
  change to `pt.mjs`, together with `node tests/run.mjs playtest` (the referee's rules, the fake narrator, the lock).

## One shared phone (`--shared`)

`node tools/playtest/pt.mjs start <session> --seats p1,p2,p3,p4 --shared` opens ONE phone window for the whole
table. `setup` makes it a 一部手機玩 room (`app.local`) holding every seat in table order; the first seat is the host.
Every player still uses their own seat id. A referee follows the app's own one-phone contract (DESIGN §7.1) and
decides, before every command, what this person may see and touch. Each screen starts with one line saying why.

| where the phone is (what the app shows) | who sees it | who may touch it |
|---|---|---|
| **In the middle, face up** (no seat on screen: chip 「📱 枱中間 — 㩒你個名睇自己」), and the lobby and results | everyone | anyone. Table controls such as 大家睇完 count for the whole table. In a name list (the chip's 「邊個要睇自己？」, a 「邊個…？」 sheet), only your own name. |
| **Held by a seat** (「而家睇：X」) | only X | only X |
| …during X's public step (`focus.open`: a stroke, a speech) | everyone, read-only | only X |
| …after X used `show` | everyone, read-only, until it ends (see below) | only X |
| **Table card** `[pass gate: table]` (「📱 部手機擺返中間」, 「☀️ 天光喇」) | everyone, with the screen behind | anyone, one tap |
| **Public card** `[pass gate: public]` (「輪到 X · …」) | everyone, with the screen behind | the card: only X |
| **Private card** `[pass gate: private / switch]` (「交俾 X · 其他人唔好望」) | everyone sees the card, nothing behind it | only X |
| **Eyes-closed card** `[pass gate: anon]` | only the seats this step calls (a decoy: nobody) | those seats |
| **At night or in a secret step** | only the seats the step calls, once one of them holds the phone. Everyone an eyes-closed step calls shares one screen (U2); a named step at night goes seat by seat, so only the holder looks. | those seats |

- Everyone else gets 「📱 X 拎緊部手機」 or, at night, 「🌙 你閉緊眼」 with the narrator's last line, and nothing else:
  no card title, no names. Listen with `hear` / `wait`. When the narrator calls your role, `see` and tap the card.
- `tap` returns the screen as *you* may see it afterwards. Once you hand the phone on, you see the gate card or nothing.
- To look at your own screen by day, tap the chip in the middle (「揀名 ⇄」), pick **your own** name and tap your gate.
  When you are done, put the phone back with 「📱 擺返中間」, so the next person does not have to ask for it.
- The holder can `show <session> <seat>` to lay their screen face up for everyone; `show … off` takes it back. The
  show ends by itself as soon as that screen moves on (a new step, a new holder, a header change, a gate, nightfall),
  so a public screen that turns private never stays face up.
- **A seat that does not respond (T5).** Under a named card the host's phone shows 「X 唔喺度？」, which opens
  ⏭ 跳過佢 / 💤 當佢缺席 / 🤖 代佢做. Only the host seat may tap that row, and its actions only after the card has been
  up for 60 s (set `PT_ESCAPE_AFTER=<sec>` in the environment of `start` to change it). First call the person out loud with `say` and wait.
  Every tap on that row goes into the table talk, because everybody sees it:
  「📱 阿聰（房主）喺交接卡「交俾 小美」㩒咗「💤 當佢缺席」」.
- `wait` waits on what *you* may know: the phone reaching you, a card naming you, a change on a face-up screen, or a
  new line from the narrator or the table.
