// ============================================================
// game.js — 芝士大盜 (Cheese Thief). PURE: runs on the host phone and headless
// under Node. No DOM, no Math.random, no Date — rng and now arrive in ctx.
//
// The rules follow docs/research/cheese-thief.md; the play flow, every
// narration line and the anti-tell reasoning live in docs/games/cheese-thief.md.
//
// Shape of a game
//   roll   everyone looks at their card, rolls their die (4p: two) under the cup
//   night  hour 1..6 are called in order (every hour, every time, same length),
//          then — 6, 7, 8 players only — the thief picks followers; then dawn
//   day    free discussion
//   vote   simultaneous secret vote
//   reveal the top-voted cards turn over (a few seconds, so the tally lands)
//   over   result()
//
// Everything a seat may not know lives in PRIVATE fields below and only ever
// leaves this file through view(), which is built field by field.
// ============================================================

import { ACT, HOST, seatOrder, shuffle, rollDie, pick, sample, tally } from '../../core/engine-kit.js?v=20261003102525';
import { narrate, stepTitle, anonymousPrompt, cueMinMs, headCountNote, VOTE_CALL, CLOCK, HINT } from './script.js?v=20261003102525';

// ---------- meta / rules ----------

export const meta = {
  id: 'cheese-thief',
  name: '芝士大盜',
  emoji: '🧀',
  accent: '#f5c518',
  players: [4, 8],
  minutes: [10, 15],
  narration: 'required',     // the night is read out; still works in 讀稿 and 靜音 modes
  paperMode: false,
  singleDevice: 'full',      // phone in the middle, picked up by whoever is called
  banks: [],
  css: true,
  blurb: '每人一粒秘密骰仔，天黑咗按點鐘睜眼 — 有人偷咗芝士，揪出大盜。',
};

export const rules = {
  quick: [
    '1 個芝士大盜，其餘係貪瞓鼠；每人暗擲一粒骰（4 人局兩粒）。',
    '天黑後手機由一點報到六點：擲到幾點，就喺嗰個點鐘睜眼。',
    '大盜喺自己個鐘偷走芝士 — 同佢一齊醒嘅人會見到係邊個。',
    '貪瞓鼠如果淨係得自己醒，可以偷睇一個人粒骰（4 人局唔得）。',
    '5–8 人：大盜會拉人做共犯，共犯幫大盜。',
    '天光討論完一齊投票：大盜喺最高票 → 貪瞓鼠贏，否則大盜隊贏。',
  ],
  // Every role: what you do (做乜) and how you win (點贏), in that order.
  roles: [
    {
      id: 'thief', name: '芝士大盜', emoji: '🧀', team: 'thief',
      text: '做乜：全場得你一個。喺你嗰個點鐘一定要偷走芝士，冇得偷睇骰。點贏：投票嗰陣你唔喺最高票。',
    },
    {
      id: 'sleepyhead', name: '貪瞓鼠', emoji: '🐭', team: 'sleepyhead',
      text: '做乜：喺你嗰個點鐘睜眼；如果淨係得你醒，可以偷睇一個人粒骰（4 人局唔得）。點贏：大盜喺最高票（平票都算）。',
    },
    {
      id: 'follower', name: '共犯', emoji: '🤝', team: 'thief',
      text: '做乜：本身係貪瞓鼠，夜晚畀大盜拉咗上船，天光幫大盜講大話。點贏：同大盜同贏同輸，自己畀人投中都唔緊要。',
    },
    {
      id: 'fall-mouse', name: '背鍋鼠', emoji: '🎭', team: 'solo',
      text: '做乜：（6–8 人可加入）夜晚同貪瞓鼠一樣，天光扮可疑。點贏：你喺最高票（平票都算）就你一個人贏，其他人全部輸。',
    },
  ],
  sections: [
    {
      title: '預備',
      body: '牌數等於人數：1 張芝士大盜，其餘貪瞓鼠（加背鍋鼠嘅話就由一隻貪瞓鼠換成背鍋鼠）。每人睇自己張牌，再喺骰盅下面擲一粒六面骰（4 人局擲兩粒）。擲咗就定案，唔可以重擲。你嘅點數就係你嘅「醒鐘」。',
    },
    {
      title: '夜晚',
      body: '手機由一點報到六點，每個點鐘都會報，就算冇人擲到都照報，而且時間一樣長（官方每個鐘 10 秒）。擲到嗰個點嘅人睜眼：你會見到同你一齊醒嘅人，同埋芝士仲喺唔喺枱上。大盜醒嗰陣一定要偷走芝士，同佢一齊醒嘅人一定見到係邊個偷。貪瞓鼠如果淨係得自己醒，可以偷睇一個人粒骰，睇完要冚返，之後唔可以再睇（4 人局唔得）。兩個或以上貪瞓鼠一齊醒就淨係識到對方，唔可以偷睇。',
    },
    {
      title: '共犯點產生',
      body: '4 人：冇共犯。\n5 人：大盜偷芝士嗰陣，如果有貪瞓鼠一齊醒，嗰位就成為共犯；有幾位一齊醒，大盜指一位；大盜自己一個醒就冇共犯。\n6 人：夜晚尾，大盜揀 1 位共犯（邊個都得），兩個人互相認得。\n7 人：夜晚尾，大盜揀 2 位共犯，佢哋互相認得，但唔知大盜係邊個（除非佢夜晚親眼見到大盜偷芝士）。\n8 人：夜晚尾，大盜揀 2 位共犯，三個人互相認得。\n共犯夜晚唔可以傳遞任何骰仔資料。',
    },
    {
      title: '日頭同投票',
      body: '天光後自由討論，可以講真話或者大話，但唔可以畀人睇你張牌、唔可以亮骰。準備好就一齊投票：每人一定要投一個人，唔可以投自己，唔可以棄權，投晒先同時公開。得票最多嘅人開牌；平票就一齊開。',
    },
    {
      title: '勝負',
      body: '得票最多嗰啲人入面有大盜 → 貪瞓鼠贏（共犯跟大盜一齊輸）。\n冇大盜 → 大盜同共犯贏，就算共犯畀人投中都一樣。\n背鍋鼠只要喺最高票（平票都算）就一個人贏，優先過其他所有結果；唔喺最高票就一定輸。\n4 人局：大盜同其他人平票，算大盜贏（2023 年官方修訂；舊版說明書寫平票算貪瞓鼠贏）。',
    },
    {
      title: '4 人局（官方變體）',
      body: '每人兩粒骰。貪瞓鼠揀其中一粒做自己嘅醒鐘；大盜兩個點數都會醒（兩粒一樣就只醒一次），可以揀喺邊次偷，第二次醒都未偷就一定要偷。偷咗之後另一次照醒，但冇嘢偷，淨係見到邊個醒。冇共犯。官方規則：就算淨係得你醒都唔可以偷睇骰；房主可以喺設定開「家規」畀人偷睇。',
    },
    {
      title: '背鍋鼠（6–8 人）',
      body: '背鍋鼠當貪瞓鼠玩，連偷睇都得，但佢想畀人投中。就算佢被大盜揀咗做共犯，都係淨係靠被投中先贏，唔會跟大盜隊贏，亦唔會跟貪瞓鼠贏。建議大家玩熟先加。',
    },
    {
      title: '旁白三個模式',
      body: '語音：主持部機讀出嚟，全部人真係閉眼。\n讀稿：要搵一個唔玩嘅朋友睇住主持部機讀，再㩒「下一步」— 主持自己有玩就唔好用，因為佢要開眼睇稿。\n靜音：唔使閉眼，大家望住自己部機，到你個鐘部機會亮；唔好抬頭望人，亦唔使摸手。',
    },
    {
      title: '手機做啲乜，你做啲乜',
      body: '手機負責：派牌、擲骰、逐點報時、記住芝士喺邊、顯示誰同你一齊醒、偷睇結果、投票計票。你負責：夜晚真係閉眼（或者用靜音模式睇住自己部機）、討論、扮嘢。每一步都喺手機下半部㩒一下大掣，咁就冇人聽得出邊個醒。',
    },
  ],
};

