/* Popai Animator — 3D workspace maths.
 * Layers are flat planes in space (Moho-style 2.5D). The engine sends, per layer:
 *   h  — homography from a tilted layer plane to the picture (camera view), or
 *   w3 — the plane's 4x4 world matrix (column-major), when the scene is viewed from another direction.
 * This module builds view projections (Front/Top/Right/Orbit...), combines them with those matrices
 * and draws a layer's artwork onto a plane in perspective (a textured triangle mesh on a 2D canvas). */

export type H3 = number[]; // 3x3 row-major homography
export type P34 = number[][]; // 3x4 row-major projection
export type Aff = number[]; // canvas affine [a, b, c, d, e, f]

export const CAM_D = 1500; // same as the engine: the camera sits CAM_D in front of the picture plane

export const DIRS: [string, string][] = [
  ['camera', 'Camera'], ['front', 'Front'], ['back', 'Back'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right'], ['orbit', 'Orbit'],
];

/** Picture-space projection (before the workspace pan/zoom) for a viewing direction.
 *  Orthographic for the six side views; perspective around the camera's target for Orbit. */
export function dirProj(dir: string, o: { yaw: number; pitch: number; dist: number; tx: number; ty: number }): P34 {
  const { tx, ty } = o;
  switch (dir) {
    case 'front': return [[1, 0, 0, -tx], [0, 1, 0, -ty], [0, 0, 0, 1]];
    case 'back': return [[-1, 0, 0, tx], [0, 1, 0, -ty], [0, 0, 0, 1]];
    case 'top': return [[1, 0, 0, -tx], [0, 0, 1, 0], [0, 0, 0, 1]]; // looking down: depth runs up the screen (far = top)
    case 'bottom': return [[1, 0, 0, -tx], [0, 0, -1, 0], [0, 0, 0, 1]];
    case 'right': return [[0, 0, -1, 0], [0, 1, 0, -ty], [0, 0, 0, 1]]; // from the right: the camera is on the left
    case 'left': return [[0, 0, 1, 0], [0, 1, 0, -ty], [0, 0, 0, 1]];
    default: { // orbit: perspective eye on a sphere around the target
      const yaw = (o.yaw * Math.PI) / 180, pitch = (o.pitch * Math.PI) / 180, d = o.dist;
      const eye = [tx + d * Math.sin(yaw) * Math.cos(pitch), ty - d * Math.sin(pitch), d * Math.cos(yaw) * Math.cos(pitch)];
      const fw = norm([tx - eye[0], ty - eye[1], 0 - eye[2]]);
      const right = norm(cross([0, -1, 0], fw)), up = cross(fw, right);
      const F = d; // the target plane keeps scale 1
      return [
        [F * right[0], F * right[1], F * right[2], -F * dot(right, eye)],
        [-F * up[0], -F * up[1], -F * up[2], F * dot(up, eye)],
        [fw[0], fw[1], fw[2], -dot(fw, eye)],
      ];
    }
  }
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** canvas affine as a 3x3 */
export const aff33 = (m: Aff): H3 => [m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1];
export function mul33(a: H3, b: H3): H3 {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
/** affine(3x3) x P(3x4) */
export function mulAP(a: H3, p: P34): P34 {
  return [0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => a[r * 3] * p[0][c] + a[r * 3 + 1] * p[1][c] + a[r * 3 + 2] * p[2][c]));
}
/** P(3x4) x plane(4x4 column-major), keeping the plane's x, y and 1 columns -> homography */
export function planeH(p: P34, w3: number[]): H3 {
  const h = new Array(9).fill(0);
  [0, 1, 3].forEach((col, k) => { for (let r = 0; r < 3; r++) h[r * 3 + k] = p[r][0] * w3[col * 4] + p[r][1] * w3[col * 4 + 1] + p[r][2] * w3[col * 4 + 2] + p[r][3] * w3[col * 4 + 3]; });
  return h;
}
export function projPt(p: P34, x: number, y: number, z: number): number[] | null {
  const w = p[2][0] * x + p[2][1] * y + p[2][2] * z + p[2][3];
  if (w <= 1e-6) return null;
  return [(p[0][0] * x + p[0][1] * y + p[0][2] * z + p[0][3]) / w, (p[1][0] * x + p[1][1] * y + p[1][2] * z + p[1][3]) / w];
}
export function applyH(h: H3, x: number, y: number): number[] {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w, w];
}
export const isAffine = (h: H3) => Math.abs(h[6]) < 1e-12 && Math.abs(h[7]) < 1e-12;
export const hToAff = (h: H3): Aff => [h[0] / h[8], h[3] / h[8], h[1] / h[8], h[4] / h[8], h[2] / h[8], h[5] / h[8]];
/** best affine approximation of h around (x, y) — used for picking and handles on tilted layers */
export function linearize(h: H3, x = 0, y = 0): Aff {
  const w = h[6] * x + h[7] * y + h[8] || 1e-9, X = h[0] * x + h[1] * y + h[2], Y = h[3] * x + h[4] * y + h[5], w2 = w * w;
  const a = (h[0] * w - X * h[6]) / w2, c = (h[1] * w - X * h[7]) / w2, b = (h[3] * w - Y * h[6]) / w2, d = (h[4] * w - Y * h[7]) / w2;
  return [a, b, c, d, X / w - a * x - c * y, Y / w - b * x - d * y];
}

/** Draws `img` (whose pixel (px, py) shows plane point (x0 + px / k, y0 + py / k)) onto the plane
 *  mapped by homography h, as a grid of affine triangles. Returns false if the plane is behind the eye. */
export function drawWarped(ctx: CanvasRenderingContext2D, img: CanvasImageSource, h: H3, x0: number, y0: number, bw: number, bh: number, k: number, pad: number) {
  const ws = [[x0, y0], [x0 + bw, y0], [x0, y0 + bh], [x0 + bw, y0 + bh]].map(([x, y]) => h[6] * x + h[7] * y + h[8]);
  const wmin = Math.min(...ws), wmax = Math.max(...ws);
  if (wmin <= 0.02) return false; // (part of) the plane is behind the eye
  const r = wmax / wmin, N = r < 1.03 ? 4 : r < 1.25 ? 8 : r < 2 ? 12 : 18;
  const P: number[][][] = [];
  for (let j = 0; j <= N; j++) { P.push([]); for (let i = 0; i <= N; i++) { const x = x0 + (bw * i) / N, y = y0 + (bh * j) / N; P[j].push([...applyH(h, x, y), pad + (x - x0) * k, pad + (y - y0) * k]); } }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = P[j][i], b = P[j][i + 1], c = P[j + 1][i], d = P[j + 1][i + 1];
    tri(ctx, img, a, b, d); tri(ctx, img, a, d, c);
  }
  ctx.restore();
  return true;
}
// p = [screenX, screenY, w, srcX, srcY]
function tri(ctx: CanvasRenderingContext2D, img: CanvasImageSource, p0: number[], p1: number[], p2: number[]) {
  const [x0, y0, , u0, v0] = p0, [x1, y1, , u1, v1] = p1, [x2, y2, , u2, v2] = p2;
  const den = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0); if (Math.abs(den) < 1e-9) return;
  const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / den, c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / den;
  const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / den, d = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / den;
  const e = x0 - a * u0 - c * v0, f = y0 - b * u0 - d * v0;
  // grow the clip triangle by ~0.75 px on every edge so neighbouring triangles overlap (no hairline seams)
  const [q0, q1, q2] = grow([[x0, y0], [x1, y1], [x2, y2]], 0.75);
  ctx.save(); ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.closePath(); ctx.clip();
  ctx.setTransform(a, b, c, d, e, f); ctx.drawImage(img, 0, 0); ctx.restore();
}

/** Offsets each edge of a triangle outward by d pixels (vertices move along their corner bisectors). */
function grow(v: number[][], d: number): number[][] {
  const area = (v[1][0] - v[0][0]) * (v[2][1] - v[0][1]) - (v[2][0] - v[0][0]) * (v[1][1] - v[0][1]);
  const sg = area > 0 ? 1 : -1;
  const nrm = (a: number[], b: number[]) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [(sg * dy) / l, (-sg * dx) / l]; };
  const n = [nrm(v[0], v[1]), nrm(v[1], v[2]), nrm(v[2], v[0])]; // outward normal of edge i (v[i] -> v[i+1])
  return v.map((p, i) => {
    const a = n[(i + 2) % 3], b = n[i], k = Math.min(4, 1 / Math.max(0.25, 1 + a[0] * b[0] + a[1] * b[1]));
    return [p[0] + (a[0] + b[0]) * d * k, p[1] + (a[1] + b[1]) * d * k];
  });
}
