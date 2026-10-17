/* Full Count UI. Patterns follow Pick & Roll: one render() per screen, a playback queue that replays engine lines
   with snapshots, an event bus for effects, sprites drawn in code, and saves in localStorage. */
'use strict';
const app = document.getElementById('app');
const KEY = 'fullcount-save-v1', PREF_KEY = 'fullcount-prefs-v1', EDIT_KEY = 'fullcount-edits-v1';
let S = null;
const UI = {
  screen: 'title', menu: 'cmd', sel: 0, loc: 'edge', app: 'normal', V: null, sheet: false, sheetTab: 'box', intro: false,
  confirmReset: false, confirmSim: false, lu: null, luPos: null, starter: null, bpSel: null, phSel: null,
  setup: { mode: 'exhibition', team: 'NYY', opp: 'LAD', home: true, difficulty: 'pro' },
  ed: { q: '', team: '', pos: '', kind: '', sort: 'name', id: null, draft: null, share: '', msg: '', newTeam: null },
};
const PREFS = { speed: 'mid', mode: 'auto', sound: true };
try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); if (p && typeof p === 'object') Object.assign(PREFS, p); } catch (e) { /* storage blocked */ }
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(PREFS)); } catch (e) { /* storage blocked */ } }
function save() { try { if (S) localStorage.setItem(KEY, FC.pack(S)); } catch (e) { /* storage blocked */ } }
function loadSaved() { try { const t = localStorage.getItem(KEY); return t ? FC.unpack(t) : null; } catch (e) { return null; } }
function clearSaved() { try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }
function loadEdits() { try { const t = localStorage.getItem(EDIT_KEY); if (t) FC.setOverrides(JSON.parse(t)); } catch (e) { /* bad or blocked */ } }
function saveEdits() { try { localStorage.setItem(EDIT_KEY, JSON.stringify(FC.OV)); } catch (e) { /* storage blocked */ } }

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = FC.clamp;
function hexRGB(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbHex(a) { return '#' + a.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
function shade(h, a) { return rgbHex(hexRGB(h).map(v => a < 0 ? v * (1 + a) : v + (255 - v) * a)); }
function mix(a, b, t) { const x = hexRGB(a), y = hexRGB(b); return rgbHex(x.map((v, i) => v * (1 - t) + y[i] * t)); }
function lum(hex) { const [r, g, b] = hexRGB(hex); return (.299 * r + .587 * g + .114 * b) / 255; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const REDUCED = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
function anim(el, cls, ms) { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); clearTimeout(el['_t' + cls]); el['_t' + cls] = setTimeout(() => el.classList.remove(cls), ms); }
const TEAM = ab => FC.TBY[ab] || { abbr: ab, name: ab, short: ab, colors: ['#334155', '#cbd5e1'] };
const tmColor = ab => TEAM(ab).colors[0];
const tmChip = ab => `<span class="tm-chip" style="--tc:${esc(tmColor(ab))}"><i></i>${esc(ab)}</span>`;
const readable = c => (lum(c) < 0.22 ? shade(c, 0.55) : lum(c) > 0.85 ? 'var(--chalk)' : c);
const lastName = FC.lastName;
const pct3 = x => (x >= 1 ? x.toFixed(3) : x.toFixed(3).replace(/^0/, ''));
function typeChip(t, small) {
  const i = FC.TYPES.idx(t), c = FC.TYPES.colors[i] || '#999';
  return `<span class="ty" style="--ty:${c};--tyfg:${lum(c) > 0.55 ? '#111' : '#fff'}" title="${esc(t)} (${esc(FC.TYPES.poke[i] || '')})">${esc(small ? FC.TYPES.short[i] : t)}</span>`;
}
const typeDots = ts => `<span class="sb-dots">${(ts || []).map(t => `<i class="dot" style="--ty:${FC.TYPES.colors[FC.TYPES.idx(t)] || '#999'}" title="${esc(t)}"></i>`).join('')}</span>`;
const typeChips = (ts, small) => (ts || []).map(t => typeChip(t, small)).join('');
function effTag(m) { return m === 0 ? '<span class="eff z">No effect</span>' : m >= 2 ? `<span class="eff up">${m >= 4 ? '4×' : '2×'}</span>` : m <= 0.5 ? `<span class="eff dn">${m <= 0.25 ? '¼×' : '½×'}</span>` : '<span class="eff n">1×</span>'; }
function hitLine(v) {
  const l = v.line || {};
  if (!l.ab) return v.flag === 'repl' ? 'Replacement level' : 'No 2026 stats';
  const avg = l.h / l.ab, obp = (l.h + l.bb + (l.hbp || 0)) / Math.max(1, l.ab + l.bb + (l.hbp || 0) + (l.sf || 0)), slg = (l.tb || 0) / l.ab;
  return `${pct3(avg)}/${pct3(obp)}/${pct3(slg)} · ${l.hr} HR${l.sb ? ` · ${l.sb} SB` : ''}${v.flag === '2025' ? ' (2025)' : ''}`;
}
function pitLine(v) {
  const l = v.line || {};
  if (!l.ip) return v.flag === 'repl' ? 'Replacement level' : 'No 2026 stats';
  const era = l.ip ? (9 * l.er / l.ip) : 0;
  return `${era.toFixed(2)} ERA · ${l.ip} IP · ${l.k} K${l.sv ? ` · ${l.sv} SV` : ''}${v.flag === '2025' ? ' (2025)' : ''}`;
}
const statLine = v => v.kind === 'P' ? pitLine(v) : hitLine(v);

/* ---------- Sprites: original pixel ballplayers drawn in code, cached by look ---------- */
const SPR_W = 40, SPR_H = 48, SPR_CACHE = {};
const SKINS = [['#f1c7a3', '#d9a47f'], ['#d8a27a', '#b9805a'], ['#a8754e', '#8a5d3b'], ['#7a4f33', '#5f3b25'], ['#c48c62', '#a26d45']];
function skinFor(name) { let h = 7; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return SKINS[h % SKINS.length]; }
function spriteURL(o) {
  const key = [o.c1, o.c2, o.view, o.role, o.hand, o.skin && o.skin[0], o.home ? 1 : 0].join('|');
  if (SPR_CACHE[key] !== undefined) return SPR_CACHE[key];
  const W = SPR_W, H = SPR_H, buf = new Array(W * H).fill(null);
  const put = (x, y, c) => { if (c && x >= 0 && x < W && y >= 0 && y < H) buf[y * W + x] = c; };
  const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, typeof c === 'function' ? c(x, y) : c); };
  const ell = (cx, cy, rx, ry, c) => { for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) { const dy = (y + .5 - cy) / ry; if (dy < -1 || dy > 1) continue; const hw = rx * Math.sqrt(1 - dy * dy); for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) put(x, y, typeof c === 'function' ? c(x, y) : c); } };
  const front = o.view === 'front', bat = o.role === 'bat';
  const c1 = o.c1, c2 = o.c2;
  const jersey = o.home ? '#f4f2ea' : mix(c1, '#ffffff', 0.08), jD = o.home ? '#d6d2c4' : shade(c1, -.25);
  const pants = o.home ? '#f4f2ea' : '#c9ccd3', pD = o.home ? '#d6d2c4' : '#a6aab4';
  const [skin, skinD] = o.skin || SKINS[1];
  const ink = '#111725', cleat = '#1c1f26', glove = '#8a5a2b', gloveD = '#6a4220', wood = '#d9b07a', woodD = '#a97a45';
  const cx = 20;
  // legs: pants to the knee, team socks, cleats
  rect(cx - 6, 30, 5, 9, x => x === cx - 2 ? pD : pants); rect(cx + 1, 30, 5, 9, x => x === cx + 5 ? pD : pants);
  rect(cx - 6, 39, 5, 4, c1); rect(cx + 1, 39, 5, 4, c1);
  rect(cx - 7, 43, 6, 3, cleat); rect(cx + 1, 43, 6, 3, cleat);
  // belt
  rect(cx - 7, 28, 14, 2, ink);
  // jersey
  rect(cx - 7, 15, 14, 13, x => x >= cx + 4 ? jD : jersey);
  rect(cx - 7, 15, 14, 1, c2);
  if (front) { for (let y = 15; y < 28; y++) put(cx, y, c2); rect(cx - 2, 15, 4, 2, skin); }
  // arms
  if (bat) {
    // batting stance: hands together near the back shoulder, bat up
    rect(cx - 9, 16, 3, 6, jersey); rect(cx + 6, 16, 3, 6, jD);
    const hx = o.hand === 'L' ? cx - 9 : cx + 6;
    rect(hx, 13, 4, 3, skin);
    const bx = o.hand === 'L' ? hx - 3 : hx + 3;
    for (let i = 0; i < 12; i++) put(bx + (o.hand === 'L' ? -Math.floor(i / 3) : Math.floor(i / 3)), 12 - i, i < 3 ? woodD : wood);
    for (let i = 0; i < 12; i++) put(bx + 1 + (o.hand === 'L' ? -Math.floor(i / 3) : Math.floor(i / 3)), 12 - i, i < 3 ? woodD : (i > 8 ? wood : woodD));
  } else {
    // pitcher: glove side forward, throwing arm cocked
    const throwR = o.hand !== 'L';
    const gx = throwR ? cx - 11 : cx + 7, ax = throwR ? cx + 6 : cx - 9;
    rect(throwR ? cx - 9 : cx + 6, 16, 3, 5, jersey);
    ell(gx + 2, 22, 3, 3, glove); put(gx + 2, 22, gloveD); put(gx + 1, 23, gloveD);
    rect(ax, 10, 3, 7, x => x === ax + 2 ? jD : jersey); rect(ax, 7, 3, 3, skin);
    ell(ax + 1, 6, 2, 2, '#f7f5ef'); put(ax + 1, 6, '#c8312c');
  }
  // neck, head, cap or helmet
  rect(cx - 2, 12, 4, 3, skin);
  ell(cx, 8, 5, 5, (x, y) => x >= cx + 3 ? skinD : skin);
  if (bat) { ell(cx, 5, 6, 4.4, c1); rect(cx - 6, 5, 12, 2, c1); rect(front ? cx - 7 : cx + 3, 7, 4, 3, shade(c1, -.3)); }
  else { ell(cx, 4.5, 5.4, 3.6, c1); rect(cx - 5, 5, 10, 2, c1); if (front) rect(cx - 6, 7, 12, 2, shade(c1, -.3)); else rect(cx - 4, 4, 8, 1, c2); }
  if (front) { put(cx - 2, 9, ink); put(cx + 1, 9, ink); rect(cx - 1, 11, 2, 1, skinD); }
  else { rect(cx - 4, 9, 8, 3, '#2a1d14'); }
  // outline
  const out = buf.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (buf[i]) continue; if ((x > 0 && buf[i - 1]) || (x < W - 1 && buf[i + 1]) || (y > 0 && buf[i - W]) || (y < H - 1 && buf[i + W])) out[i] = ink; }
  let url = '';
  try {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'); const img = c.createImageData(W, H);
    for (let i = 0; i < W * H; i++) { const col = out[i]; if (!col) continue; const [r, g, b] = hexRGB(col); img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
    c.putImageData(img, 0, 0); url = cv.toDataURL('image/png');
  } catch (e) { url = ''; }
  SPR_CACHE[key] = url; return url;
}
const trimFor = c => lum(c) > .8 ? '#1b2131' : '#ffffff';
function sprImg(cls, ab, role, view, hand, name, home) {
  const T = TEAM(ab);
  const u = spriteURL({ c1: T.colors[0], c2: T.colors[1] || trimFor(T.colors[0]), role, view, hand, skin: skinFor(name), home });
  const m = name ? ` data-mon="${esc(name)}" data-view="${view}"` : '';
  return u ? `<img class="${cls}" src="${u}" alt=""${m}>` : `<span class="${cls}"></span>`;
}

