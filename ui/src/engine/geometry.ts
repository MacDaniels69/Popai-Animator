import type { Cubic, GeometryInput, GeometryResult, Vec2 } from '../domain/model';
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0]-b[0], a[1]-b[1]);
const midpoint = (a: Vec2, b: Vec2): Vec2 => [(a[0]+b[0])/2,(a[1]+b[1])/2];
function split(q: Cubic): [Cubic,Cubic] {
  const a=midpoint(q[0],q[1]),b=midpoint(q[1],q[2]),c=midpoint(q[2],q[3]),d=midpoint(a,b),e=midpoint(b,c),p=midpoint(d,e);
  return [[q[0],a,d,p],[p,e,c,q[3]]];
}
export function flattenCubic(q: Cubic, tolerance=.5, depth=0): Vec2[] {
  const polygon=distance(q[0],q[1])+distance(q[1],q[2])+distance(q[2],q[3]);
  if(depth>=14||polygon-distance(q[0],q[3])<=Math.max(.001,tolerance))return [q[0],q[3]];
  const [a,b]=split(q);return flattenCubic(a,tolerance,depth+1).slice(0,-1).concat(flattenCubic(b,tolerance,depth+1));
}
export function analyzeGeometry(input: GeometryInput): GeometryResult {
  const started=performance.now();let count=0,samples=0,length=0,x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  if(!input||typeof input.token!=='string'||!Array.isArray(input.paths)||input.paths.length>20000)throw new Error('Invalid geometry request');
  for(const path of input.paths){if(!Array.isArray(path.segments))throw new Error('Invalid segments');
    for(const q of path.segments){if(++count>20000||!Array.isArray(q)||q.length!==4||q.some(p=>!Array.isArray(p)||p.length!==2||p.some(n=>!Number.isFinite(n)||Math.abs(n)>1e8)))throw new Error('Geometry exceeds analysis limits');
      const points=flattenCubic(q);samples+=points.length;if(samples>1_000_000)throw new Error('Geometry analysis exceeds sample budget');
      for(let i=0;i<points.length;i++){const [x,y]=points[i];x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);if(i)length+=distance(points[i-1],points[i]);}
    }
  }
  return {token:input.token,pathCount:input.paths.length,segmentCount:count,sampleCount:samples,length,bounds:count?[x0,y0,x1,y1]:null,durationMs:performance.now()-started};
}
