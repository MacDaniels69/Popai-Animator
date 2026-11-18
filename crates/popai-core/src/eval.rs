//! Frame evaluation: transforms, bones (offsets, Vitruvian groups, physics), binding and deformation,
//! switch selection, camera, particles — producing a renderer-independent [`Scene`].
//!
//! This is a line-for-line port of the JavaScript engine (`render.js` / `stage.js`), checked by the
//! compatibility tests in `tests/compat.rs`.

use crate::anim::{num, val};
use crate::math::*;
use crate::model::{Doc, Layer, Shape};
use crate::scene::*;
use crate::value::{mix_color, Val};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;
use std::sync::{Arc, Mutex};

pub const CAM_D: f64 = 1500.0;

/// Physics simulation results per bone layer: `frames[f][boneId] = angle offset (deg)`.
pub type SimCache = Mutex<HashMap<String, Arc<Vec<HashMap<String, f64>>>>>;

pub struct Eval<'a> {
    pub doc: &'a Doc,
    pub sims: &'a SimCache,
}

#[derive(Clone, Debug)]
pub struct BoneFrame {
    pub id: String,
    pub f: Mat,
    pub s: f64,
    pub len: f64,
    pub off: bool,
}
#[derive(Clone, Debug, Default)]
pub struct BoneSet {
    pub list: Vec<BoneFrame>,
    pub idx: HashMap<String, usize>,
}
impl BoneSet {
    pub fn get(&self, id: &str) -> Option<&BoneFrame> {
        self.idx.get(id).map(|&i| &self.list[i])
    }
}
pub struct BoneCtx<'a> {
    pub layer: &'a Layer,
    pub d: HashMap<String, Mat>,
    pub cur: BoneSet,
    pub rest: BoneSet,
}
#[derive(Clone)]
pub struct Pc<'a> {
    pub base: Mat,
    pub rel: Mat,
    pub z: f64,
    pub b: Option<Rc<BoneCtx<'a>>>,
    pub bound: bool,
    pub in_only: bool,
    /// 3D versions of `base` / `rel` (layer planes can be tilted in space)
    pub base3: M4,
    pub rel3: M4,
}
impl<'a> Pc<'a> {
    pub fn root() -> Self {
        Pc { base: IDENTITY, rel: IDENTITY, z: 0.0, b: None, bound: false, in_only: false, base3: I4, rel3: I4 }
    }
}
#[derive(Clone)]
pub struct Lc<'a> {
    pub base: Mat,
    pub rel_parent: Mat,
    pub rel_pts: Mat,
    pub rel: Mat,
    pub world: Mat,
    pub z: f64,
    pub b: Option<Rc<BoneCtx<'a>>>,
    pub bound: bool,
    pub base3: M4,
    pub rel3: M4,
    /// layer plane -> world space (3D); equals (`world`, z) when nothing in the chain is tilted
    pub world3: M4,
}

#[derive(Clone, Copy)]
pub struct Cam {
    x: f64,
    y: f64,
    zoom: f64,
    roll: f64,
    sx: f64,
    sy: f64,
    sr: f64,
    identity: bool,
}
impl Cam {
    /// Camera position in world space (it looks down -Z at the picture plane z = 0 from CAM_D).
    pub fn pos(&self) -> [f64; 3] {
        [self.x + self.sx, self.y + self.sy, CAM_D]
    }
    /// 3x4 projection (row-major) of world points to the picture; matches `m(z)` for planes facing the camera.
    pub fn proj(&self) -> [[f64; 4]; 3] {
        if self.identity {
            return [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]];
        }
        let a = -(self.roll + self.sr) * DEG;
        let (c, s) = (a.cos(), a.sin());
        let (cx, cy, k) = (self.x + self.sx, self.y + self.sy, self.zoom);
        [[k * c, -k * s, 0.0, -k * (c * cx - s * cy)], [k * s, k * c, 0.0, -k * (s * cx + c * cy)], [0.0, 0.0, -1.0 / CAM_D, 1.0]]
    }
    /// Homography (row-major 3x3) taking a layer plane's (x, y) to the picture.
    pub fn homography(&self, w3: &M4) -> [f64; 9] {
        let p = self.proj();
        let mut h = [0.0; 9];
        for r in 0..3 {
            for (k, col) in [0usize, 1, 3].iter().enumerate() {
                h[r * 3 + k] = (0..4).map(|j| p[r][j] * w3[col * 4 + j]).sum();
            }
        }
        h
    }
    pub fn m(&self, z: f64) -> Mat {
        if self.identity {
            return IDENTITY;
        }
        let s = (self.zoom * CAM_D) / (CAM_D - z).max(60.0);
        chain(&[r(-(self.roll + self.sr) * DEG), crate::math::s(s, s), t(-(self.x + self.sx), -(self.y + self.sy))])
    }
}

#[derive(Clone, Default, Debug)]
pub struct SceneOpts {
    pub frame: f64,
    pub export: bool,
    pub only: Option<String>,
    pub no_trail: bool,
    pub sw_override: HashMap<String, String>,
    /// evaluate without the camera (thumbnails)
    pub no_camera: bool,
    /// evaluate a single layer subtree with its real parent context (thumbnails)
    pub root: Option<String>,
    /// include every layer's 3D plane matrix (`w3`) for viewing the scene from other directions
    pub want3d: bool,
}

