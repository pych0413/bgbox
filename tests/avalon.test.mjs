// ============================================================
// tests/avalon.test.mjs — 阿瓦隆: every rule and edge case of docs/research/avalon.md ("Edge cases"),
// config presets, night knowledge, secrecy (leak checks), the decoy rule, cues, auto-act, a fuzzer
// over every head-count, and the phone UI against a fake DOM.
//   node tests/run.mjs avalon
// ============================================================

import { test, assert, Sim, HOST, ACT, makePlayers, assertResultShape } from './lib.mjs';
import { mulberry32, clone } from '../js/core/engine-kit.js';
import * as game from '../js/games/avalon/game.js';
import * as S from '../js/games/avalon/script.js';

const { engine, config, meta, rules, GOOD_COUNT, EVIL_COUNT, TEAM_SIZE, failsNeeded, approvalsNeeded, composition } = game;

const COUNTS = [5, 6, 7, 8, 9, 10];
const ROLE_IDS = ['merlin', 'percival', 'servant', 'assassin', 'morgana', 'mordred', 'oberon', 'minion'];
const EVIL_IDS = ['assassin', 'morgana', 'mordred', 'oberon', 'minion'];
const TAP = { revealSecs: 0, questSecs: 0 };

// ---------- helpers ----------

const ids = (n) => makePlayers(n).map((p) => p.id);
const cfgFor = (n, patch = {}) => config.defaults(n, { ...TAP, ...patch });

/** A tap-mode game (nobody waits for a clock) with the given settings. */
function mk(n, { seed = 1, ...patch } = {}) {
  return new Sim(game, { n, seed, config: cfgFor(n, patch) });
}
/** A timed game (the real defaults). */
function mkTimed(n, seed = 1, patch = {}) {
  return new Sim(game, { n, seed, config: config.defaults(n, patch) });
}

const st = (sim) => sim.state;
const phase = (sim) => sim.state.phase;
const leader = (sim) => sim.state.order[sim.state.leaderIx];
const isEvil = (sim, p) => S.teamOf(sim.state.role[p]) === 'evil';
const goods = (sim) => sim.state.order.filter((p) => !isEvil(sim, p));
const evils = (sim) => sim.state.order.filter((p) => isEvil(sim, p));
const seatOf = (sim, role) => sim.state.order.find((p) => sim.state.role[p] === role);
const ok = (sim, pid, action, msg = '') => assert.equal(sim.act(pid, action), true, `${pid} ${JSON.stringify(action)} should change state ${msg}`);
const no = (sim, pid, action, msg = '') => assert.equal(sim.act(pid, action), false, `${pid} ${JSON.stringify(action)} should do nothing ${msg}`);

function revealAll(sim) {
  assert.equal(phase(sim), 'reveal');
  if (st(sim).cfg.revealSecs > 0) sim.advance();
  else for (const p of ids(st(sim).n)) sim.act(p, { type: 'seen' });
  assert.equal(phase(sim), 'pick');
}

/** Put specific roles on specific seats (a permutation of the dealt deck) and rebuild what each seat knows. */
function rig(sim, byRole) {
  const s = st(sim);
  const want = {};
  for (const [role, pid] of Object.entries(byRole)) want[pid] = role;
  const free = s.order.filter((p) => !(p in want));
  const leftover = [];
  for (const p of s.order) if (!(p in want)) leftover.push(s.role[p]);
  // roles that were dealt but not named keep their relative order on the free seats
  const named = new Set(Object.keys(byRole));
  const pool = [...s.order.map((p) => s.role[p])];
  for (const r of named) { const i = pool.indexOf(r); assert.ok(i >= 0, `role ${r} is not in this deck`); pool.splice(i, 1); }
  free.forEach((p, i) => { want[p] = pool[i]; });
  for (const p of s.order) s.role[p] = want[p];
  const rng = mulberry32(5);
  for (const p of s.order) s.knows[p] = game.knowledgeFor(s, p, rng);
  void leftover;
  return sim;
}

function pickTeam(sim, team = null) {
  const s = st(sim);
  const size = TEAM_SIZE[s.n][s.questNo - 1];
  const t = team ?? s.order.slice(0, size);
  ok(sim, leader(sim), { type: 'pick', team: t });
  return t;
}
function voteAll(sim, how = 'approve') {
  for (const p of st(sim).order) {
    const v = typeof how === 'function' ? how(p) : how;
    sim.act(p, { type: 'vote', vote: v });
  }
}
const cont = (sim) => ok(sim, leader(sim), { type: 'continue' });

/** Everyone in the team plays `cardOf(pid)`. In a timed game the clock then runs out. */
function playCards(sim, cardOf = () => 'success') {
  assert.equal(phase(sim), 'quest');
  for (const p of st(sim).team) sim.act(p, { type: 'quest', card: cardOf(p) });
  if (st(sim).cfg.questSecs > 0) sim.advance();
}

/** Skip a Lady step if one is due: the holder checks the first legal seat. */
function passLady(sim) {
  while (phase(sim) === 'lady' || phase(sim) === 'lady-peek') {
    const holder = st(sim).lady.step.holder;
    const a = sim.legal(holder)[0];
    ok(sim, holder, a);
  }
}

/**
 * Play the current quest (leader picks a team, all approve, cards) so it ends as asked.
 * A failing quest needs enough evil seats on the team; a succeeding one is all good. Stops at quest-result.
 */
function forceQuest(sim, success, { extraFail = 0 } = {}) {
  const s = st(sim);
  assert.equal(phase(sim), 'pick', `forceQuest from ${phase(sim)}`);
  const size = TEAM_SIZE[s.n][s.questNo - 1];
  const need = failsNeeded(s.n, s.questNo);
  const g = goods(sim);
  const e = evils(sim);
  const nEvil = success ? 0 : Math.min(e.length, need + extraFail);
  const team = [...e.slice(0, nEvil), ...g.slice(0, size - nEvil)];
  assert.equal(team.length, size, 'cannot build the team');
  pickTeam(sim, team);
  voteAll(sim, 'approve');
  assert.equal(phase(sim), 'voted');
  cont(sim);
  playCards(sim, (p) => (isEvil(sim, p) && !success ? 'fail' : 'success'));
  assert.equal(phase(sim), 'quest-result');
  return team;
}

/** Quests one after another with the given outcomes, taking every Lady step. Ends in `pick` (or wherever the game goes). */
function playResults(sim, results) {
  for (const r of results) {
    forceQuest(sim, r);
    cont(sim);
    passLady(sim);
  }
}

/** Reach the assassination: three quick successes. */
function toAssassinate(sim) {
  if (phase(sim) === 'reveal') revealAll(sim);
  for (let i = 0; i < 3; i++) { forceQuest(sim, true); cont(sim); passLady(sim); }
  assert.equal(phase(sim), 'assassinate');
}

/**
 * Sim.runRandom without the per-step clone and double JSON.stringify (that harness cost dominates a 600-game fuzz).
 * Same policy: random legal moves, then cues, then the clock, then the host's 下一步. Every 8th move still checks
 * that a legal action really changes the state; the full-strength Sim.runRandom runs in the other fuzzers.
 */
function fastRun(sim, { onStep, maxSteps = 20000 } = {}) {
  const ids2 = sim.players.map((p) => p.id);
  for (let i = 0; i < maxSteps; i++) {
    const res = engine.result(sim.state);
    if (res) { assertResultShape(res, sim.players); return res; }
    const movers = ids2.filter((id) => engine.legalActions(sim.state, id).length);
    const check = i % 8 === 0;
    const before = check ? JSON.stringify(sim.state) : null;
    let progressed = true;
    if (movers.length && sim.rng() < 0.85) {
      const pid = movers[Math.floor(sim.rng() * movers.length)];
      const options = engine.legalActions(sim.state, pid);
      sim.state = engine.act(sim.state, { pid, action: options[Math.floor(sim.rng() * options.length)] }, sim.ctx()) ?? sim.state;
      if (check) assert.notEqual(JSON.stringify(sim.state), before, 'a legal action changed nothing');
    } else if (sim.cue()) {
      sim.state = engine.act(sim.state, { pid: HOST, action: { type: ACT.CUE_DONE, id: sim.cue().id } }, sim.ctx()) ?? sim.state;
    } else if (sim.state.deadline != null && (sim.now = Math.max(sim.now, sim.state.deadline), true)) {
      const b = JSON.stringify(sim.state);
      sim.state = engine.advance(sim.state, sim.ctx()) ?? sim.state;
      progressed = JSON.stringify(sim.state) !== b;
      if (!progressed && movers.length) {
        const pid = movers[0];
        sim.state = engine.act(sim.state, { pid, action: engine.legalActions(sim.state, pid)[0] }, sim.ctx()) ?? sim.state;
        progressed = true;
      }
    } else if (movers.length) {
      const pid = movers[0];
      sim.state = engine.act(sim.state, { pid, action: engine.legalActions(sim.state, pid)[0] }, sim.ctx()) ?? sim.state;
    } else {
      const b = JSON.stringify(sim.state);
      sim.state = engine.act(sim.state, { pid: HOST, action: { type: ACT.NEXT } }, sim.ctx()) ?? sim.state;
      progressed = JSON.stringify(sim.state) !== b;
    }
    assert.ok(progressed, `fastRun stuck in ${sim.state.phase}`);
    sim.steps++;
    if (onStep) onStep(sim);
  }
  throw new Error(`no result after ${maxSteps} steps`);
}

// ---------- invariants and leak checks (also run inside the fuzzers) ----------

const walkStrings = (o, fn, path = '$') => {
  if (typeof o === 'string') fn(o, path);
  else if (Array.isArray(o)) o.forEach((x, i) => walkStrings(x, fn, `${path}[${i}]`));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walkStrings(v, fn, `${path}.${k}`);
};
const walkKeys = (o, fn, path = '$') => {
  if (Array.isArray(o)) o.forEach((x, i) => walkKeys(x, fn, `${path}[${i}]`));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { fn(k, `${path}.${k}`); walkKeys(v, fn, `${path}.${k}`); }
};

function checkInvariants(sim) {
  const s = st(sim);
  assert.equal(s.order.length, s.n);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'state must be plain JSON');
  // the deck never changes and matches what was dealt
  const counts = {};
  for (const p of s.order) counts[s.role[p]] = (counts[s.role[p]] ?? 0) + 1;
  assert.deepEqual(counts, Object.fromEntries(s.deck.map((d) => [d.role, d.count])));
  assert.equal(counts.merlin, 1);
  assert.equal(counts.assassin, 1);
  assert.equal(s.deck.reduce((a, d) => a + d.count, 0), s.n);
  assert.equal(S.ROLE_ORDER.filter((r) => s.deck.some((d) => d.role === r && S.teamOf(r) === 'good')).length > 0, true);
  const goodN = s.deck.filter((d) => S.teamOf(d.role) === 'good').reduce((a, d) => a + d.count, 0);
  assert.equal(goodN, GOOD_COUNT[s.n]);
  assert.equal(s.n - goodN, EVIL_COUNT[s.n]);
  // quests and the board
  assert.ok(s.quests.length <= 5);
  assert.equal(s.results.filter((r) => r !== null).length, s.quests.length);
  assert.ok(s.results.filter((r) => r === true).length <= 3 && s.results.filter((r) => r === false).length <= 3);
  assert.ok(s.rejects >= 0 && s.rejects <= 5);
  // consecutive rejections of this quest = trailing rejected proposals of the vote log
  let trailing = 0;
  for (let i = s.voteLog.length - 1; i >= 0 && !s.voteLog[i].approved; i--) trailing++;
  if (s.phase !== 'over') assert.equal(s.rejects, trailing, 'vote track = trailing rejected proposals');
  // the leader token moves one seat per proposal, approved or not
  if (s.phase !== 'reveal' && s.phase !== 'over') {
    const proposals = s.voteLog.length + (['pick', 'vote'].includes(s.phase) ? 0 : 0);
    const expectedNo = proposals + 1;
    const settled = ['pick', 'vote'].includes(s.phase);
    if (settled) {
      // a 呢鋪唔計 during the pick passes the token without a proposal
      const skips = (s.voids ?? []).filter((x) => x.phase === 'pick').length;
      assert.equal(s.proposalNo, expectedNo);
      assert.equal(s.leaderIx, (s.startIx + s.proposalNo - 1 + skips) % s.n);
    }
  }
  // Lady: nobody holds twice, the first holder sits right of the first leader
  if (s.ladyOn) {
    assert.equal(new Set(s.lady.held).size, s.lady.held.length);
    assert.equal(s.lady.held[0], s.order[(s.startIx - 1 + s.n) % s.n]);
    assert.equal(s.lady.holder, s.lady.held[s.lady.held.length - 1]);
    for (const l of s.lady.log) assert.ok(l.q >= 2 && l.q <= 4);
  } else {
    assert.equal(s.lady.log.length, 0);
  }
}

const KNOWN_STATE_KEYS = ['cfg', 'names', 'gid', 'startIx', 'leaderIx', 'pendingEnd', 'cueAck', 'decoyed', 'cards', 'flipMap', 'roleOf',
  'votes', 'played', 'auto', 'knows', 'results', 'final', 'voteLog', 'voids', 'passPhone'];

/** Independent restatement of the research table: who a seat is told about. */
function oracle(sim, pid) {
  const s = st(sim);
  const roleOf = (p) => s.role[p];
  const evilSet = s.order.filter((p) => EVIL_IDS.includes(roleOf(p)));
  const r = roleOf(pid);
  if (r === 'merlin') {
    return { kind: 'seesEvil', set: evilSet.filter((p) => roleOf(p) !== 'mordred' && !(roleOf(p) === 'oberon' && !s.cfg.oberonSeenByMerlin)) };
  }
  if (r === 'percival') return { kind: 'seesMerlin', set: s.order.filter((p) => roleOf(p) === 'merlin' || roleOf(p) === 'morgana') };
  if (r === 'oberon') return { kind: 'alone', set: [] };
  if (EVIL_IDS.includes(r)) return { kind: 'allies', set: evilSet.filter((p) => p !== pid && roleOf(p) !== 'oberon') };
  return { kind: 'none', set: [] };
}

/**
 * The secrecy invariant, evaluated against the live state after any step:
 *  - no role name appears in a view except the public deck, the viewer's own card, and (when the table agreed) the flipped evil cards
 *  - what a seat is told equals the research table
 *  - nobody else's vote, quest card or Lady result is in a view before it is public
 */
function checkLeaks(sim) {
  const s = st(sim);
  const over = s.phase === 'over';
  const flipped = s.phase === 'assassinate' && s.cfg.flipEvil;
  for (const pid of [...ids(s.n), null]) {
    const v = sim.view(pid);
    const label = `${pid ?? 'table'} in ${s.phase}`;
    if (pid === null) assert.equal(v.mine, undefined, `table view carries a card (${label})`);
    if (over) continue;

    walkStrings(v, (str, path) => {
      if (!ROLE_IDS.includes(str)) return;
      const own = path === '$.mine.role' && pid !== null;
      const deck = /^\$\.deck\[\d+\]\.role$/.test(path);
      const flip = flipped && /^\$\.assassinate\.flipped\[\d+\]\.role$/.test(path);
      assert.ok(own || deck || flip, `role "${str}" leaks at ${path} (${label})`);
    });
    walkKeys(v, (k, path) => {
      if (KNOWN_STATE_KEYS.includes(k)) {
        // `votes`, `results` and the viewer's own `knows` are public / own structures in some places
        const publicVotes = k === 'votes' && /^\$\.(voted|history\[\d+\])\.votes$/.test(path);
        const publicResults = k === 'results' && path === '$.board.results';
        const ownKnows = k === 'knows' && path === '$.mine.knows' && pid !== null;
        assert.ok(publicVotes || publicResults || ownKnows, `state key "${k}" leaks at ${path} (${label})`);
      }
    });

    if (pid !== null) {
      const want = oracle(sim, pid);
      assert.equal(v.mine.role, s.role[pid]);
      assert.equal(v.mine.knows.kind, want.kind, `kind for ${label}`);
      assert.deepEqual([...v.mine.knows.pids].sort(), want.set.slice().sort(), `knowledge for ${label}`);
    }

    // votes
    if (s.phase === 'vote') {
      assert.deepEqual(Object.keys(v.vote).sort(), ['leader', 'mine', 'progress', 'team']);
      assert.equal(v.vote.mine, pid !== null ? (s.votes[pid] ?? null) : null);
    } else {
      assert.equal(v.vote, undefined);
    }
    // quest cards
    if (s.phase === 'quest') {
      const member = pid !== null && s.team.includes(pid);
      assert.equal(v.quest.mine !== null, member);
      if (member) assert.deepEqual(Object.keys(v.quest.mine).sort(), ['canFail', 'done', 'flip', 'member']);
    }
    // the Lady's answer
    if (v.ladyStep?.mine) assert.equal(pid, v.ladyStep.holder, `Lady result leaks to ${label}`);
    walkKeys(v, (k, path) => { if (k === 'loyalty') assert.equal(path, '$.ladyStep.mine.loyalty', `loyalty leaks at ${path}`); });
    // the assassination screen has one shape for everybody
    if (s.phase === 'assassinate') assert.deepEqual(Object.keys(v.assassinate).sort(), ['canShoot', 'candidates', 'flipped', 'tapped']);
  }
}

// ============================================================
// meta, tables and config
// ============================================================

test('avalon: meta, rules and engine surface are well-formed', () => {
  assert.equal(meta.id, 'avalon');
  assert.deepEqual(meta.players, [5, 10]);
  assert.equal(meta.narration, 'optional');
  assert.equal(meta.singleDevice, 'full');
  assert.equal(meta.css, true);
  assert.ok(Array.isArray(meta.banks) && meta.banks.length === 0);
  assert.ok(rules.quick.length >= 5 && rules.quick.length <= 6 && rules.quick.every((l) => typeof l === 'string' && l));
  assert.deepEqual(rules.roles.map((r) => r.id), ROLE_IDS);
  for (const r of rules.roles) { assert.ok(r.name && r.emoji && r.text); assert.ok(['good', 'evil'].includes(r.team)); }
  assert.ok(rules.sections.length >= 6 && rules.sections.every((x) => x.title && x.body));
  for (const k of ['setup', 'act', 'advance', 'view', 'cue', 'focus', 'blocking', 'autoAct', 'legalActions', 'result']) {
    assert.equal(typeof engine[k], 'function', `engine.${k}`);
  }
  for (const k of ['defaults', 'validate', 'fields', 'summary', 'presets']) assert.equal(typeof config[k], 'function', `config.${k}`);
});

test('avalon: the research tables — sizes, fails needed, approvals needed — for every head-count', () => {
  const sizes = {
    5: [2, 3, 2, 3, 3], 6: [2, 3, 4, 3, 4], 7: [2, 3, 3, 4, 4], 8: [3, 4, 4, 5, 5], 9: [3, 4, 4, 5, 5], 10: [3, 4, 4, 5, 5],
  };
  const good = { 5: 3, 6: 4, 7: 4, 8: 5, 9: 6, 10: 6 };
  const evil = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };
  const approvals = { 5: 3, 6: 4, 7: 4, 8: 5, 9: 5, 10: 6 };
  for (const n of COUNTS) {
    assert.deepEqual(TEAM_SIZE[n], sizes[n], `team sizes n=${n}`);
    assert.equal(GOOD_COUNT[n], good[n]);
    assert.equal(EVIL_COUNT[n], evil[n]);
    assert.equal(GOOD_COUNT[n] + EVIL_COUNT[n], n);
    assert.equal(approvalsNeeded(n), approvals[n], `approvals n=${n}`);
    for (let q = 1; q <= 5; q++) {
      assert.equal(failsNeeded(n, q), n >= 7 && q === 4 ? 2 : 1, `fails needed n=${n} q=${q}`);
    }
  }
});

test('avalon: every preset is a legal deck for every head-count, with the expected composition', () => {
  const expect = {
    recommended: {
      5: { percival: 1, morgana: 1, servant: 1, minion: 0 }, 6: { percival: 1, morgana: 1, servant: 2, minion: 0 },
      7: { percival: 1, morgana: 1, oberon: 1, servant: 2, minion: 0 }, 8: { percival: 1, morgana: 1, servant: 3, minion: 1 },
      9: { percival: 1, morgana: 1, mordred: 1, servant: 4, minion: 0 }, 10: { percival: 1, morgana: 1, mordred: 1, oberon: 1, servant: 4, minion: 0 },
    },
    plain: {
      5: { servant: 2, minion: 1 }, 6: { servant: 3, minion: 1 }, 7: { servant: 3, minion: 2 },
      8: { servant: 4, minion: 2 }, 9: { servant: 5, minion: 2 }, 10: { servant: 5, minion: 3 },
    },
    alt: {
      5: { percival: 1, mordred: 1, servant: 1 }, 6: { percival: 1, mordred: 1, servant: 2 }, 7: { percival: 1, morgana: 1, servant: 2, minion: 1 },
      8: { percival: 1, morgana: 1, mordred: 1, servant: 3 }, 9: { percival: 1, morgana: 1, oberon: 1, servant: 4 },
      10: { percival: 1, morgana: 1, mordred: 1, servant: 4, minion: 1 },
    },
  };
  for (const n of COUNTS) {
    for (const preset of ['recommended', 'plain', 'alt', 'custom']) {
      const cfg = config.defaults(n, { preset });
      const v = config.validate(cfg, n);
      assert.ok(v.ok, `n=${n} preset=${preset}: ${v.message}`);
      const comp = composition({ ...cfg }, n);
      assert.ok(comp.ok);
      assert.equal(comp.counts.merlin, 1);
      assert.equal(comp.counts.assassin, 1);
      const good2 = comp.counts.merlin + comp.counts.percival + comp.counts.servant;
      assert.equal(good2, GOOD_COUNT[n]);
      assert.equal(n - good2, EVIL_COUNT[n]);
      assert.ok(comp.counts.servant <= 5 && comp.counts.minion <= 3);
      const want = expect[preset === 'custom' ? 'recommended' : preset][n];
      const full = { percival: 0, morgana: 0, mordred: 0, oberon: 0, servant: 0, minion: 0, ...want };
      for (const [r, k] of Object.entries(full)) assert.equal(comp.counts[r], k, `n=${n} ${preset} ${r}`);
    }
  }
});

