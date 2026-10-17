// Play one AI-vs-AI game and print the narration and box score: node tools/onegame.js [away] [home] [seed]
const FC = require('../src/engine.js');
const [away = 'NYY', home = 'LAD', seed = '7'] = process.argv.slice(2);
const g = FC.newGame({ away, home, user: null, seed: +seed });
FC.runUntilUser(g);
for (const l of g.lines) console.log(l.t);
const bx = FC.boxScore(g);
for (const t of bx.teams) {
  console.log(`\n${t.name}  R ${t.runs} H ${t.hits} E ${t.errors}  line ${t.line.join(' ')}`);
  for (const b of t.bat) console.log(`  ${b.slot}${b.sub ? '*' : ' '} ${b.name.padEnd(24)} ${String(b.pos).padEnd(3)} ${b.ab} AB ${b.r} R ${b.h} H ${b.rbi} RBI ${b.bb} BB ${b.k} K ${b.hr} HR`);
  for (const p of t.pit) console.log(`  P ${p.name.padEnd(24)} ${p.ip} IP ${p.h} H ${p.r} R ${p.er} ER ${p.bb} BB ${p.k} K ${p.np} P ${p.exit || ''} ${p.dec || ''}`);
}
console.log(bx.notes.join('\n'));
