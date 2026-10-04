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

import { el } from '../../ui/dom.js?v=1';
import { rules } from './game.js?v=1';
import { CLOCK } from './script.js?v=1';

const ROLES = Object.fromEntries(rules.roles.map((r) => [r.id, r]));

// ---------- tiny DOM helpers (write only when something changed) ----------

function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
function setHidden(node, hidden) { if (node.hidden !== !!hidden) node.hidden = !!hidden; }

const sig = (x) => JSON.stringify(x ?? null);

// ---------- text helpers ----------

/**
 * The role card, tuned to this head-count so nobody has to read the rulebook.
 * Everything here is drawn on the card's FRONT, which only shows while its owner
 * holds it — so a recruited 共犯 (and who it knows) is never readable at a glance.
 */
export function roleFor(my, n, opts, nameOf = (p) => p) {
  const names = (ids) => (ids ?? []).map(nameOf).join('、');
  const crew = my.crew ?? null;
  if (my.follower && (my.role === 'sleepyhead' || my.role === 'fall-mouse')) {
    const knows = [
      crew?.thief ? `大盜係 ${nameOf(crew.thief)}。` : '你唔知大盜係邊個。',
      crew?.mates?.length ? `另一位共犯：${names(crew.mates)}。` : '',
    ].join('');
    if (my.role === 'fall-mouse') {
      return {
        emoji: '🎭', name: '背鍋鼠＋共犯', team: 'solo',
        text: `${knows} 做乜：你仍然係背鍋鼠，天光扮可疑。點贏：你喺最高票（平票都算）就一個人贏；唔會跟大盜隊贏。`,
      };
    }
    const f = ROLES.follower;
    return { emoji: f.emoji, name: f.name, team: f.team, text: `${knows} ${f.text}` };
  }
  const base = ROLES[my.role];
  if (!base) return null;
  let text = base.text;
  if (my.role === 'thief') {
    if (n === 4) text += ' 4 人局：你有兩粒骰，兩個點鐘都會醒，揀其中一次偷；平票都算你贏。';
    else if (n === 5 && !opts?.pick5) text += ' 偷芝士時如果有貪瞓鼠一齊醒，你指一位做共犯。';
    else if (n === 5 || n === 6) text += ' 夜晚尾你揀 1 位共犯。';
    else text += ' 夜晚尾你揀 2 位共犯。';
    if (crew?.mates?.length) text += ` 你嘅共犯：${names(crew.mates)}。`;
  } else if (my.role === 'sleepyhead') {
    if (n === 4) text += ` 4 人局：兩粒骰揀一粒做醒鐘。${opts?.peek4 ? '（今局家規：淨係得你醒都可以偷睇。）' : ''}`;
  }
  return { emoji: base.emoji, name: base.name, team: base.team, text };
}

/**
 * Dawn: the same line on EVERY phone (thief, follower, sleepyhead alike), under the
 * role card — never a banner at the top, and it never says whether anything changed.
 * Only from 5 players up: no 4p game ever has a follower.
 */
export const RECHECK = '🔁 天光喇：再㩒住睇一次你張身份牌 — 夜晚可能有人畀大盜拉咗做共犯。';
export const RECHECK_DONE = '✓ 睇咗。記住：身份牌嘅嘢唔好畀人睇到。';

/** Under every peek (the same for every peeker, so it says nothing): a missed result is kept for the day. */
export const PEEK_LATER = '睇唔切唔緊要：天光喺 📓 夜晚記錄睇得返。';

/** 💤 seats the host marked absent (D4): public, the same on every phone. */
export const ABSENT_MARK = '💤';
export const ABSENT_SELF = '💤 房主當咗你暫時離開，今次唔使投票。返嚟咗就同房主講聲。';
export const absentLine = (names) => `💤 暫時離開（唔使等）：${names}`;

/** One phone in the middle: the countdown when a window ran out, and what the holder does now (#7). */
export const TIME_UP = '⏰ 時間到';
export const TIME_UP_SHARED = '⏰ 時間到 — 部手機擺返中間，閉眼';

function readyLead(my, view, shared = false) {
  if (my.ready) {
    return shared
      ? '好喇，交俾下一位。全部人準備好，夜晚就會開始。'
      : '好喇。等其他人準備好，夜晚就會開始 — 部手機放喺面前，唔好鎖機（一鎖就斷線，到你醒都冇嘢睇）。';
  }
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
  /** The players for a VotePanel: an absent seat's name carries the public 💤. */
  const markedPlayers = (view) => {
    const away = new Set(view?.absent ?? []);
    return players().map((p) => (away.has(p.id) ? { ...p, name: `${p.name} ${ABSENT_MARK}` } : p));
  };
  /** One public line naming the 💤 seats, or '' when nobody is away. */
  const awayText = (view) => (view?.absent?.length ? absentLine(names(view.absent)) : '');
  // §7.1 one phone: a phone holding 2+ seats (the whole table: every seated player). A single-seat phone sees neither.
  const shared = () => !!api.shared;
  const whole = () => !!api.wholeTable;
  /** Who a screen the table reads calls 「你」: nobody on a shared phone (#20) — it is read by everyone at once. */
  const me = () => (shared() ? null : api.me);
  /** Act as one of this phone's co-wakers (U2); a shell without sendAs can only act as the seat on screen. */
  const sendAs = (pid, action) => {
    if (typeof api.sendAs === 'function') return api.sendAs(pid, action);
    return pid === api.me ? api.send(action) : false;
  };
  return { api, C: api.components, local, refresh, players, nameOf, colorOf, names, markedPlayers, awayText, shared, whole, me, sendAs };
}

