// Headless calibration (brief section 6). AI on both sides.
// node tools/sim.js [--games 500] [--seed 1] [--types off] [--effects off] [--json]
const FC = require('../src/engine.js');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const N = +opt('games', 500), SEED = +opt('seed', 1);
if (opt('types', 'on') === 'off') FC.TYPES.ON = false;
if (opt('effects', 'on') === 'off') FC.BARS.EFFECTS = false;
const json = args.includes('--json');

function run(n, seed) {
  const teams = FC.TEAMS.filter(t => !t.custom).map(t => t.abbr);
  const T = FC.newTally();
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const a = teams[Math.floor(rnd() * teams.length)];
    let h = teams[Math.floor(rnd() * teams.length)];
    if (h === a) h = teams[(teams.indexOf(a) + 1) % teams.length];
    const g = FC.newGame({ away: a, home: h, user: null, seed: (seed * 100003 + i * 7919) >>> 0, tally: true, safetyCap: 25 });
    g.tally = T;
    FC.runUntilUser(g);
  }
  T.ms = Date.now() - t0;
  return T;
}
function report(T) {
  const L = FC.LG;
  const pa = T.pa, ab = T.ab;
  const H = T.h, tb = T.tb;
  const avg = H / ab, obp = (H + T.bb + T.hbp) / (ab + T.bb + T.hbp + T.sf), slg = tb / ab;
  const babip = (H - T.hr) / (ab - T.k - T.hr + T.sf);
  const mean = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
  const p90 = a => { const b = a.slice().sort((x, y) => x - y); return b[Math.floor(0.9 * (b.length - 1))]; };
  const rows = [
    ['K%', T.k / pa, L.k, 0.004], ['BB%', T.bb / pa, L.bb, 0.004], ['HR per PA', T.hr / pa, L.hr, 0.002],
    ['BABIP', babip, L.babip, 0.006], ['AVG', avg, L.avg, 0.006], ['OBP', obp, L.obp, 0.006], ['SLG', slg, L.slg, 0.010],
    ['Runs per team per game', T.runs / (2 * T.games), L.runsPer6, 0.15], ['Pitches per PA', T.pitches / pa, L.pitchesPerPA, 0.06],
    ['Stolen base success', T.sb / Math.max(1, T.sb + T.cs), L.sbPct, 0.04],
    ['Steal attempts per team game', (T.sb + T.cs) / (2 * T.games), L.sbAttPerG * 6 / 9, 0.12],
  ];
  const out = { games: T.games, ms: T.ms, rows: [], bars: [], types: [] };
  const f3 = x => (x < 1 ? x.toFixed(3) : x.toFixed(2));
  for (const [k, v, t, tol] of rows) out.rows.push({ stat: k, sim: +v.toFixed(4), target: +t.toFixed(4), ok: Math.abs(v - t) <= tol });
  const sp = T.starterPitches, so = T.starterOuts;
  const koStarts = T.startsKO;
  const bars = [
    ['Starter pitches mean (76–88)', mean(sp), v => v >= 76 && v <= 88],
    ['Starter pitches SD (10–16)', sd(sp), v => v >= 10 && v <= 16],
    ['Starter pitches p90 (≤102)', p90(sp), v => v <= 102],
    ['Starter innings mean (4.6–5.3)', mean(so) / 3, v => v >= 4.6 && v <= 5.3],
    ['Relief share of innings (12–25%)', T.reliefOuts / T.totalOuts, v => v >= 0.12 && v <= 0.25],
    ['Pitchers per team per game (2.0–3.0)', T.pitchersUsed / (2 * T.games), v => v >= 2 && v <= 3],
    ['Starts under 3.0 IP, not injury (4–8%)', T.shortStarts / T.startsN, v => v >= 0.04 && v <= 0.08],
    ['Starters KO (6–10% of starts)', koStarts.length / T.startsN, v => v >= 0.06 && v <= 0.10],
    ['  KO starts: IP (2.3–3.7)', mean(koStarts.map(x => x.outs)) / 3, v => v >= 2.3 && v <= 3.7],
    ['  KO starts: runs (5–7)', mean(koStarts.map(x => x.r)), v => v >= 5 && v <= 7],
    ['Relievers KO (≤3% of apps)', T.faintRP.KO / Math.max(1, T.reliefApps), v => v <= 0.03],
    ['Out of gas (≤1% of apps)', T.faints.GAS / Math.max(1, T.startsN + T.reliefApps), v => v <= 0.01],
    ['Games with a faint (12–25%)', T.gamesWithFaint / T.games, v => v >= 0.12 && v <= 0.25],
    // rare enough (about 1 in 400 games) that it's only judged on 10,000+ games
    ['Injury faints per game (1/250–1/500, 10k+ games)', T.faints.INJ / T.games, v => v >= 0.002 && v <= 0.004 || T.games < 10000],
    ['AI changes mid at-bat (0)', T.midAB, v => v === 0],
    ['Pitches past budget (1–6%)', T.pastBudget / T.pitches, v => v >= 0.01 && v <= 0.06],
    ['Pitches with a Health penalty (3–10%)', T.hpPen / T.pitches, v => v >= 0.03 && v <= 0.10],
    ['Runs/PA with Health penalty ÷ league (≤1.15)', (T.runsHpPen / Math.max(1, T.paHpPen)) / (T.runs / T.pa), v => v <= 1.15],
    ['AI mound visits per team-game (0.2–0.8)', T.visits / (2 * T.games), v => v >= 0.2 && v <= 0.8],
    ['Position player pitching per team-game (≤1/300)', T.posPitch / (2 * T.games), v => v <= 1 / 300],
    ['Fatigue cost per pitch (100 ± 2)', T.costSum / T.costN, v => Math.abs(v - 100) <= 2],
  ];
  for (const [k, v, ok] of bars) out.bars.push({ stat: k, sim: +(+v).toFixed(4), ok: !!ok(v) });
  out.types.push({ stat: '"Super effective" text share of K + whiffs (3–12%)', sim: +(T.superText / Math.max(1, T.kOrWhiff + T.k)).toFixed(4) });
  out.types.push({ stat: 'Largest type shift (≤0.30)', sim: +T.maxTypeShift.toFixed(3), ok: T.maxTypeShift <= 0.30001 });
  if (json) { console.log(JSON.stringify(out)); return out; }
  console.log(`${T.games} games in ${(T.ms / 1000).toFixed(1)}s`);
  console.log('\nStat                          Sim     Target');
  for (const r of out.rows) console.log(`${r.ok ? '✓' : '✗'} ${r.stat.padEnd(27)} ${f3(r.sim).padStart(6)}  ${f3(r.target).padStart(6)}`);
  console.log('\nPitcher bars');
  for (const r of out.bars) console.log(`${r.ok ? '✓' : '✗'} ${r.stat.padEnd(48)} ${String(r.sim).padStart(8)}`);
  console.log('\nTypes');
  for (const r of out.types) console.log(`  ${r.stat.padEnd(48)} ${String(r.sim).padStart(8)}`);
  return out;
}
if (require.main === module) report(run(N, SEED));
module.exports = { run, report };
