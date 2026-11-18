/* Vector editing: geometry, appearance and animation are independent.
   pv:<point>:<property> and curve:<path>:<property> belong to the vector layer. */
const VEC = {
  lasso:false,group:'',groupName:'',simplify:80,autoWeld:true,sharp:false,handles:false,fixed:false,
  shape:'rectangle',horizontal:4,vertical:4,radius:70,strength:0.6,spacing:24,scatter:25,
  smoothing:2,reduction:1.5,weldEnds:true,multiFill:false,pressureWidth:true,pressureAlpha:false,
  taper:0,colorDrift:0,pointColor:'#ff8050',colorStrength:0.7,colorRadius:80,profile:'',repeats:1,offset:0,lwMagnet:false,lwRadius:80,
};
const VECTOR_DRAW = ['points','pointtf','pen','curvature','freehand','drawshape','deleteedge','magnet','blob','eraser','reduce','scatter','perspective','shear','bend','noise'];
const VECTOR_FILL = ['shapeselect','createshape','fill','deleteshape','linewidth','hideedge','exposure','profile','colorpoints'];
const VECTOR_TOPOLOGY = new Set(['pen','freehand','drawshape','rect','ellipse','polygon','deleteedge','blob','eraser','reduce','scatter','createshape','deleteshape']);
for(const id of [...VECTOR_DRAW,...VECTOR_FILL])POINT_TOOLS.add(id);
for(const id of ['drawshape','blob','scatter'])TOOLS_DRAW.add(id);
TOOL_GROUPS[0][1]=['select','text'];
TOOL_GROUPS[1]=['Draw',VECTOR_DRAW]; TOOL_GROUPS[2]=['Fill',VECTOR_FILL];
const vectorOldAvail=toolAvail;
toolAvail=function(id){
  if(!VECTOR_DRAW.includes(id)&&!VECTOR_FILL.includes(id))return vectorOldAvail(id);
  const L=selLayer();
  if(!L&&TOOLS_DRAW.has(id))return S.mode==='setup'?null:'Create geometry in Setup mode';
  if(!L||L.type!=='vector')return L?.type==='switch'?'Select a drawing inside this Switch Group':'Select a vector drawing to use this tool';
  return writeReason(L)||(VECTOR_TOPOLOGY.has(id)&&S.mode!=='setup'?'Change drawing topology in Setup mode':null);
};
function vectorAction(label,fn,topology=false){
  const L=selLayer(); if(!L||L.type!=='vector')return toast('Select a vector drawing','err');
  const why=writeReason(L)||(topology&&S.mode!=='setup'?'Change drawing topology in Setup mode':null);
  if(why)return toast(why,'err'); return edit(label,()=>fn(L));
}
function vectorIDs(L){return [...S.selPts].filter(id=>L.pts[id]);}
function vectorCenter(L,ids=vectorIDs(L),f=S.frame){
  if(!ids.length)return [0,0]; const P=ids.map(id=>val(L,'pt:'+id,f));
  return [(Math.min(...P.map(p=>p[0]))+Math.max(...P.map(p=>p[0])))/2,(Math.min(...P.map(p=>p[1]))+Math.max(...P.map(p=>p[1])))/2];
}
function vectorTransform(L,fn,ids=vectorIDs(L)){
  for(const id of ids)setVal(L,'pt:'+id,fn(val(L,'pt:'+id,S.frame),id));
}
function vectorCleanup(L){
  const used=new Set(L.paths.flatMap(p=>p.pts));
  for(const id of Object.keys(L.pts))if(!used.has(id))delete L.pts[id];
  const pathIDs=new Set(L.paths.map(p=>p.id)),shapeIDs=new Set(L.shapes.map(s=>s.id));
  for(const p of L.paths){if(p.profile&&!pathIDs.has(p.profile))p.profile=null;for(const k of Object.keys(p))if(k.startsWith('hide_')&&!p.pts.includes(k.slice(5)))delete p[k];}
  for(const s of L.shapes)s.paths=s.paths.filter(id=>pathIDs.has(id));
  L.shapes=L.shapes.filter(s=>s.paths.length);
  for(const k of Object.keys(L.ch)){const [kind,id,prop]=k.split(':');if((['pv','pt'].includes(kind)&&!L.pts[id])||(kind==='curve'&&(!pathIDs.has(id)||prop.startsWith('hide_')&&!L.paths.find(p=>p.id===id).pts.includes(prop.slice(5))))||(kind==='sh'&&(!shapeIDs.has(id)||!L.shapes.some(s=>s.id===id))))delete L.ch[k];}
  for(const g of L.pointGroups||[])g.points=g.points.filter(id=>L.pts[id]);
  S.selPts=new Set(vectorIDs(L)); if(!L.shapes.some(s=>s.id===S.selShape))S.selShape=null;
}
const vectorOldDeletePoints=deletePoints;
deletePoints=function(L,ids){vectorOldDeletePoints(L,ids);vectorCleanup(L);};
function vectorPathPoints(L,f=0){return Object.fromEntries(Object.keys(L.pts).map(id=>[id,val(L,'pt:'+id,f)]));}
function vectorOffset(L,id,v,lc){
  const B=lc?.B;if(!B||lc.bound)return v;
  const p=L.pts[id],weights=pointBoneWeights(L,p,B,lc.relPts,layerFlexSegs(L,B))||[];
  if(!weights.length)return v;
  const q=M.apv(lc.relPts,v[0],v[1]);let x=0,y=0,w=0;
  for(const [bid,n]of weights){if(!B.D[bid])continue;const a=M.apv(B.D[bid],q[0],q[1]);x+=a[0]*n;y+=a[1]*n;w+=n;}
  return w?M.apv(M.inv(lc.relPts),x/w,y/w):v;
}
function vectorCubic(L,path,i,P,f=S.frame,lc=null){
  const ids=path.pts,n=ids.length,ix=j=>path.closed?(j+n)%n:clamp(j,0,n-1),id=ids[ix(i)],next=ids[ix(i+1)];
  const a=P[ids[ix(i-1)]],b=P[id],c=P[next],d=P[ids[ix(i+2)]];
  const k1=val(L,'pv:'+id+':c',f)/6,k2=val(L,'pv:'+next+':c',f)/6;
  let h1=[(c[0]-a[0])*k1,(c[1]-a[1])*k1],h2=[-(d[0]-b[0])*k2,-(d[1]-b[1])*k2];
  if(L.pts[id].hout||L.ch['pv:'+id+':hout'])h1=vectorOffset(L,id,val(L,'pv:'+id+':hout',f),lc);
  if(L.pts[next].hin||L.ch['pv:'+next+':hin'])h2=vectorOffset(L,next,val(L,'pv:'+next+':hin',f),lc);
  return [b,[b[0]+h1[0],b[1]+h1[1]],[c[0]+h2[0],c[1]+h2[1]],c];
}
function vectorBezier(q,t){const u=1-t;return [0,1].map(k=>u*u*u*q[0][k]+3*u*u*t*q[1][k]+3*u*t*t*q[2][k]+t*t*t*q[3][k]);}
function vectorSplitCubic(q,t){const a=mixVal(q[0],q[1],t),b=mixVal(q[1],q[2],t),c=mixVal(q[2],q[3],t),d=mixVal(a,b,t),e=mixVal(b,c,t),p=mixVal(d,e,t);return [[q[0],a,d,p],[p,e,c,q[3]]];}
function vectorSub(a,b){return [a[0]-b[0],a[1]-b[1]];}
tracePath=function(ctx,L,path,P,f=S.frame,lc=null){
  if(path.pts.length<2)return;const p=P[path.pts[0]];if(!p)return;ctx.moveTo(...p);
  const n=path.pts.length-(path.closed?0:1);
  for(let i=0;i<n;i++){const q=vectorCubic(L,path,i,P,f,lc);ctx.bezierCurveTo(...q[1],...q[2],...q[3]);}
  if(path.closed)ctx.closePath();
};
function vectorSamples(L,path,P,f=S.frame,lc=null){
  const out=[];let length=0,previous=null;
  for(let i=0;i<path.pts.length-(path.closed?0:1);i++){
    const q=vectorCubic(L,path,i,P,f,lc),estimate=q.slice(1).reduce((s,p,j)=>s+Math.hypot(...vectorSub(p,q[j])),0);
    const steps=clamp(Math.ceil(estimate/5),8,128);
    for(let j=i?1:0;j<=steps;j++){
      const t=j/steps,p=vectorBezier(q,t);if(previous)length+=Math.hypot(...vectorSub(p,previous));
      out.push({p,i,t,length});previous=p;
    }
  }
  for(const a of out)a.u=length?a.length/length:0;return out;
}
hitSegment=function(L,sx,sy){
  const lc=lcOf(L);let best=null,dist=9*Stage.dpr;
  for(const path of L.paths){const s=vectorSamples(L,path,lc.P,S.frame,lc);for(let j=1;j<s.length;j++){
    const a=M.ap(lc.full,...s[j-1].p),b=M.ap(lc.full,...s[j].p),d=distToSeg(sx,sy,a,b);
    if(d<dist){const dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((sx-a[0])*dx+(sy-a[1])*dy)/(dx*dx+dy*dy||1),0,1),v=s[j];
      best={path,index:v.i,t:lerp(s[j-1].i===v.i?s[j-1].t:0,v.t,t)};dist=d;}
  }}return best;
};
function vectorInsert(L,path,index,t=0.5){
  const first=path.pts[index],last=path.pts[(index+1)%path.pts.length],frames=new Set([0]);
  for(const [key,c]of Object.entries(L.ch)){const [kind,id,prop]=key.split(':');if(path.pts.includes(id)&&(kind==='pt'||kind==='pv'&&['c','hin','hout'].includes(prop)))for(const k of c.keys)frames.add(k.f);}
  const poses=[...frames].sort((a,b)=>a-b).map(f=>({f,split:vectorSplitCubic(vectorCubic(L,path,index,vectorPathPoints(L,f),f),t),hin:vectorAutoHandle(L,first,'hin',f),hout:vectorAutoHandle(L,last,'hout',f)}));
  const [a,b]=poses[0].split;
  const id=addPoint(L,...a[3],1);
  if(!L.pts[first].hin&&!L.ch['pv:'+first+':hin'])L.pts[first].hin=poses[0].hin;
  if(!L.pts[last].hout&&!L.ch['pv:'+last+':hout'])L.pts[last].hout=poses[0].hout;
  L.pts[first].hout=vectorSub(a[1],a[0]);L.pts[last].hin=vectorSub(b[2],b[3]);
  L.pts[id].hin=vectorSub(a[2],a[3]);L.pts[id].hout=vectorSub(b[1],b[0]);
  for(const k of ['width','alpha','strength'])L.pts[id][k]=lerp(baseGet(L,'pv:'+first+':'+k),baseGet(L,'pv:'+last+':'+k),t);
  if(L.pts[first].b)L.pts[id].b=clone(L.pts[first].b);
  path.pts.splice(index+1,0,id);
  for(const pose of poses.slice(1)){const [a,b]=pose.split,f=pose.f;setVal(L,'pt:'+id,a[3],f,true);
    for(const [pid,side,v]of [[first,'hin',pose.hin],[first,'hout',vectorSub(a[1],a[0])],[last,'hin',vectorSub(b[2],b[3])],[last,'hout',pose.hout],[id,'hin',vectorSub(a[2],a[3])],[id,'hout',vectorSub(b[1],b[0])]])setVal(L,'pv:'+pid+':'+side,v,f,true);
  }return id;
}
function vectorSplitSelected(L){
  const selected=new Set(vectorIDs(L)),added=[];
  for(const p of L.paths)for(let i=p.pts.length-(p.closed?1:2);i>=0;i--)if(selected.has(p.pts[i])&&selected.has(p.pts[(i+1)%p.pts.length]))added.push(vectorInsert(L,p,i));
  S.selPts=new Set([...selected,...added]);return added;
}
function vectorWeld(L,remove,keep){
  if(remove===keep)return;
  if(S.selPts.has(remove))S.selPts.add(keep);
  for(const p of L.paths){p.pts=p.pts.map(id=>id===remove?keep:id).filter((id,i,a)=>!i||a[i-1]!==id);if(p.pts.length>2&&p.pts[0]===p.pts.at(-1)){p.pts.pop();p.closed=true;}}
  for(const g of L.pointGroups||[])g.points=[...new Set(g.points.map(id=>id===remove?keep:id))];
  delete L.pts[remove];L.paths=L.paths.filter(p=>p.pts.length>=2);vectorCleanup(L);
}
function vectorCross(a,b,c,d){const r=vectorSub(b,a),s=vectorSub(d,c),den=r[0]*s[1]-r[1]*s[0];if(Math.abs(den)<1e-8)return null;const q=vectorSub(c,a),t=(q[0]*s[1]-q[1]*s[0])/den,u=(q[0]*r[1]-q[1]*r[0])/den;return t>=-1e-7&&t<=1+1e-7&&u>=-1e-7&&u<=1+1e-7?[clamp(t,0,1),clamp(u,0,1)]:null;}
function vectorWeldCrossings(L){
  // Find intersections on adaptively sampled cubic segments; insert with De Casteljau.
  const P=vectorPathPoints(L),segments=[];
  for(const p of L.paths)for(let i=0;i<p.pts.length-(p.closed?0:1);i++)if(!S.selPts.size||S.selPts.has(p.pts[i])||S.selPts.has(p.pts[(i+1)%p.pts.length]))segments.push({p,i,q:vectorCubic(L,p,i,P,0)});
  if(segments.length>400)throw Error('Select fewer than 400 segments to weld crossings');
  const events=[];
  for(let a=0;a<segments.length;a++)for(let b=a+1;b<segments.length;b++){
    const A=segments[a],B=segments[b];if(A.p===B.p&&(Math.abs(A.i-B.i)<=1||(A.p.closed&&Math.abs(A.i-B.i)===A.p.pts.length-1)))continue;
    for(let i=0;i<16;i++)for(let j=0;j<16;j++){
      const x=vectorCross(vectorBezier(A.q,i/16),vectorBezier(A.q,(i+1)/16),vectorBezier(B.q,j/16),vectorBezier(B.q,(j+1)/16));
      if(x){const ta=(i+x[0])/16,tb=(j+x[1])/16;if(ta<1e-5||ta>1-1e-5||tb<1e-5||tb>1-1e-5||events.some(e=>e.A===A&&e.B===B&&Math.abs(e.ta-ta)<1e-4&&Math.abs(e.tb-tb)<1e-4))continue;events.push({A,ta,B,tb});if(events.length>300)throw Error('Too many crossings; select a smaller area');}
    }
  }
  const insertions=new Map();for(const e of events)for(const [s,t,k]of [[e.A,e.ta,'a'],[e.B,e.tb,'b']]){if(!insertions.has(s))insertions.set(s,[]);insertions.get(s).push({t,e,k});}
  for(const s of [...insertions.keys()].sort((a,b)=>b.i-a.i)){let upper=1,previous=-1,last=null;for(const a of insertions.get(s).sort((a,b)=>b.t-a.t)){if(Math.abs(a.t-previous)<1e-4){a.e[a.k]=last;continue;}last=a.e[a.k]=vectorInsert(L,s.p,s.i,a.t/upper);upper=a.t;previous=a.t;}}
  const aliases=new Map(),root=id=>{while(aliases.has(id))id=aliases.get(id);return id;};
  for(const e of events){const a=root(e.a),b=root(e.b);if(a!==b&&L.pts[a]&&L.pts[b]){vectorWeld(L,b,a);aliases.set(b,a);}}return events.length;
}
function vectorSimplify(L,amount=VEC.simplify){
  const eps=Math.max(0.01,(100-clamp(amount,0,100))*0.12),counts={};for(const p of L.paths)for(const id of p.pts)counts[id]=(counts[id]||0)+1;
  for(const p of L.paths){if(p.pts.length<4)continue;
    const raw=p.pts.map(id=>[L.pts[id].x,L.pts[id].y,id]),run=p.closed?raw.concat([raw[0]]):raw,kept=new Set(rdp(run,eps).map(a=>a[2]));
    p.pts=p.pts.filter(id=>kept.has(id)||counts[id]>1||(S.selPts.size&&!S.selPts.has(id)));
    if(p.closed&&p.pts.length<3)p.pts=raw.slice(0,3).map(p=>p[2]);
    for(const id of p.pts){delete L.pts[id].hin;delete L.pts[id].hout;}
  }vectorCleanup(L);
}
function vectorProfileSampler(L,path,f){
  const profile=L.paths.find(p=>p.id===path.profile);if(!profile||profile===path||profile.closed||profile.pts.length<2)return 1;
  const samples=vectorSamples(L,profile,vectorPathPoints(L,f),f),xs=samples.map(a=>a.p[0]),ys=samples.map(a=>a.p[1]);
  const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),repeats=clamp(val(L,'curve:'+path.id+':repeats',f),1,64),off=val(L,'curve:'+path.id+':offset',f);
  if(x1-x0<1e-9||y1-y0<1e-9)return ()=>1;
  return u=>{let t=u*repeats+off;t=t===repeats?1:((t%1)+1)%1;const x=lerp(x0,x1,t);
  for(let i=1;i<samples.length;i++){const a=samples[i-1].p,b=samples[i].p;if(x>=Math.min(a[0],b[0])&&x<=Math.max(a[0],b[0]))return 0.05+1.95*(lerp(a[1],b[1],(x-a[0])/(b[0]-a[0]||1))-y0)/(y1-y0||1);}
  return 1;};
}
function vectorProfileWidth(L,path,u,f){const sample=vectorProfileSampler(L,path,f);return typeof sample==='function'?sample(u):1;}
function vectorStrokePieces(L,path,P,f=S.frame,lc=null){
  const s=vectorSamples(L,path,P,f,lc),start=clamp(val(L,'curve:'+path.id+':start',f),0,1),end=clamp(val(L,'curve:'+path.id+':end',f),0,1),out=[],profile=vectorProfileSampler(L,path,f);
  for(let j=1;j<s.length;j++){
    let a=s[j-1],b=s[j];if(end<=start||b.u<=start||a.u>=end)continue;
    const i=b.i,id=path.pts[i],next=path.pts[(i+1)%path.pts.length];if(val(L,'curve:'+path.id+':hide_'+id,f))continue;
    const low=Math.max(a.u,start),high=Math.min(b.u,end),span=b.u-a.u||1;
    const aa=mixVal(a.p,b.p,(low-a.u)/span),bb=mixVal(a.p,b.p,(high-a.u)/span),t=(a.i===i?a.t:0)+(b.t-(a.i===i?a.t:0))*((low+high)/2-a.u)/span;
    const attr=k=>mixVal(val(L,'pv:'+id+':'+k,f),val(L,'pv:'+next+':'+k,f),t);
    out.push({a:aa,b:bb,width:clamp(attr('width'),0,100)*(typeof profile==='function'?profile((low+high)/2):1),alpha:clamp(attr('alpha'),0,1),color:attr('color'),strength:clamp(attr('strength'),0,1)});
  }return out;
}
function drawVectorContent(ctx,L,R,lc){
  const f=R.f,P=(lc.P=deformedPts(L,f,lc));M.set(ctx,lc.full);ctx.lineJoin='round';ctx.lineCap='round';
  for(const sh of L.shapes){
    const st=shapeStyle(L,sh,f),paths=sh.paths.map(id=>L.paths.find(p=>p.id===id)).filter(Boolean);
    const trace=()=>{ctx.beginPath();for(const p of paths)tracePath(ctx,L,p,P,f,lc);};
    if(st.fillOn){trace();ctx.fillStyle=st.fill;ctx.fill('evenodd');
      const colored=[...new Set(paths.flatMap(p=>p.pts))].filter(id=>val(L,'pv:'+id+':strength',f)>0);
      if(colored.length){ctx.save();trace();ctx.clip('evenodd');for(const id of colored){const q=P[id],r=L.pts[id].colorRadius||VEC.colorRadius,col=val(L,'pv:'+id+':color',f),s=clamp(val(L,'pv:'+id+':strength',f),0,1),g=ctx.createRadialGradient(...q,0,...q,r);g.addColorStop(0,col);g.addColorStop(1,col+'00');ctx.save();ctx.globalAlpha*=s;ctx.fillStyle=g;ctx.fillRect(q[0]-r,q[1]-r,2*r,2*r);ctx.restore();}ctx.restore();}
    }
    if(st.strokeOn&&st.width>0)for(const p of paths){
      const special=p.profile||['start','end'].some(k=>L.ch['curve:'+p.id+':'+k])||p.start||p.end!==undefined&&p.end!==1||Object.keys(p).some(k=>k.startsWith('hide_')&&p[k])||Object.keys(L.ch).some(k=>k.startsWith('curve:'+p.id+':hide_'))||p.pts.some(id=>['width','alpha','strength'].some(k=>(L.pts[id][k]!==undefined&&L.pts[id][k]!==({width:1,alpha:1,strength:0}[k]))||L.ch['pv:'+id+':'+k]));
      if(!special){ctx.beginPath();tracePath(ctx,L,p,P,f,lc);ctx.lineWidth=st.width;ctx.strokeStyle=st.stroke;ctx.stroke();continue;}
      const pieces=vectorStrokePieces(L,p,P,f,lc);ctx.save();
      // A clipped collection of short rounded strokes supports variable width, color and exposure.
      const opacity=ctx.globalAlpha;for(const v of pieces){if(v.width<=0||v.alpha<=0)continue;ctx.globalAlpha=opacity*v.alpha;ctx.lineWidth=Math.min(10000,st.width*v.width);ctx.strokeStyle=v.strength?mixColor(st.stroke,v.color,v.strength):st.stroke;ctx.beginPath();ctx.moveTo(...v.a);ctx.lineTo(...v.b);ctx.stroke();}ctx.restore();
    }
  }
}
const vectorOldDrawContent=drawContent;
drawContent=function(ctx,L,R,lc){if(L.type==='vector')drawVectorContent(ctx,L,R,lc);else vectorOldDrawContent(ctx,L,R,lc);};

