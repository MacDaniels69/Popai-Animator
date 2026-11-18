// Subdued context surfaces keep interpolation and selected-key colors unchanged.
function timelineContextTheme(){
  const action=typeof actActive==='function'?actActive()?.action:null;
  if(action?.kind==='smart')return {kind:'smart',background:'#292334',range:'#342c42',ruler:'#211b2c'};
  if(action)return {kind:'regular',background:'#193034',range:'#223c40',ruler:'#14282c'};
  return {kind:'mainline',background:'#1d2026',range:'#23262e',ruler:'#16181d'};
}
/* ===================== Popai Animator — timeline (dope sheet + curve editor), playback, audio ===================== */

const TL = { cv: null, ctx: null, dpr: 1, ppf: 14, scrollX: 0, scrollY: 0, mode: 'dope', rows: [], drag: null, NAMEW: 0, RULER: 24, clip: null, curveView: null, pins: new Set(), consolidate: false, contextKey: '', contextHTML: '' };

// ---------- channel naming / grouping ----------
const CH_LABEL = { x: 'Position X', y: 'Position Y', z: 'Depth Z', rot: 'Rotation', sx: 'Scale X', sy: 'Scale Y', opacity: 'Opacity', sw: 'Switch', color: 'Color', zoom: 'Zoom', roll: 'Roll', shake: 'Shake', shakeFreq: 'Shake freq', gain: 'Gain', visible: 'Render visibility', vit: 'Vitruvian selection' };
function channelGroups(o) {
  const groups = new Map();
  const add = (key,label,path,selected=false) => { if(!groups.has(key))groups.set(key,{key,label,paths:[],selected});groups.get(key).paths.push(path); };
  const primary=selLayer(),rig=activeBoneLayer(),bones=rig===o?new Set(selectedBoneIds()):new Set();
  const boneNames={a:'Bone angle',p:'Bone translation',s:'Bone scale'};
  for(const path of Object.keys(o.ch).sort()) {
    if(!o.ch[path]?.keys.length)continue;
    const [kind,id,prop]=path.split(':');
    if(kind==='pt') { add('pts','Point motion',path);if(primary===o&&S.selPts.has(id))add('selected:pts','Selected point motion',path,true); }
    else if(kind==='bone') {const label=boneNames[prop]||('Bone '+prop);add('bones:'+prop,label,path);if(bones.has(id))add('selected:bones:'+prop,'Selected '+label.toLowerCase(),path,true);}
    else if(kind==='fx') {const e=o.fx.find(e=>e.id===id);add(path,(e&&FX[e.type]?FX[e.type].label:'Effect')+' · '+prop,path);}
    else if(kind==='pv'){const label=({c:'Curvature',hin:'Bézier in',hout:'Bézier out',width:'Line width',alpha:'Point opacity',color:'Point color',strength:'Point color strength'})[prop]||prop;add('point:'+prop,label,path);if(primary===o&&S.selPts.has(id))add('selected:point:'+prop,'Selected '+label.toLowerCase(),path,true);}
    else if(kind==='curve'){const label=prop.startsWith('hide_')?'Hidden edges':({start:'Stroke exposure start',end:'Stroke exposure end',repeats:'Profile repeats',offset:'Profile offset'})[prop]||prop;add('curves:'+label,label,path);const p=o.paths?.find(p=>p.id===id),shape=o.shapes?.find(s=>s.id===S.selShape);if(primary===o&&(shape?.paths.includes(id)||p?.pts.some(id=>S.selPts.has(id))))add('selected:curves:'+label,'Selected '+label.toLowerCase(),path,true);}
    else if(kind==='sh')add(path,'Shape '+prop,path);
    else add(path,CH_LABEL[path]||path,path);
  }
  return [...groups.values()];
}
function chanName(o, path) {
  const [kind, id, prop] = path.split(':');
  if (kind === 'bone') { const b = o.bones && o.bones.find((x) => x.id === id); return (b ? b.name : 'Bone') + ' ' + ({ a: 'angle', p: 'offset', s: 'stretch' }[prop] || prop); }
  if (kind === 'fx') { const e = o.fx.find((x) => x.id === id); return (e ? FX[e.type].label : 'Effect') + ' ' + prop; }
  if (kind === 'pt') return 'Point ' + id.slice(-4);
  if (kind === 'pv') return 'Point '+id.slice(-4)+' · '+({c:'curvature',hin:'Bézier in',hout:'Bézier out',width:'line width',alpha:'opacity',color:'color',strength:'color strength'}[prop]||prop);
  if (kind === 'curve') return 'Curve '+id.slice(-4)+' · '+(prop.startsWith('hide_')?'hidden edge':prop);
  if (kind === 'sh') return 'Shape ' + prop;
  return CH_LABEL[path] || path;
}
function rowFrames(o, paths) { const s = new Set(); for (const p of paths) { const c = o.ch[p]; if (c) c.keys.forEach((k) => s.add(k.f)); } return [...s].sort((a, b) => a - b); }

