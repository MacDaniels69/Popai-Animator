/* ===================== Popai Animator — Actions, Smart Bones, animated layer order (Moho model) =====================
   Data:
   • The owning layer (normally the character's Bone layer) lists its actions: L.actionList = [{ id, name, kind, bone, dur }].
     kind: 'regular' (reusable motion) or 'smart' (driven by a bone's rotation).
   • Every layer in the owner's hierarchy stores its keys for an action in L.actions[actionId].ch.
   • Insert Reference records owner.actionRefs = [{ id, start }].
   • S.doc.activeAction = { owner, id } while an action is open. Opening swaps each hierarchy layer's channels for the
     action's (Mainline's are kept in L._mainCh), so the timeline, tools, undo and rendering all work on the action.
     Files are always written in Mainline form.
   • On Mainline, Smart Bone actions are added on top of each channel: the driver bone's angle selects the action frame
     whose driver angle matches, and the action's change from its neutral frame is applied. */

// ---------- structure ----------
function actSubtree(owner) { const out = [owner]; walk(owner.children || [], (l) => { out.push(l); }); return out; }
function actOwnerOf(L) { if (!L) return null; const chain = [L, ...ancestors(L.id)]; return chain.find((a) => a.type === 'bone') || chain[chain.length - 1]; }
function actFind(id) { for (const l of allLayers()) { const a = (l.actionList || []).find((x) => x.id === id); if (a) return { owner: l, action: a }; } return null; }
function actActive() { const a = S.doc && S.doc.activeAction; return a ? actFind(a.id) : null; }
function actOwnsLayer(L) { return !!(L && '_mainCh' in L); }
function actHasAnimation(L) { return !!L && actSubtree(L).some(layer=>actOwnsLayer(layer)&&Object.values(layer.ch).some(ch=>ch.keys?.length)); }
function actPreviewFrame(L, frame) { return S.doc?.activeAction && !actOwnsLayer(L) ? 0 : frame; }
function actCameraFrame(frame) { return S.doc?.activeAction ? S.doc.activeAction.cameraFrame ?? 0 : frame; }
function actProceduralFrame(L, frame) { return S.doc?.activeAction && (!actOwnsLayer(L) || !Object.values(L.ch).some(ch => ch.keys?.length)) ? 0 : frame; }
function timelineEnd() { return actActive()?.action.dur ?? S.doc.end; }
function timelineMarkers() { return actActive() ? [] : S.doc.markers; }
function actSwapIn(owner, id, context = null) {
  for (const l of actSubtree(owner)) { l._mainCh = l.ch; l.ch = (l.actions && l.actions[id] && l.actions[id].ch) || {}; if (l.actions) { delete l.actions[id]; if (!Object.keys(l.actions).length) delete l.actions; } }
  S.doc.activeAction = { owner: owner.id, id, mainlineFrame: context?.mainlineFrame ?? S.frame, cameraFrame: context?.cameraFrame ?? S.frame };
}
function actSwapOutLayer(l, id) {
  const ch = l.ch; l.ch = l._mainCh || {}; delete l._mainCh;
  if (Object.keys(ch).length) { l.actions = l.actions || {}; l.actions[id] = { ch }; }
}
function actSwapOut() {
  const a = S.doc.activeAction; if (!a) return;
  for (const l of allLayers()) if ('_mainCh' in l) actSwapOutLayer(l, a.id);
  S.doc.activeAction = null;
}
// Same normalisation on a raw document (imports and recovery files written while an action was open).
function actNormalizeDoc(d) {
  const a = d && d.activeAction; if (!a) return d;
  const visit = (list) => { for (const l of list || []) { if (l && '_mainCh' in l) actSwapOutLayer(l, a.id); visit(l && l.children); } };
  visit(d.layers); d.activeAction = null; return d;
}
function actOpen(owner, id) {
  if (S.playing) stopPlay();
  const previous = S.doc.activeAction, mainlineFrame = previous?.mainlineFrame ?? S.frame;
  actSwapOut();
  if (id) {
    actSwapIn(owner, id, { mainlineFrame, cameraFrame: previous?.cameraFrame ?? mainlineFrame });
    S.camSel = false; S.selLayers = S.selLayers.filter(layerId => actOwnsLayer(findLayer(layerId))); if (!S.selLayers.length) S.selLayers = [owner.id];
    if (S.mode === 'setup') { S.mode = 'animate'; updateModeUI(); }
  }
  S.selKeys = new Set(); S.activeChannel = null; TL.active = null; TL.contextKey = ''; TL.scrollY = 0; S.swPreview = {};
  invalidateScene(); REV++; S.frame = id ? 1 : mainlineFrame; renderTLBar(); refreshAll();
}

