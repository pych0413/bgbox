// ============================================================
// ui.js — 芝士大盜 on one phone.  mount(root, api) → { update(view, ctx), destroy() }
//
// Render-from-view: update() may be called with the same view twice and must be
// idempotent, so every long-lived widget (the cup, the role card, the vote
// panel) is created once per screen and only ever .update()d — rebuilding a
// Cover while a thumb holds it would snap the peek shut.
//
// Night rules this file keeps (docs/games/cheese-thief.md §3, "anti-tell"):
//  - every phone draws the SAME layout at every night step: header, info panel,
//    a grid of the other seats, one big button — same classes, same colours,
//    same big label. Only the text inside the panel and the small line under
//    the button differ, so a glance cannot tell a peek or a steal from a decoy.
//  - every seat can do the same gesture every step: tap a name (optional),
//    then the big button. For a sleeper the name tap is a decoy and the button
//    is the "ack" action; for a lone sleepyhead it is the peek.
//  - nothing here makes a sound at night (no api.sfx, no PlayerPicker, no Timer —
//    their taps and ticks would tell the room who is awake; the peek cover is
//    silent).
//  - view.hint is never drawn here: the shell shows it only behind 💡 (U1).
// ============================================================

import { el } from '../../ui/dom.js?v=20261003164441';
import { rules } from './game.js?v=20261003164441';
import { CLOCK } from './script.js?v=20261003164441';

const ROLES = Object.fromEntries(rules.roles.map((r) => [r.id, r]));

// ---------- tiny DOM helpers (write only when something changed) ----------

function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
function setHidden(node, hidden) { if (node.hidden !== !!hidden) node.hidden = !!hidden; }

const sig = (x) => JSON.stringify(x ?? null);

// ---------- text helpers ----------

/** The role card text, tuned to this head-count so nobody has to read the rulebook. */
function roleFor(my, n, opts) {
  const base = ROLES[my.role];
  if (!base) return null;
  let text = base.text;
  if (my.role === 'thief') {
    if (n === 4) text += ' 4 人局：你有兩粒骰，兩個點鐘都會醒，揀其中一次偷；平票都算你贏。';
    else if (n === 5) text += ' 偷芝士時如果有貪瞓鼠一齊醒，你指一位做共犯。';
    else if (n === 6) text += ' 夜晚尾你揀 1 位共犯。';
    else text += ' 夜晚尾你揀 2 位共犯。';
  } else if (my.role === 'sleepyhead') {
    if (n === 4) text += ` 4 人局：兩粒骰揀一粒做醒鐘。${opts?.peek4 ? '（今局家規：淨係得你醒都可以偷睇。）' : ''}`;
  }
  return { emoji: base.emoji, name: base.name, team: base.team, text };
}

function readyLead(my, view) {
  if (my.ready) return '好喇。等其他人準備好，夜晚就會開始 — 叫大家閉眼，部手機放低。';
  if (!my.locked) return '① 㩒住張牌睇你身份　② 搖你嘅骰（搖部機或者㩒掣）';
  if (my.needsChoice && my.chosen == null) return '③ 揀邊粒骰做你嘅醒鐘（先掀開個盅睇住）';
  return '③ 睇清楚晒就㩒「準備好」';
}

// ============================================================
// shared bits
// ============================================================

function makeEnv(api, local, refresh) {
  const players = () => api.players ?? [];
  const nameOf = (pid) => players().find((p) => p.id === pid)?.name ?? '?';
  const colorOf = (pid) => players().find((p) => p.id === pid)?.color ?? 'var(--cheese)';
  const names = (pids) => (pids ?? []).map(nameOf).join('、');
  return { api, C: api.components, local, refresh, players, nameOf, colorOf, names };
}

/** The role card, shared by the roll and day screens. */
function makeRoleCard(E) {
  const card = E.C.RoleCard({
    role: null,
    locked: E.local.roleLocked,
    onLockToggle: () => { E.local.roleLocked = !E.local.roleLocked; E.refresh(); },
  });
  return {
    el: card.el,
    update(view) {
      card.update({
        role: roleFor(view.my, view.n, view.opts),
        locked: E.local.roleLocked,
        onLockToggle: () => { E.local.roleLocked = !E.local.roleLocked; E.refresh(); },
        hint: E.local.roleLocked ? '已鎖定，㩒下面解鎖' : '㩒住先睇到，放手即刻冚返',
      });
    },
    destroy() { card.destroy(); },
  };
}

