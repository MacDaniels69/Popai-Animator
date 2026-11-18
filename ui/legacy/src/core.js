/* ===================== Popai Animator — core: utilities, document model, channels, history ===================== */
'use strict';

// ---------- utilities ----------
let _idc = 0;
const uid = (p = '') => p + Date.now().toString(36).slice(-4) + (++_idc).toString(36) + Math.random().toString(36).slice(2, 5);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash1(n, seed = 0) { const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); }
function vnoise(t, seed = 0) { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return lerp(hash1(i, seed), hash1(i + 1, seed), u) * 2 - 1; }

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function isColor(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); }
function hexToRgb(h) { h = (h || '#000000').replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h.slice(0, 6), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
function mixColor(a, b, t) { const x = hexToRgb(a), y = hexToRgb(b); return rgbToHex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)); }
function rgba(hex, a) { const c = hexToRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

// ---------- 2D affine matrices [a,b,c,d,e,f] (canvas convention) ----------
const M = {
  I: () => [1, 0, 0, 1, 0, 0],
  mul: (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ],
  t: (x, y) => [1, 0, 0, 1, x, y],
  r: (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; },
  s: (x, y = x) => [x, 0, 0, y, 0, 0],
  inv: (m) => {
    const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  },
  ap: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  apv: (m, x, y) => [m[0] * x + m[2] * y, m[1] * x + m[3] * y],
  chain: (...ms) => ms.reduce((a, b) => M.mul(a, b)),
  scaleOf: (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])),
  set: (ctx, m) => ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]),
};

// ---------- interpolation ----------
function outBounce(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}
const EASE = {
  linear: (t) => t,
  step: () => 0,
  ease: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easein: (t) => t * t * t,
  easeout: (t) => 1 - Math.pow(1 - t, 3),
  bounce: outBounce,
  elastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};
const INTERPS = [
  ['smooth', 'Smooth'], ['linear', 'Linear'], ['ease', 'Ease in/out'], ['easein', 'Ease in'], ['easeout', 'Ease out'],
  ['bezier', 'Bézier'], ['step', 'Step (hold)'], ['noisy', 'Noisy'], ['cycle', 'Cycle'], ['bounce', 'Bounce'], ['elastic', 'Elastic'],
];
const INTERP_COLORS = { smooth: '#7fb4ff', linear: '#ffd166', ease: '#7ee08a', easein: '#5cc2a0', easeout: '#a0e05c', step: '#ff6b6b', bounce: '#d68cff', elastic: '#ff9de2', bezier: '#ffa94d', noisy: '#adb5bd', cycle: '#63e6be' };
const INTERP_HELP = {
  smooth: 'Flowing: the curve is shaped by the neighbouring keys', linear: 'Constant speed', ease: 'Starts slowly, speeds up, slows down at the end',
  easein: 'Soft start', easeout: 'Soft landing', bezier: 'Editable curve handles (shape them in Curves)', step: 'Holds until the next key, then jumps',
  noisy: 'Irregular wobble between the keys (trembling, shake)', cycle: 'Repeats an earlier range of frames from this key on', bounce: 'Rebounds into the next key', elastic: 'Overshoots and springs into the next key',
};
const LABEL_COLORS = [['', 'None'], ['#ff6b6b', 'Red'], ['#ffa94d', 'Orange'], ['#ffd43b', 'Yellow'], ['#69db7c', 'Green'], ['#4dabf7', 'Blue'], ['#da77f2', 'Purple']];
// Bézier easing: solve x(s) = t by bisection (identical in the Rust engine), then y(s)
function bezierEase(bz, t) {
  const x1 = clamp(bz[0], 0, 1), y1 = bz[1], x2 = clamp(bz[2], 0, 1), y2 = bz[3];
  const cb = (a, b, s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (cb(x1, x2, mid) < t) lo = mid; else hi = mid; }
  return cb(y1, y2, (lo + hi) / 2);
}
function cycleMap(a, f) {
  const c = a.cy || 0, target = a.cm === 'rel' ? a.f - c : c, len = a.f - target;
  if (!(len > 0)) return null;
  return target + ((((f - a.f) % len) + len) % len);
}