function timelineOwners() {
  const owners=[],seen=new Set();
  const add=o=>{if(o&&!seen.has(o.id)){seen.add(o.id);owners.push(o);}};
  if(S.camSel)add(S.doc.camera);else S.selLayers.forEach(id=>add(findLayer(id)));
  // Bone tools may edit the parent rig while its artwork remains selected.
  if(BONE_TOOLS.has(S.tool))add(activeBoneLayer());
  for(const id of [...TL.pins]) {const o=getOwner(id);if(o)add(o);else TL.pins.delete(id);}
  return S.doc.activeAction ? owners.filter(o=>actOwnsLayer(o)&&o.type!=='audio') : owners;
}
function buildRows() {
  const owners=timelineOwners(),rows=actActive()?[]:[{kind:'markers',h:18,paths:[]}];
  for(const o of owners) {
    const groups=channelGroups(o),paths=groups.filter(g=>!g.selected).flatMap(g=>g.paths);
    rows.push({kind:'layer',owner:o,label:o.name,depth:0,h:o.type==='audio'?44:20,paths:TL.consolidate?paths:[]});
    if(!TL.consolidate)for(const g of groups)rows.push({kind:'chan',owner:o,label:g.label,paths:g.paths,depth:0,h:20,gkey:g.key,selected:g.selected});
    if(!paths.length)rows.push({kind:'empty',owner:o,label:'No animation keys on this layer',paths:[],h:22});
  }
  if(!owners.length)rows.push({kind:'empty',label:'Select a layer in the Layers panel to see its animation',paths:[],h:28});
  const context=JSON.stringify(owners.map(o=>[o.id,channelGroups(o).map(g=>[g.key,g.paths])]).concat([TL.consolidate]));
  if(context!==TL.contextKey) {
    const old=TL.contextKey;TL.contextKey=context;
    const visible=new Set(rows.filter(r=>r.owner).flatMap(r=>r.paths.map(p=>r.owner.id+'|'+p)));
    S.selKeys=new Set([...S.selKeys].filter(k=>visible.has(k.split('|').slice(0,2).join('|'))));
    if(old)TL.scrollY=0;
  }
  // Rebind after undo/redo: never retain a replaced layer object in the graph.
  const active=TL.active&&rows.find(r=>r.kind==='chan'&&r.owner.id===TL.active.owner.id&&r.gkey===TL.active.gkey);
  let next=active;
  if(!next){const primary=S.camSel?'CAM':selLayer()?.id;next=rows.find(r=>r.kind==='chan'&&r.owner.id===primary&&r.selected)||rows.find(r=>r.kind==='chan'&&r.owner.id===primary)||rows.find(r=>r.kind==='chan');}
  TL.active=next?{owner:next.owner,paths:next.paths,gkey:next.gkey,label:next.label}:null;
  let y=0;for(const r of rows){r.y=y;y+=r.h;}TL.rows=rows;TL.totalH=y;return rows;
}
function selectVisibleTimelineKeys(){buildRows();S.selKeys=new Set();for(const r of TL.rows)if(r.owner)for(const p of r.paths)for(const k of r.owner.ch[p]?.keys||[])S.selKeys.add(kid(r.owner,p,k.f));requestDraw();}
function keyCurrentTimelinePose(){
  if(S.mode==='setup'||S.frame===0)return toast('Move to an animation frame before keying a pose','err');
  const rig=BONE_TOOLS.has(S.tool)?activeBoneLayer():null;
  const primary=selLayer();
  return edit('Key current pose',()=>{
    if(rig){const selected=new Set(selectedBoneIds().filter(id=>rig.bones.some(b=>b.id===id))),bones=rig.bones.filter(b=>!selected.size||selected.has(b.id));for(const b of bones)for(const p of ['a','p','s']){const path='bone:'+b.id+':'+p;setVal(rig,path,val(rig,path,S.frame),S.frame,true);}return;}
    if(primary?.type==='vector'&&['points','curvature'].includes(S.tool)){const points=S.selPts.size?[...S.selPts]:Object.keys(primary.pts);for(const id of points){const path='pt:'+id;if(primary.pts[id])setVal(primary,path,val(primary,path,S.frame),S.frame,true);}return;}
    for(const o of S.camSel?[S.doc.camera]:S.selLayers.map(id=>findLayer(id)).filter(Boolean)){for(const path of o.id==='CAM'?['x','y','zoom','roll','shake']:['x','y','z','rot','sx','sy','opacity'])setVal(o,path,val(o,path,S.frame),S.frame,true);}
  });
}
function renderTimelineContext(){
  const el=$('#tlcontext');if(!el)return;
  const owners=timelineOwners(),channels=TL.rows.filter(r=>r.kind==='chan');
  const html='<span class="tl-scope" title="Only selected and pinned owners are displayed">'+esc(owners.map(o=>o.name).join(' · ')||'No layer selected')+'</span>'+
    '<select id="tlChannel" aria-label="Timeline channel" title="Choose a channel; hover a timeline row to identify it"><option value="">'+(channels.length?'Choose channel':'No animated channels')+'</option>'+channels.map((r,i)=>'<option value="'+i+'" '+(TL.active&&TL.active.owner.id===r.owner.id&&TL.active.gkey===r.gkey?'selected':'')+'>'+esc(r.owner.name+' · '+r.label)+'</option>').join('')+'</select>'+
    '<button class="ib sm" id="tlPin" title="Keep the current selection visible when selecting another layer">Pin selection</button>'+
    '<button class="ib sm" id="tlUnpin" title="Remove all timeline pins">Clear pins ('+TL.pins.size+')</button>'+
    '<label><input type="checkbox" id="tlConsolidate" '+(TL.consolidate?'checked':'')+'> Consolidate keys</label>';
  if(el._content===html)return;el._content=html;el.innerHTML=html;
  $('#tlChannel').onchange=e=>{const r=e.target.value!==''&&channels[+e.target.value];if(r){TL.active={owner:r.owner,paths:r.paths,gkey:r.gkey,label:r.label};TL.scrollY=r.y;requestDraw();}};
  $('#tlPin').onclick=()=>{(S.camSel?['CAM']:S.selLayers).forEach(id=>TL.pins.add(id));requestDraw();};
  $('#tlUnpin').onclick=()=>{TL.pins.clear();requestDraw();};
  $('#tlConsolidate').onchange=e=>{TL.consolidate=e.target.checked;if(TL.consolidate)TL.mode='dope';renderTLBar();requestDraw();};
}
const fx2x = (f) => TL.NAMEW + 8 + f * TL.ppf - TL.scrollX;
const x2f = (x) => (x - TL.NAMEW - 8 + TL.scrollX) / TL.ppf;
const kid = (o, path, f) => `${o.id}|${path}|${f}`;

