// ---------- Layer tilt in space: Rotation X / Rotation Y (Moho's Rotate Layer XY) ----------
// A layer is a flat plane. Rotation X tilts it forward/back, Rotation Y turns it left/right, about its
// origin. The tilt is combined with the camera into a homography (the same perspective path the camera
// pan/tilt uses), so tilted layers draw, hit-test and export with correct perspective.
function tiltOf(L, f) { const rx = +val(L, 'rx', f) || 0, ry = +val(L, 'ry', f) || 0; return rx || ry ? [rx, ry] : null; }
function m4mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
const m4t = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const m4rx = (a) => { const s = Math.sin(a), c = Math.cos(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; };
const m4ry = (a) => { const s = Math.sin(a), c = Math.cos(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const m4from2 = (m, z) => [m[0], m[1], 0, 0, m[2], m[3], 0, 0, 0, 0, 1, 0, m[4], m[5], z, 1];
const _cameraFullMatrixFlat = cameraFullMatrix;
cameraFullMatrix = function (R, L, lc) {
  const f = R.f ?? S.frame;
  if (camImmune(L) || cameraFlag(L, 'faceCamera')) { lc.tilted = false; return _cameraFullMatrixFlat(R, L, lc); }
  const chain = [L, ...ancestors(L.id)].filter((N) => N.type !== 'audio');
  const tilted = chain.map((N) => [N, tiltOf(N, f)]).filter(([, t]) => t);
  if (!tilted.length) { lc.tilted = false; return _cameraFullMatrixFlat(R, L, lc); }
  lc.tilted = true;
  let W = m4from2(lc.world, lc.z);
  for (const [N, [rx, ry]] of tilted) { // innermost first, each about its own world origin
    const e = N === L ? lc : evalLC(N, f), o = M.ap(e.world, N.p.ox || 0, N.p.oy || 0);
    W = m4mul(m4mul(m4t(o[0], o[1], e.z), m4mul(m4ry(ry * DEG), m4mul(m4rx(rx * DEG), m4t(-o[0], -o[1], -e.z)))), W);
  }
  const st = R.cameraState || cameraStateAt(f), F = CAM_D * st.zoom, c = st.position, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const P = [[...st.right.map((v) => F * v), -F * dot(st.right, c)], [...st.down.map((v) => F * v), -F * dot(st.down, c)], [...st.forward, -dot(st.forward, c)]];
  const H = []; for (const row of P) for (const col of [0, 1, 3]) H.push(row[0] * W[col * 4] + row[1] * W[col * 4 + 1] + row[2] * W[col * 4 + 2] + row[3] * W[col * 4 + 3]);
  return M.mul(R.view, H);
};
CH_LABEL.rx = 'Rotation X'; CH_LABEL.ry = 'Rotation Y';
{ const _bg = baseGet; baseGet = function (o, path) { const v = _bg(o, path); return v === undefined && (path === 'rx' || path === 'ry') ? 0 : v; }; }

// Rotate layer XY tool: drag left/right turns (Rotation Y), up/down tilts (Rotation X)
defTool('rotxy', {
  icon: '⟲', name: 'Rotate layer XY', key: 'R', cursor: 'move',
  hint: 'Drag left/right to turn the layer (Rotation Y), up/down to tilt it (Rotation X) · Shift snaps to 15° · keys at the playhead like any transform · move it in depth with Alt-drag in Transform layer',
  down(e, sx, sy) { const L = selLayer(); if (!L) return toast('Select a layer to turn it in space'); const why = typeof writeReason === 'function' ? writeReason(L) : null; if (why) return toast(why, 'err'); beginEdit('Rotate layer XY'); startDrag(e, { L, rx: +val(L, 'rx', S.frame) || 0, ry: +val(L, 'ry', S.frame) || 0 }); },
  move(e, sx, sy) {
    const d = Stage.drag; if (!d) return; const k = 0.4 / Stage.dpr;
    let ry = d.ry + (sx - d.sx) * k, rx = d.rx - (sy - d.sy) * k;
    if (e.shiftKey) { ry = Math.round(ry / 15) * 15; rx = Math.round(rx / 15) * 15; }
    setVal(d.L, 'ry', round(ry, 1)); setVal(d.L, 'rx', round(rx, 1)); requestDraw();
  },
  up() { commitEdit(); refreshAll(); },
});
TOOL_GROUPS[0][1].splice(1, 0, 'rotxy');
{ const _ta = toolAvail; toolAvail = function (id) { if (id === 'rotxy') { const L = selLayer(); if (!L) return 'Select a layer to turn it in space'; if (L.type === 'audio') return 'Sound layers have no position in space'; return null; } return _ta(id); }; }
// Transform layer bar: Rotation X / Y fields next to the in-plane angle
{ const _lp = layerPosHTML; layerPosHTML = function () { const h = _lp(); const L = selLayer(); if (!h || !L) return h; const disabled = typeof writeReason === 'function' && writeReason(L) ? 'disabled' : '';
  const n = (k, label, title) => `<label title="${title}">${label} <input aria-label="${title}" type="number" data-lpos="${k}" value="${round(val(L, k, S.frame) ?? 0, 2)}" step="1" ${disabled} style="width:52px"></label>`;
  return h.replace('<label title="Rotation">', n('rx', '↕', 'Rotation X (tilt forward/back)') + n('ry', '↔', 'Rotation Y (turn left/right)') + '<label title="Rotation">'); }; }
