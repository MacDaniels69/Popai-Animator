//! Animatable values: numbers, vectors, colours and discrete values (ids, flags).

use crate::math::{clamp, js_round};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Val {
    Num(f64),
    Arr(Vec<f64>),
    Bool(bool),
    Str(String),
    Null(()),
}

impl Default for Val {
    fn default() -> Self {
        Val::Null(())
    }
}

impl Val {
    pub fn num(&self) -> Option<f64> {
        match self {
            Val::Num(n) => Some(*n),
            _ => None,
        }
    }
    /// Number with a fallback (JS `val(...) || d` / `?? d` depending on caller).
    pub fn num_or(&self, d: f64) -> f64 {
        self.num().unwrap_or(d)
    }
    pub fn vec2(&self) -> Option<[f64; 2]> {
        match self {
            Val::Arr(a) if a.len() >= 2 => Some([a[0], a[1]]),
            _ => None,
        }
    }
    pub fn str(&self) -> Option<&str> {
        match self {
            Val::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }
    pub fn is_null(&self) -> bool {
        matches!(self, Val::Null(_))
    }
    /// JS truthiness (used where the JS engine writes `a || b`).
    pub fn truthy(&self) -> bool {
        match self {
            Val::Num(n) => *n != 0.0 && !n.is_nan(),
            Val::Arr(_) => true,
            Val::Bool(b) => *b,
            Val::Str(s) => !s.is_empty(),
            Val::Null(_) => false,
        }
    }
    pub fn is_color(&self) -> bool {
        matches!(self, Val::Str(s) if is_color(s))
    }
}

pub fn is_color(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 7 && b[0] == b'#' && b[1..].iter().all(|c| c.is_ascii_hexdigit())
}

pub fn hex_to_rgb(h: &str) -> [f64; 3] {
    let mut s: String = h.trim_start_matches('#').to_string();
    if s.len() == 3 {
        s = s.chars().flat_map(|c| [c, c]).collect();
    }
    let n = u32::from_str_radix(s.get(0..6).unwrap_or("0"), 16).unwrap_or(0);
    [((n >> 16) & 255) as f64, ((n >> 8) & 255) as f64, (n & 255) as f64]
}
pub fn rgb_to_hex(r: f64, g: f64, b: f64) -> String {
    let c = |v: f64| clamp(js_round(v), 0.0, 255.0) as u8;
    format!("#{:02x}{:02x}{:02x}", c(r), c(g), c(b))
}
pub fn mix_color(a: &str, b: &str, t: f64) -> String {
    let (x, y) = (hex_to_rgb(a), hex_to_rgb(b));
    rgb_to_hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t)
}

/// `mixVal` from the JS engine.
pub fn mix_val(a: &Val, b: &Val, t: f64) -> Val {
    match (a, b) {
        (Val::Num(x), Val::Num(y)) => Val::Num(x + (y - x) * t),
        (Val::Arr(x), Val::Arr(y)) => Val::Arr(x.iter().enumerate().map(|(i, v)| v + (y.get(i).copied().unwrap_or(f64::NAN) - v) * t).collect()),
        (Val::Str(x), Val::Str(y)) if is_color(x) && is_color(y) => Val::Str(mix_color(x, y, t)),
        _ => a.clone(),
    }
}
