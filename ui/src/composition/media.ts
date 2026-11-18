import type {
  Asset,
  Clip,
  Composition,
  CompositionState,
  EditorHost,
  Project,
} from "./model";
import { number, sourceTime } from "./model";

export interface AudioRequest {
  id: string;
  asset: Asset;
  seconds: number;
  rate: number;
  gain: number;
}
/** Traverse nested compositions and live-scene audio without moving the Animation playhead. */
export function compositionAudio(
  doc: Project,
  state: CompositionState,
  composition: Composition,
  frame: number,
  evaluate: EditorHost["evaluate"],
  prefix = "",
  rate = 1,
  gain = 1,
  depth = 0,
): AudioRequest[] {
  if (depth > 12) return [];
  const requests: AudioRequest[] = [];
  const append = (
    key: string,
    assetId: string,
    seconds: number,
    speed: number,
    volume: number,
  ) => {
    const asset = doc.media[assetId];
    if (
      !asset ||
      seconds < 0 ||
      speed <= 0 ||
      (asset.duration && seconds >= asset.duration)
    )
      return;
    requests.push({
      id: key,
      asset: { ...asset, id: assetId },
      seconds,
      rate: speed,
      gain: volume,
    });
  };
  for (const clip of composition.clips) {
    const seconds = sourceTime(clip, frame, composition.fps);
    if (!clip.enabled || seconds === null || seconds < 0) continue;
    const volume =
        gain *
        number(
          clip.ch.gain?.keys.length
            ? evaluate(clip.ch.gain, frame)
            : clip.p.gain,
          1,
        ),
      speed = rate * clip.speed,
      key = prefix + clip.id;
    if (clip.kind === "audio" || clip.kind === "video")
      append(key, clip.source || "", seconds, speed, volume);
    else if (clip.kind === "precomp") {
      const nested = state.compositions.find((c) => c.id === clip.source);
      if (nested)
        requests.push(
          ...compositionAudio(
            doc,
            state,
            nested,
            seconds * nested.fps,
            evaluate,
            key + "/",
            speed,
            volume,
            depth + 1,
          ),
        );
    } else if (clip.kind === "scene" || clip.kind === "layer") {
      const walk = (layers: Project["layers"], visible = true) => {
        for (const layer of layers) {
          if (!visible || layer.vis === false) continue;
          if (layer.type === "audio" && !layer.mute && layer.media) {
            const sourceFrame = seconds * doc.fps,
              layerGain = number(
                layer.ch?.gain?.keys.length
                  ? evaluate(layer.ch.gain, sourceFrame)
                  : layer.p?.gain,
                1,
              );
            append(
              key + "/" + layer.id,
              layer.media,
              seconds - (layer.offset || 0) / doc.fps,
              speed,
              volume * layerGain,
            );
          }
          if (layer.children) walk(layer.children, visible);
        }
      };
      if (clip.kind === "scene") walk(doc.layers);
      else {
        const find = (
          layers: Project["layers"],
        ): Project["layers"][number] | undefined => {
          for (const layer of layers) {
            if (layer.id === clip.source) return layer;
            const nested = layer.children && find(layer.children);
            if (nested) return nested;
          }
        };
        const layer = find(doc.layers);
        if (layer) walk([layer]);
      }
    }
  }
  return requests;
}

const abortError = () => new DOMException("Cancelled", "AbortError");
function waitFor(
  element: HTMLMediaElement,
  event: string,
  signal?: AbortSignal,
  timeout = 15000,
) {
  return new Promise<void>((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      element.removeEventListener(event, done);
      element.removeEventListener("error", failed);
      signal?.removeEventListener("abort", aborted);
    };
    const done = () => {
      clean();
      resolve();
    };
    const failed = () => {
      clean();
      reject(
        new Error(
          "This browser cannot decode the selected media. Try MP4/H.264 or WebM.",
        ),
      );
    };
    const aborted = () => {
      clean();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      clean();
      reject(new Error("Media decoding timed out"));
    }, timeout);
    element.addEventListener(event, done);
    element.addEventListener("error", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}
export async function inspectFile(file: File): Promise<Omit<Asset, "id">> {
  if (file.size > 256 * 1024 * 1024)
    throw new Error(
      "Embedded media is limited to 256 MB per file. Use a shorter or compressed clip.",
    );
  const type = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name)
      ? "video"
      : file.type.startsWith("audio/") ||
          /\.(wav|mp3|ogg|m4a|flac)$/i.test(file.name)
        ? "audio"
        : null;
  if (!type) throw new Error("Import an image, video, or audio file");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Cannot read this file"));
    reader.readAsDataURL(file);
  });
  if (type === "image") {
    const image = new Image();
    image.src = url;
    await image.decode();
    return {
      name: file.name,
      type,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  }
  const media = document.createElement(type === "video" ? "video" : "audio");
  media.preload = "auto";
  const ready = waitFor(media, "loadedmetadata");
  media.src = url;
  await ready;
  if (!Number.isFinite(media.duration)) {
    const ended = waitFor(media, "seeked");
    media.currentTime = 864000;
    await ended;
  }
  const duration = media.duration;
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("The media has no finite duration");
  const result: Omit<Asset, "id"> = {
    name: file.name,
    type,
    url,
    duration,
    width:
      type === "video" ? (media as HTMLVideoElement).videoWidth : undefined,
    height:
      type === "video" ? (media as HTMLVideoElement).videoHeight : undefined,
  };
  media.removeAttribute("src");
  media.load();
  return result;
}

