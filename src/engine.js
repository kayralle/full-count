/* Full Count engine. No DOM: runs in the browser and in node (tools/, tests/).
   Sections: utils · data and ratings · TYPES · LEVELS · players · plate appearance model ·
   game state · baserunning and scoring · BARS (health, fatigue, fainting) · managers ·
   modes (Exhibition, Season, Pennant Run) · saving. */
(function (root) {
'use strict';
const DATA = root.DATA || (typeof require !== 'undefined' ? require('./data.js') : null);
const LG = DATA.league;

/* ================================================================ utils */
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const logit = p => Math.log(p / (1 - p));
const sig = x => 1 / (1 + Math.exp(-x));
const odds = p => p / (1 - p);
const fromOdds = o => o / (1 + o);
const cp = p => clamp(p, 0.02, 0.95);       // every engine probability stays in 0.02..0.95
const cpw = p => clamp(p, 0.0001, 0.9999);  // wide clamp for rare events (HBP, WP)
const sum = a => a.reduce((x, y) => x + y, 0);
const lastName = n => { const s = String(n).split(' '); return s.length > 1 && /^(Jr\.?|Sr\.?|II|III|IV)$/.test(s[s.length - 1]) ? s[s.length - 2] : s[s.length - 1]; };
function log5(b, p, l) {
  b = clamp(b, 1e-4, 1 - 1e-4); p = clamp(p, 1e-4, 1 - 1e-4); l = clamp(l, 1e-4, 1 - 1e-4);
  const n = b * p / l, d = (1 - b) * (1 - p) / (1 - l);
  return n / (n + d);
}
// Seeded RNG (mulberry32). State is one uint32 so saves can store it.
function rngNext(g, key) {
  let t = (g[key] = (g[key] + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const R = g => rngNext(g, 'rng');      // play RNG: pitches and plays
const RA = g => rngNext(g, 'aux');     // aux RNG: bars (comebackers, injuries), never the play RNG
function wpick(g, items, weights, rnd) {
  const tot = sum(weights); let x = (rnd || R)(g) * tot;
  for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x <= 0) return items[i]; }
  return items[items.length - 1];
}
function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

/* ================================================================ data and ratings
   Ratings are percentiles (1-99) of an underlying rate among qualified players. The engine runs on
   rates. A rating change (edit, IV, EV) moves the rate along the real league range: the shift is the
   quantile difference in logit space, so an unedited player keeps his exact real rate. */
const Q = DATA.quantiles;
function qAt(table, r) {               // rate at rating r (0..100), linear, extrapolated past the ends
  const x = clamp(r, -10, 110);
  if (x <= 0) return table[0] + (table[1] - table[0]) * x;
  if (x >= 100) return table[100] + (table[100] - table[99]) * (x - 100);
  const a = Math.floor(x), f = x - a;
  return table[a] + (table[Math.min(100, a + 1)] - table[a]) * f;
}
const HIT_STATS = ['contact', 'power', 'eye', 'gap', 'speed', 'fielding'];
const PIT_STATS = ['stuff', 'control', 'movement', 'stamina'];
const STAT_LABEL = { contact: 'Contact', power: 'Power', eye: 'Eye', gap: 'Gap', speed: 'Speed', fielding: 'Fielding',
  stuff: 'Stuff', control: 'Control', movement: 'Movement', stamina: 'Stamina' };
// Shift a probability by the change in quantile between two ratings, in logit space.
function shiftRate(rate, table, r0, r1) {
  if (Math.abs(r1 - r0) < 1e-9) return rate;
  const a = clamp(qAt(table, r0), 1e-4, 0.9999), b = clamp(qAt(table, r1), 1e-4, 0.9999);
  return sig(logit(clamp(rate, 1e-4, 0.9999)) + logit(b) - logit(a));
}
function shiftLinear(v, table, r0, r1) { return v + qAt(table, r1) - qAt(table, r0); }

const PLAYERS = DATA.players.slice();
let PBY = {};
function indexPlayers() { PBY = {}; for (const p of PLAYERS) PBY[p.id] = p; }
indexPlayers();
const TEAMS = DATA.teams.slice();
let TBY = {};
function indexTeams() { TBY = {}; for (const t of TEAMS) TBY[t.abbr] = t; }
indexTeams();

/* ---------------------------------------------------------------- overrides (player editor)
   Edits live in OV.players[id] = { ratings:{}, pitches:[...], types:[], level, iv:{}, ev:{}, name, team, pos, bats,
   throws, role }, custom players in OV.custom, roster moves and custom teams in OV.teams. Source data is never
   overwritten, so a data refresh keeps edits. */
const OV = { ver: 1, players: {}, custom: [], teams: {}, customTeams: [] };
function setOverrides(o) {
  OV.players = (o && o.players) || {}; OV.custom = (o && o.custom) || []; OV.teams = (o && o.teams) || {};
  OV.customTeams = (o && o.customTeams) || [];
  rebuildIndex();
}
function rebuildIndex() {
  PLAYERS.length = 0; for (const p of DATA.players) PLAYERS.push(p);
  for (const c of OV.custom) PLAYERS.push(c);
  indexPlayers();
  TEAMS.length = 0; for (const t of DATA.teams) TEAMS.push(t);
  for (const t of OV.customTeams) TEAMS.push(t);
  indexTeams();
  TYPES._center = null;
}
function base(id) { return PBY[id]; }
function ov(id) { return OV.players[id] || {}; }
// The player as currently edited: identity fields, ratings, pitches, types, level, IVs.
function view(id) {
  const b = PBY[id]; if (!b) return null;
  const o = ov(id);
  const kind = b.kind;
  const stats = kind === 'P' ? PIT_STATS : HIT_STATS;
  const ratings = {}, real = {};
  for (const s of stats) { real[s] = b.r[s]; ratings[s] = o.ratings && o.ratings[s] != null ? o.ratings[s] : b.r[s]; }
  const v = {
    id, kind, custom: !!b.custom, flag: b.flag || '', name: o.name || b.name, team: o.team || b.team,
    pos: o.pos || b.pos, bats: o.bats || b.bats, throws: o.throws || b.throws, role: o.role || b.role,
    age: b.age, ratings, real, rate: b.rate, line: b.line, types: (o.types && o.types.length) ? o.types : b.types,
    typeWhy: b.typeWhy, level: o.level != null ? o.level : 50, iv: Object.assign({}, b.iv, o.iv || {}),
    ev: Object.assign({}, o.ev || {}), twoWay: b.twoWay || null,
  };
  if (kind === 'P') {
    v.pitches = o.pitches || b.pitches;
    v.realPitches = b.pitches;
  }
  return v;
}
function teamPlayers(abbr) {
  const out = [];
  for (const p of PLAYERS) { const t = ov(p.id).team || p.team; if (t === abbr) out.push(p.id); }
  return out;
}

/* ================================================================ TYPES (section 11)
   The Pokemon Gen 6+ chart, renamed. Index order is the Pokemon order. */
const TYPES = {
  names: ['Grinder', 'Fireballer', 'Table Setter', 'Speedster', 'Spray Hitter', 'Closer', 'Slugger', 'Junkballer',
    'Gold Glove', 'Launcher', 'Crafty', 'Pest', 'Curveballer', 'Knuckleballer', 'Franchise', 'Intimidator', 'Workhorse',
    'Lucky Charm'],
  poke: ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic',
    'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'],
  colors: ['#a8a77a', '#ee8130', '#6390f0', '#f7d02c', '#7ac74c', '#96d9d6', '#c22e28', '#a33ea1', '#e2bf65',
    '#a98ff3', '#f95587', '#a6b91a', '#b6a136', '#735797', '#6f35fc', '#705746', '#b7b7ce', '#d685ad'],
  short: ['GRD', 'FIRE', 'TBL', 'SPD', 'SPRY', 'CLSR', 'SLUG', 'JUNK', 'GLOV', 'LNCH', 'CRFT', 'PEST', 'CRVB', 'KNUX',
    'FRAN', 'INTM', 'WORK', 'LUCK'],
  // attacking -> lists of defenders (Pokemon names): super effective, not very effective, no effect
  SE: { Normal: [], Fire: ['Grass', 'Ice', 'Bug', 'Steel'], Water: ['Fire', 'Ground', 'Rock'], Electric: ['Water', 'Flying'],
    Grass: ['Water', 'Ground', 'Rock'], Ice: ['Grass', 'Ground', 'Flying', 'Dragon'], Fighting: ['Normal', 'Ice', 'Rock', 'Dark', 'Steel'],
    Poison: ['Grass', 'Fairy'], Ground: ['Fire', 'Electric', 'Poison', 'Rock', 'Steel'], Flying: ['Grass', 'Fighting', 'Bug'],
    Psychic: ['Fighting', 'Poison'], Bug: ['Grass', 'Psychic', 'Dark'], Rock: ['Fire', 'Ice', 'Flying', 'Bug'], Ghost: ['Psychic', 'Ghost'],
    Dragon: ['Dragon'], Dark: ['Psychic', 'Ghost'], Steel: ['Ice', 'Rock', 'Fairy'], Fairy: ['Fighting', 'Dragon', 'Dark'] },
  NVE: { Normal: ['Rock', 'Steel'], Fire: ['Fire', 'Water', 'Rock', 'Dragon'], Water: ['Water', 'Grass', 'Dragon'],
    Electric: ['Electric', 'Grass', 'Dragon'], Grass: ['Fire', 'Grass', 'Poison', 'Flying', 'Bug', 'Dragon', 'Steel'],
    Ice: ['Fire', 'Water', 'Ice', 'Steel'], Fighting: ['Poison', 'Flying', 'Psychic', 'Bug', 'Fairy'], Poison: ['Poison', 'Ground', 'Rock', 'Ghost'],
    Ground: ['Grass', 'Bug'], Flying: ['Electric', 'Rock', 'Steel'], Psychic: ['Psychic', 'Steel'],
    Bug: ['Fire', 'Fighting', 'Poison', 'Flying', 'Ghost', 'Steel', 'Fairy'], Rock: ['Fighting', 'Ground', 'Steel'], Ghost: ['Dark'],
    Dragon: ['Steel'], Dark: ['Fighting', 'Dark', 'Fairy'], Steel: ['Fire', 'Water', 'Electric', 'Steel'], Fairy: ['Fire', 'Poison', 'Steel'] },
  IMM: { Normal: ['Ghost'], Electric: ['Ground'], Fighting: ['Ghost'], Poison: ['Steel'], Ground: ['Flying'], Psychic: ['Dark'],
    Ghost: ['Normal'], Dragon: ['Fairy'] },
  PITCH_TYPE: { SI: 'Workhorse', FC: 'Workhorse', SL: 'Closer', ST: 'Closer', CU: 'Curveballer', KC: 'Curveballer',
    CS: 'Curveballer', CH: 'Crafty', FS: 'Knuckleballer', FO: 'Knuckleballer', KN: 'Knuckleballer', SV: 'Junkballer',
    SC: 'Junkballer', EP: 'Grinder', LOB: 'Grinder' },
  STAB: 1.5,
  K_WHIFF: 0.10, K_HIT: 0.08, K_HR: 0.10, CAP: 0.30,   // log-odds per edge unit; cap per probability
  DMG_K: 0.35, DMG_MIN: 0.70, DMG_MAX: 1.40,
  ON: true,                                             // test hook: types off for A/B checks
  _chart: null, _center: null,
};
TYPES.idx = n => TYPES.names.indexOf(n);
(function buildChart() {
  const P = TYPES.poke, M = [];
  for (let a = 0; a < 18; a++) {
    M.push([]);
    for (let d = 0; d < 18; d++) {
      const A = P[a], D = P[d];
      M[a].push((TYPES.IMM[A] || []).includes(D) ? 0 : TYPES.SE[A].includes(D) ? 2 : TYPES.NVE[A].includes(D) ? 0.5 : 1);
    }
  }
  TYPES._chart = M;
})();
// Multiplier of an attacking type (baseball name) against a list of defending types.
TYPES.mult = function (atk, defs) {
  const a = TYPES.idx(atk); if (a < 0) return 1;
  let m = 1;
  for (const d of defs) { const j = TYPES.idx(d); if (j >= 0) m *= TYPES._chart[a][j]; }
  return m;
};
TYPES.edgeOf = m => m <= 0 ? -2 : clamp(Math.log2(m), -2, 2 + Math.log2(TYPES.STAB));
TYPES.pitchType = function (code, velo) {
  if (code === 'FF') return velo >= 95 ? 'Fireballer' : 'Grinder';
  return TYPES.PITCH_TYPE[code] || 'Grinder';
};
// Swing type: the better of the batter's own types against this pitcher.
TYPES.swing = function (btypes, ptypes) {
  let best = btypes[0], bm = -1;
  for (const t of btypes) { const m = TYPES.mult(t, ptypes); if (m > bm) { bm = m; best = t; } }
  return { type: best, mult: bm };
};
/* Centering (section 11): real stats already contain every matchup, so the raw edges are double-centered over the
   league population: by attacking type, by defending type combo, plus the grand mean. Pitch edges are weighted by
   pitch usage and hitter PA; STAB is centered per pitcher over his usage; swing edges per batter and per pitcher. */
TYPES.center = function () {
  if (TYPES._center) return TYPES._center;
  const hitters = [], pitchers = [];
  for (const p of PLAYERS) {
    const v = view(p.id); if (!v) continue;
    if (v.kind === 'H') hitters.push({ types: v.types, w: Math.max(50, (v.line && v.line.pa) || 200) });
    else pitchers.push({ id: v.id, types: v.types, w: Math.max(50, (v.line && v.line.bf) || 150), pitches: v.pitches });
  }
  const key = ts => ts.slice().sort().join('|');
  // pitch edges: rows = pitch attack type, cols = hitter type combo
  const rowS = {}, rowW = {}, colS = {}, colW = {};
  let gS = 0, gW = 0;
  const pitchUse = {};   // attack type -> total usage weight
  for (const p of pitchers) for (const x of p.pitches) { const t = x.type; pitchUse[t] = (pitchUse[t] || 0) + x.usage * p.w; }
  const hitCombos = {};
  for (const h of hitters) { const k = key(h.types); hitCombos[k] = hitCombos[k] || { types: h.types, w: 0 }; hitCombos[k].w += h.w; }
  for (const t in pitchUse) for (const k in hitCombos) {
    const e = TYPES.edgeOf(TYPES.mult(t, hitCombos[k].types)), w = pitchUse[t] * hitCombos[k].w;
    rowS[t] = (rowS[t] || 0) + e * hitCombos[k].w; rowW[t] = (rowW[t] || 0) + hitCombos[k].w;
    colS[k] = (colS[k] || 0) + e * pitchUse[t]; colW[k] = (colW[k] || 0) + pitchUse[t];
    gS += e * w; gW += w;
  }
  const pRow = {}, pCol = {};
  for (const t in rowS) pRow[t] = rowS[t] / rowW[t];
  for (const k in colS) pCol[k] = colS[k] / colW[k];
  const pGrand = gS / gW;
  // STAB per pitcher
  const stab = {};
  for (const p of pitchers) stab[p.id] = sum(p.pitches.map(x => x.usage * (p.types.includes(x.type) ? Math.log2(TYPES.STAB) : 0))) / Math.max(1e-9, sum(p.pitches.map(x => x.usage)));
  // swing edges: rows = hitter combo, cols = pitcher combo
  const pitCombos = {};
  for (const p of pitchers) { const k = key(p.types); pitCombos[k] = pitCombos[k] || { types: p.types, w: 0 }; pitCombos[k].w += p.w; }
  const sRowS = {}, sRowW = {}, sColS = {}, sColW = {}; let sg = 0, sw = 0;
  for (const hk in hitCombos) for (const pk in pitCombos) {
    const e = TYPES.edgeOf(TYPES.swing(hitCombos[hk].types, pitCombos[pk].types).mult);
    const wh = hitCombos[hk].w, wp = pitCombos[pk].w;
    sRowS[hk] = (sRowS[hk] || 0) + e * wp; sRowW[hk] = (sRowW[hk] || 0) + wp;
    sColS[pk] = (sColS[pk] || 0) + e * wh; sColW[pk] = (sColW[pk] || 0) + wh;
    sg += e * wh * wp; sw += wh * wp;
  }
  const sRow = {}, sCol = {};
  for (const k in sRowS) sRow[k] = sRowS[k] / sRowW[k];
  for (const k in sColS) sCol[k] = sColS[k] / sColW[k];
  TYPES._center = { pRow, pCol, pGrand, stab, sRow, sCol, sGrand: sg / sw, key };
  return TYPES._center;
};
// Centered pitch edge and the raw multiplier (for text), for pitch x thrown by pitcher P at batter B.
TYPES.pitchEdge = function (x, P, B) {
  const C = TYPES.center();
  const raw = TYPES.mult(x.type, B.types);
  const k = C.key(B.types);
  let e = TYPES.edgeOf(raw) - (C.pRow[x.type] != null ? C.pRow[x.type] : 0) - (C.pCol[k] != null ? C.pCol[k] : 0) + C.pGrand;
  const stabOn = P.types.includes(x.type);
  const sid = P.src != null ? P.src : P.id;
  e += (stabOn ? Math.log2(TYPES.STAB) : 0) - (C.stab[sid] != null ? C.stab[sid] : 0);
  return { e: TYPES.ON ? e : 0, raw, stab: stabOn };
};
TYPES.swingEdge = function (B, P) {
  const C = TYPES.center();
  const s = TYPES.swing(B.types, P.types);
  const hk = C.key(B.types), pk = C.key(P.types);
  const e = TYPES.edgeOf(s.mult) - (C.sRow[hk] != null ? C.sRow[hk] : 0) - (C.sCol[pk] != null ? C.sCol[pk] : 0) + C.sGrand;
  return { e: TYPES.ON ? e : 0, raw: s.mult, type: s.type };
};
TYPES.capShift = x => clamp(x, -TYPES.CAP, TYPES.CAP);
TYPES.dmgMult = eS => TYPES.ON ? clamp(Math.pow(2, TYPES.DMG_K * eS), TYPES.DMG_MIN, TYPES.DMG_MAX) : 1;
TYPES.label = m => m === 0 ? 'No effect' : m >= 2 ? 'Super effective' : m <= 0.5 ? 'Not very effective' : 'Neutral';

/* ================================================================ LEVELS (section 11) */
const LEVELS = {
  K_LEVEL: 0.015, CAP: 25,
  xpFor: L => L <= 1 ? 0 : Math.round(L * L * L),            // Medium Fast
  levelOf: xp => { let L = 1; while (L < 100 && LEVELS.xpFor(L + 1) <= xp) L++; return L; },
  ivBonus: iv => 3 * ((iv == null ? 15.5 : iv) - 15.5) / 15.5,
  evBonus: ev => 6 * (ev || 0) / 252,
  shownStat: (rating, iv, ev, L) => Math.floor((2 * (rating + 20) + (iv || 0) + Math.floor((ev || 0) / 4)) * L / 100) + 5,
  EV_MAX: 252, EV_TOTAL: 510,
  // XP units per event (section 11)
  U: { pa: 1, hit: 0.5, hr: 1, rbi: 0.5, bf: 0.8, k: 0.4, win: 1, save: 1 },
  XP_K: 0.8,
  gain(units, Lopp, Lself) {
    if (units <= 0) return 0;
    const s = Math.pow((2 * Lopp + 10) / (Lopp + Lself + 10), 2.5);
    return Math.max(1, Math.round(units * LEVELS.XP_K * Lopp * Lopp * s));
  },
  // Pennant Run stages
  LEADERS: [12, 18, 24, 30, 36, 42, 48, 54], ELITE: [60, 62, 64, 66], CHAMP: 70, ROUTES: 4, START: 5,
};
function effRating(v, stat) {
  const r = v.ratings[stat];
  return r + LEVELS.ivBonus(v.iv[stat]) + LEVELS.evBonus(v.ev[stat]);
}

/* ================================================================ game players
   A game player carries effective rates (ratings + IV + EV), level and types, plus box score and bar state.
   Everything is plain data so a save is just JSON. */
function pitchStuffDelta(v) {
  if (!v.pitches || !v.realPitches || v.pitches === v.realPitches) return 0;
  let d = 0;
  for (let i = 0; i < v.pitches.length; i++) {
    const x = v.pitches[i], r = v.realPitches.find(y => y.code === x.code) || v.realPitches[i];
    d += (x.usage || 0) * ((x.stuff != null ? x.stuff : 50) - (r ? r.stuff : 50));
  }
  return d;
}
function hitterRates(v) {
  const b = base(v.id), r = b.rate, er = {};
  for (const s of HIT_STATS) er[s] = effRating(v, s);
  const k = shiftRate(r.k, Q.contact, v.real.contact, er.contact);
  const hr = shiftRate(r.hr, Q.power, v.real.power, er.power);
  const bb = shiftRate(r.bb, Q.eye, v.real.eye, er.eye);
  const g0 = r.s2 + r.s3, g1 = shiftRate(g0, Q.gap, v.real.gap, er.gap), gf = g0 > 0 ? g1 / g0 : 1;
  const sprint = shiftLinear(r.sprint, Q.speed, v.real.speed, er.speed), ds = sprint - r.sprint;
  return {
    k, bb, hbp: r.hbp, hr, s1: r.s1, s2: r.s2 * gf, s3: r.s3 * gf * Math.exp(0.15 * ds), babip: clamp(r.babip + 0.002 * ds, 0.2, 0.4),
    sbAtt: clamp(r.sbAtt * Math.exp(0.35 * ds), 0, 0.6), sbPct: sig(logit(clamp(r.sbPct, 0.3, 0.97)) + 0.25 * ds),
    sprint, gb: r.gb, fb: r.fb, ld: r.ld, pu: r.pu, field: clamp(er.fielding, 1, 110), speedR: er.speed, pull: r.pull,
  };
}
function pitcherRates(v) {
  const b = base(v.id), r = b.rate, er = {};
  for (const s of PIT_STATS) er[s] = effRating(v, s);
  const stuffEff = er.stuff + pitchStuffDelta(v);
  const k = shiftRate(r.k, Q.stuff, v.real.stuff, stuffEff);
  const bb = shiftRate(r.bb, Q.control, v.real.control, er.control);
  const gb = shiftRate(r.gb, Q.gb, v.real.movement, er.movement);
  const hr = shiftRate(r.hr, Q.hrAllowed, v.real.movement, er.movement);
  const budget = clamp(shiftLinear(r.budget, Q.stamina, v.real.stamina, er.stamina), 12, 105);
  // the rest of the batted-ball mix keeps its proportions around the new GB share
  const rest = 1 - r.gb, nrest = 1 - gb, f = rest > 0 ? nrest / rest : 1;
  const pitches = v.pitches.map((x, i) => {
    const real = (v.realPitches || []).find(y => y.code === x.code) || (v.realPitches || [])[i];
    let whiff = x.whiff;
    if (real && x.stuff != null && real.stuff != null && Math.abs(x.stuff - real.stuff) > 1e-9) whiff = shiftRate(real.whiff, Q.pitchWhiff, real.stuff, x.stuff);
    return { code: x.code, name: x.name, fam: x.fam, type: x.type || TYPES.pitchType(x.code, x.velo), usage: x.usage, velo: x.velo,
      whiff: clamp(whiff, 0.03, 0.7), rv100: x.rv100 || 0, stuff: x.stuff != null ? x.stuff : 50 };
  });
  const tu = sum(pitches.map(x => x.usage)) || 1;
  for (const x of pitches) x.usage /= tu;
  return { k, bb, hbp: r.hbp, hr, babip: r.babip, wp: r.wp, gb, fb: r.fb * f, ld: r.ld * f, pu: r.pu * f, budget, hold: r.hold, pitches };
}
// opts: { level, ev, iv } overrides for this game (Pennant Run progression, opponents)
function makeGP(id, opts) {
  const v = view(id); if (!v) throw new Error('no player ' + id);
  opts = opts || {};
  if (opts.level != null) v.level = opts.level;
  if (opts.ev) v.ev = Object.assign({}, opts.ev);
  if (opts.iv) v.iv = Object.assign({}, v.iv, opts.iv);
  const gp = { id: v.id + (opts.offset || 0), src: v.id, name: v.name, last: lastName(v.name), team: v.team, kind: v.kind, pos: v.pos.slice(), bats: v.bats,
    throws: v.throws, role: v.role || null, types: v.types.slice(0, 2), lvl: clamp(Math.round(v.level), 1, 100), twoWay: v.twoWay,
    custom: v.custom, flag: v.flag };
  if (v.kind === 'H') gp.h = hitterRates(v);
  else gp.p = pitcherRates(v);
  gp.rt = {}; for (const st of (v.kind === 'P' ? PIT_STATS : HIT_STATS)) gp.rt[st] = Math.round(effRating(v, st));
  gp.b = { pa: 0, ab: 0, r: 0, h: 0, d2: 0, d3: 0, hr: 0, rbi: 0, bb: 0, k: 0, sb: 0, cs: 0, hbp: 0, sf: 0, sh: 0, lob: 0 };
  return gp;
}
// A position player pressed into pitching (section 5): lob fastball and eephus.
function posPitcherRates() {
  return { k: 0.06, bb: 0.10, hbp: 0.01, hr: 0.07, babip: 0.330, wp: LG.wp, gb: 0.38, fb: 0.36, ld: 0.22, pu: 0.04, budget: 60, hold: 0.85,
    pitches: [
      { code: 'LOB', name: 'Lob Fastball', fam: 'FB', type: 'Grinder', usage: 0.7, velo: 70, whiff: 0.06, rv100: -4, stuff: 1 },
      { code: 'EP', name: 'Eephus', fam: 'OS', type: 'Grinder', usage: 0.3, velo: 55, whiff: 0.08, rv100: -4, stuff: 1 }] };
}
function hitterValue(gp) {   // rough wOBA-like value for lineups and AI choices
  const h = gp.h; if (!h) return 0;
  const bip = Math.max(0, 1 - h.k - h.bb - h.hbp - h.hr);
  const hits = bip * h.babip;
  const tot = h.s1 + h.s2 + h.s3 || 1;
  return 0.69 * (h.bb) + 0.72 * h.hbp + hits * (0.89 * h.s1 + 1.27 * h.s2 + 1.62 * h.s3) / tot + 2.1 * h.hr;
}
function pitcherValue(gp) { const p = gp.p; return p ? (p.k - p.bb) * 3 - p.hr * 10 + (p.gb - 0.43) : 0; }

/* ================================================================ plate appearance model
   Pitch by pitch. Each pitch: in the zone or not → swing or not → contact or whiff → foul or in play →
   batted-ball type → outcome. Hitter and pitcher combine by log5 against the league for K, BB, HBP, HR and
   BABIP; a per-matchup solver finds the two knobs (stuff W, command A) that make the count model produce those
   PA rates under the AI policies, so real players produce real lines while every pitch choice still matters. */
const LOCS = ['attack', 'edge', 'up', 'low', 'chase'];
const LOC_LABEL = { attack: 'Attack the zone', edge: 'Paint the edge', up: 'Elevate', low: 'Bury it low', chase: 'Chase' };
const APPROACHES = ['normal', 'sitFB', 'sitBR', 'sitOS', 'protect', 'big', 'take'];
const APP_LABEL = { normal: 'Swing', sitFB: 'Sit fastball', sitBR: 'Sit breaking', sitOS: 'Sit offspeed', protect: 'Protect', big: 'Swing big', take: 'Take', bunt: 'Bunt' };
const FAM_LABEL = { FB: 'Fastball', BR: 'Breaking', OS: 'Offspeed' };
const M = {
  // zone (logit)
  Z0: -0.471,
  ZC: [[0.05, -0.05, -0.35], [0.10, 0.00, -0.25], [0.20, 0.10, -0.10], [0.40, 0.25, 0.10]],
  ZL: { attack: 1.55, edge: -0.10, up: -0.40, low: -0.50, chase: -2.40 },
  ZF: { FB: 0.15, BR: -0.15, OS: -0.20 },
  // swing (logit)
  SZ0: 0.71, SO0: -0.94,
  SZC: [[-0.75, 0.05, 0.60], [-0.15, 0.15, 0.70], [-0.05, 0.25, 0.75], [-2.30, 0.10, 0.90]],
  SOC: [[-0.55, 0.00, 0.40], [-0.20, 0.05, 0.45], [-0.35, -0.05, 0.50], [-2.30, -0.45, 0.55]],
  SZL: { attack: 0.25, edge: -0.15, up: -0.05, low: -0.10, chase: 0 },
  SOL: { attack: 0, edge: 0.55, up: 0.10, low: 0.15, chase: -0.15 },
  SOF: { FB: -0.10, BR: 0.15, OS: 0.20 },
  // contact on a swing (logit)
  CI: 2.213, CO: 0.873,
  CL: { attack: 0.30, edge: -0.10, up: -0.25, low: -0.15, chase: -0.30 },
  CLF: { FB: { up: -0.25 }, BR: { low: -0.25, chase: -0.15 }, OS: { low: -0.20, chase: -0.10 } },
  REL: 0.9,
  // foul on contact (logit)
  F0: -0.015, F2: 0.25, FL: { attack: -0.25, edge: 0.20, up: 0.10, low: 0.0, chase: 0.15 },
  // called strike on a take
  CSZ: { attack: 0.97, edge: 0.70, up: 0.82, low: 0.80, chase: 0.86 },
  CSO: { attack: 0.10, edge: 0.20, up: 0.05, low: 0.05, chase: 0.01 },
  // mistake: an in-zone pitch catches the heart of the plate
  MIS: { attack: 0.14, edge: 0.03, up: 0.07, low: 0.05, chase: 0 },
  MIS_C: 0.35, MIS_H: 0.30, MIS_HR: 0.55,
  // approaches: [zone swing, chase swing, contact, foul, hit quality, HR quality] when the guess is right / wrong / n.a.
  APP: {
    normal: { sz: 0, so: 0, c: 0, f: 0, h: 0, hr: 0 },
    protect: { sz: 0.60, so: 0.45, c: 0.55, f: 0.45, h: -0.25, hr: -0.55 },
    big: { sz: 0.20, so: 0.10, c: -0.45, f: -0.20, h: 0.05, hr: 0.40 },
    take: { sz: -9, so: -9, c: 0, f: 0, h: 0, hr: 0 },
    sitRight: { sz: 0.40, so: 0.20, c: 0.35, f: 0, h: 0.25, hr: 0.30 },
    sitWrong: { sz: -0.30, so: -0.40, c: -0.45, f: 0, h: -0.10, hr: -0.15 },
  },
  // ball-in-play quality by location [hit, hr], and for out-of-zone contact
  QL: { attack: [0.10, 0.15], edge: [-0.12, -0.15], up: [0.0, 0.20], low: [-0.04, -0.30], chase: [-0.40, -0.55] },
  QOUT: [-0.25, -0.35],
  // batted-ball type multipliers [gb, ld, fb, pu]
  BTL: { attack: [1, 1.15, 1, 1], edge: [1, 0.95, 1, 1.05], up: [0.75, 1, 1.30, 1.35], low: [1.35, 1, 0.75, 0.7], chase: [1.15, 0.8, 1, 1.3] },
  BTP: { SI: [1.25, 1, 0.85, 0.9], FF: [0.9, 1, 1.12, 1.15], CH: [1.12, 1, 0.95, 1], FS: [1.15, 1, 0.9, 1], CU: [1.08, 1, 0.97, 1], KC: [1.08, 1, 0.97, 1] },
  BTA: { big: [0.85, 1, 1.25, 1.1], protect: [1.10, 0.95, 0.9, 1.0] },
  // outcomes per batted-ball type: [hit (non-HR) rate, HR rate, 1B, 2B, 3B shares of hits]
  BT: { gb: [0.245, 0, 0.918, 0.078, 0.004], ld: [0.655, 0.025, 0.718, 0.252, 0.030], fb: [0.135, 0.125, 0.44, 0.45, 0.11], pu: [0.02, 0, 1, 0, 0] },
  // global calibration (tools/sim.js): HR odds factor, BABIP logit shift, K and BB logit shifts on the targets
  HR_ADJ: 1.0, BABIP_ADJ: 0.06, K_ADJ: -0.27, BB_ADJ: 0.05,
  // platoon (odds multipliers): same hand / opposite hand
  PLAT: { same: { k: 1.07, bb: 0.92, hr: 0.88, babip: -0.005 }, opp: { k: 0.96, bb: 1.04, hr: 1.06, babip: 0.003 } },
  // level gap (section 11)
  DEF_K: -0.0045,   // BABIP per 10 points of team fielding above 50
};
const BTI = { gb: 0, ld: 1, fb: 2, pu: 3 };
const BTN = ['gb', 'ld', 'fb', 'pu'];

/* AI policies (also what the solver assumes) */
function countCat(b, s) { if (b === 3 && s === 0) return '30'; if (b === 3 && s === 2) return 'full'; if (s > b) return 'ahead'; if (b > s) return 'behind'; return 'even'; }
const LOCW = {   // attack, edge, up, low, chase
  ahead: [0.10, 0.30, 0.15, 0.20, 0.25], even: [0.30, 0.30, 0.12, 0.18, 0.10], behind: [0.50, 0.28, 0.08, 0.10, 0.04],
  '30': [0.70, 0.22, 0.04, 0.04, 0.00], full: [0.38, 0.32, 0.10, 0.15, 0.05] };
const LOCF = { FB: [1, 1, 1.5, 0.7, 0.8], BR: [0.8, 1, 0.4, 1.5, 1.3], OS: [0.8, 1, 0.3, 1.6, 1.2] };
function aiPitchWeights(P, b, s, adapt) {
  const cat = countCat(b, s);
  return P.p.pitches.map(x => {
    let w = x.usage;
    if (cat === 'behind' || cat === '30') w *= x.fam === 'FB' ? (cat === '30' ? 2.0 : 1.35) : 0.8;
    else if (cat === 'ahead') w *= x.fam === 'FB' ? 0.8 : 1.3;
    if (adapt && adapt[x.fam]) w *= adapt[x.fam];
    return Math.max(1e-4, w);
  });
}
function aiLocWeights(fam, b, s) { const base_ = LOCW[countCat(b, s)], f = LOCF[fam]; return base_.map((w, i) => w * f[i]); }
// AI hitter approach weights for a count. sitFam: the family he'd sit on.
function aiApproachWeights(b, s) {
  if (b === 3 && s === 0) return { take: 0.85, normal: 0.15 };
  if (s === 2) return b === 3 ? { normal: 0.55, protect: 0.45 } : { normal: 0.5, protect: 0.5 };
  if ((b === 1 && s === 0) || (b === 2 && s === 0) || (b === 2 && s === 1) || (b === 3 && s === 1)) return { normal: 0.62, sit: 0.38 };
  if (b === 0 && s === 0) return { normal: 0.88, sit: 0.12 };
  return { normal: 0.9, sit: 0.1 };
}
function topFamily(P, b, s, adapt) {
  const w = aiPitchWeights(P, b, s, adapt), f = { FB: 0, BR: 0, OS: 0 };
  P.p.pitches.forEach((x, i) => { f[x.fam] += w[i]; });
  return Object.keys(f).sort((a, c) => f[c] - f[a])[0];
}

/* One pitch's probabilities for a given (pitch, location, approach) and matchup context. ctx carries the knobs and
   all additive shifts. Returns per-pitch outcome probabilities plus intermediates the resolver reuses. */
function pitchProbs(ctx, x, loc, app, b, s) {
  const fam = x.fam;
  const right = app === 'sit' + fam, sit = app.startsWith('sit');
  const A = sit ? (right ? M.APP.sitRight : M.APP.sitWrong) : (M.APP[app] || M.APP.normal);
  let zl = M.Z0 + M.ZC[b][s] + M.ZL[loc] + M.ZF[fam] + ctx.A + ctx.zAdj;
  let z = sig(zl);
  z = clamp(z * ctx.zMul, 0.01, 0.99);
  const sz = app === 'take' ? 0 : sig(M.SZ0 + M.SZC[b][s] + M.SZL[loc] + A.sz + ctx.swAdj);
  const so = app === 'take' ? 0 : sig(M.SO0 + M.SOC[b][s] + M.SOL[loc] + M.SOF[fam] + A.so + ctx.chAdj);
  const famL = (M.CLF[fam] && M.CLF[fam][loc]) || 0;
  const cbase = M.CL[loc] + famL + A.c - ctx.W + ctx.relOf(x) + ctx.cAdj + ctx.typeC(x);
  const mis = clamp(M.MIS[loc] + ctx.misAdd, 0, 0.6);
  let cInN = sig(M.CI + cbase), cInM = sig(M.CI + cbase + M.MIS_C), cOut = sig(M.CO + cbase);
  // fatigue: whiff rate x (1 - 0.20 pF), so contact rises as he tires
  if (ctx.whiffMul !== 1) { const w = ctx.whiffMul; cInN = 1 - (1 - cInN) * w; cInM = 1 - (1 - cInM) * w; cOut = 1 - (1 - cOut) * w; }
  const cIn = (1 - mis) * cInN + mis * cInM;
  const fl = M.F0 + (s === 2 ? M.F2 : 0) + M.FL[loc] + A.f;
  const fIn = sig(fl), fOut = sig(fl + 0.15);
  const csz = M.CSZ[loc], cso = M.CSO[loc];
  const take0 = (1 - z) * (1 - so);
  const hbp = take0 * ctx.q;
  const ball = take0 * (1 - cso) * (1 - ctx.q) + z * (1 - sz) * (1 - csz);
  const strikeC = take0 * cso * (1 - ctx.q) + z * (1 - sz) * csz;
  const whiff = z * sz * (1 - cIn) + (1 - z) * so * (1 - cOut);
  const foul = z * sz * cIn * fIn + (1 - z) * so * cOut * fOut;
  const bipIn = z * sz * cIn * (1 - fIn), bipOut = (1 - z) * so * cOut * (1 - fOut);
  return { z, sz, so, cIn, cInN, cInM, cOut, fIn, fOut, csz, cso, mis, hbp, ball, strikeC, whiff, foul, bip: bipIn + bipOut, bipIn, bipOut, ooz: take0, A, right, sit };
}

/* Aggregate per-count transition probabilities under the AI policies, then run the count DP. */
function countDP(ctx, P) {
  const T = [];
  for (let b = 0; b < 4; b++) {
    T.push([]);
    for (let s = 0; s < 3; s++) {
      const pw = aiPitchWeights(P, b, s, null), pt = sum(pw);
      const aw = aiApproachWeights(b, s), sitFam = topFamily(P, b, s, null);
      const apps = [];
      for (const k in aw) apps.push([k === 'sit' ? 'sit' + sitFam : k, aw[k]]);
      let ball = 0, strike = 0, foul = 0, bip = 0, hbp = 0, ooz = 0;
      P.p.pitches.forEach((x, i) => {
        const lw = aiLocWeights(x.fam, b, s), lt = sum(lw);
        for (let li = 0; li < 5; li++) {
          if (lw[li] <= 0) continue;
          for (const [a, aW] of apps) {
            const w = pw[i] / pt * lw[li] / lt * aW;
            const pr = pitchProbs(ctx, x, LOCS[li], a, b, s);
            ball += w * pr.ball; strike += w * (pr.strikeC + pr.whiff); foul += w * pr.foul; bip += w * pr.bip; hbp += w * pr.hbp; ooz += w * pr.ooz;
          }
        }
      });
      T[b].push({ ball, strike, foul, bip, hbp, ooz });
    }
  }
  // DP over counts. At two strikes a foul repeats the state.
  const P0 = [[1, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let K = 0, BB = 0, HBP = 0, BIP = 0, pitches = 0, oozT = 0;
  for (let n = 0; n < 7; n++) {   // process states in order of b+s
    for (let b = 0; b < 4; b++) for (let s = 0; s < 3; s++) {
      if (b + s !== n) continue;
      const pin = P0[b][s]; if (pin <= 0) continue;
      const t = T[b][s];
      let ball = t.ball, strike = t.strike, foul = t.foul, bip = t.bip, hbp = t.hbp, visits = 1;
      if (s === 2) { const loop = foul; visits = 1 / (1 - loop); ball *= visits; strike *= visits; bip *= visits; hbp *= visits; foul = 0; }
      pitches += pin * visits; oozT += pin * visits * t.ooz;
      HBP += pin * hbp; BIP += pin * bip;
      if (b === 3) BB += pin * ball; else P0[b + 1][s] += pin * ball;
      if (s === 2) K += pin * strike;
      else { P0[b][s + 1] += pin * (strike + foul); }
    }
  }
  return { K, BB, HBP, BIP, pitches, ooz: oozT };
}

/* Matchup targets by log5, platoon, calibration constants. */
function matchupTargets(B, P, ctxDef) {
  const h = B.h, p = P.p;
  const bats = B.bats === 'S' ? (P.throws === 'L' ? 'R' : 'L') : B.bats;
  const pl = bats === P.throws ? M.PLAT.same : M.PLAT.opp;
  let K = log5(h.k, p.k, LG.k), BB = log5(h.bb, p.bb, LG.bb), HBP = log5(h.hbp, p.hbp, LG.hbp), HR = log5(h.hr, p.hr, LG.hr);
  let BABIP = log5(h.babip, p.babip, LG.babip);
  K = fromOdds(odds(K) * pl.k * Math.exp(M.K_ADJ)); BB = fromOdds(odds(BB) * pl.bb * Math.exp(M.BB_ADJ));
  HR = fromOdds(odds(HR) * pl.hr * M.HR_ADJ); BABIP = clamp(BABIP + pl.babip + (ctxDef || 0), 0.15, 0.45);
  BABIP = sig(logit(BABIP) + M.BABIP_ADJ);
  return { K, BB, HBP, HR, BABIP };
}
function relFn(P) {
  const ps = P.p.pitches;
  const avg = sum(ps.map(x => x.usage * logit(clamp(x.whiff, 0.03, 0.7))));
  return x => -M.REL * (logit(clamp(x.whiff, 0.03, 0.7)) - avg);
}
function baseCtx(P) {
  return { W: 0, A: 0, q: 0.004, zAdj: 0, zMul: 1, swAdj: 0, chAdj: 0, cAdj: 0, whiffMul: 1, misAdd: 0, relOf: relFn(P), typeC: () => 0 };
}
const SOLVE_CACHE = new Map();
function solveKnobs(B, P, T) {
  const key = B.id + ':' + P.id + ':' + B.bats + P.throws + ':' + T.K.toFixed(5) + ':' + T.BB.toFixed(5) + ':' + T.HBP.toFixed(5);
  const hit = SOLVE_CACHE.get(key); if (hit) return hit;
  const ctx = baseCtx(P);
  let W = 0, A = 0, q = T.HBP / 1.6;
  const lk = logit(T.K), lb = logit(T.BB);
  const ev = (w, a) => { ctx.W = w; ctx.A = a; ctx.q = q; return countDP(ctx, P); };
  for (let it = 0; it < 8; it++) {
    const d0 = ev(W, A);
    q = clamp(T.HBP / Math.max(0.2, d0.ooz), 0, 0.05);
    const r1 = logit(clamp(d0.K, 1e-4, 0.999)) - lk, r2 = logit(clamp(d0.BB, 1e-4, 0.999)) - lb;
    if (Math.abs(r1) < 0.004 && Math.abs(r2) < 0.004) break;
    const h = 0.05;
    const dW = ev(W + h, A), dA = ev(W, A + h);
    const j11 = (logit(dW.K) - logit(d0.K)) / h, j12 = (logit(dA.K) - logit(d0.K)) / h;
    const j21 = (logit(dW.BB) - logit(d0.BB)) / h, j22 = (logit(dA.BB) - logit(d0.BB)) / h;
    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-9) break;
    W -= clamp((r1 * j22 - r2 * j12) / det, -1.5, 1.5);
    A -= clamp((r2 * j11 - r1 * j21) / det, -1.5, 1.5);
    W = clamp(W, -4, 4); A = clamp(A, -4, 4);
  }
  const fin = ev(W, A);
  const out = { W, A, q, pBIP: fin.BIP, pK: fin.K, pBB: fin.BB, pPit: fin.pitches };
  if (SOLVE_CACHE.size > 60000) SOLVE_CACHE.clear();
  SOLVE_CACHE.set(key, out);
  return out;
}
// Batted-ball mix for the matchup (before per-pitch multipliers).
function bbMix(B, P) {
  const w = BTN.map(t => B.h[t] * P.p[t] / LG[t]);
  const s = sum(w); return w.map(x => x / s);
}
// Per-PA ball-in-play calibration: HR factor and BABIP logit shift so the AI-average mix hits the targets.
function bipCalib(B, P, T, kn) {
  const mix = bbMix(B, P);
  const bipAll = Math.max(0.3, kn.pBIP);                 // P(ball in play incl. HR) from the count model
  const hrPerBip = clamp(T.HR / bipAll, 0.001, 0.25);
  const baseHR = sum(mix.map((m, i) => m * M.BT[BTN[i]][1]));
  const kHR = hrPerBip / Math.max(1e-4, baseHR);
  // solve the BABIP logit shift d
  const nonHR = mix.map((m, i) => m * (1 - clamp(M.BT[BTN[i]][1] * kHR, 0, 0.9)));
  const tot = sum(nonHR);
  let d = 0;
  for (let it = 0; it < 6; it++) {
    let f = 0, df = 0;
    nonHR.forEach((w, i) => { const p = sig(logit(M.BT[BTN[i]][0]) + d); f += w * p; df += w * p * (1 - p); });
    f /= tot; df /= tot;
    const err = f - T.BABIP; if (Math.abs(err) < 1e-5) break;
    d -= err / Math.max(1e-4, df);
  }
  return { mix, kHR, d };
}

/* ================================================================ BARS (section 5: health, fatigue, fainting)
   applyBars (after the play) is the only writer; barPenalties (before the next pitch) is the only reader. */
const BARS = {
  DMG: { bb: 4, hbp: 4, s1: 6, s2: 10, s3: 12, hr: 16, wp: 2, balk: 2 }, RUN: 9, TAINT: 5, SETTLE: 8, VISIT: 10, STEADY: 3,
  COST_BASE: 88.5, COST_RUNNER: 20, COST_LONG: 40, TANK_K: 1.3, TANK_MIN: 30,
  FAT: { zone: 0.10, whiff: 0.20, hr: 0.40, babip: 0.020, wp: 1.0, velo: 3 },
  HP_TH: 40, HPE: { zone: 0.05, mis: 0.04, wp: 0.5 },
  PF_MEAN: 0, PH_MEAN: 0,
  COMEBACK: 0.0005, COMEBACK_INJ: 0.20,
  EFFECTS: true, FAINT: true, COMEBACKER: true, DMG_SCALE: 1,
  MIN_BATTERS: 3, MIN_CARRIES: true,          // 3-batter minimum; coming back out keeps the count (CONFIG)
  WIN_IP_OUTS: 12,                            // starter needs 4.0 IP for the win (house scaling of 5.0)
  force: null,                                // test hook: { pid, hp, used }
};
function budgetOf(gp) { return clamp(Math.round(gp.p.budget), 12, 105); }
function tankOf(B) { return Math.max(Math.round(BARS.TANK_K * B), BARS.TANK_MIN); }
function initPitching(gp, isPosPlayer) {
  const B = budgetOf(gp);
  gp.pt = { outs: 0, bf: 0, h: 0, r: 0, er: 0, bb: 0, k: 0, hr: 0, np: 0, st: 0, hbp: 0, wp: 0, ir: 0, irs: 0,
    hp: 100, used: 0, B, T: tankOf(B), min3: 0, innP: 0, inn: 0, status: 'avail', exit: null, exitInn: null, defer: false,
    steady: 0, visitInn: -1, pos: !!isPosPlayer, start: false, entered: null, enterLead: null, enterSave: false, decision: null,
    ko: false, battersInn: 0, outsInn: 0, scoredHalf: false, firstHalf: null };
}
function pfOf(pt) { const used = pt.used / 100; return pt.T > pt.B ? clamp((used - pt.B) / (pt.T - pt.B), 0, 1) : (used >= pt.B ? 1 : 0); }
function phOf(pt) { return clamp((BARS.HP_TH - pt.hp) / BARS.HP_TH, 0, 1); }
function barPenalties(gp) {
  const pt = gp.pt;
  if (!BARS.EFFECTS || pt.pos) return { pF: 0, pH: 0, zMul: 1, whiffMul: 1, hrMul: 1, babip: 0, wpMul: 1, misAdd: 0, velo: 0 };
  const pF = pfOf(pt), pH = pt.steady > 0 ? 0 : phOf(pt);
  const f = pF - BARS.PF_MEAN, h = pH - BARS.PH_MEAN;
  return {
    pF, pH,
    zMul: (1 - BARS.FAT.zone * f) * (1 - BARS.HPE.zone * h),
    whiffMul: 1 - BARS.FAT.whiff * f,
    hrMul: 1 + BARS.FAT.hr * f,
    babip: BARS.FAT.babip * f,
    wpMul: (1 + BARS.FAT.wp * pF) * (1 + BARS.HPE.wp * pH),
    misAdd: BARS.HPE.mis * h,
    velo: BARS.FAT.velo * pF,
  };
}
function hpColor(hp) { return hp >= 40 ? 'g' : hp >= 21 ? 'y' : 'r'; }
function ftgColor(pt) { const used = pt.used / 100; if (used <= pt.B) return 'g'; return pfOf(pt) <= 0.5 ? 'y' : 'r'; }

/* ================================================================ game state */
const POSN = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const POS_ORDER = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];
const POS_GROUP = { C: ['C'], '1B': ['1B', '3B', 'LF', 'RF', 'DH'], '2B': ['2B', 'SS', '3B'], '3B': ['3B', 'SS', '2B', '1B'],
  SS: ['SS', '2B', '3B'], LF: ['LF', 'RF', 'CF', '1B'], CF: ['CF', 'LF', 'RF'], RF: ['RF', 'LF', 'CF', '1B'] };
const DIFF = {
  rookie: { label: 'Rookie', edge: 0.14, adapt: 5, hook: { half: 0, mid: 6 }, visits: false, prompts: true },
  pro: { label: 'Pro', edge: 0.0, adapt: 3, hook: { half: 8, mid: 12 }, visits: true, prompts: false },
  allstar: { label: 'All-Star', edge: -0.10, adapt: 2, hook: { half: 14, mid: 12 }, visits: true, prompts: false },
};

// Build a team for one game. opts: { starter, rested(fn), tired(set), injured(set), lvl(fn id->{level,ev}), lineup, positions }
function buildTeam(abbr, opts) {
  opts = opts || {};
  const T = TBY[abbr]; if (!T) throw new Error('no team ' + abbr);
  const off = opts.offset || 0;
  const src = teamPlayers(abbr);
  const ids = src.map(id => id + off);
  const players = {};
  for (const id of src) players[id + off] = makeGP(id, Object.assign({ offset: off }, opts.lvl ? opts.lvl(id) : {}));
  const injSrc = opts.injured || new Set(), tiredSrc = opts.tired || new Set();
  opts = Object.assign({}, opts, { injured: new Set([...injSrc].map(i => i + off)), tired: new Set([...tiredSrc].map(i => i + off)),
    starter: opts.starter != null ? opts.starter + off : null, lineup: opts.lineup ? opts.lineup.map(i => i + off) : null,
    positions: opts.positions ? Object.fromEntries(Object.entries(opts.positions).map(([k, v]) => [Number(k) + off, v])) : null });
  const H = ids.filter(id => players[id].kind === 'H'), Pp = ids.filter(id => players[id].kind === 'P');
  const inj = opts.injured || new Set();
  // pitchers
  const avail = Pp.filter(id => !inj.has(id));
  const sps = avail.filter(id => players[id].role === 'SP').sort((a, b) => pitcherValue(players[b]) - pitcherValue(players[a]));
  const rot = sps.slice(0, 5);
  if (rot.length < 5) for (const id of avail.filter(i => !rot.includes(i)).sort((a, b) => players[b].p.budget - players[a].p.budget)) { if (rot.length >= 5) break; rot.push(id); }
  let starter = opts.starter && avail.includes(opts.starter) ? opts.starter : rot[0];
  const tired = opts.tired || new Set();
  const penPool = avail.filter(id => id !== starter && !rot.includes(id));
  const extraSP = rot.filter(id => id !== starter);  // other starters are not in the bullpen
  penPool.sort((a, b) => pitcherValue(players[b]) - pitcherValue(players[a]));
  const closer = penPool.find(id => players[id].role === 'CL') || penPool[0];
  let pen = [closer].concat(penPool.filter(id => id !== closer)).filter(Boolean).slice(0, opts.penSize || 6);
  // Season: tired relievers sit; they're kept as last resort
  const fresh = pen.filter(id => !tired.has(id)), tiredPen = pen.filter(id => tired.has(id));
  // lineup
  let lineup, posOf;
  if (opts.lineup && opts.positions) { lineup = opts.lineup.slice(); posOf = Object.assign({}, opts.positions); }
  else ({ lineup, posOf } = autoLineup(H.filter(id => !inj.has(id)), players));
  const bench = H.filter(id => !lineup.includes(id) && !inj.has(id)).sort((a, b) => hitterValue(players[b]) - hitterValue(players[a])).slice(0, 5);
  const keep = new Set([...lineup, ...bench, starter, ...fresh, ...tiredPen]);
  // Pennant Run / Season extras: other rostered players still earn Exp Share, so remember everyone
  const team = { abbr, name: T.name, short: T.short, city: T.city, c1: T.colors[0], c2: T.colors[1],
    lineup, slots: lineup.map(id => [id]), posOf, bench, pitcher: starter, pen: fresh, tiredPen, rot, roster: ids.slice(),
    usedP: [], bat: 0, visits: 2, visitBonus6: false, user: false, closer };
  const P = {};
  for (const id of keep) P[id] = players[id];
  return { team, P };
}
function autoLineup(H, players) {
  const val = id => hitterValue(players[id]);
  const left = new Set(H), posOf = {}, chosen = [];
  for (const pos of POS_ORDER) {
    let best = null, bs = -1e9;
    for (const id of left) {
      const p = players[id].pos;
      const fit = p[0] === pos ? 1 : p.includes(pos) ? 0.85 : POS_GROUP[pos].some(q => p.includes(q)) ? 0.45 : 0.1;
      if (pos === 'C' && !p.includes('C')) continue;
      const sc = val(id) * 10 * fit + (players[id].h.field - 50) / 400 * (pos === 'SS' || pos === 'CF' || pos === 'C' ? 2 : 1);
      if (sc > bs) { bs = sc; best = id; }
    }
    if (best == null) for (const id of left) { const sc = val(id); if (sc > bs) { bs = sc; best = id; } }
    if (best == null) break;
    posOf[best] = pos; left.delete(best); chosen.push(best);
  }
  let dh = null, bd = -1;
  for (const id of left) if (val(id) > bd) { bd = val(id); dh = id; }
  if (dh != null) { posOf[dh] = 'DH'; chosen.push(dh); left.delete(dh); }
  return { lineup: battingOrder(chosen, players), posOf };
}
function battingOrder(ids, players) {
  const v = id => hitterValue(players[id]);
  const obp = id => { const h = players[id].h; return h.bb + h.hbp + (1 - h.k - h.bb - h.hbp - h.hr) * h.babip + h.hr; };
  const sorted = ids.slice().sort((a, b) => v(b) - v(a));
  const top5 = sorted.slice(0, 5);
  const lead = top5.slice().sort((a, b) => (obp(b) + players[b].h.sprint / 400) - (obp(a) + players[a].h.sprint / 400))[0];
  const rest = sorted.filter(id => id !== lead);
  return [lead, rest[0], rest[1], rest[2], ...rest.slice(3)].filter(id => id != null);
}

// opts: { away, home (team abbrs), user: 0|1|null, difficulty, seed, innings, label, awayOpts, homeOpts, mode }
function newGame(opts) {
  const seed = (opts.seed != null ? opts.seed : Math.floor(Math.random() * 4294967296)) >>> 0;
  const A = buildTeam(opts.away, opts.awayOpts), H = buildTeam(opts.home, Object.assign({}, opts.homeOpts, opts.away === opts.home ? { offset: 20000000 } : {}));
  const P = Object.assign({}, A.P, H.P);
  const g = {
    ver: 1, seed, rng: seed, aux: (seed ^ 0x9E3779B9) >>> 0, mode: opts.mode || 'exhibition', label: opts.label || '',
    innings: opts.innings || 6, inning: 1, half: 0, outs: 0, balls: 0, strikes: 0, score: [0, 0], line: [[], []],
    hitsT: [0, 0], errT: [0, 0], lobT: [0, 0], bases: [null, null, null], teams: [A.team, H.team], P,
    user: opts.user == null ? null : opts.user, difficulty: opts.difficulty || 'pro', need: null, pa: null,
    auto: { side: null, inning: 0 }, lines: [], pbp: [], notes: [], over: false, winner: null, pending: null,
    adapt: { hist: [[], []], sit: [null, null], first: [[], []], app: [[], []] }, half_: null, safetyCap: opts.safetyCap || 0,
    tally: opts.tally ? newTally() : null, stamp: 0, lastPitch: null, coach: opts.coach || null,
  };
  if (g.user != null) g.teams[g.user].user = true;
  for (const t of g.teams) {
    initPitching(g.P[t.pitcher]); g.P[t.pitcher].pt.status = 'in'; g.P[t.pitcher].pt.start = true; g.P[t.pitcher].pt.entered = { inn: 1, half: t === g.teams[0] ? 1 : 0 };
    for (const id of t.pen.concat(t.tiredPen)) initPitching(g.P[id]);
  }
  say(g, `${g.teams[0].name} at ${g.teams[1].name}. ${g.innings} innings.`, 'sys', 'intro');
  startHalf(g);
  return g;
}
function newTally() {
  return { pa: 0, k: 0, bb: 0, hbp: 0, hr: 0, s1: 0, s2: 0, s3: 0, ab: 0, h: 0, sf: 0, bip: 0, bipH: 0, pitches: 0, runs: 0, games: 0,
    sb: 0, cs: 0, gidp: 0, err: 0, wp: 0, pb: 0, tb: 0, inPlayOuts: 0, superText: 0, kOrWhiff: 0, maxTypeShift: 0,
    faints: { KO: 0, GAS: 0, INJ: 0 }, faintRP: { KO: 0, GAS: 0 }, startsKO: [], gamesWithFaint: 0, midAB: 0, visits: 0, posPitch: 0,
    pastBudget: 0, hpPen: 0, costSum: 0, costN: 0, starterPitches: [], starterOuts: [], reliefOuts: 0, totalOuts: 0, pitchersUsed: 0,
    shortStarts: 0, startsN: 0, reliefApps: 0, runsHpPen: 0, paHpPen: 0, outsGame: [] };
}
const fieldSide = g => 1 - g.half;
const batSide = g => g.half;
const curBatterId = g => { const t = g.teams[batSide(g)]; return t.lineup[t.bat % 9]; };
const curPitcherId = g => g.teams[fieldSide(g)].pitcher;
const isUser = (g, side) => g.user === side && !(g.auto.side === side && g.auto.inning === g.inning + g.half / 2);
function nameOf(g, id) { const p = g.P[id]; return p ? p.last : '?'; }

/* ---------------------------------------------------------------- narration (Pick & Roll event bus)
   Every line carries a snapshot so the UI can replay events step by step. */
function snap(g) {
  const b = g.pa ? g.pa.bid : curBatterId(g), p = curPitcherId(g);
  const B = g.P[b], P = g.P[p];
  const pbox = gp => gp ? { id: gp.id, name: gp.name, lvl: gp.lvl, types: gp.types, hp: Math.round(gp.pt.hp), used: Math.round(gp.pt.used / 100),
    B: gp.pt.B, T: gp.pt.T, np: gp.pt.np, st: gp.pt.status, defer: gp.pt.defer, team: gp.team, throws: gp.throws, pos: gp.pt.pos } : null;
  const bbox = gp => gp ? { id: gp.id, name: gp.name, lvl: gp.lvl, types: gp.types, today: todayLine(gp), team: gp.team, bats: gp.bats,
    pos: g.teams[batSide(g)].posOf[gp.id] || 'PH' } : null;
  return { inn: g.inning, half: g.half, outs: g.outs, b: g.balls, s: g.strikes, score: g.score.slice(), bases: g.bases.map(r => r ? r.id : null),
    bat: bbox(B), pit: pbox(P), over: g.over, line: [g.line[0].slice(), g.line[1].slice()], h: g.hitsT.slice(), e: g.errT.slice() };
}
function say(g, t, c, ev, extra) { const l = { t, c: c || '', ev: ev || null, s: snap(g) }; if (extra) l.x = extra; g.lines.push(l); }
function todayLine(gp) {
  const b = gp.b; if (!b.pa) return 'First at-bat';
  const parts = [`${b.h}-${b.ab}`];
  if (b.hr) parts.push(b.hr > 1 ? `${b.hr} HR` : 'HR');
  if (b.d2) parts.push(b.d2 > 1 ? `${b.d2} 2B` : '2B');
  if (b.rbi) parts.push(`${b.rbi} RBI`);
  if (b.bb) parts.push(b.bb > 1 ? `${b.bb} BB` : 'BB');
  if (b.k) parts.push(b.k > 1 ? `${b.k} K` : 'K');
  return parts.join(', ');
}
function pbp(g, t) { g.pbp.push({ inn: g.inning, half: g.half, t }); if (g.pbp.length > 400) g.pbp.shift(); }
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const halfName = g => `${g.half ? 'Bottom' : 'Top'} of the ${ordinal(g.inning)}`;
const countStr = g => `${g.balls}-${g.strikes}`;

/* ---------------------------------------------------------------- half-innings */
function startHalf(g) {
  g.outs = 0; g.balls = 0; g.strikes = 0; g.bases = [null, null, null];
  g.line[g.half][g.inning - 1] = 0;
  g.half_ = { ph: 0, phP: [] };
  const ft = g.teams[fieldSide(g)];
  if (g.inning > g.innings && g.half === 0) for (const t of g.teams) t.visits++;   // +1 visit per extra inning
  say(g, `${halfName(g)}.`, 'sys', 'inning');
  managerStartOfHalf(g);
  const P = g.P[ft.pitcher];
  if (P) { P.pt.innP = 0; P.pt.scoredHalf = false; P.pt.battersInn = 0; P.pt.outsInn = 0; P.pt.inn = g.inning; }
  // extra innings: runner on second, the batter before the leadoff hitter. Unearned, charged to whoever starts the half.
  if (g.inning > g.innings) {
    const bt = g.teams[batSide(g)], prev = bt.lineup[(bt.bat + 8) % 9];
    g.bases[1] = { id: prev, resp: ft.pitcher, ue: true, ghost: true };
    say(g, `${g.P[prev].last} starts on second base.`, 'sys', 'ghost');
  }
  g.pa = null;
}
function endHalf(g) {
  const ft = g.teams[fieldSide(g)], bt = g.teams[batSide(g)];
  // left on base
  g.lobT[batSide(g)] += g.bases.filter(Boolean).length;
  const P = g.P[ft.pitcher];
  // settled in: a half with no run scored while he pitched
  if (!g.over && P && P.pt.status === 'in' && !P.pt.scoredHalf && !P.pt.pos) {
    const before = P.pt.hp;
    P.pt.hp = Math.min(100, P.pt.hp + BARS.SETTLE);
    if (P.pt.hp > before && before < 100) say(g, `${P.last} settled in.`, 'sys', 'heal');
  }
  if (g.over) return;
  // game over checks at the end of a half
  if (g.half === 0 && g.inning >= g.innings && g.score[1] > g.score[0]) { endGame(g); return; }
  if (g.half === 1 && g.inning >= g.innings && g.score[0] !== g.score[1]) { endGame(g); return; }
  if (g.safetyCap && g.inning >= g.safetyCap && g.half === 1) { endGame(g, true); return; }
  if (g.half === 1) { g.inning++; g.half = 0; } else g.half = 1;
  if (g.inning === g.innings && g.half === 0) for (const t of g.teams) if (t.visits === 0 && !t.visitBonus6) { t.visits = 1; t.visitBonus6 = true; }
  startHalf(g);
}
function endGame(g, capped) {
  g.over = true; g.need = null;
  g.winner = g.score[0] > g.score[1] ? 0 : g.score[1] > g.score[0] ? 1 : null;
  assignDecisions(g);
  const w = g.winner == null ? 'Tie game' : `${g.teams[g.winner].short} win`;
  say(g, `Final: ${g.teams[0].short} ${g.score[0]}, ${g.teams[1].short} ${g.score[1]}. ${w}${capped ? ' (stopped at the inning cap)' : ''}.`, 'sys', 'final');
  if (g.tally) tallyGame(g);
}

/* ---------------------------------------------------------------- plate appearances */
function teamDefense(g, side) {
  const t = g.teams[side]; let s = 0, n = 0;
  for (const id of t.lineup) { const pos = t.posOf[id]; if (pos && pos !== 'DH' && g.P[id].h) { s += fieldAt(g.P[id], pos); n++; } }
  return n ? s / n : 50;
}
function fieldAt(gp, pos) {
  const f = gp.h ? gp.h.field : 30;
  if (gp.pos.includes(pos)) return f;
  return POS_GROUP[pos] && POS_GROUP[pos].some(q => gp.pos.includes(q)) ? f * 0.75 : f * 0.45;
}
function startPA(g) {
  managerBetweenBatters(g);
  if (g.pending || g.over) return;
  const bid = curBatterId(g), pid = curPitcherId(g);
  const B = g.P[bid], P = g.P[pid];
  const def = M.DEF_K * (teamDefense(g, fieldSide(g)) - 50) / 10;
  const T = matchupTargets(B, P, def);
  const kn = solveKnobs(B, P, T);
  const bc = bipCalib(B, P, T, kn);
  const eS = TYPES.swingEdge(B, P);
  g.pa = { bid, pid, T, kn: { W: kn.W, A: kn.A, q: kn.q, pBIP: kn.pBIP }, bc, eS, n: 0, seq: [], depart: null, def: null, off: null, startOuts: g.outs };
  if (g.tally) { const t = g.tally; t.predK = (t.predK || 0) + kn.pK; t.predBB = (t.predBB || 0) + kn.pBB; t.tgtK = (t.tgtK || 0) + T.K; t.tgtBB = (t.tgtBB || 0) + T.BB; t.paStarts = (t.paStarts || 0) + 1; t.tgtHR = (t.tgtHR || 0) + T.HR; t.tgtBABIP = (t.tgtBABIP || 0) + T.BABIP; }
  g.balls = 0; g.strikes = 0;
  const pos = g.teams[batSide(g)].posOf[bid] || 'PH';
  say(g, `Now batting: ${B.name}, ${pos}.`, 'sys', 'batter');
}
function buildCtx(g, B, P, pen, x) {
  const kn = g.pa.kn;
  const ctx = baseCtx(P);
  ctx.W = kn.W; ctx.A = kn.A; ctx.q = kn.q;
  ctx.zMul = pen.zMul; ctx.whiffMul = pen.whiffMul; ctx.misAdd = pen.misAdd;
  const D = clamp(B.lvl - P.lvl, -LEVELS.CAP, LEVELS.CAP);
  ctx.cAdj += LEVELS.K_LEVEL * D; ctx.zAdj -= 0.5 * LEVELS.K_LEVEL * D;
  ctx.qH = LEVELS.K_LEVEL * D; ctx.qHR = LEVELS.K_LEVEL * D;
  // difficulty: a small edge for (Rookie) or against (All-Star) the user's side
  const dif = DIFF[g.difficulty] || DIFF.pro;
  if (g.user != null && dif.edge) {
    const e = (batSide(g) === g.user ? 1 : -1) * dif.edge;
    ctx.cAdj += 0.5 * e; ctx.qH += 0.5 * e; ctx.qHR += 0.5 * e;
  }
  const eS = g.pa.eS.e;
  ctx.typeC = y => -TYPES.capShift(TYPES.K_WHIFF * TYPES.pitchEdge(y, P, B).e);
  ctx.typeQ = y => { const eP = TYPES.pitchEdge(y, P, B).e; return [TYPES.capShift(-TYPES.K_HIT * eP + TYPES.K_HIT * eS), TYPES.capShift(-TYPES.K_HR * eP + TYPES.K_HR * eS)]; };
  return ctx;
}
/* Resolve one pitch. def: { pi, loc }, off: { app, run }. */
function resolvePitch(g, def, off) {
  const pa = g.pa, B = g.P[pa.bid], P = g.P[pa.pid];
  const ft = fieldSide(g), bs = batSide(g);
  const x = P.p.pitches[clamp(def.pi | 0, 0, P.p.pitches.length - 1)];
  const loc = LOCS.includes(def.loc) ? def.loc : 'edge';
  let app = off.app || 'normal';
  const run = off.run || null;
  if (run === 'bunt' || run === 'squeeze') app = 'bunt';
  if (run === 'hitrun' && app === 'take') app = 'protect';
  const pen = barPenalties(P);
  const ctx = buildCtx(g, B, P, pen, x);
  const b0 = g.balls, s0 = g.strikes;
  const pr = pitchProbs(ctx, x, loc, app === 'bunt' ? 'take' : app, b0, s0);
  const eP = TYPES.pitchEdge(x, P, B);
  if (g.tally) g.tally.maxTypeShift = Math.max(g.tally.maxTypeShift, Math.abs(ctx.typeC(x)), ...ctx.typeQ(x).map(Math.abs));
  const velo = Math.round(x.velo - pen.velo);
  pa.n++;
  P.pt.np++; P.pt.innP++;
  if (g.tally) { g.tally.pitches++; if (pfOf(P.pt) > 0) g.tally.pastBudget++; if (pen.pH > 0) g.tally.hpPen++; }
  const going = run === 'steal2' || run === 'steal3' || run === 'hitrun' || run === 'squeeze' || run === 'steal';
  const locTxt = { attack: 'over the plate', edge: 'on the edge', up: 'up in the zone', low: 'down low', chase: 'off the plate' }[loc];
  say(g, `${P.last} deals a ${velo} mph ${x.name.toLowerCase()} ${locTxt}...`, '', 'pitch', { pitch: x.code, fam: x.fam, velo, loc, user: def.user });
  const inZone = R(g) < pr.z;
  const mistake = inZone && R(g) < pr.mis;
  let res;   // 'ball' | 'cstrike' | 'whiff' | 'foul' | 'hbp' | 'bip' | 'bunt'
  if (app === 'bunt') res = 'bunt';
  else {
    let swingP = inZone ? pr.sz : pr.so;
    if (run === 'hitrun') swingP = inZone ? 0.97 : 0.85;
    const swung = R(g) < swingP;
    if (!swung) {
      if (inZone) res = R(g) < (mistake ? 0.99 : pr.csz) ? 'cstrike' : 'ball';
      else res = R(g) < ctx.q ? 'hbp' : (R(g) < pr.cso ? 'cstrike' : 'ball');
    } else {
      const c = inZone ? (mistake ? pr.cInM : pr.cInN) : pr.cOut;
      if (R(g) >= c) res = 'whiff';
      else res = R(g) < (inZone ? pr.fIn : pr.fOut) ? 'foul' : 'bip';
    }
  }
  if (res !== 'ball' && res !== 'hbp') P.pt.st++;
  pa.seq.push(res);
  if (g.tally && (res === 'whiff')) g.tally.kOrWhiff++;
  const runnersOn = g.bases.some(Boolean);
  let paOver = false, dmg = 0, kind = null;
  g._runDmg = 0;
  // adapt: remember what the user throws and how the user swings (the AI adapts, section 5)
  trackAdapt(g, def, off, x);
  if (res === 'bunt') {
    ({ paOver, dmg, kind } = resolveBunt(g, B, P, x, run));
  } else if (res === 'bip') {
    ({ paOver, dmg, kind } = resolveBIP(g, ctx, pen, B, P, x, loc, app, inZone, mistake, eP, going));
  } else if (res === 'hbp') {
    g.balls = 0;
    say(g, `${B.last} is hit by the pitch.`, '', 'hbp');
    walkBatter(g, B, P, 'hbp'); paOver = true; dmg = BARS.DMG.hbp; kind = 'hbp';
  } else {
    if (res === 'ball') {
      g.balls++;
      if (g.balls >= 4) {
        say(g, `Ball four. ${B.last} walks.`, '', 'bb');
        stealOnPitch(g, P, run, true);
        walkBatter(g, B, P, 'bb'); paOver = true; dmg = BARS.DMG.bb; kind = 'bb';
      } else say(g, `Ball${g.balls === 3 ? ' three' : ''}. ${countStr(g)}.`, '', 'ball');
    } else if (res === 'cstrike' || res === 'whiff') {
      g.strikes++;
      if (g.strikes >= 3) {
        const sup = eP.raw >= 2 ? ' It\'s super effective!' : '';
        if (res === 'whiff') say(g, `Strike three swinging! ${B.last} goes down.${sup}`, 'hot', 'k', { super: !!sup });
        else say(g, `Called strike three! ${B.last} is caught looking.${sup}`, 'hot', 'k', { super: !!sup });
        if (sup && g.tally) g.tally.superText++;
        strikeout(g, B, P, res === 'whiff');
        paOver = true; kind = 'k';
        if (!g.over && g.outs < 3) stealOnPitch(g, P, run, false);
      } else {
        const sup = res === 'whiff' && eP.raw >= 2 && eP.stab;
        if (sup && g.tally) g.tally.superText++;
        say(g, res === 'whiff' ? `Swing and a miss! ${countStr(g)}.${sup ? ' It\'s super effective!' : ''}` : `Called strike. ${countStr(g)}.`, '', res === 'whiff' ? 'whiff' : 'strike', { super: sup });
        stealOnPitch(g, P, run, false);
      }
    } else if (res === 'foul') {
      if (g.strikes < 2) g.strikes++;
      say(g, `Fouled ${['back', 'off', 'away', 'into the seats'][Math.floor(R(g) * 4)]}. ${countStr(g)}.`, '', 'foul');
      if (going && run !== 'squeeze') say(g, 'The runner heads back.', 'sys', null);
    }
    // wild pitch / passed ball on a pitch not put in play
    if (!g.over && g.outs < 3 && (res === 'ball' || res === 'cstrike' || res === 'whiff') && g.bases.some(Boolean)) wildPitchCheck(g, P, pen, loc, res, paOver);
  }
  // Health damage: the play first, then 10 per run scored while he's on the mound (5 if tainted)
  if (kind && BARS.DMG[kind] != null) dmg = BARS.DMG[kind];
  if ((kind === 's1' || kind === 's2' || kind === 's3' || kind === 'hr')) dmg *= TYPES.dmgMult(pa.eS.e);
  dmg += g._runDmg;
  // fatigue cost (hundredths): base, +runner on, +21st pitch of the inning on
  const cost = BARS.COST_BASE + (runnersOn ? BARS.COST_RUNNER : 0) + (P.pt.innP > 20 ? BARS.COST_LONG : 0);
  if (g.tally) { g.tally.costSum += cost; g.tally.costN++; }
  applyBars(g, ft, P, cost, dmg, paOver);
  if (P.pt.steady > 0) P.pt.steady--;
  if (paOver && !g.over) afterPA(g);
  else if (!paOver && !g.over) {
    pa.def = null; pa.off = null;
    // a third out on the bases (caught stealing, squeeze rundown): this batter leads off next inning
    if (g.outs >= 3) { g.pa = null; g.balls = 0; g.strikes = 0; endHalf(g); }
  }
  g.stamp++;
}
function anyOn(g) { return g.bases.some(Boolean); }
function trackAdapt(g, def, off, x) {
  if (g.user == null) return;
  const cat = countCat(g.balls, g.strikes);
  if (def.user) {
    const h = g.adapt.hist[0]; h.push({ cat, fam: x.fam, first: g.balls === 0 && g.strikes === 0 }); if (h.length > 40) h.shift();
  }
  if (off.user && off.app) { const a = g.adapt.app[0]; a.push(off.app); if (a.length > 30) a.shift(); }
}
function afterPA(g) {
  const bt = g.teams[batSide(g)], P = g.P[g.pa.pid];
  if (g.tally) g.tally.pa++;
  evOnPA(g, g.P[g.pa.bid], P);
  bt.bat = (bt.bat + 1) % 9;
  g.balls = 0; g.strikes = 0;
  const pa = g.pa;
  g.pa = null;
  if (g.outs >= 3) endHalf(g);
  void pa; void P;
}

/* ---------------------------------------------------------------- outcomes */
function chargeBF(g, P) { P.pt.bf++; P.pt.battersInn++; }
function strikeout(g, B, P, swinging) {
  B.b.pa++; B.b.ab++; B.b.k++;
  const resp = respPitcher(g, P, 'k');
  chargeBF(g, resp); resp.pt.k++;
  if (g.tally) { g.tally.k++; g.tally.ab++; }
  recordOut(g, P, 1);
  pbp(g, `${B.last} strikes out${swinging ? ' swinging' : ' looking'}.`);
  P.pt.min3++;
}
// Mid at-bat change: walks at 2-0, 2-1, 3-0, 3-1, 3-2 are charged to the departed pitcher (9.16(h)); all else to the reliever.
function respPitcher(g, P, kind) {
  const d = g.pa && g.pa.depart;
  if (!d) return P;
  const behind = ['2-0', '2-1', '3-0', '3-1', '3-2'].includes(d.b + '-' + d.s);
  if ((kind === 'bb') && behind) return g.P[d.pid];
  return P;
}
function walkBatter(g, B, P, kind) {
  B.b.pa++;
  if (kind === 'bb') B.b.bb++; else B.b.hbp++;
  const resp = respPitcher(g, P, kind);
  chargeBF(g, resp);
  if (kind === 'bb') resp.pt.bb++; else resp.pt.hbp++;
  if (g.tally) { if (kind === 'bb') g.tally.bb++; else g.tally.hbp++; }
  // forced runners only
  const runner = { id: B.id, resp: resp.id, ue: false };
  const rbiRuns = forceAdvance(g, runner);
  if (rbiRuns) B.b.rbi += rbiRuns;
  pbp(g, `${B.last} ${kind === 'bb' ? 'walks' : 'is hit by a pitch'}.`);
  P.pt.min3++;
}
function forceAdvance(g, runner) {
  let rbi = 0;
  const b = g.bases;
  if (b[0]) {
    if (b[1]) {
      if (b[2]) { scoreRunner(g, b[2], { rbi: true }); rbi++; }
      b[2] = b[1];
    }
    b[1] = b[0];
  }
  b[0] = runner;
  return rbi;
}
function recordOut(g, P, n) {
  g.outs += n; P.pt.outs += n; P.pt.outsInn += n;
  if (g.tally) g.tally.totalOuts += n;
}
// A run scores. Charged to the runner's responsible pitcher; Health damage goes to the pitcher on the mound.
function scoreRunner(g, r, opts) {
  opts = opts || {};
  const bs = batSide(g);
  if (g.over || (g.walkoff && !opts.hr)) return false;
  const runner = g.P[r.id];
  runner.b.r++;
  const diff0 = g.score[bs] - g.score[1 - bs];
  g.score[bs]++; g.line[bs][g.inning - 1]++;
  if (diff0 === 0) { const bt = g.teams[bs]; g.lastLead = { side: bs, winP: bt.pitcher != null ? bt.pitcher : bt.lastPitcher, loseP: r.resp }; }
  const resp = g.P[r.resp] || g.P[curPitcherId(g)];
  resp.pt.r++;
  const phantomOver = g.outs + g.half_.ph >= 3 && g.half_.phP.includes(resp.id);
  const earned = !r.ue && !opts.unearned && !phantomOver;
  if (earned) resp.pt.er++;
  const cur = g.P[curPitcherId(g)];
  if (resp.id !== cur.id) cur.pt.irs++;
  cur.pt.scoredHalf = true;
  g._runDmg = (g._runDmg || 0) + ((r.ue || opts.unearned) ? BARS.TAINT : BARS.RUN);
  if (g.tally) { g.tally.runs++; if (barPenalties(cur).pH > 0) g.tally.runsHpPen++; }
  // walk-off: the home team takes the lead in the last inning or later
  if (bs === 1 && g.inning >= g.innings && g.score[1] > g.score[0]) { g.walkoff = true; }
  return true;
}
function clearRunner(g, i) { const r = g.bases[i]; g.bases[i] = null; return r; }

/* Ball in play: batted-ball type, then HR / hit / out, then the runners. */
function resolveBIP(g, ctx, pen, B, P, x, loc, app, inZone, mistake, eP, going) {
  const bs = batSide(g), ft = fieldSide(g), pa = g.pa, bc = pa.bc;
  const A = app.startsWith('sit') ? (app === 'sit' + x.fam ? M.APP.sitRight : M.APP.sitWrong) : (M.APP[app] || M.APP.normal);
  const mix = bc.mix.map((m, i) => m * M.BTL[loc][i] * ((M.BTP[x.code] || [1, 1, 1, 1])[i]) * ((M.BTA[app] || [1, 1, 1, 1])[i]));
  const t = BTN[wpick(g, [0, 1, 2, 3], mix)];
  const tq = ctx.typeQ(x);
  const qHR = M.QL[loc][1] + (inZone ? 0 : M.QOUT[1]) + A.hr + (mistake ? M.MIS_HR : 0) + ctx.qHR + tq[1];
  const qH = M.QL[loc][0] + (inZone ? 0 : M.QOUT[0]) + A.h + (mistake ? M.MIS_H : 0) + ctx.qH + tq[0];
  const hrBase = clamp(M.BT[t][1] * bc.kHR * pen.hrMul, 0, 0.9);
  const pHR = hrBase > 0 ? sig(logit(clamp(hrBase, 1e-4, 0.9)) + qHR) : 0;
  B.b.pa++;
  if (g.tally) g.tally.bip++;
  if (R(g) < pHR) return homeRun(g, B, P, t, eP);
  let pH = sig(logit(M.BT[t][0]) + bc.d + qH + (t === 'gb' ? 0.06 * (B.h.sprint - 27) : 0));
  pH = clamp(pH + pen.babip, 0.005, 0.95);
  if (R(g) < pH) {
    const h = B.h, lgT = LG.single + LG.double + LG.triple, bt = h.s1 + h.s2 + h.s3 || 1;
    const f2 = (h.s2 / bt) / (LG.double / lgT), f3 = (h.s3 / bt) / (LG.triple / lgT) * Math.exp(0.2 * (h.sprint - 27));
    const sh = M.BT[t];
    const kind = wpick(g, ['s1', 's2', 's3'], [sh[2], sh[3] * f2, sh[4] * f3]);
    return hit(g, B, P, t, kind, eP, going);
  }
  return ballInPlayOut(g, B, P, t, going);
}
function dirText(g, B, t) {
  const pullSide = (B.bats === 'L' || (B.bats === 'S' && g.P[curPitcherId(g)].throws === 'R')) ? 'right' : 'left';
  const oppo = pullSide === 'left' ? 'right' : 'left';
  const r = R(g), pull = B.h.pull || 0.4;
  if (r < pull) return pullSide;
  if (r < pull + (1 - pull) * 0.45) return 'center';
  return oppo;
}
function homeRun(g, B, P, t, eP) {
  const resp = respPitcher(g, P, 'hr');
  chargeBF(g, resp); resp.pt.h++; resp.pt.hr++;
  B.b.ab++; B.b.h++; B.b.hr++;
  g.hitsT[batSide(g)]++;
  if (g.tally) { g.tally.ab++; g.tally.h++; g.tally.hr++; g.tally.tb += 4; }
  const dir = dirText(g, B, 'fb');
  const n = g.bases.filter(Boolean).length + 1;
  const what = n === 4 ? 'Grand slam!' : n === 1 ? 'Home run!' : `${n}-run homer!`;
  const sup = g.pa.eS.raw >= 2 ? ' It\'s super effective!' : (eP.raw === 0 ? ` It doesn't affect ${B.last}...` : (eP.raw <= 0.5 ? ' It\'s not very effective...' : ''));
  say(g, `${B.last} crushes it to deep ${dir}. ${what}${sup}`, 'big', 'hr', { super: g.pa.eS.raw >= 2 });
  let rbi = 0;
  for (let i = 2; i >= 0; i--) if (g.bases[i]) { if (scoreRunner(g, clearRunner(g, i), { rbi: true, hr: true })) rbi++; }
  if (scoreRunner(g, { id: B.id, resp: resp.id, ue: false }, { rbi: true, hr: true })) rbi++;
  B.b.rbi += rbi;
  pbp(g, `${B.last} homers to ${dir} (${rbi} RBI).`);
  P.pt.min3++;
  if (g.walkoff) walkOff(g);
  return { paOver: true, dmg: BARS.DMG.hr, kind: 'hr' };
}
function hit(g, B, P, t, kind, eP, going) {
  const resp = respPitcher(g, P, kind);
  chargeBF(g, resp); resp.pt.h++;
  B.b.ab++; B.b.h++;
  if (kind === 's2') B.b.d2++; if (kind === 's3') B.b.d3++;
  g.hitsT[batSide(g)]++;
  if (g.tally) { g.tally.ab++; g.tally.h++; g.tally[kind]++; g.tally.bipH++; g.tally.tb += kind === 's1' ? 1 : kind === 's2' ? 2 : 3; }
  const dir = dirText(g, B, t);
  const where = { left: 'left', center: 'center', right: 'right' }[dir];
  let txt;
  if (kind === 's1') txt = t === 'gb' ? (R(g) < 0.25 && B.h.sprint > 28 ? 'beats out an infield single' : `grounds a single through the ${dir === 'center' ? 'middle' : where + ' side'}`) :
    t === 'ld' ? `lines a single to ${where}` : t === 'fb' ? `bloops a single into shallow ${where}` : `drops a single into ${where}`;
  else if (kind === 's2') txt = t === 'ld' ? `rips a double into the ${dir === 'center' ? 'gap' : where + '-field corner'}` : `drives a double off the wall in ${where}`;
  else txt = `legs out a triple to ${where}`;
  const sup = g.pa.eS.raw >= 2 ? ' It\'s super effective!' : (eP.raw === 0 ? ` It doesn't affect ${B.last}...` : (eP.raw <= 0.5 ? ' It\'s not very effective...' : ''));
  say(g, `${B.last} ${txt}!${sup}`, 'good', 'hit', { kind, super: g.pa.eS.raw >= 2 });
  const rbi = advanceOnHit(g, B, resp, kind, t, going);
  B.b.rbi += rbi;
  pbp(g, `${B.last} ${txt}${rbi ? ` (${rbi} RBI)` : ''}.`);
  P.pt.min3++;
  if (g.walkoff) walkOff(g);
  comebacker(g, P, t, true);
  return { paOver: true, dmg: BARS.DMG[kind], kind };
}
function spd(g, id) { const h = g.P[id].h; return h ? (h.sprint - 27) : -1; }
// Advancement table by hit type and runner speed (section 5).
function advanceOnHit(g, B, resp, kind, t, going) {
  const b = g.bases.slice(); g.bases = [null, null, null];
  let rbi = 0;
  const twoOut = g.outs === 2;
  const sc = (r) => { if (scoreRunner(g, r, { rbi: true })) { rbi++; return true; } return false; };
  const batter = { id: B.id, resp: resp.id, ue: false };
  const moves = [];
  const scoreTxt = (r, extra) => { if (sc(r)) moves.push(`${g.P[r.id].last} scores${extra || ''}`); };
  if (kind === 's3') { for (let i = 2; i >= 0; i--) if (b[i]) scoreTxt(b[i]); g.bases[2] = batter; }
  else if (kind === 's2') {
    if (b[2]) scoreTxt(b[2]);
    if (b[1]) scoreTxt(b[1]);
    if (b[0] && !g.walkoff) {
      const p = clamp(0.42 + 0.07 * spd(g, b[0].id) + (twoOut ? 0.15 : 0) + (going ? 0.25 : 0), 0.05, 0.95);
      if (R(g) < p) { if (R(g) < 0.04) { recordOut(g, g.P[curPitcherId(g)], 1); moves.push(`${g.P[b[0].id].last} is thrown out at the plate`); } else { scoreTxt(b[0], ' from first'); extraBase(g, b[0].id); } }
      else { g.bases[2] = b[0]; moves.push(`${g.P[b[0].id].last} to third`); }
    }
    if (g.outs < 3) g.bases[1] = batter;
  } else {   // single
    if (b[2]) scoreTxt(b[2]);
    if (b[1] && !g.walkoff) {
      const p = clamp(0.60 + 0.08 * spd(g, b[1].id) + (twoOut ? 0.15 : 0) + (t === 'gb' ? 0.05 : t === 'fb' || t === 'pu' ? -0.15 : 0) + (going ? 0.2 : 0), 0.1, 0.97);
      if (R(g) < p) { if (R(g) < 0.03) { recordOut(g, g.P[curPitcherId(g)], 1); moves.push(`${g.P[b[1].id].last} is thrown out at the plate`); } else { scoreTxt(b[1]); extraBase(g, b[1].id); } }
      else { g.bases[2] = b[1]; moves.push(`${g.P[b[1].id].last} to third`); }
    }
    if (b[0] && !g.walkoff) {
      const open3 = !g.bases[2];
      const p = open3 ? clamp(0.28 + 0.07 * spd(g, b[0].id) + (twoOut ? 0.08 : 0) + (t === 'gb' ? -0.06 : 0) + (going ? 0.30 : 0), 0.03, 0.9) : 0;
      if (R(g) < p) { if (R(g) < 0.02) { recordOut(g, g.P[curPitcherId(g)], 1); moves.push(`${g.P[b[0].id].last} is thrown out at third`); } else { g.bases[2] = b[0]; moves.push(`${g.P[b[0].id].last} to third`); extraBase(g, b[0].id); } }
      else { g.bases[1] = b[0]; }
    }
    if (g.outs < 3) g.bases[0] = batter;
  }
  if (moves.length && !g.over) say(g, moves.join('. ') + '.', 'sys', 'run');
  if (g.outs >= 3) g.bases = [null, null, null];
  return rbi;
}
function extraBase(g, id) { const gp = g.P[id]; if (g.mode === 'pennant') gp.evSpeed = (gp.evSpeed || 0) + 2; }
function fielderFor(g, t, B) {
  const dir = dirText(g, B, t);
  if (t === 'gb') return dir === 'left' ? (R(g) < 0.5 ? '3B' : 'SS') : dir === 'center' ? (R(g) < 0.5 ? 'SS' : '2B') : (R(g) < 0.5 ? '2B' : '1B');
  if (t === 'pu') return ['C', '1B', '2B', '3B', 'SS'][Math.floor(R(g) * 5)];
  if (t === 'ld') return R(g) < 0.5 ? (dir === 'left' ? 'SS' : dir === 'center' ? '2B' : '1B') : (dir === 'left' ? 'LF' : dir === 'center' ? 'CF' : 'RF');
  return dir === 'left' ? 'LF' : dir === 'center' ? 'CF' : 'RF';
}
const POS_WORD = { C: 'catcher', '1B': 'first', '2B': 'second', '3B': 'third', SS: 'short', LF: 'left', CF: 'center', RF: 'right', P: 'the pitcher' };
function fielderAt(g, pos) { const t = g.teams[fieldSide(g)]; return t.lineup.find(id => t.posOf[id] === pos); }
function ballInPlayOut(g, B, P, t, going) {
  const pos = fielderFor(g, t, B), fid = fielderAt(g, pos);
  const fr = fid ? fieldAt(g.P[fid], pos) : 40;
  const pErr = clamp(0.013 * (1 + (60 - fr) / 100), 0.004, 0.04);
  const resp = respPitcher(g, P, 'out');
  if (R(g) < pErr && t !== 'pu') return reachOnError(g, B, P, resp, t, pos);
  chargeBF(g, resp);
  const b = g.bases, outs0 = g.outs;
  let rbi = 0, txt = '';
  const sc = r => { if (scoreRunner(g, r, { rbi: true })) rbi++; };
  if (t === 'gb') {
    if (b[0] && outs0 < 2) {
      const dpP = clamp(0.47 - 0.04 * spd(g, B.id) - (going ? 0.35 : 0), 0.03, 0.75);
      if (R(g) < dpP) {   // double play
        B.b.ab++; if (g.tally) { g.tally.ab++; g.tally.gidp++; }
        const r1 = clearRunner(g, 0);
        recordOut(g, P, 2);
        txt = `grounds into a double play, ${POS_WORD[pos]} to second to first`;
        if (g.outs < 3) {
          if (b[2] && outs0 === 0) { sc(clearRunner(g, 2)); rbi = 0; }   // no RBI on a double play
          if (b[1]) { b[2] = b[2] || b[1]; b[1] = null; }
        }
        void r1;
        say(g, `${B.last} ${txt}.`, 'hot', 'dp');
        pbp(g, `${B.last} ${txt}.`); P.pt.min3++;
        if (g.outs >= 3) g.bases = [null, null, null];
        comebacker(g, P, t, false);
        return { paOver: true, dmg: 0, kind: 'out' };
      }
      if (R(g) < 0.30) {   // fielder's choice: lead runner forced, batter safe; he takes over that runner's charge (9.16(g))
        B.b.ab++; if (g.tally) g.tally.ab++;
        const lead = b[1] && b[2] ? 2 : b[1] ? 1 : 0;
        const out = g.bases[lead];
        // runners behind the forced one move up
        if (lead === 2) { g.bases[2] = b[1]; g.bases[1] = b[0]; }
        else if (lead === 1) { g.bases[1] = b[0]; }
        g.bases[0] = { id: B.id, resp: out.resp, ue: out.ue };
        recordOut(g, P, 1);
        txt = `hits into a fielder's choice. ${g.P[out.id].last} is forced out`;
        say(g, `${B.last} ${txt}.`, '', 'out');
        pbp(g, `${B.last} ${txt}.`); P.pt.min3++;
        if (g.outs >= 3) g.bases = [null, null, null];
        return { paOver: true, dmg: 0, kind: 'out' };
      }
    }
    B.b.ab++; if (g.tally) g.tally.ab++;
    recordOut(g, P, 1);
    txt = `grounds out to ${POS_WORD[pos]}`;
    if (g.outs < 3) {
      if (b[2] && outs0 < 2 && R(g) < 0.55) sc(clearRunner(g, 2));
      if (b[1] && !b[2] && R(g) < 0.55 + 0.05 * spd(g, b[1].id) + (going ? 0.3 : 0)) { b[2] = b[1]; b[1] = null; }
      if (b[0] && !b[1]) { b[1] = b[0]; b[0] = null; }
    }
  } else if (t === 'fb' || t === 'ld') {
    B.b.ab++;
    recordOut(g, P, 1);
    const deep = t === 'fb' && ['LF', 'CF', 'RF'].includes(pos);
    if (t === 'ld' && g.outs < 3 && going && b.some(Boolean) && R(g) < 0.5) {   // runner doubled off on a liner
      const i = b[0] ? 0 : b[1] ? 1 : 2; clearRunner(g, i); recordOut(g, P, 1);
      txt = `lines out to ${POS_WORD[pos]}, and the runner is doubled off`;
    } else txt = t === 'ld' ? `lines out to ${POS_WORD[pos]}` : `flies out to ${POS_WORD[pos]}`;
    if (g.outs < 3 && deep) {
      if (b[2] && outs0 < 2 && R(g) < 0.75 + 0.05 * spd(g, b[2].id)) {   // sacrifice fly
        sc(clearRunner(g, 2)); B.b.ab--; B.b.sf++; if (g.tally) { g.tally.sf++; }
        txt = `hits a sacrifice fly to ${POS_WORD[pos]}`;
      }
      if (b[1] && !b[2] && R(g) < 0.30 + 0.05 * spd(g, b[1].id)) { b[2] = b[1]; b[1] = null; }
    }
    if (g.tally && !txt.startsWith('hits a sacrifice')) g.tally.ab++;
  } else {
    B.b.ab++; if (g.tally) g.tally.ab++;
    recordOut(g, P, 1);
    txt = `pops out to ${POS_WORD[pos]}`;
  }
  B.b.rbi += rbi;
  say(g, `${B.last} ${txt}.${rbi ? ' A run scores.' : ''}`, '', 'out');
  pbp(g, `${B.last} ${txt}${rbi ? ` (${rbi} RBI)` : ''}.`);
  P.pt.min3++;
  if (g.outs >= 3) g.bases = [null, null, null];
  if (g.walkoff) walkOff(g);
  if (t === 'gb' || t === 'ld') comebacker(g, P, t, false, pos);
  return { paOver: true, dmg: 0, kind: 'out' };
}
function reachOnError(g, B, P, resp, t, pos) {
  chargeBF(g, resp);
  B.b.ab++; if (g.tally) { g.tally.ab++; g.tally.err++; }
  g.errT[fieldSide(g)]++;
  // the out that should have been made: a phantom out for earned runs (9.16(a)); remember who was pitching
  g.half_.ph++; if (!g.half_.phP.includes(resp.id)) g.half_.phP.push(resp.id);
  const two = R(g) < 0.15 && t !== 'gb';
  const b = g.bases.slice(); g.bases = [null, null, null];
  const sc = r => { if (!g.over) scoreRunner(g, r, { unearned: true }); };
  const adv = two ? 2 : 1;
  for (let i = 2; i >= 0; i--) if (b[i]) { const to = i + adv; if (to >= 3) sc(b[i]); else g.bases[to] = b[i]; }
  g.bases[two ? 1 : 0] = { id: B.id, resp: resp.id, ue: true };
  const fn = fielderAt(g, pos);
  say(g, `${B.last} reaches on an error by ${fn ? g.P[fn].last : POS_WORD[pos]}${two ? ' and takes second' : ''}.`, '', 'error');
  pbp(g, `${B.last} reaches on an error (${pos}).`);
  P.pt.min3++;
  if (g.walkoff) walkOff(g);
  return { paOver: true, dmg: 0, kind: 'roe' };
}
function walkOff(g) {
  if (g.over) return;
  say(g, `Walk-off! ${g.teams[1].short} win it!`, 'big', 'walkoff');
  pbp(g, 'Walk-off.');
  endGame(g);
}
// Bunts and squeezes (RUN menu).
function resolveBunt(g, B, P, x, run) {
  const resp = respPitcher(g, P, 'out');
  const r = R(g), b = g.bases;
  const fairP = 0.60 + 0.002 * (B.h.speedR - 50), foulP = 0.30;
  if (r > fairP + foulP) {   // missed or popped up
    if (R(g) < 0.5) {   // missed: a strike; on a squeeze the runner is hung up
      g.strikes++;
      say(g, `${B.last} misses the bunt. ${countStr(g)}.`, '', 'whiff');
      if (run === 'squeeze' && b[2]) { const rr = clearRunner(g, 2); recordOut(g, P, 1); say(g, `${g.P[rr.id].last} is caught in a rundown!`, 'hot', 'out'); }
      if (g.strikes >= 3 && g.outs < 3) { say(g, `${B.last} strikes out.`, 'hot', 'k'); strikeout(g, B, P, true); return { paOver: true, dmg: 0, kind: 'k' }; }
      if (g.outs >= 3) g.bases = [null, null, null];
      return { paOver: false, dmg: 0, kind: null };
    }
    chargeBF(g, resp); B.b.pa++; B.b.ab++; if (g.tally) { g.tally.ab++; g.tally.pa; }
    recordOut(g, P, 1);
    say(g, `${B.last} pops up the bunt. It's caught.`, 'hot', 'out'); pbp(g, `${B.last} pops out on a bunt.`); P.pt.min3++;
    if (g.outs >= 3) g.bases = [null, null, null];
    return { paOver: true, dmg: 0, kind: 'out' };
  }
  if (r > fairP) {   // foul bunt
    if (g.strikes < 2) { g.strikes++; say(g, `Bunted foul. ${countStr(g)}.`, '', 'foul'); return { paOver: false, dmg: 0, kind: null }; }
    say(g, `Bunted foul with two strikes. ${B.last} is out.`, 'hot', 'k'); strikeout(g, B, P, false); return { paOver: true, dmg: 0, kind: 'k' };
  }
  // fair bunt
  B.b.pa++; chargeBF(g, resp);
  const anyR = b.some(Boolean);
  const q = R(g);
  const hitP = clamp(0.07 + 0.03 * spd(g, B.id), 0.02, 0.3);
  if (q < hitP) {
    B.b.ab++; B.b.h++; g.hitsT[batSide(g)]++; resp.pt.h++; if (g.tally) { g.tally.ab++; g.tally.h++; g.tally.s1++; g.tally.tb++; }
    const old = g.bases.slice(); g.bases = [null, null, null];
    let rbi = 0;
    for (let i = 2; i >= 0; i--) if (old[i]) { if (i === 2) { if (scoreRunner(g, old[i], { rbi: true })) rbi++; } else g.bases[i + 1] = old[i]; }
    g.bases[0] = { id: B.id, resp: resp.id, ue: false }; B.b.rbi += rbi;
    say(g, `${B.last} drops a bunt and beats it out!`, 'good', 'hit', { kind: 's1' }); pbp(g, `${B.last} bunt single.`); P.pt.min3++;
    if (g.walkoff) walkOff(g);
    return { paOver: true, dmg: BARS.DMG.s1, kind: 's1' };
  }
  if (anyR && q < hitP + 0.12) {   // lead runner forced out
    B.b.ab++; if (g.tally) g.tally.ab++;
    const lead = b[2] && run !== 'squeeze' ? 2 : b[1] ? 1 : b[0] ? 0 : 2;
    const out = clearRunner(g, lead);
    if (lead === 2 && b[1]) { g.bases[2] = b[1]; g.bases[1] = null; }
    if (b[0] && lead >= 1) { g.bases[1] = b[0]; g.bases[0] = null; }
    g.bases[0] = { id: B.id, resp: out ? out.resp : resp.id, ue: out ? out.ue : false };
    recordOut(g, P, 1);
    say(g, `${B.last} bunts, but they get the lead runner.`, 'hot', 'out'); pbp(g, `${B.last} bunts into a fielder's choice.`); P.pt.min3++;
    if (g.outs >= 3) g.bases = [null, null, null];
    return { paOver: true, dmg: 0, kind: 'out' };
  }
  // sacrifice: batter out, runners up one
  recordOut(g, P, 1); B.b.sh++;
  let rbi = 0;
  if (g.outs < 3) {
    const old = g.bases.slice(); g.bases = [null, null, null];
    for (let i = 2; i >= 0; i--) if (old[i]) { if (i === 2) { if (scoreRunner(g, old[i], { rbi: true })) rbi++; } else g.bases[i + 1] = old[i]; }
  } else g.bases = [null, null, null];
  B.b.rbi += rbi;
  say(g, run === 'squeeze' && rbi ? `Squeeze! ${B.last} lays it down and the run scores.` : `${B.last} lays down the sacrifice. ${anyR ? 'The runners move up.' : ''}`, run === 'squeeze' && rbi ? 'good' : '', 'out');
  pbp(g, `${B.last} sacrifice bunt${rbi ? ' (squeeze, 1 RBI)' : ''}.`); P.pt.min3++;
  if (g.walkoff) walkOff(g);
  return { paOver: true, dmg: 0, kind: 'out' };
}

/* Steals on the pitch (RUN menu or AI). final: the PA just ended with a walk (runners advance anyway). */
function stealChance(g, P, rid, from) {
  const gp = g.P[rid];
  const ct = g.teams[fieldSide(g)], cid = ct.lineup.find(id => ct.posOf[id] === 'C');
  const arm = cid ? (fieldAt(g.P[cid], 'C') - 50) / 50 : 0;
  const base_ = gp.h ? gp.h.sbPct : 0.6;
  const p = sig(logit(clamp(base_, 0.3, 0.97)) + logit(clamp(P.p.hold, 0.4, 0.95)) - logit(LG.sbPct) - 0.35 * arm - (from === 1 ? 0.35 : 0) + M.SB_OFF);
  return clamp(p, 0.15, 0.97);
}
function stealOnPitch(g, P, run, walk) {
  if (!run || g.over) return;
  const b = g.bases;
  let from = -1;
  if (run === 'steal3' && b[1] && !b[2]) from = 1;
  else if ((run === 'steal2' || run === 'steal' || run === 'hitrun') && b[0] && !b[1]) from = 0;
  else if (run === 'steal' && b[1] && !b[2]) from = 1;
  if (from < 0 || walk) return;
  const rr = b[from], gp = g.P[rr.id];
  const ok = R(g) < stealChance(g, P, rr.id, from);
  if (ok) {
    b[from + 1] = rr; b[from] = null; gp.b.sb++;
    if (g.tally) g.tally.sb++;
    say(g, `${gp.last} steals ${from === 0 ? 'second' : 'third'}!`, 'good', 'steal'); pbp(g, `${gp.last} steals ${from === 0 ? '2B' : '3B'}.`);
  } else {
    b[from] = null; gp.b.cs++; recordOut(g, P, 1);
    if (g.tally) g.tally.cs++;
    say(g, `${gp.last} is caught stealing!`, 'hot', 'cs'); pbp(g, `${gp.last} caught stealing.`);
    if (g.outs >= 3) { g.bases = [null, null, null]; if (g.pa) { g.pa.endedByCS = true; } }
  }
}
function wildPitchCheck(g, P, pen, loc, res, paOver) {
  const locF = { attack: 0.3, edge: 0.8, up: 0.9, low: 1.8, chase: 2.2 }[loc];
  const per = P.p.wp / Math.max(1, LG.pitchesPerPA) / 0.42 * locF * pen.wpMul * 1.05;
  const pb = 0.0005 * locF;
  const r = R(g);
  if (r < per + pb) {
    const isWP = r < per;
    if (isWP) P.pt.wp++;
    if (g.tally) { if (isWP) g.tally.wp++; else g.tally.pb++; }
    const old = g.bases.slice(); g.bases = [null, null, null];
    for (let i = 2; i >= 0; i--) if (old[i]) { if (i === 2) scoreRunner(g, old[i], { unearned: !isWP }); else g.bases[i + 1] = old[i]; }
    say(g, isWP ? `Wild pitch! The runners move up.` : `Passed ball! The runners move up.`, 'good', 'wp');
    pbp(g, isWP ? 'Wild pitch.' : 'Passed ball.');
    if (isWP) g._runDmg = (g._runDmg || 0) + BARS.DMG.wp;
    if (g.walkoff) walkOff(g);
  }
}

/* ---------------------------------------------------------------- bars after the play */
function applyBars(g, side, P, cost, dmg, paOver) {
  const pt = P.pt;
  pt.used += cost;
  if (dmg > 0) pt.hp -= dmg * BARS.DMG_SCALE;
  if (BARS.force && BARS.force.pid === P.id) { if (BARS.force.hp != null) pt.hp = BARS.force.hp; if (BARS.force.used != null) pt.used = BARS.force.used * 100; BARS.force = null; }
  if (pt.pos) { pt.hp = Math.max(1, pt.hp); pt.used = Math.min(pt.used, pt.T * 100 - 100); return; }   // a position player can't faint
  // milestone lines, once each
  const used = pt.used / 100;
  pt.said = pt.said || {};
  if (!pt.said.r40 && pt.hp < 40 && pt.hp > 0) { pt.said.r40 = 1; say(g, `${P.last} is rattled! His command is slipping.`, 'sys', 'bars'); }
  if (!pt.said.r20 && pt.hp <= 20 && pt.hp > 0) { pt.said.r20 = 1; say(g, `${P.last} is on the ropes!`, 'sys', 'bars'); }
  if (!pt.said.t80 && used >= 0.8 * pt.B && used < pt.B) { pt.said.t80 = 1; say(g, `${P.last} is tiring. (${pt.np} pitches)`, 'sys', 'bars'); }
  if (!pt.said.tB && used > pt.B) { pt.said.tB = 1; say(g, `${P.last} is past his pitch budget.`, 'sys', 'bars'); }
  if (g.tally && pt.status === 'in' && paOver && barPenalties(P).pH > 0) g.tally.paHpPen++;
  if (!BARS.FAINT) { pt.hp = Math.max(1, pt.hp); pt.used = Math.min(pt.used, pt.T * 100 - 100); return; }
  checkFaint(g, side, P, paOver);
}
function checkFaint(g, side, P, paOver) {
  const pt = P.pt;
  if (pt.status !== 'in') return;
  const destroyed = pt.hp <= 0 || pt.used >= pt.T * 100;
  if (!destroyed && !pt.defer) return;
  const reason = pt.defer ? pt.deferReason : (pt.hp <= 0 ? 'KO' : 'GAS');
  if (g.over) { faintNow(g, side, P, reason, true); return; }
  const halfEnded = g.outs >= 3;
  const legal = paOver && (pt.min3 >= BARS.MIN_BATTERS || halfEnded);
  if (legal) { faintNow(g, side, P, reason, halfEnded); return; }
  if (pt.hp <= 0) pt.hp = 1;
  if (pt.used >= pt.T * 100) pt.used = pt.T * 100 - 100;
  if (!pt.defer) {
    pt.defer = true; pt.deferReason = reason;
    const left = BARS.MIN_BATTERS - pt.min3;
    if (!paOver) say(g, `${P.last} is running on fumes! He has to finish this batter.`, 'sys', 'bars');
    else say(g, `${P.last} is hanging on! He has to face ${left} more batter${left === 1 ? '' : 's'}.`, 'sys', 'bars');
  }
}
function faintNow(g, side, P, reason, halfEnded) {
  const pt = P.pt, t = g.teams[side];
  pt.status = 'fnt'; pt.exit = reason; pt.exitInn = g.inning; pt.defer = false; pt.ko = true;
  if (reason === 'KO') pt.hp = 0;
  if (g.tally) { g.tally.faints[reason]++; if (!pt.start && reason !== 'INJ') g.tally.faintRP[reason]++; g._faint = true; }
  if (reason === 'INJ') say(g, `${P.last} fainted! The trainer helps him off the field.`, 'hot', 'faint', { reason });
  else {
    say(g, `${P.last} fainted!`, 'hot', 'faint', { reason });
    say(g, reason === 'KO' ? `He's been knocked out of the game.` : `He's out of gas. ${pt.np} pitches.`, 'sys', null);
  }
  pbp(g, `${halfTag(g)}: ${P.last} fainted (${reason}).`);
  t.usedP.push(P.id); t.lastPitcher = P.id; t.pitcher = null;
  if (g.over) return;
  if (halfEnded) { t.needPitcher = true; return; }
  requestChange(g, side, true);
}
function halfTag(g) { return (g.half ? 'B' : 'T') + g.inning; }
function requestChange(g, side, forced) {
  const t = g.teams[side];
  if (isUser(g, side)) {
    g.pending = { side, forced: true };
    say(g, 'Choose your next pitcher.', 'sys', 'pick');
    return;
  }
  const id = pickReliever(g, side, { forced });
  bringIn(g, side, id, { forced, user: false });
}
function availablePen(g, side) {
  const t = g.teams[side];
  let a = t.pen.filter(id => g.P[id].pt.status === 'avail');
  if (!a.length) a = t.tiredPen.filter(id => g.P[id].pt.status === 'avail');
  return a;
}
function nextBatterOf(g, side) { const bt = g.teams[1 - side]; return g.P[bt.lineup[bt.bat % 9]]; }
function pickReliever(g, side, opts) {
  const t = g.teams[side], cand = availablePen(g, side);
  if (!cand.length) return null;
  const lead = g.score[side] - g.score[1 - side];
  const last = g.inning >= g.innings;
  const nb = nextBatterOf(g, side);
  const plat = id => (nb && nb.bats !== 'S' && g.P[id].throws === nb.bats) ? 0.05 : 0;
  if (last && lead >= 1 && lead <= 3 && cand.includes(t.closer)) return t.closer;
  let pool = cand.filter(id => id !== t.closer || cand.length === 1 || (last && lead >= 0));
  if (!pool.length) pool = cand;
  if (Math.abs(lead) >= 5) return pool.slice().sort((a, b) => pitcherValue(g.P[a]) - pitcherValue(g.P[b]))[0];
  if (g.inning <= 3) return pool.slice().sort((a, b) => g.P[b].p.budget - g.P[a].p.budget)[0];
  return pool.slice().sort((a, b) => (pitcherValue(g.P[b]) + plat(b)) - (pitcherValue(g.P[a]) + plat(a)))[0];
}
function bringIn(g, side, id, opts) {
  opts = opts || {};
  const t = g.teams[side];
  if (id == null) id = positionPlayerPitcher(g, side);
  if (id == null) {   // nobody left: the pitcher stays in at 1
    const P = g.P[t.lastPitcher];
    P.pt.status = 'in'; P.pt.hp = Math.max(1, P.pt.hp); t.pitcher = P.id;
    say(g, `Nobody left in the bullpen. ${P.last} stays in.`, 'sys', 'change'); pbp(g, `${P.last} stays in: nobody left.`);
    return;
  }
  const N = g.P[id];
  if (!N.pt) initPitching(N, !N.p || N.kind === 'H');
  if (N.pt.status === 'used' || N.pt.status === 'fnt') throw new Error('removed pitcher cannot return: ' + id);
  const old = t.pitcher != null ? g.P[t.pitcher] : null;
  if (old) {
    if (!opts.forced && old.pt.defer && old.pt.status === 'in') { old.pt.exit = old.pt.deferReason; }   // pulled while hanging on keeps his tag
    old.pt.status = old.pt.exit ? 'fnt' : 'used'; old.pt.exitInn = g.inning;
    if (!t.usedP.includes(old.id)) t.usedP.push(old.id);
    t.lastPitcher = old.id;
  }
  t.pen = t.pen.filter(x => x !== id); t.tiredPen = t.tiredPen.filter(x => x !== id);
  N.pt.status = 'in'; N.pt.min3 = 0; N.pt.innP = 0; N.pt.battersInn = 0; N.pt.outsInn = 0; N.pt.scoredHalf = false; N.pt.inn = g.inning;
  const lead = g.score[side] - g.score[1 - side], onBase = g.bases.filter(Boolean).length;
  N.pt.entered = { inn: g.inning, half: g.half, outs: g.outs };
  N.pt.enterLead = lead;
  N.pt.enterSave = lead > 0 && (lead <= 3 || lead <= onBase + 2);
  N.pt.ir += onBase;
  t.pitcher = id;
  t.pOrder = t.pOrder || [];
  const midPA = g.pa && g.pa.pid === (old && old.id) && (g.pa.n > 0 || g.balls || g.strikes);
  if (opts.user) say(g, `Go, ${N.last}!`, 'good', 'change', { side });
  else say(g, `Now pitching for ${t.short}: ${N.name}.`, 'sys', 'change', { side });
  if (midPA) {
    g.pa.depart = { pid: old.id, b: g.balls, s: g.strikes };
    g.pa.pid = id;
    const B = g.P[g.pa.bid];
    const def = M.DEF_K * (teamDefense(g, side) - 50) / 10;
    const T = matchupTargets(B, N, def), kn = solveKnobs(B, N, T);
    g.pa.T = T; g.pa.kn = { W: kn.W, A: kn.A, q: kn.q, pBIP: kn.pBIP }; g.pa.bc = bipCalib(B, N, T, kn); g.pa.eS = TYPES.swingEdge(B, N);
    say(g, `${N.last} inherits a ${countStr(g)} count.`, 'sys', null);
    if (g.tally && !opts.user) g.tally.midAB++;
  }
  if (onBase) say(g, `He inherits ${onBase} runner${onBase > 1 ? 's' : ''}.`, 'sys', null);
  pbp(g, `${halfTag(g)}: ${N.last} replaces ${old ? old.last : 'the pitcher'}${onBase ? `, inherits ${onBase} runner${onBase > 1 ? 's' : ''}` : ''}.`);
  t.needPitcher = false;
  if (g.pending && g.pending.side === side) g.pending = null;
}
// Empty bullpen (section 5): a bench player, then the DH, then a fielder with the DH taking his position.
function positionPlayerPitcher(g, side) {
  const t = g.teams[side];
  const prep = id => { const gp = g.P[id]; gp.p = posPitcherRates(); initPitching(gp, true); if (g.tally) g.tally.posPitch++; return id; };
  const bench = t.bench.filter(id => !t.lineup.includes(id) && !(g.P[id].pt && g.P[id].pt.status !== 'avail'));
  if (bench.length) {
    const id = bench.sort((a, b) => hitterValue(g.P[a]) - hitterValue(g.P[b]))[0];
    t.bench = t.bench.filter(x => x !== id);
    say(g, `Out of pitchers! ${g.P[id].name} takes the mound.`, 'sys', 'change');
    return prep(id);
  }
  const dh = t.lineup.find(id => t.posOf[id] === 'DH');
  if (dh && !(g.P[dh].pt)) {
    t.posOf[dh] = 'P';   // the DH ends; he keeps his batting spot (5.11)
    say(g, `Out of pitchers! DH ${g.P[dh].name} takes the mound.`, 'sys', 'change');
    return prep(dh);
  }
  const fielders = t.lineup.filter(id => t.posOf[id] !== 'P' && t.posOf[id] !== 'DH' && !g.P[id].pt);
  if (fielders.length) {
    const id = fielders.sort((a, b) => fieldAt(g.P[a], t.posOf[a]) - fieldAt(g.P[b], t.posOf[b]))[0];
    const pos = t.posOf[id];
    const dh2 = t.lineup.find(x => t.posOf[x] === 'DH');
    if (dh2) t.posOf[dh2] = pos;
    t.posOf[id] = 'P';
    say(g, `Out of pitchers! ${POS_WORD[pos] === 'short' ? 'Shortstop' : 'Infielder'} ${g.P[id].name} takes the mound.`, 'sys', 'change');
    return prep(id);
  }
  return null;
}
// Can this team's pitcher leave now? 3 finished PAs this appearance, the end of a half (he hasn't thrown this half), or injury.
function canRemove(g, side) {
  const t = g.teams[side]; const P = g.P[t.pitcher];
  if (!P) return true;
  if (P.pt.min3 >= BARS.MIN_BATTERS) return true;
  if (side === fieldSide(g) && P.pt.innP === 0 && !(g.pa && g.pa.n > 0)) {
    // start of a half: allowed unless he entered this half and hasn't met the minimum
    if (!(P.pt.entered && P.pt.entered.inn === g.inning && P.pt.entered.half === g.half && !P.pt.start)) return true;
  }
  return false;
}
function comebacker(g, P, t, single, pos) {
  if (!BARS.COMEBACKER || g.over || P.pt.pos || P.pt.status !== 'in') return;
  if (!(t === 'gb' || t === 'ld')) return;
  if (!single && pos && ['LF', 'CF', 'RF'].includes(pos)) return;
  if (RA(g) >= BARS.COMEBACK) return;
  if (RA(g) < BARS.COMEBACK_INJ) {
    say(g, `The comebacker hits ${P.last}!`, 'hot', null);
    const side = g.teams.findIndex(tm => tm.pitcher === P.id);
    if (side >= 0) faintNow(g, side, P, 'INJ', g.outs >= 3);
    g.injuries = g.injuries || []; g.injuries.push(P.id);
  } else say(g, `It deflects off ${P.last}! He stays in the game.`, 'sys', null);
}
function visit(g, side, byUser) {
  const t = g.teams[side], P = g.P[t.pitcher];
  if (!P || t.visits <= 0 || P.pt.visitInn === g.inning || P.pt.pos) return false;
  t.visits--; P.pt.visitInn = g.inning;
  P.pt.hp = Math.min(100, P.pt.hp + BARS.VISIT); P.pt.steady = BARS.STEADY;
  say(g, 'The pitching coach heads to the mound...', 'sys', 'visit');
  say(g, `${P.last} takes a breath. He's steadied!`, 'good', 'heal');
  pbp(g, `${halfTag(g)}: mound visit (${t.short}).`);
  if (g.tally && !byUser) g.tally.visits++;
  return true;
}

/* ---------------------------------------------------------------- managers */
function aiControls(g, side) { return !isUser(g, side); }
function managerStartOfHalf(g) {
  const side = fieldSide(g), t = g.teams[side];
  if (t.needPitcher || t.pitcher == null) {
    t.needPitcher = false;
    if (isUser(g, side)) { g.pending = { side, forced: true }; say(g, 'Choose your next pitcher.', 'sys', 'pick'); return; }
    bringIn(g, side, pickReliever(g, side, { forced: true }), { forced: true });
    return;
  }
  if (!aiControls(g, side)) { coachPrompts(g, side); return; }
  const P = g.P[t.pitcher], dif = DIFF[g.difficulty] || DIFF.pro;
  const used = P.pt.used / 100;
  const lead = g.score[side] - g.score[1 - side];
  const last = g.inning >= g.innings;
  let change = used >= P.pt.B - dif.hook.half;
  if (P.pt.pos && availablePen(g, side).length) change = true;
  if (!change && last && lead >= 1 && lead <= 3 && t.closer && P.id !== t.closer && g.P[t.closer] && g.P[t.closer].pt && g.P[t.closer].pt.status === 'avail' && !P.pt.start) change = true;
  if (!change && last && lead >= 1 && lead <= 3 && t.closer && P.id !== t.closer && P.pt.start && used >= P.pt.B * 0.75 && g.P[t.closer] && g.P[t.closer].pt && g.P[t.closer].pt.status === 'avail') change = true;
  if (change) {
    const id = pickReliever(g, side, {});
    if (id != null) bringIn(g, side, id, {});
  }
}
function managerBetweenBatters(g) {
  const side = fieldSide(g), t = g.teams[side];
  if (t.pitcher == null) { requestChange(g, side, true); return; }
  const P = g.P[t.pitcher];
  if (!aiControls(g, side)) { coachPrompts(g, side); return; }
  const dif = DIFF[g.difficulty] || DIFF.pro;
  // visit once when his Health first drops to 30 or below
  if (dif.visits && P.pt.hp <= 30 && !P.pt.visitLow && t.visits > 0 && P.pt.visitInn !== g.inning && !P.pt.pos) { P.pt.visitLow = true; visit(g, side, false); }
  if (g.outs === 0 && P.pt.innP === 0) return;   // start-of-half hooks already ran
  if (!canRemove(g, side)) return;
  const used = P.pt.used / 100, left = P.pt.T - used;
  const risp = !!(g.bases[1] || g.bases[2]);
  if ((used > P.pt.B && risp) || left <= dif.hook.mid) {
    const id = pickReliever(g, side, {});
    if (id != null) bringIn(g, side, id, {});
  }
}
// Rookie: the coach suggests changes to the user.
function coachPrompts(g, side) {
  const dif = DIFF[g.difficulty] || DIFF.pro; if (!dif.prompts) return;
  const t = g.teams[side], P = g.P[t.pitcher]; if (!P) return;
  const id = pickReliever(g, side, {}); if (id == null) return;
  const used = P.pt.used / 100; P.pt.prompt = P.pt.prompt || {};
  const ask = k => { if (!P.pt.prompt[k]) { P.pt.prompt[k] = 1; say(g, `${P.last} is tiring. Bring in ${g.P[id].last}?`, 'sys', 'prompt'); } };
  if (P.pt.hp < 40) ask('hp'); else if (used >= P.pt.B) ask('b'); else if (used >= 0.8 * P.pt.B) ask('b8');
}

/* ---------------------------------------------------------------- AI calls (also the coach for AUTO) */
function userFamTendency(g, cat, first) {
  const h = g.adapt.hist[0].filter(e => first ? e.first : e.cat === cat).slice(-8);
  if (h.length < 3) return null;
  const c = { FB: 0, BR: 0, OS: 0 }; for (const e of h) c[e.fam]++;
  const top = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
  return { fam: top, share: c[top] / h.length, n: h.length };
}
function aiPitch(g, side) {
  const P = g.P[g.teams[side].pitcher], b = g.balls, s = g.strikes;
  let adapt = null;
  // adapt to a user hitter who keeps sitting on one family
  if (g.user != null && batSide(g) === g.user && g.adapt.app[0].length >= 6) {
    const a = g.adapt.app[0].slice(-10), c = { FB: 0, BR: 0, OS: 0 };
    for (const x of a) if (x.startsWith('sit')) c[x.slice(3)]++;
    adapt = {}; for (const f in c) if (c[f] / a.length >= 0.4) adapt[f] = 0.65;
  }
  const w = aiPitchWeights(P, b, s, adapt);
  const pi = wpick(g, P.p.pitches.map((_, i) => i), w);
  const x = P.p.pitches[pi];
  const loc = wpick(g, LOCS, aiLocWeights(x.fam, b, s));
  return { pi, loc };
}
function aiSwing(g, side) {
  const P = g.P[curPitcherId(g)], B = g.P[curBatterId(g)], b = g.balls, s = g.strikes;
  const aw = aiApproachWeights(b, s);
  let sitFam = topFamily(P, b, s, null);
  // adapt to the user's pitching patterns (section 5)
  if (g.user != null && fieldSide(g) === g.user) {
    const dif = DIFF[g.difficulty] || DIFF.pro;
    const first = b === 0 && s === 0;
    if (first) {
      const fp = g.adapt.hist[0].filter(e => e.first).slice(-dif.adapt);
      if (fp.length >= dif.adapt && fp.every(e => e.fam === fp[0].fam)) {
        sitFam = fp[0].fam; aw.sit = 0.75; aw.normal = 0.25;
        if (g.adapt.sit[0] !== 'first' + sitFam) { g.adapt.sit[0] = 'first' + sitFam; say(g, `They're sitting on your ${FAM_LABEL[sitFam].toLowerCase()}.`, 'hint', 'hint'); }
      }
    } else {
      const tnd = userFamTendency(g, countCat(b, s), false);
      if (tnd && tnd.share >= 0.7 && tnd.n >= dif.adapt + 2) {
        sitFam = tnd.fam; aw.sit = Math.max(aw.sit || 0, 0.5); aw.normal = (aw.normal || 0) * 0.6;
        if (g.adapt.sit[0] !== countCat(b, s) + sitFam) { g.adapt.sit[0] = countCat(b, s) + sitFam; say(g, `They're sitting on your ${FAM_LABEL[sitFam].toLowerCase()}.`, 'hint', 'hint'); }
      }
    }
  }
  const keys = Object.keys(aw);
  const k = wpick(g, keys, keys.map(x => aw[x]));
  const app = k === 'sit' ? 'sit' + sitFam : k;
  // steals: AI runners go now and then
  let run = null;
  const r1 = g.bases[0], r2 = g.bases[1];
  const diff = Math.abs(g.score[0] - g.score[1]);
  if (r1 && !r2 && g.outs < 2 && diff < 5 && b < 3) {
    const h = g.P[r1.id].h; if (h && R(g) < h.sbAtt * M.SB_K && stealChance(g, P, r1.id, 0) >= M.SB_MIN) run = 'steal2';
  } else if (r2 && !g.bases[2] && g.outs < 2 && diff < 4) {
    const h = g.P[r2.id].h; if (h && R(g) < h.sbAtt * M.SB_K * 0.12 && stealChance(g, P, r2.id, 1) >= M.SB_MIN + 0.05) run = 'steal3';
  }
  void B;
  return { app: run ? (s === 2 ? 'protect' : (app === 'normal' ? 'take' : app)) : app, run };
}
M.SB_K = 1.9; M.SB_MIN = 0.66; M.SB_OFF = 0.10;

/* ---------------------------------------------------------------- the loop */
function runUntilUser(g) {
  let guard = 0;
  g.need = null;
  while (!g.over && guard++ < 5000) {
    if (g.pending) { if (isUser(g, g.pending.side)) { g.need = 'forced'; break; } const sd = g.pending.side; g.pending = null; requestChange(g, sd, true); continue; }
    if (!g.pa) { startPA(g); if (g.pending || g.over) continue; }
    const fs = fieldSide(g), bs = batSide(g);
    if (!g.pa.def && isUser(g, fs)) { g.need = 'pitch'; break; }
    if (!g.pa.off && isUser(g, bs)) { g.need = 'swing'; break; }
    if (!g.pa.def) g.pa.def = aiPitch(g, fs);
    if (!g.pa.off) g.pa.off = aiSwing(g, bs);
    resolvePitch(g, g.pa.def, g.pa.off);
  }
  return g;
}
function userPitch(g, pi, loc) {
  if (g.need !== 'pitch' || !g.pa) return false;
  g.lines = []; g.pa.def = { pi, loc, user: true }; g.need = null;
  runUntilUser(g); return true;
}
function userSwing(g, app) {
  if (g.need !== 'swing' || !g.pa) return false;
  if (!APPROACHES.includes(app)) app = 'normal';
  g.lines = []; g.pa.off = { app, user: true }; g.need = null;
  runUntilUser(g); return true;
}
function runOptions(g) {
  const b = g.bases, o = [];
  if (b[0] && !b[1]) o.push('steal2');
  if (b[1] && !b[2]) o.push('steal3');
  if (b[0]) o.push('hitrun');
  o.push('bunt');
  if (b[2] && g.outs < 2) o.push('squeeze');
  return o;
}
function userRun(g, kind) {
  if (g.need !== 'swing' || !g.pa || !runOptions(g).includes(kind)) return false;
  g.lines = [];
  const app = kind === 'hitrun' ? 'protect' : kind === 'bunt' || kind === 'squeeze' ? 'bunt' : (g.strikes === 2 ? 'protect' : 'take');
  g.pa.off = { app, run: kind, user: true }; g.need = null;
  runUntilUser(g); return true;
}
function bullpenState(g, side) {
  const t = g.teams[side];
  const P = t.pitcher != null ? g.P[t.pitcher] : null;
  const list = t.pen.concat(t.tiredPen).concat(t.usedP).filter((v, i, a) => a.indexOf(v) === i).map(id => {
    const gp = g.P[id];
    return { id, name: gp.name, throws: gp.throws, role: gp.role, B: gp.pt ? gp.pt.B : budgetOf(gp), status: gp.pt ? gp.pt.status : 'avail',
      tired: t.tiredPen.includes(id), types: gp.types, lvl: gp.lvl, exit: gp.pt ? gp.pt.exit : null };
  });
  const forced = !!(g.pending && g.pending.side === side);
  let reason = null;
  if (!forced && P && !canRemove(g, side)) { const left = BARS.MIN_BATTERS - P.pt.min3; reason = `${P.last} must face ${left} more batter${left === 1 ? '' : 's'} (3-batter minimum).`; }
  return { list, forced, reason, coach: pickReliever(g, side, { forced }) };
}
function userBullpen(g, id) {
  const side = g.user; if (side == null) return false;
  const st = bullpenState(g, side);
  if (st.reason) return false;
  const e = st.list.find(x => x.id === id);
  if (!e || e.status !== 'avail') return false;
  if (!st.forced && fieldSide(g) !== side) return false;
  g.lines = [];
  bringIn(g, side, id, { user: true, forced: st.forced });
  g.pending = null;
  runUntilUser(g); return true;
}
function userVisit(g) {
  const side = g.user; if (side == null || fieldSide(g) !== side) return false;
  g.lines = [];
  const ok = visit(g, side, true);
  if (ok) runUntilUser(g);
  return ok;
}
function visitState(g) {
  const side = g.user, t = g.teams[side], P = t && g.P[t.pitcher];
  if (!P) return { ok: false, why: '' };
  if (P.pt.pos) return { ok: false, why: 'No visits for a position player.' };
  if (t.visits <= 0) return { ok: false, why: 'No mound visits left.' };
  if (P.pt.visitInn === g.inning) return { ok: false, why: 'A second trip this inning would force his removal. Use BULLPEN.' };
  return { ok: true, left: t.visits };
}
function benchState(g) {
  const side = g.user, t = g.teams[side];
  const out = new Set(t.slots.flat().concat(t.usedP));
  return { bench: t.bench.filter(id => !out.has(id) && !(g.P[id].pt && g.P[id].pt.status !== 'avail')).map(id => ({ id, name: g.P[id].name, pos: g.P[id].pos, bats: g.P[id].bats, val: hitterValue(g.P[id]), types: g.P[id].types, lvl: g.P[id].lvl })),
    lineup: t.lineup.map((id, i) => ({ i, id, name: g.P[id].name, pos: t.posOf[id] })) };
}
// Pinch hitter (between plate appearances only, so 9.15(b) never applies) or pinch runner.
function userPinch(g, slot, id) {
  const side = g.user, t = g.teams[side];
  if (side == null || batSide(g) !== side) return false;
  if (g.pa && g.pa.n > 0) return false;
  if (!benchState(g).bench.find(x => x.id === id)) return false;
  const old = t.lineup[slot]; if (old == null) return false;
  g.lines = [];
  t.lineup[slot] = id; t.posOf[id] = t.posOf[old]; delete t.posOf[old];
  t.slots[slot].push(id); t.bench = t.bench.filter(x => x !== id);
  say(g, `${g.P[id].name} pinch-hits for ${g.P[old].last}.`, 'sys', 'sub');
  pbp(g, `${halfTag(g)}: ${g.P[id].last} pinch-hits for ${g.P[old].last}.`);
  g.pa = null;
  runUntilUser(g); return true;
}
function userPinchRun(g, base, id) {
  const side = g.user, t = g.teams[side];
  if (side == null || batSide(g) !== side || !g.bases[base]) return false;
  if (!benchState(g).bench.find(x => x.id === id)) return false;
  const r = g.bases[base], old = r.id, slot = t.lineup.indexOf(old);
  if (slot < 0) return false;
  g.lines = [];
  t.lineup[slot] = id; t.posOf[id] = t.posOf[old]; delete t.posOf[old];
  t.slots[slot].push(id); t.bench = t.bench.filter(x => x !== id);
  g.bases[base] = { id, resp: r.resp, ue: r.ue };
  say(g, `${g.P[id].name} runs for ${g.P[old].last}.`, 'sys', 'sub');
  pbp(g, `${halfTag(g)}: ${g.P[id].last} pinch-runs for ${g.P[old].last}.`);
  runUntilUser(g); return true;
}
function userAuto(g) {
  if (g.user == null) return false;
  g.lines = [];
  g.auto = { side: g.user, inning: g.inning + g.half / 2 };
  say(g, 'The coach takes over for the rest of the inning.', 'sys', 'auto');
  runUntilUser(g); return true;
}
// The coach's call for the user's side (AUTO, bots, and the "suggested" highlight).
function coachCall(g) {
  if (g.need === 'pitch') return { kind: 'pitch', ...aiPitch(g, fieldSide(g)) };
  if (g.need === 'swing') return { kind: 'swing', app: aiSwing(g, batSide(g)).app };
  if (g.need === 'forced') return { kind: 'forced', id: pickReliever(g, g.pending.side, { forced: true }) };
  return null;
}
function simToEnd(g) {
  let n = 0;
  while (!g.over && n++ < 3000) {
    const c = coachCall(g);
    if (!c) { runUntilUser(g); continue; }
    if (c.kind === 'pitch') userPitch(g, c.pi, c.loc);
    else if (c.kind === 'swing') userSwing(g, c.app);
    else if (c.kind === 'forced') { if (c.id == null) { g.pending = null; bringIn(g, g.user, null, {}); runUntilUser(g); } else userBullpen(g, c.id); }
  }
  return g;
}
// Pitch card info: type effectiveness against this batter (section 11).
function pitchInfo(g, i) {
  const P = g.P[curPitcherId(g)], B = g.P[g.pa ? g.pa.bid : curBatterId(g)];
  const x = P.p.pitches[i]; if (!x) return null;
  const e = TYPES.pitchEdge(x, P, B);
  const pen = barPenalties(P);
  return { name: x.name, code: x.code, fam: x.fam, type: x.type, velo: Math.round(x.velo - pen.velo), usage: x.usage, whiff: x.whiff, stuff: x.stuff,
    mult: e.raw, stab: e.stab, label: TYPES.label(e.raw) };
}

/* ---------------------------------------------------------------- decisions and box score */
function assignDecisions(g) {
  if (g.winner == null) return;
  const W = g.winner, L = 1 - W;
  const tW = g.teams[W];
  const order = side => pitchersOf(g, side);
  const ll = g.lastLead && g.lastLead.side === W ? g.lastLead : null;
  let wp = ll ? ll.winP : order(W)[0];
  const starter = order(W)[0];
  if (wp === starter && g.P[starter].pt.outs < BARS.WIN_IP_OUTS && order(W).length > 1) {
    wp = order(W).slice(1).sort((a, b) => g.P[b].pt.outs - g.P[a].pt.outs)[0];
  }
  const lp = ll && g.P[ll.loseP] && g.P[ll.loseP].team === g.teams[L].abbr ? ll.loseP : order(L)[order(L).length - 1];
  g.P[wp].pt.decision = 'W';
  if (lp != null && g.P[lp] && g.P[lp].pt) g.P[lp].pt.decision = 'L';
  const fin = order(W)[order(W).length - 1];
  const F = g.P[fin];
  if (fin !== wp && F.pt && !F.pt.start && ((F.pt.enterSave && F.pt.outs >= 3) || (F.pt.enterLead > 0 && F.pt.outs >= 6))) F.pt.decision = 'S';
  void tW;
}
function pitchersOf(g, side) {
  const t = g.teams[side];
  const ids = t.roster.filter(id => g.P[id] && g.P[id].pt && g.P[id].pt.status !== 'avail');
  return ids.sort((a, b) => entOrder(g.P[a]) - entOrder(g.P[b]));
}
function entOrder(gp) { const e = gp.pt.entered; return e ? e.inn * 100 + e.half * 10 + (e.outs || 0) + (gp.pt.start ? -1000 : 0) : 99999; }
function boxScore(g) {
  const out = [];
  for (let side = 0; side < 2; side++) {
    const t = g.teams[side];
    const bat = [];
    t.slots.forEach((ids, i) => ids.forEach((id, j) => { const p = g.P[id]; bat.push({ id, slot: i + 1, sub: j > 0, name: p.name, last: p.last, pos: t.posOf[id] || (j > 0 ? 'PH' : ''), ...p.b }); }));
    const pit = pitchersOf(g, side).map(id => { const p = g.P[id], pt = p.pt; return { id, name: p.name, last: p.last, outs: pt.outs, ip: ipStr(pt.outs), h: pt.h, r: pt.r, er: pt.er, bb: pt.bb, k: pt.k, hr: pt.hr, np: pt.np, st: pt.st, ir: pt.ir, irs: pt.irs, exit: pt.exit, dec: pt.decision, bf: pt.bf, pos: pt.pos, wp: pt.wp, hbp: pt.hbp }; });
    out.push({ abbr: t.abbr, short: t.short, name: t.name, runs: g.score[side], hits: g.hitsT[side], errors: g.errT[side], line: g.line[side].slice(), bat, pit });
  }
  const notes = [];
  for (let side = 0; side < 2; side++) for (const p of out[side].pit) {
    const gp = g.P[p.id];
    if (gp.pt.exitInn && gp.pt.outsInn === 0 && gp.pt.battersInn > 0 && gp.pt.status !== 'in') notes.push(`${p.last} pitched to ${gp.pt.battersInn} batter${gp.pt.battersInn > 1 ? 's' : ''} in the ${ordinal(gp.pt.exitInn)}.`);
  }
  for (let side = 0; side < 2; side++) {
    const irs = out[side].pit.filter(p => p.ir > 0).map(p => `${p.last} ${p.ir}-${p.irs}`);
    if (irs.length) notes.push(`Inherited runners-scored: ${irs.join(', ')}.`);
  }
  notes.push('Pitches-strikes: ' + out.map(o => o.pit.map(p => `${p.last} ${p.np}-${p.st}`).join(', ')).join('; ') + '.');
  return { teams: out, notes, pbp: g.pbp.slice() };
}
const ipStr = outs => `${Math.floor(outs / 3)}.${outs % 3}`;

// Calibration tallies (tools/sim.js).
function tallyGame(g) {
  const T = g.tally; T.games++;
  if (g._faint) T.gamesWithFaint++;
  for (let side = 0; side < 2; side++) {
    const ps = pitchersOf(g, side);
    T.pitchersUsed += ps.length;
    ps.forEach((id, i) => {
      const pt = g.P[id].pt;
      if (pt.start) {
        T.startsN++; T.starterPitches.push(pt.np); T.starterOuts.push(pt.outs);
        if (pt.outs < 9 && pt.exit !== 'INJ') T.shortStarts++;
        if (pt.exit === 'KO') T.startsKO.push({ outs: pt.outs, r: pt.r });
      } else { T.reliefApps++; T.reliefOuts += pt.outs; }
    });
  }
}

/* ================================================================ EVs during Pennant Run games */
const ANSWER_P = { stuff: 'contact', control: 'eye', movement: 'power' };   // pitcher's best tool -> batter stat trained
const ANSWER_B = { contact: 'stuff', eye: 'control', power: 'movement' };   // batter's best tool -> pitcher stat trained
function bestOf(rt, keys) { let b = keys[0]; for (const k of keys) if ((rt[k] || 0) > (rt[b] || 0)) b = k; return b; }
function evOnPA(g, B, P) {
  if (g.mode !== 'pennant' || g.user == null) return;
  const us = g.teams[g.user].roster;
  if (us.includes(B.id)) {
    const st = ANSWER_P[bestOf(P.rt, ['stuff', 'control', 'movement'])];
    B.evGain = B.evGain || {}; B.evGain[st] = (B.evGain[st] || 0) + (P.types.includes('Franchise') ? 4 : 3);
  }
  if (us.includes(P.id) && !P.pt.pos) {
    const st = ANSWER_B[bestOf(B.rt, ['contact', 'eye', 'power'])];
    P.evGain = P.evGain || {}; P.evGain[st] = (P.evGain[st] || 0) + (B.types.includes('Franchise') ? 2 : 1);
  }
}

/* ================================================================ modes */
function teamStrength(abbr) {
  const { team, P } = buildTeam(abbr, {});
  const lu = team.lineup.map(id => hitterValue(P[id]));
  const rot = team.rot.filter(id => P[id] || true).map(id => { const gp = P[id] || makeGP(id); return pitcherValue(gp); });
  const pen = team.pen.map(id => pitcherValue(P[id]));
  const avg = a => a.length ? sum(a) / a.length : 0;
  return { lineup: avg(lu), rotation: avg(rot), bullpen: avg(pen) };
}
let STRENGTH = null;
function strengths() {
  if (STRENGTH) return STRENGTH;
  const raw = {};
  for (const t of TEAMS) { try { raw[t.abbr] = teamStrength(t.abbr); } catch (e) { /* custom team without enough players */ } }
  const keys = ['lineup', 'rotation', 'bullpen'], out = {};
  for (const ab in raw) out[ab] = {};
  for (const k of keys) {
    const vals = Object.values(raw).map(r => r[k]).sort((a, b) => a - b);
    for (const ab in raw) { const r = vals.findIndex(v => v >= raw[ab][k]); out[ab][k] = Math.round(40 + 59 * r / Math.max(1, vals.length - 1)); }
  }
  for (const ab in out) out[ab].ovr = Math.round((out[ab].lineup * 0.5 + out[ab].rotation * 0.3 + out[ab].bullpen * 0.2));
  STRENGTH = out;
  return out;
}
function rankedTeams(except) { const s = strengths(); return Object.keys(s).filter(a => a !== except).sort((a, b) => s[a].ovr - s[b].ovr); }

function newExhibition(o) {
  return { ver: 1, mode: 'exhibition', away: o.away, home: o.home, user: o.user, difficulty: o.difficulty || 'pro', seed: o.seed, game: null, results: [], lineups: o.lineups || {} };
}
const SEASON_GAMES = 12, PO_ROUNDS = ['wc', 'ds', 'cs', 'ws'], PO_LABEL = { wc: 'Wild Card Game', ds: 'Division Series', cs: 'League Championship', ws: 'World Series' };
function newSeason(o) {
  const seed = (o.seed != null ? o.seed : Math.floor(Math.random() * 4294967296)) >>> 0;
  const g0 = { rng: seed };
  const opps = TEAMS.filter(t => t.abbr !== o.team && !t.custom).map(t => t.abbr);
  const sched = [];
  const pool = opps.slice();
  for (let i = 0; i < SEASON_GAMES; i++) { const j = Math.floor(rngNext(g0, 'rng') * pool.length); sched.push({ opp: pool.splice(j, 1)[0], home: i % 2 === 0 }); }
  return { ver: 1, mode: 'season', team: o.team, difficulty: o.difficulty || 'pro', seed, sched, week: 0, results: [], stage: null, done: false,
    outcome: null, rot: 0, work: {}, inj: {}, game: null, lineups: o.lineups || {} };
}
function newPennant(o) {
  const ranked = rankedTeams(o.team);
  const champ = ranked[ranked.length - 1];
  const elite = ranked.slice(ranked.length - 5, ranked.length - 1);
  const leaders = [];
  const rest = ranked.slice(0, ranked.length - 5);
  for (let i = 0; i < 8; i++) leaders.push(rest[Math.floor(i * rest.length / 8 + rest.length / 16)]);
  const prog = {};
  for (const id of teamPlayers(o.team)) prog[id] = { lvl: LEVELS.START, xp: LEVELS.xpFor(LEVELS.START), ev: {} };
  return { ver: 1, mode: 'pennant', team: o.team, difficulty: o.difficulty || 'pro', seed: o.seed, prog, leaders, elite, champ,
    pr: { leader: 0, route: 0, badges: [], e4: null, champ: false, games: 0, retries: {} }, results: [], done: false, outcome: null, game: null, last: null, lineups: o.lineups || {} };
}
function avgLevel(S) {
  const ids = teamPlayers(S.team); const ls = ids.map(id => (S.prog[id] || { lvl: LEVELS.START }).lvl);
  return ls.length ? sum(ls) / ls.length : LEVELS.START;
}
// What's next for a mode: { opp, home, level, label, round }
function nextGameOf(S) {
  if (S.mode === 'exhibition') return { opp: S.user === 0 ? S.home : S.away, label: 'Exhibition' };
  if (S.mode === 'season') {
    if (S.done) return null;
    if (S.stage) {
      const faced = S.results.filter(r => r.round !== 'reg').map(r => r.opp);
      const ranked = rankedTeams(S.team).filter(a => !faced.includes(a));
      const idx = PO_ROUNDS.indexOf(S.stage);
      const opp = ranked[Math.max(0, ranked.length - 1 - (3 - idx) * 2)];
      return { opp, home: idx % 2 === 1, round: S.stage, label: PO_LABEL[S.stage] };
    }
    const m = S.sched[S.week];
    return { opp: m.opp, home: m.home, round: 'reg', label: `Game ${S.week + 1} of ${SEASON_GAMES}` };
  }
  if (S.mode === 'pennant') {
    const pr = S.pr;
    if (S.done) return null;
    if (pr.champ) return { opp: S.champ, home: false, level: LEVELS.CHAMP, round: 'champ', label: 'The Champion' };
    if (pr.e4 != null) return { opp: S.elite[pr.e4], home: pr.e4 % 2 === 1, level: LEVELS.ELITE[pr.e4], round: 'e4', label: `Elite Four, match ${pr.e4 + 1} of 4` };
    if (pr.route < LEVELS.ROUTES) {
      const avg = avgLevel(S), cap = LEVELS.LEADERS[pr.leader] - 2;
      const lvl = clamp(Math.round(avg - 1 - (pr.games * 7 + 3) % 3), 1, cap);
      const opts = TEAMS.filter(t => t.abbr !== S.team && !t.custom).map(t => t.abbr);
      const opp = opts[(hashStr(S.team + pr.games) >>> 0) % opts.length];
      return { opp, home: pr.games % 2 === 0, level: lvl, round: 'route', label: `Route game ${pr.route + 1} of ${LEVELS.ROUTES}` };
    }
    return { opp: S.leaders[pr.leader], home: true, level: LEVELS.LEADERS[pr.leader], round: 'leader', label: `Division Leader ${pr.leader + 1} of 8` };
  }
  return null;
}
function startNext(S, extra) {
  extra = extra || {};
  const ng = nextGameOf(S); if (!ng) return null;
  let away, home, user;
  if (S.mode === 'exhibition') { away = S.away; home = S.home; user = S.user; }
  else { user = ng.home ? 1 : 0; away = ng.home ? ng.opp : S.team; home = ng.home ? S.team : ng.opp; }
  const userAbbr = S.mode === 'exhibition' ? (user === 0 ? away : home) : S.team;
  const lu = S.lineups && S.lineups[userAbbr];
  const uo = {}, oo = {};
  if (lu && lu.lineup) { uo.lineup = lu.lineup; uo.positions = lu.positions; }
  if (S.mode === 'season') {
    const rot = buildTeam(S.team, {}).team.rot;
    uo.starter = rot[S.rot % rot.length];
    uo.tired = new Set(Object.keys(S.work).map(Number).filter(id => tiredNow(S, id)));
    uo.injured = new Set(Object.keys(S.inj).map(Number).filter(id => S.inj[id] > 0));
  }
  if (S.mode === 'pennant') {
    uo.lvl = id => { const p = S.prog[id] || { lvl: LEVELS.START, ev: {} }; return { level: p.lvl, ev: p.ev }; };
    oo.lvl = id => ({ level: ng.level, ev: opponentEVs(id, ng.level) });
  }
  if (extra.userStarter != null) uo.starter = extra.userStarter;
  const seed = extra.seed != null ? extra.seed : (S.seed != null ? (S.seed + 7919 * (S.results.length + 1)) >>> 0 : undefined);
  S.game = newGame({ away, home, user: user == null ? null : user, difficulty: S.difficulty, seed, mode: S.mode, label: ng.label,
    awayOpts: user === 0 ? uo : oo, homeOpts: user === 1 ? uo : oo, safetyCap: extra.safetyCap });
  S.game.round = ng.round || null; S.game.oppLevel = ng.level || null;
  if (extra.auto) return S.game;
  runUntilUser(S.game);
  return S.game;
}
function opponentEVs(id, L) {
  const v = view(id); if (!v) return {};
  const keys = v.kind === 'P' ? PIT_STATS : HIT_STATS;
  const tot = Math.min(LEVELS.EV_TOTAL, 6 * L);
  const order = keys.slice().sort((a, b) => v.ratings[b] - v.ratings[a]);
  const share = [0.4, 0.3, 0.2, 0.1, 0, 0];
  const ev = {};
  order.forEach((k, i) => { ev[k] = Math.min(LEVELS.EV_MAX, Math.round(tot * (share[i] || 0))); });
  return ev;
}
function tiredNow(S, id) {
  const w = S.work[id]; if (!w) return false;
  const g = S.results.length;
  const last = w.games || [];
  if (last.length && last[last.length - 1].i === g - 1 && last[last.length - 1].np >= 30) return true;
  if (last.length >= 2 && last[last.length - 1].i === g - 1 && last[last.length - 2].i === g - 2) return true;
  return false;
}
// After the final out: record the result, workloads, injuries, XP and EVs. Returns the result object.
function finishGame(S) {
  const g = S.game; if (!g || !g.over) return null;
  const u = g.user;
  const box = boxScore(g);
  const win = u != null ? g.winner === u : null;
  const ng = nextGameOf(S);
  const res = { round: g.round || null, label: g.label, opp: u != null ? g.teams[1 - u].abbr : null, home: u === 1, win,
    us: u != null ? g.score[u] : g.score[0], them: u != null ? g.score[1 - u] : g.score[1], score: g.score.slice(), abbrs: g.teams.map(t => t.abbr),
    innings: g.inning, box, pog: playerOfGame(g, u != null ? u : (g.winner || 0)) };
  S.results.push(res); S.last = res;
  if (S.mode === 'season') {
    // workloads and injuries for the user's pitchers
    const t = g.teams[u];
    for (const id of t.roster) {
      const gp = g.P[id]; if (!gp || !gp.pt || gp.pt.status === 'avail') continue;
      S.work[id] = S.work[id] || { games: [] };
      S.work[id].games.push({ i: S.results.length - 1, np: gp.pt.np });
      if (S.work[id].games.length > 3) S.work[id].games.shift();
    }
    for (const id in S.inj) if (S.inj[id] > 0) S.inj[id]--;
    for (const id of (g.injuries || [])) if (t.roster.includes(id)) S.inj[id] = 3 + Math.floor(RA(g) * 4);
    S.rot++;
    if (res.round === 'reg') {
      S.week++;
      if (S.week >= SEASON_GAMES) {
        const W = S.results.filter(r => r.round === 'reg' && r.win).length;
        S.stage = W >= 7 ? 'ds' : W === 6 ? 'wc' : null;
        if (!S.stage) { S.done = true; S.outcome = 'missed'; }
      }
    } else {
      if (!win) { S.done = true; S.outcome = res.round; }
      else if (res.round === 'ws') { S.done = true; S.outcome = 'champion'; }
      else S.stage = PO_ROUNDS[PO_ROUNDS.indexOf(res.round) + 1];
    }
  }
  if (S.mode === 'pennant') {
    res.levelUps = applyPennantXP(S, g, ng);
    const pr = S.pr; pr.games++;
    if (res.round === 'route') { pr.route++; }
    else if (res.round === 'leader') {
      if (win) { pr.badges.push(S.leaders[pr.leader]); pr.leader++; pr.route = 0; if (pr.leader >= 8) pr.e4 = 0; }
      else pr.retries[pr.leader] = (pr.retries[pr.leader] || 0) + 1;
    } else if (res.round === 'e4') {
      if (win) { pr.e4++; if (pr.e4 >= 4) { pr.e4 = null; pr.champ = true; } }
      else { pr.e4 = 0; pr.retries.e4 = (pr.retries.e4 || 0) + 1; }
    } else if (res.round === 'champ') {
      if (win) { S.done = true; S.outcome = 'champion'; }
      else { pr.champ = false; pr.e4 = 0; pr.retries.champ = (pr.retries.champ || 0) + 1; }
    }
  }
  S.game = null;
  return res;
}
function applyPennantXP(S, g, ng) {
  const u = g.user, t = g.teams[u];
  const Lopp = g.oppLevel || (ng && ng.level) || 5;
  const units = {}, played = [];
  for (const id of t.roster) {
    const gp = g.P[id]; if (!gp) continue;
    let un = 0;
    if (gp.b && gp.b.pa) un += gp.b.pa * LEVELS.U.pa + gp.b.h * LEVELS.U.hit + gp.b.hr * LEVELS.U.hr + gp.b.rbi * LEVELS.U.rbi;
    if (gp.pt && gp.pt.bf) un += gp.pt.bf * LEVELS.U.bf + gp.pt.k * LEVELS.U.k + (gp.pt.decision === 'W' ? LEVELS.U.win : 0) + (gp.pt.decision === 'S' ? LEVELS.U.save : 0);
    if (un > 0) { units[id] = un; played.push(id); }
  }
  const avgU = played.length ? sum(played.map(id => units[id])) / played.length : 0;
  const ups = [];
  for (const id of teamPlayers(S.team)) {
    const p = S.prog[id] = S.prog[id] || { lvl: LEVELS.START, xp: LEVELS.xpFor(LEVELS.START), ev: {} };
    const gp = g.P[id];
    const un = units[id] != null ? units[id] : avgU / 2;   // Exp Share
    const gain = LEVELS.gain(un, Lopp, p.lvl);
    p.xp += gain;
    const from = p.lvl;
    p.lvl = Math.min(100, LEVELS.levelOf(p.xp));
    // EVs
    const add = Object.assign({}, gp && gp.evGain || {});
    if (gp && gp.b) { add.gap = (add.gap || 0) + 2 * (gp.b.d2 + gp.b.d3); add.speed = (add.speed || 0) + 2 * gp.b.sb + (gp.evSpeed || 0); }
    if (gp && gp.kind === 'H' && t.lineup.includes(id) && t.posOf[id] && t.posOf[id] !== 'DH') add.fielding = (add.fielding || 0) + 1;
    if (gp && gp.pt && gp.pt.outs) add.stamina = (add.stamina || 0) + Math.floor(gp.pt.outs / 3);
    const keys = (view(id) || {}).kind === 'P' ? PIT_STATS : HIT_STATS;
    let total = sum(Object.values(p.ev));
    for (const k of keys) {
      if (!add[k]) continue;
      const room = Math.min(LEVELS.EV_MAX - (p.ev[k] || 0), LEVELS.EV_TOTAL - total);
      const n = Math.max(0, Math.min(room, add[k]));
      if (n) { p.ev[k] = (p.ev[k] || 0) + n; total += n; }
    }
    if (p.lvl > from) {
      const v = view(id); const stats = {};
      for (const k of keys) stats[k] = [LEVELS.shownStat(v.ratings[k], v.iv[k], p.ev[k], from), LEVELS.shownStat(v.ratings[k], v.iv[k], p.ev[k], p.lvl)];
      ups.push({ id, name: v.name, from, to: p.lvl, stats });
    }
  }
  return ups;
}
function playerOfGame(g, side) {
  let best = null, bs = -1e9;
  for (const id of g.teams[side].roster) {
    const p = g.P[id]; if (!p) continue;
    let sc = 0;
    if (p.b && p.b.pa) sc += p.b.h + p.b.d2 + 2 * p.b.d3 + 3 * p.b.hr + p.b.rbi + 0.5 * p.b.bb + p.b.sb * 0.5 + p.b.r * 0.5 - 0.3 * p.b.k;
    if (p.pt && p.pt.outs) sc += p.pt.outs / 3 * 1.2 + p.pt.k * 0.4 - p.pt.er * 1.2 - p.pt.h * 0.25 - p.pt.bb * 0.3 + (p.pt.decision === 'W' ? 1 : 0) + (p.pt.decision === 'S' ? 1 : 0);
    if (sc > bs) { bs = sc; best = id; }
  }
  if (best == null) return null;
  const p = g.P[best];
  const line = p.pt && p.pt.outs ? `${ipStr(p.pt.outs)} IP, ${p.pt.h} H, ${p.pt.er} ER, ${p.pt.k} K` : `${p.b.h}-${p.b.ab}${p.b.hr ? `, ${p.b.hr} HR` : ''}${p.b.rbi ? `, ${p.b.rbi} RBI` : ''}`;
  return { id: best, name: p.name, line };
}

/* ================================================================ saving
   The game state is plain data, so a save is JSON. Lines are UI-only and dropped. */
function pack(S) { return JSON.stringify(S, (k, v) => (k === 'lines' ? undefined : v)); }
function unpack(txt) {
  const S = JSON.parse(txt);
  if (!S || S.ver !== 1) return null;
  if (S.game) { S.game.lines = []; }
  return S;
}

/* ================================================================ editor helpers */
// Expected line against a league-average pitcher, from the rates (section 8 live preview).
function projectLine(id) {
  const gp = makeGP(id);
  if (gp.kind === 'P') {
    const p = gp.p, bip = 1 - p.k - p.bb - p.hbp - p.hr;
    const h = bip * p.babip + p.hr, ab = 1 - p.bb - p.hbp - 0.008;
    return { kind: 'P', k: p.k, bb: p.bb, hr: p.hr, avg: h / ab, budget: Math.round(p.budget), tank: tankOf(Math.round(p.budget)),
      era: Math.max(0, 9 * (0.5 * p.bb + 0.6 * p.hbp + 1.4 * p.hr * 2.8 + bip * p.babip * 0.48 - p.k * 0.1) / (1 - p.bb - p.hbp - bip * p.babip - p.hr) * 3.1 / 3) };
  }
  const h = gp.h, bip = 1 - h.k - h.bb - h.hbp - h.hr;
  const hits = bip * h.babip, tot = h.s1 + h.s2 + h.s3 || 1;
  const s1 = hits * h.s1 / tot, s2 = hits * h.s2 / tot, s3 = hits * h.s3 / tot;
  const ab = 1 - h.bb - h.hbp - 0.008;
  const H = hits + h.hr;
  return { kind: 'H', avg: H / ab, obp: (H + h.bb + h.hbp) / (1 - 0.003), slg: (s1 + 2 * s2 + 3 * s3 + 4 * h.hr) / ab, hr600: Math.round(h.hr * 600), k: h.k, bb: h.bb };
}
function setOverridesAll(o) { setOverrides(o); STRENGTH = null; SOLVE_CACHE.clear(); }

const FC = {
  DATA, LG, TYPES, LEVELS, BARS, M, DIFF, LOCS, LOC_LABEL, APPROACHES, APP_LABEL, FAM_LABEL, HIT_STATS, PIT_STATS, STAT_LABEL, POSN,
  PLAYERS, TEAMS, get PBY() { return PBY; }, get TBY() { return TBY; }, OV, view, base, makeGP, teamPlayers, hitterValue, pitcherValue,
  setOverrides: setOverridesAll, rebuildIndex,
  newGame, runUntilUser, userPitch, userSwing, userRun, userBullpen, userVisit, userPinch, userPinchRun, userAuto, coachCall, simToEnd,
  runOptions, bullpenState, visitState, benchState, pitchInfo, boxScore, snap, curBatterId, curPitcherId, fieldSide, batSide, isUser,
  barPenalties, hpColor, ftgColor, pfOf, budgetOf, tankOf, canRemove, autoLineup, buildTeam,
  newExhibition, newSeason, newPennant, nextGameOf, startNext, finishGame, strengths, rankedTeams, avgLevel, opponentEVs,
  pack, unpack, projectLine, ipStr, lastName, log5, clamp, newTally, SEASON_GAMES, PO_LABEL,
  _t: { matchupTargets, solveKnobs, countDP, baseCtx, bbMix, bipCalib, pitchProbs, SOLVE_CACHE, buildCtx, aiPitch, aiSwing, startPA, resolvePitch, faintNow, bringIn, visit, applyBars },
};
if (typeof module !== 'undefined') module.exports = FC;
else root.FC = FC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
