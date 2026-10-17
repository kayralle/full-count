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
  // from behind the head is hair with ears showing; from the front it's a face
  if (front) ell(cx, 8, 5, 5, (x, y) => x >= cx + 3 ? skinD : skin);
  else { ell(cx, 8, 5, 5, (x, y) => y >= 11 ? skin : '#2a1d14'); put(cx - 5, 8, skin); put(cx + 4, 8, skinD); }
  if (bat) { ell(cx, 5, 6, 4.4, c1); rect(cx - 6, 5, 12, 2, c1); rect(front ? cx - 7 : cx + 3, 7, 4, 3, shade(c1, -.3)); }
  else { ell(cx, 4.5, 5.4, 3.6, c1); rect(cx - 5, 5, 10, 2, c1); if (front) rect(cx - 6, 7, 12, 2, shade(c1, -.3)); else rect(cx - 4, 4, 8, 1, c2); }
  if (front) { put(cx - 2, 9, ink); put(cx + 1, 9, ink); rect(cx - 1, 11, 2, 1, skinD); }
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

/* ---------- Screens ---------- */
function currentScreen() {
  if (UI.screen === 'editor') return 'editor';
  if (UI.screen === 'setup') return 'setup';
  if (!S || UI.screen === 'title') return 'title';
  if (S.phase === 'game' && !S.game) S.phase = S.mode === 'exhibition' ? 'lineup' : 'hub';
  return S.phase || 'hub';
}
function render() {
  const scr = currentScreen();
  if (scr === 'title') app.innerHTML = vTitle();
  else if (scr === 'setup') app.innerHTML = vSetup();
  else if (scr === 'editor') app.innerHTML = vEditor();
  else if (scr === 'lineup') app.innerHTML = vLineup();
  else if (scr === 'hub') app.innerHTML = S.mode === 'pennant' ? vPennantHub() : vSeasonHub();
  else if (scr === 'game') { app.innerHTML = vGameShell(); mountGame(); }
  else if (scr === 'post') app.innerHTML = vPost();
  else app.innerHTML = vEnd();
}
const MODE_LABEL = { exhibition: 'Exhibition', season: 'Season', pennant: 'Pennant Run' };
const DIFF_LABEL = k => (FC.DIFF[k] || FC.DIFF.pro).label;
function teamOptions(sel, except) {
  return FC.TEAMS.slice().sort((a, b) => a.name.localeCompare(b.name)).filter(t => t.abbr !== except && FC.teamPlayers(t.abbr).length >= 22)
    .map(t => `<option value="${esc(t.abbr)}" ${sel === t.abbr ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
}
function ratingsBlock(abbr) {
  const s = FC.strengths()[abbr];
  if (!s) return '<p class="muted">Not enough players for a game.</p>';
  return `<div class="rat"><div><b>${s.lineup}</b><span>Lineup</span></div><div><b>${s.rotation}</b><span>Rotation</span></div><div><b>${s.bullpen}</b><span>Bullpen</span></div></div>`;
}

/* ---------- Title ---------- */
function vTitle() {
  const sv = loadSaved(), su = UI.setup, M = FC.DATA.meta;
  let resume = '';
  if (sv) {
    const W = sv.results.filter(r => r.win).length, L = sv.results.filter(r => r.win === false).length;
    const who = sv.mode === 'exhibition' ? `${sv.away} at ${sv.home}` : TEAM(sv.team).name;
    const extra = sv.mode === 'pennant' ? ` · ${sv.pr.badges.length} pennant${sv.pr.badges.length === 1 ? '' : 's'}` : sv.mode === 'season' ? ` · ${W}–${L}` : '';
    resume = `<div class="card resume"><div><p class="eyebrow">Saved ${MODE_LABEL[sv.mode]}</p><p><b>${esc(who)}</b>${extra}${sv.game ? ' · game in progress' : ''}${sv.done ? ' · finished' : ''}</p></div><button class="btn sm" data-a="continue">Continue</button></div>`;
  }
  const modes = [['exhibition', 'Exhibition', 'Any two teams, one game. Either one can be yours.'],
    ['season', 'Season', `${FC.SEASON_GAMES} games, then the playoffs: Wild Card, Division Series, LCS, World Series.`],
    ['pennant', 'Pennant Run', 'Start at level 5. Level up, beat 8 Division Leaders, the Elite Four and the Champion.']];
  return `
  <section class="hero">
    <span class="dia" aria-hidden="true"></span>
    <div class="hero-in">
      <div class="hero-copy"><p class="eyebrow on-turf">Stats through ${esc(M.through)} · 30 teams · ${FC.PLAYERS.length} players</p><h1 class="wordmark">Full<br>Count</h1></div>
      ${sprImg('hero-spr', su.team, 'bat', 'front', 'R', 'hero', true)}
      <p class="hero-tag">Real 2026 MLB players. Every plate appearance is a battle. You call every pitch and every swing.</p>
    </div>
  </section>
  ${resume}
  <form class="card setup" id="setupForm" autocomplete="off">
    <h3>New game</h3>
    <div class="mode-pick" role="radiogroup" aria-label="Mode">${modes.map(([k, l, d]) => `<input type="radio" name="tMode" id="m_${k}" value="${k}" ${su.mode === k ? 'checked' : ''}><label for="m_${k}"><b>${l}</b><span>${d}</span></label>`).join('')}</div>
    <div><span class="lbl">Difficulty</span><div class="seg">${Object.keys(FC.DIFF).map(k => `<input type="radio" name="tDiff" id="d_${k}" value="${k}" ${su.difficulty === k ? 'checked' : ''}><label for="d_${k}">${FC.DIFF[k].label}</label>`).join('')}</div></div>
    <button class="btn primary" type="submit">Pick teams</button>
  </form>
  <div class="row"><button class="btn ghost grow" data-a="editor">Player editor</button><button class="chip-btn" data-a="sound" id="sndBtn" aria-pressed="${PREFS.sound}">${PREFS.sound ? '♪ Sound on' : '♪ Sound off'}</button></div>
  <section class="how" aria-label="How it works">
    <div><b>Pitch</b><p>Pick one of his four real pitches, Pokémon-move style, then a location: attack the zone, paint the edge, elevate, bury it low, or chase. Each pitch has a type that's super effective against some hitters.</p></div>
    <div><b>Hit</b><p>Sit on a pitch family (fastball, breaking, offspeed) for a good read, protect with two strikes, swing big, or take. Steal, hit-and-run, bunt or squeeze.</p></div>
    <div><b>Wear them down</b><p>It's still baseball: a hit is a hit. Pitchers have Health and Fatigue bars, and they faint when either empties. Then MLB substitution rules take over.</p></div>
    <div><b>Level up</b><p>18 types from the real Pokémon chart with baseball names, levels, IVs and EVs. In Pennant Run your players grow as they face tougher teams.</p></div>
  </section>`;
}

/* ---------- Team pick ---------- */
function vSetup() {
  const su = UI.setup;
  const ex = su.mode === 'exhibition';
  if (su.opp === su.team) su.opp = FC.TEAMS.find(t => t.abbr !== su.team).abbr;
  const card = (label, id, ab, except) => `<div class="card"><label class="eyebrow" for="${id}">${label}</label><select class="sel-in" id="${id}">${teamOptions(ab, except)}</select>${ratingsBlock(ab)}</div>`;
  return `<header class="head"><div><p class="eyebrow">${MODE_LABEL[su.mode]} · ${DIFF_LABEL(su.difficulty)}</p><h2 class="h2">Pick ${ex ? 'teams' : 'your team'}</h2></div><button class="btn ghost sm" data-a="toTitle">Back</button></header>
  ${card('Your team', 'suTeam', su.team, null)}
  ${ex ? card('Opponent', 'suOpp', su.opp, su.team) + `<div class="card"><span class="eyebrow">You are</span><div class="seg"><input type="radio" name="suHome" id="h_home" value="1" ${su.home ? 'checked' : ''}><label for="h_home">Home</label><input type="radio" name="suHome" id="h_away" value="0" ${!su.home ? 'checked' : ''}><label for="h_away">Away</label></div><p class="muted">The home team bats in the bottom of each inning.</p></div>` : ''}
  ${su.mode === 'pennant' ? '<p class="hint">Your whole roster starts at level 5 with 0 EVs. Opponents get tougher as you go.</p>' : ''}
  <button class="btn primary" data-a="startMode">${ex ? 'Lineup card' : 'Start'}</button>`;
}

/* ---------- Lineup card ---------- */
function luDraftFor(plan) {
  if (UI.luDraft && UI.luDraft.abbr === plan.abbr && UI.luDraft.key === lineupKey()) return UI.luDraft;
  UI.luDraft = { abbr: plan.abbr, key: lineupKey(), lineup: plan.team.lineup.slice(), positions: Object.assign({}, plan.team.posOf), starter: plan.team.pitcher };
  return UI.luDraft;
}
const lineupKey = () => (S ? S.results.length + ':' + S.mode : '');
function restedStarter(id) {
  if (S.mode !== 'season') return true;
  const w = S.work[id]; if (!w || !w.games.length) return true;
  return S.results.length - w.games[w.games.length - 1].i >= 5;
}
function vLineup() {
  const plan = FC.planTeam(S);
  if (!plan) { S.phase = S.mode === 'exhibition' ? 'post' : 'end'; return S.phase === 'end' ? vEnd() : vPost(); }
  const d = luDraftFor(plan), P = plan.P, t = plan.team;
  const opp = FC.opponentTeam(S), ng = plan.ng;
  const bench = t.bench.filter(id => !d.lineup.includes(id));
  const row = (id, i, isBench) => {
    const g = P[id]; const v = FC.view(id);
    const sel = UI.lu && UI.lu.id === id;
    const pos = isBench ? (g.pos[0] || 'DH') : d.positions[id];
    const lvl = S.mode === 'pennant' ? `Lv ${g.lvl}` : '';
    return `<div class="lu-row ${isBench ? 'bench' : ''}" role="button" tabindex="0" data-a="luPick" data-id="${id}" aria-pressed="${sel}">
      <span class="no">${isBench ? '' : i + 1}</span>
      ${isBench ? `<span class="po" style="opacity:.6">${esc(pos)}</span>` : `<button class="po" data-a="luPos" data-id="${id}" aria-pressed="${UI.luPos === id}" title="Swap positions">${esc(pos)}</button>`}
      <span class="nm"><b>${esc(g.name)}</b><span class="pc-sub">${typeChips(g.types, true)}<span class="pc-stat">${esc(hitLine(v))}</span></span></span>
      <span class="val">${lvl}${lvl ? '<br>' : ''}${g.bats === 'S' ? 'S' : g.bats}</span></div>`;
  };
  const rot = t.rot.filter(id => P[id] || true);
  const sp = id => { const g = P[id] || FC.makeGP(id); const v = FC.view(id); const ok = restedStarter(id); return `<div class="lu-row ${d.starter === id ? '' : 'bench'}" role="button" tabindex="0" data-a="luStarter" data-id="${id}" aria-pressed="${d.starter === id}" ${ok ? '' : 'aria-disabled="true"'}><span class="no">SP</span><span class="po">${g.throws}HP</span><span class="nm"><b>${esc(g.name)}</b><span class="pc-sub">${typeChips(g.types, true)}<span class="pc-stat">${esc(pitLine(v))}${ok ? '' : ' · needs rest'}</span></span></span><span class="val">${S.mode === 'pennant' ? 'Lv ' + g.lvl : 'B ' + FC.budgetOf(g)}</span></div>`; };
  const pen = t.pen.concat(t.tiredPen).map(id => { const g = P[id]; return `<div class="pc"><span class="pc-pos" style="font-size:11px">${id === t.closer ? 'CL' : 'RP'}</span><div class="pc-main"><div class="pc-top"><span class="pc-name">${esc(g.name)}</span><span class="pc-lv">${S.mode === 'pennant' ? 'Lv ' + g.lvl : g.throws + 'HP'}</span></div><div class="pc-sub">${typeChips(g.types, true)}${t.tiredPen.includes(id) ? '<span class="pc-flag bad">Tired</span>' : ''}</div></div></div>`; }).join('');
  return `<header class="head"><div><p class="eyebrow">${esc(ng.label)} · ${ng.home || (S.mode === 'exhibition' && S.user === 1) ? 'Home' : 'Away'}</p><h2 class="h2">Lineup card</h2></div><button class="btn ghost sm" data-a="lineupBack">Back</button></header>
  <section class="card"><p class="eyebrow">Opponent</p><h2 class="opp-name" style="color:${esc(readable(tmColor(opp.abbr)))}">${esc(TEAM(opp.abbr).name)}${opp.level ? ` <span class="lv">Lv ${opp.level}</span>` : ''}</h2>${ratingsBlock(opp.abbr)}</section>
  <section class="card"><div class="row"><h3 class="grow">${esc(TEAM(plan.abbr).short)} batting order</h3><button class="btn ghost sm" data-a="luReset">Auto</button></div>
    <p class="hint">${UI.lu ? 'Now tap another player to swap batting spots, or a bench player to sub him in.' : UI.luPos ? 'Now tap another position to swap them.' : 'Tap two players to swap them in the order. Tap a position to swap positions.'}</p>
    <div class="lu">${d.lineup.map((id, i) => row(id, i, false)).join('')}<span class="lu-head">Bench</span>${bench.map(id => row(id, 0, true)).join('') || '<p class="muted">No bench players.</p>'}</div></section>
  <section class="card"><h3>Starting pitcher</h3><div class="lu">${rot.map(sp).join('')}</div></section>
  <section class="card"><h3>Bullpen</h3><div class="party">${pen}</div></section>
  <div class="dock"><button class="btn ghost" data-a="editor">Editor</button><button class="btn primary" data-a="playBall">Play ball</button></div>`;
}

/* ---------- Season hub ---------- */
function vSeasonHub() {
  const W = S.results.filter(r => r.win).length, L = S.results.filter(r => r.win === false).length;
  const ng = FC.nextGameOf(S);
  let next = '';
  if (ng) {
    next = `<section class="card"><p class="eyebrow">${esc(ng.label)} · ${ng.home ? 'Home' : 'Road'} game</p>
      <h2 class="opp-name" style="color:${esc(readable(tmColor(ng.opp)))}">${esc(TEAM(ng.opp).name)}</h2>${ratingsBlock(ng.opp)}
      <div class="row"><button class="btn primary grow" data-a="toLineup">${S.game ? 'Resume game' : 'Lineup card'}</button><button class="btn ghost" data-a="editor" ${S.game ? 'disabled' : ''}>Editor</button></div></section>`;
  }
  const regRows = S.sched.map((m, i) => {
    const r = S.results.filter(x => x.round === 'reg')[i]; const cur = S.week === i && !S.stage && !S.done;
    return `<li class="${cur ? 'next' : ''}"><span class="wk">G${i + 1} ${m.home ? 'vs' : '@'}</span><span class="row" style="gap:6px">${tmChip(m.opp)}<b>${esc(TEAM(m.opp).short)}</b></span>${r ? `<span class="res ${r.win ? 'w' : 'l'}">${r.win ? 'W' : 'L'} ${r.us}–${r.them}${r.innings > 6 ? ` (${r.innings})` : ''}</span>` : cur ? '<span class="res">Next</span>' : '<span class="muted">—</span>'}</li>`;
  }).join('');
  const po = ['wc', 'ds', 'cs', 'ws'].map(k => { const r = S.results.find(x => x.round === k); const cur = ng && ng.round === k; return `<li class="${cur ? 'next' : ''}"><span class="wk">${k.toUpperCase()}</span><span class="row" style="gap:6px">${r ? tmChip(r.opp) + `<b>${esc(TEAM(r.opp).short)}</b>` : cur ? tmChip(ng.opp) + `<b>${esc(TEAM(ng.opp).short)}</b>` : `<span class="muted">${FC.PO_LABEL[k]}</span>`}</span>${r ? `<span class="res ${r.win ? 'w' : 'l'}">${r.win ? 'W' : 'L'} ${r.us}–${r.them}</span>` : cur ? '<span class="res">Next</span>' : '<span class="muted">—</span>'}</li>`; }).join('');
  const plan = ng ? FC.planTeam(S) : null;
  let roster = '';
  if (plan) {
    const t = plan.team, P = plan.P;
    const rotRows = t.rot.map((id, i) => { const g = P[id] || FC.makeGP(id); const nextUp = id === t.pitcher; const rest = restedStarter(id); return `<div class="pc"><span class="pc-pos">${nextUp ? 'NEXT' : 'SP' + (i + 1)}</span><div class="pc-main"><div class="pc-top"><span class="pc-name">${esc(g.name)}</span><span class="pc-lv">${g.throws}HP</span></div><div class="pc-sub">${typeChips(g.types, true)}${rest ? '' : '<span class="pc-flag">Resting</span>'}</div></div></div>`; }).join('');
    const penRows = t.pen.concat(t.tiredPen).map(id => { const g = P[id]; return `<div class="pc"><span class="pc-pos">${id === t.closer ? 'CL' : 'RP'}</span><div class="pc-main"><div class="pc-top"><span class="pc-name">${esc(g.name)}</span><span class="pc-lv">${g.throws}HP</span></div><div class="pc-sub">${typeChips(g.types, true)}${t.tiredPen.includes(id) ? '<span class="pc-flag bad">Tired</span>' : ''}</div></div></div>`; }).join('');
    const inj = Object.keys(S.inj).filter(id => S.inj[id] > 0).map(id => { const v = FC.view(+id); return v ? `<span class="tag dn">${esc(v.name)} · ${S.inj[id]} game${S.inj[id] > 1 ? 's' : ''}</span>` : ''; }).join('');
    roster = `<section class="card"><h3>Rotation</h3><div class="party">${rotRows}</div><h3>Bullpen</h3><div class="party">${penRows}</div>${inj ? `<h3>Injured</h3><div class="row">${inj}</div>` : ''}</section>`;
  }
  return `<header class="team-head"><p class="eyebrow">Season · ${DIFF_LABEL(S.difficulty)}</p>
    <h1 class="team-name" style="color:${esc(readable(tmColor(S.team)))}">${esc(TEAM(S.team).name)}</h1>
    <div class="stats-line"><div class="stat"><b>${W}–${L}</b><span>Record</span></div><div class="stat"><b>${S.stage ? FC.PO_LABEL[S.stage].split(' ')[0] : `${Math.min(S.week + 1, FC.SEASON_GAMES)}/${FC.SEASON_GAMES}`}</b><span>${S.stage ? 'Playoffs' : 'Game'}</span></div></div></header>
  ${S.week === FC.SEASON_GAMES - 1 && !S.stage ? `<p class="hint">7 wins makes the Division Series, 6 the Wild Card game. You have ${W}.</p>` : ''}
  ${next}
  ${roster}
  <section class="card sched"><h3>Schedule</h3><ol>${regRows}</ol><h3 style="margin-top:6px">Playoffs</h3><ol>${po}</ol></section>
  <button class="btn danger sm" data-a="resetSave">${UI.confirmReset ? 'Tap again to erase this season' : 'Start over'}</button>`;
}

/* ---------- Pennant Run hub ---------- */
function vPennantHub() {
  const pr = S.pr, ng = FC.nextGameOf(S);
  const badge = (ab, i, kind) => {
    const got = kind === 'leader' ? pr.badges.includes(ab) : kind === 'e4' ? (pr.champ || (pr.e4 != null && i < pr.e4)) : S.done;
    const isNext = ng && ng.opp === ab && ng.round === kind;
    return `<li class="badge ${got ? 'got' : ''} ${isNext ? 'next' : ''}" style="--bc:${esc(tmColor(ab))}"><i></i>${esc(ab)}<span class="lv">${kind === 'leader' ? 'Lv ' + FC.LEVELS.LEADERS[i] : kind === 'e4' ? 'Lv ' + FC.LEVELS.ELITE[i] : 'Lv ' + FC.LEVELS.CHAMP}</span></li>`;
  };
  const plan = ng ? FC.planTeam(S) : null;
  let next = '';
  if (ng) {
    const kind = ng.round === 'leader' ? 'Division Leader' : ng.round === 'e4' ? 'Elite Four' : ng.round === 'champ' ? 'Champion' : 'Route game';
    next = `<section class="card"><p class="eyebrow">${esc(ng.label)} · ${ng.home ? 'Home' : 'Road'}</p>
      <h2 class="opp-name" style="color:${esc(readable(tmColor(ng.opp)))}">${esc(TEAM(ng.opp).name)} <span class="lv">Lv ${ng.level}</span></h2>
      <p class="muted">${kind}. Your lineup averages Lv ${FC.avgLevel(S).toFixed(1)}.${ng.round !== 'route' ? ' Lose and you can try again.' : ''}${ng.round === 'e4' ? ' A loss sends you back to the first match.' : ''}</p>
      <div class="row"><button class="btn primary grow" data-a="toLineup">${S.game ? 'Resume game' : 'Lineup card'}</button>${!S.game && ng.round !== 'route' ? '<button class="btn ghost" data-a="extraRoute">Route game</button>' : ''}</div></section>`;
  }
  let party = '';
  if (plan) {
    const t = plan.team, P = plan.P;
    const card = id => {
      const g = P[id] || FC.makeGP(id), p = S.prog[id] || { lvl: 5, xp: 125, ev: {} };
      const lo = FC.LEVELS.xpFor(p.lvl), hi = FC.LEVELS.xpFor(p.lvl + 1), f = p.lvl >= 100 ? 1 : (p.xp - lo) / Math.max(1, hi - lo);
      const evt = Object.values(p.ev).reduce((a, b) => a + b, 0);
      return `<div class="pc">${sprImg('pc-spr', S.team, g.kind === 'P' ? 'pitch' : 'bat', 'front', g.kind === 'P' ? g.throws : g.bats, g.name, true)}<div class="pc-main"><div class="pc-top"><span class="pc-pos">${esc(t.posOf[id] || (g.kind === 'P' ? 'P' : 'BN'))}</span><span class="pc-name">${esc(g.name)}</span><span class="pc-lv">Lv ${p.lvl}</span></div><div class="pc-sub">${typeChips(g.types, true)}<span class="pc-stat">${evt} EV</span></div><span class="expbar" role="meter" aria-label="Experience" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}"><i style="width:${(f * 100).toFixed(1)}%"></i></span></div></div>`;
    };
    party = `<section class="card"><h3>Your lineup</h3><div class="party">${t.lineup.map(card).join('')}</div><details><summary class="eyebrow" style="cursor:pointer">Pitchers and bench</summary><div class="party" style="margin-top:8px">${t.rot.concat(t.pen).concat(t.bench).map(card).join('')}</div></details></section>`;
  }
  return `<header class="team-head"><p class="eyebrow">Pennant Run · ${DIFF_LABEL(S.difficulty)}</p>
    <h1 class="team-name" style="color:${esc(readable(tmColor(S.team)))}">${esc(TEAM(S.team).name)}</h1>
    <div class="stats-line"><div class="stat"><b>${pr.badges.length}/8</b><span>Pennants</span></div><div class="stat"><b>${FC.avgLevel(S).toFixed(1)}</b><span>Avg level</span></div><div class="stat"><b>${pr.games}</b><span>Games</span></div></div></header>
  <section class="card"><h3>Division Leaders</h3><ul class="badges">${S.leaders.map((ab, i) => badge(ab, i, 'leader')).join('')}</ul><h3>Elite Four and Champion</h3><ul class="badges">${S.elite.map((ab, i) => badge(ab, i, 'e4')).join('')}</ul><ul class="badges">${badge(S.champ, 0, 'champ')}</ul></section>
  ${next}
  ${party}
  <button class="btn danger sm" data-a="resetSave">${UI.confirmReset ? 'Tap again to erase this run' : 'Start over'}</button>`;
}

