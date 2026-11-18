/* ===================== Popai Animator — panels: layers, inspector, style, switch; menus & dialogs ===================== */

// ---------- generic popup menu ----------
function closeMenus() { $('#menuLayer').innerHTML = ''; $$('#menus>button').forEach((b) => b.classList.remove('open')); }
function showMenu(x, y, items, anchorBtn) {
  closeMenus();
  const dd = document.createElement('div'); dd.className = 'dd';
  for (const it of items) {
    if (it.sep) { dd.appendChild(document.createElement('hr')); continue; }
    if (it.hd) { const h = document.createElement('div'); h.className = 'hd'; h.textContent = it.hd; dd.appendChild(h); continue; }
    const m = document.createElement('div');
    const dis = typeof it.dis === 'function' ? it.dis() : it.dis;
    m.className = 'mi' + (dis ? ' dis' : '');
    m.innerHTML = `${it.dot ? `<span style="width:8px;height:8px;border-radius:2px;background:${it.dot};display:inline-block"></span>` : ''}<span>${esc(it.label)}</span>${it.tag ? `<span class="tg">${esc(it.tag)}</span>` : ''}${it.k ? `<span class="k">${esc(it.k)}</span>` : ''}`;
    if (dis && typeof dis === 'string') m.title = dis;
    m.onclick = (e) => { e.stopPropagation(); closeMenus(); it.run && it.run(); };
    dd.appendChild(m);
  }
  $('#menuLayer').appendChild(dd);
  const r = dd.getBoundingClientRect();
  dd.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
  dd.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
  if (anchorBtn) anchorBtn.classList.add('open');
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.dd') && !e.target.closest('#menus')) closeMenus(); });

// Keep the original container, children, animation, IDs, styles and effects.
function convertGroupLayer(L,type){
  assertWritable(L);
  if(L.type!=='group'||!['bone','switch'].includes(type))throw Error('Choose a group layer to convert');
  if(type==='bone'){
    const check=child=>{
      if(child.type==='bone')return;
      if(child.bindBone||child.flexiBones?.length||Object.values(child.pts||{}).some(p=>p.b?.length))throw Error('Release existing bindings inside this group before converting it to a new Bone layer');
      (child.children||[]).forEach(check);
    };
    L.children.forEach(check);
    L.type='bone';L.bones=[];
  }else{L.type='switch';L.p.sw=L.children[0]?.id||null;L.swMode='discrete';L.swFade=4;}
  L.open=true;S.selLayers=[L.id];S.selBone=null;S.selBones=[];
  if(type==='switch')setTimeout(()=>setTool('switchlayer'),0);
}

// ---------- modal dialogs ----------
let _modalResolve = null;
function modal(title, bodyHtml, buttons = [{ label: 'OK', value: true, pri: true }], cls = '') {
  const m = $('#modal');
  m.innerHTML = `<div class="dlg ${cls}"><h3>${title}<span class="x" data-v="__x">✕</span></h3><div class="db">${bodyHtml}</div>${buttons.length ? `<div class="df">${buttons.map((b, i) => `<button class="btn ${b.pri ? 'pri' : ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>` : ''}</div>`;
  m.classList.add('show');
  return new Promise((res) => {
    _modalResolve = res;
    m.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => closeModal(buttons[+b.dataset.i].value)));
    m.querySelector('[data-v="__x"]').onclick = () => closeModal(null);
    const f = m.querySelector('input,textarea,select'); if (f) setTimeout(() => f.focus(), 30);
  });
}
function closeModal(v) { const m = $('#modal'); m.classList.remove('show'); const r = _modalResolve; _modalResolve = null; const body = m.querySelector('.db'); const data = body ? formData(body) : {}; m.innerHTML = ''; if (r) r(v === null ? null : { v, data }); }
function formData(el) { const o = {}; el.querySelectorAll('[name]').forEach((i) => (o[i.name] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value)); return o; }
async function askText(title, label, def = '') {
  const r = await modal(esc(title), `<div class="form"><label>${esc(label)}</label><input type="text" name="t" value="${esc(def)}"></div>`, [{ label: 'Cancel', value: false }, { label: 'OK', value: true, pri: true }]);
  return r && r.v ? r.data.t : null;
}
document.addEventListener('keydown', (e) => {
  if (!$('#modal').classList.contains('show')) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(null); }
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !$('#modal .cmdp')) { const b = $('#modal .btn.pri'); if (b) { e.preventDefault(); b.click(); } }
}, true);

// ---------- layers panel ----------
function layerTags(L) {
  const t = [];
  if (L.fx.some((e) => e.on)) t.push('fx');
  if (L.type === 'group' && L.mask !== 'none') t.push('mask');
  if (Object.keys(L.ch).length) t.push('◆');
  if (!L.render) t.push('⊘');
  return t.join(' ');
}
function renderLayers() {
  const el = $('#layerTree'); let h = '';
  const prim = S.selLayers[S.selLayers.length - 1];
  const rec = (list, depth, swParent) => {
    for (const L of list) {
      const active = swParent && switchState(swParent, S.frame).cur === L.id;
      const bi = typeof bindingInfo === 'function' ? bindingInfo(L) : null;
      const att = bi && (bi.mode === 'Attached' ? '↳ ' + bi.text.replace('Attached to: ', '') : bi.mode === 'Weighted' || bi.mode === 'Points' ? '↳ ' + bi.mode.toLowerCase() : '');
      h += `<div class="lrow ${S.selLayers.includes(L.id) ? 'sel' : ''} ${prim === L.id ? 'prim' : ''} ${swParent && !active ? 'alt-off' : ''}" data-id="${L.id}" draggable="true" style="padding-left:${depth * 14}px;border-left-color:${L.label || 'transparent'}">
        <span class="tw" data-act="tw">${L.children ? (L.open ? '▾' : '▸') : ''}</span>${swParent ? `<span class="ab ${active ? 'act' : ''}" data-act="activate" title="${active ? 'Active at this frame' : 'Set active at playhead (adds a switch key at frame ' + S.frame + ')'}">${active ? '●' : '○'}</span>` : ''}<span class="ic">${LAYER_TYPES[L.type].icon}</span>
        <span class="nm" title="${esc(LAYER_TYPES[L.type].name)}${bi ? ' · ' + esc(bi.text) : ''}">${esc(L.name)}</span>${isContainer(L) ? `<span class="tp">${L.type === 'group' ? 'group' : L.type === 'bone' ? 'bones' : 'switch'}</span>` : ''}${att ? `<span class="att">${esc(att)}</span>` : ''}<span class="tag">${layerTags(L)}</span>
        <span class="vb ${L.vis ? '' : 'off'}" data-act="vis" title="Show/hide">👁</span><span class="lb ${L.lock ? '' : 'off'}" data-act="lock" title="Lock">🔒</span></div>`;
      if (L.children && L.open) rec(L.children, depth + 1, L.type === 'switch' ? L : null);
    }
  };
  rec(S.doc.layers, 0, null);
  if (!S.doc.layers.length) h = `<div class="note" style="padding:10px">No layers yet. Pick a drawing tool and draw on the stage, or use <b>＋</b> to add a layer. Drop images or audio onto the stage to import.</div>`;
  el.innerHTML = h;
}
function initLayersPanel() {
  const el = $('#layerTree');
  el.addEventListener('click', (e) => {
    const row = e.target.closest('.lrow'); if (!row) return;
    const L = findLayer(row.dataset.id); if (!L) return;
    const act = e.target.dataset.act;
    if (act === 'tw') { L.open = !L.open; refreshAll(); return; }
    if (act === 'activate') { const P = parentOf(L.id); if (P && P.type === 'switch') swSetActive(P, L.id); return; }
    if (act === 'vis') return edit(L.vis ? 'Hide layer' : 'Show layer', () => (L.vis = !L.vis));
    if (act === 'lock') return edit(L.lock ? 'Unlock layer' : 'Lock layer', () => (L.lock = !L.lock));
    S.camSel = false;
    if (e.ctrlKey || e.metaKey) S.selLayers = S.selLayers.includes(L.id) ? S.selLayers.filter((i) => i !== L.id) : [...S.selLayers, L.id];
    else if (e.shiftKey && S.selLayers.length) {
      const flat = allLayers().map((l) => l.id), a = flat.indexOf(S.selLayers[S.selLayers.length - 1]), b = flat.indexOf(L.id);
      S.selLayers = flat.slice(Math.min(a, b), Math.max(a, b) + 1);
    } else S.selLayers = [L.id];
    S.selPts = new Set(); S.selShape = null;
    if (L.type === 'switch' || (parentOf(L.id) || {}).type === 'switch') { /* keep tab */ }
    refreshAll();
  });
  el.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.lrow'); if (!row || e.target.dataset.act) return;
    // Moho: double-clicking a layer opens Layer Settings; Alt+double-click renames in place.
    if (!e.altKey && typeof openLayerSettings === 'function') { if (!S.selLayers.includes(row.dataset.id)) S.selLayers = [row.dataset.id]; refreshAll(); return openLayerSettings(); }
    const L = findLayer(row.dataset.id), nm = row.querySelector('.nm');
    nm.innerHTML = `<input type="text" value="${esc(L.name)}">`; const i = nm.querySelector('input'); i.focus(); i.select();
    const done = (ok) => { if (ok && i.value.trim() && i.value !== L.name) edit('Rename layer', () => (L.name = i.value.trim())); else refreshAll(); };
    i.onkeydown = (ev) => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); ev.stopPropagation(); };
    i.onblur = () => done(true);
  });
  el.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.lrow'); if (!row) return; e.preventDefault();
    const L = findLayer(row.dataset.id); if (!S.selLayers.includes(L.id)) { S.selLayers = [L.id]; refreshAll(); }
    showMenu(e.clientX, e.clientY, [
      { label: 'Rename…', run: () => askText('Rename layer', 'Name', L.name).then((n) => n && edit('Rename', () => (L.name = n))) },
      { label: 'Duplicate', k: 'Ctrl+D', run: () => runCmd('layer.dup') },
      { label: 'Group selected', k: 'Ctrl+G', run: () => runCmd('layer.group') },
      ...(L.type==='group' ? [
        {label:'Convert to Bone layer',dis:()=>writeReason(L),run:()=>edit('Convert group to Bone layer',()=>convertGroupLayer(L,'bone'))},
        {label:'Convert to Switch layer',dis:()=>writeReason(L),run:()=>edit('Convert group to Switch layer',()=>convertGroupLayer(L,'switch'))},
        {sep:1}
      ] : []),
      { label: 'Raise layer', run: () => runCmd('layer.up') },
      { label: 'Lower layer', run: () => runCmd('layer.down') },
      { label: L.render ? 'Exclude from render' : 'Include in render', run: () => edit('Toggle render', () => (L.render = !L.render)) },
      { hd: 'Color label' },
      ...[['None', ''], ['Red', '#ff5d5d'], ['Orange', '#ff8a3d'], ['Green', '#5ccf8a'], ['Blue', '#4dabf7'], ['Purple', '#b26bff']].map(([n, c]) => ({ label: n, dot: c || '#444', run: () => edit('Label', () => (L.label = c)) })),
      { sep: 1 }, { label: 'Delete', k: 'Del', run: () => runCmd('layer.del') },
    ]);
  });
  // drag & drop reordering
  let dragId = null;
  el.addEventListener('dragstart', (e) => { const row = e.target.closest('.lrow'); dragId = row && row.dataset.id; e.dataTransfer.effectAllowed = 'move'; });
  const where = (e, row) => { const r = row.getBoundingClientRect(), t = (e.clientY - r.top) / r.height, L = findLayer(row.dataset.id); return isContainer(L) && t > 0.3 && t < 0.7 ? 'in' : t < 0.5 ? 'above' : 'below'; };
  el.addEventListener('dragover', (e) => {
    const row = e.target.closest('.lrow'); if (!row || !dragId) return; e.preventDefault();
    $$('.lrow', el).forEach((r) => r.classList.remove('dropin', 'dropabove', 'dropbelow'));
    row.classList.add('drop' + where(e, row));
  });
  el.addEventListener('drop', (e) => {
    const row = e.target.closest('.lrow'); if (!row || !dragId) return; e.preventDefault();
    const w = where(e, row), target = findLayer(row.dataset.id), L = findLayer(dragId); dragId = null;
    if (!L || !target || L === target || ancestors(target.id).includes(L)) return refreshAll();
    edit('Move layer', () => {
      reparentLayerSafe(L, target, w);
    });
  });
  el.addEventListener('dragend', () => { dragId = null; $$('.lrow', el).forEach((r) => r.classList.remove('dropin', 'dropabove', 'dropbelow')); });
  $('#lyAdd').onclick = (e) => { const r = e.target.getBoundingClientRect(); showMenu(r.left, r.bottom + 2, newLayerMenu()); };
  $('#lyDup').onclick = () => runCmd('layer.dup'); $('#lyDel').onclick = () => runCmd('layer.del'); $('#lyGroup').onclick = () => runCmd('layer.group');
  $('#lyUp').onclick = () => runCmd('layer.up'); $('#lyDown').onclick = () => runCmd('layer.down');
}
function newLayerMenu() {
  return [
    ...['vector', 'group', 'bone', 'switch', 'text', 'particle'].map((t) => ({ label: LAYER_TYPES[t].icon + '  ' + LAYER_TYPES[t].name + (/Group/.test(LAYER_TYPES[t].name) ? '' : ' layer'), run: () => addLayer(t) })),
    { sep: 1 },
    { label: '🖼  Image… (import)', run: () => pickFile('image/*', importFile) },
    { label: '♪  Audio… (import)', run: () => pickFile('audio/*', importFile) },
  ];
}
function insertLayer(L) {
  const sel = selLayer();
  if (sel && isContainer(sel) && sel.type !== 'switch') { sel.children.unshift(L); sel.open = true; }
  else if (sel) { const sib = siblingsOf(sel.id); sib.splice(sib.indexOf(sel), 0, L); }
  else S.doc.layers.unshift(L);
  S.selLayers = [L.id]; S.camSel = false;
}
function addLayer(type) {
  edit('New ' + LAYER_TYPES[type].name + ' layer', () => {
    const L = mkLayer(type);
    if (type === 'particle') applyParticlePreset(L, 'Magic');
    insertLayer(L);
  });
}
function cloneLayer(L) {
  const map = {};
  const c = clone(L);
  const reid = (x) => { const n = uid('L'); map[x.id] = n; x.id = n; if (x.children) x.children.forEach(reid); };
  reid(c);
  const fix = (x) => {
    if (x.type === 'switch') { if (map[x.p.sw]) x.p.sw = map[x.p.sw]; if (x.ch.sw) x.ch.sw.keys.forEach((k) => (k.v = map[k.v] || k.v)); }
    for (const e of x.fx) { const ne = uid('fx'); for (const k of Object.keys(x.ch)) if (k.startsWith('fx:' + e.id + ':')) { x.ch[k.replace(e.id, ne)] = x.ch[k]; delete x.ch[k]; } e.id = ne; }
    if (x.children) x.children.forEach(fix);
  };
  fix(c);
  return c;
}

// ---------- inspector ----------
let currentTab = 'props', inspFilter = '';
function setTab(t) { if(t==='switch'&&selLayer()?.type!=='switch')t='props'; currentTab = t; $$('#sideTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t)); _panelsDirty = true; drawNow(); }
function keyBtn(o, path) {
  const anim = isKeyed(o, path), here = anim && keyAt(o, path, S.frame);
  return `<button class="kbtn ${here ? 'here' : anim ? 'anim' : ''}" data-key="${esc(path)}" data-owner="${o.id}" title="${here ? 'Remove key at this frame' : 'Add key at this frame'}">${here ? '◆' : anim ? '◈' : '◇'}</button>`;
}
function numRow(o, path, label, opt = {}) {
  let v = val(o, path, S.frame); if (opt.comp !== undefined) v = v[opt.comp];
  if (opt.scale) v *= opt.scale;
  const st = opt.step ?? 1;
  return `<div class="prow" data-label="${esc(label.toLowerCase())}"><span class="pl" data-scrub="${esc(path)}" data-owner="${o.id}" data-step="${st}" data-comp="${opt.comp ?? ''}" data-scale="${opt.scale || 1}" data-min="${opt.min ?? ''}" data-max="${opt.max ?? ''}" title="Drag to change">${esc(label)}</span>
    <span class="pv"><input type="number" step="${st}" value="${round(v, opt.dec ?? 2)}" data-path="${esc(path)}" data-owner="${o.id}" data-comp="${opt.comp ?? ''}" data-scale="${opt.scale || 1}" ${opt.min !== undefined ? `min="${opt.min}"` : ''} ${opt.max !== undefined ? `max="${opt.max}"` : ''}>${opt.unit ? `<span style="color:var(--faint)">${opt.unit}</span>` : ''}</span>
    ${opt.nokey ? '<span></span>' : keyBtn(o, path)}</div>`;
}
function colorRow(o, path, label, opt = {}) {
  return `<div class="prow" data-label="${esc(label.toLowerCase())}"><span class="pl nodrag">${esc(label)}</span><span class="pv"><input type="color" value="${val(o, path, S.frame)}" data-path="${esc(path)}" data-owner="${o.id}"><span style="color:var(--faint)">${val(o, path, S.frame)}</span></span>${opt.nokey ? '<span></span>' : keyBtn(o, path)}</div>`;
}
function fieldRow(label, html) { return `<div class="prow" data-label="${esc(label.toLowerCase())}"><span class="pl nodrag">${esc(label)}</span><span class="pv">${html}</span><span></span></div>`; }
function sec(title, body, right = '', free = false) { return `<div class="sec"><h4>${title}<span class="r">${right}</span></h4><div class="body ${free ? 'free' : ''}">${body}</div></div>`; }
function sel_(name, opts, cur, attrs = '') { return `<select ${attrs} data-f="${name}">${opts.map(([v, n]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`; }

function renderProps() {
  const el = $('#tabBody');
  let h = `<input type="text" class="insp-search" id="inspSearch" placeholder="Search properties (e.g. opacity, blur)…" value="${esc(inspFilter)}">`;
  if (S.camSel) h += cameraProps();
  else {
    const L = selLayer();
    if (!L) h += docProps();
    else h += layerProps(L);
  }
  el.innerHTML = h;
  bindProps(el);
  applyInspFilter();
  const s = $('#inspSearch'); s.oninput = () => { inspFilter = s.value; applyInspFilter(); };
}
function applyInspFilter() {
  const q = inspFilter.trim().toLowerCase();
  $$('#tabBody .prow').forEach((r) => {
    const m = !q || (r.dataset.label || '').includes(q);
    [...r.children].forEach((c) => { c.style.display = m ? '' : 'none'; c.classList.toggle('hl', !!q && m && c.classList.contains('pl')); });
  });
  $$('#tabBody .sec').forEach((s) => { if (!q) { s.style.display = ''; return; } const any = [...s.querySelectorAll('.prow')].some((r) => (r.dataset.label || '').includes(q)); s.style.display = any ? '' : 'none'; });
}
function docProps() {
  const d = S.doc;
  return sec('🎬 Project', `
    ${fieldRow('Name', `<input type="text" data-doc="name" value="${esc(d.name)}">`)}
    ${fieldRow('Width', `<input type="number" data-doc="w" value="${d.w}" min="16">`)}
    ${fieldRow('Height', `<input type="number" data-doc="h" value="${d.h}" min="16">`)}
    ${fieldRow('Frame rate', `<input type="number" data-doc="fps" value="${d.fps}" min="1" max="120">`)}
    ${fieldRow('End frame', `<input type="number" data-doc="end" value="${d.end}" min="1">`)}
    ${fieldRow('Background', `<input type="color" data-doc="bg" value="${d.bg}">`)}`) +
    sec('Getting started', `<div class="note">
      <b>Draw:</b> pick Pen, Freehand, Rectangle or Ellipse and draw on the stage — a vector layer is created for you.<br>
      <b>Animate:</b> move to another frame on the timeline and move/rotate something — keys are created automatically (Auto-key). Frame 0 is the setup pose.<br>
      <b>Rig:</b> add a Bone layer, draw bones with <b>Add bone</b>, put artwork inside, then bind it (Bind tool or Rig ▸ Auto-bind points).<br>
      <b>Lip sync:</b> import audio, create a Switch layer with mouth drawings, then AI ▸ Lip sync.<br>
      <b>AI:</b> open the AI tab and type things like “make it jump at frame 12, leave a glowing trail, shake the camera on landing and add dust”.<br>
      Press <kbd>Ctrl Shift P</kbd> to search every command.</div>`, '', true);
}
function cameraProps() {
  const c = S.doc.camera;
  return sec('🎥 Camera', numRow(c, 'x', 'Track X') + numRow(c, 'y', 'Track Y') + numRow(c, 'zoom', 'Zoom', { step: 0.01, min: 0.05 }) + numRow(c, 'roll', 'Roll', { unit: '°' }) +
    numRow(c, 'shake', 'Shake amount', { min: 0 }) + numRow(c, 'shakeFreq', 'Shake frequency', { step: 0.5, min: 0 })) +
    sec('Notes', `<div class="note">Layers with a <b>Depth Z</b> value move with parallax when the camera tracks (2.5D multiplane). Use the <b>Camera</b> tool (K) to drag the camera directly. Shake is deterministic, so renders repeat exactly.</div>`, '', true);
}
function layerProps(L) {
  const f = S.frame, multi = S.selLayers.length > 1;
  let h = '';
  const B = boneLayerFor(L);
  h += sec(`${LAYER_TYPES[L.type].icon} ${esc(LAYER_TYPES[L.type].name)} layer${multi ? ` <span style="color:var(--faint)">(+${S.selLayers.length - 1} more selected)</span>` : ''}`,
    fieldRow('Name', `<input type="text" data-lf="name" value="${esc(L.name)}">`) +
    fieldRow('Blend mode', sel_('blend', [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['lighter', 'Add'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color dodge'], ['difference', 'Difference']], L.blend, 'data-lsel="blend"')) +
    fieldRow('Render', `<label><input type="checkbox" data-lchk="render" ${L.render ? 'checked' : ''}> include in export</label>`));
  if (B && L.type !== 'audio') {
    const bi = bindingInfo(L);
    h += sec('🦴 Controlled by ' + esc(B.name), fieldRow('Attached to', sel_('bind', [['', '— not attached —'], ...B.bones.map((b) => [b.id, b.name])], L.bindBone || '', 'data-lsel="bindBone"' + (S.mode !== 'setup' ? ' disabled title="Switch to Setup (Tab) to change attachments"' : ''))) +
      `<div class="note" style="grid-column:1/-1"><b>${esc(bi.text)}.</b> ${L.type === 'vector' ? 'Whole-layer attachment moves the layer as one unit and overrides point binding. Bound points follow one bone each; released points ignore the skeleton; all other points are flexi-bound.' : L.type === 'bone' ? '' : 'Everything inside this layer follows the bone it is attached to; Switch and other animation still work inside it.'}</div>` +
      (L.type === 'vector' ? `<div style="grid-column:1/-1" class="btnrow"><button class="btn" data-cmd="rig.bindpts">Bind selected points → selected bone</button><button class="btn" data-cmd="rig.unbindpts">Un-bind (release) points</button><button class="btn" data-cmd="rig.flexipts">Flexi-bind points</button><button class="btn" data-cmd="rig.autobind">Weighted binding…</button></div>` : '') +
      (L.type !== 'bone' ? `<div style="grid-column:1/-1" class="btnrow"><button class="btn" data-cmd="rig.releaselayer">Release layer</button><button class="btn" data-cmd="rig.flexilayer">Flexi-bind layer</button><button class="btn" data-cmd="rig.flexiselected">Use selected bones for flexi-binding</button><button class="btn" data-cmd="rig.flexiall">Use all bones</button></div>` : '') +
      (S.mode !== 'setup' ? `<div style="grid-column:1/-1" class="btnrow"><button class="btn" data-cmd="mode.setup">Enter Setup to change binding</button><button class="btn" data-ctx2="poseparent">✋ Pose parent rig</button></div>` : ''));
  }
  if (L.type === 'vector') {
    const nsel = S.selPts.size;
    h += sec('Vector', `<div class="note">${Object.keys(L.pts).length} points · ${L.paths.length} paths · ${L.shapes.length} shapes${nsel ? ` · <b>${nsel} selected</b>` : ''}</div>
      <div class="btnrow"><button class="btn" data-tool="points">Edit points</button><button class="btn" data-tab="style">Style…</button>${nsel ? '<button class="btn" data-cmd="pts.del">Delete points</button>' : ''}${S.selShape ? '<button class="btn" data-cmd="shape.del">Delete shape</button>' : ''}</div>`, '', true);
    if (nsel === 1) { const id = [...S.selPts][0]; h += sec('Selected point', numRow(L, 'pt:' + id, 'X', { comp: 0 }) + numRow(L, 'pt:' + id, 'Y', { comp: 1 }) + fieldRow('Curvature', `<input type="number" step="0.05" min="0" max="2.5" data-curv="${id}" value="${L.pts[id].c ?? 1}">`)); }
  }
  if (L.type === 'text') h += sec('Text', `<div class="prow" data-label="text"><span class="pl nodrag">Text</span><span class="pv"><textarea rows="2" data-lf="text" style="width:100%">${esc(L.text)}</textarea></span><span></span></div>` +
    fieldRow('Size', `<input type="number" data-lfn="size" value="${L.size}" min="1">`) + fieldRow('Font', sel_('font', [['Inter, system-ui, sans-serif', 'Sans'], ['Georgia, serif', 'Serif'], ['"Comic Sans MS", "Comic Neue", cursive', 'Comic'], ['Impact, "Arial Black", sans-serif', 'Impact'], ['ui-monospace, monospace', 'Mono']], L.font, 'data-lsel="font"')) +
    fieldRow('Bold', `<input type="checkbox" data-lchk="bold" ${L.bold ? 'checked' : ''}>`) + colorRow(L, 'color', 'Color'));
  if (L.type === 'image') { const m = S.media[L.media]; h += sec('Image', `<div class="note" style="grid-column:1/-1">Source: <b>${esc(m ? m.name : 'missing')}</b>${m ? '' : ' — relink via File ▸ Import'}</div>` + fieldRow('Width', `<input type="number" data-lfn="iw" value="${L.iw}">`) + fieldRow('Height', `<input type="number" data-lfn="ih" value="${L.ih}">`) + `<div class="btnrow" style="grid-column:1/-1"><button class="btn" data-cmd="img.native">Reset to native size</button></div>`); }
  if (L.type === 'audio') {
    const m = S.media[L.media];
    h += sec('♪ Audio', `<div class="note" style="grid-column:1/-1">${m ? `<b>${esc(m.name)}</b> · ${m.buffer ? round(m.buffer.duration, 2) + ' s · ' + Math.ceil(m.buffer.duration * S.doc.fps) + ' frames' : 'decoding…'}` : 'Missing media'}</div>` +
      fieldRow('Start frame', `<input type="number" data-lfn="offset" value="${L.offset}">`) + numRow(L, 'gain', 'Gain', { step: 0.05, min: 0, max: 4 }) + fieldRow('Mute', `<input type="checkbox" data-lchk="mute" ${L.mute ? 'checked' : ''}>`) +
      `<div class="btnrow" style="grid-column:1/-1"><button class="btn pri" data-cmd="ai.lipsync">Lip sync from this audio…</button><button class="btn" data-cmd="audio.fitend">Fit timeline to audio</button></div>`);
  }
  if (L.type === 'group') h += sec('Group', fieldRow('Masking', sel_('mask', [['none', 'No mask'], ['bottom', 'Bottom child masks the rest'], ['invert', 'Bottom child cuts out (invert)']], L.mask, 'data-lsel="mask"')) +
    `<div class="note" style="grid-column:1/-1">Moving or rotating the group carries its ${L.children.length} children around the group pivot. Effects on a child affect only that child; effects on this group apply after the children are combined. Reordering inside the group never moves a child outside it.</div>`);
  if (L.type === 'switch') {
    const st = switchState(L, f), act = L.children.find((c) => c.id === st.cur);
    h += sec('⇄ Switch Group', `<div class="note" style="grid-column:1/-1">${L.children.length} alternatives · active at frame ${f}: <b>${esc(act ? act.name : '—')}</b>. Keys store each drawing’s permanent ID, so renaming never breaks animation.</div>` +
      fieldRow('Transition', sel_('swMode', [['discrete', 'Discrete (instant)'], ['crossfade', 'Crossfade']], L.swMode || 'discrete', 'data-lsel="swMode"')) +
      (L.swMode === 'crossfade' ? fieldRow('Fade frames', `<input type="number" data-lfn="swFade" value="${L.swFade || 4}" min="1" max="48">`) : '') +
      `<div class="note" style="grid-column:1/-1">Vector morphing needs drawings with matching point structure, so it isn’t offered automatically. Crossfade works with any drawings but can show a double image while overlapping.</div>
      <div class="btnrow" style="grid-column:1/-1"><button class="btn" data-tab="switch">Switch editor</button><button class="btn" data-cmd="switch.align">Align alternatives</button><button class="btn" data-cmd="ai.lipsync">Lip sync…</button></div>`);
  }
  if (L.type === 'bone') {
    const b = L.bones.find((x) => x.id === S.selBone);
    if (b) h += sec('Bone: ' + esc(b.name), fieldRow('Name', `<input type="text" data-bf="name" value="${esc(b.name)}">`) +
      fieldRow('Parent', sel_('parent', [['', '— root —'], ...L.bones.filter((x) => x.id !== b.id && !boneDescends(L, x.id, b.id)).map((x) => [x.id, x.name])], b.parent || '', 'data-bsel="parent"')) +
      numRow(L, 'bone:' + b.id + ':a', 'Angle', { unit: '°' }) + numRow(L, 'bone:' + b.id + ':p', 'Position X', { comp: 0 }) + numRow(L, 'bone:' + b.id + ':p', 'Position Y', { comp: 1 }) + numRow(L, 'bone:' + b.id + ':s', 'Scale', { step: 0.01 }) +
      fieldRow('Color', `<input type="color" data-bf="color" value="${b.color && b.color[0] === '#' ? b.color : '#6e8cff'}">`) +
      fieldRow('Strength', `<input type="number" data-bfn="str" value="${b.str || 0}" min="0" title="Influence region for flexible binding (Bone strength tool)">`) +
      fieldRow('Offset (exploded rig)', `<input type="number" data-bfn="ox" value="${b.ox || 0}" style="width:50%"><input type="number" data-bfn="oy" value="${b.oy || 0}" style="width:50%">`) +
      ((L.vgroups || []).length ? fieldRow('Vitruvian group', sel_('vg', [['', '— all constructions —'], ...L.vgroups.map((g) => [g, g])], b.vg || '', 'data-bf="vg"')) : '') +
      fieldRow('Physics', `<label><input type="checkbox" data-bdyn="on" ${b.dyn && b.dyn.on ? 'checked' : ''}> springy follow-through</label>`) +
      (b.dyn && b.dyn.on ? fieldRow('Spring / damping', `<input type="number" data-bdyn="spring" value="${b.dyn.spring ?? 60}" style="width:50%"><input type="number" data-bdyn="damp" value="${b.dyn.damp ?? 11}" style="width:50%">`) : '') +
      fieldRow('Length (setup)', `<input type="number" data-bfn="len" value="${b.len}" min="1">`) +
      fieldRow('Angle limits', `<input type="number" data-bfn="min" value="${b.min ?? ''}" placeholder="min" style="width:50%"><input type="number" data-bfn="max" value="${b.max ?? ''}" placeholder="max" style="width:50%">`) +
      fieldRow('IK', `<label><input type="checkbox" data-bchk="ikStop" ${b.ikStop ? 'checked' : ''}> stop IK chain here</label>`) +
      `<div class="btnrow" style="grid-column:1/-1"><button class="btn danger" data-cmd="bone.del">Delete bone</button></div>`);
  }
  if (L.type === 'particle') {
    h += sec('✦ Emitter', fieldRow('Preset', sel_('preset', [['', '— custom —'], ...Object.keys(PARTICLE_PRESETS).map((k) => [k, k])], L.preset || '', 'data-lsel="preset"')) +
      fieldRow('Mode', sel_('mode', [['continuous', 'Continuous'], ['burst', 'Burst (one shot)']], L.mode, 'data-lsel="mode"')) +
      fieldRow(L.mode === 'burst' ? 'Burst at frame' : 'Start frame', `<input type="number" data-lfn="startF" value="${L.startF}">`) +
      (L.mode === 'burst' ? fieldRow('Burst count', `<input type="number" data-lfn="burst" value="${L.burst}" min="1" max="3000">`) : fieldRow('End frame', `<input type="number" data-lfn="endF" value="${L.endF}">`) + numRow(L, 'rate', 'Rate /s', { min: 0 })) +
      fieldRow('Shape', sel_('shape', [['soft', 'Soft puff'], ['circle', 'Circle'], ['square', 'Square'], ['streak', 'Streak'], ['star', 'Star']], L.shape, 'data-lsel="shape"')) +
      fieldRow('Emit from', sel_('emit', [['point', 'Point'], ['circle', 'Circle'], ['line', 'Line']], L.emit, 'data-lsel="emit"')) +
      fieldRow('Seed', `<input type="number" data-lfn="seed" value="${L.seed}">`));
    h += sec('Particle motion', numRow(L, 'life', 'Life (s)', { step: 0.05, min: 0.05 }) + numRow(L, 'speed', 'Speed') + numRow(L, 'speedVar', 'Speed random', { step: 0.05, min: 0, max: 1 }) + numRow(L, 'angle', 'Direction', { unit: '°' }) + numRow(L, 'spread', 'Spread', { unit: '°' }) +
      numRow(L, 'gravity', 'Gravity') + numRow(L, 'wind', 'Wind') + numRow(L, 'drag', 'Drag', { step: 0.05, min: 0 }) + numRow(L, 'spin', 'Spin') + numRow(L, 'emitR', 'Emitter size', { min: 0 }));
    h += sec('Over life', numRow(L, 'size0', 'Size start', { min: 0 }) + numRow(L, 'size1', 'Size end', { min: 0 }) + numRow(L, 'alpha0', 'Opacity start', { step: 0.01, min: 0, max: 1 }) + numRow(L, 'alpha1', 'Opacity end', { step: 0.01, min: 0, max: 1 }) + colorRow(L, 'color0', 'Color start') + colorRow(L, 'color1', 'Color end'));
  }
  // effects stack
  let fx = '';
  L.fx.forEach((e, i) => {
    const def = FX[e.type]; let rows = '';
    for (const [k, d] of Object.entries(def.params)) {
      const path = 'fx:' + e.id + ':' + k;
      if (typeof d[0] === 'string') rows += colorRow(L, path, k);
      else if (typeof d[0] === 'boolean') rows += `<div class="prow" data-label="${k}"><span class="pl nodrag">${k}</span><span class="pv"><input type="checkbox" data-fxb="${e.id}:${k}" ${e.p[k] ? 'checked' : ''}></span><span></span></div>`;
      else rows += numRow(L, path, k, { step: d[3], min: d[1], max: d[2] });
    }
    fx += `<div class="fxitem ${e.on ? '' : 'off'}"><div class="fxh"><input type="checkbox" data-fxon="${e.id}" ${e.on ? 'checked' : ''} title="Enable / bypass"><b>${i + 1}. ${esc(def.label)}</b>
      <button class="ib sm" data-fxmv="${e.id}:-1" title="Move up (earlier)">▲</button><button class="ib sm" data-fxmv="${e.id}:1" title="Move down (later)">▼</button><button class="ib sm" data-fxrm="${e.id}" title="Remove">✕</button></div>
      <div class="body" style="padding:5px 6px;display:grid;grid-template-columns:86px 1fr 22px;gap:4px 6px">${rows}</div></div>`;
  });
  h += sec('✨ Effects stack', `${fx || '<div class="note">No effects. Effects run top to bottom; order changes the result.</div>'}
    <div class="btnrow"><select id="fxAdd"><option value="">＋ Add effect…</option>${Object.entries(FX).map(([k, d]) => `<option value="${k}">${d.label}</option>`).join('')}</select>
    ${L.fx.length ? '<button class="btn" data-cmd="fx.savepreset">Save stack as preset</button>' : ''}${(S.doc.fxPresets || []).length ? '<button class="btn" data-cmd="fx.applypreset">Apply preset…</button>' : ''}</div>`, '', true);
  return h;
}
function boneTree(B) {
  const use = (id) => { let n = 0; walk(B.children, (A) => { if (A.bindBone === id) n++; if (A.pts) for (const p of Object.values(A.pts)) if (p.b && p.b.some((q) => q[0] === id)) { n++; } }); return n; };
  const sel = new Set(selectedBoneIds());
  const rec = (pid, d) => B.bones.filter((b) => (b.parent || null) === pid).map((b) => `<div class="bn ${sel.has(b.id) ? 'on' : ''}" data-bone="${b.id}" style="padding-left:${4 + d * 14}px">🦴 ${esc(b.name)}${b.dyn && b.dyn.on ? ' 〰' : ''}${b.vg ? ` <span style="color:var(--acc2)">[${esc(b.vg)}]</span>` : ''}<i>${use(b.id) ? use(b.id) + ' bound' : ''}${b.str ? ` · str ${b.str}` : ''}</i></div>` + rec(b.id, d + 1)).join('');
  return rec(null, 0) || '<div class="note">No bones yet.</div>';
}
function multiRow(ls, path, label, step = 1) {
  const vs = ls.map((l) => val(l, path, S.frame)), same = vs.every((v) => Math.abs(v - vs[0]) < 1e-9);
  return `<div class="prow" data-label="${esc(label.toLowerCase())}"><span class="pl nodrag">${esc(label)}</span><span class="pv"><input type="number" step="${step}" class="${same ? '' : 'mixed'}" data-multi="${path}" value="${same ? round(vs[0], 3) : ''}" placeholder="${same ? '' : 'Mixed'}"></span><span></span></div>`;
}
function boneDescends(B, id, ancestorId) { let b = B.bones.find((x) => x.id === id); while (b && b.parent) { if (b.parent === ancestorId) return true; b = B.bones.find((x) => x.id === b.parent); } return false; }

function bindProps(el) {
  const L = selLayer();
  // numeric fields
  el.querySelectorAll('input[data-path]').forEach((inp) => {
    const o = getOwner(inp.dataset.owner), path = inp.dataset.path, comp = inp.dataset.comp, sc = +inp.dataset.scale || 1;
    const apply = (v) => { if (comp !== '') { const cur = val(o, path, S.frame).slice(); cur[+comp] = v; setVal(o, path, cur); } else setVal(o, path, v); };
    if (inp.type === 'color') {
      inp.oninput = () => { if (!H.pending) beginEdit('Change color'); apply(inp.value); requestDraw(); };
      inp.onchange = () => commitEdit();
    } else inp.onchange = () => { let v = +inp.value / sc; if (inp.min !== '') v = Math.max(+inp.min, v); if (inp.max !== '') v = Math.min(+inp.max, v); edit('Set ' + path, () => apply(v)); };
  });
  // drag-scrub labels
  el.querySelectorAll('[data-scrub]').forEach((lab) => {
    lab.onpointerdown = (e) => {
      const o = getOwner(lab.dataset.owner), path = lab.dataset.scrub, comp = lab.dataset.comp, step = +lab.dataset.step || 1;
      const mn = lab.dataset.min === '' ? -Infinity : +lab.dataset.min, mx = lab.dataset.max === '' ? Infinity : +lab.dataset.max;
      let v0 = val(o, path, S.frame); if (comp !== '') v0 = v0[+comp];
      const x0 = e.clientX; lab.setPointerCapture(e.pointerId); beginEdit('Adjust ' + path);
      lab.onpointermove = (ev) => {
        let v = clamp(v0 + (ev.clientX - x0) * step * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1), mn, mx); v = round(v, 3);
        if (comp !== '') { const cur = val(o, path, S.frame).slice(); cur[+comp] = v; setVal(o, path, cur); } else setVal(o, path, v);
        const inp = lab.parentElement.querySelector(`input[data-path="${CSS.escape(path)}"]${comp !== '' ? `[data-comp="${comp}"]` : ''}`); if (inp) inp.value = v;
        requestDraw();
      };
      lab.onpointerup = () => { lab.onpointermove = null; commitEdit(); };
    };
  });
  // key buttons
  el.querySelectorAll('[data-key]').forEach((b) => (b.onclick = () => {
    const o = getOwner(b.dataset.owner), path = b.dataset.key, f = S.frame;
    edit('Toggle key', () => {
      const k = keyAt(o, path, f);
      if (actActive()&&!actOwnsLayer(o))throw Error('Select a layer inside the active Action');
      if (k) { const ch = o.ch[path]; ch.keys = ch.keys.filter((x) => x !== k); if (!ch.keys.length || (!actActive() && ch.keys.length === 1)) { if (ch.keys.length) baseSet(o, path, ch.keys[0].v); delete o.ch[path]; } }
      else { const v = val(o, path, f); if (!o.ch[path]) { o.ch[path] = { keys: [] }; if (f !== 0) setKey(o.ch[path], 0, baseGet(o, path), DISCRETE(path) ? 'step' : undefined); } setKey(o.ch[path], f, v, DISCRETE(path) ? 'step' : undefined); }
    });
  }));
  // document fields
  el.querySelectorAll('[data-doc]').forEach((i) => (i.onchange = () => edit('Project settings', () => { const k = i.dataset.doc; S.doc[k] = i.type === 'number' ? Math.max(1, +i.value | 0) : i.value; if (k === 'name') updateTitle(); })));
  if (!L) return bindCommon(el);
  el.querySelectorAll('[data-multi]').forEach((i) => (i.onchange = () => { if (i.value === '') return; const v = +i.value, ls = S.selLayers.map((id) => findLayer(id)).filter((l) => l && l.type !== 'audio'); edit(`Set ${i.dataset.multi} on ${ls.length} layers`, () => ls.forEach((l) => setVal(l, i.dataset.multi, v))); }));
  el.querySelectorAll('[data-piv]').forEach((i) => (i.onchange = () => edit('Move pivot', () => (L.p[i.dataset.piv] = +i.value))));
  el.querySelectorAll('[data-bone]').forEach((i) => (i.onclick = (e) => selectBone(i.dataset.bone, e.shiftKey)));
  el.querySelectorAll('[data-ctx2="poseparent"]').forEach((i) => (i.onclick = () => setTool('bonemanip')));
  el.querySelectorAll('[data-lf]').forEach((i) => (i.onchange = () => edit('Edit ' + i.dataset.lf, () => (L[i.dataset.lf] = i.value))));
  el.querySelectorAll('[data-lfn]').forEach((i) => (i.onchange = () => edit('Edit ' + i.dataset.lfn, () => (L[i.dataset.lfn] = +i.value))));
  el.querySelectorAll('[data-lchk]').forEach((i) => (i.onchange = () => edit('Toggle ' + i.dataset.lchk, () => (L[i.dataset.lchk] = i.checked))));
  el.querySelectorAll('[data-lsel]').forEach((i) => (i.onchange = () => edit('Set ' + i.dataset.lsel, () => {
    const k = i.dataset.lsel;
    if (k === 'preset') { if (i.value) applyParticlePreset(L, i.value); else L.preset = ''; }
    else if (k === 'bindBone') { L.bindBone = i.value || null; if (S.frame !== 0) toast('Tip: bind at frame 0 so the rest pose matches', 'err'); }
    else L[k] = i.value;
  })));
  el.querySelectorAll('[data-curv]').forEach((i) => (i.onchange = () => edit('Curvature', () => (L.pts[i.dataset.curv].c = clamp(+i.value, 0, 2.5)))));
  // bones
  const b = L.bones && L.bones.find((x) => x.id === S.selBone);
  if (b) {
    el.querySelectorAll('[data-bf]').forEach((i) => (i.onchange = () => edit('Bone ' + i.dataset.bf, () => (b[i.dataset.bf] = i.value))));
    el.querySelectorAll('[data-bdyn]').forEach((i) => (i.onchange = () => edit('Bone physics', () => { b.dyn = { spring: 60, damp: 11, inertia: 0.6, ...(b.dyn || {}) }; b.dyn[i.dataset.bdyn] = i.type === 'checkbox' ? i.checked : +i.value; })));
    el.querySelectorAll('[data-bfn]').forEach((i) => (i.onchange = () => edit('Bone ' + i.dataset.bfn, () => { if (i.value === '') delete b[i.dataset.bfn]; else b[i.dataset.bfn] = +i.value; })));
    el.querySelectorAll('[data-bchk]').forEach((i) => (i.onchange = () => edit('Bone IK', () => (b[i.dataset.bchk] = i.checked))));
    el.querySelectorAll('[data-bsel]').forEach((i) => (i.onchange = () => edit('Reparent bone', () => reparentBone(L, b, i.value || null))));
  }
  // effects
  el.querySelectorAll('[data-fxon]').forEach((i) => (i.onchange = () => edit('Toggle effect', () => { const e = L.fx.find((x) => x.id === i.dataset.fxon); e.on = i.checked; })));
  el.querySelectorAll('[data-fxb]').forEach((i) => (i.onchange = () => edit('Effect option', () => { const [id, k] = i.dataset.fxb.split(':'); L.fx.find((x) => x.id === id).p[k] = i.checked; })));
  el.querySelectorAll('[data-fxrm]').forEach((i) => (i.onclick = () => edit('Remove effect', () => { const id = i.dataset.fxrm; L.fx = L.fx.filter((x) => x.id !== id); deleteChannelsMatching(L, (k) => k.startsWith('fx:' + id + ':')); })));
  el.querySelectorAll('[data-fxmv]').forEach((i) => (i.onclick = () => edit('Reorder effect', () => { const [id, d] = i.dataset.fxmv.split(':'); const a = L.fx.findIndex((x) => x.id === id), t = a + +d; if (t < 0 || t >= L.fx.length) return; const [e] = L.fx.splice(a, 1); L.fx.splice(t, 0, e); })));
  const fa = $('#fxAdd'); if (fa) fa.onchange = () => { if (fa.value) addEffect(L, fa.value); };
  bindCommon(el);
}
function bindCommon(el) {
  el.querySelectorAll('[data-cmd]').forEach((b) => (b.onclick = () => runCmd(b.dataset.cmd)));
  el.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
}
function addEffect(L, type, params = {}) {
  let e;
  edit('Add effect: ' + FX[type].label, () => { e = { id: uid('fx'), type, on: true, p: { ...fxDefaults(type), ...params } }; L.fx.push(e); });
  return e;
}

// ---------- style panel ----------
function renderStyle() {
  const el = $('#tabBody'), ns = S.newStyle, L = selLayer();
  const sh = L && L.type === 'vector' && L.shapes.find((s) => s.id === S.selShape);
  let h = sec('New shape defaults', fieldRow('Fill', `<input type="checkbox" data-ns="fillOn" ${ns.fillOn ? 'checked' : ''}><input type="color" data-ns="fill" value="${ns.fill}">`) +
    fieldRow('Stroke', `<input type="checkbox" data-ns="strokeOn" ${ns.strokeOn ? 'checked' : ''}><input type="color" data-ns="stroke" value="${ns.stroke}">`) +
    fieldRow('Line width', `<input type="number" data-ns="width" value="${ns.width}" min="0" step="0.5">`) +
    `<div class="note" style="grid-column:1/-1">These apply to <b>new</b> shapes you draw. They never change existing artwork.</div>`);
  if (sh) {
    const st = shapeStyle(L, sh, S.frame), linked = sh.styleId && S.doc.styles.find((s) => s.id === sh.styleId);
    h += sec('Selected shape', (linked ? `<div class="note" style="grid-column:1/-1">Appearance comes from shared style <b>${esc(linked.name)}</b>. Unlink to edit or animate it here.</div>` :
      fieldRow('Fill on', `<input type="checkbox" data-shc="fillOn" ${sh.fillOn ? 'checked' : ''}>`) + colorRow(L, 'sh:' + sh.id + ':fill', 'Fill color') +
      fieldRow('Stroke on', `<input type="checkbox" data-shc="strokeOn" ${sh.strokeOn ? 'checked' : ''}>`) + colorRow(L, 'sh:' + sh.id + ':stroke', 'Stroke color') + numRow(L, 'sh:' + sh.id + ':width', 'Line width', { step: 0.5, min: 0 })) +
      fieldRow('Shared style', sel_('styleId', [['', '— none (own style) —'], ...S.doc.styles.map((s) => [s.id, s.name])], sh.styleId || '', 'data-shstyle="1"')) +
      `<div class="btnrow" style="grid-column:1/-1"><button class="btn" data-cmd="shape.up">Raise</button><button class="btn" data-cmd="shape.down">Lower</button><button class="btn" data-cmd="shape.defaults">Apply defaults</button><button class="btn" data-cmd="style.fromshape">New shared style from shape</button><button class="btn danger" data-cmd="shape.del">Delete shape</button></div>`);
    void st;
  } else h += sec('Selected shape', `<div class="note">Select a shape with the <b>Select</b> tool (click it) or the <b>Points</b> tool to edit its fill and stroke.</div>`, '', true);
  let stl = S.doc.styles.map((s) => `<div class="fxitem"><div class="fxh"><span class="sw" style="background:${s.fill}"></span><span class="sw" style="background:${s.stroke}"></span>
     <input type="text" data-st="${s.id}:name" value="${esc(s.name)}" style="flex:1"><button class="ib sm" data-strm="${s.id}" title="Delete style">✕</button></div>
     <div class="body" style="display:grid;grid-template-columns:86px 1fr 22px;gap:4px 6px;padding:5px 6px">
     ${fieldRow('Fill', `<input type="checkbox" data-st="${s.id}:fillOn" ${s.fillOn ? 'checked' : ''}><input type="color" data-st="${s.id}:fill" value="${s.fill}">`)}
     ${fieldRow('Stroke', `<input type="checkbox" data-st="${s.id}:strokeOn" ${s.strokeOn ? 'checked' : ''}><input type="color" data-st="${s.id}:stroke" value="${s.stroke}">`)}
     ${fieldRow('Width', `<input type="number" data-st="${s.id}:width" value="${s.width}" min="0" step="0.5">`)}
     <div class="note" style="grid-column:1/-1">Used by ${allLayers().filter((l) => l.shapes).reduce((n, l) => n + l.shapes.filter((x) => x.styleId === s.id).length, 0)} shapes</div></div></div>`).join('');
  h += sec('Shared styles', (stl || '<div class="note">Shared styles (e.g. Skin, Jacket, Outline) update every linked shape at once.</div>') + `<div class="btnrow"><button class="btn" data-cmd="style.new">＋ New style from defaults</button></div>`, '', true);
  h += sec('Document palette', `<div class="swatches">${S.doc.palette.map((c, i) => `<span class="sw" style="background:${c}" data-pal="${i}" title="${c} — click: fill · Shift: stroke · right-click: remove"></span>`).join('')}<button class="ib sm" data-cmd="pal.add" title="Add current fill color">＋</button></div>
    <div class="btnrow"><button class="btn" data-cmd="pal.export">Export .gpl</button><button class="btn" data-cmd="pal.import">Import .gpl</button></div>`, '', true);
  el.innerHTML = h;
  el.querySelectorAll('[data-ns]').forEach((i) => (i.oninput = () => { const k = i.dataset.ns; ns[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value; renderToolOpts(); }));
  if (sh) {
    el.querySelectorAll('[data-shc]').forEach((i) => (i.onchange = () => edit('Shape ' + i.dataset.shc, () => (sh[i.dataset.shc] = i.checked))));
    const ss = el.querySelector('[data-shstyle]'); if (ss) ss.onchange = () => edit('Link style', () => {
      if (!ss.value && sh.styleId) { const s = S.doc.styles.find((x) => x.id === sh.styleId); if (s) Object.assign(sh, { fill: s.fill, stroke: s.stroke, width: s.width, fillOn: s.fillOn, strokeOn: s.strokeOn }); }
      sh.styleId = ss.value || null;
    });
  }
  el.querySelectorAll('[data-st]').forEach((i) => {
    const [id, k] = i.dataset.st.split(':'), s = S.doc.styles.find((x) => x.id === id);
    if (i.type === 'color') { i.oninput = () => { if (!H.pending) beginEdit('Edit style'); s[k] = i.value; requestDraw(); }; i.onchange = () => commitEdit(); }
    else i.onchange = () => edit('Edit style', () => (s[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value));
  });
  el.querySelectorAll('[data-strm]').forEach((i) => (i.onclick = () => edit('Delete style', () => {
    const s = S.doc.styles.find((x) => x.id === i.dataset.strm);
    for (const l of allLayers()) if (l.shapes) for (const x of l.shapes) if (x.styleId === s.id) Object.assign(x, { fill: s.fill, stroke: s.stroke, width: s.width, fillOn: s.fillOn, strokeOn: s.strokeOn, styleId: null });
    S.doc.styles = S.doc.styles.filter((x) => x !== s);
  })));
  el.querySelectorAll('[data-pal]').forEach((i) => {
    i.onclick = (e) => { const c = S.doc.palette[+i.dataset.pal]; if (e.shiftKey) ns.stroke = c; else ns.fill = c; if (sh && !sh.styleId) edit('Apply palette color', () => setVal(L, 'sh:' + sh.id + (e.shiftKey ? ':stroke' : ':fill'), c)); else { renderToolOpts(); refreshAll(); } };
    i.oncontextmenu = (e) => { e.preventDefault(); edit('Remove swatch', () => S.doc.palette.splice(+i.dataset.pal, 1)); };
  });
  bindCommon(el);
}

// ---------- switch panel ----------
function switchTarget() { const L = selLayer(); if (!L) return null; if (L.type === 'switch') return L; const P = parentOf(L.id); return P && P.type === 'switch' ? P : null; }
function renderSwitch() {
  const el = $('#tabBody'), SW = switchTarget();
  if (!SW) { el.innerHTML = sec('Switch Groups', `<div class="note">A <b>Switch Group</b> holds alternatives — mouths, hands, eyes, costumes, whole sub-groups — and renders one at a time. Keys store each alternative's permanent ID, so renaming “MBP” to “Closed lips” never breaks animation.<br><br>Select a Switch Group (or one of its alternatives) to manage it here.</div><div class="btnrow"><button class="btn pri" data-cmd="switch.mouthkit">Create starter mouth set</button><button class="btn" data-cmd="layer.newswitch">New empty Switch Group</button></div>`, '', true); bindCommon(el); return; }
  const st = switchState(SW, S.frame), shown = swShown(SW), sel = selLayer();
  const act = SW.children.find((c) => c.id === st.cur), prev = S.swPreview[SW.id] && SW.children.find((c) => c.id === S.swPreview[SW.id]);
  el.innerHTML = sec('⇄ ' + esc(SW.name), `<div class="note" style="margin-top:0">Active at frame ${S.frame}: <b>${esc(act ? act.name : '—')}</b>${prev ? ` · previewing <b style="color:#4dabf7">${esc(prev.name)}</b> (not keyed) <a href="#" id="swClr" style="color:var(--acc)">clear</a>` : ''}</div>
    <div class="note"><b>Click</b> a card to preview it · <b>Set active</b> keys it at the playhead · <b>Edit</b> selects that drawing so you can change it (no key is added).</div>
    <div class="swgrid">${SW.children.map((c, i) => `<div class="swcard ${c.id === st.cur ? 'on' : ''} ${prev && c.id === prev.id ? 'prev' : ''}" data-swprev="${c.id}" title="Preview ${esc(c.name)}"><canvas width="140" height="104" data-th="${c.id}"></canvas><span>${i < 9 ? `<kbd>${i + 1}</kbd> ` : ''}${esc(c.name)}${c.id === st.cur ? ' ●' : ''}${sel === c ? ' ✎' : ''}</span>
      <div class="acts"><button class="btn" data-swset="${c.id}" title="Key as active at frame ${S.frame}">Set active</button><button class="btn" data-swedit="${c.id}" title="Select to edit (no key)">Edit</button></div></div>`).join('') || '<div class="note">No alternatives yet.</div>'}</div>
    <div class="btnrow" style="margin-top:8px"><button class="btn" data-cmd="switch.addchild">＋ Alternative</button><button class="btn" data-cmd="switch.align">Align on registration point</button><label class="note" style="margin:0 4px"><input type="checkbox" id="swOv" ${S.alignOverlay ? 'checked' : ''}> overlay</label></div>
    <div class="btnrow"><button class="btn pri" data-cmd="ai.lipsync">✦ Lip sync…</button><button class="btn" data-cmd="switch.exportdat">Export Moho .dat</button><button class="btn" data-cmd="switch.importdat">Import .dat</button></div>
    <div class="note">Number keys 1–9 set the matching alternative active at the playhead while this panel is open.</div>`, '', true);
  el.querySelectorAll('[data-swprev]').forEach((c) => (c.onclick = (e) => { if (e.target.closest('button')) return; S.swPreview[SW.id] = c.dataset.swprev; refreshAll(); }));
  el.querySelectorAll('[data-swset]').forEach((b) => (b.onclick = () => swSetActive(SW, b.dataset.swset)));
  el.querySelectorAll('[data-swedit]').forEach((b) => (b.onclick = () => { S.selLayers = [b.dataset.swedit]; S.camSel = false; delete S.swPreview[SW.id]; refreshAll(); }));
  const clr = $('#swClr'); if (clr) clr.onclick = (e) => { e.preventDefault(); delete S.swPreview[SW.id]; refreshAll(); };
  const ov = $('#swOv'); if (ov) ov.onchange = () => { S.alignOverlay = ov.checked; refreshAll(); };
  el.querySelectorAll('canvas[data-th]').forEach((cv) => drawThumb(cv, cv.dataset.th));
  bindCommon(el);
}
function drawThumb(cv, id) {
  const L = findLayer(id); if (!L) return;
  const x = cv.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, cv.width, cv.height);
  // fit the drawing: measure via stage-independent bbox
  const lc = evalLC(L, S.frame); let pts = [];
  const gather = (A, m) => { if (A.type === 'vector') { const P = deformedPts(A, S.frame, null); for (const k in P) pts.push(M.ap(m, P[k][0], P[k][1])); } if (A.children) A.children.forEach((c) => gather(c, M.mul(m, layerLocalM(c, S.frame)))); };
  gather(L, lc.world);
  if (!pts.length) return;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min((cv.width - 12) / Math.max(1, x1 - x0), (cv.height - 12) / Math.max(1, y1 - y0));
  const view = M.chain(M.t(cv.width / 2, cv.height / 2), M.s(s), M.t(-(x0 + x1) / 2, -(y0 + y1) / 2));
  const R = { f: S.frame, view, cam: () => M.I(), rec: null, export: false, W: cv.width, H: cv.height, only: null, onlyAnc: null, noTrail: true };
  const pc = { base: M.mul(lc.base, M.I()), rel: lc.relParent, z: 0, B: lc.B, inOnly: false };
  try { drawLayer(x, Object.assign({}, L, { vis: true }), R, pc); } catch (e) { console.warn(e); }
}
document.addEventListener('keydown', (e) => {
  if (currentTab !== 'switch' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const n = +e.key; if (!(n >= 1 && n <= 9)) return;
  const SW = switchTarget(); if (!SW || !SW.children[n - 1]) return;
  e.preventDefault(); e.stopImmediatePropagation(); swSetActive(SW, SW.children[n - 1].id);
}, true);

function renderSide() {
  if (document.activeElement && $('#tabBody').contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.id !== 'inspSearch') return;
  const st = $('#tabBody').scrollTop;
  if (currentTab === 'props') renderProps();
  else if (currentTab === 'style') renderStyle();
  else if (currentTab === 'switch') renderSwitch();
  else if (currentTab === 'ai') renderAI();
  else if (currentTab === 'jobs') renderJobs();
  $('#tabBody').scrollTop = st;
}
function initSide() {
  $$('#sideTabs button').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $('#tabBody').addEventListener('focusout', () => setTimeout(() => { if (!$('#tabBody').contains(document.activeElement)) { _panelsDirty = true; requestDraw(); } }, 0));
}
