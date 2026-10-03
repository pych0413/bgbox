// ============================================================
// undercover/ui.js — 誰是臥底: what a phone shows in every phase.
//
//   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view and idempotent: the same view twice changes nothing. Only
// api.components (RoleCard, VotePanel, Timer) and the dom helper are used.
// The shell mounts one UI per seat, so api.me is always the seat on screen.
// The word card and the guess box live as long as their screen, so a half-peeked
// card or half-typed guess survives every update; a screen is rebuilt only when
// the step itself changes (its `key`).
//
// The phases and the wording: docs/games/undercover.md.
// ============================================================

import { el } from '../../ui/dom.js?v=20261003075613';

const ROLE = {
  civilian: { emoji: '🧑', name: '平民' },
  undercover: { emoji: '🕵️', name: '臥底' },
  blank: { emoji: '⬜', name: '白板' },
};
const ACCENT = '#a78bfa';
/** Why a vote put nobody out (engine `elim.reason`). */
const NO_OUT = { nobody: '冇人投票', nomajority: '冇人過半數', alltied: '全部人同票', pktie: 'PK 再平票', tie: '平票' };
const BANNER = { civilians: ['is-civ', '🧑 平民贏！'], infiltrators: ['is-inf', '🕵️ 臥底方贏！'], blank: ['is-inf', '⬜ 白板贏！'] };
const LOCKOUT_MS = 1500;           // 繼續 stays dead this long after a result appears, so a stray tap cannot skip it

