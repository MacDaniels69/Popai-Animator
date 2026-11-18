/* ===================== Popai Animator — stage view, overlays and tools ===================== */

const Stage = { cv: null, ctx: null, dpr: 1, rec: [], drag: null, mouse: [0, 0], hover: null, pen: null, preview: null, space: false };

function viewM() {
  const c = Stage.cv, z = S.view.zoom * Stage.dpr;
  return M.chain(M.t(c.width / 2 + S.view.panX * Stage.dpr, c.height / 2 + S.view.panY * Stage.dpr), M.r(S.view.rot || 0), M.s(z));
}
// evaluate a layer's transform context at frame f without rendering
function evalLC(L, f) {
  const chain = ancestors(L.id).reverse().concat([L]);
  let pc = { base: M.I(), rel: M.I(), z: 0, B: null }, lc = null;
  for (const A of chain) {
    lc = layerCtx(A, f, pc);
    if (A === L) break;
    if (A.type === 'bone') { const bd = boneDeforms(A, f); pc = { base: lc.world, rel: M.I(), z: lc.z, B: { layer: A, D: bd.D, cur: bd.cur, rest: bd.rest }, bound: false }; }
    else pc = { base: lc.base, rel: lc.rel, z: lc.z, B: A.type === 'group' && lc.B && lc.B.layer.nested === false ? null : lc.B, bound: lc.bound };
  }
  return lc;
}
function lcOf(L) {
  const e = Stage.rec.find((r) => r.L === L);
  if (e) return e;
  const lc = evalLC(L, S.frame);
  lc.full = cameraFullMatrix({view:viewM(),cam:stageCamFn(S.frame),cameraState:cameraWorkspaceState(S.frame)}, L, lc);
  if (L.type === 'vector') lc.P = deformedPts(L, S.frame, lc);
  if (L.type === 'bone') lc.bones = boneDeforms(L, S.frame);
  return lc;
}
function parentFull(L) { const lc = lcOf(L); return M.chain(cameraLayerProjection({view:viewM(),cam:stageCamFn(S.frame),cameraState:cameraWorkspaceState(S.frame)},L,lc),lc.base,lc.relParent); }
function toLocal(L, sx, sy) { return M.ap(M.inv(lcOf(L).full), sx, sy); }

// switches show the alternative being edited/previewed on stage (never in export, never keyed)
function switchOverrides() {
  const o = { ...S.swPreview }, L = selLayer();
  if (L) { let child = L; for (const A of ancestors(L.id)) { if (A.type === 'switch' && !(A.id in S.swPreview)) o[A.id] = child.id; child = A; } }
  return o;
}
function editingInactiveAlt() {
  const L = selLayer(); if (!L) return null;
  let child = L;
  for (const A of ancestors(L.id)) { if (A.type === 'switch') { const st = switchState(A, S.frame); if (st.cur !== child.id) return { sw: A, child }; } child = A; }
  return null;
}
// ---------- stage rendering ----------
function renderStage() {
  const cv = Stage.cv, ctx = Stage.ctx, r = cv.getBoundingClientRect();
  const dpr = (Stage.dpr = Math.min(2, window.devicePixelRatio || 1) * (S.playing && S.fastPlay && (window.devicePixelRatio || 1) > 1 ? 0.5 : 1));
  const W = Math.max(10, Math.round(r.width * dpr)), Hh = Math.max(10, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
  const d = S.doc, V = viewM();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#2b2e35'; ctx.fillRect(0, 0, W, Hh);
  // frame background + shadow
  M.set(ctx, V); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 24 * dpr;
  ctx.fillStyle = d.bg; ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h); ctx.shadowBlur = 0;
  // onion skins
  const sel = selLayer();
  if (S.onion && sel && !S.playing) {
    for (let k = S.onionN; k >= 1; k--) for (const dir of [-1, 1]) {
      const f = S.frame + dir * k; if (f < 0 || f > d.end) continue;
      const off = Pool.get(W, Hh), ox = off.getContext('2d');
      renderScene(ox, f, V, { only: sel.id, swOverride: switchOverrides(), workspace:true });
      ox.setTransform(1, 0, 0, 1, 0, 0); ox.globalCompositeOperation = 'source-atop';
      ox.fillStyle = dir < 0 ? '#ff4d6d' : '#38d39f'; ox.globalAlpha = 0.55; ox.fillRect(0, 0, W, Hh);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.32 / k; ctx.drawImage(off, 0, 0); ctx.globalAlpha = 1; Pool.put(off);
    }
  }
  Stage.rec = [];
  renderScene(ctx, S.frame, V, { rec: Stage.rec, export: S.outputOnly, swOverride: switchOverrides(), workspace:!S.outputOnly });
  // switch alignment overlay: every alternative ghosted over its registration point
  const SWa = S.alignOverlay && !S.outputOnly && typeof switchTarget === 'function' && switchTarget();
  if (SWa) {
    for (const c of SWa.children) {
      const off = Pool.get(W, Hh);
      renderScene(off.getContext('2d'), S.frame, V, { only: c.id, swOverride: { [SWa.id]: c.id }, workspace:true });
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.25; ctx.drawImage(off, 0, 0); ctx.globalAlpha = 1; Pool.put(off);
    }
    const o = M.ap(lcOf(SWa).full, SWa.p.ox || 0, SWa.p.oy || 0);
    ctx.strokeStyle = '#ff3bd4'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.moveTo(o[0] - 30 * dpr, o[1]); ctx.lineTo(o[0] + 30 * dpr, o[1]); ctx.moveTo(o[0], o[1] - 30 * dpr); ctx.lineTo(o[0], o[1] + 30 * dpr); ctx.stroke();
  }
  // dim outside the camera frame
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const c0 = M.ap(V, -d.w / 2, -d.h / 2), c1 = M.ap(V, d.w / 2, d.h / 2);
  if (CAMERA_VIEW.mode === 'camera' || S.outputOnly) {
  ctx.fillStyle = 'rgba(28,30,36,.62)';
  ctx.beginPath(); ctx.rect(0, 0, W, Hh); ctx.rect(c0[0], c0[1], c1[0] - c0[0], c1[1] - c0[1]); ctx.fill('evenodd');
  ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; ctx.strokeRect(c0[0] + 0.5, c0[1] + 0.5, c1[0] - c0[0], c1[1] - c0[1]);
  }
  if (!S.outputOnly) drawOverlays(ctx);
  if (S.mode === 'setup' && CAMERA_VIEW.mode === 'camera') {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 3 * dpr;
    ctx.strokeRect(c0[0] - 2 * dpr, c0[1] - 2 * dpr, c1[0] - c0[0] + 4 * dpr, c1[1] - c0[1] + 4 * dpr);
    ctx.fillStyle = '#ff8a3d'; ctx.font = `600 ${11 * dpr}px Inter, system-ui, sans-serif`; ctx.fillText('SETUP · rest pose — bones, binding and pivots. Tab returns to Animate', c0[0] + 2 * dpr, c1[1] + 16 * dpr);
  }
  renderCrumbs();
  $('#hudInfo').textContent = `${Math.round(S.view.zoom * 100)}%  ·  frame ${S.frame}`;
}