// ---------- editing inside an action ----------
// Inside an action every change is a key in that action; nothing writes the shared drawing or rig.
const actOldSetVal = setVal;
setVal = function (o, path, v, f = S.frame, force = false) {
  if (!S.doc || !S.doc.activeAction) return actOldSetVal(o, path, v, f, force);
  if (!actOwnsLayer(o)) throw new Error('Select a layer inside the active Action to edit its animation');
  assertWritable(o);
  if (!Number.isFinite(f) || f < 0 || f > 100000) throw new Error('Invalid keyframe time');
  REV++;
  const interp = DISCRETE(path) ? 'step' : undefined;
  let ch = o.ch[path];
  if (!ch) { ch = o.ch[path] = { keys: [] }; const base = baseGet(o, path); if (f !== 0 && base !== undefined) setKey(ch, 0, clone(base), interp); }
  setKey(ch, f, v, interp);
};
const actOldAvail = toolAvail;
toolAvail = function (id) {
  const r = actOldAvail(id); if (r) return r;
  const a = actActive(); if (!a) return null;
  if (a.action.kind === 'smart' && id === 'bonemanip') return 'Manipulate Bones is off inside Smart Bone actions — use Transform Bone so only the bones you choose move';
  if ((typeof VECTOR_TOPOLOGY !== 'undefined' && VECTOR_TOPOLOGY.has(id)) || ['boneadd', 'sketch', 'reparent', 'bind', 'bindpts', 'strength', 'offset'].includes(id)) return 'Structural and rig-setup changes are made on Mainline — double-click Mainline in the Actions panel';
  return null;
};
const actOldSetMode = setMode;
setMode = function (m) { if (m === 'setup' && actActive()) return toast('Setup changes the shared rig — return to Mainline first (Actions panel)', 'err'); return actOldSetMode(m); };

// ---------- evaluation on Mainline (Smart Bones and references) ----------
let actIndexCache = { rev: -1, map: new Map() }, actTimeCache = new Map(), actGuard = false;
function actIndex() {
  if (actIndexCache.rev === REV) return actIndexCache.map;
  const map = new Map();
  for (const owner of allLayers()) for (const a of owner.actionList || []) map.set(a.id, { owner, action: a, driverPath: a.kind === 'smart' && a.bone ? 'bone:' + a.bone + ':a' : null, refs: (owner.actionRefs || []).filter((r) => r.id === a.id), dur: Math.max(1, a.dur || 24) });
  actIndexCache = { rev: REV, map }; actTimeCache = new Map(); return map;
}
// Action frame whose driver angle matches `angle` (piecewise-linear search over the driver's action curve).
function actTimeForAngle(info, angle) {
  const dch = info.owner.actions && info.owner.actions[info.action.id] && info.owner.actions[info.action.id].ch[info.driverPath];
  if (!dch || !dch.keys.length) return null;
  const dur = info.dur, step = Math.max(1, dur / 400); let prevT = 0, prevA = evalChannel(dch, 0), best = 0, bestD = Math.abs(prevA - angle);
  for (let t = step; t <= dur + 1e-9; t += step) {
    const a = evalChannel(dch, Math.min(t, dur));
    if ((angle - prevA) * (angle - a) <= 0 && a !== prevA) return prevT + (Math.min(t, dur) - prevT) * (angle - prevA) / (a - prevA);
    const d = Math.abs(a - angle); if (d < bestD) { bestD = d; best = Math.min(t, dur); }
    prevT = Math.min(t, dur); prevA = a;
  }
  return best;
}
function actSmartTimes(info, f) {
  const key = info.action.id + '|' + f; if (actTimeCache.has(key)) return actTimeCache.get(key);
  actGuard = true; let res = null;
  try {
    const now = val(info.owner, info.driverPath, f), rest = baseGet(info.owner, info.driverPath);
    const t = actTimeForAngle(info, now), t0 = actTimeForAngle(info, rest);
    res = t === null ? null : [t, t0 === null ? 0 : t0];
  } finally { actGuard = false; }
  actTimeCache.set(key, res); return res;
}
function actAdd(base, a, a0) {
  if (typeof base === 'number' && typeof a === 'number' && typeof a0 === 'number') return base + (a - a0);
  if (Array.isArray(base) && Array.isArray(a) && Array.isArray(a0)) return base.map((v, i) => v + (a[i] - a0[i]));
  return JSON.stringify(a) === JSON.stringify(a0) ? base : a;
}
const actOldVal = val;
val = function (o, path, f) {
  if (S.doc?.activeAction && o && !actOwnsLayer(o)) return o.id === 'CAM' ? actOldVal(o, path, actCameraFrame(f)) : baseGet(o, path);
  const v = actOldVal(o, path, f);
  if (actGuard || !o || !o.actions || (S.doc && S.doc.activeAction)) return v;
  let out = v; const idx = actIndex();
  for (const id in o.actions) {
    const ch = o.actions[id].ch[path]; if (!ch || !ch.keys.length) continue;
    const info = idx.get(id); if (!info) continue;
    if (info.action.kind === 'smart') {
      if (o === info.owner && path === info.driverPath) continue;
      const ts = actSmartTimes(info, f); if (!ts) continue;
      out = actAdd(out, evalChannel(ch, ts[0]), evalChannel(ch, ts[1]));
    } else for (const r of info.refs) if (f >= r.start && f <= r.start + info.dur) out = evalChannel(ch, f - r.start);
  }
  return out;
};
// Files, autosave and desktop saves always contain Mainline.
const actOldSerialize = serialize;
serialize = function () {
  const a = S.doc && S.doc.activeAction; if (!a) return actOldSerialize();
  const found = actFind(a.id); actSwapOut();
  try { return actOldSerialize(); } finally { if (found) actSwapIn(found.owner, a.id, a); }
};
const actOldValidate = validateProject;
validateProject = function (input) {
  if (input && input.doc) actNormalizeDoc(input.doc);
  const d = actOldValidate(input);
  const flat = []; (function v(list) { for (const l of list) { flat.push(l); if (l.children) v(l.children); } })(d.layers);
  const ids = new Set();
  for (const l of flat) {
    if (l.actionList !== undefined) {
      if (!Array.isArray(l.actionList) || l.actionList.length > 1000) throw new Error('Invalid action list');
      for (const a of l.actionList) {
        if (!a || typeof a.id !== 'string' || !/^[\w-]{1,80}$/.test(a.id) || ids.has(a.id) || typeof a.name !== 'string' || a.name.length > 200 || !['regular', 'smart'].includes(a.kind) || !Number.isInteger(a.dur) || a.dur < 1 || a.dur > 100000) throw new Error('Invalid action');
        if (a.kind === 'smart' && (l.type !== 'bone' || !l.bones.some((b) => b.id === a.bone))) throw new Error('Smart Bone action references a missing bone');
        ids.add(a.id);
      }
    }
  }
  for (const l of flat) {
    if (l.actions !== undefined) { if (!l.actions || typeof l.actions !== 'object' || Array.isArray(l.actions)) throw new Error('Invalid action data');
      for (const [id, a] of Object.entries(l.actions)) { if (!ids.has(id) || !a || typeof a.ch !== 'object' || Array.isArray(a.ch)) throw new Error('Action data references a missing action');
        for (const c of Object.values(a.ch)) if (!c || !Array.isArray(c.keys) || c.keys.some((k) => !Number.isInteger(k.f) || k.f < 0 || k.f > 100000 || k.v === undefined)) throw new Error('Invalid action keys'); } }
    if (l.actionRefs !== undefined && (!Array.isArray(l.actionRefs) || l.actionRefs.some((r) => !r || !ids.has(r.id) || !Number.isInteger(r.start) || r.start < 0 || r.start > 100000))) throw new Error('Invalid action reference');
    if (l.animOrder !== undefined && typeof l.animOrder !== 'boolean') throw new Error('Invalid animated layer order setting');
    if (l.ch.order && l.ch.order.keys.some((k) => typeof k.v !== 'string' || k.v.length > 100000)) throw new Error('Invalid layer order key');
  }
  return d;
};

