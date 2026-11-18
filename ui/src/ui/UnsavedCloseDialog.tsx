import {useEffect,useRef} from 'react';

export function UnsavedCloseDialog({name,onKeepEditing,onDiscard}:{name:string;onKeepEditing:()=>void;onDiscard:()=>void}){
  const keep=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null,editor=document.getElementById('app'),wasInert=editor?.inert;
    if(editor)editor.inert=true;
    keep.current?.focus();
    return()=>{if(editor)editor.inert=wasInert??false;if(previous?.isConnected)previous.focus();};
  },[]);
  return <div className="unsaved-close-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onKeepEditing();}}>
    <section ref={panel} className="unsaved-close-dialog" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-close-title" aria-describedby="unsaved-close-description"
      onKeyDown={event=>{
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onKeepEditing();}
        if(event.key==='Tab'){
          const buttons=[...panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')],first=buttons[0],last=buttons[buttons.length-1];
          if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
          else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        }
      }}>
      <header><span className="unsaved-close-label">Unsaved project</span><button type="button" className="unsaved-close-x" aria-label="Keep editing" onClick={onKeepEditing}>×</button></header>
      <div className="unsaved-close-content">
        <span className="unsaved-close-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3 10 18H2L12 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><path d="M12 9v5m0 3v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg></span>
        <div><h2 id="unsaved-close-title">Close without saving?</h2><p id="unsaved-close-description">Your latest changes to <strong>{name||'Untitled'}</strong> haven’t been saved. Keep editing to save your work before closing.</p></div>
      </div>
      <footer><button type="button" className="unsaved-close-discard" data-close="discard" onClick={onDiscard}>Discard and close</button><button ref={keep} type="button" className="unsaved-close-keep" data-close="keep" onClick={onKeepEditing}>Keep editing</button></footer>
    </section>
  </div>;
}
