// ============================================================
// 瞎掰王 9upper — game UI.   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view any number of
// times. The term card and the score strip are persistent (the shell's top bar
// already shows 「第 3/12 輪 · 阿明 做諗樣」 from view.title / view.subtitle); the
// body under them is rebuilt only when (phase, round, role — and in the
// pass-the-phone read, whose turn it is) changes, so a Cover the player is
// holding down is never torn out from under their finger. Phase hints
// (view.hint) are NOT shown here: the shell shows them only behind 💡.
//
// Only api.components (Cover, PlayerPicker, Timer) and plain DOM are used.
// Flow and wording: docs/games/9upper.md.
// ============================================================

import * as S from './script.js?v=1';

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

const LEVELS = [
  { level: 1, name: '簡單', pts: 1, sub: '提示：話你知屬於邊一類' },
  { level: 2, name: '中等', pts: 2, sub: '提示：三個類別揀一個（得一個啱）' },
  { level: 3, name: '困難', pts: 3, sub: '冇提示，作起嚟最辣' },
];

export function mount(root, api) {
  const { Cover, PlayerPicker, Timer } = api.components;
  const nameOf = (pid) => api.players.find((p) => p.id === pid)?.name ?? '?';
  const colorOf = (pid) => api.players.find((p) => p.id === pid)?.color ?? 'var(--cheese, #f5c518)';
  const seatName = (pid, me) => nameOf(pid) + (pid === me ? '（你）' : '');
  // the round as this UI remembers it: a 呢輪作廢 redeal keeps the number but gets a new key
  const roundKey = (v) => String(v.round.key ?? v.round.n);
  const away = (v, pid) => (v.absent ?? []).includes(pid);

  let view = null;
  let ctx = {};
  let bodyKey = '';
  let body = null;
  let callSeen = null;       // { round, count } — so a new 收皮啦 sounds once, not on every update
  let termSeen = null;       // { round, text } — so a 換題 is announced on every phone, once
  // `${round}|${seat}` → did this seat open its card during its read window? Set when this phone watched the window;
  // missing (a reload after it) means "don't know", and the card then says what it always said.
  const readLog = new Map();
  const timers = new Set();  // setTimeout handles owned by the UI

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };

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

  const termKicker = h('div', { class: 'g9-term-kicker' });
  const termText = h('div', { class: 'g9-term-text' });
  const termHint = h('div', { class: 'g9-term-hint' });
  const swapNote = h('div', { class: 'g9-term-swap', role: 'status' });
  swapNote.hidden = true;
  let swapHandle = null;
  const termCard = h('div', { class: 'g9-term' }, termKicker, termText, termHint, swapNote);

  const bodyHost = h('div', { class: 'g9-body' });
  const scoreStrip = h('div', { class: 'g9-scores', role: 'list', 'aria-label': '分數' });
  const wrap = h('div', { class: 'g9' }, termCard, bodyHost, scoreStrip);
  root.replaceChildren(wrap);

  function paintTerm(v) {
    if (!v.term) {
      termKicker.textContent = '題目';
      termText.textContent = '？？？';
      termHint.textContent = `等 ${nameOf(v.judge)} 揀難度`;
      termCard.classList.add('empty');
      return;
    }
    termCard.classList.remove('empty');
    const L = LEVELS[v.term.level - 1];
    termKicker.textContent = `題目 · ${S.stars(v.term.level)} ${L.name} · ${L.pts} 分`;
    termText.textContent = v.term.text;
    termHint.textContent = S.hintText(v.term.hint);
    // 換題: the term just changes under everybody's eyes, so say so on every phone (silent play has no cue)
    if (v.phase === 'term' && termSeen?.round === roundKey(v) && termSeen.text !== v.term.text) {
      swapNote.textContent = v.swapsLeft > 0 ? `🔄 換咗題（仲可以換 ${v.swapsLeft} 次）` : '🔄 換咗題（唔可以再換）';
      swapNote.hidden = false;
      clearTimeout(swapHandle);
      swapHandle = later(() => { swapNote.hidden = true; }, 4000);
    }
    if (v.phase !== 'term') swapNote.hidden = true;
    termSeen = { round: roundKey(v), text: v.term.text };
  }

  function paintScores(v) {
    const delta = new Map((v.reveal?.changes ?? []).map((c) => [c.pid, c.delta]));
    const best = Math.max(...Object.values(v.scores));
    const chips = api.players
      .filter((p) => p.id in v.scores)
      .map((p) => {
        const d = delta.get(p.id);
        return h('div', {
          class: 'g9-score' + (p.id === v.me ? ' me' : '') + (p.id === v.judge ? ' judge' : '')
            + (v.phase === 'over' && v.scores[p.id] === best ? ' lead' : ''),
          role: 'listitem',
          style: `--seat:${p.color ?? '#f5c518'}`,
        },
        h('span', { class: 'g9-score-dot' }),
        h('span', { class: 'g9-score-name', text: (p.id === v.judge ? '🧠 ' : '') + p.name + (away(v, p.id) ? ' 💤' : '') }),
        h('span', { class: 'g9-score-n', text: String(v.scores[p.id]) }),
        d ? h('span', { class: 'g9-score-d ' + (d > 0 ? 'up' : 'down'), text: S.sc(d) }) : null);
      });
    scoreStrip.replaceChildren(...chips);
  }

  // ---------- small shared builders ----------

  /**
   * A hold-to-peek card. `set(face)` repaints it; the Cover keeps the same front node. Every role's card has the same
   * three lines, the same font and a text box of the same height (#16), so its shape says nothing.
   */
  function makeCard(backLabel, onOpen = null) {
    const roleEl = h('div', { class: 'g9-face-role' });
    const textEl = h('div', { class: 'g9-face-text' });
    const noteEl = h('div', { class: 'g9-face-note' });
    const front = h('div', { class: 'g9-face' }, roleEl, textEl, noteEl);
    const props = { front, backArt: '🃏', backLabel, lockMode: 'none', locked: false, onOpen: onOpen ?? undefined };
    const cover = Cover(props);
    return {
      el: cover.el,
      set(face) {
        roleEl.textContent = face.role;
        textEl.textContent = face.text;
        noteEl.textContent = face.note;
        cover.update(props);
      },
      close: () => cover.close(),
      destroy: () => cover.destroy(),
    };
  }

  /**
   * What is written on my card. Same three-line shape for every role (see §3.6 anti-tell). Whenever the 老實人's card
   * can hold the real explanation (the read window; later too with rePeek), the 諗樣's and the 9uppers' cards hold a
   * block of about the same length (S.judgeDecoy / S.bluffDecoy) — never a single short line.
   */
  function faceFor(v) {
    const key = `${roundKey(v)}|${v.me}`;
    const full = v.phase === 'read' || (!!v.rePeek && (v.phase === 'explain' || v.phase === 'judge'));
    if (v.me === v.judge) {
      return { role: '你係諗樣 🧠', text: S.judgeDecoy(key), note: '等佢哋睇完，就逐個解釋俾你聽。' };
    }
    if (v.mine?.honest) {
      if (v.mine.explain) return { role: '你係老實人 🙋', text: v.mine.explain, note: '用自己嘅講法講，唔好照讀。' };
      // this phone watched the whole window and the card was never opened: do not pretend it was read
      if (readLog.get(key) === false) {
        return { role: '你係老實人 🙋', text: '你冇打開到張卡，問到就答「張卡冇寫」。', note: '唔好話俾人知你冇睇到。' };
      }
      return { role: '你係老實人 🙋', text: '你睇過真正解釋喇，用自己嘅講法講。', note: '唔記得嘅細節可以話「張卡冇寫」。' };
    }
    return full
      ? { role: '你係 9upper 🤥', text: S.bluffDecoy(v.term, key), note: '你睇唔到真正解釋，靠你把口。' }
      : { role: '你係 9upper 🤥', text: '作一個解釋，要講得似真㗎！', note: '你睇唔到真正解釋，靠你把口。' };
  }

  function makeTimer() {
    let t = null;
    const host = h('div', { class: 'g9-timer' });
    return {
      el: host,
      update(v, c, warnAt) {
        if (v.deadline == null) {
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

  /** A button that needs a second tap within 3 s. */
  function confirmButton({ cls, label, armedLabel, onConfirm }) {
    let armed = false;
    let handle = null;
    const btn = h('button', { class: cls, type: 'button' });
    const paint = () => { btn.textContent = armed ? armedLabel : label(); btn.classList.toggle('armed', armed); };
    btn.addEventListener('click', () => {
      if (armed) { armed = false; clearTimeout(handle); paint(); onConfirm(); return; }
      armed = true;
      paint();
      handle = later(() => { armed = false; paint(); }, 3000);
    });
    return { el: btn, paint, destroy() { clearTimeout(handle); btn.remove(); } };
  }

  const waitBlock = (emoji, text) => {
    const t = h('p', { class: 'g9-wait-text' });
    const el = h('div', { class: 'g9-wait' }, h('div', { class: 'g9-wait-emoji', text: emoji }), t);
    return { el, set(s) { t.textContent = s; } };
  };

  /** 🛑 banner of played 收皮啦 — public to everybody. */
  function makeCalloutBanner() {
    const el = h('div', { class: 'g9-callbanner' });
    return {
      el,
      update(v) {
        const used = v.callouts.used;
        el.hidden = used.length === 0;
        el.replaceChildren(...used.map((pid) => h('div', {
          class: 'g9-callbanner-row' + (pid === v.me ? ' me' : ''),
          text: `🛑 ${seatName(v.judge, v.me)} 對 ${seatName(pid, v.me)} 出咗收皮啦！`
            + (pid === v.me ? '俾人 call 咗，繼續撐落去。' : ''),
        })));
      },
    };
  }

  /** The judge's 收皮啦 chips: tap, then tap again to confirm. */
  function makeCalloutRow() {
    const head = h('div', { class: 'g9-callrow-head' });
    const chips = h('div', { class: 'g9-callrow-chips' });
    const el = h('div', { class: 'g9-callrow' }, head, chips);
    let armed = null;
    let handle = null;
    let last = null;
    let drawn = '';

    const paint = () => {
      const v = last;
      el.hidden = v.callouts.max === 0;
      head.textContent = `🛑 收皮啦 · 剩 ${v.callouts.left} 張`;
      const sig = JSON.stringify([v.explainers, v.callouts, armed, v.me]);
      if (sig === drawn) return;
      drawn = sig;
      // seat order — the same order as the 揀人 list right above it, never this round's speaking order
      const targets = api.players.map((p) => p.id).filter((pid) => v.explainers.includes(pid));
      chips.replaceChildren(...targets.map((pid) => {
        const used = v.callouts.used.includes(pid);
        const isArmed = armed === pid;
        const b = h('button', {
          class: 'g9-chip' + (used ? ' used' : '') + (isArmed ? ' armed' : ''),
          type: 'button',
          disabled: used || v.callouts.left === 0,
          style: `--seat:${colorOf(pid)}`,
          text: used ? `🛑 ${nameOf(pid)}` : isArmed ? `確定收皮 ${nameOf(pid)}？` : nameOf(pid),
        });
        b.addEventListener('click', () => {
          if (armed === pid) {
            armed = null;
            clearTimeout(handle);
            api.send({ type: 'callout', target: pid });
            return;
          }
          armed = pid;
          paint();
          clearTimeout(handle);
          handle = later(() => { armed = null; if (last) paint(); }, 3000);
        });
        return b;
      }));
    };
    return {
      el,
      update(v) { last = v; paint(); },
      destroy() { clearTimeout(handle); el.remove(); },
    };
  }

  // ---------- bodies ----------

  function levelJudgeBody() {
    const guard = sendGuard(() => buttons.forEach((x) => { x.disabled = false; }));
    const buttons = LEVELS.map((L) => {
      const b = h('button', { class: 'g9-level', type: 'button' },
        h('span', { class: 'g9-level-stars', text: S.stars(L.level) }),
        h('span', { class: 'g9-level-main', text: `${L.name} · ${L.pts} 分` }),
        h('span', { class: 'g9-level-sub', text: L.sub }));
      b.addEventListener('click', () => {
        guard.fire(() => {
          buttons.forEach((x) => { x.disabled = true; });
          api.sfx('deal');
          api.send({ type: 'level', level: L.level });
        });
      });
      return b;
    });
    const redo = redoNote();
    const el = h('div', { class: 'g9-stack' },
      redo.el,
      h('h2', { class: 'g9-h', text: '揀題目難度' }),
      h('p', { class: 'g9-sub', text: '分數愈高，提示愈少。' }),
      h('div', { class: 'g9-levels' }, buttons));
    return { el, update(v) { redo.update(v); }, destroy() {} };
  }

  /** A public line over a fresh deal: why it is one (呢輪作廢 / 💤). Hidden when there is nothing to say. */
  function redoNote() {
    const el = h('p', { class: 'g9-redo', role: 'status' });
    return { el, update(v) { const t = S.redoLine(v.redo, nameOf, v.judge); el.textContent = t; el.hidden = !t; } };
  }

  function waitingBody(textFn, emoji = '🤔') {
    const w = waitBlock(emoji, '');
    const redo = redoNote();
    const el = h('div', { class: 'g9-stack' }, redo.el, w.el);
    return { el, update(v) { redo.update(v); w.set(textFn(v)); }, destroy() {} };
  }

  /**
   * `term`: the term is on the table; anybody who already knows it says so and the 諗樣 swaps it.
   * 「我識呢條」 (D5) only lights up the 諗樣's 換題 button with the names — the 諗樣 still decides. Every 玩家 has the
   * same button, and nobody holds a card yet, so pressing it says nothing about a role.
   */
  function termBody(role) {
    const guard = sendGuard(rerender);
    const redo = redoNote();
    const startBtn = role === 'judge' ? h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: '開始睇卡' }) : null;
    startBtn?.addEventListener('click', () => {
      guard.fire(() => { startBtn.disabled = true; api.send({ type: 'start' }); });   // the read window sounds on every phone
    });
    const flagged = () => (view?.knows ?? []).map(nameOf).join('、');
    const swap = role === 'judge' ? confirmButton({
      cls: 'btn btn-ghost btn-sm g9-swap',
      label: () => (flagged() ? `🙋 ${flagged()} 話識 · 換題（仲有 ${view?.swapsLeft ?? 0} 次）`
        : `有人識呢條？換題（仲有 ${view?.swapsLeft ?? 0} 次）`),
      armedLabel: '確定換題？再㩒一下',
      onConfirm: () => { api.sfx('deal'); api.send({ type: 'swap' }); },
    }) : null;
    const knowBtn = role === 'player' ? h('button', { class: 'btn btn-ghost btn-sm g9-know', type: 'button' }) : null;
    knowBtn?.addEventListener('click', () => {
      const mine = (view?.knows ?? []).includes(view?.me);
      api.sfx('tap');
      api.send({ type: 'know', on: !mine });
    });
    const wait = role !== 'judge' ? waitBlock('👀', '') : null;
    const note = h('p', { class: 'g9-note' });
    const el = h('div', { class: 'g9-stack' },
      redo.el,
      h('h2', { class: 'g9-h', text: '睇吓題目' }),
      wait?.el, note, startBtn, swap?.el, knowBtn);
    return {
      el,
      update(v) {
        redo.update(v);
        note.textContent = role === 'judge'
          ? '有人已經識呢個詞？出聲就換題，身份唔變。冇人識就開始。'
          : '已經識呢個詞？出聲或者㩒「我識呢條」，諗樣決定換唔換。';
        wait?.set(`等 ${nameOf(v.judge)} 開始睇卡…`);
        if (startBtn) startBtn.disabled = guard.busy;
        if (swap) {
          swap.el.hidden = !v.canSwap;
          swap.el.classList.toggle('flagged', (v.knows ?? []).length > 0);
          swap.paint();
        }
        if (knowBtn) {
          const mine = (v.knows ?? []).includes(v.me);
          knowBtn.textContent = mine ? '🙋 已話咗識（再㩒取消）' : '🙋 我識呢條';
          knowBtn.classList.toggle('on', mine);
          knowBtn.setAttribute('aria-pressed', mine ? 'true' : 'false');
        }
      },
      destroy() { swap?.destroy(); },
    };
  }

  /**
   * `read`, together: one window, every phone (諗樣 included) holds a same-shaped card.
   * `read`, pass: one phone goes round; `sub` is this seat's part — 'ready' (my turn, not started),
   * 'peek' (my window is running) or 'wait' (somebody else is reading, or I am the 諗樣 / the table).
   */
  function readBody(role, sub, v0) {
    const together = sub === 'together';
    const showCard = together ? role !== 'table' : sub === 'peek';
    // mounted at (about) the start of the window, not re-mounted half way through it
    const fresh = v0.deadline != null && v0.deadline - api.now() > (v0.readSecs - 2) * 1000;
    // did this seat open its card in its window? (the 老實人's reminder must not claim a read that never happened)
    // Only a phone that watched the window from its start can say "never opened": a reload mid-window does not know
    // whether the card was opened before it, so it records nothing and the usual line stays.
    const key = `${roundKey(v0)}|${v0.me}`;
    if (showCard && role === 'player' && fresh && !readLog.has(key)) readLog.set(key, false);
    const card = showCard ? makeCard('㩒住睇卡', (open) => { if (open && role === 'player') readLog.set(key, true); }) : null;
    const timer = makeTimer();
    const note = h('p', { class: 'g9-note' });
    const wait = sub === 'wait' ? waitBlock('📱', '') : null;
    const guard = sendGuard(rerender);
    const startBtn = sub === 'ready' ? h('button', { class: 'btn btn-primary btn-lg', type: 'button' }) : null;
    startBtn?.addEventListener('click', () => {
      guard.fire(() => { startBtn.disabled = true; api.send({ type: 'peek' }); });
    });

    const el = h('div', { class: 'g9-stack' },
      h('h2', { class: 'g9-h', text: '睇卡時間' }),
      wait?.el, card?.el, startBtn, timer.el, note);
    // the window opens with the SAME sound and flash on every phone (諗樣 and table too): nobody loses seconds looking
    // at the table, and an iPhone on silent (no Web Audio) still flashes. Not again when a phone re-mounts mid-window.
    if (together && fresh) {
      el.classList.add('g9-flash');
      api.sfx('deal');
    }
    return {
      el,
      update(v, c) {
        card?.set(faceFor(v));
        timer.update(v, c, [5]);
        if (startBtn) {
          startBtn.textContent = `開始睇卡（${v.readSecs} 秒）`;
          startBtn.disabled = guard.busy;
        }
        if (wait) {
          const rd = v.reading;
          const reader = rd?.pid ? nameOf(rd.pid) : '';
          const progress = rd ? `（已睇 ${rd.done.length}/${rd.order.length}）` : '';
          wait.set(rd?.done.includes(v.me) ? `睇完喇，等其他人輪流睇${progress}` : `${reader} 睇緊卡…${progress}`);
        }
        note.textContent = role === 'table'
          ? (together ? '大家望住自己部電話睇卡。' : '部手機逐個傳，每人睇卡時間一樣。')
          : role === 'judge'
            ? (together ? '大家都喺度睇卡，你都要望住電話，等佢哋睇完。' : '部手機逐個傳，大家睇完就交返俾你。')
            : sub === 'ready'
              ? '準備好先㩒。夠鐘張卡會自動冚返，然後交俾下一位。'
              : sub === 'wait' ? '輪到你嗰陣會叫你。' : '㩒住張卡睇，倒數完先好擡頭。唔好露出表情。';
      },
      destroy() { card?.destroy(); timer.destroy(); },
    };
  }

  /**
   * `explain`. Three ways to order it (view.speakOrder):
   *  judge   諗樣揀 — rows are 「叫佢講」 buttons for the 諗樣; the speaker taps 我講完, the 諗樣 may tap 下一位
   *  system  系統派 — the phone announces who speaks (and who is next); nobody can call out of turn
   *  free    自己決定 — nobody is "up": a 玩家 ticks themselves off with 我講完, the 諗樣 taps a name to tick it off
   */
  function explainBody(role, mode) {
    const free = mode === 'free';
    const system = mode === 'system';
    const list = h('div', { class: 'g9-speakers' });
    const announce = system ? h('div', { class: 'g9-announce' }) : null;
    const timer = makeTimer();
    const banner = makeCalloutBanner();
    const callRow = role === 'judge' ? makeCalloutRow() : null;
    const card = role === 'player' ? makeCard('㩒住睇返我係咩') : null;
    const guard = sendGuard(rerender);
    const turnKey = (v) => (v?.turn ? `${v.turn.no ?? v.turn.spoken.length}|${v.turn.pid}` : '');
    let sentTurn = '';   // one 「done」 per turn, whoever taps it
    const sendDone = () => {
      const v = view;
      if (!v?.turn) return;
      if (free) { guard.fire(() => api.send({ type: 'done' })); return; }   // my own 我講完
      const k = turnKey(v);
      if (!k || sentTurn === k) return;
      // the turn number rides along, so a 我講完 and a 下一位 tapped together end one turn, not two
      guard.fire(() => { sentTurn = k; api.send({ type: 'done', turn: v.turn.no ?? v.turn.spoken.length }); });
    };
    const doneBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: '我講完' });
    doneBtn.addEventListener('click', sendDone);
    const nextBtn = role === 'judge' && !free ? h('button', { class: 'btn btn-ghost', type: 'button', text: '下一位' }) : null;
    nextBtn?.addEventListener('click', sendDone);
    const decideBtn = h('button', { class: 'btn btn-primary', type: 'button', text: '我決定咗，要揀人' });
    decideBtn.addEventListener('click', () => api.send({ type: 'decide' }));
    const ASK = '可以問任何關於個詞嘅嘢，但唔可以問人係咩身份。';
    const noteText = role === 'judge'
      ? { judge: `㩒名叫佢講，次序由你話事。${ASK}`,
        system: `電話隨機派人，次序同邊個係老實人冇關。人唔喺度就㩒「下一位」跳過，佢最尾會再輪到。${ASK}`,
        free: `大家自己傾邊個先講，講完㩒佢個名。${ASK}` }[mode]
      : role === 'player'
        ? { system: '電話隨機派人，次序同邊個係老實人冇關。', free: '大家自己傾好邊個先講；講完㩒「我講完」。' }[mode]
        : { system: '電話隨機派人，次序同邊個係老實人冇關。', free: '大家自己傾好邊個先講。' }[mode];
    const noteEl = noteText ? h('p', { class: 'g9-note', text: noteText }) : null;
    let listSig = '';
    let announceKey = '';

    const el = h('div', { class: 'g9-stack' },
      h('h2', { class: 'g9-h', text: free ? '自己決定次序' : '輪流解釋' }),
      announce, list, noteEl, timer.el, banner.el,
      doneBtn,
      role === 'judge' ? h('div', { class: 'g9-judgebtns' + (free ? ' solo' : '') }, nextBtn, decideBtn) : null,
      callRow?.el,
      card?.el);

    /** 系統派: 「輪到 阿B」 big, 「下一位：阿C」 small. A new line (and a soft chime for the one called) per turn. */
    function paintAnnounce(v) {
      const now = v.turn?.pid ?? null;
      const spoken = v.turn?.spoken ?? [];
      const next = v.turn && 'next' in v.turn ? v.turn.next : v.explainers.find((p) => !spoken.includes(p) && p !== now) ?? null;
      const key = `${now}|${next}|${v.me}`;
      if (key === announceKey) return;
      announceKey = key;
      announce.classList.toggle('me', now !== null && now === v.me);
      announce.replaceChildren(
        h('div', { class: 'g9-announce-main', text: now ? (now === v.me ? '🎤 輪到你講！' : `🎤 輪到 ${nameOf(now)}`) : '' }),
        h('div', { class: 'g9-announce-next', text: next ? `下一位：${nameOf(next)}` : '之後就到諗樣揀人' }));
      if (now !== null && now === v.me) api.sfx('turn');
    }

    return {
      el,
      update(v, c) {
        const spoken = v.turn?.spoken ?? [];
        const skipped = v.turn?.skipped ?? [];
        const now = v.turn?.pid ?? null;
        if (announce) paintAnnounce(v);
        const sig = JSON.stringify([v.explainers, spoken, skipped, now, v.callouts.used, v.me, v.absent ?? []]);
        if (sig !== listSig) {
          listSig = sig;
          list.replaceChildren(...v.explainers.map((pid, i) => {
            // ⏭ 跳過咗: the turn was ended FOR them — they come back once at the end (and in 諗樣揀 can be called back)
            // 💤 唔喺度: the host marked them away — nobody waits for them (public)
            const state = pid === now ? 'now' : away(v, pid) ? 'away' : skipped.includes(pid) ? 'skipped'
              : spoken.includes(pid) ? 'done' : 'todo';
            const called = v.callouts.used.includes(pid);
            const act = role !== 'judge' ? null
              : state === 'todo' ? (free ? 'done' : system ? null : 'call')
                : state === 'skipped' && !free && !system ? 'call' : null;
            const row = h(act ? 'button' : 'div', {
              class: `g9-speaker ${state}${act ? ' callable' : ''}`, style: `--seat:${colorOf(pid)}`,
              type: act ? 'button' : null,
            },
            h('span', { class: 'g9-speaker-dot' }),
            h('span', { class: 'g9-speaker-name', text: (system ? `${i + 1}. ` : '') + seatName(pid, v.me) }),
            h('span', { class: 'g9-speaker-state',
              text: state === 'away' ? '💤 唔喺度' : state === 'skipped' ? (act ? '⏭ 跳過咗 · 叫返佢' : '⏭ 跳過咗') : state === 'done' ? '✅ 已講'
                : state === 'now' ? '🎤 講緊' : act === 'call' ? '👉 叫佢講' : act === 'done' ? '👆 講完喇' : '⏳ 等緊' }),
            called ? h('span', { class: 'g9-speaker-call', text: '🛑' }) : null);
            if (act) {
              row.addEventListener('click', () => {
                api.sfx('tap');
                api.send(act === 'call' ? { type: 'call', target: pid } : { type: 'done', target: pid });
              });
            }
            return row;
          }));
        }
        timer.update(v, c, [10]);
        banner.update(v);
        const k = turnKey(v);
        const mine = role === 'player' && (free ? !spoken.includes(v.me) : now === v.me);
        doneBtn.hidden = !mine;
        if (sentTurn !== k) sentTurn = '';
        doneBtn.disabled = guard.busy && (free || sentTurn === k);
        if (nextBtn) nextBtn.disabled = guard.busy && sentTurn === k;
        if (callRow) callRow.update(v);
        if (card) card.set(faceFor(v));
      },
      destroy() { timer.destroy(); callRow?.destroy(); card?.destroy(); },
    };
  }

  function judgeBody(role) {
    let sel = [];
    const guard = sendGuard(rerender);
    const banner = makeCalloutBanner();
    const callRow = role === 'judge' ? makeCalloutRow() : null;
    const card = role === 'player' ? makeCard('㩒住睇返我係咩') : null;
    const wait = role !== 'judge' ? waitBlock('🤔', '') : null;
    const picker = role === 'judge'
      ? PlayerPicker({ players: [], me: null, count: 1, exclude: [], selected: [], disabled: false })
      : null;
    const paintPicker = (v) => picker.update({
      players: api.players.filter((p) => v.explainers.includes(p.id)),
      me: v.me, count: 1, exclude: [], selected: sel, disabled: guard.busy,
      onChange(s) { sel = s; },
      confirmLabel: '就係佢！',
      onConfirm(s) {
        if (!s.length) return;
        guard.fire(() => { api.send({ type: 'pick', target: s[0] }); });
        paintPicker(v);
      },
    });
    const el = h('div', { class: 'g9-stack' },
      h('h2', { class: 'g9-h', text: role === 'judge' ? '邊個係老實人？' : '等緊諗樣揀人' }),
      role === 'judge' ? picker.el : wait.el,
      h('p', { class: 'g9-note',
        text: role === 'judge' ? '揀之前仲可以繼續問（唔可以問身份）。揀咗就改唔到。' : '諗樣仲可以追問，大家都可以互相質疑。' }),
      banner.el, callRow?.el, card?.el);
    return {
      el,
      update(v) {
        banner.update(v);
        if (picker) paintPicker(v);
        wait?.set(`${nameOf(v.judge)} 諗緊邊個係老實人…`);
        callRow?.update(v);
        card?.set(faceFor(v));
      },
      destroy() { picker?.destroy(); callRow?.destroy(); card?.destroy(); },
    };
  }

  /** 「來源：維基百科：深水埗」, a link when the source is a web page (never the raw, percent-encoded URL). */
  function srcLine(src) {
    const { text, href } = S.srcLabel(src);
    const label = href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer', text }) : text;
    return h('div', { class: 'g9-truth-src' }, '來源：', label);
  }

  function revealBody(role) {
    const pickLine = h('div', { class: 'g9-reveal-pick' });
    const lines = h('div', { class: 'g9-reveal-lines' });
    const truth = h('div', { class: 'g9-truth' });
    const changes = h('div', { class: 'g9-reveal-changes' });
    const late = h('div', { class: 'g9-reveal-late' }, lines, truth, changes);
    const waitTxt = h('p', { class: 'g9-note' });
    const guard = sendGuard(rerender);
    const nextBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button' });
    nextBtn.addEventListener('click', () => {
      guard.fire(() => { nextBtn.disabled = true; api.send({ type: 'next' }); });
    });
    later(() => api.sfx('reveal'), 1200);
    // a 諗樣 marked 💤 cannot press it: then the button is on every seated phone
    const el = h('div', { class: 'g9-stack g9-reveal' }, pickLine, late, nextBtn, waitTxt);
    return {
      el,
      update(v) {
        const rv = v.reveal;
        if (!rv) return;
        pickLine.textContent = `${seatName(rv.judge, v.me)} 揀咗 ${seatName(rv.pick, v.me)}…`;
        lines.replaceChildren(...rv.lines.map((l, i) => h('div', { class: 'g9-reveal-line' + (i === 0 ? ' first' : ''), text: l })));
        truth.replaceChildren(
          h('div', { class: 'g9-truth-label', text: `真正解釋 · ${S.stars(rv.level)}` }),
          h('div', { class: 'g9-truth-term', text: rv.term }),
          h('div', { class: 'g9-truth-text', text: rv.explain }),
          rv.src ? srcLine(rv.src) : null);
        changes.textContent = `分數變動：${S.changeLine(rv.changes, nameOf)}`;
        const anyone = away(v, v.judge) && !!v.me && !away(v, v.me);
        nextBtn.hidden = !(role === 'judge' || anyone);
        waitTxt.hidden = !nextBtn.hidden;
        nextBtn.textContent = v.last ? '睇總結' : '下一輪';
        nextBtn.disabled = guard.busy;
        waitTxt.textContent = `等 ${nameOf(v.judge)} ${v.last ? '睇總結' : '開下一輪'}…`;
      },
      destroy() {},
    };
  }

  function overBody() {
    const list = h('div', { class: 'g9-final' });
    const el = h('div', { class: 'g9-stack' }, h('h2', { class: 'g9-h', text: '遊戲完' }), list);
    return {
      el,
      update(v) {
        const top = Math.max(...Object.values(v.scores));
        const rows = api.players.filter((p) => p.id in v.scores).sort((a, b) => v.scores[b.id] - v.scores[a.id]);
        list.replaceChildren(...rows.map((p) => h('div', { class: 'g9-final-row' + (v.scores[p.id] === top ? ' lead' : '') },
          h('span', { text: (v.scores[p.id] === top ? '🏆 ' : '') + p.name }),
          h('span', { class: 'g9-final-n', text: `${v.scores[p.id]} 分` }))));
      },
      destroy() {},
    };
  }

  /** In the pass-the-phone read, which part of it this seat is in (the body is rebuilt when it changes). */
  function readSub(v, role) {
    if (v.readMode !== 'pass' || !v.reading) return 'together';
    if (role !== 'player' || v.reading.pid !== v.me) return 'wait';
    return v.reading.started ? 'peek' : 'ready';
  }

  function makeBody(v, role, sub) {
    switch (v.phase) {
      case 'level':
        return role === 'judge'
          ? levelJudgeBody()
          : waitingBody((x) => `${nameOf(x.judge)} 揀緊題目難度…`);
      case 'term': return termBody(role);
      case 'read': return readBody(role, sub, v);
      case 'explain': return explainBody(role, v.speakOrder ?? 'judge');
      case 'judge': return judgeBody(role);
      case 'reveal': return revealBody(role);
      default: return overBody();
    }
  }

  // ---------- update / destroy ----------

  function noteNewCallouts(v) {
    const count = v.callouts.used.length;
    if (callSeen && callSeen.round === roundKey(v) && count > callSeen.count) {
      api.sfx('deny');
      const mine = v.callouts.used[count - 1] === v.me;
      if (mine) api.toast('俾人 call 咗，繼續撐落去。');
    }
    callSeen = { round: roundKey(v), count };
  }

  return {
    update(nextView, nextCtx) {
      view = nextView;
      ctx = nextCtx ?? {};
      if (!view) return;
      paintTerm(view);
      paintScores(view);
      noteNewCallouts(view);

      // a seat that was away at the deal holds no card this round: it sees what the table sees
      const role = view.me === view.judge ? 'judge' : view.me && view.explainers.includes(view.me) ? 'player' : 'table';
      const sub = view.phase === 'read' ? readSub(view, role) : '';
      const key = `${view.phase}|${roundKey(view)}|${role}|${sub}|${view.speakOrder}`;
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