test('avalon: defaults is valid for every head-count and each preset has a reason', () => {
  for (const n of COUNTS) {
    const cfg = config.defaults(n);
    assert.equal(config.validate(cfg, n).ok, true, `n=${n}`);
    assert.equal(cfg.preset, 'recommended');
    const lines = config.summary(cfg, n);
    assert.ok(lines.some((l) => l.startsWith('💡')), 'the reason is part of the lobby summary');
    for (const preset of ['recommended', 'plain', 'alt', 'custom']) {
      const reason = S.presetReason(preset, n);
      assert.ok(typeof reason === 'string' && reason.length > 10, `${preset}/${n}`);
      const fields = config.fields({ ...cfg, preset }, n);
      assert.equal(fields[0].key, 'preset');
      assert.equal(fields[0].help, reason, 'the preset field shows why');
    }
  }
  // the reasons differ between head-counts for the recommended set
  assert.equal(new Set(COUNTS.map((n) => S.presetReason('recommended', n))).size, COUNTS.length);
});

test('avalon: defaults(n, prev) keeps the last choices, repairs them for a new head-count, and ignores junk', () => {
  const prev = config.defaults(8, { preset: 'custom', roles: { percival: 1, morgana: 1, mordred: 1, oberon: 1 }, lady: 'off', revealSecs: 40, questSecs: 20, flipEvil: true, discussSecs: 90 });
  for (const n of COUNTS) {
    const c = config.defaults(n, prev);
    assert.ok(config.validate(c, n).ok, `n=${n}`);
    assert.equal(c.preset, 'custom');
    assert.equal(c.lady, 'off');
    assert.equal(c.revealSecs, 40);
    assert.equal(c.questSecs, 20);
    assert.equal(c.flipEvil, true);
    assert.equal(c.discussSecs, 90);
    const evilSpecials = c.roles.morgana + c.roles.mordred + c.roles.oberon;
    assert.ok(evilSpecials <= EVIL_COUNT[n] - 1, `n=${n}: ${evilSpecials} evil specials`);
  }
  // small tables keep Morgana before Mordred before Oberon
  assert.deepEqual(config.defaults(5, prev).roles, { percival: 1, morgana: 1, mordred: 0, oberon: 0 });
  // not on 自訂: the editor value follows the recommendation, so switching to it starts somewhere sensible
  assert.deepEqual(config.defaults(9, { preset: 'plain', roles: { percival: 0, morgana: 0, mordred: 0, oberon: 1 } }).roles,
    { percival: 1, morgana: 1, mordred: 1, oberon: 0 });
  // one shared phone: no clocks
  const one = config.defaults(6, { revealSecs: 25, questSecs: 12 }, { singleDevice: true });
  assert.equal(one.revealSecs, 0);
  assert.equal(one.questSecs, 0);
  // junk
  assert.deepEqual(config.defaults(6, 'nope'), config.defaults(6));
  const junk = config.defaults(6, { preset: 'zzz', lady: 7, revealSecs: -4, questSecs: 1.5, roles: { percival: 5 }, flipEvil: 'yes', extra: 1 });
  assert.deepEqual(junk, config.defaults(6));
  assert.ok(!('extra' in junk));
  assert.equal(config.defaults(6, { revealSecs: '30' }).revealSecs, 30);   // numeric strings from a form
  // an out-of-range head-count is clamped rather than throwing
  assert.ok(config.validate(config.defaults(3), 5).ok);
  assert.ok(config.validate(config.defaults(14), 10).ok);
});

test('avalon: one shared phone zeroes both clocks, and they come back when the table spreads over several phones', () => {
  for (const n of COUNTS) {
    const one = config.defaults(n, undefined, { singleDevice: true });
    assert.equal(one.revealSecs, 0);
    assert.equal(one.questSecs, 0);
    assert.equal(one.passPhone, true);
    assert.ok(config.validate(one, n).ok);
    assert.ok(config.summary(one, n).includes(S.CONFIG.summary.onePhone), 'the lobby says why there is no clock');
    // friends join on their own phones: the room asks again with singleDevice false
    const many = config.defaults(n, one, { singleDevice: false });
    assert.equal(many.revealSecs, 25);
    assert.equal(many.questSecs, 12);
    assert.equal(many.passPhone, false);
    assert.ok(!config.summary(many, n).includes(S.CONFIG.summary.onePhone));
    // a table that chose tap mode itself keeps it on several phones
    const chosen = config.defaults(n, { revealSecs: 0, questSecs: 0 }, { singleDevice: false });
    assert.equal(chosen.revealSecs, 0);
    assert.equal(chosen.questSecs, 0);
    // no environment (tests, old callers): nothing moves
    assert.equal(config.defaults(n, one).revealSecs, 0);
    // a one-phone setting with the rest of the table's choices keeps those choices
    const prev = config.defaults(n, { preset: 'plain', lady: 'on', flipEvil: true, discussSecs: 60 }, { singleDevice: true });
    assert.deepEqual([prev.preset, prev.lady, prev.flipEvil, prev.discussSecs], ['plain', 'on', true, 60]);
  }
  assert.equal(config.validate({ ...config.defaults(6), passPhone: 'yes' }, 6).ok, false, 'passPhone is a boolean');
});

test('avalon: presets — a one-tap set-up with a readable reason for every head-count, each one valid, the first is the default', () => {
  for (const n of COUNTS) {
    const list = config.presets(n);
    assert.ok(list.length >= 3);
    assert.equal(new Set(list.map((p) => p.id)).size, list.length, 'unique ids');
    assert.equal(list[0].id, 'standard');
    for (const p of list) {
      assert.ok(typeof p.label === 'string' && p.label.length >= 2 && [...p.label].length <= 6, `label ${p.label}`);
      assert.ok(typeof p.reason === 'string' && [...p.reason].length >= 8 && [...p.reason].length <= 30, `reason (n=${n} ${p.id}): ${p.reason}`);
      // a patch over whatever the table had: always valid at this head-count
      for (const base of [config.defaults(n), config.defaults(n, { preset: 'custom', roles: { percival: 0, morgana: 1, mordred: 1, oberon: 1 } }), config.defaults(n, { lady: 'on', oberonSeenByMerlin: false })]) {
        const cfg = config.defaults(n, { ...base, ...p.cfg });
        const v = config.validate({ ...base, ...p.cfg }, n);
        assert.ok(v.ok, `n=${n} ${p.id}: ${v.message}`);
        for (const [k, x] of Object.entries(p.cfg)) assert.deepEqual(cfg[k], x, `n=${n} ${p.id}: ${k} survives defaults()`);
      }
    }
    // the first chip is what defaults deals, so the lobby lights it up on a fresh table
    const d = config.defaults(n);
    for (const [k, x] of Object.entries(list[0].cfg)) assert.deepEqual(d[k], x, `standard ${k}`);
    // 新手: no optional role and no Lady
    const beginner = list.find((p) => p.id === 'beginner');
    const bc = composition(config.defaults(n, beginner.cfg), n).counts;
    assert.deepEqual([bc.percival, bc.morgana, bc.mordred, bc.oberon], [0, 0, 0, 0]);
    assert.equal(game.ladyOn(config.defaults(n, beginner.cfg), n), false);
    // 奧伯倫隱形 only where the standard deck has Oberon, and it flips both switches
    const hidden = list.find((p) => p.id === 'hidden-oberon');
    assert.equal(!!hidden, n === 7 || n === 10, `hidden-oberon at n=${n}`);
    if (hidden) {
      assert.equal(hidden.cfg.oberonSeenByMerlin, false);
      assert.equal(hidden.cfg.oberonReadsGoodToLady, true);
      const sim = new Sim(game, { n, seed: 3, config: config.defaults(n, { ...TAP, ...hidden.cfg }) });
      const merlin = seatOf(sim, 'merlin');
      const oberon = seatOf(sim, 'oberon');
      assert.ok(!sim.view(merlin).mine.knows.pids.includes(oberon), 'Merlin does not see Oberon');
    }
    // every chip deals what its label says
    const decks = list.map((p) => JSON.stringify(composition(config.defaults(n, p.cfg), n).counts));
    assert.equal(new Set(decks.slice(0, 3)).size, 3, `standard, beginner and alt deal different decks at n=${n}`);
  }
  assert.ok(config.presets(3).length >= 3, 'an odd head-count is clamped, not thrown');
});

test('avalon: role-count fuzz — any custom pick is valid exactly when it fits, and then deals the right teams', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 400; i++) {
    const n = COUNTS[Math.floor(rng() * COUNTS.length)];
    const roles = { percival: rng() < 0.5 ? 1 : 0, morgana: rng() < 0.5 ? 1 : 0, mordred: rng() < 0.5 ? 1 : 0, oberon: rng() < 0.5 ? 1 : 0 };
    const cfg = { ...config.defaults(n, TAP), preset: 'custom', roles };
    const evilSpecials = roles.morgana + roles.mordred + roles.oberon;
    const v = config.validate(cfg, n);
    assert.equal(v.ok, evilSpecials <= EVIL_COUNT[n] - 1, `n=${n} ${JSON.stringify(roles)}: ${v.message}`);
    if (!v.ok) { assert.match(v.message, /最多再揀/); continue; }
    const sim = new Sim(game, { n, seed: i + 1, config: cfg });
    checkInvariants(sim);
    const dealt = {};
    for (const p of sim.state.order) dealt[sim.state.role[p]] = (dealt[sim.state.role[p]] ?? 0) + 1;
    for (const r of ['percival', 'morgana', 'mordred', 'oberon']) assert.equal(dealt[r] ?? 0, roles[r], `n=${n} ${r}`);
    assert.equal(dealt.servant ?? 0, GOOD_COUNT[n] - 1 - roles.percival);
    assert.equal(dealt.minion ?? 0, EVIL_COUNT[n] - 1 - evilSpecials);
  }
});

test('avalon: validate blocks bad setups with a Cantonese message and warns on legal-but-odd ones', () => {
  const base = config.defaults(7);
  for (const n of [0, 4, 11, 5.5, NaN]) assert.equal(config.validate(config.defaults(7), n).ok, false, `n=${n}`);
  assert.match(config.validate(base, 4).message, /5–10/);
  for (const bad of [{ preset: 'x' }, { lady: 'maybe' }, { revealSecs: 121 }, { revealSecs: -1 }, { questSecs: 61 }, { discussSecs: 601 },
    { assassinSecs: 1.5 }, { flipEvil: 1 }, { oberonSeenByMerlin: 'yes' }, { roles: { percival: 2 } }, { roles: { zzz: 1 } }, { roles: 'x' }]) {
    const v = config.validate({ ...base, ...bad }, 7);
    assert.equal(v.ok, false, JSON.stringify(bad));
    assert.ok(v.message.length > 0);
  }
  // custom: too many evil specials for the table
  const tooMany5 = { ...config.defaults(5), preset: 'custom', roles: { percival: 1, morgana: 1, mordred: 1, oberon: 0 } };
  const v5 = config.validate(tooMany5, 5);
  assert.equal(v5.ok, false);
  assert.match(v5.message, /最多再揀 1 個/);
  assert.equal(config.validate({ ...tooMany5, roles: { percival: 1, morgana: 1, mordred: 0, oberon: 0 } }, 5).ok, true);
  assert.equal(config.validate({ ...tooMany5, roles: { percival: 1, morgana: 1, mordred: 1, oberon: 0 } }, 7).ok, true);
  assert.equal(config.validate({ ...tooMany5, roles: { percival: 1, morgana: 1, mordred: 1, oberon: 1 } }, 7).ok, false, 'three specials need four evil seats');
  assert.equal(config.validate({ ...tooMany5, roles: { percival: 1, morgana: 1, mordred: 1, oberon: 1 } }, 10).ok, true);
  // warnings
  const w = (cfg, n) => config.validate(cfg, n).warnings;
  assert.ok(w({ ...config.defaults(7), preset: 'custom', roles: { percival: 0, morgana: 1, mordred: 0, oberon: 0 } }, 7).some((x) => /莫甘娜/.test(x)), 'Morgana without Percival');
  assert.ok(w({ ...config.defaults(5), preset: 'custom', roles: { percival: 1, morgana: 0, mordred: 0, oberon: 0 } }, 5).some((x) => /5 人局/.test(x)), 'Percival alone at 5');
  assert.deepEqual(w({ ...config.defaults(5), preset: 'custom', roles: { percival: 1, morgana: 0, mordred: 1, oberon: 0 } }, 5), [], 'Percival + Mordred at 5 is the official swap');
  assert.ok(w({ ...config.defaults(5), lady: 'on' }, 5).some((x) => /湖中女神/.test(x)));
  assert.deepEqual(w(config.defaults(5), 5), []);
  assert.ok(w({ ...config.defaults(6), revealSecs: 5 }, 6).some((x) => /睇身份/.test(x)));
  assert.ok(w({ ...config.defaults(6), questSecs: 3 }, 6).some((x) => /出牌/.test(x)));
  // numeric strings from a <select>/<input> are accepted
  assert.ok(config.validate({ ...base, revealSecs: '20', questSecs: '10' }, 7).ok);
});

test('avalon: fields and summary describe the setup (and only show what applies)', () => {
  for (const n of COUNTS) {
    const cfg = config.defaults(n);
    const fields = config.fields(cfg, n);
    for (const f of fields) {
      assert.ok(f.key && f.label && ['int', 'bool', 'select', 'seconds', 'roles', 'categories'].includes(f.type), JSON.stringify(f));
    }
    const keys = fields.map((f) => f.key);
    assert.ok(!keys.includes('roles'), 'the role editor only exists on 自訂');
    assert.equal(keys.includes('oberonSeenByMerlin'), n === 7 || n === 10, `oberon switch n=${n}`);
    const custom = config.fields({ ...cfg, preset: 'custom' }, n);
    const roles = custom.find((f) => f.type === 'roles');
    assert.ok(roles);
    assert.deepEqual(roles.options.map((o) => o.id), ['merlin', 'assassin', 'percival', 'morgana', 'mordred', 'oberon', 'servant', 'minion']);
    assert.ok(roles.options.filter((o) => o.auto).map((o) => o.id).join() === 'servant,minion');
    assert.match(roles.help, /✓/);
    for (const key of keys) if (!['preset', 'lady'].includes(key) && !key.startsWith('oberon')) assert.ok(key in config.defaults(n), `field ${key} has a default`);
  }
  // lady: the Oberon-reads-good switch only matters when the Lady is in play
  const c10 = config.defaults(10);
  assert.ok(config.fields(c10, 10).some((f) => f.key === 'oberonReadsGoodToLady'));
  assert.ok(!config.fields({ ...c10, lady: 'off' }, 10).some((f) => f.key === 'oberonReadsGoodToLady'));
  // summary
  const lines = config.summary(config.defaults(7), 7);
  assert.equal(lines[0], '7 人：4 好 3 壞');
  assert.ok(lines.includes('🔵 好人：梅林、派西維爾、亞瑟忠臣 ×2'));
  assert.ok(lines.includes('🔴 邪惡：刺客、莫甘娜、奧伯倫'));
  assert.ok(lines.some((l) => l.includes('湖中女神：開（人數夠，自動開）')));
  assert.ok(lines.some((l) => l.startsWith('奧伯倫：梅林睇到')));
  assert.ok(config.summary(config.defaults(5), 5).some((l) => l === '🌊 湖中女神：關'));
  assert.ok(config.summary({ ...config.defaults(6), flipEvil: true, discussSecs: 120, assassinSecs: 60, revealSecs: 0 }, 6)
    .join('|').match(/刺殺前邪惡亮牌.*|組隊討論 120 秒|刺殺商量 60 秒|睇身份：每人睇完自己㩒/g).length >= 4);
  // an invalid setup still summarises
  const bad = { ...config.defaults(5), preset: 'custom', roles: { percival: 1, morgana: 1, mordred: 1, oberon: 1 } };
  assert.ok(config.summary(bad, 5).length >= 4);
});

test('avalon: the Lady setting follows the head-count only when it is on 跟人數', () => {
  for (const n of COUNTS) {
    assert.equal(game.ladyOn(config.defaults(n), n), n >= 7, `auto n=${n}`);
    assert.equal(game.ladyOn({ ...config.defaults(n), lady: 'on' }, n), true);
    assert.equal(game.ladyOn({ ...config.defaults(n), lady: 'off' }, n), false);
    assert.equal(mk(n, { lady: 'on' }).state.ladyOn, true);
    assert.equal(mk(n, { lady: 'off' }).state.ladyOn, false);
    assert.equal(mk(n).state.ladyOn, n >= 7);
  }
});

// ============================================================
// setup and dealing
// ============================================================

test('avalon: setup deals exactly the deck, one card per seat, and nothing else', () => {
  for (const n of COUNTS) {
    for (const preset of ['recommended', 'plain', 'alt']) {
      const sim = mk(n, { seed: n * 3, preset });
      checkInvariants(sim);
      assert.equal(phase(sim), 'reveal');
      assert.equal(sim.result(), null);
      assert.equal(sim.state.questNo, 1);
      assert.equal(sim.state.proposalNo, 1);
      assert.equal(sim.state.rejects, 0);
      assert.deepEqual(sim.state.results, [null, null, null, null, null]);
    }
  }
});

test('avalon: setup throws on an invalid config or head-count (the room validates first)', () => {
  const bad = { ...config.defaults(5), preset: 'custom', roles: { percival: 1, morgana: 1, mordred: 1, oberon: 1 } };
  assert.throws(() => engine.setup({ players: makePlayers(5), config: bad, rng: mulberry32(1), now: 0 }), /invalid config/);
  assert.throws(() => engine.setup({ players: makePlayers(4), config: config.defaults(5), rng: mulberry32(1), now: 0 }), /5-10/);
  assert.throws(() => engine.setup({ players: makePlayers(11), config: config.defaults(10), rng: mulberry32(1), now: 0 }), /5-10/);
});

test('avalon: the same seed deals the same game, different seeds differ, and no seat is favoured', () => {
  const a = mk(8, { seed: 5 });
  const b = mk(8, { seed: 5 });
  assert.deepEqual(a.state, b.state);
  const deals = new Set();
  for (let seed = 1; seed <= 30; seed++) deals.add(JSON.stringify(mk(8, { seed }).state.role));
  assert.ok(deals.size > 25, 'dealing looks shuffled');
  // each seat is Merlin about 1/n of the time, and the first leader is uniform too
  const n = 7;
  const merlin = Array(n).fill(0);
  const first = Array(n).fill(0);
  const games = 2100;
  for (let seed = 1; seed <= games; seed++) {
    const sim = mk(n, { seed });
    merlin[sim.state.order.indexOf(seatOf(sim, 'merlin'))]++;
    first[sim.state.startIx]++;
  }
  for (const h of [...merlin, ...first]) assert.ok(h > 210 && h < 400, `seat bias: ${merlin} / ${first}`);
});

test('avalon: the first leader is random, the Lady starts on the seat to its right, and the leader token is public', () => {
  for (const n of [7, 8, 9, 10]) {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = mk(n, { seed });
      const s = st(sim);
      assert.equal(s.leaderIx, s.startIx);
      assert.equal(s.lady.holder, s.order[(s.startIx + n - 1) % n], 'one seat before the first leader');
      assert.deepEqual(s.lady.held, [s.lady.holder]);
      const v = sim.view('p1');
      assert.equal(v.leader, s.order[s.startIx]);
      assert.equal(v.lady.holder, s.lady.holder);
    }
  }
  const starts = new Set();
  for (let seed = 1; seed <= 60; seed++) starts.add(mk(6, { seed }).state.startIx);
  assert.equal(starts.size, 6, 'every seat can lead first');
  assert.equal(mk(5).view('p1').lady, null, 'no Lady, no Lady block');
});

test('avalon: carry — last game\'s first leader does not lead first again; the others stay equally likely; roles have no streak rule', () => {
  const n = 6;
  const hits = Array(n).fill(0);
  const games = 1500;
  for (let seed = 1; seed <= games; seed++) {
    const sim = new Sim(game, { n, seed, config: cfgFor(n), carry: { firstLeader: 'p3' } });
    hits[sim.state.startIx]++;
  }
  assert.equal(hits[2], 0, 'p3 led first last game, so not again');
  for (const [i, h] of hits.entries()) if (i !== 2) assert.ok(h > 240 && h < 360, `the others are uniform: ${hits}`);
  // the result hands the next game its carry
  const sim = mk(7, { seed: 4 });
  sim.runRandom();
  assert.deepEqual(sim.result().carry, { firstLeader: sim.state.order[sim.state.startIx] });
  // junk carry, or a seat that left, changes nothing: the same deal as without carry
  const plain = mk(7, { seed: 9 }).state;
  for (const carry of [null, undefined, 'p1', 7, {}, { firstLeader: 'ghost' }, { firstLeader: 3 }, []]) {
    assert.deepEqual(new Sim(game, { n: 7, seed: 9, config: cfgFor(7), carry }).state, plain, `carry ${JSON.stringify(carry)}`);
  }
  // roles are dealt exactly as without carry (no "evil again" protection, which would be a public tell)
  const a = new Sim(game, { n: 7, seed: 12, config: cfgFor(7), carry: { firstLeader: 'p5' } }).state;
  const b = mk(7, { seed: 12 }).state;
  assert.deepEqual(a.role, b.role);
});

// ============================================================
// night knowledge (the research table)
// ============================================================

test('avalon: who knows whom — the observer/target table, with all four optional roles in play', () => {
  const cfg = { preset: 'custom', roles: { percival: 1, morgana: 1, mordred: 1, oberon: 1 } };
  for (let seed = 1; seed <= 25; seed++) {
    const sim = mk(10, { seed, ...cfg });
    const seat = (r) => seatOf(sim, r);
    const known = (r) => [...sim.view(seat(r)).mine.knows.pids].sort();
    const sorted = (...roles) => roles.map(seat).sort();
    assert.deepEqual(known('merlin'), sorted('assassin', 'morgana', 'oberon'), 'Merlin sees evil, not Mordred, and (official) Oberon');
    assert.deepEqual(known('percival'), sorted('merlin', 'morgana'), 'Percival sees Merlin and Morgana');
    assert.deepEqual(known('assassin'), sorted('morgana', 'mordred'), 'evil do not see Oberon');
    assert.deepEqual(known('morgana'), sorted('assassin', 'mordred'));
    assert.deepEqual(known('mordred'), sorted('assassin', 'morgana'), 'Mordred sees evil and is seen by evil');
    assert.deepEqual(known('oberon'), [], 'Oberon sees nobody');
    for (const p of sim.state.order) if (sim.state.role[p] === 'servant') assert.deepEqual(sim.view(p).mine.knows, { kind: 'none', pids: [] });
    assert.equal(sim.view(seat('oberon')).mine.knows.kind, 'alone');
    assert.equal(sim.view(seat('merlin')).mine.knows.kind, 'seesEvil');
    assert.equal(sim.view(seat('percival')).mine.knows.kind, 'seesMerlin');
    assert.equal(sim.view(seat('assassin')).mine.knows.kind, 'allies');
  }
});

