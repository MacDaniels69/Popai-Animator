/* ===================== Popai Animator — scene evaluation & renderer (shared by preview and export) ===================== */

const CAM_D = 1500; // camera distance used for 2.5D depth (z) parallax

// pivot (ox, oy) is in the layer's content coordinates: rotation and scale happen around it
function layerLocalM(L, f) {
  const ox = L.p.ox || 0, oy = L.p.oy || 0;
  return M.chain(M.t(val(L, 'x', f) + ox, val(L, 'y', f) + oy), M.r(val(L, 'rot', f) * DEG), M.s(val(L, 'sx', f) * (L.flipH ? -1 : 1), val(L, 'sy', f) * (L.flipV ? -1 : 1)), M.t(-ox, -oy));
}
// which alternative a switch shows at frame f (+ the previous one, for crossfades)
function switchState(L, f) {
  const ch = L.ch.sw, first = L.children[0] && L.children[0].id;
  let cur = val(L, 'sw', f) || first, prev = null, t = 1;
  if (L.swMode === 'crossfade' && ch && ch.keys.length > 1) {
    let i = -1; for (let k = 0; k < ch.keys.length; k++) if (ch.keys[k].f <= f) i = k;
    if (i > 0) { const fade = Math.max(1, L.swFade || 4); t = (f - ch.keys[i].f + 1) / (fade + 1); if (t < 1 && ch.keys[i - 1].v !== cur) prev = ch.keys[i - 1].v; }
  }
  return { cur, prev, t: clamp(t, 0, 1) };
}

// ---------- bones ----------
function sortBones(B) { // parents before children
  const out = [], seen = new Set();
  const visit = (b) => {
    if (seen.has(b.id)) return; seen.add(b.id);
    const p = b.parent && B.bones.find((x) => x.id === b.parent);
    if (p) visit(p); else b.parent = null;
    out.push(b);
  };
  B.bones.forEach(visit); B.bones = out;
}
// Vitruvian bones: alternate bone constructions; only the active group (plus ungrouped bones) is live
function vitActive(B, f) { return B.vgroups && B.vgroups.length && f !== null ? val(B, 'vit', f) || B.vgroups[0] : null; }
// f === null -> rest (setup) pose, used for binding. Posed frames add the exploded-rig offset and physics.
// over: {boneId: angleDeg} (IK preview). noDyn: skip the physics simulation.
function boneFrames(B, f, over, noDyn) {
  const out = {}, vg = vitActive(B, f);
  const dyn = !actActive() && !noDyn && f !== null && B.bones.some((b) => b.dyn && b.dyn.on) ? simulateBones(B)[clamp(Math.round(f), 0, S.doc.end)] || {} : null;
  for (const b of B.bones) {
    let a = over && over[b.id] !== undefined ? over[b.id] : f === null ? b.a : val(B, 'bone:' + b.id + ':a', f);
    if (dyn && dyn[b.id] && !(over && over[b.id] !== undefined)) a += dyn[b.id];
    let pos = f === null ? [b.x, b.y] : val(B, 'bone:' + b.id + ':p', f);
    if (f !== null && (b.ox || b.oy)) pos = [pos[0] + (b.ox || 0), pos[1] + (b.oy || 0)];
    const s = f === null ? 1 : val(B, 'bone:' + b.id + ':s', f) ?? 1;
    const par = b.parent && out[b.parent];
    const PF = par ? par.F : M.I(), ps = par ? par.s : 1;
    const F = M.mul(PF, M.mul(M.t(pos[0] * ps, pos[1]), M.r(a * DEG)));
    out[b.id] = { F, s, len: b.len * s, b, off: !!(vg && b.vg && b.vg !== vg) };
  }
  return out;
}
function boneDeforms(B, f, over) {
  const rest = boneFrames(B, null), cur = boneFrames(B, f, over), D = {};
  for (const id in cur) D[id] = M.mul(M.mul(cur[id].F, M.s(cur[id].s, 1)), M.inv(rest[id].F));
  return { D, cur, rest };
}
// ---------- bone physics: deterministic spring dynamics with inertia, gravity and wind ----------
const _simCache = new Map();
function simulateBones(B) {
  const c = _simCache.get(B.id);
  if (c && c.doc === S.doc && c.rev === REV && c.end === S.doc.end) return c.res;
  const fps = S.doc.fps, N = S.doc.end + 1, dynB = B.bones.filter((b) => b.dyn && b.dyn.on), res = [], st = {};
  const fo = B.force || {}, g = fo.gravS || 0, ga = (fo.gravA ?? 90) * DEG, w = fo.windS || 0, wa = (fo.windA || 0) * DEG, turb = fo.turb || 0;
  for (let f = 0; f < N; f++) {
    const off = {};
    if (f > 0) {
      const fr = boneFrames(B, f, null, true), LW = evalLC(B, f).world;
      for (const b of dynB) {
        const F = M.mul(LW, fr[b.id].F), base = M.ap(F, 0, 0), tgt = Math.atan2(F[1], F[0]), L = Math.max(5, fr[b.id].len * M.scaleOf(LW));
        let s = st[b.id]; if (!s) s = st[b.id] = { ang: tgt, vel: 0, p1: base, p2: base };
        const acc = [(base[0] - 2 * s.p1[0] + s.p2[0]) * fps * fps, (base[1] - 2 * s.p1[1] + s.p2[1]) * fps * fps];
        const d = b.dyn, k = d.spring ?? 60, damp = d.damp ?? 11, inert = d.inertia ?? 0.6, n = 4, dt = 1 / fps / n, lever = L * 0.5;
        for (let i = 0; i < n; i++) {
          const t = (f + i / n) / fps, sn = Math.sin(s.ang), cs = Math.cos(s.ang), tang = (vx, vy) => -vx * sn + vy * cs;
          const ws = w * (1 + turb * vnoise(t * 1.7, b.id.length * 7 + 3));
          let aa = (-inert * tang(acc[0], acc[1]) + tang(Math.cos(ga) * g, Math.sin(ga) * g) + tang(Math.cos(wa) * ws, Math.sin(wa) * ws)) / lever;
          let diff = s.ang - tgt; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          if (d.lockTip) diff *= 2;
          aa += -k * diff - damp * s.vel;
          s.vel += aa * dt; s.ang += s.vel * dt;
        }
        s.p2 = s.p1; s.p1 = base;
        let diff = s.ang - tgt; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        off[b.id] = clamp(diff / DEG, -120, 120);
      }
    }
    res.push(off);
  }
  _simCache.set(B.id, { doc: S.doc, rev: REV, end: S.doc.end, res });
  return res;
}