// ---------- commands ----------
function actOwner() { const L = selLayer(); return actOwnerOf(L) || null; }
function actUniqueName(owner, base) { const names = new Set((owner.actionList || []).map((a) => a.name)); let n = base, i = 2; while (names.has(n)) n = base + ' ' + i++; return n; }
function actCreate(owner, name, kind = 'regular', extra = {}) { const a = { id: uid('ac'), name, kind, dur: Math.max(1, Math.round(S.doc.end || 24)), ...extra }; owner.actionList = [...(owner.actionList || []), a]; return a; }
function actDelete(id) {
  const f = actFind(id); if (!f) return;
  if (S.doc.activeAction && S.doc.activeAction.id === id) actSwapOut();
  f.owner.actionList = f.owner.actionList.filter((a) => a.id !== id); if (!f.owner.actionList.length) delete f.owner.actionList;
  for (const l of allLayers()) { if (l.actions) { delete l.actions[id]; if (!Object.keys(l.actions).length) delete l.actions; } if (l.actionRefs) { l.actionRefs = l.actionRefs.filter((r) => r.id !== id); if (!l.actionRefs.length) delete l.actionRefs; } }
}
// Insert Copy: the action's keys become independent keys in the current context, starting at the current frame.
function actInsertCopy(id, at = S.frame) {
  const f = actFind(id); if (!f) throw new Error('Unknown action');
  let n = 0;
  for (const l of actSubtree(f.owner)) {
    const src = l.actions && l.actions[id] && l.actions[id].ch; if (!src) continue;
    for (const [path, ch] of Object.entries(src)) for (const k of ch.keys) { setVal(l, path, clone(k.v), at + k.f, true); const key = l.ch[path] && l.ch[path].keys.find((x) => x.f === at + k.f); if (key && k.i) key.i = k.i; n++; }
  }
  return n;
}
cmd('win.actions', 'Window', 'Actions', () => setTab('actions'), { k: 'Ctrl+K', keys: 'ctrl+k', kw: 'smart bones action mainline' });
cmd('act.mainline', 'Animate', 'Return to Mainline', () => { if (!actActive()) return toast('Mainline is already active'); actOpen(null, null); toast('Editing Mainline', 'ok'); });
cmd('bone.smartdial', 'Rig', 'Make Smart Bone Dial…', () => smartDialDialog(), { en: () => (activeBoneLayer() ? false : 'Select a Bone layer (or artwork inside it)'), kw: 'smart bone action dial control' });