// ---------- overlays (editor-only, never rendered on export) ----------
function screenBBox(L) {
  const es = [];
  const collect = (A) => { const e = Stage.rec.find((r) => r.L === A); if (e && !isContainer(A)) es.push(e); if (A.children) A.children.forEach(collect); };
  collect(L);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (m, x, y) => { const p = M.ap(m, x, y); x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const e of es) {
    const A = e.L;
    if (A.type === 'vector' && e.P) for (const id in e.P) add(e.full, e.P[id][0], e.P[id][1]);
    else if (A.type === 'image') { for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) add(e.full, (x * A.iw) / 2, (y * A.ih) / 2); }
    else if (A.type === 'text') { _hitCtx.font = `${A.bold ? '700 ' : ''}${A.size}px ${A.font}`; const lines = String(A.text).split('\n'); const w = Math.max(...lines.map((l) => _hitCtx.measureText(l).width)) / 2, h = (lines.length * A.size * 1.15) / 2; for (const [x, y] of [[-w, -h], [w, -h], [w, h], [-w, h]]) add(e.full, x, y); }
    else if (A.type === 'particle') { const r = val(A, 'emitR', S.frame) || 20; for (const [x, y] of [[-r, -r], [r, -r], [r, r], [-r, r]]) add(e.full, x, y); }
  }
  if (x0 === Infinity) { const e = lcOf(L); const p = M.ap(e.full, 0, 0); return [p[0] - 20, p[1] - 20, p[0] + 20, p[1] + 20]; }
  return [x0, y0, x1, y1];
}
function handlesFor(bb) {
  const [x0, y0, x1, y1] = bb, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return [
    { k: 'nw', x: x0, y: y0 }, { k: 'ne', x: x1, y: y0 }, { k: 'se', x: x1, y: y1 }, { k: 'sw', x: x0, y: y1 },
    { k: 'n', x: mx, y: y0 }, { k: 's', x: mx, y: y1 }, { k: 'e', x: x1, y: my }, { k: 'w', x: x0, y: my },
    { k: 'rot', x: mx, y: y0 - 26 * Stage.dpr },
  ];
}
function hitHandle(bb, sx, sy) { const r = 7 * Stage.dpr; return handlesFor(bb).find((h) => Math.abs(h.x - sx) <= r && Math.abs(h.y - sy) <= r) || null; }
function ptsBBox(L, ids) {
  const e = lcOf(L); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const id of ids) { const v = e.P && e.P[id]; if (!v) continue; const p = M.ap(e.full, v[0], v[1]); x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const pad = 6 * Stage.dpr; return x0 === Infinity ? null : [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
function drawHandles(ctx, bb, color = '#ff8a3d') {
  const dpr = Stage.dpr; ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = color; ctx.lineWidth = dpr; ctx.setLineDash([4 * dpr, 3 * dpr]);
  ctx.strokeRect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]); ctx.setLineDash([]);
  const hs = handlesFor(bb);
  ctx.beginPath(); ctx.moveTo(hs[4].x, hs[4].y); ctx.lineTo(hs[8].x, hs[8].y); ctx.stroke();
  for (const h of hs) {
    ctx.fillStyle = h.k === 'rot' ? color : '#fff'; ctx.strokeStyle = color;
    ctx.beginPath();
    if (h.k === 'rot') ctx.arc(h.x, h.y, 5 * dpr, 0, Math.PI * 2); else ctx.rect(h.x - 4 * dpr, h.y - 4 * dpr, 8 * dpr, 8 * dpr);
    ctx.fill(); ctx.stroke();
  }
}
const POINT_TOOLS = new Set(['points', 'pen', 'curvature', 'freehand', 'fill', 'rect', 'ellipse', 'polygon']);
const BONE_TOOLS = new Set(['bonesel', 'boneadd', 'bonetf', 'bonemanip', 'reparent', 'strength', 'vitruvian', 'sketch', 'bind', 'bindpts', 'offset', 'physics', 'force']);
function drawOverlays(ctx) {
  const dpr = Stage.dpr, sel = selLayer();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineJoin = 'round';
  // motion path of selected layer
  if (sel && S.showPaths && (S.tool === 'select' || S.tool === 'bonemanip') && Object.keys(sel.ch).some((k) => k === 'x' || k === 'y')) {
    const cam = stageCamFn(S.frame), V = viewM(), pts = [];
    const f0 = 0, f1 = S.doc.end, step = Math.max(1, Math.ceil((f1 - f0) / 400));
    for (let f = f0; f <= f1; f += step) { const lc = evalLC(sel, f); pts.push([M.ap(M.chain(V, cam(lc.z), lc.world), 0, 0), f]); }
    ctx.strokeStyle = 'rgba(255,138,61,.55)'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
    pts.forEach(([p], i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    for (const [p, f] of pts) {
      const k = Object.values(sel.ch).some((c) => c.keys.some((kk) => kk.f === f));
      ctx.fillStyle = f === S.frame ? '#fff' : k ? '#ffd166' : 'rgba(255,138,61,.8)';
      ctx.beginPath(); ctx.arc(p[0], p[1], (k ? 3.5 : 2) * dpr, 0, Math.PI * 2); ctx.fill();
    }
  }
  // vector outlines + points
  for (const id of S.selLayers) {
    const L = findLayer(id); if (!L) continue;
    if (L.type === 'vector') {
      const e = lcOf(L); if (!e.P) continue;
      const showPts = POINT_TOOLS.has(S.tool) || S.tool === 'bind' || S.tool === 'bindpts' || S.tool === 'strength';
      const showW = showPts && S.selBone && boneLayerFor(L) && boneLayerFor(L).bones.some((b) => b.id === S.selBone);
      const flexW = showW && !L.bindBone ? (() => { const lc = lcOf(L); const sg = layerFlexSegs(L, lc.B); return (pid) => { if (Array.isArray(L.pts[pid].b)) return null; const w = flexWeights(sg, M.ap(lc.relPts, L.pts[pid].x, L.pts[pid].y)), t = w.reduce((a, q) => a + q[1], 0), m = w.find((q) => q[0] === S.selBone); return m ? m[1] / t : t ? 0 : null; }; })() : null;
      M.set(ctx, e.full);
      ctx.beginPath(); for (const path of L.paths) tracePath(ctx, L, path, e.P, S.frame, e);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = showPts ? 'rgba(80,160,255,.95)' : 'rgba(80,160,255,.45)'; ctx.lineWidth = 1 * dpr; ctx.stroke();
      if (S.selShape) {
        const sh = L.shapes.find((s) => s.id === S.selShape);
        if (sh) { M.set(ctx, e.full); ctx.beginPath(); for (const pid of sh.paths) { const pa = L.paths.find((p) => p.id === pid); if (pa) tracePath(ctx, L, pa, e.P, S.frame, e); } ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = '#ff8a3d'; ctx.lineWidth = 2 * dpr; ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.stroke(); ctx.setLineDash([]); }
      }
      if (showPts) {
        for (const pid in e.P) {
          const p = M.ap(e.full, e.P[pid][0], e.P[pid][1]), s = S.selPts.has(pid), r = (s ? 4 : 3) * dpr;
          const ends = L.paths.some((pa) => !pa.closed && (pa.pts[0] === pid || pa.pts[pa.pts.length - 1] === pid));
          let col = s ? '#ff3b3b' : ends ? '#9be15d' : '#3d8bff';
          if (showW && !s) { const pb = L.pts[pid].b; if (pb && pb.length) col = mixColor('#26315c', '#ffd23f', (pb.find((q) => q[0] === S.selBone) || [0, 0])[1]); else { const fw = flexW && flexW(pid); col = fw === null || fw === undefined ? '#6b6b6b' : mixColor('#1f4d52', '#3bc9db', fw); } }
          ctx.fillStyle = col; ctx.strokeStyle = '#000';
          ctx.lineWidth = dpr; ctx.beginPath(); ctx.rect(p[0] - r, p[1] - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
          if (isKeyed(L, 'pt:' + pid) && keyAt(L, 'pt:' + pid, S.frame)) { ctx.strokeStyle = '#ffd166'; ctx.strokeRect(p[0] - r - 2 * dpr, p[1] - r - 2 * dpr, (r + 2 * dpr) * 2, (r + 2 * dpr) * 2); }
        }
        if (S.tool === 'points' && S.selPts.size > 1) { const bb = ptsBBox(L, S.selPts); if (bb) drawHandles(ctx, bb, '#ff3b3b'); }
        if (showW) { const bn = boneLayerFor(L).bones.find((b) => b.id === S.selBone); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#ffd23f'; ctx.font = `${11 * dpr}px Inter, system-ui`; ctx.fillText(`Weights for “${bn.name}”: yellow = bound 100% · dark = 0% · cyan = flexible (strength region) · grey = not influenced`, 12 * dpr, 52 * dpr); }
      }
    }
    if (L.type === 'particle') {
      const e = lcOf(L), p = M.ap(e.full, 0, 0), r = (val(L, 'emitR', S.frame) || 0) * M.scaleOf(e.full);
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = '#d68cff'; ctx.setLineDash([4 * dpr, 4 * dpr]); ctx.lineWidth = dpr;
      ctx.beginPath(); if (L.emit === 'line') { const a = M.ap(e.full, -val(L, 'emitR', S.frame), 0), b = M.ap(e.full, val(L, 'emitR', S.frame), 0); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); } else ctx.arc(p[0], p[1], Math.max(r, 4 * dpr), 0, Math.PI * 2);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#d68cff'; ctx.font = `${10 * dpr}px sans-serif`; ctx.fillText('✦ ' + L.name, p[0] + 8 * dpr, p[1] - 8 * dpr);
    }
  }
  // selection box with transform handles
  if (sel && S.tool === 'select' && !sel.lock) {
    const bb = screenBBox(sel); drawHandles(ctx, bb);
    const o = M.ap(lcOf(sel).full, sel.p.ox || 0, sel.p.oy || 0);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
    ctx.moveTo(o[0] - 9 * dpr, o[1]); ctx.lineTo(o[0] + 9 * dpr, o[1]); ctx.moveTo(o[0], o[1] - 9 * dpr); ctx.lineTo(o[0], o[1] + 9 * dpr); ctx.stroke();
    ctx.beginPath(); ctx.arc(o[0], o[1], 5 * dpr, 0, Math.PI * 2); ctx.stroke();
  }
  // bones
  const B = activeBoneLayer();
  if (B && (BONE_TOOLS.has(S.tool) || S.selLayers.includes(B.id))) drawBones(ctx, B);
  // pen preview
  if (S.tool === 'pen' && Stage.pen) {
    const L = findLayer(Stage.pen.layer), path = L && L.paths.find((p) => p.id === Stage.pen.path);
    if (path && path.pts.length) {
      const e = lcOf(L), last = e.P[path.pts[path.pts.length - 1]];
      if (last) { const a = M.ap(e.full, last[0], last[1]); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(Stage.mouse[0], Stage.mouse[1]); ctx.stroke(); ctx.setLineDash([]); }
    }
  }
  // freehand preview / marquee
  if (Stage.preview) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (Stage.preview.type === 'poly') { ctx.strokeStyle = S.newStyle.stroke; ctx.lineWidth = Math.max(1, S.newStyle.width * S.view.zoom * dpr); ctx.lineCap = 'round'; ctx.beginPath(); Stage.preview.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); }
    if (Stage.preview.type === 'marquee') { const [x0, y0, x1, y1] = Stage.preview.r; ctx.strokeStyle = '#fff'; ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.lineWidth = dpr; ctx.fillStyle = 'rgba(80,160,255,.12)'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]); }
  }
  // camera tool indicator
  if (CAMERA_TOOLS.has(S.tool) && CAMERA_VIEW.mode === 'camera') {
    const d = S.doc, V = viewM(), c0 = M.ap(V, -d.w / 2, -d.h / 2), c1 = M.ap(V, d.w / 2, d.h / 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.strokeStyle = 'rgba(255,209,102,.9)'; ctx.lineWidth = 2 * dpr; ctx.strokeRect(c0[0], c0[1], c1[0] - c0[0], c1[1] - c0[1]);
    // thirds + safe area
    ctx.lineWidth = dpr; ctx.strokeStyle = 'rgba(255,209,102,.35)'; ctx.beginPath();
    for (const t of [1 / 3, 2 / 3]) { const x = lerp(c0[0], c1[0], t), y = lerp(c0[1], c1[1], t); ctx.moveTo(x, c0[1]); ctx.lineTo(x, c1[1]); ctx.moveTo(c0[0], y); ctx.lineTo(c1[0], y); }
    ctx.stroke(); const ix = (c1[0] - c0[0]) * 0.05, iy = (c1[1] - c0[1]) * 0.05; ctx.strokeRect(c0[0] + ix, c0[1] + iy, c1[0] - c0[0] - 2 * ix, c1[1] - c0[1] - 2 * iy);
  }
}
function activeBoneLayer() {
  const L = selLayer(); if (!L) return null;
  if (L.type === 'bone') return L;
  return boneLayerFor(L);
}
function boneScreen(B, all) { // -> [{id, b, base:[x,y], tip:[x,y]}]; inactive Vitruvian bones only when all
  const e = lcOf(B); const bd = e.bones || boneDeforms(B, S.frame);
  return B.bones.filter((b) => all || !bd.cur[b.id].off).map((b) => { const fr = bd.cur[b.id], m = M.mul(e.full, fr.F); return { id: b.id, b, base: M.ap(m, 0, 0), tip: M.ap(m, fr.len, 0), m, fr, off: fr.off, full: e.full }; });
}
function drawBones(ctx, B) {
  const dpr = Stage.dpr, sel = selLayer(), T = S.tool;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const boundIds = new Set();
  if (sel && sel.bindBone) boundIds.add(sel.bindBone);
  if (sel && sel.type === 'vector') for (const id of S.selPts) { const p = sel.pts[id]; if (p && p.b) p.b.forEach(([bid]) => boundIds.add(bid)); }
  const list = boneScreen(B, T === 'vitruvian'), selIds = new Set(selectedBoneIds());
  const k = M.scaleOf(lcOf(B).full);
  if (T === 'strength' || (S.mode === 'setup' && T === 'bonesel')) {
    for (const bs of list) {
      const r = (bs.b.str || 0) * k; if (r <= 0) continue;
      ctx.strokeStyle = selIds.has(bs.id) ? 'rgba(255,138,61,.28)' : 'rgba(110,140,255,.16)'; ctx.lineWidth = r * 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bs.base[0], bs.base[1]); ctx.lineTo(bs.tip[0], bs.tip[1]); ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  if (T === 'offset' || S.mode === 'setup') {
    const rest = boneFrames(B, null), full = lcOf(B).full;
    for (const bs of list) {
      if (!(bs.b.ox || bs.b.oy) && !ancestorOffset(B, bs.b)) continue;
      const m = M.mul(full, rest[bs.id].F), a = M.ap(m, 0, 0), t = M.ap(m, bs.b.len, 0);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(t[0], t[1]); ctx.moveTo(a[0], a[1]); ctx.lineTo(bs.base[0], bs.base[1]); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  for (const bs of list) {
    const dx = bs.tip[0] - bs.base[0], dy = bs.tip[1] - bs.base[1], len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, w = Math.min(len * 0.14, 9 * dpr), mx = bs.base[0] + dx * 0.18, my = bs.base[1] + dy * 0.18;
    const isSel = selIds.has(bs.id), prim = S.selBone === bs.id;
    ctx.globalAlpha = bs.off ? 0.3 : 1;
    ctx.beginPath(); ctx.moveTo(bs.base[0], bs.base[1]); ctx.lineTo(mx + nx * w, my + ny * w); ctx.lineTo(bs.tip[0], bs.tip[1]); ctx.lineTo(mx - nx * w, my - ny * w); ctx.closePath();
    ctx.fillStyle = isSel ? '#ff3333' : boundIds.has(bs.id) ? 'rgba(92,207,138,.75)' : bs.b.color || (bs.b.dyn && bs.b.dyn.on ? 'rgba(59,201,219,.7)' : 'rgba(110,140,255,.6)');
    ctx.strokeStyle = isSel ? '#fff' : 'rgba(0,0,0,.7)'; ctx.lineWidth = dpr; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(bs.base[0], bs.base[1], 3.5 * dpr, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
    if (bs.b.dyn && bs.b.dyn.on) { ctx.strokeStyle = '#3bc9db'; ctx.beginPath(); for (let i = 0; i <= 6; i++) { const t = 0.35 + i * 0.08, o = (i % 2 ? 4 : -4) * dpr; const px = bs.base[0] + dx * t + nx * o, py = bs.base[1] + dy * t + ny * o; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
    if (S.boneLabels || isSel || ['vitruvian', 'strength'].includes(T)) {
      const txt = bs.b.name + (T === 'vitruvian' && bs.b.vg ? ` [${bs.b.vg}]` : '') + (T === 'strength' ? ` · ${bs.b.str || 0}` : '');
      let ang = Math.atan2(dy, dx); if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI; // keep text upright
      const fs = 11 * dpr, room = len - 10 * dpr;
      ctx.save(); ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(txt).width;
      if (tw <= room) { ctx.translate(bs.base[0] + dx * 0.55, bs.base[1] + dy * 0.55); ctx.rotate(ang); } // along the bone
      else { ctx.translate(bs.tip[0] + 6 * dpr, bs.tip[1] - 6 * dpr); } // short bone: next to its tip
      ctx.textAlign = tw <= room ? 'center' : 'left'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = isSel ? '#fff' : 'rgba(255,255,255,.92)'; ctx.fillText(txt, 0, 0); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  if (T === 'reparent') {
    const byId = Object.fromEntries(list.map((x) => [x.id, x]));
    ctx.save();
    ctx.setLineDash([]);
    for (const bs of list) {
      const parent = bs.b.parent && byId[bs.b.parent];
      if (!parent) continue;
      // Midpoints keep the direction visible even when child and parent share a joint.
      const x0 = (bs.base[0] + bs.tip[0]) / 2, y0 = (bs.base[1] + bs.tip[1]) / 2;
      const x1 = (parent.base[0] + parent.tip[0]) / 2, y1 = (parent.base[1] + parent.tip[1]) / 2;
      const dx = x1 - x0, dy = y1 - y0, length = Math.hypot(dx, dy);
      if (length < dpr) continue;
      const ux = dx / length, uy = dy / length, head = Math.min(9 * dpr, length * 0.35);
      const color = selIds.has(bs.id) ? '#ff3333' : '#ffd166';
      ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 5 * dpr;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr; ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - ux * head - uy * head * 0.5, y1 - uy * head + ux * head * 0.5);
      ctx.lineTo(x1 - ux * head + uy * head * 0.5, y1 - uy * head - ux * head * 0.5);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  if (T === 'force' || (T === 'bonesel' && (Stage.forceArrow || ((B.force || {}).windS && B.bones.some((b) => b.dyn && b.dyn.on))))) {
    const f = B.force || {}, c = Stage.forceArrow || null;
    let x0, y0, x1, y1;
    if (c) [x0, y0, x1, y1] = c; else { x0 = Stage.cv.width / 2; y0 = 60 * dpr; const L = Math.min(200 * dpr, ((f.windS || 0) / 1.5) * k); x1 = x0 + Math.cos((f.windA || 0) * DEG) * L; y1 = y0 + Math.sin((f.windA || 0) * DEG) * L; }
    if (Math.hypot(x1 - x0, y1 - y0) > 2) {
      const ang = Math.atan2(y1 - y0, x1 - x0); ctx.strokeStyle = '#3bc9db'; ctx.fillStyle = '#3bc9db'; ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - Math.cos(ang - 0.4) * 12 * dpr, y1 - Math.sin(ang - 0.4) * 12 * dpr); ctx.lineTo(x1 - Math.cos(ang + 0.4) * 12 * dpr, y1 - Math.sin(ang + 0.4) * 12 * dpr); ctx.fill();
      ctx.font = `${11 * dpr}px Inter, system-ui`; ctx.fillText(`wind ${f.windS || 0}`, x1 + 8 * dpr, y1);
    }
  }
}
function ancestorOffset(B, b) { let p = b.parent && boneOf(B, b.parent); while (p) { if (p.ox || p.oy) return true; p = p.parent && boneOf(B, p.parent); } return false; }
function hitBone(B, sx, sy, tol = 10, all = false) {
  let best = null, bd = tol * Stage.dpr;
  for (const bs of boneScreen(B, all || S.tool === 'vitruvian')) {
    const d = distToSeg(sx, sy, bs.base, bs.tip);
    if (d < bd) { bd = d; best = bs; }
  }
  return best;
}
function distToSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9;
  const t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1);
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
function hitPoint(L, sx, sy, r = 8) {
  const e = lcOf(L); if (!e.P) return null;
  let best = null, bd = r * Stage.dpr;
  for (const id in e.P) { const p = M.ap(e.full, e.P[id][0], e.P[id][1]); const d = Math.hypot(p[0] - sx, p[1] - sy); if (d < bd) { bd = d; best = id; } }
  return best;
}
function hitTestLayers(sx, sy) {
  for (let i = Stage.rec.length - 1; i >= 0; i--) {
    const e = Stage.rec[i]; if (e.L.lock || e.L.ignoreSelector || isContainer(e.L) || e.L.type === 'audio') continue;
    if (ancestors(e.L.id).some((a) => a.lock)) continue;
    const h = hitLayerEntry(e, sx, sy); if (h) return { L: e.L, ...h };
  }
  return null;
}

// ---------- vector editing helpers ----------
function ensureVectorLayer() {
  let L = selLayer();
  if (L && L.type === 'vector') return L;
  const nl = mkLayer('vector');
  const target = L && isContainer(L) ? L.children : L ? siblingsOf(L.id) : S.doc.layers;
  const idx = L && !isContainer(L) ? target.indexOf(L) : 0;
  target.splice(Math.max(0, idx), 0, nl);
  S.selLayers = [nl.id];
  return nl;
}
function addPoint(L, x, y, c = 1) { const id = uid('p'); L.pts[id] = { x, y, c }; return id; }
function addShape(L, pathIds, style = S.newStyle, over = {}) {
  const sh = { id: uid('s'), paths: pathIds, fill: style.fill, stroke: style.stroke, width: style.width, fillOn: style.fillOn, strokeOn: style.strokeOn, ...over };
  L.shapes.push(sh); return sh;
}
function deletePoints(L, ids) {
  for (const id of ids) { delete L.pts[id]; delete L.ch['pt:' + id]; }
  for (const pa of L.paths) pa.pts = pa.pts.filter((p) => L.pts[p]);
  const dead = new Set(L.paths.filter((pa) => pa.pts.length < 2).map((p) => p.id));
  L.paths = L.paths.filter((pa) => !dead.has(pa.id));
  for (const sh of L.shapes) sh.paths = sh.paths.filter((p) => !dead.has(p));
  const deadSh = L.shapes.filter((s) => !s.paths.length).map((s) => s.id);
  L.shapes = L.shapes.filter((s) => s.paths.length);
  deadSh.forEach((sid) => deleteChannelsMatching(L, (k) => k.startsWith('sh:' + sid + ':')));
  for (const id of Object.keys(L.pts)) if (!L.paths.some((pa) => pa.pts.includes(id))) delete L.pts[id];
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  let dmax = 0, idx = 0; const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) { const d = distToSeg(pts[i][0], pts[i][1], a, b); if (d > dmax) { dmax = d; idx = i; } }
  if (dmax > eps) return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
  return [a, b];
}
// find segment near screen point -> {path, index(insert after)}
function hitSegment(L, sx, sy) {
  const e = lcOf(L); if (!e.P) return null;
  for (const pa of L.paths) {
    const n = pa.pts.length, segs = pa.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p = new Path2D(); const sub = { pts: [pa.pts[i], pa.pts[(i + 1) % n]], closed: false };
      // sample along the actual curve by tracing the whole path is costly; approximate with neighbours
      const ids = pa.closed ? [pa.pts[(i - 1 + n) % n], pa.pts[i], pa.pts[(i + 1) % n], pa.pts[(i + 2) % n]] : [pa.pts[Math.max(0, i - 1)], pa.pts[i], pa.pts[i + 1], pa.pts[Math.min(n - 1, i + 2)]];
      void sub;
      const q = ids.map((id) => e.P[id]);
      const k1 = (L.pts[ids[1]].c ?? 1) / 6, k2 = (L.pts[ids[2]].c ?? 1) / 6;
      const c1 = [q[1][0] + (q[2][0] - q[0][0]) * k1, q[1][1] + (q[2][1] - q[0][1]) * k1], c2 = [q[2][0] - (q[3][0] - q[1][0]) * k2, q[2][1] - (q[3][1] - q[1][1]) * k2];
      p.moveTo(q[1][0], q[1][1]); p.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], q[2][0], q[2][1]);
      M.set(_hitCtx, e.full); _hitCtx.lineWidth = (8 * Stage.dpr) / M.scaleOf(e.full);
      if (_hitCtx.isPointInStroke(p, sx, sy)) return { path: pa, index: i };
    }
  }
  return null;
}

// ---------- tools ----------
const TOOLS = {};
const TOOL_GROUPS = [
  ['Select', ['select', 'points']],
  ['Draw', ['pen', 'freehand', 'rect', 'ellipse', 'polygon', 'text']],
  ['Edit', ['curvature', 'fill']],
  ['Bone', ['bonesel', 'boneadd', 'bonetf', 'bonemanip', 'reparent', 'strength', 'vitruvian', 'sketch', 'bind', 'bindpts', 'offset', 'physics', 'force']],
  ['FX', ['emitter']],
  ['Camera', ['camera']],
  ['View', ['pan', 'zoom']],
];
function defTool(id, t) { TOOLS[id] = { id, ...t }; }
// Which tools apply depends on: selected layer type + editing mode + current selection.
// Tools never move; unavailable ones are dimmed and explain why.
const TOOLS_ALWAYS = new Set(['select', 'text', 'emitter', 'camera', 'pan', 'zoom']);
const TOOLS_DRAW = new Set(['pen', 'freehand', 'rect', 'ellipse', 'polygon']);
function toolAvail(id) {
  if (TOOLS_ALWAYS.has(id)) return null;
  const L = selLayer(), T = L ? LAYER_TYPES[L.type].name : '';
  if (TOOLS_DRAW.has(id)) {
    if (!L) return S.mode === 'setup' ? null : 'Create geometry in Setup mode';
    if (L.type === 'vector') return writeReason(L) || (S.mode !== 'setup' ? 'Create geometry in Setup mode; animate existing points in Animate mode' : null);
    if (isContainer(L)) return `You can't draw directly into a ${T}. Use “＋ Vector layer inside” in the bar above, then draw.`;
    return `Drawing tools edit vector layers — “${L.name}” is a ${T} layer. Select a vector layer, or press Esc to draw on a new one.`;
  }
  if (id === 'points' || id === 'curvature' || id === 'fill') {
    if (!L) return 'Select a vector layer first';
    if (L.type === 'vector') return writeReason(L);
    if (L.type === 'switch') return 'Select one of this Switch Group’s drawings in the Layers panel to edit its points';
    if (L.type === 'text') return 'Text layers keep editable letters, so they have no points';
    return `${T} layers have no vector points`;
  }
  if (BONE_TOOLS.has(id)) {
    const B = activeBoneLayer();
    if (B && id !== 'bonesel' && (writeReason(B) || (L && writeReason(L)))) return writeReason(B) || writeReason(L);
    if (!B) return 'Bone tools work on a Bone Group — select one (or artwork inside it). Rig ▸ New bone group creates one.';
    const setupOnly = { boneadd: 'Bones are created', reparent: 'Reparenting changes the skeleton, so it is done', strength: 'Bone strength is set', sketch: 'Sketching bones creates bones, so it is done', bind: 'Binding is done', bindpts: 'Binding points is done', offset: 'Offsets assemble an exploded rig', physics: 'Bone physics is set up' };
    if (setupOnly[id] && S.mode !== 'setup') return `${setupOnly[id]} in Setup mode — press Tab or click Setup`;
    const needBones = ['bonesel', 'bonetf', 'bonemanip', 'reparent', 'strength', 'vitruvian', 'bind', 'bindpts', 'offset', 'physics', 'force'];
    if (needBones.includes(id) && !B.bones.length) return 'This Bone Group has no bones yet — use Add bone or Sketch bones in Setup mode';
    if (id === 'bind' && (!L || L === B)) return 'Select an artwork layer inside the Bone Group first, then click the bone it should follow';
    if (id === 'bindpts' && (!L || L.type !== 'vector' || L === B)) return 'Select a vector layer inside the Bone Group first';
    if (id === 'bindpts' && L.bindBone) return `“${L.name}” is bound as a whole layer — clear that attachment (Bind layer, click empty space) to bind individual points`;
    if (id === 'bindpts' && !Object.keys(L.pts || {}).length) return `“${L.name}” has no points to bind`;
    if (id === 'reparent' && B.bones.length < 2) return 'Reparenting needs at least two bones';
    if (id === 'force' && !B.bones.some((b) => b.dyn && b.dyn.on)) return 'Forces act on bones with physics — enable Bone physics on a bone first';
    return null;
  }
  return null;
}
function updateToolbar() {
  const bl = $('#toolbar .tg[data-group="Bone"]'); if (bl) { const B = activeBoneLayer(); bl.classList.toggle('ctx', !!B); bl.textContent = B ? `Bone · ${S.mode === 'setup' ? 'Setup' : 'Animate'}` : 'Bone'; }
  $$('#toolbar button').forEach((b) => {
    const t = TOOLS[b.dataset.tool], why = toolAvail(t.id);
    b.classList.toggle('na', !!why);
    b.title = `${t.name}${t.key ? ` (${t.key})` : ''}\n${why ? '⚠ ' + why : t.hint}`;
  });
}
function setMode(m) {
  if (m === S.mode) return;
  if (m === 'setup') {
    if (S.playing) stopPlay();
    S.animFrame = S.frame; S.mode = 'setup'; S.frame = 0; S.swPreview = {};
    if (toolAvail(S.tool)) S.tool = activeBoneLayer() ? 'bonetf' : 'select';
    toast('Setup mode — edit the rest pose, bones, binding and pivots');
  } else {
    S.mode = 'animate'; S.frame = S.animFrame || 0;
    if (toolAvail(S.tool)) S.tool = activeBoneLayer() ? 'bonemanip' : 'select';
    toast('Animate mode — changes record keys at the playhead');
  }
  setTool(S.tool); updateModeUI(); renderTLBar(); refreshAll();
}
function updateModeUI() {
  $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === S.mode));
  document.body.classList.toggle('setup', S.mode === 'setup');
}
function setTool(id) {
  const why = toolAvail(id);
  if (why && id !== S.tool) { toast(why, 'err'); return; }
  if (S.tool === 'pen') finishPen();
  S.tool = id; Stage.preview = null;
  $$('#toolbar button').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
  updateToolbar(); renderToolOpts(); setCursor(); requestDraw();
}
function setCursor() { const t = TOOLS[S.tool]; Stage.cv.style.cursor = Stage.space ? 'grab' : (t && t.cursor) || 'default'; }

function startDrag(e, data) { Stage.drag = { sx: Stage.mouse[0], sy: Stage.mouse[1], moved: false, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, ...data }; }

// --- Select / transform layer
defTool('select', {
  icon: '➤', name: 'Transform layer', key: 'V', hint: 'Drag anywhere to move the current layer · handles scale/rotate · drag the ⊕ to move its pivot',
  down(e, sx, sy) {
    const sel = selLayer();
    if (sel && !writeReason(sel)) {
      const lc0 = lcOf(sel), o = M.ap(lc0.full, sel.p.ox || 0, sel.p.oy || 0);
      if (Math.hypot(sx - o[0], sy - o[1]) < 8 * Stage.dpr) { beginEdit('Move pivot'); startDrag(e, { mode: 'pivot', L: sel, inv: M.inv(lc0.full) }); return; }
      const h = hitHandle(screenBBox(sel), sx, sy);
      if (h) { this.beginTf(e, sel, h.k === 'rot' ? 'rot' : 'scale', h.k); return; }
    }
    if (!sel) { toast('Select a layer in the Layers panel'); return; }
    const why = writeReason(sel); if (why) { toast(why, 'err'); return; }
    this.beginTf(e, sel, 'move');
  },
  beginTf(e, L, mode, handle) {
    const why = writeReason(L); if (why) return toast(why, 'err');
    const targets = [L];
    beginEdit(mode === 'move' ? 'Move layer' : mode === 'rot' ? 'Rotate layer' : 'Scale layer');
    const o = M.ap(lcOf(L).full, L.p.ox || 0, L.p.oy || 0);
    startDrag(e, { mode, handle, L, o, targets: targets.map((T) => ({ T, x: val(T, 'x', S.frame), y: val(T, 'y', S.frame), rot: val(T, 'rot', S.frame), sx: val(T, 'sx', S.frame), sy: val(T, 'sy', S.frame), inv: M.inv(parentFull(T)) })) });
  },
  move(e, sx, sy) {
    const d = Stage.drag; if (!d) return;
    const dx = sx - d.sx, dy = sy - d.sy;
    if (d.mode === 'pivot') { const q = M.ap(d.inv, sx, sy); d.L.p.ox = round(q[0]); d.L.p.oy = round(q[1]); requestDraw(); return; }
    if (d.mode === 'move') {
      for (const t of d.targets) { let v = cameraDragDelta(t.inv, sx, sy, d.sx, d.sy); if (e.shiftKey) { if (Math.abs(v[0]) > Math.abs(v[1])) v[1] = 0; else v[0] = 0; } setVal(t.T, 'x', round(t.x + v[0])); setVal(t.T, 'y', round(t.y + v[1])); }
    } else if (d.mode === 'rot') {
      const a0 = Math.atan2(d.sy - d.o[1], d.sx - d.o[0]), a1 = Math.atan2(sy - d.o[1], sx - d.o[0]);
      let r = d.targets[0].rot + (a1 - a0) / DEG; if (e.shiftKey) r = Math.round(r / 15) * 15;
      setVal(d.L, 'rot', round(r));
    } else {
      const t = d.targets[0], h = d.handle;
      const d0 = Math.hypot(d.sx - d.o[0], d.sy - d.o[1]) || 1, d1 = Math.hypot(sx - d.o[0], sy - d.o[1]);
      let k = d1 / d0;
      if (h === 'n' || h === 's') setVal(d.L, 'sy', round(t.sy * k, 3));
      else if (h === 'e' || h === 'w') setVal(d.L, 'sx', round(t.sx * k, 3));
      else { setVal(d.L, 'sx', round(t.sx * k, 3)); setVal(d.L, 'sy', round(t.sy * k, 3)); }
    }
    requestDraw();
  },
  up() { commitEdit(); },
});

// --- Points
defTool('points', {
  icon: '⬚', name: 'Select / Transform points', key: 'A', cursor: 'crosshair', hint: 'Click/drag points · marquee to select · Shift adds · handles scale/rotate · Del deletes · Ctrl+A selects all',
  down(e, sx, sy) {
    const L = selLayer();
    if (!L || L.type !== 'vector') { const hit = hitTestLayers(sx, sy); if (hit && hit.L.type === 'vector') { S.selLayers = [hit.L.id]; S.selPts.clear(); refreshAll(); } else toast('Select a vector layer to edit its points'); return; }
    if (L.lock) return toast('Layer is locked');
    if (S.selPts.size > 1) { const bb = ptsBBox(L, S.selPts); const h = bb && hitHandle(bb, sx, sy); if (h) return this.beginPts(e, L, h.k === 'rot' ? 'rot' : 'scale', bb); }
    const pid = hitPoint(L, sx, sy);
    if (pid) {
      if (e.shiftKey) { S.selPts.has(pid) ? S.selPts.delete(pid) : S.selPts.add(pid); }
      else if (!S.selPts.has(pid)) { S.selPts = new Set([pid]); }
      refreshAll(); this.beginPts(e, L, 'move'); return;
    }
    const sh = hitLayerEntry(lcOf(L), sx, sy);
    if (sh && sh.shape && !e.shiftKey) {
      S.selShape = sh.shape.id; const ids = new Set(); sh.shape.paths.forEach((pid) => { const pa = L.paths.find((p) => p.id === pid); pa && pa.pts.forEach((i) => ids.add(i)); });
      S.selPts = ids; refreshAll(); this.beginPts(e, L, 'move'); return;
    }
    if (!e.shiftKey) S.selPts = new Set();
    startDrag(e, { mode: 'marquee', L, base: new Set(S.selPts) }); refreshAll();
  },
  beginPts(e, L, mode, bb) {
    beginEdit(mode === 'move' ? 'Move points' : mode === 'rot' ? 'Rotate points' : 'Scale points');
    const start = {}; for (const id of S.selPts) start[id] = val(L, 'pt:' + id, S.frame);
    let c = [0, 0]; const ids = [...S.selPts]; ids.forEach((id) => { c[0] += start[id][0] / ids.length; c[1] += start[id][1] / ids.length; });
    startDrag(e, { mode, L, start, c, inv: M.inv(lcOf(L).full), cs: M.ap(lcOf(L).full, c[0], c[1]) });
  },
  move(e, sx, sy) {
    const d = Stage.drag; if (!d) return;
    if (d.mode === 'marquee') {
      const r = [Math.min(d.sx, sx), Math.min(d.sy, sy), Math.max(d.sx, sx), Math.max(d.sy, sy)];
      Stage.preview = { type: 'marquee', r };
      const lc = lcOf(d.L); const s = new Set(d.base);
      for (const id in lc.P) { const p = M.ap(lc.full, lc.P[id][0], lc.P[id][1]); if (p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]) s.add(id); }
      S.selPts = s; requestDraw(); return;
    }
    const L = d.L;
    if (d.mode === 'move') {
      let v = cameraDragDelta(d.inv, sx, sy, d.sx, d.sy);
      if (e.shiftKey) { if (Math.abs(v[0]) > Math.abs(v[1])) v[1] = 0; else v[0] = 0; }
      for (const id in d.start) setVal(L, 'pt:' + id, [round(d.start[id][0] + v[0]), round(d.start[id][1] + v[1])]);
    } else if (d.mode === 'rot') {
      const a = Math.atan2(sy - d.cs[1], sx - d.cs[0]) - Math.atan2(d.sy - d.cs[1], d.sx - d.cs[0]);
      const m = M.chain(M.t(d.c[0], d.c[1]), M.r(a), M.t(-d.c[0], -d.c[1]));
      for (const id in d.start) { const p = M.ap(m, d.start[id][0], d.start[id][1]); setVal(L, 'pt:' + id, [round(p[0]), round(p[1])]); }
    } else {
      const k = Math.hypot(sx - d.cs[0], sy - d.cs[1]) / (Math.hypot(d.sx - d.cs[0], d.sy - d.cs[1]) || 1);
      for (const id in d.start) setVal(L, 'pt:' + id, [round(d.c[0] + (d.start[id][0] - d.c[0]) * k), round(d.c[1] + (d.start[id][1] - d.c[1]) * k)]);
    }
    requestDraw();
  },
  up() { const d = Stage.drag; Stage.preview = null; if (d && d.mode !== 'marquee') commitEdit(); refreshAll(); },
});

