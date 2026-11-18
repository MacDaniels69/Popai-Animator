// @vitest-environment jsdom
import { act } from 'react';import { createRoot, type Root } from 'react-dom/client';
import { afterEach,beforeEach,it,expect,vi } from 'vitest';
import { App } from '../src/ui/App';
import type { EngineRuntime } from '../src/engine/contracts';
import type { EditorSnapshot } from '../src/domain/model';
let root:Root,host:HTMLDivElement,engine:EngineRuntime;
const snapshot:EditorSnapshot={documentId:'session:1',revision:1,name:'My scene',dirty:false,frame:0,end:72,fps:24,width:1280,height:720,mode:'setup',playing:false,tool:'points',selectedId:'drawing1',selectedName:'Character',selectedType:'vector',layerCount:1,pointCount:4,selectedPointCount:2,boneCount:0,effectCount:0,canUndo:false,canRedo:false};
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation((()=>({clearRect(){},drawImage(){},filter:'none'})) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  engine={read:()=>snapshot,subscribe:()=>()=>{},start:vi.fn(),command:vi.fn(),captureGeometry:()=>null,showMessage:vi.fn(),captureFrame:vi.fn(()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;return canvas;}),addEffect:vi.fn(),planAI:vi.fn(async()=>({token:'plan1',engine:'Local interpreter',notes:[],commands:[{description:'Move Character',operation:'move',error:null}]})),applyAIPlan:vi.fn()} as unknown as EngineRuntime;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.restoreAllMocks();});
function button(text:string){const found=[...host.querySelectorAll('button')].find(b=>b.textContent?.includes(text));if(!found)throw new Error('Button missing: '+text);return found;}
it('mounts the React editor hosts and starts the animation engine once',async()=>{await act(()=>root.render(<App engine={engine}/>));expect(engine.start).toHaveBeenCalledTimes(1);for(const id of ['toolbar','stage','layerTree','tabBody','tlcanvas','modal','fileIn'])expect(host.querySelector('#'+id)).not.toBeNull();expect(host.textContent).toContain('My scene');expect(host.textContent).toContain('2 / 4 points');});
it('runs AI planning and applies the reviewed plan from the React dialog',async()=>{await act(()=>root.render(<App engine={engine}/>));await act(()=>button('AI Composer').click());expect(host.querySelector('[role="dialog"]')).not.toBeNull();await act(()=>button('Move it right').click());await act(async()=>button('Generate plan').click());expect(engine.planAI).toHaveBeenCalledWith('Move it right over 24 frames');expect(host.textContent).toContain('Move Character');await act(()=>button('Apply to scene').click());expect(engine.applyAIPlan).toHaveBeenCalledWith('plan1');expect(host.querySelector('[role="dialog"]')).toBeNull();});
it('opens Effects Lab with a fallback preview and applies an ordinary layer effect',async()=>{await act(()=>root.render(<App engine={engine}/>));await act(async()=>button('Effects Lab').click());expect(host.textContent).toContain('Apply color correction');expect(engine.captureFrame).toHaveBeenCalledWith(1280,true);await act(()=>button('Apply color correction').click());expect(engine.addEffect).toHaveBeenCalledWith({type:'color',params:{brightness:1,contrast:1,saturation:1,hue:0}});});
it('shows startup errors instead of leaving an empty editor',async()=>{vi.mocked(engine.start).mockImplementation(()=>{throw new Error('Missing engine asset');});await act(()=>root.render(<App engine={engine}/>));expect(host.querySelector('[role="alert"]')?.textContent).toContain('Missing engine asset');});
