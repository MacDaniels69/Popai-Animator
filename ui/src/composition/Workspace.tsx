import { useEffect, useMemo, useRef, useState } from "react";
import { EFFECTS, newEffect } from "./effects";
import { assetDuration, inspectFile } from "./media";
import { CompositionRenderer } from "./renderer";
import { TrackingPanel, applyTrackMotion } from "./TrackingPanel";
import { MaskOverlay } from "./MaskOverlay";
import {
  activeComposition,
  clamp,
  copy,
  createClip,
  duplicateClip,
  id,
  makePrecomp,
  number,
  removeEffect,
  setParameter,
  stateOf,
  validateCompositionState,
  valueAt,
  type Asset,
  type Clip,
  type Composition,
  type CompositionState,
  type EditorHost,
  type Key,
  type Value,
} from "./model";
import "./composition.css";

const INTERPOLATIONS = [
  "smooth",
  "linear",
  "ease",
  "easein",
  "easeout",
  "bezier",
  "step",
  "noisy",
  "cycle",
  "bounce",
  "elastic",
];
const BLENDS = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "lighter",
  "darken",
  "lighten",
  "color-dodge",
  "difference",
] as const;
const blobOf = (source: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    source.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Image encoding failed")),
      "image/png",
    ),
  );
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
function pathLabel(clip: Clip, path: string) {
  if (!path.startsWith("fx:")) return path;
  const [, fx, parameter] = path.split(":");
  const effect = clip.effects.find((e) => e.id === fx);
  return `${EFFECTS[effect?.type || ""]?.label || "Effect"} · ${EFFECTS[effect?.type || ""]?.parameters[parameter]?.label || parameter}`;
}

function Curves({
  clip,
  path,
  end,
  evaluate,
}: {
  clip?: Clip;
  path: string;
  end: number;
  evaluate: EditorHost["evaluate"];
}) {
  const keys = clip?.ch[path];
  if (!clip || !keys?.keys.length || typeof keys.keys[0].v !== "number")
    return (
      <div className="comp-empty">
        Select a numeric animated parameter to see its curve.
      </div>
    );
  const values = Array.from({ length: Math.min(301, end + 1) }, (_, i) =>
    number(evaluate(keys, (i * end) / Math.min(300, Math.max(1, end)))),
  );
  const min = Math.min(...values),
    max = Math.max(...values),
    span = Math.max(0.001, max - min);
  return (
    <svg
      className="comp-curve"
      viewBox="0 0 800 140"
      role="img"
      aria-label={`${pathLabel(clip, path)} value over composition time`}
    >
      <line x1="34" y1="112" x2="780" y2="112" />
      <line x1="34" y1="12" x2="34" y2="112" />
      <text x="4" y="20">
        {max.toFixed(1)}
      </text>
      <text x="4" y="108">
        {min.toFixed(1)}
      </text>
      <polyline
        fill="none"
        points={values
          .map(
            (v, i) =>
              `${34 + (i / Math.max(1, values.length - 1)) * 746},${108 - ((v - min) / span) * 88}`,
          )
          .join(" ")}
      />
      <text x="36" y="134">
        Frame 0
      </text>
      <text x="714" y="134">
        {end}
      </text>
    </svg>
  );
}

