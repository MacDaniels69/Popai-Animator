// Types of the Rust engine's output (crates/popai-core/src/scene.rs). Keep in sync.

export type Mat = [number, number, number, number, number, number];
export type Val = number | number[] | string | boolean | null;

export interface SubPath { closed: boolean; start: [number, number]; segs: number[][] }
export interface ShapeOut { fill: string | null; stroke: string | null; width: number | null; fillOn: boolean; strokeOn: boolean; subpaths: SubPath[] }
export interface Particle { x: number; y: number; vx: number; vy: number; size: number; a: number; col: string; rot: number }
export interface Ghost { frame: number; alpha: number; nodes: SceneNode[] }
export interface FxOut { id: string; type: string; p: Record<string, Val>; ghosts?: Ghost[] }
export interface BoneOut { id: string; f: Mat; len: number; s: number; off: boolean }

export interface SceneNode {
  id: string;
  kind: 'vector' | 'image' | 'text' | 'particle' | 'group' | 'switch' | 'bone' | 'audio' | string;
  /** camera(z) × world — the viewer multiplies its view matrix in front */
  m: Mat;
  z: number;
  /** scale of the camera transform at this depth */
  cs: number;
  op: number;
  anc: boolean;
  blend: string;
  fade?: number;
  fx?: FxOut[];
  mask?: string;
  maskActive?: boolean;
  maskChild?: SceneNode;
  shapes?: ShapeOut[];
  pts?: Record<string, [number, number]>;
  image?: { media: string; iw: number; ih: number };
  text?: { text: string; font: string; size: number; bold: boolean; color: string };
  particles?: { m: Mat; shape: string; list: Particle[] };
  bones?: BoneOut[];
  active?: string;
  children?: SceneNode[];
}

export interface SceneOpts {
  frame: number;
  export?: boolean;
  only?: string;
  noTrail?: boolean;
  swOverride?: Record<string, string>;
  noCamera?: boolean;
  root?: string;
}

export interface EngineInfo { engine: string; version: string; rust: boolean; features: string[] }
