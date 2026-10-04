// ============================================================
// registry.js — every game the box knows about, with enough inline meta for
// the picker to draw its cards WITHOUT loading any game module.
//
// `load()` dynamic-imports the game's index.js (default export = the full game:
// meta, rules, config, engine, ui). A game whose module is missing shows as
// 「即將推出」 (the shell probes batch-2 entries once).
//
// Each game's own `game.js` meta is the single source of truth (G16). The
// copy below exists only so the picker needs no module; tests/core.test.mjs
// fails if a field here drifts from game.js. Mirrored fields:
//   name, emoji, players, minutes, blurb, singleDevice, narration
// (`batch` lives only here: 1 = shipped, 2 = probed before it is offered. All ten shipped 2026-10-03.)
// ============================================================

export const GAMES = [
  {
    id: 'cheese-thief',
    meta: { name: '芝士大盜', emoji: '🧀', players: [4, 8], minutes: [10, 15], batch: 1,
      singleDevice: 'full', narration: 'required',
      blurb: '每人一粒秘密骰仔，天黑咗按點鐘睜眼 — 有人偷咗芝士，揪出大盜。' },
    load: () => import('./cheese-thief/index.js?v=20261004005209'),
  },
  {
    id: 'onuw',
    meta: { name: '一夜終極狼人', emoji: '🐺', players: [3, 10], minutes: [10, 20], batch: 1,
      singleDevice: 'partial', narration: 'recommended',
      blurb: '一晚換牌、一次投票，連自己係邊個都未必肯定。' },
    load: () => import('./onuw/index.js?v=20261004005209'),
  },
  {
    id: 'werewolf',
    meta: { name: '狼人殺', emoji: '🐺', players: [6, 13], minutes: [25, 60], batch: 1,
      singleDevice: 'partial', narration: 'required',
      blurb: '手機做上帝：夜晚閉眼、天光投票，揪出狼人。' },
    load: () => import('./werewolf/index.js?v=20261004005209'),
  },
  {
    id: 'avalon',
    meta: { name: '阿瓦隆', emoji: '🏰', players: [5, 10], minutes: [30, 45], batch: 1,
      singleDevice: 'full', narration: 'optional',
      blurb: '組隊出任務，好人要搵出內鬼，壞人要守住梅林。' },
    load: () => import('./avalon/index.js?v=20261004005209'),
  },
  {
    id: 'undercover',
    meta: { name: '誰是臥底', emoji: '🕵️', players: [4, 12], minutes: [15, 30], batch: 1,
      singleDevice: 'full', narration: 'optional',
      blurb: '人人一個詞，臥底嘅詞好似但唔同 — 一句嘢形容，投出臥底！' },
    load: () => import('./undercover/index.js?v=20261004005209'),
  },
  {
    id: 'spyfall',
    meta: { name: '間諜', emoji: '🛩️', players: [3, 12], minutes: [10, 45], batch: 1,
      singleDevice: 'full', narration: 'optional',
      blurb: '每人都知喺邊，除咗間諜。發問、答問，睇邊個露馬腳。' },
    load: () => import('./spyfall/index.js?v=20261004005209'),
  },
  {
    id: 'fake-artist',
    meta: { name: '假畫家', emoji: '🎨', players: [3, 10], minutes: [15, 25], batch: 1,
      singleDevice: 'full', narration: 'optional',
      blurb: '大家輪流落一筆畫同一幅畫，但有個人唔知畫乜。' },
    load: () => import('./fake-artist/index.js?v=20261004005209'),
  },
  {
    id: 'draw-guess',
    meta: { name: '你畫我猜', emoji: '✏️', players: [3, 12], minutes: [15, 30], batch: 1,
      singleDevice: 'partial', narration: 'optional',
      blurb: '一個人畫，其他人搶住估，畫得越快越高分。' },
    load: () => import('./draw-guess/index.js?v=20261004005209'),
  },
  {
    id: '9upper',
    meta: { name: '瞎掰王 9upper', emoji: '🎭', players: [3, 9], minutes: [15, 30], batch: 1,
      singleDevice: 'full', narration: 'optional',
      blurb: '一本正經噏下去，邊個講嘅係真、邊個係瞎掰？' },
    load: () => import('./9upper/index.js?v=20261004005209'),
  },
  {
    id: 'custom',
    meta: { name: '通用派牌＋骰盅', emoji: '🎲', players: [2, 16], minutes: [5, 30], batch: 1,
      singleDevice: 'full', narration: 'none',
      blurb: '自己設定角色牌同秘密骰仔，咩遊戲都用得。' },
    load: () => import('./custom/index.js?v=20261004005209'),
  },
];

export const gameEntry = (id) => GAMES.find((g) => g.id === id) ?? null;

/** The fields every registry entry mirrors from its game's own meta (checked by tests). */
export const MIRRORED_META = Object.freeze(['name', 'emoji', 'players', 'minutes', 'blurb', 'singleDevice', 'narration']);