export function mount(root, api) {
  const C = api.components;
  const sfx = (name) => { try { api.sfx?.(name); } catch { /* sound is a bonus */ } };

  let view = null;
  let ctx = {};
  let screen = null;                 // { key, el, update(view, ctx), destroy() }
  let lastSpeakStep = null;
  let relaxedShown = false;
  let locked = false;                // the word card's lock
  let wordOpen = false;              // the 睇返我個詞 panel

  // ---------- page skeleton ----------
  const counts = el('p', { class: 'uc-counts' });
  const seatsBox = el('div', { class: 'uc-seats', role: 'list' });
  const body = el('div', { class: 'uc-body' });
  const wordBox = el('div', { class: 'uc-word' });
  const page = el('div', { class: 'uc' }, counts, seatsBox, body, wordBox);
  root.replaceChildren(page);

  // ---------- helpers ----------
  const players = () => api.players ?? [];
  const byId = (id) => players().find((p) => p.id === id);
  const nameOf = (id) => byId(id)?.name ?? '?';
  const namesOf = (ids) => ids.map(nameOf).join('、');
  const meId = () => view?.me?.id ?? api.me ?? null;

  /** More than one seat on this phone? Then it is passed around, and every public control goes to whoever holds it. */
  function sharedDevice() {
    const me = byId(meId());
    if (!me?.deviceId) return false;
    return players().filter((p) => p.deviceId === me.deviceId).length > 1;
  }

  /** "That is you" only means something on a phone of your own; on a shared one the seat on screen is just whoever held it last. */
  const isMe = (id) => id != null && id === meId() && !sharedDevice();

  const roleChip = (role) => (role && ROLE[role]
    ? el('span', { class: `uc-role uc-role-${role}` }, `${ROLE[role].emoji} ${ROLE[role].name}`)
    : null);

  function button(label, onClick, cls = 'btn btn-primary btn-lg') {
    const b = el('button', { class: cls, type: 'button' }, label);
    b.addEventListener('click', () => { sfx('tap'); onClick(); });
    return b;
  }

  const dot = (id) => el('span', { class: 'uc-dot', style: { '--seat': byId(id)?.color ?? ACCENT } });

  // ---------- the word card (one instance, moved between places) ----------
  function wordRole() {
    const w = view?.me?.word;
    return {
      emoji: '🃏',
      name: w ?? '白板',                         // same size, same place: only the text tells the white card apart
      team: 'word',
      color: ACCENT,
      teamLabel: '',
      text: w != null ? '用一句嘢形容佢，但唔好直接講出嚟。' : '你冇詞語。聽清楚其他人點形容，扮到似有。',
    };
  }

  function cardProps() {
    return {
      role: wordRole(),
      locked,
      onLockToggle: () => { locked = !locked; paintCard(); },
      // On a passed-around phone every peek ends locked again, so the next person to hold it sees nothing.
      onOpen: (open) => { if (!open && sharedDevice() && !locked) { locked = true; paintCard(); } },
    };
  }

  const card = C.RoleCard({ role: null, locked: false });

  function paintCard() {
    if (view?.me) card.update(cardProps());
  }

  function placeCard(container) {
    if (card.el.parentNode === container) return;
    card.close();
    container.append(card.el);
  }

  // ---------- timer slot ----------
  function timerSlot() {
    const box = el('div', { class: 'uc-timer' });
    let t = null;
    return {
      el: box,
      update(v, c) {
        if (typeof v.deadline !== 'number' || !v.timerLabel) {
          t?.destroy();
          t = null;
          box.hidden = true;
          return;
        }
        box.hidden = false;
        const props = {
          deadline: v.deadline,
          now: api.now,
          label: v.timerLabel,
          paused: !!c.paused,
          warnAt: v.timerLabel === '討論' ? [60, 10] : [10],
        };
        if (!t) { t = C.Timer(props); box.append(t.el); } else t.update(props);
      },
      destroy() { t?.destroy(); t = null; },
    };
  }

  // ============================================================
  // screens
  // ============================================================

  // ---- deal: look at your word, tap 記住喇 ----
  function dealScreen() {
    const lead = el('p', { class: 'uc-lead', text: '㩒住張卡先睇到，放手即刻冚返。記住就㩒「記住喇」。' });
    const slot = el('div', { class: 'uc-cardslot' });
    const action = el('div', { class: 'uc-action' });
    const note = el('p', { class: 'uc-note' });
    const status = el('p', { class: 'uc-status' });
    const box = el('section', { class: 'uc-screen' }, el('h2', { class: 'uc-title', text: '你嘅詞語' }), lead, slot, action, status, note);
    let readyShown = null;

    function remember() {
      locked = true;                        // lock the card the moment you are done with it
      sfx('lock');
      paintCard();
      api.send({ type: 'ready' });
    }

    return {
      el: box,
      update(v) {
        const me = v.me;
        slot.hidden = !me;
        if (!me) {
          lead.textContent = '大家逐個睇緊自己嘅詞語，你係旁觀者。';
          action.replaceChildren();
          note.textContent = '';
        } else {
          placeCard(slot);
          if (readyShown !== me.ready) {
            readyShown = me.ready;
            action.replaceChildren(me.ready ? el('p', { class: 'uc-done' }, '✓ 你已經記住咗') : button('記住喇 ✓', remember));
          }
          lead.hidden = me.ready;
          note.textContent = me.ready
            ? '想再睇一次？㩒 🔓 解鎖，睇完記得再鎖返。'
            : '記住之後張卡會自動鎖住，唔怕隔離個人㩒到。';
        }
        const waiting = v.seats.filter((s) => !v.deal.ready.includes(s.id)).map((s) => s.id);
        status.textContent = waiting.length
          ? `已有 ${v.deal.ready.length} / ${v.deal.total} 人記住咗 · 等緊：${namesOf(waiting)}`
          : '大家都記住喇，即刻開始！';
      },
      destroy() {},
    };
  }

  // ---- speak: whose turn it is ----
  function speakScreen() {
    const who = el('div', { class: 'uc-who' });
    const sub = el('p', { class: 'uc-sub' });
    const timer = timerSlot();
    const hint = el('p', { class: 'uc-note' });
    const order = el('ol', { class: 'uc-order' });
    const action = el('div', { class: 'uc-action' });
    const box = el('section', { class: 'uc-screen' }, who, sub, timer.el, action, hint, order);
    let actionStep = null;

    return {
      el: box,
      update(v, c) {
        const sp = v.speak;
        const mine = isMe(sp.pid);
        who.className = `uc-who${mine ? ' is-me' : ''}`;
        who.replaceChildren(dot(sp.pid), el('strong', {}, mine ? '輪到你講！' : `${nameOf(sp.pid)} 講緊…`));
        sub.textContent = sp.kind === 'pk'
          ? `PK 發言 · 第 ${sp.turn + 1} / ${sp.order.length} 個`
          : `第 ${v.round} 輪 · 第 ${sp.turn + 1} / ${sp.order.length} 個`;
        timer.update(v, c);
        hint.textContent = sp.kind === 'pk'
          ? '平票嘅人再講多一句：點解你唔係臥底？'
          : '一人一句。唔可以講出個詞，或者入面任何一個字。';
        order.replaceChildren(...sp.order.map((id, i) => el('li', {
          class: `uc-order-item${i < sp.turn ? ' is-done' : ''}${i === sp.turn ? ' is-now' : ''}${isMe(id) ? ' is-me' : ''}`,
        }, dot(id), el('span', { class: 'uc-order-name' }, nameOf(id)), i < sp.turn ? el('span', { class: 'uc-order-tick' }, '✓') : null)));

        if (actionStep !== sp.id) {
          actionStep = sp.id;
          const canDone = v.me && (mine || sharedDevice());
          action.replaceChildren(canDone
            ? button(mine ? '講完喇 ▸' : `${nameOf(sp.pid)} 講完喇 ▸`, () => api.send({ type: 'done', at: sp.id }))
            : (v.me && !v.me.alive ? el('p', { class: 'uc-note' }, '你已經出局，聽住大家講。') : ''));
        }
      },
      destroy() { timer.destroy(); },
    };
  }

  // ---- discuss ----
  function discussScreen() {
    const timer = timerSlot();
    const action = el('div', { class: 'uc-action' });
    const box = el('section', { class: 'uc-screen' },
      el('h2', { class: 'uc-title', text: '自由討論' }),
      el('p', { class: 'uc-lead', text: '大家都講完喇。邊個最似臥底？傾夠就開始投票。' }),
      timer.el, action);
    let built = false;
    return {
      el: box,
      update(v, c) {
        timer.update(v, c);
        if (built) return;
        built = true;
        action.replaceChildren(v.me
          ? button('開始投票 🗳️', () => api.send({ type: 'start-vote' }))
          : el('p', { class: 'uc-note' }, '等大家開始投票。'));
      },
      destroy() { timer.destroy(); },
    };
  }

  // ---- vote ----
  function voteScreen() {
    const title = el('h2', { class: 'uc-title' });
    const lead = el('p', { class: 'uc-lead' });
    const timer = timerSlot();
    const panelSlot = el('div', { class: 'uc-panel' });
    const wait = el('p', { class: 'uc-status' });
    const box = el('section', { class: 'uc-screen' }, title, lead, timer.el, panelSlot, wait);
    let panel = null;

    return {
      el: box,
      update(v, c) {
        const vt = v.vote;
        const me = v.me;
        const pk = vt.kind === 'pk';
        title.textContent = pk ? 'PK 投票' : '投票';
        timer.update(v, c);
        if (me?.canVote) {
          lead.textContent = pk
            ? `只可以投 ${namesOf(vt.candidates)} 其中一個${vt.candidates.includes(me.id) ? '（你自己都要投對方）' : ''}。`
            : '揀你覺得係臥底嘅人，唔可以投自己。全部人投晒先會公佈。';
          const props = {
            players: players(),
            candidates: me.targets,
            me: me.id,
            myVote: me.myVote,
            allowAbstain: !!v.flags.abstain,
            progress: { done: vt.done.length, total: vt.total },
            reveal: null,
            onVote: (target) => api.send({ type: 'vote', target }),
          };
          if (!panel) { panel = C.VotePanel(props); panelSlot.append(panel.el); } else panel.update(props);
          panelSlot.hidden = false;
        } else {
          if (!me) lead.textContent = '大家投緊票。';
          else if (me.alive) lead.textContent = '你喺 PK 入面，今次唔使投，等其他人決定。';
          else lead.textContent = '你已經出局，唔使投票，睇住大家投。';
          panel?.destroy();
          panel = null;
          panelSlot.hidden = true;
        }
        const pending = vt.voters.filter((id) => !vt.done.includes(id));
        wait.textContent = pending.length
          ? `已投 ${vt.done.length} / ${vt.total} · 仲未投：${namesOf(pending)}`
          : '投晒喇，公佈緊…';
      },
      destroy() { timer.destroy(); panel?.destroy(); },
    };
  }

  // ---- elim: the result of the vote ----
  function elimScreen() {
    const title = el('h2', { class: 'uc-title' });
    const panelSlot = el('div', { class: 'uc-panel' });
    const verdict = el('div', { class: 'uc-verdict' });
    const guessBox = el('div', { class: 'uc-guess' });
    const timer = timerSlot();
    const action = el('div', { class: 'uc-action' });
    const box = el('section', { class: 'uc-screen' }, title, verdict, guessBox, timer.el, panelSlot, action);

    let panel = null;
    let input = null;
    let submit = null;
    let guessMode = null;             // 'write' | 'wait' | 'done' | null
    let unlocked = false;             // the lockout on 繼續 is over
    let waiting = false;
    let canContinue = false;
    const proceed = button('繼續 ▸', () => api.send({ type: 'continue' }));
    proceed.disabled = true;
    action.append(proceed);
    const unlockTimer = setTimeout(() => { unlocked = true; paintProceed(); }, LOCKOUT_MS);

    function paintProceed() {
      proceed.hidden = waiting || !canContinue;
      proceed.disabled = !unlocked;
    }

    function paintVerdict(e, v) {
      const kids = [];
      if (e.kind === 'out') {
        kids.push(el('div', { class: 'uc-out' }, dot(e.out), el('strong', {}, `${nameOf(e.out)} 出局`)));
        kids.push(e.role ? roleChip(e.role) : el('span', { class: 'uc-role uc-role-hidden' }, '身份唔公開'));
        if (e.forced) kids.push(el('p', { class: 'uc-note' }, '連續幾輪冇人出局，今次隨機抽中。'));
        else if (e.random) kids.push(el('p', { class: 'uc-note' }, 'PK 再投都平票，隨機抽中。'));
        if (isMe(e.out) && !e.guess?.pending) kids.push(el('p', { class: 'uc-note' }, '你出局喇。可以繼續睇住，但唔使再講嘢或者投票。'));
      } else if (e.kind === 'pk') {
        kids.push(el('div', { class: 'uc-out' }, el('strong', {}, `平票！${namesOf(e.cands)} 同票`)));
        kids.push(el('p', { class: 'uc-note' }, v.flags.pkVoters === 'others'
          ? '佢哋要再講多一句，然後其他人只喺佢哋之間再投一次。'
          : '佢哋要再講多一句，然後全部人只喺佢哋之間再投一次。'));
      } else {
        kids.push(el('div', { class: 'uc-out' }, el('strong', {}, `${NO_OUT[e.reason] ?? '平票'}，今輪冇人出局`)));
        kids.push(el('p', { class: 'uc-note' }, '剩低嘅人繼續下一輪。'));
      }
      verdict.replaceChildren(...kids);
    }

    function sendGuess() {
      if (!input) return;
      submit.disabled = true;
      api.send({ type: 'guess', word: input.value });
    }

    function paintGuess(e, v) {
      const g = e.guess;
      if (!g) { guessMode = null; guessBox.replaceChildren(); guessBox.hidden = true; return; }
      guessBox.hidden = false;
      const mode = g.pending ? (v.me?.mustGuess ? 'write' : 'wait') : 'done';
      if (mode === 'write') {
        if (guessMode !== 'write') {
          guessMode = 'write';
          input = el('input', {
            class: 'uc-guess-input', type: 'text', maxlength: '20', autocomplete: 'off', autocapitalize: 'off',
            autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done', placeholder: '打出你覺得嘅平民詞語',
            'aria-label': '平民詞語',
          });
          submit = button('提交答案', sendGuess, 'btn btn-primary');
          input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); sendGuess(); } });
          const who = v.flags.guessWinner === 'blank' ? '你自己' : '臥底方';
          guessBox.replaceChildren(
            el('p', { class: 'uc-lead' }, `你係白板！你有一次機會估平民個詞，估中${who}即刻贏。`),
            input, submit,
            el('p', { class: 'uc-note' }, '要同個詞一樣先算（例如「士多啤梨」）。想放棄就留空再㩒。'));
        }
      } else if (mode === 'wait') {
        guessMode = 'wait';
        guessBox.replaceChildren(el('p', { class: 'uc-lead' }, `白板 ${nameOf(e.out)} 諗緊平民個詞…`));
      } else {
        guessMode = 'done';
        const silent = g.timeout || !g.word;
        guessBox.replaceChildren(
          el('p', { class: 'uc-lead' }, silent ? `白板 ${nameOf(e.out)} 冇作答，當估錯。` : `白板 ${nameOf(e.out)} 估「${g.word}」`),
          silent ? null : el('p', { class: `uc-guess-result ${g.correct ? 'is-right' : 'is-wrong'}` }, g.correct ? '估中喇！🎯' : '唔啱 ✗'));
      }
    }

    return {
      el: box,
      update(v, c) {
        const e = v.elim;
        title.textContent = e.voteKind === 'pk' ? 'PK 投票結果' : '投票結果';
        if (!panel) {
          panel = C.VotePanel({
            players: players(),
            candidates: Object.keys(e.counts),
            me: meId(),
            reveal: { counts: e.counts, top: e.top, votes: e.ballots },
          });
          panelSlot.append(panel.el);
        }
        paintVerdict(e, v);
        paintGuess(e, v);
        timer.update(v, c);
        waiting = !!e.guess?.pending;
        canContinue = !!v.me;
        paintProceed();
      },
      destroy() {
        clearTimeout(unlockTimer);
        timer.destroy();
        panel?.destroy();
      },
    };
  }

  // ---- over: everything is revealed ----
  function overScreen() {
    const box = el('section', { class: 'uc-screen uc-over' });
    let painted = false;
    return {
      el: box,
      update(v) {
        if (painted) return;
        painted = true;
        const o = v.over;
        const [bannerCls, bannerText] = BANNER[o.side] ?? BANNER.infiltrators;
        const rows = o.rows.map((r) => el('li', { class: `uc-row${r.alive ? '' : ' is-out'}${isMe(r.id) ? ' is-me' : ''}` },
          dot(r.id),
          el('span', { class: 'uc-row-name' }, nameOf(r.id)),
          roleChip(r.role),
          el('span', { class: 'uc-row-word' }, r.word ?? '（冇詞語）'),
          el('span', { class: 'uc-row-out' }, r.outRound ? `第 ${r.outRound} 輪出局` : '一直生還')));
        box.replaceChildren(
          el('h2', { class: `uc-banner ${bannerCls}` }, bannerText),
          el('p', { class: 'uc-lead' }, o.reason),
          el('div', { class: 'uc-words' },
            el('div', { class: 'uc-word-pill' }, el('small', {}, '平民詞語'), el('strong', {}, o.civ)),
            o.und ? el('div', { class: 'uc-word-pill' }, el('small', {}, '臥底詞語'), el('strong', {}, o.und)) : null),
          el('ul', { class: 'uc-rows' }, rows),
          el('p', { class: 'uc-note' }, '臥底同平民都唔知自己個詞係咪同大家唔同 — 呢個就係好玩嘅地方。'));
      },
      destroy() {},
    };
  }

  // ============================================================
  // routing
  // ============================================================

  function screenKey(v) {
    switch (v.phase) {
      case 'deal': return 'deal';
      case 'speak': return `speak:${v.round}:${v.speak.kind}`;
      case 'discuss': return `discuss:${v.round}`;
      case 'vote': return `vote:${v.round}:${v.vote.kind}:${v.history.length}`;
      case 'elim': return `elim:${v.elim.seq}`;
      default: return 'over';
    }
  }

  function build(v) {
    switch (v.phase) {
      case 'deal': return dealScreen();
      case 'speak': return speakScreen();
      case 'discuss': return discussScreen();
      case 'vote': return voteScreen();
      case 'elim': return elimScreen();
      default: return overScreen();
    }
  }

  function paintHeader(v) {
    const c = v.counts;
    counts.textContent = `今局：平民 ${c.civilians}${c.undercovers ? ` · 臥底 ${c.undercovers}` : ''}${c.blanks ? ` · 白板 ${c.blanks}` : ''}`;
    const outs = new Map(v.outs.map((o) => [o.pid, o.role]));
    const speaking = v.phase === 'speak' ? v.speak : null;
    seatsBox.replaceChildren(...v.seats.map((s) => {
      const p = byId(s.id);
      const cls = ['uc-seat'];
      if (!s.alive) cls.push('is-out');
      if (speaking?.pid === s.id) cls.push('is-turn');
      if (speaking?.spoke.includes(s.id)) cls.push('is-spoke');
      if (isMe(s.id)) cls.push('is-me');
      const role = !s.alive ? outs.get(s.id) : null;
      return el('span', { class: cls.join(' '), role: 'listitem', style: { '--seat': p?.color ?? ACCENT } },
        el('i', { class: 'uc-dot' }),
        el('span', {}, p?.name ?? '?'),
        role ? el('em', {}, ROLE[role].emoji) : null);
    }));
  }

  /**
   * 睇返我個詞 once the deal is over. A phone with its own screen: a collapsible card.
   * A passed-around phone: the same card, but it re-locks after every peek and says whose it is,
   * because the seat on screen is whoever last held the phone.
   */
  let wordInner = null;
  let wordToggle = null;

  function paintWordPanel(v) {
    const show = !!v.me && v.phase !== 'deal' && v.phase !== 'over';
    wordBox.hidden = !show;
    if (!show) { if (wordInner && wordBox.contains(card.el)) card.close(); return; }
    if (!wordInner) {
      wordToggle = el('button', { class: 'btn btn-ghost btn-sm uc-wordtoggle', type: 'button' });
      wordInner = el('div', { class: 'uc-wordinner' });
      wordToggle.addEventListener('click', () => {
        sfx('tap');
        wordOpen = !wordOpen;
        if (wordOpen && sharedDevice()) { locked = true; paintCard(); }
        paintWordPanel(view);
      });
      wordBox.replaceChildren(wordToggle, wordInner);
    }
    const shared = sharedDevice();
    wordToggle.textContent = wordOpen
      ? '🃏 收埋個詞'
      : (shared ? `🃏 睇返我個詞（淨係 ${nameOf(v.me.id)} 本人好㩒）` : '🃏 睇返我個詞');
    wordInner.hidden = !wordOpen;
    if (wordOpen) placeCard(wordInner); else card.close();
  }

  function render() {
    if (!view) return;
    const v = view;
    const key = screenKey(v);
    if (!screen || screen.key !== key) {
      const prev = screen;
      const next = build(v);
      next.key = key;
      card.close();                                   // never carry a face-up card into the next step
      prev?.destroy();
      screen = next;
      body.replaceChildren(next.el);
      if (prev?.key.startsWith('vote') && key.startsWith('elim')) sfx('reveal');   // the same sound whoever is out
      window.scrollTo?.(0, 0);
    }
    paintHeader(v);
    paintCard();
    screen.update(v, ctx);
    paintWordPanel(v);

    const step = v.phase === 'speak' ? v.speak.id : null;
    if (step && step !== lastSpeakStep && isMe(v.speak.pid)) sfx('join');           // your turn
    lastSpeakStep = step;
    if (v.relaxed && !relaxedShown) { relaxedShown = true; api.toast?.('所揀類別嘅詞已經冇晒，今局用咗其他類別'); }
  }

  return {
    update(nextView, nextCtx) {
      if (!nextView) return;
      view = nextView;
      ctx = nextCtx || {};
      render();
    },
    destroy() {
      screen?.destroy();
      screen = null;
      card.destroy();
      root.replaceChildren();
    },
  };
}
