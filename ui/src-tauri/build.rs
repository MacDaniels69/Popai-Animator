use std::path::PathBuf;

fn main() {
    // Embed the File Explorer thumbnail provider (crates/popai-thumbnails) if it has been built.
    // The Windows build workflow builds it first; other builds embed nothing and simply skip thumbnails.
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).join("../../target/release/popai_thumbnails.dll");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("popai_thumbnails.dll");
    match std::fs::read(&root) {
        Ok(bytes) => std::fs::write(&out, bytes).unwrap(),
        Err(_) => {
            if std::env::var("CARGO_CFG_WINDOWS").is_ok() && std::env::var("PROFILE").as_deref() == Ok("release") {
                println!("cargo:warning=popai_thumbnails.dll not found; .popai files will have no Explorer thumbnails. Run `cargo build --release -p popai-thumbnails` first.");
            }
            std::fs::write(&out, []).unwrap();
        }
    }
    println!("cargo:rerun-if-changed={}", root.display());
    println!("cargo:rustc-env=POPAI_THUMBS_DLL={}", out.display());
    tauri_build::build()
}
