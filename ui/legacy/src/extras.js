// ---------- Popai extras on top of the Nov 17 editor: logo, minimal icons, Select Bone layout ----------
var POPAI_WORDMARK = (typeof window !== 'undefined' && window.__POPAI_WORDMARK__) || '';
// physics and force live in the Select bone bar now
{ const g = TOOL_GROUPS.find((x) => x[0] === 'Bone'); if (g) g[1] = g[1].filter((id) => id !== 'physics' && id !== 'force'); }
for (const id in TOOL_ICONS) if (TOOLS[id]) TOOLS[id].icon = TOOL_ICONS[id];