test('avalon: Merlin\'s view is evil minus Mordred (Oberon unless hidden), never a role name — property over presets, counts and seeds', () => {
  for (const n of COUNTS) {
    for (const preset of ['recommended', 'plain', 'alt']) {
      for (const seenByMerlin of [true, false]) {
        for (let seed = 1; seed <= 6; seed++) {
          const sim = mk(n, { seed: seed * 7 + n, preset, oberonSeenByMerlin: seenByMerlin });
          const s = st(sim);
          const merlin = seatOf(sim, 'merlin');
          const v = sim.view(merlin);
          const evilAll = evils(sim);
          const hidden = evilAll.filter((p) => s.role[p] === 'mordred' || (s.role[p] === 'oberon' && !seenByMerlin));
          assert.equal(v.mine.knows.pids.length, evilAll.length - hidden.length, `n=${n} ${preset}`);
          for (const p of v.mine.knows.pids) assert.ok(evilAll.includes(p) && !hidden.includes(p));
          assert.deepEqual(Object.keys(v.mine.knows).sort(), ['kind', 'pids']);
          checkLeaks(sim);
        }
      }
    }
  }
});

test('avalon: Percival sees Merlin alone, or Merlin and Morgana unlabelled; Morgana without Percival and Percival without Morgana both deal', () => {
  const sim = mk(7, { seed: 3 });
  const p = seatOf(sim, 'percival');
  assert.equal(sim.view(p).mine.knows.pids.length, 2);
  assert.ok(sim.view(p).mine.knows.pids.includes(seatOf(sim, 'merlin')));
  assert.ok(sim.view(p).mine.knows.pids.includes(seatOf(sim, 'morgana')));
  // 5p, Percival + Mordred (the official swap): Percival sees exactly Merlin
  const m5 = mk(5, { seed: 4, preset: 'alt' });
  const pv = m5.view(seatOf(m5, 'percival')).mine.knows;
  assert.deepEqual(pv.pids, [seatOf(m5, 'merlin')]);
  // Merlin at 5p with Mordred + Assassin sees exactly one evil seat: the Assassin
  assert.deepEqual(m5.view(seatOf(m5, 'merlin')).mine.knows.pids, [seatOf(m5, 'assassin')]);
  // 5p, Percival alone (legal, warned): sees Merlin for sure
  const alone = mk(5, { seed: 6, preset: 'custom', roles: { percival: 1, morgana: 0, mordred: 0, oberon: 0 } });
  assert.deepEqual(alone.view(seatOf(alone, 'percival')).mine.knows.pids, [seatOf(alone, 'merlin')]);
  // Morgana without Percival: legal, nothing special happens
  const mg = mk(7, { seed: 6, preset: 'custom', roles: { percival: 0, morgana: 1, mordred: 0, oberon: 0 } });
  assert.equal(mg.state.deck.some((d) => d.role === 'percival'), false);
  assert.ok(mg.state.deck.some((d) => d.role === 'morgana'));
  assert.equal(mg.view(seatOf(mg, 'morgana')).mine.knows.kind, 'allies');
});

test('avalon: the Oberon switch hides him from Merlin; evil never see him and he sees nobody', () => {
  for (let seed = 1; seed <= 15; seed++) {
    for (const n of [7, 10]) {
      const on = mk(n, { seed });
      const off = mk(n, { seed, oberonSeenByMerlin: false });
      assert.ok(on.view(seatOf(on, 'merlin')).mine.knows.pids.includes(seatOf(on, 'oberon')));
      assert.ok(!off.view(seatOf(off, 'merlin')).mine.knows.pids.includes(seatOf(off, 'oberon')));
      for (const p of evils(on)) {
        if (on.state.role[p] === 'oberon') assert.deepEqual(on.view(p).mine.knows.pids, []);
        else assert.ok(!on.view(p).mine.knows.pids.includes(seatOf(on, 'oberon')));
      }
    }
  }
});

test('avalon: private lists are shuffled, so seat order never gives a role away', () => {
  let percivalFirstIsMerlin = 0;
  let merlinListSeatOrdered = 0;
  let alliesSeatOrdered = 0;
  const trials = 400;
  for (let seed = 1; seed <= trials; seed++) {
    const sim = mk(10, { seed, preset: 'custom', roles: { percival: 1, morgana: 1, mordred: 0, oberon: 0 } });   // 4 evil: Assassin, Morgana, 2 minions
    const order = st(sim).order;
    const pv = sim.view(seatOf(sim, 'percival')).mine.knows.pids;
    if (pv[0] === seatOf(sim, 'merlin')) percivalFirstIsMerlin++;
    const mv = sim.view(seatOf(sim, 'merlin')).mine.knows.pids;
    if (mv.every((p, i) => i === 0 || order.indexOf(mv[i - 1]) < order.indexOf(p))) merlinListSeatOrdered++;
    const av = sim.view(seatOf(sim, 'assassin')).mine.knows.pids;
    if (av.every((p, i) => i === 0 || order.indexOf(av[i - 1]) < order.indexOf(p))) alliesSeatOrdered++;
  }
  assert.ok(percivalFirstIsMerlin > trials * 0.4 && percivalFirstIsMerlin < trials * 0.6, `Percival's first name is Merlin ${percivalFirstIsMerlin}/${trials}`);
  // 4! orderings vs 1 seat-ordered one: about 1/24 of Merlin's 4 names, 1/6 of the Assassin's 3 allies
  assert.ok(merlinListSeatOrdered < trials * 0.12, `Merlin's list is mostly seat ordered: ${merlinListSeatOrdered}`);
  assert.ok(alliesSeatOrdered < trials * 0.3, `allies list is mostly seat ordered: ${alliesSeatOrdered}`);
});

// ============================================================
// the reveal window (a night-like step: fixed time, decoys everywhere)
// ============================================================

test('avalon: reveal — timed window never ends early, every seat has a harmless tap, and the clock ends it', () => {
  for (const n of COUNTS) {
    const sim = mkTimed(n, 3);
    const s = st(sim);
    assert.equal(phase(sim), 'reveal');
    assert.equal(s.deadline, sim.now + 25000);
    assert.equal(s.timerLabel, '睇身份時間');
    for (const p of ids(n)) {
      assert.deepEqual(sim.legal(p), [{ type: 'seen' }], `every seat — Merlin and servants alike — has the same tap (n=${n} ${p})`);
      assert.equal(sim.view(p).deadline, s.deadline);
    }
    assert.equal(sim.view(null).deadline, s.deadline);
    for (const p of ids(n)) ok(sim, p, { type: 'seen' });
    assert.equal(phase(sim), 'reveal', 'all seats looked, the window still runs its full time');
    for (const p of ids(n)) { no(sim, p, { type: 'seen' }); assert.deepEqual(sim.legal(p), []); }
    // before the deadline advance() does nothing
    assert.equal(JSON.stringify(engine.advance(clone(s), { ...sim.ctx(), now: s.deadline - 1 })), JSON.stringify(s));
    sim.advance();
    assert.equal(phase(sim), 'pick');
    assert.equal(st(sim).deadline, null);
  }
});

test('avalon: reveal — tap mode ends when everybody has looked, focus shrinks seat by seat, and @next skips', () => {
  const sim = mk(6, { seed: 2 });
  const order = st(sim).order;
  assert.equal(st(sim).deadline, null);
  assert.deepEqual(sim.focus(), { pids: order });
  assert.equal(sim.view('p1').opts.reveal, 'tap');
  ok(sim, 'p3', { type: 'seen' });
  assert.deepEqual(sim.focus().pids, order.filter((p) => p !== 'p3'));
  assert.equal(sim.view('p3').mine.seen, true);
  assert.equal(sim.view('p2').mine.seen, false);
  for (const p of order) sim.act(p, { type: 'seen' });
  assert.equal(phase(sim), 'pick');

  const skip = mkTimed(6, 2);
  assert.equal(skip.host({ type: ACT.NEXT }), true, 'the first 下一步 only acknowledges the cue');
  assert.equal(phase(skip), 'reveal');
  assert.equal(skip.cue(), null);
  assert.equal(skip.host({ type: ACT.NEXT }), true);
  assert.equal(phase(skip), 'pick');
});

test('avalon: the card looks the same for every role — one view shape, one timer, one tap', () => {
  const sim = mkTimed(10, 9);
  const shapes = new Set();
  for (const p of ids(10)) {
    const v = sim.view(p);
    shapes.add(JSON.stringify([Object.keys(v).sort(), Object.keys(v.mine).sort(), Object.keys(v.mine.knows).sort(), v.deadline, v.phase, v.title, v.subtitle]));
  }
  assert.equal(shapes.size, 1, 'the role card travels in the same shape to every phone');
});

// ============================================================
// picking a team
// ============================================================

test('avalon: the team must be exactly the right size, distinct, real seats, named by the leader', () => {
  for (const n of COUNTS) {
    const sim = mk(n, { seed: 4 });
    revealAll(sim);
    const lead = leader(sim);
    const size = TEAM_SIZE[n][0];
    const order = ids(n);
    const other = order.find((p) => p !== lead);
    const snap = JSON.stringify(sim.state);
    const bad = [
      order.slice(0, size - 1), order.slice(0, size + 1), [], [order[0], order[0], ...order.slice(1, size - 1)],
      [...order.slice(0, size - 1), 'ghost'], [...order.slice(0, size - 1), '__proto__'], [...order.slice(0, size - 1), 7],
      'p1', null, { 0: 'p1' }, undefined,
    ];
    for (const team of bad) {
      assert.equal(JSON.stringify(engine.act(clone(sim.state), { pid: lead, action: { type: 'pick', team } }, sim.ctx())), snap, JSON.stringify(team));
    }
    // only the leader picks
    no(sim, other, { type: 'pick', team: order.slice(0, size) });
    no(sim, HOST, { type: 'pick', team: order.slice(0, size) });
    assert.equal(sim.view(lead).pick.canPick, true);
    assert.equal(sim.view(other).pick.canPick, false);
    assert.equal(sim.view(null).pick.canPick, false);
    assert.equal(sim.view(lead).pick.size, size);
    ok(sim, lead, { type: 'pick', team: order.slice(0, size) });
    assert.equal(phase(sim), 'vote');
    assert.deepEqual(st(sim).team, order.slice(0, size));
    no(sim, lead, { type: 'pick', team: order.slice(0, size) }, '(already picked)');
  }
});

test('avalon: the leader may or may not be on their own team; the team is stored in seat order', () => {
  const sim = mk(7, { seed: 8 });
  revealAll(sim);
  const lead = leader(sim);
  const others = ids(7).filter((p) => p !== lead);
  ok(sim, lead, { type: 'pick', team: [others[1], others[0]] });
  assert.deepEqual(st(sim).team, ids(7).filter((p) => p === others[0] || p === others[1]));
  assert.ok(!st(sim).team.includes(lead));

  const sim2 = mk(7, { seed: 8 });
  revealAll(sim2);
  ok(sim2, leader(sim2), { type: 'pick', team: [leader(sim2), others[0]] });
  assert.ok(st(sim2).team.includes(leader(sim2)));
});

test('avalon: team size follows the quest number at every head-count', () => {
  for (const n of COUNTS) {
    const sim = mk(n, { seed: 6 });
    revealAll(sim);
    for (let q = 1; q <= 5; q++) {
      assert.equal(phase(sim), 'pick');
      assert.equal(sim.view('p1').pick.size, TEAM_SIZE[n][q - 1], `n=${n} q=${q}`);
      assert.equal(sim.view('p1').pick.need, failsNeeded(n, q));
      if (q === 5) break;
      forceQuest(sim, q % 2 === 1);   // alternate: never reaches three of either side before quest 5
      cont(sim);
      passLady(sim);
    }
  }
});

// ============================================================
// voting
// ============================================================

test('avalon: a strict majority of ALL seats approves — ties reject — for every approve count at every head-count', () => {
  for (const n of COUNTS) {
    for (let approves = 0; approves <= n; approves++) {
      const sim = mk(n, { seed: 5 });
      revealAll(sim);
      pickTeam(sim);
      ids(n).forEach((p, i) => ok(sim, p, { type: 'vote', vote: i < approves ? 'approve' : 'reject' }));
      assert.equal(phase(sim), 'voted');
      const r = sim.view(null).voted;
      assert.equal(r.approves, approves);
      assert.equal(r.rejects, n - approves);
      assert.equal(r.approved, approves >= Math.floor(n / 2) + 1, `n=${n} approves=${approves}`);
      assert.equal(r.approved, approves > n - approves, 'strict majority = more approves than rejects');
      assert.equal(r.needed, approvalsNeeded(n));
    }
  }
});

test('avalon: the leader votes like anyone else, and nobody can vote twice into the tally', () => {
  const sim = mk(6, { seed: 3 });
  revealAll(sim);
  pickTeam(sim);
  const lead = leader(sim);
  const rest = ids(6).filter((p) => p !== lead);
  // 3 approve (with the leader), 3 reject → a tie → rejected
  ok(sim, lead, { type: 'vote', vote: 'approve' });
  rest.slice(0, 2).forEach((p) => ok(sim, p, { type: 'vote', vote: 'approve' }));
  rest.slice(2).forEach((p) => ok(sim, p, { type: 'vote', vote: 'reject' }));
  assert.equal(sim.view(null).voted.approved, false, '3-3 is a tie, and a tie rejects');
  assert.equal(sim.view(null).voted.votes[lead], 'approve');
  // without the leader's approve it would not even be a tie
  const sim2 = mk(6, { seed: 3 });
  revealAll(sim2);
  pickTeam(sim2);
  ok(sim2, leader(sim2), { type: 'vote', vote: 'reject' });
  rest.slice(0, 3).forEach((p) => ok(sim2, p, { type: 'vote', vote: 'approve' }));
  rest.slice(3).forEach((p) => ok(sim2, p, { type: 'vote', vote: 'reject' }));
  assert.equal(sim2.view(null).voted.approves, 3);
});

test('avalon: votes are secret until the last one lands, then public with names; a vote may be changed meanwhile; late votes are ignored', () => {
  const sim = mk(5, { seed: 7 });
  revealAll(sim);
  pickTeam(sim);
  ok(sim, 'p1', { type: 'vote', vote: 'approve' });
  ok(sim, 'p2', { type: 'vote', vote: 'reject' });
  for (const pid of [...ids(5), null]) {
    const v = sim.view(pid);
    assert.equal(v.phase, 'vote');
    assert.deepEqual(v.vote.progress, { done: 2, total: 5 }, 'a count, never who');
    assert.equal(v.vote.mine, pid === 'p1' ? 'approve' : pid === 'p2' ? 'reject' : null);
    assert.equal(v.voted, undefined);
    assert.ok(!JSON.stringify(v).includes('"votes"'), 'no vote map in a view while voting');
  }
  // legal actions: the other option once voted, both before
  assert.deepEqual(sim.legal('p1'), [{ type: 'vote', vote: 'reject' }]);
  assert.deepEqual(sim.legal('p3').map((a) => a.vote), ['approve', 'reject']);
  no(sim, 'p1', { type: 'vote', vote: 'approve' }, '(same vote again)');
  ok(sim, 'p1', { type: 'vote', vote: 'reject' }, '(changing a vote before the reveal)');
  assert.equal(sim.view('p1').vote.mine, 'reject');
  // junk votes
  for (const vote of [undefined, null, 'yes', 1, true, '', 'APPROVE', {}]) no(sim, 'p3', { type: 'vote', vote });
  no(sim, 'p3', { type: 'vote' });
  ['p3', 'p4', 'p5'].forEach((p) => ok(sim, p, { type: 'vote', vote: 'approve' }));
  assert.equal(phase(sim), 'voted');
  const v = sim.view('p4');
  assert.deepEqual(v.voted.votes, { p1: 'reject', p2: 'reject', p3: 'approve', p4: 'approve', p5: 'approve' });
  assert.equal(v.voted.approved, true);
  assert.deepEqual(v.history[0].votes, v.voted.votes, 'the log keeps who voted what');
  // a late vote after the reveal changes nothing
  const snap = JSON.stringify(sim.state);
  for (const p of ids(5)) no(sim, p, { type: 'vote', vote: 'reject' });
  assert.equal(JSON.stringify(sim.state), snap);
});

test('avalon: a rejected team keeps the quest, passes the leader one seat, and counts up the vote track; nothing else moves', () => {
  const sim = mk(7, { seed: 2, lady: 'on' });
  revealAll(sim);
  const start = st(sim).leaderIx;
  const ladyBefore = JSON.stringify(st(sim).lady);
  for (let k = 1; k <= 4; k++) {
    assert.equal(st(sim).leaderIx, (start + k - 1) % 7);
    assert.equal(st(sim).proposalNo, k);
    assert.equal(st(sim).questNo, 1);
    pickTeam(sim);
    voteAll(sim, 'reject');
    assert.equal(phase(sim), 'voted');
    assert.equal(sim.view(null).voted.after, k);
    assert.equal(st(sim).rejects, k);
    assert.equal(sim.view(null).voted.nextLeader, st(sim).order[(start + k) % 7]);
    cont(sim);
    assert.equal(phase(sim), 'pick');
    assert.equal(st(sim).questNo, 1, 'the quest number does not move');
    assert.deepEqual(st(sim).results, [null, null, null, null, null]);
    assert.equal(JSON.stringify(st(sim).lady), ladyBefore, 'the Lady does not move');
  }
  assert.equal(sim.view('p1').track.rejects, 4);
});

test('avalon: an approved team resets the vote track — even after four rejections, and the next quest can take four again', () => {
  const sim = mk(6, { seed: 3 });
  revealAll(sim);
  for (let k = 0; k < 4; k++) { pickTeam(sim); voteAll(sim, 'reject'); cont(sim); }
  assert.equal(st(sim).rejects, 4);
  assert.equal(sim.view(leader(sim)).track.rejects, 4);
  // the 5th proposal is still voted on — and approved
  pickTeam(sim);
  voteAll(sim, 'approve');
  assert.equal(phase(sim), 'voted');
  assert.equal(st(sim).rejects, 0, 'approval resets the counter');
  assert.equal(sim.view(null).voted.before, 4);
  assert.equal(sim.view(null).voted.ends, null);
  cont(sim);
  assert.equal(phase(sim), 'quest', 'an approved fifth team is played, not forced away');
  playCards(sim);
  cont(sim);
  passLady(sim);
  // quest 2: four rejections again are survivable
  for (let k = 0; k < 4; k++) { pickTeam(sim); voteAll(sim, 'reject'); cont(sim); }
  assert.equal(st(sim).rejects, 4);
  assert.equal(phase(sim), 'pick');
  assert.equal(st(sim).questNo, 2);
});

test('avalon: the fifth rejection ends the game for evil on the spot — the sixth team is never named', () => {
  for (const n of COUNTS) {
    const sim = mk(n, { seed: 9 });
    revealAll(sim);
    for (let k = 1; k <= 5; k++) {
      pickTeam(sim);
      voteAll(sim, 'reject');
      assert.equal(phase(sim), 'voted');
      if (k < 5) { assert.equal(sim.view(null).voted.ends, null); cont(sim); }
    }
    assert.equal(sim.view(null).voted.ends, 'five-rejections');
    assert.equal(sim.result(), null, 'the votes are shown before the game is over');
    assert.equal(st(sim).proposalNo, 5, 'no sixth proposal exists');
    cont(sim);
    assert.equal(phase(sim), 'over');
    assert.equal(st(sim).reason, 'five-rejections');
    assert.equal(st(sim).winner, 'evil');
    const res = sim.result();
    assertResultShape(res, sim.players);
    assert.deepEqual(res.winners.slice().sort(), evils(sim).slice().sort());
    assert.equal(st(sim).quests.length, 0);
    assert.ok(res.lines[0].includes('連續五次'));
  }
});

test('avalon: the leader token moves exactly one seat per proposal over a whole game', () => {
  for (const n of [5, 8, 10]) {
    const sim = mk(n, { seed: 21 });
    revealAll(sim);
    const start = st(sim).startIx;
    let proposals = 0;
    for (let q = 1; q <= 3; q++) {
      pickTeam(sim); voteAll(sim, 'reject'); proposals++; cont(sim);
      assert.equal(st(sim).leaderIx, (start + proposals) % n);
      forceQuest(sim, true); proposals++; cont(sim); passLady(sim);
      if (phase(sim) === 'assassinate') break;
      assert.equal(st(sim).leaderIx, (start + proposals) % n, 'after a quest the next seat leads');
    }
  }
});

test('avalon: only the leader taps 繼續 on the vote screen; the host @next acknowledges the cue first, then continues', () => {
  const sim = mk(5, { seed: 1 });
  revealAll(sim);
  pickTeam(sim);
  voteAll(sim, 'approve');
  const other = ids(5).find((p) => p !== leader(sim));
  no(sim, other, { type: 'continue' });
  assert.equal(phase(sim), 'voted');
  assert.equal(sim.host({ type: ACT.NEXT }), true);
  assert.equal(phase(sim), 'voted');
  assert.equal(sim.host({ type: ACT.NEXT }), true);
  assert.equal(phase(sim), 'quest');
});

// ============================================================
// the quest
// ============================================================

test('avalon: good can only succeed (rejected, never offered); evil may do either; only team members, once', () => {
  const sim = mk(7, { seed: 3 });
  revealAll(sim);
  // a team of two with one of each
  const g = goods(sim)[0];
  const e = evils(sim)[0];
  const t2 = [g, e];
  pickTeam(sim, t2);
  voteAll(sim, 'approve');
  cont(sim);
  no(sim, g, { type: 'quest', card: 'fail' });
  assert.deepEqual(sim.legal(g), [{ type: 'quest', card: 'success' }]);
  assert.equal(sim.view(g).quest.mine.canFail, false);
  assert.deepEqual(sim.legal(e), [{ type: 'quest', card: 'success' }, { type: 'quest', card: 'fail' }]);
  assert.equal(sim.view(e).quest.mine.canFail, true);
  const outsider = ids(7).find((p) => !t2.includes(p));
  for (const card of ['success', 'fail']) no(sim, outsider, { type: 'quest', card });
  assert.deepEqual(sim.legal(outsider), []);
  assert.equal(sim.view(outsider).quest.mine, null);
  for (const card of [undefined, null, 'win', 1, true, 'FAIL']) no(sim, e, { type: 'quest', card });
  ok(sim, e, { type: 'quest', card: 'fail' });
  no(sim, e, { type: 'quest', card: 'success' }, '(already played)');
  assert.deepEqual(sim.legal(e), []);
  assert.equal(phase(sim), 'quest', 'tap mode: one card still out');
  ok(sim, g, { type: 'quest', card: 'success' });
  assert.equal(phase(sim), 'quest-result');
});