// ---------- config ----------

const DEFAULTS = { fallMouse: false, peek4: false, reroll: false, hourSec: 10, discussSec: 300, recap: true };

function normalise(cfg, n) {
  const c = { ...DEFAULTS, ...(cfg || {}) };
  c.fallMouse = !!c.fallMouse && n >= 6 && n <= 8;
  c.peek4 = !!c.peek4;
  c.reroll = !!c.reroll;
  c.recap = c.recap !== false;
  c.hourSec = clampInt(c.hourSec, 5, 30, DEFAULTS.hourSec);
  c.discussSec = clampInt(c.discussSec, 0, 1800, DEFAULTS.discussSec);
  return c;
}

function clampInt(v, lo, hi, dflt) {
  const x = Number(v);
  if (!Number.isFinite(x)) return dflt;
  return Math.min(hi, Math.max(lo, Math.round(x)));
}

export const config = {
  defaults(n, prev) {
    const d = { ...DEFAULTS };
    if (prev) {
      for (const k of ['hourSec', 'discussSec', 'recap', 'reroll', 'peek4']) if (prev[k] !== undefined) d[k] = prev[k];
      if (n >= 6 && n <= 8 && prev.fallMouse) d.fallMouse = true;
    }
    return normalise(d, n);
  },

  validate(cfg, n) {
    const warnings = [];
    if (!Number.isInteger(n) || n < 4 || n > 8) {
      return { ok: false, message: `芝士大盜要 4–8 個人（而家 ${n}）`, warnings };
    }
    const c = cfg || {};
    if (c.fallMouse && (n < 6 || n > 8)) return { ok: false, message: '背鍋鼠只限 6–8 人', warnings };
    const hs = c.hourSec ?? DEFAULTS.hourSec;
    if (!Number.isFinite(hs) || hs < 5 || hs > 30) return { ok: false, message: '每個點鐘 5–30 秒', warnings };
    const ds = c.discussSec ?? DEFAULTS.discussSec;
    if (!Number.isFinite(ds) || ds < 0 || ds > 1800) return { ok: false, message: '討論時間 0–1800 秒（0 = 唔計時）', warnings };
    if (n === 4) warnings.push('4 人局係官方變體：每人兩粒骰，大盜醒兩次，冇共犯，唔可以偷睇。');
    if (n === 5) warnings.push('5 人局：大盜偷芝士時有貪瞓鼠一齊醒，嗰位先會變共犯。');
    if (c.fallMouse) warnings.push('背鍋鼠想畀人投中 — 討論會更亂，建議玩熟先加。');
    if (n === 4 && c.peek4) warnings.push('家規：4 人局都可以偷睇骰（官方唔畀）。');
    if (c.reroll) warnings.push('家規：可以重擲骰（官方擲一次就定案）。');
    return { ok: true, message: '', warnings };
  },

  fields(cfg, n) {
    const f = [];
    if (n >= 6) {
      f.push({ key: 'fallMouse', label: '加入背鍋鼠', type: 'bool', help: '一隻貪瞓鼠換成背鍋鼠：佢要畀人投中先贏。官方 6–8 人可選，建議玩熟先加。' });
    }
    if (n === 4) {
      f.push({ key: 'peek4', label: '家規：4 人局都可以偷睇骰', type: 'bool', help: '官方規則係唔可以：4 人局淨係得你醒都唔准睇。開咗就係家規。' });
    }
    f.push({ key: 'hourSec', label: '每個點鐘幾長', type: 'seconds', min: 5, max: 30, help: '官方係 10 秒。每個點鐘一樣長，冇人擲到都照行。' });
    f.push({ key: 'discussSec', label: '討論時間', type: 'seconds', min: 0, max: 1800, help: '0 = 唔計時，全部人㩒「夠鐘投票」就投。' });
    f.push({ key: 'reroll', label: '家規：擲骰可以重擲', type: 'bool', help: '官方規則：擲一次就定案。開咗就可以搖到㩒「鎖定」為止。' });
    f.push({ key: 'recap', label: '日頭顯示夜晚記錄', type: 'bool', help: '只有你自己睇到你夜晚見過嘅嘢，等你唔使靠記性。' });
    return f;
  },

  summary(cfg, n) {
    const c = normalise(cfg, n);
    const lines = [];
    const fm = c.fallMouse ? 1 : 0;
    lines.push(`🧀 1 大盜 · 🐭 ${n - 1 - fm} 貪瞓鼠${fm ? ' · 🎭 1 背鍋鼠' : ''}`);
    lines.push(n === 4 ? '🎲 每人 2 粒骰（大盜醒兩次）· 冇共犯'
      : n === 5 ? '🎲 每人 1 粒骰 · 共犯：偷芝士時喺度嘅貪瞓鼠'
      : n === 6 ? '🎲 每人 1 粒骰 · 夜尾大盜揀 1 位共犯'
      : n === 7 ? '🎲 每人 1 粒骰 · 夜尾大盜揀 2 位共犯（唔識大盜）'
      : '🎲 每人 1 粒骰 · 夜尾大盜揀 2 位共犯（三人互認）');
    const note = headCountNote(n);
    if (note) lines.push(`💬 ${note}`);
    lines.push(`⏱ 每個點鐘 ${c.hourSec} 秒 · 討論 ${c.discussSec ? Math.round(c.discussSec / 60 * 10) / 10 + ' 分鐘' : '唔計時'}`);
    if (n === 4 && c.peek4) lines.push('👁 家規：4 人局都可以偷睇骰');
    if (c.reroll) lines.push('🔓 家規：擲骰可重擲，鎖定先定案');
    return lines;
  },
};

