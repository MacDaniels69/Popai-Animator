/* ===================== Popai Animator — AI assistant (structured commands), lip sync, jobs ===================== */

// ---------- job system ----------
const Jobs = { list: [] };
function runJob(name, kind, fn) {
  const job = { id: uid('j'), name, kind, status: 'running', progress: 0, msg: 'Starting…', cancel: false, t0: Date.now() };
  Jobs.list.unshift(job); updateJobBadge(); if (currentTab === 'jobs') refreshAll();
  const tick = (p, msg) => { job.progress = clamp(p, 0, 1); if (msg) job.msg = msg; if (currentTab === 'jobs') renderJobs(); };
  Promise.resolve().then(() => fn(job, tick)).then((r) => {
    if (job.cancel) { job.status = 'cancelled'; job.msg = kind.includes('render') || kind.includes('recording') ? 'Cancelled — completed download parts may remain' : 'Cancelled — project unchanged'; }
    else { job.status = 'done'; job.progress = 1; job.msg = (r && r.msg) || 'Done'; }
  }).catch((e) => { console.error(e); job.status = 'failed'; job.msg = e.message || String(e); toast(name + ' failed: ' + job.msg, 'err'); })
    .finally(() => { job.t1 = Date.now(); updateJobBadge(); if (currentTab === 'jobs') renderJobs(); });
  return job;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function updateJobBadge() { const n = Jobs.list.filter((j) => j.status === 'running').length; $('#jobBadge').textContent = n ? n : ''; }
function renderJobs() {
  const el = $('#tabBody');
  el.innerHTML = sec('Jobs', Jobs.list.length ? Jobs.list.map((j) => `<div class="job ${j.status}"><div style="display:flex;gap:6px;align-items:center"><b style="flex:1">${esc(j.name)}</b><span style="color:var(--dim)">${j.status}</span>${j.status === 'running' ? `<button class="ib sm" data-jc="${j.id}">Cancel</button>` : ''}</div>
    <div class="bar"><i style="width:${Math.round(j.progress * 100)}%"></i></div><div class="note">${esc(j.msg)}${j.t1 ? ` · ${round((j.t1 - j.t0) / 1000, 1)} s` : ''} · ${j.kind}</div></div>`).join('') :
    '<div class="note">Long tasks — lip-sync analysis, image-sequence and video export — run here with progress and cancel. Cancelling never leaves a half-written result in your project.</div>', Jobs.list.some((j) => j.status !== 'running') ? '<button class="ib sm" id="jobsClear">Clear finished</button>' : '', true);
  el.querySelectorAll('[data-jc]').forEach((b) => (b.onclick = () => { const j = Jobs.list.find((x) => x.id === b.dataset.jc); if (j) { j.cancel = true; j.msg = 'Cancelling…'; renderJobs(); } }));
  const c = $('#jobsClear'); if (c) c.onclick = () => { Jobs.list = Jobs.list.filter((j) => j.status === 'running'); renderJobs(); };
}

// ---------- assistant: natural language -> validated document commands ----------
const COLORS = { red: '#e63946', orange: '#ff8a3d', yellow: '#ffd166', gold: '#f4c542', green: '#5ccf8a', blue: '#3a86ff', cyan: '#3bc9db', teal: '#20a39e', purple: '#9b5de5', violet: '#9b5de5', pink: '#ff8fb1', white: '#ffffff', black: '#111111', brown: '#8d5a3b', grey: '#8a8a8a', gray: '#8a8a8a', fire: '#ff6a00', electric: '#7df9ff' };
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twice: 2, once: 1, thrice: 3, half: 0.5 };
const AI_SUGGEST = ['make it jump at frame 12, leave a glowing trail, shake the camera on landing and add dust', 'fade in over 12 frames', 'move this layer left 200 over 24 frames', 'spin twice over 48 frames', 'add a blue glow', 'push the camera in to 140% over 36 frames', 'make these keys linear', 'duplicate this 3 times', 'make it bounce 3 times', 'add sparks at frame 20'];