// ---------- vector geometry ----------
// flexible binding: unbound points follow every bone whose strength region (set with Bone Strength) covers them
function flexSegs(B) {
  if (!B || !B.rest || B.layer.autoBind === false) return [];
  return B.layer.bones.filter((b) => b.str > 0 && B.rest[b.id]).map((b) => ({ id: b.id, s: b.str, a: M.ap(B.rest[b.id].F, 0, 0), b: M.ap(B.rest[b.id].F, b.len, 0) }));
}
function flexWeights(segs, p) {
  const out = [];
  for (const g of segs) {
    const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], l2 = dx * dx + dy * dy || 1e-9, t = clamp(((p[0] - g.a[0]) * dx + (p[1] - g.a[1]) * dy) / l2, 0, 1);
    const d = Math.hypot(p[0] - (g.a[0] + t * dx), p[1] - (g.a[1] + t * dy));
    if (d < g.s) { const w = (1 - d / g.s) ** 2; if (w > 1e-4) out.push([g.id, w]); }
  }
  return out;
}
// Which bones move a point (Moho model): a whole-layer bone attachment overrides everything; an explicit
// point binding (pt.b, normally one bone) wins next; pt.b = [] means the point was released (no bone moves it);
// otherwise the point is flexi-bound to every eligible bone, unless the layer's flexi-binding is off (L.flexi === false)
// or restricted to chosen bones (L.flexiBones).
function layerFlexSegs(L, B) { if (!B || L.flexi === false) return []; const s = flexSegs(B); return Array.isArray(L.flexiBones) ? s.filter((g) => L.flexiBones.includes(g.id)) : s; }
function pointBoneWeights(L, pt, B, relPts, segs) {
  if (!B || L.bindBone) return null;
  if (Array.isArray(pt.b)) return pt.b.length ? pt.b : null;
  return segs.length ? flexWeights(segs, M.ap(relPts, pt.x, pt.y)) : null;
}
function deformedPts(L, f, lc) {
  const out = {};
  const B = lc && lc.B;
  const relInv = B ? M.inv(lc.relPts) : null;
  const segs = B && !lc.bound ? layerFlexSegs(L, B) : [];
  for (const id in L.pts) {
    let v = val(L, 'pt:' + id, f);
    const pt = L.pts[id];
    const ws_ = B ? pointBoneWeights(L, pt, B, lc.relPts, segs) : null;
    if (ws_ && ws_.length) {
      const p = M.ap(lc.relPts, v[0], v[1]);
      let x = 0, y = 0, ws = 0;
      for (const [bid, w] of ws_) {
        const D = B.D[bid]; if (!D) continue;
        const q = M.ap(D, p[0], p[1]); x += q[0] * w; y += q[1] * w; ws += w;
      }
      if (ws > 0) v = M.ap(relInv, x / ws, y / ws);
    }
    out[id] = v;
  }
  return out;
}
function tracePath(ctx, L, path, P) {
  const ids = path.pts.filter((id) => P[id]); const n = ids.length;
  if (n < 2) return;
  const closed = path.closed && n > 2;
  const get = (i) => P[ids[closed ? (i + n) % n : clamp(i, 0, n - 1)]];
  const cv = (i) => { const p = L.pts[ids[closed ? (i + n) % n : clamp(i, 0, n - 1)]]; return p && p.c !== undefined ? p.c : 1; };
  const p0 = get(0); ctx.moveTo(p0[0], p0[1]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = get(i - 1), b = get(i), c = get(i + 1), d = get(i + 2);
    const k1 = cv(i) / 6, k2 = cv(i + 1) / 6;
    if (k1 === 0 && k2 === 0) { ctx.lineTo(c[0], c[1]); continue; }
    ctx.bezierCurveTo(b[0] + (c[0] - a[0]) * k1, b[1] + (c[1] - a[1]) * k1, c[0] - (d[0] - b[0]) * k2, c[1] - (d[1] - b[1]) * k2, c[0], c[1]);
  }
  if (closed) ctx.closePath();
}
// Moho style model: a shape may apply two named styles (Style 1, Style 2 — Style 2 wins where both define a property).
// A style supplies only the properties it defines (older styles without a 'defines' list supply everything), and a
// shape's local override keeps its own value for that property.
const STYLE_PROPS = ['fill', 'stroke', 'width', 'fillOn', 'strokeOn'];
function styleDefines(st, p) { return !!st && (!st.defines || !!st.defines[p]); }
function shapeStyle(L, sh, f) {
  const own = { fill: val(L, 'sh:' + sh.id + ':fill', f), stroke: val(L, 'sh:' + sh.id + ':stroke', f), width: val(L, 'sh:' + sh.id + ':width', f), fillOn: sh.fillOn, strokeOn: sh.strokeOn };
  const s1 = sh.styleId && S.doc.styles.find((s) => s.id === sh.styleId), s2 = sh.style2Id && S.doc.styles.find((s) => s.id === sh.style2Id);
  if (!s1 && !s2) return own;
  const out = {};
  for (const p of STYLE_PROPS) out[p] = sh.over && sh.over[p] ? own[p] : styleDefines(s2, p) ? s2[p] : styleDefines(s1, p) ? s1[p] : own[p];
  out.from = [s1, s2].filter(Boolean).map((s) => s.name).join(' + ');
  return out;
}