function followerBadge(E) {
  const node = el('div', { class: 'ct-badge', hidden: true });
  return {
    el: node,
    update(view) {
      const my = view.my;
      setHidden(node, !my.follower);
      if (my.follower) {
        setText(node, my.role === 'fall-mouse'
          ? '🎭 你係背鍋鼠，仲畀大盜拉咗做共犯 — 但你淨係靠畀人投中先贏。（你唔可以投自己）'
          : '🤝 你係共犯 — 同大盜一隊，贏就一齊贏。（你唔可以投自己）');
      }
    },
  };
}

// ============================================================
// roll: card, cup, (4p) which die, ready
// ============================================================

function buildRoll(E) {
  const { api, C } = E;
  const lead = el('p', { class: 'ct-lead' });
  const roleCard = makeRoleCard(E);
  const cup = C.DiceCup({ dice: null, sides: 6, rollSeq: 0, canRoll: true, lockedRoll: false, shakeToRoll: true });

  const chooseHint = el('p', { class: 'ct-choose-hint', text: '你有兩粒骰：邊粒做你嘅「醒鐘」？先掀開個盅睇咗先揀。' });
  const btnL = el('button', { class: 'btn btn-ghost', type: 'button' }, '左邊粒');
  const btnR = el('button', { class: 'btn btn-ghost', type: 'button' }, '右邊粒');
  const choose = el('div', { class: 'ct-choose', hidden: true }, chooseHint, el('div', { class: 'grid2 tight' }, btnL, btnR));

  let dice = [];
  btnL.addEventListener('click', () => dice[0] != null && api.send({ type: 'choose-hour', hour: dice[0] }));
  btnR.addEventListener('click', () => dice[1] != null && api.send({ type: 'choose-hour', hour: dice[1] }));

  const readyBtn = el('button', { class: 'btn btn-primary btn-lg ct-ready', type: 'button', onclick: () => api.send({ type: 'ready' }) });
  const count = el('p', { class: 'ct-count' });
  const tip = el('details', { class: 'ct-tip' },
    el('summary', { text: '夜晚點玩？' }),
    el('p', { text: '手機會逐個點鐘報時。擲到幾點，就喺嗰個點鐘睜眼 — 到時你部機會自動亮起，話你知邊個同你一齊醒、芝士仲喺唔喺度。' }),
    el('p', { text: '每個點鐘（連你瞓緊嗰陣）都喺手機下半部大掣㩒一下，咁就冇人聽得出邊個醒。' }));

  const node = el('div', { class: 'ct-screen ct-roll' }, lead, roleCard.el, cup.el, choose, readyBtn, count, tip);

  return {
    el: node,
    update(view) {
      const my = view.my;
      dice = my.dice ?? [];
      setText(lead, readyLead(my, view));
      roleCard.update(view);
      cup.update({
        dice: my.dice, sides: 6, rollSeq: my.rollSeq,
        canRoll: !my.locked && !my.ready,
        lockedRoll: my.locked,
        onRoll: () => api.send({ type: 'roll' }),
        onLock: view.opts?.reroll ? () => api.send({ type: 'lock' }) : undefined,
        shakeToRoll: true,
      });

      setHidden(choose, !(my.needsChoice && !my.ready));
      const picked = my.chosen != null ? dice.indexOf(my.chosen) : -1;
      btnL.classList.toggle('btn-locked', picked === 0);
      btnR.classList.toggle('btn-locked', picked === 1);
      setText(btnL, picked === 0 ? '✓ 左邊粒' : '左邊粒');
      setText(btnR, picked === 1 ? '✓ 右邊粒' : '右邊粒');

      const can = my.locked && (!my.needsChoice || my.chosen != null);
      readyBtn.disabled = my.ready || !can;
      setText(readyBtn, my.ready ? '✓ 準備好 — 等緊其他人' : can ? '✅ 準備好' : '搖咗骰先㩒得');
      setText(count, `已準備 ${view.ready.done} / ${view.ready.total}`);
    },
    destroy() { roleCard.destroy(); cup.destroy(); node.remove(); },
  };
}

// ============================================================
// night: one layout for everybody, decoys for the sleepers
// ============================================================

/** A grid of the other seats. Silent on purpose (PlayerPicker clicks). */
function makeChips(E) {
  const grid = el('div', { class: 'ct-grid' });
  let key = '';
  let chips = [];
  let onTap = () => {};

  function ensure(list) {
    const k = sig(list.map((p) => [p.id, p.name, p.color]));
    if (k === key) return;
    key = k;
    chips = list.map((p) => {
      const b = el('button', { class: 'ct-chip', type: 'button', style: { '--seat': p.color ?? 'var(--cheese)' } },
        el('span', { class: 'dot' }), el('span', { class: 'ct-chip-name', text: p.name }));
      b.addEventListener('click', () => onTap(p.id));
      return { pid: p.id, b };
    });
    grid.replaceChildren(...chips.map((c) => c.b));
  }

  return {
    el: grid,
    /**
     * Every chip stays tappable and looks the same on every phone: a sleeper's
     * decoy taps highlight a name exactly like a peek or a follower pick does.
     * `selected`: pids shown as picked.
     */
    paint(list, { selected, tap }) {
      ensure(list);
      onTap = tap;
      for (const c of chips) {
        c.b.disabled = false;
        c.b.classList.toggle('on', selected.includes(c.pid));
      }
    },
  };
}

