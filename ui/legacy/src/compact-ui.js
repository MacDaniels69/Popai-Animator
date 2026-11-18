/* Compact workspace: presentation only; document and editing commands remain intact. */
defTool('switchlayer', {icon:'⇄',name:'Switch layer',hint:'Choose and key switch alternatives',cursor:'default',down(){},move(){},up(){}});
TOOL_GROUPS.splice(4,0,['Switch',['switchlayer']]);
const switchSetTool = setTool;
setTool = function(id){switchSetTool(id);if(id==='switchlayer'&&selLayer()?.type==='switch')setTab('switch');};
const compactSections = new Map();
function compactToolVisible(id, layer = selLayer()) {
  const vector = VECTOR_DRAW.includes(id) || VECTOR_FILL.includes(id) || id === 'text';
  if (['bone','switch'].includes(layer?.type) && vector) return false;
  if (id === 'switchlayer') return layer?.type === 'switch';
  if (layer?.type === 'switch' && BONE_TOOLS.has(id)) return id === 'bind';
  if (layer?.type === 'vector' && BONE_TOOLS.has(id)) return ['bonesel','bonemanip','bind','bindpts'].includes(id);
  return true;
}
function compactRefresh() {
  if(currentTab==='switch'&&selLayer()?.type!=='switch')setTab('props');
  if (!compactToolVisible(S.tool)) setTool('select');
  document.querySelectorAll('#tabBody .sec').forEach(section=>{
    const header=section.querySelector(':scope > h4');if(!header)return;
    const key=currentTab+':'+header.textContent.trim();
    section.dataset.compactKey=key;
    const collapsed=compactSections.has(key)?compactSections.get(key):/Notes|Getting started|Effects stack|Particle motion|Over life|References/.test(header.textContent);
    section.classList.toggle('compact-collapsed',collapsed);
    header.tabIndex=0;header.setAttribute('role','button');header.setAttribute('aria-expanded',String(!collapsed));
  });
  document.querySelectorAll('#toolbar .tg').forEach(header=>{
    const group=header.dataset.group, ids=TOOL_GROUPS.find(([name])=>name===group)?.[1] || [];
    const visible=ids.filter(id=>compactToolVisible(id));
    header.classList.toggle('compact-tool-hidden',!visible.length);
    header.removeAttribute('tabindex');header.removeAttribute('role');header.removeAttribute('aria-expanded');header.title=group+' tools';
    for(let button=header.nextElementSibling;button&&!button.classList.contains('tg');button=button.nextElementSibling)button.classList.toggle('compact-tool-hidden',!compactToolVisible(button.dataset.tool));
  });
  document.querySelectorAll('#tabBody .note').forEach(note=>{
    if(note.dataset.compactNote||note.classList.contains('act-banner')||note.textContent.length<110||note.querySelector('input,button,select'))return;
    note.dataset.compactNote='true';const details=document.createElement('details');details.className='compact-help';const summary=document.createElement('summary');summary.textContent='Help';details.append(summary);note.replaceWith(details);details.append(note);
  });
  const options=document.getElementById('toolopts');
  if(options&&!options.querySelector('[data-compact-options]')){
    const commands=[...options.querySelectorAll('button.btn')].filter(b=>b.id!=='penDone');
    if(commands.length){
      commands.forEach(b=>b.classList.add('compact-secondary-command'));
      const more=document.createElement('button');more.className='ib compact-options';more.dataset.compactOptions='true';more.textContent='⋯';more.title='Tool commands';more.setAttribute('aria-label','Tool commands');
      more.onclick=()=>{const r=more.getBoundingClientRect();showMenu(r.left,r.bottom,commands.map(b=>({label:b.textContent.trim(),dis:b.disabled,run:()=>b.click()})));};options.append(more);
    }
  }
  document.querySelectorAll('#toolopts .hint,#toolopts .chip').forEach(note=>{note.title=note.textContent;});
}
function compactToggle(target){
  const header=target.closest('#tabBody .sec > h4');
  if(header&&!target.closest('button,input,select,a')){const section=header.parentElement;compactSections.set(section.dataset.compactKey,!section.classList.contains('compact-collapsed'));compactRefresh();return;}

}
document.addEventListener('click',e=>compactToggle(e.target));
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('#tabBody .sec > h4')){e.preventDefault();compactToggle(e.target);}});
const compactStart=window.PopaiRuntime;
function compactInit(){
  if(!document.querySelector('#toolbar .tg')){setTimeout(compactInit,50);return;}
  const observer=new MutationObserver(()=>{observer.disconnect();compactRefresh();for(const id of ['tabBody','toolbar','toolopts']){const el=document.getElementById(id);if(el)observer.observe(el,{childList:true,subtree:true});}});
  compactRefresh();for(const id of ['tabBody','toolbar','toolopts']){const el=document.getElementById(id);if(el)observer.observe(el,{childList:true,subtree:true});}
}
setTimeout(compactInit,0);
