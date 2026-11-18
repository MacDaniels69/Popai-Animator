/* ===================== Popai Animator — Style window (Moho model) =====================
   Three editing modes: DEFAULTS (new shapes), SHAPE (the selected shape) and STYLE (a named, shared definition).
   A named style supplies only the properties it defines. A shape can apply two styles (Style 1, Style 2; Style 2 wins
   where both define a property) and can override any supplied property with its own value. Resolution lives in
   shapeStyle (render.js). Window ▸ Style or Ctrl+]. The Eyedropper (Fill tools) picks or pushes appearance. */

const STYLE_LABELS = { fill: 'Fill color', stroke: 'Stroke color', width: 'Line width', fillOn: 'Fill on', strokeOn: 'Stroke on' };
const STY = { mode: '', advanced: false, editing: '', palette: 'basic', clipboard: null };
// The side panel's section body is a grid; panel content spans all of its columns.
const fullRow = (h) => `<div style="grid-column:1/-1;min-width:0">${h}</div>`;
function styleById(id) { return id ? S.doc.styles.find((s) => s.id === id) || null : null; }
function styleUsers(s) { let n = 0; for (const l of allLayers()) if (l.shapes) for (const x of l.shapes) if (x.styleId === s.id || x.style2Id === s.id) n++; return n; }
// Which applied style (if any) supplies a property for this shape, ignoring the shape's own override.
function styleSource(sh, p) { const s2 = styleById(sh.style2Id), s1 = styleById(sh.styleId); return styleDefines(s2, p) ? s2 : styleDefines(s1, p) ? s1 : null; }
function selectedShape() { const L = selLayer(); const sh = L && L.type === 'vector' && L.shapes.find((s) => s.id === S.selShape); return sh ? { L, sh } : null; }
// SHAPE mode edits are the shape's own (animatable) values. Changing a property a style supplies turns on its override,
// as Moho does, so the edit is visible and the rest of the style keeps applying.
function styleSetShape(L, sh, p, v) {
  if (styleSource(sh, p)) sh.over = { ...(sh.over || {}), [p]: true };
  if (p === 'fillOn' || p === 'strokeOn') sh[p] = !!v;
  else setVal(L, 'sh:' + sh.id + ':' + p, p === 'width' ? clamp(+v, 0, 10000) : v);
}
function styleNew(from) {
  const n = S.doc.styles.length + 1, s = { id: uid('st'), name: 'Style ' + n, fill: S.newStyle.fill, stroke: S.newStyle.stroke, width: S.newStyle.width, fillOn: S.newStyle.fillOn, strokeOn: S.newStyle.strokeOn, defines: { fill: false, stroke: false, width: false, fillOn: false, strokeOn: false } };
  if (from) { const st = shapeStyle(from.L, from.sh, S.frame); Object.assign(s, { name: 'Style from shape ' + n, fill: st.fill, stroke: st.stroke, width: st.width, fillOn: st.fillOn, strokeOn: st.strokeOn, defines: { fill: true, stroke: true, width: true, fillOn: true, strokeOn: true } }); }
  S.doc.styles.push(s); STY.editing = s.id; STY.mode = 'style'; return s;
}
function styleDelete(s) {
  // Shapes keep their current look: the style's supplied values become their own.
  for (const l of allLayers()) if (l.shapes) for (const x of l.shapes) {
    for (const slot of ['styleId', 'style2Id']) if (x[slot] === s.id) {
      for (const p of STYLE_PROPS) if (styleDefines(s, p) && !(x.over && x.over[p]) && styleSource(x, p) === s) { if (p === 'fillOn' || p === 'strokeOn') x[p] = s[p]; else baseSet(l, 'sh:' + x.id + ':' + p, s[p]); }
      x[slot] = null;
    }
  }
  S.doc.styles = S.doc.styles.filter((x) => x !== s); if (STY.editing === s.id) STY.editing = '';
}
function styleControls(prefix, get, opts = {}) {
  const define = p => opts.defines ? `<input type="checkbox" title="${esc(opts.defines.title)}" aria-label="Override ${STYLE_LABELS[p]}" data-${prefix}def="${p}" ${opts.defines.get(p) ? 'checked' : ''}>` : '<span class="sty-define-spacer"></span>';
  const colorRow = (p,label) => `<div class="sty-color-row"><label><input type="checkbox" data-${prefix}="${p}On" ${get(p+'On') ? 'checked' : ''}>${label}</label><input aria-label="${label} color" type="color" data-${prefix}="${p}" value="${esc(get(p))}"><button class="ib" data-tool="eyedropper" title="Eyedropper: pick appearance from artwork" aria-label="Eyedropper">${TOOLS.eyedropper.icon}</button>${define(p)}${opts.note ? opts.note(p) : ''}</div>`;
  return colorRow('fill','Fill')+colorRow('stroke','Stroke')+`<div class="sty-color-row sty-width"><label>Width</label><input aria-label="Stroke width" type="number" data-${prefix}="width" value="${round(+get('width'),3)}" min="0" max="10000" step="0.5"><span>px</span>${define('width')}</div>`+(opts.defines ? `<div class="sty-overrides">${define('fillOn')}<span>Fill enabled</span>${define('strokeOn')}<span>Stroke enabled</span></div>` : '');
}
function styleBasicColors() {
  const colors=[];
  for(let y=0;y<10;y++)for(let x=0;x<16;x++){
    const hue=x/16,light=y===0?1-x/15:(y<6?0.9-(y-1)*0.14:0.18+(y-6)*0.18),sat=y===0?0:1;
    const q=light<0.5?light*(1+sat):light+sat-light*sat,p=2*light-q;
    const component=t=>{t=(t+1)%1;return t<1/6?p+(q-p)*6*t:t<0.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};
    colors.push('#'+[component(hue+1/3),component(hue),component(hue-1/3)].map(c=>Math.round(c*255).toString(16).padStart(2,'0')).join(''));
  }
  return colors;
}
renderStyle = function () {
  const el = $('#tabBody'), ns = S.newStyle, picked = selectedShape();
  if (!STY.mode) STY.mode = picked ? 'shape' : 'defaults';
  if (STY.mode === 'shape' && !picked && STY._auto) STY.mode = 'defaults';
  const editing = styleById(STY.editing) || S.doc.styles[0] || null; if (editing) STY.editing = editing.id;
  let h = '<div class="sty-top"><select data-stymode-select aria-label="Shapes"><option value="defaults" '+(STY.mode==='defaults'?'selected':'')+'>Defaults</option><option value="shape" '+(STY.mode==='shape'?'selected':'')+'>Shapes</option></select><select data-stychoose aria-label="Styles"><option value="">Styles</option>'+S.doc.styles.map(s=>'<option value="'+s.id+'" '+(STY.mode==='style'&&editing?.id===s.id?'selected':'')+'>'+esc(s.name)+'</option>').join('')+'<option value="__new">New style…</option></select></div>';
  const styleOpts = (cur) => `<option value="">— none —</option>` + S.doc.styles.map((s) => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  if (STY.mode === 'defaults') {
    h += sec('DEFAULTS — for new shapes', fullRow(styleControls('stdef', (p) => ns[p]) +
      (true ? `<div class="sty-row"><span></span><span class="sty-label">Style 1</span><select data-stdefslot="styleId">${styleOpts(ns.styleId)}</select></div><div class="sty-row"><span></span><span class="sty-label">Style 2</span><select data-stdefslot="style2Id">${styleOpts(ns.style2Id)}</select></div>` : '') +
      ''));
  } else if (STY.mode === 'shape') {
    if (!picked) h += sec('SHAPE', fullRow('<div class="note">Select a shape with Select Shape (Q) to edit its appearance.</div>'));
    else {
      const { L, sh } = picked, st = shapeStyle(L, sh, S.frame);
      const note = (p) => { const src = styleSource(sh, p); return src && !(sh.over && sh.over[p]) ? ` <span class="sty-from" title="Supplied by this style">· ${esc(src.name)}</span>` : sh.over && sh.over[p] ? ' <span class="sty-from">· own value</span>' : ''; };
      h += sec('SHAPE — selected shape', fullRow(styleControls('stshape', (p) => st[p], { note, defines: STY.advanced ? { title: 'Override: use this shape\'s own value instead of the applied style', get: (p) => !!(sh.over && sh.over[p]) } : null }) +
        (true ? `<div class="sty-row"><span></span><span class="sty-label">Style 1</span><select data-stslot="styleId">${styleOpts(sh.styleId)}</select></div><div class="sty-row"><span></span><span class="sty-label">Style 2</span><select data-stslot="style2Id">${styleOpts(sh.style2Id)}</select></div><div class="note">Ticked boxes are local overrides. Style 2 wins where both styles define a property.</div>` : (sh.styleId || sh.style2Id ? `<div class="note">Uses ${esc([styleById(sh.styleId), styleById(sh.style2Id)].filter(Boolean).map((s) => s.name).join(' + '))}. Enable Advanced to change styles or overrides.</div>` : '')) +
        `<div class="btnrow"><button class="btn" data-cmd="shape.up">Raise</button><button class="btn" data-cmd="shape.down">Lower</button><button class="btn" data-styact="fromshape">New style from shape</button><button class="btn danger" data-cmd="shape.del">Delete shape</button></div>`));
    }
  } else {
    const menu = `<div class="btnrow"><select data-styedit aria-label="Style to edit">${S.doc.styles.map((s) => `<option value="${s.id}" ${editing && s.id === editing.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('') || '<option value="">— no styles yet —</option>'}</select>
      <button class="btn" data-styact="new">New</button><button class="btn" data-styact="fromshape" ${picked ? '' : 'disabled title="Select a shape first"'}>New from shape</button>${editing ? '<button class="btn" data-styact="rename">Rename</button><button class="btn danger" data-styact="delete">Delete</button>' : ''}</div>`;
    h += sec('STYLE — named, shared definition', fullRow(menu + (editing ? styleControls('ststyle', (p) => editing[p], { defines: { title: 'This style defines (supplies) the property', get: (p) => styleDefines(editing, p) } }) +
      `<div class="note">Ticked properties are supplied by <b>${esc(editing.name)}</b>; unticked ones stay under each shape's control. Used by ${styleUsers(editing)} shape(s) on any layer.</div>` +
      (picked ? `<div class="btnrow"><button class="btn" data-styapply="styleId">Apply as Style 1</button><button class="btn" data-styapply="style2Id">Apply as Style 2</button></div>` : '') : '<div class="note">Create a style with New, or New from shape.</div>')));
  }
  const palette = STY.palette === 'document' ? S.doc.palette : styleBasicColors();
  h += '<div class="sty-palette-label"><label>Swatches</label><select data-stypalette aria-label="Swatches"><option value="basic" '+(STY.palette==='basic'?'selected':'')+'>Basic Colors</option><option value="document" '+(STY.palette==='document'?'selected':'')+'>Document</option></select><button class="ib" data-stypalmenu title="Palette commands" aria-label="Palette commands">⋯</button></div><div class="sty-color-grid">'+palette.map(c=>'<button class="sty-swatch" data-stycolor="'+c+'" style="background:'+c+'" title="'+c+' · Shift: stroke" aria-label="Color '+c+'"></button>').join('')+'</div><div class="sty-clipboard"><button class="btn" data-styclip="copy">Copy</button><button class="btn" data-styclip="paste" '+(STY.clipboard?'':'disabled')+'>Paste</button><button class="btn" data-styclip="reset">Reset</button></div><label class="sty-advanced"><input type="checkbox" data-styadv '+(STY.advanced?'checked':'')+'> Advanced</label>';
  el.innerHTML = '<div class="style-reference">'+h+'</div>';
  const modeSelect=el.querySelector('[data-stymode-select]');if(modeSelect)modeSelect.onchange=()=>{STY.mode=modeSelect.value;STY._auto=false;renderStyle();};
  const styleSelect=el.querySelector('[data-stychoose]');if(styleSelect)styleSelect.onchange=()=>{if(styleSelect.value==='__new'){edit('New style',()=>styleNew(picked));}else if(styleSelect.value){STY.editing=styleSelect.value;STY.mode='style';STY._auto=false;}renderStyle();};
  const paletteSelect=el.querySelector('[data-stypalette]');if(paletteSelect)paletteSelect.onchange=()=>{STY.palette=paletteSelect.value;renderStyle();};
  const palMenu=el.querySelector('[data-stypalmenu]');if(palMenu)palMenu.onclick=()=>{const r=palMenu.getBoundingClientRect();showMenu(r.left,r.bottom,[{label:'Add current fill',run:()=>runCmd('pal.add')},{label:'Import palette…',run:()=>runCmd('pal.import')},{label:'Export palette…',run:()=>runCmd('pal.export')}]);};
  function applyAppearance(values){
    if(STY.mode==='shape'&&picked)edit('Shape appearance',()=>{for(const p of STYLE_PROPS)if(p in values)styleSetShape(picked.L,picked.sh,p,values[p]);});
    else if(STY.mode==='style'&&editing)edit('Style appearance',()=>{for(const p of STYLE_PROPS)if(p in values)editing[p]=values[p];});
    else {Object.assign(ns,values);renderToolOpts();renderStyle();requestDraw();}
  }
  el.querySelectorAll('[data-stycolor]').forEach(b=>b.onclick=e=>applyAppearance({[e.shiftKey?'stroke':'fill']:b.dataset.stycolor}));
  el.querySelectorAll('[data-styclip]').forEach(b=>b.onclick=()=>{
    if(b.dataset.styclip==='copy'){const source=STY.mode==='shape'&&picked?shapeStyle(picked.L,picked.sh,S.frame):STY.mode==='style'&&editing?editing:ns;STY.clipboard=Object.fromEntries(STYLE_PROPS.map(p=>[p,source[p]]));renderStyle();}
    else if(b.dataset.styclip==='paste'&&STY.clipboard)applyAppearance(STY.clipboard);
    else if(b.dataset.styclip==='reset')applyAppearance({fill:'#ffffff',stroke:'#000000',width:3,fillOn:true,strokeOn:true});
  });
  const read = (i) => (i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value);
  el.querySelectorAll('[data-stymode]').forEach((b) => (b.onclick = () => { STY.mode = b.dataset.stymode; STY._auto = false; renderStyle(); }));
  const adv = el.querySelector('[data-styadv]'); if (adv) adv.onchange = () => { STY.advanced = adv.checked; renderStyle(); };
  el.querySelectorAll('[data-stdef]').forEach((i) => (i.oninput = () => { ns[i.dataset.stdef] = read(i); renderToolOpts(); }));
  el.querySelectorAll('[data-stdefslot]').forEach((i) => (i.onchange = () => { ns[i.dataset.stdefslot] = i.value || null; renderStyle(); }));
  if (picked) {
    const { L, sh } = picked;
    el.querySelectorAll('[data-stshape]').forEach((i) => {
      const p = i.dataset.stshape;
      if (i.type === 'color') { i.oninput = () => { if (!H.pending) beginEdit('Shape ' + p); styleSetShape(L, sh, p, i.value); requestDraw(); }; i.onchange = () => { commitEdit(); renderStyle(); }; }
      else i.onchange = () => edit('Shape ' + p, () => styleSetShape(L, sh, p, read(i)));
    });
    el.querySelectorAll('[data-stshapedef]').forEach((i) => (i.onchange = () => edit('Shape override', () => { sh.over = { ...(sh.over || {}), [i.dataset.stshapedef]: i.checked }; if (!i.checked) delete sh.over[i.dataset.stshapedef]; })));
    el.querySelectorAll('[data-stslot]').forEach((i) => (i.onchange = () => edit(i.dataset.stslot === 'styleId' ? 'Style 1' : 'Style 2', () => { sh[i.dataset.stslot] = i.value || null; })));
    el.querySelectorAll('[data-styapply]').forEach((b) => (b.onclick = () => edit('Apply style', () => { sh[b.dataset.styapply] = editing.id; })));
  }
  const se = el.querySelector('[data-styedit]'); if (se) se.onchange = () => { STY.editing = se.value; renderStyle(); };
  if (editing) {
    el.querySelectorAll('[data-ststyle]').forEach((i) => {
      const p = i.dataset.ststyle;
      if (i.type === 'color') { i.oninput = () => { if (!H.pending) beginEdit('Edit style'); editing[p] = i.value; requestDraw(); }; i.onchange = () => commitEdit(); }
      else i.onchange = () => edit('Edit style', () => { editing[p] = p === 'width' ? clamp(read(i), 0, 10000) : read(i); });
    });
    el.querySelectorAll('[data-ststyledef]').forEach((i) => (i.onchange = () => edit('Style defines ' + i.dataset.ststyledef, () => { editing.defines = { ...(editing.defines || Object.fromEntries(STYLE_PROPS.map((p) => [p, true]))), [i.dataset.ststyledef]: i.checked }; })));
  }
  el.querySelectorAll('[data-styact]').forEach((b) => (b.onclick = async () => {
    const a = b.dataset.styact;
    if (a === 'new') edit('New style', () => styleNew(null));
    if (a === 'fromshape' && picked) edit('New style from shape', () => styleNew(picked));
    if (a === 'rename' && editing) { const n = await askText('Rename style', 'Name', editing.name); if (n && n.trim()) edit('Rename style', () => { editing.name = n.trim().slice(0, 100); }); }
    if (a === 'delete' && editing) edit('Delete style', () => styleDelete(editing));
  }));
  el.querySelectorAll('[data-pal]').forEach((i) => {
    i.onclick = (e) => { const c = S.doc.palette[+i.dataset.pal], k = e.shiftKey ? 'stroke' : 'fill'; if (STY.mode === 'shape' && picked) edit('Apply palette color', () => styleSetShape(picked.L, picked.sh, k, c)); else if (STY.mode === 'style' && editing) edit('Edit style', () => { editing[k] = c; }); else { ns[k] = c; renderToolOpts(); refreshAll(); } };
    i.oncontextmenu = (e) => { e.preventDefault(); edit('Remove swatch', () => S.doc.palette.splice(+i.dataset.pal, 1)); };
  });
  bindCommon(el);
};
// New shapes take the DEFAULTS styles too.
const styleOldAddShape = addShape;
addShape = function (L, pathIds, style = S.newStyle, over = {}) {
  const sh = styleOldAddShape(L, pathIds, style, over);
  if (style === S.newStyle) { if (S.newStyle.styleId && styleById(S.newStyle.styleId)) sh.styleId = S.newStyle.styleId; if (S.newStyle.style2Id && styleById(S.newStyle.style2Id)) sh.style2Id = S.newStyle.style2Id; }
  return sh;
};
// Selecting a shape switches the window to SHAPE mode (unless the user chose another mode).
const styleOldSelectShape = vectorSelectShape;
vectorSelectShape = function (L, sh) { const r = styleOldSelectShape(L, sh); if (sh) { STY.mode = 'shape'; STY._auto = true; } return r; };
{ const c = CMDS.find((c) => c.id === 'win.style'); if (c) Object.assign(c, { label: 'Style', k: 'Ctrl+]', keys: 'ctrl+]' }); }
for (const id of ['style.new', 'style.fromshape']) { const c = CMDS.find((c) => c.id === id); if (c) c.run = () => { setTab('style'); const p = selectedShape(); if (id === 'style.fromshape' && !p) return toast('Select a shape first (Select Shape, Q)', 'err'); edit(id === 'style.new' ? 'New style' : 'New style from shape', () => styleNew(id === 'style.new' ? null : p)); }; }

