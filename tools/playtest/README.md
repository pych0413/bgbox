# Playtest console (`pt.mjs`)

One headless Chrome holds one 390x844 "phone" window per seat (mobile metrics, DPR 2). A small daemon keeps the CDP
sessions alive, and every player drives only its own phone through a CLI, the way a person holds one phone. No packages;
Node 22+ (global `WebSocket`) and Chrome or Edge (set `PT_CHROME` to point at another binary).

```
node tools/playtest/pt.mjs help          # the full command list
node tools/playtest/pt.mjs selftest      # checks the console itself against a local page, then cleans up
```

## Orchestrator: set a table up

```
node tools/playtest/pt.mjs start t1 --seats p1,p2,p3 [--base URL] [--names 阿聰,阿明,小美]
node tools/playtest/pt.mjs setup t1 --game cheese-thief [--config '{"k":"v"}'] [--narration silent|read|voice]
...players play...
node tools/playtest/pt.mjs eval  t1 p1 "return window.__app.state.room.lastResult"   # final result only
node tools/playtest/pt.mjs stop  t1
```

`start` opens the seats (the first seat is the host). `setup` has the host open a room, the other seats join it, and the
host picks the game, config and narration mode. Session names are letters, digits, `-` and `_`. Runtime state lives in
`tools/playtest/.sessions/` (git-ignored); screenshots go to `<tmp>/bgbox-playtest-shots/<session>/`.

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
| `wait [sec=25]` | Block until this phone's screen changes, then print it. |
| `dialog accept\|dismiss [text]` | Answer a native `confirm()` / `prompt()` (see below). |
| `reload` | Reload this phone's tab. |
| `shot` | Save a PNG screenshot of this phone and print its path. |
| `say <text>` / `hear [n]` | Talk at the table (everyone hears it) / read the last `n` things said. |

Orchestrator only: `start`, `setup`, `stop`, `eval`.

Flags on controls in `see`: `disabled`, `selected`, `open`, `above-screen` / `below-screen` (scroll to reach it), `COVERED`
(something else sits on top of its centre, so a tap would hit that instead).

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
- Headless Chrome has no real vibration, audio or on-screen keyboard.

## Housekeeping

- `stop <session>` closes the session's Chrome and removes its profile (`<tmp>/pt-<session>-…`, about 60 MB). If a run
  was killed half way, leftover test Chromes carry `pt-<session>-` in their `--user-data-dir`. Stop only those (match that
  profile name, and the process name `chrome.exe`); do not touch a person's own Chrome.
- `start` begins with an empty `hear`. A table talk log left by an earlier session of the same name is kept as
  `.sessions/<session>.chat.<UTC time>.jsonl`, so an orchestrator can still read it, but no player hears it.
- `selftest` starts its own session with two seats on a local page, exercises dialogs, reload, metric drift, an outside
  `scale` override and page zoom, stops, and checks no Chrome, daemon, session file or profile is left behind. Run it
  after any change to `pt.mjs`.

## One shared phone (`--shared`)

`node tools/playtest/pt.mjs start <session> --seats p1,p2,p3 --shared` opens ONE phone window for the whole
table, and `setup` makes it a 一部手機玩 room (`app.local`) holding every seat in table order. Every player
still uses their own seat id, and a referee decides what each person may see or touch:

- The phone belongs to the app's current seat (「而家睇：X」). Only that person can `see` the screen or
  `tap` / `hold` / `type` / `draw` / `scroll`. Everyone else gets 「📱 X 拎緊部手機」.
- A pass gate (「交俾 Y · 其他人唔好望」) is a public card: everybody sees the card (and nothing behind it),
  only Y can tap it. Tapping it gives Y the phone.
- At night and in eyes-closed steps nobody looks except the seat the step calls (the gate shows the role
  prompt); everyone else gets 「🌙 你閉緊眼」 plus what the narrator says.
- `show <session> <seat>` (holder only) lays the phone face up in the middle: everyone can `see` / `shot` it
  read-only until it changes hands, a gate appears or night falls. `show <session> <seat> off` takes it back.
- To hand the phone to someone outside an automatic gate, the holder taps 「而家睇：X 換人 ⇄」 and picks them;
  they then tap their gate.
- `wait` waits on what *you* may know (a gate naming you, the phone reaching you, a public change).
