// Tune the global base-rate offsets (M.K_ADJ, BB_ADJ, HR_ADJ, BABIP_ADJ) until the simulated league matches the
// pulled 2026 league. Prints the constants to paste into src/engine.js. node tools/calibrate.js [games] [rounds]
const FC = require('../src/engine.js');
const { run } = require('./sim.js');
const M = FC.M, L = FC.LG;
const N = +(process.argv[2] || 300), ROUNDS = +(process.argv[3] || 5);
const logit = p => Math.log(p / (1 - p));
for (let r = 0; r < ROUNDS; r++) {
  FC._t.SOLVE_CACHE.clear();
  const T = run(N, 11 + r);
  const k = T.k / T.pa, bb = T.bb / T.pa, hr = T.hr / T.pa;
  const babip = (T.h - T.hr) / (T.ab - T.k - T.hr + T.sf);
  const rpg = T.runs / (2 * T.games);
  console.log(`round ${r}: K ${k.toFixed(4)} BB ${bb.toFixed(4)} HR ${hr.toFixed(4)} BABIP ${babip.toFixed(4)} R/G ${rpg.toFixed(2)} (targets ${L.k.toFixed(4)} ${L.bb.toFixed(4)} ${L.hr.toFixed(4)} ${L.babip.toFixed(4)} ${L.runsPer6.toFixed(2)})`);
  M.K_ADJ += 0.9 * (logit(L.k) - logit(k));
  M.BB_ADJ += 0.9 * (logit(L.bb) - logit(bb));
  M.HR_ADJ *= Math.exp(0.9 * (logit(L.hr) - logit(hr)));
  M.BABIP_ADJ += 0.9 * (logit(L.babip) - logit(babip));
  console.log(`  -> K_ADJ: ${M.K_ADJ.toFixed(3)}, BB_ADJ: ${M.BB_ADJ.toFixed(3)}, HR_ADJ: ${M.HR_ADJ.toFixed(3)}, BABIP_ADJ: ${M.BABIP_ADJ.toFixed(3)}`);
}
