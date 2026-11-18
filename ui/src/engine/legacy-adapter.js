/* Migration boundary: only this adapter accesses the compatibility engine's globals.
   React, workers and native file services consume the strict TypeScript contract. */
const platformListeners=new Set(),platformSession=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():String(Date.now());
let platformStarted=false,platformSnapshot=null,platformFingerprint='',platformStamp='',platformPlan=null;
const platformDocumentID=()=>platformSession+':'+documentEpoch;
function platformRead(){
  if(!S.doc){if(!platformSnapshot)platformSnapshot=Object.freeze({documentId:'',revision:0,name:'Loading',dirty:false,frame:0,end:72,fps:24,width:1280,height:720,mode:'setup',playing:false,tool:'select',selectedId:null,selectedName:'No selection',selectedType:null,layerCount:0,pointCount:0,selectedPointCount:0,boneCount:0,effectCount:0,canUndo:false,canRedo:false});return platformSnapshot;}
  const stamp=[documentEpoch,REV,S.frame,S.playing,S.mode,S.tool,S.camSel,S.selLayers.join(','),S.selPts.size,H.undo.length,H.redo.length,S.dirtyDoc,S.doc.name].join('|');if(stamp===platformStamp&&platformSnapshot)return platformSnapshot;platformStamp=stamp;
  const l=S.camSel?null:selLayer(),layers=allLayers();
  const next={documentId:platformDocumentID(),revision:REV,name:S.doc.name,dirty:S.dirtyDoc,frame:S.frame,end:S.doc.end,fps:S.doc.fps,width:S.doc.w,height:S.doc.h,mode:S.mode,playing:S.playing,tool:S.tool,selectedId:l?.id||null,selectedName:S.camSel?'Camera':l?.name||'No selection',selectedType:l?.type||null,layerCount:layers.length,pointCount:l?.pts?Object.keys(l.pts).length:0,selectedPointCount:S.selPts.size,boneCount:layers.reduce((n,l)=>n+(l.bones?.length||0),0),effectCount:layers.reduce((n,l)=>n+l.fx.length,0),canUndo:H.undo.length>0,canRedo:H.redo.length>0};
  const fingerprint=JSON.stringify(next);if(fingerprint!==platformFingerprint){platformSnapshot=Object.freeze(next);platformFingerprint=fingerprint;}
  return platformSnapshot;
}
function platformNotify(){const old=platformSnapshot;platformRead();if(old!==platformSnapshot)for(const fn of platformListeners)fn();}
const platformDraw=drawNow;drawNow=function(){platformDraw();platformNotify();};
window.PopaiRuntime={
  start(){if(platformStarted)return;platformStarted=true;CMDS.find(c=>c.id==='file.save').label='Save project';boot();platformNotify();},
  read(){return platformRead();},
  subscribe(fn){platformListeners.add(fn);return()=>platformListeners.delete(fn);},
  command(id){const c=CMDS.find(c=>c.id===id);if(!c)throw Error('Unknown editor command: '+id);const why=c.en&&c.en();if(why)throw Error(why);return c.run();},
  captureSave(){return {documentId:platformDocumentID(),signature:sceneSignature(),text:serialize(),name:S.doc.name};},
  acknowledgeSave(saved){if(saved.documentId!==platformDocumentID()||saved.signature!==sceneSignature())return false;S.dirtyDoc=false;refreshAll();platformNotify();return true;},
  async openProject(text){const pending=loadProjectJSON(text),epoch=documentEpoch,result=await pending;if(result!==false&&epoch!==documentEpoch)throw Error('The active project changed during loading');platformNotify();return result!==false;},
  setSaveHandler(handler){saveProject=async()=>{try{await handler();}catch(e){toast('Project was not saved: '+e.message,'err');}};CMDS.find(c=>c.id==='file.save').run=()=>saveProject();},
  setOpenHandler(handler){CMDS.find(c=>c.id==='file.open').run=async()=>{try{await handler();}catch(e){toast('Project was not opened: '+e.message,'err');}};},
  captureGeometry(){const l=S.camSel?null:selLayer();if(l?.type!=='vector')return null;if(l.paths.reduce((n,p)=>n+p.pts.length,0)>20000)throw Error('Select a drawing with fewer than 20,000 path points for analysis');const lc=lcOf(l);return {token:platformDocumentID()+':'+REV+':'+S.frame+':'+l.id,paths:l.paths.map(p=>({id:p.id,closed:p.closed,segments:Array.from({length:Math.max(0,p.pts.length-(p.closed?0:1))},(_,i)=>vectorCubic(l,p,i,lc.P,S.frame,lc))}))};},
  captureFrame(maxDimension=1280,selectedOnly=false){const max=clamp(Number(maxDimension)||1280,64,4096),scale=Math.min(1,max/Math.max(S.doc.w,S.doc.h));if(!selectedOnly)return renderFrameCanvas(S.frame,scale,false);
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(S.doc.w*scale));canvas.height=Math.max(1,Math.round(S.doc.h*scale));const ctx=canvas.getContext('2d');renderScene(ctx,S.frame,M.chain(M.t(canvas.width/2,canvas.height/2),M.s(scale)),{only:selLayer()?.id,swOverride:switchOverrides(),export:false});return canvas;},
  markDirty(){S.dirtyDoc=true;refreshAll();platformNotify();},
  addEffect(input){const l=S.camSel?null:selLayer();if(!l)throw Error('Select a layer for the effect');assertWritable(l);if(!['color','glow','blur'].includes(input.type))throw Error('Unsupported effect');
    const def=FX[input.type],params={...fxDefaults(input.type)};for(const [key,value]of Object.entries(input.params)){const rule=def.params[key];if(!rule||typeof value!==typeof rule[0]||typeof value==='number'&&(!Number.isFinite(value)||value<rule[1]||value>rule[2])||typeof value==='string'&&!isColor(value))throw Error('Invalid effect parameter: '+key);params[key]=value;}
    if(edit('Add '+def.label,()=>l.fx.push({id:uid('fx'),type:input.type,on:true,p:params}))===false)throw Error('Effect was not applied');platformNotify();},
  showMessage(message,error=false){toast(String(message),error?'err':'');},
  loadDemo(){if(startDoc(demoProject())!==false)closeModal(null);platformNotify();},
  async planAI(text){if(typeof text!=='string'||!text.trim()||text.length>4000)throw Error('Enter a request under 4,000 characters');const signature=sceneSignature(),epoch=documentEpoch,scope=requestScope(text),keys=[...S.selKeys],plan=await aiPlan(text);
    if(signature!==sceneSignature()||epoch!==documentEpoch)throw Error('The scene changed while planning; generate a fresh plan');if(!Array.isArray(plan.cmds)||plan.cmds.length>200)throw Error('Invalid AI plan');
    for(const c of plan.cmds){c._scope=scope;c._keys=keys;}const token=uid('plan');platformPlan={token,signature,epoch,plan,text};return {token,engine:plan.engine||'Local interpreter',notes:(plan.notes||[]).map(String).slice(0,50),commands:plan.cmds.map(c=>({description:String(c.desc||c.op),operation:String(c.op),error:validateCmd(c)||null}))};},
  applyAIPlan(token){const pending=platformPlan;if(!pending||pending.token!==token)throw Error('Generate a fresh plan');if(pending.epoch!==documentEpoch||pending.signature!==sceneSignature())throw Error('The scene changed; generate a fresh plan');const errors=pending.plan.cmds.map(validateCmd).filter(Boolean);if(errors.length)throw Error(errors.join('; '));
    const commands=pending.plan.cmds.filter(c=>c.op!=='lipsync');if(commands.length&&edit('AI: '+pending.text.slice(0,50),()=>commands.forEach(c=>applyCmd(c)))===false)throw Error('Changes were rolled back');platformPlan=null;if(pending.plan.cmds.some(c=>c.op==='lipsync'))openLipSync();platformNotify();},
};