/* ---------- Custom sprites: optional images from a sprites/ folder next to this file (Pick & Roll's loader) ----------
   sprites/<name>.png front view, sprites/back/<name>.png back view (else the front is mirrored).
   <name> is the player's name in lowercase with dashes: "Aaron Judge" -> aaron-judge. */
const CUSTOM = { on: true, hit: {}, pend: {}, tok: 0 };
const monSlug = n => String(n).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const customPath = (name, view) => (view === 'back' ? 'sprites/back/' : 'sprites/') + monSlug(name) + '.png';
function probe(url) {
  if (url in CUSTOM.hit) return Promise.resolve(CUSTOM.hit[url]);
  if (CUSTOM.pend[url]) return CUSTOM.pend[url];
  return CUSTOM.pend[url] = new Promise(res => { const im = new Image(); const done = ok => { CUSTOM.hit[url] = ok; delete CUSTOM.pend[url]; res(ok); }; im.onload = () => done(im.naturalWidth > 0); im.onerror = () => done(false); im.src = url; });
}
function customNow(name, view) {
  if (!CUSTOM.on || !name || (location.protocol !== 'file:' && !/^(localhost|127\.)/.test(location.hostname))) return null;
  const f = customPath(name, 'front');
  if (view === 'back') { const b = customPath(name, 'back'), hb = CUSTOM.hit[b]; if (hb === undefined) return undefined; if (hb) return { src: b, flip: false }; }
  const hf = CUSTOM.hit[f]; if (hf === undefined) return undefined;
  return hf ? { src: f, flip: view === 'back' } : null;
}
async function customCheck(name, view) { if (view === 'back' && await probe(customPath(name, 'back'))) return; await probe(customPath(name, 'front')); }
function setSpr(img, name, view, proc) {
  if (!img) return; img._proc = proc;
  const c = customNow(name, view), want = c ? c.src : proc;
  if (img.getAttribute('src') !== want) img.src = want;
  img.classList.toggle('custom', !!c); img.classList.toggle('flip', !!(c && c.flip));
  const t = img._sprTok = ++CUSTOM.tok;
  if (c === undefined) customCheck(name, view).then(() => { if (img._sprTok === t) setSpr(img, name, view, img._proc); });
}
function upgradeSprites(root) { if (!root || !root.querySelectorAll) return; root.querySelectorAll('img[data-mon]').forEach(img => { if (img._sprTok) return; setSpr(img, img.dataset.mon, img.dataset.view || 'front', img.getAttribute('src')); }); }
try { new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches && n.matches('img[data-mon]')) upgradeSprites(n.parentNode); else upgradeSprites(n); } }).observe(app, { childList: true, subtree: true }); } catch (e) { /* old browser */ }

