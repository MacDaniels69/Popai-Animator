/* ===================== Popai Animator — files: save/open, import, export, autosave, templates ===================== */

async function download(blob, name) {
  if(blob.type.startsWith('video/') && window.popaiDesktop?.saveVideo){
    if(blob.size===0||blob.size>128*1024*1024)throw Error('Video is empty or exceeds the 128 MiB limit');
    const result=await window.popaiDesktop.saveVideo({name,bytes:new Uint8Array(await blob.arrayBuffer())});
    return {...result,confirmed:!result.canceled};
  }
  // Hosted on claude.ai: saves go through the platform's downloads capability (viewer confirms each file)
  let dl = null;
  try { if (window.claude && window.claude.use) dl = await window.claude.use('downloads'); } catch (e) { dl = null; }
  if (dl) {
    let fn = name;
    if (!/\.(gif|png|jpe?g|webp|mp4|webm|txt|json|md|csv|html|svg|pdf|zip)$/i.test(fn)) fn += '.txt';
    try {
      await dl.save({ filename: fn, data: blob });
      if (fn !== name) toast(`Saved as ${fn} — rename it to ${name} to use it`, 'ok');
    } catch (e) { throw new Error('Save declined or failed: ' + ((e && (e.message || e.code)) || e)); }
    return { confirmed: true };
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return { confirmed: false };
}
function pickFile(accept, cb, multiple = false) {
  const i = $('#fileIn'); i.value = ''; i.accept = accept; i.multiple = multiple;
  i.onchange = () => { [...i.files].forEach(cb); };
  i.click();
}
const readAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
const readAsText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
function dataURLtoBuf(url) { const b = atob(url.split(',')[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }

// ---------- media ----------
async function loadMedia(id, m) {
  // m: {name, type:'image'|'audio', url(dataURL)}
  S.media[id] = { ...m };
  const targetMedia = S.media;
  if (m.type === 'image') {
    await new Promise((res) => { const img = new Image(); img.onload = () => { targetMedia[id].el = img; res(); }; img.onerror = () => { targetMedia[id].error = "Image decoding failed"; res(); }; img.src = m.url; });
  } else if (m.type === 'audio') {
    try { targetMedia[id].buffer = await audioCtx().decodeAudioData(dataURLtoBuf(m.url)); } catch (e) { toast('Could not decode audio “' + m.name + '”', 'err'); }
  }
  refreshAll();
}
async function importFile(file) {
  const originEpoch = documentEpoch;
  const name = file.name, low = name.toLowerCase();
  if (low.endsWith('.json') || low.endsWith('.popai')) return openProjectFile(file);
  if (low.endsWith('.dat')) return importDatText(await readAsText(file));
  if (low.endsWith('.gpl')) return importGpl(await readAsText(file));
  const type = file.type.startsWith('image') ? 'image' : file.type.startsWith('audio') || /\.(wav|mp3|ogg|m4a|flac)$/.test(low) ? 'audio' : null;
  if (!type) return toast('Unsupported file: ' + name, 'err');
  const url = await readAsDataURL(file), id = uid('m');
  if (originEpoch !== documentEpoch) return toast('Project changed; import the file again', 'err');
  S.doc.media[id] = { name, type, url };
  await loadMedia(id, { name, type, url });
  if (originEpoch !== documentEpoch) return toast('Project changed during decoding; import again', 'err');
  edit('Import ' + name, () => {
    const L = mkLayer(type, name.replace(/\.[^.]+$/, ''));
    L.media = id;
    if (type === 'image') {
      const el = S.media[id].el, w = el ? el.naturalWidth : 200, h = el ? el.naturalHeight : 200;
      const k = Math.min(1, (S.doc.w * 0.9) / w, (S.doc.h * 0.9) / h);
      L.iw = Math.round(w * k); L.ih = Math.round(h * k); L.nw = w; L.nh = h;
    } else {
      L.offset = S.frame || 1;
      const b = S.media[id].buffer; if (b) { const need = L.offset + Math.ceil(b.duration * S.doc.fps); if (need > S.doc.end) S.doc.end = need; }
    }
    insertLayer(L);
  });
  toast('Imported ' + name, 'ok');
}

// ---------- project save / open ----------
function serialize() { return JSON.stringify({ app: 'Popai Animator', format: 1, saved: new Date().toISOString(), doc: S.doc }); }
function saveProject() {
  download(new Blob([serialize()], { type: 'application/json' }), (S.doc.name || 'project').replace(/[^\w\- ]+/g, '_') + '.popai.json');
  S.dirtyDoc = false; toast('Project saved (includes all media)', 'ok');
}
async function openProjectFile(file) {
  try { if (await loadProjectJSON(await readAsText(file)) !== false) toast('Opened ' + file.name, 'ok'); }
  catch (e) { console.error(e); toast('Could not open project: ' + e.message, 'err'); }
}
async function loadProjectJSON(txt) {
  if (typeof txt !== 'string' || txt.length > 150 * 1024 * 1024) throw new Error('Project exceeds 150 MiB import budget');
  const j = JSON.parse(txt), d = validateProject(j);
  if (d.composition && typeof window !== 'undefined' && window.__popaiValidateComposition) window.__popaiValidateComposition(d.composition);
  if (S.dirtyDoc && !window.confirm("Replace the current unsaved project? Save it first if needed.")) return false;
  if (!d.layers || !d.camera) throw new Error('not a Popai Animator project');
  const fresh = newDoc(); for (const k in fresh) if (d[k] === undefined) d[k] = fresh[k];
  stopPlay && S.playing && stopPlay();
  documentEpoch++; invalidateScene(); S.doc = d; S.dirtyDoc = false; S.mode = "animate"; S.swPreview = {}; aiPending = null; S.media = {}; S.frame = 0; S.selLayers = []; S.selPts = new Set(); S.selKeys = new Set(); S.selBone = null; S.camSel = false;
  H.undo = []; H.redo = []; H.pending = null; updateModeUI();
  await Promise.all(Object.entries(d.media || {}).map(([id, m]) => loadMedia(id, m)));
  const missing = allLayers().filter((L) => L.media && (L.type === 'image' ? !S.media[L.media]?.el : L.type === 'audio' ? !S.media[L.media]?.buffer : false));
  if (missing.length) toast(missing.length + ' layer(s) have missing media — re-import to relink', 'err');
  closeModal(null); updateTitle(); renderTLBar(); fitView(); refreshAll();
}
function autosave() {
  if (!S.dirtyDoc || !S.doc) return;
  if (lsSet('popai.autosave', serialize())) { lsSet('popai.autosave.t', new Date().toLocaleString()); S.dirtyDoc = false; return; }
  // too big for browser storage (media) — keep at least the animation data
  const media = S.doc.media; S.doc.media = {}; if (lsSet('popai.autosave', serialize())) lsSet('popai.autosave.t', new Date().toLocaleString() + ' (without media)'); S.doc.media = media;
}

// ---------- export ----------
function renderFrameCanvas(f, scale = 1, transparent = false) {
  const d = S.doc, c = document.createElement('canvas'); c.width = Math.round(d.w * scale); c.height = Math.round(d.h * scale);
  const x = c.getContext('2d');
  if (!transparent) { x.fillStyle = d.bg; x.fillRect(0, 0, c.width, c.height); }
  renderScene(x, f, M.chain(M.t(c.width / 2, c.height / 2), M.s(scale)), { export: true });
  return c;
}
const canvasBlob = (c, type = 'image/png') => new Promise((r) => c.toBlob(r, type));
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function makeZip(files) { // store-only zip
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, nm.length, true);
    parts.push(h.buffer, nm, f.data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    central.push(c.buffer, nm); off += 30 + nm.length + sz;
  }
  const csz = central.reduce((s, b) => s + (b.byteLength ?? b.length), 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csz, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
}
async function exportDialog() {
  const d = S.doc;
  const r = await modal('Export', `<div class="form">
    <label>Format</label><select name="fmt"><option value="png">PNG — current frame</option><option value="seq">PNG sequence (.zip)</option><option value="webm">WebM video (+ audio)</option><option value="dat">Moho switch data (.dat) — selected switch layer</option><option value="project">Project package (.popai.json)</option></select>
    <label>Frame range</label><span><input type="number" name="from" value="1" min="0" style="width:70px"> to <input type="number" name="to" value="${d.end}" min="0" style="width:70px"></span>
    <label>Scale</label><select name="scale"><option value="0.5">50%</option><option value="1" selected>100% (${d.w}×${d.h})</option><option value="2">200%</option></select>
    <label>Transparent</label><label><input type="checkbox" name="transparent"> no background (PNG only)</label></div>
    <div class="note">Export uses the same renderer as the preview, so frames match. Video records in real time (with audio); PNG sequences can be cancelled from the Jobs tab.</div>`,
  [{ label: 'Cancel', value: false }, { label: 'Export', value: true, pri: true }]);
  if (!r || !r.v) return;
  const o = r.data, sc = +o.scale, from = Math.max(0, o.from | 0), to = Math.max(from, o.to | 0), base = (d.name || 'render').replace(/[^\w\- ]+/g, '_');
  if (o.fmt === 'png') { const b = await canvasBlob(renderFrameCanvas(S.frame, sc, o.transparent)); download(b, `${base}_${String(S.frame).padStart(4, '0')}.png`); return; }
  if (o.fmt === 'dat') return exportDat();
  if (o.fmt === 'project') return saveProject();
  setTab('jobs');
  if (o.fmt === 'seq') runJob(`PNG sequence ${from}–${to}`, 'local render', async (job, tick) => {
    const files = [];
    for (let f = from; f <= to; f++) {
      if (job.cancel) return;
      const b = await canvasBlob(renderFrameCanvas(f, sc, o.transparent));
      files.push({ name: `${base}_${String(f).padStart(4, '0')}.png`, data: new Uint8Array(await b.arrayBuffer()) });
      tick((f - from + 1) / (to - from + 1), `Rendered frame ${f}`);
      if (f % 4 === 0) await sleep(0);
    }
    if (files.length !== to - from + 1) throw new Error('missing frames');
    download(makeZip(files), `${base}_png.zip`);
    return { msg: `${files.length} frames written to ${base}_png.zip` };
  });
  if (o.fmt === 'webm') runJob(`WebM video ${from}–${to}`, 'local render (real time)', async (job, tick) => {
    if (!window.MediaRecorder) throw new Error('This browser cannot record video');
    const c = document.createElement('canvas'); c.width = Math.round(d.w * sc); c.height = Math.round(d.h * sc);
    const x = c.getContext('2d'), stream = c.captureStream(0), track = stream.getVideoTracks()[0];
    const ac = audioCtx(), dest = ac.createMediaStreamDestination();
    const hasAudio = audioLayers().length > 0;
    if (hasAudio) dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8e6 }), chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((r) => (rec.onstop = r));
    const view = M.chain(M.t(c.width / 2, c.height / 2), M.s(sc));
    const draw = (f) => { x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = d.bg; x.fillRect(0, 0, c.width, c.height); renderScene(x, f, view, { export: true }); track.requestFrame && track.requestFrame(); };
    draw(from); rec.start();
    const t0 = hasAudio ? startAudio(from, dest) : performance.now() / 1000, clock = hasAudio ? () => ac.currentTime : () => performance.now() / 1000;
    for (let f = from; f <= to; f++) {
      if (job.cancel) break;
      while (clock() - t0 < (f - from) / d.fps) await sleep(2);
      draw(f); tick((f - from + 1) / (to - from + 1), `Recording frame ${f}`);
    }
    await sleep(1000 / d.fps); stopAudio(); rec.stop(); await done;
    if (job.cancel) return;
    download(new Blob(chunks, { type: 'video/webm' }), `${base}.webm`);
    return { msg: `Video saved: ${base}.webm` };
  });
}
function exportGpl() {
  const lines = ['GIMP Palette', 'Name: ' + S.doc.name, '#', ...S.doc.palette.map((c) => { const [r, g, b] = hexToRgb(c); return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c}`; })];
  download(new Blob([lines.join('\n')], { type: 'text/plain' }), S.doc.name + '.gpl');
}
function importGpl(txt) {
  const cols = txt.split(/\r?\n/).map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)/)).filter(Boolean).map((m) => rgbToHex(+m[1], +m[2], +m[3]));
  if (!cols.length) return toast('No colors found', 'err');
  edit('Import palette', () => (S.doc.palette = [...new Set([...S.doc.palette, ...cols])]));
}

// ---------- programmatic drawing helpers (templates) ----------
function vShape(L, pts, closed, style, c = 1) {
  const ids = pts.map((p) => addPoint(L, round(p[0]), round(p[1]), p[2] ?? c));
  const path = { id: uid('a'), pts: ids, closed }; L.paths.push(path);
  return addShape(L, [path.id], { fill: '#ffffff', stroke: '#2b2b2b', width: 4, fillOn: true, strokeOn: true, ...style });
}
function vEllipse(L, cx, cy, rx, ry, style) { const p = []; for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 1.105]); } return vShape(L, p, true, style); }
function vRect(L, x, y, w, h, style) { return vShape(L, [[x, y, 0], [x + w, y, 0], [x + w, y + h, 0], [x, y + h, 0]], true, style); }
function mouthKit(name = 'Mouth') {
  const SW = mkLayer('switch', name);
  const lip = { stroke: '#5a2a1e', width: 4 }, dark = { fill: '#5a1f1f', ...lip }, line = { fillOn: false, ...lip };
  const defs = [
    ['rest', (L) => vShape(L, [[-22, 0], [0, 4], [22, 0]], false, line)],
    ['MBP', (L) => vShape(L, [[-20, 0, 0], [20, 0, 0]], false, { ...line, width: 7 })],
    ['AI', (L) => { vEllipse(L, 0, 4, 24, 18, dark); vEllipse(L, 0, 14, 12, 5, { fill: '#e2677a', strokeOn: false }); }],
    ['E', (L) => { vEllipse(L, 0, 2, 26, 9, dark); vRect(L, -18, -5, 36, 5, { fill: '#ffffff', strokeOn: false }); }],
    ['O', (L) => vEllipse(L, 0, 3, 15, 17, dark)],
    ['U', (L) => vEllipse(L, 0, 2, 9, 10, dark)],
    ['FV', (L) => { vEllipse(L, 0, 2, 20, 7, dark); vRect(L, -12, -5, 24, 6, { fill: '#ffffff', strokeOn: false }); }],
    ['L', (L) => { vEllipse(L, 0, 3, 20, 13, dark); vEllipse(L, 0, -2, 8, 5, { fill: '#e2677a', strokeOn: false }); }],
    ['WQ', (L) => vEllipse(L, 0, 2, 7, 8, dark)],
    ['etc', (L) => { vEllipse(L, 0, 2, 19, 9, dark); vRect(L, -12, -4, 24, 4, { fill: '#ffffff', strokeOn: false }); }],
  ];
  for (const [n, fn] of defs) { const L = mkLayer('vector', n); fn(L); SW.children.push(L); }
  SW.p.sw = SW.children[0].id; SW.open = false;
  return SW;
}
function demoProject() {
  const d = newDoc({ name: 'Popai demo — jump & talk', w: 1280, h: 720, fps: 24, end: 96, bg: '#bfe3ff' });
  S.doc = d; S.media = {};
  // background planes (2.5D depth)
  const sky = mkLayer('vector', 'Sky'); vRect(sky, -1400, -800, 2800, 1100, { fill: '#9fd3ff', strokeOn: false }); sky.p.z = -900;
  const sun = mkLayer('vector', 'Sun'); vEllipse(sun, 0, 0, 60, 60, { fill: '#ffe066', strokeOn: false }); sun.p.x = 420; sun.p.y = -220; sun.p.z = -700;
  sun.fx.push({ id: uid('fx'), type: 'glow', on: true, p: { ...fxDefaults('glow'), color: '#fff3a8', radius: 40, intensity: 1.2 } });
  const hills = mkLayer('vector', 'Hills'); vShape(hills, [[-1300, 260], [-800, 60], [-300, 220], [200, 40], [700, 210], [1300, 80], [1300, 600, 0], [-1300, 600, 0]], true, { fill: '#7cc576', stroke: '#4f8f4a', width: 3 }); hills.p.z = -350;
  const ground = mkLayer('vector', 'Ground'); vRect(ground, -1000, 250, 2000, 400, { fill: '#c9a46a', stroke: '#8d6b3c', width: 3 });
  // character rig
  const rig = mkLayer('bone', 'Popo (rig)'); rig.p.y = 40;
  const B = (name, parent, x, y, a, len) => { const b = { id: uid('b'), name, parent, x, y, a, len, s: 1 }; rig.bones.push(b); return b; };
  const root = B('Body', null, 0, 190, -90, 230), head = B('Head', root.id, 230, 0, 0, 100);
  const armA = B('Arm upper', root.id, 195, 55, 110, 70), armB = B('Arm lower', armA.id, 70, 0, -20, 65);
  const legs = mkLayer('vector', 'Legs'); vShape(legs, [[-30, 140], [-36, 210]], false, { fillOn: false, stroke: '#2b2b2b', width: 14 }); vShape(legs, [[30, 140], [36, 210]], false, { fillOn: false, stroke: '#2b2b2b', width: 14 }); legs.bindBone = root.id;
  const body = mkLayer('vector', 'Body'); vEllipse(body, 0, 70, 78, 95, { fill: '#ff8a3d', stroke: '#2b2b2b', width: 5 }); body.bindBone = root.id;
  const arm = mkLayer('vector', 'Arm'); vShape(arm, [[55, -5], [121, 19], [186, 19]], false, { fillOn: false, stroke: '#e0702a', width: 18 });
  const headL = mkLayer('vector', 'Head'); vEllipse(headL, 0, -120, 74, 70, { fill: '#ffd7b5', stroke: '#2b2b2b', width: 5 }); vEllipse(headL, -26, -138, 9, 12, { fill: '#2b2b2b', strokeOn: false }); vEllipse(headL, 26, -138, 9, 12, { fill: '#2b2b2b', strokeOn: false }); headL.bindBone = head.id;
  const mouth = mouthKit('Mouth'); mouth.p.y = -92; mouth.bindBone = head.id;
  rig.children = [mouth, headL, arm, body, legs];
  sortBones(rig);
  autoBindPoints(arm, rig, Object.keys(arm.pts));
  // wave the arm (bone keys)
  const kA = (b, f, a) => { const p = 'bone:' + b.id + ':a'; if (!rig.ch[p]) rig.ch[p] = { keys: [] }; setKey(rig.ch[p], f, a, 'smooth'); };
  kA(armA, 0, 110); kA(armA, 8, 30); kA(armA, 16, 20); kA(armA, 24, 30); kA(armA, 32, 110);
  kA(armB, 0, -20); kA(armB, 8, -50); kA(armB, 16, 25); kA(armB, 24, -50); kA(armB, 32, -20);
  kA(head, 0, 0); kA(head, 12, 8); kA(head, 24, -6); kA(head, 36, 0);
  // talking mouth keys
  const ids = Object.fromEntries(mouth.children.map((c) => [c.name, c.id]));
  mouth.ch.sw = { keys: [] };
  [[0, 'rest'], [4, 'MBP'], [6, 'AI'], [9, 'E'], [12, 'O'], [15, 'L'], [17, 'AI'], [20, 'etc'], [23, 'U'], [26, 'MBP'], [28, 'rest']].forEach(([f, n]) => setKey(mouth.ch.sw, f, ids[n], 'step'));
  // jump at 40 with squash & stretch + trail + dust + camera shake (same recipe the AI assistant builds)
  const title = mkLayer('text', 'Title'); title.text = 'Popai Animator'; title.size = 64; title.p.y = -270; title.p.color = '#1d3557';
  title.fx.push({ id: uid('fx'), type: 'shadow', on: true, p: { ...fxDefaults('shadow'), dx: 4, dy: 5, softness: 4, opacity: 0.35 } });
  title.ch.opacity = { keys: [{ f: 0, v: 0, i: 'ease' }, { f: 14, v: 1, i: 'smooth' }] };
  d.layers = [title, rig, ground, hills, sun, sky];
  S.selLayers = [rig.id];
  const saveF = S.frame;
  applyCmd({ op: 'jump', target: rig.id, start: 40, dur: 18, height: 190 });
  applyCmd({ op: 'trail', target: rig.id, glow: false });
  rig.fx[rig.fx.length - 1].p = { samples: 4, spacing: 2, decay: 0.45 };
  applyCmd({ op: 'camshake', start: 58, dur: 10, amp: 16 });
  applyCmd({ op: 'particles', preset: 'Dust', target: rig.id, start: 58 });
  // gentle camera push in
  d.camera.ch.zoom = { keys: [{ f: 0, v: 1, i: 'ease' }, { f: 96, v: 1.12, i: 'ease' }] };
  d.camera.ch.x = { keys: [{ f: 0, v: -40, i: 'ease' }, { f: 96, v: 40, i: 'ease' }] };
  d.markers = [{ id: uid('m'), f: 40, name: 'Jump', color: '#4dabf7' }, { id: uid('m'), f: 58, name: 'Land', color: '#ff8a3d' }];
  S.frame = saveF;
  return d;
}