function stepHead(step) {
  switch (step.k) {
    case 'begin': return ['🌙', '天黑，閉眼'];
    case 'open': return ['🌙', `${CLOCK[step.h]}點鐘`];
    case 'close': return ['😴', '閉返眼'];
    case 'rec-pick': case 'rec-tclose': case 'rec-meet': case 'rec-close': return ['🤝', '共犯環節'];
    case 'dawn': return ['🌅', '天光'];
    default: return ['🌙', ''];
  }
}

/** The lines on the info card while this seat is NOT awake. Same height as the awake card. */
function sleepLines(step) {
  switch (step.k) {
    case 'begin': return [['head', '🌙 天黑'], ['sub', '閉埋眼，部手機放低，唔好偷望。']];
    case 'open':
      return step.stage === 'window'
        ? [['head', '💤 瞓緊'], ['sub', '呢個鐘冇你份。閉住眼，等報下一點。']]
        : [['head', '🌙 聽住報時…'], ['sub', '如果擲到呢個點數，等報完先會有嘢睇。']];
    case 'close': return [['head', '😴 閉返眼'], ['sub', '等下一點。']];
    case 'dawn': return [['head', '🌅 天光喇'], ['sub', '可以睜眼喇。']];
    default: return [['head', '🤝 共犯環節'], ['sub', '唔關你事，繼續閉眼。']];
  }
}

/** The lines while this seat IS awake. Everything here is private to this phone. */
function awakeLines(E, view) {
  const { nameOf, names } = E;
  const night = view.nightSeat;
  const step = view.step;
  const my = view.my;
  const me = E.api.me;
  const L = [];

  if (step.k === 'open') {
    L.push(['head', '👀 你醒咗']);
    L.push(['with', night.with.length ? `同你一齊醒：${names(night.with)}` : '淨係得你醒，其他人都瞓緊。']);

    if (night.thief === me) L.push(['cheese', '🧀 你偷走咗芝士！收好佢，唔好露出破綻。']);
    else if (night.thief) L.push(['cheese hot', `🧀 ${nameOf(night.thief)} 偷走咗芝士 — 你睇到晒喇！`]);
    else if (night.cheese === 'gone') L.push(['cheese', '🧀 芝士已經唔見咗，但你唔知係邊個偷。']);
    else L.push(['cheese', '🧀 芝士仲喺枱上。']);

    if (night.steal?.twoWakes && !night.steal.can && night.cheese === 'gone') {
      L.push(['note', '你已經偷咗，今次淨係睇下邊個醒。']);
    }
    if (night.steal?.can) {
      const other = my.wake.filter((h) => h !== step.h).map((h) => CLOCK[h]).join('、');
      L.push(['role', other
        ? `而家偷，定係等${other}點鐘先偷？㩒大掣＝而家偷；想等就唔好㩒。`
        : '你一定要偷：㩒大掣＝偷。']);
    }

    const pk = night.peek;
    if (pk.mode === 'can') L.push(['role', '👁 淨係得你醒：可以偷睇一個人粒骰（得一次）。㩒個名，再㩒大掣；唔想睇就直接㩒大掣。']);
    else if (pk.mode === 'together') L.push(['note', '有人同你一齊醒，今次唔可以偷睇。']);
    else if (pk.mode === 'off' && my.role !== 'thief') L.push(['note', '4 人局唔可以偷睇（官方規則）。']);

    if (night.recruit) L.push(['role', `🤝 你一定要揀 ${night.recruit.count} 位同你一齊醒嘅人做共犯：㩒名，再㩒大掣。唔揀，時間到會幫你隨機揀。`]);
    if (night.picked && night.picked !== me) L.push(['cheese hot', `🤝 大盜揀咗 ${nameOf(night.picked)} 做共犯。`]);
    if (my.follower && night.picked === me) L.push(['cheese hot', '🤝 你畀大盜揀咗做共犯！你同大盜一隊，唔好講畀人知。']);
    return L;
  }

  if (step.k === 'rec-pick') {
    L.push(['head', '🤝 你係大盜']);
    if (night.recruit) {
      const silent = view.__ctx?.narrationMode === 'silent';
      L.push(['role', silent
        ? `揀 ${night.recruit.count} 位共犯：㩒名，再㩒大掣（靜音模式唔使摸手）。唔揀，時間到會幫你隨機揀。`
        : `揀 ${night.recruit.count} 位共犯：㩒名，再㩒大掣，同時輕輕摸佢哋隻手 — 佢哋靠呢下先知要睜眼。`]);
    } else {
      L.push(['role', `✓ 你揀咗 ${names(night.recruited)}。`]);
    }
    return L;
  }

  if (step.k === 'rec-meet') {
    L.push(['head', my.role === 'thief' ? '🤝 認人' : '🤝 你係共犯！']);
    const meet = night.meet;
    if (my.role === 'thief') L.push(['with', `你嘅共犯：${names(meet.mates)}`]);
    else {
      if (meet.thief) L.push(['with', view.n === 7 ? `大盜係 ${nameOf(meet.thief)}（你夜晚親眼見到佢偷）。` : `大盜係 ${nameOf(meet.thief)}。`]);
      else L.push(['with', '你唔知大盜係邊個。']);
      if (meet.mates.length) L.push(['with', `另一位共犯：${names(meet.mates)}`]);
      L.push(['note', my.role === 'fall-mouse'
        ? '你同時係背鍋鼠：想贏就要畀人投中。夜晚唔可以傳遞骰仔資料。'
        : '你同大盜一隊。夜晚唔可以用任何方法傳遞骰仔資料。']);
    }
    return L;
  }
  return sleepLines(step);
}