/* ---------- Sound: short synthesized cues, started only after a tap ---------- */
const SND = { ctx: null };
function actx() { if (!PREFS.sound) return null; try { if (!SND.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; SND.ctx = new C(); } if (SND.ctx.state === 'suspended') SND.ctx.resume(); return SND.ctx; } catch (e) { return null; } }
function tone(f, d, type, vol, t0, slide) { const c = actx(); if (!c) return; const t = c.currentTime + (t0 || 0); const o = c.createOscillator(), gn = c.createGain(); o.type = type || 'square'; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d); gn.gain.setValueAtTime(vol || .05, t); gn.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(gn).connect(c.destination); o.start(t); o.stop(t + d + .03); }
let NOISE = null;
function noise(d, vol, lp, t0) { const c = actx(); if (!c) return; if (!NOISE) { const len = c.sampleRate; NOISE = c.createBuffer(1, len, c.sampleRate); const ch = NOISE.getChannelData(0); for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1; } const t = c.currentTime + (t0 || 0); const s = c.createBufferSource(); s.buffer = NOISE; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp || 1800; const gn = c.createGain(); gn.gain.setValueAtTime(vol || .08, t); gn.gain.exponentialRampToValueAtTime(.0001, t + d); s.connect(f).connect(gn).connect(c.destination); s.start(t); s.stop(t + d + .03); }
const SFX = {
  blip: () => tone(1320, .04, 'square', .025),
  select: () => { tone(880, .05, 'square', .035); tone(1320, .07, 'square', .035, .05); },
  back: () => tone(620, .06, 'square', .03),
  pitch: () => noise(.12, .05, 2600),
  pop: () => { noise(.05, .12, 900); tone(180, .06, 'square', .04); },
  ball: () => tone(300, .07, 'triangle', .04),
  whiff: () => noise(.18, .07, 5200),
  foul: () => { noise(.05, .1, 3000); tone(700, .05, 'square', .03); },
  crack: () => { noise(.09, .16, 4200); tone(980, .06, 'square', .035); },
  hr: () => { noise(.1, .16, 4200); [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, .09, 'square', .04, .1 + i * .07)); },
  k: () => { tone(1568, .08, 'square', .04); tone(1175, .1, 'square', .04, .08); tone(784, .2, 'square', .04, .17); },
  out: () => tone(260, .12, 'square', .04, 0, 180),
  super: () => { noise(.2, .1, 3400); tone(240, .18, 'square', .035, 0, 90); },
  faint: () => { [523, 440, 349, 262, 196].forEach((f, i) => tone(f, .12, 'square', .045, i * .09)); },
  call: () => { tone(520, .06, 'square', .03); tone(780, .08, 'square', .03, .06); },
  heal: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .06, 'triangle', .04, i * .05)),
  organ: () => { tone(392, .25, 'triangle', .035); tone(494, .25, 'triangle', .03, .02); tone(587, .25, 'triangle', .03, .04); },
  win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i === 5 ? .4 : .12, 'square', .045, i * .12)),
  lvl: () => [660, 880, 990, 1320].forEach((f, i) => tone(f, .08, 'square', .04, i * .07)),
};
function sfx(n) { if (!PREFS.sound) return; try { if (SFX[n]) SFX[n](); } catch (e) { /* audio blocked */ } }