// ---------- selection, transforms and editable Bézier handles ----------
function vectorInside(p,polygon){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;}
function vectorAutoHandle(L,id,side,f=0){
  const p=L.paths.find(p=>p.pts.includes(id));if(!p)return [0,0];const i=p.pts.indexOf(id),P=vectorPathPoints(L,f);
  if(side==='hout'&&(p.closed||i<p.pts.length-1)){const q=vectorCubic(L,p,i,P,f);return vectorSub(q[1],q[0]);}
  if(side==='hin'&&(p.closed||i>0)){const q=vectorCubic(L,p,(i-1+p.pts.length)%p.pts.length,P,f);return vectorSub(q[2],q[3]);}
  return [0,0];
}
function vectorHandles(L){
  const lc=lcOf(L),out=[];
  for(const id of vectorIDs(L))for(const side of ['hin','hout']){
    const manual=L.pts[id][side]||L.ch['pv:'+id+':'+side],v=manual?val(L,'pv:'+id+':'+side,S.frame):vectorAutoHandle(L,id,side,S.frame),q=vectorOffset(L,id,v,lc),p=lc.P[id];
    out.push({id,side,p:M.ap(lc.full,p[0]+q[0],p[1]+q[1]),origin:M.ap(lc.full,...p)});
  }return out;
}
const vectorOldOverlays=drawOverlays;
drawOverlays=function(ctx){vectorOldOverlays(ctx);const L=selLayer();
  if(L?.type==='vector'&&VEC.handles&&['points','pointtf','pen','curvature'].includes(S.tool)){
    ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='#75dccb';ctx.fillStyle='#193e3a';ctx.lineWidth=Stage.dpr;
    for(const h of vectorHandles(L)){ctx.beginPath();ctx.moveTo(...h.origin);ctx.lineTo(...h.p);ctx.stroke();ctx.beginPath();ctx.arc(...h.p,3.5*Stage.dpr,0,Math.PI*2);ctx.fill();ctx.stroke();}
  }
  if(Stage.vectorLasso){ctx.strokeStyle='#a9d5ff';ctx.lineWidth=Stage.dpr;ctx.beginPath();Stage.vectorLasso.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.stroke();}
  if(L?.type==='vector'&&['magnet','eraser','blob','noise'].includes(S.tool)){ctx.setTransform(1,0,0,1,0,0);ctx.strokeStyle='#ffffff80';ctx.lineWidth=Stage.dpr;ctx.beginPath();ctx.arc(...Stage.mouse,VEC.radius*S.view.zoom*Stage.dpr,0,Math.PI*2);ctx.stroke();}
};
const vectorOverlaysBeforeMoho=drawOverlays;
drawOverlays=function(ctx){vectorOverlaysBeforeMoho(ctx);const L=selLayer(),dpr=Stage.dpr||1;if(S.outputOnly||L?.type!=='vector')return;ctx.setTransform(1,0,0,1,0,0);
  if(S.tool==='pen'){const d=Stage.drag,skip=d?.mode==='penpt'?new Set([d.id]):new Set(),t=(!d||d.mode==='penpt'&&(d.moved||!d.clickOnly))&&(!d||VEC.autoWeld)?vectorPenTarget(L,...Stage.mouse,Stage.mods?.alt,skip):null;
    if(t){ctx.lineWidth=2*dpr;ctx.strokeStyle=t.kind==='point'?'#3ddc6b':'#ff4b4b';ctx.beginPath();ctx.arc(...t.at,(t.kind==='point'?7:5)*dpr,0,Math.PI*2);ctx.stroke();}}
  if(S.tool==='linewidth'&&VEC.lwMagnet){ctx.strokeStyle='#ffffff80';ctx.lineWidth=dpr;ctx.setLineDash([4*dpr,3*dpr]);ctx.beginPath();ctx.arc(...Stage.mouse,VEC.lwRadius*S.view.zoom*dpr,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
};
const vectorPointTF={...TOOLS.points};
defTool('pointtf',{...vectorPointTF,icon:svgI('<path d="M12 2v20M2 12h20m-7-7-3-3-3 3m6 14-3 3-3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>'),name:'Transform points',key:'G',hint:'Move points · bounding handles scale / rotate · optional editable Bézier handles',
  down(e,sx,sy){
    const L=selLayer();if(!L||L.type!=='vector')return;
    const h=VEC.handles&&vectorHandles(L).find(h=>Math.hypot(h.p[0]-sx,h.p[1]-sy)<7*Stage.dpr);
    if(h){beginEdit('Bézier handle');for(const side of ['hin','hout'])if(!L.pts[h.id][side]&&!L.ch['pv:'+h.id+':'+side])L.pts[h.id][side]=vectorAutoHandle(L,h.id,side,0);
      const a=vectorOffset(L,h.id,[1,0],lcOf(L)),b=vectorOffset(L,h.id,[0,1],lcOf(L)),deform=M.inv([a[0],a[1],b[0],b[1],0,0]);
      startDrag(e,{mode:'handle',L,h,inv:M.inv(lcOf(L).full),deform,origin:lcOf(L).P[h.id],opposite:val(L,'pv:'+h.id+':'+(h.side==='hin'?'hout':'hin'),S.frame)});return;
    }vectorPointTF.down.call(this,e,sx,sy);
    const d=Stage.drag;if(d?.start){d.oldHandles={};for(const id in d.start)for(const side of ['hin','hout'])if(L.pts[id][side]||L.ch['pv:'+id+':'+side])d.oldHandles[id+':'+side]=val(L,'pv:'+id+':'+side,S.frame);}
  },
  move(e,sx,sy){const d=Stage.drag;if(!d)return;
    if(d.mode==='handle'){const p=M.ap(d.inv,sx,sy),v=M.apv(d.deform,p[0]-d.origin[0],p[1]-d.origin[1]);setVal(d.L,'pv:'+d.h.id+':'+d.h.side,v);
      if(VEC.fixed&&!e.altKey){const len=Math.hypot(...d.opposite),n=Math.hypot(...v)||1;setVal(d.L,'pv:'+d.h.id+':'+(d.h.side==='hin'?'hout':'hin'),[-v[0]*len/n,-v[1]*len/n]);}requestDraw();return;}
    vectorPointTF.move.call(this,e,sx,sy);
    if(d.mode==='rot'||d.mode==='scale'){const a=d.mode==='rot'?Math.atan2(sy-d.cs[1],sx-d.cs[0])-Math.atan2(d.sy-d.cs[1],d.sx-d.cs[0]):0,k=d.mode==='scale'?Math.hypot(sx-d.cs[0],sy-d.cs[1])/(Math.hypot(d.sx-d.cs[0],d.sy-d.cs[1])||1):1;
      for(const [key,v]of Object.entries(d.oldHandles||{}))setVal(d.L,'pv:'+key,M.apv(M.chain(M.r(a),M.s(k)),...v));}
  },
  up(){const d=Stage.drag;if(d?.L&&d.mode==='move'&&VEC.autoWeld&&S.mode==='setup'){
      for(const id of [...S.selPts]){const p=d.L.pts[id];if(!p)continue;const other=Object.keys(d.L.pts).find(k=>!S.selPts.has(k)&&Math.hypot(p.x-d.L.pts[k].x,p.y-d.L.pts[k].y)<7/(S.view.zoom||1));if(other)vectorWeld(d.L,id,other);}
    }vectorPointTF.up.call(this);},
});
// ---------- Select Points (Moho-style) ----------
// Selecting changes S.selPts only: it never edits geometry or creates keys.
// Click priority is point, then curve, then filled shape. No modifier replaces the selection,
// Shift adds, Alt removes, and Ctrl/Cmd swaps box and lasso for the current drag.
function vectorSelectionOp(e){return e.altKey?'remove':e.shiftKey?'add':'replace';}
function vectorCombineSelection(base,ids,op){const s=op==='replace'?new Set():new Set(base);for(const id of ids)op==='remove'?s.delete(id):s.add(id);return s;}
function vectorPathPointIDs(L,pathIDs){const ids=new Set();for(const pid of pathIDs){const p=L.paths.find(q=>q.id===pid);if(p)for(const id of p.pts)if(L.pts[id])ids.add(id);}return [...ids];}
function vectorHitSelectable(L,sx,sy){
  const id=hitPoint(L,sx,sy);if(id)return {kind:'point',ids:[id]};
  const seg=hitSegment(L,sx,sy);if(seg)return {kind:'curve',path:seg.path,ids:vectorPathPointIDs(L,[seg.path.id])};
  const hit=hitLayerEntry(lcOf(L),sx,sy);if(hit?.shape)return {kind:'shape',shape:hit.shape,ids:vectorPathPointIDs(L,hit.shape.paths)};
  return null;
}
function vectorPointsInArea(L,test){const lc=lcOf(L),ids=[];for(const [id,p]of Object.entries(lc.P||{}))if(L.pts[id]&&test(M.ap(lc.full,...p)))ids.push(id);return ids;}
TOOLS.points.name='Select points';
TOOLS.points.hint='Click a point, curve or fill · drag a box (Ctrl/Cmd: lasso) · Shift adds · Alt removes · click empty space to clear';
TOOLS.points.down=function(e,sx,sy){const L=selLayer();if(!L||L.type!=='vector')return toast('Activate a vector drawing in Layers to select its points');
  const lasso=VEC.lasso!==!!(e.ctrlKey||e.metaKey);
  startDrag(e,{mode:'select',L,op:vectorSelectionOp(e),lasso,base:new Set(vectorIDs(L)),hit:vectorHitSelectable(L,sx,sy),area:false,downX:sx,downY:sy});};
TOOLS.points.move=function(e,sx,sy){const d=Stage.drag;if(!d||d.mode!=='select')return;
  if(!d.area){if(Math.hypot(sx-d.downX,sy-d.downY)<3*(Stage.dpr||1))return;d.area=true;if(d.lasso)Stage.vectorLasso=[[d.downX,d.downY]];}
  let ids;
  if(d.lasso){Stage.vectorLasso.push([sx,sy]);ids=Stage.vectorLasso.length>2?vectorPointsInArea(d.L,p=>vectorInside(p,Stage.vectorLasso)):[];}
  else{const r=[Math.min(d.downX,sx),Math.min(d.downY,sy),Math.max(d.downX,sx),Math.max(d.downY,sy)];Stage.preview={type:'marquee',r};ids=vectorPointsInArea(d.L,p=>p[0]>=r[0]&&p[0]<=r[2]&&p[1]>=r[1]&&p[1]<=r[3]);}
  S.selPts=vectorCombineSelection(d.base,ids,d.op);requestDraw();};
TOOLS.points.up=function(){const d=Stage.drag;
  if(d?.mode==='select'&&!d.area){
    if(d.hit)S.selPts=vectorCombineSelection(d.base,d.hit.ids,d.op);
    else if(d.op==='replace')S.selPts=new Set();
  }
  if(d?.mode==='select'&&d.op==='replace')S.selShape=null;
  Stage.vectorLasso=null;Stage.preview=null;refreshAll();};

// Curvature is a point property with its own timeline channels (Moho: drag left/right).
TOOLS.curvature.hint='Select points, then drag left/right · with fewer than two selected, drags the nearest point · Ctrl/Cmd selects points · Alt keeps peaked points peaked · double-click toggles peak/smooth';
TOOLS.curvature.down=function(e,sx,sy){const L=selLayer();if(!L||L.type!=='vector')return;
  let ids=vectorIDs(L);
  if(ids.length<2){const id=hitPoint(L,sx,sy,16);if(!id)return;ids=[id];S.selPts=new Set([id]);}
  beginEdit('Curvature');const start={},peaked={};
  for(const id of ids){start[id]=val(L,'pv:'+id+':c',S.frame);if(e.altKey&&Math.abs(start[id])<0.05){const fr=vectorPeakFrame(L,id);if(fr)peaked[id]=fr;}}
  startDrag(e,{mode:'curvature',L,start,peaked});refreshAll();};
TOOLS.curvature.move=function(e,sx,sy){const d=Stage.drag;if(d?.mode!=='curvature')return;const amount=(sx-d.sx)/(80*(Stage.dpr||1));
  for(const [id,c]of Object.entries(d.start)){if(d.peaked[id]){vectorBendPeak(d.L,id,d.peaked[id],amount);continue;}setVal(d.L,'pv:'+id+':c',clamp(c+amount,-3,3));vectorClearHandles(d.L,id);}
  requestDraw();};
TOOLS.curvature.up=function(){commitEdit();refreshAll();};
// Alt on a peaked point bows both neighbouring segments while the point itself stays a corner.
function vectorPeakFrame(L,id){const p=L.paths.find(p=>p.pts.includes(id));if(!p)return null;const n=p.pts.length,i=p.pts.indexOf(id),P=vectorPathPoints(L,S.frame);
  const near=j=>{const k=p.closed?(j+n)%n:j;return k>=0&&k<n&&k!==i?P[p.pts[k]]:null;};return {o:P[id],a:near(i-1),b:near(i+1)};}
function vectorBendPeak(L,id,fr,amount){const theta=clamp(amount,-1.3,1.3),unit=v=>{const l=Math.hypot(...v)||1;return [v[0]/l,v[1]/l];};
  const da=fr.a&&unit(vectorSub(fr.a,fr.o)),db=fr.b&&unit(vectorSub(fr.b,fr.o)),bis=da&&db?unit([da[0]+db[0],da[1]+db[1]]):null;
  for(const [side,q,dir]of [['hin',fr.a,da],['hout',fr.b,db]]){if(!q)continue;const len=Math.hypot(...vectorSub(q,fr.o))/3,s=bis&&(dir[0]*bis[1]-dir[1]*bis[0])>0?1:-1,a=s*theta,c=Math.cos(a),n=Math.sin(a);
    setVal(L,'pv:'+id+':'+side,[(dir[0]*c-dir[1]*n)*len,(dir[0]*n+dir[1]*c)*len]);}
  setVal(L,'pv:'+id+':c',0);}
TOOLS.curvature.dbl=function(e,sx,sy){const L=selLayer(),id=L&&hitPoint(L,sx,sy);if(id)vectorAction('Toggle corner',()=>{setVal(L,'pv:'+id+':c',Math.abs(val(L,'pv:'+id+':c',S.frame))<0.05?1:0);vectorClearHandles(L,id);});};
function vectorClearHandles(L,id){for(const side of ['hin','hout'])if(L.pts[id][side]||L.ch['pv:'+id+':'+side]){const v=vectorAutoCurvatureHandle(L,id,side,S.frame);setVal(L,'pv:'+id+':'+side,v);}}
function vectorAutoCurvatureHandle(L,id,side,f){const p=L.paths.find(p=>p.pts.includes(id));if(!p)return [0,0];const n=p.pts.length,i=p.pts.indexOf(id),ix=j=>p.closed?(j+n)%n:clamp(j,0,n-1),P=vectorPathPoints(L,f),a=P[p.pts[ix(i-1)]],b=P[p.pts[ix(i+1)]],k=val(L,'pv:'+id+':c',f)/6;return [(b[0]-a[0])*k*(side==='hin'?-1:1),(b[1]-a[1])*k*(side==='hin'?-1:1)];}
function vectorCurvature(value){return vectorAction('Set curvature',L=>{for(const id of vectorIDs(L)){setVal(L,'pv:'+id+':c',typeof value==='function'?value(L,id):value);vectorClearHandles(L,id);}});}

// ---------- path creation ----------
const vectorOldFinishPen=finishPen;
finishPen=function(closeIt){const P=Stage.pen,L=P&&findLayer(P.layer),pa=L?.paths.find(p=>p.id===P.path);if(!pa)return vectorOldFinishPen(closeIt);
  Stage.pen=null;edit(closeIt?'Close curve':'Finish curve',()=>{if(pa.pts.length<2){L.paths=L.paths.filter(p=>p!==pa);vectorCleanup(L);return;}if(closeIt)pa.closed=true;
    if(!L.shapes.some(s=>s.paths.includes(pa.id))&&(S.newStyle.fillOn&&pa.closed||S.newStyle.strokeOn))S.selShape=addShape(L,[pa.id],S.newStyle,{fillOn:!!(pa.closed&&S.newStyle.fillOn)}).id;});};
// ---------- Add Point (Moho-style construction) ----------
// Empty space starts a curve, an endpoint extends it, a curve segment receives an inserted point.
// Click-to-add: each click places a point and the dashed preview follows the cursor; click the last point
// (or Enter/Esc) to finish, the first point to close. Click-and-drag positions the new endpoint and welds on release.
// Alt avoids picking/welding existing geometry, Ctrl/Cmd flips Sharp corners, Shift constrains to an axis.
function vectorPickRadius(){return 8*(Stage.dpr||1);}
function vectorPenTarget(L,sx,sy,alt,skip=new Set()){
  if(!L||L.type!=='vector'||alt)return null;const lc=lcOf(L);let best=null,dist=vectorPickRadius();
  for(const [id,p]of Object.entries(lc.P||{})){if(skip.has(id)||!L.pts[id])continue;const q=M.ap(lc.full,...p),d=Math.hypot(q[0]-sx,q[1]-sy);if(d<dist){dist=d;best={kind:'point',id,at:q};}}
  if(best)return best;
  const seg=hitSegment(L,sx,sy);if(!seg)return null;const a=seg.path.pts[seg.index],b=seg.path.pts[(seg.index+1)%seg.path.pts.length];
  if(skip.has(a)||skip.has(b))return null;return {kind:'curve',seg,at:[sx,sy]};
}
function vectorPenConstrain(e,L,prev,loc){if(!e.shiftKey||!prev||!L.pts[prev])return loc;const p=L.pts[prev],dx=loc[0]-p.x,dy=loc[1]-p.y;return Math.abs(dx)>=Math.abs(dy)?[loc[0],p.y]:[p.x,loc[1]];}
function vectorPenInsert(L,seg){return vectorInsert(L,seg.path,seg.index,clamp(seg.t,0.02,0.98));}
TOOLS.pen.name='Add point';
TOOLS.pen.hint='Click empty space to start a curve, then click or drag each new point · click an endpoint to extend · click a curve to insert · click the start to close, the last point or Enter to finish · Alt: no welding · Ctrl/Cmd: flip Sharp corners · Shift: constrain';
TOOLS.pen.down=function(e,sx,sy){
  const L=ensureVectorLayer();if(L.lock)return toast('Layer is locked');beginEdit('Add point');
  const loc=toLocal(L,sx,sy),c=(VEC.sharp!==!!(e.ctrlKey||e.metaKey))?0:1,inv=M.inv(lcOf(L).full),t=vectorPenTarget(L,sx,sy,e.altKey);
  let path=Stage.pen?.layer===L.id?L.paths.find(p=>p.id===Stage.pen.path):null;if(Stage.pen&&!path)Stage.pen=null;
  if(path){
    const last=path.pts.at(-1);
    if(t?.kind==='point'&&t.id===path.pts[0]&&path.pts.length>2){commitEdit();return finishPen(true);}
    if(t?.kind==='point'&&t.id===last){commitEdit();return finishPen(false);}
    if(VEC.autoWeld&&t?.kind==='point'){if(path.pts.includes(t.id))return commitEdit();path.pts.push(t.id);S.selPts=new Set([t.id]);commitEdit();return finishPen(false);}
    if(VEC.autoWeld&&t?.kind==='curve'){const id=vectorPenInsert(L,t.seg);path.pts.push(id);S.selPts=new Set([id]);commitEdit();return finishPen(false);}
    const id=addPoint(L,...vectorPenConstrain(e,L,last,loc),c);path.pts.push(id);S.selPts=new Set([id]);
    startDrag(e,{mode:'penpt',L,id,path,inv,prev:last});return requestDraw();
  }
  if(t?.kind==='point'){
    const open=L.paths.find(p=>!p.closed&&(p.pts[0]===t.id||p.pts.at(-1)===t.id));
    if(open){if(open.pts[0]===t.id)open.pts.reverse();path=open;}else{path={id:uid('a'),pts:[t.id],closed:false};L.paths.push(path);}
    Stage.pen={layer:L.id,path:path.id};const id=addPoint(L,...loc,c);path.pts.push(id);S.selPts=new Set([id]);
    startDrag(e,{mode:'penpt',L,id,path,inv,prev:t.id,clickOnly:true});return requestDraw();
  }
  if(t?.kind==='curve'){const id=vectorPenInsert(L,t.seg);S.selPts=new Set([id]);startDrag(e,{mode:'penmove',L,id,inv,start:[L.pts[id].x,L.pts[id].y]});return requestDraw();}
  path={id:uid('a'),pts:[],closed:false};L.paths.push(path);Stage.pen={layer:L.id,path:path.id};
  const a=addPoint(L,...loc,c),b=addPoint(L,...loc,c);path.pts.push(a,b);S.selPts=new Set([b]);
  startDrag(e,{mode:'penpt',L,id:b,path,inv,prev:a,clickOnly:true});requestDraw();
};
TOOLS.pen.move=function(e,sx,sy){const d=Stage.drag;if(!d)return requestDraw();
  if(d.mode==='penpt'){const p=vectorPenConstrain(e,d.L,d.prev,M.ap(d.inv,sx,sy));d.L.pts[d.id].x=round(p[0]);d.L.pts[d.id].y=round(p[1]);}
  else if(d.mode==='penmove'){const v=cameraDragDelta(d.inv,sx,sy,d.sx,d.sy);d.L.pts[d.id].x=round(d.start[0]+v[0]);d.L.pts[d.id].y=round(d.start[1]+v[1]);}
  requestDraw();};
TOOLS.pen.up=function(e){const d=Stage.drag;if(!d)return;
  if(d.mode==='penmove')return commitEdit();
  if(d.mode!=='penpt')return commitEdit();
  const {L,id,path}=d;
  if(!d.moved){if(d.clickOnly){path.pts.pop();delete L.pts[id];S.selPts=new Set([path.pts.at(-1)]);}return commitEdit();}
  const t=VEC.autoWeld?vectorPenTarget(L,...Stage.mouse,e?.altKey,new Set([id])):null;
  if(t?.kind==='point'){
    if(t.id===path.pts[0]&&path.pts.length>2){path.pts.pop();delete L.pts[id];commitEdit();return finishPen(true);}
    if(t.id===d.prev){path.pts.pop();delete L.pts[id];return commitEdit();}
    vectorWeld(L,id,t.id);S.selPts=new Set([t.id]);commitEdit();return finishPen(false);
  }
  if(t?.kind==='curve'){const k=vectorPenInsert(L,t.seg);vectorWeld(L,id,k);S.selPts=new Set([k]);commitEdit();return finishPen(false);}
  commitEdit();
};
function vectorAddPath(L,points,closed,style=S.newStyle){const ids=points.map(p=>addPoint(L,p[0],p[1],p[2]??0)),path={id:uid('a'),pts:ids,closed};L.paths.push(path);
  if(style.fillOn&&closed||style.strokeOn)S.selShape=addShape(L,[path.id],style,{fillOn:!!(closed&&style.fillOn)}).id;S.selPts=new Set(ids);return path;}
function vectorCreationCommit(label,fn){if(H.pending){fn();return commitEdit();}return edit(label,fn);}
function vectorPrimitive(kind,x,y,w,h,cols=4,rows=4){
  const result=[],cx=x+w/2,cy=y+h/2;
  if(kind==='grid'){for(let i=0;i<=cols;i++)result.push({points:[[x+w*i/cols,y],[x+w*i/cols,y+h]],closed:false});for(let j=0;j<=rows;j++)result.push({points:[[x,y+h*j/rows],[x+w,y+h*j/rows]],closed:false});return result;}
  let p=[],closed=true;
  if(kind==='rectangle')p=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  if(kind==='ellipse')for(let i=0;i<8;i++){const a=i*Math.PI/4;p.push([cx+Math.cos(a)*w/2,cy+Math.sin(a)*h/2,1.105]);}
  if(kind==='triangle')p=[[cx,y],[x+w,y+h],[x,y+h]];
  if(kind==='star')for(let i=0;i<10;i++){const a=i*Math.PI/5-Math.PI/2,r=i%2?0.43:1;p.push([cx+Math.cos(a)*w*r/2,cy+Math.sin(a)*h*r/2]);}
  if(kind==='arrow')p=[[x,cy-h*.15],[x+w*.6,cy-h*.15],[x+w*.6,y],[x+w,cy],[x+w*.6,y+h],[x+w*.6,cy+h*.15],[x,cy+h*.15]];
  if(kind==='spiral'){closed=false;for(let i=0;i<=48;i++){const t=i/48,a=t*Math.PI*6;p.push([cx+Math.cos(a)*w*t/2,cy+Math.sin(a)*h*t/2,1]);}}
  return [{points:p,closed}];
}
defTool('drawshape',{icon:svgI('<rect x="3" y="10" width="11" height="11"/><circle cx="16" cy="7" r="5"/>'),name:'Draw shape',key:'',cursor:'crosshair',hint:'Drag a primitive · Shift constrains proportions · Alt draws from center · Grid uses horizontal / vertical subdivisions',
  down(e,sx,sy){beginEdit('Draw '+VEC.shape);const L=ensureVectorLayer();startDrag(e,{L,a:toLocal(L,sx,sy),inv:M.inv(lcOf(L).full)});Stage.preview={type:'marquee',r:[sx,sy,sx,sy]};},
  move(e,sx,sy){if(Stage.drag)Stage.preview={type:'marquee',r:[Stage.drag.sx,Stage.drag.sy,sx,sy]};requestDraw();},
  up(e){const d=Stage.drag;if(!d?.moved){Stage.preview=null;cancelEdit();return;}const b=M.ap(d.inv,...Stage.mouse);let [x,y]=d.a,w=b[0]-x,h=b[1]-y;
    if(e.shiftKey){const n=Math.max(Math.abs(w),Math.abs(h));w=Math.sign(w||1)*n;h=Math.sign(h||1)*n;}if(e.altKey){x-=w;y-=h;w*=2;h*=2;}
    vectorCreationCommit('Draw '+VEC.shape,()=>{for(const p of vectorPrimitive(VEC.shape,x,y,w,h,VEC.horizontal,VEC.vertical))vectorAddPath(d.L,p.points,p.closed);});Stage.preview=null;},
});
TOOLS.freehand.down=function(e,sx,sy){beginEdit('Freehand curve');const L=ensureVectorLayer();startDrag(e,{L,samples:[[sx,sy,e.pointerType==='pen'?clamp(e.pressure||0.01,0.01,1):1]]});Stage.preview={type:'poly',pts:[[sx,sy]]};};
TOOLS.freehand.move=function(e,sx,sy){const d=Stage.drag;if(!d)return;const last=d.samples.at(-1);if(Math.hypot(sx-last[0],sy-last[1])>2*Stage.dpr&&d.samples.length<10000){d.samples.push([sx,sy,e.pointerType==='pen'?clamp(e.pressure||0.01,0.01,1):1]);Stage.preview.pts.push([sx,sy]);}requestDraw();};
TOOLS.freehand.up=function(){const d=Stage.drag;Stage.preview=null;if(!d||d.samples.length<2){cancelEdit();return;}
  const inv=M.inv(lcOf(d.L).full);let raw=d.samples.map(p=>p.slice());for(let n=0;n<VEC.smoothing;n++)raw=raw.map((p,i)=>!i||i===raw.length-1?p:[(raw[i-1][0]+2*p[0]+raw[i+1][0])/4,(raw[i-1][1]+2*p[1]+raw[i+1][1])/4,p[2]]);
  const samples=rdp(raw,Math.max(.1,VEC.reduction)*Stage.dpr),near=Math.hypot(raw[0][0]-raw.at(-1)[0],raw[0][1]-raw.at(-1)[1])<14*Stage.dpr,closed=VEC.weldEnds&&near&&samples.length>3;
  if(closed)samples.pop();vectorCreationCommit('Freehand curve',()=>{
    const p=vectorAddPath(d.L,samples.map(a=>[...M.ap(inv,a[0],a[1]),1]),closed);
    p.pts.forEach((id,i)=>{const pressure=samples[i][2],t=i/(p.pts.length-1||1),taper=VEC.taper?Math.min(1,t/VEC.taper,(1-t)/VEC.taper):1;
      d.L.pts[id].width=Math.max(.01,(VEC.pressureWidth?pressure:1)*taper);d.L.pts[id].alpha=VEC.pressureAlpha?pressure:1;
      if(VEC.colorDrift){d.L.pts[id].color=mixColor(S.newStyle.stroke,S.newStyle.fill,t);d.L.pts[id].strength=VEC.colorDrift;}});
    if(VEC.weldEnds&&!closed)for(const index of [0,p.pts.length-1]){const id=p.pts[index],a=d.L.pts[id],other=Object.keys(d.L.pts).find(k=>!p.pts.includes(k)&&Math.hypot(a.x-d.L.pts[k].x,a.y-d.L.pts[k].y)<14/(S.view.zoom||1));if(other)vectorWeld(d.L,id,other);}
    if(VEC.multiFill)vectorMultiStrokeFill(d.L,p);
  });
};
function vectorMultiStrokeFill(L,latest){
  let state=Stage.multiStroke;if(state?.layer!==L.id||state.doc!==S.doc)state=Stage.multiStroke={layer:L.id,doc:S.doc,paths:[]};
  state.paths=state.paths.filter(id=>L.paths.some(p=>p.id===id));state.paths.push(latest.id);
  if(latest.closed){for(const s of L.shapes)if(s.paths.includes(latest.id))s.fillOn=S.newStyle.fillOn;return;}
  const pool=L.paths.filter(p=>!p.closed&&state.paths.includes(p.id)),start=latest.pts[0],end=latest.pts.at(-1);
  let remaining=20000;
  const visit=(at,used,points)=>{if(--remaining<0)return null;if(at===start&&used.length>1)return {used,points};if(used.length>64)return null;
    for(const p of pool){if(used.includes(p))continue;const direction=p.pts[0]===at?p.pts:p.pts.at(-1)===at?[...p.pts].reverse():null;if(!direction)continue;const result=visit(direction.at(-1),used.concat(p),points.concat(direction.slice(1)));if(result)return result;}return null;};
  const result=visit(end,[latest],[...latest.pts]);if(!result)return;
  const ids=result.points.slice(0,-1),used=new Set(result.used.map(p=>p.id));latest.pts=ids;latest.closed=true;
  L.paths=L.paths.filter(p=>p===latest||!used.has(p.id));for(const sh of L.shapes)sh.paths=sh.paths.filter(id=>!used.has(id));L.shapes=L.shapes.filter(s=>s.paths.length);
  if(S.newStyle.fillOn||S.newStyle.strokeOn)S.selShape=addShape(L,[latest.id]).id;vectorCleanup(L);state.paths=state.paths.filter(id=>!used.has(id));
}

// ---------- topology and deformation brushes ----------
function vectorDeleteEdge(L,path,index){
  const ids=path.pts,n=ids.length,owner=L.shapes.filter(s=>s.paths.includes(path.id));
  if(path.closed){path.pts=ids.slice(index+1).concat(ids.slice(0,index+1));path.closed=false;}
  else {const tail=ids.slice(index+1);path.pts=ids.slice(0,index+1);if(tail.length>1){const p={...clone(path),id:uid('a'),pts:tail};L.paths.push(p);for(const s of owner)s.paths.push(p.id);}}
  if(path.pts.length<2)L.paths=L.paths.filter(p=>p!==path);vectorCleanup(L);
}
function vectorRemoveEdges(L,path,indices){
  const ids=path.pts,n=ids.length,runs=[],broken=new Set(indices),start=path.closed?((Math.min(...indices)+1)%n):0,count=path.closed?n:n-1;
  let run=[ids[start]];
  for(let j=0;j<count;j++){const i=(start+j)%n,next=ids[(i+1)%n];if(broken.has(i)){if(run.length>1)runs.push(run);run=[next];}else run.push(next);}
  if(run.length>1)runs.push(run);
  const index=L.paths.indexOf(path),owners=L.shapes.filter(s=>s.paths.includes(path.id)),fragments=runs.map((pts,i)=>({...clone(path),id:i?uid('a'):path.id,pts,closed:false}));
  L.paths.splice(index,1,...fragments);for(const sh of owners)for(const f of fragments.slice(1))sh.paths.push(f.id);
  for(const f of fragments.slice(1))for(const [k,v]of Object.entries(L.ch))if(k.startsWith('curve:'+path.id+':'))L.ch[k.replace('curve:'+path.id+':','curve:'+f.id+':')]=clone(v);
  vectorCleanup(L);
}
defTool('reduce',{icon:svgI('<path d="M2 18 6 5l5 11 5-12 6 14M3 21h18"/><circle cx="11" cy="16" r="2"/>'),name:'Point reduction',key:'',cursor:'crosshair',hint:'Click to simplify selected points (or the whole drawing); retention controls allowed geometric error',
  down(){vectorAction('Reduce points',L=>vectorSimplify(L),true);},move(){},up(){}});
function vectorBrushStart(e,sx,sy,mode){const L=selLayer();if(!L||L.type!=='vector')return;const center=toLocal(L,sx,sy),start={},falloff={};
  for(const id of Object.keys(L.pts)){if(S.selPts.size&&!S.selPts.has(id))continue;const p=val(L,'pt:'+id,S.frame),d=Math.hypot(p[0]-center[0],p[1]-center[1]);if(mode==='magnet'||mode==='noise'){if(d>VEC.radius)continue;falloff[id]=(1-d/VEC.radius)**2;}else falloff[id]=1;start[id]=p;}
  if(!Object.keys(start).length)return;beginEdit(TOOLS[mode].name);startDrag(e,{L,mode,start,falloff,center,inv:M.inv(lcOf(L).full),seed:Math.floor(performance.now())});
}
function vectorHash(id,seed){let h=seed|0;for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);return ((h>>>0)%65536)/32768-1;}
function vectorBrushMove(e,sx,sy){const d=Stage.drag;if(!d?.start)return;const delta=cameraDragDelta(d.inv,sx,sy,d.sx,d.sy),pts=Object.values(d.start),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2,w=Math.max(1,Math.max(...xs)-Math.min(...xs)),h=Math.max(1,Math.max(...ys)-Math.min(...ys));
  for(const [id,p]of Object.entries(d.start)){let q=p.slice(),k=d.falloff[id]*VEC.strength;
    if(d.mode==='magnet')q=[p[0]+delta[0]*k,p[1]+delta[1]*k];
    if(d.mode==='noise'){const amp=Math.hypot(...delta)*k;q=[p[0]+vectorHash(id,d.seed)*amp,p[1]+vectorHash(id+'y',d.seed)*amp];}
    if(d.mode==='shear')q=[p[0]+(p[1]-cy)*delta[0]/h,p[1]+(p[0]-cx)*delta[1]/w];
    if(d.mode==='perspective'){const factor=clamp(1+(p[1]-cy)*delta[0]/(w*h)*2,0.05,8);q=[cx+(p[0]-cx)*factor,cy+(p[1]-cy)*clamp(1+(p[0]-cx)*delta[1]/(w*h)*2,.05,8)];}
    if(d.mode==='bend'){const angle=delta[1]/Math.max(w,1)*2;if(Math.abs(angle)>.00001){const r=w/angle,t=(p[0]-cx)/r,ry=r+(p[1]-cy);q=[cx+Math.sin(t)*ry,cy+Math.cos(t)*ry-r];}}
    setVal(d.L,'pt:'+id,q);
  }requestDraw();
}
for(const [id,name,icon]of [['magnet','Magnet','<path d="M5 4v10a7 7 0 0 0 14 0V4h-5v10a2 2 0 0 1-4 0V4ZM5 8h5m4 0h5"/>'],['perspective','Perspective points','<path d="m4 7 16-4v18L4 17ZM4 7v10m8-12v14"/>'],['shear','Shear points','<path d="m8 4 13 0-6 16H2Z"/>'],['bend','Bend points','<path d="M3 18C3-1 21-1 21 18M3 18h5m8 0h5"/>'],['noise','Noise points','<path d="m2 12 4-8 4 17 4-19 4 14 4-6"/>']])defTool(id,{icon:svgI(icon),name,key:'',cursor:'crosshair',hint:id==='magnet'||id==='noise'?'Drag within the brush radius · selected points restrict the brush · creates point motion keys':'Select points, then drag to deform them · records point motion at the playhead',down(e,sx,sy){vectorBrushStart(e,sx,sy,id);},move:vectorBrushMove,up(){commitEdit();}});
defTool('blob',{icon:svgI('<path d="M3 15C-1 8 8 0 13 6c11-3 13 10 4 12-5 8-14 5-14-3Z"/>'),name:'Blob brush',key:'',cursor:'crosshair',hint:'Drag to paint a filled vector silhouette · brush radius controls thickness · pen pressure controls width',
  down(e,sx,sy){TOOLS.freehand.down(e,sx,sy);},move(e,sx,sy){TOOLS.freehand.move(e,sx,sy);},
  up(){const d=Stage.drag;Stage.preview=null;if(!d)return;const inv=M.inv(lcOf(d.L).full),raw=rdp(d.samples,Math.max(.2,VEC.reduction)*Stage.dpr),pts=raw.map(p=>[...M.ap(inv,p[0],p[1]),p[2]]),left=[],right=[];
    if(pts.length<2){const p=pts[0];if(p)vectorCreationCommit('Blob dot',()=>vectorAddPath(d.L,vectorPrimitive('ellipse',p[0]-VEC.radius,p[1]-VEC.radius,VEC.radius*2,VEC.radius*2)[0].points,true,{...S.newStyle,fillOn:true,strokeOn:false}));else cancelEdit();return;}
    for(let i=0;i<pts.length;i++){const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],n=Math.hypot(dx,dy)||1,r=VEC.radius*(VEC.pressureWidth?pts[i][2]:1);left.push([pts[i][0]-dy/n*r,pts[i][1]+dx/n*r,1]);right.push([pts[i][0]+dy/n*r,pts[i][1]-dx/n*r,1]);}
    vectorCreationCommit('Blob silhouette',()=>vectorAddPath(d.L,left.concat(right.reverse()),true,{...S.newStyle,fillOn:true,strokeOn:false}));
  }});
