// Connection to the Rust engine.
//  • Desktop app (Tauri): `engine_rpc` command — the engine runs in-process, natively.
//  • Browser development / automated tests: `popai-engine-host` serving POST /rpc on localhost.
//  • Neither available: the legacy JavaScript engine (kept so the app always works and for parity checks).

import type { EngineInfo, SceneNode, SceneOpts } from './types';

export type Transport = (method: string, params: unknown) => Promise<any>;
export type EngineMode = 'rust' | 'legacy';

declare global {
  interface Window { __TAURI_INTERNALS__?: unknown }
}

export class EngineClient {
  mode: EngineMode;
  info: EngineInfo | null;
  via: 'tauri' | 'host' | 'none';
  lastMs = 0;
  private transport: Transport | null;
  private listeners = new Set<() => void>();

  constructor(mode: EngineMode, via: EngineClient['via'], transport: Transport | null, info: EngineInfo | null) {
    this.mode = mode; this.via = via; this.transport = transport; this.info = info;
  }
  get isTauri() { return this.via === 'tauri'; }
  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((f) => f()); }

  async rpc<T = any>(method: string, params: unknown = {}): Promise<T> {
    if (!this.transport) throw new Error('Rust engine not connected');
    const t0 = performance.now();
    const r = await this.transport(method, params);
    this.lastMs = performance.now() - t0;
    return r as T;
  }
  /** Switch to the legacy JS engine at runtime (e.g. if the engine process stops). */
  fallBack(reason: string) {
    if (this.mode === 'legacy') return;
    console.warn('[engine] falling back to legacy JS engine:', reason);
    this.mode = 'legacy'; this.emit();
  }
}

async function tauriTransport(): Promise<Transport> {
  const { invoke } = await import('@tauri-apps/api/core');
  return (method, params) => invoke('engine_rpc', { method, params });
}
function httpTransport(base: string): Transport {
  return async (method, params) => {
    // text/plain keeps this a "simple" request (no CORS preflight when the UI is served elsewhere)
    const r = await fetch(base + '/rpc', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ method, params }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    return j.result;
  };
}

export async function connectEngine(): Promise<EngineClient> {
  const q = new URLSearchParams(location.search);
  if (q.get('engine') === 'legacy') return new EngineClient('legacy', 'none', null, null);
  const tryOne = async (via: EngineClient['via'], make: () => Promise<Transport> | Transport) => {
    try {
      const t = await make();
      const info = (await Promise.race([t('version', {}), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500))])) as EngineInfo;
      return new EngineClient('rust', via, t, info);
    } catch {
      return null;
    }
  };
  if (window.__TAURI_INTERNALS__) {
    const c = await tryOne('tauri', tauriTransport);
    if (c) return c;
  }
  const hosts = [q.get('engine'), location.protocol.startsWith('http') ? location.origin : null, 'http://127.0.0.1:7878'].filter(Boolean) as string[];
  for (const h of hosts) {
    const c = await tryOne('host', () => httpTransport(h.replace(/\/$/, '')));
    if (c) return c;
  }
  return new EngineClient('legacy', 'none', null, null);
}

// ---------------------------------------------------------------------------------------------
// Scene cache: the canvas renderer asks for a frame synchronously; scenes arrive asynchronously.
// Requests made during one draw are batched into a single `frame` call that also syncs the
// document when it changed. Until the fresh scene arrives the previous scene for the same view
// ("slot") is drawn, so editing never flickers.
// ---------------------------------------------------------------------------------------------
export interface SceneSource {
  getRev(): number;
  getDocJson(): string;
  onScene(): void;
}
type Entry = { rev: number; frame: number; nodes: SceneNode[] };

export class SceneStore {
  private cache = new Map<string, Entry>();
  private slots = new Map<string, Entry>();
  private pending = new Map<string, SceneOpts>();
  private inflight = false;
  private sentRev = -1;
  private waiters: Array<() => void> = [];
  constructor(private eng: EngineClient, private src: SceneSource) {}

  static BATCH = 8;
  /** true if a fresh scene for these options is cached */
  has(o: SceneOpts) { const e = this.cache.get(SceneStore.key(o)); return !!e && e.rev === this.src.getRev(); }
  static key(o: SceneOpts) { return JSON.stringify([o.frame, !!o.export, o.only || '', !!o.noTrail, o.swOverride || {}, !!o.noCamera, o.root || '', !!o.want3d]); }
  static slot(o: SceneOpts) { return JSON.stringify([!!o.export, o.only || '', !!o.noTrail, !!o.noCamera, o.root || '', !!o.want3d]); }

  /** Fresh scene if available, else the latest scene for this view (possibly stale), else null. */
  get(o: SceneOpts): SceneNode[] | null {
    const k = SceneStore.key(o), rev = this.src.getRev();
    const e = this.cache.get(k);
    if (e && e.rev === rev) return e.nodes;
    this.request(o);
    const s = this.slots.get(SceneStore.slot(o));
    return s ? s.nodes : null;
  }
  request(o: SceneOpts) {
    const k = SceneStore.key(o);
    const e = this.cache.get(k);
    if (e && e.rev === this.src.getRev()) return;
    this.pending.set(k, o);
    if (!this.inflight) queueMicrotask(() => this.flush());
  }
  /** Await a fresh scene (export, thumbnails). */
  async fetch(o: SceneOpts): Promise<SceneNode[]> {
    for (let i = 0; i < 50; i++) {
      const k = SceneStore.key(o), e = this.cache.get(k);
      if (e && e.rev === this.src.getRev()) return e.nodes;
      this.request(o);
      await new Promise<void>((r) => this.waiters.push(r));
    }
    throw new Error('engine did not answer');
  }
  private async flush() {
    if (this.inflight || !this.pending.size) return;
    this.inflight = true;
    // cap a batch so a single round trip stays short; the rest goes in the next call
    const reqs = [...this.pending.entries()].slice(0, SceneStore.BATCH);
    for (const [k] of reqs) this.pending.delete(k);
    const rev = this.src.getRev();
    const params: Record<string, unknown> = { rev, requests: reqs.map(([, o]) => o) };
    if (rev !== this.sentRev) params.doc = this.src.getDocJson();
    try {
      const r = await this.eng.rpc<{ rev: number; scenes: SceneNode[][] }>('frame', params);
      this.sentRev = rev;
      reqs.forEach(([k, o], i) => {
        const e = { rev, frame: o.frame, nodes: r.scenes[i] };
        this.cache.set(k, e); this.slots.set(SceneStore.slot(o), e);
      });
      if (this.cache.size > 600) { const keep = [...this.cache.entries()].slice(-400); this.cache = new Map(keep); }
    } catch (err) {
      this.sentRev = -1;
      this.eng.fallBack(String(err));
    } finally {
      this.inflight = false;
      const w = this.waiters; this.waiters = []; w.forEach((f) => f());
      this.src.onScene();
      if (this.pending.size) this.flush();
    }
  }
}