// ---------- small helpers ----------

const THIEF = 'thief';
const SLEEPY = 'sleepyhead';
const FMOUSE = 'fall-mouse';

const CLOSE_MS = 2000;     // everyone shuts their eyes
const BEGIN_MS = 3000;     // "天黑" settling time
const DAWN_MS = 1500;
const REVEAL_MS = 9000;    // the tally on screen before the result

const nowOf = (ctx) => (typeof ctx.now === 'function' ? ctx.now() : ctx.now);
const thiefOf = (s) => s.order.find((p) => s.role[p] === THIEF);
const fmouseOf = (s) => s.order.find((p) => s.role[p] === FMOUSE) ?? null;
const othersOf = (s, pid) => s.order.filter((p) => p !== pid);
const hasDice = (s, pid) => Array.isArray(s.dice[pid]);
const nm = (s, pid) => s.names[pid] ?? '?';
const count = (obj) => Object.values(obj).filter(Boolean).length;
const isStr = (x) => typeof x === 'string';

function buildSteps(n) {
  const steps = [{ k: 'begin' }];
  for (let h = 1; h <= 6; h++) steps.push({ k: 'open', h }, { k: 'close', h });
  if (n >= 6) {
    steps.push({ k: 'rec-pick' });
    if (n === 7) steps.push({ k: 'rec-tclose' });
    steps.push({ k: 'rec-meet' }, { k: 'rec-close' });
  }
  steps.push({ k: 'dawn' });
  return steps;
}

/** Fixed per step kind — never depends on who is awake or what they did. */
function windowMs(s, step) {
  const hourMs = s.cfg.hourSec * 1000;
  switch (step.k) {
    case 'begin': return BEGIN_MS;
    case 'open': return hourMs;
    case 'rec-pick': return hourMs;
    case 'rec-meet': return Math.max(5000, Math.round(hourMs / 2));
    case 'dawn': return DAWN_MS;
    default: return CLOSE_MS;
  }
}

function stepOf(s) { return s.steps[s.ix] ?? null; }

function cueIdOf(s) {
  const st = stepOf(s);
  return `ct${s.gid}:night:${s.ix}:${st.k}${st.h ? ':' + st.h : ''}`;
}

function addNote(s, pid, note) { (s.notes[pid] ||= []).push(note); }

/** Seats whose eyes are open right now (window stage of an awake-capable step). */
function awakeNow(s) {
  if (s.phase !== 'night' || s.stage !== 'window') return [];
  const st = stepOf(s);
  const thief = thiefOf(s);
  switch (st.k) {
    case 'open': return s.order.filter((p) => s.wake[p].includes(st.h));
    case 'rec-pick': return [thief];
    case 'rec-meet':
      return s.order.filter((p) => (s.n === 7 ? s.followers.includes(p) : p === thief || s.followers.includes(p)));
    default: return [];
  }
}

function markAck(s, pid) { if (!s.acked.includes(pid)) s.acked.push(pid); }

// ---------- engine ----------

