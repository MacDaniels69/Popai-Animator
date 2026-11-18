//! # popai-core
//! Native core of Popai Animator: the project document model, keyframe animation evaluation,
//! bones (IK-free evaluation, offsets, Vitruvian groups, spring physics), binding and deformation,
//! switch layers, the 2.5D camera, deterministic particles, and undo history.
//!
//! Output of a frame is a [`scene::Node`] tree that any renderer can draw.

pub mod anim;
pub mod api;
pub mod eval;
pub mod history;
pub mod math;
pub mod model;
pub mod scene;
pub mod value;

pub use api::Engine;
pub use eval::{Eval, SceneOpts, SimCache};
pub use model::Doc;
