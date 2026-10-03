// ============================================================
// screens/results.js — who won and why, this game's points, the evening's
// scoreboard, and (host only) 再玩一局 / 換遊戲.
//
//  - 「點解會咁」 renders result.lines in sections: a line that is { h: '標題' } or a
//    string '── 標題 ──' starts a foldable section. A long recap starts folded except
//    its first section (logic.js resultSections / sectionsOpen).
//  - Drawing games leave a keepsake: the picture(s) of the game just played, view-only,
//    with 「💾 儲存圖片」 (PNG through the share sheet where there is one, else a download).
//    The PNGs are made as soon as the screen opens, so the tap itself can call
//    navigator.share (iOS only allows it inside a real tap).
// ============================================================

import { el, sig, toast } from '../dom.js?v=1';
import { sfx } from '../../core/sfx.js?v=1';
import { Scoreboard, Canvas } from '../components/index.js?v=1';
import { resultSections, sectionsOpen, pictureFileName } from '../logic.js?v=1';
import { paintStrokes } from '../ink.js?v=1';

const CONFETTI = ['🎉', '✨', '🧀', '🎊', '⭐'];
const PNG_PX = 1080;              // the picture itself; a strip underneath says what and when
const PNG_FOOTER = 96;

function confetti() {
  const n = 22;
  return el('div', { class: 'confetti', 'aria-hidden': 'true' }, Array.from({ length: n }, (_, i) => el('i', {
    style: {
      '--x': `${(i * 100) / n + ((i * 37) % 7)}%`,
      '--d': `${2.6 + ((i * 53) % 18) / 10}s`,
      '--w': `${((i * 29) % 14) / 10}s`,
      '--r': `${(i % 2 ? 1 : -1) * (240 + ((i * 41) % 200))}deg`,
    },
    text: CONFETTI[i % CONFETTI.length],
  })));
}

/** A keepsake picture as a PNG blob (null if this browser cannot make one). */
function pictureBlob(strokes, { colorOf, caption }) {
  return new Promise((resolve) => {
    try {
      const c = document.createElement('canvas');
      c.width = PNG_PX;
      c.height = PNG_PX + PNG_FOOTER;
      const g = c.getContext('2d');
      if (!g) { resolve(null); return; }
      g.fillStyle = '#14110c';
      g.fillRect(0, 0, c.width, c.height);
      g.save();
      g.setTransform(PNG_PX / 1000, 0, 0, PNG_PX / 1000, 0, 0);
      paintStrokes(g, strokes, { colorOf });
      g.restore();
      g.fillStyle = '#f5ecd7';
      g.font = `600 ${Math.round(PNG_FOOTER * 0.36)}px -apple-system, "PingFang HK", "Noto Sans HK", sans-serif`;
      g.textBaseline = 'middle';
      g.fillText(caption, 32, PNG_PX + PNG_FOOTER / 2, PNG_PX - 64);
      // hand the bitmap back at once: iOS counts canvas memory, and a game can have two dozen pictures
      c.toBlob((b) => { c.width = c.height = 0; resolve(b); }, 'image/png');
    } catch (err) {
      console.warn('[results] picture export failed', err);
      resolve(null);
    }
  });
}

