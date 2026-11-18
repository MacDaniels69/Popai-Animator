// Desktop integration self-test (run with POPAI_SELFTEST=1). Renders demo frames through the in-process
// Rust engine and the legacy JS engine, compares pixels, checks undo/redo, then reports to the app.
import type { EngineClient } from './engine/client';

export async function runSelfTest(engine: EngineClient) {
  const { invoke } = await import('@tauri-apps/api/core');
  const report: Record<string, unknown> = { engine: engine.mode, via: engine.via, version: engine.info?.version };
  try {
    for (let i = 0; i < 100 && !(window as any).PopaiApp; i++) await new Promise((r) => setTimeout(r, 50));
    const A = (window as any).PopaiApp;
    A.startDoc(A.demoProject());
    await new Promise((r) => setTimeout(r, 300));
    const d = A.S.doc, W = 480, H = Math.round((480 * d.h) / d.w), sc = W / d.w, view = [sc, 0, 0, sc, W / 2, H / 2];
    const frames: Array<{ f: number; diff: number }> = [];
    for (const f of [0, 12, 40, 46, 58, 62, 80]) {
      const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d')!; x.fillStyle = d.bg; x.fillRect(0, 0, W, H); return x; };
      const xa = mk(), xb = mk();
      A.legacyRenderScene(xa, f, view, { export: true });
      await A.renderSceneAsync(xb, f, view, { export: true });
      const a = xa.getImageData(0, 0, W, H).data, b = xb.getImageData(0, 0, W, H).data;
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3])) > 2) diff++;
      frames.push({ f, diff });
    }
    report.frames = frames;
    const t = A.allLayers().find((l: any) => l.type === 'text');
    A.edit('selftest move', () => { t.p.x = 321; });
    A.runCmd('edit.undo'); await new Promise((r) => setTimeout(r, 300));
    const afterUndo = A.allLayers().find((l: any) => l.type === 'text').p.x;
    A.runCmd('edit.redo'); await new Promise((r) => setTimeout(r, 300));
    const afterRedo = A.allLayers().find((l: any) => l.type === 'text').p.x;
    report.history = { afterUndo, afterRedo };
    const t0 = performance.now(); for (let i = 0; i < 20; i++) await engine.rpc('frame', { rev: A.REV(), requests: [{ frame: i * 4 }] });
    report.msPerFrameCall = +((performance.now() - t0) / 20).toFixed(2);
    report.ok = engine.mode === 'rust' && frames.every((x) => x.diff === 0) && afterUndo === 0 && afterRedo === 321;
  } catch (e) {
    report.ok = false; report.error = String(e);
  }
  await invoke('selftest_report', { report });
}
