import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
let dom:JSDOM,A:any,E:any;
beforeEach(()=>{
  dom=new JSDOM(readFileSync('legacy/src/shell.html','utf8').replace('<script>/*JS*/</script>',''),{url:'https://popai.local/',runScripts:'outside-only'});
  const w=dom.window;
  const ctx=new Proxy({globalAlpha:1,measureText:()=>({width:100}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}}),getImageData:()=>({data:new Uint8ClampedArray(16)}),isPointInPath:()=>true,isPointInStroke:()=>false},{get:(o,k)=>k in o?o[k as keyof typeof o]:()=>{},set:(o,k,v)=>(Reflect.set(o,k,v),true)});
  Object.defineProperty(w.HTMLCanvasElement.prototype,'getContext',{value:(kind:string)=>kind==='2d'?ctx:null});
  Object.defineProperty(w.HTMLElement.prototype,'getBoundingClientRect',{value:()=>({x:0,y:0,left:0,top:0,width:1280,height:720,right:1280,bottom:720,toJSON(){return {};}})});
  Object.defineProperty(w,'ResizeObserver',{value:class{observe(){}disconnect(){}}});
  Object.defineProperty(w,'Path2D',{value:class{moveTo(){}lineTo(){}bezierCurveTo(){}closePath(){}}});
  Object.defineProperty(w,'requestAnimationFrame',{value:()=>1});Object.defineProperty(w,'cancelAnimationFrame',{value:()=>{}});
  w.confirm=()=>true;w.URL.createObjectURL=()=> 'blob:camera-test';w.URL.revokeObjectURL=()=>{};
  w.eval(readFileSync('public/engine/legacy.js','utf8'));A=(w as any).PopaiApp;E=(w as any).PopaiRuntime;E.start();
});
afterEach(()=>dom.window.close());
const p=(key:string,value:number)=>A.setVal(A.S.doc.camera,key,value,0);
const project=(point:number[],f=0)=>A.cameraProject(A.cameraStateAt(f),point);
function layer(type='vector'){const L=A.mkLayer(type,'Test');A.S.doc.layers.push(L);A.S.selLayers=[L.id];return L;}
describe('document camera and perspective',()=>{
  it('preserves the old neutral projection and parallax for saved projects',()=>{
    p('x',30);p('y',-20);p('zoom',1.4);p('roll',12);
    const {M}=A,old=M.chain(M.r(-12*Math.PI/180),M.s(1.4*1500/1200),M.t(-30,20));
    const actual=A.camFn(0)(300);expect(actual).toHaveLength(6);
    actual.forEach((n:number,i:number)=>expect(n).toBeCloseTo(old[i],8));
  });
  it('dolly changes perspective relationships while lens zoom scales the fixed view',()=>{
    const beforeNear=project([100,0,500]).x,beforeFar=project([100,0,-500]).x;
    p('zoom',2);expect(project([100,0,500]).x/beforeNear).toBeCloseTo(2);expect(project([100,0,-500]).x/beforeFar).toBeCloseTo(2);
    p('zoom',1);p('z',-300);expect(project([100,0,500]).x/beforeNear).not.toBeCloseTo(project([100,0,-500]).x/beforeFar);
  });
  it('projects rotated planes and inverse-projects points accurately',()=>{
    p('pan',22);p('tilt',-15);p('roll',13);p('x',70);p('y',15);p('z',120);
    const {M}=A,h=M.chain(M.t(640,360),M.s(.8),A.camFn(0)(100),M.t(40,30),M.r(.2));expect(h).toHaveLength(9);
    for(const point of [[0,0],[200,50],[-180,-130]]){const screen=M.ap(h,...point),back=M.ap(M.inv(h),...screen);expect(back[0]).toBeCloseTo(point[0],7);expect(back[1]).toBeCloseTo(point[1],7);}
  });
  it('uses true perspective, with far and near points receiving different scales',()=>{
    p('pan',25);const a=project([-400,0,0]),b=project([400,0,0]);expect(a.depth).not.toBeCloseTo(b.depth);
    const left=project([-400,10,0]).y,right=project([400,10,0]).y;expect(left).not.toBeCloseTo(right);
  });
  it('keeps geometry behind the camera outside the visible half space',()=>{
    expect(project([0,0,1600]).depth).toBeLessThan(0);p('pan',35);expect(A.cameraDepth(A.cameraStateAt(0),[0,0,2000])).toBeLessThan(0);
  });
  it('converts focal length and vertical field of view without moving the camera',()=>{
    const fov=A.cameraFov(1);expect(A.cameraZoomForFov(fov)).toBeCloseTo(1,9);expect(A.cameraFocalLength(2)).toBeCloseTo(A.cameraFocalLength(1)*2,8);
    const before=JSON.stringify(A.S.doc.camera.p);A.cameraFov(4);expect(JSON.stringify(A.S.doc.camera.p)).toBe(before);
  });
  it('maps pointer deltas from the actual drag location under perspective',()=>{
    p('pan',30);const h=A.camFn(0)(0),inv=A.M.inv(h),a=A.M.ap(h,300,100),b=A.M.ap(h,330,120),delta=A.cameraDragDelta(inv,...b,...a);
    expect(delta[0]).toBeCloseTo(30,7);expect(delta[1]).toBeCloseTo(20,7);
  });
  it('updates a whole layer using an inverse-projected drag',()=>{
    const L=layer();p('pan',20);A.S.frame=10;A.S.mode='animate';const start=[700,400],end=[740,430],inv=A.M.inv(A.M.chain(A.M.t(640,360),A.camFn(10)(0)));
    A.Stage.drag={mode:'move',sx:start[0],sy:start[1],L,targets:[{T:L,x:0,y:0,inv}]};
    const expected=A.cameraDragDelta(inv,...end,...start);A.TOOLS.select.move({shiftKey:false},...end);expect(A.val(L,'x',10)).toBeCloseTo(expected[0],1);expect(A.val(L,'y',10)).toBeCloseTo(expected[1],1);
  });
});
describe('camera authoring and persistence',()=>{
  it('plans and applies real dolly movement without turning it into a zoom',async()=>{
    const plan=await E.planAI('dolly the camera forward 300 over 24 frames');expect(plan.commands[0].operation).toBe('camdolly');expect(plan.commands[0].error).toBeNull();
    E.applyAIPlan(plan.token);expect(A.val(A.S.doc.camera,'z',24)).toBe(-300);expect(A.val(A.S.doc.camera,'zoom',24)).toBe(1);E.command('edit.undo');expect(A.S.doc.camera.ch.z).toBeUndefined();
  });
  it('plans camera angle changes and validates them before applying',async()=>{
    const plan=await E.planAI('pan the camera right 15 degrees over 24 frames');expect(plan.commands[0].operation).toBe('camturn');expect(plan.commands[0].error).toBeNull();E.applyAIPlan(plan.token);
    expect(A.val(A.S.doc.camera,'pan',24)).toBe(15);expect(A.S.doc.camera.ch.x).toBeUndefined();expect(A.validateCmd({op:'camdolly',distance:Infinity,start:0,dur:24})).toBeTruthy();
  });
  it('opens separate tools with the documented shortcuts',()=>{
    for(const [key,id] of [['4','camera'],['5','camzoom'],['6','camroll'],['7','campantilt']]){
      dom.window.document.getElementById('modal')!.classList.remove('show');dom.window.document.body.focus();
      dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true}));expect(A.S.tool).toBe(id);expect(A.S.camSel).toBe(true);
    }
  });
  it('records camera position, pan, tilt and lens keys with undo support',()=>{
    A.S.frame=12;A.S.mode='animate';A.cameraKeyPose();for(const k of ['x','y','z','pan','tilt','zoom','roll'])expect(A.S.doc.camera.ch[k].keys.some((q:any)=>q.f===12)).toBe(true);
    E.command('edit.undo');expect(Object.keys(A.S.doc.camera.ch)).toHaveLength(0);E.command('edit.redo');expect(A.S.doc.camera.ch.z.keys.some((q:any)=>q.f===12)).toBe(true);
  });
  it('restores a frame to setup values without deleting other camera animation',()=>{
    p('x',20);A.setVal(A.S.doc.camera,'x',300,12,true);A.setVal(A.S.doc.camera,'x',600,24,true);A.S.frame=12;A.cameraResetKey(['x']);
    expect(A.val(A.S.doc.camera,'x',12)).toBe(20);expect(A.val(A.S.doc.camera,'x',24)).toBe(600);
  });
  it('writes numeric inspector changes into real camera channels',()=>{
    E.command('cam.properties');A.S.frame=15;A.S.mode='animate';E.command('cam.properties');
    const input=dom.window.document.querySelector('[data-cam="z"]') as HTMLInputElement;expect(input).toBeTruthy();input.value='-180';input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    expect(A.val(A.S.doc.camera,'z',15)).toBe(-180);expect(A.S.dirtyDoc).toBe(true);
  });
  it('keeps global camera keys visible across layer selection and can hide them',()=>{
    const one=layer(),two=layer();A.setVal(A.S.doc.camera,'pan',12,10,true);A.S.selLayers=[one.id];expect(A.timelineOwners().some((o:any)=>o.id==='CAM')).toBe(true);
    A.S.selLayers=[two.id];expect(A.timelineOwners().some((o:any)=>o.id==='CAM')).toBe(true);A.CAMERA_VIEW.hideKeys=true;expect(A.timelineOwners().some((o:any)=>o.id==='CAM')).toBe(false);
  });
  it('blocks camera edits while authoring regular or Smart Bone Actions',()=>{
    for(const kind of ['regular','smart']){const L=layer('bone');L.actionList=[{id:'testaction'+kind,name:'Test',kind,dur:24}];A.actOpen(L,L.actionList[0].id);
      expect(A.toolAvail('camera')).toContain('Mainline');expect(()=>A.setVal(A.S.doc.camera,'x',40)).toThrow(/Mainline/);expect(A.timelineOwners().some((o:any)=>o.id==='CAM')).toBe(false);A.actOpen(L,null);}
  });
  it('persists the complete camera and focus settings through save/reopen',async()=>{
    p('z',-200);p('pan',18);p('tilt',-8);A.S.doc.camera.dofEnabled=true;A.setVal(A.S.doc.camera,'focusDistance',900,12,true);
    const save=E.captureSave();expect(await E.openProject(save.text)).toBe(true);expect(A.S.doc.camera.p.z).toBe(-200);expect(A.S.doc.camera.p.pan).toBe(18);expect(A.S.doc.camera.dofEnabled).toBe(true);expect(A.val(A.S.doc.camera,'focusDistance',12)).toBe(900);
  });
  it('migrates old files without changing their existing camera animation',async()=>{
    const file=JSON.parse(E.captureSave().text);for(const key of ['z','pan','tilt','focusDistance','focusRange','maxBlur'])delete file.doc.camera.p[key];delete file.doc.camera.dofEnabled;
    file.doc.camera.ch.x={keys:[{f:0,v:0,i:'linear'},{f:24,v:200,i:'linear'}]};expect(await E.openProject(JSON.stringify(file))).toBe(true);
    expect(A.S.doc.camera.p.z).toBe(0);expect(A.val(A.S.doc.camera,'x',12)).toBe(100);expect(A.S.doc.camera.dofEnabled).toBe(false);
  });
  it('rejects malformed camera values and keyframes without replacing the scene',async()=>{
    const saved=E.captureSave(),file=JSON.parse(saved.text);file.doc.camera.ch.zoom={keys:[{f:0,v:'bad',i:'linear'}]};await expect(E.openProject(JSON.stringify(file))).rejects.toThrow(/camera/);
    expect(E.read().documentId).toBe(saved.documentId);expect(()=>p('zoom',0)).toThrow(/range/);
  });
});
describe('workspace views, layer exceptions and focus',()=>{
  it('orbits the workspace without touching saved camera data or project dirty state',()=>{
    const saved=E.captureSave(),signature=saved.signature;A.cameraView('orbit');expect(A.cameraWorkspaceState(0).position).not.toEqual(A.cameraStateAt(0).position);
    expect(E.captureSave().signature).toBe(signature);expect(E.read().dirty).toBe(false);E.command('view.fit');expect(A.CAMERA_VIEW.mode).toBe('camera');
  });
  it('never lets overview change export projection',()=>{
    const before=A.camFn(0)(300);A.cameraView('side');expect(A.camFn(0)(300)).toEqual(before);expect(A.stageCamFn(0)(300)).not.toEqual(before);
    A.S.outputOnly=true;expect(A.stageCamFn(0)(300)).toEqual(before);
  });
  it('computes depth sorting from parent transforms and camera orientation',()=>{
    const g=layer('group');g.depthSort=true;const near=A.mkLayer('vector'),far=A.mkLayer('vector');near.p.z=100;far.p.z=-100;g.children=[far,near];expect(A.depthSorted(g,g.children,0)[0]).toBe(near);
    p('pan',180);expect(A.depthSorted(g,g.children,0)[0]).toBe(far);
  });
  it('keeps camera-immune layers fixed under pan, zoom and dolly',()=>{
    const L=layer();L.immuneCam=true;p('pan',25);p('zoom',2);p('z',-100);
    const lc=A.evalLC(L,0),R={view:A.M.I(),cam:A.camFn(0),cameraState:A.cameraStateAt(0)};expect(A.cameraFullMatrix(R,L,lc)).toEqual(lc.world);
  });
  it('keeps camera-facing layers planar and facing the image plane',()=>{
    const L=layer();L.faceCamera=true;p('pan',25);p('tilt',15);const lc=A.evalLC(L,0),R={view:A.M.I(),cam:A.camFn(0),cameraState:A.cameraStateAt(0)};
    expect(A.cameraFullMatrix(R,L,lc)).toHaveLength(6);
  });
  it('focus blur respects depth and the layer immunity flag',()=>{
    const L=layer(),R={view:A.M.I(),cameraState:A.cameraStateAt(0)};R.cameraState.dof=true;
    let lc=A.evalLC(L,0);expect(A.cameraDofRadius(R,L,lc)).toBe(0);L.p.z=500;lc=A.evalLC(L,0);expect(A.cameraDofRadius(R,L,lc)).toBeGreaterThan(0);
    L.immuneDOF=true;expect(A.cameraDofRadius(R,L,lc)).toBe(0);
  });
  it('aims the optical center at the selected layer',()=>{
    const L=layer();L.p.x=300;L.p.y=-120;L.p.z=100;A.cameraAim();const q=project([300,-120,100]);expect(q.x).toBeCloseTo(0,7);expect(q.y).toBeCloseTo(0,7);
  });
  it('has a bounded Canvas2D perspective fallback when WebGL is unavailable',()=>{
    const source=dom.window.document.createElement('canvas');source.width=64;source.height=64;p('pan',25);
    expect(()=>A.cameraWarpPlane(source.getContext('2d'),source,A.camFn(0)(0),128,128)).not.toThrow();expect(A.CAMERA_WARP.backend).toBe('Canvas2D mesh');
  });
});