/* ---------- Event bus: the engine tags each line, the presentation subscribes ---------- */
const Bus = { h: {}, on(evs, fn) { evs.split(' ').forEach(e => (this.h[e] || (this.h[e] = [])).push(fn)); }, emit(e, p) { const l = this.h[e]; if (l) for (const fn of l) fn(p); } };
const DOM = {};
function centerOf(el) { if (!DOM.scene || !el) return null; const a = DOM.scene.getBoundingClientRect(), b = el.getBoundingClientRect(); return { x: b.left - a.left + b.width / 2, y: b.top - a.top + b.height * .45 }; }
const FXPOOL = { free: [], take(cls, ms, setup) { if (!DOM.fx) return; let el = this.free.pop(); if (!el) el = document.createElement('i'); if (el.parentNode !== DOM.fx) DOM.fx.appendChild(el); el.className = cls; el.removeAttribute('style'); if (setup) setup(el); void el.offsetWidth; el.classList.add('on'); setTimeout(() => { el.className = ''; this.free.push(el); }, ms); } };
function burst(el, color) { const p = centerOf(el); if (!p) return; for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2, d = 26 + Math.random() * 18; FXPOOL.take('px', 600, s => { s.style.cssText = `left:${p.x}px;top:${p.y}px;--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d).toFixed(1)}px;--c:${color}`; }); } }
function ringFX(el, color) { const p = centerOf(el); if (!p) return; FXPOOL.take('ring', 650, s => { s.style.cssText = `left:${p.x}px;top:${p.y}px;--c:${color}`; }); }
// near/far: the near sprite (bottom-left, back view) is always the user's player
const nearIsPitcher = V => S && S.game && V && (V.half !== S.game.user);   // the user fields when the other team bats
function pitcherEl(V) { return nearIsPitcher(V) ? DOM.sprU : DOM.sprO; }
function batterEl(V) { return nearIsPitcher(V) ? DOM.sprO : DOM.sprU; }
function pitchFX(V) {
  const a = centerOf(pitcherEl(V)), b = centerOf(batterEl(V)); if (!a || !b) return;
  const fromNear = nearIsPitcher(V);
  FXPOOL.take('ball ' + (fromNear ? 'p0' : 'p1'), 460, s => { s.style.cssText = `left:${a.x}px;top:${a.y}px;--dx:${(b.x - a.x).toFixed(1)}px;--dy:${(b.y - a.y).toFixed(1)}px`; });
}
function hrFX(V) { const b = centerOf(batterEl(V)); if (!b) return; FXPOOL.take('ball hr', 1000, s => { s.style.cssText = `left:${b.x}px;top:${b.y}px`; }); }
const teamColorOfSide = side => S && S.game ? S.game.teams[side].c1 : '#ffd23f';
Bus.on('pitch', () => { sfx('pitch'); anim(pitcherEl(UI.V), nearIsPitcher(UI.V) ? 'lunge-me' : 'lunge-opp', 460); setTimeout(() => pitchFX(UI.V), 120); });
Bus.on('strike', () => sfx('pop'));
Bus.on('ball', () => sfx('ball'));
Bus.on('whiff', p => { sfx('whiff'); if (p && p.x && p.x.super) { anim(batterEl(UI.V), 'hit', 720); anim(DOM.scene, 'shake', 380); sfx('super'); } });
Bus.on('foul', () => sfx('foul'));
Bus.on('hit', p => { sfx('crack'); burst(pitcherEl(UI.V), teamColorOfSide(UI.V.half)); if (p && p.x && p.x.super) { anim(pitcherEl(UI.V), 'hit', 720); anim(DOM.scene, 'shake', 380); sfx('super'); } });
Bus.on('hr walkoff', () => { sfx('hr'); anim(DOM.scene, 'flash', 460); hrFX(UI.V); burst(pitcherEl(UI.V), teamColorOfSide(UI.V.half)); const b = DOM.bug && DOM.bug.firstElementChild; anim(b, 'flash', 1200); });
Bus.on('k', p => { sfx('k'); ringFX(batterEl(UI.V), '#ffd23f'); if (p && p.x && p.x.super) { anim(batterEl(UI.V), 'hit', 720); anim(DOM.scene, 'shake', 380); } });
Bus.on('out dp cs', () => sfx('out'));
Bus.on('bb hbp error wp steal', () => sfx('blip'));
Bus.on('faint', () => { sfx('faint'); const el = pitcherEl(UI.V); if (el) el.classList.add('faint'); anim(DOM.scene, 'dim', 900); });
Bus.on('change', () => { sfx('call'); });
Bus.on('heal visit', () => sfx('heal'));
Bus.on('inning intro', () => sfx('organ'));
Bus.on('final', () => sfx('organ'));