/** The big button's label: identical on every phone at every night step. */
export const ACK_MAIN = '👆 㩒一下';
const ACK_DECOY = '每一步都㩒，咁就冇人聽得出邊個醒';

/** The small line under the big button: what this seat's tap will do now. */
function ackSubline(E, view, mode, selected) {
  const night = view.nightSeat;
  if (mode === 'peek') {
    return selected.length ? `㩒落去就睇 ${E.nameOf(selected[0])} 粒骰（得一次）` : '揀咗名先會睇到；唔想睇就直接㩒';
  }
  if (mode === 'recruit') {
    const c = night.recruit.count;
    return selected.length === c ? `㩒落去就揀 ${E.names(selected)} 做共犯` : `喺上面揀 ${c} 位（${selected.length}/${c}）`;
  }
  if (night?.awake && night.steal?.can) return '㩒落去＝而家偷芝士；想等就唔好㩒';
  return ACK_DECOY;
}

function buildNight(E) {
  const { api, C } = E;
  const icon = el('span', { class: 'ct-n-icon' });
  const title = el('b', { class: 'ct-n-title' });
  const head = el('div', { class: 'ct-n-head' }, icon, title);
  const fill = el('i');
  const bar = el('div', { class: 'ct-bar' }, fill);

  const lines = el('div', { class: 'ct-lines' });
  const peekFront = el('div', { class: 'ct-peekfront' });
  const peekCover = C.Cover({ front: peekFront, backArt: '👁', backLabel: '㩒住睇結果', lockMode: 'none', locked: false, openSound: 'none' });
  const peekWrap = el('div', { class: 'ct-peekwrap', hidden: true }, peekCover.el);
  const panel = el('div', { class: 'ct-panel' }, lines, peekWrap);

  const chips = makeChips(E);
  const ackLabel = el('span', { class: 'ct-ack-main' });
  const ackSub = el('span', { class: 'ct-ack-sub' });
  const ack = el('button', { class: 'ct-ack', type: 'button' }, ackLabel, ackSub);
  const help = el('p', { class: 'ct-help' });
  const node = el('div', { class: 'ct-screen ct-night' }, head, bar, panel, chips.el, ack, help);

  // local, uncommitted state: who the thumb has picked
  let selected = [];
  let modeKey = '';
  let current = null;       // the view being shown (handlers read it)
  let bartotal = 1;
  let barDeadline = null;

  /** What a tap on a name means for this seat right now: 'peek', 'recruit' or a decoy. */
  function pickMode(v) {
    const night = v?.nightSeat;
    if (!night?.awake) return 'decoy';
    if (night.peek?.mode === 'can') return 'peek';
    if (night.recruit) return 'recruit';
    return 'decoy';
  }

  function tapChip(pid) {
    const v = current;
    if (!v) return;
    const night = v.nightSeat;
    const mode = pickMode(v);
    if (mode === 'recruit') {
      if (!night.recruit.among.includes(pid)) return;      // 5p: witnesses only
      if (selected.includes(pid)) selected = selected.filter((x) => x !== pid);
      else if (selected.length < night.recruit.count) selected = [...selected, pid];
      else selected = [...selected.slice(1), pid];
    } else if (mode === 'peek' && !night.peek.targets.includes(pid)) {
      return;
    } else {
      // a peek and a sleeper's decoy behave the same: one name lit, tap again to clear
      selected = selected.includes(pid) ? [] : [pid];
    }
    paint();
  }

  function onAck() {
    const v = current;
    if (!v) return;
    const night = v.nightSeat;
    const mode = pickMode(v);
    if (mode === 'peek' && selected.length === 1) { api.send({ type: 'peek', target: selected[0] }); selected = []; paint(); return; }
    if (mode === 'recruit' && selected.length === night.recruit.count) { api.send({ type: 'recruit', targets: selected.slice() }); selected = []; paint(); return; }
    if (night?.awake && night.steal?.can) { api.send({ type: 'steal' }); return; }
    // the decoy: a sleeper's name tap is cleared exactly like a sent peek
    if (selected.length) { selected = []; paint(); }
    api.send({ type: 'ack' });
  }
  ack.addEventListener('click', onAck);

  /** Everything that depends on the current view and the local selection. */
  function paint() {
    const view = current;
    const night = view.nightSeat;
    const step = view.step;
    const awake = !!night.awake;

    const [ic, tt] = stepHead(step);
    setText(icon, ic);
    setText(title, tt);

    // info card
    const ls = awake ? awakeLines(E, view) : sleepLines(step);
    const lsKey = sig(ls);
    if (lsKey !== lines.dataset.key) {
      lines.dataset.key = lsKey;
      lines.replaceChildren(...ls.map(([cls, text]) => el('p', { class: `ct-line ${cls}`, text })));
    }

    // peek result sits behind a cover: neighbours with open eyes (silent mode) cannot read it
    const done = awake ? night.peek?.done : null;
    setHidden(peekWrap, !done);
    if (done) {
      const k = sig(done);
      if (peekFront.dataset.key !== k) {
        peekFront.dataset.key = k;
        peekFront.replaceChildren(
          el('div', { class: 'ct-peeklabel', text: `${E.nameOf(done.target)} 粒骰` }),
          el('div', { class: 'dice-row' }, done.dice.map((d) => E.C.dieFace(d, 6))));
      }
      peekCover.update({ front: peekFront, backArt: '👁', backLabel: `㩒住睇 ${E.nameOf(done.target)} 粒骰`, lockMode: 'none', locked: false, openSound: 'none' });
    }

    // the grid: every phone shows the same tappable names; only this seat
    // knows whether a tap is a peek, a follower pick or a decoy
    const others = E.players().filter((p) => p.id !== E.api.me);
    const mode = pickMode(view);
    const key = `${step.ix}|${step.stage}|${mode}`;
    if (key !== modeKey) { modeKey = key; selected = []; }
    if (mode === 'recruit') selected = selected.filter((p) => night.recruit.among.includes(p));
    if (mode === 'peek') selected = selected.filter((p) => night.peek.targets.includes(p));
    chips.paint(others, { selected, tap: tapChip });

    // the one big button: same colour, size and big label on every phone at
    // every step (a glance across the table cannot tell a steal or a peek from
    // a decoy); only the small line under it says what this tap will do
    setText(ackLabel, ACK_MAIN);
    setText(ackSub, ackSubline(E, view, mode, selected));
    ack.classList.toggle('is-done', !!view.acked);

    const silent = view.__ctx?.narrationMode === 'silent';
    setText(help, silent
      ? '靜音模式：唔使閉眼、唔好抬頭、唔使摸手 — 望住自己部機，到你個鐘佢會亮。'
      : '夜晚唔好講嘢。每一步都照㩒大掣，咁就冇人知邊個醒。');
  }

  // the countdown bar: a plain element, no sound
  function tick() {
    const view = current;
    if (!view) return;
    const dl = view.deadline;
    if (dl == null || view.step.stage !== 'window') {
      barDeadline = null;
      bar.classList.add('is-wait');
      fill.style.transform = 'scaleX(1)';
      return;
    }
    if (dl !== barDeadline) { barDeadline = dl; bartotal = Math.max(1, dl - api.now()); }
    bar.classList.remove('is-wait');
    const r = Math.max(0, Math.min(1, (dl - api.now()) / bartotal));
    fill.style.transform = `scaleX(${r.toFixed(3)})`;
  }
  const timer = setInterval(tick, 120);

  return {
    el: node,
    update(view, ctx) {
      current = { ...view, __ctx: ctx };
      paint();
      tick();
    },
    destroy() { clearInterval(timer); peekCover.destroy(); node.remove(); },
  };
}

