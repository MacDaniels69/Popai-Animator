/* Document camera. World units remain compatible with existing Popai files:
   the neutral camera sits at (0, 0, CAM_D), looking towards negative Z.
   camera.p.z is a dolly offset from that position. Workspace views never save. */
const CAMERA_DEFAULTS = { x:0, y:0, z:0, pan:0, tilt:0, zoom:1, roll:0, shake:0, shakeFreq:10,
  focusDistance:CAM_D, focusRange:750, maxBlur:12 };
const CAMERA_LIMITS = { x:[-1e7,1e7], y:[-1e7,1e7], z:[-1e7,1e7], pan:[-36000,36000], tilt:[-89,89],
  zoom:[0.005,500], roll:[-36000,36000], shake:[0,10000], shakeFreq:[0,120], focusDistance:[1,1e7], focusRange:[1,1e7], maxBlur:[0,200] };
const CAMERA_TOOLS = new Set(['camera','camzoom','camroll','campantilt']);
const CAMERA_NEAR = 1;
const CAMERA_VIEW = { mode:'camera', yaw:28, pitch:24, distance:CAM_D*2, showPath:true, showGuides:true, hideKeys:false, orbitRadius:CAM_D };
function cameraMigrate(d) {
  if (!d?.camera) return d;
  const c=d.camera; c.p ||= {}; c.ch ||= {};
  for (const [k,v] of Object.entries(CAMERA_DEFAULTS)) if(c.p[k]===undefined)c.p[k]=v;
  if(c.dofEnabled===undefined)c.dofEnabled=false;
  return d;
}
const cameraNewDoc=newDoc;
newDoc=function(o){return cameraMigrate(cameraNewDoc(o));};
const cameraValidateProject=validateProject;
validateProject=function(j){
  const d=cameraValidateProject(j); cameraMigrate(d);
  if(typeof d.camera.dofEnabled!=='boolean')throw Error('Invalid camera depth of field');
  for(const [k,limits] of Object.entries(CAMERA_LIMITS)) {
    if(!Number.isFinite(d.camera.p[k])||d.camera.p[k]<limits[0]||d.camera.p[k]>limits[1])throw Error('Invalid camera '+k);
    for(const key of d.camera.ch[k]?.keys||[])if(typeof key.v!=='number'||!Number.isFinite(key.v)||key.v<limits[0]||key.v>limits[1])throw Error('Invalid camera key '+k);
  }
  for(const l of flattenDocument(d).values())for(const k of ['faceCamera','immuneDOF'])if(l[k]!==undefined&&typeof l[k]!=='boolean')throw Error('Invalid layer '+k);
  return d;
};
const cameraSetVal=setVal;
const cameraValidateCmd=validateCmd;
validateCmd=function(c){if(c?.op?.startsWith('cam')&&actActive())return 'Return to Mainline to edit the scene camera';return cameraValidateCmd(c);};
setVal=function(o,path,v,f=S.frame,force=false){
  if(o?.id==='CAM') {
    if(actActive())throw Error('Return to Mainline to edit the scene camera');
    const limits=CAMERA_LIMITS[path];
    if(limits&&(!Number.isFinite(v)||v<limits[0]||v>limits[1]))throw Error('Camera '+path+' is out of range');
  }
  return cameraSetVal(o,path,v,f,force);
};