// --- Pen (add points / paths)
function finishPen(closeIt) {
  const P = Stage.pen; Stage.pen = null; if (!P) return;
  const L = findLayer(P.layer); if (!L) return;
  const path = L.paths.find((p) => p.id === P.path); if (!path) return;
  edit(closeIt ? 'Close path' : 'Finish path', () => {
    if (path.pts.length < 2) { L.paths = L.paths.filter((p) => p !== path); for (const id of path.pts) if (!L.paths.some((pa) => pa.pts.includes(id))) delete L.pts[id]; return; }
    if (closeIt) path.closed = true;
    if (!L.shapes.some((s) => s.paths.includes(path.id)) && (closeIt || S.newStyle.strokeOn)) {
      const sh = addShape(L, [path.id], S.newStyle, closeIt ? {} : { fillOn: false });
      S.selShape = sh.id;
    }
  });
}
defTool('pen', {
  icon: '✒', name: 'Pen — add points', key: 'P', cursor: 'crosshair', hint: 'Click to add points (drag to place) · click first point to close · click a segment to insert · Enter/Esc finishes',
  down(e, sx, sy) {
    const L = ensureVectorLayer(); if (L.lock) return toast('Layer is locked');
    beginEdit('Add point');
    const loc = toLocal(L, sx, sy);
    const hp = hitPoint(L, sx, sy);
    let P = Stage.pen && Stage.pen.layer === L.id ? Stage.pen : null;
    let path = P && L.paths.find((p) => p.id === P.path);
    if (path && hp && hp === path.pts[0] && path.pts.length > 2) { commitEdit(); finishPen(true); return; }
    if (!path) {
      if (hp) { // continue from an open endpoint, or branch from an existing point
        const pa = L.paths.find((p) => !p.closed && (p.pts[0] === hp || p.pts[p.pts.length - 1] === hp));
        if (pa) { if (pa.pts[0] === hp) pa.pts.reverse(); Stage.pen = { layer: L.id, path: pa.id }; commitEdit(); requestDraw(); return; }
        path = { id: uid('a'), pts: [hp], closed: false }; L.paths.push(path); Stage.pen = { layer: L.id, path: path.id };
        commitEdit(); requestDraw(); return;
      }
      const seg = hitSegment(L, sx, sy);
      if (seg) {
        const id = addPoint(L, round(loc[0]), round(loc[1]), 1);
        seg.path.pts.splice(seg.index + 1, 0, id); S.selPts = new Set([id]);
        startDrag(e, { mode: 'pt', L, id, inv: M.inv(lcOf(L).full), start: [loc[0], loc[1]] }); return;
      }
      path = { id: uid('a'), pts: [], closed: false }; L.paths.push(path); Stage.pen = { layer: L.id, path: path.id };
    }
    let id = hp;
    if (!id) id = addPoint(L, round(loc[0]), round(loc[1]), this.opts.smooth ? 1 : 0);
    path.pts.push(id); S.selPts = new Set([id]);
    if (hp && hp !== path.pts[0]) { commitEdit(); finishPen(false); return; } // welded to another point
    startDrag(e, { mode: 'pt', L, id, inv: M.inv(lcOf(L).full), start: [loc[0], loc[1]] });
    requestDraw();
  },
  move(e, sx, sy) {
    const d = Stage.drag; if (!d || d.mode !== 'pt') return requestDraw();
    const v = cameraDragDelta(d.inv, sx, sy, d.sx, d.sy); const p = d.L.pts[d.id];
    if (p) { p.x = round(d.start[0] + v[0]); p.y = round(d.start[1] + v[1]); }
    requestDraw();
  },
  up() { commitEdit(); },
  opts: { smooth: true },
});

