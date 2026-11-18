import { clamp, id, number, type Effect, type Value } from "./model";
export interface Parameter {
  label: string;
  initial: Value;
  min?: number;
  max?: number;
  step?: number;
}
export interface EffectDefinition {
  label: string;
  category: string;
  description: string;
  parameters: Record<string, Parameter>;
  legacy?: string;
}
const n = (
  label: string,
  initial: number,
  min: number,
  max: number,
  step = 0.1,
): Parameter => ({ label, initial, min, max, step });
const color = (label: string, initial: string): Parameter => ({
  label,
  initial,
});
export const EFFECTS: Record<string, EffectDefinition> = {
  color: {
    label: "Color correction",
    category: "Color",
    description: "Match brightness, contrast, saturation, and hue.",
    legacy: "color",
    parameters: {
      brightness: n("Brightness", 1, 0, 3, 0.01),
      contrast: n("Contrast", 1, 0, 3, 0.01),
      saturation: n("Saturation", 1, 0, 3, 0.01),
      hue: n("Hue °", 0, -180, 180, 1),
    },
  },
  exposure: {
    label: "Exposure",
    category: "Color",
    description: "Adjust light in photographic stops.",
    parameters: { stops: n("Exposure · stops", 0, -8, 8, 0.05) },
  },
  levels: {
    label: "Levels",
    category: "Color",
    description: "Set input black, white, and midtone gamma.",
    parameters: {
      black: n("Black point", 0, 0, 0.99, 0.01),
      white: n("White point", 1, 0.01, 1, 0.01),
      gamma: n("Gamma", 1, 0.1, 5, 0.05),
    },
  },
  tint: {
    label: "Colorize",
    category: "Color",
    description: "Blend a color into existing artwork.",
    legacy: "tint",
    parameters: {
      color: color("Color", "#3a86ff"),
      amount: n("Mix", 0.3, 0, 1, 0.01),
    },
  },
  glow: {
    label: "Glow",
    category: "Light",
    description: "Spread colored light behind the source alpha.",
    legacy: "glow",
    parameters: {
      radius: n("Radius · px", 18, 0, 300, 0.5),
      intensity: n("Intensity", 1.5, 0, 6, 0.05),
      color: color("Color", "#ffd27a"),
    },
  },
  shadow: {
    label: "Drop shadow",
    category: "Light",
    description: "Add an offset, softened copy of source alpha.",
    legacy: "shadow",
    parameters: {
      dx: n("Offset X · px", 10, -500, 500, 1),
      dy: n("Offset Y · px", 12, -500, 500, 1),
      softness: n("Softness · px", 12, 0, 200, 0.5),
      opacity: n("Opacity", 0.45, 0, 1, 0.01),
      color: color("Color", "#000000"),
    },
  },
  blur: {
    label: "Gaussian blur",
    category: "Blur",
    description: "Soften the source in both directions.",
    legacy: "blur",
    parameters: { radius: n("Radius · px", 8, 0, 200, 0.5) },
  },
  streak: {
    label: "Directional blur",
    category: "Blur",
    description: "Smear along a chosen angle.",
    legacy: "streak",
    parameters: {
      angle: n("Angle °", 0, -180, 180, 1),
      length: n("Length · px", 30, 0, 500, 1),
      samples: n("Samples", 10, 2, 40, 1),
    },
  },
  keyer: {
    label: "Chroma key",
    category: "Keying",
    description: "Remove a sampled color; inspect the result in Alpha view.",
    parameters: {
      color: color("Key color", "#00ff00"),
      tolerance: n("Tolerance", 0.22, 0, 1, 0.01),
      softness: n("Edge softness", 0.12, 0.001, 1, 0.01),
      despill: n("Spill suppression", 0.6, 0, 1, 0.01),
    },
  },
  luma: {
    label: "Luma key",
    category: "Keying",
    description: "Reveal pixels according to brightness.",
    parameters: {
      threshold: n("Threshold", 0.25, 0, 1, 0.01),
      softness: n("Softness", 0.1, 0.001, 1, 0.01),
      invert: { label: "Invert", initial: false },
    },
  },
  outline: {
    label: "Outline",
    category: "Style",
    description: "Add a border around the source silhouette.",
    legacy: "outline",
    parameters: {
      width: n("Width · px", 4, 0, 100, 0.5),
      color: color("Color", "#111111"),
    },
  },
  grain: {
    label: "Film grain",
    category: "Style",
    description: "Deterministic grain for matching sources.",
    parameters: {
      amount: n("Amount", 0.15, 0, 1, 0.01),
      size: n("Size · px", 2, 1, 40, 0.5),
      seed: n("Seed", 1, 0, 9999, 1),
      animated: { label: "Animate grain", initial: true },
    },
  },
  pixelate: {
    label: "Pixelate",
    category: "Style",
    description: "Reduce the image to coarse blocks.",
    legacy: "pixelate",
    parameters: { size: n("Block size · px", 12, 1, 200, 1) },
  },
  chroma: {
    label: "Chromatic aberration",
    category: "Style",
    description: "Offset RGB channels for a lens or glitch treatment.",
    legacy: "chroma",
    parameters: {
      offset: n("Offset · px", 4, 0, 80, 0.5),
      angle: n("Angle °", 0, -180, 180, 1),
    },
  },
  vignette: {
    label: "Vignette",
    category: "Light",
    description: "Darken the edges of the frame.",
    parameters: {
      amount: n("Amount", 0.4, 0, 1, 0.01),
      radius: n("Clear center", 0.35, 0, 0.95, 0.01),
    },
  },
  echo: {
    label: "Motion echo",
    category: "Time",
    description:
      "Composite earlier source frames, including animated transforms.",
    parameters: {
      samples: n("Copies", 4, 1, 12, 1),
      spacing: n("Frame spacing", 2, 1, 20, 1),
      decay: n("Decay", 0.6, 0.05, 1, 0.01),
    },
  },
};
export function newEffect(type: string): Effect {
  const definition = EFFECTS[type];
  if (!definition) throw new Error("Unknown effect");
  return {
    id: id(),
    type,
    enabled: true,
    p: Object.fromEntries(
      Object.entries(definition.parameters).map(([key, p]) => [key, p.initial]),
    ),
  };
}
const rgb = (value: Value) => {
  const hex = String(value).replace("#", "");
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
};
/** Pixel operations are shared by every viewer/export path; alpha is kept straight here. */
export function processPixels(
  pixels: Uint8ClampedArray,
  type: string,
  p: Record<string, Value>,
  width = pixels.length / 4,
) {
  const key = rgb(p.color || "#00ff00");
  const dominant = key.indexOf(Math.max(...key));
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i],
      g = pixels[i + 1],
      b = pixels[i + 2];
    if (type === "keyer") {
      const distance =
        Math.hypot(r - key[0], g - key[1], b - key[2]) /
        Math.sqrt(3 * 255 * 255);
      const keep = clamp(
        (distance - number(p.tolerance)) /
          Math.max(0.001, number(p.softness, 0.1)),
        0,
        1,
      );
      pixels[i + 3] *= keep;
      const other = [r, g, b].filter((_, j) => j !== dominant);
      const excess = Math.max(0, pixels[i + dominant] - Math.max(...other));
      pixels[i + dominant] -= excess * number(p.despill) * (1 - keep * 0.5);
    } else if (type === "luma") {
      let keep = clamp(
        ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 - number(p.threshold)) /
          Math.max(0.001, number(p.softness)),
        0,
        1,
      );
      if (p.invert) keep = 1 - keep;
      pixels[i + 3] *= keep;
    } else if (type === "exposure") {
      const multiplier = 2 ** number(p.stops);
      for (let j = 0; j < 3; j++) pixels[i + j] *= multiplier;
    } else if (type === "grain") {
      const size = Math.max(1, number(p.size, 2)),
        pixel = i / 4,
        cell =
          Math.floor((pixel % width) / size) +
          Math.floor(Math.floor(pixel / width) / size) * 4099;
      let hash =
        Math.imul(cell + 1, 374761393) ^
        Math.imul(number(p.seed, 1) + 1, 668265263);
      hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
      const amount =
        (((hash ^ (hash >>> 16)) >>> 0) / 4294967296 - 0.5) *
        255 *
        number(p.amount, 0.15);
      for (let j = 0; j < 3; j++) pixels[i + j] += amount;
    } else if (type === "levels") {
      const black = number(p.black),
        span = Math.max(0.001, number(p.white, 1) - black),
        gamma = Math.max(0.1, number(p.gamma, 1));
      for (let j = 0; j < 3; j++)
        pixels[i + j] =
          255 *
          clamp((pixels[i + j] / 255 - black) / span, 0, 1) ** (1 / gamma);
    }
  }
}
export function mattePixels(
  pixels: Uint8ClampedArray,
  luma: boolean,
  invert: boolean,
) {
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = luma
      ? ((0.2126 * pixels[i] +
          0.7152 * pixels[i + 1] +
          0.0722 * pixels[i + 2]) *
          pixels[i + 3]) /
        255
      : pixels[i + 3];
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = invert ? 255 - alpha : alpha;
  }
}
/** Crossfade premultiplied pixels, then return straight alpha to ImageData. */
export function mixAdjustment(
  original: Uint8ClampedArray,
  processed: Uint8ClampedArray,
  amount: number,
  matte?: Uint8ClampedArray,
) {
  for (let i = 0; i < original.length; i += 4) {
    const mix = clamp(amount * (matte ? matte[i + 3] / 255 : 1), 0, 1),
      a = original[i + 3] / 255,
      b = processed[i + 3] / 255,
      alpha = a * (1 - mix) + b * mix;
    for (let j = 0; j < 3; j++)
      original[i + j] =
        alpha > 0
          ? (original[i + j] * a * (1 - mix) + processed[i + j] * b * mix) /
            alpha
          : 0;
    original[i + 3] = alpha * 255;
  }
}
