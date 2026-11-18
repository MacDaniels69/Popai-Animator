// Minimal two-tone toolbar icons: light = what the tool works on, teal = what it does.
/* Popai Animator toolbar icons.
 * One minimal style for every tool, after Moho's toolbar: the object the tool works on is drawn in the
 * light main colour (currentColor), and what the tool DOES to it (add, move, bend, link, select...) is drawn
 * in the teal accent (class "a" = accent stroke, "af" = accent fill). Every bone tool uses the same bone shape,
 * so the bone tells you the category and the teal mark tells you the action. 24x24 grid. */

const r1 = (n) => Math.round(n * 10) / 10;

/** A bone: a long kite from base (x0,y0) to tip (x1,y1), widest a fifth of the way along, like Moho. */
function bone(x0, y0, x1, y1, w = 3, extra = 'fill="currentColor" fill-opacity=".28"') {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L, mx = x0 + dx * 0.2, my = y0 + dy * 0.2;
  return `<path d="M${x0} ${y0}L${r1(mx + nx * w)} ${r1(my + ny * w)}L${x1} ${y1}L${r1(mx - nx * w)} ${r1(my - ny * w)}Z" ${extra}/>`;
}
const ghostBone = (x0, y0, x1, y1, w = 2.5) =>
  bone(x0, y0, x1, y1, w, 'stroke-dasharray="1.6 1.6" stroke-opacity=".55"');

