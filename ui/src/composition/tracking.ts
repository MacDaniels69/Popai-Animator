/** A bounded, conventional point tracker. No model service or network is involved. */
export interface GrayFrame {
  width: number;
  height: number;
  pixels: Float32Array;
}
export interface TrackPoint {
  frame: number;
  x: number;
  y: number;
  confidence: number;
}
export interface MotionTrack {
  id: string;
  name: string;
  points: TrackPoint[];
}
export function grayscale(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): GrayFrame {
  const pixels = new Float32Array(width * height);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] =
      ((0.2126 * data[i * 4] +
        0.7152 * data[i * 4 + 1] +
        0.0722 * data[i * 4 + 2]) *
        data[i * 4 + 3]) /
      255;
  return { width, height, pixels };
}
export function patch(
  frame: GrayFrame,
  x: number,
  y: number,
  radius = 5,
): Float32Array {
  x = Math.round(x);
  y = Math.round(y);
  if (
    x < radius ||
    y < radius ||
    x >= frame.width - radius ||
    y >= frame.height - radius
  )
    throw new Error("Pick a feature farther from the edge");
  const result = new Float32Array((radius * 2 + 1) ** 2);
  let i = 0;
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++)
      result[i++] = frame.pixels[(y + dy) * frame.width + x + dx];
  return result;
}
export function matchPatch(
  template: Float32Array,
  frame: GrayFrame,
  x: number,
  y: number,
  search = 22,
) {
  const size = Math.sqrt(template.length),
    radius = (size - 1) / 2;
  const average =
    template.reduce((sum, value) => sum + value, 0) / template.length;
  const centered = template.map((value) => value - average),
    variance = centered.reduce((sum, value) => sum + value * value, 0);
  if (variance < template.length * 9)
    throw new Error(
      "This feature has too little texture. Pick a contrasting detail.",
    );
  let best = -2,
    bestX = x,
    bestY = y;
  for (
    let cy = Math.max(radius, Math.round(y) - search);
    cy <= Math.min(frame.height - radius - 1, Math.round(y) + search);
    cy++
  ) {
    for (
      let cx = Math.max(radius, Math.round(x) - search);
      cx <= Math.min(frame.width - radius - 1, Math.round(x) + search);
      cx++
    ) {
      let sum = 0,
        squared = 0,
        product = 0,
        i = 0;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const value = frame.pixels[(cy + dy) * frame.width + cx + dx];
          sum += value;
          squared += value * value;
          product += value * centered[i++];
        }
      const candidateVariance = Math.max(
        0,
        squared - (sum * sum) / template.length,
      );
      const score =
        candidateVariance > 1
          ? product / Math.sqrt(variance * candidateVariance)
          : -1;
      // A tiny distance penalty resolves ambiguous repeated details in favor of continuity.
      const rank = score - Math.hypot(cx - x, cy - y) * 0.00005;
      if (rank > best) {
        best = rank;
        bestX = cx;
        bestY = cy;
      }
    }
  }
  return { x: bestX, y: bestY, confidence: Math.max(-1, Math.min(1, best)) };
}