export const engine = {
  setup({ players, config: cfg, rng }) {
    const order = seatOrder(players);
    const n = order.length;
    if (n < 4 || n > 8) throw new RangeError(`cheese-thief needs 4-8 players, got ${n}`);
    const c = normalise(cfg, n);

    const deal = shuffle(rng, order);
    const role = {};
    for (const pid of order) role[pid] = SLEEPY;
    role[deal[0]] = THIEF;
    if (c.fallMouse) role[deal[1]] = FMOUSE;

    const per = (v) => Object.fromEntries(order.map((p) => [p, typeof v === 'function' ? v() : v]));
    return {
      game: 'cheese-thief',
      gid: Math.floor(rng() * 1e6),
      phase: 'roll',
      n,
      cfg: c,
      order,
      names: Object.fromEntries(players.map((p) => [p.id, p.name])),
      role,                         // PRIVATE
      dice: per(null),              // PRIVATE: null until rolled, then [d] (4p: [d, d])
      rollSeq: per(0),              // per-player roll counter (the cup's chime is keyed on it)
      locked: per(false),
      pick4: per(null),             // PRIVATE: 4p sleepyhead's chosen die value
      ready: per(false),
      wake: {},                     // PRIVATE: pid → hours this seat opens its eyes (set at night start)
      steps: [], ix: -1, stage: 'cue',
      acked: [],                    // seats that tapped something during the current step
      cheese: { gone: false, by: null, hour: null },   // PRIVATE (by, hour)
      followers: [],                // PRIVATE
      informed: [],                 // followers who have been told (their own phones only)
      pending: null,                // follower pick the thief still owes: { by, among, count }
      recruitHour: null,            // 5p: the hour at which the witness pick resolved
      peeked: {},                   // PRIVATE: pid → { target, dice, h }
      notes: per(() => []),         // PRIVATE per seat: what that seat learned (recap)
      dayReady: per(false),
      votes: {},
      voteCue: true,
      deadline: null, timerLabel: null,
      final: null,                  // { counts, top, max } once everyone voted
      outcome: null,
    };
  },

  act(s, { pid, action } = {}, ctx = {}) {
    if (!action || !isStr(action.type)) return s;
    if (pid === HOST) return hostAct(s, action, ctx);
    if (!s.order.includes(pid)) return s;
    switch (s.phase) {
      case 'roll': return rollAct(s, pid, action, ctx);
      case 'night': return nightAct(s, pid, action, ctx);
      case 'day': return dayAct(s, pid, action, ctx);
      case 'vote': return voteAct(s, pid, action, ctx);
      default: return s;
    }
  },

  advance(s, ctx = {}) {
    switch (s.phase) {
      case 'night': return s.stage === 'window' ? finishWindow(s, ctx) : s;
      case 'day': return startVote(s);
      case 'reveal': return toOver(s);
      default: return s;
    }
  },

  view(s, pid) { return buildView(s, pid); },

  cue(s) {
    if (s.phase === 'night' && s.stage === 'cue') {
      const text = narrate(stepOf(s), s.n);
      return text ? { id: cueIdOf(s), text, minMs: cueMinMs(text) } : null;
    }
    if (s.phase === 'vote' && s.voteCue) {
      return { id: `ct${s.gid}:vote:call`, text: VOTE_CALL, minMs: cueMinMs(VOTE_CALL) };
    }
    return null;
  },

  focus(s) {
    switch (s.phase) {
      case 'roll': {
        const pids = s.order.filter((p) => !s.ready[p]);
        return pids.length ? { pids } : null;
      }
      case 'night': {
        if (s.stage !== 'window') return null;
        const st = stepOf(s);
        if (!['open', 'rec-pick', 'rec-meet'].includes(st.k)) return null;
        // An empty hour still returns the prompt (pids: []) so a shared phone
        // looks the same whether or not anyone is awake.
        return { pids: awakeNow(s), anonymous: anonymousPrompt(st, s.n) };
      }
      case 'vote': {
        const pids = s.order.filter((p) => s.votes[p] === undefined);
        return pids.length ? { pids } : null;
      }
      default: return null;
    }
  },

  autoAct(s, pid, ctx = {}) {
    if (!s.order.includes(pid)) return null;
    switch (s.phase) {
      case 'roll': return s.ready[pid] ? null : { type: 'ready' };
      case 'night': {
        if (s.pending && s.pending.by === pid && s.stage === 'window') {
          return { type: 'recruit', targets: sample(ctx.rng, s.pending.among, s.pending.count) };
        }
        return null;
      }
      case 'day': return s.dayReady[pid] ? null : { type: 'day-ready', on: true };
      case 'vote': return s.votes[pid] === undefined ? { type: 'vote', target: pick(ctx.rng, othersOf(s, pid)) } : null;
      default: return null;
    }
  },

  legalActions(s, pid) {
    if (!s.order.includes(pid)) return [];
    const out = [];
    switch (s.phase) {
      case 'roll': {
        if (!s.locked[pid]) out.push({ type: 'roll' });
        if (s.cfg.reroll && hasDice(s, pid) && !s.locked[pid]) out.push({ type: 'lock' });
        if (s.locked[pid] && needsChoice(s, pid) && !s.ready[pid]) {
          for (const h of new Set(s.dice[pid])) if (h !== s.pick4[pid]) out.push({ type: 'choose-hour', hour: h });
        }
        if (!s.ready[pid]) out.push({ type: 'ready' });
        break;
      }
      case 'night': {
        if (!s.acked.includes(pid)) out.push({ type: 'ack' });
        if (canPeek(s, pid)) for (const t of othersOf(s, pid)) out.push({ type: 'peek', target: t });
        if (canSteal(s, pid)) out.push({ type: 'steal' });
        if (s.pending && s.pending.by === pid && s.stage === 'window') {
          for (const targets of combos(s.pending.among, s.pending.count)) out.push({ type: 'recruit', targets });
        }
        break;
      }
      case 'day':
        if (!s.dayReady[pid]) out.push({ type: 'day-ready', on: true });
        break;
      case 'vote':
        for (const t of othersOf(s, pid)) if (s.votes[pid] !== t) out.push({ type: 'vote', target: t });
        break;
      default: break;
    }
    return out;
  },

  result(s) { return s.phase === 'over' ? s.outcome : null; },
};

function combos(list, k) {
  if (k === 0) return [[]];
  if (list.length < k) return [];
  const [head, ...rest] = list;
  return [...combos(rest, k - 1).map((c) => [head, ...c]), ...combos(rest, k)];
}

// ---------- host-internal actions ----------

function hostAct(s, a, ctx) {
  switch (a.type) {
    case ACT.CUE_DONE:
      if (s.phase === 'night' && s.stage === 'cue' && a.id === cueIdOf(s)) return enterWindow(s, ctx);
      if (s.phase === 'vote' && a.id === `ct${s.gid}:vote:call`) s.voteCue = false;
      return s;
    case ACT.NEXT:
      if (s.phase === 'night') return s.stage === 'cue' ? enterWindow(s, ctx) : finishWindow(s, ctx);
      if (s.phase === 'day') return startVote(s);
      if (s.phase === 'reveal') return toOver(s);
      return s;
    default:
      return s;   // ACT.AUTO is resolved by the session through autoAct()
  }
}

// ---------- phase: roll ----------

function needsChoice(s, pid) {
  return s.n === 4 && s.role[pid] !== THIEF && hasDice(s, pid) && s.dice[pid][0] !== s.dice[pid][1];
}

