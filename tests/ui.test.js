// Browser tests (brief section 9): Playwright driving dist/full-count.html at 390x844 and at desktop width.
// node build.js && node --test tests/ui.test.js
// Screenshots go to docs/screenshots/.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');

const FILE = path.resolve(__dirname, '../dist/full-count.html');
const FILE_URL = 'file://' + FILE;
// Tests that reload are served over http: Chromium test contexts sometimes drop a file:// page's
// localStorage on reload (every key, not just the game's). The full random game runs from file://.
const server = http.createServer((q, r) => {
  if (q.url.split('?')[0] === '/full-count.html') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(FILE)); }
  else { r.writeHead(404); r.end(); }
});
let HTTP_URL;
const SHOTS = path.resolve(__dirname, '../docs/screenshots');
const PHONE = { width: 390, height: 844 }, DESKTOP = { width: 1280, height: 860 };
const FREEMAN = 518692;
fs.mkdirSync(SHOTS, { recursive: true });

let browser;
before(async () => {
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  HTTP_URL = `http://127.0.0.1:${server.address().port}/full-count.html`;
  browser = await chromium.launch();
});
after(async () => { if (browser) await browser.close(); server.close(); });

// A fresh context per test: its own localStorage. Fast text, sound off, and menus-only swings and pitches
// unless a test turns swiping or flicking on. Console errors are collected; the optional custom-sprite probe (sprites/<name>.png next
// to the file) is allowed to miss.
async function open(viewport = PHONE, { file = false, timing = false, pitching = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(([t, pt]) => {
    if (!localStorage.getItem('fullcount-prefs-v1')) localStorage.setItem('fullcount-prefs-v1', JSON.stringify({ speed: 'fast', mode: 'auto', sound: false, timing: t, pitching: pt }));
  }, [timing ? 'on' : 'off', pitching ? 'on' : 'off']);
  const p = await ctx.newPage();
  p.errors = [];
  p.on('console', m => { if (m.type() === 'error' && !(m.location().url || '').includes('/sprites/')) p.errors.push(m.text()); });
  p.on('pageerror', e => p.errors.push(e.message));
  await p.goto(file ? FILE_URL : HTTP_URL);
  return p;
}
const shot = (p, name, full) => p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full });
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

async function state(p) {
  return p.evaluate(() => {
    const q = s => document.querySelector('#panel ' + s);
    if (!document.querySelector('#panel')) return 'none';
    if (q('[data-a=skip]')) return 'playing';
    if (q('[data-a=toPost]')) return 'over';
    if (q('[data-a=forcedAuto]')) return 'forced';
    if (q('[data-a=throw]')) return 'pitch';
    if (q('[data-a=swing]')) return 'swing';
    if (q('[data-v=pitch]')) return 'def';
    if (q('[data-v=swing]')) return 'off';
    if (q('#pad')) return 'timing';
    if (q('.bag-list')) return 'list';
    return 'other';
  });
}
// Skip through playback until the game wants input.
async function settle(p) {
  for (let i = 0; i < 400; i++) {
    const st = await state(p);
    if (st !== 'playing' && st !== 'other') return st;
    if (st === 'playing') await p.click('#panel [data-a=skip]', { timeout: 1000 }).catch(() => {});
    await p.waitForTimeout(25);
  }
  throw new Error('playback never settled');
}
async function newExhibition(p, { home = true, team = 'NYY', opp = 'LAD' } = {}) {
  await p.click('label[for=m_exhibition]');
  await p.click('button[type=submit]');
  await p.selectOption('#suTeam', team);
  await p.selectOption('#suOpp', opp);
  await p.click(home ? 'label[for=h_home]' : 'label[for=h_away]');
  await p.click('[data-a=startMode]');
  await p.waitForSelector('[data-a=playBall]');
}
async function playBall(p) { await p.click('[data-a=playBall]'); await p.waitForSelector('#panel'); return settle(p); }

// One random choice through the menus. Pitching changes only between batters, so the
// "pitched to N batters" notes line up with the play-by-play.
async function randomStep(p, r) {
  const st = await settle(p);
  const click = (s, t = 2000) => p.click('#panel ' + s, { timeout: t });
  if (st === 'def') {
    const x = r();
    const fresh = await p.evaluate(() => { const g = __fc.S.game; return g.balls + g.strikes === 0; });
    if (x < 0.03 && fresh && !(await p.$('#panel [data-v=pen][aria-disabled=true]'))) {
      await click('[data-v=pen]');
      const opts = await p.$$('#panel .bag-item[data-a=pen]:not([disabled])');
      if (opts.length) await opts[Math.floor(r() * opts.length)].click(); else await click('[data-a=menu][data-v=cmd]');
    } else if (x < 0.06 && !(await p.$('#panel [data-a=visit][aria-disabled=true]'))) await click('[data-a=visit]');
    else if (x < 0.09) await click('[data-a=auto]');
    else {
      await click('[data-v=pitch]');
      const locs = await p.$$('#panel [data-a=loc]');
      await locs[Math.floor(r() * locs.length)].click();
      const n = (await p.$$('#panel [data-a=psel]')).length, i = Math.floor(r() * n);
      if (await p.getAttribute(`#panel [data-a=psel][data-i="${i}"]`, 'aria-pressed') !== 'true') await click(`[data-a=psel][data-i="${i}"]`);
      await click('[data-a=throw]');
    }
  } else if (st === 'off') {
    const x = r();
    if (x < 0.06) {
      await click('[data-v=run]');
      const opts = await p.$$('#panel .bag-item[data-a=run]:not([disabled])');
      if (opts.length) await opts[Math.floor(r() * opts.length)].click(); else await click('[data-a=menu][data-v=cmd]');
    } else if (x < 0.09) await click('[data-a=auto]');
    else {
      await click('[data-v=swing]');
      const c = await p.$$eval('#panel [data-a=asel]', els => els.map(e => [e.dataset.v, e.getAttribute('aria-pressed')]));
      const [v, pressed] = c[Math.floor(r() * c.length)];
      if (pressed !== 'true') await click(`[data-a=asel][data-v="${v}"]`);
      await click('[data-a=swing]');
    }
  } else if (st === 'forced') {
    const opts = await p.$$('#panel .bag-item[data-a=pen]:not([disabled])');
    if (opts.length && r() < 0.5) await opts[Math.floor(r() * opts.length)].click(); else await click('[data-a=forcedAuto]');
  }
  return st;
}
async function playToEnd(p, r, maxSteps = 3000) {
  for (let i = 0; i < maxSteps; i++) if (await randomStep(p, r) === 'over') return true;
  return false;
}
// Sim the rest from the bench menu (Auto on defense until we bat).
async function simToFinal(p) {
  for (let i = 0; i < 600; i++) {
    const st = await settle(p);
    if (st === 'over') break;
    if (st === 'off') { await p.click('#panel [data-v=bench]'); await p.click('#panel [data-a=simRest]'); await p.click('#panel [data-a=simRest]'); continue; }
    if (st === 'forced') { await p.click('#panel [data-a=forcedAuto]'); continue; }
    if (st === 'def') { await p.click('#panel [data-a=auto]'); continue; }
    await p.click('#panel [data-a=menu][data-v=cmd]').catch(() => {});
  }
  assert.equal(await settle(p), 'over');
}