function mixVal(a, b, t) {
  if (typeof a === 'number') return a + (b - a) * t;
  if (Array.isArray(a)) return a.map((v, i) => v + (b[i] - v) * t);
  if (isColor(a) && isColor(b)) return mixColor(a, b, t);
  return a;
}
function hermite(a, b, ma, mb, t) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * ma + (-2 * t3 + 3 * t2) * b + (t3 - t2) * mb;
}
function evalChannel(ch, f) {
  const k = ch.keys;
  if (!k.length) return undefined;
  if (f <= k[0].f) return k[0].v;
  const last = k[k.length - 1];
  if (f >= last.f) {
    if (f > last.f && last.i === 'cycle') { const g = cycleMap(last, f); if (g !== null) return evalChannel(ch, g); }
    return last.v;
  }
  let lo = 0, hi = k.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (k[m].f <= f) lo = m; else hi = m; }
  const a = k[lo], b = k[hi];
  const it = a.i || 'smooth';
  if (it === 'cycle') { const g = cycleMap(a, f); return g === null ? a.v : evalChannel(ch, g); }
  // timing controls: hold, interval (on twos...), stagger
  const hold = Math.min(Math.max(a.hold || 0, 0), b.f - a.f);
  if (f - a.f < hold) return a.v;
  const start = a.f + hold;
  let fa = f;
  const iv = Math.floor(a.iv || 0);
  if (iv >= 2) fa = start + Math.floor((fa - start) / iv) * iv;
  if (a.stg === true) {
    const q = iv >= 2 ? iv : 2, idx = Math.floor((fa - start) / q);
    fa = ((idx % 2) + 2) % 2 === 1 ? start + (idx - 0.5) * q : start + idx * q;
  }
  const t = b.f - start > 0 ? clamp((fa - start) / (b.f - start), 0, 1) : 1;
  const numeric = typeof a.v === 'number' || Array.isArray(a.v);
  if (!numeric && !isColor(a.v)) return a.v; // discrete -> hold
  if (it === 'step') return a.v;
  if (it === 'smooth' && numeric) {
    const p = k[lo - 1], n = k[hi + 1], span = b.f - a.f;
    const comp = (av, bv, pv, nv) => {
      const ma = p ? ((bv - pv) / (b.f - p.f)) * span : 0;
      const mb = n ? ((nv - av) / (n.f - a.f)) * span : 0;
      return hermite(av, bv, ma, mb, t);
    };
    if (typeof a.v === 'number') return comp(a.v, b.v, p ? p.v : 0, n ? n.v : 0);
    return a.v.map((av, i) => comp(av, b.v[i], p ? p.v[i] : 0, n ? n.v[i] : 0));
  }
  if (it === 'bezier') return mixVal(a.v, b.v, bezierEase(a.bz || [0.33, 0, 0.67, 1], t));
  if (it === 'noisy' && numeric) {
    const amp = a.na ?? 10, per = Math.max(0.5, a.nf ?? 3), env = Math.sin(Math.PI * t);
    const nz = (i) => vnoise((fa - a.f) / per, a.f * 0.137 + 7 + i * 13) * amp * env, m = mixVal(a.v, b.v, t);
    return typeof m === 'number' ? m + nz(0) : m.map((x, i) => x + nz(i));
  }
  if (it === 'noisy') return mixVal(a.v, b.v, t);
  const e = EASE[it] || EASE.ease;
  return mixVal(a.v, b.v, it === 'smooth' ? EASE.ease(t) : e(t));
}

// ---------- application state (not saved in document) ----------
const S = {
  doc: null,
  boneLabels: (() => { try { return localStorage.getItem('popai.boneLabels') !== '0'; } catch { return true; } })(),
  media: {}, // id -> {name, type, url, el(img|audioBuffer)}
  frame: 0,
  playing: false,
  loop: true,
  autoKey: true,
  defInterp: 'smooth',
  tool: 'select',
  selLayers: [], // ids, last = primary
  selPts: new Set(),
  selShape: null,
  selBone: null,
  selBones: new Set(), // multi-selection for Select Bone / Reparent
  selKeys: new Set(), // `${ownerId}|${path}|${frame}`
  activeChannel: null, // {owner, path}
  onion: false, onionN: 2,
  showPaths: true,
  newStyle: { fill: '#f2b880', stroke: '#2b2b2b', width: 4, fillOn: true, strokeOn: true },
  polySides: 5, polyStar: false, freehandSmooth: 3, ikMode: true,
  view: { zoom: 0.6, panX: 0, panY: 0 },
  dirtyDoc: false,
  outputOnly: false,
  fastPlay: true,
  mode: 'animate', // 'setup' edits the rest pose / rig; 'animate' records keys
  animFrame: 0,
  swPreview: {}, // switchId -> childId shown temporarily (never keyed)
  alignOverlay: false,
};