// ---------- camera ----------
function camFn(f) {
  const c = S.doc.camera;
  const x = val(c, 'x', f), y = val(c, 'y', f), zoom = val(c, 'zoom', f), roll = val(c, 'roll', f);
  const sh = val(c, 'shake', f), fr = val(c, 'shakeFreq', f);
  const t = (f / S.doc.fps) * fr;
  const sx = sh ? sh * vnoise(t, 1) : 0, sy = sh ? sh * vnoise(t, 2) : 0, sr = sh ? sh * 0.05 * vnoise(t, 3) : 0;
  const cache = {};
  return (z = 0) => {
    if (cache[z]) return cache[z];
    const s = (zoom * CAM_D) / Math.max(60, CAM_D - z);
    return (cache[z] = M.chain(M.r(-(roll + sr) * DEG), M.s(s), M.t(-(x + sx), -(y + sy))));
  };
}

// ---------- offscreen pool ----------
const Pool = {
  list: [],
  get(w, h) {
    const c = this.list.pop() || document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const x = c.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none';
    x.imageSmoothingEnabled = true; x.clearRect(0, 0, w, h);
    return c;
  },
  put(...cs) { for (const c of cs) if (c && this.list.length < 24) this.list.push(c); },
};
function tmpCopy(src) { const c = Pool.get(src.width, src.height); c.getContext('2d').drawImage(src, 0, 0); return c; }
function colorized(src, color) {
  const c = tmpCopy(src), x = c.getContext('2d');
  x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}
function blurred(src, r) {
  const c = Pool.get(src.width, src.height), x = c.getContext('2d');
  x.filter = r > 0.2 ? `blur(${r}px)` : 'none'; x.drawImage(src, 0, 0); x.filter = 'none';
  return c;
}

