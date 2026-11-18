//! `popai-engine-host [--port 7878] [--ui <dir>]`
//!
//! Serves the engine on `POST /rpc` (`{"method": "...", "params": {...}}`) and, optionally, the built
//! interface from `--ui` so the browser loads it from the same origin. Binds to 127.0.0.1 only.
//! The desktop app does not use this: it calls the same `Engine::call` through Tauri commands.

use popai_core::Engine;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let arg = |k: &str| args.iter().position(|a| a == k).and_then(|i| args.get(i + 1)).cloned();
    let port = arg("--port").unwrap_or_else(|| "7878".into());
    let ui = arg("--ui").map(PathBuf::from);
    let addr = format!("127.0.0.1:{port}");
    let listener = TcpListener::bind(&addr).unwrap_or_else(|e| panic!("cannot bind {addr}: {e}"));
    eprintln!("popai engine host {} on http://{addr}{}", popai_core::api::ENGINE_VERSION, if ui.is_some() { " (serving UI)" } else { "" });
    let engine = Arc::new(Mutex::new(Engine::new()));
    for stream in listener.incoming().flatten() {
        let (engine, ui) = (engine.clone(), ui.clone());
        std::thread::spawn(move || {
            let _ = handle(stream, &engine, ui.as_deref());
        });
    }
}

fn handle(stream: TcpStream, engine: &Mutex<Engine>, ui: Option<&Path>) -> std::io::Result<()> {
    stream.set_nodelay(true)?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut out = stream;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(());
        }
        let mut parts = line.split_whitespace();
        let (method, path) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("/").to_string());
        let mut len = 0usize;
        let mut keep = true;
        loop {
            let mut h = String::new();
            reader.read_line(&mut h)?;
            let h = h.trim_end();
            if h.is_empty() {
                break;
            }
            let lower = h.to_ascii_lowercase();
            if let Some(v) = lower.strip_prefix("content-length:") {
                len = v.trim().parse().unwrap_or(0);
            }
            if lower.starts_with("connection:") && lower.contains("close") {
                keep = false;
            }
        }
        let mut body = vec![0u8; len];
        reader.read_exact(&mut body)?;
        let (status, ctype, payload): (&str, &str, Vec<u8>) = match (method.as_str(), path.as_str()) {
            ("OPTIONS", _) => ("204 No Content", "text/plain", vec![]),
            ("POST", "/rpc") => {
                let res = match serde_json::from_slice::<Value>(&body) {
                    Ok(req) => {
                        let m = req.get("method").and_then(|m| m.as_str()).unwrap_or("").to_string();
                        let params = req.get("params").cloned().unwrap_or(Value::Null);
                        match engine.lock().unwrap().call(&m, &params) {
                            Ok(r) => json!({ "ok": true, "result": r }),
                            Err(e) => json!({ "ok": false, "error": e }),
                        }
                    }
                    Err(e) => json!({ "ok": false, "error": format!("bad request: {e}") }),
                };
                ("200 OK", "application/json", serde_json::to_vec(&res).unwrap())
            }
            ("GET", p) => match ui {
                Some(dir) => serve_file(dir, p),
                None => ("200 OK", "application/json", br#"{"engine":"popai-core"}"#.to_vec()),
            },
            _ => ("405 Method Not Allowed", "text/plain", b"method not allowed".to_vec()),
        };
        write!(
            out,
            "HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Private-Network: true\r\nCache-Control: no-store\r\nConnection: {}\r\n\r\n",
            payload.len(),
            if keep { "keep-alive" } else { "close" }
        )?;
        out.write_all(&payload)?;
        out.flush()?;
        if !keep {
            return Ok(());
        }
    }
}

fn serve_file(dir: &Path, url: &str) -> (&'static str, &'static str, Vec<u8>) {
    let clean = url.split(['?', '#']).next().unwrap_or("/").trim_start_matches('/');
    if clean.split('/').any(|seg| seg == "..") {
        return ("403 Forbidden", "text/plain", b"forbidden".to_vec());
    }
    let p = if clean.is_empty() { dir.join("index.html") } else { dir.join(clean) };
    match std::fs::read(&p) {
        Ok(b) => {
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            let ct = match ext {
                "html" => "text/html; charset=utf-8",
                "js" | "mjs" => "text/javascript",
                "css" => "text/css",
                "json" => "application/json",
                "png" => "image/png",
                "svg" => "image/svg+xml",
                "wav" => "audio/wav",
                _ => "application/octet-stream",
            };
            ("200 OK", ct, b)
        }
        Err(_) => ("404 Not Found", "text/plain", b"not found".to_vec()),
    }
}
