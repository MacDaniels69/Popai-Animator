//! Popai Animator desktop app (Tauri).
//! The interface (React shell + animation editor) lives in `ui/`. This process gives it the desktop
//! services the Electron build used to have: open / save projects with native dialogs, save exported
//! video, crash-recovery checkpoints, the window title, and an "unsaved changes" prompt on close.
//! The JavaScript side (`ui/src/services/tauri-bridge.ts`) exposes them as `window.popaiDesktop`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use popai_core::Engine;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_PROJECT: usize = 512 * 1024 * 1024;
const MAX_VIDEO: usize = 1024 * 1024 * 1024;

#[derive(Default)]
struct Desk {
    /// documentId -> file it was opened from / saved to
    paths: HashMap<String, PathBuf>,
    /// open token -> file picked in the open dialog (bound to a document once it loaded)
    pending: HashMap<String, PathBuf>,
    dirty: bool,
    close_pending: bool,
    close_approved: bool,
    counter: u64,
}
struct DeskState(Mutex<Desk>);
struct EngineState(Mutex<Engine>);

#[derive(Serialize)]
struct Saved {
    canceled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    canceled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    open_token: Option<String>,
}

fn base_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}
/// Write next to the target, then rename over it, so a crash never leaves a half-written project.
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension(format!("{}.tmp", path.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default()));
    std::fs::write(&tmp, bytes).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save {}: {e}", path.display())
    })
}
fn safe_file_name(name: &str, fallback: &str) -> String {
    let s: String = name.chars().map(|c| if "<>:\"/\\|?*".contains(c) || (c as u32) < 32 { '_' } else { c }).take(140).collect();
    if s.trim().is_empty() { fallback.to_string() } else { s }
}
fn check_project(text: &str) -> Result<(), String> {
    if text.len() > MAX_PROJECT {
        return Err("Project is too large to save".into());
    }
    serde_json::from_str::<Value>(text).map(|_| ()).map_err(|_| "Project data is not valid JSON".to_string())
}
fn recovery_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recovery.popai.json"))
}

#[tauri::command]
fn popai_info(app: tauri::AppHandle) -> Value {
    serde_json::json!({ "version": app.package_info().version.to_string(), "platform": std::env::consts::OS })
}