/**
 * The role card, shared by the roll and day screens. `onOpen(open)` fires when its owner lifts it.
 * On a shared phone there is no 🔓 lock (#36): it would live only until the phone changes hands (every seat is mounted
 * afresh), any holder could undo it, and every hand-over goes through a gate that closes the cover anyway.
 */
function makeRoleCard(E, { onOpen } = {}) {
  const toggle = () => { E.local.roleLocked = !E.local.roleLocked; E.refresh(); };
  const card = E.C.RoleCard({
    role: null,
    locked: E.shared() ? false : E.local.roleLocked,
    onLockToggle: E.shared() ? undefined : toggle,
  });
  return {
    el: card.el,
    update(view) {
      const locked = !E.shared() && E.local.roleLocked;
      card.update({
        role: roleFor(view.my, view.n, view.opts, E.nameOf),
        locked,
        onLockToggle: E.shared() ? undefined : toggle,
        hint: locked ? '已鎖定，㩒下面解鎖' : '㩒住先睇到，放手即刻冚返',
        onOpen,
      });
    },
    destroy() { card.destroy(); },
  };
}

/** Your own dice, as the role-card screens show them: a peek-only cup (it stands after the roll). */
function cupProps(view, extra = {}) {
  return { dice: view.my.dice, sides: 6, rollSeq: view.my.rollSeq, canRoll: false, lockedRoll: true, lockedLabel: '🔒 已鎖定', shakeToRoll: false, ...extra };
}

// ============================================================
// roll: card, cup, (4p) which die, ready
// ============================================================