// Make Smart Bone Dial: prepare the control bone and its action(s); the visual response is authored inside them.
async function smartDialDialog() {
  const B = activeBoneLayer(); if (!B) return toast('Select a Bone layer first', 'err');
  if (actActive()) return toast('Return to Mainline first (Actions panel)', 'err');
  const sb = boneOf(B, S.selBone);
  const r = await modal('Make Smart Bone Dial', `<div class="form" style="grid-template-columns:auto 1fr">
    <label>Name</label><input type="text" name="name" value="${esc(sb ? sb.name : actUniqueName(B, 'Dial'))}">
    <label>Minimum angle °</label><input type="number" name="min" value="-90" step="1">
    <label>Maximum angle °</label><input type="number" name="max" value="90" step="1">
    <label>Duration (frames)</label><input type="number" name="dur" value="24" min="2" max="1000" step="1">
    <label></label><label><input type="checkbox" name="sep" checked> Separate actions for positive and negative angles</label></div>
    <div class="note">${sb ? `Uses the selected bone <b>${esc(sb.name)}</b> and sets its strength to 0 so it does not deform artwork.` : 'Creates a new control bone with zero strength.'} The actions start at the neutral angle; open them in the Actions panel and edit the artwork at their frames.</div>`,
  [{ label: 'Cancel', value: false }, { label: 'Create', value: true, pri: true }]);
  if (!r || !r.v) return;
  const name = String(r.data.name || '').trim().slice(0, 100), min = +r.data.min, max = +r.data.max, dur = Math.round(+r.data.dur);
  if (!name) return toast('Enter a name', 'err');
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || min > 0 || max < 0) return toast('Use a minimum ≤ 0 ≤ maximum, with minimum < maximum', 'err');
  if (!Number.isInteger(dur) || dur < 2 || dur > 1000) return toast('Duration must be 2–1000 frames', 'err');
  if (S.mode !== 'setup') setMode('setup');
  const made = smartDialCreate(B, sb, name, min, max, dur, !!r.data.sep);
  if (made) { setTab('actions'); toast(`Smart Bone “${name}” ready: ${made.map((a) => a.name).join(' and ')}`, 'ok'); }
}
function smartDialCreate(B, sb, name, min, max, dur, separate) {
  let made = null;
  edit('Make Smart Bone Dial', () => {
    let b = sb;
    if (!b) { const n = B.bones.length; b = newBone(B, name, null, 40 + 30 * (n % 6), -120 - 30 * Math.floor(n / 6), 0, 40); }
    b.name = name; b.str = 0;
    const rest = baseGet(B, 'bone:' + b.id + ':a'), key = (a, ranges) => { B.actions = B.actions || {}; B.actions[a.id] = { ch: { ['bone:' + b.id + ':a']: { keys: ranges.map(([f, v]) => ({ f, v: round(v, 4) })) } } }; };
    made = [];
    if (separate) {
      const pos = actCreate(B, actUniqueName(B, name), 'smart', { bone: b.id, dur }); key(pos, [[0, rest], [dur, rest + max]]); made.push(pos);
      if (min < 0) { const neg = actCreate(B, actUniqueName(B, name + ' 2'), 'smart', { bone: b.id, dur }); key(neg, [[0, rest], [dur, rest + min]]); made.push(neg); }
    } else { const a = actCreate(B, actUniqueName(B, name), 'smart', { bone: b.id, dur }); key(a, [[0, rest + min], [dur, rest + max]]); made.push(a); }
    selectBone(b.id);
  });
  return made;
}