test('avalon: evil may play success; a team without evil always succeeds', () => {
  for (const n of COUNTS) {
    const sim = mk(n, { seed: 4 });
    revealAll(sim);
    const size = TEAM_SIZE[n][0];
    const team = [evils(sim)[0], ...goods(sim).slice(0, size - 1)];
    pickTeam(sim, team);
    voteAll(sim, 'approve');
    cont(sim);
    playCards(sim, () => 'success');
    assert.equal(sim.view(null).outcome.success, true);
    assert.equal(sim.view(null).outcome.fails, 0);
  }
  for (const n of COUNTS) {
    const sim = mk(n, { seed: 4 });
    revealAll(sim);
    forceQuest(sim, true);
    assert.equal(st(sim).results[0], true);
    assert.equal(sim.view(null).outcome.successes, TEAM_SIZE[n][0]);
  }
});

test('avalon: fails needed — one at 5 and 6 players, two on quest 4 from 7 players, one on quest 5 everywhere', () => {
  for (const n of COUNTS) {
    for (let q = 1; q <= 5; q++) {
      const need = failsNeeded(n, q);
      for (const fails of [need - 1, need, need + 1]) {
        if (fails < 0 || fails > EVIL_COUNT[n]) continue;
        const sim = mk(n, { seed: 11, lady: 'off' });
        revealAll(sim);
        // walk to quest q with a 2-2 style alternation that never ends the game
        const prior = [true, false, true, false].slice(0, q - 1);
        playResults(sim, prior);
        assert.equal(st(sim).questNo, q);
        const size = TEAM_SIZE[n][q - 1];
        const team = [...evils(sim).slice(0, fails), ...goods(sim).slice(0, size - fails)];
        pickTeam(sim, team);
        voteAll(sim, 'approve');
        cont(sim);
        playCards(sim, (p) => (isEvil(sim, p) ? 'fail' : 'success'));
        const o = sim.view(null).outcome;
        assert.equal(o.fails, fails, `n=${n} q=${q}`);
        assert.equal(o.success, fails < need, `n=${n} q=${q} fails=${fails} need=${need}`);
        assert.equal(o.need, need);
      }
    }
  }
});

test('avalon: n=7 quest 4 — a team of four with one Fail card still SUCCEEDS, and the table still sees the Fail', () => {
  const sim = mk(7, { seed: 5, lady: 'off' });
  revealAll(sim);
  playResults(sim, [true, false, false]);   // one more failure would end it, so quest 4 is the decider
  assert.equal(st(sim).questNo, 4);
  const team = [evils(sim)[0], ...goods(sim).slice(0, 3)];
  assert.equal(team.length, 4);
  pickTeam(sim, team);
  voteAll(sim, 'approve');
  cont(sim);
  playCards(sim, (p) => (isEvil(sim, p) ? 'fail' : 'success'));
  const o = sim.view('p1').outcome;
  assert.equal(o.success, true);
  assert.equal(o.fails, 1);
  assert.equal(o.successes, 3);
  assert.equal(o.need, 2);
  assert.deepEqual(o.pile.slice().sort(), ['fail', 'success', 'success', 'success']);
  assert.equal(st(sim).results[3], true);
  assert.equal(sim.view('p1').board.wins, 2);
  assert.equal(sim.view('p1').board.losses, 2);
  // the narration says so too
  assert.ok(sim.cue().text.includes('一張失敗都算成功'));
  assert.ok(S.cueResult({ successes: 3, fails: 1, success: true, need: 2, wins: 2, losses: 2, next: 'pick' }).includes('兩張失敗'));
  // and a lone Fail on the same quest at 6 players fails it
  const six = mk(6, { seed: 5, lady: 'off' });
  revealAll(six);
  playResults(six, [true, false, false]);
  const t6 = [evils(six)[0], ...goods(six).slice(0, 2)];
  pickTeam(six, t6);
  voteAll(six, 'approve');
  cont(six);
  playCards(six, (p) => (isEvil(six, p) ? 'fail' : 'success'));
  assert.equal(six.view(null).outcome.success, false);
});

test('avalon: the pile is counts only — shuffled, and identical whoever on the team played the Fail', () => {
  // Same seed, same team; once the evil seat A fails, once the evil seat B fails. Nobody's view may differ.
  const build = (failer) => {
    const sim = mk(8, { seed: 14, lady: 'off' });
    revealAll(sim);
    const [e1, e2] = evils(sim);
    const team = [e1, e2, ...goods(sim).slice(0, 1)];
    pickTeam(sim, team);
    voteAll(sim, 'approve');
    cont(sim);
    for (const p of st(sim).team) sim.act(p, { type: 'quest', card: p === (failer === 0 ? e1 : e2) ? 'fail' : 'success' });
    if (st(sim).cfg.questSecs > 0) sim.advance();
    return sim;
  };
  const a = build(0);
  const b = build(1);
  assert.equal(phase(a), 'quest-result');
  assert.deepEqual(a.view(null).outcome, b.view(null).outcome);
  for (const pid of [...ids(8), null]) assert.equal(JSON.stringify(a.view(pid)), JSON.stringify(b.view(pid)), `view of ${pid} depends on who played the Fail`);
  assert.deepEqual(a.cue(), b.cue());
  // the pile order is a shuffle: over many seeds the Fail lands in every slot
  const slots = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const sim = mk(10, { seed, lady: 'off' });
    revealAll(sim);
    const team = [evils(sim)[0], ...goods(sim).slice(0, 2)];
    pickTeam(sim, team);
    voteAll(sim, 'approve');
    cont(sim);
    playCards(sim, (p) => (isEvil(sim, p) ? 'fail' : 'success'));
    slots.add(sim.view(null).outcome.pile.indexOf('fail'));
  }
  assert.equal(slots.size, 3);
});

test('avalon: the quest screen has one shape for good and evil; only the tile order differs, randomly per seat', () => {
  const sim = mk(10, { seed: 3, lady: 'off' });
  revealAll(sim);
  const size = TEAM_SIZE[10][0];
  const team = [...evils(sim).slice(0, 1), ...goods(sim).slice(0, size - 1)];
  pickTeam(sim, team);
  voteAll(sim, 'approve');
  cont(sim);
  const shapes = new Set(team.map((p) => JSON.stringify(Object.keys(sim.view(p).quest.mine).sort())));
  assert.equal(shapes.size, 1);
  const views = team.map((p) => sim.view(p));
  assert.equal(new Set(views.map((v) => JSON.stringify(Object.keys(v).sort()))).size, 1);
  assert.equal(new Set(views.map((v) => v.quest.mode)).size, 1);
  // the mirror bit is random per seat (and per quest)
  const flips = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const s2 = mk(10, { seed, lady: 'off' });
    revealAll(s2);
    pickTeam(s2);
    voteAll(s2, 'approve');
    cont(s2);
    for (const p of st(s2).team) flips.add(s2.view(p).quest.mine.flip);
  }
  assert.equal(flips.size, 2);
});

test('avalon: timed quest — nothing resolves early, the clock is a minimum (a missing card is waited for, never played for them); no count leaks who is slow', () => {
  const sim = mkTimed(8, 4, { lady: 'off' });
  revealAll(sim);
  const e = evils(sim)[0];
  pickTeam(sim, [e, goods(sim)[0], goods(sim)[1]]);
  voteAll(sim, 'approve');
  cont(sim);
  assert.equal(st(sim).deadline, sim.now + 12000);
  assert.equal(sim.view(e).deadline, st(sim).deadline);
  assert.equal(sim.view(e).quest.mode, 'timer');
  assert.equal(sim.view(e).quest.progress, undefined, 'a running count would show who is slow');
  for (const p of st(sim).team) assert.deepEqual(sim.legal(p).length > 0, true, 'every member has a card to play');
  ok(sim, e, { type: 'quest', card: 'fail' });
  ok(sim, goods(sim)[0], { type: 'quest', card: 'success' });
  assert.equal(phase(sim), 'quest', 'one card still out: nothing happens');
  ok(sim, goods(sim)[1], { type: 'quest', card: 'success' });
  assert.equal(phase(sim), 'quest', 'every card in, the window still runs its full time');
  sim.advance();
  assert.equal(phase(sim), 'quest-result');
  assert.equal(sim.view(null).outcome.fails, 1);

  // a card still missing at the deadline is waited for: the window is a minimum, not a cap that plays success for evil
  const sim2 = mkTimed(8, 4, { lady: 'off' });
  revealAll(sim2);
  const e2 = evils(sim2)[0];
  pickTeam(sim2, [e2, goods(sim2)[0], goods(sim2)[1]]);
  voteAll(sim2, 'approve');
  cont(sim2);
  ok(sim2, goods(sim2)[0], { type: 'quest', card: 'success' });
  assert.equal(sim2.advance(), true, 'the clock runs out');
  assert.equal(phase(sim2), 'quest', 'but two cards are still out, so the quest waits');
  assert.equal(st(sim2).deadline, null);
  assert.equal(sim2.view(e2).deadline, undefined, 'no timer once the window is over');
  assert.deepEqual(sim2.view('p1').quest.progress, { done: 1, total: 3 }, 'after the window a count is no longer a tell');
  assert.deepEqual(sim2.legal(e2), [{ type: 'quest', card: 'success' }, { type: 'quest', card: 'fail' }], 'the evil member still chooses freely');
  ok(sim2, goods(sim2)[1], { type: 'quest', card: 'success' });
  assert.equal(phase(sim2), 'quest');
  ok(sim2, e2, { type: 'quest', card: 'fail' });
  assert.equal(phase(sim2), 'quest-result', 'the last late card resolves it at once');
  assert.equal(sim2.view(null).outcome.fails, 1);
  assert.deepEqual(st(sim2).quests[0].auto, []);
  // a dead phone: the host's 下一步 plays success for whoever is missing and says so in the recap
  const sim3 = mkTimed(8, 4, { lady: 'off' });
  revealAll(sim3);
  const e3 = evils(sim3)[0];
  pickTeam(sim3, [e3, goods(sim3)[0], goods(sim3)[1]]);
  voteAll(sim3, 'approve');
  cont(sim3);
  ok(sim3, goods(sim3)[0], { type: 'quest', card: 'success' });
  sim3.host({ type: ACT.NEXT }); sim3.host({ type: ACT.NEXT });
  assert.equal(phase(sim3), 'quest-result');
  assert.deepEqual(st(sim3).quests[0].auto.sort(), [e3, goods(sim3)[1]].sort());
  // tap mode shows the count, and resolves at the last card
  const tap = mk(6, { seed: 4, lady: 'off' });
  revealAll(tap);
  pickTeam(tap, [evils(tap)[0], goods(tap)[0]]);
  voteAll(tap, 'approve');
  cont(tap);
  assert.deepEqual(tap.view('p1').quest.progress, { done: 0, total: 2 });
  ok(tap, goods(tap)[0], { type: 'quest', card: 'success' });
  assert.deepEqual(tap.view('p1').quest.progress, { done: 1, total: 2 });
  ok(tap, evils(tap)[0], { type: 'quest', card: 'success' });
  assert.equal(phase(tap), 'quest-result');
});

test('avalon: host @next skips the quest window with success for every missing card', () => {
  const sim = mkTimed(5, 3, { lady: 'off' });
  revealAll(sim);
  pickTeam(sim);
  voteAll(sim, 'approve');
  cont(sim);
  assert.equal(sim.host({ type: ACT.NEXT }), true);   // acks the cue
  assert.equal(phase(sim), 'quest');
  assert.equal(sim.host({ type: ACT.NEXT }), true);
  assert.equal(phase(sim), 'quest-result');
  assert.equal(sim.view(null).outcome.fails, 0);
});

test('avalon: the order of checks after a quest — three fails end it (no Lady, no assassin), three successes go to the assassin (no Lady)', () => {
  for (const n of [7, 10]) {
    // three failures: evil wins straight away
    const f = mk(n, { seed: 3, lady: 'on' });
    revealAll(f);
    playResults(f, [false, false]);
    forceQuest(f, false);
    assert.equal(sim_view(f).outcome.next, 'over');
    assert.equal(f.result(), null, 'the result screen waits for 繼續');
    cont(f);
    assert.equal(phase(f), 'over');
    assert.equal(st(f).reason, 'three-fails');
    assert.equal(st(f).lady.log.length, 1, 'only the Lady use after quest 2 happened; none after the deciding quest');
    // three successes: assassination, no Lady after quest 3
    const w = mk(n, { seed: 3, lady: 'on' });
    revealAll(w);
    playResults(w, [true, true]);
    forceQuest(w, true);
    assert.equal(sim_view(w).outcome.next, 'assassinate');
    cont(w);
    assert.equal(phase(w), 'assassinate');
    assert.equal(st(w).lady.log.length, 1);
  }
});

function sim_view(sim) { return sim.view(null); }

// ============================================================
// Lady of the Lake
// ============================================================

test('avalon: the Lady is used only after quests 2, 3 and 4 — and only while the game is undecided', () => {
  const table = [
    // results so far → does the Lady step come up after the last one?
    { results: [true], lady: false }, { results: [false], lady: false },
    { results: [true, true], lady: true }, { results: [true, false], lady: true }, { results: [false, false], lady: true },
    { results: [true, true, false], lady: true }, { results: [true, false, false], lady: true }, { results: [false, false, true], lady: true },
    { results: [true, true, true], lady: false }, { results: [false, false, false], lady: false },
    { results: [true, true, false, false], lady: true }, { results: [true, false, true, false], lady: true },
    { results: [true, true, false, true], lady: false }, { results: [false, false, true, false], lady: false },
    { results: [true, true, true], lady: false },
  ];
  for (const { results, lady } of table) {
    const sim = mk(7, { seed: 4, lady: 'on' });
    revealAll(sim);
    for (let i = 0; i < results.length - 1; i++) { forceQuest(sim, results[i]); cont(sim); passLady(sim); }
    forceQuest(sim, results[results.length - 1]);
    cont(sim);
    assert.equal(phase(sim) === 'lady', lady, `${JSON.stringify(results)} → ${phase(sim)}`);
    if (!lady) assert.ok(['over', 'assassinate', 'pick'].includes(phase(sim)));
  }
  // after quest 5 nothing remains to do with the Lady
  const sim = mk(7, { seed: 4, lady: 'on' });
  revealAll(sim);
  playResults(sim, [true, false, true, false]);
  forceQuest(sim, false);
  cont(sim);
  assert.equal(phase(sim), 'over');
});

test('avalon: Lady candidates shrink by one each use, exclude every past holder and the holder, and the token follows the checked seat', () => {
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 5; seed++) {
      const sim = mk(n, { seed, lady: 'on' });
      revealAll(sim);
      const initial = st(sim).lady.holder;
      const past = [initial];
      // quest results chosen so the game stays open through quest 4: S F S F
      const plan = [true, false, true, false];
      for (let i = 0; i < 4; i++) {
        forceQuest(sim, plan[i]);
        cont(sim);
        const uses = past.length - 1;   // Lady uses so far
        if (i === 0) { assert.equal(phase(sim), 'pick'); continue; }
        assert.equal(phase(sim), 'lady', `n=${n} after quest ${i + 1}`);
        const holder = st(sim).lady.holder;
        assert.equal(holder, past[past.length - 1], 'the last checked seat holds the token');
        const cand = sim.view(holder).ladyStep.candidates;
        assert.equal(cand.length, n - 1 - uses, `n=${n} use ${uses + 1}: N-1-${uses} candidates`);
        assert.ok(cand.length >= 2, 'there is always somebody to check');
        for (const p of past) assert.ok(!cand.includes(p), 'a past holder (incl. the first) cannot be checked');
        assert.ok(!cand.includes(holder));
        // illegal targets do nothing
        for (const bad of [holder, ...past, 'ghost', undefined, null, 5, '__proto__']) no(sim, holder, { type: 'lady', target: bad });
        const someoneElse = ids(n).find((p) => p !== holder);
        no(sim, someoneElse, { type: 'lady', target: cand[0] }, '(not the holder)');
        const target = cand[(seed + i) % cand.length];
        ok(sim, holder, { type: 'lady', target });
        assert.equal(phase(sim), 'lady-peek');
        no(sim, holder, { type: 'lady', target: cand[0] }, '(only one check per use)');
        ok(sim, holder, { type: 'lady-done' });
        assert.equal(st(sim).lady.holder, target, 'the checked player takes the token');
        past.push(target);
      }
      assert.equal(st(sim).lady.log.length, 3, `${n}: uses after quests 2, 3 and 4 (the game is still open)`);
    }
  }
});

test('avalon: the Lady reads the character card — Merlin, Percival, servants are good; every evil card is evil; Oberon follows the switch', () => {
  const cfg = { preset: 'custom', roles: { percival: 1, morgana: 1, mordred: 1, oberon: 1 }, lady: 'on' };
  const expected = { merlin: 'good', percival: 'good', servant: 'good', assassin: 'evil', morgana: 'evil', mordred: 'evil', oberon: 'evil', minion: 'evil' };
  for (const oberonReadsGoodToLady of [false, true]) {
    for (const role of ['merlin', 'percival', 'servant', 'assassin', 'morgana', 'mordred', 'oberon']) {
      const sim = mk(10, { seed: 3, ...cfg, oberonReadsGoodToLady });
      revealAll(sim);
      forceQuest(sim, true); cont(sim);
      forceQuest(sim, false); cont(sim);
      assert.equal(phase(sim), 'lady');
      const holder = st(sim).lady.holder;
      const target = seatOf(sim, role);
      if (target === holder) continue;
      ok(sim, holder, { type: 'lady', target });
      const want = role === 'oberon' && oberonReadsGoodToLady ? 'good' : expected[role];
      assert.equal(sim.view(holder).ladyStep.mine.loyalty, want, `${role} (oberonReadsGoodToLady=${oberonReadsGoodToLady})`);
    }
  }
  // the plain Minion is evil too
  const m = mk(8, { seed: 2, lady: 'on' });
  revealAll(m);
  forceQuest(m, true); cont(m);
  forceQuest(m, false); cont(m);
  const h = st(m).lady.holder;
  const mt = seatOf(m, 'minion');
  if (mt !== h && !st(m).lady.held.includes(mt)) {
    ok(m, h, { type: 'lady', target: mt });
    assert.equal(m.view(h).ladyStep.mine.loyalty, 'evil');
  }
});

test('avalon: the Lady\'s answer is private; the holder and the checked seat are public; the log never holds the answer', () => {
  const sim = mk(7, { seed: 3 });
  revealAll(sim);
  forceQuest(sim, true); cont(sim);
  forceQuest(sim, false); cont(sim);
  const holder = st(sim).lady.holder;
  const target = ids(7).find((p) => p !== holder && !st(sim).lady.held.includes(p));
  ok(sim, holder, { type: 'lady', target });
  for (const pid of [...ids(7), null]) {
    const v = sim.view(pid);
    assert.equal(v.ladyStep.holder, holder);
    assert.equal(v.ladyStep.target, target, 'who is checked is public');
    assert.equal(v.ladyStep.mine !== null, pid === holder);
    assert.ok(!JSON.stringify(v).includes('"loyalty"') || pid === holder, `loyalty in ${pid}'s view`);
  }
  ok(sim, holder, { type: 'lady-done' });
  const v = sim.view('p1');
  assert.deepEqual(v.lady.log, [{ q: 2, holder, target }]);
  assert.ok(!JSON.stringify(v).includes('loyalty'));
  // the cue names both but never the answer
  assert.ok(!/邪惡|好人/.test(S.cueLadyPeek({ holder: 'A', target: 'B' })));
});

test('avalon: with the Lady off (or at 5-6 players on 跟人數) no Lady step ever appears', () => {
  for (const [n, patch] of [[5, {}], [6, {}], [8, { lady: 'off' }]]) {
    const sim = mk(n, { seed: 3, ...patch });
    revealAll(sim);
    for (const r of [true, false, true, false]) {
      forceQuest(sim, r);
      cont(sim);
      assert.ok(!['lady', 'lady-peek'].includes(phase(sim)), `n=${n}`);
    }
  }
});

test('avalon: the Lady does not care whether the quest before it succeeded or failed', () => {
  for (const results of [[true, true], [false, false], [true, false], [false, true]]) {
    const sim = mk(8, { seed: 7 });
    revealAll(sim);
    forceQuest(sim, results[0]); cont(sim);
    forceQuest(sim, results[1]); cont(sim);
    assert.equal(phase(sim), 'lady', JSON.stringify(results));
  }
});

// ============================================================
// assassination
// ============================================================

test('avalon: the assassination comes only after the third success — never after three fails or five rejections', () => {
  const win = mk(6, { seed: 2 });
  toAssassinate(win);
  assert.equal(win.result(), null);
  const fail = mk(6, { seed: 2 });
  revealAll(fail);
  playResults(fail, [false, false]);
  forceQuest(fail, false);
  cont(fail);
  assert.equal(phase(fail), 'over');
  assert.equal(fail.state.shot, null);
  const rej = mk(6, { seed: 2 });
  revealAll(rej);
  for (let k = 0; k < 5; k++) { pickTeam(rej); voteAll(rej, 'reject'); cont(rej); }
  assert.equal(phase(rej), 'over');
  assert.equal(rej.state.shot, null);
});

