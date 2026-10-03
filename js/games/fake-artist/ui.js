// ============================================================
// 假畫家 — game UI.   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view any number of
// times. The theme card and the score strip are persistent (the shell's top
// bar already shows 「第 3 輪 · 主題：動物」 from view.title / view.subtitle); the
// body under them is rebuilt only when (phase, round, role, sub-state) changes,
// so a Cover the player is holding down — or a Canvas under a finger — is
// never torn out from beneath them. Phase hints (view.hint) are NOT shown
// here: the shell shows them only behind 💡.
//
// Two drawing modes (view.mode.draw):
//   📱 phone  — the shared Canvas (DESIGN §15.10): tools 'none', one colour per seat, oneStroke,
//               minStrokeLen. After onStrokeEnd the UI sends { type: 'stroke', length } so the
//               engine advances the turn. Everybody watches the line appear live.
//   📝 paper  — no canvas: the app names whose turn it is and the drawer taps 「畫完」.
//
// Typing happens in exactly two places (the question master's theme + word, and the caught
// fake's guess in 打字 mode). Both go through makeInput(): compositionstart/-end are tracked
// and a string that is still being composed is never submitted (iOS Chinese IME).
//
// Only api.components (Cover, PlayerPicker, Timer, VotePanel, Canvas) and plain DOM are used.
// Flow and wording: docs/games/fake-artist.md.
// ============================================================

import * as S from './script.js?v=20261003102525';
import { MIN_STROKE_LEN, checkEntry, penColor, strokeLength, textLen } from './game.js?v=20261003102525';

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'style') n.style.cssText = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

// ---------- colours ----------
//
// Every seat draws with its own pen from game.js PENS (view.pens: distinct, dark enough for the cream sheet).
// penColor (the old "deepen the lobby colour") is only the fallback for a view without pens.

export { penColor };

const DIM_STROKE = '#d9d4c4';      // the strokes of everybody else while one player is highlighted

