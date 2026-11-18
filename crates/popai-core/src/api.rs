//! The engine's message API. The Tauri app and the dev/test engine host both call [`Engine::call`],
//! so the interface talks to identical code in every environment.

use crate::eval::{Eval, SceneOpts, SimCache};
use crate::history::History;
use crate::model::Doc;
use serde_json::{json, Value as Json};
use std::collections::HashMap;

pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Default)]
pub struct Engine {
    doc: Option<Doc>,
    rev: i64,
    sims: SimCache,
    pub history: History,
}

fn opts_from(v: &Json) -> SceneOpts {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
    let b = |k: &str| v.get(k).and_then(|x| x.as_bool()).unwrap_or(false);
    let mut swo = HashMap::new();
    if let Some(m) = v.get("swOverride").and_then(|x| x.as_object()) {
        for (k, x) in m {
            if let Some(id) = x.as_str() {
                swo.insert(k.clone(), id.to_string());
            }
        }
    }
    SceneOpts {
        frame: v.get("frame").and_then(|x| x.as_f64()).unwrap_or(0.0),
        export: b("export"),
        only: s("only"),
        no_trail: b("noTrail"),
        sw_override: swo,
        no_camera: b("noCamera"),
        root: s("root"),
        want3d: b("want3d"),
    }
}

impl Engine {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn doc(&self) -> Option<&Doc> {
        self.doc.as_ref()
    }
    pub fn set_doc_json(&mut self, s: &str, rev: i64) -> Result<(), String> {
        let d = Doc::from_json(s)?;
        self.doc = Some(d);
        self.rev = rev;
        self.sims.lock().unwrap().clear();
        Ok(())
    }
    pub fn scene_json(&self, opts: &SceneOpts) -> Result<Json, String> {
        let d = self.doc.as_ref().ok_or("no document loaded")?;
        let ev = Eval::new(d, &self.sims);
        serde_json::to_value(ev.scene(opts)).map_err(|e| e.to_string())
    }

    /// Single entry point: `method` + JSON params -> JSON result.
    pub fn call(&mut self, method: &str, p: &Json) -> Result<Json, String> {
        let s = |k: &str| p.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
        match method {
            "version" => Ok(json!({ "engine": "popai-core", "version": ENGINE_VERSION, "rust": true,
                "features": ["evaluate", "bones", "binding", "physics", "particles", "switch", "camera", "history", "3d"] })),
            "set_doc" => {
                let doc = p.get("doc").ok_or("missing doc")?;
                let txt = if doc.is_string() { doc.as_str().unwrap().to_string() } else { doc.to_string() };
                self.set_doc_json(&txt, p.get("rev").and_then(|x| x.as_i64()).unwrap_or(0))?;
                Ok(json!({ "ok": true, "rev": self.rev }))
            }
            // One round trip per drawn frame: optional document sync + any number of scene requests.
            "frame" => {
                if let Some(doc) = p.get("doc").filter(|d| !d.is_null()) {
                    let txt = if doc.is_string() { doc.as_str().unwrap().to_string() } else { doc.to_string() };
                    self.set_doc_json(&txt, p.get("rev").and_then(|x| x.as_i64()).unwrap_or(0))?;
                }
                let reqs = p.get("requests").and_then(|r| r.as_array()).cloned().unwrap_or_default();
                let mut scenes = Vec::with_capacity(reqs.len());
                for r in &reqs {
                    scenes.push(self.scene_json(&opts_from(r))?);
                }
                Ok(json!({ "rev": self.rev, "scenes": scenes }))
            }
            "scene" => self.scene_json(&opts_from(p.get("opts").unwrap_or(&Json::Null))),
            "normalize" => {
                let doc = p.get("doc").ok_or("missing doc")?;
                let txt = if doc.is_string() { doc.as_str().unwrap().to_string() } else { doc.to_string() };
                let d = Doc::from_json(&txt)?;
                serde_json::from_str::<Json>(&d.to_json()).map_err(|e| e.to_string())
            }
            "hist_commit" => {
                self.history.commit(&s("label"), s("before"));
                Ok(json!(self.history.info()))
            }
            "hist_undo" => Ok(match self.history.undo(s("current")) {
                Some(step) => json!({ "step": step, "info": self.history.info() }),
                None => json!({ "step": null, "info": self.history.info() }),
            }),
            "hist_redo" => Ok(match self.history.redo(s("current")) {
                Some(step) => json!({ "step": step, "info": self.history.info() }),
                None => json!({ "step": null, "info": self.history.info() }),
            }),
            "hist_clear" => {
                self.history.clear();
                Ok(json!(self.history.info()))
            }
            "hist_info" => Ok(json!(self.history.info())),
            _ => Err(format!("unknown method {method}")),
        }
    }
}