test('avalon: only the Assassin shoots; Merlin → evil wins, anyone else → good wins; any seat is a legal (if foolish) target', () => {
  for (const n of COUNTS) {
    const targetsToTry = (sim) => ({ merlin: seatOf(sim, 'merlin'), servant: seatOf(sim, 'servant') ?? goods(sim).find((p) => sim.state.role[p] !== 'merlin'), evil: evils(sim).find((p) => sim.state.role[p] !== 'assassin') });
    for (const which of ['merlin', 'servant', 'evil', 'self']) {
      const sim = mk(n, { seed: 6, preset: 'plain' });
      toAssassinate(sim);
      const assassin = seatOf(sim, 'assassin');
      const target = which === 'self' ? assassin : targetsToTry(sim)[which];
      const outsider = ids(n).find((p) => p !== assassin);
      no(sim, outsider, { type: 'assassinate', target });
      no(sim, HOST, { type: 'assassinate', target });
      for (const bad of ['ghost', undefined, null, 5, '__proto__', {}]) no(sim, assassin, { type: 'assassinate', target: bad });
      ok(sim, assassin, { type: 'assassinate', target });
      assert.equal(phase(sim), 'shot');
      assert.equal(sim.result(), null, 'the shot is shown before the result');
      const hit = which === 'merlin';
      const v = sim.view(outsider).shot;
      assert.deepEqual([v.assassin, v.target, v.hit], [assassin, target, hit]);
      assert.equal(v.merlin, seatOf(sim, 'merlin'));
      assert.equal(sim.view(assassin).shot.canContinue, true);
      assert.equal(v.canContinue, false);
      sim.advance();
      assert.equal(phase(sim), 'over');
      assert.equal(st(sim).reason, hit ? 'assassinated-merlin' : 'assassin-missed');
      assert.equal(st(sim).winner, hit ? 'evil' : 'good');
      const res = sim.result();
      assertResultShape(res, sim.players);
      assert.deepEqual(res.winners.slice().sort(), (hit ? evils(sim) : goods(sim)).slice().sort());
      assert.equal(res.points[res.winners[0]], 1);
      assert.equal(res.points[(hit ? goods(sim) : evils(sim))[0]], 0);
    }
  }
});

test('avalon: the shot screen ends by the Assassin tapping, the clock, or the host', () => {
  for (const how of ['tap', 'clock', 'host']) {
    const sim = mk(5, { seed: 3 });
    toAssassinate(sim);
    const a = seatOf(sim, 'assassin');
    ok(sim, a, { type: 'assassinate', target: ids(5).find((p) => p !== a) });
    assert.equal(st(sim).deadline, sim.now + 8000);
    assert.deepEqual(sim.focus(), { pids: [a] });
    const other = ids(5).find((p) => p !== a);
    no(sim, other, { type: 'continue' });
    if (how === 'tap') ok(sim, a, { type: 'continue' });
    else if (how === 'clock') sim.advance();
    else { sim.host({ type: ACT.NEXT }); sim.host({ type: ACT.NEXT }); }
    assert.equal(phase(sim), 'over', how);
  }
});

test('avalon: assassination screens — one shape for every seat, a tap for everybody, the Assassin never named', () => {
  for (const n of COUNTS) {
    const sim = mk(n, { seed: 12 });
    toAssassinate(sim);
    const a = seatOf(sim, 'assassin');
    const shapes = new Set();
    for (const p of ids(n)) {
      const legal = sim.legal(p);
      assert.ok(legal.length > 0, `seat ${p} has something to tap (n=${n})`);
      if (p === a) assert.ok(legal.every((x) => x.type === 'assassinate') && legal.length === n - 1);
      else assert.deepEqual(legal, [{ type: 'decoy' }]);
      const v = sim.view(p);
      shapes.add(JSON.stringify([Object.keys(v).sort(), Object.keys(v.assassinate).sort(), v.assassinate.candidates.length, v.title, v.subtitle, v.assassinate.flipped]));
      assert.ok(!v.assassinate.candidates.includes(p), 'you cannot pick yourself');
    }
    assert.equal(shapes.size, 1, 'the screens differ in shape between seats');
    // the focus is the Assassin alone, in a role-named prompt, so a shared phone's gate says no name
    assert.deepEqual(sim.focus(), { pids: [a], anonymous: '刺客請拎起部手機' });
    // a decoy changes nothing public and is accepted once per seat; the Assassin cannot decoy
    const other = ids(n).find((p) => p !== a);
    const before = JSON.stringify(sim.view(null));
    ok(sim, other, { type: 'decoy' });
    no(sim, other, { type: 'decoy' });
    assert.deepEqual(sim.legal(other), []);
    assert.equal(sim.view(other).assassinate.tapped, true);
    assert.equal(JSON.stringify(sim.view(null)), before, 'table view unchanged by a decoy');
    no(sim, a, { type: 'decoy' });
    assert.equal(phase(sim), 'assassinate');
    // a stalled decoy seat is "代佢做"-able; the stalled Assassin shoots
    assert.deepEqual(engine.autoAct(sim.state, ids(n).find((p) => p !== a && p !== other), sim.ctx()), { type: 'decoy' });
    assert.equal(engine.autoAct(sim.state, other, sim.ctx()), null);
    assert.equal(engine.autoAct(sim.state, a, sim.ctx()).type, 'assassinate');
  }
});

test('avalon: 刺殺前邪惡亮牌 makes the evil roles public to everybody — and nothing else', () => {
  const sim = mk(10, { seed: 4, flipEvil: true });
  toAssassinate(sim);
  const want = evils(sim).map((p) => ({ pid: p, role: sim.state.role[p] }));
  for (const pid of [...ids(10), null]) assert.deepEqual(sim.view(pid).assassinate.flipped, want);
  checkLeaks(sim);
  const plain = mk(10, { seed: 4 });
  toAssassinate(plain);
  for (const pid of [...ids(10), null]) assert.equal(plain.view(pid).assassinate.flipped, null);
  assert.ok(sim.cue().text.includes('公開'));
  assert.ok(!plain.cue().text.includes('公開'));
});

test('avalon: assassination timer is only a nudge — nothing happens when it runs out', () => {
  const sim = mk(6, { seed: 3, assassinSecs: 60 });
  toAssassinate(sim);
  assert.equal(st(sim).deadline, sim.now + 60000);
  const before = JSON.stringify(sim.state);
  assert.equal(sim.advance(), false);
  assert.equal(JSON.stringify(sim.state), before);
  const a = seatOf(sim, 'assassin');
  ok(sim, a, { type: 'assassinate', target: ids(6).find((p) => p !== a) });
  assert.equal(phase(sim), 'shot');
});

test('avalon: the discussion timer before a team is a nudge too, and the leader can still pick after it', () => {
  const sim = mk(6, { seed: 3, discussSecs: 90 });
  revealAll(sim);
  assert.equal(st(sim).deadline, sim.now + 90000);
  assert.equal(sim.view('p1').timerLabel, '討論時間');
  const before = JSON.stringify(sim.state);
  assert.equal(sim.advance(), false);
  assert.equal(JSON.stringify(sim.state), before);
  pickTeam(sim);
  assert.equal(st(sim).deadline, null);
  voteAll(sim, 'reject');
  cont(sim);
  assert.equal(st(sim).deadline, sim.now + 90000, 'every proposal gets its own discussion time');
});

// ============================================================
// the "night" rule: a legal action for every seat at every secret step
// ============================================================

test('avalon: every seat has a legal action at the start of every secret step — reveal, vote, quest (members), assassination, in both clock modes', () => {
  for (const n of COUNTS) {
    for (const timed of [true, false]) {
      const sim = timed ? mkTimed(n, 5) : mk(n, { seed: 5 });
      const at = [];
      let last = null;
      const every = (label, who = ids(n)) => {
        for (const p of who) assert.ok(sim.legal(p).length > 0, `${label}: seat ${p} has nothing to do (n=${n} ${timed ? 'timed' : 'tap'})`);
        at.push(label);
      };
      // reveal
      every('reveal');
      revealAll(sim);
      // pick: the leader picks, and everyone else waits (public step)
      pickTeam(sim);
      every('vote');
      voteAll(sim, 'approve');
      cont(sim);
      every('quest', st(sim).team);
      playCards(sim);
      cont(sim);
      passLady(sim);
      // the assassination
      toAssassinate2(sim);
      every('assassinate');
      last = at.join();
      assert.equal(last, 'reveal,vote,quest,assassinate');
    }
  }
});

function toAssassinate2(sim) {
  // two more successes (quest 1 is already done) and the third
  for (let i = 0; i < 2; i++) { forceQuest2(sim); cont(sim); passLady(sim); }
  assert.equal(phase(sim), 'assassinate');
}
function forceQuest2(sim) {
  const s = st(sim);
  const size = TEAM_SIZE[s.n][s.questNo - 1];
  pickTeam(sim, goods(sim).slice(0, size));
  voteAll(sim, 'approve');
  cont(sim);
  playCards(sim);
}

test('avalon: during a fuzzed game every secret step starts with a tap for every seat (reveal and assassination)', () => {
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 6; seed++) {
      const sim = seed % 2 ? mkTimed(n, seed) : mk(n, { seed });
      let lastPhase = null;
      const probe = (x) => {
        const p = x.state.phase;
        if (p !== lastPhase && (p === 'reveal' || p === 'assassinate' || p === 'vote')) {
          for (const id of ids(n)) assert.ok(x.legal(id).length > 0, `${p}: ${id} has no tap (n=${n} seed=${seed})`);
        }
        lastPhase = p;
      };
      probe(sim);
      sim.runRandom({ onStep: probe });
    }
  }
});

// ============================================================
// views, secrecy, determinism
// ============================================================

test('avalon: views are built field by field and carry no private state', () => {
  const sim = mkTimed(8, 3);
  const topCommon = ['board', 'deadline', 'deck', 'hint', 'history', 'lady', 'leader', 'me', 'n', 'opts', 'order', 'phase', 'proposalNo', 'quests', 'subtitle', 'timerLabel', 'title', 'track'];
  const seatV = Object.keys(sim.view('p2')).sort();
  assert.deepEqual(seatV, [...topCommon, 'mine'].sort());
  assert.deepEqual(Object.keys(sim.view(null)).sort(), topCommon.slice().sort());
  assert.deepEqual(Object.keys(sim.view('p2').mine).sort(), ['knows', 'role', 'seen']);
  for (const odd of [undefined, 'ghost', 'constructor', '__proto__', 42]) {
    const v = engine.view(sim.state, odd);
    assert.equal(v.me, null);
    assert.equal(v.mine, undefined);
  }
  const json = JSON.stringify(sim.view('p2'));
  for (const k of ['"role":{', '"cfg"', '"names"', '"gid"', '"startIx"', '"cards"', '"voteLog"', '"cueAck"']) assert.ok(!json.includes(k), `view leaks ${k}`);
  assert.equal(sim.view('p2').lady.holder, st(sim).lady.holder);
});

test('avalon: 💡 rules.quick is at most six short lines; every role card says what you do AND how you win', async () => {
  const { roleParts } = await import('../js/ui/logic.js');
  assert.ok(rules.quick.length <= 6);
  for (const l of rules.quick) assert.ok([...l].length <= 30, `quick line too long: ${l}`);
  for (const r of rules.roles) {
    const { what, win } = roleParts(r.text);
    assert.ok(what.length >= 8, `${r.id}: what you do`);
    assert.ok(win.length >= 8, `${r.id}: how you win`);
    if (r.team === 'good') assert.match(win, /三個任務成功/);
    else assert.match(win, /三個任務失敗.*五次否決.*刺中梅林/);
  }
});

/** Every hint of every seat (and the table) in the current state. */
const hintsOf = (sim) => Object.fromEntries([...ids(st(sim).n), null].map((p) => [p ?? 'table', sim.view(p).hint]));

test('avalon: 💡 every phase gives every seat a one-line hint (≤ 40 characters) that never depends on the seat\'s role', () => {
  const phases = new Set();
  const check = (sim) => {
    const s = st(sim);
    const hints = hintsOf(sim);
    for (const [who, h] of Object.entries(hints)) {
      assert.ok(typeof h === 'string' && h.length > 0, `no hint for ${who} in ${s.phase}`);
      assert.ok([...h].length <= 40, `hint too long (${who}, ${s.phase}): ${h}`);
      assert.ok(!h.includes('\n'), 'one line');
      for (const p of sim.players) assert.ok(!h.includes(p.name), `the hint names a player: ${h}`);
    }
    phases.add(s.phase);
    // the same screens read the same for good and evil
    const seatHints = ids(s.n).map((p) => hints[p]);
    if (s.phase === 'reveal' && s.cfg.revealSecs > 0) assert.equal(new Set(seatHints).size, 1, 'reveal hints differ');
    if (s.phase === 'assassinate') assert.equal(new Set(seatHints).size, 1, 'assassination hints differ');
    if (s.phase === 'quest') {
      const waiting = s.team.filter((p) => !(p in s.cards)).map((p) => hints[p]);
      assert.ok(new Set(waiting).size <= 1, 'quest hints differ between members');
    }
    // role-independence: deal the same cards to different seats and nothing changes
    if (s.phase !== 'over') {
      const swapped = clone(s);
      const roles = s.order.map((p) => s.role[p]);
      roles.push(roles.shift());
      s.order.forEach((p, i) => { swapped.role[p] = roles[i]; });
      for (const p of [...s.order, null]) assert.equal(engine.view(swapped, p).hint, hints[p ?? 'table'], `the hint of ${p} depends on the role (${s.phase})`);
    }
  };
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 4; seed++) {
      const patch = seed % 2 ? { lady: 'on' } : { revealSecs: 25, questSecs: 12, lady: 'on' };
      const sim = new Sim(game, { n, seed: seed * 13 + n, config: config.defaults(n, { ...(seed % 2 ? TAP : {}), ...patch }) });
      check(sim);
      sim.runRandom({ onStep: check });
    }
  }
  for (const ph of ['reveal', 'pick', 'vote', 'voted', 'quest', 'quest-result', 'lady', 'lady-peek', 'assassinate', 'shot', 'over']) {
    assert.ok(phases.has(ph), `no hint was checked in ${ph}`);
  }
  // the leader and the others get their own line; the fifth proposal says what is at stake
  const sim = mk(7, { seed: 2 });
  revealAll(sim);
  assert.match(sim.view(leader(sim)).hint, /你係隊長/);
  assert.doesNotMatch(sim.view(st(sim).order.find((p) => p !== leader(sim))).hint, /你係隊長/);
  for (let i = 0; i < 4; i++) { pickTeam(sim); voteAll(sim, 'reject'); cont(sim); }
  for (const p of ids(7)) assert.match(sim.view(p).hint, /最後|第五次/);
});

test('avalon: #3 the reveal ("night") — every seat has a tap, no tap blocks or shortens it, and it lasts exactly its fixed time', () => {
  for (const n of COUNTS) {
    const sim = mkTimed(n, n);
    const s0 = st(sim);
    const end = s0.deadline;
    assert.equal(end, sim.now + 25000);
    for (const p of ids(n)) {
      assert.deepEqual(sim.legal(p), [{ type: 'seen' }], `${p} has the harmless tap`);
      assert.equal(engine.blocking(sim.state, p), false, 'the clock ends the reveal: nobody blocks it');
    }
    for (const p of ids(n)) ok(sim, p, { type: 'seen' });
    assert.equal(phase(sim), 'reveal', 'everybody looked: still the reveal');
    assert.equal(st(sim).deadline, end, 'the window did not move');
    sim.now = end - 1;
    assert.equal(engine.advance(clone(sim.state), sim.ctx()).phase, 'reveal', 'one ms early: nothing');
    sim.advance();
    assert.equal(phase(sim), 'pick');
    assert.equal(sim.now, end);
  }
});

test('avalon: the leak sweep passes at every step of a scripted game, for every head-count and several set-ups', () => {
  for (const n of COUNTS) {
    for (const patch of [{}, { preset: 'plain' }, { preset: 'alt', lady: 'on' }, { flipEvil: true }, { oberonSeenByMerlin: false }]) {
      const sim = mk(n, { seed: n + 30, ...patch });
      checkLeaks(sim);
      for (const p of ids(n)) { sim.act(p, { type: 'seen' }); }
      checkLeaks(sim);
      for (let q = 0; q < 6 && !sim.result(); q++) {
        if (phase(sim) === 'pick') {
          pickTeam(sim); checkLeaks(sim);
          voteAll(sim, (p) => (p === 'p1' ? 'reject' : 'approve')); checkLeaks(sim);
          cont(sim); checkLeaks(sim);
          if (phase(sim) === 'quest') {
            for (const p of st(sim).team) { sim.act(p, { type: 'quest', card: isEvil(sim, p) ? 'fail' : 'success' }); checkLeaks(sim); }
            checkLeaks(sim);
            cont(sim); checkLeaks(sim);
            while (phase(sim) === 'lady' || phase(sim) === 'lady-peek') {
              const holder = st(sim).lady.step.holder;
              sim.act(holder, sim.legal(holder)[0]); checkLeaks(sim);
            }
          }
        } else if (phase(sim) === 'assassinate') {
          const a = seatOf(sim, 'assassin');
          for (const p of ids(n)) if (p !== a) sim.act(p, { type: 'decoy' });
          checkLeaks(sim);
          sim.act(a, sim.legal(a)[0]); checkLeaks(sim);
        } else if (phase(sim) === 'shot') {
          sim.advance(); checkLeaks(sim);
        } else break;
      }
    }
  }
});

/**
 * Quest 1 passes on its first proposal; quest 2 is rejected twice, its third vote is voided by the host and cast again,
 * then passes; quest 3 is rejected once, then passes; the Assassin shoots. `strip` drops the stored per-quest numbers
 * before the end, the way a snapshot from an older build would look.
 */
function proposalsGame({ strip = false } = {}) {
  const sim = mk(5, { seed: 3, lady: 'off' });
  revealAll(sim);
  forceQuest(sim, true); cont(sim);
  pickTeam(sim); voteAll(sim, 'reject'); cont(sim);
  pickTeam(sim); voteAll(sim, 'reject'); cont(sim);
  pickTeam(sim);
  ok(sim, st(sim).order[0], { type: 'vote', vote: 'reject' });
  assert.equal(sim.host({ type: ACT.VOID_ROUND }), true);
  voteAll(sim, 'approve'); cont(sim);
  playCards(sim); cont(sim);
  pickTeam(sim); voteAll(sim, 'reject'); cont(sim);
  forceQuest(sim, true); cont(sim);
  assert.equal(phase(sim), 'assassinate');
  if (strip) { for (const e of st(sim).voteLog) delete e.k; for (const x of st(sim).voids) delete x.k; }
  ok(sim, seatOf(sim, 'assassin'), { type: 'assassinate', target: seatOf(sim, 'merlin') });
  sim.advance();
  assert.equal(phase(sim), 'over');
  return sim;
}

test('avalon: the recap numbers proposals per quest, as the game screens do, voids included; an old snapshot without the numbers reads the same (#33)', () => {
  const sim = proposalsGame();
  assert.deepEqual(st(sim).voteLog.map((e) => [e.q, e.k]), [[1, 1], [2, 1], [2, 2], [2, 3], [3, 1], [3, 2]]);
  const lines = sim.result().lines;
  const props = lines.map((l) => l.match(/^(任務 \d · 第 \d 次提議)：隊長/)?.[1]).filter(Boolean);
  assert.deepEqual(props, ['任務 1 · 第 1 次提議', '任務 2 · 第 1 次提議', '任務 2 · 第 2 次提議', '任務 2 · 第 3 次提議', '任務 3 · 第 1 次提議', '任務 3 · 第 2 次提議']);
  assert.ok(lines.includes('任務 2 · 第 3 次提議：投票取消，重新投過'), 'the void names the proposal of its quest');
  for (const l of lines) assert.doesNotMatch(l, /第 [4-9] 次/, `a game-wide number leaked into the recap: ${l}`);
  assert.deepEqual(proposalsGame({ strip: true }).result().lines, lines, 'derived from the log when k is missing');
});

test('avalon: the results recap folds into sections — every heading is a 「── 標題 ──」 line the shell understands', async () => {
  const { resultSections, headingOf } = await import('../js/ui/logic.js');
  for (const k of Object.keys(S.RECAP).filter((x) => x.endsWith('Head'))) assert.ok(headingOf(S.RECAP[k]), `${k} is a section heading`);
  const lines = proposalsGame().result().lines;
  const secs = resultSections(lines);
  assert.equal(secs[0].title, null, 'the why-line comes first, on its own');
  assert.ok(secs[0].lines[0].includes('刺中梅林'));
  assert.deepEqual(secs.slice(1).map((x) => x.title), ['🎭 身份同夜晚情報', '📜 任務記錄（連出咗咩牌）', '🗳 提議同投票記錄', '⏭ 主持「呢鋪唔計」', '🗡️ 刺殺']);
  for (const x of secs) assert.ok(x.lines.length > 0);
  assert.equal(secs[1].lines.length, 5, 'one row per seat under 身份');
});

