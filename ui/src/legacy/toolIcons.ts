/* Popai Animator toolbar icons.
 * One minimal style for every tool, after Moho's toolbar: the object the tool works on is drawn in the
 * light main colour (currentColor), and what the tool DOES to it (add, move, bend, link, select...) is drawn
 * in the teal accent (class "a" = accent stroke, "af" = accent fill). Every bone tool uses the same bone shape,
 * so the bone tells you the category and the teal mark tells you the action. 24x24 grid. */

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A bone: a long kite from base (x0,y0) to tip (x1,y1), widest a fifth of the way along, like Moho. */
function bone(x0: number, y0: number, x1: number, y1: number, w = 3, extra = 'fill="currentColor" fill-opacity=".28"') {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L, mx = x0 + dx * 0.2, my = y0 + dy * 0.2;
  return `<path d="M${x0} ${y0}L${r1(mx + nx * w)} ${r1(my + ny * w)}L${x1} ${y1}L${r1(mx - nx * w)} ${r1(my - ny * w)}Z" ${extra}/>`;
}
const ghostBone = (x0: number, y0: number, x1: number, y1: number, w = 2.5) =>
  bone(x0, y0, x1, y1, w, 'stroke-dasharray="1.6 1.6" stroke-opacity=".55"');

const svg = (inner: string) =>
  `<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/** Standard bone used by most bone tools: lower-left, leaving the top-right corner for the action mark. */
const B = bone(3, 21, 15.5, 8.5);
/** Mouse pointer (filled accent) */
const cursor = (x: number, y: number) =>
  `<path class="af" d="M${x} ${y}v9.2l2.4-2.2 1.7 3.6 1.7-.8-1.7-3.5 3.3-.3z" stroke="none"/>`;
/** Small square vector point */
const node = (x: number, y: number, cls = 'af') => `<rect class="${cls}" x="${x - 1.4}" y="${y - 1.4}" width="2.8" height="2.8" stroke="none"/>`;

export const TOOL_ICONS: Record<string, string> = {
  // ---------- Select ----------
  // Select / transform layer: pointer over a layer frame with handles
  select: svg(
    '<rect x="8.5" y="8.5" width="12" height="12" rx="1" stroke-dasharray="2 1.8"/>' +
    node(8.5, 20.5, 'af') + node(20.5, 8.5, 'af') + node(20.5, 20.5, 'af') +
    '<path d="M3 2.5v10.5l2.8-2.6 2 4.2 2-1-2-4.1 3.8-.3z" fill="currentColor" stroke="none"/>'),
  // Select / transform points: marquee box around a path's points
  points: svg(
    '<rect x="2.5" y="2.5" width="19" height="19" rx="1" stroke-dasharray="2 2" stroke-opacity=".7"/>' +
    '<path d="M6 17C8 9 12 15 18 7"/>' + node(6, 17) + node(11.6, 12.4) + node(18, 7)),

  // ---------- Draw ----------
  // Pen: nib + the point it adds
  pen: svg(
    '<path d="M15 3.5l5.5 5.5-2.8 1.4-4.2 7-8.5 3.1 3.1-8.5 7-4.2z"/><path d="M5 20.5l5.6-5.6"/><circle cx="12" cy="12" r="1.3"/>' +
    node(4, 4)),
  // Freehand: pencil and the loose stroke it leaves
  freehand: svg(
    '<path d="M15.5 3.5l5 5L10 19l-5.5.5L5 14z"/><path d="M13.5 5.5l5 5"/>' +
    '<path class="a" d="M12.5 21c2-1.8 3.2.6 5-1s2.8.8 4-.6"/>'),
  // Create shape: rectangle, ellipse and star together (the shape is picked in the bar above)
  shape: svg('<rect x="2.5" y="9.5" width="11" height="11" rx="1"/><circle cx="16" cy="8" r="5.5" fill="currentColor" fill-opacity=".14"/>' +
    '<path class="a" d="M17.5 13.6l1.3 2.5 2.8.4-2 2 .5 2.8-2.6-1.3-2.5 1.3.5-2.8-2-2 2.8-.4z" stroke-width="1.4"/>'),
  // Rectangle: box dragged corner to corner
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="1"/>' + node(4, 6) + node(20, 18)),
  // Ellipse
  ellipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>' + node(12, 5.5) + node(20.5, 12) + node(12, 18.5) + node(3.5, 12)),
  // Polygon / star
  polygon: svg('<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>' + node(12, 3)),
  // Text
  text: svg('<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/><path class="a" d="M17.5 12.5v7"/>'),

  // ---------- Edit ----------
  // Curvature: a curve with its smoothness handle
  curvature: svg('<path d="M3 19C6 6 18 6 21 19"/><path class="a" d="M5 9.2h14"/>' + node(12, 9.2) +
    '<circle class="a" cx="5" cy="9.2" r="1.3"/><circle class="a" cx="19" cy="9.2" r="1.3"/>'),
  // Paint bucket: tipped bucket pouring a drop
  fill: svg('<path d="M4 11.5L11 4.5l7.5 7.5-7 7z"/><path d="M4 11.5h14.5"/><path d="M8.5 7L6 4.5"/>' +
    '<path class="af" d="M20.5 14.5s2 2.6 2 3.9a2 2 0 0 1-4 0c0-1.3 2-3.9 2-3.9z" stroke="none"/>'),

  // ---------- Bone ----------
  // Select bone: bone + pointer
  bonesel: svg(B + cursor(14.5, 2.5)),
  // Add bone: bone + plus
  boneadd: svg(B + '<path class="a" d="M18.5 2.5v7.5M14.75 6.25h7.5" stroke-width="2"/>'),
  // Transform bone: bone + move arrows
  bonetf: svg(B + '<path class="a" d="M18 2v8.5M13.75 6.25h8.5M16.6 3.4L18 2l1.4 1.4M16.6 9.1L18 10.5l1.4-1.4M15.15 4.85l-1.4 1.4 1.4 1.4M20.85 4.85l1.4 1.4-1.4 1.4"/>'),
  // Manipulate bones: a two-bone chain whose tip is being dragged (IK bend)
  bonemanip: svg(bone(3, 21, 10, 13, 2.8) + bone(10, 13, 19, 10, 2.8) +
    '<circle class="af" cx="19" cy="10" r="1.8" stroke="none"/><path class="a" d="M21.5 15.5c-.5-4.5-3-8-7-10"/><path class="a" d="M16.8 4.3l-2.3 1.2 1 2.4"/>'),
  // Reparent: a child bone being attached to a new parent (dashed link)
  reparent: svg(bone(2.5, 21.5, 11, 13, 2.8) + bone(13, 3.5, 21.5, 3.5, 2.4) +
    '<path class="a" d="M13 6.5c-3.5.5-4.5 2.5-3.2 5"/><path class="a" d="M8 9.9l1.8 1.6 1.9-1.5"/><circle class="af" cx="11" cy="13" r="1.5" stroke="none"/>'),
  // Bone strength: bone inside its influence region
  strength: svg(bone(5, 19, 19, 5, 2.9) +
    '<ellipse class="a" cx="12" cy="12" rx="10.5" ry="4.6" transform="rotate(-45 12 12)" stroke-dasharray="2 1.8"/>'),
  // Vitruvian bones: one bone with alternative versions from the same base
  vitruvian: svg(bone(4.5, 20, 18, 6.5, 2.9) + bone(4.5, 20, 21, 15, 2.6, 'class="a" stroke-dasharray="1.6 1.6"') +
    bone(4.5, 20, 9.5, 3, 2.6, 'class="a" stroke-dasharray="1.6 1.6"') + '<circle cx="4.5" cy="20" r="1.6" fill="currentColor"/>'),
  // Sketch bones: a drawn stroke turned into a chain of bones
  sketch: svg(bone(2.5, 21, 8, 15.5, 2.1) + bone(8, 15.5, 13.5, 13, 2.1) + bone(13.5, 13, 16.5, 7.5, 2.1) +
    '<path class="a" d="M17.2 6.8l3.3-3.3 2 2-3.3 3.3-2.6.6z"/>'),
  // Bind layer: a layer linked to a bone
  bind: svg('<rect x="2.5" y="2.5" width="9" height="9" rx="1.2" fill="currentColor" fill-opacity=".18"/>' + bone(10.5, 21, 21, 10.5, 2.9) +
    '<path class="a" d="M8.6 11.4l-.9.9a2 2 0 0 0 2.8 2.8l.9-.9M11.4 8.6l.9-.9a2 2 0 0 1 2.8 2.8l-.9.9M10.3 13.7l3.4-3.4"/>'),
  // Bind points: points linked to a bone
  bindpts: svg(node(3.5, 4, 'af') + node(9, 3, 'af') + node(4, 9.5, 'af') + bone(10.5, 21, 21, 10.5, 2.9) +
    '<path class="a" d="M5.5 6l7.5 9" stroke-dasharray="1.6 1.6"/>'),
  // Offset bone: bone moved away from where it was (dashed)
  offset: svg(ghostBone(2.5, 13, 12, 3.5, 2.1) + bone(10, 21, 21, 10, 2.9) +
    '<path class="a" d="M7.5 12.5l5 5M12.5 13.8v3.7H8.8"/>'),
  // Bone physics: bone continuing as a spring with a weight
  physics: svg(bone(3, 21, 10.5, 13.5, 2.8) +
    '<path class="a" d="M10.5 13.5l.8-2.6 1.9 1.9.8-2.6 1.9 1.9.8-2.6 1.9 1.9.6-2"/><circle class="af" cx="19.8" cy="4.6" r="2.3" stroke="none"/>'),
  // Force: wind lines and a gravity arrow
  force: svg('<path class="a" d="M2.5 7.5h9a2.5 2.5 0 1 0-2.5-2.5M2.5 12h12a2.5 2.5 0 1 1-2.5 2.5M2.5 16.5h6"/>' +
    '<path d="M19.5 8v13M17 18.5l2.5 2.5 2.5-2.5"/>'),

  // ---------- FX ----------
  // Particle emitter: a source spraying particles
  emitter: svg('<circle cx="6" cy="18" r="2.6" fill="currentColor" fill-opacity=".28"/>' +
    '<circle class="af" cx="12" cy="11" r="1.3" stroke="none"/><circle class="af" cx="17" cy="6" r="1.1" stroke="none"/>' +
    '<circle class="af" cx="15.5" cy="14" r="1.2" stroke="none"/><circle class="af" cx="20.5" cy="11" r="1" stroke="none"/>' +
    '<circle class="af" cx="9" cy="6" r="1" stroke="none"/><circle class="af" cx="19.5" cy="18" r="1" stroke="none"/>' +
    '<path class="a" d="M8.2 15.8l1.6-1.6M9 17.6h1.8M7.8 14l.3-1.6"/>'),

  // ---------- Camera ----------
  camera: svg('<rect x="2.5" y="9" width="13" height="10" rx="1.8"/><path d="M15.5 12.5l6-3.5v10l-6-3.5"/>' +
    '<circle cx="6" cy="5.5" r="2.5"/><circle cx="12" cy="5.5" r="2.5"/><circle class="af" cx="6.5" cy="14" r="1.4" stroke="none"/>'),

  // ---------- View ----------
  pan: svg('<path d="M8 13V5.6a1.5 1.5 0 0 1 3 0V11M11 4.6a1.5 1.5 0 0 1 3 0V11M14 5.6a1.5 1.5 0 0 1 3 0V12M17 8.6a1.5 1.5 0 0 1 3 0V14c0 4-3 7-7 7h-1.2c-2.3 0-3.9-.9-5.3-2.8L3.8 14.6c-.7-1.2.9-2.5 2-1.5L8 15.2"/>'),
  zoom: svg('<circle cx="10" cy="10" r="6.5"/><path d="M14.8 14.8L21 21" stroke-width="2.4"/><path class="a" d="M10 7v6M7 10h6"/>'),
};
