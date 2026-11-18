"""Stage 1 — record the current (JavaScript) engine's exact output for fixture projects.

Writes:
  fixtures/<name>.popai.json          the fixture projects
  fixtures/golden/<name>.json         per frame and per scenario: every evaluated layer's camera×world matrix,
                                      opacity, deformed points, bone frames, active switch child and particles

The Rust engine must reproduce these numbers (crates/popai-core/tests/compat.rs).
Run:  python3 tests/compat/gen_golden.py   (needs Chrome + playwright)
"""
import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
REF = ROOT / 'legacy-reference.html'
OUT = ROOT / 'fixtures'

BUILD_FEATURES = r"""
() => {
  const T = window.PopaiTest, A = window.PopaiApp;
  const d = T.newDoc({ name: 'Compat features', w: 1280, h: 720, fps: 24, end: 60, bg: '#f4f1ea' });
  A.startDoc(d);
  const S = A.S;
  const key = (o, path, ks) => { o.ch[path] = { keys: ks.map(([f, v, i]) => ({ f, v, i: i || 'smooth' })) }; };
  // every interpolation type on separate layers
  const interps = ['smooth', 'linear', 'ease', 'easein', 'easeout', 'step', 'bounce', 'elastic'];
  const ip = T.mkLayer('group', 'Interpolations'); ip.p.y = -250;
  interps.forEach((it, i) => { const L = T.mkLayer('vector', 'I-' + it); T.vRect(L, -10, -10, 20, 20, { fill: '#3a86ff' }); L.p.y = i * 24 - 90;
    key(L, 'x', [[0, -500, it], [20, 300, it], [40, -200, it], [60, 100, it]]); key(L, 'rot', [[0, 0, it], [30, 270, it]]); ip.children.push(L); });
  // pivot + rotation, colour channels, text colour, keyed effect param, render-excluded layer
  const piv = T.mkLayer('vector', 'Pivot'); T.vRect(piv, 0, 0, 120, 40, { fill: '#e94f37' }); piv.p.ox = 100; piv.p.oy = 20; piv.p.x = 300; piv.p.y = -100;
  key(piv, 'rot', [[0, 0, 'linear'], [60, 360]]); key(piv, 'sx', [[0, 1], [30, 1.6, 'easeout'], [60, 0.7]]);
  const sh = piv.shapes[0]; key(piv, 'sh:' + sh.id + ':fill', [[0, '#e94f37'], [40, '#3a86ff', 'linear']]); key(piv, 'sh:' + sh.id + ':width', [[0, 2], [40, 12]]);
  piv.fx.push({ id: 'fxblur', type: 'blur', on: true, p: { radius: 4 } }); key(piv, 'fx:fxblur:radius', [[0, 0], [30, 12], [60, 2]]);
  const txt = T.mkLayer('text', 'Caption'); txt.text = 'Compat\ntest'; txt.p.y = 280; key(txt, 'color', [[0, '#111111'], [30, '#ff00aa']]); key(txt, 'opacity', [[0, 0], [10, 1]]);
  const hidden = T.mkLayer('vector', 'NoRender'); T.vEllipse(hidden, 0, 0, 30, 30, {}); hidden.render = false; hidden.p.x = -400;
  const img = T.mkLayer('image', 'Missing image'); img.media = 'none'; img.iw = 100; img.ih = 60; img.p.x = 500; img.p.y = 250;
  // masks
  const mg = T.mkLayer('group', 'Masked'); mg.mask = 'bottom'; mg.p.x = -420; mg.p.y = 150;
  const mc = T.mkLayer('vector', 'Mask shape'); T.vEllipse(mc, 0, 0, 70, 70, { fill: '#000' }); const mart = T.mkLayer('vector', 'Masked art'); T.vRect(mart, -100, -30, 200, 60, { fill: '#5ccf8a' });
  key(mart, 'x', [[0, -60], [60, 60]]); mg.children = [mart, mc];
  const ig = T.mkLayer('group', 'Inverted'); ig.mask = 'invert'; ig.p.x = -200; ig.p.y = 150; ig.p.opacity = 0.7;
  const ic = T.mkLayer('vector', 'Hole'); T.vEllipse(ic, 0, 0, 30, 30, {}); const iart = T.mkLayer('vector', 'Plate'); T.vRect(iart, -60, -60, 120, 120, { fill: '#7b4fa0' }); ig.children = [iart, ic];
  // crossfade switch with 3 alternatives
  const sw = T.mkLayer('switch', 'Fader'); sw.swMode = 'crossfade'; sw.swFade = 6; sw.p.x = 420; sw.p.y = 120;
  const a1 = T.mkLayer('vector', 'Square'); T.vRect(a1, -40, -40, 80, 80, { fill: '#f6ae2d' });
  const a2 = T.mkLayer('vector', 'Disc'); T.vEllipse(a2, 0, 0, 45, 45, { fill: '#86bb4a' });
  const a3 = T.mkLayer('vector', 'Bar'); T.vRect(a3, -70, -15, 140, 30, { fill: '#3f88c5' });
  sw.children = [a1, a2, a3]; sw.p.sw = a1.id; sw.ch.sw = { keys: [{ f: 0, v: a1.id, i: 'step' }, { f: 15, v: a2.id, i: 'step' }, { f: 35, v: a3.id, i: 'step' }] };
  // bone group: offsets, vitruvian groups, physics + force, flexible and weighted binding, bound particles
  const rig = T.mkLayer('bone', 'Rig'); rig.p.x = 0; rig.p.y = 120;
  const B = (id, name, parent, x, y, a, len, extra) => { const b = Object.assign({ id, name, parent, x, y, a, len, s: 1 }, extra || {}); rig.bones.push(b); return b; };
  B('b_root', 'Root', null, 0, 0, -90, 120, { str: 60 });
  B('b_up', 'Upper', 'b_root', 120, 0, 40, 90, { str: 45 });
  B('b_lo', 'Lower', 'b_up', 90, 0, 30, 80, { str: 40, dyn: { on: true, spring: 50, damp: 8, inertia: 0.8 } });
  B('b_tail', 'Tail', 'b_root', 0, 0, 180, 100, { dyn: { on: true, spring: 40, damp: 6, inertia: 1, lockTip: true } });
  B('b_offs', 'Offset arm', 'b_root', 60, 30, 90, 70, { ox: 140, oy: -40, str: 30 });
  B('b_va', 'Side arm', 'b_root', 100, -20, 60, 60, { vg: 'A' });
  B('b_vb', 'Front arm', 'b_root', 100, 20, 120, 60, { vg: 'B' });
  rig.vgroups = ['A', 'B']; rig.ch.vit = { keys: [{ f: 0, v: 'A', i: 'step' }, { f: 25, v: 'B', i: 'step' }] };
  rig.force = { windS: 300, windA: 10, turb: 0.8, gravS: 200, gravA: 90 };
  T.sortBones(rig);
  key(rig, 'bone:b_up:a', [[0, 40], [15, -30], [30, 70], [45, -10], [60, 40]]);
  key(rig, 'bone:b_root:p', [[0, [0, 0]], [30, [80, -40], 'ease'], [60, [0, 0]]]);
  key(rig, 'bone:b_root:s', [[0, 1], [20, 1.3], [40, 0.8], [60, 1]]);
  key(rig, 'x', [[0, -100], [30, 100, 'ease'], [60, -100]]);
  const flex = T.mkLayer('vector', 'Flex blob'); T.vEllipse(flex, 0, -150, 60, 110, { fill: '#ff8fb1' });
  const weighted = T.mkLayer('vector', 'Weighted limb'); T.vShape(weighted, [[0, -120], [60, -180], [120, -230], [180, -260]], false, { fillOn: false, stroke: '#2b2b2b', width: 10 });
  const attached = T.mkLayer('vector', 'Front hand'); T.vEllipse(attached, 0, 0, 15, 15, { fill: '#c97b4a' }); attached.bindBone = 'b_vb'; attached.p.x = 100; attached.p.y = -60;
  const sideHand = T.mkLayer('vector', 'Side hand'); T.vEllipse(sideHand, 0, 0, 15, 15, { fill: '#8d5a3b' }); sideHand.bindBone = 'b_va';
  const offArt = T.mkLayer('vector', 'Offset art'); T.vRect(offArt, 20, -20, 60, 40, { fill: '#3a2a1a' }); offArt.bindBone = 'b_offs';
  const fire = T.mkLayer('particle', 'Fire'); T.applyParticlePreset(fire, 'Fire'); fire.bindBone = 'b_lo'; fire.startF = 0;
  rig.children = [fire, offArt, sideHand, attached, weighted, flex];
  T.autoBindPoints(weighted, rig, Object.keys(weighted.pts));
  // nested bone group attached to the outer rig
  const inner = T.mkLayer('bone', 'Inner rig'); inner.bindBone = 'b_up';
  inner.bones.push({ id: 'ib1', name: 'Inner', parent: null, x: 0, y: 0, a: 0, len: 80, s: 1, str: 50 });
  key(inner, 'bone:ib1:a', [[0, 0], [30, 45], [60, 0]]);
  const innerArt = T.mkLayer('vector', 'Inner art'); T.vRect(innerArt, 0, -10, 80, 20, { fill: '#20a39e' }); inner.children = [innerArt];
  rig.children.unshift(inner);
  // particles at root
  const snow = T.mkLayer('particle', 'Snow'); T.applyParticlePreset(snow, 'Snow'); snow.p.y = -400; snow.startF = 0;
  const sparks = T.mkLayer('particle', 'Sparks'); T.applyParticlePreset(sparks, 'Sparks'); sparks.startF = 10; sparks.p.x = 250;
  // camera
  key(d.camera, 'zoom', [[0, 1], [60, 1.4, 'ease']]); key(d.camera, 'roll', [[0, 0], [60, 8]]);
  key(d.camera, 'x', [[0, 0], [60, 120]]); key(d.camera, 'shake', [[0, 0], [20, 14, 'easeout'], [40, 0]]);
  const far = T.mkLayer('vector', 'Far hills'); T.vRect(far, -900, 100, 1800, 300, { fill: '#9fd3ff', strokeOn: false }); far.p.z = -600;
  const near = T.mkLayer('vector', 'Near grass'); T.vRect(near, -900, 300, 1800, 200, { fill: '#5ccf8a', strokeOn: false }); near.p.z = 300;
  d.layers = [near, sparks, snow, txt, ig, mg, sw, rig, piv, ip, hidden, img, far];
  return d;
}
"""

