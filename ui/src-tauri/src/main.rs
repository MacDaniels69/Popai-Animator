//! Popai Animator desktop app (Tauri). The interface is the React app in `ui/`; the Rust core engine
//! runs in this process and answers the interface through the `engine_rpc` command.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::Engine as _;
use popai_core::Engine;
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_dialog::DialogExt;

struct EngineState(Mutex<Engine>);

/// Every engine call (`version`, `frame`, `set_doc`, `hist_*`, …) — same API as the engine host.
#[tauri::command]
fn engine_rpc(state: State<'_, EngineState>, method: String, params: Value) -> Result<Value, String> {
    let mut engine = state.0.lock().map_err(|_| "engine lock poisoned".to_string())?;
    engine.call(&method, &params)
}

/// Save bytes (base64) through the native save dialog. Returns the chosen path, or null if cancelled.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, name: String, data: String) -> Result<Option<String>, String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| e.to_string())?;
    let picked = app.dialog().file().set_file_name(&name).blocking_save_file();
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// `POPAI_SELFTEST=1` makes the interface run its built-in integration check and report back.
#[tauri::command]
fn selftest_enabled() -> bool {
    std::env::var("POPAI_SELFTEST").map(|v| v == "1").unwrap_or(false)
}
#[tauri::command]
fn selftest_report(app: tauri::AppHandle, report: Value) {
    println!("POPAI_SELFTEST {}", report);
    let ok = report.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    app.exit(if ok { 0 } else { 1 });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState(Mutex::new(Engine::new())))
        .invoke_handler(tauri::generate_handler![engine_rpc, save_file, selftest_enabled, selftest_report])
        .run(tauri::generate_context!())
        .expect("error while running Popai Animator");
}