/* ---------- Pixel ballpark, drawn once per game ---------- */
function drawBg(g) {
  const cv = DOM.bg; if (!cv) return; const c = cv.getContext('2d'); if (!c) return;
  const W = 192, H = 128; let seed = 7; for (const ch of g.teams[1].abbr) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd2 = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  const ellipse = (cx, cy, rx, ry, col) => { c.fillStyle = col; for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) { const dy = (y + .5 - cy) / ry; if (dy < -1 || dy > 1) continue; const hw = rx * Math.sqrt(1 - dy * dy); const x0 = Math.round(cx - hw), x1 = Math.round(cx + hw); c.fillRect(x0, y, x1 - x0, 1); } };
  const home = g.teams[1], c1 = home.c1, c2 = home.c2;
  // night sky and light towers
  ['#07101f', '#0a1428', '#0e1a33', '#122241', '#16294d'].forEach((col, i) => px(0, i * 4, W, 4, col));
  for (const lx of [8, 166]) { px(lx + 8, 4, 2, 16, '#3a465f'); px(lx, 1, 18, 6, '#2b3a5c'); for (let i = 0; i < 4; i++) px(lx + 1 + i * 4, 2, 3, 4, '#fff2c8'); px(lx - 4, 0, 26, 9, 'rgba(255,240,200,0.07)'); }
  // stands and crowd in home colors
  px(0, 20, W, 16, '#1a2340');
  const crowd = [c1, c1, c2, shade(c1, -.25), '#cfd6e6', '#8d98b3', '#46557a', g.teams[0].c1];
  for (let y = 21; y < 35; y += 2) for (let x = (y % 4 === 3 ? 0 : 1); x < W; x += 2) if (rnd2() < .82) px(x, y, 1, 1, crowd[Math.floor(rnd2() * crowd.length)]);
  // outfield wall with a yellow line
  px(0, 35, W, 7, '#1f5a2c'); px(0, 35, W, 1, '#2f7d3f'); px(0, 41, W, 1, '#ffd23f');
  for (let x = 6; x < W; x += 24) px(x, 37, 10, 2, mix(c1, '#1f5a2c', .45));
  // grass with mow stripes
  px(0, 42, W, H - 42, '#3f8f3a');
  for (let i = 0; i < 12; i++) { const y0 = 42 + Math.round(Math.pow(i / 12, 1.3) * (H - 42)); const y1 = 42 + Math.round(Math.pow((i + 1) / 12, 1.3) * (H - 42)); if (i % 2) px(0, y0, W, y1 - y0, '#378232'); }
  // infield dirt and the far mound under the opponent sprite, the near dirt under yours
  ellipse(138, 70, 40, 12, '#b9824f'); ellipse(138, 70, 31, 9, '#3f8f3a'); ellipse(138, 70, 12, 4, '#c08a55'); px(133, 68, 10, 1, '#f4f2ea');
  ellipse(54, 121, 50, 11, '#b9824f'); ellipse(54, 121, 30, 6, '#c08a55');
  // foul lines and the plate
  c.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 70; i++) { c.fillRect(Math.round(96 - i * 1.37), 42 + Math.round(i * 1.2), 1, 1); c.fillRect(Math.round(96 + i * 1.37), 42 + Math.round(i * 1.2), 1, 1); }
  px(52, 119, 5, 2, '#f4f2ea');
  // spotlights under the players
  ellipse(138, 69, 24, 4, 'rgba(20,10,0,.22)'); ellipse(54, 122, 34, 6, 'rgba(20,10,0,.25)');
}

// @@UI2
