# iPhone / iOS Safari platform constraints (research: platform-ios)

> Researched 2026-10-03 UTC. Targets: iOS 16.0 up to iOS 27 (Safari 16 to 27), both a normal Safari tab and a
> Home-Screen web app (網頁 App / 主畫面 App, "PWA"). All text below is paraphrased; the few quoted fragments are short and attributed.
>
> **Evidence tags** used at the start of each *Finding*:
> **[V]** verified against a primary source (WebKit source code, WebKit release notes, MDN browser-compat-data, an RFC, or a test I ran today);
> **[R]** reported by developers/community (forums, GitHub issues) but not confirmed by Apple;
> **[U]** unverified, derived by reasoning, or needs a real iPhone to confirm. Section 7 is the device test list that closes the [U] items.
>
> Version names: Safari/iOS jumped from 18 to 26 in 2025 (same number on every Apple OS). As of today Safari 27.0 release notes are
> published and the MDN compat data (build 2026-10-01) lists 27 as shipped, so "current" means iOS 27 (Safari 27), with iOS 26.x and 18.x still common on friends' phones.

---

## 0. Bottom line (read this first)

| # | Area | Verdict | Biggest risk | What we should do |
|---|---|---|---|---|
| 1 | Cantonese narration (廣東話旁白) | Best-effort only | Web Speech exposes only "system" voices; downloaded voices are reported missing on real iOS 18 devices; zh-HK availability on iOS 18/26/27 is **unverified** | Three tiers: system zh-HK voice with a user "試聽" confirmation, then pre-rendered Cantonese audio clips for fixed lines, then text/read-aloud mode |
| 2 | First `speak()` | Must be inside a tap | The repo's `narrator.prime()` speaks an empty, volume-0 utterance, which is a known way to wedge the iOS queue | Prime with a one-character, near-silent utterance and verify it ends |
| 3 | Screen lock / background | Hostile | Page suspension silently kills speech, WebSocket and DataChannel; no events | Wake Lock + foreground banner for the host, heartbeat + fast re-dial for everyone |
| 4 | Wake Lock | OK in Safari tab since 16.4; **broken in Home-Screen app until 18.4** | API exists but does nothing in standalone on 16.4-18.3, so feature detection lies | UA-gate the silent-video fallback for standalone < 18.4; re-acquire on `visibilitychange` |
| 5 | TURN relay | **Currently none works** | PeerJS' built-in TURN hostnames have no DNS records today; the `openrelayproject` public credentials in `js/core/net.js` are rejected | Owner decision needed (section 3.4); until then cellular-to-Wi-Fi and hotel-Wi-Fi pairs may not connect |
| 6 | Locked phone = dead DataChannel | ~30 s | PeerJS often does not emit `close`; host reclaim of its room id can take > 1.5 min | App-level liveness ping, re-dial with seat token; host reclaims with the **same PeerJS token** (instant) or else a loop that outlasts the signalling server's 60-90 s timeout (3.3) |
| 7 | Service Worker / PWA | Design in `sw.js` is sound | iOS Home-Screen apps are rarely closed so a waiting SW never activates; captive portals can poison the shell cache | In-app "新版本" prompt that sends `skip-waiting` when idle; validate cached HTML; vendor PeerJS |
| 8 | Icons | Wrong today | `index.html` still points `apple-touch-icon` at `icon.svg`; iOS wants PNG | Point it at `icons/icon-180.png` |
| 9 | DeviceMotion | Needs a tap, per process | Grant lives only in memory; relaunch of Safari/the Home-Screen app asks again; a denial cannot be re-asked until relaunch | Keep the explicit "enable shake" button; never persist "granted" |
| 10 | Chinese typing | IME composition bugs | Safari <= 26 fires the commit keystroke after `compositionend` with `isComposing` false | Never submit on Enter; ignore `input` while composing; 16 px+ inputs |

---

## 1. Web Speech API: `speechSynthesis` on iOS Safari

### 1.1 What it is underneath
- **Finding** [V]: `speechSynthesis` exists on iOS since 7. In WebKit's Cocoa port every `speak()` becomes an `AVSpeechSynthesizer` utterance. Voice choice goes first by `utterance.voice.voiceURI` (an AVFoundation voice identifier), and if that is missing, by a "voice for language" lookup, falling back to the device's current language when no `lang` is given. Note the detail: when a `voice` object **is** set, WebKit ignores `utterance.lang` entirely and uses the voice's own language for the fallback lookup; `utterance.lang` is only consulted when no voice (or a voice with an empty `voiceURI`) is set.
- **Implication for us**: Setting `utterance.lang = 'zh-HK'` is meaningful even when `getVoices()` shows nothing suitable (see 1.3), but only if `utterance.voice` is left unset; assigning a zh-TW voice "just in case" silently overrides the zh-HK request. Never rely on voice *names*; rely on `lang` (and keep `voiceURI` only as an opaque handle).
- **Source**: WebKit `PlatformSpeechSynthesizerCocoa.mm` (main), https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/cocoa/PlatformSpeechSynthesizerCocoa.mm ; MDN BCD `api.SpeechSynthesis` (iOS 7).

### 1.2 Only "system" voices are listed; downloaded ones are mostly invisible
- **Finding** [V]+[R]: WebKit only adds a voice to the list when AVFoundation flags it as a system voice (a private flag, not in Apple's public docs). Every voice is reported with `localService: true` and `default: true`, so those two fields cannot be used to choose. Apple's reply on its forums says Web Speech is expected to expose only pre-installed voices, not optional downloads. Developers report this got worse: iOS 16 lost many voices that iOS 15 had, iOS 17 showed some "compact" voices again, and on **real iPhones running iOS 18** (not the simulator) the compact voices vanished and only the low-quality "Eloquence" novelty set remained for the languages tested (Spanish, German). Chinese/Cantonese was not among the languages anyone tested in those threads.
- **Implication for us**: We cannot promise that the 善怡 (Sinji) voice a user downloads in Settings will show up in `getVoices()`. Treat zh-HK as "maybe" on iOS 18 and later until proven on hardware (section 7, test A1/A2). This is the single biggest risk to the "Cantonese narrator" feature, so the pre-rendered-clip fallback in 1.14 is not optional polish.
- **Source**: WebKit `PlatformSpeechSynthesizer::appendVoices` (same file as 1.1); Apple forums https://developer.apple.com/forums/thread/723503 and https://developer.apple.com/forums/thread/764438 .

### 1.3 Cantonese and fallback voices (names, language tags)
- **Finding** [R] (voice dump taken on iOS 13.1.1, names may have drifted): Apple's built-in Chinese voices are `zh-HK` Sin-Ji / Sinji (善怡, female, the only zh-HK voice in that dump), `zh-TW` Mei-Jia (美佳), `zh-CN` a voice whose identifier is Ting-Ting but whose display name shows as Tian-Tian (婷婷) plus two Siri-style voices (Li-mu, Yu-shu), and `ja-JP` Kyoko plus two Siri-style voices (O-ren, Hattori). Identifier styles seen: `com.apple.ttsbundle.Sin-Ji-compact` (iOS 13 era) and `com.apple.voice.compact.<lang>.<Name>` (iOS 17/18 era; the forum thread below shows it for Spanish voices, so the exact zh-HK identifier on current iOS is not confirmed). Display names and identifiers do not always match.
- **Implication for us**: Rank by `lang`: `zh-HK` (also accept `yue*`), then `zh-TW`, `zh-CN`, `ja`, `en` (the current `langRank()` in `js/core/narrator.js` does exactly this). Normalise `_` to `-` and lower-case before comparing. Mandarin (zh-TW/zh-CN) reading Cantonese text is intelligible-ish but wrong in tone and wording; Japanese or English voices reading Chinese characters are useless, so do not auto-pick them for Chinese text: show text instead.
- **Source**: gist of an iOS 13.1.1 `AVSpeechSynthesisVoice.speechVoices()` dump https://gist.github.com/Koze/d1de49c24fc28375a9e314c72f7fdae4 ; https://blog.ficowshen.com/page/post/39 ; Apple forum showing the `com.apple.voice.compact.*` identifier style (Spanish examples) https://developer.apple.com/forums/thread/764438 .

### 1.4 iOS 18+ may speak Mandarin even when asked for zh-HK
- **Finding** [R] (native API; **Web Speech effect [U]**): On iOS 18 (one thread reproduces it on 18.5) `AVSpeechSynthesisVoice` was reported to ignore the Chinese dialect requested in code and follow Settings > Accessibility > Spoken Content > Voices > Chinese > Spoken Language instead. One report says it happens on phones upgraded from iOS 17 or restored from a backup, not on a fresh iOS 18 install. It goes both ways: a second thread reports `zh-CN` text coming out in Cantonese, an Apple engineer asked for a Feedback report in January 2025, and the original poster said in March 2026 that it **still happens on iOS 26**. Since WebKit calls the same AVFoundation lookups, a zh-HK request could come out as Mandarin (or the reverse) depending on that setting.
- **Implication for us**: Do not trust our own `lang` choice to decide what the user hears. The "試聽" button should ask the human: 「你聽到嘅係：粵語 / 普通話 / 聽唔到」 and store the answer per device (`narrator.mode`). Hint text for 普通話: change the Spoken Language setting.
- **Source**: https://developer.apple.com/forums/thread/788218 ; https://developer.apple.com/forums/thread/772348 .

### 1.5 `getVoices()` timing and `voiceschanged`
- **Finding** [V]: `voiceschanged` is supported from iOS 16 (BCD). Historically Safari returned the list synchronously on the first call. In January 2026 WebKit made the voice-list fetch non-blocking: the first `getVoices()` can now return an **empty array**, then the engine fires `voiceschanged` once the list is ready (WebKit change 305673@main, with a layout test named "empty initial voice list"; the source comment ties the async API to OS 26.3 and later). The list is cached per `speechSynthesis` object and invalidated on each `voiceschanged`. WebKit also fires `voiceschanged` when the system's available-voices notification fires (for example after a voice download completes).
- **Implication for us**: Write the loader for both worlds: read `getVoices()` now; if empty, wait for `voiceschanged` with a 2-3 s timeout, then poll twice more (1 s apart) before giving up. Re-run Cantonese detection on every later `voiceschanged` so a just-finished download flips the UI to "ready" without a reload. `narrator.onVoices()` already supports this; the shell must call it.
- **Source**: WebKit PR 56589 https://github.com/WebKit/WebKit/pull/56589 ; `SpeechSynthesis.cpp` https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechSynthesis.cpp ; MDN BCD `voiceschanged_event`.

### 1.6 Voice list can be hidden by fingerprinting protection
- **Finding** [V]: `getVoices()` returns an empty list when the page's script is subject to WebKit's "script tracking privacy" for the speech category. Safari 26.0 stopped *known fingerprinting scripts* from reading the voice list (among other APIs such as 2D canvas readback), by default, and also stops them from setting long-lived storage. Which scripts count as fingerprinters is Safari's own classification (the 26.0 notes say "known" scripts); a plain first-party game script is unlikely to be classified, but we cannot see or appeal that list.
- **Implication for us**: Low probability, but "no voices" must not be treated as "device has no Cantonese": show the 試聽 test, and keep clips as a fallback (1.14).
- **Source**: `SpeechSynthesis.cpp` (above); WebKit Features in Safari 26.0 https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ .

### 1.7 The first `speak()` must be inside a user gesture (iOS only)
- **Finding** [V]: On iOS, a `speak()` call outside a user gesture is silently dropped (returns without queueing, no error event). The first `speak()` made *during* a gesture removes the restriction for the rest of that page's life (it is a flag on the window's `SpeechSynthesis` object). A reload re-arms it. Standalone Home-Screen apps follow the same rule.
- **Implication for us**: One explicit tap per page load must reach `speak()` synchronously (no `await` of network or timers before it). Put a "開啟旁白" button in the lobby of the narrating host; after it, cue-driven `speak()` calls from timers are fine. After a reload or the iOS killing the web view, show the button again.
- **Source**: `SpeechSynthesis.cpp` `speak()` (above). A GitHub issue from 2025 reports the same symptom: https://github.com/leaonline/easy-speech/issues/366 .