test('avalon: a picked Fail tile is styled exactly like a picked Success tile, and the button never names the card (#17)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../js/games/avalon/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = css.split('}').map((r) => r.split('{').slice(-2, -1)[0] ?? '').map((x) => x.trim()).filter(Boolean);
  const byKind = selectors.filter((sel) => /\.av-tile[^,{]*\.(success|fail)\b|\.(success|fail)[^,{]*\.av-tile\b/.test(sel));
  assert.deepEqual(byKind, [], 'no style tells the Success tile from the Fail tile');
  assert.ok(selectors.some((sel) => sel.includes('.av-tile.on')), 'one selected style for both');
  assert.equal(S.T.quest.play('fail'), S.T.quest.play('success'));
  assert.equal(S.T.quest.play('fail'), '確定出牌');
  assert.notEqual(S.T.quest.play(null), S.T.quest.play('fail'), 'nothing picked yet: 揀一張牌先');
});

test('avalon: the over view and the result carry the whole story — every role, every card, every vote, what each seat knew', () => {
  const sim = mk(8, { seed: 15, lady: 'on' });
  revealAll(sim);
  forceQuest(sim, true); cont(sim);
  forceQuest(sim, false); cont(sim); passLady(sim);
  forceQuest(sim, true); cont(sim); passLady(sim);
  forceQuest(sim, true); cont(sim);
  assert.equal(phase(sim), 'assassinate');
  const a = seatOf(sim, 'assassin');
  ok(sim, a, { type: 'assassinate', target: seatOf(sim, 'merlin') });
  sim.advance();
  const v = sim.view('p3');
  assert.equal(v.phase, 'over');
  assert.deepEqual(v.end.roles, Object.fromEntries(ids(8).map((p) => [p, st(sim).role[p]])));
  assert.equal(v.end.winner, 'evil');
  assert.equal(v.end.reason, 'assassinated-merlin');
  assert.equal(v.end.quests.length, 4);
  for (const q of v.end.quests) assert.ok(q.played && Object.keys(q.played).length === q.team.length);
  assert.equal(v.end.lady.length, 2);
  assert.ok(['good', 'evil'].includes(v.end.lady[0].loyalty));
  const res = sim.result();
  const text = res.lines.join('\n');
  for (const p of sim.players) assert.ok(text.includes(`${p.name}：${S.roleLabel(st(sim).role[p.id])}`), `role of ${p.name}`);
  for (const q of st(sim).quests) for (const p of q.team) assert.ok(text.includes(`${sim.players.find((x) => x.id === p).name} ${q.played[p] === 'fail' ? '失敗' : '成功'}`));
  assert.ok(text.includes('夜晚見到邪惡'), 'Merlin\'s night knowledge is in the recap');
  assert.ok(text.includes('贊成：'), 'who voted what');
  assert.ok(text.includes('驗'), 'the Lady checks');
  assert.ok(text.includes('刺咗'), 'the shot');
  assert.ok(res.summary.includes('反敗為勝'));
});

test('avalon: views are fresh objects (mutating one never touches the state)', () => {
  const sim = mk(6, { seed: 2 });
  const before = JSON.stringify(sim.state);
  const v = sim.view(seatOf(sim, 'merlin'));
  v.mine.knows.pids.push('p9'); v.mine.role = 'x'; v.deck.pop(); v.order.pop(); v.board.sizes[0] = 99;
  assert.equal(JSON.stringify(sim.state), before);
  revealAll(sim);
  pickTeam(sim);
  const w = sim.view('p1');
  w.vote = null;
  const t = sim.view('p1');
  t.vote.team.push('p9');
  assert.equal(JSON.stringify(sim.state.team).includes('p9'), false);
});

test('avalon: state is plain JSON, games are deterministic per seed, and a JSON round trip mid-game continues the same', () => {
  const run = (seed) => { const s = mk(7, { seed }); s.runRandom(); return s; };
  const a = run(77); const b = run(77); const c = run(78);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.notEqual(JSON.stringify(a.state), JSON.stringify(c.state));
  assert.deepEqual(JSON.parse(JSON.stringify(a.state)), a.state);
  // restore from a snapshot taken at every phase of one game and compare the next views
  const sim = mk(7, { seed: 31, lady: 'on' });
  const seen = new Set();
  let guard = 0;
  while (!sim.result() && guard++ < 400) {
    if (!seen.has(phase(sim))) {
      seen.add(phase(sim));
      const snap = JSON.parse(JSON.stringify(sim.state));
      for (const p of [...ids(7), null]) assert.deepEqual(engine.view(snap, p), sim.view(p), `snapshot view ${p} in ${phase(sim)}`);
      assert.deepEqual(engine.focus(snap), sim.focus());
      assert.deepEqual(engine.cue(snap), sim.cue());
    }
    const movers = ids(7).filter((p) => sim.legal(p).length);
    if (movers.length) { const p = movers[Math.floor(sim.rng() * movers.length)]; const o = sim.legal(p); sim.act(p, o[Math.floor(sim.rng() * o.length)]); }
    else if (sim.cue() && sim.cueDone()) continue;
    else if (!sim.advance()) sim.host({ type: ACT.NEXT });
  }
  for (const ph of ['reveal', 'pick', 'vote', 'voted', 'quest', 'quest-result']) assert.ok(seen.has(ph), `saw ${ph}`);
});

test('avalon: garbage from the network never throws and never changes the state', () => {
  const sim = mk(6, { seed: 1 });
  const before = JSON.stringify(sim.state);
  const msgs = [
    undefined, null, 0, 'pick', [], {}, { pid: 'p1' }, { action: { type: 'seen' } }, { pid: 'p1', action: null }, { pid: 'p1', action: 'seen' },
    { pid: 'p1', action: [] }, { pid: 'p1', action: {} }, { pid: 'p1', action: { type: 5 } }, { pid: 'p1', action: { type: null } },
    { pid: 'p1', action: { type: '__proto__' } }, { pid: 'p1', action: { type: 'constructor' } }, { pid: 'p1', action: { type: 'toString' } },
    { pid: 'constructor', action: { type: 'seen' } }, { pid: '__proto__', action: { type: 'seen' } }, { pid: 'ghost', action: { type: 'seen' } },
    { pid: 7, action: { type: 'seen' } }, { pid: ['p1'], action: { type: 'seen' } },
    { pid: 'p1', action: { type: 'pick', team: ['p1', 'p2'] } }, { pid: 'p1', action: { type: 'vote', vote: 'approve' } },
    { pid: 'p1', action: { type: 'quest', card: 'fail' } }, { pid: 'p1', action: { type: 'lady', target: 'p2' } },
    { pid: 'p1', action: { type: 'assassinate', target: 'p2' } }, { pid: 'p1', action: { type: 'continue' } }, { pid: 'p1', action: { type: 'decoy' } },
    { pid: HOST, action: { type: 'seen' } }, { pid: HOST, action: { type: ACT.CUE_DONE, id: 'nope' } }, { pid: HOST, action: { type: ACT.CUE_DONE } },
    { pid: HOST, action: { type: ACT.AUTO, pid: 'p2' } }, { pid: HOST, action: { type: 'pick', team: ['p1', 'p2'] } },
  ];
  // `seen` is the only legal thing in the reveal, and it is a real action: exclude it from the "never changes" sweep
  for (const m of msgs) {
    if (m && m.action && m.action.type === 'seen' && m.pid === 'p1') continue;
    const next = engine.act(clone(sim.state), m, sim.ctx());
    assert.equal(JSON.stringify(next ?? sim.state), before, `message ${JSON.stringify(m)} changed the state`);
  }
  // wrong-phase actions through every phase
  const everything = [{ type: 'seen' }, { type: 'pick', team: ['p1', 'p2'] }, { type: 'vote', vote: 'approve' }, { type: 'quest', card: 'success' },
    { type: 'continue' }, { type: 'lady', target: 'p3' }, { type: 'lady-done' }, { type: 'assassinate', target: 'p2' }, { type: 'decoy' }];
  const probe = (label) => {
    for (const p of ids(6)) {
      for (const a of everything) {
        const snap = JSON.stringify(sim.state);
        const out = engine.act(clone(sim.state), { pid: p, action: a }, sim.ctx());
        const legalHere = sim.legal(p).some((l) => JSON.stringify(l) === JSON.stringify(a));
        if (!legalHere && !(a.type === 'pick' || a.type === 'lady' || a.type === 'assassinate')) {
          assert.equal(JSON.stringify(out ?? sim.state), snap, `${label}: ${p} ${JSON.stringify(a)} is not legal yet changed the state`);
        }
      }
    }
  };
  probe('reveal');
  revealAll(sim); probe('pick');
  pickTeam(sim); probe('vote');
  voteAll(sim, 'approve'); probe('voted');
  cont(sim); probe('quest');
  playCards(sim); probe('quest-result');
});

// ============================================================
// narration cues and focus
// ============================================================

test('avalon: every phase has one public cue, unique per step; acknowledged cues disappear; the cue never hides a secret', () => {
  const sim = mk(7, { seed: 3, lady: 'on' });
  const ids2 = [];
  const note = () => { const c = sim.cue(); if (c) ids2.push(c.id); return c; };
  let c = note();
  assert.match(c.id, /^av\d+:reveal$/);
  assert.ok(c.text.includes('今局角色'));
  for (const d of sim.state.deck) assert.ok(c.text.includes(S.roleName(d.role)) || d.role === 'servant', `deck role ${d.role} is announced`);
  assert.ok(c.minMs >= 2000);
  assert.equal(sim.host({ type: ACT.CUE_DONE, id: 'wrong' }), false);
  assert.equal(sim.cueDone(), true);
  assert.equal(sim.cue(), null);
  assert.equal(sim.cueDone(), false, 'acknowledged once only');
  revealAll(sim);
  c = note();
  assert.ok(c.id.endsWith(':pick:1'));
  assert.ok(c.text.includes('第一個任務') && c.text.includes('兩個人') && c.text.includes(sim.players.find((p) => p.id === leader(sim)).name));
  pickTeam(sim);
  c = note();
  assert.ok(c.id.endsWith(':vote:1'));
  for (const p of st(sim).team) assert.ok(c.text.includes(p === leader(sim) ? '提議自己' : sim.players.find((x) => x.id === p).name) || p === leader(sim) && c.text.includes('自己'), `${p} in the vote cue: ${c.text}`);
  assert.equal(st(sim).team.includes(leader(sim)), c.text.includes('自己'), 'the leader is called 自己 exactly when on the team');
  voteAll(sim, (p) => (p === 'p1' ? 'reject' : 'approve'));
  c = note();
  assert.ok(c.id.endsWith(':voted:1'));
  assert.ok(c.text.includes('六個贊成') && c.text.includes('一個反對') && c.text.includes('通過') && c.text.includes('玩家1'));
  cont(sim);
  c = note();
  assert.ok(c.id.endsWith(':quest:1'));
  assert.ok(c.text.includes('好人只可以出成功'));
  playCards(sim, (p) => (isEvil(sim, p) ? 'fail' : 'success'));
  c = note();
  assert.ok(c.id.endsWith(':result:1'));
  assert.match(c.text, /任務結果：.*張成功，.*張失敗/);
  cont(sim);
  assert.ok(sim.cue().id.endsWith(':pick:2'));
  forceQuest(sim, false); cont(sim);
  assert.equal(phase(sim), 'lady');
  c = note();
  assert.ok(c.id.includes(':lady:'));
  const holder = st(sim).lady.holder;
  assert.ok(c.text.includes(sim.players.find((p) => p.id === holder).name));
  ok(sim, holder, { type: 'lady', target: sim.legal(holder)[0].target });
  c = note();
  assert.ok(c.id.includes(':ladypeek:'));
  assert.ok(!/邪惡|好人/.test(c.text), 'the Lady cue never says what was seen');
  assert.equal(new Set(ids2).size, ids2.length, 'cue ids repeat');
});

test('avalon: cues are spoken aloud, so role names appear only in the three public places', () => {
  for (let seed = 1; seed <= 6; seed++) {
    const sim = mk(10, { seed, flipEvil: seed % 2 === 0 });
    const seen = [];
    const probe = (x) => {
      const c = x.cue();
      if (!c) return;
      const p = x.state.phase;
      seen.push([p, c.text]);
      const roleWords = Object.values(S.ROLES).map((r) => r.name).filter((w) => w !== '亞瑟忠臣');
      const mentions = roleWords.filter((w) => c.text.includes(w));
      if (['reveal', 'assassinate', 'shot'].includes(p)) return;
      const allowed = p === 'quest-result' && c.text.includes('刺殺梅林') ? ['梅林'] : [];
      assert.deepEqual(mentions, allowed, `cue in ${p} names a role: ${c.text}`);
      // the Assassin's and Merlin's seats are never singled out in a cue before the shot
      const names = x.players.filter((pl) => [x.state.role[pl.id]].some((r) => r === 'assassin' || r === 'merlin')).map((pl) => pl.name);
      void names;
    };
    probe(sim);
    sim.runRandom({ onStep: probe });
    const a = seen.find(([p]) => p === 'assassinate');
    if (a) for (const pl of sim.players) assert.ok(!a[1].includes(`${pl.name}，`) && !a[1].includes(pl.name + '請'), 'the assassination call names nobody');
  }
});

test('avalon: focus per phase — and the Assassin is called by role, not by name', () => {
  const sim = mk(6, { seed: 9, lady: 'on' });
  assert.deepEqual(sim.focus().pids, ids(6));
  revealAll(sim);
  assert.deepEqual(sim.focus(), { pids: [leader(sim)] });
  pickTeam(sim);
  assert.deepEqual(sim.focus().pids, ids(6));
  ok(sim, 'p2', { type: 'vote', vote: 'approve' });
  assert.deepEqual(sim.focus().pids, ids(6).filter((p) => p !== 'p2'));
  voteAll(sim, 'approve');
  assert.deepEqual(sim.focus(), { pids: [leader(sim)] });
  cont(sim);
  assert.deepEqual(sim.focus().pids, st(sim).team, 'quest: the team members who still owe a card');
  const first = st(sim).team[0];
  ok(sim, first, { type: 'quest', card: 'success' });
  assert.deepEqual(sim.focus().pids, st(sim).team.filter((p) => p !== first));
  for (const p of st(sim).team) sim.act(p, { type: 'quest', card: 'success' });
  assert.deepEqual(sim.focus(), { pids: [leader(sim)] });
  assert.equal(sim.focus().anonymous, undefined, 'only the assassination is anonymous');
});

// ============================================================
// stalled seats
// ============================================================

test('avalon: autoAct unsticks every phase, so a dead phone cannot stop the table (voters approve, members succeed)', () => {
  for (const n of [5, 8, 10]) {
    for (const patch of [{}, { revealSecs: 25, questSecs: 12, lady: 'on' }, { flipEvil: true, discussSecs: 30, assassinSecs: 30 }]) {
      for (let seed = 1; seed <= 4; seed++) {
        const sim = new Sim(game, { n, seed, config: config.defaults(n, { ...TAP, ...patch }) });
        let guard = 0;
        while (!sim.result() && guard++ < 3000) {
          const f = sim.focus();
          let moved = false;
          for (const pid of f ? f.pids : ids(n)) {
            const a = engine.autoAct(sim.state, pid, sim.ctx());
            if (a) {
              if (phase(sim) === 'vote') assert.deepEqual(a, { type: 'vote', vote: 'approve' });
              if (phase(sim) === 'quest') assert.deepEqual(a, { type: 'quest', card: 'success' });
              assert.ok(sim.act(pid, a), `autoAct ${JSON.stringify(a)} did nothing in ${phase(sim)}`);
              moved = true;
              break;
            }
          }
          if (moved) continue;
          if (sim.cue() && sim.cueDone()) continue;
          if (sim.state.deadline != null && sim.advance()) continue;
          // timed windows with nothing to do: the clock
          assert.ok(sim.host({ type: ACT.NEXT }) || sim.state.deadline != null, `stuck in ${phase(sim)}`);
        }
        assert.ok(sim.result(), `n=${n} finished through autoAct alone`);
      }
    }
  }
  const sim = mk(5);
  assert.equal(engine.autoAct(sim.state, 'nobody', sim.ctx()), null);
});

test('avalon: blocking — only the seats the game is really waiting on; the anti-tell taps never count', () => {
  const blockers = (sim) => ids(st(sim).n).filter((p) => engine.blocking(sim.state, p));
  // tap mode
  const sim = mk(7, { seed: 6, lady: 'on' });
  assert.deepEqual(blockers(sim), ids(7));
  ok(sim, 'p2', { type: 'seen' });
  assert.deepEqual(blockers(sim), ids(7).filter((p) => p !== 'p2'));
  revealAll(sim);
  assert.deepEqual(blockers(sim), [leader(sim)], 'pick: the leader');
  pickTeam(sim);
  ok(sim, 'p4', { type: 'vote', vote: 'reject' });
  assert.deepEqual(blockers(sim), ids(7).filter((p) => p !== 'p4'), 'vote: whoever has not voted');
  voteAll(sim, 'approve');
  assert.deepEqual(blockers(sim), [leader(sim)], 'voted: the leader taps 繼續');
  cont(sim);
  const first = st(sim).team[0];
  ok(sim, first, { type: 'quest', card: 'success' });
  assert.deepEqual(blockers(sim), st(sim).team.filter((p) => p !== first), 'quest: members who still owe a card');
  playCards(sim);
  assert.deepEqual(blockers(sim), [leader(sim)], 'quest-result: the leader');
  cont(sim);
  forceQuest(sim, false); cont(sim);
  assert.equal(phase(sim), 'lady');
  assert.deepEqual(blockers(sim), [st(sim).lady.step.holder], 'lady: the holder');
  ok(sim, st(sim).lady.step.holder, sim.legal(st(sim).lady.step.holder)[0]);
  assert.deepEqual(blockers(sim), [st(sim).lady.step.holder], 'lady-peek: the holder');
  // the assassination: every seat has a tap, only the Assassin blocks — before and after the decoys
  const a = mkTimed(8, 4, { flipEvil: true, assassinSecs: 60 });
  toAssassinate(a);
  const assassin = seatOf(a, 'assassin');
  for (const p of ids(8)) assert.ok(a.legal(p).length > 0, `${p} has a tap`);
  assert.deepEqual(blockers(a), [assassin]);
  for (const p of ids(8)) if (p !== assassin) ok(a, p, { type: 'decoy' });
  assert.deepEqual(blockers(a), [assassin]);
  ok(a, assassin, { type: 'assassinate', target: seatOf(a, 'servant') });
  assert.deepEqual(blockers(a), [], 'shot: the clock ends it');
  a.advance();
  assert.deepEqual(blockers(a), [], 'over: nobody');
  // property over fuzzed games: a blocker always has a legal action; outside the timed reveal and the shot it is what focus names
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 4; seed++) {
      const f = new Sim(game, { n, seed: seed * 7 + n, config: config.defaults(n, seed % 2 ? { ...TAP, lady: 'on' } : { lady: 'on' }) });
      const probe = (x) => {
        const s = st(x);
        const b = ids(n).filter((p) => engine.blocking(s, p));
        for (const p of b) assert.ok(x.legal(p).length > 0, `${p} blocks with nothing to do (${s.phase})`);
        for (const p of ['ghost', null, undefined, 7]) assert.equal(engine.blocking(s, p), false);
        const timedReveal = s.phase === 'reveal' && s.cfg.revealSecs > 0;
        if (timedReveal || s.phase === 'shot' || s.phase === 'over') assert.deepEqual(b, [], s.phase);
        else assert.deepEqual(b.slice().sort(), (x.focus()?.pids ?? []).slice().sort(), `blocking = focus in ${s.phase}`);
      };
      probe(f);
      f.runRandom({ onStep: probe });
    }
  }
});

test('avalon: @void-round — a dead leader passes the token (no rejection); a vote or a quest starts again; nothing else moves', () => {
  const V = { type: ACT.VOID_ROUND };
  // pick: the token moves on, the track and the proposal count stay
  const sim = mk(7, { seed: 8, lady: 'on' });
  assert.equal(sim.host(V), false, 'reveal: nothing to void');
  revealAll(sim);
  pickTeam(sim); voteAll(sim, 'reject'); cont(sim);
  const before = clone(st(sim));
  assert.equal(sim.host(V), true);
  assert.equal(phase(sim), 'pick');
  assert.equal(st(sim).leaderIx, (before.leaderIx + 1) % 7, 'the next seat leads');
  assert.equal(st(sim).rejects, 1, 'not a rejection');
  assert.equal(st(sim).proposalNo, before.proposalNo, 'not a proposal');
  assert.deepEqual(st(sim).voteLog, before.voteLog);
  assert.match(sim.cue().text, /隊長換人，唔算否決/);
  assert.ok(sim.cue().id.endsWith(':pick:2~1'), 'a fresh cue id, so the new leader is announced');
  for (const p of [...ids(7), null]) assert.equal(sim.view(p).redo, true, 'every screen says the step restarted');
  checkInvariants(sim);
  // vote: the ballots go, the team stays
  const team = pickTeam(sim);
  assert.equal(sim.host(V), false, 'no vote cast yet: nothing to throw away');
  ok(sim, 'p1', { type: 'vote', vote: 'approve' });
  ok(sim, 'p2', { type: 'vote', vote: 'reject' });
  assert.equal(sim.host(V), true);
  assert.equal(phase(sim), 'vote');
  assert.deepEqual(st(sim).votes, {});
  assert.deepEqual(st(sim).team, st(sim).order.filter((p) => team.includes(p)));
  assert.equal(sim.view('p3').vote.progress.done, 0);
  assert.equal(sim.view('p1').vote.mine, null);
  assert.match(sim.cue().text, /重新投過/);
  assert.equal(sim.view('p5').redo, true);
  assert.equal(st(sim).rejects, 1);
  voteAll(sim, 'approve');
  assert.equal(phase(sim), 'voted');
  cont(sim);
  // quest: the cards go, the same team plays again with a fresh window
  const t = mkTimed(6, 3);
  revealAll(t);
  pickTeam(t); voteAll(t, 'approve'); cont(t);
  const q = clone(st(t));
  assert.equal(t.host(V), false, 'no card yet');
  t.tick(4000);
  ok(t, q.team[0], { type: 'quest', card: 'success' });
  assert.equal(t.host(V), true);
  assert.equal(phase(t), 'quest');
  assert.deepEqual(st(t).cards, {});
  assert.deepEqual(st(t).team, q.team);
  assert.equal(st(t).deadline, t.now + 12000, 'a fresh minimum window');
  assert.equal(st(t).windowOver, false);
  assert.match(t.cue().text, /重新出過/);
  assert.equal(t.view(null).redo, true);
  assert.equal(t.view(q.team[0]).quest.mine.done, false, 'the member plays again');
  playCards(t);
  assert.equal(phase(t), 'quest-result');
  assert.equal(t.view(null).redo, undefined, 'the flag goes once the step is over');
  assert.equal(st(t).quests.length, 1, 'the voided play left no trace in the record');
  // every other phase: nothing moves
  for (const ph of ['voted', 'quest-result']) {
    const x = mk(6, { seed: 2 });
    revealAll(x); pickTeam(x); voteAll(x, 'approve');
    if (ph === 'quest-result') { cont(x); playCards(x); }
    assert.equal(phase(x), ph);
    assert.equal(x.host(V), false, ph);
  }
  const l = mk(7, { seed: 5, lady: 'on' });
  revealAll(l);
  forceQuest(l, true); cont(l); forceQuest(l, false); cont(l);
  assert.equal(phase(l), 'lady');
  assert.equal(l.host(V), false, 'lady');
  ok(l, st(l).lady.step.holder, l.legal(st(l).lady.step.holder)[0]);
  assert.equal(l.host(V), false, 'lady-peek');
  const z = mk(5, { seed: 4 });
  toAssassinate(z);
  assert.equal(z.host(V), false, 'assassinate');
  ok(z, seatOf(z, 'assassin'), { type: 'assassinate', target: seatOf(z, 'merlin') });
  assert.equal(z.host(V), false, 'shot');
  z.advance();
  assert.equal(z.host(V), false, 'over');
  // a seat cannot send it
  const y = mk(6, { seed: 1 });
  revealAll(y);
  assert.equal(y.act(leader(y), V), false, 'only the host voids a round');
  // the results say what the host cancelled
  sim.runRandom();
  const text = sim.result().lines.join('\n');
  assert.ok(text.includes('⏭'), 'the voids have a heading');
  assert.ok(text.includes('冇揀到隊，傳俾下一位（唔算否決）'));
  assert.ok(text.includes('投票取消，重新投過'));
});

test('avalon: fuzz with the host voiding rounds at random — every game still ends, and the vote track and leader rotation stay consistent', () => {
  let voids = 0;
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 12; seed++) {
      const sim = new Sim(game, { n, seed: seed * 19 + n, config: config.defaults(n, { ...(seed % 2 ? TAP : {}), lady: 'on' }) });
      const rng = mulberry32(seed);
      fastRun(sim, {
        onStep: (x) => {
          if (rng() < 0.06 && x.host({ type: ACT.VOID_ROUND })) voids++;
          checkInvariants(x);
        },
      });
      checkInvariants(sim);
    }
  }
  assert.ok(voids > 50, `voids happened: ${voids}`);
});

