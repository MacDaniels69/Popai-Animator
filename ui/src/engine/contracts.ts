import type { AIPlanPreview, EditorSnapshot, EffectInput, GeometryInput, SaveCapture } from '../domain/model';
export interface EngineRuntime {
  start(): void;
  read(): EditorSnapshot;
  subscribe(listener: () => void): () => void;
  command(id: string): unknown;
  captureSave(): SaveCapture;
  acknowledgeSave(capture: SaveCapture): boolean;
  openProject(text: string): Promise<boolean>;
  setSaveHandler(handler: () => Promise<void>): void;
  setOpenHandler(handler: () => Promise<void>): void;
  captureGeometry(): GeometryInput | null;
  captureFrame(maxDimension?: number, selectedOnly?: boolean): HTMLCanvasElement;
  markDirty(): void;
  addEffect(input: EffectInput): void;
  showMessage(message: string, error?: boolean): void;
  loadDemo(): void;
  planAI(text: string): Promise<AIPlanPreview>;
  applyAIPlan(token: string): void;
}
export interface DesktopBridge {
  info(): Promise<{ version: string; platform: string }>;
  openProject(): Promise<{ canceled: true } | { canceled: false; name: string; text: string; openToken: string }>;
  bindOpenedProject(input: { documentId: string; openToken: string }): Promise<void>;
  saveProject(input: { documentId: string; name: string; text: string; saveAs?: boolean }): Promise<{ canceled: boolean; name?: string }>;
  saveVideo?(input: { name: string; bytes: Uint8Array }): Promise<{ canceled: boolean; name?: string }>;
  writeRecovery(input: { documentId: string; text: string }): Promise<void>;
  readRecovery(): Promise<string | null>;
  setDirty(input: { dirty: boolean; name: string }): void;
  resolveClose?(allow: boolean): void;
  onCloseRequested?(listener: () => void): () => void;
  onCommand(listener: (command: string) => void): () => void;
}
declare global {
  interface Window { PopaiRuntime: EngineRuntime; popaiDesktop?: DesktopBridge; __POPAI_READY__?: boolean }
}