function aiNum(s, re, def) { const m = s.match(re); if (!m) return def; const t = m[1]; return isNaN(+t) ? NUMW[t] ?? def : +t; }
function aiColor(s) { for (const k in COLORS) if (new RegExp('\\b' + k + '\\b').test(s)) return COLORS[k]; const m = s.match(/#[0-9a-f]{6}/i); return m ? m[0] : null; }
function aiFindLayer(s) {
  let best = null;
  for (const L of allLayers()) { const n = L.name.toLowerCase(); if (n.length >= 2 && nameMentioned(s,n) && (!best || n.length > best.name.length)) best = L; }
  return best;
}
function parseAI(text) {
  const out = { cmds: [], notes: [] };
  const fps = S.doc.fps, ctx = { landing: null };
  const clauses = text.toLowerCase().replace(/[.!?]+$/, '').split(/\s*(?:,(?!\s*-?\d+\s*\))|;|\bthen\b|\band also\b|\band\b)\s*/).filter((c) => c.trim());
  let lastTarget = null;
  const NUM = '(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twice|once|thrice)';
  for (const c of clauses) {
    const named = aiFindLayer(c);
    const targets = named ? [named.id] : lastTarget ? lastTarget : S.selLayers.slice();
    const at = aiNum(c, /(?:at|on|from) frame (\d+)/, null) ?? aiNum(c, /\bat (\d+)\b/, null);
    let dur = aiNum(c, new RegExp('(?:over|in|for|within) ' + NUM + ' frames?'), null);
    const secs = aiNum(c, new RegExp('(?:over|in|for|within) ' + NUM + ' (?:seconds?|secs?|s)\\b'), null);
    if (secs !== null) dur = Math.round(secs * fps);
    const onLanding = /land|impact|hit/.test(c) && ctx.landing !== null;
    const isEvent = /shake|dust|smoke|sparks?|impact|puff/.test(c) && ctx.landing !== null; // follow-up effects attach to the last landing
    const start = at ?? (onLanding || isEvent ? ctx.landing : S.frame);
    const need = (op) => { if (!targets.length) { out.notes.push(`“${c}” — select a layer (or name one) for ${op}.`); return false; } return true; };
    const add = (cmd) => { out.cmds.push(cmd); };
    lastTarget = named ? [named.id] : lastTarget;
    let m;
    if (/lip ?sync|viseme|mouth sync/.test(c)) { add({ op: 'lipsync', desc: 'Open lip-sync setup' }); continue; }
    // switch groups: choose an alternative by name ("show O at frame 10", "set the hand to fist")
    const tL = targets.length === 1 ? findLayer(targets[0]) : null;
    const SWt = tL && (tL.type === 'switch' ? tL : (parentOf(tL.id) || {}).type === 'switch' ? parentOf(tL.id) : null);
    if (SWt) {
      const alt = SWt.children.filter((ch) => new RegExp('\\b' + ch.name.toLowerCase().replace(/[^a-z0-9 ]/g, '') + '\\b').test(c)).sort((a, b) => b.name.length - a.name.length)[0];
      if (alt && /(show|set|switch|use|make|change|pick|to)\b/.test(c)) { add({ op: 'swset', target: SWt.id, child: alt.id, start, desc: `Set “${SWt.name}” to “${alt.name}” at frame ${start}` }); continue; }
    }
    if (/\b(angry|happy|sad|surprised|scared|shocked|smile|smiling|frown|cry|crying|expression|mood)\b/.test(c)) {
      const word = c.match(/\b(angry|happy|sad|surprised|scared|shocked|smile|smiling|frown|cry|crying)\b/);
      const sws = (tL && isContainer(tL) ? [tL, ...allLayersIn(tL)] : tL ? [tL] : []).filter((l) => l.type === 'switch');
      const hits = word ? sws.map((sw) => ({ sw, alt: sw.children.find((ch) => ch.name.toLowerCase().includes(word[1].replace(/ing$/, ''))) })).filter((x) => x.alt) : [];
      hits.forEach(({ sw, alt }) => add({ op: 'swset', target: sw.id, child: alt.id, start, desc: `Set “${sw.name}” to “${alt.name}”` }));
      out.notes.push(`An expression usually involves several parts — brows, eyes, mouth and head. ${hits.length ? 'I only changed the switch drawings named for it in your selection.' : 'Nothing in your selection has a drawing named for it.'} Select the head group (or those parts) and name the drawings to use; I won't change unrelated layers on my own.`);
      continue;
    }
    if (tL && tL.type === 'particle' && (m = c.match(/\b(dust|smoke|sparks?|fire|snow|rain|magic)\b/)) && !/\badd\b/.test(c)) {
      const key = { dust: 'Dust', smoke: 'Smoke', spark: 'Sparks', sparks: 'Sparks', fire: 'Fire', snow: 'Snow', rain: 'Rain', magic: 'Magic' }[m[1]];
      add({ op: 'ppreset', target: tL.id, preset: key, desc: `Change “${tL.name}” to the ${key} preset` }); continue;
    }
    if (/\bjump/.test(c)) {
      if (!need('jump')) continue;
      const h = aiNum(c, /(\d+)\s*(?:px|pixels?)?\s*(?:high|tall)/, 160), d = dur ?? 16;
      for (const t of targets) add({ op: 'jump', target: t, start, dur: d, height: h, desc: `Jump ${h}px at frame ${start} (${d} frames, squash & stretch)` });
      ctx.landing = start + d; continue;
    }
    if (/bounce/.test(c)) {
      if (!need('bounce')) continue;
      const n = aiNum(c, new RegExp(NUM + ' times?'), 3), d = dur ?? 12 * n;
      for (const t of targets) add({ op: 'bounce', target: t, start, dur: d, n, height: aiNum(c, /(\d+)\s*(?:px|pixels?)/, 140), desc: `Bounce ${n}× from frame ${start} over ${d} frames` });
      ctx.landing = start + d; continue;
    }
    if (/shake/.test(c) && /camera|screen|cam\b/.test(c) || /camera shake/.test(c)) {
      const amp = aiNum(c, /(?:strength|amount|by) (\d+)/, /big|hard|strong|huge/.test(c) ? 32 : /small|subtle|light|little/.test(c) ? 8 : 18);
      const d = dur ?? 10;
      add({ op: 'camshake', start, dur: d, amp, desc: `Camera shake ${amp}px at frame ${start} decaying over ${d} frames` }); continue;
    }
    if (/camera|cam\b/.test(c) && /dolly/.test(c)) {
      const clean=c.replace(/(?:at|on|from) frame \d+/g,'').replace(/(?:over|in|for|within) \d+(?:\.\d+)? (?:frames?|seconds?|secs?)/g,'');
      let distance=aiNum(clean,/(-?\d+(?:\.\d+)?)/,200);if(/back|out|away/.test(c))distance=-Math.abs(distance);
      add({op:'camdolly',start,dur:dur??36,distance,desc:`Dolly camera ${distance>=0?'forward':'back'} ${Math.abs(distance)} units`});continue;
    }
    if (/camera|cam\b/.test(c) && /pan|tilt|roll|turn/.test(c) && /degrees?|°/.test(c)) {
      const amount=aiNum(c,/(-?\d+(?:\.\d+)?)\s*(?:degrees?|°)/,15),d=dur??24;
      const pan=/pan|turn/.test(c)?(/left/.test(c)?-Math.abs(amount):amount):0,tilt=/tilt/.test(c)?(/down/.test(c)?-Math.abs(amount):amount):0,roll=/roll/.test(c)?(/counter|anticlock/.test(c)?-Math.abs(amount):amount):0;
      add({op:'camturn',start,dur:d,pan,tilt,roll,desc:`Turn camera: pan ${pan}°, tilt ${tilt}°, roll ${roll}°`});continue;
    }
    if (/camera|cam\b/.test(c) && /(zoom|push|pull)/.test(c)) {
      let z = aiNum(c, /(\d+(?:\.\d+)?)\s*%/, null); z = z !== null ? z / 100 : /out|pull|back/.test(c) ? 0.75 : 1.35;
      const d = dur ?? 36;
      add({ op: 'camzoom', start, dur: d, zoom: z, desc: `Camera zoom to ${Math.round(z * 100)}% over ${d} frames from ${start}` }); continue;
    }
    if (/camera|cam\b/.test(c) && /(pan|track|move)/.test(c)) {
      const amt = aiNum(c.replace(/(?:at|on|from) frame \d+/g, '').replace(/(?:over|in|for|within) \d+(?:\.\d+)? (?:frames?|seconds?|secs?)/g, ''), /(\d+(?:\.\d+)?)\b(?!\s*(?:frames?|%|seconds?|secs?|s\b))/, 200), d = dur ?? 36;
      const dx = /left/.test(c) ? -amt : /right/.test(c) ? amt : 0, dy = /\bup\b/.test(c) ? -amt : /down/.test(c) ? amt : 0;
      add({ op: 'campan', start, dur: d, dx, dy, desc: `Camera track (${dx}, ${dy}) over ${d} frames` }); continue;
    }
    if ((m = c.match(/\b(dust|smoke|sparks?|fire|snow|rain|magic|sparkles?)\b/)) && /(add|with|leave|kick|spawn|emit|make|create|puff)/.test(c + ' add')) {
      const key = { dust: 'Dust', smoke: 'Smoke', spark: 'Sparks', sparks: 'Sparks', fire: 'Fire', snow: 'Snow', rain: 'Rain', magic: 'Magic', sparkle: 'Magic', sparkles: 'Magic' }[m[1]];
      add({ op: 'particles', preset: key, target: targets[0] || null, start, desc: `${key} emitter at frame ${start}${targets[0] ? ' at ' + findLayer(targets[0]).name : ''}` }); continue;
    }
    if (/trail|echo|ghost/.test(c)) {
      if (!need('a trail')) continue;
      const glowing = /glow/.test(c); const col = aiColor(c) || '#ffd27a';
      for (const t of targets) add({ op: 'trail', target: t, glow: glowing, color: col, desc: `Motion trail${glowing ? ' + glow' : ''} effect` }); continue;
    }
    const fxWords = { glow: 'glow', bloom: 'glow', blur: 'blur', shadow: 'shadow', outline: 'outline', pixel: 'pixelate', mosaic: 'pixelate', grain: 'noise', noise: 'noise', chromatic: 'chroma', 'directional blur': 'streak', 'motion blur': 'streak' };
    let fxType = null; for (const k in fxWords) if (c.includes(k)) fxType = fxWords[k];
    if (fxType && /(add|give|apply|put|make|with)/.test(c + ' add')) {
      if (!need('an effect')) continue;
      const params = {}; const col = aiColor(c);
      if (col && 'color' in FX[fxType].params) params.color = col;
      if (fxType === 'blur') params.radius = aiNum(c, /(\d+)/, 8);
      for (const t of targets) add({ op: 'fx', target: t, type: fxType, params, desc: `Add ${FX[fxType].label}${col ? ' (' + col + ')' : ''}` }); continue;
    }
    if (/fade/.test(c)) {
      if (!need('fade')) continue;
      const out_ = /out/.test(c), d = dur ?? 12;
      for (const t of targets) add({ op: 'fade', target: t, start, dur: d, out: out_, desc: `Fade ${out_ ? 'out' : 'in'} over ${d} frames from ${start}` }); continue;
    }
    if (/spin|rotate|turn/.test(c)) {
      if (!need('rotate')) continue;
      let deg = aiNum(c, /(-?\d+)\s*(?:°|deg|degrees?)/, null);
      if (deg === null) { const n = aiNum(c, new RegExp(NUM + ' (?:times?|turns?|spins?|full)'), /spin/.test(c) ? 1 : null); deg = n !== null ? n * 360 : 90; }
      if (/counter|anti|left/.test(c)) deg = -Math.abs(deg);
      const d = dur ?? (/spin/.test(c) ? 24 : 0);
      for (const t of targets) add({ op: 'rotate', target: t, start, dur: d, deg, desc: `Rotate ${deg}°${d ? ` over ${d} frames` : ''}` }); continue;
    }
    if (/scale|grow|shrink|bigger|smaller|size/.test(c)) {
      if (!need('scale')) continue;
      let k = aiNum(c, /(\d+(?:\.\d+)?)\s*%/, null); k = k !== null ? k / 100 : aiNum(c, /(?:by|to|x)\s*(\d+(?:\.\d+)?)/, /shrink|smaller/.test(c) ? 0.5 : 1.5);
      const d = dur ?? 0;
      for (const t of targets) add({ op: 'scale', target: t, start, dur: d, k, desc: `Scale to ${Math.round(k * 100)}%${d ? ` over ${d} frames` : ''}` }); continue;
    }
    if (/\b(move|slide|shift|nudge|go)\b/.test(c) && /(left|right|up|down|to )/.test(c)) {
      if (!need('move')) continue;
      const amt = aiNum(c.replace(/(?:at|on|from) frame \d+/g, '').replace(/(?:over|in|for|within) \d+(?:\.\d+)? (?:frames?|seconds?|secs?)/g, ''), /(\d+(?:\.\d+)?)\b(?!\s*(?:frames?|%|seconds?|secs?|s\b))/, /nudge/.test(c) ? 10 : 100);
      let dx = 0, dy = 0;
      if (/left/.test(c)) dx = -amt; if (/right/.test(c)) dx = amt; if (/\bup\b/.test(c)) dy = -amt; if (/down/.test(c)) dy = amt;
      const abs = c.match(/to\s*\(?\s*(-?\d+)\s*,\s*(-?\d+)/);
      const d = dur ?? 0;
      for (const t of targets) add({ op: 'move', target: t, start, dur: d, dx, dy, abs: abs ? [+abs[1], +abs[2]] : null, desc: abs ? `Move to (${abs[1]}, ${abs[2]})` : `Move (${dx}, ${dy})${d ? ` over ${d} frames` : ''}` });
      continue;
    }
    if (/duplicate|copy|clone/.test(c)) {
      if (!need('duplicate')) continue;
      const n = Math.min(50, aiNum(c, new RegExp(NUM + ' (?:times?|copies)'), 1));
      for (const t of targets) add({ op: 'dup', target: t, n, spacing: aiNum(c, /(\d+)\s*(?:px|apart)/, 120), desc: `Duplicate ×${n}, spaced 120px` }); continue;
    }
    if ((m = c.match(/keys? (?:to |)(linear|smooth|step|stepped|hold|ease(?: in| out)?|bounce|elastic)/)) || (m = c.match(/(linear|smooth|stepped|ease in|ease out|eased) keys?/))) {
      const it = { linear: 'linear', smooth: 'smooth', step: 'step', stepped: 'step', hold: 'step', ease: 'ease', eased: 'ease', 'ease in': 'easein', 'ease out': 'easeout', bounce: 'bounce', elastic: 'elastic' }[m[1]];
      add({ op: 'interp', interp: it, targets: S.selKeys.size ? null : targets, desc: `Set ${S.selKeys.size ? S.selKeys.size + ' selected' : 'all'} keys to ${it}` }); continue;
    }
    if (/\b(hide|show)\b/.test(c)) { if (!need('visibility')) continue; for (const t of targets) add({ op: 'vis', target: t, on: /show/.test(c), desc: (/show/.test(c) ? 'Show ' : 'Hide ') + findLayer(t).name }); continue; }
    if ((m = c.match(/rename (?:it |this |layer )?to (.+)/))) { if (!need('rename')) continue; add({ op: 'rename', target: targets[0], name: text.match(/rename (?:it |this |layer )?to (.+?)(?:,|$)/i)[1].trim(), desc: 'Rename to “' + m[1] + '”' }); continue; }
    if (/(clear|remove|delete) (?:all )?(?:the )?(animation|keys)/.test(c)) { if (!need('clear animation')) continue; for (const t of targets) add({ op: 'clear', target: t, desc: 'Clear all animation on ' + findLayer(t).name }); continue; }
    const col = aiColor(c);
    if (col && /(make|color|colour|paint|turn|fill)/.test(c)) { if (!need('recolor')) continue; for (const t of targets) add({ op: 'color', target: t, color: col, desc: `Fill color → ${col}` }); continue; }
    out.notes.push(`I couldn't map “${c}” to a supported command.`);
  }
  return out;
}
// what each layer type can sensibly receive (AI follows the same rules as the toolbar)
const AI_CAN = {
  audio: new Set(['lipsync', 'vis', 'rename']),
  switch: null, group: null, bone: null, vector: null, image: null, text: null,
  particle: new Set(['move', 'fade', 'rotate', 'scale', 'fx', 'trail', 'dup', 'vis', 'rename', 'clear', 'ppreset', 'interp', 'jump', 'bounce']),
};
function validateCmd(cmd) {
  if (!cmd.target) return null;
  const L = findLayer(cmd.target);
  if (!L) return 'target layer no longer exists';
  if (L.lock || ancestors(L.id).some((a) => a.lock)) return `“${L.name}” is locked — skipped`;
  const can = AI_CAN[L.type];
  if (can && !can.has(cmd.op)) return L.type === 'audio' ? `“${L.name}” is audio — it has no picture to ${cmd.op}; try lip sync or change its start frame` : `a ${LAYER_TYPES[L.type].name} layer can't do “${cmd.op}”`;
  if (cmd.op === 'color' && (L.type === 'image' || L.type === 'particle')) return `recolouring needs vector shapes or text — “${L.name}” is ${LAYER_TYPES[L.type].name.toLowerCase()}`;
  if (cmd.op === 'ppreset' && L.type !== 'particle') return 'presets apply to particle layers';
  return null;
}
function allLayersIn(G) { const a = []; walk(G.children || [], (x) => { a.push(x); }); return a; }
function aiSuggestions() {
  const L = selLayer();
  if (S.camSel) return ['zoom the camera to 140% over 36 frames', 'dolly the camera forward 300 over 48 frames', 'pan the camera right 15 degrees over 24 frames', 'shake the camera at frame 20'];
  if (!L) return ['add snow', 'push the camera in to 130% over 48 frames', 'shake the camera at frame 30'];
  const P = parentOf(L.id);
  switch (L.type) {
    case 'switch': return ['lip sync', ...L.children.slice(0, 3).map((c) => `show ${c.name} at frame ${S.frame + 6}`), 'make him angry'];
    case 'bone': return ['make it jump at frame 12, leave a glowing trail, shake the camera on landing and add dust', 'move it right 300 over 48 frames', 'make it bounce 3 times', 'add dust at frame 20'];
    case 'audio': return ['lip sync'];
    case 'particle': return ['make it fire', 'make it smoke', 'fade out over 24 frames'];
    case 'image': return ['add a drop shadow', 'fade in over 12 frames', 'add a blur', 'spin twice over 48 frames'];
    case 'text': return ['fade in over 12 frames', 'make it gold', 'add an outline', 'make it bounce 2 times'];
    case 'group': return ['fade in over 12 frames', 'add a soft shadow', 'move it left 200 over 24 frames', 'duplicate this 3 times'];
    default: return [...(P && P.type === 'switch' ? [`show ${L.name} at frame ${S.frame}`] : []), 'make it red', 'add a blue glow', 'fade in over 12 frames', 'make it bounce 3 times', 'spin twice over 48 frames'];
  }
}
function bottomCenterWorld(L, f) {
  const lc = evalLC(L, f); let pts = [];
  const gather = (A, m) => { if (A.type === 'vector') { const P = deformedPts(A, f, null); for (const k in P) pts.push(M.ap(m, P[k][0], P[k][1])); } if (A.type === 'image') [[-1, 1], [1, 1]].forEach(([x, y]) => pts.push(M.ap(m, (x * A.iw) / 2, (y * A.ih) / 2))); if (A.children) A.children.forEach((c) => gather(c, M.mul(m, layerLocalM(c, f)))); };
  gather(L, lc.world);
  if (!pts.length) return M.ap(lc.world, 0, 0);
  const ys = pts.map((p) => p[1]), xs = pts.map((p) => p[0]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...ys)];
}
function keyPair(o, path, f0, v0, f1, v1, i0) {
  setVal(o, path, v0, f0, true); if (i0) { const k = keyAt(o, path, f0); if (k) k.i = i0; }
  setVal(o, path, v1, f1, true);
}
function applyCmd(cmd) {
  const L = cmd.target ? findLayer(cmd.target) : null, f = cmd.start ?? S.frame, cam = S.doc.camera;
  switch (cmd.op) {
    case 'jump': {
      const y0 = val(L, 'y', f), d = cmd.dur, h = cmd.height, apex = f + Math.round(d / 2), land = f + d;
      setVal(L, 'y', y0, f, true); keyAt(L, 'y', f).i = 'easeout';
      setVal(L, 'y', y0 - h, apex, true); keyAt(L, 'y', apex).i = 'easein';
      setVal(L, 'y', y0, land, true); keyAt(L, 'y', land).i = 'linear';
      const sy0 = val(L, 'sy', f), sx0 = val(L, 'sx', f);
      for (const [ff, k] of [[f - 3, 1], [f, 0.82], [f + 2, 1.14], [apex, 1], [land, 0.78], [land + 4, 1]]) { if (ff < 0) continue; setVal(L, 'sy', round(sy0 * k, 3), ff, true); setVal(L, 'sx', round(sx0 * (2 - k), 3), ff, true); }
      return `jump keys on ${L.name}`;
    }
    case 'bounce': {
      const y0 = val(L, 'y', f), seg = cmd.dur / cmd.n;
      for (let i = 0; i < cmd.n; i++) {
        const s = f + Math.round(i * seg), a = f + Math.round((i + 0.5) * seg), e = f + Math.round((i + 1) * seg), hh = cmd.height * Math.pow(0.6, i);
        setVal(L, 'y', y0, s, true); keyAt(L, 'y', s).i = 'easeout'; setVal(L, 'y', y0 - hh, a, true); keyAt(L, 'y', a).i = 'easein'; setVal(L, 'y', y0, e, true);
      }
      return 'bounce keys';
    }
    case 'camshake': {
      const s = Math.max(0, f - 1);
      if (s < f) { setVal(cam, 'shake', 0, s, true); keyAt(cam, 'shake', s).i = 'linear'; }
      setVal(cam, 'shake', cmd.amp, f, true); keyAt(cam, 'shake', f).i = 'easeout';
      setVal(cam, 'shake', 0, f + cmd.dur, true);
      return 'camera shake keys';
    }
    case 'camzoom': { const z0 = val(cam, 'zoom', f); keyPair(cam, 'zoom', f, z0, f + cmd.dur, round(cmd.zoom, 3), 'ease'); return 'camera zoom keys'; }
    case 'campan': { const x0 = val(cam, 'x', f), y0 = val(cam, 'y', f); keyPair(cam, 'x', f, x0, f + cmd.dur, x0 + cmd.dx, 'ease'); keyPair(cam, 'y', f, y0, f + cmd.dur, y0 + cmd.dy, 'ease'); return 'camera track keys'; }
    case 'camdolly': { const state=cameraStateAt(f);for(const [i,k]of ['x','y','z'].entries()){const start=val(cam,k,f);keyPair(cam,k,f,start,f+cmd.dur,start+state.forward[i]*cmd.distance,'ease');}return 'camera dolly keys'; }
    case 'camturn': { for(const k of ['pan','tilt','roll'])if(cmd[k]){const start=val(cam,k,f);keyPair(cam,k,f,start,f+cmd.dur,clamp(start+cmd[k],...CAMERA_LIMITS[k]),'ease');}return 'camera rotation keys'; }
    case 'particles': {
      const P = mkLayer('particle', cmd.preset + (L ? ' · ' + L.name : ''));
      applyParticlePreset(P, cmd.preset);
      const pos = L ? bottomCenterWorld(L, f) : [0, 0];
      if (cmd.preset === 'Snow' || cmd.preset === 'Rain') { P.p.x = 0; P.p.y = -S.doc.h / 2 - 40; } else { P.p.x = round(pos[0]); P.p.y = round(pos[1]); }
      P.startF = f; if (P.mode === 'continuous' && cmd.preset !== 'Snow' && cmd.preset !== 'Rain' && cmd.preset !== 'Fire' && cmd.preset !== 'Smoke') P.endF = f + 24;
      S.doc.layers.unshift(P);
      return P.name + ' layer (editable emitter)';
    }
    case 'trail': {
      L.fx.push({ id: uid('fx'), type: 'trail', on: true, p: { ...fxDefaults('trail') } });
      if (cmd.glow) L.fx.push({ id: uid('fx'), type: 'glow', on: true, p: { ...fxDefaults('glow'), color: cmd.color, radius: 14, intensity: 1.2 } });
      return 'trail effect';
    }
    case 'fx': L.fx.push({ id: uid('fx'), type: cmd.type, on: true, p: { ...fxDefaults(cmd.type), ...cmd.params } }); return FX[cmd.type].label;
    case 'fade': {
      const end = f + cmd.dur;
      if (cmd.out) keyPair(L, 'opacity', f, val(L, 'opacity', f), end, 0, 'ease');
      else { const o1 = val(L, 'opacity', end) || 1; keyPair(L, 'opacity', f, 0, end, o1 > 0 ? o1 : 1, 'ease'); }
      return 'opacity keys';
    }
    case 'rotate': { const r0 = val(L, 'rot', f); if (cmd.dur) keyPair(L, 'rot', f, r0, f + cmd.dur, r0 + cmd.deg, cmd.deg % 360 === 0 ? 'linear' : 'ease'); else setVal(L, 'rot', r0 + cmd.deg, f); return 'rotation'; }
    case 'scale': {
      const a = val(L, 'sx', f), b = val(L, 'sy', f);
      if (cmd.dur) { keyPair(L, 'sx', f, a, f + cmd.dur, round(a * cmd.k, 3), 'ease'); keyPair(L, 'sy', f, b, f + cmd.dur, round(b * cmd.k, 3), 'ease'); }
      else { setVal(L, 'sx', round(a * cmd.k, 3), f); setVal(L, 'sy', round(b * cmd.k, 3), f); }
      return 'scale';
    }
    case 'move': {
      const x0 = val(L, 'x', f), y0 = val(L, 'y', f), x1 = cmd.abs ? cmd.abs[0] : x0 + cmd.dx, y1 = cmd.abs ? cmd.abs[1] : y0 + cmd.dy;
      if (cmd.dur) { keyPair(L, 'x', f, x0, f + cmd.dur, x1, 'ease'); keyPair(L, 'y', f, y0, f + cmd.dur, y1, 'ease'); }
      else { setVal(L, 'x', x1, f); setVal(L, 'y', y1, f); }
      return 'position';
    }
    case 'dup': {
      const sib = siblingsOf(L.id); let idx = sib.indexOf(L);
      for (let i = 1; i <= cmd.n; i++) { const c = cloneLayer(L); c.name = L.name + ' ' + (i + 1); c.p.x = (c.p.x || 0) + cmd.spacing * i; if (c.ch.x) c.ch.x.keys.forEach((k) => (k.v += cmd.spacing * i)); sib.splice(idx, 0, c); }
      return cmd.n + ' copies';
    }
    case 'interp': {
      if (!cmd.targets) { for (const k of S.selKeys) { const q = parseKid(k), key = q.o && keyAt(q.o, q.path, q.f); if (key) key.i = cmd.interp; } return 'selected keys'; }
      let n = 0; for (const t of cmd.targets) { const T = findLayer(t); if (T) for (const p in T.ch) T.ch[p].keys.forEach((k) => { k.i = cmd.interp; n++; }); }
      return n + ' keys';
    }
    case 'vis': setVal(L, 'visible', cmd.on, f, true); return 'visibility key';
    case 'swset': { const c = L.children.find((x) => x.id === cmd.child); setVal(L, 'sw', cmd.child, f, true); return `${L.name} → ${c ? c.name : '?'}`; }
    case 'ppreset': applyParticlePreset(L, cmd.preset); return cmd.preset + ' preset';
    case 'rename': L.name = cmd.name; return 'name';
    case 'clear': for (const p of Object.keys(L.ch)) { const v = val(L, p, 0); baseSet(L, p, v); delete L.ch[p]; } return 'animation cleared';
    case 'color': {
      const apply = (A) => { if (A.shapes) for (const sh of A.shapes) { if (!sh.styleId) { setVal(A, 'sh:' + sh.id + ':fill', cmd.color); sh.fillOn = true; } } if (A.type === 'text') setVal(A, 'color', cmd.color); if (A.children) A.children.forEach(apply); };
      apply(L); return 'fill colors';
    }
  }
  throw new Error('unknown op ' + cmd.op);
}
async function aiPlan(text) {
  const cfg = aiConfig();
  if (cfg.useLLM && cfg.url && cfg.model) {
    try { return await llmPlan(text, cfg); } catch (e) { toast('LLM engine failed, used local interpreter: ' + e.message, 'err'); }
  }
  return parseAI(text);
}
function aiConfig() { try { return JSON.parse(lsGet('popai.llm') || '{}'); } catch (e) { return {}; } }
async function llmPlan(text, cfg) {
  const ctx = { frame: S.frame, fps: S.doc.fps, end: S.doc.end, selected: S.selLayers.map((id) => findLayer(id)).filter(Boolean).map((L) => ({ id: L.id, name: L.name, type: L.type })), layers: allLayers().map((L) => ({ id: L.id, name: L.name, type: L.type })) };
  const sys = `You convert animation requests into JSON commands for an animation editor. Reply ONLY with JSON: {"cmds":[...],"notes":[...]}. Allowed ops and fields:
jump{target,start,dur,height} bounce{target,start,dur,n,height} camshake{start,dur,amp} camzoom{start,dur,zoom(absolute scale, 1.4 = 140%)} campan{start,dur,dx,dy}
camdolly{start,dur,distance(positive forward, negative backward)} camturn{start,dur,pan,tilt,roll(angle changes in degrees, unused axes 0)}
particles{preset:Dust|Fire|Smoke|Sparks|Snow|Rain|Magic,target?,start} trail{target,glow:boolean,color} fx{target,type:${Object.keys(FX).join('|')},params}
fade{target,start,dur,out:boolean} rotate{target,start,dur,deg} scale{target,start,dur,k} move{target,start,dur,dx,dy} dup{target,n,spacing}
interp{interp:${INTERPS.map((i) => i[0]).join('|')},targets:[ids]} vis{target,on} rename{target,name} clear{target} color{target,color:"#rrggbb"} lipsync{}
swset{target:switchLayerId,child:childLayerId,start} ppreset{target,preset}
Rules: audio layers only accept lipsync/vis/rename; only act on selected or explicitly named layers; for expressions spanning several parts, add a note instead of changing unselected layers.
Each cmd also needs "desc" (short human description). target = layer id. Use selected layers when unspecified. Frames are integers.`;
  const r = await fetch(cfg.url.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', signal: AbortSignal.timeout(60000), headers: { 'Content-Type': 'application/json', ...(cfg.key ? { Authorization: 'Bearer ' + cfg.key } : {}) },
    body: JSON.stringify({ model: cfg.model, temperature: 0, messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify({ request: text, context: ctx }) }] }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json(), content = j.choices[0].message.content, js = content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  const plan = JSON.parse(js); if (!Array.isArray(plan.cmds) || plan.cmds.length > 200) throw new Error('Invalid command plan'); plan.notes = Array.isArray(plan.notes) ? plan.notes.filter(n => typeof n === 'string').slice(0, 50) : []; plan.engine = cfg.model;
  return plan;
}
let aiPending = null, aiImmediate = false;
function renderAI() {
  const el = $('#tabBody'), log = S.doc.ai.log, cfg = aiConfig();
  const scope = S.selLayers.map((id) => findLayer(id)).filter(Boolean);
  el.innerHTML = `<div class="note" style="margin-top:0">Engine: <b>${cfg.useLLM && cfg.model ? esc(cfg.model) + ' (your endpoint)' : 'Local interpreter'}</b> · ${cfg.useLLM && cfg.url && cfg.model ? 'sends requests and layer names/IDs to your configured endpoint; no artwork' : 'local command parser; no network requests'}. Requests become ordinary, editable keys, effects and emitters — one Undo reverts each.</div>
    <div class="ai-log">${log.map((m, i) => `<div class="ai-msg ${m.who}">${m.who === 'user' ? esc(m.text) : m.html}${m.who === 'bot' && m.pending && aiPending && aiPending.i === i ? `<div class="btnrow"><button class="btn pri" id="aiApply">Apply</button><button class="btn" id="aiDiscard">Discard</button></div>` : ''}${m.applied ? `<div class="btnrow"><button class="btn" data-aiundo="${i}">Revert</button></div>` : ''}</div>`).join('') || `<div class="note">Try one of these — select a layer first so I know what “it” means:</div>`}</div>
    <div class="ai-input"><div class="chips"><span class="chip">Scope: <b>${scope.length ? esc(scope.map((l) => l.name).join(', ')) : 'nothing selected'}</b></span><span class="chip">Frame <b>${S.frame}</b></span>${[...S.selKeys].length ? `<span class="chip"><b>${S.selKeys.size}</b> keys</span>` : ''}</div>
      <textarea id="aiText" placeholder="e.g. make it jump at frame 12, leave a glowing trail, shake the camera on landing and add dust"></textarea>
      <div style="display:flex;gap:6px;align-items:center"><button class="btn pri" id="aiGo">Send ⏎</button><label style="color:var(--dim)"><input type="checkbox" id="aiImm" ${aiImmediate ? 'checked' : ''}> apply immediately</label><span style="margin-left:auto"></span><button class="ib sm" id="aiCfg" title="Engine settings">⚙</button>${log.length ? '<button class="ib sm" id="aiClear" title="Clear conversation">🧹</button>' : ''}</div>
      <div class="sugg">${aiSuggestions().map((s) => `<button>${esc(s)}</button>`).join('')}</div></div>`;
  const ta = $('#aiText');
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiSend(ta.value); } e.stopPropagation(); };
  $('#aiGo').onclick = () => aiSend(ta.value);
  $('#aiImm').onchange = (e) => (aiImmediate = e.target.checked);
  $$('.sugg button', el).forEach((b) => (b.onclick = () => { ta.value = b.textContent; ta.focus(); }));
  const ap = $('#aiApply'); if (ap) ap.onclick = aiApplyPending;
  const dc = $('#aiDiscard'); if (dc) dc.onclick = () => { const m = S.doc.ai.log[aiPending.i]; m.pending = false; m.html += '<div class="note">Discarded.</div>'; aiPending = null; renderAI(); };
  $('#aiCfg').onclick = aiSettings;
  const cl = $('#aiClear'); if (cl) cl.onclick = () => { S.doc.ai.log = []; aiPending = null; renderAI(); };
  $$('[data-aiundo]', el).forEach((b) => (b.onclick = () => { const m = S.doc.ai.log[+b.dataset.aiundo]; const idx = H.undo.findIndex((u) => u.id === m.undoId); if (idx === H.undo.length - 1) { undo(); m.applied = false; m.html += '<div class="note">Reverted.</div>'; renderAI(); } else toast('Other edits happened after this — use Undo history (Ctrl+Z) to step back', 'err'); }));
  el.scrollTop = el.scrollHeight;
}
async function aiSend(text) {
  const originEpoch = documentEpoch, scope = requestScope(text), signature = sceneSignature();
  text = (text || '').trim(); if (!text) return;
  S.doc.ai.log.push({ who: 'user', text });
  const plan = await aiPlan(text);
  if (documentEpoch !== originEpoch || sceneSignature() !== signature) return toast('The scene changed while planning; send the request again', 'err');
  if (!Array.isArray(plan.cmds) || plan.cmds.length > 200) return toast('Invalid or oversized AI plan', 'err');
  for (const c of plan.cmds) { c._scope = scope; if(c.op === "interp" && !c.targets) c._keys = [...S.selKeys]; }
  const items = plan.cmds.map((c) => { const err = validateCmd(c); return `<li class="${err ? 'err' : ''}">${esc(c.desc || c.op)}${err ? ' — ' + esc(err) : ''}</li>`; }).join('');
  const html = plan.cmds.length ? `Plan (${plan.cmds.length} command${plan.cmds.length > 1 ? 's' : ''}):<ul class="cmds">${items}</ul>${plan.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}<div class="note">Output: editable keyframes / effects / emitters.</div>`
    : `Nothing to do yet.${plan.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}<div class="note">I understand moves, fades, rotation, scale, jumps, bounces, camera shake/zoom/track, effects (glow, blur, shadow, outline, trail…), particles (dust, smoke, sparks, fire, snow, rain, magic), duplicates, key interpolation, colors and lip sync.</div>`;
  S.doc.ai.log.push({ who: 'bot', html, pending: plan.cmds.length > 0 });
  aiPending = plan.cmds.length ? { i: S.doc.ai.log.length - 1, plan, text, originEpoch, signature } : null;
  if (aiPending && (aiImmediate || plan.cmds.every((c) => c.op === 'lipsync'))) return aiApplyPending();
  renderAI();
}
function aiApplyPending() {
  if (!aiPending) return;
  const { plan, text, i, originEpoch, signature } = aiPending; aiPending = null;
  if (originEpoch !== documentEpoch || signature !== sceneSignature()) return toast('The scene changed; generate a fresh plan before applying', 'err');
  const errors = plan.cmds.map(validateCmd).filter(Boolean);
  if (errors.length) return toast(errors.join('; '), 'err');
  const m = S.doc.ai.log[i]; m.pending = false;
  if (plan.cmds.some((c) => c.op === 'lipsync')) { setTimeout(openLipSync, 50); plan.cmds = plan.cmds.filter((c) => c.op !== 'lipsync'); if (!plan.cmds.length) { m.html += '<div class="note">Opened lip-sync setup.</div>'; renderAI(); return; } }
  const results = [];
  const undoLen = H.undo.length;
  const appliedOK = edit('AI: ' + text.slice(0, 40), () => {
    for (const c of plan.cmds) { const err = validateCmd(c); if (err) { results.push('skipped: ' + err); continue; } results.push(applyCmd(c)); }
  });
  if (appliedOK === false) { m.html += '<div class="note">Failed; all changes rolled back.</div>'; renderAI(); return; }
  if (H.undo.length > undoLen) { const u = H.undo[H.undo.length - 1]; u.id = uid('u'); m.undoId = u.id; m.applied = true; }
  m.html += `<div class="note" style="color:var(--good)">Applied: ${esc(results.join(' · '))}. Inspect them in the timeline and Properties.</div>`;
  renderAI();
}
async function aiSettings() {
  const c = aiConfig();
  const r = await modal('AI engine settings', `<div class="note">The built-in <b>local interpreter</b> needs no connection. Optionally connect any <b>OpenAI-compatible</b> chat endpoint (e.g. a local LLM server, or OpenRouter). Requests send your text plus layer names/ids — no artwork. The model can only propose the same validated commands.</div>
    <div class="form"><label>Use endpoint</label><input type="checkbox" name="useLLM" ${c.useLLM ? 'checked' : ''}>
    <label>Base URL</label><input type="text" name="url" value="${esc(c.url || '')}" placeholder="https://openrouter.ai/api/v1">
    <label>API key</label><input type="password" autocomplete="off" name="key" value="${esc(c.key || '')}" placeholder="optional (stored only in this browser)">
    <label>Model</label><input type="text" name="model" value="${esc(c.model || '')}" placeholder="e.g. meta-llama/llama-3.1-8b-instruct"></div>`, [{ label: 'Cancel', value: false }, { label: 'Save', value: true, pri: true }]);
  if (r && r.v) { try { lsSet('popai.llm', JSON.stringify(r.data)); } catch (e) {} renderAI(); }
}

