//! Undo / redo history. Each entry stores the document as it was before an edit
//! (media excluded — media never changes through undo), so restoring is exact.

use serde::Serialize;

#[derive(Clone)]
struct Entry {
    label: String,
    doc: String,
}
pub struct History {
    undo: Vec<Entry>,
    redo: Vec<Entry>,
    pub max: usize,
}
#[derive(Serialize)]
pub struct Step {
    pub label: String,
    pub doc: String,
}
#[derive(Serialize)]
pub struct HistInfo {
    pub undo: Vec<String>,
    pub redo: Vec<String>,
}
impl Default for History {
    fn default() -> Self {
        History { undo: vec![], redo: vec![], max: 120 }
    }
}
impl History {
    /// Record an edit: `before` is the document just before it.
    pub fn commit(&mut self, label: &str, before: String) {
        self.undo.push(Entry { label: label.into(), doc: before });
        if self.undo.len() > self.max {
            self.undo.remove(0);
        }
        self.redo.clear();
    }
    /// Returns the document to restore; `current` goes onto the redo stack.
    pub fn undo(&mut self, current: String) -> Option<Step> {
        let e = self.undo.pop()?;
        self.redo.push(Entry { label: e.label.clone(), doc: current });
        Some(Step { label: e.label, doc: e.doc })
    }
    pub fn redo(&mut self, current: String) -> Option<Step> {
        let e = self.redo.pop()?;
        self.undo.push(Entry { label: e.label.clone(), doc: current });
        Some(Step { label: e.label, doc: e.doc })
    }
    pub fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }
    pub fn info(&self) -> HistInfo {
        HistInfo { undo: self.undo.iter().map(|e| e.label.clone()).collect(), redo: self.redo.iter().map(|e| e.label.clone()).collect() }
    }
}
