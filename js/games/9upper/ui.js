// ============================================================
// 瞎掰王 9upper — game UI.   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view any number of
// times. The term card and the score strip are persistent (the shell's top bar
// already shows 「第 3/12 輪 · 阿明 做諗樣」 from view.title / view.subtitle); the
// body under them is rebuilt only when (phase, round, role) changes, so a
// Cover the player is holding down is never torn out from under their finger.
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

  let view = null;
  let ctx = {};
  let bodyKey = '';
  let body = null;
  let callSeen = null;       // { round, count } — so a new 收皮啦 sounds once, not on every update
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
  const termCard = h('div', { class: 'g9-term' }, termKicker, termText, termHint);

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
        h('span', { class: 'g9-score-name', text: (p.id === v.judge ? '🧠 ' : '') + p.name }),
        h('span', { class: 'g9-score-n', text: String(v.scores[p.id]) }),
        d ? h('span', { class: 'g9-score-d ' + (d > 0 ? 'up' : 'down'), text: S.sc(d) }) : null);
      });
    scoreStrip.replaceChildren(...chips);
  }

  // ---------- small shared builders ----------

  /** A hold-to-peek card. `set(face)` repaints it; the Cover keeps the same front node. */
  function makeCard(backLabel) {
    const roleEl = h('div', { class: 'g9-face-role' });
    const textEl = h('div', { class: 'g9-face-text' });
    const noteEl = h('div', { class: 'g9-face-note' });
    const front = h('div', { class: 'g9-face' }, roleEl, textEl, noteEl);
    const props = { front, backArt: '🃏', backLabel, lockMode: 'none', locked: false };
    const cover = Cover(props);
    return {
      el: cover.el,
      set(face) {
        roleEl.textContent = face.role;
        textEl.textContent = face.text;
        textEl.classList.toggle('long', face.text.length > 52);
        noteEl.textContent = face.note;
        cover.update(props);
      },
      close: () => cover.close(),
      destroy: () => cover.destroy(),
    };
  }

  /** What is written on my card. Same three-line shape for every role (see §3.6 anti-tell). */
  function faceFor(v) {
    if (v.me === v.judge) {
      return { role: '你係諗樣 🧠', text: '你唔會見到解釋，靜靜哋睇住大家。', note: '等佢哋睇完，就逐個解釋俾你聽。' };
    }
    if (v.mine?.honest) {
      return {
        role: '你係老實人 🙋',
        text: v.mine.explain ?? '你睇過真正解釋喇，用自己嘅講法講。',
        note: v.mine.explain ? '用自己嘅講法講，唔好照讀。' : '唔記得嘅細節可以話「張卡冇寫」。',
      };
    }
    return { role: '你係 9upper 🤥', text: '作一個解釋，要講得似真㗎！', note: '你睇唔到真正解釋，靠你把口。' };
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
      chips.replaceChildren(...v.explainers.map((pid) => {
        const used = v.callouts.used.includes(pid);
        const isArmed = armed === pid;
        const b = h('button', {
          class: 'g9-chip' + (used ? ' used' : '') + (isArmed ? ' armed' : ''),
          type: 'button',
          disabled: used || v.callouts.left === 0,
          style: `--seat:${colorOf(pid)}`,
          text: used ? `🛑 ${nameOf(pid)}` : isArmed ? `確定？再㩒一下` : nameOf(pid),
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
    const el = h('div', { class: 'g9-stack' },
      h('h2', { class: 'g9-h', text: '揀題目難度' }),
      h('p', { class: 'g9-sub', text: '分數愈高，提示愈少。' }),
      h('div', { class: 'g9-levels' }, buttons));
    return { el, update() {}, destroy() {} };
  }

  function waitingBody(textFn, emoji = '🤔') {
    const w = waitBlock(emoji, '');
    return { el: w.el, update(v) { w.set(textFn(v)); }, destroy() {} };
  }

  function readBody(role) {
    const card = role === 'table' ? null : makeCard('㩒住睇卡');
    const timer = makeTimer();
    const note = h('p', { class: 'g9-note' });
    const guard = sendGuard(rerender);
    const readyBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: '我睇完' });
    readyBtn.addEventListener('click', () => {
      guard.fire(() => { readyBtn.disabled = true; api.send({ type: 'ready' }); });
    });
    const swap = role === 'judge' ? confirmButton({
      cls: 'btn btn-ghost btn-sm g9-swap',
      label: () => `有人識呢條？換題（仲有 ${view?.swapsLeft ?? 0} 次）`,
      armedLabel: '確定換題？再㩒一下',
      onConfirm: () => { api.sfx('deal'); api.send({ type: 'swap' }); },
    }) : null;

    const el = h('div', { class: 'g9-stack' },
      h('h2', { class: 'g9-h', text: '睇卡時間' }),
      card?.el,
      timer.el,
      readyBtn,
      note,
      swap?.el);
    return {
      el,
      update(v, c) {
        card?.set(faceFor(v));
        timer.update(v, c, [5]);
        readyBtn.hidden = !(role === 'player' && v.readMode === 'tap');
        if (v.mine?.ready) { readyBtn.disabled = true; readyBtn.textContent = '睇完喇，等緊其他人…'; }
        else { readyBtn.disabled = guard.busy; readyBtn.textContent = '我睇完'; }
        note.textContent = role === 'table'
          ? '大家望住自己部電話睇卡。'
          : role === 'judge'
            ? '大家都喺度睇卡，你都要望住電話，等佢哋睇完。'
            : '㩒住張卡睇，放手就冚返。睇卡嗰陣唔好露出表情。';
        if (swap) { swap.el.hidden = !v.canSwap; swap.paint(); }
      },
      destroy() { card?.destroy(); timer.destroy(); swap?.destroy(); },
    };
  }

  function explainBody(role) {
    const list = h('div', { class: 'g9-speakers' });
    const timer = makeTimer();
    const banner = makeCalloutBanner();
    const callRow = role === 'judge' ? makeCalloutRow() : null;
    const card = role === 'player' ? makeCard('㩒住睇返我係咩') : null;
    const guard = sendGuard(rerender);
    let sentTurn = -1;   // one 「done」 per turn, whoever taps it
    const sendDone = () => {
      if (!view?.turn || sentTurn === view.turn.index) return;
      guard.fire(() => { sentTurn = view.turn.index; api.send({ type: 'done' }); });
    };
    const doneBtn = h('button', { class: 'btn btn-primary btn-lg', type: 'button', text: '我講完' });
    doneBtn.addEventListener('click', sendDone);
    const nextBtn = h('button', { class: 'btn btn-ghost', type: 'button', text: '下一位' });
    nextBtn.addEventListener('click', sendDone);
    const decideBtn = h('button', { class: 'btn btn-primary', type: 'button', text: '我決定咗，要揀人' });
    decideBtn.addEventListener('click', () => api.send({ type: 'decide' }));

    const el = h('div', { class: 'g9-stack' },
      h('h2', { class: 'g9-h', text: '輪流解釋' }),
      list, timer.el, banner.el,
      doneBtn,
      role === 'judge' ? h('div', { class: 'g9-judgebtns' }, nextBtn, decideBtn) : null,
      callRow?.el,
      card?.el);
    return {
      el,
      update(v, c) {
        const cur = v.turn?.index ?? 0;
        list.replaceChildren(...v.explainers.map((pid, i) => {
          const state = i < cur ? 'done' : i === cur ? 'now' : 'todo';
          const called = v.callouts.used.includes(pid);
          return h('div', { class: `g9-speaker ${state}`, style: `--seat:${colorOf(pid)}` },
            h('span', { class: 'g9-speaker-dot' }),
            h('span', { class: 'g9-speaker-name', text: seatName(pid, v.me) }),
            h('span', { class: 'g9-speaker-state',
              text: state === 'done' ? '✅ 已講' : state === 'now' ? '🎤 講緊' : '⏳ 等緊' }),
            called ? h('span', { class: 'g9-speaker-call', text: '🛑' }) : null);
        }));
        timer.update(v, c, [10]);
        banner.update(v);
        const mySpeak = role === 'player' && v.turn?.pid === v.me;
        doneBtn.hidden = !mySpeak;
        if (sentTurn !== cur) sentTurn = -1;
        doneBtn.disabled = guard.busy && sentTurn === cur;
        nextBtn.disabled = guard.busy && sentTurn === cur;
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
    const el = h('div', { class: 'g9-stack g9-reveal' }, pickLine, late, role === 'judge' ? nextBtn : waitTxt);
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
          rv.src ? h('div', { class: 'g9-truth-src', text: `來源：${rv.src}` }) : null);
        changes.textContent = `分數變動：${S.changeLine(rv.changes, nameOf)}`;
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

  function makeBody(v, role) {
    switch (v.phase) {
      case 'level':
        return role === 'judge'
          ? levelJudgeBody()
          : waitingBody((x) => `${nameOf(x.judge)} 揀緊題目難度…`);
      case 'read': return readBody(role);
      case 'explain': return explainBody(role);
      case 'judge': return judgeBody(role);
      case 'reveal': return revealBody(role);
      default: return overBody();
    }
  }

  // ---------- update / destroy ----------

  function noteNewCallouts(v) {
    const count = v.callouts.used.length;
    if (callSeen && callSeen.round === v.round.n && count > callSeen.count) {
      api.sfx('deny');
      const mine = v.callouts.used[count - 1] === v.me;
      if (mine) api.toast('俾人 call 咗，繼續撐落去。');
    }
    callSeen = { round: v.round.n, count };
  }

  return {
    update(nextView, nextCtx) {
      view = nextView;
      ctx = nextCtx ?? {};
      if (!view) return;
      paintTerm(view);
      paintScores(view);
      noteNewCallouts(view);

      const role = view.me === view.judge ? 'judge' : view.me ? 'player' : 'table';
      const key = `${view.phase}|${view.round.n}|${role}`;
      if (key !== bodyKey) {
        body?.destroy();
        body = makeBody(view, role);
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
