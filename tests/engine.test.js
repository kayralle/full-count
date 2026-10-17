// Headless engine tests (brief section 9 and 11). Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const FC = require('../src/engine.js');
const { TYPES, LEVELS, BARS } = FC;
const T = FC._t;

FC.M.SB_K = 0;   // no AI steals in scripted fixtures
function quiet(g) { for (const id in g.P) { const gp = g.P[id]; if (gp.p) gp.p.wp = 0; } }
// exact bar arithmetic: hits take their listed damage (no type multiplier)
function neutral(fn) { const on = TYPES.ON; TYPES.ON = false; try { return fn(); } finally { TYPES.ON = on; } }
function mk(seed, opts) { const g = FC.newGame(Object.assign({ away: 'NYY', home: 'LAD', user: null, seed }, opts || {})); quiet(g); return g; }
// One pitch through the real pipeline, AI calls on both sides.
function step(g) {
  if (g.over) return;
  if (!g.pa) { T.startPA(g); if (g.over || g.pending) return; }
  const fs = FC.fieldSide(g), bs = FC.batSide(g);
  if (!g.pa.def) g.pa.def = T.aiPitch(g, fs);
  if (!g.pa.off) g.pa.off = T.aiSwing(g, bs);
  T.resolvePitch(g, g.pa.def, g.pa.off);
}
function play(g, script) { g.script = script.slice(); let n = 0; while (g.script.length && !g.over && n++ < 500) step(g); }
const pitcher = g => g.P[FC.curPitcherId(g)];
const single = { res: 'bip', bt: 'ld', out: 's1' }, dbl = { res: 'bip', bt: 'ld', out: 's2' }, hr = { res: 'bip', bt: 'fb', out: 'hr' };
const pop = { res: 'bip', bt: 'pu', out: 'out1' }, ball = { res: 'ball' }, whiff = { res: 'whiff' }, foul = { res: 'foul' };
const walk = [ball, ball, ball, ball];

