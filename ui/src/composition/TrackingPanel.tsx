import { useEffect, useRef, useState } from "react";
import { canvas, CompositionRenderer } from "./renderer";
import {
  copy,
  id,
  number,
  valueAt,
  type Clip,
  type Composition,
  type CompositionState,
  type EditorHost,
} from "./model";
import {
  grayscale,
  matchPatch,
  patch,
  type MotionTrack,
  type TrackPoint,
} from "./tracking";

export function applyTrackMotion(
  clip: Clip,
  track: MotionTrack,
  evaluate: EditorHost["evaluate"],
) {
  if (!track.points.length) return;
  const first = track.points[0],
    last = track.points[track.points.length - 1];
  for (const [path, axis] of [
    ["x", "x"],
    ["y", "y"],
  ] as const) {
    const initial = number(valueAt(clip, path, first.frame, evaluate)),
      prior = clip.ch[path]?.keys || [];
    const keys = prior.filter(
      (key) => key.f < first.frame || key.f > last.frame,
    );
    if (!keys.length && first.frame > 0)
      keys.push({ f: 0, v: copy(clip.p[path]), i: "linear" });
    keys.push(
      ...track.points.map((point) => ({
        f: point.frame,
        v: initial + point[axis] - first[axis],
        i: "linear",
      })),
    );
    clip.ch[path] = { keys: keys.sort((a, b) => a.f - b.f) };
  }
}

export function TrackingPanel({
  host,
  renderer,
  state,
  composition,
  clip,
  frame,
  point,
  onPick,
  onPause,
  onSave,
  onApply,
}: {
  host: EditorHost;
  renderer: CompositionRenderer;
  state: CompositionState;
  composition: Composition;
  clip: Clip;
  frame: number;
  point: [number, number] | null;
  onPick(): void;
  onPause(): void;
  onSave(track: MotionTrack): void;
  onApply(targetId: string, track: MotionTrack): void;
}) {
  const [end, setEnd] = useState(Math.min(composition.end, frame + 48)),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [target, setTarget] = useState(""),
    [error, setError] = useState("");
  const cancel = useRef(false),
    generation = useRef(0),
    controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      cancel.current = true;
      generation.current++;
      controller.current?.abort();
    },
    [],
  );
  async function analyze() {
    if (!point) return;
    onPause();
    setBusy(true);
    setError("");
    cancel.current = false;
    const token = ++generation.current,
      signal = new AbortController();
    controller.current = signal;
    const cancelled = () => cancel.current || token !== generation.current;
    const revision = host.read().revision,
      documentId = host.read().document,
      captured = copy(state),
      comp = captured.compositions.find((c) => c.id === composition.id)!;
    comp.background = "transparent";
    for (const layer of comp.clips) layer.enabled = layer.id === clip.id;
    const source = comp.clips.find((c) => c.id === clip.id)!;
    delete source.matte;
    source.p.mask = [];
    delete source.ch.mask;
    source.p.opacity = 1;
    delete source.ch.opacity;
    const scale = Math.min(1, 640 / comp.width),
      sample = canvas(comp.width * scale, comp.height * scale),
      ctx = sample.getContext("2d", { willReadFrequently: true })!;
    const last = Math.min(
        Math.round(end),
        frame + 299,
        Math.ceil(clip.start + clip.duration - 1),
        comp.end,
      ),
      points: TrackPoint[] = [];
    try {
      if (
        frame < clip.start ||
        frame > clip.start + clip.duration - 1 ||
        last < frame
      )
        throw new Error(
          "Choose a frame inside the clip and an end frame after it",
        );
      let template: Float32Array | null = null,
        x = point[0] * scale,
        y = point[1] * scale;
      for (let current = frame; current <= last; current++) {
        if (cancelled())
          throw new DOMException("Tracking cancelled", "AbortError");
        if (
          host.read().revision !== revision ||
          host.read().document !== documentId
        )
          throw new Error("The source changed during analysis. Track again.");
        setProgress(`Analyzing ${current} / ${last}`);
        const rendered = await renderer.render(captured, comp.id, current, {
          bypass: true,
          transparent: true,
          signal: signal.signal,
        });
        ctx.clearRect(0, 0, sample.width, sample.height);
        ctx.drawImage(rendered, 0, 0, sample.width, sample.height);
        const gray = grayscale(
          ctx.getImageData(0, 0, sample.width, sample.height).data,
          sample.width,
          sample.height,
        );
        if (!template) {
          template = patch(gray, x, y);
          matchPatch(template, gray, x, y, 0);
          points.push({
            frame: current,
            x: point[0],
            y: point[1],
            confidence: 1,
          });
        } else {
          const match = matchPatch(template, gray, x, y);
          if (match.confidence < 0.55) {
            setError(
              `Tracking lost the feature at frame ${current}. Saved the reliable portion; choose a shorter range or another detail.`,
            );
            break;
          }
          x = match.x;
          y = match.y;
          points.push({
            frame: current,
            x: x / scale,
            y: y / scale,
            confidence: match.confidence,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (cancelled())
        throw new DOMException("Tracking cancelled", "AbortError");
      if (
        host.read().revision !== revision ||
        host.read().document !== documentId
      )
        throw new Error("The source changed during analysis. Track again.");
      if (points.length < 2)
        throw new Error("Track at least two frames of a textured feature");
      onSave({
        id: id(),
        name: `Point track ${(clip.tracks?.length || 0) + 1}`,
        points,
      });
    } catch (err) {
      if (!cancelled())
        setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!cancelled()) {
        setBusy(false);
        setProgress("");
      }
    }
  }
  return (
    <details>
      <summary>Point tracking</summary>
      <p className="comp-muted">
        Tracks translation of a textured feature. Apply its motion to another
        clip as editable position keys.
      </p>
      <div className="comp-button-row">
        <button disabled={busy} onClick={onPick}>
          Pick feature in viewer
        </button>
        {point && (
          <span className="comp-muted">{point.map(Math.round).join(", ")}</span>
        )}
      </div>
      <label className="comp-field">
        <span>Through frame</span>
        <input
          aria-label="Tracking end frame"
          type="number"
          min={frame + 1}
          max={Math.min(composition.end, frame + 299)}
          value={end}
          onChange={(e) => setEnd(Number(e.target.value))}
        />
      </label>
      <div className="comp-button-row">
        <button
          disabled={
            !point ||
            busy ||
            clip.kind === "adjustment" ||
            clip.kind === "audio"
          }
          onClick={() => void analyze()}
        >
          Analyze point motion
        </button>
        {busy && (
          <button
            onClick={() => {
              cancel.current = true;
              generation.current++;
              controller.current?.abort();
              setBusy(false);
              setProgress("");
            }}
          >
            Cancel analysis
          </button>
        )}
      </div>
      {progress && <p role="status">{progress}</p>}
      {error && (
        <p className="comp-tracking-error" role="status">
          {error}
        </p>
      )}
      {(clip.tracks || []).map((track) => (
        <div className="comp-track" key={track.id}>
          <strong>{track.name}</strong>
          <span>
            {track.points.length} frames · {track.points[0].frame}–
            {track.points[track.points.length - 1].frame}
          </span>
          <select
            aria-label={`Target for ${track.name}`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">Choose target clip…</option>
            {composition.clips
              .filter(
                (c) =>
                  c.id !== clip.id &&
                  c.kind !== "adjustment" &&
                  c.kind !== "audio",
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
          <button disabled={!target} onClick={() => onApply(target, track)}>
            Apply tracked position
          </button>
        </div>
      ))}
    </details>
  );
}
