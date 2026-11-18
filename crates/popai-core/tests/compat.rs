//! Compatibility tests: the Rust engine must reproduce the JavaScript engine's output
//! (recorded by `tests/compat/gen_golden.py`) for every fixture, frame and scenario.

use popai_core::{Doc, Eval, SceneOpts, SimCache};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-6 * a.abs().max(b.abs()).max(1.0)
}
fn arr(v: &Value) -> Vec<f64> {
    v.as_array().map(|a| a.iter().map(|x| x.as_f64().unwrap_or(f64::NAN)).collect()).unwrap_or_default()
}
fn opts(v: &Value, frame: f64) -> SceneOpts {
    let mut swo = HashMap::new();
    if let Some(m) = v.get("swOverride").and_then(|x| x.as_object()) {
        for (k, x) in m {
            swo.insert(k.clone(), x.as_str().unwrap().to_string());
        }
    }
    SceneOpts {
        frame,
        export: v.get("export").and_then(|x| x.as_bool()).unwrap_or(false),
        only: v.get("only").and_then(|x| x.as_str()).map(String::from),
        no_trail: v.get("noTrail").and_then(|x| x.as_bool()).unwrap_or(false),
        sw_override: swo,
        ..Default::default()
    }
}

fn check_fixture(name: &str) -> (usize, Vec<String>) {
    let doc = Doc::from_json(&std::fs::read_to_string(root().join(format!("fixtures/{name}.popai.json"))).unwrap()).unwrap();
    let golden: Value = serde_json::from_str(&std::fs::read_to_string(root().join(format!("fixtures/golden/{name}.json"))).unwrap()).unwrap();
    let sims = SimCache::default();
    let ev = Eval::new(&doc, &sims);
    let mut checked = 0;
    let mut errors = vec![];
    for case in golden["cases"].as_array().unwrap() {
        let f = case["frame"].as_f64().unwrap();
        let tag = format!("{name}/{}/f{f}", case["scenario"].as_str().unwrap());
        let nodes = ev.scene(&opts(&case["opts"], f));
        let mut flat = vec![];
        for n in &nodes {
            n.walk(&mut flat);
        }
        let flat: Vec<_> = flat.into_iter().filter(|n| !n.anc).collect();
        let items = case["items"].as_array().unwrap();
        if flat.len() != items.len() {
            errors.push(format!("{tag}: {} layers evaluated, JS had {} ({:?} vs {:?})", flat.len(), items.len(),
                flat.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(), items.iter().map(|i| i["id"].as_str().unwrap()).collect::<Vec<_>>()));
            continue;
        }
        for (n, it) in flat.iter().zip(items) {
            checked += 1;
            let id = it["id"].as_str().unwrap();
            let mut err = |what: String| errors.push(format!("{tag} layer {id}: {what}"));
            if n.id != id {
                err(format!("order differs (rust {})", n.id));
                continue;
            }
            let m = arr(&it["m"]);
            if !m.iter().zip(n.m.iter()).all(|(a, b)| close(*a, *b)) {
                err(format!("matrix {:?} != {:?}", n.m, m));
            }
            if let Some(op) = it["op"].as_f64() {
                if !close(op, n.op) {
                    err(format!("opacity {} != {op}", n.op));
                }
            }
            if let Some(pts) = it.get("pts").and_then(|p| p.as_object()) {
                match &n.pts {
                    None => err("missing points".into()),
                    Some(rp) => {
                        for (pid, v) in pts {
                            let v = arr(v);
                            match rp.get(pid) {
                                Some(q) if close(q[0], v[0]) && close(q[1], v[1]) => {}
                                q => err(format!("point {pid} {q:?} != {v:?}")),
                            }
                        }
                    }
                }
            }
            if let Some(bones) = it.get("bones").and_then(|b| b.as_array()) {
                let rb = n.bones.as_ref().map(|v| v.as_slice()).unwrap_or(&[]);
                for (b, jb) in rb.iter().zip(bones) {
                    let jf = arr(&jb["f"]);
                    if b.id != jb["id"].as_str().unwrap() || !jf.iter().zip(b.f.iter()).all(|(a, c)| close(*a, *c)) || !close(b.len, jb["len"].as_f64().unwrap()) || b.off != jb["off"].as_bool().unwrap() {
                        err(format!("bone {} frame {:?}/{} off {} != {:?}/{}/{}", b.id, b.f, b.len, b.off, jf, jb["len"], jb["off"]));
                    }
                }
            }
            if let Some(a) = it.get("active").and_then(|a| a.as_str()) {
                if n.active.as_deref() != Some(a) {
                    err(format!("active child {:?} != {a}", n.active));
                }
            }
            if let Some(ps) = it.get("particles").and_then(|p| p.as_array()) {
                let rl = n.particles.as_ref().map(|p| p.list.as_slice()).unwrap_or(&[]);
                if rl.len() != ps.len() {
                    err(format!("{} particles != {}", rl.len(), ps.len()));
                } else {
                    for (k, (a, b)) in rl.iter().zip(ps).enumerate() {
                        let same = close(a.x, b["x"].as_f64().unwrap()) && close(a.y, b["y"].as_f64().unwrap()) && close(a.size, b["size"].as_f64().unwrap())
                            && close(a.a, b["a"].as_f64().unwrap()) && close(a.rot, b["rot"].as_f64().unwrap()) && a.col == b["col"].as_str().unwrap();
                        if !same {
                            err(format!("particle {k}: {a:?} != {b}"));
                            break;
                        }
                    }
                }
            }
        }
    }
    (checked, errors)
}

