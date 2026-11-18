/** Composition data lives in the project, independently of source rig/layer channels. */
export type Value = number | string | boolean | number[];
export interface Key {
  f: number;
  v: Value;
  i?: string;
  hold?: number;
  iv?: number;
  stg?: boolean;
  bz?: number[];
  cy?: number;
  cm?: string;
  label?: string;
  [key: string]: unknown;
}
export interface Channel {
  keys: Key[];
}
export interface Effect {
  id: string;
  type: string;
  enabled: boolean;
  p: Record<string, Value>;
}
export type ClipKind =
  | "scene"
  | "layer"
  | "image"
  | "video"
  | "audio"
  | "solid"
  | "text"
  | "adjustment"
  | "precomp"
  | "particles"
  | "sequence";
export interface Clip {
  id: string;
  name: string;
  kind: ClipKind;
  source?: string;
  start: number;
  duration: number;
  in: number;
  speed: number;
  enabled: boolean;
  blend: GlobalCompositeOperation;
  matte?: string;
  matteMode: "alpha" | "alpha-invert" | "luma" | "luma-invert";
  p: Record<string, Value>;
  ch: Record<string, Channel>;
  effects: Effect[];
  sequence?: string[];
  sourceFps?: number;
  tracks?: import("./tracking").MotionTrack[];
}
export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  end: number;
  background: string;
  clips: Clip[];
}
export interface Asset {
  id: string;
  name: string;
  type: "image" | "video" | "audio";
  url: string;
  duration?: number;
  width?: number;
  height?: number;
}
export interface CompositionState {
  version: 1;
  active: string;
  compositions: Composition[];
  assets: string[];
  presets?: { id: string; name: string; effects: Effect[] }[];
}
export interface Project {
  name: string;
  w: number;
  h: number;
  fps: number;
  end: number;
  bg: string;
  layers: Array<{
    id: string;
    name: string;
    type: string;
    children?: Project["layers"];
    media?: string;
    offset?: number;
    vis?: boolean;
    mute?: boolean;
    p?: Record<string, Value>;
    ch?: Record<string, Channel>;
  }>;
  media: Record<string, Asset>;
  composition?: CompositionState;
}
export interface EditorHost {
  read(): { doc: Project; revision: number; document: number; frame: number };
  subscribe(fn: () => void): () => void;
  edit(label: string, fn: (doc: Project) => void): void;
  evaluate(channel: Channel, frame: number): Value;
  renderSource(frame: number, layer?: string): Promise<HTMLCanvasElement>;
  applyEffect(canvas: HTMLCanvasElement, effect: Effect, frame: number): void;
  command(id: string): void;
  pause(): void;
  download(blob: Blob, name: string): Promise<void>;
  zip(files: { name: string; data: Uint8Array }[]): Blob;
}
export const id = () => crypto.randomUUID();
export const copy = <T>(value: T): T => structuredClone(value);
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
export const number = (value: Value | undefined, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
export function createClip(
  kind: ClipKind,
  name: string,
  duration: number,
  source?: string,
): Clip {
  return {
    id: id(),
    kind,
    name,
    ...(source ? { source } : {}),
    start: 0,
    duration,
    in: 0,
    speed: 1,
    enabled: true,
    blend: "source-over",
    matteMode: "alpha",
    p: {
      x: 0,
      y: 0,
      sx: 1,
      sy: 1,
      rotation: 0,
      opacity: 1,
      gain: 1,
      color: "#3f88c5",
      text: "Your title",
      size: kind === "particles" ? 12 : 72,
      mask: [],
      feather: 0,
      invertMask: false,
      rate: 30,
      life: 1.4,
      seed: 7,
      burst: 0,
      speed: 160,
      angle: -90,
      spread: 90,
      gravity: 200,
    },
    ch: {},
    effects: [],
  };
}
export function defaultState(doc: Project): CompositionState {
  const scene = createClip("scene", "Animation · Mainline", doc.end + 1);
  scene.id = "animation-mainline";
  return {
    version: 1,
    active: "composition-main",
    assets: [],
    compositions: [
      {
        id: "composition-main",
        name: "Main composition",
        width: doc.w,
        height: doc.h,
        fps: doc.fps,
        end: doc.end,
        background: doc.bg,
        clips: [scene],
      },
    ],
  };
}
/** Viewing a workspace never adds document data or keys. */
export const stateOf = (doc: Project) => doc.composition || defaultState(doc);
export function activeComposition(state: CompositionState) {
  return (
    state.compositions.find((c) => c.id === state.active) ||
    state.compositions[0]
  );
}
export function sourceTime(
  clip: Clip,
  frame: number,
  fps: number,
): number | null {
  if (frame < clip.start || frame >= clip.start + clip.duration) return null;
  return (clip.in + (frame - clip.start) * clip.speed) / fps;
}
export function valueAt(
  clip: Clip,
  path: string,
  frame: number,
  evaluate: EditorHost["evaluate"],
): Value {
  const keys = clip.ch[path];
  if (keys?.keys.length) return evaluate(keys, frame);
  if (path.startsWith("fx:")) {
    const [, fx, parameter] = path.split(":");
    return clip.effects.find((e) => e.id === fx)?.p[parameter] ?? 0;
  }
  return clip.p[path] ?? 0;
}
export function setBase(clip: Clip, path: string, value: Value) {
  if (path.startsWith("fx:")) {
    const [, fx, parameter] = path.split(":");
    const effect = clip.effects.find((e) => e.id === fx);
    if (effect) effect.p[parameter] = copy(value);
  } else clip.p[path] = copy(value);
}
export function setParameter(
  clip: Clip,
  path: string,
  value: Value,
  frame: number,
  autoKey: boolean,
  evaluate: EditorHost["evaluate"],
  interpolation = "smooth",
  force = false,
) {
  const existing = clip.ch[path];
  if (interpolation === "copy")
    interpolation =
      [...(existing?.keys || [])].reverse().find((key) => key.f < frame)?.i ||
      "smooth";
  if (interpolation === "cycle" || interpolation === "copy")
    interpolation = "smooth";
  if (
    typeof value === "boolean" ||
    typeof value === "string" ||
    path === "mask"
  )
    interpolation = "step";
  if (!force && !existing?.keys.length && (!autoKey || frame === 0)) {
    setBase(clip, path, value);
    return;
  }
  if (!existing) {
    clip.ch[path] = { keys: [] };
    if (frame > 0)
      clip.ch[path].keys.push({
        f: 0,
        v: copy(valueAt(clip, path, 0, evaluate)),
        i: interpolation,
      });
  }
  const channel = clip.ch[path];
  const current = channel.keys.find((k) => k.f === frame);
  if (current) current.v = copy(value);
  else
    channel.keys.push({
      f: frame,
      v: copy(value),
      i:
        typeof value === "boolean" ||
        typeof value === "string" ||
        path === "mask"
          ? "step"
          : interpolation,
    });
  channel.keys.sort((a, b) => a.f - b.f);
}
export function removeEffect(clip: Clip, effectId: string) {
  clip.effects = clip.effects.filter((e) => e.id !== effectId);
  for (const path of Object.keys(clip.ch))
    if (path.startsWith(`fx:${effectId}:`)) delete clip.ch[path];
}
export function duplicateClip(clip: Clip): Clip {
  const result = copy(clip);
  result.id = id();
  result.name += " copy";
  for (const effect of result.effects) {
    const old = effect.id;
    effect.id = id();
    for (const path of Object.keys(result.ch))
      if (path.startsWith(`fx:${old}:`)) {
        result.ch[path.replace(`fx:${old}:`, `fx:${effect.id}:`)] =
          result.ch[path];
        delete result.ch[path];
      }
  }
  return result;
}
export function makePrecomp(
  state: CompositionState,
  composition: Composition,
  clipIds: string[],
): Clip {
  const selected = composition.clips.filter((c) => clipIds.includes(c.id));
  if (!selected.length) throw new Error("Select clips to precompose");
  // Keep matte references inside the same composition by including their dependencies.
  const include = (c: Clip) => {
    if (!c.matte) return;
    const matte = composition.clips.find((m) => m.id === c.matte);
    if (matte && !selected.includes(matte)) {
      selected.push(matte);
      include(matte);
    }
  };
  selected.forEach(include);
  if (
    composition.clips.some(
      (c) =>
        !selected.includes(c) &&
        c.matte &&
        selected.some((s) => s.id === c.matte),
    )
  )
    throw new Error("A selected matte is used by an unselected clip");
  selected.sort(
    (a, b) => composition.clips.indexOf(a) - composition.clips.indexOf(b),
  );
  const first = Math.min(...selected.map((c) => c.start)),
    last = Math.max(...selected.map((c) => c.start + c.duration));
  const nested: Composition = {
    ...composition,
    id: id(),
    name: selected.length === 1 ? selected[0].name : "Precomposition",
    end: Math.max(0, last - first - 1),
    background: "transparent",
    clips: selected.map((c) => {
      const result = copy(c);
      result.start -= first;
      for (const channel of Object.values(result.ch))
        for (const key of channel.keys) {
          key.f -= first;
          if (
            key.i === "cycle" &&
            key.cm !== "rel" &&
            typeof key.cy === "number"
          )
            key.cy -= first;
        }
      return result;
    }),
  };
  const reference = createClip("precomp", nested.name, last - first, nested.id);
  reference.start = first;
  const at = Math.max(...selected.map((c) => composition.clips.indexOf(c)));
  composition.clips = composition.clips.flatMap((c, i) =>
    i === at ? [reference] : selected.includes(c) ? [] : [c],
  );
  state.compositions.push(nested);
  return reference;
}
export function validateCompositionState(state: CompositionState) {
  if (
    !state ||
    state.version !== 1 ||
    !Array.isArray(state.compositions) ||
    !Array.isArray(state.assets) ||
    !state.assets.every((asset) => typeof asset === "string") ||
    typeof state.active !== "string" ||
    (state.presets !== undefined && !Array.isArray(state.presets)) ||
    !state.compositions.length ||
    state.compositions.length > 100
  )
    throw new Error("Unsupported composition data");
  const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
  const validValue = (value: unknown): boolean =>
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) &&
      value.length <= 10000 &&
      value.every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ));
  const validateEffects = (effects: Effect[]) => {
    if (
      !Array.isArray(effects) ||
      effects.length > 40 ||
      new Set(effects.map((effect) => effect?.id)).size !== effects.length
    )
      throw new Error("Invalid effect stack");
    for (const effect of effects)
      if (
        !effect ||
        typeof effect.id !== "string" ||
        typeof effect.type !== "string" ||
        typeof effect.enabled !== "boolean" ||
        !record(effect.p) ||
        !Object.values(effect.p).every(validValue)
      )
        throw new Error("Invalid effect parameters");
  };
  if (state.presets && state.presets.length > 500)
    throw new Error("Too many effect presets");
  for (const preset of state.presets || []) {
    if (
      !preset ||
      typeof preset.name !== "string" ||
      typeof preset.id !== "string"
    )
      throw new Error("Invalid effect preset");
    validateEffects(preset.effects);
  }
  const ids = new Set<string>();
  for (const composition of state.compositions) {
    if (
      !composition ||
      typeof composition.id !== "string" ||
      typeof composition.name !== "string" ||
      typeof composition.background !== "string"
    )
      throw new Error("Invalid composition identity");
    if (ids.has(composition.id)) throw new Error("Duplicate composition ID");
    ids.add(composition.id);
    if (
      !Number.isFinite(composition.width) ||
      !Number.isFinite(composition.height) ||
      composition.width < 1 ||
      composition.height < 1 ||
      composition.width > 8192 ||
      composition.height > 8192 ||
      composition.width * composition.height > 16777216 ||
      !Number.isFinite(composition.fps) ||
      composition.fps < 1 ||
      composition.fps > 240 ||
      !Number.isInteger(composition.end) ||
      composition.end < 0 ||
      composition.end > 100000 ||
      !Array.isArray(composition.clips) ||
      composition.clips.length > 500
    )
      throw new Error(
        "Invalid composition dimensions or duration (maximum 16 megapixels)",
      );
    if (composition.clips.some((clip) => !clip || typeof clip.id !== "string"))
      throw new Error("Invalid clip identity");
    const clips = new Map(composition.clips.map((c) => [c.id, c]));
    if (clips.size !== composition.clips.length)
      throw new Error("Duplicate clip ID");
    for (const clip of composition.clips) {
      if (
        typeof clip.name !== "string" ||
        ![
          "scene",
          "layer",
          "image",
          "video",
          "audio",
          "solid",
          "text",
          "adjustment",
          "precomp",
          "particles",
          "sequence",
        ].includes(clip.kind) ||
        !record(clip.p) ||
        !record(clip.ch) ||
        !Object.values(clip.p).every(validValue)
      )
        throw new Error("Invalid composition clip");
      validateEffects(clip.effects);
      if (
        clip.sequence &&
        (!Array.isArray(clip.sequence) ||
          clip.sequence.length > 10000 ||
          !clip.sequence.every((id) => typeof id === "string"))
      )
        throw new Error("Invalid image sequence");
      if (
        clip.sourceFps !== undefined &&
        (!Number.isFinite(clip.sourceFps) ||
          clip.sourceFps < 1 ||
          clip.sourceFps > 240)
      )
        throw new Error("Invalid image-sequence frame rate");
      if (Object.keys(clip.ch).length > 1000)
        throw new Error("Too many animation channels");
      for (const channel of Object.values(clip.ch)) {
        if (
          !channel ||
          !Array.isArray(channel.keys) ||
          channel.keys.length > 10000
        )
          throw new Error("Invalid composition channel");
        for (const key of channel.keys) {
          if (!key || !Number.isFinite(key.f) || !validValue(key.v))
            throw new Error("Invalid composition keyframe");
          for (const field of ["hold", "iv", "na", "nf", "cy"])
            if (
              key[field] !== undefined &&
              (typeof key[field] !== "number" || !Number.isFinite(key[field]))
            )
              throw new Error("Invalid keyframe timing");
          if (
            key.bz !== undefined &&
            (!Array.isArray(key.bz) ||
              key.bz.length !== 4 ||
              !key.bz.every(Number.isFinite))
          )
            throw new Error("Invalid Bezier keyframe");
        }
      }
      if (
        clip.tracks &&
        (!Array.isArray(clip.tracks) ||
          clip.tracks.length > 100 ||
          clip.tracks.some(
            (track) =>
              !track ||
              typeof track.name !== "string" ||
              !Array.isArray(track.points) ||
              track.points.length > 10000 ||
              track.points.some(
                (point) =>
                  !point ||
                  ![point.frame, point.x, point.y, point.confidence].every(
                    Number.isFinite,
                  ),
              ),
          ))
      )
        throw new Error("Invalid motion track");
      if (
        ![clip.start, clip.duration, clip.in, clip.speed].every(
          Number.isFinite,
        ) ||
        clip.duration < 1 ||
        clip.start < 0 ||
        Math.abs(clip.speed) > 16 ||
        !Array.isArray(clip.effects) ||
        clip.effects.length > 40
      )
        throw new Error("Invalid clip timing or effects");
      const seen = new Set([clip.id]);
      let next = clip.matte;
      while (next) {
        if (seen.has(next)) throw new Error("A matte cannot depend on itself");
        seen.add(next);
        const target = clips.get(next);
        if (!target) throw new Error("Missing matte source");
        next = target.matte;
      }
    }
  }
  let visits = 0;
  const visit = (key: string, ancestors: Set<string>) => {
    if (++visits > 10000) throw new Error("Composition graph is too complex");
    if (ancestors.has(key))
      throw new Error("A precomposition cannot contain itself");
    const composition = state.compositions.find((c) => c.id === key);
    if (!composition) throw new Error("Missing precomposition");
    const path = new Set(ancestors).add(key);
    if (path.size > 12) throw new Error("Precomposition nesting is too deep");
    for (const clip of composition.clips)
      if (clip.kind === "precomp") visit(clip.source || "", path);
  };
  state.compositions.forEach((c) => visit(c.id, new Set()));
}