// ============================================================
// day: recap, cards, ready-to-vote
// ============================================================

/** One line of the private recap, in plain Cantonese. */
export function describeNote(note, E) {
  const { nameOf, names } = E;
  switch (note.k) {
    case 'woke': {
      const parts = [`${CLOCK[note.h]}點鐘你醒咗。`];
      parts.push(note.with.length ? `同你一齊醒：${names(note.with)}。` : '淨係得你醒。');
      if (note.thief === E.api.me) parts.push('你偷咗芝士。');
      else if (note.thief) parts.push(`${nameOf(note.thief)} 偷咗芝士（你睇到）。`);
      else parts.push(note.cheese === 'gone' ? '芝士已經唔見咗，唔知邊個偷。' : '芝士仲喺枱上。');
      if (note.picked && note.picked !== E.api.me) parts.push(`大盜揀咗 ${nameOf(note.picked)} 做共犯。`);
      return parts.join('');
    }
    case 'stole': return '';   // the 'woke' line already says it
    case 'peek': return `${CLOCK[note.h]}點鐘你偷睇咗 ${nameOf(note.target)} 粒骰：${note.dice.join(' ')}。`;
    case 'recruited': return note.followers.length ? `你揀咗 ${names(note.followers)} 做共犯。` : '你冇共犯。';
    case 'follower': {
      const parts = ['你係共犯！'];
      parts.push(note.thief ? `大盜係 ${nameOf(note.thief)}。` : '你唔知大盜係邊個。');
      if (note.mates.length) parts.push(`另一位共犯：${names(note.mates)}。`);
      return parts.join('');
    }
    default: return '';
  }
}