/** 「夜晚點玩？」 — one phone each. */
const OWN_NIGHT_TIP = [
  '手機會逐個點鐘報時。擲到幾點，就喺嗰個點鐘睜眼 — 到時你部機會自動亮起，話你知邊個同你一齊醒、芝士仲喺唔喺度。',
  '偷睇骰喺你自己部機做：淨係得你醒嗰陣，㩒個名再㩒大掣就睇到。唔使掂人哋部機 — 夜晚其他人部機係黑嘅。',
  '每個點鐘（連你瞓緊嗰陣）都喺手機下半部大掣㩒一下，咁就冇人聽得出邊個醒。',
];
/** 「夜晚點玩？」 — one phone in the middle (#19: these lines replace the ones above, nothing is added). */
const SHARED_NIGHT_TIP = [
  '夜晚部手機擺喺枱中間，全部人閉眼。報到你擲到嗰個點鐘，先拎起部手機㩒交接卡：會見到邊個同你一齊醒、芝士仲喺唔喺度。',
  '淨係得你醒（貪瞓鼠）：㩒一個名就即刻睇佢粒骰。睇完㩒大掣，部手機擺返中間再閉眼。',
  '同一個鐘幾個人醒：一齊望同一個畫面；自己粒骰㩒自己個名先睇，其他人望開。',
];

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
  const away = el('p', { class: 'ct-count ct-away', hidden: true });
  const tip = el('details', { class: 'ct-tip' },
    el('summary', { text: '夜晚點玩？' }),
    ...(E.shared() ? SHARED_NIGHT_TIP : OWN_NIGHT_TIP).map((t) => el('p', { text: t })));

  // your dice sit ABOVE your card (as in v1): the number is what you need again and again
  const node = el('div', { class: 'ct-screen ct-roll' }, lead, cup.el, choose, roleCard.el, readyBtn, count, away, tip);

  return {
    el: node,
    update(view) {
      const my = view.my;
      dice = my.dice ?? [];
      setText(lead, readyLead(my, view, E.shared()));
      roleCard.update(view);
      cup.update({
        dice: my.dice, sides: 6, rollSeq: my.rollSeq,
        canRoll: !my.locked && !my.ready,
        lockedRoll: my.locked,
        onRoll: () => api.send({ type: 'roll' }),
        onLock: view.opts?.reroll ? () => api.send({ type: 'lock' }) : undefined,
        lockedLabel: '🔒 已鎖定',
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
      setText(away, E.awayText(view));
      setHidden(away, !away.textContent);
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
     * On a one-seat phone every chip stays tappable and looks the same on every phone: a sleeper's decoy taps
     * highlight a name exactly like a peek or a follower pick does. `selected`: pids shown as picked.
     * `live` (a shared phone only, #36): the pids that may be tapped — nobody there needs a decoy, so the rest are
     * dimmed and a waker with nothing to pick is not left wondering what the names are for.
     */
    paint(list, { selected, tap, live = null }) {
      ensure(list);
      onTap = tap;
      grid.classList.toggle('is-dim', !!live && !live.length);
      for (const c of chips) {
        c.b.disabled = !!live && !live.includes(c.pid);
        c.b.classList.toggle('on', selected.includes(c.pid));
      }
    },
  };
}

/**
 * The night countdown: a plain bar (no sound, no Timer — its ticks would tell the room who is awake) drawn from the
 * step's FIXED length (`view.step.windowMs`, #7), so a screen that mounts half-way through a window — a shared phone,
 * after its gate — shows the time already gone. The seconds left are written next to it; when they run out on a shared
 * phone the line says to put the phone back. Every phone's bar is the same (the length is public).
 */
function makeBar(E) {
  const fill = el('i');
  const bar = el('div', { class: 'ct-bar', role: 'progressbar', 'aria-valuemin': '0' }, fill);
  const words = el('span', { class: 'ct-bar-text', 'aria-hidden': 'true' });
  const node = el('div', { class: 'ct-barwrap' }, bar, words);
  let total = 1;
  let seen = null;
  return {
    el: node,
    tick(view, ctx) {
      const dl = view?.deadline;
      if (dl == null || view.step?.stage !== 'window') {
        seen = null;
        bar.classList.add('is-wait');
        fill.style.transform = 'scaleX(1)';
        setText(words, '');
        return;
      }
      if (ctx?.paused) return;                 // the host paused: the bar stays where it is
      const fixed = Number(view.step.windowMs);
      if (dl !== seen) { seen = dl; total = Math.max(1, fixed > 0 ? fixed : dl - E.api.now()); }
      const left = Math.max(0, dl - E.api.now());
      const sec = Math.ceil(left / 1000);
      const text = sec > 0 ? `仲有 ${sec} 秒` : E.shared() ? TIME_UP_SHARED : TIME_UP;
      bar.classList.remove('is-wait');
      fill.style.transform = `scaleX(${Math.min(1, left / total).toFixed(3)})`;
      setText(words, text);
      bar.setAttribute('aria-valuemax', String(Math.round(total / 1000)));
      bar.setAttribute('aria-valuenow', String(sec));
      bar.setAttribute('aria-valuetext', text);
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
    case 'begin': return [['head', '🌙 天黑'], ['sub', '閉埋眼，部手機放低（唔好鎖機），唔好偷望。']];
    case 'open':
      return step.stage === 'window'
        ? [['head', '💤 瞓緊'], ['sub', '呢個鐘冇你份。閉住眼，等報下一點。']]
        : [['head', '🌙 聽住報時…'], ['sub', '如果擲到呢個點數，等報完先會有嘢睇。']];
    case 'close': return [['head', '😴 閉返眼'], ['sub', '等下一點。']];
    case 'dawn': return [['head', '🌅 天光喇'], ['sub', '可以睜眼喇。']];
    default: return [['head', '🤝 共犯環節'], ['sub', '唔關你事，繼續閉眼。']];
  }
}

/**
 * The awake card of a seat alone on a shared phone (#7): three short lines at most — the window also has to cover
 * reaching for the phone with eyes closed, so there is no time for a paragraph.
 */
function awakeLinesShared(E, view) {
  const { nameOf, names } = E;
  const night = view.nightSeat;
  const step = view.step;
  const my = view.my;
  const me = E.api.me;
  const L = [];
  L.push(['with', night.with.length ? `👀 同你一齊醒：${names(night.with)}` : '👀 淨係得你醒。']);
  if (night.thief === me) L.push(['cheese', '🧀 你偷走咗芝士！收好佢。']);
  else if (night.thief) L.push(['cheese hot', `🧀 ${nameOf(night.thief)} 偷走咗芝士！`]);
  else L.push(['cheese', night.cheese === 'gone' ? '🧀 芝士已經唔見咗，唔知邊個偷。' : '🧀 芝士仲喺枱上。']);
  const pk = night.peek;
  if (night.steal?.can) {
    const other = my.wake.filter((h) => h !== step.h).map((h) => CLOCK[h]).join('、');
    L.push(['role', other ? `而家偷，定係等${other}點鐘？㩒大掣＝而家偷。` : '你一定要偷：㩒大掣＝偷。']);
  } else if (night.steal?.twoWakes && night.cheese === 'gone') {
    L.push(['note', '你已經偷咗，今次淨係睇下邊個醒。']);
  } else if (night.recruit) {
    L.push(['role', `🤝 揀 ${night.recruit.count} 位同你一齊醒嘅人做共犯：㩒名，再㩒大掣。`]);
  } else if (night.picked) {
    L.push(['cheese hot', night.picked === me && my.follower ? '🤝 你畀大盜揀咗做共犯！' : `🤝 大盜揀咗 ${nameOf(night.picked)} 做共犯。`]);
  } else if (pk.mode === 'can') {
    L.push(['role', '👁 㩒一個名就即刻偷睇佢粒骰（得一次）。']);
  } else if (pk.done && view.opts?.recap !== false) {
    L.push(['note', PEEK_LATER]);
  }
  return L;
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
    if (E.shared()) return awakeLinesShared(E, view);
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
    if (pk.mode === 'can') L.push(['role', '👁 你可以偷睇一粒骰（得一次）：㩒個名，再㩒大掣。唔想睇就直接㩒大掣。']);
    // a peeker whose hour runs out before it holds the cover: the die is in the day's 📓 (only when the table keeps one)
    if ((pk.mode === 'can' || pk.done) && view.opts?.recap !== false) L.push(['note', PEEK_LATER]);
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
/** A shared phone: nobody there taps a decoy — the last tap means "seen it", and the phone goes back (#19, #36). */
export const ACK_SHARED = '睇完就㩒，部手機擺返中間';

/** The small line under the big button: what this seat's tap will do now. */
function ackSubline(E, view, mode, selected) {
  const night = view.nightSeat;
  const shared = E.shared() && !!night?.awake;
  if (mode === 'peek') {
    // a shared phone peeks on the name itself (one tap); the big button then only skips the peek
    if (shared) return '唔想睇就㩒呢度，部手機擺返中間';
    return selected.length ? `㩒落去就睇 ${E.nameOf(selected[0])} 粒骰（得一次）` : '揀咗名先會睇到；唔想睇就直接㩒';
  }
  if (mode === 'recruit') {
    const c = night.recruit.count;
    return selected.length === c ? `㩒落去就揀 ${E.names(selected)} 做共犯` : `喺上面揀 ${c} 位（${selected.length}/${c}）`;
  }
  if (night?.awake && night.steal?.can) return '㩒落去＝而家偷芝士；想等就唔好㩒';
  return shared ? ACK_SHARED : ACK_DECOY;
}

/** The help line under the button. A shared phone never says 「望住自己部機」 (#19). */
function nightHelp(E, view) {
  const silent = view.__ctx?.narrationMode === 'silent';
  if (E.shared()) {
    return silent
      ? '靜音模式：睇完就放返部手機喺枱中間，唔好抬頭望人。'
      : '夜晚唔好講嘢。睇完就㩒大掣，部手機擺返枱中間，閉返眼。';
  }
  return silent
    ? '靜音模式：唔使閉眼、唔好抬頭、唔使摸手 — 望住自己部機，到你個鐘佢會亮。'
    : '夜晚唔好講嘢。每一步都照㩒大掣，咁就冇人知邊個醒。';
}

function buildNight(E) {
  const { api, C } = E;
  const icon = el('span', { class: 'ct-n-icon' });
  const title = el('b', { class: 'ct-n-title' });

  // your own dice, one hold away, in the top row of every phone's night screen (the
  // same silent cover on every seat, so it says nothing at a glance; it shares the
  // title row so the big button stays where thumbs expect it on a small phone)
  const myDiceFront = el('div', { class: 'ct-mydice-front' });
  const myDiceProps = () => ({ front: myDiceFront, backArt: '🎲', backLabel: '你粒骰', lockMode: 'none', locked: false, openSound: 'none', ariaLabel: '㩒住睇你粒骰' });
  const myDice = C.Cover(myDiceProps());
  const myDiceWrap = el('div', { class: 'ct-mydice' }, myDice.el);

  const head = el('div', { class: 'ct-n-head' }, el('span', { class: 'ct-n-side' }), el('div', { class: 'ct-n-mid' }, icon, title), myDiceWrap);
  const bar = makeBar(E);

  const lines = el('div', { class: 'ct-lines' });
  const peekFront = el('div', { class: 'ct-peekfront' });
  const peekCover = C.Cover({ front: peekFront, backArt: '👁', backLabel: '㩒住睇結果', lockMode: 'none', locked: false, openSound: 'none' });
  const peekWrap = el('div', { class: 'ct-peekwrap', hidden: true }, peekCover.el);
  // the peek result goes FIRST in the fixed-height card, so it is never below the fold
  // (a 10 s hour leaves no time to go looking for it)
  const panel = el('div', { class: 'ct-panel' }, peekWrap, lines);

  const chips = makeChips(E);
  const ackLabel = el('span', { class: 'ct-ack-main' });
  const ackSub = el('span', { class: 'ct-ack-sub' });
  const ack = el('button', { class: 'ct-ack', type: 'button' }, ackLabel, ackSub);
  const help = el('p', { class: 'ct-help' });
  const node = el('div', { class: 'ct-screen ct-night' }, head, bar.el, panel, chips.el, ack, help);

  // local, uncommitted state: who the thumb has picked
  let selected = [];
  let modeKey = '';
  let current = null;       // the view being shown (handlers read it)

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
    } else if (mode === 'peek' && E.shared()) {
      // #7: on a shared phone the peek is ONE tap — the two-tap gesture only exists so a peek looks like a sleeper's
      // decoy on a phone of its own, and nobody taps decoys on the phone in the middle
      selected = [];
      api.send({ type: 'peek', target: pid });
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

    // your own dice (silent, same on every phone)
    const md = sig(view.my?.dice ?? null);
    if (myDiceFront.dataset.key !== md) {
      myDiceFront.dataset.key = md;
      myDiceFront.replaceChildren(el('div', { class: 'dice-row' }, (view.my?.dice ?? []).map((d) => E.C.dieFace(d, 6))));
    }
    myDice.update(myDiceProps());

    // peek result sits behind a cover: neighbours with open eyes (silent mode) cannot read it
    const done = awake ? night.peek?.done : null;
    const wasHidden = peekWrap.hidden;
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
      if (wasHidden && typeof panel.scrollTo === 'function') panel.scrollTo({ top: 0 });   // the result is first in the card
    }

    // the grid: every one-seat phone shows the same tappable names; only this seat knows whether a tap is a peek,
    // a follower pick or a decoy. A shared phone lights only the names a tap can use (#36).
    const others = E.players().filter((p) => p.id !== E.api.me);
    const mode = pickMode(view);
    const key = `${step.ix}|${step.stage}|${mode}`;
    if (key !== modeKey) { modeKey = key; selected = []; }
    if (mode === 'recruit') selected = selected.filter((p) => night.recruit.among.includes(p));
    if (mode === 'peek') selected = selected.filter((p) => night.peek.targets.includes(p));
    const live = !E.shared() ? null
      : mode === 'peek' ? night.peek.targets
        : mode === 'recruit' ? night.recruit.among
          : [];
    chips.paint(others, { selected, tap: tapChip, live });

    // the one big button: same colour, size and big label on every phone at
    // every step (a glance across the table cannot tell a steal or a peek from
    // a decoy); only the small line under it says what this tap will do
    setText(ackLabel, ACK_MAIN);
    setText(ackSub, ackSubline(E, view, mode, selected));
    ack.classList.toggle('is-done', !!view.acked);

    setText(help, nightHelp(E, view));
  }

  const timer = setInterval(() => { if (current) bar.tick(current, current.__ctx); }, 120);

  return {
    el: node,
    update(view, ctx) {
      current = { ...view, __ctx: ctx };
      paint();
      bar.tick(current, ctx);
    },
    destroy() { clearInterval(timer); peekCover.destroy(); myDice.destroy(); node.remove(); },
  };
}

// ============================================================
// night on a shared phone, several of its seats awake in one step (U2): ONE combined screen
// ============================================================
//
// They have their eyes open together and may see each other, so whatever all of them saw is written once, in the
// third person (who is awake, the cheese, the thief's pick at a 5p theft, who the crew is at the meeting). Whatever
// only ONE of them knows or may do (their own die; a 4p thief's choice to steal now or wait; a 7p follower who did or
// did not watch the theft) sits behind that seat's own 「🤫 名」 panel, which looks the same for every co-waker; the
// others look away while it is open. Every action goes out for the seat it belongs to (api.sendAs); the plain tap
// acks for all of them at once (`seats`). Nothing here ends the window early — it runs its fixed length.

/** The co-wakers on this screen and their own views (the mounted seat's is `view`). */
function coList(E, view, ctx) {
  const co = Array.isArray(ctx?.coWakers) ? ctx.coWakers : [];
  return co
    .map((pid) => ({ pid, v: ctx?.views?.[pid] ?? (pid === E.api.me ? view : null) }))
    .filter((x) => x.v?.nightSeat?.awake);
}

/** Everybody awake right now, in seat order: these co-wakers plus anyone their views name (seats on other phones). */
function awakeAll(E, list) {
  const set = new Set(list.flatMap((x) => [x.pid, ...(x.v.nightSeat.with ?? [])]));
  return E.players().map((p) => p.id).filter((p) => set.has(p));
}

/** The lines every co-waker reads together. */
function coSharedLines(E, step, list) {
  const { nameOf, names } = E;
  const L = [];
  if (step.k === 'open') {
    L.push(['head', `👀 你哋一齊醒：${names(awakeAll(E, list))}`]);
    // the theft is written for all only when every one of them saw it (a 4p thief's later wake: only it knows)
    const seen = list.map((x) => x.v.nightSeat.thief ?? null);
    const gone = list.some((x) => x.v.nightSeat.cheese === 'gone');
    if (seen[0] && seen.every((t) => t === seen[0])) L.push(['cheese hot', `🧀 ${nameOf(seen[0])} 偷走咗芝士 — 你哋都睇到！`]);
    else L.push(['cheese', gone ? '🧀 芝士已經唔見咗。' : '🧀 芝士仲喺枱上。']);
    const owner = list.find((x) => x.v.nightSeat.recruit);
    if (owner) {
      const r = owner.v.nightSeat.recruit;
      L.push(['role', `🤝 ${nameOf(owner.pid)} 要喺 ${names(r.among)} 入面揀 ${r.count} 位做共犯：㩒名，再㩒大掣。唔揀，時間到會隨機揀。`]);
    }
    const picked = list.map((x) => x.v.nightSeat.picked).find(Boolean);
    if (picked) L.push(['cheese hot', `🤝 大盜揀咗 ${nameOf(picked)} 做共犯。`]);
    return L;
  }
  if (step.k === 'rec-meet') {
    const thief = list.find((x) => x.v.my?.role === 'thief');
    if (thief) {
      L.push(['head', '🤝 認人']);
      L.push(['with', `大盜：${nameOf(thief.pid)} · 共犯：${names(thief.v.nightSeat.meet?.mates ?? [])}`]);
    } else {
      const crew = new Set(list.flatMap((x) => [x.pid, ...(x.v.nightSeat.meet?.mates ?? [])]));
      L.push(['head', '🤝 你哋係共犯']);
      L.push(['with', `共犯：${names(E.players().map((p) => p.id).filter((p) => crew.has(p)))}`]);
      // who the thief is: shared only when every one of them knows the same (7p: only who watched the theft)
      const known = list.map((x) => x.v.nightSeat.meet?.thief ?? null);
      if (known[0] && known.every((t) => t === known[0])) L.push(['with', `大盜係 ${nameOf(known[0])}。`]);
      else L.push(['note', '大盜係邊個：各自㩒自己個名睇。']);
    }
    return L;
  }
  return L;
}

/** What only this co-waker knows or may do — shown in its own 「🤫」 panel. */
function coPrivateLines(E, step, x, n) {
  const { nameOf } = E;
  const night = x.v.nightSeat;
  const my = x.v.my ?? {};
  const L = [];
  if (step.k === 'open') {
    if (night.steal?.can) {
      const other = (my.wake ?? []).filter((h) => h !== step.h).map((h) => CLOCK[h]).join('、');
      L.push(['role', other ? `你係大盜：而家偷，定係等${other}點鐘先偷？㩒大掣＝而家偷；想等就㩒「睇完」。` : '你係大盜：一定要偷，㩒大掣＝偷。']);
    } else if (my.role === 'thief') {
      L.push(['role', night.cheese === 'gone' ? '你係大盜：芝士係你偷嘅，記住邊個同你一齊醒。' : '你係大盜：記住邊個同你一齊醒。']);
    } else {
      L.push(['note', '冇嘢要做：記住邊個同你一齊醒。']);
    }
    return L;
  }
  if (step.k === 'rec-meet') {
    if (my.role === 'thief') { L.push(['role', '你係大盜：記住你嘅共犯。']); return L; }
    const meet = night.meet ?? {};
    L.push(['with', meet.thief ? (n === 7 ? `大盜係 ${nameOf(meet.thief)}（你夜晚親眼見到佢偷）。` : `大盜係 ${nameOf(meet.thief)}。`) : '你唔知大盜係邊個。']);
    L.push(['note', my.role === 'fall-mouse' ? '你同時係背鍋鼠：想贏就要畀人投中。' : '你同大盜一隊，夜晚唔可以傳遞骰仔資料。']);
    return L;
  }
  return L;
}

function buildCoNight(E) {
  const { api, C } = E;
  const icon = el('span', { class: 'ct-n-icon' });
  const title = el('b', { class: 'ct-n-title' });
  const head = el('div', { class: 'ct-n-head' }, el('span', { class: 'ct-n-side' }), el('div', { class: 'ct-n-mid' }, icon, title), el('span', { class: 'ct-n-side' }));
  const bar = makeBar(E);

  // --- what they all read together ---
  const lines = el('div', { class: 'ct-lines' });
  const chips = makeChips(E);
  const ownRow = el('div', { class: 'ct-co-own' });
  const ownTitle = el('p', { class: 'ct-co-ownlabel', text: '🤫 自己嘅嘢：㩒自己個名（其他人望開）' });
  const ackLabel = el('span', { class: 'ct-ack-main', text: ACK_MAIN });
  const ackSub = el('span', { class: 'ct-ack-sub' });
  const ack = el('button', { class: 'ct-ack', type: 'button' }, ackLabel, ackSub);
  const together = el('div', { class: 'ct-co-shared' }, el('div', { class: 'ct-panel' }, lines), chips.el, ownTitle, ownRow, ack);

  // --- one co-waker's own panel ---
  const privTitle = el('p', { class: 'ct-co-privtitle' });
  const privDice = el('div', { class: 'dice-row ct-co-dice' });
  const privLines = el('div', { class: 'ct-lines' });
  const privAckSub = el('span', { class: 'ct-ack-sub' });
  const privAck = el('button', { class: 'ct-ack', type: 'button' }, el('span', { class: 'ct-ack-main', text: ACK_MAIN }), privAckSub);
  const privBack = el('button', { class: 'btn btn-ghost ct-co-back', type: 'button', text: '↩ 睇完（交返大家）' });
  const own = el('div', { class: 'ct-co-priv' }, privTitle, el('div', { class: 'ct-panel' }, privDice, privLines), privAck, privBack);
  setHidden(own, true);

  const help = el('p', { class: 'ct-help' });
  const node = el('div', { class: 'ct-screen ct-night ct-co' }, head, bar.el, together, own, help);

  let current = null;
  let selected = [];
  let openSeat = null;      // the co-waker whose own panel is open
  let stepKey = '';

  const listNow = () => (current ? coList(E, current, current.__ctx) : []);
  const ownerNow = () => listNow().find((x) => x.v.nightSeat.recruit) ?? null;

  function tapChip(pid) {
    const owner = ownerNow();
    if (!owner) return;
    const r = owner.v.nightSeat.recruit;
    if (!r.among.includes(pid)) return;
    if (selected.includes(pid)) selected = selected.filter((x) => x !== pid);
    else if (selected.length < r.count) selected = [...selected, pid];
    else selected = [...selected.slice(1), pid];
    paint();
  }

  ack.addEventListener('click', () => {
    const list = listNow();
    const owner = ownerNow();
    if (owner && selected.length === owner.v.nightSeat.recruit.count) {
      E.sendAs(owner.pid, { type: 'recruit', targets: selected.slice() });
      selected = [];
      paint();
      return;
    }
    // "we have all seen it": one tap acks for every co-waker (never ends the window)
    api.send({ type: 'ack', seats: list.map((x) => x.pid) });
  });

  privAck.addEventListener('click', () => {
    const x = listNow().find((y) => y.pid === openSeat);
    if (!x) return;
    E.sendAs(x.pid, x.v.nightSeat.steal?.can ? { type: 'steal' } : { type: 'ack' });
  });
  privBack.addEventListener('click', () => { openSeat = null; paint(); });

  let ownKey = '';
  function paintOwnRow(list) {
    const k = sig(list.map((x) => x.pid));
    if (k === ownKey) return;
    ownKey = k;
    ownRow.replaceChildren(...list.map((x) => el('button', {
      class: 'btn btn-ghost btn-sm ct-co-me', type: 'button', style: { '--seat': E.colorOf(x.pid) },
      onclick: () => { openSeat = x.pid; paint(); },
    }, el('span', { class: 'dot' }), `🤫 ${E.nameOf(x.pid)}`)));
  }

  function paint() {
    const view = current;
    const step = view.step;
    const list = listNow();
    const n = view.n;

    const [ic, tt] = stepHead(step);
    setText(icon, ic);
    setText(title, tt);

    const k = `${step.ix}|${step.stage}|${sig(list.map((x) => x.pid))}`;
    if (k !== stepKey) { stepKey = k; selected = []; openSeat = null; }
    if (openSeat && !list.some((x) => x.pid === openSeat)) openSeat = null;

    // together
    const ls = coSharedLines(E, step, list);
    const lk = sig(ls);
    if (lines.dataset.key !== lk) {
      lines.dataset.key = lk;
      lines.replaceChildren(...ls.map(([cls, text]) => el('p', { class: `ct-line ${cls}`, text })));
    }
    const owner = ownerNow();
    const others = E.players().filter((p) => p.id !== owner?.pid);
    if (owner) selected = selected.filter((p) => owner.v.nightSeat.recruit.among.includes(p));
    setHidden(chips.el, !owner);
    chips.paint(others, { selected, tap: tapChip, live: owner ? owner.v.nightSeat.recruit.among : [] });
    paintOwnRow(list);
    if (owner) {
      const c = owner.v.nightSeat.recruit.count;
      setText(ackSub, selected.length === c ? `㩒落去就揀 ${E.names(selected)} 做共犯` : `喺上面揀 ${c} 位（${selected.length}/${c}）`);
    } else setText(ackSub, ACK_SHARED);
    ack.classList.toggle('is-done', list.length > 0 && list.every((x) => !!x.v.acked));

    // one seat's own panel
    const x = list.find((y) => y.pid === openSeat) ?? null;
    setHidden(together, !!x);
    setHidden(own, !x);
    if (x) {
      setText(privTitle, `🤫 淨係 ${E.nameOf(x.pid)} 睇 — 其他人望開`);
      const dk = sig(x.v.my?.dice ?? null);
      if (privDice.dataset.key !== dk) {
        privDice.dataset.key = dk;
        privDice.replaceChildren(el('span', { class: 'ct-co-dicelabel', text: '🎲 你粒骰' }), ...(x.v.my?.dice ?? []).map((d) => C.dieFace(d, 6)));
      }
      const pl = coPrivateLines(E, step, x, n);
      const pk = sig(pl);
      if (privLines.dataset.key !== pk) {
        privLines.dataset.key = pk;
        privLines.replaceChildren(...pl.map(([cls, text]) => el('p', { class: `ct-line ${cls}`, text })));
      }
      setText(privAckSub, x.v.nightSeat.steal?.can ? '㩒落去＝而家偷芝士；想等就㩒「睇完」' : '㩒一下，再㩒「睇完」');
      privAck.classList.toggle('is-done', !!x.v.acked);
    }

    setText(help, view.__ctx?.narrationMode === 'silent'
      ? '靜音模式：睇完就放返部手機喺枱中間，唔好抬頭望人。'
      : '夜晚唔好講嘢。睇完㩒大掣，部手機擺返枱中間，閉返眼。');
  }

  const timer = setInterval(() => { if (current) bar.tick(current, current.__ctx); }, 120);

  return {
    el: node,
    update(view, ctx) {
      current = { ...view, __ctx: ctx };
      paint();
      bar.tick(current, ctx);
    },
    destroy() { clearInterval(timer); node.remove(); },
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
  const timerSlot = el('div', { class: 'ct-timer', hidden: true });
  let timer = null;

  const lead = el('p', { class: 'ct-lead', text: '自由討論，可以講大話。唔可以畀人睇你張牌、唔可以亮骰。' });

  const recapFront = el('div', { class: 'ct-recap' });
  const recapCover = C.Cover({ front: recapFront, backArt: '📓', backLabel: '㩒住睇你嘅夜晚記錄', lockMode: 'none', locked: false, openSound: 'flip' });
  const recapWrap = el('div', { class: 'ct-recapwrap' }, el('h3', { class: 'ct-h', text: '📓 你嘅夜晚記錄' }), recapCover.el);

  // the dawn re-check: the same words on every phone, right under the card (not a top
  // banner); a recruited 共犯 finds out only by lifting the card itself
  let rechecked = false;
  let lastView = null;
  const recheck = el('p', { class: 'ct-recheck', hidden: true });
  const roleCard = makeRoleCard(E, {
    onOpen: (open) => { if (open && !rechecked) { rechecked = true; if (lastView) paintRecheck(lastView); } },
  });
  const cup = C.DiceCup(cupProps({ my: { dice: null, rollSeq: 0 } }));
  function paintRecheck(view) {
    const show = view.n >= 5;
    setHidden(recheck, !show);
    setText(recheck, rechecked ? RECHECK_DONE : RECHECK);
    recheck.classList.toggle('is-done', rechecked);
  }

  let mine = false;
  const readyBtn = el('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: () => api.send({ type: 'day-ready', on: !mine }) });
  const count = el('p', { class: 'ct-count' });
  const away = el('p', { class: 'ct-count ct-away', hidden: true });

  // dice above the card (as in v1), the card, then the re-check line under it
  const node = el('div', { class: 'ct-screen ct-day' }, banner, timerSlot, cup.el, roleCard.el, recheck, readyBtn, count, away, lead, recapWrap);

  return {
    el: node,
    update(view, ctx) {
      lastView = view;
      roleCard.update(view);
      paintRecheck(view);
      cup.update(cupProps(view));

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
      // a shared phone (#5): 夠鐘投票 is one table decision, made on the screen in the middle — a seat's own screen
      // only says where it is
      setHidden(readyBtn, E.shared());
      readyBtn.classList.toggle('btn-locked', mine);
      setText(readyBtn, mine ? '✓ 我夠鐘投票 — 等緊其他人（㩒一下取消）' : '🗳️ 我哋夠鐘投票');
      setText(count, E.shared()
        ? '📱 想投票：擺返中間，喺枱面㩒「夠鐘投票」'
        : `想投票：${view.dayReady.done} / ${view.dayReady.total}（全部人都想先會開始${view.deadline != null ? '，或者時間到' : ''}）`);
      setText(away, E.awayText(view));
      setHidden(away, !away.textContent);
    },
    destroy() { timer?.destroy(); roleCard.destroy(); cup.destroy(); recapCover.destroy(); node.remove(); },
  };
}

// ============================================================
// vote
// ============================================================

function buildVote(E) {
  const { api, C } = E;
  // (no follower banner here: the top of a phone is the easiest part for a neighbour to read)
  const LEAD = '邊個係芝士大盜？揀一個（唔可以投自己），確定。全部人投晒就同時公開。';
  const lead = el('p', { class: 'ct-lead', text: LEAD });
  const panel = C.VotePanel({ players: [], candidates: [], me: api.me, progress: { done: 0, total: 0 }, reveal: null, onVote: () => {} });
  const away = el('p', { class: 'ct-count ct-away', hidden: true });
  const node = el('div', { class: 'ct-screen ct-vote' }, lead, panel.el, away);
  return {
    el: node,
    update(view) {
      // 💤 an absent seat casts no vote (D4): its phone says so instead of offering a ballot (one already cast stays shown)
      const benched = !!view.my?.absent && view.myVote === undefined;
      setText(lead, benched ? ABSENT_SELF : LEAD);
      setHidden(panel.el, benched);
      panel.update({
        players: E.markedPlayers(view), candidates: view.candidates, me: api.me,
        myVote: view.myVote, allowAbstain: false, allowChange: true,
        // your own phone never prints whom you picked (D6): 「已投 ✓」 until the reveal
        secretChoice: true,
        progress: view.progress, reveal: null, title: '投票',
        onVote: (pid) => { if (pid) api.send({ type: 'vote', target: pid }); },
      });
      setText(away, E.awayText(view));
      setHidden(away, !away.textContent);
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
  const { C } = E;
  const panel = C.VotePanel({ players: [], candidates: [], me: E.me(), progress: { done: 0, total: 0 }, reveal: { counts: {}, top: [] } });
  const cards = el('div', { class: 'ct-revealed' });
  const wait = el('p', { class: 'ct-count', text: '等陣就睇結果…' });
  const node = el('div', { class: 'ct-screen ct-reveal' }, el('div', { class: 'ct-banner', text: '🎯 開牌！' }), panel.el, cards, wait);
  return {
    el: node,
    update(view) {
      const players = E.players();
      panel.update({
        players, candidates: players.map((p) => p.id), me: E.me(),
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
      // a shared phone is read by the whole table: no 「你贏咗」 and no 「（你）」 there (#20)
      const me = E.me();
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
  const bar = makeBar(E);
  setHidden(bar.el, true);
  const count = el('p', { class: 'ct-count' });
  const away = el('p', { class: 'ct-count ct-away', hidden: true });
  const timerSlot = el('div', { class: 'ct-timer', hidden: true });
  // §7.1 #5: the phone in the middle of a shared table — 夠鐘投票 is one tap for every seat on it
  const readyBtn = el('button', { class: 'btn btn-primary btn-lg ct-table-ready', type: 'button' });
  setHidden(readyBtn, true);
  readyBtn.addEventListener('click', () => { api.tableSend?.({ type: 'day-ready', on: true }); });
  let timer = null;
  const node = el('div', { class: 'ct-screen ct-table' }, title, body, bar.el, timerSlot, readyBtn, count, away);
  let current = null;

  const iv = setInterval(() => { if (current?.phase === 'night') bar.tick(current, current.__ctx); }, 120);

  return {
    el: node,
    update(view, ctx) {
      current = { ...view, __ctx: ctx };
      setHidden(bar.el, view.phase !== 'night');
      const table = E.shared() && view.phase === 'day';
      switch (view.phase) {
        case 'roll':
          setText(title, '🎲 搖骰・睇牌');
          setText(body, '大家睇緊自己張牌、搖緊骰。');
          setText(count, `已準備 ${view.ready.done} / ${view.ready.total}`);
          break;
        case 'night': {
          // no tap counter at night: on a shared phone only the awake seats tap, so 「n / m」 would count them
          setText(title, `🌙 ${view.subtitle}`);
          setText(body, '夜晚入面。邊個醒、做咗乜，只有佢自己知。');
          setText(count, '');
          break;
        }
        case 'day':
          setText(title, '☀️ 日頭討論');
          setText(body, '芝士唔見咗！自由討論。');
          // the whole table on this phone: one tap is everybody's, so no n / m waiting list (#5)
          setText(count, table && E.whole() ? '' : `想投票：${view.dayReady.done} / ${view.dayReady.total}`);
          break;
        case 'vote':
          setText(title, '🗳️ 投票');
          setText(body, '大家揀緊邊個係大盜。');
          setText(count, `已投 ${view.progress.done} / ${view.progress.total}`);
          break;
        default: break;
      }
      setHidden(count, !count.textContent);
      setHidden(readyBtn, !table);
      if (table) {
        setText(readyBtn, E.whole() ? '🗳️ 大家夠鐘投票 ✓（一下就得）' : '🗳️ 呢部機嘅人都夠鐘投票');
        // U5: locked while the 「擺返中間」 card is still up
        readyBtn.disabled = !!ctx?.tableLocked;
      }
      setText(away, view.phase === 'night' ? '' : E.awayText(view));
      setHidden(away, !away.textContent);
      if (view.deadline != null && view.phase === 'day') {
        const props = { deadline: view.deadline, now: api.now, label: view.timerLabel ?? '', paused: !!ctx?.paused, warnAt: [60, 10] };
        if (!timer) { timer = C.Timer(props); timerSlot.replaceChildren(timer.el); } else timer.update(props);
        setHidden(timerSlot, false);
      } else if (timer) { timer.destroy(); timer = null; timerSlot.replaceChildren(); setHidden(timerSlot, true); }
      if (view.phase === 'night') bar.tick(current, ctx);
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
    // U2: several of this shared phone's seats awake in one step share ONE screen
    const co = seat && view.phase === 'night' && coList(E, view, ctx).length >= 2;
    const k = `${seat ? 'seat' : 'table'}:${view.phase}${co ? ':co' : ''}`;
    if (k !== key) {
      screen?.destroy();
      key = k;
      const build = co ? buildCoNight
        : seat || view.phase === 'reveal' || view.phase === 'over'
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
