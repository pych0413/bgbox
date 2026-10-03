// ============================================================
// narrator.js — the phone as a Cantonese narrator (speechSynthesis).
//
//   const narrator = createNarrator();
//   narrator.prime();              // inside a real tap — see below
//   await narrator.speak('各位請閉眼');
//
// Browser only at runtime, but nothing here touches the DOM, and
// speechSynthesis is looked up lazily, so the pure helpers (and the whole
// factory, given a fake global) run under Node for tests.
//
// iOS facts this is built around:
//  - The first speak() must come from a real tap. prime() speaks an empty
//    utterance inside that tap; after it, later speak() calls from timers work.
//  - utterance.onend is unreliable (Safari sometimes never fires it). So every
//    speak() also has a fallback timer sized from the text length, and the
//    promise resolves on whichever comes first.
//  - getVoices() is empty until the page has asked once and 'voiceschanged'
//    has fired, so voices() re-reads every time and onVoices() lets a UI wait.
//  - The Cantonese voice (Sinji / 善怡) is an optional download in iOS
//    Settings; hasCantonese() lets the shell tell people where to get it.
//
// speak() QUEUES behind speech already in progress (that is what the browser
// does natively) and never cancels it; cancel() is explicit, and settles every
// pending speak() so nothing awaits forever.
//
// Reporting (for the app's narration watchdog, backlog #1):
//   speak(text, { onstart, onend })  onstart() when the browser says speech
//   began; onend(how) exactly once, how = 'end' | 'timeout' | 'cancel' |
//   'error' | 'unsupported'. The promise resolves with the same `how`
//   (undefined for empty text). The watchdog itself (no start within 1.5 s)
//   lives in core/client.js, which owns the injectable timers.
// ============================================================

// ---------- pure helpers (exported for tests) ----------

/** Voice language preference: lower is better, -1 = not offered. */
export function langRank(lang) {
  const l = String(lang ?? '').replace('_', '-').toLowerCase();
  if (l.startsWith('zh-hk') || l.startsWith('yue')) return 0;   // Cantonese
  if (l.startsWith('zh-tw')) return 1;
  if (l.startsWith('zh-cn')) return 2;
  if (l.startsWith('zh')) return 3;
  if (l.startsWith('ja')) return 4;
  if (l.startsWith('en')) return 5;
  return -1;
}

export const isCantoneseLang = (lang) => langRank(lang) === 0;

