/* ===================== Popai Animator — commands, menus, shortcuts, home screen, bootstrap ===================== */

const CMDS = [];
const cmd = (id, menu, label, run, o = {}) => CMDS.push({ id, menu, label, run, ...o });
const needLayer = () => (selLayer() ? false : 'Select a layer first');
const needVector = () => { const L = selLayer(); return L && L.type === 'vector' ? false : 'Select a vector layer'; };
const needPts = () => needVector() || (S.selPts.size ? false : 'Select points with the Points tool');
const needShape = () => needVector() || (S.selShape ? false : 'Select a shape');
const needBoneLayer = () => (activeBoneLayer() ? false : 'Select a bone layer (or a layer inside one)');
const needSwitch = () => (switchTarget() ? false : 'Select a switch layer');
function runCmd(id) {
  const c = CMDS.find((x) => x.id === id); if (!c) return console.warn('no cmd', id);
  const why = c.en && c.en(); if (why) return toast(why, 'err');
  c.run();
}

// File
cmd('file.home', 'File', 'Project home…', () => showHome());
cmd('file.new', 'File', 'New project…', () => newProjectDialog(), { k: 'Ctrl+N', keys: 'ctrl+n' });
cmd('file.open', 'File', 'Open project…', () => pickFile('.json,.popai', importFile), { k: 'Ctrl+O', keys: 'ctrl+o' });
cmd('file.save', 'File', 'Save project (download)', saveProject, { k: 'Ctrl+S', keys: 'ctrl+s', kw: 'package export project' });
cmd('file.recover', 'File', 'Recover autosave', () => recoverAutosave(), { en: () => (lsGet('popai.autosave') ? false : 'No autosave found') });
cmd('file.import', 'File', 'Import image / audio / .dat / palette…', () => pickFile('image/*,audio/*,.wav,.mp3,.dat,.gpl,.json', importFile, true), { k: 'Ctrl+I', keys: 'ctrl+i', kw: 'relink media wav mp3 png jpg' });
cmd('file.export', 'File', 'Export / render…', exportDialog, { k: 'Ctrl+E', keys: 'ctrl+e', kw: 'render png video webm sequence zip' });
cmd('file.exportpng', 'File', 'Export current frame as PNG', async () => download(await canvasBlob(renderFrameCanvas(S.frame)), `${S.doc.name}_${S.frame}.png`));
cmd('file.settings', 'File', 'Project settings…', () => projectSettings(), { kw: 'resolution fps size background' });
// Edit
cmd('edit.undo', 'Edit', 'Undo', undo, { k: 'Ctrl+Z', keys: 'ctrl+z' });
cmd('edit.redo', 'Edit', 'Redo', redo, { k: 'Ctrl+Shift+Z', keys: 'ctrl+shift+z|ctrl+y' });
cmd('edit.copy', 'Edit', 'Copy keys / layer', () => { if (!copyKeys()) { const L = selLayer(); if (L) { TL.layerClip = clone(L); toast('Copied layer'); } } }, { k: 'Ctrl+C', keys: 'ctrl+c' });
cmd('edit.paste', 'Edit', 'Paste keys / layer', () => { if (!pasteKeys() && TL.layerClip) edit('Paste layer', () => { const c = cloneLayer(TL.layerClip); c.name += ' copy'; insertLayer(c); }); }, { k: 'Ctrl+V', keys: 'ctrl+v' });
cmd('edit.delete', 'Edit', 'Delete selection', () => deleteSelection(), { k: 'Del', keys: 'delete|backspace' });
cmd('edit.selall', 'Edit', 'Select all points', () => { const L = selLayer(); if (L && L.type === 'vector') { S.selPts = new Set(Object.keys(L.pts)); if (!POINT_TOOLS.has(S.tool)) setTool('points'); refreshAll(); } }, { k: 'Ctrl+A', keys: 'ctrl+a', en: needVector });
cmd('edit.deselect', 'Edit', 'Deselect', () => { if (S.selPts.size || S.selKeys.size || S.selShape || Object.keys(S.swPreview).length) { S.selPts = new Set(); S.selKeys = new Set(); S.selShape = null; S.swPreview = {}; } else { S.selLayers = []; S.camSel = false; S.selBone = null; } refreshAll(); }, { k: 'Esc' });
cmd('edit.shortcuts', 'Edit', 'Keyboard shortcuts…', () => shortcutsDialog(), { k: '?', kw: 'keys hotkeys' });
// Layer (in Draw menu)
cmd('layer.new', 'Draw', 'New layer…', () => { const r = $('#lyAdd').getBoundingClientRect(); showMenu(r.left, r.bottom, newLayerMenu()); }, { kw: 'add create layer' });
cmd('layer.newswitch', 'Draw', 'New switch layer', () => addLayer('switch'), { kw: 'mouth hands alternate drawings' });
cmd('layer.newinside', 'Draw', 'New vector layer inside selected group', () => edit('New vector layer', () => { const G = selLayer(), L = mkLayer('vector'); G.children.unshift(L); G.open = true; S.selLayers = [L.id]; }), { en: () => (selLayer() && isContainer(selLayer()) ? false : 'Select a Group, Bone Group or Switch Group') });
cmd('layer.pivotcenter', 'Draw', 'Centre pivot on artwork', () => { const L = selLayer(), b = contentBox(Object.assign({}, L, { p: { ...L.p, x: 0, y: 0, rot: 0, sx: 1, sy: 1, ox: 0, oy: 0 }, ch: {} })); if (!b) return toast('This layer has no artwork to centre on', 'err'); edit('Centre pivot', () => { L.p.ox = round((b[0] + b[2]) / 2); L.p.oy = round((b[1] + b[3]) / 2); }); }, { en: needLayer, kw: 'origin anchor' });
cmd('switch.align', 'Audio', 'Align switch alternatives on registration point', () => alignAlternatives(switchTarget()), { en: needSwitch, kw: 'mouth jump register' });
cmd('switch.setactive', 'Audio', 'Set shown alternative active at playhead', () => swSetActive(switchTarget()), { en: needSwitch });
cmd('switch.next', 'Audio', 'Preview next alternative', () => swPreviewStep(switchTarget(), 1), { en: needSwitch });
cmd('switch.prev', 'Audio', 'Preview previous alternative', () => swPreviewStep(switchTarget(), -1), { en: needSwitch });
cmd('layer.dup', 'Draw', 'Duplicate layer', () => edit('Duplicate layer', () => { const L = selLayer(), c = cloneLayer(L); c.name += ' copy'; const sib = siblingsOf(L.id); sib.splice(sib.indexOf(L), 0, c); S.selLayers = [c.id]; }), { k: 'Ctrl+D', keys: 'ctrl+d', en: needLayer });
cmd('layer.del', 'Draw', 'Delete layer', () => edit('Delete layer', () => { for (const id of S.selLayers) { const sib = siblingsOf(id), L = findLayer(id); if (L) sib.splice(sib.indexOf(L), 1); } S.selLayers = []; }), { en: needLayer });
cmd('layer.group', 'Draw', 'Group selected layers', () => edit('Group layers', () => {
  const ls = S.selLayers.map((id) => findLayer(id)).filter(Boolean); const first = ls[0], sib = siblingsOf(first.id), g = mkLayer('group');
  sib.splice(sib.indexOf(first), 0, g);
  for (const L of ls) { const s = siblingsOf(L.id); s.splice(s.indexOf(L), 1); g.children.push(L); }
  S.selLayers = [g.id];
}), { k: 'Ctrl+G', keys: 'ctrl+g', en: needLayer });
cmd('layer.up', 'Draw', 'Raise layer', () => edit('Raise layer', () => { const L = selLayer(), s = siblingsOf(L.id), i = s.indexOf(L); if (i > 0) { s.splice(i, 1); s.splice(i - 1, 0, L); } }), { k: 'Ctrl+↑', keys: 'ctrl+arrowup', en: needLayer });
cmd('layer.down', 'Draw', 'Lower layer', () => edit('Lower layer', () => { const L = selLayer(), s = siblingsOf(L.id), i = s.indexOf(L); if (i < s.length - 1) { s.splice(i, 1); s.splice(i + 1, 0, L); } }), { k: 'Ctrl+↓', keys: 'ctrl+arrowdown', en: needLayer });
cmd('pts.del', 'Draw', 'Delete selected points', () => edit('Delete points', () => { deletePoints(selLayer(), [...S.selPts]); S.selPts = new Set(); }), { en: needPts });
cmd('pts.close', 'Draw', 'Close / open selected path', () => edit('Close path', () => { const L = selLayer(); for (const pa of L.paths) if (pa.pts.some((p) => S.selPts.has(p))) pa.closed = !pa.closed; }), { en: needPts, kw: 'weld join' });
cmd('pts.smooth', 'Draw', 'Make selected points smooth', () => edit('Smooth points', () => { for (const id of S.selPts) selLayer().pts[id].c = 1; }), { en: needPts, kw: 'curvature' });
cmd('pts.corner', 'Draw', 'Make selected points sharp corners', () => edit('Corner points', () => { for (const id of S.selPts) selLayer().pts[id].c = 0; }), { en: needPts, kw: 'curvature peak' });
cmd('pts.flipH', 'Draw', 'Flip points horizontally', () => flipPts(0), { en: needPts, kw: 'mirror' });
cmd('pts.flipV', 'Draw', 'Flip points vertically', () => flipPts(1), { en: needPts, kw: 'mirror' });
cmd('shape.create', 'Draw', 'Create shape from selected points', () => edit('Create shape', () => { const L = selLayer(); const pa = L.paths.filter((p) => p.pts.some((i) => S.selPts.has(i))); if (pa.length) S.selShape = addShape(L, pa.map((p) => p.id)).id; }), { en: needPts, kw: 'fill' });
cmd('shape.del', 'Draw', 'Delete selected shape', () => edit('Delete shape', () => { const L = selLayer(); L.shapes = L.shapes.filter((s) => s.id !== S.selShape); deleteChannelsMatching(L, (k) => k.startsWith('sh:' + S.selShape + ':')); S.selShape = null; }), { en: needShape });
cmd('shape.up', 'Draw', 'Raise shape', () => edit('Raise shape', () => { const L = selLayer(), i = L.shapes.findIndex((s) => s.id === S.selShape); if (i < L.shapes.length - 1) { const [s] = L.shapes.splice(i, 1); L.shapes.splice(i + 1, 0, s); } }), { en: needShape });
cmd('shape.down', 'Draw', 'Lower shape', () => edit('Lower shape', () => { const L = selLayer(), i = L.shapes.findIndex((s) => s.id === S.selShape); if (i > 0) { const [s] = L.shapes.splice(i, 1); L.shapes.splice(i - 1, 0, s); } }), { en: needShape });
cmd('shape.defaults', 'Draw', 'Apply default style to shape', () => edit('Apply style', () => { const L = selLayer(), sh = L.shapes.find((s) => s.id === S.selShape), n = S.newStyle; sh.styleId = null; Object.assign(sh, { fillOn: n.fillOn, strokeOn: n.strokeOn }); for (const k of ['fill', 'stroke', 'width']) setVal(L, 'sh:' + sh.id + ':' + k, n[k]); }), { en: needShape });
cmd('style.new', 'Draw', 'New shared style', () => edit('New style', () => S.doc.styles.push({ id: uid('st'), name: 'Style ' + (S.doc.styles.length + 1), ...clone(S.newStyle) })), { kw: 'skin jacket outline' });
cmd('style.fromshape', 'Draw', 'New shared style from shape (and link it)', () => edit('Style from shape', () => { const L = selLayer(), sh = L.shapes.find((s) => s.id === S.selShape), st = shapeStyle(L, sh, S.frame); const s = { id: uid('st'), name: 'Style ' + (S.doc.styles.length + 1), fill: st.fill, stroke: st.stroke, width: st.width, fillOn: st.fillOn, strokeOn: st.strokeOn }; S.doc.styles.push(s); sh.styleId = s.id; }), { en: needShape });
cmd('pal.add', 'Draw', 'Add fill color to palette', () => edit('Add swatch', () => S.doc.palette.push(S.newStyle.fill)));
cmd('pal.export', 'Draw', 'Export palette (.gpl)', exportGpl);
cmd('pal.import', 'Draw', 'Import palette (.gpl)', () => pickFile('.gpl,.txt', importFile));
cmd('img.native', 'Draw', 'Image: reset to native size', () => edit('Native size', () => { const L = selLayer(); const m = S.media[L.media]; if (m && m.el) { L.iw = m.el.naturalWidth; L.ih = m.el.naturalHeight; } }), { en: () => (selLayer() && selLayer().type === 'image' ? false : 'Select an image layer') });
// Rig
cmd('mode.setup', 'Rig', 'Setup mode (rest pose, bones, binding)', () => setMode('setup'), { k: 'Tab', kw: 'rig edit rest' });
cmd('mode.animate', 'Rig', 'Animate mode (record keys)', () => setMode('animate'), { k: 'Tab' });
cmd('rig.newbone', 'Rig', 'New bone group', () => addLayer('bone'), { kw: 'skeleton rig layer' });
cmd('rig.autobind', 'Rig', 'Bind points to bones (weighted)…', () => autoBindDialog(), { en: () => needVector() || (boneLayerFor(selLayer()) ? false : 'The vector layer must be inside a Bone Group'), kw: 'weights skin smart auto' });
async function autoBindDialog() {
  const L = selLayer(), B = boneLayerFor(L);
  const r = await modal('Bind points (weighted)', `<div class="note">Each point gets weights from its nearest bones, so joints bend smoothly. Untick bones that must <b>not</b> pull this artwork — e.g. keep the hand bone away from the torso.</div>
    <div class="form" style="grid-template-columns:22px 1fr">${B.bones.map((b) => `<input type="checkbox" name="b_${b.id}" checked><span>🦴 ${esc(b.name)}</span>`).join('')}</div>
    <div class="note">${S.selPts.size ? `Binds the ${S.selPts.size} selected points.` : 'Binds all points of “' + esc(L.name) + '”.'} Happens in Setup mode.</div>`, [{ label: 'Cancel', value: false }, { label: 'Bind', value: true, pri: true }]);
  if (!r || !r.v) return;
  const allowed = B.bones.filter((b) => r.data['b_' + b.id]).map((b) => b.id);
  if (!allowed.length) return toast('Choose at least one bone', 'err');
  if (S.mode !== 'setup') setMode('setup');
  let n; edit('Bind points', () => (n = autoBindPoints(L, B, S.selPts.size ? [...S.selPts] : Object.keys(L.pts), allowed)));
  toast(`Bound ${n} points to ${allowed.length} bone(s) — select a bone to see its weights`, 'ok');
}
cmd('rig.bindpts', 'Rig', 'Bind selected points to selected bone', () => { const L = selLayer(), B = boneLayerFor(L); if (!B || !S.selBone || !B.bones.some((b) => b.id === S.selBone)) return toast('Select a bone (Transform bone tool) in the parent bone layer, then the points', 'err'); edit('Bind points', () => { for (const id of S.selPts) L.pts[id].b = [[S.selBone, 1]]; L.bindBone = null; }); }, { en: needPts });
cmd('rig.unbindpts', 'Rig', 'Unbind points', () => edit('Unbind points', () => { const L = selLayer(); for (const id of S.selPts.size ? S.selPts : Object.keys(L.pts)) delete L.pts[id].b; }), { en: needVector });
cmd('bone.del', 'Rig', 'Delete selected bone', () => edit('Delete bone', () => {
  const B = activeBoneLayer(), b = B.bones.find((x) => x.id === S.selBone); if (!b) return;
  for (const c of B.bones) if (c.parent === b.id) c.parent = b.parent;
  B.bones = B.bones.filter((x) => x !== b); deleteChannelsMatching(B, (k) => k.startsWith('bone:' + b.id + ':'));
  walk(B.children, (L) => { if (L.bindBone === b.id) L.bindBone = null; if (Array.isArray(L.flexiBones)) L.flexiBones = L.flexiBones.filter((id) => id !== b.id); if (L.pts) for (const p of Object.values(L.pts)) if (p.b && p.b.length) { p.b = p.b.filter(([id]) => id !== b.id); if (!p.b.length) delete p.b; } });
  S.selBone = null;
}), { en: () => needBoneLayer() || (S.selBone ? false : 'Select a bone') });
cmd('rig.test', 'Rig', 'Rig test: preview pose suite', () => rigTest(), { en: needBoneLayer, kw: 'check repair stretching' });
cmd('pose.save', 'Animate', 'Save bone pose…', async () => { const B = activeBoneLayer(); const n = await askText('Save pose', 'Pose name', 'Pose ' + ((B.poses || []).length + 1)); if (!n) return; edit('Save pose', () => { B.poses = B.poses || []; B.poses.push({ id: uid('po'), name: n, data: Object.fromEntries(B.bones.map((b) => [b.id, { a: val(B, 'bone:' + b.id + ':a', S.frame), p: val(B, 'bone:' + b.id + ':p', S.frame) }])) }); }); }, { en: needBoneLayer, kw: 'library' });
cmd('pose.apply', 'Animate', 'Apply saved pose…', () => { const B = activeBoneLayer(); if (!(B.poses || []).length) return toast('No saved poses on this rig yet', 'err'); const r = $('#btnCmd').getBoundingClientRect(); showMenu(r.left, r.bottom, B.poses.map((p) => ({ label: p.name, run: () => edit('Apply pose ' + p.name, () => { for (const id in p.data) if (B.bones.some((b) => b.id === id)) { setVal(B, 'bone:' + id + ':a', p.data[id].a); setVal(B, 'bone:' + id + ':p', p.data[id].p); } }) }))); }, { en: needBoneLayer });
// Animate
cmd('anim.play', 'Animate', 'Play / pause', togglePlay, { k: 'Space' });
cmd('anim.next', 'Animate', 'Next frame', () => setFrame(S.frame + 1), { k: '.', keys: '.|arrowright' });
cmd('anim.prev', 'Animate', 'Previous frame', () => setFrame(Math.max(0, S.frame - 1)), { k: ',', keys: ',|arrowleft' });
cmd('anim.first', 'Animate', 'First frame', () => setFrame(0), { k: 'Shift+Home', keys: 'shift+home' });
cmd('anim.last', 'Animate', 'Last frame', () => setFrame(timelineEnd()), { k: 'End', keys: 'end' });
cmd('anim.nextkey', 'Animate', 'Next keyframe (selected layer)', () => jumpKey(1), { k: 'Shift+.', keys: 'shift+>|shift+.' });
cmd('anim.prevkey', 'Animate', 'Previous keyframe (selected layer)', () => jumpKey(-1), { k: 'Shift+,', keys: 'shift+<|shift+,' });
cmd('key.settings', 'Animate', 'Keyframe settings… (interpolation, cycle, hold, interval, stagger, label)', () => keyframePanel(), { k: 'Ctrl+Alt+E', keys: 'ctrl+alt+e', kw: 'keyframe window interpolation cycle hold interval stagger label' });
cmd('anim.keyall', 'Animate', 'Key pose in current editing context', keyCurrentTimelinePose, { en: () => S.camSel ? false : needLayer(), kw: 'freeze bone point pose' });
cmd('anim.delkeys', 'Animate', 'Delete selected keys', deleteSelectedKeys, { en: () => (S.selKeys.size ? false : 'Select keys in the timeline') });
cmd('anim.clear', 'Animate', 'Clear all animation on selected layer', () => edit('Clear animation', () => { const L = selLayer(); if(actActive()&&!actOwnsLayer(L))throw Error('Select a layer inside the active Action'); for (const p of Object.keys(L.ch)) { if(!actActive())baseSet(L, p, val(L, p, 0)); delete L.ch[p]; } }), { en: needLayer, kw: 'reset' });
for (const [k, n] of INTERPS) cmd('interp.' + k, 'Animate', 'Interpolation: ' + n, () => setInterpSelected(k), { en: () => (S.selKeys.size ? false : 'Select keys in the timeline'), kw: 'curve ease tween' });
cmd('anim.retime', 'Animate', 'Scale timing of selected keys…', async () => { const t = await askText('Retime keys', 'Scale factor around the earliest key (e.g. 0.5 = twice as fast)', '1.5'); const k = +t; if (!k || k <= 0) return; const items = [...S.selKeys].map(parseKid).filter((x) => x.o); const f0 = Math.min(...items.map((x) => x.f)); edit('Retime keys', () => { const ns = new Set(); const moves = items.map((x) => ({ ...x, key: clone(keyAt(x.o, x.path, x.f)) })); for (const m of moves) m.o.ch[m.path].keys = m.o.ch[m.path].keys.filter((q) => q.f !== m.f); for (const m of moves) { const nf = Math.round(f0 + (m.f - f0) * k); setKey(m.o.ch[m.path], nf, m.key.v, m.key.i); ns.add(kid(m.o, m.path, nf)); } S.selKeys = ns; }); }, { en: () => (S.selKeys.size > 1 ? false : 'Select 2+ keys'), kw: 'speed faster slower stretch' });
cmd('anim.onion', 'Animate', 'Toggle onion skins', () => { S.onion = !S.onion; renderTLBar(); requestDraw(); }, { k: 'Shift+O', keys: 'shift+o' });
cmd('anim.marker', 'Animate', 'Add marker at playhead…', async () => { const n = await askText('Add marker', 'Name', 'Beat'); if (n) edit('Add marker', () => S.doc.markers.push({ id: uid('m'), f: S.frame, name: n, color: '#5ccf8a' })); }, { kw: 'beat cue' });
// Effects
for (const [k, d] of Object.entries(FX)) cmd('fx.add.' + k, 'Effects', 'Add effect: ' + d.label, () => addEffect(selLayer(), k), { en: needLayer });
cmd('fx.particles', 'Effects', 'Particle emitter tool', () => setTool('emitter'), { kw: 'dust fire smoke sparks snow rain' });
cmd('fx.savepreset', 'Effects', 'Save effect stack as preset…', async () => { const L = selLayer(); const n = await askText('Effect preset', 'Name', L.name + ' look'); if (n) edit('Save preset', () => { S.doc.fxPresets = S.doc.fxPresets || []; S.doc.fxPresets.push({ name: n, fx: L.fx.map((e) => ({ type: e.type, on: e.on, p: fxParamsAt(L, e, S.frame) })) }); }); }, { en: () => (selLayer() && selLayer().fx.length ? false : 'Select a layer with effects') });
cmd('fx.applypreset', 'Effects', 'Apply effect preset…', () => { const r = $('#btnCmd').getBoundingClientRect(); showMenu(r.left, r.bottom, (S.doc.fxPresets || []).map((p) => ({ label: p.name, run: () => edit('Apply preset', () => { const L = selLayer(); for (const e of p.fx) L.fx.push({ id: uid('fx'), type: e.type, on: e.on, p: clone(e.p) }); }) }))); }, { en: () => needLayer() || ((S.doc.fxPresets || []).length ? false : 'No presets saved yet') });
cmd('fx.mask', 'Effects', 'Make group masked by its bottom layer', () => edit('Mask group', () => (selLayer().mask = 'bottom')), { en: () => (selLayer() && selLayer().type === 'group' ? false : 'Select a group layer'), kw: 'matte clip' });
// AI
cmd('ai.panel', 'AI', 'Open AI assistant', () => { setTab('ai'); setTimeout(() => $('#aiText') && $('#aiText').focus(), 30); }, { k: 'Ctrl+J', keys: 'ctrl+j', kw: 'prompt chat natural language' });
cmd('ai.lipsync', 'AI', 'Auto lip sync…', openLipSync, { k: 'Ctrl+L', keys: 'ctrl+l', kw: 'mouth viseme phoneme dialogue shona' });
cmd('ai.jobs', 'AI', 'Job history', () => setTab('jobs'));
cmd('ai.settings', 'AI', 'AI engine settings…', aiSettings, { kw: 'llm openrouter endpoint model' });
cmd('switch.mouthkit', 'AI', 'Create starter mouth set (switch layer)', () => edit('Mouth set', () => { const SW = mouthKit(); const L = selLayer(); if (L && (L.type === 'bone' || L.type === 'group')) { L.children.unshift(SW); L.open = true; } else S.doc.layers.unshift(SW); S.selLayers = [SW.id]; setTimeout(() => setTab('switch'), 20); }), { kw: 'viseme preston blair' });
cmd('switch.addchild', 'Audio', 'Add drawing to switch layer', () => edit('Add drawing', () => { const SW = switchTarget(), L = mkLayer('vector', 'Drawing ' + (SW.children.length + 1)); SW.children.unshift(L); S.selLayers = [L.id]; }), { en: needSwitch });
cmd('switch.exportdat', 'Audio', 'Export switch keys as Moho .dat', exportDat, { en: needSwitch, kw: 'papagayo mohoswitch' });
cmd('switch.importdat', 'Audio', 'Import Moho .dat into switch', () => pickFile('.dat,.txt', importFile), { en: needSwitch, kw: 'papagayo' });
// Camera
cmd('cam.tool', 'Camera', 'Camera tool', () => setTool('camera'), { kw: 'track dolly zoom roll' });
cmd('cam.select', 'Camera', 'Select camera (properties & keys)', () => { S.camSel = true; S.selLayers = []; setTab('props'); refreshAll(); });
cmd('cam.reset', 'Camera', 'Remove all camera animation', () => edit('Reset camera', () => { const c = S.doc.camera; c.ch = {}; Object.assign(c.p, { x: 0, y: 0, zoom: 1, roll: 0, shake: 0 }); }));
cmd('cam.shake', 'Camera', 'Camera shake at playhead', () => edit('Camera shake', () => applyCmd({ op: 'camshake', start: S.frame, dur: 10, amp: 18 })), { kw: 'impact' });
// Audio
cmd('audio.import', 'Audio', 'Import audio…', () => pickFile('audio/*,.wav,.mp3', importFile), { kw: 'wav mp3 dialogue' });
cmd('audio.fitend', 'Audio', 'Fit timeline to audio', () => { const L = selLayer(), m = S.media[L.media]; if (m && m.buffer) edit('Fit timeline', () => (S.doc.end = L.offset + Math.ceil(m.buffer.duration * S.doc.fps))); }, { en: () => (selLayer() && selLayer().type === 'audio' ? false : 'Select an audio layer') });
// View
cmd('view.fit', 'View', 'Reset view (fit frame, no rotation)', fitView, { k: 'Home / Ctrl+0', keys: 'home|ctrl+0' });
cmd('view.100', 'View', 'Zoom 100%', () => { S.view.zoom = 1; requestDraw(); }, { k: '1', keys: 'ctrl+1' });
cmd('view.zin', 'View', 'Zoom in', () => zoomAt(Stage.cv.width / 2, Stage.cv.height / 2, 1.25), { k: '+', keys: '=|+' });
cmd('view.zout', 'View', 'Zoom out', () => zoomAt(Stage.cv.width / 2, Stage.cv.height / 2, 0.8), { k: '-', keys: '-' });
cmd('view.output', 'View', 'Output only (hide overlays)', () => { S.outputOnly = !S.outputOnly; $('[data-view=output]').classList.toggle('on', S.outputOnly); requestDraw(); }, { k: 'O', keys: 'o' });
cmd('view.paths', 'View', 'Toggle motion paths', () => { S.showPaths = !S.showPaths; requestDraw(); });
// Window
for (const [t, n] of [['props', 'Properties'], ['style', 'Style'], ['switch', 'Switch'], ['ai', 'AI assistant'], ['jobs', 'Jobs']]) cmd('win.' + t, 'Window', n + ' panel', () => setTab(t));
cmd('win.layout.draw', 'Window', 'Layout: Drawing (big stage)', () => setLayout(150, 300));
cmd('win.layout.anim', 'Window', 'Layout: Animation (big timeline)', () => setLayout(340, 330));
cmd('win.layout.default', 'Window', 'Layout: Default', () => setLayout(250, 330));
// Help
cmd('help.guide', 'Help', 'Quick guide', () => quickGuide(), { k: 'F1', keys: 'f1' });
cmd('help.shortcuts', 'Help', 'Keyboard shortcuts', () => shortcutsDialog());
cmd('help.about', 'Help', 'About Popai Animator', () => modal('About', `<div class="note"><b>Popai Animator</b> — a browser-based 2D animation studio inspired by Moho's workflow: vector layers, bones with IK and smooth binding, switch layers, keyframes with curves, a 2.5D camera, effects, particles, sound-based lip sync and an AI assistant that edits real keyframes.<br><br>Everything runs locally in your browser. Projects save as a single .popai.json file that includes your images and audio.</div>`));

