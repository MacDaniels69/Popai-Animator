//! The project document. Field names match the `.popai.json` format written by the app.
//! Unknown fields are kept in `extra` so saving never drops data written by newer/older versions.

use crate::value::Val;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};
use std::collections::BTreeMap;

fn yes() -> bool {
    true
}
fn src_over() -> String {
    "source-over".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Key {
    pub f: f64,
    #[serde(default)]
    pub v: Val,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub i: Option<String>,
    /// Bézier handles of the segment that starts at this key, normalized: [x1, y1, x2, y2]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bz: Option<[f64; 4]>,
    /// Noisy: amplitude (value units) and frames per wiggle
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub na: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nf: Option<f64>,
    /// Cycle: target frame (`cm` = "abs") or frames back (`cm` = "rel")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cy: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cm: Option<String>,
    /// Hold this key's value for N frames before moving on
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hold: Option<f64>,
    /// Update the in-between only every N frames ("on twos")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iv: Option<f64>,
    /// Stagger: uneven stair-step timing
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stg: Option<bool>,
    /// Label colour (identification only, never changes motion)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lb: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Channel {
    #[serde(default)]
    pub keys: Vec<Key>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Point {
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub c: Option<f64>,
    /// explicit bone weights `[[boneId, weight], ...]`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub b: Option<Vec<(String, f64)>>,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Path {
    pub id: String,
    #[serde(default)]
    pub pts: Vec<String>,
    #[serde(default)]
    pub closed: bool,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Shape {
    pub id: String,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub fill: Option<String>,
    #[serde(default)]
    pub stroke: Option<String>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub fill_on: bool,
    #[serde(default)]
    pub stroke_on: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Style {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub fill: String,
    #[serde(default)]
    pub stroke: String,
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub fill_on: bool,
    #[serde(default)]
    pub stroke_on: bool,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Effect {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub on: bool,
    #[serde(default)]
    pub p: BTreeMap<String, Val>,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Dynamics {
    #[serde(default)]
    pub on: bool,
    #[serde(default)]
    pub spring: Option<f64>,
    #[serde(default)]
    pub damp: Option<f64>,
    #[serde(default)]
    pub inertia: Option<f64>,
    #[serde(default)]
    pub lock_tip: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Force {
    #[serde(default)]
    pub wind_s: Option<f64>,
    #[serde(default)]
    pub wind_a: Option<f64>,
    #[serde(default)]
    pub turb: Option<f64>,
    #[serde(default)]
    pub grav_s: Option<f64>,
    #[serde(default)]
    pub grav_a: Option<f64>,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Bone {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub a: f64,
    #[serde(default)]
    pub len: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub s: Option<f64>,
    /// strength region for flexible binding
    #[serde(default, rename = "str", skip_serializing_if = "Option::is_none")]
    pub strength: Option<f64>,
    /// exploded-rig offset
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ox: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oy: Option<f64>,
    /// Vitruvian construction group
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vg: Option<String>,
    #[serde(default, rename = "dyn", skip_serializing_if = "Option::is_none")]
    pub dynamics: Option<Dynamics>,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}

/// A layer (also used for the camera, which has only `p`/`ch`).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Layer {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "yes")]
    pub vis: bool,
    #[serde(default = "yes")]
    pub render: bool,
    #[serde(default)]
    pub p: BTreeMap<String, Val>,
    #[serde(default)]
    pub ch: BTreeMap<String, Channel>,
    #[serde(default)]
    pub fx: Vec<Effect>,
    #[serde(default = "src_over")]
    pub blend: String,
    #[serde(default)]
    pub bind_bone: Option<String>,
    // vector
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pts: Option<BTreeMap<String, Point>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<Path>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shapes: Option<Vec<Shape>>,
    // containers
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<Layer>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bones: Option<Vec<Bone>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vgroups: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<Force>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sw_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sw_fade: Option<f64>,
    // image / audio
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub iw: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ih: Option<f64>,
    // text
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    // particles
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_f: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_f: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub burst: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emit: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}

impl Layer {
    pub fn is_container(&self) -> bool {
        matches!(self.kind.as_str(), "group" | "bone" | "switch")
    }
    pub fn kids(&self) -> &[Layer] {
        self.children.as_deref().unwrap_or(&[])
    }
    pub fn bones(&self) -> &[Bone] {
        self.bones.as_deref().unwrap_or(&[])
    }
    pub fn bone(&self, id: &str) -> Option<&Bone> {
        self.bones().iter().find(|b| b.id == id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Doc {
    #[serde(default)]
    pub name: String,
    #[serde(default = "d_w")]
    pub w: f64,
    #[serde(default = "d_h")]
    pub h: f64,
    #[serde(default = "d_fps")]
    pub fps: f64,
    #[serde(default = "d_end")]
    pub end: f64,
    #[serde(default = "d_bg")]
    pub bg: String,
    pub camera: Layer,
    #[serde(default)]
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub styles: Vec<Style>,
    #[serde(flatten)]
    pub extra: Map<String, Json>,
}
fn d_w() -> f64 {
    1280.0
}
fn d_h() -> f64 {
    720.0
}
fn d_fps() -> f64 {
    24.0
}
fn d_end() -> f64 {
    72.0
}
fn d_bg() -> String {
    "#ffffff".into()
}

impl Doc {
    /// Accepts either a bare document or the saved file wrapper `{app, format, doc}`.
    pub fn from_json(s: &str) -> Result<Doc, String> {
        let v: Json = serde_json::from_str(s).map_err(|e| format!("invalid JSON: {e}"))?;
        let inner = match v.get("doc") {
            Some(d) if d.get("layers").is_some() => d.clone(),
            _ => v,
        };
        if inner.get("layers").is_none() || inner.get("camera").is_none() {
            return Err("not a Popai Animator project (missing layers/camera)".into());
        }
        serde_json::from_value(inner).map_err(|e| format!("project format error: {e}"))
    }
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
    /// root-to-layer chain (inclusive) for a layer id
    pub fn chain(&self, id: &str) -> Option<Vec<&Layer>> {
        fn rec<'a>(list: &'a [Layer], id: &str, acc: &mut Vec<&'a Layer>) -> bool {
            for l in list {
                acc.push(l);
                if l.id == id || rec(l.kids(), id, acc) {
                    return true;
                }
                acc.pop();
            }
            false
        }
        let mut acc = Vec::new();
        if rec(&self.layers, id, &mut acc) {
            Some(acc)
        } else {
            None
        }
    }
    pub fn find(&self, id: &str) -> Option<&Layer> {
        self.chain(id).and_then(|c| c.last().copied())
    }
    pub fn style(&self, id: &str) -> Option<&Style> {
        self.styles.iter().find(|s| s.id == id)
    }
}
