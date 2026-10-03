// ============================================================
// 你畫我猜 — game UI.   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view any number of times. The
// score strip is persistent; the body above it is rebuilt only when (phase, turn, role,
// modes) changes, so the Canvas, a half-typed guess or a hold-to-peek cover is never torn
// out from under a finger. Phase hints (view.hint) are NOT shown here: the shell shows
// them only behind 💡.
//
// Who sees what (docs/games/draw-guess.md §3):
//   drawer   the word (tap or hold to peek, hidden by default), the mask and hints (public — on a single shared
//            phone this IS the table's screen), the canvas with full tools,
//            shout: a name chip per guesser · typed: the live guess feed with ✔ per guess
//   guesser  timer, length mask, hints, the picture, and (typed) an input box
//   rival    (team mode, the other team's turn) / spectator: the same public screen, no input; a rival may 🚩
//   host     (its own seat) +30 s, 作廢今輪, and the ruling on a team foul. The host phone's ⋯ menu offers +30 s and
//            the ruling too (engine.hostActions, for a shared phone showing another seat); 作廢 there is the shell's
//            own 🗑️ 呢輪作廢, so the bar stays as the one-tap shortcut on the host's own seat.
//
// Canvas (DESIGN §15.10): the drawer gets tools 'full'; viewers 'none' and canDraw false. canDraw comes from the
// engine (engine.canInk). The engine never needs to know about strokes, so no { type: 'stroke' } is sent; a new
// picture starts when the engine bumps inkEpoch (every turn in canvas mode). minStrokeLen stays 0: a dot is
// a legitimate mark here (eyes, buttons, rain) — see docs §9.
//
// Typed input and iOS Chinese IME: a guess is only ever sent from a committed string —
// never while a composition is open, and not for ~80 ms after compositionend (Safari fires
// the confirming Enter keydown AFTER it).
//
// Only api.components (Cover, Timer, Canvas) and plain DOM are used.
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

const MAX_LEN = 30;            // code points; mirrors the engine
const MIN_GAP_MS = 700;        // mirrors the engine's per-player guess spacing
const PEEK_MS = 2500;
const MAX_PTS = { 1: 30, 2: 45, 3: 60 };

