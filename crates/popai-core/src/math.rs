//! 2D affine matrices and the deterministic noise helpers.
//! Every function mirrors the JavaScript engine exactly (same formulas, same operation order),
//! because project files and renders must stay identical across engines.

/// Affine matrix in canvas convention `[a, b, c, d, e, f]`:
/// `x' = a*x + c*y + e`, `y' = b*x + d*y + f`.
pub type Mat = [f64; 6];

pub const DEG: f64 = std::f64::consts::PI / 180.0;
pub const IDENTITY: Mat = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

#[inline]
pub fn mul(m: &Mat, n: &Mat) -> Mat {
    [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}
/// `chain(a, b, c) == mul(mul(a, b), c)` — left fold like `M.chain` in JS.
pub fn chain(ms: &[Mat]) -> Mat {
    let mut r = ms[0];
    for m in &ms[1..] {
        r = mul(&r, m);
    }
    r
}
#[inline]
pub fn t(x: f64, y: f64) -> Mat {
    [1.0, 0.0, 0.0, 1.0, x, y]
}
#[inline]
pub fn r(a: f64) -> Mat {
    let (s, c) = (a.sin(), a.cos());
    [c, s, -s, c, 0.0, 0.0]
}
#[inline]
pub fn s(x: f64, y: f64) -> Mat {
    [x, 0.0, 0.0, y, 0.0, 0.0]
}
pub fn inv(m: &Mat) -> Mat {
    let mut det = m[0] * m[3] - m[1] * m[2];
    if det == 0.0 {
        det = 1e-12; // JS: `|| 1e-12`
    }
    [
        m[3] / det,
        -m[1] / det,
        -m[2] / det,
        m[0] / det,
        (m[2] * m[5] - m[3] * m[4]) / det,
        (m[1] * m[4] - m[0] * m[5]) / det,
    ]
}
#[inline]
pub fn ap(m: &Mat, x: f64, y: f64) -> [f64; 2] {
    [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}
pub fn scale_of(m: &Mat) -> f64 {
    (m[0] * m[3] - m[1] * m[2]).abs().sqrt()
}

#[inline]
pub fn clamp(v: f64, a: f64, b: f64) -> f64 {
    if v < a {
        a
    } else if v > b {
        b
    } else {
        v
    }
}
#[inline]
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}
/// JavaScript `Math.round` (halves round towards +infinity), not Rust's half-away-from-zero.
#[inline]
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}
pub fn hash1(n: f64, seed: f64) -> f64 {
    let x = (n * 127.1 + seed * 311.7).sin() * 43758.5453;
    x - x.floor()
}
pub fn vnoise(t: f64, seed: f64) -> f64 {
    let i = t.floor();
    let f = t - i;
    let u = f * f * (3.0 - 2.0 * f);
    lerp(hash1(i, seed), hash1(i + 1.0, seed), u) * 2.0 - 1.0
}
/// Distance from point to segment (used by flexible binding and auto-binding).
pub fn dist_to_seg(px: f64, py: f64, a: [f64; 2], b: [f64; 2]) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let mut l2 = dx * dx + dy * dy;
    if l2 == 0.0 {
        l2 = 1e-9;
    }
    let tt = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0.0, 1.0);
    (px - (a[0] + tt * dx)).hypot(py - (a[1] + tt * dy))
}