// ---------- lip sync (sound-based: listens to the audio itself, not words — language independent) ----------
const VISEMES = ['rest', 'MBP', 'AI', 'E', 'O', 'U', 'FV', 'L', 'WQ', 'etc'];
const VISEME_FALLBACK = { WQ: ['WQ', 'U', 'O'], U: ['U', 'O', 'WQ'], O: ['O', 'U', 'AI'], E: ['E', 'etc', 'AI'], L: ['L', 'etc', 'E'], FV: ['FV', 'etc', 'MBP'], etc: ['etc', 'E', 'AI'], AI: ['AI', 'O', 'E'], MBP: ['MBP', 'rest'], rest: ['rest', 'MBP'] };
function fftMag(re) { // in-place radix-2 FFT on real input -> magnitude (n/2)
  const n = re.length, im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const m = new Float32Array(n / 2); for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]); return m;
}
async function analyzeSpeech(buffer, fps, opt, job, tick) {
  const sr = buffer.sampleRate, n = buffer.length, chs = buffer.numberOfChannels, mono = new Float32Array(n);
  for (let c = 0; c < chs; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / chs; }
  const frames = Math.ceil((n / sr) * fps), N = 2048, hz = sr / N, feats = [];
  const band = (m, a, b) => { let s = 0; for (let i = Math.floor(a / hz); i <= Math.min(m.length - 1, Math.ceil(b / hz)); i++) s += m[i] * m[i]; return s; };
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  for (let f = 0; f < frames; f++) {
    if (job.cancel) return null;
    const c = Math.floor(((f + 0.5) / fps) * sr), s0 = c - N / 2, buf = new Float32Array(N);
    let rms = 0, zc = 0, prev = 0;
    for (let i = 0; i < N; i++) { const v = mono[s0 + i] || 0; buf[i] = v * win[i]; rms += v * v; if ((v >= 0) !== (prev >= 0)) zc++; prev = v; }
    rms = Math.sqrt(rms / N);
    const m = fftMag(buf);
    // first formant: strongest peak between 250 and 1000 Hz (above the voice pitch)
    let pk = 0, f1Hz = 0; for (let i = Math.floor(250 / hz); i <= Math.ceil(1000 / hz); i++) if (m[i] > pk) { pk = m[i]; f1Hz = i * hz; }
    feats.push({ rms, zcr: zc / N, f1Hz, b1: band(m, 250, 1000), b2: band(m, 1000, 1700), bE: band(m, 1700, 3200), b3: band(m, 2400, 5000), b4: band(m, 5000, 10000) });
    if (f % 40 === 0) { tick(f / frames * 0.85, `Listening… frame ${f}/${frames}`); await sleep(0); }
  }
  const sorted = feats.map((x) => x.rms).sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * 0.95)] || 1e-6;
  const thr = clamp(0.32 - opt.sensitivity * 0.03, 0.03, 0.4);
  let lab = feats.map((x) => {
    const rel = x.rms / p95; if (rel < thr) return 'rest';
    const hi = (x.b3 + x.b4) / (x.b1 + x.b2 + 1e-12), front = x.bE / (x.b1 + x.b2 + x.bE + 1e-12);
    if (hi > 1.4 || (x.zcr > 0.18 && hi > 0.6)) return rel < 0.45 ? 'FV' : 'etc'; // hiss: s, sh, f, v, t, ch
    if (front > 0.35) return rel > 0.4 ? 'E' : 'L';   // strong high second formant: ee / eh
    if (x.f1Hz > 620) return rel > 0.35 ? 'AI' : 'etc'; // open jaw: ah
    if (x.f1Hz > 420) return 'O';                       // mid, rounded: oh
    return rel > 0.45 ? 'U' : 'WQ';                     // closed, rounded: oo / w
  });
  // closures: frame before speech onset becomes MBP; one-frame energy dips inside speech too
  if (opt.closure) {
    for (let i = 1; i < lab.length; i++) if (lab[i] !== 'rest' && lab[i - 1] === 'rest') lab[i - 1] = 'MBP';
    for (let i = 1; i < lab.length - 1; i++) { const a = feats[i - 1].rms, b = feats[i].rms, c = feats[i + 1].rms; if (lab[i] !== 'rest' && b < a * 0.45 && b < c * 0.45) lab[i] = 'MBP'; }
  }
  // median smoothing then minimum hold
  lab = lab.map((v, i) => { const w = [lab[i - 1], v, lab[i + 1]].filter(Boolean); const cnt = {}; w.forEach((x) => (cnt[x] = (cnt[x] || 0) + 1)); return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][1] > 1 ? Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0] : v; });
  const runs = []; for (let i = 0; i < lab.length; i++) { if (runs.length && runs[runs.length - 1].v === lab[i]) runs[runs.length - 1].n++; else runs.push({ f: i, v: lab[i], n: 1 }); }
  const merged = [];
  for (const r of runs) { if (merged.length && r.n < opt.minHold && r.v !== 'MBP') merged[merged.length - 1].n += r.n; else merged.push({ ...r }); }
  tick(0.95, 'Writing keys…');
  return merged.map((r) => ({ f: r.f, v: r.v }));
}
function mouthMapFor(SW) {
  const map = {};
  for (const v of VISEMES) {
    for (const cand of VISEME_FALLBACK[v] || [v]) {
      const c = SW.children.find((ch) => ch.name.toLowerCase().replace(/[^a-z]/g, '') === cand.toLowerCase());
      if (c) { map[v] = c.id; break; }
    }
    if (!map[v]) map[v] = (SW.children[0] || {}).id || '';
  }
  return map;
}
async function openLipSync() {
  const audios = allLayers().filter((L) => L.type === 'audio' && S.media[L.media] && S.media[L.media].buffer);
  const sws = allLayers().filter((L) => L.type === 'switch');
  if (!audios.length) return modal('Lip sync', '<div class="note">Import a WAV or MP3 first (File ▸ Import, or drop it on the stage).</div>', [{ label: 'OK', value: true, pri: true }]);
  if (!sws.length) {
    const r = await modal('Lip sync', '<div class="note">You need a <b>Switch layer</b> holding the mouth drawings. Create a starter mouth set (10 standard mouths you can redraw)?</div>', [{ label: 'Cancel', value: false }, { label: 'Create mouth set', value: true, pri: true }]);
    if (!r || !r.v) return; runCmd('switch.mouthkit'); return openLipSync();
  }
  const sel = selLayer(), aDef = sel && sel.type === 'audio' ? sel.id : audios[0].id, swDef = switchTarget() ? switchTarget().id : sws[0].id;
  const SW0 = findLayer(swDef), map0 = mouthMapFor(SW0);
  const mapRows = (SW, map) => VISEMES.map((v) => `<label>${v}</label><select name="map_${v}">${SW.children.map((c) => `<option value="${c.id}" ${map[v] === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`).join('');
  const body = `<div class="note">Engine: <b>Sound-based (local)</b> — it listens to the sound of the voice (energy, vowel colour, hiss), not to words, so it works the same for <b>Shona, English, or a mix</b>. It is a fast first pass: correct any mouth in the Switch panel afterwards. Your audio is never modified.</div>
    <div class="form"><label>Audio layer</label><select name="audio">${audios.map((a) => `<option value="${a.id}" ${a.id === aDef ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
    <label>Switch (mouth) layer</label><select name="sw" id="lsSw">${sws.map((s) => `<option value="${s.id}" ${s.id === swDef ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <label>Sensitivity</label><input type="range" name="sensitivity" min="0" max="10" value="5">
    <label>Minimum hold (frames)</label><input type="number" name="minHold" value="2" min="1" max="8">
    <label>Anticipation (frames)</label><input type="number" name="lead" value="1" min="0" max="4" title="Mouths lead the sound slightly, which reads as better sync">
    <label>Closure bias</label><label><input type="checkbox" name="closure" checked> close the mouth (MBP) before words</label>
    <label>Replace existing keys</label><label><input type="checkbox" name="replace" checked> in the audio's time range</label></div>
    <h4 style="margin:12px 0 6px">Mouth mapping <span style="color:var(--faint);font-weight:400">— viseme → your drawing (auto-matched by name)</span></h4><div class="form" id="lsMap">${mapRows(SW0, map0)}</div>`;
  setTimeout(() => { const s = $('#lsSw'); if (s) s.onchange = () => { const SW = findLayer(s.value); $('#lsMap').innerHTML = mapRows(SW, mouthMapFor(SW)); }; }, 30);
  const r = await modal('✦ Auto lip sync', body, [{ label: 'Cancel', value: false }, { label: 'Analyze & create keys', value: true, pri: true }]);
  if (!r || !r.v) return;
  const originEpoch = documentEpoch, signature = sceneSignature();
  const o = r.data, A = findLayer(o.audio), SW = findLayer(o.sw), media = S.media[A.media];
  const map = {}; for (const v of VISEMES) map[v] = o['map_' + v];
  setTab('jobs');
  runJob('Lip sync: ' + A.name + ' → ' + SW.name, 'local · sound-based', async (job, tick) => {
    const res = await analyzeSpeech(media.buffer, S.doc.fps, { sensitivity: +o.sensitivity, minHold: Math.max(1, o.minHold | 0), closure: o.closure }, job, tick);
    if (!res || job.cancel) return;
    if (documentEpoch !== originEpoch || sceneSignature() !== signature) throw new Error('Scene changed during analysis; run lip sync again');
    const why = writeReason(findLayer(SW.id)); if (why) throw new Error(why);
    const off = A.offset, lead = o.lead | 0, endF = off + Math.ceil(media.buffer.duration * S.doc.fps);
    edit('Lip sync', () => {
      const L = findLayer(SW.id);
      if (!L.ch.sw) { L.ch.sw = { keys: [] }; if (off > 0) setKey(L.ch.sw, 0, map.rest, 'step'); }
      if (o.replace) L.ch.sw.keys = L.ch.sw.keys.filter((k) => k.f < off - lead || k.f > endF);
      let prev = null;
      for (const k of res) { const id = map[k.v]; if (!id || id === prev) continue; setKey(L.ch.sw, Math.max(0, k.f + off - lead), id, 'step'); prev = id; }
      setKey(L.ch.sw, endF, map.rest, 'step');
      if (!L.ch.sw.keys.length) delete L.ch.sw;
    });
    const n = res.length;
    setTimeout(() => { S.selLayers = [SW.id]; setTab('switch'); toast(`Lip sync: ${n} mouth changes written — scrub to review, click a mouth to fix any frame`, 'ok'); }, 50);
    return { msg: `${n} mouth keys written to “${SW.name}”` };
  });
}
// Moho / Papagayo switch data
function exportDat() {
  const SW = switchTarget(); if (!SW) return toast('Select a Switch layer');
  const keys = (SW.ch.sw ? SW.ch.sw.keys : []).filter((k) => k.f > 0);
  if (!keys.length) return toast('This switch layer has no keys yet', 'err');
  const lines = ['MohoSwitch1', ...keys.map((k) => `${k.f} ${(SW.children.find((c) => c.id === k.v) || { name: 'rest' }).name}`)];
  download(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }), (SW.name || 'switch') + '.dat');
}
function importDatText(txt) {
  const SW = switchTarget(); if (!SW) return toast('Select the Switch layer to receive the .dat keys', 'err');
  const lines = txt.split(/\r?\n/).map((l) => l.trim()).filter(Boolean); if (!/^MohoSwitch1/i.test(lines[0])) return toast('Not a MohoSwitch1 .dat file', 'err');
  let miss = new Set();
  edit('Import .dat', () => {
    if (!SW.ch.sw) SW.ch.sw = { keys: [] };
    for (const l of lines.slice(1)) { const [f, ...nm] = l.split(/\s+/); const name = nm.join(' '); const c = SW.children.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (!c) { miss.add(name); continue; } setKey(SW.ch.sw, +f, c.id, 'step'); }
  });
  toast(miss.size ? `Imported; no drawing named: ${[...miss].join(', ')}` : 'Imported switch keys', miss.size ? 'err' : 'ok');
}