// Homographies extend the existing affine matrix API for tilted camera planes.
// Six-number matrices keep the original fast path and existing file behavior.
const cameraAffine={mul:M.mul,inv:M.inv,ap:M.ap,apv:M.apv,scaleOf:M.scaleOf,set:M.set};
function cameraH(m){return m.length===9?m:[m[0],m[2],m[4],m[1],m[3],m[5],0,0,1];}
M.mul=function(a,b){
  if(a.length!==9&&b.length!==9)return cameraAffine.mul(a,b);
  a=cameraH(a);b=cameraH(b);const out=Array(9).fill(0);
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)for(let k=0;k<3;k++)out[r*3+c]+=a[r*3+k]*b[k*3+c];
  return out;
};
M.inv=function(m){
  if(m.length!==9)return cameraAffine.inv(m);
  const [a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d;
  const det=a*A+b*D+c*G;if(Math.abs(det)<1e-15)return [0,0,0,0,0,0,0,0,1];
  return [A,B,C,D,E,F,G,H,I].map(v=>v/det);
};
M.ap=function(m,x,y){
  if(m.length!==9)return cameraAffine.ap(m,x,y);
  const w=m[6]*x+m[7]*y+m[8],den=Math.abs(w)<1e-9?(w<0?-1e-9:1e-9):w;
  return [(m[0]*x+m[1]*y+m[2])/den,(m[3]*x+m[4]*y+m[5])/den];
};
M.apv=function(m,x,y){if(m.length!==9)return cameraAffine.apv(m,x,y);const p=M.ap(m,0,0),q=M.ap(m,x,y);return [q[0]-p[0],q[1]-p[1]];};
M.scaleOf=function(m){if(m.length!==9)return cameraAffine.scaleOf(m);const p=M.ap(m,0,0),x=M.ap(m,1,0),y=M.ap(m,0,1);return Math.sqrt(Math.abs((x[0]-p[0])*(y[1]-p[1])-(x[1]-p[1])*(y[0]-p[0])))||1e-9;};
M.set=function(ctx,m){if(m.length!==9)return cameraAffine.set(ctx,m);const p=M.ap(m,0,0),x=M.ap(m,1,0),y=M.ap(m,0,1);ctx.setTransform(x[0]-p[0],x[1]-p[1],y[0]-p[0],y[1]-p[1],p[0],p[1]);};
function cameraDragDelta(inv,x,y,sx,sy){const a=M.ap(inv,sx,sy),b=M.ap(inv,x,y);return [b[0]-a[0],b[1]-a[1]];}
const cameraDot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function cameraBasis(pan,tilt,roll=0){
  const a=pan*DEG,b=tilt*DEG,r=roll*DEG,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cr=Math.cos(r),sr=Math.sin(r);
  const right=[ca,0,sa],down=[sa*sb,cb,-ca*sb];
  return {right:right.map((v,i)=>cr*v+sr*down[i]),down:down.map((v,i)=>cr*v-sr*right[i]),forward:[sa*cb,-sb,-ca*cb]};
}
function cameraStateAt(f){
  f=actCameraFrame(f);
  const c=S.doc.camera,read=k=>{const n=val(c,k,f);return Number.isFinite(n)?n:CAMERA_DEFAULTS[k];};
  const amount=Math.max(0,read('shake')),t=f/S.doc.fps*read('shakeFreq');
  const pan=read('pan'),tilt=read('tilt'),roll=read('roll')+(amount?amount*.05*vnoise(t,3):0);
  return {position:[read('x')+(amount?amount*vnoise(t,1):0),read('y')+(amount?amount*vnoise(t,2):0),CAM_D+read('z')],
    pan,tilt,roll,zoom:clamp(read('zoom'),.005,500),...cameraBasis(pan,tilt,roll),dof:!!c.dofEnabled,
    focusDistance:Math.max(1,read('focusDistance')),focusRange:Math.max(1,read('focusRange')),maxBlur:clamp(read('maxBlur'),0,200)};
}
function cameraWorkspaceState(f){
  if(CAMERA_VIEW.mode==='camera'||S.outputOnly)return cameraStateAt(f);
  const pan=CAMERA_VIEW.yaw,tilt=CAMERA_VIEW.pitch,b=cameraBasis(pan,tilt),sceneCamera=cameraStateAt(f),target=sceneCamera.position.map(v=>v*.5),distance=Math.max(CAMERA_VIEW.distance,Math.hypot(...sceneCamera.position)*1.5);
  return {position:b.forward.map((v,i)=>target[i]-v*distance),pan,tilt,roll:0,zoom:.65,...b,dof:false,focusDistance:distance,focusRange:750,maxBlur:0};
}
function cameraDepth(state,p){return cameraDot(state.forward,p.map((v,i)=>v-state.position[i]));}
function cameraProject(state,p){const v=p.map((n,i)=>n-state.position[i]),d=cameraDot(state.forward,v),focal=CAM_D*state.zoom;return {x:focal*cameraDot(state.right,v)/Math.max(CAMERA_NEAR,d),y:focal*cameraDot(state.down,v)/Math.max(CAMERA_NEAR,d),depth:d};}
function cameraProjection(state){
  const cache=new Map(),focal=CAM_D*state.zoom,c=state.position;
  return (z=0)=>{
    if(cache.has(z))return cache.get(z);
    const d=-cameraDot(state.forward,c)+state.forward[2]*z;
    let m;
    if(Math.abs(state.forward[0])+Math.abs(state.forward[1])<1e-10&&d>CAMERA_NEAR&&state.forward[2]<0){
      const s=focal/d;m=M.chain(M.r(-state.roll*DEG),M.s(s),M.t(-c[0],-c[1]));
    }else m=[focal*state.right[0],focal*state.right[1],focal*(state.right[2]*z-cameraDot(state.right,c)),
      focal*state.down[0],focal*state.down[1],focal*(state.down[2]*z-cameraDot(state.down,c)),state.forward[0],state.forward[1],d];
    cache.set(z,m);return m;
  };
}
camFn=function(f){return cameraProjection(cameraStateAt(f));};
function stageCamFn(f){return cameraProjection(cameraWorkspaceState(f));}
function cameraFlag(L,k){return !!(L[k]||ancestors(L.id).some(a=>a[k]));}
function cameraLayerProjection(R,L,lc){
  if(camImmune(L))return R.view;
  const state=R.cameraState||cameraStateAt(R.f??S.frame);
  if(cameraFlag(L,'faceCamera')){
    const origin=M.ap(lc.world,0,0),p=cameraProject(state,[...origin,lc.z]);
    if(p.depth>CAMERA_NEAR)return M.chain(R.view,M.t(p.x,p.y),M.r(-state.roll*DEG),M.s(CAM_D*state.zoom/p.depth),M.t(-origin[0],-origin[1]));
  }
  return M.mul(R.view,R.cam(lc.z));
}
function cameraFullMatrix(R,L,lc){return M.mul(cameraLayerProjection(R,L,lc),lc.world);}
function cameraDofRadius(R,L,lc){
  const c=R.cameraState;if(!c?.dof||isContainer(L)||camImmune(L)||cameraFlag(L,'immuneDOF'))return 0;
  const p=M.ap(lc.world,0,0),distance=cameraDepth(c,[...p,lc.z]);
  return c.maxBlur*clamp(Math.abs(distance-c.focusDistance)/c.focusRange,0,1)*M.scaleOf(R.view);
}
function cameraFov(zoom=val(S.doc.camera,'zoom',S.frame)){return 2*Math.atan(S.doc.h/(2*CAM_D*zoom))/DEG;}
function cameraZoomForFov(degrees){return S.doc.h/(2*CAM_D*Math.tan(degrees*DEG/2));}
function cameraFocalLength(zoom=val(S.doc.camera,'zoom',S.frame)){return 12/Math.tan(cameraFov(zoom)*DEG/2);}

// Rasterize only tilted leaf planes. Ordinary camera moves keep the original
// vector Canvas2D path; a homogeneous GPU quad provides perspective-correct
// sampling and near-plane clipping. A clipped triangle mesh is the fallback.
const CAMERA_WARP={canvas:null,gl:null,program:null,buffer:null,texture:null,failed:false,backend:'Canvas2D'};
function cameraWarpGL(){
  if(CAMERA_WARP.failed)return null;if(CAMERA_WARP.gl)return CAMERA_WARP;
  try{
    const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,antialias:true});
    if(!gl)throw Error('No WebGL');
    const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Camera shader');return s;};
    const v=shader(gl.VERTEX_SHADER,'#version 300 es\nin vec2 uv; uniform mat3 plane; uniform vec2 viewport; out vec2 tex; void main(){vec3 q=plane*vec3(uv,1.0);gl_Position=vec4(2.0*q.x/viewport.x-q.z,q.z-2.0*q.y/viewport.y,2.0-q.z,q.z);tex=uv;}');
    const f=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;uniform sampler2D image;in vec2 tex;out vec4 color;void main(){color=texture(image,tex);}');
    const program=gl.createProgram();gl.attachShader(program,v);gl.attachShader(program,f);gl.linkProgram(program);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Camera program');
    const buffer=gl.createBuffer(),texture=gl.createTexture();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),gl.STATIC_DRAW);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();CAMERA_WARP.failed=true;CAMERA_WARP.backend='Canvas2D mesh';});
    Object.assign(CAMERA_WARP,{canvas,gl,program,buffer,texture,backend:'WebGL2'});return CAMERA_WARP;
  }catch(e){CAMERA_WARP.failed=true;CAMERA_WARP.backend='Canvas2D mesh';return null;}
}
function cameraTextureTriangle(ctx,source,a,b,c){
  const A=[a.x/a.w,a.y/a.w],B=[b.x/b.w,b.y/b.w],C=[c.x/c.w,c.y/c.w];
  if(![...A,...B,...C].every(Number.isFinite))return;
  const inv=cameraAffine.inv([b.u-a.u,b.v-a.v,c.u-a.u,c.v-a.v,a.u,a.v]);
  const m=cameraAffine.mul([B[0]-A[0],B[1]-A[1],C[0]-A[0],C[1]-A[1],A[0],A[1]],inv);
  ctx.save();ctx.beginPath();ctx.moveTo(...A);ctx.lineTo(...B);ctx.lineTo(...C);ctx.closePath();ctx.clip();cameraAffine.set(ctx,m);ctx.drawImage(source,0,0);ctx.restore();
}
function cameraWarpPlane(ctx,source,h,W,H){
  const gpu=cameraWarpGL();
  if(gpu){
    const {canvas,gl,program,buffer,texture}=gpu;
    canvas.width=W;canvas.height=H;gl.viewport(0,0,W,H);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);const a=gl.getAttribLocation(program,'uv');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
    const unit=M.mul(h,M.s(source.width,source.height)),p=cameraH(unit);
    gl.uniformMatrix3fv(gl.getUniformLocation(program,'plane'),false,new Float32Array([p[0],p[3],p[6],p[1],p[4],p[7],p[2],p[5],p[8]]));
    gl.uniform2f(gl.getUniformLocation(program,'viewport'),W,H);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);gl.uniform1i(gl.getUniformLocation(program,'image'),0);gl.disable(gl.BLEND);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    ctx.drawImage(canvas,0,0);return;
  }
  const m=cameraH(h),n=12;
  const point=(u,v)=>({u,v,x:m[0]*u+m[1]*v+m[2],y:m[3]*u+m[4]*v+m[5],w:m[6]*u+m[7]*v+m[8]});
  const triangle=(a,b,c)=>{
    const input=[a,b,c],out=[];for(let i=0;i<3;i++){const p=input[i],q=input[(i+1)%3],pi=p.w>=CAMERA_NEAR,qi=q.w>=CAMERA_NEAR;if(pi)out.push(p);if(pi!==qi){const t=(CAMERA_NEAR-p.w)/(q.w-p.w);out.push(Object.fromEntries(['u','v','x','y','w'].map(k=>[k,lerp(p[k],q[k],t)])));}}
    for(let i=1;i<out.length-1;i++)cameraTextureTriangle(ctx,source,out[0],out[i],out[i+1]);
  };
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=point(x*source.width/n,y*source.height/n),b=point((x+1)*source.width/n,y*source.height/n),c=point(x*source.width/n,(y+1)*source.height/n),d=point((x+1)*source.width/n,(y+1)*source.height/n);triangle(a,b,c);triangle(b,d,c);}
}
function cameraPlaneBounds(L,R,lc){
  const points=[],add=(x,y,m=lc.world)=>points.push(M.ap(m,x,y));let pad=4;
  if(L.type==='vector'){
    const P=lc.P=deformedPts(L,R.f,lc);
    for(const path of L.paths)for(let i=0;i<path.pts.length-(path.closed?0:1);i++)for(const p of vectorCubic(L,path,i,P,R.f,lc))add(...p);
    pad+=Math.max(0,...L.shapes.map(s=>shapeStyle(L,s,R.f).width||0))*M.scaleOf(lc.world)*3+64;
  }else if(L.type==='image'){for(const x of [-L.iw/2,L.iw/2])for(const y of [-L.ih/2,L.ih/2])add(x,y);}
  else if(L.type==='text'){
    _hitCtx.font=`${L.bold?'700 ':''}${L.size}px ${L.font}`;const lines=String(L.text).split('\n'),w=Math.max(1,...lines.map(l=>_hitCtx.measureText(l).width)),h=lines.length*L.size*1.3;
    for(const x of [-w/2,w/2])for(const y of [-h/2,h/2])add(x,y);pad+=L.size*.3;
  }else if(L.type==='particle'){
    const m=M.mul(lc.base,lc.relParent);for(const q of particleList(L,R.f,lc)){const r=Math.max(1,q.size)*1.5;add(q.x-r,q.y-r,m);add(q.x+r,q.y+r,m);}
  }
  const bounds=points.reduce((b,p)=>{if(p.every(Number.isFinite)){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}return b;},[Infinity,Infinity,-Infinity,-Infinity]);
  if(!Number.isFinite(bounds[0]))return null;const x=bounds[0]-pad,y=bounds[1]-pad;
  return {x,y,w:Math.max(1,bounds[2]+pad-x),h:Math.max(1,bounds[3]+pad-y)};
}
const cameraOriginalContent=drawContent;
drawContent=function(ctx,L,R,lc){
  if(R.planeCapture||isContainer(L)||lc.full.length!==9)return cameraOriginalContent(ctx,L,R,lc);
  const bounds=cameraPlaneBounds(L,R,lc);if(!bounds)return;
  const depths=[[bounds.x,bounds.y],[bounds.x+bounds.w,bounds.y],[bounds.x,bounds.y+bounds.h],[bounds.x+bounds.w,bounds.y+bounds.h]].map(p=>cameraDepth(R.cameraState,[...p,lc.z]));
  if(Math.max(...depths)<=CAMERA_NEAR)return;
  const center=[bounds.x+bounds.w/2,bounds.y+bounds.h/2],h=lc.tilted?M.mul(lc.full,M.inv(lc.world)):M.mul(R.view,R.cam(lc.z)),project=M.ap(h,...center),px=M.ap(h,center[0]+1,center[1]),py=M.ap(h,center[0],center[1]+1);
  let scale=clamp(Math.max(Math.hypot(px[0]-project[0],px[1]-project[1]),Math.hypot(py[0]-project[0],py[1]-project[1])),.05,8);
  scale=Math.min(scale,4096/bounds.w,4096/bounds.h);
  const W=Math.max(1,Math.ceil(bounds.w*scale)),H=Math.max(1,Math.ceil(bounds.h*scale)),off=Pool.get(W,H),capture=M.chain(M.s(scale),M.t(-bounds.x,-bounds.y));
  try{
    const copy={...lc,full:M.mul(capture,lc.world)};
    cameraOriginalContent(off.getContext('2d'),L,{...R,view:capture,cam:()=>M.I(),planeCapture:true,W,H,rec:null},copy);if(copy.P)lc.P=copy.P;
    ctx.save();ctx.setTransform(1,0,0,1,0,0);cameraWarpPlane(ctx,off,M.mul(h,M.inv(capture)),R.W,R.H);ctx.restore();
  }finally{Pool.put(off);}
};

