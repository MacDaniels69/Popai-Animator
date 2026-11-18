import { useEffect, useState, useSyncExternalStore } from 'react';
import type { EngineRuntime } from '../engine/contracts';
import type { GeometryResult } from '../domain/model';
import { GeometryService } from '../services/geometry-service';
import { connectDesktop } from '../services/desktop-service';
import { EditorSurface, EnginePortals, MenuBar } from './EditorSurface';
import { AIComposer } from './AIComposer';
import { EffectsLab } from './EffectsLab';
import { UnsavedCloseDialog } from './UnsavedCloseDialog';
function Workspace({engine,onAI,onEffects}:{engine:EngineRuntime;onAI:()=>void;onEffects:()=>void}){
  const state=useSyncExternalStore(engine.subscribe,engine.read);
  const run=(id:string)=>{void Promise.resolve().then(()=>engine.command(id)).catch(error=>engine.showMessage(error instanceof Error?error.message:String(error),true));};
  return <div className="platform-workspace"><div className="platform-project"><span className={'platform-dot '+(state.dirty?'unsaved':'')}/><strong>{state.name}</strong><span>{state.width} × {state.height} · {state.fps} fps</span></div><div className="platform-workspace-actions"><button title="Open project (Ctrl+O)" aria-label="Open project" onClick={()=>run('file.open')}><span aria-hidden="true">▱</span><span className="sr-only">Open project</span></button><button title="Save project (Ctrl+S)" aria-label="Save project" onClick={()=>run('file.save')}><span aria-hidden="true">▣</span><span className="sr-only">Save project</span></button><span className="platform-rule"/><button title="AI Composer" aria-label="AI Composer" className="platform-ai-button" onClick={onAI}><span aria-hidden="true">✦</span><span className="sr-only">AI Composer</span></button><button title="Effects Lab" aria-label="Effects Lab" onClick={onEffects} disabled={!state.selectedId}><span aria-hidden="true">◈</span><span className="sr-only">Effects Lab</span></button><button title="Export (Ctrl+E)" aria-label="Export" onClick={()=>run('file.export')}><span aria-hidden="true">↗</span><span className="sr-only">Export</span></button></div></div>;
}
function Status({engine}:{engine:EngineRuntime}){
  const state=useSyncExternalStore(engine.subscribe,engine.read),[analysis,setAnalysis]=useState<GeometryResult|null>(null),[workerState,setWorkerState]=useState('Starting worker');
  const [service]=useState(()=>typeof Worker==='undefined'?null:new GeometryService());
  useEffect(()=>()=>service?.dispose(),[service]);
  useEffect(()=>{let current=true;const timer=setTimeout(()=>{if(!service){setWorkerState('Worker unavailable');return;}try{const input=engine.captureGeometry();if(!input){setAnalysis(null);setWorkerState('Worker ready');return;}setWorkerState('Analyzing vectors');void service.analyze(input).then(result=>{if(current){setAnalysis(result);setWorkerState('Worker ready');}}).catch(error=>{if(current&&error.name!=='AbortError'){setAnalysis(null);setWorkerState('Analysis unavailable');}});}catch{setAnalysis(null);setWorkerState('Selection exceeds analysis budget');}},120);return()=>{current=false;clearTimeout(timer);};},[engine,service,state.documentId,state.revision,state.frame,state.selectedId]);
  return <div className="platform-status" role="status"><span>{state.selectedName}{state.selectedType?' · '+state.selectedType:''}</span>{state.selectedType==='vector'&&<span>{state.selectedPointCount} / {state.pointCount} points{analysis?' · '+Math.round(analysis.length).toLocaleString()+' units of curves':''}</span>}<span className="platform-status-spacer"/><span>{state.layerCount} layers · {state.boneCount} bones · {state.effectCount} effects</span><span>{workerState}</span><span>{window.popaiDesktop?'Desktop':'Browser'} · Canvas2D</span></div>;
}
export function App({engine}:{engine:EngineRuntime}){
  const [dialog,setDialog]=useState<'ai'|'effects'|null>(null),[failure,setFailure]=useState(''),[closing,setClosing]=useState(false);
  useEffect(()=>window.popaiDesktop?.onCloseRequested?.(()=>setClosing(true)),[]);
  const resolveClose=(allow:boolean)=>{setClosing(false);window.popaiDesktop?.resolveClose?.(allow);};
  useEffect(()=>{let desktop:ReturnType<typeof connectDesktop>|undefined;try{if(window.popaiDesktop)desktop=connectDesktop(engine,window.popaiDesktop);engine.start();window.__POPAI_READY__=true;}catch(error){setFailure(error instanceof Error?error.message:String(error));}return()=>desktop?.dispose();},[engine]);
  return <><div id="app"><MenuBar/><Workspace engine={engine} onAI={()=>setDialog('ai')} onEffects={()=>setDialog('effects')}/><EditorSurface/><Status engine={engine}/></div><EnginePortals/>{dialog==='ai'&&<AIComposer engine={engine} onClose={()=>setDialog(null)}/>} {dialog==='effects'&&<EffectsLab engine={engine} onClose={()=>setDialog(null)}/>} {failure&&<div className="platform-fatal" role="alert"><h2>The editor could not start</h2><p>{failure}</p><p>Your original projects have not been replaced.</p></div>}{closing&&<UnsavedCloseDialog name={engine.read().name} onKeepEditing={()=>resolveClose(false)} onDiscard={()=>resolveClose(true)}/>}</>;
}
