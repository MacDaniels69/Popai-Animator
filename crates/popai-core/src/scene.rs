//! Renderer-independent output of one evaluated frame. The TypeScript canvas renderer draws it today;
//! the wgpu renderer (stage 3) will consume the same structure.

use crate::math::Mat;
use crate::value::Val;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Debug, Clone)]
pub struct SubPath {
    pub closed: bool,
    pub start: [f64; 2],
    /// each segment is `[x, y]` (line) or `[c1x, c1y, c2x, c2y, x, y]` (cubic)
    pub segs: Vec<Vec<f64>>,
}
#[derive(Serialize, Debug, Clone)]
pub struct ShapeOut {
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub width: Option<f64>,
    #[serde(rename = "fillOn")]
    pub fill_on: bool,
    #[serde(rename = "strokeOn")]
    pub stroke_on: bool,
    pub subpaths: Vec<SubPath>,
    /// Liquid shape group: {"g": group id, "op": "combine" | "subtract" | "intersect"}
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lq: Option<serde_json::Value>,
}
#[derive(Serialize, Debug, Clone)]
pub struct ImageOut {
    pub media: String,
    pub iw: f64,
    pub ih: f64,
}
#[derive(Serialize, Debug, Clone)]
pub struct TextOut {
    pub text: String,
    pub font: String,
    pub size: f64,
    pub bold: bool,
    pub color: String,
}
#[derive(Serialize, Debug, Clone)]
pub struct Particle {
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub size: f64,
    pub a: f64,
    pub col: String,
    pub rot: f64,
}
#[derive(Serialize, Debug, Clone)]
pub struct ParticlesOut {
    /// camera × parent space; particle positions are in the parent's space
    pub m: Mat,
    pub shape: String,
    pub list: Vec<Particle>,
}
#[derive(Serialize, Debug, Clone)]
pub struct BoneOut {
    pub id: String,
    /// bone frame in the bone layer's space
    pub f: Mat,
    pub len: f64,
    pub s: f64,
    pub off: bool,
}
#[derive(Serialize, Debug, Clone)]
pub struct Ghost {
    pub frame: f64,
    pub alpha: f64,
    pub nodes: Vec<Node>,
}
#[derive(Serialize, Debug, Clone)]
pub struct FxOut {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// parameters evaluated at this frame
    pub p: BTreeMap<String, Val>,
    /// motion-trail ghosts (scenes of this layer at earlier frames)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ghosts: Option<Vec<Ghost>>,
}

/// One evaluated layer. `m` = camera(z) × world; the viewer multiplies its view matrix in front.
#[derive(Serialize, Debug, Clone)]
pub struct Node {
    pub id: String,
    pub kind: String,
    pub m: Mat,
    pub z: f64,
    /// scale of the camera transform at this depth (effects size their radii with it)
    pub cs: f64,
    pub op: f64,
    /// ancestor drawn only to reach an `only` target (no effects, not hit-testable)
    pub anc: bool,
    pub blend: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fade: Option<f64>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fx: Vec<FxOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mask: Option<String>,
    #[serde(rename = "maskActive", skip_serializing_if = "Option::is_none")]
    pub mask_active: Option<bool>,
    #[serde(rename = "maskChild", skip_serializing_if = "Option::is_none")]
    pub mask_child: Option<Box<Node>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shapes: Option<Vec<ShapeOut>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pts: Option<BTreeMap<String, [f64; 2]>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<ImageOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<TextOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub particles: Option<ParticlesOut>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bones: Option<Vec<BoneOut>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Node>>,
    /// plane tilted in X/Y: homography (row-major 3x3) from the layer plane to the picture; `m` is then
    /// only its linear approximation at the layer origin (used for picking)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub h: Option<[f64; 9]>,
    /// layer plane -> world (4x4, column-major); sent for tilted layers and for views from other directions
    #[serde(skip_serializing_if = "Option::is_none")]
    pub w3: Option<[f64; 16]>,
    /// layer origin in world space (depth sorting)
    #[serde(skip)]
    pub origin: [f64; 3],
}
impl Node {
    pub fn new(id: &str, kind: &str, m: Mat, z: f64, op: f64, anc: bool, blend: &str) -> Node {
        Node {
            id: id.into(),
            kind: kind.into(),
            m,
            z,
            cs: 1.0,
            op,
            anc,
            blend: blend.into(),
            fade: None,
            fx: vec![],
            mask: None,
            mask_active: None,
            mask_child: None,
            shapes: None,
            pts: None,
            image: None,
            text: None,
            particles: None,
            bones: None,
            active: None,
            children: None,
            h: None,
            w3: None,
            origin: [0.0, 0.0, 0.0],
        }
    }
    /// depth-first visit of this node and its descendants (not mask children or ghosts)
    pub fn walk<'n>(&'n self, out: &mut Vec<&'n Node>) {
        out.push(self);
        if let Some(m) = &self.mask_child {
            m.walk(out);
        }
        for c in self.children.iter().flatten() {
            c.walk(out);
        }
    }
}
