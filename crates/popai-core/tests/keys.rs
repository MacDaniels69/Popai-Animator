//! Keyframe interpolation and timing controls (Moho-style).
use popai_core::anim::eval_channel;
use popai_core::model::Channel;

fn ch(j: &str) -> Channel {
    serde_json::from_str(&format!(r#"{{"keys":{j}}}"#)).unwrap()
}
fn at(c: &Channel, f: f64) -> f64 {
    eval_channel(c, f).unwrap().num().unwrap()
}

#[test]
fn cycle_repeats_without_extra_keys() {
    // arm down (0) at 0, up (90) at 12, down at 24 -> cycle back to frame 0
    let c = ch(r#"[{"f":0,"v":0,"i":"linear"},{"f":12,"v":90,"i":"linear"},{"f":24,"v":0,"i":"cycle","cm":"abs","cy":0}]"#);
    for f in [0.0, 6.0, 12.0, 18.0] {
        assert!((at(&c, f + 24.0) - at(&c, f)).abs() < 1e-9 && (at(&c, f + 48.0) - at(&c, f)).abs() < 1e-9, "frame {f}");
    }
    assert!((at(&c, 30.0) - 45.0).abs() < 1e-9);
    // relative: 24 frames back is the same loop
    let r = ch(r#"[{"f":0,"v":0,"i":"linear"},{"f":12,"v":90,"i":"linear"},{"f":24,"v":0,"i":"cycle","cm":"rel","cy":24}]"#);
    assert!((at(&r, 42.0) - at(&c, 42.0)).abs() < 1e-9);
}

#[test]
fn hold_interval_step() {
    let c = ch(r#"[{"f":0,"v":0,"i":"linear","hold":4},{"f":14,"v":100}]"#);
    assert_eq!(at(&c, 3.0), 0.0); // still holding
    assert!((at(&c, 9.0) - 50.0).abs() < 1e-9); // moves over the remaining 10 frames
    let tw = ch(r#"[{"f":0,"v":0,"i":"linear","iv":2},{"f":10,"v":100}]"#);
    assert_eq!(at(&tw, 3.0), at(&tw, 2.0)); // on twos
    assert!((at(&tw, 4.0) - 40.0).abs() < 1e-9);
    let st = ch(r#"[{"f":0,"v":0,"i":"step"},{"f":10,"v":100}]"#);
    assert_eq!(at(&st, 9.9), 0.0);
}

#[test]
fn bezier_handles_shape_the_motion() {
    let lin = ch(r#"[{"f":0,"v":0,"i":"bezier","bz":[0.0,0.0,1.0,1.0]},{"f":10,"v":100}]"#);
    assert!((at(&lin, 5.0) - 50.0).abs() < 1e-6); // straight handles = linear
    let fast = ch(r#"[{"f":0,"v":0,"i":"bezier","bz":[0.1,0.9,0.2,1.0]},{"f":10,"v":100}]"#);
    assert!(at(&fast, 2.0) > 60.0); // shoots out early
    let over = ch(r#"[{"f":0,"v":0,"i":"bezier","bz":[0.3,0.0,0.6,1.5]},{"f":10,"v":100}]"#);
    assert!((0..=10).map(|f| at(&over, f as f64)).fold(0.0, f64::max) > 100.0); // overshoot
}

#[test]
fn noisy_wobbles_but_lands_on_keys() {
    let c = ch(r#"[{"f":0,"v":0,"i":"noisy","na":20,"nf":2},{"f":20,"v":100}]"#);
    assert_eq!(at(&c, 0.0), 0.0);
    assert_eq!(at(&c, 20.0), 100.0);
    let off: f64 = (1..20).map(|f| (at(&c, f as f64) - f as f64 * 5.0).abs()).sum();
    assert!(off > 10.0);
}