// ---------- effects catalogue (Core set + a few Expansion) ----------
// params: name: [default, min, max, step] or ['#color'] or [bool]
const FX = {
  blur: { label: 'Gaussian blur', params: { radius: [8, 0, 200, 0.5] },
    apply(c, p, sc) { if (p.radius <= 0) return; const b = blurred(c, p.radius * sc), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.drawImage(b, 0, 0); Pool.put(b); } },
  glow: { label: 'Glow / bloom', params: { radius: [18, 0, 300, 0.5], intensity: [1.5, 0, 6, 0.05], color: ['#ffd27a'] },
    apply(c, p, sc) {
      const g = colorized(c, p.color), b = blurred(g, p.radius * sc), x = c.getContext('2d');
      x.globalCompositeOperation = 'destination-over'; let k = p.intensity; // glow sits behind the artwork so colors stay true
      while (k > 0.001) { x.globalAlpha = Math.min(1, k); x.drawImage(b, 0, 0); k -= 1; }
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; Pool.put(g, b);
    } },
  shadow: { label: 'Drop shadow', params: { dx: [10, -500, 500, 0.5], dy: [12, -500, 500, 0.5], softness: [12, 0, 200, 0.5], color: ['#000000'], opacity: [0.45, 0, 1, 0.01] },
    apply(c, p, sc) {
      const g = colorized(c, p.color), b = blurred(g, p.softness * sc), x = c.getContext('2d');
      x.globalCompositeOperation = 'destination-over'; x.globalAlpha = p.opacity; x.drawImage(b, p.dx * sc, p.dy * sc);
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; Pool.put(g, b);
    } },
  outline: { label: 'Outline', params: { width: [4, 0, 100, 0.5], color: ['#111111'] },
    apply(c, p, sc) {
      const w = p.width * sc; if (w <= 0) return;
      const g = colorized(c, p.color), x = c.getContext('2d'); x.globalCompositeOperation = 'destination-over';
      const n = Math.min(32, Math.max(12, Math.round(w * 2)));
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; x.drawImage(g, Math.cos(a) * w, Math.sin(a) * w); }
      x.globalCompositeOperation = 'source-over'; Pool.put(g);
    } },
  color: { label: 'Color correction', params: { brightness: [1, 0, 3, 0.01], contrast: [1, 0, 3, 0.01], saturation: [1, 0, 3, 0.01], hue: [0, -180, 180, 1] },
    apply(c, p) {
      const t = tmpCopy(c), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
      x.filter = `brightness(${p.brightness}) contrast(${p.contrast}) saturate(${p.saturation}) hue-rotate(${p.hue}deg)`;
      x.drawImage(t, 0, 0); x.filter = 'none'; Pool.put(t);
    } },
  tint: { label: 'Colorize', params: { color: ['#3a86ff'], amount: [0.5, 0, 1, 0.01] },
    apply(c, p) { const x = c.getContext('2d'); x.globalCompositeOperation = 'source-atop'; x.globalAlpha = p.amount; x.fillStyle = p.color; x.fillRect(0, 0, c.width, c.height); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; } },
  noise: { label: 'Noise / grain', params: { amount: [0.25, 0, 1, 0.01], size: [2, 1, 40, 0.5], animated: [true], seed: [1, 0, 9999, 1] },
    apply(c, p, sc, R, L) {
      const cell = Math.max(1, p.size * sc * 0.5), w = Math.ceil(c.width / cell), h = Math.ceil(c.height / cell);
      if (w * h > 600000) throw new Error("Noise exceeds preview/render budget; increase grain size");
      const n = Pool.get(w, h), nx = n.getContext('2d'), img = nx.createImageData(w, h);
      const rnd = mulberry32((p.seed | 0) * 7919 + (p.animated ? actProceduralFrame(L, R.f) * 104729 : 0));
      for (let i = 0; i < img.data.length; i += 4) { const v = rnd() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      nx.putImageData(img, 0, 0);
      const a = tmpCopy(c), x = c.getContext('2d');
      x.imageSmoothingEnabled = false; x.globalCompositeOperation = 'overlay'; x.globalAlpha = p.amount; x.drawImage(n, 0, 0, w * cell, h * cell);
      x.globalAlpha = 1; x.globalCompositeOperation = 'destination-in'; x.drawImage(a, 0, 0);
      x.globalCompositeOperation = 'source-over'; x.imageSmoothingEnabled = true; Pool.put(a, n);
    } },
  pixelate: { label: 'Pixelate / mosaic', params: { size: [12, 1, 200, 1] },
    apply(c, p, sc) {
      const s = Math.max(1, p.size * sc); if (s <= 1.01) return;
      const w = Math.max(1, Math.round(c.width / s)), h = Math.max(1, Math.round(c.height / s));
      const t = Pool.get(w, h); t.getContext('2d').drawImage(c, 0, 0, w, h);
      const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); x.imageSmoothingEnabled = false; x.drawImage(t, 0, 0, c.width, c.height); x.imageSmoothingEnabled = true; Pool.put(t);
    } },
  streak: { label: 'Directional blur', params: { angle: [0, -180, 180, 1], length: [30, 0, 500, 1], samples: [10, 2, 40, 1] },
    apply(c, p, sc) {
      const t = tmpCopy(c), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
      const n = Math.round(p.samples), L = p.length * sc, a = p.angle * DEG;
      for (let i = 0; i < n; i++) { const k = i / (n - 1) - 0.5; x.globalAlpha = 1 / n * 1.6; x.drawImage(t, Math.cos(a) * L * k, Math.sin(a) * L * k); }
      x.globalAlpha = 1; Pool.put(t);
    } },
  trail: { label: 'Motion trail / echo', params: { samples: [6, 1, 30, 1], spacing: [2, 1, 20, 1], decay: [0.65, 0.05, 1, 0.01] },
    apply(c, p, sc, R, L) {
      if (R.noTrail || (actActive() && !actHasAnimation(L))) return;
      const x = c.getContext('2d'), t = Pool.get(c.width, c.height);
      for (let i = Math.round(p.samples); i >= 1; i--) {
        const ff = R.f - i * Math.round(p.spacing); if (ff < 0) continue;
        const tx = t.getContext('2d'); tx.setTransform(1, 0, 0, 1, 0, 0); tx.clearRect(0, 0, t.width, t.height);
        renderScene(tx, ff, R.view, { only: L.id, noTrail: true, export: R.export });
        x.globalCompositeOperation = 'destination-over'; x.globalAlpha = Math.pow(p.decay, i); x.drawImage(t, 0, 0);
      }
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; Pool.put(t);
    } },
  chroma: { label: 'Chromatic aberration', params: { offset: [4, 0, 80, 0.5], angle: [0, -180, 180, 1] },
    apply(c, p, sc) {
      const o = p.offset * sc, a = p.angle * DEG, dx = Math.cos(a) * o, dy = Math.sin(a) * o;
      const ch = (col) => { const t = tmpCopy(c), x = t.getContext('2d'); x.globalCompositeOperation = 'multiply'; x.fillStyle = col; x.fillRect(0, 0, t.width, t.height); x.globalCompositeOperation = 'destination-in'; x.drawImage(c, 0, 0); return t; };
      const r = ch('#ff0000'), g = ch('#00ff00'), b = ch('#0000ff'), x = c.getContext('2d');
      x.clearRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'lighter';
      x.drawImage(r, -dx, -dy); x.drawImage(g, 0, 0); x.drawImage(b, dx, dy); x.globalCompositeOperation = 'source-over'; Pool.put(r, g, b);
    } },
};
function fxDefaults(type) { const p = {}; for (const [k, d] of Object.entries(FX[type].params)) p[k] = d[0]; return p; }
function fxParamsAt(L, e, f) { const p = {}; for (const k in e.p) p[k] = val(L, 'fx:' + e.id + ':' + k, f); return p; }

