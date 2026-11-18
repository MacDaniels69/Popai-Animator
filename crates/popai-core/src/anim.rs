//! Keyframe channels: interpolation and property access (base values + animated channels).

use crate::model::{Channel, Key, Layer};
use crate::math::vnoise;
use crate::value::{mix_val, Val};

fn ease(name: &str, t: f64) -> f64 {
    match name {
        "linear" => t,
        "step" => 0.0,
        "easein" => t * t * t,
        "easeout" => 1.0 - (1.0 - t).powi(3),
        "bounce" => {
            let (n, d) = (7.5625, 2.75);
            if t < 1.0 / d {
                n * t * t
            } else if t < 2.0 / d {
                let t = t - 1.5 / d;
                n * t * t + 0.75
            } else if t < 2.5 / d {
                let t = t - 2.25 / d;
                n * t * t + 0.9375
            } else {
                let t = t - 2.625 / d;
                n * t * t + 0.984375
            }
        }
        "elastic" => {
            if t == 0.0 || t == 1.0 {
                t
            } else {
                2f64.powf(-10.0 * t) * ((t * 10.0 - 0.75) * ((2.0 * std::f64::consts::PI) / 3.0)).sin() + 1.0
            }
        }
        // "ease" and unknown names
        _ => {
            if t < 0.5 {
                4.0 * t * t * t
            } else {
                1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
            }
        }
    }
}
fn hermite(a: f64, b: f64, ma: f64, mb: f64, t: f64) -> f64 {
    let (t2, t3) = (t * t, t * t * t);
    (2.0 * t3 - 3.0 * t2 + 1.0) * a + (t3 - 2.0 * t2 + t) * ma + (-2.0 * t3 + 3.0 * t2) * b + (t3 - t2) * mb
}

/// Bézier easing: x(s) = t is solved by bisection (identical in the JS engine), then y(s).
pub fn bezier_ease(bz: &[f64; 4], t: f64) -> f64 {
    let (x1, y1, x2, y2) = (bz[0].clamp(0.0, 1.0), bz[1], bz[2].clamp(0.0, 1.0), bz[3]);
    let cb = |a: f64, b: f64, s: f64| 3.0 * (1.0 - s) * (1.0 - s) * s * a + 3.0 * (1.0 - s) * s * s * b + s * s * s;
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..40 {
        let mid = (lo + hi) / 2.0;
        if cb(x1, x2, mid) < t {
            lo = mid
        } else {
            hi = mid
        }
    }
    cb(y1, y2, (lo + hi) / 2.0)
}
/// Frame inside the repeated range that a Cycle key maps `f` to (None = no valid range: hold).
fn cycle_map(a: &Key, f: f64) -> Option<f64> {
    let c = a.cy.unwrap_or(0.0);
    let target = if a.cm.as_deref() == Some("rel") { a.f - c } else { c };
    let len = a.f - target;
    if !(len > 0.0) {
        return None;
    }
    Some(target + (f - a.f).rem_euclid(len))
}

