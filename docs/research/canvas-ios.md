# Shared finger-drawing canvas on iPhone Safari — research for 你畫我猜 / 假畫家

> Paraphrased research notes for implementation. Not a copy of any source. Compiled 2026-10-03 UTC; independently fact-checked and corrected the same day (see "Verification" at the end).
> Scope: one phone draws, every other phone watches the line grow live over a PeerJS DataChannel (host phone relays). Used by `draw-guess` (你畫我猜) and `fake-artist` (假畫家); see `docs/DESIGN.md` section 11 and sibling docs `draw-guess.md`, `fake-artist.md`.

**Confidence tags** used on every Finding: **[V]** = read in a primary source or compat dataset during this research (WebKit source, PeerJS 1.5.4 source, MDN browser-compat-data, caniuse, W3C spec); **[C]** = community or secondary source; **[I]** = my inference or arithmetic, must be confirmed on a real iPhone.

**Glossary (繁體中文)**: 畫布 canvas · 筆劃 stroke · 筆觸/落筆 pointer down · 收筆 pointer up · 橡皮擦 eraser · 還原 undo · 清除 clear · 房主 host · 觀眾 / 猜嘅人 viewers · 長按選單 long-press callout · 放大鏡 text-selection loupe · 搖一搖還原 shake to undo · 下拉更新 pull-to-refresh · 橡筋回彈 rubber-band · 掌心誤觸 palm rejection · 重播 replay · 後備緩衝 backing store.

---

## 0. Bottom line

1. Use **Pointer Events only** (iOS 13+; the project floor is iOS 16, see 1.1), on a canvas whose whole draw screen carries `touch-action: none`. Add a `touchstart`/`touchmove` `preventDefault()` registered with an explicit `{ passive: false }` on the canvas element as a belt-and-braces guard (keep it off `document`/`body`: there WebKit silently makes a touch listener passive **when `passive` is not specified**, and a page-wide guard would also kill scrolling elsewhere).
2. Ask for **coalesced events** when present (`getCoalescedEvents`, Safari/iOS **18.2+**) and fall back to the single event; the app must look fine without them (iOS 16 to 18.1 get one sample per event, roughly one per display frame).
3. The canvas bitmap is a **cache**, never the source of truth. Truth = a **stroke list** in logical coordinates. Any resize, undo, clear or purge re-renders from it.
4. Logical space **1000 x 1250 integers** (4:5, fixed). Brush widths are in logical units. The drawer renders the same quantised integers that viewers receive, so pictures match on every phone.
5. Send **delta-encoded integer arrays in JSON** in **~50 ms batches** (first batch of a stroke and the pen-up flush immediately). Measured: about 5 to 6 bytes per point delta-encoded vs about 9.5 to 10 as `[x,y]` pairs. Bandwidth is a non-issue (a few KB/s); **the real hazards are PeerJS's 16,300-byte JSON cap and `js/core/net.js` treating any connection `error` as a dead peer. The existing `room.js` already sends the whole drawing as one `inkSync` message, which breaks this cap for any drawing above roughly 1,600 points (section 1.3).**
6. Host is the authority: it validates sender and turn, orders everything with a sequence number `q`, relays to everybody (the echo to the drawer doubles as an ack), and can replay the whole op log as a snapshot in chunks of at most ~12 KB.
7. Eraser = a stroke painted in the opaque paper colour (replays correctly, no compositing modes). Undo = host tombstones a stroke id. Clear button = `op:'clear'` (drop all strokes, same epoch, `q` continues); a new picture/turn = the engine bumps `inkEpoch` (12.4).
8. Mid-stroke recovery is idempotent: every batch carries the index `i` of its first point, so resends and gaps are detectable.
9. Make the draw screen a **non-scrolling fixed layout** using `100dvh`; keep 24 px side gutters so left/right edge swipes (back gesture) do not collide with strokes.
10. Everything that cannot be verified from documents (touch sampling rate on specific iPhones, the tap-then-long-press loupe regression on iOS 18 and later, callout regressions on iOS 26) goes on the **device test list in section 16**.
11. On WebKit `getContext('2d', { alpha: false })` is **ignored** (not implemented), so the canvas is transparent until painted: fill the paper colour after every backing-store resize and at the start of every `redrawAll()`.

---

## 1. Target environment and version matrix

### 1.1 Feature availability on iPhone Safari

**Finding.** The features this design depends on arrived on iOS at these versions. [V] unless marked.