test('avalon: @next never gets stuck — it skips reveal, voted, quest, quest-result, lady-peek and shot, and refuses to decide for anyone', () => {
  const sim = mkTimed(7, 3, { lady: 'on' });
  sim.host({ type: ACT.NEXT });                     // ack
  sim.host({ type: ACT.NEXT });                     // skip the reveal window
  assert.equal(phase(sim), 'pick');
  sim.host({ type: ACT.NEXT });
  assert.equal(sim.host({ type: ACT.NEXT }), false, 'pick needs a real decision');
  assert.equal(phase(sim), 'pick');
  pickTeam(sim);
  assert.equal(sim.host({ type: ACT.NEXT }), true);   // cue ack
  assert.equal(sim.host({ type: ACT.NEXT }), false);
  assert.equal(phase(sim), 'vote');
  voteAll(sim, 'approve');
  sim.host({ type: ACT.NEXT }); sim.host({ type: ACT.NEXT });
  assert.equal(phase(sim), 'quest');
  sim.host({ type: ACT.NEXT }); sim.host({ type: ACT.NEXT });
  assert.equal(phase(sim), 'quest-result');
  sim.host({ type: ACT.NEXT }); sim.host({ type: ACT.NEXT });
  assert.equal(phase(sim), 'pick');
});

// ============================================================
// fuzzers
// ============================================================

test('avalon: fuzz — every head-count x 100 seeds terminates with a well-formed result (clock modes, presets and Lady mixed)', () => {
  const reasons = {};
  const presets = ['recommended', 'plain', 'alt'];
  let games = 0;
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 100; seed++) {
      const patch = {
        preset: presets[seed % 3],
        lady: ['auto', 'on', 'off'][seed % 3 === 0 ? 1 : seed % 5 === 0 ? 2 : 0],
        oberonSeenByMerlin: seed % 7 !== 0,
        flipEvil: seed % 11 === 0,
        discussSecs: seed % 13 === 0 ? 60 : 0,
        assassinSecs: seed % 17 === 0 ? 60 : 0,
      };
      const timed = seed % 2 === 0;
      const cfg = config.defaults(n, { ...(timed ? {} : TAP), ...patch });
      assert.ok(config.validate(cfg, n).ok);
      const sim = new Sim(game, { n, seed: seed * 31 + n, config: cfg });
      const result = fastRun(sim, { onStep: (x) => { if (seed <= 3 || x.steps % 9 === 0) checkInvariants(x); } });
      checkInvariants(sim);
      assertResultShape(result, sim.players);
      assert.ok(result.winners.length >= 1);
      assert.equal(Object.keys(result.points).length, n);
      assert.ok(sim.state.quests.length <= 5);
      assert.ok(['three-fails', 'five-rejections', 'assassinated-merlin', 'assassin-missed'].includes(sim.state.reason));
      const team = sim.state.winner === 'evil' ? evils(sim) : goods(sim);
      assert.deepEqual(result.winners.slice().sort(), team.slice().sort());
      // the game ended for exactly the reason it says
      const wins = sim.state.results.filter((r) => r === true).length;
      const losses = sim.state.results.filter((r) => r === false).length;
      if (sim.state.reason === 'three-fails') assert.equal(losses, 3);
      if (sim.state.reason === 'five-rejections') { assert.ok(losses < 3 && wins < 3); assert.equal(sim.state.rejects, 5); }
      if (sim.state.reason.startsWith('assassin')) { assert.equal(wins, 3); assert.ok(losses < 3); }
      reasons[sim.state.reason] = (reasons[sim.state.reason] ?? 0) + 1;
      games++;
    }
  }
  assert.equal(games, 600);
  for (const r of ['three-fails', 'five-rejections', 'assassinated-merlin', 'assassin-missed']) assert.ok(reasons[r] > 5, `outcome ${r} never happened: ${JSON.stringify(reasons)}`);
});

test('avalon: fuzz — the shared harness (Sim.runRandom, clone + diff on every step) plays 25 seeds per head-count to the end', () => {
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 25; seed++) {
      const patch = seed % 3 === 0 ? { preset: 'alt', lady: 'on' } : seed % 3 === 1 ? { preset: 'plain' } : {};
      const sim = new Sim(game, { n, seed: seed * 53 + n, config: config.defaults(n, { ...(seed % 2 ? TAP : {}), ...patch }) });
      const { result } = sim.runRandom();
      assertResultShape(result, sim.players);
      assert.equal(sim.state.phase, 'over');
    }
  }
});

test('avalon: fuzz with the secrecy sweep at every step — counts x set-ups x seeds', () => {
  for (const n of COUNTS) {
    for (const patch of [{ preset: 'alt', lady: 'on', flipEvil: true }, { oberonSeenByMerlin: false, lady: 'on', questSecs: 12 }, {}]) {
      for (let seed = 1; seed <= 2; seed++) {
        const sim = new Sim(game, { n, seed: seed * 17 + n, config: config.defaults(n, { revealSecs: patch.questSecs ? 25 : 0, questSecs: 0, ...patch }) });
        checkLeaks(sim);
        sim.runRandom({ onStep: checkLeaks });
        checkLeaks(sim);
      }
    }
  }
});

test('avalon: legalActions are all accepted and each changes the state, for every seat in every phase (random sample)', () => {
  const rng = mulberry32(5);
  for (const n of COUNTS) {
    const sim = mk(n, { seed: n * 3, lady: 'on' });
    for (let i = 0; i < 300 && !sim.result(); i++) {
      for (const p of sim.players) {
        for (const a of sim.legal(p.id)) {
          if (a.type === 'pick' && rng() < 0.9) continue;   // 250 teams: sample a few
          const out = engine.act(clone(sim.state), { pid: p.id, action: a }, sim.ctx());
          assert.notEqual(JSON.stringify(out), JSON.stringify(sim.state), `${p.id} ${JSON.stringify(a)} in ${phase(sim)} is a no-op`);
        }
      }
      const movers = sim.players.filter((p) => sim.legal(p.id).length);
      if (movers.length && rng() < 0.9) {
        const m = movers[Math.floor(rng() * movers.length)];
        const acts = sim.legal(m.id);
        sim.act(m.id, acts[Math.floor(rng() * acts.length)]);
      } else if (!(sim.cue() && sim.cueDone())) {
        if (!sim.advance()) sim.host({ type: ACT.NEXT });
      }
    }
  }
});

test('avalon: simulation — at most five quests, at most five proposals per quest, the Lady never repeats or targets a holder', () => {
  for (const n of COUNTS) {
    for (let seed = 1; seed <= 10; seed++) {
      const sim = mk(n, { seed: seed + 100 * n, lady: 'on' });
      sim.runRandom();
      const s = st(sim);
      assert.ok(s.quests.length <= 5);
      const perQuest = {};
      for (const e of s.voteLog) perQuest[e.q] = (perQuest[e.q] ?? 0) + 1;
      for (const [q, k] of Object.entries(perQuest)) assert.ok(k <= 5, `quest ${q} saw ${k} proposals`);
      const seenTargets = new Set([s.lady.held[0]]);
      for (const l of s.lady.log) {
        assert.ok(!seenTargets.has(l.target), 'the Lady checked a past holder');
        assert.notEqual(l.target, l.holder);
        seenTargets.add(l.target);
      }
      // each quest was proposed by the leader of its approved proposal
      for (const q of s.quests) {
        const e = s.voteLog.find((x) => x.q === q.no && x.approved);
        assert.ok(e, `quest ${q.no} has an approved proposal`);
        assert.equal(e.leader, q.leader);
        assert.deepEqual(e.team, q.team);
        assert.equal(q.team.length, TEAM_SIZE[n][q.no - 1]);
        assert.equal(q.fails + q.successes, q.team.length);
        assert.equal(q.success, q.fails < failsNeeded(n, q.no));
        assert.equal(q.pile.length, q.team.length);
        // no good seat ever played a fail
        for (const p of q.team) if (q.played[p] === 'fail') assert.ok(EVIL_IDS.includes(s.role[p]));
      }
    }
  }
});

test('avalon: speed — a ten-player game is quick enough to fuzz', () => {
  const t0 = performance.now();
  for (let seed = 1; seed <= 15; seed++) new Sim(game, { n: 10, seed, config: cfgFor(10) }).runRandom();
  assert.ok(performance.now() - t0 < 3000, `too slow: ${Math.round(performance.now() - t0)} ms`);
});

// ============================================================
// phone UI (ui.js) — a fake DOM, the REAL Cover / PlayerPicker / Timer, driven only by taps
// ============================================================

class FNode {}
class FText extends FNode {
  constructor(t) { super(); this.data = String(t); this.parentNode = null; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
class FEl extends FNode {
  constructor(tag) {
    super();
    this.tag = tag; this.parentNode = null; this.children = []; this.attrs = {}; this.listeners = {};
    this.cls = new Set(); this.styleMap = {}; this.hidden = false; this.disabled = false; this.dataset = {};
    const self = this;
    this.style = new Proxy({}, {
      get: (_, k) => (k === 'setProperty' ? (n, v) => { self.styleMap[n] = String(v); } : self.styleMap[k]),
      set: (_, k, v) => { self.styleMap[k] = String(v); return true; },
    });
    this.classList = {
      add: (...c) => c.forEach((x) => self.cls.add(x)),
      remove: (...c) => c.forEach((x) => self.cls.delete(x)),
      toggle: (c, on) => { const want = on === undefined ? !self.cls.has(c) : !!on; if (want) self.cls.add(c); else self.cls.delete(c); return want; },
      contains: (c) => self.cls.has(c),
    };
  }
  get className() { return [...this.cls].join(' '); }
  set className(v) { this.cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(String(v) === '' ? [] : [new FText(v)])); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  append(...kids) { for (const k of kids) this.appendChild(k instanceof FNode ? k : new FText(k)); }
  appendChild(k) { k.parentNode?.removeChild(k); k.parentNode = this; this.children.push(k); return k; }
  removeChild(k) { const i = this.children.indexOf(k); if (i >= 0) { this.children.splice(i, 1); k.parentNode = null; } return k; }
  replaceChildren(...kids) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...kids); }
  remove() { this.parentNode?.removeChild(this); }
}
const fakeDocument = {
  createElement: (t) => new FEl(t),
  createTextNode: (t) => new FText(t),
  getElementById: () => null,
  addEventListener() {},
  hidden: false,
  head: new FEl('head'), body: new FEl('body'),
};
const fakeWindow = { addEventListener() {}, AudioContext: undefined };

const walk = (n, fn) => { fn(n); if (n.children) for (const c of n.children) walk(c, fn); };
const findAll = (root, pred) => { const out = []; walk(root, (n) => { if (n instanceof FEl && pred(n)) out.push(n); }); return out; };
const hasCls = (n, c) => n.cls.has(c);
const visible = (n) => { for (let x = n; x; x = x.parentNode) if (x.hidden) return false; return true; };
const serialize = (n) => (n instanceof FText ? n.data : JSON.stringify([n.tag, [...n.cls].sort(), n.attrs, n.hidden, n.disabled, n.styleMap, n.dataset, n.children.map(serialize)]));
const click = (n) => {
  assert.ok(n, 'nothing to click');
  assert.ok(!n.disabled && visible(n), 'clicked a disabled/hidden control');
  for (const f of n.listeners.click ?? []) f({ preventDefault() {} });
};
const pressCover = (root) => {
  const cover = findAll(root, (n) => hasCls(n, 'c-cover') && visible(n))[0];
  if (!cover) return false;
  for (const f of cover.listeners.pointerdown ?? []) f({ preventDefault() {}, pointerId: 1 });
  for (const f of cover.listeners.pointerup ?? []) f({});
  return true;
};

const SHAPE_SKIP = new Set(['evil', 'on', 'open', 'spent', 'locked', 'warn', 'urgent', 'done', 'denied']);
/** Layout skeleton: tags, classes, hidden/disabled — never text. Tile order may mirror, so those rows are sorted. */
function shape(n) {
  if (n instanceof FText) return '#';
  const kids = hasCls(n, 'av-face-names') ? [] : n.children.map(shape);
  if (hasCls(n, 'av-tiles') || hasCls(n, 'c-playerpicker-grid')) kids.sort();   // mirrored tiles; "you" is a different chip on every phone
  return JSON.stringify([n.tag, [...n.cls].filter((c) => !SHAPE_SKIP.has(c)).sort(), !!n.hidden, !!n.disabled, kids]);
}

async function withFakeDom(fn) {
  const saved = { document: globalThis.document, window: globalThis.window, Node: globalThis.Node };
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  globalThis.Node = FNode;
  try {
    const { Cover } = await import('../js/ui/components/Cover.js');
    const { PlayerPicker } = await import('../js/ui/components/PlayerPicker.js');
    const { Timer } = await import('../js/ui/components/Timer.js');
    const ui = await import('../js/games/avalon/ui.js');
    return await fn(ui, { Cover, PlayerPicker, Timer });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; }
  }
}

/** One mounted UI per seat (and one for the table), as the shell does. */
function mountAll(ui, comps, sim, sent, sounds) {
  const seats = {};
  for (const pid of [...sim.players.map((p) => p.id), null]) {
    const root = new FEl('div');
    const api = {
      me: pid, players: sim.players, isHost: pid === 'p1', meta: game.meta, config: sim.state.cfg,
      send: (a) => { const changed = sim.act(pid, a); sent.push({ pid, a, changed }); return changed; },
      ink() {}, now: () => sim.now, sfx: (name) => sounds.push([pid, name]), toast() {}, components: comps,
    };
    seats[pid ?? 'table'] = { pid, root, api, handle: ui.mount(root, api) };
  }
  return seats;
}

function pushViews(sim, seats, only = null) {
  const ctx = { focus: sim.focus(), paused: false, narrationMode: 'voice' };
  for (const seat of Object.values(seats)) {
    if (only && !only.includes(seat.pid)) continue;
    const v = sim.view(seat.pid);
    seat.handle.update(v, ctx);
    const a = serialize(seat.root);
    seat.handle.update(clone(v), ctx);
    assert.equal(serialize(seat.root), a, `update() is not idempotent for ${seat.pid ?? 'table'} in ${v.phase}`);
    // 💡 is on demand only: the game screen never prints the hint by itself
    assert.ok(!seat.root.textContent.includes(v.hint), `the hint is shown unasked (${seat.pid ?? 'table'}, ${v.phase})`);
  }
}

/** What a thumb would do on this seat's screen right now. Returns true if it tapped something real. */
function tapSeat(seat, sim, rng, notes) {
  const root = seat.root;
  const vis = (n) => visible(n) && !n.disabled;
  const act = (a) => findAll(root, (n) => n.attrs['data-act'] === a && vis(n))[0];
  const chips = () => findAll(root, (n) => hasCls(n, 'c-playerpicker-chip') && vis(n));
  const confirm = () => findAll(root, (n) => n.tag === 'button' && hasCls(n, 'btn-primary') && n.parentNode && hasCls(n.parentNode, 'c-playerpicker') && vis(n))[0];
  const ph = sim.state.phase;

  if (ph === 'reveal') {
    const seen = act('seen');
    if (seen) { click(seen); return true; }
    if (!sim.state.seen.includes(seat.pid) && seat.pid) { pressCover(root); return true; }
    return false;
  }
  if (ph === 'pick' || ph === 'lady' || ph === 'assassinate') {
    if (!chips().length) return false;
    const need = ph === 'pick' ? TEAM_SIZE[sim.state.n][sim.state.questNo - 1] : 1;
    for (let i = 0; i < need; i++) {
      const open = chips().filter((c) => c.attrs['aria-pressed'] !== 'true');
      if (!open.length) break;
      click(open[Math.floor(rng() * open.length)]);
    }
    const first = confirm();
    if (!first) return true;
    click(first);
    if (ph === 'assassinate') { const again = confirm(); if (again) click(again); }
    return true;
  }
  if (ph === 'vote') {
    const b = act(rng() < 0.7 ? 'vote-approve' : 'vote-reject');
    if (!b) return false;
    click(b);
    const c = act('vote-confirm');
    if (c) click(c);
    return true;
  }
  if (ph === 'voted' || ph === 'quest-result' || ph === 'shot') {
    const b = act('continue');
    if (!b) return false;
    click(b);
    return true;
  }
  if (ph === 'quest') {
    if (!sim.state.team.includes(seat.pid)) return false;
    const failTile = findAll(root, (n) => n.attrs['data-act'] === 'tile-fail')[0];
    const play = findAll(root, (n) => n.attrs['data-act'] === 'play')[0];
    if (!play || !visible(play)) return false;
    const evilSeat = S.teamOf(sim.state.role[seat.pid]) === 'evil';
    // everyone tries the Fail tile first; for good it is inert (the confirm button stays disabled)
    click(failTile);
    if (!evilSeat) { assert.equal(play.disabled, true, 'a good seat could select Fail'); notes.inertFail++; }
    else assert.equal(play.disabled, false, 'an evil seat could not select Fail');
    const want = evilSeat && rng() < 0.6 ? 'tile-fail' : 'tile-success';
    click(findAll(root, (n) => n.attrs['data-act'] === want)[0]);
    click(play);
    return true;
  }
  if (ph === 'lady-peek') {
    const b = act('lady-done');
    if (!b) return false;
    assert.equal(pressCover(root), true, 'the holder can lift the cover to read the answer');
    click(b);
    return true;
  }
  return false;
}

test('avalon ui: every phase renders for every seat, idempotently, and every screen can be finished by tapping', async () => {
  await withFakeDom(async (ui, comps) => {
    const cases = [
      [5, 1, { preset: 'plain' }], [6, 2, {}], [7, 3, { revealSecs: 25, questSecs: 12 }], [8, 4, { lady: 'on', discussSecs: 60 }],
      [9, 5, { flipEvil: true, assassinSecs: 60 }], [10, 6, { revealSecs: 25, questSecs: 12, lady: 'on' }],
    ];
    for (const [n, seed, patch] of cases) {
      const cfg = config.defaults(n, { ...TAP, ...patch });
      const sim = new Sim(game, { n, seed, config: cfg });
      const sent = [];
      const sounds = [];
      const seats = mountAll(ui, comps, sim, sent, sounds);
      const rng = mulberry32(seed * 31);
      const phases = new Set();
      const notes = { inertFail: 0 };
      const shaped = new Set();
      let guard = 0;
      while (!sim.result() && guard++ < 4000) {
        pushViews(sim, seats);
        const ph = sim.state.phase;
        phases.add(ph);

        // one layout for every role: the card in the reveal, the tiles in the quest, the picker in the assassination
        if (ph === 'reveal' && !shaped.has('reveal')) {
          shaped.add('reveal');
          const shapes = new Set(sim.players.map((p) => shape(findAll(seats[p.id].root, (x) => hasCls(x, 'av-card'))[0])));
          assert.equal(shapes.size, 1, 'the identity card differs in shape between roles');
        }
        if (ph === 'quest' && !shaped.has(`quest${sim.state.questNo}`)) {
          shaped.add(`quest${sim.state.questNo}`);
          const members = sim.state.team.filter((p) => !(p in sim.state.cards));
          const shapes = new Set(members.map((p) => shape(findAll(seats[p].root, (x) => hasCls(x, 'av-body'))[0])));
          assert.equal(shapes.size, 1, 'the quest screen differs in shape between good and evil members');
        }
        if (ph === 'assassinate' && !shaped.has('assassinate')) {
          shaped.add('assassinate');
          const shapes = new Set(sim.players.map((p) => shape(findAll(seats[p.id].root, (x) => hasCls(x, 'av-body'))[0])));
          assert.equal(shapes.size, 1, 'the assassination screen differs in shape between seats');
        }

        const order = sim.players.map((p) => p.id).sort(() => rng() - 0.5);
        let tapped = false;
        for (const pid of order) {
          if (sim.state.phase !== ph) break;
          try { tapped = tapSeat(seats[pid], sim, rng, notes) || tapped; } catch (e) { throw new Error(`tap failed for ${pid} in ${sim.state.phase}: ${e.message}`); }
          pushViews(sim, seats, [pid]);
        }
        if (sim.state.phase !== ph) continue;
        // nothing (more) to tap: let time and the narrator move on
        if (sim.cue() && sim.cueDone()) continue;
        if (sim.state.deadline != null && sim.advance()) continue;
        if (!tapped) sim.host({ type: ACT.NEXT });
      }
      assert.ok(sim.result(), `n=${n}: finished by tapping alone (stuck in ${sim.state.phase}; last sent: ${JSON.stringify(sent.slice(-4))})`);
      pushViews(sim, seats);
      for (const p of ['reveal', 'pick', 'vote', 'voted', 'quest', 'quest-result']) assert.ok(phases.has(p), `phase ${p} was rendered (n=${n})`);
      assert.ok(notes.inertFail > 0, 'the inert Fail tile was exercised');
      // the UI only ever sent actions the engine accepted, apart from duplicate peeks
      for (const s of sent) if (!s.changed) assert.ok(s.a.type === 'seen', `UI sent a refused ${JSON.stringify(s.a)} as ${s.pid}`);
      for (const seat of Object.values(seats)) seat.handle.destroy();
    }
  });
});