function buildDay(E) {
  const { api, C } = E;
  const banner = el('div', { class: 'ct-banner', text: '☀️ 天光喇！芝士唔見咗！' });
  const badge = followerBadge(E);
  const timerSlot = el('div', { class: 'ct-timer', hidden: true });
  let timer = null;

  const lead = el('p', { class: 'ct-lead', text: '自由討論，可以講大話。唔可以畀人睇你張牌、唔可以亮骰。' });

  const recapFront = el('div', { class: 'ct-recap' });
  const recapCover = C.Cover({ front: recapFront, backArt: '📓', backLabel: '㩒住睇你嘅夜晚記錄', lockMode: 'none', locked: false, openSound: 'flip' });
  const recapWrap = el('div', { class: 'ct-recapwrap' }, el('h3', { class: 'ct-h', text: '📓 你嘅夜晚記錄' }), recapCover.el);

  const roleCard = makeRoleCard(E);
  const cup = C.DiceCup({ dice: null, sides: 6, rollSeq: 0, canRoll: false, lockedRoll: true, shakeToRoll: false });

  let mine = false;
  const readyBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => api.send({ type: 'day-ready', on: !mine }) });
  const count = el('p', { class: 'ct-count' });

  const node = el('div', { class: 'ct-screen ct-day' }, banner, badge.el, timerSlot, readyBtn, count, lead, recapWrap, roleCard.el, cup.el);

  return {
    el: node,
    update(view, ctx) {
      badge.update(view);
      roleCard.update(view);
      cup.update({ dice: view.my.dice, sides: 6, rollSeq: view.my.rollSeq, canRoll: false, lockedRoll: true, shakeToRoll: false });

      // timer
      if (view.deadline != null) {
        const props = { deadline: view.deadline, now: api.now, label: view.timerLabel ?? '討論時間', paused: !!ctx?.paused, warnAt: [60, 10] };
        if (!timer) { timer = C.Timer(props); timerSlot.replaceChildren(timer.el); } else timer.update(props);
      } else if (timer) { timer.destroy(); timer = null; timerSlot.replaceChildren(); }
      setHidden(timerSlot, view.deadline == null);

      // recap
      const showRecap = view.opts?.recap !== false;
      setHidden(recapWrap, !showRecap);
      if (showRecap) {
        const notes = (view.notes ?? []).map((n) => describeNote(n, E)).filter(Boolean);
        const k = sig(notes);
        if (recapFront.dataset.key !== k) {
          recapFront.dataset.key = k;
          recapFront.replaceChildren(el('ul', {},
            (notes.length ? notes : ['你夜晚冇醒過，咩都冇見到。']).map((t) => el('li', { text: t }))));
        }
        recapCover.update({ front: recapFront, backArt: '📓', backLabel: '㩒住睇你嘅夜晚記錄', lockMode: 'none', locked: false, openSound: 'flip' });
      }

      mine = !!view.dayReady?.mine;
      readyBtn.classList.toggle('btn-locked', mine);
      setText(readyBtn, mine ? '✓ 我夠鐘投票 — 等緊其他人（㩒一下取消）' : '🗳️ 我哋夠鐘投票');
      setText(count, `想投票：${view.dayReady.done} / ${view.dayReady.total}（全部人都想先會開始${view.deadline != null ? '，或者時間到' : ''}）`);
    },
    destroy() { timer?.destroy(); roleCard.destroy(); cup.destroy(); recapCover.destroy(); node.remove(); },
  };
}

