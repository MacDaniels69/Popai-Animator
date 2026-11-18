/* ===================== Popai Animator — Layer Settings, masking and Liquid Shapes (Moho model) =====================
   Layer Settings: a tabbed window for the selected layer(s) (double-click a layer, the ⚙ button, Window ▸ Layer Settings,
   Ctrl+Shift+I). Apply commits and stays open, OK commits and closes, Cancel discards uncommitted changes.
   Masking: a Group or Bone layer chooses No masking / Hide all / Reveal all; each child chooses its role. Children are
   processed bottom → top, so contributors sit below the artwork they constrain.
   Liquid Shapes: in Select Shape, filled shapes above a base shape can Add, Subtract or Clip into it, with an animatable
   Blend. Merge bakes the combined silhouette into ordinary geometry. */

// ---------- masking ----------
const MASK_MODES = [['none', 'No masking in this group'], ['hide', 'Hide all'], ['reveal', 'Reveal all']];
const MASK_LEGACY = [['bottom', 'Bottom child masks the rest (older Popai)'], ['invert', 'Bottom child cuts out the rest (older Popai)']];
const MASK_ROLES = [['mask', 'Mask this layer'], ['nomask', "Don't mask this layer"], ['add', '+ Add to mask'], ['addhide', '+ Add to mask, but keep invisible'],
  ['sub', '− Subtract from mask'], ['subhide', '− Subtract from mask, but keep invisible'], ['clear', 'Clear the mask, then add this layer'], ['clearhide', 'Clear the mask, then add this layer, but keep invisible']];
// While a contributor is drawn for “Exclude strokes”, every shape reports its stroke as off.
let lsNoStroke = false;
const lsOldShapeStyle = shapeStyle;
shapeStyle = function (L, sh, f) { const st = lsOldShapeStyle(L, sh, f); return lsNoStroke ? { ...st, strokeOn: false } : st; };
function maskMode(L) { return isContainer(L) && L.type !== 'switch' ? (L.mask || 'none') : 'none'; }
function maskRole(L) { return L.maskRole || 'mask'; }
// Draw a contributor into the mask canvas; "expand by a pixel" stamps it at one-pixel offsets to close antialiasing gaps.
function maskStamp(mx, src, expand) {
  if (!expand) return mx.drawImage(src, 0, 0);
  for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) mx.drawImage(src, dx, dy);
}
function drawMaskedChildren(ctx, L, R, cpc) {
  const W = R.W, H = R.H, kids = L.children, mode = maskMode(L);
  const maskC = Pool.get(W, H), out = Pool.get(W, H), tmp = Pool.get(W, H), mx = maskC.getContext('2d'), ox = out.getContext('2d'), tx = tmp.getContext('2d');
  for (const x of [mx, ox, tx]) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, W, H); }
  if (mode === 'reveal') { mx.fillStyle = '#000'; mx.fillRect(0, 0, W, H); }
  for (let i = kids.length - 1; i >= 0; i--) {
    const c = kids[i], role = maskRole(c);
    tx.setTransform(1, 0, 0, 1, 0, 0); tx.globalAlpha = 1; tx.globalCompositeOperation = 'source-over'; tx.clearRect(0, 0, W, H);
    drawLayer(tx, c, R, cpc);
    if (!['mask', 'nomask'].includes(role)) {
      let src = tmp, extra = null;
      if (c.maskNoStroke) { extra = Pool.get(W, H); const ex = extra.getContext('2d'); ex.setTransform(1, 0, 0, 1, 0, 0); ex.clearRect(0, 0, W, H); lsNoStroke = true; try { drawLayer(ex, c, { ...R, rec: null }, cpc); } finally { lsNoStroke = false; } src = extra; }
      mx.setTransform(1, 0, 0, 1, 0, 0);
      if (role.startsWith('clear')) mx.clearRect(0, 0, W, H);
      mx.globalCompositeOperation = role.startsWith('sub') ? 'destination-out' : 'source-over';
      maskStamp(mx, src, c.maskExpand); mx.globalCompositeOperation = 'source-over';
      if (extra) Pool.put(extra);
      if (role.endsWith('hide')) continue;
    }
    if (role === 'mask') { tx.setTransform(1, 0, 0, 1, 0, 0); tx.globalCompositeOperation = 'destination-in'; tx.drawImage(maskC, 0, 0); tx.globalCompositeOperation = 'source-over'; }
    ox.drawImage(tmp, 0, 0);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(out, 0, 0); ctx.restore();
  Pool.put(maskC, out, tmp);
}

// ---------- depth sort ----------
function depthSorted(L, list, f) {
  if (!L.depthSort || list.length < 2) return list;
  const cam = S.doc.camera, cx = val(cam, 'x', f), cy = val(cam, 'y', f);
  const dist = (c) => L.trueDistance ? Math.hypot(val(c, 'x', f) - cx, val(c, 'y', f) - cy, CAM_D - (val(c, 'z', f) || 0)) : CAM_D - (val(c, 'z', f) || 0);
  // drawList paints from the end of the list to the start, so the farthest layer goes last.
  return list.map((c, i) => [c, i, dist(c)]).sort((a, b) => a[2] - b[2] || a[1] - b[1]).map((x) => x[0]);
}

// ---------- extra layer effects ----------
FX.shading = { label: 'Layer shading (inner)', params: { angle: [-45, -180, 180, 1], offset: [8, 0, 500, 0.5], blur: [8, 0, 200, 0.5], color: ['#000000'], opacity: [0.5, 0, 1, 0.01] },
  apply(c, p, sc) {
    const W = c.width, H = c.height, s = Pool.get(W, H), x = s.getContext('2d'), a = p.angle * DEG;
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, W, H);
    x.fillStyle = p.color; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'destination-out'; x.drawImage(c, Math.cos(a) * p.offset * sc, Math.sin(a) * p.offset * sc);
    x.globalCompositeOperation = 'source-over';
    const b = p.blur > 0 ? blurred(s, p.blur * sc) : s, cx = c.getContext('2d');
    cx.save(); cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'source-atop'; cx.globalAlpha = p.opacity; cx.drawImage(b, 0, 0); cx.restore();
    if (b !== s) Pool.put(b); Pool.put(s);
  } };