// Box score arithmetic, exit tags and the "pitched to N batters" notes against the play-by-play.
function auditGame() {
  const g = __fc.S.game, FC = __fc.FC, bx = FC.boxScore(g), errs = [];
  const sum = (a, k) => a.reduce((x, y) => x + (+(k ? y[k] : y) || 0), 0);
  bx.teams.forEach((t, i) => {
    const opp = bx.teams[1 - i];
    if (sum(t.line) !== t.runs) errs.push(`${t.abbr} line sums to ${sum(t.line)}, runs ${t.runs}`);
    if (sum(t.bat, 'r') !== t.runs) errs.push(`${t.abbr} batting R ${sum(t.bat, 'r')} vs ${t.runs}`);
    if (sum(t.bat, 'h') !== t.hits) errs.push(`${t.abbr} batting H ${sum(t.bat, 'h')} vs ${t.hits}`);
    if (sum(t.pit, 'r') !== opp.runs) errs.push(`${t.abbr} pitchers' R ${sum(t.pit, 'r')} vs ${opp.runs}`);
    for (const x of t.pit) {
      if (x.er > x.r) errs.push(`${x.last} ER > R`);
      const pt = g.P[x.id].pt;
      if (pt.status === 'fnt' && !pt.exit) errs.push(`${x.last} fainted with no exit tag`);
      if (!['in', 'used', 'fnt'].includes(pt.status)) errs.push(`${x.last} status ${pt.status}`);
    }
  });
  const skip = /replaces|steals|caught stealing|wild pitch|visit|pinch|picked off|balk|faint|injur/i;
  for (const n of bx.notes) {
    const m = n.match(/^(.+) pitched to (\d+) batters? in the (\d+)/); if (!m) continue;
    const last = m[1], N = +m[2], inn = parseInt(m[3], 10);
    const side = bx.teams.findIndex(t => t.pit.some(x => x.last === last)), half = 1 - side;
    const lines = g.pbp.filter(e => e.inn === inn && e.half === half).map(e => e.t);
    const from = lines.findIndex(t => new RegExp(`\\b${last} replaces\\b`).test(t));
    const to = lines.findIndex(t => new RegExp(`replaces ${last}\\b`).test(t));
    const pa = lines.slice(from + 1, to < 0 ? lines.length : to).filter(t => !skip.test(t)).length;
    if (pa !== N) errs.push(`note "${n}" but the play-by-play shows ${pa} batters: ${JSON.stringify(lines)}`);
  }
  return { errs, innings: g.inning, score: g.score.slice(), over: g.over, notes: bx.notes };
}