### 1.8 Priming with an empty or volume-0 utterance is risky
- **Finding** [R]+[V]: A developer PR reports that on iOS Safari an empty-string or `volume = 0` utterance can leave `onend` unfired and freeze the internal queue; their safe unlock is the text `'.'`, volume `0.01`, rate high. WebKit's own source has special handling because the platform does not report "started" for empty strings, and a WebKit PR (open, March 2026) is titled as "empty utterances don't fire start/end events". Because the queue is FIFO and the next utterance starts only after the previous one completes, a stuck head blocks everything behind it.
- **Implication for us**: `narrator.prime()` currently does `speak('')` with `volume = 0`. Change it to a single `'.'` (or a space-free punctuation mark) with `volume = 0.01`, `lang = 'zh-HK'`, then if no `end`/`error` arrives within ~1 s, call `cancel()`. The gesture restriction is already lifted at the moment `speak()` is called, so even a wedged primer only costs us the cancel.
- **Source**: https://github.com/Outtech105k/Multi-Voice-Timer/pull/8 ; https://github.com/WebKit/WebKit/pull/61219 ; WebKit Cocoa synthesizer source (empty-string comment).

### 1.9 Rate, pitch, volume
- **Finding** [V]: The Web Speech ranges (rate 0.1-10, default 1) are mapped like this: below 1, scaled against Apple's default rate; from 1 upward, interpolated between Apple's default and Apple's maximum. The arithmetic puts the Apple maximum at web rate **2**, so everything above 2 is effectively clamped. Pitch is passed as Apple's pitch multiplier (Apple's range is 0.5-2.0); volume 0-1 passes straight through.
- **Implication for us**: Offer only 0.7-1.3 in the UI (the code clamps to 0.5-1.6, fine). Slower than 1 is the useful direction for 廣東話 comprehension in a noisy room. Do not expect pitch changes to be large or consistent between voices.
- **Source**: `mapSpeechRateToPlatformRate` in `PlatformSpeechSynthesizerCocoa.mm` (above).

### 1.10 `onend` reliability, events and garbage collection
- **Finding** [V]+[R]: WebKit raises `end` when AVFoundation reports finish **or cancel**, and raises `error` (`canceled`) from `speechSynthesis.cancel()` for the current utterance. Before Safari 26.0, queued utterances did not get an error event when cancelled; Safari 26.0 fixed that. Word-boundary events are patchy; `pause`/`resume` events often do not arrive. Reports say holding no JavaScript reference to an utterance can let it be collected before it finishes and lose its handlers.
- **Implication for us**: Keep the current design in `narrator.js`: every `speak()` returns a promise that settles on `end`, `error`, `cancel()` or a length-based watchdog (`estimateMs`). Keep a reference to each utterance until it settles. Never base game flow on a particular event after `cancel()`. Never use boundary events for timing.
- **Source**: `SpeechSynthesis.cpp`, `PlatformSpeechSynthesizerCocoa.mm`; Safari 26.0 release notes (fix 148731039); https://talkrapp.com/speechSynthesis.html ; https://dev.to/jankapunkt/cross-browser-speech-synthesis-the-hard-way-and-the-easy-way-353 .

### 1.11 Queueing and the `cancel()` then `speak()` bug
- **Finding** [V]: The native queue is strictly FIFO, one utterance at a time. Until **Safari 27.0**, calling `cancel()` and then immediately `speak()` could drop the new utterance (release-note wording: `cancel()` removed utterances queued by later `speak()` calls). Safari 27.0 fixed this.
- **Implication for us**: On iOS 16-26 never write `cancel(); speak(next)` back to back. Either wait for the cancelled utterance's `end`/`error` plus about 150 ms, or defer the next `speak()` with `setTimeout(…, 200)`. Also keep our own queue: hand the engine one line at a time instead of piling five utterances into the native queue, so a cancel affects exactly one.
- **Source**: WebKit Features for Safari 27.0 (released 2026-09-17; resolved issues, fix 46151521) https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; the engine change is WebKit 309349@main (bug 191745, 2026-03-16): the platform's asynchronous cancel callback could complete the *next* utterance; `cancel()` now fires the current utterance's `error` synchronously and ignores stale callbacks.

### 1.12 `pause()`/`resume()`
- **Finding** [R]: Work through `pauseSpeaking(immediate)`/`continueSpeaking`, but the `paused` flag and events are unreliable across iOS versions; on some versions resume does nothing.
- **Implication for us**: Implement the host's 暫停 as "cancel and remember the cue; on resume, re-speak the cue from its start". Our pause is already generic at the session level (deadlines shift), so this fits.
- **Source**: https://dev.to/jankapunkt/cross-browser-speech-synthesis-the-hard-way-and-the-easy-way-353 ; WebKit source (pause/resume delegate wiring).

### 1.13 Screen lock, app switch and tab background
- **Finding** [V]+[R]: When the page is suspended, WebKit's `SpeechSynthesis::suspend()` cancels platform speech and clears the queue **without firing any events**. A third-party report (about a Safari extension, same engine) says speech stays dead after the app returns, until a reload or even a Safari restart, when it was interrupted mid-utterance. The Safari 18 era "Web Speech in the background" has no supported mode; background audio for web pages is a separate feature (see 1.16).
- **Implication for us**: The narrating host's phone must stay in the foreground and awake: Wake Lock (section 2) plus a persistent banner 「呢部手機做旁白，唔好鎖屏」. On `visibilitychange` back to visible, run a narrator health check: `cancel()`, speak a near-silent `'.'`, expect `start` within ~1.5 s; if not, show 「旁白卡住咗，㩒一下重設」 (the tap doubles as a fresh user gesture). While `document.hidden`, hold the cue clock instead of letting watchdogs expire (otherwise the game "narrates" silence).
- **Source**: `SpeechSynthesis::suspend/stopPlatformSpeech` in `SpeechSynthesis.cpp`; https://weboutloud.io/bulletin/speech_synthesis_in_safari/ .

### 1.14 Offline use, detection, and what to do when no Cantonese voice exists
- **Finding** [V]: All exposed voices are on-device, so speech needs no network (WebKit marks them local). A voice that must be downloaded needs a one-time data connection, outside our control.
- **Implication for us (decision tree)**:
  1. `hasCantonese()` (any voice with `lang` matching `zh-HK` or `yue*`) is true: enable 試聽 and let the user confirm what they hear (1.4).
  2. False: **still try** `lang = 'zh-HK'` with *no* `voice` set. By the WebKit code path, speech then asks AVFoundation for a voice for that language, and that lookup is not filtered by the "system voice" flag used for the list, so an installed-but-unlisted Cantonese voice might still be used **[U, inferred from code, needs test A2]**. Offer 試聽; if the human says 粵語, remember it.
  3. Still no Cantonese: show the install hint 「設定 → 輔助使用 → 語音內容 → 聲音 → 中文 → 粵語（香港）→ 善怡 下載」 (menu wording differs slightly between iOS versions [U]) and explain that on iOS 18 and later the voice may not be visible to websites even after download.
  4. Tier 2 narrator: **pre-rendered Cantonese clips** for fixed lines, generated offline once and committed as static files (cached by the service worker). Microsoft Azure neural voices `zh-HK-HiuMaanNeural`, `zh-HK-HiuGaaiNeural` (female) and `zh-HK-WanLungNeural` (male) exist for zh-HK. Rough size [U, estimate]: 150 short lines x 3 s at 48 kbps mono AAC is under 3 MB. Keep narration lines free of player names so every line can be a clip; names stay on screen. Use one persistent `Audio` element or one `AudioContext` unlocked by a tap (a new `Audio()` per line loses the gesture and is blocked on iOS).
  5. Tier 3: read-aloud mode (text on the host screen, a human reads it), already in DESIGN.md.
- **Source**: WebKit source; Microsoft Learn language support https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts ; https://github.com/odysseus-dev/odysseus/issues/5517 (per-utterance `new Audio()` blocked on iOS PWA).

### 1.15 Silent (ring/mute) switch
- **Finding** [R]+[V]: A 2019-era report says `speechSynthesis` on iOS Safari is silent when the physical mute switch is on, even at full volume. Web Audio (`AudioContext`) defaults to the "ambient" audio-session type, which follows the switch; an `<audio>`/`<video>` element defaults to "playback", which does not. Since Safari 16.4 `navigator.audioSession.type` can override this (values: `playback`, `transient`, `transient-solo`, `ambient`, `play-and-record`, `auto`). `audioSession.state` and its change event are not implemented on iOS. WebKit's speech code does not touch the audio session, so whether iOS 17+ speech obeys the switch is **[U]**. The existing `sfx.js` comment assumes Web Audio obeys the switch.
- **Implication for us**: We cannot read the switch position. First-run narrator onboarding: a 試聽 button plus a visible tip 「聽唔到？檢查機身側面靜音制，同埋音量」. Keep SFX and narration on the same channel behaviour so "if you hear one you hear the other": do **not** set `audioSession.type = 'playback'` globally. If the clips tier is used (HTML audio), those play even on silent, which is a difference to document, not to hide. Run test A4/A5.
- **Source**: https://talkrapp.com/speechSynthesis.html ; https://github.com/swevans/unmute ; W3C Audio Session spec https://w3c.github.io/audio-session/ ; MDN BCD `api.AudioSession` (16.4).

### 1.16 Interaction with Web Audio (ducking, suspension)
- **Finding** [V]+[U]: New `AudioContext`s start suspended until `resume()` is called from a user action. On iOS the state also becomes **`interrupted`** (not `suspended`) when the user leaves the page, locks the screen, or a call arrives; `resume()` brings it back, and in practice needs a tap. WebKit bug 261554 (AudioContext suspended in background even with `audioSession.type = 'playback'`) was fixed in iOS 17.5, which opens a keep-alive route for audio but is not a supported background mode for games. Nothing I found documents ducking between page audio and `speechSynthesis`; per the audio-session spec only `transient` ducks and `transient-solo` pauses others, and speech does not declare a type.
- **Implication for us**: `js/core/sfx.js` currently resumes only when `ctx.state === 'suspended'`, and drops sounds the same way, so after a lock/unlock it will miss the `interrupted` state. Use `ctx.state !== 'running'` in both places, listen to `statechange`, and re-resume on the next `pointerup`/`click` and on `visibilitychange`. Never overlap a narration line with SFX; lower SFX gain while the narrator speaks and test the mix (A6).
- **Source**: MDN `BaseAudioContext.state` https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state ; MDN BCD AudioContext note; https://bugs.webkit.org/show_bug.cgi?id=261554 ; https://github.com/fischnall3r/sadiss/issues/134 ; W3C Audio Session spec.

### 1.17 Audio unlock gesture detail
- **Finding** [R]: Howler.js, a widely used audio library, listens for `touchstart`, `touchend`, `click` and `keydown` to unlock mobile audio, and re-checks that the context really reached `running` before removing its listeners. Apple does not publish exactly which events count.
- **Implication for us**: `sfx.js` unlocks on `pointerdown` only and never verifies. Also attach `pointerup`, `click` and `touchend`, call `resume()`, and remove listeners only once `ctx.state === 'running'`. Test A3 confirms whether `pointerdown` alone works on current iOS.
- **Source**: https://github.com/goldfire/howler.js/blob/master/src/howler.core.js (`_unlockAudio`).

---

## 2. Screen Wake Lock API (螢幕喚醒鎖)

### 2.1 Support matrix
- **Finding** [V]: Safari tab: iOS **16.4+**. Home-Screen web app: **broken from 16.4 to 18.3** (a WebKit bug: standalone apps lacked access to the idle-timer API), **fixed in iOS 18.4** (March 2025). Safari 17.0 additionally fixed a "permission denied after `visibilitychange`" bug.
- **Implication for us**: Three buckets: (a) Safari tab on 16.4+: use Wake Lock; (b) standalone on 18.4+: use Wake Lock; (c) standalone on 16.4-18.3: the API is present, request may even resolve, but the screen still dims, so use the video fallback (2.3). Since Safari 26 freezes the OS version in the user-agent at `18_6`, "UA version < 18.4" correctly identifies only genuine iOS 16.4-18.3 devices.
- **Source**: MDN BCD `api.Navigator.wakeLock` ("does not work in standalone", iOS 16.4 to 18.3); WebKit bug 254545 https://bugs.webkit.org/show_bug.cgi?id=254545 ; WebKit Features in Safari 18.4 https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ ; Safari 17.0 notes https://webkit.org/blog/14445/webkit-features-in-safari-17-0/ ; Safari 26.0 notes (UA freeze) https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ .

### 2.2 Lifetime rules
- **Finding** [V]: The lock is released by the system when the page is hidden or inactive, on low battery, or in power-saver mode. `request()` can reject with `NotAllowedError` for the same reasons (and when the document is not active). The documented pattern is to request again on `visibilitychange` when the page is visible.
- **Implication for us**: `keepAwake()` in `js/core/util.js` is already re-armed on `visibilitychange` (in `app.js` and `core/client.js`). Add: re-arm on `pageshow`; treat a rejected request as "no lock" and surface a status chip 「屏幕會自動鎖」 with the fix 「設定 → 螢幕顯示與亮度 → 自動鎖定 → 永不」; expect Low Power Mode to refuse the lock [U].
- **Source**: MDN https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API ; `util.js` in the repo.

### 2.3 Fallback: silent looping video
- **Finding** [V]+[R]: NoSleep.js, the common library, uses native Wake Lock when `'wakeLock' in navigator` is true and a hidden looping video otherwise; so on iOS 16.4-18.3 standalone, where the property exists but is useless, it never reaches its video path. The video must be started from a user gesture. iOS only allows autoplay of videos that are muted or have no audio track, with `playsinline`, and only while visible. People who used the video trick before 18.4 saw leftover artifacts on the lock screen and failures when the page also played real audio or video streams.
- **Implication for us**: Do not use NoSleep.js as-is. Write a 30-line fallback: one tiny muted `playsinline` looping video (base64 data URI, under 2 KB) started in the "開始" tap, used only for standalone < 18.4. Low Power Mode blocks video autoplay [R], so also keep the 屏幕鎖 hint. Do not combine with narration audio on the same page without testing A7.
- **Source**: https://github.com/richtr/NoSleep.js (`src/index.js`); https://webkit.org/blog/6784/new-video-policies-for-ios/ ; WebKit bug 254545 comments.

### 2.4 Intentional dim screens vs auto-lock
- **Finding** [V]: DESIGN.md has non-host phones show a black "閉眼" screen between actions. A black page is still just a page: iOS auto-lock counts down regardless.
- **Implication for us**: Keep the wake lock on during the whole game, including the dark screens. Never use `display:none`/hidden tabs for the dark state.
- **Source**: `docs/DESIGN.md` section 4; MDN above.

---

## 3. WebRTC and PeerJS on iOS

### 3.1 What happens when the screen locks or Safari is backgrounded
- **Finding** [R]+[V]: Developers report WebRTC and Web Audio are suspended as soon as the screen locks or Safari goes to the background (no supported background mode for web pages), and a 2025 Apple forum request asks for one. Peers detect a silent partner through ICE *consent freshness*: the standard sends a check about every 5 s and a peer must stop sending when no valid reply arrives within **30 s**. So a phone locked for more than roughly 30 s will be dropped by the other side, and the DataChannel then ends in `failed`/`closed` (browser-dependent).
- **Implication for us**: Assume every lock longer than ~30 s kills the DataChannel; plan for "returns after 5 s" (often survives) and "returns after 2 min" (dead, must re-dial) with the same code. On `visibilitychange` (visible), `pageshow` and `online`, immediately probe liveness and re-dial if needed. `visibilitychange` is fully supported from iOS 14.5; before that (our floor is 16.x, so only relevant as a habit) it did not fire when navigating away, so also handle `pagehide`, which covers the navigate-away and close cases on every version.
- **Source**: https://developer.apple.com/forums/thread/774239 ; RFC 7675 https://www.rfc-editor.org/rfc/rfc7675 ; MDN BCD `Document.visibilitychange_event`.

### 3.2 PeerJS does not reliably tell you the other side vanished
- **Finding** [R]+[V]: PeerJS issues report that when a remote tab is closed or the network disappears the `DataConnection` `close` event may not fire for many minutes (one report: about 10 min, and only after a `send()`), and has no built-in application heartbeat for data connections. The *signalling* socket does have one: PeerJS sends a heartbeat every `pingInterval` (default 5000 ms). `peer.reconnect()` keeps the same id, does not close existing connections, and throws if the peer is not currently disconnected. A 2024 report shows `reconnect()` sometimes yields no event at all because of a server-side race (a fix PR exists for the server).
- **Implication for us**: `ping`/`pong` already exist in the protocol (for clock sync, `core/client.js` and `core/room.js`). Make them double as liveness: send every 5 s, declare a device offline after 15 s of silence, then re-dial. Add an escalation to the host loop in `core/net.js`: if `reconnect()` has not produced `open` within ~8 s, `destroy()` and reclaim the same room id with a fresh `Peer` (the `open(preferred)` path already exists). Keep a try/catch around `reconnect()` (already done). Why `open` can go missing (verified in the PeerServer source): when a socket arrives with an id the server still holds **and the same token**, the server silently re-attaches it to the old record and does **not** send the `OPEN` message, so PeerJS never emits `open` even though the id is live again. A `destroy()` of that peer closes the re-attached socket cleanly, which makes the server drop the id at once, so the fresh-`Peer` fallback normally succeeds on its first try.
- **Source**: https://github.com/peers/peerjs/issues/769 ; https://github.com/peers/peerjs/issues/1313 ; https://github.com/peers/peerjs/issues/1289 ; PeerJS source `lib/peer.ts`, `lib/socket.ts` (https://github.com/peers/peerjs).

### 3.3 Reclaiming the host's room id after a lock
- **Finding** [V]: A cleanly closed page frees its id at once, but a suspended phone leaves a dead socket. The PeerServer drops a silent client after `alive_timeout` (checked every 0.3 s). The default depends on how the server is started: **60 s** with the `peerjs` command-line server (the value the README documents), but **90 s** when the server is embedded through the library's `PeerServer()`/`ExpressPeerServer()` (the code default in `src/config`). The public cloud's value is not documented. Until then, a `new Peer(sameId)` with a **new token** fails with `unavailable-id` ("ID is taken"). A connection that presents the **same token** as the stale record is accepted immediately (re-attached, without an `OPEN` reply; see 3.2). PeerJS lets the caller pass that token as the `token` option of `new Peer()`; by default every `Peer` object generates a random one.
- **Implication for us**: `HostNet.open(preferred)` currently gives up after about 25 s of waits (6 tries x 1.2 s x attempt number), and each try is a new `Peer` with a new token, so after a host reload it can never win before the server's timeout. Two fixes, best first: (1) persist the host's PeerJS token next to the room snapshot and pass it back as `token` on reclaim, which makes reclaim instant; because no `OPEN` arrives in that case, treat "socket open, no `error` within ~2 s" as success. This is **[U]** until tested (test A15). (2) Otherwise extend the reclaim loop to about **100 s** (covers the 90 s library default and some margin; the cloud value is unknown) with a visible "重連緊房間…" state, and keep the room alive in the meantime on the host side (the host's state is local anyway). Clients retry `peer-unavailable` with backoff (already coded in `ClientNet`).
- **Source**: https://github.com/peers/peerjs-server (README option table; `bin/peerjs.ts` CLI default 60000; `src/config/index.ts` default 90000; `src/services/webSocketServer/index.ts` id/token handling; `src/services/checkBrokenConnections`); PeerJS `lib/peer.ts` (`token` option); https://github.com/peers/peerjs/issues/1289 ; `js/core/net.js`.

### 3.4 ICE / TURN: what works today (important)
- **Finding** [V]: (a) PeerJS 1.5.x ships a default config of one Google STUN plus its own TURN at `eu-0.turn.peerjs.com` / `us-0.turn.peerjs.com`; **both hostnames resolve to no address records** (DNS-over-HTTPS check, 2026-10-03 UTC), so the library default is effectively STUN-only. (b) The `config` option **replaces** the whole default (a shallow merge in `Peer`), which is what `core/net.js` does, so the PeerJS TURN is not used either way. (c) `core/net.js` lists TURN at `openrelay.metered.ca` with the public `openrelayproject` username and password. I sent raw TURN `Allocate` requests today (my STUN message-integrity code reproduces the RFC 5769 test vector exactly) to `openrelay.metered.ca` on UDP 443 and UDP 3478 and TCP 80: the server answered the authenticated request with a STUN **400 error for those credentials and for deliberately wrong ones alike**; UDP 80 timed out from my network, and TCP 443 does not speak plain TURN (likely TLS only). Metered's page now describes obtaining credentials by signing up for a free account and API key (20 GB/month free), and mentions static credentials only for a Nextcloud-specific host. I cannot prove the old public credentials are dead on every port, but they are not accepted where I could test.
- **Implication for us**: Treat the current setup as **STUN only**. That usually works on typical home Wi-Fi, and fails on carrier-grade NAT, symmetric NAT, and Wi-Fi with client isolation. A phone hotspot is **not** a safe fallback: one PeerJS report (#1302, iOS 17) says the iPhone *providing* the hotspot could not connect to a device joined to that hotspot, although both worked on ordinary Wi-Fi; whether two phones that are both *clients* of a third phone's hotspot connect directly is **[U]** (test A14). Real PeerJS reports match: 4G-versus-Wi-Fi and phone-hotspot connections fail until a proper TURN service is added. Options (owner decision, section 9):

  | Option | Works from a static site? | Cost | Notes |
  |---|---|---|---|
  | Metered free account (dynamic credentials via REST) | Yes, the API key sits in client JS | 20 GB/month free per Metered | Our traffic is tiny (kilobytes per game); key can be abused until quota, rotate if needed |
  | Cloudflare Realtime TURN | Needs a small Worker to mint credentials (the TURN key must stay server-side; credentials are short-lived) | First **1,000 GB per month free** (shared with its SFU), then US$0.05/GB; free without limit when used with its SFU | UDP 3478/443, TCP 3478/80, TLS 5349/443; `stun.cloudflare.com` is free and unlimited |
  | Self-hosted coturn on a small VPS | Static credentials or a tiny REST helper | VPS cost | Full control; ops burden |
  | STUN only plus advice (everyone on one Wi-Fi or pocket Wi-Fi; hotspot only if test A14 passes) | Yes | Free | Fails exactly when travelling is hardest |

  Whatever is chosen, list TURN over **TCP and TLS on 443** (`turns:` and `?transport=tcp`) as well as UDP, because hotel and pocket Wi-Fi often block UDP and unknown ports. At our traffic (kilobytes per game) both the Metered and the Cloudflare free tiers are effectively unlimited; the real difference is that Metered's key lives in public JS while Cloudflare needs a Worker.
- **Source**: PeerJS `lib/util.ts` default config and `lib/peer.ts` options merge (https://github.com/peers/peerjs); Cloudflare and Google DNS-over-HTTPS JSON for the two hostnames; my TURN probe (RFC 5769 vector check, RFC 5766/5389 message format); https://www.metered.ca/tools/openrelay/ ; https://developers.cloudflare.com/realtime/turn/ ; https://developers.cloudflare.com/realtime/turn/faq/ ; https://developers.cloudflare.com/realtime/sfu/platform/pricing/ ; https://developers.cloudflare.com/realtime/turn/generate-credentials/ ; https://github.com/peers/peerjs/issues/824 ; https://github.com/peers/peerjs/issues/1287 ; https://github.com/peers/peerjs/issues/1302 .

### 3.5 Same-Wi-Fi is not automatically a direct path
- **Finding** [R]+[U]: Browsers hide local IP addresses behind random `.local` (mDNS) names unless the page has camera/microphone permission, as described in an IETF draft; two phones on the same Wi-Fi then connect directly only if multicast DNS works between them. Many hotel and guest networks use client isolation and block multicast, so even two phones in the same room may need a relay (STUN "reflexive" paths often fail when the router does not hairpin).
- **Implication for us**: Do not promise "same Wi-Fi always works". Show a connection-help sheet when `iceConnectionState` stays `checking` > 8 s: 「試下：全部人用同一個 Wi-Fi（或者 pocket Wi-Fi）」 plus the TURN fix above. Do **not** suggest 「其中一部手機開熱點」 until test A14 shows it works: the iPhone providing the hotspot is the case reported to fail (3.4). Consider logging the winning candidate type (host, srflx, relay) to the console for support.
- **Source**: IETF draft "Using Multicast DNS to protect privacy when exposing ICE candidates" https://datatracker.ietf.org/doc/draft-ietf-mmusic-mdns-ice-candidates/ ; general network practice (no primary source for hotel behaviour).

### 3.6 Known PeerJS-on-Safari issues
- **Finding** [R]+[V]: PeerJS 1.3.1 on iOS 18.1.1 threw a "read-only property" TypeError after `connect()`, fixed by moving to 1.5.4. Many open PeerJS issues mention iOS Safari (several from 2019-2022 that I did not read in detail), so pin a recent version. PeerJS's binary Blob path is disabled on iOS; we use JSON serialization, so unaffected. Our `index.html` pins `peerjs@1.5.4` from jsDelivr. The npm `latest` is **1.5.5** (published 2025-06-07); its only change log entry is a build fix that inlines the package version, so 1.5.4 and 1.5.5 behave the same. There has been no release since.
- **Implication for us**: Keep `serialization: 'json'` and `reliable: true`. **Vendor** PeerJS into the repo (for example `vendor/peerjs-1.5.5.min.js` with a version stamp) instead of loading from a CDN: it removes a third-party dependency, works offline from the service worker, and avoids caching cross-origin responses. Keep each DataChannel message small (under about 16 KB [U]); batch drawing points rather than sending one message per point.
- **Source**: https://github.com/peers/peerjs/issues/1314 ; `lib/util.ts` (`binaryBlob = !isIOS`); npm registry metadata for `peerjs` (dist-tags and publish times); PeerJS `CHANGELOG.md`.

### 3.7 Reliability of the free PeerJS cloud (0.peerjs.com)
- **Finding** [R]+[U]: It is a free community-run server with a public status page (reported "200 OK" when I looked on 2026-10-03). I found no published SLA, concurrency limit or uptime figure. Its own root endpoint reports its location as **EU** [V], so from Japan every signalling message (join, offer/answer, reconnect) crosses to Europe, which adds roughly a quarter-second per round trip [U, estimate]; it slows joining, not play. Only signalling goes through it; the game data goes peer-to-peer or via TURN.
- **Implication for us**: A signalling outage stops *new* joins but not an ongoing game, except that a locked phone cannot re-register. Mitigations: make the signalling host configurable in the room settings (`host`, `port`, `secure` options of `Peer`), allow a self-hosted PeerServer URL as a documented escape hatch, and keep `LocalTransport` (single-device mode) always reachable.
- **Source**: https://status.peerjs.com/ ; `GET https://0.peerjs.com/` (server self-description, 2026-10-03 UTC); PeerJS options in `lib/peer.ts`.

---

## 4. Service Worker and PWA on GitHub Pages under a subpath

### 4.1 Scope and headers on `/cheese-thief/`
- **Finding** [V]: Live response headers today for the three kinds of file (page, manifest, script): `Cache-Control: max-age=600`, an `ETag`, `Last-Modified`, `Access-Control-Allow-Origin: *`; **no** `Service-Worker-Allowed` header can be added on Pages. A worker's default scope is the directory containing its script, so `sw.js` must live at `/cheese-thief/sw.js` and can only control `/cheese-thief/…`. The edge region seen from Japan was `japaneast`.
- **Implication for us**: Keep `sw.js` beside `index.html` and register it with a relative URL. All URLs in the app must be relative (the current `sw.js` resolves against `registration.scope`, good). Remember that **every repo on `<user>.github.io` shares one origin**: `localStorage`, IndexedDB and cache names are shared across projects, so prefix keys and caches (the repo already uses `bgb:`).
- **Source**: `curl -I` of https://pych0413.github.io/cheese-thief/ on 2026-10-03; web.dev lifecycle article https://web.dev/articles/service-worker-lifecycle (scope rules).

### 4.2 `?v=` stamps, ES modules and precache
- **Finding** [V]: Each distinct URL string is a separate module instance, so every importer must use the same stamp for the same file (otherwise duplicate singletons). `tools/bump-version.sh` restamps all imports and the service worker's `VERSION`/`PRECACHE` and runs `tools/check-imports.mjs`. Stamped URLs are effectively immutable, so cache-first by exact URL (no `ignoreSearch`) is correct; unstamped documents need network-first. **Safari 27.0 ships an all-new ES module loader** (release notes).
- **Implication for us**: Keep the present strategy in `sw.js` (stamped assets cache-first, shell network-first with a 3.5 s timeout). Add a Safari 27 regression pass over module loading, dynamic `import()` of per-game modules, and the service worker (A9). When a new stamp ships, precache must contain every module the page can import lazily (the script regenerates it from the tree).
- **Source**: WebKit Features for Safari 27.0 https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; `tools/bump-version.sh`; `sw.js`.

### 4.3 Install-time freshness
- **Finding** [V]: GitHub Pages' 10-minute HTTP cache would let a brand-new service worker precache **stale copies** unless the requests bypass the HTTP cache. Update checks of the worker script itself ignore HTTP caching by default in most browsers (and `updateViaCache` has been supported since iOS 11.3).
- **Implication for us**: The current `precache()` already sends `cache: 'reload'` for unstamped files; keep it. Register with `updateViaCache: 'none'` (done).
- **Source**: web.dev lifecycle article; MDN BCD `updateViaCache`; `sw.js`.

### 4.4 Update flow on iOS (skipWaiting and claim)
- **Finding** [V]: A new worker waits until the old one controls no clients. `skipWaiting()` makes a new worker control pages that loaded under the old version, risking old HTML with new caches; `clients.claim()` similarly changes how already-open pages load. A Home-Screen app on iOS is normally suspended, not closed, so "wait for all windows to close" can take days.
- **Implication for us**: The current design (wait, then `skip-waiting` by message) is right for mid-game safety. Add the missing UX: when `reg.waiting` exists and the room is in **lobby or results** (never during a round), show 「有新版本，㩒一下更新」; on tap send `skip-waiting`, then reload on `controllerchange`. Also call `reg.update()` on every `visibilitychange` to visible (already suggested in `sw.js`). Protocol skew is the second half of the problem: include `proto` and app `VERSION` in the join handshake so a phone on an old version gets 「請更新版本」 instead of weird behaviour.
- **Source**: https://web.dev/articles/service-worker-lifecycle ; `sw.js` comments.

### 4.5 Captive portals (hotel Wi-Fi) can poison the shell cache
- **Finding** [U]: Hotel and rail Wi-Fi often intercept HTTP(S) until a login page is accepted. A network-first handler that stores any `200` HTML under `./` may save the login page as the app shell.
- **Implication for us**: In `shellFirst`, cache a navigation response only if it is `type === 'basic'`, not `redirected`, `content-type` is `text/html`, and the body contains an app marker (for example `<meta name="bgb-version">`). Otherwise serve the existing cached shell.
- **Source**: reasoning from the code in `sw.js` (`shellFirst`); no external source.

### 4.6 Storage quota, eviction, persistence
- **Finding** [V]: Since iOS/Safari 17.0 an origin may use up to 60 % of total disk (overall cap 80 %; apps embedding a WebView get 15 %), and a Home-Screen app gets the same limits as a browser tab. (Before 17.0 the per-origin quota was about 1 GB [R]; the WebKit post does not state the old figure.) Data can still be evicted under storage pressure or when a site goes unused. WebKit's 7-day cap on script-writable storage counts "days of Safari use without interaction", and Home-Screen apps have their **own counter**, so regular use of the app resets it. `navigator.storage.persist()` exists from iOS 15.2 and WebKit grants it by heuristics such as being opened as a Home-Screen app.
- **Implication for us**: Our "nothing repeats" bag and the host snapshot live in `localStorage`; for a host who only ever uses a Safari tab, a long gap between game nights could wipe them. Ask the host to add the app to the Home Screen, call `navigator.storage.persist()` after the first successful room, and treat all local state as recoverable (rebuild from defaults without crashing).
- **Source**: https://webkit.org/blog/14403/updates-to-storage-policy/ ; https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ ; MDN BCD `StorageManager.persist`.

### 4.7 Safari tab versus Home-Screen app are separate worlds
- **Finding** [V]+[U]: A Home-Screen web app is not part of Safari for storage purposes (WebKit's own wording). Its data (localStorage, IndexedDB, caches, service worker registration, permission grants) is separate from the Safari tab's. Safari 17 explicitly describes macOS Dock web apps as getting a one-time copy of cookies and nothing else; iOS behaves the same way as far as I know **[U]**. Links tapped in Messages/WhatsApp open in Safari, not in an installed web app **[R]**.
- **Implication for us**: Guests who tap a shared link are almost always in a **Safari tab**, so Safari-tab mode must be a first-class path (wake lock, narration, DeviceMotion all work there on 16.4+). Only the host benefits much from installing. A room started in a tab cannot be resumed from the Home-Screen icon (different storage): put the room code in the URL fragment (`#join=ABCD`, not sent to servers) and say so in onboarding.
- **Source**: WebKit blog 10218 (above); Safari 17.0 notes (web apps on Mac) https://webkit.org/blog/14445/webkit-features-in-safari-17-0/ ; WebKit source `WebDeviceOrientationAndMotionAccessController.cpp` (per data store).

### 4.8 Manifest and icon requirements on iOS
- **Finding** [V]: To open as a Home-Screen web app a site needs `display` of `standalone` or `fullscreen` (16.4 wording). From **iOS 26** *every* site added to the Home Screen opens as a web app by default (the user can untick "Open as Web App"). Apple documents `apple-touch-icon` as **PNG**; manifest `icons` are honoured only (iOS 15.4+) when no `apple-touch-icon` is present and the `purpose` is `any` or omitted. iOS ignores manifest `orientation`, `background_color` and `description`; `ScreenOrientation.lock()` is not implemented; `theme_color` works from iOS 15 and from iOS 26 the `theme-color` meta is used only for installed apps. `beforeinstallprompt` does not exist, so there is no install button. The `display-mode: standalone` media query is unreliable for installed apps (WebKit bug 264218); `navigator.standalone === true` is the dependable test. The manifest is fetched on every page load since Safari 15.4.
- **Implication for us**: (1) `index.html` line 15 still says `<link rel="apple-touch-icon" href="icon.svg">`: change to `icons/icon-180.png` (the file exists). (2) Do not expect a portrait lock; layouts must survive landscape. (3) Add an "加到主畫面" helper for Safari: 「㩒分享 ⎙ → 加至主畫面」 shown when `navigator.standalone !== true`. (4) Keep `display: standalone`.
- **Source**: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ ; https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/ ; Apple "Configuring Web Applications" https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html ; Safari 26.0 notes; MDN BCD `manifests.webapp.*`, `css.at-rules.media.display-mode`.

### 4.9 Third-party libraries and CDN caching
- **Finding** [V]: `sw.js` caches libraries from jsDelivr/unpkg/cdnjs on first use (`libFirst`). That works only once the page has run online once; cross-origin responses may be opaque.
- **Implication for us**: Vendoring PeerJS (3.6) makes the first offline launch work with zero network. Remove the CDN script tag when vendored.
- **Source**: `sw.js`; `index.html`.

---

## 5. DeviceMotion permission (shake to roll)

### 5.1 API shape and gesture rule
- **Finding** [V]: iOS has the static `DeviceMotionEvent.requestPermission()` (iOS 13; MDN's compat table lists 14.5 for the static member). It needs a secure context and **transient user activation**; called from a tap it prompts, called without activation while the state is "prompt" it throws `NotAllowedError`. Home-Screen apps use the same API. `devicemotion` itself exists since iOS 4.2.
- **Implication for us**: Keep `requestMotionPermission()` called synchronously from the "啟用搖骰" tap (as `shake.js` documents). No `await` before it.
- **Source**: MDN https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static ; BCD `DeviceMotionEvent`.

### 5.2 Persistence: in memory only
- **Finding** [V]: WebKit caches the decision in the UI process per top-level origin inside the website data store, as a plain in-memory map; there is no on-disk persistence in that code. A request made without a user gesture does not prompt and does not store a decision. The Home-Screen app has its own data store, so a grant given in a Safari tab does not carry over.
- **Implication for us**: Expect a new prompt after the Home-Screen app is killed and relaunched, and after Safari itself is relaunched. A **denial** sticks until that process restarts, and we cannot re-prompt: show 「搖骰被拒絕咗，要完全關閉再開 App 先可以再問」 and keep the manual roll button. Never store "granted" in `localStorage` as a shortcut; ask `requestPermission()` each cold start from a tap (it resolves at once when already granted). Keep `onNoSensor` in `ShakeDetector` for the "granted but no events" case.
- **Source**: WebKit `WebDeviceOrientationAndMotionAccessController.cpp` (UIProcess/WebsiteData) and `DeviceOrientationAndMotionAccessController.cpp` (WebCore/dom) on GitHub main.

### 5.3 No haptics
- **Finding** [V]: The Vibration API is not implemented in Safari on iPhone; `screen.orientation.lock` and `requestFullscreen` on non-video elements are not available on iPhone (fullscreen exists on iPad only).
- **Finding** [V]+[R]: The one built-in haptic is that iOS 18 plays a single tap when the user toggles an `<input type="checkbox" switch>` (the `switch` attribute itself exists from iOS 17.4). Community libraries trigger it from script by clicking a hidden switch's label inside a tap handler [R]; that is an undocumented side effect that Apple may change.
- **Implication for us**: Feedback must be sound plus animation, as DESIGN.md already says. A real switch control (for example 「開啟搖骰」) gets the haptic for free on iOS 18+; do not build game feedback on the hidden-switch hack. Do not design anything that needs fullscreen on iPhone (use standalone mode instead).
- **Source**: MDN BCD `Navigator.vibrate`, `Element.requestFullscreen`, `ScreenOrientation.lock`, `html.elements.input.switch`; WebKit Features in Safari 18.0 https://webkit.org/blog/15865/webkit-features-in-safari-18-0/ .

---

## 6. Other things that commonly break party-game web apps on iPhone

### 6.1 `100vh`, dynamic viewport, safe areas
- **Finding** [V]: On iOS Safari `100vh` equals the *large* viewport (toolbars retracted), so a "full height" layout sits partly under the toolbar in a tab. `dvh`/`svh`/`lvh` have shipped since iOS 15.4; the safe-area insets since iOS 11 with `viewport-fit=cover` (spelled `constant()` in 11.0-11.2, `env()` from 11.3). In standalone mode there is no toolbar, so `vh` and `dvh` agree, but with `black-translucent` the status bar overlays content.
- **Implication for us**: Use `height: 100vh; height: 100dvh;` (fallback first), pad with `env(safe-area-inset-*)` (landscape notch left/right too), and keep primary buttons out of the bottom ~34 px home-indicator zone. The repo already uses `viewport-fit=cover` and the black-translucent status bar.
- **Source**: MDN BCD `css.types.length` (dynamic/small/large), `css.types.env`; WebKit Features in Safari 15.4 (viewport units).

### 6.2 On-screen keyboard covering inputs (including Chinese IME)
- **Finding** [V]+[U]: `interactive-widget` and the CSS `env(keyboard-inset-*)` values are not implemented on iOS, so there is no declarative way to resize for the keyboard. The layout viewport does not shrink; `window.visualViewport` (iOS 13+) does, and fires `resize`. Fixed-position bars tend to float under or jump above the keyboard. Chinese IMEs add a candidate bar, making the keyboard taller than for Latin text.
- **Implication for us**: Keep text fields in the upper half of the screen (name entry, free-text answers). Drive the layout from `visualViewport.height` (set a CSS variable on `resize`/`scroll`) and call `scrollIntoView({block: 'center'})` on focus. Prefer tap-to-pick UIs (dice for room codes, emoji/colour pickers) over typing, as the join flow already does.
- **Source**: MDN BCD `html.elements.meta.name.viewport.interactive-widget`, `css.types.env`, `api.VisualViewport`.

### 6.3 IME composition (typing Cantonese/Chinese)
- **Finding** [V]: Composition events exist since iOS 5. While composing, `input` events fire for the pending buffer (jyutping/pinyin/zhuyin letters), and rewriting `value` then breaks the composition. In Safari **up to 26.6** the keystroke that *commits* a composition fires `keydown` and `input` **after** `compositionend`, so `isComposing` is wrongly `false` on that event (WebKit bug 165004; MDN marks the iOS fix as **27**, though the original report is on macOS). Safari 27.0 also fixes other composition-order bugs for some input methods.
- **Implication for us**: (1) In `input` handlers, `if (e.isComposing) return;` and run validation, trimming, case folding and length limits on `compositionend` and on blur. (2) Do not submit on Enter. If you must, keep a `composing` flag cleared with `setTimeout(0)` after `compositionend` and ignore `keyCode === 229`. Use an explicit button; set `enterkeyhint="done"`. (3) `maxlength` counts UTF-16 units, so an emoji uses 2; for display names truncate by grapheme with `Intl.Segmenter`. (4) Set `autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"` on codes and names. (5) Whether `lang="zh-HK"` picks a Cantonese keyboard is **[U]**; do not rely on it.
- **Source**: MDN BCD `KeyboardEvent.isComposing`, `InputEvent.isComposing`, `CompositionEvent`; https://bugs.webkit.org/show_bug.cgi?id=165004 ; Safari 27.0 notes.

### 6.4 Input zoom, tap delay, double-tap
- **Finding** [V]+[R]: iOS Safari zooms the page when an input with a font size under 16 px gains focus. iOS 10 and later ignore `user-scalable=no`/`maximum-scale` for pinch-zoom (accessibility), per developer reports. Taps are not delayed on pages with `width=device-width`; `touch-action: manipulation` additionally disables double-tap-to-zoom (supported since iOS 9.3).
- **Implication for us**: Inputs at `font-size: 16px` or more; put `touch-action: manipulation` on `body`; consider dropping `maximum-scale=1, user-scalable=no` from the viewport meta (it hurts accessibility and iOS mostly ignores it). Rapid repeated taps (counters, dice) otherwise risk double-tap zoom.
- **Source**: https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/ ; https://webkit.org/blog/5610/more-responsive-tapping-on-ios/ ; MDN BCD `touch-action`.

### 6.5 Overscroll, pull-to-refresh, accidental reload
- **Finding** [V]+[U]: `overscroll-behavior` works on iOS 16+, but has no effect on elements that cannot scroll. In a Safari tab a downward drag at the top can trigger pull-to-refresh **[U]**; standalone apps still rubber-band.
- **Implication for us**: Set `overscroll-behavior-y: contain` on `html`, `body` and every scroller, keep the main play screen non-scrollable, and make sure a reload mid-game restores from the host snapshot (DESIGN.md does). iOS also reclaims background web views, so the same restore path covers that.
- **Source**: MDN BCD `overscroll-behavior`; DESIGN.md section 5.

### 6.6 Long-press callout, magnifier, text selection (hold-to-peek)
- **Finding** [V]: `-webkit-touch-callout: none` (iOS 2+) suppresses the link/image callout; `user-select` needs the `-webkit-` prefix on iOS; `-webkit-tap-highlight-color` removes the flash.
- **Implication for us**: For hold-to-peek covers, role cards and dice: `-webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; touch-action: none` (only on the cover element) and use Pointer Events with `setPointerCapture`. Images get `draggable="false"`. Close every cover on `visibilitychange`/`pagehide`/blur, as `Cover.js` already does.
- **Source**: MDN BCD `-webkit-touch-callout`, `user-select`, `-webkit-tap-highlight-color`.

### 6.7 Drawing canvas (你畫我猜, 假畫家)
- **Finding** [V]: Pointer Events work on iOS 13+. `PointerEvent.getCoalescedEvents()` arrives only in iOS **18.2**. Mobile Safari caps a canvas by area: **16,777,216 device pixels** (4096 x 4096) for years, raised in WebKit to **67,108,864** (8192 x 8192) by a March 2024 change, so iOS 18 and later should have the higher cap (exact first release [U]); exceeding it yields a blank/unusable canvas with only a console warning. Older iOS also enforced a total canvas-memory budget across all canvases on a page [R]. `willReadFrequently` needs iOS 18. Fullscreen is unavailable on iPhone.
- **Implication for us**: `touch-action: none` on the canvas (otherwise scrolling steals strokes), draw from `getCoalescedEvents()` when present and fall back to single events; size the bitmap at `cssSize x min(devicePixelRatio, 2)` (a 390x844 phone at DPR 3 is about 3 MP, fine, but cap at 8 MP, safely under the old 16.7 MP limit); release canvases you no longer need (set `width = height = 0`) instead of leaving hidden ones around; ignore `pointerType === 'touch'` while a pen is down. Send strokes as batches of points to peers. Export through `toBlob` and `navigator.share({files})` (iOS 14+).
- **Source**: https://github.com/jhildenbiddle/canvas-size (docs/index.md results table, "Mobile Safari 9+"); WebKit `Source/WebCore/html/CanvasBase.cpp` `maxCanvasArea()` (iOS: 8192 x 8192) and WebKit bug 271002 "[iOS] Increase the limit on the canvas size to 8192x8192" (committed 2024-03-15); MDN BCD `PointerEvent.getCoalescedEvents`, `HTMLCanvasElement.getContext`, `Navigator.share`.

### 6.8 Autoplay, video and clipboard
- **Finding** [V]: Media with sound needs a user gesture; muted or audio-less `playsinline` video may autoplay while visible. `Clipboard.writeText()` must run inside a gesture handler. `navigator.share` works from iOS 12.2; `BarcodeDetector` exists only behind a flag on iOS 17.
- **Implication for us**: Room-code sharing: use `navigator.share({text, url})` from a tap, with a `writeText` fallback. If a QR join option is ever added, scan with a JS decoder (not `BarcodeDetector`) and require a camera tap.
- **Source**: WebKit "New video policies for iOS" https://webkit.org/blog/6784/new-video-policies-for-ios/ ; MDN BCD `Clipboard.writeText`, `Navigator.share`, `BarcodeDetector`.

### 6.9 Notifications and badges
- **Finding** [V]: `Notification`, push and badges exist on iOS 16.4+ **only in Home-Screen web apps** (the `Notification` interface is undefined in a normal tab), and must be requested from a tap.
- **Implication for us**: Do not build features that depend on push (e.g. "your turn" alerts); guests are mostly in Safari tabs. Use sound and the on-screen 「輪到你」 badge instead.
- **Source**: MDN BCD `Notification`; WebKit blog 13878 (above).

---

## 7. Device test list (one iPhone, 20 minutes, closes the [U] items)

Run on at least: one iPhone on iOS 16/17, one on iOS 18.x (ideally < 18.4 and >= 18.4), one on iOS 26 or 27; each in a Safari tab and as a Home-Screen app. Record iOS version, device language, and whether Spoken Content has Cantonese downloaded.

| Id | Test | Pass means |
|---|---|---|
| A1 | `speechSynthesis.getVoices()` after load (log length, then again after `voiceschanged`) with Cantonese **not** downloaded, then downloaded | We know if zh-HK ever appears, and how long the list takes |
| A2 | `utterance.lang='zh-HK'` with no `voice`, with and without a visible zh-HK voice | Audible and the human confirms 粵語 vs 普通話; repeat with Spoken Language set to each dialect |
| A3 | Audio unlock on `pointerdown` only vs `pointerup`/`click` | `AudioContext.state` becomes `running` |
| A4 | Speech with the mute switch on and off | Tells us if narration obeys the switch on current iOS |
| A5 | Same for Web Audio SFX and an `<audio>` element, with and without `audioSession.type='playback'` | Documents the differences |
| A6 | Speech overlapping a Web Audio beep | Whether either ducks or stops |
| A7 | Silent video fallback while Web Audio and speech play, standalone < 18.4 | Screen stays on, no audio break |
| A8 | Lock for 5 s, 30 s, 2 min while in a room (host and guest) | When data stops flowing, how fast our re-dial recovers |
| A9 | Safari 27: module loading, dynamic `import()`, service worker update | No regressions |
| A10 | Wake Lock in a tab, in standalone 18.3 and 18.4+, and in Low Power Mode | Which bucket (2.1) each falls into |
| A11 | Join across: Wi-Fi to Wi-Fi, Wi-Fi to cellular, phone hotspot to Wi-Fi, hotel Wi-Fi | Which pairs need TURN (log candidate types) |
| A12 | Chinese IME: type a name with Jyutping and Zhuyin, tap candidate and press return | No premature submit, no lost composition |
| A13 | `requestPermission()` cold start in tab and in app, deny then retry | Matches 5.2 |
| A14 | Hotspot topologies, STUN only: (a) host phone provides the hotspot, guest joins it; (b) a third phone provides the hotspot, host and guest both join it | Which hotspot layout (if any) to recommend in the help sheet (3.4, 3.5) |
| A15 | Host reload mid-room with the persisted PeerJS `token` passed back to `new Peer()`: time to reclaim, whether `open` fires, whether guests can re-dial | Confirms the instant-reclaim path in 3.3 |
| A16 | `utterance.voice` set to a zh-TW voice plus `lang='zh-HK'` vs `voice` unset plus `lang='zh-HK'` | Confirms that a set `voice` overrides `lang` (1.1) |

---

## 8. Observations about the repo at research time (working tree, 2026-10-03 UTC)

These are factual notes on files that were being edited by other sessions while I researched; re-check before acting.

1. `index.html`: `apple-touch-icon` points at `icon.svg?v=1` (use `icons/icon-180.png`, which exists locally but is not yet deployed: the live site returns 404 for it and for `sw.js`); viewport meta contains `maximum-scale=1, user-scalable=no`; PeerJS loads from jsDelivr at 1.5.4.
2. `js/core/net.js`: custom `config` replaces PeerJS defaults; TURN entries use the public `openrelayproject` credentials that failed my probe (and a re-probe during verification); host reclaim waits about 25 s in total, and every try uses a fresh random PeerJS token (3.3).
3. `js/core/narrator.js`: `prime()` speaks `''` at `volume = 0` (see 1.8); no zh-HK "voice for language" fallback and no human confirmation step (1.4, 1.14); no stuck-narrator recovery after `visibilitychange` (1.13); `resume()` on visible is harmless but cannot revive a cancelled queue.
4. `js/core/sfx.js`: resumes and drops sounds only on `suspended`, not `interrupted`; unlock only on `pointerdown` (1.16, 1.17).
5. `js/core/util.js` `keepAwake`: trusts `'wakeLock' in navigator`, so standalone iOS 16.4-18.3 gets no lock and no fallback (2.1, 2.3).
6. `sw.js`: strategy is sound; gaps are the iOS update prompt (4.4), captive-portal validation (4.5), and relying on CDN caching for PeerJS (3.6, 4.9).
7. `js/app.js`: a `beforeunload` guard is installed for a playing host; iOS Safari does not show it reliably **[U]**, so the snapshot-restore path is the real protection.

---

## 9. Open questions for the owner

1. **TURN**: which option in 3.4 (Metered free key in client JS, Cloudflare Worker with a 1,000 GB/month free tier, self-hosted coturn, or accept STUN-only)? This decides whether the "travelling in Japan on cellular/hotel Wi-Fi" promise holds.
2. **Narration tiers**: approve generating Cantonese clips offline (Azure `zh-HK` voices or similar) for fixed lines, with narration free of player names, as the guaranteed tier behind the system voice?
3. **Minimum iOS**: is iOS 16.4 (Wake Lock, Audio Session API, `Notification` in apps) an acceptable floor, with a polite banner below it?
4. **Standalone vs tab**: are we comfortable telling the host to install to the Home Screen (better storage durability, Wake Lock fix needs 18.4), while guests stay in Safari tabs?

---

## 10. Glossary (繁體中文, Hong Kong / Taiwan usage)

| English | 繁體中文 |
|---|---|
| Home-Screen web app / PWA | 主畫面網頁 App（加至主畫面） |
| Service worker | Service Worker（服務工作者） |
| Screen Wake Lock | 螢幕喚醒鎖／保持螢幕開啟 |
| Auto-lock | 自動鎖定 |
| Silent / ring switch | 靜音制（響鈴／靜音開關） |
| Speech synthesis, TTS | 語音合成／朗讀 |
| Spoken Content (iOS setting) | 語音內容（輔助使用內） |
| Voice (Sinji, Cantonese HK) | 聲音（善怡，粵語（香港）） |
| Mei-Jia, Ting-Ting | 美佳（國語，台灣）、婷婷（國語，中國大陸） |
| Narrator | 旁白 |
| Data channel / signalling | 資料通道／信令（連線協調） |
| TURN relay / STUN | TURN 中繼／STUN |
| Captive portal | 登入閘道網頁（酒店 Wi-Fi 登入頁） |
| Input method (IME) | 輸入法（粵拼、倉頡、注音） |
| Safe area | 安全區域 |
| Long press | 長按 |

---

## 11. Sources

Primary / code
- WebKit source: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/speech/SpeechSynthesis.cpp ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/cocoa/PlatformSpeechSynthesizerCocoa.mm ; https://github.com/WebKit/WebKit/blob/main/Source/WebCore/dom/DeviceOrientationAndMotionAccessController.cpp ; https://github.com/WebKit/WebKit/blob/main/Source/WebKit/UIProcess/WebsiteData/WebDeviceOrientationAndMotionAccessController.cpp ; WebKit PRs 56589, 61219, 48157.
- WebKit release notes: Safari 15.4 https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/ ; 16.4 https://webkit.org/blog/13966/webkit-features-in-safari-16-4/ ; 17.0 https://webkit.org/blog/14445/webkit-features-in-safari-17-0/ ; 18.4 https://webkit.org/blog/16574/webkit-features-in-safari-18-4/ ; 26.0 https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ ; 27.0 https://webkit.org/blog/18325/webkit-features-for-safari-27-0/ ; storage https://webkit.org/blog/14403/updates-to-storage-policy/ ; ITP https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ ; web push/web apps https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ ; video policies https://webkit.org/blog/6784/new-video-policies-for-ios/ ; tapping https://webkit.org/blog/5610/more-responsive-tapping-on-ios/ .
- WebKit bugs: 254545 (wake lock in Home-Screen apps), 261554 (AudioContext in background), 165004 (IME event order), 198277/232909 (standalone audio, fixed 15.4), 211018 (iOS 13 PWA freeze).
- MDN browser-compat-data 8.1.4 (build 2026-10-01): https://github.com/mdn/browser-compat-data ; MDN pages for Screen Wake Lock, BaseAudioContext.state, AudioSession, DeviceOrientationEvent.requestPermission.
- Standards: RFC 7675 (consent freshness); W3C Audio Session https://w3c.github.io/audio-session/ ; IETF mDNS ICE draft https://datatracker.ietf.org/doc/draft-ietf-mmusic-mdns-ice-candidates/ .
- Apple: Configuring Web Applications (archive) ; AVSpeechSynthesisVoice reference ; developer forums threads 723503, 764438, 772348, 788218, 774239.
- PeerJS: https://github.com/peers/peerjs (`lib/peer.ts`, `lib/socket.ts`, `lib/util.ts`, `CHANGELOG.md`) ; npm registry `peerjs` ; https://github.com/peers/peerjs-server (`bin/peerjs.ts`, `src/config/index.ts`, `src/services/webSocketServer/index.ts`) ; https://status.peerjs.com/ ; https://0.peerjs.com/ ; issues 769, 824, 1287, 1289, 1302, 1313, 1314.
- TURN: https://www.metered.ca/tools/openrelay/ ; https://developers.cloudflare.com/realtime/turn/ (+ `/faq/`, `/generate-credentials/`, `/realtime/sfu/platform/pricing/`) ; own probe on 2026-10-03 UTC (details in 3.4), repeated independently during verification.
- More WebKit: Safari 18.0 notes https://webkit.org/blog/15865/webkit-features-in-safari-18-0/ ; `Source/WebCore/html/CanvasBase.cpp` ; WebKit commits 309349@main (cancel/speak fix, bug 191745) and bug 271002 (iOS canvas 8192 x 8192).
- Live headers: `curl -I` https://pych0413.github.io/cheese-thief/ (2026-10-03 UTC).

Community
- https://talkrapp.com/speechSynthesis.html ; https://dev.to/jankapunkt/cross-browser-speech-synthesis-the-hard-way-and-the-easy-way-353 ; https://weboutloud.io/bulletin/speech_synthesis_in_safari/ ; https://github.com/Outtech105k/Multi-Voice-Timer/pull/8 ; https://github.com/leaonline/easy-speech/issues/366 ; https://github.com/odysseus-dev/odysseus/issues/5517 ; https://github.com/fischnall3r/sadiss/issues/134 ; https://github.com/richtr/NoSleep.js ; https://github.com/swevans/unmute ; https://github.com/goldfire/howler.js ; https://github.com/jhildenbiddle/canvas-size ; https://css-tricks.com/16px-or-larger-text-prevents-ios-form-zoom/ ; https://web.dev/articles/service-worker-lifecycle ; https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts .

Limits of this research: no physical iPhone was available, so every behaviour that depends on live iOS audio sessions, the ring switch, background timing, Low Power Mode and the real zh-HK voice list is tagged [U] and listed in section 7. The shared web-search budget ran out mid-task, so the later sections lean on direct fetches of primary sources and source code rather than broad searches.

---

## 12. Common variants (where sources disagree)

| Topic | Ruling kept in this doc | Alternative source says | Why the ruling wins |
|---|---|---|---|
| PeerServer `alive_timeout` default | 60 s (CLI) **or** 90 s (embedded library); plan for 90 s+ | README option table says only 60 s | The code default in `src/config/index.ts` is 90000; only `bin/peerjs.ts` sets 60000 |
| iOS canvas area cap | 4096 x 4096 historically, 8192 x 8192 in current WebKit (iOS 18+ expected) | canvas-size's results table ("Mobile Safari 9+") says 4096 x 4096 | WebKit source and bug 271002 (2024) raise it; the table predates the change. Our 8 MP cap is safe under both |
| `DeviceMotionEvent.requestPermission()` first version | iOS 13 (Apple shipped it there) | MDN BCD lists iOS 14.5 | BCD records first *verified* support; irrelevant to us because our floor is 16.x |
| Who hears zh-HK when the app asks for it (1.4) | Depends on the Spoken Content dialect setting on affected phones | WebKit code passes the requested language straight to AVFoundation | Apple forum reports (iOS 18.5 through iOS 26) show AVFoundation itself overrides the request; the human 試聽 check decides |
| Phone hotspot as a fallback network | Not recommended until test A14 | Original draft said STUN works "between two phones on one hotspot" | PeerJS #1302 reports the hotspot-providing iPhone failing to connect |
| Cloudflare TURN cost | 1,000 GB/month free (shared with SFU), then US$0.05/GB | TURN overview page mentions only "free with the SFU, else per GB" | The pricing page and TURN FAQ state the shared free tier explicitly |

---

## Verification

Adversarial fact-check run on 2026-10-03 UTC. Wherever possible I used different sources from the original draft, or re-ran the primary check myself instead of trusting the draft's reading.

**Checked and confirmed (no change needed)**
- MDN browser-compat-data **8.1.4, build 2026-10-01** (downloaded the full `data.json` and queried it): `SpeechSynthesis` iOS 7; `voiceschanged` 16; Wake Lock iOS 16.4 with the standalone-only partial 16.4-18.3 fixed in 18.4 (bug 254545 note); `AudioSession`/`type` 16.4, `state`/`statechange` not implemented; AudioContext `interrupted` state supported (listed from 9); `DeviceMotionEvent.requestPermission` listed 14.5; `devicemotion` 4.2; `getCoalescedEvents` 18.2; `willReadFrequently` 18; `navigator.share` 12.2, `files` 14; `Clipboard.writeText` 13.4 (gesture note); `BarcodeDetector` behind a flag in 17; `Notification` 16.4 Home-Screen only; `vibrate` and `ScreenOrientation.lock` not supported; `requestFullscreen` iPad only; `VisualViewport` 13; `StorageManager.persist` 15.2; `updateViaCache` 11.3; `visibilitychange` 14.5; `isComposing` order bug through **26.6**, fixed in **27** (bug 165004); dynamic viewport units 15.4; `keyboard-inset-*` and `interactive-widget` unsupported; `overscroll-behavior` 16 (no effect on non-scrollable containers); `touch-action: manipulation` iOS 9.3; `user-select` still needs `-webkit-`; `display-mode: standalone` false in installed apps (bug 264218); manifest `icons` 15.4 only without `apple-touch-icon`; manifest `orientation`, `background_color`, `description` unsupported; manifest `theme_color` 15; `theme-color` meta used only for installed web apps from 26.
- WebKit release notes, re-read directly: Safari **27.0** (released 2026-09-17) has the `cancel()`/`speak()` fix 46151521, the new native module loader and composition-order fixes; Safari **26.0** has the fingerprinting-script restrictions (voice list, 2D canvas, long-lived storage), the UA OS version frozen at `18_6`, every Home-Screen site opening as a web app by default, and fix 148731039 (queued utterances get `error` on cancel); Safari **18.4** (2025-03-31) makes Wake Lock work in Home-Screen web apps; Safari **17.0** fixes Wake Lock denial after `visibilitychange` (108279602) and copies cookies to Mac Dock apps; Safari **15.4** manifest icons and manifest fetched on every page load; the 16.4 web-push post (display member, gesture-gated permission, badging).
- WebKit bug pages: 254545 (root cause: wake lock relied on the app-level idle timer, which Home-Screen apps could not use; a resolved sentinel while the screen still dimmed was reported; fixed in 18.4), 261554 (fixed, confirmed in iOS 17.5).
- WebKit source on GitHub `main`, read line by line: `PlatformSpeechSynthesizerCocoa.mm` (voice selection order, rate mapping where web rate 2 equals Apple's maximum, `isSystemVoice` filter, `localService`/`default` both true, async voice list for OS 26.3+); `SpeechSynthesis.cpp` (iOS-only gesture restriction lifted by the first `speak()` inside a gesture, script-tracking-privacy empty list, `suspend()` clears the queue without events); WebKit PRs 56589 (non-blocking voice list, "empty initial voice list" test, merged January 2026) and 61219 (empty utterances never fire start/end, still open); `DeviceOrientationAndMotionAccessController.cpp` and the UI-process controller (in-memory per-top-origin map per website data store; no prompt without a gesture).
- Apple forum threads 723503 (Apple: only pre-installed voices are exposed to Web Speech), 764438, 788218, 772348, 774239.
- RFC 7675 (consent checks every 5 s randomised to 4-6 s, expiry 30 s). WebKit storage-policy post (60 % / 80 % / 15 %, same quotas for Home-Screen apps, `persist()` heuristics) and the ITP post (7-day cap, separate day counter for Home-Screen apps).
- PeerJS source: default ICE config (Google STUN plus `eu-0`/`us-0.turn.peerjs.com`), `config` replaced wholesale by user options, `binaryBlob = !isIOS`, signalling ping every 5000 ms, `reconnect()` rules. PeerJS issues 769, 824, 1287, 1289, 1302, 1313, 1314 read. NoSleep.js source (`'wakeLock' in navigator` short-circuits the video path). Howler.js unlock listeners (`touchstart`, `touchend`, `click`, `keydown`) and its `interrupted` handling.
- DNS: re-resolved `eu-0.turn.peerjs.com` and `us-0.turn.peerjs.com` with **Google** DNS-over-HTTPS (the draft used Cloudflare): both return no A/AAAA/CNAME records.
- TURN: wrote an independent STUN/TURN client, verified its MESSAGE-INTEGRITY and FINGERPRINT code against the RFC 5769 sample request (both match), and re-probed `openrelay.metered.ca`. UDP 3478 and UDP 443 answer the unauthenticated Allocate with 401 plus realm `metered.ca` and a nonce, then answer the authenticated Allocate with **400 for the published `openrelayproject` credentials and for made-up ones alike** (server software string `METERED-TURN-SERVER`); UDP 80 timed out. Same outcome as the draft. Metered's page now steers to sign-up plus API key (20 GB/month free).
- Live GitHub Pages headers (`max-age=600`, ETag, Last-Modified, CORS `*`, `x-github-edge-region: japaneast`, Fastly POP NRT). Azure zh-HK neural voices (HiuMaan, HiuGaai, WanLung) on Microsoft Learn. Repo claims about `narrator.prime()`, `sfx.js`, `keepAwake()`, the manifest and the 25 s reclaim loop in `net.js`.

**Changed**
1. **3.3 PeerServer timeout**: the default is 60 s only for the CLI server; the library default is **90 s**. Reclaim-loop advice raised from ~75 s to ~100 s, and the bottom-line row updated.
2. **3.2/3.3 reclaim mechanics (gap)**: a socket with the same id **and token** is re-attached instantly without an `OPEN` reply (source-verified cause of PeerJS #1289). Added the persisted-`token` instant-reclaim option, the reason `destroy()` plus a fresh `Peer` works, and test A15.
3. **3.4/3.5 hotspot**: removed "STUN works between two phones on one hotspot" and the 「開熱點」 tip; the draft's own source (#1302) reports the hotspot-providing iPhone failing. Added test A14.
4. **3.4 Cloudflare TURN**: it has a **1,000 GB/month** free tier shared with its SFU (then US$0.05/GB). The draft said it was free only with the SFU. Added ports, the server-side key rule and the free Cloudflare STUN; open question 1 updated.
5. **3.6 PeerJS version**: 1.5.5 is the published npm `latest` (2025-06-07), not just a master-branch number; its only change is a build fix.
6. **6.7 canvas limit**: current WebKit allows 8192 x 8192 on iOS (bug 271002, 2024); 4096 x 4096 is the old cap. Added a note on releasing canvases.
7. **1.1 voice selection (gap)**: a set `utterance.voice` makes WebKit ignore `utterance.lang`. Added test A16.
8. **1.3**: dated the voice dump (iOS 13.1.1), added the missing zh-CN Siri voices, and corrected the claim that forum 764438 shows the zh-HK identifier (it shows Spanish ones).
9. **1.4**: the dialect override goes both ways and is reported **still present on iOS 26** (March 2026); an Apple engineer asked for a Feedback report.
10. **3.1**: corrected the `visibilitychange` wording (fully supported from 14.5; the navigate-away gap was before 14.5).
11. **3.7 (gap)**: `0.peerjs.com` reports its location as EU, so signalling from Japan crosses continents.
12. **4.6**: added the 80 % and 15 % quotas; flagged the "about 1 GB before 17.0" figure as [R].
13. **5.3 (gap)**: iOS 18 haptic on `<input type=checkbox switch>` (Safari 18.0 notes), with a warning about the scripted-label hack.
14. **6.1**: safe-area insets were `constant()` in iOS 11.0-11.2, `env()` from 11.3.
15. **Section 8**: `apple-touch-icon` is now `icon.svg?v=1`; `icons/icon-180.png` and `sw.js` are not deployed yet (live 404).
16. **1.11 source**: added the release date and the WebKit commit that explains the bug.
17. Added section 12 (source disagreements) and tests A14-A16.

**Not independently re-verified (kept with their original tags)**: the talkrapp, weboutloud and dev.to speech reports, the swevans/unmute mute-switch behaviour, Low Power Mode effects, captive-portal behaviour, the exact iOS Settings menu wording in Cantonese, and anything that needs a real iPhone (all still listed in section 7). The web-search budget was exhausted, so verification relied on direct fetches of primary pages, raw source files, the npm registry, the GitHub API and the full BCD dataset.