// ---------- document model ----------
const LAYER_TYPES = {
  vector: { icon: '✎', name: 'Vector' },
  group: { icon: '▣', name: 'Group' },
  bone: { icon: '🦴', name: 'Bone Group' },
  switch: { icon: '⇄', name: 'Switch Group' },
  image: { icon: '🖼', name: 'Image' },
  text: { icon: 'T', name: 'Text' },
  audio: { icon: '♪', name: 'Audio' },
  particle: { icon: '✦', name: 'Particles' },
};
const isContainer = (L) => L && (L.type === 'group' || L.type === 'bone' || L.type === 'switch');

function newDoc(o = {}) {
  return {
    v: 1, name: o.name || 'Untitled', w: o.w || 1280, h: o.h || 720, fps: o.fps || 24, end: o.end || 72, bg: o.bg || '#ffffff',
    camera: { id: 'CAM', type: 'camera', name: 'Camera', p: { x: 0, y: 0, zoom: 1, roll: 0, shake: 0, shakeFreq: 10 }, ch: {} },
    layers: [], styles: [], markers: [],
    palette: ['#ffffff', '#2b2b2b', '#f2b880', '#c97b4a', '#e94f37', '#f6ae2d', '#86bb4a', '#3f88c5', '#7b4fa0', '#ff8fb1', '#8a8a8a', '#3a2a1a'],
    media: {},
    ai: { log: [] },
  };
}
let _layerCount = {};
function mkLayer(type, name) {
  _layerCount[type] = (_layerCount[type] || 0) + 1;
  const L = {
    id: uid('L'), type, name: name || `${LAYER_TYPES[type].name} ${_layerCount[type]}`,
    vis: true, lock: false, render: true, open: true, label: '',
    p: { x: 0, y: 0, z: 0, rot: 0, sx: 1, sy: 1, opacity: 1, ox: 0, oy: 0 }, ch: {}, fx: [], blend: 'source-over', bindBone: null,
  };
  if (type === 'vector') { L.pts = {}; L.paths = []; L.shapes = []; }
  if (isContainer(L)) L.children = [];
  if (type === 'bone') L.bones = [];
  if (type === 'group') L.mask = 'none';
  if (type === 'switch') { L.p.sw = null; L.swMode = 'discrete'; L.swFade = 4; }
  if (type === 'image') { L.media = null; L.iw = 0; L.ih = 0; }
  if (type === 'text') { L.text = 'Text'; L.font = 'Inter, system-ui, sans-serif'; L.size = 72; L.bold = true; L.p.color = '#222222'; }
  if (type === 'audio') { L.media = null; L.offset = 0; L.p.gain = 1; L.mute = false; }
  if (type === 'particle') {
    L.mode = 'continuous'; L.startF = 0; L.endF = 9999; L.seed = 7; L.burst = 40; L.shape = 'soft'; L.emit = 'circle';
    Object.assign(L.p, { rate: 30, life: 1.4, speed: 220, speedVar: 0.5, spread: 50, angle: -90, gravity: 250, wind: 0, drag: 0.6,
      size0: 14, size1: 34, alpha0: 0.8, alpha1: 0, color0: '#a3876a', color1: '#e1d6c8', emitR: 24, spin: 90 });
  }
  return L;
}