FX.motionblur = { label: 'Motion blur', params: { frames: [4, 1, 30, 1], skip: [1, 1, 20, 1], start: [0.15, 0, 1, 0.01], end: [0.6, 0, 1, 0.01], radius: [0, 0, 100, 0.5], subframe: [false], percent: [50, 1, 100, 1] },
  apply(c, p, sc, R, L) {
    if (R.noTrail || (actActive() && !actHasAnimation(L))) return;
    const x = c.getContext('2d'), acc = Pool.get(c.width, c.height), ax = acc.getContext('2d'), t = Pool.get(c.width, c.height), n = Math.max(1, Math.round(p.frames));
    ax.setTransform(1, 0, 0, 1, 0, 0); ax.clearRect(0, 0, acc.width, acc.height);
    for (let i = n; i >= 1; i--) {
      // Legacy: separate copies at earlier frames. Sub-frame: samples inside the frame's exposure interval.
      const ff = p.subframe ? R.f - (i / n) * (p.percent / 100) : R.f - i * Math.round(p.skip);
      if (ff < 0) continue;
      const tx = t.getContext('2d'); tx.setTransform(1, 0, 0, 1, 0, 0); tx.clearRect(0, 0, t.width, t.height);
      renderScene(tx, ff, R.view, { only: L.id, noTrail: true, export: R.export });
      ax.globalAlpha = n === 1 ? p.end : lerp(p.end, p.start, (i - 1) / (n - 1)); ax.drawImage(t, 0, 0);
    }
    ax.globalAlpha = 1;
    const b = p.radius > 0 ? blurred(acc, p.radius * sc) : acc;
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'destination-over'; x.drawImage(b, 0, 0); x.restore();
    if (b !== acc) Pool.put(b); Pool.put(acc, t);
  } };

// ---------- render integration ----------
function camImmune(L) { return !!(L.immuneCam || ancestors(L.id).some((a) => a.immuneCam)); }
const lsOldDrawLayer = drawLayer;
drawLayer = function (ctx, L, R, pc) {
  if (L.hideEdit && !R.export) return;
  if (!camImmune(L)) return lsOldDrawLayer(ctx, L, R, pc);
  const cam = R.cam; R.cam = () => M.I();
  try { return lsOldDrawLayer(ctx, L, R, pc); } finally { R.cam = cam; }
};
const lsOldDrawContent = drawContent;
drawContent = function (ctx, L, R, lc) {
  const mode = maskMode(L);
  if ((L.type === 'group' || L.type === 'bone') && (mode === 'hide' || mode === 'reveal') && L.children.length && !R.only) return lsWithChildList(L, () => lsMaskedContent(ctx, L, R, lc));
  if ((L.type === 'group' || L.type === 'bone') && L.depthSort) return lsWithChildList(L, () => lsOldDrawContent(ctx, L, R, lc), depthSorted(L, L.children, R.f));
  return lsOldDrawContent(ctx, L, R, lc);
};
// Container children are drawn by drawList through drawContent; swapping drawList for one call routes them here.
function lsWithChildList(L, fn, order) {
  if (!order) return fn();
  const original = L.children; L.children = order;
  try { return fn(); } finally { L.children = original; }
}
function lsMaskedContent(ctx, L, R, lc) {
  const list = drawList;
  drawList = (c, kids, R2, cpc) => { drawList = list; drawMaskedChildren(c, { ...L, children: depthSorted(L, kids, R2.f) }, R2, cpc); };
  try { return lsOldDrawContent(ctx, L, R, lc); } finally { drawList = list; }
}