// --- Freehand
defTool('freehand', {
  icon: '✍', name: 'Freehand', key: 'F', cursor: 'crosshair', hint: 'Drag to draw a stroke · end near the start to make a filled closed shape',
  down(e, sx, sy) { const L = ensureVectorLayer(); if (L.lock) return toast('Layer is locked'); startDrag(e, { L }); Stage.preview = { type: 'poly', pts: [[sx, sy]] }; refreshAll(); },
  move(e, sx, sy) { if (!Stage.drag || !Stage.preview) return; const pts = Stage.preview.pts, l = pts[pts.length - 1]; if (Math.hypot(sx - l[0], sy - l[1]) > 2) pts.push([sx, sy]); requestDraw(); },
  up() {
    const d = Stage.drag, pv = Stage.preview; Stage.preview = null; if (!d || !pv || pv.pts.length < 3) return requestDraw();
    const L = d.L, inv = M.inv(lcOf(L).full);
    const eps = (S.freehandSmooth + 0.5) * Stage.dpr;
    let pts = rdp(pv.pts, eps);
    const first = pv.pts[0], last = pv.pts[pv.pts.length - 1];
    const closed = pts.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 18 * Stage.dpr;
    if (closed) pts = pts.slice(0, -1);
    edit('Freehand stroke', () => {
      const ids = pts.map((p) => { const q = M.ap(inv, p[0], p[1]); return addPoint(L, round(q[0]), round(q[1]), 1); });
      const path = { id: uid('a'), pts: ids, closed }; L.paths.push(path);
      const sh = addShape(L, [path.id], S.newStyle, closed ? {} : { fillOn: false, strokeOn: true });
      S.selShape = sh.id;
    });
  },
});

// --- Primitive shapes
function primTool(id, icon, name, key, gen) {
  defTool(id, {
    icon, name, key, cursor: 'crosshair', hint: 'Drag to draw · Shift = equal proportions · Alt = from center',
    down(e, sx, sy) { const L = ensureVectorLayer(); if (L.lock) return toast('Layer is locked'); beginEdit(name); startDrag(e, { L, a: toLocal(L, sx, sy), inv: M.inv(lcOf(L).full) }); },
    move(e, sx, sy) {
      const d = Stage.drag; if (!d) return;
      const b = M.ap(d.inv, sx, sy); let a = d.a.slice(), w = b[0] - a[0], h = b[1] - a[1];
      if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
      if (e.altKey) a = [a[0] - w, a[1] - h], (w *= 2), (h *= 2);
      if (Math.abs(w) < 2 && Math.abs(h) < 2) return;
      const L = d.L, geo = gen(a[0], a[1], w, h);
      if (!d.path) {
        const ids = geo.map((g) => addPoint(L, 0, 0, g[2]));
        d.path = { id: uid('a'), pts: ids, closed: true }; L.paths.push(d.path);
        S.selShape = addShape(L, [d.path.id]).id;
      }
      d.path.pts.forEach((pid, i) => { L.pts[pid].x = round(geo[i][0]); L.pts[pid].y = round(geo[i][1]); });
      requestDraw();
    },
    up() { commitEdit(); },
  });
}
primTool('rect', '▭', 'Rectangle', 'R', (x, y, w, h) => [[x, y, 0], [x + w, y, 0], [x + w, y + h, 0], [x, y + h, 0]]);
primTool('ellipse', '◯', 'Ellipse', 'E', (x, y, w, h) => {
  const cx = x + w / 2, cy = y + h / 2, out = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; out.push([cx + (Math.cos(a) * w) / 2, cy + (Math.sin(a) * h) / 2, 1.105]); }
  return out;
});
primTool('polygon', '⬠', 'Polygon / star', 'Y', (x, y, w, h) => {
  const n = clamp(S.polySides | 0, 3, 24), cx = x + w / 2, cy = y + h / 2, out = [], star = S.polyStar, m = star ? n * 2 : n;
  for (let i = 0; i < m; i++) { const a = (i / m) * Math.PI * 2 - Math.PI / 2, r = star && i % 2 ? 0.45 : 1; out.push([cx + (Math.cos(a) * w * r) / 2, cy + (Math.sin(a) * h * r) / 2, 0]); }
  return out;
});

// --- Text
defTool('text', {
  icon: 'T', name: 'Text', key: 'T', cursor: 'text', hint: 'Click to place a text layer, then edit its text in Properties',
  down(e, sx, sy) {
    edit('Add text', () => {
      const L = mkLayer('text'); const V = viewM(); const w = M.ap(M.inv(M.mul(V, camFn(S.frame)(0))), sx, sy);
      L.p.x = round(w[0]); L.p.y = round(w[1]); S.doc.layers.unshift(L); S.selLayers = [L.id];
    });
    setTool('select'); setTab('props'); setTimeout(() => { const t = $('#tabBody textarea'); if (t) { t.focus(); t.select(); } }, 50);
  },
});

// --- Curvature
defTool('curvature', {
  icon: '⌒', name: 'Curvature', key: 'C', cursor: 'ns-resize', hint: 'Drag a point up/down to change its curvature · double-click toggles corner/smooth',
  down(e, sx, sy) {
    const L = selLayer(); if (!L || L.type !== 'vector') return toast('Select a vector layer');
    const pid = hitPoint(L, sx, sy); if (!pid) return;
    if (!S.selPts.has(pid)) S.selPts = new Set([pid]);
    beginEdit('Curvature'); const start = {}; for (const id of S.selPts) start[id] = L.pts[id].c ?? 1;
    startDrag(e, { L, start, t: performance.now() });
  },
  move(e, sx, sy) { const d = Stage.drag; if (!d) return; const dv = -(sy - d.sy) / (100 * Stage.dpr); for (const id in d.start) d.L.pts[id].c = round(clamp(d.start[id] + dv, 0, 2.5), 3); requestDraw(); },
  up() { commitEdit(); },
  dbl(e, sx, sy) { const L = selLayer(); if (!L || L.type !== 'vector') return; const pid = hitPoint(L, sx, sy); if (!pid) return; edit('Toggle corner', () => { L.pts[pid].c = (L.pts[pid].c ?? 1) > 0.05 ? 0 : 1; }); },
});

// --- Paint bucket
defTool('fill', {
  icon: '🪣', name: 'Paint bucket', key: 'B', cursor: 'cell', hint: 'Click inside a closed path to fill it with the current style · Shift = stroke color only · Alt = pick style (eyedropper)',
  down(e, sx, sy) {
    const hit = hitTestLayers(sx, sy);
    if (e.altKey) {
      if (hit && hit.shape) { const st = shapeStyle(hit.L, hit.shape, S.frame); Object.assign(S.newStyle, { fill: st.fill, stroke: st.stroke, width: st.width }); toast('Picked style'); refreshAll(); }
      return;
    }
    let L = selLayer(); if (!L || L.type !== 'vector') { if (hit && hit.L.type === 'vector') L = hit.L; else return toast('Select a vector layer'); }
    const e2 = lcOf(L); M.set(_hitCtx, e2.full);
    const cands = L.paths.filter((pa) => pa.closed).map((pa) => { const p = new Path2D(); tracePath(p, L, pa, e2.P, S.frame, e2); return { pa, p }; }).filter((c) => _hitCtx.isPointInPath(c.p, sx, sy));
    if (!cands.length) {
      if (hit && hit.L === L && hit.shape) return edit('Recolor shape', () => this.paint(L, hit.shape, e.shiftKey));
      return toast('No closed path here — close the path first (Pen: click its first point)', 'err');
    }
    const area = (pa) => { let a = 0; const ids = pa.pts; for (let i = 0; i < ids.length; i++) { const p = e2.P[ids[i]], q = e2.P[ids[(i + 1) % ids.length]]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a); };
    cands.sort((a, b) => area(a.pa) - area(b.pa));
    const pa = cands[0].pa;
    edit('Fill', () => {
      const sh = L.shapes.find((s) => s.paths.includes(pa.id));
      if (sh) this.paint(L, sh, e.shiftKey);
      else S.selShape = addShape(L, [pa.id], S.newStyle, { fillOn: true }).id;
    });
  },
  paint(L, sh, strokeOnly) {
    if (sh.styleId) sh.styleId = null;
    if (strokeOnly) { setVal(L, 'sh:' + sh.id + ':stroke', S.newStyle.stroke); sh.strokeOn = true; }
    else { setVal(L, 'sh:' + sh.id + ':fill', S.newStyle.fill); sh.fillOn = true; }
    S.selShape = sh.id;
  },
});

