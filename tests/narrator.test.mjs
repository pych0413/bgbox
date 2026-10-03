// narrator.js — pure helpers and the speak() promise contract, with a fake speechSynthesis.

import { test, assert } from './lib.mjs';
import { langRank, pickVoice, estimateMs, createNarrator } from '../js/core/narrator.js';

const voice = (lang, name = lang, extra = {}) => ({ voiceURI: `uri:${name}`, name, lang, ...extra });

test('narrator: voice preference is zh-HK > zh-TW > zh-CN > ja > en', () => {
  assert.ok(langRank('zh-HK') < langRank('zh-TW'));
  assert.ok(langRank('zh-TW') < langRank('zh-CN'));
  assert.ok(langRank('zh-CN') < langRank('ja-JP'));
  assert.ok(langRank('ja-JP') < langRank('en-US'));
  assert.equal(langRank('zh_HK'), 0, 'underscore locale');
  assert.equal(langRank('yue-CN'), 0, 'Cantonese tagged yue');
  assert.equal(langRank('fr-FR'), -1);

  const all = [voice('en-US'), voice('ja-JP'), voice('zh-CN'), voice('zh-TW'), voice('zh-HK', 'Sinji')];
  assert.equal(pickVoice(all).name, 'Sinji');
  assert.equal(pickVoice(all.slice(0, 4)).lang, 'zh-TW');
  assert.equal(pickVoice([voice('fr-FR')]), null);
  assert.equal(pickVoice([]), null);
});

test('narrator: among equal languages a local voice beats a remote one', () => {
  const remote = voice('zh-HK', 'Remote', { localService: false });
  const local = voice('zh-HK', 'Local', { localService: true });
  assert.equal(pickVoice([remote, local]).name, 'Local');
});

test('narrator: estimateMs grows with length, shrinks with rate, and always has padding', () => {
  const short = estimateMs('閉眼');
  const long = estimateMs('各位玩家請閉上眼睛，狼人請張開眼睛，互相確認身份。');
  assert.ok(long > short);
  assert.ok(estimateMs('各位請閉眼', 2) < estimateMs('各位請閉眼', 1));
  assert.ok(short >= 1500, 'padding covers an onend that fires late');
  assert.ok(Number.isFinite(estimateMs('')) && Number.isFinite(estimateMs(null)));
  assert.equal(estimateMs('各位請閉眼', 99), estimateMs('各位請閉眼', 2), 'rate is clamped');
});

// ---- fake speech engine ----
function fakeEngine({ fireEnd = true, fireStart = true } = {}) {
  const spoken = [];
  const synth = {
    speak(u) {
      spoken.push(u);
      if (fireStart) setTimeout(() => u.onstart?.(), 0);
      if (fireEnd) setTimeout(() => u.onend?.(), 5);
    },
    cancel() { for (const u of spoken.splice(0)) u.onerror?.({ error: 'canceled' }); },
    getVoices: () => [voice('en-US'), voice('zh-HK', 'Sinji')],
    resume() {},
    addEventListener() {},
  };
  globalThis.speechSynthesis = synth;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  return { synth, spoken };
}
function dropEngine() {
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
}

test('narrator: speak resolves on onend and uses the Cantonese voice at the set rate', async () => {
  const { spoken } = fakeEngine();
  try {
    const n = createNarrator();
    assert.equal(n.hasCantonese(), true);
    assert.equal(n.pickDefault(), 'uri:Sinji');
    n.set({ rate: 1.2, volume: 0.5 });
    await n.speak('各位請閉眼');
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].text, '各位請閉眼');
    assert.equal(spoken[0].voice.name, 'Sinji');
    assert.equal(spoken[0].lang, 'zh-HK');
    assert.equal(spoken[0].rate, 1.2);
    assert.equal(spoken[0].volume, 0.5);
  } finally { dropEngine(); }
});

test('narrator: prime speaks one silent empty utterance', () => {
  const { spoken } = fakeEngine({ fireEnd: false, fireStart: false });
  try {
    createNarrator().prime();
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].text, '');
    assert.equal(spoken[0].volume, 0);
  } finally { dropEngine(); }
});

test('narrator: speak falls back to the length-based timeout when onend never fires', async () => {
  fakeEngine({ fireEnd: false });
  try {
    const n = createNarrator();
    const t0 = performance.now();
    await n.speak('閉眼');
    const took = performance.now() - t0;
    assert.ok(took >= estimateMs('閉眼') - 100, `resolved too early (${Math.round(took)} ms)`);
    assert.ok(took < estimateMs('閉眼') + 1500, `resolved too late (${Math.round(took)} ms)`);
  } finally { dropEngine(); }
});

test('narrator: cancel settles every pending speak at once', async () => {
  fakeEngine({ fireEnd: false });
  try {
    const n = createNarrator();
    const a = n.speak('第一句');
    const b = n.speak('第二句');
    let done = 0;
    a.then(() => done++);
    b.then(() => done++);
    n.cancel();
    await Promise.all([a, b]);
    assert.equal(done, 2);
  } finally { dropEngine(); }
});

test('narrator: without a speech engine speak still resolves (the game must not stall)', async () => {
  dropEngine();
  const n = createNarrator();
  assert.equal(n.supported, false);
  assert.equal(n.hasCantonese(), false);
  assert.deepEqual(n.voices(), []);
  const t0 = performance.now();
  await n.speak('閉眼');
  assert.ok(performance.now() - t0 >= estimateMs('閉眼') - 100);
  assert.equal(await n.speak(''), undefined, 'empty text resolves at once');
});