// ---------- Layer Settings window ----------
const LS_COLORS = [['', 'None'], ['#ff5d5d', 'Red'], ['#ff8a3d', 'Orange'], ['#ffd23f', 'Yellow'], ['#5ccf8a', 'Green'], ['#4dabf7', 'Blue'], ['#b26bff', 'Purple'], ['#9aa0a6', 'Gray']];
const LS_BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['lighter', 'Add'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['difference', 'Difference']];
function lsFx(L, type) { return L.fx.find((e) => e.type === type) || null; }
function lsFxGet(L, type, k) { const e = lsFx(L, type); return e ? val(L, 'fx:' + e.id + ':' + k, S.frame) : fxDefaults(type)[k]; }
function lsFxOn(L, type) { const e = lsFx(L, type); return !!(e && e.on); }
function lsFxSet(L, type, on, params = {}) {
  let e = lsFx(L, type);
  if (!e && !on) return;
  if (!e) { e = { id: uid('fx'), type, on: true, p: { ...fxDefaults(type) } }; L.fx.push(e); }
  e.on = !!on;
  for (const [k, v] of Object.entries(params)) { const spec = FX[type].params[k]; setVal(L, 'fx:' + e.id + ':' + k, typeof spec[0] === 'number' ? clamp(+v, spec[1], spec[2]) : v); }
}
const isChildOfContainer = (L) => { const p = parentOf(L.id); return !!(p && (p.type === 'group' || p.type === 'bone')); };
const anyType = () => true, art = (L) => L.type !== 'audio';
// Each setting: tab, control, which layers it applies to, how to read and write it. 'anim' marks animatable values.
const LS_FIELDS = [
  // General
  { k: 'name', tab: 'General', label: 'Name', type: 'text', when: anyType, primary: true, get: (L) => L.name, set: (L, v) => { if (String(v).trim()) L.name = String(v).trim().slice(0, 200); } },
  { k: 'label', tab: 'General', label: 'Layer color (label only)', type: 'select', opts: LS_COLORS, when: anyType, get: (L) => L.label || '', set: (L, v) => { L.label = v; } },
  { k: 'tags', tab: 'General', label: 'Tags', type: 'text', when: anyType, get: (L) => L.tags || '', set: (L, v) => { L.tags = String(v).slice(0, 1000); } },
  { k: 'comment', tab: 'General', label: 'Comments', type: 'area', when: anyType, get: (L) => L.comment || '', set: (L, v) => { L.comment = String(v).slice(0, 10000); } },
  { k: 'ignoreSelector', tab: 'General', label: 'Ignored by layer selector', type: 'check', when: art, get: (L) => !!L.ignoreSelector, set: (L, v) => { L.ignoreSelector = !!v; } },
  { k: 'hideEdit', tab: 'General', label: 'Hide in editing (still renders)', type: 'check', when: art, get: (L) => !!L.hideEdit, set: (L, v) => { L.hideEdit = !!v; } },
  { k: 'dontRender', tab: 'General', label: "Don't render (guides and helpers)", type: 'check', when: art, get: (L) => !L.render, set: (L, v) => { L.render = !v; } },
  { k: 'visible', tab: 'General', label: 'Visible', type: 'check', anim: true, when: art, get: (L) => val(L, 'visible', S.frame) !== false, set: (L, v) => setVal(L, 'visible', !!v) },
  { k: 'opacity', tab: 'General', label: 'Opacity %', type: 'num', min: 0, max: 100, step: 1, anim: true, when: art, get: (L) => round(val(L, 'opacity', S.frame) * 100, 2), set: (L, v) => setVal(L, 'opacity', clamp(+v, 0, 100) / 100) },
  { k: 'blend', tab: 'General', label: 'Blending mode', type: 'select', opts: LS_BLENDS, when: art, get: (L) => L.blend || 'source-over', set: (L, v) => { L.blend = v; } },
  { k: 'blur', tab: 'General', label: 'Blur radius (0 = off)', type: 'num', min: 0, max: 200, step: 0.5, anim: true, when: art, get: (L) => lsFxOn(L, 'blur') ? lsFxGet(L, 'blur', 'radius') : 0, set: (L, v) => lsFxSet(L, 'blur', +v > 0, +v > 0 ? { radius: +v } : {}) },
  { k: 'noise', tab: 'General', label: 'Noise amount (0 = off)', type: 'num', min: 0, max: 1, step: 0.01, anim: true, when: art, get: (L) => lsFxOn(L, 'noise') ? lsFxGet(L, 'noise', 'amount') : 0, set: (L, v) => lsFxSet(L, 'noise', +v > 0, +v > 0 ? { amount: +v } : {}) },
  { k: 'pixelate', tab: 'General', label: 'Pixelation (0 = off)', type: 'num', min: 0, max: 200, step: 1, anim: true, when: art, get: (L) => lsFxOn(L, 'pixelate') ? lsFxGet(L, 'pixelate', 'size') : 0, set: (L, v) => lsFxSet(L, 'pixelate', +v > 0, +v > 0 ? { size: Math.max(1, +v) } : {}) },
  { k: 'outline', tab: 'General', label: 'Layer outline', type: 'check', when: art, get: (L) => lsFxOn(L, 'outline'), set: (L, v) => lsFxSet(L, 'outline', v) },
  { k: 'outlineWidth', tab: 'General', label: 'Outline width', type: 'num', min: 0, max: 100, step: 0.5, anim: true, when: art, get: (L) => lsFxGet(L, 'outline', 'width'), set: (L, v) => lsFx(L, 'outline') && lsFxSet(L, 'outline', lsFxOn(L, 'outline'), { width: +v }) },
  { k: 'outlineColor', tab: 'General', label: 'Outline color', type: 'color', when: art, get: (L) => lsFxGet(L, 'outline', 'color'), set: (L, v) => lsFx(L, 'outline') && lsFxSet(L, 'outline', lsFxOn(L, 'outline'), { color: v }) },
  { k: 'colorize', tab: 'General', label: 'Colorize', type: 'check', when: art, get: (L) => lsFxOn(L, 'tint'), set: (L, v) => lsFxSet(L, 'tint', v) },
  { k: 'colorizeColor', tab: 'General', label: 'Colorize color', type: 'color', when: art, get: (L) => lsFxGet(L, 'tint', 'color'), set: (L, v) => lsFx(L, 'tint') && lsFxSet(L, 'tint', lsFxOn(L, 'tint'), { color: v }) },
  { k: 'flipH', tab: 'General', label: 'Flip horizontally', type: 'check', when: art, get: (L) => !!L.flipH, set: (L, v) => { L.flipH = !!v; } },
  { k: 'flipV', tab: 'General', label: 'Flip vertically', type: 'check', when: art, get: (L) => !!L.flipV, set: (L, v) => { L.flipV = !!v; } },
  { k: 'immuneCam', tab: 'General', label: 'Immune to camera movements', type: 'check', when: art, get: (L) => !!L.immuneCam, set: (L, v) => { L.immuneCam = !!v; } },
  // Shadows
  { k: 'shadow', tab: 'Shadows', label: 'Layer shadow', type: 'check', when: art, get: (L) => lsFxOn(L, 'shadow'), set: (L, v) => lsFxSet(L, 'shadow', v) },
  ...[['dx', 'Shadow offset X', -500, 500, 0.5], ['dy', 'Shadow offset Y', -500, 500, 0.5], ['softness', 'Shadow blur', 0, 200, 0.5], ['opacity', 'Shadow opacity', 0, 1, 0.01]].map(([p, label, min, max, step]) =>
    ({ k: 'shadow_' + p, tab: 'Shadows', label, type: 'num', min, max, step, anim: true, when: art, get: (L) => lsFxGet(L, 'shadow', p), set: (L, v) => lsFx(L, 'shadow') && lsFxSet(L, 'shadow', lsFxOn(L, 'shadow'), { [p]: +v }) })),
  { k: 'shadow_color', tab: 'Shadows', label: 'Shadow color', type: 'color', when: art, get: (L) => lsFxGet(L, 'shadow', 'color'), set: (L, v) => lsFx(L, 'shadow') && lsFxSet(L, 'shadow', lsFxOn(L, 'shadow'), { color: v }) },
  { k: 'shading', tab: 'Shadows', label: 'Layer shading (inside the artwork)', type: 'check', when: art, get: (L) => lsFxOn(L, 'shading'), set: (L, v) => lsFxSet(L, 'shading', v) },
  ...[['angle', 'Shading direction °', -180, 180, 1], ['offset', 'Shading offset', 0, 500, 0.5], ['blur', 'Shading blur', 0, 200, 0.5], ['opacity', 'Shading opacity', 0, 1, 0.01]].map(([p, label, min, max, step]) =>
    ({ k: 'shading_' + p, tab: 'Shadows', label, type: 'num', min, max, step, anim: true, when: art, get: (L) => lsFxGet(L, 'shading', p), set: (L, v) => lsFx(L, 'shading') && lsFxSet(L, 'shading', lsFxOn(L, 'shading'), { [p]: +v }) })),
  { k: 'shading_color', tab: 'Shadows', label: 'Shading color', type: 'color', when: art, get: (L) => lsFxGet(L, 'shading', 'color'), set: (L, v) => lsFx(L, 'shading') && lsFxSet(L, 'shading', lsFxOn(L, 'shading'), { color: v }) },
  // Motion Blur
  { k: 'mb', tab: 'Motion Blur', label: 'Motion blur', type: 'check', when: art, get: (L) => lsFxOn(L, 'motionblur'), set: (L, v) => lsFxSet(L, 'motionblur', v) },
  ...[['frames', 'Frame count', 1, 30, 1], ['skip', 'Frame skip', 1, 20, 1], ['start', 'Start opacity', 0, 1, 0.01], ['end', 'End opacity', 0, 1, 0.01], ['radius', 'Blur radius', 0, 100, 0.5], ['percent', 'Frame percentage (sub-frame)', 1, 100, 1]].map(([p, label, min, max, step]) =>
    ({ k: 'mb_' + p, tab: 'Motion Blur', label, type: 'num', min, max, step, anim: true, when: art, get: (L) => lsFxGet(L, 'motionblur', p), set: (L, v) => lsFx(L, 'motionblur') && lsFxSet(L, 'motionblur', lsFxOn(L, 'motionblur'), { [p]: +v }) })),
  { k: 'mb_subframe', tab: 'Motion Blur', label: 'Sub-frame motion blur', type: 'check', when: art, get: (L) => !!lsFxGet(L, 'motionblur', 'subframe'), set: (L, v) => lsFx(L, 'motionblur') && lsFxSet(L, 'motionblur', lsFxOn(L, 'motionblur'), { subframe: !!v }) },
  // Masking
  { k: 'mask', tab: 'Masking', label: 'Group masking', type: 'select', opts: MASK_MODES, when: (L) => L.type === 'group' || L.type === 'bone', optsFor: (L) => MASK_LEGACY.some(([v]) => v === L.mask) ? MASK_MODES.concat(MASK_LEGACY) : MASK_MODES, get: (L) => L.mask || 'none', set: (L, v) => { L.mask = v; } },
  { k: 'maskRole', tab: 'Masking', label: 'This layer', type: 'select', opts: MASK_ROLES, when: isChildOfContainer, get: (L) => maskRole(L), set: (L, v) => { if (v === 'mask') delete L.maskRole; else L.maskRole = v; } },
  { k: 'maskNoStroke', tab: 'Masking', label: 'Exclude strokes from its mask contribution', type: 'check', when: (L) => isChildOfContainer(L) && L.type === 'vector', get: (L) => !!L.maskNoStroke, set: (L, v) => { L.maskNoStroke = !!v; } },
  { k: 'maskExpand', tab: 'Masking', label: 'Expand mask by a pixel', type: 'check', when: isChildOfContainer, get: (L) => !!L.maskExpand, set: (L, v) => { L.maskExpand = !!v; } },
  // Depth Sort
  { k: 'depthSort', tab: 'Depth Sort', label: 'Sort layers by depth', type: 'check', when: (L) => L.type === 'group' || L.type === 'bone', get: (L) => !!L.depthSort, set: (L, v) => { L.depthSort = !!v; } },
  { k: 'trueDistance', tab: 'Depth Sort', label: 'Sort by true distance', type: 'check', when: (L) => L.type === 'group' || L.type === 'bone', get: (L) => !!L.trueDistance, set: (L, v) => { L.trueDistance = !!v; } },
  // Bones
  { k: 'autoBind', tab: 'Bones', label: 'Flexible (region) binding from bone strength', type: 'check', when: (L) => L.type === 'bone', get: (L) => L.autoBind !== false, set: (L, v) => { if (v) delete L.autoBind; else L.autoBind = false; } },
  { k: 'nested', tab: 'Bones', label: 'Allow nested layer control', type: 'check', when: (L) => L.type === 'bone', get: (L) => L.nested !== false, set: (L, v) => { if (v) delete L.nested; else L.nested = false; } },
  // Layer-type tabs
  { k: 'swMode', tab: 'Switch', label: 'Interpolation between alternatives', type: 'select', opts: [['discrete', 'Off (instant switch)'], ['crossfade', 'Crossfade']], when: (L) => L.type === 'switch', get: (L) => L.swMode || 'discrete', set: (L, v) => { L.swMode = v; } },
  { k: 'swFade', tab: 'Switch', label: 'Crossfade frames', type: 'num', min: 1, max: 120, step: 1, when: (L) => L.type === 'switch', get: (L) => L.swFade || 4, set: (L, v) => { L.swFade = clamp(Math.round(+v), 1, 120); } },
  ...[['rate', 'Emission rate', 0, 10000, 1], ['life', 'Lifetime (s)', 0.05, 60, 0.05], ['speed', 'Velocity', 0, 10000, 1], ['spread', 'Spread °', 0, 360, 1], ['gravity', 'Acceleration (gravity)', -10000, 10000, 1], ['drag', 'Damping', 0, 10, 0.05]].map(([p, label, min, max, step]) =>
    ({ k: 'pt_' + p, tab: 'Particles', label, type: 'num', min, max, step, anim: true, when: (L) => L.type === 'particle', get: (L) => val(L, p, S.frame), set: (L, v) => setVal(L, p, clamp(+v, min, max)) })),
  { k: 'gain', tab: 'Audio', label: 'Level', type: 'num', min: 0, max: 4, step: 0.05, anim: true, when: (L) => L.type === 'audio', get: (L) => val(L, 'gain', S.frame), set: (L, v) => setVal(L, 'gain', clamp(+v, 0, 4)) },
  { k: 'mute', tab: 'Audio', label: 'Mute', type: 'check', when: (L) => L.type === 'audio', get: (L) => !!L.mute, set: (L, v) => { L.mute = !!v; } },
  { k: 'text', tab: 'Text', label: 'Text', type: 'area', when: (L) => L.type === 'text', get: (L) => L.text, set: (L, v) => { L.text = String(v).slice(0, 10000); } },
  { k: 'textSize', tab: 'Text', label: 'Size', type: 'num', min: 1, max: 2000, step: 1, when: (L) => L.type === 'text', get: (L) => L.size, set: (L, v) => { L.size = clamp(+v, 1, 2000); } },
];
const LS_TAB_ORDER = ['General', 'Shadows', 'Motion Blur', 'Masking', 'Depth Sort', 'Bones', 'Switch', 'Particles', 'Audio', 'Text', 'Info'];
function lsTargets() { const P = selLayer(); if (!P) return []; return [P, ...S.selLayers.map((id) => findLayer(id)).filter((L) => L && L !== P)]; }
function lsReadForm(root) {
  const o = {};
  root.querySelectorAll('[data-ls]').forEach((i) => { o[i.dataset.ls] = i.type === 'checkbox' ? !!i.checked : i.value; });
  return o;
}
// Pure core of Apply: write each changed field to every target layer it applies to. Returns the number of writes.
function lsApply(targets, before, now) {
  const changed = LS_FIELDS.filter((f) => f.k in now && String(now[f.k]) !== String(before[f.k]));
  if (!changed.length || !targets.length) return 0;
  const why = targets.map((L) => writeReason(L)).find(Boolean); if (why) { toast(why, 'err'); return 0; }
  let n = 0;
  edit(targets.length > 1 ? `Layer settings (${targets.length} layers)` : 'Layer settings', () => {
    for (const f of changed) for (const L of (f.primary ? targets.slice(0, 1) : targets)) if (f.when(L)) { let v = now[f.k]; if (f.type === 'num') { v = +v; if (!Number.isFinite(v)) continue; } f.set(L, v); n++; }
  });
  return n;
}
function lsControl(f, L) {
  const v = f.get(L), id = 'ls_' + f.k, opts = f.optsFor ? f.optsFor(L) : f.opts;
  const tag = f.anim ? ` <span class="ls-anim" title="Animatable: in Animate mode this writes a key at frame ${S.frame}">◆</span>` : '';
  if (f.type === 'check') return `<label class="ls-row ls-check"><input type="checkbox" id="${id}" data-ls="${f.k}" ${v ? 'checked' : ''}> ${esc(f.label)}${tag}</label>`;
  let input;
  if (f.type === 'select') input = `<select id="${id}" data-ls="${f.k}">${opts.map(([o, n]) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  else if (f.type === 'area') input = `<textarea id="${id}" data-ls="${f.k}" rows="3">${esc(v)}</textarea>`;
  else if (f.type === 'num') input = `<input type="number" id="${id}" data-ls="${f.k}" value="${round(+v, 4)}" min="${f.min}" max="${f.max}" step="${f.step}">`;
  else if (f.type === 'color') input = `<input type="color" id="${id}" data-ls="${f.k}" value="${esc(v)}">`;
  else input = `<input type="text" id="${id}" data-ls="${f.k}" value="${esc(v)}">`;
  return `<label class="ls-row" for="${id}"><span>${esc(f.label)}${tag}</span>${input}</label>`;
}
function lsInfo(L) {
  const kids = () => (L.children || []).length;
  const lines = { vector: () => `${Object.keys(L.pts || {}).length} points · ${(L.shapes || []).length} shapes. Liquid Shapes (Add / Subtract / Clip / Blend / Merge) are in the Select Shape tool (Q).`,
    image: () => `Source: ${esc((S.media[L.media] || {}).name || L.media || 'none')} · ${L.iw}×${L.ih}. Replace the image or set bone warping from the Properties panel.`,
    group: () => `${kids()} child layer(s).`, bone: () => `${(L.bones || []).length} bone(s) · ${kids()} child layer(s).`, switch: () => `${kids()} alternative(s).` }[L.type]?.();
  return `<div class="note">${lines || 'No extra settings for this layer type.'} Position, scale, rotation and origin are edited with the layer tools.</div>`;
}
function openLayerSettings() {
  const targets = lsTargets(), L = targets[0];
  if (!L) return toast('Select a layer first', 'err');
  const fields = LS_FIELDS.filter((f) => f.when(L)), tabs = LS_TAB_ORDER.filter((t) => t === 'Info' || fields.some((f) => f.tab === t));
  const m = $('#modal');
  const body = tabs.map((t, i) => `<div class="ls-pane" data-pane="${t}" ${i ? 'hidden' : ''}>${t === 'Info' ? lsInfo(L) : fields.filter((f) => f.tab === t).map((f) => lsControl(f, L)).join('')}${t === 'Masking' ? '<div class="note">Children are processed from the bottom of the stack upward: put mask contributors below the artwork they limit. “Hide all” shows nothing until a child adds to the mask.</div>' : ''}</div>`).join('');
  const mode = S.mode === 'setup' ? 'Setup' : `Animate · frame ${S.frame}`;
  m.innerHTML = `<div class="dlg ls-dlg"><h3>Layer Settings — ${esc(L.name)}${targets.length > 1 ? ` <small>(+${targets.length - 1} more selected)</small>` : ''}<span class="x" data-v="__x">✕</span></h3>
    <div class="ls-tabs">${tabs.map((t, i) => `<button class="btn ${i ? '' : 'pri'}" data-lstab="${t}">${t}</button>`).join('')}</div>
    <div class="db ls-body">${body}<div class="note">${mode}. ◆ settings are animatable. Changes apply to ${targets.length > 1 ? 'all selected layers where the setting exists (the name only to ' + esc(L.name) + ')' : 'this layer'}.</div></div>
    <div class="df"><button class="btn" data-lsbtn="cancel">Cancel</button><button class="btn" data-lsbtn="apply">Apply</button><button class="btn pri" data-lsbtn="ok">OK</button></div></div>`;
  m.classList.add('show');
  const root = m.querySelector('.ls-body');
  let before = lsReadForm(root);
  const close = () => { m.classList.remove('show'); m.innerHTML = ''; refreshAll(); };
  const apply = () => { const now = lsReadForm(root), n = lsApply(lsTargets(), before, now); before = now; if (n) toast(`Applied ${n} change(s)`, 'ok'); return n; };
  m.querySelector('[data-v="__x"]').onclick = close;
  m.querySelectorAll('[data-lstab]').forEach((b) => (b.onclick = () => { m.querySelectorAll('[data-lstab]').forEach((x) => x.classList.toggle('pri', x === b)); m.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.lstab; }); }));
  m.querySelectorAll('[data-lsbtn]').forEach((b) => (b.onclick = () => { const a = b.dataset.lsbtn; if (a === 'cancel') return close(); apply(); if (a === 'ok') close(); }));
  return { root, apply, close };
}
cmd('layer.settings', 'Window', 'Layer Settings…', () => openLayerSettings(), { k: 'Ctrl+Shift+I', keys: 'ctrl+shift+i', en: () => (selLayer() ? false : 'Select a layer'), kw: 'properties masking shadow motion blur depth' });
const lsOldInitLayers = initLayersPanel;
initLayersPanel = function () {
  lsOldInitLayers();
  const del = $('#lyDel');
  if (del && !$('#lySettings')) { const b = document.createElement('button'); b.className = 'ib sm'; b.id = 'lySettings'; b.title = 'Layer Settings (Ctrl+Shift+I)'; b.textContent = '⚙'; b.onclick = () => runCmd('layer.settings'); del.parentNode.insertBefore(b, del); }
};

// ---------- Liquid Shapes ----------
const LIQUID_OPS = ['add', 'sub', 'clip'];
// Shapes are drawn in array order (first = bottom). A filled shape marked Add / Subtract / Clip joins the nearest
// ordinary shape below it, forming a live cluster.
function liquidClusters(L) {
  const out = []; let cur = null;
  for (const sh of L.shapes || []) {
    if (LIQUID_OPS.includes(sh.liquid) && cur) cur.members.push(sh);
    else { cur = { base: sh, members: [] }; out.push(cur); }
  }
  return out;
}
function liquidClusterOf(L, sh) { return liquidClusters(L).find((c) => c.base === sh || c.members.includes(sh)) || null; }
function liquidBlend(L, sh, f) { return clamp(+val(L, 'sh:' + sh.id + ':blend', f) || 0, 0, 100); }
function liquidPath(L, sh, P, f, lc) { const p = new Path2D(); for (const id of sh.paths) { const path = L.paths.find((q) => q.id === id); if (path) tracePath(p, L, path, P, f, lc); } return p; }
function liquidScreenBox(L, shapes, P, full, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sh of shapes) for (const id of sh.paths) { const path = L.paths.find((q) => q.id === id); if (!path) continue; for (const pid of path.pts) { const q = P[pid] && M.ap(full, ...P[pid]); if (!q) continue; x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } }
  return x0 > x1 ? null : [Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 + pad), Math.ceil(y1 + pad)];
}
// Smooth union/difference: blur the silhouette and re-threshold it, keeping the sharp result inside (union) or outside (difference).
function drawLiquidCluster(ctx, L, R, lc, cl, P) {
  const f = R.f, sc = M.scaleOf(lc.full) || 1, base = cl.base, bst = shapeStyle(L, base, f), hw = bst.strokeOn ? Math.max(0.5, (bst.width || 0) * sc / 2) : 0;
  // Everything happens on canvases the size of the cluster's bounding box (Add/Clip never grow past it; Subtract only removes).
  const grow = [base, ...cl.members.filter((m) => m.liquid === 'add')], raw = liquidScreenBox(L, grow, P, lc.full, 0);
  if (!raw) return;
  const span = Math.max(raw[2] - raw[0], raw[3] - raw[1]), pad = Math.ceil(0.08 * span + hw + 4);
  const bx = Math.max(0, raw[0] - pad), by = Math.max(0, raw[1] - pad), W = Math.min(R.W, raw[2] + pad) - bx, H = Math.min(R.H, raw[3] + pad) - by;
  if (W <= 0 || H <= 0) return;
  const full = M.mul(M.t(-bx, -by), lc.full), all = [base, ...cl.members];
  const sil = Pool.get(W, H), sx = sil.getContext('2d');
  const reset = (x) => { x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; };
  reset(sx); sx.clearRect(0, 0, W, H); M.set(sx, full); sx.fillStyle = '#000'; sx.fill(liquidPath(L, base, P, f, lc), 'evenodd'); reset(sx);
  for (const m of cl.members) {
    if (m.liquid === 'clip') continue;
    const blend = liquidBlend(L, m, f), mp = liquidPath(L, m, P, f, lc);
    const mb = liquidScreenBox(L, [m], P, lc.full, 0), size = mb ? Math.min(mb[2] - mb[0], mb[3] - mb[1]) : 0, r = blend / 100 * 0.35 * size;
    M.set(sx, full); sx.globalCompositeOperation = m.liquid === 'sub' ? 'destination-out' : 'source-over'; sx.fillStyle = '#000'; sx.fill(mp, 'evenodd'); reset(sx);
    if (r >= 0.75 && mb && typeof sx.getImageData === 'function') liquidSmoothCanvas(sx, mp, full, [mb[0] - bx, mb[1] - by, mb[2] - bx, mb[3] - by], W, H, r, m.liquid);
  }
  // Colour: the base fill fills the silhouette; Add and Clip members keep their own colours inside it.
  const out = Pool.get(W, H), ox = out.getContext('2d'); reset(ox); ox.clearRect(0, 0, W, H);
  if (bst.fillOn) { ox.drawImage(sil, 0, 0); ox.globalCompositeOperation = 'source-in'; ox.fillStyle = bst.fill; ox.fillRect(0, 0, W, H); reset(ox); }
  for (const m of cl.members) {
    if (m.liquid === 'sub') continue;
    const st = shapeStyle(L, m, f); if (!st.fillOn && !st.strokeOn) continue;
    M.set(ox, full); ox.globalCompositeOperation = 'source-atop'; const mp = liquidPath(L, m, P, f, lc);
    if (st.fillOn) { ox.fillStyle = st.fill; ox.fill(mp, 'evenodd'); }
    if (m.liquid === 'clip' && st.strokeOn && st.width > 0) { ox.lineWidth = st.width; ox.strokeStyle = st.stroke; ox.lineJoin = 'round'; ox.stroke(mp); }
    reset(ox);
  }
  if (!bst.fillOn) { ox.globalCompositeOperation = 'destination-in'; ox.drawImage(sil, 0, 0); reset(ox); }
  // One outline around the combined silhouette, centred on its edge (dilate minus erode by half the width).
  let band = null;
  if (hw > 0) {
    const n = Math.min(16, Math.max(8, Math.ceil(hw * 2))), dirs = Array.from({ length: n }, (_, i) => [Math.cos(i * 2 * Math.PI / n) * hw, Math.sin(i * 2 * Math.PI / n) * hw]);
    band = Pool.get(W, H); const bx2 = band.getContext('2d'); reset(bx2); bx2.clearRect(0, 0, W, H);
    for (const [dx, dy] of dirs) bx2.drawImage(sil, dx, dy);
    const er = Pool.get(W, H), ex = er.getContext('2d'); reset(ex); ex.clearRect(0, 0, W, H); ex.drawImage(sil, 0, 0); ex.globalCompositeOperation = 'destination-in'; for (const [dx, dy] of dirs) ex.drawImage(sil, dx, dy); reset(ex);
    bx2.globalCompositeOperation = 'destination-out'; bx2.drawImage(er, 0, 0); bx2.globalCompositeOperation = 'source-in'; bx2.fillStyle = bst.stroke; bx2.fillRect(0, 0, W, H); reset(bx2); Pool.put(er);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(out, bx, by); if (band) ctx.drawImage(band, bx, by); ctx.restore();
  Pool.put(sil, out); if (band) Pool.put(band);
}
// Blend smoothing on the silhouette canvas, limited to the member's neighbourhood. Large areas are processed at
// reduced resolution and applied as a correction, so outline pixels the smoothing does not change stay exact.
function liquidSmoothCanvas(sx, mp, full, mb, W, H, r, op) {
  const reach = Math.ceil(3 * r + 4), x0 = Math.max(0, Math.floor(mb[0] - reach)), y0 = Math.max(0, Math.floor(mb[1] - reach)), w = Math.min(W, Math.ceil(mb[2] + reach)) - x0, h = Math.min(H, Math.ceil(mb[3] + reach)) - y0;
  if (w <= 0 || h <= 0) return;
  const img = sx.getImageData(x0, y0, w, h); if (!img || !img.data) return;
  const mem = Pool.get(W, H), mx = mem.getContext('2d'); mx.setTransform(1, 0, 0, 1, 0, 0); mx.clearRect(0, 0, W, H); M.set(mx, full); mx.fillStyle = '#000'; mx.fill(mp, 'evenodd'); mx.setTransform(1, 0, 0, 1, 0, 0);
  const md = mx.getImageData(x0, y0, w, h).data; Pool.put(mem);
  const k = Math.max(1, Math.sqrt(w * h / 90000)), lw = Math.ceil(w / k), lh = Math.ceil(h / k), pd = Math.ceil(r / k) + 2, pw = lw + 2 * pd, ph = lh + 2 * pd;
  const a = new Float32Array(pw * ph), mm = new Uint8Array(pw * ph), cnt = new Float32Array(pw * ph), mc = new Float32Array(pw * ph);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = (Math.floor(y / k) + pd) * pw + Math.floor(x / k) + pd, i = (y * w + x) * 4; a[q] += img.data[i + 3] / 255; mc[q] += md[i + 3] / 255; cnt[q]++; }
  for (let q = 0; q < a.length; q++) if (cnt[q]) { a[q] /= cnt[q]; mm[q] = mc[q] / cnt[q] >= 0.5 ? 1 : 0; }
  const res = liquidSmooth(a, mm, pw, ph, r / k, op), delta = new Float32Array(pw * ph); for (let q = 0; q < delta.length; q++) delta[q] = res[q] - a[q];
  const at = (arr, fx, fy) => { const gx = clamp(fx / k - 0.5 + pd, 0, pw - 1), gy = clamp(fy / k - 0.5 + pd, 0, ph - 1), ix = Math.min(pw - 2, Math.floor(gx)), iy = Math.min(ph - 2, Math.floor(gy)), tx = gx - ix, ty = gy - iy;
    return (arr[iy * pw + ix] * (1 - tx) + arr[iy * pw + ix + 1] * tx) * (1 - ty) + (arr[(iy + 1) * pw + ix] * (1 - tx) + arr[(iy + 1) * pw + ix + 1] * tx) * ty; };
  const snap = (v) => clamp((v - 0.5) * 2.5 + 0.5, 0, 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, d = k === 1 ? delta[(y + pd) * pw + x + pd] : at(delta, x + 0.5, y + 0.5); if (Math.abs(d) < 0.004) continue;
    const o = img.data[i + 3] / 255; let v;
    if (k === 1) v = clamp(o + d, 0, 1);
    else { const sm = snap(at(res, x + 0.5, y + 0.5)), cor = snap(clamp(o + d, 0, 1)); v = op === 'sub' ? Math.min(cor, sm) : Math.max(cor, sm); }
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; img.data[i + 3] = Math.round((op === 'sub' ? Math.min(o, v) : Math.max(o, v)) * 255);
  }
  sx.putImageData(img, x0, y0);
}
// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher): distance from each cell to the nearest set cell.
function liquidEDT(set, w, h) {
  const INF = 1e20, g = new Float64Array(w * h), n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < w * h; i++) g[i] = set[i] ? 0 : INF;
  const pass = (len) => { let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) { let s2; for (;;) { const p = v[k]; s2 = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p); if (s2 <= z[k] && k > 0) k--; else break; } if (s2 <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; } k++; v[k] = q; z[k] = s2; z[k + 1] = INF; }
    k = 0; for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[p]; } };
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; pass(h); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; pass(w); for (let x = 0; x < w; x++) g[y * w + x] = Math.sqrt(d[x]); }
  return g;
}
// Blend as a radius: Add fills the joint with fillets (morphological closing), Subtract rounds the cut's corners
// (opening). Both act only within twice the radius of the member, so the rest of the outline stays exact.
function liquidSmooth(alpha, member, w, h, r, op) {
  const inside = new Uint8Array(w * h); for (let i = 0; i < inside.length; i++) inside[i] = alpha[i] >= 0.5 ? 1 : 0;
  const near = liquidEDT(member, w, h), out = Float32Array.from(alpha);
  if (op === 'sub') {
    const toOut = liquidEDT(inside.map((v) => 1 - v), w, h), eroded = new Uint8Array(w * h); for (let i = 0; i < eroded.length; i++) eroded[i] = toOut[i] > r ? 1 : 0;
    const dE = liquidEDT(eroded, w, h); for (let i = 0; i < out.length; i++) if (near[i] <= 2 * r) out[i] = Math.min(out[i], clamp(r + 0.5 - dE[i], 0, 1));
  } else {
    const toIn = liquidEDT(inside, w, h), dil = new Uint8Array(w * h); for (let i = 0; i < dil.length; i++) dil[i] = toIn[i] <= r ? 1 : 0;
    const dOut = liquidEDT(dil.map((v) => 1 - v), w, h); for (let i = 0; i < out.length; i++) if (near[i] <= 2 * r) out[i] = Math.max(out[i], clamp(dOut[i] - r + 0.5, 0, 1));
  }
  return out;
}
const liquidOldDraw = drawVectorContent;
drawVectorContent = function (ctx, L, R, lc) {
  const clusters = liquidClusters(L);
  if (!clusters.some((c) => c.members.length)) return liquidOldDraw(ctx, L, R, lc);
  const run = []; const flush = () => { if (run.length) liquidOldDraw(ctx, { ...L, shapes: run.splice(0) }, R, lc); };
  const P = lc.P = deformedPts(L, R.f, lc);
  for (const c of clusters) {
    if (!c.members.length) { run.push(c.base); continue; }
    flush(); drawLiquidCluster(ctx, L, R, lc, c, P);
  }
  flush(); lc.P = P;
};
// Merge bakes a cluster: rasterise its silhouette on a grid in drawing coordinates, smooth it like the renderer,
// trace the contour (marching squares) and replace the base / Add / Subtract shapes with one ordinary shape.
function liquidPolygons(L, sh, P) { return sh.paths.map((id) => L.paths.find((p) => p.id === id)).filter(Boolean).map((path) => vectorSamples(L, path, P, 0, null).map((s) => s.p)); }
function liquidRasterFill(grid, gw, gh, polys, x0, y0, cell, op) {
  for (let j = 0; j < gh; j++) {
    const y = y0 + (j + 0.5) * cell, xs = [];
    for (const poly of polys) for (let i = 0, n = poly.length; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), i1 = Math.min(gw - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
      for (let i = i0; i <= i1; i++) grid[j * gw + i] = op === 'sub' ? 0 : 1;
    }
  }
}
function liquidSilhouetteGrid(L, cl, res = 360) {
  const P = vectorPathPoints(L, 0), shapes = [cl.base, ...cl.members.filter((m) => m.liquid !== 'clip')], polys = new Map(shapes.map((s) => [s, liquidPolygons(L, s, P)]));
  const pts = [...polys.values()].flat(2); if (!pts.length) return null;
  let x0 = Math.min(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), x1 = Math.max(...pts.map((p) => p[0])), y1 = Math.max(...pts.map((p) => p[1]));
  const cell = Math.max(x1 - x0, y1 - y0, 1) / res, maxBlend = Math.max(0, ...cl.members.map((m) => liquidBlend(L, m, 0))), pad = cell * 4 + maxBlend / 100 * 0.35 * Math.max(x1 - x0, y1 - y0); x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const gw = Math.ceil((x1 - x0) / cell), gh = Math.ceil((y1 - y0) / cell);
  let grid = new Float32Array(gw * gh); liquidRasterFill(grid, gw, gh, polys.get(cl.base), x0, y0, cell, 'add');
  for (const m of cl.members) {
    if (m.liquid === 'clip') continue;
    liquidRasterFill(grid, gw, gh, polys.get(m), x0, y0, cell, m.liquid);
    const blend = liquidBlend(L, m, 0); if (blend <= 0) continue;
    const mp = polys.get(m).flat(), size = Math.min(Math.max(...mp.map((p) => p[0])) - Math.min(...mp.map((p) => p[0])), Math.max(...mp.map((p) => p[1])) - Math.min(...mp.map((p) => p[1])));
    const r = blend / 100 * 0.35 * size / cell; if (r < 0.75) continue;
    const mem = new Float32Array(grid.length); liquidRasterFill(mem, gw, gh, polys.get(m), x0, y0, cell, 'add');
    grid = liquidSmooth(grid, Uint8Array.from(mem, (v) => (v >= 0.5 ? 1 : 0)), gw, gh, r, m.liquid);
  }
  return { grid, gw, gh, x0, y0, cell };
}
// Marching squares on a 0..1 grid (threshold 0.5); returns closed loops in grid coordinates (cell centres).
function liquidContours(grid, gw, gh) {
  const v = (i, j) => (i < 0 || j < 0 || i >= gw || j >= gh ? 0 : grid[j * gw + i]);
  const lerpE = (a, b) => (0.5 - a) / ((b - a) || 1e-9);
  const pointOf = (key) => { const [t, i, j] = key.split(','), I = +i, J = +j; return t === 'h' ? [I + lerpE(v(I, J), v(I + 1, J)), J] : [I, J + lerpE(v(I, J), v(I, J + 1))]; };
  const links = new Map(), link = (a, b) => { for (const [x, y] of [[a, b], [b, a]]) { if (!links.has(x)) links.set(x, []); links.get(x).push(y); } };
  for (let j = -1; j < gh; j++) for (let i = -1; i < gw; i++) {
    const tl = v(i, j) >= 0.5, tr = v(i + 1, j) >= 0.5, br = v(i + 1, j + 1) >= 0.5, bl = v(i, j + 1) >= 0.5, c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (!c || c === 15) continue;
    const T = `h,${i},${j}`, B = `h,${i},${j + 1}`, Lf = `v,${i},${j}`, Rt = `v,${i + 1},${j}`;
    const centre = (v(i, j) + v(i + 1, j) + v(i + 1, j + 1) + v(i, j + 1)) / 4 >= 0.5;
    const segs = { 1: [[Lf, B]], 2: [[B, Rt]], 3: [[Lf, Rt]], 4: [[T, Rt]], 5: centre ? [[Lf, T], [B, Rt]] : [[Lf, B], [T, Rt]], 6: [[T, B]], 7: [[Lf, T]], 8: [[Lf, T]], 9: [[T, B]], 10: centre ? [[T, Rt], [Lf, B]] : [[Lf, T], [B, Rt]], 11: [[T, Rt]], 12: [[Lf, Rt]], 13: [[B, Rt]], 14: [[Lf, B]] }[c];
    for (const [a, b] of segs) link(a, b);
  }
  const seen = new Set(), loops = [];
  for (const start of links.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let prev = null, at = start;
    while (at && !seen.has(at)) { seen.add(at); loop.push(pointOf(at)); const next = (links.get(at) || []).find((n) => n !== prev && !seen.has(n)); prev = at; at = next; }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
function liquidMerge(L, base) {
  const cl = liquidClusterOf(L, base); if (!cl || cl.base !== base || !cl.members.some((m) => m.liquid !== 'clip')) throw new Error('Select a Liquid Shape cluster with Add or Subtract members to merge');
  const g = liquidSilhouetteGrid(L, cl); if (!g) throw new Error('Nothing to merge');
  const loops = liquidContours(g.grid, g.gw, g.gh).map((loop) => rdp(loop.map((p) => [g.x0 + (p[0] + 0.5) * g.cell, g.y0 + (p[1] + 0.5) * g.cell]), g.cell * 0.6)).filter((l) => l.length >= 3);
  if (!loops.length) throw new Error('The combined shape is empty');
  const merged = [base, ...cl.members.filter((m) => m.liquid !== 'clip')], index = L.shapes.indexOf(base), style = clone(base);
  const pathIds = loops.map((loop) => { const ids = loop.map((p) => addPoint(L, round(p[0], 3), round(p[1], 3), 0.6)); const path = { id: uid('a'), pts: ids, closed: true }; L.paths.push(path); return path.id; });
  const shape = { ...style, id: uid('s'), paths: pathIds }; delete shape.liquid;
  for (const k of Object.keys(L.ch)) for (const m of merged) if (k.startsWith('sh:' + m.id + ':') && !k.endsWith(':blend')) L.ch[k.replace('sh:' + m.id + ':', 'sh:' + shape.id + ':')] = clone(L.ch[k]);
  L.shapes = L.shapes.filter((s) => !merged.includes(s)); L.shapes.splice(Math.min(index, L.shapes.length), 0, shape);
  deleteChannelsMatching(L, (k) => merged.some((m) => k.startsWith('sh:' + m.id + ':')));
  const used = new Set(L.shapes.flatMap((s) => s.paths)); L.paths = L.paths.filter((p) => used.has(p.id) || !merged.some((m) => m.paths.includes(p.id)));
  vectorCleanup(L); S.selShape = shape.id; return shape;
}
// Select Shape toolbar and actions
const liquidOldOptions = vectorOptionsHTML;
vectorOptionsHTML = function (L) {
  let h = liquidOldOptions(L);
  if (S.tool !== 'shapeselect' || L?.type !== 'vector') return h;
  const sh = L.shapes.find((s) => s.id === S.selShape);
  if (!sh) return h + '<span class="chip">Liquid Shapes: select a filled shape</span>';
  if (!sh.fillOn) return h + '<span class="chip">Liquid Shapes work on filled shapes</span>';
  const cl = liquidClusterOf(L, sh), op = cl && cl.base !== sh ? sh.liquid : 'normal', pos = cl ? [cl.base, ...cl.members].indexOf(sh) + 1 : 1, total = cl ? cl.members.length + 1 : 1;
  const btn = (k, label) => `<button class="btn ${op === k ? 'pri' : ''}" data-va="liq_${k}">${label}</button>`;
  return h + '<span class="sep"></span>' + btn('normal', 'Normal') + btn('add', 'Add') + btn('sub', 'Subtract') + btn('clip', 'Clip') +
    vectorNum('liqblend', 'Blend %', liquidBlend(L, sh, S.frame), 0, 100, 1, ['add', 'sub'].includes(op) ? '' : 'disabled') +
    vectorButton('liq_bottom', 'Select bottom') + vectorButton('liq_top', 'Select top') + `<span class="chip">Cluster ${pos} / ${total}</span>` + vectorButton('liq_merge', 'Merge', 'Bake the combined silhouette into one ordinary shape');
};
const liquidOldRun = vectorRunAction;
vectorRunAction = function (action) {
  if (!String(action).startsWith('liq_')) return liquidOldRun(action);
  const L = selLayer(), sh = L?.type === 'vector' && L.shapes.find((s) => s.id === S.selShape);
  if (!sh) return toast('Select a filled shape with Select Shape (Q)', 'err');
  const cl = liquidClusterOf(L, sh), op = action.slice(4);
  if (op === 'bottom' || op === 'top') { S.selShape = (op === 'bottom' ? cl.base : (cl.members.at(-1) || cl.base)).id; refreshAll(); return renderToolOpts(); }
  if (op === 'merge') { if (!cl.members.some((m) => m.liquid !== 'clip')) return toast('Merge needs Add or Subtract shapes in the cluster', 'err'); return vectorAction('Merge liquid shapes', () => liquidMerge(L, cl.base), true); }
  if (!sh.fillOn) return toast('Liquid Shapes work on filled shapes', 'err');
  if (op !== 'normal' && L.shapes.indexOf(sh) === 0) return toast('Liquid Shapes combine with the shape below — this is the bottom shape', 'err');
  return vectorAction('Liquid shape: ' + op, () => {
    if (op === 'normal') { delete sh.liquid; return; }
    sh.liquid = op; if (sh.blend === undefined) sh.blend = 0;
  });
};
const liquidOldNumeric = vectorNumericChange;
vectorNumericChange = function (key, value) {
  if (key !== 'liqblend') return liquidOldNumeric(key, value);
  const L = selLayer(), sh = L?.type === 'vector' && L.shapes.find((s) => s.id === S.selShape);
  if (!sh || !['add', 'sub'].includes(sh.liquid)) return toast('Blend applies to Add and Subtract shapes', 'err');
  return vectorAction('Liquid blend', () => { if (sh.blend === undefined) sh.blend = 0; setVal(L, 'sh:' + sh.id + ':blend', clamp(+value, 0, 100)); });
};