export function mount(root, api) {
  const { Cover, Timer, Canvas } = api.components;
  const nameOf = (pid) => api.players.find((p) => p.id === pid)?.name ?? '?';
  const colorOf = (pid) => api.players.find((p) => p.id === pid)?.color ?? 'var(--cheese, #f5c518)';
  const seatName = (pid, me) => nameOf(pid) + (pid === me ? '（你）' : '');

  let view = null;
  let ctx = {};
  let bodyKey = '';
  let body = null;
  let baseline = null;       // what the last update looked like, so sounds fire on CHANGES only
  const timers = new Set();

  const later = (fn, ms) => {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
    return t;
  };
  const cancel = (t) => { if (t != null) { clearTimeout(t); timers.delete(t); } };
  const rerender = () => { if (body && view) body.update(view, ctx); };
  /** Typed play is for quiet places (the shinkansen): this UI makes no sound at all there. */
  const sound = (name) => { if (view?.guessMode !== 'typed') api.sfx(name); };

  /** Blocks re-taps while an action is in flight; lets go after 3.5 s so a dropped message cannot lock anyone out. */
  function sendGuard(onRelease) {
    let on = false;
    return {
      get busy() { return on; },
      fire(send) {
        if (on) return false;
        on = true;
        send();
        later(() => { on = false; onRelease?.(); }, 3500);
        return true;
      },
    };
  }

  /** A button that needs a second tap within 3 s. */
  function confirmButton({ cls, label, armedLabel, onConfirm }) {
    let armed = false;
    let handle = null;
    const btn = h('button', { class: cls, type: 'button' });
    const paint = () => { btn.textContent = armed ? armedLabel : label(); btn.classList.toggle('armed', armed); };
    btn.addEventListener('click', () => {
      if (armed) { armed = false; cancel(handle); paint(); onConfirm(); return; }
      armed = true;
      paint();
      handle = later(() => { armed = false; paint(); }, 3000);
    });
    paint();
    return { el: btn, paint, destroy() { cancel(handle); btn.remove(); } };
  }

  // ---------- persistent chrome: the score strip ----------

  const bodyHost = h('div', { class: 'dg-body' });
  const scoreStrip = h('div', { class: 'dg-scores', role: 'list', 'aria-label': '分數' });
  root.replaceChildren(h('div', { class: 'dg' }, bodyHost, scoreStrip));
  let scoreSig = '';

  function paintScores(v) {
    const solved = new Set(v.play?.solved ?? []);
    const sig = JSON.stringify([v.scores, v.teams, v.turn.drawer, [...solved], v.phase, v.me, v.reveal?.solvers]);
    if (sig === scoreSig) return;
    scoreSig = sig;
    if (v.teams) {
      scoreStrip.replaceChildren(...v.teams.map((t) => h('div', {
        class: 'dg-score team' + (t.i === v.turn.team ? ' now' : '') + (t.i === v.myTeam ? ' me' : ''), role: 'listitem',
      },
      h('span', { class: 'dg-score-name', text: S.teamLabel(t.i) }),
      h('span', { class: 'dg-score-n', text: String(t.score) }),
      h('span', { class: 'dg-score-sub', text: t.members.map(nameOf).join('、') }))));
      return;
    }
    const delta = new Map((v.reveal?.solvers ?? []).map((x) => [x.pid, x.pts]));
    if (v.reveal?.drawerPts) delta.set(v.reveal.drawer, v.reveal.drawerPts);
    const best = Math.max(...Object.values(v.scores));
    scoreStrip.replaceChildren(...api.players.filter((p) => p.id in v.scores).map((p) => {
      const d = v.phase === 'reveal' ? delta.get(p.id) : 0;
      return h('div', {
        class: 'dg-score' + (p.id === v.me ? ' me' : '') + (p.id === v.turn.drawer && v.phase !== 'over' ? ' drawing' : '')
          + (v.phase === 'over' && v.scores[p.id] === best && best > 0 ? ' lead' : ''),
        role: 'listitem', style: `--seat:${p.color ?? '#f5c518'}`,
      },
      h('span', { class: 'dg-score-dot' }),
      h('span', { class: 'dg-score-name', text: (p.id === v.turn.drawer && v.phase !== 'over' ? '✏️ ' : '') + p.name }),
      h('span', { class: 'dg-score-n', text: String(v.scores[p.id]) }),
      solved.has(p.id) ? h('span', { class: 'dg-score-mark', text: '✅' }) : null,
      d ? h('span', { class: 'dg-score-d up', text: S.sc(d) }) : null);
    }));
  }

  // ---------- small shared builders ----------

  /** The shared Timer look without its beeps, for typed (quiet) play. */
  function silentClock(props) {
    const label = h('div', { class: 'c-timer-label' });
    const clock = h('div', { class: 'c-timer-clock' });
    const root = h('div', { class: 'c-timer', role: 'timer' }, label, clock);
    let p = props;
    let frozen = null;
    let wasPaused = false;
    const left = () => (p.deadline == null ? null : Math.max(0, (p.deadline - p.now()) / 1000));
    const paint = () => {
      const rem = p.paused && frozen != null ? frozen : left();
      clock.textContent = rem == null ? '–:––' : `${Math.floor(Math.ceil(rem) / 60)}:${String(Math.ceil(rem) % 60).padStart(2, '0')}`;
      const last = Math.min(...(p.warnAt?.length ? p.warnAt : [10]));
      root.classList.toggle('urgent', rem != null && rem > 0 && rem <= last);
      root.classList.toggle('done', rem === 0);
      root.classList.toggle('paused', !!p.paused);
    };
    const iv = setInterval(paint, 250);
    const api2 = {
      el: root,
      update(next) {
        p = next;
        if (p.paused && !wasPaused) frozen = left();
        if (!p.paused) frozen = null;
        wasPaused = !!p.paused;
        label.textContent = p.label ?? '';
        label.hidden = !p.label;
        paint();
      },
      destroy() { clearInterval(iv); root.remove(); },
    };
    api2.update(props);
    return api2;
  }

  function makeTimer() {
    let t = null;
    let key = '';
    const host = h('div', { class: 'dg-timer' });
    return {
      el: host,
      update(v, c, warnAt = [10]) {
        if (v.deadline == null) { t?.destroy(); t = null; key = ''; host.hidden = true; return; }
        host.hidden = false;
        const label = v.timerLabel || (v.phase === 'reveal' ? '自動下一輪' : '');
        // a new window (grace, buzzer) is a new clock: a fresh Timer never beeps for a threshold it did not watch being crossed
        const k = `${v.phase}|${v.sub}|${label}|${v.guessMode}`;
        if (t && k !== key) { t.destroy(); t = null; }
        key = k;
        const props = { deadline: v.deadline, now: api.now, label, paused: !!c?.paused, warnAt };
        if (!t) { t = v.guessMode === 'typed' ? silentClock(props) : Timer(props); host.append(t.el); } else t.update(props);
      },
      destroy() { t?.destroy(); host.remove(); },
    };
  }

  /** A calm "自動下一輪 · 6 秒" for the reveal and the standings (the shared Timer would pulse red and beep at zero). */
  function makeCountdown(label = '自動下一輪') {
    const el = h('div', { class: 'dg-count' });
    let deadline = null;
    let paused = false;
    let iv = null;
    const paint = () => {
      if (deadline == null || paused) return;
      el.textContent = `${label} · ${Math.max(0, Math.ceil((deadline - api.now()) / 1000))} 秒`;
    };
    return {
      el,
      update(v, c) {
        deadline = v.deadline ?? null;
        paused = !!c?.paused;
        el.hidden = deadline == null;
        paint();
        if (!iv) iv = setInterval(paint, 500);
      },
      destroy() { if (iv) clearInterval(iv); iv = null; el.remove(); },
    };
  }

  function makeMask() {
    const row = h('div', { class: 'dg-mask', role: 'img' });
    let sig = '';
    return {
      el: row,
      set(mask) {
        const s = JSON.stringify(mask);
        if (s === sig) return;
        sig = s;
        row.setAttribute('aria-label', `共 ${mask.n} 隻字，已經揭開 ${mask.cells.filter((c) => c && c !== ' ').length} 隻`);
        row.replaceChildren(...mask.cells.map((c) => (c === ' '
          ? h('span', { class: 'dg-mask-gap' })
          : h('span', { class: 'dg-mask-cell' + (c ? ' on' : ''), text: c }))));
      },
    };
  }

  const waitBlock = (emoji) => {
    const t = h('p', { class: 'dg-wait-text' });
    const el = h('div', { class: 'dg-wait' }, h('div', { class: 'dg-wait-emoji', text: emoji }), t);
    return { el, set(s) { t.textContent = s; } };
  };

  /** The canvas for this seat. The drawer gets full tools; everyone else only watches. */
  function makeCanvas(role, typedGuesser, extra = '') {
    const cls = `dg-canvas${role === 'drawer' ? ' drawer' : typedGuesser ? ' typed' : ''}${extra ? ` ${extra}` : ''}`;
    const host = h('div', { class: cls });
    let cv = null;
    return {
      el: host,
      update(v, c) {
        const props = {
          me: v.me ?? undefined, ink: c.ink, canDraw: !!v.play?.canDraw && !c.paused, tools: role === 'drawer' ? 'full' : 'none',
          oneStroke: false, minStrokeLen: 0, onInk: (p) => api.ink(p),
        };
        if (!cv) { cv = Canvas(props); host.append(cv.el); } else cv.update(props);
      },
      destroy() { cv?.destroy(); host.remove(); },
    };
  }

  /** The word on the drawer's phone. Hidden until asked for: paper mode = hold (Cover), canvas mode = tap (auto-hides). */
  function makeWordPeek(paper) {
    const wordEl = h('div', { class: 'dg-word-text' });
    const altEl = h('div', { class: 'dg-word-alt' });
    const metaEl = h('div', { class: 'dg-word-meta' });
    if (paper) {
      const front = h('div', { class: 'dg-word-face' }, wordEl, altEl, metaEl);
      const props = { front, backArt: '🙈', backLabel: '㩒住睇個詞', lockMode: 'none', ariaLabel: '㩒住睇個詞' };
      const cover = Cover(props);
      cover.el.classList.add('dg-word-cover');
      return {
        el: cover.el,
        set(word) {
          fillWord(wordEl, altEl, metaEl, word);
          cover.update(props);
        },
        hide() { cover.close(); },
        destroy() { cover.destroy(); },
      };
    }
    let shown = false;
    let handle = null;
    const chip = h('button', { class: 'dg-word-chip', type: 'button' });
    const paint = () => {
      chip.classList.toggle('open', shown);
      chip.replaceChildren(...(shown
        ? [wordEl, altEl, metaEl]
        : [h('span', { class: 'dg-word-hidden', text: '👁 㩒一下睇個詞' })]));
    };
    chip.addEventListener('click', () => {
      shown = true;
      paint();
      cancel(handle);
      handle = later(() => { shown = false; paint(); }, PEEK_MS);
    });
    paint();
    return {
      el: chip,
      set(word) { fillWord(wordEl, altEl, metaEl, word); },
      hide() { shown = false; cancel(handle); paint(); },
      destroy() { cancel(handle); chip.remove(); },
    };
  }

  function fillWord(wordEl, altEl, metaEl, word) {
    wordEl.textContent = word.w;
    wordEl.classList.toggle('long', Array.from(word.w).length > 6);
    altEl.textContent = word.alt.length ? `都接受：${word.alt.slice(0, 6).join('／')}` : '';
    altEl.hidden = !word.alt.length;
    metaEl.textContent = `${S.stars(word.level)} ${S.LEVEL_NAME[word.level]}${word.cat ? ` · ${word.cat}` : ''}`;
  }

  // ---------- body: choose ----------

  function chooseBody(role) {
    if (role !== 'drawer') {
      const w = waitBlock('✏️');
      const queue = h('p', { class: 'dg-note dg-upnext' });
      const mod = modBar();
      const el = h('div', { class: 'dg-stack' }, w.el, queue, mod.el);
      return {
        el,
        update(v, c) {
          mod.update(v, c);
          const who = v.teams ? `${S.teamLabel(v.turn.team)} 嘅 ${nameOf(v.turn.drawer)}` : nameOf(v.turn.drawer);
          w.set(`${who} 揀緊詞…`);
          // the queue preview: whoever is next can get paper ready (or just knows it is coming)
          queue.textContent = v.upNext?.length ? `之後到：${v.upNext.map((pid) => seatName(pid, v.me)).join(' → ')}` : '';
          queue.hidden = !queue.textContent;
        },
        destroy() { mod.destroy(); },
      };
    }
    const timer = makeTimer();
    const guard = sendGuard(rerender);
    const cards = h('div', { class: 'dg-offers' });
    const note = h('p', { class: 'dg-note' });
    const reroll = confirmButton({
      cls: 'btn btn-ghost btn-sm dg-reroll',
      label: () => '🔄 唔鍾意？換一批（得一次）',
      armedLabel: '確定換？再㩒一下',
      onConfirm: () => { sound('deal'); api.send({ type: 'reroll' }); },
    });
    let offerSig = '';
    const mod = modBar();
    const el = h('div', { class: 'dg-stack' },
      h('h2', { class: 'dg-h', text: '揀一個詞嚟畫' }), note, cards, reroll.el, timer.el, mod.el);
    return {
      el,
      update(v, c) {
        timer.update(v, c, [5]);
        mod.update(v, c);
        const o = v.choose?.offers ?? [];
        note.textContent = v.drawMode === 'paper'
          ? '先攞定張白紙同支筆。揀完就即刻計時，其他人睇唔到你揀咗乜。'
          : '揀完就即刻計時，其他人隨即睇到你畫。難啲嘅詞分數高啲。';
        const paused = !!c?.paused;
        const sig = JSON.stringify([o, v.scoring, guard.busy, paused]);
        if (sig !== offerSig) {
          offerSig = sig;
          cards.replaceChildren(...o.map((x) => {
            const pts = v.scoring === 'time' ? `最多 ${MAX_PTS[x.level] ?? 30} 分`
              : v.scoring === 'stars' ? `全隊 +${x.level} 分` : '全隊 +1 分';
            const b = h('button', { class: `dg-offer lv${x.level}`, type: 'button', disabled: guard.busy || paused },
              h('span', { class: 'dg-offer-level' }, `${S.stars(x.level)} ${S.LEVEL_NAME[x.level]}`),
              h('span', { class: 'dg-offer-word' + (Array.from(x.w).length > 6 ? ' long' : ''), text: x.w }),
              h('span', { class: 'dg-offer-meta', text: `${x.cat ? `${x.cat} · ` : ''}${x.len} 隻字 · ${pts}` }));
            b.addEventListener('click', () => {
              guard.fire(() => { sound('deal'); api.send({ type: 'pick', i: x.i }); });
              rerender();
            });
            return b;
          }));
        }
        reroll.el.hidden = !v.choose?.canReroll;
        reroll.paint();
      },
      destroy() { timer.destroy(); reroll.destroy(); mod.destroy(); },
    };
  }

  // ---------- body: play ----------

  /** Moderator tools (host seat only): +30 s, voiding a broken turn, and ruling on a team foul. */
  function modBar() {
    const plus = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '＋30 秒' });
    plus.addEventListener('click', () => { sound('tap'); api.send({ type: 'extend' }); });
    const voidBtn = confirmButton({
      cls: 'btn btn-ghost btn-sm dg-void',
      label: () => '作廢今輪',
      armedLabel: '確定作廢？再㩒一下',
      onConfirm: () => api.send({ type: 'void' }),
    });
    const yes = h('button', { class: 'btn btn-sm dg-rule-yes', type: 'button', text: '🚩 成立（今輪冇分）' });
    const no = h('button', { class: 'btn btn-ghost btn-sm dg-rule-no', type: 'button', text: '唔成立，繼續' });
    yes.addEventListener('click', () => { sound('deny'); api.send({ type: 'rule', uphold: true }); });
    no.addEventListener('click', () => { sound('tap'); api.send({ type: 'rule', uphold: false }); });
    const ruleRow = h('div', { class: 'dg-rule' }, yes, no);
    const el = h('div', { class: 'dg-mod' }, h('span', { class: 'dg-mod-tag', text: '主持' }), plus, voidBtn.el, ruleRow);
    return {
      el,
      update(v, c) {
        const ruling = !!(v.play?.ruling || v.reveal?.ruling);
        const voidable = v.phase === 'choose' || v.phase === 'play' || (v.phase === 'reveal' && v.reveal?.outcome !== 'voided');
        el.hidden = !v.mod || !(voidable || ruling);
        plus.hidden = v.phase !== 'play' || v.sub !== 'run';
        voidBtn.el.hidden = !voidable;
        ruleRow.hidden = !ruling;
        yes.disabled = no.disabled = !!c?.paused;
      },
      destroy() { voidBtn.destroy(); },
    };
  }

  /** Everybody sees why the clock stopped (team foul). */
  function rulingBanner() {
    const el = h('div', { class: 'dg-ruling', role: 'status' });
    el.hidden = true;
    return {
      el,
      update(r) {
        el.hidden = !r;
        el.textContent = r ? `🚩 ${nameOf(r.by)} 話畫家犯規 — 計時停咗，等主持裁決` : '';
      },
    };
  }

  /** 🚩: flag the drawer. Two taps; FFA shows the running count against the threshold. */
  function foulButton() {
    let sent = false;
    const btn = confirmButton({
      cls: 'btn btn-ghost btn-sm dg-foul',
      label: () => (sent ? '🚩 已舉報' : '🚩 犯規？'),
      armedLabel: '舉報犯規？再㩒一下',
      onConfirm: () => { sent = true; api.send({ type: 'foul' }); },
    });
    const count = h('span', { class: 'dg-foul-n' });
    const el = h('div', { class: 'dg-foulrow' }, btn.el, count);
    return {
      el,
      update(f, canFlag) {
        sent = f.mine || sent;
        btn.el.disabled = f.mine || !canFlag;
        btn.paint();
        count.textContent = f.n && f.need > 1 ? `${f.n}/${f.need}` : '';
        el.hidden = !canFlag && !f.mine && !(f.n && f.need > 1);
      },
      destroy() { btn.destroy(); },
    };
  }

  /** Typed guess feed. For the drawer it carries a ✔ per guess (override the checker). */
  function makeFeed(isDrawer, canAcceptNow) {
    const list = h('div', { class: 'dg-feed' + (isDrawer ? ' drawer' : '') });
    let sig = '';
    return {
      el: list,
      update(v) {
        const feed = v.feed ?? [];
        const open = canAcceptNow(v);
        const s = JSON.stringify([feed, open, v.me]);
        if (s === sig) return;
        sig = s;
        const rows = feed.slice().reverse().slice(0, isDrawer ? 20 : 12).map((g) => {
          const mine = g.pid === v.me;
          let text;
          let cls = g.kind;
          if (g.kind === 'right') text = isDrawer && g.text ? `${g.text}（已計）` : '✅ 估中咗！';
          else if (g.kind === 'close' || g.kind === 'near') {
            text = g.text ? `${g.text}${g.kind === 'near' ? '  方向啱喎' : '  好接近！'}` : '🔥 好接近！';
          } else text = g.text;
          const row = h('div', { class: `dg-feed-row ${cls}${mine ? ' me' : ''}` },
            h('span', { class: 'dg-feed-dot', style: `--seat:${colorOf(g.pid)}` }),
            h('span', { class: 'dg-feed-who', text: mine ? '你' : nameOf(g.pid) }),
            h('span', { class: 'dg-feed-text', text }));
          if (isDrawer && g.kind !== 'right' && open) {
            const ok = h('button', { class: 'dg-feed-ok', type: 'button', 'aria-label': `${nameOf(g.pid)} 估中`, text: '✔' });
            ok.addEventListener('click', () => { sound('tap'); api.send({ type: 'accept', gid: g.id }); });
            row.append(ok);
          }
          return row;
        });
        list.replaceChildren(...(rows.length ? rows : [h('div', { class: 'dg-feed-empty', text: isDrawer ? '未有人打答案' : '未有答案' })]));
      },
    };
  }

  /** The typed-guess input with IME-safe submit. */
  function guessInput() {
    let composing = false;
    let compEnd = 0;
    let lastSent = 0;
    let lockHandle = null;
    const input = h('input', {
      class: 'dg-input', type: 'text', lang: 'zh-HK', enterkeyhint: 'send', autocomplete: 'off', autocorrect: 'off',
      autocapitalize: 'off', spellcheck: 'false', maxlength: '60', placeholder: '打答案…', 'aria-label': '你嘅答案',
    });
    const send = h('button', { class: 'btn btn-primary dg-send', type: 'button', text: '送出' });
    const note = h('p', { class: 'dg-input-note' });
    const form = h('div', { class: 'dg-inputrow' }, input, send);
    const el = h('div', { class: 'dg-inputwrap' }, form, note);

    function submit() {
      if (composing || performance.now() - compEnd < 80) return;      // never send a half-composed string
      if (input.disabled) return;
      const text = input.value.trim();
      if (!text) return;
      if (Array.from(text).length > MAX_LEN) { api.toast(`太長喇，最多 ${MAX_LEN} 隻字`); return; }
      if (!/[\p{L}\p{N}]/u.test(text)) { api.toast('打啲字先得喎'); return; }      // an emoji-only guess would be dropped silently
      const t = performance.now();
      if (t - lastSent < MIN_GAP_MS) { api.toast('慢啲，等一等'); return; }
      lastSent = t;
      api.send({ type: 'guess', text });
      sound('tap');
      input.value = '';
      input.focus();                                                   // keep the keyboard up for the next guess
    }

    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; compEnd = performance.now(); });
    input.addEventListener('blur', () => { composing = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.isComposing || e.keyCode === 229 || composing) return;
      e.preventDefault();
      submit();
    });
    send.addEventListener('pointerdown', (e) => e.preventDefault());   // keep focus in the input
    send.addEventListener('click', submit);

    return {
      el,
      focusSoon() { later(() => { try { input.focus({ preventScroll: true }); } catch { /* not focusable yet */ } }, 50); },
      update(v, c) {
        const m = v.play?.mine;
        const lockMs = m?.lockUntil ? m.lockUntil - api.now() : 0;
        const locked = lockMs > 0;
        const paused = !!c?.paused;
        input.disabled = locked || paused || v.play?.sub !== 'run';
        send.disabled = input.disabled;
        note.textContent = paused ? '⏸ 暫停緊' : locked ? `打得太快，等 ${Math.ceil(lockMs / 1000)} 秒` : m ? `估錯唔扣分 · 已打 ${m.used}/${m.max}` : '';
        cancel(lockHandle);
        if (locked) lockHandle = later(rerender, Math.min(lockMs + 50, 1000));
      },
      destroy() { cancel(lockHandle); el.remove(); },
    };
  }

  /**
   * Shout mode, drawer: one chip per eligible guesser. The first tap opens the 3 s grace window (add co-winners,
   * undo a mis-tap); in the 2 s buzzer window after the deadline every tap scores the minimum and can be undone.
   */
  function guesserChips() {
    const head = h('div', { class: 'dg-chips-head' });
    const chips = h('div', { class: 'dg-chips' });
    const banner = h('div', { class: 'dg-grace' });
    const el = h('div', { class: 'dg-chipsbox' }, head, chips, banner);
    let sig = '';
    return {
      el,
      update(v, c) {
        const p = v.play;
        const paused = !!c?.paused;
        const grace = p.sub === 'grace';
        const buzzer = p.sub === 'buzzer';
        const ruling = p.sub === 'ruling';
        const undoable = grace || buzzer;
        head.textContent = ruling ? '🚩 等主持裁決…'
          : grace ? '✅ 確認緊 — 仲有人同時估中就加埋，揀錯可以撤銷'
            : buzzer ? '⏰ 時間到 — 最後一刻有人講啱，仲㩒得到'
              : '邊個估中？㩒佢個名';
        head.classList.toggle('hot', grace || buzzer);
        banner.hidden = !(undoable && p.solved.length);
        banner.textContent = undoable && p.solved.length ? `估中：${p.solved.map(nameOf).join('、')}` : '';
        const s = JSON.stringify([p.eligible, p.solved, p.sub, v.me, paused]);
        if (s === sig) return;
        sig = s;
        chips.replaceChildren(...p.eligible.map((pid) => {
          const done = p.solved.includes(pid);
          const btn = h('button', {
            class: 'dg-chip-guesser' + (done ? ' done' : ''), type: 'button', style: `--seat:${colorOf(pid)}`,
            disabled: paused || ruling || (done && !undoable),
          },
          h('span', { class: 'dg-chip-dot' }),
          h('span', { class: 'dg-chip-name', text: nameOf(pid) }),
          done ? h('span', { class: 'dg-chip-state', text: undoable ? '✅ ↩' : '✅' }) : null);
          btn.addEventListener('click', () => {
            if (done) { if (undoable) { sound('deny'); api.send({ type: 'undo-accept', target: pid }); } return; }
            sound('lock');
            api.send({ type: 'accept', target: pid });
          });
          return btn;
        }));
      },
    };
  }

  function playBody(role, v0) {
    const isDrawer = role === 'drawer';
    const typed = v0.guessMode === 'typed';
    const paper = v0.drawMode === 'paper';
    const canGuess = role === 'guesser';
    const timer = makeTimer();
    // the mask and the hints are public: the drawer's seat shows them too — on a single shared phone that IS the table's screen
    const mask = makeMask();
    const catChip = h('span', { class: 'dg-chip cat' });
    const solvedRow = h('div', { class: 'dg-solved' });
    const chipRow = h('div', { class: 'dg-hintrow' }, catChip, solvedRow);
    const peek = isDrawer ? makeWordPeek(paper) : null;
    const chips = isDrawer && !typed ? guesserChips() : null;
    const canvas = !paper ? makeCanvas(role, typed && canGuess) : null;
    const input = canGuess && typed ? guessInput() : null;
    const feed = typed ? makeFeed(isDrawer, (v) => v.phase === 'play' && v.sub === 'run') : null;
    const foul = !isDrawer ? foulButton() : null;
    const ruling = rulingBanner();
    const mod = modBar();
    const prompt = h('p', { class: 'dg-note' });
    const solvedBlock = h('div', { class: 'dg-youdid' }, '✅ 你估中咗！靜靜哋等其他人，千祈唔好講出答案。');
    const abandon = isDrawer ? confirmButton({
      cls: 'btn btn-ghost btn-sm dg-abandon',
      label: () => '🏳️ 放棄今輪（大家 0 分）',
      armedLabel: '確定放棄？再㩒一下',
      onConfirm: () => api.send({ type: 'abandon' }),
    }) : null;

    const top = h('div', { class: 'dg-top' }, timer.el);
    const el = h('div', { class: 'dg-stack dg-play' + (isDrawer ? ' is-drawer' : '') + (typed ? ' is-typed' : ''),
      'data-role': role },
    top,
    ruling.el,
    mask.el, chipRow,
    peek?.el,
    chips?.el,
    input?.el, solvedBlock,
    canvas?.el,
    feed?.el,
    prompt,
    foul?.el,
    abandon?.el,
    mod.el);
    input?.focusSoon();

    return {
      el,
      update(v, c) {
        const p = v.play;
        if (!p) return;
        timer.update(v, c, [10]);
        ruling.update(p.ruling);
        mask.set(p.mask);
        catChip.textContent = p.cat ? `類別：${p.cat}` : (v.hintsOn ? '類別：稍後提示' : '');
        catChip.classList.toggle('ghost', !p.cat);
        catChip.hidden = !p.cat && !v.hintsOn;
        const names = p.solved.map((pid) => seatName(pid, v.me));
        solvedRow.replaceChildren(...names.map((n) => h('span', { class: 'dg-chip ok', text: `✅ ${n}` })));
        chipRow.hidden = catChip.hidden && !names.length;
        if (peek && p.word) peek.set(p.word);
        chips?.update(v, c);
        canvas?.update(v, c);
        feed?.update(v);
        input?.update(v, c);
        const solved = !!p.mine?.solved;
        if (input) input.el.hidden = solved;
        solvedBlock.hidden = !(canGuess && solved);
        const sub = p.sub;
        prompt.textContent = isDrawer
          ? (paper ? '用紙筆畫，唔准講嘢、寫字同數字。' : '喺畫板上畫，唔准講嘢、寫字同數字。')
          : role === 'guesser'
            ? (solved ? '' : typed ? '' : `睇住${paper ? '張紙' : '個畫板'}，大聲講出你嘅答案，畫家會㩒你個名。`)
            : role === 'rival' ? `呢輪係 ${S.teamLabel(v.turn.team)} 畫同估，你唔使估；見到犯規可以㩒 🚩。` : '旁觀緊。';
        prompt.hidden = !prompt.textContent || (sub === 'grace' && isDrawer) || sub === 'ruling';
        foul?.update(p.foul, !!p.foul.can);
        if (abandon) { abandon.el.hidden = !(sub === 'run' || sub === 'buzzer'); abandon.paint(); }
        mod.update(v, c);
      },
      destroy() {
        timer.destroy(); peek?.destroy(); canvas?.destroy(); input?.destroy(); foul?.destroy(); abandon?.destroy(); mod.destroy();
      },
    };
  }

  // ---------- ranking rows (standings between cycles, and the end) ----------

  function rankRows(v) {
    if (v.teams) {
      const top = Math.max(...v.teams.map((t) => t.score));
      return v.teams.slice().sort((a, b) => b.score - a.score || a.i - b.i).map((t) => h('div', { class: 'dg-final-row' + (t.score === top ? ' lead' : '') },
        h('span', { text: `${t.score === top && top > 0 ? '🏆 ' : ''}${S.teamLabel(t.i)}` }), h('span', { class: 'dg-final-n', text: `${t.score} 分` })));
    }
    const top = Math.max(...Object.values(v.scores));
    const rows = api.players.filter((p) => p.id in v.scores).sort((a, b) => v.scores[b.id] - v.scores[a.id]);
    return rows.map((p) => h('div', { class: 'dg-final-row' + (v.scores[p.id] === top ? ' lead' : '') },
      h('span', { text: (v.scores[p.id] === top && top > 0 ? '🏆 ' : '') + seatName(p.id, v.me) }),
      h('span', { class: 'dg-final-n', text: `${v.scores[p.id]} 分` })));
  }

  /** 5 s leaderboard after every full cycle. */
  function standingsBody() {
    const head = h('h2', { class: 'dg-h' });
    const list = h('div', { class: 'dg-final' });
    const count = makeCountdown('下一圈');
    const next = h('p', { class: 'dg-note' });
    const el = h('div', { class: 'dg-stack dg-standings' }, head, list, next, count.el);
    let sig = '';
    return {
      el,
      update(v, c) {
        const st = v.standings ?? { cycle: 0, cycles: 0 };
        head.textContent = `第 ${st.cycle}/${st.cycles} 圈完 · 而家排名`;
        const s = JSON.stringify([v.scores, v.teams, v.me]);
        if (s !== sig) { sig = s; list.replaceChildren(...rankRows(v)); }
        next.textContent = v.upNext?.length ? `下一個畫：${seatName(v.upNext[0], v.me)}` : '';
        next.hidden = !next.textContent;
        count.update(v, c);
      },
      destroy() { count.destroy(); },
    };
  }

  // ---------- body: reveal ----------

  function revealBody(role) {
    const isDrawer = role === 'drawer';
    const timer = makeCountdown();
    const headline = h('div', { class: 'dg-reveal-head' });
    const word = h('div', { class: 'dg-reveal-word' });
    const meta = h('div', { class: 'dg-reveal-meta' });
    const pts = h('div', { class: 'dg-reveal-pts' });
    const fouled = h('div', { class: 'dg-reveal-foul' });
    const ruling = rulingBanner();
    const paperNote = h('p', { class: 'dg-note', text: '睇返張紙上嘅畫，對吓答案。' });
    const canvas = view?.drawMode === 'canvas' ? makeCanvas('viewer', false, 'reveal') : null;
    const foul = !isDrawer ? foulButton() : null;
    const feed = isDrawer && view?.guessMode === 'typed' ? makeFeed(true, (v) => !!v.reveal && api.now() < v.reveal.lateUntil && ['solved', 'timeout'].includes(v.reveal.outcome)) : null;
    const mod = modBar();
    const wait = h('p', { class: 'dg-note' });
    let lateHandle = null;
    const el = h('div', { class: 'dg-stack dg-reveal' }, headline, ruling.el, h('div', { class: 'dg-reveal-card' }, word, meta),
      pts, fouled, canvas?.el, view?.drawMode === 'paper' ? paperNote : null, feed ? h('div', { class: 'dg-late' }, h('p', { class: 'dg-note', text: '估中咗但系統漏咗？㩒 ✔ 補返（幾秒內）。' }), feed.el) : null,
      timer.el, foul?.el, wait, mod.el);
    later(() => sound('reveal'), 300);
    return {
      el,
      update(v, c) {
        const rv = v.reveal;
        if (!rv) return;
        timer.update(v, c);
        canvas?.update(v, c);
        ruling.update(rv.ruling);
        headline.textContent = rv.headline;
        word.textContent = rv.w || '（未揀詞）';
        word.classList.toggle('long', Array.from(rv.w || '').length > 6);
        meta.textContent = rv.w
          ? `${S.stars(rv.level)} ${S.LEVEL_NAME[rv.level]}${rv.cat ? ` · ${rv.cat}` : ''}${rv.alt.length ? ` · 都啱：${rv.alt.slice(0, 5).join('／')}` : ''}`
          : '';
        pts.textContent = rv.points;
        pts.hidden = !rv.points;
        fouled.textContent = rv.fouled && rv.outcome === 'solved' ? (v.teams ? '🚩 犯規成立：今輪冇分' : '🚩 犯規成立：畫家今輪冇分')
          : (!rv.fouled && rv.flags && !rv.ruling ? (v.teams ? '🚩 有人舉報，主持判唔成立' : `🚩 ${rv.flags} 人舉報（未夠數）`) : '');
        fouled.hidden = !fouled.textContent;
        const open = api.now() < rv.lateUntil;
        cancel(lateHandle);
        if (open) lateHandle = later(rerender, Math.max(50, rv.lateUntil - api.now() + 50));
        if (feed) feed.update(v);
        if (foul) {
          foul.update(rv.foul, open && !!rv.foul.can);
          if (!open) foul.el.hidden = true;
        }
        wait.textContent = rv.ruling ? '' : v.last ? '幾秒後睇成績…' : '幾秒後自動下一位…';
        wait.hidden = !wait.textContent;
        mod.update(v, c);
      },
      destroy() { cancel(lateHandle); timer.destroy(); canvas?.destroy(); foul?.destroy(); mod.destroy(); },
    };
  }

  // ---------- body: over ----------

  function overBody() {
    const list = h('div', { class: 'dg-final' });
    const el = h('div', { class: 'dg-stack' }, h('h2', { class: 'dg-h', text: '遊戲完' }), list);
    return {
      el,
      update(v) { list.replaceChildren(...rankRows(v)); },
      destroy() {},
    };
  }

  function makeBody(v) {
    switch (v.phase) {
      case 'choose': return chooseBody(v.role);
      case 'play': return playBody(v.role, v);
      case 'reveal': return revealBody(v.role);
      case 'standings': return standingsBody();
      default: return overBody();
    }
  }

  // ---------- sounds: only on CHANGES, never on the first paint or a re-mount ----------

  const revealedCount = (v) => (v.play?.mask?.cells ?? []).filter((c) => c && c !== ' ').length + (v.play?.cat ? 1 : 0);

  function noteChanges(v) {
    const cur = { turn: `${v.turn.n}${v.turn.again ? 'a' : ''}`, phase: v.phase, solved: v.play?.solved.length ?? 0, hints: revealedCount(v), sub: v.play?.sub ?? '',
      ruling: !!(v.play?.ruling || v.reveal?.ruling) };
    const b = baseline;
    baseline = cur;
    if (!b || b.turn !== cur.turn) return;
    if (cur.ruling && !b.ruling) sound('deny');
    if (v.phase === 'play' && cur.solved > b.solved) sound('reveal');
    if (v.phase === 'play' && cur.hints > b.hints) sound('join');
    if (v.phase === 'reveal' && b.phase === 'play' && v.reveal) {
      const mineSolved = v.reveal.solvers.some((x) => x.pid === v.me);
      if (v.reveal.outcome === 'solved') sound(mineSolved ? 'win' : 'reveal');
    }
  }

  // ---------- update / destroy ----------

  return {
    update(nextView, nextCtx) {
      view = nextView;
      ctx = nextCtx ?? {};
      if (!view) return;
      noteChanges(view);
      paintScores(view);
      const key = [view.phase, view.turn.n, view.turn.again ? 1 : 0, view.role, view.drawMode, view.guessMode].join('|');
      if (key !== bodyKey) {
        body?.destroy();
        body = makeBody(view);
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