function doRoll(s, pid, ctx) {
  if (s.locked[pid]) return s;
  s.dice[pid] = s.n === 4 ? [rollDie(ctx.rng), rollDie(ctx.rng)] : [rollDie(ctx.rng)];
  s.rollSeq[pid] += 1;
  s.pick4[pid] = null;
  if (!s.cfg.reroll) s.locked[pid] = true;   // official: one roll, then it stands
  return s;
}

function rollAct(s, pid, a, ctx) {
  switch (a.type) {
    case 'roll':
      return s.ready[pid] ? s : doRoll(s, pid, ctx);
    case 'lock':
      if (hasDice(s, pid) && !s.locked[pid]) s.locked[pid] = true;
      return s;
    case 'choose-hour':
      if (needsChoice(s, pid) && s.locked[pid] && !s.ready[pid] && s.dice[pid].includes(a.hour)) s.pick4[pid] = a.hour;
      return s;
    case 'ready': {
      if (s.ready[pid]) return s;
      // "ready" fills in whatever is missing, so 代佢做 on a dead phone is one tap.
      if (!hasDice(s, pid)) doRoll(s, pid, ctx);
      s.locked[pid] = true;
      if (s.n === 4 && s.role[pid] !== THIEF && s.pick4[pid] == null) s.pick4[pid] = pick(ctx.rng, s.dice[pid]);
      s.ready[pid] = true;
      if (s.order.every((p) => s.ready[p])) startNight(s);
      return s;
    }
    default: return s;
  }
}

function startNight(s) {
  s.phase = 'night';
  for (const pid of s.order) s.wake[pid] = wakeHours(s, pid);
  s.steps = buildSteps(s.n);
  s.ix = 0;
  s.stage = 'cue';
  s.acked = [];
  s.deadline = null;
  s.timerLabel = null;
  return s;
}

function wakeHours(s, pid) {
  const d = s.dice[pid];
  if (s.n !== 4) return [d[0]];
  if (s.role[pid] === THIEF) return [...new Set(d)].sort((x, y) => x - y);
  return [s.pick4[pid] ?? d[0]];
}

// ---------- phase: night ----------

function enterWindow(s, ctx) {
  const st = stepOf(s);
  s.stage = 'window';
  s.deadline = nowOf(ctx) + windowMs(s, st);
  s.timerLabel = null;
  if (st.k === 'open') openWindow(s, st, ctx);
  else if (st.k === 'rec-pick') {
    const thief = thiefOf(s);
    s.pending = { by: thief, among: othersOf(s, thief), count: s.n === 6 ? 1 : 2 };
  } else if (st.k === 'rec-meet') meetWindow(s);
  return s;
}

function openWindow(s, st, ctx) {
  const awake = s.order.filter((p) => s.wake[p].includes(st.h));
  const thief = thiefOf(s);
  let stoleNow = false;

  if (awake.includes(thief) && !s.cheese.gone) {
    // 5–8p: the thief MUST take it, so it happens as the window opens — nobody can
    // dodge being seen by stealing in the last second. 4p: only forced at the last wake.
    const lastWake = st.h === Math.max(...s.wake[thief]);
    if (s.n !== 4 || lastWake) { takeCheese(s, st.h); stoleNow = true; }
  }

  for (const p of awake) {
    addNote(s, p, {
      k: 'woke', h: st.h, with: awake.filter((x) => x !== p),
      cheese: s.cheese.gone ? 'gone' : 'table', thief: seenThief(s, p, st.h),
    });
  }
  if (stoleNow) addNote(s, thief, { k: 'stole', h: st.h });

  if (s.n === 5 && stoleNow) {
    const witnesses = awake.filter((p) => p !== thief);
    if (witnesses.length === 1) applyRecruit(s, [witnesses[0]], st.h);
    else if (witnesses.length > 1) s.pending = { by: thief, among: witnesses, count: 1 };
  }
  return s;
}

function takeCheese(s, h) {
  s.cheese = { gone: true, by: thiefOf(s), hour: h };
}

/** Who, if anyone, the seat `p` saw take the cheese during hour `h`. */
function seenThief(s, p, h) {
  const c = s.cheese;
  return c.gone && (c.hour === h || p === c.by) ? c.by : null;
}

/** 4p only: the thief chose to steal during a window that is already open. */
function stealNow(s, h) {
  takeCheese(s, h);
  const thief = thiefOf(s);
  for (const p of s.order.filter((x) => s.wake[x].includes(h))) {
    const note = [...(s.notes[p] || [])].reverse().find((x) => x.k === 'woke' && x.h === h);
    if (note) { note.cheese = 'gone'; note.thief = seenThief(s, p, h); }
  }
  addNote(s, thief, { k: 'stole', h });
}

/** Record the followers. 5p tells the follower right away; 6–8p tell them at the meeting step. */
function applyRecruit(s, targets, h) {
  const thief = thiefOf(s);
  s.followers = targets.slice();
  s.pending = null;
  addNote(s, thief, { k: 'recruited', followers: targets.slice() });
  if (s.n !== 5) return;
  s.recruitHour = h;
  for (const f of targets) { s.informed.push(f); addNote(s, f, { k: 'follower', h, thief, mates: [] }); }
  for (const p of s.order.filter((x) => s.wake[x].includes(h))) {
    const note = [...(s.notes[p] || [])].reverse().find((x) => x.k === 'woke' && x.h === h);
    if (note) note.picked = targets[0];
  }
}

/** A seat that was awake at the theft hour saw who took the cheese. */
function sawTheft(s, p) {
  return s.cheese.gone && (p === s.cheese.by || s.wake[p].includes(s.cheese.hour));
}

/**
 * Who the follower `f` knows the thief to be after the meeting: 6p and 8p meet
 * the thief face to face; 7p followers only know the thief if they happened to
 * watch the theft at their own hour (research: "who knows what at dawn").
 */
function followerKnowsThief(s, f) {
  if (s.n !== 7) return thiefOf(s);
  return sawTheft(s, f) ? thiefOf(s) : null;
}

function meetWindow(s) {
  for (const f of s.followers) {
    if (!s.informed.includes(f)) s.informed.push(f);
    addNote(s, f, {
      k: 'follower', h: null, thief: followerKnowsThief(s, f),
      mates: s.followers.filter((x) => x !== f),
    });
  }
}