const MENUS = ['File', 'Edit', 'Draw', 'Rig', 'Animate', 'Effects', 'AI', 'Camera', 'Audio', 'View', 'Window', 'Help'];
function menuItems(m) {
  const items = []; let lastGroup = null;
  for (const c of CMDS.filter((x) => x.menu === m)) {
    const g = c.id.split('.')[0]; if (lastGroup && g !== lastGroup) items.push({ sep: 1 }); lastGroup = g;
    items.push({ label: c.label, k: c.k, run: () => runCmd(c.id), dis: c.en });
  }
  if (m === 'Draw') items.unshift(...TOOL_GROUPS.slice(1, 3).flatMap(([, ids]) => ids).map((id) => ({ label: 'Tool: ' + TOOLS[id].name, k: TOOLS[id].key, run: () => setTool(id) })), { sep: 1 });
  if (m === 'Rig') items.unshift(...TOOL_GROUPS.find((g) => g[0] === 'Bone')[1].map((id) => ({ label: 'Tool: ' + TOOLS[id].name, k: TOOLS[id].key, run: () => setTool(id), dis: () => toolAvail(id) })), { sep: 1 });
  return items;
}
function initMenus() {
  const nav = $('#menus');
  for (const m of MENUS) {
    const b = document.createElement('button'); b.textContent = m;
    b.onclick = () => { const r = b.getBoundingClientRect(); if (b.classList.contains('open')) return closeMenus(); showMenu(r.left, r.bottom + 2, menuItems(m), b); };
    b.onmouseenter = () => { if ($('#menuLayer .dd') && !b.classList.contains('open')) b.click(); };
    nav.appendChild(b);
  }
  $('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo; $('#btnCmd').onclick = commandPalette;
  $('#docname').onclick = projectSettings;
}

// ---------- command palette ----------
function commandPalette() {
  const all = [...CMDS.map((c) => ({ label: c.label, menu: c.menu, k: c.k, kw: c.kw || '', run: () => runCmd(c.id), en: c.en })),
    ...Object.values(TOOLS).map((t) => ({ label: 'Tool: ' + t.name, menu: 'Tools', k: t.key, kw: t.hint, run: () => setTool(t.id), en: () => toolAvail(t.id) }))];
  modal('⌕ Search commands', `<div class="cmdp"><input type="text" id="cpq" placeholder="Type an action — e.g. lip sync, glow, bone, mouth, export…" autocomplete="off"><div class="cmdlist" id="cpl"></div></div>`, []);
  const q = $('#cpq'), list = $('#cpl'); let idx = 0, shown = [];
  const draw = () => {
    const t = q.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    shown = all.filter((c) => t.every((w) => (c.label + ' ' + c.menu + ' ' + c.kw).toLowerCase().includes(w))).slice(0, 60);
    idx = Math.min(idx, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((c, i) => { const why = c.en && c.en(); return `<div class="ci ${i === idx ? 'on' : ''} ${why ? 'dis' : ''}" data-i="${i}"><span class="m">${c.menu}</span><span>${esc(c.label)}</span>${why ? `<span class="why">— ${esc(why)}</span>` : ''}<span class="k">${c.k ? esc(c.k) : ''}</span></div>`; }).join('') || '<div class="note">No matching command.</div>';
    list.querySelectorAll('.ci').forEach((el) => (el.onclick = () => go(+el.dataset.i)));
  };
  const go = (i) => { const c = shown[i]; if (!c) return; closeModal(null); setTimeout(() => (c.en && c.en() ? toast(c.en(), 'err') : c.run()), 10); };
  q.oninput = () => { idx = 0; draw(); };
  q.onkeydown = (e) => { if (e.key === 'ArrowDown') { idx = Math.min(shown.length - 1, idx + 1); draw(); e.preventDefault(); } if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); } if (e.key === 'Enter') { e.preventDefault(); go(idx); } };
  draw(); setTimeout(() => q.focus(), 20);
}

