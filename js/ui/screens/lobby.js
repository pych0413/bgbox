// ============================================================
// screens/lobby.js — the room before a game: who is here, which game, how
// it is set up, and 開始.
//
// Everyone sees the same lobby (the host's picks show up live); only the host
// can change things. The start tap is also where iOS gets its gesture: the
// narrator and Web Audio are primed there, as the very first thing.
// ============================================================

import { el, dieFace, sig, toast } from '../dom.js?v=20261003075532';
import { sfx, primeAudio } from '../../core/sfx.js?v=20261003075532';
import { SeatEditor, ConfigForm, Scoreboard, RulesSheet } from '../components/index.js?v=20261003075532';
import { fits } from '../logic.js?v=20261003075532';

const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let qrLoading = null;

/** Pulled in on demand so it never sits on the load path. */
function loadQrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrLoading ??= new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = QR_CDN;
    tag.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('qrcode global missing')));
    tag.onerror = () => { qrLoading = null; reject(new Error('QR CDN unreachable')); };
    document.head.append(tag);
  });
  return qrLoading;
}

const range = (r, unit) => (r?.length ? (r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}–${r[1]}${unit}`) : '');

/** The core answers most lobby calls with { ok, message }; show the message when it says no. */
function report(res) {
  if (res && res.ok === false && res.message) toast(res.message, 2400);
  return res;
}

export function mountLobby(sh) {
  const { app, narrator } = sh;
  let last = app.state;
  let gridKey = null;
  let detailKey = null;
  let qrShown = false;
  let qrBuiltFor = null;

  // ---------- top bar ----------
  const title = el('h2');
  const topbar = el('header', { class: 'topbar' },
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': '離開', onclick: () => sh.leave() }, '‹'),
    title, sh.soundButton());

  // ---------- room code ----------
  const bigCode = el('div', { class: 'big-code' });
  const qrBox = el('div', { class: 'qr-canvas' });
  const qrWrap = el('div', { class: 'qr-wrap' }, qrBox);
  qrWrap.hidden = true;
  const qrBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '📱 QR Code');
  const codeCard = el('div', { class: 'card code-card' },
    el('span', { class: 'field-label', text: '房間號碼 — 講俾朋友聽' }),
    bigCode,
    el('div', { class: 'code-actions' },
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => {
          const url = sh.roomLink(last.code);
          try { await navigator.clipboard.writeText(url); toast('連結已複製'); }
          catch { window.prompt('複製呢條連結：', url); }
        },
      }, '📋 複製連結'),
      qrBtn),
    qrWrap);

  qrBtn.addEventListener('click', async () => {
    qrShown = !qrShown;
    qrWrap.hidden = !qrShown;
    if (qrShown) await buildQr();
  });

  async function buildQr() {
    const code = last.code;
    if (!code || qrBuiltFor === code) return;
    try {
      const qrcode = await loadQrLib();
      const qr = qrcode(0, 'M');
      qr.addData(sh.roomLink(code));
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 5, margin: 1, scalable: true });   // library output, no user text
      qrBuiltFor = code;
    } catch {
      qrBox.replaceChildren(el('div', { class: 'qr-fail', text: '載入唔到 QR — 用「複製連結」啦' }));
    }
  }

  // ---------- seats ----------
  const countPill = el('span', { class: 'pill' });
  const seatEditor = SeatEditor({});
  const addInput = el('input', {
    type: 'text', maxlength: '12', placeholder: '佢個名（同你一齊用呢部機）', enterkeyhint: 'done',
    'aria-label': '加一個人用呢部手機', autocomplete: 'off',
  });
  const addBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '＋ 加入');
  const addSeat = async () => {
    const n = addInput.value.trim();
    if (!n) { addInput.focus(); return; }
    try {
      const res = report(await app.lobby.addSeat(n));
      if (res?.ok === false) return;
      addInput.value = '';
      sfx('join');
    } catch (err) {
      console.error(err);
      toast(String(err?.message ?? '加唔到人'));
    }
  };
  addBtn.addEventListener('click', addSeat);
  addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addSeat(); });
  const addRow = el('div', { class: 'add-seat' }, addInput, addBtn);
  const addNote = el('p', { class: 'hint', style: { margin: '.5rem 0 0' }, text: '有人電話冇電或者冇數據？加佢喺度，部機傳嚟傳去玩。' });

  const seatsCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '玩家' }), countPill),
    seatEditor.el, addRow, addNote);

  // ---------- game picker ----------
  const gridHint = el('span', { class: 'hint' });
  const grid = el('div', { class: 'game-grid' });
  const detail = el('div');
  const gameCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '揀遊戲' }), gridHint), grid, detail);

  // ---------- config ----------
  const configForm = ConfigForm({});
  const configCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '設定' })), configForm.el);

  const summaryTags = el('div', { class: 'cfg-summary' });
  const validBox = el('div');
  const summaryCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '今局設定' })), summaryTags, validBox);

  // ---------- narration ----------
  const narrHint = el('div', { class: 'warn' });
  const narrSeg = el('div', { class: 'seg', role: 'group', 'aria-label': '旁白方式' },
    [['voice', '🔊 語音'], ['read', '📜 讀稿'], ['silent', '🔇 靜音']].map(([m, label]) => el('button', {
      type: 'button', 'data-mode': m,
      onclick: () => { if (m === 'silent') narrator.cancel(); app.narration.setMode(m); },
    }, label)));
  const voiceSel = el('select', { class: 'sel', 'aria-label': '旁白語音' });
  const rate = el('input', { type: 'range', min: '0.7', max: '1.3', step: '0.05', 'aria-label': '語速' });
  const rateLabel = el('span', { class: 'hint' });
  const testBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '▶ 試聽');
  const voiceBox = el('div', { style: { marginTop: '.75rem' } },
    el('span', { class: 'field-label', text: '語音' }), voiceSel,
    el('div', { class: 'card-head', style: { margin: '.75rem 0 .25rem' } },
      el('span', { class: 'field-label', style: { margin: 0 }, text: '語速' }), rateLabel),
    rate,
    el('div', { style: { marginTop: '.625rem' } }, testBtn));
  const narrCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '旁白' }), el('span', { class: 'hint', text: '主持用部手機讀稿' })),
    narrSeg, voiceBox, narrHint);

  voiceSel.addEventListener('change', () => { narrator.set({ voiceURI: voiceSel.value || null }); sh.saveNarration(); });
  rate.addEventListener('input', () => { narrator.set({ rate: Number(rate.value) }); rateLabel.textContent = `×${Number(rate.value).toFixed(2)}`; });
  rate.addEventListener('change', () => sh.saveNarration());
  testBtn.addEventListener('click', () => { narrator.prime(); narrator.test(); });
  const offVoices = narrator.onVoices(() => paintNarration(last));

  // ---------- history ----------
  const board = Scoreboard({});
  const boardCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', { text: '今晚戰績' })), board.el);

  // ---------- start ----------
  const startBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, '開始 ▶');
  const status = el('p', { class: 'status' });

  startBtn.addEventListener('click', async () => {
    // iOS gesture rule: prime speech and audio from the tap itself, before anything async
    narrator.prime();
    primeAudio();
    try {
      const res = await app.lobby.start();
      if (res && res.ok === false) toast(res.message || '開始唔到', 2600);
    } catch (err) {
      console.error(err);
      toast(String(err?.message ?? '開始唔到'), 2600);
    }
  });

  // ---------- painting ----------
  function headCount(room) { return room.players.filter((p) => !p.spectator).length; }

  function paintGrid(st) {
    const room = st.room;
    const n = headCount(room);
    const key = sig([n, room.gameId, room.loading, st.isHost, st.mode, sh.catalog.map((c) => [c.id, c.ready, !!sh.cached(c.id)])]);
    if (key === gridKey) return;
    gridKey = key;

    grid.replaceChildren(...sh.catalog.map((entry) => {
      const meta = sh.gameMeta(entry.id);
      const fit = entry.ready ? fits(meta, n, st.mode) : { ok: false, reason: '' };
      const selected = room.gameId === entry.id;
      const interactive = st.isHost && entry.ready && fit.ok;
      const body = [
        selected ? el('span', { class: 'gc-badge is-sel', text: room.loading === entry.id ? '載入緊…' : '已揀' }) : null,
        !entry.ready ? el('span', { class: 'gc-badge', text: '即將推出' }) : null,
        el('div', { class: 'gc-emoji', text: meta.emoji ?? '🎲' }),
        el('div', { class: 'gc-name', text: meta.name }),
        entry.ready
          ? el('div', { class: 'gc-meta', text: [range(meta.players, ' 人'), range(meta.minutes, ' 分鐘')].filter(Boolean).join(' · ') })
          : null,
        meta.blurb ? el('div', { class: 'gc-blurb', text: meta.blurb }) : null,
        entry.ready && !fit.ok ? el('div', { class: 'gc-reason', text: fit.reason }) : null,
        entry.ready && fit.ok && st.mode === 'local' && meta.singleDevice === 'partial'
          ? el('div', { class: 'gc-reason', style: { color: '#e8c98a' }, text: '一部手機：部分玩法' }) : null,
      ];
      const cls = 'game-card' + (selected ? ' selected' : '') + (entry.ready ? (fit.ok ? '' : ' off') : ' soon');
      const style = { '--accent': meta.accent ?? 'var(--cheese)' };
      if (!interactive) {
        const card = el('div', { class: cls, style }, body);
        if (st.isHost) {
          card.addEventListener('click', () => toast(!entry.ready ? '即將推出' : fit.reason, 1800));
        }
        return card;
      }
      return el('button', {
        class: cls, type: 'button', style,
        onclick: async () => {
          sfx('tap');
          try { report(await app.lobby.selectGame(entry.id)); } catch (err) { console.error(err); toast('揀唔到呢隻遊戲'); }
        },
      }, body);
    }));

    gridHint.textContent = st.isHost ? `${n} 人` : `房主揀 · ${n} 人`;
  }

  function paintDetail(st) {
    const room = st.room;
    const meta = room.gameId ? sh.gameMeta(room.gameId) : null;
    const game = room.gameId ? sh.cached(room.gameId) : null;
    const key = sig([room.gameId, !!game, st.isHost]);
    if (key === detailKey) return;
    detailKey = key;

    if (!meta) { detail.replaceChildren(); return; }
    if (room.gameId && !game) sh.loadGame(room.gameId).catch((err) => { console.error(err); toast('載入唔到呢隻遊戲'); });

    const quick = game?.rules?.quick ?? [];
    detail.replaceChildren(el('div', { class: 'game-detail', style: { '--accent': meta.accent ?? 'var(--cheese)' } },
      el('h4', { text: `${meta.emoji ?? '🎲'} ${meta.name}` }),
      meta.blurb ? el('div', { class: 'hint', text: meta.blurb }) : null,
      quick.length ? el('ul', {}, quick.map((q) => el('li', { text: q }))) : null,
      !game ? el('div', { class: 'hint', style: { margin: '.5rem 0' }, text: '載入緊規則…' }) : null,
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', disabled: !game,
        onclick: () => RulesSheet.open(sh.cached(room.gameId)),
      }, '📖 完整規則')));
  }

  function paintConfig(st) {
    const room = st.room;
    const game = room.gameId ? sh.cached(room.gameId) : null;
    const n = headCount(room);

    summaryCard.hidden = !room.gameId;
    summaryTags.replaceChildren(...(room.configSummary ?? []).map((line) => el('span', { class: 'tag', text: line })));
    const v = room.configValid;
    const boxes = [];
    if (v && v.ok === false && v.message) boxes.push(el('div', { class: 'warn err', text: v.message }));
    for (const w of v?.warnings ?? []) boxes.push(el('div', { class: 'warn', text: w }));
    validBox.replaceChildren(...boxes);

    configCard.hidden = !(st.isHost && game);
    if (!configCard.hidden) {
      let fields = [];
      try { fields = game.config.fields(room.config, n) ?? []; } catch (err) { console.error('config.fields failed', err); }
      configForm.update({
        fields, value: room.config ?? {},
        onChange: (cfg) => report(app.lobby.setConfig(cfg)),
      });
    }
  }

  function paintNarration(st) {
    if (!st?.room) return;
    const room = st.room;
    const meta = room.gameId ? sh.gameMeta(room.gameId) : null;
    const show = st.isHost && !!meta && meta.narration && meta.narration !== 'none';
    narrCard.hidden = !show;
    if (!show) return;

    const mode = room.narration?.mode ?? 'voice';
    for (const b of narrSeg.children) b.classList.toggle('on', b.dataset.mode === mode);

    voiceBox.hidden = mode !== 'voice';
    const voices = narrator.voices();
    const chosen = narrator.settings.voiceURI ?? '';
    const key = sig([voices.map((v) => v.voiceURI), chosen]);
    if (voiceSel.dataset.k !== key) {
      voiceSel.dataset.k = key;
      voiceSel.replaceChildren(
        el('option', { value: '' }, '自動揀（最啱嘅語音）'),
        ...voices.map((v) => el('option', { value: v.voiceURI }, `${v.name}（${v.lang}）`)));
      voiceSel.value = chosen;
    }
    if (document.activeElement !== rate) rate.value = String(narrator.settings.rate);
    rateLabel.textContent = `×${Number(narrator.settings.rate).toFixed(2)}`;

    const notes = [];
    if (mode === 'voice' && narrator.supported === false) notes.push('呢部機唔支援語音朗讀，可以轉「讀稿」由人讀。');
    else if (mode === 'voice' && !narrator.hasCantonese()) {
      notes.push('你部機未裝粵語語音，會用第啲語音代替。iPhone：設定 → 輔助使用 → 朗讀內容 → 聲音 → 粵語，下載「善怡」。');
    }
    if (mode === 'silent' && meta.narration === 'required') notes.push('呢隻遊戲靠旁白推進，靜音嘅話只會顯示文字提示，要自己睇住讀。');
    narrHint.hidden = !notes.length;
    narrHint.textContent = notes.join(' ');
  }

  function paintStart(st) {
    const room = st.room;
    const meta = room.gameId ? sh.gameMeta(room.gameId) : null;
    if (!st.isHost) {
      startBtn.hidden = true;
      status.textContent = meta ? `房主揀咗 ${meta.emoji ?? ''} ${meta.name}，等佢開始…` : '等房主揀遊戲…';
      status.className = 'status';
      return;
    }
    startBtn.hidden = false;
    let reason = '';
    if (!room.gameId) reason = '揀隻遊戲先';
    else if (room.loading) reason = '載入緊遊戲…';
    else {
      const fit = fits(meta, headCount(room), st.mode);
      if (!fit.ok) reason = fit.reason;
      else if (room.configValid && room.configValid.ok === false) reason = room.configValid.message || '設定未啱';
    }
    startBtn.disabled = !!reason;
    status.textContent = reason || '夠人喇，開得！';
    status.className = 'status' + (reason ? '' : ' ok');
  }

  const root = el('section', { class: 'screen', 'data-screen': 'lobby' },
    topbar, codeCard, seatsCard, gameCard, summaryCard, configCard, narrCard, boardCard, startBtn, status);

  return {
    el: root,
    update(st) {
      last = st;
      const room = st.room;
      if (!room) return;

      title.textContent = st.mode === 'local' ? '一部手機玩' : st.isHost ? '等緊人入房' : '等房主開始';

      codeCard.hidden = st.mode === 'local' || !st.code;
      if (!codeCard.hidden) {
        const key = String(st.code);
        if (bigCode.dataset.code !== key) {
          bigCode.dataset.code = key;
          bigCode.replaceChildren(...key.split('').map((ch) => dieFace(Number(ch))));
        }
        if (qrShown) buildQr();
      }

      const mySeats = st.mySeats ?? [];
      countPill.textContent = `${headCount(room)} 人`;
      seatEditor.update({
        players: room.players,
        me: st.activeSeat ?? mySeats[0],
        mySeats,
        isHost: st.isHost,
        onMove: (pid, index) => report(app.lobby.moveSeat(pid, index)),
        onColor: (pid, color) => report(app.lobby.setColor(pid, color)),
        onKick: (pid) => {
          const p = room.players.find((x) => x.id === pid);
          if (mySeats.includes(pid)) report(app.lobby.removeSeat(pid));
          else if (sh.confirm(`踢走 ${p?.name ?? ''}？`)) report(app.lobby.kick(pid));
        },
      });

      paintGrid(st);
      paintDetail(st);
      paintConfig(st);
      paintNarration(st);

      boardCard.hidden = !(room.history?.length);
      if (!boardCard.hidden) {
        board.update({ players: room.players, scoreboard: room.scoreboard, history: room.history, games: sh.gamesById(), me: st.activeSeat ?? mySeats[0] });
      }
      paintStart(st);
    },
    destroy() {
      offVoices();
      seatEditor.destroy();
      configForm.destroy();
      board.destroy();
    },
  };
}