// ---------- tree helpers ----------
function walk(list, fn, parent = null, depth = 0) {
  for (const L of list) {
    if (fn(L, parent, depth) === false) return false;
    if (L.children && walk(L.children, fn, L, depth + 1) === false) return false;
  }
}
function findLayer(id, list = S.doc.layers) {
  let r = null;
  walk(list, (L) => { if (L.id === id) { r = L; return false; } });
  return r;
}
function parentOf(id) {
  let r = null;
  walk(S.doc.layers, (L, P) => { if (L.id === id) { r = P; return false; } });
  return r;
}
function siblingsOf(id) { const P = parentOf(id); return P ? P.children : S.doc.layers; }
function ancestors(id) { const a = []; let P = parentOf(id); while (P) { a.push(P); P = parentOf(P.id); } return a; }
function boneLayerFor(L) { // nearest ancestor bone layer
  return ancestors(L.id).find((A) => A.type === 'bone') || null;
}
function getOwner(id) { return id === 'CAM' ? S.doc.camera : findLayer(id); }
function selLayer() { const id = S.selLayers[S.selLayers.length - 1]; return id ? findLayer(id) : null; }
function allLayers() { const a = []; walk(S.doc.layers, (L) => { a.push(L); }); return a; }

// ---------- property access (base values + channels) ----------
function baseGet(o, path) {
  if (path.indexOf(':') < 0) return o.p[path];
  const [kind, id, prop] = path.split(':');
  if (kind === 'pt') { const p = o.pts && o.pts[id]; return p ? [p.x, p.y] : undefined; }
  if (kind === 'pv') { const p=o.pts?.[id]; return p ? (p[prop] ?? ({c:1,width:1,alpha:1,color:'#000000',strength:0}[prop] ?? [0,0])) : undefined; }
  if (kind === 'curve') { const p=o.paths?.find(p=>p.id===id); return p ? (p[prop] ?? ({start:0,end:1,repeats:1,offset:0}[prop] ?? false)) : undefined; }
  if (kind === 'bone') {
    const b = o.bones && o.bones.find((b) => b.id === id); if (!b) return undefined;
    return prop === 'p' ? [b.x, b.y] : prop === 'a' ? b.a : prop === 's' ? (b.s ?? 1) : b[prop];
  }
  if (kind === 'fx') { const e = o.fx.find((e) => e.id === id); return e ? e.p[prop] : undefined; }
  if (kind === 'sh') { const s = o.shapes && o.shapes.find((s) => s.id === id); return s ? s[prop] : undefined; }
}
function baseSet(o, path, v) {
  if (path.indexOf(':') < 0) { o.p[path] = v; return; }
  const [kind, id, prop] = path.split(':');
  if (kind === 'pt') { const p = o.pts[id]; if (p) { p.x = v[0]; p.y = v[1]; } return; }
  if (kind === 'pv') { if(o.pts?.[id])o.pts[id][prop]=v; return; }
  if (kind === 'curve') { const p=o.paths?.find(p=>p.id===id); if(p)p[prop]=v; return; }
  if (kind === 'bone') {
    const b = o.bones.find((b) => b.id === id); if (!b) return;
    if (prop === 'p') { b.x = v[0]; b.y = v[1]; } else if (prop === 'a') b.a = v; else if (prop === 's') b.s = v; else b[prop] = v;
    return;
  }
  if (kind === 'fx') { const e = o.fx.find((e) => e.id === id); if (e) e.p[prop] = v; return; }
  if (kind === 'sh') { const s = o.shapes.find((s) => s.id === id); if (s) s[prop] = v; }
}
function val(o, path, f) {
  const ch = o.ch[path];
  if (ch && ch.keys.length) return evalChannel(ch, f);
  return baseGet(o, path);
}
function isKeyed(o, path) { const ch = o.ch[path]; return !!(ch && ch.keys.length); }
function keyAt(o, path, f) { const ch = o.ch[path]; return ch ? ch.keys.find((k) => k.f === f) : null; }
function setKey(ch, f, v, interp) {
  const k = ch.keys.find((k) => k.f === f);
  if (k) { k.v = clone(v); if (interp) k.i = interp; }
  else {
    let i = interp || S.defInterp;
    if (i === 'copy') { const prev = ch.keys.filter((q) => q.f < f).pop(); i = prev && prev.i && prev.i !== 'cycle' ? prev.i : 'smooth'; }
    ch.keys.push({ f, v: clone(v), i }); ch.keys.sort((a, b) => a.f - b.f);
  }
}
const DISCRETE = (path) => path === 'sw' || path === 'vis' || path === 'vit' || path === 'visible' || path === 'order';
let REV = 0; // bumped on every document change (invalidates simulation caches)
// Moho-style: frame 0 is the setup pose; edits at other frames create keys (auto-key)
function setVal(o, path, v, f = S.frame, force = false) {
  assertWritable(o);
  if (!Number.isFinite(f) || f < 0 || f > 100000) throw new Error("Invalid keyframe time");
  REV++;
  const ch = o.ch[path];
  const interp = DISCRETE(path) ? 'step' : undefined;
  if (ch && ch.keys.length) { setKey(ch, f, v, interp); if (f === 0) baseSet(o, path, v); return; }
  if (!force && (f === 0 || !S.autoKey)) { baseSet(o, path, v); return; }
  const old = baseGet(o, path);
  const nc = (o.ch[path] = { keys: [] });
  setKey(nc, 0, old, interp);
  setKey(nc, f, v, interp);
}
function deleteChannelsMatching(o, pred) { for (const k of Object.keys(o.ch)) if (pred(k)) delete o.ch[k]; }

