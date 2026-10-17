// Calibration checks beyond the league table (brief sections 6 and 11).
// node tools/checks.js <check> [games]   checks: power ace sharp bots types bars edges player levels xp pennant all
const FC = require('../src/engine.js');
const { run, report } = require('./sim.js');
const [which = 'all', nArg] = process.argv.slice(2);
const N = nArg ? +nArg : null;
const log = (...a) => console.log(...a);
const pct = x => (100 * x).toFixed(1) + '%';
const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const teams = () => FC.TEAMS.filter(t => !t.custom).map(t => t.abbr);
function lcg(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* ---------------------------------------------------------------- bots for the user's side */
const BOT = {
  // Sharp: picks pitches by type matchup and stuff, sensible locations; guesses with real usage.
  sharp: {
    pitch(g) {
      const P = g.P[FC.curPitcherId(g)], b = g.balls, s = g.strikes;
      const avgW = mean(P.p.pitches.map(x => x.whiff));
      const opts = P.p.pitches.map((x, i) => {
        const inf = FC.pitchInfo(g, i);
        const sc = 0.55 * Math.log2(Math.max(0.25, inf.mult)) + (inf.stab ? 0.25 : 0) + 3 * (x.whiff - avgW) + 0.6 * x.usage;
        return { i, sc, fam: x.fam };
      }).sort((a, c) => c.sc - a.sc);
      // mix it up so the AI can't sit on one family
      const r = g._botR();
      let pick = opts[0];
      if (opts.length > 1 && r < 0.38) pick = opts[1];
      if (opts.length > 2 && r < 0.12) pick = opts[2];
      const fam = pick.fam;
      let loc;
      if (b === 3 && s === 0) loc = 'attack';
      else if (s > b) loc = fam === 'FB' ? (g._botR() < 0.5 ? 'up' : 'edge') : (g._botR() < 0.55 ? 'chase' : 'low');
      else if (b > s) loc = g._botR() < 0.55 ? 'edge' : 'attack';
      else loc = fam === 'FB' ? 'edge' : 'low';
      return { pi: pick.i, loc };
    },
    swing(g) {
      const b = g.balls, s = g.strikes;
      if (b === 3 && s === 0) return 'take';
      if (s === 2) return 'protect';
      const P = g.P[FC.curPitcherId(g)];
      const cat = s > b ? 'ahead' : b > s ? 'behind' : 'even';
      const f = { FB: 0, BR: 0, OS: 0 };
      P.p.pitches.forEach(x => {
        let w = x.usage;
        if (cat === 'behind') w *= x.fam === 'FB' ? 1.35 : 0.8; else if (cat === 'ahead') w *= x.fam === 'FB' ? 0.8 : 1.3;
        f[x.fam] += w;
      });
      const tot = f.FB + f.BR + f.OS;
      const top = Object.keys(f).sort((a, c) => f[c] - f[a])[0];
      return f[top] / tot >= 0.58 ? 'sit' + top : 'normal';
    },
  },
  // Coach: exactly the AI policy (a baseline).
  coach: { pitch(g) { const c = FC.coachCall(g); return { pi: c.pi, loc: c.loc }; }, swing(g) { return FC.coachCall(g).app; } },
  // Random menu choices.
  random: {
    pitch(g) { const P = g.P[FC.curPitcherId(g)]; return { pi: Math.floor(g._botR() * P.p.pitches.length), loc: FC.LOCS[Math.floor(g._botR() * 5)] }; },
    swing(g) { return FC.APPROACHES[Math.floor(g._botR() * FC.APPROACHES.length)]; },
  },
  // Grinder: always Take or Protect.
  grinder: { pitch(g) { return BOT.coach.pitch(g); }, swing(g) { return g.strikes === 2 ? 'protect' : (g._botR() < 0.5 ? 'take' : 'protect'); } },
};
// Play a game where `bot` controls the user's side. pen: 'coach' | 'never' | 'early' (how the user manages the bullpen)
function botGame(opts) {
  const g = FC.newGame(opts);
  const bot = BOT[opts.bot || 'sharp'];
  const r = lcg(opts.seed * 31 + 7); g._botR = r;
  FC.runUntilUser(g);
  let guard = 0;
  while (!g.over && guard++ < 6000) {
    if (g.need === 'forced') { const st = FC.bullpenState(g, g.user); const id = st.coach; if (id == null) { g.pending = null; FC._t.bringIn(g, g.user, null, {}); FC.runUntilUser(g); } else FC.userBullpen(g, id); continue; }
    // user bullpen management at PA starts
    if (g.pa && g.pa.n === 0 && g.need === 'pitch' && opts.pen && opts.pen !== 'never') {
      const t = g.teams[g.user], P = g.P[t.pitcher];
      const used = P.pt.used / 100;
      const pull = opts.pen === 'early' ? used >= 0.8 * P.pt.B : (used >= P.pt.B - (g.outs === 0 && P.pt.innP === 0 ? 8 : 0) && (g.outs === 0 || !!(g.bases[1] || g.bases[2])) || P.pt.T - used <= 12);
      if (pull && FC.canRemove(g, g.user)) { const st = FC.bullpenState(g, g.user); if (!st.reason && st.coach != null && FC.userBullpen(g, st.coach)) continue; }
    }
    if (g.need === 'pitch') { const d = bot.pitch(g); FC.userPitch(g, d.pi, d.loc); }
    else if (g.need === 'swing') FC.userSwing(g, bot.swing(g));
    else FC.runUntilUser(g);
  }
  return g;
}
function medianTeam() { const s = FC.strengths(); const r = Object.keys(s).sort((a, b) => s[a].ovr - s[b].ovr); return r[Math.floor(r.length / 2)]; }
function winRate(bot, n, opts) {
  opts = opts || {};
  const team = opts.team || medianTeam();
  let w = 0, l = 0, rs = 0, ra = 0;
  for (let i = 0; i < n; i++) {
    const user = i % 2;
    const g = botGame({ away: team, home: opts.opp || team, user, bot, seed: 1000 + i * 17 + (opts.seedOff || 0), difficulty: opts.difficulty || 'pro', safetyCap: 25, pen: opts.pen || 'coach' });
    if (g.winner === user) w++; else if (g.winner === 1 - user) l++;
    rs += g.score[user]; ra += g.score[1 - user];
  }
  return { w, l, pct: w / Math.max(1, w + l), rs: rs / n, ra: ra / n, team };
}

/* ---------------------------------------------------------------- checks */
const CHECKS = {
  power(n = 600) {   // about 1,800 PA each way; 150 games is too noisy for a 1.6x test
    // A mid-power everyday hitter, real vs Power 99.
    const hs = FC.DATA.players.filter(p => p.kind === 'H' && p.line.pa >= 450 && p.r.power > 40 && p.r.power < 60);
    const h = hs[0];
    const hrRate = () => {
      let hr = 0, pa = 0;
      for (let i = 0; i < n; i++) {
        const opp = teams()[i % 30] === h.team ? teams()[(i + 1) % 30] : teams()[i % 30];
        const g = FC.newGame(i % 2 ? { away: opp, home: h.team, user: null, seed: 5000 + i, safetyCap: 25 } : { away: h.team, home: opp, user: null, seed: 5000 + i, safetyCap: 25 });
        FC.runUntilUser(g);
        const gp = g.P[h.id]; if (gp) { hr += gp.b.hr; pa += gp.b.pa; }
      }
      return { hr, pa, rate: hr / Math.max(1, pa) };
    };
    FC.setOverrides({ players: {} });
    const a = hrRate();
    FC.setOverrides({ players: { [h.id]: { ratings: { power: 99 } } } });
    const b = hrRate();
    FC.setOverrides({ players: {} });
    const c = hrRate();
    log(`Power check: ${h.name} (Power ${h.r.power.toFixed(0)}): real ${a.hr} HR in ${a.pa} PA (${pct(a.rate)}), Power 99: ${b.hr} HR in ${b.pa} PA (${pct(b.rate)}), reset: ${pct(c.rate)}`);
    return b.rate > a.rate * 1.6 && Math.abs(c.rate - a.rate) < 1e-9;
  },
  ace(n = 200) {
    const sps = FC.DATA.players.filter(p => p.kind === 'P' && p.role === 'SP' && p.line.ip >= 100).sort((a, b) => b.rate.k - a.rate.k).slice(0, 10);
    let ab = 0, h = 0, bb = 0, hbp = 0, sf = 0, tb = 0, k = 0, pa = 0;
    for (let i = 0; i < n; i++) {
      const ace = sps[i % sps.length];
      const opp = teams().find((t, j) => t !== ace.team && j === (i * 7) % 30) || teams().find(t => t !== ace.team);
      const g = FC.newGame({ away: opp, home: ace.team, user: null, seed: 9000 + i, safetyCap: 25, homeOpts: { starter: ace.id } });
      const T = FC.newTally(); g.tally = T;
      // count only PAs against the ace
      const orig = FC._t.resolvePitch;
      FC.runUntilUser(g);
      const st = g.P[ace.id].pt;
      pa += st.bf; k += st.k; h += st.h; bb += st.bb; hbp += st.hbp;
      void orig; void ab; void sf; void tb;
    }
    const kp = k / pa, obp = (h + bb + hbp) / pa;
    log(`Ace check: top-10 K% starters, opponents K ${pct(kp)} (league ${pct(FC.LG.k)}), on-base vs them ${obp.toFixed(3)} (league OBP ${FC.LG.obp.toFixed(3)})`);
    return obp < FC.LG.obp - 0.03 && kp > FC.LG.k + 0.04;
  },
  sharp(n = 400) {
    const r = winRate('sharp', n);
    const c = winRate('coach', Math.min(n, 300));
    const rnd = winRate('random', Math.min(n, 200));
    log(`Sharp bot on Pro vs ${r.team} (mirror): ${r.w}-${r.l} = ${pct(r.pct)} (target 60–65%), runs ${r.rs.toFixed(2)}-${r.ra.toFixed(2)}`);
    log(`  coach (AI policy) ${pct(c.pct)}, random menu choices ${pct(rnd.pct)}`);
    return r.pct >= 0.6 && r.pct <= 0.65;
  },
  bots(n = 900) {   // the ±2-point band needs ~900 games per bot to resolve
    const std = winRate('sharp', n, { pen: 'coach' });
    const never = winRate('sharp', n, { pen: 'never' });
    const early = winRate('sharp', n, { pen: 'early' });
    const grind = winRate('grinder', n, { pen: 'coach' });
    log(`Bars bots (Pro, mirror ${std.team}): standard ${pct(std.pct)} RA ${std.ra.toFixed(2)}; never pull ${pct(never.pct)} RA ${never.ra.toFixed(2)} (+${(never.ra - std.ra).toFixed(2)}, target +0.10..+0.50); pull early ${pct(early.pct)} (±2 pts of standard); grinder ${pct(grind.pct)} (≤ sharp)`);
    return true;
  },
  types(n = 10000) {
    FC.TYPES.ON = true; const on = run(n, 77);
    FC.TYPES.ON = false; FC._t.SOLVE_CACHE.clear(); const off = run(n, 77);
    FC.TYPES.ON = true;
    const r = T => ({ rpg: T.runs / (2 * T.games), k: T.k / T.pa, bb: T.bb / T.pa, hr: T.hr / T.pa });
    const a = r(on), b = r(off);
    log(`Types A/B over ${n} games: runs ${a.rpg.toFixed(3)} vs ${b.rpg.toFixed(3)} (Δ ${(a.rpg - b.rpg).toFixed(3)}, ±0.05); K ${pct(a.k)} vs ${pct(b.k)}; BB ${pct(a.bb)} vs ${pct(b.bb)}; HR ${pct(a.hr)} vs ${pct(b.hr)} (±0.3 pts)`);
    return Math.abs(a.rpg - b.rpg) <= 0.05 && Math.abs(a.k - b.k) <= 0.003 && Math.abs(a.bb - b.bb) <= 0.003 && Math.abs(a.hr - b.hr) <= 0.003;
  },
  bars(n = 10000) {
    FC.BARS.EFFECTS = true; const on = run(n, 99);
    FC.BARS.EFFECTS = false; const off = run(n, 99);
    FC.BARS.EFFECTS = true;
    const r = T => ({ rpg: T.runs / (2 * T.games), k: T.k / T.pa, bb: T.bb / T.pa, hr: T.hr / T.pa });
    const a = r(on), b = r(off);
    log(`Bar effects A/B over ${n} games: runs ${a.rpg.toFixed(3)} vs ${b.rpg.toFixed(3)} (Δ ${(a.rpg - b.rpg).toFixed(3)}, ±0.05); K ${pct(a.k)} vs ${pct(b.k)}; BB ${pct(a.bb)} vs ${pct(b.bb)}; HR ${pct(a.hr)} vs ${pct(b.hr)}`);
    return Math.abs(a.rpg - b.rpg) <= 0.05;
  },
  edges() {
    const C = FC.TYPES.center();
    const hit = [], pit = [];
    for (const p of FC.PLAYERS) { const v = FC.view(p.id); (v.kind === 'H' ? hit : pit).push(v); }
    let sP = 0, wP = 0, sS = 0, wS = 0, mx = 0;
    for (const P of pit) for (const B of hit) {
      const w = (P.line.bf || 150) * (B.line.pa || 200);
      for (const x of P.pitches) {
        const e = FC.TYPES.pitchEdge(x, { types: P.types, id: P.id }, { types: B.types }).e;
        sP += e * w * x.usage; wP += w * x.usage;
      }
      const es = FC.TYPES.swingEdge({ types: B.types }, { types: P.types }).e; sS += es * w; wS += w;
      mx = Math.max(mx, Math.abs(es));
    }
    log(`Centered edges: league mean pitch edge ${(sP / wP).toFixed(4)}, swing edge ${(sS / wS).toFixed(4)} (target ±0.02); largest |swing edge| ${mx.toFixed(2)}`);
    void C;
    return Math.abs(sP / wP) <= 0.02 && Math.abs(sS / wS) <= 0.02;
  },
  player() {
    // A player's expected wOBA against the league-average opponent, types on vs off, via the matchup model.
    const T = FC._t;
    const hs = FC.DATA.players.filter(p => p.kind === 'H' && p.line.pa >= 400).slice(0, 40);
    const ps = FC.DATA.players.filter(p => p.kind === 'P' && p.line.bf >= 300);
    let worst = 0, who = '';
    for (const h of hs) {
      const B = FC.makeGP(h.id);
      let won = 0, woff = 0, wt = 0;
      for (const p of ps) {
        const P = FC.makeGP(p.id); const w = p.line.bf;
        const tg = T.matchupTargets(B, P, 0);
        const eS = FC.TYPES.swingEdge(B, P).e;
        const avgEP = p.pitches.reduce((a, x) => a + x.usage * FC.TYPES.pitchEdge(FC.makeGP(p.id).p.pitches.find(y => y.code === x.code) || x, P, B).e, 0);
        const shiftH = FC.clamp(-0.08 * avgEP + 0.08 * eS, -0.3, 0.3), shiftHR = FC.clamp(-0.10 * avgEP + 0.10 * eS, -0.3, 0.3);
        const lo = x => Math.log(x / (1 - x)), sg = x => 1 / (1 + Math.exp(-x));
        const bip = 1 - tg.K - tg.BB - tg.HBP - tg.HR;
        const wo = (babip, hr) => 0.69 * tg.BB + 0.72 * tg.HBP + bip * babip * 0.95 + 2.0 * hr;
        woff += w * wo(tg.BABIP, tg.HR);
        won += w * wo(sg(lo(tg.BABIP) + shiftH), sg(lo(tg.HR) + shiftHR));
        wt += w;
      }
      const d = Math.abs(won - woff) / wt;
      if (d > worst) { worst = d; who = h.name; }
    }
    log(`Player lines, types on vs off vs the league: largest wOBA-like change ${worst.toFixed(4)} (${who}) (target ≤ .006)`);
    return worst <= 0.006;
  },
  levels(n = 1500) {   // a win rate on 400 games has an SE of 2.5 points, about the width of the +5 band
    const team = medianTeam();
    const out = [];
    for (const gap of [0, 5, 10, 20]) {
      let w = 0, l = 0;
      for (let i = 0; i < n; i++) {
        const hiHome = i % 2 === 1;
        const lv = (lvl) => ({ lvl: () => ({ level: lvl }) });
        const g = FC.newGame({ away: team, home: team, user: null, seed: 3000 + i * 13, safetyCap: 25,
          awayOpts: lv(hiHome ? 50 : 50 + gap), homeOpts: lv(hiHome ? 50 + gap : 50) });
        FC.runUntilUser(g);
        const hi = hiHome ? 1 : 0;
        if (g.winner === hi) w++; else if (g.winner === 1 - hi) l++;
      }
      out.push(`+${gap}: ${pct(w / (w + l))}`);
    }
    log(`Level gap win rates (${team} vs itself): ${out.join(', ')} (targets +5 56–62%, +10 63–72%, +20 78–90%)`);
    return true;
  },
  xp(games = 60) {
    // XP and EV pace for an everyday player in Pennant Run at equal levels.
    const team = medianTeam();
    const S = FC.newPennant({ team, seed: 42 });
    const every = FC.buildTeam(team, {}).team.lineup[3];
    const bt = FC.buildTeam(team, {}).team, sp = bt.rot[0], rp = bt.pen[2];
    const lv0 = S.prog[every].lvl;
    let ev510 = null;
    for (let i = 0; i < games; i++) {
      const L = S.prog[every].lvl;
      // equal-level route game against a random team
      S.pr.route = 0; S.pr.leader = 7; // keep it on route games
      const ng = FC.nextGameOf(S);
      const g = FC.startNext(S, { seed: 700 + i, auto: true });
      g.oppLevel = L;
      // opponents at the player's level
      for (const id of g.teams[1 - g.user].roster) { const gp = g.P[id]; if (gp) gp.lvl = L; }
      FC.simToEnd(g); FC.runUntilUser(g);
      FC.finishGame(S);
      const tot = Object.values(S.prog[every].ev).reduce((a, b) => a + b, 0);
      if (ev510 == null && tot >= 510) ev510 = i + 1;
      void ng;
    }
    const lv1 = S.prog[every].lvl;
    log(`XP pace: everyday hitter Lv ${lv0} -> ${lv1} in ${games} equal-level games (${((lv1 - lv0) / games).toFixed(2)} levels/game, target 1.0–1.4 early); EVs reached 510 at game ${ev510 || 'not yet'} (target 35–60); starter Lv ${S.prog[sp].lvl}, reliever Lv ${S.prog[rp].lvl}`);
    return true;
  },
  pennant(maxGames = 140) {
    const team = medianTeam();
    const S = FC.newPennant({ team, seed: 4242 });
    let n = 0;
    while (!S.done && n < maxGames) {
      const ng = FC.nextGameOf(S);
      const g = FC.startNext(S, { seed: 100 + n, auto: true });
      g._botR = lcg(n + 5);
      FC.runUntilUser(g);
      let guard = 0;
      while (!g.over && guard++ < 6000) {
        if (g.need === 'forced') { const st = FC.bullpenState(g, g.user); if (st.coach == null) { g.pending = null; FC._t.bringIn(g, g.user, null, {}); FC.runUntilUser(g); } else FC.userBullpen(g, st.coach); }
        else if (g.need === 'pitch') { const d = BOT.sharp.pitch(g); FC.userPitch(g, d.pi, d.loc); }
        else if (g.need === 'swing') FC.userSwing(g, BOT.sharp.swing(g));
        else FC.runUntilUser(g);
      }
      const res = FC.finishGame(S);
      n++;
      if (ng.round !== 'route') log(`  game ${n}: ${ng.label} (${ng.opp}, Lv ${ng.level}) avg Lv ${FC.avgLevel(S).toFixed(1)} -> ${res.win ? 'W' : 'L'} ${res.us}-${res.them}`);
    }
    log(`Pennant Run (sharp bot, ${team}): ${S.done ? 'Champion' : 'not finished'} after ${n} games; retries ${JSON.stringify(S.pr.retries)} (target: champion in 45–70 games, ≤3 retries per leader)`);
    return S.done && n >= 45 && n <= 70;
  },
};
if (require.main !== module) { /* used as a library */ }
else if (which === 'all') { for (const k of ['edges', 'player', 'power', 'ace', 'sharp', 'levels', 'xp']) CHECKS[k](); }
else if (CHECKS[which]) CHECKS[which](N || undefined);
else log('unknown check', which);
module.exports = { BOT, botGame, winRate };