// ===================== Bone tools (Moho order) =====================
const BONE_SVG = '<path d="M4.5 19.5 L8 12.8 L19.5 4.5 L11.2 16 Z" fill="currentColor" fill-opacity=".38"/><circle cx="4.5" cy="19.5" r="1.7"/>';
const svgI = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const BIC = {
  bonesel: svgI(BONE_SVG + '<path d="M2.5 2.5 L2.5 10 L4.6 8.1 L6.2 11.3 L7.7 10.6 L6.1 7.5 L9 7.3 Z" fill="currentColor" stroke="none"/>'),
  boneadd: svgI(BONE_SVG + '<path d="M6 1.8v7.4M2.3 5.5h7.4" stroke-width="2"/>'),
  bonetf: svgI(BONE_SVG + '<path d="M6 1.5v8M2 5.5h8M4.7 2.8L6 1.5l1.3 1.3M8.7 4.2L10 5.5 8.7 6.8M4.7 8.2L6 9.5l1.3-1.3M3.3 4.2L2 5.5l1.3 1.3"/>'),
  bonemanip: svgI('<path d="M3 21 L5.5 15.5 L11 12.5 L7 17.5 Z" fill="currentColor" fill-opacity=".38"/><path d="M11 12.5 L15.5 7 L21 4 L17 9.5 Z" fill="currentColor" fill-opacity=".38"/><circle cx="11" cy="12.5" r="1.4"/><path d="M14 18.5c3 0 5.5-2.2 6-5" /><path d="M18.5 12.6l1.5.9.9-1.6"/>'),
  reparent: svgI('<path d="M3 21 L5 16 L10 13 L6.5 17.5 Z" fill="currentColor" fill-opacity=".38"/><path d="M14 10 L16.5 5 L21.5 2.5 L18 7 Z" fill="currentColor" fill-opacity=".38"/><path d="M8 11c0-4 2-6 5-6" stroke-dasharray="2 2"/><path d="M11 3.4l2 1.6-1.8 1.9"/>'),
  strength: svgI(BONE_SVG + '<ellipse cx="12" cy="12" rx="11" ry="5.2" transform="rotate(-42 12 12)" stroke-dasharray="2.2 2"/>'),
  vitruvian: svgI('<circle cx="12" cy="12" r="9.6"/><rect x="4.5" y="4.5" width="15" height="15" stroke-opacity=".5"/><circle cx="12" cy="6.6" r="1.7"/><path d="M12 8.4v6.6M5.5 10.6h13M12 15l-3.6 5M12 15l3.6 5"/>'),
  sketch: svgI('<path d="M3 20c2.5-5 5-.5 7.5-5s5-2.5 6.5-6.5"/><circle cx="3" cy="20" r="1.2"/><circle cx="10.5" cy="15" r="1.2"/><circle cx="17" cy="8.5" r="1.2"/><path d="M17.2 6.8l3-3 1.9 1.9-3 3z" fill="currentColor" fill-opacity=".4"/>'),
  bind: svgI(BONE_SVG + '<rect x="2" y="2" width="9" height="8" rx="1.2" fill="currentColor" fill-opacity=".18"/>'),
  bindpts: svgI(BONE_SVG + '<rect x="2" y="2.3" width="3" height="3" fill="currentColor"/><rect x="7.5" y="2.3" width="3" height="3" fill="currentColor"/><rect x="2" y="7.5" width="3" height="3" fill="currentColor"/>'),
  offset: svgI('<path d="M2.5 13.5 L5 8.5 L12 3 L7.5 10 Z" stroke-dasharray="1.8 1.6"/>' + '<path d="M9 21 L11.5 15.8 L21 9.5 L14.2 18 Z" fill="currentColor" fill-opacity=".38"/><path d="M7 11.5 L10.5 15.5M10.5 15.5v-3M10.5 15.5h-3"/>'),
  physics: svgI(BONE_SVG + '<path d="M13.5 2.5l2 1.4-3 1.6 3 1.6-3 1.6 3 1.6-2 1.4"/>'),
  force: svgI('<path d="M2.5 7.5h11a3 3 0 1 0-3-3M2.5 12.5h16a3 3 0 1 1-3 3M2.5 17.5h8"/>'),
};
function requireSetup(what) { if (S.mode !== 'setup') { toast(`${what} is done in Setup mode — press Tab or click Setup`, 'err'); return false; } return true; }
function ensureBoneLayer() { return activeBoneLayer(); }
const boneOf = (B, id) => B && B.bones.find((b) => b.id === id);
function selectBone(id, add) {
  if (!id) { S.selBone = null; S.selBones = new Set(); }
  else if (add) { if (S.selBones.has(id)) { S.selBones.delete(id); S.selBone = [...S.selBones].pop() || null; } else { S.selBones.add(id); S.selBone = id; } }
  else { S.selBone = id; S.selBones = new Set([id]); }
  refreshAll();
}
function selectedBoneIds() { const s = new Set(S.selBones); if (S.selBone) s.add(S.selBone); return [...s]; }
function posedFrames(B, f = S.frame) { return boneFrames(B, f); }
function reparentBone(B, b, pid) { // keeps the bone's world rest pose
  const rest = boneFrames(B, null), W = rest[b.id].F;
  b.parent = pid || null; sortBones(B);
  const PF = b.parent ? boneFrames(B, null)[b.parent].F : M.I(), lm = M.mul(M.inv(PF), W);
  b.x = round(lm[4]); b.y = round(lm[5]); b.a = round(Math.atan2(lm[1], lm[0]) / DEG);
  delete B.ch['bone:' + b.id + ':a']; delete B.ch['bone:' + b.id + ':p'];
}
function newBone(B, name, parent, x, y, a, len) {
  a = ((((a + 180) % 360) + 360) % 360) - 180;
  const b = { id: uid('b'), name, parent, x: round(x), y: round(y), a: round(a), len: round(Math.max(1, len)), s: 1, str: round(Math.max(1, len) * 0.45) };
  B.bones.push(b); return b;
}

// 1. Select Bone
defTool('bonesel', {
  icon: BIC.bonesel, name: 'Select bone', key: 'S', cursor: 'pointer', hint: 'Click a bone to select it · Shift-click adds more · rename it, recolour it and turn on physics in the bar above · drag on empty space to set the wind for bones with physics',
  down(e, sx, sy) {
    const B = activeBoneLayer(), hb = hitBone(B, sx, sy); selectBone(hb && hb.id, e.shiftKey); if (hb && currentTab !== 'props') setTab('props');
    if (!hb && B && B.bones.some((b) => b.dyn && b.dyn.on)) startDrag(e, { B, k: M.scaleOf(lcOf(B).full), wind: true });
  },
  move(e, sx, sy) { const d = Stage.drag; if (!d || !d.wind) return; if (!d.began) { beginEdit('Wind force'); d.began = true; } TOOLS.force.move(e, sx, sy); },
  up() { const d = Stage.drag; Stage.forceArrow = null; if (d && d.began) commitEdit(); },
});
// 2. Add Bone
defTool('boneadd', {
  icon: BIC.boneadd, name: 'Add bone', key: 'N', cursor: 'crosshair', hint: 'Drag from base to tip · the selected bone becomes the parent · Shift snaps angles',
  down(e, sx, sy) {
    const B = activeBoneLayer(); if (!requireSetup('Creating bones')) return;
    beginEdit('Add bone');
    const inv = M.inv(lcOf(B).full), p = M.ap(inv, sx, sy);
    const parent = S.selBone && boneOf(B, S.selBone) ? S.selBone : null;
    const PF = parent ? posedFrames(B, 0)[parent].F : M.I(), lp = M.ap(M.inv(PF), p[0], p[1]);
    const b = newBone(B, 'Bone ' + (B.bones.length + 1), parent, lp[0], lp[1], 0, 1);
    S.selBone = b.id; S.selBones = new Set([b.id]);
    startDrag(e, { B, b, inv, p, PF }); requestDraw();
  },
  move(e, sx, sy) {
    const d = Stage.drag; if (!d) return;
    const q = M.ap(d.inv, sx, sy), dx = q[0] - d.p[0], dy = q[1] - d.p[1];
    let a = (Math.atan2(dy, dx) - Math.atan2(d.PF[1], d.PF[0])) / DEG; if (e.shiftKey) a = Math.round(a / 15) * 15;
    d.b.a = round(a); d.b.len = round(Math.max(1, Math.hypot(dx, dy))); d.b.str = round(d.b.len * 0.45); requestDraw();
  },
  up() { const d = Stage.drag; if (d && d.b.len < 4) { d.b.len = 40; d.b.str = 18; } commitEdit(); },
});
// 3. Transform Bone
defTool('bonetf', {
  icon: BIC.bonetf, name: 'Transform bone', key: 'J', cursor: 'move', hint: 'Drag the base to move, near the tip to rotate · Setup edits the skeleton (art stays put) · on animation frames it keys the bone · Shift-drag tip = scale',
  down(e, sx, sy) {
    const B = activeBoneLayer(), hb = hitBone(B, sx, sy);
    if (!hb) { selectBone(null); return; }
    selectBone(hb.id);
    const setup = S.mode === 'setup', f = setup ? 0 : S.frame;
    if (!setup && S.frame === 0) return toast('Frame 0 is the setup pose — use Setup mode, or go to frame 1+ to animate', 'err');
    const fr = posedFrames(B, f), b = hb.b, PF = b.parent ? fr[b.parent].F : M.I(), ps = b.parent ? fr[b.parent].s : 1;
    const nearTip = Math.hypot(sx - hb.tip[0], sy - hb.tip[1]) < Math.hypot(sx - hb.base[0], sy - hb.base[1]);
    beginEdit(setup ? 'Transform rest bone' : 'Transform bone');
    const inv = M.inv(lcOf(B).full);
    startDrag(e, { B, b, setup, f, mode: nearTip ? (e.shiftKey && !setup ? 'scale' : 'tip') : 'base', inv, PF, ps, base: M.ap(fr[b.id].F, 0, 0), q0: M.ap(inv, sx, sy), p0: val(B, 'bone:' + b.id + ':p', f), len: b.len });
  },
  move(e, sx, sy) {
    const d = Stage.drag; if (!d) return;
    const q = M.ap(d.inv, sx, sy), b = d.b, B = d.B;
    if (d.mode === 'base') {
      if (d.setup) { const lp = M.ap(M.inv(d.PF), q[0], q[1]); setVal(B, 'bone:' + b.id + ':p', [round(lp[0] / d.ps - (b.ox || 0)), round(lp[1] - (b.oy || 0))], 0); }
      else { const dv = M.apv(M.inv(d.PF), q[0] - d.q0[0], q[1] - d.q0[1]); setVal(B, 'bone:' + b.id + ':p', [round(d.p0[0] + dv[0] / d.ps), round(d.p0[1] + dv[1])], d.f); }
    } else if (d.mode === 'scale') setVal(B, 'bone:' + b.id + ':s', round(Math.max(0.05, Math.hypot(q[0] - d.base[0], q[1] - d.base[1]) / d.len), 3), d.f);
    else {
      const ang = round((Math.atan2(q[1] - d.base[1], q[0] - d.base[0]) - Math.atan2(d.PF[1], d.PF[0])) / DEG);
      setVal(B, 'bone:' + b.id + ':a', ang, d.f);
      if (d.setup) { b.len = round(Math.max(2, Math.hypot(q[0] - d.base[0], q[1] - d.base[1]))); }
    }
    requestDraw();
  },
  up() { commitEdit(); },
});
// 4. Manipulate Bones
function solveIK(B, endId, target, f, chainLen = 3) {
  const chain = []; let id = endId;
  while (id && chain.length < chainLen) { const b = B.bones.find((x) => x.id === id); if (!b) break; chain.push(b); if (b.ikStop) break; id = b.parent; }
  const over = {}; for (const b of chain) over[b.id] = val(B, 'bone:' + b.id + ':a', f);
  for (let it = 0; it < 14; it++) {
    for (const b of chain) {
      const fr = boneFrames(B, f, over, true), endF = fr[endId], tip = M.ap(endF.F, endF.len, 0), base = M.ap(fr[b.id].F, 0, 0);
      const a1 = Math.atan2(tip[1] - base[1], tip[0] - base[0]), a2 = Math.atan2(target[1] - base[1], target[0] - base[0]);
      let na = over[b.id] + (a2 - a1) / DEG;
      while (na - over[b.id] > 180) na -= 360; while (na - over[b.id] < -180) na += 360;
      if (b.min !== undefined && b.max !== undefined && b.min < b.max) na = clamp(na, b.min, b.max);
      over[b.id] = na;
    }
  }
  return over;
}
function testSet(B, path, v) { B.ch[path] = { keys: [{ f: 0, v, i: 'smooth' }] }; } // temporary frame-0 pose used for rig tests (reverted on release)
defTool('bonemanip', {
  icon: BIC.bonemanip, name: 'Manipulate bones', key: 'M', cursor: 'grab', hint: 'Drag near the end of a chain — IK bends the parents · Alt rotates one bone · Shift moves it · in Setup it only tests the rig (snaps back on release)',
  down(e, sx, sy) {
    const B = activeBoneLayer(), hb = hitBone(B, sx, sy);
    if (!hb) { selectBone(null); return; }
    S.selBone = hb.id; S.selBones = new Set([hb.id]);
    const test = S.mode === 'setup';
    if (!test && S.frame === 0) { refreshAll(); return toast('Frame 0 is the starting (setup) pose — move to frame 1 or later to record a pose', 'err'); }
    beginEdit(test ? 'Test rig' : 'Pose bone');
    startDrag(e, { B, b: hb.b, test, inv: M.inv(lcOf(B).full), p0: val(B, 'bone:' + hb.id + ':p', S.frame), alt: e.altKey });
    refreshAll();
  },
  move(e, sx, sy) {
    const d = Stage.drag; if (!d) return;
    const B = d.B, b = d.b, q = M.ap(d.inv, sx, sy), f = d.test ? 0 : S.frame;
    const put = (path, v) => (d.test ? testSet(B, path, v) : setVal(B, path, v));
    if (e.shiftKey || d.shift) {
      const fr = boneFrames(B, f, null, true), PF = b.parent ? fr[b.parent].F : M.I(), ps = b.parent ? fr[b.parent].s : 1;
      const s0 = M.ap(d.inv, d.sx, d.sy), dv = M.apv(M.inv(PF), q[0] - s0[0], q[1] - s0[1]);
      put('bone:' + b.id + ':p', [round(d.p0[0] + dv[0] / ps), round(d.p0[1] + dv[1])]);
    } else if (S.ikMode && b.parent && !b.ikStop && !(e.altKey || d.alt)) {
      const over = solveIK(B, b.id, q, f, 3);
      for (const id in over) put('bone:' + id + ':a', round(over[id], 2));
    } else {
      const fr = boneFrames(B, f, null, true), base = M.ap(fr[b.id].F, 0, 0), PF = b.parent ? fr[b.parent].F : M.I();
      let a = (Math.atan2(q[1] - base[1], q[0] - base[0]) - Math.atan2(PF[1], PF[0])) / DEG;
      if (b.min !== undefined && b.max !== undefined && b.min < b.max) a = clamp(a, b.min, b.max);
      put('bone:' + b.id + ':a', round(a, 2));
    }
    requestDraw();
  },
  up() { const d = Stage.drag; if (d && d.test) { cancelEdit(); } else commitEdit(); },
});
// 5. Reparent Bone
defTool('reparent', {
  icon: BIC.reparent, name: 'Reparent bone', key: 'I', cursor: 'alias', hint: 'Select the bone(s) to move in the hierarchy (Select bone), then click the new parent · click empty space to make them root bones · bound artwork is unchanged',
  down(e, sx, sy) {
    const B = activeBoneLayer(), hb = hitBone(B, sx, sy);
    const ids = selectedBoneIds().filter((id) => !hb || id !== hb.id);
    if (!ids.length) { if (hb) selectBone(hb.id); return toast('Now click the bone that should become its parent', 'ok'); }
    let skipped = 0;
    edit('Reparent bone', () => {
      for (const id of ids) { const b = boneOf(B, id); if (!b) continue; if (hb && (hb.id === id || boneDescends(B, hb.id, id))) { skipped++; continue; } reparentBone(B, b, hb ? hb.id : null); }
    });
    toast(hb ? `Parent is now “${hb.b.name}”${skipped ? ` (${skipped} skipped — would create a loop)` : ''}` : 'Made root bone(s)', skipped ? 'err' : 'ok');
  },
});
// 6. Bone Strength
defTool('strength', {
  icon: BIC.strength, name: 'Bone strength', key: 'U', cursor: 'ew-resize', hint: 'Drag sideways on a bone to grow or shrink its influence region · unbound points inside a region bend with that bone (flexible binding)',
  down(e, sx, sy) {
    const B = activeBoneLayer(), hb = hitBone(B, sx, sy, 24); if (!hb) { selectBone(null); return; }
    selectBone(hb.id); beginEdit('Bone strength');
    startDrag(e, { b: hb.b, s0: hb.b.str || 0, k: M.scaleOf(lcOf(B).full) });
  },
  move(e, sx) { const d = Stage.drag; if (!d) return; d.b.str = round(Math.max(0, d.s0 + (sx - d.sx) / d.k)); requestDraw(); },
  up() { commitEdit(); },
});
// 7. Vitruvian Bones
defTool('vitruvian', {
  icon: BIC.vitruvian, name: 'Vitruvian bones', key: '', cursor: 'pointer', hint: 'Alternate bone constructions: Setup — pick a group in the bar and click bones to put them (and their children) in it · Animate — choose which group is active at the playhead',
  down(e, sx, sy) {
    const B = activeBoneLayer(), hb = hitBone(B, sx, sy, 10, true); if (!hb) return;
    if (S.mode !== 'setup') { selectBone(hb.id); return toast('Switch the active construction from the bar above (it keys at the playhead)'); }
    const g = this.opts.target; if (!g || !(B.vgroups || []).includes(g)) return toast('Add a construction group first (＋ Group in the bar)', 'err');
    const set = hb.b.vg === g ? '' : g;
    edit('Vitruvian group', () => { const mark = (id) => { const b = boneOf(B, id); b.vg = set; B.bones.filter((c) => c.parent === id).forEach((c) => mark(c.id)); }; mark(hb.id); });
    toast(set ? `“${hb.b.name}” and its children → ${g}` : `“${hb.b.name}” is shared by every construction`);
  },
  opts: { target: '' },
});
// 8. Sketch Bones
defTool('sketch', {
  icon: BIC.sketch, name: 'Sketch bones', key: 'W', cursor: 'crosshair', hint: 'Draw a stroke to create a whole chain of bones along it (tails, ropes, tentacles) · continues from the selected bone',
  down(e, sx, sy) { if (!requireSetup('Sketching bones')) return; startDrag(e, { B: activeBoneLayer() }); Stage.preview = { type: 'poly', pts: [[sx, sy]] }; },
  move(e, sx, sy) { if (!Stage.drag || !Stage.preview) return; const pts = Stage.preview.pts, l = pts[pts.length - 1]; if (Math.hypot(sx - l[0], sy - l[1]) > 3) pts.push([sx, sy]); requestDraw(); },
  up() {
    const d = Stage.drag, pv = Stage.preview; Stage.preview = null; if (!d || !pv || pv.pts.length < 3) return requestDraw();
    const B = d.B, inv = M.inv(lcOf(B).full), pts = pv.pts.map((p) => M.ap(inv, p[0], p[1]));
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = cum[cum.length - 1]; if (total < 10) return;
    const n = this.opts.count > 0 ? this.opts.count : clamp(Math.round(total / this.opts.seg), 2, 40);
    const at = (dist) => { let i = 1; while (i < cum.length - 1 && cum[i] < dist) i++; const t = (dist - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t)]; };
    const nodes = []; for (let k = 0; k <= n; k++) nodes.push(at((total * k) / n));
    edit('Sketch bones', () => {
      let parent = S.selBone && boneOf(B, S.selBone) ? S.selBone : null, prevAng = null, prevLen = 0;
      const base = parent ? posedFrames(B, 0)[parent].F : M.I();
      for (let k = 0; k < n; k++) {
        const p0 = nodes[k], p1 = nodes[k + 1], ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) / DEG, len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        let b;
        if (k === 0) { const lp = M.ap(M.inv(base), p0[0], p0[1]); b = newBone(B, 'Chain 1', parent, lp[0], lp[1], ang - Math.atan2(base[1], base[0]) / DEG, len); }
        else b = newBone(B, 'Chain ' + (k + 1), parent, prevLen, 0, ang - prevAng, len);
        parent = b.id; prevAng = ang; prevLen = b.len;
      }
      S.selBone = parent; S.selBones = new Set([parent]);
    });
    toast(`Created a chain of ${n} bones — refine them with Transform bone`, 'ok');
  },
  opts: { count: 0, seg: 60 },
});
// 9. Bind Layer
defTool('bind', {
  icon: BIC.bind, name: 'Bind layer', key: 'L', cursor: 'alias', hint: 'Select an artwork layer (vector, image, switch, group…) inside the Bone Group, then click a bone — the whole layer follows it as one unit · click empty space to clear the attachment',
  down(e, sx, sy) {
    const L = selLayer(); const B = activeBoneLayer();
    if (!L || !B || L === B) return toast('Select a layer inside a Bone Group first');
    if (!requireSetup('Binding')) return;
    const hb = hitBone(B, sx, sy);
    if (!hb && !L.bindBone) return;
    edit(hb ? 'Bind layer' : 'Unbind layer', () => { L.bindBone = hb ? hb.id : null; });
    if (hb) selectBone(hb.id);
    toast(hb ? `“${L.name}” now follows ${hb.b.name} as one unit` : `“${L.name}” is no longer attached to a single bone — its point and flexi-binding settings apply again`, 'ok');
  },
});
// 10. Bind Points
defTool('bindpts', {
  icon: BIC.bindpts, name: 'Bind points', key: 'D', cursor: 'crosshair', hint: 'Select points (click / drag a box), then click a bone to bind them to it · click a bone with nothing selected to see its points',
  down(e, sx, sy) {
    const L = selLayer(), B = activeBoneLayer();
    if (!requireSetup('Binding points')) return;
    const pid = hitPoint(L, sx, sy, 7);
    if (pid) { if (e.shiftKey) S.selPts.has(pid) ? S.selPts.delete(pid) : S.selPts.add(pid); else S.selPts = new Set([pid]); refreshAll(); return; }
    const hb = hitBone(B, sx, sy);
    if (hb) {
      if (!S.selPts.size) { S.selPts = new Set(Object.keys(L.pts).filter((id) => (L.pts[id].b || []).some((q) => q[0] === hb.id))); selectBone(hb.id); return toast(`${S.selPts.size} point(s) are bound to ${hb.b.name}`); }
      const n = S.selPts.size;
      edit('Bind points', () => { for (const id of S.selPts) L.pts[id].b = [[hb.id, 1]]; L.bindBone = null; });
      selectBone(hb.id); return toast(`Bound ${n} point(s) to ${hb.b.name}`, 'ok');
    }
    if (!e.shiftKey) S.selPts = new Set();
    startDrag(e, { mode: 'marquee', L, base: new Set(S.selPts) }); refreshAll();
  },
  move(e, sx, sy) { const d = Stage.drag; if (d && d.mode === 'marquee') TOOLS.points.move.call(TOOLS.points, e, sx, sy); },
  up() { Stage.preview = null; refreshAll(); },
});
// 11. Offset Bone
defTool('offset', {
  icon: BIC.offset, name: 'Offset bone', key: 'G', cursor: 'move', hint: 'Exploded rig: draw parts apart, bind them, then drag their bones into place — the art moves with them · Alt-click resets a bone\'s offset',
  down(e, sx, sy) {
    const B = activeBoneLayer(), hb = hitBone(B, sx, sy); if (!hb) { selectBone(null); return; }
    if (!requireSetup('Offsetting bones')) return;
    selectBone(hb.id);
    if (e.altKey) return edit('Reset bone offset', () => { hb.b.ox = 0; hb.b.oy = 0; });
    const fr = posedFrames(B, 0), b = hb.b, PF = b.parent ? fr[b.parent].F : M.I(), ps = b.parent ? fr[b.parent].s : 1;
    beginEdit('Offset bone'); const inv = M.inv(lcOf(B).full);
    startDrag(e, { b, PF, ps, inv, q0: M.ap(inv, sx, sy), ox: b.ox || 0, oy: b.oy || 0 });
  },
  move(e, sx, sy) { const d = Stage.drag; if (!d) return; const q = M.ap(d.inv, sx, sy), dv = M.apv(M.inv(d.PF), q[0] - d.q0[0], q[1] - d.q0[1]); d.b.ox = round(d.ox + dv[0] / d.ps); d.b.oy = round(d.oy + dv[1]); requestDraw(); },
  up() { commitEdit(); },
});
// 12. Bone Physics
defTool('physics', {
  icon: BIC.physics, name: 'Bone physics', key: '', cursor: 'pointer', hint: 'Click a bone to give it springy follow-through (hair, tails, ears, antennae) · tune spring and damping in the bar · forces come from the Force tool',
  down(e, sx, sy) {
    const B = activeBoneLayer(), hb = hitBone(B, sx, sy); if (!hb) { selectBone(null); return; }
    if (!requireSetup('Bone physics')) return;
    selectBone(hb.id);
    const on = !(hb.b.dyn && hb.b.dyn.on);
    edit(on ? 'Enable bone physics' : 'Disable bone physics', () => { hb.b.dyn = { spring: 60, damp: 11, inertia: 0.6, lockTip: false, ...(hb.b.dyn || {}), on }; });
    toast(on ? `Physics on for ${hb.b.name} — it now swings after its parent moves` : `Physics off for ${hb.b.name}`, 'ok');
  },
});
// 13. Force
defTool('force', {
  icon: BIC.force, name: 'Force (wind & gravity)', key: '', cursor: 'crosshair', hint: 'Drag on the stage to set wind direction and strength for bones with physics · gravity and turbulence are in the bar',
  down(e, sx, sy) { const B = activeBoneLayer(); beginEdit('Wind force'); startDrag(e, { B, k: M.scaleOf(lcOf(B).full) }); },
  move(e, sx, sy) {
    const d = Stage.drag; if (!d) return; const B = d.B; B.force = B.force || {};
    const dx = sx - d.sx, dy = sy - d.sy; B.force.windA = round(Math.atan2(dy, dx) / DEG); B.force.windS = round((Math.hypot(dx, dy) / d.k) * 1.5);
    Stage.forceArrow = [d.sx, d.sy, sx, sy]; requestDraw();
  },
  up() { Stage.forceArrow = null; commitEdit(); },
});