// ---------- history (undo/redo) ----------
const H = { undo: [], redo: [], pending: null, max: 120 };
function snapshot() {
  const media = S.doc.media; S.doc.media = undefined;
  const s = JSON.stringify(S.doc);
  S.doc.media = media;
  return s;
}
function restore(s) {
  invalidateScene();
  const media = S.doc.media;
  S.doc = JSON.parse(s);
  S.doc.media = media;
  // drop stale selections
  S.selLayers = S.selLayers.filter((id) => findLayer(id));
  S.selPts = new Set(); S.selKeys = new Set();
}
function edit(label, fn) {
  const before = snapshot();
  let r;
  try { r = fn(); } catch (e) { console.error(e); restore(before); toast('Error: ' + e.message, 'err'); refreshAll(); return false; }
  const after = snapshot();
  if (after !== before) {
    H.undo.push({ label, s: before }); if (H.undo.length > H.max) H.undo.shift();
    H.redo = []; S.dirtyDoc = true; invalidateScene();
  }
  refreshAll();
  return r === undefined ? true : r;
}
// for continuous interactions (drags): begin -> many updates -> commit
function beginEdit(label) { H.pending = { label, s: snapshot() }; }
function commitEdit() {
  if (!H.pending) return;
  const after = snapshot();
  if (after !== H.pending.s) { H.undo.push(H.pending); if (H.undo.length > H.max) H.undo.shift(); H.redo = []; S.dirtyDoc = true; }
  H.pending = null; refreshAll();
}
function cancelEdit() { if (H.pending) { restore(H.pending.s); H.pending = null; refreshAll(); } }
function undo() {
  if (H.pending) commitEdit();
  const e = H.undo.pop(); if (!e) return toast('Nothing to undo');
  H.redo.push({ label: e.label, s: snapshot() }); restore(e.s); S.dirtyDoc = true; toast('Undo: ' + e.label); refreshAll();
}
function redo() {
  const e = H.redo.pop(); if (!e) return toast('Nothing to redo');
  H.undo.push({ label: e.label, s: snapshot() }); restore(e.s); S.dirtyDoc = true; toast('Redo: ' + e.label); refreshAll();
}

// ---------- refresh scheduling (UI modules register) ----------
const UI = { stage: null, timeline: null, panels: [] };
let _raf = 0, _panelsDirty = false;
function requestDraw() { if (!_raf) _raf = requestAnimationFrame(() => { _raf = 0; drawNow(); }); }
function drawNow() {
  UI.stage && UI.stage();
  UI.timeline && UI.timeline();
  if (_panelsDirty) { _panelsDirty = false; UI.panels.forEach((p) => p()); }
}
function refreshAll() { REV++; if (S.doc) buildRows(); _panelsDirty = true; requestDraw(); }

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  const host = $('#toasts'); if (!host) return;
  host.appendChild(t); setTimeout(() => t.classList.add('out'), 2200); setTimeout(() => t.remove(), 2700);
}