const svgT = (inner) =>
  `<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/** Standard bone used by most bone tools: lower-left, leaving the top-right corner for the action mark. */
const B = bone(3, 21, 15.5, 8.5);
/** Mouse pointer (filled accent) */
const cursorI = (x, y) =>
  `<path class="af" d="M${x} ${y}v9.2l2.4-2.2 1.7 3.6 1.7-.8-1.7-3.5 3.3-.3z" stroke="none"/>`;
/** Small square vector point */
const nodeI = (x, y, cls = 'af') => `<rect class="${cls}" x="${x - 1.4}" y="${y - 1.4}" width="2.8" height="2.8" stroke="none"/>`;

const TOOL_ICONS = {
  // ---------- Select ----------
  // Select / transform layer: pointer over a layer frame with handles
  select: svgT(
    '<rect x="8.5" y="8.5" width="12" height="12" rx="1" stroke-dasharray="2 1.8"/>' +
    nodeI(8.5, 20.5, 'af') + nodeI(20.5, 8.5, 'af') + nodeI(20.5, 20.5, 'af') +
    '<path d="M3 2.5v10.5l2.8-2.6 2 4.2 2-1-2-4.1 3.8-.3z" fill="currentColor" stroke="none"/>'),
  // Rotate layer XY: a layer card turned in space, with the turning arrow
  rotxy: svgT('<path d="M7 5.5l9-2v17l-9-2z" fill="currentColor" fill-opacity=".2"/>' +
    '<path class="a" d="M3 12c0 2.3 4 4.2 9 4.2s9-1.9 9-4.2"/><path class="a" d="M18.6 17.6l2.3-1.4-1.3-2.4"/>'),
  // Select / transform points: marquee box around a path's points
  points: svgT(
    '<rect x="2.5" y="2.5" width="19" height="19" rx="1" stroke-dasharray="2 2" stroke-opacity=".7"/>' +
    '<path d="M6 17C8 9 12 15 18 7"/>' + nodeI(6, 17) + nodeI(11.6, 12.4) + nodeI(18, 7)),

  // ---------- Draw ----------
  // Pen: nib + the point it adds
  pen: svgT(
    '<path d="M15 3.5l5.5 5.5-2.8 1.4-4.2 7-8.5 3.1 3.1-8.5 7-4.2z"/><path d="M5 20.5l5.6-5.6"/><circle cx="12" cy="12" r="1.3"/>' +
    nodeI(4, 4)),
  // Freehand: pencil and the loose stroke it leaves
  freehand: svgT(
    '<path d="M15.5 3.5l5 5L10 19l-5.5.5L5 14z"/><path d="M13.5 5.5l5 5"/>' +
    '<path class="a" d="M12.5 21c2-1.8 3.2.6 5-1s2.8.8 4-.6"/>'),
  // Create shape: rectangle, ellipse and star together (the shape is picked in the bar above)
  shape: svgT('<rect x="2.5" y="9.5" width="11" height="11" rx="1"/><circle cx="16" cy="8" r="5.5" fill="currentColor" fill-opacity=".14"/>' +
    '<path class="a" d="M17.5 13.6l1.3 2.5 2.8.4-2 2 .5 2.8-2.6-1.3-2.5 1.3.5-2.8-2-2 2.8-.4z" stroke-width="1.4"/>'),
  // Rectangle: box dragged corner to corner
  rect: svgT('<rect x="4" y="6" width="16" height="12" rx="1"/>' + nodeI(4, 6) + nodeI(20, 18)),
  // Ellipse
  ellipse: svgT('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>' + nodeI(12, 5.5) + nodeI(20.5, 12) + nodeI(12, 18.5) + nodeI(3.5, 12)),
  // Polygon / star
  polygon: svgT('<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>' + nodeI(12, 3)),
  // Text
  text: svgT('<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/><path class="a" d="M17.5 12.5v7"/>'),

  // ---------- Edit ----------
  // Select shape: a filled shape picked by the pointer
  selshape: svgT('<path d="M3.5 12.5c0-5 4-8.5 8.5-8.5 3.5 0 5.5 2 5.5 4.5" fill="currentColor" fill-opacity=".3"/><path d="M3.5 12.5c0 3.7 2.7 6.5 6.5 6.5" fill="none"/>' +
    '<path d="M3.5 12.5c0-5 4-8.5 8.5-8.5 3.5 0 5.5 2 5.5 4.5M3.5 12.5c0 3.7 2.7 6.5 6.5 6.5"/>' + cursorI(12.5, 10.5)),
  // Create shape: a path's points getting a fill (checkered) — "make these points a shape"
  createshape: svgT('<path d="M4 18L7 5l11 2 2 11z" fill="currentColor" fill-opacity=".22"/><path d="M4 18L7 5l11 2 2 11z" stroke-dasharray="2 1.6"/>' +
    nodeI(4, 18, 'af') + nodeI(7, 5, 'af') + nodeI(18, 7, 'af') + nodeI(20, 18, 'af') + '<path class="a" d="M11.5 9.5v6M8.5 12.5h6" stroke-width="1.8"/>'),
  // Curvature: a curve with its smoothness handle
  curvature: svgT('<path d="M3 19C6 6 18 6 21 19"/><path class="a" d="M5 9.2h14"/>' + nodeI(12, 9.2) +
    '<circle class="a" cx="5" cy="9.2" r="1.3"/><circle class="a" cx="19" cy="9.2" r="1.3"/>'),
  // Paint bucket: tipped bucket pouring a drop
  fill: svgT('<path d="M4 11.5L11 4.5l7.5 7.5-7 7z"/><path d="M4 11.5h14.5"/><path d="M8.5 7L6 4.5"/>' +
    '<path class="af" d="M20.5 14.5s2 2.6 2 3.9a2 2 0 0 1-4 0c0-1.3 2-3.9 2-3.9z" stroke="none"/>'),

  // ---------- Bone ----------
  // Select bone: bone + pointer
  bonesel: svgT(B + cursorI(14.5, 2.5)),
  // Add bone: bone + plus
  boneadd: svgT(B + '<path class="a" d="M18.5 2.5v7.5M14.75 6.25h7.5" stroke-width="2"/>'),
  // Transform bone: bone + move arrows
  bonetf: svgT(B + '<path class="a" d="M18 2v8.5M13.75 6.25h8.5M16.6 3.4L18 2l1.4 1.4M16.6 9.1L18 10.5l1.4-1.4M15.15 4.85l-1.4 1.4 1.4 1.4M20.85 4.85l1.4 1.4-1.4 1.4"/>'),
  // Manipulate bones: a two-bone chain whose tip is being dragged (IK bend)
  bonemanip: svgT(bone(3, 21, 10, 13, 2.8) + bone(10, 13, 19, 10, 2.8) +
    '<circle class="af" cx="19" cy="10" r="1.8" stroke="none"/><path class="a" d="M21.5 15.5c-.5-4.5-3-8-7-10"/><path class="a" d="M16.8 4.3l-2.3 1.2 1 2.4"/>'),
  // Reparent: a child bone being attached to a new parent (dashed link)
  reparent: svgT(bone(2.5, 21.5, 11, 13, 2.8) + bone(13, 3.5, 21.5, 3.5, 2.4) +
    '<path class="a" d="M13 6.5c-3.5.5-4.5 2.5-3.2 5"/><path class="a" d="M8 9.9l1.8 1.6 1.9-1.5"/><circle class="af" cx="11" cy="13" r="1.5" stroke="none"/>'),
  // Bone strength: bone inside its influence region
  strength: svgT(bone(5, 19, 19, 5, 2.9) +
    '<ellipse class="a" cx="12" cy="12" rx="10.5" ry="4.6" transform="rotate(-45 12 12)" stroke-dasharray="2 1.8"/>'),
  // Vitruvian bones: one bone with alternative versions from the same base
  vitruvian: svgT(bone(4.5, 20, 18, 6.5, 2.9) + bone(4.5, 20, 21, 15, 2.6, 'class="a" stroke-dasharray="1.6 1.6"') +
    bone(4.5, 20, 9.5, 3, 2.6, 'class="a" stroke-dasharray="1.6 1.6"') + '<circle cx="4.5" cy="20" r="1.6" fill="currentColor"/>'),
  // Sketch bones: a drawn stroke turned into a chain of bones
  sketch: svgT(bone(2.5, 21, 8, 15.5, 2.1) + bone(8, 15.5, 13.5, 13, 2.1) + bone(13.5, 13, 16.5, 7.5, 2.1) +
    '<path class="a" d="M17.2 6.8l3.3-3.3 2 2-3.3 3.3-2.6.6z"/>'),
  // Bind layer: a layer linked to a bone
  bind: svgT('<rect x="2.5" y="2.5" width="9" height="9" rx="1.2" fill="currentColor" fill-opacity=".18"/>' + bone(10.5, 21, 21, 10.5, 2.9) +
    '<path class="a" d="M8.6 11.4l-.9.9a2 2 0 0 0 2.8 2.8l.9-.9M11.4 8.6l.9-.9a2 2 0 0 1 2.8 2.8l-.9.9M10.3 13.7l3.4-3.4"/>'),
  // Bind points: points linked to a bone
  bindpts: svgT(nodeI(3.5, 4, 'af') + nodeI(9, 3, 'af') + nodeI(4, 9.5, 'af') + bone(10.5, 21, 21, 10.5, 2.9) +
    '<path class="a" d="M5.5 6l7.5 9" stroke-dasharray="1.6 1.6"/>'),
  // Offset bone: bone moved away from where it was (dashed)
  offset: svgT(ghostBone(2.5, 13, 12, 3.5, 2.1) + bone(10, 21, 21, 10, 2.9) +
    '<path class="a" d="M7.5 12.5l5 5M12.5 13.8v3.7H8.8"/>'),
  // Bone physics: bone continuing as a spring with a weight
  physics: svgT(bone(3, 21, 10.5, 13.5, 2.8) +
    '<path class="a" d="M10.5 13.5l.8-2.6 1.9 1.9.8-2.6 1.9 1.9.8-2.6 1.9 1.9.6-2"/><circle class="af" cx="19.8" cy="4.6" r="2.3" stroke="none"/>'),
  // Force: wind lines and a gravity arrow
  force: svgT('<path class="a" d="M2.5 7.5h9a2.5 2.5 0 1 0-2.5-2.5M2.5 12h12a2.5 2.5 0 1 1-2.5 2.5M2.5 16.5h6"/>' +
    '<path d="M19.5 8v13M17 18.5l2.5 2.5 2.5-2.5"/>'),

  // ---------- FX ----------
  // Particle emitter: a source spraying particles
  emitter: svgT('<circle cx="6" cy="18" r="2.6" fill="currentColor" fill-opacity=".28"/>' +
    '<circle class="af" cx="12" cy="11" r="1.3" stroke="none"/><circle class="af" cx="17" cy="6" r="1.1" stroke="none"/>' +
    '<circle class="af" cx="15.5" cy="14" r="1.2" stroke="none"/><circle class="af" cx="20.5" cy="11" r="1" stroke="none"/>' +
    '<circle class="af" cx="9" cy="6" r="1" stroke="none"/><circle class="af" cx="19.5" cy="18" r="1" stroke="none"/>' +
    '<path class="a" d="M8.2 15.8l1.6-1.6M9 17.6h1.8M7.8 14l.3-1.6"/>'),

  // ---------- Camera ----------
  camera: svgT('<rect x="2.5" y="9" width="13" height="10" rx="1.8"/><path d="M15.5 12.5l6-3.5v10l-6-3.5"/>' +
    '<circle cx="6" cy="5.5" r="2.5"/><circle cx="12" cy="5.5" r="2.5"/><circle class="af" cx="6.5" cy="14" r="1.4" stroke="none"/>'),

  // ---------- View ----------
  pan: svgT('<path d="M8 13V5.6a1.5 1.5 0 0 1 3 0V11M11 4.6a1.5 1.5 0 0 1 3 0V11M14 5.6a1.5 1.5 0 0 1 3 0V12M17 8.6a1.5 1.5 0 0 1 3 0V14c0 4-3 7-7 7h-1.2c-2.3 0-3.9-.9-5.3-2.8L3.8 14.6c-.7-1.2.9-2.5 2-1.5L8 15.2"/>'),
  // Orbit workspace: an eye circling the scene
  orbit: svgT('<rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" fill-opacity=".2"/>' +
    '<ellipse class="a" cx="12" cy="12" rx="10" ry="4.5"/><path class="a" d="M19.3 6.5l2 2.3-2.6 1"/>' +
    '<ellipse class="a" cx="12" cy="12" rx="4.5" ry="10" stroke-opacity=".45"/>'),
  zoom: svgT('<circle cx="10" cy="10" r="6.5"/><path d="M14.8 14.8L21 21" stroke-width="2.4"/><path class="a" d="M10 7v6M7 10h6"/>'),
};

// ---- tools of the full vector / camera tool set ----
Object.assign(TOOL_ICONS, {
  // Transform points: a few points with move arrows
  pointtf: svgT('<path d="M5 17C7 10 11 15 15 8"/>' + nodeI(5, 17, 'af') + nodeI(10.2, 12.6, 'af') + nodeI(15, 8, 'af') +
    '<path class="a" d="M19 11v10M14 16h10M17.6 12.4L19 11l1.4 1.4M17.6 19.6L19 21l1.4-1.4M15.4 14.6L14 16l1.4 1.4M22.6 14.6L24 16l-1.4 1.4" stroke-width="1.4"/>'),
  // Delete edge: a path with a gap and a cross
  deleteedge: svgT('<path d="M3 17l5-7M16 7l5-3"/>' + nodeI(3, 17, 'af') + nodeI(21, 4, 'af') + '<path class="a" d="M9.5 9.5l5 5M14.5 9.5l-5 5" stroke-width="2"/>'),
  // Magnet: pulls points
  magnet: svgT('<path d="M5 4v8a7 7 0 0 0 14 0V4h-4v8a3 3 0 0 1-6 0V4z" fill="currentColor" fill-opacity=".2"/><path class="a" d="M5 4h4M15 4h4"/>'),
  // Blob brush: a filled round stroke
  blob: svgT('<path d="M4 16c0-4 4-5 7-5s4-3 7-3 3 4 1 6-5 1-7 3-8 2-8-1z" fill="currentColor" fill-opacity=".3"/><path class="a" d="M17 4l3 3-6 6-3-3z"/>'),
  // Vector eraser
  eraser: svgT('<path d="M3 16l8-8 7 7-5 5H7z" fill="currentColor" fill-opacity=".18"/><path d="M7 20h13"/><path class="a" d="M11 8l5-5 6 6-5 5"/>'),
  // Point reduction: many points become few
  reduce: svgT('<path d="M3 17C6 9 9 9 12 12s6 3 9-5"/>' + [3, 6, 9, 12, 15, 18, 21].map((x, i) => `<circle cx="${x}" cy="${[17, 11.5, 10, 12, 13.6, 12, 7][i]}" r="1" fill="currentColor" stroke="none"/>`).join('') + '<path class="a" d="M8 21h8M13 19l3 2-3 2" stroke-width="1.5"/>'),
  // Scatter brush: sprinkled shapes
  scatter: svgT('<path class="a" d="M3 21l7-7"/>' + nodeI(13, 11) + nodeI(18, 6) + nodeI(19, 14) + nodeI(10, 4) + '<circle cx="15" cy="18" r="1.6" fill="currentColor" stroke="none"/><circle cx="6" cy="10" r="1.3" fill="currentColor" stroke="none"/>'),
  // Perspective: a square pulled into a trapezoid
  perspective: svgT('<path d="M8 6h8l5 13H3z" fill="currentColor" fill-opacity=".18"/><path class="a" d="M8 6l-3-3M16 6l3-3" stroke-dasharray="1.6 1.6"/>'),
  // Shear: a square slanted
  shear: svgT('<path d="M7 5h13l-3 14H4z" fill="currentColor" fill-opacity=".18"/><path class="a" d="M3 3h6M18 21h-6M7 3l-2 0M15 21l2 0" /><path class="a" d="M7.5 2.2L9 3l-1.5.8M16.5 20.2L15 21l1.5.8"/>'),
  // Bend: a straight bar bent into an arc
  bend: svgT('<path d="M4 18c2-9 14-9 16 0" stroke-width="3.2" stroke-opacity=".35"/><path d="M4 18c2-9 14-9 16 0"/><path class="a" d="M12 4v5M10 7l2 2 2-2"/>'),
  // Noise: a jittery line
  noise: svgT('<path d="M2 12l2-4 2 7 2-9 2 8 2-5 2 6 2-8 2 7 2-4 2 2"/><path class="a" d="M2 19h20" stroke-dasharray="1.5 2"/>'),
  // Delete shape: a filled shape with a cross (its points stay)
  deleteshape: svgT('<path d="M4 17L7 5l11 2 2 11z" fill="currentColor" fill-opacity=".22"/><path d="M4 17L7 5l11 2 2 11z" stroke-dasharray="2 1.6"/><path class="a" d="M9 9l6 6M15 9l-6 6" stroke-width="2"/>'),
  // Line width: a stroke getting thicker
  linewidth: svgT('<path d="M3 8c6 0 8 8 18 8" stroke-width="1"/><path d="M3 15c6 0 8 4 18 4" stroke-width="3.4"/><path class="a" d="M19 3v7M16.5 5.5L19 3l2.5 2.5"/>'),
  // Hide edge: a shape edge turned invisible
  hideedge: svgT('<path d="M4 18L7 5l12 1 1 12z" fill="currentColor" fill-opacity=".22"/><path d="M4 18L7 5l12 1 1 12"/><path class="a" d="M4 18h16" stroke-dasharray="1.5 2.5"/>'),
  // Stroke exposure: part of a stroke shown
  exposure: svgT('<path d="M3 18C6 5 18 5 21 18" stroke-opacity=".3" stroke-dasharray="1.6 1.6"/><path class="a" d="M3 18C4.5 11.5 8 8.6 12 8.2" stroke-width="2.2"/>' + nodeI(12, 8.2)),
  // Curve profile: a stroke whose width varies along it
  profile: svgT('<path d="M2 14c4-1 6-5 10-5s6 4 10 5c-4 1-6 4-10 4s-6-3-10-4z" fill="currentColor" fill-opacity=".3"/><path class="a" d="M7 4l-2 4M12 3v4M17 4l2 4"/>'),
  // Color points: points that carry their own colours
  colorpoints: svgT('<path d="M3 18C7 8 13 8 21 12" stroke-opacity=".6"/><circle cx="3" cy="18" r="2.4" fill="#ff6b6b" stroke="none"/><circle cx="12" cy="9.6" r="2.4" fill="#ffd43b" stroke="none"/><circle cx="21" cy="12" r="2.4" class="af" stroke="none"/>'),
  // Eyedropper
  eyedropper: svgT('<path d="M14 4l6 6-9.5 9.5H6v-4.5z" fill="currentColor" fill-opacity=".2"/><path d="M14 4l6 6"/><path class="a" d="M17 2.8l4.2 4.2-2 2-4.2-4.2zM6 18l-3 3"/>'),
  // Switch layer: alternatives with the chosen one marked
  switchlayer: svgT('<rect x="3" y="4" width="8" height="7" rx="1.2"/><rect x="13" y="4" width="8" height="7" rx="1.2" stroke-opacity=".5"/><rect x="8" y="13" width="8" height="7" rx="1.2" stroke-opacity=".5"/><rect class="af" x="5" y="6" width="4" height="3" stroke="none"/><path class="a" d="M7 13v-1M17 13v-1"/>'),
  // Camera tools: the camera body + what changes
  camzoom: svgT('<rect x="2.5" y="9" width="11" height="9" rx="1.6"/><path d="M13.5 12l4.5-2.5v8L13.5 15"/><path class="a" d="M17.5 2.5v6M14.5 5.5h6" stroke-width="1.8"/>'),
  camroll: svgT('<rect x="5" y="8" width="11" height="8" rx="1.6"/><path d="M16 10.5l3.5-2v7l-3.5-2"/><path class="a" d="M3 9a9 9 0 0 1 6-6.5M8.8 2.3L9.2 4.6 7 5.2"/>'),
  campantilt: svgT('<rect x="6" y="8" width="10" height="8" rx="1.6"/><path d="M16 10.5l3.5-2v7l-3.5-2"/><path class="a" d="M2.5 12h2.5M1.5 11l-1 1 1 1M11 2.5V5M10 1.5l1-1 1 1M11 19v2.5M10 22.5l1 1 1-1"/>'),
});
TOOL_ICONS.drawshape = TOOL_ICONS.shape;
TOOL_ICONS.shapeselect = TOOL_ICONS.selshape;
TOOL_ICONS.orbitworkspace = TOOL_ICONS.orbit;
TOOL_ICONS.camera = svgT('<rect x="2.5" y="9" width="13" height="10" rx="1.8"/><path d="M15.5 12.5l6-3.5v10l-6-3.5"/><circle cx="6" cy="5.5" r="2.5"/><circle cx="12" cy="5.5" r="2.5"/><path class="a" d="M5 14h6M9.5 12.2L11.3 14l-1.8 1.8"/>');
