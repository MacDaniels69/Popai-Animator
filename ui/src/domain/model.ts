/** Persisted project format 1. Runtime objects are validated at the engine boundary. */
export type Vec2 = [number, number];
export type Matrix2D = [number, number, number, number, number, number];
export type Value = number | boolean | string | Vec2 | null;
export type Interpolation = 'smooth' | 'linear' | 'ease' | 'easein' | 'easeout' | 'step' | 'bounce' | 'elastic';
export interface Keyframe { f: number; v: Value; i?: Interpolation }
export interface Channel { keys: Keyframe[] }
export type Channels = Record<string, Channel>;
export type LayerType = 'vector' | 'bone' | 'switch' | 'group' | 'image' | 'text' | 'audio' | 'particle';
export interface Transform { x: number; y: number; z: number; rot: number; sx: number; sy: number; ox: number; oy: number; opacity: number; visible: boolean }
export interface Effect { id: string; type: string; on: boolean; p: Record<string, number | boolean | string> }
export interface LayerBase { id: string; name: string; type: LayerType; p: Transform; ch: Channels; fx: Effect[]; lock: boolean; vis: boolean; render: boolean; open: boolean }
export interface Point { x: number; y: number; c?: number; hin?: Vec2; hout?: Vec2; width?: number; alpha?: number; color?: string; strength?: number; b?: [string, number][] }
export interface Curve { id: string; pts: string[]; closed: boolean; start?: number; end?: number; profile?: string | null; repeats?: number; offset?: number }
export interface Shape { id: string; paths: string[]; fill: string; stroke: string; width: number; fillOn: boolean; strokeOn: boolean; styleId?: string | null }
export interface VectorLayer extends LayerBase { type: 'vector'; pts: Record<string, Point>; paths: Curve[]; shapes: Shape[]; pointGroups?: { id: string; name: string; points: string[] }[] }
export interface Bone { id: string; name: string; parent: string | null; x: number; y: number; a: number; len: number; s?: number; str?: number }
export interface BoneLayer extends LayerBase { type: 'bone'; children: Layer[]; bones: Bone[] }
export interface GroupLayer extends LayerBase { type: 'group' | 'switch'; children: Layer[] }
export interface AssetLayer extends LayerBase { type: 'image' | 'text' | 'audio' | 'particle'; media?: string }
export type Layer = VectorLayer | BoneLayer | GroupLayer | AssetLayer;
export interface Project { v: 1; name: string; w: number; h: number; fps: number; end: number; bg: string; layers: Layer[]; camera: { id: 'CAM'; p: Record<string, number>; ch: Channels }; styles: unknown[]; media: Record<string, unknown>; markers: unknown[] }
export interface EditorSnapshot {
  documentId: string; revision: number; name: string; dirty: boolean; frame: number; end: number; fps: number;
  width: number; height: number; mode: 'setup' | 'animate'; playing: boolean; tool: string;
  selectedId: string | null; selectedName: string; selectedType: LayerType | null;
  layerCount: number; pointCount: number; selectedPointCount: number; boneCount: number; effectCount: number;
  canUndo: boolean; canRedo: boolean;
}
export type Cubic = [Vec2, Vec2, Vec2, Vec2];
export interface GeometryInput { token: string; paths: { id: string; closed: boolean; segments: Cubic[] }[] }
export interface GeometryResult { token: string; pathCount: number; segmentCount: number; sampleCount: number; length: number; bounds: [number, number, number, number] | null; durationMs: number }
export interface SaveCapture { documentId: string; signature: string; text: string; name: string }
export interface EffectInput { type: 'color' | 'glow' | 'blur'; params: Record<string, number | string> }
export interface AIPlanPreview { token: string; engine: string; notes: string[]; commands: { description: string; operation: string; error: string | null }[] }