// Hit-tests inverse-project the pointer into the drawing plane. Passing an
// identity matrix to the original path tests avoids an affine approximation.
const cameraHitLayer=hitLayerEntry;
hitLayerEntry=function(e,sx,sy,tol=6){
  if(e.full.length!==9)return cameraHitLayer(e,sx,sy,tol);
  const q=M.ap(M.inv(e.full),sx,sy),world=M.ap(e.world,...q);
  if(cameraDepth(cameraWorkspaceState(S.frame),[...world,e.z])<=CAMERA_NEAR)return null;
  return cameraHitLayer({...e,full:M.I()},q[0],q[1],tol/Math.max(.001,M.scaleOf(e.full)));
};

// World-space distance is used even when parents move or the camera turns.
depthSorted=function(L,list,f){
  if(!L.depthSort||list.length<2)return list;const state=cameraStateAt(f);
  const distance=l=>{const lc=evalLC(l,f),p=M.ap(lc.world,0,0),v=[...p,lc.z];return L.trueDistance?Math.hypot(...v.map((n,i)=>n-state.position[i])):cameraDepth(state,v);};
  return list.map((l,i)=>({l,i,d:distance(l)})).sort((a,b)=>a.d-b.d||a.i-b.i).map(o=>o.l);
};

// ---------- Camera tools and workspace-only orbit ----------
function cameraEditReason(){return actActive()?'Return to Mainline to edit the scene camera':CAMERA_VIEW.mode!=='camera'?'Return to Camera view to animate the camera':null;}
const cameraToolAvail=toolAvail;
toolAvail=function(id){if(CAMERA_TOOLS.has(id))return cameraEditReason();if(id==='orbitworkspace')return null;return cameraToolAvail(id);};
function cameraBegin(e,mode){
  const why=cameraEditReason();if(why)return toast(why,'err');
  beginEdit('Camera '+mode);const values=Object.fromEntries(Object.keys(CAMERA_DEFAULTS).map(k=>[k,val(S.doc.camera,k,S.frame)]));
  startDrag(e,{cameraMode:mode,values,basis:cameraStateAt(S.frame),invView:M.inv(viewM())});
}
function cameraMove(e,sx,sy){
  const d=Stage.drag;if(!d?.cameraMode)return;const c=S.doc.camera,dx=(sx-d.sx)/(Stage.dpr||1),dy=(sy-d.sy)/(Stage.dpr||1);
  let mode=d.cameraMode;if(mode==='track'&&e.altKey)mode='dolly';if(mode==='pantilt'&&e.altKey)mode='orbit';
  const set=(k,v)=>setVal(c,k,clamp(round(v,5),...CAMERA_LIMITS[k]));
  if(mode==='zoom')set('zoom',d.values.zoom*Math.exp(-dy/180));
  else if(mode==='roll'){let a=d.values.roll+dx/3;if(e.shiftKey)a=Math.round(a/15)*15;set('roll',a);}
  else if(mode==='pantilt'){
    let x=dx*.15,y=dy*.15;if(e.shiftKey){if(Math.abs(x)>Math.abs(y))y=0;else x=0;}
    set('pan',d.values.pan-x);set('tilt',d.values.tilt+y);
  }else if(mode==='orbit'){
    const radius=Math.max(1,CAMERA_VIEW.orbitRadius),pivot=d.basis.position.map((v,i)=>v+d.basis.forward[i]*radius);
    const pan=d.values.pan-dx*.15,tilt=clamp(d.values.tilt+dy*.15,-89,89),forward=cameraBasis(pan,tilt).forward;
    const p=pivot.map((v,i)=>v-forward[i]*radius);set('x',p[0]);set('y',p[1]);set('z',p[2]-CAM_D);set('pan',pan);set('tilt',tilt);
  }else{
    const amount=dy/(S.view.zoom||1)/Math.max(.01,d.values.zoom),v=mode==='dolly'?d.basis.forward.map(n=>n*amount):null;
    if(v){set('x',d.values.x+v[0]);set('y',d.values.y+v[1]);set('z',d.values.z+v[2]);}
    else{
      const q=cameraDragDelta(d.invView,sx,sy,d.sx,d.sy);if(e.shiftKey){if(Math.abs(q[0])>Math.abs(q[1]))q[1]=0;else q[0]=0;}
      const distance=Math.max(60,cameraDepth(d.basis,[0,0,0])),scale=distance/(CAM_D*d.values.zoom);
      const delta=d.basis.right.map((v,i)=>-(v*q[0]+d.basis.down[i]*q[1])*scale);
      set('x',d.values.x+delta[0]);set('y',d.values.y+delta[1]);set('z',d.values.z+delta[2]);
    }
  }
  requestDraw();
}
for(const [id,icon,name,key,mode,hint] of [
  ['camera','↔','Track Camera','4','track','Drag to track · Shift constrains · Alt-drag to dolly forward/back'],
  ['camzoom','⌕','Zoom Camera','5','zoom','Drag vertically to change focal length · camera position stays fixed'],
  ['camroll','↻','Roll Camera','6','roll','Drag horizontally to roll · Shift snaps to 15°'],
  ['campantilt','◎','Pan/Tilt Camera','7','pantilt','Drag to turn the camera · Shift constrains · Alt-drag orbits the current look point']
])defTool(id,{icon,name,key,cursor:'move',hint,down(e){cameraBegin(e,mode);},move:cameraMove,up(){if(Stage.drag?.cameraMode)commitEdit();}});
TOOL_GROUPS.find(g=>g[0]==='Camera')[1]=[...CAMERA_TOOLS];
defTool('orbitworkspace',{icon:'◇',name:'Orbit Workspace',key:'9',cursor:'grab',hint:'Inspect depth from outside the camera · changes your view only · Home returns to Camera view',
  down(e){CAMERA_VIEW.mode='orbit';startDrag(e,{workspaceOrbit:true,yaw:CAMERA_VIEW.yaw,pitch:CAMERA_VIEW.pitch});requestDraw();},
  move(e,sx,sy){const d=Stage.drag;if(!d?.workspaceOrbit)return;CAMERA_VIEW.yaw=d.yaw-(sx-d.sx)/(Stage.dpr||1)*.2;CAMERA_VIEW.pitch=clamp(d.pitch+(sy-d.sy)/(Stage.dpr||1)*.2,-85,85);requestDraw();},up(){}});