// ---------- misc actions ----------
function deleteSelection() {
  if (S.selKeys.size && deleteSelectedKeys()) return;
  const L = selLayer();
  if (L && L.type === 'vector' && S.selPts.size && POINT_TOOLS.has(S.tool)) return runCmd('pts.del');
  if (S.selBone && BONE_TOOLS.has(S.tool)) return runCmd('bone.del');
  if (L) runCmd('layer.del');
}
function flipPts(axis) {
  const L = selLayer(), ids = [...S.selPts], vs = ids.map((id) => val(L, 'pt:' + id, S.frame)), c = vs.reduce((s, v) => s + v[axis], 0) / vs.length;
  edit('Flip points', () => ids.forEach((id, i) => { const v = vs[i].slice(); v[axis] = round(2 * c - v[axis]); setVal(L, 'pt:' + id, v); }));
}
function jumpKey(dir) {
  const L = S.camSel ? S.doc.camera : selLayer(); if (!L) return;
  if(actActive()&&!actOwnsLayer(L))return;
  const fs = [...new Set(Object.values(L.ch).flatMap((c) => c.keys.map((k) => k.f)))].sort((a, b) => a - b);
  const n = dir > 0 ? fs.find((f) => f > S.frame) : fs.reverse().find((f) => f < S.frame);
  if (n !== undefined) setFrame(n);
}
function rigTest() {
  const B = activeBoneLayer(); if (!B.bones.length) return toast('This rig has no bones', 'err');
  // non-destructive: preview a sequence of poses then restore the exact document
  const snap = snapshot(); let i = 0;
  const poses = [['Rest', 0], ['Bend +45°', 45], ['Bend −45°', -45], ['Extreme +90°', 90], ['Extreme −90°', -90]];
  toast('Rig test: previewing pose suite (document is restored afterwards)');
  const step = () => {
    restore(snap);
    if (i >= poses.length) { refreshAll(); toast('Rig test finished — check for tearing or stray points', 'ok'); return; }
    const Bc = findLayer(B.id), [name, d] = poses[i++];
    for (const b of Bc.bones) if (b.parent) baseSet(Bc, 'bone:' + b.id + ':a', b.a + d * 0.6), delete Bc.ch['bone:' + b.id + ':a'];
    toast('Pose: ' + name); renderStage(); setTimeout(step, 700);
  };
  step();
}
function setLayout(tlh, rw) { document.documentElement.style.setProperty('--tlh', tlh + 'px'); document.documentElement.style.setProperty('--rw', rw + 'px'); requestDraw(); }
function updateTitle() { $('#docname').textContent = S.doc.name + ` · ${S.doc.w}×${S.doc.h} · ${S.doc.fps} fps`; document.title = S.doc.name + ' — Popai Animator'; }
async function projectSettings() {
  const d = S.doc;
  const r = await modal('Project settings', `<div class="form"><label>Name</label><input type="text" name="name" value="${esc(d.name)}">
    <label>Width</label><input type="number" name="w" value="${d.w}"><label>Height</label><input type="number" name="h" value="${d.h}">
    <label>Frame rate</label><input type="number" name="fps" value="${d.fps}"><label>End frame</label><input type="number" name="end" value="${d.end}">
    <label>Background</label><input type="color" name="bg" value="${d.bg}"></div>`, [{ label: 'Cancel', value: false }, { label: 'Apply', value: true, pri: true }]);
  if (!r || !r.v) return;
  edit('Project settings', () => { const o = r.data; d.name = o.name || d.name; d.w = Math.max(16, o.w | 0); d.h = Math.max(16, o.h | 0); d.fps = clamp(+o.fps, 1, 120); d.end = Math.max(1, o.end | 0); d.bg = o.bg; });
  updateTitle(); renderTLBar(); fitView();
}
const PRESETS = [['HD 1280×720', 1280, 720], ['Full HD 1920×1080', 1920, 1080], ['Square 1080×1080', 1080, 1080], ['Vertical 1080×1920', 1080, 1920], ['4K 3840×2160', 3840, 2160]];
async function newProjectDialog() {
  const r = await modal('New project', `<div class="form"><label>Name</label><input type="text" name="name" value="Untitled">
    <label>Format</label><select name="preset">${PRESETS.map((p, i) => `<option value="${i}">${p[0]}</option>`).join('')}</select>
    <label>Frame rate</label><select name="fps"><option>12</option><option selected>24</option><option>25</option><option>30</option><option>60</option></select>
    <label>Length (frames)</label><input type="number" name="end" value="120"></div>`, [{ label: 'Cancel', value: false }, { label: 'Create', value: true, pri: true }]);
  if (!r || !r.v) return false;
  const p = PRESETS[+r.data.preset];
  startDoc(newDoc({ name: r.data.name, w: p[1], h: p[2], fps: +r.data.fps, end: Math.max(1, r.data.end | 0) }));
  return true;
}
function startDoc(d) {
  if (S.playing) stopPlay();
  documentEpoch++; invalidateScene(); S.doc = d; S.dirtyDoc = false; if (!d.media) d.media = {}; S.frame = 0; S.mode = 'setup'; S.swPreview = {}; S.alignOverlay = false; updateModeUI(); S.selLayers = S.selLayers.filter((id) => findLayer(id)); S.selPts = new Set(); S.selKeys = new Set(); S.selBone = null; S.camSel = false;
  H.undo = []; H.redo = []; H.pending = null; TL.active = null; aiPending = null;
  updateTitle(); renderTLBar(); fitView(); refreshAll();
}
async function recoverAutosave() { const s = lsGet('popai.autosave'); if (!s) return; try { await loadProjectJSON(s); toast('Recovered autosave', 'ok'); } catch (e) { toast('Autosave unreadable', 'err'); } }
function showHome() {
  const t = lsGet('popai.autosave.t');
  modal('', `<div class="homein"><div class="hero">${typeof POPAI_WORDMARK === 'string' && POPAI_WORDMARK ? `<img src="${POPAI_WORDMARK}" alt="Popai Animator" style="height:64px;margin-right:6px">` : '<span style="font-size:42px;color:var(--acc)">◆</span>'}<div><div class="big" ${typeof POPAI_WORDMARK === 'string' && POPAI_WORDMARK ? 'style="display:none"' : ''}>Popai <b>Animator</b></div><div class="note" style="margin:2px 0 0">2D animation studio — vectors, bones, switches, lip sync, effects and an AI assistant. Vector animation, rigging and effects in one workspace.</div></div></div>
    <div class="grid">
      <div class="card" data-h="new"><h5>＋ New project</h5><p>Choose resolution and frame rate.</p></div>
      <div class="card" data-h="demo"><h5>✦ Demo scene</h5><p>A rigged character that talks, waves, jumps — with dust, trail and camera shake. Great to explore.</p></div>
      <div class="card" data-h="open"><h5>📂 Open project…</h5><p>Load a .popai.json file (media included).</p></div>
      <div class="card" data-h="blank"><h5>▭ Quick blank (HD, 24 fps)</h5><p>Skip the settings and start drawing.</p></div>
      <div class="card" data-h="recover" style="${t ? '' : 'opacity:.45;pointer-events:none'}"><h5>⟲ Recover autosave</h5><p>${t ? 'Last autosave: ' + esc(t) : 'No autosave yet'}</p></div>
      <div class="card" data-h="guide"><h5>? Quick guide</h5><p>How drawing, rigging, keys and lip sync work here.</p></div>
    </div></div>`, [], 'home');
  $$('#modal [data-h]').forEach((c) => (c.onclick = async () => {
    const h = c.dataset.h; closeModal(null);
    if (h === 'new') { if (!(await newProjectDialog())) showHome(); }
    if (h === 'blank') startDoc(newDoc({ name: 'Untitled' }));
    if (h === 'demo') { startDoc(demoProject()); S.selLayers = [allLayers().find((l) => l.type === 'bone').id]; refreshAll(); toast('Demo loaded — press Space to play', 'ok'); }
    if (h === 'open') pickFile('.json,.popai', importFile);
    if (h === 'recover') recoverAutosave();
    if (h === 'guide') quickGuide();
  }));
}
function quickGuide() {
  modal('Quick guide', `<div class="note" style="max-width:640px">
  <b>1 · Draw.</b> Enter Setup mode (Tab), then use Pen (P), Freehand (F), Rectangle (R), Ellipse (E) or Polygon (Y). Points live on vector layers; shapes give them fill and stroke. Points tool (A) edits them; Paint bucket (B) fills closed paths.<br><br>
  <b>2 · Animate.</b> Frame 0 is the setup pose. Go to another frame and change an animatable property — Auto-key creates keys. Right-click keys to change interpolation; switch to Curves to shape them. Onion skins (Shift+O) show neighbours.<br><br>
  <b>3 · Rig.</b> Create a Bone Group and press <b>Tab</b> for Setup mode. Draw bones with Add bone (N) — the selected bone becomes the parent. Put artwork inside, then attach whole layers to a bone (L) or bind points with weights (Rig ▸ Bind points). Press Tab again for Animate and pose with Manipulate bones (M); IK pulls the parent chain. The toolbar only enables tools that fit the selected layer and mode — hover a dimmed tool to see why.<br><br>
  <b>4 · Talk.</b> Import a WAV/MP3, create a mouth set (AI ▸ Create starter mouth set) and run AI ▸ Auto lip sync. It listens to the sound, so Shona and English both work. Fix any frame from the Switch tab; export the result as a Moho .dat.<br><br>
  <b>5 · Effects & camera.</b> Each layer has an ordered effects stack. Camera tools: Track (4), Zoom (5), Roll (6), Pan/Tilt (7). Alt-drag with Track to dolly. Orbit Workspace (9) inspects depth; Home returns to Camera view. Open Camera properties for lens, focus and shake. Layer Depth Z gives parallax.<br><br>
  <b>6 · AI.</b> In the AI tab, describe the change. You get a plan of validated commands first; Apply turns it into normal keys/effects that one Undo reverts.<br><br>
  <b>7 · Save & export.</b> Ctrl+S saves a project file with all media; the desktop app writes directly to disk. File ▸ Export renders PNG, PNG sequences or WebM video with audio.</div>`);
}
function shortcutsDialog() {
  const rows = [...Object.values(TOOLS).map((t) => [t.key, 'Tool: ' + t.name]), ...CMDS.filter((c) => c.k).map((c) => [c.k, c.label]), ['Space (hold)', 'Pan the stage'], ['Wheel / Ctrl+wheel', 'Zoom stage / timeline'], ['Shift+drag', 'Constrain / zoom camera'], ['1–9', 'Pick switch drawing (Switch tab)']];
  modal('Keyboard shortcuts', `<div class="form" style="grid-template-columns:150px 1fr;max-height:60vh;overflow:auto">${rows.map(([k, n]) => `<kbd>${esc(k)}</kbd><span>${esc(n)}</span>`).join('')}</div>`);
}

