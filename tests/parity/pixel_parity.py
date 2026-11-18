"""Stage 2 parity: render fixture frames with the Rust engine and with the legacy JavaScript engine
in the same browser page and compare every pixel.

Needs the engine host serving the built UI:
  cargo run --release -p popai-engine-host -- --port 7878 --ui ui/dist
Then: python3 tests/parity/pixel_parity.py
"""
import asyncio, json, pathlib, sys
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
URL = 'http://127.0.0.1:7878/'
COMPARE = r"""
async ({ frames, modes }) => {
  const A = PopaiApp, d = A.S.doc, out = [];
  const W = 640, H = Math.round(640 * d.h / d.w), sc = W / d.w;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = d.bg; x.fillRect(0, 0, W, H); return [c, x]; };
  const view = [sc, 0, 0, sc, W / 2, H / 2];
  for (const mode of modes) for (const f of frames) {
    const opts = mode === 'export' ? { export: true } : {};
    const [ca, xa] = mk(), [cb, xb] = mk();
    A.legacyRenderScene(xa, f, view, opts);
    await A.renderSceneAsync(xb, f, view, opts);
    const a = xa.getImageData(0, 0, W, H).data, b = xb.getImageData(0, 0, W, H).data;
    let diff = 0, maxd = 0;
    for (let i = 0; i < a.length; i += 4) {
      const m = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
      if (m > 2) diff++; if (m > maxd) maxd = m;
    }
    out.push({ mode, f, diff, maxd, px: W * H });
  }
  return out;
}
"""
async def main():
    fails = 0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        pg = await b.new_page(viewport={'width': 1400, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL); await pg.wait_for_timeout(800)
        assert await pg.evaluate('PopaiApp.ENGINE.mode') == 'rust', 'Rust engine not connected'
        await pg.evaluate("document.querySelector('#modal .x') && document.querySelector('#modal .x').click()")
        for name in ['demo', 'features', 'keys']:
            txt = (ROOT / 'fixtures' / f'{name}.popai.json').read_text()
            await pg.evaluate('(t) => PopaiApp.loadProjectJSON(t)', txt); await pg.wait_for_timeout(300)
            end = int(json.loads(txt)['doc']['end'])
            frames = list(range(0, end + 1, 3))
            res = await pg.evaluate(COMPARE, {'frames': frames, 'modes': ['preview', 'export']})
            worst = max(res, key=lambda r: r['diff'])
            bad = [r for r in res if r['diff'] > 0]
            fails += len(bad)
            print(f"{name}: {len(res)} frames compared, {len(bad)} with differing pixels; worst frame {worst['f']} ({worst['mode']}): {worst['diff']} px, max channel diff {worst['maxd']}")
        if errs: print('page errors:', errs); fails += 1
        await b.close()
    sys.exit(1 if fails else 0)
asyncio.run(main())