TOOL_GROUPS.find(g=>g[0]==='View')[1].push('orbitworkspace');
const cameraSetTool=setTool;
setTool=function(id){
  if(!TOOLS[id])return;
  const why=toolAvail(id);if(why)return toast(why,'err');
  S.camSel=CAMERA_TOOLS.has(id);cameraSetTool(id);renderProps();requestDraw();
};
const cameraFitView=fitView;
fitView=function(){CAMERA_VIEW.mode='camera';return cameraFitView();};
CMDS.find(c=>c.id==='view.fit').run=()=>fitView();
function cameraView(mode){
  CAMERA_VIEW.mode=mode;
  if(mode==='top'){CAMERA_VIEW.yaw=0;CAMERA_VIEW.pitch=80;}
  if(mode==='side'){CAMERA_VIEW.yaw=70;CAMERA_VIEW.pitch=8;}
  if(mode==='orbit'){CAMERA_VIEW.yaw=28;CAMERA_VIEW.pitch=24;}
  if(mode!=='camera'&&CAMERA_TOOLS.has(S.tool)){S.tool='orbitworkspace';S.camSel=true;}
  updateToolbar();renderToolOpts();renderProps();requestDraw();
}
function cameraResetKey(paths=['x','y','z','pan','tilt','zoom','roll']){
  const why=cameraEditReason();if(why)return toast(why,'err');
  return edit('Reset camera at playhead',()=>{for(const k of paths)setVal(S.doc.camera,k,S.frame===0?CAMERA_DEFAULTS[k]:baseGet(S.doc.camera,k),S.frame,S.frame>0);});
}
function cameraKeyPose(){const why=cameraEditReason();if(why)return toast(why,'err');return edit('Key camera pose',()=>{for(const k of ['x','y','z','pan','tilt','zoom','roll'])setVal(S.doc.camera,k,val(S.doc.camera,k,S.frame),S.frame,true);});}
function cameraTarget(){const L=selLayer();if(!L)return null;const lc=evalLC(L,S.frame),p=M.ap(lc.world,L.p.ox||0,L.p.oy||0);return [...p,lc.z];}
function cameraAim(){
  const target=cameraTarget();if(!target)return toast('Select a layer to aim at','err');const why=cameraEditReason();if(why)return toast(why,'err');
  const state=cameraStateAt(S.frame),v=target.map((n,i)=>n-state.position[i]);
  return edit('Aim camera at selection',()=>{setVal(S.doc.camera,'pan',Math.atan2(v[0],-v[2])/DEG);setVal(S.doc.camera,'tilt',clamp(Math.atan2(-v[1],Math.hypot(v[0],v[2]))/DEG,-89,89));});
}
function cameraFocus(){
  const target=cameraTarget();if(!target)return toast('Select a layer to focus on','err');const why=cameraEditReason();if(why)return toast(why,'err');
  edit('Focus camera on selection',()=>{S.doc.camera.dofEnabled=true;setVal(S.doc.camera,'focusDistance',clamp(cameraDepth(cameraStateAt(S.frame),target),1,1e7));});
}
const cameraSelect=()=>{CAMERA_VIEW.mode='camera';S.camSel=true;setTab('props');refreshAll();};
Object.assign(CMDS.find(c=>c.id==='cam.select'),{run:cameraSelect});
Object.assign(CMDS.find(c=>c.id==='cam.tool'),{label:'Track Camera',run:()=>setTool('camera')});
Object.assign(CMDS.find(c=>c.id==='cam.reset'),{en:()=>actActive()?'Return to Mainline to edit the scene camera':null,run:()=>edit('Remove all camera animation',()=>{const c=S.doc.camera;c.ch={};Object.assign(c.p,CAMERA_DEFAULTS);c.dofEnabled=false;})});
cmd('cam.zoom','Camera','Zoom Camera',()=>setTool('camzoom'));
cmd('cam.roll','Camera','Roll Camera',()=>setTool('camroll'));
cmd('cam.pantilt','Camera','Pan/Tilt Camera',()=>setTool('campantilt'));
cmd('cam.key','Camera','Key camera pose',cameraKeyPose,{en:()=>cameraEditReason()});
cmd('cam.resetkey','Camera','Reset camera at playhead',()=>cameraResetKey(),{en:()=>cameraEditReason()});
cmd('cam.aim','Camera','Aim at selected layer',cameraAim,{en:()=>cameraEditReason()||(!selLayer()?'Select a layer':null)});
cmd('cam.focus','Camera','Focus on selected layer',cameraFocus,{en:()=>cameraEditReason()||(!selLayer()?'Select a layer':null)});
cmd('cam.path','Camera','Show camera motion path',()=>{CAMERA_VIEW.showPath=!CAMERA_VIEW.showPath;renderProps();requestDraw();});
cmd('cam.view','View','Camera view',()=>cameraView('camera'));
cmd('cam.overview','View','3D workspace overview',()=>cameraView('orbit'));
cmd('cam.top','View','Workspace from above',()=>cameraView('top'));
cmd('cam.side','View','Workspace from side',()=>cameraView('side'));
cmd('cam.properties','Window','Camera properties',cameraSelect);

