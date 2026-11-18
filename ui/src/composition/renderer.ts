import { EFFECTS, mattePixels, mixAdjustment, processPixels } from "./effects";
import { MediaCache } from "./media";
import { particlePositions } from "./particles";
import {
  number,
  sourceTime,
  valueAt,
  validateCompositionState,
  type Clip,
  type Composition,
  type CompositionState,
  type EditorHost,
  type Effect,
} from "./model";

export function canvas(width: number, height: number) {
  const result = document.createElement("canvas");
  result.width = Math.max(1, Math.round(width));
  result.height = Math.max(1, Math.round(height));
  return result;
}
const context = (source: HTMLCanvasElement) => {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas compositing is unavailable");
  return ctx;
};
const pixels = (
  source: HTMLCanvasElement,
  fn: (data: Uint8ClampedArray) => void,
) => {
  const ctx = context(source),
    data = ctx.getImageData(0, 0, source.width, source.height);
  fn(data.data);
  ctx.putImageData(data, 0, 0);
};
export interface RenderOptions {
  signal?: AbortSignal;
  bypass?: boolean;
  transparent?: boolean;
  alpha?: boolean;
}
export class CompositionRenderer {
  readonly media = new MediaCache();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private host: EditorHost) {}
  render(
    state: CompositionState,
    compositionId: string,
    frame: number,
    options: RenderOptions = {},
  ): Promise<HTMLCanvasElement> {
    // A cancelled preview yields its decoder before an export/newer preview starts.
    const result = this.tail
      .catch(() => {})
      .then(async () => {
        validateCompositionState(state);
        const result = await this.composition(
          state,
          compositionId,
          frame,
          options,
        );
        if (options.alpha)
          pixels(result, (data) => {
            for (let i = 0; i < data.length; i += 4) {
              data[i] = data[i + 1] = data[i + 2] = data[i + 3];
              data[i + 3] = 255;
            }
          });
        return result;
      });
    this.tail = result;
    return result;
  }
  private check(options: RenderOptions) {
    if (options.signal?.aborted)
      throw new DOMException("Cancelled", "AbortError");
  }
  private evaluated(clip: Clip, effect: Effect, frame: number): Effect {
    return {
      ...effect,
      p: Object.fromEntries(
        Object.keys(effect.p).map((key) => [
          key,
          valueAt(clip, `fx:${effect.id}:${key}`, frame, this.host.evaluate),
        ]),
      ),
    };
  }
  private effects(
    source: HTMLCanvasElement,
    clip: Clip,
    frame: number,
    options: RenderOptions,
  ) {
    if (options.bypass) return;
    for (const stored of clip.effects) {
      if (!stored.enabled || stored.type === "echo") continue;
      const effect = this.evaluated(clip, stored, frame),
        definition = EFFECTS[effect.type];
      if (!definition) continue;
      if (definition.legacy)
        this.host.applyEffect(
          source,
          { ...effect, type: definition.legacy },
          frame,
        );
      else if (effect.type === "vignette") {
        const ctx = context(source),
          radius = Math.hypot(source.width, source.height) / 2;
        const gradient = ctx.createRadialGradient(
          source.width / 2,
          source.height / 2,
          radius * number(effect.p.radius, 0.35),
          source.width / 2,
          source.height / 2,
          radius,
        );
        gradient.addColorStop(0, "rgba(0,0,0,0)");
        gradient.addColorStop(1, `rgba(0,0,0,${number(effect.p.amount, 0.4)})`);
        ctx.save();
        ctx.globalCompositeOperation = "source-atop";
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, source.width, source.height);
        ctx.restore();
      } else
        pixels(source, (data) =>
          processPixels(
            data,
            effect.type,
            effect.type === "grain"
              ? {
                  ...effect.p,
                  seed:
                    number(effect.p.seed, 1) +
                    (effect.p.animated ? Math.floor(frame) * 104729 : 0),
                }
              : effect.p,
            source.width,
          ),
        );
    }
  }
  private async composition(
    state: CompositionState,
    id: string,
    frame: number,
    options: RenderOptions,
  ): Promise<HTMLCanvasElement> {
    this.check(options);
    const comp = state.compositions.find((c) => c.id === id);
    if (!comp) throw new Error("Missing composition");
    const result = canvas(comp.width, comp.height),
      ctx = context(result);
    if (!options.transparent && comp.background !== "transparent") {
      ctx.fillStyle = comp.background;
      ctx.fillRect(0, 0, comp.width, comp.height);
    }
    for (const clip of comp.clips) {
      this.check(options);
      if (
        !clip.enabled ||
        sourceTime(clip, frame, comp.fps) === null ||
        clip.kind === "audio"
      )
        continue;
      const opacity = Math.max(
        0,
        Math.min(
          1,
          number(valueAt(clip, "opacity", frame, this.host.evaluate), 1),
        ),
      );
      if (clip.kind === "adjustment") {
        const original = ctx.getImageData(0, 0, comp.width, comp.height);
        const processed = canvas(comp.width, comp.height);
        context(processed).drawImage(result, 0, 0);
        this.effects(processed, clip, frame, options);
        const matte = await this.mask(state, comp, clip, frame, options);
        mixAdjustment(
          original.data,
          context(processed).getImageData(0, 0, comp.width, comp.height).data,
          opacity,
          matte
            ? context(matte).getImageData(0, 0, comp.width, comp.height).data
            : undefined,
        );
        ctx.putImageData(original, 0, 0);
        continue;
      }
      const source = await this.clip(state, comp, clip, frame, options);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = clip.blend;
      ctx.drawImage(source, 0, 0);
      ctx.restore();
    }
    return result;
  }
  private async clip(
    state: CompositionState,
    comp: Composition,
    clip: Clip,
    frame: number,
    options: RenderOptions,
    noEcho = false,
  ): Promise<HTMLCanvasElement> {
    this.check(options);
    const output = canvas(comp.width, comp.height),
      out = context(output),
      source = canvas(comp.width, comp.height),
      ctx = context(source);
    const seconds = sourceTime(clip, frame, comp.fps);
    if (seconds === null || seconds < 0) return output;
    let image: CanvasImageSource | null = null;
    if (clip.kind === "scene" || clip.kind === "layer")
      image = await this.host.renderSource(
        seconds * this.host.read().doc.fps,
        clip.kind === "layer" ? clip.source : undefined,
      );
    else if (clip.kind === "precomp") {
      const nested = state.compositions.find((c) => c.id === clip.source);
      if (nested)
        image = await this.composition(state, nested.id, seconds * nested.fps, {
          ...options,
          transparent: undefined,
          alpha: false,
        });
    } else if (clip.kind === "image" || clip.kind === "video") {
      const asset = this.host.read().doc.media[clip.source || ""];
      if (!asset) throw new Error(`Missing media for ${clip.name}`);
      image = await this.media.frame(
        { ...asset, id: clip.source! },
        seconds,
        options.signal,
      );
    } else if (clip.kind === "sequence") {
      const sourceId =
        clip.sequence?.[Math.floor(seconds * (clip.sourceFps || comp.fps))];
      const asset = sourceId && this.host.read().doc.media[sourceId];
      if (asset)
        image = await this.media.frame(
          { ...asset, id: sourceId },
          0,
          options.signal,
        );
    }
    if (image) {
      const dimensions = image as {
        width?: number;
        height?: number;
        videoWidth?: number;
        videoHeight?: number;
        naturalWidth?: number;
        naturalHeight?: number;
      };
      const w =
          dimensions.videoWidth ||
          dimensions.naturalWidth ||
          dimensions.width ||
          comp.width,
        h =
          dimensions.videoHeight ||
          dimensions.naturalHeight ||
          dimensions.height ||
          comp.height;
      const scale = Math.min(comp.width / w, comp.height / h);
      ctx.drawImage(
        image,
        (comp.width - w * scale) / 2,
        (comp.height - h * scale) / 2,
        w * scale,
        h * scale,
      );
    } else if (clip.kind === "solid") {
      ctx.fillStyle = String(valueAt(clip, "color", frame, this.host.evaluate));
      ctx.fillRect(0, 0, comp.width, comp.height);
    } else if (clip.kind === "text") {
      ctx.fillStyle = String(valueAt(clip, "color", frame, this.host.evaluate));
      ctx.font = `600 ${number(valueAt(clip, "size", frame, this.host.evaluate), 72)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = String(
        valueAt(clip, "text", frame, this.host.evaluate),
      ).split("\n");
      lines.forEach((line, i) =>
        ctx.fillText(
          line,
          comp.width / 2,
          comp.height / 2 +
            (i - (lines.length - 1) / 2) *
              number(valueAt(clip, "size", frame, this.host.evaluate), 72) *
              1.2,
        ),
      );
    } else if (clip.kind === "particles") {
      ctx.fillStyle = String(valueAt(clip, "color", frame, this.host.evaluate));
      for (const particle of particlePositions(
        clip,
        frame,
        seconds,
        this.host.evaluate,
      )) {
        ctx.globalAlpha = particle.alpha;
        ctx.beginPath();
        ctx.arc(
          comp.width / 2 + particle.x,
          comp.height / 2 + particle.y,
          particle.radius,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    this.effects(source, clip, frame, options);
    this.check(options);
    out.translate(
      comp.width / 2 + number(valueAt(clip, "x", frame, this.host.evaluate)),
      comp.height / 2 + number(valueAt(clip, "y", frame, this.host.evaluate)),
    );
    out.rotate(
      (number(valueAt(clip, "rotation", frame, this.host.evaluate)) * Math.PI) /
        180,
    );
    out.scale(
      number(valueAt(clip, "sx", frame, this.host.evaluate), 1),
      number(valueAt(clip, "sy", frame, this.host.evaluate), 1),
    );
    out.drawImage(source, -comp.width / 2, -comp.height / 2);
    out.resetTransform();
    if (!noEcho && !options.bypass) {
      for (const stored of clip.effects.filter(
        (e) => e.enabled && e.type === "echo",
      )) {
        const effect = this.evaluated(clip, stored, frame),
          count = Math.round(number(effect.p.samples, 4));
        out.globalCompositeOperation = "destination-over";
        for (let i = 1; i <= Math.min(12, count); i++) {
          const before = frame - i * number(effect.p.spacing, 2);
          if (sourceTime(clip, before, comp.fps) === null) break;
          const ghost = await this.clip(
            state,
            comp,
            clip,
            before,
            options,
            true,
          );
          out.globalAlpha = number(effect.p.decay, 0.6) ** i;
          out.drawImage(ghost, 0, 0);
        }
        out.globalAlpha = 1;
        out.globalCompositeOperation = "source-over";
      }
    }
    const matte = await this.mask(state, comp, clip, frame, options);
    if (matte) {
      out.globalCompositeOperation = "destination-in";
      out.drawImage(matte, 0, 0);
      out.globalCompositeOperation = "source-over";
    }
    return output;
  }
  private async mask(
    state: CompositionState,
    comp: Composition,
    clip: Clip,
    frame: number,
    options: RenderOptions,
  ): Promise<HTMLCanvasElement | null> {
    let result: HTMLCanvasElement | null = null;
    const points = valueAt(clip, "mask", frame, this.host.evaluate);
    if (Array.isArray(points) && points.length >= 6) {
      result = canvas(comp.width, comp.height);
      const ctx = context(result);
      ctx.fillStyle = "#ffffff";
      if (valueAt(clip, "invertMask", frame, this.host.evaluate)) {
        ctx.fillRect(0, 0, comp.width, comp.height);
        ctx.globalCompositeOperation = "destination-out";
      }
      ctx.filter = `blur(${Math.max(0, number(valueAt(clip, "feather", frame, this.host.evaluate)))}px)`;
      ctx.beginPath();
      ctx.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2)
        ctx.lineTo(points[i], points[i + 1]);
      ctx.closePath();
      ctx.fill();
    }
    if (clip.matte) {
      const target = comp.clips.find((c) => c.id === clip.matte);
      if (!target) throw new Error("Missing matte source");
      const matte = await this.clip(state, comp, target, frame, options);
      const opacity = Math.max(
        0,
        Math.min(
          1,
          number(valueAt(target, "opacity", frame, this.host.evaluate), 1),
        ),
      );
      if (opacity < 1)
        pixels(matte, (data) => {
          for (let i = 3; i < data.length; i += 4) data[i] *= opacity;
        });
      pixels(matte, (data) =>
        mattePixels(
          data,
          clip.matteMode.startsWith("luma"),
          clip.matteMode.endsWith("invert"),
        ),
      );
      if (result) {
        const ctx = context(result);
        ctx.globalCompositeOperation = "destination-in";
        ctx.drawImage(matte, 0, 0);
      } else result = matte;
    }
    return result;
  }
}