struct R<'b> {
    f: f64,
    cam: Cam,
    export: bool,
    only: Option<&'b str>,
    only_anc: HashSet<String>,
    no_trail: bool,
    swo: &'b HashMap<String, String>,
    no_camera: bool,
    want3d: bool,
}

fn truthy_str(o: &Option<String>) -> Option<&str> {
    o.as_deref().filter(|s| !s.is_empty())
}

impl<'a> Eval<'a> {
    pub fn new(doc: &'a Doc, sims: &'a SimCache) -> Self {
        Eval { doc, sims }
    }

    // ---------------- transforms ----------------
    pub fn layer_local_m(&self, l: &Layer, f: f64) -> Mat {
        let ox = l.p.get("ox").map(|v| v.num_or(0.0)).unwrap_or(0.0);
        let oy = l.p.get("oy").map(|v| v.num_or(0.0)).unwrap_or(0.0);
        chain(&[
            t(num(l, "x", f, 0.0) + ox, num(l, "y", f, 0.0) + oy),
            r(num(l, "rot", f, 0.0) * DEG),
            s(num(l, "sx", f, 1.0), num(l, "sy", f, 1.0)),
            t(-ox, -oy),
        ])
    }

    /// The layer's own transform in 3D: position X/Y/Z, then Rotation Y (turn), Rotation X (tilt),
    /// then the in-plane rotation and scale, all about the layer's origin.
    pub fn layer_local_m3(&self, l: &Layer, f: f64, local: &Mat, z: f64) -> M4 {
        let (rx, ry) = (num(l, "rx", f, 0.0), num(l, "ry", f, 0.0));
        if (rx == 0.0 || rx.is_nan()) && (ry == 0.0 || ry.is_nan()) {
            return m4_from2(local, z);
        }
        let ox = l.p.get("ox").map(|v| v.num_or(0.0)).unwrap_or(0.0);
        let oy = l.p.get("oy").map(|v| v.num_or(0.0)).unwrap_or(0.0);
        let rest = chain(&[r(num(l, "rot", f, 0.0) * DEG), s(num(l, "sx", f, 1.0), num(l, "sy", f, 1.0)), t(-ox, -oy)]);
        let tr = m4_t(num(l, "x", f, 0.0) + ox, num(l, "y", f, 0.0) + oy, z);
        let rot = m4_mul(&m4_ry(if ry.is_nan() { 0.0 } else { ry * DEG }), &m4_rx(if rx.is_nan() { 0.0 } else { rx * DEG }));
        m4_mul(&tr, &m4_mul(&rot, &m4_from2(&rest, 0.0)))
    }