// ---------- drawing ----------
function renderTimeline() {
  const cv = TL.cv, ctx = TL.ctx, r = cv.getBoundingClientRect(), dpr = (TL.dpr = Math.min(2, window.devicePixelRatio || 1));
  const W = Math.max(10, Math.round(r.width * dpr)), Hh = Math.max(10, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width, h = r.height, d = { ...S.doc, end:timelineEnd(), markers:timelineMarkers() };
  const contextTheme=timelineContextTheme();
  ctx.fillStyle = contextTheme.background; ctx.fillRect(0, 0, w, h);
  buildRows();
  renderTimelineContext();
  TL.scrollY = clamp(TL.scrollY, 0, Math.max(0, TL.totalH - (h - TL.RULER) + 20));
  const top = TL.RULER;
  // frame area background: work range
  const xe = fx2x(d.end + 1);
  ctx.fillStyle = contextTheme.range; ctx.fillRect(TL.NAMEW, top, Math.max(0, Math.min(w, xe) - TL.NAMEW), h - top);
  // grid lines
  const step = TL.ppf < 4 ? 10 : TL.ppf < 8 ? 5 : 1;
  const f0 = Math.max(0, Math.floor(x2f(TL.NAMEW))), f1 = Math.ceil(x2f(w));
  for (let f = f0; f <= f1; f++) {
    const x = Math.round(fx2x(f)) + 0.5;
    if (f % d.fps === 0) { ctx.fillStyle = 'rgba(255,255,255,.07)'; ctx.fillRect(x - 0.5, top, 1, h - top); }
    else if (f % step === 0 && TL.ppf >= 6) { ctx.fillStyle = 'rgba(255,255,255,.025)'; ctx.fillRect(x - 0.5, top, 1, h - top); }
  }
  if (TL.mode === 'curves') drawCurves(ctx, w, h);
  else drawRows(ctx, w, h);
  if (S.mode === 'setup') {
    ctx.fillStyle = 'rgba(22,24,29,.55)'; ctx.fillRect(TL.NAMEW, top, w - TL.NAMEW, h - top);
    ctx.fillStyle = '#ff8a3d'; ctx.font = '600 12px Inter, system-ui'; ctx.textBaseline = 'middle';
    ctx.fillText('SETUP MODE — the rest pose has no keys. Click the timeline or press Tab to animate.', TL.NAMEW + 24, top + 40);
  }
  // ruler
  ctx.fillStyle = contextTheme.ruler; ctx.fillRect(0, 0, w, top);
  ctx.fillStyle = '#9099a8'; ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textBaseline = 'middle';
  const lab = TL.ppf < 3 ? d.fps : TL.ppf < 7 ? 10 : TL.ppf < 24 ? 5 : 1;
  for (let f = f0; f <= f1; f++) {
    const x = fx2x(f);
    if (x < TL.NAMEW) continue;
    if (f % lab === 0) { ctx.fillRect(x, top - 8, 1, 8); ctx.fillText(String(f), x + 2, 9); }
    else if (TL.ppf >= 5) ctx.fillRect(x, top - 4, 1, 4);
  }
  // markers in ruler
  for (const m of d.markers) {
    const x = fx2x(m.f); if (x < TL.NAMEW) continue;
    ctx.fillStyle = m.color || '#5ccf8a'; ctx.beginPath(); ctx.moveTo(x - 5, top - 10); ctx.lineTo(x + 5, top - 10); ctx.lineTo(x, top - 3); ctx.fill();
  }
  // Full-width ruler; layer selection lives in the main Layers panel.
  ctx.fillStyle = '#343a46'; ctx.fillRect(0, top - 1, w, 1);
  // playhead
  const px = fx2x(S.frame);
  if (px >= TL.NAMEW) {
    ctx.fillStyle = 'rgba(255,93,93,.22)'; ctx.fillRect(px, top, Math.max(1, TL.ppf), h - top);
    ctx.fillStyle = '#ff5d5d'; ctx.fillRect(px, 0, 1.5, h);
    ctx.beginPath(); ctx.roundRect(px - 13, 2, 27 + String(S.frame).length * 2, 14, 3); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '600 10px Inter, system-ui'; ctx.textAlign = 'center'; ctx.fillText(String(S.frame), px + 1 + String(S.frame).length, 9); ctx.textAlign = 'left';
  }
  // end marker
  if (xe > TL.NAMEW) { ctx.fillStyle = '#ff8a3d'; ctx.fillRect(xe, top, 1, h - top); }
  // marquee
  if (TL.drag && TL.drag.mode === 'marquee' && TL.drag.r) { const [x0, y0, x1, y1] = TL.drag.r; ctx.strokeStyle = '#fff'; ctx.setLineDash([3, 3]); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]); }
  const fr = $('#tlFrame'); if (fr && document.activeElement !== fr) fr.value = S.frame;
}
function drawRows(ctx, w, h) {
  const top = TL.RULER, d = { ...S.doc, markers:timelineMarkers() };
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, w, h - top); ctx.clip();
  for (const r of TL.rows) {
    const y = top + r.y - TL.scrollY; if (y + r.h < top || y > h) continue;
    const isSel = r.kind === 'layer' && (r.owner.id === 'CAM' ? S.camSel : S.selLayers.includes(r.owner.id));
    const isAct = r.kind === 'chan' && TL.active && TL.active.owner === r.owner && TL.active.gkey === r.gkey;
    ctx.fillStyle = isSel ? 'rgba(61,111,214,.35)' : isAct ? 'rgba(255,138,61,.14)' : r.kind === 'chan' ? 'rgba(0,0,0,.12)' : 'transparent';
    ctx.fillRect(0, y, w, r.h);
    ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(0, y + r.h - 1, w, 1);
    if (r.kind === 'markers') {
      ctx.fillStyle = '#636c7b'; ctx.font = '10px Inter, system-ui'; ctx.textBaseline = 'middle'; 
      for (const m of d.markers) { const x = fx2x(m.f); if (x < TL.NAMEW - 2) continue; ctx.fillStyle = m.color || '#5ccf8a'; ctx.fillRect(x, y + 2, 2, r.h - 4); ctx.fillText(m.name, x + 4, y + r.h / 2); }
      continue;
    }
    const L = r.owner;
    if(r.kind==='empty'){ctx.fillStyle='#9099a8';ctx.font='11px Inter, system-ui';ctx.textBaseline='middle';ctx.fillText(r.label,10,y+r.h/2);continue;}
    if(r.kind==='layer'&&!TL.consolidate){ctx.fillStyle='#b9c4d4';ctx.font='600 11px Inter, system-ui';ctx.textBaseline='middle';ctx.fillText(r.owner.name+(TL.pins.has(r.owner.id)?' · pinned':''),8,y+10);}
    // audio waveform
    if (r.kind === 'layer' && L.type === 'audio') drawWave(ctx, L, y, r.h);
    // keys
    const frames = rowFrames(L, r.paths);
    const cy = y + Math.min(r.h, 20) / 2;
    for (const f of frames) {
      const x = fx2x(f) + TL.ppf / 2; if (x < TL.NAMEW || x > w + 6) continue;
      let sel = false, interp = 'smooth', kk = null;
      for (const p of r.paths) { const k = L.ch[p] && L.ch[p].keys.find((k) => k.f === f); if (k) { interp = k.i || 'smooth'; if (!kk || k.lb || k.hold) kk = k; if (S.selKeys.has(kid(L, p, f))) sel = true; } }
      const s = r.kind === 'chan' ? 4.5 : 5.5;
      if (kk && kk.hold) { ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, cy - 1.5, kk.hold * TL.ppf, 3); }
      if (kk && kk.lb) { ctx.strokeStyle = kk.lb; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, cy, s + 3, 0, Math.PI * 2); ctx.stroke(); }
      if (interp === 'cycle') { ctx.fillStyle = INTERP_COLORS.cycle; ctx.font = '11px Inter, system-ui'; ctx.textBaseline = 'middle'; ctx.fillText('↻', x + s + 2, cy); }
      if (kk && (kk.iv > 1 || kk.stg)) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = '9px Inter, system-ui'; ctx.textBaseline = 'middle'; ctx.fillText(kk.stg ? 'stg' : '×' + kk.iv, x + s + 2, cy + 7); }
      ctx.beginPath(); ctx.moveTo(x, cy - s); ctx.lineTo(x + s, cy); ctx.lineTo(x, cy + s); ctx.lineTo(x - s, cy); ctx.closePath();
      ctx.fillStyle = sel ? '#ffffff' : INTERP_COLORS[interp] || '#7fb4ff'; ctx.fill();
      ctx.strokeStyle = sel ? '#ff8a3d' : 'rgba(0,0,0,.6)'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke();
      if (r.paths.includes('sw')) {
        const k = L.ch.sw.keys.find((k) => k.f === f), c = k && L.children && L.children.find((c) => c.id === k.v);
        if (c && TL.ppf >= 5) { ctx.fillStyle = '#ffd166'; ctx.font = '10px Inter, system-ui'; ctx.fillText(c.name, x + 7, cy); }
      }
    }
  }
  ctx.restore();
}
function audioPeaks(m) {
  if (m.peaks || !m.buffer) return m.peaks;
  const ch = m.buffer.getChannelData(0), per = Math.floor(m.buffer.sampleRate / 200), n = Math.ceil(ch.length / per), pk = new Float32Array(n);
  for (let i = 0; i < n; i++) { let mx = 0; for (let j = i * per, e = Math.min(ch.length, j + per); j < e; j++) { const v = Math.abs(ch[j]); if (v > mx) mx = v; } pk[i] = mx; }
  return (m.peaks = pk);
}
function drawWave(ctx, L, y, h) {
  const m = S.media[L.media]; if (!m || !m.buffer) return;
  const pk = audioPeaks(m), fps = S.doc.fps, x0 = fx2x(L.offset), dur = m.buffer.duration, x1 = fx2x(L.offset + dur * fps);
  ctx.fillStyle = 'rgba(92,207,138,.12)'; ctx.fillRect(Math.max(TL.NAMEW, x0), y + 2, Math.max(0, x1 - Math.max(TL.NAMEW, x0)), h - 4);
  ctx.fillStyle = L.mute ? '#636c7b' : '#5ccf8a';
  const cy = y + h / 2 + 2, amp = (h - 10) / 2, g = val(L, 'gain', S.frame);
  for (let x = Math.max(TL.NAMEW, Math.floor(x0)); x < Math.min(TL.cv.width / TL.dpr, x1); x++) {
    const t = (x2f(x) - L.offset) / fps, i = Math.floor(t * 200); if (i < 0 || i >= pk.length) continue;
    const v = Math.min(1, pk[i] * g) * amp; ctx.fillRect(x, cy - v, 1, Math.max(1, v * 2));
  }
}