export function CompositionWorkspace({
  host,
  active,
}: {
  host: EditorHost;
  active: boolean;
}) {
  const [snapshot, setSnapshot] = useState(host.read),
    [frame, setFrame] = useState(0),
    [selection, setSelection] = useState("animation-mainline");
  const [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false),
    [autoKey, setAutoKey] = useState(false),
    [bypass, setBypass] = useState(false),
    [alpha, setAlpha] = useState(false);
  const [defaultInterpolation, setDefaultInterpolation] = useState("smooth");
  const [browser, setBrowser] = useState<"effects" | "media" | "assistant">(
      "effects",
    ),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("All");
  const [bottom, setBottom] = useState<"timeline" | "curves" | "flow">(
      "timeline",
    ),
    [path, setPath] = useState("opacity"),
    [keySelection, setKeySelection] = useState<{
      path: string;
      frame: number;
    } | null>(null);
  const [drawing, setDrawing] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [progress, setProgress] = useState("");
  const [trackingPoint, setTrackingPoint] = useState<[number, number] | null>(
      null,
    ),
    [pickingTrack, setPickingTrack] = useState(false);
  const [exportOpen, setExportOpen] = useState(false),
    [from, setFrom] = useState(0),
    [to, setTo] = useState(72),
    [transparent, setTransparent] = useState(false);
  const [prompt, setPrompt] = useState(""),
    [plan, setPlan] = useState<{
      types: string[];
      revision: number;
      target: string;
      composition: string;
    } | null>(null);
  const viewer = useRef<HTMLCanvasElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    sequenceInput = useRef<HTMLInputElement>(null),
    renderId = useRef(0),
    cancelExport = useRef(false),
    exportController = useRef<AbortController | null>(null);
  const renderer = useMemo(() => new CompositionRenderer(host), [host]);
  const state = stateOf(snapshot.doc),
    comp = activeComposition(state),
    clip = comp.clips.find((c) => c.id === selection),
    selectedKey = keySelection
      ? clip?.ch[keySelection.path]?.keys.find(
          (k) => k.f === keySelection.frame,
        )
      : undefined;
  const epoch = useRef(snapshot.document);
  useEffect(() => host.subscribe(() => setSnapshot(host.read())), [host]);
  useEffect(() => () => renderer.media.dispose(), [renderer]);
  useEffect(() => {
    if (epoch.current !== snapshot.document) {
      epoch.current = snapshot.document;
      setFrame(0);
      setSelection("animation-mainline");
      setPlaying(false);
      setPlan(null);
      renderer.media.dispose();
    }
  }, [snapshot.document, renderer]);
  useEffect(() => {
    if (!active) {
      setPlaying(false);
      setDrawing(false);
    }
  }, [active]);
  useEffect(() => {
    if (active) document.getElementById("composition-workspace")?.focus();
  }, [active]);
  useEffect(() => {
    if (!exportOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const focus = setTimeout(
      () => document.querySelector<HTMLElement>(".comp-dialog button")?.focus(),
      0,
    );
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (exporting) {
          cancelExport.current = true;
          exportController.current?.abort();
        } else setExportOpen(false);
      }
      if (event.key !== "Tab") return;
      const items = [
        ...document.querySelectorAll<HTMLElement>(
          ".comp-dialog button:not(:disabled),.comp-dialog input:not(:disabled)",
        ),
      ];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement),
        next = event.shiftKey
          ? (index - 1 + items.length) % items.length
          : (index + 1) % items.length;
      event.preventDefault();
      event.stopPropagation();
      items[next].focus();
    };
    document.addEventListener("keydown", trap, true);
    return () => {
      clearTimeout(focus);
      document.removeEventListener("keydown", trap, true);
      previous?.focus();
    };
  }, [exportOpen, exporting]);
  useEffect(() => {
    setFrame((value) => clamp(value, 0, comp.end));
    setTo(comp.end);
    setKeySelection(null);
    setDrawing(false);
  }, [comp.id, comp.end]);
  useEffect(() => {
    if (!active || exporting) return;
    const sequence = ++renderId.current,
      controller = new AbortController();
    void renderer
      .render(copy(state), comp.id, frame, {
        signal: controller.signal,
        bypass,
        alpha,
      })
      .then((result) => {
        if (sequence !== renderId.current || !viewer.current) return;
        const canvas = viewer.current;
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(result, 0, 0);
        setError("");
      })
      .catch((err) => {
        if (sequence === renderId.current && err?.name !== "AbortError")
          setError(message(err));
      });
    return () => {
      controller.abort();
    };
    // Scene cache arrivals notify the host without changing revision; redraw for those too.
  }, [active, renderer, snapshot, comp.id, frame, bypass, alpha, exporting]);
  useEffect(() => {
    if (!playing || !active) return;
    const started = performance.now(),
      startFrame = frame;
    let handle = 0;
    const tick = () => {
      const next = Math.floor(
        startFrame + ((performance.now() - started) * comp.fps) / 1000,
      );
      if (next > comp.end) {
        setFrame(comp.end);
        setPlaying(false);
        return;
      }
      setFrame(next);
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
    // The clock retains its origin while React updates the displayed frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, active, comp.id, comp.fps, comp.end]);
  useEffect(() => {
    renderer.media.syncAudio(
      host,
      state,
      comp,
      frame,
      playing && active,
      muted,
    );
  }, [renderer, host, state, comp, frame, playing, active, muted]);

  function change(
    label: string,
    fn: (state: CompositionState, composition: Composition) => void,
  ) {
    setError("");
    host.edit(label, (doc) => {
      const next = copy(stateOf(doc));
      fn(next, activeComposition(next));
      validateCompositionState(next);
      doc.composition = next;
    });
  }
  function changeClip(
    label: string,
    fn: (clip: Clip, composition: Composition, state: CompositionState) => void,
  ) {
    change(label, (next, composition) => {
      const current = composition.clips.find((c) => c.id === selection);
      if (current) fn(current, composition, next);
    });
  }
  function parameter(name: string, value: Value) {
    setPath(name);
    changeClip("Change " + name, (current) =>
      setParameter(
        current,
        name,
        value,
        frame,
        autoKey,
        host.evaluate,
        defaultInterpolation,
      ),
    );
  }
  function addEffect(type: string) {
    if (!clip || clip.kind === "audio") {
      setError("Select a visual clip or adjustment layer first");
      return;
    }
    changeClip("Add " + EFFECTS[type].label, (current) => {
      current.effects.push(newEffect(type));
    });
  }
  function key(name: string) {
    if (!clip) return;
    setPath(name);
    changeClip("Toggle parameter key", (current) => {
      const existing = current.ch[name]?.keys.find((k) => k.f === frame);
      if (existing) {
        current.ch[name].keys = current.ch[name].keys.filter(
          (k) => k.f !== frame,
        );
        if (!current.ch[name].keys.length) delete current.ch[name];
      } else
        setParameter(
          current,
          name,
          valueAt(current, name, frame, host.evaluate),
          frame,
          true,
          host.evaluate,
          defaultInterpolation,
          true,
        );
    });
  }
  function field(
    name: string,
    label: string,
    settings: { min?: number; max?: number; step?: number } = {},
  ) {
    if (!clip) return null;
    const value = valueAt(clip, name, frame, host.evaluate),
      keyed = !!clip.ch[name]?.keys.find((k) => k.f === frame);
    return (
      <label className="comp-field" key={name}>
        <span>{label}</span>
        {typeof value === "boolean" ? (
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => parameter(name, e.target.checked)}
          />
        ) : typeof value === "number" ? (
          <input
            type="number"
            {...settings}
            value={Math.round(value * 10000) / 10000}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n))
                parameter(
                  name,
                  clamp(n, settings.min ?? -1e6, settings.max ?? 1e6),
                );
            }}
          />
        ) : (
          <input
            type={String(value).startsWith("#") ? "color" : "text"}
            value={String(value)}
            onChange={(e) => parameter(name, e.target.value)}
          />
        )}
        <button
          type="button"
          className={"comp-key " + (keyed ? "on" : "")}
          aria-label={`${keyed ? "Remove" : "Add"} key: ${label}`}
          onClick={(e) => {
            e.preventDefault();
            key(name);
          }}
        >
          ◆
        </button>
      </label>
    );
  }
  function add(kind: Clip["kind"]) {
    let created = "";
    change("Add " + kind, (_next, composition) => {
      const current = createClip(
        kind,
        kind === "scene"
          ? "Animation · Mainline"
          : kind === "adjustment"
            ? "Adjustment layer"
            : kind === "text"
              ? "Title"
              : "Solid",
        composition.end + 1,
      );
      created = current.id;
      composition.clips.push(current);
    });
    setSelection(created);
  }
  function newComposition() {
    change("New composition", (next, composition) => {
      const created: Composition = {
        ...copy(composition),
        id: id(),
        name: `Composition ${next.compositions.length + 1}`,
        background: "transparent",
        clips: [],
      };
      next.compositions.push(created);
      next.active = created.id;
    });
    setSelection("");
    setFrame(0);
    setPlaying(false);
  }
  function addParticlePreset(preset: "dust" | "sparks") {
    let created = "";
    change("Add " + preset, (_next, composition) => {
      const current = createClip(
        "particles",
        preset === "dust" ? "Dust burst" : "Sparks",
        Math.ceil(composition.fps * 2),
      );
      current.start = frame;
      created = current.id;
      Object.assign(
        current.p,
        preset === "dust"
          ? {
              burst: 80,
              life: 1.6,
              speed: 160,
              spread: 160,
              angle: -90,
              gravity: 30,
              size: 20,
              color: "#baa181",
            }
          : {
              burst: 70,
              life: 1,
              speed: 400,
              spread: 360,
              gravity: 700,
              size: 3,
              color: "#ffac42",
            },
      );
      current.effects.push(newEffect(preset === "dust" ? "blur" : "glow"));
      current.effects[0].p.radius = preset === "dust" ? 5 : 12;
      composition.clips.push(current);
      composition.end = Math.max(composition.end, frame + current.duration - 1);
    });
    setSelection(created);
  }
  function saveLook() {
    if (!clip?.effects.length) return;
    change("Save effect preset", (next) => {
      next.presets ||= [];
      next.presets.push({
        id: id(),
        name: `${clip.name} look ${next.presets.length + 1}`,
        effects: clip.effects.map((effect) => ({
          ...copy(effect),
          p: Object.fromEntries(
            Object.keys(effect.p).map((key) => [
              key,
              valueAt(clip, `fx:${effect.id}:${key}`, frame, host.evaluate),
            ]),
          ),
        })),
      });
    });
  }
  async function importSequence(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    if (
      list.length > 600 ||
      list.reduce((total, file) => total + file.size, 0) > 256 * 1024 * 1024
    ) {
      setError("Use a sequence of at most 600 images and 256 MB");
      return;
    }
    const documentId = host.read().document,
      target = comp.id;
    setBusy(true);
    try {
      const assets: Asset[] = [];
      for (const file of list) {
        const asset = { ...(await inspectFile(file)), id: id() };
        if (asset.type !== "image")
          throw new Error("An image sequence can only contain images");
        assets.push(asset);
      }
      if (
        host.read().document !== documentId ||
        activeComposition(stateOf(host.read().doc)).id !== target
      )
        throw new Error("The target composition changed during import");
      let selected = "";
      host.edit("Import image sequence", (doc) => {
        const next = copy(stateOf(doc)),
          composition = activeComposition(next),
          current = createClip(
            "sequence",
            list[0].name + " sequence",
            assets.length,
          );
        current.start = frame;
        current.sourceFps = composition.fps;
        current.sequence = assets.map((asset) => asset.id);
        for (const asset of assets) {
          doc.media[asset.id] = asset;
          next.assets.push(asset.id);
        }
        composition.clips.push(current);
        composition.end = Math.max(
          composition.end,
          frame + current.duration - 1,
        );
        selected = current.id;
        validateCompositionState(next);
        doc.composition = next;
      });
      setSelection(selected);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
      if (sequenceInput.current) sequenceInput.current.value = "";
    }
  }
  async function importMedia(files: FileList | null) {
    if (!files?.length) return;
    const originalDocument = host.read().document,
      target = comp.id;
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const asset = { ...(await inspectFile(file)), id: id() };
        if (
          host.read().document !== originalDocument ||
          activeComposition(stateOf(host.read().doc)).id !== target
        )
          throw new Error(
            "The project or composition changed during import; import again in the intended composition",
          );
        let created = "";
        host.edit("Import " + asset.name, (doc) => {
          const next = copy(stateOf(doc)),
            composition = activeComposition(next);
          doc.media[asset.id] = asset;
          next.assets.push(asset.id);
          const current = createClip(
            asset.type,
            asset.name,
            assetDuration(asset, composition.fps, composition.end + 1),
            asset.id,
          );
          current.start = frame;
          composition.end = Math.max(
            composition.end,
            current.start + current.duration - 1,
          );
          created = current.id;
          composition.clips.push(current);
          validateCompositionState(next);
          doc.composition = next;
        });
        setSelection(created);
      }
      setBrowser("media");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function removeClip() {
    changeClip("Delete composition clip", (current, composition) => {
      composition.clips = composition.clips.filter((c) => c.id !== current.id);
      composition.clips.forEach((c) => {
        if (c.matte === current.id) delete c.matte;
      });
    });
    setSelection("");
  }
  function moveClip(direction: number) {
    changeClip("Reorder composition clip", (current, composition) => {
      const index = composition.clips.indexOf(current),
        target = clamp(index + direction, 0, composition.clips.length - 1);
      composition.clips.splice(index, 1);
      composition.clips.splice(target, 0, current);
    });
  }
  function precompose() {
    let selected = "";
    change("Precompose clip", (next, composition) => {
      selected = makePrecomp(next, composition, [selection]).id;
    });
    if (selected) setSelection(selected);
  }
  function editKey(patch: Partial<Key>) {
    if (!keySelection) return;
    changeClip("Edit keyframe", (current) => {
      const channel = current.ch[keySelection.path],
        key = channel?.keys.find((k) => k.f === keySelection.frame);
      if (!key) return;
      if (
        patch.f !== undefined &&
        channel.keys.some((k) => k !== key && k.f === patch.f)
      )
        throw new Error("A key already exists on that frame");
      Object.assign(key, patch);
      channel.keys.sort((a, b) => a.f - b.f);
    });
    if (patch.f !== undefined) {
      setFrame(patch.f);
      setKeySelection({ ...keySelection, frame: patch.f });
    }
  }
  function buildPlan() {
    if (!clip) {
      setError("Select a target clip");
      return;
    }
    const types = new Set<string>();
    if (/green|blue.?screen|key|background removal/i.test(prompt))
      types.add("keyer");
    if (/glow|neon|magic|light/i.test(prompt)) types.add("glow");
    if (/cinema|film|grade|color|colour/i.test(prompt)) {
      types.add("color");
      types.add("vignette");
    }
    if (/grain|film/i.test(prompt)) types.add("grain");
    if (/blur|soft/i.test(prompt)) types.add("blur");
    if (/trail|echo/i.test(prompt)) types.add("echo");
    if (/shadow/i.test(prompt)) types.add("shadow");
    if (!types.size) {
      setPlan(null);
      setError(
        "The local assistant supports glow, film/color looks, grain, blur, shadows, echoes, and green-screen keying. Tracking and generative models are not connected.",
      );
      return;
    }
    setPlan({
      types: [...types],
      revision: host.read().revision,
      target: selection,
      composition: comp.id,
    });
  }
  async function exportImages(sequence: boolean) {
    setError("");
    setPlaying(false);
    setExporting(true);
    cancelExport.current = false;
    exportController.current = new AbortController();
    const originalRevision = host.read().revision,
      originalDocument = host.read().document,
      exportState = copy(state),
      exportComp = copy(comp);
    const files: { name: string; data: Uint8Array }[] = [];
    let bytes = 0;
    try {
      const start = sequence ? clamp(Math.round(from), 0, comp.end) : frame,
        end = sequence ? clamp(Math.round(to), start, comp.end) : frame;
      for (let f = start; f <= end; f++) {
        if (cancelExport.current) throw new Error("Export cancelled");
        if (
          host.read().revision !== originalRevision ||
          host.read().document !== originalDocument
        )
          throw new Error(
            "The project changed during export. Export again to keep every frame consistent.",
          );
        setProgress(
          `Rendering frame ${f} · ${f - start + 1} / ${end - start + 1}`,
        );
        const image = await renderer.render(exportState, exportComp.id, f, {
          transparent,
          signal: exportController.current.signal,
        });
        const blob = await blobOf(image);
        if (
          host.read().revision !== originalRevision ||
          host.read().document !== originalDocument
        )
          throw new Error(
            "The project changed during export. Export again to keep every frame consistent.",
          );
        if (cancelExport.current) throw new Error("Export cancelled");
        if (!sequence) {
          await host.download(
            blob,
            `${exportComp.name.replace(/[<>:"/\\|?*]/g, "_")}_${String(f).padStart(5, "0")}.png`,
          );
          break;
        }
        const data = new Uint8Array(await blob.arrayBuffer());
        bytes += data.byteLength;
        if (bytes > 384 * 1024 * 1024)
          throw new Error(
            "This image sequence exceeds the 384 MB packaging budget. Export a shorter range.",
          );
        files.push({ name: `${String(f).padStart(5, "0")}.png`, data });
      }
      if (cancelExport.current) throw new Error("Export cancelled");
      if (sequence) {
        files.push({
          name: "sequence.json",
          data: new TextEncoder().encode(
            JSON.stringify(
              {
                fps: exportComp.fps,
                width: exportComp.width,
                height: exportComp.height,
                first: start,
                last: end,
                audio: false,
              },
              null,
              2,
            ),
          ),
        });
        await host.download(
          host.zip(files),
          exportComp.name.replace(/[<>:"/\\|?*]/g, "_") + "_frames.zip",
        );
      }
      setExportOpen(false);
    } catch (err) {
      setError(message(err));
    } finally {
      setExporting(false);
      setProgress("");
    }
  }

  return (
    <section
      id="composition-workspace"
      hidden={!active}
      tabIndex={-1}
      aria-label="Composition workspace"
      onKeyDown={(e) => {
        if (exportOpen) return;
        if (
          (e.ctrlKey || e.metaKey) &&
          e.altKey &&
          e.key.toLowerCase() === "e"
        ) {
          e.preventDefault();
          if (clip?.ch[path]?.keys.some((key) => key.f === frame))
            setKeySelection({ path, frame });
          return;
        }
        if (/INPUT|TEXTAREA|SELECT/.test((e.target as HTMLElement).tagName))
          return;
        if (e.code === "Space") {
          e.preventDefault();
          setPlaying((value) => !value);
        }
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          setPlaying(false);
          setFrame((value) =>
            clamp(value + (e.key === "ArrowRight" ? 1 : -1), 0, comp.end),
          );
        }
        if (e.key === "Delete" && clip) {
          e.preventDefault();
          removeClip();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
          e.preventDefault();
          host.command(e.shiftKey ? "edit.redo" : "edit.undo");
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          host.command("file.save");
        }
      }}
    >
      <div className="comp-toolbar">
        <button onClick={() => host.command("file.open")}>Open</button>
        <button onClick={() => host.command("file.save")}>Save</button>
        <span className="comp-divider" />
        <label>
          Composition{" "}
          <select
            aria-label="Active composition"
            value={comp.id}
            onChange={(e) => {
              change("Open composition", (next) => {
                next.active = e.target.value;
              });
              setSelection("");
              setPlaying(false);
            }}
          >
            {state.compositions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={newComposition}>New composition</button>
        <span className="comp-format">
          {comp.width} × {comp.height} · {comp.fps} fps
        </span>
        <span className="comp-spacer" />
        <button
          onClick={() => {
            setTo(comp.end);
            setExportOpen(true);
          }}
        >
          Export composition
        </button>
      </div>
      <div className="comp-body" aria-busy={busy || exporting}>
        <aside className="comp-browser">
          <div
            className="comp-tabs"
            role="tablist"
            aria-label="Composition browser"
          >
            {(["effects", "media", "assistant"] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={browser === tab}
                onClick={() => setBrowser(tab)}
              >
                {tab === "assistant"
                  ? "Assist"
                  : tab === "effects"
                    ? "Effects"
                    : "Media"}
              </button>
            ))}
          </div>
          {browser === "effects" && (
            <>
              <input
                aria-label="Find effects"
                placeholder="Find an effect…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                aria-label="Effect category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {[
                  "All",
                  ...new Set(Object.values(EFFECTS).map((e) => e.category)),
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <div className="comp-button-row">
                <button onClick={() => addParticlePreset("dust")}>
                  Dust burst
                </button>
                <button onClick={() => addParticlePreset("sparks")}>
                  Sparks
                </button>
              </div>
              {(state.presets || []).map((preset) => (
                <button
                  key={preset.id}
                  disabled={!clip}
                  onClick={() =>
                    changeClip("Apply effect preset", (current) => {
                      current.effects.push(
                        ...preset.effects.map((effect) => ({
                          ...copy(effect),
                          id: id(),
                        })),
                      );
                    })
                  }
                >
                  {preset.name}
                </button>
              ))}
              <div className="comp-effect-browser">
                {Object.entries(EFFECTS)
                  .filter(
                    ([, effect]) =>
                      (category === "All" || effect.category === category) &&
                      (effect.label + effect.description)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                  )
                  .map(([type, effect]) => (
                    <button
                      key={type}
                      disabled={!clip || clip.kind === "audio"}
                      onClick={() => addEffect(type)}
                    >
                      <strong>{effect.label}</strong>
                      <span>{effect.description}</span>
                    </button>
                  ))}
              </div>
            </>
          )}
          {browser === "media" && (
            <>
              <button
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                {busy ? "Reading media…" : "Import video / image / audio"}
              </button>
              <button
                disabled={busy}
                onClick={() => sequenceInput.current?.click()}
              >
                Import image sequence
              </button>
              <div className="comp-library-heading">Project media</div>
              {Object.entries(snapshot.doc.media).map(([key, asset]) => (
                <button
                  className="comp-asset"
                  key={key}
                  onClick={() => {
                    let created = "";
                    change("Add media instance", (_next, composition) => {
                      const current = createClip(
                        asset.type,
                        asset.name,
                        assetDuration(
                          asset,
                          composition.fps,
                          composition.end + 1,
                        ),
                        key,
                      );
                      current.start = frame;
                      composition.end = Math.max(
                        composition.end,
                        frame + current.duration - 1,
                      );
                      composition.clips.push(current);
                      created = current.id;
                    });
                    setSelection(created);
                  }}
                >
                  <span>{asset.type.toUpperCase()}</span>
                  {asset.name}
                </button>
              ))}
              <div className="comp-library-heading">Compositions</div>
              {state.compositions
                .filter((c) => c.id !== comp.id)
                .map((source) => (
                  <button
                    key={source.id}
                    onClick={() => {
                      let selected = "";
                      change(
                        "Add composition instance",
                        (_next, composition) => {
                          const current = createClip(
                            "precomp",
                            source.name,
                            Math.ceil(
                              ((source.end + 1) / source.fps) * composition.fps,
                            ),
                            source.id,
                          );
                          composition.clips.push(current);
                          selected = current.id;
                        },
                      );
                      setSelection(selected);
                    }}
                  >
                    ＋ {source.name}
                  </button>
                ))}
              <div className="comp-library-heading">Live animation</div>
              <button onClick={() => add("scene")}>＋ Mainline scene</button>
              {snapshot.doc.layers
                .filter((layer) => layer.type !== "audio")
                .map((layer) => (
                  <button
                    key={layer.id}
                    onClick={() => {
                      let created = "";
                      change(
                        "Add animation layer source",
                        (_next, composition) => {
                          const current = createClip(
                            "layer",
                            layer.name,
                            composition.end + 1,
                            layer.id,
                          );
                          composition.clips.push(current);
                          created = current.id;
                        },
                      );
                      setSelection(created);
                    }}
                  >
                    ＋ {layer.name}
                  </button>
                ))}
            </>
          )}
          {browser === "assistant" && (
            <>
              <div className="comp-library-heading">Local look assistant</div>
              <p>
                Describe a look. Review the supported effects before adding them
                to the selected clip.
              </p>
              <textarea
                aria-label="Describe a compositing look"
                rows={5}
                value={prompt}
                placeholder="A warm film look with grain and a soft glow…"
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setPlan(null);
                }}
              />
              <button disabled={!prompt.trim() || !clip} onClick={buildPlan}>
                Review effect plan
              </button>
              {plan && (
                <div className="comp-plan">
                  <strong>Target: {clip?.name}</strong>
                  {plan.types.map((type) => (
                    <span key={type}>＋ {EFFECTS[type].label}</span>
                  ))}
                  <button
                    onClick={() => {
                      if (
                        host.read().revision !== plan.revision ||
                        selection !== plan.target ||
                        comp.id !== plan.composition
                      ) {
                        setError(
                          "The scene or selection changed. Review a fresh plan.",
                        );
                        setPlan(null);
                        return;
                      }
                      changeClip("Apply compositing look", (current) => {
                        current.effects.push(...plan.types.map(newEffect));
                      });
                      setPlan(null);
                    }}
                  >
                    Apply editable effects
                  </button>
                </div>
              )}
              <p className="comp-muted">
                Segmentation, object removal, and generative video require a
                model connection; they are not simulated here.
              </p>
            </>
          )}
        </aside>
        <main
          className="comp-view"
          onPointerDownCapture={(event) => {
            if (!pickingTrack || !(event.target instanceof HTMLCanvasElement))
              return;
            const rect = event.target.getBoundingClientRect(),
              scale = Math.min(
                rect.width / comp.width,
                rect.height / comp.height,
              ),
              x =
                (event.clientX -
                  rect.left -
                  (rect.width - comp.width * scale) / 2) /
                scale,
              y =
                (event.clientY -
                  rect.top -
                  (rect.height - comp.height * scale) / 2) /
                scale;
            if (x < 0 || y < 0 || x > comp.width || y > comp.height) return;
            setTrackingPoint([x, y]);
            setPickingTrack(false);
            event.stopPropagation();
          }}
        >
          <div className="comp-view-controls">
            <strong>Final composition</strong>
            <span className="comp-spacer" />
            <button
              aria-pressed={bypass}
              onClick={() => setBypass((value) => !value)}
            >
              Bypass effects
            </button>
            <button
              aria-pressed={alpha}
              onClick={() => setAlpha((value) => !value)}
            >
              Alpha
            </button>
            <button
              aria-pressed={muted}
              onClick={() => setMuted((value) => !value)}
            >
              {muted ? "Muted" : "Audio on"}
            </button>
          </div>
          <div
            className={"comp-canvas-wrap " + (drawing ? "drawing" : "")}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void importMedia(e.dataTransfer.files);
            }}
          >
            <canvas
              ref={viewer}
              aria-label="Composition preview"
              onPointerDown={(e) => {
                if (!drawing || !clip) return;
                const rect = e.currentTarget.getBoundingClientRect(),
                  scale = Math.min(
                    rect.width / comp.width,
                    rect.height / comp.height,
                  ),
                  x =
                    (e.clientX -
                      rect.left -
                      (rect.width - comp.width * scale) / 2) /
                    scale,
                  y =
                    (e.clientY -
                      rect.top -
                      (rect.height - comp.height * scale) / 2) /
                    scale;
                if (x < 0 || y < 0 || x > comp.width || y > comp.height) return;
                const points = valueAt(clip, "mask", frame, host.evaluate);
                parameter("mask", [
                  ...(Array.isArray(points) ? points : []),
                  Math.round(x),
                  Math.round(y),
                ]);
              }}
              onContextMenu={(e) => {
                if (drawing) {
                  e.preventDefault();
                  setDrawing(false);
                }
              }}
            />
            <MaskOverlay
              key={selection}
              width={comp.width}
              height={comp.height}
              points={clip ? valueAt(clip, "mask", frame, host.evaluate) : []}
              onChange={(points) => parameter("mask", points)}
            />
            {pickingTrack && (
              <div className="comp-mask-hint">
                Click a contrasting detail to track its position
              </div>
            )}
            {drawing && (
              <div className="comp-mask-hint">
                Click vertices in the frame · Right-click or Finish to close the
                polygon
              </div>
            )}
          </div>
          <div className="comp-transport">
            <button
              aria-label="Previous frame"
              onClick={() => {
                setPlaying(false);
                setFrame((value) => Math.max(0, value - 1));
              }}
            >
              ◀
            </button>
            <button
              aria-label={playing ? "Pause composition" : "Play composition"}
              onClick={() => {
                if (frame >= comp.end) setFrame(0);
                setPlaying((value) => !value);
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              aria-label="Next frame"
              onClick={() => {
                setPlaying(false);
                setFrame((value) => Math.min(comp.end, value + 1));
              }}
            >
              ▶
            </button>
            <label>
              Frame{" "}
              <input
                aria-label="Composition frame"
                type="number"
                min={0}
                max={comp.end}
                value={frame}
                onChange={(e) => {
                  setPlaying(false);
                  setFrame(
                    clamp(Math.round(Number(e.target.value) || 0), 0, comp.end),
                  );
                }}
              />
            </label>
            <span>/ {comp.end}</span>
            <span className="comp-spacer" />
            <label>
              New keys{" "}
              <select
                aria-label="Default composition interpolation"
                value={defaultInterpolation}
                onChange={(e) => setDefaultInterpolation(e.target.value)}
              >
                {INTERPOLATIONS.filter((type) => type !== "cycle").map(
                  (type) => (
                    <option key={type}>{type}</option>
                  ),
                )}
                <option value="copy">Copy previous</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={autoKey}
                onChange={(e) => setAutoKey(e.target.checked)}
              />{" "}
              Auto-key
            </label>
          </div>
        </main>
        <aside className="comp-inspector">
          <div className="comp-panel-title">Inspector</div>
          {!clip ? (
            <>
              <div className="comp-empty">
                Select a clip to edit its transforms, masks, and effects.
              </div>
              <label className="comp-field">
                <span>Name</span>
                <input
                  value={comp.name}
                  onChange={(e) =>
                    change("Rename composition", (_next, composition) => {
                      composition.name = e.target.value;
                    })
                  }
                />
              </label>
              {(["width", "height", "fps", "end"] as const).map((key) => (
                <label className="comp-field" key={key}>
                  <span>{key}</span>
                  <input
                    type="number"
                    value={comp[key]}
                    min={key === "end" ? 0 : 1}
                    max={key === "fps" ? 240 : key === "end" ? 100000 : 8192}
                    onChange={(e) => {
                      const value = Math.round(Number(e.target.value));
                      if (value >= (key === "end" ? 0 : 1))
                        change("Composition settings", (_next, composition) => {
                          composition[key] = value;
                        });
                    }}
                  />
                </label>
              ))}
              <label className="comp-field">
                <span>Background</span>
                <input
                  type="color"
                  value={
                    comp.background === "transparent"
                      ? "#000000"
                      : comp.background
                  }
                  onChange={(e) =>
                    change("Composition background", (_next, composition) => {
                      composition.background = e.target.value;
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  change("Transparent composition", (_next, composition) => {
                    composition.background = "transparent";
                  })
                }
              >
                Transparent background
              </button>
            </>
          ) : (
            <>
              <input
                className="comp-clip-name"
                aria-label="Clip name"
                value={clip.name}
                onChange={(e) =>
                  changeClip("Rename clip", (current) => {
                    current.name = e.target.value;
                  })
                }
              />
              <div className="comp-muted">
                {clip.kind === "scene" || clip.kind === "layer"
                  ? "Live animation reference · source keys stay in Animation"
                  : clip.kind}
              </div>
              <details open>
                <summary>Timing</summary>
                {(["start", "duration", "in", "speed"] as const).map((key) => (
                  <label className="comp-field" key={key}>
                    <span>
                      {key === "in"
                        ? "Source in · timeline frames"
                        : key === "speed"
                          ? "Speed ×"
                          : key + " · frames"}
                    </span>
                    <input
                      type="number"
                      value={clip[key]}
                      min={key === "speed" ? -16 : key === "duration" ? 1 : 0}
                      max={key === "speed" ? 16 : 100000}
                      step={key === "speed" ? 0.1 : 1}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (
                          Number.isFinite(value) &&
                          (key === "speed" ||
                            value >= (key === "duration" ? 1 : 0))
                        )
                          changeClip("Change clip timing", (current) => {
                            current[key] = value;
                          });
                      }}
                    />
                  </label>
                ))}
              </details>
              <details open>
                <summary>Transform & mix</summary>
                {field("x", "Position X · px")}
                {field("y", "Position Y · px")}
                {field("sx", "Scale X", { step: 0.01 })}
                {field("sy", "Scale Y", { step: 0.01 })}
                {field("rotation", "Rotation °")}
                {field("opacity", "Opacity", { min: 0, max: 1, step: 0.01 })}
                {(clip.kind === "audio" || clip.kind === "video") &&
                  field("gain", "Audio gain", { min: 0, max: 1, step: 0.01 })}
                <label className="comp-field">
                  <span>Blend</span>
                  <select
                    value={clip.blend}
                    onChange={(e) =>
                      changeClip("Blend mode", (current) => {
                        current.blend = e.target.value as Clip["blend"];
                      })
                    }
                  >
                    {BLENDS.map((blend) => (
                      <option key={blend} value={blend}>
                        {
                          {
                            "source-over": "Normal",
                            multiply: "Multiply",
                            screen: "Screen",
                            overlay: "Overlay",
                            lighter: "Add",
                            darken: "Darken",
                            lighten: "Lighten",
                            "color-dodge": "Color dodge",
                            difference: "Difference",
                          }[blend]
                        }
                      </option>
                    ))}
                  </select>
                </label>
                {clip.kind === "particles" && (
                  <>
                    {field("color", "Color")}
                    {field("size", "Particle size", { min: 0.1, max: 200 })}
                    {field("burst", "Burst count · 0 = continuous", {
                      min: 0,
                      max: 400,
                      step: 1,
                    })}
                    {field("rate", "Particles / second", { min: 0, max: 400 })}
                    {field("life", "Lifetime · seconds", {
                      min: 0.05,
                      max: 30,
                    })}
                    {field("speed", "Particle speed", { min: 0, max: 3000 })}
                    {field("angle", "Emission angle °")}
                    {field("spread", "Spread °", { min: 0, max: 360 })}
                    {field("gravity", "Gravity")}
                    {field("seed", "Seed", { min: 0, max: 99999, step: 1 })}
                  </>
                )}
                {clip.kind === "solid" && field("color", "Color")}
                {clip.kind === "text" && (
                  <>
                    {field("text", "Text")}
                    {field("size", "Size · px", { min: 1, max: 1000 })}
                    {field("color", "Color")}
                  </>
                )}
              </details>
              <details>
                <summary>Mask & matte</summary>
                <label className="comp-field">
                  <span>Matte source</span>
                  <select
                    aria-label="Matte source"
                    value={clip.matte || ""}
                    onChange={(e) =>
                      changeClip("Set matte", (current) => {
                        current.matte = e.target.value || undefined;
                      })
                    }
                  >
                    <option value="">None</option>
                    {comp.clips
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
                </label>
                <label className="comp-field">
                  <span>Mode</span>
                  <select
                    value={clip.matteMode}
                    onChange={(e) =>
                      changeClip("Matte mode", (current) => {
                        current.matteMode = e.target.value as Clip["matteMode"];
                      })
                    }
                  >
                    {["alpha", "alpha-invert", "luma", "luma-invert"].map(
                      (mode) => (
                        <option key={mode}>{mode}</option>
                      ),
                    )}
                  </select>
                </label>
                <div className="comp-button-row">
                  <button onClick={() => setDrawing((value) => !value)}>
                    {drawing ? "Finish polygon" : "Draw polygon mask"}
                  </button>
                  <button onClick={() => parameter("mask", [])}>
                    Clear mask
                  </button>
                </div>
                {field("feather", "Feather · px", { min: 0, max: 300 })}
                {field("invertMask", "Invert polygon")}
                <span className="comp-muted">
                  Polygon coordinates are in composition space.
                </span>
              </details>
              <TrackingPanel
                key={clip.id}
                host={host}
                renderer={renderer}
                state={state}
                composition={comp}
                clip={clip}
                frame={frame}
                point={trackingPoint}
                onPause={() => setPlaying(false)}
                onPick={() => {
                  setDrawing(false);
                  setPickingTrack(true);
                  setPlaying(false);
                }}
                onSave={(track) =>
                  changeClip("Save motion track", (current) => {
                    current.tracks ||= [];
                    current.tracks.push(track);
                  })
                }
                onApply={(target, track) =>
                  change("Apply tracked motion", (_next, composition) => {
                    const destination = composition.clips.find(
                      (c) => c.id === target,
                    );
                    if (destination)
                      applyTrackMotion(destination, track, host.evaluate);
                  })
                }
              />
              <details open>
                <summary>Effects · {clip.effects.length}</summary>
                {!!clip.effects.length && (
                  <button onClick={saveLook}>
                    Save current look as preset
                  </button>
                )}
                {!clip.effects.length && (
                  <p className="comp-muted">
                    Choose an effect from the browser. Effects run top to
                    bottom.
                  </p>
                )}
                {clip.effects.map((effect, index) => (
                  <div className="comp-effect" key={effect.id}>
                    <div className="comp-effect-heading">
                      <input
                        aria-label={`Enable ${EFFECTS[effect.type]?.label || effect.type}`}
                        type="checkbox"
                        checked={effect.enabled}
                        onChange={(e) =>
                          changeClip("Bypass effect", (current) => {
                            current.effects.find(
                              (fx) => fx.id === effect.id,
                            )!.enabled = e.target.checked;
                          })
                        }
                      />
                      <strong>
                        {EFFECTS[effect.type]?.label || effect.type}
                      </strong>
                      <button
                        aria-label="Move effect up"
                        disabled={index === 0}
                        onClick={() =>
                          changeClip("Reorder effect", (current) => {
                            const [item] = current.effects.splice(index, 1);
                            current.effects.splice(index - 1, 0, item);
                          })
                        }
                      >
                        ↑
                      </button>
                      <button
                        aria-label="Move effect down"
                        disabled={index === clip.effects.length - 1}
                        onClick={() =>
                          changeClip("Reorder effect", (current) => {
                            const [item] = current.effects.splice(index, 1);
                            current.effects.splice(index + 1, 0, item);
                          })
                        }
                      >
                        ↓
                      </button>
                      <button
                        aria-label="Remove effect"
                        onClick={() =>
                          changeClip("Remove effect", (current) =>
                            removeEffect(current, effect.id),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                    {Object.entries(EFFECTS[effect.type]?.parameters || {}).map(
                      ([key, p]) => field(`fx:${effect.id}:${key}`, p.label, p),
                    )}
                    <button
                      onClick={() =>
                        changeClip("Reset effect", (current) => {
                          const target = current.effects.find(
                            (fx) => fx.id === effect.id,
                          )!;
                          for (const [key, p] of Object.entries(
                            EFFECTS[effect.type]?.parameters || {},
                          )) {
                            target.p[key] = copy(p.initial);
                            delete current.ch[`fx:${effect.id}:${key}`];
                          }
                        })
                      }
                    >
                      Reset effect & keys
                    </button>
                  </div>
                ))}
              </details>
              {clip.kind === "precomp" && (
                <button
                  onClick={() => {
                    change("Open precomposition", (next) => {
                      next.active = clip.source!;
                    });
                    setSelection("");
                  }}
                >
                  Open precomposition
                </button>
              )}
            </>
          )}
        </aside>
      </div>
      {error && (
        <div className="comp-error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <footer className="comp-timeline">
        <div className="comp-timeline-toolbar">
          <div className="comp-tabs">
            {(["timeline", "curves", "flow"] as const).map((tab) => (
              <button
                key={tab}
                aria-pressed={bottom === tab}
                onClick={() => setBottom(tab)}
              >
                {tab === "flow"
                  ? "Effect flow"
                  : tab === "curves"
                    ? "Curves"
                    : "Timeline"}
              </button>
            ))}
          </div>
          <span className="comp-spacer" />
          <button onClick={() => setSelection("")}>Comp settings</button>
          <select
            aria-label="Add composition layer"
            value=""
            onChange={(e) => {
              if (e.target.value === "media") fileInput.current?.click();
              else add(e.target.value as Clip["kind"]);
            }}
          >
            <option value="" disabled>
              Add layer…
            </option>
            <option value="scene">Animation scene</option>
            <option value="media">Footage / image / audio</option>
            <option value="adjustment">Adjustment</option>
            <option value="solid">Solid</option>
            <option value="text">Text</option>
          </select>
          <button
            disabled={!clip}
            onClick={() => {
              let selected = "";
              changeClip("Duplicate clip", (current, composition) => {
                const result = duplicateClip(current);
                selected = result.id;
                composition.clips.splice(
                  composition.clips.indexOf(current) + 1,
                  0,
                  result,
                );
              });
              if (selected) setSelection(selected);
            }}
          >
            Duplicate
          </button>
          <button disabled={!clip} onClick={precompose}>
            Precompose
          </button>
          <button disabled={!clip} onClick={() => moveClip(1)}>
            Raise
          </button>
          <button disabled={!clip} onClick={() => moveClip(-1)}>
            Lower
          </button>
          <button disabled={!clip} onClick={removeClip}>
            Delete
          </button>
        </div>
        <input
          className="comp-scrubber"
          aria-label="Composition playhead"
          type="range"
          min={0}
          max={comp.end}
          value={frame}
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
        />
        {bottom === "timeline" && (
          <div className="comp-lanes">
            {[...comp.clips].reverse().map((current) => (
              <div
                key={current.id}
                className={
                  "comp-lane " + (current.id === selection ? "selected" : "")
                }
              >
                <button
                  className="comp-eye"
                  aria-label={`${current.enabled ? "Hide" : "Show"} ${current.name}`}
                  onClick={() =>
                    change("Toggle clip", (_next, composition) => {
                      const target = composition.clips.find(
                        (c) => c.id === current.id,
                      )!;
                      target.enabled = !target.enabled;
                    })
                  }
                >
                  {current.enabled ? "●" : "○"}
                </button>
                <button
                  className="comp-lane-name"
                  onClick={() => {
                    setSelection(current.id);
                    setKeySelection(null);
                  }}
                >
                  {current.name}
                </button>
                <div
                  className="comp-lane-track"
                  onPointerDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPlaying(false);
                    setFrame(
                      Math.round(
                        clamp(
                          ((e.clientX - rect.left) / rect.width) * comp.end,
                          0,
                          comp.end,
                        ),
                      ),
                    );
                  }}
                >
                  <button
                    className={"comp-clip-bar kind-" + current.kind}
                    style={{
                      left: `${(current.start / Math.max(1, comp.end + 1)) * 100}%`,
                      width: `${(Math.min(current.duration, comp.end + 1 - current.start) / Math.max(1, comp.end + 1)) * 100}%`,
                    }}
                    onClick={() => setSelection(current.id)}
                  >
                    {current.kind}
                  </button>
                  <i
                    className="comp-playhead"
                    style={{
                      left: `${(frame / Math.max(1, comp.end)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            {clip &&
              Object.entries(clip.ch)
                .filter(([, channel]) => channel.keys.length)
                .map(([name, channel]) => (
                  <div className="comp-lane comp-parameter-lane" key={name}>
                    <span />
                    <button
                      className="comp-lane-name"
                      onClick={() => setPath(name)}
                    >
                      {pathLabel(clip, name)}
                    </button>
                    <div className="comp-lane-track">
                      {channel.keys.map((k) => (
                        <button
                          className="comp-key-marker"
                          key={k.f}
                          title={`${pathLabel(clip, name)} · frame ${k.f} · ${k.i || "smooth"}`}
                          aria-label={`${pathLabel(clip, name)} key at frame ${k.f}`}
                          style={{
                            left: `${(k.f / Math.max(1, comp.end)) * 100}%`,
                            color: typeof k.lb === "string" ? k.lb : undefined,
                          }}
                          onClick={() => {
                            setPlaying(false);
                            setFrame(k.f);
                            setPath(name);
                            setKeySelection({ path: name, frame: k.f });
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setKeySelection({ path: name, frame: k.f });
                          }}
                        >
                          ◆
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
          </div>
        )}
        {bottom === "curves" && (
          <>
            <select
              aria-label="Curve parameter"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            >
              {clip &&
                Object.keys(clip.ch).map((name) => (
                  <option key={name} value={name}>
                    {pathLabel(clip, name)}
                  </option>
                ))}
            </select>
            <Curves
              clip={clip}
              path={path}
              end={comp.end}
              evaluate={host.evaluate}
            />
          </>
        )}
        {bottom === "flow" && (
          <div
            className="comp-flow"
            aria-label="Read-only effect processing order"
          >
            <span>{clip?.name || "Select a clip"}</span>
            {clip?.effects.map((effect) => (
              <span
                className={effect.enabled ? "" : "bypassed"}
                key={effect.id}
              >
                → {EFFECTS[effect.type]?.label || effect.type}
              </span>
            ))}
            <span>→ Mask / matte → Blend → Output</span>
          </div>
        )}
        {selectedKey && keySelection && (
          <div className="comp-key-editor">
            <strong>{pathLabel(clip!, keySelection.path)}</strong>
            <label>
              Frame{" "}
              <input
                aria-label="Key frame"
                type="number"
                defaultValue={selectedKey.f}
                key={`${keySelection.path}:${selectedKey.f}`}
                min={0}
                max={comp.end}
                onBlur={(e) =>
                  editKey({
                    f: clamp(
                      Math.round(Number(e.target.value) || 0),
                      0,
                      comp.end,
                    ),
                  })
                }
              />
            </label>
            <select
              aria-label="Key interpolation"
              value={selectedKey.i || "smooth"}
              onChange={(e) => editKey({ i: e.target.value })}
            >
              {INTERPOLATIONS.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
            <label>
              Hold{" "}
              <input
                type="number"
                min={0}
                value={selectedKey.hold || 0}
                onChange={(e) =>
                  editKey({ hold: Math.max(0, Number(e.target.value)) })
                }
              />
            </label>
            <label>
              Interval{" "}
              <input
                type="number"
                min={1}
                max={24}
                value={selectedKey.iv || 1}
                onChange={(e) =>
                  editKey({
                    iv: clamp(Math.round(Number(e.target.value)), 1, 24),
                  })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={selectedKey.stg || false}
                onChange={(e) => editKey({ stg: e.target.checked })}
              />{" "}
              Stagger
            </label>
            {selectedKey.i === "cycle" && (
              <>
                <select
                  aria-label="Cycle mode"
                  value={selectedKey.cm || "abs"}
                  onChange={(e) => editKey({ cm: e.target.value })}
                >
                  <option value="abs">Absolute</option>
                  <option value="rel">Relative</option>
                </select>
                <input
                  aria-label="Cycle frame"
                  type="number"
                  min={0}
                  value={selectedKey.cy || 0}
                  onChange={(e) =>
                    editKey({ cy: Math.max(0, Number(e.target.value)) })
                  }
                />
              </>
            )}
            {selectedKey.i === "noisy" && (
              <>
                <label>
                  Amplitude{" "}
                  <input
                    type="number"
                    min={0}
                    value={
                      typeof selectedKey.na === "number" ? selectedKey.na : 10
                    }
                    onChange={(e) =>
                      editKey({ na: Math.max(0, Number(e.target.value)) })
                    }
                  />
                </label>
                <label>
                  Period{" "}
                  <input
                    type="number"
                    min={0.5}
                    value={
                      typeof selectedKey.nf === "number" ? selectedKey.nf : 3
                    }
                    onChange={(e) =>
                      editKey({ nf: Math.max(0.5, Number(e.target.value)) })
                    }
                  />
                </label>
              </>
            )}
            {selectedKey.i === "bezier" && (
              <label>
                Bézier{" "}
                <input
                  aria-label="Bezier control values"
                  defaultValue={(selectedKey.bz || [0.33, 0, 0.67, 1]).join(
                    ", ",
                  )}
                  onBlur={(e) => {
                    const values = e.target.value.split(",").map(Number);
                    if (values.length === 4 && values.every(Number.isFinite))
                      editKey({ bz: values });
                  }}
                />
              </label>
            )}
            <input
              aria-label="Key label color"
              type="color"
              value={
                typeof selectedKey.lb === "string" ? selectedKey.lb : "#ffd166"
              }
              onChange={(e) => editKey({ lb: e.target.value })}
            />
            <button onClick={() => editKey({ lb: undefined })}>
              Clear label
            </button>
            <button
              onClick={() => {
                changeClip("Delete keyframe", (current) => {
                  current.ch[keySelection.path].keys = current.ch[
                    keySelection.path
                  ].keys.filter((k) => k.f !== keySelection.frame);
                  if (!current.ch[keySelection.path].keys.length)
                    delete current.ch[keySelection.path];
                });
                setKeySelection(null);
              }}
            >
              Delete key
            </button>
            <button
              aria-label="Close keyframe settings"
              onClick={() => setKeySelection(null)}
            >
              ×
            </button>
          </div>
        )}
      </footer>
      <input
        ref={sequenceInput}
        type="file"
        hidden
        multiple
        accept="image/*"
        onChange={(event) => void importSequence(event.target.files)}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept="image/*,video/*,audio/*,.mp4,.webm,.mov,.m4v"
        onChange={(e) => void importMedia(e.target.files)}
      />
      {exportOpen && (
        <div className="comp-dialog-backdrop">
          <section
            className="comp-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="comp-export-title"
          >
            <h2 id="comp-export-title">Export composition</h2>
            <p>
              {comp.width} × {comp.height} · {comp.fps} fps
            </p>
            <label>
              From{" "}
              <input
                type="number"
                min={0}
                max={comp.end}
                value={from}
                onChange={(e) => setFrom(Number(e.target.value))}
              />
            </label>
            <label>
              To{" "}
              <input
                type="number"
                min={from}
                max={comp.end}
                value={to}
                onChange={(e) => setTo(Number(e.target.value))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={transparent}
                onChange={(e) => setTransparent(e.target.checked)}
              />{" "}
              Transparent background
            </label>
            <p>
              PNG sequences include frame-rate metadata. They contain no audio.
            </p>
            {progress && <p role="status">{progress}</p>}
            <div className="comp-button-row">
              <button
                disabled={exporting}
                onClick={() => void exportImages(false)}
              >
                Current frame · PNG
              </button>
              <button
                disabled={exporting}
                onClick={() => void exportImages(true)}
              >
                Image sequence · ZIP
              </button>
              <button
                onClick={() => {
                  if (exporting) {
                    cancelExport.current = true;
                    exportController.current?.abort();
                  } else setExportOpen(false);
                }}
              >
                {exporting ? "Cancel export" : "Close"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