// ---------- Inspector, tool options and timeline ----------
Object.assign(CH_LABEL,{pan:'Camera Pan',tilt:'Camera Tilt',focusDistance:'Focus distance',focusRange:'Focus range',maxBlur:'Maximum focus blur'});
function cameraField(k,label,tool=false){
  const value=round(val(S.doc.camera,k,S.frame),3),[min,max]=CAMERA_LIMITS[k],disabled=cameraEditReason()?'disabled':'';
  const input=`<input type="number" data-cam="${k}" aria-label="${esc(label)}" value="${value}" step="${['zoom'].includes(k)?'.01':['pan','tilt','roll'].includes(k)?'.1':'1'}" min="${min}" max="${max}" ${disabled}>`;
  return tool?`<label>${label} ${input}</label>`:`<div class="prow" data-label="${esc(label.toLowerCase())}"><span class="pl nodrag">${label}</span><span class="pv">${input}</span>${keyBtn(S.doc.camera,k)}</div>`;
}
function cameraLens(tool=false){
  const disabled=cameraEditReason()?'disabled':'',fov=cameraFov(),mm=cameraFocalLength(),fields=[['fov','Field of view',fov,.1,170],['focal','Focal length (35mm)',mm,1,10000]];
  return fields.map(([k,label,v,min,max])=>tool?`<label>${k==='fov'?'FOV°':'Lens mm'} <input type="number" data-camlens="${k}" aria-label="${label}" value="${round(v,2)}" min="${min}" max="${max}" step=".1" ${disabled}></label>`:
    `<div class="prow"><span class="pl">${label}${k==='fov'?' °':' mm'}</span><span class="pv"><input type="number" data-camlens="${k}" aria-label="${label}" value="${round(v,2)}" min="${min}" max="${max}" step=".1" ${disabled}></span><span></span></div>`).join('');
}
function cameraViewButtons(){return `<div class="camera-views">${[['camera','Camera'],['orbit','3D overview'],['top','Above'],['side','Side']].map(([mode,label])=>`<button class="ib ${CAMERA_VIEW.mode===mode?'on':''}" data-camview="${mode}">${label}</button>`).join('')}</div>`;}
cameraProps=function(){
  return sec('Camera · '+(CAMERA_VIEW.mode==='camera'?'Scene view':'Workspace overview'),cameraViewButtons()+`<div class="camera-actions"><button class="ib" data-camcommand="cam.key">◆ Key pose</button><button class="ib" data-camcommand="cam.resetkey">Reset at playhead</button></div>`+
    ['x','y','z'].map((k,i)=>cameraField(k,['Track X','Track Y','Dolly Z'][i])).join('')+cameraField('pan','Pan °')+cameraField('tilt','Tilt °')+cameraField('roll','Roll °'))+
    sec('Lens',cameraLens()+cameraField('zoom','Zoom factor'))+
    sec('Depth of field',`<label class="camera-check"><input type="checkbox" data-camdof ${S.doc.camera.dofEnabled?'checked':''} ${cameraEditReason()?'disabled':''}> Enable depth of field</label>`+cameraField('focusDistance','Focus distance')+cameraField('focusRange','Focus falloff range')+cameraField('maxBlur','Maximum blur')+`<button class="ib camera-full" data-camcommand="cam.focus">Focus on selected layer</button>`)+
    sec('Camera movement',cameraField('shake','Shake amount')+cameraField('shakeFreq','Shake frequency')+`<label class="camera-check"><input type="checkbox" data-campath ${CAMERA_VIEW.showPath?'checked':''}> Show camera path in overview</label><label class="camera-check"><input type="checkbox" data-camguides ${CAMERA_VIEW.showGuides?'checked':''}> Frame guides</label><button class="ib camera-full" data-camcommand="cam.aim">Aim at selected layer</button>`)+
    sec('Notes','<div class="note">Camera moves belong to Mainline. Zoom changes the lens; Alt-drag with Track moves the camera in depth. Overview is for inspecting the scene and never changes exports.</div>','',true);
};
function cameraBindControls(el){
  el.querySelectorAll('[data-cam]').forEach(input=>input.onchange=()=>{
    const k=input.dataset.cam,n=Number(input.value);if(input.value.trim()===''||!Number.isFinite(n))return refreshAll();
    const why=cameraEditReason();if(why)return toast(why,'err');edit('Camera '+k,()=>setVal(S.doc.camera,k,clamp(n,...CAMERA_LIMITS[k])));input.blur();
  });
  el.querySelectorAll('[data-camlens]').forEach(input=>input.onchange=()=>{
    const n=Number(input.value);if(!Number.isFinite(n)||n<=0)return refreshAll();const why=cameraEditReason();if(why)return toast(why,'err');
    const fov=input.dataset.camlens==='focal'?2*Math.atan(12/n)/DEG:clamp(n,.1,170);
    edit('Camera lens',()=>setVal(S.doc.camera,'zoom',clamp(cameraZoomForFov(fov),...CAMERA_LIMITS.zoom)));input.blur();
  });
  el.querySelectorAll('[data-camview]').forEach(b=>b.onclick=()=>cameraView(b.dataset.camview));
  el.querySelectorAll('[data-camcommand]').forEach(b=>{const command=CMDS.find(c=>c.id===b.dataset.camcommand);b.disabled=!!command?.en?.();b.onclick=()=>runCmd(b.dataset.camcommand);});
  el.querySelectorAll('[data-camdof]').forEach(i=>i.onchange=()=>{if(cameraEditReason())return;edit('Camera depth of field',()=>S.doc.camera.dofEnabled=i.checked);});
  el.querySelectorAll('[data-campath]').forEach(i=>i.onchange=()=>{CAMERA_VIEW.showPath=i.checked;requestDraw();});
  el.querySelectorAll('[data-camguides]').forEach(i=>i.onchange=()=>{CAMERA_VIEW.showGuides=i.checked;requestDraw();});
  el.querySelectorAll('[data-camorbit]').forEach(i=>i.onchange=()=>{CAMERA_VIEW.orbitRadius=clamp(Number(i.value)||CAM_D,1,1e7);});
}
const cameraBindProps=bindProps;
bindProps=function(el){cameraBindProps(el);cameraBindControls(el);};
const cameraRenderOptions=renderToolOpts;
renderToolOpts=function(){
  if(!CAMERA_TOOLS.has(S.tool)&&S.tool!=='orbitworkspace')return cameraRenderOptions();
  const el=$('#toolopts');if(!el||el.contains(document.activeElement)&&document.activeElement.tagName==='INPUT')return;
  const t=TOOLS[S.tool],paths=S.tool==='camera'?['x','y','z']:S.tool==='camroll'?['roll']:S.tool==='campantilt'?['pan','tilt']:[];
  const html=`<span class="tname" title="${esc(t.hint)}">${t.icon} ${t.name}</span>`+paths.map(k=>cameraField(k,k.toUpperCase(),true)).join('')+
    (S.tool==='camzoom'?cameraLens(true):'')+(S.tool==='campantilt'?`<label>Orbit radius <input type="number" data-camorbit value="${CAMERA_VIEW.orbitRadius}" min="1" step="10"></label>`:'')+
    `<button class="ib" data-camview="camera">Camera view</button><button class="ib" data-camview="orbit">3D overview</button>`+
    (CAMERA_TOOLS.has(S.tool)?'<button class="ib" data-camcommand="cam.key">◆ Key</button><button class="ib" data-camcommand="cam.resetkey">Reset key</button>':'')+
    `<span class="hint">${esc(cameraEditReason()||t.hint)}</span>`;
  if(el._h===html)return;el._h=html;el.innerHTML=html;cameraBindControls(el);
};
const cameraTimelineOwners=timelineOwners;
timelineOwners=function(){
  let owners=cameraTimelineOwners();if(actActive())return owners.filter(o=>o.id!=='CAM');
  if(!CAMERA_VIEW.hideKeys&&!owners.some(o=>o.id==='CAM')&&Object.values(S.doc.camera.ch).some(ch=>ch.keys?.length))owners=[S.doc.camera,...owners];
  return owners;
};
const cameraChannelGroups=channelGroups;
channelGroups=function(o){
  if(o.id!=='CAM')return cameraChannelGroups(o);
  return [['Camera Tracking',['x','y','z']],['Camera Pan/Tilt',['pan','tilt']],['Camera Zoom',['zoom']],['Camera Roll',['roll']],['Camera Shake',['shake','shakeFreq']],['Camera Focus',['focusDistance','focusRange','maxBlur']]]
    .map(([label,paths])=>({key:label,label,paths:paths.filter(p=>o.ch[p]?.keys.length),selected:false})).filter(g=>g.paths.length);
};
const cameraTimelineContext=renderTimelineContext;
renderTimelineContext=function(){
  cameraTimelineContext();const el=$('#tlcontext');if(!el||el.querySelector('[data-hidecam]'))return;
  const label=document.createElement('label');label.innerHTML=`<input type="checkbox" data-hidecam ${CAMERA_VIEW.hideKeys?'checked':''}> Hide camera keys`;
  const input=label.querySelector('input');if(input)input.onchange=e=>{CAMERA_VIEW.hideKeys=e.target.checked;requestDraw();};el.appendChild(label);
};
const cameraCurrentPose=keyCurrentTimelinePose;
keyCurrentTimelinePose=function(){if(S.camSel||CAMERA_TOOLS.has(S.tool))return cameraKeyPose();return cameraCurrentPose();};
CMDS.find(c=>c.id==='anim.keyall').run=keyCurrentTimelinePose;
LS_FIELDS.push({k:'faceCamera',tab:'General',label:'Rotate to face camera',type:'check',when:L=>L.type!=='audio',get:L=>!!L.faceCamera,set:(L,v)=>{L.faceCamera=!!v;}});
LS_FIELDS.push({k:'immuneDOF',tab:'General',label:'Immune to depth of field',type:'check',when:L=>L.type!=='audio',get:L=>!!L.immuneDOF,set:(L,v)=>{L.immuneDOF=!!v;}});