fn run(name: &str) {
    let (n, errs) = check_fixture(name);
    if !errs.is_empty() {
        let shown: Vec<_> = errs.iter().take(25).cloned().collect();
        panic!("{name}: {} mismatches in {n} layer records\n{}", errs.len(), shown.join("\n"));
    }
    println!("{name}: {n} layer records identical to the JavaScript engine");
}

#[test]
fn demo_matches_javascript_engine() {
    run("demo");
}
#[test]
fn features_match_javascript_engine() {
    run("features");
}

#[test]
fn project_round_trip_keeps_every_field() {
    for name in ["demo", "features"] {
        let txt = std::fs::read_to_string(root().join(format!("fixtures/{name}.popai.json"))).unwrap();
        let orig: Value = serde_json::from_str(&txt).unwrap();
        let doc = Doc::from_json(&txt).unwrap();
        let again: Value = serde_json::from_str(&doc.to_json()).unwrap();
        let o = orig.get("doc").cloned().unwrap_or(orig);
        // compare structurally: every original key/value must survive the round trip
        fn sub(a: &Value, b: &Value, path: &str, out: &mut Vec<String>) {
            match (a, b) {
                (Value::Object(x), Value::Object(y)) => {
                    for (k, v) in x {
                        match y.get(k) {
                            Some(w) => sub(v, w, &format!("{path}.{k}"), out),
                            None => out.push(format!("{path}.{k} dropped")),
                        }
                    }
                }
                (Value::Array(x), Value::Array(y)) => {
                    if x.len() != y.len() {
                        out.push(format!("{path} length"));
                    }
                    for (i, (v, w)) in x.iter().zip(y).enumerate() {
                        sub(v, w, &format!("{path}[{i}]"), out);
                    }
                }
                (Value::Number(x), Value::Number(y)) => {
                    if !close(x.as_f64().unwrap(), y.as_f64().unwrap()) {
                        out.push(format!("{path} {x} != {y}"));
                    }
                }
                _ => {
                    if a != b {
                        out.push(format!("{path} {a} != {b}"));
                    }
                }
            }
        }
        let mut diffs = vec![];
        sub(&o, &again, "doc", &mut diffs);
        assert!(diffs.is_empty(), "{name} round trip lost data:\n{}", diffs.join("\n"));
    }
}

#[test]
fn history_undo_redo() {
    let mut h = popai_core::history::History::default();
    h.commit("A", "doc0".into());
    h.commit("B", "doc1".into());
    let s = h.undo("doc2".into()).unwrap();
    assert_eq!((s.label.as_str(), s.doc.as_str()), ("B", "doc1"));
    let s = h.redo("doc1".into()).unwrap();
    assert_eq!(s.doc, "doc2");
    h.commit("C", "doc2".into());
    assert!(h.redo("x".into()).is_none(), "a new edit clears redo");
    assert_eq!(h.info().undo, vec!["A", "B", "C"]);
}
