// ============================================================
// screens/lobby.js — the room before a game: who is here, which game, how
// it is set up, and 開始.
//
// Everyone sees the same lobby (the host's picks show up live); only the host
// can change things. The start tap is also where iOS gets its gesture: the
// narrator and Web Audio are primed there, as the very first thing.
// ============================================================

import { el, dieFace, sig, toast, copyBox } from '../dom.js?v=20261004005209';
import { sfx, primeAudio } from '../../core/sfx.js?v=20261004005209';
import { SeatEditor, ConfigForm, Scoreboard, RulesSheet } from '../components/index.js?v=20261004005209';
import { fits, turnOrderMatters, savedOrderDiffers, presetMatches } from '../logic.js?v=20261004005209';

const ORDER_HINT = '座位次序＝輪流次序，開局前用換位排好';
import { wantsPreflight } from '../preflight.js?v=20261004005209';

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
  // ‹ is an icon: it keeps its face while armed and a toast says 「再㩒一次」 (#3)
  const backBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '離開', onclick: () => sh.leave(backBtn, { inline: false }) }, '‹');
  const topbar = el('header', { class: 'topbar' },
    backBtn,
    title, sh.timer.button(), sh.soundButton(), sh.settingsButton());
  const timerStrip = sh.timer.strip();

  // ---------- room code ----------
  const bigCode = el('div', { class: 'big-code' });
  const qrBox = el('div', { class: 'qr-canvas' });
  const qrWrap = el('div', { class: 'qr-wrap' }, qrBox);
  qrWrap.hidden = true;
  const qrBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, '📱 QR Code');
  // the clipboard can refuse (an in-app browser, no permission): the link then shows in the page to copy by
  // hand — never window.prompt, which freezes the host's phone (the room's server, #3)
  const linkCopy = copyBox();
  const codeCard = el('div', { class: 'card code-card' },
    el('span', { class: 'field-label', text: '房間號碼 — 講俾朋友聽' }),
    bigCode,
    el('div', { class: 'code-actions' },
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => linkCopy.copy(sh.roomLink(last.code)),
      }, '📋 複製連結'),
      qrBtn),
    linkCopy.el,
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

  // #9: the seat order saved at the last start on this phone
  const savedOrderBtn = el('button', { class: 'btn btn-ghost btn-sm saved-order', type: 'button' }, '↺ 用返上次座位');
  savedOrderBtn.addEventListener('click', () => {
    try { report(app.lobby.applySavedOrder()); sfx('tap'); } catch (err) { console.error(err); toast('排唔到'); }
  });
  const addNote = el('p', { class: 'hint', style: { margin: '.5rem 0 0' }, text: '有人電話冇電或者冇數據？加佢喺度，部機傳嚟傳去玩。' });
  // G18: one phone needs no network; everyone on their own phone does
  const localNote = el('p', { class: 'hint local-note', text: '📱 一部手機玩唔使上網。想每人用自己部手機玩，就要有網絡：返主頁揀「🏠 開房」。' });

  // G3: an offline lobby seat is dropped after a grace period unless the host keeps it
  const awayBox = el('div', { class: 'away-box' });
  let awayKey = null;

  const seatsCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '玩家' }), countPill),
    seatEditor.el, awayBox, savedOrderBtn, addRow, addNote, localNote);

  // ---------- game picker ----------
  const gridHint = el('span', { class: 'hint' });
  const grid = el('div', { class: 'game-grid' });
  const detail = el('div');
  // Once a game is picked the ten cards fold away (one less screenful above 開始); 換遊戲 brings them back.
  let gridOpen = false;
  const gridToggle = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', hidden: true,
    onclick: () => { gridOpen = !gridOpen; gridKey = null; paintGrid(last); },
  });
  const gameCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '揀遊戲' }), el('span', { style: { display: 'flex', gap: '.5rem', alignItems: 'center' } }, gridHint, gridToggle)), grid, detail);

  // ---------- config ----------
  const presetsBox = el('div', { class: 'cfg-presets' });
  let presetsKey = null;
  const configForm = ConfigForm({});
  const configCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '設定' })), presetsBox, configForm.el);

  const summaryTags = el('div', { class: 'cfg-summary' });
  const validBox = el('div');
  // Most tables play the defaults: the full form stays folded until the host asks for it (user, 2026-10-03).
  // Opened per game and remembered per identity; a setting that blocks the start unfolds it by itself.
  const CFG_OPEN_KEY = 'bgb:cfgOpen';
  const cfgOpen = (() => { try { const o = app.prefs?.get(CFG_OPEN_KEY, {}); return o && typeof o === 'object' ? { ...o } : {}; } catch { return {}; } })();
  const cfgToggle = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', hidden: true,
    onclick: () => {
      const id = last.room?.gameId;
      if (!id) return;
      cfgOpen[id] = !cfgOpen[id];
      try { app.prefs?.set(CFG_OPEN_KEY, cfgOpen); } catch { /* storage blocked: this visit only */ }
      paintConfig(last);
    },
  });
  const summaryCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '今局設定' }), cfgToggle), summaryTags, validBox);

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
  let voiceOpen = false;
  const voiceToggle = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button', style: { marginTop: '.5rem' },
    onclick: () => { voiceOpen = !voiceOpen; paintNarration(last); },
  });
  const narrCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { text: '旁白' }), el('span', { class: 'hint', text: '主持用部手機讀稿' })),
    narrSeg, voiceToggle, voiceBox, narrHint);

  voiceSel.addEventListener('change', () => { narrator.set({ voiceURI: voiceSel.value || null }); sh.saveNarration(); });
  rate.addEventListener('input', () => { narrator.set({ rate: Number(rate.value) }); rateLabel.textContent = `×${Number(rate.value).toFixed(2)}`; });
  rate.addEventListener('change', () => sh.saveNarration());
  testBtn.addEventListener('click', () => { narrator.prime(); narrator.test(); });
  const checkBtn = el('button', {
    class: 'btn btn-ghost btn-sm', type: 'button',
    onclick: () => sh.openPreflight({ meta: last.room?.gameId ? sh.gameMeta(last.room.gameId) : null }),
  }, '🔧 開波前檢查');
  voiceBox.lastElementChild.append(checkBtn);
  const offVoices = narrator.onVoices(() => paintNarration(last));

  // ---------- history ----------
  const board = Scoreboard({});
  const boardCard = el('div', { class: 'card' }, el('div', { class: 'card-head' }, el('h3', { text: '今晚戰績' })), board.el);

  // ---------- start ----------
  const startBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button' }, '開始 ▶');
  const status = el('p', { class: 'status' });
  // #39: 開始 ▶ stays on screen while the host scrolls the long settings (sticky at the bottom)
  const startBar = el('div', { class: 'lobby-start' }, startBtn, status);

  async function doStart() {
    // iOS gesture rule: prime speech and audio from the tap itself, before anything async
    narrator.prime();
    primeAudio();
    try {
      const res = await app.lobby.start();
      if (res && res.ok === false) toast(res.message || '開始唔到', 2600);
      else if (res?.warnings?.length) toast(String(res.warnings[0]), 3200);
    } catch (err) {
      console.error(err);
      toast(String(err?.message ?? '開始唔到'), 2600);
    }
  }

  startBtn.addEventListener('click', () => {
    narrator.prime();
    primeAudio();
    // #2: the first narrated game of the evening gets a 30-second check first; its own
    // 開始 button is a fresh tap, so speech is primed again right where it starts
    const st = app.state;
    const meta = st.room?.gameId ? sh.gameMeta(st.room.gameId) : null;
    if (wantsPreflight(st, meta)) { sh.openPreflight({ meta, onGo: doStart }); return; }
    doStart();
  });

  // ---------- painting ----------
  function headCount(room) { return room.players.filter((p) => !p.spectator).length; }

  function paintGrid(st) {
    const room = st.room;
    const n = headCount(room);
    const key = sig([n, room.gameId, room.loading, st.isHost, st.mode, gridOpen, sh.catalog.map((c) => [c.id, c.ready, !!sh.cached(c.id)])]);
    if (key === gridKey) return;
    gridKey = key;

    const folded = !!room.gameId && !gridOpen;
    grid.hidden = folded;
    gridToggle.hidden = !st.isHost || !room.gameId;
    gridToggle.textContent = gridOpen ? '收起 ▴' : '🔄 換遊戲';
    gridToggle.setAttribute('aria-expanded', String(!folded));

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
          gridOpen = false;   // picked: fold the cards again
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
      // help on demand only (user): the quick rules stay folded under one line
      quick.length ? el('details', { class: 'game-quick' },
        el('summary', { text: `💡 簡單講點玩（${quick.length} 句）` }),
        el('ul', {}, quick.map((q) => el('li', { text: q })))) : null,
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

    const blocked = !!(v && v.ok === false);
    const canEdit = !!(st.isHost && game);
    const open = canEdit && (blocked || !!cfgOpen[room.gameId]);
    cfgToggle.hidden = !canEdit || blocked;
    cfgToggle.textContent = open ? '收起 ▴' : '⚙️ 改設定';
    cfgToggle.setAttribute('aria-expanded', String(open));
    configCard.hidden = !open;
    if (!configCard.hidden) {
      paintPresets(room, game, n);
      let fields = [];
      // third argument: the content bag, so a 'categories' field can show 已用 / 總數 (#11)
      try { fields = game.config.fields(room.config, n, { bag: app.bag }) ?? []; } catch (err) { console.error('config.fields failed', err); }
      configForm.update({
        fields, value: room.config ?? {}, bag: app.bag ?? null,
        onChange: (cfg) => report(app.lobby.setConfig(cfg)),
        onBagChange: () => sh.rerender(),
      });
    }
  }

  /** One-tap presets with a reason (BACKLOG #8): `config.presets?(n, { singleDevice }) → [{ id, label, reason, cfg }]`. */
  function paintPresets(room, game, n) {
    let list = [];
    try { list = typeof game?.config?.presets === 'function' ? (game.config.presets(n, { singleDevice: !!room.singleDevice }) ?? []) : []; } catch (err) { console.error('config.presets failed', err); }
    list = list.filter((p) => p && p.label && p.cfg && typeof p.cfg === 'object');
    const cfg = room.config ?? {};
    const current = list.find((p) => presetMatches(cfg, p.cfg))?.id ?? null;
    const key = sig([list, current]);
    if (key === presetsKey) return;
    presetsKey = key;
    presetsBox.hidden = !list.length;
    presetsBox.replaceChildren(...(list.length ? [
      el('span', { class: 'field-label', text: '快速揀' }),
      el('div', { class: 'cfg-presets-list' }, list.map((p) => el('button', {
        class: 'cfg-preset' + (p.id === current ? ' on' : ''), type: 'button', 'aria-pressed': p.id === current ? 'true' : 'false',
        onclick: () => { sfx('tap'); report(app.lobby.setConfig({ ...(app.state.room?.config ?? {}), ...p.cfg })); },
      }, el('b', { text: p.label }), p.reason ? el('small', { text: p.reason }) : null))),
    ] : []));
  }

  function paintAway(st) {
    const list = st.isHost && typeof app.lobby?.keepSeat === 'function'
      ? st.room.players.filter((p) => !p.connected && !p.spectator && p.dropAt && !p.keep)
      : [];
    const key = sig(list.map((p) => [p.id, p.name, p.dropAt]));
    if (key === awayKey) return;
    awayKey = key;
    awayBox.replaceChildren(...list.map((p) => el('div', { class: 'banner' },
      el('span', { class: 'grow', text: `📴 ${p.name} 斷咗線 — 三分鐘內返唔到就會移走` }),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: () => { report(app.lobby.keepSeat(p.id, true)); sfx('tap'); },
      }, '保留個位'))));
  }

  /** #9: offer 「用返上次座位」 when the people here sat in a different order last time. */
  function paintSavedOrder(st) {
    const g = sh.savedGroup();
    const canApply = st.isHost && typeof app.lobby?.applySavedOrder === 'function' && !!g;
    savedOrderBtn.hidden = !canApply || !savedOrderDiffers(st.room.players, g);
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

    voiceToggle.hidden = mode !== 'voice';
    voiceToggle.textContent = voiceOpen ? '收起語音設定 ▴' : '🗣️ 語音、語速、試聽';
    voiceToggle.setAttribute('aria-expanded', String(voiceOpen));
    voiceBox.hidden = mode !== 'voice' || !voiceOpen;
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
    topbar, timerStrip, codeCard, seatsCard, gameCard, summaryCard, configCard, narrCard, boardCard, startBar);

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
          // #37: a small digit under each die, so the code can be read out without counting pips
          bigCode.replaceChildren(...key.split('').map((ch) => el('div', { class: 'code-cell' },
            dieFace(Number(ch)), el('span', { class: 'code-digit', 'aria-hidden': 'true', text: ch }))));
        }
        if (qrShown) buildQr();
      }

      const mySeats = st.mySeats ?? [];
      localNote.hidden = st.mode !== 'local';
      countPill.textContent = `${headCount(room)} 人`;
      seatEditor.update({
        players: room.players,
        me: st.activeSeat ?? mySeats[0],
        mySeats,
        isHost: st.isHost,
        // turn-order games: the seat order IS the speaking / drawing order (build:avalon)
        orderHint: room.gameId && turnOrderMatters(room.gameId, sh.gameMeta(room.gameId)) ? ORDER_HINT : null,
        onMove: (pid, index) => report(app.lobby.moveSeat(pid, index)),
        onColor: (pid, color) => report(app.lobby.setColor(pid, color)),
        onKick: (pid, node) => {
          const p = room.players.find((x) => x.id === pid);
          if (mySeats.includes(pid)) report(app.lobby.removeSeat(pid));
          // ✕ is an icon: armed, it keeps its face and a toast says 「再㩒一次：踢走 X？」 (#3, never a native confirm)
          else if (sh.confirm(`踢走 ${p?.name ?? ''}？`, node ?? null, { key: `kick:${pid}`, inline: false })) report(app.lobby.kick(pid));
        },
      });

      paintSavedOrder(st);
      paintAway(st);
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