// ---------- Actions panel ----------
const ACTP = { cat: 'all', filter: '', sort: false, sel: null };
function renderActions() {
  const el = $('#tabBody'), owner = actOwner(), active = actActive();
  if (!owner) { el.innerHTML = sec('Actions', '<div class="note">Select the character’s Bone layer (or any layer) to see its actions.</div>'); return; }
  let list = (owner.actionList || []).filter((a) => ACTP.cat === 'all' || (ACTP.cat === 'smart' ? a.kind === 'smart' : a.kind === 'regular'));
  if (ACTP.filter) list = list.filter((a) => a.name.toLowerCase().includes(ACTP.filter.toLowerCase()));
  if (ACTP.sort) list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  const isActive = (id) => active && active.action.id === id, mark = (on) => `<span class="act-arrow" title="Active editing context">${on ? '▶' : ''}</span>`;
  const row = (a) => { const b = a.kind === 'smart' && boneOf(owner, a.bone); return `<div class="act-row ${ACTP.sel === a.id ? 'sel' : ''} ${isActive(a.id) ? 'on' : ''}" data-act="${a.id}">${mark(isActive(a.id))}<span class="act-name">${esc(a.name)}</span><span class="act-kind">${a.kind === 'smart' ? '🦴 ' + esc(b ? b.name : '?') : 'Action'} · ${a.dur}f</span></div>`; };
  const refs = (owner.actionRefs || []).map((r, i) => { const a = (owner.actionList || []).find((x) => x.id === r.id); return a ? `<div class="act-ref">↪ ${esc(a.name)} referenced at frame ${r.start}<button class="ib sm" data-actref="${i}" title="Remove reference">✕</button></div>` : ''; }).join('');
  const cats = [['all', 'All'], ['regular', 'Regular'], ['smart', 'Smart Bones']].map(([k, n]) => `<button class="btn ${ACTP.cat === k ? 'pri' : ''}" data-actcat="${k}">${n}</button>`).join('');
  const sel = (owner.actionList || []).find((a) => a.id === ACTP.sel);
  const dis = (cond, why) => (cond ? '' : `disabled title="${esc(why)}"`);
  el.innerHTML = sec('Actions — ' + esc(owner.name), `<div style="grid-column:1/-1;min-width:0"><div class="act-cats">${cats}</div>
    <div class="act-tools"><input type="text" data-actfilter placeholder="Filter" value="${esc(ACTP.filter)}"><label><input type="checkbox" data-actsort ${ACTP.sort ? 'checked' : ''}> Sort</label></div>
    <div class="act-list"><div class="act-row main ${active ? '' : 'on'}" data-act="">${mark(!active)}<span class="act-name">— Mainline —</span><span class="act-kind">scene animation</span></div>${list.map(row).join('') || '<div class="note">No actions in this category.</div>'}</div>
    <div class="act-footer"><button class="ib" data-actmenu title="Action commands" aria-label="Action commands">⋯</button><span class="act-spacer"></span><button class="ib" data-actcmd="export" title="Export action" aria-label="Export action" ${dis(sel, 'Select an action')}>↗</button><button class="ib" data-actcmd="import" title="Import action" aria-label="Import action">↙</button><button class="ib" data-cmd="bone.smartdial" title="Make Smart Bone Dial" aria-label="Make Smart Bone Dial">◴</button></div>
    ${refs ? '<div class="act-refs"><b>References on Mainline</b>' + refs + '</div>' : ''}
    ${active ? `<div class="note act-banner">Editing <b>${esc(active.action.name)}</b>${active.action.kind === 'smart' ? ' (Smart Bone: rotate its driver within the action to set each frame’s response)' : ''}. Select each layer to edit its part of the action.</div>` : ''}</div>`);
  const actionMenu = (x, y) => {
    const selected = (owner.actionList || []).find(a => a.id === ACTP.sel);
    showMenu(x, y, [
      {label:'New action…',run:()=>actCommand('new',owner,selected)},
      {label:'Make active',dis:!selected,run:()=>actCommand('open',owner,selected)},
      {label:'Return to Mainline',dis:!active,run:()=>actOpen(owner,null)},
      {sep:1},
      {label:'Insert copy',dis:!selected || isActive(selected.id),run:()=>actCommand('copy',owner,selected)},
      {label:'Insert reference',dis:!selected || !!active || selected.kind!=='regular',run:()=>actCommand('ref',owner,selected)},
      {sep:1},
      {label:'Rename…',dis:!selected,run:()=>actCommand('rename',owner,selected)},
      {label:'Delete',dis:!selected,run:()=>actCommand('delete',owner,selected)}
    ]);
  };
  const actionList=el.querySelector('.act-list');
  if(actionList) actionList.oncontextmenu = e => {
    e.preventDefault(); const row=e.target.closest('[data-act]');
    if(row){ACTP.sel=row.dataset.act || null;el.querySelectorAll('[data-act]').forEach(r=>r.classList.toggle('sel',r===row));}
    actionMenu(e.clientX,e.clientY);
  };
  const more=el.querySelector('[data-actmenu]');if(more) more.onclick=()=>{const r=more.getBoundingClientRect();actionMenu(r.left,r.bottom);};
  if(actionList) actionList.tabIndex=0;
  if(actionList) actionList.onkeydown=e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const r=e.currentTarget.getBoundingClientRect();actionMenu(r.left,r.top);}};
  el.querySelectorAll('[data-actcat]').forEach((b) => (b.onclick = () => { ACTP.cat = b.dataset.actcat; renderActions(); }));
  const fi = el.querySelector('[data-actfilter]'); fi.oninput = () => { ACTP.filter = fi.value; const pos = fi.selectionStart; renderActions(); const n = $('#tabBody [data-actfilter]'); n.focus(); n.setSelectionRange(pos, pos); };
  el.querySelector('[data-actsort]').onchange = (e) => { ACTP.sort = e.target.checked; renderActions(); };
  el.querySelectorAll('[data-act]').forEach((r) => { r.onclick = () => { ACTP.sel = r.dataset.act || null; renderActions(); }; r.ondblclick = () => { const id = r.dataset.act; actOpen(owner, id || null); ACTP.sel = id || null; toast(id ? `Editing action “${owner.actionList.find((a) => a.id === id).name}”` : 'Editing Mainline', 'ok'); }; });
  el.querySelectorAll('[data-actref]').forEach((b) => (b.onclick = () => edit('Remove action reference', () => { owner.actionRefs.splice(+b.dataset.actref, 1); if (!owner.actionRefs.length) delete owner.actionRefs; })));
  el.querySelectorAll('[data-actcmd]').forEach((b) => (b.onclick = () => actCommand(b.dataset.actcmd, owner, sel)));
  bindCommon(el);
}
// Creating an action from a selected bone makes a rotation-driven response.
function actCreateForSelectedBone(owner) {
  const bone=owner?.type==='bone'&&boneOf(owner,S.selBone);
  if(!bone)return null;
  if(actActive()) {toast('Return to Mainline before creating a Smart Bone action','err');return false;}
  let action;
  if(edit('New Smart Bone action',()=>{
    assertWritable(owner);
    action=actCreate(owner,actUniqueName(owner,bone.name),'smart',{bone:bone.id});
    // New Action is blank. The animator authors the driver's angle keys and response.
  })===false)return false;
  return action;
}
async function actCommand(c, owner, sel) {
  if (c === 'new' && owner?.type==='bone' && boneOf(owner,S.selBone)) {
    const action=actCreateForSelectedBone(owner);
    if(action){ACTP.sel=action.id;ACTP.cat='smart';ACTP.filter='';actOpen(owner,action.id);toast('Editing Smart Bone action “'+action.name+'”','ok');}
    return;
  }
  if (c === 'new') { const n = await askText('New action', 'Name', actUniqueName(owner, 'Action')); if (!n || !n.trim()) return; let a; if (edit('New action', () => { a = actCreate(owner, n.trim().slice(0, 100)); }) !== false) { ACTP.sel = a.id; actOpen(owner, a.id); toast(`Editing new action “${a.name}”`, 'ok'); } return; }
  if (c === 'import') return actImport(owner);
  if (!sel) return;
  if (c === 'open') { actOpen(owner, sel.id); return; }
  if (c === 'copy') { let n = 0; edit('Insert copy of ' + sel.name, () => { n = actInsertCopy(sel.id, S.frame); }); return toast(`Inserted ${n} key(s) from “${sel.name}” at frame ${S.frame}`, 'ok'); }
  if (c === 'ref') { edit('Insert reference to ' + sel.name, () => { owner.actionRefs = [...(owner.actionRefs || []), { id: sel.id, start: S.frame }]; }); return toast(`“${sel.name}” plays from frame ${S.frame}; edits to the action update it`, 'ok'); }
  if (c === 'rename') { const n = await askText('Rename action', sel.kind === 'smart' ? 'Name (the Smart Bone link is kept by bone, not by name)' : 'Name', sel.name); if (n && n.trim()) edit('Rename action', () => { sel.name = n.trim().slice(0, 100); }); return; }
  if (c === 'delete') { const r = await modal('Delete action', `<div class="note">Delete “${esc(sel.name)}” and its keys on every layer? References to it are removed; inserted copies stay.</div>`, [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, pri: true }]); if (r && r.v) { edit('Delete action', () => actDelete(sel.id)); ACTP.sel = null; refreshAll(); } return; }
  if (c === 'export') return actExport(owner, sel);
  if (c === 'import') return actImport(owner);
}
// Export / import: keys are matched to layers by their path of names inside the owner.
function actLayerPath(owner, l) { const chain = [l, ...ancestors(l.id)]; const i = chain.indexOf(owner); return chain.slice(0, i).reverse().map((x) => x.name).join(' / '); }
function actExport(owner, a) {
  if (S.doc.activeAction && S.doc.activeAction.id === a.id) return toast('Return to Mainline before exporting the open action', 'err');
  const layers = {}; for (const l of actSubtree(owner)) if (l.actions && l.actions[a.id]) layers[actLayerPath(owner, l)] = clone(l.actions[a.id].ch);
  const bone = a.kind === 'smart' ? (boneOf(owner, a.bone) || {}).name : undefined;
  download(new Blob([JSON.stringify({ app: 'Popai Animator', type: 'action', format: 1, action: { name: a.name, kind: a.kind, dur: a.dur, bone }, layers })], { type: 'application/json' }), a.name.replace(/[^\w\- ]+/g, '_') + '.popai-action.json');
}
function actImport(owner) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try {
      const f = inp.files[0]; if (!f || f.size > 20 * 1024 * 1024) throw new Error('Choose an action file under 20 MB');
      const j = JSON.parse(await f.text()); if (!j || j.type !== 'action' || !j.action || typeof j.layers !== 'object') throw new Error('Not a Popai action file');
      const kind = j.action.kind === 'smart' ? 'smart' : 'regular', bone = kind === 'smart' ? (owner.bones || []).find((b) => b.name === j.action.bone) : null;
      if (kind === 'smart' && !bone) throw new Error(`This Smart Bone action needs a bone named “${j.action.bone}” in ${owner.name}`);
      const byPath = new Map(actSubtree(owner).map((l) => [actLayerPath(owner, l), l])); let matched = 0, missing = 0;
      edit('Import action', () => {
        const a = actCreate(owner, actUniqueName(owner, String(j.action.name || 'Imported').slice(0, 100)), kind, { dur: Math.max(1, Math.min(100000, Math.round(+j.action.dur) || 24)), ...(bone ? { bone: bone.id } : {}) });
        for (const [p, ch] of Object.entries(j.layers)) { const l = byPath.get(p); if (!l) { missing++; continue; } l.actions = l.actions || {}; l.actions[a.id] = { ch: clone(ch) }; matched++; }
        validateProject({ format: 1, doc: JSON.parse(snapshot()) });
      });
      toast(`Imported action: ${matched} layer(s) matched${missing ? `, ${missing} not found` : ''}`, missing ? 'err' : 'ok');
    } catch (e) { toast('Import failed: ' + e.message, 'err'); }
  };
  inp.click();
}
const actOldRenderSide = renderSide;
renderSide = function () { if (currentTab === 'actions') { const el = $('#tabBody'); if (el && el.contains(document.activeElement) && document.activeElement.matches('[data-actfilter]')) return; return renderActions(); } return actOldRenderSide(); };
const actOldInitSide = initSide;
initSide = function () {
  const jobs = $('#sideTabs [data-tab="jobs"]');
  if (jobs && !$('#sideTabs [data-tab="actions"]')) { const b = document.createElement('button'); b.dataset.tab = 'actions'; b.textContent = 'Actions'; jobs.parentNode.insertBefore(b, jobs); }
  actOldInitSide();
};
// The timeline says which context is being edited.
const actOldTLContext = renderTimelineContext;
renderTimelineContext = function () {
  actOldTLContext();
  const a = actActive(), host = $('#tlcontext'); if (!host) return;
  document.body.classList.toggle('in-action', !!a);
  document.body.classList.toggle('action-regular', !!a && a.action.kind!=='smart');
  document.body.classList.toggle('action-smart', a?.action.kind==='smart');
  let tag = $('#tlAction'); if (!tag) { tag = document.createElement('span'); tag.id = 'tlAction'; host.parentNode.insertBefore(tag, host); }
  const text = a ? `▶ Action: ${a.action.name}${a.action.kind === 'smart' ? ' (Smart Bone)' : ''}` : '';
  if (tag._t !== text) { tag._t = text; tag.innerHTML = a ? `${esc(text)} <button class="ib sm" id="tlMainline" title="Return to Mainline">Mainline</button>` : ''; const m = $('#tlMainline'); if (m) m.onclick = () => runCmd('act.mainline'); }
};
// Exporting renders Mainline.
{ const c = CMDS.find((c) => c.id === 'file.export'); if (c) { const run = c.run; c.run = (...a) => (actActive() ? toast('Return to Mainline before exporting (Actions panel)', 'err') : run(...a)); } }

