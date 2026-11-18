//! 3D layer planes: tilt (Rotation X/Y), perspective homography and depth sorting.

use popai_core::{Doc, Eval, SceneOpts, SimCache};

fn layer(id: &str, p: &str) -> String {
    format!(r#"{{"id":"{id}","type":"vector","name":"{id}","p":{{{p}}},"ch":{{}},"pts":{{}},"paths":[],"shapes":[]}}"#)
}
fn doc(extra: &str, layers: &[String]) -> Doc {
    let j = format!(r##"{{"w":1280,"h":720,"fps":24,"end":10,"bg":"#fff","camera":{{"id":"CAM","type":"camera","p":{{"x":0,"y":0,"zoom":1,"roll":0}},"ch":{{}}}}{extra},"layers":[{}]}}"##, layers.join(","));
    Doc::from_json(&j).unwrap()
}
fn apply_h(h: &[f64; 9], x: f64, y: f64) -> [f64; 2] {
    let w = h[6] * x + h[7] * y + h[8];
    [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w]
}

#[test]
fn flat_layers_have_no_homography() {
    let d = doc("", &[layer("a", r#""x":10,"y":5,"z":100"#)]);
    let sims = SimCache::default();
    let n = &Eval::new(&d, &sims).scene(&SceneOpts::default())[0];
    assert!(n.h.is_none() && n.w3.is_none());
}

#[test]
fn tilted_layer_projects_with_perspective() {
    // Rotation Y 60: the point (100, 0) on the plane goes to x = 50, z = -86.6 (turned away), then perspective.
    let d = doc("", &[layer("a", r#""ry":60"#)]);
    let sims = SimCache::default();
    let n = &Eval::new(&d, &sims).scene(&SceneOpts::default())[0];
    let h = n.h.expect("tilted layer has a homography");
    let p = apply_h(&h, 100.0, 0.0);
    let (x, z) = (100.0 * 60f64.to_radians().cos(), -100.0 * 60f64.to_radians().sin());
    let s = 1500.0 / (1500.0 - z);
    assert!((p[0] - x * s).abs() < 1e-6 && p[1].abs() < 1e-9, "{p:?}");
    // a point on the rotation axis is unchanged
    let q = apply_h(&h, 0.0, 50.0);
    assert!(q[0].abs() < 1e-9 && (q[1] - 50.0).abs() < 1e-9);
    // world matrix is included
    assert!(n.w3.is_some());
}

#[test]
fn want3d_sends_every_plane() {
    let d = doc("", &[layer("a", "")]);
    let sims = SimCache::default();
    let n = &Eval::new(&d, &sims).scene(&SceneOpts { want3d: true, ..Default::default() })[0];
    assert!(n.w3.is_some() && n.h.is_none());
}

#[test]
fn depth_sort_draws_far_layers_first() {
    // stacking order: "near" is on top of "far" in the Layers panel, but we put "far" on top and let depth decide
    let layers = [layer("far", r#""z":-500"#), layer("near", r#""z":300"#)];
    let sims = SimCache::default();
    let off = doc("", &layers);
    let order = |d: &Doc| Eval::new(d, &sims).scene(&SceneOpts::default()).iter().map(|n| n.id.clone()).collect::<Vec<_>>();
    assert_eq!(order(&off), ["near", "far"]); // layer order: bottom (near) drawn first
    let on = doc(r#","depthSort":true"#, &layers);
    assert_eq!(order(&on), ["far", "near"]);
}
