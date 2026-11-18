import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DesktopBridge } from '../engine/contracts';

/** In the Tauri desktop app, provide the same `window.popaiDesktop` services the Electron build had:
 *  native open / save dialogs, video save, recovery checkpoints, window title and the close prompt. */
export function installTauriBridge(): boolean {
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; popaiDesktop?: DesktopBridge };
  if (!w.__TAURI_INTERNALS__ || w.popaiDesktop) return false;
  const closeListeners = new Set<() => void>();
  void listen('popai-close-request', () => { for (const l of closeListeners) l(); });
  const desktop: DesktopBridge = {
    info: () => invoke('popai_info'),
    openProject: () => invoke('popai_open'),
    bindOpenedProject: ({ documentId, openToken }) => invoke('popai_bind_open', { documentId, openToken }),
    saveProject: ({ documentId, name, text, saveAs, thumbnail }) => invoke('popai_save', { documentId, name, text, saveAs: !!saveAs, thumbnail: thumbnail?.length ? Array.from(thumbnail) : null }),
    startupProject: () => invoke('popai_startup_open'),
    saveVideo: ({ name, bytes }) => invoke('popai_save_video', bytes, { headers: { 'x-name': encodeURIComponent(name) } }),
    writeRecovery: ({ text }) => invoke('popai_recovery_write', { text }),
    readRecovery: () => invoke('popai_recovery_read'),
    setDirty: ({ dirty, name }) => { void invoke('popai_set_dirty', { dirty, name }); },
    resolveClose: (allow) => { if (typeof allow === 'boolean') void invoke('popai_resolve_close', { allow }); },
    onCloseRequested(listener) { closeListeners.add(listener); return () => closeListeners.delete(listener); },
    onCommand() { return () => {}; }, // menus live inside the app window
  };
  w.popaiDesktop = Object.freeze(desktop);
  return true;
}