function autoBindPoints(L, B, ids, allowed) { // weighted binding by distance to bone segments (rest pose); allowed = bone ids that may participate
  const lc = evalLC(L, 0), rest = boneFrames(B, null);
  const segs = B.bones.filter((b) => !allowed || allowed.includes(b.id)).map((b) => ({ id: b.id, a: M.ap(rest[b.id].F, 0, 0), b: M.ap(rest[b.id].F, b.len, 0) }));
  if (!segs.length) return 0;
  let n = 0;
  for (const id of ids) {
    const pt = L.pts[id]; if (!pt) continue;
    const p = M.ap(lc.relPts, pt.x, pt.y);
    const ds = segs.map((s) => ({ id: s.id, d: distToSeg(p[0], p[1], s.a, s.b) })).sort((a, b) => a.d - b.d);
    const near = ds.slice(0, 2), d0 = near[0].d + 1;
    const ws = near.map((x) => [x.id, 1 / Math.pow(x.d + 1, 3)]).filter((w, i) => i === 0 || near[i].d < d0 * 2.2 + 25);
    const sum = ws.reduce((s, w) => s + w[1], 0);
    pt.b = ws.map(([bid, w]) => [bid, round(w / sum, 3)]); n++;
  }
  L.bindBone = null;
  return n;
}

// --- Emitter
defTool('emitter', {
  icon: '✦', name: 'Particle emitter', key: 'Q', cursor: 'crosshair', hint: 'Click to place a particle emitter using the preset below',
  down(e, sx, sy) {
    edit('Add emitter', () => {
      const L = mkLayer('particle', this.opts.preset + ' emitter');
      applyParticlePreset(L, this.opts.preset);
      const w = M.ap(M.inv(M.mul(viewM(), camFn(S.frame)(0))), sx, sy);
      L.p.x = round(w[0]); L.p.y = round(w[1]); L.startF = S.frame;
      S.doc.layers.unshift(L); S.selLayers = [L.id];
    });
  },
  opts: { preset: 'Dust' },
});

// --- Camera
defTool('camera', {
  icon: '🎥', name: 'Camera', key: 'K', cursor: 'move', hint: 'Drag = track · Shift-drag = zoom · Alt-drag = roll · keys the camera at the current frame',
  down(e, sx, sy) { const c = S.doc.camera; beginEdit('Camera'); startDrag(e, { x: val(c, 'x', S.frame), y: val(c, 'y', S.frame), zoom: val(c, 'zoom', S.frame), roll: val(c, 'roll', S.frame), inv: M.inv(M.mul(viewM(), camFn(S.frame)(0))) }); },
  move(e, sx, sy) {
    const d = Stage.drag; if (!d) return; const c = S.doc.camera;
    if (e.shiftKey) setVal(c, 'zoom', round(clamp(d.zoom * Math.exp(-(sy - d.sy) / (200 * Stage.dpr)), 0.05, 50), 3));
    else if (e.altKey) setVal(c, 'roll', round(d.roll + (sx - d.sx) / (3 * Stage.dpr), 2));
    else { const v = M.apv(d.inv, sx - d.sx, sy - d.sy); setVal(c, 'x', round(d.x - v[0])); setVal(c, 'y', round(d.y - v[1])); }
    requestDraw();
  },
  up() { commitEdit(); },
});

// --- Workspace
defTool('pan', { icon: '✥', name: 'Pan workspace', key: 'H', cursor: 'grab', hint: 'Drag to pan the view (or hold Space / middle mouse in any tool)',
  down(e) { startDrag(e, { px: S.view.panX, py: S.view.panY }); },
  move(e, sx, sy) { const d = Stage.drag; if (!d) return; S.view.panX = d.px + (sx - d.sx) / Stage.dpr; S.view.panY = d.py + (sy - d.sy) / Stage.dpr; requestDraw(); },
  up() {} });
defTool('zoom', { icon: '🔍', name: 'Zoom workspace', key: 'Z', cursor: 'zoom-in', hint: 'Click to zoom in · Alt-click to zoom out · wheel zooms anywhere',
  down(e, sx, sy) { zoomAt(sx, sy, e.altKey ? 1 / 1.4 : 1.4); }, move() {}, up() {} });

function zoomAt(sx, sy, k) {
  const before = M.ap(M.inv(viewM()), sx, sy);
  S.view.zoom = clamp(S.view.zoom * k, 0.03, 40);
  const after = M.ap(viewM(), before[0], before[1]);
  S.view.panX -= (after[0] - sx) / Stage.dpr; S.view.panY -= (after[1] - sy) / Stage.dpr;
  requestDraw();
}
function fitView() {
  const r = Stage.cv.getBoundingClientRect(); if (r.width < 80 || r.height < 80) return requestDraw(); // stage hidden (e.g. Composition open): keep the current view
  S.view.zoom = Math.min((r.width - 60) / S.doc.w, (r.height - 60) / S.doc.h); S.view.panX = 0; S.view.panY = 0; S.view.rot = 0; requestDraw();
}