/* ---------- Postgame and end ---------- */
function lineScoreTable(r) {
  const b = r.box, n = Math.max(r.innings || 6, b.teams[0].line.length, b.teams[1].line.length);
  const cells = (t, i) => Array.from({ length: n }, (_, k) => `<td>${t.line[k] != null ? t.line[k] : (k < n ? 'x' : '')}</td>`).join('');
  return `<div class="tbl-wrap"><table class="tbl" style="text-align:center"><thead><tr><th></th>${Array.from({ length: n }, (_, k) => `<th style="text-align:center">${k + 1}</th>`).join('')}<th>R</th><th>H</th><th>E</th></tr></thead><tbody>${b.teams.map((t, i) => `<tr><td>${tmChip(t.abbr)}</td>${cells(t, i)}<td><b>${t.runs}</b></td><td>${t.hits}</td><td>${t.errors}</td></tr>`).join('')}</tbody></table></div>`;
}
function battingTable(t) {
  return `<div class="tbl-wrap"><table class="tbl box-tbl"><thead><tr><th>${esc(t.short)}</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>BB</th><th>K</th><th>HR</th></tr></thead><tbody>${t.bat.map(b => `<tr class="${b.sub ? 'sub' : ''}"><td>${esc(lastName(b.name))} <span class="st">${esc(b.pos || '')}</span></td><td>${b.ab}</td><td>${b.r}</td><td>${b.h}</td><td>${b.rbi}</td><td>${b.bb}</td><td>${b.k}</td><td>${b.hr}</td></tr>`).join('')}<tr><td><b>Totals</b></td><td>${t.bat.reduce((a, b) => a + b.ab, 0)}</td><td>${t.bat.reduce((a, b) => a + b.r, 0)}</td><td>${t.bat.reduce((a, b) => a + b.h, 0)}</td><td>${t.bat.reduce((a, b) => a + b.rbi, 0)}</td><td>${t.bat.reduce((a, b) => a + b.bb, 0)}</td><td>${t.bat.reduce((a, b) => a + b.k, 0)}</td><td>${t.bat.reduce((a, b) => a + b.hr, 0)}</td></tr></tbody></table></div>`;
}
function pitchingTable(t) {
  return `<div class="tbl-wrap"><table class="tbl box-tbl"><thead><tr><th>${esc(t.short)} pitching</th><th>IP</th><th>H</th><th>R</th><th>ER</th><th>BB</th><th>K</th><th>P</th></tr></thead><tbody>${t.pit.map(p => `<tr><td>${esc(lastName(p.name))}${p.exit ? ` <span class="xt">(${p.exit})</span>` : ''}${p.dec ? ` <span class="st">${p.dec}</span>` : ''}</td><td>${p.ip}</td><td>${p.h}</td><td>${p.r}</td><td>${p.er}</td><td>${p.bb}</td><td>${p.k}</td><td>${p.np}</td></tr>`).join('')}</tbody></table></div>`;
}
function vPost() {
  const r = S.last;
  if (!r) { return `<p class="muted">No game yet.</p><button class="btn primary" data-a="postNext">Continue</button>`; }
  const userSide = S.mode === 'exhibition' ? S.user : (r.home ? 1 : 0);
  const mine = r.box.teams[userSide];
  const ups = (r.levelUps || []).map(u => `<div class="evo"><b>${esc(u.name)} grew to Lv. ${u.to}!</b><div class="stl">${Object.entries(u.stats).map(([k, [a, b]]) => `<span>${FC.STAT_LABEL[k]} ${a} <em>+${b - a}</em></span>`).join('')}</div></div>`).join('');
  const pog = r.pog;
  const pogGp = pog && FC.view(pog.id);
  const verdict = r.win == null ? 'Final' : r.win ? 'Victory' : 'Defeat';
  return `<section class="score-hero"><p class="eyebrow">${esc(r.label)} · ${esc(r.abbrs[0])} at ${esc(r.abbrs[1])}</p>
      <p class="verdict ${r.win ? 'w' : ''}">${verdict}</p>
      <div class="score-line"><div><small>${esc(r.abbrs[0])}</small>${r.score[0]}</div><span class="muted">–</span><div><small>${esc(r.abbrs[1])}</small>${r.score[1]}</div></div>
      ${r.innings > 6 ? `<p class="muted">${r.innings} innings</p>` : ''}</section>
    <section class="card">${lineScoreTable(r)}</section>
    ${pog ? `<section class="card"><h3>Player of the game</h3><div class="mvp">${sprImg('pc-spr', r.abbrs[userSide], pogGp && pogGp.kind === 'P' ? 'pitch' : 'bat', 'front', 'R', pog.name, true)}<p><b>${esc(pog.name)}</b><br><span class="muted">${esc(pog.line)}</span></p></div></section>` : ''}
    ${ups ? `<section class="card"><h3>Level up</h3>${ups}</section>` : ''}
    <section class="card"><h3>Your box score</h3>${battingTable(mine)}${pitchingTable(mine)}<div class="notes">${r.box.notes.map(n => `<p>${esc(n)}</p>`).join('')}</div></section>
    <div class="row">${S.mode === 'exhibition' ? '<button class="btn grow" data-a="rematch">Rematch</button><button class="btn primary grow" data-a="newFromEnd">New game</button>' : `<button class="btn primary grow" data-a="postNext">${S.done ? 'See how it ended' : 'Back to the hub'}</button>`}</div>`;
}
function vEnd() {
  const W = S.results.filter(r => r.win).length, L = S.results.filter(r => r.win === false).length;
  let head = 'Season over', sub = '';
  if (S.mode === 'season') {
    head = { champion: 'World Series Champions', ws: 'Lost the World Series', cs: 'Out in the LCS', ds: 'Out in the Division Series', wc: 'Lost the Wild Card game', missed: 'Missed the playoffs' }[S.outcome] || head;
    sub = S.outcome === 'missed' ? 'You needed 6 wins for the Wild Card game.' : S.outcome === 'champion' ? 'Pop the champagne.' : '';
  } else if (S.mode === 'pennant') {
    head = S.outcome === 'champion' ? 'You\'re the Champion!' : 'Run over';
    sub = S.outcome === 'champion' ? `${S.pr.games} games, ${S.pr.badges.length} pennants, the Elite Four and the Champion.` : '';
  }
  return `<section class="score-hero"><p class="eyebrow">${esc(TEAM(S.team).name)} · ${W}–${L}</p><h1 class="champ">${esc(head)}</h1><p class="muted">${esc(sub)}</p></section>
  <button class="btn primary" data-a="newFromEnd">New game</button>`;
}

