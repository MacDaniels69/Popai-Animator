import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {beforeEach,afterEach,it,expect} from 'vitest';
let dom:JSDOM,A:any,E:any,P:any,B:any,V:any,O:any,action:any;
beforeEach(()=>{
  dom=new JSDOM(readFileSync('legacy/src/shell.html','utf8').replace('<script>/*JS*/</script>',''),{url:'https://popai.local/',runScripts:'outside-only'});
  const w=dom.window,ctx=new Proxy({globalAlpha:1,measureText:()=>({width:100}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}}),createImageData:(x:number,y:number)=>({data:new Uint8ClampedArray(x*y*4)}),getImageData:()=>({data:new Uint8ClampedArray(16)}),isPointInPath:()=>true,isPointInStroke:()=>false},{get:(o,k)=>k in o?o[k as keyof typeof o]:()=>{},set:(o,k,v)=>(Reflect.set(o,k,v),true)});
  Object.defineProperty(w.HTMLCanvasElement.prototype,'getContext',{value:(kind:string)=>kind==='2d'?ctx:null});
  Object.defineProperty(w.HTMLElement.prototype,'getBoundingClientRect',{value:()=>({x:0,y:0,left:0,top:0,width:1280,height:720,right:1280,bottom:720,toJSON(){return {};}})});
  Object.defineProperty(w,'ResizeObserver',{value:class{observe(){}disconnect(){}}});Object.defineProperty(w,'Path2D',{value:class{moveTo(){}lineTo(){}bezierCurveTo(){}closePath(){}}});
  Object.defineProperty(w,'requestAnimationFrame',{value:()=>1});Object.defineProperty(w,'cancelAnimationFrame',{value:()=>{}});w.confirm=()=>true;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
  w.eval(readFileSync('public/engine/legacy.js','utf8'));A=(w as any).PopaiApp;E=(w as any).PopaiRuntime;E.start();
  P=A.mkLayer('group','Moving parent');B=A.mkLayer('bone','Character');V=A.mkLayer('vector','Arm');O=A.mkLayer('vector','Other animation');
  B.bones=[{id:'armbone',name:'Arm',parent:null,x:0,y:0,a:0,len:50,str:25,s:1}];B.children=[V];P.children=[B];A.S.doc.layers=[P,O];A.S.selLayers=[B.id];
  A.setVal(P,'x',240,24,true);A.setVal(B,'x',120,24,true);A.setVal(B,'bone:armbone:a',60,24,true);A.setVal(V,'y',90,24,true);A.setVal(O,'rot',180,24,true);
  A.setVal(A.S.doc.camera,'x',180,24,true);A.setVal(A.S.doc.camera,'shake',10,24,true);
  A.S.doc.markers=[{id:'beat',name:'Mainline beat',f:18}];A.S.frame=18;A.S.mode='animate';action=A.actCreate(B,'Wave','regular',{dur:24});
});
afterEach(()=>dom.window.close());
it('opens a completely blank Action without inheriting Mainline or selected-bone keys',()=>{
  A.S.selBone='armbone';const smart=A.actCreateForSelectedBone(B);expect(B.actions?.[smart.id]).toBeUndefined();A.actOpen(B,smart.id);
  expect(A.S.frame).toBe(1);expect(Object.keys(B.ch)).toHaveLength(0);expect(Object.keys(V.ch)).toHaveLength(0);expect(A.buildRows().some((r:any)=>r.kind==='chan')).toBe(false);
});
it('holds a blank Action at the setup pose through all of its frames',()=>{
  A.actOpen(B,action.id);for(const f of [0,1,6,12,24]){expect(A.val(B,'x',f)).toBe(0);expect(A.val(B,'bone:armbone:a',f)).toBe(0);expect(A.val(V,'y',f)).toBe(0);expect(A.val(P,'x',f)).toBe(0);expect(A.val(O,'rot',f)).toBe(0);}
});
it('freezes the Mainline camera and its shake while an Action is scrubbed',()=>{
  const entry=A.cameraStateAt(18);A.actOpen(B,action.id);for(const f of [0,1,12,24])expect(A.cameraStateAt(f)).toEqual(entry);
  const capture=E.captureSave();expect(A.cameraStateAt(24)).toEqual(entry);expect(JSON.parse(capture.text).doc.activeAction).toBeNull();
});
it('filters unrelated pins and camera keys out of the Action timeline without losing pins',()=>{
  A.TL.pins.add(O.id);A.TL.pins.add('CAM');A.actOpen(B,action.id);expect(A.timelineOwners().map((o:any)=>o.id)).toEqual([B.id]);expect(A.timelineMarkers()).toHaveLength(0);expect(A.buildRows().some((r:any)=>r.kind==='markers')).toBe(false);
  A.actOpen(null,null);expect(A.TL.pins.has(O.id)).toBe(true);expect(A.timelineOwners().some((o:any)=>o.id===O.id)).toBe(true);expect(A.timelineMarkers()).toHaveLength(1);
});
it('does not let an Action edit write keys into an unrelated Mainline layer',()=>{
  const before=JSON.stringify(O.ch);A.actOpen(B,action.id);expect(()=>A.setVal(O,'x',300,12)).toThrow(/active Action/);expect(JSON.stringify(O.ch)).toBe(before);
});
it('keeps authored Action keys and Mainline keys independent and restores the Mainline playhead',()=>{
  const main=JSON.stringify([B.ch,V.ch,P.ch,O.ch,A.S.doc.camera.ch]);A.actOpen(B,action.id);A.setVal(B,'bone:armbone:a',-30,12);A.setVal(V,'y',-40,12);
  expect(A.val(B,'bone:armbone:a',12)).toBe(-30);expect(A.val(V,'y',12)).toBe(-40);expect(A.timelineOwners().every((o:any)=>o.id!==O.id)).toBe(true);
  A.actOpen(null,null);expect(A.S.frame).toBe(18);expect(JSON.stringify([B.ch,V.ch,P.ch,O.ch,A.S.doc.camera.ch])).toBe(main);expect(A.val(B,'bone:armbone:a',24)).toBe(60);
  A.actOpen(B,action.id);expect(A.val(B,'bone:armbone:a',12)).toBe(-30);expect(A.val(V,'y',12)).toBe(-40);
});
it('deleting or clearing Action keys never changes the shared setup pose',()=>{
  A.actOpen(B,action.id);A.setVal(B,'x',70,0);A.setVal(B,'x',120,12);A.S.selKeys=new Set([`${B.id}|x|12`]);A.deleteSelectedKeys();expect(B.p.x).toBe(0);expect(B.ch.x.keys).toHaveLength(1);
  E.command('anim.clear');expect(Object.keys(B.ch)).toHaveLength(0);expect(B.p.x).toBe(0);expect(A.val(B,'x',12)).toBe(0);A.actOpen(null,null);expect(A.val(B,'x',24)).toBe(120);
});
it('uses the Action duration without changing the Mainline end frame',()=>{
  const mainEnd=A.S.doc.end;A.actOpen(B,action.id);expect(A.timelineEnd()).toBe(24);expect((dom.window.document.getElementById('tlEnd') as HTMLInputElement).value).toBe('24');
  const input=dom.window.document.getElementById('tlEnd') as HTMLInputElement;input.value='36';input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));expect(action.dur).toBe(36);expect(A.S.doc.end).toBe(mainEnd);
});
it('does not play Mainline audio or inherit procedural animation into an empty Action',()=>{
  const audio=A.mkLayer('audio');audio.media='sound';A.S.doc.layers.push(audio);A.S.media.sound={buffer:{duration:5}};expect(A.audioLayers()).toHaveLength(1);
  const particles=A.mkLayer('particle');B.children.push(particles);A.actOpen(B,action.id);expect(A.audioLayers()).toHaveLength(0);expect(A.actProceduralFrame(particles,20)).toBe(0);
});
it('does not run Mainline bone dynamics while an Action is empty',()=>{
  B.bones[0].dyn={on:true,spring:60,damp:11,inertia:.6};B.force={gravS:500,gravA:90};A.actOpen(B,action.id);
  expect(A.boneFrames(B,1)).toEqual(A.boneFrames(B,24));
});
it('can reuse just the authored Action sequence after returning to Mainline',()=>{
  const beforeOther=JSON.stringify(O.ch),beforeParent=JSON.stringify(P.ch);A.actOpen(B,action.id);A.setVal(B,'x',50,12);A.actOpen(null,null);A.S.frame=30;
  A.edit('Reuse action',()=>A.actInsertCopy(action.id,30));expect(A.val(B,'x',42)).toBe(50);expect(JSON.stringify(O.ch)).toBe(beforeOther);expect(JSON.stringify(P.ch)).toBe(beforeParent);
});
it('save and reopen retain separate animation contexts without carrying a preview into the file',async()=>{
  A.actOpen(B,action.id);A.setVal(V,'y',-25,12);const saved=E.captureSave(),file=JSON.parse(saved.text);expect(file.doc.activeAction).toBeNull();expect(file.doc.layers[0].children[0].ch.x.keys.some((k:any)=>k.f===24)).toBe(true);
  E.acknowledgeSave(saved);await E.openProject(saved.text);B=A.findLayer(B.id);V=A.findLayer(V.id);A.actOpen(B,action.id);expect(A.val(V,'y',12)).toBe(-25);expect(A.val(B,'x',24)).toBe(0);
});
