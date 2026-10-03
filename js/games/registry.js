// ============================================================
// registry.js — every game the box knows about, with enough inline meta for
// the picker to draw its cards WITHOUT loading any game module.
//
// `load()` dynamic-imports the game's index.js (default export = the full game:
// meta, rules, config, engine, ui). Batch-2 games may not exist yet; the picker
// shows them as 「即將推出」 when load() rejects.
//
// Keep `meta` here in step with each game's own meta (name, emoji, players,
// minutes, blurb). The loaded module's meta is authoritative once available.
// ============================================================

export const GAMES = [
  {
    id: 'cheese-thief',
    meta: { name: '芝士大盜', emoji: '🧀', players: [4, 8], minutes: [10, 15], batch: 1,
      blurb: '一夜之間芝士被偷，搖骰仔、睇同伴，揪出隻賊鼠。' },
    load: () => import('./cheese-thief/index.js?v=20261003075613'),
  },
  {
    id: 'onuw',
    meta: { name: '一夜終極狼人', emoji: '🐺', players: [3, 10], minutes: [10, 20], batch: 1,
      blurb: '一晚換牌、一次投票，連自己係邊個都未必肯定。' },
    load: () => import('./onuw/index.js?v=20261003075613'),
  },
  {
    id: 'werewolf',
    meta: { name: '狼人殺', emoji: '🌙', players: [6, 12], minutes: [30, 60], batch: 1,
      blurb: '天黑請閉眼，部手機做晒主持，你專心講嘢同投票。' },
    load: () => import('./werewolf/index.js?v=20261003075613'),
  },
  {
    id: 'avalon',
    meta: { name: '阿瓦隆', emoji: '🏰', players: [5, 10], minutes: [30, 45], batch: 1,
      blurb: '組隊出任務，好人要搵出內鬼，壞人要守住梅林。' },
    load: () => import('./avalon/index.js?v=20261003075613'),
  },
  {
    id: 'undercover',
    meta: { name: '誰是臥底', emoji: '🕵️', players: [4, 12], minutes: [15, 30], batch: 1,
      blurb: '大家拎到相似嘅詞，輪流描述，揾出拎住唔同詞嘅臥底。' },
    load: () => import('./undercover/index.js?v=20261003075613'),
  },
  {
    id: 'spyfall',
    meta: { name: '間諜', emoji: '🛩️', players: [3, 8], minutes: [10, 20], batch: 1,
      blurb: '每人都知喺邊，除咗間諜。發問、答問，睇邊個露馬腳。' },
    load: () => import('./spyfall/index.js?v=20261003075613'),
  },
  {
    id: 'fake-artist',
    meta: { name: '假畫家', emoji: '🎨', players: [5, 10], minutes: [15, 25], batch: 2,
      blurb: '大家輪流落一筆畫同一幅畫，但有個人唔知畫乜。' },
    load: () => import('./fake-artist/index.js?v=20261003075613'),
  },
  {
    id: 'draw-guess',
    meta: { name: '你畫我猜', emoji: '✏️', players: [3, 12], minutes: [15, 30], batch: 2,
      blurb: '一個人畫，其他人搶住估，畫得越快越高分。' },
    load: () => import('./draw-guess/index.js?v=20261003075613'),
  },
  {
    id: '9upper',
    meta: { name: '瞎掰王 9upper', emoji: '🎭', players: [3, 9], minutes: [15, 30], batch: 2,
      blurb: '一本正經噏下去，邊個講嘅係真、邊個係瞎掰？' },
    load: () => import('./9upper/index.js?v=20261003075613'),
  },
  {
    id: 'custom',
    meta: { name: '通用派牌＋骰盅', emoji: '🎲', players: [2, 16], minutes: [5, 30], batch: 1,
      blurb: '自己設定角色牌同秘密骰仔，咩遊戲都用得。' },
    load: () => import('./custom/index.js?v=20261003075613'),
  },
];

export const gameEntry = (id) => GAMES.find((g) => g.id === id) ?? null;