export function mount(root, api) {
  const { Cover, PlayerPicker, Timer, VotePanel, Canvas } = api.components;
  const nameOf = (pid) => api.players.find((p) => p.id === pid)?.name ?? '?';
  const seatColor = (pid) => api.players.find((p) => p.id === pid)?.color ?? '#f5c518';
  const pen = (pid) => view?.pens?.[pid] ?? penColor(seatColor(pid));
  const noScore = (v) => v?.mode?.scoring === 'none';
  const seatName = (pid, me) => nameOf(pid) + (pid === me ? '（你）' : '');
  const dot = (pid, cls = '') => h('span', { class: `fk-dot ${cls}`.trim(), style: `--seat:${pen(pid)}` });

  let view = null;
  let ctx = {};
  let bodyKey = '';
  let body = null;
  const timers = new Set();    // setTimeout handles owned by the UI

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };
  const cancel = (t) => { if (t != null) { clearTimeout(t); timers.delete(t); } };

  const rerender = () => { if (body && view) body.update(view, ctx); };

  /**
   * Debounce for buttons that send an action: blocks re-taps while the answer is in flight,
   * but lets go after 3.5 s so a dropped message can never lock a player out.
   */
  function sendGuard(onRelease) {
    let on = false;
    return {
      get busy() { return on; },
      fire(send) {
        if (on) return false;
        on = true;
        send();
        later(() => { on = false; onRelease(); }, 3500);
        return true;
      },
    };
  }

  // ---------- persistent chrome ----------

  const themeKicker = h('div', { class: 'fk-theme-kicker', text: '主題' });
  const themeText = h('div', { class: 'fk-theme-text' });
  const themeSub = h('div', { class: 'fk-theme-sub' });
  const themeCard = h('div', { class: 'fk-theme' }, themeKicker, themeText, themeSub);

  const bodyHost = h('div', { class: 'fk-body' });
  const scoreStrip = h('div', { class: 'fk-scores', role: 'list', 'aria-label': '分數' });
  const wrap = h('div', { class: 'fk' }, themeCard, bodyHost, scoreStrip);
  root.replaceChildren(wrap);

  function paintTheme(v) {
    const goal = (v.round.redo ? '重新派過 · ' : '')
      + (noScore(v) ? `共 ${v.round.total} 輪 · 唔計分` : v.mode.endMode === 'target' ? `先到 ${v.mode.target} 分` : `共 ${v.round.total} 輪`);
    if (v.theme == null) {
      themeText.textContent = '？？？';
      themeSub.textContent = `${v.me === v.qm ? '你出題中' : `等 ${nameOf(v.qm)} 出題`} · ${goal}`;
      themeCard.classList.add('empty');
      return;
    }
    themeCard.classList.remove('empty');
    themeText.textContent = v.theme;
    themeSub.textContent = `${v.qm ? `${nameOf(v.qm)} 出題 · ` : ''}${goal}`;
  }

  /** Points (計分) or rounds won (唔計分) per seat. */
  const totals = (v) => (noScore(v) ? (v.wins ?? {}) : v.scores);
  const totalText = (v, pid) => (noScore(v) ? `${totals(v)[pid] ?? 0} 勝` : `${v.scores[pid]} 分`);

  function paintScores(v) {
    const t = totals(v);
    const delta = noScore(v)
      ? new Map((v.reveal?.winners ?? []).map((pid) => [pid, '贏']))
      : new Map((v.reveal?.deltas ?? []).map((d) => [d.pid, S.sc(d.delta)]));
    const best = Math.max(...Object.values(t));
    const chips = api.players
      .filter((p) => p.id in v.scores)
      .map((p) => {
        const d = delta.get(p.id);
        return h('div', {
          class: 'fk-score' + (p.id === v.me ? ' me' : '') + (p.id === v.qm ? ' qm' : '') + (v.phase === 'over' && t[p.id] === best ? ' lead' : ''),
          role: 'listitem', style: `--seat:${pen(p.id)}`,
        },
        h('span', { class: 'fk-score-dot' }),
        h('span', { class: 'fk-score-name', text: (p.id === v.qm ? '🧑‍🎨 ' : '') + p.name }),
        h('span', { class: 'fk-score-n', text: noScore(v) ? `${t[p.id] ?? 0}勝` : String(t[p.id]) }),
        d ? h('span', { class: 'fk-score-d up', text: d }) : null);
      });
    scoreStrip.replaceChildren(...chips);
  }

  // ---------- small shared builders ----------

  /** A hold-to-peek card. The same four lines for every role (anti-tell): role · theme · big word · note. */
  function makeCard(backLabel) {
    const roleEl = h('div', { class: 'fk-face-role' });
    const themeEl = h('div', { class: 'fk-face-theme' });
    const wordEl = h('div', { class: 'fk-face-word' });
    const noteEl = h('div', { class: 'fk-face-note' });
    const front = h('div', { class: 'fk-face' }, roleEl, themeEl, wordEl, noteEl);
    const props = { front, backArt: '🎴', backLabel, lockMode: 'none', locked: false };
    const cover = Cover(props);
    return {
      el: cover.el,
      set(face) {
        if (!face) return;
        roleEl.textContent = face.role;
        themeEl.textContent = `主題：${face.theme}`;
        wordEl.textContent = face.word;
        wordEl.classList.toggle('long', textLen(face.word) > 6);
        wordEl.classList.toggle('x', face.word === '✕');
        noteEl.textContent = face.note;
        cover.update(props);
      },
      close: () => cover.close(),
      destroy: () => cover.destroy(),
    };
  }

  function faceFor(v) {
    const m = v.mine;
    if (!m) return null;
    if (m.role === 'question-master') {
      return { role: '🧑‍🎨 你係出題者', theme: m.theme, word: m.word, note: `假畫家：${nameOf(m.fake)}` };
    }
    if (m.role === 'fake') {
      return { role: '🕶️ 你係假畫家', theme: m.theme, word: '✕', note: '你唔知題目，扮到似識就贏。' };
    }
    return { role: '🎨 你係真畫家', theme: m.theme, word: m.word, note: '畫到真畫家睇得明，但唔好太明顯。' };
  }

  function makeTimer() {
    let t = null;
    const host = h('div', { class: 'fk-timer' });
    return {
      el: host,
      update(v, c, warnAt) {
        if (v.deadline == null || v.phase === 'tally') {
          if (t) { t.destroy(); t = null; }
          host.hidden = true;
          return;
        }
        host.hidden = false;
        const props = { deadline: v.deadline, now: api.now, label: v.timerLabel ?? '', paused: !!c?.paused, warnAt };
        if (!t) { t = Timer(props); host.append(t.el); } else t.update(props);
      },
      destroy() { if (t) t.destroy(); host.remove(); },
    };
  }

  const waitBlock = (emoji, text) => {
    const t = h('p', { class: 'fk-wait-text', text });
    const e = h('div', { class: 'fk-wait' }, h('div', { class: 'fk-wait-emoji', text: emoji }), t);
    return { el: e, set(s) { t.textContent = s; } };
  };

  function waitingBody(textFn, emoji = '🤔') {
    const w = waitBlock(emoji, '');
    return { el: w.el, update(v) { w.set(textFn(v)); }, destroy() {} };
  }

  /** 「已睇 3/6」 with one pip per seat. */
  function progressBlock(label) {
    const text = h('span', { class: 'fk-progress-text' });
    const pips = h('span', { class: 'fk-progress-pips' });
    const el = h('div', { class: 'fk-progress' }, text, pips);
    let key = '';
    return {
      el,
      set(done, total) {
        const k = `${done}/${total}`;
        if (k === key) return;
        key = k;
        text.textContent = `${label} ${done}/${total}`;
        pips.replaceChildren(...Array.from({ length: total }, (_, i) => h('i', { class: i < done ? 'on' : '' })));
      },
    };
  }

  /** A text input that knows when an IME is mid-composition. `value()` is only trustworthy while `composing` is false. */
  function makeInput({ placeholder, label, onChange }) {
    let composing = false;
    const input = h('input', {
      class: 'fk-input', type: 'text', placeholder, 'aria-label': label,
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
    });
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; onChange?.(); });
    input.addEventListener('input', (e) => { if (e.isComposing) composing = true; onChange?.(); });
    return {
      el: input,
      get composing() { return composing; },
      value: () => input.value,
      set(text) { if (!composing) input.value = text; },
      focus: () => input.focus(),
      blur: () => input.blur(),
    };
  }

  /**
   * Wire a submit button so that a string still being composed is never sent. A tap on the button moves focus
   * away from the field, and a browser then COMMITS the half-typed pinyin as plain letters — so the button
   * looks at the composition on pointerdown, before that happens, and refuses the tap that interrupted it.
   * The (now committed) letters stay visible in the field for the player to fix, then tap again.
   */
  function submitWhenCommitted(btn, inputs, go) {
    let interrupted = false;
    btn.addEventListener('pointerdown', () => { interrupted = inputs.some((i) => i.composing); }, true);
    btn.addEventListener('click', () => {
      const was = interrupted || inputs.some((i) => i.composing);
      interrupted = false;
      if (was) { api.sfx('deny'); api.toast('仲輸入緊，揀好字先再㩒'); return; }
      go();
    });
  }

  // ---------- the picture ----------

  /**
   * The shared board. `interactive` = this seat may draw when view.draw.canDraw. Viewers get the same
   * Canvas with no pointer handling. The drawer's accepted stroke is turned into { type: 'stroke', length }.
   */
  function makeBoard({ interactive, compact = false }) {
    const tag = h('div', { class: 'fk-board-tag' });
    const retry = h('button', { class: 'btn btn-ghost btn-sm fk-retry', type: 'button', hidden: true, text: '冇反應？再送一次' });
    const holder = h('div', { class: 'fk-board-holder' });
    const wrapEl = h('div', { class: 'fk-board' + (compact ? ' compact' : '') }, holder, tag, retry);
    let canvas = null;
    let sentTurn = -1;
    let lastLen = 0;
    let baseTurn = -1;
    let baseCount = 0;
    let fallbackAt = null;
    let retryAt = null;

    const mineEnded = (ink, me) => (ink?.strokes ?? []).filter((s) => s.pid === me && s.end).length;

    function sendStroke(length) {
      const v = view;
      if (!v?.draw?.canDraw) return;
      const t = v.draw.turn;
      if (sentTurn === t) return;
      sentTurn = t;
      lastLen = length;
      api.send({ type: 'stroke', length: Math.max(MIN_STROKE_LEN, Math.round(length)) });
      cancel(retryAt);
      retryAt = later(() => {
        retryAt = null;
        if (view?.phase === 'draw' && view.draw?.turn === t && view.draw.canDraw) { retry.hidden = false; }
      }, 3000);
      paintTag();
    }

    retry.addEventListener('click', () => {
      retry.hidden = true;
      sentTurn = -1;
      sendStroke(lastLen || MIN_STROKE_LEN);
    });

    const callbacks = {
      onInk: (payload) => api.ink(payload),
      onStrokeEnd: ({ length }) => { api.sfx('lock'); sendStroke(length); },
      onShort: () => { api.sfx('deny'); api.toast('一筆太短喇，再畫過'); },
    };

    function paintTag() {
      const v = view;
      const d = v?.draw;
      if (!interactive || !d || v.phase !== 'draw' || !d.canDraw) { tag.hidden = true; return; }
      tag.hidden = false;
      if (sentTurn === d.turn) tag.replaceChildren('✓ 畫完喇，等緊…');
      else tag.replaceChildren(dot(v.me), ' 一筆過畫完，放手就算一筆');
    }

    function fallback(v, c) {
      const d = v.draw;
      if (!d?.canDraw) { baseTurn = -1; retry.hidden = true; return; }
      const count = mineEnded(c.ink, v.me);
      if (baseTurn !== d.turn) { baseTurn = d.turn; baseCount = count; retry.hidden = true; return; }
      if (sentTurn === d.turn || count <= baseCount || fallbackAt != null) return;
      // The Canvas finished a stroke but its callback never reached us: send it from the ink after a beat.
      const t = d.turn;
      fallbackAt = later(() => {
        fallbackAt = null;
        if (!view?.draw?.canDraw || view.draw.turn !== t || sentTurn === t) return;
        const mine = (ctx.ink?.strokes ?? []).filter((s) => s.pid === view.me && s.end);
        const len = strokeLength(mine[mine.length - 1]?.pts ?? []);
        if (len >= MIN_STROKE_LEN) sendStroke(len);
      }, 900);
    }

    return {
      el: wrapEl,
      /** `over` = { ink, colorOf } to show something other than the live picture (result: replay, highlight). */
      update(v, c, over) {
        const d = v.draw;
        const props = {
          ink: over?.ink ?? c.ink ?? { epoch: 0, strokes: [] },
          canDraw: interactive && !!d?.canDraw,
          tools: 'none',
          color: pen(v.me),
          me: v.me ?? undefined,
          oneStroke: true,
          minStrokeLen: d?.minLen ?? MIN_STROKE_LEN,
          colorOf: pen,
          ...callbacks,
        };
        if (!canvas) { canvas = Canvas(props); holder.replaceChildren(canvas.el); } else canvas.update(props);
        paintTag();
        if (interactive) fallback(v, c);
      },
      destroy() {
        cancel(fallbackAt);
        cancel(retryAt);
        canvas?.destroy();
        wrapEl.remove();
      },
    };
  }

  // ---------- bodies ----------

  /** qm-input: the question master types a theme and a word (or rolls one from the bank). */
  function qmInputBody(role) {
    if (role !== 'qm') return waitingBody((x) => `等 ${nameOf(x.qm)} 出題…`, '🧑‍🎨');
    const guard = sendGuard(rerender);
    let lastSeq = 0;
    const err = h('p', { class: 'fk-err' });
    const refresh = () => { err.textContent = ''; goBtn.disabled = !(themeIn.value().trim() && wordIn.value().trim()) || guard.busy; };
    const themeIn = makeInput({ placeholder: '主題（例如：動物）', label: '主題', onChange: refresh });
    const wordIn = makeInput({ placeholder: '題目（例如：大象）', label: '題目', onChange: refresh });
    const diceBtn = h('button', { class: 'btn btn-ghost', type: 'button', text: '🎲 由詞庫抽一個' });
    const goBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: '出題', disabled: true });
    diceBtn.addEventListener('click', () => { api.sfx('deal'); api.send({ type: 'qm-random' }); });
    submitWhenCommitted(goBtn, [themeIn, wordIn], () => {
      const c = checkEntry(themeIn.value(), wordIn.value());
      if (!c.ok) { err.textContent = c.message; api.sfx('deny'); return; }
      guard.fire(() => { goBtn.disabled = true; api.sfx('deal'); api.send({ type: 'qm-set', theme: c.theme, word: c.word }); });
    });
    const el = h('div', { class: 'fk-stack' },
      h('h2', { class: 'fk-h', text: '你係出題者' }),
      h('p', { class: 'fk-note', text: '主題大家都睇到；題目淨係真畫家知。主題唔可以包住題目。' }),
      h('label', { class: 'fk-field' }, h('span', { text: '主題（公開）' }), themeIn.el),
      h('label', { class: 'fk-field' }, h('span', { text: '題目（秘密）' }), wordIn.el),
      err, diceBtn, goBtn);
    return {
      el,
      update(v) {
        if (v.draft && v.draft.seq !== lastSeq) {
          lastSeq = v.draft.seq;
          themeIn.set(v.draft.theme);
          wordIn.set(v.draft.word);
        }
        refresh();
      },
      destroy() {},
    };
  }

  /** deal: everybody looks at their card (same shape for every role), then taps 睇完喇. */
  function dealBody(role) {
    const card = role !== 'table' ? makeCard('㩒住睇你嘅題目') : null;
    const prog = progressBlock('已睇');
    const guard = sendGuard(rerender);
    const btn = role === 'artist' ? h('button', { class: 'btn btn-primary btn-lg', type: 'button' }) : null;
    btn?.addEventListener('click', () => guard.fire(() => { btn.disabled = true; api.sfx('tap'); api.send({ type: 'ready' }); }));
    const note = h('p', { class: 'fk-note' });
    const el = h('div', { class: 'fk-stack' },
      h('h2', { class: 'fk-h', text: '睇你張卡' }),
      card?.el, btn, prog.el, note);
    return {
      el,
      update(v) {
        card?.set(faceFor(v));
        prog.set(v.ready.done, v.ready.total);
        if (btn) {
          btn.textContent = v.ready.mine ? '✓ 睇完喇 · 等緊其他人' : '睇完喇';
          btn.disabled = v.ready.mine || guard.busy;
        }
        note.textContent = role === 'qm' ? '你知題目同假畫家係邊個。等大家睇完卡，就開始畫。'
          : role === 'table' ? '大家睇緊自己張卡…'
            : v.ready.mine ? '之後都可以隨時㩒住張卡再睇。' : '㩒住張卡睇，放手就冚返。睇卡嗰陣唔好露出表情。';
      },
      destroy() { card?.destroy(); },
    };
  }

  /** first: the question master picks who draws first (clockwise from there). */
  function firstBody(role) {
    if (role !== 'qm') return waitingBody((x) => `等 ${nameOf(x.qm)} 揀邊個先畫…`, '👆');
    const guard = sendGuard(rerender);
    let sel = [];
    const picker = PlayerPicker({ players: [], me: null, count: 1, exclude: [], selected: [], disabled: false });
    const paint = (v) => picker.update({
      players: api.players.filter((p) => v.first.candidates.includes(p.id)),
      me: v.me, count: 1, exclude: [], selected: sel, disabled: guard.busy,
      onChange(s) { sel = s; },
      confirmLabel: '呢個先畫',
      onConfirm(s) {
        if (!s.length) return;
        guard.fire(() => api.send({ type: 'first', target: s[0] }));
        paint(v);
      },
    });
    const el = h('div', { class: 'fk-stack' },
      h('h2', { class: 'fk-h', text: '邊個先畫？' }),
      h('p', { class: 'fk-note', text: '之後順時針輪流。' }), picker.el);
    return { el, update(v) { paint(v); }, destroy() { picker.destroy(); } };
  }

  /** The row of artists in drawing order, with their stroke dots. */
  function orderChips() {
    const el = h('div', { class: 'fk-order', 'aria-label': '畫畫次序' });
    let key = '';
    return {
      el,
      update(v) {
        const d = v.draw;
        const k = JSON.stringify([d.order, d.current, d.counts, d.laps, v.me]);
        if (k === key) return;
        key = k;
        el.replaceChildren(...d.order.map((pid, i) => {
          const done = d.counts[pid] ?? 0;
          return h('div', { class: 'fk-order-chip' + (pid === d.current ? ' now' : '') + (pid === v.me ? ' me' : ''), style: `--seat:${pen(pid)}` },
            h('span', { class: 'fk-order-n', text: String(i + 1) }),
            dot(pid),
            h('span', { class: 'fk-order-name', text: nameOf(pid) }),
            h('span', { class: 'fk-order-strokes', text: '●'.repeat(done) + '○'.repeat(Math.max(0, d.laps - done)) }));
        }));
      },
    };
  }

  /** draw: whose turn, how many laps are left, the canvas (phone) or the 畫完 button (paper). */
  function drawBody(role) {
    const paper = view.mode.draw === 'paper';
    const head = h('div', { class: 'fk-turn' });
    const sub = h('div', { class: 'fk-turn-sub' });
    const board = paper ? null : makeBoard({ interactive: true });
    const order = orderChips();
    const timer = makeTimer();
    const guard = sendGuard(rerender);
    const doneBtn = paper ? h('button', { class: 'btn btn-primary btn-lg', type: 'button' }) : null;
    doneBtn?.addEventListener('click', () => {
      guard.fire(() => { doneBtn.disabled = true; api.sfx('lock'); api.send({ type: 'done' }); });
    });
    const note = h('p', { class: 'fk-note' });
    const card = role !== 'table' ? makeCard('㩒住睇返我張卡') : null;
    const el = h('div', { class: 'fk-stack' }, head, sub, timer.el, board?.el, doneBtn, note, order.el, card?.el);
    return {
      el,
      update(v, c) {
        const d = v.draw;
        const mine = d.current === v.me;
        head.replaceChildren(mine
          ? h('span', {}, dot(d.current, 'lg'), ' 輪到你畫！')
          : h('span', {}, '輪到 ', dot(d.current, 'lg'), ` ${nameOf(d.current)} 畫`));
        head.classList.toggle('mine', mine);
        sub.textContent = `第 ${d.lap}/${d.laps} 圈 · 第 ${Math.min(d.turn + 1, d.total)}/${d.total} 筆`;
        board?.update(v, c);
        order.update(v);
        timer.update(v, c, [10]);
        if (doneBtn) {
          doneBtn.hidden = !d.canDone;
          doneBtn.textContent = mine ? '畫完' : `${nameOf(d.current)} 畫完喇（幫佢㩒）`;
          doneBtn.disabled = guard.busy;
        }
        note.textContent = paper
          ? (mine ? '喺紙上用自己嘅筆一筆過畫完（筆唔好離開紙），畫完就㩒「畫完」。' : `等 ${nameOf(d.current)} 喺紙上畫一筆。`)
          : (mine ? '' : role === 'qm' ? '你唔使畫，睇住大家畫。' : '');
        note.hidden = !note.textContent;
        card?.set(faceFor(v));
      },
      destroy() { board?.destroy(); timer.destroy(); card?.destroy(); },
    };
  }

  /** vote / revote: look at the picture, pick the fake, lock it in. */
  function voteBody(role, sub) {
    const phone = view.mode.draw === 'phone';
    const board = phone ? makeBoard({ interactive: false, compact: true }) : null;
    const paperNote = !phone ? h('p', { class: 'fk-note', text: '望住張紙，諗吓邊個畫得唔似。' }) : null;
    const guard = sendGuard(rerender);
    const panel = sub === 'voter'
      ? VotePanel({ players: [], candidates: [], me: view.me, allowAbstain: false, allowChange: false, onVote() {} })
      : null;
    const wait = sub !== 'voter' ? waitBlock(role === 'qm' ? '🤫' : '🗳️', '') : null;
    const prog = progressBlock('已投');
    const card = role !== 'table' ? makeCard('㩒住睇返我張卡') : null;
    let panelKey = '';
    const el = h('div', { class: 'fk-stack' },
      h('h2', { class: 'fk-h' }), board?.el, paperNote, panel?.el, wait?.el, prog.el, card?.el);
    const heading = el.firstChild;
    return {
      el,
      update(v, c) {
        const vt = v.vote;
        const second = vt.round === 2;
        heading.textContent = second ? '平票！再投一次' : '邊個係假畫家？';
        board?.update(v, c);
        prog.set(vt.done, vt.total);
        if (panel) {
          const props = {
            players: api.players, candidates: vt.candidates.filter((id) => id !== v.me), me: v.me,
            myVote: vt.myVote, allowAbstain: false, allowChange: false,
            progress: { done: vt.done, total: vt.total },
            title: second ? '只可以喺平票嘅人入面揀' : '揀你覺得係假畫家嘅人',
            onVote(target) { guard.fire(() => api.send({ type: 'vote', target })); },
          };
          const k = JSON.stringify([props.candidates, props.myVote ?? '-', props.progress, props.title]);
          if (k !== panelKey) { panelKey = k; panel.update(props); }
          prog.el.hidden = true;
        }
        wait?.set(role === 'qm'
          ? '你知邊個係假畫家，靜靜哋等大家投票。'
          : second && !vt.voters.length ? '等緊…'
            : second ? '平票嘅人唔使再投，等其他人揀。'
              : '大家揀緊邊個係假畫家…');
        card?.set(faceFor(v));
      },
      destroy() { board?.destroy(); panel?.destroy(); card?.destroy(); },
    };
  }

  /** tally: the simultaneous reveal, then the verdict. Lingers a few seconds (the engine moves on by itself). */
  function tallyBody() {
    const verdict = h('div', { class: 'fk-verdict' });
    const bar = h('div', { class: 'fk-linger' }, h('i'));
    const panel = VotePanel({ players: [], candidates: [], me: null, onVote() {} });
    const note = h('p', { class: 'fk-note' });
    const el = h('div', { class: 'fk-stack fk-tally' }, h('h2', { class: 'fk-h' }), panel.el, verdict, note, bar);
    const heading = el.firstChild;
    let key = '';
    later(() => api.sfx('reveal'), 250);
    return {
      el,
      update(v) {
        const t = v.tally;
        const r = t.round2 ?? t.round1;
        const second = !!t.round2;
        heading.textContent = second ? '再投結果' : '投票結果';
        const k = JSON.stringify([r, second]);
        if (k !== key) {
          key = k;
          const ids = second ? t.round1.top : v.artists;
          panel.update({ players: api.players, candidates: ids, me: v.me, reveal: { counts: r.counts, top: r.top, votes: r.votes } });
        }
        verdict.classList.toggle('caught', t.caught === true);
        verdict.classList.toggle('escaped', t.caught === false);
        verdict.classList.toggle('revote', t.revote === true);
        if (t.revote) verdict.textContent = '⚖️ 平票！冇被指嘅人再投一次';
        else if (t.caught) verdict.textContent = `🎯 揪到假畫家：${nameOf(v.fake)}！`;
        else verdict.textContent = r.top.length ? '😏 假畫家逃過一劫…' : '🤷 冇人投票，假畫家逃過一劫…';
        const tied = r.top.length > 1;
        note.textContent = !tied ? ''
          : t.tieRule === 'must-guess' && t.caught ? '平票，但假畫家喺最高票入面，所以算揪到。'
            : t.tieRule === 'escape' ? '舊版規則：平票一律當冇揪到。' : '';
        note.hidden = !note.textContent;
      },
      destroy() { panel.destroy(); },
    };
  }

  /** guess / judge: the caught fake's one guess, and who rules on it. */
  function guessBody(role, sub) {
    const banner = h('div', { class: 'fk-verdict caught' });
    const board = view.mode.draw === 'phone' ? makeBoard({ interactive: false, compact: true }) : null;
    const guard = sendGuard(rerender);
    const wrapEl = h('div', { class: 'fk-stack' }, h('h2', { class: 'fk-h', text: '估題目' }), banner);
    const parts = { destroy: [] };
    let paint = () => {};

    if (sub === 'guess') {                                   // I am the fake, typed mode
      const input = makeInput({ placeholder: '你估條題目係咩', label: '你估嘅題目', onChange: () => { sendBtn.disabled = guard.busy || !input.value().trim(); } });
      const sendBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: '就係呢個！', disabled: true });
      const unsure = h('button', { class: 'btn btn-ghost', type: 'button', text: '我唔知' });
      const submit = (text) => guard.fire(() => { sendBtn.disabled = true; unsure.disabled = true; api.sfx('lock'); api.send({ type: 'guess', text }); });
      submitWhenCommitted(sendBtn, [input], () => {
        const text = input.value().trim();
        if (text) submit(text);
      });
      unsure.addEventListener('click', () => submit(''));
      wrapEl.append(h('p', { class: 'fk-note', text: '你只有一次機會。同詞庫答案一樣就自動啱；唔一樣就由判斷嗰個人決定。' }),
        h('label', { class: 'fk-field' }, h('span', { text: '你估嘅題目' }), input.el), sendBtn, unsure);
      paint = () => { unsure.disabled = guard.busy; };
    } else if (sub === 'judge') {                            // I rule on it
      const wordEl = h('div', { class: 'fk-judge-word' });
      const saidEl = h('p', { class: 'fk-note' });
      let armed = null;
      let handle = null;
      const mk = (correct, label, cls) => {
        const b = h('button', { class: `btn btn-lg ${cls}`, type: 'button', text: label });
        b.addEventListener('click', () => {
          if (armed === correct) {
            armed = null;
            cancel(handle);
            guard.fire(() => { api.sfx('lock'); api.send({ type: 'verdict', correct }); });
            return;
          }
          armed = correct;
          api.sfx('tap');
          paintBtns();
          cancel(handle);
          handle = later(() => { armed = null; paintBtns(); }, 3000);
        });
        return b;
      };
      const yes = mk(true, '✅ 啱', 'btn-primary');
      const no = mk(false, '❌ 錯', 'btn-danger');
      const paintBtns = () => {
        yes.textContent = armed === true ? '確定「啱」？再㩒一下' : '✅ 啱';
        no.textContent = armed === false ? '確定「錯」？再㩒一下' : '❌ 錯';
        yes.disabled = no.disabled = guard.busy;
        yes.classList.toggle('armed', armed === true);
        no.classList.toggle('armed', armed === false);
      };
      wrapEl.append(h('p', { class: 'fk-note', text: '你係判斷嗰個人：只有你睇到答案。' }),
        h('div', { class: 'fk-judge' }, h('div', { class: 'fk-judge-label', text: '答案係' }), wordEl), saidEl,
        h('div', { class: 'fk-judgebtns' }, yes, no));
      paint = (v) => {
        wordEl.textContent = v.guess?.word ?? '';
        saidEl.textContent = v.guess?.text ? `${nameOf(v.fake)} 估：「${v.guess.text}」（同答案唔完全一樣，你決定算唔算）` : `等 ${nameOf(v.fake)} 大聲講出佢估嘅題目，再㩒啱或者錯。`;
        paintBtns();
      };
      parts.destroy.push(() => cancel(handle));
    } else {
      const w = waitBlock(sub === 'fake' ? '🎤' : '🤔', '');
      wrapEl.append(w.el);
      paint = (v) => {
        const typed = v.guess?.mode === 'typed';
        if (sub === 'fake') w.set(`你被揪出喇。${typed ? '' : '大聲講出你估嘅題目，等判斷嗰個人㩒啱或者錯。'}`);
        else if (v.guess?.text) w.set(`${nameOf(v.fake)} 估：「${v.guess.text}」，等 ${nameOf(v.guess.judge)} 判斷…`);
        else w.set(typed ? `${nameOf(v.fake)} 打緊佢估嘅題目…` : `${nameOf(v.fake)} 大聲講緊佢估嘅題目，等 ${nameOf(v.guess.judge)} 判斷…`);
      };
    }

    if (board) wrapEl.append(board.el);                      // the action comes first: the picture is for the fake to look at
    return {
      el: wrapEl,
      update(v, c) {
        banner.textContent = `🕶️ ${nameOf(v.fake)} 係假畫家！有一次機會估題目`;
        board?.update(v, c);
        paint(v);
      },
      destroy() { board?.destroy(); for (const f of parts.destroy) f(); },
    };
  }

  /** result: the whole picture with every stroke's owner, the word, the fake, and why points moved. */
  function resultBody(role) {
    const phone = view.mode.draw === 'phone';
    const head = h('div', { class: 'fk-result-head' });
    const facts = h('div', { class: 'fk-facts' });
    const board = phone ? makeBoard({ interactive: false }) : null;
    const legend = h('div', { class: 'fk-legend' });
    const replayBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '▶ 重播' });
    const turnsEl = !phone ? h('div', { class: 'fk-turns' }) : null;
    const lines = h('div', { class: 'fk-reveal-lines' });
    const pts = h('div', { class: 'fk-deltas' });
    const guard = sendGuard(rerender);
    const nextBtn = role !== 'table' ? h('button', { class: 'btn btn-primary btn-lg', type: 'button', disabled: true }) : null;
    const waitTxt = role === 'table' ? h('p', { class: 'fk-note', text: '睇緊結果…' }) : null;

    let hl = null;                   // pid highlighted in the legend
    let replayK = null;              // null = the full picture, n = the first n strokes
    let replayTimer = null;
    let legendKey = '';
    let unlocked = false;

    later(() => api.sfx('reveal'), 600);
    later(() => { unlocked = true; rerender(); }, 2500);       // a stray tap from the previous screen must not skip the result

    const inkFor = (c, artists) => {
      const base = c.ink ?? { epoch: 0, strokes: [] };
      const all = base.strokes.filter((s) => !s.eraser);
      const shown = replayK == null ? all : all.slice(0, replayK);
      const hlIdx = hl ? artists.indexOf(hl) + 1 : 0;
      return {
        epoch: (base.epoch ?? 0) * 1000 + hlIdx,                 // a new epoch makes the Canvas repaint in the new colours
        strokes: shown.map((s) => (hl && s.pid !== hl ? { ...s, color: DIM_STROKE } : s)),
      };
    };

    function stepReplay(total) {
      if (replayK == null) return;
      replayK += 1;
      if (replayK > total) { replayK = null; replayTimer = null; replayBtn.textContent = '▶ 重播'; rerender(); return; }
      rerender();
      replayTimer = later(() => stepReplay(total), 480);
    }
    replayBtn.addEventListener('click', () => {
      cancel(replayTimer);
      replayTimer = null;
      if (replayK != null) { replayK = null; replayBtn.textContent = '▶ 重播'; rerender(); return; }
      const total = (ctx.ink?.strokes ?? []).filter((s) => !s.eraser).length;
      if (!total) return;
      replayK = 0;
      replayBtn.textContent = '⏹ 停';
      rerender();
      replayTimer = later(() => stepReplay(total), 350);
    });

    nextBtn?.addEventListener('click', () => guard.fire(() => { nextBtn.disabled = true; api.send({ type: 'next' }); }));

    const el = h('div', { class: 'fk-stack fk-result' },
      head, facts, phone ? h('div', { class: 'fk-legend-row' }, legend, replayBtn) : null, board?.el,
      turnsEl, lines, pts, nextBtn ?? waitTxt);

    return {
      el,
      update(v, c) {
        const rv = v.reveal;
        if (!rv) return;
        head.textContent = rv.lines[0];
        head.classList.toggle('fake', rv.fakeSide);
        facts.replaceChildren(...[
          h('div', { class: 'fk-fact big' }, h('span', { class: 'fk-fact-label', text: '題目' }), h('strong', { text: rv.word })),
          h('div', { class: 'fk-fact' }, h('span', { class: 'fk-fact-label', text: '假畫家' }), dot(rv.fake), h('strong', { text: nameOf(rv.fake) })),
          rv.qm ? h('div', { class: 'fk-fact' }, h('span', { class: 'fk-fact-label', text: '出題者' }), dot(rv.qm), h('strong', { text: nameOf(rv.qm) })) : null,
        ].filter(Boolean));

        const artists = v.artists;
        if (board) board.update(v, c, { ink: inkFor(c, artists) });
        const lk = JSON.stringify([artists, hl, rv.fake]);
        if (lk !== legendKey) {
          legendKey = lk;
          legend.replaceChildren(...artists.map((pid) => {
            const b = h('button', { class: 'fk-legend-chip' + (hl === pid ? ' on' : ''), type: 'button', style: `--seat:${pen(pid)}`, 'aria-pressed': hl === pid ? 'true' : 'false' },
              dot(pid), h('span', { text: nameOf(pid) + (pid === rv.fake ? ' 🕶️' : '') }));
            b.addEventListener('click', () => { api.sfx('tap'); hl = hl === pid ? null : pid; rerender(); });
            return b;
          }));
        }
        if (turnsEl) {
          const laps = [];
          for (const t of rv.turns) (laps[t.lap - 1] ||= []).push(t);
          turnsEl.replaceChildren(h('div', { class: 'fk-turns-title', text: '畫畫次序' }),
            ...laps.map((list, i) => h('div', { class: 'fk-turns-lap' },
              h('span', { class: 'fk-turns-lapn', text: `第 ${i + 1} 圈` }),
              ...list.map((t) => h('span', { class: 'fk-turns-chip' + (t.kind === 'forfeit' ? ' skipped' : ''), style: `--seat:${pen(t.pid)}` },
                dot(t.pid), nameOf(t.pid) + (t.kind === 'forfeit' ? '（放棄）' : ''))))));
        }
        lines.replaceChildren(...rv.lines.slice(2).map((l) => h('div', { class: 'fk-reveal-line', text: l })));
        pts.replaceChildren(...v.artists.concat(v.qm ? [v.qm] : []).map((pid) => {
          const pts1 = rv.deltas.find((x) => x.pid === pid)?.delta ?? 0;
          const d = noScore(v) ? ((rv.winners ?? []).includes(pid) ? '贏' : '') : (pts1 ? S.sc(pts1) : '');
          return h('div', { class: 'fk-delta' + (d ? ' up' : ''), style: `--seat:${pen(pid)}` },
            dot(pid), h('span', { class: 'fk-delta-name', text: seatName(pid, v.me) }),
            h('span', { class: 'fk-delta-d', text: d || '·' }),
            h('span', { class: 'fk-delta-t', text: totalText(v, pid) }));
        }));
        if (nextBtn) {
          nextBtn.textContent = v.last ? '睇總結' : '下一輪';
          nextBtn.disabled = !unlocked || guard.busy;
        }
      },
      destroy() { cancel(replayTimer); board?.destroy(); },
    };
  }

  function overBody() {
    const list = h('div', { class: 'fk-final' });
    const el = h('div', { class: 'fk-stack' }, h('h2', { class: 'fk-h', text: '遊戲完' }), list);
    return {
      el,
      update(v) {
        const t = totals(v);
        const top = Math.max(...Object.values(t));
        const rows = api.players.filter((p) => p.id in v.scores).sort((a, b) => (t[b.id] ?? 0) - (t[a.id] ?? 0));
        list.replaceChildren(...rows.map((p) => h('div', { class: 'fk-final-row' + (t[p.id] === top ? ' lead' : '') },
          h('span', { text: (t[p.id] === top ? '🏆 ' : '') + p.name }),
          h('span', { class: 'fk-final-n', text: totalText(v, p.id) }))));
      },
      destroy() {},
    };
  }

  /** Which part of a phase this seat is in (the body is rebuilt when it changes). */
  function subOf(v, role) {
    if (v.phase === 'draw') return v.mode.draw;
    if (v.phase === 'vote' || v.phase === 'revote') return v.vote?.voters.includes(v.me) ? 'voter' : 'watch';
    if (v.phase === 'guess' || v.phase === 'judge') {
      if (v.guess?.canGuess) return 'guess';
      if (v.guess?.canJudge) return 'judge';
      return v.me && v.me === v.fake ? 'fake' : 'watch';
    }
    return role;
  }

  function makeBody(v, role, sub) {
    switch (v.phase) {
      case 'qm-input': return qmInputBody(role);
      case 'deal': return dealBody(role);
      case 'first': return firstBody(role);
      case 'draw': return drawBody(role);
      case 'vote': case 'revote': return voteBody(role, sub);
      case 'tally': return tallyBody();
      case 'guess': case 'judge': return guessBody(role, sub);
      case 'result': return resultBody(role);
      default: return overBody();
    }
  }

  // ---------- update / destroy ----------

  return {
    update(nextView, nextCtx) {
      view = nextView;
      ctx = nextCtx ?? {};
      if (!view) return;
      paintTheme(view);
      paintScores(view);

      const role = view.me === null ? 'table' : view.me === view.qm ? 'qm' : 'artist';
      const sub = subOf(view, role);
      const key = `${view.phase === 'revote' ? 'vote' : view.phase === 'judge' ? 'guess' : view.phase}|${view.round.key ?? view.round.n}|${role}|${sub}`;
      if (key !== bodyKey) {
        body?.destroy();
        body = makeBody(view, role, sub);
        bodyHost.replaceChildren(body.el);
        bodyKey = key;
      }
      body.update(view, ctx);
    },
    destroy() {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      body?.destroy();
      body = null;
      root.replaceChildren();
    },
  };
}
