import appIcon from './assets/popai-icon.png';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { connectEngine } from './engine/client';
import './styles.css';

connectEngine().then(async (engine) => {
  createRoot(document.getElementById('root')!).render(<App engine={engine} />);
  if (engine.isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    if (await invoke<boolean>('selftest_enabled')) (await import('./selftest')).runSelfTest(engine);
  }
});

// window / tab icon
{ const l = document.querySelector<HTMLLinkElement>('link[rel=icon]'); if (l) l.href = appIcon; }