/* ---------- Game screen ---------- */
function vGameShell() {
  const g = S.game, away = UI.intro ? ' away' : '';
  const ut = g.teams[g.user];
  return `<div class="g-wrap" style="--frame:${esc(lum(ut.c1) > .8 || lum(ut.c1) < .12 ? '#2357b5' : ut.c1)}">
  <div class="g-top"><button class="btn ghost sm" data-a="exitGame">Menu</button><span class="g-title">${esc(g.label)} · ${esc(g.teams[0].short)} at ${esc(g.teams[1].short)}</span><button class="chip-btn" data-a="stats">Stats</button><button class="chip-btn" data-a="sound" id="sndBtn" aria-pressed="${PREFS.sound}">${PREFS.sound ? '♪ On' : '♪ Off'}</button></div>
  <div id="bug"></div>
  <div class="scene" id="scene" data-a="tap">
    <canvas id="bg" width="192" height="128" aria-hidden="true"></canvas>
    <div class="spr opp${away}" id="sprO"><img id="imgO" alt=""></div>
    <div class="spr me${away}" id="sprU"><img id="imgU" alt=""></div>
    <div class="fx" id="fx" aria-hidden="true"></div>
    <div class="sbox opp" id="boxO"></div>
    <div class="sbox me" id="boxU"></div>
  </div>
  <div id="panel"></div>
  </div>
  <div id="sheetRoot"></div>`;
}
function mountGame() {
  ['bug', 'scene', 'bg', 'sprO', 'sprU', 'imgO', 'imgU', 'fx', 'boxO', 'boxU', 'panel', 'sheetRoot'].forEach(id => DOM[id] = document.getElementById(id));
  FXPOOL.free.length = 0;
  if (!UI.V) UI.V = FC.snap(S.game);
  drawBg(S.game);
  updateBug(UI.V); refreshSprites(); refreshBoxes(true);
  renderPanel(); renderSheet();
}
function bugHTML(V) {
  const g = S.game;
  const n = Math.max(g.innings, V.inn), from = Math.max(1, n - 5), cols = [];
  for (let i = from; i <= n; i++) cols.push(i);
  const team = i => {
    const T = g.teams[i];
    const cells = cols.map(k => { const v = V.line[i][k - 1]; const cur = k === V.inn && V.half === i && !V.over; return `<td class="${cur ? 'cur' : ''}">${v != null ? v : ''}</td>`; }).join('');
    return `<tr><td class="tn"><span style="--tc:${esc(T.c1)}"><i style="--tc:${esc(T.c1)}"></i>${esc(T.abbr)}</span></td>${cells}<td class="r">${V.score[i]}</td><td class="h">${V.h[i]}</td><td class="e">${V.e[i]}</td></tr>`;
  };
  const b = V.bases;
  const inn = V.over ? 'Final' : `${V.half ? '▼' : '▲'} ${V.inn}`;
  const np = V.pit ? `P ${V.pit.np}` : '';
  return `<div class="bug"><table class="ls" aria-label="Line score"><thead><tr><th></th>${cols.map(k => `<th>${k}</th>`).join('')}<th>R</th><th>H</th><th>E</th></tr></thead><tbody>${team(0)}${team(1)}</tbody></table>
    <div class="sit"><span class="inn">${inn}</span><span class="diamond" aria-label="Runners: ${['first', 'second', 'third'].filter((_, i) => b[i]).join(', ') || 'none'}"><i class="b2 ${b[1] ? 'on' : ''}"></i><i class="b3 ${b[2] ? 'on' : ''}"></i><i class="b1 ${b[0] ? 'on' : ''}"></i></span><span class="cnt" aria-label="Count">${V.over ? '' : `${V.b}-${V.s}`}</span><span class="outs" aria-label="${V.outs} out">${[0, 1, 2].map(k => `<i class="${k < V.outs ? 'on' : ''}"></i>`).join('')}</span><span class="np" style="grid-column:1/-1">${np}</span></div></div>`;
}
function updateBug(V) { if (DOM.bug) DOM.bug.innerHTML = bugHTML(V); }
function boxFor(V, near) {
  const nearPit = nearIsPitcher(V);
  const isP = near ? nearPit : !nearPit;
  return isP ? Object.assign({ kind: 'P' }, V.pit) : Object.assign({ kind: 'B' }, V.bat, { b: V.b, s: V.s });
}
function setBar(f, v, instant) { if (!f) return; const w = (clamp(v, 0, 1) * 100).toFixed(1) + '%'; if (instant || PB.skip) { f.style.transition = 'none'; f.style.width = w; void f.offsetWidth; f.style.transition = ''; } else f.style.width = w; }
function renderBox(el, d, instant) {
  if (!el || !d || d.id == null) return;
  const sig = [d.kind, d.id, d.name].join('|');
  const lvl = `Lv${d.lvl}`;
  if (el.dataset.sig !== sig) {
    el.dataset.sig = sig; instant = true;
    if (d.kind === 'P') el.innerHTML = `<div class="sb-top"><span class="sb-name">${esc(lastName(d.name))}</span>${typeDots(d.types)}<span class="sb-lv">${lvl}</span></div>
      <div class="sb-hp"><span class="hp-lab">HP</span><span class="hp-bar" role="meter" aria-label="Health" aria-valuemin="0" aria-valuemax="100"><i class="hp-fill hpf"></i></span></div>
      <div class="sb-hp"><span class="hp-lab">FTG</span><span class="hp-bar" role="meter" aria-label="Fatigue" aria-valuemin="0"><i class="hp-fill ftf"></i><i class="tick"></i></span></div>
      <div class="sb-meta"><span class="role hpt"></span><span class="val npt"></span></div>`;
    else el.innerHTML = `<div class="sb-top"><span class="sb-name">${esc(lastName(d.name))}</span>${typeDots(d.types)}<span class="sb-lv">${lvl}</span></div>
      <div class="sb-hp"><span class="hp-lab">CNT</span><span class="hp-bar" role="meter" aria-label="Strikes left" aria-valuemin="0" aria-valuemax="3"><i class="hp-fill cnf"></i></span></div>
      <div class="sb-meta"><span class="role tdy"></span><span class="cnt-dots"></span></div>`;
  }
  if (d.kind === 'P') {
    const hpEl = el.querySelector('.hpf'), ftEl = el.querySelector('.ftf'), tick = el.querySelector('.tick');
    const hp = Math.max(0, d.hp), T = d.T || 1, used = d.used || 0, B = d.B || 1;
    const hc = FC.hpColor(hp);
    setBar(hpEl, hp / 100, instant); hpEl.classList.toggle('y', hc === 'y'); hpEl.classList.toggle('r', hc === 'r');
    hpEl.parentNode.setAttribute('aria-valuenow', String(Math.round(hp)));
    const left = Math.max(0, T - used) / T;
    const fc = used <= B ? 'g' : ((used - B) / Math.max(1, T - B) <= 0.5 ? 'y' : 'r');
    setBar(ftEl, left, instant); ftEl.classList.toggle('y', fc === 'y'); ftEl.classList.toggle('r', fc === 'r');
    ftEl.parentNode.setAttribute('aria-valuemax', String(T)); ftEl.parentNode.setAttribute('aria-valuenow', String(Math.max(0, T - used)));
    tick.style.left = `${((T - B) / T * 100).toFixed(1)}%`;
    el.querySelector('.hpt').innerHTML = d.st === 'fnt' ? '<span class="fnt">FNT</span>' : `HP ${Math.round(hp)}/100${d.defer ? ' · !' : ''}`;
    el.querySelector('.npt').textContent = `P ${d.np}`;
    el.setAttribute('aria-label', `${d.name}, pitching: Health ${Math.round(hp)} of 100, ${d.np} pitches, budget ${B}`);
  } else {
    const cn = el.querySelector('.cnf'); const left = (3 - d.s) / 3;
    setBar(cn, left, instant); cn.classList.toggle('y', d.s === 1); cn.classList.toggle('r', d.s === 2);
    cn.parentNode.setAttribute('aria-valuenow', String(3 - d.s));
    el.querySelector('.tdy').textContent = `${d.pos || ''} · ${d.today || ''}`;
    el.querySelector('.cnt-dots').innerHTML = [0, 1, 2, 3].map(k => `<i class="${k < d.b ? 'b' : ''}"></i>`).join('') + '<span class="sep"></span>' + [0, 1, 2].map(k => `<i class="${k < d.s ? 's' : ''}"></i>`).join('');
    el.setAttribute('aria-label', `${d.name}, batting: count ${d.b}-${d.s}, ${d.today}`);
  }
}
function refreshBoxes(instant) { const V = UI.V; renderBox(DOM.boxU, boxFor(V, true), instant); renderBox(DOM.boxO, boxFor(V, false), instant); }
function refreshSprites() {
  if (!DOM.imgU) return; const g = S.game, V = UI.V;
  const u = g.user, ut = g.teams[u], ot = g.teams[1 - u];
  const near = boxFor(V, true), far = boxFor(V, false);
  const spr = (img, wrap, d, t, view, home) => {
    if (!d || d.id == null) return;
    const role = d.kind === 'P' ? 'pitch' : 'bat';
    const gp = g.P[d.id] || {};
    const hand = role === 'pitch' ? gp.throws : (gp.bats === 'S' ? (g.P[V.pit && V.pit.id] && g.P[V.pit.id].throws === 'R' ? 'L' : 'R') : gp.bats);
    const url = spriteURL({ c1: t.c1, c2: t.c2 || trimFor(t.c1), role, view, hand, skin: skinFor(d.name), home });
    if (wrap.dataset.who !== String(d.id)) { wrap.classList.remove('faint'); wrap.dataset.who = String(d.id); }
    setSpr(img, d.name, view, url); img.alt = `${t.short} ${d.name}`;
  };
  spr(DOM.imgU, DOM.sprU, near, ut, 'back', u === 1);
  spr(DOM.imgO, DOM.sprO, far, ot, 'front', u !== 1);
}