defTool('eraser',{icon:svgI('<path d="m3 15 10-12 9 8-9 11H9Zm4 4 10-12"/>'),name:'Vector eraser',key:'',cursor:'crosshair',hint:'Drag to erase curve edges within the radius · geometry changes in Setup mode',
  down(e,sx,sy){const L=selLayer();if(!L)return;beginEdit('Erase vector edges');startDrag(e,{L});this.move(e,sx,sy);},
  move(e,sx,sy){const d=Stage.drag;if(!d)return;const P=vectorPathPoints(d.L),center=toLocal(d.L,sx,sy),hit=[];
    for(const p of d.L.paths){const samples=vectorSamples(d.L,p,P,0);const indices=[...new Set(samples.filter(s=>Math.hypot(s.p[0]-center[0],s.p[1]-center[1])<VEC.radius).map(s=>s.i))];if(indices.length)hit.push({p,indices});}
    for(const {p,indices}of hit)if(d.L.paths.includes(p))vectorRemoveEdges(d.L,p,indices);requestDraw();},up(){commitEdit();}});
function vectorScatterStamp(L,p,seed){const x=p[0]+vectorHash('x',seed)*VEC.scatter,y=p[1]+vectorHash('y',seed)*VEC.scatter,size=Math.max(2,VEC.radius*.25),kind=VEC.shape==='grid'?'star':VEC.shape;for(const geo of vectorPrimitive(kind,x-size/2,y-size/2,size,size))vectorAddPath(L,geo.points,geo.closed);}
defTool('scatter',{icon:svgI('<path d="m5 2 2 4 4 1-4 2-2 4-2-4-3-2 3-1Zm12 10 2 3 3 1-3 2-2 4-2-4-3-2 3-1Z"/>'),name:'Scatter brush',key:'',cursor:'crosshair',hint:'Drag to scatter vector primitives · spacing, spread and brush radius control the stamps',
  down(e,sx,sy){beginEdit('Scatter primitives');const L=ensureVectorLayer();startDrag(e,{L,last:[sx,sy],n:1});vectorScatterStamp(L,toLocal(L,sx,sy),1);requestDraw();},
  move(e,sx,sy){const d=Stage.drag;if(!d||d.n>=2000)return;const dist=Math.hypot(sx-d.last[0],sy-d.last[1]),spacing=Math.max(3,VEC.spacing*S.view.zoom*Stage.dpr),n=Math.min(200,Math.floor(dist/spacing),2000-d.n);
    for(let i=1;i<=n;i++){const p=mixVal(d.last,[sx,sy],i*spacing/(dist||1));vectorScatterStamp(d.L,toLocal(d.L,...p),++d.n);if(d.n>=2000)break;}if(n)d.last=mixVal(d.last,[sx,sy],Math.min(1,n*spacing/(dist||1)));requestDraw();},up(){commitEdit();}});