/** Share sheet (iOS: 儲存影像 lives there), else one download per picture. */
async function savePictures(files) {
  if (!files.length) return false;
  try {
    if (navigator.canShare?.({ files }) && navigator.share) {
      await navigator.share({ files, title: '桌遊盒' });
      return true;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return true;        // the person closed the share sheet: fine
    console.warn('[results] share failed, downloading instead', err);
  }
  for (const f of files) {
    const url = URL.createObjectURL(f);
    const a = el('a', { href: url, download: f.name, style: { display: 'none' } });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return true;
}

export function mountResults(sh) {
  const { app, narrator } = sh;
  let shownKey = null;

  const hero = el('div');
  const keepCard = el('div', { class: 'card keepsake' });
  keepCard.hidden = true;
  const linesCard = el('div', { class: 'card' });
  const pointsCard = el('div', { class: 'card' });
  const board = Scoreboard({});
  const boardCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '今晚戰績' })), board.el);

  const report = (res) => { if (res && res.ok === false && res.message) toast(res.message, 2600); };
  const againBtn = el('button', {
    class: 'btn btn-primary btn-lg', type: 'button',
    onclick: async () => {
      narrator.prime();   // a fresh tap is a free chance to keep iOS speech unlocked
      try { report(await app.results.again()); } catch (err) { console.error(err); }
    },
  }, '🔁 再玩一局');
  const lobbyBtn = el('button', {
    class: 'btn btn-ghost btn-lg', type: 'button',
    onclick: async () => { try { report(await app.results.toLobby()); } catch (err) { console.error(err); } },
  }, '🎲 換遊戲');
  const waiting = el('p', { class: 'status', text: '等房主揀，再玩一局定換遊戲…' });
  const leaveBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: { margin: '1rem auto 0' }, onclick: () => sh.leave() }, '🚪 離開房間');

  // a table timer keeps running between games (T1): its strip stays on screen here too
  const timerStrip = sh.timer?.strip?.() ?? null;
  const timerRow = el('div', { class: 'results-tools' }, timerStrip, sh.timer?.button?.() ?? null);
  const root = el('section', { class: 'screen results', 'data-screen': 'results' },
    timerRow, hero, keepCard, linesCard, pointsCard, boardCard, againBtn, lobbyBtn, waiting, leaveBtn);

  const confettiHost = el('div');
  root.append(confettiHost);

  // ---------- 「點解會咁」 in sections ----------
  function paintLines(lines) {
    const sections = resultSections(lines);
    linesCard.hidden = !sections.length;
    if (!sections.length) { linesCard.replaceChildren(); return; }
    const open = sectionsOpen(sections);
    const list = (ls) => el('ul', { class: 'results-lines' }, ls.map((l) => el('li', { text: l })));
    linesCard.replaceChildren(
      el('div', { class: 'card-head' }, el('h3', { text: '點解會咁' })),
      ...sections.map((s, i) => (s.title === null
        ? list(s.lines)
        : el('details', { class: 'results-sec', open: open[i] },
          el('summary', {}, el('span', { text: s.title }), el('small', { text: `${s.lines.length}` })),
          list(s.lines)))));
  }

  // ---------- keepsake (drawing games) ----------
  let keep = null;      // { key, pics, canvas, files: Promise<File[]>, urls: [], index }

  function dropKeepsake() {
    if (!keep) return;
    keep.canvas?.destroy();
    for (const u of keep.urls) URL.revokeObjectURL(u);
    keep = null;
  }

  function paintKeepsake(st) {
    // cheap signature first (no copying): earlier pictures + the current drawing
    const raw = [...(st.pictures ?? []), ...(st.ink?.strokes?.length ? [st.ink] : [])];
    const key = sig([st.room.lastResult?.gameId, raw.map((p) => [p.epoch, p.strokes.length, p.strokes.at(-1)?.pts?.length ?? 0])]);
    if (keep?.key === key || (!keep && !raw.length)) { if (!raw.length) keepCard.hidden = true; return; }
    const pics = (typeof app.keepsake === 'function' ? app.keepsake() : raw).filter((p) => p?.strokes?.length);
    dropKeepsake();
    keepCard.hidden = !pics.length;
    if (!pics.length) { keepCard.replaceChildren(); return; }

    const players = st.room.players ?? [];
    const colorOf = (pid) => players.find((p) => p.id === pid)?.color ?? null;
    const meta = sh.gameMeta(st.room.lastResult?.gameId ?? st.room.gameId) ?? {};
    const when = new Date();
    const caption = `${meta.emoji ?? '🎨'} ${meta.name ?? '桌遊盒'} · 桌遊盒 · ${when.getFullYear()}/${when.getMonth() + 1}/${when.getDate()}`;

    const canvas = Canvas({ ink: { epoch: 0, strokes: pics.at(-1).strokes }, canDraw: false, tools: 'none', colorOf });
    const thumbs = el('div', { class: 'keepsake-thumbs' });
    const saveBtn = el('button', { class: 'btn btn-primary', type: 'button' }, '💾 儲存圖片');
    const label = el('span', { class: 'hint' });
    keep = { key, pics, canvas, urls: [], index: pics.length - 1, files: null };
    const mine = keep;

    const show = (i) => {
      if (keep !== mine) return;
      mine.index = i;
      canvas.update({ ink: { epoch: i, strokes: pics[i].strokes }, canDraw: false, tools: 'none', colorOf });
      for (const [j, t] of [...thumbs.children].entries()) t.classList.toggle('on', j === i);
      label.textContent = pics.length > 1 ? `第 ${i + 1} / ${pics.length} 幅` : '';
    };

    // the PNGs, made now (one at a time: one big bitmap alive at once) so the 💾 tap can share them straight away
    mine.files = (async () => {
      const out = [];
      for (const [i, p] of pics.entries()) {
        if (keep !== mine) break;                    // left the screen, or a newer picture set
        const b = await pictureBlob(p.strokes, { colorOf, caption });
        if (!b) continue;
        if (keep === mine && pics.length > 1) {
          const url = URL.createObjectURL(b);
          mine.urls.push(url);
          thumbs.children[i]?.replaceChildren(el('img', { src: url, alt: `第 ${i + 1} 幅` }));
        }
        out.push(new File([b], pictureFileName(meta.name, i, when), { type: 'image/png' }));
      }
      return out;
    })();

    if (pics.length > 1) {
      thumbs.replaceChildren(...pics.map((_, i) => el('button', {
        class: 'keepsake-thumb', type: 'button', 'aria-label': `睇第 ${i + 1} 幅`,
        onclick: () => { sfx('tap'); show(i); },
      }, el('span', { text: String(i + 1) }))));
    }

    let ready = null;
    mine.files.then((files) => { ready = files; saveBtn.disabled = !files.length; });
    saveBtn.addEventListener('click', async () => {
      // iOS lets share() run only inside the tap: use the files made earlier when they are there
      const files = ready ?? await mine.files;
      if (!files.length) { toast('呢部機整唔到圖'); return; }
      const which = pics.length > 1 ? files : files.slice(-1);
      try { if (await savePictures(which)) sfx('tap'); } catch (err) { console.error(err); toast('儲存唔到'); }
    });

    keepCard.replaceChildren(...[
      el('div', { class: 'card-head' }, el('h3', { text: pics.length > 1 ? '🖼️ 今局啲畫' : '🖼️ 今局幅畫' }), label),
      canvas.el,
      pics.length > 1 ? thumbs : null,
      el('div', { class: 'keepsake-actions' }, saveBtn,
        el('span', { class: 'hint', text: '留返做紀念 — 存落相簿或者傳俾朋友' })),
    ].filter(Boolean));
    show(pics.length - 1);
  }

  function paint(st) {
    const room = st.room;
    const res = room.lastResult;
    const names = new Map(room.players.map((p) => [p.id, p]));
    const meta = sh.gameMeta(res?.gameId ?? room.gameId) ?? {};
    const key = JSON.stringify([res, room.players.map((p) => [p.id, p.name, p.color])]);
    if (key === shownKey) return;
    const first = shownKey === null;
    shownKey = key;

    const winners = (res?.winners ?? []).map((id) => names.get(id)).filter(Boolean);
    const winnerIds = new Set(res?.winners ?? []);
    const iWon = (st.mySeats ?? []).some((id) => winnerIds.has(id));

    const voided = res?.void === true;          // 呢鋪唔計: nothing was scored
    const title = `${meta.emoji ?? ''} ${meta.name ?? ''}`;
    hero.replaceChildren(...[
      el('div', { class: 'results-trophy', text: voided ? '🚫' : winners.length ? '🏆' : '🤝' }),
      el('h2', { text: voided ? `${title} — 呢鋪唔計` : winners.length ? `${title} — 贏家` : `${title} — 冇人贏` }),
      el('div', { class: 'winners' }, winners.map((p, i) => el('span', {
        class: 'winner-chip', style: { '--seat': p.color ?? 'var(--cheese)', '--delay': `${i * 120}ms` },
        text: p.name,
      }))),
      res?.summary ? el('p', { class: 'results-summary', text: res.summary }) : null,
    ].filter(Boolean));

    paintLines(res?.lines ?? []);

    const pts = Object.entries(res?.points ?? {}).filter(([id]) => names.has(id));
    pointsCard.hidden = !pts.length;
    pointsCard.replaceChildren(
      el('div', { class: 'card-head' }, el('h3', { text: '呢局得分' })),
      el('div', { class: 'points-list' }, pts
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => el('span', { class: 'tag' }, names.get(id).name, el('b', { text: n > 0 ? `+${n}` : String(n) })))));

    // celebrate once, for people on the winning side; everyone else gets the fanfare only
    if (first) {
      sfx(iWon ? 'win' : 'reveal');
      if (iWon) {
        confettiHost.replaceChildren(confetti());
        setTimeout(() => confettiHost.replaceChildren(), 6000);
      }
    }
  }

  return {
    el: root,
    update(st) {
      const room = st.room;
      if (!room) return;
      paint(st);
      try { paintKeepsake(st); } catch (err) { console.error('[results] keepsake failed', err); keepCard.hidden = true; }
      board.update({
        players: room.players, scoreboard: room.scoreboard, history: room.history,
        games: sh.gamesById(), me: st.activeSeat ?? st.mySeats?.[0],
      });
      againBtn.hidden = !st.isHost;
      lobbyBtn.hidden = !st.isHost;
      waiting.hidden = st.isHost;
    },
    destroy() { dropKeepsake(); board.destroy(); },
  };
}