// ---------- animated layer order ----------
// A Group or Bone layer with "Animated layer order" keeps its child order per frame in its 'order' channel (step keys
// of child ids). Frame 0 / Setup reordering changes the stored order; later frames key the order instead.
CH_LABEL.order = 'Layer ordering';
function orderAt(P, f) {
  if (!P || !P.animOrder || !P.ch.order || !P.ch.order.keys.length) return P ? P.children : [];
  const ids = String(val(P, 'order', f) || '').split(','), byId = new Map(P.children.map((c) => [c.id, c]));
  const out = ids.map((id) => byId.get(id)).filter(Boolean); for (const c of P.children) if (!out.includes(c)) out.push(c);
  return out;
}
const orderOldDrawContent = drawContent;
drawContent = function (ctx, L, R, lc) {
  if (!(L.type === 'group' || L.type === 'bone') || !L.animOrder || !L.ch.order) return orderOldDrawContent(ctx, L, R, lc);
  const stored = L.children; L.children = orderAt(L, R.f);
  try { return orderOldDrawContent(ctx, L, R, lc); } finally { L.children = stored; }
};
const orderOldRenderLayers = renderLayers;
renderLayers = function () {
  const swapped = []; for (const l of allLayers()) if (l.animOrder && l.ch && l.ch.order) { swapped.push([l, l.children]); l.children = orderAt(l, S.frame); }
  try { return orderOldRenderLayers(); } finally { for (const [l, c] of swapped) l.children = c; }
};
function orderKeyed(P) { return P && (P.type === 'group' || P.type === 'bone') && P.animOrder && S.mode === 'animate' && S.frame > 0; }
for (const [id, dir] of [['layer.up', -1], ['layer.down', 1]]) {
  const c = CMDS.find((x) => x.id === id); if (!c) continue; const run = c.run;
  c.run = () => {
    const L = selLayer(), P = L && parentOf(L.id);
    if (!orderKeyed(P)) { const r = run(); if (P && P.animOrder && P.ch.order) edit('Layer order', () => setVal(P, 'order', P.children.map((x) => x.id).join(','), 0)); return r; }
    const order = [...orderAt(P, S.frame)], i = order.indexOf(L), j = i + dir; if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    edit('Layer order', () => setVal(P, 'order', order.map((x) => x.id).join(','), S.frame, true));
  };
}
// Drag-and-drop within the same parent keys the order too (moving into another parent is never animated).
const orderOldReparent = reparentLayerSafe;
reparentLayerSafe = function (l, target, where) {
  const P = parentOf(l.id), dest = where === 'in' ? target : parentOf(target.id);
  if (!orderKeyed(P) || dest !== P || where === 'in') return orderOldReparent(l, target, where);
  const order = orderAt(P, S.frame).filter((x) => x !== l), at = order.indexOf(target); order.splice(at + (where === 'below' ? 1 : 0), 0, l);
  setVal(P, 'order', order.map((x) => x.id).join(','), S.frame, true);
};
LS_FIELDS.push({ k: 'animOrder', tab: 'Depth Sort', label: 'Enable animated layer order', type: 'check', when: (L) => L.type === 'group' || L.type === 'bone', get: (L) => !!L.animOrder,
  set: (L, v) => { L.animOrder = !!v; if (v && !L.ch.order) L.ch.order = { keys: [{ f: 0, v: L.children.map((c) => c.id).join(','), i: 'step' }] }; if (!v) delete L.ch.order; } });