// ---------- appearance tools (do not change path geometry) ----------
function vectorHitShape(L,sx,sy){const hit=hitLayerEntry(lcOf(L),sx,sy);if(hit?.shape)return hit.shape;const seg=hitSegment(L,sx,sy);return seg&&[...L.shapes].reverse().find(s=>s.paths.includes(seg.path.id));}
function vectorSelectShape(L,sh){S.selShape=sh?.id||null;S.selPts=new Set();refreshAll();return sh;}
function vectorSelectedPaths(L){const sh=L.shapes.find(s=>s.id===S.selShape);return sh?L.paths.filter(p=>sh.paths.includes(p.id)):L.paths.filter(p=>p.pts.some(id=>S.selPts.has(id)));}
defTool('shapeselect',{icon:svgI('<path d="m4 3 5 17 3-7 7-3Z"/><circle cx="17" cy="18" r="4"/>'),name:'Select shape',key:'Q',cursor:'default',hint:'Click visible fill or stroke to select its shape independently of points · Alt picks its style',
  down(e,sx,sy){const L=selLayer(),sh=L&&vectorHitShape(L,sx,sy);vectorSelectShape(L,sh);if(e.altKey&&sh){const st=shapeStyle(L,sh,S.frame);Object.assign(S.newStyle,{fill:st.fill,stroke:st.stroke,width:st.width,fillOn:st.fillOn,strokeOn:st.strokeOn});refreshAll();}},move(){},up(){}});
