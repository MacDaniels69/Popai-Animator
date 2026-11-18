import test from "node:test";
import assert from "node:assert/strict";
import {
  copy,
  createClip,
  defaultState,
  duplicateClip,
  makePrecomp,
  removeEffect,
  setParameter,
  sourceTime,
  validateCompositionState,
  valueAt,
} from "../src/composition/model";
import type { Channel, Project, Value } from "../src/composition/model";
import {
  mattePixels,
  mixAdjustment,
  newEffect,
  processPixels,
} from "../src/composition/effects";
import { matchPatch, patch } from "../src/composition/tracking";
import { particlePositions } from "../src/composition/particles";
import { applyTrackMotion } from "../src/composition/TrackingPanel";
import { compositionAudio } from "../src/composition/media";

const doc = (): Project => ({
  name: "Test",
  w: 1280,
  h: 720,
  fps: 24,
  end: 72,
  bg: "#ffffff",
  layers: [],
  media: {},
});
const evaluate = (channel: Channel, frame: number): Value => {
  const a =
      [...channel.keys].reverse().find((k) => k.f <= frame) || channel.keys[0],
    b = channel.keys.find((k) => k.f > frame);
  if (
    !b ||
    a.i === "step" ||
    typeof a.v !== "number" ||
    typeof b.v !== "number"
  )
    return a.v;
  return a.v + (b.v - a.v) * ((frame - a.f) / (b.f - a.f));
};
test("viewing Composition leaves the original project and its channels untouched", () => {
  const project = doc(),
    before = JSON.stringify(project);
  const state = defaultState(project);
  assert.equal(JSON.stringify(project), before);
  assert.equal(state.compositions[0].clips[0].kind, "scene");
  assert.deepEqual(state.compositions[0].clips[0].ch, {});
});
test("static parameter edits do not invent keys", () => {
  const clip = createClip("solid", "Plate", 48);
  setParameter(clip, "opacity", 0.4, 12, false, evaluate);
  assert.equal(clip.p.opacity, 0.4);
  assert.deepEqual(clip.ch, {});
});
test("auto-key anchors only the edited composition parameter", () => {
  const clip = createClip("scene", "Live scene", 48);
  setParameter(clip, "opacity", 0.2, 12, true, evaluate);
  assert.deepEqual(
    clip.ch.opacity.keys.map((k) => [k.f, k.v]),
    [
      [0, 1],
      [12, 0.2],
    ],
  );
  assert.deepEqual(Object.keys(clip.ch), ["opacity"]);
});
test("existing animation edits update its key without changing the base", () => {
  const clip = createClip("scene", "Scene", 48);
  setParameter(clip, "x", 100, 12, true, evaluate);
  setParameter(clip, "x", 200, 12, false, evaluate);
  assert.equal(clip.p.x, 0);
  assert.equal(clip.ch.x.keys.length, 2);
  assert.equal(clip.ch.x.keys[1].v, 200);
});
test("effect parameter keys are separate from transforms", () => {
  const clip = createClip("scene", "Scene", 48),
    effect = newEffect("glow");
  clip.effects.push(effect);
  setParameter(clip, `fx:${effect.id}:intensity`, 3, 24, true, evaluate);
  assert.equal(valueAt(clip, `fx:${effect.id}:intensity`, 12, evaluate), 2.25);
  assert.equal(clip.p.opacity, 1);
});
test("clip placement, source slip, speed, and frame rate map independently", () => {
  const clip = createClip("video", "Footage", 30);
  clip.start = 12;
  clip.in = 24;
  clip.speed = 2;
  assert.equal(sourceTime(clip, 11, 24), null);
  assert.equal(sourceTime(clip, 12, 24), 1);
  assert.equal(sourceTime(clip, 24, 24), 2);
  assert.equal(sourceTime(clip, 42, 24), null);
});
test("reverse footage maps backward from its source in point", () => {
  const clip = createClip("video", "Reverse", 25);
  clip.in = 48;
  clip.speed = -1;
  assert.equal(sourceTime(clip, 24, 24), 1);
});
test("duplicating clips gives effects independent identities and remaps keys", () => {
  const clip = createClip("scene", "Scene", 48),
    effect = newEffect("blur");
  clip.effects.push(effect);
  setParameter(clip, `fx:${effect.id}:radius`, 30, 24, true, evaluate);
  const result = duplicateClip(clip);
  assert.notEqual(result.id, clip.id);
  assert.notEqual(result.effects[0].id, effect.id);
  assert.ok(result.ch[`fx:${result.effects[0].id}:radius`]);
  assert.ok(clip.ch[`fx:${effect.id}:radius`]);
});
test("removing an effect removes only its channels", () => {
  const clip = createClip("scene", "Scene", 48),
    effect = newEffect("blur");
  clip.effects.push(effect);
  setParameter(clip, `fx:${effect.id}:radius`, 30, 24, true, evaluate);
  setParameter(clip, "x", 10, 24, true, evaluate);
  removeEffect(clip, effect.id);
  assert.deepEqual(Object.keys(clip.ch), ["x"]);
});
test("precomposition preserves parent-time animation by offsetting keys", () => {
  const state = defaultState(doc()),
    comp = state.compositions[0],
    clip = comp.clips[0];
  clip.start = 20;
  clip.duration = 30;
  setParameter(clip, "x", 100, 30, true, evaluate);
  const before = Number(valueAt(clip, "x", 25, evaluate)),
    reference = makePrecomp(state, comp, [clip.id]),
    nested = state.compositions.find((c) => c.id === reference.source)!;
  assert.equal(reference.start, 20);
  assert.equal(nested.clips[0].start, 0);
  assert.equal(valueAt(nested.clips[0], "x", 5, evaluate), before);
  validateCompositionState(state);
});
test("precomposition includes matte dependencies in original stack order", () => {
  const state = defaultState(doc()),
    comp = state.compositions[0],
    matte = createClip("solid", "Matte", 48);
  comp.clips.unshift(matte);
  comp.clips[1].matte = matte.id;
  const ref = makePrecomp(state, comp, [comp.clips[1].id]),
    nested = state.compositions.find((c) => c.id === ref.source)!;
  assert.deepEqual(
    nested.clips.map((c) => c.name),
    ["Matte", "Animation · Mainline"],
  );
  validateCompositionState(state);
});
test("matte cycles are rejected", () => {
  const state = defaultState(doc()),
    comp = state.compositions[0],
    second = createClip("solid", "Matte", 48);
  comp.clips.push(second);
  comp.clips[0].matte = second.id;
  second.matte = comp.clips[0].id;
  assert.throws(() => validateCompositionState(state), /depend on itself/);
});
test("precomp recursion is rejected", () => {
  const state = defaultState(doc()),
    comp = state.compositions[0];
  comp.clips.push(createClip("precomp", "Bad", 48, comp.id));
  assert.throws(() => validateCompositionState(state), /contain itself/);
});
test("invalid timing and excessive buffer dimensions are rejected", () => {
  const state = defaultState(doc());
  state.compositions[0].clips[0].speed = Infinity;
  assert.throws(() => validateCompositionState(state), /timing/);
  const huge = defaultState(doc());
  huge.compositions[0].width = huge.compositions[0].height = 8192;
  assert.throws(() => validateCompositionState(huge), /megapixels/);
});
test("composition sources and keys survive JSON save/reopen", () => {
  const project = doc();
  project.composition = defaultState(project);
  const clip = project.composition.compositions[0].clips[0];
  clip.effects.push(newEffect("keyer"));
  setParameter(clip, "opacity", 0.25, 24, true, evaluate);
  const reopened = JSON.parse(JSON.stringify(project));
  validateCompositionState(reopened.composition);
  assert.deepEqual(reopened, project);
});
test("chroma key removes green while retaining red and existing alpha", () => {
  const pixels = new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 128]);
  processPixels(pixels, "keyer", {
    color: "#00ff00",
    tolerance: 0.2,
    softness: 0.1,
    despill: 0,
  });
  assert.equal(pixels[3], 0);
  assert.equal(pixels[7], 128);
});
test("key softness creates partial transparency at an edge", () => {
  const pixels = new Uint8ClampedArray([0, 180, 0, 255]);
  processPixels(pixels, "keyer", {
    color: "#00ff00",
    tolerance: 0.1,
    softness: 0.2,
    despill: 0,
  });
  assert.ok(pixels[3] > 0 && pixels[3] < 255);
});
test("exposure changes light but preserves alpha", () => {
  const pixels = new Uint8ClampedArray([20, 40, 80, 128]);
  processPixels(pixels, "exposure", { stops: 1 });
  assert.deepEqual([...pixels], [40, 80, 160, 128]);
});
test("levels retain neutral values at identity settings", () => {
  const pixels = new Uint8ClampedArray([12, 100, 230, 64]),
    original = new Uint8ClampedArray(pixels);
  processPixels(pixels, "levels", { black: 0, white: 1, gamma: 1 });
  assert.deepEqual(pixels, original);
});
test("luma mattes include source alpha", () => {
  const pixels = new Uint8ClampedArray([255, 255, 255, 128, 0, 0, 0, 255]);
  mattePixels(pixels, true, false);
  assert.equal(pixels[3], 128);
  assert.equal(pixels[7], 0);
});
test("inverted alpha matte reverses coverage", () => {
  const pixels = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]);
  mattePixels(pixels, false, true);
  assert.equal(pixels[3], 255);
  assert.equal(pixels[7], 0);
});
test("adjustment mix preserves full opacity at half strength", () => {
  const original = new Uint8ClampedArray([100, 100, 100, 255]);
  mixAdjustment(original, new Uint8ClampedArray([200, 200, 200, 255]), 0.5);
  assert.deepEqual([...original], [150, 150, 150, 255]);
});
test("masked adjustments leave pixels outside the matte unchanged", () => {
  const original = new Uint8ClampedArray([10, 20, 30, 255]),
    saved = copy(original);
  mixAdjustment(
    original,
    new Uint8ClampedArray([200, 200, 200, 255]),
    1,
    new Uint8ClampedArray([255, 255, 255, 0]),
  );
  assert.deepEqual(original, saved);
});
test("adjustment mixing uses premultiplied color on transparent edges", () => {
  const original = new Uint8ClampedArray([255, 0, 0, 255]);
  mixAdjustment(original, new Uint8ClampedArray([0, 0, 255, 0]), 0.5);
  assert.deepEqual([...original], [255, 0, 0, 128]);
});
test("point tracker finds a translated textured feature", () => {
  const make = (dx: number, dy: number) => {
    const pixels = new Float32Array(64 * 64).fill(30);
    for (let y = -5; y <= 5; y++)
      for (let x = -5; x <= 5; x++)
        pixels[(32 + dy + y) * 64 + 32 + dx + x] =
          ((x * 7 + y * 13 + 97) ** 2 % 193) + 40;
    return { width: 64, height: 64, pixels };
  };
  const template = patch(make(0, 0), 32, 32),
    result = matchPatch(template, make(4, -3), 32, 32, 10);
  assert.equal(result.x, 36);
  assert.equal(result.y, 29);
  assert.ok(result.confidence > 0.99);
});
test("point tracker rejects untextured features", () => {
  const frame = {
    width: 32,
    height: 32,
    pixels: new Float32Array(1024).fill(20),
  };
  assert.throws(
    () => matchPatch(patch(frame, 16, 16), frame, 16, 16),
    /little texture/,
  );
});
test("applying a track makes editable position keys and preserves keys outside its range", () => {
  const clip = createClip("text", "Label", 48);
  clip.ch.x = {
    keys: [
      { f: 0, v: 10, i: "linear" },
      { f: 40, v: 10, i: "linear" },
    ],
  };
  applyTrackMotion(
    clip,
    {
      id: "track",
      name: "Motion",
      points: [
        { frame: 12, x: 100, y: 80, confidence: 1 },
        { frame: 13, x: 105, y: 77, confidence: 1 },
      ],
    },
    evaluate,
  );
  assert.equal(clip.ch.x.keys.find((k) => k.f === 13)?.v, 15);
  assert.equal(clip.ch.y.keys.find((k) => k.f === 13)?.v, -3);
  assert.ok(clip.ch.x.keys.some((k) => k.f === 40));
});
test("particle bursts render deterministically and expire", () => {
  const clip = createClip("particles", "Dust", 48);
  clip.p.burst = 20;
  const a = particlePositions(clip, 12, 0.5, evaluate),
    b = particlePositions(clip, 12, 0.5, evaluate);
  assert.deepEqual(a, b);
  assert.equal(a.length, 20);
  assert.equal(particlePositions(clip, 72, 3, evaluate).length, 0);
});
test("particle seed changes the motion without accumulating simulation state", () => {
  const clip = createClip("particles", "Sparks", 48);
  clip.p.burst = 10;
  const a = particlePositions(clip, 12, 0.5, evaluate);
  clip.p.seed = 99;
  const b = particlePositions(clip, 12, 0.5, evaluate);
  assert.notDeepEqual(a, b);
  clip.p.seed = 7;
  assert.deepEqual(particlePositions(clip, 12, 0.5, evaluate), a);
});
test("copy-previous key inherits interpolation without copying the pose", () => {
  const clip = createClip("solid", "Plate", 48);
  clip.ch.x = { keys: [{ f: 0, v: 10, i: "linear" }] };
  setParameter(clip, "x", 75, 12, true, evaluate, "copy");
  assert.deepEqual(clip.ch.x.keys[1], { f: 12, v: 75, i: "linear" });
});
test("live-scene audio respects its offset and instance source time", () => {
  const project = doc();
  project.media.voice = {
    id: "voice",
    name: "Voice",
    type: "audio",
    url: "data:audio/wav;base64,",
    duration: 5,
  };
  project.layers.push({
    id: "voice-layer",
    name: "Dialogue",
    type: "audio",
    media: "voice",
    offset: 12,
    p: { gain: 0.5 },
  });
  const state = defaultState(project);
  const requests = compositionAudio(
    project,
    state,
    state.compositions[0],
    24,
    evaluate,
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].seconds, 0.5);
  assert.equal(requests[0].gain, 0.5);
});
test("precomposition audio maps nested frame rates and speed", () => {
  const project = doc();
  project.media.video = {
    id: "video",
    name: "Footage",
    type: "video",
    url: "data:video/webm;base64,",
    duration: 5,
  };
  const state = defaultState(project),
    parent = state.compositions[0],
    nested = {
      ...copy(parent),
      id: "nested",
      fps: 48,
      clips: [createClip("video", "Footage", 240, "video")],
    };
  const instance = createClip("precomp", "Nested", 100, nested.id);
  instance.speed = 2;
  parent.clips = [instance];
  state.compositions.push(nested);
  const requests = compositionAudio(project, state, parent, 24, evaluate);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].seconds, 2);
  assert.equal(requests[0].rate, 2);
});
test("reverse footage does not play mismatched forward audio", () => {
  const project = doc();
  project.media.video = {
    id: "video",
    name: "Footage",
    type: "video",
    url: "data:video/webm;base64,",
    duration: 5,
  };
  const state = defaultState(project),
    current = createClip("video", "Reverse", 48, "video");
  current.in = 48;
  current.speed = -1;
  state.compositions[0].clips = [current];
  assert.deepEqual(
    compositionAudio(project, state, state.compositions[0], 12, evaluate),
    [],
  );
});
test("film grain is reproducible and retains alpha", () => {
  const original = new Uint8ClampedArray([
      100, 100, 100, 128, 100, 100, 100, 255,
    ]),
    a = new Uint8ClampedArray(original),
    b = new Uint8ClampedArray(original);
  processPixels(a, "grain", { amount: 0.4, size: 1, seed: 7 }, 2);
  processPixels(b, "grain", { amount: 0.4, size: 1, seed: 7 }, 2);
  assert.deepEqual(a, b);
  assert.equal(a[3], 128);
  assert.equal(a[7], 255);
  assert.notDeepEqual(a, original);
});
test("malformed composition extensions are rejected before mounting the workspace", () => {
  assert.throws(
    () => validateCompositionState(null as never),
    /Unsupported composition/,
  );
  const badPresets = defaultState(doc());
  badPresets.presets = {} as never;
  assert.throws(
    () => validateCompositionState(badPresets),
    /Unsupported composition/,
  );
  const badClip = defaultState(doc());
  badClip.compositions[0].clips[0].p = null as never;
  assert.throws(
    () => validateCompositionState(badClip),
    /Invalid composition clip/,
  );
});
test("non-finite key values and malformed effect parameters are rejected", () => {
  const state = defaultState(doc()),
    clip = state.compositions[0].clips[0];
  clip.ch.x = { keys: [{ f: 0, v: Infinity }] };
  assert.throws(() => validateCompositionState(state), /keyframe/);
  delete clip.ch.x;
  clip.effects.push({ ...newEffect("glow"), p: null as never });
  assert.throws(() => validateCompositionState(state), /effect parameters/);
});