/* ---------- Playback queue: replays engine lines with their snapshots ---------- */
const PB = { active: false, skip: false, token: 0, typing: false, finish: false, res: null };
const SPEED = { slow: { c: 30, p: 1000 }, mid: { c: 16, p: 620 }, fast: { c: 6, p: 300 } };
function pbTap() { if (!PB.active) return; if (PB.typing) { PB.finish = true; return; } if (PB.res) { const r = PB.res; PB.res = null; r(); } }
function waitTap(ms) { return new Promise(res => { let done = false; const fin = () => { if (done) return; done = true; PB.res = null; if (DOM.adv) DOM.adv.classList.remove('on'); res(); }; PB.res = fin; if (DOM.adv) DOM.adv.classList.add('on'); if (ms != null) setTimeout(fin, ms); }); }
function typeLine(L, tok) {
  const el = DOM.dlgText; if (!el) return Promise.resolve();
  el.className = 'dlg-text ' + (L.c || ''); if (DOM.dlgSR) DOM.dlgSR.textContent = L.t;
  if (PB.skip) { el.textContent = L.t; return Promise.resolve(); }
  const sp = SPEED[PREFS.speed] || SPEED.mid, txt = L.t, t0 = performance.now();
  PB.typing = true; PB.finish = false;
  return new Promise(res => { const step = () => { if (tok !== PB.token) { PB.typing = false; res(); return; } const n = PB.finish || PB.skip ? txt.length : Math.min(txt.length, Math.floor((performance.now() - t0) / sp.c) + 1); el.textContent = txt.slice(0, n); if (n >= txt.length) { PB.typing = false; res(); return; } requestAnimationFrame(step); }; step(); });
}
async function applyState(s, tok) {
  const prev = UI.V; UI.V = s;
  const ch = (a, b) => (a && a.id) !== (b && b.id);
  const sideChanged = prev && prev.half !== s.half;
  const pc = prev && (ch(prev.pit, s.pit) || sideChanged), bc = prev && (ch(prev.bat, s.bat) || sideChanged);
  if ((pc || bc) && !PB.skip && !REDUCED && DOM.sprU) {
    const nearChanged = sideChanged || (nearIsPitcher(s) ? pc : bc), farChanged = sideChanged || (nearIsPitcher(s) ? bc : pc);
    if (nearChanged) DOM.sprU.classList.add('away'); if (farChanged) DOM.sprO.classList.add('away');
    await sleep(190); if (tok !== PB.token) return;
    refreshSprites(); refreshBoxes(true);
    void DOM.sprU.offsetWidth; DOM.sprU.classList.remove('away'); DOM.sprO.classList.remove('away');
    await sleep(200);
  } else { refreshSprites(); refreshBoxes(); }
  updateBug(s);
}
async function playLines(lines) {
  const tok = ++PB.token; PB.active = true; PB.skip = false; PB.finish = false;
  renderPanel();
  for (let i = 0; i < lines.length; i++) {
    if (tok !== PB.token) return; if (PB.skip) break;
    const L = lines[i];
    if (L.s) { await applyState(L.s, tok); if (tok !== PB.token) return; }
    if (L.ev && !PB.skip) Bus.emit(L.ev, L);
    await typeLine(L, tok);
    if (tok !== PB.token) return; if (PB.skip) break;
    const sp = SPEED[PREFS.speed] || SPEED.mid;
    const quick = L.ev === 'pitch' || L.ev === 'batter';
    await waitTap(PREFS.mode === 'auto' ? (quick ? sp.p * 0.6 : sp.p + Math.min(700, L.t.length * 9)) : (quick ? sp.p * 0.6 : null));
  }
  if (tok !== PB.token) return;
  if (PB.skip && lines.length && DOM.dlgText) { const L = lines[lines.length - 1]; DOM.dlgText.className = 'dlg-text ' + (L.c || ''); DOM.dlgText.textContent = L.t; }
  await applyState(FC.snap(S.game), tok);
  if (tok !== PB.token) return;
  PB.active = false; PB.skip = false;
  afterPlayback();
}
function cancelPlayback() { PB.token++; PB.active = false; PB.skip = false; PB.typing = false; if (PB.res) { const r = PB.res; PB.res = null; r(); } }
function doUserAction(fn) {
  const g = S.game; if (!g || PB.active) return;
  UI.confirmSim = false;
  const ok = fn();
  if (ok === false) { renderPanel(); return; }
  save();
  UI.menu = 'cmd'; UI.bpSel = null; UI.phSel = null;
  playLines(g.lines || []);
}
function afterPlayback() { renderPanel(); }

/* ---------- Game menus ---------- */
function panelState(g) {
  if (PB.active) return 'playing';
  if (g.over) return 'over';
  if (g.need === 'forced') return 'forced';
  if (g.need === 'pitch') return 'def';
  if (g.need === 'swing') return 'off';
  return 'wait';
}
function renderPanel() {
  if (!DOM.panel || !S || !S.game) return;
  DOM.panel.innerHTML = panelHTML(S.game);
  DOM.dlgText = document.getElementById('dlgText'); DOM.dlgSR = document.getElementById('dlgSR'); DOM.adv = document.getElementById('adv');
}
function sitStr(g) {
  const u = g.user, d = g.score[u] - g.score[1 - u];
  const tag = d > 0 ? `Up ${d}` : d < 0 ? `Down ${-d}` : 'Tied';
  const on = ['1st', '2nd', '3rd'].filter((_, i) => g.bases[i]);
  return `${g.half ? 'Bottom' : 'Top'} ${g.inning} · ${g.outs} out · ${on.length ? 'On ' + on.join(', ') : 'Bases empty'} · ${tag} · ${g.balls}-${g.strikes}`;
}
const backBtn = () => `<button class="mini-b bbtn" data-a="menu" data-v="cmd"><span class="key">B</span>Back</button>`;
const useBtn = (label, a, dis) => `<button class="abtn" data-a="${a}" ${dis ? 'disabled' : ''}><span class="key">A</span>${esc(label)}</button>`;
function panelHTML(g) {
  const st = panelState(g);
  if (st === 'playing') return `<div class="frame dlg-frame" data-a="tap"><p class="dlg-text" id="dlgText"></p><p class="sr" id="dlgSR" aria-live="polite"></p><div class="dlg-foot"><button class="mini-b" data-a="skip">Skip ›</button><span class="adv" id="adv" aria-hidden="true">▼</span></div></div>`;
  if (st === 'over') {
    const u = g.user, w = g.winner === u;
    return `<div class="frame"><div class="prompt"><p class="pr-big">${g.winner == null ? 'It ends in a tie.' : w ? `${esc(g.teams[u].short)} win!` : `${esc(g.teams[1 - u].short)} win.`}</p><p class="pr-sub">Final: ${esc(g.teams[0].short)} ${g.score[0]}, ${esc(g.teams[1].short)} ${g.score[1]}${g.inning > g.innings ? ` in ${g.inning}` : ''}.</p></div>${useBtn('Continue', 'toPost')}</div>`;
  }
  if (st === 'forced') return forcedHTML(g);
  if (st === 'wait') return `<div class="frame"><p class="pr-sub">…</p></div>`;
  if (st === 'def') { if (UI.menu === 'pitch') return pitchHTML(g); if (UI.menu === 'pen') return penHTML(g, false); return defCmdHTML(g); }
  if (UI.menu === 'swing') return swingHTML(g);
  if (UI.menu === 'run') return runHTML(g);
  if (UI.menu === 'bench') return benchHTML(g);
  return offCmdHTML(g);
}
function defCmdHTML(g) {
  const P = g.P[FC.curPitcherId(g)], B = g.P[g.pa.bid];
  const vs = FC.visitState(g), bp = FC.bullpenState(g, g.user);
  return `<div class="frame"><div class="prompt"><p class="pr-big">${esc(P.last)} vs ${esc(B.last)}. What's the call?</p><p class="pr-sub">${esc(sitStr(g))}</p></div>
    <div class="cmds">
      <button class="cmd cur" data-a="menu" data-v="pitch">Pitch</button>
      <button class="cmd" data-a="menu" data-v="pen">Bullpen</button>
      <button class="cmd" data-a="visit" ${vs.ok ? '' : 'aria-disabled="true"'} title="${esc(vs.ok ? `${vs.left} left` : vs.why)}">Visit${vs.ok ? ` <small>×${vs.left}</small>` : ''}</button>
      <button class="cmd" data-a="auto">Auto</button>
    </div>${bp.reason ? `<p class="pr-sub">${esc(bp.reason)}</p>` : ''}${UI.msg ? `<p class="reason">${esc(UI.msg)}</p>` : ''}</div>`;
}
function offCmdHTML(g) {
  const P = g.P[FC.curPitcherId(g)], B = g.P[g.pa.bid];
  return `<div class="frame"><div class="prompt"><p class="pr-big">${esc(B.last)} vs ${esc(P.last)}. Your swing?</p><p class="pr-sub">${esc(sitStr(g))}</p></div>
    <div class="cmds">
      <button class="cmd cur" data-a="menu" data-v="swing">Swing</button>
      <button class="cmd" data-a="menu" data-v="run">Run</button>
      <button class="cmd" data-a="menu" data-v="bench">Bench</button>
      <button class="cmd" data-a="auto">Auto</button>
    </div>${UI.msg ? `<p class="reason">${esc(UI.msg)}</p>` : ''}</div>`;
}
const LOC_DESC = { attack: 'Likely a strike. More contact.', edge: 'Fewer good swings, more balls.', up: 'Fastballs gain whiffs. Mistakes go deep.', low: 'Breaking balls gain chases and grounders.', chase: 'Out of the zone on purpose. Best when you\'re ahead.' };
const LOC_SHORT = { attack: 'Attack', edge: 'Edge', up: 'Elevate', low: 'Bury', chase: 'Chase' };
function typeTint(t) { const c = FC.TYPES.colors[FC.TYPES.idx(t)] || '#999'; return `--mtbg:${mix(c, '#f7f7f1', .64)};--mtsh:${shade(c, -.1)}`; }
function pitchHTML(g) {
  const P = g.P[FC.curPitcherId(g)], B = g.P[g.pa.bid];
  const coach = UI.coach || {};
  const n = P.p.pitches.length;
  if (UI.sel >= n) UI.sel = 0;
  const cards = P.p.pitches.map((x, i) => {
    const inf = FC.pitchInfo(g, i);
    return `<button class="mv" style="${typeTint(x.type)}" data-a="psel" data-i="${i}" aria-pressed="${UI.sel === i}">${coach.pi === i ? '<span class="coach">COACH</span>' : ''}<span class="mvn">${esc(x.name)}</span><span class="mvr"><span>${inf.velo} mph · ${Math.round(x.usage * 100)}%</span>${effTag(inf.mult)}</span></button>`;
  });
  while (cards.length < 4) cards.push('<div class="mv empty">—</div>');
  const inf = FC.pitchInfo(g, UI.sel);
  const vs = inf.mult === 0 ? `It doesn't affect ${B.last} (${B.types.join('/')}).` : inf.mult >= 2 ? `Super effective against ${B.last} (${B.types.join('/')}).` : inf.mult <= 0.5 ? `Not very effective against ${B.last} (${B.types.join('/')}).` : `Neutral against ${B.last} (${B.types.join('/')}).`;
  const fam = FC.FAM_LABEL[inf.fam];
  return `<div class="frame moves">
    <div class="mgrid">${cards.join('')}</div>
    <div class="minfo">
      <div class="mi-row">${typeChip(inf.type)}${inf.stab ? '<span class="stab">STAB ×1.5</span>' : ''}<span>${esc(fam)}</span><span>Whiff ${Math.round(inf.whiff * 100)}%</span><span>Stuff ${Math.round(inf.stuff)}</span></div>
      <p class="mi-desc"><b>${esc(vs)}</b> ${esc(LOC_DESC[UI.loc])}</p>
      <div class="pills" role="group" aria-label="Location">${FC.LOCS.map(l => `<button class="pill" data-a="loc" data-v="${l}" aria-pressed="${UI.loc === l}">${LOC_SHORT[l]}${coach.loc === l && coach.pi === UI.sel ? ' ★' : ''}</button>`).join('')}</div>
    </div>
    <div class="actrow">${backBtn()}${useBtn(`Throw: ${P.p.pitches[UI.sel].name}, ${LOC_SHORT[UI.loc]}`, 'throw')}</div>
  </div>`;
}
const APP_DESC = { normal: 'Look for something to hit.', sitFB: 'Guess fastball. A right read means harder contact; a wrong one, more whiffs.', sitBR: 'Guess breaking ball. Right read: better contact. Wrong: more whiffs.', sitOS: 'Guess offspeed. Right read: better contact. Wrong: more whiffs.', protect: 'Two-strike approach: fewer strikeouts, weaker contact.', big: 'Swing for the fences: more power, more whiffs.', take: 'Don\'t swing. Good when the pitcher is wild.' };
function famShare(g) {
  const P = g.P[FC.curPitcherId(g)], b = g.balls, s = g.strikes;
  const cat = s > b ? 'ahead' : b > s ? 'behind' : 'even';
  const f = { FB: 0, BR: 0, OS: 0 };
  P.p.pitches.forEach(x => { let w = x.usage; if (cat === 'behind') w *= x.fam === 'FB' ? 1.35 : 0.8; else if (cat === 'ahead') w *= x.fam === 'FB' ? 0.8 : 1.3; if (b === 3 && s === 0) w *= x.fam === 'FB' ? 1.5 : 1; f[x.fam] += w; });
  const t = f.FB + f.BR + f.OS || 1; for (const k in f) f[k] /= t; return f;
}
function swingHTML(g) {
  const coach = UI.coach || {};
  const fs = famShare(g);
  if (!FC.APPROACHES.includes(UI.app)) UI.app = 'normal';
  const card = k => {
    const fam = k.startsWith('sit') ? k.slice(3) : null;
    const sub = fam ? `${Math.round(fs[fam] * 100)}% here` : { normal: 'Balanced', protect: 'Fewer K', big: 'Power', take: 'No swing' }[k];
    return `<button class="mv" data-a="asel" data-v="${k}" aria-pressed="${UI.app === k}">${coach.app === k ? '<span class="coach">COACH</span>' : ''}<span class="mvn">${esc(FC.APP_LABEL[k])}</span><span class="mvr"><span>${esc(sub)}</span></span></button>`;
  };
  return `<div class="frame moves"><div class="mgrid">${FC.APPROACHES.map(card).join('')}<div class="mv empty">${g.balls}-${g.strikes}</div></div>
    <div class="minfo"><p class="mi-desc"><b>${esc(FC.APP_LABEL[UI.app])}.</b> ${esc(APP_DESC[UI.app])}</p></div>
    <div class="actrow">${backBtn()}${useBtn(UI.app === 'take' ? 'Take the pitch' : `Swing: ${FC.APP_LABEL[UI.app]}`, 'swing')}</div></div>`;
}
const RUN_INFO = { steal2: ['Steal second', 'The runner on first goes. The batter takes.'], steal3: ['Steal third', 'The runner on second goes. Harder than second.'], hitrun: ['Hit-and-run', 'The runner goes and the batter swings to protect him. Fewer double plays, more extra bases.'], bunt: ['Bunt', 'Square around. Usually a sacrifice; a fast runner can beat it out.'], squeeze: ['Squeeze', 'The runner on third breaks for home and the batter bunts. A miss hangs him out.'] };
function runHTML(g) {
  const opts = FC.runOptions(g);
  return `<div class="frame"><div class="mtabs"><span class="mt-title">Run</span>${backBtn()}</div><ul class="bag-list">${Object.keys(RUN_INFO).map(k => `<li><button class="bag-item" data-a="run" data-v="${k}" ${opts.includes(k) ? '' : 'disabled'}><span>${RUN_INFO[k][0]}</span><span>▶</span></button><p>${RUN_INFO[k][1]}</p></li>`).join('')}</ul></div>`;
}
function benchHTML(g) {
  const bs = FC.benchState(g);
  const cur = g.pa ? g.pa.bid : null, slot = bs.lineup.findIndex(x => x.id === cur);
  const canPH = g.pa && g.pa.n === 0;
  const pills = (k, opts) => `<div class="pills">${opts.map(([v, l]) => `<button class="pill" data-a="pref" data-k="${k}" data-v="${v}" aria-pressed="${PREFS[k] === v}">${l}</button>`).join('')}</div>`;
  const list = (act, extra) => bs.bench.length ? bs.bench.map(p => `<li><button class="bag-item" data-a="${act}" data-id="${p.id}" ${extra}><span>${esc(p.name)} <span class="sm">${esc(p.pos.join('/'))} · ${p.bats}</span></span><span>${typeChips(p.types, true)}</span></button></li>`).join('') : '<li><p>No one left on the bench.</p></li>';
  const runners = g.bases.map((r, i) => r ? { i, name: g.P[r.id].name } : null).filter(Boolean);
  return `<div class="frame"><div class="mtabs"><span class="mt-title">Bench</span>${backBtn()}</div>
    <ul class="bag-list">
      <li><div class="bag-item static"><span>Pinch hit for ${esc(g.P[cur].last)}</span></div>${canPH ? '' : '<p>Only between plate appearances.</p>'}</li>
      ${canPH ? list('ph', `data-slot="${slot}"`) : ''}
      ${runners.map(r => `<li><div class="bag-item static"><span>Pinch run for ${esc(lastName(r.name))} (${['1st', '2nd', '3rd'][r.i]})</span></div></li>${list('pr', `data-base="${r.i}"`)}`).join('')}
      <li><button class="bag-item" data-a="simRest"><span>${UI.confirmSim ? 'Tap again to sim' : 'Sim to final'}</span><span>▶</span></button><p>Your coaches play out the game.</p></li>
      <li><div class="bag-item static"><span>Text speed</span></div>${pills('speed', [['slow', 'Slow'], ['mid', 'Mid'], ['fast', 'Fast']])}</li>
      <li><div class="bag-item static"><span>Advance text</span></div>${pills('mode', [['auto', 'Auto'], ['tap', 'Tap']])}<p>Tap the text box to move on faster either way.</p></li>
    </ul></div>`;
}
function penRow(e, coachId, forced) {
  const dis = e.status !== 'avail';
  const tag = e.status === 'fnt' ? '<span class="tagc fnt">FNT</span>' : e.status === 'used' ? '<span class="tagc">USED</span>' : e.status === 'in' ? '<span class="tagc">IN</span>' : e.tired ? '<span class="tagc">TIRED</span>' : '';
  return `<li><button class="bag-item" data-a="pen" data-id="${e.id}" ${dis ? 'disabled' : ''} aria-pressed="${UI.bpSel === e.id}"><span class="pick-row" style="width:100%"><span class="who"><b>${esc(e.name)}</b><span>${e.throws}HP · ${esc(e.role || 'RP')} · budget ${e.B}${S.mode === 'pennant' ? ` · Lv ${e.lvl}` : ''}</span></span><span>${e.id === coachId && !dis ? '<span class="tagc coach">COACH</span> ' : ''}${tag} ${typeChips(e.types, true)}</span></span></button></li>`;
}
function penHTML(g, forced) {
  const st = FC.bullpenState(g, g.user);
  const rows = st.list.filter(e => e.status !== 'in').sort((a, b) => (a.status !== 'avail') - (b.status !== 'avail'));
  return `<div class="frame"><div class="mtabs"><span class="mt-title">Bullpen</span>${forced ? '' : backBtn()}</div>
    ${st.reason ? `<p class="reason">${esc(st.reason)}</p>` : ''}
    <ul class="bag-list">${rows.map(e => penRow(e, st.coach, forced)).join('') || '<li><p>Nobody left in the bullpen.</p></li>'}</ul></div>`;
}
function forcedHTML(g) {
  const t = g.teams[g.user], lp = t.lastPitcher != null ? g.P[t.lastPitcher] : null;
  const st = FC.bullpenState(g, g.user);
  const rows = st.list.filter(e => e.status !== 'in').sort((a, b) => (a.status !== 'avail') - (b.status !== 'avail'));
  return `<div class="frame"><div class="prompt"><p class="pr-big">${lp ? `${esc(lp.last)} fainted!` : 'Pick a pitcher.'} Choose your next pitcher.</p><p class="pr-sub">${esc(sitStr(g))}</p></div>
    <ul class="bag-list">${rows.map(e => penRow(e, st.coach, true)).join('') || '<li><p>Nobody left. A position player will pitch.</p></li>'}</ul>
    ${useBtn(st.coach != null ? `Auto: ${g.P[st.coach].last}` : 'Auto', 'forcedAuto')}</div>`;
}