function vectorCreateShape(L){const paths=L.paths.filter(p=>p.pts.length>=2&&p.pts.every(id=>S.selPts.has(id)));if(!paths.length)return toast('Select all points of one or more curves first','err');if(!S.newStyle.fillOn&&!S.newStyle.strokeOn)return toast('Enable Fill or Stroke for the new shape','err');S.selShape=addShape(L,paths.map(p=>p.id)).id;return S.selShape;}
defTool('createshape',{icon:svgI('<path d="m4 5 8-3 9 10-10 9-9-7Z"/><path d="M12 7v10m-5-5h10"/>'),name:'Create shape',key:'',cursor:'cell',hint:'Select curve points, then click Create shape; fill and stroke reference existing geometry',
  down(){vectorAction('Create shape',vectorCreateShape,true);},move(){},up(){}});
defTool('deleteshape',{icon:svgI('<path d="m4 5 8-3 9 10-10 9-9-7Zm4 3 8 8m0-8-8 8"/>'),name:'Delete shape',key:'',cursor:'crosshair',hint:'Click a fill or stroke to delete only its appearance; all points and paths remain editable',
  down(e,sx,sy){const L=selLayer(),sh=L&&vectorHitShape(L,sx,sy);if(sh)vectorAction('Delete shape',()=>{L.shapes=L.shapes.filter(s=>s!==sh);deleteChannelsMatching(L,k=>k.startsWith('sh:'+sh.id+':'));S.selShape=null;},true);},move(){},up(){}});
// ---------- Hide Edge (static, like Moho) ----------
// Toggles a segment's stroke visibility on the drawing itself. Click or drag across segments; each segment
// toggles at most once per drag. Points, curves and fills are untouched, and no animation key is written.
function vectorToggleEdge(L,path,index){const k='hide_'+path.pts[index],key='curve:'+path.id+':'+k,hidden=!val(L,key,S.frame);
  assertWritable(L);REV++;delete L.ch[key];if(hidden)path[k]=true;else delete path[k];return hidden;}
function vectorAlongDrag(d,sx,sy,fn){const [x0,y0]=d.last||[sx,sy],steps=Math.max(1,Math.ceil(Math.hypot(sx-x0,sy-y0)/(3*(Stage.dpr||1))));
  for(let i=1;i<=steps;i++)fn(x0+(sx-x0)*i/steps,y0+(sy-y0)*i/steps);d.last=[sx,sy];}
defTool('hideedge',{icon:svgI('<path d="M2 5h7m6 0h7M2 19h20M10 3l4 4m-4 0 4-4"/>'),name:'Hide edge',key:'',cursor:'crosshair',hint:'Click a segment, or drag across several, to hide / show its stroke · fill and geometry remain · a drawing edit, not an animation key',
  down(e,sx,sy){const L=selLayer();if(!L||L.type!=='vector')return;beginEdit('Hide / show edge');startDrag(e,{mode:'hideedge',L,done:new Set(),changed:0,last:[sx,sy]});this.visit(sx,sy);},
  visit(sx,sy){const d=Stage.drag;if(d?.mode!=='hideedge')return;const h=hitSegment(d.L,sx,sy);if(!h)return;const id=h.path.id+':'+h.path.pts[h.index];if(d.done.has(id))return;d.done.add(id);vectorToggleEdge(d.L,h.path,h.index);d.changed++;requestDraw();},
  move(e,sx,sy){const d=Stage.drag;if(d?.mode==='hideedge')vectorAlongDrag(d,sx,sy,(x,y)=>this.visit(x,y));},
  up(){const d=Stage.drag;if(d?.mode!=='hideedge')return;if(d.changed)commitEdit();else cancelEdit();refreshAll();}});

