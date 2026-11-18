import type { EngineRuntime } from './contracts';
/** React and native services communicate only through this API, never mutable engine globals. */
export function getEngine(): EngineRuntime {
  const runtime = window.PopaiRuntime;
  if (!runtime || typeof runtime.start !== 'function') throw new Error('Popai animation engine failed to load. Rebuild the application.');
  return runtime;
}