/* ---------- Stats sheet ---------- */
function renderSheet() { if (DOM.sheetRoot) DOM.sheetRoot.innerHTML = UI.sheet ? vSheet() : ''; }
const READ_ROWS = [['sitFB', 'Sit fastball'], ['sitBR', 'Sit breaking'], ['sitOS', 'Sit offspeed'], ['protect', 'Protect'], ['big', 'Swing big'], ['take', 'Take']];
function readChart() {
  const sym = (a, f) => a === 'sit' + f ? ['p2', '▲'] : a.startsWith('sit') ? ['m1', '▼'] : a === 'protect' ? ['z', '·'] : a === 'big' ? ['z', '±'] : ['z', '—'];
  return `<p class="muted">Pitch family against the batter's read. ▲ a good read: better contact and harder hits. ▼ fooled: more whiffs. "Super effective" is kept for the type chart.</p>
  <div class="tbl-wrap"><table class="tbl chart"><thead><tr><th>Read</th><th>Fastball</th><th>Breaking</th><th>Offspeed</th></tr></thead><tbody>${READ_ROWS.map(([k, l]) => `<tr><td>${l}</td>${['FB', 'BR', 'OS'].map(f => { const [c, s] = sym(k, f); return `<td class="${c}">${s}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Location</th><th>What it does</th></tr></thead><tbody>${FC.LOCS.map(l => `<tr><td>${FC.LOC_LABEL[l]}</td><td style="text-align:left;white-space:normal">${LOC_DESC[l]}</td></tr>`).join('')}</tbody></table></div>`;
}
function typeChart() {
  const N = FC.TYPES.names;
  const head = N.map(n => `<th class="c" title="${esc(n)}"><span>${esc(FC.TYPES.short[FC.TYPES.idx(n)])}</span></th>`).join('');
  const rows = N.map(a => `<tr><th class="r">${typeChip(a, true)}</th>${N.map(d => { const m = FC.TYPES.mult(a, [d]); return m === 2 ? '<td class="s">2</td>' : m === 0.5 ? '<td class="n">½</td>' : m === 0 ? '<td class="z">0</td>' : '<td></td>'; }).join('')}</tr>`).join('');
  const pitchMap = Object.entries({ '4-seam 95+': 'Fireballer', '4-seam <95': 'Grinder', 'Sinker, cutter': 'Workhorse', 'Slider, sweeper': 'Closer', 'Curves': 'Curveballer', 'Changeup': 'Crafty', 'Splitter, fork, knuckler': 'Knuckleballer', 'Slurve, screwball': 'Junkballer' }).map(([p, t]) => `<span class="tag">${esc(p)} → ${typeChip(t, true)}</span>`).join(' ');
  return `<p class="muted">The Pokémon chart with baseball names. Rows attack, columns defend: green 2×, red ½×, black no effect. Dual types multiply. A pitch whose type matches the pitcher's is 1.5× (STAB).</p>
  <div class="tbl-wrap"><table class="tchart"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
  <div class="row">${pitchMap}</div>`;
}
function vSheet() {
  const g = S.game, t = UI.sheetTab; let body = '';
  if (t === 'box') {
    const bx = FC.boxScore(g);
    const r = { box: bx, innings: g.inning };
    body = lineScoreTable(r) + bx.teams.map(tm => battingTable(tm) + pitchingTable(tm)).join('') + `<div class="notes">${bx.notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>`;
  } else if (t === 'log') {
    const groups = [];
    for (const e of g.pbp) { const k = (e.half ? 'Bottom ' : 'Top ') + e.inn; let gr = groups[groups.length - 1]; if (!gr || gr.k !== k) { gr = { k, lines: [] }; groups.push(gr); } gr.lines.push(e.t); }
    body = groups.reverse().map(gr => `<div class="log-item"><span class="ts">${esc(gr.k)}</span>${gr.lines.map(x => `<p>${esc(x)}</p>`).join('')}</div>`).join('') || '<p class="muted">No plays yet.</p>';
  } else if (t === 'chart') body = readChart() + typeChart();
  else {
    const o = g.teams[1 - g.user];
    const lu = o.lineup.map(id => { const p = g.P[id]; return `<div class="pc"><span class="pc-pos">${esc(o.posOf[id] || '')}</span><div class="pc-main"><div class="pc-top"><span class="pc-name">${esc(p.name)}</span><span class="pc-lv">Lv ${p.lvl}</span></div><div class="pc-sub">${typeChips(p.types, true)}<span class="pc-stat">${esc(hitLine(FC.view(p.src)))}</span></div></div></div>`; }).join('');
    const pen = o.pen.concat(o.tiredPen).map(id => { const p = g.P[id]; return `<span class="tag">${esc(p.last)} ${typeChips(p.types, true)}</span>`; }).join(' ');
    body = `<h3 class="eyebrow">${esc(o.name)} lineup</h3><div class="party">${lu}</div><h3 class="eyebrow">Bullpen</h3><div class="row">${pen}</div>`;
  }
  const tabs = [['box', 'Box'], ['log', 'Log'], ['chart', 'Chart'], ['scout', 'Scout']];
  return `<div class="sheet-wrap" data-a="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Game stats" data-stop="1"><div class="sheet-head"><h3>${esc(g.teams[0].abbr)} ${g.score[0]} · ${esc(g.teams[1].abbr)} ${g.score[1]}</h3><button class="btn ghost sm" data-a="closeSheet">Close</button></div><div class="tabs" role="group" aria-label="Stats sections">${tabs.map(([k, l]) => `<button data-a="stab" data-v="${k}" aria-pressed="${t === k}">${l}</button>`).join('')}</div>${body}</div></div>`;
}

/* ---------- Player editor (section 8) ---------- */
const POS_LIST = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P'];
const PITCH_CODES = ['FF', 'SI', 'FC', 'SL', 'ST', 'CU', 'KC', 'CH', 'FS', 'FO', 'SV', 'SC', 'KN', 'EP'];
const PITCH_NAME = { FF: '4-Seam', SI: 'Sinker', FC: 'Cutter', SL: 'Slider', ST: 'Sweeper', CU: 'Curveball', KC: 'Knuckle Curve', CH: 'Changeup', FS: 'Splitter', FO: 'Forkball', SV: 'Slurve', SC: 'Screwball', KN: 'Knuckleball', EP: 'Eephus' };
const PITCH_FAM = { FF: 'FB', SI: 'FB', FC: 'FB', SL: 'BR', ST: 'BR', CU: 'BR', KC: 'BR', SV: 'BR', CH: 'OS', FS: 'OS', FO: 'OS', SC: 'OS', KN: 'OS', EP: 'OS' };
function realLabel(v, s) {
  const l = v.line || {}, r = v.rate || {};
  if (v.kind === 'H') return {
    contact: `${(r.k * 100).toFixed(1)}% K`, power: `${l.hr || 0} HR, ${l.ab ? ((l.tb - l.h) / l.ab).toFixed(3).replace(/^0/, '') : '.000'} ISO`,
    eye: `${(r.bb * 100).toFixed(1)}% BB`, gap: `${(l.d2 || 0) + (l.d3 || 0)} 2B+3B`, speed: `${r.sprint} ft/s, ${l.sb || 0} SB`, fielding: `${r.oaa >= 0 ? '+' : ''}${r.oaa || 0} OAA` }[s];
  return { stuff: `${(r.k * 100).toFixed(1)}% K`, control: `${(r.bb * 100).toFixed(1)}% BB`, movement: `${(r.gb * 100).toFixed(0)}% GB, ${(r.hr * 100).toFixed(1)}% HR/BF`, stamina: `${Math.round(r.budget)} pitches per ${v.role === 'SP' ? 'start' : 'outing'}` }[s];
}
function edited(id) { const o = FC.OV.players[id]; return !!(o && Object.keys(o).length); }
function edList() {
  const e = UI.ed;
  let list = FC.PLAYERS.map(p => FC.view(p.id)).filter(Boolean);
  const q = e.q.trim().toLowerCase();
  if (q) list = list.filter(v => v.name.toLowerCase().includes(q) || TEAM(v.team).name.toLowerCase().includes(q) || v.types.some(t => t.toLowerCase().includes(q)));
  if (e.team) list = list.filter(v => v.team === e.team);
  if (e.pos) list = list.filter(v => e.pos === 'P' ? v.kind === 'P' : v.pos.includes(e.pos));
  if (e.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else list.sort((a, b) => (b.ratings[e.sort] || -1) - (a.ratings[e.sort] || -1));
  return list;
}
function vEditor() {
  const e = UI.ed;
  if (e.id != null && FC.view(e.id)) return vEditPlayer(FC.view(e.id));
  if (e.panel === 'teams') return vEditTeams();
  if (e.panel === 'share') return vShare();
  const list = edList(), shown = list.slice(0, 150);
  const key = e.sort === 'name' ? null : e.sort;
  const row = v => `<button class="pr" data-a="edOpen" data-id="${v.id}"><div><div class="nm">${esc(v.name)} ${v.custom ? '<span class="custom-tag">Custom</span>' : ''}${edited(v.id) ? ' <span class="pc-flag">Edited</span>' : ''}</div><div class="sub">${tmChip(v.team)}<span class="pos-chip">${esc(v.kind === 'P' ? (v.role || 'P') : v.pos.join('/'))}</span>${typeChips(v.types, true)}</div><div class="pc-stat">${esc(statLine(v))}</div></div><span class="rt">${key ? Math.round(v.ratings[key] || 0) : ''}</span></button>`;
  return `<header class="head"><div><p class="eyebrow">${FC.PLAYERS.length} players</p><h2 class="h2">Player editor</h2></div><button class="btn ghost sm" data-a="edBack">Done</button></header>
  <div class="filters">
    <input id="edq" type="search" placeholder="Search players, teams or types" value="${esc(e.q)}" aria-label="Search players">
    <select id="edteam" aria-label="Team"><option value="">All teams</option>${FC.TEAMS.map(t => `<option value="${esc(t.abbr)}" ${e.team === t.abbr ? 'selected' : ''}>${esc(t.abbr)}</option>`).join('')}</select>
    <select id="edpos" aria-label="Position"><option value="">All positions</option>${POS_LIST.map(p => `<option ${e.pos === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
    <select id="edsort" aria-label="Sort"><option value="name">Name</option>${FC.HIT_STATS.concat(FC.PIT_STATS).map(s => `<option value="${s}" ${e.sort === s ? 'selected' : ''}>${FC.STAT_LABEL[s]}</option>`).join('')}</select>
  </div>
  <div class="row"><button class="btn sm" data-a="edNew" data-v="H">New hitter</button><button class="btn sm" data-a="edNew" data-v="P">New pitcher</button><button class="btn ghost sm" data-a="edPanel" data-v="teams">Teams</button><button class="btn ghost sm" data-a="edPanel" data-v="share">Share</button></div>
  ${e.msg ? `<p class="hint">${esc(e.msg)}</p>` : ''}
  <div class="pool">${shown.length ? shown.map(row).join('') : '<p class="empty-pool">No players match.</p>'}</div>
  ${list.length > shown.length ? `<p class="muted">Showing ${shown.length} of ${list.length}. Search or filter to narrow it down.</p>` : ''}`;
}
function ovOf(id) { FC.OV.players[id] = FC.OV.players[id] || {}; return FC.OV.players[id]; }
function applyOV() { FC.setOverrides(FC.OV); }
function slider(id, stat, v) {
  const val = Math.round(v.ratings[stat]), real = v.real[stat] != null ? Math.round(v.real[stat]) : null;
  return `<div class="sl ${real != null && val !== real ? 'mod' : ''}"><label for="r_${stat}">${FC.STAT_LABEL[stat]}</label><input type="range" min="1" max="99" step="1" id="r_${stat}" data-ed="rating" data-stat="${stat}" value="${val}"><output id="o_${stat}">${val}</output><span class="real">Real: ${real != null ? real + ' · ' : ''}${esc(realLabel(FC.base(id), stat) || '')}</span></div>`;
}
function projText(id) {
  const pr = FC.projectLine(id);
  if (pr.kind === 'H') return `Projected: ${pct3(pr.avg)} / ${pct3(pr.obp)} / ${pct3(pr.slg)}, ${pr.hr600} HR per 600 PA`;
  return `Projected: ${(pr.k * 100).toFixed(1)}% K, ${(pr.bb * 100).toFixed(1)}% BB, ${(pr.hr * 100).toFixed(1)}% HR, opponents hit ${pct3(pr.avg)} · budget ${pr.budget}, tank ${pr.tank}`;
}
function vEditPlayer(v) {
  const id = v.id, P = v.kind === 'P', stats = P ? FC.PIT_STATS : FC.HIT_STATS;
  const typeSel = (n, cur) => `<select data-ed="type" data-n="${n}" aria-label="Type ${n + 1}">${n === 1 ? `<option value="" ${!cur ? 'selected' : ''}>None</option>` : ''}${FC.TYPES.names.map(t => `<option ${cur === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const evTot = Object.values(v.ev).reduce((a, b) => a + (b || 0), 0);
  const pitches = P ? (v.pitches || []).map((x, i) => `<div class="pitch-ed"><div class="row"><select data-ed="pcode" data-i="${i}" aria-label="Pitch ${i + 1}">${PITCH_CODES.map(c => `<option value="${c}" ${x.code === c ? 'selected' : ''}>${PITCH_NAME[c]}</option>`).join('')}</select><label class="muted">mph <input type="number" min="40" max="106" step="0.1" data-ed="pvelo" data-i="${i}" value="${x.velo}" style="width:72px"></label><label class="muted">use % <input type="number" min="1" max="100" step="1" data-ed="pusage" data-i="${i}" value="${Math.round(x.usage * 100)}" style="width:64px"></label><button class="btn ghost sm" data-a="edPitchDel" data-i="${i}" ${v.pitches.length <= 1 ? 'disabled' : ''}>Remove</button></div>
    <div class="sl"><label for="ps_${i}">Stuff</label><input type="range" min="1" max="99" id="ps_${i}" data-ed="pstuff" data-i="${i}" value="${Math.round(x.stuff)}"><output>${Math.round(x.stuff)}</output></div>
    <div class="row"><span class="muted">Type</span><select data-ed="ptype" data-i="${i}" aria-label="Pitch ${i + 1} type">${FC.TYPES.names.map(t => `<option ${x.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>${typeChip(x.type, true)}</div></div>`).join('') : '';
  const gp = FC.makeGP(id);
  const budget = P ? Math.round(gp.p.budget) : 0;
  return `<header class="head"><div><p class="eyebrow">${v.custom ? 'Custom player' : 'Edit player'}${v.flag === '2025' ? ' · rated from 2025' : ''}</p><h2 class="h2">${esc(v.name)}</h2></div><button class="btn ghost sm" data-a="edClose">Back</button></header>
  <section class="card"><div class="inl">
    <label>Name<input data-ed="name" value="${esc(v.name)}" maxlength="40"></label>
    <label>Team<select data-ed="team">${FC.TEAMS.map(t => `<option value="${esc(t.abbr)}" ${v.team === t.abbr ? 'selected' : ''}>${esc(t.abbr)} · ${esc(t.short)}</option>`).join('')}</select></label>
    <label>Positions<input data-ed="pos" value="${esc(v.pos.join('/'))}" ${P ? 'disabled' : ''}></label>
    ${P ? `<label>Role<select data-ed="role">${['SP', 'RP', 'CL'].map(r => `<option ${v.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>` : '<span></span>'}
    <label>Bats<select data-ed="bats">${['R', 'L', 'S'].map(r => `<option ${v.bats === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label>Throws<select data-ed="throws">${['R', 'L'].map(r => `<option ${v.throws === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
  </div></section>
  <section class="card"><h3>Types</h3><div class="row">${typeSel(0, v.types[0])}${typeSel(1, v.types[1])}</div><p class="muted">From the data: ${esc((v.typeWhy || []).join(' · '))}</p></section>
  <section class="card"><h3>Ratings</h3><div class="ed-grid">${stats.map(s => slider(id, s, v)).join('')}</div>
    ${P ? `<p class="muted">Stamina ${Math.round(v.ratings.stamina)} · budget ${budget}, tank ${FC.tankOf(budget)} pitches. Health 100 (all pitchers).</p>` : ''}
    <p class="proj" id="proj">${esc(projText(id))}</p></section>
  ${P ? `<section class="card"><h3>Pitches</h3>${pitches}${v.pitches.length < 4 ? '<button class="btn sm" data-a="edPitchAdd">Add a pitch</button>' : ''}</section>` : ''}
  <section class="card"><h3>Level, IVs and EVs</h3>
    <div class="inl"><label>Level (Exhibition and Season)<input type="number" min="1" max="100" data-ed="level" value="${v.level}"></label><span></span></div>
    <p class="eyebrow">IVs (0–31)</p><div class="ivgrid">${stats.map(s => `<label>${FC.STAT_LABEL[s]}<input type="number" min="0" max="31" data-ed="iv" data-stat="${s}" value="${v.iv[s] != null ? v.iv[s] : 15}"></label>`).join('')}</div>
    <p class="eyebrow">EVs (0–252 each, ${evTot}/510)</p><div class="ivgrid">${stats.map(s => `<label>${FC.STAT_LABEL[s]}<input type="number" min="0" max="252" data-ed="ev" data-stat="${s}" value="${v.ev[s] || 0}"></label>`).join('')}</div></section>
  <div class="dock"><button class="btn ghost" data-a="edReset">${v.custom ? 'Delete' : 'Reset'}</button><button class="btn" data-a="edCopy">Copy</button><button class="btn primary" data-a="edSave">Save</button></div>`;
}
function vEditTeams() {
  const e = UI.ed, nt = e.newTeam || { name: '', short: '', c1: '#3a6ea5', c2: '#f2c14e' };
  return `<header class="head"><div><p class="eyebrow">Rosters</p><h2 class="h2">Teams</h2></div><button class="btn ghost sm" data-a="edPanel" data-v="">Back</button></header>
  <section class="card"><h3>New custom team</h3><div class="inl">
    <label>Name<input id="ntName" value="${esc(nt.name)}" maxlength="30"></label><label>Short name (2–4 letters)<input id="ntShort" value="${esc(nt.short)}" maxlength="4"></label>
    <label>Main color<input id="ntC1" type="color" value="${esc(nt.c1)}"></label><label>Trim color<input id="ntC2" type="color" value="${esc(nt.c2)}"></label></div>
    <button class="btn primary sm" data-a="edTeamNew">Create team</button>
    <p class="muted">Move players onto it from their edit sheet (Team). A team needs 9 hitters and 6 pitchers to play.</p></section>
  <section class="card"><h3>Reset</h3><div class="pool">${FC.TEAMS.map(t => { const n = FC.teamPlayers(t.abbr).filter(edited).length; return `<div class="pr" style="cursor:default"><div><div class="nm">${esc(t.name)} ${t.custom ? '<span class="custom-tag">Custom</span>' : ''}</div><div class="sub">${tmChip(t.abbr)}<span class="pc-stat">${FC.teamPlayers(t.abbr).length} players · ${n} edited</span></div></div><button class="btn ghost sm" data-a="edTeamReset" data-v="${esc(t.abbr)}" ${n || t.custom ? '' : 'disabled'}>${t.custom ? 'Delete' : 'Reset'}</button></div>`; }).join('')}</div>
    <button class="btn danger" data-a="edResetAll">${UI.confirmReset ? 'Tap again to reset every edit' : 'Reset everything'}</button></section>`;
}
function vShare() {
  const txt = JSON.stringify(FC.OV);
  return `<header class="head"><div><p class="eyebrow">Export and import</p><h2 class="h2">Share edits</h2></div><button class="btn ghost sm" data-a="edPanel" data-v="">Back</button></header>
  <section class="card"><h3>Export</h3><textarea class="field-in" id="shareOut" readonly>${esc(txt)}</textarea><button class="btn sm" data-a="edCopyOut">Copy</button></section>
  <section class="card"><h3>Import</h3><textarea class="field-in" id="shareIn" placeholder="Paste exported JSON here"></textarea><button class="btn primary sm" data-a="edImport">Import</button>${UI.ed.msg ? `<p class="hint">${esc(UI.ed.msg)}</p>` : ''}</section>`;
}
function newCustomId() { const ids = FC.OV.custom.map(c => c.id).concat([900000000]); return Math.max(...ids) + 1; }
function blankPlayer(kind, team) {
  const Q = FC.DATA.quantiles, L = FC.LG, id = newCustomId();
  const ivs = {}; (kind === 'P' ? FC.PIT_STATS : FC.HIT_STATS).forEach(s => { ivs[s] = Math.floor(Math.random() * 32); });
  const base = { id, name: kind === 'P' ? 'New Pitcher' : 'New Hitter', team, kind, pos: kind === 'P' ? ['P'] : ['DH'], bats: 'R', throws: 'R', age: 25,
    types: ['Grinder'], typeWhy: ['Custom'], iv: ivs, flag: '', custom: true, twoWay: null };
  if (kind === 'H') Object.assign(base, { r: { contact: 50, power: 50, eye: 50, gap: 50, speed: 50, fielding: 50 },
    rate: { k: Q.contact[50], bb: Q.eye[50], hbp: L.hbp, hr: Q.power[50], s1: L.single, s2: Q.gap[50] * 0.9, s3: Q.gap[50] * 0.1, babip: L.babip, sbAtt: L.sbAtt, sbPct: L.sbPct, sprint: Q.speed[50], oaa: 0, pull: L.pull, gb: L.gb, fb: L.fb, ld: L.ld, pu: L.pu },
    line: { g: 0, pa: 0, ab: 0, h: 0, hr: 0, d2: 0, d3: 0, bb: 0, k: 0, sb: 0, rbi: 0, tb: 0, hbp: 0, sf: 0 } });
  else Object.assign(base, { role: 'RP', r: { stuff: 50, control: 50, movement: 50, stamina: 50 },
    rate: { k: Q.stuff[50], bb: Q.control[50], hbp: L.hbp, hr: Q.hrAllowed[50], babip: L.babip, wp: L.wp, gb: Q.gb[50], fb: L.fb, ld: L.ld, pu: L.pu, budget: Q.stamina[50], hold: L.sbPct },
    pitches: [{ code: 'FF', name: '4-Seam', fam: 'FB', type: 'Grinder', usage: 0.55, velo: 94, whiff: Q.pitchWhiff[50], rv100: 0, stuff: 50 },
      { code: 'SL', name: 'Slider', fam: 'BR', type: 'Closer', usage: 0.3, velo: 85, whiff: Q.pitchWhiff[60], rv100: 0, stuff: 50 },
      { code: 'CH', name: 'Changeup', fam: 'OS', type: 'Crafty', usage: 0.15, velo: 86, whiff: Q.pitchWhiff[55], rv100: 0, stuff: 50 }],
    line: { g: 0, gs: 0, ip: 0, w: 0, l: 0, sv: 0, hld: 0, k: 0, bb: 0, hr: 0, er: 0, h: 0, bf: 0, np: 0 } });
  return base;
}
function copyPlayer(id) {
  const b = FC.base(id), v = FC.view(id);
  const c = JSON.parse(JSON.stringify(b));
  c.id = newCustomId(); c.custom = true; c.name = v.name + ' (copy)'; c.team = v.team; c.flag = ''; c.twoWay = null;
  c.types = v.types.slice(); c.typeWhy = ['Copy of ' + v.name];
  if (v.kind === 'P') c.pitches = JSON.parse(JSON.stringify(v.pitches));
  // keep this player's current ratings as the copy's own base
  c.r = Object.assign({}, b.r);
  const o = FC.OV.players[id];
  FC.OV.custom.push(c); applyOV();
  if (o) { FC.OV.players[c.id] = JSON.parse(JSON.stringify(o)); delete FC.OV.players[c.id].name; delete FC.OV.players[c.id].pitches; applyOV(); }
  return c.id;
}
// Apply one editor input to the overrides, live.
function edInput(t) {
  const id = UI.ed.id; if (id == null) return false;
  const v = FC.view(id), o = ovOf(id), ed = t.dataset.ed;
  const num = (x, a, b) => clamp(Number(x) || 0, a, b);
  if (ed === 'rating') { o.ratings = o.ratings || {}; o.ratings[t.dataset.stat] = num(t.value, 1, 99); const out = document.getElementById('o_' + t.dataset.stat); if (out) out.textContent = t.value; }
  else if (ed === 'name') { if (t.value.trim()) o.name = t.value.trim().slice(0, 40); }
  else if (ed === 'team') o.team = t.value;
  else if (ed === 'pos') { const ps = t.value.toUpperCase().split(/[^A-Z0-9]+/).filter(p => POS_LIST.includes(p) && p !== 'P'); if (ps.length) o.pos = ps.slice(0, 4); }
  else if (ed === 'role' || ed === 'bats' || ed === 'throws') o[ed] = t.value;
  else if (ed === 'type') { const ts = v.types.slice(); ts[+t.dataset.n] = t.value; o.types = ts.filter((x, i, a) => x && a.indexOf(x) === i).slice(0, 2); if (!o.types.length) o.types = ['Grinder']; }
  else if (ed === 'level') o.level = num(t.value, 1, 100);
  else if (ed === 'iv') { o.iv = o.iv || {}; o.iv[t.dataset.stat] = num(t.value, 0, 31); }
  else if (ed === 'ev') {
    o.ev = Object.assign({}, v.ev, o.ev || {});
    const others = Object.entries(o.ev).filter(([k]) => k !== t.dataset.stat).reduce((a, [, x]) => a + (x || 0), 0);
    o.ev[t.dataset.stat] = Math.min(num(t.value, 0, 252), Math.max(0, 510 - others));
    if (+t.value !== o.ev[t.dataset.stat]) t.value = o.ev[t.dataset.stat];
  } else if (ed.startsWith('p')) {
    o.pitches = JSON.parse(JSON.stringify(v.pitches));
    const x = o.pitches[+t.dataset.i]; if (!x) return false;
    if (ed === 'pcode') { x.code = t.value; x.name = PITCH_NAME[t.value]; x.fam = PITCH_FAM[t.value]; x.type = FC.TYPES.pitchType(t.value, x.velo); }
    else if (ed === 'pvelo') { x.velo = num(t.value, 40, 106); if (x.code === 'FF') x.type = FC.TYPES.pitchType('FF', x.velo); }
    else if (ed === 'pusage') x.usage = num(t.value, 1, 100) / 100;
    else if (ed === 'pstuff') { x.stuff = num(t.value, 1, 99); const out = t.parentNode.querySelector('output'); if (out) out.textContent = t.value; }
    else if (ed === 'ptype') x.type = t.value;
    const tot = o.pitches.reduce((a, y) => a + y.usage, 0) || 1;
    if (ed !== 'pusage') o.pitches.forEach(y => { y.usage = y.usage / tot; });
  }
  applyOV();
  const pr = document.getElementById('proj'); if (pr) pr.textContent = projText(id);
  return true;
}

/* ---------- Commands ---------- */
function resetGameUI() { UI.V = null; UI.menu = 'cmd'; UI.sel = 0; UI.app = 'normal'; UI.sheet = false; UI.confirmSim = false; UI.coach = null; UI.msg = ''; UI.bpSel = null; }
function coachPeek() {
  const g = S && S.game; if (!g || !g.need) return null;
  const r = g.rng; let c = null;
  try { c = FC.coachCall(g); } catch (e) { c = null; }
  g.rng = r;
  return c;
}
function startGame() {
  const plan = FC.planTeam(S); if (!plan) return;
  const d = UI.luDraft, extra = {};
  if (d) {
    S.lineups = S.lineups || {};
    S.lineups[plan.abbr] = { lineup: d.lineup.slice(), positions: Object.assign({}, d.positions) };
    if (d.starter != null && d.starter !== plan.team.pitcher) extra.userStarter = d.starter;
  }
  const g = FC.startNext(S, extra);
  S.phase = 'game'; UI.luDraft = null; UI.lu = null; UI.luPos = null; resetGameUI(); save();
  const L = g.lines;
  UI.V = L.length && L[0].s ? L[0].s : FC.snap(g);
  UI.intro = true; PB.active = true; render(); UI.intro = false; window.scrollTo(0, 0);
  const tok = PB.token;
  (async () => { await sleep(80); if (DOM.sprO) DOM.sprO.classList.remove('away'); await sleep(240); if (DOM.sprU) DOM.sprU.classList.remove('away'); await sleep(260); if (tok === PB.token && S && S.phase === 'game' && S.game === g) playLines(L); })();
}
function resumeGame() { S.phase = 'game'; resetGameUI(); UI.V = FC.snap(S.game); render(); window.scrollTo(0, 0); }
const A = {
  continue() { S = loadSaved(); UI.screen = null; resetGameUI(); UI.luDraft = null; render(); window.scrollTo(0, 0); },
  toTitle() { UI.screen = 'title'; render(); },
  editor() { UI.edReturn = UI.screen === 'title' || !S ? 'title' : null; UI.screen = 'editor'; UI.ed.id = null; UI.ed.panel = ''; UI.ed.msg = ''; render(); window.scrollTo(0, 0); },
  edBack() { UI.screen = UI.edReturn === 'title' ? 'title' : null; UI.luDraft = null; render(); window.scrollTo(0, 0); },
  sound() { PREFS.sound = !PREFS.sound; savePrefs(); const b = document.getElementById('sndBtn'); if (b) { b.setAttribute('aria-pressed', String(PREFS.sound)); b.textContent = b.textContent.includes('Sound') ? (PREFS.sound ? '♪ Sound on' : '♪ Sound off') : (PREFS.sound ? '♪ On' : '♪ Off'); } if (PREFS.sound) sfx('select'); },
  startMode() {
    const su = UI.setup;
    const team = su.team, seed = undefined;
    if (su.mode === 'exhibition') { S = FC.newExhibition({ away: su.home ? su.opp : team, home: su.home ? team : su.opp, user: su.home ? 1 : 0, difficulty: su.difficulty, seed }); S.phase = 'lineup'; }
    else if (su.mode === 'season') { S = FC.newSeason({ team, difficulty: su.difficulty }); S.phase = 'hub'; }
    else { S = FC.newPennant({ team, difficulty: su.difficulty }); S.phase = 'hub'; }
    UI.screen = null; UI.luDraft = null; save(); render(); window.scrollTo(0, 0);
  },
  toLineup() { if (S.game) { resumeGame(); return; } S.phase = 'lineup'; UI.luDraft = null; save(); render(); window.scrollTo(0, 0); },
  lineupBack() { if (S.mode === 'exhibition') { S = null; clearSaved(); UI.screen = 'setup'; } else S.phase = 'hub'; UI.luDraft = null; render(); },
  luPick(d) {
    const id = +d.id, dr = UI.luDraft; if (!dr) return;
    if (UI.luPos) { UI.luPos = null; }
    if (!UI.lu) { UI.lu = { id }; sfx('blip'); render(); return; }
    const a = UI.lu.id, b = id; UI.lu = null;
    if (a === b) { render(); return; }
    const ia = dr.lineup.indexOf(a), ib = dr.lineup.indexOf(b);
    if (ia >= 0 && ib >= 0) { dr.lineup[ia] = b; dr.lineup[ib] = a; }
    else if (ia >= 0 || ib >= 0) {   // a bench player comes in at that spot and position
      const inId = ia >= 0 ? b : a, outId = ia >= 0 ? a : b, at = Math.max(ia, ib);
      dr.lineup[at] = inId; dr.positions[inId] = dr.positions[outId]; delete dr.positions[outId];
    }
    sfx('select'); render();
  },
  luPos(d, el, ev) {
    const id = +d.id, dr = UI.luDraft; UI.lu = null;
    if (!UI.luPos) { UI.luPos = id; sfx('blip'); render(); return; }
    const a = UI.luPos; UI.luPos = null;
    if (a !== id) { const t = dr.positions[a]; dr.positions[a] = dr.positions[id]; dr.positions[id] = t; sfx('select'); }
    render();
  },
  luStarter(d) { if (!restedStarter(+d.id)) return; UI.luDraft.starter = +d.id; sfx('blip'); render(); },
  luReset() { if (S.lineups) { const p = FC.planTeam(S); if (p) delete S.lineups[p.abbr]; } UI.luDraft = null; UI.lu = null; UI.luPos = null; render(); },
  playBall() { startGame(); },
  extraRoute() { S.pr.extra = true; S.phase = 'lineup'; UI.luDraft = null; save(); render(); window.scrollTo(0, 0); },
  resetSave() { if (!UI.confirmReset) { UI.confirmReset = true; render(); return; } UI.confirmReset = false; clearSaved(); S = null; UI.screen = 'title'; render(); window.scrollTo(0, 0); },
  menu(d) {
    if (PB.active) return; UI.menu = d.v; UI.msg = ''; UI.confirmSim = false;
    if (d.v === 'pitch' || d.v === 'swing') { UI.coach = coachPeek(); if (d.v === 'pitch' && UI.coach && UI.coach.kind === 'pitch' && UI.lastPitchPA !== S.game.pa) { UI.sel = UI.coach.pi; UI.loc = UI.coach.loc; } }
    sfx(d.v === 'cmd' ? 'back' : 'select'); renderPanel();
  },
  psel(d) { if (PB.active) return; const i = +d.i; if (UI.sel === i) { A.throw(); return; } UI.sel = i; sfx('blip'); renderPanel(); },
  loc(d) { UI.loc = d.v; sfx('blip'); renderPanel(); },
  throw() { const g = S.game; if (PB.active || g.need !== 'pitch') return; sfx('select'); UI.lastPitchPA = g.pa; doUserAction(() => FC.userPitch(g, UI.sel, UI.loc)); },
  asel(d) { if (PB.active) return; if (UI.app === d.v) { A.swing(); return; } UI.app = d.v; sfx('blip'); renderPanel(); },
  swing() { const g = S.game; if (PB.active || g.need !== 'swing') return; sfx('select'); doUserAction(() => FC.userSwing(g, UI.app)); },
  run(d) { const g = S.game; if (PB.active) return; sfx('select'); doUserAction(() => FC.userRun(g, d.v)); },
  ph(d) { const g = S.game; doUserAction(() => FC.userPinch(g, +d.slot, +d.id)); },
  pr(d) { const g = S.game; doUserAction(() => FC.userPinchRun(g, +d.base, +d.id)); },
  pen(d) {
    const g = S.game; if (PB.active) return;
    const st = FC.bullpenState(g, g.user);
    if (st.reason) { UI.msg = st.reason; renderPanel(); return; }
    doUserAction(() => FC.userBullpen(g, +d.id));
  },
  forcedAuto() {
    const g = S.game; if (PB.active) return;
    const st = FC.bullpenState(g, g.user);
    if (st.coach != null) doUserAction(() => FC.userBullpen(g, st.coach));
    else doUserAction(() => { g.lines = []; g.pending = null; FC._t.bringIn(g, g.user, null, { forced: true }); FC.runUntilUser(g); return true; });
  },
  visit() {
    const g = S.game; if (PB.active) return;
    const vs = FC.visitState(g);
    if (!vs.ok) { UI.msg = vs.why; renderPanel(); return; }
    doUserAction(() => FC.userVisit(g));
  },
  auto() { const g = S.game; if (PB.active) return; doUserAction(() => FC.userAuto(g)); },
  simRest() { if (!UI.confirmSim) { UI.confirmSim = true; renderPanel(); return; } const g = S.game; cancelPlayback(); resetGameUI(); FC.simToEnd(g); save(); UI.V = FC.snap(g); render(); },
  stats() { UI.sheet = true; UI.sheetTab = 'box'; sfx('select'); renderSheet(); },
  stab(d) { UI.sheetTab = d.v; sfx('blip'); renderSheet(); },
  closeSheet() { UI.sheet = false; renderSheet(); },
  pref(d) { PREFS[d.k] = d.v; savePrefs(); sfx('blip'); renderPanel(); },
  skip() { if (PB.active) { PB.skip = true; PB.finish = true; pbTap(); } },
  tap() { pbTap(); },
  toPost() { cancelPlayback(); const res = FC.finishGame(S); S.phase = 'post'; resetGameUI(); save(); render(); window.scrollTo(0, 0); if (res && res.win) sfx('win'); if (res && res.levelUps && res.levelUps.length) setTimeout(() => sfx('lvl'), 400); },
  postNext() { S.phase = S.done ? 'end' : 'hub'; save(); render(); window.scrollTo(0, 0); },
  rematch() { S.game = null; S.phase = 'lineup'; UI.luDraft = null; save(); render(); window.scrollTo(0, 0); },
  newFromEnd() { clearSaved(); S = null; UI.screen = 'title'; render(); window.scrollTo(0, 0); },
  exitGame() { cancelPlayback(); resetGameUI(); save(); if (S.mode === 'exhibition') { UI.screen = 'title'; } else S.phase = 'hub'; render(); window.scrollTo(0, 0); },
  // editor
  edOpen(d) { UI.ed.id = +d.id; UI.ed.orig = JSON.stringify(FC.OV.players[+d.id] || null); UI.ed.msg = ''; render(); window.scrollTo(0, 0); },
  edClose() { const id = UI.ed.id; const o = UI.ed.orig != null ? JSON.parse(UI.ed.orig) : null; if (o) FC.OV.players[id] = o; else delete FC.OV.players[id]; applyOV(); UI.ed.id = null; render(); },
  edSave() { const id = UI.ed.id; if (FC.OV.players[id] && !Object.keys(FC.OV.players[id]).length) delete FC.OV.players[id]; saveEdits(); UI.ed.msg = `Saved ${FC.view(id).name}.`; UI.ed.id = null; render(); },
  edReset() {
    const id = UI.ed.id, v = FC.view(id);
    if (v.custom) { FC.OV.custom = FC.OV.custom.filter(c => c.id !== id); delete FC.OV.players[id]; UI.ed.msg = `Deleted ${v.name}.`; UI.ed.id = null; }
    else { delete FC.OV.players[id]; UI.ed.orig = 'null'; UI.ed.msg = `${v.name} is back to real stats.`; }
    applyOV(); saveEdits(); render();
  },
  edCopy() { const nid = copyPlayer(UI.ed.id); saveEdits(); UI.ed.id = nid; UI.ed.orig = 'null'; render(); window.scrollTo(0, 0); },
  edNew(d) { const team = UI.ed.team || (S && S.team) || UI.setup.team; const c = blankPlayer(d.v, team); FC.OV.custom.push(c); applyOV(); saveEdits(); UI.ed.id = c.id; UI.ed.orig = 'null'; render(); window.scrollTo(0, 0); },
  edPitchAdd() { const id = UI.ed.id, v = FC.view(id), o = ovOf(id); o.pitches = JSON.parse(JSON.stringify(v.pitches)); if (o.pitches.length >= 4) return; o.pitches.push({ code: 'CU', name: 'Curveball', fam: 'BR', type: 'Curveballer', usage: 0.1, velo: 79, whiff: FC.DATA.quantiles.pitchWhiff[50], rv100: 0, stuff: 50 }); const tot = o.pitches.reduce((a, y) => a + y.usage, 0); o.pitches.forEach(y => { y.usage /= tot; }); applyOV(); render(); },
  edPitchDel(d) { const id = UI.ed.id, v = FC.view(id), o = ovOf(id); o.pitches = JSON.parse(JSON.stringify(v.pitches)); if (o.pitches.length <= 1) return; o.pitches.splice(+d.i, 1); const tot = o.pitches.reduce((a, y) => a + y.usage, 0); o.pitches.forEach(y => { y.usage /= tot; }); applyOV(); render(); },
  edPanel(d) { UI.ed.panel = d.v; UI.ed.msg = ''; UI.confirmReset = false; render(); window.scrollTo(0, 0); },
  edTeamNew() {
    const nt = UI.ed.newTeam || {}; const name = (document.getElementById('ntName') || {}).value || nt.name || '';
    const short = ((document.getElementById('ntShort') || {}).value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const c1 = (document.getElementById('ntC1') || {}).value || '#3a6ea5', c2 = (document.getElementById('ntC2') || {}).value || '#f2c14e';
    if (!name.trim() || short.length < 2 || FC.TBY[short]) { UI.ed.msg = 'Pick a name and an unused 2–4 letter short name.'; render(); return; }
    FC.OV.customTeams.push({ id: 9000 + FC.OV.customTeams.length, abbr: short, name: name.trim(), short: name.trim().split(' ').pop(), city: name.trim(), league: 'Custom', division: 'Custom', colors: [c1, c2], custom: true });
    applyOV(); saveEdits(); UI.ed.newTeam = null; UI.ed.msg = `Created ${name.trim()}. Move players to it from their edit sheet.`; render();
  },
  edTeamReset(d) {
    const ab = d.v, T = FC.TBY[ab];
    for (const id of FC.teamPlayers(ab)) delete FC.OV.players[id];
    if (T && T.custom) { FC.OV.customTeams = FC.OV.customTeams.filter(t => t.abbr !== ab); for (const id in FC.OV.players) if (FC.OV.players[id].team === ab) delete FC.OV.players[id].team; FC.OV.custom.forEach(c => { if (c.team === ab) c.team = 'NYY'; }); }
    applyOV(); saveEdits(); render();
  },
  edResetAll() { if (!UI.confirmReset) { UI.confirmReset = true; render(); return; } UI.confirmReset = false; FC.setOverrides({ players: {}, custom: [], teams: {}, customTeams: [] }); saveEdits(); UI.ed.msg = 'Every edit is gone. All players are back to real stats.'; render(); },
  edCopyOut() { const t = document.getElementById('shareOut'); if (!t) return; t.select(); try { navigator.clipboard.writeText(t.value).catch(() => document.execCommand('copy')); } catch (e) { try { document.execCommand('copy'); } catch (_) { /* nothing */ } } UI.ed.msg = 'Copied.'; },
  edImport() {
    const t = document.getElementById('shareIn'); if (!t) return;
    try {
      const o = JSON.parse(t.value);
      if (!o || typeof o !== 'object' || (!o.players && !o.custom)) throw new Error('not an export');
      FC.setOverrides({ players: o.players || {}, custom: Array.isArray(o.custom) ? o.custom : [], teams: o.teams || {}, customTeams: Array.isArray(o.customTeams) ? o.customTeams : [] });
      saveEdits(); UI.ed.msg = `Imported ${Object.keys(o.players || {}).length} edits and ${(o.custom || []).length} custom players.`;
    } catch (e) { UI.ed.msg = 'That isn\'t a Full Count export.'; }
    render();
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]'); if (!el || el.disabled) return;
  if (el.classList.contains('sheet-wrap') && e.target.closest('[data-stop]')) return;
  // a button inside a clickable row handles itself
  const fn = A[el.dataset.a]; if (fn) { e.preventDefault(); e.stopPropagation(); fn(el.dataset, el, e); }
});
document.addEventListener('keydown', e => {
  const el = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && el && el.getAttribute && el.getAttribute('role') === 'button' && el.dataset.a) { e.preventDefault(); const fn = A[el.dataset.a]; if (fn) fn(el.dataset, el, e); return; }
  if (e.key === 'Escape') { if (UI.sheet) { UI.sheet = false; renderSheet(); return; } if (S && S.phase === 'game' && !PB.active && UI.menu !== 'cmd') { UI.menu = 'cmd'; renderPanel(); } return; }
  if (PB.active && (e.key === 'Enter' || e.key === ' ' || e.key === 'z' || e.key === 'a') && !/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) { e.preventDefault(); pbTap(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'edq') { UI.ed.q = t.value; const pos = t.selectionStart; render(); const n = document.getElementById('edq'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (_) { /* nothing */ } } return; }
  if (t.dataset && t.dataset.ed && (t.type === 'range' || t.type === 'number')) edInput(t);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'tMode') UI.setup.mode = t.value;
  if (t.name === 'tDiff') UI.setup.difficulty = t.value;
  if (t.id === 'suTeam') { UI.setup.team = t.value; render(); }
  if (t.id === 'suOpp') { UI.setup.opp = t.value; render(); }
  if (t.name === 'suHome') UI.setup.home = t.value === '1';
  if (t.id === 'edteam') { UI.ed.team = t.value; render(); }
  if (t.id === 'edpos') { UI.ed.pos = t.value; render(); }
  if (t.id === 'edsort') { UI.ed.sort = t.value; render(); }
  if (t.id === 'ntName' || t.id === 'ntShort' || t.id === 'ntC1' || t.id === 'ntC2') { UI.ed.newTeam = UI.ed.newTeam || {}; UI.ed.newTeam[{ ntName: 'name', ntShort: 'short', ntC1: 'c1', ntC2: 'c2' }[t.id]] = t.value; }
  if (t.dataset && t.dataset.ed) { if (edInput(t) && t.type !== 'range' && t.type !== 'number') render(); else if (t.type === 'range') render(); }
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'setupForm') return; e.preventDefault();
  UI.screen = 'setup'; render(); window.scrollTo(0, 0);
});

/* ---------- Debug hooks for tests ---------- */
window.__fc = {
  get S() { return S; }, UI, FC,
  // force the user's current pitcher's bars and redraw (Playwright color checks)
  setBars(o) { const g = S && S.game; if (!g) return false; const t = g.teams[1 - g.half] === g.teams[g.user] ? g.teams[g.user] : g.teams[1 - g.half]; const P = g.P[t.pitcher]; if (!P) return false; if (o.hp != null) P.pt.hp = o.hp; if (o.pastBudget) P.pt.used = (P.pt.B + Math.ceil((P.pt.T - P.pt.B) * 0.75)) * 100; if (o.used != null) P.pt.used = o.used * 100; UI.V = FC.snap(g); refreshBoxes(true); updateBug(UI.V); return true; },
  forceFaint() { const g = S && S.game; if (!g || g.need !== 'pitch') return false; const P = g.P[FC.curPitcherId(g)]; P.pt.min3 = 3; P.pt.hp = 1; g.script = [{ res: 'bip', bt: 'ld', out: 's1' }]; return true; },
};

function start() {
  loadEdits();
  const sv = loadSaved(); if (sv) S = sv;
  resetGameUI();
  UI.screen = S ? null : 'title';
  if (S && S.phase === 'game' && S.game) UI.V = FC.snap(S.game);
  render();
}
start();