// ---------- scene rendering ----------
function renderScene(ctx, f, view, opts = {}) {
  const R = {
    f, actionFrame:f, view, cam: opts.workspace ? stageCamFn(f) : camFn(f), cameraState: opts.workspace ? cameraWorkspaceState(f) : cameraStateAt(f), rec: opts.rec || null, export: !!opts.export, W: ctx.canvas.width, H: ctx.canvas.height,
    only: opts.only || null, onlyAnc: opts.only ? new Set(ancestors(opts.only).map((a) => a.id)) : null, noTrail: !!opts.noTrail, swo: opts.swOverride || null,
  };
  drawList(ctx, S.doc.layers, R, { base: M.I(), rel: M.I(), z: 0, B: null, inOnly: false });
  return R;
}
function drawList(ctx, list, R, pc) { for (let i = list.length - 1; i >= 0; i--) drawLayer(ctx, list[i], R, pc); }

function layerCtx(L, f, pc) {
  const local = layerLocalM(L, f);
  const relPts = M.mul(pc.rel, local);
  let rel = relPts;
  if (L.bindBone && pc.B && pc.B.D[L.bindBone]) rel = M.mul(pc.B.D[L.bindBone], relPts);
  return { L, base: pc.base, relParent: pc.rel, relPts, rel, world: M.mul(pc.base, rel), z: pc.z + (val(L, 'z', f) || 0), B: pc.B, bound: !!(pc.B && (pc.bound || L.bindBone)) };
}

