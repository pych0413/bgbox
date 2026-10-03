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
     * Never rejects.
     */
    speak(text) {
      const line = String(text ?? '').trim();
      if (!line) return Promise.resolve();

      return new Promise((resolve) => {
        const s = synth();
        const ms = estimateMs(line, settings.rate);
        let timer = null;
        let settled = false;

        const settle = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pending.delete(settle);
          resolve();
        };
        pending.add(settle);

        // No speech engine (or no Utterance): pretend to speak for the same
        // duration, so a narrated game still advances instead of stalling.
        if (!s || typeof globalThis.SpeechSynthesisUtterance !== 'function') {
          timer = setTimeout(settle, ms);
          return;
        }

        wire();
        const arm = (after) => { clearTimeout(timer); timer = setTimeout(settle, after); };
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
          u.onstart = () => arm(ms);   // the clock that matters starts when speech does
          u.onend = settle;
          u.onerror = settle;
          s.speak(u);
        } catch {
          settle();
        }
      });
    },

    /** Speak a short sample, for the 試聽 button. */
    test() { return api.speak('你好，我係今晚嘅旁白，大家請聽清楚。'); },

    /** Stop talking and settle every pending speak(). */
    cancel() {
      try { synth()?.cancel(); } catch { /* nothing playing */ }
      for (const settle of [...pending]) settle();
    },
  };

  return api;
}

export default createNarrator;
