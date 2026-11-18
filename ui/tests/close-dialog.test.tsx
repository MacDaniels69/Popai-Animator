// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {UnsavedCloseDialog} from '../src/ui/UnsavedCloseDialog';
let root:Root,host:HTMLDivElement,previous:HTMLButtonElement;
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');host.id='app';previous=document.createElement('button');previous.textContent='Editor';host.append(previous);document.body.append(host);previous.focus();
  const portal=document.createElement('div');portal.id='close-test';document.body.append(portal);root=createRoot(portal);
});
afterEach(async()=>{await act(()=>root.unmount());document.getElementById('close-test')?.remove();host.remove();});
async function render(name='My scene'){
  const keep=vi.fn(),discard=vi.fn();await act(()=>root.render(<UnsavedCloseDialog name={name} onKeepEditing={keep} onDiscard={discard}/>));return {keep,discard};
}
it('focuses Keep editing, makes the editor inert, and restores focus on dismissal',async()=>{
  await render();expect(document.querySelector('[role="alertdialog"]')?.getAttribute('aria-modal')).toBe('true');expect(document.activeElement).toBe(document.querySelector('[data-close="keep"]'));expect(host.inert).toBe(true);
  await act(()=>root.render(null));expect(host.inert).toBe(false);expect(document.activeElement).toBe(previous);
});
it('keeps editing through the button, close icon, Escape, and outside click',async()=>{
  const {keep,discard}=await render();await act(()=>document.querySelector<HTMLButtonElement>('[data-close="keep"]')!.click());await act(()=>document.querySelector<HTMLButtonElement>('.unsaved-close-x')!.click());
  await act(()=>document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));await act(()=>document.querySelector('.unsaved-close-backdrop')!.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));
  expect(keep).toHaveBeenCalledTimes(4);expect(discard).not.toHaveBeenCalled();
});
it('discards only when the explicit discard button is activated',async()=>{
  const {keep,discard}=await render();await act(()=>document.querySelector('.unsaved-close-content')!.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));expect(discard).not.toHaveBeenCalled();
  await act(()=>document.querySelector<HTMLButtonElement>('[data-close="discard"]')!.click());expect(discard).toHaveBeenCalledTimes(1);expect(keep).not.toHaveBeenCalled();
});
it('keeps keyboard focus inside the confirmation and renders project names as text',async()=>{
  await render('<img src=x onerror=alert(1)>');expect(document.querySelector('.unsaved-close-dialog img')).toBeNull();expect(document.querySelector('strong')?.textContent).toContain('<img');
  const buttons=document.querySelectorAll<HTMLButtonElement>('.unsaved-close-dialog button'),first=buttons[0],last=buttons[buttons.length-1];last.focus();await act(()=>last.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));expect(document.activeElement).toBe(first);
  await act(()=>first.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));expect(document.activeElement).toBe(last);
});