function drawLayer(ctx, L, R, pc) {
  if (S.doc.activeAction) R = { ...R, f:actPreviewFrame(L, R.actionFrame ?? R.f) };
  if (!L.vis || val(L, 'visible', R.f) === false || (R.export && !L.render)) return;
  const inOnly = pc.inOnly || R.only === L.id;
  const isAnc = R.only && !inOnly;
  if (isAnc && !R.onlyAnc.has(L.id)) return;
  if (L.bindBone && pc.B && pc.B.cur && pc.B.cur[L.bindBone] && pc.B.cur[L.bindBone].off) return; // attached to an inactive Vitruvian bone
  const lc = layerCtx(L, R.f, pc);
  lc.inOnly = inOnly;
  lc.full = cameraFullMatrix(R, L, lc);
  if (R.rec && !isAnc) R.rec.push(lc);
  const op = isAnc ? 1 : val(L, 'opacity', R.f);
  if (op <= 0.001) return;
  const fxOn = !isAnc && L.fx.some((e) => e.on);
  const dofRadius = isAnc ? 0 : cameraDofRadius(R, L, lc);
  const needOff = !isAnc && (dofRadius > 0.1 || fxOn || L.blend !== 'source-over' || (isContainer(L) && op < 0.999) || (L.type === 'group' && (L.mask === 'bottom' || L.mask === 'invert')));
  if (!needOff) { const ga = ctx.globalAlpha; ctx.globalAlpha = ga * op; drawContent(ctx, L, R, lc); ctx.globalAlpha = ga; return; }
  const off = Pool.get(R.W, R.H), octx = off.getContext('2d');
  drawContent(octx, L, R, lc);
  octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalAlpha = 1; octx.globalCompositeOperation = 'source-over';
  const sc = M.scaleOf(M.mul(R.view, R.cam(lc.z)));
  for (const e of L.fx) if (e.on && FX[e.type]) { try { FX[e.type].apply(off, fxParamsAt(L, e, R.f), sc, R, L, lc); } catch (err) { if (R.export) throw new Error('Effect ' + e.type + ' on ' + L.name + ': ' + err.message); console.warn('fx', err); } octx.setTransform(1, 0, 0, 1, 0, 0); octx.globalAlpha = 1; octx.globalCompositeOperation = 'source-over'; octx.filter = 'none'; }
  if (dofRadius > 0.1) { const b = blurred(off, dofRadius); octx.clearRect(0, 0, off.width, off.height); octx.drawImage(b, 0, 0); Pool.put(b); }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= op; ctx.globalCompositeOperation = L.blend || 'source-over';
  ctx.drawImage(off, 0, 0); ctx.restore();
  Pool.put(off);
}