// ---------- keyboard ----------
function keyName(e) { let k = e.key.toLowerCase(); if (k === ' ') k = 'space'; return (e.ctrlKey || e.metaKey ? 'ctrl+' : '') + (e.shiftKey && (k.length > 1 || /^[a-z0-9<>]$/.test(k)) ? 'shift+' : '') + (e.altKey ? 'alt+' : '') + k; }
function initKeys() {
  document.addEventListener('keydown', (e) => {
    if ($('#modal').classList.contains('show')) return;
    const tag = document.activeElement.tagName;
    if (/INPUT|TEXTAREA|SELECT/.test(tag) && !(e.ctrlKey && /^[zsy]$/i.test(e.key))) return;
    const k = keyName(e);
    // Moho: Ctrl+K opens the Actions panel; command search moved to Ctrl+Shift+P.
    if (k === 'ctrl+shift+p') { e.preventDefault(); return commandPalette(); }
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) { e.preventDefault(); return setMode(S.mode === 'setup' ? 'animate' : 'setup'); }
    if (e.key === ' ') { e.preventDefault(); if (!e.repeat) { Stage.spaceT = performance.now(); Stage.space = true; setCursor(); } return; }
    if (e.key === 'Escape') { if (Stage.pen) finishPen(false); else runCmd('edit.deselect'); closeMenus(); return; }
    if (e.key === 'Enter' && Stage.pen) { finishPen(false); return; }
    if (k === 'shift+o') { e.preventDefault(); return runCmd('anim.onion'); }
    if (e.shiftKey && (e.key === '>' || e.key === '.')) { e.preventDefault(); return runCmd('anim.nextkey'); }
    if (e.shiftKey && (e.key === '<' || e.key === ',')) { e.preventDefault(); return runCmd('anim.prevkey'); }
    if (e.key === '?') return shortcutsDialog();
    // arrow nudge for selected layer/points with select/points tools
    if (/^arrow/.test(e.key.toLowerCase()) && !e.ctrlKey && (S.tool === 'select' || S.tool === 'points' || S.tool === 'pointtf') && (S.selLayers.length || S.selPts.size) && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.altKey)) {
      e.preventDefault(); const n = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
      const L = selLayer(); if (!L) return;
      if ((S.tool === 'points' || S.tool === 'pointtf') && S.selPts.size && L.type === 'vector') edit('Nudge points', () => { for (const id of S.selPts) { const v = val(L, 'pt:' + id, S.frame); setVal(L, 'pt:' + id, [v[0] + dx, v[1] + dy]); } });
      else edit('Nudge layer', () => { for (const id of S.selLayers) { const T = findLayer(id); setVal(T, 'x', val(T, 'x', S.frame) + dx); setVal(T, 'y', val(T, 'y', S.frame) + dy); } });
      return;
    }
    const c = CMDS.find((c) => c.keys && c.keys.split('|').includes(k));
    if (c) { e.preventDefault(); runCmd(c.id); return; }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = Object.values(TOOLS).find((t) => t.key && t.key.toLowerCase() === e.key.toLowerCase());
      if (t) { e.preventDefault(); setTool(t.id); return; }
      if (e.key.toLowerCase() === 'f' && !t) fitView();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && Stage.space) {
      Stage.space = false; setCursor();
      if (performance.now() - Stage.spaceT < 220 && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !$('#modal').classList.contains('show')) { if (S.tool === 'bindpts') runCmd('rig.bindpts'); else togglePlay(); }
    }
  });
}