/** The renderer serializes calls, so two seeks never race on the same decoder. */
export class MediaCache {
  private entries = new Map<
    string,
    { url: string; image?: HTMLImageElement; video?: HTMLVideoElement }
  >();
  private audio = new Map<string, { url: string; element: HTMLAudioElement }>();
  private trim(current: string) {
    const entry = this.entries.get(current);
    if (entry) {
      this.entries.delete(current);
      this.entries.set(current, entry);
    }
    const weight = (entry: {
      image?: HTMLImageElement;
      video?: HTMLVideoElement;
    }) =>
      entry.image
        ? entry.image.naturalWidth * entry.image.naturalHeight * 4
        : entry.video
          ? Math.max(
              16777216,
              entry.video.videoWidth * entry.video.videoHeight * 12,
            )
          : 0;
    let bytes = [...this.entries.values()].reduce(
      (total, entry) => total + weight(entry),
      0,
    );
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= 24 && bytes <= 256 * 1024 * 1024) break;
      if (key === current) continue;
      bytes -= weight(entry);
      if (entry.video) {
        entry.video.pause();
        entry.video.removeAttribute("src");
        entry.video.load();
      }
      this.entries.delete(key);
    }
  }
  async frame(
    asset: Asset,
    seconds: number,
    signal?: AbortSignal,
  ): Promise<CanvasImageSource | null> {
    if (signal?.aborted) throw abortError();
    let entry = this.entries.get(asset.id);
    if (entry?.url !== asset.url) {
      entry?.video?.pause();
      this.entries.delete(asset.id);
      entry = undefined;
    }
    if (!entry) {
      entry = { url: asset.url };
      this.entries.set(asset.id, entry);
    }
    if (asset.type === "image") {
      if (!entry.image) {
        const image = new Image();
        image.src = asset.url;
        await image.decode();
        entry.image = image;
      }
      this.trim(asset.id);
      return entry.image;
    }
    if (asset.type !== "video") return null;
    if (asset.duration && seconds >= asset.duration) return null;
    if (!entry.video) {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      const ready = waitFor(video, "loadeddata", signal);
      video.src = asset.url;
      await ready;
      entry.video = video;
    }
    const video = entry.video;
    if (seconds < 0 || seconds >= video.duration) return null;
    const time = Math.min(seconds, Math.max(0, video.duration - 0.00001));
    if (Math.abs(video.currentTime - time) > 0.00001 || video.readyState < 2) {
      const ready = waitFor(video, "seeked", signal);
      video.currentTime = time;
      await ready;
    }
    if (signal?.aborted) throw abortError();
    this.trim(asset.id);
    return video;
  }
  syncAudio(
    host: EditorHost,
    state: CompositionState,
    composition: Composition,
    frame: number,
    playing: boolean,
    muted: boolean,
  ) {
    const doc = host.read().doc,
      active = new Set<string>();
    for (const request of playing && !muted
      ? compositionAudio(doc, state, composition, frame, host.evaluate)
      : []) {
      const { asset, seconds: time } = request;
      active.add(request.id);
      let cached = this.audio.get(request.id);
      if (!cached || cached.url !== asset.url) {
        cached?.element.pause();
        cached = { url: asset.url, element: new Audio(asset.url) };
        this.audio.set(request.id, cached);
      }
      const audio = cached.element;
      audio.volume = Math.max(0, Math.min(1, request.gain));
      audio.playbackRate = Math.max(0.0625, Math.min(16, request.rate));
      if (Math.abs(audio.currentTime - time) > 0.15) audio.currentTime = time;
      if (audio.paused) void audio.play().catch(() => {});
    }
    for (const [key, cached] of this.audio)
      if (!active.has(key)) cached.element.pause();
  }
  dispose() {
    for (const entry of this.entries.values())
      if (entry.video) {
        entry.video.pause();
        entry.video.removeAttribute("src");
        entry.video.load();
      }
    for (const cached of this.audio.values()) {
      cached.element.pause();
      cached.element.removeAttribute("src");
      cached.element.load();
    }
    this.entries.clear();
    this.audio.clear();
  }
}
export function assetDuration(asset: Asset, fps: number, fallback: number) {
  return asset.duration
    ? Math.max(1, Math.ceil(asset.duration * fps))
    : fallback;
}
export function clipAudioName(clip: Clip) {
  return clip.kind === "video" || clip.kind === "audio";
}