// ---------- Delete Edge (topology; Moho smart trimming) ----------
function vectorDegree(L,id){const n=new Set();for(const p of L.paths){const k=p.pts.length;p.pts.forEach((q,i)=>{if(q!==id)return;if(p.closed||i>0)n.add(p.id+':'+((i-1+k)%k));if(p.closed||i<k-1)n.add(p.id+':'+i);});}return n.size;}
// Returns the edge indices of the dangling branch containing edge `index`, or null when the edge isn't on one.
function vectorDanglingBranch(L,path,index){if(path.closed)return null;const ids=path.pts,n=ids.length;
  let j=index;while(j>0&&vectorDegree(L,ids[j])===2)j--;let k=index+1;while(k<n-1&&vectorDegree(L,ids[k])===2)k++;
  const freeA=vectorDegree(L,ids[j])===1,freeB=vectorDegree(L,ids[k])===1;if(freeA===freeB)return null;
  return {edges:Array.from({length:k-j},(_,i)=>j+i),junction:freeA?ids[k]:ids[j],side:freeA?'hout':'hin'};}
function vectorDeleteEdgeSmart(L,path,index,smart=true){
  const filled=L.shapes.filter(s=>s.paths.includes(path.id)&&shapeStyle(L,s,S.frame).fillOn).map(s=>s.id);
  const branch=smart?vectorDanglingBranch(L,path,index):null;
  if(branch&&branch.edges.length>1){const j=branch.junction,side=branch.side;
    if(!L.pts[j][side]&&!L.ch['pv:'+j+':'+side])L.pts[j][side]=vectorAutoHandle(L,j,side,S.frame);
    vectorRemoveEdges(L,path,branch.edges);}
  else vectorDeleteEdge(L,path,index);
  // A broken boundary can no longer hold a fill: the shape appearance goes, its geometry stays.
  if(filled.length){L.shapes=L.shapes.filter(s=>!filled.includes(s.id));deleteChannelsMatching(L,k=>filled.some(id=>k.startsWith('sh:'+id+':')));if(filled.includes(S.selShape))S.selShape=null;}
  vectorCleanup(L);
}
defTool('deleteedge',{icon:svgI('<path d="M3 6h7m4 12h7M10 3l4 6m-4 6 4 6"/>'),name:'Delete edge',key:'',cursor:'crosshair',hint:'Click or drag across segments to delete them · dangling branches trim back to their junction (Alt: literal) · a broken fill boundary removes that fill · Ctrl/Cmd or tablet eraser deletes points',
  down(e,sx,sy){const L=selLayer();if(!L||L.type!=='vector')return;const points=!!(e.ctrlKey||e.metaKey)||(e.pointerType==='pen'&&(e.button===5||(e.buttons&32)));
    beginEdit(points?'Delete points':'Delete edge');startDrag(e,{mode:'deleteedge',L,points,smart:!e.altKey,changed:0,last:[sx,sy]});this.visit(sx,sy);},
  visit(sx,sy){const d=Stage.drag;if(d?.mode!=='deleteedge')return;
    if(d.points){const id=hitPoint(d.L,sx,sy);if(id){deletePoints(d.L,[id]);d.changed++;requestDraw();}return;}
    const h=hitSegment(d.L,sx,sy);if(h){vectorDeleteEdgeSmart(d.L,h.path,h.index,d.smart);d.changed++;requestDraw();}},
  move(e,sx,sy){const d=Stage.drag;if(d?.mode==='deleteedge')vectorAlongDrag(d,sx,sy,(x,y)=>this.visit(x,y));},
  up(){const d=Stage.drag;if(d?.mode!=='deleteedge')return;if(d.changed)commitEdit();else cancelEdit();refreshAll();}});
// ---------- Line Width (Moho-style) ----------
// Drag right/left: width · Shift: opacity · Shift+Alt: colour drift · Ctrl/Cmd: select points.
// Magnet mode spreads the change to neighbours by distance along the curve; Alt resizes the magnet.
// Without Magnet, Alt on an open curve's end changes that end and interpolates widths toward the other end.
function vectorCurveDistances(L,sources,limit=Infinity){const dist=new Map(sources.map(id=>[id,0])),adj=new Map(),P=vectorPathPoints(L,S.frame);
  const link=(a,b)=>{const w=Math.hypot(...vectorSub(P[a],P[b]));for(const [x,y]of [[a,b],[b,a]]){if(!adj.has(x))adj.set(x,[]);adj.get(x).push([y,w]);}};
  for(const p of L.paths){const n=p.pts.length;for(let i=0;i<(p.closed?n:n-1);i++)link(p.pts[i],p.pts[(i+1)%n]);}
  const queue=[...sources];while(queue.length){queue.sort((a,b)=>dist.get(b)-dist.get(a));const at=queue.pop(),base=dist.get(at);
    for(const [to,w]of adj.get(at)||[]){const nd=base+w;if(nd<=limit&&nd<(dist.get(to)??Infinity)){dist.set(to,nd);queue.push(to);}}}
  return dist;}
const VECTOR_LW={width:['width',0,20,60],alpha:['alpha',0,1,200],strength:['strength',0,1,200]};
defTool('linewidth',{icon:svgI('<path d="M2 8c7 0 9 8 20 8M2 7c7 0 9-7 20-7"/>'),name:'Line width',key:'W',cursor:'ew-resize',hint:'Drag right / left: width · Shift: opacity · Shift+Alt: colour drift · Ctrl/Cmd selects · Magnet spreads along the curve (Alt resizes it) · Alt on a curve end tapers the whole curve',
  down(e,sx,sy){const L=selLayer();if(!L||L.type!=='vector')return;
    if(VEC.lwMagnet&&e.altKey&&!e.shiftKey){startDrag(e,{mode:'lwradius',start:VEC.lwRadius});return;}
    let ids=vectorIDs(L);if(ids.length<2){const id=hitPoint(L,sx,sy,16);if(!id)return;ids=[id];S.selPts=new Set([id]);}
    const prop=e.shiftKey?(e.altKey?'strength':'alpha'):'width',weights=new Map(ids.map(id=>[id,1]));let taper=null;
    if(!VEC.lwMagnet&&e.altKey&&!e.shiftKey&&ids.length===1){const p=L.paths.find(p=>!p.closed&&p.pts.length>2&&(p.pts[0]===ids[0]||p.pts.at(-1)===ids[0]));
      if(p){const order=p.pts[0]===ids[0]?[...p.pts]:[...p.pts].reverse(),d=vectorCurveDistances(L,[order.at(-1)]),total=d.get(order[0])||1;taper={far:order.at(-1)};for(const id of order.slice(0,-1))weights.set(id,clamp((d.get(id)??total)/total,0,1));}}
    if(VEC.lwMagnet){const r=VEC.lwRadius,d=vectorCurveDistances(L,ids,r);for(const [id,x]of d)if(!weights.has(id)){const u=1-x/r;weights.set(id,u*u*(3-2*u));}}
    beginEdit(prop==='width'?'Point line width':prop==='alpha'?'Point opacity':'Point colour drift');
    startDrag(e,{mode:'linewidth',L,prop,weights,taper,start:Object.fromEntries([...weights.keys()].map(id=>[id,val(L,'pv:'+id+':'+prop,S.frame)]))});refreshAll();},
  move(e,sx,sy){const d=Stage.drag;if(!d)return;
    if(d.mode==='lwradius'){VEC.lwRadius=clamp(d.start+(sx-d.sx)/(S.view.zoom*(Stage.dpr||1)),1,2000);renderToolOpts();return requestDraw();}
    if(d.mode!=='linewidth')return;const [key,min,max,scale]=VECTOR_LW[d.prop],delta=(sx-d.sx)/(scale*(Stage.dpr||1));
    for(const [id,w]of d.weights)setVal(d.L,'pv:'+id+':'+key,round(clamp(d.start[id]+delta*w,min,max),4));requestDraw();},
  up(){const d=Stage.drag;if(d?.mode==='linewidth')commitEdit();refreshAll();renderToolOpts();}});
// Ctrl/Cmd temporarily selects points (Select Points behaviour) inside Curvature and Line Width.
function vectorPlainEvent(e){return {shiftKey:e.shiftKey,altKey:e.altKey,ctrlKey:false,metaKey:false,pointerType:e.pointerType,pressure:e.pressure,button:e.button,buttons:e.buttons};}
for(const id of ['curvature','linewidth']){const t=TOOLS[id],down=t.down,move=t.move,up=t.up;
  t.down=function(e,x,y){if(e.ctrlKey||e.metaKey)return TOOLS.points.down(vectorPlainEvent(e),x,y);return down.call(this,e,x,y);};
  t.move=function(e,x,y){if(Stage.drag?.mode==='select')return TOOLS.points.move(vectorPlainEvent(e),x,y);return move.call(this,e,x,y);};
  t.up=function(e){if(Stage.drag?.mode==='select')return TOOLS.points.up(e);return up.call(this,e);};}
defTool('exposure',{icon:svgI('<path d="M2 18c3-18 17-18 20 0M2 20v-5m20 5v-5M7 20v-5m10 5v-5"/>'),name:'Stroke exposure',key:'',cursor:'ew-resize',hint:'Select a shape, then drag to reveal its stroke · Shift adjusts the start · use Start / End percentages for precision',
  down(e,sx,sy){const L=selLayer();if(!L)return;const sh=vectorHitShape(L,sx,sy);if(sh)vectorSelectShape(L,sh);const paths=vectorSelectedPaths(L);if(!paths.length)return;beginEdit('Stroke exposure');const prop=e.shiftKey?'start':'end';startDrag(e,{L,prop,values:paths.map(p=>[p.id,val(L,'curve:'+p.id+':'+prop,S.frame)])});},
  move(e,sx,sy){const d=Stage.drag;if(!d)return;for(const [id,n]of d.values)setVal(d.L,'curve:'+id+':'+d.prop,clamp(n+(sx-d.sx)/(200*Stage.dpr),0,1));requestDraw();},up(){commitEdit();}});
function vectorApplyProfile(L,profile=VEC.profile){const paths=vectorSelectedPaths(L),source=L.paths.find(p=>p.id===profile);if(profile&&(!source||source.closed||source.pts.length<2))throw Error('Choose an open curve as the profile');for(const p of paths){if(p.id===profile)continue;p.profile=profile||null;setVal(L,'curve:'+p.id+':repeats',VEC.repeats);setVal(L,'curve:'+p.id+':offset',VEC.offset);}}
defTool('profile',{icon:svgI('<path d="M2 19c4-22 7 0 11-12s7-3 9 12M2 22h20"/>'),name:'Curve profile',key:'',cursor:'default',hint:'Select the target shape; choose a separate open curve as its width profile, then Apply · repeats and offset animate',
  down(e,sx,sy){const L=selLayer();if(L)vectorSelectShape(L,vectorHitShape(L,sx,sy));},move(){},up(){}});
defTool('colorpoints',{icon:svgI('<path d="M3 20h18M4 17 12 3l8 14Z"/><circle cx="12" cy="12" r="3"/>'),name:'Color points',key:'',cursor:'crosshair',hint:'Click a point to apply localized color and strength to its fill and stroke · select several points to color together',
  down(e,sx,sy){const L=selLayer(),id=L&&hitPoint(L,sx,sy);if(!id)return;if(!S.selPts.has(id))S.selPts=new Set([id]);vectorAction('Color points',()=>{for(const id of vectorIDs(L)){setVal(L,'pv:'+id+':color',VEC.pointColor);setVal(L,'pv:'+id+':strength',VEC.colorStrength);L.pts[id].colorRadius=VEC.colorRadius;}});},move(){},up(){}});