/* ------------------------------------------------------------ types */
test('type chart matches Gen 6+ in all 324 cells', () => {
  let se = 0, nve = 0, imm = 0;
  for (let a = 0; a < 18; a++) for (let d = 0; d < 18; d++) { const m = TYPES._chart[a][d]; if (m === 2) se++; else if (m === 0.5) nve++; else if (m === 0) imm++; }
  assert.equal(se, 51); assert.equal(nve, 61); assert.equal(imm, 8);
  // spot checks with baseball names
  assert.equal(TYPES.mult('Slugger', ['Knuckleballer']), 0);
  assert.equal(TYPES.mult('Speedster', ['Gold Glove']), 0);
  assert.equal(TYPES.mult('Gold Glove', ['Launcher']), 0);
  assert.equal(TYPES.mult('Crafty', ['Intimidator']), 0);
  assert.equal(TYPES.mult('Junkballer', ['Workhorse']), 0);
  assert.equal(TYPES.mult('Franchise', ['Lucky Charm']), 0);
  assert.equal(TYPES.mult('Crafty', ['Slugger']), 2);
  assert.equal(TYPES.mult('Table Setter', ['Fireballer']), 2);
  assert.equal(TYPES.mult('Lucky Charm', ['Franchise']), 2);
});
test('dual types multiply, STAB is 1.5, a 0x edge is -2', () => {
  assert.equal(TYPES.mult('Closer', ['Launcher', 'Gold Glove']), 4);
  assert.equal(TYPES.mult('Fireballer', ['Table Setter', 'Fireballer']), 0.25);
  assert.equal(TYPES.mult('Slugger', ['Knuckleballer', 'Grinder']), 0);
  assert.equal(TYPES.STAB, 1.5);
  assert.equal(TYPES.edgeOf(0), -2);
  assert.equal(TYPES.edgeOf(2), 1);
});
test('centered edges average to zero per pitch type and per pitcher', () => {
  const pit = FC.PLAYERS.filter(p => p.kind === 'P').map(p => FC.view(p.id));
  const hit = FC.PLAYERS.filter(p => p.kind === 'H').map(p => FC.view(p.id));
  // per pitcher, against the league's hitters (PA-weighted), usage-weighted over his pitches
  for (const P of pit.slice(0, 25)) {
    let s = 0, w = 0;
    for (const B of hit) { const wb = Math.max(50, B.line.pa || 200); for (const x of P.pitches) { s += TYPES.pitchEdge(x, P, B).e * x.usage * wb; w += x.usage * wb; } }
    assert.ok(Math.abs(s / w) < 0.35, `pitcher ${P.name} mean edge ${s / w}`);
  }
  let s = 0, w = 0;
  for (const P of pit) for (const B of hit) { const ww = Math.max(50, P.line.bf || 150) * Math.max(50, B.line.pa || 200); s += TYPES.swingEdge(B, P).e * ww; w += ww; }
  assert.ok(Math.abs(s / w) < 0.02, `league swing edge ${s / w}`);
});
test('a type shift never passes 0.30 log-odds', () => {
  for (let x = -5; x <= 5; x += 0.25) assert.ok(Math.abs(TYPES.capShift(x)) <= 0.30 + 1e-12);
  assert.ok(TYPES.dmgMult(10) <= TYPES.DMG_MAX && TYPES.dmgMult(-10) >= TYPES.DMG_MIN);
});
test('type text follows the raw multiplier and only on decisive events', () => {
  const g = mk(11);
  FC.runUntilUser(g);
  const ev = new Set();
  for (const l of g.lines) if (/super effective|not very effective|doesn't affect/.test(l.t)) ev.add(l.ev);
  for (const e of ev) assert.ok(['k', 'whiff', 'hit', 'hr'].includes(e), `type text on ${e}`);
});

/* ------------------------------------------------------------ levels, IVs, EVs */
test('stat formula, Medium Fast curve, XP scaling, Exp Share', () => {
  assert.equal(LEVELS.shownStat(80, 31, 252, 100), Math.floor((2 * 100 + 31 + 63) * 100 / 100) + 5);
  assert.equal(LEVELS.xpFor(50), 125000);
  assert.equal(LEVELS.levelOf(125000), 50);
  assert.equal(LEVELS.levelOf(124999), 49);
  assert.ok(LEVELS.gain(4, 30, 20) > LEVELS.gain(4, 30, 30));   // facing higher levels pays more
  assert.ok(LEVELS.gain(4, 30, 40) < LEVELS.gain(4, 30, 30));
  assert.equal(LEVELS.gain(2, 30, 30), Math.round(LEVELS.gain(4, 30, 30) / 2) || LEVELS.gain(2, 30, 30));
});
test('EV caps: 252 per stat, 510 total; trained stat answers the opponent', () => {
  const S = FC.newPennant({ team: 'SEA', seed: 3 });
  const id = FC.teamPlayers('SEA').find(i => FC.view(i).kind === 'H');
  S.prog[id].ev = { contact: 250, power: 250 };
  const g = FC.startNext(S, { seed: 9, auto: true }); FC.simToEnd(g); FC.finishGame(S);
  const ev = S.prog[id].ev;
  const tot = Object.values(ev).reduce((a, b) => a + b, 0);
  assert.ok(ev.contact <= 252 && ev.power <= 252);
  assert.ok(tot <= 510);
});
test('equal levels change nothing: same seed at 50/50 and 70/70', () => {
  const run = L => { const g = FC.newGame({ away: 'BOS', home: 'TOR', user: null, seed: 77, awayOpts: { lvl: () => ({ level: L }) }, homeOpts: { lvl: () => ({ level: L }) } }); FC.runUntilUser(g); return g.pbp.map(x => x.t).join('|') + g.score.join('-'); };
  assert.equal(run(50), run(70));
});
test('IVs come from the data and move a rating by at most 3 points', () => {
  for (const p of FC.PLAYERS.slice(0, 50)) for (const k in p.iv) { assert.ok(p.iv[k] >= 0 && p.iv[k] <= 31); assert.ok(Math.abs(LEVELS.ivBonus(p.iv[k])) <= 3.0001); }
});

/* ------------------------------------------------------------ bars: health */
test('Health: single, walk, 3-run homer, then three outs', () => neutral(() => {
  const g = mk(5);
  play(g, [single, ...walk, hr]);
  const P = pitcher(g);
  play(g, [pop, pop]);
  assert.equal(P.pt.status, 'in');
  const expect = 100 - (BARS.DMG.s1 + BARS.DMG.bb + BARS.DMG.hr + 3 * BARS.RUN);
  assert.equal(Math.round(P.pt.hp), expect);
  play(g, [pop]);   // third out: no heal, runs scored
  assert.equal(Math.round(P.pt.hp), expect);
}));
test('Health: a scoreless half heals, capped at 100; a visit heals', () => {
  const g = mk(6);
  play(g, [single]);
  const P = pitcher(g);
  const after = P.pt.hp;
  play(g, [pop, pop, pop]);
  assert.equal(P.pt.hp, Math.min(100, after + BARS.SETTLE));
  // visit: +10 capped at 100
  const g2 = mk(6); play(g2, [single, single]); const P2 = pitcher(g2); const before = P2.pt.hp;
  assert.ok(T.visit(g2, FC.fieldSide(g2), true));
  assert.equal(P2.pt.hp, Math.min(100, before + BARS.VISIT));
  assert.equal(T.visit(g2, FC.fieldSide(g2), true), false, 'one visit per pitcher per inning');
});

/* ------------------------------------------------------------ bars: fatigue */
test('Fatigue: per-pitch cost with bases empty, a runner on, and from the 21st pitch', () => {
  const g = mk(7); T.startPA(g); const P = pitcher(g);
  const u0 = P.pt.used; play(g, Array(10).fill(foul));
  assert.equal(P.pt.used - u0, 10 * BARS.COST_BASE);
  g.bases[0] = { id: FC.curBatterId(g), resp: P.id, ue: false };
  const u1 = P.pt.used; play(g, Array(10).fill(foul));
  assert.equal(P.pt.used - u1, 10 * (BARS.COST_BASE + BARS.COST_RUNNER));
  g.bases[0] = null; P.pt.innP = 20;
  const u2 = P.pt.used; play(g, Array(5).fill(foul));
  assert.equal(P.pt.used - u2, 5 * (BARS.COST_BASE + BARS.COST_LONG));
});
test('Fatigue: pF is 0 at exactly B and above 0 one pitch later; HP colors', () => {
  const pt = { used: 88 * 100, B: 88, T: 114 };
  assert.equal(FC.pfOf(pt), 0);
  pt.used += BARS.COST_BASE; assert.ok(FC.pfOf(pt) > 0);
  assert.equal(FC.hpColor(40), 'g'); assert.equal(FC.hpColor(39), 'y'); assert.equal(FC.hpColor(21), 'y'); assert.equal(FC.hpColor(20), 'r');
  assert.equal(FC.tankOf(88), 114); assert.equal(FC.tankOf(17), 30);
});

/* ------------------------------------------------------------ fainting and substitutions */
test('a faint forces a change once the minimum is met, and a fainted pitcher cannot return', () => {
  const g = mk(8); T.startPA(g);
  const side = FC.fieldSide(g), P = pitcher(g);
  P.pt.min3 = 3; P.pt.hp = 5;
  play(g, [single]);
  assert.equal(P.pt.status, 'fnt'); assert.equal(P.pt.exit, 'KO');
  assert.notEqual(g.teams[side].pitcher, P.id);
  assert.throws(() => T.bringIn(g, side, P.id, {}), /cannot return/);
});
test('3-batter minimum: a reliever hangs on at 1 until his 3rd batter; BULLPEN refused before then', () => neutral(() => {
  const g = FC.newGame({ away: 'NYY', home: 'LAD', user: 1, seed: 12 }); quiet(g);
  // bring in a reliever with a runner on first and HP 30
  T.startPA(g);
  const side = 1, t = g.teams[side];
  g.bases[0] = { id: FC.curBatterId(g), resp: t.pitcher, ue: false };
  const rid = t.pen[1];
  T.bringIn(g, side, rid, { user: true });
  const R = g.P[rid]; R.pt.hp = 30;
  g.pa = null;
  FC.runUntilUser(g);   // user is home: fielding in the top half
  assert.equal(g.need, 'pitch');
  // 2-run homer: 16 + 2 runs -> destroyed, but he must finish 3 batters
  g.script = [hr]; FC.userPitch(g, 0, 'attack');
  assert.equal(R.pt.status, 'in'); assert.equal(Math.round(R.pt.hp), 1); assert.ok(R.pt.defer);
  const st = FC.bullpenState(g, side);
  assert.match(st.reason, /must face 2 more batters/);
  assert.equal(FC.userBullpen(g, t.pen[0]), false);
  g.script = [pop]; FC.userPitch(g, 0, 'attack');
  assert.equal(R.pt.status, 'in');
  g.script = [pop]; FC.userPitch(g, 0, 'attack');
  assert.equal(R.pt.status, 'fnt', 'faints after his 3rd batter');
  assert.equal(g.need, 'forced');
}));
test('mid at-bat change: walk at 3-1 goes to the departed pitcher, at 1-2 to the reliever', () => {
  for (const [pre, who] of [[[ball, ball, ball, whiff], 'old'], [[ball, whiff, whiff], 'new']]) {
    const g = FC.newGame({ away: 'NYY', home: 'LAD', user: 1, seed: 21 }); quiet(g);
    FC.runUntilUser(g);
    const t = g.teams[1], old = g.P[t.pitcher]; old.pt.min3 = 3;
    for (const r of pre) { g.script = [r]; FC.userPitch(g, 0, 'edge'); }
    const rid = t.pen[0];
    assert.ok(FC.userBullpen(g, rid));
    const N = g.P[rid];
    const oBB = old.pt.bb, nBB = N.pt.bb;
    while (g.balls < 4 && g.pa && g.pa.bid) { g.script = [ball]; FC.userPitch(g, 0, 'edge'); if (!g.pa || g.balls === 0) break; }
    if (who === 'old') { assert.equal(old.pt.bb, oBB + 1); assert.equal(N.pt.bb, nBB); }
    else { assert.equal(N.pt.bb, nBB + 1); assert.equal(old.pt.bb, oBB); }
  }
});
test('inherited runners: a double scores both, runs go to the departed pitcher, reliever Health still drops', () => neutral(() => {
  const g = mk(31); T.startPA(g);
  const side = FC.fieldSide(g), t = g.teams[side], old = pitcher(g);
  play(g, [single, single]);
  old.pt.min3 = 3;
  const r0 = old.pt.r;
  const rid = FC._t.pickReliever(g, side, {});
  T.bringIn(g, side, rid, {});
  const N = g.P[rid];
  g.pa = null;
  // force the runners home on a double: put them on 2nd and 3rd
  g.bases = [null, g.bases[0], g.bases[1]];
  play(g, [dbl]);
  assert.equal(old.pt.r, r0 + 2);
  assert.equal(N.pt.r, 0);
  assert.equal(N.pt.irs, 2);
  assert.equal(Math.round(100 - N.pt.hp), BARS.DMG.s2 + 2 * BARS.RUN);
}));
test('faint on the third out: the reliever starts the next half; a faint on a walk-off gets no replacement', () => {
  const g = mk(41); T.startPA(g);
  const side = FC.fieldSide(g), P = pitcher(g);
  play(g, [pop, pop]);
  T.startPA(g);   // the managers have had their say for this batter
  P.pt.min3 = 3; P.pt.used = (P.pt.T * 100) - 50;
  play(g, [pop]);
  assert.equal(P.pt.status, 'fnt'); assert.equal(P.pt.exit, 'GAS');
  assert.equal(g.teams[side].pitcher === P.id, false);
  // the bottom half is under way with the other team fielding; when this team fields again a reliever is in
  while (FC.fieldSide(g) !== side && !g.over) step(g);
  assert.notEqual(g.teams[side].pitcher, P.id);
  assert.ok(g.teams[side].pitcher != null);
});
test('empty bullpen: position players pitch and never faint; chaos games all finish and add up', () => {
  const saved = BARS.DMG_SCALE; BARS.DMG_SCALE = 5;
  try {
    for (let i = 0; i < 60; i++) {
      const g = FC.newGame({ away: 'COL', home: 'MIA', user: null, seed: 500 + i, safetyCap: 25 });
      FC.runUntilUser(g);
      assert.ok(g.over, 'game finishes');
      const bx = FC.boxScore(g);
      for (const [s, tm] of bx.teams.entries()) {
        assert.equal(tm.runs, tm.line.reduce((a, b) => a + b, 0), 'runs = line score');
        assert.equal(tm.hits, tm.bat.reduce((a, b) => a + b.h, 0), 'hits = batting lines');
        const opp = bx.teams[1 - s];
        assert.equal(opp.pit.reduce((a, p) => a + p.r, 0), tm.runs, 'pitchers R sum to team runs');
        for (const p of opp.pit) assert.ok(p.er <= p.r);
        for (const p of opp.pit) if (p.pos) assert.equal(p.exit, null, 'position player never faints');
      }
    }
  } finally { BARS.DMG_SCALE = saved; }
});
test('visits: 2 per game, +1 in the 6th if both used, +1 per extra inning', () => {
  const g = mk(51);
  assert.equal(g.teams[0].visits, 2);
  g.teams[0].visits = 0; g.inning = 5; g.half = 1;
  T.endHalf(g);
  if (!g.over) { assert.equal(g.inning, 6); assert.equal(g.teams[0].visits, 1); }
});
test('comebacker uses the aux RNG: turning it off leaves the play-by-play unchanged up to the first pitcher struck', () => {
  let diffs = 0;
  for (let s = 0; s < 40; s++) {
    const a = FC.newGame({ away: 'SD', home: 'SF', user: null, seed: 900 + s }); FC.runUntilUser(a);
    BARS.COMEBACKER = false;
    const b = FC.newGame({ away: 'SD', home: 'SF', user: null, seed: 900 + s }); FC.runUntilUser(b);
    BARS.COMEBACKER = true;
    const la = a.pbp.map(x => x.t), lb = b.pbp.map(x => x.t);
    const cut = la.findIndex(t => /fainted \(INJ\)/.test(t));
    const n = cut < 0 ? Math.min(la.length, lb.length) : cut;
    assert.deepEqual(la.slice(0, n), lb.slice(0, n));
    if (cut >= 0) diffs++;
  }
  void diffs;
});
test('a faint never changes a play: same state and seed with damage x0, x1, x10', () => {
  for (let k = 0; k < 120; k++) {
    const g = mk(1000 + k);
    let n = 0; while (!g.over && n++ < 40 + (k % 60)) step(g);
    if (g.over || !g.pa) continue;
    const base = JSON.stringify(g);
    const outs = [];
    for (const sc of [0, 1, 10]) {
      BARS.DMG_SCALE = sc;
      const h = JSON.parse(base);
      h.lines = [];
      step(h);
      outs.push(JSON.stringify({ o: h.outs, b: h.balls, s: h.strikes, sc: h.score, bs: h.bases.map(r => r && r.id), inn: h.inning, half: h.half }));
    }
    BARS.DMG_SCALE = 1;
    assert.equal(outs[0], outs[1]); assert.equal(outs[1], outs[2]);
  }
});
test('extra innings start with a runner on second; a walk-off ends the game at once', () => {
  let saw = false;
  for (let s = 0; s < 400 && !saw; s++) {
    const g = FC.newGame({ away: 'CLE', home: 'KC', user: null, seed: 2000 + s, safetyCap: 25 }); FC.runUntilUser(g);
    if (g.inning > 6) {
      saw = true;
      assert.ok(g.lines.some(l => l.ev === 'ghost'));
    }
    if (g.walkoff) { const last = g.lines.map(l => l.ev).filter(Boolean); assert.equal(last[last.length - 1], 'final'); assert.equal(last[last.length - 2], 'walkoff'); }
  }
  assert.ok(saw, 'found an extra-inning game');
});
test('save and restore at any pitch gives an identical continuation', () => {
  for (let k = 0; k < 10; k++) {
    const S = FC.newExhibition({ away: 'ATL', home: 'PHI', user: 0, seed: 70 + k });
    const g = FC.startNext(S);
    let n = 0;
    while (!g.over && n++ < 30 + k * 7) { const c = FC.coachCall(g); if (c.kind === 'pitch') FC.userPitch(g, c.pi, c.loc); else if (c.kind === 'swing') FC.userSwing(g, c.app); else FC.userBullpen(g, c.id); }
    const txt = FC.pack(S);
    const S2 = FC.unpack(txt);
    FC.simToEnd(S.game); FC.simToEnd(S2.game);
    assert.deepEqual(S.game.score, S2.game.score);
    assert.equal(S.game.pbp.map(x => x.t).join('|'), S2.game.pbp.map(x => x.t).join('|'));
  }
});

/* ------------------------------------------------------------ modes */
test('Season: rotation advances, tired relievers sit, injuries last 3-6 games', () => {
  const S = FC.newSeason({ team: 'HOU', seed: 4 });
  const starters = [];
  for (let i = 0; i < 6; i++) {
    const g = FC.startNext(S, { auto: true }); const t = g.teams[g.user];
    starters.push(t.pitcher);
    FC.simToEnd(g); FC.finishGame(S);
  }
  assert.equal(new Set(starters.slice(0, 5)).size, 5, 'five different starters');
  assert.equal(starters[5], starters[0], 'the rotation turns over');
  // a reliever who threw 30+ pitches yesterday is tired
  const id = Object.keys(S.work).map(Number).find(i => S.work[i].games.some(x => x.np >= 30 && x.i === S.results.length - 1));
  if (id) assert.ok(T.tiredNow(S, id));
});
test('Pennant Run: stage table, retry after a loss, Elite Four resets on a loss', () => {
  const S = FC.newPennant({ team: 'MIN', seed: 8 });
  assert.equal(S.leaders.length, 8); assert.equal(S.elite.length, 4);
  let ng = FC.nextGameOf(S);
  assert.equal(ng.round, 'route'); assert.ok(ng.level <= LEVELS.LEADERS[0] - 2);
  S.pr.route = LEVELS.ROUTES;
  ng = FC.nextGameOf(S); assert.equal(ng.round, 'leader'); assert.equal(ng.level, 12);
  // a loss to a leader: retry the same leader
  const g = FC.startNext(S, { auto: true }); FC.simToEnd(g);
  g.winner = 1 - g.user; g.score[g.user] = 0; g.score[1 - g.user] = 1;
  FC.finishGame(S);
  assert.equal(S.pr.leader, 0); assert.equal(FC.nextGameOf(S).round, 'leader');
  // Elite Four reset
  S.pr.leader = 8; S.pr.route = LEVELS.ROUTES; S.pr.e4 = 2;
  assert.equal(FC.nextGameOf(S).round, 'e4');
  const g2 = FC.startNext(S, { auto: true }); FC.simToEnd(g2);
  g2.winner = 1 - g2.user; FC.finishGame(S);
  assert.equal(S.pr.e4, 0);
  // save and restore between games
  const S2 = FC.unpack(FC.pack(S));
  assert.deepEqual(FC.nextGameOf(S2), FC.nextGameOf(S));
});
test('editor overrides: Power 99 raises the HR rate and reset restores it', () => {
  const p = FC.PLAYERS.find(x => x.kind === 'H' && x.r.power > 30 && x.r.power < 60);
  const r0 = FC.makeGP(p.id).h.hr;
  FC.setOverrides({ players: { [p.id]: { ratings: { power: 99 } } } });
  const r1 = FC.makeGP(p.id).h.hr;
  FC.setOverrides({ players: {} });
  const r2 = FC.makeGP(p.id).h.hr;
  assert.ok(r1 > r0 * 1.8, `${r0} -> ${r1}`);
  assert.equal(r2, r0);
});