#[tauri::command]
async fn popai_open(app: tauri::AppHandle, desk: State<'_, DeskState>) -> Result<Opened, String> {
    let picked = app.dialog().file().set_title("Open Popai project").add_filter("Popai project", &["json", "popai"]).blocking_pick_file();
    let Some(fp) = picked else { return Ok(Opened { canceled: true, name: None, text: None, open_token: None }) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() as usize > MAX_PROJECT {
        return Err("That file is too large to be a Popai project".into());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let mut d = desk.0.lock().map_err(|_| "busy")?;
    d.counter += 1;
    let token = format!("open-{}-{}", d.counter, std::process::id());
    if d.pending.len() > 8 {
        d.pending.clear();
    }
    d.pending.insert(token.clone(), path.clone());
    Ok(Opened { canceled: false, name: Some(base_name(&path)), text: Some(text), open_token: Some(token) })
}

#[tauri::command]
fn popai_bind_open(desk: State<'_, DeskState>, document_id: String, open_token: String) -> Result<(), String> {
    let mut d = desk.0.lock().map_err(|_| "busy")?;
    let p = d.pending.remove(&open_token).ok_or("Expired open request")?;
    if d.paths.len() > 32 {
        d.paths.clear();
    }
    d.paths.insert(document_id, p);
    Ok(())
}

#[tauri::command]
async fn popai_save(app: tauri::AppHandle, desk: State<'_, DeskState>, document_id: String, name: String, text: String, save_as: Option<bool>) -> Result<Saved, String> {
    check_project(&text)?;
    let known = if save_as.unwrap_or(false) { None } else { desk.0.lock().map_err(|_| "busy")?.paths.get(&document_id).cloned() };
    let path = match known {
        Some(p) => p,
        None => {
            let file = format!("{}.popai.json", safe_file_name(name.trim_end_matches(".popai.json").trim_end_matches(".json"), "Untitled"));
            let title = if save_as.unwrap_or(false) { "Save project as" } else { "Save Popai project" };
            let picked = app.dialog().file().set_title(title).set_file_name(&file).add_filter("Popai project", &["popai.json", "json"]).blocking_save_file();
            match picked {
                Some(fp) => fp.into_path().map_err(|e| e.to_string())?,
                None => return Ok(Saved { canceled: true, name: None }),
            }
        }
    };
    atomic_write(&path, text.as_bytes())?;
    desk.0.lock().map_err(|_| "busy")?.paths.insert(document_id, path.clone());
    Ok(Saved { canceled: false, name: Some(base_name(&path)) })
}

/// Video bytes arrive as the raw request body (no JSON copy); the file name is in the `x-name` header.
#[tauri::command]
async fn popai_save_video(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Saved, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Invalid video export".into()) };
    if bytes.len() < 4 || bytes.len() > MAX_VIDEO {
        return Err("Invalid video export".into());
    }
    if bytes[0..4] != [0x1a, 0x45, 0xdf, 0xa3] {
        return Err("Video encoding failed: invalid WebM file".into());
    }
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("popai-video.webm");
    let name = safe_file_name(&percent_decode(name), "popai-video.webm");
    let picked = app.dialog().file().set_title("Save video").set_file_name(&name).add_filter("WebM video", &["webm"]).blocking_save_file();
    let Some(fp) = picked else { return Ok(Saved { canceled: true, name: None }) };
    let path = fp.into_path().map_err(|e| e.to_string())?;
    atomic_write(&path, bytes)?;
    Ok(Saved { canceled: false, name: Some(base_name(&path)) })
}
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
fn popai_recovery_write(app: tauri::AppHandle, text: String) -> Result<(), String> {
    check_project(&text)?;
    atomic_write(&recovery_file(&app)?, text.as_bytes())
}
#[tauri::command]
fn popai_recovery_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = recovery_file(&app)?;
    Ok(std::fs::read_to_string(p).ok())
}

#[tauri::command]
fn popai_set_dirty(app: tauri::AppHandle, desk: State<'_, DeskState>, dirty: bool, name: String) {
    if let Ok(mut d) = desk.0.lock() {
        d.dirty = dirty;
    }
    if let Some(w) = app.get_webview_window("main") {
        let n: String = name.chars().take(200).collect();
        let _ = w.set_title(&format!("{}{} — Popai Animator", if dirty { "● " } else { "" }, n));
    }
}
#[tauri::command]
fn popai_resolve_close(app: tauri::AppHandle, desk: State<'_, DeskState>, allow: bool) {
    let go = {
        let Ok(mut d) = desk.0.lock() else { return };
        if !d.close_pending {
            return;
        }
        d.close_pending = false;
        if allow {
            d.close_approved = true;
        }
        allow
    };
    if go {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.close();
        }
    }
}

/// The old Rust preview engine (kept for its compatibility tests and future GPU work).
#[tauri::command]
fn engine_rpc(state: State<'_, EngineState>, method: String, params: Value) -> Result<Value, String> {
    let mut engine = state.0.lock().map_err(|_| "engine lock poisoned".to_string())?;
    engine.call(&method, &params)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState(Mutex::new(Engine::new())))
        .manage(DeskState(Mutex::new(Desk::default())))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DeskState>();
                let Ok(mut d) = state.0.lock() else { return };
                if d.close_approved || !d.dirty {
                    return;
                }
                api.prevent_close();
                if !d.close_pending {
                    d.close_pending = true;
                    let _ = window.emit("popai-close-request", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            popai_info,
            popai_open,
            popai_bind_open,
            popai_save,
            popai_save_video,
            popai_recovery_write,
            popai_recovery_read,
            popai_set_dirty,
            popai_resolve_close,
            engine_rpc
        ])
        .run(tauri::generate_context!())
        .expect("error while running Popai Animator");
}