// ---------- stage input ----------
function initStage() {
  Stage.cv = $('#stage'); Stage.ctx = Stage.cv.getContext('2d');
  UI.stage = renderStage;
  const pos = (e) => { const r = Stage.cv.getBoundingClientRect(); return [(e.clientX - r.left) * Stage.dpr, (e.clientY - r.top) * Stage.dpr]; };
  let panDrag = null;
  Stage.cv.addEventListener('pointerdown', (e) => {
    Stage.cv.setPointerCapture(e.pointerId);
    const [sx, sy] = (Stage.mouse = pos(e));
    Stage.mods = { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    // Workspace navigation never edits the scene: right-drag pans, Shift+right-drag zooms, Ctrl/Cmd+right-drag rotates the view.
    if (e.button === 2) { const c = M.ap(M.t(Stage.cv.width / 2 + S.view.panX * Stage.dpr, Stage.cv.height / 2 + S.view.panY * Stage.dpr), 0, 0); panDrag = { mode: e.shiftKey ? 'zoom' : (e.ctrlKey || e.metaKey) ? 'rotate' : 'pan', sx, sy, px: S.view.panX, py: S.view.panY, zoom: S.view.zoom, rot: S.view.rot || 0, c }; Stage.cv.style.cursor = panDrag.mode === 'pan' ? 'grabbing' : panDrag.mode === 'zoom' ? 'zoom-in' : 'alias'; return; }
    if (e.button === 1 || Stage.space || (e.button === 0 && S.tool === 'pan')) { panDrag = { mode: 'pan', sx, sy, px: S.view.panX, py: S.view.panY }; Stage.cv.style.cursor = 'grabbing'; return; }
    if (e.button !== 0) return;
    if (S.playing) stopPlay();
    const why = toolAvail(S.tool); if (why) return toast(why, 'err');
    const t = TOOLS[S.tool];
    if (t && t.down) t.down(e, sx, sy);
  });
  Stage.cv.addEventListener('pointermove', (e) => {
    const [sx, sy] = (Stage.mouse = pos(e));
    Stage.mods = { alt: e.altKey, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    if (panDrag) {
      if (panDrag.mode === 'zoom') { const k = clamp(panDrag.zoom * Math.exp(-(sy - panDrag.sy) / (150 * Stage.dpr)), 0.03, 40) / S.view.zoom; zoomAt(panDrag.sx, panDrag.sy, k); return; }
      if (panDrag.mode === 'rotate') { const a = Math.atan2(sy - panDrag.c[1], sx - panDrag.c[0]) - Math.atan2(panDrag.sy - panDrag.c[1], panDrag.sx - panDrag.c[0]); S.view.rot = panDrag.rot + a; requestDraw(); return; }
      S.view.panX = panDrag.px + (sx - panDrag.sx) / Stage.dpr; S.view.panY = panDrag.py + (sy - panDrag.sy) / Stage.dpr; requestDraw(); return; }
    const d = Stage.drag;
    if (d) { if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) > 2) d.moved = true; if (d.moved) TOOLS[S.tool].move(e, sx, sy); }
    else if (S.tool === 'pen' || (S.tool === 'linewidth' && typeof VEC !== 'undefined' && VEC.lwMagnet)) requestDraw();
  });
  const end = (e) => {
    if (panDrag) { panDrag = null; setCursor(); return; }
    const d = Stage.drag; if (!d) return;
    if(e.type==='pointercancel'){cancelEdit();Stage.drag=null;Stage.preview=null;Stage.vectorLasso=null;requestDraw();return;}
    const t = TOOLS[S.tool]; if (t && t.up) t.up(e);
    Stage.drag = null; Stage.preview = null; requestDraw();
  };
  Stage.cv.addEventListener('contextmenu', (e) => e.preventDefault());
  Stage.cv.addEventListener('pointerup', end);
  Stage.cv.addEventListener('pointercancel', end);
  Stage.cv.addEventListener('dblclick', (e) => {
    const [sx, sy] = pos(e); const t = TOOLS[S.tool];
    if (t && t.dbl) t.dbl(e, sx, sy);
    else if (S.tool === 'pen' && Stage.pen) finishPen(false);
    // Transform Layer keeps its target; use the Points tool to edit artwork.
  });
  Stage.cv.addEventListener('wheel', (e) => {
    e.preventDefault(); const [sx, sy] = pos(e);
    if (e.ctrlKey || e.metaKey || !e.shiftKey) zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015));
    else { S.view.panX -= e.deltaY * 0.5; requestDraw(); }
  }, { passive: false });
  new ResizeObserver(() => requestDraw()).observe(Stage.cv);
  // toolbar
  const tb = $('#toolbar');
  for (const [g, ids] of TOOL_GROUPS) {
    const lab = document.createElement('div'); lab.className = 'tg'; lab.dataset.group = g; lab.textContent = g; tb.appendChild(lab);
    for (const id of ids) {
      const t = TOOLS[id], b = document.createElement('button');
      b.dataset.tool = id; b.innerHTML = t.icon; b.title = `${t.name}${t.key ? ' ('+t.key+')' : ''}\n${t.hint}`;
      b.onclick = () => setTool(id); tb.appendChild(b);
    }
  }
  $$('#stagehud [data-view]').forEach((b) => (b.onclick = () => {
    const v = b.dataset.view;
    if (v === 'fit') fitView(); else if (v === '100') { S.view.zoom = 1; requestDraw(); }
    else { S.outputOnly = !S.outputOnly; b.classList.toggle('on', S.outputOnly); requestDraw(); }
  }));
}

// ---------- breadcrumb ----------
function renderCrumbs() {
  const el = $('#crumbs'); if (!el) return;
  const L = selLayer(); let h = '<span class="cr root" data-crumb="">Scene</span>';
  if (S.camSel) h += '<span class="sepc">›</span><span class="cr on">🎥 Camera</span>';
  else if (L) {
    for (const A of ancestors(L.id).reverse().concat([L])) h += `<span class="sepc">›</span><span class="cr ${A === L ? 'on' : ''}" data-crumb="${A.id}">${LAYER_TYPES[A.type].icon} ${esc(A.name)} <i>${LAYER_TYPES[A.type].name}</i></span>`;
    const B = activeBoneLayer(), b = B && S.selBone && B.bones.find((x) => x.id === S.selBone);
    if (b && (BONE_TOOLS.has(S.tool) || L === B)) h += `<span class="sepc">›</span><span class="cr bone">🦴 ${esc(b.name)}</span>`;
    const ia = editingInactiveAlt();
    if (ia) h += `<span class="crwarn" title="You are editing a drawing that is not the active one at this frame. Nothing is keyed.">editing an inactive alternative of ${esc(ia.sw.name)} · not keyed</span>`;
  }
  if (S.mode === 'setup') h += '<span class="crmode">SETUP</span>';
  if (el._h === h) return; el._h = h; el.innerHTML = h;
  el.querySelectorAll('[data-crumb]').forEach((c) => (c.onclick = () => { S.camSel = false; S.selLayers = c.dataset.crumb ? [c.dataset.crumb] : []; S.selPts = new Set(); S.selShape = null; refreshAll(); }));
}

