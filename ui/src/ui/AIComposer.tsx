import { useState } from 'react';
import type { AIPlanPreview } from '../domain/model';
import type { EngineRuntime } from '../engine/contracts';
export function AIComposer({engine,onClose}:{engine:EngineRuntime;onClose:()=>void}){
  const [text,setText]=useState(''),[plan,setPlan]=useState<AIPlanPreview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generate=async()=>{setBusy(true);setError('');setPlan(null);try{setPlan(await engine.planAI(text));}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}};
  const apply=()=>{try{if(plan){engine.applyAIPlan(plan.token);engine.showMessage('AI plan applied — every change remains editable');onClose();}}catch(error){setError(error instanceof Error?error.message:String(error));}};
  return <div className="platform-dialog-backdrop" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape')onClose();}}>
    <section className="platform-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-title">
      <header><div><span className="platform-eyebrow">DIRECT YOUR SCENE</span><h2 id="ai-title">AI Composer</h2></div><button className="ib" onClick={onClose} aria-label="Close AI Composer">×</button></header>
      <p className="platform-muted">Working with <strong>{engine.read().selectedName}</strong>. Describe motion or effects, review the plan, then apply it as editable keys.</p>
      <textarea autoFocus maxLength={4000} rows={4} placeholder="Make it bounce over 24 frames and add a warm glow…" value={text} disabled={busy} onChange={e=>{setText(e.target.value);setPlan(null);}} />
      <div className="platform-suggestions">{['Move it right over 24 frames','Add a glow','Fade it out over 24 frames'].map(example=><button key={example} disabled={busy} onClick={()=>{setText(example);setPlan(null);}}>{example}</button>)}</div>
      <div className="platform-dialog-actions"><button className="btn" disabled={busy} onClick={()=>{onClose();void engine.command('ai.settings');}}>Engine settings</button><button className="btn pri" disabled={busy||!text.trim()} onClick={()=>void generate()}>{busy?'Planning…':'Generate plan'}</button></div>
      {error&&<p role="alert" className="platform-error">{error}</p>}
      {plan&&<div className="platform-plan"><div className="platform-eyebrow">{plan.engine} · {plan.commands.length} commands</div><ol>{plan.commands.map((command,i)=><li key={i}><strong>{command.description}</strong>{command.error&&<div className="platform-error">{command.error}</div>}</li>)}</ol>{plan.notes.map((note,i)=><p key={i} className="platform-muted">{note}</p>)}<button className="btn pri" disabled={!plan.commands.length||plan.commands.some(c=>!!c.error)} onClick={apply}>Apply to scene</button></div>}
      <p className="platform-footnote">Uses the local interpreter until you configure an AI endpoint. Changes are validated against the selected or explicitly named layers.</p>
    </section>
  </div>;
}