// ============================================================
// vote
// ============================================================

function buildVote(E) {
  const { api, C } = E;
  const badge = followerBadge(E);
  const lead = el('p', { class: 'ct-lead', text: '邊個係芝士大盜？揀一個，確定。全部人投晒就同時公開。' });
  const panel = C.VotePanel({ players: [], candidates: [], me: api.me, progress: { done: 0, total: 0 }, reveal: null, onVote: () => {} });
  const node = el('div', { class: 'ct-screen ct-vote' }, badge.el, lead, panel.el);
  return {
    el: node,
    update(view) {
      badge.update(view);
      panel.update({
        players: E.players(), candidates: view.candidates, me: api.me,
        myVote: view.myVote, allowAbstain: false, allowChange: true,
        progress: view.progress, reveal: null, title: '投票',
        onVote: (pid) => { if (pid) api.send({ type: 'vote', target: pid }); },
      });
    },
    destroy() { panel.destroy(); node.remove(); },
  };
}

// ============================================================
// reveal / over — public, same for seats and the table screen
// ============================================================

function roleLabel(role) {
  const r = ROLES[role];
  return r ? `${r.emoji} ${r.name}` : '';
}

function buildReveal(E) {
  const { api, C } = E;
  const panel = C.VotePanel({ players: [], candidates: [], me: api.me, progress: { done: 0, total: 0 }, reveal: { counts: {}, top: [] } });
  const cards = el('div', { class: 'ct-revealed' });
  const wait = el('p', { class: 'ct-count', text: '等陣就睇結果…' });
  const node = el('div', { class: 'ct-screen ct-reveal' }, el('div', { class: 'ct-banner', text: '🎯 開牌！' }), panel.el, cards, wait);
  return {
    el: node,
    update(view) {
      const players = E.players();
      panel.update({
        players, candidates: players.map((p) => p.id), me: api.me,
        reveal: view.reveal, title: '得票',
      });
      const ks = sig(view.revealed);
      if (cards.dataset.key !== ks) {
        cards.dataset.key = ks;
        cards.replaceChildren(...view.revealed.map((r) => el('div', { class: `ct-rcard role-${r.role}` },
          el('div', { class: 'ct-rcard-name', text: E.nameOf(r.pid) }),
          el('div', { class: 'ct-rcard-role', text: roleLabel(r.role) }))));
      }
    },
    destroy() { panel.destroy(); node.remove(); },
  };
}

function buildOver(E) {
  const { api } = E;
  const banner = el('div', { class: 'ct-banner big' });
  const sum = el('p', { class: 'ct-lead strong' });
  const facts = el('p', { class: 'ct-lead' });
  const list = el('ul', { class: 'ct-debrief' });
  const recap = el('ul', { class: 'ct-nightrecap' });
  const recapWrap = el('div', { class: 'ct-recapwrap' }, el('h3', { class: 'ct-h', text: '🌙 夜晚重溫' }), recap);
  const node = el('div', { class: 'ct-screen ct-over' }, banner, sum, facts, list, recapWrap);
  return {
    el: node,
    update(view) {
      const me = api.me;
      const won = me ? view.winners.includes(me) : null;
      setText(banner, won == null ? '🧀 完咗' : won ? '🎉 你贏咗！' : '😿 你輸咗');
      node.classList.toggle('won', !!won);
      setText(sum, view.summary);
      setText(facts, view.cheese.by
        ? `芝士喺${CLOCK[view.cheese.hour]}點鐘畀 ${E.nameOf(view.cheese.by)} 偷走。`
        : '');
      const k = sig(view.debrief) + sig(view.winners);
      if (list.dataset.key !== k) {
        list.dataset.key = k;
        list.replaceChildren(...view.debrief.map((d) => el('li', { class: d.thief ? 'is-thief' : '' },
          el('span', { class: 'dot', style: { '--seat': E.colorOf(d.pid) } }),
          el('span', { class: 'nm', text: E.nameOf(d.pid) + (d.pid === me ? '（你）' : '') }),
          el('span', { class: 'rl', text: roleLabel(d.role) + (d.follower ? ' · 🤝共犯' : '') }),
          el('span', { class: 'dice-mini', text: `🎲 ${d.dice.join(' ')}` }),
          view.winners.includes(d.pid) ? el('span', { class: 'tag ok', text: '贏' }) : null)));
      }
      const lines = view.recap ?? [];
      setHidden(recapWrap, !lines.length);
      const rk = sig(lines);
      if (recap.dataset.key !== rk) {
        recap.dataset.key = rk;
        recap.replaceChildren(...lines.map((t) => el('li', { text: t })));
      }
    },
    destroy() { node.remove(); },
  };
}