/** Best voice from a list: language rank first, then a local (offline) voice. */
export function pickVoice(voices) {
  const ranked = (voices ?? [])
    .map((v) => ({ v, r: langRank(v.lang) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || Number(!!b.v.localService) - Number(!!a.v.localService));
  return ranked[0]?.v ?? null;
}

const PAUSE_CHARS = /[，。！？、；：…,.!?;:\n]/g;
const CJK = /[⺀-鿿豈-﫿＀-￯]/g;

/**
 * How long speaking `text` should take, in ms. Deliberately a little long:
 * this is only the fallback for a missing onend, and cutting a line off early
 * is worse than a pause. ~260 ms per CJK character, ~85 per other visible
 * character, ~350 per punctuation pause, scaled by rate, plus padding.
 */
export function estimateMs(text, rate = 1) {
  const s = String(text ?? '');
  const cjk = (s.match(CJK) ?? []).length;
  const pauses = (s.match(PAUSE_CHARS) ?? []).length;
  const other = s.replace(/\s/g, '').length - cjk - pauses;
  const r = Math.min(2, Math.max(0.5, Number(rate) || 1));
  return Math.round((cjk * 260 + Math.max(0, other) * 85 + pauses * 350) / r + 1500);
}

/** The 試聽 / pre-flight sample line. */
export const SAMPLE_LINE = '你好，我係今晚嘅旁白，大家請聽清楚。';

// ---------- the narrator ----------

export function createNarrator() {
  const settings = { voiceURI: null, rate: 1, volume: 1 };
  const pending = new Set();     // settle() of every in-flight speak()
  const voiceListeners = new Set();
  let wired = false;

  const synth = () => globalThis.speechSynthesis ?? null;

  function wire() {
    if (wired) return;
    const s = synth();
    if (!s) return;
    wired = true;
    // voices load asynchronously; tell whoever is showing a voice list
    s.addEventListener?.('voiceschanged', () => { for (const fn of voiceListeners) { try { fn(); } catch { /* listener bug */ } } });
    // iOS pauses speech when the page is hidden and does not always resume it
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (!globalThis.document.hidden) { try { s.resume(); } catch { /* nothing to resume */ } }
    });
  }

  function rawVoices() {
    wire();
    try { return synth()?.getVoices?.() ?? []; } catch { return []; }
  }

  const api = {
    get supported() { return !!synth() && typeof globalThis.SpeechSynthesisUtterance === 'function'; },

    /** Call inside a real tap (iOS gesture rule). Speaks an empty utterance. */
    prime() {
      const s = synth();
      if (!s || typeof globalThis.SpeechSynthesisUtterance !== 'function') return;
      wire();
      try {
        s.getVoices();
        const u = new globalThis.SpeechSynthesisUtterance('');
        u.volume = 0;
        s.speak(u);
      } catch { /* priming is best-effort */ }
    },

    /** Offered voices, best first: [{ voiceURI, name, lang }]. */
    voices() {
      return rawVoices()
        .filter((v) => langRank(v.lang) >= 0)
        .sort((a, b) => langRank(a.lang) - langRank(b.lang) || String(a.name).localeCompare(String(b.name)))
        .map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang }));
    },

    /** voiceURI of the best voice (zh-HK > zh-TW > zh-CN > ja > en), or null. */
    pickDefault() { return pickVoice(rawVoices())?.voiceURI ?? null; },

    /** False → the shell suggests installing a 粵語 voice in iOS settings. */
    hasCantonese() { return rawVoices().some((v) => isCantoneseLang(v.lang)); },

    /**
     * Everything a pre-flight check screen needs, in one call:
     * { supported, cantonese, voice: { name, lang } | null (what speak() would use), rate, volume }.
     * The voice list can still be empty right after page load (iOS); onVoices() fires when it fills.
     */
    info() {
      const list = rawVoices();
      const v = list.find((x) => x.voiceURI === settings.voiceURI) ?? pickVoice(list);
      return {
        supported: api.supported,
        cantonese: list.some((x) => isCantoneseLang(x.lang)),
        voice: v ? { name: v.name, lang: v.lang } : null,
        rate: settings.rate,
        volume: settings.volume,
      };
    },

    /** Call fn when the voice list changes; returns an unsubscribe. */
    onVoices(fn) { wire(); voiceListeners.add(fn); return () => voiceListeners.delete(fn); },

    set(next = {}) {
      if ('voiceURI' in next) settings.voiceURI = next.voiceURI || null;
      if (next.rate != null) settings.rate = Math.min(1.6, Math.max(0.5, Number(next.rate) || 1));
      if (next.volume != null) settings.volume = Math.min(1, Math.max(0, Number(next.volume)));
    },
    get settings() { return { ...settings }; },

    /**
     * Speak `text`. Resolves when the browser says it ended, or after a
     * length-based timeout, or when cancel() is called — whichever is first.
     * Never rejects. Resolves with how it ended (see the header), and reports
     * the same through the optional hooks { onstart(), onend(how) }.
     */
    speak(text, hooks) {
      const line = String(text ?? '').trim();
      if (!line) return Promise.resolve();
      const call = (name, ...a) => { try { hooks?.[name]?.(...a); } catch { /* a hook bug must not break speech */ } };

      return new Promise((resolve) => {
        const s = synth();
        const ms = estimateMs(line, settings.rate);
        let timer = null;
        let settled = false;
        let started = false;

        const settle = (how) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pending.delete(cancelOne);
          call('onend', how);
          resolve(how);
        };
        const cancelOne = () => settle('cancel');
        pending.add(cancelOne);

        // No speech engine (or no Utterance): pretend to speak for the same
        // duration, so a narrated game still advances instead of stalling.
        // onstart never fires, so the app's watchdog puts the line on screen.
        if (!s || typeof globalThis.SpeechSynthesisUtterance !== 'function') {
          timer = setTimeout(() => settle('unsupported'), ms);
          return;
        }

        wire();
        const arm = (after) => { clearTimeout(timer); timer = setTimeout(() => settle('timeout'), after); };
        // Safety net from the moment we ask: covers an utterance that queues
        // behind others, or one that never starts at all.
        arm(ms + 4000 + pending.size * 500);

        try {
          const u = new globalThis.SpeechSynthesisUtterance(line);
          const voice = rawVoices().find((v) => v.voiceURI === settings.voiceURI) ?? pickVoice(rawVoices());
          if (voice) u.voice = voice;
          u.lang = voice?.lang ?? 'zh-HK';
          u.rate = settings.rate;
          u.volume = settings.volume;
          u.onstart = () => {
            if (settled || started) return;
            started = true;
            arm(ms);   // the clock that matters starts when speech does
            call('onstart');
          };
          u.onend = () => settle('end');
          u.onerror = (e) => settle(e?.error === 'canceled' || e?.error === 'interrupted' ? 'cancel' : 'error');
          s.speak(u);
        } catch {
          settle('error');
        }
      });
    },

    /**
     * Speak a test line at the current voice, rate and volume (試聽 / pre-flight check).
     * Resolves { started, how, voice }: started === false means nobody heard anything
     * (no voice, not primed, or the speech engine is stuck). Call prime() first, inside the tap.
     */
    test(text, hooks) {
      let started = false;
      const voice = api.info().voice;
      return api.speak(String(text ?? '').trim() || SAMPLE_LINE, {
        onstart: () => { started = true; try { hooks?.onstart?.(); } catch { /* caller's bug */ } },
        onend: (how) => { try { hooks?.onend?.(how); } catch { /* caller's bug */ } },
      }).then((how) => ({ started, how: how ?? 'end', voice }));
    },

    /** Stop talking and settle every pending speak(). */
    cancel() {
      try { synth()?.cancel(); } catch { /* nothing playing */ }
      for (const cancelOne of [...pending]) cancelOne();
    },
  };

  return api;
}

export default createNarrator;
