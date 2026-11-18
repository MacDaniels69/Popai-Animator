import { number, valueAt, type Clip, type EditorHost } from "./model";
export interface Particle {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}
const random = (index: number, seed: number) => {
  let n = Math.imul(index + 1, 374761393) ^ Math.imul(seed + 1, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
export function particlePositions(
  clip: Clip,
  frame: number,
  seconds: number,
  evaluate: EditorHost["evaluate"],
): Particle[] {
  const read = (key: string, fallback: number) =>
    number(valueAt(clip, key, frame, evaluate), fallback);
  const life = Math.max(0.05, read("life", 1.4)),
    rate = Math.max(0, read("rate", 30)),
    seed = read("seed", 7),
    burst = Math.floor(read("burst", 0));
  const count =
      burst > 0
        ? Math.min(400, burst)
        : Math.min(400, Math.floor(seconds * rate) + 1),
    offset =
      burst > 0 ? 0 : Math.max(0, Math.floor(seconds * rate) + 1 - count);
  const result: Particle[] = [];
  for (let n = offset; n < offset + count; n++) {
    const born = burst > 0 ? 0 : rate > 0 ? n / rate : Infinity,
      age = seconds - born;
    if (age < 0 || age >= life) continue;
    const angle =
      ((read("angle", -90) + (random(n * 3, seed) - 0.5) * read("spread", 90)) *
        Math.PI) /
      180;
    const speed = read("speed", 160) * (0.6 + random(n * 3 + 1, seed) * 0.8),
      phase = age / life;
    result.push({
      x: Math.cos(angle) * speed * age,
      y: Math.sin(angle) * speed * age + 0.5 * read("gravity", 200) * age * age,
      radius: Math.max(0.1, read("size", 12) * (1 - phase * 0.65)),
      alpha: (1 - phase) * (0.6 + random(n * 3 + 2, seed) * 0.4),
    });
  }
  return result;
}
