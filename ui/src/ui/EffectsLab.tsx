import { useEffect, useRef, useState } from 'react';
import type { EngineRuntime } from '../engine/contracts';
import { ColorCompositor, neutralGrade, type Grade } from '../render/color-compositor';
export function EffectsLab({engine,onClose}:{engine:EngineRuntime;onClose:()=>void}){
  const [grade,setGrade]=useState<Grade>({...neutralGrade}),[backend,setBackend]=useState('Preparing preview'),[error,setError]=useState('');
  const canvas=useRef<HTMLCanvasElement>(null),source=useRef<HTMLCanvasElement|null>(null),processor=useRef<ColorCompositor|null>(null),sequence=useRef(0);
  const [target]=useState(()=>engine.read());
  useEffect(()=>{processor.current=new ColorCompositor();try{source.current=engine.captureFrame(1280,true);}catch(error){setError(String(error));}return()=>{sequence.current++;processor.current?.dispose();};},[engine]);
  useEffect(()=>{if(!source.current||!processor.current)return;const id=++sequence.current,output=document.createElement('canvas');
    void processor.current.render(source.current,grade,output).then(mode=>{if(id!==sequence.current||!canvas.current)return;canvas.current.width=output.width;canvas.current.height=output.height;canvas.current.getContext('2d')?.drawImage(output,0,0);setBackend(mode);}).catch(error=>{if(id===sequence.current)setError(String(error));});
  },[grade]);
  const apply=()=>{try{if(engine.read().selectedId!==target.selectedId)throw new Error('Selection changed; reopen the preview');engine.addEffect({type:'color',params:{...grade,hue:0}});engine.showMessage('Color correction added to '+target.selectedName);onClose();}catch(error){setError(error instanceof Error?error.message:String(error));}};
  const quickEffect=(type:'glow'|'blur')=>{try{engine.addEffect({type,params:{}});engine.showMessage(type==='glow'?'Glow added to selected layer':'Blur added to selected layer');onClose();}catch(error){setError(String(error));}};
  return <div className="platform-dialog-backdrop" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')onClose();}}><section className="platform-dialog effects-dialog" role="dialog" aria-modal="true" aria-labelledby="fx-title">
    <header><div><span className="platform-eyebrow">LOOK DEVELOPMENT</span><h2 id="fx-title">Effects Lab</h2></div><button className="ib" onClick={onClose} aria-label="Close Effects Lab">×</button></header>
    <p className="platform-muted">Previewing <strong>{target.selectedName}</strong> at frame {target.frame}. Apply creates an ordinary effect on this layer.</p>
    <div className="platform-preview"><canvas ref={canvas} aria-label="Color-corrected selection preview"/><span>{backend}</span></div>
    <div className="platform-grade">{(['brightness','contrast','saturation'] as const).map(key=><label key={key}><span>{key}</span><input type="range" min="0" max="3" step="0.01" value={grade[key]} onChange={e=>setGrade({...grade,[key]:Number(e.target.value)})}/><output>{Math.round(grade[key]*100)}%</output></label>)}</div>
    <div className="platform-dialog-actions"><button className="btn" onClick={()=>setGrade({...neutralGrade})}>Reset</button><button className="btn" onClick={()=>setGrade({brightness:1.05,contrast:1.25,saturation:.85})}>Cinematic</button><button className="btn pri" disabled={!target.selectedId} onClick={apply}>Apply color correction</button></div>
    <div className="platform-quick-effects"><span>Quick effects</span><button className="btn" onClick={()=>quickEffect('glow')}>＋ Glow</button><button className="btn" onClick={()=>quickEffect('blur')}>＋ Blur</button></div>
    {error&&<p className="platform-error" role="alert">{error}</p>}
    <p className="platform-footnote">WebGPU accelerates this preview when available. The main editor and exported layer effects use the compatible canvas renderer; color-management differences may affect the match.</p>
  </section></div>;
}