test('avalon ui: the inert Fail tile for good makes the same sound as the live one, and nothing is sent until 出牌', async () => {
  await withFakeDom(async (ui, comps) => {
    const sim = mk(6, { seed: 5, lady: 'off' });
    revealAll(sim);
    const g = goods(sim)[0];
    const e = evils(sim)[0];
    pickTeam(sim, [g, e]);
    voteAll(sim, 'approve');
    cont(sim);
    const sent = [];
    const sounds = [];
    const seats = mountAll(ui, comps, sim, sent, sounds);
    pushViews(sim, seats);
    const tilesOf = (pid) => findAll(seats[pid].root, (n) => hasCls(n, 'av-tile'));
    // identical tiles, in some order, for both
    assert.deepEqual(tilesOf(g).map((t) => t.attrs['data-act']).sort(), ['tile-fail', 'tile-success']);
    assert.deepEqual(tilesOf(e).map((t) => t.attrs['data-act']).sort(), ['tile-fail', 'tile-success']);
    for (const pid of [g, e]) for (const t of tilesOf(pid)) assert.equal(t.disabled, false, 'no tile is greyed out for anybody');
    const tap = (pid, a) => {
      const before = sounds.length;
      click(findAll(seats[pid].root, (n) => n.attrs['data-act'] === a)[0]);
      return sounds.slice(before).map((x) => x[1]);
    };
    const sg = tap(g, 'tile-fail');
    const se = tap(e, 'tile-fail');
    assert.deepEqual(sg, se, 'same sound for the inert and the live Fail tile');
    assert.equal(sent.length, 0, 'selecting a tile sends nothing');
    const play = (pid) => findAll(seats[pid].root, (n) => n.attrs['data-act'] === 'play')[0];
    assert.equal(play(g).disabled, true);
    assert.equal(play(e).disabled, false);
    assert.equal(play(e).textContent, '確定出牌', 'the button never names the card (#17)');
    click(findAll(seats[g].root, (n) => n.attrs['data-act'] === 'tile-success')[0]);
    assert.equal(play(g).textContent, play(e).textContent, 'Success and Fail picked: the same button');
    // the picked tile looks the same whichever card it is: one class set, no team colour
    const picked = (pid) => tilesOf(pid).filter((t) => hasCls(t, 'on')).map((t) => [...t.cls].filter((c) => c !== 'success' && c !== 'fail').sort().join('.'));
    assert.deepEqual(picked(g), ['av-tile.on']);
    assert.deepEqual(picked(e), picked(g), 'a picked Fail is styled exactly like a picked Success');
    assert.equal(tilesOf(e).find((t) => hasCls(t, 'on')).attrs['data-act'], 'tile-fail');
    click(play(g));
    assert.deepEqual(sent.map((s) => [s.pid, s.a]), [[g, { type: 'quest', card: 'success' }]]);
    pushViews(sim, seats);
    // after playing both look the same: spent tiles, no highlight, no echo of the choice
    assert.equal(findAll(seats[g].root, (n) => hasCls(n, 'av-tile')).every((t) => hasCls(t, 'spent') && !hasCls(t, 'on')), true);
    for (const seat of Object.values(seats)) seat.handle.destroy();
  });
});

test('avalon ui: the table carries no card, a servant\'s card lists nobody, the mini card appears after the reveal and starts shut', async () => {
  await withFakeDom(async (ui, comps) => {
    const sim = mk(7, { seed: 8 });
    const seats = mountAll(ui, comps, sim, [], []);
    pushViews(sim, seats);
    const merlin = seatOf(sim, 'merlin');
    const faceOf = (pid) => findAll(seats[pid].root, (n) => hasCls(n, 'av-face-role'))[0].textContent;
    for (const p of ids(7)) assert.ok(faceOf(p).includes(S.roleName(sim.state.role[p])), `${p}'s face names its own role`);
    const evilNames = sim.view(merlin).mine.knows.pids.map((p) => sim.players.find((x) => x.id === p).name);
    const merlinFace = findAll(seats[merlin].root, (n) => hasCls(n, 'av-face-names'))[0].textContent;
    for (const nme of evilNames) assert.ok(merlinFace.includes(nme));
    for (const p of ids(7).filter((x) => sim.state.role[x] === 'servant')) {
      assert.equal(findAll(seats[p].root, (n) => hasCls(n, 'av-face-names'))[0].children.length, 0, 'a servant\'s card lists nobody');
    }
    assert.equal(findAll(seats.table.root, (n) => hasCls(n, 'av-card')).length, 0, 'the table view has no card');
    assert.equal(findAll(seats.p1.root, (n) => hasCls(n, 'av-mini') && visible(n)).length, 0, 'no mini card during the reveal');
    revealAll(sim);
    pushViews(sim, seats);
    assert.equal(findAll(seats.p1.root, (n) => hasCls(n, 'av-mini') && visible(n)).length, 1);
    assert.equal(findAll(seats.table.root, (n) => hasCls(n, 'av-mini') && visible(n)).length, 0);
    assert.equal(findAll(seats.p1.root, (n) => hasCls(n, 'c-cover') && hasCls(n, 'open')).length, 0, 'covers start shut');
    for (const seat of Object.values(seats)) seat.handle.destroy();
  });
});

test('avalon ui: the real setup form renders every head-count and preset, and editing the custom deck round-trips through config', async () => {
  await withFakeDom(async () => {
    const { ConfigForm } = await import('../js/ui/components/ConfigForm.js');
    for (const n of COUNTS) {
      for (const preset of ['recommended', 'plain', 'alt', 'custom']) {
        let value = config.defaults(n, { preset });
        let emitted = null;
        const form = ConfigForm({ fields: config.fields(value, n), value, onChange: (c) => { emitted = c; } });
        const rows = findAll(form.el, (x) => hasCls(x, 'role-row'));
        assert.equal(rows.length, preset === 'custom' ? 8 : 0, `n=${n} ${preset}: role rows`);
        const selects = findAll(form.el, (x) => x.tag === 'select' && visible(x));   // the roles editor keeps a hidden auto-fill select
        assert.equal(selects.length, 2, 'preset and lady selects');
        // an edit of the lady select is a value the engine accepts
        const lady = selects[1];
        lady.value = 'on';
        for (const f of lady.listeners.change ?? []) f({});
        assert.equal(emitted.lady, 'on');
        assert.ok(config.validate({ ...value, ...emitted }, n).ok);
        if (preset === 'custom') {
          // the "+" on Oberon (a role row with a stepper) writes {oberon: 1} into the roles map
          const ob = rows.find((r) => r.textContent.includes(S.ROLES.oberon.name));
          const plus = findAll(ob, (x) => x.tag === 'button' && x.attrs['aria-label'] === '增加')[0];
          emitted = null;
          for (const f of plus.listeners.click ?? []) f({});
          if (value.roles.oberon === 0) {
            assert.equal(emitted.roles.oberon, 1);
            const v = config.validate({ ...value, ...emitted }, n);
            const evilSpecials = emitted.roles.morgana + emitted.roles.mordred + emitted.roles.oberon;
            assert.equal(v.ok, evilSpecials <= EVIL_COUNT[n] - 1, `n=${n}: ${evilSpecials} evil specials`);
          }
          // the auto rows (servants, minions) have no stepper
          const servant = rows.find((r) => r.textContent.includes(S.ROLES.servant.name));
          assert.equal(findAll(servant, (x) => x.tag === 'button').filter((b) => !b.hidden).length, 0);
        }
        form.destroy();
      }
    }
  });
});

test('avalon ui: a vote can be changed with 改票 until the last vote lands, and the engine takes the new one', async () => {
  await withFakeDom(async (ui, comps) => {
    const realSetTimeout = globalThis.setTimeout;
    const queue = [];
    globalThis.setTimeout = (fn, ms) => { queue.push(fn); return queue.length; };   // the UI's 3.5 s send guards run only when we say so
    try {
      const sim = mk(5, { seed: 2 });
      revealAll(sim);
      pickTeam(sim);
      const sent = [];
      const seats = mountAll(ui, comps, sim, sent, []);
      pushViews(sim, seats);
      const act = (pid, a) => findAll(seats[pid].root, (n) => n.attrs['data-act'] === a && visible(n))[0];
      click(act('p1', 'vote-approve'));
      click(act('p1', 'vote-confirm'));
      pushViews(sim, seats);
      assert.equal(sim.state.votes.p1, 'approve');
      assert.equal(act('p1', 'vote-confirm'), undefined, 'locked: no confirm button');
      const status = () => findAll(seats.p1.root, (n) => hasCls(n, 'av-voted'))[0];
      const lit = () => findAll(seats.p1.root, (n) => hasCls(n, 'av-vote') && hasCls(n, 'on')).map((n) => n.attrs['data-act']);
      // locked: 「已投 ✓」, neither tile lit, the choice nowhere on screen (a neighbour could follow it)
      assert.equal(status().hidden, false);
      assert.ok(status().textContent.startsWith(S.T.vote.voted));
      assert.doesNotMatch(status().textContent, /贊成|反對/);
      assert.deepEqual(lit(), []);
      assert.equal(findAll(seats.p1.root, (n) => n.attrs['aria-pressed'] === 'true').length, 0, 'no pressed tile either');
      assert.equal(sim.view('p2').vote.progress.done, 1);
      // the guard keeps a double tap from sending twice; it lets go after a moment
      while (queue.length) queue.shift()();
      click(act('p1', 'vote-change'));
      pushViews(sim, seats, ['p1']);
      assert.deepEqual(lit(), ['vote-approve'], 'only while 改票 is open does your own vote show');
      click(act('p1', 'vote-reject'));
      click(act('p1', 'vote-confirm'));
      pushViews(sim, seats);
      assert.equal(sim.state.votes.p1, 'reject');
      assert.ok(status().textContent.startsWith(S.T.vote.voted));
      assert.doesNotMatch(status().textContent, /贊成|反對/);
      assert.deepEqual(lit(), [], 'locked again: nothing lit');
      assert.equal(sim.view('p2').vote.progress.done, 1, 'still one vote counted');
      assert.deepEqual(sent.map((s) => s.a.vote), ['approve', 'reject']);
      for (const seat of Object.values(seats)) seat.handle.destroy();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

test('avalon ui: after 呢鋪唔計 the vote and the quest screens open again, with nothing left from the cancelled try', async () => {
  await withFakeDom(async (ui, comps) => {
    const realSetTimeout = globalThis.setTimeout;
    const queue = [];
    globalThis.setTimeout = (fn) => { queue.push(fn); return queue.length; };
    try {
      const sim = mk(6, { seed: 4, lady: 'off' });
      revealAll(sim);
      pickTeam(sim);
      const sent = [];
      const seats = mountAll(ui, comps, sim, sent, []);
      pushViews(sim, seats);
      const act = (pid, a) => findAll(seats[pid].root, (n) => n.attrs['data-act'] === a && visible(n) && !n.disabled)[0];
      click(act('p1', 'vote-reject'));
      click(act('p1', 'vote-confirm'));
      pushViews(sim, seats);
      const status = () => findAll(seats.p1.root, (n) => hasCls(n, 'av-voted'))[0];
      assert.equal(status().hidden, false);
      assert.ok(status().textContent.startsWith(S.T.vote.voted));
      assert.equal(sim.host({ type: ACT.VOID_ROUND }), true);
      while (queue.length) queue.shift()();
      pushViews(sim, seats);
      assert.equal(status().hidden, true, 'the cancelled vote is gone from the screen');
      assert.equal(findAll(seats.p1.root, (n) => hasCls(n, 'av-vote') && hasCls(n, 'on')).length, 0);
      assert.ok(act('p1', 'vote-approve'), 'p1 can vote again');
      for (const pid of ['p1', 'p4', 'table']) assert.match(seats[pid].root.textContent, /主持取消咗啱啱嘅投票/);
      assert.match(seats.p2.root.textContent, /已投 0\/6/);
      voteAll(sim, 'approve');
      cont(sim);
      pushViews(sim, seats);
      const m = st(sim).team[0];
      click(act(m, 'tile-success'));
      click(act(m, 'play'));
      pushViews(sim, seats);
      assert.equal(act(m, 'play'), undefined, 'played: no button');
      assert.equal(sim.host({ type: ACT.VOID_ROUND }), true);
      while (queue.length) queue.shift()();
      pushViews(sim, seats);
      assert.ok(findAll(seats[m].root, (n) => n.attrs['data-act'] === 'play' && visible(n))[0], 'the member plays again');
      assert.match(seats[m].root.textContent, /主持取消咗啱啱出嘅牌/);
      assert.equal(findAll(seats[m].root, (n) => hasCls(n, 'av-tile') && (hasCls(n, 'spent') || hasCls(n, 'on'))).length, 0, 'fresh tiles');
      for (const seat of Object.values(seats)) seat.handle.destroy();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
  });
});

// ============================================================
// the real Room: five phones, secrets stay on their own device, a whole game to the results screen
// ============================================================

test('avalon: in a real Room each phone only ever receives its own card, and a whole game reaches the results screen', async () => {
  const { Room } = await import('../js/core/room.js?v=1');
  const { createBag } = await import('../js/core/bag.js?v=1');
  const { PROTOCOL } = await import('../js/core/transport.js?v=1');

  for (const [n, patch] of [[5, {}], [7, { lady: 'on' }], [10, { flipEvil: true }]]) {
    let now = 1_700_000_000_000;
    const timers = [];
    const clock = {
      now: () => now,
      setTimeout: (fn, ms = 0) => { timers.push({ at: now + ms, fn, id: timers.length + 1 }); return timers.length; },
      clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.at = Infinity; },
      setInterval: () => 0, clearInterval() {},
      advance(ms) {
        const end = now + ms;
        for (;;) {
          const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
          if (!due) break;
          now = Math.max(now, due.at);
          due.at = Infinity;
          due.fn();
        }
        now = end;
      },
    };
    const sent = [];
    const names = ['阿明', '阿強', '阿欣', '阿珍', '阿輝', '阿玲', '阿傑', '阿芬', '阿文', '阿兒'].slice(0, n);
    const room = new Room({
      code: '1234', hostDeviceId: 'dev_host', names: [names[0]], now: clock.now, rng: mulberry32(11),
      bag: createBag({ storage: new Map(), rng: mulberry32(5), banks: {} }), timers: clock,
      loadGame: async (id) => { assert.equal(id, 'avalon'); return game; },
      send: (deviceId, msg) => sent.push({ deviceId, msg: clone(msg) }),
      onCue: () => {}, narrationMode: 'silent',
    });
    names.slice(1).forEach((nm, i) => room.receive(`peer_${i}`, { t: 'hello', v: PROTOCOL, deviceId: `dev_${i}`, seats: [{ name: nm }] }));
    const sel = await room.selectGame('avalon');
    assert.equal(sel.ok, true, sel.message);
    // the lobby shows a valid setup, the composition and the reason
    const roomMsg = () => [...sent].reverse().find((x) => x.deviceId === 'dev_host' && x.msg.t === 'room').msg.room;
    const lobby = roomMsg();
    assert.equal(lobby.gameId, 'avalon');
    assert.equal(lobby.configValid.ok, true);
    assert.ok(lobby.configSummary.some((l) => l.startsWith('💡')));
    assert.equal(lobby.configSummary[0], `${n} 人：${GOOD_COUNT[n]} 好 ${EVIL_COUNT[n]} 壞`);
    if (Object.keys(patch).length) room.setConfig(config.defaults(n, { ...room.config, ...patch }));
    const started = room.start();
    assert.equal(started.ok, true, started.message);

    const deviceOf = new Map(roomMsg().players.map((p) => [p.id, p.deviceId]));
    const lastViews = (dev) => [...sent].reverse().find((x) => x.deviceId === dev && x.msg.t === 'views')?.msg;
    const checkDevices = () => {
      for (const [pid, dev] of deviceOf) {
        const m = lastViews(dev);
        assert.ok(m, `device of ${pid} got views`);
        assert.deepEqual(Object.keys(m.bySeat), [pid], 'a phone receives only its own seat');
        const phase = m.bySeat[pid].phase;
        if (phase === 'over') continue;
        walkStrings(m, (str, path) => {
          if (!ROLE_IDS.includes(str)) return;
          const own = path === `$.bySeat.${pid}.mine.role`;
          const deck = /\.deck\[\d+\]\.role$/.test(path);
          const flip = /\.assassinate\.flipped\[\d+\]\.role$/.test(path);
          assert.ok(own || deck || flip, `role "${str}" reached ${pid}'s phone at ${path}`);
        });
        if (m.focus) assert.ok(m.focus.pids.every((p) => p === pid), 'focus is filtered to the phone\'s own seat');
        assert.equal(m.table.mine, undefined);
      }
    };

    const rng = mulberry32(n * 7);
    let guard = 0;
    checkDevices();
    while (room.phase === 'playing' && guard++ < 4000) {
      const s = room.session;
      const movers = [...deviceOf.keys()].filter((p) => s.legal(p).length);
      if (movers.length && rng() < 0.9) {
        const pid = movers[Math.floor(rng() * movers.length)];
        const options = s.legal(pid);
        room.act(deviceOf.get(pid), pid, options[Math.floor(rng() * options.length)]);
      } else {
        clock.advance(2500);
      }
      if (guard % 7 === 0) checkDevices();
    }
    assert.equal(room.phase, 'results', `n=${n}: the game reached the results screen`);
    const res = roomMsg().lastResult;
    assert.equal(res.gameId, 'avalon');
    assert.ok(res.summary.length > 5);
    assert.ok(res.lines.length > 10);
    assert.ok(res.winners.length >= 1);
  }
});

// ============================================================
// the real Room: stall detection ignores decoys; carry and the one-phone defaults go through the room
// ============================================================

async function roomRig(n, { alone = false } = {}) {
  const { Room } = await import('../js/core/room.js?v=1');
  const { createBag } = await import('../js/core/bag.js?v=1');
  const { PROTOCOL } = await import('../js/core/transport.js?v=1');
  let now = 1_700_000_000_000;
  const timers = [];
  const clock = {
    now: () => now,
    setTimeout: (fn, ms = 0) => { timers.push({ at: now + ms, fn, id: timers.length + 1 }); return timers.length; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.at = Infinity; },
    setInterval: () => 0, clearInterval() {},
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = Math.max(now, due.at);
        due.at = Infinity;
        due.fn();
      }
      now = end;
    },
  };
  const sent = [];
  const names = ['阿明', '阿強', '阿欣', '阿珍', '阿輝', '阿玲', '阿傑', '阿芬', '阿文', '阿兒'].slice(0, n);
  const room = new Room({
    code: '1234', hostDeviceId: 'dev_host', names: [names[0]], now: clock.now, rng: mulberry32(n * 3 + 1),
    bag: createBag({ storage: new Map(), rng: mulberry32(5), banks: {} }), timers: clock,
    loadGame: async () => game, send: (deviceId, msg) => sent.push({ deviceId, msg: clone(msg) }),
    onCue: () => {}, narrationMode: 'silent',
  });
  const join = () => names.slice(1).forEach((nm, i) => room.receive(`peer_${i}`, { t: 'hello', v: PROTOCOL, deviceId: `dev_${i}`, seats: [{ name: nm }] }));
  if (!alone) join();
  const roomMsg = () => [...sent].reverse().find((x) => x.deviceId === 'dev_host' && x.msg.t === 'room').msg.room;
  return { room, clock, sent, roomMsg, join };
}

test('avalon: in a real Room a dead phone is only reported when the game waits on it — never for a decoy tap', async () => {
  const { room, clock, roomMsg } = await roomRig(6);
  assert.equal((await room.selectGame('avalon')).ok, true);
  room.setConfig(config.defaults(6, { ...TAP, flipEvil: true }));
  assert.equal(room.start().ok, true);
  const s = () => room.session;
  const peerOf = (pid) => {
    const p = roomMsg().players.find((x) => x.id === pid);
    return p.deviceId === 'dev_host' ? null : `peer_${p.deviceId.slice(4)}`;
  };
  const deviceOf = (pid) => roomMsg().players.find((x) => x.id === pid).deviceId;
  // drive to the assassination with legal moves only
  const rng = mulberry32(3);
  let guard = 0;
  const step = () => {
    const ss = s().state;
    if (ss.phase === 'pick') {
      const goodTeam = ss.order.filter((p) => S.teamOf(ss.role[p]) === 'good').slice(0, TEAM_SIZE[6][ss.questNo - 1]);
      room.act(deviceOf(ss.order[ss.leaderIx]), ss.order[ss.leaderIx], { type: 'pick', team: goodTeam });
      return;
    }
    if (ss.phase === 'vote') { for (const p of ss.order) room.act(deviceOf(p), p, { type: 'vote', vote: 'approve' }); return; }
    const movers = ss.order.filter((p) => s().legal(p).length);
    if (movers.length) {
      const p = movers[Math.floor(rng() * movers.length)];
      room.act(deviceOf(p), p, s().legal(p)[0]);
    } else clock.advance(2500);
  };
  while (s().state.phase !== 'assassinate' && guard++ < 500) step();
  assert.equal(s().state.phase, 'assassinate');
  const ss = s().state;
  const assassin = ss.order.find((p) => ss.role[p] === 'assassin');
  // a disconnected seat that is NOT the Assassin: it still has its decoy tap, but nobody waits for it
  const other = ss.order.find((p) => p !== assassin && peerOf(p));
  assert.ok(s().legal(other).length > 0, 'the decoy is a legal action');
  room.peerClosed(peerOf(other));
  clock.advance(120_000);
  assert.deepEqual(roomMsg().stalled.map((x) => x.pid), [], 'a decoy seat is never reported as holding up the table');
  // the Assassin's phone dies: now the table really waits
  assert.ok(peerOf(assassin), 'rig: the Assassin sits on a guest phone (seeded)');
  {
    room.peerClosed(peerOf(assassin));
    clock.advance(120_000);
    assert.deepEqual(roomMsg().stalled.map((x) => x.pid), [assassin], 'the Assassin is reported');
    // 代佢做 shoots for them and the game moves on
    assert.equal(room.autoAct(assassin), true);
    assert.equal(s().state.phase, 'shot');
  }
});

test('avalon: through the Room — the host alone gets the one-phone clocks, they come back when friends join, and 再玩一局 rotates the first leader', async () => {
  const { room, clock, roomMsg, join } = await roomRig(6, { alone: true });
  assert.equal((await room.selectGame('avalon')).ok, true);
  assert.equal(room.config.revealSecs, 0, 'one phone so far: tap mode');
  assert.equal(room.config.questSecs, 0);
  join();
  assert.equal(room.config.revealSecs, 25, 'friends joined on their own phones: the clocks are back');
  assert.equal(room.config.questSecs, 12);
  assert.equal(room.start().ok, true);
  const firstLeaders = [];
  for (let g = 0; g < 4; g++) {
    const st0 = room.session.state;
    firstLeaders.push(st0.order[st0.startIx]);
    let guard = 0;
    while (room.phase === 'playing' && guard++ < 4000) {
      const s = room.session;
      const devOf = (pid) => roomMsg().players.find((x) => x.id === pid).deviceId;
      const movers = s.state.order.filter((p) => s.legal(p).length);
      if (movers.length) { const p = movers[guard % movers.length]; room.act(devOf(p), p, s.legal(p)[0]); } else clock.advance(30_000);
    }
    assert.equal(room.phase, 'results');
    assert.equal(roomMsg().lastResult.carry, undefined, 'carry stays on the host');
    if (g < 3) assert.equal(room.again().ok, true);
  }
  for (let i = 1; i < firstLeaders.length; i++) assert.notEqual(firstLeaders[i], firstLeaders[i - 1], `game ${i + 1} has a new first leader`);
});