// External-view camera path, orientation and frustum. These are editor overlays.
function cameraDrawOverview(ctx){
  const dpr=Stage.dpr||1,V=viewM(),viewer=cameraWorkspaceState(S.frame),state=cameraStateAt(S.frame),overview=CAMERA_VIEW.mode!=='camera'&&!S.outputOnly;
  if(S.outputOnly)return;
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.lineWidth=dpr;ctx.font=`${11*dpr}px sans-serif`;
  if(overview){
    const project=p=>{const q=cameraProject(viewer,p);return q.depth>CAMERA_NEAR?M.ap(V,q.x,q.y):null;};
    const line=(a,b,color)=>{a=project(a);b=project(b);if(!a||!b)return;ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();};
    for(let n=-4;n<=4;n++){line([-1000,n*250,0],[1000,n*250,0],'#62708055');line([n*250,-1000,0],[n*250,1000,0],'#62708055');}
    if(CAMERA_VIEW.showPath){
      const end=Math.min(100000,S.doc.end),step=Math.max(1,Math.ceil(end/600));let previous=null;ctx.strokeStyle='#65caff';ctx.beginPath();
      for(let f=0;f<=end;f+=step){const p=project(cameraStateAt(f).position);if(p){previous?ctx.lineTo(...p):ctx.moveTo(...p);}previous=p;}ctx.stroke();
      const frames=new Set(['x','y','z'].flatMap(k=>(S.doc.camera.ch[k]?.keys||[]).map(k=>k.f)));
      for(const f of frames){const p=project(cameraStateAt(f).position);if(!p)continue;ctx.fillStyle='#65caff';ctx.fillRect(p[0]-3*dpr,p[1]-3*dpr,6*dpr,6*dpr);ctx.fillText(String(f),p[0]+5*dpr,p[1]-5*dpr);}
    }
    const distance=350,halfH=distance*Math.tan(cameraFov(state.zoom)*DEG/2),halfW=halfH*S.doc.w/S.doc.h;
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>state.position.map((v,i)=>v+state.forward[i]*distance+state.right[i]*x*halfW+state.down[i]*y*halfH));
    corners.forEach((p,i)=>{line(state.position,p,'#ffb55b');line(p,corners[(i+1)%4],'#ffb55b');});
    const p=project(state.position);if(p){ctx.fillStyle='#ffb55b';ctx.fillText('Camera',p[0]+8*dpr,p[1]);}
    ctx.fillStyle='#b8dfff';ctx.fillText('3D WORKSPACE · editor view only · Home returns to Camera',16*dpr,ctx.canvas.height-18*dpr);
  }else if(CAMERA_VIEW.showGuides&&(S.camSel||CAMERA_TOOLS.has(S.tool))){
    ctx.strokeStyle='#ffffff35';ctx.setLineDash([4*dpr,4*dpr]);
    const a=M.ap(V,-S.doc.w/2,-S.doc.h/2),b=M.ap(V,S.doc.w/2,S.doc.h/2);
    for(const t of [1/3,2/3]){ctx.beginPath();ctx.moveTo(lerp(a[0],b[0],t),a[1]);ctx.lineTo(lerp(a[0],b[0],t),b[1]);ctx.moveTo(a[0],lerp(a[1],b[1],t));ctx.lineTo(b[0],lerp(a[1],b[1],t));ctx.stroke();}
  }
  ctx.restore();
}
const cameraOverlays=drawOverlays;
drawOverlays=function(ctx){cameraOverlays(ctx);cameraDrawOverview(ctx);};
const cameraStartDoc=startDoc;
startDoc=function(d){cameraMigrate(d);CAMERA_VIEW.mode='camera';return cameraStartDoc(d);};
Object.assign(window.PopaiApp,{val,setVal,setTool,toolAvail,startDoc,validateProject,keyCurrentTimelinePose,
  cameraStateAt,cameraWorkspaceState,cameraDepth,cameraProject,camFn,stageCamFn,cameraFov,cameraZoomForFov,cameraFocalLength,
  cameraView,cameraResetKey,cameraKeyPose,cameraAim,cameraFocus,cameraFullMatrix,cameraDofRadius,cameraProjection,cameraDragDelta,
  CAMERA_VIEW,CAMERA_WARP,M,newDoc,mkLayer,layerCtx,evalLC,lcOf,hitLayerEntry,renderStage,renderFrameCanvas,depthSorted,TOOLS,
  cameraMigrate,cameraEditReason,cameraMove,cameraBegin,cameraPlaneBounds,cameraWarpPlane,actOpen,timelineOwners,buildRows,cameraProps,validateCmd,
  actCreate,actCreateForSelectedBone,actActive,actOwnsLayer,actInsertCopy,actSubtree,actPreviewFrame,actProceduralFrame,timelineEnd,timelineMarkers,audioLayers,deleteSelectedKeys,pasteKeys,orderAt});