function drawContent(ctx, L, R, lc) {
  const full = lc.full;
  switch (L.type) {
    case 'vector': {
      const P = (lc.P = deformedPts(L, R.f, lc));
      M.set(ctx, full);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const sh of L.shapes) {
        const st = shapeStyle(L, sh, R.f);
        ctx.beginPath();
        for (const pid of sh.paths) { const path = L.paths.find((p) => p.id === pid); if (path) tracePath(ctx, L, path, P); }
        if (st.fillOn) { ctx.fillStyle = st.fill; ctx.fill('evenodd'); }
        if (st.strokeOn && st.width > 0) { ctx.lineWidth = st.width; ctx.strokeStyle = st.stroke; ctx.stroke(); }
      }
      break;
    }
    case 'image': {
      const m = S.media[L.media];
      if (m && m.el && m.el.complete !== false) { M.set(ctx, full); ctx.drawImage(m.el, -L.iw / 2, -L.ih / 2, L.iw, L.ih); }
      break;
    }
    case 'text': {
      M.set(ctx, full);
      ctx.fillStyle = val(L, 'color', R.f); ctx.font = `${L.bold ? '700 ' : ''}${L.size}px ${L.font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lines = String(L.text).split('\n'), lh = L.size * 1.15;
      lines.forEach((ln, i) => ctx.fillText(ln, 0, (i - (lines.length - 1) / 2) * lh));
      break;
    }
    case 'particle': drawParticles(ctx, L, R, lc); break;
    case 'group': case 'switch': case 'bone': {
      // A Bone layer with “Allow nested layer control” off only deforms its direct children.
      let cpc = { base: lc.base, rel: lc.rel, z: lc.z, B: L.type === 'group' && lc.B && lc.B.layer.nested === false ? null : lc.B, inOnly: lc.inOnly, bound: lc.bound };
      if (L.type === 'bone') {
        const bd = boneDeforms(L, R.f);
        lc.bones = bd;
        cpc = { base: lc.world, rel: M.I(), z: lc.z, B: { layer: L, D: bd.D, cur: bd.cur, rest: bd.rest }, inOnly: lc.inOnly, bound: false };
      }
      if (L.type === 'switch') {
        const st = switchState(L, R.f), over = !R.export && R.swo && R.swo[L.id];
        const c = L.children.find((c) => c.id === (over || st.cur)) || L.children[0];
        lc.activeChild = c && c.id;
        const pc0 = !over && st.prev && L.children.find((x) => x.id === st.prev);
        if (pc0) { const ga = ctx.globalAlpha; ctx.globalAlpha = ga * (1 - st.t); drawLayer(ctx, pc0, R, cpc); ctx.globalAlpha = ga * st.t; if (c) drawLayer(ctx, c, R, cpc); ctx.globalAlpha = ga; }
        else if (c) drawLayer(ctx, c, R, cpc);
      } else if (L.type === 'group' && (L.mask === 'bottom' || L.mask === 'invert') && L.children.length > 1 && !R.only) {
        const kids = L.children, mL = kids[kids.length - 1];
        const mc = Pool.get(R.W, R.H), cc = Pool.get(R.W, R.H);
        drawLayer(mc.getContext('2d'), mL, R, cpc);
        const cx = cc.getContext('2d');
        for (let i = kids.length - 2; i >= 0; i--) drawLayer(cx, kids[i], R, cpc);
        cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = L.mask === 'invert' ? 'destination-out' : 'destination-in';
        cx.drawImage(mc, 0, 0); cx.globalCompositeOperation = 'source-over';
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(cc, 0, 0); ctx.restore();
        Pool.put(mc, cc);
      } else drawList(ctx, L.children, R, cpc);
      break;
    }
  }
}

// ---------- particles (analytic & deterministic: same frame + seed => same result) ----------
function particleList(L, f, lc) {
  f = actProceduralFrame(L, f);
  const fps = S.doc.fps, p = (k) => val(L, k, f);
  const life = Math.max(0.05, p('life')), out = [];
  const births = [];
  if (L.mode === 'burst') { for (let i = 0; i < L.burst; i++) births.push([i, L.startF + hash1(i, L.seed + 5) * 1.5]); }
  else {
    const step = fps / Math.max(0.01, p('rate'));
    const from = Math.max(L.startF, f - life * 1.3 * fps), to = Math.min(f, L.endF);
    const i0 = Math.max(0, Math.ceil((from - L.startF) / step)), i1 = Math.floor((to - L.startF) / step);
    for (let i = i0; i <= i1 && births.length < 3000; i++) births.push([i, L.startF + i * step]);
  }
  const relCache = new Map();
  const relAt = (bf) => {
    const k = Math.round(bf);
    if (relCache.has(k)) return relCache.get(k);
    let m = layerLocalM(L, k);
    if (L.bindBone && lc.B) { const D = boneDeforms(lc.B.layer, k).D[L.bindBone]; if (D) m = M.mul(D, m); }
    relCache.set(k, m); return m;
  };
  const g = p('gravity'), wind = p('wind'), drag = p('drag');
  for (const [i, bf] of births) {
    const r = (k) => hash1(i * 13 + k, L.seed);
    const age = (f - bf) / fps, pl = life * (0.7 + 0.6 * r(1));
    if (age < 0 || age > pl) continue;
    const t = age / pl;
    const ang = (p('angle') + (r(2) - 0.5) * p('spread')) * DEG, sp = p('speed') * (1 - p('speedVar') * r(3));
    let ox = 0, oy = 0;
    const er = p('emitR');
    if (L.emit === 'circle') { const a = r(4) * Math.PI * 2, rr = Math.sqrt(r(5)) * er; ox = Math.cos(a) * rr; oy = Math.sin(a) * rr; }
    else if (L.emit === 'line') ox = (r(4) - 0.5) * 2 * er;
    const em = M.ap(relAt(bf), ox, oy);
    const k = drag > 0 ? (1 - Math.exp(-drag * age)) / drag : age;
    const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;
    out.push({
      x: em[0] + vx * k + 0.5 * wind * age * age, y: em[1] + vy * k + 0.5 * g * age * age,
      vx: vx * Math.exp(-drag * age) + wind * age, vy: vy * Math.exp(-drag * age) + g * age,
      size: lerp(p('size0'), p('size1'), t) * (0.7 + 0.6 * r(6)), a: lerp(p('alpha0'), p('alpha1'), t),
      col: mixColor(p('color0'), p('color1'), t), rot: r(7) * 360 + p('spin') * age * (r(8) - 0.5) * 2,
    });
  }
  return out;
}
function drawParticles(ctx, L, R, lc) {
  const list = particleList(L, R.f, lc);
  const m = M.chain(R.view, R.cam(lc.z), lc.base, lc.relParent);
  const ga = ctx.globalAlpha;
  for (const q of list) {
    if (q.a <= 0.003 || q.size <= 0) continue;
    ctx.globalAlpha = ga * clamp(q.a, 0, 1);
    M.set(ctx, M.mul(m, M.t(q.x, q.y)));
    const s = q.size / 2;
    if (L.shape === 'soft') {
      const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
      gr.addColorStop(0, q.col); gr.addColorStop(1, rgba(q.col, 0));
      ctx.fillStyle = gr; ctx.fillRect(-s, -s, s * 2, s * 2);
    } else if (L.shape === 'streak') {
      const sp = Math.hypot(q.vx, q.vy) || 1;
      ctx.strokeStyle = q.col; ctx.lineWidth = Math.max(1, q.size / 6); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo((-q.vx / sp) * q.size * 2, (-q.vy / sp) * q.size * 2); ctx.stroke();
    } else if (L.shape === 'square') {
      ctx.rotate(q.rot * DEG); ctx.fillStyle = q.col; ctx.fillRect(-s, -s, s * 2, s * 2);
    } else if (L.shape === 'star') {
      ctx.rotate(q.rot * DEG); ctx.fillStyle = q.col; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const rr = i % 2 ? s * 0.42 : s, a = (i / 10) * Math.PI * 2 - Math.PI / 2; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.fill();
    } else { ctx.fillStyle = q.col; ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = ga;
}
const PARTICLE_PRESETS = {
  Dust: { mode: 'burst', burst: 70, shape: 'soft', emit: 'line', p: { life: 1.3, speed: 260, speedVar: 0.6, spread: 160, angle: -90, gravity: 120, wind: 0, drag: 2.2, size0: 26, size1: 90, alpha0: 0.85, alpha1: 0, color0: '#a08566', color1: '#e8ddcf', emitR: 70, spin: 60 } },
  Fire: { mode: 'continuous', shape: 'soft', emit: 'circle', p: { rate: 60, life: 0.9, speed: 160, speedVar: 0.5, spread: 30, angle: -90, gravity: -120, wind: 0, drag: 0.8, size0: 40, size1: 6, alpha0: 0.95, alpha1: 0, color0: '#ffdd55', color1: '#e2361b', emitR: 18, spin: 0 } },
  Smoke: { mode: 'continuous', shape: 'soft', emit: 'circle', p: { rate: 18, life: 3, speed: 70, speedVar: 0.5, spread: 40, angle: -90, gravity: -20, wind: 30, drag: 0.4, size0: 30, size1: 140, alpha0: 0.45, alpha1: 0, color0: '#777777', color1: '#cccccc', emitR: 16, spin: 30 } },
  Sparks: { mode: 'burst', burst: 60, shape: 'streak', emit: 'circle', p: { life: 0.8, speed: 600, speedVar: 0.7, spread: 360, angle: 0, gravity: 900, wind: 0, drag: 1.2, size0: 16, size1: 4, alpha0: 1, alpha1: 0, color0: '#fff4b0', color1: '#ff7a1a', emitR: 4, spin: 0 } },
  Snow: { mode: 'continuous', shape: 'circle', emit: 'line', p: { rate: 40, life: 6, speed: 60, speedVar: 0.6, spread: 30, angle: 90, gravity: 10, wind: 25, drag: 0.2, size0: 7, size1: 7, alpha0: 0.95, alpha1: 0.7, color0: '#ffffff', color1: '#e6f0ff', emitR: 800, spin: 0 } },
  Rain: { mode: 'continuous', shape: 'streak', emit: 'line', p: { rate: 160, life: 1.2, speed: 900, speedVar: 0.2, spread: 4, angle: 100, gravity: 400, wind: 0, drag: 0, size0: 14, size1: 14, alpha0: 0.6, alpha1: 0.5, color0: '#a9c7ff', color1: '#a9c7ff', emitR: 900, spin: 0 } },
  Magic: { mode: 'continuous', shape: 'star', emit: 'circle', p: { rate: 40, life: 1.4, speed: 90, speedVar: 0.6, spread: 360, angle: 0, gravity: -40, wind: 0, drag: 0.8, size0: 18, size1: 2, alpha0: 1, alpha1: 0, color0: '#fff3a8', color1: '#b26bff', emitR: 30, spin: 220 } },
};
function applyParticlePreset(L, name) {
  const pr = PARTICLE_PRESETS[name]; if (!pr) return;
  L.mode = pr.mode; L.shape = pr.shape; L.emit = pr.emit; if (pr.burst) L.burst = pr.burst;
  for (const [k, v] of Object.entries(pr.p)) { L.p[k] = v; delete L.ch[k]; }
  L.preset = name;
}

// ---------- hit testing on recorded render ----------
const _hitCtx = document.createElement('canvas').getContext('2d');
function hitLayerEntry(e, sx, sy, tol = 6) {
  const L = e.L, x = _hitCtx;
  if (L.type === 'vector' && e.P) {
    M.set(x, e.full);
    for (let i = L.shapes.length - 1; i >= 0; i--) {
      const sh = L.shapes[i], st = shapeStyle(L, sh, S.frame);
      const p = new Path2D();
      for (const pid of sh.paths) { const path = L.paths.find((q) => q.id === pid); if (path) tracePath(p, L, path, e.P, S.frame, e); }
      if (st.fillOn && x.isPointInPath(p, sx, sy, 'evenodd')) return { shape: sh };
      x.lineWidth = Math.max(st.strokeOn ? st.width : 0, tol / M.scaleOf(e.full));
      if (x.isPointInStroke(p, sx, sy)) return { shape: sh };
    }
    return null;
  }
  const inv = M.inv(e.full), q = M.ap(inv, sx, sy);
  if (L.type === 'image') return Math.abs(q[0]) <= L.iw / 2 && Math.abs(q[1]) <= L.ih / 2 ? {} : null;
  if (L.type === 'text') {
    const lines = String(L.text).split('\n'); x.setTransform(1, 0, 0, 1, 0, 0); x.font = `${L.bold ? '700 ' : ''}${L.size}px ${L.font}`;
    const w = Math.max(...lines.map((l) => x.measureText(l).width)), h = lines.length * L.size * 1.15;
    return Math.abs(q[0]) <= w / 2 && Math.abs(q[1]) <= h / 2 ? {} : null;
  }
  if (L.type === 'particle') return Math.hypot(q[0], q[1]) <= Math.max(30, val(L, 'emitR', S.frame)) ? {} : null;
  return null;
}
