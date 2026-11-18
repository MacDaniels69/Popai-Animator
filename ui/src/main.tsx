import wordmark from './assets/popai-wordmark.png';
(window as any).__POPAI_WORDMARK__ = wordmark;
import { validateCompositionState } from './composition/model';
(window as any).__popaiValidateComposition = validateCompositionState;
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { getEngine } from './engine/client';
import { installTauriBridge } from './services/tauri-bridge';
import './ui/platform.css';
const root=document.getElementById('root');if(!root)throw new Error('Missing application root');
async function start(){try{installTauriBridge();await import('./generated/legacy.js');const engine=getEngine();createRoot(root!).render(<App engine={engine}/>);}catch(error){root!.textContent='Popai could not start: '+(error instanceof Error?error.message:String(error));}}
void start();