/** The window is over: settle anything still owed, then move on. */
function finishWindow(s, ctx) {
  const st = stepOf(s);
  if (s.pending && (st.k === 'open' || st.k === 'rec-pick')) {
    applyRecruit(s, sample(ctx.rng, s.pending.among, s.pending.count), st.h ?? null);
  }
  if (st.k === 'dawn') return startDay(s, ctx);
  s.ix += 1;
  s.stage = 'cue';
  s.deadline = null;
  s.acked = [];
  return s;
}

function canPeek(s, pid) {
  if (s.phase !== 'night' || s.stage !== 'window') return false;
  const st = stepOf(s);
  if (st.k !== 'open' || s.role[pid] === THIEF || s.peeked[pid]) return false;
  if (s.n === 4 && !s.cfg.peek4) return false;
  const awake = awakeNow(s);
  return awake.length === 1 && awake[0] === pid;
}

function canSteal(s, pid) {
  if (s.phase !== 'night' || s.stage !== 'window' || s.n !== 4) return false;
  const st = stepOf(s);
  return st.k === 'open' && pid === thiefOf(s) && !s.cheese.gone && s.wake[pid].includes(st.h);
}

function nightAct(s, pid, a, ctx) {
  const st = stepOf(s);
  if (!st) return s;
  switch (a.type) {
    case 'ack':
      markAck(s, pid);
      return s;
    case 'peek': {
      if (!canPeek(s, pid) || !isStr(a.target) || a.target === pid || !s.order.includes(a.target)) return s;
      const dice = s.dice[a.target].slice();
      s.peeked[pid] = { target: a.target, dice, h: st.h };
      addNote(s, pid, { k: 'peek', h: st.h, target: a.target, dice: dice.slice() });
      markAck(s, pid);
      return s;
    }
    case 'steal':
      if (!canSteal(s, pid)) return s;
      stealNow(s, st.h);
      markAck(s, pid);
      return s;
    case 'recruit': {
      const p = s.pending;
      if (!p || p.by !== pid || s.stage !== 'window' || !Array.isArray(a.targets)) return s;
      const t = a.targets;
      if (t.length !== p.count || new Set(t).size !== t.length) return s;
      if (!t.every((x) => isStr(x) && p.among.includes(x))) return s;
      applyRecruit(s, t, st.h ?? null);
      markAck(s, pid);
      return s;
    }
    default: return s;
  }
}

// ---------- phase: day, vote, reveal ----------

function startDay(s, ctx) {
  s.phase = 'day';
  s.stage = 'cue';
  s.pending = null;
  s.acked = [];
  s.deadline = s.cfg.discussSec > 0 ? nowOf(ctx) + s.cfg.discussSec * 1000 : null;
  s.timerLabel = '討論時間';
  return s;
}

function dayAct(s, pid, a) {
  if (a.type !== 'day-ready') return s;
  s.dayReady[pid] = a.on !== false;
  if (s.order.every((p) => s.dayReady[p])) return startVote(s);
  return s;
}

function startVote(s) {
  s.phase = 'vote';
  s.deadline = null;
  s.timerLabel = null;
  s.votes = {};
  s.voteCue = true;
  return s;
}

function voteAct(s, pid, a, ctx) {
  if (a.type !== 'vote') return s;
  if (!isStr(a.target) || a.target === pid || !s.order.includes(a.target)) return s;
  s.votes[pid] = a.target;
  if (s.order.every((p) => s.votes[p] !== undefined)) return toReveal(s, ctx);
  return s;
}

function toReveal(s, ctx) {
  s.phase = 'reveal';
  s.final = tally(s.votes);
  s.deadline = nowOf(ctx) + REVEAL_MS;
  s.timerLabel = '開牌';
  return s;
}

function toOver(s) {
  s.phase = 'over';
  s.deadline = null;
  s.timerLabel = null;
  s.outcome = explain(s);
  return s;
}

// ---------- verdict ----------

/**
 * Who wins. Exported so tests can pin the truth table.
 *   Fall Mouse in the top set → it wins alone (beats everything, even a tie with the thief)
 *   thief in the top set      → sleepyheads (non-followers) win; except 4p with a tie → thief
 *   otherwise                 → thief + followers (a follower fall mouse does not share it)
 */
export function judge({ n, thief, fallMouse, followers, roles, order, top }) {
  const sleepy = order.filter((p) => roles[p] === SLEEPY && !followers.includes(p));
  if (fallMouse && top.includes(fallMouse)) return { mode: 'solo', winners: [fallMouse] };
  if (top.includes(thief)) {
    if (n === 4 && top.length > 1) return { mode: 'thief-tie', winners: [thief] };
    return { mode: 'caught', winners: sleepy };
  }
  const team = [thief, ...followers.filter((f) => roles[f] !== FMOUSE)];
  return { mode: 'escaped', winners: order.filter((p) => team.includes(p)) };
}

const ROLE_NAME = { [THIEF]: '🧀 大盜', [SLEEPY]: '🐭 貪瞓鼠', [FMOUSE]: '🎭 背鍋鼠' };

