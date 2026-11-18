/* Document reliability and bounded command execution. Installed before boot. */
let documentEpoch = 0;
function invalidateScene() { REV++; _simCache.clear(); }
function writeReason(o) {
  if (!o) return 'The target no longer exists';
  if (o.id === 'CAM') return null;
  const locked = [o, ...ancestors(o.id)].find(x => x.lock);
  return locked ? `“${locked.name}” is locked` : null;
}
function assertWritable(o) { const why = writeReason(o); if (why) throw new Error(why); }
function sceneSignature() { const d = {...S.doc}; delete d.ai; return JSON.stringify(d); }
function nameMentioned(text,name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(^|[^\\p{L}\\p{N}_])'+escaped+'(?=$|[^\\p{L}\\p{N}_])','iu').test(text);}
function flattenDocument(d) { const m = new Map(); walk(d.layers, l => m.set(l.id,l)); return m; }
function lockedDifference(before) {
  const old = JSON.parse(before), now = flattenDocument(S.doc);
  const clean = x => { const c = clone(x); const visit = l => { delete l.open; delete l.lock; delete l.vis; (l.children||[]).forEach(visit); }; visit(c); return JSON.stringify(c); };
  for (const l of flattenDocument(old).values()) if (l.lock && (!now.has(l.id) || clean(l) !== clean(now.get(l.id)))) return `“${l.name}” is locked`;
  const structure=l=>l.paths.map(p=>({id:p.id,pts:p.pts,closed:p.closed}));
  if(S.mode!=='setup')for(const l of flattenDocument(old).values()) {const n=now.get(l.id);if(l.type==='vector'&&n&&(JSON.stringify(Object.keys(l.pts))!==JSON.stringify(Object.keys(n.pts))||JSON.stringify(structure(l))!==JSON.stringify(structure(n))||l.shapes.length!==n.shapes.length))return 'Change drawing topology in Setup mode; Animate mode moves existing points';}
  return null;
}
const rawEdit = edit;
edit = function(label, fn) {
  const before = snapshot();
  return rawEdit(label, () => { const r=fn(); const why=lockedDifference(before); if(why) throw new Error(why); return r; });
};
const rawCommitEdit = commitEdit;
commitEdit = function() {
  if (H.pending) { const why=lockedDifference(H.pending.s); if(why) { cancelEdit(); toast(why,'err'); return false; } }
  const r=rawCommitEdit(); invalidateScene(); return r;
};

// Force-key and visibility channels have explicit setup values.
const rawMkLayer = mkLayer;
mkLayer = function(type,name) { const l=rawMkLayer(type,name); l.p.visible=true; return l; };

// Every model-generated command is checked for type, scope and bounded work.
const COMMAND_FIELDS = {
  jump:['target','start','dur','height'], bounce:['target','start','dur','n','height'],
  camshake:['start','dur','amp'], camzoom:['start','dur','zoom'], campan:['start','dur','dx','dy'], camdolly:['start','dur','distance'], camturn:['start','dur','pan','tilt','roll'],
  particles:['preset','target','start'], trail:['target','glow','color'], fx:['target','type','params'],
  fade:['target','start','dur','out'], rotate:['target','start','dur','deg'], scale:['target','start','dur','k'],
  move:['target','start','dur','dx','dy','abs'], dup:['target','n','spacing'], interp:['interp','targets'],
  vis:['target','on','start'], rename:['target','name'], clear:['target'], color:['target','color'],
  lipsync:[], swset:['target','child','start'], ppreset:['target','preset']
};
function requestScope(text) {
  const ids=new Set(S.selLayers);
  for(const l of allLayers()) if(l.name.length>1 && nameMentioned(text,l.name)) ids.add(l.id);
  for(const k of S.selKeys) { const q=parseKid(k); if(q.o && q.o.id!=='CAM') ids.add(q.o.id); }
  return [...ids];
}
validateCmd = function(c) {
  if(!c || typeof c!=='object' || !Object.hasOwn(COMMAND_FIELDS,c.op)) return 'Unknown command';
  const allowed=new Set([...COMMAND_FIELDS[c.op],'op','desc','_scope','_keys']);
  if(Object.keys(c).some(k=>!allowed.has(k))) return 'Unsupported command field';
  const numeric=(k,min,max,required=true,integer=false)=> c[k]===undefined ? (required ? `Missing ${k}` : null) : (typeof c[k]!=='number'||!Number.isFinite(c[k])||c[k]<min||c[k]>max||(integer&&!Number.isInteger(c[k])) ? `Invalid ${k}` : null);
  for(const [k,min,max,int] of [['start',0,100000,true],['dur',0,100000,true]]) { const e=numeric(k,min,max,false,int); if(e)return e; }
  if((c.start??S.frame)+(c.dur??0)>100000) return 'Animation exceeds frame limit';
  const targetless=['camshake','camzoom','campan','camdolly','camturn','interp','lipsync','particles'].includes(c.op);
  if(!targetless && (typeof c.target!=='string'||!c.target)) return 'A target is required';
  let targets=[];
  if(c.target) { const l=findLayer(c.target); if(!l)return 'Target layer no longer exists'; targets.push(l); }
  if(c.op==='interp') {
    if(!INTERPS.some(([id])=>id===c.interp)) return 'Unsupported interpolation';
    if(c.targets!=null && (!Array.isArray(c.targets)||!c.targets.length||c.targets.length>500)) return 'Invalid targets';
    const ids=c.targets || [...(c._keys||S.selKeys)].map(k=>parseKid(k).o?.id);
    if(!ids.length) return 'Select keyframes or target layers';
    for(const id of ids) { const o=getOwner(id); if(!o)return 'Target no longer exists'; targets.push(o); }
  }
  if(c.op==='color') { const l=targets[0]; if(l) targets.push(...allLayersIn(l)); }
  for(const l of targets) {
    const why=writeReason(l); if(why)return why;
    if(c._scope && l.id!=='CAM' && !c._scope.some(id=>id===l.id||ancestors(l.id).some(a=>a.id===id))) return 'Target is outside the request scope';
    const can=AI_CAN[l.type]; if(can&&!can.has(c.op))return `Unsupported command for ${l.type}`;
  }
  const ranges={height:[0,10000],amp:[0,1000],zoom:[0.01,100],dx:[-100000,100000],dy:[-100000,100000],deg:[-36000,36000],k:[0.001,100],n:[1,c.op==='dup'?50:100],spacing:[-10000,10000],distance:[-100000,100000],pan:[-36000,36000],tilt:[-178,178],roll:[-36000,36000]};
  for(const k of ['height','amp','zoom','dx','dy','deg','k','n','spacing','distance','pan','tilt','roll']) if(allowed.has(k)) { const e=numeric(k,...ranges[k],true,k==='n'); if(e)return e; }
  if(['jump','bounce','camshake','camzoom','campan','camdolly','camturn','fade'].includes(c.op) && (!(c.dur>0))) return 'Duration must be at least one frame';
  if(c.op==='bounce' && c.dur<c.n*2) return 'Bounces need at least two frames each';
  if(c.op==='move' && c.abs!=null && (!Array.isArray(c.abs)||c.abs.length!==2||c.abs.some(n=>!Number.isFinite(n)||Math.abs(n)>100000))) return 'Invalid coordinates';
  if((c.op==='color'||c.op==='trail'&&(c.glow||c.color!==undefined)) && !isColor(c.color))return 'Invalid color';
  if(c.op==='dup'&&JSON.stringify(targets[0]).length*c.n>16*1024*1024)return 'Duplication exceeds edit memory budget';
  if(c.op==='color'&&!['vector','text','group','bone','switch'].includes(targets[0]?.type)) return 'Recolor needs vector artwork or text';
  if(c.op==='vis'&&typeof c.on!=='boolean')return 'Visibility must be boolean';
  if(c.op==='fade'&&typeof c.out!=='boolean')return 'Fade direction must be boolean';
  if(c.op==='trail'&&typeof c.glow!=='boolean')return 'Glow must be boolean';
  if(c.op==='rename'&&(typeof c.name!=='string'||!c.name.trim()||c.name.length>200))return 'Invalid name';
  if(['particles','ppreset'].includes(c.op)&&!Object.hasOwn(PARTICLE_PRESETS,c.preset))return 'Unknown particle preset';
  if(c.op==='ppreset'&&targets[0]?.type!=='particle')return 'Select a particle layer';
  if(c.op==='swset'&&(targets[0]?.type!=='switch'||!targets[0].children.some(l=>l.id===c.child)))return 'Select a valid switch alternative';
  if(c.op==='fx') {
    if(!Object.hasOwn(FX,c.type))return 'Unknown effect';
    if(!c.params||typeof c.params!=='object'||Array.isArray(c.params))return 'Invalid effect parameters';
    for(const [k,v] of Object.entries(c.params)) {
      const d=FX[c.type].params[k]; if(!d)return 'Unknown effect parameter';
      if(typeof d[0]==='number' && (typeof v!=='number'||!Number.isFinite(v)||v<d[1]||v>d[2]))return 'Effect parameter out of range';
      if(typeof d[0]==='string'&&!isColor(v))return 'Invalid effect color';
      if(typeof d[0]==='boolean'&&typeof v!=='boolean')return 'Invalid effect toggle';
    }
  }
  return null;
};
const rawApplyCmd=applyCmd;
applyCmd=function(c) { const e=validateCmd(c); if(e)throw new Error(e);const selected=S.selKeys;if(c.op==='interp'&&c._keys)S.selKeys=new Set(c._keys);try{return rawApplyCmd(c);}finally{S.selKeys=selected;} };

// Untrusted project documents are validated before active state is replaced.
function validateProject(j) {
  if(!j||typeof j!=='object'||(j.format!==undefined&&j.format!==1))throw new Error('Unsupported project format');
  const d=j.doc||j;
  if(!d||!Array.isArray(d.layers)||!d.camera)throw new Error('Not a Popai project');
  const finite=(v,a,b)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
  const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(v);
  const safeTree=(v,depth=0)=>{if(depth>160)throw new Error('Document nesting limit');if(v&&typeof v==='object')for(const k of Object.keys(v)){if(['__proto__','prototype','constructor'].includes(k))throw new Error('Unsafe document property');safeTree(v[k],depth+1);}};safeTree(d);
  for(const m of Object.values(d.media||{}))if(!m||!['image','audio','video'].includes(m.type)||typeof m.url!=='string'||!(m.url.startsWith('data:'+m.type+'/')||m.url.startsWith('data:application/octet-stream;')))throw new Error('Invalid embedded media');
  if(!Array.isArray(d.styles)||!Array.isArray(d.palette)||!Array.isArray(d.markers))throw new Error('Invalid document collections');
  for(const s of d.styles)if(!safeId(s.id)||!isColor(s.fill)||!isColor(s.stroke)||!finite(s.width,0,10000))throw new Error('Invalid shared style');
  for(const s of d.styles)if(s.defines!==undefined&&(typeof s.defines!=='object'||Array.isArray(s.defines)||Object.entries(s.defines).some(([k,v])=>!['fill','stroke','width','fillOn','strokeOn'].includes(k)||typeof v!=='boolean')))throw new Error('Invalid style definition list');
  const styleIds=new Set(d.styles.map(s=>s.id));
  if(d.palette.some(c=>!isColor(c)))throw new Error('Invalid palette');
  if(!finite(d.w,16,8192)||!finite(d.h,16,8192)||!finite(d.fps,1,120)||!finite(d.end,1,100000)||!Number.isInteger(d.end))throw new Error('Invalid project dimensions or timing');
  if(d.v!==undefined&&d.v!==1)throw new Error('Unsupported document version');
  let count=0,points=0,keys=0; const ids=new Set(['CAM']);
  const channels=o=>{
    if(!o.ch||typeof o.ch!=='object'||Array.isArray(o.ch))throw new Error('Invalid channels');
    for(const [path,c]of Object.entries(o.ch)) {
      if(!c||!Array.isArray(c.keys))throw new Error('Invalid key channel');
      let last=-1;
      for(const k of c.keys) { if(++keys>1000000||!finite(k.f,0,100000)||!Number.isInteger(k.f)||k.f<=last)throw new Error('Invalid/duplicate key time'); last=k.f;
        if(k.i&&!INTERPS.some(([id])=>id===k.i))throw new Error('Invalid interpolation');
        const v=k.v;if(v===undefined||(v===null&&path!=='sw')||(v!==null&&typeof v==='object'&&!Array.isArray(v))||typeof v==='number'&&!Number.isFinite(v)||Array.isArray(v)&&(v.length!==2||v.some(n=>!Number.isFinite(n))))throw new Error('Invalid key value');
        if(path==='sw'&&v!==null&&!o.children?.some(l=>l.id===v))throw new Error('Switch key references missing drawing');
        if(typeof v==='number'&&Math.abs(v)>1e7)throw new Error('Key value exceeds range');
        if(path.startsWith('fx:')){const [,id,p]=path.split(':'),e=o.fx.find(e=>e.id===id),spec=e&&FX[e.type]?.params[p];if(!spec||typeof v!==typeof spec[0]||typeof v==='number'&&(v<spec[1]||v>spec[2]))throw new Error('Invalid animated effect parameter');}
      }
    }
  };
  const inspect=(ls,depth=0,rig=null)=>{if(depth>64)throw new Error('Layer nesting exceeds limit');
    for(const l of ls) {
      if(++count>5000||!l||!safeId(l.id)||ids.has(l.id)||!Object.hasOwn(LAYER_TYPES,l.type))throw new Error('Invalid/duplicate layer');ids.add(l.id);
      if(typeof l.name!=='string'||l.name.length>1000||!l.p||!Array.isArray(l.fx))throw new Error('Incomplete layer');
      for(const [k,v]of Object.entries(l.p))if(typeof v==='number'&&!finite(v,-1e9,1e9))throw new Error('Invalid property');
      l.p.visible??=true;
      if(l.label&&!isColor(l.label))throw new Error('Invalid label color');
      for(const p of ['x','y','z','rot','sx','sy','opacity','ox','oy'])if(!finite(l.p[p],-1e7,1e7))throw new Error('Invalid transform');
      if(l.type==='vector') {
        if(!l.pts||!Array.isArray(l.paths)||!Array.isArray(l.shapes))throw new Error('Invalid vector');
        for(const [id,p] of Object.entries(l.pts)){if(++points>500000||!safeId(id)||!finite(p.x,-1e7,1e7)||!finite(p.y,-1e7,1e7))throw new Error('Invalid point');}
        const paths=new Set(l.paths.map(p=>p.id));
        for(const p of l.paths)if(!safeId(p.id)||!Array.isArray(p.pts)||p.pts.some(id=>!l.pts[id]))throw new Error('Path references missing point');
        for(const s of l.shapes)if(!safeId(s.id)||!isColor(s.fill)||!isColor(s.stroke)||!finite(s.width,0,10000)||!Array.isArray(s.paths)||s.paths.some(id=>!paths.has(id)))throw new Error('Invalid shape or path reference');
      }
      for(const e of l.fx) {
        if(!e||!safeId(e.id)||!Object.hasOwn(FX,e.type)||!e.p)throw new Error('Unsupported effect');
        for(const [k,v]of Object.entries(e.p)){const p=FX[e.type].params[k];if(!p||typeof v!==typeof p[0]||typeof v==='number'&&(!Number.isFinite(v)||v<p[1]||v>p[2]))throw new Error('Invalid effect parameter');}
        for(const [k,p]of Object.entries(FX[e.type].params))e.p[k]??=p[0];
      }
      if(l.type==='bone') {
        if(!Array.isArray(l.bones)||l.bones.length>2000)throw new Error('Invalid skeleton');
        const bs=new Map(l.bones.map(b=>[b.id,b]));if(bs.size!==l.bones.length)throw new Error('Duplicate bone');
        for(const b of l.bones){if(!safeId(b.id)||!finite(b.x,-1e7,1e7)||!finite(b.y,-1e7,1e7)||!finite(b.a,-1e7,1e7)||!finite(b.len,0,1e6))throw new Error('Invalid bone');let q=b,seen=new Set();while(q){if(seen.has(q.id))throw new Error('Bone parenting cycle');seen.add(q.id);if(q.parent&&!bs.has(q.parent))throw new Error('Missing bone parent');q=bs.get(q.parent);}}
        sortBones(l);rig=l;
      }
      if(l.bindBone&&!rig?.bones.some(b=>b.id===l.bindBone))throw new Error('Missing binding bone');
      if(l.flexi!==undefined&&typeof l.flexi!=='boolean')throw new Error('Invalid flexi-binding setting');
      for(const k of ['ignoreSelector','hideEdit','flipH','flipV','immuneCam','maskNoStroke','maskExpand','depthSort','trueDistance','nested','autoBind'])if(l[k]!==undefined&&typeof l[k]!=='boolean')throw new Error('Invalid layer setting '+k);
      for(const k of ['tags','comment'])if(l[k]!==undefined&&(typeof l[k]!=='string'||l[k].length>10000))throw new Error('Invalid layer '+k);
      if(l.mask!==undefined&&!['none','hide','reveal','bottom','invert'].includes(l.mask))throw new Error('Invalid masking mode');
      if(l.maskRole!==undefined&&!['mask','nomask','add','addhide','sub','subhide','clear','clearhide'].includes(l.maskRole))throw new Error('Invalid masking role');
      if(Array.isArray(l.shapes))for(const s of l.shapes){if((s.styleId&&!styleIds.has(s.styleId))||(s.style2Id&&!styleIds.has(s.style2Id)))throw new Error('Shape references a missing style');if(s.over!==undefined&&(typeof s.over!=='object'||Array.isArray(s.over)||Object.entries(s.over).some(([k,v])=>!['fill','stroke','width','fillOn','strokeOn'].includes(k)||typeof v!=='boolean')))throw new Error('Invalid style override');}
      if(Array.isArray(l.shapes))for(const s of l.shapes)if(s.liquid!==undefined&&!['add','sub','clip'].includes(s.liquid))throw new Error('Invalid liquid shape operation');else if(s.blend!==undefined&&!(typeof s.blend==='number'&&s.blend>=0&&s.blend<=100))throw new Error('Invalid liquid blend');
      if(l.flexiBones!==undefined&&(!Array.isArray(l.flexiBones)||l.flexiBones.length>2000||l.flexiBones.some(id=>!rig?.bones.some(b=>b.id===id))))throw new Error('Invalid flexi-binding bones');
      if(l.pts)for(const p of Object.values(l.pts))if(p.b&&(!Array.isArray(p.b)||p.b.some(w=>!Array.isArray(w)||!rig?.bones.some(b=>b.id===w[0])||!finite(w[1],0,1))))throw new Error('Invalid point binding');
      if(isContainer(l)){if(!Array.isArray(l.children))throw new Error('Missing child layers');inspect(l.children,depth+1,rig);}
      channels(l);
    }
  };
  inspect(d.layers);channels(d.camera);
  if(!d.camera.p||d.camera.id!=='CAM')throw new Error('Invalid camera');
  for(const v of Object.values(d.camera.p))if(!finite(v,-1e7,1e7))throw new Error('Invalid camera value');
  d.ai={log:[]}; // Saved display HTML is never trusted or executed on import.
  return d;
}

// Preserve world placement for supported static 2D reparenting; reject ambiguous animated moves.
function reparentLayerSafe(l,target,where) {
  assertWritable(l);assertWritable(target);
  const dest=where==='in'?target:parentOf(target.id),oldRig=boneLayerFor(l);
  const chain=[l,...ancestors(l.id),...(dest?[dest,...ancestors(dest.id)]:[])];
  if(chain.some(x=>Object.keys(x.ch).some(k=>['x','y','rot','sx','sy','z'].includes(k))))throw new Error('Reparent animated transforms in Setup before adding animation');
  if(chain.some(x=>x.bindBone))throw new Error('Release whole-layer bindings before reparenting');
  const W=evalLC(l,0).world, Z=evalLC(l,0).z, D=dest?evalLC(dest,0):{world:M.I(),z:0};
  const m=M.mul(M.inv(D.world),W),sx=Math.hypot(m[0],m[1]),sy=(m[0]*m[3]-m[1]*m[2])/sx;
  if(sx<1e-9||Math.abs(m[0]*m[2]+m[1]*m[3])>1e-6*Math.max(1,sx*Math.abs(sy)))throw new Error('This move requires unsupported shear; normalize group transforms first');
  const from=siblingsOf(l.id);from.splice(from.indexOf(l),1);
  if(where==='in'){target.children.unshift(l);target.open=true;}else{const to=siblingsOf(target.id);to.splice(to.indexOf(target)+(where==='below'?1:0),0,l);}
  const ox=l.p.ox||0,oy=l.p.oy||0;
  Object.assign(l.p,{x:m[4]-ox+m[0]*ox+m[2]*oy,y:m[5]-oy+m[1]*ox+m[3]*oy,rot:Math.atan2(m[1],m[0])/DEG,sx,sy,z:Z-D.z});
  const clear=a=>{if(a.type==='bone')return;a.bindBone=null;delete a.flexiBones;if(a.pts)for(const p of Object.values(a.pts))delete p.b;(a.children||[]).forEach(clear);};
  if(oldRig!==boneLayerFor(l))clear(l);
}

// Temporary rig poses are evaluation overrides, never destructive document restores.
let rigPreview=null;
const rawBoneFrames=boneFrames;
boneFrames=function(b,f,over,noDyn){return rawBoneFrames(b,f,over||(rigPreview&&rigPreview.doc===S.doc&&rigPreview.id===b.id&&f!==null?rigPreview.angles:null),noDyn);};
rigTest=function(){const b=activeBoneLayer();if(!b?.bones.length)return toast('Select a rig with bones','err');const epoch=documentEpoch,id=b.id;let i=0;const step=()=>{if(epoch!==documentEpoch||i>=5){rigPreview=null;requestDraw();return;}const current=findLayer(id);if(!current){rigPreview=null;return;}const d=[0,27,-27,54,-54][i++];rigPreview={id,doc:S.doc,angles:Object.fromEntries(current.bones.map(x=>[x.id,val(current,'bone:'+x.id+':a',S.frame)+(x.parent?d:0)]))};requestDraw();setTimeout(step,700);};step();};

// The recovery checkpoint and the last explicit save are different states.
let recoveryDB=null,recoveryPending=false,recoverySignature='';
function recoveryStore(text) {
  if(typeof indexedDB==='undefined')return Promise.reject(new Error('IndexedDB unavailable'));
  if(!recoveryDB)recoveryDB=new Promise((resolve,reject)=>{const q=indexedDB.open('popai-recovery',1);q.onupgradeneeded=()=>q.result.createObjectStore('snapshots');q.onsuccess=()=>resolve(q.result);q.onerror=()=>{recoveryDB=null;reject(q.error);};});
  return recoveryDB.then(db=>new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(text,'latest');tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Recovery write failed'));}));
}
async function recoveryRead(){try{if(typeof indexedDB!=='undefined'){await recoveryStoreInit();const db=await recoveryDB;const text=await new Promise((resolve,reject)=>{const q=db.transaction('snapshots').objectStore('snapshots').get('latest');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});if(text)return text;}}catch(e){}return lsGet('popai.autosave');}
function recoveryStoreInit(){if(!recoveryDB){recoveryDB=new Promise((resolve,reject)=>{const q=indexedDB.open('popai-recovery',1);q.onupgradeneeded=()=>q.result.createObjectStore('snapshots');q.onsuccess=()=>resolve(q.result);q.onerror=()=>{recoveryDB=null;reject(q.error);};});}return recoveryDB;}
autosave=async function(){if(!S.dirtyDoc||!S.doc||recoveryPending)return;const sig=sceneSignature();if(sig===recoverySignature)return;const text=serialize();recoveryPending=true;try{await recoveryStore(text);recoverySignature=sig;lsSet('popai.autosave.t',new Date().toLocaleString());}catch(e){if(lsSet('popai.autosave',text)){recoverySignature=sig;lsSet('popai.autosave.t',new Date().toLocaleString());}else toast('Recovery storage is full; save a project file now','err');}finally{recoveryPending=false;}};
recoverAutosave=async function(){const text=await recoveryRead();if(!text)return toast('No recovery checkpoint found','err');if(await loadProjectJSON(text)===false)return false;S.dirtyDoc=true;toast('Recovered checkpoint — save a project file','ok');};
saveProject=async function(){const doc=S.doc,epoch=documentEpoch,text=serialize(),sig=sceneSignature(),name=(doc.name||'project').replace(/[^\w\- ]+/g,'_')+'.popai.json';try{
  if(window.showSaveFilePicker){const h=await window.showSaveFilePicker({suggestedName:name,types:[{description:'Popai project',accept:{'application/json':['.json']}}]});const w=await h.createWritable();try{await w.write(text);await w.close();}catch(e){try{await w.abort();}catch(_){}throw e;}if(documentEpoch===epoch&&sceneSignature()===sig)S.dirtyDoc=false;toast('Project file saved','ok');}
  else{const outcome=await download(new Blob([text],{type:'application/json'}),name);if(outcome?.confirmed&&documentEpoch===epoch&&sceneSignature()===sig)S.dirtyDoc=false;toast(outcome?.confirmed?'Project saved':'Download started — confirm the file is in Downloads. Unsaved warning stays active.','ok');}
}catch(e){if(e.name!=='AbortError')toast('Project was not saved: '+e.message,'err');return false;}};

// Register the replaced functions (the command table retains original references).
CMDS.find(c=>c.id==='file.save').run=()=>saveProject();
CMDS.find(c=>c.id==='file.recover').en=()=>lsGet('popai.autosave.t')||lsGet('popai.autosave')?false:'No recovery checkpoint';
const rawStartDoc=startDoc;
startDoc=function(d){if(S.dirtyDoc&&!window.confirm('Replace the current unsaved project? Save it first if needed.'))return false;rigPreview=null;return rawStartDoc(d);};
window.addEventListener('popai-document-change',()=>{rigPreview=null;});

// Isolated synchronous evaluation of an immutable render input.
function captureScene(){return {doc:clone(S.doc),media:{...S.media}};}
function withScene(scene,fn){const d=S.doc,m=S.media;S.doc=scene.doc;S.media=scene.media;try{return fn();}finally{S.doc=d;S.media=m;}}
const rawDemoProject=demoProject;
demoProject=function(){const selection=S.selLayers,frame=S.frame;try{return withScene({doc:newDoc(),media:{}},()=>rawDemoProject());}finally{S.selLayers=selection;S.frame=frame;}};
function snapshotFrame(scene,f,scale,alpha){return withScene(scene,()=>renderFrameCanvas(f,scale,alpha));}
function audioVisible(l,f){let child=l;for(const a of [l,...ancestors(l.id)]){if(!a.vis||val(a,'visible',f)===false)return false;if(a!==l&&a.type==='switch'&&switchState(a,f).cur!==child.id)return false;child=a;}return true;}
function scheduleGain(g,l,fromF,now){const fps=S.doc.fps,end=Math.min(S.doc.end,Math.ceil((S.media[l.media]?.buffer.duration||0)*fps)+l.offset);for(let f=fromF;f<=end;f++)g.setValueAtTime(audioVisible(l,f)?Math.max(0,val(l,'gain',f)||0):0,now+(f-fromF)/fps);}
function createAudioRun(fromF,dest){const ac=audioCtx(),now=ac.currentTime+0.03,nodes=[];for(const l of audioLayers()){const buf=S.media[l.media].buffer,off=(fromF-l.offset)/S.doc.fps;if(off>=buf.duration)continue;const src=ac.createBufferSource(),gain=ac.createGain();src.buffer=buf;src.connect(gain);gain.connect(dest||ac.destination);scheduleGain(gain.gain,l,fromF,now);if(off>=0)src.start(now,off);else src.start(now-off,0);nodes.push(src);}return{now,nodes,stop(){for(const n of nodes)try{n.stop();n.disconnect();}catch(e){}}};}
startAudio=function(fromF,dest){const run=createAudioRun(fromF,dest);Play.nodes.push(...run.nodes);return run.now;};

const oldRunJob=runJob;
runJob=function(name,kind,fn){return oldRunJob(name,kind,async(job,tick)=>{persistJobs();try{return await fn(job,(p,msg)=>{tick(p,msg);persistJobs();});}finally{setTimeout(persistJobs,0);}});};
function persistJobs(){lsSet('popai.jobs',JSON.stringify(Jobs.list.slice(0,30).map(({id,name,kind,status,progress,msg,t0,t1})=>({id,name,kind,status,progress,msg,t0,t1}))));}
try{Jobs.list=JSON.parse(lsGet('popai.jobs')||'[]').filter(j=>j&&typeof j.name==='string').map(j=>({...j,status:j.status==='running'?'interrupted':j.status,msg:j.status==='running'?'Interrupted by reload; rerun the operation':j.msg}));}catch(e){Jobs.list=[];}

exportDialog=async function(){
  const exportForm=modal('Export',`<div class="form"><label>Format</label><select name="fmt"><option value="png">PNG current frame</option><option value="seq">PNG sequence (bounded ZIP parts)</option><option value="webm" selected>Video (.webm)</option><option value="dat">Moho switch data</option><option value="project">Project file</option></select><label>From frame</label><input type="number" name="from" min="0" value="1"><label>To frame</label><input type="number" name="to" value="${S.doc.end}"><label data-video-quality>Video quality</label><select name="quality" data-video-quality><option value="draft">Draft · 2 Mbps</option><option value="standard">Standard · 5 Mbps</option><option value="high" selected>High · 8 Mbps</option><option value="ultra">Ultra · 16 Mbps</option></select><label>Render size</label><select name="scale"><option value="0.5">50% · ${Math.round(S.doc.w*0.5)} × ${Math.round(S.doc.h*0.5)}</option><option selected value="1">100% · ${S.doc.w} × ${S.doc.h}</option><option value="2">200% · ${S.doc.w*2} × ${S.doc.h*2}</option></select><label>Transparency</label><input type="checkbox" name="alpha"></div><p class="note">The scene is captured when you start. PNG sequences are frame-accurate and split into ZIP parts near 64 MiB. WebM requires real-time rendering; missed deadlines stop the job. Use PNG for heavy scenes.</p>`,[{label:'Cancel',value:false},{label:'Export',value:true,pri:true}]);
  const format=$('#modal [name="fmt"]');
  if(format){const update=()=>{document.querySelectorAll('#modal [data-video-quality]').forEach(el=>{el.hidden=format.value!=='webm';if(el.tagName==='SELECT')el.disabled=format.value!=='webm';});};format.onchange=update;update();}
  const result=await exportForm;
  if(!result?.v)return;const o=result.data;
  const qualityRates={draft:2e6,standard:5e6,high:8e6,ultra:16e6};
  const videoBitrate=qualityRates[o.quality||'high'];
  if(o.fmt==='webm'&&!videoBitrate)return toast('Choose a valid video quality','err');
  if(o.fmt==='dat')return exportDat();if(o.fmt==='project')return saveProject();
  const sc=+o.scale,from=+o.from,to=+o.to;
  if(![0.5,1,2].includes(sc)||!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from||to>100000)return toast('Invalid export range','err');
  const scene=captureScene(),d=scene.doc,base=(d.name||'render').replace(/[^\w\- ]+/g,'_');
  if(d.w*sc*d.h*sc>33554432)return toast('Export exceeds 32 megapixel limit; reduce scale','err');
  const blobAt=async f=>{const b=await canvasBlob(snapshotFrame(scene,f,sc,o.alpha));if(!b)throw new Error('Frame encoding failed');return b;};
  if(o.fmt==='png'){try{await download(await blobAt(S.frame),`${base}_${S.frame}.png`);}catch(e){toast(e.message,'err');}return;}
  setTab('jobs');
  if(o.fmt==='seq')return runJob(`PNG ${from}–${to}`,'snapshot render',async(job,tick)=>{
    let files=[],bytes=0,part=0;const budget=64*1024*1024;
    const flush=async()=>{if(!files.length)return;await download(makeZip(files),`${base}_part${String(++part).padStart(3,'0')}.zip`);files=[];bytes=0;};
    for(let f=from;f<=to;f++){if(job.cancel)return{msg:`Cancelled; ${part} completed ZIP parts may already be downloaded`};const b=await blobAt(f);if(job.cancel)return;if(b.size>budget)throw new Error('A frame exceeds ZIP part budget; reduce scale');if(bytes+b.size>budget)await flush();files.push({name:`${base}_${String(f).padStart(6,'0')}.png`,data:new Uint8Array(await b.arrayBuffer())});bytes+=b.size;tick((f-from+1)/(to-from+1),`Frame ${f}`);await sleep(0);}
    if(job.cancel)return;await flush();return{msg:`${to-from+1} frames; ${part} ZIP download(s) initiated`};
  });
  if(o.fmt==='webm')return runJob(`WebM ${from}–${to}`,'video render · '+(o.quality||'high')+' · '+videoBitrate/1e6+' Mbps',async(job,tick)=>{
    if(!window.MediaRecorder)throw new Error('MediaRecorder unavailable; export PNG');
    const c=document.createElement('canvas');c.width=Math.round(d.w*sc);c.height=Math.round(d.h*sc);
    const stream=c.captureStream(0),track=stream.getVideoTracks()[0],ac=audioCtx(),dest=ac.createMediaStreamDestination();let audio=null,rec=null;
    try{
      if(!track.requestFrame)throw new Error('Manual frame capture unsupported; export PNG');
      const has=withScene(scene,()=>audioLayers().length)>0;if(has)dest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
      const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(m=>MediaRecorder.isTypeSupported(m));if(!mime)throw new Error('No supported WebM codec');
      const chunks=[];let size=0;rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:videoBitrate});
      let recordingError=null;const done=new Promise(resolve=>{rec.onstop=resolve;rec.onerror=e=>{recordingError=new Error(e.error?.message||'Recorder failed');resolve();};});
      rec.ondataavailable=e=>{if(e.data.size){size+=e.data.size;chunks.push(e.data);if(size>128*1024*1024)recordingError=new Error('Recording exceeds 128 MiB budget; shorten range or export PNG');}};
      const draw=f=>{const x=c.getContext('2d');x.setTransform(1,0,0,1,0,0);x.fillStyle=d.bg;x.fillRect(0,0,c.width,c.height);withScene(scene,()=>renderScene(x,f,M.chain(M.t(c.width/2,c.height/2),M.s(sc)),{export:true}));track.requestFrame();};
      draw(from);rec.start(1000);audio=has?withScene(scene,()=>createAudioRun(from,dest)):null;
      const clock=()=>has?ac.currentTime:performance.now()/1000,t0=audio?audio.now:clock();
      for(let f=from;f<=to;f++){if(job.cancel)break;const target=(f-from)/d.fps;while(clock()-t0<target){if(job.cancel)break;await sleep(2);}if(job.cancel)break;if(recordingError)throw recordingError;if(clock()-t0-target>Math.max(0.05,1/d.fps))throw new Error('Real-time deadline missed; use PNG sequence for exact frames');draw(f);tick((f-from+1)/(to-from+1),`Frame ${f}`);}
      await sleep(1000/d.fps);audio?.stop();rec.stop();await done;if(recordingError)throw recordingError;if(job.cancel)return;
      const result=await download(new Blob(chunks,{type:mime}),`${base}.webm`);if(result?.canceled){job.cancel=true;return{msg:'Video save cancelled'};}return{msg:result?.confirmed?'Video saved: '+(result.name||base+'.webm'):'Video download started (.webm)'};
    }finally{audio?.stop();if(rec&&rec.state!=='inactive')rec.stop();for(const t of stream.getTracks())t.stop();for(const t of dest.stream.getTracks())t.stop();}
  });
};
CMDS.find(c=>c.id==='file.export').run=()=>exportDialog();
Object.assign(window.PopaiApp,{applyCmd,runJob,validateCmd,saveProject,autosave,rigTest});

// Retained offscreen buffers have a pixel-memory budget rather than only a count.
Pool.put=function(...canvases){let bytes=this.list.reduce((n,c)=>n+c.width*c.height*4,0);for(const c of canvases){const size=c&&c.width*c.height*4;if(c&&bytes+size<=64*1024*1024&&!this.list.includes(c)){this.list.push(c);bytes+=size;}}};
const unboundedSimulation=simulateBones;
simulateBones=function(b){if((S.doc.end+1)*b.bones.filter(x=>x.dyn?.on).length>2000000)throw new Error('Dynamics exceeds simulation budget; shorten the project or reduce dynamic bones');return unboundedSimulation(b);};
Object.assign(window.PopaiApp,{demoProject,startDoc,simulateBones,boneFrames,exportDialog});
