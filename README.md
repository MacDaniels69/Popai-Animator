# Popai Animator — desktop architecture (stages 1–2)

| Layer | Technology | Where |
|---|---|---|
| Interface (panels, tools, menus, timeline) | TypeScript + React (Vite) | `ui/src` |
| Core engine: document model, animation evaluation, bones, binding, deformation, physics, particles, undo/redo | Rust | `crates/popai-core` |
| Desktop shell (window, native file dialogs, in-process engine) | Tauri 2 | `ui/src-tauri` |
| Engine host for browser development and automated tests | Rust (no dependencies) | `crates/popai-engine-host` |
| GPU renderer (stage 3) | Rust + wgpu + WGSL | not started |
| Frame-by-frame export (stage 4) | FFmpeg libraries | not started |
| AI workers: speech, lip sync (stage 5) | Python processes | not started |

## How it fits together

```
React interface ──engine_rpc──▶ Rust core (popai-core)
   (ui/src)        Tauri command     • evaluates a frame → a "scene" (matrices, deformed geometry,
                   (or HTTP in dev)    switch picks, particles, evaluated effect parameters)
   paints the scene                  • keeps undo/redo history
   on <canvas>                       • parses / validates .popai.json projects
```

* Every drawn frame is evaluated by the Rust engine. The interface sends the document when it changes and
  receives scenes; one round trip per frame (≈2–5 ms), with frames ahead prefetched during playback.
* The canvas painter is the only drawing code left in TypeScript. Stage 3 replaces it with the wgpu renderer,
  which will read the same scene structure, so preview and export keep sharing one evaluation path.
* The previous app is preserved unchanged as `legacy-reference.html`, and its JavaScript engine still exists
  inside the interface as a fallback (if no engine is connected, the badge in the menu bar says
  “Legacy JS engine”) and as the reference for the parity tests.
* Projects are the same `.popai.json` files as before. The Rust model keeps unknown fields, so nothing is
  lost when an older or newer version saves.

## Compatibility tests (stage 1)

* `fixtures/*.popai.json` — the demo scene plus a feature scene covering every interpolation type, pivots,
  masks, crossfading switches, bone offsets, Vitruvian groups, spring physics with wind/gravity, flexible and
  weighted binding, nested rigs, bound particles, camera shake/roll/zoom and 2.5D depth.
* `fixtures/golden/*.json` — the old engine's exact output for 90 frames × 4 scenarios (5,740 layer states),
  recorded with `python3 tests/compat/gen_golden.py`.
* `cargo test -p popai-core` — the Rust engine must reproduce every matrix, point, bone, particle and switch
  pick (tolerance 1e-6), round-trip project files without losing fields, and pass history tests.
* `tests/parity/pixel_parity.py` — renders 108 frames with both engines in Chrome and compares every pixel.
* Desktop self-test: `POPAI_SELFTEST=1` makes the app render demo frames through the in-process engine,
  compare them with the legacy engine, check undo/redo and exit with the result.

Results at hand-over: all 5,740 states identical, 0 differing pixels in 108 frames, desktop self-test
passed (2.6 ms per frame call).

## Building on Windows

**Easiest:** double-click `BUILD POPAI ANIMATOR.cmd` (see `START HERE.txt`). It installs whatever is missing
(C++ build tools, Rust, Node.js) with winget, builds the app and opens `Popai Animator - Windows/` with the
installer and a portable exe. The steps below are the same thing done by hand.

1. Install the prerequisites (one time):
   * **Microsoft C++ Build Tools** (“Desktop development with C++”) — needed by Rust on Windows. This is the
     largest download (several GB).
   * **Rust** from https://rustup.rs (about 300 MB).
   * **Node.js 20+** (about 30 MB).
   * WebView2 is already part of Windows 10/11.
2. In `ui/`: `npm install` (about 25 MB download).
3. Run the app while developing: `npm run tauri dev`
4. Build the installer: `npm run tauri build` → `ui/src-tauri/target/release/bundle/nsis/` (installer .exe).
   The first build compiles about 300 Rust crates (about 22 MB download, a few minutes), fetches the NSIS
   installer tool (a few MB) and uses several GB
   of disk under `target/`.

Browser development without Tauri: `npm run build` in `ui/`, then from the repo root
`cargo run --release -p popai-engine-host -- --port 7878 --ui ui/dist` and open http://127.0.0.1:7878.

Running every test: `scripts/run-tests.sh` (Rust tests need only `cargo`; the pixel test needs Python 3,
playwright and Chrome).

## Next stages

3. **GPU rendering** — a wgpu renderer for scenes (vectors, compositing, masks, particles, WGSL effects)
   with the current canvas painter kept as the tested software fallback; parity tests compare the two.
4. **Export** — render frame by frame on the engine side and encode MP4/WebM with FFmpeg's libraries,
   replacing real-time recording.
5. **AI workers** — Python processes (speech analysis, lip sync, models) managed by the desktop app, so heavy
   work never blocks drawing or playback.

Optional speed-up: the core also compiles to WebAssembly (`rustup target add wasm32-unknown-unknown`), which
would let the interface evaluate frames without a round trip.

Not moved yet: the switch-panel thumbnails and the interactive tool maths (dragging, IK while dragging,
hit-testing) still use the TypeScript functions; the parity tests keep both engines identical.