function explain(s) {
  const thief = thiefOf(s);
  const fm = fmouseOf(s);
  const { counts, top, max } = s.final;
  const v = judge({ n: s.n, thief, fallMouse: fm, followers: s.followers, roles: s.role, order: s.order, top });
  const names = (ids) => ids.map((p) => nm(s, p)).join('、');
  const lines = [];

  lines.push(`最高票：${names(top)}（${max} 票）`);
  lines.push('票數：' + s.order.map((p) => `${nm(s, p)} ${counts[p] || 0}`).join(' · '));

  const teamFollowers = s.followers.filter((f) => f !== fm);   // a recruited fall mouse never joins the thief team
  const fmFollower = !!fm && s.followers.includes(fm);

  let summary;
  if (v.mode === 'solo') {
    summary = `背鍋鼠 ${nm(s, fm)} 成功畀人投中 — 一個人贏`;
    lines.push(`背鍋鼠 ${nm(s, fm)} 喺最高票入面，所以佢獨贏，其他人（包括大盜隊同貪瞓鼠）全部輸。`);
    if (top.includes(thief)) lines.push(`就算大盜 ${nm(s, thief)} 都畀人揪出，背鍋鼠優先。`);
  } else if (v.mode === 'thief-tie') {
    summary = `大盜 ${nm(s, thief)} 贏 — 4 人局平票算大盜贏`;
    lines.push(`4 人局：大盜 ${nm(s, thief)} 同 ${names(top.filter((p) => p !== thief))} 平票，所以大盜贏（2023 年官方修訂）。`);
  } else if (v.mode === 'caught') {
    summary = `貪瞓鼠贏 — 大盜 ${nm(s, thief)} 畀人揪出`;
    lines.push(`大盜 ${nm(s, thief)} 喺最高票入面${top.length > 1 ? '（平票都一齊開牌，大盜照計畀人揪出）' : ''}，所以貪瞓鼠贏。`);
    if (teamFollowers.length) lines.push(`共犯 ${names(teamFollowers)} 跟大盜一齊輸。`);
    if (fm) lines.push(`背鍋鼠 ${nm(s, fm)} 唔喺最高票，所以都輸${fmFollower ? '（佢做咗共犯都一樣）' : ''}。`);
  } else {
    summary = `大盜隊贏 — ${nm(s, thief)} 逃過一劫`;
    lines.push(`大盜 ${nm(s, thief)} 唔喺最高票，所以${teamFollowers.length ? '大盜同共犯' : '大盜'}贏。`);
    const caughtFollowers = top.filter((p) => teamFollowers.includes(p));
    if (caughtFollowers.length) lines.push(`共犯 ${names(caughtFollowers)} 畀人投中都唔緊要，照贏。`);
    if (fm) {
      lines.push(fmFollower
        ? `背鍋鼠 ${nm(s, fm)} 雖然做咗共犯，但佢淨係靠畀人投中先贏，所以輸。`
        : `背鍋鼠 ${nm(s, fm)} 唔喺最高票，所以輸。`);
    }
  }

  lines.push(s.followers.length ? `共犯：${names(s.followers)}` : '今局冇共犯。');
  const recap = nightRecap(s);
  lines.push('🌙 夜晚重溫：', ...recap);
  for (const p of s.order) {
    const tag = s.followers.includes(p) ? '（共犯）' : '';
    lines.push(`${nm(s, p)}：${ROLE_NAME[s.role[p]]}${tag} · 骰 ${s.dice[p].join(' ')} · ${s.wake[p].map((h) => CLOCK[h]).join('、')}點鐘醒`);
  }

  const points = Object.fromEntries(s.order.map((p) => [p, 0]));
  for (const w of v.winners) {
    points[w] = v.mode === 'solo' ? 3 : (w === thief ? 2 : 1);
  }
  return { winners: v.winners, summary, lines, points, mode: v.mode, recap };
}

/**
 * The night as nobody saw it live: one line per hour (who woke, the theft and
 * who watched it, a peek and its result, a 5p pick, a 4p thief that waited),
 * then the follower step for 6-8 players.
 */
function nightRecap(s) {
  const thief = thiefOf(s);
  const names = (ids) => ids.map((p) => nm(s, p)).join('、');
  const out = [];
  for (let h = 1; h <= 6; h++) {
    const awake = s.order.filter((p) => s.wake[p].includes(h));
    const bits = [];
    if (s.cheese.gone && s.cheese.hour === h) {
      const watched = awake.filter((p) => p !== thief);
      bits.push(`大盜 ${nm(s, thief)} 偷走芝士${watched.length ? `（${names(watched)} 睇到）` : '（冇人睇到）'}`);
    } else if (awake.includes(thief)) {
      bits.push(s.cheese.gone && s.cheese.hour < h
        ? `大盜 ${nm(s, thief)} 再醒，芝士早就冇咗`
        : `大盜 ${nm(s, thief)} 醒咗，但揀咗遲啲先偷`);
    }
    if (s.n === 5 && s.recruitHour === h && s.followers.length) bits.push(`大盜揀咗 ${names(s.followers)} 做共犯`);
    for (const p of s.order) {
      const pk = s.peeked[p];
      if (pk && pk.h === h) bits.push(`${nm(s, p)} 偷睇咗 ${nm(s, pk.target)} 粒骰（${pk.dice.join(' ')}）`);
    }
    const who = awake.length ? `${names(awake)} 醒咗` : '冇人醒';
    out.push(`${CLOCK[h]}點鐘：${who}${bits.length ? ' — ' + bits.join('；') : ''}`);
  }
  if (s.n >= 6) {
    const how = s.n === 6 ? '兩個互相認得' : s.n === 7 ? '兩位共犯互相認得，大盜冇同佢哋對望' : '三個互相認得';
    out.push(`夜尾：大盜揀咗 ${names(s.followers)} 做共犯（${how}）`);
  }
  return out;
}

// ---------- views (whitelist) ----------

const TITLES = {
  roll: ['🎲 搖骰・睇牌', '搖咗骰、睇咗牌，就㩒「準備好」'],
  day: ['☀️ 日頭討論', '芝士唔見咗！'],
  vote: ['🗳️ 投票', '邊個係芝士大盜？'],
  reveal: ['🎯 開牌', '得票最多嘅人開牌'],
  over: ['🧀 完咗', ''],
};

function progress(done, total) { return { done, total }; }