// ---------- curve editor ----------
function curveTargets() {
  const a = TL.active; if (!a) return [];
  const out = [];
  for (const p of a.paths) {
    const ch = a.owner.ch[p]; if (!ch || !ch.keys.length) continue;
    const v0 = ch.keys[0].v;
    if (typeof v0 === 'number') out.push({ path: p, comp: -1 });
    else if (Array.isArray(v0)) v0.forEach((_, i) => out.push({ path: p, comp: i }));
  }
  return out.slice(0, 12);
}
const CURVE_COLORS = ['#ff6b6b', '#4dabf7', '#69db7c', '#ffd43b', '#da77f2', '#ff922b', '#3bc9db', '#f783ac'];
function curveRange(ts) {
  let lo = Infinity, hi = -Infinity; const o = TL.active.owner;
  for (const t of ts) for (let f = 0; f <= timelineEnd(); f += Math.max(1, Math.round(timelineEnd() / 200))) { let v = val(o, t.path, f); if (t.comp >= 0) v = v[t.comp]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (const t of ts) for (const k of o.ch[t.path].keys) { const v = t.comp >= 0 ? k.v[t.comp] : k.v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; return [lo - pad, hi + pad];
}
function drawCurves(ctx, w, h) {
  const top = TL.RULER, ts = curveTargets();
  ctx.fillStyle = '#9099a8'; ctx.font = '11px Inter, system-ui'; ctx.textBaseline = 'middle';
  if (!ts.length) { ctx.fillText('Choose a channel above or select a key in the Dope Sheet.', TL.NAMEW + 16, top + 30); return; }
  const o = TL.active.owner, [lo, hi] = curveRange(ts);
  const vy = (v) => top + 10 + (1 - (v - lo) / (hi - lo)) * (h - top - 20);
  TL.curveView = { lo, hi, vy, inv: (y) => lo + (1 - (y - top - 10) / (h - top - 20)) * (hi - lo) };
  TL.bzHandles = [];
  // value grid
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  for (let i = 0; i <= 4; i++) { const v = lo + ((hi - lo) * i) / 4, y = vy(v); ctx.beginPath(); ctx.moveTo(TL.NAMEW, y); ctx.lineTo(w, y); ctx.stroke(); ctx.fillStyle = '#636c7b'; ctx.fillText(round(v, 2), TL.NAMEW + 4, y - 6); }
  ts.forEach((t, i) => {
    const col = CURVE_COLORS[i % CURVE_COLORS.length];
    ctx.fillStyle = col; ctx.fillText(`${chanName(o, t.path)}${t.comp >= 0 ? (t.comp ? ' · y' : ' · x') : ''}`, 10, top + 12 + i * 16);
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath();
    const fA = Math.max(0, Math.floor(x2f(TL.NAMEW))), fB = Math.ceil(x2f(w));
    for (let f = fA; f <= fB; f += 0.25) { let v = val(o, t.path, f); if (t.comp >= 0) v = v[t.comp]; const x = fx2x(f) + TL.ppf / 2, y = vy(v); f === fA ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();
    const kl = o.ch[t.path].keys;
    for (let j = 0; j < kl.length - 1; j++) {
      const a = kl[j], b = kl[j + 1]; if (a.i !== 'bezier') continue;
      const av = t.comp >= 0 ? a.v[t.comp] : a.v, bv = t.comp >= 0 ? b.v[t.comp] : b.v, dv = bv - av, span = b.f - a.f, bz = a.bz || [0.33, 0, 0.67, 1];
      if (typeof av !== 'number' || Math.abs(dv) < 1e-9) continue;
      const ax = fx2x(a.f) + TL.ppf / 2, ay = vy(av), bx = fx2x(b.f) + TL.ppf / 2, by = vy(bv);
      const h1 = [fx2x(a.f + bz[0] * span) + TL.ppf / 2, vy(av + bz[1] * dv)], h2 = [fx2x(a.f + bz[2] * span) + TL.ppf / 2, vy(av + bz[3] * dv)];
      ctx.strokeStyle = 'rgba(255,169,77,.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(h1[0], h1[1]); ctx.moveTo(bx, by); ctx.lineTo(h2[0], h2[1]); ctx.stroke();
      ctx.fillStyle = '#ffa94d'; for (const h of [h1, h2]) ctx.fillRect(h[0] - 3.5, h[1] - 3.5, 7, 7);
      TL.bzHandles.push({ o, path: t.path, comp: t.comp, f: a.f, which: 1, x: h1[0], y: h1[1], av, dv, span }, { o, path: t.path, comp: t.comp, f: a.f, which: 2, x: h2[0], y: h2[1], av, dv, span });
    }
    for (const k of o.ch[t.path].keys) {
      const v = t.comp >= 0 ? k.v[t.comp] : k.v, x = fx2x(k.f) + TL.ppf / 2, y = vy(v), sel = S.selKeys.has(kid(o, t.path, k.f));
      ctx.fillStyle = sel ? '#fff' : col; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, sel ? 5 : 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  });
}

// ---------- interaction ----------
function rowAt(y) { const yy = y - TL.RULER + TL.scrollY; return TL.rows.find((r) => yy >= r.y && yy < r.y + r.h) || null; }
function keyHit(r, x) {
  if (!r || r.kind === 'markers') return null;
  const frames = rowFrames(r.owner, r.paths);
  let best = null, bd = 7;
  for (const f of frames) { const d = Math.abs(fx2x(f) + TL.ppf / 2 - x); if (d < bd) { bd = d; best = f; } }
  return best;
}
function selectRowKeys(r, f, add) {
  if (!add) S.selKeys = new Set();
  for (const p of r.paths) if (keyAt(r.owner, p, f)) S.selKeys.add(kid(r.owner, p, f));
}
function parseKid(k) { const [oid, path, f] = k.split('|'); return { o: getOwner(oid), path, f: +f }; }
function moveSelectedKeys(base, df) {
  // base: [{oid,path,f,k}] snapshot at drag start; doc already restored to drag-start state
  const items = base.map((b) => ({ ...b, o: getOwner(b.oid) })).filter((b) => b.o && b.o.ch[b.path] && (!actActive() || actOwnsLayer(b.o)));
  for (const b of items) { const ch = b.o.ch[b.path]; ch.keys = ch.keys.filter((k) => k.f !== b.f); }
  const ns = new Set();
  for (const b of items) {
    const ch = b.o.ch[b.path], nf = Math.max(0, b.f + df);
    ch.keys = ch.keys.filter((k) => k.f !== nf); ch.keys.push({ ...clone(b.k), f: nf }); ch.keys.sort((a, c) => a.f - c.f);
    ns.add(kid(b.o, b.path, nf));
  }
  S.selKeys = ns;
}
function deleteSelectedKeys() {
  buildRows();
  if (!S.selKeys.size) return false;
  edit('Delete keys', () => {
    for (const k of S.selKeys) {
      const { o, path, f } = parseKid(k); if (!o || !o.ch[path]) continue;
      const ch = o.ch[path];
      if (actActive()) { ch.keys = ch.keys.filter(x=>x.f!==f); if(!ch.keys.length)delete o.ch[path]; continue; }
      if (ch.keys.length <= 1 || (f === 0 && ch.keys.length > 1 && false)) { baseSet(o, path, ch.keys[0].v); delete o.ch[path]; continue; }
      ch.keys = ch.keys.filter((x) => x.f !== f);
      if (ch.keys.length === 1) { baseSet(o, path, ch.keys[0].v); delete o.ch[path]; }
    }
    S.selKeys = new Set();
  });
  return true;
}
function selectedKeyObjs() { const out = []; for (const k of S.selKeys) { const { o, path, f } = parseKid(k); const key = o && keyAt(o, path, f); if (key) out.push({ o, path, key }); } return out; }
function setInterpSelected(it) {
  buildRows();
  if (!S.selKeys.size) return toast('Select keys first');
  if (it === 'cycle') return keyframePanel('cycle');
  edit('Set interpolation', () => { for (const { key } of selectedKeyObjs()) { key.i = it; if (it === 'bezier' && !key.bz) key.bz = [0.33, 0, 0.67, 1]; } });
  if (it === 'bezier') toast('Bézier: open Curves and drag the square handles to shape the motion', 'ok');
}
// Keyframe panel (Moho: Window ▸ Keyframe, Ctrl+Alt+E): interpolation and timing of the selected keys
async function keyframePanel(focus) {
  const ks = selectedKeyObjs(); if (!ks.length) return toast('Select keys in the timeline first (click a key, Shift-click or drag a box for more)');
  const k0 = ks[0].key, ch0 = ks[0].o.ch[ks[0].path], firstF = ch0.keys[0].f, prevK = ch0.keys.filter((q) => q.f < k0.f).pop();
  const it0 = focus === 'cycle' ? 'cycle' : k0.i || 'smooth', bz = k0.bz || [0.33, 0, 0.67, 1];
  const num = (n, v, a = '') => `<input type="number" name="${n}" value="${v}" ${a}>`;
  const pr = modal(`Keyframe · ${ks.length} key${ks.length > 1 ? 's' : ''} at frame${new Set(ks.map((q) => q.key.f)).size > 1 ? 's ' + [...new Set(ks.map((q) => q.key.f))].join(', ') : ' ' + k0.f}`, `<div class="form kfp">
    <label>Interpolation</label><select name="i">${INTERPS.map(([k, n]) => `<option value="${k}" ${k === it0 ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <label></label><div class="note" id="kfHelp" style="margin:0">${esc(INTERP_HELP[it0] || '')}</div>
    <label title="Normalized handles of the curve leaving this key: x = time 0–1, y = value 0–1 (beyond 0–1 overshoots)">Bézier handles</label><div class="row4">${num('x1', bz[0], 'step="0.05" min="0" max="1"')}${num('y1', bz[1], 'step="0.05"')}${num('x2', bz[2], 'step="0.05" min="0" max="1"')}${num('y2', bz[3], 'step="0.05"')}</div>
    <label>Noise</label><div class="row2"><span>amount ${num('na', k0.na ?? 10, 'step="1" min="0"')}</span><span>frames per wiggle ${num('nf', k0.nf ?? 3, 'step="0.5" min="0.5"')}</span></div>
    <label>Cycle back to</label><div class="row2"><select name="cm"><option value="abs" ${k0.cm !== 'rel' ? 'selected' : ''}>Absolute: frame</option><option value="rel" ${k0.cm === 'rel' ? 'selected' : ''}>Relative: frames back</option></select>${num('cy', k0.cy ?? (k0.cm === 'rel' ? k0.f - firstF : firstF), 'step="1" min="0"')}</div>
    <label title="Stay on this key's value for this many frames before moving towards the next key">Hold</label><span>${num('hold', k0.hold || 0, 'step="1" min="0"')} frames</span>
    <label title="Show a new in-between only every N frames — 2 = animation on twos at the project frame rate">Interval</label><span>${num('iv', k0.iv || 1, 'step="1" min="1"')} frame(s)</span>
    <label title="Uneven stair-step timing">Stagger</label><label style="text-align:left"><input type="checkbox" name="stg" ${k0.stg ? 'checked' : ''}> stair-step the motion</label>
    <label title="Colour only — helps you find keys; never changes the motion">Label</label><select name="lb">${LABEL_COLORS.map(([c, n]) => `<option value="${c}" ${c === (k0.lb || '') ? 'selected' : ''}>${n}</option>`).join('')}</select>
    </div><div class="note">Applies to every selected key. Cycle example: keys at 0 (arm down), 12 (up), 24 (down) — set the key at 24 to Cycle, back to frame 0 (absolute) or 24 frames back (relative), and it repeats without extra keys.${prevK ? '' : ''}</div>`,
    [{ label: 'Cancel', value: false }, { label: 'Apply', value: true, pri: true }], 'kfpanel');
  const isel = $('#modal select[name=i]'); if (isel) isel.onchange = () => { $('#kfHelp').textContent = INTERP_HELP[isel.value] || ''; };
  const r = await pr;
  if (!r || !r.v) return;
  const d = r.data;
  edit('Keyframe settings', () => {
    for (const { key } of ks) {
      key.i = d.i;
      if (d.i === 'bezier') key.bz = [clamp(+d.x1, 0, 1), +d.y1, clamp(+d.x2, 0, 1), +d.y2]; else delete key.bz;
      if (d.i === 'noisy') { key.na = Math.max(0, +d.na); key.nf = Math.max(0.5, +d.nf); } else { delete key.na; delete key.nf; }
      if (d.i === 'cycle') { key.cm = d.cm; key.cy = Math.max(0, Math.round(+d.cy)); } else { delete key.cm; delete key.cy; }
      if (+d.hold > 0) key.hold = Math.round(+d.hold); else delete key.hold;
      if (+d.iv > 1) key.iv = Math.round(+d.iv); else delete key.iv;
      if (d.stg) key.stg = true; else delete key.stg;
      if (d.lb) key.lb = d.lb; else delete key.lb;
    }
  });
  if (d.i === 'cycle') { const bad = ks.filter(({ key }) => !(key.f - (d.cm === 'rel' ? key.f - +d.cy : +d.cy) > 0)); if (bad.length) toast('The cycle target must be earlier than the key — that key just holds', 'err'); }
}
// right-click on an empty spot of a channel: record its current value as a key
function addKeysAt(r, f) {
  const o = r.owner; let paths = r.paths.filter((p) => o.ch[p]);
  if (!paths.length) paths = o.id === 'CAM' ? ['x', 'y', 'zoom', 'roll'] : ['x', 'y', 'rot', 'sx', 'sy'];
  edit('Add keyframe', () => {
    for (const p of paths) {
      const v = val(o, p, f); if (v === undefined) continue;
      if (!o.ch[p]) { o.ch[p] = { keys: [] }; if (f !== 0) setKey(o.ch[p], 0, baseGet(o, p), DISCRETE(p) ? 'step' : undefined); }
      setKey(o.ch[p], f, v, DISCRETE(p) ? 'step' : undefined);
    }
    S.selKeys = new Set(paths.filter((p) => o.ch[p]).map((p) => kid(o, p, f)));
  });
}
function copyKeys() {
  buildRows();
  if (!S.selKeys.size) return false;
  const items = [...S.selKeys].map(parseKid).filter((x) => x.o);
  const f0 = Math.min(...items.map((x) => x.f));
  TL.clip = items.map((x) => ({ oid: x.o.id, path: x.path, df: x.f - f0, k: clone(keyAt(x.o, x.path, x.f)) })).filter((x) => x.k);
  toast(`Copied ${TL.clip.length} key(s)`); return true;
}
function pasteKeys() {
  if (!TL.clip || !TL.clip.length) return false;
  const sel = selLayer();
  edit('Paste keys', () => {
    const ns = new Set();
    for (const c of TL.clip) {
      let o = getOwner(c.oid);
      // Ordinary paste preserves the source owner, including pinned parent rigs.
      if (!o) continue;
      if(actActive()&&!actOwnsLayer(o))throw Error('Paste keys into a layer inside the active Action');
      const f = S.frame + c.df;
      if (!o.ch[c.path]) { o.ch[c.path] = { keys: [] }; if (f !== 0) setKey(o.ch[c.path], 0, baseGet(o, c.path)); }
      setKey(o.ch[c.path], f, c.k.v, c.k.i); ns.add(kid(o, c.path, f));
    }
    S.selKeys = ns;
  });
  return true;
}

function initTimeline() {
  TL.cv = $('#tlcanvas'); TL.ctx = TL.cv.getContext('2d'); UI.timeline = renderTimeline;
  const pos = (e) => { const r = TL.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  TL.cv.addEventListener('pointerdown', (e) => {
    TL.cv.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    if (S.playing) stopPlay();
    if (y < TL.RULER) { // ruler scrub
      if (x > TL.NAMEW) { TL.drag = { mode: 'scrub' }; setFrame(Math.max(0, Math.floor(x2f(x)))); scrubAudio(); }
      return;
    }
    if (TL.mode === 'curves') return curveDown(e, x, y);
    const r = rowAt(y);
    if (x < TL.NAMEW) { // reserved (the timeline has no layer-tree column)
      if (!r || r.kind === 'markers') return;
      if (r.kind === 'layer') {
        const L = r.owner;
        if (L.id === 'CAM') { S.camSel = true; S.selLayers = []; setTab('props'); }
        else {
          S.camSel = false;
          const ind = 8 + r.depth * 12;
          if (L.children && x < ind + 12) { L.open = !L.open; refreshAll(); return; }
          if (e.shiftKey || e.ctrlKey) S.selLayers = S.selLayers.includes(L.id) ? S.selLayers.filter((i) => i !== L.id) : [...S.selLayers, L.id];
          else S.selLayers = [L.id];
        }
        TL.active = null;
      } else { TL.active = { owner: r.owner, paths: r.paths, gkey: r.gkey, label: r.label }; }
      refreshAll(); return;
    }
    if (e.button === 2) return;
    if(r?.kind==='chan'){TL.active={owner:r.owner,paths:r.paths,gkey:r.gkey,label:r.label};requestDraw();}
    const f = keyHit(r, x);
    if (f !== null && r) {
      const any = r.paths.some((p) => S.selKeys.has(kid(r.owner, p, f)));
      if (e.shiftKey || e.ctrlKey) { if (any) r.paths.forEach((p) => S.selKeys.delete(kid(r.owner, p, f))); else selectRowKeys(r, f, true); }
      else if (!any) selectRowKeys(r, f, false);
      if (r.kind === 'chan') TL.active = { owner: r.owner, paths: r.paths, gkey: r.gkey, label: r.label };
      beginEdit('Move keys');
      const base = [...S.selKeys].map(parseKid).filter((q) => q.o).map((q) => ({ oid: q.o.id, path: q.path, f: q.f, k: clone(keyAt(q.o, q.path, q.f)) })).filter((q) => q.k);
      TL.drag = { mode: 'keys', x0: x, base, df: 0, snap: H.pending.s };
      requestDraw(); return;
    }
    TL.drag = { mode: 'marquee', x0: x, y0: y, add: e.shiftKey, base: new Set(S.selKeys), moved: false };
  });
  TL.cv.addEventListener('pointermove', (e) => {
    const d = TL.drag; const [x, y] = pos(e);
    if (!d) { const r=rowAt(y); TL.cv.title=r?.owner ? r.owner.name+' · '+r.label : 'Timeline'; return; }
    if (d.mode === 'scrub') { const f = clamp(Math.floor(x2f(x)), 0, 99999); if (f !== S.frame) { setFrame(f); scrubAudio(); } return; }
    if (d.mode === 'keys') {
      const df = Math.round((x - d.x0) / TL.ppf); if (df === d.df) return; d.df = df;
      const sk = S.selKeys, pts = S.selPts; restore(d.snap); S.selKeys = sk; S.selPts = pts; moveSelectedKeys(d.base, df); refreshAll(); return;
    }
    if (d.mode === 'curve') return curveMove(e, x, y);
    if (d.mode === 'bzh') {
      const q = d.h, key = q.o.ch[q.path] && q.o.ch[q.path].keys.find((k) => k.f === q.f); if (!key) return;
      const f = x2f(x - TL.ppf / 2), v = TL.curveView.inv(y), bz = (key.bz = (key.bz || [0.33, 0, 0.67, 1]).slice());
      bz[q.which === 1 ? 0 : 2] = round(clamp((f - q.f) / q.span, 0, 1), 3); bz[q.which === 1 ? 1 : 3] = round((v - q.av) / q.dv, 3);
      REV++; requestDraw(); return;
    }
    if (d.mode === 'marquee') {
      if (Math.hypot(x - d.x0, y - d.y0) < 3 && !d.moved) return; d.moved = true;
      const r = [Math.min(d.x0, x), Math.min(d.y0, y), Math.max(d.x0, x), Math.max(d.y0, y)]; d.r = r;
      const s = new Set(d.add ? d.base : []);
      for (const row of TL.rows) {
        if (!row.owner || !row.paths.length) continue;
        const ry = TL.RULER + row.y - TL.scrollY + Math.min(row.h, 20) / 2; if (ry < r[1] || ry > r[3]) continue;
        for (const f of rowFrames(row.owner, row.paths)) { const kx = fx2x(f) + TL.ppf / 2; if (kx >= r[0] && kx <= r[2]) row.paths.forEach((p) => keyAt(row.owner, p, f) && s.add(kid(row.owner, p, f))); }
      }
      S.selKeys = s; requestDraw();
    }
  });
  const up = (e) => {
    const d = TL.drag; TL.drag = null; if (!d) return;
    if (d.mode === 'keys' || d.mode === 'curve' || d.mode === 'bzh') commitEdit();
    if (d.mode === 'marquee' && !d.moved) { const [x, y] = pos(e); if (x > TL.NAMEW) { if (!d.add) S.selKeys = new Set(); setFrame(Math.max(0, Math.floor(x2f(x)))); const r = rowAt(y); if (r && r.kind === 'layer' && r.owner.id !== 'CAM' && !S.selLayers.includes(r.owner.id)) { S.selLayers = [r.owner.id]; S.camSel = false; } } }
    refreshAll();
  };
  TL.cv.addEventListener('pointerup', up); TL.cv.addEventListener('pointercancel', up);
  TL.cv.addEventListener('dblclick', (e) => {
    const [x, y] = pos(e);
    if (y < TL.RULER && x > TL.NAMEW) { if(actActive())return; const f = Math.max(0, Math.floor(x2f(x))); askText('Add marker', 'Marker name', 'Beat ' + (S.doc.markers.length + 1)).then((n) => { if (n) edit('Add marker', () => S.doc.markers.push({ id: uid('m'), f, name: n, color: '#5ccf8a' })); }); return; }
    const r = rowAt(y);
    if (x < TL.NAMEW && r && r.kind === 'layer' && r.owner.id !== 'CAM') { askText('Rename layer', 'Name', r.owner.name).then((n) => n && edit('Rename layer', () => (r.owner.name = n))); }
    if (r && r.kind === 'markers') { const m = timelineMarkers().find((m) => Math.abs(fx2x(m.f) - x) < 8); if (m) askText('Marker', 'Name (empty = delete)', m.name).then((n) => edit('Edit marker', () => { if (n === '') S.doc.markers = S.doc.markers.filter((q) => q !== m); else if (n) m.name = n; })); }
  });
  TL.cv.addEventListener('contextmenu', (e) => {
    e.preventDefault(); const [x, y] = pos(e), r = rowAt(y);
    let emptyAt = null;
    if (TL.mode === 'dope' && r && x > TL.NAMEW) { const f = keyHit(r, x); if (f !== null && !r.paths.some((p) => S.selKeys.has(kid(r.owner, p, f)))) selectRowKeys(r, f, false); if (f === null && r.owner && r.paths && (r.kind === 'chan' || r.kind === 'layer')) emptyAt = { r, f: Math.max(0, Math.floor(x2f(x))) }; }
    requestDraw();
    showMenu(e.clientX, e.clientY, [
      ...(emptyAt ? [{ label: `Add keyframe at frame ${emptyAt.f} — ${emptyAt.r.kind === 'chan' ? emptyAt.r.label : 'this layer'}`, run: () => addKeysAt(emptyAt.r, emptyAt.f) }, { sep: 1 }] : []),
      { hd: 'Interpolation' },
      ...INTERPS.map(([k, n]) => ({ label: k === 'cycle' ? 'Cycle…' : n, run: () => setInterpSelected(k), dot: INTERP_COLORS[k], dis: () => (S.selKeys.size ? false : 'Select keys first') })),
      { sep: 1 },
      { label: 'Keyframe settings… (hold, interval, stagger, label)', k: 'Ctrl+Alt+E', run: () => keyframePanel(), dis: () => (S.selKeys.size ? false : 'Select keys first') },
      { sep: 1 },
      { label: 'Copy keys', k: 'Ctrl+C', run: copyKeys }, { label: 'Paste keys at playhead', k: 'Ctrl+V', run: pasteKeys },
      { label: 'Delete keys', k: 'Del', run: deleteSelectedKeys },
      { label: 'Select all visible keys', run: selectVisibleTimelineKeys },
    ]);
  });
  TL.cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { const [x] = pos(e), f = x2f(x); TL.ppf = clamp(TL.ppf * Math.exp(-e.deltaY * 0.002), 1, 60); TL.scrollX = Math.max(0, f * TL.ppf - (x - TL.NAMEW - 8)); }
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) TL.scrollX = Math.max(0, TL.scrollX + (e.deltaX || e.deltaY));
    else TL.scrollY = Math.max(0, TL.scrollY + e.deltaY);
    requestDraw();
  }, { passive: false });
  new ResizeObserver(() => requestDraw()).observe(TL.cv);
  renderTLBar();
}
function curveDown(e, x, y) {
  const ts = curveTargets(); if (!ts.length || !TL.curveView) return;
  const o = TL.active.owner, cv = TL.curveView;
  const hh = (TL.bzHandles || []).find((q) => Math.hypot(q.x - x, q.y - y) < 7);
  if (hh) { beginEdit('Shape Bézier curve'); TL.drag = { mode: 'bzh', h: hh }; return; }
  for (const t of ts) for (const k of o.ch[t.path].keys) {
    const v = t.comp >= 0 ? k.v[t.comp] : k.v;
    if (Math.hypot(fx2x(k.f) + TL.ppf / 2 - x, cv.vy(v) - y) < 7) {
      if (!e.shiftKey) S.selKeys = new Set(); S.selKeys.add(kid(o, t.path, k.f));
      beginEdit('Edit curve key');
      TL.drag = { mode: 'curve', t, f0: k.f, v0: v, x0: x, y0: y, snap: H.pending.s, o };
      requestDraw(); return;
    }
  }
  setFrame(Math.max(0, Math.floor(x2f(x))));
}
function curveMove(e, x, y) {
  const d = TL.drag, cv = TL.curveView, pts = S.selPts; restore(d.snap); S.selPts = pts;
  const o = getOwner(d.o.id); const ch = o.ch[d.t.path]; const k = ch.keys.find((q) => q.f === d.f0); if (!k) return;
  const nv = d.v0 + (cv.inv(y) - cv.inv(d.y0)) * (e.altKey ? 0.1 : 1);
  const nf = e.shiftKey ? d.f0 : Math.max(0, d.f0 + Math.round((x - d.x0) / TL.ppf));
  if (d.t.comp >= 0) { k.v = k.v.slice(); k.v[d.t.comp] = round(nv, 3); } else k.v = round(nv, 3);
  if (nf !== d.f0 && !ch.keys.some((q) => q.f === nf)) { k.f = nf; ch.keys.sort((a, b) => a.f - b.f); }
  if (k.f === 0 && !actActive()) baseSet(o, d.t.path, k.v);
  TL.active.owner = o;
  S.selKeys = new Set([kid(o, d.t.path, k.f)]); requestDraw();
}

// ---------- timeline toolbar ----------
function renderTLBar() {
  const d = { ...S.doc, end:timelineEnd() };
  $('#tlbar').innerHTML = `
    <div class="grp"><button class="ib" id="tlFirst" title="First frame (Shift+,)">⏮</button><button class="ib" id="tlPrev" title="Previous frame (,)">◀</button>
    <button class="ib" id="tlPlay" title="Play / pause (Space)" style="min-width:34px">${S.playing ? '⏸' : '▶'}</button>
    <button class="ib" id="tlNext" title="Next frame (.)">▶|</button><button class="ib" id="tlLast" title="Last frame (Shift+.)">⏭</button></div>
    <div class="grp"><label>Frame <input type="number" id="tlFrame" min="0" value="${S.frame}"></label><label>of <input type="number" id="tlEnd" min="1" value="${d.end}" title="End frame"></label>
    <label>FPS <input type="number" id="tlFps" min="1" max="120" value="${d.fps}" style="width:44px"></label></div>
    <span class="sep" style="width:1px;height:18px;background:var(--line)"></span>
    <button class="ib toggle ${S.loop ? 'on' : ''}" id="tlLoop" title="Loop playback">⟳ Loop</button>
    <button class="ib toggle ${S.autoKey ? 'on' : ''}" id="tlAuto" title="Auto-key: edits at frames other than 0 create keyframes">● Auto-key</button>
    <label title="Interpolation for new keys">New keys <select id="tlInterp">${INTERPS.filter(([k]) => k !== 'cycle').map(([k, n]) => `<option value="${k}" ${k === S.defInterp ? 'selected' : ''}>${n}</option>`).join('')}<option value="copy" ${S.defInterp === 'copy' ? 'selected' : ''}>Copy previous key</option></select></label>
    <button class="ib toggle ${S.onion ? 'on' : ''}" id="tlOnion" title="Onion skins for the selected layer (past red, future green)">◐ Onion</button>
    <input type="number" id="tlOnionN" min="1" max="8" value="${S.onionN}" style="width:40px" title="Onion skin frames each side">
    <span class="sep" style="width:1px;height:18px;background:var(--line)"></span>
    <button class="ib toggle ${TL.mode === 'dope' ? 'on' : ''}" id="tlDope">Dope sheet</button><button class="ib toggle ${TL.mode === 'curves' ? 'on' : ''}" id="tlCurves">Curves</button>
    <span style="margin-left:auto;color:var(--faint)">${Math.floor(S.frame / d.fps)}s ${String(S.frame % d.fps).padStart(2, '0')}f · Ctrl+wheel zooms · right-click keys</span>`;
  const on = (id, ev, fn) => { const el = $('#' + id); if (el) el[ev] = fn; };
  on('tlFirst', 'onclick', () => setFrame(0)); on('tlLast', 'onclick', () => setFrame(d.end));
  on('tlPrev', 'onclick', () => setFrame(Math.max(0, S.frame - 1))); on('tlNext', 'onclick', () => setFrame(S.frame + 1));
  on('tlPlay', 'onclick', togglePlay);
  on('tlFrame', 'onchange', (e) => setFrame(Math.max(0, +e.target.value | 0)));
  on('tlEnd', 'onchange', (e) => edit('Set end frame', () => { const end=Math.max(1, +e.target.value | 0), action=actActive(); if(action)action.action.dur=end;else S.doc.end=end; }));
  on('tlFps', 'onchange', (e) => edit('Set fps', () => (S.doc.fps = clamp(+e.target.value | 0, 1, 120))));
  on('tlLoop', 'onclick', () => { S.loop = !S.loop; renderTLBar(); });
  on('tlAuto', 'onclick', () => { S.autoKey = !S.autoKey; renderTLBar(); toast(S.autoKey ? 'Auto-key ON' : 'Auto-key OFF — edits change static values unless the channel is already animated'); });
  on('tlInterp', 'onchange', (e) => (S.defInterp = e.target.value));
  on('tlOnion', 'onclick', () => { S.onion = !S.onion; renderTLBar(); requestDraw(); });
  on('tlOnionN', 'onchange', (e) => { S.onionN = clamp(+e.target.value | 0, 1, 8); requestDraw(); });
  on('tlDope', 'onclick', () => { TL.mode = 'dope'; renderTLBar(); requestDraw(); });
  on('tlCurves', 'onclick', () => { TL.consolidate = false; TL.mode = 'curves'; renderTLBar(); requestDraw(); });
}

// ---------- frame & playback ----------
function setFrame(f) {
  f = Math.max(0, Math.round(f));
  if (S.mode === 'setup' && f !== 0) { S.mode = 'animate'; updateModeUI(); renderTLBar(); toast('Animate mode — changes record keys at the playhead'); if (toolAvail(S.tool)) setTool(activeBoneLayer() ? 'bonemanip' : 'select'); }
  if (f !== S.frame) S.swPreview = {};
  S.frame = f;
  // keep playhead visible
  const x = fx2x(S.frame), w = TL.cv ? TL.cv.getBoundingClientRect().width : 0;
  if (w && (x < TL.NAMEW + 10 || x > w - 20)) TL.scrollX = Math.max(0, S.frame * TL.ppf - (w - TL.NAMEW) / 3);
  refreshAll();
}
const Play = { ac: null, nodes: [], t0: 0, f0: 0, raf: 0 };
function audioCtx() { if (!Play.ac) Play.ac = new (window.AudioContext || window.webkitAudioContext)(); if (Play.ac.state === 'suspended') Play.ac.resume(); return Play.ac; }
function audioLayers() { return actActive() ? [] : allLayers().filter((L) => L.type === 'audio' && L.vis && !L.mute && S.media[L.media] && S.media[L.media].buffer && !ancestors(L.id).some((a) => !a.vis)); }
function startAudio(fromF, dest) {
  const ac = audioCtx(), fps = S.doc.fps, now = ac.currentTime + 0.03;
  for (const L of audioLayers()) {
    const buf = S.media[L.media].buffer, off = (fromF - L.offset) / fps;
    if (off >= buf.duration) continue;
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = buf; g.gain.value = val(L, 'gain', fromF); src.connect(g); g.connect(dest || ac.destination);
    if (off >= 0) src.start(now, off); else src.start(now - off, 0);
    Play.nodes.push(src);
  }
  return now;
}
function stopAudio() { for (const n of Play.nodes) { try { n.stop(); } catch (e) {} } Play.nodes = []; }
function scrubAudio() {
  const ls = audioLayers(); if (!ls.length) return;
  const ac = audioCtx(), fps = S.doc.fps;
  for (const L of ls) {
    const buf = S.media[L.media].buffer, off = (S.frame - L.offset) / fps; if (off < 0 || off >= buf.duration) continue;
    const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = buf; g.gain.value = val(L, 'gain', S.frame) * 0.9;
    src.connect(g); g.connect(ac.destination); src.start(ac.currentTime, off, 1.4 / fps);
  }
}
function togglePlay() { S.playing ? stopPlay() : startPlay(); }
function startPlay() {
  if (S.playing) return;
  if (S.mode === 'setup') setMode('animate');
  S.swPreview = {};
  const end=timelineEnd();
  if (S.frame >= end) S.frame = 0;
  S.playing = true; Play.f0 = S.frame;
  const hasAudio = audioLayers().length > 0;
  Play.t0 = hasAudio ? startAudio(Play.f0) : performance.now() / 1000;
  Play.clock = hasAudio ? () => audioCtx().currentTime : () => performance.now() / 1000;
  let last = -1, fpsN = 0, fpsT = performance.now();
  const tick = () => {
    if (!S.playing) return;
    const t = Play.clock() - Play.t0;
    let f = Play.f0 + Math.floor(Math.max(0, t) * S.doc.fps);
    if (f > end) {
      if (S.loop) { stopAudio(); Play.f0 = 0; Play.t0 = hasAudio ? startAudio(0) : performance.now() / 1000; f = 0; }
      else { S.frame = end; stopPlay(); return; }
    }
    if (f !== last) { S.frame = f; last = f; fpsN++; drawNow(); }
    const now = performance.now(); if (now - fpsT > 1000) { Play.actualFps = fpsN; fpsN = 0; fpsT = now; const h = $('#hudInfo'); if (h) h.textContent += `  ·  ${Play.actualFps} fps`; }
    Play.raf = requestAnimationFrame(tick);
  };
  renderTLBar(); Play.raf = requestAnimationFrame(tick);
}
function stopPlay() { S.playing = false; cancelAnimationFrame(Play.raf); stopAudio(); renderTLBar(); refreshAll(); }
