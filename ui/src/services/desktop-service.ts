import type { DesktopBridge, EngineRuntime } from '../engine/contracts';
export function connectDesktop(engine:EngineRuntime,desktop:DesktopBridge){
  let saving:Promise<void>|null=null,recovering=false,lastSignature='',lastMeta='',disposed=false;
  const save=(saveAs=false)=>{
    if(saving)return saving;
    saving=(async()=>{const capture=engine.captureSave(),result=await desktop.saveProject({...capture,saveAs});if(result.canceled)return;
      const current=engine.acknowledgeSave(capture);engine.showMessage(current?'Project saved':'Saved captured version; newer edits are still unsaved');})().finally(()=>{saving=null;});return saving;
  };
  engine.setSaveHandler(()=>save());
  engine.setOpenHandler(async()=>{const opened=await desktop.openProject();if(opened.canceled)return;
    if(await engine.openProject(opened.text)){await desktop.bindOpenedProject({documentId:engine.read().documentId,openToken:opened.openToken});lastSignature='';engine.showMessage('Opened '+opened.name);}});
  const unsubscribe=engine.subscribe(()=>{const s=engine.read(),meta=JSON.stringify([s.dirty,s.name]);if(meta!==lastMeta){lastMeta=meta;desktop.setDirty({dirty:s.dirty,name:s.name});}});
  const nativeCommands=desktop.onCommand(command=>{void(async()=>{try{
    if(command==='file.saveas')await save(true);
    else if(command==='file.recover-native'){const text=await desktop.readRecovery();if(!text)engine.showMessage('No desktop recovery checkpoint yet');else if(await engine.openProject(text)){engine.markDirty();engine.showMessage('Recovered checkpoint — save it as a project');}}
    else await engine.command(command);
  }catch(error){engine.showMessage(error instanceof Error?error.message:'Command failed',true);}})();});
  const timer=setInterval(()=>{if(recovering||disposed||!engine.read().dirty)return;const capture=engine.captureSave();if(lastSignature===capture.signature)return;recovering=true;
    void desktop.writeRecovery(capture).then(()=>{lastSignature=capture.signature;}).catch(error=>engine.showMessage('Desktop recovery failed: '+String(error),true)).finally(()=>{recovering=false;});},15000);
  return {save,dispose(){disposed=true;unsubscribe();nativeCommands();clearInterval(timer);}};
}