RECORD = r"""
(arg) => {
  const A = window.PopaiApp, T = window.PopaiTest, S = A.S;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const ctx = cv.getContext('2d');
  const r9 = (x) => x;
  const out = [];
  for (const sc of arg.scenarios) {
    for (const f of arg.frames) {
      const rec = [];
      A.renderScene(ctx, f, [1, 0, 0, 1, 0, 0], Object.assign({ rec }, sc.opts));
      const items = rec.map((lc) => {
        const L = lc.L, o = { id: L.id, m: lc.full, op: A.val(L, 'opacity', f) };
        if (lc.P) o.pts = lc.P;
        if (lc.bones) o.bones = Object.values(lc.bones.cur).map((b) => ({ id: b.b.id, f: b.F, len: b.len, s: b.s, off: b.off }));
        if (lc.activeChild) o.active = lc.activeChild;
        if (L.type === 'particle' && o.op > 0.001) o.particles = T.particleList(L, f, lc);
        return o;
      });
      out.push({ scenario: sc.name, opts: sc.opts, frame: f, items });
    }
  }
  return out;
}
"""

async def main():
    OUT.mkdir(exist_ok=True); (OUT / 'golden').mkdir(exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = await b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(REF.as_uri()); await pg.wait_for_timeout(300)
        fixtures = {
            'demo': "() => { const A = window.PopaiApp; const d = A.demoProject(); A.startDoc(d); return d; }",
            'features': BUILD_FEATURES,
        }
        for name, builder in fixtures.items():
            doc = await pg.evaluate(builder)
            await pg.evaluate("() => { const A = window.PopaiApp; A.S.selLayers = []; }")
            end = int(doc['end'])
            frames = sorted(set(list(range(0, end + 1, 2)) + [1, 3, 15, 25, 35, end]))
            ids = await pg.evaluate("() => PopaiApp.allLayers().map(l => [l.id, l.type, l.name])")
            sw = next((i for i in ids if i[1] == 'switch'), None)
            only = next((i for i in ids if i[1] == 'vector' and i[2] in ('Arm', 'Weighted limb')), None)
            scenarios = [{'name': 'preview', 'opts': {}}, {'name': 'export', 'opts': {'export': True}}]
            if only: scenarios.append({'name': 'only', 'opts': {'only': only[0], 'noTrail': True}})
            if sw:
                kids = await pg.evaluate(f"() => PopaiApp.findLayer('{sw[0]}').children.map(c => c.id)")
                scenarios.append({'name': 'swOverride', 'opts': {'swOverride': {sw[0]: kids[-1]}}})
            golden = await pg.evaluate(RECORD, {'scenarios': scenarios, 'frames': frames})
            saved = await pg.evaluate("() => JSON.parse(PopaiApp.serialize())")
            (OUT / f'{name}.popai.json').write_text(json.dumps(saved))
            (OUT / 'golden' / f'{name}.json').write_text(json.dumps({'fixture': name, 'frames': frames, 'cases': golden}))
            n = sum(len(c['items']) for c in golden)
            print(f'{name}: {len(frames)} frames x {len(scenarios)} scenarios, {n} layer records')
        if errs:
            print('PAGE ERRORS:', errs); sys.exit(1)
        await b.close()

asyncio.run(main())