// ---------- Transform Layer additions ----------
// Alt-drag moves in depth (Z); Shift+Alt changes depth while compensating scale so the apparent size stays the same;
// Ctrl-drag on a motion-path key moves that position key. Numeric X / Y / Z are in the tool options.
{
  const T = TOOLS.select, down = T.down, move = T.move, up = T.up;
  T.hint = 'Select a layer in Layers · drag anywhere to move it (Shift constrains) · Alt-drag: depth · Shift+Alt-drag: depth keeping apparent size · Ctrl-drag a motion-path key to move it · handles scale / rotate';
  T.down = function (e, sx, sy) {
    const L = selLayer();
    if (!L) return toast('Select a layer in the Layers panel');
    const why=writeReason(L);if(why)return toast(why,'err');
    if (L && !L.lock && (e.ctrlKey || e.metaKey) && S.showPaths) { const k = pathKeyAt(L, sx, sy); if (k !== null) { beginEdit('Edit motion path'); startDrag(e, { mode: 'pathkey', L, f: k, x: val(L, 'x', k), y: val(L, 'y', k), inv: M.inv(parentFull(L)) }); return; } }
    if (L && !L.lock && e.altKey) { const ts = L.type !== 'audio' ? [L] : []; beginEdit('Move layer in depth'); startDrag(e, { mode: 'depth', keep: e.shiftKey, ts: ts.map((l) => ({ l, z: val(l, 'z', S.frame) || 0, sx: val(l, 'sx', S.frame), sy: val(l, 'sy', S.frame) })) }); return; }
    return down.call(this, e, sx, sy);
  };
  T.move = function (e, sx, sy) {
    const d = Stage.drag; if (!d) return;
    if (d.mode === 'pathkey') { const v = cameraDragDelta(d.inv, sx, sy, d.sx, d.sy); setVal(d.L, 'x', round(d.x + v[0]), d.f, true); setVal(d.L, 'y', round(d.y + v[1]), d.f, true); return requestDraw(); }
    if (d.mode === 'depth') {
      const dz = -(sy - d.sy) / (Stage.dpr || 1) / (S.view.zoom || 1);
      for (const t of d.ts) { const z = round(Math.min(CAM_D - 60, t.z + dz)); setVal(t.l, 'z', z); if (d.keep) { const k = (CAM_D - z) / (CAM_D - t.z); setVal(t.l, 'sx', round(t.sx * k, 4)); setVal(t.l, 'sy', round(t.sy * k, 4)); } }
      return requestDraw();
    }
    return move.call(this, e, sx, sy);
  };
  T.up = function (e) { const d = Stage.drag; if (d && (d.mode === 'pathkey' || d.mode === 'depth')) return commitEdit(); return up.call(this, e); };
}
function pathKeyAt(L, sx, sy) {
  const fs = [...new Set(['x', 'y'].flatMap((k) => (L.ch[k] ? L.ch[k].keys.map((q) => q.f) : [])))];
  const cam = stageCamFn(S.frame), V = viewM(); let best = null, bd = 9 * (Stage.dpr || 1);
  for (const f of fs) { const lc = evalLC(L, f), p = M.ap(M.chain(V, cam(lc.z), lc.world), 0, 0), d = Math.hypot(p[0] - sx, p[1] - sy); if (d < bd) { bd = d; best = f; } }
  return best;
}
function layerPosHTML() {
  const L = selLayer(); if (!L || L.type === 'audio' || (S.tool !== 'select' && S.tool !== 'rotxy')) return '';
  const disabled = writeReason(L) ? 'disabled' : '';
  const n = (k, label, title, step = 1) => `<label title="${title}">${label} <input aria-label="${title}" type="number" data-lpos="${k}" value="${round(val(L, k, S.frame) ?? 0, 3)}" step="${step}" ${k === 'opacity' ? 'min="0" max="1"' : ''} ${disabled} style="width:52px"></label>`;
  const pivot = (k,label) => `<label title="Pivot ${label}">P${label}<input aria-label="Pivot ${label}" type="number" data-lpivot="${k}" value="${round(L.p[k] || 0,3)}" step="1" ${disabled} style="width:48px"></label>`;
  return '<span class="sep"></span>'+n('x','X','Position X')+n('y','Y','Position Y')+n('z','Z','Depth Z')+n('rot','↻','Rotation',0.1)+n('sx','Sx','Scale X',0.01)+n('sy','Sy','Scale Y',0.01)+n('opacity','α','Opacity',0.01)+pivot('ox','X')+pivot('oy','Y')+'<button class="btn" data-cmd="layer.pivotcenter" title="Center pivot on artwork">Center pivot</button>';
}
