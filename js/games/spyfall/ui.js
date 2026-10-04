// ============================================================
// 間諜 Spyfall — game UI.   mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view any number of
// times. Three things are persistent so a gesture is never torn away:
//   · the RoleCard (a finger may be holding it open)
//   · the Timer
//   · the accusation PlayerPicker while it is open
// Everything else is plain buttons in sections that rebuild only when their
// own inputs change (a signature check), so a tap in flight survives an
// unrelated update.
//
// Only api.components (RoleCard, Timer, PlayerPicker) and plain DOM are used.
// Flow, screens and wording: docs/games/spyfall.md.
// ============================================================

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) n.style.setProperty(sk, sv);
        else n.style[sk] = sv;
      }
    } else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const WITH_CARD = new Set(['reveal', 'play', 'vote', 'tally', 'guess']);
const AWAY = '💤 房主當咗你唔喺度。返咗嚟就叫房主加返你。';
const END_DELAY_S = 2;       // the 睇完 button wakes up this many seconds after the reveal appears (counted down on screen)
const SEEN_RETRY_MS = 4000;  // a 睇完 the host never confirmed comes back as a button after this long
const GUESS_UNDO_S = 3;      // one phone: a picked place is sent after this many seconds unless 撤銷 is tapped (re-run N3)

export function mount(root, api) {
  const { RoleCard, Timer, PlayerPicker } = api.components;

  let view = null;
  let ctx = {};
  const st = {
    round: 0,
    strikes: new Set(),      // local strike-through, location indices
    listOpen: true,
    mode: 'main',            // play actions: 'main' | 'accuse' | 'spy'
    sel: [],                 // accusation picker selection
    pick: null,              // location chosen by the guessing spy
    pending: null,           // one phone: { loc, left, n } — picked, sent when `left` reaches 0 unless 撤銷 (re-run N3)
    sentReady: false,
    seat: null,
    endFor: 0,               // round whose reveal has started its delay
    endLeft: 0,              // seconds until 睇完 wakes up (shown as a countdown)
    seenFor: 0,              // round whose 睇完 this phone already sent
    phase: null,
    holder: null,
  };
  const timeouts = new Set();
  const later = (fn, ms) => {
    const t = setTimeout(() => { timeouts.delete(t); fn(); }, ms);
    timeouts.add(t);
  };

  // ---------- lookups ----------
  const pl = (pid) => api.players.find((p) => p.id === pid);
  const nameOf = (pid) => pl(pid)?.name ?? '?';
  const colorOf = (pid) => pl(pid)?.color ?? 'var(--cheese, #f5c518)';
  const me = () => view?.mine?.pid ?? api.me;
  const away = (pid) => !!view?.absent?.includes(pid);
  // ---- one phone (DESIGN §7.1) ----
  /** This phone holds 2+ playing seats: the whole table reads it, so it never says 「你」 to them (#20). */
  const shared = () => api.shared === true;
  /** …and it lies in the middle of the table now (no seat on screen): the public table screen. */
  const atTable = () => shared() && api.me == null;
  /** …and it holds every seated player: one tap there is the table's (U5). */
  const wholeTable = () => atTable() && api.wholeTable === true;
  /** U3: the seat on screen took the phone after 🛑 停鐘 → 「邊個要停鐘？」 (api.askWho). */
  const askedStop = () => ctx.asked?.key === 'stop';
  /** May this screen accuse / reveal? A phone of its own always; a shared phone only through 🛑 (#13). */
  const canAct = () => !shared() || askedStop();
  /** A public one-person step on a shared phone (the 舉手 reporter, a revealed spy): no role card on screen (#4). */
  const openStep = () => shared() && ctx.focus?.open === true;
  /** 💤 = the host marked the seat absent (public): it is never waited on. */
  const seatName = (pid) => nameOf(pid) + (pid === me() && !shared() ? '（你）' : '') + (away(pid) ? ' 💤' : '');
  /** The other seats this same phone holds (a passed-round phone): one 睇完 counts for all of them. */
  const deviceMates = () => {
    const dev = pl(me())?.deviceId;
    return dev ? api.players.filter((p) => p.deviceId === dev && p.id !== me()).map((p) => p.id) : [];
  };
  const locName = (i) => view.locations[i]?.name ?? '?';
  const send = (action) => api.send(action);
  /** A table control: on the shared phone in the middle it is a whole-table tap (api.tableSend), else the seat's own. */
  const sendT = (action) => (atTable() ? (ctx.tableLocked ? false : api.tableSend?.(action) ?? false) : api.send(action));

  const keyed = (node) => {
    let last = null;
    return (key, build) => {
      const k = JSON.stringify(key);
      if (k === last) return false;
      last = k;
      node.replaceChildren(...[].concat(build()).flat(Infinity).filter(Boolean));
      return true;
    };
  };

  const btn = (label, cls, onclick, extra = {}) => h('button', { type: 'button', class: `btn ${cls || ''}`, onclick, ...extra }, label);
  const who = (pid) => h('span', { class: 'sf-chip', style: { '--seat': colorOf(pid) } }, h('i', { class: 'dot' }), seatName(pid));

  // ---------- skeleton ----------
  const timer = Timer({ deadline: null, now: () => api.now(), label: '剩餘時間', warnAt: [60, 10] });
  const roleCard = RoleCard({ role: null, hint: '㩒住先睇到，放手即刻冚返' });
  let picker = null;

  const headBox = h('div', { class: 'sf-head' });
  const bannerBox = h('div', { class: 'sf-banner-wrap' });
  // During play the clock is a compact bar that stays stuck under the app header while the location list
  // scrolls, with a 🙋 shortcut on every seat's phone (the same on every phone: who has accused is public).
  const clockAct = h('div', { class: 'sf-clock-act' });
  const timerBox = h('div', { class: 'sf-clock' }, timer.el, clockAct);
  const frozenBox = h('div', { class: 'sf-frozen' });
  const readyBox = h('div', { class: 'sf-ready' });
  const floorBox = h('section', { class: 'card sf-floor' });
  const actionBox = h('div', { class: 'sf-actions' });
  const pickerHost = h('div', { class: 'sf-picker' });
  const logBox = h('div', { class: 'sf-log' });
  const voteBox = h('section', { class: 'card sf-vote' });
  const tallyBox = h('section', { class: 'card sf-tally' });
  const guessBox = h('section', { class: 'card sf-guess' });
  const stage = h('div', { class: 'sf-stage' }, readyBox, floorBox, actionBox, pickerHost, logBox, voteBox, tallyBox, guessBox);
  const cardBox = h('section', { class: 'card sf-card' },
    h('div', { class: 'card-head' }, h('h3', { text: '我嘅身分' }), h('span', { class: 'hint', text: '淨係你見到' })), roleCard.el);
  const listBox = h('section', { class: 'card sf-list' });
  const endBox = h('div', { class: 'sf-end' });
  const guessBarIn = h('div', { class: 'sf-guessbar-in' });
  const guessBar = h('div', { class: 'sf-guessbar' }, guessBarIn);
  const wrap = h('div', { class: 'sf' }, headBox, bannerBox, timerBox, frozenBox, stage, cardBox, listBox, endBox, guessBar);
  root.append(wrap);

  const kHead = keyed(headBox);
  const kClockAct = keyed(clockAct);
  const kBanner = keyed(bannerBox);
  const kReady = keyed(readyBox);
  const kFloor = keyed(floorBox);
  const kActions = keyed(actionBox);
  const kLog = keyed(logBox);
  const kVote = keyed(voteBox);
  const kTally = keyed(tallyBox);
  const kGuess = keyed(guessBox);
  const kList = keyed(listBox);
  const kEnd = keyed(endBox);
  const kBar = keyed(guessBarIn);

  // ---------- header ----------
  function renderHead(v) {
    const my = me();
    const mine = !!v.mine && !shared();
    kHead([v.round, v.dealer, v.rules.spies, my && v.totals[my], v.history.length, mine], () => [
      h('b', { text: `第 ${v.round.n}/${v.round.of} 局` }),
      h('span', { class: 'pill', text: `發牌員 ${nameOf(v.dealer)}` }),
      h('span', { class: 'pill', text: `${v.rules.spies} 個間諜` }),
      v.round.of > 1 && mine ? h('span', { class: 'pill sf-pts', text: `你 ${v.totals[my] ?? 0} 分` }) : null,
    ]);
  }

  // ---------- clock ----------
  function renderClock(v) {
    const running = v.phase === 'play' && !v.halted;
    timerBox.hidden = !running;
    timer.update({ deadline: running ? v.deadline : null, now: () => api.now(), label: '剩餘時間', paused: !!ctx.paused, warnAt: [60, 10] });
    // the 🙋 shortcut acts as the seat on screen: on a shared phone only once that seat took the phone through 🛑 (#13)
    const mine = running && canAct() ? v.mine : null;
    kClockAct([!!mine, mine?.accUsed ?? null], () => (mine
      ? btn(mine.accUsed ? '🙋 用咗' : '🙋 指控', 'btn-ghost btn-sm sf-clock-acc', jumpToAccuse,
        { disabled: mine.accUsed, 'aria-label': mine.accUsed ? '已用咗指控' : '指控' })
      : null));
    const stopped = ['vote', 'tally', 'guess'].includes(v.phase) || (v.phase === 'play' && v.halted);
    frozenBox.hidden = !stopped;
    if (stopped) {
      frozenBox.textContent = v.frozen === 0 ? '⏰ 時間到 · 最後投票'
        : v.halted ? `🛑 有人停咗鐘 · 剩 ${fmtClock(v.frozen)}` : `⏸ 鐘停咗 · 剩 ${fmtClock(v.frozen)}`;
      frozenBox.classList.toggle('over', v.frozen === 0);
    }
  }

  // ---------- banner (vote / tally / guess; a re-dealt round) ----------
  const maxNoOf = (v) => v.vote?.maxNo ?? v.rules.maxNo ?? (v.rules.spies === 2 ? 1 : 0);
  const needText = (v) => (maxNoOf(v) > 0
    ? `兩個間諜：最多 ${maxNoOf(v)} 個人反對都成立`
    : `要所有人（除咗被指控嗰個${v.absent?.length ? '同 💤 唔喺度嘅人' : ''}）贊成先成立`);

  function renderBanner(v) {
    const key = [v.phase, v.vote, v.tally, v.guess && v.guess.current, v.phase === 'reveal' ? v.redo : null];
    kBanner(key, () => {
      if (v.phase === 'reveal' && v.redo) {
        // the round that was thrown away is dead, so what it hid is public now (its location greys out in the list)
        const rd = v.redo;
        const why = rd.why === 'absent' && rd.absent ? `${nameOf(rd.absent)} 唔喺度，佢係間諜` : '房主話呢鋪唔計';
        return h('div', { class: 'sf-banner' },
          h('b', { text: '🗑️ 上一鋪唔計，重新派過牌' }),
          h('small', { text: `${why} · 地點係 ${rd.location.emoji} ${rd.location.name} · 冇人得分` }));
      }
      if (v.phase === 'vote') {
        const vt = v.vote;
        if (vt.kind === 'accuse') {
          return h('div', { class: 'sf-banner' }, h('b', { text: `🙋 ${nameOf(vt.by)} 指控 ${nameOf(vt.suspect)}` }),
            h('small', { text: `${needText(v)}。投票時唔好講理由。` }));
        }
        return h('div', { class: 'sf-banner' },
          h('b', { text: `⏰ 最後投票 ${vt.index}/${vt.of}` }),
          h('small', { text: `${nameOf(vt.suspect)} 係唔係間諜？${needText(v)}` }),
          // Cryptozoic ruling: the spy can no longer guess, so nobody may name the location now.
          h('small', { class: 'sf-banner-note', text: '間諜已經唔可以估地點。可以傾，但唔好講出地點。' }));
      }
      if (v.phase === 'tally') {
        const t = v.tally;
        const last = t.kind === 'final' && t.index === t.of;
        const after = t.convicted ? `${nameOf(t.suspect)} 要亮牌`
          : t.kind === 'accuse' ? '鐘繼續行' : last ? '全部人都投完喇' : '下一位';
        return h('div', { class: `sf-banner ${t.convicted ? 'is-yes' : 'is-no'}` },
          h('b', { text: t.convicted ? '✅ 全票通過' : '❌ 唔通過' }), h('small', { text: after }));
      }
      if (v.phase === 'guess') {
        return h('div', { class: 'sf-banner' },
          h('b', { text: `🕵️ ${nameOf(v.guess.shown[0])} 話佢係間諜` }),
          h('small', { text: v.guess.shown.length > 1 ? '另一個間諜都要企出嚟揀' : '佢要喺地點清單揀一個' }));
      }
      return null;
    });
  }

  // ---------- reveal: ready ----------
  function renderReady(v) {
    readyBox.hidden = v.phase !== 'reveal';
    if (v.phase !== 'reveal') return;
    const mineReady = !!v.mine?.ready || st.sentReady;
    kReady([v.ready, mineReady, v.mine == null, v.absent], () => {
      const out = [];
      if (v.mine && away(me())) out.push(h('p', { class: 'sf-note strong', text: AWAY }));
      else if (v.mine) {
        out.push(mineReady
          ? btn('✓ 準備好喇', 'btn-ghost btn-lg', null, { disabled: true })
          : btn('睇完喇 — 準備好', 'btn-primary btn-lg', () => {
            st.sentReady = true;
            send({ type: 'ready' });
            api.sfx('tap');
            renderReady(view);
          }));
      } else out.push(h('p', { class: 'sf-note', text: atTable() ? '部手機逐個傳：輪到嘅人睇自己張卡。' : '你唔喺呢局入面，睇緊就得。' }));
      const waiting = v.seats.filter((id) => !v.ready.who.includes(id) && !away(id));
      out.push(h('p', { class: 'sf-note', text: `已準備 ${v.ready.done}/${v.ready.total}${waiting.length ? ` · 等緊 ${waiting.map(nameOf).join('、')}` : ''}` }));
      if (v.absent?.length) out.push(h('p', { class: 'sf-note dim', text: `💤 唔喺度：${v.absent.map(nameOf).join('、')}` }));
      // the first question passes to the next seat at the table when the dealer is away (the engine does the same)
      const at = v.seats.indexOf(v.dealer);
      const asker = !away(v.dealer) || at < 0 ? v.dealer
        : v.seats.map((_, k) => v.seats[(at + 1 + k) % v.seats.length]).find((id) => !away(id)) ?? v.dealer;
      out.push(h('p', { class: 'sf-note dim', text: `全部準備好就開始計時，由 ${nameOf(asker)} 問第一條問題。` }));
      return out;
    });
  }

  // ---------- play: who asks next ----------
  function renderFloor(v) {
    // U11: a table may play without the tracker (the default on one phone) — the questions are just spoken
    floorBox.hidden = v.phase !== 'play' || st.mode !== 'main' || v.rules.tracker === false || !!v.halted;
    if (floorBox.hidden) return;
    const f = v.floor;
    const my = me();
    // the phone in the middle records a pass for whoever is asked: no seat switching for a question (#1)
    const active = atTable() ? !ctx.tableLocked : !!v.mine && !away(my);
    const used = v.accUsed ?? [];
    kFloor([f, my, active, used, v.absent, shared()], () => {
      const mineTurn = f.holder === my && !shared();
      // The card turns to someone the moment they are asked, while they are still answering: say "answer, then ask".
      return [
        h('div', { class: 'sf-holder' }, h('b', { text: mineTurn ? '你' : nameOf(f.holder) }),
          h('span', { text: (mineTurn ? '' : ' ') + (f.prev ? '答完就問下一個' : '問第一條問題') })),
        h('p', { class: 'sf-prev', text: f.prev ? `唔可以問返 ${nameOf(f.prev)}` : '第一條問題，想問邊個都得' }),
        h('p', { class: 'sf-hint', text: mineTurn ? '你問邊個？㩒佢個名' : `${nameOf(f.holder)} 問完，就㩒被問嗰個人` }),
        h('div', { class: 'sf-seat-grid' }, v.seats.map((pid) => {
          const blocked = pid === f.holder || pid === f.prev || away(pid);
          return h('button', {
            type: 'button',
            class: `sf-seat${pid === f.holder ? ' holder' : ''}${pid === f.prev ? ' prev' : ''}`,
            style: { '--seat': colorOf(pid) },
            disabled: blocked || !active,
            onclick: () => { api.sfx('tap'); sendT({ type: 'ask', target: pid }); },
          }, h('i', { class: 'dot' }), h('span', { class: 'nm', text: seatName(pid) }),
          used.includes(pid) ? h('span', { class: 'sf-acc', title: '用咗指控', 'aria-label': '用咗指控', text: '🙋✓' }) : null,
          // (the card turns to whoever is asked while they still answer: 「輪到」, not 「發問中」 — one-phone #31)
          pid === f.holder ? h('em', { text: '輪到' }) : pid === f.prev ? h('em', { text: '🚫' }) : null);
          // (seatName already carries the 💤 of an absent seat)
        })),
        h('div', { class: 'sf-floor-foot' },
          f.trail.length > 1 ? h('span', { class: 'sf-trail', text: f.trail.map(nameOf).join(' → ') }) : h('span'),
          f.canUndo && active ? btn('↩ 撤銷', 'btn-ghost btn-sm', () => sendT({ type: 'undo-ask' })) : null),
      ];
    });
  }

  // ---------- play: accuse / spy ----------
  function setMode(mode) {
    st.mode = mode;
    st.sel = [];
    if (mode !== 'accuse' && picker) { picker.destroy(); picker = null; }
    renderFloor(view);
    renderActions(view);
  }
  const leaveMode = () => setMode('main');

  /** The clock bar's 🙋: open the accusation picker and bring it into view (the list may have scrolled it away). */
  function jumpToAccuse() {
    if (!view?.mine || view.mine.accUsed || view.phase !== 'play') return;
    if (st.mode !== 'accuse') setMode('accuse');
    try { actionBox.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); } catch { /* an old browser without options */ }
  }

  /**
   * U3 🛑 停鐘 on the table screen: a whole-table tap that freezes the clock at once (the engine's `stop`), then
   * 「邊個要停鐘？」 — the tapper picks their own name and gets the phone behind a hand-over card. Closed without a
   * name, the clock goes on again.
   */
  function tableStop() {
    if (ctx.tableLocked) return;
    if (view?.halted) { askStopper(); return; }
    const res = sendT({ type: 'stop' });
    if (res === false) return;
    api.sfx('tap');
    Promise.resolve(res).then((ok) => { if (ok !== false) askStopper(); }, () => {});
  }
  function askStopper() {
    if (typeof api.askWho !== 'function') return;
    Promise.resolve(api.askWho({ key: 'stop', title: '邊個要停鐘？', subtitle: '揀你自己個名，部手機會交俾你' }))
      .then((pid) => { if (pid == null) api.tableSend?.({ type: 'resume' }); }, () => {});
  }

  function renderActions(v) {
    const play = v.phase === 'play';
    actionBox.hidden = !play;
    pickerHost.hidden = !(play && st.mode === 'accuse');
    if (!play) {
      if (st.mode !== 'main' || picker) { st.mode = 'main'; st.sel = []; picker?.destroy(); picker = null; }
      return;
    }
    const mine = v.mine;
    if (atTable()) {
      // U3 / #13: the phone in the middle has ONE stop for everybody — 🛑 freezes the clock at once, then whoever
      // tapped picks their own name and takes the phone (accuse, reveal as the spy, or cancel). Same path for all.
      kActions(['table', !!v.halted, !!ctx.tableLocked], () => (v.halted
        ? h('div', { class: 'sf-stopbox' },
          h('p', { class: 'sf-note strong', text: '鐘停咗：停鐘嗰個揀返自己個名，接部機。' }),
          h('div', { class: 'grid2' },
            btn('🙋 揀返我個名', 'btn-primary', askStopper, { disabled: !!ctx.tableLocked }),
            btn('▶ 繼續計時', 'btn-ghost', () => { api.sfx('tap'); sendT({ type: 'resume' }); }, { disabled: !!ctx.tableLocked })))
        : h('div', { class: 'sf-stopbox' },
          btn('🛑 停鐘', 'btn-danger btn-lg sf-stop', tableStop, { disabled: !!ctx.tableLocked }),
          h('p', { class: 'sf-note dim', text: '要指控或者亮間諜身分就㩒：鐘即刻停，再揀返自己個名。' }))));
      return;
    }
    if (!mine) { kActions(['spectator'], () => h('p', { class: 'sf-note', text: '你係觀眾，睇緊就得。' })); return; }
    if (away(me())) {
      if (st.mode !== 'main' || picker) { st.mode = 'main'; st.sel = []; picker?.destroy(); picker = null; pickerHost.hidden = true; }
      kActions(['away'], () => h('p', { class: 'sf-note strong', text: AWAY }));
      return;
    }
    if (!canAct()) {
      // a shared phone's seat screen (picked to look at the card): nobody accuses as whoever happens to be on screen
      if (st.mode !== 'main' || picker) { st.mode = 'main'; st.sel = []; picker?.destroy(); picker = null; pickerHost.hidden = true; }
      kActions(['shared-seat'], () => h('div', { class: 'sf-stopbox' },
        h('p', { class: 'sf-note', text: '要指控或者亮間諜身分：擺返中間㩒「🛑 停鐘」，再揀返自己個名。' }),
        btn('📱 擺返中間', 'btn-ghost', () => { api.sfx('tap'); api.toTable?.(); })));
      return;
    }
    // The key never holds isSpy: every phone builds exactly the same buttons and panels.
    kActions([st.mode, mine.accUsed, v.rules.spies, askedStop()], () => {
      if (st.mode === 'spy') {
        // The same panel on every phone, opened with no sound. For a non-spy 「我係間諜，停鐘」 closes it exactly
        // like 取消 and sends nothing, so no screen can be held up as proof of innocence.
        return h('div', { class: 'card sf-confirm' },
          h('h4', { text: '🕵️ 確定要亮身分？' }),
          h('p', { class: 'sf-note', text: '㩒落去鐘會即刻停，全場都知你係間諜，然後你要喺清單揀一個地點。揀啱你贏，揀錯你輸。' }),
          h('div', { class: 'grid2' },
            btn('取消', 'btn-ghost', leaveMode),
            btn('我係間諜，停鐘', 'btn-danger', () => {
              const spy = !!view?.mine?.isSpy;
              setMode('main');
              if (spy) send({ type: 'spy-stop' });
            })));
      }
      if (st.mode === 'accuse') {
        return h('div', { class: 'sf-accuse-head' },
          h('h4', { text: '🙋 指控邊個？' }),
          h('p', { class: 'sf-note', text: `指控會即刻停鐘。${needText(v)}。每人每局得一次。` }),
          btn('取消', 'btn-ghost btn-sm', leaveMode));
      }
      const grid = h('div', { class: 'grid2 sf-act-grid' },
        btn(mine.accUsed ? '已用咗指控' : '🙋 指控', mine.accUsed ? 'btn-ghost' : 'btn-primary', () => setMode('accuse'), { disabled: mine.accUsed }),
        // Present on every phone and identical on every phone: no sound, no toast, the same confirm panel.
        btn('🕵️ 我係間諜', 'btn-ghost', () => setMode('spy')));
      if (!askedStop()) return grid;
      // U3: handed the phone after 🛑 — 取消 starts the clock again from where it stopped and puts the phone back
      return [
        h('p', { class: 'sf-note strong', text: '鐘停咗。你要做咩？' }),
        grid,
        btn('取消 · 繼續計時', 'btn-ghost sf-stop-cancel', () => { send({ type: 'resume' }); api.toTable?.(); }),
      ];
    });

    if (st.mode === 'accuse') {
      const players = v.seats.map(pl).filter(Boolean);
      const props = {
        players, me: me(), count: 1, exclude: [me(), ...(v.absent ?? [])], selected: st.sel, disabled: false,
        onChange: (sel) => { st.sel = sel; },
        confirmLabel: '指控佢',
        onConfirm: (sel) => { if (sel[0]) { setMode('main'); send({ type: 'accuse', target: sel[0] }); } },
      };
      if (!picker) { picker = PlayerPicker(props); pickerHost.replaceChildren(picker.el); } else picker.update(props);
    }
  }

  function renderLog(v) {
    logBox.hidden = v.phase !== 'play' || !v.accusations.length;
    if (logBox.hidden) return;
    kLog([v.accusations], () => [
      h('p', { class: 'sf-log-title', text: '今局指控' }),
      v.accusations.map((a) => h('div', { class: 'sf-log-row' },
        h('span', { text: `${nameOf(a.by)} → ${nameOf(a.suspect)}` }),
        h('em', { text: a.result === 'failed' ? '❌ 唔通過' : a.result === 'passed' ? '✅ 通過' : '投票中' }))),
    ]);
  }

  // ---------- vote ----------
  function cast(yes) {
    api.sfx('vote');
    send({ type: 'vote', yes });
  }

  function handsButtons(v) {
    // One button per "no" count a conviction survives, then one for "too many".
    const max = maxNoOf(v);
    const opts = [[0, '全部贊成', 'sf-yes']];
    for (let no = 1; no <= max; no++) opts.push([no, `${no} 人反對`, '']);
    opts.push([max + 1, max ? `${max + 1} 人或以上反對` : '有人反對', 'sf-no']);
    return h('div', { class: 'sf-hands-btns' }, opts.map(([no, label, cls]) => btn(label, cls, () => {
      api.sfx('vote');
      send({ type: 'verdict', no });
    })));
  }

  function renderVote(v) {
    voteBox.hidden = v.phase !== 'vote';
    if (v.phase !== 'vote') return;
    const vt = v.vote;
    const mine = v.mine;
    kVote([vt, mine && [mine.vote, mine.isVoter], me(), away(me())], () => {
      const out = [];
      if (vt.mode === 'hands') {
        out.push(h('p', { class: 'sf-vote-q', text: `${nameOf(vt.suspect)} 係唔係間諜？` }));
        out.push(h('p', { class: 'sf-note', text: `全部人同時舉手，贊成嘅舉手。被指控嘅人唔投${v.absent?.length ? '，💤 唔喺度嘅人都唔計' : ''}。` }));
        if (mine && vt.reporter === me()) {
          out.push(h('p', { class: 'sf-note strong', text: '數一數，㩒結果：' }));
          out.push(handsButtons(v));
        } else out.push(h('p', { class: 'sf-note strong', text: `等 ${nameOf(vt.reporter)} 報告結果…` }));
        return out;
      }
      const waiting = vt.voters.filter((id) => !vt.voted.includes(id));
      if (mine?.isVoter && mine.vote == null) {
        out.push(h('p', { class: 'sf-vote-q', text: `${nameOf(vt.suspect)} 係唔係間諜？` }));
        out.push(h('div', { class: 'sf-vote-btns' }, btn('👍 贊成', 'sf-yes', () => cast(true)), btn('👎 反對', 'sf-no', () => cast(false))));
      } else if (mine?.isVoter) {
        // D6: your own phone never prints which way you voted (a neighbour's glance learns nothing before the
        // tally); the accuser's automatic yes is public anyway
        const auto = vt.kind === 'accuse' && vt.by === me();
        out.push(h('p', { class: 'sf-note strong', text: auto ? '你係指控人，自動贊成 👍' : '已投 ✓' }));
      } else if (mine && away(me())) {
        out.push(h('p', { class: 'sf-note strong', text: AWAY }));
      } else if (mine) {
        out.push(h('p', { class: 'sf-note strong', text: '你被指控，唔使投票。等其他人投。' }));
      } else out.push(h('p', { class: 'sf-note', text: atTable() ? '大家輪流投緊：部手機會逐個交，投完先公佈。' : '你係觀眾，睇緊就得。' }));
      out.push(h('p', { class: 'sf-note', text: `已投 ${vt.voted.length}/${vt.voters.length}${waiting.length ? ` · 等緊 ${waiting.map(nameOf).join('、')}` : ''}` }));
      out.push(h('div', { class: 'sf-pips' }, vt.voters.map((id) => h('i', { class: vt.voted.includes(id) ? 'on' : '', title: nameOf(id) }))));
      return out;
    });
  }

  // ---------- tally ----------
  function renderTally(v) {
    tallyBox.hidden = v.phase !== 'tally';
    if (v.phase !== 'tally') return;
    const t = v.tally;
    kTally([t], () => {
      if (t.mode === 'hands') {
        return [h('p', { class: 'sf-vote-q', text: `${nameOf(t.suspect)}：${t.noCount === 0 ? '全部人贊成' : `${t.noCount} 人反對`}` })];
      }
      return [
        h('p', { class: 'sf-vote-q', text: `${nameOf(t.suspect)} 係唔係間諜？` }),
        h('div', { class: 'sf-yn' },
          h('div', { class: 'yes' }, h('b', { text: `👍 贊成 ${t.yes.length}` }), h('div', { class: 'sf-chips' }, t.yes.map(who))),
          h('div', { class: 'no' }, h('b', { text: `👎 反對 ${t.no.length}` }), h('div', { class: 'sf-chips' }, t.no.length ? t.no.map(who) : h('span', { class: 'sf-note dim', text: '冇人' })))),
      ];
    });
  }

  // ---------- guess ----------
  function confirmGuess() {
    const loc = st.pick;
    if (loc == null) return;
    st.pick = null;
    send({ type: 'guess', loc });
    renderGuess(view);
    renderList(view);
  }

  /**
   * One phone (re-run N3): the guess is a public step — the phone lies in the middle — so the table must not watch the
   * spy try places out. One tap picks; nothing is highlighted and the place is never printed; it goes out after
   * GUESS_UNDO_S seconds unless 撤銷 is tapped (a slip of the finger). The reveal names it.
   */
  const isGuesser = (v) => v?.phase === 'guess' && v.guess?.current === me() && !!v.mine;
  const publicGuess = () => shared();
  function pickPublic(loc) {
    const n = (st.pending?.n ?? 0) + 1;
    st.pending = { loc, left: GUESS_UNDO_S, n };
    api.sfx('tap');
    const tick = () => {
      const p = st.pending;
      if (!p || p.n !== n) return;
      if (!isGuesser(view)) { st.pending = null; return; }
      p.left -= 1;
      if (p.left > 0) { later(tick, 1000); renderGuess(view); return; }
      st.pending = null;
      send({ type: 'guess', loc: p.loc });
      renderGuess(view);
      renderList(view);
    };
    later(tick, 1000);
    renderGuess(view);
  }
  function undoPublic() {
    if (!st.pending) return;
    st.pending = null;
    api.sfx('tap');
    renderGuess(view);
  }

  function renderGuess(v) {
    guessBox.hidden = v.phase !== 'guess';
    const g = v.guess;
    const mineTurn = isGuesser(v);
    const pub = mineTurn && publicGuess();
    if (!mineTurn || pub) st.pick = null;
    if (!mineTurn) st.pending = null;
    const pend = pub ? st.pending : null;
    const showBar = pub ? !!pend : mineTurn && st.pick != null;
    guessBar.hidden = !showBar;
    wrap.classList.toggle('has-bar', showBar);
    kBar([showBar && (pub ? ['undo', pend.left] : st.pick)], () => {
      if (!showBar) return null;
      return pub ? btn(`↩ 撤銷（${pend.left}）`, 'btn-ghost btn-lg', undoPublic)
        : btn(`就係「${locName(st.pick)}」！`, 'btn-primary btn-lg', confirmGuess);
    });
    if (v.phase !== 'guess') return;
    kGuess([g, mineTurn, st.pick, pub && (pend ? pend.left : 0)], () => {
      const out = [];
      if (pub) {
        // the whole table reads this screen: the spy by name, never 「你」, and never the place picked
        const who = nameOf(me());
        out.push(h('h4', { text: `🕵️ ${who} 揀地點` }));
        out.push(h('p', { class: 'sf-note', text: pend
          ? `${who} 揀好咗，${pend.left} 秒後公佈。㩒錯就㩒撤銷。`
          : `${who}：喺下面清單㩒一個地點，㩒咗就算（${GUESS_UNDO_S} 秒內可以撤銷）。` }));
        if (pend) out.push(btn(`↩ 撤銷（${pend.left}）`, 'btn-ghost', undoPublic));
      } else if (mineTurn) {
        out.push(h('h4', { text: '🕵️ 你揀咗邊個地點？' }));
        out.push(h('p', { class: 'sf-note', text: st.pick == null
          ? '喺下面清單㩒一個地點。只可以揀一次。'
          : `你揀咗「${locName(st.pick)}」。想改就㩒第二個，確定就㩒底部嘅掣。` }));
        // The bar at the bottom can sit under the host's narrator panel, so the same button is here too.
        if (st.pick != null) out.push(btn(`就係「${locName(st.pick)}」！`, 'btn-primary', confirmGuess));
      } else {
        out.push(h('p', { class: 'sf-vote-q', text: `等 ${nameOf(g.current)} 揀地點…` }));
      }
      for (const [pid, loc] of Object.entries(g.picks)) {
        out.push(h('p', { class: 'sf-note strong', text: `${nameOf(pid)} 揀咗「${locName(loc)}」` }));
      }
      return out;
    });
  }

  // ---------- my card ----------
  function renderCard(v) {
    // a public one-person step on a shared phone (#4): the screen is the table's, so no role card on it
    const show = !!v.mine && WITH_CARD.has(v.phase) && !openStep();
    cardBox.hidden = !show;
    if (!show) { roleCard.close(); return; }
    roleCard.update({
      role: { emoji: v.mine.card.emoji, name: v.mine.card.name, team: 'card', text: v.mine.card.text },
      hint: '㩒住睇你嘅身分，放手就冚返',
    });
  }

  // ---------- location list ----------
  function renderList(v) {
    const show = WITH_CARD.has(v.phase);
    listBox.hidden = !show;
    if (!show) return;
    const guesser = isGuesser(v);
    const pub = guesser && publicGuess();   // one phone (re-run N3): no highlight on the place the spy tapped
    if (guesser && !st.listOpen) st.listOpen = true;
    const picked = v.guess ? Object.values(v.guess.picks) : [];
    // #22: the phone in the middle is read by everybody — nobody's strikes on it (they could hint at the spy)
    const table = atTable();
    const struck = table ? [] : [...st.strikes].sort((a, b) => a - b);
    kList([st.listOpen, struck, v.locations.map((l) => l.used), picked, pub ? null : st.pick, guesser, pub, table], () => {
      const head = h('div', { class: 'sf-list-head' },
        h('button', {
          type: 'button', class: 'sf-list-toggle', 'aria-expanded': String(st.listOpen),
          onclick: () => { st.listOpen = !st.listOpen; renderList(view); },
        }, h('span', { text: `📍 地點清單 · ${v.locations.length} 個` }), h('span', { class: 'chev', text: st.listOpen ? '▴' : '▾' })),
        struck.length && !guesser ? btn('還原劃線', 'btn-ghost btn-sm', () => { st.strikes.clear(); renderList(view); }) : null);
      if (!st.listOpen) return head;
      const hint = pub ? `${nameOf(me())} 㩒要揀嘅地點` : guesser ? '㩒你要揀嘅地點'
        : table ? '灰色 = 舊局用過，唔會再係答案。'
          : '㩒一下劃走（淨係呢部機見到；一部機輪流玩，換人會清返）。灰色 = 舊局用過，唔會再係答案。';
      const groups = [];
      for (const loc of v.locations) {
        let g = groups[groups.length - 1];
        if (!g || g.cat !== loc.cat) { g = { cat: loc.cat, items: [] }; groups.push(g); }
        g.items.push(loc);
      }
      return [head, h('p', { class: 'sf-note dim', text: hint }), groups.map((g) => h('div', { class: 'sf-cat' },
        h('p', { class: 'sf-cat-name', text: g.cat }),
        h('div', { class: 'sf-locs' }, g.items.map((loc) => h('button', {
          type: 'button',
          class: ['sf-loc', st.strikes.has(loc.i) && !guesser ? 'struck' : '', loc.used ? 'used' : '', picked.includes(loc.i) ? 'picked' : '', !pub && st.pick === loc.i ? 'is-sel' : ''].filter(Boolean).join(' '),
          onclick: () => {
            if (pub) { pickPublic(loc.i); return; }
            if (guesser) { st.pick = loc.i; api.sfx('tap'); renderGuess(view); renderList(view); return; }
            if (table) return;
            if (st.strikes.has(loc.i)) st.strikes.delete(loc.i); else st.strikes.add(loc.i);
            api.sfx('tap');
            renderList(view);
          },
        }, h('span', { class: 'em', text: loc.emoji }), h('span', { text: loc.name })))))),
      ];
    });
  }

  // ---------- round end ----------
  function renderEnd(v) {
    const e = v.end;
    endBox.hidden = !e;
    if (!e) return;
    if (st.endFor !== e.n) {
      st.endFor = e.n;
      st.endLeft = END_DELAY_S;
      const tick = () => {
        st.endLeft = Math.max(0, st.endLeft - 1);
        if (st.endLeft > 0) later(tick, 1000);
        if (view) renderEnd(view);
      };
      later(tick, 1000);
    }
    const ready = st.endLeft <= 0;
    const seen = v.phase === 'roundEnd' ? v.seen : null;
    // §7.1 the shared phone in the middle: one 睇完 for every seat it holds (api.tableSend); on a one-phone table
    // that is everybody — 「大家睇完 ✓（一下就得）」, no waiting list, locked while the 「擺返中間」 card is up (U5)
    const table = atTable();
    const mates = table ? (api.mySeats ?? []).filter((id) => !away(id)) : [];
    const iSeen = table ? (st.seenFor === e.n || (!!seen && mates.length > 0 && mates.every((id) => seen.who.includes(id))))
      : !!v.mine?.seen || st.seenFor === e.n;
    const canNext = v.phase === 'roundEnd' && !iSeen && (table ? mates.length > 0 : !!v.mine && !away(me()));
    const locked = table && !!ctx.tableLocked;
    kEnd([e, v.totals, canNext && ready, v.phase, me(), st.endLeft, seen, iSeen, v.absent, table, locked], () => {
      const spyWon = e.winTeam === 'spy';
      const rows = v.seats.map((pid) => {
        const isSpy = e.spies.includes(pid);
        const d = e.deltas[pid] ?? 0;
        return h('div', { class: `sf-row${isSpy ? ' is-spy' : ''}${pid === me() && !shared() ? ' is-me' : ''}` },
          h('i', { class: 'dot', style: { '--seat': colorOf(pid) } }),
          h('span', { class: 'nm', text: seatName(pid) + (seen?.who.includes(pid) ? ' ✓' : '') }),
          h('span', { class: 'role', text: isSpy ? '🕵️ 間諜' : e.roles[pid] ?? '' }),
          h('span', { class: `delta${d ? ' on' : ''}`, text: d ? `+${d}` : '0' }),
          h('b', { class: 'total', text: String(v.totals[pid] ?? 0) }));
      });
      return [
        h('section', { class: `card sf-reveal ${spyWon ? 'spy-win' : 'agent-win'}` },
          h('p', { class: 'sf-reveal-kicker', text: `第 ${e.n}/${v.round.of} 局 · 地點係` }),
          h('div', { class: 'sf-reveal-loc' }, h('span', { class: 'em', text: e.location.emoji }), h('b', { text: e.location.name })),
          h('div', { class: 'sf-reveal-spy', text: `間諜：🕵️ ${e.spies.map(nameOf).join('、')}` }),
          h('p', { class: 'sf-reveal-head', text: e.headline })),
        h('section', { class: 'card sf-why' }, h('h4', { text: '點解咁計分' }), h('ul', {}, e.lines.map((l) => h('li', { text: l })))),
        h('section', { class: 'card sf-table' },
          h('div', { class: 'sf-row sf-row-head' }, h('span', { class: 'nm', text: '玩家' }), h('span', { class: 'role', text: '身分' }), h('span', { class: 'delta', text: '本局' }), h('b', { class: 'total', text: '總分' })),
          rows),
        // D3: the table moves on once every present seat has tapped 睇完 (the host's 下一步 can force it). The button
        // is the same on every phone; after the tap it only says you are done.
        canNext
          ? btn(table ? (wholeTable() ? '大家睇完 ✓（一下就得）' : '睇完 ✓（呢部機嘅人）') : '睇完 ✓', 'btn-primary btn-lg', markSeen,
            { disabled: !ready || locked })
          : v.phase === 'roundEnd' && (table ? mates.length > 0 : v.mine && !away(me()))
            ? btn(table && wholeTable() ? '✓ 睇完' : '✓ 睇完 · 等緊其他人', 'btn-ghost btn-lg', null, { disabled: true })
            : null,
        // a short lock, so a tap meant for the last screen cannot skip the reveal — and it says how long
        canNext && !ready ? h('p', { class: 'sf-note dim sf-end-wait', text: `睇清楚先，${st.endLeft} 秒後先㩒得` }) : null,
        seen && !wholeTable() ? h('p', { class: 'sf-note sf-seen', text: seenLine(v, e) }) : null,
      ];
    });
  }

  function markSeen() {
    const e = view?.end;
    if (!e || st.seenFor === e.n) return;
    if (atTable()) {
      if (sendT({ type: 'next-round' }) === false) return;
    } else {
      const mates = deviceMates();
      send(mates.length ? { type: 'next-round', seats: mates } : { type: 'next-round' });
    }
    st.seenFor = e.n;
    api.sfx('tap');
    renderEnd(view);
    const n = e.n;
    later(() => {                 // a tap that never reached the host must not leave this phone stuck
      if (st.seenFor === n && view?.phase === 'roundEnd' && view.end?.n === n && !view.mine?.seen) {
        st.seenFor = 0;
        renderEnd(view);
      }
    }, SEEN_RETRY_MS);
  }

  /** 「睇完 3 / 5 · 等緊：阿明、小美 · 齊人就開下一局」 — identical on every phone. */
  function seenLine(v, e) {
    const s = v.seen;
    const waiting = v.seats.filter((id) => !s.who.includes(id) && !away(id));
    const then = e.last ? '齊人就睇總分' : '齊人就開下一局';
    return `睇完 ${s.done} / ${s.total}${waiting.length ? ` · 等緊：${waiting.map(nameOf).join('、')}` : ''} · ${then}`;
  }

  // ---------- sounds on transitions ----------
  function sounds(v) {
    const my = me();
    if (st.phase !== v.phase) {
      if (v.phase === 'reveal') api.sfx('deal');
      else if (v.phase === 'play' && st.phase === 'reveal') api.sfx('start');
      else if (v.phase === 'roundEnd') api.sfx('reveal');
      else if (v.phase === 'over') api.sfx('win');
    }
    if (v.phase === 'play') {
      const holder = v.floor?.holder ?? null;
      if (holder && holder !== st.holder && holder === my && !shared() && st.phase === 'play') api.sfx('turn');
      st.holder = holder;
    }
    st.phase = v.phase;
  }

  // ---------- update ----------
  function update(v, c) {
    view = v;
    ctx = c || {};
    if (!v) return;
    const seat = me();
    if (v.round.n !== st.round || seat !== st.seat) {
      st.seat = seat;
      st.round = v.round.n;
      st.strikes.clear();
      st.mode = 'main';
      st.sel = [];
      st.pick = null;
      st.pending = null;
      st.sentReady = false;
      st.listOpen = v.phase === 'reveal' || atTable();   // the table screen keeps the public list open (#1)
      st.holder = null;
      if (picker) { picker.destroy(); picker = null; }
      kReady(null, () => null);
    }
    if (st.phase === 'reveal' && v.phase === 'play') {
      // Play starts: the blocks reorder (clock and question card first), so start from the top, and fold the
      // location list once — its 📍 toggle reopens it — so it does not push everything off the screen.
      st.listOpen = atTable();
      try { globalThis.scrollTo?.(0, 0); } catch { /* no window */ }
    }
    wrap.dataset.phase = v.phase;
    stage.hidden = v.phase === 'roundEnd' || v.phase === 'over';
    sounds(v);
    renderHead(v);
    renderClock(v);
    renderBanner(v);
    renderReady(v);
    renderFloor(v);
    renderActions(v);
    renderLog(v);
    renderVote(v);
    renderTally(v);
    renderGuess(v);
    renderCard(v);
    renderList(v);
    renderEnd(v);
  }

  function destroy() {
    for (const t of timeouts) clearTimeout(t);
    timeouts.clear();
    picker?.destroy();
    roleCard.destroy();
    timer.destroy();
    wrap.remove();
  }

  return { update, destroy };
}