// ============================================================
// table screen (spectators, a host who is not playing)
// ============================================================

function buildTable(E) {
  const { api, C } = E;
  const title = el('h2', { class: 'ct-table-title' });
  const body = el('p', { class: 'ct-lead' });
  const fill = el('i');
  const bar = el('div', { class: 'ct-bar', hidden: true }, fill);
  const count = el('p', { class: 'ct-count' });
  const timerSlot = el('div', { class: 'ct-timer', hidden: true });
  let timer = null;
  let total = 1, dlSeen = null;
  const node = el('div', { class: 'ct-screen ct-table' }, title, body, bar, timerSlot, count);
  let current = null;

  function tick() {
    const v = current;
    if (!v || v.phase !== 'night') return;
    const dl = v.deadline;
    if (dl == null || v.step.stage !== 'window') { bar.classList.add('is-wait'); fill.style.transform = 'scaleX(1)'; return; }
    if (dl !== dlSeen) { dlSeen = dl; total = Math.max(1, dl - api.now()); }
    bar.classList.remove('is-wait');
    fill.style.transform = `scaleX(${Math.max(0, Math.min(1, (dl - api.now()) / total)).toFixed(3)})`;
  }
  const iv = setInterval(tick, 120);

  return {
    el: node,
    update(view, ctx) {
      current = view;
      setHidden(bar, view.phase !== 'night');
      switch (view.phase) {
        case 'roll':
          setText(title, '🎲 搖骰・睇牌');
          setText(body, '大家睇緊自己張牌、搖緊骰。');
          setText(count, `已準備 ${view.ready.done} / ${view.ready.total}`);
          break;
        case 'night': {
          setText(title, `🌙 ${view.subtitle}`);
          setText(body, '夜晚入面。邊個醒、做咗乜，只有佢自己知。');
          setText(count, `已㩒掣 ${view.acks.done} / ${view.acks.total}`);
          break;
        }
        case 'day':
          setText(title, '☀️ 日頭討論');
          setText(body, '芝士唔見咗！自由討論。');
          setText(count, `想投票：${view.dayReady.done} / ${view.dayReady.total}`);
          break;
        case 'vote':
          setText(title, '🗳️ 投票');
          setText(body, '大家揀緊邊個係大盜。');
          setText(count, `已投 ${view.progress.done} / ${view.progress.total}`);
          break;
        default: break;
      }
      if (view.deadline != null && view.phase === 'day') {
        const props = { deadline: view.deadline, now: api.now, label: view.timerLabel ?? '', paused: !!ctx?.paused, warnAt: [60, 10] };
        if (!timer) { timer = C.Timer(props); timerSlot.replaceChildren(timer.el); } else timer.update(props);
        setHidden(timerSlot, false);
      } else if (timer) { timer.destroy(); timer = null; timerSlot.replaceChildren(); setHidden(timerSlot, true); }
      tick();
    },
    destroy() { clearInterval(iv); timer?.destroy(); node.remove(); },
  };
}

// ============================================================
// mount
// ============================================================

const SEAT_SCREENS = { roll: buildRoll, night: buildNight, day: buildDay, vote: buildVote, reveal: buildReveal, over: buildOver };

export function mount(root, api) {
  const wrap = el('div', { class: 'ct' });
  root.append(wrap);

  const local = { roleLocked: false };    // survives screen changes: a locked card stays locked
  let screen = null;
  let key = null;
  let lastView = null;
  let lastCtx = {};

  const refresh = () => { if (lastView && screen) screen.update(lastView, lastCtx); };
  const E = makeEnv(api, local, refresh);

  function update(view, ctx = {}) {
    lastView = view;
    lastCtx = ctx;
    const seat = !!view.seat && !!view.my;
    const k = `${seat ? 'seat' : 'table'}:${view.phase}`;
    if (k !== key) {
      screen?.destroy();
      key = k;
      const build = seat || view.phase === 'reveal' || view.phase === 'over'
        ? (SEAT_SCREENS[view.phase] ?? buildTable)
        : buildTable;
      screen = build(E);
      wrap.replaceChildren(screen.el);
    }
    wrap.dataset.phase = view.phase;
    wrap.classList.toggle('is-paused', !!ctx.paused);
    screen.update(view, ctx);
  }

  return {
    update,
    destroy() {
      screen?.destroy();
      screen = null;
      wrap.remove();
    },
  };
}