// ---------- switch helpers (preview vs. edit vs. set active) ----------
function swShown(SW) { return S.swPreview[SW.id] || switchOverrides()[SW.id] || switchState(SW, S.frame).cur; }
function swPreviewStep(SW, d) {
  const n = SW.children.length; if (!n) return;
  const i = SW.children.findIndex((c) => c.id === swShown(SW));
  S.swPreview[SW.id] = SW.children[(i + d + n) % n].id; refreshAll();
}
function swSetActive(SW, id) {
  id = id || swShown(SW); const c = SW.children.find((x) => x.id === id); if (!c) return;
  edit('Set active: ' + c.name, () => setVal(SW, 'sw', id, S.frame, true));
  delete S.swPreview[SW.id]; toast(`“${c.name}” is active from frame ${S.frame}`, 'ok');
}
function contentBox(L, f = S.frame) { // bounds of a layer's artwork in its parent's space
  const pts = [];
  const gather = (A, m) => {
    if (A.type === 'vector') { const P = deformedPts(A, f, null); for (const k in P) pts.push(M.ap(m, P[k][0], P[k][1])); }
    if (A.type === 'image') for (const [x, y] of [[-1, -1], [1, 1]]) pts.push(M.ap(m, (x * A.iw) / 2, (y * A.ih) / 2));
    if (A.children) A.children.forEach((c) => gather(c, M.mul(m, layerLocalM(c, f))));
  };
  gather(L, layerLocalM(L, f));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
function alignAlternatives(SW) {
  edit('Align alternatives', () => {
    for (const c of SW.children) {
      const b = contentBox(c); if (!b) continue;
      const cx = round((b[0] + b[2]) / 2), cy = round((b[1] + b[3]) / 2);
      c.p.x -= cx; c.p.y -= cy;
      if (c.ch.x) c.ch.x.keys.forEach((k) => (k.v -= cx)); if (c.ch.y) c.ch.y.keys.forEach((k) => (k.v -= cy));
    }
  });
  toast('Every alternative is now centred on the switch’s registration point', 'ok');
}
function bindingInfo(L) {
  const B = boneLayerFor(L); if (!B) return null;
  if (L.bindBone) { const b = B.bones.find((x) => x.id === L.bindBone); return { B, mode: 'Attached', text: `Attached to: ${b ? b.name : '?'}` }; }
  const flexNote = L.flexi === false ? 'flexi-binding off' : Array.isArray(L.flexiBones) ? `flexi-binding limited to ${L.flexiBones.length} bone(s)` : 'flexi-binding to all bones';
  if (L.type === 'vector') {
    const pts = Object.values(L.pts), bound = pts.filter((p) => p.b && p.b.length), wt = bound.filter((p) => p.b.length > 1), released = pts.filter((p) => Array.isArray(p.b) && !p.b.length);
    if (bound.length || released.length) return { B, mode: wt.length ? 'Weighted' : 'Points', text: `Binding: ${bound.length}/${pts.length} points bound${wt.length ? ' (weighted)' : ''}${released.length ? `, ${released.length} released` : ''}; other points: ${flexNote}` };
  }
  if (L.type === 'vector' && L.flexi === false) return { B, mode: 'Released', text: 'Released — flexi-binding is off, so the skeleton does not move this layer' };
  if (L.type === 'vector' && Array.isArray(L.flexiBones) && B.bones.some((b) => b.str > 0)) return { B, mode: 'Flexible', text: `Binding: Flexible — ${flexNote}` };
  if (L.type === 'bone') return { B, mode: 'Nested', text: 'Nested rig: moved by the parent only if attached; it deforms its own artwork' };
  if (L.type === 'vector' && !ancestors(L.id).some((a) => a !== B && a.bindBone && boneLayerFor(a) === B) && B.bones.some((b) => b.str > 0)) return { B, mode: 'Flexible', text: 'Binding: Flexible — bends with bones whose strength region covers it' };
  return { B, mode: 'None', text: 'Not bound — the skeleton does not move this layer yet' };
}

// ---------- context toolbar: tool options + what the selected layer can do ----------
function contextHTML() {
  const L = selLayer(), n = S.selLayers.length, btn = (a, label, title = '') => `<button class="btn" ${a} title="${esc(title)}">${label}</button>`;
  if (S.camSel) return `<span class="chip">🎥 Camera</span>${btn('data-tool="camera"', 'Camera tool')}${btn('data-cmd="cam.shake"', 'Shake at playhead')}`;
  if (!L) return `<span class="chip">Nothing selected — drawing creates a new vector layer</span>${btn('data-cmd="layer.new"', '＋ Add layer')}`;
  if (n > 1) {
    const types = [...new Set(S.selLayers.map((id) => findLayer(id)).filter(Boolean).map((l) => l.type))];
    return `<span class="chip">${n} layers (${types.map((t) => LAYER_TYPES[t].name).join(', ')}) — shared: transform, opacity, effects${types.includes('audio') ? '; audio: timing only' : ''}</span>${btn('data-cmd="layer.group"', 'Group them')}`;
  }
  let h = '';
  const bi = bindingInfo(L);
  const P = parentOf(L.id);
  if (P && P.type === 'switch') {
    const active = switchState(P, S.frame).cur === L.id;
    h += `<span class="chip">Alternative of <b>${esc(P.name)}</b> · ${active ? 'active now' : 'not active at this frame'}</span>${active ? '' : btn('data-ctx="swactivatesel"', 'Set active at playhead', 'Key this drawing as the visible one at the current frame')}`;
  }
  switch (L.type) {
    case 'vector':
      h += `<span class="chip">Vector · ${Object.keys(L.pts).length} points · ${L.shapes.length} shapes</span>${btn('data-tool="points"', 'Edit points')}`;
      break;
    case 'image': h += `<span class="chip">Image · ${L.iw}×${L.ih}</span>${btn('data-cmd="img.native"', 'Native size')}`; break;
    case 'text': h += `<span class="chip">Text — edit the words in Properties</span>`; break;
    case 'audio': h += `<span class="chip">Audio · starts at frame ${L.offset}</span>${btn('data-cmd="ai.lipsync"', '✦ Lip sync…')}${btn('data-cmd="audio.fitend"', 'Fit timeline')}`; break;
    case 'particle': h += `<span class="chip">Particles · ${L.mode}</span><select data-ctx="preset">${['', ...Object.keys(PARTICLE_PRESETS)].map((k) => `<option value="${k}" ${k === (L.preset || '') ? 'selected' : ''}>${k || 'Preset…'}</option>`).join('')}</select>`; break;
    case 'group':
      h += `<span class="chip" title="Effects on a child apply to that child only; effects on the group apply after its children are combined">Group · ${L.children.length} children · group effects apply to the combined result</span>${btn('data-cmd="layer.newinside"', '＋ Vector layer inside')}`;
      break;
    case 'bone':
      h += `<span class="chip">Bone Group · ${L.bones.length} bones · ${S.mode === 'setup' ? 'Setup' : 'Animate'}</span>`;
      if (S.mode === 'setup') h += btn('data-cmd="rig.test"', 'Test deformation') + btn('data-tab="props"', 'Rig settings');
      else h += btn('data-cmd="pose.save"', 'Save pose') + btn('data-cmd="pose.apply"', 'Pose library') + btn('data-cmd="anim.keyall"', 'Key pose');
      h += btn('data-cmd="layer.newinside"', '＋ Vector layer inside');
      break;
    case 'switch': {
      const shown = swShown(L), prev = S.swPreview[L.id];
      h += `<span class="chip">Switch Group</span><label>Showing <select data-ctx="swpick">${L.children.map((c) => `<option value="${c.id}" ${c.id === shown ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>`;
      h += btn('data-ctx="swprev"', '◀', 'Preview previous alternative') + btn('data-ctx="swnext"', '▶', 'Preview next alternative');
      h += btn('data-ctx="swset" class="btn pri"', `Set active at frame ${S.frame}`, 'Key the shown alternative at the playhead');
      if (prev) h += `<span class="chip warn">preview only — not keyed</span>${btn('data-ctx="swclear"', 'Clear preview')}`;
      h += btn('data-cmd="switch.addchild"', '＋ Alternative') + btn('data-ctx="swalign"', 'Align') + `<label title="Ghost every alternative over the registration point"><input type="checkbox" data-ctx="swoverlay" ${S.alignOverlay ? 'checked' : ''}>Overlay</label>` + btn('data-tab="switch"', 'Switch editor') + btn('data-cmd="ai.lipsync"', '✦ Lip sync');
      break;
    }
  }
  if (bi && L.type !== 'bone') {
    h += `<span class="chip rig" title="This layer lives inside a Bone Group">Controlled by: <b>${esc(bi.B.name)}</b> · ${esc(bi.text)}</span>`;
    if (S.mode === 'animate') h += btn('data-ctx="poseparent"', '✋ Pose parent rig', 'Pose the parent skeleton without changing which layer is selected');
    else h += btn('data-tool="bind"', '🔗 Attach') + (L.type === 'vector' ? btn('data-cmd="rig.autobind"', 'Bind points…') : '');
  } else if (bi && L.type === 'bone') h += `<span class="chip rig">${esc(bi.text)}</span>`;
  return h;
}
function renderToolOpts() {
  const t = TOOLS[S.tool], el = $('#toolopts'); if (!t) return;
  if (el.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
  const ns = S.newStyle;
  let h = `<span class="tname" title="${esc(t.hint)}">${t.icon} ${esc(t.name)}</span>`;
  const styleCtl = `<label title="New-shape fill"><input type="checkbox" data-o="fillOn" ${ns.fillOn ? 'checked' : ''}>Fill <input type="color" data-o="fill" value="${ns.fill}"></label>
    <label title="New-shape stroke"><input type="checkbox" data-o="strokeOn" ${ns.strokeOn ? 'checked' : ''}>Stroke <input type="color" data-o="stroke" value="${ns.stroke}"></label>
    <label>Width <input type="number" data-o="width" value="${ns.width}" min="0" step="0.5"></label>`;
  let opts = '';
  if (['pen', 'freehand', 'rect', 'ellipse', 'polygon', 'fill'].includes(S.tool)) opts += styleCtl;
  if (S.tool === 'pen') opts += `<label><input type="checkbox" data-pen="smooth" ${TOOLS.pen.opts.smooth ? 'checked' : ''}>Smooth points</label><button class="btn" id="penDone">Finish path ⏎</button>`;
  if (S.tool === 'freehand') opts += `<label>Simplify <input type="range" min="0" max="12" step="1" data-g="freehandSmooth" value="${S.freehandSmooth}"></label>`;
  if (S.tool === 'polygon') opts += `<label>Sides <input type="number" min="3" max="24" data-g="polySides" value="${S.polySides}"></label><label><input type="checkbox" data-g="polyStar" ${S.polyStar ? 'checked' : ''}>Star</label>`;
  const Bt = activeBoneLayer(), sb = Bt && boneOf(Bt, S.selBone);
  if (S.tool === 'bonemanip') opts += `<label><input type="checkbox" data-g="ikMode" ${S.ikMode ? 'checked' : ''}>IK (drag pulls parents)</label><span class="chip">Alt = rotate one bone · Shift = move</span>${S.mode === 'setup' ? '<span class="chip warn">Setup: testing only — the pose snaps back</span>' : ''}`;
  if (S.tool === 'strength') opts += sb ? `<label>Strength of <b>${esc(sb.name)}</b> <input type="number" min="0" data-bopt="str" value="${sb.str || 0}"></label><button class="btn" data-ctx="strauto">Auto (45% of length)</button><button class="btn" data-ctx="strzero">Off</button>` : '<span class="chip">Drag sideways on a bone</span>';
  if (S.tool === 'vitruvian' && Bt) {
    const gs = Bt.vgroups || [], tgt = TOOLS.vitruvian.opts.target;
    opts += `<label>Assign to <select data-ctx="vtarget">${gs.map((g) => `<option ${g === tgt ? 'selected' : ''}>${esc(g)}</option>`).join('') || '<option value="">— no groups —</option>'}</select></label><button class="btn" data-ctx="vadd">＋ Group</button>`;
    if (gs.length) opts += `<label>Active at frame ${S.frame} <select data-ctx="vactive">${gs.map((g) => `<option ${g === vitActive(Bt, S.frame) ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select></label>`;
  }
  if (S.tool === 'sketch') opts += `<label>Bones <input type="number" min="0" max="40" data-sk="count" value="${TOOLS.sketch.opts.count}" title="0 = automatic from segment length"></label><label>Segment length <input type="number" min="5" data-sk="seg" value="${TOOLS.sketch.opts.seg}"></label>`;
  if (S.tool === 'offset' && Bt) opts += `<span class="chip">${Bt.bones.filter((b) => b.ox || b.oy).length} bone(s) offset</span><button class="btn" data-ctx="offreset">Reset all offsets</button>`;
  if (S.tool === 'physics') opts += sb ? `<label><input type="checkbox" data-dyn="on" ${sb.dyn && sb.dyn.on ? 'checked' : ''}>Physics on <b>${esc(sb.name)}</b></label>${sb.dyn && sb.dyn.on ? `<label>Spring <input type="number" min="1" data-dyn="spring" value="${sb.dyn.spring ?? 60}"></label><label>Damping <input type="number" min="0" step="0.5" data-dyn="damp" value="${sb.dyn.damp ?? 11}"></label><label>Inertia <input type="number" min="0" step="0.1" data-dyn="inertia" value="${sb.dyn.inertia ?? 0.6}"></label><label><input type="checkbox" data-dyn="lockTip" ${sb.dyn.lockTip ? 'checked' : ''}>Stiff (return to neutral faster)</label>` : ''}` : '<span class="chip">Click a bone</span>';
  if (S.tool === 'force' && Bt) { const fo = Bt.force || {}; opts += `<label>Wind <input type="number" min="0" data-force="windS" value="${fo.windS || 0}"></label><label>Direction° <input type="number" data-force="windA" value="${fo.windA || 0}"></label><label>Turbulence <input type="number" min="0" max="3" step="0.1" data-force="turb" value="${fo.turb || 0}"></label><label>Gravity <input type="number" min="0" data-force="gravS" value="${fo.gravS || 0}"></label><label>Direction° <input type="number" data-force="gravA" value="${fo.gravA ?? 90}"></label>`; }
  if (S.tool === 'bonesel' && Bt) {
    if (sb) opts += `<label>Name <input type="text" data-bname value="${esc(sb.name)}" style="width:110px" title="Rename the bone (the label on the bone uses this name)"></label><label>Colour <input type="color" data-bcolor value="${sb.color && sb.color[0] === '#' ? sb.color : '#6e8cff'}"></label>${sb.color ? '<button class="btn" data-ctx="bcolreset" title="Back to the default bone colour">Reset colour</button>' : ''}`;
    else opts += '<span class="chip">Click a bone to rename, recolour or give it physics</span>';
    opts += `<label title="Show each bone's name on the bone"><input type="checkbox" data-ctx="blabels" ${S.boneLabels ? 'checked' : ''}>Labels</label>`;
    if (sb) opts += '<span class="sep"></span><span class="chip">Physics</span>' + sb ? `<label><input type="checkbox" data-dyn="on" ${sb.dyn && sb.dyn.on ? 'checked' : ''}>Physics on <b>${esc(sb.name)}</b></label>${sb.dyn && sb.dyn.on ? `<label>Spring <input type="number" min="1" data-dyn="spring" value="${sb.dyn.spring ?? 60}"></label><label>Damping <input type="number" min="0" step="0.5" data-dyn="damp" value="${sb.dyn.damp ?? 11}"></label><label>Inertia <input type="number" min="0" step="0.1" data-dyn="inertia" value="${sb.dyn.inertia ?? 0.6}"></label><label><input type="checkbox" data-dyn="lockTip" ${sb.dyn.lockTip ? 'checked' : ''}>Stiff (return to neutral faster)</label>` : ''}` : '<span class="chip">Click a bone</span>';
    if (Bt.bones.some((b) => b.dyn && b.dyn.on)) { opts += '<span class="sep"></span><span class="chip" title="Drag on empty stage space to set the wind">Force</span>'; const fo = Bt.force || {}; opts += `<label>Wind <input type="number" min="0" data-force="windS" value="${fo.windS || 0}"></label><label>Direction° <input type="number" data-force="windA" value="${fo.windA || 0}"></label><label>Turbulence <input type="number" min="0" max="3" step="0.1" data-force="turb" value="${fo.turb || 0}"></label><label>Gravity <input type="number" min="0" data-force="gravS" value="${fo.gravS || 0}"></label><label>Direction° <input type="number" data-force="gravA" value="${fo.gravA ?? 90}"></label>`;  }
  }
  if (S.tool === 'select' || S.tool === 'rotxy') opts += layerPosHTML();
  if (S.tool === 'bindpts' && Bt) { const Lb = selLayer(), groups = (Lb && Lb.pointGroups) || [];
    opts += `<label>Bone <select data-ctx="bindbone"><option value="">— select bone —</option>${Bt.bones.map((b) => `<option value="${b.id}" ${b.id === S.selBone ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>`
      + `<select data-ctx="bindgroup" aria-label="Select point group"><option value="">Select group</option>${groups.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>`
      + `<button class="btn" data-cmd="rig.bindpts" title="Assign the selected points to the selected bone (Space)">Bind points</button><button class="btn" data-cmd="rig.unbindpts" title="Release the selected points: no bone moves them">Un-bind points</button><button class="btn" data-cmd="rig.flexipts" title="Return the selected points to automatic flexi-binding">Flexi-bind points</button>`
      + `<label><input type="checkbox" data-ctx="bindlasso" ${typeof VEC !== 'undefined' && VEC.lasso ? 'checked' : ''}>Lasso mode</label><span class="chip">${S.selPts.size} point(s) selected · Alt-click a bone to target it</span>`; }
  if (S.tool === 'reparent') opts += `<span class="chip">${selectedBoneIds().length ? 'Moving: ' + esc(selectedBoneIds().map((id) => (boneOf(Bt, id) || {}).name).join(', ')) + ' → click the new parent' : 'Select bone(s) first'}</span>`;
  if (S.tool === 'emitter') opts += `<label>Preset <select id="emPreset">${Object.keys(PARTICLE_PRESETS).map((k) => `<option ${k === TOOLS.emitter.opts.preset ? 'selected' : ''}>${k}</option>`).join('')}</select></label>`;
  if (S.tool === 'camera') opts += `<button class="btn" id="camReset">Reset camera key</button>`;
  if (opts) h += '<span class="sep"></span>' + opts;
  h += '<span class="sep"></span>' + contextHTML();
  if (el._h === h) return; el._h = h;
  el.innerHTML = h;
  el.querySelectorAll('[data-o]').forEach((i) => (i.oninput = () => { const k = i.dataset.o; ns[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value; el._h = ''; }));
  el.querySelectorAll('[data-g]').forEach((i) => (i.oninput = () => { const k = i.dataset.g; S[k] = i.type === 'checkbox' ? i.checked : +i.value; el._h = ''; }));
  el.querySelectorAll('[data-pen]').forEach((i) => (i.oninput = () => { TOOLS.pen.opts.smooth = i.checked; el._h = ''; }));
  el.querySelectorAll('[data-cmd]').forEach((b) => (b.onclick = () => runCmd(b.dataset.cmd)));
  el.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  const L = selLayer(), SW = L && L.type === 'switch' ? L : null;
  const on = (k, ev, fn) => { const x = el.querySelector(`[data-ctx="${k}"]`); if (x) x[ev] = fn; };
  on('swpick', 'onchange', (e) => { S.swPreview[SW.id] = e.target.value; e.target.blur(); refreshAll(); });
  on('swprev', 'onclick', () => swPreviewStep(SW, -1)); on('swnext', 'onclick', () => swPreviewStep(SW, 1));
  on('swset', 'onclick', () => swSetActive(SW)); on('swclear', 'onclick', () => { delete S.swPreview[SW.id]; refreshAll(); });
  on('swalign', 'onclick', () => alignAlternatives(SW)); on('swoverlay', 'onchange', (e) => { S.alignOverlay = e.target.checked; el._h = ''; requestDraw(); });
  on('swactivatesel', 'onclick', () => swSetActive(parentOf(L.id), L.id));
  on('poseparent', 'onclick', () => setTool('bonemanip'));
  on('preset', 'onchange', (e) => { if (e.target.value) edit('Particle preset', () => applyParticlePreset(L, e.target.value)); });
  el.querySelectorAll('[data-lpivot]').forEach(i => (i.onchange = () => {const L=selLayer(), v=+i.value;if(L&&Number.isFinite(v))edit('Move pivot',()=>{assertWritable(L);L.p[i.dataset.lpivot]=round(clamp(v,-1e7,1e7),3);});i.blur();}));
  el.querySelectorAll('[data-lpos]').forEach((i) => (i.onchange = () => { const L = selLayer(), v = +i.value; if (L && Number.isFinite(v)) edit('Layer position', () => setVal(L, i.dataset.lpos, round(clamp(v, i.dataset.lpos === 'opacity' ? 0 : -1e7, i.dataset.lpos === 'opacity' ? 1 : 1e7), 3))); i.blur(); }));
  if (Bt) {
    el.querySelectorAll('[data-bopt]').forEach((i) => (i.onchange = () => { const b = boneOf(Bt, S.selBone); if (b) edit('Bone ' + i.dataset.bopt, () => (b[i.dataset.bopt] = Math.max(0, +i.value))); el._h = ''; }));
    el.querySelectorAll('[data-dyn]').forEach((i) => (i.onchange = () => { const b = boneOf(Bt, S.selBone); if (!b) return; edit('Bone physics', () => { b.dyn = { spring: 60, damp: 11, inertia: 0.6, ...(b.dyn || {}) }; b.dyn[i.dataset.dyn] = i.type === 'checkbox' ? i.checked : +i.value; }); el._h = ''; }));
    el.querySelectorAll('[data-force]').forEach((i) => (i.onchange = () => { edit('Force', () => { Bt.force = Bt.force || {}; Bt.force[i.dataset.force] = +i.value; }); el._h = ''; }));
    const bn = el.querySelector('[data-bname]');
    if (bn) { bn.onchange = () => { const b = boneOf(Bt, S.selBone), v = bn.value.trim(); if (b && v && v !== b.name) edit('Rename bone', () => (b.name = v)); el._h = ''; }; bn.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') bn.blur(); }; }
    const bc = el.querySelector('[data-bcolor]');
    if (bc) bc.onchange = () => { const b = boneOf(Bt, S.selBone); if (b) edit('Bone colour', () => (b.color = bc.value)); el._h = ''; };
    on('bcolreset', 'onclick', () => { const b = boneOf(Bt, S.selBone); if (b) edit('Bone colour', () => delete b.color); });
    on('blabels', 'onchange', (e) => { S.boneLabels = e.target.checked; try { localStorage.setItem('popai.boneLabels', S.boneLabels ? '1' : '0'); } catch {} el._h = ''; requestDraw(); });
    el.querySelectorAll('[data-sk]').forEach((i) => (i.onchange = () => { TOOLS.sketch.opts[i.dataset.sk] = Math.max(0, +i.value); el._h = ''; }));
    on('strauto', 'onclick', () => { const b = boneOf(Bt, S.selBone); if (b) edit('Bone strength', () => (b.str = round(b.len * 0.45))); });
    on('strzero', 'onclick', () => { const b = boneOf(Bt, S.selBone); if (b) edit('Bone strength', () => (b.str = 0)); });
    on('vtarget', 'onchange', (e) => { TOOLS.vitruvian.opts.target = e.target.value; e.target.blur(); el._h = ''; });
    on('vadd', 'onclick', async () => { const n = await askText('Vitruvian construction', 'Group name (e.g. Side arm, Front arm)', 'Construction ' + ((Bt.vgroups || []).length + 1)); if (!n) return; edit('Add construction', () => { Bt.vgroups = [...(Bt.vgroups || []), n]; }); TOOLS.vitruvian.opts.target = n; el._h = ''; refreshAll(); });
    on('vactive', 'onchange', (e) => { const v = e.target.value; e.target.blur(); edit('Active construction', () => setVal(Bt, 'vit', v, S.frame, true)); });
    on('bindbone', 'onchange', (e) => { e.target.blur(); const Lb = selLayer(); if (e.target.value && Lb && Lb.pts) bindTargetBone(Lb, e.target.value); else { selectBone(null); refreshAll(); } });
    on('bindgroup', 'onchange', (e) => { e.target.blur(); const Lb = selLayer(), g = Lb && (Lb.pointGroups || []).find((x) => x.id === e.target.value); if (g) { S.selPts = new Set(g.points.filter((id) => Lb.pts[id])); refreshAll(); } });
    on('bindlasso', 'onchange', (e) => { VEC.lasso = e.target.checked; el._h = ''; });
    on('offreset', 'onclick', () => edit('Reset offsets', () => Bt.bones.forEach((b) => { b.ox = 0; b.oy = 0; })));
  }
  const pd = $('#penDone'); if (pd) pd.onclick = () => finishPen(false);
  const ep = $('#emPreset'); if (ep) ep.onchange = () => (TOOLS.emitter.opts.preset = ep.value);
  const cr = $('#camReset'); if (cr) cr.onclick = () => edit('Reset camera', () => { const c = S.doc.camera; for (const k of ['x', 'y', 'zoom', 'roll']) setVal(c, k, k === 'zoom' ? 1 : 0); });
}