// ---------- tool-specific option bars ----------
function vectorNum(key,label,value,min=-1e7,max=1e7,step=.1,extra=''){return `<label>${label}<input type="number" data-vnum="${key}" value="${round(value,4)}" min="${min}" max="${max}" step="${step}" ${extra}></label>`;}
function vectorCheck(key,label,on){return `<label><input type="checkbox" data-vcheck="${key}" ${on?'checked':''}>${label}</label>`;}
function vectorButton(key,label,title=''){return `<button class="btn" data-va="${key}" title="${esc(title)}">${label}</button>`;}
function vectorOptionsHTML(L){
  const tool=S.tool,ids=L?.type==='vector'?vectorIDs(L):[],first=ids[0],n=S.newStyle;
  let h='';
  if(['points','pointtf','pen','curvature'].includes(tool))h+=`<select data-vselect="group" aria-label="Select point group"><option value="">Select group</option>${(L?.pointGroups||[]).map(g=>`<option value="${g.id}" ${VEC.group===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</select>`;
  const handles=()=>vectorCheck('handles','Bézier handles',VEC.handles)+vectorCheck('fixed','Fixed handles',VEC.fixed);
  const auto=()=>vectorCheck('autoWeld','Auto-weld',VEC.autoWeld)+vectorCheck('fillOn','Auto-fill',n.fillOn)+vectorCheck('strokeOn','Auto-stroke',n.strokeOn);
  const appearance=()=>`<label>Fill <input type="color" data-vstyle="fill" value="${n.fill}"></label><label>Stroke <input type="color" data-vstyle="stroke" value="${n.stroke}"></label>`+vectorNum('styleWidth','Width',n.width,0,10000,.5);
  if(tool==='points')h+=`<input class="vector-group-name" type="text" data-vtext="groupName" aria-label="Point group name" placeholder="Group name" value="${esc(VEC.groupName)}" maxlength="100">`+
    vectorButton('groupcreate','Create','Store selected points as a named group')+vectorButton('groupdelete','Delete','Delete the selected group; keep its points')+vectorButton('weld','Weld crossings')+
    vectorNum('simplify','Retention %',VEC.simplify,0,100,1)+vectorButton('simplify','Simplify')+vectorButton('split','Split','Insert a midpoint in each segment whose endpoints are selected')+vectorCheck('lasso','Lasso mode',VEC.lasso)+vectorButton('flipx','Flip H')+vectorButton('flipy','Flip V');
  if(tool==='pointtf'){const c=L?.type==='vector'?vectorCenter(L):[0,0];h+=vectorButton('resetpoints','Reset','Restore selected point positions to frame 0 at this frame')+vectorNum('posx','Position X',c[0])+vectorNum('posy','Y',c[1])+vectorNum('scalex','Scale X %',100,-10000,10000,1)+vectorNum('scaley','Y %',100,-10000,10000,1)+vectorNum('angle','Angle °',0,-3600,3600,1)+auto()+handles()+vectorButton('flipx','Flip H')+vectorButton('flipy','Flip V');}
  if(tool==='pen')h+=auto()+vectorCheck('sharp','Sharp corners',VEC.sharp)+handles()+vectorButton('finish','Finish path')+appearance();
  if(tool==='curvature')h+=vectorNum('curvature','Curvature',first?val(L,'pv:'+first+':c',S.frame):1,-3,3,.01)+vectorButton('peak','Peak')+vectorButton('smooth','Smooth')+vectorButton('reverse','+/−')+vectorButton('resetcurve','Reset')+handles();
  if(tool==='freehand')h+=vectorButton('freeoptions','Freehand options')+vectorCheck('weldEnds','Weld ends',VEC.weldEnds)+vectorCheck('fillOn','Auto-fill',n.fillOn)+vectorCheck('strokeOn','Auto-stroke',n.strokeOn)+vectorCheck('multiFill','Multi-stroke fill',VEC.multiFill)+appearance()+
    (VEC.freeExpanded?vectorNum('smoothing','Smoothing passes',VEC.smoothing,0,8,1)+vectorNum('reduction','Reduction px',VEC.reduction,0,20,.1)+vectorCheck('pressureWidth','Pressure width',VEC.pressureWidth)+vectorCheck('pressureAlpha','Pressure opacity',VEC.pressureAlpha)+vectorNum('taper','End taper',VEC.taper,0,.5,.01)+vectorNum('colorDrift','Color drift',VEC.colorDrift,0,1,.05):'');
  if(tool==='drawshape'||tool==='scatter')h+=vectorCheck('fillOn','Auto-fill',n.fillOn)+vectorCheck('strokeOn','Auto-stroke',n.strokeOn)+`<select data-vselect="shape" aria-label="Primitive type">${['rectangle','ellipse','triangle','star','arrow','spiral','grid'].map(k=>`<option ${VEC.shape===k?'selected':''}>${k}</option>`).join('')}</select>`+
    vectorNum('horizontal','Horizontal',VEC.horizontal,1,64,1,VEC.shape!=='grid'?'disabled':'')+vectorNum('vertical','Vertical',VEC.vertical,1,64,1,VEC.shape!=='grid'?'disabled':'')+appearance();
  if(['magnet','noise','blob','eraser','scatter'].includes(tool))h+=vectorNum('radius','Radius',VEC.radius,1,1000,1);
  if(['magnet','noise'].includes(tool))h+=vectorNum('strength','Strength',VEC.strength,0,2,.05);
  if(tool==='blob')h+=`<label>Fill <input type="color" data-vstyle="fill" value="${n.fill}"></label>`+vectorCheck('pressureWidth','Pressure width',VEC.pressureWidth);
  if(tool==='scatter')h+=vectorNum('spacing','Spacing',VEC.spacing,3,1000,1)+vectorNum('scatter','Spread',VEC.scatter,0,1000,1);
  if(tool==='reduce')h+=vectorNum('simplify','Retention %',VEC.simplify,0,100,1)+vectorButton('simplify','Reduce selected / all');
  if(['createshape','fill'].includes(tool))h+=vectorCheck('fillOn','Fill',n.fillOn)+vectorCheck('strokeOn','Stroke',n.strokeOn)+appearance()+(tool==='createshape'?vectorButton('createshape','Create from selected curves'):'');
  if(tool==='shapeselect'||tool==='deleteshape')h+=`<span class="chip">${S.selShape?'Shape selected · edit in Styles / Properties':'Click a fill or stroke'}</span>`+(S.selShape?vectorButton('deleteshape','Delete shape'):'');
  if(tool==='linewidth')h+=vectorNum('pointwidth','Width',first?val(L,'pv:'+first+':width',S.frame):1,0,20,.05)+vectorNum('pointalpha','Opacity',first?val(L,'pv:'+first+':alpha',S.frame):1,0,1,.05)+vectorNum('pointdrift','Colour drift',first?val(L,'pv:'+first+':strength',S.frame):0,0,1,.05)+vectorCheck('lwMagnet','Magnet mode',VEC.lwMagnet)+vectorNum('lwRadius','Magnet radius',VEC.lwRadius,1,2000,1)+vectorButton('widthreset','Reset width');
  if(tool==='exposure'){const p=L?.type==='vector'?vectorSelectedPaths(L)[0]:null;h+=vectorNum('start','Start %',p?100*val(L,'curve:'+p.id+':start',S.frame):0,0,100,1)+vectorNum('end','End %',p?100*val(L,'curve:'+p.id+':end',S.frame):100,0,100,1)+vectorButton('exposurereset','Show full stroke');}
  if(tool==='profile')h+=`<select data-vselect="profile" aria-label="Profile source"><option value="">No profile</option>${(L?.paths||[]).filter(p=>!p.closed&&p.pts.length>1).map((p,i)=>`<option value="${p.id}" ${VEC.profile===p.id?'selected':''}>Open curve ${i+1} · ${p.id.slice(-4)}</option>`).join('')}</select>`+vectorNum('repeats','Repeats',VEC.repeats,1,64,1)+vectorNum('offset','Offset',VEC.offset,-100,100,.05)+vectorButton('applyprofile','Apply profile','Use the chosen open curve as a width envelope')+vectorButton('clearprofile','Clear');
  if(tool==='colorpoints')h+=`<label>Point color <input type="color" data-vstyle="pointColor" value="${VEC.pointColor}"></label>`+vectorNum('colorStrength','Strength',VEC.colorStrength,0,1,.05)+vectorNum('colorRadius','Radius',VEC.colorRadius,1,1000,1)+vectorButton('applycolor','Apply selected')+vectorButton('clearcolor','Clear selected');
  h+=`<span class="chip">${ids.length} points selected · ${S.mode==='setup'?'Setup':('Frame '+S.frame)}</span>`;return h;
}
function vectorNumericChange(key,value){
  if(!Number.isFinite(value))return;
  const limits={simplify:[0,100],horizontal:[1,64],vertical:[1,64],smoothing:[0,8],reduction:[0,20],radius:[1,1000],strength:[0,2],spacing:[3,1000],scatter:[0,1000],taper:[0,.5],colorDrift:[0,1],colorStrength:[0,1],colorRadius:[1,1000],repeats:[1,64],offset:[-100,100],lwRadius:[1,2000]};
  if(limits[key]){VEC[key]=clamp(value,...limits[key]);if(['horizontal','vertical','smoothing','repeats'].includes(key))VEC[key]=Math.round(VEC[key]);return;}
  if(key==='styleWidth'){S.newStyle.width=clamp(value,0,10000);return;}
  return vectorAction('Vector '+key,L=>{
    const ids=vectorIDs(L),c=vectorCenter(L),v=clamp(value,-1e7,1e7);
    if(key==='posx'||key==='posy'){const axis=key==='posx'?0:1;vectorTransform(L,p=>p.map((n,i)=>n+(i===axis?v-c[axis]:0)));}
    if(['scalex','scaley','angle'].includes(key)){const sx=key==='scalex'?clamp(v/100,-100,100):1,sy=key==='scaley'?clamp(v/100,-100,100):1,a=key==='angle'?clamp(v,-3600,3600)*DEG:0,m=M.chain(M.r(a),M.s(sx,sy));
      vectorTransform(L,p=>{const q=M.apv(m,p[0]-c[0],p[1]-c[1]);return [c[0]+q[0],c[1]+q[1]];});for(const id of ids)for(const side of ['hin','hout'])if(L.pts[id][side]||L.ch['pv:'+id+':'+side])setVal(L,'pv:'+id+':'+side,M.apv(m,...val(L,'pv:'+id+':'+side,S.frame)));}
    if(key==='curvature')for(const id of ids){setVal(L,'pv:'+id+':c',clamp(v,-3,3));vectorClearHandles(L,id);}
    if(key==='pointwidth')for(const id of ids)setVal(L,'pv:'+id+':width',clamp(v,0,20));
    if(key==='pointalpha')for(const id of ids)setVal(L,'pv:'+id+':alpha',clamp(v,0,1));
    if(key==='pointdrift')for(const id of ids)setVal(L,'pv:'+id+':strength',clamp(v,0,1));
    if(key==='start'||key==='end')for(const p of vectorSelectedPaths(L))setVal(L,'curve:'+p.id+':'+key,clamp(v/100,0,1));
  });
}
function vectorRunAction(action){
  if(action==='finish')return finishPen(false);
  if(action==='freeoptions'){VEC.freeExpanded=!VEC.freeExpanded;return renderToolOpts();}
  if(action==='resetcurve')return vectorAction('Reset curvature',L=>{const values=vectorIDs(L).map(id=>({id,c:S.frame?val(L,'pv:'+id+':c',0):1,hin:vectorAutoHandle(L,id,'hin',0),hout:vectorAutoHandle(L,id,'hout',0)}));for(const p of values){setVal(L,'pv:'+p.id+':c',p.c);if(S.frame){for(const side of ['hin','hout'])if(L.pts[p.id][side]||L.ch['pv:'+p.id+':'+side])setVal(L,'pv:'+p.id+':'+side,p[side]);}else vectorClearHandles(L,p.id);}});
  if(action==='peak'||action==='smooth'||action==='reverse')return vectorCurvature(action==='peak'?0:action==='smooth'?1:(L,id)=>-val(L,'pv:'+id+':c',S.frame));
  const topology=['split','weld','simplify','createshape','deleteshape'].includes(action);
  return vectorAction(action,L=>{
    if(action==='groupcreate'){const name=VEC.groupName.trim();if(!name||!S.selPts.size)return toast('Enter a group name and select its points','err');L.pointGroups=L.pointGroups||[];let g=L.pointGroups.find(g=>g.name===name);if(!g){g={id:uid('pg'),name,points:[]};L.pointGroups.push(g);}g.points=vectorIDs(L);VEC.group=g.id;}
    if(action==='groupdelete'){L.pointGroups=(L.pointGroups||[]).filter(g=>g.id!==VEC.group);VEC.group='';}
    if(action==='split')vectorSplitSelected(L);
    if(action==='weld')vectorWeldCrossings(L);
    if(action==='simplify')vectorSimplify(L);
    if(action==='createshape')vectorCreateShape(L);
    if(action==='deleteshape'){const id=S.selShape;L.shapes=L.shapes.filter(s=>s.id!==id);deleteChannelsMatching(L,k=>k.startsWith('sh:'+id+':'));S.selShape=null;}
    if(action==='resetpoints'){const values=vectorIDs(L).map(id=>[id,val(L,'pt:'+id,0)]);for(const [id,p]of values)setVal(L,'pt:'+id,p);}
    if(action==='flipx'||action==='flipy'){const axis=action==='flipx'?0:1,c=vectorCenter(L);vectorTransform(L,p=>p.map((n,i)=>i===axis?2*c[axis]-n:n));for(const id of vectorIDs(L))for(const side of ['hin','hout'])if(L.pts[id][side]||L.ch['pv:'+id+':'+side]){const v=val(L,'pv:'+id+':'+side,S.frame).slice();v[axis]*=-1;setVal(L,'pv:'+id+':'+side,v);}}
    if(action==='widthreset')for(const id of vectorIDs(L))setVal(L,'pv:'+id+':width',1);
    if(action==='exposurereset')for(const p of vectorSelectedPaths(L)){setVal(L,'curve:'+p.id+':start',0);setVal(L,'curve:'+p.id+':end',1);}
    if(action==='applyprofile'||action==='clearprofile')vectorApplyProfile(L,action==='clearprofile'?'':VEC.profile);
    if(action==='applycolor'||action==='clearcolor')for(const id of vectorIDs(L)){setVal(L,'pv:'+id+':color',VEC.pointColor);setVal(L,'pv:'+id+':strength',action==='clearcolor'?0:VEC.colorStrength);L.pts[id].colorRadius=VEC.colorRadius;}
  },topology);
}
const vectorOldOptions=renderToolOpts;
renderToolOpts=function(){
  if(!VECTOR_DRAW.includes(S.tool)&&!VECTOR_FILL.includes(S.tool))return vectorOldOptions();
  const el=$('#toolopts');if(!el)return;
  if(document.activeElement&&el.contains(document.activeElement)&&['INPUT','SELECT'].includes(document.activeElement.tagName))return;
  const t=TOOLS[S.tool],h=`<span class="tname" title="${esc(t.hint)}">${t.icon} ${esc(t.name)}</span><span class="sep"></span>`+vectorOptionsHTML(selLayer())+'<span class="sep"></span>'+contextHTML();
  if(el._h===h)return;el._h=h;el.innerHTML=h;
  const refresh=()=>{el._h='';requestDraw();};
  el.querySelectorAll('[data-va]').forEach(b=>b.onclick=()=>{vectorRunAction(b.dataset.va);refresh();});
  el.querySelectorAll('[data-vcheck]').forEach(i=>i.onchange=()=>{const k=i.dataset.vcheck;if(k==='fillOn'||k==='strokeOn')S.newStyle[k]=i.checked;else VEC[k]=i.checked;refresh();});
  el.querySelectorAll('[data-vnum]').forEach(i=>i.onchange=()=>{const n=+i.value;if(i.value!==''&&Number.isFinite(n))vectorNumericChange(i.dataset.vnum,n);i.blur();refresh();renderToolOpts();});
  el.querySelectorAll('[data-vstyle]').forEach(i=>i.onchange=()=>{if(i.dataset.vstyle==='pointColor')VEC.pointColor=i.value;else S.newStyle[i.dataset.vstyle]=i.value;refresh();});
  el.querySelectorAll('[data-vtext]').forEach(i=>i.oninput=()=>{VEC[i.dataset.vtext]=i.value;});
  el.querySelectorAll('[data-vselect]').forEach(i=>i.onchange=()=>{const k=i.dataset.vselect;VEC[k]=i.value;if(k==='group'){const g=selLayer()?.pointGroups?.find(g=>g.id===i.value);if(g){S.selPts=new Set(g.points.filter(id=>selLayer().pts[id]));VEC.groupName=g.name;}}i.blur();refreshAll();refresh();renderToolOpts();});
  el.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>runCmd(b.dataset.cmd));
  el.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
  el.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
};
// ---------- Binding (Moho model) ----------
// Bind Points assigns each selected point to exactly one bone, only when Bind Points is run (button / Space).
// Un-bind releases points (no bone moves them); Flexi-bind returns them to automatic influence.
// Bind Layer attaches a whole layer to one bone and disables Bind Points; point settings are kept underneath.
function bindArtLayers(){const B=activeBoneLayer();return S.selLayers.map(id=>findLayer(id)).filter(L=>L&&L.type!=='bone'&&L.type!=='audio'&&boneLayerFor(L)===B);}
function bindTargetBone(L,id){selectBone(id);S.selPts=new Set(Object.keys(L.pts||{}).filter(pid=>(L.pts[pid].b||[]).some(q=>q[0]===id)));refreshAll();const b=boneOf(boneLayerFor(L),id);toast(`${S.selPts.size} point(s) are bound to ${b?b.name:'this bone'}`);}
function bindPointsCheck(){const L=selLayer(),B=L&&boneLayerFor(L);
  if(!L||L.type!=='vector'||!B)return 'Select a vector layer inside a Bone Group';
  if(L.bindBone)return `“${L.name}” is bound as a whole layer — clear that attachment first`;
  if(S.mode!=='setup')return 'Binding is rig setup — switch to Setup mode (Tab)';
  if(!S.selPts.size)return 'Select the points to change first';
  return writeReason(L)||null;}
const bindSelectPoints={down:TOOLS.points.down,move:TOOLS.points.move,up:TOOLS.points.up};
defTool('bindpts',{icon:TOOLS.bindpts.icon,name:'Bind points',key:'D',cursor:'crosshair',
  hint:'Select points (click, drag a box; Ctrl/Cmd: lasso; Shift adds; Alt removes) · Alt-click a bone to target it and select its points · Bind points (or tap Space) assigns them; selecting alone binds nothing',
  down(e,sx,sy){const L=selLayer(),B=boneLayerFor(L);if(e.altKey&&B){const hb=hitBone(B,sx,sy);if(hb)return bindTargetBone(L,hb.id);}bindSelectPoints.down.call(TOOLS.points,e,sx,sy);},
  move(e,sx,sy){bindSelectPoints.move.call(TOOLS.points,e,sx,sy);},
  up(e){bindSelectPoints.up.call(TOOLS.points,e);}});
function bindRun(label,fn){const why=bindPointsCheck();if(why)return toast(why,'err');const L=selLayer(),n=vectorIDs(L).length;edit(label,()=>{for(const id of vectorIDs(L))fn(L.pts[id]);});return n;}
CMDS.find(c=>c.id==='rig.bindpts').run=()=>{const L=selLayer(),B=L&&boneLayerFor(L);if(!B||!boneOf(B,S.selBone))return toast('Choose the target bone first (Alt-click it, or pick it in the toolbar)','err');const b=boneOf(B,S.selBone),n=bindRun('Bind points',p=>{p.b=[[b.id,1]];});if(n)toast(`Bound ${n} point(s) to ${b.name}`,'ok');};
Object.assign(CMDS.find(c=>c.id==='rig.unbindpts'),{label:'Un-bind (release) selected points',en:needPts,run(){const n=bindRun('Release points',p=>{p.b=[];});if(n)toast(`Released ${n} point(s) — no bone moves them now`,'ok');}});
cmd('rig.flexipts','Rig','Flexi-bind selected points',()=>{const n=bindRun('Flexi-bind points',p=>{delete p.b;});if(n)toast(`${n} point(s) returned to automatic flexi-binding`,'ok');},{en:needPts});
const bindLayerCmd=(id,label,fn,done,pre)=>cmd(id,'Rig',label,()=>{const Ls=bindArtLayers();if(!Ls.length)return toast('Select artwork layers inside a Bone Group','err');const stop=pre&&pre(Ls);if(stop)return toast(stop,'err');if(S.mode!=='setup')return toast('Binding is rig setup — switch to Setup mode (Tab)','err');const why=Ls.map(writeReason).find(Boolean);if(why)return toast(why,'err');
  const r=edit(label,()=>Ls.forEach(fn));if(r!==false&&done)toast(done(Ls),'ok');},{en:()=>bindArtLayers().length?false:'Select artwork layers inside a Bone Group'});
bindLayerCmd('rig.releaselayer','Release layer',L=>{L.bindBone=null;L.flexi=false;},Ls=>`${Ls.length} layer(s) released — the skeleton no longer moves them (point bindings are kept)`);
bindLayerCmd('rig.flexilayer','Flexi-bind layer',L=>{L.bindBone=null;delete L.flexi;},Ls=>`${Ls.length} layer(s) use automatic flexi-binding`);
bindLayerCmd('rig.flexiselected','Use selected bones for flexi-binding',L=>{L.flexiBones=selectedBoneIds().filter(id=>boneOf(boneLayerFor(L),id));},Ls=>`Flexi-binding limited to ${Ls[0].flexiBones.length} selected bone(s)`,Ls=>selectedBoneIds().some(id=>boneOf(boneLayerFor(Ls[0]),id))?null:'Select the bones to use first (Select bone tool), then the artwork layer');
bindLayerCmd('rig.flexiall','Use all bones for flexi-binding',L=>{delete L.flexiBones;},()=>'Flexi-binding uses all bones again');
// Handle editing uses the same interaction in every tool that offers handles.
for(const id of ['points','pen','curvature']){const t=TOOLS[id],down=t.down,move=t.move,up=t.up;
  t.down=function(e,x,y){const L=selLayer();if(VEC.handles&&L?.type==='vector'&&vectorHandles(L).some(h=>Math.hypot(h.p[0]-x,h.p[1]-y)<7*Stage.dpr))return TOOLS.pointtf.down(e,x,y);return down.call(this,e,x,y);};
  t.move=function(e,x,y){if(Stage.drag?.mode==='handle')return TOOLS.pointtf.move(e,x,y);return move.call(this,e,x,y);};
  t.up=function(e){if(Stage.drag?.mode==='handle')return TOOLS.pointtf.up(e);return up.call(this,e);};
}
const vectorOldDeleteSelection=deleteSelection;
deleteSelection=function(){if(!S.selKeys.size&&VECTOR_FILL.includes(S.tool)&&S.selShape)return vectorRunAction('deleteshape');return vectorOldDeleteSelection();};
const vectorOldKeyPose=keyCurrentTimelinePose;
keyCurrentTimelinePose=function(){const L=selLayer();if(L?.type!=='vector'||!POINT_TOOLS.has(S.tool)||['points','pointtf'].includes(S.tool)){
    if(S.tool==='pointtf'){const previous=S.tool;S.tool='points';try{return vectorOldKeyPose();}finally{S.tool=previous;}}return vectorOldKeyPose();}
  if(S.mode==='setup'||S.frame===0)return toast('Move to an animation frame before keying a pose','err');
  return vectorAction('Key vector pose',()=>{
    const attrs=S.tool==='curvature'?['c']:S.tool==='linewidth'?['width']:S.tool==='colorpoints'?['color','strength']:null;
    if(attrs){for(const id of (S.selPts.size?vectorIDs(L):Object.keys(L.pts)))for(const a of attrs){const path='pv:'+id+':'+a;setVal(L,path,val(L,path,S.frame),S.frame,true);}return;}
    if(S.tool==='exposure'||S.tool==='profile'){for(const p of vectorSelectedPaths(L))for(const a of S.tool==='exposure'?['start','end']:['repeats','offset']){const path='curve:'+p.id+':'+a;setVal(L,path,val(L,path,S.frame),S.frame,true);}return;}
    for(const id of vectorIDs(L))setVal(L,'pt:'+id,val(L,'pt:'+id,S.frame),S.frame,true);
  });
};
CMDS.find(c=>c.id==='anim.keyall').run=keyCurrentTimelinePose;
for(const [action,label]of [['split','Split selected segments'],['weld','Weld curve crossings'],['simplify','Simplify curves'],['createshape','Create shape from selected curves']])cmd('vector.'+action,'Draw',label,()=>vectorRunAction(action),{en:()=>toolAvail(action==='createshape'?'createshape':'reduce')});
Object.assign(window.PopaiApp||{}, {keyCurrentTimelinePose});

// Keep menu actions consistent with the toolbar's channels and safeguards.
for(const [id,run]of [['pts.smooth',()=>vectorRunAction('smooth')],['pts.corner',()=>vectorRunAction('peak')],['pts.flipH',()=>vectorRunAction('flipx')],['pts.flipV',()=>vectorRunAction('flipy')],['shape.create',()=>vectorRunAction('createshape')],['shape.del',()=>vectorRunAction('deleteshape')]])CMDS.find(c=>c.id===id).run=run;
for(const id of ['pts.del','pts.close'])CMDS.find(c=>c.id===id).en=()=>toolAvail('deleteedge')||needPts();
TOOLS.points.icon=svgI('<path stroke-dasharray="2 2" d="M3 3h18v18H3Z"/>');
TOOLS.curvature.icon=svgI('<path d="M3 20C3-3 21-3 21 20"/>');
TOOLS.freehand.icon=svgI('<path d="m3 20 3-7L17 2l5 5L11 18Zm3-7 5 5"/>');
TOOLS.pen.icon=svgI('<path d="M3 20C3 2 21 2 21 20M12 2v6m-3-3h6"/>');
TOOLS.fill.icon=svgI('<path d="m4 11 8-8 8 8-8 8Zm8-8-3-3m12 14s-4 5-1 7 5-2 1-7"/>');
const vectorOldValidateProject=validateProject;
validateProject=function(input){
  const d=vectorOldValidateProject(input),range=(v,a,b)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
  const pointAttr=(key,value)=>{
    if(['hin','hout'].includes(key))return Array.isArray(value)&&value.length===2&&value.every(v=>range(v,-1e7,1e7));
    if(key==='color')return isColor(value);
    const bounds={c:[-3,3],width:[0,100],alpha:[0,1],strength:[0,1],colorRadius:[1,1000]}[key];return bounds&&range(value,...bounds);
  };
  walk(d.layers,L=>{if(L.type!=='vector')return;
    for(const p of Object.values(L.pts))for(const key of ['c','width','alpha','strength','color','hin','hout','colorRadius'])if(p[key]!==undefined&&!pointAttr(key,p[key]))throw Error('Invalid vector point '+key);
    const paths=new Map(L.paths.map(p=>[p.id,p]));if(paths.size!==L.paths.length)throw Error('Duplicate vector path');
    for(const p of L.paths){if(p.profile&&(!paths.has(p.profile)||paths.get(p.profile).closed||p.profile===p.id))throw Error('Invalid curve profile');
      for(const [key,bounds]of Object.entries({start:[0,1],end:[0,1],repeats:[1,64],offset:[-100,100]}))if(p[key]!==undefined&&!range(p[key],...bounds))throw Error('Invalid curve '+key);
      for(const key of Object.keys(p))if(key.startsWith('hide_')&&(typeof p[key]!=='boolean'||!p.pts.includes(key.slice(5))))throw Error('Invalid hidden edge');
    }
    if(L.pointGroups!==undefined){if(!Array.isArray(L.pointGroups)||L.pointGroups.length>5000)throw Error('Invalid point groups');const seen=new Set();for(const g of L.pointGroups){if(!g||typeof g.id!=='string'||!/^[A-Za-z0-9_-]+$/.test(g.id)||seen.has(g.id)||typeof g.name!=='string'||g.name.length>100||!Array.isArray(g.points)||g.points.some(id=>!Object.hasOwn(L.pts,id)))throw Error('Invalid point group');seen.add(g.id);}}
    for(const [key,ch]of Object.entries(L.ch)){const [kind,id,prop]=key.split(':');if(kind==='pv'){if(!Object.hasOwn(L.pts,id)||ch.keys.some(k=>!pointAttr(prop,k.v)))throw Error('Invalid animated vector property');}
      if(kind==='curve'){const p=paths.get(id);if(!p)throw Error('Missing animated curve');const bounds={start:[0,1],end:[0,1],repeats:[1,64],offset:[-100,100]}[prop];if(prop.startsWith('hide_')){if(!p.pts.includes(prop.slice(5))||ch.keys.some(k=>typeof k.v!=='boolean'))throw Error('Invalid animated hidden edge');}else if(!bounds||ch.keys.some(k=>!range(k.v,...bounds)))throw Error('Invalid animated curve property');}
    }
  });return d;
};
Object.assign(window.PopaiApp||{}, {toolAvail,validateProject,keyCurrentTimelinePose});