test('a full random game through the menus, opened from the file: no console errors, it ends, the box score adds up', async () => {
  const p = await open(PHONE, { file: true });
  await shot(p, '01-title');
  await newExhibition(p, { home: true });
  await shot(p, '02-lineup-card', true);
  await playBall(p);
  const r = rng(20261017);
  let shotPitch = false, shotBat = false, shotPM = false, shotSM = false;
  let done = false;
  for (let i = 0; i < 3000 && !done; i++) {
    const st = await settle(p);
    if (st === 'def' && !shotPitch) { shotPitch = true; await shot(p, '03-at-bat-pitching'); }
    if (st === 'off' && !shotBat) { shotBat = true; await shot(p, '04-at-bat-batting'); }
    if (st === 'def' && !shotPM) { shotPM = true; await p.click('#panel [data-v=pitch]'); await shot(p, '05-pitch-menu'); await p.click('#panel [data-a=menu][data-v=cmd]'); }
    if (st === 'off' && !shotSM) { shotSM = true; await p.click('#panel [data-v=swing]'); await shot(p, '06-swing-menu'); await p.click('#panel [data-a=menu][data-v=cmd]'); }
    done = (await randomStep(p, r)) === 'over';
  }
  assert.ok(done, 'the game ended');
  const a = await p.evaluate(auditGame);
  assert.deepEqual(a.errs, []);
  assert.ok(a.innings >= 6);
  await p.click('#panel [data-a=toPost]');
  await p.waitForSelector('.verdict');
  await shot(p, '08-postgame', true);
  // the postgame line score shows the same final
  const finalRuns = await p.$$eval('.score-line div', els => els.map(e => parseInt(e.textContent.replace(/\D+/g, ' ').trim().split(' ').pop(), 10)));
  assert.deepEqual(finalRuns, a.score);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('reload mid at-bat restores the count, runners, score and both pitchers\' bars', async () => {
  const p = await open();
  await newExhibition(p, { home: true });
  await playBall(p);
  const r = rng(7);
  // play until there's a count and, if possible, a runner on
  let ok = false;
  for (let i = 0; i < 600 && !ok; i++) {
    const st = await settle(p);
    if (st === 'def' || st === 'off') {
      ok = await p.evaluate(() => { const g = __fc.S.game; return g.balls + g.strikes > 0 && g.bases.some(Boolean) && g.pa.n > 0; });
      if (ok) break;
    }
    if (st === 'over') break;
    await randomStep(p, r);
  }
  assert.ok(ok, 'reached a mid at-bat state with a runner on');
  const read = () => p.evaluate(() => {
    const g = __fc.S.game, q = s => document.querySelector(s);
    const bars = [...document.querySelectorAll('.sbox .hp-fill')].map(e => e.style.width + '|' + e.className);
    const pit = side => { const P = g.P[g.teams[side].pitcher]; return P ? [P.id, P.pt.hp, P.pt.used, P.pt.np] : null; };
    return { bug: q('#bug').innerText, boxU: q('#boxU').getAttribute('aria-label'), boxO: q('#boxO').getAttribute('aria-label'), bars,
      count: [g.balls, g.strikes], outs: g.outs, bases: g.bases.map(b => b && b.id), score: g.score.slice(), pitchers: [pit(0), pit(1)] };
  });
  const before = await read();
  await p.reload();
  await p.waitForSelector('#panel');
  const after = await read();
  assert.deepEqual(after, before);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('editor: Power 99 raises a hitter\'s HR rate over 50 simulated games, and reset brings it back', async () => {
  const p = await open();
  const sim = () => p.evaluate(id => {
    const FC = __fc.FC, opps = FC.TEAMS.filter(t => !t.custom && t.abbr !== 'LAD').map(t => t.abbr);
    let pa = 0, hr = 0;
    for (let i = 0; i < 50; i++) {
      const o = opps[i % opps.length];
      const g = FC.newGame(i % 2 ? { away: 'LAD', home: o, user: null, seed: i } : { away: o, home: 'LAD', user: null, seed: i });
      FC.runUntilUser(g);
      const gp = g.P[id];
      if (gp) { pa += gp.b.pa; hr += gp.b.hr; }
    }
    return { pa, hr, rate: hr / pa };
  }, FREEMAN);
  const base = await sim();
  await p.click('[data-a=editor]');
  await p.fill('#edq', 'Freddie Freeman');
  await p.click(`.pool .pr[data-id="${FREEMAN}"]`);
  const proj0 = await p.textContent('#proj');
  await p.$eval('#r_power', el => { el.value = 99; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  const proj1 = await p.textContent('#proj');
  assert.notEqual(proj1, proj0, 'the live projection moves');
  await shot(p, '07-editor', true);
  await p.click('[data-a=edSave]');
  await p.reload();
  const edited = await sim();
  assert.ok(edited.rate > base.rate * 1.5, `HR rate ${base.rate.toFixed(4)} -> ${edited.rate.toFixed(4)}`);
  await p.click('[data-a=editor]');
  await p.fill('#edq', 'Freddie Freeman');
  await p.click(`.pool .pr[data-id="${FREEMAN}"]`);
  await p.click('[data-a=edReset]');
  assert.equal(await p.textContent('#proj'), proj0);
  await p.click('[data-a=edSave]');
  const reset = await sim();
  assert.deepEqual(reset, base);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('custom player: create, put him in the lineup, play, export, clear storage, import, he is back', async () => {
  const p = await open();
  await p.click('[data-a=editor]');
  await p.click('[data-a=edNew][data-v=H]');
  await p.fill('[data-ed=name]', 'Rocket Robinson');
  await p.$eval('[data-ed=name]', el => el.dispatchEvent(new Event('change', { bubbles: true })));
  await p.fill('[data-ed=pos]', 'CF');
  await p.$eval('[data-ed=pos]', el => el.dispatchEvent(new Event('change', { bubbles: true })));
  for (const s of ['contact', 'power', 'eye', 'speed']) await p.$eval('#r_' + s, el => { el.value = 95; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.click('[data-a=edSave]');
  await p.click('[data-a=edBack]');
  await newExhibition(p, { home: true, team: 'NYY' });
  // he's on the card; if he's on the bench, swap him in for the center fielder
  const id = await p.evaluate(() => __fc.FC.OV.custom[0].id);
  assert.ok(await p.$(`.lu-row[data-id="${id}"]`), 'the custom player is on the lineup card');
  const inLineup = () => p.evaluate(id => __fc.UI.luDraft.lineup.includes(id), id);
  if (!(await inLineup())) {
    const cf = await p.evaluate(() => { const d = __fc.UI.luDraft; return d.lineup.find(x => d.positions[x] === 'CF'); });
    await p.click(`.lu-row[data-id="${id}"]`);
    await p.click(`.lu-row[data-id="${cf}"]`);
  }
  assert.ok(await inLineup(), 'he is in the batting order');
  assert.match(await p.textContent('.lu'), /Custom|Rocket Robinson/);
  await playBall(p);
  await simToFinal(p);
  const bx = await p.evaluate(id => __fc.FC.boxScore(__fc.S.game).teams[1].bat.find(b => b.id === id), id);
  assert.ok(bx && bx.pa > 0, 'he batted');
  await p.click('#panel [data-a=toPost]');
  await p.click('[data-a=newFromEnd]');
  await p.click('[data-a=editor]');
  await p.click('[data-a=edPanel][data-v=share]');
  const json = await p.inputValue('#shareOut');
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.click('[data-a=editor]');
  await p.fill('#edq', 'Rocket');
  assert.equal(await p.$$eval('.pool .pr', e => e.length), 0, 'gone after clearing storage');
  await p.click('[data-a=edPanel][data-v=share]');
  await p.fill('#shareIn', json);
  await p.click('[data-a=edImport]');
  await p.reload();
  await p.click('[data-a=editor]');
  await p.fill('#edq', 'Rocket');
  assert.match(await p.textContent('.pool'), /Rocket Robinson\s*Custom/);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('extra innings start with a runner on second; a walk-off ends the game at once', async () => {
  const p = await open();
  await newExhibition(p, { home: true });
  await playBall(p);
  // a 3-3 tie after six, then reload into the top of the 7th
  const ghostLine = await p.evaluate(() => {
    const FC = __fc.FC, g = __fc.S.game;
    g.pa = null; g.need = null; g.lines = [];
    g.inning = 6; g.half = 1; g.score = [3, 3];
    g.line = [[0, 1, 0, 2, 0, 0], [1, 0, 2, 0, 0, 0]];
    FC._t.endHalf(g); FC.runUntilUser(g); __fc.save();
    return g.lines.some(l => l.ev === 'ghost');
  });
  await p.reload();
  await p.waitForSelector('#panel');
  const bases = () => p.evaluate(() => ({ inn: document.querySelector('#bug .inn').textContent, on: ['b1', 'b2', 'b3'].filter(k => document.querySelector('#bug .diamond .' + k).classList.contains('on')) }));
  assert.deepEqual(await bases(), { inn: '▲ 7', on: ['b2'] });
  assert.ok(ghostLine, 'the runner placed on second is announced');
  // a quick top half: called strikes until the side is out
  await p.evaluate(() => { __fc.S.game.script = Array.from({ length: 30 }, () => ({ res: 'cstrike' })); });
  let st;
  for (let i = 0; i < 40; i++) {
    st = await settle(p);
    if (st === 'off' || st === 'over') break;
    if (st === 'forced') { await p.click('#panel [data-a=forcedAuto]'); continue; }
    await p.click('#panel [data-v=pitch]');
    await p.click('#panel [data-a=throw]');
  }
  assert.equal(st, 'off');
  assert.deepEqual(await bases(), { inn: '▼ 7', on: ['b2'] });
  // the walk-off double
  await p.evaluate(() => { __fc.S.game.script = [{ res: 'bip', bt: 'ld', out: 's2' }]; });
  await p.click('#panel [data-v=swing]');
  await p.click('#panel [data-a=swing]');
  const evs = await p.evaluate(() => __fc.S.game.lines.map(l => l.ev).filter(Boolean));
  assert.equal(evs[evs.length - 1], 'final');
  assert.equal(evs[evs.length - 2], 'walkoff');
  const g = await p.evaluate(() => { const g = __fc.S.game; return { over: g.over, winner: g.winner, score: g.score, outs: g.outs, inning: g.inning, half: g.half }; });
  assert.deepEqual(g, { over: true, winner: 1, score: [3, 4], outs: g.outs, inning: 7, half: 1 });
  assert.ok(g.outs < 3);
  assert.equal(await settle(p), 'over');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('a forced faint: result first, picker can\'t be dismissed, FNT can\'t be picked, reliever inherits; BULLPEN shows its reason', async () => {
  const p = await open();
  await newExhibition(p, { home: true });
  let st = await playBall(p);
  assert.equal(st, 'def');
  assert.ok(await p.evaluate(() => __fc.forceFaint()));
  const starter = await p.evaluate(() => __fc.FC.curPitcherId(__fc.S.game));
  await p.click('#panel [data-v=pitch]');
  await p.click('#panel [data-a=throw]');
  const lines = await p.evaluate(() => __fc.S.game.lines.map(l => l.t));
  const hit = lines.findIndex(t => /single/i.test(t)), faint = lines.findIndex(t => /faint/i.test(t));
  assert.ok(hit >= 0 && faint > hit, 'the single plays before the faint: ' + JSON.stringify(lines));
  // capture the faint mid-playback
  await p.waitForFunction(() => document.querySelector('.spr.faint'), null, { timeout: 8000 }).catch(() => {});
  await shot(p, '09-faint');
  st = await settle(p);
  assert.equal(st, 'forced');
  await shot(p, '10-forced-picker');
  assert.equal(await p.$('#panel .bbtn'), null, 'no Back button');
  await p.keyboard.press('Escape');
  assert.equal(await state(p), 'forced', 'Escape does not dismiss it');
  const fnt = await p.$$eval('#panel .bag-item[data-a=pen]', els => els.filter(e => e.querySelector('.fnt')).map(e => [+e.dataset.id, e.disabled]));
  assert.ok(fnt.some(([id, dis]) => id === starter && dis), 'the fainted starter is listed FNT and disabled');
  // reload on the picker reopens it
  await p.reload();
  await p.waitForSelector('#panel');
  assert.equal(await state(p), 'forced');
  const pick = await p.$eval('#panel .bag-item[data-a=pen]:not([disabled])', e => +e.dataset.id);
  await p.click(`#panel .bag-item[data-a=pen][data-id="${pick}"]`);
  st = await settle(p);
  const g = await p.evaluate(() => { const g = __fc.S.game; return { pit: __fc.FC.curPitcherId(g), first: !!g.bases[0], count: [g.balls, g.strikes], need: g.need, outs: g.outs, uiPit: __fc.UI.V.pit.id }; });
  assert.equal(g.pit, pick); assert.equal(g.uiPit, pick);
  assert.ok(g.first, 'he inherits the runner on first');
  // 3-batter minimum: BULLPEN is disabled and says why
  if (st === 'def') {
    assert.ok(await p.$('#panel [data-v=pen][aria-disabled=true]'));
    await p.click('#panel [data-v=pen]', { force: true });
    assert.match(await p.textContent('#panel'), /must face \d more batters? \(3-batter minimum\)/);
    assert.equal(await state(p), 'def', 'the bullpen list does not open');
  }
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('reload after a mid at-bat change restores the reliever, count, runners, score and bars', async () => {
  const p = await open();
  await newExhibition(p, { home: true });
  await playBall(p);
  const r = rng(99);
  // get to a 1-1 or deeper count with the starter able to leave (after his 3rd batter)
  let ok = false;
  for (let i = 0; i < 800 && !ok; i++) {
    const st = await settle(p);
    if (st === 'def') ok = await p.evaluate(() => { const g = __fc.S.game, P = g.P[__fc.FC.curPitcherId(g)]; return g.balls + g.strikes >= 2 && P.pt.min3 >= 3 && !__fc.FC.bullpenState(g, g.user).reason; });
    if (ok || st === 'over') break;
    await randomStep(p, r);
  }
  assert.ok(ok, 'reached a count with the starter removable');
  const before = await p.evaluate(() => { const g = __fc.S.game; return { count: [g.balls, g.strikes], bid: g.pa.bid }; });
  await p.click('#panel [data-v=pen]');
  const pick = await p.$eval('#panel .bag-item[data-a=pen]:not([disabled])', e => +e.dataset.id);
  await p.click(`#panel .bag-item[data-a=pen][data-id="${pick}"]`);
  await settle(p);
  const read = () => p.evaluate(() => {
    const g = __fc.S.game, q = s => document.querySelector(s);
    return { pit: __fc.FC.curPitcherId(g), bid: g.pa && g.pa.bid, count: [g.balls, g.strikes], bases: g.bases.map(b => b && b.id), score: g.score.slice(), outs: g.outs,
      bug: q('#bug').innerText, boxes: [q('#boxU').getAttribute('aria-label'), q('#boxO').getAttribute('aria-label')], bars: [...document.querySelectorAll('.sbox .hp-fill')].map(e => e.style.width) };
  });
  const mid = await read();
  const stored = await p.evaluate(() => { const t = localStorage.getItem('fullcount-save-v1'); try { const u = __fc.FC.unpack(t); return { len: t && t.length, ok: !!(u && u.game) }; } catch (e) { return { len: t && t.length, err: e.message + ' ' + e.stack }; } });
  assert.ok(stored.ok, 'the save unpacks: ' + JSON.stringify(stored));
  assert.equal(mid.pit, pick);
  assert.equal(mid.bid, before.bid, 'same batter');
  assert.deepEqual(mid.count, before.count, 'the reliever inherits the count');
  await p.reload();
  await p.waitForSelector('#panel', { timeout: 5000 }).catch(async () => { throw new Error('no game after reload: ' + p.errors.join(' | ') + ' :: ' + (await p.evaluate(() => document.getElementById('app').innerText.slice(0, 200)))); });
  assert.deepEqual(await read(), mid);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

for (const [label, vp] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`pitcher bars render with labels, numbers and the budget tick (${label}); debug colors`, async () => {
    const p = await open(vp);
    await newExhibition(p, { home: true });
    await playBall(p);
    const box = await p.evaluate(() => {
      const b = document.querySelector('#boxU'), r = el => el.getBoundingClientRect();
      const tick = b.querySelector('.tick'), bar = b.querySelector('.ftf').parentNode;
      return { labels: [...b.querySelectorAll('.hp-lab')].map(e => e.textContent), text: b.querySelector('.hpt').textContent, np: b.querySelector('.npt').textContent,
        tickIn: r(tick).left > r(bar).left && r(tick).right <= r(bar).right + 1, lv: b.querySelector('.sb-lv').textContent, dots: b.querySelectorAll('.sb-dots .dot').length,
        oppLv: document.querySelector('#boxO .sb-lv').textContent, oppDots: document.querySelectorAll('#boxO .sb-dots .dot').length };
    });
    assert.deepEqual(box.labels, ['HP', 'FTG']);
    assert.match(box.text, /^HP 100\/100/);
    assert.match(box.np, /^P \d+/);
    assert.ok(box.tickIn, 'the budget tick sits inside the Fatigue bar');
    assert.match(box.lv, /^Lv\d+/); assert.match(box.oppLv, /^Lv\d+/);
    assert.ok(box.dots >= 1 && box.oppDots >= 1, 'type dots on both status boxes');
    const cls = async o => { await p.evaluate(o => __fc.setBars(o), o); return p.evaluate(() => [document.querySelector('#boxU .hpf').className, document.querySelector('#boxU .ftf').className]); };
    assert.deepEqual(await cls({ hp: 30 }), ['hp-fill hpf y', 'hp-fill ftf']);
    assert.deepEqual(await cls({ hp: 15 }), ['hp-fill hpf r', 'hp-fill ftf']);
    assert.deepEqual(await cls({ hp: 100, pastBudget: true }), ['hp-fill hpf', 'hp-fill ftf r']);
    if (label === 'desktop') { await p.evaluate(() => __fc.setBars({ hp: 64, used: 70 })); await p.waitForTimeout(700); await shot(p, '13-desktop-at-bat'); }
    assert.deepEqual(p.errors, []);
    await p.context().close();
  });
}

test('types: a pitch card says "Super effective" against a matching batter; the Chart tab shows all 18 types; box notes', async () => {
  const p = await open();
  await newExhibition(p, { home: true });
  await playBall(p);
  // give the batter a type the first pitch hits for 2x
  const want = await p.evaluate(() => {
    const g = __fc.S.game, FC = __fc.FC, P = g.P[FC.curPitcherId(g)], B = g.P[g.pa.bid];
    const t = P.p.pitches[0].type;
    const d = FC.TYPES.names.find(n => FC.TYPES.mult(t, [n]) === 2);
    B.types = [d]; return { t, d, last: B.last };
  });
  await p.click('#panel [data-v=pitch]');
  if (await p.getAttribute('#panel [data-a=psel][data-i="0"]', 'aria-pressed') !== 'true') await p.click('#panel [data-a=psel][data-i="0"]');
  assert.match(await p.textContent('#panel [data-a=psel][data-i="0"] .eff'), /2×/);
  assert.match(await p.textContent('#panel .mi-desc'), new RegExp(`Super effective against ${want.last}`));
  await shot(p, '11-super-effective-card');
  await p.click('#panel [data-a=menu][data-v=cmd]');
  await p.click('[data-a=stats]');
  await p.click('[data-a=stab][data-v=chart]');
  assert.equal(await p.$$eval('.tchart tbody tr', e => e.length), 18);
  assert.equal(await p.$$eval('.tchart thead th.c', e => e.length), 18);
  await shot(p, '12-type-chart');
  await p.click('[data-a=closeSheet] >> nth=1').catch(() => p.keyboard.press('Escape'));
  await simToFinal(p);
  await p.click('[data-a=stats]');
  await p.waitForSelector('.sheet .notes');
  assert.match(await p.textContent('.sheet .notes'), /Pitches-strikes:/);
  await p.$eval('.sheet .notes', el => el.scrollIntoView());
  await shot(p, '14-box-score-notes');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('Pennant Run: a level-up screen after a game; editor types and level persist through reload and export/import', async () => {
  const p = await open();
  await p.click('label[for=m_pennant]');
  await p.click('button[type=submit]');
  await p.click('[data-a=startMode]');
  await p.waitForSelector('.badges');
  await shot(p, '15-pennant-hub', true);
  await p.click('[data-a=toLineup]');
  await playBall(p);
  await simToFinal(p);
  await p.click('#panel [data-a=toPost]');
  await p.waitForSelector('.verdict');
  const ups = await p.$$eval('.evo b', e => e.map(x => x.textContent));
  assert.ok(ups.length >= 1 && ups.every(t => /grew to Lv\. \d+!/.test(t)), JSON.stringify(ups));
  await shot(p, '16-level-up', true);
  await p.click('[data-a=postNext]');
  // editor: types and level
  await p.click('[data-a=resetSave]'); await p.click('[data-a=resetSave]');
  await p.click('[data-a=editor]');
  await p.fill('#edq', 'Aaron Judge');
  await p.click('.pool .pr >> nth=0');
  await p.selectOption('[data-ed=type][data-n="1"]', 'Lucky Charm');
  await p.fill('[data-ed=level]', '77');
  await p.$eval('[data-ed=level]', el => el.dispatchEvent(new Event('change', { bubbles: true })));
  await p.click('[data-a=edSave]');
  const check = async () => {
    await p.click('[data-a=editor]').catch(() => {});
    await p.fill('#edq', 'Aaron Judge');
    await p.click('.pool .pr >> nth=0');
    const r = { t2: await p.inputValue('[data-ed=type][data-n="1"]'), lvl: await p.inputValue('[data-ed=level]') };
    await p.click('[data-a=edClose]');
    return r;
  };
  await p.reload();
  assert.deepEqual(await check(), { t2: 'Lucky Charm', lvl: '77' });
  await p.click('[data-a=edPanel][data-v=share]');
  const json = await p.inputValue('#shareOut');
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  assert.notDeepEqual(await check(), { t2: 'Lucky Charm', lvl: '77' });
  await p.click('[data-a=edPanel][data-v=share]');
  await p.fill('#shareIn', json);
  await p.click('[data-a=edImport]');
  await p.reload();
  assert.deepEqual(await check(), { t2: 'Lucky Charm', lvl: '77' });
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('editor rosters: a team\'s batting order and rotation are saved and used by the lineup card', async () => {
  const p = await open();
  await p.click('[data-a=editor]');
  await p.click('[data-a=edPanel][data-v=teams]');
  await p.click('[data-a=edRoster][data-v=NYY]');
  const d0 = await p.evaluate(() => { const r = __fc.UI.ed.roster; return { lineup: r.lineup.slice(), rot: r.rotation.slice() }; });
  // swap the first two hitters and the first two starters
  await p.click(`.lu-row[data-a=rsPick][data-id="${d0.lineup[0]}"]`);
  await p.click(`.lu-row[data-a=rsPick][data-id="${d0.lineup[1]}"]`);
  await p.click(`.lu-row[data-a=rsRot][data-id="${d0.rot[0]}"]`);
  await p.click(`.lu-row[data-a=rsRot][data-id="${d0.rot[1]}"]`);
  await shot(p, '17-editor-roster', true);
  await p.click('[data-a=rsSave]');
  await p.reload();
  await p.click('[data-a=editor]');
  await p.click('[data-a=edBack]');
  await newExhibition(p, { home: true, team: 'NYY' });
  const card = await p.evaluate(() => { const d = __fc.UI.luDraft; return { first: d.lineup[0], second: d.lineup[1], starter: d.starter }; });
  assert.deepEqual(card, { first: d0.lineup[1], second: d0.lineup[0], starter: d0.rot[1] });
  // back to the real order
  await p.click('[data-a=lineupBack]');
  await p.click('[data-a=editor]');
  await p.click('[data-a=edPanel][data-v=teams]');
  await p.click('[data-a=edRoster][data-v=NYY]');
  await p.click('[data-a=rsReset]');
  assert.deepEqual(await p.evaluate(() => __fc.UI.ed.roster.lineup), d0.lineup);
  assert.equal(await p.evaluate(() => __fc.FC.OV.teams.NYY), undefined);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

// Swipe across the pad so the stroke's midpoint lands `offset` ms from the ball reaching the plate.
// Synthetic pointer events on exact timers; the real handlers grade them.
function swipeAt(p, offset) {
  return p.evaluate(offset => new Promise(res => {
    const tm = __fc.UI.tm, pad = document.getElementById('pad'), b = pad.getBoundingClientRect();
    const shape = tm.info.shape, dx = shape === 'chop' ? 40 : 160, dy = shape === 'uppercut' ? -70 : shape === 'chop' ? 60 : 0;
    const dur = 120, t0 = tm.arr + offset - dur / 2;
    const fire = (type, f) => pad.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: b.left + b.width * 0.25 + dx * f, clientY: b.top + b.height * 0.55 + dy * f }));
    const wait = t => new Promise(r => setTimeout(r, Math.max(0, t - performance.now())));
    (async () => {
      await wait(t0); fire('pointerdown', 0);
      for (let i = 1; i <= 6; i++) { await wait(t0 + dur * i / 6); fire(i === 6 ? 'pointerup' : 'pointermove', i / 6); }
      await new Promise(r => setTimeout(r, 20));
      res(__fc.UI.tm && __fc.UI.tm.res);
    })();
  }), offset);
}
async function toOwnAtBat(p) {
  for (let i = 0; i < 400; i++) {
    const st = await settle(p);
    if (st === 'off') return;
    if (st === 'def') await p.click('#panel [data-a=auto]');
    else if (st === 'forced') await p.click('#panel [data-a=forcedAuto]');
    else if (st === 'timing') await p.waitForFunction(() => !__fc.UI.tm, null, { timeout: 5000 });
  }
  throw new Error('never came up to bat');
}
async function pickSwing(p) {
  await p.click('#panel [data-v=swing]');
  if (await p.getAttribute('#panel [data-a=asel][data-v=normal]', 'aria-pressed') !== 'true') await p.click('#panel [data-a=asel][data-v=normal]');
  await p.click('#panel [data-a=swing]');
  await p.waitForSelector('#pad');
  await p.waitForFunction(() => __fc.UI.tm && __fc.UI.tm.phase === 'live');
}

test('timed swing: the pitch comes in, a swipe on time grades Perfect, a late one Late, and holding off takes it', async () => {
  const p = await open(PHONE, { timing: true });
  await newExhibition(p, { home: false });
  await playBall(p);
  await toOwnAtBat(p);
  await pickSwing(p);
  await p.waitForFunction(() => performance.now() > __fc.UI.tm.t0 + __fc.UI.tm.info.flight * 0.6);
  await shot(p, '18-swing-pad');
  const perfect = await swipeAt(p, 0);
  assert.equal(perfect.grade, 'perfect', JSON.stringify(perfect));
  assert.ok(perfect.shapeOK);
  await shot(p, '19-swing-perfect');
  await p.waitForFunction(() => !__fc.UI.tm, null, { timeout: 5000 });
  const lines = await p.evaluate(() => __fc.S.game.lines.map(l => l.t));
  assert.ok(lines.some(t => /Perfect timing/.test(t)), JSON.stringify(lines));
  assert.ok(lines.some(t => / deals a \d+ mph /.test(t)), 'the pitch is narrated after the swing');
  // a late swing
  await toOwnAtBat(p); await pickSwing(p);
  const late = await swipeAt(p, 210);
  assert.equal(late.grade, 'late', JSON.stringify(late));
  await p.waitForFunction(() => !__fc.UI.tm, null, { timeout: 5000 });
  // hold: the pitch is taken and counted
  await toOwnAtBat(p); await pickSwing(p);
  const before = await p.evaluate(() => { const g = __fc.S.game; return { pid: g.pa.pid, np: g.P[g.pa.pid].pt.np }; });
  await p.waitForFunction(() => !__fc.UI.tm || __fc.UI.tm.done, null, { timeout: 5000 });
  assert.deepEqual(await p.evaluate(() => __fc.UI.tm && __fc.UI.tm.res), { swing: false });
  await p.waitForFunction(() => !__fc.UI.tm, null, { timeout: 5000 });
  const evs = await p.evaluate(() => __fc.S.game.lines.map(l => l.ev));
  assert.ok(evs.includes('pitch') && (evs.includes('ball') || evs.includes('strike') || evs.includes('bb') || evs.includes('k') || evs.includes('hbp')), JSON.stringify(evs));
  assert.equal(await p.evaluate(pid => __fc.S.game.P[pid].pt.np, before.pid), before.np + 1);
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

test('timed swing: a reload mid-pitch shows the same pitch again; Space swings on desktop; Menus only skips the pad', async () => {
  const p = await open(DESKTOP, { timing: true });
  await newExhibition(p, { home: false });
  await playBall(p);
  await toOwnAtBat(p);
  await pickSwing(p);
  const info = await p.evaluate(() => __fc.FC.timingInfo(__fc.S.game));
  await p.reload();
  await p.waitForSelector('#pad');
  await p.waitForFunction(() => __fc.UI.tm && __fc.UI.tm.phase === 'live');
  assert.deepEqual(await p.evaluate(() => __fc.FC.timingInfo(__fc.S.game)), info, 'no rerolling the pitch');
  // Space at the plate
  await p.evaluate(() => new Promise(r => setTimeout(r, Math.max(0, __fc.UI.tm.arr - performance.now()))));
  await p.keyboard.press('Space');
  const res = await p.evaluate(() => __fc.UI.tm && __fc.UI.tm.res);
  assert.ok(res && res.swing && ['perfect', 'good', 'ok'].includes(res.grade), JSON.stringify(res));
  await p.waitForFunction(() => !__fc.UI.tm, null, { timeout: 5000 });
  // switch to menus only from the bench
  await toOwnAtBat(p);
  await p.click('#panel [data-v=bench]');
  await p.click('#panel [data-a=pref][data-k=timing][data-v=off]');
  await p.click('#panel [data-a=menu][data-v=cmd]');
  await p.click('#panel [data-v=swing]');
  await p.click('#panel [data-a=swing]');
  assert.equal(await p.$('#pad'), null);
  assert.equal(await state(p), 'playing');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});

// A Pokémon GO style throw on the mound pad: circle the ball `spin` turns (+ counterclockwise), wait for the
// ring to reach `rr`, then flick at `aim` ('ghost' = the aim marker, 'wide' = far right of the target).
function flick(p, { spin = 0, aim = 'ghost', rr = 0.25, speed = 2.6 } = {}) {
  return p.evaluate(plan => new Promise(res => {
    const th = __fc.UI.th, g = th.geo, pad = document.getElementById('mpad'), b = pad.getBoundingClientRect();
    const fire = (type, x, y) => pad.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: b.left + x, clientY: b.top + y }));
    const wait = ms => new Promise(r => setTimeout(r, ms));
    (async () => {
      const R = g.br * 1.5, sg = Math.sign(plan.spin), turns = Math.abs(plan.spin), steps = Math.ceil(turns * 24);
      fire('pointerdown', g.bx + R, g.by);
      for (let i = 1; i <= steps; i++) { const a = sg * (i / steps) * turns * 2 * Math.PI; fire('pointermove', g.bx + R * Math.cos(a), g.by - R * Math.sin(a)); await wait(8); }
      fire('pointermove', g.bx, g.by - g.br * 0.5); await wait(10);
      const flickMs = 72, period = 1300, phase = (1 - plan.rr) / 0.85 * period;
      let delay = phase - flickMs - (performance.now() - th.t0) % period; while (delay < 0) delay += period;
      await wait(delay);
      const target = plan.aim === 'ghost' ? th.ghostPt : [g.T[0] + g.rt * 6, g.T[1]];
      const sx = g.bx, sy = g.by - g.br * 0.5, L = Math.hypot(target[0] - sx, target[1] - sy), ux = (target[0] - sx) / L, uy = (target[1] - sy) / L, step = plan.speed * flickMs / 6;
      for (let i = 1; i <= 6; i++) { await wait(flickMs / 6); fire(i === 6 ? 'pointerup' : 'pointermove', sx + ux * step * i, sy + uy * step * i); }
      await wait(20);
      res(th.res ? { acc: th.res.acc, spin: th.res.spin } : null);
    })();
  }), { spin, aim, rr, speed });
}
async function toMound(p, find) {
  for (let i = 0; i < 400; i++) {
    const st = await settle(p);
    if (st === 'def') break;
    if (st === 'off') await p.click('#panel [data-a=auto]');
    else if (st === 'forced') await p.click('#panel [data-a=forcedAuto]');
  }
  await p.click('#panel [data-v=pitch]');
  const idx = await p.evaluate(codes => { const g = __fc.S.game, P = g.P[__fc.FC.curPitcherId(g)]; const i = P.p.pitches.findIndex(x => codes.includes(x.code)); return i; }, find);
  const i = Math.max(0, idx);
  if (await p.getAttribute(`#panel [data-a=psel][data-i="${i}"]`, 'aria-pressed') !== 'true') await p.click(`#panel [data-a=psel][data-i="${i}"]`);
  await p.click('#panel [data-a=loc][data-v=edge]');
  await p.click('#panel [data-a=throw]');
  await p.waitForSelector('#mpad');
  await p.waitForFunction(() => __fc.UI.th && __fc.UI.th.geo && __fc.UI.th.ghostPt);
  return p.evaluate(() => { const t = __fc.UI.th.info; return { code: t.code, need: t.need, sign: t.need === 'glove' ? (t.throws === 'L' ? -1 : 1) : t.need === 'arm' ? (t.throws === 'L' ? 1 : -1) : 0 }; });
}

test('thrown pitch: spin the right way and flick at the aim marker when the ring is small for Excellent; no spin hangs it; a wide flick is wild', async () => {
  const p = await open(PHONE, { pitching: true });
  await newExhibition(p, { home: true });
  await playBall(p);
  const brk = ['SL', 'ST', 'CU', 'KC', 'SV', 'CH', 'FC', 'SI'];
  let info = await toMound(p, brk);
  await shot(p, '20-mound');
  const best = await flick(p, { spin: info.sign * 1.7, aim: 'ghost', rr: 0.22 });
  assert.equal(best.acc, 'excellent', JSON.stringify({ info, best }));
  if (info.sign) assert.equal(best.spin, 'sharp');
  await shot(p, '21-mound-excellent');
  await p.waitForFunction(() => !__fc.UI.th, null, { timeout: 5000 });
  const lines = await p.evaluate(() => __fc.S.game.lines.map(l => l.t));
  assert.ok(lines.includes('Right on the spot!'), JSON.stringify(lines));
  // a breaking ball with no spin
  info = await toMound(p, brk);
  const flat = await flick(p, { spin: 0, aim: 'ghost', rr: 0.55 });
  if (info.sign) assert.equal(flat.spin, 'hang', JSON.stringify({ info, flat }));
  assert.equal(flat.acc, 'great');
  await p.waitForFunction(() => !__fc.UI.th, null, { timeout: 5000 });
  // way off target
  await toMound(p, ['FF', 'SI']);
  const wild = await flick(p, { spin: 0, aim: 'wide', rr: 0.9, speed: 2 });
  assert.equal(wild.acc, 'wild');
  await p.waitForFunction(() => !__fc.UI.th, null, { timeout: 5000 });
  // Back returns to the pitch menu; Throw without flicking pitches from the menu
  await toMound(p, ['FF']);
  await p.click('#panel .bbtn');
  assert.ok(await p.$('#panel [data-a=psel]'), 'back on the pitch menu');
  await p.click('#panel [data-a=throw]');
  await p.waitForSelector('#mpad');
  await p.click('#panel [data-a=quickThrow]');
  assert.equal(await state(p), 'playing');
  assert.deepEqual(p.errors, []);
  await p.context().close();
});
