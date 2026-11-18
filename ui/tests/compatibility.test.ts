import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import type { EngineRuntime } from '../src/engine/contracts';
let dom:JSDOM,engine:EngineRuntime;
beforeEach(()=>{
  const markup=readFileSync('legacy/src/shell.html','utf8').replace('<script>/*JS*/</script>','');
  dom=new JSDOM(markup,{url:'https://popai.local/',runScripts:'outside-only'});
  const window=dom.window;
  const context=new Proxy({globalAlpha:1,measureText:()=>({width:100}),createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}}),createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:(x:number,y:number,w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),isPointInPath:()=>false,isPointInStroke:()=>false},{get:(obj,key)=>key in obj?obj[key as keyof typeof obj]:(()=>{}),set:(obj,key,value)=>(Reflect.set(obj,key,value),true)});
  Object.defineProperty(window.HTMLCanvasElement.prototype,'getContext',{value:()=>context});
  Object.defineProperty(window.HTMLElement.prototype,'getBoundingClientRect',{value:()=>({x:0,y:0,left:0,top:0,width:1280,height:720,right:1280,bottom:720,toJSON(){return {};}})});
  Object.defineProperty(window,'ResizeObserver',{value:class{observe(){}disconnect(){}}});
  Object.defineProperty(window,'Path2D',{value:class{moveTo(){}lineTo(){}bezierCurveTo(){}closePath(){}}});
  Object.defineProperty(window,'requestAnimationFrame',{value:()=>1});Object.defineProperty(window,'cancelAnimationFrame',{value:()=>{}});
  window.confirm=()=>true;window.URL.createObjectURL=()=> 'blob:popai-test';window.URL.revokeObjectURL=()=>{};
  window.eval(readFileSync('public/engine/legacy.js','utf8'));
  engine=(window as unknown as {PopaiRuntime:EngineRuntime}).PopaiRuntime;
});
afterEach(()=>dom.window.close());
describe('complete compatibility editor boundary',()=>{
  it('has a stable pre-start snapshot and boots every tool into real DOM',()=>{expect(engine.read()).toBe(engine.read());engine.start();expect(dom.window.document.querySelectorAll('#toolbar button').length).toBeGreaterThanOrEqual(40);expect(engine.read().name).toBe('Untitled');expect(engine.read().documentId).not.toBe('');engine.start();expect(dom.window.document.querySelectorAll('#toolbar button').length).toBeLessThan(70);});
  it('loads the demo and saves a valid unchanged project',()=>{engine.start();engine.loadDemo();const snapshot=engine.read();expect(snapshot.layerCount).toBeGreaterThan(5);const saved=engine.captureSave();expect(JSON.parse(saved.text).format).toBe(1);expect(engine.acknowledgeSave(saved)).toBe(true);expect(engine.read().dirty).toBe(false);});
  it('keeps document identity through undo and rejects acknowledging stale saves',()=>{engine.start();engine.loadDemo();const app=(dom.window as unknown as {PopaiApp:{S:{selLayers:string[];doc:{layers:{id:string;name:string}[]}}}}).PopaiApp;app.S.selLayers=[app.S.doc.layers[0].id];const before=engine.captureSave();engine.addEffect({type:'blur',params:{radius:8}});expect(engine.acknowledgeSave(before)).toBe(false);engine.command('edit.undo');expect(engine.read().documentId).toBe(before.documentId);});
  it('retains the old document when project replacement is cancelled',async()=>{engine.start();engine.loadDemo();const saved=engine.captureSave();engine.markDirty();dom.window.confirm=()=>false;expect(await engine.openProject(saved.text)).toBe(false);expect(engine.read().documentId).toBe(saved.documentId);});
  it('rejects invalid effect and project inputs at the boundary',async()=>{engine.start();await expect(engine.openProject('{"format":999,"doc":{}}')).rejects.toThrow();expect(()=>engine.addEffect({type:'color',params:{contrast:999}})).toThrow();expect(()=>engine.command('unknown')).toThrow();});
  it('previews AI commands and applies them as one undoable edit',async()=>{engine.start();engine.loadDemo();const app=(dom.window as unknown as {PopaiApp:{S:{selLayers:string[];doc:{layers:{id:string;type:string}[]}}}}).PopaiApp;const target=app.S.doc.layers.find(l=>l.type==='vector')!;expect(target).toBeTruthy();app.S.selLayers=[target.id];const plan=await engine.planAI('move it right over 24 frames');expect(plan.commands.length).toBeGreaterThan(0);expect(plan.commands.every(c=>!c.error)).toBe(true);engine.applyAIPlan(plan.token);expect(engine.read().canUndo).toBe(true);expect(engine.read().dirty).toBe(true);expect(()=>engine.applyAIPlan(plan.token)).toThrow(/fresh/);});
  it('refuses an AI plan after the scene changed',async()=>{engine.start();engine.loadDemo();const app=(dom.window as unknown as {PopaiApp:{S:{selLayers:string[];doc:{layers:{id:string;type:string}[]}}}}).PopaiApp;app.S.selLayers=[app.S.doc.layers.find(l=>l.type==='vector')!.id];const plan=await engine.planAI('move it right over 24 frames');engine.addEffect({type:'glow',params:{}});expect(()=>engine.applyAIPlan(plan.token)).toThrow(/scene changed/);});
});