/// Value of a channel at frame `f` (JS `evalChannel`).
pub fn eval_channel(ch: &Channel, f: f64) -> Option<Val> {
    let k = &ch.keys;
    if k.is_empty() {
        return None;
    }
    if f <= k[0].f {
        return Some(k[0].v.clone());
    }
    let last = &k[k.len() - 1];
    if f >= last.f {
        if f > last.f && last.i.as_deref() == Some("cycle") {
            if let Some(g) = cycle_map(last, f) {
                return eval_channel(ch, g);
            }
        }
        return Some(last.v.clone());
    }
    let (mut lo, mut hi) = (0usize, k.len() - 1);
    while hi - lo > 1 {
        let m = (lo + hi) >> 1;
        if k[m].f <= f {
            lo = m
        } else {
            hi = m
        }
    }
    let (a, b): (&Key, &Key) = (&k[lo], &k[hi]);
    let it = a.i.as_deref().unwrap_or("smooth");
    if it == "cycle" {
        return match cycle_map(a, f) {
            Some(g) => eval_channel(ch, g),
            None => Some(a.v.clone()),
        };
    }
    // timing controls: hold, interval (on twos...), stagger
    let span = b.f - a.f;
    let hold = a.hold.unwrap_or(0.0).max(0.0).min(span);
    if f - a.f < hold {
        return Some(a.v.clone());
    }
    let start = a.f + hold;
    let mut fa = f;
    let iv = a.iv.unwrap_or(0.0).floor();
    if iv >= 2.0 {
        fa = start + ((fa - start) / iv).floor() * iv;
    }
    if a.stg == Some(true) {
        let q = if iv >= 2.0 { iv } else { 2.0 };
        let idx = ((fa - start) / q).floor();
        fa = if idx.rem_euclid(2.0) == 1.0 { start + (idx - 0.5) * q } else { start + idx * q };
    }
    let t = if b.f - start > 0.0 { ((fa - start) / (b.f - start)).clamp(0.0, 1.0) } else { 1.0 };
    let numeric = matches!(a.v, Val::Num(_) | Val::Arr(_));
    if !numeric && !a.v.is_color() {
        return Some(a.v.clone());
    }
    if it == "step" {
        return Some(a.v.clone());
    }
    if it == "smooth" && numeric {
        let p = if lo > 0 { Some(&k[lo - 1]) } else { None };
        let n = k.get(hi + 1);
        let span = b.f - a.f;
        let comp = |av: f64, bv: f64, pv: f64, nv: f64| {
            let ma = match p {
                Some(p) => ((bv - pv) / (b.f - p.f)) * span,
                None => 0.0,
            };
            let mb = match n {
                Some(n) => ((nv - av) / (n.f - a.f)) * span,
                None => 0.0,
            };
            hermite(av, bv, ma, mb, t)
        };
        return Some(match (&a.v, &b.v) {
            (Val::Num(av), Val::Num(bv)) => {
                let pv = p.and_then(|p| p.v.num()).unwrap_or(0.0);
                let nv = n.and_then(|n| n.v.num()).unwrap_or(0.0);
                Val::Num(comp(*av, *bv, pv, nv))
            }
            (Val::Arr(av), Val::Arr(bv)) => {
                let comp_at = |kk: Option<&Key>, i: usize| match kk.map(|x| &x.v) {
                    Some(Val::Arr(v)) => v.get(i).copied().unwrap_or(f64::NAN),
                    _ => 0.0,
                };
                Val::Arr(av.iter().enumerate().map(|(i, x)| comp(*x, bv.get(i).copied().unwrap_or(f64::NAN), comp_at(p, i), comp_at(n, i))).collect())
            }
            _ => mix_val(&a.v, &b.v, ease("ease", t)),
        });
    }
    if it == "bezier" {
        return Some(mix_val(&a.v, &b.v, bezier_ease(&a.bz.unwrap_or([0.33, 0.0, 0.67, 1.0]), t)));
    }
    if it == "noisy" && numeric {
        let (amp, per) = (a.na.unwrap_or(10.0), a.nf.unwrap_or(3.0).max(0.5));
        let env = (std::f64::consts::PI * t).sin();
        let nz = |i: f64| vnoise((fa - a.f) / per, a.f * 0.137 + 7.0 + i * 13.0) * amp * env;
        return Some(match mix_val(&a.v, &b.v, t) {
            Val::Num(x) => Val::Num(x + nz(0.0)),
            Val::Arr(v) => Val::Arr(v.iter().enumerate().map(|(i, x)| x + nz(i as f64)).collect()),
            other => other,
        });
    }
    let tt = if it == "smooth" || it == "noisy" { if it == "noisy" { t } else { ease("ease", t) } } else { ease(it, t) };
    Some(mix_val(&a.v, &b.v, tt))
}

/// Static (un-animated) value of a property path.
pub fn base_get(o: &Layer, path: &str) -> Option<Val> {
    if !path.contains(':') {
        return o.p.get(path).cloned();
    }
    let mut it = path.splitn(3, ':');
    let (kind, id, prop) = (it.next().unwrap_or(""), it.next().unwrap_or(""), it.next().unwrap_or(""));
    match kind {
        "pt" => o.pts.as_ref()?.get(id).map(|p| Val::Arr(vec![p.x, p.y])),
        "bone" => {
            let b = o.bone(id)?;
            Some(match prop {
                "p" => Val::Arr(vec![b.x, b.y]),
                "a" => Val::Num(b.a),
                "s" => Val::Num(b.s.unwrap_or(1.0)),
                "len" => Val::Num(b.len),
                _ => return None,
            })
        }
        "fx" => o.fx.iter().find(|e| e.id == id).and_then(|e| e.p.get(prop).cloned()),
        "sh" => {
            let s = o.shapes.as_ref()?.iter().find(|s| s.id == id)?;
            match prop {
                "fill" => s.fill.clone().map(Val::Str),
                "stroke" => s.stroke.clone().map(Val::Str),
                "width" => s.width.map(Val::Num),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Animated value at frame `f` (JS `val`).
pub fn val(o: &Layer, path: &str, f: f64) -> Val {
    if let Some(ch) = o.ch.get(path) {
        if let Some(v) = eval_channel(ch, f) {
            return v;
        }
    }
    base_get(o, path).unwrap_or_default()
}
pub fn num(o: &Layer, path: &str, f: f64, default: f64) -> f64 {
    val(o, path, f).num().unwrap_or(default)
}