// ---------- splitters & drag-drop ----------
function initSplitters() {
  const drag = (el, fn) => el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); const mv = (ev) => fn(ev); el.addEventListener('pointermove', mv); el.addEventListener('pointerup', () => el.removeEventListener('pointermove', mv), { once: true }); });
  drag($('#tsplit'), (e) => { document.documentElement.style.setProperty('--tlh', clamp(innerHeight - e.clientY, 90, innerHeight - 200) + 'px'); requestDraw(); });
  drag($('#rsplit'), (e) => { const top = $('#right').getBoundingClientRect().top; document.documentElement.style.setProperty('--lyh', clamp(e.clientY - top, 80, 600) + 'px'); });
  const sw = $('#stagewrap');
  ['dragenter', 'dragover'].forEach((ev) => sw.addEventListener(ev, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); sw.classList.add('drag'); } }));
  ['dragleave', 'drop'].forEach((ev) => sw.addEventListener(ev, () => sw.classList.remove('drag')));
  sw.addEventListener('drop', (e) => { e.preventDefault(); [...e.dataTransfer.files].forEach(importFile); });
}

// ---------- boot ----------
function boot() {
  S.doc = newDoc();
  initStage(); initTimeline(); initLayersPanel(); initSide(); initMenus(); initKeys(); initSplitters();
  UI.panels.push(renderLayers, renderSide, updateUndoButtons, updateToolbar, renderToolOpts);
  $$('#modeSeg button').forEach((b) => (b.onclick = () => setMode(b.dataset.m))); updateModeUI();
  setTool('select'); updateTitle(); fitView(); refreshAll();
  setInterval(autosave, 15000);
  window.addEventListener('beforeunload', (e) => { if (S.dirtyDoc) { autosave(); e.preventDefault(); e.returnValue = ''; } });
  showHome();
}
function updateUndoButtons() { $('#btnUndo').disabled = !H.undo.length; $('#btnRedo').disabled = !H.redo.length; $('#btnUndo').title = H.undo.length ? 'Undo: ' + H.undo[H.undo.length - 1].label + ' (Ctrl+Z)' : 'Nothing to undo'; $('#btnRedo').title = H.redo.length ? 'Redo: ' + H.redo[H.redo.length - 1].label : 'Nothing to redo'; }
window.PopaiApp = { boneScreen, simulateBones, boneFrames, setMode, toolAvail, swSetActive, switchState, contentBox, S, H, CMDS, runCmd, edit, setFrame, setTool, findLayer, allLayers, renderScene, parseAI, applyCmd, demoProject, startDoc, val, TL, Stage, loadProjectJSON, serialize, analyzeSpeech, Jobs, openLipSync };
// Boot is invoked by the bundle after reliability guards are installed.