function buildView(s, pid) {
  const seat = pid != null && s.order.includes(pid) ? pid : null;
  const v = { phase: s.phase, seat, n: s.n, opts: { reroll: s.cfg.reroll, recap: s.cfg.recap, peek4: s.cfg.peek4 } };

  const [title, subtitle] = s.phase === 'night'
    ? ['🌙 夜晚', stepTitle(stepOf(s))]
    : TITLES[s.phase];
  v.title = title;
  v.subtitle = subtitle;
  if (s.deadline != null) { v.deadline = s.deadline; if (s.timerLabel) v.timerLabel = s.timerLabel; }

  switch (s.phase) {
    case 'roll': v.ready = progress(count(s.ready), s.n); break;
    case 'night': {
      const st = stepOf(s);
      v.night = true;
      v.step = { ix: s.ix, total: s.steps.length, k: st.k, h: st.h ?? null, stage: s.stage };
      v.acks = progress(s.acked.length, s.n);
      break;
    }
    case 'day': v.dayReady = progress(count(s.dayReady), s.n); break;
    case 'vote': v.progress = progress(Object.keys(s.votes).length, s.n); break;
    case 'reveal': case 'over': publicReveal(s, v); break;
    default: break;
  }

  if (s.phase === 'over') {
    v.summary = s.outcome.summary;
    v.winners = s.outcome.winners.slice();
    v.mode = s.outcome.mode;
    v.cheese = { by: s.cheese.by, hour: s.cheese.hour };
    v.debrief = s.order.map((p) => ({
      pid: p, role: s.role[p], follower: s.followers.includes(p),
      dice: s.dice[p].slice(), wake: s.wake[p].slice(), thief: p === s.cheese.by,
    }));
    v.recap = (s.outcome.recap ?? []).slice();
  }

  if (seat) seatView(s, seat, v);
  v.hint = hintFor(s, seat, v);
  return v;
}

/**
 * One line for the 💡 sheet (BACKLOG U1): what to do right now, for a
 * first-timer. Built from the seat's own view only, so it can never say more
 * than the screen already does. Never shown unless the player taps 💡.
 */
function hintFor(s, pid, v) {
  if (!pid) {
    if (s.phase === 'reveal') return HINT.reveal;
    if (s.phase === 'over') return HINT.over;
    return HINT.table[s.phase] ?? '';
  }
  const my = v.my;
  switch (s.phase) {
    case 'roll':
      if (my.ready) return HINT.roll.wait;
      if (!my.dice) return HINT.roll.look;
      if (my.needsChoice && my.chosen == null) return HINT.roll.choose;
      return HINT.roll.ready;
    case 'night': {
      const ns = v.nightSeat;
      if (!ns?.awake) return HINT.night.sleep;
      if (ns.meet) return HINT.night.meet;
      if (ns.recruit) return HINT.night.recruit;
      if (ns.steal?.can) return HINT.night.steal;
      if (ns.peek?.mode === 'can') return HINT.night.peek;
      if (my.role === THIEF) return HINT.night.thief;
      return HINT.night.awake;
    }
    case 'day':
      if (my.role === THIEF) return HINT.day.thief;
      if (my.role === FMOUSE) return HINT.day.fallMouse;
      if (my.follower) return HINT.day.follower;
      return HINT.day.sleepyhead;
    case 'vote': return v.myVote !== undefined ? HINT.voted : HINT.vote;
    case 'reveal': return HINT.reveal;
    case 'over': return HINT.over;
    default: return '';
  }
}

function publicReveal(s, v) {
  v.reveal = { counts: { ...s.final.counts }, top: s.final.top.slice(), votes: { ...s.votes } };
  v.revealed = s.final.top.map((p) => ({ pid: p, role: s.role[p] }));
}

/** Everything seat `pid` is allowed to know in the current phase. */
function seatView(s, pid, v) {
  const mine = {
    role: s.role[pid],
    follower: s.informed.includes(pid),
    dice: hasDice(s, pid) ? s.dice[pid].slice() : null,
    rollSeq: s.rollSeq[pid],
    locked: s.locked[pid],
  };

  if (s.phase === 'roll') {
    mine.needsChoice = needsChoice(s, pid);
    mine.chosen = s.pick4[pid];
    mine.ready = s.ready[pid];
  }
  if (s.phase !== 'roll') mine.wake = s.wake[pid].slice();
  v.my = mine;

  if (s.phase === 'night') {
    v.acked = s.acked.includes(pid);
    v.nightSeat = nightFor(s, pid);
    v.notes = clonePlain(s.notes[pid]);
  } else if (s.phase === 'day') {
    v.dayReady = { ...v.dayReady, mine: !!s.dayReady[pid] };
    v.notes = clonePlain(s.notes[pid]);
  } else if (s.phase === 'vote') {
    v.candidates = othersOf(s, pid);
    if (s.votes[pid] !== undefined) v.myVote = s.votes[pid];
    v.notes = clonePlain(s.notes[pid]);
  }
}

function clonePlain(x) { return JSON.parse(JSON.stringify(x ?? [])); }

/** What this seat sees on its phone during the current night step. */
function nightFor(s, pid) {
  const awake = awakeNow(s);
  if (!awake.includes(pid)) return { awake: false };
  const st = stepOf(s);
  const thief = thiefOf(s);
  const out = { awake: true, with: awake.filter((p) => p !== pid) };

  if (st.k === 'open') {
    out.cheese = s.cheese.gone ? 'gone' : 'table';
    out.thief = seenThief(s, pid, st.h);
    out.picked = s.n === 5 && s.recruitHour === st.h && s.followers.length ? s.followers[0] : null;

    let mode = 'off';
    if (s.role[pid] !== THIEF && (s.n !== 4 || s.cfg.peek4)) {
      mode = awake.length > 1 ? 'together' : s.peeked[pid] ? 'done' : 'can';
    }
    out.peek = {
      mode,
      targets: mode === 'can' ? othersOf(s, pid) : [],
      done: s.peeked[pid] && s.peeked[pid].h === st.h
        ? { target: s.peeked[pid].target, dice: s.peeked[pid].dice.slice() } : null,
    };
    out.steal = {
      can: canSteal(s, pid),
      twoWakes: s.n === 4 && pid === thief && s.wake[pid].length > 1,
    };
    out.recruit = s.pending && s.pending.by === pid
      ? { count: s.pending.count, among: s.pending.among.slice() } : null;
  } else if (st.k === 'rec-pick') {
    out.recruit = s.pending && s.pending.by === pid
      ? { count: s.pending.count, among: s.pending.among.slice() } : null;
    out.recruited = s.followers.slice();
  } else if (st.k === 'rec-meet') {
    out.meet = pid === thief
      ? { thief: null, mates: s.followers.slice() }
      : { thief: followerKnowsThief(s, pid), mates: s.followers.filter((f) => f !== pid) };
  }
  return out;
}
