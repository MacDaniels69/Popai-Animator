import { useEffect, useRef, useState } from 'react';
import type { EngineClient } from './engine/client';
import { mountEditor } from './legacy/editor';
import wordmark from './assets/popai-wordmark.png';

/** Shows which engine evaluates frames, with the last round-trip time. */
function EngineBadge({ engine }: { engine: EngineClient }) {
  const [, force] = useState(0);
  useEffect(() => {
    const off = engine.onChange(() => force((n) => n + 1));
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => { off(); clearInterval(t); };
  }, [engine]);
  const rust = engine.mode === 'rust';
  const where = engine.via === 'tauri' ? 'native' : engine.via === 'host' ? 'engine host' : '';
  return (
    <span
      className={'engine-badge ' + (rust ? 'rust' : 'legacy')}
      title={rust ? `Frames are evaluated by the Rust core (${engine.info?.engine} ${engine.info?.version}, ${where}). Last call ${engine.lastMs.toFixed(1)} ms.` : 'Rust engine not connected — using the legacy JavaScript engine.'}
    >
      {rust ? `⚙ Rust core ${engine.info?.version} · ${engine.lastMs.toFixed(1)} ms` : '⚠ Legacy JS engine'}
    </span>
  );
}

export function App({ engine }: { engine: EngineClient }) {
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return; // the editor owns its DOM; mount once (React StrictMode-safe)
    mounted.current = true;
    mountEditor(engine);
  }, [engine]);
  return (
    <>
      <div id="app">
        <header id="menubar">
          <div className="brand"><img className="brand-logo" src={wordmark} alt="Popai Animator" /></div>
          <nav id="menus"></nav>
          <div className="mb-right">
            <EngineBadge engine={engine} />
            <div className="seg" id="modeSeg" title="Setup: build the rig and rest pose · Animate: record keys (Tab toggles)">
              <button data-m="setup">⚙ Setup</button><button data-m="animate">● Animate</button>
            </div>
            <span id="docname" title="Project settings"></span>
            <button className="ib" id="btnUndo" title="Undo (Ctrl+Z)">↶</button>
            <button className="ib" id="btnRedo" title="Redo (Ctrl+Shift+Z)">↷</button>
            <button className="search-btn" id="btnCmd" title="Command search (Ctrl+K)">⌕ Search commands… <kbd>Ctrl K</kbd></button>
          </div>
        </header>
        <div id="toolopts"></div>
        <div id="main">
          <aside id="toolbar"></aside>
          <section id="stagewrap">
            <canvas id="stage"></canvas>
            <div id="crumbs"></div>
            <div id="stagehud">
              <span id="hudInfo"></span>
              <button className="ib sm" data-view="fit" title="Fit frame (Home)">⤢</button>
              <button className="ib sm" data-view="100" title="100%">1:1</button>
              <button className="ib sm toggle" data-view="output" title="Output only — hide editor overlays (O)">◉</button>
            </div>
            <div id="dropHint">Drop images, audio or a .popai.json project</div>
          </section>
          <aside id="right">
            <div id="layersPanel" className="panel">
              <div className="ph"><span>Layers</span>
                <div className="ph-btns">
                  <button className="ib sm" id="lyAdd" title="New layer">＋</button>
                  <button className="ib sm" id="lyDup" title="Duplicate layer (Ctrl+D)">⧉</button>
                  <button className="ib sm" id="lyGroup" title="Group selected layers (Ctrl+G)">▣</button>
                  <button className="ib sm" id="lyUp" title="Raise layer">▲</button>
                  <button className="ib sm" id="lyDown" title="Lower layer">▼</button>
                  <button className="ib sm" id="lyDel" title="Delete layer">🗑</button>
                </div>
              </div>
              <div id="layerTree"></div>
            </div>
            <div id="rsplit" className="hsplit"></div>
            <div id="sidePanel" className="panel">
              <div className="tabs" id="sideTabs">
                <button data-tab="props" className="on">Properties</button>
                <button data-tab="style">Style</button>
                <button data-tab="switch">Switch</button>
                <button data-tab="ai">AI ✦</button>
                <button data-tab="jobs">Jobs <span id="jobBadge"></span></button>
              </div>
              <div id="tabBody"></div>
            </div>
          </aside>
        </div>
        <div id="tsplit" className="hsplit"></div>
        <footer id="timeline">
          <div id="tlbar"></div>
          <div id="tlwrap"><canvas id="tlcanvas"></canvas></div>
        </footer>
      </div>
      <div id="menuLayer"></div>
      <div id="modal"></div>
      <div id="toasts"></div>
      <input type="file" id="fileIn" hidden />
    </>
  );
}