// ---------- Eyedropper (Fill tools) ----------
// Click: pick the shape's appearance into DEFAULTS · Alt-click: push DEFAULTS onto the shape · Shift-click: pick its fill
// colour · Shift+Alt-click: pick its stroke colour. Pushing writes the shape's own colour channels at the current frame.
defTool('eyedropper', { icon: svgI('<path d="m14 4 6 6M5 19l1-4L15 6l3 3-9 9Z"/><path d="m13 5 6 6"/>'), name: 'Eyedropper', key: '', cursor: 'copy',
  hint: 'Click a shape to pick its appearance into the new-shape defaults · Alt-click pushes the defaults onto it · Shift-click picks its fill colour · Shift+Alt-click picks its stroke colour',
  down(e, sx, sy) {
    const L = selLayer(); if (!L || L.type !== 'vector') return;
    const sh = vectorHitShape(L, sx, sy); if (!sh) return toast('Click a fill or stroke');
    const st = shapeStyle(L, sh, S.frame), ns = S.newStyle;
    if (e.shiftKey) { ns[e.altKey ? 'stroke' : 'fill'] = st[e.altKey ? 'stroke' : 'fill']; toast(`Picked ${e.altKey ? 'stroke' : 'fill'} colour ${st[e.altKey ? 'stroke' : 'fill']}`, 'ok'); renderToolOpts(); return refreshAll(); }
    if (e.altKey) return vectorAction('Push style to shape', () => { for (const p of STYLE_PROPS) styleSetShape(L, sh, p, ns[p]); });
    Object.assign(ns, { fill: st.fill, stroke: st.stroke, width: st.width, fillOn: st.fillOn, strokeOn: st.strokeOn }); toast('Picked the shape\'s appearance into the defaults', 'ok'); renderToolOpts(); refreshAll();
  }, move() {}, up() {} });
VECTOR_FILL.push('eyedropper'); POINT_TOOLS.add('eyedropper');