| Capability | iOS Safari since | Notes |
|---|---|---|
| Pointer Events (`pointerdown/move/up/cancel`, `pointerType`, `isPrimary`, `setPointerCapture`) | **13** | Same release as `touch-action` values `none`, `pan-x`, `pan-y`, `pinch-zoom` per MDN data. caniuse marks 13.0 to 13.1 partial (`buttons` is 0 on touch `pointermove`); full from 13.2. Never test `e.buttons` for touch anyway. |
| `touch-action: manipulation` | 9.3 | Only value (besides `auto`) before iOS 13. |
| `visualViewport` | 13 | |
| `ResizeObserver` | 13.4 | |
| `visibilitychange` | 7 (partial), complete 14.5 | Fires on `document` when the app is backgrounded since iOS 7; BCD calls it complete only from 14.5 because earlier versions did not fire it when navigating away and (before 14) it did not bubble to `window`. Always also listen to `pagehide`. |
| `aspect-ratio` | 15.0 | Optional; we size from JS anyway. |
| Dynamic viewport units `dvh/svh/lvh` | 15.4 | `100vh` on iOS ignores the collapsing toolbar. |
| `RTCSctpTransport.maxMessageSize` | 15.4 | Lets us read the negotiated limit. |
| Safari pull-to-refresh | 15 | Behaviour, not an API. Commentary in WebKit bug 176454. |
| `overscroll-behavior` | **16** | Partial: no effect on scrollers that have nothing to scroll (WebKit bug 243452). |
| `touch-action` stops Safari toolbar from collapsing/expanding | 16.0 | Fixed by WebKit bug 233417; broken on iOS 15. |
| `navigator.wakeLock` | 16.4 in Safari tabs; **18.4** in Home Screen web apps | Earlier Home Screen apps: API present but did not work. |
| `OffscreenCanvas` | 16.4 | Useful for thumbnails only. (caniuse shows 16.2 as partial, 2D only; BCD and the WebKit 16.4 notes say 16.4.) |
| 2D canvas `reset()` | 17.2 | Not needed. |
| `PointerEvent.getCoalescedEvents()` / `getPredictedEvents()` | **18.2** | iPhone and iPad. Feature-detect, do not UA-sniff (Safari 26 also freezes the OS version in the user-agent string, per `platform-ios.md`). |
| `pointerrawupdate` | **never** (not in any released iOS through 27.0; caniuse's 27.1/27.2 columns are projected future versions) | Do not rely on it. |
| `requestIdleCallback` | **not available** on iOS (macOS Safari only behind a preview flag) | Do not use. |
| 2D context option `alpha: false` | **not implemented** in WebKit | Silently ignored: WebKit's `CanvasRenderingContext2DSettings.idl` has the member commented out with a FIXME; BCD lists Safari/iOS as unsupported. See 6.4. |
| iOS canvas area limit | 4096 x 4096 px until WebKit 276145@main (2024-03-15); 8192 x 8192 after | The raised limit most likely shipped with iOS 18 [I]. See 6.1. |
| Manifest `orientation`, `screen.orientation.lock()` | **never** | Even Home Screen web apps cannot lock orientation. See 7.2. |

**Implication for us.** Floor = the project floor **iOS 16.0** (set by `docs/research/platform-ios.md`, which targets iOS 16 to 27). An iOS 13 floor is not achievable anyway: the code sketches here use `?.`/`??` (iOS 13.4), the CSS uses `inset` and `padding-inline` (iOS 14.5), and `js/core/net.js` already uses private class methods (iOS 15), so older phones fail to parse the app before any canvas code runs. On iOS 16 every capability above except coalesced/predicted events, the Home Screen wake lock and the larger canvas limit is present. Enhancements on **18.2+** only. All calls are feature-detected.

**Source.** MDN browser-compat-data main (downloaded and queried 2026-10-03: `api.PointerEvent*`, `css.properties.touch-action*`, `css.properties.overscroll-behavior`, `api.Navigator.wakeLock`, `api.OffscreenCanvas`, `api.RTCSctpTransport`, `api.Document.visibilitychange_event`); caniuse `css-touch-action`, `wake-lock`, `mdn-api_pointerevent_getcoalescedevents`, `mdn-api_element_pointerrawupdate_event`; WebKit Bugzilla 176454, 243452, 233417; WebKit blog Safari 15.4 (dynamic viewport units). Fact-check additions: BCD 8.1.4 (2026-10-01) re-queried for `css.properties.inset`, `padding-inline`, `javascript.classes.private_class_methods`, `api.ScreenOrientation.lock`, `manifests.webapp.orientation`, `getContext.2d_context.options_alpha_parameter`; caniuse full data (`pointer`, iOS version list); WebKit source `CanvasRenderingContext2DSettings.idl`, `CanvasBase.cpp` and commit 276145@main; `docs/research/platform-ios.md` (project floor).

### 1.2 iPhone geometry and pixel density

**Finding.** Every iPhone sold new since the iPhone 16e replaced the SE (2025) is 3x. 2x phones still inside the iOS 16+ range: iPhone SE 2nd/3rd gen and iPhone 8 (375 x 667), and iPhone XR/11 (414 x 896). CSS viewport sizes: iPhone 17 / 17 Pro / 16 Pro = 402 x 874, 17 Pro Max / 16 Pro Max = 440 x 956, iPhone Air = 420 x 912, 15/16 = 393 x 852, 16e/14/13 = 390 x 844, 15 Pro Max/16 Plus = 430 x 932, 12/13 mini = 375 x 812 (3x). The 320-wide SE (1st gen) stops at iOS 15, below our floor. [C] (2026 iPhone 18 sizes not checked.)

**Implication for us.** Design the canvas for **375 to 440 CSS px wide** (degrade gracefully down to 320). The recommended draw screen (3.6, 17.3) is `position: fixed` with **24 px** stage gutters, so the canvas is the viewport width minus 48 px: a 4:5 canvas comes out about 345 x 431 CSS px on a 393-wide phone (1035 x 1294 device px at 3x), 354 x 443 on a 402-wide phone, 392 x 490 on a Pro Max, and about 327 x 409 on an SE if the height allows. Height, not width, is the limiting side on short phones, so size by "contain" fit (section 7).

**Source.** useyourloaf.com "iPhone 16 screen sizes" and "iPhone 17 screen sizes" (Keith Harrison's tables); which 2x models still run iOS 16+ is from general knowledge of Apple's support lists, not re-read [I].

### 1.3 What the repo already does that matters

**Finding.** (Re-checked against the working tree on 2026-10-03; the app is mid-migration to `js/core/` + `css/base.css`.) `index.html` sets `viewport-fit=cover, maximum-scale=1, user-scalable=no` and now links only `css/base.css` and `js/main.js` (the old `styles.css`/`js/net.js` are still on disk but no longer loaded). `css/base.css` gives `#app` a `1rem` side padding (about 16 px), `body` has `overscroll-behavior-y: contain` and a normal scrolling document with `min-height: 100dvh`; `-webkit-tap-highlight-color: transparent` is global; `.screen` is no longer `display: none` until `.active` (that rule exists only in the legacy `styles.css`). `manifest.webmanifest` is `display: standalone` and now also declares `orientation: portrait`, which iOS ignores (7.2). `js/core/net.js` dials with `{ reliable: true, serialization: 'json' }` and, on the **host**, wires both `conn.on('close')` and `conn.on('error')` to the same `gone()` handler, which deletes the connection and emits `peer-close`. PeerJS is loaded from jsDelivr at **1.5.4** (latest is 1.5.5, 2025-06-07; same JSON cap and `ordered` mapping on master). [V, project files; npm registry]

**Finding (existing ink code).** An ink path already exists: `js/core/session.js` (`normalizeInk`, `applyInkBatch`, `MAX_PTS_TOTAL = 12000`, `MAX_PTS_PER_BATCH = 400`) and `js/core/room.js` (`#relayInk`, `#sendInkSync`). Its wire format is DESIGN section 8's `{ pid, stroke, pts: [[x,y],...], end, color, width, eraser }`, it clamps **both** axes to 0..1000, undo removes the pid's last stroke, live batches are relayed to every device except the sender, and **`#sendInkSync` sends the whole drawing as one message**. The comment beside `MAX_PTS_TOTAL` budgets for "~256 KB" per DataChannel message, but PeerJS's JSON mode refuses anything of 16,300 bytes or more (11.2). At about 9.5 to 10 bytes per `[x,y]` point, any drawing above roughly 1,600 points produces a `message-too-big` error on the host's connection, and the `gone()` handler then evicts that perfectly healthy peer. The placeholder `js/ui/components/Canvas.js` has no drawing code yet. [V, project files; I for the point threshold]

**Implication for us.** (a) The draw screen needs its own non-scrolling layout; the document scroller must not be live while drawing. (b) The existing 16 px gutter already helps with edge swipes but is marginal (section 3.6). (c) Ordered + reliable is already configured, which is what ink needs. (d) The `'error'` handler on the host is a trap for oversized messages (section 11.2), and the current `inkSync` will trip it on ordinary drawings: chunk it (13.1) or cap it before the canvas ships. (e) The protocol in 10.4 is a redesign, not a drop-in: adopting it means replacing `normalizeInk`/`applyInkBatch` and the `LH = 1250` y-range (7.1) must be reconciled with the 0..1000 clamp.

**Source.** `D:\board_game\index.html`, `css/base.css`, legacy `styles.css`, `js/core/net.js`, `js/core/session.js`, `js/core/room.js`, `js/ui/components/Canvas.js`, `manifest.webmanifest`; registry.npmjs.org `peerjs` (dist-tags, release times).

---

## 2. Pointer events vs touch events on iOS

### 2.1 Pointer events are built from the same UIKit touch stream

**Finding.** In WebKit's iOS implementation the `PointerEvent` objects are constructed from the platform touch event: `pointerId` is the touch identifier, `width`/`height` are twice the touch's contact radius, `pressure` is the touch force, and `pointerType` is `pen` only when UIKit reports a stylus, otherwise `touch`. A touch phase of "stationary" is mapped to a `pointermove`. So pointer events do not give a faster or finer stream than touch events; they are the same data in a cleaner API. [V]

**Implication for us.** Use pointer events exclusively (one code path for finger, Apple Pencil on iPad, mouse on desktop testing). Do not write a touch-event drawing path. Because "stationary" touches also produce `pointermove`, always filter by `pointerId` and ignore moves that do not change the quantised position (section 14).

**Source.** WebKit source `Source/WebCore/dom/ios/PointerEventIOS.cpp`; WebKit blog "New WebKit Features in Safari 13" (introduces Pointer Events).

### 2.2 `pointercancel` and implicit capture define the stroke lifecycle

**Finding.** Per the W3C spec, touch pointers are implicitly captured by the element that received `pointerdown`, so `pointermove`/`pointerup` keep arriving on the canvas even when the finger leaves it. A `pointercancel` fires when the browser takes over the gesture (pan/zoom allowed by `touch-action`, a system gesture, an alert) and carries no coalesced events. `lostpointercapture` follows `pointerup`/`pointercancel`. [V]

**Implication for us.** The state machine per stroke is: `pointerdown` (primary, idle) -> many `pointermove` (same id) -> `pointerup` **or** `pointercancel` **or** `lostpointercapture` while still active. Treat `pointercancel` as "discard this stroke" (send `x:1`); `pointerup` as commit. Also end the stroke on `visibilitychange` to hidden and on `blur`. Call `setPointerCapture` anyway for desktop-mouse testing.

**Source.** W3C Pointer Events spec (implicit capture, pointercancel, lostpointercapture sections).

### 2.3 Touch-event listeners on the root are passive by default

**Finding.** WebKit's `Quirks::shouldMakeEventListenerPassive` makes `touchstart`/`touchmove` listeners registered on the window, document, `<html>` or `<body>` passive, controlled by the `PassiveTouchListenersAsDefaultOnDocument` preference (default value on iOS comes from a platform function; the generic default is true). `EventTarget::addEventListener` consults the quirk **only when the options leave `passive` unspecified**, so an explicit `{ passive: false }` on a root target is honoured. Listeners on other elements are non-passive by default. [V]

**Implication for us.** Put the `preventDefault()` guard on the **canvas (or draw-screen) element** with an explicit `{ passive: false }`. A guard added to `document.body` **without** `{ passive: false }` silently does nothing; with it, it works but blocks scrolling for the whole app, which we do not want outside the draw screen.

**Source.** WebKit source `Source/WebCore/dom/EventTarget.cpp` (`if (!passive.has_value() && Quirks::shouldMakeEventListenerPassive(...)) passive = true`), `Source/WebCore/page/Quirks.cpp`, `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`.

### 2.4 Coordinates: use `clientX/clientY` and a cached `getBoundingClientRect()`

**Finding.** MDN's compat data carries an old note that Safari on iOS adjusts the effective viewport for user zoom, making `getBoundingClientRect()` values wrong when the page is zoomed. Pointer `clientX/Y` and the rect are in the same coordinate system, so a ratio `(clientX - rect.left) / rect.width` stays correct as long as both are consistent. [V for the note; I for the mitigation]

**Implication for us.** Map with ratios, not with `offsetX`/`pageX`. Read the rect **once per `pointerdown`** (not per move) to avoid forced layout. If `visualViewport.scale !== 1` while on the draw screen, show a small "reset zoom" hint. With `touch-action: none` over the whole draw screen the page cannot be pinch-zoomed from there anyway.

**Source.** MDN browser-compat-data `api.Element.getBoundingClientRect` (Safari iOS note); W3C Pointer Events (client coordinates).

---

## 3. Stopping the page from reacting while the finger draws

### 3.1 `touch-action: none` works on iOS 13+; older folklore says otherwise

**Finding.** MDN's dataset and caniuse list `touch-action: none` as supported on iOS from 13 (with only `auto`/`manipulation` from 9.3). Older forum lore ("`none` never worked on iOS") dates from iOS 9 to 12, when users in the WebKit bug 133112 thread were asking for it. That thread does **not** show `none` unimplemented after iOS 13 shipped: on 2019-10-03 a WebKit engineer confirmed `touch-action` (`pan-y`) support in iOS 13 and asked for new bugs if anything misbehaved, and the bug was closed (RESOLVED CONFIGURATION CHANGED). Commenters on a modal-scroll-lock article report `touch-action: none` fixing body scroll on iOS 13. Until iOS 16.0, a `touch-action` restriction did not stop Safari's address-bar/toolbar from collapsing and re-expanding during a touch (WebKit bug 233417, believed fixed in iOS 16.0 beta 1 and confirmed by a commenter on 16.0.3; closed as RESOLVED MOVED, i.e. fixed on Apple's side). [V datasets and bug records, C for field reports]

**Implication for us.** Declare `touch-action: none` statically in CSS (it is read at touch start; do not toggle it mid-gesture). With the iOS 16 floor (1.1) the old iOS 13 to 15 doubts and the toolbar bug are out of range, but **keep the JS guard from 2.3** anyway: it is cheap and it is the only defence against the tap-then-long-press loupe (4.1). Verify on one iOS 16 device and one current device (section 16).

**Source.** MDN browser-compat-data `css.properties.touch-action.none`; caniuse `css-touch-action`; WebKit Bugzilla 133112 (comment 42, 2019-10-03) and 233417; benfrain.com "Preventing body scroll for modals in iOS"; MDN `touch-action` page (pointercancel guidance).

### 3.2 Scope the rule to the whole draw screen, not just the canvas

**Finding.** `overscroll-behavior` (Safari 16) has no effect on a scroller that has nothing to scroll, and WebKit bug 243452 about that remains open. Pull-to-refresh was added to Safari in iOS 15 and people complained it clashed with custom pull gestures. `touch-action` is evaluated as the intersection along the ancestor chain up to the scroller, so an ancestor with `none` blocks panning for all descendants. [V for the limitation and the intersection rule; C for the PTR history]

**Implication for us.** Do not rely on `overscroll-behavior` alone. For the draw screen:

```css
.screen.draw, .screen.draw * { touch-action: none; }   /* buttons still tap; nothing can start a page pan */
.screen.draw {
  position: fixed; inset: 0; height: 100dvh; overflow: hidden;
  overscroll-behavior: none;
  -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none;
}
.screen.draw { display: flex; flex-direction: column; }  /* css/base.css no longer hides .screen until .active (legacy styles.css did) */
```

`inset`, `padding-inline` and `100dvh` need iOS 14.5 / 14.5 / 15.4, all below the iOS 16 floor, so no fallbacks are needed.

Trade-off: no pinch-zoom on that screen (MDN warns `none` can inhibit zoom for low-vision users). Acceptable for a transient game screen; the rest of the app keeps `touch-action: manipulation` on controls.

**Source.** WebKit Bugzilla 176454 (shipping history, PTR comments) and 243452 (limitation); MDN `touch-action` (intersection rule, accessibility warning); MDN browser-compat-data `css.properties.overscroll-behavior`.

### 3.3 The document must not scroll while drawing

**Finding.** `100vh` on iOS Safari does not track the collapsing toolbars; `100dvh` (Safari 15.4) does. A canvas inside a normal flowing page will move under the finger when the page scrolls. Changing the layout viewport (toolbar collapse, rotation) changes the canvas CSS size. [V for dvh; I for the layout hazard]

**Implication for us.** The draw screen is `position: fixed; height: 100dvh; overflow: hidden` (above) and contains: top bar (timer, word mask), the canvas "stage" (flex: 1), and the toolbar. The stage uses `ResizeObserver` to compute the contain-fit size (section 7.2). No element on this screen scrolls; long content (hints list) moves into a sheet that is opened deliberately.

**Source.** WebKit blog "New WebKit Features in Safari 15.4"; MDN browser-compat-data `css.types.length.viewport_percentage_units_dynamic`, `api.ResizeObserver`.

### 3.4 Pinch zoom and double-tap zoom

**Finding.** iOS 10 and later ignore `user-scalable=no` / `maximum-scale` for pinch zoom (accessibility), so the existing meta tag does not protect us. Safari-only `gesturestart/gesturechange/gestureend` events exist (iOS 2+) and calling `preventDefault()` on them disables page pinch zoom; `preventDefault()` on `touchmove` disables scrolling (Apple's Safari Web Content Guide). Double-tap-to-zoom is suppressed by `touch-action: manipulation` (iOS 9.3+) or by a `width=device-width` viewport. [V]

**Implication for us.** `touch-action: none` on the draw screen already blocks both. Additionally, add `gesturestart` `preventDefault()` listeners (non-passive) on the draw screen element for older-iOS belt and braces. Do not install them on `document` for the whole app (accessibility).

**Source.** Apple Safari Web Content Guide "Handling Events"; Patrick H. Lauke "Getting touchy" slides (iOS 9.3, 10 behaviours); MDN browser-compat-data `api.GestureEvent`.

### 3.5 Pull-to-refresh and rubber-band

**Finding.** Safari added pull-to-refresh in iOS 15 and `overscroll-behavior` in 16, with the non-overflowing-scroller limitation (3.2). WebKit bug 243452 is still open (Simon Fraser: it would need non-scrollable boxes in the scrolling tree); Chrome 144 and Firefox 150 have since changed their behaviour, so desktop testing will not reproduce the iOS limitation. [C/V]

**Implication for us.** With the draw screen fixed, `touch-action: none` everywhere, and `overscroll-behavior: none` on the screen, the page has no scroll gesture to start. Still test: touch down on the top bar, drag down, confirm no refresh and no bounce.

**Source.** WebKit Bugzilla 176454; MDN `overscroll-behavior`.

### 3.6 Edge gestures cannot be prevented

**Finding.** The iOS edge swipe (Safari back/forward) and 4-finger system gestures are handled by the system before the page; `preventDefault()` does not stop them (Lauke's slides). Whether Home Screen (standalone) mode removes the edge-swipe-back is not something I verified; it removes the browser chrome only. The exact width of the edge zone is not documented. [C for the swipes; I for standalone]

**Implication for us.** Keep the canvas at least **24 CSS px** away from the left/right screen edges (the repo's 1rem padding is only about 16 px, so add `padding-inline: max(24px, env(safe-area-inset-left))` on the stage), and put the toolbar at the bottom above the home-indicator inset (`env(safe-area-inset-bottom)`). Tell players in the 試玩 hint: "唔好由螢幕邊開始畫". Expect `pointercancel` if someone does anyway (2.2 handles it).

**Source.** Patrick H. Lauke "Getting touchy" (edge swipes and 4-finger gestures not preventable); `D:\board_game\css\base.css` (current `#app` padding; same value in the legacy `styles.css`).

### 3.7 Toolbar collapse and canvas resizing

**Finding.** Setting `canvas.width`/`height` clears the bitmap and reallocates memory. Libraries that scale the canvas for `devicePixelRatio` must redraw after every resize (signature_pad documents this and keeps its data as point groups for that reason). Safari's toolbars animate, producing bursts of resize notifications. [V for clearing; C for library practice]

**Implication for us.** Debounce: on `ResizeObserver`, update the **CSS size** immediately (the old bitmap stretches for a moment), and reallocate the backing store only when the target pixel size really changed, at most once per ~100 ms, then `redrawAll()` from the stroke list. Never reallocate in the middle of a live stroke; finish the stroke on the old bitmap and redraw afterwards.

**Source.** github.com/szimek/signature_pad README (devicePixelRatio scaling, clearing on resize, data as point groups); HTML canvas semantics.

---

## 4. Long-press callout, text-selection loupe, tap highlight, shake to undo

### 4.1 CSS stack and its regression history

**Finding.** The standard stack is `-webkit-touch-callout: none` (iOS-only property; supported since iOS 2) + `-webkit-user-select: none; user-select: none` + `-webkit-tap-highlight-color: transparent`. On iOS 15.0/15.1 a long press showed the new loupe/magnifier UI even with `user-select: none` (WebKit bug 231161). The fix missed the 15.2 betas; a WebKit engineer later said it was in the final 15.2 and certainly in 15.3. Developers also reported `-webkit-touch-callout` having no effect on iOS 15 (Apple Developer Forums), and in Nov 2025 an unanswered forum post says `-webkit-touch-callout: none` on `html, body` no longer suppresses the long-press menu on text on iOS 26.1. The 231161 page links **WebKit bug 296492** (opened 2025-07-25, still NEW, reported on iOS 18): `-webkit-user-select: none` still stops the loupe on a plain long press, but a **tap followed by a long press** brings the loupe up and cannot be disabled with CSS, only with JS. A community fix for canvas games (Babylon.js forum): put `user-select: none` and `touch-action: none` on `html, body` as well as the canvas. [V for bugs 231161 and 296492; C for the forum reports]

**Implication for us.** Apply the stack on the **draw screen root and the canvas**, and keep the JS guard from 4.2 (it is the only known counter to the 296492 tap-then-hold loupe, and drawing a dot then pressing again is a normal drawing motion). Do not rely on any single CSS property. The device test list includes "hold a finger still on the canvas for 1 s" **and** "tap, then immediately press and hold": no loupe, no callout, no selection.

**Source.** WebKit Bugzilla 231161 (comments 12 to 18) and 296492; developer.apple.com/forums threads 691021 (iOS 15) and 808606 (iOS 26.1); forum.babylonjs.com "Prevent unwanted inputs in (iOS) Safari, hold click selects canvas"; MDN browser-compat-data `css.properties.-webkit-touch-callout`.

### 4.2 The JS guard that always works: non-passive `touchstart` on the canvas

**Finding.** On the Apple forum thread about the iOS 15 callout, two working measures were reported: `preventDefault()` on `touchstart` (with the catch that it also disables scrolling, which is irrelevant for a canvas under `touch-action: none`) and `-webkit-user-select: none` on the element's **parent**. WebKit bug 296492 (4.1) says the tap-then-hold loupe on iOS 18 can only be stopped from JS, which makes the `touchstart` guard the one measure that covers every reported case. [C forum; V bug record]

**Implication for us.**

```js
const stop = (e) => e.preventDefault();
canvas.addEventListener('touchstart', stop, { passive: false });
canvas.addEventListener('touchmove',  stop, { passive: false });
canvas.addEventListener('contextmenu', stop);
```

Side effect to handle: a prevented `touchstart` does not blur a focused text field, so call `document.activeElement?.blur?.()` in `pointerdown`. **Verify on device that pointer events still flow after touch `preventDefault()`.** The W3C Pointer Events spec explicitly declines to say how a browser that supports both Touch Events and Pointer Events should order or couple them, so nothing normative guarantees it. WebKit's open-source generic `EventHandler::handleTouchEvent` dispatches the pointer event for each touch point before building the touch event (WPE/GTK path); the iOS dispatch path is not fully visible in open source, so this stays a device-test item.

**Source.** developer.apple.com/forums thread 691021; W3C Pointer Events (states it gives no advice for user agents that support both Touch Events and Pointer Events); WebKit source `Source/WebCore/page/EventHandler.cpp`.

### 4.3 Shake to undo

**Finding.** "Shake to Undo" is an OS accessibility switch that sends an undo to the responder chain; a web page cannot turn it off. The on/off toggle has existed since **iOS 9** (not just iOS 16, as the AbilityNet title might suggest); since iOS 13 it lives under Settings > Accessibility > Touch. It is on by default. The "Undo Typing" prompt exists only when something undoable (typed text) was registered. [C: AbilityNet how-to, Wikipedia "iOS 9"; mechanism by inference]

**Implication for us.** The drawer's draw screen must contain **no text inputs and no `contenteditable`** (in typed-guess mode `draw-guess.md` puts the text box on the *guessers'* phones; the drawer only sees a feed plus accept buttons). Blur any input when the draw screen opens. The app's own `ShakeDetector` (dice) must be stopped on the draw screens so a shake does not roll anything.

**Source.** mcmw.abilitynet.org.uk "How to disable shake to undo in iOS 16"; en.wikipedia.org "iOS 9" (Settings: toggle for Shake to Undo); `D:\board_game\js\core\shake.js` (current detector; legacy copy in `js/shake.js`), which exposes `stop()`.

---

## 5. Coalesced and predicted pointer events

### 5.1 Support and semantics

**Finding.** `getCoalescedEvents()` and `getPredictedEvents()` arrived in Safari and iOS Safari **18.2** (Dec 2024; first appeared in Safari Technology Preview 202). Chrome has had coalesced events since 58, Firefox since 59. Per the spec, coalesced events share `pointerId`/`pointerType`/`isPrimary` with the parent, have increasing timestamps, are empty on `pointerdown`/`pointerup`/`pointercancel` (the spec says the list is empty for every trusted type other than `pointermove`/`pointerrawupdate`), and, unlike predicted events, are real historical samples. Only `getCoalescedEvents()` is `[SecureContext]` (in both the spec IDL and WebKit's `PointerEvent.idl`); `getPredictedEvents()` is not. GitHub Pages is HTTPS and localhost qualifies, but a phone testing against a LAN dev server over plain `http://192.168.x.x` gets **no** `getCoalescedEvents` (the fallback path runs). [V]

**Implication for us.** Pattern:

```js
const list = e.getCoalescedEvents?.() ?? [];
for (const c of (list.length ? list : [e])) addSample(c);
```

Copy the numbers out synchronously; do not keep the event objects.

**Source.** WebKit blog "WebKit Features in Safari 18.2" and "Release Notes for Safari Technology Preview 202" (2024-08-28); caniuse `mdn-api_pointerevent_getcoalescedevents`; MDN browser-compat-data (`api.PointerEvent.getCoalescedEvents`: Safari 18.2, iOS 18.2, Chrome 58, Firefox 59; `getPredictedEvents`: Chrome 77, Firefox 89); W3C Pointer Events spec (IDL and coalesced-list definition); WebKit source `Source/WebCore/dom/PointerEvent.idl`.

### 5.2 What iOS actually feeds in

**Finding.** WebKit's iOS touch recogniser fills coalesced and predicted lists from UIKit (`coalescedTouchesForTouch:` and `predictedTouchesForTouch:`) **only for the first touch (index 0) on move events** (a FIXME, bug 284852, says to store them per touch). Pointer `pressure` is `force / maximumPossibleForce` (zero if the device reports no maximum force), `width`/`height` are twice the radius. [V]

**Implication for us.** Track exactly one pointer (the primary, first finger) and the coalesced list will be populated for it; a second finger adds nothing and may steal "index 0" if the first lifts. Do not use `pressure` for width on iPhones: 3D Touch hardware is gone from iPhone XR/11 and later, so force (and with WebKit's mapping, `pressure`) is likely 0 there [I], even though the spec asks for 0.5 on hardware without pressure while a button is down; meanwhile 3D Touch phones still inside the iOS 16+ range (iPhone 8, X, XS) report real force. Values would differ by device, so use a fixed width per tool.

**Source.** WebKit source `Source/WebKit/UIProcess/ios/WKTouchEventsGestureRecognizer.mm` (lines around the coalesced/predicted extraction and FIXME 284852); `PointerEventIOS.cpp`.

### 5.3 Predicted events: optional local-only polish

**Finding.** Predicted points extrapolate from velocity and are only valid until the next real event. [V spec]

**Implication for us.** v1 skips them. If added later (v2), draw predictions on a **separate overlay canvas cleared every frame**, on the drawer's phone only, never serialised, never stored.

**Source.** W3C Pointer Events spec; MDN `getPredictedEvents`.

### 5.4 `pointerrawupdate` does not exist in Safari

**Finding.** Not supported on any Safari/iOS version in caniuse data (through 27.2); Chromium and (recently) Firefox only. [V]

**Implication for us.** Nothing to do. Do not branch on it.

**Source.** caniuse `mdn-api_element_pointerrawupdate_event`; MDN browser-compat-data.

### 5.5 Timers and frame rate degrade in Low Power Mode

**Finding.** WebKit adds a LowPowerMode throttling reason that halves the rendering-update rate to about 30 fps (and so `requestAnimationFrame`), and raises the DOM timer alignment from 0 ms to **30 ms** under Low Power Mode or thermal mitigation; hidden pages align timers to **1 s**. Separately, the stable preference `PreferPageRenderingUpdatesNear60FPSEnabled` defaults to **true** on iPhone, so even 120 Hz ProMotion iPhones run page rendering updates (and `requestAnimationFrame`) near **60 fps** unless the user flips that feature flag. [V]

**Implication for us.** The ~50 ms batch flush must not depend on one exact `setTimeout`: check elapsed `performance.now()` on every `pointermove` and in `requestAnimationFrame`, and also arm a timer as a fallback. Viewer pacing (section 9) must use elapsed time, not a fixed points-per-frame, so it works at 30 fps. Budget for a 60 fps paint loop on every iPhone, ProMotion included.

**Source.** WebKit source `Source/WebCore/page/Page.cpp` (throttling reasons, `updateDOMTimerAlignmentInterval`, `preferredRenderingUpdateInterval`), `Source/WebCore/platform/graphics/AnimationFrameRate.h` (`HalfSpeedThrottlingFramesPerSecond = 30`), `Source/WebCore/page/DOMTimer.h` (alignment constants) and `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` (`PreferPageRenderingUpdatesNear60FPSEnabled`).

---

## 6. Canvas backing store: size limits, memory, devicePixelRatio 3

### 6.1 Per-canvas area limit

**Finding.** The per-canvas limit is `maxCanvasArea()` in WebKit's `CanvasBase.cpp`, measured in device pixels of *backing store* (so CSS size times `devicePixelRatio` squared matters). On iOS it was **16,777,216 pixels** (4096 x 4096 equivalent) until WebKit commit 276145@main (2024-03-15, bug 271002, "[iOS] Increase the limit on the canvas size to 8192x8192", justified by a raised jetsam limit), and is **67,108,864** (8192 x 8192) since; that most likely shipped in iOS 18 [I], so iOS 16 and 17 keep the old limit. Over the limit the canvas silently gets no buffer and the console logs "Canvas area exceeds the maximum limit (width * height > N)". The `MaxClampedLength = 4096` / `MaxClampedArea` constants in `ImageBuffer.cpp` that are sometimes quoted for this are a different mechanism (they clamp internal image buffers via `sizeNeedsClamping`/`clampedSize`), not the canvas element limit. [V source and commit; C for the error text in the wild]

**Implication for us.** Not a practical limit: our largest canvas is about 1.7 megapixels (section 6.3), far under even the old 16.8 MP. Still clamp defensively: `scale = min(dpr, 3)` and, if `w*h > 4_000_000`, reduce `scale`.

**Source.** WebKit source `Source/WebCore/html/CanvasBase.cpp` (`maxCanvasArea`, `validateArea`) and commit d1f63c061e / 276145@main; `Source/WebCore/platform/graphics/ImageBuffer.cpp`; pqina.nl "Canvas area exceeds the maximum limit" (2022, 16,777,216); GitHub issue reports (react-pdf #1149 and others).

### 6.2 Total canvas memory

**Finding.** Older Safari on iOS also enforced a total across canvases: reported as 224 MB (iOS 12 era), 256 MB (a hard-coded test value mentioned in the bug), and **384 MB** (pqina, measured on iOS 15, "lower on earlier versions" and probably device-specific). Canvases were not released promptly after losing references (they waited for garbage collection), so `getContext` started returning `null` ("Total canvas memory use exceeds the maximum limit"). WebKit 265628@main (2023-06-29, bug 195325, in Safari Technology Preview 174) did not just speed up release: it **removed the artificial canvas-memory limit entirely**, leaving canvases subject to the same process memory limits (jetsam) as everything else. Which shipping iOS first had it is not stated on the bug [I: probably iOS 17]; iOS 16 devices inside our range still have the cap. The recommended release on those versions is to set `width = height = 0` (or 1x1) before dropping a canvas. [V for the bug and commit message; C for the specific MB numbers]

**Implication for us.** Keep at most 2 to 3 canvases alive: one committed bitmap, optionally one overlay, and one scratch canvas reused for thumbnails/exports. When discarding any canvas, zero its size first. Never create a canvas per stroke or per message. (Once the cap is gone, an over-budget page risks a whole-tab reload instead of a `null` context, as the commit message itself warns, so the discipline matters either way.)

**Source.** WebKit Bugzilla 195325 and commit 6bd11f3792 / 265628@main (commit message); pqina.nl "Total canvas memory use exceeds the maximum limit" (2022-01-12); developer.apple.com/forums thread 112218.

### 6.3 Sizing at devicePixelRatio 3 (worked numbers)

**Finding.** RGBA backing store costs 4 bytes per device pixel. Using the 4:5 contain-fit sizes from 1.2 (24 px gutters): iPhone 15/16 (3x) 1035 x 1294 = 1.34 MP = **5.4 MB**; 16 Pro/17 (3x) 1062 x 1328 = 1.41 MP = **5.6 MB**; 16/17 Pro Max (3x) 1176 x 1470 = 1.73 MP = **6.9 MB**; iPhone 11 (2x) 732 x 915 = 0.67 MP = **2.7 MB**; SE 2/3 (2x) 654 x 818 = 0.53 MP = **2.1 MB**. [I: arithmetic from assumed layout]

**Implication for us.** `backing = round(cssSize * min(devicePixelRatio, 3))`. Three canvases at the Pro Max size is about 21 MB, nowhere near the limits, so no need to cap at 2x. If frame time on a low-end phone ever suffers, drop to `min(dpr, 2)` (halves fill cost); expose this as a hidden setting, not a default.

**Source.** Own arithmetic; WebKit/pqina limits above; useyourloaf.com device sizes.

### 6.4 Context options

**Finding.** In Chrome and Firefox `getContext('2d', { alpha: false })` tells the engine the canvas is opaque. **WebKit does not implement the `alpha` member**: `CanvasRenderingContext2DSettings.idl` has it commented out under a "FIXME: Add support for 'alpha'", and MDN's data lists Safari and Safari on iOS as unsupported. On iPhone the option is silently ignored and the canvas stays transparent (transparent black after every `width`/`height` assignment) until something is painted. The 2D `desynchronized` option is listed in MDN's data as supported from Safari/iOS 15 (Chrome 81, not Firefox), but I found no evidence that it changes latency on WebKit. `willReadFrequently` (Safari 18) only matters if you call `getImageData`, which we never do. `OffscreenCanvas` exists from iOS 16.4. [V for the IDL and data; I for conclusions]

**Implication for us.** Passing `{ alpha: false }` is harmless (it helps on desktop test browsers) but must not be relied on: **always `fillRect` the paper colour** after each backing-store resize, after `clear`, and at the start of `redrawAll()`, and also give the `<canvas>` a CSS `background` of the paper colour so a not-yet-painted frame never shows the page behind it. Paper-colour fill is also what makes the eraser trivial (12.2) and keeps `toBlob` thumbnails from coming out with transparent backgrounds. Do not use `desynchronized`, do not use `getImageData`/`toDataURL` on the hot path. Thumbnails are made by re-rendering the stroke list into the scratch canvas at 1/4 size, then `toBlob` (iOS 11+).

**Source.** WebKit source `Source/WebCore/html/canvas/CanvasRenderingContext2DSettings.idl`; MDN browser-compat-data `api.HTMLCanvasElement.getContext.2d_context.options_alpha_parameter`, `options_desynchronized_parameter` and `options_willReadFrequently_parameter`, `api.OffscreenCanvas`, `api.HTMLCanvasElement.toBlob`.

### 6.5 The bitmap is a cache: re-render after purge, resize and restore

**Finding.** Reasons the bitmap may be gone or wrong: resize (cleared by the spec), page returned from the back-forward cache or after a content-process restart, or memory-pressure recovery. The first is certain; the others are defensive assumptions rather than documented WebKit behaviour. [V certain; I defensive]

**Implication for us.** The Canvas component owns `strokes[]` (the model) and `redrawAll()`. Call `redrawAll()` on: resize that changes backing size, `pageshow` with `event.persisted`, `visibilitychange` to visible, `inkSync` apply, undo, clear. Cost is small (section 15).

**Source.** HTML canvas size semantics; signature_pad README (data stored separately for redraw).

---

## 7. Resolution-independent coordinates and a fixed aspect ratio

### 7.1 Logical space

**Finding.** DESIGN section 11 already specifies normalised 0 to 1000 integer coordinates and a fixed aspect ratio, and the existing `js/core/session.js` clamps **both** x and y to 0..1000 (1.3). A portrait 4:5 box fits the typical free area on a 393 x 852 phone (width 345 with 24 px gutters, height about 450 to 560 after top bar, toolbar and safe areas) with at most a small letterbox on short phones such as the SE. [I; V for the session.js clamp]

**Implication for us.** Constants: `LW = 1000`, `LH = 1250` (4:5), `PAPER` colour opaque. This **extends** DESIGN's "0 to 1000" to 0..1250 on the y axis (square logical units, so a circle stays round); the alternative that keeps DESIGN literally is 0..1000 on both axes with non-square units (y unit = 1.25 x unit). Either is fine, but DESIGN section 11 and `normalizeInk` must be updated to match whichever is chosen, or the host will clip the bottom fifth of every drawing. The layout code computes the largest 4:5 rectangle inside the stage box, centred; the rest is letterbox. Every phone shows exactly the same picture, scaled.

**Source.** `D:\board_game\docs\DESIGN.md` section 11; `js/core/session.js` (`normalizeInk`); own layout arithmetic (1.2).

### 7.2 Contain-fit and orientation

**Finding.** Phones can be rotated and nothing a web page does on iOS can lock orientation: `screen.orientation.lock()` is not implemented, and the manifest `orientation` member is ignored **even for Home Screen web apps** (so the `orientation: portrait` now in our manifest has no effect on iPhone). A fixed 4:5 canvas in landscape becomes small: height-limited, at most 312 x 390 if it had the whole 390-high landscape viewport, realistically about 230 x 290 once the top bar and toolbar take their ~100 px. [V for orientation support; I for the sizes]

**Implication for us.** Accept the smaller landscape canvas rather than rotating the drawing; show a one-time "直向會畫得大啲" hint (or move the toolbar to the side in landscape to win back height). Compute the fit in a `ResizeObserver` callback.

**Source.** MDN browser-compat-data `api.ScreenOrientation.lock` and `manifests.webapp.orientation` (Safari iOS: not supported); firt.dev "PWA iOS" compatibility notes (`orientation` unsupported); `docs/research/platform-ios.md` (same finding); `manifest.webmanifest`.

### 7.3 Mapping and precision

**Finding.** 1000 logical units across 345 CSS px (393-wide phone, 24 px gutters) is about 0.35 CSS px per unit (about 1.04 device px at 3x). Rounding to integers introduces at most about 0.17 CSS px of error per point, which smoothing hides. [I: arithmetic]

**Implication for us.**

```js
function toLogical(e, rect) {
  const x = Math.round((e.clientX - rect.left) * (LW / rect.width));
  const y = Math.round((e.clientY - rect.top)  * (LH / rect.height));
  return [Math.min(LW, Math.max(0, x)), Math.min(LH, Math.max(0, y))];
}
```

If testing shows stair-stepping on very slow strokes, move to a 2000-wide grid (one more digit per number, deltas stay small); the protocol carries `LW` implicitly as a version constant (`v:1`).

**Source.** Own arithmetic; `docs/DESIGN.md` section 11.

### 7.4 Brush sizes in logical units, drawing through a transform

**Finding.** If the context transform maps logical units to backing pixels, `lineWidth`, curve control points and everything else are specified in logical units and scale automatically. [I]

**Implication for us.** After each backing-store resize: `ctx.setTransform(canvas.width / LW, 0, 0, canvas.height / LH, 0, 0)`; `ctx.lineCap = ctx.lineJoin = 'round'`. Tool widths (draw & guess, 3 sizes): **thin 4, medium 9, thick 20** logical units (1.4, 3.1, 6.9 CSS px on a 345-wide canvas); eraser = 3 x the selected width. Fake Artist: one fixed width (9). Colours are palette **indices** (0 = paper, 1 to 8 = pens), not hex strings; the palette is a shared constant.

**Source.** Own design; `docs/research/draw-guess.md` (3 widths, 8 colours, eraser, undo, clear).

### 7.5 Render what you send

**Finding.** If the drawer's phone renders raw float positions while viewers render the quantised integers, the pictures differ by up to about 0.17 CSS px and smoothing curves differ slightly. [I]

**Implication for us.** The drawer's `addSample` quantises first and renders **from the quantised points** through the same `drawNew()` used by viewers (section 9). One renderer, one set of numbers.

**Source.** Own design.

---

## 8. Stroke smoothing and simplification

### 8.1 Quadratic midpoints (render-time smoothing, streaming friendly)

**Finding.** Connecting raw pointer samples with straight segments looks faceted. The classic fix is to treat each raw sample as a quadratic **control point** and each midpoint between consecutive samples as the curve **end point**; the result is continuous in position and direction and needs no lookahead beyond the next sample. MDN documents `quadraticCurveTo(cpx, cpy, x, y)` as the primitive. Libraries such as signature_pad use Bezier interpolation (with velocity-based width), and perfect-freehand builds a variable-width polygon outline; both are heavier than we need. [V primitive; C for libraries]

**Implication for us.** Incremental form, drawing only what is new when point `k` arrives (`m_k` = midpoint of `p_{k-1}` and `p_k`; the very first curve starts at `p_0`):

```js
// s = { pts: flat absolute ints, n: points already drawn, cx,cy: current path position, px,py: previous point }
function advance(ctx, s, upTo) {
  ctx.beginPath();
  for (; s.n < upTo; s.n++) {
    const x = s.pts[2 * s.n], y = s.pts[2 * s.n + 1];
    if (s.n === 0) { s.cx = s.px = x; s.cy = s.py = y; continue; }
    const mx = (s.px + x) / 2, my = (s.py + y) / 2;
    ctx.moveTo(s.cx, s.cy);
    ctx.quadraticCurveTo(s.px, s.py, mx, my);
    s.cx = mx; s.cy = my; s.px = x; s.py = y;
  }
  ctx.stroke();                      // one stroke() call per stroke per frame
}
function finishStroke(ctx, s) {      // pen up: close the half-segment, or draw a dot (fillStyle = stroke colour)
  if (s.n === 1) { ctx.beginPath(); ctx.arc(s.px, s.py, s.w / 2, 0, 6.2832); ctx.fill(); return; }
  ctx.beginPath(); ctx.moveTo(s.cx, s.cy); ctx.lineTo(s.px, s.py); ctx.stroke();
}
```

The drawn tail lags the finger by half a segment (about 8 ms at 60 Hz) until the next sample or pen-up; invisible in practice. Set `strokeStyle`/`fillStyle` and `lineWidth` per stroke before the call. Use `arc` + `fill` for single-point dots rather than a zero-length line (cap rendering of zero-length segments is not something to depend on).

**Source.** MDN `CanvasRenderingContext2D.quadraticCurveTo`; github.com/szimek/signature_pad README; github.com/steveruizok/perfect-freehand README.

### 8.2 Ramer-Douglas-Peucker (RDP) is not a streaming algorithm

**Finding.** RDP needs the whole point list (it recursively keeps the point farthest from the chord if it exceeds epsilon), is O(n log n) typical and O(n^2) worst case, and can create self-intersections. Simplify.js (Agafonkin) combines a radial-distance pre-pass with RDP and defaults tolerance to 1 in coordinate units; its page motivates it with 70k-point lines and its demo (a long car route) computes the reduction live from a tolerance slider, so there is no single published reduction figure; its "high quality" mode skips the radial pass and is described as about 10 to 20 times slower. [V]

**Implication for us.** Not on the live path (we stream before the stroke is finished). Optional later use: **host-side compaction of finished strokes** at epsilon about 1 logical unit (about 0.35 CSS px, invisible) to shrink the replay log. My synthetic smooth-curve test kept only 4 to 11% of points at epsilon 1, but my paths were gentler than real doodles, so measure on real drawings before counting on it. At 5 bytes per point the live stream is already cheap, so RDP is a v2 nice-to-have, and if used it must run **before** the stroke is stored and relayed as final, or else the drawer's phone and the log disagree.

**Source.** Wikipedia "Ramer-Douglas-Peucker algorithm" (complexity, non-streaming, self-intersection); mourner.github.io/simplify-js and github.com/mourner/simplify-js; own synthetic benchmark (section 10.1 method).

### 8.3 Live decimation: drop duplicates only

**Finding.** After quantisation, consecutive samples are usually distinct unless the finger barely moves; a radial filter at 2 units kept 90 to 94% of points for slow strokes and 47 to 71% for fast ones in my simulation. signature_pad defaults to a 5 px minimum distance but that is for signature quality. [I for simulation; C for the library default]

**Implication for us.** Drop only samples equal to the previous quantised point. No distance threshold in v1 (it would visibly clip slow curves and saves little).

**Source.** Own simulation; signature_pad README.

### 8.4 Pressure and velocity width

**Finding.** Pressure is unusable on recent iPhones (5.2). Velocity-dependent width (signature_pad, perfect-freehand's simulated pressure) gives a nice brush feel but requires per-point width data or deterministic recomputation. [I]

**Implication for us.** Constant width per stroke in v1. If a "brush feel" is wanted later, derive width deterministically from point spacing on both drawer and viewers (no extra bytes), but note it breaks the 1-`stroke()`-per-frame batching unless drawn as polygons.

**Source.** WebKit source (force handling); signature_pad and perfect-freehand READMEs.

### 8.5 Opaque colours only

**Finding.** Drawing a stroke as many separate segments with a translucent colour shows darker dots where segments overlap. [I: standard canvas behaviour]

**Implication for us.** No highlighter or alpha brushes in v1. Eraser and pens are all opaque (also required for the paper-colour eraser).

**Source.** Canvas compositing semantics.

---

## 9. Rendering incoming points progressively

### 9.1 Model first, paint in `requestAnimationFrame`

**Finding.** Chrome aligns `pointermove`/`touchmove` dispatch to rAF; WebKit builds pointer events from touch delivery (2.1), and Safari's rAF runs near 60 fps even on 120 Hz iPhones (5.5). Network messages arrive at arbitrary times between frames. Drawing inside the message handler can paint more than once per frame. [V Chrome blog and WebKit preference; I for conclusion]

**Implication for us.** `onInk(msg)`: validate, append to the stroke model, set `dirty`, `requestAnimationFrame(paint)` if not scheduled. `paint()` drains the new points of every active stroke with one `stroke()` per stroke. The same function serves the drawer's own live strokes.

**Source.** developer.chrome.com "Aligning input events"; own design.

### 9.2 Pacing: a play-head instead of dumping a batch in one frame

**Finding.** Batches carry about 3 to 6 points covering about 50 ms; painting each batch in a single frame makes the line grow in 20 Hz steps. [I]

**Implication for us.** Keep per-stroke `backlog = pts.length - drawn`. Each frame draw `max(1, ceil(backlog * 0.34))` points, so a backlog of 6 drains over about 3 frames. This adds roughly 50 ms of display latency and makes growth smooth at 60 or 30 fps; if backlog exceeds ~60 points, draw everything immediately (catch-up after a stall or tab switch). Pacing is computed from elapsed frames, not timers (5.5). Make it a constant `PACE = 0.34` that can be set to 1 to disable.

**Source.** Own design (to be tuned on device).

### 9.3 Draw calls and when to redraw everything

**Finding.** Incremental painting costs O(new points). A full redraw costs O(all points) with one path and one `stroke()` per stroke (or per run of same-colour strokes). [I]

**Implication for us.** Full redraw only on: backing-store resize, undo, clear, snapshot apply, restore from background. Typical drawings (a few hundred strokes of a few dozen points) should redraw in a few milliseconds; verify on the slowest supported phone and, if needed, redraw over two frames. Group consecutive strokes of the same colour and width into one path only if profiling shows a need.

**Source.** Own design; test plan section 16.

### 9.4 Tab hidden and catch-up

**Finding.** Hidden pages get 1 s timer alignment and no rendering updates (5.5). Messages still arrive and update the model when the page is alive. [V]

**Implication for us.** The model keeps updating from messages; painting resumes on `visibilitychange` visible with an immediate `redrawAll()` (cheap, and it also repairs a purged bitmap, 6.5).

**Source.** WebKit `Page.cpp`/`DOMTimer.h`.

### 9.5 Nice to have: show whose pen is moving

**Finding.** Viewers see only the line, which can hide where the pen currently is. [I]

**Implication for us.** Optional: a small coloured dot plus name chip at the stroke head on an overlay layer (div positioned by transform, not canvas) for the active remote stroke; hidden on pen-up.

**Source.** Own design.

---

## 10. Compact serialisation and batching

### 10.1 Measured size of each encoding

**Finding.** I simulated finger strokes (smooth random curves, 60 and 120 Hz sampling, average speeds 150, 500 and 1000 CSS px/s on a 390 px canvas mapped to the 1000-unit grid, 40 strokes of 1.5 s per case) and measured JSON byte length per point. Results (bytes per point):

| Encoding | 60 Hz | 120 Hz | Notes |
|---|---|---|---|
| `[[x,y],...]` absolute pairs | 9.5 to 9.8 | 9.2 to 10.0 | |
| flat `[x,y,x,y,...]` absolute | 7.5 to 7.8 | 7.2 to 8.0 | |
| flat **delta** `[x,y,dx,dy,...]` | **4.8 to 5.3** | **4.6 to 4.7** | recommended |
| delta, zigzag, 5-bit base64 string | 2.1 to 2.4 | 2.0 to 2.2 | about 2.3x smaller, unreadable |

Typical deltas are within a few tens of units. **[I]**: synthetic strokes, treat as plus or minus 20%. An independent re-run by the fact-checker (different random curve model, 345 px canvas, same speeds and rates) gave 9.6 to 10.1 for pairs, 7.6 to 8.1 for flat absolute and **5.0 to 6.1** for flat delta: the ranking and the roughly 2x saving hold, the delta figure is about 10 to 15% higher than the table.

**Implication for us.** Flat delta int arrays in JSON. The base64-packed string is a documented option if replay snapshots ever get heavy (a 150-stroke drawing of 9,000 points is about 43 to 50 KB delta-encoded vs about 20 KB packed), but it is not worth the complexity in v1.

**Source.** Own simulation script (synthetic strokes, `JSON.stringify` byte length); fact-check re-run (Node, synthetic strokes); PeerJS JSON serialisation (11.2 below).

### 10.2 Envelope overhead dominates the payload

**Finding.** A typical 3-point batch `{"t":"ink","ep":3,"pid":"p2","s":17,"i":30,"p":[...]}` measured 63 bytes in total, of which the envelope alone (empty `p`) is 50 bytes; the full 10.4 shape with `v`, `cv`, `c`, `w`, `e` and `q` is about 89 bytes before points. At 120 Hz a 50 ms batch is about 6 points, which is about 28 to 35 bytes of payload against 50 to 89 bytes of envelope. Transport adds roughly 90 bytes per packet (IPv4 20 + UDP 8 + DTLS about 37 + SCTP 28). [I: arithmetic from header sizes]

**Implication for us.** Use short keys, send per-stroke constants (`c`, `w`) only in the first batch, omit fields the host knows (`pid` from client to host), and keep batches at about 50 ms rather than per frame. Total traffic per viewer is about 3 KB/s; host upload with 11 viewers plus echo is about 37 KB/s (about 0.3 Mbit/s). That is fine on LTE or a hotspot.

**Source.** Own measurement and arithmetic (RFC header sizes).

### 10.3 Batching interval and flush rules

**Finding.** With uplink and relay hops each around 20 to 100 ms in RTT terms, a 50 ms batch is below what players can perceive, and halving it doubles message count and PeerJS `JSON.stringify` calls (one per recipient). `docs/DESIGN.md` already says about 50 ms. [I]

**Implication for us.** Flush when **any** of: (a) `pointerdown` (send the first point immediately so the stroke appears fast), (b) at least **50 ms** since the last flush (checked in `pointermove` and rAF, plus fallback timer, 5.5), (c) 400 points buffered (hard cap per message, about 5 KB worst case), (d) `pointerup`/`pointercancel` (immediate, with the end flag). Expected end-to-end display latency is 150 to 350 ms (batch wait about 25 ms average, two network hops, pacing about 50 ms, frame about 8 to 16 ms). That suits a guessing game.

**Source.** `docs/DESIGN.md` section 11; own latency budget.

### 10.4 Message schema (proposed v1, a refinement of DESIGN section 8)

**Finding.** DESIGN section 8 defines `ink` as `{ pid, stroke, pts, end? }` and `inkSync`, with `inkEpoch` bumped by the engine, plus `docs/research/draw-guess.md` asking for a `canvasId` for team All Play. The current `js/core/session.js` implements exactly the DESIGN shape (with `color`, `width`, `eraser`) and an `inkSync` of `{ ink: { epoch, strokes } }` (1.3). [V project docs and code]

**Implication for us.** Refine as follows (client to host and host relay use the same shape; host adds `q`). This renames and re-encodes fields, so it is **not wire-compatible** with the current `normalizeInk`/`applyInkBatch`; DESIGN section 8 and those two functions change together.

```
{ t:'ink',  v:1, cv:0, ep:3, pid:'p2', s:17,          // cv = canvas id (team), ep = inkEpoch, s = stroke no. per pid
  i:0, c:2, w:9,                                       // i = index of first point in this batch; c,w only when i===0
  p:[512,433, 3,-2, 4,-1],                             // first point absolute, rest deltas (continues from last point)
  e:1,                                                 // end of stroke (pen up)   -- optional
  x:1,                                                 // discard stroke (cancel)  -- optional
  q:1043 }                                             // host sequence number (host -> clients only)

{ t:'ink', op:'undo',  cv:0, ep:3, pid:'p2', s:17, q:1044 }   // tombstone a stroke
{ t:'ink', op:'clear', cv:0, ep:3, q:1045 }                    // drop all strokes; epoch unchanged, q continues (12.4)
{ t:'inkSync', cv:0, ep:3, q:1045, part:0, of:3, ops:[ ...ink ops... ] }
{ t:'inkNeed', cv:0, ep:3, q:1040 }                            // client -> host: I am missing something / last q I applied
```

Rules: encoding is one flat array of `[dx,dy]` pairs; the very first pair of a stroke is a delta from (0,0), i.e. absolute, and every later pair, **including the first pair of later batches**, is a delta from the stroke's previous decoded point. Decoded positions must lie in `0..1000` x `0..1250`. `i` must equal the receiver's current point count; if it is lower the batch is an idempotent resend (skip the overlap), if higher it is a gap (send `inkNeed`). Every message is a JSON **object** (PeerJS's JSON handler indexes into it).

**Source.** `docs/DESIGN.md` sections 8, 11; `docs/research/draw-guess.md` (canvasId); PeerJS `Json.ts`.

---

## 11. PeerJS DataChannel specifics

### 11.1 The `reliable` flag only controls ordering

**Finding.** In PeerJS 1.5.4 the data channel is created with `{ ordered: !!options.reliable }` and **nothing else** (no `maxRetransmits`, no `maxPacketLifeTime`). The default for `reliable` is false, so a plain `peer.connect(id)` gives a channel that still retransmits fully but is **unordered**. [V]

**Implication for us.** Keep `reliable: true` (as `js/core/net.js` already does) for ink: the delta-chain and per-stroke indices assume order. A truly lossy/unordered "live cursor" channel is not possible through PeerJS options in this version (still true on PeerJS master / 1.5.5); skip it.

**Source.** PeerJS v1.5.4 `lib/negotiator.ts` (createDataChannel), `lib/peer.ts` (`connect` defaults to `serialization: "default"`), `lib/dataconnection/DataConnection.ts` (`this.reliable = !!this.options.reliable`); PeerJS master `lib/negotiator.ts`; `D:\board_game\js\core\net.js`.

### 11.2 JSON mode drops anything of 16,300 bytes or more, and `net.js` treats the resulting error as a dead peer

**Finding.** With `serialization: 'json'`, PeerJS encodes the string to UTF-8 and, if the byte length reaches the chunk limit (`byteLength >= util.chunkedMTU`, **16,300**, so the largest message that goes through is 16,299 bytes), emits an error of type `message-too-big` ("Message too big for JSON channel") on that DataConnection and **does not send** the message. There is no chunking in JSON mode (chunking exists only in the default binary serialisation). The host side of `js/core/net.js` (`HostNet`) wires `conn.on('error')` to the same `gone()` handler as `close`, deleting the connection from `conns` and emitting `peer-close`, even though the channel is still open; `HostNet.sendTo` even returns `true` for the dropped message because PeerJS reports the problem by event, not by exception. Also, `send()` on a not-yet-open connection emits a `not-open-yet` error, and if the browser's `RTCDataChannel.send()` itself throws, PeerJS closes the whole connection. [V]

**Implication for us.** (a) The ink layer enforces `JSON.stringify(msg).length <= 12000` (ASCII only, so length equals bytes) before every send, splitting by points (`MAX_PTS_PER_MSG = 400`) and snapshots by ops (13.1). (b) Harden `js/core/net.js`: in `HostNet`'s `conn.on('error')`, ignore errors whose `type` is `message-too-big` or `not-open-yet`, and let only a real `close` drop the peer. (c) Unit test: a 20,000-byte message must not remove the peer. (d) Fix the existing single-message `inkSync` in `js/core/room.js` (1.3) in the same change.

**Source.** PeerJS v1.5.4 `lib/dataconnection/BufferedConnection/Json.ts`, `lib/util.ts` (`Util extends BinaryPackChunker`), `lib/dataconnection/BufferedConnection/binaryPackChunker.ts` (`chunkedMTU = 16300`), `lib/dataconnection/BufferedConnection/BufferedConnection.ts` (`_trySend` closes on a throwing send), `lib/enums.ts` (`NotOpenYet = "not-open-yet"`, `MessageToBig = "message-too-big"`), `lib/dataconnection/DataConnection.ts`; `D:\board_game\js\core\net.js`, `js/core/room.js`.

### 11.3 SCTP message size and head-of-line blocking

**Finding.** Per MDN (citing RFC 8841), if the SDP carries no `max-message-size` attribute a default of 64 KB is assumed, and most modern browsers accept messages of at least 256 KB. Without message interleaving (RFC 8260), a big message delays everything queued behind it. The often-quoted "16 KiB between Chromium and Firefox" figure comes from lgrahl's 2016 to 2018 article (Firefox's deprecated PPID-based fragmentation of ordered reliable messages, which Chromium did not reassemble); MDN does not give that advice, and it is irrelevant between two iPhones (both WebKit). Safari exposes the negotiated limit as `pc.sctp.maxMessageSize` (15.4+). I did not find Safari's exact number in a primary source; WebKit uses libwebrtc, so it is probably the same 256 KiB as Chrome [I]. [V general; Safari value unverified]

**Implication for us.** The binding limit is PeerJS's own 16,300 B JSON cap (11.2), far below any SCTP limit; staying at or below ~12 KB per message also keeps head-of-line blocking short. Log `pc.sctp.maxMessageSize` once per connection during testing (via `conn.peerConnection`, a public field on PeerJS connections).

**Source.** developer.mozilla.org "Using WebRTC data channels" (message size section); lgrahl.de "Demystifying WebRTC data channel message size limits" (2016, updated 2018); MDN `RTCSctpTransport.maxMessageSize`; MDN browser-compat-data; PeerJS v1.5.4 `lib/baseconnection.ts` (`peerConnection`).

### 11.4 Ordered-reliable latency under loss

**Finding.** On an ordered reliable channel a lost packet stalls everything behind it until it is retransmitted (fast retransmit after a few duplicate acks, otherwise an RTO). At 20 messages per second a single loss typically stalls the stream for roughly one to three message intervals up to a few hundred milliseconds; cellular loss of 1 to 2% means a visible hiccup every few seconds at worst. [I: general SCTP behaviour, not measured on iOS]

**Implication for us.** Design for **bursty arrival**: the play-head pacer (9.2) already absorbs it, and the catch-up rule (draw all when backlog is big) prevents long lag. If field tests show nasty stalls, the v2 option is `reliable: false` (unordered but still reliable) with the existing `i` indices used to re-sequence per stroke; do not do it speculatively because the same connection carries `act` and `views`.

**Source.** General SCTP/WebRTC behaviour (MDN on head-of-line blocking); PeerJS 11.1; own reasoning.

### 11.5 Backpressure and slow viewers

**Finding.** PeerJS queues messages in an array when `dataChannel.bufferedAmount` exceeds 8 MiB and retries every 50 ms; the queue length is exposed as `conn.bufferSize`, and the `RTCDataChannel` itself is `conn.dataChannel`. The queue is unbounded. [V]

**Implication for us.** The host should check, per viewer, before relaying: if `conn.bufferSize > 30` or `conn.dataChannel.bufferedAmount > 64 KiB`, **skip live relay to that viewer** and mark it `needsSync`; when the buffer drains, send an `inkSync` snapshot instead of the backlog. This keeps one bad phone from consuming host memory and from receiving a long stale replay.

**Source.** PeerJS v1.5.4 `lib/dataconnection/BufferedConnection/BufferedConnection.ts`, `DataConnection.ts` (`MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024`).

### 11.6 Star relay including the sender

**Finding.** PeerJS stringifies per `send()`, so fan-out cost is one `JSON.stringify` + `TextEncoder` per viewer per message: at 20 msg/s and 11 viewers about 220 sends/s, trivial for the host's CPU. [I]

**Implication for us.** The host relays every accepted op to **all** seats on the canvas, **including the sender**. The echo acts as an acknowledgement: the drawer's phone applies it idempotently (strokes keyed by `pid:s`, points by `i`), learns the sequence number `q`, and can notice that something was rejected (a stroke that never came back). If team canvases are used, relay only to that team's seats (`cv`). Note: the current `js/core/room.js` `#relayInk` deliberately skips the sending device; switching to echo-as-ack is a behaviour change there.

**Source.** PeerJS `Json.ts`; own design; `docs/research/draw-guess.md` (relay only to team seats); `js/core/room.js` (`#relayInk`).

### 11.7 Backgrounded phones lose the channel

**Finding.** iOS suspends a page when Safari is backgrounded or the phone locks; the existing `js/core/net.js` comment notes signalling sockets "die silently when a phone sleeps" and has reconnect watchdogs. [V for the project note; I for the DataChannel consequence]

**Implication for us.** Treat any ink participant as "may vanish and come back" (section 13). Request a screen wake lock on the drawer and host while a canvas round is running (Safari tabs: 16.4+; Home Screen app: 18.4+; on 16.4 to 18.3 Home Screen apps the API exists and may even resolve, but the screen still dims, so use the fallback described in `platform-ios.md`), and release it on round end.

**Source.** `D:\board_game\js\core\net.js`; MDN browser-compat-data `api.Navigator.wakeLock` (standalone note, bug 254545); WebKit bug 254545 (comment from Jen Simmons: works in Home Screen web apps on iOS/iPadOS 18.4); caniuse `wake-lock` (lists 16.4 without the standalone caveat).

---

## 12. Undo, eraser and clear that stay in sync

### 12.1 Host-ordered op log (single authority)

**Finding.** Peers disagree only if operations can be applied in different orders. With a star topology and one authority, a single total order is free. [I]

**Implication for us.** Host keeps, per canvas and per epoch: `strokes[]` (each `{ pid, s, c, w, pts, ended, dead }`) and a counter `q`. Every accepted message gets `q = ++q`. Clients apply ops strictly in `q` order; a gap triggers `inkNeed`. The op set is only: stroke batch, `undo(pid,s)`, `clear`. No conflict resolution is needed.

**Source.** Own design; `docs/DESIGN.md` section 8 (`rev`) and section 11 (`inkEpoch`).

### 12.2 Eraser as a paper-colour stroke

**Finding.** Alternatives: (a) `globalCompositeOperation = 'destination-out'` (requires a transparent canvas and exact replay order), (b) object eraser (hit-test and delete whole strokes, needs tombstones plus geometry), (c) paint with the opaque background colour. [I]

**Implication for us.** (c). Eraser is a normal stroke with `c:0` (paper) and a larger width. It replays correctly in order, needs no special compositing, and costs nothing extra on the wire. It relies on the paper fill described in 6.4 (on WebKit `alpha:false` does nothing, so the explicit `fillRect` is what makes the canvas opaque). Cost: erased strokes still exist in the log (fine).

**Source.** Own design.

### 12.3 Undo

**Finding.** Draw & guess allows undo; Fake Artist rules have no undo (optional: owner only, before the next player starts). [V project docs]

**Implication for us.** `undo` message carries `pid` and optionally `s`; the host picks the last live stroke of that `pid` (or the exact `s`), sets `dead = true`, assigns `q`, relays. Clients mark it dead and `redrawAll()` (no incremental erase). The drawer's phone applies it optimistically and reconciles on echo. **Redo**: the drawer keeps undone strokes locally and "redo" re-sends them as a **new stroke** with a new `s`; no redo op exists.

**Source.** `docs/research/draw-guess.md` (undo allowed), `docs/research/fake-artist.md` (undo not in rules; optional restrictions).

### 12.4 Clear and new picture

**Finding.** DESIGN: the engine bumps `state.inkEpoch` to start a new picture. In-flight messages from the previous picture can still arrive. [V]

**Implication for us.** Every ink message carries `ep`. The host drops messages whose `ep` is not the current epoch (and tells the sender with `reject`). A manual "clear" button by the drawer sends `op:'clear'`; the host applies it as "drop all strokes, keep epoch, `q` continues" (confirm dialog on the drawer's phone to avoid fat-finger clears). Starting a new turn bumps the epoch and resets `q` to 0.

**Source.** `docs/DESIGN.md` section 11; `docs/research/draw-guess.md`.

### 12.5 Host validation rules

**Finding.** DESIGN section 11 says only seats with `view.canDraw` may ink and the host validates the sender. In the current code `Room.ink` checks that the seat exists, is not a spectator and belongs to the sending device, then `Session.ink` asks `engine.canInk(state, pid)` and caps the drawing at 12,000 points; a rejected batch makes the host push a (throttled) full `inkSync` back to the sender to undo its optimistic strokes, which is another single-message `inkSync` subject to the 11.2 cap. [V project docs and code]

**Implication for us.** Reject (drop silently, send `reject` once) when: sender device does not own `pid`; engine says that seat may not draw now; `ep` stale; `s` not greater than the highest seen for that `pid` in this epoch (new stroke) or not the open stroke (continuation); a continuation arrives for a stroke already ended; any coordinate outside `0..LW`/`0..LH`; more than 400 points in one message or more than 60 messages/s from a device; more than ~30,000 points per epoch. Fake Artist: only one stroke per turn; a second contact in the same turn is ignored; optional per-stroke length cap enforced by truncating at the cap (`maxLen`); too-short stroke (below about 12 units of extent) is discarded and the turn stays open.

**Source.** `docs/research/fake-artist.md` (one stroke per turn, zero-length taps, length caps); `docs/research/draw-guess.md` (only drawer inks, accidental one-point taps discarded); `docs/DESIGN.md` section 11; `js/core/room.js` (`ink`), `js/core/session.js` (`ink`).

---

## 13. Late joiner and reconnect replay

### 13.1 Snapshot = the op log replayed through the same pipeline

**Finding.** Because JSON messages must stay under about 12 KB (hard cap 16,299 bytes, 11.2), a whole drawing does not fit in one message (a 300-stroke drawing of 15,000 points is about 75 to 90 KB delta-encoded; the current `[[x,y]]` format at the existing 12,000-point cap is about 115 KB). [I]

**Implication for us.** `inkSync` is a sequence of messages each holding a slice of `ops` (stroke batches in the same format as live ones, dead strokes omitted, undo ops omitted), chunked greedily by `JSON.stringify(msg).length <= 12000` and by `part/of`. The client **buffers all parts and applies them atomically** on the last one: reset canvas, apply ops, `redrawAll()`, set `lastQ`. The host sends all parts **in one synchronous loop** and starts relaying live ops to that client only afterwards, so ordered delivery guarantees that live ops follow the snapshot.

**Source.** Own design; PeerJS `Json.ts` size cap.

### 13.2 Delta sync with `q`

**Finding.** A short drop (a few seconds) usually misses only a few ops. [I]

**Implication for us.** The client's `hello` (or `inkNeed`) carries `{ ep, q }` = last applied. If `ep` matches and the host's log still has `q+1`, send only the missing ops as a normal `inkSync` marked `delta:true`; otherwise send the full snapshot. v1 may ship full snapshots only (they are small), as long as the `q` fields are in the protocol from day one.

**Source.** Own design.

### 13.3 Drawer drops mid-stroke

**Finding.** A new PeerJS connection starts empty; anything buffered in the old connection is lost. [V for connection lifecycle in `js/core/net.js`, which re-dials with a fresh connection and has the host close the old one when the same peer reconnects]

**Implication for us.** The drawer's Canvas keeps its full local stroke list. After reconnect: apply the host's snapshot for the canvas, then, if a local stroke is still open (`ended` false, host's version has fewer points), **resend from the host's point count** (`i = host count`); if host has more or equal, skip. If the pen is still down, continue; if the finger lifted during the outage, send `e:1`. The host closes an open stroke whose drawer has been disconnected for 5 s (`ended = true`) so it can never block turn progression.

**Source.** `D:\board_game\js\core\net.js`; own design.

### 13.4 Page lifecycle on iOS

**Finding.** `visibilitychange` fires on `document` when the page is backgrounded on every iOS in our range (BCD: partial from iOS 7, complete from 14.5; the gap was about not firing on navigation and not bubbling to `window` before 14); `pagehide`/`pageshow` (with `persisted`) work on all supported versions (iOS 4.2+). [V]

**Implication for us.** Listen on `document` (not `window`) for `visibilitychange`, and also on `pagehide`. On hidden: end any live stroke, send final batch if the channel is up. On visible or `pageshow`: `redrawAll()`; if the channel is not open, the `js/core/net.js` reconnect runs; after `open`, send `inkNeed`. Wake lock re-request on visible (the lock is released when the page is hidden).

**Source.** MDN browser-compat-data (`api.Document.visibilitychange_event`, `api.Window.pageshow_event`); `D:\board_game\js\core\net.js`.

### 13.5 Replay at reveal and thumbnails

**Finding.** `docs/research/fake-artist.md` wants round history with replayable strokes; `draw-guess.md` mentions an end-of-game gallery with thumbnails kept in host memory only. [V project docs]

**Implication for us.** Add an optional `t` (ms since stroke start, of the last point in the batch) per batch to enable timed replay; points inside a batch are assumed evenly spaced. This is 3 to 6 extra bytes per batch. Thumbnails: re-render `strokes[]` into the reused scratch canvas at 25% size, `toBlob`, then zero the scratch canvas.

**Source.** `docs/research/fake-artist.md`, `docs/research/draw-guess.md`; WebKit bug 195325 (zero canvas size).

---

## 14. Apple Pencil, palm and multi-touch (nice to have)

### 14.1 The audience uses iPhones

**Finding.** `pointerType` is `pen` for Apple Pencil (iPad) and `touch` for fingers; pen exposes pressure and, in Safari 18.2+, `altitudeAngle`/`azimuthAngle` (WebKit reports `altitudeAngle` as pi/2 for touch). Touch events additionally expose `touchType` `stylus` (iOS 10+). Apple Pencil is an iPad accessory, so on iPhones everything is `touch`. [V for the API; I for the iPhone statement]

**Implication for us.** Do not build pressure/tilt features. Keep `pointerType` generic: accept `touch`, `pen`, `mouse` (desktop testing). If an iPad joins as a viewer or drawer, it just works with fixed widths.

**Source.** MDN browser-compat-data (`api.PointerEvent.pointerType`, `altitudeAngle`, `api.Touch.touchType`); WebKit `PointerEventIOS.cpp`.

### 14.2 Rejecting accidental touches on a phone

**Finding.** WebKit exposes contact diameter as `width`/`height` (2 x radius) and `isPrimary`; "stationary" touches are reported as `pointermove`. The thumb of the holding hand can graze the screen edge. [V API; I scenario]

**Implication for us.** Rules: (a) accept `pointerdown` only if `isPrimary` and no stroke is active; (b) ignore every other `pointerId` until the active one ends; (c) **no contact-size threshold in v1**: I do not know what `width`/`height` a normal fingertip reports on current iPhones (UIKit's radius is approximate), so log them during device testing first and only then consider rejecting very large contacts (a palm) as a v2 rule; (d) ignore moves that do not change the quantised point. Rules (a), (b), (d) already cover the realistic phone case of a holding thumb touching down after the drawing finger.

**Source.** WebKit `PointerEventIOS.cpp`; W3C Pointer Events (`isPrimary`).

---

## 15. Performance pitfalls checklist

### 15.1 Do and do not

**Finding.** The common ways to make drawing feel bad on a phone are cheap to avoid. [I unless noted]

**Implication for us.**
- No `getBoundingClientRect()`, `offsetWidth`, `getComputedStyle` in `pointermove`/message handlers (forced layout); cache per stroke.
- Handlers only push numbers into arrays; painting is in rAF; serialisation is in a flush, not per sample.
- Do not clear and repaint the whole canvas per frame; incremental only.
- One `beginPath`/`stroke()` per stroke per frame, not per segment; no `shadowBlur`, `filter`, translucent colours.
- Do not assign `canvas.width`/`height` unless the target pixel size changed (it clears and reallocates).
- No `toDataURL`/`getImageData` in the hot path; thumbnails come from the model.
- No DOM writes that change layout during a stroke (timer text can update with `textContent` at 1 Hz in a fixed-size box).
- No `console.log` in handlers (slow when Web Inspector is attached).
- Avoid per-point object allocation: use flat number arrays, reuse buffers.
- Do not create canvases dynamically; zero the size of any you discard (6.2).
- `requestIdleCallback` is unavailable on iOS; use rAF or `setTimeout`.

**Source.** WebKit bug 195325 and pqina (canvas release); WebKit `Page.cpp` (throttling); MDN browser-compat-data (`requestIdleCallback`); general canvas practice.

---

## 16. Device test plan and instrumentation

### 16.1 What to verify on real phones

**Finding.** Several conclusions above are inferences or rest on conflicting sources. [I]

**Implication for us.** Test on at least: one iOS 16 phone (the floor), one iOS 18.0/18.1 (no coalesced), one iOS 18.2+ and the newest iOS (26.x/27.x); one 2x device (SE 2/3 or iPhone 11) and one 3x, ideally one 120 Hz ProMotion phone; each in a Safari tab **and** as a Home Screen app (orientation, wake lock and edge-swipe behaviour differ). Load the page over HTTPS (GitHub Pages or a tunnel), not plain-HTTP LAN, or `getCoalescedEvents` is absent (5.1). Checklist:

1. Drawing never scrolls the page or collapses the toolbar; no pinch zoom; no pull-to-refresh/bounce (start on canvas, top bar and toolbar). On iOS 26+, also check that the bottom toolbar is not hidden under Safari's floating tab bar.
2. Hold still 1 s on canvas, and separately **tap then immediately press and hold** (WebKit bug 296492): no loupe, callout or selection (repeat after Low Power Mode on).
3. Pointer events still flow with the touch `preventDefault()` guard installed.
4. Log `e.getCoalescedEvents().length` and `performance.now()` deltas to learn the real sampling rate per device (my numbers for 60/120 Hz are assumptions), and the rAF rate (expected near 60 even on ProMotion, about 30 in Low Power Mode).
5. `pressure`, `width`, `height` values for a finger on a 3D Touch phone (8/X/XS) and on a newer one.
6. `pc.sctp.maxMessageSize` on iPhone-to-iPhone; send a 20 KB message and verify the host does not drop the peer after the `js/core/net.js` fix; send an `inkSync` for a 2,000-point drawing and confirm it arrives (fails today, 1.3).
7. Fresh canvas before the first stroke and right after rotation: paper colour, never transparent/black (6.4).
8. Background the drawer for 10 s and 60 s mid-stroke; return; confirm resync and no duplicate points.
9. Rotate mid-stroke and between strokes, in a tab and as a Home Screen app (the manifest cannot lock portrait); confirm redraw.
10. 12 viewers on a hotspot; measure display latency (screen record both phones side by side) against the 150 to 350 ms estimate.
11. Redraw time for a 500-stroke drawing on the slowest phone.

**Source.** Sections 3 to 13 above.

---

## 17. Recommended concrete design

### 17.1 Modules (suggested layout under `js/core/`)

- `ink-model.js`: stroke list, op application, delta encode/decode, `q`/epoch bookkeeping. Pure, testable under Node.
- `ink-render.js`: `fit()`, `redrawAll()`, `advance()`/`finishStroke()`, pacer.
- `ink-input.js`: pointer pipeline, palm/multi-touch rules, batch builder.
- `ink-host.js`: validation, op log, relay, snapshot chunking, slow-viewer handling (plugs into the host session where `room.ink` lives).
- `Canvas` component (DESIGN section 10) wires these to the DOM and toolbar.

### 17.2 Constants

| Name | Value |
|---|---|
| `LW` x `LH` | 1000 x 1250 (4:5) |
| backing scale | `min(devicePixelRatio, 3)`, area cap 4 MP |
| widths (logical) | 4 / 9 / 20; eraser 3 x |
| palette | index 0 = paper, 1 to 8 = pens (fixed per player in Fake Artist) |
| `BATCH_MS` | 50 (first batch and pen-up immediate) |
| `MAX_PTS_PER_MSG` | 400 |
| `MAX_MSG_BYTES` | 12,000 (hard PeerJS limit: messages of 16,300 bytes or more are refused) |
| `PACE` | 0.34 of backlog per frame; catch-up at backlog > 60 |
| gutters | 24 px left/right, bottom toolbar above `safe-area-inset-bottom` |
| resize debounce | 100 ms |
| host buffer gates | `bufferSize > 30` or `bufferedAmount > 64 KiB` -> resync later |

### 17.3 DOM and CSS skeleton

```html
<section class="screen draw active">
  <header>timer / word mask</header>
  <div class="stage">          <!-- flex:1; ResizeObserver here; padding-inline: max(24px, env(safe-area-inset-left)) -->
    <canvas></canvas>          <!-- CSS size = contain-fit 4:5; display:block -->
  </div>
  <footer>tools (colours, 3 widths, eraser, undo, clear)</footer>
</section>
```

CSS from 3.2 plus: `canvas { display:block; background: var(--paper); touch-action:none; -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; }` (the CSS background covers the moment between a resize and the paper `fillRect`, since `alpha:false` is ignored on WebKit, 6.4). Unprefixed `user-select` is not supported by Safari on iOS; the `-webkit-` form is the one that works.

### 17.4 Input pipeline (sketch)

```js
canvas.addEventListener('pointerdown', (e) => {
  if (active || !e.isPrimary || !canDraw()) return;
  if (looksLikePalm(e)) return;                           // v1: always false (no contact-size rule yet, 14.2)
  e.preventDefault(); document.activeElement?.blur?.();
  rect = canvas.getBoundingClientRect();                  // one layout read per stroke
  canvas.setPointerCapture?.(e.pointerId);
  active = Ink.beginStroke(e.pointerId, tool);            // allocates s, c, w; local model + renderer
  push(e); flush(true);
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (!active || e.pointerId !== active.id) return;
  const list = e.getCoalescedEvents?.() ?? [];
  for (const c of (list.length ? list : [e])) push(c);   // quantise, drop duplicates, append
  maybeFlush();                                           // >= BATCH_MS or >= MAX_PTS
});

const end = (cancel) => (e) => {
  if (!active || e.pointerId !== active.id) return;
  if (cancel) active.cancelled = true;
  flush(true, { end: true, cancel });
  active = null;
};
canvas.addEventListener('pointerup', end(false));
canvas.addEventListener('pointercancel', end(true));
canvas.addEventListener('lostpointercapture', end(true));
```

`push()` converts with `toLogical`, appends the point to the local stroke (rendered through `advance()`), and queues the **delta** for the next batch; `flush()` builds the message with `i`, checks `JSON.stringify(msg).length <= MAX_MSG_BYTES` (split if needed) and sends via the host/client transport. Local rendering never waits for the network.

### 17.5 Host rules (summary)

1. Validate (12.5). 2. Apply to the op log and assign `q`. 3. Relay to all seats on that canvas (including the sender), skipping slow viewers (11.5). 4. On `hello`/`inkNeed`: snapshot or delta (13). 5. Close orphaned open strokes after 5 s of drawer absence. 6. On epoch bump: clear log, reset `q`, broadcast epoch via normal views.

### 17.6 Viewer pipeline

Receive -> check `ep`/`q` order (gap -> `inkNeed`) -> apply to model (idempotent by `pid:s` and `i`) -> mark dirty -> rAF `paint()` with play-head pacing -> on undo/clear/sync/resize/visibility: `redrawAll()`.

### 17.7 Delivery phases

- **v1 (ship):** everything above except predicted events, RDP, packed strings, velocity width, delta sync (full snapshots only, but `q` present), remote pen-head dot.
- **v2:** delta sync, host-side RDP compaction, timed replay UI, thumbnails gallery, optional unordered channel if field data demands it.
- **Hardening before v1:** the `js/core/net.js` change for `message-too-big`/`not-open-yet` (11.2) with a test; chunked `inkSync` in `js/core/room.js` (today one message, 1.3 and 13.1); reconcile the y range (`LH`) with `normalizeInk` (7.1); paper fill on every redraw (6.4); the device checklist (16.1).

### 17.8 Open questions to settle with the game docs

1. Canvas orientation and ratio: 4:5 portrait is assumed; should Fake Artist use a larger/square sheet for more room per stroke? (Changes `LH` only.)
2. Team All Play: one `cv` per team, relayed only to team seats; confirm host memory budget for several logs.
3. Fake Artist per-stroke length cap (`maxLen`) and min-stroke threshold values.
4. Whether to persist the ink log across a host page reload (if the host persists engine state, the log must go in the same snapshot).
5. Accessibility alternative for players who cannot draw on a phone (paper mode already exists in the game docs).

---

## Sources

| Short name | URL |
|---|---|
| MDN browser-compat-data (queried locally 2026-10-03) | https://github.com/mdn/browser-compat-data |
| caniuse getCoalescedEvents | https://caniuse.com/mdn-api_pointerevent_getcoalescedevents |
| caniuse touch-action | https://caniuse.com/css-touch-action |
| caniuse wake lock | https://caniuse.com/wake-lock |
| caniuse pointerrawupdate | https://caniuse.com/mdn-api_element_pointerrawupdate_event |
| WebKit blog Safari 18.2 features | https://webkit.org/blog/16301/webkit-features-in-safari-18-2/ |
| WebKit blog STP 202 notes | https://webkit.org/blog/15798/release-notes-for-safari-technology-preview-202/ |
| WebKit blog Safari 13 features (Pointer Events) | https://webkit.org/blog/9674/new-webkit-features-in-safari-13/ |
| WebKit blog Safari 16.0 features | https://webkit.org/blog/13152/webkit-features-in-safari-16-0/ |
| WebKit blog Safari 15.4 features (dvh) | https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/ |
| WebKit source: iOS touch recogniser | https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/ios/WKTouchEventsGestureRecognizer.mm |
| WebKit source: iOS PointerEvent | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/ios/PointerEventIOS.cpp |
| WebKit source: passive quirk | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Quirks.cpp |
| WebKit source: EventTarget | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/EventTarget.cpp |
| WebKit source: preferences | https://github.com/WebKit/WebKit/blob/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml |
| WebKit source: ImageBuffer | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/ImageBuffer.cpp |
| WebKit source: Page (throttling) | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/Page.cpp |
| WebKit source: DOMTimer | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/DOMTimer.h |
| WebKit bug 195325 (canvas memory) | https://bugs.webkit.org/show_bug.cgi?id=195325 |
| WebKit bug 233417 (touch-action vs toolbar) | https://bugs.webkit.org/show_bug.cgi?id=233417 |
| WebKit bug 133112 (touch-action) | https://bugs.webkit.org/show_bug.cgi?id=133112 |
| WebKit bug 231161 (iOS 15 loupe) | https://bugs.webkit.org/show_bug.cgi?id=231161 |
| WebKit bug 176454 (overscroll-behavior) | https://bugs.webkit.org/show_bug.cgi?id=176454 |
| WebKit bug 243452 (overscroll limitation) | https://bugs.webkit.org/show_bug.cgi?id=243452 |
| Apple forums: touch-callout iOS 15 | https://developer.apple.com/forums/thread/691021 |
| Apple forums: touch-callout iOS 26.1 | https://developer.apple.com/forums/thread/808606 |
| Apple forums: total canvas memory | https://developer.apple.com/forums/thread/112218 |
| Apple Safari Web Content Guide: Handling Events | https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html |
| Patrick H. Lauke, Getting touchy | https://patrickhlauke.github.io/getting-touchy-presentation/ |
| W3C Pointer Events | https://w3c.github.io/pointerevents/ |
| MDN touch-action | https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action |
| MDN overscroll-behavior | https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior |
| MDN getCoalescedEvents / getPredictedEvents | https://developer.mozilla.org/en-US/docs/Web/API/PointerEvent/getCoalescedEvents |
| MDN quadraticCurveTo | https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/quadraticCurveTo |
| MDN Using WebRTC data channels | https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels |
| MDN RTCSctpTransport.maxMessageSize | https://developer.mozilla.org/en-US/docs/Web/API/RTCSctpTransport/maxMessageSize |
| lgrahl WebRTC message size | https://lgrahl.de/articles/demystifying-webrtc-dc-size-limit.html |
| Chrome: aligning input events | https://developer.chrome.com/blog/aligning-input-events |
| PeerJS 1.5.4 source | https://github.com/peers/peerjs/tree/v1.5.4/lib |
| pqina: canvas area limit | https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/ |
| pqina: total canvas memory | https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/ |
| Wikipedia RDP | https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm |
| Simplify.js | https://mourner.github.io/simplify-js/ |
| perfect-freehand | https://github.com/steveruizok/perfect-freehand |
| signature_pad | https://github.com/szimek/signature_pad |
| Ben Frain, body scroll on iOS | https://benfrain.com/preventing-body-scroll-for-modals-in-ios/ |
| Babylon.js forum, hold selects canvas | https://forum.babylonjs.com/t/prevent-unwanted-inputs-in-ios-safari-hold-click-selects-canvas/21409 |
| AbilityNet shake to undo | https://mcmw.abilitynet.org.uk/how-to-disable-shake-to-undo-in-ios-16-on-your-iphone-or-ipad |
| useyourloaf iPhone 16 sizes | https://useyourloaf.com/blog/iphone-16-screen-sizes/ |
| useyourloaf iPhone 17 sizes | https://useyourloaf.com/blog/iphone-17-screen-sizes/ |
| WebKit source: canvas area limit | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/CanvasBase.cpp |
| WebKit commit 276145@main (iOS canvas 8192 x 8192, bug 271002) | https://github.com/WebKit/WebKit/commit/d1f63c061e |
| WebKit commit 265628@main (canvas memory limit removed, bug 195325) | https://github.com/WebKit/WebKit/commit/6bd11f3792 |
| WebKit source: 2D context settings IDL (`alpha` FIXME) | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/canvas/CanvasRenderingContext2DSettings.idl |
| WebKit source: PointerEvent IDL | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/PointerEvent.idl |
| WebKit source: AnimationFrameRate | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/graphics/AnimationFrameRate.h |
| WebKit source: EventHandler (touch to pointer dispatch) | https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/EventHandler.cpp |
| WebKit bug 296492 (loupe regression, tap then hold) | https://bugs.webkit.org/show_bug.cgi?id=296492 |
| WebKit bug 254545 (wake lock in Home Screen apps) | https://bugs.webkit.org/show_bug.cgi?id=254545 |
| WebKit blog: More Responsive Tapping on iOS | https://webkit.org/blog/5610/more-responsive-tapping-on-ios/ |
| firt.dev PWA on iOS notes | https://firt.dev/notes/pwa-ios/ |
| Wikipedia iOS 9 (Shake to Undo toggle) | https://en.wikipedia.org/wiki/IOS_9 |
| caniuse full data (iOS version list, `pointer`) | https://github.com/Fyrd/caniuse/blob/main/fulldata-json/data-2.0.json |
| npm registry: peerjs | https://registry.npmjs.org/peerjs |
| Project files | `D:\board_game\docs\DESIGN.md`, `index.html`, `css/base.css` (legacy `styles.css`), `js/core/net.js` (legacy `js/net.js`), `js/core/session.js`, `js/core/room.js`, `js/core/shake.js`, `js/ui/components/Canvas.js`, `manifest.webmanifest`, `docs/research/draw-guess.md`, `docs/research/fake-artist.md`, `docs/research/platform-ios.md` |

## Verification ledger (what is and is not proven)

- **Read directly today**: PeerJS 1.5.4 sources (ordered flag, JSON cap, chunk size, backpressure), WebKit iOS sources (coalesced via UIKit for touch 0 only, force/radius mapping, passive quirk and its "only when `passive` is unspecified" condition, canvas area limit in `CanvasBase.cpp`, `alpha` not implemented, Low Power Mode timer alignment, 60 fps rendering preference), MDN compat data and caniuse for the version matrix, W3C Pointer Events semantics.
- **Secondary/community**: canvas total memory MB numbers, loupe/callout regressions on iOS 15 and 26.1, shake-to-undo mechanism, iPhone screen sizes, edge swipe behaviour.
- **Conflicting**: none outcome-changing left inside the iOS 16+ range (see "Common variants" below for the minor ones).
- **Not verified, needs a phone**: real touch sampling rate and coalesced counts, `pressure` on current iPhones, Safari's `maxMessageSize`, `preventDefault()` on touch not suppressing pointer events, loupe suppression on current iOS, redraw timing of large drawings, and the latency estimate.
- Web search budget ran out partway through the research, so Safari-specific data channel size limits and background-suspension behaviour of WebRTC on iOS remain unsourced.

## Common variants (where sources disagree)

- **`touch-action: none` on iOS 13 to 15**: datasets say supported from 13; old forum lore says otherwise. Moot under the iOS 16 floor; the JS guard stays regardless.
- **Wake lock in Home Screen apps**: caniuse and firt.dev list 16.4 with no caveat; BCD and WebKit bug 254545 say it only works in Home Screen apps from 18.4. This doc follows BCD and the bug record.
- **`OffscreenCanvas`**: caniuse marks 16.2 as partial (2D only) and 17.0 full; BCD and the WebKit 16.4 notes say 16.4. Irrelevant for us (thumbnails only).
- **Total canvas memory cap on old iOS**: 224, 256 or 384 MB depending on the report and device; removed upstream in 2023.
- **Logical y range**: DESIGN section 11 and `session.js` use 0..1000 on both axes; this doc proposes 0..1250 on y for square units. Both work; the team must pick one (7.1).
- **Who receives the echo**: current `room.js` skips the sender; this doc recommends echo-as-ack (11.6).

## Verification

Fact-checked 2026-10-03 UTC by an independent pass, using different sources from the original where possible (WebKit source and git history instead of blog posts, Bugzilla records read directly, a fresh BCD 8.1.4 download dated 2026-10-01, caniuse raw data, the spec's own IDL, the PeerJS tag sources, and the current working tree). Web search was unavailable (budget exhausted), so all checks used direct fetches.

**Checked and confirmed (no change):** Pointer Events, `touch-action` values, `visualViewport`, `ResizeObserver`, `aspect-ratio`, dynamic viewport units, `RTCSctpTransport.maxMessageSize`, `overscroll-behavior` (partial, bug 243452 still open), `navigator.wakeLock` 16.4/18.4, `OffscreenCanvas`, `reset()`, `getCoalescedEvents`/`getPredictedEvents` 18.2 (Safari 18.2 blog and STP 202), `pointerrawupdate` unsupported, `requestIdleCallback` unavailable on iOS, GestureEvent iOS 2+, `-webkit-touch-callout` iOS 2+, the BCD note on `getBoundingClientRect` under zoom, `PointerEventIOS.cpp` mapping (width/height = 2 x radius, pressure = force, `stationary` -> `pointermove`), coalesced/predicted only for touch index 0 (FIXME 284852) and `force / maximumPossibleForce`, DOMTimer alignment constants (0 / 30 ms / 1 s) and Low Power Mode at 30 fps, PeerJS `ordered: !!reliable`, `reliable` default false, JSON cap 16,300 with `>=`, error type strings, 8 MiB `MAX_BUFFERED_AMOUNT` and 50 ms retry, `conn.peerConnection`; bug 233417 (toolbar fix in iOS 16.0); bug 231161 (fixed by final iOS 15.2); double-tap zoom disabled on `width=device-width` pages at initial scale and by `manipulation` (WebKit blog 5610); W3C implicit capture, `lostpointercapture` ordering and empty coalesced lists for non-move events; iPhone 15/16 viewport sizes; RDP complexity; the encoding size table (re-run, within its stated +/-20%).

**Changed:**
1. Passive-listener quirk: only applies when `passive` is unspecified; an explicit `{ passive: false }` on `body` works (0, 2.3).
2. Version floor: iOS 13 -> project floor iOS 16 (per `platform-ios.md`; the code already needs iOS 15 for private methods, the sketches need 13.4 and the CSS 14.5) (0, 1.1, 3.1, 3.2, 16.1).
3. iOS canvas area limit: was attributed to `ImageBuffer.cpp` clamp constants; it is `CanvasBase.cpp` `maxCanvasArea()`, 4096 x 4096 until 2024-03-15 and 8192 x 8192 since (1.1, 6.1).
4. Total canvas memory: the 2023 WebKit change removed the cap entirely rather than fixing release timing (6.2).
5. `alpha: false` is not implemented in WebKit; added mandatory paper fill and CSS background (0, 1.1, 6.4, 12.2, 17.3).
6. Only `getCoalescedEvents()` is `[SecureContext]`, not `getPredictedEvents()`; plain-HTTP LAN testing loses coalesced events (5.1, 16.1).
7. The Pointer Events spec does not say pointer events precede or are independent of touch events; claim removed, kept as a device test (4.2).
8. Apple forum thread 691021 reported two working fixes, not one (4.2).
9. WebKit bug 296492 specified: iOS 18 tap-then-hold loupe, CSS cannot stop it, still open; added to tests (4.1, 16.1).
10. Shake to Undo toggle exists since iOS 9, not iOS 16 (4.3).
11. Manifest `orientation` and `screen.orientation.lock()` are not supported on iOS even for Home Screen apps; the new `orientation: portrait` in our manifest has no effect (1.1, 1.3, 7.2).
12. `visibilitychange` exists from iOS 7 (complete per BCD from 14.5); listen on `document` (1.1, 13.4).
13. `pointerrawupdate` "through 27.2": 27.1/27.2 are caniuse's projected columns (1.1).
14. WebKit bug 133112 was misdescribed as listing `none` unimplemented in 2019; a WebKit engineer confirmed iOS 13 `touch-action` support and the bug was closed (3.1).
15. The 16 KiB Chromium/Firefox interop figure is from a 2016 to 2018 article, not MDN; MDN now says at least 256 KB in modern browsers (11.3).
16. Project facts updated to the current tree: `css/base.css`, `js/core/net.js` (`HostNet.sendTo` returns true for a refused message), `.screen` no longer hidden by CSS, PeerJS 1.5.5 exists (1.3, 3.2, 3.6, 11.x).
17. New finding: existing `js/core/room.js` sends `inkSync` as one message (up to about 115 KB at the 12,000-point cap), which PeerJS refuses above 16,299 bytes and which then makes the host evict the peer; `session.js` clamps y to 0..1000 (1.3, 7.1, 12.5, 13.1, 17.7).
18. Gutter inconsistency: 1.2 computed sizes with 16 px gutters while the design uses 24 px; recomputed 1.2, 6.3, 7.3, 7.4, 7.5, 8.2, added iPhone 17/Air/16e/11 sizes and the 2x XR/11, narrowed the width range to 375 to 440.
19. Landscape canvas estimate now subtracts the top bar and toolbar (7.2).
20. Safari runs rAF near 60 fps even on ProMotion iPhones by default (5.5, 9.1, 16.1).
21. Pressure: noted the spec's 0.5 rule and that 3D Touch phones are still inside the range (5.2).
22. Internal contradiction fixed in 0.7 and the 10.4 schema comment, which said `clear` bumps the epoch, while 12.4 says a manual clear keeps the epoch and only a new turn bumps it (12.4 kept); the schema is labelled as not wire-compatible with `session.js`.
23. 10.2 envelope sizes split into envelope (50 / 89 bytes) vs payload; 10.1 cross-reference fixed (7.3 -> 11.2); Simplify.js "95% on 70k points" softened (live demo, no fixed figure).