    pub fn layer_ctx(&self, l: &Layer, f: f64, pc: &Pc<'a>) -> Lc<'a> {
        let local = self.layer_local_m(l, f);
        let rel_pts = mul(&pc.rel, &local);
        let mut rel = rel_pts;
        if let (Some(bb), Some(b)) = (truthy_str(&l.bind_bone), &pc.b) {
            if let Some(d) = b.d.get(bb) {
                rel = mul(d, &rel_pts);
            }
        }
        let zv = val(l, "z", f);
        let zl = if zv.truthy() { zv.num_or(0.0) } else { 0.0 };
        let local3 = self.layer_local_m3(l, f, &local, zl);
        let rel_pts3 = m4_mul(&pc.rel3, &local3);
        let mut rel3 = rel_pts3;
        if let (Some(bb), Some(b)) = (truthy_str(&l.bind_bone), &pc.b) {
            if let Some(d) = b.d.get(bb) {
                rel3 = m4_mul(&m4_from2(d, 0.0), &rel_pts3);
            }
        }
        Lc {
            base: pc.base,
            rel_parent: pc.rel,
            rel_pts,
            rel,
            world: mul(&pc.base, &rel),
            z: pc.z + zl,
            b: pc.b.clone(),
            bound: pc.b.is_some() && (pc.bound || truthy_str(&l.bind_bone).is_some()),
            base3: pc.base3,
            rel3,
            world3: m4_mul(&pc.base3, &rel3),
        }
    }

    /// Transform context of any layer at frame `f` (JS `evalLC`).
    pub fn eval_lc(&self, id: &str, f: f64) -> Option<Lc<'a>> {
        let chain_l = self.doc.chain(id)?;
        let mut pc = Pc::root();
        let mut out = None;
        for a in chain_l {
            let lc = self.layer_ctx(a, f, &pc);
            if a.id == id {
                out = Some(lc);
                break;
            }
            pc = self.child_pc(a, &lc, f, false);
        }
        out
    }
    fn child_pc(&self, a: &'a Layer, lc: &Lc<'a>, f: f64, in_only: bool) -> Pc<'a> {
        if a.kind == "bone" {
            let (d, cur, rest) = self.bone_deforms(a, f, None);
            Pc { base: lc.world, rel: IDENTITY, z: lc.z, b: Some(Rc::new(BoneCtx { layer: a, d, cur, rest })), bound: false, in_only, base3: lc.world3, rel3: I4 }
        } else {
            Pc { base: lc.base, rel: lc.rel, z: lc.z, b: lc.b.clone(), bound: lc.bound, in_only, base3: lc.base3, rel3: lc.rel3 }
        }
    }

    // ---------------- switches ----------------
    pub fn switch_state(&self, l: &Layer, f: f64) -> (Option<String>, Option<String>, f64) {
        let first = l.kids().first().map(|c| c.id.clone());
        let v = val(l, "sw", f);
        let cur = if v.truthy() { v.str().map(String::from) } else { first };
        let (mut prev, mut tt) = (None, 1.0);
        if l.sw_mode.as_deref() == Some("crossfade") {
            if let Some(ch) = l.ch.get("sw") {
                if ch.keys.len() > 1 {
                    let mut i: isize = -1;
                    for (k, key) in ch.keys.iter().enumerate() {
                        if key.f <= f {
                            i = k as isize;
                        }
                    }
                    if i > 0 {
                        let i = i as usize;
                        let fade = l.sw_fade.filter(|v| *v != 0.0).unwrap_or(4.0).max(1.0);
                        tt = (f - ch.keys[i].f + 1.0) / (fade + 1.0);
                        let pv = &ch.keys[i - 1].v;
                        let differs = match (pv, &cur) {
                            (Val::Str(p), Some(c)) => p != c,
                            (Val::Str(_), None) => true,
                            _ => true,
                        };
                        if tt < 1.0 && differs {
                            prev = pv.str().map(String::from);
                        }
                    }
                }
            }
        }
        (cur, prev, clamp(tt, 0.0, 1.0))
    }

    // ---------------- bones ----------------
    fn vit_active(&self, b: &Layer, f: Option<f64>) -> Option<String> {
        let groups = b.vgroups.as_deref().unwrap_or(&[]);
        let f = f?;
        if groups.is_empty() {
            return None;
        }
        let v = val(b, "vit", f);
        if v.truthy() {
            v.str().map(String::from)
        } else {
            Some(groups[0].clone())
        }
    }
    /// `f == None` is the rest (setup) pose used for binding.
    pub fn bone_frames(&self, bl: &Layer, f: Option<f64>, over: Option<&HashMap<String, f64>>, no_dyn: bool) -> BoneSet {
        let mut out = BoneSet::default();
        let vg = self.vit_active(bl, f);
        let dynamic = !no_dyn && f.is_some() && bl.bones().iter().any(|b| b.dynamics.as_ref().map(|d| d.on).unwrap_or(false));
        let sim = if dynamic { Some(self.simulate(bl)) } else { None };
        let dyn_now: Option<&HashMap<String, f64>> = match (&sim, f) {
            (Some(s), Some(f)) => s.get(clamp(js_round(f), 0.0, self.doc.end) as usize),
            _ => None,
        };
        for b in bl.bones() {
            let over_a = over.and_then(|o| o.get(&b.id)).copied();
            let mut a = match (over_a, f) {
                (Some(a), _) => a,
                (None, None) => b.a,
                (None, Some(f)) => num(bl, &format!("bone:{}:a", b.id), f, b.a),
            };
            if let Some(dn) = dyn_now {
                if let Some(d) = dn.get(&b.id) {
                    if *d != 0.0 && over_a.is_none() {
                        a += d;
                    }
                }
            }
            let mut pos = match f {
                None => [b.x, b.y],
                Some(f) => val(bl, &format!("bone:{}:p", b.id), f).vec2().unwrap_or([b.x, b.y]),
            };
            let (ox, oy) = (b.ox.unwrap_or(0.0), b.oy.unwrap_or(0.0));
            if f.is_some() && (ox != 0.0 || oy != 0.0) {
                pos = [pos[0] + ox, pos[1] + oy];
            }
            let sc = match f {
                None => 1.0,
                Some(f) => num(bl, &format!("bone:{}:s", b.id), f, 1.0),
            };
            let par = b.parent.as_deref().and_then(|p| out.get(p)).map(|p| (p.f, p.s));
            let (pf, ps) = par.unwrap_or((IDENTITY, 1.0));
            let fm = mul(&pf, &mul(&t(pos[0] * ps, pos[1]), &r(a * DEG)));
            let off = match (&vg, &b.vg) {
                (Some(g), Some(bg)) if !bg.is_empty() => bg != g,
                _ => false,
            };
            out.idx.insert(b.id.clone(), out.list.len());
            out.list.push(BoneFrame { id: b.id.clone(), f: fm, s: sc, len: b.len * sc, off });
        }
        out
    }
    pub fn bone_deforms(&self, bl: &Layer, f: f64, over: Option<&HashMap<String, f64>>) -> (HashMap<String, Mat>, BoneSet, BoneSet) {
        let rest = self.bone_frames(bl, None, None, false);
        let cur = self.bone_frames(bl, Some(f), over, false);
        let mut d = HashMap::new();
        for c in &cur.list {
            if let Some(rf) = rest.get(&c.id) {
                d.insert(c.id.clone(), mul(&mul(&c.f, &s(c.s, 1.0)), &inv(&rf.f)));
            }
        }
        (d, cur, rest)
    }

    /// Deterministic spring dynamics (follow-through, gravity, wind) — JS `simulateBones`.
    pub fn simulate(&self, bl: &Layer) -> Arc<Vec<HashMap<String, f64>>> {
        if let Some(c) = self.sims.lock().unwrap().get(&bl.id) {
            return c.clone();
        }
        let fps = self.doc.fps;
        let n_frames = (self.doc.end + 1.0).max(0.0) as usize;
        let dyn_b: Vec<_> = bl.bones().iter().filter(|b| b.dynamics.as_ref().map(|d| d.on).unwrap_or(false)).collect();
        let fo = bl.force.clone().unwrap_or_default();
        let (g, ga) = (fo.grav_s.unwrap_or(0.0), fo.grav_a.unwrap_or(90.0) * DEG);
        let (w, wa, turb) = (fo.wind_s.unwrap_or(0.0), fo.wind_a.unwrap_or(0.0) * DEG, fo.turb.unwrap_or(0.0));
        struct St {
            ang: f64,
            vel: f64,
            p1: [f64; 2],
            p2: [f64; 2],
        }
        let mut st: HashMap<String, St> = HashMap::new();
        let mut res = Vec::with_capacity(n_frames);
        for fi in 0..n_frames {
            let f = fi as f64;
            let mut off = HashMap::new();
            if fi > 0 {
                let fr = self.bone_frames(bl, Some(f), None, true);
                let lw = self.eval_lc(&bl.id, f).map(|l| l.world).unwrap_or(IDENTITY);
                for b in &dyn_b {
                    let Some(bf) = fr.get(&b.id) else { continue };
                    let fm = mul(&lw, &bf.f);
                    let base = ap(&fm, 0.0, 0.0);
                    let tgt = fm[1].atan2(fm[0]);
                    let l = (bf.len * scale_of(&lw)).max(5.0);
                    let s = st.entry(b.id.clone()).or_insert(St { ang: tgt, vel: 0.0, p1: base, p2: base });
                    let acc = [(base[0] - 2.0 * s.p1[0] + s.p2[0]) * fps * fps, (base[1] - 2.0 * s.p1[1] + s.p2[1]) * fps * fps];
                    let d = b.dynamics.as_ref().unwrap();
                    let (k, damp, inert) = (d.spring.unwrap_or(60.0), d.damp.unwrap_or(11.0), d.inertia.unwrap_or(0.6));
                    let (n, lever) = (4, l * 0.5);
                    let dt = 1.0 / fps / n as f64;
                    for i in 0..n {
                        let tt = (f + i as f64 / n as f64) / fps;
                        let (sn, cs) = (s.ang.sin(), s.ang.cos());
                        let tang = |vx: f64, vy: f64| -vx * sn + vy * cs;
                        let ws = w * (1.0 + turb * vnoise(tt * 1.7, (b.id.encode_utf16().count() * 7 + 3) as f64));
                        let mut aa = (-inert * tang(acc[0], acc[1]) + tang(ga.cos() * g, ga.sin() * g) + tang(wa.cos() * ws, wa.sin() * ws)) / lever;
                        let mut diff = s.ang - tgt;
                        diff = diff.sin().atan2(diff.cos());
                        if d.lock_tip.unwrap_or(false) {
                            diff *= 2.0;
                        }
                        aa += -k * diff - damp * s.vel;
                        s.vel += aa * dt;
                        s.ang += s.vel * dt;
                    }
                    s.p2 = s.p1;
                    s.p1 = base;
                    let mut diff = s.ang - tgt;
                    diff = diff.sin().atan2(diff.cos());
                    off.insert(b.id.clone(), clamp(diff / DEG, -120.0, 120.0));
                }
            }
            res.push(off);
        }
        let rc = Arc::new(res);
        self.sims.lock().unwrap().insert(bl.id.clone(), rc.clone());
        rc
    }

    // ---------------- vector geometry ----------------
    fn flex_segs(b: &BoneCtx) -> Vec<(String, f64, [f64; 2], [f64; 2])> {
        b.layer
            .bones()
            .iter()
            .filter(|bn| bn.strength.unwrap_or(0.0) > 0.0)
            .filter_map(|bn| b.rest.get(&bn.id).map(|rf| (bn.id.clone(), bn.strength.unwrap(), ap(&rf.f, 0.0, 0.0), ap(&rf.f, bn.len, 0.0))))
            .collect()
    }
    fn flex_weights(segs: &[(String, f64, [f64; 2], [f64; 2])], p: [f64; 2]) -> Vec<(String, f64)> {
        let mut out = vec![];
        for (id, sg, a, b) in segs {
            let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
            let mut l2 = dx * dx + dy * dy;
            if l2 == 0.0 {
                l2 = 1e-9;
            }
            let tt = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0.0, 1.0);
            let d = (p[0] - (a[0] + tt * dx)).hypot(p[1] - (a[1] + tt * dy));
            if d < *sg {
                let w = (1.0 - d / sg).powi(2);
                if w > 1e-4 {
                    out.push((id.clone(), w));
                }
            }
        }
        out
    }
    pub fn deformed_pts(&self, l: &Layer, f: f64, lc: &Lc<'a>) -> BTreeMap<String, [f64; 2]> {
        let mut out = BTreeMap::new();
        let Some(pts) = &l.pts else { return out };
        let b = lc.b.as_ref();
        let rel_inv = inv(&lc.rel_pts);
        let segs = match b {
            Some(bc) if !lc.bound => Self::flex_segs(bc),
            _ => vec![],
        };
        for (id, pt) in pts {
            let mut v = val(l, &format!("pt:{id}"), f).vec2().unwrap_or([pt.x, pt.y]);
            if let Some(bc) = b {
                let ws_: Option<Vec<(String, f64)>> = match &pt.b {
                    Some(w) if !w.is_empty() => Some(w.clone()),
                    _ if !segs.is_empty() => Some(Self::flex_weights(&segs, ap(&lc.rel_pts, pt.x, pt.y))),
                    _ => None,
                };
                if let Some(wl) = ws_.filter(|w| !w.is_empty()) {
                    let p = ap(&lc.rel_pts, v[0], v[1]);
                    let (mut x, mut y, mut wsum) = (0.0, 0.0, 0.0);
                    for (bid, w) in &wl {
                        let Some(d) = bc.d.get(bid) else { continue };
                        let q = ap(d, p[0], p[1]);
                        x += q[0] * w;
                        y += q[1] * w;
                        wsum += w;
                    }
                    if wsum > 0.0 {
                        v = ap(&rel_inv, x / wsum, y / wsum);
                    }
                }
            }
            out.insert(id.clone(), v);
        }
        out
    }
    fn trace(&self, l: &Layer, path: &crate::model::Path, pp: &BTreeMap<String, [f64; 2]>, f: f64) -> Option<SubPath> {
        let ids: Vec<&String> = path.pts.iter().filter(|id| pp.contains_key(*id)).collect();
        let n = ids.len() as isize;
        if n < 2 {
            return None;
        }
        let closed = path.closed && n > 2;
        let idx = |i: isize| -> usize {
            if closed {
                ((i + n) % n) as usize
            } else {
                i.clamp(0, n - 1) as usize
            }
        };
        let get = |i: isize| pp[ids[idx(i)]];
        let pts = l.pts.as_ref().unwrap();
        let cv = |i: isize| pts.get(ids[idx(i)]).and_then(|p| p.c).unwrap_or(1.0);
        let segs_n = if closed { n } else { n - 1 };
        let mut segs = Vec::with_capacity(segs_n as usize);
        // explicit Bézier handles (point offsets) override the automatic curvature on their side
        let handles = |i: isize| -> Option<Vec<f64>> {
            let id = ids[idx(i)];
            match val(l, &format!("ph:{id}"), f) {
                Val::Arr(v) if v.len() == 4 => Some(v),
                _ => None,
            }
        };
        for i in 0..segs_n {
            let (a, b, c, d) = (get(i - 1), get(i), get(i + 1), get(i + 2));
            let (k1, k2) = (cv(i) / 6.0, cv(i + 1) / 6.0);
            let (hb, hc) = (handles(i), handles(i + 1));
            if hb.is_none() && hc.is_none() {
                if k1 == 0.0 && k2 == 0.0 {
                    segs.push(vec![c[0], c[1]]);
                } else {
                    segs.push(vec![b[0] + (c[0] - a[0]) * k1, b[1] + (c[1] - a[1]) * k1, c[0] - (d[0] - b[0]) * k2, c[1] - (d[1] - b[1]) * k2, c[0], c[1]]);
                }
                continue;
            }
            let c1 = match &hb {
                Some(h) => [b[0] + h[2], b[1] + h[3]],
                None => [b[0] + (c[0] - a[0]) * k1, b[1] + (c[1] - a[1]) * k1],
            };
            let c2 = match &hc {
                Some(h) => [c[0] + h[0], c[1] + h[1]],
                None => [c[0] - (d[0] - b[0]) * k2, c[1] - (d[1] - b[1]) * k2],
            };
            segs.push(vec![c1[0], c1[1], c2[0], c2[1], c[0], c[1]]);
        }
        Some(SubPath { closed, start: get(0), segs })
    }
    fn shape_out(&self, l: &Layer, sh: &Shape, f: f64, pp: &BTreeMap<String, [f64; 2]>) -> ShapeOut {
        let subpaths = sh
            .paths
            .iter()
            .filter_map(|pid| l.paths.as_ref().and_then(|ps| ps.iter().find(|p| &p.id == pid)))
            .filter_map(|p| self.trace(l, p, pp, f))
            .collect();
        if let Some(st) = sh.style_id.as_deref().and_then(|id| self.doc.style(id)) {
            return ShapeOut { fill: Some(st.fill.clone()), stroke: Some(st.stroke.clone()), width: Some(st.width), fill_on: st.fill_on, stroke_on: st.stroke_on, subpaths, lq: sh.extra.get("lq").filter(|v| v.is_object()).cloned() };
        }
        let sv = |k: &str| match val(l, &format!("sh:{}:{k}", sh.id), f) {
            Val::Str(s) => Some(s),
            _ => None,
        };
        ShapeOut { fill: sv("fill"), stroke: sv("stroke"), width: val(l, &format!("sh:{}:width", sh.id), f).num(), fill_on: sh.fill_on, stroke_on: sh.stroke_on, subpaths, lq: sh.extra.get("lq").filter(|v| v.is_object()).cloned() }
    }

    // ---------------- camera ----------------
    pub fn cam(&self, f: f64, identity: bool) -> Cam {
        let c = &self.doc.camera;
        let (x, y, zoom, roll) = (num(c, "x", f, 0.0), num(c, "y", f, 0.0), num(c, "zoom", f, 1.0), num(c, "roll", f, 0.0));
        let (sh, fr) = (num(c, "shake", f, 0.0), num(c, "shakeFreq", f, 10.0));
        let tt = (f / self.doc.fps) * fr;
        let on = sh != 0.0 && !sh.is_nan();
        Cam {
            x,
            y,
            zoom,
            roll,
            sx: if on { sh * vnoise(tt, 1.0) } else { 0.0 },
            sy: if on { sh * vnoise(tt, 2.0) } else { 0.0 },
            sr: if on { sh * 0.05 * vnoise(tt, 3.0) } else { 0.0 },
            identity,
        }
    }

    // ---------------- particles ----------------
    pub fn particle_list(&self, l: &Layer, f: f64, lc: &Lc<'a>) -> Vec<Particle> {
        let fps = self.doc.fps;
        let p = |k: &str| num(l, k, f, f64::NAN);
        let life = p("life").max(0.05);
        let (start, end, seed) = (l.start_f.unwrap_or(0.0), l.end_f.unwrap_or(9999.0), l.seed.unwrap_or(7.0));
        let mut births: Vec<(f64, f64)> = vec![];
        if l.mode.as_deref() == Some("burst") {
            let n = l.burst.unwrap_or(40.0);
            let mut i = 0.0;
            while i < n {
                births.push((i, start + hash1(i, seed + 5.0) * 1.5));
                i += 1.0;
            }
        } else {
            let step = fps / p("rate").max(0.01);
            let from = start.max(f - life * 1.3 * fps);
            let to = f.min(end);
            let i0 = ((from - start) / step).ceil().max(0.0);
            let i1 = ((to - start) / step).floor();
            let mut i = i0;
            while i <= i1 && births.len() < 3000 {
                births.push((i, start + i * step));
                i += 1.0;
            }
        }
        let mut rel_cache: HashMap<i64, Mat> = HashMap::new();
        let mut rel_at = |bf: f64| -> Mat {
            let k = js_round(bf);
            if let Some(m) = rel_cache.get(&(k as i64)) {
                return *m;
            }
            let mut m = self.layer_local_m(l, k);
            if let (Some(bb), Some(bc)) = (truthy_str(&l.bind_bone), &lc.b) {
                let (d, _, _) = self.bone_deforms(bc.layer, k, None);
                if let Some(dm) = d.get(bb) {
                    m = mul(dm, &m);
                }
            }
            rel_cache.insert(k as i64, m);
            m
        };
        let (g, wind, drag) = (p("gravity"), p("wind"), p("drag"));
        let col = |k: &str| match val(l, k, f) {
            Val::Str(s) => s,
            _ => "#000000".into(),
        };
        let (c0, c1) = (col("color0"), col("color1"));
        let mut out = vec![];
        for (i, bf) in births {
            let rr = |k: f64| hash1(i * 13.0 + k, seed);
            let age = (f - bf) / fps;
            let pl = life * (0.7 + 0.6 * rr(1.0));
            if age < 0.0 || age > pl {
                continue;
            }
            let tt = age / pl;
            let ang = (p("angle") + (rr(2.0) - 0.5) * p("spread")) * DEG;
            let sp = p("speed") * (1.0 - p("speedVar") * rr(3.0));
            let (mut ox, mut oy) = (0.0, 0.0);
            let er = p("emitR");
            match l.emit.as_deref() {
                Some("circle") => {
                    let a = rr(4.0) * std::f64::consts::PI * 2.0;
                    let rad = rr(5.0).sqrt() * er;
                    ox = a.cos() * rad;
                    oy = a.sin() * rad;
                }
                Some("line") => ox = (rr(4.0) - 0.5) * 2.0 * er,
                _ => {}
            }
            let em = ap(&rel_at(bf), ox, oy);
            let k = if drag > 0.0 { (1.0 - (-drag * age).exp()) / drag } else { age };
            let (vx, vy) = (ang.cos() * sp, ang.sin() * sp);
            out.push(Particle {
                x: em[0] + vx * k + 0.5 * wind * age * age,
                y: em[1] + vy * k + 0.5 * g * age * age,
                vx: vx * (-drag * age).exp() + wind * age,
                vy: vy * (-drag * age).exp() + g * age,
                size: lerp(p("size0"), p("size1"), tt) * (0.7 + 0.6 * rr(6.0)),
                a: lerp(p("alpha0"), p("alpha1"), tt),
                col: mix_color(&c0, &c1, tt),
                rot: rr(7.0) * 360.0 + p("spin") * age * (rr(8.0) - 0.5) * 2.0,
            });
        }
        out
    }

    // ---------------- scene ----------------
    pub fn scene(&self, o: &SceneOpts) -> Vec<Node> {
        let only_anc: HashSet<String> = match &o.only {
            Some(id) => self.doc.chain(id).map(|c| c[..c.len() - 1].iter().map(|l| l.id.clone()).collect()).unwrap_or_default(),
            None => HashSet::new(),
        };
        let rr = R { f: o.frame, cam: self.cam(o.frame, o.no_camera), export: o.export, only: o.only.as_deref(), only_anc, no_trail: o.no_trail, swo: &o.sw_override, no_camera: o.no_camera, want3d: o.want3d };
        if let Some(root) = &o.root {
            let Some(chain_l) = self.doc.chain(root) else { return vec![] };
            let mut pc = Pc::root();
            for a in &chain_l[..chain_l.len() - 1] {
                let lc = self.layer_ctx(a, o.frame, &pc);
                pc = self.child_pc(a, &lc, o.frame, false);
            }
            let target = chain_l[chain_l.len() - 1];
            return self.draw_layer(target, &rr, &pc, true).into_iter().collect();
        }
        let mut out = self.draw_list(&self.doc.layers, &rr, &Pc::root());
        if self.flag(&self.doc.extra, "depthSort") {
            self.depth_sort(&mut out, &rr);
        }
        out
    }
    fn flag(&self, m: &serde_json::Map<String, serde_json::Value>, k: &str) -> bool {
        m.get(k).and_then(|v| v.as_bool()).unwrap_or(false)
    }
    /// "Sort layers by depth": farther layers draw first. By default depth is the layer origin's Z;
    /// with "sort by true distance" it is the distance from the camera to the layer origin.
    fn depth_sort(&self, nodes: &mut [Node], rr: &R) {
        if self.flag(&self.doc.extra, "depthSortTrue") {
            let c = rr.cam.pos();
            let d = |n: &Node| (0..3).map(|i| (n.origin[i] - c[i]).powi(2)).sum::<f64>();
            nodes.sort_by(|a, b| d(b).partial_cmp(&d(a)).unwrap_or(std::cmp::Ordering::Equal));
        } else {
            nodes.sort_by(|a, b| a.origin[2].partial_cmp(&b.origin[2]).unwrap_or(std::cmp::Ordering::Equal));
        }
    }
    fn draw_list(&self, list: &'a [Layer], rr: &R, pc: &Pc<'a>) -> Vec<Node> {
        list.iter().rev().filter_map(|l| self.draw_layer(l, rr, pc, false)).collect()
    }
    fn draw_layer(&self, l: &'a Layer, rr: &R, pc: &Pc<'a>, force_vis: bool) -> Option<Node> {
        if (!l.vis && !force_vis) || (rr.export && !l.render) {
            return None;
        }
        let in_only = pc.in_only || rr.only == Some(l.id.as_str());
        let is_anc = rr.only.is_some() && !in_only;
        if is_anc && !rr.only_anc.contains(&l.id) {
            return None;
        }
        if let (Some(bb), Some(bc)) = (truthy_str(&l.bind_bone), &pc.b) {
            if bc.cur.get(bb).map(|b| b.off).unwrap_or(false) {
                return None; // attached to an inactive Vitruvian bone
            }
        }
        let f = rr.f;
        let lc = self.layer_ctx(l, f, pc);
        let m = mul(&rr.cam.m(lc.z), &lc.world);
        let op = if is_anc { 1.0 } else { num(l, "opacity", f, 1.0) };
        let mut node = Node::new(&l.id, &l.kind, m, lc.z, op, is_anc, &l.blend);
        node.cs = scale_of(&rr.cam.m(lc.z));
        node.origin = [lc.world3[12], lc.world3[13], lc.world3[14]];
        let tilted = m4_tilted(&lc.world3);
        if tilted {
            let h = rr.cam.homography(&lc.world3);
            // linear approximation at the layer origin, for picking and handles
            let w = if h[8].abs() < 1e-9 { 1e-9 } else { h[8] };
            let w2 = w * w;
            node.m = [(h[0] * w - h[2] * h[6]) / w2, (h[3] * w - h[5] * h[6]) / w2, (h[1] * w - h[2] * h[7]) / w2, (h[4] * w - h[5] * h[7]) / w2, h[2] / w, h[5] / w];
            node.h = Some(h);
        }
        if tilted || rr.want3d {
            node.w3 = Some(lc.world3);
        }
        if l.kind == "group" {
            node.mask = l.mask.clone();
        }
        if op <= 0.001 {
            return Some(node);
        }
        if !is_anc {
            node.fx = l
                .fx
                .iter()
                .filter(|e| e.on)
                .map(|e| {
                    let p: BTreeMap<String, Val> = e.p.keys().map(|k| (k.clone(), val(l, &format!("fx:{}:{k}", e.id), f))).collect();
                    let ghosts = if e.kind == "trail" && !rr.no_trail { Some(self.trail_ghosts(l, &p, rr)) } else { None };
                    FxOut { id: e.id.clone(), kind: e.kind.clone(), p, ghosts }
                })
                .collect();
        }
        let child_in_only = in_only;
        match l.kind.as_str() {
            "vector" => {
                let pp = self.deformed_pts(l, f, &lc);
                node.shapes = Some(l.shapes.as_deref().unwrap_or(&[]).iter().map(|sh| self.shape_out(l, sh, f, &pp)).collect());
                node.pts = Some(pp);
            }
            "image" => {
                if let Some(mid) = &l.media {
                    node.image = Some(ImageOut { media: mid.clone(), iw: l.iw.unwrap_or(0.0), ih: l.ih.unwrap_or(0.0) });
                }
            }
            "text" => {
                node.text = Some(TextOut {
                    text: l.text.clone().unwrap_or_default(),
                    font: l.font.clone().unwrap_or_else(|| "sans-serif".into()),
                    size: l.size.unwrap_or(72.0),
                    bold: l.bold.unwrap_or(false),
                    color: match val(l, "color", f) {
                        Val::Str(s) => s,
                        _ => "#000000".into(),
                    },
                });
            }
            "particle" => {
                let pm = chain(&[rr.cam.m(lc.z), lc.base, lc.rel_parent]);
                node.particles = Some(ParticlesOut { m: pm, shape: l.shape.clone().unwrap_or_else(|| "circle".into()), list: self.particle_list(l, f, &lc) });
            }
            "group" | "switch" | "bone" => {
                let mut cpc = self.child_pc(l, &lc, f, child_in_only);
                if l.kind != "bone" {
                    cpc.in_only = child_in_only;
                }
                if l.kind == "bone" {
                    if let Some(bc) = &cpc.b {
                        node.bones = Some(bc.cur.list.iter().map(|b| BoneOut { id: b.id.clone(), f: b.f, len: b.len, s: b.s, off: b.off }).collect());
                    }
                }
                let kids = l.kids();
                if l.kind == "switch" {
                    let (cur, prev, tt) = self.switch_state(l, f);
                    let over = if rr.export { None } else { rr.swo.get(&l.id).cloned() };
                    let want = over.clone().or(cur);
                    let c = want.as_deref().and_then(|id| kids.iter().find(|k| k.id == id)).or(kids.first());
                    node.active = c.map(|c| c.id.clone());
                    let pc0 = if over.is_none() { prev.as_deref().and_then(|id| kids.iter().find(|k| k.id == id)) } else { None };
                    let mut ch = vec![];
                    if let Some(p0) = pc0 {
                        if let Some(mut n) = self.draw_layer(p0, rr, &cpc, false) {
                            n.fade = Some(1.0 - tt);
                            ch.push(n);
                        }
                        if let Some(c) = c {
                            if let Some(mut n) = self.draw_layer(c, rr, &cpc, false) {
                                n.fade = Some(tt);
                                ch.push(n);
                            }
                        }
                    } else if let Some(c) = c {
                        ch.extend(self.draw_layer(c, rr, &cpc, false));
                    }
                    node.children = Some(ch);
                } else if l.kind == "group" && l.mask.as_deref() != Some("none") && kids.len() > 1 && rr.only.is_none() {
                    let last = &kids[kids.len() - 1];
                    node.mask_child = self.draw_layer(last, rr, &cpc, false).map(Box::new);
                    node.mask_active = Some(true);
                    node.children = Some(kids[..kids.len() - 1].iter().rev().filter_map(|k| self.draw_layer(k, rr, &cpc, false)).collect());
                } else {
                    node.children = Some(self.draw_list(kids, rr, &cpc));
                }
                if l.kind != "switch" && self.flag(&l.extra, "depthSort") {
                    if let Some(ch) = node.children.as_mut() {
                        self.depth_sort(ch, rr);
                    }
                }
            }
            _ => {}
        }
        Some(node)
    }
    fn trail_ghosts(&self, l: &Layer, p: &BTreeMap<String, Val>, rr: &R) -> Vec<Ghost> {
        let gp = |k: &str, d: f64| p.get(k).and_then(|v| v.num()).unwrap_or(d);
        let (samples, spacing, decay) = (js_round(gp("samples", 6.0)), js_round(gp("spacing", 2.0)), gp("decay", 0.65));
        let mut out = vec![];
        let mut i = samples;
        while i >= 1.0 {
            let ff = rr.f - i * spacing;
            if ff >= 0.0 {
                let o = SceneOpts { frame: ff, export: rr.export, only: Some(l.id.clone()), no_trail: true, no_camera: rr.no_camera, ..Default::default() };
                out.push(Ghost { frame: ff, alpha: decay.powf(i), nodes: self.scene(&o) });
            }
            i -= 1.0;
        }
        out
    }
}
